// Edge · extraer-zarpe — digitaliza la foto de un "zarpe" (manifiesto de pasajeros de un tour en bote)
// usando Claude vision. La ANTHROPIC_API_KEY vive en un SECRET, nunca en el frontend.
// El operador toma la foto del zarpe → Claude extrae la lista de pasajeros (nombre + doc).
//
// Patrón de seguridad REUSADO de consultar-documento/index.ts:
//   - CORS + OPTIONS idénticos
//   - helper j() idéntico
//   - exige sesión REAL (payload.role === 'authenticated') → rechaza la anon key pública,
//     así nadie puede drenar la cuota/costo de Anthropic desde afuera.
//
// Request  (POST): { imagen_base64, media_type }  ó  { imagen_url }  (Supabase Storage u otra URL http)
// Response (200):  { ok:true, pasajeros:[{ nombre, tipo_doc, documento, nacionalidad, dudoso }] }
//                  { ok:false, motivo }
// `dudoso`=true → el modelo no estuvo seguro del nombre/documento (letra a mano) O quedó incompleto/formato inválido.
//   El frontend lo marca "revisar" y NO lo autoselecciona: el operador confirma antes de emitir un CPE fiscal.
//
// Deploy:  supabase functions deploy extraer-zarpe --project-ref lintmcxqxnrholslatul
// Secret:  supabase secrets set ANTHROPIC_API_KEY="sk-ant-..." --project-ref lintmcxqxnrholslatul
//
// Formato de la API Anthropic Messages con imagen (doc oficial:
//   https://platform.claude.com/docs/en/docs/build-with-claude/vision  — "Base64-encoded image example"):
//   POST https://api.anthropic.com/v1/messages
//   headers: x-api-key, anthropic-version: 2023-06-01, content-type: application/json
//   body.messages[].content[] = [
//     { type:'image', source:{ type:'base64', media_type:'image/jpeg', data:'<b64>' } },
//     { type:'text',  text:'...' }
//   ]
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Modelo con visión — capaz y costo-eficiente. Fácil de cambiar aquí.
const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MEDIA_TYPES_OK = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const PROMPT = [
  "Eres un digitalizador EXPERTO de 'zarpes' (manifiestos de pasajeros de tours en bote, Perú).",
  "La lista está ESCRITA A MANO, muchas veces con letra apurada, desprolija o poco legible. Tu trabajo es ser EXHAUSTIVO: rescatar TODOS los pasajeros posibles, sin perder ninguno.",
  "Devuelve SOLO un JSON válido, sin texto adicional, con esta forma exacta:",
  '{ "pasajeros": [ { "nombre": "", "tipo_doc": "", "documento": "", "nacionalidad": "", "dudoso": false } ] }',
  "",
  "EXHAUSTIVIDAD (lo más importante):",
  "- Lee CADA renglón de la lista, de arriba hacia abajo. Incluye filas a medio escribir o parcialmente legibles.",
  "- Un renglón cuenta como pasajero aunque solo tenga el nombre O solo el documento: incluye lo que SÍ puedas leer.",
  "- NO omitas filas por estar mal escritas. Si dudas de un carácter, pon tu mejor lectura y marca \"dudoso\": true.",
  "- Conserva el ORDEN de la lista. Cuenta bien: si hay 20 renglones, devuelve 20 pasajeros.",
  "",
  "tipo_doc (por el FORMATO del documento, no lo inventes):",
  "- '1' = DNI (8 dígitos, peruanos).  '6' = RUC (11 dígitos, empieza 10/15/17/20).",
  "- '7' = Pasaporte (alfanumérico, turistas).  '4' = Carné de Extranjería (alfanumérico residente).",
  "- 8 dígitos => '1'. 11 dígitos => '6'. Alfanumérico => '7' salvo contexto claro de CE => '4'.",
  "",
  "Lectura de MANUSCRITO (corrige confusiones típicas con criterio):",
  "- Dígitos vs letras: 0/O, 1/l/I, 2/Z, 5/S, 6/b, 8/B, 9/g. Los DOCUMENTOS de DNI/RUC son SOLO números → interprétalos como dígitos.",
  "- Nombres: mayúsculas iniciales, corrige tildes obvias; hay nombres peruanos y extranjeros.",
  "",
  "Datos:",
  "- NO inventes. Campo ilegible/ausente => \"\". Marca \"dudoso\": true si no estás seguro del nombre o del documento.",
  "- 'documento': solo el número/código, sin espacios ni guiones.  'nombre': completo, corrigiendo la letra.",
  "- 'nacionalidad': país si aparece; si no, vacío.",
  "- Si no hay NINGÚN pasajero legible, devuelve { \"pasajeros\": [] }.",
  "",
  "Responde ÚNICAMENTE con el JSON, incluyendo TODOS los pasajeros que puedas rescatar.",
].join("\n");

// Extrae un objeto JSON de forma robusta del texto de Claude (puede venir con ```json ... ``` o prosa alrededor).
function parseJSONRobusto(txt: string): { pasajeros?: unknown } | null {
  if (!txt) return null;
  let s = txt.trim();
  // 1) quitar fences ```json ... ``` o ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 2) intento directo
  try { return JSON.parse(s); } catch { /* sigue */ }
  // 3) recortar al primer { ... último }
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch { /* sigue */ }
  }
  return null;
}

