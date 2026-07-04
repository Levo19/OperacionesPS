-- ============================================================
-- OperacionesPS · Facturación — MÓDULO Tributación (Régimen General, turismo)
-- ------------------------------------------------------------
-- Aplicar DESPUÉS de facturacion_modulos.sql. Idempotente / seguro de re-ejecutar.
-- Extiende (NO duplica) la tabla `compras`, la RPC `registrar_compra(p jsonb)`
-- y la RPC `balance_tributos(p_periodo)` ya existentes en facturacion_modulos.sql.
--
-- NOTA TRIBUTARIA (empresa de turismo, Régimen General):
--   · El turismo RECEPTIVO (exportación de servicios) va con IGV 0% (total_exportacion),
--     pero SÍ está afecto al Impuesto a la Renta: la exportación es INGRESO gravado
--     para renta aunque no genere débito de IGV.
--   · Pago a cuenta mensual: 1.5% de los ingresos netos (método del porcentaje).
--     Si la empresa arrastra coeficiente, el % puede diferir. [CONFIRMAR con el contador]
--   · Regularización anual Régimen General: 29.5% sobre la utilidad. [CONFIRMAR]
--   · Estos porcentajes son parámetros por defecto; el contador debe validarlos.
-- ============================================================

-- ── 1 · Storage: bucket PRIVADO para fotos de comprobantes de compra ──────────
-- (privado: las facturas de proveedor no deben ser públicas como las fotos de op.)
insert into storage.buckets (id, name, public)
  values ('compras-fotos','compras-fotos', false)
  on conflict (id) do nothing;

-- Políticas RLS en storage.objects (patrón espejo de op_storage_* en infra.sql,
-- pero el bucket es privado → la LECTURA también se restringe a staff autenticado).
drop policy if exists compras_storage_write on storage.objects;
create policy compras_storage_write on storage.objects for insert to authenticated
  with check (bucket_id = 'compras-fotos' and es_staff());

drop policy if exists compras_storage_read on storage.objects;
create policy compras_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'compras-fotos' and es_staff());

-- ── 2 · compras: columna foto_path (ruta interna en Storage) ──────────────────
-- foto_url ya existe (URL/enlace); foto_path guarda la ruta del objeto en el bucket
-- privado (necesaria para generar signed URLs bajo demanda).
alter table compras add column if not exists foto_path text;

-- registrar_compra: recreada preservando firma (p jsonb) y toda la lógica previa,
-- añadiendo persistencia de foto_path (además del foto_url ya soportado).
create or replace function registrar_compra(p jsonb)
  returns jsonb language plpgsql security definer set search_path=public, auth as
$$ declare v_id text; v_per text; begin
  perform _req_staff();
  v_per := coalesce(nullif(p->>'periodo',''), to_char((now() at time zone 'America/Lima')::date,'YYYY-MM'));
  insert into compras(ruc_proveedor,razon_social,tipo_doc,serie,numero,fecha,base,igv,total,foto_url,foto_path,periodo,creado_por)
    values(nullif(p->>'ruc_proveedor',''), nullif(p->>'razon_social',''), nullif(p->>'tipo_doc',''),
      nullif(p->>'serie',''), nullif(p->>'numero',''), nullif(p->>'fecha','')::date,
      coalesce((p->>'base')::numeric,0), coalesce((p->>'igv')::numeric,0), coalesce((p->>'total')::numeric,0),
      nullif(p->>'foto_url',''), nullif(p->>'foto_path',''), v_per, nullif(p->>'creado_por',''))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'periodo', v_per);
end $$;
grant execute on function registrar_compra(jsonb) to authenticated;

-- ── 3 · balance_tributos: IGV (preservado) + RENTA pago a cuenta mensual ──────
-- Preserva íntegra la lógica IGV existente (débito/crédito/por_pagar/saldo_a_favor).
-- Agrega el bloque de Renta (ingresos netos, gastos, pago a cuenta 1.5%, total mes).
create or replace function balance_tributos(p_periodo text default null)
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$ declare
     per text;
     v_debito numeric; v_credito numeric; v_export numeric; v_grav numeric;
     v_ingresos numeric; v_gastos numeric; v_igv_por_pagar numeric; v_renta_pc numeric;
