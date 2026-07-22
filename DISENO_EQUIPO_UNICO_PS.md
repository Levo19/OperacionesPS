# Equipo Único PS — identidad unificada del grupo (diseño)
**v0.1 propuesta · 2026-07-22 · README vivo**

## Idea de Luis
Una sola jerarquía de empleados para TODO el ecosistema PS (no una tabla por app como hoy:
`app_usuarios` en OperacionesPS/PS + PINs). Entrada por **Google Auth (Gmail)**, con **invitación**
del admin y **acceso por app** controlado desde PS Panel.

## Veredicto: SÍ, con arquitectura híbrida y migración por fases
La identidad se unifica YA; cada app cambia su "puerta" a su ritmo. Regla de oro: **es_staff()/es_admin()
sostienen TODO el dinero del muelle y del hotel — jamás se rompen durante la migración** (dual-run).

### La trampa a evitar
El muelle opera con PIN en dispositivos compartidos y con presión de tiempo. Forzar Gmail ahí puede
doler en operación. Por eso: **una sola IDENTIDAD, dos llaves de entrada** — Google OAuth (gestión:
PS Panel, MunayOps, Landing) y PIN (campo: muelle) — ambas apuntando a la MISMA persona.

## Modelo (Supabase PS)
```
personal          (id, nombre, email gmail UNIQUE, telefono, activo,
                   auth_uid,          -- se vincula solo en el 1er login Google (match por email del JWT)
                   pin_uid,           -- puente al auth id@paracas.local existente (muelle)
                   invitado_por, invitado_at, aceptado_at)
personal_accesos  (personal_id, app, rol, activo)   -- app: 'ps'|'muelle'|'hotel'|'landing'…
                                                    -- rol: 'admin'|'operador'|'recepcion'…
```
- Helpers nuevos: `mi_persona()`, `acceso_app(p_app) → rol|null`, `es_admin_app(p_app)` —
  resuelven por `auth.uid()` contra `personal.auth_uid` **o** `personal.pin_uid` (las dos llaves).
- `es_staff()`/`es_admin()` (legacy, dinero) se REESCRIBEN para leer `personal` con fallback a
  `app_usuarios` mientras dure el dual-run. Cero cambios en las RPCs de dinero.
- Flujo invitación: admin en PS Panel → "＋ Invitar" (gmail + apps + rol) → fila `personal`
  (invitado) → la persona entra con Google → si su email está invitado y activo, se vincula
  `auth_uid` y entra; si no, "no autorizado" (patrón Lourdes probado). Anti-lockout: un admin
  no puede quitarse a sí mismo ni degradarse (lección Lourdes).

## Módulo "Equipo" en PS Panel (admin)
Lista del personal (una card por persona, chips por app con su rol), ＋Invitar por Gmail,
activar/pausar por app o global, y "compartir invitación" por WhatsApp. Estándar inmersivo.

## Fases (sin downtime, dinero intacto)
1. **F1**: tablas + helpers + backfill desde `app_usuarios` (pin_uid=auth_uid actual; emails vacíos
   hasta que el admin los complete) + módulo Equipo en PS Panel + Google provider en Supabase PS
   (⚠️ requiere client id/secret de Google Cloud — mismo trámite que hicimos en Lourdes).
2. **F2 piloto**: MunayOps acepta Google además de PIN (app nueva, sin costumbre = piloto ideal).
3. **F3**: PS Panel admin entra con Google (Patricia con su Gmail).
4. **F4**: decisión muelle: mantener PIN para siempre (válido — es la llave "de campo") o migrar.
5. **F5**: retirar app_usuarios cuando nada lo lea (o dejarlo como espejo del muelle).

## Pendiente para arrancar
- OK de Luis a la arquitectura híbrida (identidad única, dos llaves).
- Google Cloud OAuth client para el proyecto Supabase PS (redirect
  https://lintmcxqxnrholslatul.supabase.co/auth/v1/callback) — ¿lo creas tú o te guío como en Lourdes?
- Lista inicial: gmails de Patricia + operadores que entrarán por Google.
