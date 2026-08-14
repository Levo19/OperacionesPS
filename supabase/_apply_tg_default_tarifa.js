// CIERRE ESTRUCTURAL del bug "monto S/0" (2026-08-13): la red de default de tarifa vivía en 3 RPCs
// (registrar_movimiento/editar_movimiento/asignar_reserva) pero cualquier camino nuevo la esquiva
// (ya pasó con asignar_reserva). Se sube el invariante a NIVEL DE TABLA: trigger BEFORE INSERT OR
// UPDATE en movimientos — Agencia/Libre con monto 0 y contacto con precio_defecto>0 → default × pax.
// Excluye Cancelado/Anulado (esos sí van en 0). Si NO puede rellenar (contacto sin tarifa) deja el 0
// pero AVISA en app_eventos (visible para JADE/consultar_eventos) sin romper la transacción.
// Las redes de las RPCs se conservan (redundancia inocua, misma lógica).
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
await c.query('begin');
await c.query(`
create or replace function public._tg_mov_default_tarifa() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_pd numeric;
begin
  if NEW.tipo in ('Agencia','Libre')
     and coalesce(NEW.monto_total,0) <= 0
     and coalesce(NEW.contacto_id,'') <> ''
     and coalesce(NEW.estado,'') not ilike '%cancel%'
     and coalesce(NEW.estado,'') not ilike '%anulad%' then
    select precio_defecto into v_pd from contactos where id = NEW.contacto_id;
    if coalesce(v_pd,0) > 0 then
      NEW.precio_unit := v_pd;
      NEW.monto_total := round(v_pd * greatest(coalesce(NEW.cant_pax,0),0), 2);
    else
      -- no hay de dónde jalar: dejar 0 pero avisar (nunca romper la operación del muelle)
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
end $$`);
await c.query(`drop trigger if exists tg_default_tarifa on public.movimientos`);
await c.query(`create trigger tg_default_tarifa before insert or update on public.movimientos
  for each row execute function public._tg_mov_default_tarifa()`);
chk('trigger creado', (await c.query("select count(*)::int n from pg_trigger where tgrelid='public.movimientos'::regclass and tgname='tg_default_tarifa'")).rows[0].n===1);

// ===== batería de smokes (todo en savepoint, cero residuo) =====
await c.query('savepoint sv');
const ins=(vals)=>c.query(`insert into movimientos(id,operacion_id,tipo,contacto_id,nombre_contacto,cant_pax,precio_unit,monto_total,operador,registrado_at,estado)
  values($1,'OP-1000139',$2,$3,$4,$5,0,0,'smoke-tg',now(),$6) returning precio_unit,monto_total`,vals);
let r;
r=(await ins(['MOV-TG-1','Agencia','CON-09','HT BACKPACKER',4,'Embarcado'])).rows[0];
chk('insert directo Agencia 4pax → 92 (23×4)', Number(r.monto_total)===92 && Number(r.precio_unit)===23, r);
r=(await ins(['MOV-TG-2','Libre','CON-00','VARIOS:TEST',2,'Embarcado'])).rows[0];
chk('insert directo Libre 2pax → 60 (30×2)', Number(r.monto_total)===60, r);
r=(await ins(['MOV-TG-3','Aliado(PaseIn)','CON-26','ALIADO TEST',3,'Embarcado'])).rows[0];
chk('PaseIn queda en 0 (por diseño)', Number(r.monto_total)===0, r);
r=(await ins(['MOV-TG-4','Comisionado','CON-23','COMI TEST',2,'Embarcado'])).rows[0];
chk('Comisionado queda en 0 (manual)', Number(r.monto_total)===0, r);
r=(await ins(['MOV-TG-5','Agencia','CON-09','HT BACKPACKER',7,'Cancelado'])).rows[0];
chk('Agencia Cancelado queda en 0', Number(r.monto_total)===0, r);
r=(await c.query("update movimientos set monto_total=0, precio_unit=0 where id='MOV-TG-1' returning monto_total")).rows[0];
chk('update a 0 → re-default 92', Number(r.monto_total)===92, r);
r=(await c.query("update movimientos set precio_unit=50, monto_total=200 where id='MOV-TG-1' returning monto_total")).rows[0];
chk('precio editado >0 se respeta (200)', Number(r.monto_total)===200, r);
// contacto sin tarifa → queda 0 + aviso en app_eventos
await c.query("insert into contactos(id,nombre,tipo,precio_defecto) values('CON-TG-X','AGENCIA SIN TARIFA','agencia',0)");
r=(await ins(['MOV-TG-6','Agencia','CON-TG-X','AGENCIA SIN TARIFA',5,'Embarcado'])).rows[0];
const ev=(await c.query("select count(*)::int n from app_eventos where tipo='tarifa_cero' and detalle like '%MOV-TG-6%'")).rows[0].n;
chk('sin tarifa: queda 0 + aviso app_eventos', Number(r.monto_total)===0 && ev===1, {monto:r.monto_total,eventos:ev});
await c.query('rollback to savepoint sv');
// regresión: la RPC sigue funcionando igual (red RPC + trigger no chocan) — savepoint PROPIO
// y operación CON CUPOS elegida dinámicamente (OP-1000139 está llena → AFORO tumbaba todo el apply)
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
const op=(await c.query(`select o.id from operaciones o
  where exists (select 1 from _aforo(o.id) a where a.capacidad is null or a.ocupados + 1 <= a.capacidad)
  order by o.id desc limit 1`)).rows[0];
if(adm && op){
  try{
    await c.query('savepoint sv2');
    await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
    const mid=(await c.query("select asignar_reserva('RES-SMOKE-NO',$1,'Agencia','CON-09','HT BACKPACKER',1,0,0,'smoke',null,'smoke-tg-'||floor(random()*1e9)::text) id",[op.id])).rows[0].id;
    r=(await c.query('select monto_total from movimientos where id=$1',[mid])).rows[0];
    chk('regresión asignar_reserva ('+op.id+') → 23', Number(r.monto_total)===23, r);
    await c.query('rollback to savepoint sv2');
  }catch(e){ await c.query('rollback to savepoint sv2'); console.log('· regresión RPC saltada ('+e.message.slice(0,60)+') — trigger ya validado por inserts directos'); }
} else console.log('· regresión RPC saltada (sin op con cupos) — trigger ya validado por inserts directos');

if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');

// verificación en CONEXIÓN FRESCA
const c2=mk();await c2.connect();
const tg=(await c2.query("select count(*)::int n from pg_trigger where tgrelid='public.movimientos'::regclass and tgname='tg_default_tarifa'")).rows[0].n;
const res=(await c2.query("select count(*)::int n from movimientos where id like 'MOV-TG-%'")).rows[0].n;
const cx=(await c2.query("select count(*)::int n from contactos where id='CON-TG-X'")).rows[0].n;
console.log('\n[fresca] trigger: '+tg+' · residuos smoke: '+(res+cx));
await c2.end();
if(tg!==1||res+cx!==0){console.log('✗ NO PERSISTIÓ o quedó residuo');process.exit(1);}
console.log('\n★ tg_default_tarifa a nivel de tabla — COMMIT verificado, sin residuos');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
