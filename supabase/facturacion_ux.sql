-- ============================================================
-- OperacionesPS · Facturación UX — buscador de contactos, lookup por longitud,
-- anulación con aprobación de PS, historial del día, precio por defecto.
-- Seguro de re-ejecutar.
-- ============================================================

-- ── 1) BUSCADOR de contactos frecuentes (por nombre o documento parcial) ──
create or replace function buscar_contactos_fac(p_q text)
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$
declare v jsonb; q text;
begin
  perform _req_staff();
  q := trim(coalesce(p_q,''));
  if length(q) < 2 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.veces desc), '[]'::jsonb) into v from (
    select doc_tipo, doc_numero, nombre, email, telefono, direccion, es_extranjero, veces
    from clientes
    where nombre ilike '%'||q||'%' or doc_numero like q||'%'
    order by veces desc, nombre limit 8
  ) x;
  return v;
end $$;
grant execute on function buscar_contactos_fac(text) to authenticated;

-- ── 2) LOOKUP RUC/DNI auto por longitud (8=DNI/RENIEC · 11=RUC/SUNAT) ──
alter table facturacion_config add column if not exists lookup_url_dni text;
alter table facturacion_config add column if not exists lookup_url_ruc text;

drop function if exists consultar_documento(text, text);
create or replace function consultar_documento(p_numero text, p_tipo text default null)
  returns jsonb language plpgsql security definer set search_path=public, auth, extensions as
$$
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
    select content into v_resp from http(('GET', v_url||v_n, array[http_header('Authorization','Bearer '||v_tok)], NULL, NULL)::http_request);
    v_j := v_resp::jsonb;
    return jsonb_build_object('ok',true,'doc_tipo',v_tipo,'doc_numero',v_n,
      'nombre', coalesce(v_j->>'razonSocial', v_j->>'nombre',
                 nullif(trim(coalesce(v_j->>'nombres','')||' '||coalesce(v_j->>'apellidoPaterno','')||' '||coalesce(v_j->>'apellidoMaterno','')),'')),
      'direccion', coalesce(v_j->>'direccion',''));
  exception when others then return jsonb_build_object('ok',false,'motivo','no_encontrado','doc_tipo',v_tipo,'doc_numero',v_n); end;
end $$;
grant execute on function consultar_documento(text,text) to authenticated;

-- ── 3) ANULACIÓN con aprobación de PS (el operador SOLICITA, el admin RESUELVE) ──
alter table comprobantes add column if not exists anulacion_estado text;  -- solicitada | rechazada | aprobada
alter table comprobantes add column if not exists anulacion_motivo text;
alter table comprobantes add column if not exists anulacion_por    text;
alter table comprobantes add column if not exists anulacion_at     timestamptz;
alter table comprobantes add column if not exists anulacion_nota   text;   -- nota del admin

-- operador solicita (NO toca SUNAT)
create or replace function solicitar_anulacion(p_id text, p_motivo text, p_por text default null)
  returns jsonb language plpgsql security definer set search_path=public, auth as
$$ declare v comprobantes; begin
  perform _req_staff();
  select * into v from comprobantes where id=p_id for update;
  if not found then raise exception 'NO_EXISTE: comprobante %', p_id; end if;
  if v.estado='anulada' then return jsonb_build_object('ok',true,'ya',true); end if;
  if coalesce(v.anulacion_estado,'')='solicitada' then return jsonb_build_object('ok',true,'pendiente',true); end if;
  update comprobantes set anulacion_estado='solicitada', anulacion_motivo=coalesce(nullif(trim(p_motivo),''),'(sin motivo)'),
    anulacion_por=p_por, anulacion_at=now(), anulacion_nota=null where id=p_id;
  return jsonb_build_object('ok',true,'solicitada',true);
end $$;
grant execute on function solicitar_anulacion(text,text,text) to authenticated;

