// GUARDIÁN DE COMPROBANTES (pedido dueño 2026-08-18): vigilar que cada CPE sea aceptado por NubeFact
// Y por SUNAT, con su motivo, y avisar al admin (push + alerta en la balanza) A TIEMPO para corregir.
// 4 casos, con PLAZOS PRUDENTES (no alarmar por una boleta de hace 2 horas):
//   1 rechazado por NubeFact          → INMEDIATO (JSON mal armado: hay que corregir y reemitir)
//   2 aceptado NubeFact, SUNAT sin CDR → factura >6h (van individuales, CDR en minutos) ·
//                                        boleta >36h (van por resumen diario, se procesan al día sig.)
//   3 baja/anulación enviada sin resolver → >48h
//   4 emisión que quedó 'pendiente'   → >2h sin respuesta
// Además: el reconciliador dejaba de mirar a los 3 días y NUNCA miraba anulaciones → ambos ampliados.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+JSON.stringify(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
await c.query('begin');

// ── 1) Vigilancia: un solo lugar de verdad para "qué hay que revisar" (usa PS, el cron y el push)
await c.query(`
create or replace function public.cpe_guardian(p_dias int default 60)
returns jsonb language plpgsql stable security definer set search_path to 'public','auth' as $$
declare v jsonb; begin
  perform _req_staff();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.sev, x.creado_at desc), '[]'::jsonb) into v from (
    select id, tipo, serie, numero, cliente_nombre, cliente_doc, total, moneda, estado,
      coalesce(aceptada_por_sunat,false) aceptada_por_sunat, anulacion_estado, errores, sunat_descripcion,
      to_char(coalesce(fecha_emision,(creado_at at time zone 'America/Lima')::date),'YYYY-MM-DD') fecha,
      to_char(creado_at at time zone 'America/Lima','YYYY-MM-DD HH24:MI') creado, creado_at,
      round(extract(epoch from now()-creado_at)/3600) horas,
      case
        when estado='rechazada' then 'nubefact_rechazo'
        when estado='pendiente' then 'sin_respuesta'
        when estado='anulada' and anulacion_estado in ('enviada','error_baja') then 'baja_sin_resolver'
        else 'sunat_pendiente' end caso,
      case
        when estado='rechazada' then 1
        when estado='pendiente' then 2
        when estado='anulada' and anulacion_estado in ('enviada','error_baja') then 3
        else 4 end sev,
      case
        when estado='rechazada' then 'NubeFact RECHAZÓ el comprobante — revisa el detalle y reemítelo corregido'
        when estado='pendiente' then 'La emisión quedó sin respuesta — el reconciliador la consulta cada hora'
        when estado='anulada' and anulacion_estado in ('enviada','error_baja') then 'La anulación fue enviada pero SUNAT no la confirmó'
        when tipo=1 then 'Factura aceptada por NubeFact pero SUNAT no devolvió el CDR'
        else 'Boleta aceptada por NubeFact pero SUNAT no la confirmó (resumen diario) — verifica en NubeFact que el resumen se haya enviado' end explicacion
    from comprobantes
    where creado_at >= now() - (greatest(coalesce(p_dias,60),1) || ' days')::interval
      and (
        estado = 'rechazada'
        or (estado = 'pendiente' and creado_at < now() - interval '2 hours')
        or (estado = 'anulada' and anulacion_estado in ('enviada','error_baja') and coalesce(anulacion_at,creado_at) < now() - interval '48 hours')
        or (estado = 'aceptada' and coalesce(aceptada_por_sunat,false) = false
            and creado_at < now() - (case when tipo = 1 then interval '6 hours' else interval '36 hours' end))
      )
  ) x;
  return v;
end $$`);
chk('cpe_guardian creada', (await c.query("select count(*)::int n from pg_proc where proname='cpe_guardian'")).rows[0].n===1);

