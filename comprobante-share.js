// comprobante-share.js — MÓDULO COMPARTIDO CPE (OPS muelle).
// Funciones de render/ticket/PDF COPIADAS VERBATIM del PS Panel (código probado) + una función
// de compartir propia adaptada a OPS. Expone window.CPEShare.compartir(c, {origen, tel, btn}).
// NO editar a mano las funciones _fac*: se regeneran desde PS con el extractor.
(function () {
  'use strict';
  // stub inofensivo: _facGenPDF referencia _facState._pdf.fmt como fallback; aquí SIEMPRE pasamos fmt.
  var _facState = { _pdf: null };
  // Inyecta la CSS del ticket (.fpdf-*) una sola vez.
  if (!document.getElementById('cpe-share-css')) {
    var st = document.createElement('style'); st.id = 'cpe-share-css';
    st.textContent = ".fpdf-paper { position:relative; background:#fff; color:#1a1a1a; box-shadow:0 10px 30px rgba(0,0,0,.4); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; }\n/* Sello ANULADO — diagonal, sobre el ticket, sin tapar la lectura de los datos */\n.fpdf-anulado { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; z-index:5; overflow:hidden; }\n.fpdf-anulado span { transform:rotate(-24deg); border:4px solid rgba(168,28,45,.55); color:rgba(168,28,45,.55); font-weight:900; letter-spacing:.12em; padding:6px 22px; border-radius:8px; font-size:34px; white-space:nowrap; text-transform:uppercase; }\n.fpdf-paper.mm80 .fpdf-anulado span { font-size:26px; border-width:3px; padding:4px 14px; }\n.fpdf-paper.mm80 { width:280px; padding:16px 14px; border-radius:4px; font-size:11px; line-height:1.42; }\n.fpdf-paper.a4 { width:430px; max-width:100%; padding:26px 26px; border-radius:3px; font-size:12px; line-height:1.5; }\n/* A4 apaisado (landscape) — fiel al PDF */\n.fpdf-paper.a4l { width:100%; max-width:640px; padding:20px 22px; border-radius:3px; font-size:11px; line-height:1.45; }\n.fpdf-a4-top { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }\n.fpdf-a4-emisor { display:flex; align-items:flex-start; gap:11px; min-width:0; flex:1 1 auto; }\n.fpdf-a4-emisor > div { min-width:0; }\n.fpdf-a4-emisor img { height:46px; flex:0 0 auto; }\n.fpdf-a4-docbox { flex:0 0 auto; text-align:center; border:1px solid #A81C2D; border-radius:5px; padding:8px 12px; width:150px; }\n.fpdf-a4-meta { display:flex; justify-content:space-between; gap:16px; font-size:10.5px; }\n.fpdf-a4-metacol { min-width:0; }\n.fpdf-a4-metacol > div { padding:1px 0; }\n.fpdf-a4-metacol.r { text-align:right; }\n.fpdf-a4-meta .lbl { color:#A81C2D; font-weight:800; font-size:8.5px; letter-spacing:.04em; margin-right:4px; }\n.fpdf-a4-body { display:flex; gap:14px; align-items:flex-start; margin-top:11px; }\n.fpdf-a4-tbl { flex:1 1 auto; min-width:0; }\n.fpdf-a4-tot { flex:0 0 36%; max-width:220px; min-width:0; background:#faf6ef; border:1px solid #A81C2D; border-radius:5px; padding:10px 12px; font-size:11px; }\n.fpdf-a4-tot .fpdf-tot-row span:first-child { min-width:0; }\n.fpdf-a4-tot b, .fpdf-a4-tot .fpdf-tot-grand span:last-child { white-space:nowrap; }\n@media(max-width:560px){\n  .fpdf-paper.a4 { width:100%; padding:18px 16px; } .fpdf-paper.mm80 { width:250px; }\n  .fpdf-paper.a4l { padding:13px 13px; font-size:9.5px; }\n  .fpdf-paper.a4l .fpdf-brand { font-size:13px !important; }\n  .fpdf-a4-emisor { gap:7px; } .fpdf-a4-emisor img { height:30px; }\n  .fpdf-a4-docbox { width:108px; padding:5px 6px; }\n  .fpdf-a4-docbox > div:first-child { font-size:8.5px !important; }\n  .fpdf-a4-docbox > div:last-child { font-size:10.5px !important; }\n  .fpdf-a4-body { gap:8px; }\n  .fpdf-a4-tot { flex-basis:41%; padding:8px 6px; font-size:9px; }\n  .fpdf-a4-tot .fpdf-tot-grand { font-size:10px; margin-top:3px; padding-top:4px; }\n  .fpdf-a4-tot .fpdf-tot-row { gap:4px; }\n  .fpdf-a4-tbl { font-size:9px; }\n}\n.fpdf-brand { font-weight:900; letter-spacing:-.4px; color:#A81C2D; }\n.fpdf-gold { color:#8a6d1f; }\n.fpdf-hr { border:none; border-top:1px dashed #c9c1c1; margin:9px 0; }\n.fpdf-hr-solid { border:none; border-top:1.5px solid #A81C2D; margin:9px 0; }\n.fpdf-tbl { width:100%; border-collapse:collapse; }\n.fpdf-tbl th { text-align:left; font-size:9.5px; text-transform:uppercase; letter-spacing:.03em; color:#A81C2D; border-bottom:1px solid #A81C2D; padding:4px 2px; }\n.fpdf-tbl td { padding:4px 2px; border-bottom:1px solid #eee; vertical-align:top; }\n.fpdf-tbl .num { text-align:right; white-space:nowrap; }\n.fpdf-tot-row { display:flex; justify-content:space-between; gap:12px; padding:1.5px 0; }\n.fpdf-tot-grand { font-weight:900; font-size:14px; color:#A81C2D; border-top:1.5px solid #A81C2D; margin-top:4px; padding-top:5px; }\n.fpdf-foot { margin-top:10px; font-size:8.5px; color:#666; line-height:1.4; text-align:center; }\n";
    document.head.appendChild(st);
  }

// ── Constantes ──
const _FAC_EMISOR = { marca: 'PARACAS SIGHTS & TOURS', razon: 'PARACAS SIGHTS & TOURS AGENCIA DE VIAJES Y TURISMO S.A.C.', ruc: '20494562716', direccion: 'Gral. José de San Martín Mz. E Lt. 8 - A.H. HH.UU. de Oficio, Paracas - Pisco - Ica', actividad: '7912 - Actividades de operadores turísticos', web: 'paracas' };
const _FAC_DETRACCION = { rate: 0.12, umbral: 700, codigo: '037', concepto: 'Demás servicios gravados', banco: 'Banco de la Nación', cuenta: '' };
const _FAC_UNIDAD = 'ZZ';
// caches de carga perezosa (declaradas fuera de las funciones en PS)
let _facJsPDFPromise = null, _facH2CPromise = null, _facQRPromise = null, _facLogoPromise = null;

// ── Funciones (verbatim PS) ──
const _facMoney = v => (Number(v) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });;

const _facEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));;

function _facEnsureJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (_facJsPDFPromise) return _facJsPDFPromise;
  _facJsPDFPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.async = true;
    s.onload = () => { (window.jspdf && window.jspdf.jsPDF) ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF no cargó')); };
    s.onerror = () => { _facJsPDFPromise = null; reject(new Error('No se pudo descargar jsPDF (sin red).')); };
    document.head.appendChild(s);
  });
  return _facJsPDFPromise;
}

