-- ============================================================
-- OperacionesPS · Facturación — MÓDULOS: Zarpe digitalizado (M3) + Tributario (M6)
-- ------------------------------------------------------------
-- M3: tabla zarpe_pax (pasajeros digitalizados del zarpe + su CPE) + conciliación.
-- M6: tabla compras (facturas de compra → crédito IGV) + balance de tributos.
-- RLS deny-all en ambas (acceso solo por RPC security-definer). Seguro de re-ejecutar.
-- ============================================================
create sequence if not exists seq_zpx start 1;
create sequence if not exists seq_compra start 1;

-- ── M3 · Zarpe digitalizado ───────────────────────────────────────────────────
create table if not exists zarpe_pax (
  id            text primary key default ('ZPX-'||lpad(nextval('seq_zpx')::text,6,'0')),
  id_operacion  text,
  documento     text,
  tipo_doc      text,                  -- 1=DNI 4=CE 7=Pasaporte 6=RUC 0=varios
  nombre        text,
  empresa       text,                  -- B2B: razón social de la agencia; null = suelto/libre
  id_comprobante text references comprobantes(id),
  estado        text default 'pendiente',  -- pendiente | facturado
  creado_at     timestamptz default now(),
  creado_por    text
);
create index if not exists ix_zpx_op on zarpe_pax(id_operacion);
-- unique por operación+documento (evita duplicar PAX en reintentos/re-subida de foto); los 'varios' sin doc no chocan
create unique index if not exists ux_zpx_op_doc on zarpe_pax(id_operacion, documento) where documento is not null;
alter table zarpe_pax enable row level security;

-- registrar los pasajeros extraídos por la IA (upsert por operación+documento; no pisa si ya facturado)
create or replace function registrar_zarpe_pax(p_operacion text, p_pax jsonb, p_por text default null)
  returns jsonb language plpgsql security definer set search_path=public, auth as
$$ declare v int := 0; r jsonb;
begin
  perform _req_staff();
  if jsonb_typeof(p_pax) <> 'array' then raise exception 'PAX: se requiere un array'; end if;
  for r in select * from jsonb_array_elements(p_pax) loop
    insert into zarpe_pax(id_operacion, documento, tipo_doc, nombre, empresa, creado_por)
      values(p_operacion, nullif(r->>'documento',''), nullif(r->>'tipo_doc',''), r->>'nombre', nullif(r->>'empresa',''), p_por)
    on conflict (id_operacion, documento) where documento is not null
      do update set nombre=excluded.nombre, empresa=excluded.empresa, tipo_doc=excluded.tipo_doc
      where zarpe_pax.estado <> 'facturado';   -- no pisa a los ya facturados
    v := v + 1;
  end loop;
  return jsonb_build_object('ok', true, 'insertados', v);
end $$;
grant execute on function registrar_zarpe_pax(text,jsonb,text) to authenticated;

-- ligar un pasajero a su comprobante emitido
create or replace function marcar_zarpe_pax_facturado(p_id text, p_id_comprobante text)
  returns void language plpgsql security definer set search_path=public, auth as
$$ begin perform _req_staff();
   update zarpe_pax set id_comprobante=p_id_comprobante, estado='facturado' where id=p_id;
   if not found then raise exception 'NO_EXISTE: zarpe_pax %', p_id; end if; end $$;
grant execute on function marcar_zarpe_pax_facturado(text,text) to authenticated;

create or replace function listar_zarpe_pax(p_operacion text)
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$ declare v jsonb; begin perform _req_staff();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.creado_at), '[]'::jsonb) into v from (
    select z.id, z.documento, z.tipo_doc, z.nombre, z.empresa, z.estado, z.id_comprobante, z.creado_at,
           c.serie, c.numero, c.estado est_cpe, c.enlace_pdf
    from zarpe_pax z left join comprobantes c on c.id = z.id_comprobante
    where z.id_operacion = p_operacion) x;
  return v; end $$;
grant execute on function listar_zarpe_pax(text) to authenticated;

-- ── M5 · Conciliación zarpe ↔ CPE (por día) ───────────────────────────────────
create or replace function conciliacion_zarpe(p_fecha date default null)
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$ declare v jsonb; f date; begin
  perform _req_staff();
  f := coalesce(p_fecha, (now() at time zone 'America/Lima')::date);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id_operacion), '[]'::jsonb) into v from (
    select o.id id_operacion, o.hora_salida, o.bote_id,
      (select count(*) from zarpe_pax z where z.id_operacion=o.id) pax_zarpe,
      (select count(*) from zarpe_pax z where z.id_operacion=o.id and z.estado='facturado') pax_facturado,
      -- monto: sumar cada comprobante UNA vez (una factura B2B cubre varios pax → no multiplicar)
      (select coalesce(sum(c.total),0) from comprobantes c
         where c.id in (select distinct z.id_comprobante from zarpe_pax z
                        where z.id_operacion=o.id and z.id_comprobante is not null)) monto
    from operaciones o
    where o.fecha = f) x;
  return v; end $$;
