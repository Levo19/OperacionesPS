-- listar_comprobantes + observaciones (2026-08-03)
CREATE OR REPLACE FUNCTION public.listar_comprobantes(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$ declare v jsonb; begin
  perform _req_staff();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.creado_at desc), '[]'::jsonb) into v
  from (select id, tipo, serie, numero, cliente_nombre, cliente_doc, cliente_doc_tipo, moneda,
          exonerado, es_exportacion, medio_pago, forma_pago, credito_vencimiento,
          total_gravada, total_exonerada, total_inafecta, total_exportacion, total_igv, total, total_gratuita,
          observaciones,
          items, estado, aceptada_por_sunat, enlace_pdf, qr, hash,
          doc_modifica_tipo, doc_modifica_serie, doc_modifica_numero,
          case when tipo=3 then coalesce(anulacion_motivo, errores) else null end nc_motivo,
          to_char(creado_at at time zone 'America/Lima','YYYY-MM-DD HH24:MI') creado, creado_por, creado_at
        from comprobantes
        where (p_desde is null or (creado_at at time zone 'America/Lima')::date >= p_desde)
          and (p_hasta is null or (creado_at at time zone 'America/Lima')::date <= p_hasta)) x;
  return v;
end $function$
;
