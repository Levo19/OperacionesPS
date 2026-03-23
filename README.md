# Sistema de Gestión de Operaciones Turísticas (SOT MVP) 🚤

Este es el Producto Mínimo Viable (MVP) para el **Sistema de Gestión de Operaciones Turísticas (SOT)**. Está diseñado como una *Single Page Application (SPA)* enfocada en la movilidad (Mobile-First) para el control dinámico de zarpes, manifiestos de pasajeros y caja de operadores portuarios. Funciona con un backend serverless soportado por Google Apps Script y Google Sheets como base de datos.

## 🌟 Funcionalidades Principales

### 1. 🚢 El Muelle (Gestión de Operaciones)
El núcleo de la logística portuaria. Permite al operador gestionar embarcaciones en tiempo real:
- **Abrir Nueva Lancha:** Asignación inmediata de una Embarcación, un Capitán y un Guía (filtrado automáticamente para mostrar solo recursos *disponibles*). 
- **Gestión de Manifiesto (Gestión de PAX):** Capacidad de ingresar pasajeros directamente a la lancha antes de zarpar. Permite:
  - Venta directa a "Familia/Apellido".
  - Venta o Pase de "Agencias/Aliados" con cálculo automático de tarifas predeterminadas.
  - Interfaz de abordaje (Modal de gestión) que muestra la capacidad restante y un progreso visual de llenado de la lancha.
- **Acción "Zarpar" y Múltiples Viajes:** 
  - Una lancha cargada puede ser marcada como **Zarpada**. Al hacerlo, el estado de la operación cambia a **"En Viaje"** (destacado en la interfaz con etiquetas y bordes naranjas).
  - **Liberación de Recursos:** Zarpar una lancha de forma inmediata libera la Embarcación, al Capitán y al Guía en la base de datos. Esto es vital para puertos dinámicos donde un capitán que zarpó hace 1 hora ya está retornando, y el operador en el muelle puede ir *abriendo y armando el siguiente viaje* con esa misma lancha (y capitán) asignada mientras el turno anterior sigue marcado "En Viaje".
  - **Manifiesto de Viaje:** Las lanchas "En Viaje" desactivan su botón de cargar pasajeros reemplazándolo por un modo "Ver Manifiesto", el cual está protegido ocultando de forma nativa los formularios de venta rápida.

### 2. 🛋️ Sala de Espera (Reservas / CRM)
Sistema ágil de check-in y agenda para pasajeros que compraron pasajes pero aún no abordan.
- **CRM Fácil:** Registro de reservas rápidas indicando fecha, hora, tipo de venta, origen (Agencia o Directo), cantidad de PAX y Total en Soles.
- **Vista Inteligente:** Las reservas programadas para el propio día aparecen listas, de colores vivos y operativas. Las reservas a futuro se apagan en tonos grises para no sobrecargar visualmente al operador.
- **Abordaje a Lancha:** El botón verde "Abordar Lancha" permite trasladar los PAX en sala de espera directamente hacia una Operación (viaje) Abierta, bastando con teclear el código identificador único de la lancha (`OP-XXXX`).

### 3. 💸 Movimientos y Caja (Caja Ext.)
Registro del flujo extra en el área del puerto en el turno actual.
- **Caja Chica:** Cuando el operador recibe fondos en efectivo.
- **Retiro Jefatura:** Cuando ocurre un descargo o corte de entrega de efectivo.
- **Historial en Vivo:** Listado continuo que registra cada entrada/salida de dinero con sus signos (+/-) y estampas de tiempo reales.

### 4. 🏁 Liquidación y Cierre de Turno
Proceso diseñado para culminar las operaciones del día y auditar:
- Panel interactivo para adjuntar o tomar foto in-situ del manifiesto/papel de Zarpe Oficial.
- Función "LIQUIDAR Y CERRAR" que engloba ventas, pax y caja para la generación del PDF o comprobante del operador (En consolidación de APIS).

## 🏗️ Arquitectura y Tecnologías

- **Frontend UI/UX:** 
  - 100% *Vanilla JavaScript* + HTML5.
  - El diseño visual se soporta en **Tailwind CSS** vía CDN, otorgándole estilo de App nativa Mobile-first (modales fluidos tipo bottom-sheet, transiciones pulidas, barras de progreso y diseño "glassmorphism" en overlays).
  - **Optimistic UI:** El frontend inyecta operaciones, sumatorias de PAX y registros artificialmente con la estampa visual `(Sincronizando...)`, dejando interactuar al operador libremente y sin bloqueos de red mientras el backend registra en Google Sheets en segundo plano.

- **Backend / API (Serverless):** 
  - Desarrollado en **Google Apps Script (`Codigo.gs`)** operando como un motor y controlador REST sobre rutinas POST/GET nativas de GAS.
  - Contiene las validaciones matemáticas (cruces de aforo límite) para no permitir la sobreventa o doble embarque accidental de pasajeros simultáneos en bases concurrentes.

- **Storage / Base de Datos:** 
  - Servido puramente en ecosistema Workspace con Google Sheets.
  - Tablas transaccionales: *Embarcaciones, Personal, Contactos, Reservas_CRM, Operaciones, Movimientos, Caja_Operador*.

## 📁 Estructura del Proyecto

```text
/
├── index.html        # SPA Layout, Bottom Navigation Bar y Modales Tailwind
├── app.js            # Lógica cliente, fetch async, renderizadores de estado
├── Codigo.gs         # Controlador de Base de Datos y APIs en Google Apps Script
└── README.md         # Documentación integral del MVP SOT
```

## 🚀 Despliegue Configurado
Las URLs están embebidas en el repositorio. Para cualquier clonación, referenciar a la implementación real compilada del GAS en la constante `GAS_URL` de `app.js` y hacer _Deploy as Web App_ en el IDE de script de Google.

---
*MVP consolidado para proveer agilidad extrema frente a operaciones en muelle con alta presión temporal y de atención al turista.*
