# PLAN DE FACTURACIÓN ELECTRÓNICA — Ecosistema PS (NubeFact/SUNAT)
**Fecha:** 2026-07-03 · **Estado:** DISEÑO/PLAN aprobado-pendiente · Basado en 6 revisiones 100x senior.
**Empresa:** Turismo marítimo Paracas (tours Islas Ballestas). Régimen General. Oficina virtual (1 punto de emisión lógico).
**Apps emisoras:** Panel PS (`C:\Users\ISO\PS`) + Muelle OperacionesPS (`C:\Users\ISO\OperacionesPS`). Backend Supabase compartido.

---

## 0. DECISIÓN CENTRAL DEL DUEÑO
**UN SOLO CORRELATIVO para todo**, emita desde el Panel o el Muelle. Sin zonas (a diferencia de MOS). Una serie de boletas + una de facturas para toda la empresa.

**✅ YA CUMPLIDO POR ARQUITECTURA.** El código actual usa UNA serie por tipo (`B00x`/`F00x`) y UN contador `series.correlativo` compartido; ambas apps llaman la MISMA RPC `emitir_comprobante`; `origen='panel'|'muelle'` es solo etiqueta de reporte, NO segrega numeración. Serialización money-safe vía `SELECT ... FOR UPDATE` de la fila de la serie. **No hay que rediseñar el modelo de numeración — solo blindarlo (ver §3 blockers).**

---

## 1. ESTADO ACTUAL (qué ya existe, INERTE)
PS **no parte de cero**. Circuito construido y apagado (`facturacion_config.activo=false` → modo STUB):
- SQL: `facturacion_{base,real,series,correlativo,ux}.sql` (esquema en `public`). Orden de aplicación importa: la versión viva de cada función es la última aplicada.
- Tablas: `servicios`, `clientes` (PK doc_tipo+doc_numero, PII), `series` (B00x/F00x, correlativo), `comprobantes` (unique serie+numero, idempotencia por local_id), `facturacion_config` (RLS deny-all, tokens protegidos).
- RPCs: `emitir_comprobante` (STUB/REAL, PEEK correlativo, rollback sin quemar número), `consultar_documento` (lookup RUC/DNI), `anular_comprobante`, `solicitar_anulacion`/`resolver_anulacion` (gobernanza), `buscar_contactos_fac`, `admin_set/get_facturacion_config`, `admin_set_series`, `admin_alinear_correlativo`, `listar_comprobantes(_dia)`, `get_facturacion_bootstrap`.
- Panel PS v1.14.3: overlay Facturación (Emitir/Historial/Anular/Servicios/Ajustes+Conexión NubeFact).
- Muelle v42: FAB+modal boleta rápida (Emitir/Historial), barra de búsqueda inteligente, emitir-en-serie con efecto +1.
- Pendiente declarado: pegar tokens + validar header/payload con demo.

---

## 2. HALLAZGOS LEGALES QUE CAMBIAN EL DISEÑO (Rev. 4)
> Todo esto debe ratificarse con el contador; marcado [FIRME] vs [CONFIRMAR].

