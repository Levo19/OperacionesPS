-- ============================================================
-- RPCs de catálogo para el PS Panel (admin). Editan las MISMAS tablas que
-- usa el muelle → single-source. Réplica de Catalogos.gs.
-- ============================================================
create sequence if not exists seq_emb start 1000000;
create sequence if not exists seq_per start 1000000;
create sequence if not exists seq_con start 1000000;
create sequence if not exists seq_imp start 1000000;

-- normaliza tipo de contacto al CHECK de Supabase (minúscula); default 'libre'
create or replace function _tipo_con(t text) returns text language sql immutable as
$$ select case when lower(trim(coalesce(t,''))) in ('agencia','aliado','comisionado','libre')
                then lower(trim(t)) else 'libre' end $$;

-- ── Embarcaciones ──
create or replace function admin_crear_embarcacion(p_nombre text, p_cap int, p_matricula text)
  returns text language plpgsql security definer set search_path=public, auth as
$$ declare v_id text := 'BOT-'||lpad(nextval('seq_emb')::text,7,'0');
   begin perform _req_admin();
     insert into embarcaciones(id,nombre,capacidad_pax,matricula) values(v_id,p_nombre,coalesce(p_cap,0),nullif(p_matricula,''));
     return v_id; end $$;
create or replace function admin_editar_embarcacion(p_id text, p_nombre text, p_cap int, p_matricula text)
  returns void language plpgsql security definer set search_path=public, auth as
$$ begin perform _req_admin();
     update embarcaciones set nombre=coalesce(p_nombre,nombre), capacidad_pax=coalesce(p_cap,capacidad_pax),
       matricula=coalesce(p_matricula,matricula) where id=p_id;
     if not found then raise exception 'NO_EXISTE: embarcación %', p_id; end if; end $$;

-- ── Personal (ops) ──
create or replace function admin_crear_personal_ops(p_nombre text, p_rol text, p_tarifa numeric, p_estado text)
  returns text language plpgsql security definer set search_path=public, auth as
$$ declare v_id text := 'EMP-'||lpad(nextval('seq_per')::text,7,'0');
   begin perform _req_admin();
     insert into personal(id,nombre,rol,tarifa_fija,estado) values(v_id,p_nombre,nullif(p_rol,''),coalesce(p_tarifa,0),coalesce(nullif(p_estado,''),'activo'));
     return v_id; end $$;
create or replace function admin_editar_personal_ops(p_id text, p_nombre text, p_rol text, p_tarifa numeric, p_estado text)
  returns void language plpgsql security definer set search_path=public, auth as
$$ begin perform _req_admin();
     update personal set nombre=coalesce(p_nombre,nombre), rol=coalesce(p_rol,rol),
       tarifa_fija=coalesce(p_tarifa,tarifa_fija), estado=coalesce(nullif(p_estado,''),estado) where id=p_id;
     if not found then raise exception 'NO_EXISTE: personal %', p_id; end if; end $$;

-- ── Contactos ── (tipo a minúscula; Aliado sin precio)
create or replace function admin_crear_contacto(p_nombre text, p_tipo text, p_precio numeric)
  returns text language plpgsql security definer set search_path=public, auth as
$$ declare v_id text := 'CON-'||lpad(nextval('seq_con')::text,7,'0'); v_t text := _tipo_con(p_tipo);
   begin perform _req_admin();
     insert into contactos(id,nombre,tipo,precio_defecto) values(v_id,p_nombre,v_t, case when v_t='aliado' then 0 else coalesce(p_precio,0) end);
     return v_id; end $$;
create or replace function admin_editar_contacto(p_id text, p_nombre text, p_tipo text, p_precio numeric)
  returns void language plpgsql security definer set search_path=public, auth as
$$ declare v_t text;
   begin perform _req_admin();
     v_t := case when p_tipo is null then (select tipo from contactos where id=p_id) else _tipo_con(p_tipo) end;
     update contactos set nombre=coalesce(p_nombre,nombre), tipo=v_t,
       precio_defecto = case when v_t='aliado' then 0 when p_precio is not null then p_precio else precio_defecto end
      where id=p_id;
     if not found then raise exception 'NO_EXISTE: contacto %', p_id; end if; end $$;

-- ── Impuestos ──
create or replace function admin_crear_impuesto(p_nombre text, p_monto numeric)
  returns text language plpgsql security definer set search_path=public, auth as
$$ declare v_id text := 'imp'||nextval('seq_imp')::text;
   begin perform _req_admin();
     insert into impuestos(id,nombre,monto) values(v_id,p_nombre,coalesce(p_monto,0));
     return v_id; end $$;
create or replace function admin_editar_impuesto(p_id text, p_nombre text, p_monto numeric)
  returns void language plpgsql security definer set search_path=public, auth as
$$ begin perform _req_admin();
     update impuestos set nombre=coalesce(p_nombre,nombre), monto=coalesce(p_monto,monto) where id=p_id;
     if not found then raise exception 'NO_EXISTE: impuesto %', p_id; end if; end $$;