grant execute on function conciliacion_zarpe(date) to authenticated;

-- ── M6 · Compras (crédito IGV) + Balance de tributos ─────────────────────────
create table if not exists compras (
  id           text primary key default ('CMP-C'||lpad(nextval('seq_compra')::text,6,'0')),
  ruc_proveedor text, razon_social text,
  tipo_doc     text, serie text, numero text, fecha date,
  base         numeric(12,2) default 0,
  igv          numeric(12,2) default 0,
  total        numeric(12,2) default 0,
  foto_url     text,
  periodo      text,               -- 'YYYY-MM' (TZ Lima)
  creado_at    timestamptz default now(), creado_por text
);
create index if not exists ix_compras_periodo on compras(periodo);
alter table compras enable row level security;

create or replace function registrar_compra(p jsonb)
  returns jsonb language plpgsql security definer set search_path=public, auth as
$$ declare v_id text; v_per text; begin
  perform _req_staff();
  v_per := coalesce(nullif(p->>'periodo',''), to_char((now() at time zone 'America/Lima')::date,'YYYY-MM'));
  insert into compras(ruc_proveedor,razon_social,tipo_doc,serie,numero,fecha,base,igv,total,foto_url,periodo,creado_por)
    values(nullif(p->>'ruc_proveedor',''), nullif(p->>'razon_social',''), nullif(p->>'tipo_doc',''),
      nullif(p->>'serie',''), nullif(p->>'numero',''), nullif(p->>'fecha','')::date,
      coalesce((p->>'base')::numeric,0), coalesce((p->>'igv')::numeric,0), coalesce((p->>'total')::numeric,0),
      nullif(p->>'foto_url',''), v_per, nullif(p->>'creado_por',''))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'periodo', v_per);
end $$;
grant execute on function registrar_compra(jsonb) to authenticated;

-- balance de tributos del período (débito ventas vs crédito compras + exportación)
create or replace function balance_tributos(p_periodo text default null)
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$ declare per text; v_debito numeric; v_credito numeric; v_export numeric; v_grav numeric; begin
  perform _req_admin();
  per := coalesce(nullif(p_periodo,''), to_char((now() at time zone 'America/Lima')::date,'YYYY-MM'));
  -- débito = IGV de ventas aceptadas (excluye anuladas y stub). Nota: 'pendiente' se incluye como estimación.
  select coalesce(sum(total_igv),0), coalesce(sum(total_gravada),0), coalesce(sum(total_exportacion),0)
    into v_debito, v_grav, v_export
    from comprobantes
    where estado in ('aceptada','pendiente')
      and to_char(creado_at at time zone 'America/Lima','YYYY-MM') = per;
  select coalesce(sum(igv),0) into v_credito from compras where periodo = per;
  -- (marcador) el bloque de armado del jsonb continúa abajo
  return jsonb_build_object(
    'periodo', per,
    'igv_debito', v_debito,               -- IGV de ventas
    'igv_credito', v_credito,             -- IGV de compras
    'igv_por_pagar', greatest(v_debito - v_credito, 0),
    'saldo_a_favor', greatest(v_credito - v_debito, 0),   -- crédito arrastrable si compras > ventas
    'base_gravada', v_grav,
    'total_exportacion', v_export,        -- ventas 0% (referencia para Saldo a Favor Exportador)
    'cobertura_pct', case when v_debito > 0 then round(least(v_credito / v_debito, 1) * 100) else 0 end
  );
end $$;
grant execute on function balance_tributos(text) to authenticated;

-- ── P2-6 · admin_alinear_correlativo con guarda MONOTÓNICA (no bajar bajo lo ya emitido) ──
create or replace function admin_alinear_correlativo(p_serie text, p_numero int)
  returns int language plpgsql security definer set search_path=public, auth as
$$ declare v_actual int; v int; begin
  perform _req_admin();
  if coalesce(p_numero,-1) < 0 then raise exception 'NUMERO: debe ser >= 0'; end if;
  select correlativo into v_actual from series where serie = p_serie;
  if v_actual is null then raise exception 'SERIE: % no existe', p_serie; end if;
  if p_numero < v_actual then
    raise exception 'CORRELATIVO_NO_RETROCEDE: % < actual % (bajarlo colisionaría con números ya emitidos)', p_numero, v_actual;
  end if;
  update series set correlativo = p_numero where serie = p_serie returning correlativo into v;
  return v;
end $$;
grant execute on function admin_alinear_correlativo(text,int) to authenticated;
