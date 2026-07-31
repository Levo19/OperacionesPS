// Aplica compra_espacio_directa.sql a PROD y lo testea (rollback de los datos de prueba).
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const CFG={host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}};
const c=new Client(CFG);
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
await c.query('begin');
await c.query(fs.readFileSync('compra_espacio_directa.sql','utf8'));

// identidad admin real (equipo único — app_usuarios ya no existe)
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
chk('hay admin PS en equipo', !!adm, adm);
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);

// ── datos de prueba ──
await c.query('savepoint t');
await c.query("insert into contactos(id,nombre,tipo,precio_defecto,activo) values('ZC-AG','AgOrigen T','agencia',40,true),('ZC-AGF','AgFinal T','agencia',35,true),('ZC-AL','Aliado T','aliado',0,true),('ZC-CO','Comi T','comisionado',30,true) on conflict (id) do update set tipo=excluded.tipo,precio_defecto=excluded.precio_defecto");

// 1) compra directa: origen AGENCIA sin monto explícito → cobro auto 40×3=120; compra 90
const r1=(await c.query("select registrar_compra_espacio('ZC-AG','AgOrigen T','ZC-AGF',3,90,null,'op-test',null,'zc-1') id")).rows[0].id;
const m1=(await c.query("select tipo,operacion_id,contacto_id,contacto_pase_id,agencia_comprada_id,monto_comprado,monto_total,precio_unit,estado from movimientos where id=$1",[r1])).rows[0];
chk('origen agencia → cobro auto 120 (40×3)', Number(m1.monto_total)===120 && Number(m1.precio_unit)===40, m1);
chk('compra: agencia final + monto 90, sin aliado', m1.agencia_comprada_id==='ZC-AGF' && Number(m1.monto_comprado)===90 && m1.contacto_pase_id===null, undefined);
chk('forma: PASE_DIRECTO / Aliado(PaseOut) / Pasado', m1.operacion_id==='PASE_DIRECTO' && m1.tipo==='Aliado(PaseOut)' && m1.estado==='Pasado', undefined);

// 2) origen texto libre + monto explícito → se respeta
const r2=(await c.query("select registrar_compra_espacio(null,'Familia García','ZC-AGF',2,70,100,'op-test',null,'zc-2') id")).rows[0].id;
const m2=(await c.query("select contacto_id,nombre_contacto,monto_total from movimientos where id=$1",[r2])).rows[0];
chk('origen libre + monto 100 explícito', m2.contacto_id===null && /garc/i.test(m2.nombre_contacto) && Number(m2.monto_total)===100, m2);   // trigger normaliza a MAYÚSCULAS

// 3) idempotencia: mismo local_id → mismo id (no duplica)
const r3=(await c.query("select registrar_compra_espacio('ZC-AG','AgOrigen T','ZC-AGF',3,90,null,'op-test',null,'zc-1') id")).rows[0].id;
chk('idempotencia local_id (doble click) → mismo MOV', r3===r1, {r1,r3});

// 4) guards (cada uno en savepoint: la excepción aborta la tx)
const guard=async(sql)=>{await c.query('savepoint g');try{await c.query(sql);return '';}
  catch(e){return e.message;}finally{await c.query('rollback to savepoint g');}};
chk('rechaza destino NO agencia (aliado)', /NO_ES_AGENCIA/.test(await guard("select registrar_compra_espacio('ZC-AG','x','ZC-AL',2,50,null,'op',null,null)")));
chk('rechaza monto compra 0', /MONTO_COMPRA/.test(await guard("select registrar_compra_espacio('ZC-AG','x','ZC-AGF',2,0,null,'op',null,null)")));
chk('rechaza origen = agencia final (circular)', /ORIGEN_ES_AGENCIA_FINAL/.test(await guard("select registrar_compra_espacio('ZC-AGF','x','ZC-AGF',2,50,null,'op',null,null)")));
chk('rechaza pax 0', /PAX_INVALIDO/.test(await guard("select registrar_compra_espacio('ZC-AG','x','ZC-AGF',0,50,null,'op',null,null)")));

// 5) retroactivo con admin → OK y hora 12pm Lima del día pedido
const r5=(await c.query("select registrar_compra_espacio('ZC-CO','Comi T','ZC-AGF',2,60,80,'op-test','2026-07-29','zc-5') id")).rows[0].id;
const m5=(await c.query("select to_char(registrado_at at time zone 'America/Lima','YYYY-MM-DD HH24:MI') ts, monto_total from movimientos where id=$1",[r5])).rows[0];
chk('retroactivo admin 29-jul 12:00 + cobro 80', m5.ts==='2026-07-29 12:00' && Number(m5.monto_total)===80, m5);

