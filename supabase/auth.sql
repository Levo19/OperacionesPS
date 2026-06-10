-- ============================================================
-- Auth PIN -> Supabase Auth  (camino B: el PWA hace signInWithPassword)
-- Cada persona de PERSONAL_MASTER = un usuario auth.users con
-- email sintetico {id}@paracas.local  y  password = su PIN.
-- El PIN NUNCA se guarda en claro: auth.users lo cifra con bcrypt (pgcrypto).
-- El seeding real lo hace seed_auth.js (lee los PINs de un archivo gitignoreado).
-- ============================================================
create extension if not exists pgcrypto;

-- PIN en claro (además del bcrypt en auth.users) para que el Administrador pueda
-- VERLO desde PS (el bcrypt es irreversible). Acceso solo por RPC admin. Mismo
-- criterio que la hoja PERSONAL_MASTER (que ya guarda PINs en texto).
alter table app_usuarios add column if not exists pin text;

-- rol del usuario logueado, leido del JWT -> app_usuarios. SECURITY DEFINER
-- para poder leer app_usuarios aunque la RLS de esa tabla niegue al rol normal.
create or replace function mi_rol() returns text
  language sql stable security definer set search_path = public, auth as
$$ select rol from app_usuarios where auth_uid = auth.uid() and activo $$;

-- ¿el usuario logueado existe y esta activo? (para policies de escritura)
create or replace function es_staff() returns boolean
  language sql stable security definer set search_path = public, auth as
$$ select exists(select 1 from app_usuarios where auth_uid = auth.uid() and activo) $$;

-- ── Gestión de empleados desde PS (solo Administrador) ──────
create or replace function _req_admin() returns void language plpgsql as
$$ begin if coalesce(mi_rol(),'') <> 'Administrador' then raise exception 'NO_ADMIN: requiere Administrador'; end if; end $$;

-- lista TODOS los empleados (activos e inactivos) para el módulo de PS, con PIN visible
drop function if exists admin_listar_empleados();
create or replace function admin_listar_empleados()
  returns table(id text, nombre text, rol text, activo boolean, email text, pin text)
  language plpgsql stable security definer set search_path=public, auth as
$$ begin perform _req_admin();
   return query select a.id, a.nombre, a.rol, a.activo, lower(a.id)||'@paracas.local', a.pin
                from app_usuarios a order by a.activo desc, a.nombre; end $$;

-- alta o reseteo de PIN (upsert vía seed_operador). p_id: EMP-xx existente o USR_ nuevo.
create or replace function admin_set_pin(p_id text, p_nombre text, p_rol text, p_pin text)
  returns uuid language plpgsql security definer set search_path=public, auth, extensions as
$$ begin perform _req_admin();
   -- exactamente 4 dígitos: el login del muelle hace auto-submit a 4; un PIN más
   -- largo dejaría al operador sin poder entrar. Todo el ecosistema PS usa 4 dígitos.
   if coalesce(p_pin,'') !~ '^\d{4}$' then raise exception 'PIN_FORMATO: deben ser 4 dígitos'; end if;
   return seed_operador(p_id, p_nombre, p_rol, p_pin); end $$;

-- activar/desactivar (es_staff() ya filtra por activo → desactivado no lee ni escribe)
create or replace function admin_toggle_activo(p_id text, p_activo boolean)
  returns void language plpgsql security definer set search_path=public, auth as
$$ begin perform _req_admin(); update app_usuarios set activo=p_activo where id=p_id; end $$;

-- Lista pública de operadores (para poblar el login ANTES de autenticarse).
-- Solo nombre + email sintético; sin PIN ni datos sensibles. Callable por anon.
create or replace function listar_operadores()
  returns table(id text, nombre text, email text)
  language sql stable security definer set search_path=public as
$$ select id, nombre, lower(id)||'@paracas.local' from app_usuarios
   where rol='Operador' and activo order by nombre $$;
grant execute on function listar_operadores() to anon, authenticated;

-- Alta/actualizacion idempotente de un operador con PIN.
-- Crea (o re-apunta) el usuario en auth.users con email {id}@paracas.local y
-- password=p_pin cifrado bcrypt, y lo mapea en app_usuarios. Re-ejecutable:
-- si ya existe el email, solo actualiza el password/rol/nombre.
-- search_path incluye `extensions` porque en Supabase pgcrypto (crypt/gen_salt) vive ahi.
create or replace function seed_operador(p_id text, p_nombre text, p_rol text, p_pin text)
  returns uuid language plpgsql security definer set search_path = public, auth, extensions as
$$
declare v_email text := lower(p_id) || '@paracas.local'; v_uid uuid;
begin
  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      -- GoTrue escanea estos como string NOT NULL: si quedan NULL el login revienta (500)
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current, reauthentication_token
    ) values (
      v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      v_email, crypt(p_pin, gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('provider','email','providers',array['email']),
      jsonb_build_object('nombre', p_nombre, 'rol', p_rol),
      '', '', '', '', '', ''
    );
  else
    update auth.users
       set encrypted_password = crypt(p_pin, gen_salt('bf')), updated_at = now(),
           raw_user_meta_data = jsonb_build_object('nombre', p_nombre, 'rol', p_rol)
     where id = v_uid;
  end if;
  insert into app_usuarios (id, nombre, rol, auth_uid, activo, pin)
    values (p_id, p_nombre, p_rol, v_uid, true, p_pin)
  on conflict (id) do update
    set nombre = excluded.nombre, rol = excluded.rol, auth_uid = excluded.auth_uid, activo = true, pin = excluded.pin;
  return v_uid;
end $$;
