# Sistema de Gestión de Operaciones Turísticas (SOT MVP) 🚤

Este es el Producto Mínimo Viable (MVP) para el **Sistema de Gestión de Operaciones Turísticas (SOT)**. Está diseñado como una *Single Page Application (SPA)* enfocada en la movilidad (Mobile-First) para control de zarpes, pasajeros y caja de operadores portuarios, con un backend serverless soportado por Google Apps Script y Google Sheets.

## Características Principales 🌟

1. **Gestión de Operaciones (El Muelle):** Control de embarcaciones abiertas en el día, capacidad en tiempo real (barra de progreso visual) y asignación de pasajeros.
2. **Sala de Espera (Reservas CRM):** Recepción de pasajeros desde agencias u origen directo, con opciones para asignar rápidamente a botes o registrar cobros de último minuto.
3. **Control de Caja Estricto:** Registro aislado de movimientos extraordinarios (Caja Chica, Retiros de Jefatura y cobros de turno), manteniendo las finanzas separadas de la logística de muelle.
4. **Cierre de Turno:** Consolidación guiada que exige la subida de una foto del Zarpe físico y cálcula automáticamente la liquidación del turno del operador (`Total a Entregar = Cobros Efectivo + Caja Chica - Retiro Jefatura`).

## Arquitectura del Proyecto 🏗️

- **Frontend:** HTML5, CSS3, Vainilla JavaScript (SPA robusta sin frameworks pesados) + **TailwindCSS** (vía CDN) y FontAwesome para íconos. Interfaz UI orientada 100% a dispositivos móviles/tablets con *Bottom Navigation Bar* estilo app nativa.
- **Backend (API):** Google Apps Script (`Codigo.gs`) exponiendo endpoints GET/POST (JSON).
- **Base de Datos:** Google Sheets. (Las tablas estrictas requeridas: *Embarcaciones, Personal, Contactos, Reservas_CRM, Operaciones, Movimientos, Caja_Operador*).
- **Almacenamiento de Archivos e Impresión:** Google Drive (Fotos de Zarpes físicos) y Google Docs (Templates para generar el PDF A4 de la liquidación).

## Estructura de Archivos 📁

```text
/
├── index.html        # Estructura principal, vistas (4 pestañas) y diseño Tailwind.
├── app.js            # Lógica del frontend (navegación, simulación Fetch, modales).
├── Codigo.gs         # Lógica del backend para Google Apps Script.
└── README.md         # Documentación y guía de despliegue.
```

## Guía de Despliegue 🚀

### 1. Configurar el Backend (Google Apps Script)
1. Crea un nuevo **Google Sheets** y nombra las pestañas (`Operaciones`, `Reservas_CRM`, `Caja_Operador`, `Movimientos`, etc).
2. Ve a **Extensiones > Apps Script**.
3. Copia el contenido de `Codigo.gs` y pégalo allí.
4. **Súper Importante:** Reemplaza la constante `SPREADSHEET_ID` en `Codigo.gs` por el ID real de tu hoja de cálculo (lo encuentras en la URL de tu Google Sheet).
5. Dale clic al botón azul arriba a la derecha: **Implementar > Nueva implementación**.
    - Selecciona el tipo de engranaje **Aplicación Web**.
    - Ejecutar como: *Tú*.
    - En *Quién tiene acceso*, elige **Cualquier persona**.
    - Autoriza los permisos de Drive/Sheets si Google te lo pide.
6. Copia la **URL de la aplicación web** generada (termina en `/exec`).

### 2. Configurar el Frontend (GitHub Pages)
1. Abre el archivo `app.js` en tu editor de código.
2. Reemplaza el valor de la constante `GAS_URL` (Línea 2) por la **URL de la aplicación web** que acabas de copiar.
3. Sube los archivos (`index.html`, `app.js`, `README.md`) a tu repositorio de GitHub.
4. En GitHub, ve a la pestaña **Settings** (Configuración) de tu repositorio.
5. Selecciona en la barra lateral: **Pages**.
6. En *Branch*, selecciona tu rama principal (`main` o `master`) y dale a *Save*.
7. ¡Listo! En uno o dos minutos, GitHub te dará el enlace público para usar tu SOT MVP compartiendo un enlace universal que tus operadores pueden guardar en la pantalla de inicio de su celular.

## Licencia y Uso
MVP construido para logística y operaciones portuarias privadas. Prohibido su uso comercial para terceros sin autorización.