// ── 2) Suscripciones Web Push (VAPID) del panel — una por dispositivo del admin
await c.query(`
create table if not exists public.push_subs (
  id bigserial primary key,
  auth_uid uuid not null,
  app text not null default 'ps',
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  ua text,
  creado_at timestamptz default now(),
  ultimo_ok timestamptz,
  fallos int default 0
)`);
await c.query('alter table public.push_subs enable row level security');
await c.query('drop policy if exists push_subs_propias on public.push_subs');
await c.query("create policy push_subs_propias on public.push_subs for all using (auth_uid = auth.uid()) with check (auth_uid = auth.uid())");
await c.query('revoke truncate, trigger, references on public.push_subs from anon, authenticated');
await c.query(`
create or replace function public.push_suscribir(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','auth' as $$
begin
  perform _req_staff();
  if auth.uid() is null then raise exception 'NO_AUTH'; end if;
  insert into push_subs(auth_uid, app, endpoint, p256dh, auth, ua)
    values(auth.uid(), coalesce(p->>'app','ps'), p->>'endpoint', p->>'p256dh', p->>'auth', left(p->>'ua',200))
  on conflict (endpoint) do update set auth_uid=excluded.auth_uid, p256dh=excluded.p256dh, auth=excluded.auth, ua=excluded.ua, fallos=0;
  return jsonb_build_object('ok',true);
end $$`);
await c.query(`
create or replace function public.push_desuscribir(p_endpoint text)
returns jsonb language plpgsql security definer set search_path to 'public','auth' as $$
begin
  perform _req_staff();
  delete from push_subs where endpoint = p_endpoint and auth_uid = auth.uid();
  return jsonb_build_object('ok',true);
end $$`);
// Solo el cron/servicio (service_role) lee TODAS las suscripciones de los admins
await c.query(`
create or replace function public.push_subs_admins()
returns jsonb language sql stable security definer set search_path to 'public','auth' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth)),'[]'::jsonb)
  from push_subs s
  where s.app='ps' and coalesce(s.fallos,0) < 5
    and exists (select 1 from equipo p join equipo_accesos a on a.equipo_id=p.id
                where p.auth_uid = s.auth_uid and a.app='ps' and a.rol='admin' and p.activo and a.activo)
$$`);
await c.query('revoke all on function public.push_subs_admins() from public, anon, authenticated');
await c.query(`
create or replace function public.push_marcar(p_id bigint, p_ok boolean)
returns void language sql security definer set search_path to 'public' as $$
  update push_subs set ultimo_ok = case when p_ok then now() else ultimo_ok end,
    fallos = case when p_ok then 0 else coalesce(fallos,0)+1 end where id = p_id
$$`);
await c.query('revoke all on function public.push_marcar(bigint,boolean) from public, anon, authenticated');
chk('push_subs + RPCs', (await c.query("select count(*)::int n from pg_proc where proname in ('push_suscribir','push_desuscribir','push_subs_admins','push_marcar')")).rows[0].n===4);
chk('push_subs_admins NO ejecutable por anon', (await c.query("select has_function_privilege('anon','public.push_subs_admins()','execute') x")).rows[0].x===false);

// ── 3) Registro de avisos enviados (para no repetir el mismo push cada hora)
await c.query(`
create table if not exists public.cpe_avisos (
  comprobante_id text not null,
  caso text not null,
  avisado_at timestamptz default now(),
  primary key (comprobante_id, caso)
)`);
await c.query('alter table public.cpe_avisos enable row level security');
await c.query('drop policy if exists cpe_avisos_staff on public.cpe_avisos');
await c.query("create policy cpe_avisos_staff on public.cpe_avisos for select using (es_staff())");
// Qué avisos NUEVOS hay (aún no notificados). Lo llama la Edge del guardián con service_role.
await c.query(`
create or replace function public.cpe_avisos_pendientes()
returns jsonb language plpgsql security definer set search_path to 'public','auth' as $$
declare v jsonb; begin
  -- corre como service_role desde el cron: no hay auth.uid(); el gate se cubre con REVOKE a anon/authenticated
  select coalesce(jsonb_agg(g),'[]'::jsonb) into v
  from jsonb_array_elements(cpe_guardian_interno(60)) g
  where not exists (select 1 from cpe_avisos a where a.comprobante_id = g->>'id' and a.caso = g->>'caso');
  return v;
end $$`);
// misma lógica que cpe_guardian pero sin _req_staff (para el cron); se mantiene UNA definición copiando el cuerpo
const cuerpo=(await c.query("select pg_get_functiondef('public.cpe_guardian'::regproc) d")).rows[0].d
  .replace('FUNCTION public.cpe_guardian(','FUNCTION public.cpe_guardian_interno(')
  .replace("  perform _req_staff();\n","");
