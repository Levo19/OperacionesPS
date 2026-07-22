-- ============================================================================
-- EQUIPO ÚNICO PS · 2026-07-22
-- UNA identidad para todo el grupo: login Google (Gmail) por INVITACIÓN,
-- acceso por app (ps|muelle|hotel|landing) controlado desde PS Panel.
-- Decisión Luis: Gmail único para todos (sin híbrido). El PIN del muelle sigue
-- funcionando vía app_usuarios (fallback dual-run) hasta completar la migración.
-- REGLA DE ORO: es_staff()/es_admin() sostienen el dinero → se EXTIENDEN, nunca se rompen.
-- ============================================================================

create table if not exists equipo (
  id           bigint generated always as identity primary key,
  nombre       text not null,
  email        text not null default '',          -- gmail de invitación ('' = aún sin gmail)
  telefono     text default '',
  activo       boolean default true,
  auth_uid     uuid,                              -- se vincula en el 1er login Google (match por email)
  invitado_por text default '',
  creado       timestamptz default now(),
  aceptado_at  timestamptz
);
create unique index if not exists ux_personal_email on equipo(lower(email)) where email <> '';
create index if not exists ix_personal_uid on equipo(auth_uid) where auth_uid is not null;

create table if not exists equipo_accesos (
  equipo_id bigint not null references equipo(id) on delete cascade,
  app         text not null check (app in ('ps','muelle','hotel','landing')),
  rol         text not null default 'operador' check (rol in ('admin','operador')),
  activo      boolean default true,
  primary key (equipo_id, app)
);

alter table equipo enable row level security;
alter table equipo_accesos enable row level security;
-- cada quien ve su propia fila; el resto solo vía RPCs es_admin
drop policy if exists personal_self on equipo;
create policy personal_self on equipo for select to authenticated using (auth_uid = auth.uid());
grant select on equipo, equipo_accesos to authenticated;

-- ── helpers de identidad ──
create or replace function mi_miembro() returns equipo
language sql stable security definer set search_path = public, auth as
$$ select p.* from equipo p where p.auth_uid = auth.uid() and p.activo limit 1 $$;

create or replace function acceso_app(p_app text) returns text
language sql stable security definer set search_path = public, auth as
$$ select a.rol from equipo p join equipo_accesos a on a.equipo_id = p.id
   where p.auth_uid = auth.uid() and p.activo and a.activo and a.app = p_app limit 1 $$;

create or replace function es_admin_app(p_app text) returns boolean
language sql stable security definer set search_path = public, auth as
$$ select coalesce(acceso_app(p_app) = 'admin', false) $$;

-- ── DUAL-RUN: extender los gates del dinero (legacy app_usuarios SIGUE valiendo) ──
create or replace function es_staff() returns boolean
language sql stable security definer set search_path = public, auth as
$$ select exists(select 1 from app_usuarios where auth_uid = auth.uid() and activo)
       or exists(select 1 from equipo p join equipo_accesos a on a.equipo_id = p.id
                 where p.auth_uid = auth.uid() and p.activo and a.activo
                   and a.app in ('ps','muelle','hotel')) $$;

create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public, auth as
$$ select exists(select 1 from app_usuarios where auth_uid = auth.uid() and rol = 'Administrador' and coalesce(activo, true))
       or coalesce((select a.rol from equipo p join equipo_accesos a on a.equipo_id = p.id
                    where p.auth_uid = auth.uid() and p.activo and a.activo and a.app = 'ps' limit 1) = 'admin', false) $$;

create or replace function mi_rol() returns text
language sql stable security definer set search_path = public, auth as
$$ select coalesce(
     (select rol from app_usuarios where auth_uid = auth.uid() and activo),
     case when es_admin_app('ps') then 'Administrador'
          when exists(select 1 from equipo p join equipo_accesos a on a.equipo_id=p.id
                      where p.auth_uid = auth.uid() and p.activo and a.activo) then 'Operador' end) $$;

-- _hotel_quien: prefiere el nombre de la identidad única
create or replace function _hotel_quien() returns text
language sql stable security definer set search_path = public, auth as
$$ select coalesce(
     (select nombre from equipo where auth_uid = auth.uid() and activo limit 1),
     (select nombre from app_usuarios where auth_uid = auth.uid() limit 1),
     'staff') $$;

-- ── login Google: vincular invitación → identidad ──
create or replace function equipo_login() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_email text := lower(coalesce(auth.jwt()->>'email','')); v_p equipo;
begin
  if v_email = '' then return jsonb_build_object('ok', false, 'error', 'SIN_EMAIL'); end if;
  select * into v_p from equipo where lower(email) = v_email and activo limit 1;
  if v_p.id is null then return jsonb_build_object('ok', false, 'error', 'NO_INVITADO'); end if;
  update equipo set auth_uid = auth.uid(), aceptado_at = coalesce(aceptado_at, now()) where id = v_p.id;
  return jsonb_build_object('ok', true, 'nombre', v_p.nombre,
    'accesos', (select coalesce(jsonb_object_agg(a.app, a.rol), '{}'::jsonb)
                  from equipo_accesos a where a.equipo_id = v_p.id and a.activo));
