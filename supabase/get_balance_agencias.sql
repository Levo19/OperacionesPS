-- get_balance_agencias con fix M2 (cobros movimiento_id colgante cuentan como abono). 2026-07-10
CREATE OR REPLACE FUNCTION public.get_balance_agencias(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v_ag jsonb; v_td numeric; v_ld numeric; v_ft numeric; v_ct numeric; v_ntd int; v_nld int;
begin
  perform _req_staff();
  with mv as (   -- movimientos en rango, no cancelados, con fecha/hora Lima
    select m.*, _adic_sum(m.adicionales) adic,
      (m.registrado_at at time zone 'America/Lima')::date fdate,
      to_char(m.registrado_at at time zone 'America/Lima','YYYY-MM-DD') fecha,
      to_char(m.registrado_at at time zone 'America/Lima','HH24:MI') hora,
      bo.nombre bote, pe.nombre capitan
    from movimientos m
    left join operaciones o on o.id=m.operacion_id
    left join embarcaciones bo on bo.id=o.bote_id
    left join personal pe on pe.id=o.capitan_id
    where lower(coalesce(m.estado,'')) not like '%cancel%'
      and (p_desde is null or (m.registrado_at at time zone 'America/Lima')::date >= p_desde)
      and (p_hasta is null or (m.registrado_at at time zone 'America/Lima')::date <= p_hasta)
  ),
  cargos as (  -- movs cuyo contacto es agencia → facturado
    select mv.*, (coalesce(mv.monto_total,0)+mv.adic) cargo
    from mv join contactos c on c.id=mv.contacto_id and c.tipo='agencia'
  ),
  cob as (  -- Cobros ligados por id_movimiento (a un cargo de agencia)
    select k.movimiento_id mid, ca.contacto_id ag, k.monto, k.operador,
      to_char(k.ts at time zone 'America/Lima','YYYY-MM-DD') fecha, to_char(k.ts at time zone 'America/Lima','HH24:MI') hora, k.metodo_pago
    from caja_operador k join cargos ca on ca.id=k.movimiento_id
    where k.categoria='Cobro' and coalesce(k.movimiento_id,'')<>''
  ),
  abonos as (  -- Cobro sin movimiento, contacto agencia
    select k.contacto_id ag, k.monto, k.operador,
      to_char(k.ts at time zone 'America/Lima','YYYY-MM-DD') fecha, to_char(k.ts at time zone 'America/Lima','HH24:MI') hora, k.metodo_pago
    from caja_operador k join contactos c on c.id=k.contacto_id and c.tipo='agencia'
    where k.categoria='Cobro' and (coalesce(k.movimiento_id,'')='' or not exists (select 1 from cargos ca where ca.id=k.movimiento_id))
  ),
  ventas as (  -- monto_comprado a una agencia compradora
    select mv.*, mv.monto_comprado mc, mv.agencia_comprada_id ag, coalesce(co.nombre,mv.contacto_id) origen
    from mv left join contactos co on co.id=mv.contacto_id
    join contactos c2 on c2.id=mv.agencia_comprada_id and c2.tipo='agencia'
    where coalesce(mv.monto_comprado,0)>0
  ),
  pagos as (  -- Pago Agencia, contacto agencia
    select k.contacto_id ag, k.movimiento_id mid, k.monto, k.operador,
      to_char(k.ts at time zone 'America/Lima','YYYY-MM-DD') fecha, to_char(k.ts at time zone 'America/Lima','HH24:MI') hora
    from caja_operador k join contactos c on c.id=k.contacto_id and c.tipo='agencia'
    where k.categoria='Pago Agencia'
  ),
  sini as (  -- saldo inicial (arrastre): SIEMPRE cuenta; gated solo por hasta, no por desde
    select contacto_id ag, monto si
    from saldos_iniciales
    where tipo='agencia' and (p_hasta is null or fecha_corte <= p_hasta)
  ),
  ag_ids as (
    select distinct ag from (select contacto_id ag from cargos union select ag from abonos union select ag from ventas union select ag from pagos union select ag from sini) z
  ),
  built as (
    select a.ag id, coalesce(c.nombre,a.ag) nombre,
      coalesce((select sum(cargo) from cargos where contacto_id=a.ag),0) facturado,
      coalesce((select sum(monto) from cob where ag=a.ag),0)+coalesce((select sum(monto) from abonos where ag=a.ag),0) cobrado,
      coalesce((select sum(mc) from ventas where ag=a.ag),0) comprado,
      coalesce((select sum(monto) from pagos where ag=a.ag),0) pagado,
      coalesce((select jsonb_agg(jsonb_build_object('id_mov',ca.id,'fecha',ca.fecha,'hora',ca.hora,'pax',ca.cant_pax,
          'monto',ca.cargo,'bote',coalesce(ca.bote,''),'capitan',coalesce(ca.capitan,''),'operador',coalesce(ca.operador,''),'tipo',ca.tipo,
          'cobrado',coalesce((select sum(monto) from cob where mid=ca.id),0),
          'cobros',coalesce((select jsonb_agg(jsonb_build_object('monto',monto,'operador',operador,'hora',hora,'fecha',fecha,'metodo',metodo_pago)) from cob where mid=ca.id),'[]'::jsonb))
          order by ca.fecha,ca.hora) from cargos ca where ca.contacto_id=a.ag),'[]'::jsonb) movimientos,
      coalesce((select jsonb_agg(jsonb_build_object('id_mov',ve.id,'fecha',ve.fecha,'hora',ve.hora,'pax',ve.cant_pax,
          'monto',ve.mc,'origen',ve.origen,
          'pagado',coalesce((select sum(monto) from pagos where mid=ve.id),0),
          'pagos',coalesce((select jsonb_agg(jsonb_build_object('monto',monto,'operador',operador,'hora',hora,'fecha',fecha)) from pagos where mid=ve.id),'[]'::jsonb))
          order by ve.fecha,ve.hora) from ventas ve where ve.ag=a.ag),'[]'::jsonb) ventas,
      coalesce((select jsonb_agg(jsonb_build_object('monto',monto,'operador',operador,'hora',hora,'fecha',fecha,'metodo',metodo_pago) order by fecha,hora) from abonos where ag=a.ag),'[]'::jsonb) abonos,
      coalesce((select sum(monto) from abonos where ag=a.ag),0) abonado,
      coalesce((select si from sini where ag=a.ag),0) saldo_inicial
    from ag_ids a left join contactos c on c.id=a.ag
  ),
  fin as (
    select *,
      (facturado-cobrado) + greatest(saldo_inicial,0) te_debe,
      (comprado-pagado)  + greatest(-saldo_inicial,0) le_debo,
      (facturado-cobrado)-(comprado-pagado)+saldo_inicial neto
    from built where facturado<>0 or cobrado<>0 or comprado<>0 or pagado<>0 or saldo_inicial<>0
  )
  select coalesce(jsonb_agg(to_jsonb(fin) order by abs(neto) desc),'[]'::jsonb),
    coalesce(sum(te_debe) filter (where te_debe>0.005),0), coalesce(sum(le_debo) filter (where le_debo>0.005),0),
    coalesce(sum(facturado),0), coalesce(sum(cobrado),0),
    count(*) filter (where te_debe>0.005), count(*) filter (where le_debo>0.005)
  into v_ag, v_td, v_ld, v_ft, v_ct, v_ntd, v_nld from fin;
  return jsonb_build_object('desde',coalesce(p_desde::text,''),'hasta',coalesce(p_hasta::text,''),'agencias',v_ag,
    'totales',jsonb_build_object('te_deben',v_td,'le_debo',v_ld,'neto_global',v_td-v_ld,'facturado_total',v_ft,
      'cobrado_total',v_ct,'n_te_deben',v_ntd,'n_le_debo',v_nld));
end $function$;
