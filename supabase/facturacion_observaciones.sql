-- Observaciones opcionales del admin en el CPE (2026-08-02) — generado del vivo + parche
CREATE OR REPLACE FUNCTION public.emitir_comprobante(p_tipo integer, p_serie text, p_cliente_doc_tipo text, p_cliente_doc text, p_cliente_nombre text, p_cliente_email text, p_items jsonb, p_exonerado boolean DEFAULT false, p_moneda text DEFAULT 'PEN'::text, p_origen text DEFAULT 'panel'::text, p_operacion_ref text DEFAULT NULL::text, p_creado_por text DEFAULT NULL::text, p_local_id text DEFAULT NULL::text, p_cliente_tel text DEFAULT NULL::text, p_cliente_dir text DEFAULT NULL::text, p_es_extranjero boolean DEFAULT false, p_medio_pago text DEFAULT NULL::text, p_exportacion boolean DEFAULT false, p_detraccion boolean DEFAULT false, p_forma_pago text DEFAULT 'CONTADO'::text, p_credito_venc date DEFAULT NULL::date, p_observaciones text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare v_num int; v_id text; v_existing comprobantes; v_total numeric; v_grav numeric; v_igv numeric; v_exo numeric;
        v_cfg facturacion_config; v_body jsonb; v_resp text; v_j jsonb; v_estado text; v_pdf text; v_qr text; v_xml text;
        v_err text; v_hash text; v_fpago text; v_venc date; v_gratis numeric; v_real boolean; v_errlow text; v_obs text; v_doc text; v_export numeric; v_inaf numeric; v_detr numeric;
begin
  perform _req_staff();
  if p_origen = 'muelle' and not coalesce((select facturacion_muelle from app_config where app_id='operacionesps'), false) then
    raise exception 'FACTURACION_OFF: el admin no habilitó la facturación en el muelle';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS: se requiere al menos un servicio';
  end if;
  -- guard por ítem: cantidad > 0 y precio >= 0 (evita rechazo NubeFact "cantidad debe ser > 0" / precio nulo)
  if exists(select 1 from jsonb_array_elements(p_items) i
            where coalesce((i->>'cantidad')::numeric,0) <= 0 or coalesce((i->>'precio')::numeric,-1) < 0) then
    raise exception 'ITEM_INVALIDO: cada servicio requiere cantidad > 0 y precio >= 0';
  end if;
  -- guard cruzado tipo <-> serie (factura=F..., boleta=B...); evita "la serie no corresponde al tipo"
  if p_tipo = 1 and upper(p_serie) !~ '^F' then raise exception 'SERIE_TIPO: una factura (tipo 1) exige serie que empiece con F (recibí %)', p_serie; end if;
  if p_tipo = 2 and upper(p_serie) !~ '^B' then raise exception 'SERIE_TIPO: una boleta (tipo 2) exige serie que empiece con B (recibí %)', p_serie; end if;

  -- lock de la serie HASTA fin de tx: serializa numeración + la llamada a NubeFact
  perform 1 from series where serie = p_serie for update;
  if not found then raise exception 'SERIE: % no existe', p_serie; end if;

  -- idempotencia (dentro del lock): reintento del MISMO intento → devuelve lo ya emitido
  if p_local_id is not null then
    select * into v_existing from comprobantes where local_id = p_local_id;
    if found then return jsonb_build_object('id',v_existing.id,'serie',v_existing.serie,'numero',v_existing.numero,
      'estado',v_existing.estado,'total',v_existing.total,'pdf',v_existing.enlace_pdf,'qr',v_existing.qr,'reusado',true); end if;
  end if;

  -- total (derivado de los ítems → base imponible no manipulable por el cliente).
  -- Redondeo POR LÍNEA (igual que el total emitido) para que las validaciones de umbral 700/2000
  -- usen exactamente el mismo total que se envía (evita straddle del borde por fracción de céntimo).
  select coalesce(sum(round((i->>'cantidad')::numeric * (i->>'precio')::numeric, 2)), 0) into v_total from jsonb_array_elements(p_items) i where coalesce(i->>'afectacion','') <> 'gratuito';

  -- ── VALIDACIONES SUNAT (server-side, misma verdad para panel y muelle) ──
  v_doc := coalesce(nullif(p_cliente_doc,''),'');
  if p_exportacion then  -- EXPORTACIÓN (turismo receptivo, 0% IGV)
    if not coalesce((select operador_turistico_registrado from facturacion_config where id=1), false) then
      raise exception 'EXPORTACION_NO_HABILITADA: la empresa no está marcada como operador turístico registrado'; end if;
    if p_tipo <> 1 then raise exception 'EXPORTACION_REQUIERE_FACTURA: la exportación se emite como factura'; end if;
    if not ( (coalesce(p_cliente_doc_tipo,'') = '7' and v_doc <> '')
             or (coalesce(p_cliente_doc_tipo,'') = '0' and v_doc <> '' and v_doc <> '00000000') ) then
      raise exception 'EXPORTACION_REQUIERE_PASAPORTE_O_TAXID: exportación exige pasaporte del turista o tax-id de la empresa extranjera (no CE/DNI/Varios)'; end if;
    if coalesce(trim(p_cliente_nombre),'') = '' then raise exception 'EXPORTACION_REQUIERE_NOMBRE: falta el nombre del turista'; end if;
    if jsonb_array_length(p_items) < 2 then raise exception 'EXPORTACION_REQUIERE_PAQUETE: el paquete exige 2+ servicios (transporte + guía)'; end if;
  elsif p_tipo = 1 then  -- FACTURA nacional
    if coalesce(p_cliente_doc_tipo,'') <> '6' or v_doc !~ '^(10|15|17|20)\d{9}$' then
      raise exception 'FACTURA_REQUIERE_RUC: una factura exige RUC válido de 11 dígitos (prefijo 10/15/17/20)'; end if;
    if coalesce(trim(p_cliente_nombre),'') = '' then raise exception 'FACTURA_REQUIERE_NOMBRE: falta la razón social'; end if;
    if coalesce(trim(p_cliente_dir),'') = ''   then raise exception 'FACTURA_REQUIERE_DIRECCION: falta la dirección fiscal'; end if;
  elsif p_tipo = 2 and v_total > 700 then  -- BOLETA > S/700
    if coalesce(p_cliente_doc_tipo,'0') = '0' or v_doc = '' then
      raise exception 'BOLETA_MAYOR_700_REQUIERE_ID: boleta > S/700 debe identificar al cliente (DNI/CE/pasaporte)'; end if;
    if coalesce(trim(p_cliente_nombre),'') = '' then raise exception 'BOLETA_MAYOR_700_REQUIERE_NOMBRE: falta el nombre del cliente'; end if;
  end if;
  if v_total >= 2000 and not p_exportacion and coalesce(trim(p_medio_pago),'') = '' then  -- Bancarización Ley 28194 (no aplica a exportación)
    raise exception 'REQUIERE_MEDIO_DE_PAGO: operación >= S/2000 exige indicar el medio de pago (bancarización)'; end if;

  -- ── FORMA DE PAGO (RS 193-2020, vigente 2021-09): facturas indican contado/crédito ──
  -- CONTADO: no se envía nada (NubeFact marca contado por defecto en el XML).
  -- CREDITO: cuota única con vencimiento → venta_al_credito (validado en demo FFF1-15).
  v_fpago := upper(coalesce(nullif(trim(p_forma_pago),''),'CONTADO'));
  if v_fpago not in ('CONTADO','CREDITO') then raise exception 'FORMA_PAGO_INVALIDA: usa CONTADO o CREDITO (recibí %)', p_forma_pago; end if;
  if v_fpago = 'CREDITO' then
    if p_tipo <> 1 then raise exception 'CREDITO_SOLO_FACTURA: la venta al crédito se emite como factura'; end if;
    if p_exportacion then raise exception 'CREDITO_NO_EXPORTACION: exportación se registra al contado'; end if;
    v_venc := p_credito_venc;
    if v_venc is null then raise exception 'CREDITO_REQUIERE_VENCIMIENTO: indica la fecha de pago'; end if;
    if v_venc < (now() at time zone 'America/Lima')::date then raise exception 'CREDITO_VENCIMIENTO_PASADO: la fecha de pago no puede ser anterior a hoy'; end if;
  end if;

  -- Buckets por afectación de CADA ítem. IGV por RESTA (ancla = lo que paga el cliente):
  -- tot = round(precio*cant,2); valor de venta = round(tot/1.18,2); IGV = tot - valor.
  -- Así sub+igv == tot exacto por línea y Σbuckets == total (sin desvío de ±0.01 por reconstrucción).
  -- v_inaf incluye inafecto + exportación (NubeFact usa total_inafecta como bucket de exportación).
  select
    coalesce(sum(case when af='gravado' then sub else 0 end),0),
    coalesce(sum(case when af='gravado' then igv else 0 end),0),
    coalesce(sum(case when af in ('inafecto','exportacion') then sub else 0 end),0),
    coalesce(sum(case when af='exonerado' then sub else 0 end),0),
    coalesce(sum(case when af='exportacion' then sub else 0 end),0),
    coalesce(sum(case when af <> 'gratuito' then tot else 0 end),0),
    coalesce(sum(case when af = 'gratuito' then tot else 0 end),0)
  into v_grav, v_igv, v_inaf, v_exo, v_export, v_total, v_gratis
  from (
    select af, tot,
           case when af='gravado' then round(tot/1.18,2) else tot end sub,
           case when af='gravado' then tot - round(tot/1.18,2) else 0 end igv
    from (
      select coalesce(nullif(i->>'afectacion',''), case when p_exportacion then 'exportacion' when p_exonerado then 'exonerado' else 'gravado' end) af,
             round((i->>'cantidad')::numeric * (i->>'precio')::numeric, 2) tot
      from jsonb_array_elements(p_items) i
    ) a
  ) b;

  -- CORTESÍA (op. gratuita): exige al menos una línea COBRADA y no se mezcla con exportación
  if coalesce(v_gratis,0) > 0 then
    if p_exportacion then raise exception 'GRATUITA_NO_EXPORTACION: la cortesía no se mezcla con exportación'; end if;
    if v_total <= 0 then raise exception 'GRATUITA_REQUIERE_LINEA_COBRADA: la cortesía acompaña a una venta (agrega la línea pagada del grupo)'; end if;
  end if;
  -- Detracción (SPOT) 12% cód.037 — solo facturas B2B > S/700
  if p_detraccion and not (p_tipo = 1 and v_total > 700) then
    raise exception 'DETRACCION_SOLO_FACTURA_B2B: la detracción aplica a facturas > S/700'; end if;
  v_detr := case when p_detraccion then round(v_total*0.12,2) else 0 end;

  -- PEEK del siguiente número (NO se avanza todavía)
  select correlativo + 1 into v_num from series where serie = p_serie;

  select * into v_cfg from facturacion_config where id=1;
  v_real := v_cfg.activo and coalesce(v_cfg.nubefact_ruta,'') <> '' and coalesce(v_cfg.nubefact_token,'') <> '';
  v_estado := 'stub'; v_pdf := '(demo) PDF pendiente NubeFact'; v_qr := '(demo)'; v_xml := null; v_err := null; v_hash := null;
  v_obs := nullif(concat_ws(' · ', nullif(trim(coalesce(p_observaciones,'')),''), case when coalesce(trim(p_medio_pago),'') <> '' then 'Medio de pago: '||p_medio_pago else null end), '');

  -- ── modo REAL: NubeFact es la autoridad del número ──
  if v_real then
    v_body := jsonb_build_object(
      'operacion','generar_comprobante',
      'tipo_de_comprobante', p_tipo, 'serie', p_serie, 'numero', v_num,
      'sunat_transaction', case when p_detraccion then 29 when p_exportacion then 2 else 1 end,  -- 29=detracción genérica (cód.037); 2=exportación; 1=venta interna
      -- exportación: SUNAT cat.06 exige '0' (NO DOMICILIADO SIN RUC); el pasaporte del turista va en el número
      'cliente_tipo_de_documento', case when p_exportacion then '0' else coalesce(nullif(p_cliente_doc_tipo,''),'0') end,
      'cliente_numero_de_documento', regexp_replace(coalesce(nullif(p_cliente_doc,''),'00000000'),'[^A-Za-z0-9]','','g'),
      'cliente_denominacion', coalesce(nullif(p_cliente_nombre,''),'CLIENTE VARIOS'),
      'cliente_direccion', coalesce(p_cliente_dir,''), 'cliente_email', coalesce(p_cliente_email,''),
      'fecha_de_emision', to_char((now() at time zone 'America/Lima')::date,'DD-MM-YYYY'),
      'moneda', case when coalesce(p_moneda,'PEN')='USD' then 2 else 1 end, 'porcentaje_de_igv', 18,
      -- total_inafecta = inafecto + exportación (NubeFact usa este bucket para export). Σbuckets==total.
      'total_gravada', v_grav, 'total_exonerada', v_exo, 'total_inafecta', v_inaf, 'total_igv', v_igv, 'total', v_total,
      'detraccion', p_detraccion,
      'detraccion_tipo', case when p_detraccion then '037' else null end,
      'detraccion_porcentaje', case when p_detraccion then 12 else null end,
      'detraccion_total', case when p_detraccion then v_detr else null end,
      'medio_de_pago_detraccion', case when p_detraccion then '001' else null end,
      'observaciones', (case when p_detraccion then 'Operacion sujeta al SPOT 12% cod.037. ' else '' end || coalesce(v_obs,'')),
      'enviar_automaticamente_a_la_sunat', true,
      'enviar_automaticamente_al_cliente', (coalesce(p_cliente_email,'')<>''),
      'items', _nf_items(p_items, p_exonerado, p_exportacion));
    if coalesce(v_gratis,0) > 0 then v_body := v_body || jsonb_build_object('total_gratuita', v_gratis); end if;
    if v_fpago = 'CREDITO' then
      v_body := v_body || jsonb_build_object(
        'fecha_de_vencimiento', to_char(v_venc,'YYYY-MM-DD'),
        'venta_al_credito', jsonb_build_array(jsonb_build_object('cuota',1,'fecha_de_pago',to_char(v_venc,'YYYY-MM-DD'),'importe',v_total)));
    end if;
    -- timeouts alineados: server < cliente (30s). Si no responde → RAISE → rollback (no quema nº).
    begin
      perform set_config('statement_timeout','30000', true);
      perform http_set_curlopt('CURLOPT_CONNECTTIMEOUT','5');
      perform http_set_curlopt('CURLOPT_TIMEOUT','22');
      select content into v_resp from http(('POST', v_cfg.nubefact_ruta,
        array[http_header('Authorization', replace(coalesce(v_cfg.auth_header,'{token}'),'{token}', v_cfg.nubefact_token))],
        'application/json', v_body::text)::http_request);
    exception when others then
      raise exception 'NUBEFACT_SIN_RESPUESTA: no se pudo contactar NubeFact (%). No se consumió numeración; reintenta el mismo comprobante.', SQLERRM;
    end;
    v_j := v_resp::jsonb;

    -- guard: NubeFact NO debe devolver un número distinto al enviado
    if nullif(v_j->>'numero','') is not null and (v_j->>'numero')::int <> v_num then
      raise exception 'CORRELATIVO_DESYNC: NubeFact devolvió nº % pero se envió % (serie %)', v_j->>'numero', v_num, p_serie;
    end if;

    v_errlow := lower(coalesce(v_j->>'errors','')||' '||coalesce(v_j->>'sunat_description',''));
    if coalesce((v_j->>'aceptada_por_sunat')::boolean, false) or coalesce(v_j->>'enlace_del_pdf','') <> '' then
      v_estado := 'aceptada'; v_pdf := v_j->>'enlace_del_pdf'; v_xml := v_j->>'enlace_del_xml';
      v_qr := v_j->>'cadena_para_codigo_qr'; v_hash := v_j->>'codigo_hash';
    elsif v_errlow ~ 'ya fue informado|duplicad|registrado anter|ya existe|already' then
      -- el número ya está en NubeFact/SUNAT: dejar PENDIENTE, el cron lo reconcilia (no rechazar)
      v_estado := 'pendiente'; v_err := 'Duplicado en NubeFact — se reconciliará: '||coalesce(v_j->>'errors', v_j->>'sunat_description','');
    elsif coalesce(v_j->>'sunat_responsecode','') <> '' or coalesce(v_j->>'sunat_soap_error','') <> '' then
      -- SUNAT SÍ recibió el comprobante y lo rechazó → el número quedó consumido → registrar (requiere comunicación de baja)
      v_estado := 'rechazada'; v_err := coalesce(v_j->>'errors', v_j->>'sunat_description', v_resp);
    else
      -- rechazo de VALIDACIÓN de NubeFact (campo faltante/JSON): el número NO se reservó en SUNAT →
      -- RAISE → rollback → NO se quema el correlativo; el operador corrige y reintenta el MISMO número.
      raise exception 'NUBEFACT_RECHAZO: %', left(coalesce(v_j->>'errors', v_j->>'sunat_description', v_resp), 300);
    end if;
  end if;

  -- AVANZA el correlativo (stub: siempre; real: solo porque NubeFact respondió). Monotónico.
  update series set correlativo = v_num where serie = p_serie and correlativo < v_num;

  insert into comprobantes(tipo,serie,numero,moneda,cliente_doc_tipo,cliente_doc,cliente_nombre,cliente_email,cliente_tel,
      exonerado,es_exportacion,total_gravada,total_exonerada,total_exportacion,total_inafecta,total_igv,total,total_gratuita,observaciones,items,estado,enlace_pdf,enlace_xml,enlace_cdr,qr,hash,codigo_barras,medio_pago,forma_pago,credito_vencimiento,detraccion,detraccion_total,
      aceptada_por_sunat,sunat_descripcion,sunat_responsecode,sunat_soap_error,nf_respuesta,errores,local_id,origen,operacion_ref,creado_por)
    values(p_tipo,p_serie,v_num,coalesce(p_moneda,'PEN'),nullif(p_cliente_doc_tipo,''),nullif(p_cliente_doc,''),
      p_cliente_nombre,nullif(p_cliente_email,''),nullif(p_cliente_tel,''),coalesce(p_exonerado,false),coalesce(p_exportacion,false),v_grav,v_exo,v_export,v_inaf,v_igv,v_total,coalesce(v_gratis,0),nullif(trim(coalesce(p_observaciones,'')),''),p_items,
      v_estado,v_pdf,v_xml,(v_j->>'enlace_del_cdr'),v_qr,v_hash,(v_j->>'codigo_de_barras'),nullif(p_medio_pago,''),v_fpago,v_venc,coalesce(p_detraccion,false),v_detr,
      case when v_real then coalesce((v_j->>'aceptada_por_sunat')::boolean,false) else null end,
      coalesce(v_j->>'sunat_description',null),(v_j->>'sunat_responsecode'),(v_j->>'sunat_soap_error'),v_j,v_err,
      p_local_id,coalesce(p_origen,'panel'),nullif(p_operacion_ref,''),p_creado_por)
    returning id into v_id;

  -- cliente frecuente (no guardar 'varios')
  if coalesce(p_cliente_doc,'') <> '' and coalesce(p_cliente_doc_tipo,'0') <> '0' then
    insert into clientes(doc_tipo,doc_numero,nombre,direccion,email,telefono,es_extranjero,veces)
      values(p_cliente_doc_tipo,p_cliente_doc,p_cliente_nombre,nullif(p_cliente_dir,''),nullif(p_cliente_email,''),nullif(p_cliente_tel,''),coalesce(p_es_extranjero,false),1)
    on conflict (doc_tipo,doc_numero) do update set nombre=excluded.nombre,
      direccion=coalesce(excluded.direccion,clientes.direccion), email=coalesce(excluded.email,clientes.email),
      telefono=coalesce(excluded.telefono,clientes.telefono), es_extranjero=excluded.es_extranjero, veces=clientes.veces+1, actualizado_at=now();
  end if;

  return jsonb_build_object('id',v_id,'serie',p_serie,'numero',v_num,'estado',v_estado,'total',v_total,
    'gravada',v_grav,'igv',v_igv,'pdf',v_pdf,'qr',v_qr,'errores',v_err);
end $function$
;
