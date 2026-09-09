// 2026-09-09 — REPORTE DUEÑO: "pase del 08/08 (ADRIAN, TAXI LIMA) quedó en S/0 por más que pusimos el precio".
// CAUSA RAÍZ (doble):
//   1) crear_reserva NUNCA guardaba p_monto (el muelle exige "Total" en la reserva y el RPC lo tiraba → reservas.monto NULL
//      en TODAS las reservas post-cutover; las 220 con monto son legado GAS). Al pasar/abordar la reserva el front manda
//      monto=reserva.monto=0.
//   2) _cargo_origen solo defaulteaba Agencia/Libre → origen COMISIONADO sin monto manual = 0. Doctrina dueño: S/0 = error,
//      no hay cortesías; la tarifa base del comisionado (precio_defecto) es el piso (comisión = cobrado − base×pax).
// FIX: crear_reserva persiste monto · _cargo_origen defaultea comisionado a precio_defecto×pax · trigger tg_default_tarifa
//      cubre también 'Comisionado' (invariante en tabla, no por RPC) · backfill de los 3 pases con el COBRO REAL ligado.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
let pass=true;const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+JSON.stringify(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{await c.query('begin');

// 1) crear_reserva guarda el monto
await c.query(`
create or replace function public.crear_reserva(p_fecha date, p_hora text, p_contacto text, p_cliente text, p_pax integer, p_monto numeric, p_creador text, p_id text default null, p_local_id text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_id text; v_existing text;
begin
  perform _req_staff();
  if p_local_id is not null then
    select id into v_existing from reservas where local_id = p_local_id;
    if found then return v_existing; end if;
  end if;
  v_id := coalesce(p_id, gen_id('RES-','seq_res'));
  -- monto: lo que el operador puso como "Total" en la reserva (antes se perdía → pases/abordajes en S/0)
  insert into reservas(id,fecha,hora,contacto_id,cliente,pax,monto,estado,creado_at,creado_por,local_id)
    values(v_id,p_fecha,p_hora,nullif(p_contacto,''),p_cliente,p_pax,
           case when coalesce(p_monto,0) > 0 then round(p_monto,2) else null end,
           'Pendiente',now(),nullif(p_creador,''),p_local_id)
    on conflict (local_id) where local_id is not null do nothing;
  if not found and p_local_id is not null then
    select id into v_id from reservas where local_id = p_local_id;
  end if;
  return v_id;
end $$;`);

// 2) _cargo_origen: comisionado también cae a su tarifa base
await c.query(`
create or replace function public._cargo_origen(p_contacto text, p_pax integer, p_monto numeric)
returns numeric language sql stable set search_path to 'public' as $$
  select case
    when coalesce(p_monto,0) > 0 then p_monto
    -- agencia (nos debe S/), LIBRE (la persona paga) y COMISIONADO (paga la tarifa base; su comisión = lo que cobre
    -- por encima) cobran precio_defecto × pax cuando no hay monto manual. Solo el ALIADO queda en 0 (trueque en PAX).
    else coalesce((select precio_defecto from contactos where id=p_contacto and lower(tipo) in ('agencia','libre','comisionado')),0) * coalesce(p_pax,0)
  end;
$$;`);

// 3) trigger de tabla: también Comisionado
await c.query(`
create or replace function public._tg_mov_default_tarifa() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_pd numeric;
begin
  if NEW.tipo in ('Agencia','Libre','Comisionado')
     and coalesce(NEW.monto_total,0) <= 0
     and coalesce(NEW.contacto_id,'') <> ''
     and coalesce(NEW.estado,'') not ilike '%cancel%'
     and coalesce(NEW.estado,'') not ilike '%anulad%' then
    select precio_defecto into v_pd from contactos where id = NEW.contacto_id;
    if coalesce(v_pd,0) > 0 then
      NEW.precio_unit := v_pd;
      NEW.monto_total := round(v_pd * greatest(coalesce(NEW.cant_pax,0),0), 2);
    else
      begin
        insert into app_eventos(tipo, app, area, mensaje, detalle)
        values('tarifa_cero', 'ops', 'muelle',
               'Movimiento '||coalesce(NEW.tipo,'?')||' quedó en S/0: contacto sin precio_defecto',
               jsonb_build_object('mov', NEW.id, 'tipo', NEW.tipo, 'contacto', NEW.contacto_id,
                 'nombre', NEW.nombre_contacto, 'pax', NEW.cant_pax)::text);
      exception when others then null;
      end;
    end if;
  end if;
  return NEW;
end $$;`);

// 4) backfill: los 3 pases con origen comisionado en S/0 → el COBRO real que ya está ligado en caja
const fix=[['MOV-1000766',50],['MOV-1000765',125],['MOV-1000533',75]];
for(const [id,monto] of fix){
  const k=(await c.query("select coalesce(sum(monto),0) s from caja_operador where movimiento_id=$1 and categoria='Cobro'",[id])).rows[0].s;
  chk('cobro ligado '+id+' = '+monto, Number(k)===monto, k);
  const u=await c.query("update movimientos set monto_total=$2, precio_unit=round($2::numeric/greatest(cant_pax,1),2) where id=$1 and coalesce(monto_total,0)=0 and tipo='Aliado(PaseOut)'",[id,monto]);
  chk('backfill '+id, u.rowCount===1);
}

// tests
const t=async(s,p)=>(await c.query(s,p)).rows[0];
chk('_cargo_origen comisionado sin monto = 25×2', Number((await t("select _cargo_origen('CON-1000064',2,0) v")).v)===50);
chk('_cargo_origen comisionado con monto manual gana', Number((await t("select _cargo_origen('CON-1000064',2,60) v")).v)===60);
chk('_cargo_origen aliado sigue 0', Number((await t("select _cargo_origen('CON-28',4,0) v")).v)===0);
chk('_cargo_origen agencia 25×3', Number((await t("select _cargo_origen('CON-1000088',3,0) v")).v)===75);
const b=(await c.query("select id,cant_pax,precio_unit,monto_total from movimientos where id in ('MOV-1000766','MOV-1000765','MOV-1000533') order by id")).rows;console.table(b);
chk('sin pases comisionado en S/0 (60d)', Number((await t("select count(*) n from movimientos m join contactos co on co.id=m.contacto_id where m.tipo='Aliado(PaseOut)' and lower(co.tipo)='comisionado' and coalesce(m.monto_total,0)=0 and m.registrado_at>now()-interval '60 days' and coalesce(m.estado,'') not ilike '%cancel%'")).n)===0);
// trigger: insert comisionado en 0 dentro de la tx → debe defaultear (luego rollback interno via savepoint)
await c.query('savepoint sp');
const ins=(await c.query("insert into movimientos(id,operacion_id,tipo,contacto_id,nombre_contacto,cant_pax,precio_unit,monto_total,operador,registrado_at,estado) values('MOV-TEST-TG','PASE_DIRECTO','Comisionado','CON-1000064','ADRIAN',3,0,0,'test',now(),'Embarcado') returning monto_total,precio_unit")).rows[0];
chk('trigger Comisionado 0 → 75', Number(ins.monto_total)===75 && Number(ins.precio_unit)===25, ins);
await c.query('rollback to savepoint sp');

await c.query(`insert into reparaciones(fecha,area,titulo,causa,fix,version,severidad,autor) values (current_date,'dinero',
 'Pases con origen COMISIONADO en S/0 (ADRIAN, TAXI LIMA 08-ago; SOBRINO DE JUANCHO 28-jul)',
 'crear_reserva descartaba p_monto (reservas.monto NULL en todas las post-cutover) y _cargo_origen/trigger solo defaulteaban Agencia/Libre → el pase desde reserva con origen comisionado nacía en 0 aunque el operador puso el Total.',
 'crear_reserva persiste monto · _cargo_origen y tg_default_tarifa cubren Comisionado (precio_defecto×pax) · backfill 3 movs con el Cobro real ligado (50/125/75).',
 'DB-live 2026-09-09','media','Claude')`);

if(!pass){throw new Error('tests fallaron');}
await c.query('commit');console.log('COMMIT OK');
}catch(e){await c.query('rollback');console.error('ROLLBACK:',e.message);process.exit(1);}finally{await c.end();}})();
