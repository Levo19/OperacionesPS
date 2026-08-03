-- Tablilla zarpe v2: persistencia de correcciones + dir_fiscal (2026-08-03) — generado del vivo + parche
CREATE OR REPLACE FUNCTION public.guardar_zarpe_tablilla(p_operacion text, p_filas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$ declare f jsonb; n int := 0; begin
  perform _req_staff();
  if jsonb_typeof(p_filas) <> 'array' then raise exception 'FILAS_ARRAY'; end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    update zarpe_pax set
        cantidad   = greatest(coalesce((f->>'cantidad')::int, cantidad), 0),
        servicios  = coalesce(f->'servicios', servicios),
        nombre     = coalesce(nullif(trim(f->>'nombre'),''), nombre),
        documento  = coalesce(nullif(trim(f->>'documento'),''), documento),
        tipo_doc   = coalesce(nullif(trim(f->>'tipo_doc'),''), tipo_doc),
        dir_fiscal = case when f ? 'dir_fiscal' then nullif(trim(f->>'dir_fiscal'),'') else dir_fiscal end
      where id = f->>'id' and id_operacion = p_operacion and estado <> 'facturado';
    if found then n := n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'actualizados', n);
end $function$
;

CREATE OR REPLACE FUNCTION public.listar_zarpe_pax(p_operacion text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$ declare v jsonb; begin perform _req_staff();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.creado_at), '[]'::jsonb) into v from (
    select z.id, z.documento, z.tipo_doc, z.nombre, z.empresa, z.cantidad, z.servicios, z.dir_fiscal, z.estado, z.id_comprobante, z.creado_at,
           c.serie, c.numero, c.estado est_cpe, c.enlace_pdf
    from zarpe_pax z left join comprobantes c on c.id = z.id_comprobante
    where z.id_operacion = p_operacion) x;
  return v; end $function$
;
