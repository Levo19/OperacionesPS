// Edge · extraer-compra — digitaliza la foto de una FACTURA/BOLETA DE COMPRA peruana
// usando Claude vision para extraer el IGV (crédito fiscal). La ANTHROPIC_API_KEY vive
// en un SECRET, nunca en el frontend.
// El operador toma la foto de la factura del proveedor → Claude extrae base / IGV / total.
//
// Patrón de seguridad REUSADO EXACTO de extraer-zarpe/index.ts:
//   - CORS + OPTIONS idénticos
//   - helper j() idéntico
//   - exige sesión REAL (payload.role === 'authenticated') → rechaza la anon key pública,
//     así nadie puede drenar la cuota/costo de Anthropic desde afuera.
//   - misma llamada a Anthropic Messages con visión (imagen base64 antes del texto)
//   - mismo parseo robusto del content[].text (quita fences ```json, recorta a {...})
//   - mismos reintentos/mapeo de errores (401/403 key_rechazada, 429 rate_limit, 5xx api_5xx)
//
// Request  (POST): { imagen_base64, media_type }  ó  { imagen_url }  (Supabase Storage u otra URL http)
// Response (200):  { ok:true, compra:{ proveedor, ruc_proveedor, fecha, tipo_doc, serie, numero, base, igv, total, moneda } }
//                  { ok:false, motivo }
//
// Deploy:  supabase functions deploy extraer-compra --project-ref lintmcxqxnrholslatul
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
  "Eres un digitalizador de FACTURAS y BOLETAS de COMPRA peruanas (documentos que el negocio RECIBE de sus proveedores).",
  "Tu objetivo es extraer el crédito fiscal (IGV) del comprobante en la imagen.",
  "Devuelve SOLO un JSON válido, sin texto adicional, sin explicaciones, con esta forma exacta:",
  '{ "proveedor": "", "ruc_proveedor": "", "fecha": "", "tipo_doc": "", "serie": "", "numero": "", "base": 0, "igv": 0, "total": 0, "moneda": "PEN" }',
  "",
  "Reglas de identificación:",
  "- 'proveedor': razón social del EMISOR del comprobante (quien vende / a quien le compramos), NO el cliente/adquiriente.",
  "- 'ruc_proveedor': el RUC del EMISOR (proveedor), exactamente 11 dígitos numéricos. NO el RUC/DNI del cliente. Si hay dos RUC, el del proveedor suele estar en el encabezado junto al logo/razón social.",
  "- 'tipo_doc': '01' si es FACTURA, '03' si es BOLETA DE VENTA. Infiérelo por el título del documento.",
  "- 'serie': el prefijo del comprobante, p.ej. 'F001', 'B001', 'E001'. Tal cual aparece.",
  "- 'numero': el correlativo del comprobante, solo el número (sin la serie, sin ceros de relleno a la izquierda si es evidente que son relleno; si dudas, déjalo tal cual).",
  "- 'fecha': fecha de emisión en formato 'YYYY-MM-DD'.",
  "- 'moneda': 'PEN' para soles (S/), 'USD' para dólares ($). Por defecto 'PEN' si no es claro.",
  "",
  "Reglas de importes (crítico para el crédito fiscal):",
  "- 'base'  = valor de venta GRAVADO sin IGV (subtotal / op. gravadas / valor de venta).",
  "- 'igv'   = el impuesto IGV (18%).",
  "- 'total' = importe total a pagar = base + igv.",
  "- Debe cumplirse total ≈ base + igv. Si los tres aparecen impresos, respétalos tal cual.",
  "- Si SOLO ves el TOTAL y la operación es gravada (tiene IGV), calcula: base = total / 1.18 ; igv = total - base. Redondea a 2 decimales.",
  "- Si la operación es EXONERADA/INAFECTA (sin IGV), pon igv = 0 y base = total.",
  "- Usa punto decimal, sin separador de miles, sin símbolo de moneda. Ej: 254.24",
  "",
  "Reglas generales:",
  "- NO inventes datos. Si un campo de texto es ilegible o no está, déjalo como cadena vacía \"\".",
  "- Si un importe es ilegible o no está, déjalo en 0.",
  "- El RUC debe tener 11 dígitos; si lo que lees no los tiene, déjalo vacío.",
  "",
  "Responde ÚNICAMENTE con el JSON.",
].join("\n");

