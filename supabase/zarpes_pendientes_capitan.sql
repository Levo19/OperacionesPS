-- listar_zarpes_pendientes + capitan/guia (2026-08-02) — generado del vivo
CREATE OR REPLACE FUNCTION public.listar_zarpes_pendientes(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$ declare v jsonb; begin
  perform _req_staff();
  select coalesce(jsonb_agg(x order by x.fecha desc, x.hora_salida desc nulls last), '[]'::jsonb) into v from (
    select o.id, to_char(o.fecha,'YYYY-MM-DD') fecha, o.hora_salida,
      coalesce(e.nombre, 'Lancha ('||o.bote_id||')') bote, coalesce(pc.nombre, o.capitan_id, '') capitan, case when o.guia_id is null then '' else coalesce(pg2.nombre, o.guia_id) end guia, coalesce(o.destino,'') destino, o.foto_zarpe_url,
      (select ocupados from _aforo(o.id)) pax_declarado,
      coalesce((select sum(z.cantidad) from zarpe_pax z where z.id_operacion=o.id and z.estado='facturado'),0) pax_facturado,
      coalesce((select sum(z.cantidad) from zarpe_pax z where z.id_operacion=o.id),0) pax_planificado,
      (select count(*) from zarpe_pax z where z.id_operacion=o.id)::int pax_leidos,
      exists(select 1 from zarpe_pax z where z.id_operacion=o.id) jalado
    from operaciones o left join embarcaciones e on e.id = o.bote_id left join personal pc on pc.id = o.capitan_id left join personal pg2 on pg2.id = o.guia_id
    where coalesce(o.foto_zarpe_url,'') <> '' and not coalesce(o.zarpe_cerrado,false)
      and (p_desde is null or o.fecha >= p_desde) and (p_hasta is null or o.fecha <= p_hasta)
  ) x;
  return v;
end $function$
;
