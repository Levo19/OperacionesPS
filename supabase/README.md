# OperacionesPS → Supabase · artefactos SQL

Migración camino **B** (PWA directo), proyecto Supabase **nuevo** del grupo PS.
Plan completo: `../PLAN_MIGRACION_SUPABASE.md`.

## Estado (validado ejecutando Postgres 18 vía PGlite)
| Artefacto | Qué es | Validado |
|---|---|---|
| `schema.sql` | 9 tablas (personal, embarcaciones, contactos, impuestos, operaciones, movimientos, caja_operador, reservas, app_usuarios) + índices + constraints | ✅ levanta limpio |
| `views.sql` → `v_balance_agencias` | cuenta corriente agencias (S/): facturado − (cobros_mov + abonos), ventas − pago_agencia | ✅ cuadra (310/350/te_debe −40; cancelados excluidos; adicionales jsonb sumado) |
| `views.sql` → `v_balance_aliados` | balance de pases (pax): PaseIn(id_contacto) − PaseOut(contacto_pase) | ✅ cuadra (in 7 / out 3 / neto 4) |
| `views.sql` → `v_caja_items` | feed de caja clasificado ingreso/egreso + label + día TZ Lima | ✅ Cobro/Abono/Pago/Varios `[S]`=egreso |
| `functions.sql` → `registrar_movimiento(...)` | RPC con `FOR UPDATE` que valida aforo atómicamente (mata el LockService) | ✅ overbooking bloqueado |

## ⚠️ Reglas críticas del backfill (cazadas ejecutando)
- **Vacíos → NULL en TODAS las columnas FK** (`operacion_id`, `contacto_id`, `movimiento_id`, `contacto_pase_id`, `agencia_comprada_id`). Un `''` rompe el FK; las vistas usan `coalesce(...,'')` para detectar "sin movimiento" (abono).
- **`tipo` de contacto** normalizado a minúscula/trim (`'Agencia '` → `'agencia'`).
- **`adicionales`** texto `"Muelle:10,Adulto:22"` → `jsonb {muelle:10,adulto:22}`.
- **Cargar en orden de FK**: personal/embarcaciones/contactos → operaciones → movimientos → caja_operador.
- Excluir filas basura (`Creando…`, vacías). Conservar PKs de texto (`CON-/MOV-/OP-`).

## Pendiente (próximas iteraciones)
1. **RLS** por tabla/rol (`rls.sql`) — obligatorio en camino B.
2. **Auth PIN**: usuarios Auth `{id}@paracas.local` + password=PIN; `app_usuarios`/`mi_rol()`; Edge Function set-PIN.
3. **RPCs restantes** (de los 22 writes): abrir/zarpar/cerrar/anular operación, editar/eliminar mov, derivar/anular/convertir pase, caja, reservas. Patrón = `functions.sql`.
4. **pg_cron** para auto-cierre. **Storage** para fotos.
5. **Backfill script** (Node: Sheets API → Postgres) + **cuadre**.
6. **Frontend**: reescribir capa de datos de OperacionesPS (y lecturas de PS Panel) a `supabase-js`.

## Requiere del usuario
Crear el **proyecto Supabase PS** y correr `schema.sql` → `views.sql` → `functions.sql`.
Luego pasar `SUPABASE_URL` + `anon key` (y `service_role` para el backfill/Edge) para cablear frontend y backfill.
