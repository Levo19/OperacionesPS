-- ============================================================
-- OperacionesPS · Facturación FASE 1 — circuito REAL (NubeFact) con stub fallback
-- ------------------------------------------------------------
-- Habilita HTTP en Postgres, tabla de config (donde van los tokens AL FINAL),
-- y enchufa la llamada real a NubeFact + lookup RUC/DNI + anulación. Mientras la
-- config esté vacía/inactiva, emitir_comprobante sigue en modo STUB (no rompe).
-- Cuando el admin pegue RUTA+TOKEN (admin_set_facturacion_config), pasa a REAL.
-- ⚠️ El JSON/headers exactos de NubeFact se validan en la activación con el token demo.
-- Seguro de re-ejecutar.
-- ============================================================
create extension if not exists http with schema extensions;

-- ── config (1 fila): RUTA/TOKEN NubeFact + API de consulta. RLS denegada; solo por RPCs. ──
create table if not exists facturacion_config (
  id            int primary key default 1,
  nubefact_ruta  text,
  nubefact_token text,
  lookup_url     text,     -- p.ej. https://api.apis.net.pe/v2/sunat/ruc?numero=
  lookup_token   text,
  modo           text default 'demo',   -- 'demo' | 'produccion'
  activo         boolean default false, -- false = STUB; true = llama a NubeFact real
  actualizado_at timestamptz default now(),
  check (id = 1)
);
insert into facturacion_config(id) values (1) on conflict (id) do nothing;
alter table facturacion_config enable row level security;  -- sin policies → nadie lee directo; solo RPCs security definer

create or replace function admin_set_facturacion_config(p_ruta text, p_token text, p_lookup_url text, p_lookup_token text, p_modo text, p_activo boolean)
  returns void language plpgsql security definer set search_path=public, auth as
$$ begin perform _req_admin();
  update facturacion_config set
    nubefact_ruta = coalesce(nullif(p_ruta,''), nubefact_ruta),
    nubefact_token = coalesce(nullif(p_token,''), nubefact_token),
    lookup_url = coalesce(nullif(p_lookup_url,''), lookup_url),
    lookup_token = coalesce(nullif(p_lookup_token,''), lookup_token),
    modo = coalesce(nullif(p_modo,''), modo),
    activo = coalesce(p_activo, activo),
    actualizado_at = now()
  where id = 1;
end $$;
grant execute on function admin_set_facturacion_config(text,text,text,text,text,boolean) to authenticated;

-- estado de la config (sin exponer tokens) para la UI
create or replace function get_facturacion_config()
  returns jsonb language sql stable security definer set search_path=public, auth as
$$ select jsonb_build_object(
     'tiene_nubefact', coalesce(nubefact_ruta,'') <> '' and coalesce(nubefact_token,'') <> '',
     'tiene_lookup', coalesce(lookup_url,'') <> '' and coalesce(lookup_token,'') <> '',
     'modo', modo, 'activo', activo) from facturacion_config where id=1 $$;
grant execute on function get_facturacion_config() to authenticated;

-- ── consultar documento (RUC/DNI) vía API externa; null si no hay config ──
create or replace function consultar_documento(p_tipo text, p_numero text)
  returns jsonb language plpgsql security definer set search_path=public, auth, extensions as
$$
declare v_url text; v_tok text; v_resp text; v_j jsonb;
begin
  perform _req_staff();
  select lookup_url, lookup_token into v_url, v_tok from facturacion_config where id=1;
  if coalesce(v_url,'') = '' or coalesce(v_tok,'') = '' then return jsonb_build_object('ok',false,'motivo','sin_config'); end if;
  if p_tipo not in ('6','1') then return jsonb_build_object('ok',false,'motivo','tipo_manual'); end if;  -- CE/pasaporte = manual
  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT','12');
    select content into v_resp from http(('GET', v_url || p_numero,
      array[http_header('Authorization','Bearer '||v_tok)], NULL, NULL)::http_request);
    v_j := v_resp::jsonb;
    -- apis.net.pe: RUC→razonSocial/direccion ; DNI→nombre o nombres+apellidos
    return jsonb_build_object('ok',true,
      'nombre', coalesce(v_j->>'razonSocial', v_j->>'nombre',
                 trim(coalesce(v_j->>'nombres','')||' '||coalesce(v_j->>'apellidoPaterno','')||' '||coalesce(v_j->>'apellidoMaterno',''))),
      'direccion', coalesce(v_j->>'direccion',''));
  exception when others then return jsonb_build_object('ok',false,'motivo','error_api'); end;
end $$;
grant execute on function consultar_documento(text,text) to authenticated;

-- ── helper: arma items NubeFact (valor/igv por ítem) ──
create or replace function _nf_items(p_items jsonb, p_exonerado boolean)
  returns jsonb language sql immutable as