1. **[FIRME] Tour suelto a turista extranjero = GRAVADO IGV 18%** (NubeFact `tipo_de_igv=1`). **NO es exportación ni exonerado.** → El default actual de PS `tipo_de_igv=8 (Exonerado)` con el toggle "Extranjero · exonerado IGV (turismo receptivo)" es **legalmente incorrecto por defecto**. Corrección P0: el default es GRAVADO 18%. La tasa 0% (exportación) solo aplica si PS se registra como **operador turístico (MINCETUR + Registro Especial SUNAT)** y vende **paquetes (≥2 servicios)** a no domiciliados — decisión estructural futura.
   - **NO se puede exonerar con "cliente varios"**: el 0% se basa en que el cliente sea no domiciliado, y SUNAT solo lo reconoce si el extranjero está IDENTIFICADO (pasaporte/CE + estancia ≤60d). "Varios" (anónimo) ⇒ default gravado 18%. Un "varios" ≤700 SIEMPRE es boleta gravada, nunca exonerada.
   - **Un paquete NO se logra con solo relabelar 2 líneas** (ej. "bote + asistencia"): requiere (a) **registro de operador turístico ANTES de emitir** (candado principal, PS no lo tiene hoy), (b) 2+ servicios turísticos **elegibles por la norma** (asistencia personal puede no calificar), (c) no domiciliado documentado, (d) comprobante marcado como exportación (afectación 40 / sunat_transaction turismo). Sin el registro ⇒ 18% siempre.
   - **Diseño:** quitar toggle libre "exonerado"; dejar un modo "Exportación" PREPARADO (usa `es_extranjero`+pasaporte+flag `operador_turistico_registrado` en config) pero INACTIVO hasta el registro. Se prende sin reconstruir.
2. **[FIRME] "Retención" (lo que mencionó el dueño):** Régimen General NO lo hace agente de retención. PS es el **RETENIDO**: algunas agencias-cliente le retienen 3% de IGV al pagarle y **ellas** emiten el comprobante de retención. **NO hay que construir emisión de retención.** Solo afecta caja, no la emisión.
3. **[CONFIRMAR] Detracción (SPOT) 12% código 037** ("demás servicios gravados") en **facturas a agencias > S/700**. La agencia deposita 12% en la cuenta BN de PS. La factura debe llevar leyenda SPOT + código + %. → NubeFact lo soporta (`detraccion`, `sunat_transaction=30`). Diseñar el esquema para admitirlo; activar tras confirmar con contador. **Fase 2.**
4. **[CONFIRMAR] Tasas de terceros (SERNANP ingreso reserva + embarque muelle) = INAFECTAS al IGV.** Si PS las cobra al turista, son reembolso por cuenta de terceros → **no** son base imponible. Deben ir como línea **inafecta (código 30)** separada del servicio gravado, o entregarse aparte. Riesgo: facturar todo junto → SUNAT grava el total. **Fase 2** (soporte de línea inafecta).
5. **[FIRME] Percepciones: NO aplican** a servicios (solo bienes/combustible como comprador). Ignorar.
6. **[FIRME] Umbrales:** boleta > **S/700** exige identificar cliente; bancarización ≥ **S/2,000**; resumen diario boletas hasta **7 días**; baja de factura hasta **7 días** (luego Nota de Crédito).
7. **[FIRME] Serie única B00x/F00x = legal.** No requiere autorización previa. Correlativo empieza en 1, independiente por serie.

---

## 2b. CATÁLOGO DE SERVICIOS UNIFICADO (pedido del dueño 2026-07-03)
PS ofrece **múltiples servicios** (Paseo Islas Ballestas, Paseo Reserva Nacional, Hotel, y más a futuro), pero hoy no hay un catálogo maestro: `movimientos` (muelle) solo registra el paseo en bote; el servicio no está tipificado en ningún lado.
- **Ya existe base parcial:** la tabla `servicios` (`facturacion_base.sql`: `id SVC-000N, nombre, precio_defecto, unidad, activo`) + RPCs `listar_servicios`/`admin_set_servicio`/`admin_eliminar_servicio` + pestaña "Servicios" en el Panel. Pero es mínima (solo para facturación).
- **Plan: potenciarla a catálogo maestro** que sirva a ambas apps y al CPE. Añadir columnas fiscales por servicio: `tipo_afectacion` (gravado/inafecto/exonerado/exportacion → NubeFact `tipo_de_igv` 1/8/9/16), `unidad` (default `ZZ`=servicio), `codigo_sunat` opcional, `categoria` (tour/hotel/tasa/otro). Así el muelle y el panel eligen de la MISMA lista y el comprobante se arma con la afectación correcta automáticamente.
- **Tasas (SERNANP/muelle):** modelar como servicios de `categoria='tasa'` con su `tipo_afectacion` (SERNANP=inafecto; muelle=según contador). El catálogo `impuestos` actual del muelle (`adicionales`) se reconcilia contra este maestro para que las tasas entren al CPE como líneas con su afectación.
- **Precio por defecto editable** por servicio (ya está en `precio_defecto`); el muelle usa "Varios" CON-00 S/30 como fallback (conservar).
- Fase: el catálogo básico ya existe → se potencia en **Fase B** (columnas fiscales + UI); el mapeo tasa→línea-CPE es **Fase 2**.

