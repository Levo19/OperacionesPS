// Edge · consultar-documento (APIsPeru RUC/DNI) — token en SECRET, nunca en frontend.
// Detecta 8=DNI(RENIEC) / 11=RUC(SUNAT). Reusa el proveedor de MOS (dniruc.apisperu.com, token JWT en querystring).
// Deploy:  supabase functions deploy consultar-documento --project-ref lintmcxqxnrholslatul
// Secret:  supabase secrets set APISPERU_TOKEN="<jwt>" --project-ref lintmcxqxnrholslatul
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // exige sesión REAL (rol authenticated). Rechaza la anon key pública → no se puede drenar la cuota APIsPeru.
  const authz = req.headers.get("authorization") || "";
  const tok = authz.replace(/^Bearer\s+/i, "");
  try {
    const seg = (tok.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(seg));
    if (payload.role !== "authenticated") return j({ ok: false, motivo: "requiere_sesion" }, 403);
  } catch { return j({ ok: false, motivo: "sin_sesion" }, 401); }

  const TOKEN = Deno.env.get("APISPERU_TOKEN");
  if (!TOKEN) return j({ ok: false, motivo: "sin_config" }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* noop */ }
  const raw = String(body.numero ?? "").replace(/\D/g, "");
  // normaliza tipo: acepta '1'/'6', 'dni'/'ruc', o autodetecta por longitud (8=DNI, 11=RUC)
  let tipo = String(body.tipo ?? "").toLowerCase();
  tipo = tipo === "dni" ? "1" : tipo === "ruc" ? "6" : tipo;
  if (tipo !== "1" && tipo !== "6") tipo = raw.length === 8 ? "1" : raw.length === 11 ? "6" : "";
  if (tipo !== "1" && tipo !== "6") return j({ ok: false, motivo: "manual", doc_tipo: tipo, doc_numero: raw });
  if ((tipo === "1" && raw.length !== 8) || (tipo === "6" && raw.length !== 11))
    return j({ ok: false, motivo: "longitud", doc_tipo: tipo, doc_numero: raw });

  const path = tipo === "1" ? "dni" : "ruc";
  const url = `https://dniruc.apisperu.com/api/v1/${path}/${raw}?token=${TOKEN}`;

  // 1 reintento con backoff ante 5xx / red
  for (let intento = 0; intento < 2; intento++) {
    try {
      const r = await fetch(url);
      if (r.status === 401 || r.status === 403) return j({ ok: false, motivo: "token_rechazado", doc_tipo: tipo, doc_numero: raw });
      if (r.status === 402) return j({ ok: false, motivo: "sin_saldo", doc_tipo: tipo, doc_numero: raw });
      if (r.status === 404) return j({ ok: false, motivo: "no_encontrado", doc_tipo: tipo, doc_numero: raw });
      if (r.status >= 500) { if (intento === 0) { await new Promise((x) => setTimeout(x, 800)); continue; } return j({ ok: false, motivo: "api_5xx", doc_tipo: tipo, doc_numero: raw }); }
      const d = await r.json().catch(() => ({}));
      // APIsPeru a veces responde 200 con success:false en vez de 404
      if (d && d.success === false) return j({ ok: false, motivo: "no_encontrado", doc_tipo: tipo, doc_numero: raw });
      // tolerante a camelCase (APIsPeru) y snake_case (por si cambia el proveedor)
      const nombre = d.razonSocial ?? d.razon_social ?? d.nombre ??
        [d.nombres, d.apellidoPaterno ?? d.apellido_paterno, d.apellidoMaterno ?? d.apellido_materno].filter(Boolean).join(" ").trim();
      const direccion = d.direccion ?? d.domicilio ?? d.direccion_completa ?? "";
      if (!nombre) return j({ ok: false, motivo: "no_encontrado", doc_tipo: tipo, doc_numero: raw });
      return j({ ok: true, doc_tipo: tipo, doc_numero: raw, nombre, direccion });
    } catch (_e) {
      if (intento === 0) { await new Promise((x) => setTimeout(x, 800)); continue; }
      return j({ ok: false, motivo: "error_red", doc_tipo: tipo, doc_numero: raw });
    }
  }
  return j({ ok: false, motivo: "error", doc_tipo: tipo, doc_numero: raw });
});
