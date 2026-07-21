-- ============================================================================
-- LANDING WEB v2 (cosmético) — 2026-07-20
-- Secciones editables nuevas: sobre ("Nuestra casa"), amenidades (chips con
-- ocultar), dia ("Un día en Munay") y tours (card + texto largo + precio).
-- Los fallbacks del código se SIEMBRAN como registros (apply_landing_web2.js).
-- Reseñas seed → web_testimonios visibles (las primeras publicadas).
-- ============================================================================

alter table web_contenido add column if not exists sobre      jsonb;
alter table web_contenido add column if not exists amenidades jsonb;
alter table web_contenido add column if not exists dia        jsonb;
alter table web_contenido add column if not exists tours      jsonb;

-- web_guardar_contenido: soporta las 4 claves nuevas (payload parcial, gate es_admin)
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
    sobre             = case when p ? 'sobre'             then p->'sobre'              else sobre end,
    amenidades        = case when p ? 'amenidades'        then coalesce(p->'amenidades','[]'::jsonb) else amenidades end,
    dia               = case when p ? 'dia'               then coalesce(p->'dia','[]'::jsonb)     else dia end,
    tours             = case when p ? 'tours'             then coalesce(p->'tours','[]'::jsonb)   else tours end,
    updated_at        = now()
  where sitio = v_sitio;
  if not found then raise exception 'SITIO_NO_EXISTE: %', v_sitio; end if;
  return jsonb_build_object('ok', true, 'sitio', v_sitio);
end $$;
grant execute on function web_guardar_contenido(jsonb) to authenticated;
