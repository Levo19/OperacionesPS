-- ============================================================
-- editar_operacion FULL (2026-08-01) — pedido Luis (PS Panel admin)
-- Antes solo capitán/guía/hora: el panel dejaba "editar" destino, fecha,
-- estado y embarcación pero el RPC los ignoraba → el cambio se revertía
-- al refrescar ("no deja"). Ahora soporta TODO el set del modal:
--   staff : capitán, guía, hora, bote, destino
--   admin : + fecha, + estado (Abierta/En_Viaje/Cerrada/Cancelada)
-- Se DROPea la firma vieja (4 args) — dejar ambas crearía ambigüedad de
-- overload en PostgREST. Las llamadas viejas con 4 args nombrados caen
-- en esta misma función (el resto toma defaults) → OPS sigue intacto.
-- Propagación: OPS jala get_dashboard cada 10s y el panel refresca la
-- fecha visible — mismo origen de datos, sin sync aparte.
-- ============================================================

drop function if exists editar_operacion(text, text, text, text);

create or replace function editar_operacion(
    p_op text, p_capitan text default null, p_guia text default null, p_hora text default null,
    p_bote text default null, p_destino text default null, p_fecha date default null, p_estado text default null)
  returns void language plpgsql security definer set search_path=public as
$$
begin
  perform _req_staff();
  if coalesce(p_bote,'') <> '' and not exists (select 1 from embarcaciones where id = p_bote) then
    raise exception 'BOTE_INVALIDO: embarcación % no existe', p_bote;
  end if;
  if (p_fecha is not null or coalesce(p_estado,'') <> '') and not es_admin() then
    raise exception 'SOLO_ADMIN: cambiar fecha o estado requiere administrador';
  end if;
  if coalesce(p_estado,'') <> '' and p_estado not in ('Abierta','En_Viaje','Cerrada','Cancelada') then
    raise exception 'ESTADO_INVALIDO: %', p_estado;
  end if;
  update operaciones set
    capitan_id  = coalesce(p_capitan, capitan_id),
    guia_id     = coalesce(p_guia, guia_id),
    hora_salida = coalesce(nullif(p_hora,''), hora_salida),
    bote_id     = coalesce(nullif(p_bote,''), bote_id),
    destino     = coalesce(nullif(p_destino,''), destino),
    fecha       = coalesce(p_fecha, fecha),
    estado      = coalesce(nullif(p_estado,''), estado)
   where id = p_op;
  if not found then raise exception 'NO_EXISTE: operación %', p_op; end if;
end $$;
grant execute on function editar_operacion(text,text,text,text,text,text,date,text) to authenticated;
