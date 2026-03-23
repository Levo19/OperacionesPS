# Sistema de Gestión de Operaciones Turísticas (SOT MVP) 🚤

Este es el Producto Mínimo Viable (MVP) para el **Sistema de Gestión de Operaciones Turísticas (SOT)**. Está diseñado como una *Single Page Application (SPA)* enfocada en la movilidad (Mobile-First) para el control dinámico de zarpes, manifiestos de pasajeros y finanzas de operadores portuarios. Funciona con un backend serverless soportado por Google Apps Script y Google Sheets como base de datos.

## 🌟 Funcionalidades Principales

### 1. 🚢 El Muelle (Gestión de Operaciones)
El núcleo de la logística portuaria. Permite al operador gestionar embarcaciones en tiempo real:
- **Abrir Nueva Lancha:** Asignación inmediata de una Embarcación, un Capitán y un Guía (filtrados automáticamente para mostrar solo recursos *disponibles* o desocupados). 
- **Gestión de Manifiesto (Gestión de PAX):** Capacidad de ingresar pasajeros directamente a la lancha antes de zarpar. Permite:
  - Venta directa a "Familia/Apellido".
  - Venta o Pase de "Agencias/Aliados" con cálculo automático de tarifas predeterminadas.
  - Interfaz de abordaje interactiva: las tarjetas de cada movimiento ahora revelan (al hacer click) acciones rápidas para **Pagar** un saldo pendiente o **Derivar** a un aliado.
- **Acción "Zarpar" y Múltiples Viajes:** 
  - Una lancha cargada puede ser marcada como **Zarpada**. Al hacerlo, el estado de la operación cambia a **"En Viaje"** (destacado visualmente en el panel).
  - **Liberación Inmediata de Recursos:** Zarpar una lancha libera la Embarcación, al Capitán y al Guía en la base de datos permitiendo armar las siguientes salidas de inmediato.
- **Derivación (Pases Emitidos):** Sistema revolucionario que permite ceder (derivar) pasajeros ya embarcados a una empresa Aliada. Esto crea un registro de "Pase Emitido a X", libera el aforo de la lancha actual, y computa a nivel contable (como un "Favor") para futuras reconciliaciones.

### 2. 🛋️ Sala de Espera (Reservas / CRM)
Sistema ágil de check-in y agenda para pasajeros que compraron pasajes pero aún no abordan.
- **CRM Fácil:** Registro de reservas rápidas indicando fecha, hora, tipo de venta, origen (Agencia o Directo), cantidad de PAX y Total en Soles.
- **Vista Inteligente:** Reservas programadas para hoy aparecen destacadas; las futuras se apagan visualmente.
- **Abordaje a Lancha:** El botón verde "Abordar Lancha" permite subir los pasajeros de la sala de espera directamente a un ID de Operación abierto.

### 3. 💸 Movimientos y Caja (Caja 2.0)
Registro central del flujo financiero y corporativo del puerto en el turno actual con un diseño *banking-like*.
- **Panel de Finanzas de Hoy:** Muestra de forma gigante el **Balance Efectivo/Digital** (Ingresos totales menos Salidas) junto al desglose respectivo.
- **Panel de Pases (Favores):** Computación en tiempo real de deudas intangibles. Unifica los "Pases Recibidos" (Aliado nos debe) menos "Pases Emitidos" (Nosotros derivamos y les debemos) para arrojar un **Saldo Final** por cada Agencia del muelle.
- **Modal de Transacciones:** Visualización moderna (estilo Yape/App Bancaria) del recibo (voucher) que detalla método de pago, fecha exacta y operador, accesible con un solo toque sobre cualquier movimiento.
- **Botones Inteligentes de Caja:** "Caja Chica" (+) y "Retiro" (-) mediante modales configurables para aceptar Transferencia, Efectivo, Yape o Plin.

### 4. 🏁 Liquidación y Cierre de Turno
Proceso diseñado para culminar las operaciones del día y auditar:
- Contiene el formulario y flujos destinados a la impresión de reportes y cruce final del operador antes de salir de turno.

## 🏗️ Arquitectura y Tecnologías

- **Frontend UI/UX:** 
  - 100% *Vanilla JavaScript* + HTML5.
  - Diseño con **Tailwind CSS** vía CDN, otorgándole estilo de App nativa Mobile-first (modales fluidos tipo bottom-sheet, transiciones pulidas, doble validación en click para acciones críticas, y diseño "glassmorphism" en overlays de balances).
  - **Optimistic UI Refinada:** El frontend inyecta operaciones (Nuevos registros o Derivaciones) instantáneamente con labels de `(Cargando...)` o `(Sincronizando...)`, bloqueando el formulario lo justo e impidiendo doble sumisión, pero manteniendo la lectura intacta mientras el backend trabaja en segundo plano.

- **Backend / API (Serverless):** 
  - Desarrollado en **Google Apps Script (`Codigo.gs`)** operando como un controlador REST sobre doPost/doGet nativos de GAS.
  - Control de Pases en "Background": Mapea las derivaciones al estado lógico `EXTERNO` dentro de la Hoja de `Movimientos` para no ensucia el manifiesto de la lancha original.

- **Storage / Base de Datos Sheets:** 
  - Servido puramente en Google Sheets con las tablas transaccionales: *Embarcaciones, Personal, Contactos, Reservas_CRM, Operaciones, Movimientos, Caja_Operador*.
  - Las uniones complejas (JOINs) entre los balances de Caja\_Operador, Pases Recibidos y Emitidos se calculan a nivel Frontend iterando la recolección global optimizada en una sola llamada `fetchDashboardData`.

## 📁 Estructura del Proyecto

```text
/
├── index.html        # SPA Layout, Bottom Navigation Bar, y docenas de Modales Tailwind
├── app.js            # Lógica PWA/SPA, state management local, optimismo y calculadoras
├── Codigo.gs         # Endpoints Google Apps Script, validaciones lógicas de aforo
└── README.md         # Documentación integral del MVP SOT
```

## 🚀 Despliegue Configurado
Las llamadas están puenteadas en la constante `GAS_URL` alojada en `app.js`. Asegurarse de realizar _Deploy as Web App_ en el entorno GAS y asignar permisos públicos para ejecución de Scripts antes de correr en producción.

---
*MVP consolidado para proveer agilidad extrema frente a operaciones en muelle con alta presión temporal y manejo en efectivo.*
