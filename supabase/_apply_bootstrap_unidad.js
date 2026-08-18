// get_facturacion_bootstrap no proyectaba `unidad` en servicios → el picker del muelle no sabía si
// un ítem es servicio (ZZ) o bien (NIU) y todo caía al fallback. Se agrega el campo (solo lectura).
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+JSON.stringify(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef('public.get_facturacion_bootstrap'::regproc) d")).rows[0].d;
const OLD="jsonb_build_object('id',id,'nombre',nombre,'precio',precio_defecto)";
chk('anchor servicios (1 vez)', d.split(OLD).length-1===1);
d=d.replace(OLD,"jsonb_build_object('id',id,'nombre',nombre,'precio',precio_defecto,'unidad',coalesce(unidad,'ZZ'))");
if(!pass)process.exit(1);
await c.query('begin');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:adm.u,role:'authenticated'})]);
const b=(await c.query('select get_facturacion_bootstrap() d')).rows[0].d;
chk('bootstrap devuelve unidad en todos los servicios', Array.isArray(b.servicios) && b.servicios.length>0 && b.servicios.every(s=>s.unidad==='ZZ'), {n:b.servicios.length, muestra:b.servicios[0]});
if(!pass){await c.query('rollback');process.exit(1);}
await c.query('commit');
const c2=mk();await c2.connect();
const f=(await c2.query("select pg_get_functiondef('public.get_facturacion_bootstrap'::regproc) d")).rows[0].d;
await c2.end();
console.log("\n[fresca] unidad en bootstrap: "+f.includes("'unidad'"));
if(!f.includes("'unidad'"))process.exit(1);
console.log('★ bootstrap con unidad — COMMIT verificado');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