-- admin lista solicitudes pendientes (para el panel PS)
create or replace function listar_solicitudes_anulacion()
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$ declare v jsonb; begin
  perform _req_admin();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.anulacion_at desc), '[]'::jsonb) into v from (
    select id, tipo, serie, numero, cliente_nombre, cliente_doc, total, estado, enlace_pdf,
      anulacion_motivo, anulacion_por, anulacion_at,
      to_char(anulacion_at at time zone 'America/Lima','YYYY-MM-DD HH24:MI') solicitada
    from comprobantes where anulacion_estado='solicitada') x;
  return v;
end $$;
grant execute on function listar_solicitudes_anulacion() to authenticated;

-- admin resuelve: aprobar → anula (NubeFact si activo) ; rechazar → queda válido
create or replace function resolver_anulacion(p_id text, p_aprobar boolean, p_nota text default null)
  returns jsonb language plpgsql security definer set search_path=public, auth, extensions as
$$ declare v comprobantes; v_cfg facturacion_config; v_body jsonb; v_resp text; begin
  perform _req_admin();
  select * into v from comprobantes where id=p_id for update;
  if not found then raise exception 'NO_EXISTE: comprobante %', p_id; end if;
  if coalesce(v.anulacion_estado,'') <> 'solicitada' then raise exception 'NO_PENDIENTE: no hay solicitud activa'; end if;
  if not coalesce(p_aprobar,false) then
    update comprobantes set anulacion_estado='rechazada', anulacion_nota=p_nota where id=p_id;
    return jsonb_build_object('ok',true,'aprobado',false);
  end if;
  select * into v_cfg from facturacion_config where id=1;
  if v_cfg.activo and v.estado='aceptada' and coalesce(v_cfg.nubefact_ruta,'') <> '' then
    v_body := jsonb_build_object('operacion','generar_anulacion','tipo_de_comprobante',v.tipo,
      'serie',v.serie,'numero',v.numero,'motivo',coalesce(v.anulacion_motivo,'Anulación'),'codigo_unico','');
    begin perform http_set_curlopt('CURLOPT_TIMEOUT','25');
      select content into v_resp from http(('POST', v_cfg.nubefact_ruta,
        array[http_header('Authorization', v_cfg.nubefact_token)],'application/json', v_body::text)::http_request);
    exception when others then raise exception 'NUBEFACT: no se pudo anular (%)', SQLERRM; end;
  end if;
  update comprobantes set estado='anulada', anulacion_estado='aprobada', anulacion_nota=p_nota where id=p_id;
  return jsonb_build_object('ok',true,'aprobado',true);
end $$;
grant execute on function resolver_anulacion(text,boolean,text) to authenticated;

-- ── 4) HISTORIAL del día por usuario (para el operador en el muelle) ──
create or replace function listar_comprobantes_dia(p_usuario text default null)
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$ declare v jsonb; begin
  perform _req_staff();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.creado_at desc), '[]'::jsonb) into v from (
    select id, tipo, serie, numero, cliente_nombre, cliente_doc, cliente_email, cliente_tel, total, estado,
      enlace_pdf, anulacion_estado, to_char(creado_at at time zone 'America/Lima','HH24:MI') hora, creado_at
    from comprobantes
    where (creado_at at time zone 'America/Lima')::date = (now() at time zone 'America/Lima')::date
      and (p_usuario is null or creado_por = p_usuario)) x;
  return v;
end $$;
grant execute on function listar_comprobantes_dia(text) to authenticated;

-- cliente_tel puede no existir en comprobantes (lo agregamos por si acaso)
alter table comprobantes add column if not exists cliente_tel text;

-- ── 5) BOOTSTRAP del modal muelle: servicios + series + precio por defecto (Varios CON-00) ──
create or replace function get_facturacion_bootstrap()
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$ declare v jsonb; begin
  perform _req_staff();
  select jsonb_build_object(
    'servicios', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'nombre',nombre,'precio',precio_defecto) order by nombre), '[]'::jsonb) from servicios where activo),
    'serie_boleta', (select serie_boleta from facturacion_config where id=1),
    'serie_factura', (select serie_factura from facturacion_config where id=1),
    'precio_defecto', coalesce((select precio_defecto from contactos where id='CON-00'), 30)
  ) into v;
  return v;
end $$;
grant execute on function get_facturacion_bootstrap() to authenticated;