// Extrae un objeto JSON de forma robusta del texto de Claude (puede venir con ```json ... ``` o prosa alrededor).
function parseJSONRobusto(txt: string): Record<string, unknown> | null {
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

// Convierte a número tolerando cadenas con separador de miles, símbolo de moneda o coma decimal.
function numeroSeguro(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  let s = v.trim().replace(/[^\d.,-]/g, ""); // quita S/, $, espacios, letras
  if (!s) return 0;
  // si tiene ambos . y , → el último separador es el decimal
  if (s.includes(".") && s.includes(",")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    // solo coma → decimal
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Normaliza/valida la compra que devolvió el modelo, y reconcilia base/igv/total.
function normalizarCompra(raw: Record<string, unknown> | null) {
  const o = raw ?? {};
  const proveedor = String(o.proveedor ?? "").trim();
  const ruc_proveedor = String(o.ruc_proveedor ?? "").replace(/\D/g, "").trim();
  const fecha = String(o.fecha ?? "").trim();
  let tipo_doc = String(o.tipo_doc ?? "").trim();
  const serie = String(o.serie ?? "").trim().toUpperCase();
  const numero = String(o.numero ?? "").trim();
  let moneda = String(o.moneda ?? "").trim().toUpperCase();

  let base = r2(numeroSeguro(o.base));
  let igv = r2(numeroSeguro(o.igv));
  let total = r2(numeroSeguro(o.total));

  // saneos determinísticos (defensa si el modelo se equivoca)
  if (!/^\d{11}$/.test(ruc_proveedor)) { /* si no son 11 dígitos, lo dejamos como lo que quedó (posiblemente vacío) */ }
  const rucFinal = /^\d{11}$/.test(ruc_proveedor) ? ruc_proveedor : "";
  if (tipo_doc !== "01" && tipo_doc !== "03") tipo_doc = "";
  if (moneda !== "USD" && moneda !== "PEN") moneda = "PEN";

  // Reconciliación de importes cuando falten piezas:
  // caso A: tengo total pero no base/igv → derivo asumiendo gravado 18%.
  if (total > 0 && base <= 0 && igv <= 0) {
    base = r2(total / 1.18);
    igv = r2(total - base);
  }
  // caso B: tengo base + igv pero no total → sumo.
  else if (total <= 0 && base > 0) {
    total = r2(base + igv);
  }
  // caso C: tengo total + base pero no igv → resto.
  else if (total > 0 && base > 0 && igv <= 0) {
    igv = r2(total - base);
    if (igv < 0) igv = 0;
  }
  // caso D: tengo total + igv pero no base → resto.
  else if (total > 0 && igv > 0 && base <= 0) {
    base = r2(total - igv);
    if (base < 0) base = 0;
  }

  // consistencia: si total no cuadra con base+igv por redondeo, ajusto el total a base+igv.
  if (base > 0 && Math.abs(r2(base + igv) - total) > 0.05) {
    total = r2(base + igv);
  }

  return { proveedor, ruc_proveedor: rucFinal, fecha, tipo_doc, serie, numero, base, igv, total, moneda };
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

      const compra = normalizarCompra(parsed);
      return j({ ok: true, compra });
    } catch (_e) {
      if (intento === 0) { await new Promise((x) => setTimeout(x, 1000)); continue; }
      return j({ ok: false, motivo: "error_red" }, 502);
    }
  }
  return j({ ok: false, motivo: "error" }, 500);
});
