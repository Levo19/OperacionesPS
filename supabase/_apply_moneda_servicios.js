// SERVICIOS EN DÓLARES (pedido dueño 2026-08-17): el catálogo lleva su MONEDA y el CPE la respeta.
// Regla dura: un comprobante = UNA sola moneda (SUNAT no permite mezclar) → el frontend bloquea el
// carrito mixto y el backend valida que la moneda del CPE sea PEN o USD.
// Nota: emitir_comprobante YA aceptaba p_moneda y la traduce a NubeFact (1=PEN / 2=USD); lo que
// faltaba era que el servicio la trajera y que las RPCs de catálogo la expusieran.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
await c.query('begin');
// 1) columna con default PEN (todo lo existente sigue en soles) + check duro
await c.query("alter table servicios add column if not exists moneda text not null default 'PEN'");
await c.query("alter table servicios drop constraint if exists servicios_moneda_chk");
await c.query("alter table servicios add constraint servicios_moneda_chk check (moneda in ('PEN','USD'))");
chk('columna moneda + check', (await c.query("select count(*)::int n from information_schema.columns where table_name='servicios' and column_name='moneda'")).rows[0].n===1);
chk('todos los servicios quedan en PEN', (await c.query("select count(*)::int n from servicios where moneda<>'PEN'")).rows[0].n===0);

// 2) las RPCs de lectura exponen la moneda (catálogo, paquete del zarpe y bootstrap del muelle)
const proyectar=async(fn, buscar, reemplazo)=>{
  let d=(await c.query("select pg_get_functiondef(('public.'||$1)::regproc) d",[fn])).rows[0].d;
  chk('anchor '+fn, d.includes(buscar));
  d=d.replace(buscar, reemplazo);
  await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
  const back=(await c.query("select pg_get_functiondef(('public.'||$1)::regproc) d",[fn])).rows[0].d;
  chk(fn+' proyecta moneda', /'moneda'/.test(back));
};
await proyectar('listar_servicios',
  "'precio',precio_defecto,'unidad',unidad)",
  "'precio',precio_defecto,'unidad',unidad,'moneda',coalesce(moneda,'PEN'))");
await proyectar('admin_listar_servicios_full',
  "'precio',precio_defecto,'unidad',unidad,",
  "'precio',precio_defecto,'unidad',unidad,'moneda',coalesce(moneda,'PEN'),");
await proyectar('listar_paquete_zarpe',
  "'precio',precio_defecto,'unidad',unidad)",
  "'precio',precio_defecto,'unidad',unidad,'moneda',coalesce(moneda,'PEN'))");
await proyectar('get_facturacion_bootstrap',
  "'unidad',coalesce(unidad,'ZZ'))",
  "'unidad',coalesce(unidad,'ZZ'),'moneda',coalesce(moneda,'PEN'))");

// 3) admin_set_servicio acepta la moneda (nuevo parámetro al final → DROP+CREATE en la misma tx)
let s=(await c.query("select pg_get_functiondef('public.admin_set_servicio'::regproc) d")).rows[0].d;
const sArgs=(await c.query("select pg_get_function_identity_arguments('public.admin_set_servicio'::regproc) a")).rows[0].a;
chk('anchor firma set_servicio', s.includes("p_activo boolean DEFAULT true)"));
s=s.replace("p_activo boolean DEFAULT true)","p_activo boolean DEFAULT true, p_moneda text DEFAULT 'PEN'::text)");
chk('anchor insert set_servicio', s.includes("insert into servicios(nombre,descripcion,precio_defecto,unidad,activo)"));
s=s.replace("insert into servicios(nombre,descripcion,precio_defecto,unidad,activo)","insert into servicios(nombre,descripcion,precio_defecto,unidad,activo,moneda)");
s=s.replace("values(p_nombre, nullif(p_desc,''), coalesce(p_precio,0), coalesce(nullif(upper(p_unidad),''),'ZZ'), coalesce(p_activo,true))",
            "values(p_nombre, nullif(p_desc,''), coalesce(p_precio,0), coalesce(nullif(upper(p_unidad),''),'ZZ'), coalesce(p_activo,true), case when upper(coalesce(p_moneda,'PEN'))='USD' then 'USD' else 'PEN' end)");
chk('anchor update set_servicio', s.includes("unidad=coalesce(nullif(upper(p_unidad),''),'ZZ'), activo=coalesce(p_activo,true) where id=p_id"));
s=s.replace("unidad=coalesce(nullif(upper(p_unidad),''),'ZZ'), activo=coalesce(p_activo,true) where id=p_id",
            "unidad=coalesce(nullif(upper(p_unidad),''),'ZZ'), activo=coalesce(p_activo,true), moneda=case when upper(coalesce(p_moneda,'PEN'))='USD' then 'USD' else 'PEN' end where id=p_id");