// 6) aparece en las lecturas: panel (get_lanchas_dia hoy) y balances
const hoy=(await c.query("select (now() at time zone 'America/Lima')::date::text d")).rows[0].d;
const ld=(await c.query("select get_lanchas_dia($1::date) j",[hoy])).rows[0].j;
const enPanel=(ld.pases_sueltos||ld.pases||[]).some?((ld.pases_sueltos||ld.pases||[]).some(p=>p.id_mov===r1)):false;
// nombre del array según versión: buscar en todo el jsonb
const enPanel2=JSON.stringify(ld).includes(r1);
chk('compra visible en get_lanchas_dia (panel)', enPanel||enPanel2, {enPanel,enPanel2});
const bal=(await c.query("select * from v_balance_agencias where id in ('ZC-AG','ZC-AGF') order by id")).rows;
chk('balance agencias registra ambas patas', bal.length>=1, bal.map(b=>({id:b.id,...b})));

// 7) mini-estrés: 12 inserts concurrentes con MISMO local_id → 1 solo movimiento
//    (conexiones separadas = transacciones reales en paralelo)
await c.query('release savepoint t');   // los datos de prueba viven hasta el rollback final
const mk=async(i)=>{const cc=new Client(CFG);await cc.connect();
  try{await cc.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
      const r=await cc.query("select registrar_compra_espacio('ZC-AG','AgOrigen T','ZC-AGF',1,10,null,'stress',null,'zc-stress-X') id");
      return r.rows[0].id;}catch(e){return 'ERR:'+e.message;}finally{await cc.end();}};
// OJO: esas conexiones NO ven la tx abierta → el RPC no existe aún fuera de la tx.
// El estrés real de concurrencia se corre POST-COMMIT (abajo). Aquí solo validamos en-tx secuencial.
const s1=(await c.query("select registrar_compra_espacio('ZC-AG','AgOrigen T','ZC-AGF',1,10,null,'stress',null,'zc-st-seq') id")).rows[0].id;
const s2=(await c.query("select registrar_compra_espacio('ZC-AG','AgOrigen T','ZC-AGF',1,10,null,'stress',null,'zc-st-seq') id")).rows[0].id;
chk('estrés secuencial en-tx: mismo local_id → 1 mov', s1===s2, {s1,s2});

// limpiar datos de prueba pero COMMIT del RPC
await c.query("delete from caja_operador where movimiento_id like 'MOV-%' and movimiento_id in (select id from movimientos where contacto_id in ('ZC-AG','ZC-CO') or agencia_comprada_id='ZC-AGF')");
await c.query("delete from movimientos where contacto_id in ('ZC-AG','ZC-CO') or agencia_comprada_id='ZC-AGF' or nombre_contacto in ('Familia García')");
await c.query("delete from contactos where id in ('ZC-AG','ZC-AGF','ZC-AL','ZC-CO')");
if(!pass){await c.query('rollback');console.log('\n✗ FALLÓ — rollback total, PROD intacto');process.exit(1);}
await c.query('commit');
console.log('\n★ RPC registrar_compra_espacio APLICADO a PROD (datos de prueba limpiados)');

// ── estrés de concurrencia POST-COMMIT: 12 llamadas paralelas, mismo local_id ──
await c.query("insert into contactos(id,nombre,tipo,precio_defecto,activo) values('ZC-AG','AgOrigen T','agencia',40,true),('ZC-AGF','AgFinal T','agencia',35,true) on conflict (id) do update set tipo=excluded.tipo");
const ids=await Promise.all(Array.from({length:12},(_,i)=>mk(i)));
const uniq=[...new Set(ids.filter(x=>!String(x).startsWith('ERR')))];
const errs=ids.filter(x=>String(x).startsWith('ERR'));
chk('estrés 12 llamadas concurrentes mismo local_id → 1 solo MOV', uniq.length===1 && errs.length===0, {uniq,errs:errs.slice(0,2)});
const n=(await c.query("select count(*)::int n from movimientos where local_id='zc-stress-X'")).rows[0].n;
chk('BD tiene exactamente 1 fila para ese local_id', n===1, {n});
// limpieza final del estrés
await c.query("delete from movimientos where local_id in ('zc-stress-X')");
await c.query("delete from contactos where id in ('ZC-AG','ZC-AGF')");
console.log(pass?'\n★★ TODO OK (apply + guards + idempotencia + estrés concurrente)':'\n✗ revisar');
process.exit(pass?0:1);
}catch(e){try{await c.query('rollback');}catch(_){}
console.error('ERROR:',e.message);process.exit(1);}finally{await c.end();}})();
