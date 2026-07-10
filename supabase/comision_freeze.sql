-- ============================================================
-- Congelar la comisión del comisionado al EMBARCAR (2026-07-10, decisión del dueño).
-- Antes: el panel recalculaba comisión = cobrado − (precio_defecto_VIVO × pax) → si cambiaba
-- la tarifa del catálogo, la comisión de movimientos cerrados cambiaba retroactivamente.
-- Ahora: se congela la tarifa en el movimiento (tarifa_base) al insertar; el panel/KPIs la usan.
-- Aplicado en vivo; este archivo es el registro del repo. (get_dashboard/get_lanchas_dia/get_kpis_ops
-- proyectan/usan tarifa_base — ver get_kpis_ops.sql; las proyecciones se parchearon en vivo.)
-- ============================================================

alter table movimientos add column if not exists tarifa_base numeric;

-- Backfill: comisionados existentes congelan a la tarifa actual (best-effort).
update movimientos m set tarifa_base = co.precio_defecto
  from contactos co
 where co.id = m.contacto_id and m.tipo = 'Comisionado' and m.tarifa_base is null;

-- Trigger: al INSERTAR un movimiento Comisionado, congela la tarifa del contacto en ese momento.
create or replace function _tg_freeze_tarifa() returns trigger language plpgsql as
$$
begin
  if new.tipo = 'Comisionado' and new.tarifa_base is null and new.contacto_id is not null then
    new.tarifa_base := (select precio_defecto from contactos where id = new.contacto_id);
  end if;
  return new;
end $$;

drop trigger if exists tg_freeze_tarifa on movimientos;
create trigger tg_freeze_tarifa before insert on movimientos
  for each row execute function _tg_freeze_tarifa();

-- Proyecciones (aplicadas en vivo):
--   get_dashboard.manifiesto     += 'tarifa_base', m.tarifa_base
--   get_lanchas_dia.movimientos  += 'tarifa_base', coalesce(m.tarifa_base, m.pdef, 0)
--   get_kpis_ops: pdef := coalesce(m.tarifa_base, c.precio_defecto, 0)  (ver get_kpis_ops.sql)
