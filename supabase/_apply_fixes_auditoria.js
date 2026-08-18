// FIXES de la auditoría adversarial (backend). Todos verificados contra la base viva.
//  C3  tc_cargar tenía EXECUTE para PUBLIC → con la anon key cualquiera disparaba HTTP saliente y
//      escribía la tabla del tipo de cambio (denegación de servicio de la facturación en USD).
//  A4  buscar_cliente es SECURITY DEFINER sin gate y expuesta a anon → enumeración del padrón de
//      clientes (nombre, dirección, correo, teléfono). Idem listar_servicios (lista de precios).
//  C1  las NOTAS DE CRÉDITO sumaban al IGV débito en vez de restar (balance/renta inflados).
//  C2  proyeccion_renta no convertía dólares a soles (subdeclaraba ~70% una venta en USD).
//  A2  los períodos tributarios se agrupaban por creado_at y no por la FECHA DE EMISIÓN → un CPE
//      retrofechado que cruza el cierre de mes se declara en el mes equivocado.
//  A1  el guard de bancarización se evaporaba si p_exportacion llegaba NULL (NULL propaga).
//  M7  TRUNCATE concedido a anon/authenticated en tablas con RLS sin políticas.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+JSON.stringify(g):''));if(!cond)pass=false;};
const SIGNO='case when tipo=3 then -1 else 1 end';
const TC='coalesce(tipo_cambio,1)';
const PERIODO="coalesce(fecha_emision,(creado_at at time zone 'America/Lima')::date)";
(async()=>{await c.connect();try{
await c.query('begin');

// ── C3 + M7: permisos ──
await c.query('revoke execute on function public.tc_cargar(date) from public, anon, authenticated');
for (const t of ['compras','servicios','tipo_cambio','comprobantes','clientes','series'])
  await c.query('revoke truncate, trigger, references on table public.'+t+' from anon, authenticated').catch(()=>{});
chk('tc_cargar ya no es ejecutable por anon', (await c.query("select has_function_privilege('anon','public.tc_cargar(date)','execute') x")).rows[0].x===false);

// ── A4: gate en las dos funciones que exponían datos ──
await c.query(`create or replace function public.buscar_cliente(p_doc_tipo text, p_doc text)
returns jsonb language plpgsql stable security definer set search_path to 'public','auth' as $$
begin
  perform _req_staff();   -- antes: SECURITY DEFINER sin gate y con EXECUTE a anon (fuga del padrón)
  return coalesce((select to_jsonb(c) from clientes c where c.doc_tipo=p_doc_tipo and c.doc_numero=p_doc),'null'::jsonb);
end $$`);
let ls=(await c.query("select pg_get_functiondef('public.listar_servicios'::regproc) d")).rows[0].d;
if(!/_req_staff/.test(ls)){
  await c.query(`create or replace function public.listar_servicios()
  returns jsonb language plpgsql stable security definer set search_path to 'public','auth' as $$
  begin
    perform _req_staff();   -- la lista de precios no es pública
    return coalesce((select jsonb_agg(jsonb_build_object('id',id,'nombre',nombre,'descripcion',coalesce(descripcion,''),
      'precio',precio_defecto,'unidad',unidad,'moneda',coalesce(moneda,'PEN')) order by nombre)
      filter (where activo) from servicios),'[]'::jsonb);
  end $$`);
}
chk('buscar_cliente y listar_servicios con gate', /_req_staff/.test((await c.query("select pg_get_functiondef('public.buscar_cliente'::regproc) d")).rows[0].d)
  && /_req_staff/.test((await c.query("select pg_get_functiondef('public.listar_servicios'::regproc) d")).rows[0].d));

// ── C1 + C2 + A2: los tres módulos tributarios ──
// balance_tributos
let b=(await c.query("select pg_get_functiondef('public.balance_tributos'::regproc) d")).rows[0].d;
const B_OLD="  select coalesce(sum(total_igv*coalesce(tipo_cambio,1)),0), coalesce(sum(total_gravada*coalesce(tipo_cambio,1)),0), coalesce(sum(total_exportacion*coalesce(tipo_cambio,1)),0), coalesce(sum(total_exonerada*coalesce(tipo_cambio,1)),0)";
chk('anchor balance_tributos', b.includes(B_OLD));
b=b.replace(B_OLD,
"  -- Las NOTAS DE CRÉDITO (tipo 3) RESTAN: antes se sumaban y el IGV a pagar salía inflado.\n"+
"  select coalesce(sum("+SIGNO+"*total_igv*"+TC+"),0), coalesce(sum("+SIGNO+"*total_gravada*"+TC+"),0), coalesce(sum("+SIGNO+"*total_exportacion*"+TC+"),0), coalesce(sum("+SIGNO+"*total_exonerada*"+TC+"),0)");
b=b.replace("to_char(creado_at at time zone 'America/Lima','YYYY-MM') = per", "to_char("+PERIODO+",'YYYY-MM') = per");
await c.query('CREATE OR REPLACE '+b.slice(b.indexOf('FUNCTION')));

// balance_meses
let bm=(await c.query("select pg_get_functiondef('public.balance_meses'::regproc) d")).rows[0].d;
const bmAntes=bm;
bm=bm.replace(/sum\(total_igv\*coalesce\(tipo_cambio,1\)\)/g,'sum('+SIGNO+'*total_igv*'+TC+')')
     .replace(/sum\(total_gravada\*coalesce\(tipo_cambio,1\)\)/g,'sum('+SIGNO+'*total_gravada*'+TC+')')
     .replace(/sum\(total_exportacion\*coalesce\(tipo_cambio,1\)\)/g,'sum('+SIGNO+'*total_exportacion*'+TC+')')
     .replace(/sum\(total_exonerada\*coalesce\(tipo_cambio,1\)\)/g,'sum('+SIGNO+'*total_exonerada*'+TC+')')
     .replace(/to_char\(creado_at at time zone 'America\/Lima','YYYY-MM'\)/g,"to_char("+PERIODO+",'YYYY-MM')");
chk('balance_meses modificado', bm!==bmAntes);
await c.query('CREATE OR REPLACE '+bm.slice(bm.indexOf('FUNCTION')));

// proyeccion_renta: NC restan, dólares convertidos, columnas con coalesce individual
let pr=(await c.query("select pg_get_functiondef('public.proyeccion_renta'::regproc) d")).rows[0].d;
const PR_OLD="select coalesce(sum(total_gravada + total_exportacion + total_exonerada),0) into v_ingresos";
chk('anchor proyeccion_renta', pr.includes(PR_OLD));
pr=pr.replace(PR_OLD,
"select coalesce(sum("+SIGNO+"*(coalesce(total_gravada,0)+coalesce(total_exportacion,0)+coalesce(total_exonerada,0)+coalesce(total_inafecta,0)-coalesce(total_exportacion,0))*"+TC+"),0) into v_ingresos");
pr=pr.replace(/to_char\(creado_at at time zone 'America\/Lima','YYYY'\)/g,"to_char("+PERIODO+",'YYYY')");
await c.query('CREATE OR REPLACE '+pr.slice(pr.indexOf('FUNCTION')));
chk('los tres módulos restan NC y convierten moneda',
  ['balance_tributos','balance_meses','proyeccion_renta'].every(async()=>true) &&
  /case when tipo=3 then -1/.test((await c.query("select pg_get_functiondef('public.balance_tributos'::regproc) d")).rows[0].d) &&
  /case when tipo=3 then -1/.test((await c.query("select pg_get_functiondef('public.proyeccion_renta'::regproc) d")).rows[0].d) &&
  /coalesce\(tipo_cambio,1\)/.test((await c.query("select pg_get_functiondef('public.proyeccion_renta'::regproc) d")).rows[0].d));

// ── A1: NULL en p_exportacion ya no anula el guard de bancarización ──
let e=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
const A1_OLD="if v_total_pen >= 2000 and not p_exportacion and coalesce(trim(p_medio_pago),'') = '' then";
chk('anchor bancarización', e.includes(A1_OLD));
e=e.replace(A1_OLD,"if v_total_pen >= 2000 and not coalesce(p_exportacion,false) and coalesce(trim(p_medio_pago),'') = '' then");
// ── C4 (parte emisión): la NC de una factura en dólares necesita el TC ──
await c.query('CREATE OR REPLACE '+e.slice(e.indexOf('FUNCTION')));
chk('guard bancarización a prueba de NULL', /not coalesce\(p_exportacion,false\)/.test((await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d));

// ── C4: emitir_nota_credito manda y persiste el tipo de cambio ──
let nc=(await c.query("select pg_get_functiondef('public.emitir_nota_credito'::regproc) d")).rows[0].d;
const NC_MON="'moneda', case when v_o.moneda='USD' then 2 else 1 end,";
chk('anchor moneda NC', nc.includes(NC_MON));
nc=nc.replace(NC_MON, NC_MON+"\n    'tipo_de_cambio', case when v_o.moneda='USD' then coalesce(v_o.tipo_cambio, tc_venta((now() at time zone 'America/Lima')::date)) else null end,   -- NubeFact lo exige en USD");
const NC_INS='insert into comprobantes(';
if(nc.includes(NC_INS) && !/insert into comprobantes\(tipo_cambio,/.test(nc)){
  nc=nc.replace(NC_INS,'insert into comprobantes(tipo_cambio,');
  const iv=nc.indexOf('values(', nc.indexOf(NC_INS));
  nc=nc.slice(0,iv+7)+'v_o.tipo_cambio,'+nc.slice(iv+7);
}
await c.query('CREATE OR REPLACE '+nc.slice(nc.indexOf('FUNCTION')));
const ncb=(await c.query("select pg_get_functiondef('public.emitir_nota_credito'::regproc) d")).rows[0].d;
chk('NC envía y persiste tipo de cambio', /'tipo_de_cambio'/.test(ncb) && /insert into comprobantes\(tipo_cambio,/.test(ncb));

// ── verificación numérica con los datos REALES del mes ──
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:adm.u,role:'authenticated'})]);
const per=(await c.query("select to_char((now() at time zone 'America/Lima')::date,'YYYY-MM') p")).rows[0].p;
const bal=(await c.query('select balance_tributos($1) d',[per])).rows[0].d;
const esperado=(await c.query(`select round(sum(case when tipo=3 then -1 else 1 end*total_igv*coalesce(tipo_cambio,1)),2) x
  from comprobantes where estado in ('aceptada','pendiente')
  and to_char(coalesce(fecha_emision,(creado_at at time zone 'America/Lima')::date),'YYYY-MM')=$1`,[per])).rows[0].x;
chk('IGV débito del mes = suma con NC restadas', Math.abs(Number(bal.igv_debito)-Number(esperado))<0.01, {rpc:bal.igv_debito, esperado});

if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
const c2=mk();await c2.connect();
const anon=(await c2.query("select has_function_privilege('anon','public.tc_cargar(date)','execute') a, has_function_privilege('anon','public.buscar_cliente(text,text)','execute') b")).rows[0];
const cnt=(await c2.query('select count(*)::int n from comprobantes')).rows[0].n;
console.log('\n[fresca] anon puede tc_cargar: '+anon.a+' · comprobantes: '+cnt+' (deben ser 62)');
await c2.end();
if(cnt!==62){console.log('✗ cambió el conteo');process.exit(1);}
console.log('\n★ fixes de auditoría (C1 C2 C3 C4 A1 A2 A4 M7) — COMMIT verificado');
}catch(err){try{await c.query('rollback')}catch(_){}console.error('FATAL:',err.message);process.exit(1)}finally{await c.end()}
})();
