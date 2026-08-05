// C1-backend (defensa) · emitir_comprobante: la guarda de detracción NO excluía exportación.
// Con p_detraccion=true + p_exportacion=true (tipo 1, total>700) la guarda pasaba, se aplicaba SPOT 12%
// y sunat_transaction=29 (venta interna) sobre una EXPORTACIÓN → declaración inconsistente/rechazo SUNAT.
// El front ya fue corregido (no manda esa combinación), esto es defensa en profundidad: rechaza el combo.
// Cambio quirúrgico de UNA condición; el camino nacional queda IDÉNTICO (álgebra: con export=false,
// `export or not(...)` == `not(...)`). Mismo signature → CREATE OR REPLACE (sin drop, atómico).
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef('public.emitir_comprobante'::regproc) d")).rows[0].d;

const G="if p_detraccion and not (p_tipo = 1 and v_total > 700) then";
chk('anchor guarda detracción', d.includes(G));
d=d.replace(G, "if p_detraccion and (coalesce(p_exportacion,false) or not (p_tipo = 1 and v_total > 700)) then");
const M="raise exception 'DETRACCION_SOLO_FACTURA_B2B: la detracción aplica a facturas > S/700'; end if;";
chk('anchor mensaje', d.includes(M));
d=d.replace(M, "raise exception 'DETRACCION_SOLO_FACTURA_B2B: la detracción aplica a facturas nacionales > S/700 (no exportación)'; end if;");

if(!pass){console.log('✗ anchors — no se tocó nada');process.exit(1);}
await c.query('begin');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
const back=(await c.query("select pg_get_functiondef('public.emitir_comprobante'::regproc) d")).rows[0].d;
chk('guarda con export aplicada', back.includes("(coalesce(p_exportacion,false) or not (p_tipo = 1 and v_total > 700))"));
chk('camino nacional intacto (sin otros cambios en la guarda)', !back.includes("not (p_tipo = 1 and v_total > 700) then\n    raise exception 'DETRACCION_SOLO_FACTURA_B2B: la detracción aplica a facturas > S/700'"));

// smoke funcional (savepoint, se descarta): EXPORT + DETRACCIÓN → debe RAISE (la guarda corta antes de NubeFact)
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
if(adm){ await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
  await c.query('savepoint t');
  let raised=false, msg='';
  try{ await c.query("select emitir_comprobante(p_tipo=>1,p_serie=>'FFF1',p_cliente_doc_tipo=>'7',p_cliente_doc=>'PA1234567',p_cliente_nombre=>'TURISTA EXPORT',p_cliente_email=>null,p_items=>'[{\"cantidad\":1,\"precio\":500},{\"cantidad\":1,\"precio\":400}]'::jsonb,p_exportacion=>true,p_detraccion=>true)"); }
  catch(e){ raised=/DETRACCION_SOLO_FACTURA_B2B/.test(e.message); msg=e.message.slice(0,80); }
  chk('smoke: export+detracción RECHAZADA', raised, msg);
  await c.query('rollback to savepoint t');
} else console.log('· sin admin para smoke (solo validación de compilación)');

if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK — algo falló, la función NO se cambió');process.exit(1);}
await c.query('commit');
console.log('\n★ emitir_comprobante: guarda de detracción ahora excluye exportación — COMMIT');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
