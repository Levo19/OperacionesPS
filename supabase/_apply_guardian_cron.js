// Cron que dispara la Edge `cpe-guardian` cada hora + prueba real de la Edge.
// La service key se guarda en una tabla privada (solo postgres, que es como corre pg_cron); nunca en el repo.
const {Client}=require('pg');const fs=require('fs');const {execSync}=require('child_process');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
(async()=>{await c.connect();
let sk='';
try{ const out=execSync('supabase projects api-keys --project-ref lintmcxqxnrholslatul',{stdio:['ignore','pipe','ignore']}).toString();
  const m=out.split('\n').find(l=>/service_role/.test(l)); sk=m?m.split('|').map(s=>s.trim()).filter(Boolean).pop():''; }catch(e){}
console.log('service key obtenida:', sk?('sí ('+sk.length+' chars)'):'NO');
if(!sk){process.exit(1);}
await c.query('create table if not exists private_cfg(k text primary key, v text)');
await c.query('alter table private_cfg enable row level security');
await c.query('revoke all on private_cfg from anon, authenticated');
await c.query('insert into private_cfg(k,v) values($1,$2) on conflict (k) do update set v=excluded.v',['service_role_key',sk]);
await c.query(`
create or replace function public.cpe_guardian_disparar(p_prueba boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public','extensions' as $$
declare v_sk text; v_resp text; begin
  select v into v_sk from private_cfg where k='service_role_key';
  if v_sk is null then return jsonb_build_object('ok',false,'error','sin service key'); end if;
  perform http_set_curlopt('CURLOPT_TIMEOUT','25');
  select content into v_resp from http(('POST','https://lintmcxqxnrholslatul.supabase.co/functions/v1/cpe-guardian',
    array[http_header('Authorization','Bearer '||v_sk)], 'application/json',
    jsonb_build_object('prueba', coalesce(p_prueba,false))::text)::http_request);
  return coalesce(nullif(v_resp,''),'{"ok":false,"error":"sin respuesta"}')::jsonb;
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm);
end $$`);
await c.query('revoke all on function public.cpe_guardian_disparar(boolean) from public, anon, authenticated');
await c.query("select cron.unschedule('cpe-guardian')").catch(()=>{});
await c.query("select cron.schedule('cpe-guardian','20 * * * *', $$select public.cpe_guardian_disparar(false)$$)");
console.log('cron cpe-guardian: cada hora al :20 (7 min después del reconciliador)');
const r=(await c.query('select cpe_guardian_disparar(true) d')).rows[0].d;
console.log('respuesta Edge (modo prueba):', JSON.stringify(r));
await c.end();
})();
