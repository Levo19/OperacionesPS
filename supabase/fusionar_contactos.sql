-- ============================================================
-- admin_fusionar_contactos(origen, destino) — 2026-07-11.
-- Reutilizable: cuando dos contactos son el MISMO pero se registraron por separado.
-- Repunta TODAS las referencias (movimientos contacto/pase/compra + caja) del origen al
-- destino y borra el origen. Money-safe: no cambia montos, solo reatribuye al sobreviviente.
-- Mismo patrón de repunte que el dedup (contactos_dedup_unique.sql), formalizado como RPC.
-- JADE puede proponerlo (con confirmación del admin).
-- ============================================================
create or replace function admin_fusionar_contactos(p_origen text, p_destino text)
  returns jsonb language plpgsql security definer set search_path to 'public','auth' as
$$
declare o record; d record; v_mc int; v_mp int; v_ma int; v_kc int;
begin
  perform _req_admin();
  if p_origen = p_destino then raise exception 'IGUALES: origen y destino son el mismo contacto'; end if;
  if p_origen = 'CON-00' or p_destino = 'CON-00' then raise exception 'VARIOS_PROTEGIDO: el contacto VARIOS (CON-00) no se fusiona'; end if;
  select id, nombre, tipo into o from contactos where id = p_origen;
  if not found then raise exception 'NO_EXISTE: origen %', p_origen; end if;
  select id, nombre, tipo into d from contactos where id = p_destino;
  if not found then raise exception 'NO_EXISTE: destino %', p_destino; end if;
  if o.tipo <> d.tipo then
    raise exception 'TIPO_DISTINTO: % es % y % es % — solo se fusionan contactos del MISMO tipo', o.nombre, o.tipo, d.nombre, d.tipo;
  end if;

  -- repunte de referencias origen -> destino
  update movimientos   set contacto_id        = p_destino where contacto_id        = p_origen;  get diagnostics v_mc = row_count;
  update movimientos   set contacto_pase_id    = p_destino where contacto_pase_id    = p_origen;  get diagnostics v_mp = row_count;
  update movimientos   set agencia_comprada_id = p_destino where agencia_comprada_id = p_origen;  get diagnostics v_ma = row_count;
  update caja_operador set contacto_id        = p_destino where contacto_id        = p_origen;  get diagnostics v_kc = row_count;
  delete from contactos where id = p_origen;

  return jsonb_build_object('ok', true, 'origen', o.nombre, 'destino', d.nombre,
    'movimientos_reatribuidos', v_mc, 'pases_reatribuidos', v_mp, 'compras_reatribuidas', v_ma, 'cobros_reatribuidos', v_kc);
end $$;
grant execute on function admin_fusionar_contactos(text,text) to authenticated;
