// COLA DE REPARACIONES (2026-08-23) — pendientes de la auditoría + 1 bug propio detectado hoy:
//  R1 (BUG PROPIO, crítico): al ampliar el reconciliador a las anulaciones, la rama genérica
//     "aceptada" REVERTÍA una baja pendiente a estado='aceptada' (pasó con BBB1-31) y además la
//     sacaba del guardián (filtra estado='anulada'). Fix: rama PROPIA para bajas — consulta el
//     campo `anulado` de NubeFact → aprobada / mantiene / error_baja a los 7 días; la rama
//     genérica ya no toca filas con baja pendiente. + guardián filtra por anulacion_estado.
//  R2 (M9): es_staff() incluye 'hotel' → personal del hotel podía emitir CPE. Gate nuevo
//     _req_staff_fact() (solo ps/muelle) en emitir_comprobante, emitir_nota_credito y
//     anular_comprobante.
//  R3 (A5): NC ilimitadas → guard NC_YA_EXISTE (una NC viva por comprobante).
//  R4 (M1): el backend no validaba mezcla de monedas por ítem (solo la UI) → MONEDA_MEZCLADA.
//  R5 (M8): TC sin tope de antigüedad → TC_DESACTUALIZADO si el publicado dista >5 días de la
//     fecha de emisión; cron tc-diario pasa a HORARIO (si ya cargó, sale gratis con 'ya').
//  R6 (M2): la balanza omitía el inafecto puro: ingresos = grav+exon+INAFECTA(bucket, que ya
//     incluye export por diseño NubeFact) — antes sumaba export aparte y perdía el inafecto.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
await c.query('begin');

// ── R2: gate de facturación (ps + muelle; hotel NO emite comprobantes de la empresa) ──
await c.query(`
create or replace function public._req_staff_fact() returns void language plpgsql stable security definer
set search_path to 'public','auth' as $$
begin
  if not exists(select 1 from equipo p join equipo_accesos a on a.equipo_id = p.id
                where p.auth_uid = auth.uid() and p.activo and a.activo and a.app in ('ps','muelle')) then
    raise exception 'SOLO_PS_MUELLE: la facturación es del panel y el muelle'; end if;
end $$`);
for (const fn of ['emitir_comprobante','emitir_nota_credito','anular_comprobante']) {
  let d=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[fn])).rows[0].d;
  if(/_req_staff_fact/.test(d)) continue;
  const gate = d.includes('perform _req_staff();') ? 'perform _req_staff();' : 'perform _req_admin();';
  chk(fn+': anchor gate', d.includes(gate));
  d=d.replace(gate, gate+' perform _req_staff_fact();   -- hotel NO emite CPE');
  await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
}
chk('gate ps/muelle en las 3 funciones', (await c.query("select count(*)::int n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname in ('emitir_comprobante','emitir_nota_credito','anular_comprobante') and pg_get_functiondef(p.oid) like '%_req_staff_fact%'")).rows[0].n===3);