function _facEnsureH2C() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (_facH2CPromise) return _facH2CPromise;
  _facH2CPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.async = true;
    s.onload = () => { window.html2canvas ? resolve(window.html2canvas) : reject(new Error('html2canvas no cargó')); };
    s.onerror = () => { _facH2CPromise = null; reject(new Error('No se pudo descargar html2canvas (sin red).')); };
    document.head.appendChild(s);
  });
  return _facH2CPromise;
}

function _facEnsureQR() {
  if (typeof window.qrcode === 'function') return Promise.resolve(window.qrcode);
  if (_facQRPromise) return _facQRPromise;
  _facQRPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
    s.async = true;
    s.onload = () => { (typeof window.qrcode === 'function') ? resolve(window.qrcode) : reject(new Error('QR no cargó')); };
    s.onerror = () => { _facQRPromise = null; reject(new Error('No se pudo descargar la librería QR (sin red).')); };
    document.head.appendChild(s);
  });
  return _facQRPromise;
}

function _facLoadLogo() {
  if (_facLogoPromise) return _facLogoPromise;
  _facLogoPromise = fetch('./logo.png').then(r => r.ok ? r.blob() : Promise.reject(new Error('no logo')))
    .then(b => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('logo')); fr.readAsDataURL(b); }))
    .catch(() => null);
  return _facLogoPromise;
}