begin
  perform _req_admin();
  per := coalesce(nullif(p_periodo,''), to_char((now() at time zone 'America/Lima')::date,'YYYY-MM'));

  -- IGV — débito = IGV de ventas aceptadas/pendientes (excluye anuladas/rechazadas).
  -- 'pendiente' se incluye como estimación del período en curso.
  select coalesce(sum(total_igv),0), coalesce(sum(total_gravada),0), coalesce(sum(total_exportacion),0)
    into v_debito, v_grav, v_export
    from comprobantes
    where estado in ('aceptada','pendiente')
      and to_char(creado_at at time zone 'America/Lima','YYYY-MM') = per;
  select coalesce(sum(igv),0) into v_credito from compras where periodo = per;
  v_igv_por_pagar := greatest(v_debito - v_credito, 0);

  -- RENTA — ingresos netos del mes = base gravada + exportación (turismo receptivo
  -- 0% IGV pero SÍ afecto a renta). Gastos deducibles = base (sin IGV) de compras.
  v_ingresos := v_grav + v_export;
  select coalesce(sum(base),0) into v_gastos from compras where periodo = per;
  -- Pago a cuenta mensual: 1.5% de ingresos netos [CONFIRMAR % con contador].
  v_renta_pc := round(v_ingresos * 0.015, 2);

  return jsonb_build_object(
    'periodo', per,
    -- ── IGV (lógica existente, intacta) ──
    'igv_debito', v_debito,               -- IGV de ventas
    'igv_credito', v_credito,             -- IGV de compras
    'igv_por_pagar', v_igv_por_pagar,
    'saldo_a_favor', greatest(v_credito - v_debito, 0),   -- crédito arrastrable si compras > ventas
    'base_gravada', v_grav,
    'total_exportacion', v_export,        -- ventas 0% (referencia para Saldo a Favor Exportador)
    'cobertura_pct', case when v_debito > 0 then round(least(v_credito / v_debito, 1) * 100) else 0 end,
    -- ── RENTA (nuevo) ──
    'ingresos_netos', v_ingresos,         -- base gravada + exportación
    'gastos_deducibles', v_gastos,        -- base (sin IGV) de compras del período
    'renta_pago_cuenta', v_renta_pc,      -- 1.5% pago a cuenta mensual [CONFIRMAR]
    'total_a_pagar_mes', round(v_igv_por_pagar + v_renta_pc, 2)  -- IGV + Renta del mes
  );
end $$;
grant execute on function balance_tributos(text) to authenticated;

-- ── 3b · listar_compras: lista del período (RPC porque `compras` tiene RLS deny-all) ──
create or replace function listar_compras(p_periodo text default null)
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$ declare v jsonb; per text; begin
  perform _req_admin();
  per := coalesce(nullif(p_periodo,''), to_char((now() at time zone 'America/Lima')::date,'YYYY-MM'));
  select coalesce(jsonb_agg(to_jsonb(x) order by x.fecha desc nulls last, x.creado_at desc), '[]'::jsonb) into v from (
    select id, ruc_proveedor, razon_social, tipo_doc, serie, numero, fecha, base, igv, total, foto_path, periodo, creado_at
    from compras where periodo = per
  ) x;
  return v;
end $$;
grant execute on function listar_compras(text) to authenticated;

-- ── 4 · proyeccion_renta: proyección ANUAL de Impuesto a la Renta ─────────────
-- Régimen General: 29.5% sobre utilidad, menos los adelantos (pagos a cuenta).
create or replace function proyeccion_renta(p_anio int default null)
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$ declare
     v_anio int;
     v_ingresos numeric; v_gastos numeric; v_utilidad numeric;
     v_renta numeric; v_adelantos numeric; v_por_regularizar numeric;
begin
  perform _req_admin();
  v_anio := coalesce(p_anio, extract(year from (now() at time zone 'America/Lima'))::int);

  -- Ingresos anuales = base gravada + exportación de ventas aceptadas/pendientes del año.
  select coalesce(sum(total_gravada + total_exportacion),0) into v_ingresos
    from comprobantes
    where estado in ('aceptada','pendiente')
      and to_char(creado_at at time zone 'America/Lima','YYYY') = v_anio::text;

  -- Gastos anuales = base (sin IGV) de compras del año.
  select coalesce(sum(base),0) into v_gastos
    from compras
    where left(periodo,4) = v_anio::text;

  v_utilidad := greatest(v_ingresos - v_gastos, 0);
  v_renta    := round(v_utilidad * 0.295, 2);           -- 29.5% Régimen General [CONFIRMAR]
  v_adelantos := round(v_ingresos * 0.015, 2);          -- Σ pagos a cuenta ≈ 1.5% de ingresos [CONFIRMAR]
  v_por_regularizar := greatest(v_renta - v_adelantos, 0);

  return jsonb_build_object(
    'anio', v_anio,
    'ingresos_anual', v_ingresos,
    'gastos_anual', v_gastos,
    'utilidad', v_utilidad,
    'renta_anual', v_renta,                 -- 29.5% de la utilidad
    'adelantos', v_adelantos,               -- pagos a cuenta acumulados (aprox 1.5%)
    'renta_por_regularizar', v_por_regularizar
  );
end $$;
grant execute on function proyeccion_renta(int) to authenticated;
