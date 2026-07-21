-- ============================================================================
-- LANDING WEB (cosmético) — Grupo PS · 2026-07-20
-- Tablas web_* para las landings públicas del grupo (1ª: Casa Munay).
-- SOLO parte cosmética editable desde PS Panel (módulo Landing):
-- textos, contacto, redes, OTAs, fotos (Storage bucket 'web'), reseñas moderadas.
-- NO incluye reservas/calendario/cuartos/precios (parte operativa, módulo futuro).
-- Multi-landing: todo va keyed por `sitio` (una pestaña nueva = una fila nueva).
-- ============================================================================

-- ── Tablas ──────────────────────────────────────────────────────────────────
create table if not exists web_contenido (
  sitio             text primary key,
  nombre            text default '',
  eslogan           text default '',
  eslogan_en        text default '',
  descripcion       text default '',
  whatsapp          text default '',
  correo            text default '',
  direccion         text default '',
  maps_query        text default '',
  checkin           text default '',
  checkout          text default '',
  horario           text default '',
  rating            numeric,
  resenas_total     integer,
  url               text default '',
  demo              boolean default true,
  google_review_url text default '',
  hero_foto         text default '',
  galeria           jsonb default '[]'::jsonb,
  redes             jsonb default '{}'::jsonb,
  otas              jsonb default '[]'::jsonb,
  updated_at        timestamptz default now()
);

create table if not exists web_testimonios (
  id         bigint generated always as identity primary key,
  sitio      text not null,
  nombre     text default '',
  origen     text default '',
  rating     integer default 5 check (rating between 1 and 5),
  comentario text default '' check (char_length(comentario) <= 600),
  pendiente  boolean default true,
  visible    boolean default false,
  local_id   text,
  creado     timestamptz default now()
);
create unique index if not exists ux_web_testimonios_localid on web_testimonios(local_id) where local_id is not null;
create index if not exists ix_web_testimonios_sitio on web_testimonios(sitio, visible, pendiente);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table web_contenido   enable row level security;
alter table web_testimonios enable row level security;

-- Contenido: lectura pública (la landing lee con anon); escritura SOLO vía RPC gated.
drop policy if exists web_contenido_read on web_contenido;
create policy web_contenido_read on web_contenido for select to anon, authenticated using (true);

-- Testimonios: público lee SOLO visibles; anon inserta SOLO pendiente/no-visible con límites.
drop policy if exists web_testimonios_read on web_testimonios;
create policy web_testimonios_read on web_testimonios for select to anon, authenticated using (visible);
drop policy if exists web_testimonios_insert_publico on web_testimonios;
create policy web_testimonios_insert_publico on web_testimonios for insert to anon, authenticated
  with check (
    pendiente = true and visible = false
    and sitio in (select sitio from web_contenido)
    and char_length(coalesce(nombre,''))     between 2 and 80
    and char_length(coalesce(comentario,'')) between 3 and 600
  );

grant select on web_contenido to anon, authenticated;
grant select, insert on web_testimonios to anon, authenticated;

-- ── RPCs de administración (gate es_admin, patrón del ecosistema) ───────────
create or replace function web_get_admin(p_sitio text)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not es_admin() then raise exception 'NO_ADMIN: requiere Administrador'; end if;
  return jsonb_build_object(
    'contenido',  (select to_jsonb(c) from web_contenido c where c.sitio = p_sitio),
    'pendientes', (select coalesce(jsonb_agg(to_jsonb(t) order by t.creado desc), '[]'::jsonb)
                     from web_testimonios t where t.sitio = p_sitio and t.pendiente),
    'publicadas', (select coalesce(jsonb_agg(to_jsonb(t) order by t.creado desc), '[]'::jsonb)
                     from web_testimonios t where t.sitio = p_sitio and t.visible)
  );
end $$;
grant execute on function web_get_admin(text) to authenticated;

