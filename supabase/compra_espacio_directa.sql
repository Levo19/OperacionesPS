-- ============================================================
-- Compra de espacio DIRECTA (2026-07-31) — pedido Luis (PS Panel)
-- El admin registra el estado FINAL en un paso, sin pasar por el aliado:
--   ORIGEN nos dio pax (nos debe monto_cobro) → compramos espacio a una
--   AGENCIA (le debemos monto_compra). Un solo movimiento con ambas patas:
--   contacto_id=origen + agencia_comprada_id/monto_comprado. Sin aliado
--   (contacto_pase_id NULL) — el rastro del aliado solo existe cuando el
--   flujo real pasó por él (convertir_pase_compra lo conserva).
-- Aparece en: panel (v_pases: operacion_id=PASE_DIRECTO), OPS (get_dashboard
-- filtra contacto_pase_id<>'' OR agencia_comprada_id<>''), y balances
-- (v_balance_agencias suma monto_comprado como deuda nuestra; el origen
-- agencia acumula su cargo por monto_total).
-- ============================================================

create or replace function registrar_compra_espacio(
    p_contacto text, p_nombre text, p_agencia text, p_pax int, p_monto_compra numeric,
    p_monto_cobro numeric default null, p_operador text default null,
    p_fecha date default null, p_local_id text default null)
  returns text language plpgsql security definer set search_path=public as
$$
declare v_id text; v_existing text; v_hoy date; v_ts timestamptz; v_monto numeric; v_precio numeric;
begin
  perform _req_staff();
  if coalesce(p_agencia,'') = '' then raise exception 'AGENCIA_REQUERIDA: elige la agencia a la que compras el espacio'; end if;
  if not exists (select 1 from contactos where id=p_agencia and lower(tipo)='agencia') then
    raise exception 'NO_ES_AGENCIA: el espacio solo se compra a una agencia';
  end if;
  if coalesce(p_pax,0) < 1 then raise exception 'PAX_INVALIDO: minimo 1 pasajero'; end if;
  if coalesce(p_monto_compra,0) <= 0 then raise exception 'MONTO_COMPRA: requerido > 0'; end if;
  -- la agencia de origen no puede ser la misma a la que compras (asiento circular)
  if coalesce(p_contacto,'') = p_agencia then
    raise exception 'ORIGEN_ES_AGENCIA_FINAL: el origen y la agencia final no pueden ser el mismo contacto';
  end if;
  v_hoy := (now() at time zone 'America/Lima')::date;
  if p_fecha is not null and p_fecha <> v_hoy and not es_admin() then
    raise exception 'RETROACTIVO_SOLO_ADMIN: solo el administrador registra compras de otra fecha';
  end if;
  v_ts := case when p_fecha is null or p_fecha = v_hoy then now()
               else (p_fecha::timestamp + interval '12 hours') at time zone 'America/Lima' end;
  if p_local_id is not null then
    select id into v_existing from movimientos where local_id = p_local_id;
    if found then return v_existing; end if;
  end if;
  -- cargo del origen: monto explícito si vino (>0); si no, agencia origen → precio_defecto×pax; resto 0
  v_monto  := _cargo_origen(nullif(p_contacto,''), p_pax, coalesce(p_monto_cobro,0));
  v_precio := case when coalesce(p_pax,0)>0 then round(v_monto/p_pax,2) else 0 end;
  v_id := gen_id('MOV-','seq_mov');
  insert into movimientos(id,operacion_id,tipo,contacto_id,nombre_contacto,cant_pax,precio_unit,monto_total,
                          operador,registrado_at,estado,contacto_pase_id,agencia_comprada_id,monto_comprado,local_id)
    values(v_id,'PASE_DIRECTO','Aliado(PaseOut)',nullif(p_contacto,''),nullif(p_nombre,''),p_pax,v_precio,v_monto,
           coalesce(p_operador,'Panel'),v_ts,'Pasado',null,p_agencia,p_monto_compra,p_local_id)
    on conflict (local_id) where local_id is not null do nothing;
  if not found and p_local_id is not null then
    select id into v_id from movimientos where local_id = p_local_id;
  end if;
  return v_id;
end $$;
grant execute on function registrar_compra_espacio(text,text,text,int,numeric,numeric,text,date,text) to authenticated;