// ── R3 + R4 + R5: guards en emitir_comprobante / emitir_nota_credito ──
let e=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
// R4: un CPE = una moneda también en el SERVIDOR (la UI ya bloquea; esto cubre callers futuros/cola offline)
const MONG="  -- MONEDA: un comprobante = UNA sola moneda (SUNAT). Solo soles o dólares.";
chk('anchor guard moneda', e.includes(MONG));
if(!/MONEDA_MEZCLADA/.test(e)) e=e.replace(MONG, MONG+"\n"+
"  if exists (select 1 from jsonb_array_elements(p_items) i\n"+
"             where coalesce(nullif(upper(i->>'moneda'),''), upper(coalesce(p_moneda,'PEN'))) <> upper(coalesce(p_moneda,'PEN'))) then\n"+
"    raise exception 'MONEDA_MEZCLADA: hay un ítem en otra moneda — un comprobante lleva una sola'; end if;");
// R5: TC vigente (art. 20.2 permite el último publicado, pero uno de semanas = dato podrido)
const TCG="    if v_tc is null or v_tc <= 0 then";
chk('anchor TC', e.includes(TCG));
if(!/TC_DESACTUALIZADO/.test(e)) e=e.replace(TCG,
"    if (select max(fecha) from tipo_cambio where fecha <= v_femi) < v_femi - 5 then\n"+
"      raise exception 'TC_DESACTUALIZADO: el último tipo de cambio publicado dista más de 5 días — corre tc_cargar() o espera al cron'; end if;\n"+TCG);
await c.query('CREATE OR REPLACE '+e.slice(e.indexOf('FUNCTION')));
const eb=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
chk('MONEDA_MEZCLADA + TC_DESACTUALIZADO', /MONEDA_MEZCLADA/.test(eb) && /TC_DESACTUALIZADO/.test(eb));
// R3: una sola NC viva por comprobante
let nc=(await c.query("select pg_get_functiondef('public.emitir_nota_credito'::regproc) d")).rows[0].d;
const NCG="  if v_o.tipo = 3 then raise exception 'NO_NC_DE_NC: no se emite nota de crédito de una nota de crédito'; end if;";
chk('anchor NC', nc.includes(NCG));
if(!/NC_YA_EXISTE/.test(nc)) nc=nc.replace(NCG, NCG+"\n"+
"  if exists (select 1 from comprobantes n where n.tipo = 3 and n.estado in ('aceptada','pendiente')\n"+
"             and n.doc_modifica_tipo = v_o.tipo and n.doc_modifica_serie = v_o.serie and n.doc_modifica_numero = v_o.numero) then\n"+
"    raise exception 'NC_YA_EXISTE: este comprobante ya tiene una nota de crédito emitida'; end if;");
await c.query('CREATE OR REPLACE '+nc.slice(nc.indexOf('FUNCTION')));
chk('NC_YA_EXISTE', /NC_YA_EXISTE/.test((await c.query("select pg_get_functiondef('public.emitir_nota_credito'::regproc) d")).rows[0].d));

// ── R1: reconciliador — rama propia para BAJAS (no las pisa la rama genérica) ──
let r=(await c.query("select pg_get_functiondef('public.reconciliar_comprobantes'::regproc) d")).rows[0].d;
const RANC="      if coalesce((v_j->>'aceptada_por_sunat')::boolean,false) or coalesce(v_j->>'enlace_del_pdf','')<>'' then";
chk('anchor rama genérica', r.includes(RANC));
if(!/anulado.*true/.test(r)) r=r.replace(RANC,
"      -- BAJA PENDIENTE: se resuelve con el campo `anulado` de NubeFact y NUNCA entra a la rama\n"+
"      -- genérica (que la revertía a 'aceptada' al ver el PDF — bug real con BBB1-31).\n"+
"      if r.anulacion_estado = 'enviada' then\n"+
"        if coalesce((v_j->>'anulado')::boolean,false) then\n"+
"          update comprobantes set estado='anulada', anulacion_estado='aprobada', nf_respuesta=v_j where id=r.id; v_ok:=v_ok+1;\n"+
"        elsif coalesce(r.anulacion_at, r.creado_at) < now() - interval '7 days' then\n"+
"          -- SUNAT no confirmó la baja en 7 días: el documento SIGUE VIVO → vuelve a aceptada y\n"+
"          -- queda marcado error_baja (el guardián lo muestra; vuelve a contar en la balanza)\n"+
"          update comprobantes set estado='aceptada', anulacion_estado='error_baja', nf_respuesta=v_j where id=r.id;\n"+
"        end if;\n"+
"        continue;\n"+
"      end if;\n"+RANC);
await c.query('CREATE OR REPLACE '+r.slice(r.indexOf('FUNCTION')));
chk('reconciliador con rama de bajas', /anulacion_estado = 'enviada'/.test((await c.query("select pg_get_functiondef('public.reconciliar_comprobantes'::regproc) d")).rows[0].d));

