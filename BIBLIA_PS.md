# 📖 BIBLIA DEL ECOSISTEMA PS
> Fuente de verdad viva del ecosistema **Grupo PS**. Es el **cerebro de JADE** (el agente del panel) y la **referencia de reparaciones** para el equipo (Luis + Claude Code).
> Retroalimentable: crece con el negocio (ej. cuando se dibuje el Hotel). Última actualización: **2026-07-18**.

---

## 0. Cómo usar esta biblia

- **JADE** (asistente en PS Panel) la lee como *system-prompt*: de aquí saca las reglas de negocio, el glosario y los flujos para responder al admin y para reparar.
- **Reparaciones**: antes de tocar algo, lee la sección relevante + las **Directrices** (§7) + el **Log de Reparaciones** (§8) para no repetir errores.
- **Regla de oro**: si reparas algo que cambia una regla o un flujo, **actualiza esta biblia** (y el manual interactivo `manual-movimientos.html`). La biblia desactualizada engaña a JADE.

---

## 1. El ecosistema PS (visión)

**Grupo PS** es un grupo de inversiones (de la dueña, **Paty**) con negocios diversos. Hoy el ecosistema digital tiene 3 piezas:

| Pieza | Qué es | Estado | Path |
|---|---|---|---|
| 🏨 **Hotel** | Alojamiento (Paracas) | **Futuro** — aún no implementado | (por definir) |
| 🚤 **OPS · OperacionesPS** | El **muelle**: el operador gestiona botes, PAX, caja en vivo | En producción | `C:\Users\ISO\OperacionesPS` |
| 🖥️ **PS Panel** | El **centro**: el admin/dueña ve y controla TODO de forma centralizada | En producción | `C:\Users\ISO\PS` |

**Idea clave:** OPS es el *operador de campo* (muelle, tiempo real, alta presión). PS Panel es el *cerebro administrativo* (reportes, balances, correcciones retroactivas, facturación). **Comparten UNA sola base de datos** (Supabase), así que un cambio de dato se refleja en ambos.

**JADE** vive en PS Panel: es el asistente que entiende todo este ecosistema.

---

## 2. Arquitectura técnica

- **Backend único:** Supabase (Postgres) — proyecto `lintmcxqxnrholslatul`, host `aws-1-us-west-2.pooler.supabase.com`. Esquema `public`.
  - **RPCs** (`SECURITY DEFINER`, gate interno `_req_staff()`/`_req_admin()` por JWT claim).
  - **Vistas** de balance: `v_balance_agencias`, `v_balance_aliados`.
  - **Triggers** de normalización, **RLS** (`es_staff()`/`es_admin()`), **Realtime**, **Storage** (fotos de zarpe), **Edge Functions** (facturación CPE + lectura IA de zarpes/compras con Claude Vision).
- **OPS (muelle):** Vanilla JS (`app.js`) + HTML + Tailwind CDN — PWA mobile-first. Lee/escribe Supabase directo (RPCs) con near-real-time (poll 10s + Realtime + optimistic).
- **PS Panel:** Vue 3 single-file (`index.html`) + Supabase (`sbClient`, `_psRpc`, mapas `PS_GET`/`PS_POST`). Paleta guinda/gold, tema oscuro. Realtime en lanchas.
- **Deploy = git push** (NO clasp):
  - PS: bump `APP_VERSION` (index.html) + `VERSION` (sw.js) + `version.json`; branch **master** (`github.com/Levo19/PS-Panel`).
  - OPS: bump `CACHE_NAME='ops-vXX'` (sw.js); branch **main** (`github.com/Levo19/OperacionesPS`).
  - GitHub Pages: límite ~10 builds/hora por repo → batchear deploys.
- **SQL a prod:** se aplica en vivo vía `node` + `pg` + `.pgpass` desde `OperacionesPS/supabase/` (host/pooler arriba). **Toda prueba que escriba corre en `begin…rollback`** (es producción). Los `.sql` del repo son el espejo (mantenerlos sincronizados).

---

## 3. Glosario (conceptos del negocio)

### 3.1 Tipos de contacto (`contactos.tipo`)
Un contacto es una persona/empresa con la que se transa. `contactos_tipo_check` permite: `agencia`, `aliado`, `comisionado`, `libre`. **Un mismo nombre puede ser VARIOS tipos** → se guarda como **varias filas** (una por tipo), NO una fila con varios tipos. Se distingue por **id**, nunca por nombre (hay nombres repetidos).

