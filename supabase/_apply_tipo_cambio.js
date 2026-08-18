// TIPO DE CAMBIO OFICIAL (SUNAT/SBS) — necesario para emitir en dólares.
// LEGAL (R.S. 183-2004/SUNAT art. 20.1): la conversión a soles usa el TC promedio ponderado VENTA
// publicado por la SBS en la fecha en que nace la obligación del IGV (en la práctica, la fecha de
// emisión); art. 20.2: si ese día no se publicó, se usa EL ÚLTIMO PUBLICADO.
// ARQUITECTURA: la emisión NUNCA sale a la red (un 429 del proveedor rompería la facturación y
// bloquearía la transacción). Un cron diario llena la tabla; emitir_comprobante solo LEE.
// Fuente: api.apis.net.pe/v1/tipo-cambio-sunat (sin token, TC SUNAT oficial, con histórico).
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
await c.query('begin');
await c.query(`
create table if not exists public.tipo_cambio (
  fecha date primary key,
  compra numeric(9,4),
  venta  numeric(9,4) not null,
  origen text default 'apis.net.pe',
  obtenido_at timestamptz default now()
)`);
await c.query('alter table public.tipo_cambio enable row level security');
await c.query('drop policy if exists tc_lee_staff on public.tipo_cambio');
await c.query("create policy tc_lee_staff on public.tipo_cambio for select using (es_staff())");
await c.query('revoke insert, update, delete on public.tipo_cambio from anon, authenticated');
chk('tabla tipo_cambio con RLS', (await c.query("select count(*)::int n from information_schema.tables where table_name='tipo_cambio'")).rows[0].n===1);

// Descarga y guarda el TC de una fecha (solo cron/service_role: hace HTTP, no va en la emisión).
await c.query(`
create or replace function public.tc_cargar(p_fecha date default null)
returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $$
declare v_f date; v_r jsonb; v_body text; begin
  v_f := coalesce(p_fecha, (now() at time zone 'America/Lima')::date);
  if exists(select 1 from tipo_cambio where fecha = v_f) then
    return jsonb_build_object('ok',true,'ya',true,'fecha',v_f); end if;
  begin
    select content into v_body from http_get('https://api.apis.net.pe/v1/tipo-cambio-sunat?fecha=' || to_char(v_f,'YYYY-MM-DD'));
  exception when others then return jsonb_build_object('ok',false,'error','red','fecha',v_f); end;
  if v_body is null or v_body = '' or left(btrim(v_body),1) <> '{' then
    return jsonb_build_object('ok',false,'error','respuesta no válida','fecha',v_f); end if;
  v_r := v_body::jsonb;
  if (v_r->>'venta') is null then return jsonb_build_object('ok',false,'error','sin venta','fecha',v_f); end if;
  insert into tipo_cambio(fecha,compra,venta,origen)
    values(v_f,(v_r->>'compra')::numeric,(v_r->>'venta')::numeric,coalesce(v_r->>'origen','apis.net.pe'))
    on conflict (fecha) do update set compra=excluded.compra, venta=excluded.venta, obtenido_at=now();
  return jsonb_build_object('ok',true,'fecha',v_f,'venta',(v_r->>'venta')::numeric);
end $$`);
await c.query('revoke all on function public.tc_cargar(date) from anon, authenticated');

// LECTURA para la emisión: nunca sale a la red. Devuelve el TC VENTA de la fecha o, si ese día no
// se publicó (feriado/fin de semana), EL ÚLTIMO PUBLICADO antes — que es lo que exige el art. 20.2.
await c.query(`
create or replace function public.tc_venta(p_fecha date)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select venta from tipo_cambio where fecha <= coalesce(p_fecha,(now() at time zone 'America/Lima')::date)
  order by fecha desc limit 1
$$`);
chk('funciones tc_cargar / tc_venta', (await c.query("select count(*)::int n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname in ('tc_cargar','tc_venta')")).rows[0].n===2);

