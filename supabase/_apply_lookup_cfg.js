// LOOKUP RENIEC/SUNAT — CAUSA RAÍZ del "DNI real no encontrado" (2026-08-03): la config
// estaba VACÍA (lookup_url_dni/ruc null, token ''), consultar_documento devolvía sin_config
// para TODO y el panel lo pintaba como no_encontrado. Fix:
// (1) URLs APISPeru por defecto (públicas, sin secreto) — el TOKEN lo pega el dueño en Ajustes,
// (2) consultar_documento manda el token también por query (?token=) como el Edge MOS probado,
// (3) limpiar clientes.45114935 contaminado por tests demo ("REGRESION NORMAL").
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='consultar_documento'")).rows[0].d;
const A1="select content into v_resp from http(('GET', v_url||v_n, array[http_header('Authorization','Bearer '||v_tok)], NULL, NULL)::http_request);";
chk('anchor http', d.includes(A1));
d=d.replace(A1,"select content into v_resp from http(('GET', v_url||v_n||case when position('?' in v_url)>0 then '&' else '?' end||'token='||v_tok, array[http_header('Authorization','Bearer '||v_tok)], NULL, NULL)::http_request);");
if(!pass){console.log('✗ anchors');process.exit(1);}
await c.query('begin');
await c.query(d);
const u=(await c.query(`update facturacion_config set
  lookup_url_dni = coalesce(nullif(lookup_url_dni,''), 'https://dniruc.apisperu.com/api/v1/dni/'),
  lookup_url_ruc = coalesce(nullif(lookup_url_ruc,''), 'https://dniruc.apisperu.com/api/v1/ruc/')
  where id=1 returning lookup_url_dni, lookup_url_ruc, coalesce(lookup_token,'')<>'' tok`)).rows[0];
chk('T1 URLs por defecto seteadas', /apisperu/.test(u.lookup_url_dni) && /apisperu/.test(u.lookup_url_ruc), u);
// limpiar contaminación de tests demo sobre el DNI REAL del dueño
const del=(await c.query("delete from clientes where doc_numero='45114935' and doc_tipo='1' and nombre in ('REGRESION NORMAL','GRUPO CON TC','CONC PANEL DOS','X Y','SONDA XYZ','GRUPO CON TC PRUEBA') returning nombre")).rows;
chk('T2 limpiado cliente contaminado 45114935', true, del.map(r=>r.nombre));
// comportamiento sin token: motivo sin_config (el front ya lo distingue de no_encontrado)
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
const r=(await c.query("select consultar_documento('45114935','1') j")).rows[0].j;
chk('T3 sin token → motivo sin_config (no un falso no_encontrado)', r && r.ok===false && r.motivo==='sin_config', r);
if(!pass){await c.query('rollback');console.log('\n✗ FALLÓ — rollback');process.exit(1);}
await c.query('commit');
fs.writeFileSync('facturacion_lookup_cfg.sql','-- Lookup APISPeru: URLs default + token por query (2026-08-03) — generado del vivo + parche\n'+d+';\n');
console.log('\n★ LOOKUP CONFIG APLICADO — falta solo el TOKEN APISPeru en Ajustes (dueño)');
process.exit(0);
}catch(e){try{await c.query('rollback');}catch(_){}
console.error('ERROR:',e.message);process.exit(1);}finally{await c.end();}})();
