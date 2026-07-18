// Tests de las funciones PURAS de extraer-zarpe/index.ts, portadas 1:1 a JS.
// Objetivo: verificar normalizarPasajeros (con el nuevo campo `dudoso`) y parseJSONRobusto.

// ───────── PORT 1:1 desde index.ts ─────────
function parseJSONRobusto(txt) {
  if (!txt) return null;
  let s = txt.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch {}
  }
  return null;
}

function normalizarPasajeros(raw) {
  if (!Array.isArray(raw)) return [];
  const TIPOS_OK = new Set(["1", "4", "6", "7"]);
  return raw.map((p) => {
    const o = (p && typeof p === "object") ? p : {};
    const nombre = String(o.nombre ?? "").trim();
    let documento = String(o.documento ?? "").replace(/[\s.\-]/g, "").trim();
    let tipo_doc = String(o.tipo_doc ?? "").trim();
    const nacionalidad = String(o.nacionalidad ?? "").trim();
    let dudoso = o.dudoso === true || o.dudoso === 1 || /^(true|1|si|sí)$/i.test(String(o.dudoso ?? "").trim());
    if (/^\d{8}$/.test(documento)) tipo_doc = "1";
    else if (/^\d{11}$/.test(documento)) tipo_doc = "6";
    if (!TIPOS_OK.has(tipo_doc)) tipo_doc = "";
    if (!nombre || !documento || !tipo_doc) dudoso = true;
    if (tipo_doc === "1" && !/^\d{8}$/.test(documento)) dudoso = true;
    else if (tipo_doc === "6" && !/^\d{11}$/.test(documento)) dudoso = true;
    return { nombre, tipo_doc, documento, nacionalidad, dudoso };
  }).filter((p) => p.nombre || p.documento);
}

// ───────── mini test runner ─────────
let pass = 0, fail = 0; const fails = [];
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function t(name, got, want) {
  if (eq(got, want)) { pass++; }
  else { fail++; fails.push({ name, got, want }); }
}

// ============ normalizarPasajeros ============

// 1) DNI válido + nombre, modelo no marca dudoso → NO dudoso
t("dni ok no dudoso",
  normalizarPasajeros([{ nombre: "Juan Perez", documento: "45678912", tipo_doc: "1", dudoso: false }]),
  [{ nombre: "Juan Perez", tipo_doc: "1", documento: "45678912", nacionalidad: "", dudoso: false }]);

// 2) RUC 11 dígitos → tipo_doc forzado a 6
t("ruc fuerza tipo 6",
  normalizarPasajeros([{ nombre: "Agencia Sol SAC", documento: "20512345678", tipo_doc: "1" }]),
  [{ nombre: "Agencia Sol SAC", tipo_doc: "6", documento: "20512345678", nacionalidad: "", dudoso: false }]);

// 3) Pasaporte alfanumérico legítimo (tipo 7) NO debe quedar dudoso por el refuerzo
t("pasaporte valido no dudoso",
  normalizarPasajeros([{ nombre: "John Smith", documento: "AB123456", tipo_doc: "7", nacionalidad: "USA" }]),
  [{ nombre: "John Smith", tipo_doc: "7", documento: "AB123456", nacionalidad: "USA", dudoso: false }]);

// 4) CE (tipo 4) legítimo NO dudoso
t("ce valido no dudoso",
  normalizarPasajeros([{ nombre: "Maria Vzla", documento: "001234567", tipo_doc: "4" }]),
  [{ nombre: "Maria Vzla", tipo_doc: "4", documento: "001234567", nacionalidad: "", dudoso: false }]);

// 5) modelo marca dudoso:true aunque el dato se vea completo → dudoso
t("modelo dice dudoso true",
  normalizarPasajeros([{ nombre: "Jose?", documento: "45678912", tipo_doc: "1", dudoso: true }])[0].dudoso,
  true);