## 2d. MODO EXPORTACIÓN / PAQUETE TURÍSTICO (0% IGV) — FUNCIÓN ACTIVA (reglado por Informe SUNAT 123-2012 + Regl. IGV 9-A a 9-E)
Ruta para vender a turistas EXTRANJEROS no domiciliados con **IGV 0%**. **DADO POR EL DUEÑO (2026-07-03): la empresa YA está inscrita** — Agencia de Viajes en Directorio MINCETUR + Registro Especial de Operadores Turísticos SUNAT + botes con permiso DICAPI. Por tanto el flag `operador_turistico_registrado = ON` y este modo se **construye funcional** junto con el resto (no es fase futura).
- **[FIRME] Bote + guía = paquete que califica:** "transporte turístico" y "guías de turismo" están ambos en la lista del numeral 9 art. 33. Mínimo: al menos uno del numeral 9 (firme); "conjunto" ⇒ 2+ prudente. Bote+guía cumple.
- **[FIRME] Bote Ballestas = "transporte turístico acuático"** (Informe 123-2012), CONDICIÓN: embarcación con **permiso de operación de transporte turístico acuático (DICAPI/D.S. 006-2011-MTC)**. Recojo hotel = solo si transportista habilitado; bicicleta = NO.
- **⚠️ [FIRME] DESDOBLE del comprobante (art. 9-E):** **Factura de exportación** por servicios del numeral 9 (bote+guía, 0%) + **Boleta** por servicios NO listados. Solo bote+guía ⇒ una sola factura de exportación.
- **Inscripciones (DADAS POR HECHAS por el dueño):** Agencia de Viajes en Directorio MINCETUR + Registro Especial Operadores Turísticos SUNAT + permiso DICAPI de los botes. → flag `operador_turistico_registrado = ON`. *(Si en algún momento caducara alguna, apagar el flag = vuelve todo a 18%.)*
- **[FIRME] Cliente:** no domiciliado ≤60 días; sustento **pasaporte** (doc_tipo 7) + registro de ingreso; se puede vender directo al turista o a agencia extranjera. **⚠️ Carné de Extranjería (doc_tipo 4) NO califica** al 0%: el CE identifica a un extranjero RESIDENTE = domiciliado → va con boleta/factura normal 18%. El modo Exportación debe EXIGIR pasaporte y rechazar CE/DNI para el 0%.
- **[FIRME] CPE:** Factura de exportación · afectación Catálogo 07 = **40 (Exportación)** · tipo de operación Catálogo 51 = **0205 (paquete turístico)** (verificar código vigente en NubeFact). NubeFact soporta facturas de exportación; parametrizar `tipo_de_operacion`.
- **[FIRME] Saldo a Favor del Exportador (SFE):** recupera IGV de compras vinculadas, tope 18% sobre ingresos del numeral 9.
- **DISEÑO SISTEMA:** modo "Exportación" = factura, cliente extranjero identificado (pasaporte obligatorio, no "varios"), líneas del paquete (bote+guía) con afectación 40 + tipo op 0205, flag `operador_turistico_registrado` en config = **ON** (empresa inscrita). Peruanos y tours sueltos (1 solo servicio) siguen 18%. Se construye junto con Fase B; se valida el payload de exportación con el token demo de NubeFact (afectación 16/40 + sunat_transaction 2 + tipo op 0205).
- **UI (checklist en vivo, estilo `_cpeReglas`):** el 0% se habilita SOLO si se cumplen las 3 condiciones a la vez: (1) cliente con PASAPORTE (doc_tipo 7; CE/DNI ⇒ 18%), (2) paquete de 2+ renglones con transporte+guía, (3) flag operador_registrado ON. Si falta cualquiera ⇒ emite 18% automáticamente. Nunca exonerar por un solo dato. Pasaporte = entrada MANUAL (nº + nombre, sin API; no existe lookup de pasaportes en Perú).
- **Tasas (SERNANP/muelle) NO son "extras":** son cobro de terceros trasladado; se embeben en la línea del servicio (ej. "Transporte en bote S/60" incluye la tasa). El desdoble factura+boleta del art. 9-E solo aplica si se vende un bien/servicio REAL fuera del numeral 9 (souvenir, foto, polo) — caso raro.

