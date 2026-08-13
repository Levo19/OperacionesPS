// ROOT-CAUSE (2026-08-13): el flujo Sala de Espera → abordar reserva escribe movimientos vía
// asignar_reserva, que insertaba coalesce(p_monto,0) SIN la red de default de tarifa — la red del
// 11-ago solo cubrió registrar_movimiento/editar_movimiento. Reserva sin precio → agencia embarcada
// en S/0 (9 movs el 13-ago, 1 el 11-ago; todos local_id 'temp-asig-*').
// FIX: misma red en asignar_reserva (Agencia/Libre con monto 0 → precio_defecto del contacto × pax;
// precio > 0 del operador se respeta). + BACKFILL de los movimientos en cero (join a contactos).
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
const IDS=['MOV-1000852','MOV-1000851','MOV-1000850','MOV-1000849','MOV-1000848','MOV-1000847','MOV-1000840','MOV-1000839','MOV-1000837','MOV-1000814'];
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef('public.asignar_reserva'::regproc) d")).rows[0].d;

const DECL='declare v_oc int; v_cap int; v_id text; v_existing text;';
chk('anchor declare', d.includes(DECL));
d=d.replace(DECL, DECL+' v_pd numeric;');

const INS="  v_id := coalesce(p_id, gen_id('MOV-','seq_mov'));";
chk('anchor antes del insert', d.includes(INS));
d=d.replace(INS,
"  -- DEFAULT DE TARIFA (paridad registrar_movimiento): Agencia/Libre sin precio (monto 0) → precio_defecto × pax.\n"+
"  if coalesce(p_tipo,'Agencia') in ('Agencia','Libre') and coalesce(p_monto,0) <= 0 and coalesce(p_contacto,'') <> '' then\n"+
"    select precio_defecto into v_pd from contactos where id = p_contacto;\n"+
"    if coalesce(v_pd,0) > 0 then p_precio := v_pd; p_monto := round(v_pd * greatest(coalesce(p_pax,0),0), 2); end if;\n"+
"  end if;\n"+INS);

if(!pass){console.log('✗ anchors');process.exit(1);}
await c.query('begin');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
const back=(await c.query("select pg_get_functiondef('public.asignar_reserva'::regproc) d")).rows[0].d;
chk('default block presente', /DEFAULT DE TARIFA/.test(back) && /select precio_defecto into v_pd/.test(back));

// guard: ningún cobro colgado de los movs a backfillear (deben estar sin caja)
const caja=(await c.query("select count(*)::int n from caja_operador where movimiento_id = any($1)",[IDS])).rows[0].n;
chk('0 cobros previos ligados a los movs en cero', caja===0, caja);

// smoke real (savepoint): reserva fantasma + Agencia CON-09 (pd 23), 1 pax, precio 0 → monto 23
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
if(adm){ await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
  try{ await c.query('savepoint sv');
    const mid=(await c.query("select asignar_reserva('RES-SMOKE-NOEXISTE','OP-1000139','Agencia','CON-09','HT BACKPACKER',1,0,0,'smoke',null,'smoke-asig-'||floor(random()*1e9)::text) id")).rows[0].id;
    const mv=(await c.query('select monto_total,precio_unit from movimientos where id=$1',[mid])).rows[0];
    chk('smoke: asignar Agencia 1pax precio 0 → monto 23 (default)', mv && Number(mv.monto_total)===23 && Number(mv.precio_unit)===23, mv);
    await c.query('rollback to savepoint sv');
  }catch(e){ await c.query('rollback to savepoint sv'); console.log('· smoke saltado ('+e.message.slice(0,70)+') — valida readback'); }
}

// BACKFILL: los movs en cero toman precio_defecto × pax de su contacto
const up=await c.query(`
  update movimientos m set precio_unit = c2.precio_defecto,
         monto_total = round(c2.precio_defecto * greatest(coalesce(m.cant_pax,0),0), 2)
  from contactos c2
  where c2.id = m.contacto_id and m.id = any($1)
    and coalesce(m.monto_total,0) <= 0 and coalesce(c2.precio_defecto,0) > 0
  returning m.id, m.nombre_contacto, m.cant_pax, m.monto_total`,[IDS]);
chk('backfill: 10 movimientos actualizados', up.rowCount===10, up.rowCount);
up.rows.forEach(r=>console.log('  · '+r.id+' '+r.nombre_contacto+' '+r.cant_pax+'pax → S/'+r.monto_total));
const tot=up.rows.reduce((a,r)=>a+Number(r.monto_total),0);
chk('total recuperado S/1425', tot===1425, tot);

if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');

// verificación de persistencia en CONEXIÓN FRESCA (pitfall rollback silencioso)
const c2=mk();await c2.connect();
const fd=(await c2.query("select pg_get_functiondef('public.asignar_reserva'::regproc) d")).rows[0].d;
const fz=(await c2.query("select count(*)::int n, coalesce(sum(monto_total),0)::numeric s from movimientos where id = any($1) and coalesce(monto_total,0) <= 0",[IDS])).rows;
console.log('\n[fresca] default block: '+/DEFAULT DE TARIFA/.test(fd)+' · movs aún en cero: '+fz[0].n);
await c2.end();
if(!/DEFAULT DE TARIFA/.test(fd) || fz[0].n!==0){console.log('✗ NO PERSISTIÓ');process.exit(1);}
console.log('\n★ asignar_reserva con red de tarifa + backfill S/1425 — COMMIT verificado');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
