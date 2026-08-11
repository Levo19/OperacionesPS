// ROOT-CAUSE: agencias entraban al manifiesto con monto S/0 (el front a veces no llenaba el precio).
// Red de seguridad en registrar_movimiento: si es tipo 'Agencia' y llega SIN precio (monto 0), toma el
// precio_defecto del contacto (× pax). Garantiza cobrar la agencia sin depender del flujo del front.
// El operador conserva la opción de editar: si envía un precio > 0, se respeta tal cual.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef('public.registrar_movimiento'::regproc) d")).rows[0].d;

const DECL='declare v_estado text; v_oc int; v_cap int; v_id text; v_existing text; v_admin boolean; v_ts timestamptz;';
chk('anchor declare', d.includes(DECL));
d=d.replace(DECL, DECL+' v_pd numeric;');

const INS="  v_id := coalesce(p_id, gen_id('MOV-','seq_mov'));";
chk('anchor antes del insert', d.includes(INS));
d=d.replace(INS,
"  -- DEFAULT DE TARIFA (raíz del bug S/0): Agencia sin precio (monto 0) → precio_defecto del contacto × pax.\n"+
"  if p_tipo = 'Agencia' and coalesce(p_monto,0) <= 0 and coalesce(p_contacto,'') <> '' then\n"+
"    select precio_defecto into v_pd from contactos where id = p_contacto;\n"+
"    if coalesce(v_pd,0) > 0 then p_precio := v_pd; p_monto := round(v_pd * greatest(coalesce(p_pax,0),0), 2); end if;\n"+
"  end if;\n"+INS);

if(!pass){console.log('✗ anchors');process.exit(1);}
await c.query('begin');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
const back=(await c.query("select pg_get_functiondef('public.registrar_movimiento'::regproc) d")).rows[0].d;
chk('default block presente', /DEFAULT DE TARIFA/.test(back) && /select precio_defecto into v_pd/.test(back));

// smoke funcional real (savepoint): Agencia CON-09 (precio 23), 1 pax, precio 0 → monto 23
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
if(adm){ await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
  try {
    await c.query('savepoint sv');
    const mid=(await c.query("select registrar_movimiento('OP-1000139','Agencia','CON-09','HT BACKPACKER',1,0,0,'smoke',null,'smoke-vpd-'||floor(random()*1e9)::text) id")).rows[0].id;
    const mv=(await c.query('select monto_total,precio_unit from movimientos where id=$1',[mid])).rows[0];
    chk('smoke: Agencia 1pax precio 0 → monto 23 (default)', mv && Number(mv.monto_total)===23 && Number(mv.precio_unit)===23, mv);
    await c.query('rollback to savepoint sv');
  } catch(e){ await c.query('rollback to savepoint sv'); console.log('· smoke funcional saltado ('+e.message.slice(0,70)+') — valida readback + CREATE'); }
}
if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
console.log('\n★ registrar_movimiento: default de tarifa para Agencia sin precio — COMMIT');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
