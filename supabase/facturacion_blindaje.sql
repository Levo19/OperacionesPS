-- ============================================================
-- OperacionesPS · Facturación — BLINDAJE (Fase A, 2026-07-03)
-- ------------------------------------------------------------
-- Cierra los blockers de la auditoría 100x ANTES de emitir en real:
--   B1  RLS deny-all en servicios/clientes/series/comprobantes (PII + protege el correlativo).
--   B4  get_facturacion_config recupera serie_boleta/serie_factura (regresión).
--   B5  columnas defensivas (cliente_tel, hash, total_inafecta, auth_header).
--   §4  emitir_comprobante con validaciones SUNAT server-side + default GRAVADO 18%
--       + guard CORRELATIVO_DESYNC + duplicado→pendiente + timeouts alineados
--       + header de auth configurable (auth_header) + medio de pago (bancarización).
--   §4b reconciliar_comprobantes(dias) + pg_cron (confirma aceptación asíncrona SUNAT).
-- NO cambia el comportamiento inerte: con facturacion_config.activo=false sigue en STUB.
-- Seguro de re-ejecutar. Aplicar DESPUÉS de base/real/series/correlativo/ux.
-- ============================================================

-- ── B1 · RLS deny-all en las 4 tablas de facturación ──────────────────────────
-- Todo el acceso es por RPCs security-definer (owner=postgres, ignoran RLS), así que
-- activar RLS sin policies cierra la lectura/escritura directa por PostgREST (anon key)
-- sin romper nada. Esto protege PII (clientes/comprobantes) y evita que alguien haga
-- UPDATE series.correlativo saltándose el lock (el único vector que rompía el nº único).
alter table servicios    enable row level security;
alter table clientes     enable row level security;
alter table series       enable row level security;
alter table comprobantes enable row level security;

-- ── B5 · columnas defensivas (idempotente) ────────────────────────────────────
alter table comprobantes      add column if not exists cliente_tel     text;
alter table comprobantes      add column if not exists hash            text;
alter table comprobantes      add column if not exists total_inafecta  numeric(10,2) default 0;  -- Fase 2 (tasas SERNANP separadas)
alter table comprobantes      add column if not exists medio_pago      text;
alter table facturacion_config add column if not exists auth_header    text default '{token}';   -- plantilla header; {token} = token crudo (formato oficial NubeFact)
update facturacion_config set auth_header = coalesce(auth_header,'{token}') where id=1;

-- ── CPE = fuente de verdad completa (estado NubeFact vs SUNAT + todo para reimprimir) ──
-- estado (ciclo local): stub|pendiente|aceptada|rechazada|anulada
-- aceptada_por_sunat: estado SUNAT explícito (separado del ciclo local)
alter table comprobantes add column if not exists aceptada_por_sunat boolean;
alter table comprobantes add column if not exists enlace_cdr         text;    -- CDR = Constancia de Recepción SUNAT
alter table comprobantes add column if not exists codigo_barras      text;    -- PDF417 (representación impresa)
alter table comprobantes add column if not exists sunat_responsecode text;
alter table comprobantes add column if not exists sunat_soap_error   text;    -- error de conectividad a SUNAT (≠ rechazo)
alter table comprobantes add column if not exists nf_respuesta       jsonb;   -- respuesta COMPLETA de NubeFact: nada se pierde (pdf/xml/cdr/qr/hash/barcode/códigos SUNAT); reimprimir/auditar sin tocar esquema
-- Notas de crédito/débito (Fase 2): a qué doc modifican
alter table comprobantes add column if not exists doc_modifica_tipo   int;
alter table comprobantes add column if not exists doc_modifica_serie  text;
alter table comprobantes add column if not exists doc_modifica_numero int;

