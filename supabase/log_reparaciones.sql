-- ============================================================
-- Log de Reparaciones — modo programador de JADE (2026-07-10).
-- Tabla + RPCs para registrar/consultar reparaciones. JADE la lee vía tool
-- consultar_reparaciones. Aplicado en vivo; este archivo es el registro del repo.
-- ============================================================
create table if not exists reparaciones(
  id bigint generated always as identity primary key,
  fecha date not null default (now() at time zone 'America/Lima')::date,
  area text, titulo text not null, causa text, fix text, version text, severidad text,
  autor text default 'Claude Code', creado_at timestamptz default now());
alter table reparaciones enable row level security;
revoke insert,update,delete,truncate on reparaciones from anon,authenticated;
drop policy if exists sel_staff_rep on reparaciones;
create policy sel_staff_rep on reparaciones for select to authenticated using (es_staff());

-- registrar (admin): p = {area,titulo,causa,fix,version,severidad,autor}
create or replace function registrar_reparacion(p jsonb) returns bigint language plpgsql security definer set search_path to 'public' as $fx$
declare v_id bigint; begin perform _req_admin();
  insert into reparaciones(area,titulo,causa,fix,version,severidad,autor)
  values(p->>'area',p->>'titulo',p->>'causa',p->>'fix',p->>'version',p->>'severidad',coalesce(p->>'autor','Claude Code')) returning id into v_id;
  return v_id; end $fx$;
grant execute on function registrar_reparacion(jsonb) to authenticated;

-- listar (staff)
create or replace function listar_reparaciones(p_limite int default 40) returns jsonb language plpgsql security definer set search_path to 'public' as $fx$
begin perform _req_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('fecha',fecha,'area',area,'titulo',titulo,'causa',causa,'fix',fix,'version',version,'severidad',severidad) order by fecha desc, id desc)
    from (select * from reparaciones order by fecha desc, id desc limit greatest(1,least(coalesce(p_limite,40),200))) s),'[]'::jsonb); end $fx$;
grant execute on function listar_reparaciones(int) to authenticated;
