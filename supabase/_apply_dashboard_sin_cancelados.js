// get_dashboard: v_pases NO debe enviar pases CANCELADOS (2026-08-01).
// El operador anulaba un pase → BD Cancelado ✓ → pero el refresh lo re-pintaba en OPS
// (render sin filtro de estado) con botón "Anular" como si viviera. Parche sobre la def VIVA.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
const def=(await c.query("select pg_get_functiondef('get_dashboard()'::regprocedure) d")).rows[0].d;
// v_pases: where (contacto_pase_id<>'' or agencia_comprada_id<>'') and fecha = hoy → añadir filtro estado
const MARK=/where \(coalesce\(m\.contacto_pase_id,''\)<>'' or coalesce\(m\.agencia_comprada_id,''\)<>''\)/;
chk('encontrado el WHERE de v_pases', MARK.test(def));
if(!MARK.test(def)){process.exit(1);}
const out=def.replace(MARK, (s)=> s + "\n      and lower(coalesce(m.estado,'')) not like '%cancel%'");
chk('filtro de cancelados insertado', /not like '%cancel%'/.test(out) && out!==def);
await c.query('begin');
await c.query(out);
// verificar con el dato REAL del incidente: MOV-1000735 (Cancelado) fuera; los demás 8 dentro
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
const d=(await c.query("select get_dashboard() j")).rows[0].j;
const pases=d.pases_externos||[];
const ids=pases.map(p=>p.id);
chk('MOV-1000735 (Cancelado) YA NO viaja a OPS', !ids.includes('MOV-1000735'), undefined);
chk('los 8 pases vivos siguen viajando', ['MOV-1000723','MOV-1000724','MOV-1000725','MOV-1000734','MOV-1000736','MOV-1000737','MOV-1000739','MOV-1000740'].every(x=>ids.includes(x)), {n:pases.length});
const paxTot=pases.reduce((s,p)=>s+(parseInt(p.pax)||0),0);
chk('pax total ahora 30 (antes 38)', paxTot===30, {paxTot});
if(!pass){await c.query('rollback');console.log('\n✗ FALLÓ — rollback, PROD intacto');process.exit(1);}
await c.query('commit');
fs.writeFileSync('dashboard_sin_cancelados.sql','-- get_dashboard sin pases cancelados (2026-08-01) — generado del vivo + parche\n'+out+';\n');
console.log('\n★ get_dashboard sin cancelados APLICADO a PROD (def guardada)');
process.exit(0);
}catch(e){try{await c.query('rollback');}catch(_){}
console.error('ERROR:',e.message);process.exit(1);}finally{await c.end();}})();