-- Guarda SOLO las claves presentes en p (clave presente con '' = limpiar campo).
create or replace function web_guardar_contenido(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_sitio text := p->>'sitio';
begin
  if not es_admin() then raise exception 'NO_ADMIN: requiere Administrador'; end if;
  if v_sitio is null or v_sitio = '' then raise exception 'SITIO_REQUERIDO'; end if;
  update web_contenido set
    nombre            = case when p ? 'nombre'            then p->>'nombre'            else nombre end,
    eslogan           = case when p ? 'eslogan'           then p->>'eslogan'           else eslogan end,
    eslogan_en        = case when p ? 'eslogan_en'        then p->>'eslogan_en'        else eslogan_en end,
    descripcion       = case when p ? 'descripcion'       then p->>'descripcion'       else descripcion end,
    whatsapp          = case when p ? 'whatsapp'          then regexp_replace(coalesce(p->>'whatsapp',''), '[^0-9]', '', 'g') else whatsapp end,
    correo            = case when p ? 'correo'            then p->>'correo'            else correo end,
    direccion         = case when p ? 'direccion'         then p->>'direccion'         else direccion end,
    maps_query        = case when p ? 'maps_query'        then p->>'maps_query'        else maps_query end,
    checkin           = case when p ? 'checkin'           then p->>'checkin'           else checkin end,
    checkout          = case when p ? 'checkout'          then p->>'checkout'          else checkout end,
    horario           = case when p ? 'horario'           then p->>'horario'           else horario end,
    rating            = case when p ? 'rating'            then nullif(p->>'rating','')::numeric else rating end,
    resenas_total     = case when p ? 'resenas_total'     then nullif(p->>'resenas_total','')::integer else resenas_total end,
    url               = case when p ? 'url'               then p->>'url'               else url end,
    demo              = case when p ? 'demo'              then (p->>'demo')::boolean   else demo end,
    google_review_url = case when p ? 'google_review_url' then p->>'google_review_url' else google_review_url end,
    hero_foto         = case when p ? 'hero_foto'         then p->>'hero_foto'         else hero_foto end,
    galeria           = case when p ? 'galeria'           then coalesce(p->'galeria','[]'::jsonb)  else galeria end,
    redes             = case when p ? 'redes'             then coalesce(p->'redes','{}'::jsonb)    else redes end,
    otas              = case when p ? 'otas'              then coalesce(p->'otas','[]'::jsonb)     else otas end,
    updated_at        = now()
  where sitio = v_sitio;
  if not found then raise exception 'SITIO_NO_EXISTE: %', v_sitio; end if;
  return jsonb_build_object('ok', true, 'sitio', v_sitio);
end $$;
grant execute on function web_guardar_contenido(jsonb) to authenticated;

-- Moderación de reseñas: aprobar / ocultar / eliminar (+ editar origen).
create or replace function web_testimonio_set(p_id bigint, p_accion text, p_origen text default null)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  if not es_admin() then raise exception 'NO_ADMIN: requiere Administrador'; end if;
  if p_accion = 'aprobar' then
    update web_testimonios set pendiente = false, visible = true,
      origen = coalesce(nullif(p_origen,''), origen) where id = p_id;
  elsif p_accion = 'ocultar' then
    update web_testimonios set visible = false, pendiente = false where id = p_id;
  elsif p_accion = 'eliminar' then
    delete from web_testimonios where id = p_id;
  else
    raise exception 'ACCION_INVALIDA: %', p_accion;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function web_testimonio_set(bigint, text, text) to authenticated;

-- ── Storage: bucket público 'web' (fotos de landings), escritura solo admin ─
insert into storage.buckets (id, name, public) values ('web', 'web', true)
  on conflict (id) do nothing;

drop policy if exists web_fotos_write on storage.objects;
create policy web_fotos_write on storage.objects for insert to authenticated
  with check (bucket_id = 'web' and es_admin());
drop policy if exists web_fotos_update on storage.objects;
create policy web_fotos_update on storage.objects for update to authenticated
  using (bucket_id = 'web' and es_admin());
drop policy if exists web_fotos_delete on storage.objects;
create policy web_fotos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'web' and es_admin());
drop policy if exists web_fotos_list on storage.objects;
create policy web_fotos_list on storage.objects for select to authenticated
  using (bucket_id = 'web' and es_admin());

-- ── Seed: Casa Munay (valores actuales del seed de la landing; TODOs = '') ──
insert into web_contenido (sitio, nombre, eslogan, eslogan_en, descripcion, whatsapp, correo,
  direccion, maps_query, checkin, checkout, horario, rating, resenas_total, url, demo, redes, otas)
values (
  'casamunay', 'Casa Munay', 'Donde el desierto abraza al mar', 'Where the desert meets the sea',
  'Hotel de 15 habitaciones en el corazón de Paracas y tours con flota propia a las Islas Ballestas. Un hotel del Grupo Paracas Sights & Tours.',
  '', '', 'Av. José de San Martín Mz. E, Paracas — Pisco, Ica', 'Paracas, Ica, Peru',
  '14:00', '11:00', 'Recepción 7:00 – 23:00', 4.8, 120, 'https://casamunay.com', true,
  '{"facebook":"","instagram":"","tiktok":""}'::jsonb,
  '[{"id":"booking","nota":"","detalle":"","url":""},{"id":"airbnb","nota":"","detalle":"","url":""},{"id":"tripadvisor","nota":"","detalle":"","url":""},{"id":"google","nota":"","detalle":"","url":""}]'::jsonb
)
on conflict (sitio) do nothing;

-- Registrar en el catálogo del sistema (organización inteligente)
insert into sistema_catalogo (tipo, nombre, proposito, gate, consumidores, estado)
select 'tabla', 'web_contenido', 'Contenido cosmético editable de landings públicas (Casa Munay)', 'RLS: read público, write vía RPC es_admin', 'Landing casamunay (Vercel) + PS Panel módulo Landing', 'activo'
where not exists (select 1 from sistema_catalogo where nombre = 'web_contenido');
insert into sistema_catalogo (tipo, nombre, proposito, gate, consumidores, estado)
select 'tabla', 'web_testimonios', 'Reseñas públicas moderadas de landings', 'RLS: anon inserta pendiente-only, lee visibles; moderación es_admin', 'Landing casamunay + PS Panel módulo Landing', 'activo'
where not exists (select 1 from sistema_catalogo where nombre = 'web_testimonios');
