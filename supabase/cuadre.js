// Cuadre senior: vistas Supabase  vs  endpoints GAS en vivo (fuente de verdad Sheets).
// Prueba que la migracion preserva los numeros al centavo.
const { Client } = require('pg'); const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync(__dirname+'/.pgpass','utf8').trim();
const cfg={host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}};
const GAS='https://script.google.com/macros/s/AKfycby7_H2lEOweA4cpixzNUw_50EfuQtiSoIW2389U5Ipyic3GRmETSRgBYSpIAaMcARcMhA/exec';
const r2=n=>Math.round((Number(n)||0)*100)/100;
const gas=async a=>{const r=await fetch(GAS+'?accion='+a);const j=await r.json();return j&&j.ok?Object.assign({ok:true},j.data):j;};
(async()=>{
  const c=new Client(cfg); await c.connect();
  let fails=0;
  // ===== AGENCIAS =====
  const G=await gas('balance_agencias');
  if(!G||!G.ok){console.log('GAS agencias ERROR',JSON.stringify(G).slice(0,120));process.exit(1);}
  const vg=(await c.query('select id,nombre,facturado,cobrado,comprado,pagado,te_debe,le_debo from v_balance_agencias')).rows;
  const vgMap=Object.fromEntries(vg.map(x=>[x.id,x]));
  console.log('=== AGENCIAS ===  GAS:',G.agencias.length,' vistas:',vg.length);
  // totales globales
  const gT=G.totales;
  console.log('  facturado_total  GAS',r2(gT.facturado_total),' SQL',r2(vg.reduce((s,a)=>s+ +a.facturado,0)));
  console.log('  cobrado_total    GAS',r2(gT.cobrado_total),  ' SQL',r2(vg.reduce((s,a)=>s+ +a.cobrado,0)));
  console.log('  te_deben         GAS',r2(gT.te_deben),' SQL',r2(vg.filter(a=>+a.te_debe>0.005).reduce((s,a)=>s+ +a.te_debe,0)));
  console.log('  le_debo          GAS',r2(gT.le_debo), ' SQL',r2(vg.filter(a=>+a.le_debo>0.005).reduce((s,a)=>s+ +a.le_debo,0)));
  // por agencia
  for(const a of G.agencias){
    const v=vgMap[a.id];
    if(!v){console.log('  FALTA en vista:',a.id,a.nombre,'fact',r2(a.facturado));fails++;continue;}
    const dF=Math.abs(r2(a.facturado)-r2(v.facturado)), dC=Math.abs(r2(a.cobrado)-r2(v.cobrado));
    const dCo=Math.abs(r2(a.comprado)-r2(v.comprado)), dP=Math.abs(r2(a.pagado)-r2(v.pagado));
    if(dF>0.01||dC>0.01||dCo>0.01||dP>0.01){
      console.log('  DIF',a.id,a.nombre,'| fact',r2(a.facturado),'vs',r2(v.facturado),'| cob',r2(a.cobrado),'vs',r2(v.cobrado),'| comp',r2(a.comprado),'vs',r2(v.comprado),'| pag',r2(a.pagado),'vs',r2(v.pagado));
      fails++;
    }
  }
  // vista de mas?
  for(const v of vg){ if(!G.agencias.find(a=>a.id===v.id)){console.log('  SOBRA en vista:',v.id,v.nombre);fails++;} }
  // ===== ALIADOS =====
  const A=await gas('balance_aliados');
  if(A&&A.ok){
    const va=(await c.query('select id,nombre,pax_in,pax_out,neto from v_balance_aliados')).rows;
    const vaMap=Object.fromEntries(va.map(x=>[x.id,x]));
    console.log('=== ALIADOS ===  GAS:',(A.aliados||[]).length,' vistas:',va.length);
    for(const a of (A.aliados||[])){
      const v=vaMap[a.id];
      const gin=r2(a.pax_in!=null?a.pax_in:a.pin), gout=r2(a.pax_out!=null?a.pax_out:a.pout);
      if(!v){console.log('  FALTA aliado en vista:',a.id,a.nombre,'in',gin,'out',gout);fails++;continue;}
      if(Math.abs(gin-r2(v.pax_in))>0.01||Math.abs(gout-r2(v.pax_out))>0.01){
        console.log('  DIF aliado',a.id,a.nombre,'| in',gin,'vs',r2(v.pax_in),'| out',gout,'vs',r2(v.pax_out));fails++;
      }
    }
  } else { console.log('=== ALIADOS === GAS sin ok, payload:',JSON.stringify(A).slice(0,120)); }
  // ===== CAJA FEED =====
  const K=await gas('caja_feed');
  if(K&&K.ok&&K.dias){
    let gIn=0,gEg=0; K.dias.forEach(d=>{gIn+=+d.ingresos;gEg+=+d.egresos;});
    const vk=(await c.query("select dia, sum(case when es_ingreso then monto else 0 end) ing, sum(case when not es_ingreso then monto else 0 end) eg from v_caja_items group by dia")).rows;
    const sIn=vk.reduce((s,r)=>s+ +r.ing,0), sEg=vk.reduce((s,r)=>s+ +r.eg,0);
    console.log('=== CAJA ===  GAS dias:',K.dias.length,' SQL dias:',vk.length);
    console.log('  ingresos GAS',r2(gIn),' SQL',r2(sIn),'  egresos GAS',r2(gEg),' SQL',r2(sEg));
    if(Math.abs(r2(gIn)-r2(sIn))>0.01){console.log('  DIF ingresos caja');fails++;}
    if(Math.abs(r2(gEg)-r2(sEg))>0.01){console.log('  DIF egresos caja');fails++;}
    if(K.dias.length!==vk.length){console.log('  DIF cantidad de dias');fails++;}
  } else { console.log('=== CAJA === sin ok'); }
  console.log(fails===0?'\\n>>> CUADRE PERFECTO: 0 diferencias <<<':'\\n>>> '+fails+' DIFERENCIAS <<<');
  await c.end();
})().catch(e=>{console.error('ERROR',e.message);process.exit(1);});
