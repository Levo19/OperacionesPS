// PASE SUELTO CON ORIGEN LIBRE COBRA (reporte dueño 2026-08-23, pestaña Pases de Lanchas):
// con origen LIBRE (personas varias) el pase quedaba SIEMPRE en S/0 aunque el contacto tenga
// precio_defecto — y el "precio manual" era imposible: la RPC ni siquiera tiene ese parámetro.
// Causas: (1) _cargo_origen solo cobraba tipo 'agencia'; (2) registrar_pase_directo no acepta monto.
// Fix: _cargo_origen cobra agencia Y libre (aliado/comisionado siguen 0: esos pases van en PAX);
// registrar_pase_directo gana p_monto opcional (manual > 0 SIEMPRE gana, cualquier origen).
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
await c.query('begin');
// 1) _cargo_origen: agencia Y libre cobran su tarifa; el monto manual (>0) gana siempre
await c.query(`
create or replace function public._cargo_origen(p_contacto text, p_pax integer, p_monto numeric)
returns numeric language sql stable set search_path to 'public' as $$
  select case
    when coalesce(p_monto,0) > 0 then p_monto
    -- agencia (nos debe S/) y LIBRE (la persona paga) cobran su tarifa × pax;
    -- aliado/comisionado quedan en 0: esos pases se cuentan en PAX, no en dinero
    else coalesce((select precio_defecto from contactos where id=p_contacto and lower(tipo) in ('agencia','libre')),0) * coalesce(p_pax,0)
  end;
$$`);
// 2) registrar_pase_directo + p_monto (nuevo parámetro al FINAL → DROP+CREATE misma tx, sin overload)
let d=(await c.query("select pg_get_functiondef('public.registrar_pase_directo'::regproc) d")).rows[0].d;
const args=(await c.query("select pg_get_function_identity_arguments('public.registrar_pase_directo'::regproc) a")).rows[0].a;
if(!/p_monto/.test(d)){
  chk('anchor firma', d.includes('p_local_id text DEFAULT NULL::text)'));
  d=d.replace('p_local_id text DEFAULT NULL::text)','p_local_id text DEFAULT NULL::text, p_monto numeric DEFAULT NULL::numeric)');
  chk('anchor cargo', d.includes('v_monto  := _cargo_origen(nullif(p_contacto,\'\'), p_pax, 0);'));
  d=d.replace("v_monto  := _cargo_origen(nullif(p_contacto,''), p_pax, 0);",
              "v_monto  := _cargo_origen(nullif(p_contacto,''), p_pax, coalesce(p_monto,0));   -- manual > 0 gana; si no, tarifa del origen (agencia/libre)");
  if(!pass){await c.query('rollback');process.exit(1);}
  await c.query('drop function public.registrar_pase_directo('+args+')');
  await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
}
chk('una sola firma', (await c.query("select count(*)::int n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname='registrar_pase_directo'")).rows[0].n===1);

// ── smokes REALES en savepoint (estas RPC no llaman a NubeFact: ejecución completa es segura) ──
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
const aliado=(await c.query("select id from contactos where lower(tipo)='aliado' limit 1")).rows[0].id;
const pase=async(contacto,nombre,pax,monto)=>{
  const id=(await c.query("select registrar_pase_directo($1,$2,$3,$4,'smoke',null,'smk-pase-'||floor(random()*1e9)::text,$5) id",[contacto,nombre,aliado,pax,monto])).rows[0].id;
  return (await c.query('select monto_total::numeric m, precio_unit::numeric p from movimientos where id=$1',[id])).rows[0];
};
await c.query('savepoint sv');
let r=await pase('CON-00','VARIOS:PRUEBA',2,null);
chk('origen LIBRE (VARIOS pd=30) 2 pax → S/60 (era el bug: quedaba 0)', Number(r.m)===60 && Number(r.p)===30, r);
const pdAg=Number((await c.query("select precio_defecto from contactos where id='CON-09'")).rows[0].precio_defecto);
r=await pase('CON-09','HT BACKPACKER',1,null);
chk('origen agencia sigue igual (su tarifa vigente '+pdAg+')', Number(r.m)===pdAg, r);
r=await pase('CON-00','VARIOS:PRUEBA',2,45);
chk('precio MANUAL 45 gana sobre la tarifa', Number(r.m)===45 && Number(r.p)===22.5, r);
r=await pase(aliado,'ALIADO ORIGEN',3,null);
chk('origen aliado sigue en 0 (pases en PAX)', Number(r.m)===0, r);
r=await pase(null,'TEXTO LIBRE',2,50);
chk('texto libre (sin contacto) con monto manual → 50', Number(r.m)===50, r);
r=await pase(null,'TEXTO LIBRE',2,null);
chk('texto libre sin monto → 0 (no hay tarifa de dónde jalar)', Number(r.m)===0, r);
await c.query('rollback to savepoint sv');
if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
const c2=mk();await c2.connect();
const f=(await c2.query("select pg_get_functiondef('public.registrar_pase_directo'::regproc) d")).rows[0].d;
const res=(await c2.query("select count(*)::int n from movimientos where local_id like 'smk-pase%'")).rows[0].n;
console.log('\n[fresca] p_monto en la firma: '+/p_monto/.test(f)+' · libre en _cargo_origen: '+/'agencia','libre'/.test((await c2.query("select pg_get_functiondef('public._cargo_origen'::regproc) d")).rows[0].d)+' · residuos: '+res);
await c2.end();
if(res!==0){console.log('✗ residuo');process.exit(1);}
console.log('\n★ pase con origen libre cobra (tarifa o manual) — COMMIT verificado');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
