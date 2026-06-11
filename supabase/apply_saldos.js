// Aplica saldos_iniciales.sql + ps_finance.sql (balances con arrastre), ATÓMICO,
// con TEST de runtime real (impersona admin vía JWT claims, savepoint → revierte el
// dato de prueba pero conserva el DDL). Commit solo si todo cuadra.
const { Client } = require('pg'); const fs = require('fs');
const PASS = process.env.PGPASS || fs.readFileSync(__dirname + '/.pgpass', 'utf8').trim();
const c = new Client({ host: 'aws-1-us-west-2.pooler.supabase.com', port: 5432, user: 'postgres.lintmcxqxnrholslatul', password: PASS, database: 'postgres', ssl: { rejectUnauthorized: false } });
const saldos  = fs.readFileSync(__dirname + '/saldos_iniciales.sql', 'utf8');
const finance = fs.readFileSync(__dirname + '/ps_finance.sql', 'utf8');

(async () => {
  await c.connect();
  try {
    await c.query('begin');
    await c.query(saldos);
    await c.query(finance);

    // ── estructura ──
    const tbl = (await c.query("select to_regclass('public.saldos_iniciales') t")).rows[0].t;
    const fns = (await c.query(`select count(*)::int n from pg_proc where proname in
      ('admin_set_saldo_inicial','admin_list_saldos_iniciales','admin_eliminar_saldo_inicial','get_balance_agencias','get_balance_aliados')`)).rows[0].n;
    console.log('tabla saldos_iniciales:', tbl, '| funciones presentes:', fns, '(esperado 5)');

    // ── TEST runtime: impersonar admin, sembrar saldo de prueba, correr balances ──
    await c.query('savepoint test');
    const uid = (await c.query("select auth_uid::text u from app_usuarios where rol='Administrador' and activo limit 1")).rows[0]?.u;
    const ag  = (await c.query("select id from contactos where lower(tipo)='agencia' limit 1")).rows[0]?.id;
    const al  = (await c.query("select id from contactos where lower(tipo)='aliado'  limit 1")).rows[0]?.id;
    if (!uid || !ag) throw new Error('no hay admin/agencia para testear');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]);

    await c.query("select admin_set_saldo_inicial($1, 999, '2026-04-30', 'TEST', 'apply')", [ag]);
    if (al) await c.query("select admin_set_saldo_inicial($1, 7, '2026-04-30', 'TEST', 'apply')", [al]);

    const balAg = (await c.query('select get_balance_agencias(null,null) j')).rows[0].j;
    const balAl = (await c.query('select get_balance_aliados(null,null) j')).rows[0].j;
    const rowAg = (balAg.agencias || []).find(x => x.id === ag);
    const rowAl = al ? (balAl.aliados || []).find(x => x.id === al) : { saldo_inicial: 7 };
    console.log('agencia test → saldo_inicial:', rowAg?.saldo_inicial, 'te_debe:', rowAg?.te_debe, '(esperado saldo_inicial=999)');
    console.log('aliado  test → saldo_inicial:', rowAl?.saldo_inicial, '(esperado 7)');
    const listN = (await c.query('select jsonb_array_length(admin_list_saldos_iniciales()) n')).rows[0].n;
    console.log('admin_list_saldos_iniciales →', listN, 'filas (con los de prueba)');

    const ok = tbl && fns === 5 && Number(rowAg?.saldo_inicial) === 999 && (!al || Number(rowAl?.saldo_inicial) === 7);
    await c.query('rollback to savepoint test');   // revierte SOLO los datos de prueba; conserva el DDL

    if (ok) { await c.query('commit'); console.log('\n✅ COMMIT — saldos iniciales + balances con arrastre, verificados (test ok, datos de prueba revertidos).'); }
    else    { await c.query('rollback'); console.log('\n❌ ROLLBACK — el test falló, nada se cambió.'); process.exitCode = 1; }
  } catch (e) {
    await c.query('rollback').catch(() => {});
    console.error('❌ ERROR, rollback:', e.message);
    process.exitCode = 1;
  } finally { await c.end(); }
})();
