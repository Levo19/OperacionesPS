// CRUD de CLIENTES FRECUENTES y SERVICIOS en el módulo Catálogo del panel (pedido dueño 2026-08-17).
// Clientes: solo había buscar (buscar_cliente / buscar_clientes_like) — faltaba listar completo,
// editar de verdad (guardar_cliente NO permite VACIAR campos por su coalesce, ni corregir el
// documento que es la PK) y eliminar. Servicios: listar_servicios oculta inactivos y no expone
// activo/paquete_zarpe → el admin no podía reactivar ni ver qué va en el paquete del zarpe.
// Protegido: cliente VARIOS ('0'/'00000000') intocable; servicio del paquete de zarpe no se borra.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const mk=()=>new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const c=mk();
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
const SQL=`
-- ═══ CLIENTES ═══
create or replace function public.admin_listar_clientes(p_q text default '', p_limite int default 500)
returns jsonb language plpgsql stable security definer set search_path to 'public','auth' as $$
declare v jsonb; q text; begin
  perform _req_admin();
  q := trim(coalesce(p_q,''));
  select coalesce(jsonb_agg(x order by (x->>'veces')::int desc, x->>'nombre'), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'doc_tipo', cl.doc_tipo, 'doc_numero', cl.doc_numero, 'nombre', cl.nombre,
      'direccion', coalesce(cl.direccion,''), 'email', coalesce(cl.email,''), 'telefono', coalesce(cl.telefono,''),
      'es_extranjero', coalesce(cl.es_extranjero,false), 'veces', coalesce(cl.veces,0),
      'creado', cl.creado_at, 'actualizado', cl.actualizado_at,
      'es_varios', (cl.doc_tipo='0' and cl.doc_numero='00000000'),
      'cpes', (select count(*) from comprobantes cp where cp.cliente_doc = cl.doc_numero and coalesce(cp.cliente_doc_tipo,'') = cl.doc_tipo)
    ) x
    from clientes cl
    where q = '' or cl.nombre ilike '%'||q||'%' or cl.doc_numero ilike '%'||q||'%'
    limit greatest(coalesce(p_limite,500),1)
  ) s;
  return v;
end $$;

-- Crear/editar. Permite CORREGIR el documento (PK) vía doc_tipo_old/doc_numero_old y VACIAR campos.
create or replace function public.admin_guardar_cliente(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','auth' as $$
declare v_dt text; v_dn text; v_ot text; v_on text; v_nom text; v_edit boolean; begin
  perform _req_admin();
  v_dt := nullif(trim(coalesce(p->>'doc_tipo','')),'');
  v_dn := nullif(trim(coalesce(p->>'doc_numero','')),'');
  v_ot := nullif(trim(coalesce(p->>'doc_tipo_old','')),'');
  v_on := nullif(trim(coalesce(p->>'doc_numero_old','')),'');
  v_nom:= nullif(trim(coalesce(p->>'nombre','')),'');
  v_edit := (v_ot is not null and v_on is not null);
  if v_dt is null or v_dn is null then raise exception 'DOC_REQUERIDO: elige el tipo y escribe el número de documento'; end if;
  if v_nom is null then raise exception 'NOMBRE_REQUERIDO: el cliente necesita nombre o razón social'; end if;
  if v_dt not in ('0','1','4','6','7') then raise exception 'DOC_TIPO_INVALIDO: usa DNI, CE, Pasaporte, RUC o Tax-ID'; end if;
  -- VARIOS es el cliente público del sistema: su identidad no se toca
  if v_edit and v_ot='0' and v_on='00000000' and (v_dt<>'0' or v_dn<>'00000000') then
    raise exception 'CLIENTE_VARIOS_PROTEGIDO: VARIOS es el cliente público del sistema — no se puede renombrar su documento'; end if;
  if not v_edit and v_dt='0' and v_dn='00000000' then
    raise exception 'CLIENTE_VARIOS_PROTEGIDO: VARIOS ya existe'; end if;
  -- formato por tipo (mismas reglas que el emisor de CPE)
  if v_dt='1' and v_dn !~ '^[0-9]{8}$' then raise exception 'DNI_INVALIDO: el DNI tiene 8 dígitos'; end if;
  if v_dt='6' and v_dn !~ '^(10|15|17|20)[0-9]{9}$' then raise exception 'RUC_INVALIDO: el RUC tiene 11 dígitos y empieza en 10, 15, 17 o 20'; end if;
  if v_edit and (v_ot<>v_dt or v_on<>v_dn) then
    if exists(select 1 from clientes where doc_tipo=v_dt and doc_numero=v_dn) then
      raise exception 'DOC_YA_EXISTE: ya hay un cliente con ese documento'; end if;
    update clientes set doc_tipo=v_dt, doc_numero=v_dn, nombre=v_nom,
      direccion=nullif(trim(coalesce(p->>'direccion','')),''), email=nullif(trim(coalesce(p->>'email','')),''),
      telefono=nullif(trim(coalesce(p->>'telefono','')),''), es_extranjero=coalesce((p->>'es_extranjero')::boolean,false),
      actualizado_at=now()
    where doc_tipo=v_ot and doc_numero=v_on;
    if not found then raise exception 'NO_EXISTE: el cliente que intentas editar ya no está'; end if;
  elsif v_edit then
    update clientes set nombre=v_nom,
      direccion=nullif(trim(coalesce(p->>'direccion','')),''), email=nullif(trim(coalesce(p->>'email','')),''),
      telefono=nullif(trim(coalesce(p->>'telefono','')),''), es_extranjero=coalesce((p->>'es_extranjero')::boolean,false),
      actualizado_at=now()
    where doc_tipo=v_ot and doc_numero=v_on;
    if not found then raise exception 'NO_EXISTE: el cliente que intentas editar ya no está'; end if;
  else
    if exists(select 1 from clientes where doc_tipo=v_dt and doc_numero=v_dn) then
      raise exception 'DOC_YA_EXISTE: ya hay un cliente con ese documento'; end if;
    insert into clientes(doc_tipo,doc_numero,nombre,direccion,email,telefono,es_extranjero,veces)
      values(v_dt,v_dn,v_nom,nullif(trim(coalesce(p->>'direccion','')),''),nullif(trim(coalesce(p->>'email','')),''),
             nullif(trim(coalesce(p->>'telefono','')),''),coalesce((p->>'es_extranjero')::boolean,false),0);
  end if;
  return jsonb_build_object('ok',true,'doc_tipo',v_dt,'doc_numero',v_dn);
end $$;

create or replace function public.admin_eliminar_cliente(p_doc_tipo text, p_doc text)
returns jsonb language plpgsql security definer set search_path to 'public','auth' as $$
declare v_n int; begin
  perform _req_admin();
  if coalesce(p_doc_tipo,'')='0' and coalesce(p_doc,'')='00000000' then
    raise exception 'CLIENTE_VARIOS_PROTEGIDO: VARIOS es el cliente público del sistema — no se elimina'; end if;
  delete from clientes where doc_tipo=p_doc_tipo and doc_numero=p_doc;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'NO_EXISTE: ese cliente ya no está'; end if;
  -- los CPE ya emitidos conservan su copia de los datos del cliente (no se alteran)
  return jsonb_build_object('ok',true);
end $$;

-- ═══ SERVICIOS ═══ (incluye inactivos + flags que listar_servicios oculta)
create or replace function public.admin_listar_servicios_full()
returns jsonb language sql stable security definer set search_path to 'public','auth' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'nombre',nombre,'descripcion',coalesce(descripcion,''),
    'precio',precio_defecto,'unidad',unidad,'activo',coalesce(activo,true),
    'paquete_zarpe',coalesce(paquete_zarpe,false)) order by coalesce(activo,true) desc, nombre), '[]'::jsonb)
  from servicios where (select 1 from (select _req_admin()) _) is not null $$;

-- Marca/desmarca el servicio como parte del paquete por defecto del zarpe
create or replace function public.admin_servicio_paquete(p_id text, p_on boolean)
returns jsonb language plpgsql security definer set search_path to 'public','auth' as $$
declare v_act boolean; begin
  perform _req_admin();
  select activo into v_act from servicios where id=p_id;
  if not found then raise exception 'NO_EXISTE: servicio %', p_id; end if;
  if coalesce(p_on,false) and not coalesce(v_act,true) then
    raise exception 'SERVICIO_INACTIVO: actívalo antes de ponerlo en el paquete del zarpe'; end if;
  update servicios set paquete_zarpe=coalesce(p_on,false) where id=p_id;
  return jsonb_build_object('ok',true);
end $$;

-- Borrado DEFINITIVO (el "eliminar" normal solo desactiva). Bloqueado si está en el paquete del zarpe.
create or replace function public.admin_borrar_servicio_def(p_id text)
returns jsonb language plpgsql security definer set search_path to 'public','auth' as $$
declare v_pq boolean; v_n int; begin
  perform _req_admin();
  select coalesce(paquete_zarpe,false) into v_pq from servicios where id=p_id;
  if not found then raise exception 'NO_EXISTE: ese servicio ya no está'; end if;
  if v_pq then raise exception 'SERVICIO_EN_PAQUETE: quítalo del paquete del zarpe antes de borrarlo'; end if;
  delete from servicios where id=p_id;
  get diagnostics v_n = row_count;
  -- los CPE ya emitidos guardan su propia copia de los ítems (no se alteran)
  return jsonb_build_object('ok', v_n>0);
end $$;
`;
(async()=>{await c.connect();try{
await c.query('begin');
await c.query(SQL);
for(const f of ['admin_listar_clientes','admin_guardar_cliente','admin_eliminar_cliente','admin_listar_servicios_full','admin_servicio_paquete','admin_borrar_servicio_def'])
  chk('creada '+f, (await c.query("select count(*)::int n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname=$1",[f])).rows[0].n===1);
// gate admin: anon/authenticated NO pueden (las RPC llaman _req_admin dentro; el grant es por diseño)
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);

// ── smokes (savepoint, sin residuos) ──
await c.query('savepoint sv');
let r=(await c.query("select admin_listar_clientes('',500) d")).rows[0].d;
chk('listar clientes: 18 filas con cpes y es_varios', r.length===18 && r.some(x=>x.es_varios===true) && r.every(x=>'cpes' in x), {n:r.length, varios:r.find(x=>x.es_varios)});
const conCpe=r.find(x=>x.cpes>0);
chk('listar clientes: cuenta CPEs reales', !!conCpe, conCpe && {nom:conCpe.nombre, cpes:conCpe.cpes});
r=(await c.query("select admin_listar_clientes('paracas',500) d")).rows[0].d;
chk('listar clientes: filtra por texto', r.length>0 && r.every(x=>/paracas/i.test(x.nombre)||/paracas/i.test(x.doc_numero)), r.map(x=>x.nombre));
// crear
await c.query("select admin_guardar_cliente($1::jsonb)",[J({doc_tipo:'1',doc_numero:'00000001',nombre:'SMOKE CLIENTE',telefono:'999888777'})]);
r=(await c.query("select nombre,telefono from clientes where doc_tipo='1' and doc_numero='00000001'")).rows[0];
chk('crear cliente', r && r.nombre==='SMOKE CLIENTE' && r.telefono==='999888777', r);
// editar + VACIAR campo (lo que guardar_cliente NO podía)
await c.query("select admin_guardar_cliente($1::jsonb)",[J({doc_tipo_old:'1',doc_numero_old:'00000001',doc_tipo:'1',doc_numero:'00000001',nombre:'SMOKE EDITADO',telefono:''})]);
r=(await c.query("select nombre,telefono from clientes where doc_tipo='1' and doc_numero='00000001'")).rows[0];
chk('editar cliente + vaciar teléfono', r && r.nombre==='SMOKE EDITADO' && r.telefono===null, r);
// corregir el DOCUMENTO (PK)
await c.query("select admin_guardar_cliente($1::jsonb)",[J({doc_tipo_old:'1',doc_numero_old:'00000001',doc_tipo:'1',doc_numero:'00000002',nombre:'SMOKE EDITADO'})]);
chk('corregir documento (PK)', (await c.query("select count(*)::int n from clientes where doc_tipo='1' and doc_numero='00000002'")).rows[0].n===1);
// validaciones
const err=async(sql,params,re,label)=>{ try{ await c.query('savepoint e'); await c.query(sql,params); await c.query('rollback to savepoint e'); chk(label,false,'NO lanzó'); }
  catch(e){ await c.query('rollback to savepoint e'); chk(label, re.test(e.message), e.message.slice(0,60)); } };
await err("select admin_guardar_cliente($1::jsonb)",[J({doc_tipo:'1',doc_numero:'123',nombre:'X'})],/DNI_INVALIDO/,'DNI de 3 dígitos → rechaza');
await err("select admin_guardar_cliente($1::jsonb)",[J({doc_tipo:'6',doc_numero:'99999999999',nombre:'X'})],/RUC_INVALIDO/,'RUC con prefijo malo → rechaza');
await err("select admin_guardar_cliente($1::jsonb)",[J({doc_tipo:'1',doc_numero:'45114935',nombre:'X'})],/DOC_YA_EXISTE/,'documento duplicado → rechaza');
await err("select admin_guardar_cliente($1::jsonb)",[J({doc_tipo:'1',doc_numero:'00000009',nombre:''})],/NOMBRE_REQUERIDO/,'sin nombre → rechaza');
await err("select admin_eliminar_cliente('0','00000000')",[],/CLIENTE_VARIOS_PROTEGIDO/,'eliminar VARIOS → bloqueado');
await err("select admin_guardar_cliente($1::jsonb)",[J({doc_tipo_old:'0',doc_numero_old:'00000000',doc_tipo:'1',doc_numero:'12345678',nombre:'X'})],/CLIENTE_VARIOS_PROTEGIDO/,'renombrar doc de VARIOS → bloqueado');
// eliminar
await c.query("select admin_eliminar_cliente('1','00000002')");
chk('eliminar cliente', (await c.query("select count(*)::int n from clientes where doc_numero='00000002'")).rows[0].n===0);
await err("select admin_eliminar_cliente('1','00000002')",[],/NO_EXISTE/,'eliminar inexistente → mensaje claro');
// servicios
const sv=(await c.query('select admin_listar_servicios_full() d')).rows[0].d;
chk('servicios full: 13 con activo+paquete_zarpe', sv.length===13 && sv.every(x=>'activo' in x && 'paquete_zarpe' in x) && sv.filter(x=>x.paquete_zarpe).length===2, {n:sv.length, paquete:sv.filter(x=>x.paquete_zarpe).map(x=>x.nombre)});
await err("select admin_borrar_servicio_def('SVC-0003')",[],/SERVICIO_EN_PAQUETE/,'borrar servicio del paquete zarpe → bloqueado');
const nid=(await c.query("select admin_set_servicio('','SMOKE SERVICIO','',10,'ZZ',true) id")).rows[0].id;
await c.query("select admin_servicio_paquete($1,true)",[nid]);
chk('marcar paquete zarpe', (await c.query('select paquete_zarpe from servicios where id=$1',[nid])).rows[0].paquete_zarpe===true);
await c.query("select admin_servicio_paquete($1,false)",[nid]);
await c.query("select admin_borrar_servicio_def($1)",[nid]);
chk('borrado definitivo de servicio', (await c.query('select count(*)::int n from servicios where id=$1',[nid])).rows[0].n===0);
await c.query('rollback to savepoint sv');
if(!pass){await c.query('rollback');console.log('\n✗ ROLLBACK');process.exit(1);}
await c.query('commit');
// conexión fresca: funciones vivas + CERO residuo de los smokes
const c2=mk();await c2.connect();
const n=(await c2.query("select count(*)::int n from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace where n2.nspname='public' and p.proname in ('admin_listar_clientes','admin_guardar_cliente','admin_eliminar_cliente','admin_listar_servicios_full','admin_servicio_paquete','admin_borrar_servicio_def')")).rows[0].n;
const res=(await c2.query("select (select count(*) from clientes) cli, (select count(*) from servicios) svc, (select count(*) from clientes where nombre like 'SMOKE%') resid_c, (select count(*) from servicios where nombre like 'SMOKE%') resid_s")).rows[0];
console.log('\n[fresca] funciones: '+n+'/6 · clientes: '+res.cli+' · servicios: '+res.svc+' · residuos: '+(Number(res.resid_c)+Number(res.resid_s)));
await c2.end();
if(n!==6 || Number(res.resid_c)+Number(res.resid_s)!==0 || Number(res.cli)!==18 || Number(res.svc)!==13){console.log('✗ NO PERSISTIÓ o quedó residuo');process.exit(1);}
console.log('\n★ CRUD clientes + servicios (catálogo) — COMMIT verificado');
}catch(e){try{await c.query('rollback')}catch(_){}console.error('FATAL:',e.message);process.exit(1)}finally{await c.end()}
})();
