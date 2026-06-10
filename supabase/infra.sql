-- ============================================================
-- RLS policies + pg_cron + Storage  (camino B)
-- Modelo: LECTURAS directas gateadas por es_staff(); ESCRITURAS solo via
-- los RPCs SECURITY DEFINER (no hay policy de write → deny directo).
-- ============================================================

-- ── SELECT para staff autenticado en todas las tablas de datos ──
do $$ declare t text; begin
  foreach t in array array['personal','embarcaciones','contactos','impuestos','operaciones','movimientos','caja_operador','reservas'] loop
    execute format('drop policy if exists sel_staff on %I', t);
    execute format('create policy sel_staff on %I for select to authenticated using (es_staff())', t);
  end loop;
end $$;

-- app_usuarios: cada quien ve su propia fila; el Administrador ve todas
drop policy if exists au_self on app_usuarios;
create policy au_self on app_usuarios for select to authenticated
  using (auth_uid = auth.uid() or mi_rol() = 'Administrador');

-- ── pg_cron: auto-cierre 20:00 Lima (= 01:00 UTC) ──
-- NOTA: correr estas 3 sentencias por separado (no en el mismo lote que el DO block).
create extension if not exists pg_cron;
select cron.unschedule('auto-cierre-ps') from cron.job where jobname='auto-cierre-ps';
select cron.schedule('auto-cierre-ps', '0 1 * * *', 'select auto_cerrar_ops()');

-- ── Storage: bucket de fotos (zarpes, comprobantes) ──
insert into storage.buckets (id, name, public)
  values ('operaciones','operaciones', true)
  on conflict (id) do nothing;

-- subir/leer fotos: solo staff autenticado puede escribir; lectura pública
drop policy if exists op_storage_write on storage.objects;
create policy op_storage_write on storage.objects for insert to authenticated
  with check (bucket_id = 'operaciones' and es_staff());
drop policy if exists op_storage_read on storage.objects;
create policy op_storage_read on storage.objects for select
  using (bucket_id = 'operaciones');
