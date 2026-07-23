-- ============================================================
-- Apps v2 (2026-07-22): URL por app (copiar/compartir desde PS) + munayops.
-- El toggle/horario ya existía (get_app_estado, TZ Lima, cruce medianoche).
-- ============================================================
alter table app_config add column if not exists url text default '';

-- firma nueva con p_url (drop de la vieja para evitar ambigüedad de 8 args)
drop function if exists admin_set_app_config(text,text,text,text,text,int[],text,text);
create or replace function admin_set_app_config(
    p_app text, p_nombre text, p_estado text, p_apertura text, p_cierre text,
    p_dias int[], p_mensaje text, p_por text, p_url text default null)
  returns void language plpgsql security definer set search_path=public, auth as
$$
begin
  perform _req_admin();
  if p_estado not in ('abierta','cerrada','mantenimiento') then raise exception 'ESTADO_INVALIDO'; end if;
  insert into app_config(app_id,nombre,estado,hora_apertura,hora_cierre,dias,mensaje,url,actualizado_at,actualizado_por)
    values(p_app,p_nombre,p_estado,nullif(p_apertura,''),nullif(p_cierre,''),
           coalesce(p_dias,'{0,1,2,3,4,5,6}'),nullif(p_mensaje,''),coalesce(p_url,''),now(),p_por)
  on conflict (app_id) do update set
    nombre=excluded.nombre, estado=excluded.estado, hora_apertura=excluded.hora_apertura,
    hora_cierre=excluded.hora_cierre, dias=excluded.dias, mensaje=excluded.mensaje,
    url=coalesce(p_url, app_config.url),
    actualizado_at=now(), actualizado_por=excluded.actualizado_por;
end $$;
grant execute on function admin_set_app_config(text,text,text,text,text,int[],text,text,text) to authenticated;

-- seed/actualización de URLs (Vercel) + munayops
update app_config set url='https://operaciones-ps.vercel.app', nombre=coalesce(nombre,'Operaciones PS')
  where app_id='operacionesps';
insert into app_config(app_id, nombre, estado, url)
  values('munayops','Munay Ops · Hotel','abierta','https://munay-ops.vercel.app')
  on conflict (app_id) do update set url=excluded.url;
