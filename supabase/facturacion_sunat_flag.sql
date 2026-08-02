-- flag SUNAT veraz + reconciliar amplio (2026-08-02) — generado del vivo + parche
CREATE OR REPLACE FUNCTION public.reconciliar_comprobantes(p_dias integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare v_cfg facturacion_config; r record; v_body jsonb; v_resp text; v_j jsonb; v_ok int := 0; v_n int := 0;
begin
  select * into v_cfg from facturacion_config where id=1;
  if not (v_cfg.activo and coalesce(v_cfg.nubefact_ruta,'')<>'') then return jsonb_build_object('ok',true,'skip','inactivo'); end if;
  for r in select * from comprobantes
             where (estado in ('pendiente','rechazada') or (estado='aceptada' and coalesce(aceptada_por_sunat,false)=false))
               and (creado_at at time zone 'America/Lima')::date >= (now() at time zone 'America/Lima')::date - p_dias
  loop
    v_n := v_n + 1;
    v_body := jsonb_build_object('operacion','consultar_comprobante','tipo_de_comprobante',r.tipo,'serie',r.serie,'numero',r.numero);
    begin
      perform http_set_curlopt('CURLOPT_CONNECTTIMEOUT','5');
      perform http_set_curlopt('CURLOPT_TIMEOUT','20');
      select content into v_resp from http(('POST', v_cfg.nubefact_ruta,
        array[http_header('Authorization', replace(coalesce(v_cfg.auth_header,'{token}'),'{token}', v_cfg.nubefact_token))],
        'application/json', v_body::text)::http_request);
      v_j := v_resp::jsonb;
      -- H1: si NubeFact devuelve un documento de cliente distinto al registrado, ese serie+numero pertenece
      -- a OTRO cliente (número reusado tras respuesta perdida) → NO escribir su PDF; marcar para revisión.
      -- Comparación NORMALIZADA (sin guiones/espacios, mayúsculas) y exenta de "varios" (00000000) para
      -- no dar falsos positivos con pasaportes de formato mixto ni con el default de cliente varios.
      if upper(regexp_replace(coalesce(r.cliente_doc,''),'[^A-Za-z0-9]','','g')) not in ('','00000000')
         and coalesce(nullif(v_j->>'cliente_numero_de_documento',''),'') not in ('','00000000')
         and upper(regexp_replace(v_j->>'cliente_numero_de_documento','[^A-Za-z0-9]','','g'))
             <> upper(regexp_replace(r.cliente_doc,'[^A-Za-z0-9]','','g')) then
        update comprobantes set errores='CONFLICTO_IDENTIDAD: NubeFact tiene doc '||(v_j->>'cliente_numero_de_documento')||
          ' en '||r.serie||'-'||r.numero||' pero el registro es de '||r.cliente_doc||' — revisar manualmente' where id=r.id;
        continue;
      end if;
      if coalesce((v_j->>'aceptada_por_sunat')::boolean,false) or coalesce(v_j->>'enlace_del_pdf','')<>'' then
        update comprobantes set estado='aceptada', aceptada_por_sunat=coalesce((v_j->>'aceptada_por_sunat')::boolean,false),
          enlace_pdf=coalesce(nullif(v_j->>'enlace_del_pdf',''),enlace_pdf),
          enlace_xml=coalesce(nullif(v_j->>'enlace_del_xml',''),enlace_xml),
          enlace_cdr=coalesce(nullif(v_j->>'enlace_del_cdr',''),enlace_cdr),
          qr=coalesce(nullif(v_j->>'cadena_para_codigo_qr',''),qr),
          hash=coalesce(nullif(v_j->>'codigo_hash',''),hash),
          codigo_barras=coalesce(nullif(v_j->>'codigo_de_barras',''),codigo_barras),
          sunat_responsecode=coalesce(v_j->>'sunat_responsecode',sunat_responsecode),
          sunat_descripcion=coalesce(v_j->>'sunat_description',sunat_descripcion),
          nf_respuesta=v_j, errores=null
        where id=r.id;
        v_ok := v_ok + 1;
      end if;
    exception when others then null;  -- red caída: reintenta en la próxima corrida
    end;
  end loop;
  return jsonb_build_object('ok',true,'revisados',v_n,'confirmados',v_ok);
end $function$
;

CREATE OR REPLACE FUNCTION public.listar_comprobantes(p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$ declare v jsonb; begin
  perform _req_staff();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.creado_at desc), '[]'::jsonb) into v
  from (select id, tipo, serie, numero, cliente_nombre, cliente_doc, cliente_doc_tipo, moneda,
          exonerado, es_exportacion, medio_pago, forma_pago, credito_vencimiento,
          total_gravada, total_exonerada, total_inafecta, total_exportacion, total_igv, total,
          items, estado, aceptada_por_sunat, enlace_pdf, qr, hash,
          doc_modifica_tipo, doc_modifica_serie, doc_modifica_numero,
          case when tipo=3 then coalesce(anulacion_motivo, errores) else null end nc_motivo,
          to_char(creado_at at time zone 'America/Lima','YYYY-MM-DD HH24:MI') creado, creado_por, creado_at
        from comprobantes
        where (p_desde is null or (creado_at at time zone 'America/Lima')::date >= p_desde)
          and (p_hasta is null or (creado_at at time zone 'America/Lima')::date <= p_hasta)) x;
  return v;
end $function$
;
