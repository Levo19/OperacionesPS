// FIX emitir_nota_credito (revisión 500x):
//  A4 · el SELECT del comprobante referenciado sin FOR UPDATE → el chequeo de estado corría sobre
//       un snapshot stale y dos NC concurrentes sobre la MISMA factura podían emitir ambas
//       (acreditar dos veces). Con FOR UPDATE la 2ª TX espera y relee estado='anulada' → SOLO_ACEPTADAS.
//  A6 · una NC de un comprobante con línea de CORTESÍA (afectacion 'gratuito') incluía esa línea en
//       `items` (_nf_items la marca tipo_de_igv 11) pero el header NO enviaba `total_gratuita` (la
//       emisión SÍ lo manda, línea 146) → descuadre → NubeFact/SUNAT rechaza la NC. Espejo de la emisión.
// OVERLOAD: no cambia la firma (mismo identity args) → basta CREATE OR REPLACE.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
const row=(await c.query("select pg_get_functiondef(p.oid) d, pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_nota_credito'")).rows;
chk('un solo overload', row.length===1);
let d=row[0].d; const ident=row[0].a;

// A4 · FOR UPDATE sobre el comprobante referenciado
const A4a="select * into v_o from comprobantes where id = p_ref_id;";
chk('anchor A4 (select v_o)', d.includes(A4a));
d=d.replace(A4a, "select * into v_o from comprobantes where id = p_ref_id for update;");

// A6a · declarar v_ncgra
const DECL="v_try int; v_errlow text;";
chk('anchor declare', d.includes(DECL));
d=d.replace(DECL, "v_try int; v_errlow text; v_ncgra numeric;");

// A6b · calcular el total de cortesía del comprobante (tras leer la config)
const CFG="select * into v_cfg from facturacion_config where id=1;";
chk('anchor v_cfg', d.includes(CFG));
d=d.replace(CFG, CFG+"\n  select coalesce(sum(round((i->>'cantidad')::numeric*(i->>'precio')::numeric,2)),0) into v_ncgra from jsonb_array_elements(v_o.items) i where coalesce(i->>'afectacion','')='gratuito';");

// A6c · añadir total_gratuita al body de NubeFact (espejo de la emisión, línea 146)
const ITEMS="'items', _nf_items(v_o.items, coalesce(v_o.exonerado,false), coalesce(v_o.es_exportacion,false)));";
chk('anchor v_body items', d.includes(ITEMS));
d=d.replace(ITEMS, ITEMS+"\n    if coalesce(v_ncgra,0) > 0 then v_body := v_body || jsonb_build_object('total_gratuita', v_ncgra); end if;");

if(!pass){console.log('✗ anchors — no se tocó nada');process.exit(1);}
await c.query('begin');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));   // mismo identity args → replace directo
// smoke: relee la def y confirma los 3 cambios presentes; valida además que CREATE compiló el body (check_function_bodies=on)
const back=(await c.query("select pg_get_functiondef('public.emitir_nota_credito'::regproc) d")).rows[0].d;
chk('for update aplicado', back.includes('where id = p_ref_id for update;'));
chk('v_ncgra declarado', back.includes('v_ncgra numeric;'));
chk('total_gratuita en NC', back.includes("v_body || jsonb_build_object('total_gratuita', v_ncgra)"));
// smoke funcional en savepoint (se descarta): NC de una NC → debe RAISE NO_NC_DE_NC (ejercita _req_admin + select for update)
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
if(adm){ await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
  await c.query('savepoint t');
  const nc=(await c.query("insert into comprobantes(tipo,serie,numero,moneda,cliente_doc_tipo,cliente_doc,cliente_nombre,total,items,estado,origen) values(3,'ZZ9',999999,'PEN','6','20131312955','TEST NC',10,'[]'::jsonb,'aceptada','panel') returning id")).rows[0];
  let raised=false; try{ await c.query('select emitir_nota_credito($1,1,$2)',[nc.id,'smoke']); }catch(e){ raised=/NO_NC_DE_NC/.test(e.message); }
  chk('smoke: NC-de-NC bloqueada (for update + guard OK)', raised);
  await c.query('rollback to savepoint t');
} else console.log('· sin admin para smoke funcional (solo validación de compilación)');

if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK — algo falló, la función NO se cambió');process.exit(1);}
await c.query('commit');
console.log('\n★ emitir_nota_credito parchado (A4 for update + A6 total_gratuita) — COMMIT');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
