// EMISIÓN CON FECHA ANTERIOR (pedido dueño 2026-08-17, solo panel PS).
// Normativa: la fecha de emisión debe coincidir con la fecha real de la operación, y el CPE debe
// ENVIARSE dentro del plazo o SUNAT lo rechaza aunque ya se entregó al cliente:
//   · FACTURA  → 3 días calendario desde el día siguiente a la emisión (RS 000003-2023)
//   · BOLETA   → 7 días calendario (van por Resumen Diario, RS 114-2019 art. 21)
// Como el envío ocurre HOY, la fecha más antigua válida es hoy-3 (factura) / hoy-7 (boleta).
// Se guarda `comprobantes.fecha_emision` APARTE de `creado_at` (que sigue siendo el registro real,
// para auditoría): el ticket y el plazo de anulación deben regirse por la fecha del comprobante.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
await c.query('begin');
// 1) columna nueva (nullable: null = emitido hoy, como siempre)
await c.query("alter table comprobantes add column if not exists fecha_emision date");
chk('columna fecha_emision', (await c.query("select count(*)::int n from information_schema.columns where table_name='comprobantes' and column_name='fecha_emision'")).rows[0].n===1);

// 2) emitir_comprobante: nuevo parámetro al FINAL + validación de plazo + payload/persistencia
let d=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
const args=(await c.query("select pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].a;

const FIRMA='p_observaciones text DEFAULT NULL::text)';
chk('anchor firma', d.includes(FIRMA));
d=d.replace(FIRMA, "p_observaciones text DEFAULT NULL::text, p_fecha_emision date DEFAULT NULL::date)");

const DECL='declare v_num int;';
chk('anchor declare', d.includes(DECL));
d=d.replace(DECL, DECL+' v_femi date; v_dias int;');

// validación: se inserta junto a los otros guards, antes del PEEK del correlativo
const ANCLA="  -- PEEK del siguiente número (NO se avanza todavía)";
chk('anchor peek', d.includes(ANCLA));
d=d.replace(ANCLA,
"  -- FECHA DE EMISIÓN (opcional). Debe ser la fecha REAL de la operación y caer dentro del plazo\n"+
"  -- de envío: 3 días calendario para factura, 7 para boleta (resumen diario). Fuera de plazo\n"+
"  -- SUNAT rechaza el comprobante aunque ya se haya entregado al cliente.\n"+
"  v_femi := coalesce(p_fecha_emision, (now() at time zone 'America/Lima')::date);\n"+
"  if v_femi > (now() at time zone 'America/Lima')::date then\n"+
"    raise exception 'FECHA_FUTURA: no se puede emitir con fecha futura'; end if;\n"+
"  v_dias := case when p_tipo = 1 then 3 else 7 end;\n"+
"  if v_femi < ((now() at time zone 'America/Lima')::date - v_dias) then\n"+
"    raise exception 'FECHA_FUERA_DE_PLAZO: %s solo admite hasta % días atrás (SUNAT rechaza fuera de plazo)',\n"+
"      case when p_tipo = 1 then 'la factura' else 'la boleta' end, v_dias; end if;\n"+
ANCLA);

const PAY="'fecha_de_emision', to_char((now() at time zone 'America/Lima')::date,'DD-MM-YYYY'),";
chk('anchor payload fecha', d.includes(PAY));
d=d.replace(PAY, "'fecha_de_emision', to_char(v_femi,'DD-MM-YYYY'),");

// persistir la fecha de emisión en la fila
const INS='insert into comprobantes(';
chk('anchor insert', d.includes(INS));
const iIns=d.indexOf(INS);
const iCols=d.indexOf(')', iIns);
const cols=d.slice(iIns+INS.length, iCols);
chk('columnas del insert legibles', cols.length>50 && cols.includes('serie'));
d=d.slice(0,iIns+INS.length)+'fecha_emision,'+d.slice(iIns+INS.length);
// añadir el valor en el VALUES correspondiente
const iVal=d.indexOf('values(', iIns);
chk('anchor values', iVal>0);
d=d.slice(0,iVal+'values('.length)+'v_femi,'+d.slice(iVal+'values('.length);

if(!pass){console.log('✗ anchors');process.exit(1);}
// DROP + CREATE en la MISMA tx: agregar un parámetro crea OVERLOAD y PostgREST daría 300 ambiguo
await c.query('drop function public.emitir_comprobante('+args+')');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
const nArgs=(await c.query("select count(*)::int n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname='emitir_comprobante'")).rows[0].n;
chk('una sola firma (sin overload)', nArgs===1);
const back=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
chk('validación de plazo presente', /FECHA_FUERA_DE_PLAZO/.test(back) && /FECHA_FUTURA/.test(back));
chk('payload usa v_femi', /'fecha_de_emision', to_char\(v_femi/.test(back));

// 3) listar_comprobantes proyecta fecha_emision (el ticket y el plazo de baja se rigen por ella)
let L=(await c.query("select pg_get_functiondef('public.listar_comprobantes'::regproc) d")).rows[0].d;
const LCOL="to_char(creado_at at time zone 'America/Lima','YYYY-MM-DD HH24:MI') creado, creado_por, creado_at";
chk('anchor listar', L.includes(LCOL));
L=L.replace(LCOL, LCOL+", fecha_emision");
await c.query('CREATE OR REPLACE '+L.slice(L.indexOf('FUNCTION')));
chk('listar proyecta fecha_emision', /fecha_emision/.test((await c.query("select pg_get_functiondef('public.listar_comprobantes'::regproc) d")).rows[0].d));

// ── smokes: SOLO los que RAISEAN antes del HTTP (NubeFact está VIVA) ──
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
const emitir=(over)=>{
  const base={p_tipo:2,p_serie:'BBB1',p_cliente_doc_tipo:'0',p_cliente_doc:'',p_cliente_nombre:'VARIOS',p_cliente_email:'',
    p_items:[{descripcion:'Tour',cantidad:1,precio:20}],p_exonerado:false,p_moneda:'PEN',p_origen:'panel',p_operacion_ref:null,
    p_creado_por:'smoke',p_local_id:'smoke-fec-'+Math.floor(Math.random()*1e9),p_cliente_tel:'',p_cliente_dir:'',
    p_es_extranjero:false,p_medio_pago:'Efectivo',p_exportacion:false,p_detraccion:false,p_forma_pago:'CONTADO',
    p_credito_venc:null,p_observaciones:null,p_fecha_emision:null, ...over};
  const k=Object.keys(base);
  return c.query('select emitir_comprobante('+k.map((x,i)=>x+'=>$'+(i+1)+(x==='p_items'?'::jsonb':x==='p_credito_venc'||x==='p_fecha_emision'?'::date':'')).join(',')+')',
    k.map(x=>x==='p_items'?J(base[x]):base[x]));
};
const err=async(over,re,label)=>{ try{ await c.query('savepoint s'); await emitir(over); await c.query('rollback to savepoint s'); chk(label,false,'NO lanzó'); }
  catch(e){ await c.query('rollback to savepoint s'); chk(label, re.test(e.message), e.message.slice(0,80)); } };
const hoy=(await c.query("select (now() at time zone 'America/Lima')::date h")).rows[0].h;
const dia=(n)=>{ const x=new Date(hoy); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
await err({p_fecha_emision:dia(1)},/FECHA_FUTURA/,'fecha futura → rechaza');
await err({p_tipo:1,p_serie:'FFF1',p_cliente_doc_tipo:'6',p_cliente_doc:'20000000001',p_cliente_nombre:'EMPRESA',p_cliente_dir:'Dir',p_fecha_emision:dia(-4)},/FECHA_FUERA_DE_PLAZO/,'factura a 4 días → rechaza (máx 3)');
await err({p_fecha_emision:dia(-8)},/FECHA_FUERA_DE_PLAZO/,'boleta a 8 días → rechaza (máx 7)');
console.log('· límites válidos (factura -3 / boleta -7) NO se prueban emitiendo: NubeFact está VIVA');

if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
const c2=mk();await c2.connect();
const f=(await c2.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
const col=(await c2.query("select count(*)::int n from information_schema.columns where table_name='comprobantes' and column_name='fecha_emision'")).rows[0].n;
const nf=(await c2.query("select count(*)::int n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname='emitir_comprobante'")).rows[0].n;
console.log('\n[fresca] columna: '+col+' · firmas: '+nf+' · plazo: '+/FECHA_FUERA_DE_PLAZO/.test(f));
await c2.end();
if(col!==1||nf!==1||!/FECHA_FUERA_DE_PLAZO/.test(f)){console.log('✗ NO PERSISTIÓ');process.exit(1);}
console.log('\n★ fecha de emisión retroactiva (3 factura / 7 boleta) — COMMIT verificado');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