// emitir_comprobante: convierte a soles para los umbrales legales y guarda el TC usado
await c.query("alter table comprobantes add column if not exists tipo_cambio numeric(9,4)");
let d=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
const DECL='declare v_num int;';
chk('anchor declare', d.includes(DECL));
d=d.replace(DECL, DECL+' v_tc numeric; v_total_pen numeric;');
// se calcula tras conocer v_total y la fecha, justo antes del PEEK
const PEEK="  -- PEEK del siguiente número (NO se avanza todavía)";
chk('anchor peek', d.includes(PEEK));
d=d.replace(PEEK,
"  -- Umbrales legales (S/700 identificación, S/2000 bancarización, S/700 detracción) están en\n"+
"  -- SOLES: una venta en dólares se convierte con el TC VENTA de la fecha de emisión (art. 20.1\n"+
"  -- R.S.183-2004). El TC se LEE de la tabla (la carga la hace el cron; jamás se consulta la red\n"+
"  -- aquí: un timeout del proveedor bloquearía la emisión).\n"+
"  if upper(coalesce(p_moneda,'PEN')) = 'USD' then\n"+
"    v_tc := tc_venta(v_femi);\n"+
"    if v_tc is null or v_tc <= 0 then\n"+
"      raise exception 'SIN_TIPO_CAMBIO: no hay tipo de cambio para % — se carga solo cada día; reintenta en unos minutos', v_femi; end if;\n"+
"  else v_tc := 1; end if;\n"+
"  v_total_pen := round(v_total * v_tc, 2);\n"+
PEEK);
// los guards de umbral pasan a evaluarse en soles
const G1="elsif p_tipo = 2 and v_total > 700 then";
chk('anchor umbral boleta', d.includes(G1));
d=d.replace(G1, "elsif p_tipo = 2 and v_total_pen > 700 then");
const G2="if v_total >= 2000 and not p_exportacion and coalesce(trim(p_medio_pago),'') = '' then";
chk('anchor bancarización', d.includes(G2));
d=d.replace(G2, "if v_total_pen >= 2000 and not p_exportacion and coalesce(trim(p_medio_pago),'') = '' then");
const G3="if p_detraccion and (coalesce(p_exportacion,false) or not (p_tipo = 1 and v_total > 700)) then";
chk('anchor detracción', d.includes(G3));
d=d.replace(G3, "if p_detraccion and (coalesce(p_exportacion,false) or not (p_tipo = 1 and v_total_pen > 700)) then");
// la detracción se DEPOSITA en soles → se guarda convertida
const G4="v_detr := case when p_detraccion then round(v_total*0.12,2) else 0 end;";
chk('anchor monto detracción', d.includes(G4));
d=d.replace(G4, "v_detr := case when p_detraccion then round(v_total_pen*0.12,2) else 0 end;   -- el depósito SPOT va en soles");
// persistir el TC usado (sustenta la detracción; jamás se recalcula después)
chk('anchor insert', d.includes('insert into comprobantes(fecha_emision,'));
d=d.replace('insert into comprobantes(fecha_emision,', 'insert into comprobantes(tipo_cambio,fecha_emision,');
d=d.replace('values(v_femi,', 'values(case when v_tc = 1 then null else v_tc end,v_femi,');
if(!pass){await c.query('rollback');console.log('✗ anchors');process.exit(1);}
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
const back=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
chk('umbrales en soles + TC persistido', /v_total_pen > 700/.test(back) && /v_total_pen >= 2000/.test(back) && /SIN_TIPO_CAMBIO/.test(back));
// listar_comprobantes proyecta el TC (para el ticket)
let L=(await c.query("select pg_get_functiondef('public.listar_comprobantes'::regproc) d")).rows[0].d;
if(!/tipo_cambio/.test(L)){ L=L.replace(', fecha_emision', ', fecha_emision, tipo_cambio'); await c.query('CREATE OR REPLACE '+L.slice(L.indexOf('FUNCTION'))); }
chk('listar_comprobantes proyecta tipo_cambio', /tipo_cambio/.test((await c.query("select pg_get_functiondef('public.listar_comprobantes'::regproc) d")).rows[0].d));
await c.query('commit');

// ── carga inicial: hoy + los días del plazo de emisión (con pausa: el proveedor limita ráfagas) ──
console.log('\ncargando tipo de cambio (hoy + 7 días atrás)…');
for (let i = 0; i <= 7; i++) {
  const r=(await c.query("select tc_cargar(((now() at time zone 'America/Lima')::date - $1::int)) d",[i])).rows[0].d;
  console.log('  '+(r.fecha||'')+': '+(r.ok ? (r.ya ? 'ya estaba' : 'venta '+r.venta) : 'sin dato ('+r.error+')'));
  await new Promise(rs=>setTimeout(rs, 1600));   // evita el 429
}
const n=(await c.query('select count(*)::int n from tipo_cambio')).rows[0].n;
const hoy=(await c.query("select tc_venta((now() at time zone 'America/Lima')::date) v")).rows[0].v;
chk('tabla poblada y tc_venta responde', n>0 && Number(hoy)>0, {dias:n, tc_hoy:hoy});
// regla del art. 20.2: una fecha sin publicación toma el último anterior
const dom=(await c.query("select tc_venta(f) v, f from (select max(fecha) f from tipo_cambio) s")).rows[0];
chk('regla último publicado disponible', Number(dom.v)>0, {fecha:dom.f, venta:dom.v});

// cron diario 7:05 AM Lima (12:05 UTC)
try{
  await c.query("select cron.unschedule('tc-diario')").catch(()=>{});
  await c.query("select cron.schedule('tc-diario','5 12 * * *', $$select public.tc_cargar()$$)");
  const j=(await c.query("select schedule from cron.job where jobname='tc-diario'")).rows[0];
  chk('cron diario programado', !!j, j && j.schedule);
}catch(e){ console.log('· cron no programado ('+e.message.slice(0,60)+') — cargar manualmente con select tc_cargar()'); }

const c2=mk();await c2.connect();
const f=(await c2.query("select count(*)::int n from tipo_cambio")).rows[0].n;
const col=(await c2.query("select count(*)::int n from information_schema.columns where table_name='comprobantes' and column_name='tipo_cambio'")).rows[0].n;
console.log('\n[fresca] días de TC: '+f+' · columna comprobantes.tipo_cambio: '+col);
await c2.end();
if(!pass || f===0 || col!==1){console.log('✗ INCOMPLETO');process.exit(1);}
console.log('\n★ tipo de cambio automático (SUNAT) + umbrales en soles — LISTO');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
