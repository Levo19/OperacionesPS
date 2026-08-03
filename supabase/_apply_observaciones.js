// OBSERVACIONES OPCIONALES en el CPE (dueño 2026-08-02): nuevo p_observaciones en
// emitir_comprobante — se antepone a la nota "Medio de pago" en el campo observaciones
// de NubeFact (sale impreso en el PDF; SUNAT no lo valida) y se guarda en BD.
// OJO firma: agregar un parámetro crea OVERLOAD → DROP de la firma vieja + CREATE en la misma tx.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
const row=(await c.query("select pg_get_functiondef(p.oid) d, pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows;
chk('un solo overload', row.length===1);
let edef=row[0].d; const ident=row[0].a;
// 1) firma: p_observaciones al final
const H="p_credito_venc date DEFAULT NULL::date)";
chk('anchor firma', edef.includes(H));
edef=edef.replace(H, "p_credito_venc date DEFAULT NULL::date, p_observaciones text DEFAULT NULL::text)");
// 2) v_obs: obs del admin ANTES de la nota de medio de pago
const O="v_obs := case when coalesce(trim(p_medio_pago),'') <> '' then 'Medio de pago: '||p_medio_pago else null end;";
chk('anchor v_obs', edef.includes(O));
edef=edef.replace(O, "v_obs := nullif(concat_ws(' · ', nullif(trim(coalesce(p_observaciones,'')),''), case when coalesce(trim(p_medio_pago),'') <> '' then 'Medio de pago: '||p_medio_pago else null end), '');");
// 3) insert BD: columna observaciones
const C1='total_igv,total,total_gratuita,items,'; const V1='v_igv,v_total,coalesce(v_gratis,0),p_items,';
chk('anchor insert cols/vals', edef.includes(C1)&&edef.includes(V1));
edef=edef.replace(C1,'total_igv,total,total_gratuita,observaciones,items,');
edef=edef.replace(V1,"v_igv,v_total,coalesce(v_gratis,0),nullif(trim(coalesce(p_observaciones,'')),''),p_items,");
if(!pass){console.log('✗ anchors — no se tocó nada');process.exit(1);}
await c.query('begin');
await c.query("alter table comprobantes add column if not exists observaciones text");
await c.query(`drop function public.emitir_comprobante(${ident})`);
await c.query(edef);
// ── tests demo (autorizado por el dueño) ──
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
const uid=Date.now().toString(36);
// T1: boleta con observaciones → aceptada + BD la guarda
const t1=(await c.query(`select emitir_comprobante(p_tipo:=2,p_serie:='BBB1',p_cliente_doc_tipo:='0',p_cliente_doc:='',p_cliente_nombre:='VARIOS',p_cliente_email:=null,
  p_items:='[{"descripcion":"Tour Islas Ballestas","cantidad":2,"precio":25}]'::jsonb,
  p_creado_por:='test-obs',p_local_id:='obs-${uid}',p_observaciones:='Servicio 02/08 · Delfín · 12 pax') j`)).rows[0].j;
chk('T1 boleta con obs → aceptada', t1.estado==='aceptada', {num:t1.serie+'-'+t1.numero});
const bd=(await c.query("select observaciones o from comprobantes where local_id=$1",["obs-"+uid])).rows[0];
chk('T1 BD guarda observaciones', bd && bd.o==='Servicio 02/08 · Delfín · 12 pax', bd);
// T2: regresión SIN p_observaciones (como llaman muelle/zarpe) → default null, sigue OK
const t2=(await c.query(`select emitir_comprobante(p_tipo:=2,p_serie:='BBB1',p_cliente_doc_tipo:='0',p_cliente_doc:='',p_cliente_nombre:='VARIOS',p_cliente_email:=null,
  p_items:='[{"descripcion":"Tour Islas Ballestas","cantidad":1,"precio":25}]'::jsonb,
  p_creado_por:='test-obs',p_local_id:='obsreg-${uid}') j`)).rows[0].j;
chk('T2 regresión sin obs → aceptada', t2.estado==='aceptada', {num:t2.serie+'-'+t2.numero});
const bd2=(await c.query("select observaciones o from comprobantes where local_id=$1",["obsreg-"+uid])).rows[0];
chk('T2 BD observaciones null', bd2 && bd2.o===null);
// T3: obs + medio de pago conviven ('obs · Medio de pago: X') — solo boleta chica demo
const t3=(await c.query(`select emitir_comprobante(p_tipo:=2,p_serie:='BBB1',p_cliente_doc_tipo:='0',p_cliente_doc:='',p_cliente_nombre:='VARIOS',p_cliente_email:=null,
  p_items:='[{"descripcion":"Tour","cantidad":1,"precio":25}]'::jsonb,p_medio_pago:='Efectivo',
  p_creado_por:='test-obs',p_local_id:='obs3-${uid}',p_observaciones:='Nota admin') j`)).rows[0].j;
chk('T3 obs+medio → aceptada', t3.estado==='aceptada', {num:t3.serie+'-'+t3.numero});
if(!pass){await c.query('rollback');console.log('\n✗ FALLÓ — rollback, PROD intacto');process.exit(1);}
await c.query('commit');
fs.writeFileSync('facturacion_observaciones.sql','-- Observaciones opcionales del admin en el CPE (2026-08-02) — generado del vivo + parche\n'+edef+';\n');
console.log('\n★ OBSERVACIONES habilitadas en PROD');
process.exit(0);
}catch(e){try{await c.query('rollback');}catch(_){}
console.error('ERROR:',e.message);process.exit(1);}finally{await c.end();}})();
