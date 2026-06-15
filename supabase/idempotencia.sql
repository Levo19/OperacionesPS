-- ============================================================
-- OperacionesPS · Idempotencia de escrituras concurrentes
-- ------------------------------------------------------------
-- Agrega una clave de idempotencia del cliente (local_id) a los 6 INSERT.
-- Replay del MISMO local_id (doble-tap / reintento / cola offline) devuelve
-- la fila ya creada SIN duplicar. La carrera de dos requests simultáneos con
-- el mismo local_id la resuelve el índice único parcial (on conflict do nothing).
-- IDs siguen siendo secuenciales (gen_id) — local_id es solo dedup.
-- Seguro de re-ejecutar (todo IF [NOT] EXISTS / create or replace).
-- ============================================================

-- 1) Columna local_id + índice único parcial (dedup real) en las 4 tablas con INSERT
alter table movimientos    add column if not exists local_id text;
alter table operaciones    add column if not exists local_id text;
alter table reservas       add column if not exists local_id text;
alter table caja_operador  add column if not exists local_id text;

create unique index if not exists ux_mov_localid  on movimientos(local_id)   where local_id is not null;
create unique index if not exists ux_op_localid   on operaciones(local_id)   where local_id is not null;
create unique index if not exists ux_res_localid  on reservas(local_id)      where local_id is not null;
create unique index if not exists ux_caja_localid on caja_operador(local_id) where local_id is not null;