| Tipo | Quién es | Dinero | Precio por defecto |
|---|---|---|---|
| **Libre** / **VARIOS** | Público a pie (walk-in). El contacto único **CON-00** ("VARIOS") | Él **te PAGA** | Sí (ej. S/30) |
| **Agencia** | Una agencia te contrata pax a su tarifa | Te queda **DEBIENDO** (cuenta corriente S/) | Sí (su tarifa × pax) |
| **Comisionado** | Te trae pax y le pagas **comisión** | Le **pagas comisión** (precio − su tarifa) | Sí |
| **Aliado** | Otro operador con el que haces **trueque en PAX** | **NO se cobra en S/** (trueque) | **0 siempre** |

- **VARIOS (CON-00)** es **ÚNICO e intocable**: no se agrega ni quita su tipo (solo su precio). Aparece fijo y resaltado al inicio de todos los pickers de PS para elegir walk-ins rápido.
- El **nombre** de todo contacto se **normaliza**: MAYÚSCULAS, sin espacios en los extremos, un solo espacio interno (SIX PASANGER), y es **case/space-insensitive** para unicidad → nunca dos reportes por el mismo nombre. Regla: **una sola fila por (nombre + tipo)** (índice único `uq_contactos_nombre_tipo`).

### 3.2 Aliado: PaseIn vs PaseOut
Los aliados se transan en **PAX (trueque)**, no en plata (monto 0).
- **Aliado(PaseIn)** = un aliado **te PASA** sus pax → ahora **te DEBEN** PAX. (En el form se llama pill **"Aliado"**; valor interno `Aliado(PaseIn)`; NO pide monto.)
- **Aliado(PaseOut)** = **TÚ le pasas** pax a un aliado → **le DEBES** PAX. Lo cobrable de un PaseOut es siempre el **ORIGEN** (quien te dio los pax: agencia/libre/comisionado), NUNCA el aliado destino.

### 3.3 Movimiento
Una fila de `movimientos` = un grupo de pax dentro de una operación (o un pase suelto). Deja el rastro completo:
`contacto_id` (quién me debe: agencia S/ ó aliado PAX) → `contacto_pase_id` (aliado a quien DERIVÉ, PaseOut) → `agencia_comprada_id` + `monto_comprado` (agencia a la que COMPRÉ espacio si el aliado no cumplió). `nombre_contacto` = snapshot del nombre (para Libre: `"VARIOS:APELLIDO"`).

### 3.4 Adicionales / Extras
`movimientos.adicionales` es un **jsonb SOLO-MONTOS** `{"muelle":10,"adulto":22}` (catálogo = tabla `impuestos`: Muelle/Local/Adulto/Niño/Full). **Lo que te deben = monto + adicionales.** Los extras se cobran al **origen**. Reglas duras:
- Es un **objeto** (no array/string/número) con **valores numéricos**. Una nota/comentario JAMÁS va como valor (iría en columna propia).
- La suma (`_adic_sum`) es **blindada**: solo jala montos numéricos, ignora texto, y tolera contenedor no-objeto → **nunca revienta el balance**.

### 3.5 Estados de operación / movimiento
- Operación: `Abierta` (recibe pax en vivo) → `En_Viaje` (zarpó) → `Cerrada` (finalizada). También `Cancelada`.
- Movimiento: `Embarcado` (cuenta aforo) → `Pasado` (derivado a aliado o zarpó, sale del aforo) · `Cancelado`.

### 3.6 Aforo, cupos, "Bote lleno"
`capacidad` = capacidad_pax de la embarcación. `pax_total` = suma de PAX no-cancelados en la operación. **Cupos = capacidad − pax_total.** El botón "Agregar movimiento" se decide por **aforo** (hay cupos), NO por estado; el admin puede agregar **retroactivo** a ops cerradas si hay cupo; si `pax_total ≥ capacidad` → "🚫 Bote lleno".

### 3.7 Descuadre
`descuadre` = `|caja_sum − mov_sum| > 0.5` por bote. Es una **alerta de control**, NO un error: salta con ventas a crédito/agencia, pagos parciales o pases (monto 0).

---

## 4. Reglas de negocio del DINERO (el corazón)

### 4.1 Balance de AGENCIAS (`v_balance_agencias`, en S/)
Por cada agencia:
- **TE DEBE (te_debe)** = `facturado − cobrado`
  - `facturado` = Σ `(monto_total + adicionales)` de **TODO movimiento cuyo `contacto_id` sea tipo agencia** (sin importar el tipo del movimiento: Agencia, Aliado(PaseIn/PaseOut)…). Clave: el **origen** de un PaseOut suele ser una agencia que **igual te debe su grupo**.
  - `cobrado` = Σ caja categoría `Cobro` ligada por `movimiento_id` (parciales OK) + abonos directos (Cobro sin movimiento_id al contacto).
- **LE DEBES (le_debo)** = `comprado − pagado`
  - `comprado` = Σ `monto_comprado` donde `agencia_comprada_id` sea agencia (compraste espacio a esa agencia).
  - `pagado` = Σ caja categoría `Pago Agencia` a esa agencia (es **TU pago a la agencia**, no un adelanto de ella).
- Excluye: `Cancelado`. La suma de adicionales usa `_adic_sum` (blindado).

### 4.2 Balance de ALIADOS (`get_balance_aliados`, en PAX)
Trueque: te deben PAX / les debes PAX. Un PaseOut derivado a un aliado que **no cumplió** y se resolvió **comprando** a una agencia YA NO cuenta PAX del aliado (se saldó por compra); conserva el rastro del aliado.

### 4.3 Cadena pase → compra
Si un aliado no cumple, le **COMPRAS** espacio a una **AGENCIA** (solo agencias venden). Le debes S/ a esa agencia. La fila **conserva** `contacto_pase_id` (a quién pasaste). `convertir_pase_compra` valida `NO_ES_AGENCIA` + `monto>0` y NO borra el aliado.

### 4.4 Cobro (registrar plata)
El admin (PS) cobra igual que el operador (OPS): el botón **Cobrar** de un movimiento/pase precarga **monto + adicionales** (`montoTotalMov`, = el "TOTAL A COBRAR"), pago parcial → pendiente. Registra en `caja_operador` categoría `Cobro` ligado por `movimiento_id` (RPC `registrar_transaccion`, idempotente por `local_id`). Así `te_debe` del día baja exactamente lo cobrado. En un pase, el cobro va al **ORIGEN**, nunca al aliado.

### 4.5 Aliados = PAX, no plata
A un aliado (PaseIn) NO se le cobra: monto 0, sin botón Cobrar, sin campo de monto al registrar.

---

## 5. Flujos (cómo se hace cada cosa)

> El **manual interactivo** `OperacionesPS/manual-movimientos.html` dibuja el grafo de flujos (origen CRM/Muelle/Panel → pasos validados → efectos). Esta sección resume en texto para JADE.

### 5.1 Registrar un movimiento nuevo (PS Panel)
Lanchas → expandir una lancha → **＋ Agregar movimiento** (aparece si hay cupos; retroactivo si cerrada). Elige el **Tipo** (pill): Libre / Agencia / Comisionado / **Aliado**.
- **Libre** → escribe el apellido de familia (opcional) → se guarda como **VARIOS (CON-00)** con nombre `"VARIOS:APELLIDO"`. Pide PAX + precio (él te paga).
- **Agencia / Comisionado** → elige el contacto (filtrado por tipo) + PAX + precio.
- **Aliado** → elige el aliado que trae los pax + PAX. **No pide monto** (trueque).
Validaciones (iguales a OPS): "Selecciona el contacto." / "Cantidad de pasajeros inválida." / "Ingresa el precio cobrado." (Aliado nunca pide precio).

### 5.2 Registrar un pase suelto (PS Panel)
Pestaña Pases → **＋Pase**: origen (buscador de contacto o texto libre; VARIOS fijo arriba) + aliado que lo lleva + PAX. Monto/precio SIEMPRE 0 (los pases van en PAX). Retroactivo solo admin.

### 5.3 Agregar/editar extras (adicionales) — PS y OPS
Abre el detalle del movimiento (o pase) → botón **Extras/Adicionales** → marca del catálogo (Muelle/Local/Adulto/Niño/Full) con cantidades → guarda (jsonb numérico). Suben el total a cobrar (se cobran al origen). El catálogo viene de la fuente única precargada.

### 5.4 Cobrar — PS y OPS
Detalle del movimiento/pase → **💰 Cobrar** → precarga monto+adicionales (o pendiente si parcial) → elige método → registra en caja ligado al movimiento.

### 5.5 Gestión de contactos (PS Panel → Catálogo → Contactos)
- **1 card por nombre** con un chip por tipo (LEVO = Agencia + Comisionado + Aliado).
- **Nuevo/Editar**: modal con **checkboxes** por tipo (Agencia/Comisionado/Aliado; **Libre no** aquí) + precio por tipo (Aliado = S/0 fijo). Crea/edita varias filas de una. Al **quitar** un tipo pide confirmación; si tiene movimientos/pagos, **NO se puede quitar** (protege reportes).
- **VARIOS** → card fijo arriba; al click solo edita el **precio** (tipo intocable).
- **Fusionar duplicados**: si dos contactos DEL MISMO TIPO son el mismo (mal registrados), `admin_fusionar_contactos(origen, destino)` repunta movimientos/pases/compras/caja del origen al destino y borra el origen (money-safe: reatribuye, no cambia montos; VARIOS protegido). JADE lo puede proponer con confirmación.
- **Elegir contacto al embarcar/cobrar SIEMPRE por ID, no por nombre** (hay nombres repetidos: ej. OVERLAND agencia + OVERLAND aliado). El embarque de OPS usa un **buscador filtrable** (escribes y filtra por nombre, guarda el id oculto) en vez de un `<select>` largo — `getContactoSeleccionado` devuelve el id.

---

## 6. Reglas de seguridad y money-safety (invariantes que NUNCA se rompen)

1. **Distinguir contactos por `id`, nunca por nombre** (hay nombres repetidos).
2. **Escritura de stock/plata = atómica** (UPDATE con delta, nunca read-modify-write) e **idempotente** (`local_id` + índice único parcial).
3. **`adicionales` = objeto solo-montos.** Texto ahí está prohibido; los helpers lo toleran pero no confíes en eso.
4. **No cambiar el `tipo` de un contacto con historial** (movería/borraría receivables). El backend lo bloquea (`TIENE_MOVIMIENTOS`).
5. **CON-00 (VARIOS) es intocable** en nombre/tipo (solo precio).
6. **La escritura directa MOS/legacy NO coexiste con sync de Hojas** (pisa datos). En PS/OPS ya es 100% Supabase.
7. **Toda prueba de escritura en prod va en transacción con `rollback`.**

---

## 7. Directrices de trabajo (cómo reparamos — acordadas con Luis)

1. **100% Supabase, CERO GAS.** Si tocas un flujo con Google Apps Script, migrarlo a Supabase; nada nuevo en GAS.
2. **La lógica aplica a AMBAS apps** (OPS + PS): un fix de backend compartido cubre las dos; los cambios de frontend deben ser consistentes en ambas.
3. **El manual/biblia se actualiza** en toda reparación que cambie un flujo o regla.
4. **Diseño + animaciones + lógica** en cada fix, con **tests money-safe**.
5. **Flujo por punto:** Analizar → Reporte → Fix nivel senior → Test de estrés (browsercheck + screenshots + tools) → confirmar.
6. **Analizar primero y SUBRAYAR cualquier clash** con lógica previa antes de tocar; verificar aunque parezca ya implementado.
7. **Marcar punto de retoma** al pausar/cambiar de tema.
8. **Revisión senior 10x/100x adversarial** antes de declarar algo listo (apps de dinero en prod).
9. **Deploy = git push** + bump de versión/SW; verificar sync (`git log origin/…..HEAD`).
10. **Responsive obligatorio:** óptimo iOS/Android/Windows, siempre visible en mobile/tablet/PC.

### Directrices de REPARACIÓN (2026-07-11) — flujo obligatorio
**Orden por cada reparación:** (1) ANALIZAR el problema a fondo con datos reales → (2) DISEÑAR la solución → (3) EXPLICAR → (4) recién REPARAR → (5) REVISAR con varias herramientas (browsercheck/webcheck + screenshots + prueba de estrés de uso). Y transversal:
- **a.** Cada reparación puede AMPLIAR esta biblia (data/reglas nuevas se agregan aquí).
- **b.** Cada reparación queda como LOG (tabla `reparaciones` + errores frecuentes en `app_eventos`) → para resolver más rápido a futuro.
- **c.** Claude Code ENTRENA a JADE con cada caso (actualiza el `SYSTEM` del Edge `jade-chat` + tools + esta biblia) para que sepa resolver/guiar.
- **d.** 100% Supabase, cero GAS.
- **e.** Código ÓPTIMO y SIN DUPLICADOS: antes de escribir, verificar que no exista ya una función/lógica equivalente (reutilizar, no duplicar).
- **g.** Al terminar todo el proceso: REPORTE al dueño.

---

## 8. Log de Reparaciones (bitácora + errores comunes)

> Registro de todo lo reparado. JADE (versión programador) lo usa para ver patrones de errores. Cada entrada: qué, causa raíz, fix, versión.

### Sprint 2026-07-09/10 (puntos 1–13) — ver detalle en memoria `project_operacionesps.md`
| # | Reparación | Causa raíz | Deploy |
|---|---|---|---|
| 1 | Pases con monto 0 de origen agencia | pase no cargaba precio×pax | backend + backfill 55 |
| 2 | Adicionales/Cobrar visibles en op cerrada | gate por soloLectura | OPS+PS |
| 4 | Lanchas en tiempo real (Realtime) | poll only | PS+OPS |
| 4.1 | Foto zarpe: compresión + subida desde PS | no comprimía (lenta) | PS+OPS |
| 5 | Pase "estado de cobro 0" en PS | `_caja` faltaba en pases_sueltos + front lo vaciaba | PS v1.54.0 |
| 6 | Blindaje `_adic_sum` (adicionales) | cast crudo reventaba con texto | backend |
| 7 | Contactos multi-tipo + reflejo en picker | ViewLanchas ref privado sin refetch | PS v1.55.0 |
| 8 | Card por nombre + edición grupo + VARIOS | UI confusa; libre intruso | PS v1.56.0 |
| 9 | Cobro pase incluye monto+adicionales | precargaba solo monto_total | PS v1.57.0 |
| 10 | Extras: fuente única precargada | ref perezoso quedaba vacío | PS v1.58.0 |
| 11 | Pill "Aliado" + validaciones OPS | label "Aliado(PaseIn)" confundía | PS v1.59.0 |
| 12 | Libre = VARIOS (CON-00) | guardaba id_contacto vacío | PS v1.60.0 |
| 13 | "Agregar movimiento" por aforo no estado | todas las ops están Cerradas | PS v1.61.0 |

### Sprint 2026-07-11 (reparaciones puntuales — flujo Analizar→Diseñar→Explicar→Reparar→Revisar)
| # | Reparación | Causa raíz | Deploy |
|---|---|---|---|
| P1 | Overland total 0 al embarcar + fusión de duplicados | precio por NOMBRE tomaba el aliado Overland (precio 0); dos contactos "Overland"/"Paracas Overland" | OPS v55 + `admin_fusionar_contactos` + picker con buscador |
| P2 | Reservas a futuro desaparecían del CRM | se filtraban por `creado_por===operador` (myOpName vacío / `crear_reserva`='App') | OPS v55 (muestra futuras+vencidas a todos) |
| P3 | Foto de zarpe: 2ª subida colgaba el sistema | foto como base64 por canal de acciones/cola → bloqueo de hilo | OPS v56 (blob directo a Storage + guard anti doble-tap) |
| P4 | Estado de pago "todo rojo", sin señal de pagado | monto naranja fijo + chip solo para pendientes; colores duplicados inline | PS v1.69.0 (semáforo unificado PAGO_SEMAFORO) |
| P5 | Cobros de pase no aparecían en la pestaña Caja | ops se atribuían al día de la op, pases por ts del pago → un pase cobrado otro día no salía en la Caja de su día | backend get_lanchas_dia (atribuir al día del movimiento) + chip "cobrado DD/MM" · PS v1.70.0 |
| P6 | "Anular pase" daba 404 + faltaba regla mov↔pago | botón llamaba anular_pase(p_mov) sin p_op_nueva (función de 2 args) y sin guard de referencias | guard TIENE_PAGOS en eliminar_movimiento + botón "Anular pago" (eliminar_transaccion) + limpieza flujo roto · PS v1.71.0 |
| P7 | "Cargando" eterno al embarcar reserva (OPS) | `_asignando` optimista nunca se limpiaba; dependía del refetch de fondo, que se salta/cuelga | resolución determinista en el `.then` + watchdogs 12s/15s · OPS v57 |
| P8 | Facturación NubeFact: IGV desviaba el total ±0.01 | `emitir_comprobante`/`_nf_items` reconstruían valor=round(precio/1.18,2); el total de línea no volvía al precio pagado (S/100→100.01/99.99, confirmado en panel NubeFact) | método por RESTA (tot=round(precio*cant,2); valor=round(tot/1.18,2); igv=tot−valor; unitarios a 6 dec) · DB-live (rep. 22) |
| P9 | Facturación NubeFact go-live (lote B2/B3/B4/A1/A3/guards) | anulación ciega + token crudo en bajas + anon con TRUNCATE + NC sin lock + batch zarpe doble-emisión + guards SUNAT faltantes | RAISE en baja si NubeFact error + auth_header unificado + REVOKE a anon + advisory lock NC + local_id estable zarpe + guards (cantidad/tipo↔serie/RUC) + reconcile verifica cliente_doc + RPC atascados · DB-live + OPS v58 + PS v1.72.0 (rep. 23-25) |

### Sprint 2026-07-18 (zarpe IA — cierre del feature cortado + revisión 100x adversarial)
Retoma de un feature a medias (5 jul): el prompt del OCR de zarpe ya estaba endurecido para **letra a mano** (exhaustivo + campo `dudoso`) pero quedó sin cablear. Cierre end-to-end + auditoría money-safety de todo el flujo.

| # | Reparación | Causa raíz | Deploy |
|---|---|---|---|
| P10 | Zarpe IA no propagaba "dudoso" ni permitía corregir | `normalizarPasajeros` descartaba `dudoso`; el frontend no lo mapeaba; `_zarSet` era código muerto (no había inputs) → el gate "revisar" bloqueaba la autoselección pero **no** dejaba corregir un DNI mal leído | Edge propaga `dudoso` (+defensa de formato DNI=8/RUC=11); frontend: dudosos arrancan sin seleccionar, badge "⚠️ revisar", **edición inline** (nombre/doc/tipo) con re-eval espejo del backend · Edge deploy + OPS v60 |
| P11 | Colisión de `local_id` por documento repetido (M1) | 2 pax con el mismo documento comparten `local_id` → el 2º "reusa" (`reusado:true`) el CPE del 1º y se pintaba verde SIN comprobante propio | Pre-check de documento duplicado en la selección (frena + marca revisar); `reusado:true` se cuenta aparte (↺) y no se toma como emisión nueva · OPS v61 |
| P12 | Fuga silenciosa de pax sin facturar (M3) | el toast final solo contaba emitidos/errores → dudosos sin resolver o desmarcados quedaban sin comprobante y sin aviso | Aviso DURO post-emisión "Quedan N pasajero(s) SIN comprobante" · OPS v61 |

**Tests:** batería de regresión `supabase/_test_zarpe.js` (51 casos: `normalizarPasajeros`, `parseJSONRobusto`, paridad cliente↔backend de la re-evaluación, anti-duplicado) + smoke de render (sin undefined, divs balanceados, XSS escapado). Todo verde.

**Reportado FUERA DE ALCANCE (no tocado, backlog):**
- **H1 [ALTA] — re-fotear el mismo zarpe puede duplicar boletas.** Para un pax SIN documento el `local_id` usa la posición del array; re-fotear (otro orden/conteo) cambia la clave → 2ª boleta. Mitigado en parte (los sin-doc ahora son `dudoso`→no auto-seleccionados), pero el fix real necesita persistir el estado "jalado/avance" por operación (la UI del picker del mockup, sin construir).
- **H2 [ALTA latente] — conciliación ciega.** `conciliacion_zarpe`/`marcar_zarpe_pax_facturado`/`listar_zarpe_pax` existen pero **no están cableadas** en el frontend; `conciliacion_zarpe` siempre daría 0 pax facturados/S0. Impacto hoy nulo (nadie la lee); al construir la UI de conciliación, llamar `marcar_zarpe_pax_facturado(idPax, idCPE)` tras cada emisión (requiere que `registrar_zarpe_pax` devuelva el id).
- **M2 [MEDIA inherente al OCR] — DNI leído con confianza pero errado** (`dudoso=false`) se auto-selecciona → boleta a un DNI ajeno. NubeFact no valida DNI en boleta. La edición inline permite revisarlo, pero no hay validación RENIEC. 

### Sprint 2026-08-11/13 (tarifa S/0 en el manifiesto — red de default de tarifa)
| # | Reparación | Causa raíz | Deploy |
|---|---|---|---|
| P13 | Agencias/Libres entraban al manifiesto con monto S/0 (registro directo) | auto-llenado del precio en el front intermitente | red en `registrar_movimiento`/`editar_movimiento`: Agencia/Libre con monto 0 → `precio_defecto` del contacto × pax (precio >0 del operador se respeta) + backfill 7 movs · DB-live 11-ago |
| P14 | **REINCIDENCIA 13-ago**: mismos S/0 pero por OTRO camino — abordar reserva (Sala de Espera) | `asignar_reserva` inserta en `movimientos` DIRECTO (no pasa por `registrar_movimiento`) con `coalesce(p_monto,0)` → la red de P13 no la cubría. Firma del flujo: `local_id` = `temp-asig-*` | misma red dentro de `asignar_reserva` + backfill 10 movs (S/1,425: 9 del 13-ago + 1 del 11-ago) · DB-live 13-ago (`_apply_asignar_reserva_default.js`) |

| P15 | **CIERRE ESTRUCTURAL**: trigger `tg_default_tarifa` a nivel de TABLA | el invariante en RPCs siempre puede ser esquivado por una RPC futura | BEFORE INSERT OR UPDATE en `movimientos` (`_tg_mov_default_tarifa`): Agencia/Libre con monto 0 → `precio_defecto` DEL CONTACTO × pax; excluye Cancelado/Anulado; contacto sin tarifa → deja 0 + aviso `app_eventos` tipo `tarifa_cero` (lo ve JADE). Ningún camino presente o futuro lo esquiva. 10 smokes + regresión RPC + verificación conexión fresca · DB-live 13-ago (`_apply_tg_default_tarifa.js`) |

**PATRÓN RECURRENTE (grabar a fuego):** una "red de seguridad" en una RPC NO cubre el invariante — cubrir TODOS los caminos de escritura (o mejor: subirlo a trigger de tabla, como P15).

### Sprint 2026-08-14 (gratuita del zarpe concilia)
| # | Reparación | Causa raíz | Deploy |
|---|---|---|---|
| P16 | Pax 100% gratis del zarpe (ej. TC) no conciliaba — "ocupa asiento igual" (dueño) | fila all-🎁 emitía CPE de puras líneas gratuitas → guard `GRATUITA_REQUIERE_LINEA_COBRADA` (pensado para cortesía-línea dentro del CPE del grupo) la rechazaba → nunca `facturado` → `pax_facturado` no cerraba | **Boleta 100% gratuita habilitada** (transferencia gratuita SUNAT: total S/0 + `total_gratuita`, valor referencial); FACTURA S/0 sigue bloqueada (`GRATUITA_TOTAL_SOLO_BOLETA` — B2B la cortesía va como línea en la factura del grupo). Guard export intacto. Fronts: PS suelto + OPS muelle emiten solo-cortesía en boleta (botón OPS ya no se atenúa); `medio_pago` null en gratuitas. `_apply_gratuita_total_boleta.js` (smokes solo de RAISE pre-HTTP — **JAMÁS smokes que pasen guards: NubeFact está VIVA, el POST sale aunque haya rollback**) · PS 2.13.0 / OPS v95 |

### Sprint 2026-08-17 (catálogo: CRUD de clientes frecuentes y servicios)
| # | Mejora | Qué faltaba | Deploy |
|---|---|---|---|
| P17 | **Clientes frecuentes** editables desde Catálogo (CRUD total) | solo existía BÚSQUEDA (`buscar_cliente`/`buscar_clientes_like`); `guardar_cliente` no podía VACIAR campos (coalesce) ni corregir el documento (es la PK) y no había forma de listar ni eliminar | RPCs `admin_listar_clientes` (+ conteo de CPEs por cliente y flag `es_varios`), `admin_guardar_cliente` (crea/edita, permite corregir el documento vía `doc_tipo_old`/`doc_numero_old`, valida DNI 8 / RUC 11 con prefijo, vacía campos), `admin_eliminar_cliente`. **VARIOS ('0'/'00000000') protegido**: no se renombra ni se elimina. Editar/eliminar la ficha NO altera los CPE emitidos (guardan su copia) |
| P18 | **Servicios**: ver inactivos, reactivar y controlar el paquete del zarpe | `listar_servicios` filtra `activo` y no expone `activo`/`paquete_zarpe` → el admin no podía reactivar ni saber qué se carga por defecto en el zarpe; "eliminar" solo desactivaba (sin decirlo) | `admin_listar_servicios_full`, `admin_servicio_paquete`, `admin_borrar_servicio_def` (borrado real, **bloqueado si el servicio está en el paquete del zarpe**). UI: toggles "Disponible al facturar" / "🚤 Paquete del zarpe", botón renombrado a "⊘ Desactivar" + "🗑 Borrar definitivamente" con doble confirmación |

| P19 | **Unidad de medida SUNAT real en el CPE** (consulta del dueño: "¿por qué algunos están en NIU si son servicios?") | `_nf_items` mandaba `'ZZ'` **hardcodeado** → la unidad del catálogo era decorativa (TOUR FULL DAY marcado NIU salía ZZ igual: sin daño, pero el campo mentía) y el formulario de alta traía NIU por defecto — el peor default para una empresa de servicios | **Catálogo 03: ZZ = unidad de SERVICIO, NIU = unidad de BIEN.** PS es operador turístico (7912) → todo lo que vende hoy es ZZ; NIU queda para el día que vendan un bien (souvenir/agua). `_nf_items` respeta `i->>'unidad'` con **whitelist dura** (solo NIU; cualquier otra cosa → ZZ, nunca vacío: SUNAT exige el código). Default del catálogo NIU→ZZ (`admin_set_servicio`), TOUR FULL DAY corregido, `get_facturacion_bootstrap` ahora proyecta `unidad` (sin eso el picker del muelle no la conocía). Frontends propagan la unidad del catálogo al ítem (PS suelto + zarpe, OPS muelle); ítem libre → ZZ. **Chips por tipo en el catálogo**: 🛎 Servicio · ZZ (azul) / 📦 Bien · NIU (dorado). `_apply_unidad_medida_real.js` + `_apply_bootstrap_unidad.js` · PS 2.15.0 / OPS v97 |

| P20 | **Tarjeta (4º tipo de pago) con recargo 5% apagable + tipo de pago en el ticket** | el chip solo tenía Efectivo/Virtual/Mixto y el comprobante no mostraba el desglose del pago | Chip cicla ahora **Efectivo → Virtual → Mixto → Tarjeta**. Con tarjeta aparece un chip **● 5%** (encendido por defecto, se apaga con un toque = lo asume la empresa). **REGLA DE DINERO: el recargo NO es un ajuste de UI — es mayor contraprestación** → viaja como **LÍNEA del CPE** (`Recargo por pago con tarjeta (5%)`, misma afectación que la venta, unidad ZZ) para que el comprobante declare exactamente lo cobrado por el POS; el IGV se calcula sobre el total con recargo y se computa solo sobre lo COBRADO (excluye cortesías). Ticket/imagen: fila propia **TIPO DE PAGO** con el detalle (mixto muestra cuánto en efectivo y cuánto en virtual); FORMA DE PAGO queda limpia con el campo SUNAT (CONTADO/CRÉDITO). +fix cosmético: la fecha del ticket ya no muestra la `T` del ISO. PS 2.16.0 / OPS v98 |

| P21 | **"Emitir comprobante" solo PARPADEABA y no emitía** (reporte del dueño) | un servicio del carrito estaba en **S/ 0** (7 del catálogo lo están). El semáforo decía "🟢 sin requisitos pendientes" y el botón estaba habilitado, pero `_facEmitir` rebotaba en la validación de línea en cero (SUNAT 3105) llamando a `_facErr` → que hacía **dos `_facRender()` completos** para un "shake" que **no estaba conectado a ninguna animación** = parpadeo mudo, sin decir qué pasaba | (a) **regla dura nueva** en `_facReglas`/`_facMReglas` que NOMBRA el servicio: «CITY TOUR ICA» está en S/ 0 — ponle precio o márcalo 🎁 → el botón se bloquea ANTES y el semáforo lo explica; (b) el chip de precio en S/0 **palpita en rojo** para ver cuál corregir; (c) `_facErr`/`_facMErr` ya **no re-renderizan** el modal: shake por clase en sitio + aviso persistente dentro del bloque de requisitos. PS 2.16.1 / OPS v99 |

**PITFALL del harness (browsercheck):** el emit del muelle es OPTIMISTA (`_facMSend` sigue en 2º plano). Si un `page.evaluate` encadena dos emisiones **sin ceder el event loop**, ese trabajo pendiente se resuelve fuera del contexto y Playwright aborta con *"Execution context was destroyed, most likely because of a navigation"* — que NO es una navegación real (verificado: OPS quieta 14 s no se recarga). Solución en el test: `await` corto tras cada emisión. Además `_facMSend` llama `SupaAPI.post`, **no** `SupaAPI.emitirComprobante` — stubear la función equivocada deja que el test salga a la red real.

**PITFALL del generador `comprobante-share.js`:** `_build_cpe_module.js` escapaba `\n` pero **no los `\r`** → con `PS/index.html` en CRLF (Windows), el CSS inyectado rompía el string y el módulo salía con `SyntaxError`. Corregido normalizando CRLF→LF al leer. Siempre validar con `node --check comprobante-share.js` tras regenerar.

Backend `_apply_catalogo_clientes_servicios.js` (21 smokes, sin residuos) · UI `ViewCatalogos` (card 🧍 Clientes frecuentes) · PS 2.14.0. Browsercheck 48/48 (Chromium móvil+PC, WebKit móvil) montando el componente Vue REAL con apiGet/apiPost stubeados. Helper nuevo `_psMsg(e)`: los RAISE llegan como `CODIGO: explicación` → se muestra solo la explicación.

⚠ Pendiente de validación en vivo: la 1ª boleta gratuita real contra NubeFact (si rechazara, la fila solo falla y se reintenta — correlativo protegido). Contador: gratuitas del año dentro del límite deducible. Para saber quiénes escriben en una tabla: `pg_get_functiondef` de todas las funciones + `ilike '%insert into%movimientos%'` (hoy insertan: `asignar_reserva`, `pase_desde_reserva`, `registrar_compra_espacio`, `registrar_movimiento`, `registrar_pase_directo`). Los pases van en S/0 por diseño; `registrar_compra_espacio` trae monto propio. El origen de un movimiento se rastrea por el prefijo del `local_id` (`temp-asig-*` = abordaje de reserva).

### 100x (Fase 1) — 2026-07-10 — guards money-safety
- **A1 [ALTA]**: `admin_editar_contacto` no bloqueaba cambio de tipo con historial → borraba deuda del balance. **Fix**: guard TIENE_MOVIMIENTOS.
- **A2 [ALTA]**: CON-00 mutable (nombre/tipo). **Fix**: solo precio.
- **A3 [MEDIA]**: adicionales jsonb no-objeto reventaba balance/board. **Fix**: helpers toleran contenedor + `actualizar_adicionales` rechaza no-objeto.
- **A4 [BAJA]**: colisión de nombre = error crudo. **Fix**: mensaje amable.
- **B1**: div/0 en modal de extras. **Fix**: guard. **B2**: `ps_reads.sql` sincronizado desde prod. Deploy PS v1.62.0.

### 100x del ECOSISTEMA (Fase 3) — 2026-07-10 — seguridad + dinero
3 auditores adversariales sobre TODO el código (OPS, PS, backend). Corregidos:
- **H1 [ALTA seguridad]**: `saldos_iniciales` tenía RLS OFF + grants de escritura a anon → cualquiera con la anon key podía corromper TODOS los balances. **Fix**: RLS on + revoke writes + policy SELECT es_admin (writes solo vía RPC).
- **H2 [ALTA seguridad]**: vistas `v_balance_agencias/v_balance_aliados` sin `security_invoker` → fuga pública de la cuenta por cobrar a anon. **Fix**: `security_invoker=true`.
- **M2 [MEDIA dinero]**: `get_balance_agencias` perdía cobros con `movimiento_id` colgante (sin FK) → 3 cobros reales (S/450) no restaban → deuda inflada (GREEN TRAVEL, HT NAQUA). **Fix**: `abonos` cuenta cobros a agencia con movimiento_id vacío O que no resuelve a un cargo.
- **PS-1 [ALTA display]**: `isIngreso()` en Lanchas invertido ('varios' exigía `[I]`) → un ingreso salía como egreso, neto del día mal ×2, distinto de ViewFinanzas. **Fix**: 'varios' es ingreso salvo `[S]` (= backend/OPS). PS v1.63.0.
- **A1/A3 [MEDIA dinero]**: comisión del comisionado derivaba (recalculada con tarifa VIVA) + lookup por nombre. **Fix (decisión dueño: congelar)**: columna `movimientos.tarifa_base` + trigger `tg_freeze_tarifa` (congela al insertar) + backfill; get_dashboard/get_lanchas_dia proyectan tarifa_base; get_kpis_ops y panel OPS usan la congelada (fallback por ID). Removido código muerto `adicionales="Comision:S/X"`. OPS v52.
- **A2 [ALTA resiliencia]**: `confirmarAsignacion` usaba `fetchPost` (sin cola offline) → fix `fetchPostBg` + toast.
- **PS-2/3 [MEDIA]**: "S/ S/" doble en InsightAgencias · round-trip de extras case-sensitive. **Fix** ambos. PS v1.63.0.
- **Pendiente menor (LOW, backlog):** L2 `get_facturacion_config` sin gate (solo filtra booleanos/correlativos, nunca token) · L1 FKs faltantes (M2 ya cubre el síntoma) · código muerto inerte (RPCs `balance_meses`/`emitir_nota_credito` sin consumidor, login legacy OPS oculto por CSS) · drag-handle en modales de contacto en desktop (cosmético) · Hotel placeholder muestra "Error" en vez de vacío.

### Patrones de error recurrentes (aprendizajes)
- **Doble fuente de un catálogo** (un componente con su propio `ref` perezoso vs `catalogosCache` compartido) → el nuevo dato no se refleja. **Regla**: usar la fuente única reactiva `catalogosCache`.
- **Validar por estado en vez de por la condición real** (ej. botón por `estado==='Abierta'` en vez de por aforo) → se rompe cuando el estado cambia. **Regla**: validar por la condición de negocio (aforo, refs), no por un estado proxy.
- **Gate interno insuficiente en RPC** (solo `_req_admin` sin guard de datos) → una RPC puede alterar dinero por PostgREST directo aunque el front la use bien. **Regla**: el guard de negocio va en el backend, no solo en el front.
- **jsonb sin validar el contenedor** → un no-objeto revienta vistas enteras. **Regla**: validar tipo del contenedor + tolerar en los helpers.
- **`?v=` de scripts + `VERSION` de sw.js** deben bumpearse o el JS viejo cacheado no aplica.
- **Tabla base con RLS OFF + grants a anon** = puerta trasera: se puentea el gate de la RPC. **Regla**: TODA tabla de dinero/config con RLS on; escrituras solo vía RPC SECURITY DEFINER.
- **Vista owner=postgres sin `security_invoker`** = fuga: corre con privilegios del owner y puentea el RLS de las tablas base → anon la lee. **Regla**: vistas de datos sensibles con `security_invoker=true` (o gate por RPC).
- **Referencia sin FK** (ej. caja→movimiento) = filas colgantes que un cálculo puede descartar en silencio → dinero perdido del reporte. **Regla**: contar fallbacks para refs que no resuelven, o poner FK.
- **Clasificación por convención de texto** (ej. `[I]`/`[S]` en comentarios) DEBE ser idéntica en front y backend; un lado invertido duplica/pierde el signo. **Regla**: una sola definición, compartida.
- **Valor que puede cambiar en el catálogo pero debe quedar fijo en el histórico** (ej. tarifa de comisionado) → **congelar** al crear (guardar el valor en la fila), nunca recalcular con el valor vivo.
- **Subir archivos grandes (fotos) como base64 dentro de un payload JSON / cola offline** → bloquea el hilo (JSON.stringify/parse de varios MB) y, si se encolan en localStorage, cuelga el sistema (síncrono + límite ~5MB). **Regla:** subir el **BLOB directo** a Supabase Storage (`sb.storage.upload(blob)`) + guardar solo el URL por RPC; nunca pasar la imagen como base64 por el canal de acciones. (Foto de zarpe: OPS y PS suben el blob directo, con guard anti doble-tap.)
- **IGV/impuesto por reconstrucción del valor sin IGV** → si calculas `valor = round(precio/1.18,2)` y reconstruyes el total (`valor + round(valor*0.18,2)`), para muchos precios el total **no regresa al precio que pagó el cliente** (S/100 → 100.01; S/120 → 119.99), y el mismo importe da totales distintos según cómo partas los ítems. NubeFact/SUNAT validan por línea `precio_unitario ≈ valor_unitario + IGV` → rechazo "el valor de venta no coincide". **Regla (IGV por RESTA):** ancla en lo que paga el cliente → `total_línea = round(precio*cant,2)`; `valor = round(total/1.18,2)`; `IGV = total − valor` (nunca `round(valor*0.18)`). `valor_unitario = valor/cant` con **≥6 decimales** para que `valor_unitario×cantidad` cuadre exacto con cantidad>1. Mismo cálculo en la cabecera (buckets) y en las líneas. Confirmado contra el panel real de NubeFact (facturación PS, reparación 22).
- **Estado optimista (spinner/"cargando") que solo se limpia por un refetch de fondo** → si el refetch se salta (hay un modal abierto o un POST en vuelo) o se cuelga (una promesa que nunca resuelve deja un flag `_bgFetchInProgress`/lock en true y congela TODOS los refrescos), el card queda en "cargando" ETERNO aunque la acción SÍ se guardó. **Regla:** resolver el estado optimista **determinísticamente en el `.then`/`.catch` de la propia acción** (limpiar el flag, fijar el id real, o revertir en error), nunca depender solo de un refresco posterior. Añadir **watchdogs de timeout** (a la acción y al refetch con `Promise.race`) para que ninguna promesa colgada deje la UI o el lock pegados. (OPS embarcar reserva: `confirmarAsignacion` + `fetchDashboardDataBg`, OPS v57.) Relacionado: [[architecture_ps_getsession_hang]] (supabase-js puede colgarse sin timeout).
- **Borrar un registro con referencias en otra tabla maestra** → se elimina/cancela el "padre" y queda una fila colgando (un pago sin su movimiento). **Regla del dueño (dirección única, `caja_operador` es la tabla maestra de OPS):** un **movimiento NO se anula si tiene pagos anexados** en `caja_operador` (guard `TIENE_PAGOS` en `eliminar_movimiento`, con conteo y mensaje que dice anular primero el pago); un **pago SÍ se anula** aunque referencie un movimiento (`eliminar_transaccion`). El guard va en el backend (única fuente de verdad); el front muestra el motivo sin el prefijo-código. Además: una RPC con N args obligatorios (`anular_pase(p_mov,p_op_nueva)`) llamada con menos args da "could not find function public.X(args) in the schema cache" (PostgREST resuelve por firma/args recibidos, no solo por nombre) → mandar todos los args o darles default.
- **Atribución de un cobro a un DÍA inconsistente entre canales** → el mismo tipo de dato (un cobro) se agrupaba por criterios distintos: los de operación por el día de la op, los de pase por la fecha del pago (ts). Resultado: un pase cobrado días después salía en la Caja del día del pago, no del pase → "no aparece" en el día donde el usuario lo busca. **Regla:** todo cobro ligado a un movimiento/pase se atribuye al **día del movimiento** (`registrado_at`), no al día en que entró el efectivo; solo la caja suelta real (sin movimiento) va por ts. Si el pago fue en otra fecha, marcarlo con un **chip** ("cobrado DD/MM") en vez de moverlo de día. Finanzas es el canal cronológico por fecha real de pago. Fallback money-safe: si la ref al movimiento es colgante, incluir por ts (nunca ocultar dinero). (Caja Lanchas, `get_lanchas_dia.cdia.incluir`, PS v1.70.0.)
- **Estado de pago poco legible: sin señal positiva de "pagado"** → si solo marcas los pendientes (chip rojo/ámbar) y los cobrados no muestran nada, el ojo lee "todo pendiente/rojo" y no distingue rápido. **Regla (semáforo):** una **fuente única** de color+ícono por estado (`PAGO_SEMAFORO`: pagado=✓ verde · parcial=½ ámbar · por cobrar=! rojo · sin cobro=gris) aplicada al **monto** (color) **y** a un badge **siempre visible** (incluye ✓ verde en pagado). Nunca dupliques los colores/íconos inline en cada lista → un solo mapa reutilizado (PS v1.69.0, pases + movimientos). Además: `total<=0 → sin_cobro` (un pase de S/0 no es "te deben").
- **Filtrar por "dueño/mío" un dato que el sistema no siempre atribuye** → el dato desaparece. Ej.: las reservas a futuro se filtraban por `creado_por === operador`, pero `myOpName` suele estar vacío y `crear_reserva` guarda `creado_por='App'` → nunca coincidía → la reserva solo se veía en el estado optimista y desaparecía al recargar. **Regla:** si el atributo de dueño no es confiable/obligatorio, NO filtres por él (muestra a todos); un dato registrado debe ser visible siempre. (Reservas: futuras y vencidas se muestran a todos.)
- **Gate que BLOQUEA pero no deja CORREGIR** → una marca de "revisar/dudoso" que solo desactiva la autoselección da falsa sensación de control: si la única acción es tildar (que confirma el dato tal cual), un valor mal leído por la IA se emite igual. **Regla:** si un dato entra por OCR/IA a un path fiscal/dinero, junto al gate de revisión SIEMPRE va la vía de edición inline para arreglarlo, con re-evaluación que use la MISMA regla del backend (evita que UI y servidor discrepen en qué es válido). Un dato que queda inválido tras editar se DESARMA (no puede seguir seleccionado para emitir). (Zarpe IA `dudoso` + `_zarReeval` espejo de `normalizarPasajeros`.)
- **Dedup por clave "estable" que depende de un dato variable** (ej. `local_id` = operación+documento) → cuando ese dato falta o varía (documento vacío→posición del array; OCR que lee distinto en cada foto) la clave cambia y el dedup NO atrapa el duplicado; y al revés, dos entidades distintas con el mismo dato COLISIONAN en la misma clave y una "reusa" el registro de la otra. **Regla:** la clave de idempotencia debe derivar de una identidad inequívoca y persistida de la fila (no recalculada por posición), y una respuesta `reusado:true` NO es una emisión nueva: cuéntala aparte y verifica que no sea colisión. (Zarpe: pre-check de documento repetido antes de emitir; `reusado` contado como ↺.)

---

## 9. JADE — el agente (persona y capacidades)

**Quién es JADE:** el asistente del ecosistema PS que vive flotante y animado en PS Panel. Amable, gentil, claro y proactivo. Habla como un colega senior que conoce el negocio de Paty al dedillo.

**Dos modos:**
- 🗣️ **Consulta / tutor (para el admin):** responde con datos + reglas. Ej. *"¿cuánto nos debe Almora?"* → lee `v_balance_agencias`. *"¿dónde registro un movimiento?"* → enseña el flujo §5.1. Explica reglas del negocio con paciencia.
- 🔧 **Programador (con Luis + Claude Code):** cuando lo llaman como programador, ayuda a reparar/actualizar data, lee esta biblia + el Log (§8), y mantiene el registro de reparaciones.

**Conocimiento:** senior en programación (para reparaciones), marketing, gestión, administración, tecnología, pensamiento crítico + conocimiento general. Educado y gentil.

**Reglas de JADE:**
1. La verdad del negocio está en esta biblia + la data viva de Supabase. Si no lo sabe, lo dice (no inventa cifras).
2. Distingue contactos por id, respeta las reglas money-safety (§6) y las directrices (§7).
3. Es retroalimentable: si el negocio cambia (ej. se dibuja el Hotel), esta biblia se amplía y JADE aprende.
4. Trato siempre amable; enseña, no solo ejecuta.

**Motor:** reutiliza **Claude** (`claude-sonnet-4-6`) + la **misma `ANTHROPIC_API_KEY`** de las Edge Functions de zarpes/compras, vía una Edge Function nueva `jade-chat` (texto + herramientas para leer balances). Patrón seguro: exige sesión real.

**Estado (2026-07-10): CONSTRUIDA Y VIVA.**
- Edge Function: `OperacionesPS/supabase/functions/jade-chat/index.ts` (desplegada). Para cambiar lo que JADE sabe → editar el `SYSTEM` (esta biblia condensada) y `supabase functions deploy jade-chat --project-ref lintmcxqxnrholslatul`. Para agregar herramientas de lectura → sumar al array `TOOLS` + `runReadTool`.
- Widget: PS Panel `index.html` (FAB 💎 flotante + panel de chat, CSS `.jade-*`). Escrituras confirmables whitelist en `JADE_WRITE_OK` (hoy `registrar_pago`, `actualizar_contacto`).
- **Permisos:** lectura + escritura **con confirmación** del admin en pantalla.
- **Retroalimentación:** cuando el negocio cambie (ej. Hotel), amplía esta biblia y el `SYSTEM` del Edge; JADE aprende sin re-explicar todo.

---

*Fin de la biblia v1. Este documento crece. Toda reparación que cambie una regla debe reflejarse aquí.*
