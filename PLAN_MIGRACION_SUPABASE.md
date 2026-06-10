# Plan de migración OperacionesPS → Supabase (Camino B, PIN conectado)

> Proyecto **nuevo** de Supabase para el grupo PS (Paracas). Camino **B**: el PWA
> habla directo con Supabase (`supabase-js`), con **PIN conectado a Supabase Auth**
> y **RLS** como única defensa. Empezamos por **OperacionesPS**.
> Revisión senior multironda — cubre las 20 dimensiones para que no se pase nada.

---

## 0. Objetivo, alcance y NO-alcance
- **Objetivo #1:** matar la concurrencia/locks de Sheets (capacidad de lancha, doble registro) con Postgres nativo; sumar realtime y RLS.
- **Alcance (esta migración):** todo el dato de `SS_OPERACIONES_ID` (el "muelle") + auth.
- **NO-alcance ahora:** hotel-pms (`SS_HOTEL_ID`) y la migración del PS Panel a B (se aborda como dependencia, abajo). Se hace después con el mismo patrón.

## 1. ⚠️ Dependencia crítica que NO se puede ignorar
`SS_OPERACIONES_ID` lo **escribe** OperacionesPS y lo **lee** PS Panel (módulos Lanchas/Finanzas/Insights: `getLanchasDia`, `balance_aliados`, `balance_agencias`, `caja_feed`, y **escribe** `registrar_pago`).
→ Migrar "solo OperacionesPS" **rompe PS Panel** si no se atiende.

**Decisión:** el dato es la unidad de migración, no la app. Plan:
- Las funciones de balance del PS Panel (que son lógica pesada en GAS) se vuelven **vistas/RPC SQL** en Supabase (`v_balance_agencias`, `v_balance_aliados`, `v_caja_feed`) — más limpias y rápidas.
- PS Panel pasa a leer Supabase (también camino B en su frontend) **en el mismo cutover**, o vía un proxy GAS→REST temporal si se quiere desacoplar. Recomendado: migrar las lecturas del panel junto con el muelle.

## 2. Inventario actual (de dónde sale el schema)
### Tablas (Sheets) y columnas
| Sheet | Columnas (orden real) |
|---|---|
| **Operaciones** | id · fecha · hora_salida · id_bote · id_capitan · id_guia · estado · creado_por · timestamp_creacion · foto_zarpe_url · Destino |
| **Movimientos** | id_mov · id_operacion · tipo_movimiento · id_contacto · nombreContacto · cant_pax · precio_unitario_aplicado · monto_total_cobrar · adicionales · operador_registro · timestamp_registro · estado_movimiento · Id_contactoPase · id_agencia_comprada · monto_comprado |
| **Caja_Operador** | id_transaccion · id_operacion · id_contacto · categoria · monto · metodo_pago · comentarios · foto_comprobante_url · operador_caja · timestamp · id_movimiento |
| **Contactos** | id_contacto · nombre_comercial · tipo · precio_pax_defecto |
| **Personal** | id_empleado · nombre · rol · tarifa_fija · estado |
| **Embarcaciones** | id_bote · nombre · capacidad_pax · matricula |
| **Reservas_CRM** | id · fecha · hora · tipo · contacto · pax · monto · estado · cliente · … |
| **Impuestos** | idimpuesto · nombre · monto |
| **PERSONAL_MASTER** (SS_PS_ID) | auth/PIN por persona |

### Endpoints (lo que hay que reimplementar)
- **Lectura:** `getDashboardData` (estado completo del día/recientes) · `getPersonal`.
- **Escritura (22):** abrir/editar/zarpar/confirmar_llegada/cerrar/anular_operacion · registrar/editar/eliminar_movimiento_pax · derivar_pase / anular_pase / convertir_pase_a_compra · actualizar_adicionales · registrar/eliminar_transaccion (caja) · nueva_reserva / asignar_reserva / pase_desde_reserva · subir_foto_zarpe · guardar_cierre.
- **Lógica crítica:** `CheckCapacidadDisponible` (anti-overbooking) · `autoCerrarOpsAbiertas` (trigger por hora) · subida de fotos a Drive.

### Estados (→ enums)
- Operación: `Abierta · En_Viaje · Cerrada · Cancelada`.
- Movimiento: `Embarcado · Pasado · Cancelado · "Embarcado (Editado)"`.
- Caja categoría: `Cobro · Pago Agencia · Pagos · Varios · Caja Chica · Retiro a Jefatura`.

### Volumen y concurrencia
- Bajo (~cientos de movimientos/mes). Varios operadores en el muelle a la vez (de ahí los locks). Supabase Free/Pro sobra.

