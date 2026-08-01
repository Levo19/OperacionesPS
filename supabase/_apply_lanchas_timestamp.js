// get_lanchas_dia: agrega 'timestamp' (hora de registro Lima) a movimientos y pases_sueltos.
// El ticket del panel agrupa endoses por m.timestamp → sin el campo salía "🕐 ??:??".
// Se parcha la DEFINICIÓN VIVA (pg_get_functiondef) porque ps_reads.sql no es la última.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
(async()=>{await c.connect();try{
const def=(await c.query("select pg_get_functiondef('get_lanchas_dia(date)'::regprocedure) d")).rows[0].d;
const TS=`'timestamp',to_char(m.registrado_at at time zone 'America/Lima','YYYY-MM-DD HH24:MI'),`;
// dos puntos de inserción: jsonb de movimientos de op y jsonb de pases_sueltos
const marks=[...def.matchAll(/'id_mov',\s*m\.id,/g)];
chk('definición viva tiene 2 jsonb de movimientos (op + pases)', marks.length===2, {n:marks.length});
if(marks.length!==2){process.exit(1);}
let out='', last=0;
for(const m of marks){ out+=def.slice(last,m.index+m[0].length)+TS; last=m.index+m[0].length; }
out+=def.slice(last);
chk('parche insertado 2 veces', (out.match(/'timestamp',to_char\(m\.registrado_at/g)||[]).length===2);

await c.query('begin');
await c.query(out);

// prueba: op + movimiento endosado + pase suelto de HOY, y verificar timestamp en ambos
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
await c.query("insert into contactos(id,nombre,tipo,precio_defecto,activo) values('ZT-ORI','Origen T','agencia',40,true),('ZT-ALI','Aliado T','aliado',0,true) on conflict (id) do nothing");
await c.query("insert into embarcaciones(id,nombre,capacidad_pax) values('ZT-BT','Bote TS',20) on conflict (id) do nothing");
await c.query(`insert into operaciones(id,fecha,hora_salida,bote_id,estado,destino) values('ZT-OPT',(now() at time zone 'America/Lima')::date,'09:00 AM','ZT-BT','Abierta','Islas Ballestas') on conflict (id) do nothing`);
await c.query(`insert into movimientos(id,operacion_id,tipo,contacto_id,nombre_contacto,cant_pax,precio_unit,monto_total,operador,registrado_at,estado,contacto_pase_id)
  values('ZT-MV1','ZT-OPT','Aliado(PaseOut)','ZT-ORI','Origen T',3,0,0,'t',now(),'Pasado','ZT-ALI'),
         ('ZT-MV2','PASE_DIRECTO','Aliado(PaseOut)','ZT-ORI','Origen T',2,0,0,'t',now(),'Pasado','ZT-ALI')
  on conflict (id) do nothing`);
const hoy=(await c.query("select (now() at time zone 'America/Lima')::date::text f")).rows[0].f;
const ld=(await c.query("select get_lanchas_dia($1::date) j",[hoy])).rows[0].j;
const opT=(ld.operaciones||[]).find(o=>o.id==='ZT-OPT');
const mv1=opT&&(opT.movimientos||[]).find(m=>m.id_mov==='ZT-MV1');
const mv2=(ld.pases_sueltos||[]).find(m=>m.id_mov==='ZT-MV2');
const reTs=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
chk('movimiento de op trae timestamp YYYY-MM-DD HH:MM', !!mv1&&reTs.test(mv1.timestamp||''), mv1&&mv1.timestamp);
chk('pase suelto trae timestamp YYYY-MM-DD HH:MM', !!mv2&&reTs.test(mv2.timestamp||''), mv2&&mv2.timestamp);

// horaEndose del ticket (copia VERBATIM del regex) debe extraer la hora del nuevo formato
const mSlash=String(mv2&&mv2.timestamp).match(/\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\s+(\d{1,2}:\d{2})/);
chk('horaEndose (regex del ticket) extrae la hora', !!mSlash, mSlash&&mSlash[1]);

// limpieza
await c.query("delete from movimientos where id in ('ZT-MV1','ZT-MV2')");
await c.query("delete from operaciones where id='ZT-OPT'");
await c.query("delete from embarcaciones where id='ZT-BT'");
await c.query("delete from contactos where id in ('ZT-ORI','ZT-ALI')");
if(!pass){await c.query('rollback');console.log('\n✗ FALLÓ — rollback, PROD intacto');process.exit(1);}
await c.query('commit');
fs.writeFileSync('lanchas_dia_timestamp.sql','-- get_lanchas_dia con timestamp de registro (2026-08-01) — generado del vivo + parche\n'+out+';\n');
console.log('\n★ get_lanchas_dia con timestamp APLICADO a PROD (def guardada en lanchas_dia_timestamp.sql)');
process.exit(0);
}catch(e){try{await c.query('rollback');}catch(_){}
console.error('ERROR:',e.message);process.exit(1);}finally{await c.end();}})();
