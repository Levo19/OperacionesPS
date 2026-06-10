-- ============================================================
-- RLS · seguro por defecto. (Aplicado en la base 2026-06-09.)
-- Con RLS activado y SIN políticas, el rol anon/authenticated NO ve nada
-- (deny-all) → la base queda cerrada hasta montar auth-PIN + políticas por rol.
-- El rol postgres (backfill/admin) ignora RLS.
-- ============================================================
alter table personal       enable row level security;
alter table embarcaciones  enable row level security;
alter table contactos      enable row level security;
alter table impuestos      enable row level security;
alter table operaciones    enable row level security;
alter table movimientos    enable row level security;
alter table caja_operador  enable row level security;
alter table reservas       enable row level security;
alter table app_usuarios   enable row level security;

-- Vistas con security_invoker → respetan la RLS de las tablas base
-- (sin esto, una vista (owner=postgres) FUGA datos saltándose la RLS).
alter view v_balance_agencias set (security_invoker = true);
alter view v_balance_aliados  set (security_invoker = true);
alter view v_caja_items       set (security_invoker = true);

-- TODO (fase auth-PIN):
--   · helper mi_rol() desde el JWT (auth.uid() -> app_usuarios.rol)
--   · policies: SELECT para authenticated; write por rol (Operador registra, Admin anula)
--   · registrar_movimiento(...) -> SECURITY DEFINER para insertar bajo RLS limitada
