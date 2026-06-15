-- ============================================================
-- OperacionesPS · Reservas: autor (creado_por)
-- ------------------------------------------------------------
-- Agrega columna creado_por y hace que crear_reserva la guarde (manteniendo
-- la idempotencia por local_id). get_dashboard se modifica aparte (dashboard.sql)
-- para devolver tambien las reservas de HOY ya tomadas (Asignado/Pasado) y el
-- creado_por real. Seguro de re-ejecutar.
-- ============================================================
alter table reservas add column if not exists creado_por text;

create or replace function crear_reserva(
    p_fecha date, p_hora text, p_contacto text, p_cliente text, p_pax int, p_monto numeric, p_creador text, p_id text default null, p_local_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_id text; v_existing text;
begin
  perform _req_staff();
  if p_local_id is not null then
    select id into v_existing from reservas where local_id = p_local_id;
    if found then return v_existing; end if;
  end if;
  v_id := coalesce(p_id, gen_id('RES-','seq_res'));
  insert into reservas(id,fecha,hora,contacto_id,cliente,pax,estado,creado_at,creado_por,local_id)
    values(v_id,p_fecha,p_hora,nullif(p_contacto,''),p_cliente,p_pax,'Pendiente',now(),nullif(p_creador,''),p_local_id)
    on conflict (local_id) where local_id is not null do nothing;
  if not found and p_local_id is not null then
    select id into v_id from reservas where local_id = p_local_id;
  end if;
  return v_id;
end $$;
grant execute on function crear_reserva(date,text,text,text,int,numeric,text,text,text) to anon, authenticated;
