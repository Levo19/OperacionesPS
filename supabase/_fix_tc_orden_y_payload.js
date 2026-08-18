// DOS FIXES sobre la emisión en dólares (detectados por smoke real):
// 1) ORDEN: v_total_pen se calculaba DESPUÉS de los guards de umbral → los guards comparaban
//    contra NULL y no disparaban (una boleta de US$250 ≈ S/842 pasaba sin identificar al cliente).
//    Ahora la conversión se hace JUNTO al primer cálculo de v_total, antes de las validaciones.
// 2) NubeFact EXIGE `tipo_de_cambio` cuando la moneda es USD ("Tipo de cambio no puede estar en
//    blanco") → se envía el TC VENTA oficial de la fecha de emisión.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+JSON.stringify(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
let d=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;

// (a) quitar el bloque mal ubicado (quedó justo antes del PEEK)
const VIEJO_INI = "  -- Umbrales legales (S/700 identificación, S/2000 bancarización, S/700 detracción) están en";
const VIEJO_FIN = "  v_total_pen := round(v_total * v_tc, 2);\n";
const i0 = d.indexOf(VIEJO_INI), i1 = d.indexOf(VIEJO_FIN);
chk('bloque anterior localizado', i0 > 0 && i1 > i0);
d = d.slice(0, i0) + d.slice(i1 + VIEJO_FIN.length);
// la fecha de emisión también debe conocerse antes (el TC depende de ella)
const FEMI_INI = "  -- FECHA DE EMISIÓN (opcional).";
const FEMI_FIN = "      case when p_tipo = 1 then 'la factura' else 'la boleta' end, v_dias; end if;\n";
const f0 = d.indexOf(FEMI_INI), f1 = d.indexOf(FEMI_FIN);
chk('bloque de fecha localizado', f0 > 0 && f1 > f0);
const bloqueFecha = d.slice(f0, f1 + FEMI_FIN.length);
d = d.slice(0, f0) + d.slice(f1 + FEMI_FIN.length);

// (b) reinsertar fecha + TC JUSTO DESPUÉS del primer cálculo de v_total (antes de las validaciones)
const ANCLA = "select coalesce(sum(round((i->>'cantidad')::numeric * (i->>'precio')::numeric, 2)), 0) into v_total from jsonb_array_elements(p_items) i where coalesce(i->>'afectacion','') <> 'gratuito';";
chk('ancla del primer total', d.includes(ANCLA));
d = d.replace(ANCLA, ANCLA + "\n\n" + bloqueFecha +
"  -- Los umbrales legales (S/700 identificación, S/700 detracción, S/2000 bancarización) están en\n"+
"  -- SOLES: una venta en dólares se convierte con el TC VENTA de la fecha de emisión (art. 20.1\n"+
"  -- R.S.183-2004). Se calcula AQUÍ, antes de las validaciones, o los guards compararían con NULL.\n"+
"  -- El TC se LEE de la tabla (la llena el cron): jamás se consulta la red dentro de la emisión.\n"+
"  if upper(coalesce(p_moneda,'PEN')) = 'USD' then\n"+
"    v_tc := tc_venta(v_femi);\n"+
"    if v_tc is null or v_tc <= 0 then\n"+
"      raise exception 'SIN_TIPO_CAMBIO: no hay tipo de cambio publicado para % — reintenta en unos minutos', v_femi; end if;\n"+
"  else v_tc := 1; end if;\n"+
"  v_total_pen := round(v_total * v_tc, 2);\n");

// (c) tras el recálculo por buckets, refrescar el equivalente en soles (v_total cambia por céntimos)
const BUCKETS = "  into v_grav, v_igv, v_inaf, v_exo, v_export, v_total, v_gratis";
chk('ancla buckets', d.includes(BUCKETS));
const finBuckets = d.indexOf('  ) b;', d.indexOf(BUCKETS));
chk('fin de la subconsulta de buckets', finBuckets > 0);
d = d.slice(0, finBuckets + '  ) b;'.length) + "\n  v_total_pen := round(v_total * v_tc, 2);   -- equivalente en soles con el total definitivo" + d.slice(finBuckets + '  ) b;'.length);

