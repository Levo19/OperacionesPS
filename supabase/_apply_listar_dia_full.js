// listar_comprobantes_dia debe traer los campos para renderizar el TICKET 80mm en OPS
// (imagen + PDF para compartir): items, desglose de totales, hash, qr, observaciones, etc.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
let pass=true;const chk=(l,ok,g)=>{console.log((ok?'✓':'✗')+' '+l+(g!==undefined?'  → '+JSON.stringify(g):''));if(!ok)pass=false;};
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='listar_comprobantes_dia'")).rows[0].d;
const A='cliente_email, cliente_tel, total, estado,';
chk('anchor', d.includes(A));
chk('aun sin items', !/\bitems\b/.test(d));
d=d.replace(A, A+`
      cliente_doc_tipo, moneda, forma_pago, medio_pago, credito_vencimiento, es_exportacion,
      total_gravada, total_exonerada, total_inafecta, total_exportacion, total_igv, total_gratuita,
      items, hash, qr, observaciones, creado_por,`);
if(!pass){console.log('sin cambios');process.exit(1);}
await c.query('begin'); await c.query(d);
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:adm.u,role:'authenticated'})]);
const lst=(await c.query("select listar_comprobantes_dia(null) j")).rows[0].j;
chk('proyecta items+hash+obs', Array.isArray(lst) && (lst.length===0 || (('items' in lst[0]) && ('hash' in lst[0]) && ('observaciones' in lst[0]))), lst[0]?Object.keys(lst[0]).length+' cols':'lista vacía (ok)');
if(!pass){await c.query('rollback');process.exit(1);}
await c.query('commit');
fs.writeFileSync('facturacion_listar_dia_full.sql','-- listar_comprobantes_dia + datos de ticket para compartir (2026-08-03)\n'+d+';\n');
console.log('\n★ listar_comprobantes_dia trae los datos del ticket');process.exit(0);
}catch(e){try{await c.query('rollback');}catch(_){}console.error('ERR',e.message);process.exit(1);}finally{await c.end();}})();
