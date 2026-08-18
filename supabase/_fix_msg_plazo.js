// plpgsql usa % (no %s) → el mensaje salía "la facturas solo admite…"
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
const args=(await c.query("select pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].a;
if(!d.includes("FECHA_FUERA_DE_PLAZO: %s solo admite")){console.log('✗ anchor');process.exit(1);}
d=d.replace("FECHA_FUERA_DE_PLAZO: %s solo admite","FECHA_FUERA_DE_PLAZO: % solo admite");
await c.query('begin');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:adm.u,role:'authenticated'})]);
try{ await c.query('savepoint s');
  await c.query("select emitir_comprobante(p_tipo=>1,p_serie=>'FFF1',p_cliente_doc_tipo=>'6',p_cliente_doc=>'20000000001',p_cliente_nombre=>'E',p_cliente_email=>'',p_items=>'[{\"descripcion\":\"T\",\"cantidad\":1,\"precio\":20}]'::jsonb,p_exonerado=>false,p_moneda=>'PEN',p_origen=>'panel',p_operacion_ref=>null,p_creado_por=>'smoke',p_local_id=>'smoke-msg',p_cliente_tel=>'',p_cliente_dir=>'D',p_es_extranjero=>false,p_medio_pago=>'Efectivo',p_exportacion=>false,p_detraccion=>false,p_forma_pago=>'CONTADO',p_credito_venc=>null,p_observaciones=>null,p_fecha_emision=>((now() at time zone 'America/Lima')::date - 9))");
  console.log('✗ no lanzó'); process.exit(1);
}catch(e){ await c.query('rollback to savepoint s');
  const ok=/la factura solo admite hasta 3/.test(e.message);
  console.log((ok?'✓':'✗')+' mensaje: '+e.message.slice(0,72)); if(!ok){await c.query('rollback');process.exit(1);} }
await c.query('commit');
const c2=mk();await c2.connect();
const f=(await c2.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
await c2.end();
console.log('[fresca] corregido: '+!/%s solo admite/.test(f));
console.log('★ mensaje de plazo corregido — COMMIT');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
