-- SNAPSHOT VIVO (emitir_nota_credito: A4 for update + A6 total_gratuita + persiste total_gratuita + total=suma de buckets) — _apply_*.js
CREATE OR REPLACE FUNCTION public.emitir_nota_credito(p_ref_id text, p_tipo_nota integer DEFAULT 1, p_motivo text DEFAULT 'Anulacion de la operacion'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare v_o comprobantes; v_cfg facturacion_config; v_num int; v_body jsonb; v_resp text; v_j jsonb; v_id text; v_estado text; v_pdf text; v_try int; v_errlow text; v_ncgra numeric; v_nctot numeric;
begin
  perform _req_admin();
  select * into v_o from comprobantes where id = p_ref_id for update;
  if not found then raise exception 'NO_EXISTE: comprobante %', p_ref_id; end if;
  if v_o.estado <> 'aceptada' then raise exception 'SOLO_ACEPTADAS: solo se emite NC sobre un comprobante aceptado (estado actual: %)', v_o.estado; end if;
  if v_o.tipo = 3 then raise exception 'NO_NC_DE_NC: no se emite nota de crédito de una nota de crédito'; end if;

  select * into v_cfg from facturacion_config where id=1;
  select coalesce(sum(round((i->>'cantidad')::numeric*(i->>'precio')::numeric,2)),0) into v_ncgra from jsonb_array_elements(v_o.items) i where coalesce(i->>'afectacion','')='gratuito';
  v_nctot := round(coalesce(v_o.total_gravada,0)+coalesce(v_o.total_exonerada,0)+coalesce(v_o.total_inafecta,0)+coalesce(v_o.total_igv,0),2);
  -- A3: serializar la numeración de NC por serie (lock tx-local), como la factura con FOR UPDATE sobre series.
  -- Evita que dos NC concurrentes calculen el mismo max()+1.
  perform pg_advisory_xact_lock(hashtext('nc:'||v_o.serie));
  -- correlativo propio de NC por serie (tipo 3), NubeFact es la autoridad
  select coalesce(max(numero),0)+1 into v_num from comprobantes where tipo=3 and serie=v_o.serie;

  if not (v_cfg.activo and coalesce(v_cfg.nubefact_ruta,'')<>'' and coalesce(v_cfg.nubefact_token,'')<>'') then
    insert into comprobantes(tipo,serie,numero,moneda,cliente_doc_tipo,cliente_doc,cliente_nombre,
        total_gravada,total_exonerada,total_inafecta,total_igv,total,total_gratuita,items,estado,enlace_pdf,qr,
        doc_modifica_tipo,doc_modifica_serie,doc_modifica_numero,errores,origen)
      values(3,v_o.serie,v_num,v_o.moneda,v_o.cliente_doc_tipo,v_o.cliente_doc,v_o.cliente_nombre,
        v_o.total_gravada,v_o.total_exonerada,coalesce(v_o.total_inafecta,0),v_o.total_igv,v_nctot,coalesce(v_ncgra,0),v_o.items,'stub','(demo) NC',
        '(demo)',v_o.tipo,v_o.serie,v_o.numero,coalesce(p_motivo,'NC'),'panel')
      returning id into v_id;
    if p_tipo_nota = 1 then update comprobantes set estado='anulada', anulacion_estado='aprobada' where id=p_ref_id; end if;
    return jsonb_build_object('ok',true,'estado','stub','serie',v_o.serie,'numero',v_num,'id',v_id);
  end if;

  perform set_config('statement_timeout','30000', true);
  v_estado := null;
  for v_try in 1..12 loop  -- salta números ya usados en NubeFact (huérfanos de reintentos)
    v_body := jsonb_build_object(
      'operacion','generar_comprobante','tipo_de_comprobante',3,'serie',v_o.serie,'numero',v_num,'sunat_transaction',1,
      'documento_que_se_modifica_tipo', v_o.tipo, 'documento_que_se_modifica_serie', v_o.serie, 'documento_que_se_modifica_numero', v_o.numero,
      'tipo_de_nota_de_credito', p_tipo_nota,
      'cliente_tipo_de_documento', coalesce(nullif(v_o.cliente_doc_tipo,''),'0'), 'cliente_numero_de_documento', coalesce(nullif(v_o.cliente_doc,''),'00000000'),
      'cliente_denominacion', coalesce(nullif(v_o.cliente_nombre,''),'CLIENTE VARIOS'),
      'fecha_de_emision', to_char((now() at time zone 'America/Lima')::date,'DD-MM-YYYY'),
      'moneda', case when v_o.moneda='USD' then 2 else 1 end, 'porcentaje_de_igv', 18,
      'total_gravada', v_o.total_gravada, 'total_exonerada', v_o.total_exonerada, 'total_inafecta', coalesce(v_o.total_inafecta,0),
      'total_igv', v_o.total_igv, 'total', v_nctot,
      'observaciones', coalesce(p_motivo,'Anulacion'),
      'enviar_automaticamente_a_la_sunat', true,
      'items', _nf_items(v_o.items, coalesce(v_o.exonerado,false), coalesce(v_o.es_exportacion,false)));
    if coalesce(v_ncgra,0) > 0 then v_body := v_body || jsonb_build_object('total_gratuita', v_ncgra); end if;
    begin
      perform http_set_curlopt('CURLOPT_CONNECTTIMEOUT','5'); perform http_set_curlopt('CURLOPT_TIMEOUT','22');
      select content into v_resp from http(('POST', v_cfg.nubefact_ruta,
        array[http_header('Authorization', replace(coalesce(v_cfg.auth_header,'{token}'),'{token}', v_cfg.nubefact_token))],
        'application/json', v_body::text)::http_request);
    exception when others then raise exception 'NUBEFACT_SIN_RESPUESTA (NC): %', SQLERRM; end;
    v_j := v_resp::jsonb;
    if coalesce((v_j->>'aceptada_por_sunat')::boolean,false) or coalesce(v_j->>'enlace_del_pdf','')<>'' then
      v_num := coalesce((v_j->>'numero')::int, v_num); v_estado := 'aceptada'; v_pdf := v_j->>'enlace_del_pdf'; exit;
    end if;
    v_errlow := lower(coalesce(v_j->>'errors','')||' '||coalesce(v_j->>'sunat_description',''));
    if v_errlow ~ 'ya existe|duplicad|ya fue informado' then v_num := v_num + 1; continue; end if;
    raise exception 'NC_RECHAZADA: %', left(coalesce(v_j->>'errors', v_j->>'sunat_description', v_resp), 300);
  end loop;
  if v_estado is null then raise exception 'NC_SIN_NUMERO_LIBRE: no se encontró número libre para la NC en la serie %', v_o.serie; end if;

  insert into comprobantes(tipo,serie,numero,moneda,cliente_doc_tipo,cliente_doc,cliente_nombre,
      total_gravada,total_exonerada,total_inafecta,total_igv,total,total_gratuita,items,estado,enlace_pdf,enlace_xml,enlace_cdr,qr,hash,
      aceptada_por_sunat,sunat_descripcion,nf_respuesta,doc_modifica_tipo,doc_modifica_serie,doc_modifica_numero,errores,origen)
    values(3,v_o.serie,v_num,v_o.moneda,v_o.cliente_doc_tipo,v_o.cliente_doc,v_o.cliente_nombre,
      v_o.total_gravada,v_o.total_exonerada,coalesce(v_o.total_inafecta,0),v_o.total_igv,v_nctot,coalesce(v_ncgra,0),v_o.items,'aceptada',
      v_pdf,v_j->>'enlace_del_xml',v_j->>'enlace_del_cdr',v_j->>'cadena_para_codigo_qr',v_j->>'codigo_hash',
      true,v_j->>'sunat_description',v_j,v_o.tipo,v_o.serie,v_o.numero,coalesce(p_motivo,'NC'),'panel')
    returning id into v_id;

  if p_tipo_nota = 1 then update comprobantes set estado='anulada', anulacion_estado='aprobada' where id=p_ref_id; end if;
  return jsonb_build_object('ok',true,'id',v_id,'serie',v_o.serie,'numero',v_num,'estado','aceptada','pdf',v_pdf);
end $function$
;