## 2e. FACTURACIÓN DESDE EL ZARPE CON IA (Claude vision) — idea del dueño 2026-07-03
Realidad operativa: el CPE muchas veces se emite **DESPUÉS** del paseo — se factura a la agencia por todo el grupo o parte, y a los sueltos se les manda el PDF. El **zarpe es una FOTO** que el operador toma en OperacionesPS (lista con nombre completo + DNI/CE/pasaporte). Idea: usar **IA Anthropic (Claude vision, mismo proveedor que MOS)** para extraer la data de los documentos de la foto y facturar aplicando el tratamiento correcto.

**Flujo diseñado:**
1. **Captura:** operador fotografía el zarpe (ya lo hace) → se sube a Supabase Storage, ligada a la operación.
2. **Extracción IA:** Edge Function `extraer-zarpe` (reusa el patrón Anthropic de MOS) → Claude vision lee la imagen → devuelve JSON estructurado `[{nombre_completo, tipo_doc(1/4/7), numero, nacionalidad}]`. Modelo sugerido: **claude-sonnet-4-6** (buena visión, costo-eficiente; opus si la letra es difícil). Key en secret del Edge, nunca en frontend.
3. **Revisión humana:** la lista extraída aparece en "Facturar desde zarpe" (panel + muelle) — el operador revisa/corrige antes de emitir (nunca auto-emitir a ciegas; foto/manuscrito puede fallar).
4. **Facturación flexible (diferida):** selecciona todo el grupo → **factura a la agencia** (RUC), o parte del grupo → **facturación parcial**, o sueltos → **boletas individuales** + enviar PDF (WhatsApp/correo).
5. **Aplica el tratamiento correcto AUTOMÁTICO por tipo de doc:** DNI→peruano 18% · Pasaporte→si paquete 2 servicios + operador registrado → **export 0%**, si no 18% · CE→residente 18%. (Reusa las validaciones ya construidas en `emitir_comprobante`.)
6. **Conciliación inherente:** como el CPE nace del zarpe, el cruce PAX↔CPE (§2c) queda cubierto solo — no se te escapa ningún pasajero.

**Notas:** reusa el lookup APIsPeru para completar/validar RUC de la agencia; PII extraída (docs) → tabla `clientes` (ya con RLS). Historial muestra operaciones "pendientes de facturar". Fase: **Fase C/2** (feature IA), después del core 18%+export y la UX base. Roadmap MOS tiene patrón análogo (OCR boleta preingreso, portal cliente IA+fallback).

