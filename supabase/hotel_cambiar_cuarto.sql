-- Cambio de habitación (cuarto en mal estado / estrategia del concierge).
-- El EXCLUDE anti doble-reserva protege el movimiento: si el destino tiene
-- solape de fechas, la transacción revienta con CUARTO_OCUPADO.
create or replace function hotel_cambiar_cuarto(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_res hotel_reservas; v_new hotel_cuartos; v_old bigint;
begin
  perform _req_staff();
  select * into v_res from hotel_reservas where id = (p->>'reserva_id')::bigint;
  if v_res.id is null then raise exception 'RESERVA_NO_EXISTE'; end if;
  if v_res.estado not in ('reservada','en_casa') then raise exception 'ESTADO_INVALIDO: %', v_res.estado; end if;
  select * into v_new from hotel_cuartos where id = (p->>'cuarto_id')::bigint and activo;
  if v_new.id is null then raise exception 'CUARTO_NO_EXISTE'; end if;
  if v_new.id = v_res.cuarto_id then raise exception 'MISMO_CUARTO: ya está en ese cuarto'; end if;
  v_old := v_res.cuarto_id;
  update hotel_reservas set cuarto_id = v_new.id where id = v_res.id;
  if v_res.estado = 'en_casa' then
    -- el huésped ya usó el cuarto viejo → housekeeping
    update hotel_cuartos set limpieza = 'sucio' where id = v_old;
  end if;
  return jsonb_build_object('ok', true, 'de', v_old, 'a', v_new.id);
exception when exclusion_violation then
  raise exception 'CUARTO_OCUPADO: ese cuarto ya tiene reserva en esas fechas';
end $$;
grant execute on function hotel_cambiar_cuarto(jsonb) to authenticated;
revoke execute on function hotel_cambiar_cuarto(jsonb) from anon;
