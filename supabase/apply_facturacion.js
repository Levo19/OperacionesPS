// Aplica facturacion_base.sql ATÓMICO + test runtime exhaustivo (impersona admin,
// savepoint → revierte datos de prueba; correlativo/idempotencia/toggle/exonerado/cliente).
const { Client } = require('pg'); const fs = require('fs');
const PASS = process.env.PGPASS || fs.readFileSync(__dirname + '/.pgpass', 'utf8').trim();
const c = new Client({ host: 'aws-1-us-west-2.pooler.supabase.com', port: 5432, user: 'postgres.lintmcxqxnrholslatul', password: PASS, database: 'postgres', ssl: { rejectUnauthorized: false } });
const sql = fs.readFileSync(__dirname + '/facturacion_base.sql', 'utf8');
const J = x => JSON.stringify(x);

(async () => {
  await c.connect();
  let pass = true; const chk = (label, cond, got) => { console.log((cond ? '✓' : '✗') + ' ' + label + (got !== undefined ? '  → ' + J(got) : '')); if (!cond) pass = false; };
  try {
    await c.query('begin');
    await c.query(sql);

    // estructura
    const tabs = (await c.query("select count(*)::int n from information_schema.tables where table_name in ('servicios','clientes','series','comprobantes')")).rows[0].n;
    chk('4 tablas creadas', tabs === 4, tabs);
    const col = (await c.query("select count(*)::int n from information_schema.columns where table_name='app_config' and column_name='facturacion_muelle'")).rows[0].n;
    chk('toggle facturacion_muelle en app_config', col === 1);

    // impersonar admin
    await c.query('savepoint t');
    const uid = (await c.query("select auth_uid::text u from app_usuarios where rol='Administrador' and activo limit 1")).rows[0]?.u;
    await c.query("select set_config('request.jwt.claims', $1, true)", [J({ sub: uid, role: 'authenticated' })]);

    // 1) catálogo de servicios
    const svc = (await c.query("select admin_set_servicio('','Tour Islas Ballestas','Tour clásico',120,'NIU',true) id")).rows[0].id;
    const lst = (await c.query("select listar_servicios() j")).rows[0].j;
    chk('servicio creado y listado', Array.isArray(lst) && lst.some(s => s.id === svc && s.precio == 120));

    // 2) toggle muelle
    await c.query("select admin_set_facturacion_muelle(true)");
    chk('toggle ON', (await c.query("select get_facturacion_muelle() b")).rows[0].b === true);

    // 3) emitir (panel) — boleta, 2 PAX x 120 = 240, IGV 18%
    const items = J([{ descripcion: 'Tour Islas Ballestas', cantidad: 2, precio: 120 }]);
    const r1 = (await c.query(
      "select emitir_comprobante(2,'B001','1','45678912','Juan Perez',null,$1::jsonb,false,'PEN','panel',null,'admin','LID-TEST-1') j", [items])).rows[0].j;
    chk('emitir B001 nro 1', r1.numero === 1 && r1.estado === 'stub', { numero: r1.numero, estado: r1.estado });
    chk('totales 18% (240 → grav 203.39 / igv 36.61)', Number(r1.gravada) === 203.39 && Number(r1.igv) === 36.61 && Number(r1.total) === 240, { g: r1.gravada, igv: r1.igv, t: r1.total });

    // 4) idempotencia — mismo local_id → reusa, NO incrementa correlativo
    const r1b = (await c.query(
      "select emitir_comprobante(2,'B001','1','45678912','Juan Perez',null,$1::jsonb,false,'PEN','panel',null,'admin','LID-TEST-1') j", [items])).rows[0].j;
    chk('idempotencia (mismo local_id → reusado)', r1b.reusado === true && r1b.numero === 1);
    const corr = (await c.query("select correlativo from series where serie='B001'")).rows[0].correlativo;
    chk('correlativo NO se duplicó (sigue en 1)', corr === 1, corr);

    // 5) segundo comprobante → correlativo 2
    const r2 = (await c.query("select emitir_comprobante(2,'B001','6','20512345678','Agencia SAC',null,$1::jsonb,false,'PEN','panel',null,'admin','LID-TEST-2') j", [items])).rows[0].j;
    chk('segundo comprobante → nro 2', r2.numero === 2);

    // 6) exonerado (turismo receptivo)
    const r3 = (await c.query("select emitir_comprobante(1,'F001','7','PAS123','Mr Tourist',null,$1::jsonb,true,'PEN','panel',null,'admin','LID-TEST-3') j", [items])).rows[0].j;
    chk('exonerado → IGV 0', Number(r3.igv) === 0 && Number(r3.total) === 240, { igv: r3.igv, t: r3.total });

    // 7) muelle con toggle ON funciona; OFF lo bloquea
    await c.query("select emitir_comprobante(2,'B001','1','11111111','Cli Muelle',null,$1::jsonb,false,'PEN','muelle',null,'op','LID-MUELLE-1')", [items]);
    chk('muelle con toggle ON: emite', true);
    await c.query("select admin_set_facturacion_muelle(false)");
    let blocked = false;
    await c.query('savepoint s7');
    try { await c.query("select emitir_comprobante(2,'B001','1','22222222','X',null,$1::jsonb,false,'PEN','muelle',null,'op','LID-MUELLE-2')", [items]); }
    catch (e) { blocked = /FACTURACION_OFF/.test(e.message); await c.query('rollback to savepoint s7'); }   // recupera la tx abortada
    chk('muelle con toggle OFF: BLOQUEA', blocked);

    // 8) cliente frecuente guardado
    const cli = (await c.query("select buscar_cliente('6','20512345678') j")).rows[0].j;
    chk('cliente frecuente guardado (Agencia SAC)', cli && cli.nombre === 'Agencia SAC');

    // 9) listar comprobantes
    const lc = (await c.query("select jsonb_array_length(listar_comprobantes(null,null)) n")).rows[0].n;
    chk('listar_comprobantes devuelve filas', lc >= 4, lc);

    await c.query('rollback to savepoint t');   // revierte TODO lo de prueba; conserva el DDL

    if (pass) { await c.query('commit'); console.log('\n✅ COMMIT — Fundación de facturación creada y verificada (test ok, datos de prueba revertidos).'); }
    else { await c.query('rollback'); console.log('\n❌ ROLLBACK — algún test falló, nada se cambió.'); process.exitCode = 1; }
  } catch (e) {
    await c.query('rollback').catch(() => {});
    console.error('❌ ERROR, rollback:', e.message);
    process.exitCode = 1;
  } finally { await c.end(); }
})();