## 2c. CONCILIACIÓN ZARPE ↔ CPE (defensa ante fiscalización SUNAT, pedido dueño 2026-07-03)
El zarpe/manifiesto de OperacionesPS (nombres + DNI/CE/pasaporte + PAX) es documento de seguridad marítima, NO tributario, PERO **SUNAT lo cruza contra los CPEs por VOLUMEN**: si el zarpe muestra N pax y se emitieron menos ventas → ventas omitidas (riesgo alto). El riesgo real NO es el DNI en boletas ≤700 (eso es legal como "varios"), sino **emitir un comprobante por cada venta**.
- **[FIRME]** Boleta ≤S/700 sin doc = legal. La obligación firme = comprobante por cada venta.
- **Recomendación (best-practice, no obligación):** como el zarpe YA tiene los documentos, pre-llenar el CPE con el pasajero = identificación gratis + libros a prueba de cruce. Convierte el DNI de "formalidad" en escudo.
- **FEATURE a diseñar:** (a) **emitir CPE desde el movimiento/operación** pre-llenando nombre+doc del manifiesto; (b) **vista de conciliación** por día/operación: PAX-zarpe vs comprobantes vs monto → marca huecos en rojo. Es la defensa directa ante fiscalización. Fase: enganche emitir-desde-movimiento = **Fase B**; vista de conciliación = **Fase B/2**.

## 3. BLOCKERS TÉCNICOS (cerrar antes de emitir en real) — de Rev. 1/3/6
| # | Blocker | Severidad | Fix |
|---|---------|-----------|-----|
| B1 | **Sin RLS** en `servicios/clientes/series/comprobantes` → PII expuesta por PostgREST y `UPDATE series.correlativo` con anon key salta el lock (rompe el correlativo único) | HIGH | `enable row level security` deny-all en las 4 tablas (acceso ya es 100% por RPC security-definer). **Verificar grants reales primero.** |
| B2 | **Doble emisión por timeout**: cliente aborta a 20s, servidor sigue a 25s; `localId` se regenera cada click → reintento emite 2ª boleta | HIGH | `localId` estable por "intento de venta" hasta éxito; alinear timeouts (cliente ≥ servidor); confirmar `statement_timeout` del rol |
| B3 | **Muelle no reenvía `cliente_dir` ni `es_extranjero`** → factura desde muelle sin dirección → NubeFact rechaza | MED | Añadir params en `supabase-data.js` handler `emitir_comprobante` |
| B4 | **Regresión** `get_facturacion_config` (viva en correlativo.sql) NO devuelve `serie_boleta/factura` → el Panel siempre cae a default | MED | Recrear `get_facturacion_config` devolviendo las series |
| B5 | **Verificar columna `cliente_tel`** (creada en ux.sql, insertada en correlativo.sql) esté aplicada, o el emit revienta | MED | Chequear base + reordenar/garantizar aplicación |
| B6 | **Validar header NubeFact**: doc oficial dice `Authorization: <TOKEN>` **crudo** (no `Token token=`, no `Bearer`). PS ya usa crudo (correcto); MOS trae plantilla `Token token="{token}"` (a validar) | HIGH | Probar con token demo; el `auth_header`/formato es configurable |

---

## 4. CORRECCIONES FISCALES SERVER-SIDE (portar de MOS `fac.*`) — Rev. 1/3
Añadir a `emitir_comprobante` de PS (MOS ya las tiene probadas 300x):
- **Factura** → exige RUC 11 + razón social + dirección fiscal.
- **Boleta > S/700** → exige documento (DNI/RUC/CE/pasaporte) + nombre.
- **Bancarización ≥ S/2,000** → exige medio de pago (va en `observaciones`).
- **Base imponible no manipulable** → `total == Σ(items.subtotal)` tol 0.01; base derivada del subtotal (no del valor unitario de lista → evita IGV negativo con descuento).
- **Guard CORRELATIVO_DESYNC** → si NubeFact devuelve nº distinto al enviado → `raise` (no adoptar silenciosamente como hoy).
- **Duplicado** ("ya fue informado") → `consultar_comprobante` + marcar PENDIENTE (no `rechazada`).
- **Default GRAVADO 18%** (`tipo_de_igv=1`); exonerado/inafecto/exportación solo por selección explícita justificada.
- **IGV catálogo 07 NubeFact:** 1=Gravado · 8=Exonerado · 9=Inafecto · 16=Exportación (ojo: el nº de NubeFact ≠ el código de afectación SUNAT 10/20/30/40).

