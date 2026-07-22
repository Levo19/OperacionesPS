-- ============================================================================
-- MUNAY OPS — HOTEL CORE (F1) · 2026-07-22
-- Operación del Hotel Casa Munay: cuartos, reservas, consumos, pagos, catálogo.
-- Lecturas: RLS es_staff() directo. Escrituras: SOLO RPCs gated _req_staff().
-- Candado money-safety: EXCLUDE por rango de fechas = doble-reserva IMPOSIBLE.
-- Cuartos y catálogo los edita el ADMIN (PS Panel, fase posterior); MunayOps opera.
-- Tours como adicionales: el frontend los lee de web_contenido.tours (landing).
-- ============================================================================
create extension if not exists btree_gist;

create table if not exists hotel_cuartos (
  id             bigint generated always as identity primary key,
  numero         text not null unique,
  categoria_slug text not null,           -- slug de las categorías del landing
  categoria      text not null,
  piso           int,
  capacidad      int default 2,
  precio_base    numeric not null check (precio_base >= 0),
  limpieza       text not null default 'limpio' check (limpieza in ('limpio','sucio','mantenimiento','bloqueado')),
  nota           text default '',
  activo         boolean default true
);

create table if not exists hotel_reservas (
  id            bigint generated always as identity primary key,
  codigo        text generated always as ('R-' || lpad(id::text, 4, '0')) stored,
  cuarto_id     bigint not null references hotel_cuartos(id),
  huesped       text not null,
  documento     text default '',
  telefono      text default '',
  pax           int default 2 check (pax > 0),
  fecha_in      date not null,
  fecha_out     date not null,             -- exclusivo (día de salida)
  precio_noche  numeric not null check (precio_noche >= 0),
  canal         text default 'walkin' check (canal in ('walkin','whatsapp','web','booking','airbnb','otro')),
  estado        text not null default 'reservada' check (estado in ('reservada','en_casa','salio','cancelada','no_show')),
  notas         text default '',
  local_id      text,
  creado_por    text default '',
  creado        timestamptz default now(),
  check (fecha_out > fecha_in),
  -- ── EL CANDADO: dos reservas activas jamás se solapan en el mismo cuarto ──
  constraint hotel_sin_solape exclude using gist (
    cuarto_id with =,
    daterange(fecha_in, fecha_out) with &&
  ) where (estado in ('reservada','en_casa','salio'))
);
create unique index if not exists ux_hotel_reservas_localid on hotel_reservas(local_id) where local_id is not null;
create index if not exists ix_hotel_reservas_rango on hotel_reservas(fecha_in, fecha_out);

create table if not exists hotel_consumos (
  id         bigint generated always as identity primary key,
  reserva_id bigint not null references hotel_reservas(id),
  item       text not null,
  tipo       text default 'consumo' check (tipo in ('consumo','servicio','tour')),
  cantidad   int default 1 check (cantidad > 0),
  precio     numeric not null check (precio >= 0),
  local_id   text,
  creado_por text default '',
  creado     timestamptz default now()
);
create unique index if not exists ux_hotel_consumos_localid on hotel_consumos(local_id) where local_id is not null;

create table if not exists hotel_pagos (
  id         bigint generated always as identity primary key,
  reserva_id bigint not null references hotel_reservas(id),
  monto      numeric not null check (monto > 0),
  medio      text not null check (medio in ('efectivo','yape','plin','tarjeta','otro')),
  concepto   text default 'pago',          -- pago | adelanto
  local_id   text,
  creado_por text default '',
  creado     timestamptz default now()
);
create unique index if not exists ux_hotel_pagos_localid on hotel_pagos(local_id) where local_id is not null;

create table if not exists hotel_catalogo (
  id     bigint generated always as identity primary key,
  item   text not null unique,
  tipo   text default 'consumo' check (tipo in ('consumo','servicio')),
  precio numeric not null check (precio >= 0),
  orden  int default 99,
  activo boolean default true
);

-- ── Vista folio: totales por reserva ──
create or replace view hotel_folio with (security_invoker = true) as
select r.id as reserva_id,
  (r.fecha_out - r.fecha_in) as noches,
  (r.fecha_out - r.fecha_in) * r.precio_noche as total_noches,
  coalesce((select sum(c.cantidad * c.precio) from hotel_consumos c where c.reserva_id = r.id), 0) as total_consumos,
  coalesce((select sum(p.monto) from hotel_pagos p where p.reserva_id = r.id), 0) as total_pagado,
  (r.fecha_out - r.fecha_in) * r.precio_noche
    + coalesce((select sum(c.cantidad * c.precio) from hotel_consumos c where c.reserva_id = r.id), 0)
    - coalesce((select sum(p.monto) from hotel_pagos p where p.reserva_id = r.id), 0) as saldo
