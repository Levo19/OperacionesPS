-- ============================================================
-- OperacionesPS · Facturación electrónica — FUNDACIÓN (Fase 0, sin NubeFact aún)
-- ------------------------------------------------------------
-- Tablas: servicios (catálogo) · clientes (frecuentes) · series (correlativo) ·
--   comprobantes (emitidos) · toggle en app_config (habilitar muelle).
-- RPCs: gestión de servicios, toggle, búsqueda de cliente, y emitir_comprobante
--   en modo STUB (correlativo atómico + idempotencia por local_id + persistencia),
--   para probar todo el flujo SIN emitir real a SUNAT. El POST real a NubeFact se
--   enchufa en Fase 1 (Edge Function o pg_net). Seguro de re-ejecutar.
-- ============================================================
create sequence if not exists seq_svc start 1;
create sequence if not exists seq_cmp start 1;

-- ── catálogo de servicios (Tour Islas Ballestas, etc.) ──
create table if not exists servicios (
  id             text primary key default ('SVC-' || lpad(nextval('seq_svc')::text, 4, '0')),
  nombre         text not null,
  descripcion    text,
  precio_defecto numeric(10,2) default 0,   -- precio CON IGV (lo que se cobra)
  unidad         text default 'NIU',        -- unidad SUNAT (NIU=unidad, ZZ=servicio)
  activo         boolean default true,
  creado_at      timestamptz default now()
);

-- ── clientes frecuentes (turistas / agencias a facturar) ──
-- doc_tipo SUNAT: 6=RUC · 1=DNI · 4=CE · 7=Pasaporte · 0=Sin doc/varios
create table if not exists clientes (
  doc_tipo       text not null,
  doc_numero     text not null,
  nombre         text not null,
  direccion      text,
  email          text,
  telefono       text,
  es_extranjero  boolean default false,
  veces          int default 0,
  creado_at      timestamptz default now(),
  actualizado_at timestamptz default now(),
  primary key (doc_tipo, doc_numero)
);

-- ── series + correlativo ──
create table if not exists series (
  serie       text primary key,   -- 'B001' boleta · 'F001' factura
  tipo        int not null,        -- 1=factura · 2=boleta
  correlativo int not null default 0,
  activa      boolean default true
);
insert into series(serie, tipo, correlativo) values ('B001', 2, 0), ('F001', 1, 0)
  on conflict (serie) do nothing;

-- ── comprobantes emitidos ──
create table if not exists comprobantes (
  id               text primary key default ('CMP-' || lpad(nextval('seq_cmp')::text, 6, '0')),
  tipo             int not null,             -- 1=factura · 2=boleta
  serie            text not null,
  numero           int not null,
  moneda           text default 'PEN',
  cliente_doc_tipo text,
  cliente_doc      text,
  cliente_nombre   text,
  cliente_email    text,
  exonerado        boolean default false,    -- turismo receptivo
  total_gravada    numeric(10,2) default 0,
  total_exonerada  numeric(10,2) default 0,
  total_igv        numeric(10,2) default 0,
  total            numeric(10,2) default 0,
  items            jsonb default '[]'::jsonb,
  estado           text default 'pendiente', -- pendiente/stub/aceptada/rechazada/anulada
  enlace_pdf       text,
  enlace_xml       text,
  qr               text,
  hash             text,
  sunat_descripcion text,
  errores          text,
  local_id         text,                     -- idempotencia (cliente)
  origen           text,                     -- 'panel' | 'muelle'
  operacion_ref    text,                     -- opcional: de qué op/mov salió
  creado_por       text,
  creado_at        timestamptz default now(),
  unique (serie, numero)
);
create unique index if not exists ux_cmp_localid on comprobantes(local_id) where local_id is not null;
create index if not exists ix_cmp_fecha on comprobantes((creado_at at time zone 'America/Lima'));

-- ── toggle: habilitar facturación en el muelle (lo prende el admin desde el panel) ──
alter table app_config add column if not exists facturacion_muelle boolean default false;

-- ============================================================
-- RPCs
-- ============================================================
-- catálogo: listar (staff) / gestionar (admin)
create or replace function listar_servicios()
  returns jsonb language sql stable security definer set search_path=public, auth as
