-- ============================================================
-- Finanzas del PS Panel con shape RICO (igual que getBalance* / getCajaFeed).
-- desde/hasta = fecha Lima del movimiento/caja (vacío/null = todo).
-- ============================================================
-- helper: ¿el tipo es PaseIn? (Aliado(PaseIn) o 'Aliado' legacy, NO PaseOut)
create or replace function m_is_pasein(t text) returns boolean language sql immutable as
$$ select t like '%Aliado%' and t not like '%PaseOut%' $$;

-- ── CAJA FEED ── (réplica de getCajaFeed)
create or replace function get_caja_feed(p_desde date default null, p_hasta date default null)
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$
declare v jsonb;
begin
  perform _req_staff();
  with it as (
    select k.*, (k.ts at time zone 'America/Lima')::date dia,
      to_char(k.ts at time zone 'America/Lima','HH24:MI') hora,
      v.es_ingreso, v.label, coalesce(c.nombre, k.contacto_id, '') cont,
      (lower(coalesce(k.metodo_pago,'')) like '%efect%' or lower(coalesce(k.metodo_pago,''))='cash') efvo
    from caja_operador k
    join v_caja_items v on v.id=k.id
    left join contactos c on c.id=k.contacto_id
    where (p_desde is null or (k.ts at time zone 'America/Lima')::date >= p_desde)
      and (p_hasta is null or (k.ts at time zone 'America/Lima')::date <= p_hasta)
  ),
  dias as (
    select dia,
      sum(monto) filter (where es_ingreso) ingresos,
      sum(monto) filter (where not es_ingreso) egresos,
      sum(case when efvo then (case when es_ingreso then monto else -monto end) else 0 end) efectivo,
      sum(case when not efvo then (case when es_ingreso then monto else -monto end) else 0 end) digital,
      jsonb_agg(jsonb_build_object('id',id,'categoria',categoria,'label',label,'esIngreso',es_ingreso,
        'contacto',cont,'monto',monto,'metodo',metodo_pago,'operador',operador,'hora',hora,'id_mov',coalesce(movimiento_id,''))
        order by hora desc) items
    from it group by dia
  )
  select coalesce(jsonb_agg(jsonb_build_object('fecha',to_char(dia,'YYYY-MM-DD'),
    'ingresos',coalesce(ingresos,0),'egresos',coalesce(egresos,0),'efectivo',coalesce(efectivo,0),
    'digital',coalesce(digital,0),'balance',coalesce(ingresos,0)-coalesce(egresos,0),'items',items) order by dia desc),'[]'::jsonb)
  into v from dias;
  return jsonb_build_object('desde',coalesce(p_desde::text,''),'hasta',coalesce(p_hasta::text,''),'dias',v);
end $$;

-- ── BALANCE AGENCIAS ── (réplica de getBalanceAgencias)
create or replace function get_balance_agencias(p_desde date default null, p_hasta date default null)
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$
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
    where k.categoria='Cobro' and coalesce(k.movimiento_id,'')=''
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
end $$;