-- ── MODO EXPORTACIÓN (turismo receptivo, 0% IGV) ──
alter table comprobantes      add column if not exists total_exportacion numeric(10,2) default 0;
alter table comprobantes      add column if not exists es_exportacion    boolean default false;
-- flag: la empresa está inscrita como operador turístico (MINCETUR + Registro Especial SUNAT + DICAPI).
-- Dado por hecho por el dueño (2026-07-03) → ON. Si caduca alguna inscripción, poner en false = todo vuelve a 18%.
alter table facturacion_config add column if not exists operador_turistico_registrado boolean default false;
update facturacion_config set operador_turistico_registrado = true where id = 1;
-- Detracción (SPOT) — facturas B2B
alter table comprobantes add column if not exists detraccion       boolean default false;
alter table comprobantes add column if not exists detraccion_total numeric(12,2) default 0;

-- ── B4 · get_facturacion_config con series (definición FINAL, gana a las previas) ─
create or replace function get_facturacion_config()
  returns jsonb language sql stable security definer set search_path=public, auth as
$$ select jsonb_build_object(
     'tiene_nubefact', coalesce(nubefact_ruta,'') <> '' and coalesce(nubefact_token,'') <> '',
     'tiene_lookup',     coalesce(lookup_url,'') <> '' or coalesce(lookup_url_dni,'') <> '' or coalesce(lookup_url_ruc,'') <> '',
     'tiene_lookup_tok', coalesce(lookup_token,'') <> '',
     'modo', modo, 'activo', activo,
     'serie_boleta', serie_boleta, 'serie_factura', serie_factura,
     'series', (select coalesce(jsonb_object_agg(serie, correlativo), '{}'::jsonb) from series)
   ) from facturacion_config where id=1 $$;
grant execute on function get_facturacion_config() to authenticated;

-- ── _nf_items: líneas NubeFact según afectación (gravado=1 / exonerado=8 / exportación=16) ──
drop function if exists _nf_items(jsonb, boolean);
create or replace function _nf_items(p_items jsonb, p_exonerado boolean, p_exportacion boolean default false)
  returns jsonb language sql immutable as
$$
  -- afectación POR ÍTEM: cada ítem puede traer "afectacion" (gravado/inafecto/exonerado/exportacion);
  -- si no la trae, usa el modo global (export/exon/gravado) = comportamiento anterior. Tasas SERNANP → 'inafecto'.
  select coalesce(jsonb_agg(jsonb_build_object(
    'unidad_de_medida','ZZ','codigo','S','descripcion', descripcion,
    'cantidad', cant, 'valor_unitario', vu, 'precio_unitario', precio, 'subtotal', sub,
    'tipo_de_igv', case af when 'inafecto' then 9 when 'exonerado' then 8 when 'exportacion' then 16 else 1 end,
    'igv', igvl, 'total', sub + igvl
  )),'[]'::jsonb)
  from (
    select descripcion, cant, precio, af, vu, sub, case when af='gravado' then round(sub*0.18,2) else 0 end igvl from (
      select descripcion, cant, precio, af, vu, round(vu*cant,2) sub from (
        select i->>'descripcion' descripcion, (i->>'cantidad')::numeric cant, (i->>'precio')::numeric precio,
               coalesce(nullif(i->>'afectacion',''), case when p_exportacion then 'exportacion' when p_exonerado then 'exonerado' else 'gravado' end) af,
               case when coalesce(nullif(i->>'afectacion',''), case when p_exportacion then 'exportacion' when p_exonerado then 'exonerado' else 'gravado' end)='gravado'
                    then round((i->>'precio')::numeric/1.18,2) else (i->>'precio')::numeric end vu
        from jsonb_array_elements(p_items) i
      ) a
    ) b
  ) c
$$;

