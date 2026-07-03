// Aplica facturacion_blindaje.sql (Fase A) ATÓMICO + batería de tests (rolled-back).
// Commit SOLO si todos los tests pasan. El DDL se commitea; los datos de prueba no.
const { Client } = require('pg'); const fs = require('fs');
const PASS = process.env.PGPASS || fs.readFileSync(__dirname + '/.pgpass', 'utf8').trim();
const c = new Client({ host: 'aws-1-us-west-2.pooler.supabase.com', port: 5432, user: 'postgres.lintmcxqxnrholslatul', password: PASS, database: 'postgres', ssl: { rejectUnauthorized: false } });
const sql = fs.readFileSync(__dirname + '/facturacion_blindaje.sql', 'utf8');
const J = x => JSON.stringify(x);
const items = (precio, cant = 1) => J([{ descripcion: 'Tour Islas Ballestas', cantidad: cant, precio }]);

(async () => {
  await c.connect();
  let pass = true;
  const chk = (l, ok, g) => { console.log((ok ? '✓' : '✗') + ' ' + l + (g !== undefined ? '  → ' + J(g) : '')); if (!ok) pass = false; };
  // corre un emit y espera que LANCE un error que matchee re; usa savepoint para no abortar la tx
  const expectRaise = async (label, argsSql, re) => {
    await c.query('savepoint e');
    try { await c.query(`select emitir_comprobante(${argsSql}) j`); chk(label + ' (debía fallar)', false, 'no lanzó'); await c.query('rollback to savepoint e'); }
    catch (err) { await c.query('rollback to savepoint e'); chk(label, re.test(err.message), err.message.split('\n')[0].slice(0, 90)); }
  };
  try {
    await c.query('begin');
    await c.query(sql);

    await c.query('savepoint t');
    const uid = (await c.query("select auth_uid::text u from app_usuarios where rol='Administrador' and activo limit 1")).rows[0]?.u;
    await c.query("select set_config('request.jwt.claims', $1, true)", [J({ sub: uid, role: 'authenticated' })]);

    // ── B1: RLS activo en las 4 tablas ──
    const rls = (await c.query("select relname, relrowsecurity from pg_class where relname in ('servicios','clientes','series','comprobantes') order by relname")).rows;
    chk('RLS activo en servicios/clientes/series/comprobantes', rls.length === 4 && rls.every(r => r.relrowsecurity === true), rls.map(r => r.relname + ':' + r.relrowsecurity));

    // ── B4: get_facturacion_config trae serie_boleta/serie_factura ──
    const cfg = (await c.query("select get_facturacion_config() j")).rows[0].j;
    chk('get_facturacion_config trae series', !!cfg.serie_boleta && !!cfg.serie_factura, { b: cfg.serie_boleta, f: cfg.serie_factura });

    // ── B5: columnas nuevas existen ──
    const cols = (await c.query("select column_name from information_schema.columns where table_name='comprobantes' and column_name in ('cliente_tel','hash','total_inafecta','medio_pago')")).rows.map(r => r.column_name).sort();
    chk('columnas cliente_tel/hash/total_inafecta/medio_pago', cols.length === 4, cols);
    const sot = (await c.query("select column_name from information_schema.columns where table_name='comprobantes' and column_name in ('aceptada_por_sunat','enlace_cdr','codigo_barras','sunat_responsecode','sunat_soap_error','nf_respuesta')")).rows.map(r => r.column_name).sort();
    chk('CPE SoT completa: aceptada_por_sunat/enlace_cdr/codigo_barras/responsecode/soap_error/nf_respuesta', sot.length === 6, sot);
    const ah = (await c.query("select auth_header from facturacion_config where id=1")).rows[0].auth_header;
    chk('auth_header configurable (default {token} = crudo)', ah === '{token}', ah);

    const B = cfg.serie_boleta, F = cfg.serie_factura;

    // ── §4: VALIDACIONES SUNAT (deben LANZAR) ──
    await expectRaise('factura sin RUC → FACTURA_REQUIERE_RUC',
      `1,'${F}','1','45678912','Luis','','${items(100)}'::jsonb,false,'PEN','panel',null,'T','V-1',null,'',false,null`, /FACTURA_REQUIERE_RUC/);
    await expectRaise('factura sin dirección → FACTURA_REQUIERE_DIRECCION',
      `1,'${F}','6','20123456789','EMPRESA SAC','','${items(100)}'::jsonb,false,'PEN','panel',null,'T','V-2',null,'',false,null`, /FACTURA_REQUIERE_DIRECCION/);
    await expectRaise('boleta >700 sin doc → BOLETA_MAYOR_700_REQUIERE_ID',
      `2,'${B}','0','','VARIOS','','${items(800)}'::jsonb,false,'PEN','panel',null,'T','V-3',null,'',false,null`, /BOLETA_MAYOR_700_REQUIERE_ID/);
    await expectRaise('>=2000 sin medio de pago → REQUIERE_MEDIO_DE_PAGO',
      `2,'${B}','1','45678912','Luis','','${items(2500)}'::jsonb,false,'PEN','panel',null,'T','V-4',null,'',false,null`, /REQUIERE_MEDIO_DE_PAGO/);

    // ── §4: EMISIONES VÁLIDAS (STUB, config inactiva) ──
    const rb = (await c.query(`select emitir_comprobante(2,'${B}','0','','CLIENTE VARIOS','',$1::jsonb,false,'PEN','panel',null,'T','BL-B1',null,null,false,null) j`, [items(30, 2)])).rows[0].j;
    chk('boleta varios <700 emite (stub)', rb.estado === 'stub' && rb.numero >= 1 && Number(rb.igv) > 0, { n: rb.numero, igv: rb.igv });
    const rf = (await c.query(`select emitir_comprobante(1,'${F}','6','20123456789','EMPRESA SAC','',$1::jsonb,false,'PEN','panel',null,'T','BL-F1',null,'AV LIMA 123',false,'Transferencia') j`, [items(1000)])).rows[0].j;
    chk('factura con RUC+dir emite (stub)', rf.estado === 'stub' && rf.numero >= 1, { n: rf.numero });
    const rbig = (await c.query(`select emitir_comprobante(2,'${B}','1','45678912','Luis Vargas','',$1::jsonb,false,'PEN','panel',null,'T','BL-B2',null,null,false,'Yape') j`, [items(2500)])).rows[0].j;
    chk('boleta >=2000 CON medio de pago emite', rbig.estado === 'stub', rbig.estado);
    const mp = (await c.query("select medio_pago from comprobantes where local_id='BL-B2'")).rows[0].medio_pago;
    chk('medio_pago persistido', mp === 'Yape', mp);

    // ── idempotencia por local_id ──
    const dup = (await c.query(`select emitir_comprobante(2,'${B}','0','','CLIENTE VARIOS','',$1::jsonb,false,'PEN','panel',null,'T','BL-B1',null,null,false,null) j`, [items(30, 2)])).rows[0].j;
    chk('reintento mismo local_id → reusado (sin doble nº)', dup.reusado === true && dup.numero === rb.numero, { reusado: dup.reusado, n: dup.numero });

    // ── correlativo monotónico (dos boletas nuevas = nº consecutivos) ──
    const s1 = (await c.query(`select emitir_comprobante(2,'${B}','0','','VARIOS','',$1::jsonb,false,'PEN','panel',null,'T','SEQ-1',null,null,false,null) j`, [items(30)])).rows[0].j;
    const s2 = (await c.query(`select emitir_comprobante(2,'${B}','0','','VARIOS','',$1::jsonb,false,'PEN','panel',null,'T','SEQ-2',null,null,false,null) j`, [items(30)])).rows[0].j;
    chk('correlativo consecutivo sin huecos', s2.numero === s1.numero + 1, { a: s1.numero, b: s2.numero });

    // ── MODO EXPORTACIÓN (operador registrado ON) ──
    const flag = (await c.query("select operador_turistico_registrado o from facturacion_config where id=1")).rows[0].o;
    chk('flag operador_turistico_registrado = ON', flag === true, flag);
    const pkg = J([{ descripcion: 'Transporte turístico en bote', cantidad: 1, precio: 60 }, { descripcion: 'Guiado turístico', cantidad: 1, precio: 20 }]);
    const rex = (await c.query(`select emitir_comprobante(1,'${F}','7','X1234567','John Tourist','',$1::jsonb,false,'PEN','panel',null,'T','EX-1',null,null,true,null,true) j`, [pkg])).rows[0].j;
    chk('exportación: factura pasaporte + 2 servicios → 0% IGV', rex.estado === 'stub' && Number(rex.igv) === 0 && Number(rex.total) === 80, { igv: rex.igv, total: rex.total });
    const exrow = (await c.query("select es_exportacion, total_exportacion, total_igv from comprobantes where local_id='EX-1'")).rows[0];
    chk('exportación persiste es_exportacion + total_exportacion', exrow.es_exportacion === true && Number(exrow.total_exportacion) === 80 && Number(exrow.total_igv) === 0, exrow);
    await expectRaise('export 1 solo servicio → EXPORTACION_REQUIERE_PAQUETE',
      `1,'${F}','7','X9','Tourist','','${items(60)}'::jsonb,false,'PEN','panel',null,'T','EX-2',null,null,true,null,true`, /EXPORTACION_REQUIERE_PAQUETE/);
    await expectRaise('export con CE (no pasaporte) → EXPORTACION_REQUIERE_PASAPORTE',
      `1,'${F}','4','CE9','Residente','','${pkg}'::jsonb,false,'PEN','panel',null,'T','EX-3',null,null,true,null,true`, /EXPORTACION_REQUIERE_PASAPORTE/);

    // ── reconciliación no-op si inactivo ──
    const rec = (await c.query("select reconciliar_comprobantes(3) j")).rows[0].j;
    chk('reconciliar_comprobantes skip si config inactiva', rec.ok === true && rec.skip === 'inactivo', rec);

    await c.query('rollback to savepoint t');
    if (pass) { await c.query('commit'); console.log('\n✅ COMMIT — Fase A (blindaje) aplicada: RLS, validaciones SUNAT, guards, reconciliación. Sistema sigue INERTE (activo=false).'); }
    else { await c.query('rollback'); console.log('\n❌ ROLLBACK — algún test falló, no se aplicó nada.'); process.exitCode = 1; }
  } catch (e) {
    await c.query('rollback').catch(() => {});
    console.error('❌ ERROR, rollback total:', e.message);
    process.exitCode = 1;
  } finally { await c.end(); }
})();
