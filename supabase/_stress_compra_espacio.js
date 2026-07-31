// Estrés POST-COMMIT del RPC registrar_compra_espacio (ya aplicado):
// 12 llamadas CONCURRENTES (conexiones separadas) con el MISMO local_id → debe quedar 1 solo MOV.
// + 30 llamadas concurrentes con local_id distintos → 30 movs (throughput sano).
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const CFG={host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}};
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{
const c=new Client(CFG);await c.connect();
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("insert into contactos(id,nombre,tipo,precio_defecto,activo) values('ZS-AG','StressOrigen','agencia',40,true),('ZS-AGF','StressFinal','agencia',35,true) on conflict (id) do update set tipo=excluded.tipo,activo=true");
const call=async(localId)=>{const cc=new Client(CFG);await cc.connect();
  try{await cc.query("select set_config('request.jwt.claims',$1,false)",[J({sub:adm.u,role:'authenticated'})]);   // false = sesión
      const r=await cc.query("select registrar_compra_espacio('ZS-AG','StressOrigen','ZS-AGF',1,10,null,'stress',null,$1) id",[localId]);
      return r.rows[0].id;}catch(e){return 'ERR:'+e.message;}finally{await cc.end();}};
// A) 12 concurrentes, MISMO local_id
const t0=Date.now();
const a=await Promise.all(Array.from({length:12},()=>call('zs-same-1')));
const aU=[...new Set(a.filter(x=>!String(x).startsWith('ERR')))], aE=a.filter(x=>String(x).startsWith('ERR'));
chk('A) 12 concurrentes mismo local_id → 1 MOV, 0 errores', aU.length===1&&aE.length===0, {movs:aU,errs:aE.slice(0,2),ms:Date.now()-t0});
const nA=(await c.query("select count(*)::int n from movimientos where local_id='zs-same-1'")).rows[0].n;
chk('A) BD: exactamente 1 fila', nA===1, {n:nA});
// B) 30 llamadas en tandas de 10 concurrentes (el pooler limita a 15 clientes en session mode)
const t1=Date.now();
const b=[];
for(let lote=0;lote<3;lote++){
  const r=await Promise.all(Array.from({length:10},(_,i)=>call('zs-diff-'+(lote*10+i))));
  b.push(...r);
}
const bOK=b.filter(x=>!String(x).startsWith('ERR'));
chk('B) 30 concurrentes distintos → 30 MOVs, 0 errores', bOK.length===30&&new Set(bOK).size===30, {ok:bOK.length,ms:Date.now()-t1});
const nB=(await c.query("select count(*)::int n from movimientos where local_id like 'zs-diff-%'")).rows[0].n;
chk('B) BD: 30 filas', nB===30, {n:nB});
// C) balance consistente tras el estrés: le_debo a StressFinal = 12? no: 1×10 (A) + 30×10 (B) = 310
const bal=(await c.query("select le_debo from v_balance_agencias where id='ZS-AGF'")).rows[0];
chk('C) balance le_debo = 310 (31 compras × S/10)', Number(bal.le_debo)===310, bal);
// limpieza total
await c.query("delete from movimientos where local_id='zs-same-1' or local_id like 'zs-diff-%'");
await c.query("delete from contactos where id in ('ZS-AG','ZS-AGF')");
const left=(await c.query("select count(*)::int n from movimientos where contacto_id='ZS-AG' or agencia_comprada_id='ZS-AGF'")).rows[0].n;
chk('limpieza: 0 restos en PROD', left===0, {left});
console.log(pass?'\n★ ESTRÉS OK — idempotencia bajo concurrencia real + throughput + balance':'\n✗ revisar');
await c.end();process.exit(pass?0:1);})().catch(e=>{console.error('ERROR:',e.message);process.exit(1);});