-- ── §4 · EMITIR con validaciones SUNAT + guards + modo EXPORTACIÓN. DROP de signatures viejos primero. ──
drop function if exists emitir_comprobante(int,text,text,text,text,text,jsonb,boolean,text,text,text,text,text,text,text,boolean);
drop function if exists emitir_comprobante(int,text,text,text,text,text,jsonb,boolean,text,text,text,text,text,text,text,boolean,text);
drop function if exists emitir_comprobante(int,text,text,text,text,text,jsonb,boolean,text,text,text,text,text,text,text,boolean,text,boolean);

create or replace function emitir_comprobante(
    p_tipo int, p_serie text,
    p_cliente_doc_tipo text, p_cliente_doc text, p_cliente_nombre text, p_cliente_email text,
    p_items jsonb, p_exonerado boolean default false, p_moneda text default 'PEN',
    p_origen text default 'panel', p_operacion_ref text default null,
    p_creado_por text default null, p_local_id text default null,
    p_cliente_tel text default null, p_cliente_dir text default null, p_es_extranjero boolean default false,
    p_medio_pago text default null, p_exportacion boolean default false, p_detraccion boolean default false)
  returns jsonb language plpgsql security definer set search_path=public, auth, extensions as
$$
declare v_num int; v_id text; v_existing comprobantes; v_total numeric; v_grav numeric; v_igv numeric; v_exo numeric;
        v_cfg facturacion_config; v_body jsonb; v_resp text; v_j jsonb; v_estado text; v_pdf text; v_qr text; v_xml text;
        v_err text; v_hash text; v_real boolean; v_errlow text; v_obs text; v_doc text; v_export numeric; v_inaf numeric; v_detr numeric;
