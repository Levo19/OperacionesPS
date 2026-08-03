// TABLILLA ZARPE v2 (dueño 2026-08-03): el panel valida cada doc leído por la IA (DNI→RENIEC,
// RUC→SUNAT) y el admin corrige tipo/número/dirección con chips editables. Backend:
// (1) columna zarpe_pax.dir_fiscal, (2) guardar_zarpe_tablilla persiste también
// nombre/documento/tipo_doc/dir_fiscal (solo si vienen), (3) listar_zarpe_pax proyecta dir_fiscal.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
let gdef=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='guardar_zarpe_tablilla'")).rows[0].d;
const G1=`update zarpe_pax set
        cantidad  = greatest(coalesce((f->>'cantidad')::int, cantidad), 0),
        servicios = coalesce(f->'servicios', servicios)
      where id = f->>'id' and id_operacion = p_operacion and estado <> 'facturado';`;
chk('anchor guardar', gdef.includes(G1));
gdef=gdef.replace(G1, `update zarpe_pax set
        cantidad   = greatest(coalesce((f->>'cantidad')::int, cantidad), 0),
        servicios  = coalesce(f->'servicios', servicios),
        nombre     = coalesce(nullif(trim(f->>'nombre'),''), nombre),
        documento  = coalesce(nullif(trim(f->>'documento'),''), documento),
        tipo_doc   = coalesce(nullif(trim(f->>'tipo_doc'),''), tipo_doc),
        dir_fiscal = case when f ? 'dir_fiscal' then nullif(trim(f->>'dir_fiscal'),'') else dir_fiscal end
      where id = f->>'id' and id_operacion = p_operacion and estado <> 'facturado';`);
let ldef=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='listar_zarpe_pax'")).rows[0].d;
const L1='z.nombre, z.empresa, z.cantidad, z.servicios,';
chk('anchor listar', ldef.includes(L1));
ldef=ldef.replace(L1,'z.nombre, z.empresa, z.cantidad, z.servicios, z.dir_fiscal,');
if(!pass){console.log('✗ anchors — no se tocó nada');process.exit(1);}
await c.query('begin');
await c.query("alter table zarpe_pax add column if not exists dir_fiscal text");
await c.query(gdef); await c.query(ldef);
// ── test con fila temporal ──
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
const uid='ztest-'+Date.now().toString(36);
await c.query("insert into zarpe_pax (id, id_operacion, documento, tipo_doc, nombre, cantidad, servicios, estado) values ($1,$2,'99999999','1','OCR CRUDO',1,'[]'::jsonb,'pendiente')",[uid,'OP-TEST-VAL']);
const t1=(await c.query(`select guardar_zarpe_tablilla('OP-TEST-VAL', $1::jsonb) j`,
  [J([{id:uid,cantidad:2,servicios:[{nombre:'Paseo',precio:20,cantidad:2},{nombre:'Guiado',precio:5,cantidad:2,gratis:true}],nombre:'NOMBRE OFICIAL RENIEC',documento:'20601030013',tipo_doc:'6',dir_fiscal:'Av. Test 123, Paracas'}])])).rows[0].j;
chk('T1 guardar actualiza 1', t1 && t1.actualizados===1, t1);
const row=(await c.query("select nombre,documento,tipo_doc,dir_fiscal,cantidad,servicios from zarpe_pax where id=$1",[uid])).rows[0];
chk('T1 persiste nombre/doc/tipo/dir', row.nombre==='NOMBRE OFICIAL RENIEC' && row.documento==='20601030013' && row.tipo_doc==='6' && row.dir_fiscal==='Av. Test 123, Paracas' && row.cantidad===2, {n:row.nombre,d:row.dir_fiscal});
chk('T1 servicios con cantidad+gratis', Array.isArray(row.servicios) && row.servicios[1].gratis===true && row.servicios[0].cantidad===2);
// T2: fila sin campos nuevos NO pisa lo guardado (regresión: solo cantidad/servicios)
const t2=(await c.query(`select guardar_zarpe_tablilla('OP-TEST-VAL', $1::jsonb) j`,[J([{id:uid,cantidad:3}])])).rows[0].j;
const row2=(await c.query("select nombre,dir_fiscal,cantidad from zarpe_pax where id=$1",[uid])).rows[0];
chk('T2 regresión sin campos → conserva', t2.actualizados===1 && row2.nombre==='NOMBRE OFICIAL RENIEC' && row2.dir_fiscal==='Av. Test 123, Paracas' && row2.cantidad===3);
// T3: listar proyecta dir_fiscal
const lst=(await c.query("select listar_zarpe_pax('OP-TEST-VAL') j")).rows[0].j;
chk('T3 listar trae dir_fiscal', Array.isArray(lst) && lst[0].dir_fiscal==='Av. Test 123, Paracas');
await c.query("delete from zarpe_pax where id=$1",[uid]);
if(!pass){await c.query('rollback');console.log('\n✗ FALLÓ — rollback, PROD intacto');process.exit(1);}
await c.query('commit');
fs.writeFileSync('zarpe_tablilla_valida.sql','-- Tablilla zarpe v2: persistencia de correcciones + dir_fiscal (2026-08-03) — generado del vivo + parche\n'+gdef+';\n\n'+ldef+';\n');
console.log('\n★ ZARPE TABLILLA v2 backend APLICADO');
process.exit(0);
}catch(e){try{await c.query('rollback');}catch(_){}
console.error('ERROR:',e.message);process.exit(1);}finally{await c.end();}})();
