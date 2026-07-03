// Valida Fase 2 EN VIVO contra NubeFact demo: detracción, línea inafecta (SERNANP), nota de crédito.
const { Client } = require('pg'); const fs = require('fs');
const PASS = process.env.PGPASS || fs.readFileSync(__dirname + '/.pgpass', 'utf8').trim();
const c = new Client({ host: 'aws-1-us-west-2.pooler.supabase.com', port: 5432, user: 'postgres.lintmcxqxnrholslatul', password: PASS, database: 'postgres', ssl: { rejectUnauthorized: false } });
const J = x => JSON.stringify(x);
(async () => {
  await c.connect();
  const uid = (await c.query("select auth_uid::text u from app_usuarios where rol='Administrador' and activo and auth_uid is not null limit 1")).rows[0].u;
  await c.query("select set_config('request.jwt.claims', $1, false)", [J({ sub: uid, role: 'authenticated' })]);
  const lid = p => p + Math.floor(Math.random() * 1e9);
  const T = async (label, fn) => { try { await fn(); } catch (e) { console.log(label + ' ✗ ' + e.message.split('\n')[0].slice(0, 140)); } };

  // 1) FACTURA con DETRACCIÓN 12% (B2B > 700) — requiere cuenta BN registrada en NubeFact (prod)
  await T('DETRACCIÓN', async () => {
    const det = (await c.query(
      "select emitir_comprobante(1,'FFF1','6','20131312955','TURISMO PARACAS SAC','',$1::jsonb,false,'PEN','panel',null,'Demo',$2,null,'AV GRAU 123 PISCO',false,null,false,true) j",
      [J([{ descripcion: 'Paquete turístico', cantidad: 1, precio: 1000 }]), lid('DET-')])).rows[0].j;
    console.log('DETRACCIÓN factura:', det.estado, det.serie + '-' + det.numero);
  });

  // 2) BOLETA con línea INAFECTA (SERNANP) + servicio gravado
  const inf = (await c.query(
    "select emitir_comprobante(2,'BBB1','0','','CLIENTE VARIOS','',$1::jsonb,false,'PEN','panel',null,'Demo',$2,null,null,false,null,false,false) j",
    [J([{ descripcion: 'Tour Islas Ballestas', cantidad: 1, precio: 50 }, { descripcion: 'Ingreso reserva SERNANP', cantidad: 1, precio: 16, afectacion: 'inafecto' }]), lid('INF-')])).rows[0].j;
  console.log('\nINAFECTA boleta:', inf.estado, inf.serie + '-' + inf.numero, '| total:', inf.total, inf.errores ? ('| ⚠ ' + String(inf.errores).slice(0, 120)) : '');
  const infRow = (await c.query("select total_gravada,total_inafecta,total_igv,total from comprobantes where serie=$1 and numero=$2", [inf.serie, inf.numero])).rows[0];
  console.log('  → gravada:', infRow.total_gravada, 'inafecta:', infRow.total_inafecta, 'igv:', infRow.total_igv, 'total:', infRow.total);

  // 3) NOTA DE CRÉDITO sobre una factura recién emitida
  const base = (await c.query(
    "select emitir_comprobante(1,'FFF1','6','20131312955','TURISMO PARACAS SAC','',$1::jsonb,false,'PEN','panel',null,'Demo',$2,null,'AV GRAU 123 PISCO',false,null,false,false) j",
    [J([{ descripcion: 'Tour', cantidad: 1, precio: 100 }]), lid('NCBASE-')])).rows[0].j;
  const baseId = (await c.query("select id from comprobantes where serie=$1 and numero=$2", [base.serie, base.numero])).rows[0].id;
  const nc = (await c.query("select emitir_nota_credito($1,1,'Anulacion de prueba') j", [baseId])).rows[0].j;
  console.log('\nNOTA DE CRÉDITO:', nc.estado, nc.serie + '-' + nc.numero, '| pdf:', (nc.pdf || '').slice(0, 60));
  const est = (await c.query("select estado from comprobantes where id=$1", [baseId])).rows[0].estado;
  console.log('  → original', base.serie + '-' + base.numero, 'quedó:', est);

  await c.end();
})().catch(e => { console.error('✗', e.message); process.exit(1); });
