-- ============================================================================
-- TOURS DEL HOTEL → CRM DEL MUELLE (2026-07-23, pedido Luis)
-- Casa Munay (HT MUNAY, CON-18) opera como AGENCIA: el muelle le cobra
-- tarifa interna por pax (defecto 25, editable por tour). El huésped paga
-- AL FINAL del tour (clima/capitanía pueden suspender) → el cargo al folio
-- solo se crea al marcar REALIZADO. Anulación retroactiva: reversa cargo
-- y anula la reserva del muelle.
-- ============================================================================

-- 1) tarifa por defecto que el muelle cobra a HT MUNAY (por pax)
update contactos set precio_defecto = 25 where id = 'CON-18';

-- 2) payload JSON del hotel en el CRM del muelle
alter table reservas add column if not exists detalle jsonb;

-- 3) reservas de tour del huésped
create table if not exists hotel_tours (
  id bigserial primary key,
  reserva_id bigint not null references hotel_reservas(id) on delete cascade,
  tour text not null,
  fecha date not null,
  hora text not null,                    -- formato del muelle: '08:00 AM'
  recojo text not null,                  -- SIEMPRE 1 hora antes (precalculado)
  pax int not null default 1 check (pax > 0),
  precio_huesped numeric not null default 0,   -- por pax (lo que cobra el hotel)
  tarifa_interna numeric not null default 0,   -- por pax (lo que el muelle cobra a HT MUNAY)
  estado text not null default 'reservado' check (estado in ('reservado','realizado','suspendido','cancelado')),
  ops_reserva_id text,
  consumo_id bigint,
  nota text not null default '',
  local_id text,
  creado_por text,
  creado_at timestamptz not null default now()
);
create unique index if not exists hotel_tours_local on hotel_tours(local_id) where local_id is not null;
create index if not exists hotel_tours_res on hotel_tours(reserva_id);
alter table hotel_tours enable row level security;
drop policy if exists ht_tours_sel on hotel_tours;
create policy ht_tours_sel on hotel_tours for select using (es_staff());
-- escrituras SOLO vía RPCs security definer

-- 4) catálogo de adicionales/impuestos del muelle — explicable al cliente
--    (montos = los observados en la operación real; el admin puede editarlos)
create table if not exists adicionales_catalogo (
  clave text primary key,
  nombre text not null,
  monto numeric not null default 0,
  unidad text not null default 'por persona',
  aplica text not null default 'ballestas',
  explica text not null default '',
  activo boolean not null default true
);
alter table adicionales_catalogo enable row level security;
drop policy if exists adic_cat_sel on adicionales_catalogo;
create policy adic_cat_sel on adicionales_catalogo for select using (es_staff());
insert into adicionales_catalogo (clave, nombre, monto, unidad, aplica, explica) values
  ('muelle', 'Tasa de embarque (muelle)', 10, 'por persona', 'ballestas,paracas',
   'Ticket del muelle El Chaco. Lo paga cada pasajero directamente en el muelle antes de embarcar — NO está incluido en el precio del tour.'),
  ('adulto', 'Ingreso SERNANP adulto', 22, 'por adulto', 'ballestas',
   'Ticket de ingreso a la Reserva/Islas Ballestas (SERNANP) para adultos. Se paga en el muelle, aparte del tour.'),
  ('niño', 'Ingreso SERNANP niño', 3, 'por niño', 'ballestas',
   'Ticket de ingreso SERNANP para niños. Se paga en el muelle, aparte del tour.'),
  ('full', 'Ingreso SERNANP full (islas + reserva)', 68, 'por persona', 'ballestas,paracas',
   'Ticket combinado SERNANP que cubre Islas Ballestas y la Reserva Nacional el mismo día. Se paga en el muelle.'),
  ('local', 'Tarifa local', 10, 'por persona', 'ballestas',
   'Tarifa para residentes locales con documento. Se paga en el muelle.')
on conflict (clave) do nothing;

-- 5) crear tour: registra en el hotel Y dispara la reserva al CRM del muelle
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

  -- idempotencia
  if nullif(p->>'local_id','') is not null then
    select id into v_id from hotel_tours where local_id = p->>'local_id';
    if found then return jsonb_build_object('ok', true, 'id', v_id, 'dup', true); end if;
  end if;

  -- reserva en el CRM del muelle (misma BD): HT MUNAY como agencia
  v_ops := crear_reserva(
    (p->>'fecha')::date, p->>'hora', 'CON-18',
    v_res.huesped || ' · Cuarto ' || coalesce(v_cuarto,'?') || ' (Casa Munay)',
    v_pax, v_pax * v_tarifa, 'MunayOps · ' || v_quien, null,
    nullif(p->>'local_id','') || '-ops');
  -- crear_reserva ignora p_monto → lo fijamos aquí, junto al payload JSON
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
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'ops_reserva_id', v_ops);
end $$;

-- 6) estado del tour: realizado (recién ahí cobra al folio) / suspendido / cancelado
create or replace function hotel_tour_estado(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_t hotel_tours; v_acc text := p->>'accion'; v_cid bigint;
begin
  perform _req_staff();
  select * into v_t from hotel_tours where id = (p->>'tour_id')::bigint;
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
    -- RETROACTIVO: si ya se había cobrado, se reversa el cargo del folio
    if v_t.consumo_id is not null then
      delete from hotel_consumos where id = v_t.consumo_id;
    end if;
    -- anular la reserva en el CRM del muelle
    if v_t.ops_reserva_id is not null then
      update reservas set estado = 'Anulada' where id = v_t.ops_reserva_id and estado in ('Pendiente','Asignado');
    end if;
    update hotel_tours set estado = v_acc, consumo_id = null where id = v_t.id;
  else
    raise exception 'ACCION_INVALIDA: %', v_acc;
  end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function hotel_tour_crear(jsonb), hotel_tour_estado(jsonb) to authenticated;
revoke execute on function hotel_tour_crear(jsonb), hotel_tour_estado(jsonb) from anon;
