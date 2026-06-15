// Aplica op_fecha.sql (abrir_operacion con p_fecha), ATÓMICO + test runtime.
const { Client } = require('pg'); const fs = require('fs');
const PASS = process.env.PGPASS || fs.readFileSync(__dirname + '/.pgpass', 'utf8').trim();
const c = new Client({ host: 'aws-1-us-west-2.pooler.supabase.com', port: 5432, user: 'postgres.lintmcxqxnrholslatul', password: PASS, database: 'postgres', ssl: { rejectUnauthorized: false } });
const sql = fs.readFileSync(__dirname + '/op_fecha.sql', 'utf8');

(async () => {
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);

    // una sola firma de abrir_operacion (no ambigüedad)
    const n = (await c.query("select count(*)::int n from pg_proc where proname='abrir_operacion'")).rows[0].n;
    console.log('funciones abrir_operacion:', n, '(esperado 1 — sin ambigüedad)');

    await c.query('savepoint t');
    const uid = (await c.query("select auth_uid::text u from app_usuarios where rol='Administrador' and activo limit 1")).rows[0]?.u;
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    const bote = (await c.query("select id from embarcaciones limit 1")).rows[0]?.id;

    // 1) con p_fecha específica (futura) → debe respetarla
    const id1 = (await c.query("select abrir_operacion($1,null,null,'09:00 AM','Islas',' PS', null, null, '2026-07-01'::date) id", [bote])).rows[0].id;
    const f1  = (await c.query("select to_char(fecha,'YYYY-MM-DD') f from operaciones where id=$1", [id1])).rows[0].f;
    console.log('con p_fecha=2026-07-01 → op fecha:', f1, '(esperado 2026-07-01)');

    // 2) sin p_fecha → hoy Lima
    const hoy = (await c.query("select to_char((now() at time zone 'America/Lima')::date,'YYYY-MM-DD') h")).rows[0].h;
    const id2 = (await c.query("select abrir_operacion($1,null,null,'10:00 AM','Islas','PS') id", [bote])).rows[0].id;
    const f2  = (await c.query("select to_char(fecha,'YYYY-MM-DD') f from operaciones where id=$1", [id2])).rows[0].f;
    console.log('sin p_fecha → op fecha:', f2, '(esperado hoy Lima', hoy + ')');

    const ok = n === 1 && f1 === '2026-07-01' && f2 === hoy;
    await c.query('rollback to savepoint t');

    if (ok) { await c.query('commit'); console.log('\n✅ COMMIT — abrir_operacion respeta p_fecha (y default hoy). Verificado, revertido.'); }
    else    { await c.query('rollback'); console.log('\n❌ ROLLBACK — test falló.'); process.exitCode = 1; }
  } catch (e) {
    await c.query('rollback').catch(() => {});
    console.error('❌ ERROR, rollback:', e.message);
    process.exitCode = 1;
  } finally { await c.end(); }
})();
