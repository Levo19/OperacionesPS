-- ============================================================
-- Control de Apps del ecosistema (estado + horario) editable desde PS.
-- Reemplaza el lock hardcodeado 8 PM de OperacionesPS por un horario
-- que el Administrador abre/cierra desde el panel.
-- ============================================================
create table if not exists app_config (
  app_id          text primary key,                 -- 'operacionesps'
  nombre          text,
  estado          text default 'abierta' check (estado in ('abierta','cerrada','mantenimiento')),
  hora_apertura   text,                              -- 'HH:MM' (null/'' = sin tope inferior)
  hora_cierre     text,                              -- 'HH:MM' (null/'' = sin tope superior)
  dias            int[] default '{0,1,2,3,4,5,6}',   -- 0=domingo … 6=sábado (días operativos)
  mensaje         text,                              -- aviso cuando está cerrada
  actualizado_at  timestamptz default now(),
  actualizado_por text
);
alter table app_config enable row level security;   -- sin policies: se expone solo por funciones SECURITY DEFINER

-- estado calculado en TZ Lima (lo consulta la app; público)
create or replace function get_app_estado(p_app text)
  returns jsonb language plpgsql stable security definer set search_path=public as
$$
declare r app_config; v_now time; v_dow int; v_open boolean;
begin
  select * into r from app_config where app_id=p_app;
  if not found then return jsonb_build_object('existe', false, 'abierta_ahora', true); end if;
  v_now := (now() at time zone 'America/Lima')::time;
  v_dow := extract(dow from (now() at time zone 'America/Lima'))::int;
  v_open := r.estado = 'abierta'
        and (r.dias is null or v_dow = any(r.dias))
        and case
              when coalesce(r.hora_apertura,'') = '' or coalesce(r.hora_cierre,'') = '' then
                   (coalesce(r.hora_apertura,'') = '' or v_now >= r.hora_apertura::time)
               and (coalesce(r.hora_cierre,'')   = '' or v_now <  r.hora_cierre::time)
              when r.hora_apertura::time <= r.hora_cierre::time then
                   v_now >= r.hora_apertura::time and v_now < r.hora_cierre::time
              else  -- horario que cruza medianoche (apertura > cierre, p.ej. 20:00→02:00)
                   v_now >= r.hora_apertura::time or v_now < r.hora_cierre::time
            end;
  return jsonb_build_object('existe', true, 'estado', r.estado, 'abierta_ahora', v_open,
    'hora_apertura', coalesce(r.hora_apertura,''), 'hora_cierre', coalesce(r.hora_cierre,''),
    'dias', r.dias, 'mensaje', coalesce(r.mensaje,''), 'nombre', r.nombre,
    'actualizado_por', r.actualizado_por, 'actualizado_at', r.actualizado_at);
end $$;
grant execute on function get_app_estado(text) to anon, authenticated;

-- admin: listar todas las apps (para el panel PS)
create or replace function admin_listar_apps()
  returns setof app_config language plpgsql stable security definer set search_path=public, auth as
$$ begin perform _req_admin(); return query select * from app_config order by nombre; end $$;

-- admin: upsert de configuración de una app
create or replace function admin_set_app_config(
    p_app text, p_nombre text, p_estado text, p_apertura text, p_cierre text,
    p_dias int[], p_mensaje text, p_por text)
  returns void language plpgsql security definer set search_path=public, auth as
$$
begin
  perform _req_admin();
  if p_estado not in ('abierta','cerrada','mantenimiento') then raise exception 'ESTADO_INVALIDO'; end if;
  insert into app_config(app_id,nombre,estado,hora_apertura,hora_cierre,dias,mensaje,actualizado_at,actualizado_por)
    values(p_app,p_nombre,p_estado,nullif(p_apertura,''),nullif(p_cierre,''),
           coalesce(p_dias,'{0,1,2,3,4,5,6}'),nullif(p_mensaje,''),now(),p_por)
  on conflict (app_id) do update set
    nombre=excluded.nombre, estado=excluded.estado, hora_apertura=excluded.hora_apertura,
    hora_cierre=excluded.hora_cierre, dias=excluded.dias, mensaje=excluded.mensaje,
    actualizado_at=now(), actualizado_por=excluded.actualizado_por;
end $$;

-- seed OperacionesPS abierta (sin tope horario) para poder probar ya
insert into app_config(app_id, nombre, estado)
  values('operacionesps','Operaciones PS','abierta')
  on conflict (app_id) do nothing;