-- ── BALANCE ALIADOS ── (réplica de getBalanceAliados)
create or replace function get_balance_aliados(p_desde date default null, p_hasta date default null)
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$
declare v_ali jsonb; v_ventas jsonb; v_alertas jsonb; v_td numeric; v_ld numeric; v_ntd int; v_nld int; v_nman int;
begin
  perform _req_staff();
  with mv as (
    select m.*, (m.operacion_id is null or m.operacion_id in ('','PASE_DIRECTO')) directo,
      to_char(m.registrado_at at time zone 'America/Lima','YYYY-MM-DD') fecha,
      to_char(m.registrado_at at time zone 'America/Lima','HH24:MI') hora,
      bo.nombre bote, pe.nombre capitan,
      cc.tipo tipo_con, co.nombre nom_origen, cp.tipo tipo_pase, cp.nombre nom_pase, cc.nombre nom_con
    from movimientos m
    left join operaciones o on o.id=m.operacion_id
    left join embarcaciones bo on bo.id=o.bote_id
    left join personal pe on pe.id=o.capitan_id
    left join contactos cc on cc.id=m.contacto_id
    left join contactos co on co.id=m.contacto_id
    left join contactos cp on cp.id=m.contacto_pase_id
    where m.tipo like '%Aliado%' and lower(coalesce(m.estado,'')) not like '%cancel%'
      and (p_desde is null or (m.registrado_at at time zone 'America/Lima')::date >= p_desde)
      and (p_hasta is null or (m.registrado_at at time zone 'America/Lima')::date <= p_hasta)
  ),
  -- PaseIn: aliado = contacto_id (tipo aliado, no CON-00)
  pin as (
    select contacto_id ali, nom_con nombre, cant_pax pax, 'in' dir, fecha, hora, coalesce(bote,'') bote, coalesce(capitan,'') capitan, directo, '' origen, id mov
    from mv where m_is_pasein(mv.tipo) and contacto_id !~ '^CON-00' and coalesce(contacto_id,'')<>'' and tipo_con='aliado'
  ),
  pout as (
    select contacto_pase_id ali, nom_pase nombre, cant_pax pax, 'out' dir, fecha, hora, coalesce(bote,'') bote, coalesce(capitan,'') capitan, directo, coalesce(nom_origen,'') origen, id mov
    from mv where mv.tipo like '%PaseOut%' and coalesce(contacto_pase_id,'')<>'' and contacto_pase_id !~ '^CON-00' and tipo_pase='aliado'
  ),
  movs as (select * from pin union all select * from pout),
  sini_a as (  -- saldo inicial PAX (arrastre): gated solo por hasta
    select s.contacto_id ali, coalesce(c.nombre, s.contacto_id) nombre, s.monto si
    from saldos_iniciales s left join contactos c on c.id=s.contacto_id
    where s.tipo='aliado' and (p_hasta is null or s.fecha_corte <= p_hasta)
  ),
  ali_ids as (
    select ali, max(nombre) nombre from (
      select ali, nombre from movs
      union all select ali, nombre from sini_a
    ) z group by ali
  ),
  built as (
    select a.ali id, coalesce(a.nombre,a.ali) nombre,
      coalesce((select sum(pax) from movs where ali=a.ali and dir='in'),0) pax_in,
      coalesce((select sum(pax) from movs where ali=a.ali and dir='out'),0) pax_out,
      coalesce((select jsonb_agg(jsonb_build_object('fecha',fecha,'hora',hora,'embarcacion',bote,'capitan',capitan,
        'directo',directo,'dir',dir,'pax',pax,'origen',origen,'id_mov',mov) order by fecha) from movs where ali=a.ali),'[]'::jsonb) movimientos,
      coalesce((select si from sini_a where ali=a.ali),0) saldo_inicial
    from ali_ids a
  ),
  fin as (select *, pax_in-pax_out+saldo_inicial neto from built where pax_in<>0 or pax_out<>0 or saldo_inicial<>0)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'nombre',nombre,'pax_in',pax_in,'pax_out',pax_out,'neto',neto,'saldo_inicial',saldo_inicial,'movimientos',movimientos) order by abs(neto) desc),'[]'::jsonb),
    coalesce(sum(neto) filter (where neto>0),0), coalesce(-sum(neto) filter (where neto<0),0),
    count(*) filter (where neto>0), count(*) filter (where neto<0), count(*) filter (where neto=0)
  into v_ali, v_td, v_ld, v_ntd, v_nld, v_nman from fin;
  -- ventas convertidas (PaseOut sin destino, monto_comprado>0, comprador agencia/contacto)
  select coalesce(jsonb_agg(jsonb_build_object('fecha',to_char(m.registrado_at at time zone 'America/Lima','YYYY-MM-DD'),
      'hora',to_char(m.registrado_at at time zone 'America/Lima','HH24:MI'),'pax',m.cant_pax,'monto',m.monto_comprado,
      'origen',coalesce(co.nombre,m.contacto_id),'comprador',coalesce(cc.nombre,m.agencia_comprada_id),'comprador_id',m.agencia_comprada_id,'id_mov',m.id)
      order by m.registrado_at),'[]'::jsonb)
    into v_ventas from movimientos m left join contactos co on co.id=m.contacto_id left join contactos cc on cc.id=m.agencia_comprada_id
    where m.tipo like '%Aliado%' and lower(coalesce(m.estado,'')) not like '%cancel%'
      and m.tipo like '%PaseOut%' and coalesce(m.contacto_pase_id,'')='' and coalesce(m.monto_comprado,0)>0 and coalesce(m.agencia_comprada_id,'')<>''
      and (p_desde is null or (m.registrado_at at time zone 'America/Lima')::date >= p_desde)
      and (p_hasta is null or (m.registrado_at at time zone 'America/Lima')::date <= p_hasta);
  v_alertas := '[]'::jsonb;  -- datos limpios en Supabase (tipos normalizados); sin pases a contactos no-aliado
  return jsonb_build_object('desde',coalesce(p_desde::text,''),'hasta',coalesce(p_hasta::text,''),
    'aliados',v_ali,'ventas',v_ventas,'alertas',v_alertas,
    'ventas_monto',coalesce((select sum((x->>'monto')::numeric) from jsonb_array_elements(v_ventas) x),0),
    'totales',jsonb_build_object('te_deben',v_td,'les_debes',v_ld,'neto_global',v_td-v_ld,'n_te_deben',v_ntd,'n_les_debes',v_nld,
      'n_a_mano',v_nman,'n_alertas',0,'n_ventas',jsonb_array_length(v_ventas)));
end $$;
