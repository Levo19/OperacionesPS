-- ============================================================
-- OperacionesPS · Facturación FASE 2 — Notas de Crédito
-- (Detracción 12% y afectación inafecta por-ítem/SERNANP ya viven en facturacion_blindaje.sql.)
-- Aplicar DESPUÉS de facturacion_blindaje.sql. Seguro de re-ejecutar.
-- ============================================================

-- Un mismo serie+numero puede coexistir para TIPOS distintos (Factura FFF1-1 y su NC FFF1-1).
-- La unicidad correcta es (tipo, serie, numero).
alter table comprobantes drop constraint if exists comprobantes_serie_numero_key;
create unique index if not exists ux_cmp_tipo_serie_num on comprobantes(tipo, serie, numero);

-- Emite una Nota de Crédito (tipo 3) que modifica un comprobante ACEPTADO.
-- p_tipo_nota (catálogo 09): 1=Anulación · 2=error RUC · 3=corrección descripción · 6=devolución total …
-- Si p_tipo_nota=1 (anulación) → marca el original como 'anulada'.
create or replace function emitir_nota_credito(p_ref_id text, p_tipo_nota int default 1, p_motivo text default 'Anulacion de la operacion')
  returns jsonb language plpgsql security definer set search_path=public, auth, extensions as
$$
declare v_o comprobantes; v_cfg facturacion_config; v_num int; v_body jsonb; v_resp text; v_j jsonb; v_id text; v_estado text; v_pdf text; v_try int; v_errlow text;
begin
  perform _req_admin();
  select * into v_o from comprobantes where id = p_ref_id;
  if not found then raise exception 'NO_EXISTE: comprobante %', p_ref_id; end if;
  if v_o.estado <> 'aceptada' then raise exception 'SOLO_ACEPTADAS: solo se emite NC sobre un comprobante aceptado (estado actual: %)', v_o.estado; end if;
  if v_o.tipo = 3 then raise exception 'NO_NC_DE_NC: no se emite nota de crédito de una nota de crédito'; end if;

  select * into v_cfg from facturacion_config where id=1;
  -- correlativo propio de NC por serie (tipo 3), NubeFact es la autoridad
  select coalesce(max(numero),0)+1 into v_num from comprobantes where tipo=3 and serie=v_o.serie;

  if not (v_cfg.activo and coalesce(v_cfg.nubefact_ruta,'')<>'' and coalesce(v_cfg.nubefact_token,'')<>'') then
    insert into comprobantes(tipo,serie,numero,moneda,cliente_doc_tipo,cliente_doc,cliente_nombre,
        total_gravada,total_exonerada,total_inafecta,total_igv,total,items,estado,enlace_pdf,qr,
        doc_modifica_tipo,doc_modifica_serie,doc_modifica_numero,errores,origen)
      values(3,v_o.serie,v_num,v_o.moneda,v_o.cliente_doc_tipo,v_o.cliente_doc,v_o.cliente_nombre,
        v_o.total_gravada,v_o.total_exonerada,coalesce(v_o.total_inafecta,0),v_o.total_igv,v_o.total,v_o.items,'stub','(demo) NC',
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
      'total_igv', v_o.total_igv, 'total', v_o.total,
      'observaciones', coalesce(p_motivo,'Anulacion'),
      'enviar_automaticamente_a_la_sunat', true,
      'items', _nf_items(v_o.items, coalesce(v_o.exonerado,false), coalesce(v_o.es_exportacion,false)));
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
      total_gravada,total_exonerada,total_inafecta,total_igv,total,items,estado,enlace_pdf,enlace_xml,enlace_cdr,qr,hash,
      aceptada_por_sunat,sunat_descripcion,nf_respuesta,doc_modifica_tipo,doc_modifica_serie,doc_modifica_numero,errores,origen)
    values(3,v_o.serie,v_num,v_o.moneda,v_o.cliente_doc_tipo,v_o.cliente_doc,v_o.cliente_nombre,
      v_o.total_gravada,v_o.total_exonerada,coalesce(v_o.total_inafecta,0),v_o.total_igv,v_o.total,v_o.items,'aceptada',
      v_pdf,v_j->>'enlace_del_xml',v_j->>'enlace_del_cdr',v_j->>'cadena_para_codigo_qr',v_j->>'codigo_hash',
      true,v_j->>'sunat_description',v_j,v_o.tipo,v_o.serie,v_o.numero,coalesce(p_motivo,'NC'),'panel')
    returning id into v_id;

  if p_tipo_nota = 1 then update comprobantes set estado='anulada', anulacion_estado='aprobada' where id=p_ref_id; end if;
  return jsonb_build_object('ok',true,'id',v_id,'serie',v_o.serie,'numero',v_num,'estado','aceptada','pdf',v_pdf);
end $$;
grant execute on function emitir_nota_credito(text,int,text) to authenticated;
