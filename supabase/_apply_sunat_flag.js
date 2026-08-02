// "Aceptada" ≠ "aceptada por SUNAT": boletas van por Resumen Diario y quedan válidas (PDF)
// antes de que SUNAT las acepte. Fix: (1) reconciliar re-consulta también las 'aceptada' sin
// flag SUNAT y guarda el flag VERAZ (no true por tener PDF); (2) listar_comprobantes proyecta
// aceptada_por_sunat para que el panel distinga.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
// ── reconciliar: WHERE amplio + flag veraz ──
let rdef=(await c.query("select pg_get_functiondef('reconciliar_comprobantes(integer)'::regprocedure) d")).rows[0].d;
const W="where estado in ('pendiente','rechazada')";
chk('anchor WHERE reconciliar', rdef.includes(W));
rdef=rdef.replace(W, "where (estado in ('pendiente','rechazada') or (estado='aceptada' and coalesce(aceptada_por_sunat,false)=false))");
const SETA="update comprobantes set estado='aceptada', aceptada_por_sunat=true,";
chk('anchor SET reconciliar', rdef.includes(SETA));
rdef=rdef.replace(SETA, "update comprobantes set estado='aceptada', aceptada_por_sunat=coalesce((v_j->>'aceptada_por_sunat')::boolean,false),");
// ── listar: proyectar el flag ──
let ldef=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='listar_comprobantes' limit 1")).rows[0].d;
const LP="items, estado, enlace_pdf,";
chk('anchor listar', ldef.includes(LP));
ldef=ldef.replace(LP, "items, estado, aceptada_por_sunat, enlace_pdf,");
await c.query('begin');
await c.query(rdef); await c.query(ldef);
// ── tests en vivo ──
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
const rec=(await c.query("select reconciliar_comprobantes(3) j")).rows[0].j;
chk('reconciliar ahora revisa las boletas válidas-sin-SUNAT (revisados>=4)', Number(rec.revisados)>=4, rec);
const st=(await c.query("select serie||'-'||numero d, estado, aceptada_por_sunat from comprobantes where (serie='BBB1' and numero>=11) or (serie='FFF1' and numero>=16) order by serie,numero")).rows;
const boletasOk=st.filter(x=>x.d.startsWith('BBB1')).every(x=>x.estado==='aceptada'&&x.aceptada_por_sunat===false);
const factOk=st.filter(x=>x.d.startsWith('FFF1')).every(x=>x.aceptada_por_sunat===true);
chk('boletas siguen válidas SIN flag SUNAT (demo no procesa RC) — no se pisó a true', boletasOk, st.filter(x=>x.d.startsWith('BBB1')).map(x=>x.d+':'+x.aceptada_por_sunat));
chk('facturas conservan SUNAT=true', factOk);
const lst=(await c.query("select listar_comprobantes() j")).rows[0].j;
chk('listar proyecta aceptada_por_sunat', (lst||[]).some(x=>typeof x.aceptada_por_sunat==='boolean'));
if(!pass){await c.query('rollback');console.log('\n✗ FALLÓ — rollback');process.exit(1);}
await c.query('commit');
fs.writeFileSync('facturacion_sunat_flag.sql','-- flag SUNAT veraz + reconciliar amplio (2026-08-02) — generado del vivo + parche\n'+rdef+';\n\n'+ldef+';\n');
console.log('\n★ FLAG SUNAT VERAZ aplicado a PROD');
process.exit(0);
}catch(e){try{await c.query('rollback');}catch(_){}
console.error('ERROR:',e.message);process.exit(1);}finally{await c.end();}})();
