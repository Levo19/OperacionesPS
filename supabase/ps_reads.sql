-- ============================================================
-- ps_reads.sql — LECTURAS del panel/muelle (get_lanchas_*, kpis, historico).
-- ⚠ SINCRONIZADO DESDE PROD (Supabase vivo) 2026-07-10 tras el 100x.
-- Incluye: get_lanchas_dia con capacidad (aforo) + _caja en pases_sueltos, y _adic_sum blindado.
-- La fuente de verdad es la DB; este archivo es el espejo del repo.
-- ============================================================

CREATE OR REPLACE FUNCTION public._adic_sum(p jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(sum(
    case
      when jsonb_typeof(e.value) = 'number' then (e.value #>> '{}')::numeric
      when jsonb_typeof(e.value) = 'string'
           and trim(e.value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then trim(e.value #>> '{}')::numeric
      else 0
    end
  ), 0)
  from jsonb_each(case when jsonb_typeof(coalesce(p,'{}'::jsonb)) = 'object' then p else '{}'::jsonb end) as e(k, value);
$function$;

CREATE OR REPLACE FUNCTION public.get_lanchas_fechas()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  select coalesce(array_agg(d order by d desc), '{}') from (
    select distinct to_char(fecha,'YYYY-MM-DD') d from operaciones where fecha is not null
    union
    select distinct to_char((registrado_at at time zone 'America/Lima')::date,'YYYY-MM-DD')
      from movimientos where coalesce(operacion_id,'') in ('','PASE_DIRECTO') and registrado_at is not null
  ) x
$function$;

CREATE OR REPLACE FUNCTION public.get_lanchas_dia(p_fecha date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_ops jsonb; v_pases jsonb; v_caja_suelta jsonb;
  v_efectivo numeric; v_transfer numeric;
  v_pax int; v_ing numeric; v_deuda numeric; v_count int; v_semaforo text;
begin
  perform _req_staff();

  -- ── operaciones del día con agregados de movimientos ──
  with day_ops as (select * from operaciones where fecha = p_fecha),
  mov as (
    select m.*, _adic_sum(m.adicionales) adic, c.precio_defecto pdef, c.tipo ctipo,
           coalesce(cp.nombre, m.contacto_pase_id) nom_pase
    from movimientos m
    left join contactos c on c.id = m.contacto_id
    left join contactos cp on cp.id = m.contacto_pase_id
  ),
  mov_op as (select * from mov where operacion_id in (select id from day_ops)),
  agg as (
    select operacion_id,
      sum(cant_pax) filter (where estado<>'Cancelado') pax_total,
      sum(case when estado='Cancelado' then 0
               when tipo in ('Directo','Agencia') then monto_total+adic
               when tipo='Comisionado' then pdef*cant_pax+adic else 0 end) ingresos,
      sum(case when estado='Cancelado' or tipo<>'Comisionado' then 0
               else greatest(0,(precio_unit*cant_pax)-(pdef*cant_pax)) end) deuda,
      sum(case when estado='Cancelado' then 0
               when tipo in ('Directo','Agencia') then monto_total+adic
               when tipo='Comisionado' then pdef*cant_pax+adic else 0 end) mov_sum
    from mov_op group by operacion_id
  ),
  chips as (
    select operacion_id, jsonb_object_agg(tipo, px) tipo_chips
    from (select operacion_id, tipo, sum(cant_pax) px from mov_op where estado<>'Cancelado' group by operacion_id, tipo) s
    group by operacion_id
  ),
  -- caja del día: atribuir a la op (directa, o por id_movimiento de un mov del día)
  m2o as (select id mov_id, operacion_id from mov_op),
  caja as (
    select k.*, coalesce(
        (select operacion_id from day_ops where id = k.operacion_id),
        (select mov_id_map.operacion_id from m2o mov_id_map where mov_id_map.mov_id = k.movimiento_id)
      ) op_attr,
      (lower(coalesce(k.metodo_pago,'')) like '%efect%' or lower(coalesce(k.metodo_pago,''))='cash') es_efectivo
    from caja_operador k
  ),
  caja_op as (select * from caja where op_attr is not null and op_attr in (select id from day_ops)),
  caja_agg as (select op_attr, sum(monto) caja_sum from caja_op group by op_attr)
  select
    coalesce(jsonb_agg(o order by o->>'hora_salida'), '[]'::jsonb)
  into v_ops
  from (
    select jsonb_build_object(
      'id', op.id, 'fecha', to_char(op.fecha,'YYYY-MM-DD'), 'hora_salida', op.hora_salida,
      'id_bote', op.bote_id, 'nombre_bote', coalesce(e.nombre, op.bote_id), 'capacidad', coalesce(e.capacidad_pax,0),
      'id_capitan', op.capitan_id, 'nombre_capitan', coalesce(pc.nombre, op.capitan_id),
      'id_guia', coalesce(op.guia_id,''), 'nombre_guia', case when op.guia_id is null then '' else coalesce(pg.nombre, op.guia_id) end,
      'estado', op.estado, 'creado_por', coalesce(op.creado_por,''), 'destino', coalesce(op.destino,''), 'foto_zarpe_url', coalesce(op.foto_zarpe_url,''),
      'pax_total', coalesce(a.pax_total,0), 'ingresos_operador', coalesce(a.ingresos,0),
      'deuda_comisionados', coalesce(a.deuda,0), 'mov_sum', coalesce(a.mov_sum,0),
      'caja_sum', coalesce(ca.caja_sum,0), 'tipo_chips', coalesce(ch.tipo_chips,'{}'::jsonb),
      'descuadre', abs(coalesce(ca.caja_sum,0)-coalesce(a.mov_sum,0)) > 0.5,
      'movimientos', coalesce((select jsonb_agg(jsonb_build_object(
            'id_mov',m.id,'id_operacion',m.operacion_id,'tipo',m.tipo,'id_contacto',m.contacto_id,
            'nombre_contacto',coalesce(m.nombre_contacto,''),'cant_pax',m.cant_pax,'precio_aplicado',m.precio_unit,
            'monto_total',m.monto_total,'adicionales',_adic_txt(m.adicionales),'operador',m.operador,
            'estado',m.estado,'id_contacto_pase',coalesce(m.contacto_pase_id,''),'nombre_contacto_pase',coalesce(m.nom_pase,''),
            'id_agencia_comprada',coalesce(m.agencia_comprada_id,''),'monto_comprado',m.monto_comprado,
            'precio_defecto',coalesce(m.pdef,0),'es_agencia_origen', m.ctipo='agencia')
          ) from mov_op m where m.operacion_id=op.id),'[]'::jsonb),
      'caja', coalesce((select jsonb_agg(jsonb_build_object(
            'id_transaccion',k.id,'id_operacion',k.op_attr,'id_contacto',k.contacto_id,'categoria',k.categoria,
            'monto',k.monto,'metodo_pago',k.metodo_pago,'comentarios',k.comentarios,'operador',k.operador,
            'id_movimiento',coalesce(k.movimiento_id,''))
          ) from caja_op k where k.op_attr=op.id),'[]'::jsonb)
    ) o
    from day_ops op
    left join embarcaciones e on e.id=op.bote_id
    left join personal pc on pc.id=op.capitan_id
    left join personal pg on pg.id=op.guia_id
    left join agg a on a.operacion_id=op.id
    left join caja_agg ca on ca.op_attr=op.id
    left join chips ch on ch.operacion_id=op.id
  ) s;

  -- ── pases sueltos (PASE_DIRECTO o sin op) del día ──
  select coalesce(jsonb_agg(jsonb_build_object(
      'id_mov',m.id,'id_operacion',coalesce(m.operacion_id,''),'tipo',m.tipo,'id_contacto',m.contacto_id,
      'nombre_contacto',coalesce(m.nombre_contacto,''),'cant_pax',m.cant_pax,'precio_aplicado',m.precio_unit,
      'monto_total',m.monto_total,'adicionales',_adic_txt(m.adicionales),'operador',m.operador,'estado',m.estado,
      'id_contacto_pase',coalesce(m.contacto_pase_id,''),'nombre_contacto_pase',coalesce(cp.nombre,m.contacto_pase_id,''),
      'id_agencia_comprada',coalesce(m.agencia_comprada_id,''),'monto_comprado',m.monto_comprado,'_caja',coalesce((select jsonb_agg(jsonb_build_object('id_movimiento',k.movimiento_id,'monto',k.monto,'metodo_pago',coalesce(k.metodo_pago,''),'categoria',k.categoria)) from caja_operador k where k.movimiento_id=m.id),'[]'::jsonb))),'[]'::jsonb)
    into v_pases from movimientos m left join contactos cp on cp.id=m.contacto_pase_id
    where coalesce(m.operacion_id,'') in ('','PASE_DIRECTO')
      and (m.registrado_at at time zone 'America/Lima')::date = p_fecha;

  -- ── caja suelta (no atribuible a op del día) + totales efectivo/transferencia ──
  with day_ops as (select id from operaciones where fecha=p_fecha),
  m2o as (select id mov_id, operacion_id from movimientos where operacion_id in (select id from day_ops)),
  caja as (
    select k.*, coalesce((select id from day_ops where id=k.operacion_id),
                         (select operacion_id from m2o where mov_id=k.movimiento_id)) op_attr,
           (lower(coalesce(k.metodo_pago,'')) like '%efect%' or lower(coalesce(k.metodo_pago,''))='cash') ef
    from caja_operador k
  ),
  cdia as (   -- caja que cuenta para el día: atribuida a op del día, o suelta con ts del día
    select *, (op_attr is not null) atrib,
      case when op_attr is not null then true
           else (ts at time zone 'America/Lima')::date = p_fecha end incluir
    from caja
  )
  select
    coalesce(sum(monto) filter (where incluir and ef),0),
    coalesce(sum(monto) filter (where incluir and not ef),0),
    coalesce(jsonb_agg(jsonb_build_object('id_transaccion',id,'id_operacion',coalesce(op_attr,''),'id_contacto',contacto_id,
       'categoria',categoria,'monto',monto,'metodo_pago',metodo_pago,'comentarios',comentarios,'operador',operador,
       'id_movimiento',coalesce(movimiento_id,'')) ) filter (where incluir and not atrib),'[]'::jsonb)
    into v_efectivo, v_transfer, v_caja_suelta
  from cdia;

  -- ── KPIs del día ──
  select coalesce(sum((o->>'pax_total')::int),0), coalesce(sum((o->>'ingresos_operador')::numeric),0),
         coalesce(sum((o->>'deuda_comisionados')::numeric),0), count(*)
    into v_pax, v_ing, v_deuda, v_count
  from jsonb_array_elements(v_ops) o;

  v_semaforo := case when v_count=0 then 'gris'
    when not exists(select 1 from jsonb_array_elements(v_ops) o where lower(o->>'estado') !~ 'cerr|pasad') then 'verde'
    when exists(select 1 from jsonb_array_elements(v_ops) o where lower(o->>'estado') ~ 'activ|abierta') then 'amarillo'
    else 'gris' end;

  return jsonb_build_object('operaciones', v_ops, 'pases_sueltos', v_pases, 'caja_suelta', v_caja_suelta,
    'kpis', jsonb_build_object('pax_total',v_pax,'ingresos_operador',v_ing,'deuda_comisionados',v_deuda,
      'caja_efectivo',v_efectivo,'caja_transferencia',v_transfer,'operaciones_count',v_count,'semaforo',v_semaforo));
end $function$;

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
    select m.*, coalesce(c.precio_defecto,0) pdef
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

CREATE OR REPLACE FUNCTION public.get_historico()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare v jsonb := '[]'::jsonb; d int; f date; k jsonb;
begin
  perform _req_staff();
  for d in reverse 6..0 loop
    f := (now() at time zone 'America/Lima')::date - d;
    k := get_kpis_ops(f);
    v := v || jsonb_build_object('fecha', to_char(f,'YYYY-MM-DD'),
      'ingresos_lanchas', k->'ingresos_operador', 'pax', k->'pax_total');
  end loop;
  return v;
end $function$;

