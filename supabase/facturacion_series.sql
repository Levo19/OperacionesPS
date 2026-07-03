-- ============================================================
-- OperacionesPS · Facturación — arranque limpio con series nuevas B002 / F002
-- ------------------------------------------------------------
-- El sistema rentado viejo usaba FA01 (facturas) y BA01 (boletas). Para no chocar
-- con esa numeración en SUNAT, PS arranca series NUEVAS y limpias: B002 / F002,
-- correlativo desde 0 (próximo = 1). Legal y recomendado (cada serie electrónica
-- tiene su correlativo independiente; no requieren autorización previa de SUNAT).
-- Las series quedan en config (cambiables sin redeploy). Seguro de re-ejecutar.
-- ============================================================

-- 1) series nuevas (idempotente)
insert into series(serie, tipo, correlativo) values ('B002', 2, 0), ('F002', 1, 0)
  on conflict (serie) do nothing;

-- 2) serie activa por tipo, en config (para no hardcodear en el frontend)
alter table facturacion_config add column if not exists serie_boleta  text default 'B002';
alter table facturacion_config add column if not exists serie_factura text default 'F002';
update facturacion_config set serie_boleta = coalesce(serie_boleta,'B002'),
                              serie_factura = coalesce(serie_factura,'F002') where id = 1;

-- 3) limpiar las series demo B001/F001 (solo si no tienen comprobantes; en prod hay 0)
delete from series s where s.serie in ('B001','F001')
  and not exists (select 1 from comprobantes c where c.serie = s.serie);

-- 4) get_facturacion_config ahora incluye las series activas
create or replace function get_facturacion_config()
  returns jsonb language sql stable security definer set search_path=public, auth as
$$ select jsonb_build_object(
     'tiene_nubefact', coalesce(nubefact_ruta,'') <> '' and coalesce(nubefact_token,'') <> '',
     'tiene_lookup', coalesce(lookup_url,'') <> '' and coalesce(lookup_token,'') <> '',
     'modo', modo, 'activo', activo,
     'serie_boleta', serie_boleta, 'serie_factura', serie_factura,
     'series', (select coalesce(jsonb_object_agg(serie, correlativo), '{}'::jsonb) from series)
   ) from facturacion_config where id=1 $$;
grant execute on function get_facturacion_config() to authenticated;

-- 5) cambiar las series activas (valida formato SUNAT B+3 / F+3, crea la serie si falta)
create or replace function admin_set_series(p_boleta text, p_factura text)
  returns jsonb language plpgsql security definer set search_path=public, auth as
$$ begin
  perform _req_admin();
  p_boleta := upper(trim(p_boleta)); p_factura := upper(trim(p_factura));
  if p_boleta  !~ '^B[0-9A-Z]{3}$' then raise exception 'SERIE_BOLETA: formato inválido (debe ser B + 3, ej. B002)'; end if;
  if p_factura !~ '^F[0-9A-Z]{3}$' then raise exception 'SERIE_FACTURA: formato inválido (debe ser F + 3, ej. F002)'; end if;
  insert into series(serie,tipo,correlativo) values (p_boleta,2,0) on conflict (serie) do nothing;
  insert into series(serie,tipo,correlativo) values (p_factura,1,0) on conflict (serie) do nothing;
  update facturacion_config set serie_boleta = p_boleta, serie_factura = p_factura where id = 1;
  return jsonb_build_object('boleta', p_boleta, 'factura', p_factura);
end $$;
grant execute on function admin_set_series(text,text) to authenticated;
