-- ============================================================
-- OperacionesPS · RPCs (reemplazan los 21 writes del code.gs)
-- Todos SECURITY DEFINER + guard es_staff() (camino B: anon key en cliente).
-- Aforo fiel al GAS: ocupan el bote los movimientos que NO están 'pasado'
-- ni 'cancelado' (PaseOut='Pasado' = pax enviado a otra lancha → no ocupa).
-- IDs nuevos por secuencia con 7 dígitos → no colisionan con históricos (6 díg).
-- ============================================================
-- firma vieja (p_id primero) reemplazada por la nueva (p_id al final, opcional)
drop function if exists registrar_movimiento(text,text,text,text,int,numeric,numeric,text);

create sequence if not exists seq_mov start 1000000;
create sequence if not exists seq_op  start 1000000;
create sequence if not exists seq_tx  start 1000000;
create sequence if not exists seq_res start 100000;

create or replace function gen_id(p_prefix text, p_seq text)
  returns text language plpgsql as
$$ begin return p_prefix || lpad(nextval(p_seq)::text, 7, '0'); end $$;

-- guard reusable: aborta si el caller no es staff activo
create or replace function _req_staff() returns void language plpgsql as
$$ begin if not es_staff() then raise exception 'NO_AUTH: sesión no autorizada'; end if; end $$;

-- ── aforo (fiel a CheckCapacidadDisponible) ──────────────────
create or replace function _aforo(p_op text, p_ignore text default null)
  returns table(ocupados int, capacidad int) language sql stable as
$$
  select coalesce((select sum(cant_pax) from movimientos
                    where operacion_id=p_op and id is distinct from p_ignore
                      and lower(coalesce(estado,'')) not like '%pasado%'
                      and lower(coalesce(estado,'')) not like '%cancel%'),0)::int,
         coalesce((select e.capacidad_pax from operaciones o join embarcaciones e on e.id=o.bote_id
                    where o.id=p_op),999)::int
$$;

-- 1) abordaje directo (registrarMovimientoPax): op Abierta + aforo
create or replace function registrar_movimiento(
    p_op text, p_tipo text, p_contacto text, p_nombre text, p_pax int,
    p_precio numeric, p_monto numeric, p_operador text, p_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_estado text; v_oc int; v_cap int; v_id text := coalesce(p_id, gen_id('MOV-','seq_mov'));
begin
  perform _req_staff();
  perform 1 from operaciones where id=p_op for update;           -- lock fila
  select estado into v_estado from operaciones where id=p_op;
  if v_estado is distinct from 'Abierta' then
    raise exception 'CERRADA: la lancha ya zarpó o está cerrada';
  end if;
  select ocupados,capacidad into v_oc,v_cap from _aforo(p_op);
  if v_cap is not null and v_oc + p_pax > v_cap then
    raise exception 'AFORO: solo quedan % cupos', v_cap - v_oc;
  end if;
  insert into movimientos(id,operacion_id,tipo,contacto_id,nombre_contacto,cant_pax,precio_unit,monto_total,operador,registrado_at,estado)
    values(v_id,p_op,p_tipo,p_contacto,p_nombre,p_pax,p_precio,p_monto,p_operador,now(),'Embarcado');
  return v_id;
end $$;

-- 2) editar movimiento (editarMovimientoPax): aforo excluyéndose, marca (Editado)
create or replace function editar_movimiento(
    p_id text, p_op text, p_tipo text, p_contacto text, p_nombre text,
    p_pax int, p_precio numeric, p_monto numeric)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_oc int; v_cap int; v_est text;
begin
  perform _req_staff();
  perform 1 from operaciones where id=p_op for update;
  select ocupados,capacidad into v_oc,v_cap from _aforo(p_op,p_id);
  if v_cap is not null and v_oc + p_pax > v_cap then
    raise exception 'AFORO: solo quedan % cupos', v_cap - v_oc;
  end if;
  select estado into v_est from movimientos where id=p_id;
  if not found then raise exception 'NO_EXISTE: movimiento %', p_id; end if;
  update movimientos set tipo=p_tipo, contacto_id=p_contacto, nombre_contacto=p_nombre,
    cant_pax=p_pax, precio_unit=p_precio, monto_total=p_monto,
    estado = case when coalesce(v_est,'') like '%(Editado)%' then v_est else coalesce(v_est,'')||' (Editado)' end
   where id=p_id;
  return p_id;
end $$;

