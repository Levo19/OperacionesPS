-- ============================================================
-- Organización inteligente del sistema (2026-07-11) — para que JADE (modo programador)
-- dé estructura/logs/errores al instante. Filosofía del dueño: NO botar, sino OPTIMIZAR y
-- ORGANIZAR. Lo "muerto" se DOCUMENTA (estado deprecado/sin_consumidor), no se borra.
-- Aplicado en vivo; este archivo es el registro del repo. (Seed del catálogo en el script de aplicación.)
-- ============================================================

-- 1) CATÁLOGO DEL SISTEMA — mapa vivo: qué existe, para qué, gate, quién lo usa, estado.
create table if not exists sistema_catalogo(
  id bigint generated always as identity primary key,
  tipo text, nombre text, proposito text, gate text, consumidores text,
  estado text default 'activo',           -- activo | sin_consumidor | deprecado
  notas text, actualizado timestamptz default now(),
  unique(tipo,nombre));
alter table sistema_catalogo enable row level security;
revoke insert,update,delete,truncate on sistema_catalogo from anon,authenticated;
drop policy if exists sel_staff_cat on sistema_catalogo;
create policy sel_staff_cat on sistema_catalogo for select to authenticated using (es_staff());

create or replace function listar_catalogo(p_estado text default null) returns jsonb language plpgsql security definer set search_path to 'public' as $fx$
begin perform _req_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('tipo',tipo,'nombre',nombre,'proposito',proposito,'gate',gate,'consumidores',consumidores,'estado',estado,'notas',notas) order by tipo,nombre)
    from sistema_catalogo where p_estado is null or estado=p_estado),'[]'::jsonb); end $fx$;
grant execute on function listar_catalogo(text) to authenticated;

-- 2) LOG DE EVENTOS/ERRORES en vivo (observabilidad). Las apps escriben; JADE lee.
create table if not exists app_eventos(
  id bigint generated always as identity primary key, ts timestamptz default now(),
  tipo text, app text, area text, mensaje text, detalle text, usuario text);
alter table app_eventos enable row level security;
revoke insert,update,delete,truncate on app_eventos from anon,authenticated;
drop policy if exists sel_staff_ev on app_eventos;
create policy sel_staff_ev on app_eventos for select to authenticated using (es_staff());

create or replace function registrar_evento(p jsonb) returns void language plpgsql security definer set search_path to 'public' as $fx$
begin perform _req_staff();
  insert into app_eventos(tipo,app,area,mensaje,detalle,usuario)
  values(coalesce(p->>'tipo','info'),p->>'app',p->>'area',left(coalesce(p->>'mensaje',''),500),left(coalesce(p->>'detalle',''),2000),p->>'usuario');
  delete from app_eventos where id < (select coalesce(max(id),0)-1000 from app_eventos);  -- auto-poda a 1000
end $fx$;
grant execute on function registrar_evento(jsonb) to authenticated;

create or replace function listar_eventos(p_tipo text default null, p_limite int default 30) returns jsonb language plpgsql security definer set search_path to 'public' as $fx$
begin perform _req_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('ts',to_char(ts at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),'tipo',tipo,'app',app,'area',area,'mensaje',mensaje) order by id desc)
    from (select * from app_eventos where p_tipo is null or tipo=p_tipo order by id desc limit greatest(1,least(coalesce(p_limite,30),200))) s),'[]'::jsonb); end $fx$;
grant execute on function listar_eventos(text,int) to authenticated;

-- JADE (Edge jade-chat) tiene tools: consultar_catalogo, consultar_eventos, consultar_reparaciones.
-- Para mantener el catálogo al día: insert/update en sistema_catalogo cuando se agregue/deprecar un objeto.
