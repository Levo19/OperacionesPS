// Aplica editar_operacion_full.sql a PROD y lo testea (datos de prueba con rollback selectivo).
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
const guard=async(sql)=>{await c.query('savepoint g');try{await c.query(sql);return '';}catch(e){return e.message;}finally{await c.query('rollback to savepoint g');}};
(async()=>{await c.connect();try{
await c.query('begin');
await c.query(fs.readFileSync('editar_operacion_full.sql','utf8'));

// admin real (equipo único)
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
// operador NO admin de ps (para probar el candado)
const opr=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app in ('ps','muelle') and a.rol<>'admin' and p.activo and a.activo and p.auth_uid is not null and not exists (select 1 from equipo_accesos a2 where a2.equipo_id=p.id and a2.app='ps' and a2.rol='admin' and a2.activo) limit 1")).rows[0];
chk('hay admin y operador de prueba', !!adm && !!opr, {adm:!!adm,opr:!!opr});
const como=async(uid)=>c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:uid,role:'authenticated'})]);

// datos de prueba
await c.query("insert into embarcaciones(id,nombre,capacidad_pax) values('ZE-B1','Bote Uno T',20),('ZE-B2','Bote Dos T',30) on conflict (id) do nothing");
await c.query("insert into personal(id,nombre,rol) values('ZE-C1','Capi T','Capitán'),('ZE-G1','Guia T','Guía') on conflict (id) do nothing");
await c.query("insert into operaciones(id,fecha,hora_salida,bote_id,capitan_id,estado,destino) values('ZE-OP1',(now() at time zone 'America/Lima')::date,'08:00 AM','ZE-B1','ZE-C1','Abierta','Islas Ballestas') on conflict (id) do nothing");

// 1) admin edita TODO (bote+destino+fecha+estado+hora+guía)
await como(adm.u);
await c.query("select editar_operacion(p_op:='ZE-OP1', p_hora:='10:00 AM', p_guia:='ZE-G1', p_bote:='ZE-B2', p_destino:='Islas Blancas', p_fecha:=((now() at time zone 'America/Lima')::date + 1), p_estado:='En_Viaje')");
const o1=(await c.query("select hora_salida,guia_id,bote_id,destino,estado,fecha=(now() at time zone 'America/Lima')::date+1 fmov from operaciones where id='ZE-OP1'")).rows[0];
chk('admin: bote+destino+fecha+estado+hora+guía aplicados', o1.bote_id==='ZE-B2'&&o1.destino==='Islas Blancas'&&o1.estado==='En_Viaje'&&o1.hora_salida==='10:00 AM'&&o1.guia_id==='ZE-G1'&&o1.fmov===true, o1);

// 2) firma vieja (4 args nombrados, como llama OPS) sigue funcionando tras el DROP
await c.query("select editar_operacion(p_op:='ZE-OP1', p_capitan:='ZE-C1', p_guia:='ZE-G1', p_hora:='11:00 AM')");
const o2=(await c.query("select hora_salida,bote_id,destino from operaciones where id='ZE-OP1'")).rows[0];
chk('compat OPS: 4 args nombrados OK y NO toca bote/destino', o2.hora_salida==='11:00 AM'&&o2.bote_id==='ZE-B2'&&o2.destino==='Islas Blancas', o2);

// 3) candados
chk('rechaza bote inexistente', /BOTE_INVALIDO/.test(await guard("select editar_operacion(p_op:='ZE-OP1', p_bote:='NO-EXISTE')")));
chk('rechaza estado inválido', /ESTADO_INVALIDO/.test(await guard("select editar_operacion(p_op:='ZE-OP1', p_estado:='Volando')")));
chk('rechaza op inexistente', /NO_EXISTE/.test(await guard("select editar_operacion(p_op:='NADA-XX', p_hora:='09:00 AM')")));
await como(opr.u);
chk('NO-admin: fecha/estado bloqueados', /SOLO_ADMIN/.test(await guard("select editar_operacion(p_op:='ZE-OP1', p_estado:='Cerrada')")));
const gOk=await guard("select editar_operacion(p_op:='ZE-OP1', p_destino:='Islas Ballestas')");
chk('NO-admin: destino/bote/hora SÍ puede', gOk==='', gOk);

// 4) el cambio se ve en las lecturas de ambos lados (mismo origen)
await como(adm.u);
const hoy1=(await c.query("select fecha::text f from operaciones where id='ZE-OP1'")).rows[0].f;
const ld=(await c.query("select get_lanchas_dia($1::date)::text t",[hoy1])).rows[0].t;
chk('panel (get_lanchas_dia) ve la op editada', ld.includes('ZE-OP1') && ld.includes('Islas Blancas'), undefined);
const dash=(await c.query("select get_dashboard()::text t")).rows[0].t;
chk('OPS (get_dashboard) responde (propagación por poll 10s)', dash.length>10, undefined);

// limpieza
await c.query("delete from operaciones where id='ZE-OP1'");
await c.query("delete from personal where id in ('ZE-C1','ZE-G1')");
await c.query("delete from embarcaciones where id in ('ZE-B1','ZE-B2')");
if(!pass){await c.query('rollback');console.log('\n✗ FALLÓ — rollback total, PROD intacto');process.exit(1);}
await c.query('commit');
console.log('\n★ editar_operacion FULL aplicado a PROD (pruebas limpiadas)');
process.exit(0);
}catch(e){try{await c.query('rollback');}catch(_){}
console.error('ERROR:',e.message);process.exit(1);}finally{await c.end();}})();
