-- ============================================================
-- OperacionesPS · abrir_operacion acepta fecha (admin crea ops para cualquier día)
-- ------------------------------------------------------------
-- Antes: fecha = hoy Lima SIEMPRE (el panel no podía crear ops en otra fecha).
-- Ahora: p_fecha (default null → hoy Lima). El muelle no lo pasa → sigue creando
-- para hoy. Mantiene idempotencia por local_id. Deja UNA sola firma (drop de las
-- viejas) para que PostgREST no quede ambiguo. Seguro de re-ejecutar.
-- ============================================================
drop function if exists abrir_operacion(text,text,text,text,text,text,text);          -- 7-arg (baseline)
drop function if exists abrir_operacion(text,text,text,text,text,text,text,text);     -- 8-arg (idempotencia)

create or replace function abrir_operacion(
    p_bote text, p_capitan text, p_guia text, p_hora text, p_destino text, p_creador text,
    p_id text default null, p_local_id text default null, p_fecha date default null)
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
    values(v_id, coalesce(p_fecha, (now() at time zone 'America/Lima')::date), p_hora, p_bote,
           nullif(p_capitan,''), nullif(p_guia,''), 'Abierta', p_creador, nullif(p_destino,''), now(), p_local_id)
    on conflict (local_id) where local_id is not null do nothing;
  if not found and p_local_id is not null then
    select id into v_id from operaciones where local_id = p_local_id;
  end if;
  return v_id;
end $$;
grant execute on function abrir_operacion(text,text,text,text,text,text,text,text,date) to anon, authenticated;
