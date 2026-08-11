// Misma red de seguridad en editar_movimiento: Agencia editada a monto 0 → precio_defecto × pax.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
let pass=true;const chk=(l,cond)=>{console.log((cond?'✓':'✗')+' '+l);if(!cond)pass=false;};
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef('public.editar_movimiento'::regproc) d")).rows[0].d;
const DECL='declare v_oc int; v_cap int; v_est text;';
chk('anchor declare', d.includes(DECL)); d=d.replace(DECL, DECL+' v_pd numeric;');
const UPD='  update movimientos set tipo=p_tipo, contacto_id=p_contacto, nombre_contacto=p_nombre,';
chk('anchor update', d.includes(UPD));
d=d.replace(UPD,
"  if p_tipo = 'Agencia' and coalesce(p_monto,0) <= 0 and coalesce(p_contacto,'') <> '' then\n"+
"    select precio_defecto into v_pd from contactos where id = p_contacto;\n"+
"    if coalesce(v_pd,0) > 0 then p_precio := v_pd; p_monto := round(v_pd * greatest(coalesce(p_pax,0),0), 2); end if;\n"+
"  end if;\n"+UPD);
if(!pass){console.log('✗ anchors');process.exit(1);}
await c.query('begin');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
chk('default block presente', /select precio_defecto into v_pd/.test((await c.query("select pg_get_functiondef('public.editar_movimiento'::regproc) d")).rows[0].d));
if(!pass){await c.query('rollback');process.exit(1);}
await c.query('commit');
console.log('★ editar_movimiento: default de tarifa para Agencia — COMMIT');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
