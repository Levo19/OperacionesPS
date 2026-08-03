-- listar_comprobantes_dia + datos de ticket para compartir (2026-08-03)
CREATE OR REPLACE FUNCTION public.listar_comprobantes_dia(p_usuario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$ declare v jsonb; begin
  perform _req_staff();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.creado_at desc), '[]'::jsonb) into v from (
    select id, tipo, serie, numero, cliente_nombre, cliente_doc, cliente_email, cliente_tel, total, estado,
      cliente_doc_tipo, moneda, forma_pago, medio_pago, credito_vencimiento, es_exportacion,
      total_gravada, total_exonerada, total_inafecta, total_exportacion, total_igv, total_gratuita,
      items, hash, qr, observaciones, creado_por,
      enlace_pdf, anulacion_estado, to_char(creado_at at time zone 'America/Lima','HH24:MI') hora, creado_at
    from comprobantes
    where (creado_at at time zone 'America/Lima')::date = (now() at time zone 'America/Lima')::date
      and (p_usuario is null or creado_por = p_usuario)) x;
  return v;
end $function$
;