## 4b. RECONCILIACIÓN (portar de MOS) — Rev. 1/3
- `pg_cron` horario: recorre PENDIENTE/RECHAZADO últimos N días, `consultar_comprobante`, promueve a EMITIDO si SUNAT aceptó (aceptación asíncrona de boletas/resumen diario).
- `pg_cron` diario: **reconciliador de huérfanos** (NubeFact tiene número que local no → importar + avanzar contador, nunca reusar). Cubre el bug B2 cross-system que MOS ya pagó.
- **Estados terminales:** nunca re-consultar BAJA ni EMITIDO. Cron sin gate de claim JWT (corre sin sesión).

---

## 5. UX (portar de MOS + unificar) — Rev. 6
- **P0/P1: Motor `_cpeReglas` de MOS** (checklist SUNAT en vivo: factura→RUC+razón+dir; boleta>700→identificar; bancarización≥2000) → portar a **muelle Y panel**. Un bloque autocontenido; da feedback preventivo antes del error.
- **Gate de botón "Emitir factura"** deshabilitado si falta RUC(11)/dirección.
- **Chips de estado SUNAT 🟢 aceptado / 🟡 pendiente / 🔴 rechazado** + reconsulta en ambos historiales.
- **Traducir errores NubeFact/SUNAT** a lenguaje de operario.
- **Unificar barra de búsqueda del panel** al patrón del muelle (input único, autodetección 8→DNI/11→RUC, dropdown de frecuentes con debounce, toggle Perú/Extranjero para CE/pasaporte). La barra del muelle es la referencia buena — conservarla.
- **Exoneración/inafecto con fricción**: no toggle libre; pedir sustento (pasaporte/TAM) y, por defecto, GRAVADO (§2.1).
- **iOS**: `env(safe-area-inset-bottom)` en bottom-sheet y FAB; `inputmode="numeric"` en campos de documento.

---

## 6. LOOKUP RUC/DNI (APIs Perú) — Rev. 5
- **Proveedor recomendado: decolecta** (Bearer, coincide con el SQL de PS). Alternativa: APIsPeru (lo usa MOS, token JWT en querystring, sí mantiene RENIEC-DNI).
- **Fix obligatorio si se usa decolecta:** el SQL de PS lee `razonSocial/apellidoPaterno` (camelCase) pero decolecta devuelve `snake_case` → **el nombre saldría vacío**. Ampliar el `coalesce` a `razon_social/apellido_paterno/apellido_materno` (igual que el Edge de MOS).
- Añadir guard **`success:false` con HTTP 200** (viene como no-encontrado) + **1 retry** con backoff.
- **Cache-al-lookup:** `insert into clientes ... on conflict do nothing` al final de `consultar_documento` (no pisar ediciones manuales) + consultar `clientes` local antes de pegar a la API → ahorra cuota.
- **⚠️ Confirmar al activar** que el plan contratado incluye **RENIEC-DNI** (varios proveedores lo restringieron 2025-26). CE/pasaporte: a mano (sin lookup) — correcto.
- Token va en `facturacion_config` (RLS deny-all) — ya resuelto.

---

## 7. FASES DE IMPLEMENTACIÓN
**Fase A — Blindaje (sin tokens, seguro):** B1 RLS · B2 doble-emisión · B3 muelle dir · B4/B5 regresiones · §4 validaciones SUNAT server-side + default gravado · §4b reconciliación cron.
  → **BACKEND CONSTRUIDO 2026-07-03:** `facturacion_blindaje.sql` (RLS 4 tablas · get_facturacion_config con series · emitir_comprobante con validaciones factura/boleta>700/bancarización + CORRELATIVO_DESYNC + duplicado→pendiente + timeouts alineados + auth_header configurable + p_medio_pago · reconciliar_comprobantes + pg_cron) + `apply_facturacion_blindaje.js` (13 tests rolled-back). **Verificado: 0 acceso directo a tablas en frontends (RLS seguro).** PENDIENTE: aplicar a la base + B2 lado frontend (localId estable/rotación) + B3 (muelle reenvía cliente_dir/es_extranjero en supabase-data.js).