function _facEnteroLetras(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'CERO';
  if (n > 999999) return String(n);   // fuera de rango soportado
  var UNI = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE'];
  var VEINTI = ['VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  var DEC = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  var CEN = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
  function decenas(x) {
    if (x <= 20) return UNI[x];
    if (x < 30) return VEINTI[x - 20];
    var d = Math.floor(x / 10), u = x % 10;
    return DEC[d] + (u ? ' Y ' + UNI[u] : '');
  }
  function centenas(x) {
    if (x === 0) return '';
    if (x === 100) return 'CIEN';
    var c = Math.floor(x / 100), r = x % 100, out = '';
    if (c) out += CEN[c];
    if (r) out += (out ? ' ' : '') + decenas(r);
    return out;
  }
  var miles = Math.floor(n / 1000), resto = n % 1000, out = '';
  if (miles) out += (miles === 1 ? 'MIL' : centenas(miles) + ' MIL');
  if (resto) out += (out ? ' ' : '') + centenas(resto);
  return out || 'CERO';
}

function _facMontoLetras(n, moneda) {
  n = Number(n) || 0;
  var ent = Math.floor(Math.abs(n));
  var dec = Math.round((Math.abs(n) - ent) * 100);
  if (dec >= 100) { dec = 0; ent += 1; }
  var mon = String(moneda || '').toUpperCase();
  var monWord = (mon === 'USD' || mon.indexOf('DÓL') === 0 || mon.indexOf('DOL') === 0 || mon.indexOf('DOLLAR') === 0) ? 'DÓLARES' : 'SOLES';
  return 'SON: ' + _facEnteroLetras(ent) + ' CON ' + String(dec).padStart(2, '0') + '/100 ' + monWord;
}

function _facNumFmt(c) { return (c.serie || '') + '-' + String(c.numero || 0).padStart(8, '0'); }

function _facTipoWord(c) {
  var t = Number(c && c.tipo);
  if (t === 1) return 'factura';
  if (t === 3) return 'nota de crédito';
  if (t === 4) return 'nota de débito';
  return 'boleta';
}

function _facTipoShort(c) {
  var t = Number(c && c.tipo);
  if (t === 1) return 'FACTURA';
  if (t === 3) return 'NOTA DE CRÉDITO';
  if (t === 4) return 'NOTA DE DÉBITO';
  return 'BOLETA DE VENTA';
}

function _facTipoSlug(c) {
  var t = Number(c && c.tipo);
  if (t === 1) return 'factura';
  if (t === 3) return 'nota-credito';
  if (t === 4) return 'nota-debito';
  return 'boleta';
}

function _facTituloDoc(c) {
  var t = Number(c && c.tipo);
  if (t === 1) return 'FACTURA ELECTRÓNICA';
  if (t === 3) return 'NOTA DE CRÉDITO ELECTRÓNICA';
  if (t === 4) return 'NOTA DE DÉBITO ELECTRÓNICA';
  return 'BOLETA DE VENTA ELECTRÓNICA';
}

function _facInferDocTipo(c) {
  if (c && c.cliente_doc_tipo) return String(c.cliente_doc_tipo);
  const d = String((c && c.cliente_doc) || '').replace(/\D/g, '');
  if (d.length === 11) return '6';   // RUC
  if (d.length === 8) return '1';    // DNI
  if (d.length) return '4';          // CE (numérico)
  return '0';
}

function _facFormaPago(c) {
  var fp = String((c && c.forma_pago) || 'CONTADO').toUpperCase();
  var s = fp === 'CREDITO' ? 'CRÉDITO' : 'CONTADO';
  var v = String((c && c.credito_vencimiento) || '').slice(0, 10);
  if (fp === 'CREDITO' && v) s += ' · vence ' + v;
  var m = String((c && c.medio_pago) || '').trim();
  if (m) s += ' · ' + m;
  return s;
}

function _facDetraccion(c, T) {
  if (Number(c && c.tipo) !== 1) return null;                 // solo FACTURA
  // Exportación (0% IGV) NO está sujeta a detracción — es una operación sin porción gravada.
  if ((Number(T && T.exportacion) || 0) > 0 || (Number(T && T.grav) || 0) <= 0) return null;
  var total = Number(T && T.total) || 0;
  if (total < _FAC_DETRACCION.umbral) return null;
  return {
    rate: _FAC_DETRACCION.rate,
    monto: Math.round(total * _FAC_DETRACCION.rate * 100) / 100,
    codigo: _FAC_DETRACCION.codigo, concepto: _FAC_DETRACCION.concepto,
    banco: _FAC_DETRACCION.banco, cuenta: String(_FAC_DETRACCION.cuenta || '').trim()
  };
}

function _facDetraccionTexto(d) {
  var pct = (d.rate * 100).toLocaleString('es-PE', { maximumFractionDigits: 2 });
  return 'Operación sujeta al Sistema de Pago de Obligaciones Tributarias (SPOT) — Detracción ' + pct + '% : S/ ' +
    _facMoney(d.monto) + ' — Cód. ' + d.codigo + ' (' + d.concepto + ') — Cta. ' + d.banco + ' N° ' + (d.cuenta || '(pendiente de configurar)');
}

function _facDetraccionHTML(c, T, compact) {
  var d = _facDetraccion(c, T); if (!d) return '';
  var pad = compact ? '5px 8px' : '7px 11px';
  var fs = compact ? '8px' : '9px';
  return '<div style="margin:' + (compact ? '5px 0' : '9px 0') + ';padding:' + pad + ';border:1px solid #A81C2D;background:#FBF0EE;border-radius:6px;line-height:1.35">' +
    '<div style="font-weight:900;color:#A81C2D;font-size:' + fs + ';letter-spacing:.01em">' + _facEsc(_facDetraccionTexto(d)) + '</div></div>';
}

function _facNCLegal(c) {
  if (Number(c && c.tipo) !== 3) return null;
  var serie = String(c.doc_modifica_serie || '').trim();
  var num = (c.doc_modifica_numero != null && c.doc_modifica_numero !== '') ? String(c.doc_modifica_numero).padStart(8, '0') : '';
  var ref = (serie || num) ? (_facDocModWord(c.doc_modifica_tipo) + ' ' + serie + (num ? '-' + num : '')) : '';
  return { ref: ref, motivo: String(c.nc_motivo || '').trim() };
}

function _facNCLegalHTML(c, compact) {
  var L = _facNCLegal(c); if (!L) return '';
  var pad = compact ? '5px 8px' : '7px 11px';
  var fs = compact ? '8.5px' : '9.5px';
  return '<div style="margin:' + (compact ? '5px 0' : '9px 0') + ';padding:' + pad + ';border:1px solid #C9A84C;background:#FBF4E0;border-radius:6px;line-height:1.35">' +
    '<div style="font-weight:900;color:#A81C2D;font-size:' + fs + ';letter-spacing:.02em">MODIFICA A: ' + _facEsc(L.ref || '—') + '</div>' +
    '<div style="font-size:' + (compact ? '8px' : '9px') + ';color:#333;font-weight:600;margin-top:2px">MOTIVO: ' + _facEsc(L.motivo || '—') + '</div></div>';
}

function _facDocModWord(t) {
  var n = Number(t);
  if (n === 1) return 'FACTURA';
  if (n === 2) return 'BOLETA';
  if (n === 4) return 'NOTA DE DÉBITO';
  return 'COMPROBANTE';
}

function _facPdfItems(c) {
  let it = (c && (c.items || c.detalle)) || [];
  if (!Array.isArray(it)) it = [];
  it = it.map(i => ({ descripcion: String(i.descripcion || i.desc || 'Servicio'), cantidad: Number(i.cantidad || i.cant || 1) || 1, precio: Number(i.precio || i.precio_unitario || i.pu || 0) || 0 }))
    .filter(i => i.descripcion);
  if (!it.length) it = [{ descripcion: 'Servicio', cantidad: 1, precio: Number((c && c.total) || 0) }];
  return it;
}

function _facPdfTotales(c) {
  const items = _facPdfItems(c);
  const totItems = items.reduce((s, i) => s + i.cantidad * i.precio, 0);
  const total = Number((c && c.total) != null ? c.total : totItems) || 0;
  const grav = Number(c && (c.total_gravada != null ? c.total_gravada : c.gravada)) || 0;
  const noGrav = (Number(c && c.total_exonerada) || 0) + (Number(c && c.total_inafecta) || 0) + (Number(c && c.total_exportacion) || 0);
  const esExport = !!(c && (c.exportacion || c.es_extranjero)) || (Number(c && c.total_exportacion) || 0) > 0;
  // ¿el backend mandó desglose tributario? (los CPE actuales sí)
  const hayDesglose = !!(c && (c.total_igv != null || c.total_gravada != null || c.total_exonerada != null || c.total_inafecta != null || c.total_exportacion != null));
  let igv;
  if (hayDesglose) igv = Number(c && (c.total_igv != null ? c.total_igv : c.igv)) || 0;   // IGV REAL del CPE
  else if (esExport || noGrav > 0) igv = 0;                                                // legacy 0%
  else igv = Math.round((total - total / 1.18) * 100) / 100;                               // legacy gravado 18%
  if (isNaN(igv)) igv = 0;
  const inafecta = noGrav > 0 ? noGrav : ((grav <= 0 && igv === 0) ? total : 0);
  const cero = grav <= 0 && igv === 0;   // documento sin porción gravada (export/exonerado/inafecto)
  // Buckets individuales por tipo de operación (para el desglose fiel del CPE).
  const exonerada = Number(c && c.total_exonerada) || 0;
  const exportacion = Number(c && c.total_exportacion) || 0;
  const inafectaOp = Number(c && c.total_inafecta) || 0;
  const gratuita = Number(c && c.total_gratuita) || 0;   // cortesías (ej. TC del grupo)
  return { items, total, grav, igv, inafecta, noGrav, cero, exonerada, exportacion, inafectaOp, gratuita, moneda: (c && c.moneda) || 'PEN' };
}

function _facTotRows(T) {
  const rows = [{ lbl: 'Op. Gravada', val: T.grav }];
  if (T.exonerada > 0) rows.push({ lbl: 'Op. Exonerada', val: T.exonerada });
  // Inafecta: usa el bucket explícito; si el doc es "cero" legacy sin buckets, cae al total.
  let inaf = T.inafectaOp;
  if (T.exonerada <= 0 && T.exportacion <= 0 && inaf <= 0 && T.cero) inaf = T.total;
  if (inaf > 0) rows.push({ lbl: 'Op. Inafecta', val: inaf });
  if (T.exportacion > 0) rows.push({ lbl: 'Op. Exportación', val: T.exportacion });
  if (T.gratuita > 0) rows.push({ lbl: 'Op. Gratuita', val: T.gratuita });   // cortesías — no suman al total
  rows.push({ lbl: T.igv > 0 ? 'IGV (18%)' : 'IGV (0%)', val: T.igv });
  return rows;
}

function _facQRData(c, T) {
  const fecha = String(c.creado || c.fecha || c.creado_at || '').slice(0, 10);
  const dos = v => (Number(v) || 0).toFixed(2);
  return [
    _FAC_EMISOR.ruc, Number(c.tipo) || '', c.serie || '', String(c.numero || 0),
    dos(T.igv), dos(T.total), fecha,
    c.cliente_doc_tipo || _facInferDocTipo(c), c.cliente_doc || '', c.hash || ''
  ].join('|');
}

function _facQRDataUrl(str) {
  try { const q = window.qrcode(0, 'M'); q.addData(String(str || '')); q.make(); return q.createDataURL(4, 0); }
  catch (e) { return ''; }
}

async function _facRasterizar(c, fmt) {
  const h2c = await _facEnsureH2C();
  try { await _facEnsureQR(); } catch (e) {}   // QR nítido en la imagen
  const esA4 = fmt === 'a4';
  const width = esA4 ? 900 : 384;   // A4 apaisado ancho / 80mm ~ 384px (58mm útil a ~192dpi se ve premium)
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;background:#fff;padding:' + (esA4 ? '22px' : '14px') + ';width:' + width + 'px;box-sizing:border-box';
  host.className = 'fac-raster-host';
  host.innerHTML = _facPdfPreviewHTML(c, fmt);
  document.body.appendChild(host);
  // el .fpdf-paper trae su propio max-width; lo soltamos para que ocupe el ancho del host
  const paper = host.querySelector('.fpdf-paper'); if (paper) { paper.style.maxWidth = 'none'; paper.style.width = '100%'; paper.style.margin = '0'; paper.style.boxShadow = 'none'; }
  // Logo como dataURL: un <img src="./logo.png"> cross-origin/file:// CONTAMINA el canvas y
  // toBlob/toDataURL revientan. Embebido como dataURL el canvas queda limpio en cualquier origen.
  let logoData = null; try { logoData = await _facLoadLogo(); } catch (e) {}
  host.querySelectorAll('img').forEach(img => {
    if (logoData && /logo\.png/.test(img.getAttribute('src') || '')) img.src = logoData;
    else if (!logoData && /logo\.png/.test(img.getAttribute('src') || '')) img.remove();   // sin logo: quítalo (no contamina)
  });
  // esperar a que las imágenes (logo dataURL + QR dataURL) queden decodificadas
  await Promise.all(Array.from(host.querySelectorAll('img')).map(img => (img.complete && img.naturalWidth) ? Promise.resolve() : new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 1200); })));
  let canvas;
  try {
    canvas = await h2c(host, { scale: esA4 ? 2 : 3, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: width + 60 });
  } finally { host.remove(); }
  const dataUrl = canvas.toDataURL('image/png');
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 0.95));
  return { blob, dataUrl, w: canvas.width, h: canvas.height };
}

