-- get_kpis_ops con comisión CONGELADA (usa m.tarifa_base). 2026-07-10
CREATE OR REPLACE FUNCTION public.get_kpis_ops(p_fecha date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare r jsonb; v_chips jsonb; v_ef numeric; v_tr numeric; v_nops int;
begin
  perform _req_staff();
  select count(*) into v_nops from operaciones where fecha=p_fecha;
  with mo as (
    select m.*, coalesce(m.tarifa_base, c.precio_defecto, 0) pdef
    from movimientos m left join contactos c on c.id=m.contacto_id
    where m.operacion_id in (select id from operaciones where fecha=p_fecha) and m.estado<>'Cancelado'
  )
  select jsonb_build_object(
    'operaciones_hoy', v_nops,
    'pax_total', coalesce(sum(cant_pax),0),
    'ingresos_directo', coalesce(sum(monto_total) filter (where tipo='Directo'),0),
    'ingresos_agencia', coalesce(sum(monto_total) filter (where tipo='Agencia'),0),
    'ingresos_operador', coalesce(sum(case when tipo in ('Directo','Agencia') then monto_total
                                           when tipo='Comisionado' then pdef*cant_pax else 0 end),0),
    'deuda_comisionados', coalesce(sum(case when tipo='Comisionado' then greatest(0,(precio_unit*cant_pax)-(pdef*cant_pax)) else 0 end),0),
    'pendiente_paseIN', coalesce(sum(monto_total) filter (where tipo='PaseIN'),0),
    'pendiente_aliados', coalesce(sum(case when tipo='PaseOUT' then greatest(0,monto_total-monto_comprado)
                                          when tipo='Aliado' then monto_total else 0 end),0)
  ) into r from mo;
  -- por_tipo
  select coalesce(jsonb_object_agg(tipo, px),'{}'::jsonb) into v_chips
    from (select tipo, sum(cant_pax) px from movimientos
          where operacion_id in (select id from operaciones where fecha=p_fecha) and estado<>'Cancelado'
          group by tipo) s;
  -- caja (solo ops del día, sin fallback)
  select coalesce(sum(monto) filter (where lower(coalesce(metodo_pago,'')) like '%efectivo%' or lower(coalesce(metodo_pago,''))='cash'),0),
         coalesce(sum(monto) filter (where not (lower(coalesce(metodo_pago,'')) like '%efectivo%' or lower(coalesce(metodo_pago,''))='cash')),0)
    into v_ef, v_tr from caja_operador where operacion_id in (select id from operaciones where fecha=p_fecha);
  return r || jsonb_build_object('caja_efectivo',v_ef,'caja_transferencia',v_tr,'por_tipo',v_chips);
end $function$;