-- ============================================================
-- 2) registrar_movimiento (abordaje directo) — idempotente
-- ============================================================
drop function if exists registrar_movimiento(text,text,text,text,int,numeric,numeric,text,text);
create or replace function registrar_movimiento(
    p_op text, p_tipo text, p_contacto text, p_nombre text, p_pax int,
    p_precio numeric, p_monto numeric, p_operador text, p_id text default null, p_local_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_estado text; v_oc int; v_cap int; v_id text; v_existing text;
begin
  perform _req_staff();
  if p_local_id is not null then
    select id into v_existing from movimientos where local_id = p_local_id;
    if found then return v_existing; end if;        -- replay → devolver el existente
  end if;
  perform 1 from operaciones where id=p_op for update;
  select estado into v_estado from operaciones where id=p_op;
  if v_estado is distinct from 'Abierta' then
    raise exception 'CERRADA: la lancha ya zarpó o está cerrada';
  end if;
  select ocupados,capacidad into v_oc,v_cap from _aforo(p_op);
  if v_cap is not null and v_oc + p_pax > v_cap then
    raise exception 'AFORO: solo quedan % cupos', v_cap - v_oc;
  end if;
  v_id := coalesce(p_id, gen_id('MOV-','seq_mov'));
  insert into movimientos(id,operacion_id,tipo,contacto_id,nombre_contacto,cant_pax,precio_unit,monto_total,operador,registrado_at,estado,local_id)
    values(v_id,p_op,p_tipo,p_contacto,p_nombre,p_pax,p_precio,p_monto,p_operador,now(),'Embarcado',p_local_id)
    on conflict (local_id) where local_id is not null do nothing;
  if not found and p_local_id is not null then       -- ganó otra request concurrente
    select id into v_id from movimientos where local_id = p_local_id;
  end if;
  return v_id;
end $$;
grant execute on function registrar_movimiento(text,text,text,text,int,numeric,numeric,text,text,text) to anon, authenticated;

-- ============================================================
-- 3) abrir_operacion — idempotente
-- ============================================================
drop function if exists abrir_operacion(text,text,text,text,text,text,text);
create or replace function abrir_operacion(
    p_bote text, p_capitan text, p_guia text, p_hora text, p_destino text, p_creador text, p_id text default null, p_local_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_id text; v_existing text;
begin
  perform _req_staff();
  if p_local_id is not null then
    select id into v_existing from operaciones where local_id = p_local_id;
    if found then return v_existing; end if;
  end if;
  v_id := coalesce(p_id, gen_id('OP-','seq_op'));
  insert into operaciones(id,fecha,hora_salida,bote_id,capitan_id,guia_id,estado,creado_por,destino,creado_at,local_id)
    values(v_id,(now() at time zone 'America/Lima')::date,p_hora,p_bote,
           nullif(p_capitan,''),nullif(p_guia,''),'Abierta',p_creador,nullif(p_destino,''),now(),p_local_id)
    on conflict (local_id) where local_id is not null do nothing;
  if not found and p_local_id is not null then
    select id into v_id from operaciones where local_id = p_local_id;
  end if;
  return v_id;
end $$;
grant execute on function abrir_operacion(text,text,text,text,text,text,text,text) to anon, authenticated;

-- ============================================================
-- 4) crear_reserva — idempotente
-- ============================================================
drop function if exists crear_reserva(date,text,text,text,int,numeric,text,text);
create or replace function crear_reserva(
    p_fecha date, p_hora text, p_contacto text, p_cliente text, p_pax int, p_monto numeric, p_creador text, p_id text default null, p_local_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_id text; v_existing text;
begin
  perform _req_staff();
  if p_local_id is not null then
    select id into v_existing from reservas where local_id = p_local_id;
    if found then return v_existing; end if;
  end if;
  v_id := coalesce(p_id, gen_id('RES-','seq_res'));
  insert into reservas(id,fecha,hora,contacto_id,cliente,pax,estado,creado_at,creado_por,local_id)
    values(v_id,p_fecha,p_hora,nullif(p_contacto,''),p_cliente,p_pax,'Pendiente',now(),nullif(p_creador,''),p_local_id)
    on conflict (local_id) where local_id is not null do nothing;
  if not found and p_local_id is not null then
    select id into v_id from reservas where local_id = p_local_id;
  end if;
  return v_id;
end $$;
grant execute on function crear_reserva(date,text,text,text,int,numeric,text,text,text) to anon, authenticated;

-- ============================================================
-- 5) asignar_reserva — idempotente
-- ============================================================
drop function if exists asignar_reserva(text,text,text,text,text,int,numeric,numeric,text,text);
create or replace function asignar_reserva(
    p_reserva text, p_op text, p_tipo text, p_contacto text, p_nombre text,
    p_pax int, p_precio numeric, p_monto numeric, p_creador text, p_id text default null, p_local_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_oc int; v_cap int; v_id text; v_existing text;
begin
  perform _req_staff();
  if p_local_id is not null then
    select id into v_existing from movimientos where local_id = p_local_id;
    if found then return v_existing; end if;
  end if;
  perform 1 from operaciones where id=p_op for update;
  select ocupados,capacidad into v_oc,v_cap from _aforo(p_op);
  if v_cap is not null and v_oc + p_pax > v_cap then
    raise exception 'AFORO: solo quedan % cupos', v_cap - v_oc;
  end if;
  update reservas set estado='Asignado' where id=p_reserva;
  v_id := coalesce(p_id, gen_id('MOV-','seq_mov'));
  insert into movimientos(id,operacion_id,tipo,contacto_id,nombre_contacto,cant_pax,precio_unit,monto_total,operador,registrado_at,estado,local_id)
    values(v_id,p_op,case when p_tipo='Aliado' then 'Aliado(PaseIn)' else coalesce(p_tipo,'Agencia') end,
           p_contacto,p_nombre,p_pax,coalesce(p_precio,0),coalesce(p_monto,0),p_creador,now(),'Embarcado',p_local_id)
    on conflict (local_id) where local_id is not null do nothing;
  if not found and p_local_id is not null then
    select id into v_id from movimientos where local_id = p_local_id;
  end if;
  return v_id;
end $$;
grant execute on function asignar_reserva(text,text,text,text,text,int,numeric,numeric,text,text,text) to anon, authenticated;

-- ============================================================
-- 6) registrar_transaccion (caja) — idempotente
-- ============================================================
drop function if exists registrar_transaccion(text,text,text,numeric,text,text,text,text,text,text);
create or replace function registrar_transaccion(
    p_op text, p_contacto text, p_categoria text, p_monto numeric, p_metodo text,
    p_comentarios text, p_foto_url text, p_operador text, p_mov text default null, p_id text default null, p_local_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_id text; v_existing text;
begin
  perform _req_staff();
  if p_local_id is not null then
    select id into v_existing from caja_operador where local_id = p_local_id;
    if found then return v_existing; end if;
  end if;
  v_id := coalesce(p_id, gen_id('TX-','seq_tx'));
  insert into caja_operador(id,operacion_id,contacto_id,categoria,monto,metodo_pago,comentarios,foto_url,operador,ts,movimiento_id,local_id)
    values(v_id,nullif(p_op,''),nullif(p_contacto,''),coalesce(p_categoria,'Cobro'),coalesce(p_monto,0),
           coalesce(p_metodo,'Efectivo'),nullif(p_comentarios,''),nullif(p_foto_url,''),p_operador,now(),nullif(p_mov,''),p_local_id)
    on conflict (local_id) where local_id is not null do nothing;
  if not found and p_local_id is not null then
    select id into v_id from caja_operador where local_id = p_local_id;
  end if;
  return v_id;
end $$;
grant execute on function registrar_transaccion(text,text,text,numeric,text,text,text,text,text,text,text) to anon, authenticated;

-- ============================================================
-- 7) pase_desde_reserva — idempotente
-- ============================================================
drop function if exists pase_desde_reserva(text,text,text,text,int,numeric,numeric,text,text);
create or replace function pase_desde_reserva(
    p_reserva text, p_contacto_orig text, p_nombre_orig text, p_aliado text,
    p_pax int, p_precio numeric, p_monto numeric, p_creador text, p_id text default null, p_local_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_id text; v_existing text;
begin
  perform _req_staff();
  if p_local_id is not null then
    select id into v_existing from movimientos where local_id = p_local_id;
    if found then return v_existing; end if;
  end if;
  update reservas set estado='Pasado' where id=p_reserva;
  v_id := coalesce(p_id, gen_id('MOV-','seq_mov'));
  insert into movimientos(id,operacion_id,tipo,contacto_id,nombre_contacto,cant_pax,precio_unit,monto_total,operador,registrado_at,estado,contacto_pase_id,local_id)
    values(v_id,'PASE_DIRECTO','Aliado(PaseOut)',nullif(p_contacto_orig,''),p_nombre_orig,p_pax,
           coalesce(p_precio,0),coalesce(p_monto,0),p_creador,now(),'Pasado',p_aliado,p_local_id)
    on conflict (local_id) where local_id is not null do nothing;
  if not found and p_local_id is not null then
    select id into v_id from movimientos where local_id = p_local_id;
  end if;
  return v_id;
end $$;
grant execute on function pase_desde_reserva(text,text,text,text,int,numeric,numeric,text,text,text) to anon, authenticated;
