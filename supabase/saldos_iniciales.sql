-- ============================================================
-- OperacionesPS · Saldos iniciales (arrastre pre-arranque del sistema)
-- ------------------------------------------------------------
-- Deuda previa al 1-may (a favor o en contra) con agencias (S/) y aliados (PAX).
-- 1 fila por contacto (PK = contacto_id → editar, no duplicar). Signo del monto:
--   (+) = ME DEBEN (a favor)    (−) = LES DEBO (en contra)
-- unidad la deriva el RPC del tipo de contacto (agencia=S/, aliado=PAX).
-- Solo Administrador (admin_*). Los balances le SUMAN este saldo (ver ps_finance.sql).
-- Seguro de re-ejecutar.
-- ============================================================

create table if not exists saldos_iniciales (
  contacto_id      text primary key references contactos(id),
  tipo             text not null check (tipo in ('agencia','aliado')),
  unidad           text not null,                       -- 'S/' | 'PAX'
  monto            numeric not null default 0,          -- signo: + me deben, − les debo
  fecha_corte      date not null default '2026-04-30',
  nota             text,
  actualizado_at   timestamptz default now(),
  actualizado_por  text
);

-- ── set/upsert (1 por contacto) ──
create or replace function admin_set_saldo_inicial(
    p_contacto text, p_monto numeric, p_fecha date default '2026-04-30', p_nota text default null, p_operador text default null)
  returns text language plpgsql security definer set search_path=public, auth as
$$
declare v_tipo text; v_unidad text;
begin
  perform _req_admin();
  select lower(tipo) into v_tipo from contactos where id = p_contacto;
  if not found then raise exception 'NO_EXISTE: contacto %', p_contacto; end if;
  if v_tipo not in ('agencia','aliado') then
    raise exception 'TIPO: el saldo inicial es solo para agencia o aliado (este es %)', v_tipo;
  end if;
  v_unidad := case when v_tipo = 'agencia' then 'S/' else 'PAX' end;
  insert into saldos_iniciales(contacto_id,tipo,unidad,monto,fecha_corte,nota,actualizado_at,actualizado_por)
    values(p_contacto, v_tipo, v_unidad, coalesce(p_monto,0), coalesce(p_fecha,'2026-04-30'), nullif(p_nota,''), now(), nullif(p_operador,''))
  on conflict (contacto_id) do update set
    tipo=excluded.tipo, unidad=excluded.unidad, monto=excluded.monto,
    fecha_corte=excluded.fecha_corte, nota=excluded.nota,
    actualizado_at=now(), actualizado_por=excluded.actualizado_por;
  return p_contacto;
end $$;
grant execute on function admin_set_saldo_inicial(text,numeric,date,text,text) to authenticated;

-- ── listar (para que el admin vea/edite) ──
create or replace function admin_list_saldos_iniciales()
  returns jsonb language plpgsql stable security definer set search_path=public, auth as
$$
declare v jsonb;
begin
  perform _req_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
      'contacto_id', s.contacto_id, 'nombre', coalesce(c.nombre, s.contacto_id),
      'tipo', s.tipo, 'unidad', s.unidad, 'monto', s.monto,
      'fecha_corte', to_char(s.fecha_corte,'YYYY-MM-DD'), 'nota', coalesce(s.nota,''),
      'actualizado_por', coalesce(s.actualizado_por,'')) order by c.nombre), '[]'::jsonb)
    into v from saldos_iniciales s left join contactos c on c.id = s.contacto_id;
  return v;
end $$;
grant execute on function admin_list_saldos_iniciales() to authenticated;

-- ── eliminar (corregir si sobró) ──
create or replace function admin_eliminar_saldo_inicial(p_contacto text)
  returns void language plpgsql security definer set search_path=public, auth as
$$ begin perform _req_admin(); delete from saldos_iniciales where contacto_id = p_contacto; end $$;
grant execute on function admin_eliminar_saldo_inicial(text) to authenticated;
