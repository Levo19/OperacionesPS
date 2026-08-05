// BAJO-2 (revisión 500x): la NC enviaba a NubeFact `total = v_o.total`. Para un comprobante LEGACY
// cuyo `total` almacenado incluyera la cortesía, mandar total (con gratuito) + total_gratuita (otra
// vez) descuadra → NubeFact rechaza esa NC. Fix robusto: el total de la NC = SUMA DE BUCKETS
// (gravada+exonerada+inafecta+igv), que SIEMPRE excluye la cortesía y coincide con lo que NubeFact
// recompone. Para comprobantes actuales es idéntico a v_o.total (no cambia nada); solo corrige legacy.
// Mismo signature → CREATE OR REPLACE.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef('public.emitir_nota_credito'::regproc) d")).rows[0].d;

// declarar v_nctot
const DECL='v_try int; v_errlow text; v_ncgra numeric;';
chk('anchor declare', d.includes(DECL));
d=d.replace(DECL, 'v_try int; v_errlow text; v_ncgra numeric; v_nctot numeric;');
// calcular v_nctot justo tras v_ncgra
const GRA="into v_ncgra from jsonb_array_elements(v_o.items) i where coalesce(i->>'afectacion','')='gratuito';";
chk('anchor compute v_ncgra', d.includes(GRA));
d=d.replace(GRA, GRA+"\n  v_nctot := round(coalesce(v_o.total_gravada,0)+coalesce(v_o.total_exonerada,0)+coalesce(v_o.total_inafecta,0)+coalesce(v_o.total_igv,0),2);");
// body de NubeFact: total = v_nctot
const BODY="'total', v_o.total,";
chk('anchor body total (1)', (d.split(BODY).length-1)===1);
d=d.split(BODY).join("'total', v_nctot,");
// inserts (real+stub): la fila-NC también con v_nctot
const INS='v_o.total,coalesce(v_ncgra,0)';
chk('anchor inserts total (2)', (d.split(INS).length-1)===2);
d=d.split(INS).join('v_nctot,coalesce(v_ncgra,0)');

if(!pass){console.log('✗ anchors — no se tocó nada (¿ya aplicado?)');process.exit(1);}
await c.query('begin');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
const back=(await c.query("select pg_get_functiondef('public.emitir_nota_credito'::regproc) d")).rows[0].d;
chk('v_nctot declarado+calculado', back.includes('v_nctot numeric;') && back.includes('v_nctot := round(coalesce(v_o.total_gravada,0)'));
chk("body usa v_nctot", back.includes("'total', v_nctot,"));
chk('inserts usan v_nctot x2', (back.split('v_nctot,coalesce(v_ncgra,0)').length-1)===2);
chk('sin v_o.total residual en body/insert', !back.includes("'total', v_o.total,") && !back.includes('v_o.total,coalesce(v_ncgra,0)'));
chk('A4 for update + A6 total_gratuita intactos', back.includes('where id = p_ref_id for update;') && back.includes("v_body || jsonb_build_object('total_gratuita', v_ncgra)"));
// smoke: NC-de-NC bloqueada (compila + guard)
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
if(adm){ await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
  await c.query('savepoint t');
  const nc=(await c.query("insert into comprobantes(tipo,serie,numero,moneda,cliente_doc_tipo,cliente_doc,cliente_nombre,total,items,estado,origen) values(3,'ZZ9',999997,'PEN','6','20131312955','T',10,'[]'::jsonb,'aceptada','panel') returning id")).rows[0];
  let raised=false; try{ await c.query('select emitir_nota_credito($1,1,$2)',[nc.id,'smoke']); }catch(e){ raised=/NO_NC_DE_NC/.test(e.message); }
  chk('smoke: compila + guard tipo=3', raised);
  await c.query('rollback to savepoint t');
}
if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
console.log('\n★ emitir_nota_credito: total de NC = suma de buckets (robusto a legacy con cortesía) — COMMIT');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