-- 3) abrir operación
create or replace function abrir_operacion(
    p_bote text, p_capitan text, p_guia text, p_hora text, p_destino text, p_creador text, p_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_id text := coalesce(p_id, gen_id('OP-','seq_op'));
begin
  perform _req_staff();
  insert into operaciones(id,fecha,hora_salida,bote_id,capitan_id,guia_id,estado,creado_por,destino,creado_at)
    values(v_id,(now() at time zone 'America/Lima')::date,p_hora,p_bote,
           nullif(p_capitan,''),nullif(p_guia,''),'Abierta',p_creador,nullif(p_destino,''),now());
  return v_id;
end $$;

-- 4) crear reserva
create or replace function crear_reserva(
    p_fecha date, p_hora text, p_contacto text, p_cliente text, p_pax int, p_monto numeric, p_creador text, p_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_id text := coalesce(p_id, gen_id('RES-','seq_res'));
begin
  perform _req_staff();
  insert into reservas(id,fecha,hora,contacto_id,cliente,pax,estado,creado_at,creado_por)
    values(v_id,p_fecha,p_hora,nullif(p_contacto,''),p_cliente,p_pax,'Pendiente',now(),nullif(p_creador,''));
  return v_id;
end $$;

-- 5) asignar reserva a una lancha (aforo; 'Aliado' legacy → 'Aliado(PaseIn)')
create or replace function asignar_reserva(
    p_reserva text, p_op text, p_tipo text, p_contacto text, p_nombre text,
    p_pax int, p_precio numeric, p_monto numeric, p_creador text, p_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_oc int; v_cap int; v_id text := coalesce(p_id, gen_id('MOV-','seq_mov'));
begin
  perform _req_staff();
  perform 1 from operaciones where id=p_op for update;
  select ocupados,capacidad into v_oc,v_cap from _aforo(p_op);
  if v_cap is not null and v_oc + p_pax > v_cap then
    raise exception 'AFORO: solo quedan % cupos', v_cap - v_oc;
  end if;
  update reservas set estado='Asignado' where id=p_reserva;
  insert into movimientos(id,operacion_id,tipo,contacto_id,nombre_contacto,cant_pax,precio_unit,monto_total,operador,registrado_at,estado)
    values(v_id,p_op,case when p_tipo='Aliado' then 'Aliado(PaseIn)' else coalesce(p_tipo,'Agencia') end,
           p_contacto,p_nombre,p_pax,coalesce(p_precio,0),coalesce(p_monto,0),p_creador,now(),'Embarcado');
  return v_id;
end $$;

-- 6) registrar transacción de caja (la foto se sube a Storage en el cliente; aquí va la url)
create or replace function registrar_transaccion(
    p_op text, p_contacto text, p_categoria text, p_monto numeric, p_metodo text,
    p_comentarios text, p_foto_url text, p_operador text, p_mov text default null, p_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_id text := coalesce(p_id, gen_id('TX-','seq_tx'));
begin
  perform _req_staff();
  insert into caja_operador(id,operacion_id,contacto_id,categoria,monto,metodo_pago,comentarios,foto_url,operador,ts,movimiento_id)
    values(v_id,nullif(p_op,''),nullif(p_contacto,''),coalesce(p_categoria,'Cobro'),coalesce(p_monto,0),
           coalesce(p_metodo,'Efectivo'),nullif(p_comentarios,''),nullif(p_foto_url,''),p_operador,now(),nullif(p_mov,''));
  return v_id;
end $$;

-- 7) eliminar transacción de caja
create or replace function eliminar_transaccion(p_id text)
  returns void language plpgsql security definer set search_path=public as
$$ begin perform _req_staff(); delete from caja_operador where id=p_id; end $$;

-- 8) derivar pase (Embarcado → PaseOut hacia un aliado)
create or replace function derivar_pase(p_mov text, p_aliado text, p_operador text)
  returns void language plpgsql security definer set search_path=public as
$$
begin
  perform _req_staff();
  update movimientos set tipo='Aliado(PaseOut)', operador=p_operador, registrado_at=now(),
    estado='Pasado', contacto_pase_id=p_aliado where id=p_mov;
  if not found then raise exception 'NO_EXISTE: movimiento %', p_mov; end if;
end $$;

-- 9) cancelar movimiento (soft)
create or replace function eliminar_movimiento(p_mov text)
  returns void language plpgsql security definer set search_path=public as
$$ begin perform _req_staff(); update movimientos set estado='Cancelado' where id=p_mov;
   if not found then raise exception 'NO_EXISTE: movimiento %', p_mov; end if; end $$;

-- 10) actualizar adicionales (jsonb)
create or replace function actualizar_adicionales(p_mov text, p_adic jsonb)
  returns void language plpgsql security definer set search_path=public as
$$ begin perform _req_staff(); update movimientos set adicionales=coalesce(p_adic,'{}'::jsonb) where id=p_mov;
   if not found then raise exception 'NO_EXISTE: movimiento %', p_mov; end if; end $$;

-- 11) zarpar
create or replace function zarpar_operacion(p_op text)
  returns void language plpgsql security definer set search_path=public as
$$ begin perform _req_staff(); update operaciones set estado='En_Viaje' where id=p_op;
   if not found then raise exception 'NO_EXISTE: operación %', p_op; end if; end $$;

-- 12) confirmar llegada (cierra)
create or replace function confirmar_llegada(p_op text)
  returns void language plpgsql security definer set search_path=public as
$$ begin perform _req_staff(); update operaciones set estado='Cerrada' where id=p_op;
   if not found then raise exception 'NO_EXISTE: operación %', p_op; end if; end $$;

-- 13) cerrar operación + liquidación (suma monto_total de sus movimientos)
create or replace function cerrar_operacion(p_op text, p_foto_url text default null)
  returns numeric language plpgsql security definer set search_path=public as