// ── R1b: guardián filtra bajas por anulacion_estado (sin importar el estado) ──
let g=(await c.query("select pg_get_functiondef('public.cpe_guardian'::regproc) d")).rows[0].d;
g=g.replace(/when estado='anulada' and anulacion_estado in \('enviada','error_baja'\)/g, "when anulacion_estado in ('enviada','error_baja')")
   .replace("or (estado = 'anulada' and anulacion_estado in ('enviada','error_baja') and coalesce(anulacion_at,creado_at) < now() - interval '48 hours')",
            "or (anulacion_estado in ('enviada','error_baja') and coalesce(anulacion_at,creado_at) < now() - interval '48 hours')");
await c.query('CREATE OR REPLACE '+g.slice(g.indexOf('FUNCTION')));
const gi=g.replace('FUNCTION public.cpe_guardian(','FUNCTION public.cpe_guardian_interno(').replace("  perform _req_staff();\n","");
await c.query('CREATE OR REPLACE '+gi.slice(gi.indexOf('FUNCTION')));
await c.query('revoke all on function public.cpe_guardian_interno(int) from public, anon, authenticated');
chk('guardián: bajas por anulacion_estado', !/estado='anulada' and anulacion_estado in/.test((await c.query("select pg_get_functiondef('public.cpe_guardian'::regproc) d")).rows[0].d));

// ── R1c: reparar el dato de BBB1-31 (consulta REAL a NubeFact — solo lectura) ──
const cfg=(await c.query('select nubefact_ruta ruta, nubefact_token tok, auth_header ah from facturacion_config where id=1')).rows[0];
let anulado31=null;
try{
  const resp=(await c.query("select content from http(('POST',$1,array[http_header('Authorization',replace(coalesce($3,'{token}'),'{token}',$2))],'application/json',$4)::http_request)",
    [cfg.ruta,cfg.tok,cfg.ah,J({operacion:'consultar_comprobante',tipo_de_comprobante:2,serie:'BBB1',numero:31})])).rows[0].content;
  anulado31=JSON.parse(resp).anulado===true;
}catch(err){ console.log('· consulta BBB1-31 falló ('+err.message.slice(0,50)+') — lo resolverá el cron'); }
if(anulado31===true){ await c.query("update comprobantes set estado='anulada', anulacion_estado='aprobada' where serie='BBB1' and numero=31"); chk('BBB1-31: baja CONFIRMADA por NubeFact → anulada/aprobada', true); }
else if(anulado31===false){ await c.query("update comprobantes set estado='anulada', anulacion_estado='enviada' where serie='BBB1' and numero=31"); chk('BBB1-31: baja aún en trámite → restaurada a anulada/enviada (el cron la resuelve)', true); }

// ── R5b: cron del TC a horario (si el día ya cargó, tc_cargar sale con "ya" sin llamar a la API) ──
await c.query("select cron.unschedule('tc-diario')").catch(()=>{});
await c.query("select cron.schedule('tc-diario','7 * * * *', $$select public.tc_cargar()$$)");
chk('cron TC horario', (await c.query("select schedule from cron.job where jobname='tc-diario'")).rows[0].schedule==='7 * * * *');

// ── R6: balanza — ingresos = gravada + exonerada + INAFECTA(bucket ⊇ export); export solo informativo ──
let b=(await c.query("select pg_get_functiondef('public.balance_tributos'::regproc) d")).rows[0].d;
const SIGNO="case when tipo=3 then -1 else 1 end", TCX="coalesce(tipo_cambio,1)";
const BSEL="  select coalesce(sum("+SIGNO+"*total_igv*"+TCX+"),0), coalesce(sum("+SIGNO+"*total_gravada*"+TCX+"),0), coalesce(sum("+SIGNO+"*total_exportacion*"+TCX+"),0), coalesce(sum("+SIGNO+"*total_exonerada*"+TCX+"),0)";
chk('anchor balanza select', b.includes(BSEL));
if(!/v_inaf/.test(b)){
  b=b.replace('declare per text; v_debito numeric;','declare per text; v_inaf numeric; v_debito numeric;');
  b=b.replace(BSEL, BSEL.replace('coalesce(sum('+SIGNO+'*total_exonerada','coalesce(sum('+SIGNO+'*total_inafecta*'+TCX+'),0), coalesce(sum('+SIGNO+'*total_exonerada'));
  b=b.replace('into v_debito, v_grav, v_export, v_exon','into v_debito, v_grav, v_export, v_inaf, v_exon');
  b=b.replace('v_ingresos := v_grav + v_export + v_exon;','v_ingresos := v_grav + v_exon + v_inaf;   -- inafecta ⊇ exportación (diseño NubeFact): sumar export aparte la duplicaba y el inafecto puro se perdía');
}
await c.query('CREATE OR REPLACE '+b.slice(b.indexOf('FUNCTION')));
chk('balanza suma inafecta sin duplicar export', /v_ingresos := v_grav \+ v_exon \+ v_inaf/.test((await c.query("select pg_get_functiondef('public.balance_tributos'::regproc) d")).rows[0].d));

