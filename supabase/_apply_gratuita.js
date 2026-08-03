// CORTESÍA TC (operación GRATUITA): línea con afectacion='gratuito' → tipo_de_igv 11,
// valor referencial completo, IGV 0; doc lleva total_gratuita y el total A COBRAR la excluye.
// Formato VALIDADO contra demo (BBB1-25 aceptada). Parcha defs VIVAS + columna + realineo.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
const guard=async(sql)=>{await c.query('savepoint g');try{await c.query(sql);return '';}catch(e){return e.message;}finally{await c.query('rollback to savepoint g');}};
(async()=>{await c.connect();try{
// ── _nf_items: af 'gratuito' → tipo 11 (montos referenciales; el else ya da sub=tot, igv=0) ──
let ndef=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_nf_items' limit 1")).rows[0].d;
const NTI="case af when 'inafecto' then 9 when 'exonerado' then 8 when 'exportacion' then 16 else 1 end";
chk('anchor tipo_de_igv en _nf_items', ndef.includes(NTI));
ndef=ndef.replace(NTI, "case af when 'inafecto' then 9 when 'exonerado' then 8 when 'exportacion' then 16 when 'gratuito' then 11 else 1 end");

// ── emitir_comprobante ──
let edef=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante' limit 1")).rows[0].d;
// declare
const D='v_err text; v_hash text; v_fpago text; v_venc date;';
chk('anchor declare', edef.includes(D));
edef=edef.replace(D, D+' v_gratis numeric;');
// total rápido pre-validaciones: excluir gratuitas (los umbrales 700/2000 son por lo COBRADO)
const T1="select coalesce(sum(round((i->>'cantidad')::numeric * (i->>'precio')::numeric, 2)), 0) into v_total from jsonb_array_elements(p_items) i;";
chk('anchor total rápido', edef.includes(T1));
edef=edef.replace(T1, "select coalesce(sum(round((i->>'cantidad')::numeric * (i->>'precio')::numeric, 2)), 0) into v_total from jsonb_array_elements(p_items) i where coalesce(i->>'afectacion','') <> 'gratuito';");
// buckets: v_total excluye gratuito + bucket v_gratis
const B1="coalesce(sum(tot),0)\n  into v_grav, v_igv, v_inaf, v_exo, v_export, v_total";
chk('anchor buckets', edef.includes(B1));
edef=edef.replace(B1, "coalesce(sum(case when af <> 'gratuito' then tot else 0 end),0),\n    coalesce(sum(case when af = 'gratuito' then tot else 0 end),0)\n  into v_grav, v_igv, v_inaf, v_exo, v_export, v_total, v_gratis");
// guards de la figura
const G1="-- Detracción (SPOT) 12%";
chk('anchor pre-detracción', edef.includes(G1));
edef=edef.replace(G1, `-- CORTESÍA (op. gratuita): exige al menos una línea COBRADA y no se mezcla con exportación
  if coalesce(v_gratis,0) > 0 then
    if p_exportacion then raise exception 'GRATUITA_NO_EXPORTACION: la cortesía no se mezcla con exportación'; end if;
    if v_total <= 0 then raise exception 'GRATUITA_REQUIERE_LINEA_COBRADA: la cortesía acompaña a una venta (agrega la línea pagada del grupo)'; end if;
  end if;
  -- Detracción (SPOT) 12%`);
// payload: total_gratuita solo si aplica
const P1="'items', _nf_items(p_items, p_exonerado, p_exportacion));";
chk('anchor items payload', edef.includes(P1));
edef=edef.replace(P1, P1+`
    if coalesce(v_gratis,0) > 0 then v_body := v_body || jsonb_build_object('total_gratuita', v_gratis); end if;`);
// insert: columna + valor
const C1='total_igv,total,items,'; const V1='v_igv,v_total,p_items,';
chk('anchor insert cols/vals', edef.includes(C1)&&edef.includes(V1));
edef=edef.replace(C1,'total_igv,total,total_gratuita,items,');
edef=edef.replace(V1,'v_igv,v_total,coalesce(v_gratis,0),p_items,');

// ── listar_comprobantes: proyectar total_gratuita ──
let ldef=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='listar_comprobantes' limit 1")).rows[0].d;
const L1='total_igv, total,';
chk('anchor listar', ldef.includes(L1));
ldef=ldef.replace(L1,'total_igv, total, total_gratuita,');

await c.query('begin');
await c.query("alter table comprobantes add column if not exists total_gratuita numeric default 0");
await c.query(ndef); await c.query(edef); await c.query(ldef);
// realinear tras las sondas del formato (NubeFact: BBB1=25, FFF1=24)
await c.query("update series set correlativo=25 where serie='BBB1' and correlativo<25");
await c.query("update series set correlativo=24 where serie='FFF1' and correlativo<24");

// ── tests E2E por el RPC (demo real) ──
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
const uid=Date.now().toString(36);
// T1: boleta grupo 5 pax pagados + 1 TC cortesía
const t1=(await c.query(`select emitir_comprobante(p_tipo:=2,p_serie:='BBB1',p_cliente_doc_tipo:='1',p_cliente_doc:='45114935',p_cliente_nombre:='GRUPO CON TC',p_cliente_email:=null,
  p_items:='[{"descripcion":"Tour Islas Ballestas","cantidad":5,"precio":25},{"descripcion":"Tour Islas Ballestas — CORTESÍA TC","cantidad":1,"precio":25,"afectacion":"gratuito"}]'::jsonb,
  p_creado_por:='test-tc',p_local_id:='tc-${uid}') j`)).rows[0].j;
chk('T1 boleta con cortesía TC → aceptada', t1.estado==='aceptada', {num:t1.serie+'-'+t1.numero,total:t1.total});
chk('T1 total a cobrar = 125 (5×25, SIN la cortesía)', Number(t1.total)===125, {total:t1.total});
const bd=(await c.query("select total::numeric t, total_gratuita::numeric g, total_igv::numeric i from comprobantes where local_id=$1",["tc-"+uid])).rows[0];
chk('T1 BD: total 125 · gratuita 25 · IGV solo de lo cobrado', Number(bd.t)===125 && Number(bd.g)===25 && Number(bd.i)>18 && Number(bd.i)<20, bd);
// T2/T3 guards
chk('T2 cortesía SOLA rechazada', /GRATUITA_REQUIERE_LINEA_COBRADA/.test(await guard(`select emitir_comprobante(p_tipo:=2,p_serie:='BBB1',p_cliente_doc_tipo:='1',p_cliente_doc:='45114935',p_cliente_nombre:='X Y',p_cliente_email:=null,p_items:='[{"descripcion":"t","cantidad":1,"precio":25,"afectacion":"gratuito"}]'::jsonb)`)));
chk('T3 cortesía en exportación rechazada', /GRATUITA_NO_EXPORTACION/.test(await guard(`select emitir_comprobante(p_tipo:=1,p_serie:='FFF1',p_cliente_doc_tipo:='7',p_cliente_doc:='AB1',p_cliente_nombre:='X Y',p_cliente_email:=null,p_items:='[{"descripcion":"a","cantidad":1,"precio":20},{"descripcion":"b","cantidad":1,"precio":5,"afectacion":"gratuito"}]'::jsonb,p_exportacion:=true)`)));
// T4 regresión: boleta normal sigue OK
const t4=(await c.query(`select emitir_comprobante(p_tipo:=2,p_serie:='BBB1',p_cliente_doc_tipo:='1',p_cliente_doc:='45114935',p_cliente_nombre:='REGRESION NORMAL',p_cliente_email:=null,p_items:='[{"descripcion":"Tour","cantidad":1,"precio":30}]'::jsonb,p_creado_por:='test-tc',p_local_id:='tcreg-${uid}') j`)).rows[0].j;
chk('T4 regresión boleta normal aceptada', t4.estado==='aceptada' && Number(t4.total)===30, {num:t4.serie+'-'+t4.numero});
const lst=(await c.query("select listar_comprobantes() j")).rows[0].j;
chk('listar proyecta total_gratuita', (lst||[]).some(x=>Number(x.total_gratuita)>0));
if(!pass){await c.query('rollback');console.log('\n✗ FALLÓ — rollback, PROD intacto');process.exit(1);}
await c.query('commit');
fs.writeFileSync('facturacion_gratuita.sql','-- Cortesía TC / operación gratuita (2026-08-02) — generado del vivo + parche\n'+ndef+';\n\n'+edef+';\n\n'+ldef+';\n');
console.log('\n★ CORTESÍA TC (gratuita) APLICADA a PROD');
process.exit(0);
}catch(e){try{await c.query('rollback');}catch(_){}
console.error('ERROR:',e.message);process.exit(1);}finally{await c.end();}})();