## 3. Schema Postgres destino (normalizado, con reglas como constraints)
```
-- catálogos
personal(id text PK, nombre text, rol text, tarifa_fija numeric, estado text default 'activo')
embarcaciones(id text PK, nombre text, capacidad_pax int, matricula text, activo bool default true)
contactos(id text PK, nombre text, tipo text check (tipo in ('agencia','aliado','comisionado','libre')),
          precio_defecto numeric, activo bool default true)            -- tipo normalizado (sin 'Agencia ' sucio)
impuestos(id text PK, nombre text, monto numeric)

-- operación / manifiesto
operaciones(id text PK, fecha date, hora_salida text, bote_id text references embarcaciones,
            capitan_id text references personal, guia_id text references personal,
            estado text check (estado in ('Abierta','En_Viaje','Cerrada','Cancelada')) default 'Abierta',
            creado_por text, foto_zarpe_url text, destino text, creado_at timestamptz default now())

movimientos(id text PK, operacion_id text references operaciones,           -- NULL/'PASE_DIRECTO' permitido → revisar
            tipo text, contacto_id text references contactos, nombre_contacto text,
            cant_pax int, precio_unit numeric, monto_total numeric, adicionales jsonb,   -- "Muelle:10,Adulto:22" → {muelle:10,...}
            estado text, operador text, registrado_at timestamptz default now(),
            contacto_pase_id text references contactos, agencia_comprada_id text references contactos, monto_comprado numeric)

caja_operador(id text PK, operacion_id text references operaciones,         -- nullable (caja suelta / abono a cuenta)
              contacto_id text references contactos, categoria text, monto numeric,
              metodo_pago text, comentarios text, foto_url text, operador text,
              ts timestamptz default now(), movimiento_id text references movimientos)   -- nullable (abono = sin mov)

reservas(id text PK, fecha date, hora text, tipo text, contacto_id text, pax int, monto numeric,
         estado text, cliente text, creado_at timestamptz default now())

-- auth (ver §5)
app_usuarios(id text PK references personal, auth_uid uuid unique, rol text)
dispositivos(device_id text PK, aprobado bool, persona_id text, ...)        -- sistema de seguridad UUID
```
**Decisiones de tipos:**
- **PKs de texto** se conservan (`CON-09`, `MOV-…`, `OP-…`) → no rompe referencias ni el cruce con PS Panel/MOS. (Regla: ids/codigoBarra siempre texto.)
- **`timestamptz`** para tiempos; el "día Perú" se calcula en **vistas** con `(ts at time zone 'America/Lima')::date` → elimina el `_diaPeru` a mano.
- **`adicionales jsonb`** (hoy texto). Migración parsea `"k:v, k:v"` → `{k:v}`.
- Índices: `movimientos(operacion_id)`, `movimientos(contacto_id)`, `caja_operador(ts)`, `caja_operador(movimiento_id)`, `operaciones(fecha)`, `movimientos(registrado_at)`.

## 4. Reglas de negocio → Postgres (lo que reemplaza a los locks)
| Hoy (GAS) | Mañana (Postgres) |
|---|---|
| `CheckCapacidadDisponible` + LockService | **RPC `registrar_movimiento(...)`** `security definer` que, dentro de una transacción, hace `SELECT … FOR UPDATE` del bote/operación y valida aforo antes de insertar. Atómico, sin overbooking. |
| Estados a mano | `CHECK` constraints + RPC que validan transiciones (Abierta→En_Viaje→Cerrada). |
| `autoCerrarOpsAbiertas` (trigger por hora) | **`pg_cron`** (extensión Supabase) corre `UPDATE operaciones SET estado='Cerrada' …` cada noche. |
| Derivar/convertir pase (varios setValue) | RPC atómicas (`derivar_pase`, `convertir_pase_a_compra`). |
| Balances (getBalance* en GAS) | **Vistas SQL**: `v_balance_agencias`, `v_balance_aliados`, `v_caja_feed` (la lógica que ya cerramos, en SQL). |

## 5. Auth: PIN conectado a Supabase (camino confirmado)
**Modelo:** cada persona = un usuario de **Supabase Auth** con email sintético `"{id}@paracas.local"` y **password = su PIN**.
- Login PWA: el usuario elige su nombre (lista de `personal`) → ingresa PIN → `supabase.auth.signInWithPassword({ email: id+'@paracas.local', password: pin })`.
- El JWT lleva `auth.uid()` → tabla `app_usuarios` mapea uid→persona→**rol** → helper SQL `mi_rol()` para las policies.
- Cambiar PIN (admin) = actualizar el password del auth user vía **Edge Function** (admin API).
- **Seguridad por dispositivo (UUID):** tabla `dispositivos` + policy que exige device aprobado (el device_id viaja en el JWT/claim o se valida en RPC). Espeja tu sistema de seguridad actual.
- Rate-limit de Supabase Auth mitiga fuerza bruta del PIN; el email sintético no es adivinable.

## 6. RLS (la única defensa en camino B — obligatoria)
- **Todas** las tablas con RLS `ENABLE` + `FORCE`.
- Lectura: operador autenticado (rol válido) puede leer operación/manifiesto/caja/contactos.
- Escritura: por rol (ej. solo `Administrador/Supervisor` borra/anula; `Operador` registra). Policies con `mi_rol()`.
- `personal`/`app_usuarios`: lectura mínima (para el login) sin exponer PINs (los PIN viven en `auth.users`, no en tablas con anon).
- Nada de policy `using (true)` en producción.

