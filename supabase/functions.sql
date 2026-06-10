create or replace function registrar_movimiento(p_id text,p_op text,p_tipo text,p_contacto text,p_pax int,p_precio numeric,p_monto numeric,p_operador text)
returns text language plpgsql as $$
declare v_cap int; v_ocupados int;
begin
  perform 1 from operaciones where id=p_op for update;          -- lock fila operación
  select e.capacidad_pax into v_cap from operaciones o join embarcaciones e on e.id=o.bote_id where o.id=p_op;
  select coalesce(sum(cant_pax),0) into v_ocupados from movimientos where operacion_id=p_op and lower(coalesce(estado,'')) not like '%cancel%';
  if v_cap is not null and v_ocupados + p_pax > v_cap then
    raise exception 'AFORO: solo quedan % cupos (cap %, ocupados %)', v_cap-v_ocupados, v_cap, v_ocupados;
  end if;
  insert into movimientos(id,operacion_id,tipo,contacto_id,cant_pax,precio_unit,monto_total,operador,estado)
    values(p_id,p_op,p_tipo,p_contacto,p_pax,p_precio,p_monto,p_operador,'Embarcado');
  return p_id;
end $$;
