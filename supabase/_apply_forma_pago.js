// FORMA DE PAGO (RS 193-2020): CONTADO por defecto (NubeFact ya lo marca solo) + CRÉDITO
// con cuota única (venta_al_credito, validado contra demo: FFF1-15 ACEPTADA).
// Parcha las defs VIVAS de emitir_comprobante y listar_comprobantes + realinea correlativos.
const {Client}=require('pg');const fs=require('fs');
const PASS=process.env.PGPASS||fs.readFileSync('.pgpass','utf8').trim();
const c=new Client({host:'aws-1-us-west-2.pooler.supabase.com',port:5432,user:'postgres.lintmcxqxnrholslatul',password:PASS,database:'postgres',ssl:{rejectUnauthorized:false}});
const J=x=>JSON.stringify(x);let pass=true;
const chk=(l,cond,g)=>{console.log((cond?'✓':'✗')+' '+l+(g!==undefined?'  → '+J(g):''));if(!cond)pass=false;};
const guard=async(sql)=>{await c.query('savepoint g');try{await c.query(sql);return '';}catch(e){return e.message;}finally{await c.query('rollback to savepoint g');}};
(async()=>{await c.connect();try{
let def=(await c.query("select pg_get_functiondef('emitir_comprobante(integer,text,text,text,text,text,jsonb,boolean,text,text,text,text,text,text,text,boolean,text,boolean,boolean)'::regprocedure) d")).rows[0].d;

// ── parche 1: firma (+2 params con default) ──
const SIG='p_detraccion boolean DEFAULT false)';
chk('firma encontrada', def.includes(SIG));
def=def.replace(SIG, "p_detraccion boolean DEFAULT false, p_forma_pago text DEFAULT 'CONTADO'::text, p_credito_venc date DEFAULT NULL::date)");

// ── parche 2: declare ──
const DECL='v_err text; v_hash text;';
chk('declare encontrado', def.includes(DECL));
def=def.replace(DECL, DECL+' v_fpago text; v_venc date;');

// ── parche 3: validación tras bancarización ──
const BANC="raise exception 'REQUIERE_MEDIO_DE_PAGO: operación >= S/2000 exige indicar el medio de pago (bancarización)'; end if;";
chk('anchor bancarización', def.includes(BANC));
def=def.replace(BANC, BANC+`

  -- ── FORMA DE PAGO (RS 193-2020, vigente 2021-09): facturas indican contado/crédito ──
  -- CONTADO: no se envía nada (NubeFact marca contado por defecto en el XML).
  -- CREDITO: cuota única con vencimiento → venta_al_credito (validado en demo FFF1-15).
  v_fpago := upper(coalesce(nullif(trim(p_forma_pago),''),'CONTADO'));
  if v_fpago not in ('CONTADO','CREDITO') then raise exception 'FORMA_PAGO_INVALIDA: usa CONTADO o CREDITO (recibí %)', p_forma_pago; end if;
  if v_fpago = 'CREDITO' then
    if p_tipo <> 1 then raise exception 'CREDITO_SOLO_FACTURA: la venta al crédito se emite como factura'; end if;
    if p_exportacion then raise exception 'CREDITO_NO_EXPORTACION: exportación se registra al contado'; end if;
    v_venc := p_credito_venc;
    if v_venc is null then raise exception 'CREDITO_REQUIERE_VENCIMIENTO: indica la fecha de pago'; end if;
    if v_venc < (now() at time zone 'America/Lima')::date then raise exception 'CREDITO_VENCIMIENTO_PASADO: la fecha de pago no puede ser anterior a hoy'; end if;
  end if;`);

// ── parche 4: payload crédito tras armar v_body ──
const ITEMS="'items', _nf_items(p_items, p_exonerado, p_exportacion));";
chk('anchor items', def.includes(ITEMS));
def=def.replace(ITEMS, ITEMS+`
    if v_fpago = 'CREDITO' then
      v_body := v_body || jsonb_build_object(
        'fecha_de_vencimiento', to_char(v_venc,'YYYY-MM-DD'),
        'venta_al_credito', jsonb_build_array(jsonb_build_object('cuota',1,'fecha_de_pago',to_char(v_venc,'YYYY-MM-DD'),'importe',v_total)));
    end if;`);

// ── parche 5: insert comprobantes (+2 columnas) ──
const COLS='medio_pago,detraccion,detraccion_total,';
const VALS="nullif(p_medio_pago,''),coalesce(p_detraccion,false),v_detr,";
chk('anchor insert cols', def.includes(COLS) && def.includes(VALS));
def=def.replace(COLS,'medio_pago,forma_pago,credito_vencimiento,detraccion,detraccion_total,');
def=def.replace(VALS,"nullif(p_medio_pago,''),v_fpago,v_venc,coalesce(p_detraccion,false),v_detr,");

await c.query('begin');
await c.query("alter table comprobantes add column if not exists forma_pago text, add column if not exists credito_vencimiento date");
// firma vieja fuera (2 overloads con defaults = ambigüedad PostgREST) y entra la nueva
await c.query("drop function emitir_comprobante(integer,text,text,text,text,text,jsonb,boolean,text,text,text,text,text,text,text,boolean,text,boolean,boolean)");
await c.query(def);

// ── listar_comprobantes: proyectar forma_pago + credito_vencimiento (para PDF/historial) ──
let ldef=(await c.query("select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='listar_comprobantes' limit 1")).rows[0].d;
const LM='es_exportacion, medio_pago,';
chk('listar_comprobantes proyecta medio_pago', ldef.includes(LM));
ldef=ldef.replace(LM, 'es_exportacion, medio_pago, forma_pago, credito_vencimiento,');
await c.query(ldef);

// ── tests (claims de admin real) ──
const adm=(await c.query("select p.auth_uid::text u from equipo p join equipo_accesos a on a.equipo_id=p.id where a.app='ps' and a.rol='admin' and p.activo and a.activo and p.auth_uid is not null limit 1")).rows[0];
await c.query("select set_config('request.jwt.claims',$1,true)",[J({sub:adm.u,role:'authenticated'})]);
chk('guard: crédito en boleta rechazado', /CREDITO_SOLO_FACTURA/.test(await guard(`select emitir_comprobante(p_tipo:=2,p_serie:='BBB1',p_cliente_doc_tipo:='1',p_cliente_doc:='45114935',p_cliente_nombre:='X Y',p_cliente_email:=null,p_items:='[{"descripcion":"t","cantidad":1,"precio":10}]'::jsonb,p_forma_pago:='CREDITO',p_credito_venc:=current_date+7)`)));
chk('guard: crédito sin vencimiento', /CREDITO_REQUIERE_VENCIMIENTO/.test(await guard(`select emitir_comprobante(p_tipo:=1,p_serie:='FFF1',p_cliente_doc_tipo:='6',p_cliente_doc:='20613591550',p_cliente_nombre:='EMP SAC',p_cliente_email:=null,p_items:='[{"descripcion":"t","cantidad":1,"precio":10}]'::jsonb,p_cliente_dir:='LIMA',p_forma_pago:='CREDITO')`)));
chk('guard: forma inválida', /FORMA_PAGO_INVALIDA/.test(await guard(`select emitir_comprobante(p_tipo:=2,p_serie:='BBB1',p_cliente_doc_tipo:='1',p_cliente_doc:='45114935',p_cliente_nombre:='X Y',p_cliente_email:=null,p_items:='[{"descripcion":"t","cantidad":1,"precio":10}]'::jsonb,p_forma_pago:='YAPE')`)));
chk('guard: vencimiento pasado', /CREDITO_VENCIMIENTO_PASADO/.test(await guard(`select emitir_comprobante(p_tipo:=1,p_serie:='FFF1',p_cliente_doc_tipo:='6',p_cliente_doc:='20613591550',p_cliente_nombre:='EMP SAC',p_cliente_email:=null,p_items:='[{"descripcion":"t","cantidad":1,"precio":10}]'::jsonb,p_cliente_dir:='LIMA',p_forma_pago:='CREDITO',p_credito_venc:=current_date-1)`)));

// ── realinear correlativos al último REAL de NubeFact (sondas: BBB1=10, FFF1=15 tras mi prueba) ──
await c.query("update series set correlativo=10 where serie='BBB1' and correlativo<10");
await c.query("update series set correlativo=15 where serie='FFF1' and correlativo<15");
const ss=(await c.query("select serie,correlativo from series where serie in ('BBB1','FFF1') order by 1")).rows;
chk('correlativos realineados BBB1=10 FFF1=15', ss.every(s=>(s.serie==='BBB1'&&Number(s.correlativo)===10)||(s.serie==='FFF1'&&Number(s.correlativo)===15)), ss);

if(!pass){await c.query('rollback');console.log('\n✗ FALLÓ — rollback, PROD intacto');process.exit(1);}
await c.query('commit');
fs.writeFileSync('facturacion_forma_pago.sql','-- FORMA DE PAGO contado/crédito (2026-08-02) — generado del vivo + parche\n'+def+';\n\n-- listar_comprobantes con forma_pago:\n'+ldef+';\n');
console.log('\n★ FORMA DE PAGO aplicada a PROD (def guardada en facturacion_forma_pago.sql)');
process.exit(0);
}catch(e){try{await c.query('rollback');}catch(_){}
console.error('ERROR:',e.message);process.exit(1);}finally{await c.end();}})();