from hotel_reservas r;

-- ── RLS: staff lee todo; escrituras solo por RPC ──
alter table hotel_cuartos   enable row level security;
alter table hotel_reservas  enable row level security;
alter table hotel_consumos  enable row level security;
alter table hotel_pagos     enable row level security;
alter table hotel_catalogo  enable row level security;
do $$ begin
  perform 1;
  drop policy if exists sel_staff on hotel_cuartos;   create policy sel_staff on hotel_cuartos   for select to authenticated using (es_staff());
  drop policy if exists sel_staff on hotel_reservas;  create policy sel_staff on hotel_reservas  for select to authenticated using (es_staff());
  drop policy if exists sel_staff on hotel_consumos;  create policy sel_staff on hotel_consumos  for select to authenticated using (es_staff());
  drop policy if exists sel_staff on hotel_pagos;     create policy sel_staff on hotel_pagos     for select to authenticated using (es_staff());
  drop policy if exists sel_staff on hotel_catalogo;  create policy sel_staff on hotel_catalogo  for select to authenticated using (es_staff());
end $$;
grant select on hotel_cuartos, hotel_reservas, hotel_consumos, hotel_pagos, hotel_catalogo, hotel_folio to authenticated;

-- ── helper: nombre del staff logueado (para creado_por / arqueo por encargado) ──
create or replace function _hotel_quien() returns text language sql stable security definer set search_path = public, auth as
$$ select coalesce((select nombre from app_usuarios where auth_uid = auth.uid() limit 1), 'staff') $$;