// ── SMOKES (solo raise pre-HTTP; savepoints) ──
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
const emitir=(over)=>{const base={p_tipo:2,p_serie:'BBB1',p_cliente_doc_tipo:'0',p_cliente_doc:'',p_cliente_nombre:'VARIOS',p_cliente_email:'',
  p_items:[{descripcion:'T',cantidad:1,precio:20}],p_exonerado:false,p_moneda:'PEN',p_origen:'panel',p_operacion_ref:null,p_creado_por:'smoke',
  p_local_id:'smoke-cola-'+Math.floor(Math.random()*1e9),p_cliente_tel:'',p_cliente_dir:'',p_es_extranjero:false,p_medio_pago:'Efectivo',
  p_exportacion:false,p_detraccion:false,p_forma_pago:'CONTADO',p_credito_venc:null,p_observaciones:null,p_fecha_emision:null,...over};
  const k=Object.keys(base);
  return c.query('select emitir_comprobante('+k.map((x,i)=>x+'=>$'+(i+1)+(x==='p_items'?'::jsonb':(x==='p_credito_venc'||x==='p_fecha_emision')?'::date':'')).join(',')+')',k.map(x=>x==='p_items'?J(base[x]):base[x]));};
const err=async(fn,re,label)=>{try{await c.query('savepoint s');await fn();await c.query('rollback to savepoint s');chk(label,false,'NO lanzó');}
  catch(er){await c.query('rollback to savepoint s');chk(label,re.test(er.message),er.message.slice(0,78));}};
// R2: usuario SOLO-hotel no emite (usuario efímero en savepoint)
await c.query('savepoint hotel');
const uid=(await c.query('select gen_random_uuid()::text u')).rows[0].u;
const eid=(await c.query("insert into equipo(nombre,activo,auth_uid) values('SMOKE HOTEL',true,$1::uuid) returning id",[uid])).rows[0].id;
await c.query("insert into equipo_accesos(equipo_id,app,rol,activo) values($1,'hotel','operador',true)",[eid]);
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:uid,role:'authenticated'})]);
try{ await emitir({}); chk('hotel NO emite CPE',false,'NO lanzó'); }
catch(er){ chk('hotel NO emite CPE → SOLO_PS_MUELLE', /SOLO_PS_MUELLE/.test(er.message), er.message.slice(0,60)); }
await c.query('rollback to savepoint hotel');
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
// R4: mezcla de monedas
await err(()=>emitir({p_moneda:'PEN',p_items:[{descripcion:'A',cantidad:1,precio:20,moneda:'PEN'},{descripcion:'B',cantidad:1,precio:30,moneda:'USD'}]}),/MONEDA_MEZCLADA/,'ítem USD en CPE PEN → MONEDA_MEZCLADA');
// R5: TC podrido (simulado en savepoint)
await err(async()=>{await c.query("delete from tipo_cambio where fecha > (now() at time zone 'America/Lima')::date - 20");
  await c.query("insert into tipo_cambio(fecha,venta) values(((now() at time zone 'America/Lima')::date - 15), 3.3)");
  await emitir({p_moneda:'USD',p_items:[{descripcion:'T',cantidad:1,precio:20,moneda:'USD'}]});},/TC_DESACTUALIZADO/,'TC de hace 15 días → TC_DESACTUALIZADO');
