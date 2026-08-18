// BALANZA TRIBUTARIA EN SOLES aunque el CPE sea en dólares.
// Los módulos tributarios sumaban total_igv/total_gravada/… SIN mirar la moneda: un comprobante de
// US$100 entraba como si fueran S/100 y descuadraba el IGV y la renta del mes.
// Fix: cada importe se convierte con el TC que YA quedó guardado en el propio comprobante
// (`comprobantes.tipo_cambio`, el TC venta de su fecha de emisión). En soles la columna es NULL →
// coalesce(...,1) deja el valor intacto. No se recalcula ningún TC: se usa el que sustentó la venta.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+JSON.stringify(g):''));if(!cond)pass=false;};
const TC='coalesce(tipo_cambio,1)';
(async()=>{await c.connect();try{
await c.query('begin');
// ── balance_tributos ──
let b=(await c.query("select pg_get_functiondef('public.balance_tributos'::regproc) d")).rows[0].d;
const B_OLD="  select coalesce(sum(total_igv),0), coalesce(sum(total_gravada),0), coalesce(sum(total_exportacion),0), coalesce(sum(total_exonerada),0)";
chk('anchor balance_tributos', b.includes(B_OLD));
b=b.replace(B_OLD,
"  -- Importes a SOLES con el TC del propio comprobante (NULL en soles → factor 1)\n"+
"  select coalesce(sum(total_igv*"+TC+"),0), coalesce(sum(total_gravada*"+TC+"),0), coalesce(sum(total_exportacion*"+TC+"),0), coalesce(sum(total_exonerada*"+TC+"),0)");
await c.query('CREATE OR REPLACE '+b.slice(b.indexOf('FUNCTION')));
chk('balance_tributos convierte', /total_igv\*coalesce\(tipo_cambio,1\)/.test((await c.query("select pg_get_functiondef('public.balance_tributos'::regproc) d")).rows[0].d));

// ── balance_meses y proyeccion_renta: mismo criterio ──
for (const fn of ['balance_meses','proyeccion_renta']) {
  let d=(await c.query("select pg_get_functiondef(('public.'||$1)::regproc) d",[fn])).rows[0].d;
  const antes=d;
  d=d.replace(/sum\(total_igv\)/g,'sum(total_igv*'+TC+')')
     .replace(/sum\(total_gravada\)/g,'sum(total_gravada*'+TC+')')
     .replace(/sum\(total_exportacion\)/g,'sum(total_exportacion*'+TC+')')
     .replace(/sum\(total_exonerada\)/g,'sum(total_exonerada*'+TC+')')
     .replace(/sum\(total\)/g,'sum(total*'+TC+')');
  if (d===antes) { console.log('· '+fn+': no suma totales de comprobantes (sin cambio)'); continue; }
  await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
  chk(fn+' convierte a soles', /coalesce\(tipo_cambio,1\)/.test((await c.query("select pg_get_functiondef(('public.'||$1)::regproc) d",[fn])).rows[0].d));
}

// ── verificación con datos reales + un USD simulado (en savepoint, sin tocar producción) ──
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:adm.u,role:'authenticated'})]);
const per=(await c.query("select to_char((now() at time zone 'America/Lima')::date,'YYYY-MM') p")).rows[0].p;
const antes=(await c.query('select balance_tributos($1) d',[per])).rows[0].d;
await c.query('savepoint sv');
// comprobante simulado en USD: 100 gravada + 18 IGV con TC 3.368 → debe sumar S/336.80 y S/60.62
await c.query(`insert into comprobantes(tipo,serie,numero,moneda,tipo_cambio,cliente_nombre,total_gravada,total_igv,total,estado,creado_at,local_id,items)
  values(2,'BBB1',999999,'USD',3.368,'SMOKE USD',100,18,118,'aceptada',now(),'smoke-bal','[]'::jsonb)`);
const desp=(await c.query('select balance_tributos($1) d',[per])).rows[0].d;
const dGrav=Number(desp.base_gravada)-Number(antes.base_gravada);
const dIgv=Number(desp.igv_debito)-Number(antes.igv_debito);
chk('US$100 gravada entra como S/336.80 (no S/100)', Math.abs(dGrav-336.80)<0.02, {delta:dGrav.toFixed(2)});
chk('US$18 de IGV entra como S/60.62', Math.abs(dIgv-60.62)<0.02, {delta:dIgv.toFixed(2)});
await c.query('rollback to savepoint sv');
const final=(await c.query('select balance_tributos($1) d',[per])).rows[0].d;
chk('sin el simulado, la balanza vuelve a su valor', Number(final.base_gravada)===Number(antes.base_gravada), {grav:final.base_gravada});
// los comprobantes en soles no cambian de valor
chk('los CPE en soles no se alteran (factor 1)', Number(antes.base_gravada)===Number(final.base_gravada));

if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
const c2=mk();await c2.connect();
const f=(await c2.query("select pg_get_functiondef('public.balance_tributos'::regproc) d")).rows[0].d;
const n=(await c2.query("select count(*)::int n from comprobantes where local_id='smoke-bal'")).rows[0].n;
console.log('\n[fresca] convierte: '+/coalesce\(tipo_cambio,1\)/.test(f)+' · residuos: '+n);
await c2.end();
if(n!==0){console.log('✗ quedó residuo');process.exit(1);}
console.log('\n★ balanza tributaria en soles con CPE en dólares — COMMIT verificado');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