$$
  select coalesce(jsonb_agg(jsonb_build_object(
    'unidad_de_medida','NIU','codigo','S','descripcion', i->>'descripcion',
    'cantidad', (i->>'cantidad')::numeric,
    'valor_unitario', case when p_exonerado then (i->>'precio')::numeric else round((i->>'precio')::numeric/1.18,2) end,
    'precio_unitario', (i->>'precio')::numeric,
    'tipo_de_igv', case when p_exonerado then 8 else 1 end,   -- 1=Gravado, 8=Exonerado
    'igv', case when p_exonerado then 0 else round(((i->>'precio')::numeric - round((i->>'precio')::numeric/1.18,2))*(i->>'cantidad')::numeric,2) end,
    'total', round((i->>'precio')::numeric*(i->>'cantidad')::numeric,2)
  )), '[]'::jsonb) from jsonb_array_elements(p_items) i
$$;

-- columnas que usa la rama real (idempotente)
alter table comprobantes add column if not exists enlace_xml text;
alter table comprobantes add column if not exists sunat_descripcion text;
alter table comprobantes add column if not exists errores text;

-- Recreamos emitir_comprobante: STUB si config inactiva; REAL si activa.
create or replace function emitir_comprobante(
    p_tipo int, p_serie text,
    p_cliente_doc_tipo text, p_cliente_doc text, p_cliente_nombre text, p_cliente_email text,
    p_items jsonb, p_exonerado boolean default false, p_moneda text default 'PEN',
    p_origen text default 'panel', p_operacion_ref text default null,
    p_creado_por text default null, p_local_id text default null,
    p_cliente_tel text default null, p_cliente_dir text default null, p_es_extranjero boolean default false)
  returns jsonb language plpgsql security definer set search_path=public, auth, extensions as
$$
declare v_num int; v_id text; v_existing comprobantes; v_total numeric; v_grav numeric; v_igv numeric; v_exo numeric;
        v_cfg facturacion_config; v_body jsonb; v_resp text; v_j jsonb; v_estado text; v_pdf text; v_qr text; v_xml text; v_err text;
