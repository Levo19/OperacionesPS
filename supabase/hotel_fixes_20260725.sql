-- ============================================================================
-- FIXES 2026-07-25 tras revisión adversarial senior (dinero/concurrencia).
-- 1. hotel_pago: recargo tarjeta ATÓMICO (consumo + pago en una sola tx) → no
--    deja cargo huérfano si el pago falla; idempotente con un solo local_id.
-- 2. hotel_reservar: adelanto con tarjeta también aplica el 5% (no fuga).
-- 3. hotel_tour_estado: FOR UPDATE (evita lost-update → cargo huérfano por carrera).
-- 4. hotel_tour_crear: on conflict en el insert (doble tap concurrente = dup amable).
-- 5. hotel_nota: no borra la nota si el payload no trae la clave 'notas'.
-- 6. CON-18: la tarifa interna no se pisa en re-aplicaciones (respeta edición admin).
-- Compat: hotel_pago con `recargo` ausente (cliente viejo que ya manda monto=total)
--         se comporta idéntico → aplicar ESTE SQL ANTES de desplegar el cliente nuevo.
-- ============================================================================

-- 1) hotel_pago atómico con recargo opcional
create or replace function hotel_pago(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_id bigint;
        v_rec  numeric := coalesce(nullif(p->>'recargo','')::numeric, 0);
        v_base numeric := coalesce((p->>'monto')::numeric, 0);
        v_lid  text    := nullif(p->>'local_id','');
begin
  perform _req_staff();
  if v_rec > 0 then   -- cargo del recargo tarjeta EN LA MISMA TX que el pago
    insert into hotel_consumos (reserva_id, item, tipo, cantidad, precio, local_id, creado_por)
    values ((p->>'reserva_id')::bigint, 'Recargo tarjeta 5%', 'servicio', 1, v_rec,
            case when v_lid is null then null else v_lid || '-rec' end, _hotel_quien())
    on conflict (local_id) where local_id is not null do nothing;
  end if;
  insert into hotel_pagos (reserva_id, monto, medio, concepto, local_id, creado_por)
  values ((p->>'reserva_id')::bigint, v_base + v_rec, p->>'medio',
          coalesce(nullif(p->>'concepto',''), 'pago'), v_lid, _hotel_quien())
  on conflict (local_id) where local_id is not null do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from hotel_pagos where local_id = p->>'local_id'; end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'quien', _hotel_quien(), 'recargo', v_rec);
end $$;

-- 2) hotel_reservar: adelanto con tarjeta aplica 5% (atómico, no fuga de recargo)
create or replace function hotel_reservar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_id bigint;
        v_adelanto numeric := coalesce(nullif(p->>'adelanto','')::numeric, 0);
        v_medio text := coalesce(nullif(p->>'adelanto_medio',''), 'yape');
        v_rec numeric := 0; v_lid text := nullif(p->>'local_id','');
begin
  perform _req_staff();
  if coalesce(p->>'huesped','') = '' then raise exception 'HUESPED_REQUERIDO'; end if;
  insert into hotel_reservas (cuarto_id, huesped, documento, telefono, pax, fecha_in, fecha_out,
                              precio_noche, canal, notas, local_id, creado_por)
  values ((p->>'cuarto_id')::bigint, p->>'huesped', coalesce(p->>'documento',''), coalesce(p->>'telefono',''),
          coalesce(nullif(p->>'pax','')::int, 2), (p->>'fecha_in')::date, (p->>'fecha_out')::date,
          (p->>'precio_noche')::numeric, coalesce(nullif(p->>'canal',''), 'walkin'),
          coalesce(p->>'notas',''), v_lid, _hotel_quien())
  on conflict (local_id) where local_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from hotel_reservas where local_id = p->>'local_id';
    return jsonb_build_object('ok', true, 'id', v_id, 'dup', true);
  end if;
  if v_adelanto > 0 then
    if v_medio ilike 'tarjeta' then
      v_rec := round(v_adelanto * 0.05, 2);
      insert into hotel_consumos (reserva_id, item, tipo, cantidad, precio, local_id, creado_por)
      values (v_id, 'Recargo tarjeta 5%', 'servicio', 1, v_rec,
              case when v_lid is null then null else v_lid || '-adrec' end, _hotel_quien())
      on conflict (local_id) where local_id is not null do nothing;
    end if;
    insert into hotel_pagos (reserva_id, monto, medio, concepto, local_id, creado_por)
    values (v_id, v_adelanto + v_rec, v_medio, 'adelanto',
            case when v_lid is null then null else v_lid || '-ad' end, _hotel_quien())
    on conflict (local_id) where local_id is not null do nothing;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when exclusion_violation then
  raise exception 'CUARTO_OCUPADO: ese cuarto ya tiene reserva en esas fechas';
end $$;