$$ select coalesce(jsonb_agg(jsonb_build_object('id',id,'nombre',nombre,'descripcion',coalesce(descripcion,''),
     'precio',precio_defecto,'unidad',unidad) order by nombre) filter (where activo), '[]'::jsonb) from servicios $$;
grant execute on function listar_servicios() to anon, authenticated;

create or replace function admin_set_servicio(p_id text, p_nombre text, p_desc text, p_precio numeric, p_unidad text default 'NIU', p_activo boolean default true)
  returns text language plpgsql security definer set search_path=public, auth as
$$
declare v_id text;
begin
  perform _req_admin();
  if coalesce(p_id,'') = '' then
    insert into servicios(nombre,descripcion,precio_defecto,unidad,activo)
      values(p_nombre, nullif(p_desc,''), coalesce(p_precio,0), coalesce(nullif(p_unidad,''),'NIU'), coalesce(p_activo,true))
      returning id into v_id;
  else
    update servicios set nombre=p_nombre, descripcion=nullif(p_desc,''), precio_defecto=coalesce(p_precio,0),
      unidad=coalesce(nullif(p_unidad,''),'NIU'), activo=coalesce(p_activo,true) where id=p_id returning id into v_id;
    if not found then raise exception 'NO_EXISTE: servicio %', p_id; end if;
  end if;
  return v_id;
end $$;
grant execute on function admin_set_servicio(text,text,text,numeric,text,boolean) to authenticated;

create or replace function admin_eliminar_servicio(p_id text)
  returns void language plpgsql security definer set search_path=public, auth as
$$ begin perform _req_admin(); update servicios set activo=false where id=p_id; end $$;
grant execute on function admin_eliminar_servicio(text) to authenticated;

-- toggle muelle
create or replace function admin_set_facturacion_muelle(p_on boolean)
  returns boolean language plpgsql security definer set search_path=public, auth as
$$ begin perform _req_admin();
   insert into app_config(app_id, nombre, facturacion_muelle) values('operacionesps','OperacionesPS',coalesce(p_on,false))
   on conflict (app_id) do update set facturacion_muelle = coalesce(p_on,false);
   return coalesce(p_on,false); end $$;
grant execute on function admin_set_facturacion_muelle(boolean) to authenticated;

create or replace function get_facturacion_muelle()
  returns boolean language sql stable security definer set search_path=public, auth as
$$ select coalesce((select facturacion_muelle from app_config where app_id='operacionesps'), false) $$;
grant execute on function get_facturacion_muelle() to anon, authenticated;

-- buscar cliente frecuente por documento
create or replace function buscar_cliente(p_doc_tipo text, p_doc text)
  returns jsonb language sql stable security definer set search_path=public, auth as
$$ select coalesce((select to_jsonb(c) from clientes c where c.doc_tipo=p_doc_tipo and c.doc_numero=p_doc), 'null'::jsonb) $$;
grant execute on function buscar_cliente(text,text) to authenticated;

-- listar comprobantes (panel admin)
create or replace function listar_comprobantes(p_desde date default null, p_hasta date default null)
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$
declare v jsonb;
begin
  perform _req_staff();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.creado_at desc), '[]'::jsonb) into v
  from (select id,tipo,serie,numero,cliente_nombre,cliente_doc,total,estado,enlace_pdf,
          to_char(creado_at at time zone 'America/Lima','YYYY-MM-DD HH24:MI') creado, creado_por, creado_at
        from comprobantes
        where (p_desde is null or (creado_at at time zone 'America/Lima')::date >= p_desde)
          and (p_hasta is null or (creado_at at time zone 'America/Lima')::date <= p_hasta)) x;
  return v;
end $$;
grant execute on function listar_comprobantes(date,date) to authenticated;

-- ── EMITIR (Fase 0 = STUB): correlativo atómico + idempotencia + persistencia ──
-- p_items: jsonb [{descripcion, cantidad, precio}]  (precio = precio_unitario CON IGV)
create or replace function emitir_comprobante(
    p_tipo int, p_serie text,
    p_cliente_doc_tipo text, p_cliente_doc text, p_cliente_nombre text, p_cliente_email text,
    p_items jsonb, p_exonerado boolean default false, p_moneda text default 'PEN',
    p_origen text default 'panel', p_operacion_ref text default null,
    p_creado_por text default null, p_local_id text default null,
    p_cliente_tel text default null, p_cliente_dir text default null, p_es_extranjero boolean default false)
  returns jsonb language plpgsql security definer set search_path=public, auth as
