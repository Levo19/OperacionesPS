// EXPORTACIÓN A EMPRESA EXTRANJERA (tax-id): el guard acepta pasaporte (7) O tax-id ('0' REAL,
// nunca Varios 00000000). Ley IGV art.33 num.9 incluye expresamente a agencias/operadores
// no domiciliados. Parche def viva + tests demo.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
const guard=async(sql)=>{await c.query('savepoint g');try{await c.query(sql);return '';}catch(e){return e.message;}finally{await c.query('rollback to savepoint g');}};
(async()=>{await c.connect();try{
let edef=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante' limit 1")).rows[0].d;
const OLD=`if coalesce(p_cliente_doc_tipo,'') <> '7' or v_doc = '' then
      raise exception 'EXPORTACION_REQUIERE_PASAPORTE: el cliente debe ser no domiciliado con PASAPORTE (no CE/DNI/varios)'; end if;`;
chk('anchor guard export', edef.includes(OLD));
const DOCLINE="'cliente_numero_de_documento', coalesce(nullif(p_cliente_doc,''),'00000000'),";
chk('anchor doc payload', edef.includes(DOCLINE));
edef=edef.replace(DOCLINE, "'cliente_numero_de_documento', regexp_replace(coalesce(nullif(p_cliente_doc,''),'00000000'),'[^A-Za-z0-9]','','g'),");
edef=edef.replace(OLD, `if not ( (coalesce(p_cliente_doc_tipo,'') = '7' and v_doc <> '')
             or (coalesce(p_cliente_doc_tipo,'') = '0' and v_doc <> '' and v_doc <> '00000000') ) then
      raise exception 'EXPORTACION_REQUIERE_PASAPORTE_O_TAXID: exportación exige pasaporte del turista o tax-id de la empresa extranjera (no CE/DNI/Varios)'; end if;`);
await c.query('begin');
await c.query(edef);
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
const uid=Date.now().toString(36);
// T1: factura exportación a EMPRESA EXTRANJERA con tax-id (RUT chileno) + paquete 2 servicios
const t1=(await c.query(`select emitir_comprobante(p_tipo:=1,p_serie:='FFF1',p_cliente_doc_tipo:='0',p_cliente_doc:='76.543.210-K',p_cliente_nombre:='ANDES TRAVEL SPA (CHILE)',p_cliente_email:=null,
  p_items:='[{"descripcion":"Paseo en bote — Islas Ballestas","cantidad":10,"precio":20},{"descripcion":"Guiado — recorrido","cantidad":10,"precio":5}]'::jsonb,
  p_cliente_dir:='Av. Providencia 123, Santiago, Chile',p_exportacion:=true,p_creado_por:='test-taxid',p_local_id:='txid-${uid}') j`)).rows[0].j;
chk('T1 export a tax-id extranjero → ACEPTADA', t1.estado==='aceptada', {num:t1.serie+'-'+t1.numero,total:t1.total,igv:t1.igv});
// T2: export a Varios (00000000) → rechazada
chk('T2 export a Varios rechazada', /PASAPORTE_O_TAXID/.test(await guard(`select emitir_comprobante(p_tipo:=1,p_serie:='FFF1',p_cliente_doc_tipo:='0',p_cliente_doc:='00000000',p_cliente_nombre:='VARIOS',p_cliente_email:=null,p_items:='[{"descripcion":"a","cantidad":1,"precio":20},{"descripcion":"b","cantidad":1,"precio":5}]'::jsonb,p_exportacion:=true)`)));
// T3: export a DNI → rechazada
chk('T3 export a DNI rechazada', /PASAPORTE_O_TAXID/.test(await guard(`select emitir_comprobante(p_tipo:=1,p_serie:='FFF1',p_cliente_doc_tipo:='1',p_cliente_doc:='45114935',p_cliente_nombre:='X Y',p_cliente_email:=null,p_items:='[{"descripcion":"a","cantidad":1,"precio":20},{"descripcion":"b","cantidad":1,"precio":5}]'::jsonb,p_exportacion:=true)`)));
// T4: regresión pasaporte → sigue OK
const t4=(await c.query(`select emitir_comprobante(p_tipo:=1,p_serie:='FFF1',p_cliente_doc_tipo:='7',p_cliente_doc:='AB1234567',p_cliente_nombre:='JOHN SMITH REG',p_cliente_email:=null,
  p_items:='[{"descripcion":"Paseo en bote","cantidad":1,"precio":20},{"descripcion":"Guiado","cantidad":1,"precio":5}]'::jsonb,p_exportacion:=true,p_creado_por:='test-taxid',p_local_id:='txreg-${uid}') j`)).rows[0].j;
chk('T4 regresión pasaporte → aceptada', t4.estado==='aceptada', {num:t4.serie+'-'+t4.numero});
if(!pass){await c.query('rollback');console.log('\n✗ FALLÓ — rollback, PROD intacto');process.exit(1);}
await c.query('commit');
fs.writeFileSync('facturacion_export_taxid.sql','-- Export a empresa extranjera tax-id (2026-08-02) — generado del vivo + parche\n'+edef+';\n');
console.log('\n★ EXPORT TAX-ID habilitado en PROD');
process.exit(0);
}catch(e){try{await c.query('rollback');}catch(_){}
console.error('ERROR:',e.message);process.exit(1);}finally{await c.end();}})();
