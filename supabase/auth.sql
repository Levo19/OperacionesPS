-- ============================================================
-- Auth PIN -> Supabase Auth  (camino B: el PWA hace signInWithPassword)
-- Cada persona de PERSONAL_MASTER = un usuario auth.users con
-- email sintetico {id}@paracas.local  y  password = su PIN.
-- El PIN NUNCA se guarda en claro: auth.users lo cifra con bcrypt (pgcrypto).
-- El seeding real lo hace seed_auth.js (lee los PINs de un archivo gitignoreado).
-- ============================================================
create extension if not exists pgcrypto;

-- rol del usuario logueado, leido del JWT -> app_usuarios. SECURITY DEFINER
-- para poder leer app_usuarios aunque la RLS de esa tabla niegue al rol normal.
create or replace function mi_rol() returns text
  language sql stable security definer set search_path = public, auth as
$$ select rol from app_usuarios where auth_uid = auth.uid() and activo $$;

-- ¿el usuario logueado existe y esta activo? (para policies de escritura)
create or replace function es_staff() returns boolean
  language sql stable security definer set search_path = public, auth as
$$ select exists(select 1 from app_usuarios where auth_uid = auth.uid() and activo) $$;

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
  insert into app_usuarios (id, nombre, rol, auth_uid, activo)
    values (p_id, p_nombre, p_rol, v_uid, true)
  on conflict (id) do update
    set nombre = excluded.nombre, rol = excluded.rol, auth_uid = excluded.auth_uid, activo = true;
  return v_uid;
end $$;
