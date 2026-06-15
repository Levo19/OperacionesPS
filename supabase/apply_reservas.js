// Aplica reservas_creado_por.sql + dashboard.sql (sala muestra hoy-ya-tomadas),
// ATÓMICO + test runtime (impersona admin, savepoint → revierte datos de prueba).
const { Client } = require('pg'); const fs = require('fs');
const PASS = process.env.PGPASS || fs.readFileSync(__dirname + '/.pgpass', 'utf8').trim();
const c = new Client({ host: 'aws-1-us-west-2.pooler.supabase.com', port: 5432, user: 'postgres.lintmcxqxnrholslatul', password: PASS, database: 'postgres', ssl: { rejectUnauthorized: false } });
const mig  = fs.readFileSync(__dirname + '/reservas_creado_por.sql', 'utf8');
const dash = fs.readFileSync(__dirname + '/dashboard.sql', 'utf8');

(async () => {
  await c.connect();
  try {
    await c.query('begin');
    await c.query(mig);
    await c.query(dash);

    // estructura
    const col = (await c.query("select count(*)::int n from information_schema.columns where table_name='reservas' and column_name='creado_por'")).rows[0].n;
    console.log('columna reservas.creado_por:', col, '(esperado 1)');

    // ── test runtime (impersona admin) ──
    await c.query('savepoint t');
    const uid = (await c.query("select auth_uid::text u from app_usuarios where rol='Administrador' and activo limit 1")).rows[0]?.u;
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]);

    // 1) crear reserva HOY con autor
    const rid = (await c.query("select crear_reserva((now() at time zone 'America/Lima')::date,'09:00',null,'TEST CLIENTE',2,0,'TEST_OP') id")).rows[0].id;
    let sala = (await c.query('select get_dashboard() j')).rows[0].j.sala_de_espera || [];
    const r1 = sala.find(x => x.id === rid);
    console.log('crear → en sala:', !!r1, '| creado_por:', r1 && r1.creado_por, '(esperado TEST_OP)');

    // 2) marcar Asignado (ya embarcó) → debe SEGUIR apareciendo (para tacharla)
    await c.query("update reservas set estado='Asignado' where id=$1", [rid]);
    sala = (await c.query('select get_dashboard() j')).rows[0].j.sala_de_espera || [];
    const r2 = sala.find(x => x.id === rid);
    console.log('Asignado → sigue en sala:', !!r2, '| estado:', r2 && r2.estado, '(esperado Asignado)');

    const ok = col === 1 && r1 && r1.creado_por === 'TEST_OP' && r2 && r2.estado === 'Asignado';
    await c.query('rollback to savepoint t');

    if (ok) { await c.query('commit'); console.log('\n✅ COMMIT — reservas.creado_por + sala con tachadas, verificado (test ok, revertido).'); }
    else    { await c.query('rollback'); console.log('\n❌ ROLLBACK — el test falló, nada se cambió.'); process.exitCode = 1; }
  } catch (e) {
    await c.query('rollback').catch(() => {});
    console.error('❌ ERROR, rollback:', e.message);
    process.exitCode = 1;
  } finally { await c.end(); }
})();
