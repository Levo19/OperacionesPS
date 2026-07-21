// Aplica landing_web.sql + smoke tests RLS. Correr: node apply_landing_web.js
const { Client } = require('pg'); const fs = require('fs');
const c = new Client({ host: 'aws-1-us-west-2.pooler.supabase.com', port: 5432, user: 'postgres.lintmcxqxnrholslatul', password: fs.readFileSync(__dirname + '/.pgpass', 'utf8').trim(), database: 'postgres', ssl: { rejectUnauthorized: false } });
const J = (o) => JSON.stringify(o);

(async () => {
  await c.connect();
  await c.query(fs.readFileSync(__dirname + '/landing_web.sql', 'utf8'));
  console.log('SQL aplicado OK');

  // ── Smoke tests ──
  let pass = 0, fail = 0;
  const t = async (nombre, fn) => { try { await fn(); pass++; console.log('  ✓', nombre); } catch (e) { fail++; console.log('  ✗', nombre, '→', e.message); } };

  // seed presente
  await t('seed casamunay existe', async () => {
    const r = await c.query("select sitio from web_contenido where sitio='casamunay'");
    if (!r.rows.length) throw new Error('sin fila');
  });

  // como ANON: lee contenido, NO puede escribirlo
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', $1, true)", [J({ role: 'anon' })]);
  await c.query("set local role anon");
  await t('anon lee web_contenido', async () => {
    const r = await c.query("select nombre from web_contenido where sitio='casamunay'");
    if (!r.rows.length) throw new Error('no lee');
  });
  await t('anon NO actualiza web_contenido', async () => {
    const r = await c.query("update web_contenido set nombre='HACK' where sitio='casamunay'");
    if (r.rowCount !== 0) throw new Error('RLS permitió update!');
  });
  await t('anon inserta testimonio pendiente-only', async () => {
    await c.query("insert into web_testimonios(sitio,nombre,comentario,rating,local_id) values ('casamunay','Test Smoke','Comentario de prueba smoke',5,'smoke-1')");
  });
  await t('anon NO inserta testimonio visible', async () => {
    await c.query("savepoint sp1");
    try {
      await c.query("insert into web_testimonios(sitio,nombre,comentario,rating,visible,pendiente,local_id) values ('casamunay','Hack','Intento publicar directo',5,true,false,'smoke-2')");
      throw new Error('RLS permitió visible!');
    } catch (e) {
      if (/RLS permitió/.test(e.message)) throw e;
      await c.query("rollback to savepoint sp1"); /* error RLS esperado */
    }
  });
  await t('anon NO lee pendientes', async () => {
    const r = await c.query("select id from web_testimonios where local_id='smoke-1'");
    if (r.rows.length) throw new Error('leyó pendiente!');
  });
  await c.query("rollback");

  // como ADMIN (JWT real de app_usuarios): RPCs funcionan
  const uid = (await c.query("select auth_uid::text u from app_usuarios where rol='Administrador' and activo and auth_uid is not null limit 1")).rows[0].u;
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', $1, true)", [J({ sub: uid, role: 'authenticated' })]);
  await t('admin web_get_admin', async () => {
    const r = await c.query("select web_get_admin('casamunay') j");
    if (!r.rows[0].j.contenido) throw new Error('sin contenido');
  });
  await t('admin web_guardar_contenido (whatsapp)', async () => {
    await c.query("select web_guardar_contenido($1::jsonb)", [J({ sitio: 'casamunay', whatsapp: '51 999 111 222' })]);
    const r = await c.query("select whatsapp from web_contenido where sitio='casamunay'");
    if (r.rows[0].whatsapp !== '51999111222') throw new Error('no normalizó: ' + r.rows[0].whatsapp);
  });
  await c.query("rollback");

  // bucket
  await t("bucket 'web' público", async () => {
    const r = await c.query("select public from storage.buckets where id='web'");
    if (!r.rows.length || !r.rows[0].public) throw new Error('falta o no público');
  });

  console.log(`\nTests: ${pass} ✓ / ${fail} ✗`);
  await c.end();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
