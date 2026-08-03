-- Lookup APISPeru: URLs default + token por query (2026-08-03) — generado del vivo + parche
CREATE OR REPLACE FUNCTION public.consultar_documento(p_numero text, p_tipo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare v_url text; v_tok text; v_resp text; v_j jsonb; v_n text; v_tipo text;
begin
  perform _req_staff();
  v_n := regexp_replace(coalesce(p_numero,''), '\D', '', 'g');
  v_tipo := coalesce(nullif(p_tipo,''), case when length(v_n)=8 then '1' when length(v_n)=11 then '6' else '' end);
  if v_tipo not in ('1','6') then return jsonb_build_object('ok',false,'motivo','manual','doc_tipo',v_tipo,'doc_numero',v_n); end if;
  select lookup_token, case when v_tipo='1' then coalesce(lookup_url_dni, lookup_url) else coalesce(lookup_url_ruc, lookup_url) end
    into v_tok, v_url from facturacion_config where id=1;
  if coalesce(v_url,'')='' or coalesce(v_tok,'')='' then return jsonb_build_object('ok',false,'motivo','sin_config','doc_tipo',v_tipo,'doc_numero',v_n); end if;
  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT','12');
    select content into v_resp from http(('GET', v_url||v_n||case when position('?' in v_url)>0 then '&' else '?' end||'token='||v_tok, array[http_header('Authorization','Bearer '||v_tok)], NULL, NULL)::http_request);
    v_j := v_resp::jsonb;
    return jsonb_build_object('ok',true,'doc_tipo',v_tipo,'doc_numero',v_n,
      'nombre', coalesce(v_j->>'razonSocial', v_j->>'nombre',
                 nullif(trim(coalesce(v_j->>'nombres','')||' '||coalesce(v_j->>'apellidoPaterno','')||' '||coalesce(v_j->>'apellidoMaterno','')),'')),
      'direccion', coalesce(v_j->>'direccion',''));
  exception when others then return jsonb_build_object('ok',false,'motivo','no_encontrado','doc_tipo',v_tipo,'doc_numero',v_n); end;
end $function$
;