begin
  perform _req_staff();
  if p_origen = 'muelle' and not coalesce((select facturacion_muelle from app_config where app_id='operacionesps'), false) then
    raise exception 'FACTURACION_OFF: el admin no habilitó la facturación en el muelle';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'ITEMS: se requiere al menos un servicio'; end if;

  perform 1 from series where serie = p_serie for update;
  if not found then raise exception 'SERIE: % no existe', p_serie; end if;
  if p_local_id is not null then
    select * into v_existing from comprobantes where local_id = p_local_id;
    if found then return jsonb_build_object('id',v_existing.id,'serie',v_existing.serie,'numero',v_existing.numero,
      'estado',v_existing.estado,'total',v_existing.total,'pdf',v_existing.enlace_pdf,'qr',v_existing.qr,'reusado',true); end if;
  end if;

  select coalesce(sum((i->>'cantidad')::numeric * (i->>'precio')::numeric), 0) into v_total from jsonb_array_elements(p_items) i;
  if p_exonerado then v_exo := v_total; v_grav := 0; v_igv := 0;
  else v_grav := round(v_total/1.18,2); v_igv := round(v_total - round(v_total/1.18,2),2); v_exo := 0; end if;

  select correlativo + 1 into v_num from series where serie = p_serie;
  update series set correlativo = v_num where serie = p_serie;

  select * into v_cfg from facturacion_config where id=1;
  v_estado := 'stub'; v_pdf := '(demo) PDF pendiente NubeFact'; v_qr := '(demo)'; v_xml := null; v_err := null;

  -- ── modo REAL: llamar a NubeFact ──
  if v_cfg.activo and coalesce(v_cfg.nubefact_ruta,'') <> '' and coalesce(v_cfg.nubefact_token,'') <> '' then
    v_body := jsonb_build_object(
      'operacion','generar_comprobante',
      'tipo_de_comprobante', p_tipo, 'serie', p_serie, 'numero', v_num,
      'sunat_transaction', 1, 'cliente_tipo_de_documento', coalesce(nullif(p_cliente_doc_tipo,''),'0'),
      'cliente_numero_de_documento', coalesce(nullif(p_cliente_doc,''),'00000000'),
      'cliente_denominacion', p_cliente_nombre, 'cliente_direccion', coalesce(p_cliente_dir,''),
      'cliente_email', coalesce(p_cliente_email,''),
      'fecha_de_emision', to_char((now() at time zone 'America/Lima')::date,'DD-MM-YYYY'),
      'moneda', case when coalesce(p_moneda,'PEN')='USD' then 2 else 1 end, 'porcentaje_de_igv', 18,
      'total_gravada', v_grav, 'total_exonerada', v_exo, 'total_igv', v_igv, 'total', v_total,
      'enviar_automaticamente_a_la_sunat', true, 'enviar_automaticamente_al_cliente', (coalesce(p_cliente_email,'')<>''),
      'items', _nf_items(p_items, p_exonerado));
    begin
      perform http_set_curlopt('CURLOPT_TIMEOUT','25');
      select content into v_resp from http(('POST', v_cfg.nubefact_ruta,
        array[http_header('Authorization', v_cfg.nubefact_token)], 'application/json', v_body::text)::http_request);
      v_j := v_resp::jsonb;
      if coalesce((v_j->>'aceptada_por_sunat')::boolean, false) or coalesce(v_j->>'enlace_del_pdf','')<>'' then
        v_estado := 'aceptada'; v_pdf := v_j->>'enlace_del_pdf'; v_xml := v_j->>'enlace_del_xml'; v_qr := v_j->>'cadena_para_codigo_qr';
      else v_estado := 'rechazada'; v_err := coalesce(v_j->>'errors', v_j->>'sunat_description', v_resp); end if;
    exception when others then v_estado := 'pendiente'; v_err := 'No se pudo contactar NubeFact: '||SQLERRM; end;
  end if;

  insert into comprobantes(tipo,serie,numero,moneda,cliente_doc_tipo,cliente_doc,cliente_nombre,cliente_email,
      exonerado,total_gravada,total_exonerada,total_igv,total,items,estado,enlace_pdf,enlace_xml,qr,sunat_descripcion,errores,local_id,origen,operacion_ref,creado_por)
    values(p_tipo,p_serie,v_num,coalesce(p_moneda,'PEN'),nullif(p_cliente_doc_tipo,''),nullif(p_cliente_doc,''),
      p_cliente_nombre,nullif(p_cliente_email,''),coalesce(p_exonerado,false),v_grav,v_exo,v_igv,v_total,p_items,
      v_estado,v_pdf,v_xml,v_qr,coalesce(v_j->>'sunat_description',null),v_err,p_local_id,coalesce(p_origen,'panel'),nullif(p_operacion_ref,''),p_creado_por)
    returning id into v_id;

  if coalesce(p_cliente_doc,'') <> '' and coalesce(p_cliente_doc_tipo,'0') <> '0' then
    insert into clientes(doc_tipo,doc_numero,nombre,direccion,email,telefono,es_extranjero,veces)
      values(p_cliente_doc_tipo,p_cliente_doc,p_cliente_nombre,nullif(p_cliente_dir,''),nullif(p_cliente_email,''),nullif(p_cliente_tel,''),coalesce(p_es_extranjero,false),1)
    on conflict (doc_tipo,doc_numero) do update set nombre=excluded.nombre,
      direccion=coalesce(excluded.direccion,clientes.direccion), email=coalesce(excluded.email,clientes.email),
      telefono=coalesce(excluded.telefono,clientes.telefono), es_extranjero=excluded.es_extranjero, veces=clientes.veces+1, actualizado_at=now();
  end if;

  return jsonb_build_object('id',v_id,'serie',p_serie,'numero',v_num,'estado',v_estado,'total',v_total,
    'gravada',v_grav,'igv',v_igv,'pdf',v_pdf,'qr',v_qr,'errores',v_err);
end $$;
grant execute on function emitir_comprobante(int,text,text,text,text,text,jsonb,boolean,text,text,text,text,text,text,text,boolean) to authenticated;

-- ── anular (nota de baja). REAL si config activa; si no, marca anulada localmente. ──
create or replace function anular_comprobante(p_id text, p_motivo text)
  returns jsonb language plpgsql security definer set search_path=public, auth, extensions as
$$
declare v_cmp comprobantes; v_cfg facturacion_config; v_body jsonb; v_resp text; v_j jsonb;
begin
  perform _req_admin();
  select * into v_cmp from comprobantes where id = p_id for update;
  if not found then raise exception 'NO_EXISTE: comprobante %', p_id; end if;
  if v_cmp.estado = 'anulada' then return jsonb_build_object('ok',true,'ya',true); end if;
  select * into v_cfg from facturacion_config where id=1;
  if v_cfg.activo and v_cmp.estado='aceptada' and coalesce(v_cfg.nubefact_ruta,'')<>'' then
    v_body := jsonb_build_object('operacion','generar_anulacion','tipo_de_comprobante',v_cmp.tipo,
      'serie',v_cmp.serie,'numero',v_cmp.numero,'motivo',coalesce(p_motivo,'Anulación'),'codigo_unico','');
    begin
      perform http_set_curlopt('CURLOPT_TIMEOUT','25');
      select content into v_resp from http(('POST', v_cfg.nubefact_ruta,
        array[http_header('Authorization', v_cfg.nubefact_token)],'application/json', v_body::text)::http_request);
      v_j := v_resp::jsonb;
    exception when others then raise exception 'NUBEFACT: no se pudo anular (%)', SQLERRM; end;
  end if;
  update comprobantes set estado='anulada', errores=coalesce(p_motivo,'anulada') where id=p_id;
  return jsonb_build_object('ok',true);
end $$;
grant execute on function anular_comprobante(text,text) to authenticated;
