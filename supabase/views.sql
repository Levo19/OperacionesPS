create or replace view v_balance_agencias as
with adic as (
  select m.id, coalesce(sum((v.value)::numeric),0) as adic_sum
  from movimientos m, lateral jsonb_each_text(m.adicionales) v
  group by m.id
),
cargos as (
  select m.contacto_id as ag_id, m.id as mov_id,
         (coalesce(m.monto_total,0) + coalesce(a.adic_sum,0)) as cargo
  from movimientos m
  join contactos c on c.id = m.contacto_id and c.tipo='agencia'
  left join adic a on a.id = m.id
  where lower(coalesce(m.estado,'')) not like '%cancel%'
),
cobros_mov as (
  select ca.ag_id, sum(k.monto) as cobrado_mov
  from caja_operador k join cargos ca on ca.mov_id = k.movimiento_id
  where k.categoria='Cobro' and coalesce(k.movimiento_id,'')<>''
  group by ca.ag_id
),
abonos as (
  select k.contacto_id as ag_id, sum(k.monto) as abonado
  from caja_operador k join contactos c on c.id=k.contacto_id and c.tipo='agencia'
  where k.categoria='Cobro' and coalesce(k.movimiento_id,'')=''
  group by k.contacto_id
),
ventas as (
  select m.agencia_comprada_id as ag_id, sum(m.monto_comprado) as comprado
  from movimientos m join contactos c on c.id=m.agencia_comprada_id and c.tipo='agencia'
  where coalesce(m.monto_comprado,0)>0 and lower(coalesce(m.estado,'')) not like '%cancel%'
  group by m.agencia_comprada_id
),
pagos as (
  select k.contacto_id as ag_id, sum(k.monto) as pagado
  from caja_operador k join contactos c on c.id=k.contacto_id and c.tipo='agencia'
  where k.categoria='Pago Agencia'
  group by k.contacto_id
),
fact as (select ag_id, sum(cargo) as facturado from cargos group by ag_id)
select c.id, c.nombre,
  coalesce(f.facturado,0) as facturado,
  coalesce(cm.cobrado_mov,0)+coalesce(ab.abonado,0) as cobrado,
  coalesce(v.comprado,0) as comprado, coalesce(p.pagado,0) as pagado,
  coalesce(f.facturado,0)-(coalesce(cm.cobrado_mov,0)+coalesce(ab.abonado,0)) as te_debe,
  coalesce(v.comprado,0)-coalesce(p.pagado,0) as le_debo,
  (coalesce(f.facturado,0)-(coalesce(cm.cobrado_mov,0)+coalesce(ab.abonado,0)))
    -(coalesce(v.comprado,0)-coalesce(p.pagado,0)) as neto
from contactos c
left join fact f on f.ag_id=c.id
left join cobros_mov cm on cm.ag_id=c.id
left join abonos ab on ab.ag_id=c.id
left join ventas v on v.ag_id=c.id
left join pagos p on p.ag_id=c.id
where c.tipo='agencia'
  -- espeja el filtro de GAS (.filter(a=>a.facturado||a.cobrado||a.comprado||a.pagado)): descarta agencias todo-en-cero
  and ( coalesce(f.facturado,0)<>0
     or coalesce(cm.cobrado_mov,0)+coalesce(ab.abonado,0)<>0
     or coalesce(v.comprado,0)<>0
     or coalesce(p.pagado,0)<>0 );
create or replace view v_balance_aliados as
with pin as (
  select m.contacto_id as ali_id, sum(m.cant_pax) as pax_in
  from movimientos m join contactos c on c.id=m.contacto_id and c.tipo='aliado'
  where m.tipo in ('Aliado(PaseIn)','Aliado') and lower(coalesce(m.estado,'')) not like '%cancel%'
  group by m.contacto_id
),
pout as (
  select m.contacto_pase_id as ali_id, sum(m.cant_pax) as pax_out
  from movimientos m join contactos c on c.id=m.contacto_pase_id and c.tipo='aliado'
  where m.tipo='Aliado(PaseOut)' and lower(coalesce(m.estado,'')) not like '%cancel%'
  group by m.contacto_pase_id
)
select c.id,c.nombre,coalesce(i.pax_in,0) pax_in,coalesce(o.pax_out,0) pax_out,
  coalesce(i.pax_in,0)-coalesce(o.pax_out,0) neto
from contactos c left join pin i on i.ali_id=c.id left join pout o on o.ali_id=c.id
where c.tipo='aliado' and coalesce(i.pax_in,o.pax_out) is not null;
create or replace view v_caja_items as
select k.id, k.ts, (k.ts at time zone 'America/Lima')::date as dia,
  k.categoria, k.monto, k.metodo_pago, k.operador, k.comentarios, k.movimiento_id, k.contacto_id,
  case
    when lower(k.categoria)='varios' then position('[S]' in coalesce(k.comentarios,'')) <> 1
    when lower(k.categoria) in ('pagos','pago_comisionado','pago comisionado','retiro_jefatura','retiro a jefatura','pago agencia') then false
    else true
  end as es_ingreso,
  case
    when lower(k.categoria)='cobro' and coalesce(k.movimiento_id,'')<>'' then 'Cobro'
    when lower(k.categoria)='cobro' then 'Abono a cuenta'
    when lower(k.categoria) like '%comision%' or lower(k.categoria)='pagos' then 'Pago comisionado'
    when lower(k.categoria)='pago agencia' then 'Pago a agencia'
    when lower(k.categoria) like '%retiro%' then 'Retiro'
    when lower(k.categoria) like '%caja%' then 'Caja chica'
    when lower(k.categoria)='varios' then 'Varios'
    else k.categoria
  end as label
from caja_operador k;
