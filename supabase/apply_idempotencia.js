// Aplica idempotencia.sql a la base real, ATÓMICO + verificado.
// Estrategia: BEGIN → aplicar → verificar dentro de la tx → COMMIT solo si OK.
const { Client } = require('pg'); const fs = require('fs');
const PASS = process.env.PGPASS || fs.readFileSync(__dirname + '/.pgpass', 'utf8').trim();
const c = new Client({ host: 'aws-1-us-west-2.pooler.supabase.com', port: 5432, user: 'postgres.lintmcxqxnrholslatul', password: PASS, database: 'postgres', ssl: { rejectUnauthorized: false } });
const sql = fs.readFileSync(__dirname + '/idempotencia.sql', 'utf8');

(async () => {
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);

    // ── verificación DENTRO de la transacción ──
    const col = await c.query(`select count(*)::int n from information_schema.columns
      where table_name in ('movimientos','operaciones','reservas','caja_operador') and column_name='local_id'`);
    const idx = await c.query(`select count(*)::int n from pg_indexes where indexname in
      ('ux_mov_localid','ux_op_localid','ux_res_localid','ux_caja_localid')`);
    const fn = await c.query(`select proname, pronargs::int from pg_proc where proname in
      ('registrar_movimiento','abrir_operacion','crear_reserva','asignar_reserva','registrar_transaccion','pase_desde_reserva')
      order by proname`);

    console.log('columnas local_id:', col.rows[0].n, '(esperado 4)');
    console.log('indices unicos:   ', idx.rows[0].n, '(esperado 4)');
    console.table(fn.rows);

    // nargs esperados tras agregar p_local_id: reg_mov 10, abrir 8, crear_res 9, asignar 11, reg_tx 11, pase 10
    const want = { registrar_movimiento:10, abrir_operacion:8, crear_reserva:9, asignar_reserva:11, registrar_transaccion:11, pase_desde_reserva:10 };
    const fnOk = fn.rows.length === 6 && fn.rows.every(r => r.pronargs === want[r.proname]);
    const ok = col.rows[0].n === 4 && idx.rows[0].n === 4 && fnOk;

    if (ok) { await c.query('commit'); console.log('\n✅ COMMIT — migración idempotencia aplicada y verificada.'); }
    else    { await c.query('rollback'); console.log('\n❌ ROLLBACK — verificación falló, nada se cambió.'); process.exitCode = 1; }
  } catch (e) {
    await c.query('rollback').catch(() => {});
    console.error('❌ ERROR, rollback:', e.message);
    process.exitCode = 1;
  } finally { await c.end(); }
})();