await c.query('CREATE OR REPLACE '+cuerpo.slice(cuerpo.indexOf('FUNCTION')));
await c.query('revoke all on function public.cpe_guardian_interno(int) from public, anon, authenticated');
await c.query('revoke all on function public.cpe_avisos_pendientes() from public, anon, authenticated');
await c.query(`
create or replace function public.cpe_avisos_marcar(p jsonb)
returns void language sql security definer set search_path to 'public' as $$
  insert into cpe_avisos(comprobante_id, caso)
  select x->>'id', x->>'caso' from jsonb_array_elements(p) x
  on conflict do nothing
$$`);
await c.query('revoke all on function public.cpe_avisos_marcar(jsonb) from public, anon, authenticated');
chk('avisos: tabla + pendientes + marcar', (await c.query("select count(*)::int n from pg_proc where proname in ('cpe_avisos_pendientes','cpe_avisos_marcar','cpe_guardian_interno')")).rows[0].n===3);

// ── 4) Reconciliador: ventana 60 días (era 3) + también anulaciones enviadas
let r=(await c.query("select pg_get_functiondef('public.reconciliar_comprobantes'::regproc) d")).rows[0].d;
const RW="             where (estado in ('pendiente','rechazada') or (estado='aceptada' and coalesce(aceptada_por_sunat,false)=false))";
chk('anchor reconciliador', r.includes(RW));
r=r.replace(RW,"             where (estado in ('pendiente','rechazada') or (estado='aceptada' and coalesce(aceptada_por_sunat,false)=false)\n                    or (estado='anulada' and anulacion_estado in ('enviada','error_baja')))");
await c.query('CREATE OR REPLACE '+r.slice(r.indexOf('FUNCTION')));
await c.query("select cron.unschedule('ps-fac-reconciliar')").catch(()=>{});
await c.query("select cron.schedule('ps-fac-reconciliar','13 * * * *', $$select reconciliar_comprobantes(60);$$)");
chk('reconciliador: 60 días + anulaciones', /anulacion_estado in \('enviada','error_baja'\)/.test((await c.query("select pg_get_functiondef('public.reconciliar_comprobantes'::regproc) d")).rows[0].d)
  && (await c.query("select command from cron.job where jobname='ps-fac-reconciliar'")).rows[0].command.includes('(60)'));

// ── verificación con datos reales ──
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:adm.u,role:'authenticated'})]);
const g=(await c.query('select cpe_guardian(60) d')).rows[0].d;
const porCaso={}; g.forEach(x=>porCaso[x.caso]=(porCaso[x.caso]||0)+1);
console.log('\n  guardián hoy:', JSON.stringify(porCaso));
chk('detecta los 4 rechazados de NubeFact', porCaso.nubefact_rechazo===4);
chk('detecta boletas SUNAT-pendientes >36h (no las recientes)', porCaso.sunat_pendiente>=25 && !g.some(x=>x.caso==='sunat_pendiente' && x.horas<36));
chk('cada aviso trae explicación humana', g.every(x=>x.explicacion && x.explicacion.length>20));
const pend=(await c.query('select cpe_avisos_pendientes() d')).rows[0].d;
chk('avisos pendientes = todo el guardián (nada notificado aún)', pend.length===g.length, {n:pend.length});
if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
const c2=mk();await c2.connect();
console.log('\n[fresca] funciones:', (await c2.query("select count(*)::int n from pg_proc where proname in ('cpe_guardian','cpe_guardian_interno','cpe_avisos_pendientes','cpe_avisos_marcar','push_suscribir','push_desuscribir','push_subs_admins','push_marcar')")).rows[0].n, '/ 8');
await c2.end();
console.log('\n★ guardián de CPE (backend) — COMMIT verificado');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
