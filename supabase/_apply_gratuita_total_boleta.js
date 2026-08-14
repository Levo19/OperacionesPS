// ZARPE/CORTESÍA (decisión dueño 2026-08-14): el pax 100% gratis (ej. TC) ocupa asiento y debe
// quedar DOCUMENTADO y CONCILIADO. SUNAT contempla la transferencia gratuita: CPE con valor
// referencial y total S/0 (bucket total_gratuita). El guard GRATUITA_REQUIERE_LINEA_COBRADA
// (diseñado para la cortesía-línea dentro del CPE del grupo) bloqueaba la fila all-🎁 del zarpe →
// nunca llegaba a 'facturado' → conciliación jamás cerraba.
// FIX: boleta 100% gratuita PERMITIDA (total 0 + total_gratuita > 0). FACTURA S/0 sigue bloqueada
// (GRATUITA_TOTAL_SOLO_BOLETA): B2B la cortesía va como línea dentro de la factura del grupo.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;

const OLD="    if v_total <= 0 then raise exception 'GRATUITA_REQUIERE_LINEA_COBRADA: la cortesía acompaña a una venta (agrega la línea pagada del grupo)'; end if;";
chk('anchor guard viejo (1 vez)', d.split(OLD).length-1===1);
d=d.replace(OLD,
"    -- CPE 100% GRATUITO permitido SOLO en boleta (transferencia gratuita SUNAT; zarpe: la\n"+
"    -- cortesía ocupa asiento → debe documentarse y conciliar). Factura S/0 sigue bloqueada.\n"+
"    if v_total <= 0 and p_tipo = 1 then raise exception 'GRATUITA_TOTAL_SOLO_BOLETA: una factura no puede ser 100%% gratuita — la cortesía va como línea dentro de la factura del grupo'; end if;");

if(!pass){console.log('✗ anchors');process.exit(1);}
await c.query('begin');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
const back=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
chk('guard nuevo presente', /GRATUITA_TOTAL_SOLO_BOLETA/.test(back) && !/GRATUITA_REQUIERE_LINEA_COBRADA/.test(back));
chk('guard export intacto', /GRATUITA_NO_EXPORTACION/.test(back));

// smokes de RAISE (abortan ANTES del PEEK/HTTP a NubeFact → cero side-effects; savepoint c/u)
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
// OJO: SOLO smokes que RAISEAN antes del PEEK/HTTP — emitir_comprobante hace POST real a NubeFact
// (config activa); un smoke que "pasa" los guards emitiría un CPE de verdad aunque haya rollback.
const emitir = (over) => {
  const base = { p_tipo:2, p_serie:'BBB1', p_cliente_doc_tipo:'0', p_cliente_doc:'', p_cliente_nombre:'VARIOS',
    p_cliente_email:'', p_items:[], p_exonerado:false, p_moneda:'PEN', p_origen:'panel', p_operacion_ref:null,
    p_creado_por:'smoke', p_local_id:'smoke-grat-'+Math.floor(Math.random()*1e9), p_cliente_tel:'', p_cliente_dir:'',
    p_es_extranjero:false, p_medio_pago:'Efectivo', p_exportacion:false, p_detraccion:false, p_forma_pago:'CONTADO',
    p_credito_venc:null, p_observaciones:null, ...over };
  const keys = Object.keys(base);
  const args = keys.map((k,i) => k+'=>$'+(i+1)+(k==='p_items'?'::jsonb':k==='p_credito_venc'?'::date':''));
  return c.query('select emitir_comprobante('+args.join(',')+')', keys.map(k => k==='p_items'?J(base[k]):base[k]));
};
const GRATIS=[{descripcion:'Tour',cantidad:1,precio:20,afectacion:'gratuito'}];
// 1) FACTURA 100% gratuita → GRATUITA_TOTAL_SOLO_BOLETA (raise pre-HTTP)
try{ await c.query('savepoint s1');
  await emitir({ p_tipo:1, p_serie:'FFF1', p_cliente_doc_tipo:'6', p_cliente_doc:'20000000001', p_cliente_nombre:'EMPRESA SMOKE', p_cliente_dir:'Dir -', p_items:GRATIS });
  chk('factura 100% gratuita → bloqueada', false, 'NO lanzó');
  await c.query('rollback to savepoint s1');
}catch(e){ await c.query('rollback to savepoint s1'); chk('factura 100% gratuita → GRATUITA_TOTAL_SOLO_BOLETA', /GRATUITA_TOTAL_SOLO_BOLETA/.test(e.message), e.message.slice(0,80)); }
// 2) ITEM_INVALIDO sigue vivo (cantidad 0 → raise pre-HTTP)
try{ await c.query('savepoint s2');
  await emitir({ p_items:[{descripcion:'Tour',cantidad:0,precio:10}] });
  chk('item cantidad 0 → rechaza', false, 'NO lanzó');
  await c.query('rollback to savepoint s2');
}catch(e){ await c.query('rollback to savepoint s2'); chk('item cantidad 0 → ITEM_INVALIDO', /ITEM_INVALIDO/.test(e.message), e.message.slice(0,60)); }
if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');

// persistencia en conexión FRESCA
const c2=mk();await c2.connect();
const fd=(await c2.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
console.log('\n[fresca] GRATUITA_TOTAL_SOLO_BOLETA: '+/GRATUITA_TOTAL_SOLO_BOLETA/.test(fd));
await c2.end();
if(!/GRATUITA_TOTAL_SOLO_BOLETA/.test(fd)){console.log('✗ NO PERSISTIÓ');process.exit(1);}
console.log('\n★ boleta 100% gratuita habilitada (factura S/0 bloqueada) — COMMIT verificado');
console.log('OJO: la 1ª boleta gratuita real contra NubeFact es la prueba de fuego (si rechaza, la fila solo falla y se reintenta).');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
