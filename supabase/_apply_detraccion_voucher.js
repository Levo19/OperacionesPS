// DETRACCIÓN — control del VOUCHER (constancia de depósito del 12% en cuenta BN):
//  - columna comprobantes.detraccion_voucher (path en el bucket comprobante-pdfs)
//  - listar_comprobantes + listar_comprobantes_dia proyectan detraccion/detraccion_total/detraccion_voucher
//    (para que el historial de PS y OPS sepa si aplica detracción y si ya tiene voucher → botón verde/rojo)
//  - RPC set_detraccion_voucher(p_id, p_path) para guardar/limpiar el path (staff)
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
const INJ='total_gratuita, detraccion, coalesce(detraccion_total,0) detraccion_total, detraccion_voucher,';
(async()=>{await c.connect();try{
// patch de ambos listar
const defs={};
for(const fn of ['listar_comprobantes','listar_comprobantes_dia']){
  let d=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[fn])).rows[0].d;
  chk(fn+': anchor total_gratuita, (1)', (d.split('total_gratuita,').length-1)===1);
  d=d.replace('total_gratuita,', INJ);
  defs[fn]=d;
}
if(!pass){console.log('✗ anchors');process.exit(1);}
await c.query('begin');
await c.query('alter table comprobantes add column if not exists detraccion_voucher text');
for(const fn of Object.keys(defs)) await c.query('CREATE OR REPLACE '+defs[fn].slice(defs[fn].indexOf('FUNCTION')));
// RPC set_detraccion_voucher
await c.query(`create or replace function public.set_detraccion_voucher(p_id text, p_path text)
returns jsonb language plpgsql security definer set search_path to 'public','auth','extensions' as $fn$
begin
  perform _req_staff();
  update comprobantes set detraccion_voucher = nullif(trim(coalesce(p_path,'')),'') where id = p_id;
  if not found then raise exception 'NO_EXISTE: comprobante %', p_id; end if;
  return jsonb_build_object('ok', true);
end $fn$`);
await c.query('revoke all on function public.set_detraccion_voucher(text,text) from public');
await c.query('grant execute on function public.set_detraccion_voucher(text,text) to authenticated');
// readback
const lc=(await c.query("select pg_get_functiondef('public.listar_comprobantes'::regproc) d")).rows[0].d;
const ld=(await c.query("select pg_get_functiondef('public.listar_comprobantes_dia'::regproc) d")).rows[0].d;
chk('listar_comprobantes proyecta detraccion_voucher', /detraccion_voucher/.test(lc)&&/detraccion,/.test(lc));
chk('listar_comprobantes_dia proyecta detraccion_voucher', /detraccion_voucher/.test(ld)&&/detraccion,/.test(ld));
chk('columna detraccion_voucher existe', (await c.query("select 1 from information_schema.columns where table_name='comprobantes' and column_name='detraccion_voucher'")).rows.length===1);
chk('RPC set_detraccion_voucher existe', (await c.query("select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='set_detraccion_voucher'")).rows.length===1);
// smoke: set en un comprobante fantasma → NO_EXISTE (ejercita _req_staff + update)
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
if(adm){ await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
  await c.query('savepoint sv');   // CRÍTICO: el smoke lanza NO_EXISTE → sin savepoint aborta la TX y el commit = rollback
  let raised=false; try{ await c.query("select set_detraccion_voucher('no-existe-xyz','voucher/x.jpg')"); }catch(e){ raised=/NO_EXISTE/.test(e.message); }
  await c.query('rollback to savepoint sv');
  chk('smoke: set en id inexistente → NO_EXISTE', raised);
}
if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
console.log('\n★ detracción voucher: columna + proyección en ambos listar + RPC set_detraccion_voucher — COMMIT');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
