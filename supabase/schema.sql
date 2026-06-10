-- ============================================================
-- OperacionesPS → Supabase · schema.sql  (modelo del muelle)
-- ============================================================
create table personal (
  id            text primary key,
  nombre        text not null,
  rol           text,
  tarifa_fija   numeric(10,2) default 0,
  estado        text default 'activo'
);
create table embarcaciones (
  id            text primary key,
  nombre        text not null,
  capacidad_pax int,
  matricula     text,
  activo        boolean default true
);
create table contactos (
  id             text primary key,
  nombre         text not null,
  tipo           text check (tipo in ('agencia','aliado','comisionado','libre')),
  precio_defecto numeric(10,2) default 0,
  activo         boolean default true
);
create table impuestos (
  id    text primary key,
  nombre text,
  monto numeric(10,2)
);
create table operaciones (
  id           text primary key,
  fecha        date,
  hora_salida  text,
  bote_id      text references embarcaciones(id),
  capitan_id   text references personal(id),
  guia_id      text references personal(id),
  estado       text check (estado in ('Abierta','En_Viaje','Cerrada','Cancelada')) default 'Abierta',
  creado_por   text,
  foto_zarpe_url text,
  destino      text,
  creado_at    timestamptz default now()
);
create table movimientos (
  id                  text primary key,
  operacion_id        text,                          -- 'PASE_DIRECTO'/'' permitido (ref suave)
  tipo                text,
  contacto_id         text references contactos(id),
  nombre_contacto     text,
  cant_pax            int default 0,
  precio_unit         numeric(10,2) default 0,
  monto_total         numeric(10,2) default 0,
  adicionales         jsonb default '{}'::jsonb,
  estado              text default 'Embarcado',
  operador            text,
  registrado_at       timestamptz default now(),
  contacto_pase_id    text references contactos(id),
  agencia_comprada_id text references contactos(id),
  monto_comprado      numeric(10,2) default 0
);
create table caja_operador (
  id            text primary key,
  operacion_id  text,
  contacto_id   text references contactos(id),
  categoria     text,
  monto         numeric(10,2) default 0,
  metodo_pago   text,
  comentarios   text,
  foto_url      text,
  operador      text,
  ts            timestamptz default now(),
  movimiento_id text                              -- soft ref: un mov historico purgado puede seguir referenciado por su cobro
);
create table reservas (
  id          text primary key,
  fecha       date,
  hora        text,
  tipo        text,
  contacto_id text,
  pax         int,
  monto       numeric(10,2),
  estado      text default 'Pendiente',
  cliente     text,
  creado_at   timestamptz default now()
);
-- Identidad de login = PERSONAL_MASTER del PS Panel (NO operaciones.personal,
-- que son capitanes/guias). Por eso `id` es texto libre (USR_…), sin FK a personal.
create table app_usuarios (
  id        text primary key,         -- id de PERSONAL_MASTER (USR_…)
  nombre    text,
  rol       text,                     -- rol de PERSONAL_MASTER (admin/operador/…)
  auth_uid  uuid unique,              -- enlaza con auth.users(id)
  activo    boolean default true
);
create index idx_mov_operacion  on movimientos(operacion_id);
create index idx_mov_contacto   on movimientos(contacto_id);
create index idx_mov_registrado on movimientos(registrado_at);
create index idx_mov_compra     on movimientos(agencia_comprada_id);
create index idx_caja_ts        on caja_operador(ts);
create index idx_caja_mov       on caja_operador(movimiento_id);
create index idx_caja_contacto  on caja_operador(contacto_id);
create index idx_op_fecha       on operaciones(fecha);