function _facPdfPreviewHTML(c, fmt) {
  const T = _facPdfTotales(c);
  const esA4 = fmt === 'a4';
  const num = _facNumFmt(c);
  const fecha = _facEsc(String(c.creado || c.fecha || c.creado_at || '').slice(0, 16));
  const docCli = _facEsc(String(c.cliente_doc || '').trim() || '—');
  const nomCli = _facEsc(c.cliente_nombre || 'Cliente varios');
  const rucLine = _FAC_EMISOR.ruc ? ('R.U.C. ' + _facEsc(_FAC_EMISOR.ruc)) : 'R.U.C. —';
  const hashFull = String(c.hash || c.codigo_barras || '');
  const hash = _facEsc(hashFull.slice(0, 40));
  const oficial = /^https?:\/\//.test(String(c.enlace_pdf || ''));
  const footHtml = `Representación impresa de la ${_facTipoShort(c)} ELECTRÓNICA. Emitida mediante SUNAT · NubeFact.${oficial ? '<br>PDF oficial disponible en el enlace del comprobante.' : ''}`;
  const letras = _facEsc(_facMontoLetras(T.total, T.moneda));
  const actividad = _FAC_EMISOR.actividad ? _facEsc(_FAC_EMISOR.actividad) : '';
  // QR (estándar SUNAT) — si la librería ya está cargada lo pinta; si no, placeholder + carga diferida.
  const qrUrl = (typeof window.qrcode === 'function') ? _facQRDataUrl(_facQRData(c, T)) : '';
  const qrImg = size => qrUrl
    ? `<img src="${qrUrl}" alt="QR" style="width:${size}px;height:${size}px;image-rendering:pixelated;border-radius:4px">`
    : `<div style="width:${size}px;height:${size}px;border:1px dashed #bbb;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#999">QR</div>`;
  const hashTxt = hash ? `<div style="font-size:7px;color:#777;word-break:break-all;line-height:1.25">Hash: ${hash}</div>` : '';
  // Campos SUNAT añadidos: forma de pago, tipo de operación, vendedor, desglose por tipo de op. y detracción.
  const formaPago = _facEsc(_facFormaPago(c));
  const vendedor = _facEsc(String(c.creado_por || '').trim());
  const vendedorLine = vendedor ? `Emitido por: ${vendedor}` : '';
  const totRowsHtml = _facTotRows(T).map(r => `<div class="fpdf-tot-row"><span>${_facEsc(r.lbl)}</span><b>S/ ${_facMoney(r.val)}</b></div>`).join('');
  const detrHtmlA4 = _facDetraccionHTML(c, T, false);
  const detrHtml80 = _facDetraccionHTML(c, T, true);
  // Observaciones del emisor (opcional) + sello de EXPORTACIÓN (turismo receptivo, 0% IGV).
  const obs = String(c.observaciones || '').trim();
  const esExportDoc = (Number(T.exportacion) || 0) > 0;
  const selloAnulado = String(c.estado || '') === 'anulada' ? '<div class="fpdf-anulado"><span>ANULADO</span></div>' : '';
  const obsA4 = obs ? `<div style="margin-top:8px;padding:7px 11px;border:1px solid #e3d9c4;background:#fdfaf2;border-radius:6px;font-size:8.5px;color:#5a4a2a;line-height:1.4"><b style="letter-spacing:.03em">OBSERVACIONES: </b>${_facEsc(obs)}</div>` : '';
  const obs80 = obs ? `<div style="margin-top:5px;padding:5px 8px;border:1px solid #e3d9c4;background:#fdfaf2;border-radius:5px;font-size:8px;color:#5a4a2a;line-height:1.35"><b>OBS: </b>${_facEsc(obs)}</div>` : '';
  const expBadgeA4 = esExportDoc ? `<div style="display:inline-flex;align-items:center;gap:4px;margin-top:5px;padding:2px 9px;border-radius:999px;background:#e0f2fe;border:1px solid #7dd3fc;color:#075985;font-size:8px;font-weight:800;letter-spacing:.03em">🌎 EXPORTACIÓN · 0% IGV (Art. 33° Ley IGV)</div>` : '';
  const expBadge80 = esExportDoc ? `<div style="margin:4px auto 0;display:inline-block;padding:2px 8px;border-radius:999px;background:#e0f2fe;border:1px solid #7dd3fc;color:#075985;font-size:7.5px;font-weight:800">🌎 EXPORTACIÓN · 0% IGV</div>` : '';

  if (esA4) {
    // ── A4 HORIZONTAL (apaisado) — fiel al PDF: emisor izq, recuadro doc der, tabla ancha + totales a la derecha ──
    const rows = T.items.map(i => `<tr>
        <td>${_facEsc(i.descripcion)}</td>
        <td class="num">${_FAC_UNIDAD}</td>
        <td class="num">${i.cantidad}</td>
        <td class="num">${_facMoney(i.precio)}</td>
        <td class="num">${_facMoney(i.cantidad * i.precio)}</td>
      </tr>`).join('');
    return `<div class="fpdf-paper a4l">${selloAnulado}
      <div class="fpdf-a4-top">
        <div class="fpdf-a4-emisor">
          <img src="./logo.png" alt="" onerror="this.style.display='none'">
          <div>
            <div class="fpdf-brand" style="font-size:17px">${_facEsc(_FAC_EMISOR.marca)}</div>
            <div style="font-size:8px;color:#333;font-weight:600;margin-top:1px;line-height:1.3">${_facEsc(_FAC_EMISOR.razon)}</div>
            <div style="font-size:9px;color:#555;margin-top:2px">${rucLine} · ${_facEsc(_FAC_EMISOR.direccion)}</div>
            ${actividad ? `<div style="font-size:7.5px;color:#777;margin-top:1px">${actividad}</div>` : ''}
          </div>
        </div>
        <div class="fpdf-a4-docbox">
          <div style="font-weight:900;color:#A81C2D;font-size:10.5px;letter-spacing:.02em;line-height:1.15">${_facTituloDoc(c)}</div>
          <div style="font-weight:800;font-size:14px;margin-top:4px">${_facEsc(num)}</div>
        </div>
      </div>
      <div class="fpdf-hr-solid"></div>
      <div class="fpdf-a4-meta">
        <div class="fpdf-a4-metacol"><div><span class="lbl">CLIENTE</span> ${nomCli}</div><div><span class="lbl">DOCUMENTO</span> ${docCli}</div><div><span class="lbl">FORMA DE PAGO</span> ${formaPago}</div></div>
        <div class="fpdf-a4-metacol r"><div><span class="lbl">FECHA</span> ${fecha || '—'}</div><div><span class="lbl">MONEDA</span> ${_facEsc(c.moneda || 'PEN')}</div><div><span class="lbl">OPERACIÓN</span> Venta interna</div></div>
      </div>
      ${_facNCLegalHTML(c)}
      <div class="fpdf-a4-body">
        <table class="fpdf-tbl fpdf-a4-tbl">
          <thead><tr><th>Descripción</th><th class="num">U.M.</th><th class="num">Cant</th><th class="num">P. Unit</th><th class="num">Importe</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="fpdf-a4-tot">
          ${totRowsHtml}
          <div class="fpdf-tot-row fpdf-tot-grand"><span>TOTAL</span><span>S/ ${_facMoney(T.total)}</span></div>
        </div>
      </div>
      <div style="margin-top:8px;font-size:9px;font-weight:700;color:#333;letter-spacing:.01em">${letras}${esExportDoc ? ' &nbsp; ' + expBadgeA4 : ''}</div>
      ${obsA4}
      ${detrHtmlA4}
      <div style="display:flex;align-items:flex-end;gap:12px;margin-top:12px;border-top:1px solid #ddd;padding-top:7px">
        <div style="flex:0 0 auto;text-align:center">${qrImg(74)}${hashTxt}</div>
        <div class="fpdf-foot" style="flex:1;text-align:left;align-self:center">${footHtml}${vendedorLine ? `<br>${vendedorLine}` : ''}</div>
      </div>
    </div>`;
  }

  // ── 80mm (ticket térmico, vertical) ──
  const rows = T.items.map(i => `<tr>
      <td>${_facEsc(i.descripcion)}</td>
      <td class="num">${_FAC_UNIDAD}</td>
      <td class="num">${i.cantidad}</td>
      <td class="num">${_facMoney(i.cantidad * i.precio)}</td>
    </tr>`).join('');
  return `<div class="fpdf-paper mm80">${selloAnulado}
    <div style="text-align:center">
      <img src="./logo.png" alt="" style="height:38px;display:block;margin:0 auto 4px" onerror="this.style.display='none'">
      <div class="fpdf-brand" style="font-size:15px">${_facEsc(_FAC_EMISOR.marca)}</div>
      <div style="font-size:7px;color:#333;font-weight:600;margin-top:1px">${_facEsc(_FAC_EMISOR.razon)}</div>
      <div style="font-size:8px;color:#555;margin-top:2px">${rucLine}</div>
      <div style="font-size:8px;color:#555;margin-top:1px;line-height:1.3">${_facEsc(_FAC_EMISOR.direccion)}</div>
      ${actividad ? `<div style="font-size:7.5px;color:#777;margin-top:1px">${actividad}</div>` : ''}
    </div>
    <div class="fpdf-hr-solid"></div>
    <div style="text-align:center">
      <div style="font-weight:900;color:#A81C2D;font-size:11px;letter-spacing:.02em">${_facTituloDoc(c)}</div>
      <div style="font-weight:800;font-size:12px;margin-top:2px">${_facEsc(num)}</div>
    </div>
    <div class="fpdf-hr"></div>
    <div style="display:flex;justify-content:space-between;gap:8px;font-size:10px">
      <div><b>Fecha:</b> ${fecha || '—'}</div>
      <div><b>Moneda:</b> ${_facEsc(c.moneda || 'PEN')}</div>
    </div>
    <div style="display:flex;justify-content:space-between;gap:8px;font-size:9.5px;margin-top:2px">
      <div><b>Pago:</b> ${formaPago}</div>
      <div><b>Op.:</b> Venta interna</div>
    </div>
    <div style="font-size:10px;margin-top:4px"><b>Cliente:</b> ${nomCli}<br><b>Doc:</b> ${docCli}</div>
    ${_facNCLegalHTML(c, true)}
    <div class="fpdf-hr"></div>
    <table class="fpdf-tbl">
      <thead><tr><th>Descripción</th><th class="num">U.M.</th><th class="num">Cant</th><th class="num">Importe</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="fpdf-hr"></div>
    <div style="font-size:11px">
      ${totRowsHtml}
      <div class="fpdf-tot-row fpdf-tot-grand"><span>TOTAL</span><span>S/ ${_facMoney(T.total)}</span></div>
    </div>
    <div style="font-size:8.5px;font-weight:700;color:#333;margin-top:5px;text-align:center;line-height:1.3">${letras}</div>
    ${esExportDoc ? `<div style="text-align:center;margin-top:3px">${expBadge80}</div>` : ''}
    ${obs80}
    ${detrHtml80}
    <div class="fpdf-hr"></div>
    <div style="text-align:center;margin:2px 0 4px">${qrImg(90)}${hashTxt}</div>
    <div class="fpdf-foot">${footHtml}${vendedorLine ? `<br>${vendedorLine}` : ''}</div>
  </div>`;
}

