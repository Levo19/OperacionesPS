// _extract_cpe.js — extrae VERBATIM de un fuente JS/HTML la definición de una función/constante
// top-level (o el bloque CSS .fpdf-*). Scanner JS-aware: respeta strings ' " , templates `${}`,
// comentarios // /* */ y regex (heurística por último token significativo) para el brace/;-matching.
// Usado por _build_cpe_module.js para regenerar comprobante-share.js desde PS/index.html.

// Devuelve el índice FINAL (exclusivo) de la definición que empieza en `start`.
function findDefEnd(src, start) {
  const N = src.length;
  const head = src.slice(start, start + 48);
  const isFunc = /^(export\s+)?(async\s+)?function\b/.test(head);
  let i = start, brace = 0, paren = 0, bracket = 0, seenBrace = false, lastSig = '';

  const skipString = (q) => { i++; while (i < N) { const ch = src[i]; if (ch === '\\') { i += 2; continue; } if (ch === q) { i++; return; } i++; } };
  const skipLineComment = () => { while (i < N && src[i] !== '\n') i++; };
  const skipBlockComment = () => { i += 2; while (i < N && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; };
  const skipRegex = () => { i++; let cls = false; while (i < N) { const ch = src[i]; if (ch === '\\') { i += 2; continue; } if (ch === '[') cls = true; else if (ch === ']') cls = false; else if (ch === '/' && !cls) { i++; break; } else if (ch === '\n') break; i++; } while (i < N && /[a-z]/i.test(src[i])) i++; };
  const isRegexPos = () => lastSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSig);
  const skipTemplate = () => {
    i++;
    while (i < N) {
      const ch = src[i];
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { i++; return; }
      if (ch === '$' && src[i + 1] === '{') { i += 2; skipExpr(); continue; }
      i++;
    }
  };
  // dentro de ${ ... }: cuenta llaves respetando strings/templates/comentarios/regex
  const skipExpr = () => {
    let depth = 1, ls = '{';
    while (i < N && depth > 0) {
      const ch = src[i];
      if (ch === '\'' || ch === '"') { skipString(ch); ls = ch; continue; }
      if (ch === '`') { skipTemplate(); ls = '`'; continue; }
      if (ch === '/' && src[i + 1] === '/') { skipLineComment(); continue; }
      if (ch === '/' && src[i + 1] === '*') { skipBlockComment(); continue; }
      if (ch === '/') { if (ls === '' || '(,=:[!&|?{};+-*%<>~^'.includes(ls)) { skipRegex(); ls = '/'; continue; } i++; ls = '/'; continue; }
      if (ch === '{') { depth++; i++; ls = '{'; continue; }
      if (ch === '}') { depth--; i++; ls = '}'; continue; }
      if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') ls = ch;
      i++;
    }
  };

  while (i < N) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (ch === '\'' || ch === '"') { skipString(ch); lastSig = ch; continue; }
    if (ch === '`') { skipTemplate(); lastSig = '`'; continue; }
    if (ch === '/' && src[i + 1] === '/') { skipLineComment(); continue; }
    if (ch === '/' && src[i + 1] === '*') { skipBlockComment(); continue; }
    if (ch === '/') { if (isRegexPos()) { skipRegex(); lastSig = '/'; continue; } i++; lastSig = '/'; continue; }
    if (ch === '{') { brace++; seenBrace = true; i++; lastSig = '{'; continue; }
    if (ch === '}') { brace--; i++; lastSig = '}'; if (isFunc && seenBrace && brace === 0) return i; continue; }
    if (ch === '(') { paren++; i++; lastSig = '('; continue; }
    if (ch === ')') { paren--; i++; lastSig = ')'; continue; }
    if (ch === '[') { bracket++; i++; lastSig = '['; continue; }
    if (ch === ']') { bracket--; i++; lastSig = ']'; continue; }
    if (ch === ';' && !isFunc && brace === 0 && paren === 0 && bracket === 0) return i + 1;
    lastSig = ch; i++;
  }
  return i;
}

// Extrae la definición top-level de `name` (function|async function|const|let|var).
function extractByName(src, name) {
  const re = new RegExp('(^|\\n)((?:export\\s+)?(?:async\\s+)?function\\s+' + name + '\\b|(?:const|let|var)\\s+' + name + '\\b)');
  const m = re.exec(src);
  if (!m) throw new Error('definición no encontrada: ' + name);
  const start = m.index + (m[1] ? m[1].length : 0);
  return src.slice(start, findDefEnd(src, start));
}

// Extrae el bloque CSS del ticket, de la regla `.fpdf-paper {` a `.fpdf-foot {` (inclusive).
function extractCss(src) {
  const lines = src.split('\n');
  const a = lines.findIndex(l => /^\.fpdf-paper \{/.test(l));
  if (a < 0) throw new Error('CSS .fpdf-paper no encontrada');
  let b = -1;
  for (let i = a; i < lines.length; i++) { if (/^\.fpdf-foot \{/.test(lines[i])) { b = i; break; } }
  if (b < 0) throw new Error('CSS .fpdf-foot no encontrada');
  return lines.slice(a, b + 1).join('\n');
}

module.exports = { findDefEnd, extractByName, extractCss };