// 6) dudoso como string "true"
t("dudoso string true", normalizarPasajeros([{ nombre: "X", documento: "45678912", dudoso: "true" }])[0].dudoso, true);
// 7) dudoso "si"
t("dudoso si", normalizarPasajeros([{ nombre: "X", documento: "45678912", dudoso: "si" }])[0].dudoso, true);
// 8) dudoso "sí" con tilde
t("dudoso si tilde", normalizarPasajeros([{ nombre: "X", documento: "45678912", dudoso: "sí" }])[0].dudoso, true);
// 9) dudoso numérico 1
t("dudoso num 1", normalizarPasajeros([{ nombre: "X", documento: "45678912", dudoso: 1 }])[0].dudoso, true);
// 10) dudoso string "false" NO debe activar
t("dudoso string false", normalizarPasajeros([{ nombre: "X", documento: "45678912", dudoso: "false" }])[0].dudoso, false);
// 11) dudoso 0 NO activa
t("dudoso num 0", normalizarPasajeros([{ nombre: "X", documento: "45678912", dudoso: 0 }])[0].dudoso, false);

// 12) sin documento → dudoso forzado true
t("sin doc dudoso", normalizarPasajeros([{ nombre: "Solo Nombre", documento: "", dudoso: false }])[0].dudoso, true);
// 13) sin nombre pero con doc → dudoso forzado
t("sin nombre dudoso", normalizarPasajeros([{ nombre: "", documento: "45678912", dudoso: false }])[0].dudoso, true);
// 14) documento con formato basura (5 dígitos) → tipo_doc vacío → dudoso
t("doc basura dudoso", normalizarPasajeros([{ nombre: "Ana", documento: "12345", tipo_doc: "1" }])[0].dudoso, true);

// 14b) RUC declarado (6) pero solo 10 dígitos → formato no calza → dudoso
t("ruc corto dudoso", normalizarPasajeros([{ nombre: "Emp", documento: "2051234567", tipo_doc: "6" }])[0].dudoso, true);
// 14c) DNI exacto de 8 dígitos con nombre → NO dudoso (no falso positivo)
t("dni 8 exacto no dudoso", normalizarPasajeros([{ nombre: "Ok", documento: "45678912", tipo_doc: "1" }])[0].dudoso, false);
// 14d) RUC exacto 11 → NO dudoso
t("ruc 11 exacto no dudoso", normalizarPasajeros([{ nombre: "Emp SAC", documento: "20512345678", tipo_doc: "6" }])[0].dudoso, false);

// 15) fila totalmente vacía se descarta
t("vacio descartado", normalizarPasajeros([{ nombre: "", documento: "" }]).length, 0);

// 16) limpieza de documento: espacios, guiones y puntos de miles
t("limpieza doc",
  normalizarPasajeros([{ nombre: "Z", documento: "45.678.912", tipo_doc: "1" }])[0].documento, "45678912");
t("limpieza doc guiones", normalizarPasajeros([{ nombre: "Z", documento: "456-789-12" }])[0].documento, "45678912");

// 17) raw no-array → []
t("no array", normalizarPasajeros("nope"), []);
t("null", normalizarPasajeros(null), []);

// 18) elemento no-objeto dentro del array no revienta
t("elemento string en array", normalizarPasajeros(["basura", { nombre: "Ok", documento: "45678912" }]).length, 1);

// 19) tipo_doc que la IA inventó (ej '3') no reconocido → se vacía → dudoso
t("tipo inventado se vacia", normalizarPasajeros([{ nombre: "Q", documento: "AB12", tipo_doc: "3" }])[0].tipo_doc, "");

// 20) 8 dígitos con tipo_doc equivocado (7) → forzado a 1, no dudoso
t("8 digitos fuerza dni", normalizarPasajeros([{ nombre: "R", documento: "45678912", tipo_doc: "7" }])[0].tipo_doc, "1");

