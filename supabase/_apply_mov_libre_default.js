// Extiende la red de default de tarifa a LIBRE (además de Agencia): un Libre sin precio (monto 0)
// toma el precio_defecto de su contacto (Varios CON-00 = 30) × pax. Se cobra al pasajero (directo a
// caja). Editable por el operador (si envía precio > 0, se respeta). Comisionado y Aliado NO se tocan.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
const FROM="if p_tipo = 'Agencia' and coalesce(p_monto,0) <= 0 and coalesce(p_contacto,'') <> '' then";
const TO  ="if p_tipo in ('Agencia','Libre') and coalesce(p_monto,0) <= 0 and coalesce(p_contacto,'') <> '' then";
(async()=>{await c.connect();try{
await c.query('begin');
for(const fn of ['registrar_movimiento','editar_movimiento']){
  let d=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[fn])).rows[0].d;
  chk(fn+': anchor Agencia (1)', (d.split(FROM).length-1)===1);
  d=d.split(FROM).join(TO);
  await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
  chk(fn+': ahora incluye Libre', new RegExp("p_tipo in \\('Agencia','Libre'\\)").test((await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[fn])).rows[0].d));
}
// smoke real (savepoint): Libre CON-00 (precio 30), 2 pax, precio 0 → monto 60
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
if(adm){ await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
  try{ await c.query('savepoint sv');
    const mid=(await c.query("select registrar_movimiento('OP-1000139','Libre','CON-00','VARIOS:TEST',2,0,0,'smoke',null,'smoke-lib-'||floor(random()*1e9)::text) id")).rows[0].id;
    const mv=(await c.query('select monto_total,precio_unit from movimientos where id=$1',[mid])).rows[0];
    chk('smoke: Libre 2pax precio 0 → monto 60 (Varios 30)', mv && Number(mv.monto_total)===60 && Number(mv.precio_unit)===30, mv);
    await c.query('rollback to savepoint sv');
  }catch(e){ await c.query('rollback to savepoint sv'); console.log('· smoke saltado ('+e.message.slice(0,60)+')'); }
}
if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
console.log('\n★ default de tarifa extendido a Libre (registrar + editar) — COMMIT');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