end $$;

-- ── RPCs del módulo Equipo (PS Panel, solo admin) ──
create or replace function equipo_lista() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not es_admin() then raise exception 'NO_ADMIN'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', p.id, 'nombre', p.nombre, 'email', p.email, 'telefono', p.telefono,
    'activo', p.activo, 'aceptado', p.aceptado_at is not null,
    'accesos', (select coalesce(jsonb_object_agg(a.app, jsonb_build_object('rol', a.rol, 'activo', a.activo)), '{}'::jsonb)
                  from equipo_accesos a where a.equipo_id = p.id)
  ) order by p.activo desc, p.nombre) from equipo p), '[]'::jsonb);
end $$;

create or replace function equipo_invitar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_id bigint; v_email text := lower(trim(coalesce(p->>'email',''))); v_acc jsonb;
begin
  if not es_admin() then raise exception 'NO_ADMIN'; end if;
  if coalesce(p->>'nombre','') = '' then raise exception 'NOMBRE_REQUERIDO'; end if;
  if p ? 'id' and coalesce(p->>'id','') <> '' then
    v_id := (p->>'id')::bigint;
    update equipo set nombre = p->>'nombre', email = v_email,
      telefono = coalesce(p->>'telefono', telefono) where id = v_id;
    if not found then raise exception 'PERSONA_NO_EXISTE'; end if;
  else
    if v_email <> '' and exists(select 1 from equipo where lower(email) = v_email) then
      raise exception 'EMAIL_YA_INVITADO';
    end if;
    insert into equipo (nombre, email, telefono, invitado_por)
    values (p->>'nombre', v_email, coalesce(p->>'telefono',''), _hotel_quien())
    returning id into v_id;
  end if;
  if p ? 'accesos' then
    for v_acc in select * from jsonb_array_elements(p->'accesos') loop
      insert into equipo_accesos (equipo_id, app, rol, activo)
      values (v_id, v_acc->>'app', coalesce(nullif(v_acc->>'rol',''), 'operador'), coalesce((v_acc->>'activo')::boolean, true))
      on conflict (equipo_id, app) do update set rol = excluded.rol, activo = excluded.activo;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function equipo_toggle(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare v_id bigint := (p->>'equipo_id')::bigint; v_activo boolean := (p->>'activo')::boolean;
begin
  if not es_admin() then raise exception 'NO_ADMIN'; end if;
  -- anti-lockout: no puedes desactivarte a ti mismo
  if not v_activo and exists(select 1 from equipo where id = v_id and auth_uid = auth.uid()) then
    raise exception 'ANTI_LOCKOUT: no puedes desactivarte a ti mismo';
  end if;
  update equipo set activo = v_activo where id = v_id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function mi_miembro(), acceso_app(text), es_admin_app(text), equipo_login(),
  equipo_lista(), equipo_invitar(jsonb), equipo_toggle(jsonb) to authenticated;

-- ── Backfill: el equipo actual del muelle entra a la identidad única (sin gmail aún) ──
insert into equipo (nombre, invitado_por)
select u.nombre, 'backfill' from app_usuarios u
where u.activo and not exists (select 1 from equipo p where p.nombre = u.nombre);
insert into equipo_accesos (equipo_id, app, rol)
select p.id, 'muelle', case when u.rol = 'Administrador' then 'admin' else 'operador' end
from equipo p join app_usuarios u on u.nombre = p.nombre
on conflict (equipo_id, app) do nothing;
insert into equipo_accesos (equipo_id, app, rol)
select p.id, 'ps', 'admin' from equipo p join app_usuarios u on u.nombre = p.nombre and u.rol = 'Administrador'
on conflict (equipo_id, app) do nothing;

-- Luis con todos los accesos (gmail conocido del ecosistema)
insert into equipo (nombre, email, invitado_por)
select 'Luis Vasquez (Levo)', 'luisvo.19@gmail.com', 'seed'
where not exists (select 1 from equipo where lower(email) = 'luisvo.19@gmail.com');
insert into equipo_accesos (equipo_id, app, rol)
select p.id, x.app, 'admin' from equipo p, (values ('ps'),('muelle'),('hotel'),('landing')) as x(app)
where lower(p.email) = 'luisvo.19@gmail.com'
on conflict (equipo_id, app) do nothing;

insert into sistema_catalogo (tipo, nombre, proposito, gate, consumidores, estado)
select 'tabla', 'equipo', 'Identidad ÚNICA del grupo PS (Google por invitación; acceso por app)', 'RLS self + RPCs es_admin; es_staff/es_admin dual-run', 'Todas las apps PS', 'activo'
where not exists (select 1 from sistema_catalogo where nombre = 'equipo');
