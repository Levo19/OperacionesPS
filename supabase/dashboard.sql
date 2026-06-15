-- ============================================================
-- get_dashboard(): replica EXACTA de getDashboardData() del code.gs.
-- Una sola fuente de verdad; el frontend llama supabase.rpc('get_dashboard').
-- "Hoy" = fecha en TZ America/Lima (espeja el backend GAS).
-- adicionales jsonb -> texto "k:v,k:v" (el front espera string).
-- ============================================================
create or replace function _adic_txt(p jsonb) returns text language sql immutable as
$$ select coalesce(string_agg(k||':'||v, ','), '') from jsonb_each_text(coalesce(p,'{}'::jsonb)) as t(k,v) $$;

create or replace function get_dashboard()
  returns jsonb language plpgsql security definer set search_path=public, auth as
$$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_ops jsonb; v_sala jsonb; v_caja jsonb; v_pases jsonb; v_cat jsonb;
  v_botes_ocup text[]; v_cap_ocup text[]; v_guia_ocup text[];
begin
  perform _req_staff();

  -- recursos ocupados = operaciones Abiertas de HOY
  select coalesce(array_agg(bote_id) filter (where bote_id is not null),'{}'),
         coalesce(array_agg(capitan_id) filter (where capitan_id is not null),'{}'),
         coalesce(array_agg(guia_id) filter (where guia_id is not null),'{}')
    into v_botes_ocup, v_cap_ocup, v_guia_ocup
  from operaciones where estado='Abierta' and fecha=v_hoy;

  -- operaciones a mostrar: Abierta/En_Viaje siempre + Cerrada de HOY
  select coalesce(jsonb_agg(o order by o->>'__ord' desc),'[]'::jsonb) into v_ops from (
    select jsonb_build_object(
      'id', op.id, 'bote', coalesce(e.nombre,'Lancha ('||op.bote_id||')'),
      'capacidad', coalesce(e.capacidad_pax,0),
      'ocupados', coalesce((select sum(m.cant_pax) from movimientos m
                   where m.operacion_id=op.id
                     and lower(coalesce(m.estado,'')) not like '%pasado%'
                     and lower(coalesce(m.estado,'')) not like '%cancelado%'),0),
      'estado', op.estado,
      'capitan', coalesce(pc.nombre, op.capitan_id, 'No Asignado'),
      'guia', coalesce(pg.nombre, 'Sin Guía'),
      'hora_salida', op.hora_salida, 'destino', coalesce(op.destino,''),
      'fecha', to_char(op.fecha,'YYYY-MM-DD'), 'foto_zarpe', coalesce(op.foto_zarpe_url,''),
      'manifiesto', coalesce((select jsonb_agg(jsonb_build_object(
            'id',m.id,'tipo',m.tipo,'contacto',m.contacto_id,
            'nombreContacto',coalesce(m.nombre_contacto,m.contacto_id),
            'pax',m.cant_pax,'monto',m.monto_total,'estado',m.estado,
            'id_contactoPase',coalesce(m.contacto_pase_id,''),'adicionales',_adic_txt(m.adicionales))
            order by m.registrado_at desc)
          from movimientos m where m.operacion_id=op.id
            and lower(coalesce(m.estado,'')) not like '%pasado%'
            and lower(coalesce(m.estado,'')) not like '%cancelado%'),'[]'::jsonb),
      'manifiesto_pasados', coalesce((select jsonb_agg(jsonb_build_object(
            'id',m.id,'tipo',m.tipo,'contacto',m.contacto_id,
            'nombreContacto',coalesce(m.nombre_contacto,m.contacto_id),
            'pax',m.cant_pax,'monto',m.monto_total,'estado',m.estado,
            'id_contactoPase',coalesce(m.contacto_pase_id,''),'adicionales',_adic_txt(m.adicionales)))
          from movimientos m where m.operacion_id=op.id
            and lower(coalesce(m.estado,'')) like '%pasado%'
            and lower(coalesce(m.estado,'')) not like '%cancelado%'),'[]'::jsonb),
      '__ord', op.creado_at
    ) as o
    from operaciones op
    left join embarcaciones e on e.id=op.bote_id
    left join personal pc on pc.id=op.capitan_id
    left join personal pg on pg.id=op.guia_id
    where op.estado in ('Abierta','En_Viaje') or (op.estado='Cerrada' and op.fecha=v_hoy)
  ) s;

  -- sala de espera: Pendientes (todas) + las de HOY ya tomadas (Asignado/Pasado)
  -- para poder tacharlas abajo. creado_por = quién la registró.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'cliente',r.cliente,'pax',r.pax,'estado',r.estado,
      'hora',r.hora,'contacto',r.contacto_id,'monto',coalesce(r.monto,0),
      'fecha',to_char(r.fecha,'YYYY-MM-DD'),'creado_por',coalesce(r.creado_por,'')) order by r.hora),'[]'::jsonb)
    into v_sala from reservas r
    where r.estado='Pendiente'
       or (r.fecha = v_hoy and r.estado in ('Asignado','Pasado'));

  -- movimientos_dia: TODO Caja_Operador (el front filtra por día)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',k.id,'id_operacion',coalesce(k.operacion_id,''),'id_contacto',coalesce(k.contacto_id,''),
      'categoria',k.categoria,'monto',k.monto,'metodo_pago',coalesce(k.metodo_pago,''),
      'comentarios',coalesce(k.comentarios,''),'foto_url',coalesce(k.foto_url,''),
      'operador',coalesce(k.operador,''),'timestamp',to_char(k.ts at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'id_movimiento',coalesce(k.movimiento_id,''))),'[]'::jsonb)
    into v_caja from caja_operador k;

  -- pases del DÍA (derivados/comprados HOY)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',m.id,'tipo',m.tipo,'aliadoId',coalesce(m.contacto_pase_id,''),'origenId',coalesce(m.contacto_id,''),
      'nombreOrigen',coalesce(m.nombre_contacto,m.contacto_id,''),'pax',m.cant_pax,'monto',m.monto_total,
      'estado',m.estado,'timestamp',to_char(m.registrado_at at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),
      'id_agencia_comprada',coalesce(m.agencia_comprada_id,''),'monto_comprado',coalesce(m.monto_comprado,0),
      'adicionales',_adic_txt(m.adicionales))),'[]'::jsonb)
    into v_pases from movimientos m
    where (coalesce(m.contacto_pase_id,'')<>'' or coalesce(m.agencia_comprada_id,'')<>'')
      and (m.registrado_at at time zone 'America/Lima')::date = v_hoy;

  -- catálogos
  select jsonb_build_object(
    'botes', coalesce((select jsonb_agg(jsonb_build_object('id',id,'nombre',nombre,'cap',capacidad_pax))
                from embarcaciones where id is not null and not (id = any(v_botes_ocup))),'[]'::jsonb),
    'capitanes', coalesce((select jsonb_agg(jsonb_build_object('id',id,'nombre',nombre))
                from personal where lower(coalesce(rol,'')) like '%capit%' and not (id = any(v_cap_ocup))),'[]'::jsonb),
    'guias', coalesce((select jsonb_agg(jsonb_build_object('id',id,'nombre',nombre))
                from personal where lower(coalesce(rol,'')) like '%guia%' and not (id = any(v_guia_ocup))),'[]'::jsonb),
    'contactos', coalesce((select jsonb_agg(jsonb_build_object('id',id,'nombre',nombre,'tipo',tipo,'precio',precio_defecto))
                from contactos where id is not null),'[]'::jsonb),
    'operadores', coalesce((select jsonb_agg(jsonb_build_object('id',id,'nombre',nombre))
                from personal where lower(coalesce(rol,'')) like '%operador%'),'[]'::jsonb),
    'impuestos', coalesce((select jsonb_agg(jsonb_build_object('id',id,'nombre',nombre,'monto',monto))
                from impuestos where id is not null and nombre is not null),'[]'::jsonb),
    'todos_capitanes', coalesce((select jsonb_agg(jsonb_build_object('id',id,'nombre',nombre))
                from personal where lower(coalesce(rol,'')) like '%capit%'),'[]'::jsonb),
    'todos_guias', coalesce((select jsonb_agg(jsonb_build_object('id',id,'nombre',nombre))
                from personal where lower(coalesce(rol,'')) like '%guia%'),'[]'::jsonb)
  ) into v_cat;

  return jsonb_build_object(
    'operaciones_abiertas', (select coalesce(jsonb_agg(x - '__ord'),'[]'::jsonb) from jsonb_array_elements(v_ops) x),
    'sala_de_espera', v_sala, 'movimientos_dia', v_caja,
    'pases_externos', v_pases, 'catalogos', v_cat);
end $$;
