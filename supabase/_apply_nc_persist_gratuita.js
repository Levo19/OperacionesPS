// BAJO-1 (revisión 500x de fixes): emitir_nota_credito envía total_gratuita a NubeFact (A6) pero el
// INSERT de la fila-NC no la persistía → comprobantes.total_gratuita quedaba NULL en la NC (el doc
// legal es correcto; solo un reporte que lea esa columna subestimaría). Se agrega a AMBOS inserts
// (real + stub) con coalesce(v_ncgra,0). Cambio aditivo, misma firma → CREATE OR REPLACE.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef('public.emitir_nota_credito'::regproc) d")).rows[0].d;
const colFrom='total_igv,total,items,', colTo='total_igv,total,total_gratuita,items,';
const valFrom='v_o.total_igv,v_o.total,v_o.items,', valTo='v_o.total_igv,v_o.total,coalesce(v_ncgra,0),v_o.items,';
const nCol=d.split(colFrom).length-1, nVal=d.split(valFrom).length-1;
chk('2 listas de columnas (real+stub)', nCol===2, nCol);
chk('2 listas de valores (real+stub)', nVal===2, nVal);
d=d.split(colFrom).join(colTo).split(valFrom).join(valTo);
chk('no re-agrega si ya estaba (idempotencia)', (d.split('total_gratuita,items,').length-1)===2 && (d.split('coalesce(v_ncgra,0),v_o.items,').length-1)===2);
if(!pass){console.log('✗ anchors — no se tocó nada (¿ya aplicado?)');process.exit(1);}
await c.query('begin');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
const back=(await c.query("select pg_get_functiondef('public.emitir_nota_credito'::regproc) d")).rows[0].d;
chk('total_gratuita en columnas x2', (back.split('total_gratuita,items,').length-1)===2);
chk('coalesce(v_ncgra,0) en valores x2', (back.split('coalesce(v_ncgra,0),v_o.items,').length-1)===2);
chk('A4 for update intacto', back.includes('where id = p_ref_id for update;'));
chk('A6 body total_gratuita intacto', back.includes("v_body || jsonb_build_object('total_gratuita', v_ncgra)"));
// smoke: NC-de-NC sigue bloqueada (compilación + guard OK)
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
if(adm){ await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
  await c.query('savepoint t');
  const nc=(await c.query("insert into comprobantes(tipo,serie,numero,moneda,cliente_doc_tipo,cliente_doc,cliente_nombre,total,items,estado,origen) values(3,'ZZ9',999998,'PEN','6','20131312955','TEST',10,'[]'::jsonb,'aceptada','panel') returning id")).rows[0];
  let raised=false; try{ await c.query('select emitir_nota_credito($1,1,$2)',[nc.id,'smoke']); }catch(e){ raised=/NO_NC_DE_NC/.test(e.message); }
  chk('smoke: compila y guard tipo=3 dispara', raised);
  await c.query('rollback to savepoint t');
}
if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
console.log('\n★ emitir_nota_credito: total_gratuita ahora se persiste en la fila-NC — COMMIT');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
