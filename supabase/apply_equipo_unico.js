// Aplica equipo_unico.sql + tests (regresión es_staff LEGACY + flujo Google simulado).
// Correr: node apply_equipo_unico.js
const { Client } = require('pg'); const fs = require('fs');
const c = new Client({ host: 'aws-1-us-west-2.pooler.supabase.com', port: 5432, user: 'postgres.lintmcxqxnrholslatul', password: fs.readFileSync(__dirname + '/.pgpass', 'utf8').trim(), database: 'postgres', ssl: { rejectUnauthorized: false } });
const J = JSON.stringify;

(async () => {
  await c.connect();
  await c.query(fs.readFileSync(__dirname + '/equipo_unico.sql', 'utf8'));
  console.log('SQL aplicado OK');

  let pass = 0, fail = 0;
  const t = async (n, fn) => { try { await fn(); pass++; console.log('  ✓', n); } catch (e) { fail++; console.log('  ✗', n, '→', e.message); } };

  await t('backfill: equipo poblado + Luis sembrado', async () => {
    const r = await c.query("select (select count(*)::int from equipo) n, exists(select 1 from equipo where email='luisvo.19@gmail.com') luis");
    if (r.rows[0].n < 6 || !r.rows[0].luis) throw new Error(J(r.rows[0]));
  });

  // ── REGRESIÓN: el PIN legacy sigue siendo staff/admin (el dinero no se rompe) ──
  const uidLegacy = (await c.query("select auth_uid::text u from app_usuarios where rol='Administrador' and activo and auth_uid is not null limit 1")).rows[0].u;
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims', $1, true)", [J({ sub: uidLegacy, role: 'authenticated' })]);
  await t('REGRESIÓN legacy: es_staff() y es_admin() siguen true', async () => {
    const r = await c.query('select es_staff() s, es_admin() a');
    if (!r.rows[0].s || !r.rows[0].a) throw new Error(J(r.rows[0]));
  });
  await c.query('rollback');

  // ── Flujo Google simulado: Luis entra con su Gmail (uid nuevo) ──
  const uidG = '11111111-2222-3333-4444-555555555555';
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims', $1, true)", [J({ sub: uidG, email: 'luisvo.19@gmail.com', role: 'authenticated' })]);
  await t('equipo_login vincula por email', async () => {
    const r = await c.query('select equipo_login() j');
    if (!r.rows[0].j.ok || r.rows[0].j.accesos.hotel !== 'admin') throw new Error(J(r.rows[0].j));
  });
  await t('Google user: es_staff + es_admin + acceso_app', async () => {
    const r = await c.query("select es_staff() s, es_admin() a, acceso_app('hotel') h, _hotel_quien() q");
    if (!r.rows[0].s || !r.rows[0].a || r.rows[0].h !== 'admin' || !/Luis/.test(r.rows[0].q)) throw new Error(J(r.rows[0]));
  });
  await t('equipo_invitar + lista', async () => {
    await c.query('select equipo_invitar($1::jsonb)', [J({ nombre: 'Prueba Recep', email: 'prueba.recep@gmail.com', accesos: [{ app: 'hotel', rol: 'operador' }] })]);
    const r = await c.query('select equipo_lista() j');
    if (!JSON.stringify(r.rows[0].j).includes('prueba.recep@gmail.com')) throw new Error('no aparece');
  });
  await t('anti-lockout: no puedo desactivarme', async () => {
    const pid = (await c.query("select id from equipo where lower(email)='luisvo.19@gmail.com'")).rows[0].id;
    await c.query('savepoint s1');
    try {
      await c.query('select equipo_toggle($1::jsonb)', [J({ equipo_id: pid, activo: false })]);
      throw new Error('PERMITIÓ AUTOLOCKOUT!');
    } catch (e) { if (/PERMITIÓ/.test(e.message)) throw e; if (!/ANTI_LOCKOUT/.test(e.message)) throw new Error(e.message); await c.query('rollback to savepoint s1'); }
  });
  await c.query('rollback');

  // ── Gmail NO invitado: fuera ──
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims', $1, true)", [J({ sub: '99999999-9999-9999-9999-999999999999', email: 'intruso@gmail.com', role: 'authenticated' })]);
  await t('no invitado: NO_INVITADO + sin staff', async () => {
    const r = await c.query('select equipo_login() j, es_staff() s, es_admin() a');
    if (r.rows[0].j.ok || r.rows[0].s || r.rows[0].a) throw new Error(J(r.rows[0]));
  });
  await c.query('rollback');

  console.log(`\nTests: ${pass} ✓ / ${fail} ✗`);
  await c.end(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