// ============ parseJSONRobusto ============
t("json directo", parseJSONRobusto('{"pasajeros":[]}'), { pasajeros: [] });
t("json con fence", parseJSONRobusto('```json\n{"pasajeros":[{"nombre":"A"}]}\n```'), { pasajeros: [{ nombre: "A" }] });
t("json con prosa", parseJSONRobusto('Aquí tienes: {"pasajeros":[]} listo'), { pasajeros: [] });
t("json fence sin lang", parseJSONRobusto('```\n{"pasajeros":[]}\n```'), { pasajeros: [] });
t("basura → null", parseJSONRobusto('no hay json aquí'), null);
t("vacio → null", parseJSONRobusto(''), null);
t("solo texto con llave rota", parseJSONRobusto('{ roto'), null);

// ============ PARIDAD: _zarReeval (espejo cliente en app.js) debe coincidir con el backend ============
// Port 1:1 de _zarReeval de app.js
function _zarReeval(p){
  let doc=String(p.documento||'').replace(/[\s.\-]/g,'').trim(); p.documento=doc;
  let t=String(p.tipo_doc||'').trim();
  if(/^\d{8}$/.test(doc)) t='1'; else if(/^\d{11}$/.test(doc)) t='6';
  if(!['1','4','6','7'].includes(t)) t='';
  p.tipo_doc=t;
  let d=false;
  if(!p.nombre||!doc||!t) d=true;
  if(t==='1'&&!/^\d{8}$/.test(doc)) d=true; else if(t==='6'&&!/^\d{11}$/.test(doc)) d=true;
  p.dudoso=d;
}
// Para cada caso, el veredicto dudoso del espejo cliente debe ser IGUAL al del backend.
const casosParidad = [
  { nombre:'Juan', documento:'45678912', tipo_doc:'1' },   // DNI ok
  { nombre:'Emp',  documento:'20512345678', tipo_doc:'6' },// RUC ok
  { nombre:'Ana',  documento:'12345', tipo_doc:'1' },      // DNI corto -> dudoso
  { nombre:'Emp',  documento:'2051234567', tipo_doc:'6' }, // RUC corto -> dudoso
  { nombre:'John', documento:'AB123456', tipo_doc:'7' },   // pasaporte ok
  { nombre:'',     documento:'45678912', tipo_doc:'1' },   // sin nombre -> dudoso
  { nombre:'Solo', documento:'',         tipo_doc:'' },    // sin doc -> dudoso
  { nombre:'Q',    documento:'AB12',     tipo_doc:'3' },   // tipo inventado -> dudoso
];
casosParidad.forEach((c,idx)=>{
  const back = normalizarPasajeros([{...c}])[0] || { dudoso:true };
  const front = {...c}; _zarReeval(front);
  t(`paridad dudoso #${idx}`, front.dudoso, back.dudoso);
  t(`paridad tipo_doc #${idx}`, front.tipo_doc, back.tipo_doc);
});

// ============ Lógica anti-documento-duplicado (M1) del frontend ============
function selDuplicados(sel){
  const cuenta={}; sel.forEach(p=>{ const d=(p.documento||'').trim(); if(d) cuenta[d]=(cuenta[d]||0)+1; });
  return sel.filter(p=>p.documento && cuenta[p.documento]>1);
}
t("dup: dos mismos doc detectados",
  selDuplicados([{documento:'12345678'},{documento:'12345678'},{documento:'99999999'}]).length, 2);
t("dup: sin doc NO cuenta como duplicado",
  selDuplicados([{documento:''},{documento:''},{documento:'11111111'}]).length, 0);
t("dup: docs distintos = 0",
  selDuplicados([{documento:'12345678'},{documento:'87654321'}]).length, 0);

// ───────── resumen ─────────
console.log(`\n  PASS ${pass}  FAIL ${fail}\n`);
if (fails.length) {
  for (const f of fails) console.log("  ✗", f.name, "\n     got :", JSON.stringify(f.got), "\n     want:", JSON.stringify(f.want));
  process.exit(1);
} else {
  console.log("  ✓ todos los tests verdes");
}
