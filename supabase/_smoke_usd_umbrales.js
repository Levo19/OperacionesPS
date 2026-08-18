// Smokes SOLO de RAISE (NubeFact está viva): la conversión USD→soles debe regir los umbrales.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query('begin');
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
const tc=Number((await c.query("select tc_venta((now() at time zone 'America/Lima')::date) v")).rows[0].v);
console.log('TC venta de hoy: '+tc+'  (S/700 ≈ US$'+(700/tc).toFixed(2)+' · S/2000 ≈ US$'+(2000/tc).toFixed(2)+')\n');
const emitir=(over)=>{
  const base={p_tipo:2,p_serie:'BBB1',p_cliente_doc_tipo:'0',p_cliente_doc:'',p_cliente_nombre:'VARIOS',p_cliente_email:'',
    p_items:[{descripcion:'Tour',cantidad:1,precio:250}],p_exonerado:false,p_moneda:'USD',p_origen:'panel',p_operacion_ref:null,
    p_creado_por:'smoke',p_local_id:'smoke-usd-'+Math.floor(Math.random()*1e9),p_cliente_tel:'',p_cliente_dir:'',
    p_es_extranjero:false,p_medio_pago:'Efectivo',p_exportacion:false,p_detraccion:false,p_forma_pago:'CONTADO',
    p_credito_venc:null,p_observaciones:null,p_fecha_emision:null, ...over};
  const k=Object.keys(base);
  return c.query('select emitir_comprobante('+k.map((x,i)=>x+'=>$'+(i+1)+(x==='p_items'?'::jsonb':x==='p_credito_venc'||x==='p_fecha_emision'?'::date':'')).join(',')+')',
    k.map(x=>x==='p_items'?J(base[x]):base[x]));
};
const err=async(over,re,label)=>{ try{ await c.query('savepoint s'); await emitir(over); await c.query('rollback to savepoint s'); chk(label,false,'NO lanzó (habría emitido)'); }
  catch(e){ await c.query('rollback to savepoint s'); chk(label, re.test(e.message), e.message.slice(0,86)); } };
// US$250 ≈ S/842 → supera los S/700: exige identificar al cliente (con VARIOS debe rechazar)
await err({}, /identificar|Varios|DOC/i, 'boleta US$250 (≈S/842) con Varios → exige identificar (umbral en soles)');
// US$100 ≈ S/337 → NO supera S/700; para probarlo sin emitir, se fuerza el fallo por ítem inválido
await err({p_items:[{descripcion:'Tour',cantidad:0,precio:100}]}, /ITEM_INVALIDO/, 'US$100 (≈S/337) no dispara el umbral (llega al guard de ítem)');
// factura US$100 ≈ S/337 con detracción → bajo el umbral SPOT (S/700) debe rechazarla
await err({p_tipo:1,p_serie:'FFF1',p_cliente_doc_tipo:'6',p_cliente_doc:'20000000001',p_cliente_nombre:'EMPRESA',p_cliente_dir:'Dir',
  p_items:[{descripcion:'Tour',cantidad:1,precio:100}],p_detraccion:true}, /DETRACCION_SOLO_FACTURA_B2B/, 'factura US$100 con detracción → rechaza (S/337 < S/700)');
// moneda USD con fecha sin TC en tabla NI anterior: imposible hoy (hay histórico) → se prueba el guard con fecha futura
await err({p_fecha_emision:'2030-01-01'}, /FECHA_FUTURA/, 'fecha futura sigue bloqueada');
await c.query('rollback');
console.log(pass?'\n★ umbrales legales evaluados en SOLES con el TC oficial':'\n✗ FALLAS');
await c.end(); process.exit(pass?0:1);
})();