async function _facGenPDF(c, fmtOverride) {
  const jsPDF = await _facEnsureJsPDF();
  const logo = await _facLoadLogo();
  const fmt = fmtOverride || (_facState._pdf && _facState._pdf.fmt) || 'a4';
  const T = _facPdfTotales(c);
  const num = _facNumFmt(c);
  const ncL = _facNCLegal(c);   // bloque legal SUNAT si es Nota de Crédito
  const guinda = [168, 28, 45], ink = [26, 26, 26], gray = [110, 110, 110];
  const _anulado = String(c.estado || '') === 'anulada';
  const _sello = (doc, W, H) => { if (!_anulado) return; try { doc.saveGraphicsState && doc.setGState && doc.setGState(new doc.GState({ opacity: 0.35 })); } catch (e) {} doc.setTextColor(168, 28, 45); doc.setFont('helvetica', 'bold'); doc.setFontSize(W > 120 ? 60 : 30); try { doc.text('ANULADO', W / 2, H / 2, { align: 'center', angle: 24 }); } catch (e) { doc.text('ANULADO', W / 2, H / 2, { align: 'center' }); } try { doc.setGState && doc.setGState(new doc.GState({ opacity: 1 })); } catch (e) {} doc.setTextColor(...ink); };
  const fecha = String(c.creado || c.fecha || c.creado_at || '').slice(0, 16);
  const rucLine = _FAC_EMISOR.ruc ? ('R.U.C. ' + _FAC_EMISOR.ruc) : 'R.U.C. —';
  const letras = _facMontoLetras(T.total, T.moneda);
  // QR (estándar SUNAT) — no bloquea si la librería no carga (degrada sin QR).
  let qrUrl = '';
  try { await _facEnsureQR(); qrUrl = _facQRDataUrl(_facQRData(c, T)); } catch (e) { qrUrl = ''; }
  const hashTxt = c.hash ? ('Hash: ' + String(c.hash)) : '';

  if (fmt === 'a4') {
    // ── A4 HORIZONTAL (apaisado · 297×210) — layout profesional que aprovecha el ancho ──
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = 297, H = 210, M = 16;
    // Cabecera: logo + emisor (izq)
    if (logo) { try { doc.addImage(logo, 'PNG', M, 13, 26, 22); } catch (e) {} }
    const hx = logo ? M + 32 : M;
    let y = 20;
    doc.setTextColor(...guinda); doc.setFont('helvetica', 'bold'); doc.setFontSize(19);
    doc.text(_FAC_EMISOR.marca, hx, y); y += 6;
    doc.setTextColor(...ink); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const rzL = doc.splitTextToSize(_FAC_EMISOR.razon, 150);
    doc.text(rzL, hx, y); y += 3.8 * rzL.length + 1;
    doc.setTextColor(...gray); doc.setFontSize(8.5);
    const dirL = doc.splitTextToSize(rucLine + '   ·   ' + _FAC_EMISOR.direccion, 150);
    doc.text(dirL, hx, y); y += 3.4 * dirL.length;
    if (_FAC_EMISOR.actividad) { doc.setFontSize(7.5); doc.setTextColor(150, 150, 150); doc.text(_FAC_EMISOR.actividad, hx, y); }
    // Recuadro documento (arriba-derecha)
    const bw = 76, bx = W - M - bw;
    doc.setDrawColor(...guinda); doc.setLineWidth(0.7); doc.roundedRect(bx, 13, bw, 25, 2.5, 2.5);
    doc.setTextColor(...guinda); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(_facTituloDoc(c), bx + bw / 2, 22, { align: 'center', maxWidth: bw - 6 });
    doc.setFontSize(15); doc.setTextColor(...ink); doc.text(num, bx + bw / 2, 33, { align: 'center' });
    // Línea divisoria
    let hy = 44;
    doc.setDrawColor(...guinda); doc.setLineWidth(0.9); doc.line(M, hy, W - M, hy); hy += 8;
    // Datos del cliente (izq) + fecha/moneda (der)
    doc.setFontSize(10);
    doc.setTextColor(...gray); doc.setFont('helvetica', 'bold'); doc.text('CLIENTE', M, hy);
    doc.setTextColor(...ink); doc.setFont('helvetica', 'normal'); doc.text(String(c.cliente_nombre || 'Cliente varios'), M + 24, hy);
    doc.setTextColor(...gray); doc.setFont('helvetica', 'bold'); doc.text('DOCUMENTO', M, hy + 6.5);
    doc.setTextColor(...ink); doc.setFont('helvetica', 'normal'); doc.text(String(c.cliente_doc || '—'), M + 24, hy + 6.5);
    doc.setTextColor(...gray); doc.setFont('helvetica', 'bold'); doc.text('FECHA', bx, hy);
    doc.setTextColor(...ink); doc.setFont('helvetica', 'normal'); doc.text(fecha || '—', bx + 24, hy);
    doc.setTextColor(...gray); doc.setFont('helvetica', 'bold'); doc.text('MONEDA', bx, hy + 6.5);
    doc.setTextColor(...ink); doc.setFont('helvetica', 'normal'); doc.text(String(c.moneda || 'PEN'), bx + 24, hy + 6.5);
    // Forma de pago (izq) + tipo de operación (der) — campos SUNAT
    doc.setTextColor(...gray); doc.setFont('helvetica', 'bold'); doc.text('FORMA DE PAGO', M, hy + 13);
    doc.setTextColor(...ink); doc.setFont('helvetica', 'normal'); doc.text(_facFormaPago(c), M + 34, hy + 13);
    doc.setTextColor(...gray); doc.setFont('helvetica', 'bold'); doc.text('OPERACIÓN', bx, hy + 13);
    doc.setTextColor(...ink); doc.setFont('helvetica', 'normal'); doc.text('Venta interna', bx + 24, hy + 13);
    // ── Bloque legal Nota de Crédito (SUNAT): a qué doc modifica + motivo ──
    let ncExtra = 0;
    if (ncL) {
      const ly = hy + 20;
      doc.setFillColor(250, 244, 224); doc.setDrawColor(...guinda); doc.setLineWidth(0.4);
      doc.roundedRect(M, ly, 194 - M, 13, 1.8, 1.8, 'FD');
      doc.setTextColor(...guinda); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text('MODIFICA A: ' + (ncL.ref || '—'), M + 4, ly + 5.3);
      doc.setTextColor(...ink); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      const mL = doc.splitTextToSize('MOTIVO: ' + (ncL.motivo || '—'), 194 - M - 8);
      doc.text(mL[0] || '', M + 4, ly + 10.2);
      ncExtra = 16;
    }
    // ── Zona de cuerpo: tabla de ítems (izq, ancha) + bloque de totales (der) ──
    const topY = hy + 22 + ncExtra;
    const tblR = 194, colUM = 120, colCant = 142, colPU = 168, colImp = tblR - 2;   // tabla ocupa M..tblR
    // Cabecera tabla
    doc.setFillColor(...guinda); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.rect(M, topY, tblR - M, 8, 'F');
    let ry = topY + 5.4;
    doc.text('DESCRIPCIÓN', M + 3, ry);
    doc.text('U.M.', colUM, ry, { align: 'right' });
    doc.text('CANT', colCant, ry, { align: 'right' });
    doc.text('P. UNIT', colPU, ry, { align: 'right' });
    doc.text('IMPORTE', colImp, ry, { align: 'right' });
    ry = topY + 14;
    doc.setTextColor(...ink); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    T.items.forEach(i => {
      const lines = doc.splitTextToSize(String(i.descripcion), colUM - M - 14);
      doc.text(lines, M + 3, ry);
      doc.text(_FAC_UNIDAD, colUM, ry, { align: 'right' });
      doc.text(String(i.cantidad), colCant, ry, { align: 'right' });
      doc.text(_facMoney(i.precio), colPU, ry, { align: 'right' });
      doc.text(_facMoney(i.cantidad * i.precio), colImp, ry, { align: 'right' });
      ry += Math.max(6.5, lines.length * 5);
      doc.setDrawColor(232, 232, 232); doc.setLineWidth(0.2); doc.line(M, ry - 3.8, tblR, ry - 3.8);
    });
    // Bloque de totales (derecha) — desglose por tipo de operación (alto dinámico)
    const totR = _facTotRows(T);
    const gx = 205, gw = W - M - gx, boxH = totR.length * 7 + 22;
    doc.setFillColor(250, 246, 239); doc.setDrawColor(...guinda); doc.setLineWidth(0.5);
    doc.roundedRect(gx, topY, gw, boxH, 2.5, 2.5, 'FD');
    const glx = gx + 6, grx = gx + gw - 6; let gy = topY + 9;
    const gRow = (lbl, val, big) => {
      doc.setFont('helvetica', big ? 'bold' : 'normal'); doc.setFontSize(big ? 13 : 9.5);
      doc.setTextColor(...(big ? guinda : ink));
      doc.text(lbl, glx, gy); doc.text('S/ ' + _facMoney(val), grx, gy, { align: 'right' });
      gy += big ? 10 : 7;
    };
    totR.forEach(r => gRow(r.lbl, r.val, false));
    doc.setDrawColor(...guinda); doc.setLineWidth(0.5); doc.line(glx, gy - 3.5, grx, gy - 3.5); gy += 1.5;
    gRow('TOTAL', T.total, true);
    // Monto en letras (bajo la tabla de ítems)
    let letY = Math.max(ry, topY + boxH + 6) + 4;
    doc.setTextColor(...ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.splitTextToSize(letras, tblR - M).forEach(ln => { doc.text(ln, M, letY); letY += 4; });
    // ── Sello EXPORTACIÓN (0% IGV) + Observaciones del emisor ──
    if ((Number(T.exportacion) || 0) > 0) {
      letY += 1;
      doc.setFillColor(224, 242, 254); doc.setDrawColor(125, 211, 252); doc.setLineWidth(0.3);
      doc.roundedRect(M, letY, 104, 6.5, 3.2, 3.2, 'FD');
      doc.setTextColor(7, 89, 133); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.text('EXPORTACIÓN · 0% IGV — Art. 33° Ley del IGV (turismo receptivo)', M + 4, letY + 4.4);
      letY += 9.5;
    }
    if (String(c.observaciones || '').trim()) {
      const oLines = doc.splitTextToSize('OBSERVACIONES: ' + String(c.observaciones).trim(), W - 2 * M - 8);
      const oh = oLines.length * 4 + 4.5;
      doc.setFillColor(253, 250, 242); doc.setDrawColor(227, 217, 196); doc.setLineWidth(0.3);
      doc.roundedRect(M, letY, W - 2 * M, oh, 1.8, 1.8, 'FD');
      doc.setTextColor(90, 74, 42); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      let oy = letY + 4.8; oLines.forEach(ln => { doc.text(ln, M + 4, oy); oy += 4; });
      letY += oh + 3;
    }
    // ── Detracción (SPOT) — bloque legal, solo FACTURA ≥ umbral ──
    const detr = _facDetraccion(c, T);
    if (detr) {
      const dLines = doc.splitTextToSize(_facDetraccionTexto(detr), W - 2 * M - 8);
      const dh = dLines.length * 4 + 4.5;
      doc.setFillColor(251, 240, 238); doc.setDrawColor(...guinda); doc.setLineWidth(0.4);
      doc.roundedRect(M, letY, W - 2 * M, dh, 1.8, 1.8, 'FD');
      doc.setTextColor(...guinda); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      let dy = letY + 4.6; dLines.forEach(ln => { doc.text(ln, M + 4, dy); dy += 4; });
      letY += dh + 3;
    }
    // Pie SUNAT + QR + hash (parte inferior de la página)
    const footY = Math.min(letY + 8, H - 26);
    doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3); doc.line(M, footY - 6, W - M, footY - 6);
    // QR a la izquierda del pie
    let footTextX = M;
    if (qrUrl) {
      try { doc.addImage(qrUrl, 'PNG', M, footY - 2, 22, 22); footTextX = M + 27; } catch (e) {}
    }
    doc.setTextColor(...gray); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    const vendA4 = String(c.creado_por || '').trim();
    const foot = doc.splitTextToSize('Representación impresa de la ' + _facTipoShort(c) + ' ELECTRÓNICA. Emitida mediante SUNAT · NubeFact.' + (vendA4 ? '  ·  Emitido por: ' + vendA4 : '') + (hashTxt ? '  ' + hashTxt : ''), W - M - footTextX);
    doc.text(foot, footTextX, footY + 4);
    _sello(doc, W, H);
    return doc;
  }

  // ── 80mm (ticket térmico, alto dinámico) ──
  const w = 80, mm = 5, cw = w - 2 * mm;
  const detr = _facDetraccion(c, T);                                 // detracción (SPOT) si aplica
  const totR = _facTotRows(T);                                       // desglose por tipo de operación
  // alto estimado: logo + razón + letras + QR 22mm + wrap + NC + forma pago/operación + buckets extra + detracción + vendedor
  const _obsTxt = String(c.observaciones || '').trim();
  const _esExp = (Number(T.exportacion) || 0) > 0;
  const est = 92 + T.items.length * 10 + 44 + 40 + (ncL ? 16 : 0) + 12 + (totR.length - 2) * 4 + (detr ? 24 : 0) + (_esExp ? 8 : 0) + (_obsTxt ? Math.ceil(_obsTxt.length / 40) * 4 + 8 : 0);
  const doc = new jsPDF({ unit: 'mm', format: [w, est] });
  let y = 8;
  const center = (txt, size, bold, color) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...(color || ink)); doc.text(txt, w / 2, y, { align: 'center', maxWidth: cw }); };
  if (logo) { try { doc.addImage(logo, 'PNG', (w - 24) / 2, y, 24, 20); y += 22; } catch (e) {} }
  center(_FAC_EMISOR.marca, 11, true, guinda); y += 4.2;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.6); doc.setTextColor(...ink);
  doc.splitTextToSize(_FAC_EMISOR.razon, cw).forEach(ln => { doc.text(ln, w / 2, y, { align: 'center' }); y += 2.9; });
  y += 0.8;
  center(rucLine, 7, false, gray); y += 3.2;
  doc.setFontSize(6.6); doc.setTextColor(...gray); doc.setFont('helvetica', 'normal');
  doc.splitTextToSize(_FAC_EMISOR.direccion, cw).forEach(ln => { doc.text(ln, w / 2, y, { align: 'center' }); y += 2.8; });
  if (_FAC_EMISOR.actividad) { center(_FAC_EMISOR.actividad, 6, false, gray); y += 2.6; }
  y += 1.4;
  doc.setDrawColor(...guinda); doc.setLineWidth(0.5); doc.line(mm, y, w - mm, y); y += 5;
  center(_facTituloDoc(c), 8.5, true, guinda); y += 4.2;
  center(num, 10, true, ink); y += 5;
  doc.setDrawColor(180, 180, 180); doc.setLineDashPattern([1, 1], 0); doc.line(mm, y, w - mm, y); doc.setLineDashPattern([], 0); y += 4.5;
  doc.setFontSize(8); doc.setTextColor(...ink); doc.setFont('helvetica', 'normal');
  doc.text('Fecha: ' + (fecha || '—'), mm, y); y += 3.8;
  const nomLines = doc.splitTextToSize('Cliente: ' + String(c.cliente_nombre || 'Cliente varios'), cw);
  doc.text(nomLines, mm, y); y += nomLines.length * 3.6;
  doc.text('Doc: ' + String(c.cliente_doc || '—'), mm, y); y += 4;
  // Forma de pago + tipo de operación (campos SUNAT)
  doc.setFontSize(7.5);
  doc.splitTextToSize('Pago: ' + _facFormaPago(c), cw).forEach(ln => { doc.text(ln, mm, y); y += 3.3; });
  doc.text('Operación: Venta interna', mm, y); y += 4;
  doc.setFontSize(8);
  // ── Bloque legal Nota de Crédito (SUNAT) ──
  if (ncL) {
    doc.setDrawColor(...guinda); doc.setLineWidth(0.3); doc.setFillColor(250, 244, 224);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.2); doc.setTextColor(...guinda);
    doc.splitTextToSize('MODIFICA A: ' + (ncL.ref || '—'), cw).forEach(ln => { doc.text(ln, mm, y); y += 3; });
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...ink); doc.setFontSize(6.8);
    doc.splitTextToSize('MOTIVO: ' + (ncL.motivo || '—'), cw).forEach(ln => { doc.text(ln, mm, y); y += 2.8; });
    y += 1;
  }
  doc.setDrawColor(180, 180, 180); doc.setLineDashPattern([1, 1], 0); doc.line(mm, y, w - mm, y); doc.setLineDashPattern([], 0); y += 4;
  // Cabecera items
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...guinda);
  doc.text('DESCRIPCIÓN', mm, y); doc.text('IMPORTE', w - mm, y, { align: 'right' }); y += 3.6;
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...ink); doc.setFontSize(8);
  T.items.forEach(i => {
    const lines = doc.splitTextToSize(i.descripcion, cw - 22);
    doc.text(lines, mm, y);
    doc.text(_facMoney(i.cantidad * i.precio), w - mm, y, { align: 'right' });
    y += Math.max(3.6, lines.length * 3.4);
    doc.setTextColor(...gray); doc.setFontSize(7); doc.text(_FAC_UNIDAD + ' · ' + i.cantidad + ' x ' + _facMoney(i.precio), mm, y); doc.setTextColor(...ink); doc.setFontSize(8); y += 3.8;
  });
  doc.setDrawColor(...guinda); doc.setLineWidth(0.4); doc.line(mm, y, w - mm, y); y += 4.2;
  const trow = (lbl, val, bold, big) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(big ? 11 : 8); doc.setTextColor(...(big ? guinda : ink)); doc.text(lbl, mm, y); doc.text('S/ ' + _facMoney(val), w - mm, y, { align: 'right' }); y += big ? 6 : 3.8; };
  totR.forEach(r => trow(r.lbl, r.val, false, false));
  y += 1; trow('TOTAL', T.total, true, true);
  // Monto en letras
  y += 2; doc.setTextColor(...ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
  doc.splitTextToSize(letras, cw).forEach(ln => { doc.text(ln, w / 2, y, { align: 'center' }); y += 3; });
  // ── Sello EXPORTACIÓN + Observaciones ──
  if (_esExp) {
    y += 1.5;
    doc.setFillColor(224, 242, 254); doc.setDrawColor(125, 211, 252); doc.setLineWidth(0.3);
    doc.roundedRect(mm, y, cw, 5.5, 2.6, 2.6, 'FD');
    doc.setTextColor(7, 89, 133); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6);
    doc.text('EXPORTACIÓN · 0% IGV', w / 2, y + 3.7, { align: 'center' });
    y += 8;
  }
  if (_obsTxt) {
    y += 1;
    const oLines = doc.splitTextToSize('OBS: ' + _obsTxt, cw - 3);
    const oh = oLines.length * 2.8 + 3;
    doc.setFillColor(253, 250, 242); doc.setDrawColor(227, 217, 196); doc.setLineWidth(0.3);
    doc.roundedRect(mm, y, cw, oh, 1.2, 1.2, 'FD');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.4); doc.setTextColor(90, 74, 42);
    let oy = y + 3; oLines.forEach(ln => { doc.text(ln, mm + 1.5, oy); oy += 2.8; });
    y += oh + 2;
  }
  // ── Detracción (SPOT) — bloque legal, solo FACTURA ≥ umbral ──
  if (detr) {
    y += 1.5;
    const dLines = doc.splitTextToSize(_facDetraccionTexto(detr), cw - 3);
    const dh = dLines.length * 2.7 + 3;
    doc.setDrawColor(...guinda); doc.setLineWidth(0.3); doc.setFillColor(251, 240, 238);
    doc.roundedRect(mm, y, cw, dh, 1.2, 1.2, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); doc.setTextColor(...guinda);
    let dy = y + 3; dLines.forEach(ln => { doc.text(ln, mm + 1.5, dy); dy += 2.7; });
    y += dh + 2;
  }
  // QR (estándar SUNAT) centrado
  if (qrUrl) {
    y += 2;
    try { doc.addImage(qrUrl, 'PNG', (w - 22) / 2, y, 22, 22); y += 23.5; } catch (e) {}
    if (hashTxt) { doc.setTextColor(...gray); doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.splitTextToSize(hashTxt, cw).forEach(ln => { doc.text(ln, w / 2, y, { align: 'center' }); y += 2.4; }); }
  }
  y += 2; doc.setTextColor(...gray); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
  const vend80 = String(c.creado_por || '').trim();
  const foot = doc.splitTextToSize('Representación impresa de la ' + _facTipoShort(c) + ' ELECTRÓNICA. SUNAT · NubeFact.' + (vend80 ? ' Emitido por: ' + vend80 : ''), cw);
  doc.text(foot, w / 2, y, { align: 'center' });
  _sello(doc, w, est);
  return doc;
}