if(!pass){await c.query('rollback');console.log('✗ anchors');process.exit(1);}
await c.query('drop function public.admin_set_servicio('+sArgs+')');
await c.query('CREATE OR REPLACE '+s.slice(s.indexOf('FUNCTION')));
chk('admin_set_servicio: una sola firma', (await c.query("select count(*)::int n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname='admin_set_servicio'")).rows[0].n===1);

// 4) emitir_comprobante: la moneda solo puede ser PEN o USD (guard explícito)
let e=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
const ANCLA="  -- FECHA DE EMISIÓN (opcional).";
chk('anchor guard moneda', e.includes(ANCLA));
e=e.replace(ANCLA,
"  -- MONEDA: un comprobante = UNA sola moneda (SUNAT). Solo soles o dólares.\n"+
"  if upper(coalesce(p_moneda,'PEN')) not in ('PEN','USD') then\n"+
"    raise exception 'MONEDA_INVALIDA: solo se admite PEN (soles) o USD (dólares)'; end if;\n"+
ANCLA);
await c.query('CREATE OR REPLACE '+e.slice(e.indexOf('FUNCTION')));
chk('guard de moneda presente', /MONEDA_INVALIDA/.test((await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d));

// ── smokes ──
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
await c.query('savepoint sv');
const id=(await c.query("select admin_set_servicio('','SMOKE USD','',35,'ZZ',true,'USD') id")).rows[0].id;
chk('crear servicio en USD', (await c.query('select moneda,precio_defecto from servicios where id=$1',[id])).rows[0].moneda==='USD');
await c.query("select admin_set_servicio($1,'SMOKE USD','',35,'ZZ',true,'PEN')",[id]);
chk('editar moneda USD→PEN', (await c.query('select moneda from servicios where id=$1',[id])).rows[0].moneda==='PEN');
await c.query("select admin_set_servicio($1,'SMOKE USD','',35,'ZZ',true,'usd')",[id]);
chk('minúsculas normalizadas a USD', (await c.query('select moneda from servicios where id=$1',[id])).rows[0].moneda==='USD');
await c.query("select admin_set_servicio($1,'SMOKE USD','',35,'ZZ',true,'EUR')",[id]);
chk('moneda desconocida cae a PEN (nunca rompe)', (await c.query('select moneda from servicios where id=$1',[id])).rows[0].moneda==='PEN');
const lst=(await c.query('select admin_listar_servicios_full() d')).rows[0].d;
chk('listado full trae moneda en todos', lst.every(x=>x.moneda==='PEN'||x.moneda==='USD'), {n:lst.length});
const boot=(await c.query('select get_facturacion_bootstrap() d')).rows[0].d;
chk('bootstrap del muelle trae moneda', (boot.servicios||[]).every(x=>!!x.moneda));
await c.query('rollback to savepoint sv');
try{ await c.query('savepoint m');
  await c.query("select emitir_comprobante(p_tipo=>2,p_serie=>'BBB1',p_cliente_doc_tipo=>'0',p_cliente_doc=>'',p_cliente_nombre=>'VARIOS',p_cliente_email=>'',p_items=>'[{\"descripcion\":\"T\",\"cantidad\":1,\"precio\":20}]'::jsonb,p_exonerado=>false,p_moneda=>'EUR',p_origen=>'panel',p_operacion_ref=>null,p_creado_por=>'smoke',p_local_id=>'smoke-mon',p_cliente_tel=>'',p_cliente_dir=>'',p_es_extranjero=>false,p_medio_pago=>'Efectivo',p_exportacion=>false,p_detraccion=>false)");
  await c.query('rollback to savepoint m'); chk('CPE en EUR → rechaza', false,'NO lanzó');
}catch(er){ await c.query('rollback to savepoint m'); chk('CPE en EUR → MONEDA_INVALIDA', /MONEDA_INVALIDA/.test(er.message), er.message.slice(0,60)); }

if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
const c2=mk();await c2.connect();
const col=(await c2.query("select count(*)::int n from information_schema.columns where table_name='servicios' and column_name='moneda'")).rows[0].n;
const res=(await c2.query("select count(*)::int n from servicios where nombre like 'SMOKE%'")).rows[0].n;
const usd=(await c2.query("select count(*)::int n from servicios where moneda='USD'")).rows[0].n;
console.log('\n[fresca] columna: '+col+' · residuos: '+res+' · servicios en USD: '+usd+' (todos siguen en soles hasta que el dueño cambie alguno)');
await c2.end();
if(col!==1||res!==0){console.log('✗ NO PERSISTIÓ o quedó residuo');process.exit(1);}
console.log('\n★ moneda en servicios (PEN/USD) + guard en el CPE — COMMIT verificado');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