// R3: NC duplicada (FFF1-13 ya tiene NC aprobada → su original está anulada → SOLO_ACEPTADAS cubre;
//     probamos el guard directo con un doc aceptado que tenga NC viva... si no existe, smoke sintético)
const conNC=(await c.query("select o.id from comprobantes o join comprobantes n on n.tipo=3 and n.estado in ('aceptada','pendiente') and n.doc_modifica_serie=o.serie and n.doc_modifica_numero=o.numero and n.doc_modifica_tipo=o.tipo where o.estado='aceptada' and o.tipo<>3 limit 1")).rows[0];
if(conNC){ await err(()=>c.query("select emitir_nota_credito($1, 1, 'smoke')",[conNC.id]),/NC_YA_EXISTE/,'NC sobre doc con NC viva → NC_YA_EXISTE'); }
else{
  await c.query('savepoint ncx');
  const base=(await c.query("select id,tipo,serie,numero from comprobantes where estado='aceptada' and tipo=2 order by numero desc limit 1")).rows[0];
  await c.query("insert into comprobantes(id,tipo,serie,numero,moneda,cliente_nombre,total,estado,creado_at,items,doc_modifica_tipo,doc_modifica_serie,doc_modifica_numero) values('SMK-NC',3,'BBB1',999998,'PEN','NC SMOKE',10,'aceptada',now(),'[]'::jsonb,$1,$2,$3)",[base.tipo,base.serie,base.numero]);
  try{ await c.query("select emitir_nota_credito($1, 1, 'smoke')",[base.id]); chk('NC duplicada → NC_YA_EXISTE',false,'NO lanzó'); }
  catch(er){ chk('NC duplicada → NC_YA_EXISTE', /NC_YA_EXISTE/.test(er.message), er.message.slice(0,60)); }
  await c.query('rollback to savepoint ncx');
}
// R6: verificación numérica de la balanza
const per=(await c.query("select to_char((now() at time zone 'America/Lima')::date,'YYYY-MM') p")).rows[0].p;
const bal=(await c.query('select balance_tributos($1) d',[per])).rows[0].d;
const esp=(await c.query(`select round(sum(case when tipo=3 then -1 else 1 end*(coalesce(total_gravada,0)+coalesce(total_exonerada,0)+coalesce(total_inafecta,0))*coalesce(tipo_cambio,1)),2) x
  from comprobantes where estado in ('aceptada','pendiente') and to_char(coalesce(fecha_emision,(creado_at at time zone 'America/Lima')::date),'YYYY-MM')=$1`,[per])).rows[0].x;
chk('balanza: ingresos = grav+exon+inafecta (export incluida una sola vez)', Math.abs(Number(bal.ingresos_netos)-Number(esp))<0.01, {rpc:bal.ingresos_netos, esperado:esp});
// admin normal sigue emitiendo (raise por ítem, no por gate)
await err(()=>emitir({p_items:[{descripcion:'T',cantidad:0,precio:10}]}),/ITEM_INVALIDO/,'admin del panel pasa el gate (llega al guard de ítem)');

if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
const c2=mk();await c2.connect();
const st=(await c2.query("select estado, anulacion_estado from comprobantes where serie='BBB1' and numero=31")).rows[0];
const cnt=(await c2.query('select count(*)::int n from comprobantes')).rows[0].n;
const smk=(await c2.query("select count(*)::int n from comprobantes where id like 'SMK%'")).rows[0].n;
console.log('\n[fresca] BBB1-31: '+J(st)+' · comprobantes: '+cnt+' · residuos: '+smk);
await c2.end();
if(smk!==0){console.log('✗ residuo');process.exit(1);}
console.log('\n★ cola de reparaciones (R1–R6) — COMMIT verificado');
}catch(e2){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e2.message);process.exit(1)}finally{await c.end()}
})();
