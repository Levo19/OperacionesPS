// _build_cpe_module.js — REGENERA comprobante-share.js:
//   funciones/constantes del ticket CPE = VERBATIM de C:/Users/ISO/PS/index.html (código probado)
//   + las funciones de compartir propias de OPS (_cpe*) = preservadas del módulo actual.
// Uso:  node _build_cpe_module.js            → escribe comprobante-share.js
//       node _build_cpe_module.js --check    → genera a un temporal y hace DIFF vs el actual (no escribe)
// Tras regenerar: node --check comprobante-share.js + browsercheck _check_ops_cpe.js. Bumpa el SW (ops-vNN).
const fs = require('fs');
const path = require('path');
const { extractByName, extractCss } = require('./_extract_cpe.js');

const PS_INDEX = 'C:/Users/ISO/PS/index.html';
const OUT = path.join(__dirname, 'comprobante-share.js');

// Constantes y funciones que se COPIAN VERBATIM de PS (en este orden).
const CONSTS = ['_FAC_EMISOR', '_FAC_DETRACCION', '_FAC_UNIDAD'];
const FUNCS = [
  '_facMoney', '_facEsc', '_facEnsureJsPDF', '_facEnsureH2C', '_facEnsureQR', '_facLoadLogo',
  '_facEnteroLetras', '_facMontoLetras', '_facNumFmt', '_facTipoWord', '_facTipoShort', '_facTipoSlug',
  '_facTituloDoc', '_facInferDocTipo', '_facFormaPago', '_facDetraccion', '_facDetraccionTexto',
  '_facDetraccionHTML', '_facNCLegal', '_facNCLegalHTML', '_facDocModWord', '_facPdfItems',
  '_facPdfTotales', '_facTotRows', '_facQRData', '_facQRDataUrl', '_facRasterizar',
  '_facPdfPreviewHTML', '_facGenPDF'
];
// Funciones de compartir PROPIAS de OPS (no vienen de PS) — se preservan del módulo actual.
const CPE_FUNCS = ['_cpeSubir', '_cpeMensaje', '_cpePuedeArchivos', 'compartirCPE'];

function build() {
  const PS = fs.readFileSync(PS_INDEX, 'utf8');
  const CUR = fs.readFileSync(OUT, 'utf8');

  const cssRaw = extractCss(PS);
  const cssJsString = cssRaw.replace(/\\/g, '\\\\').replace(/"/g, '\\"').split('\n').join('\\n');

  // preserva el comentario // que precede a la definición (para las funciones propias de OPS)
  const withComment = (src, name) => {
    const def = extractByName(src, name);
    const before = src.slice(0, src.indexOf(def)).split('\n');
    const cmt = [];
    for (let j = before.length - 2; j >= 0; j--) {   // -1 es '' tras el \n previo a la def
      const t = before[j].trim();
      if (t.startsWith('//')) cmt.unshift(before[j]); else break;
    }
    return (cmt.length ? cmt.join('\n') + '\n' : '') + def;
  };
  const consts = CONSTS.map(n => extractByName(PS, n)).join('\n');
  const funcs = FUNCS.map(n => extractByName(PS, n)).join('\n\n');
  const cpeFuncs = CPE_FUNCS.map(n => withComment(CUR, n)).join('\n\n');

  return `// comprobante-share.js — MÓDULO COMPARTIDO CPE (OPS muelle). GENERADO por _build_cpe_module.js.
// Funciones de render/ticket/PDF COPIADAS VERBATIM del PS Panel (código probado) + compartir propio de OPS.
// Expone window.CPEShare.compartir(c, {origen, tel, btn}). NO editar a mano las _fac*: regenerar con
//   node _build_cpe_module.js   (extrae de C:/Users/ISO/PS/index.html)
(function () {
  'use strict';
  // stub inofensivo: _facGenPDF referencia _facState._pdf.fmt como fallback; aquí SIEMPRE pasamos fmt.
  var _facState = { _pdf: null };
  // Inyecta la CSS del ticket (.fpdf-*) una sola vez.
  if (!document.getElementById('cpe-share-css')) {
    var st = document.createElement('style'); st.id = 'cpe-share-css';
    st.textContent = "${cssJsString}";
    document.head.appendChild(st);
  }

// ── Constantes (verbatim PS) ──
${consts}
// caches de carga perezosa (declaradas fuera de las funciones en PS)
let _facJsPDFPromise = null, _facH2CPromise = null, _facQRPromise = null, _facLogoPromise = null;

// ── Funciones del ticket (verbatim PS) ──
${funcs}

// ── Compartir (propio de OPS) ──
var _cpeSending = false;   // guard de reentrada de compartirCPE (declarado a nivel de módulo)
${cpeFuncs}

window.CPEShare = { compartir: compartirCPE, rasterizar: function (c, fmt) { return _facRasterizar(c, fmt); } };
})();
`;
}

const out = build();
const isCheck = process.argv.includes('--check');
if (isCheck) {
  const tmp = OUT + '.new';
  fs.writeFileSync(tmp, out);
  console.log('Generado en ' + tmp + ' (' + out.length + ' chars). Compara con: git diff --no-index comprobante-share.js comprobante-share.js.new');
} else {
  fs.writeFileSync(OUT, out);
  console.log('✓ comprobante-share.js regenerado (' + out.length + ' chars). Corre: node --check comprobante-share.js');
}
