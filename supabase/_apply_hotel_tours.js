// Aplica hotel_tours.sql y corre la suite (tests de flujo en transacción con ROLLBACK).
const {Client}=require('pg');const fs=require('fs');
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim(),database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true,n=0;
const chk=(l,cond,g)=>{n++;console.log((cond?'✓':'✗')+' '+l+(g!==undefined&&!cond?' → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();
try{
  await c.query(fs.readFileSync('hotel_tours.sql','utf8'));
  console.log('— DDL aplicado —');
  await c.query('begin');
  const eq=(await c.query("select auth_uid,nombre from equipo where lower(email)='luisvo.19@gmail.com'")).rows[0];
  await c.query("select set_config('request.jwt.claims',$1,true), set_config('role','authenticated',true)",[J({sub:eq.auth_uid,email:'luisvo.19@gmail.com',role:'authenticated'})]);

  chk('tarifa HT MUNAY = 25',Number((await c.query("select precio_defecto from contactos where id='CON-18'")).rows[0].precio_defecto)===25);
  chk('catálogo adicionales sembrado (5)',Number((await c.query('select count(*)::int n from adicionales_catalogo')).rows[0].n)>=5);

  // reserva de hotel + tour
  const cu=(await c.query('select id from hotel_cuartos limit 1')).rows[0].id;
  const hres=(await c.query("select hotel_reservar(jsonb_build_object('cuarto_id',$1::bigint,'huesped','TEST TOURS','telefono','519990','fecha_in',(current_date)::text,'fecha_out',(current_date+2)::text,'precio_noche',100,'canal','walkin','local_id','tt-1')) v",[cu])).rows[0].v;
  const t=(await c.query("select hotel_tour_crear(jsonb_build_object('reserva_id',$1::bigint,'tour','Islas Ballestas','fecha',(current_date+1)::text,'hora','08:00 AM','recojo','07:00 AM','pax',3,'precio_huesped',30,'nota','alérgico al camarón','local_id','tt-tour-1')) v",[hres.id])).rows[0].v;
  chk('hotel_tour_crear ok',t.ok===true&&!!t.ops_reserva_id,t);

  // reserva creada en el CRM del muelle con monto y JSON
  const ops=(await c.query('select contacto_id,cliente,pax,monto,estado,hora,detalle from reservas where id=$1',[t.ops_reserva_id])).rows[0];
  chk('CRM: contacto HT MUNAY',ops.contacto_id==='CON-18',ops.contacto_id);
  chk('CRM: cliente con cuarto y Casa Munay',/TEST TOURS.*Cuarto.*Casa Munay/.test(ops.cliente),ops.cliente);
  chk('CRM: monto = 3 pax × 25 = 75',Number(ops.monto)===75,ops.monto);
  chk('CRM: estado Pendiente (visible al operador)',ops.estado==='Pendiente');
  chk('CRM: JSON detalle con origen/recojo/nota',ops.detalle&&ops.detalle.origen==='munayops'&&ops.detalle.recojo==='07:00 AM'&&/camarón/.test(ops.detalle.nota),ops.detalle);

  // duplicado idempotente
  const t2=(await c.query("select hotel_tour_crear(jsonb_build_object('reserva_id',$1::bigint,'tour','Islas Ballestas','fecha',(current_date+1)::text,'hora','08:00 AM','recojo','07:00 AM','pax',3,'precio_huesped',30,'local_id','tt-tour-1')) v",[hres.id])).rows[0].v;
  chk('idempotente (dup)',t2.dup===true,t2);

  // pago AL FINAL: aún no hay cargo en folio
  chk('sin cargo al folio antes de realizado',Number((await c.query('select count(*)::int n from hotel_consumos where reserva_id=$1',[hres.id])).rows[0].n)===0);
  // realizado → cargo 3 × 30
  await c.query("select hotel_tour_estado(jsonb_build_object('tour_id',$1::bigint,'accion','realizado'))",[t.id]);
  const cons=(await c.query('select cantidad,precio,item from hotel_consumos where reserva_id=$1',[hres.id])).rows[0];
  chk('realizado → cargo 3 × S/30',cons&&Number(cons.cantidad)===3&&Number(cons.precio)===30,cons);
  chk('folio saldo 2 noches(200)+tour(90)=290',Number((await c.query('select saldo from hotel_folio where reserva_id=$1',[hres.id])).rows[0].saldo)===290);

  // retroactivo: suspender → reversa cargo + anula CRM
  await c.query("select hotel_tour_estado(jsonb_build_object('tour_id',$1::bigint,'accion','suspendido'))",[t.id]);
  chk('suspendido → cargo reversado',Number((await c.query('select count(*)::int n from hotel_consumos where reserva_id=$1',[hres.id])).rows[0].n)===0);
  chk('suspendido → reserva CRM Anulada',(await c.query('select estado from reservas where id=$1',[t.ops_reserva_id])).rows[0].estado==='Anulada');
  chk('saldo vuelve a 200',Number((await c.query('select saldo from hotel_folio where reserva_id=$1',[hres.id])).rows[0].saldo)===200);

  // money regression del muelle intacta
  chk('es_staff sigue true',(await c.query('select es_staff() s')).rows[0].s===true);
  await c.query('rollback');console.log('ROLLBACK — nada persistió (solo DDL + tarifa CON-18 quedan).');
  console.log(pass?`\n★ SUITE PASS (${n})`:`\n✗ FALLAS (${n})`);
  process.exit(pass?0:1);
}catch(e){try{await c.query('rollback')}catch(_){};console.error('ERROR:',e.message);process.exit(1)}
finally{await c.end()}})();