**Fase B — UX:** §5 motor de reglas + chips estado + unificar búsqueda + iOS.
**Fase C — Lookup:** §6 decolecta/APIsPeru + fixes + cache.
**Fase D — Validación con token demo:** pegar RUTA/TOKEN demo → validar header crudo + payload (1 boleta gravada multilínea + 1 factura con RUC) → verificar PDF/QR/estado SUNAT.
**Fase E — Cutover producción:** RUTA/TOKEN prod → alinear correlativo al último nº real (o 0 si serie nueva) → crear series en NubeFact desde 1 → `activo=true` + toggles → emitir 1×1 vigilado → purgar STUB + reset correlativo demo.
**Fase 2 (post-cutover, requiere contador):** detracción 12% código 037 en facturas B2B · líneas inafectas SERNANP/embarque · notas de crédito de corrección · SIRE.

---

## 8. DECISIONES ABIERTAS (para el dueño)
1. **Path técnico:** (A) portar la capa `fac.*` de MOS entera a PS, o (B) **blindar en sitio** el circuito PS actual backporteando lo que falta. → Recomendado **B** (menor churn, núcleo ya money-safe).
2. **Series definitivas de PRODUCCIÓN:** ¿`B001/F001` o `B002/F002`? (ambas legales; alinear con lo que se cree en NubeFact producción). **DEMO ya fijado por NubeFact (ver abajo).**
3. **Proveedor lookup:** decolecta vs APIsPeru (reusar el de MOS).
4. **Fase 2 (detracción/SERNANP):** ¿ahora o después del cutover básico? Requiere confirmación del contador.
5. **Exportación/operador turístico:** ¿interesa la ruta 0% IGV a futuro? (estructural, no bloquea el cutover gravado 18%).

---

## 9. SERIADO NubeFact DEMO (confirmado por el dueño, cuenta demo, Local 001 Paracas CÓD.SUNAT 0000)
Para probar en demo, `facturacion_config` debe usar EXACTAMENTE estas series (NubeFact rechaza cualquier otra en el local demo):
| Documento | Serie DEMO |
|-----------|-----------|
| **Boleta** | **BBB1** |
| **Factura** | **FFF1** |
| Nota de Crédito | FFF1 (factura) / BBB1 (boleta) |
| Nota de Débito | FFF1 / BBB1 |
| Comprobante de Retención | RRR1 |
| Comprobante de Percepción | PPP1 |
| Guía Remisión Remitente | TTT1 |
| Guía Remisión Transportista | VVV1 |
| Contingencia | 0001 |
> Son las mismas series demo estándar de NubeFact (MOS también usó BBB1/FFF1). En **producción** el dueño define sus series reales (B00x/F00x) y se crean en la cuenta NubeFact producción arrancando en 1. Nunca reutilizar la numeración demo en producción (purgar STUB + reset correlativo en el cutover).

## FUENTES CLAVE
- MOS `fac.*`: `ProyectoMOS/supabase/fac_01..06*.sql`, `322/323/324`, `RUNBOOK_CPE_GO_LIVE.md`.
- Manual JSON NubeFact (Google Doc oficial vía nubefact.com/integracion). Header `Authorization: <token>` crudo. IGV cat.07: 1/8/9/16.
- Legal: SUNAT CPE, RS 279-2019 (SEE universal), art. 33 Ley IGV num. 9 (exportación turismo), RS 033-2014 (retención 3%), D.Leg. 940/RS 183-2004 (SPOT 12% cód. 037), Ley 28194/D.Leg.1529 (bancarización S/2,000).