## 7. Storage (fotos)
- `foto_zarpe_url` y `foto_comprobante_url` hoy van a Google Drive (`UrlFetchApp`/DriveApp).
- → **Supabase Storage** bucket `comprobantes` (privado, con policy). El PWA sube el archivo y guarda el path. Migración: opcional rebajar las URLs de Drive existentes (o dejarlas como históricas y solo lo nuevo a Storage).

## 8. Realtime (reemplaza el polling)
- `getDashboardData` cada N seg → **suscripción** `supabase.channel('muelle').on('postgres_changes', …)` a `operaciones`/`movimientos`/`caja_operador` filtrado por fecha de hoy → el manifiesto se actualiza solo entre operadores. UI optimista se mantiene.

## 9. Reescritura de la capa de datos (OperacionesPS)
- Agregar `supabase-js` por CDN; cliente con anon key + persistencia de sesión.
- Mapear cada `fetchPost(action, payload)` → `supabase.rpc('…')` o `supabase.from('…').insert/update/select`.
- Lecturas → queries/vistas + realtime. Mantener el optimismo (snapshot → patch local → RPC → rollback en error).
- Quitar la dependencia de `GAS_URL`.

## 10. Backfill + cuadre (1 sola vez, idempotente)
1. **Export** de cada Sheet (Sheets API / CSV).
2. **Transform**: normaliza tipo (trim/lower), parsea `adicionales`→jsonb, fechas→date/timestamptz (TZ Lima), descarta filas basura (`Creando…`, vacías), ids como texto.
3. **Load** a Postgres en orden de FKs: personal/embarcaciones/contactos/impuestos → operaciones → movimientos → caja_operador → reservas.
4. **Cuadre**: por tabla, comparar `count(*)`, `sum(monto/pax)`, y spot-checks de filas clave Sheets vs Postgres. **No se flipa hasta que cuadre al 100%.**

## 11. Cutover (con rollback)
```
1. Congelar escrituras del muelle ~20-30 min (aviso a operadores).
2. Backfill delta (lo nuevo desde el último backfill).
3. Cuadre final.
4. Flip: deploy del OperacionesPS + PS Panel que apuntan a Supabase.
5. Verificación en vivo (registrar 1 mov de prueba, ver realtime, ver balances).
6. Sheets queda como BACKUP de solo-lectura (no se borra).
Rollback: si algo falla, re-deploy de la versión GAS (Sheets sigue intacto).
```

## 12. Fases internas (aunque sea B, por seguridad)
- **F0** Setup: proyecto, schema, RLS, Auth, Storage, vistas, RPCs, pg_cron.
- **F1** Backfill + cuadre (Sheets sigue siendo la verdad; Supabase espejo de validación).
- **F2** Modo lectura: OperacionesPS/PS Panel **leen** de Supabase (escritura aún GAS) → valida queries/vistas/realtime sin riesgo.
- **F3** Escritura a Supabase, módulo por módulo (orden sugerido: Caja → Catálogos → Manifiesto/Operaciones → Pases/Reservas). RPCs con aforo atómico.
- **F4** Cutover + apagar GAS. Sheets backup.

## 13. Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| Anon key en cliente → datos expuestos | RLS estricto + Auth obligatorio (§5/§6). Nunca `using(true)`. |
| PIN débil como password | email sintético no adivinable + rate-limit Auth + device aprobado. |
| Aforo/overbooking concurrente | RPC con `FOR UPDATE` (no más LockService). |
| TZ Lima / "día" | `at time zone 'America/Lima'` en vistas; nunca `new Date('yyyy-mm-dd')`. |
| Datos sucios al migrar | transform + cuadre antes del flip. |
| Offline del PWA | hoy GAS tampoco daba offline real; evaluar cache/cola luego (no bloqueante). |
| Costo | Pro $25/mes (proyecto nuevo o add-on de la org). |
| Dependencia PS Panel | migrar sus lecturas (vistas/RPC) en el mismo cutover. |

## 14. Definition of Done (criterios de éxito)
- [ ] Schema + RLS + Auth + Storage + vistas + RPCs desplegados.
- [ ] Backfill cuadra 100% (conteos + sumas) en todas las tablas.
- [ ] OperacionesPS: los 22 writes + 2 reads funcionan contra Supabase, con aforo atómico verificado (test de doble registro concurrente).
- [ ] Realtime: 2 dispositivos ven el manifiesto actualizarse.
- [ ] PS Panel: Lanchas/Finanzas/Insights leen de Supabase y los balances cuadran vs la versión Sheets.
- [ ] Login por PIN contra Supabase Auth + RLS por rol probado (un Operador no puede anular).
- [ ] Cutover ejecutado; Sheets en backup; rollback documentado.

## 15. Orden de arranque recomendado
1. Crear proyecto Supabase PS + `schema.sql` (tablas, enums, índices, RLS, vistas, RPCs).
2. Auth PIN (usuarios sintéticos + Edge Function de set-PIN).
3. Script de backfill + cuadre.
4. POC: módulo **Caja** end-to-end (lee+escribe Supabase) como prueba del patrón.
5. Resto de módulos + PS Panel + cutover.