$$
declare v_total numeric;
begin
  perform _req_staff();
  update operaciones set estado='Cerrada', foto_zarpe_url=coalesce(nullif(p_foto_url,''),foto_zarpe_url) where id=p_op;
  if not found then raise exception 'NO_EXISTE: operación %', p_op; end if;
  select coalesce(sum(monto_total),0) into v_total from movimientos where operacion_id=p_op;
  return v_total;
end $$;

-- 14) set foto de zarpe (la imagen va a Storage; aquí solo la url)
create or replace function set_foto_zarpe(p_op text, p_url text)
  returns void language plpgsql security definer set search_path=public as
$$ begin perform _req_staff(); update operaciones set foto_zarpe_url=p_url where id=p_op;
   if not found then raise exception 'NO_EXISTE: operación %', p_op; end if; end $$;

-- 15) pase directo desde reserva (sin lancha)
create or replace function pase_desde_reserva(
    p_reserva text, p_contacto_orig text, p_nombre_orig text, p_aliado text,
    p_pax int, p_precio numeric, p_monto numeric, p_creador text, p_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_id text := coalesce(p_id, gen_id('MOV-','seq_mov'));
begin
  perform _req_staff();
  update reservas set estado='Pasado' where id=p_reserva;
  insert into movimientos(id,operacion_id,tipo,contacto_id,nombre_contacto,cant_pax,precio_unit,monto_total,operador,registrado_at,estado,contacto_pase_id)
    values(v_id,'PASE_DIRECTO','Aliado(PaseOut)',nullif(p_contacto_orig,''),p_nombre_orig,p_pax,
           coalesce(p_precio,0),coalesce(p_monto,0),p_creador,now(),'Pasado',p_aliado);
  return v_id;
end $$;

-- 16) editar operación (solo campos provistos)
create or replace function editar_operacion(p_op text, p_capitan text default null, p_guia text default null, p_hora text default null)
  returns void language plpgsql security definer set search_path=public as
$$
begin
  perform _req_staff();
  update operaciones set
    capitan_id = coalesce(p_capitan, capitan_id),
    guia_id    = coalesce(p_guia, guia_id),
    hora_salida= coalesce(nullif(p_hora,''), hora_salida)
   where id=p_op;
  if not found then raise exception 'NO_EXISTE: operación %', p_op; end if;
end $$;

-- 17) anular operación (solo si no quedan pax activos y no está Cerrada/Cancelada)
create or replace function anular_operacion(p_op text)
  returns void language plpgsql security definer set search_path=public as
$$
declare v_est text; v_activos int;
begin
  perform _req_staff();
  perform 1 from operaciones where id=p_op for update;
  select estado into v_est from operaciones where id=p_op;
  if not found then raise exception 'NO_EXISTE: operación %', p_op; end if;
  if v_est in ('Cerrada','Cancelada') then raise exception 'ESTADO: la operación ya está %', v_est; end if;
  select count(*) into v_activos from movimientos
   where operacion_id=p_op
     and lower(coalesce(estado,'')) not like '%cancelado%'
     and lower(coalesce(estado,'')) not like '%pasado%';
  if v_activos > 0 then raise exception 'PAX_ACTIVOS: hay pasajeros activos a bordo'; end if;
  update operaciones set estado='Cancelada' where id=p_op;
end $$;

-- 18) auto-cierre diario (pg_cron): Abierta → Cerrada de las ops de HOY (TZ Lima)
create or replace function auto_cerrar_ops()
  returns int language plpgsql security definer set search_path=public as
$$
declare v_n int;
begin
  update operaciones set estado='Cerrada'
   where estado='Abierta' and fecha = (now() at time zone 'America/Lima')::date;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 19) convertir pase a compra (aliado → agencia compradora)
create or replace function convertir_pase_compra(p_mov text, p_agencia text, p_monto numeric)
  returns void language plpgsql security definer set search_path=public as
$$
begin
  perform _req_staff();
  if coalesce(p_monto,0) <= 0 then raise exception 'MONTO: requerido > 0'; end if;
  update movimientos set contacto_pase_id=null, agencia_comprada_id=p_agencia, monto_comprado=p_monto where id=p_mov;
  if not found then raise exception 'NO_EXISTE: movimiento %', p_mov; end if;
end $$;

-- 20) anular pase (restaura tipo desde Contactos, reasigna lancha, vuelve a Embarcado)
create or replace function anular_pase(p_mov text, p_op_nueva text)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_cont text; v_tipo text;
begin
  perform _req_staff();
  select contacto_id into v_cont from movimientos where id=p_mov;
  if not found then raise exception 'NO_EXISTE: movimiento %', p_mov; end if;
  select coalesce(initcap(tipo),'Directo') into v_tipo from contactos where id=v_cont;
  v_tipo := coalesce(v_tipo,'Directo');
  update movimientos set operacion_id=p_op_nueva, tipo=v_tipo, estado='Embarcado', contacto_pase_id=null where id=p_mov;
  return v_tipo;
end $$;
