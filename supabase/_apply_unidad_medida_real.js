// UNIDAD DE MEDIDA REAL EN EL CPE (pedido dueño 2026-08-17).
// Hallazgo: _nf_items mandaba 'ZZ' HARDCODEADO → la unidad elegida en el catálogo de servicios era
// decorativa (por eso TOUR FULL DAY marcado NIU igual salía ZZ en su boleta: sin daño, pero el campo
// mentía). Empresa de SERVICIOS (operador turístico 7912) → ZZ correcto hoy; NIU queda disponible
// para el día que vendan un BIEN (souvenir/agua), y entonces el CPE debe decir NIU de verdad.
// FIX: _nf_items respeta i->>'unidad' con WHITELIST estricta (solo NIU; cualquier otra cosa → ZZ,
// nunca vacío: SUNAT exige el código del catálogo 03). Comportamiento idéntico al actual mientras
// nadie mande NIU. + default del catálogo pasa de NIU a ZZ. + TOUR FULL DAY corregido a ZZ.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef('public._nf_items'::regproc) d")).rows[0].d;
const OLD="    'unidad_de_medida','ZZ','codigo','S','descripcion', descripcion,";
chk('anchor unidad hardcodeada (1 vez)', d.split(OLD).length-1===1);
d=d.replace(OLD,"    'unidad_de_medida', um, 'codigo','S','descripcion', descripcion,");
// propagar `um` por las dos subconsultas (b y a)
const SEL_B="    select descripcion, cant, af, tot,";
chk('anchor select b', d.split(SEL_B).length-1===1);
d=d.replace(SEL_B,"    select descripcion, cant, af, tot, um,");
const SEL_A="      select coalesce(nullif(trim(i->>'descripcion'),''),'SERVICIO') descripcion,";
chk('anchor select a', d.split(SEL_A).length-1===1);
d=d.replace(SEL_A,
"      select coalesce(nullif(trim(i->>'descripcion'),''),'SERVICIO') descripcion,\n"+
"             -- Catálogo SUNAT 03: ZZ = unidad de SERVICIO (todo lo que vende hoy la empresa),\n"+
"             -- NIU = unidad de BIEN. Whitelist dura: cualquier cosa que no sea NIU cae a ZZ.\n"+
"             case when upper(coalesce(i->>'unidad','')) = 'NIU' then 'NIU' else 'ZZ' end um,");
if(!pass){console.log('✗ anchors');process.exit(1);}

await c.query('begin');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
const back=(await c.query("select pg_get_functiondef('public._nf_items'::regproc) d")).rows[0].d;
chk('unidad ya no está hardcodeada', /'unidad_de_medida', um,/.test(back) && !/'unidad_de_medida','ZZ'/.test(back));
chk('sigue IMMUTABLE', /IMMUTABLE/.test(back));

// ── _nf_items es PURA (sin HTTP): se puede probar directo, sin emitir nada real ──
const it=(x)=>c.query('select _nf_items($1::jsonb,false,false) d',[J(x)]).then(r=>r.rows[0].d);
let r=await it([{descripcion:'Tour',cantidad:2,precio:50,unidad:'ZZ'}]);
chk('unidad ZZ explícita → ZZ', r[0].unidad_de_medida==='ZZ');
r=await it([{descripcion:'Gorra',cantidad:1,precio:20,unidad:'NIU'}]);
chk('unidad NIU explícita → NIU (bien)', r[0].unidad_de_medida==='NIU');
r=await it([{descripcion:'Gorra',cantidad:1,precio:20,unidad:'niu'}]);
chk('minúsculas se normalizan → NIU', r[0].unidad_de_medida==='NIU');
r=await it([{descripcion:'Tour',cantidad:1,precio:20}]);
chk('SIN unidad (legacy) → ZZ (comportamiento actual intacto)', r[0].unidad_de_medida==='ZZ');
for(const bad of ['','   ','XX','ZZZ','<script>',null]){
  r=await it([Object.assign({descripcion:'X',cantidad:1,precio:10}, bad===null?{unidad:null}:{unidad:bad})]);
  if(r[0].unidad_de_medida!=='ZZ'){ chk('basura '+J(bad)+' → ZZ', false, r[0].unidad_de_medida); }
}
chk('unidad inválida/vacía/nula siempre cae a ZZ (nunca vacío)', pass);
// no-regresión de dinero: los montos no cambian con el nuevo campo
r=await it([{descripcion:'Tour',cantidad:2,precio:50,unidad:'NIU'}]);
chk('montos intactos (2×50 → 100.00, sub+igv=total)', Number(r[0].total)===100 && Math.abs(Number(r[0].subtotal)+Number(r[0].igv)-100)<0.001, {sub:r[0].subtotal, igv:r[0].igv, tot:r[0].total});
r=await it([{descripcion:'Cortesía',cantidad:1,precio:20,afectacion:'gratuito'}]);
chk('gratuita conserva tipo_de_igv 11 + ZZ', r[0].tipo_de_igv===11 && r[0].unidad_de_medida==='ZZ');

// default del catálogo: NIU → ZZ (empresa de servicios)
let sd=(await c.query("select pg_get_functiondef('public.admin_set_servicio'::regproc) d")).rows[0].d;
chk('anchor default NIU en admin_set_servicio', sd.includes("p_unidad text DEFAULT 'NIU'::text"));
sd=sd.replace("p_unidad text DEFAULT 'NIU'::text","p_unidad text DEFAULT 'ZZ'::text").replace(/coalesce\(nullif\(p_unidad,''\),'NIU'\)/g,"coalesce(nullif(upper(p_unidad),''),'ZZ')");
await c.query('CREATE OR REPLACE '+sd.slice(sd.indexOf('FUNCTION')));
const sb=(await c.query("select pg_get_functiondef('public.admin_set_servicio'::regproc) d")).rows[0].d;
chk('admin_set_servicio: default ZZ', /DEFAULT 'ZZ'/.test(sb) && !/'NIU'\)/.test(sb));

// dato: TOUR FULL DAY es un SERVICIO, estaba marcado NIU
const up=await c.query("update servicios set unidad='ZZ' where unidad='NIU' returning id,nombre");
chk('servicios en NIU corregidos a ZZ', up.rowCount===1 && up.rows[0].id==='SVC-0010', up.rows);
chk('0 servicios quedan en NIU', (await c.query("select count(*)::int n from servicios where unidad<>'ZZ'")).rows[0].n===0);

if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
const c2=mk();await c2.connect();
const f=(await c2.query("select pg_get_functiondef('public._nf_items'::regproc) d")).rows[0].d;
const niu=(await c2.query("select count(*)::int n from servicios where unidad<>'ZZ'")).rows[0].n;
console.log('\n[fresca] unidad dinámica: '+/'unidad_de_medida', um,/.test(f)+' · servicios fuera de ZZ: '+niu);
await c2.end();
if(!/'unidad_de_medida', um,/.test(f) || niu!==0){console.log('✗ NO PERSISTIÓ');process.exit(1);}
console.log('\n★ unidad de medida real en el CPE + default ZZ + TOUR FULL DAY corregido — COMMIT verificado');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