begin
  perform _req_staff();
  if p_origen = 'muelle' and not coalesce((select facturacion_muelle from app_config where app_id='operacionesps'), false) then
    raise exception 'FACTURACION_OFF: el admin no habilitó la facturación en el muelle';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS: se requiere al menos un servicio';
  end if;

  -- lock de la serie HASTA fin de tx: serializa numeración + la llamada a NubeFact
  perform 1 from series where serie = p_serie for update;
  if not found then raise exception 'SERIE: % no existe', p_serie; end if;

  -- idempotencia (dentro del lock): reintento del MISMO intento → devuelve lo ya emitido
  if p_local_id is not null then
    select * into v_existing from comprobantes where local_id = p_local_id;
    if found then return jsonb_build_object('id',v_existing.id,'serie',v_existing.serie,'numero',v_existing.numero,
      'estado',v_existing.estado,'total',v_existing.total,'pdf',v_existing.enlace_pdf,'qr',v_existing.qr,'reusado',true); end if;
  end if;

  -- total (derivado de los ítems → base imponible no manipulable por el cliente)
  select coalesce(sum((i->>'cantidad')::numeric * (i->>'precio')::numeric), 0) into v_total from jsonb_array_elements(p_items) i;

  -- ── VALIDACIONES SUNAT (server-side, misma verdad para panel y muelle) ──
  v_doc := coalesce(nullif(p_cliente_doc,''),'');
  if p_exportacion then  -- EXPORTACIÓN (turismo receptivo, 0% IGV)
    if not coalesce((select operador_turistico_registrado from facturacion_config where id=1), false) then
      raise exception 'EXPORTACION_NO_HABILITADA: la empresa no está marcada como operador turístico registrado'; end if;
    if p_tipo <> 1 then raise exception 'EXPORTACION_REQUIERE_FACTURA: la exportación se emite como factura'; end if;
    if coalesce(p_cliente_doc_tipo,'') <> '7' or v_doc = '' then
      raise exception 'EXPORTACION_REQUIERE_PASAPORTE: el cliente debe ser no domiciliado con PASAPORTE (no CE/DNI/varios)'; end if;
    if coalesce(trim(p_cliente_nombre),'') = '' then raise exception 'EXPORTACION_REQUIERE_NOMBRE: falta el nombre del turista'; end if;
    if jsonb_array_length(p_items) < 2 then raise exception 'EXPORTACION_REQUIERE_PAQUETE: el paquete exige 2+ servicios (transporte + guía)'; end if;
  elsif p_tipo = 1 then  -- FACTURA nacional
    if coalesce(p_cliente_doc_tipo,'') <> '6' or v_doc !~ '^\d{11}$' then
      raise exception 'FACTURA_REQUIERE_RUC: una factura exige RUC de 11 dígitos'; end if;
    if coalesce(trim(p_cliente_nombre),'') = '' then raise exception 'FACTURA_REQUIERE_NOMBRE: falta la razón social'; end if;
    if coalesce(trim(p_cliente_dir),'') = ''   then raise exception 'FACTURA_REQUIERE_DIRECCION: falta la dirección fiscal'; end if;
  elsif p_tipo = 2 and v_total > 700 then  -- BOLETA > S/700
    if coalesce(p_cliente_doc_tipo,'0') = '0' or v_doc = '' then
      raise exception 'BOLETA_MAYOR_700_REQUIERE_ID: boleta > S/700 debe identificar al cliente (DNI/CE/pasaporte)'; end if;
    if coalesce(trim(p_cliente_nombre),'') = '' then raise exception 'BOLETA_MAYOR_700_REQUIERE_NOMBRE: falta el nombre del cliente'; end if;
  end if;
  if v_total >= 2000 and not p_exportacion and coalesce(trim(p_medio_pago),'') = '' then  -- Bancarización Ley 28194 (no aplica a exportación)
    raise exception 'REQUIERE_MEDIO_DE_PAGO: operación >= S/2000 exige indicar el medio de pago (bancarización)'; end if;

  -- Buckets por afectación de CADA ítem (default global; ítem puede traer "afectacion"). Σbuckets == total exacto.
  -- v_inaf incluye inafecto + exportación (NubeFact usa total_inafecta como bucket de exportación).
  select
    coalesce(sum(case when af='gravado' then sub else 0 end),0),
    coalesce(sum(case when af='gravado' then igvl else 0 end),0),
    coalesce(sum(case when af in ('inafecto','exportacion') then sub else 0 end),0),
    coalesce(sum(case when af='exonerado' then sub else 0 end),0),
    coalesce(sum(case when af='exportacion' then sub else 0 end),0),
    coalesce(sum(sub+igvl),0)
  into v_grav, v_igv, v_inaf, v_exo, v_export, v_total
  from (
    select af, sub, case when af='gravado' then round(sub*0.18,2) else 0 end igvl from (
      select af, round(vu*cant,2) sub from (
        select (i->>'cantidad')::numeric cant,
               coalesce(nullif(i->>'afectacion',''), case when p_exportacion then 'exportacion' when p_exonerado then 'exonerado' else 'gravado' end) af,
               case when coalesce(nullif(i->>'afectacion',''), case when p_exportacion then 'exportacion' when p_exonerado then 'exonerado' else 'gravado' end)='gravado'
                    then round((i->>'precio')::numeric/1.18,2) else (i->>'precio')::numeric end vu
        from jsonb_array_elements(p_items) i
      ) a
    ) b
  ) c;

  -- Detracción (SPOT) 12% cód.037 — solo facturas B2B > S/700
  if p_detraccion and not (p_tipo = 1 and v_total > 700) then
    raise exception 'DETRACCION_SOLO_FACTURA_B2B: la detracción aplica a facturas > S/700'; end if;
  v_detr := case when p_detraccion then round(v_total*0.12,2) else 0 end;

  -- PEEK del siguiente número (NO se avanza todavía)
  select correlativo + 1 into v_num from series where serie = p_serie;

  select * into v_cfg from facturacion_config where id=1;
  v_real := v_cfg.activo and coalesce(v_cfg.nubefact_ruta,'') <> '' and coalesce(v_cfg.nubefact_token,'') <> '';
  v_estado := 'stub'; v_pdf := '(demo) PDF pendiente NubeFact'; v_qr := '(demo)'; v_xml := null; v_err := null; v_hash := null;
  v_obs := case when coalesce(trim(p_medio_pago),'') <> '' then 'Medio de pago: '||p_medio_pago else null end;

  -- ── modo REAL: NubeFact es la autoridad del número ──
  if v_real then
    v_body := jsonb_build_object(
      'operacion','generar_comprobante',
      'tipo_de_comprobante', p_tipo, 'serie', p_serie, 'numero', v_num,
      'sunat_transaction', case when p_detraccion then 30 when p_exportacion then 2 else 1 end,
      -- exportación: SUNAT cat.06 exige '0' (NO DOMICILIADO SIN RUC); el pasaporte del turista va en el número
      'cliente_tipo_de_documento', case when p_exportacion then '0' else coalesce(nullif(p_cliente_doc_tipo,''),'0') end,
      'cliente_numero_de_documento', coalesce(nullif(p_cliente_doc,''),'00000000'),
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
      exonerado,es_exportacion,total_gravada,total_exonerada,total_exportacion,total_inafecta,total_igv,total,items,estado,enlace_pdf,enlace_xml,enlace_cdr,qr,hash,codigo_barras,medio_pago,detraccion,detraccion_total,
      aceptada_por_sunat,sunat_descripcion,sunat_responsecode,sunat_soap_error,nf_respuesta,errores,local_id,origen,operacion_ref,creado_por)
    values(p_tipo,p_serie,v_num,coalesce(p_moneda,'PEN'),nullif(p_cliente_doc_tipo,''),nullif(p_cliente_doc,''),
      p_cliente_nombre,nullif(p_cliente_email,''),nullif(p_cliente_tel,''),coalesce(p_exonerado,false),coalesce(p_exportacion,false),v_grav,v_exo,v_export,v_inaf,v_igv,v_total,p_items,
      v_estado,v_pdf,v_xml,(v_j->>'enlace_del_cdr'),v_qr,v_hash,(v_j->>'codigo_de_barras'),nullif(p_medio_pago,''),coalesce(p_detraccion,false),v_detr,
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
end $$;
grant execute on function emitir_comprobante(int,text,text,text,text,text,jsonb,boolean,text,text,text,text,text,text,text,boolean,text,boolean,boolean) to authenticated;

-- ── §4b · RECONCILIACIÓN: confirma la aceptación asíncrona de SUNAT ────────────
-- Recorre comprobantes 'pendiente'/'rechazada' recientes y los consulta en NubeFact.
-- SIN gate _req_staff: la corre pg_cron (sin JWT). No toca 'aceptada'/'anulada' (terminales).
create or replace function reconciliar_comprobantes(p_dias int default 3)
  returns jsonb language plpgsql security definer set search_path=public, auth, extensions as
$$
declare v_cfg facturacion_config; r record; v_body jsonb; v_resp text; v_j jsonb; v_ok int := 0; v_n int := 0;
begin
  select * into v_cfg from facturacion_config where id=1;
  if not (v_cfg.activo and coalesce(v_cfg.nubefact_ruta,'')<>'') then return jsonb_build_object('ok',true,'skip','inactivo'); end if;
  for r in select * from comprobantes
             where estado in ('pendiente','rechazada')
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
      if coalesce((v_j->>'aceptada_por_sunat')::boolean,false) or coalesce(v_j->>'enlace_del_pdf','')<>'' then
        update comprobantes set estado='aceptada', aceptada_por_sunat=true,
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
end $$;
grant execute on function reconciliar_comprobantes(int) to authenticated;

-- pg_cron (guardado: no falla si la extensión no está disponible en este proyecto)
do $cron$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    begin perform cron.unschedule('ps-fac-reconciliar'); exception when others then null; end;
    perform cron.schedule('ps-fac-reconciliar','13 * * * *','select reconciliar_comprobantes(3);');
  end if;
end
$cron$;