// Normaliza/valida la lista de pasajeros que devolvió el modelo.
function normalizarPasajeros(raw: unknown): Array<{ nombre: string; tipo_doc: string; documento: string; nacionalidad: string; dudoso: boolean }> {
  if (!Array.isArray(raw)) return [];
  const TIPOS_OK = new Set(["1", "4", "6", "7"]);
  return raw.map((p) => {
    const o = (p && typeof p === "object") ? p as Record<string, unknown> : {};
    const nombre = String(o.nombre ?? "").trim();
    // documento: solo el código sin espacios/guiones/puntos (la IA a veces mete "." de miles)
    let documento = String(o.documento ?? "").replace(/[\s.\-]/g, "").trim();
    let tipo_doc = String(o.tipo_doc ?? "").trim();
    const nacionalidad = String(o.nacionalidad ?? "").trim();
    // dudoso = lo que dijo el modelo (letra a mano insegura). Aceptamos varias verdades: true, "true", 1, "1", "si".
    let dudoso = o.dudoso === true || o.dudoso === 1 || /^(true|1|si|sí)$/i.test(String(o.dudoso ?? "").trim());
    // refuerzo determinístico por longitud numérica (defensa si el modelo se equivoca)
    if (/^\d{8}$/.test(documento)) tipo_doc = "1";
    else if (/^\d{11}$/.test(documento)) tipo_doc = "6";
    if (!TIPOS_OK.has(tipo_doc)) tipo_doc = "";
    // Defensa: aunque el modelo no lo marque, un pasajero SIN nombre, SIN documento,
    // o con documento de formato no reconocible es intrínsecamente "revisar" antes de emitir un CPE.
    if (!nombre || !documento || !tipo_doc) dudoso = true;
    return { nombre, tipo_doc, documento, nacionalidad, dudoso };
  }).filter((p) => p.nombre || p.documento); // descarta filas totalmente vacías
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ ok: false, motivo: "metodo" }, 405);

  // exige sesión REAL (rol authenticated). Rechaza la anon key pública → nadie drena la cuota Anthropic.
  const authz = req.headers.get("authorization") || "";
  const tok = authz.replace(/^Bearer\s+/i, "");
  try {
    const seg = (tok.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(seg));
    if (payload.role !== "authenticated") return j({ ok: false, motivo: "requiere_sesion" }, 403);
  } catch { return j({ ok: false, motivo: "sin_sesion" }, 401); }

  const KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!KEY) return j({ ok: false, motivo: "sin_config" }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* noop */ }

  const imagen_url = String(body.imagen_url ?? "").trim();
  let imagen_base64 = String(body.imagen_base64 ?? "").trim();
  let media_type = String(body.media_type ?? "").trim().toLowerCase();

  // Fuente 1: URL (Supabase Storage u otra URL http) → descargamos y convertimos a base64
  if (!imagen_base64 && imagen_url) {
    if (!/^https?:\/\//i.test(imagen_url)) return j({ ok: false, motivo: "url_invalida" }, 400);
    try {
      const r = await fetch(imagen_url);
      if (!r.ok) return j({ ok: false, motivo: "url_no_accesible", status: r.status }, 400);
      const ct = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!media_type && MEDIA_TYPES_OK.has(ct)) media_type = ct;
      const buf = new Uint8Array(await r.arrayBuffer());
      // base64 en chunks para no reventar la pila con imágenes grandes
      let bin = "";
      const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode(...buf.subarray(i, i + CH));
      imagen_base64 = btoa(bin);
    } catch { return j({ ok: false, motivo: "error_descarga_url" }, 400); }
  }

  // permitir data URI: data:image/jpeg;base64,XXXX
  const dataUri = imagen_base64.match(/^data:([^;]+);base64,(.*)$/i);
  if (dataUri) {
    if (!media_type) media_type = dataUri[1].toLowerCase();
    imagen_base64 = dataUri[2];
  }

  if (!imagen_base64) return j({ ok: false, motivo: "sin_imagen" }, 400);
  if (!media_type) media_type = "image/jpeg"; // asunción segura para foto de operador
  if (!MEDIA_TYPES_OK.has(media_type)) return j({ ok: false, motivo: "media_type_no_soportado", media_type }, 400);

  const anthropicBody = {
    model: MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type, data: imagen_base64 } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  };

  // 1 reintento con backoff ante 429 / 5xx / red
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(anthropicBody),
      });

      if (r.status === 401 || r.status === 403) return j({ ok: false, motivo: "key_rechazada" }, 502);
      if (r.status === 429) { if (intento === 0) { await new Promise((x) => setTimeout(x, 1200)); continue; } return j({ ok: false, motivo: "rate_limit" }, 429); }
      if (r.status >= 500) { if (intento === 0) { await new Promise((x) => setTimeout(x, 1000)); continue; } return j({ ok: false, motivo: "api_5xx", status: r.status }, 502); }
      if (!r.ok) {
        const errTxt = await r.text().catch(() => "");
        return j({ ok: false, motivo: "api_error", status: r.status, detalle: errTxt.slice(0, 300) }, 502);
      }

      const d = await r.json().catch(() => null) as { content?: Array<{ type?: string; text?: string }> } | null;
      // Claude devuelve content[] con bloques; tomamos el primer texto.
      const texto = d?.content?.find((c) => c?.type === "text")?.text ?? d?.content?.[0]?.text ?? "";
      if (!texto) return j({ ok: false, motivo: "respuesta_vacia" }, 502);

      const parsed = parseJSONRobusto(texto);
      if (!parsed) return j({ ok: false, motivo: "json_no_parseable", crudo: texto.slice(0, 500) }, 502);

      const pasajeros = normalizarPasajeros((parsed as { pasajeros?: unknown }).pasajeros);
      return j({ ok: true, pasajeros });
    } catch (_e) {
      if (intento === 0) { await new Promise((x) => setTimeout(x, 1000)); continue; }
      return j({ ok: false, motivo: "error_red" }, 502);
    }
  }
  return j({ ok: false, motivo: "error" }, 500);
});
