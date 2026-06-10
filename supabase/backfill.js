// ============================================================
// OperacionesPS · backfill Sheets(dump.json) -> Supabase Postgres
// Correcciones senior (2026-06-09): nombres reales de columna por hoja,
// fecha date-only para columnas `date`, soft-ref operacion_id sin FK.
// Uso: node backfill.js   (requiere dump.json en el cwd y `npm i pg`)
// ============================================================
const { Client } = require('pg'); const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync(__dirname+'/.pgpass','utf8').trim();   // secreto fuera del repo (.gitignore)
const cfg={host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}};
const D=JSON.parse(fs.readFileSync('dump.json','utf8')).data;
const rows=n=>{const a=D[n]||[];if(!a.length)return[];const h=a[0];return a.slice(1).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]])));};
const nn=v=>(v===''||v===undefined||v===null)?null:v;            // vacio->NULL
const num=v=>{const n=parseFloat(v);return isNaN(n)?0:n;};
const tsn=v=>{const s=nn(v);return s?String(s):null;};            // timestamptz: ISO completo
const dt=v=>{const s=nn(v);return s?String(s).slice(0,10):null;}; // date: solo YYYY-MM-DD (Z guarda 05:00 = medianoche Lima)
const tl=v=>String(v||'').trim().toLowerCase();
const adic=s=>{const o={};if(!s)return o;String(s).split(',').forEach(p=>{const i=p.indexOf(':');if(i>0){const k=p.slice(0,i).trim().toLowerCase();const x=parseFloat(p.slice(i+1));if(k&&!isNaN(x))o[k]=x;}});return o;};
(async()=>{
  const c=new Client(cfg); await c.connect();
  // movimiento_id en caja es soft-ref (mov historico purgado puede quedar referenciado); quita la FK dura si existe
  await c.query('alter table caja_operador drop constraint if exists caja_operador_movimiento_id_fkey');
  await c.query('truncate caja_operador,movimientos,reservas,operaciones,contactos,personal,embarcaciones,impuestos cascade');
  let skips=0;
  const ins=async(sql,list)=>{ for(const p of list){ try{await c.query(sql,p);}catch(e){skips++;console.log('skip',sql.slice(12,30),e.message.slice(0,70));} } return list.length; };
  // --- catalogos ---
  const per=rows('Personal').filter(r=>nn(r.id_empleado));
  await ins('insert into personal(id,nombre,rol,tarifa_fija,estado) values($1,$2,$3,$4,$5)',per.map(r=>[r.id_empleado,r.nombre,nn(r.rol),num(r.tarifa_fija),nn(r.estado)||'activo']));
  const emb=rows('Embarcaciones').filter(r=>nn(r.id_bote));
  await ins('insert into embarcaciones(id,nombre,capacidad_pax,matricula) values($1,$2,$3,$4)',emb.map(r=>[r.id_bote,r.nombre,r.capacidad_pax?parseInt(r.capacidad_pax):null,nn(r.matricula)]));
  const con=rows('Contactos').filter(r=>nn(r.id_contacto));
  const TIPO=t=>{t=tl(t);return ['agencia','aliado','comisionado','libre'].includes(t)?t:'libre';};
  await ins('insert into contactos(id,nombre,tipo,precio_defecto) values($1,$2,$3,$4)',con.map(r=>[r.id_contacto,r.nombre_comercial,TIPO(r.tipo),num(r.precio_pax_defecto)]));
  const imp=rows('Impuestos').filter(r=>nn(r.idimpuesto));
  await ins('insert into impuestos(id,nombre,monto) values($1,$2,$3)',imp.map(r=>[r.idimpuesto,r.nombre,num(r.monto)]));
  // sets validos para FK duros
  const SP=new Set(per.map(r=>r.id_empleado)), SE=new Set(emb.map(r=>r.id_bote)), SC=new Set(con.map(r=>r.id_contacto));
  const fk=(v,set)=>{v=nn(v);return v&&set.has(v)?v:null;};
  // --- operaciones (PK id_operacion; fecha date-only) ---
  const op=rows('Operaciones').filter(r=>nn(r.id_operacion));
  await ins('insert into operaciones(id,fecha,hora_salida,bote_id,capitan_id,guia_id,estado,creado_por,foto_zarpe_url,destino,creado_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    op.map(r=>[r.id_operacion,dt(r.fecha),nn(r.hora_salida),fk(r.id_bote,SE),fk(r.id_capitan,SP),fk(r.id_guia,SP),nn(r.estado)||'Cerrada',nn(r.creado_por),nn(r.foto_zarpe_url),nn(r.Destino),tsn(r.timestamp_creacion)]));
  // --- movimientos (operacion_id soft-ref: se conserva aunque la op sea historica) ---
  const mov=rows('Movimientos').filter(r=>nn(r.id_mov));
  const SM=new Set(mov.map(r=>r.id_mov));
  await ins('insert into movimientos(id,operacion_id,tipo,contacto_id,nombre_contacto,cant_pax,precio_unit,monto_total,adicionales,estado,operador,registrado_at,contacto_pase_id,agencia_comprada_id,monto_comprado) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
    mov.map(r=>[r.id_mov,nn(r.id_operacion),nn(r.tipo_movimiento),fk(r.id_contacto,SC),nn(r.nombreContacto),parseInt(r.cant_pax)||0,num(r.precio_unitario_aplicado),num(r.monto_total_cobrar),JSON.stringify(adic(r.adicionales)),nn(r.estado_movimiento)||'Embarcado',nn(r.operador_registro),tsn(r.timestamp_registro),fk(r.Id_contactoPase,SC),fk(r.id_agencia_comprada,SC),num(r.monto_comprado)]));
  // --- caja (Id_Contacto + timestamp_transaccion con mayusculas reales) ---
  const caj=rows('Caja_Operador').filter(r=>nn(r.id_transaccion));
  await ins('insert into caja_operador(id,operacion_id,contacto_id,categoria,monto,metodo_pago,comentarios,foto_url,operador,ts,movimiento_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    caj.map(r=>[r.id_transaccion,nn(r.id_operacion),fk(r.Id_Contacto,SC),nn(r.categoria),num(r.monto),nn(r.metodo_pago),nn(r.comentarios),nn(r.foto_comprobante_url),nn(r.operador_caja),tsn(r.timestamp_transaccion),nn(r.id_movimiento)]));
  // --- reservas (PK id_reserva; columnas _tour/_preferida/_final/_reserva) ---
  const res=rows('Reservas_CRM').filter(r=>nn(r.id_reserva));
  await ins('insert into reservas(id,fecha,hora,tipo,contacto_id,pax,monto,estado,cliente,creado_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    res.map(r=>[r.id_reserva,dt(r.fecha_tour),nn(r.hora_preferida),null,nn(r.id_contacto),parseInt(r.cant_pax)||0,num(r.monto),nn(r.estado_reserva)||'Pendiente',nn(r.nombre_cliente_final),tsn(r.fecha_tour)]));
  // --- conteos ---
  console.log('--- conteos ---');
  for(const t of ['personal','embarcaciones','contactos','impuestos','operaciones','movimientos','caja_operador','reservas']){
    const n=(await c.query('select count(*) n from '+t)).rows[0].n; console.log('  '+t.padEnd(15),n);
  }
  // chequeos de integridad post-carga
  const nulCaja=(await c.query("select count(*) n from caja_operador where ts is null")).rows[0].n;
  const nulCajaC=(await c.query("select count(*) n from caja_operador where contacto_id is null")).rows[0].n;
  const opFk=(await c.query("select count(*) n from operaciones where fecha is null")).rows[0].n;
  console.log('  caja ts NULL   ',nulCaja,'| caja contacto NULL',nulCajaC,'| op fecha NULL',opFk,'| skips',skips);
  await c.end(); console.log('OK backfill completo');
})().catch(e=>{console.error('ERROR',e.message);process.exit(1);});