$$
declare v_num int; v_id text; v_existing comprobantes; v_total numeric; v_grav numeric; v_igv numeric; v_exo numeric;
begin
  perform _req_staff();
  -- muelle: requiere toggle ON
  if p_origen = 'muelle' and not coalesce((select facturacion_muelle from app_config where app_id='operacionesps'), false) then
    raise exception 'FACTURACION_OFF: el admin no habilitó la facturación en el muelle';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS: se requiere al menos un servicio';
  end if;

  -- serializa por serie (correlativo sin huecos/duplicados) + chequea idempotencia dentro del lock
  perform 1 from series where serie = p_serie for update;
  if not found then raise exception 'SERIE: % no existe', p_serie; end if;
  if p_local_id is not null then
    select * into v_existing from comprobantes where local_id = p_local_id;
    if found then
      return jsonb_build_object('id',v_existing.id,'serie',v_existing.serie,'numero',v_existing.numero,
        'estado',v_existing.estado,'total',v_existing.total,'pdf',v_existing.enlace_pdf,'qr',v_existing.qr,'reusado',true);
    end if;
  end if;

  -- totales (nivel total; el desglose por ítem fino va en Fase 1 contra NubeFact)
  select coalesce(sum((i->>'cantidad')::numeric * (i->>'precio')::numeric), 0) into v_total from jsonb_array_elements(p_items) i;
  if p_exonerado then v_exo := v_total; v_grav := 0; v_igv := 0;
  else v_grav := round(v_total / 1.18, 2); v_igv := round(v_total - round(v_total / 1.18, 2), 2); v_exo := 0; end if;

  select correlativo + 1 into v_num from series where serie = p_serie;
  update series set correlativo = v_num where serie = p_serie;

  insert into comprobantes(tipo,serie,numero,moneda,cliente_doc_tipo,cliente_doc,cliente_nombre,cliente_email,
      exonerado,total_gravada,total_exonerada,total_igv,total,items,estado,enlace_pdf,qr,local_id,origen,operacion_ref,creado_por)
    values(p_tipo,p_serie,v_num,coalesce(p_moneda,'PEN'),nullif(p_cliente_doc_tipo,''),nullif(p_cliente_doc,''),
      p_cliente_nombre,nullif(p_cliente_email,''),coalesce(p_exonerado,false),v_grav,v_exo,v_igv,v_total,p_items,
      'stub','(demo) PDF pendiente NubeFact','(demo)',p_local_id,coalesce(p_origen,'panel'),nullif(p_operacion_ref,''),p_creado_por)
    returning id into v_id;

  -- cliente frecuente (no guardar 'varios')
  if coalesce(p_cliente_doc,'') <> '' and coalesce(p_cliente_doc_tipo,'0') <> '0' then
    insert into clientes(doc_tipo,doc_numero,nombre,direccion,email,telefono,es_extranjero,veces)
      values(p_cliente_doc_tipo,p_cliente_doc,p_cliente_nombre,nullif(p_cliente_dir,''),nullif(p_cliente_email,''),nullif(p_cliente_tel,''),coalesce(p_es_extranjero,false),1)
    on conflict (doc_tipo,doc_numero) do update set nombre=excluded.nombre,
      direccion=coalesce(excluded.direccion,clientes.direccion), email=coalesce(excluded.email,clientes.email),
      telefono=coalesce(excluded.telefono,clientes.telefono), es_extranjero=excluded.es_extranjero,
      veces=clientes.veces+1, actualizado_at=now();
  end if;

  return jsonb_build_object('id',v_id,'serie',p_serie,'numero',v_num,'estado','stub',
    'total',v_total,'gravada',v_grav,'igv',v_igv,'pdf','(demo) PDF pendiente NubeFact','qr','(demo)');
end $$;
grant execute on function emitir_comprobante(int,text,text,text,text,text,jsonb,boolean,text,text,text,text,text,text,text,boolean) to authenticated;