// ── Subida a Storage (bucket comprobante-pdfs) → enlace firmado ~1 año. '' si falla. ──
async function _cpeSubir(sb, c, ext, blobPng) {
  try {
    if (!sb || c.id == null || !String(c.id).trim()) return '';
    var blob, ct;
    if (ext === 'png') { blob = blobPng; ct = 'image/png'; }
    else { var doc = await _facGenPDF(c, 'a4'); blob = doc.output('blob'); ct = 'application/pdf'; }
    if (!blob) return '';
    var path = String(c.id) + '.' + ext;
    var up = await sb.storage.from('comprobante-pdfs').upload(path, blob, { contentType: ct, upsert: true });
    if (up && up.error) return '';
    var sd = await sb.storage.from('comprobante-pdfs').createSignedUrl(path, 31536000);
    return (sd && sd.data && sd.data.signedUrl) || '';
  } catch (e) { return ''; }
}
// Mensaje profesional del muelle (cálido). linksBlock entre cuerpo y cierre.
function _cpeMensaje(c, T, linksBlock) {
  var num = _facNumFmt(c), tipo = _facTipoWord(c);
  var nom = String(c.cliente_nombre || '').trim();
  var marca = _FAC_EMISOR.marca, total = 'S/ ' + _facMoney(T.total);
  var esExp = (Number(T.exportacion) || 0) > 0;
  return '¡Hola ' + (nom || '') + '! 👋🌊\n\n'
    + 'Aquí tienes tu *' + tipo + ' ' + num + '* por un total de *' + total + '*.'
    + (esExp ? '\n_Comprobante de exportación · 0% IGV._' : '')
    + (linksBlock || '')
    + '\n\n¡Gracias por navegar con nosotros! 🐧\n*' + marca + '* — ¡te esperamos pronto!';
}
function _cpePuedeArchivos() {
  try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [new File([new Blob(['x'])], 't.png', { type: 'image/png' })] })); }
  catch (e) { return false; }
}
var _cpeSending = false;
// origen='ops' → imagen 80mm. tel opcional. btn: botón para spinner.
async function compartirCPE(c, opts) {
  opts = opts || {};
  if (!c || _cpeSending) return;
  var sb = (window.SupaAPI && window.SupaAPI.sb) || null;
  var fmt = opts.origen === 'panel' ? 'a4' : '80mm';
  var T = _facPdfTotales(c);
  var canFiles = _cpePuedeArchivos();
  var waWin = canFiles ? null : window.open('', '_blank');
  _cpeSending = true;
  var btn = opts.btn, btnHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.setAttribute('aria-disabled', 'true'); btn.style.opacity = '.6'; }
  var restore = function () { if (btn) { btn.removeAttribute('aria-disabled'); btn.style.opacity = ''; btn.innerHTML = btnHtml; } _cpeSending = false; };
  try { if (window.resTap) resTap(); if (window.resHap) resHap(10); } catch (e) {}
  // imagen (nuestra) + PDF: preferir el enlace OFICIAL de NubeFact (más rápido, es el legal).
  var imgBlob = null;
  try { var img = await _facRasterizar(c, fmt); imgBlob = img.blob; } catch (e) {}
  var oficial = /^https?:\/\//.test(String(c.enlace_pdf || ''));
  var links = await Promise.all([oficial ? Promise.resolve('') : _cpeSubir(sb, c, 'pdf', null), imgBlob ? _cpeSubir(sb, c, 'png', imgBlob) : Promise.resolve('')]);
  var pdfLink = oficial ? c.enlace_pdf : (links[0] || '');
  var imgLink = links[1] || '';
  var msgEmbebido = _cpeMensaje(c, T, pdfLink ? '\n\n📄 Descarga tu comprobante en PDF:\n' + pdfLink : '');
  var msgLinks = _cpeMensaje(c, T, (imgLink ? '\n\n🖼️ Ver tu comprobante (imagen):\n' + imgLink : '') + (pdfLink ? '\n\n📄 Descargar en PDF:\n' + pdfLink : ''));
  if (canFiles && imgBlob) {
    var file = new File([imgBlob], (_facTipoSlug(c) + '-' + (c.serie || '') + '-' + String(c.numero || 0)) + '.png', { type: 'image/png' });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: msgEmbebido, title: 'Comprobante ' + _facNumFmt(c) }); restore(); try { if (window.resOk) resOk(); } catch (e) {} return; }
      catch (e) { if (e && e.name === 'AbortError') { restore(); return; } }
    }
  }
  var tel = String(opts.tel || '').replace(/\D/g, ''); if (tel.length === 9) tel = '51' + tel;
  var url = 'https://wa.me/' + (tel.length === 11 ? tel : '') + '?text=' + encodeURIComponent(msgLinks);
  if (waWin && !waWin.closed) { try { waWin.location.href = url; } catch (e) { window.open(url, '_blank', 'noopener'); } }
  else window.open(url, '_blank', 'noopener');
  restore(); try { if (window.resOk) resOk(); } catch (e) {}
}
window.CPEShare = { compartir: compartirCPE, rasterizar: function (c, fmt) { return _facRasterizar(c, fmt); } };
})();
