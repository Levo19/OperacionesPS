-- ============================================================
-- OperacionesPS · Facturación — CORRELATIVO seguro + alineación con NubeFact
-- ------------------------------------------------------------
-- Contexto: PS reemplaza al sistema rentado viejo. NubeFact es la AUTORIDAD del
-- número oficial. Cambios:
--   1) En modo REAL ya NO se "quema" el correlativo si NubeFact no responde:
--      se hace PEEK del número, se llama a NubeFact, y SOLO se avanza el contador
--      cuando NubeFact RESPONDE (aceptada o rechazada-por-sunat = número consumido).
--      Si hay timeout/red → RAISE → rollback total → el operador reintenta el MISMO
--      número (NubeFact dedupea serie+numero, así no hay doble emisión).
--   2) Se guarda el número que DEVUELVE NubeFact (autoritativo), no el local.
--   3) admin_alinear_correlativo: el admin fija el punto de arranque por serie
--      (= último número del sistema viejo, o 0 si la serie es nueva en SUNAT).
--   4) get_facturacion_config ahora devuelve los correlativos actuales para la UI.
-- Seguro de re-ejecutar.
-- ============================================================

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
        v_cfg facturacion_config; v_body jsonb; v_resp text; v_j jsonb; v_estado text; v_pdf text; v_qr text; v_xml text; v_err text; v_real boolean;
begin
  perform _req_staff();
  if p_origen = 'muelle' and not coalesce((select facturacion_muelle from app_config where app_id='operacionesps'), false) then
    raise exception 'FACTURACION_OFF: el admin no habilitó la facturación en el muelle';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'ITEMS: se requiere al menos un servicio'; end if;

  -- lock de la serie HASTA fin de tx: serializa numeración + la llamada a NubeFact
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

  -- PEEK del siguiente número (NO se avanza todavía)
  select correlativo + 1 into v_num from series where serie = p_serie;

  select * into v_cfg from facturacion_config where id=1;
  v_real := v_cfg.activo and coalesce(v_cfg.nubefact_ruta,'') <> '' and coalesce(v_cfg.nubefact_token,'') <> '';
  v_estado := 'stub'; v_pdf := '(demo) PDF pendiente NubeFact'; v_qr := '(demo)'; v_xml := null; v_err := null;

  -- ── modo REAL: NubeFact manda. ⚠️ headers/campos a validar con el token demo. ──
  if v_real then
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
    -- Si NubeFact NO responde (timeout/red): RAISE → rollback total. NO se consume número.
    begin
      perform http_set_curlopt('CURLOPT_TIMEOUT','25');
      select content into v_resp from http(('POST', v_cfg.nubefact_ruta,
        array[http_header('Authorization', v_cfg.nubefact_token)], 'application/json', v_body::text)::http_request);
    exception when others then
      raise exception 'NUBEFACT_SIN_RESPUESTA: no se pudo contactar NubeFact (%). No se consumió numeración; reintenta.', SQLERRM;
    end;
    v_j := v_resp::jsonb;
    -- NubeFact respondió → el número quedó consumido allá (aceptado o rechazado). Tomamos SU número.
    v_num := coalesce((v_j->>'numero')::int, v_num);
    if coalesce((v_j->>'aceptada_por_sunat')::boolean, false) or coalesce(v_j->>'enlace_del_pdf','') <> '' then
      v_estado := 'aceptada'; v_pdf := v_j->>'enlace_del_pdf'; v_xml := v_j->>'enlace_del_xml'; v_qr := v_j->>'cadena_para_codigo_qr';
    else
      v_estado := 'rechazada'; v_err := coalesce(v_j->>'errors', v_j->>'sunat_description', v_resp);
    end if;
  end if;

  -- AVANZA el correlativo (stub: siempre; real: solo porque NubeFact respondió). Monotónico.
  update series set correlativo = v_num where serie = p_serie and correlativo < v_num;

  insert into comprobantes(tipo,serie,numero,moneda,cliente_doc_tipo,cliente_doc,cliente_nombre,cliente_email,cliente_tel,
      exonerado,total_gravada,total_exonerada,total_igv,total,items,estado,enlace_pdf,enlace_xml,qr,sunat_descripcion,errores,local_id,origen,operacion_ref,creado_por)
    values(p_tipo,p_serie,v_num,coalesce(p_moneda,'PEN'),nullif(p_cliente_doc_tipo,''),nullif(p_cliente_doc,''),
      p_cliente_nombre,nullif(p_cliente_email,''),nullif(p_cliente_tel,''),coalesce(p_exonerado,false),v_grav,v_exo,v_igv,v_total,p_items,
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

-- ── alinear el correlativo de arranque por serie (= último número del sistema viejo, o 0 si serie nueva) ──
create or replace function admin_alinear_correlativo(p_serie text, p_numero int)
  returns int language plpgsql security definer set search_path=public, auth as
$$ declare v int; begin
  perform _req_admin();
  if coalesce(p_numero,-1) < 0 then raise exception 'NUMERO: debe ser >= 0'; end if;
  update series set correlativo = p_numero where serie = p_serie returning correlativo into v;
  if v is null then raise exception 'SERIE: % no existe', p_serie; end if;
  return v;
end $$;
grant execute on function admin_alinear_correlativo(text,int) to authenticated;

-- ── get_facturacion_config ahora incluye los correlativos actuales (para la UI) ──
create or replace function get_facturacion_config()
  returns jsonb language sql stable security definer set search_path=public, auth as
$$ select jsonb_build_object(
     'tiene_nubefact', coalesce(nubefact_ruta,'') <> '' and coalesce(nubefact_token,'') <> '',
     'tiene_lookup', coalesce(lookup_url,'') <> '' and coalesce(lookup_token,'') <> '',
     'modo', modo, 'activo', activo,
     'series', (select coalesce(jsonb_object_agg(serie, correlativo), '{}'::jsonb) from series)
   ) from facturacion_config where id=1 $$;
grant execute on function get_facturacion_config() to authenticated;
