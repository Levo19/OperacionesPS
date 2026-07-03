# Guía de activación — Facturación PS con NubeFact (go-live)

Esta guía es para cuando abras la cuenta de NubeFact y quieras pasar de **modo demo (stub)** a **emisión real a SUNAT**. Todo lo de PS ya está construido; esto es solo "enchufar".

---

## Paso 0 — Crear la cuenta NubeFact
1. Entra a **https://www.nubefact.com** → crea cuenta con el **RUC de la empresa**.
2. NubeFact pide tus credenciales de **SUNAT (Clave SOL)** para registrarse como tu **PSE/OSE** (proveedor que envía a SUNAT por ti). Esto es un paso único.
3. Empieza en el **ambiente de PRUEBAS (demo)** de NubeFact antes de producción.

## Paso 1 — Crear las series B002 y F002 en NubeFact
> El sistema rentado viejo usaba FA01/BA01. PS arranca limpio con series nuevas.

En NubeFact → **Configuración → Series y correlativos** (o "Comprobantes"):
- Crear serie **B002** para **Boleta de venta electrónica**, correlativo inicial **1**.
- Crear serie **F002** para **Factura electrónica**, correlativo inicial **1**.

⚠️ Deben quedar **idénticas a PS** (B002/F002 arrancando en 1). Si en PS cambiaste las series (Ajustes → Serie activa), crea esas mismas en NubeFact.

## Paso 2 — Copiar la RUTA y el TOKEN de la API
En NubeFact → **Integración / API** (a veces "Conexión" o "API propia"):
- **RUTA (URL del API)**: algo como `https://api.nubefact.com/api/v1/XXXXXXXX...`
- **TOKEN**: una cadena larga (es el "Authorization" de las peticiones).

> Empieza con la RUTA/TOKEN del **ambiente de DEMO** para validar sin afectar SUNAT.

## Paso 3 — (Opcional) API de consulta RUC/DNI
Para autocompletar el nombre del cliente al tipear su documento:
- Crear cuenta en **https://apis.net.pe** o **https://decolecta.com** (tienen plan gratis/barato).
- Copiar su **URL base** y **token**. Ejemplos de URL base:
  - apis.net.pe RUC: `https://api.apis.net.pe/v2/sunat/ruc?numero=`
  - apis.net.pe DNI: `https://api.apis.net.pe/v2/reniec/dni?numero=`
- (Si no lo pones, simplemente se escribe el nombre a mano. No es obligatorio.)

## Paso 4 — Pegar todo en PS (1 minuto)
En el **Panel PS** → menú → **🧾 Facturación** → pestaña **Ajustes** → **Conexión NubeFact**:
1. Pega la **RUTA** y el **TOKEN** de NubeFact.
2. (Opcional) Pega la **URL + token** del API RUC/DNI.
3. Verifica en **Serie activa** que diga **B002 / F002** (o las que creaste).
4. Verifica en **Correlativos** que estén en **0** (próximo = 1), igual que NubeFact.
5. Prende **"Emitir de verdad (enviar a SUNAT)"** → Guardar conexión.

Los tokens se guardan **cifrados en la base** (tabla con RLS), nunca en el navegador.

## Paso 5 — Probar en DEMO
1. Emite una **boleta de prueba** desde el panel (o el muelle si lo habilitaste).
2. Debe volver con **estado "aceptada"** + **PDF clickeable** + QR.
3. Revisa que el **número** sea B002-1, B002-2… consecutivo.
4. Avísame: aquí validamos juntos el **payload exacto** (el header de auth y los
   nombres de campos pueden necesitar un ajuste fino según tu cuenta NubeFact —
   está marcado con ⚠️ en el código y es el último detalle del 100X).

## Paso 6 — Pasar a PRODUCCIÓN
1. En NubeFact, activa el **ambiente de producción** (y crea allí B002/F002 desde 1).
2. En PS Ajustes, reemplaza la **RUTA/TOKEN** por los de **producción** y modo = produccion.
3. Emite una boleta real pequeña como prueba final.

---

## Reglas que ya respeta el sistema (no te preocupes por esto)
- **NubeFact manda el número oficial**: PS solo avanza el correlativo cuando NubeFact responde; si hay timeout, no se "quema" el número y se reintenta el mismo.
- **Idempotencia**: doble-tap o reintento no duplica comprobantes.
- **Doble candado en el muelle**: el operador solo ve/usa facturación si el admin la prende desde PS, y el backend lo re-verifica.
- **IGV 18%** automático, con toggle **exonerado** para turismo receptivo (confirma este punto con tu contador).
- **Anulación**: desde el Historial (genera nota de baja en NubeFact cuando está activo).

## Checklist rápido de go-live
- [ ] Cuenta NubeFact creada (RUC + Clave SOL)
- [ ] Series B002 (boleta) y F002 (factura) creadas en NubeFact desde 1
- [ ] RUTA + TOKEN demo pegados en PS Ajustes
- [ ] (Opcional) API RUC/DNI configurado
- [ ] "Emitir de verdad" prendido
- [ ] Boleta de prueba aceptada en demo + payload validado
- [ ] Cambiado a producción
