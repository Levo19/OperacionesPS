// Aplica hotel_core.sql + tests money-safety. Correr: node apply_hotel_core.js
const { Client } = require('pg'); const fs = require('fs');
const c = new Client({ host: 'aws-1-us-west-2.pooler.supabase.com', port: 5432, user: 'postgres.lintmcxqxnrholslatul', password: fs.readFileSync(__dirname + '/.pgpass', 'utf8').trim(), database: 'postgres', ssl: { rejectUnauthorized: false } });
const J = JSON.stringify;

(async () => {
  await c.connect();
  await c.query(fs.readFileSync(__dirname + '/hotel_core.sql', 'utf8'));
  console.log('SQL aplicado OK');

  let pass = 0, fail = 0;
  const t = async (n, fn) => { try { await fn(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '→', e.message); } };

  await t('15 cuartos + 7 items catálogo', async () => {
    const r = await c.query('select (select count(*)::int from hotel_cuartos) c, (select count(*)::int from hotel_catalogo) k');
    if (r.rows[0].c !== 15 || r.rows[0].k !== 7) throw new Error(J(r.rows[0]));
  });

  const uid = (await c.query("select auth_uid::text u from app_usuarios where rol='Administrador' and activo and auth_uid is not null limit 1")).rows[0].u;
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims', $1, true)", [J({ sub: uid, role: 'authenticated' })]);

  let rid = 0;
  await t('crear reserva + adelanto', async () => {
    const r = await c.query("select hotel_reservar($1::jsonb) j", [J({ cuarto_id: 1, huesped: 'Test Smoke', fecha_in: '2026-08-10', fecha_out: '2026-08-13', precio_noche: 100, adelanto: 100, adelanto_medio: 'yape', local_id: 'smk-1' })]);
    rid = r.rows[0].j.id; if (!rid) throw new Error('sin id');
    const f = await c.query('select saldo from hotel_folio where reserva_id=$1', [rid]);
    if (Number(f.rows[0].saldo) !== 200) throw new Error('saldo ' + f.rows[0].saldo);
  });
  await t('idempotencia local_id', async () => {
    const r = await c.query("select hotel_reservar($1::jsonb) j", [J({ cuarto_id: 1, huesped: 'Test Smoke', fecha_in: '2026-08-10', fecha_out: '2026-08-13', precio_noche: 100, local_id: 'smk-1' })]);
    if (!r.rows[0].j.dup) throw new Error('no dedup');
  });
  await t('🔒 CANDADO: solape rechazado', async () => {
    await c.query('savepoint s1');
    try {
      await c.query("select hotel_reservar($1::jsonb)", [J({ cuarto_id: 1, huesped: 'Intruso', fecha_in: '2026-08-12', fecha_out: '2026-08-14', precio_noche: 100, local_id: 'smk-2' })]);
      throw new Error('PERMITIÓ SOLAPE!');
    } catch (e) {
      if (/PERMITIÓ/.test(e.message)) throw e;
      if (!/CUARTO_OCUPADO/.test(e.message)) throw new Error('error inesperado: ' + e.message);
      await c.query('rollback to savepoint s1');
    }
  });
  await t('mismo cuarto, fechas contiguas OK (out exclusivo)', async () => {
    await c.query("select hotel_reservar($1::jsonb)", [J({ cuarto_id: 1, huesped: 'Siguiente', fecha_in: '2026-08-13', fecha_out: '2026-08-15', precio_noche: 100, local_id: 'smk-3' })]);
  });
  await t('checkin bloqueado si cuarto sucio', async () => {
    await c.query("update hotel_cuartos set limpieza='sucio' where id=1");
    await c.query('savepoint s2');
    try {
      await c.query("select hotel_accion($1::jsonb)", [J({ reserva_id: rid, accion: 'checkin' })]);
      throw new Error('PERMITIÓ CHECKIN SUCIO!');
    } catch (e) {
      if (/PERMITIÓ/.test(e.message)) throw e;
      if (!/CUARTO_NO_LISTO/.test(e.message)) throw new Error(e.message);
      await c.query('rollback to savepoint s2');
    }
    await c.query("update hotel_cuartos set limpieza='limpio' where id=1");
  });
  await t('checkin → checkout marca sucio', async () => {
    await c.query("select hotel_accion($1::jsonb)", [J({ reserva_id: rid, accion: 'checkin' })]);
    await c.query("select hotel_consumo($1::jsonb)", [J({ reserva_id: rid, item: 'Agua mineral', cantidad: 2, precio: 3, local_id: 'smk-c1' })]);
    await c.query("select hotel_pago($1::jsonb)", [J({ reserva_id: rid, monto: 206, medio: 'efectivo', local_id: 'smk-p1' })]);
    const f = await c.query('select saldo from hotel_folio where reserva_id=$1', [rid]);
    if (Number(f.rows[0].saldo) !== 0) throw new Error('saldo ' + f.rows[0].saldo);
    await c.query("select hotel_accion($1::jsonb)", [J({ reserva_id: rid, accion: 'checkout' })]);
    const l = await c.query('select limpieza from hotel_cuartos where id=1');
    if (l.rows[0].limpieza !== 'sucio') throw new Error('no marcó sucio');
  });
  await t('pago negativo rechazado', async () => {
    await c.query('savepoint s3');
    try {
      await c.query("select hotel_pago($1::jsonb)", [J({ reserva_id: rid, monto: -50, medio: 'efectivo', local_id: 'smk-p2' })]);
      throw new Error('PERMITIÓ NEGATIVO!');
    } catch (e) { if (/PERMITIÓ/.test(e.message)) throw e; await c.query('rollback to savepoint s3'); }
  });
  await c.query('rollback');  // nada del smoke queda en prod

  // anon no lee
  await t('anon NO lee reservas', async () => {
    await c.query('begin'); await c.query("set local role anon");
    const r = await c.query('select count(*)::int n from hotel_reservas');
    await c.query('rollback');
    if (r.rows[0].n !== 0) throw new Error('anon leyó!');
  });

  console.log(`\nTests: ${pass} ✓ / ${fail} ✗`);
  await c.end(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
