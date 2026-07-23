-- ============================================================================
-- EXTINCIÓN DEL PIN (2026-07-22) — orden de Luis: "mátalo ya, solo Gmail".
-- 1) Gates del dinero reescritos a EQUIPO-ONLY (fuera el dual-run).
-- 2) DROP de RPCs legacy de PIN/empleados.
-- 3) DROP TABLE app_usuarios.
-- Desde ahora: la ÚNICA identidad es `equipo` (Gmail por invitación).
-- ============================================================================

create or replace function es_staff() returns boolean
language sql stable security definer set search_path = public, auth as
$$ select exists(select 1 from equipo p join equipo_accesos a on a.equipo_id = p.id
                 where p.auth_uid = auth.uid() and p.activo and a.activo
                   and a.app in ('ps','muelle','hotel')) $$;

create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public, auth as
$$ select coalesce((select a.rol from equipo p join equipo_accesos a on a.equipo_id = p.id
                    where p.auth_uid = auth.uid() and p.activo and a.activo and a.app = 'ps' limit 1) = 'admin', false) $$;

create or replace function mi_rol() returns text
language sql stable security definer set search_path = public, auth as
$$ select case when es_admin_app('ps') then 'Administrador'
               when exists(select 1 from equipo p join equipo_accesos a on a.equipo_id = p.id
                           where p.auth_uid = auth.uid() and p.activo and a.activo) then 'Operador' end $$;

create or replace function _hotel_quien() returns text
language sql stable security definer set search_path = public, auth as
$$ select coalesce((select nombre from equipo where auth_uid = auth.uid() and activo limit 1), 'staff') $$;

-- RPCs legacy fuera (cualquier firma)
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('admin_listar_empleados','admin_set_pin','admin_toggle_activo','seed_operador','listar_operadores')
  loop
    execute 'drop function ' || r.fn || ' cascade';
  end loop;
end $$;

drop table if exists app_usuarios cascade;

update sistema_catalogo set estado = 'eliminado',
  notas = 'ELIMINADA 2026-07-22 — Equipo Único (Gmail) es la única identidad'
  where nombre = 'app_usuarios';