-- 3) hotel_tour_estado con FOR UPDATE (bloquea la fila → sin lost-update)
create or replace function hotel_tour_estado(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_t hotel_tours; v_acc text := p->>'accion'; v_cid bigint;
begin
  perform _req_staff();
  select * into v_t from hotel_tours where id = (p->>'tour_id')::bigint for update;   -- lock de fila
  if v_t.id is null then raise exception 'TOUR_NO_EXISTE'; end if;

  if v_acc = 'realizado' then
    if v_t.estado = 'realizado' then return jsonb_build_object('ok', true, 'dup', true); end if;
    insert into hotel_consumos (reserva_id, item, tipo, cantidad, precio, local_id, creado_por)
    values (v_t.reserva_id, 'Tour: ' || v_t.tour || ' (' || to_char(v_t.fecha,'DD/MM') || ' ' || v_t.hora || ')',
            'tour', v_t.pax, v_t.precio_huesped, 'ht-' || v_t.id, _hotel_quien())
    on conflict (local_id) where local_id is not null do nothing
    returning id into v_cid;
    if v_cid is null then select id into v_cid from hotel_consumos where local_id = 'ht-' || v_t.id; end if;
    update hotel_tours set estado = 'realizado', consumo_id = v_cid where id = v_t.id;
  elsif v_acc in ('suspendido','cancelado') then
    if v_t.consumo_id is not null then delete from hotel_consumos where id = v_t.consumo_id; end if;
    if v_t.ops_reserva_id is not null then
      update reservas set estado = 'Anulada' where id = v_t.ops_reserva_id and estado in ('Pendiente','Asignado');
    end if;
    update hotel_tours set estado = v_acc, consumo_id = null where id = v_t.id;
  else
    raise exception 'ACCION_INVALIDA: %', v_acc;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- 4) hotel_tour_crear: on conflict en el insert de hotel_tours (doble tap concurrente)
create or replace function hotel_tour_crear(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_res hotel_reservas; v_cuarto text; v_id bigint; v_ops text;
  v_pax int := greatest(coalesce(nullif(p->>'pax','')::int, 1), 1);
  v_tarifa numeric := coalesce(nullif(p->>'tarifa_interna','')::numeric,
                               (select precio_defecto from contactos where id = 'CON-18'), 25);
  v_precio numeric := coalesce(nullif(p->>'precio_huesped','')::numeric, 0);
  v_quien text := _hotel_quien();
begin
  perform _req_staff();
  select * into v_res from hotel_reservas where id = (p->>'reserva_id')::bigint;
  if v_res.id is null then raise exception 'RESERVA_NO_EXISTE'; end if;
  select numero into v_cuarto from hotel_cuartos where id = v_res.cuarto_id;

  if nullif(p->>'local_id','') is not null then
    select id into v_id from hotel_tours where local_id = p->>'local_id';
    if found then return jsonb_build_object('ok', true, 'id', v_id, 'dup', true); end if;
  end if;

  v_ops := crear_reserva(
    (p->>'fecha')::date, p->>'hora', 'CON-18',
    v_res.huesped || ' · Cuarto ' || coalesce(v_cuarto,'?') || ' (Casa Munay)',
    v_pax, v_pax * v_tarifa, 'MunayOps · ' || v_quien, null,
    nullif(p->>'local_id','') || '-ops');
  update reservas set monto = v_pax * v_tarifa, detalle = jsonb_build_object(
    'origen','munayops', 'hotel_reserva_id', v_res.id, 'huesped', v_res.huesped,
    'cuarto', v_cuarto, 'telefono', v_res.telefono, 'tour', p->>'tour',
    'hora', p->>'hora', 'recojo', p->>'recojo', 'pax', v_pax,
    'tarifa_interna_unit', v_tarifa, 'nota', coalesce(p->>'nota',''),
    'pago', 'al final del tour (cuenta corriente HT MUNAY)')
  where id = v_ops;

  insert into hotel_tours (reserva_id, tour, fecha, hora, recojo, pax, precio_huesped,
                           tarifa_interna, ops_reserva_id, nota, local_id, creado_por)
  values (v_res.id, p->>'tour', (p->>'fecha')::date, p->>'hora', coalesce(p->>'recojo',''),
          v_pax, v_precio, v_tarifa, v_ops, coalesce(p->>'nota',''), nullif(p->>'local_id',''), v_quien)
  on conflict (local_id) where local_id is not null do nothing
  returning id into v_id;
  if v_id is null then   -- carrera con mismo local_id: otra tx ya lo creó
    select id into v_id from hotel_tours where local_id = p->>'local_id';
    return jsonb_build_object('ok', true, 'id', v_id, 'dup', true);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'ops_reserva_id', v_ops);
end $$;

-- 5) hotel_nota: no borra si falta la clave 'notas'
create or replace function hotel_nota(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  perform _req_staff();
  if not (p ? 'notas') then return jsonb_build_object('ok', true, 'noop', true); end if;
  update hotel_reservas set notas = left(coalesce(p->>'notas',''), 500)
    where id = (p->>'reserva_id')::bigint;
  if not found then raise exception 'RESERVA_NO_EXISTE'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- 6) CON-18: no pisar la tarifa si el admin ya la ajustó (solo setear si está sin valor)
update contactos set precio_defecto = 25 where id = 'CON-18' and coalesce(precio_defecto, 0) = 0;