-- ── RPCs de escritura ──
create or replace function hotel_reservar(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_id bigint; v_adelanto numeric := coalesce(nullif(p->>'adelanto','')::numeric, 0);
begin
  perform _req_staff();
  if coalesce(p->>'huesped','') = '' then raise exception 'HUESPED_REQUERIDO'; end if;
  insert into hotel_reservas (cuarto_id, huesped, documento, telefono, pax, fecha_in, fecha_out,
                              precio_noche, canal, notas, local_id, creado_por)
  values ((p->>'cuarto_id')::bigint, p->>'huesped', coalesce(p->>'documento',''), coalesce(p->>'telefono',''),
          coalesce(nullif(p->>'pax','')::int, 2), (p->>'fecha_in')::date, (p->>'fecha_out')::date,
          (p->>'precio_noche')::numeric, coalesce(nullif(p->>'canal',''), 'walkin'),
          coalesce(p->>'notas',''), nullif(p->>'local_id',''), _hotel_quien())
  on conflict (local_id) where local_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from hotel_reservas where local_id = p->>'local_id';
    return jsonb_build_object('ok', true, 'id', v_id, 'dup', true);
  end if;
  if v_adelanto > 0 then
    insert into hotel_pagos (reserva_id, monto, medio, concepto, local_id, creado_por)
    values (v_id, v_adelanto, coalesce(nullif(p->>'adelanto_medio',''), 'yape'), 'adelanto',
            nullif(p->>'local_id','') || '-ad', _hotel_quien());
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when exclusion_violation then
  raise exception 'CUARTO_OCUPADO: ese cuarto ya tiene reserva en esas fechas';
end $$;

create or replace function hotel_accion(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_res hotel_reservas; v_acc text := p->>'accion';
begin
  perform _req_staff();
  select * into v_res from hotel_reservas where id = (p->>'reserva_id')::bigint;
  if v_res.id is null then raise exception 'RESERVA_NO_EXISTE'; end if;
  if v_acc = 'checkin' then
    if v_res.estado <> 'reservada' then raise exception 'ESTADO_INVALIDO: %', v_res.estado; end if;
    if exists (select 1 from hotel_cuartos where id = v_res.cuarto_id and limpieza in ('sucio','mantenimiento','bloqueado')) then
      raise exception 'CUARTO_NO_LISTO: primero márcalo limpio';
    end if;
    update hotel_reservas set estado = 'en_casa' where id = v_res.id;
  elsif v_acc = 'checkout' then
    if v_res.estado <> 'en_casa' then raise exception 'ESTADO_INVALIDO: %', v_res.estado; end if;
    update hotel_reservas set estado = 'salio' where id = v_res.id;
    update hotel_cuartos set limpieza = 'sucio' where id = v_res.cuarto_id;  -- housekeeping automático
  elsif v_acc in ('cancelar','no_show') then
    if v_res.estado not in ('reservada','en_casa') then raise exception 'ESTADO_INVALIDO: %', v_res.estado; end if;
    update hotel_reservas set estado = case v_acc when 'cancelar' then 'cancelada' else 'no_show' end where id = v_res.id;
  else
    raise exception 'ACCION_INVALIDA: %', v_acc;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function hotel_consumo(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  perform _req_staff();
  insert into hotel_consumos (reserva_id, item, tipo, cantidad, precio, local_id, creado_por)
  values ((p->>'reserva_id')::bigint, p->>'item', coalesce(nullif(p->>'tipo',''), 'consumo'),
          coalesce(nullif(p->>'cantidad','')::int, 1), (p->>'precio')::numeric,
          nullif(p->>'local_id',''), _hotel_quien())
  on conflict (local_id) where local_id is not null do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function hotel_pago(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_id bigint;
begin
  perform _req_staff();
  insert into hotel_pagos (reserva_id, monto, medio, concepto, local_id, creado_por)
  values ((p->>'reserva_id')::bigint, (p->>'monto')::numeric, p->>'medio',
          coalesce(nullif(p->>'concepto',''), 'pago'), nullif(p->>'local_id',''), _hotel_quien())
  on conflict (local_id) where local_id is not null do nothing
  returning id into v_id;
  if v_id is null then select id into v_id from hotel_pagos where local_id = p->>'local_id'; end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'quien', _hotel_quien());
end $$;

create or replace function hotel_limpieza(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  perform _req_staff();
  if p->>'estado' not in ('limpio','sucio','mantenimiento','bloqueado') then raise exception 'ESTADO_INVALIDO'; end if;
  update hotel_cuartos set limpieza = p->>'estado', nota = coalesce(p->>'nota', nota) where id = (p->>'cuarto_id')::bigint;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function hotel_reservar(jsonb), hotel_accion(jsonb), hotel_consumo(jsonb),
  hotel_pago(jsonb), hotel_limpieza(jsonb), _hotel_quien() to authenticated;

-- ── Realtime ──
do $$ begin
  begin alter publication supabase_realtime add table hotel_reservas; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table hotel_cuartos; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table hotel_pagos; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table hotel_consumos; exception when duplicate_object then null; end;
end $$;
alter table hotel_reservas replica identity full;
alter table hotel_cuartos  replica identity full;

-- ── Seed cuartos (PLACEHOLDER hasta la lista real de Luis) + catálogo ──
insert into hotel_cuartos (numero, categoria_slug, categoria, piso, capacidad, precio_base) values
  ('101','matrimonial-clasica','Matrimonial Clásica',1,2,100),
  ('102','matrimonial-clasica','Matrimonial Clásica',1,2,100),
  ('103','matrimonial-clasica','Matrimonial Clásica',1,2,100),
  ('104','matrimonial-clasica','Matrimonial Clásica',1,2,100),
  ('105','doble-twin','Doble Twin',1,2,110),
  ('106','doble-twin','Doble Twin',1,2,110),
  ('201','matrimonial-vista-bahia','Matrimonial Vista Bahía',2,2,140),
  ('202','matrimonial-vista-bahia','Matrimonial Vista Bahía',2,2,140),
  ('203','matrimonial-vista-bahia','Matrimonial Vista Bahía',2,2,140),
  ('204','familiar-munay','Familiar Munay',2,4,180),
  ('205','familiar-munay','Familiar Munay',2,4,180),
  ('301','cuadruple-aventura','Cuádruple Aventura',3,5,170),
  ('302','cuadruple-aventura','Cuádruple Aventura',3,5,170),
  ('304','cuadruple-aventura','Cuádruple Aventura',3,5,170),
  ('303','suite-paracas','Suite Paracas',3,3,250)
on conflict (numero) do nothing;

insert into hotel_catalogo (item, tipo, precio, orden) values
  ('Agua mineral','consumo',3,1), ('Gaseosa','consumo',5,2), ('Snack','consumo',4,3),
  ('Toalla extra','servicio',5,4), ('Desayuno','servicio',15,5), ('Lavandería (kg)','servicio',20,6),
  ('Late check-out','servicio',30,7)
on conflict (item) do nothing;

-- catálogo del sistema (organización inteligente)
insert into sistema_catalogo (tipo, nombre, proposito, gate, consumidores, estado)
select 'tabla', 'hotel_reservas', 'Reservas del Hotel Casa Munay (EXCLUDE anti doble-reserva)', 'RLS es_staff; escrituras vía RPCs hotel_*', 'MunayOps + (futuro) ViewHotel PS', 'activo'
where not exists (select 1 from sistema_catalogo where nombre = 'hotel_reservas');