// (d) NubeFact exige tipo_de_cambio en comprobantes en dólares
const MON = "'moneda', case when coalesce(p_moneda,'PEN')='USD' then 2 else 1 end, 'porcentaje_de_igv', 18,";
chk('ancla moneda del payload', d.includes(MON));
d = d.replace(MON, "'moneda', case when coalesce(p_moneda,'PEN')='USD' then 2 else 1 end, 'porcentaje_de_igv', 18,\n"+
  "    'tipo_de_cambio', case when upper(coalesce(p_moneda,'PEN'))='USD' then v_tc else null end,   -- NubeFact lo exige en USD");

if(!pass){console.log('✗ anchors');process.exit(1);}
await c.query('begin');
await c.query('CREATE OR REPLACE '+d.slice(d.indexOf('FUNCTION')));
const b=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
const pTC=b.indexOf('v_total_pen := round'), pGuard=b.indexOf('v_total_pen > 700');
chk('la conversión ocurre ANTES de los guards', pTC>0 && pGuard>pTC, {conversion:pTC, guard:pGuard});
chk('tipo_de_cambio en el payload', /'tipo_de_cambio', case when upper/.test(b));
chk('doble refresco del equivalente en soles', (b.match(/v_total_pen := round/g)||[]).length===2);

// smoke: US$250 ≈ S/842 con cliente Varios → ahora SÍ debe frenar ANTES de llegar a NubeFact
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:adm.u,role:'authenticated'})]);
try{ await c.query('savepoint s');
  await c.query("select emitir_comprobante(p_tipo=>2,p_serie=>'BBB1',p_cliente_doc_tipo=>'0',p_cliente_doc=>'',p_cliente_nombre=>'VARIOS',p_cliente_email=>'',p_items=>'[{\"descripcion\":\"T\",\"cantidad\":1,\"precio\":250}]'::jsonb,p_exonerado=>false,p_moneda=>'USD',p_origen=>'panel',p_operacion_ref=>null,p_creado_por=>'smoke',p_local_id=>'smoke-tcord',p_cliente_tel=>'',p_cliente_dir=>'',p_es_extranjero=>false,p_medio_pago=>'Efectivo',p_exportacion=>false,p_detraccion=>false)");
  await c.query('rollback to savepoint s'); chk('US$250 con Varios → frena antes de NubeFact', false, 'NO lanzó');
}catch(e){ await c.query('rollback to savepoint s');
  chk('US$250 (≈S/842) con Varios → BOLETA_MAYOR_700_REQUIERE_ID', /BOLETA_MAYOR_700_REQUIERE_ID/.test(e.message), e.message.slice(0,70)); }
try{ await c.query('savepoint s2');
  await c.query("select emitir_comprobante(p_tipo=>1,p_serie=>'FFF1',p_cliente_doc_tipo=>'6',p_cliente_doc=>'20000000001',p_cliente_nombre=>'E',p_cliente_email=>'',p_items=>'[{\"descripcion\":\"T\",\"cantidad\":1,\"precio\":100}]'::jsonb,p_exonerado=>false,p_moneda=>'USD',p_origen=>'panel',p_operacion_ref=>null,p_creado_por=>'smoke',p_local_id=>'smoke-tcdet',p_cliente_tel=>'',p_cliente_dir=>'D',p_es_extranjero=>false,p_medio_pago=>'Efectivo',p_exportacion=>false,p_detraccion=>true)");
  await c.query('rollback to savepoint s2'); chk('factura US$100 con detracción → frena', false, 'NO lanzó');
}catch(e){ await c.query('rollback to savepoint s2');
  chk('factura US$100 (≈S/337) con detracción → DETRACCION_SOLO_FACTURA_B2B', /DETRACCION_SOLO_FACTURA_B2B/.test(e.message), e.message.slice(0,70)); }
if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
const c2=mk();await c2.connect();
const f=(await c2.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='emitir_comprobante'")).rows[0].d;
const cnt=(await c2.query("select count(*)::int n from comprobantes")).rows[0].n;
console.log('\n[fresca] tipo_de_cambio en payload: '+/'tipo_de_cambio'/.test(f)+' · comprobantes: '+cnt+' (deben seguir 62)');
await c2.end();
if(cnt!==62){console.log('✗ se creó un comprobante');process.exit(1);}
console.log('\n★ orden de conversión + tipo_de_cambio para NubeFact — COMMIT verificado');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
