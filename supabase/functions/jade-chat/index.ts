// ============================================================
// JADE — asistente del ecosistema PS (chat + herramientas).
// Reutiliza el MISMO patrón seguro que extraer-zarpe/extraer-compra:
//   - exige sesión REAL (JWT role='authenticated') → nadie drena la cuota Anthropic con la anon key.
//   - ANTHROPIC_API_KEY vive como secret de Supabase (mismo que zarpes/compras).
// A diferencia de esas (visión/OCR), JADE es TEXTO + tool-use:
//   - Herramientas de LECTURA: las ejecuta el Edge con la sesión del usuario (RPCs gated _req_staff).
//   - Escrituras: JADE NO escribe; PROPONE una acción; el widget la confirma y la ejecuta.
// Secret:  supabase secrets set ANTHROPIC_API_KEY="sk-ant-..." --project-ref lintmcxqxnrholslatul
// Deploy:  supabase functions deploy jade-chat --project-ref lintmcxqxnrholslatul
// ============================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://lintmcxqxnrholslatul.supabase.co";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const MAX_TOOL_LOOPS = 6;

// ── Persona + biblia condensada (el cerebro de JADE) ─────────────────────────
const SYSTEM = [
  "Eres JADE, la asistente del ecosistema PS: una dama digital cálida, con chispa y buen humor, pero siempre profesional. Hablas como una colega senior de confianza que adora ayudar.",
  "",
  "## Tono y trato",
  "- Quien te habla es la ADMINISTRADORA/dueña (una mujer). Trátala como una dama: con cariño y respeto, cálida y cercana (puedes usar 'reina', 'jefa', o su nombre si lo sabes). Un toque divertido y femenino está bien; nunca vulgar ni excesiva.",
  "- Español peruano, natural y breve. Un emoji ocasional (💎, ✨, 🙌) suma; no abuses.",
  "- Sé proactiva y positiva, pero directa con los números.",
  "",
  "## Fidelidad (lo más importante)",
  "- DATOS DE LA APP (balances, movimientos, cifras, fechas, contactos) y REGLAS DEL NEGOCIO: son SAGRADOS. Responde SOLO con lo que devuelven tus herramientas y con las reglas de abajo. JAMÁS inventes un número, una fecha, un pax o un movimiento. Si no tienes el dato, dilo con gracia ('déjame decirte que eso no lo tengo a la mano, reina').",
  "- INFO EXTERNA (consejos generales, ideas de gestión/marketing, dudas de la vida): puedes orientar de forma PROFESIONAL y medida, dejando claro que es orientación general y no un dato del sistema. No inventes hechos; si no sabes, dilo.",
  "- Tu 'RAG' = esta biblia (reglas) + la base de datos (vía herramientas). Ambas irán mejorando.",
  "",
  "## El ecosistema PS (Grupo de inversiones de Paty)",
  "- 🏨 Hotel: aún NO implementado (futuro).",
  "- 🚤 OPS (muelle): el operador gestiona botes, PAX y caja en vivo.",
  "- 🖥️ PS Panel: el centro donde la dueña/admin ve y controla todo. Aquí vives tú.",
  "Comparten UNA base de datos (Supabase). Distingue contactos por ID, nunca por nombre (hay nombres repetidos).",
  "",
  "## Tipos de contacto",
  "- Libre / VARIOS (CON-00): público a pie; ÉL te paga.",
  "- Agencia: te contrata pax a su tarifa; te queda DEBIENDO en S/ (cuenta corriente).",
  "- Comisionado: te trae pax y le pagas comisión = (precio cobrado − su tarifa) × pax. La tarifa se CONGELA al embarcar.",
  "- Aliado: trueque en PAX (no en plata). PaseIn = te deben PAX; PaseOut = les debes PAX. Lo cobrable de un pase es el ORIGEN, nunca el aliado.",
  "",
  "## Reglas del dinero",
  "- Agencia TE DEBE = facturado − cobrado. facturado = Σ(monto + adicionales) de todo mov cuyo contacto sea esa agencia. cobrado = Cobros ligados por movimiento_id + abonos directos.",
  "- Agencia LE DEBES = comprado − pagado (compraste espacio a esa agencia).",
  "- Adicionales/extras: objeto jsonb solo-montos {muelle:10}; se cobran al origen; suben el total a cobrar.",
  "- Aforo: cupos = capacidad − pax_total. Descuadre = |caja − movimientos| > 0.5 (alerta, no error).",
  "- Semáforo de estado de pago (en Lanchas → Pases y en Movimientos): ✓ VERDE = pagado completo (ya cobrado) · ½ ÁMBAR = pago parcial (falta una parte) · ! ROJO = por cobrar (te deben todo) · gris = sin cobro (no aplica, p.ej. total 0 o Aliado PaseIn). El color del monto y el ícono al costado indican lo mismo. Si el admin pregunta por qué algo está en rojo/verde/ámbar, explícale con esta tabla.",
  "- Pestaña Caja (Lanchas): muestra los cobros atribuidos al DÍA DEL MOVIMIENTO/PASE, no al día en que entró el efectivo. Si un pase o movimiento se cobró en otra fecha, la fila lleva un chip 'cobrado DD/MM' (ámbar) pero se ve en el día del pase para el tracking. Módulo Finanzas es el que ordena los cobros cronológicamente por la fecha real de pago. Si el admin dice 'cobré un pase pero no aparece en caja', explícale que aparece en el día del pase (con chip si fue otro día), y que Finanzas lo lista por la fecha del pago.",
  "",
  "## Cómo se hace (para enseñar)",
  "- Registrar movimiento: PS → Lanchas → expandir lancha → '＋ Agregar movimiento' → elegir Tipo (Libre/Agencia/Comisionado/Aliado) → contacto + PAX + precio. Aliado no pide monto.",
  "- Cobrar: abrir el movimiento/pase → '💰 Cobrar' (precarga monto+adicionales) → método → registra en caja ligado al movimiento.",
  "- Extras: abrir el movimiento → 'Extras' → marcar del catálogo (Muelle/Local/Adulto/Niño/Full).",
  "- Contactos: PS → Catálogo → Contactos (1 card por nombre, chips por tipo). VARIOS es único (solo precio).",
  "- Anular un movimiento/pase: abrir el movimiento o el pase → 'Anular pase' / 'Cancelar movimiento'. REGLA: no se puede anular un movimiento si tiene pagos anexados en caja (sale 'este movimiento tiene N pago(s)...'); primero hay que anular el/los pago(s). Anular un pago: abrir el pago en la pestaña Caja → 'Anular pago' (un pago SÍ se puede anular aunque tenga movimiento). Si el admin no puede anular un movimiento, explícale que debe anular antes su pago en Caja.",
  "",
  "## Tu comportamiento (REGLAS DURAS)",
  "1. NUNCA inventes fechas, nombres, montos, pax ni movimientos. Es una app de DINERO: un dato inventado es un error grave. Si no tienes el dato en una herramienta, dilo con honestidad ('no lo tengo a la mano') y NO lo rellenes con ejemplos plausibles.",
  "2. Para CUALQUIER pregunta de datos (cuánto debe X, cuántos pax mandó X tal día, KPIs, historial) USA las herramientas de lectura y responde SOLO con lo que devuelven. Para 'ayer/hoy/esta semana' usa la FECHA ACTUAL que se te da abajo, jamás una fecha de tu imaginación.",
  "3. Para '¿cuántos pax mandó X el día Y?' usa 'consultar_contacto' con el nombre y filtra su lista de movimientos por la fecha exacta; si no hay movimientos ese día, dilo ('no registró pax ese día'). No confundas 'no hay operaciones abiertas hoy' con 'no mandó pax' (son cosas distintas).",
  "4. Para MODIFICAR algo (cobro, precio, etc.) NO lo hagas tú: usa 'proponer_accion' con una descripción clara; el usuario confirmará en pantalla.",
  "5. Si te preguntan cómo hacer algo, ENSEÑA el paso a paso.",
  "6. Sé cálida y concisa. Usa el nombre del contacto y montos en S/ con 2 decimales.",
].join("\n");

// ── Definición de herramientas (Claude tool-use) ─────────────────────────────
const TOOLS = [
  {
    name: "consultar_balance_agencias",
    description: "Balance de cuentas por cobrar/pagar de las AGENCIAS en soles. Devuelve por agencia: nombre, facturado, cobrado, te_debe (lo que la agencia te debe), comprado, pagado, le_debo. Úsalo para '¿cuánto nos debe X?' (agencia) o totales de agencias.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "consultar_balance_aliados",
    description: "Balance de ALIADOS en PAX (trueque): a quién le debes pax y quién te debe pax, más ventas convertidas. Úsalo para preguntas sobre aliados/pases.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "consultar_kpis_dia",
    description: "KPIs de operaciones de un día: pax total, ingresos del operador, deuda de comisionados, caja efectivo/transferencia. Úsalo para '¿cómo va el día?' o cifras del día. OJO: 'no hay operaciones' ≠ 'un contacto no mandó pax'.",
    input_schema: { type: "object", properties: { fecha: { type: "string", description: "YYYY-MM-DD; omite para hoy" } }, required: [] },
  },
  {
    name: "consultar_contacto",
    description: "Datos de un contacto AGENCIA por nombre: cuánto te debe (te_debe), cuánto le debes, cobrado, y su LISTA DE MOVIMIENTOS con fecha (YYYY-MM-DD), pax, tipo y monto. Úsalo para '¿cuánto me debe X?', '¿cuántos pax mandó X ayer / el día tal?', historial de un contacto. Filtra tú la lista por la fecha que pregunten.",
    input_schema: { type: "object", properties: { nombre: { type: "string", description: "nombre del contacto (agencia), aunque sea parcial" } }, required: ["nombre"] },
  },
  {
    name: "consultar_aliado",
    description: "Datos de un ALIADO por nombre (trueque en PAX): cuántos pax te debe / le debes. Úsalo para preguntas de aliados/pases por nombre.",
    input_schema: { type: "object", properties: { nombre: { type: "string", description: "nombre del aliado, aunque sea parcial" } }, required: ["nombre"] },
  },
  {
    name: "consultar_reparaciones",
    description: "Log de reparaciones/cambios del sistema (modo programador): qué se reparó, causa, fix, versión, severidad. Úsalo para '¿qué se cambió?', '¿este error ya lo tuvimos?', historial técnico.",
    input_schema: { type: "object", properties: { limite: { type: "number", description: "cuántas mostrar (default 40)" } }, required: [] },
  },
  {
    name: "consultar_catalogo",
    description: "Mapa/estructura del sistema (modo programador): qué RPCs, tablas, vistas y Edge Functions existen, para qué sirven, su gate de seguridad, quién las usa y su estado (activo / sin_consumidor / deprecado). Úsalo para '¿qué hace X?', '¿dónde está el log de Y?', '¿qué está sin uso?', '¿qué toca la tabla Z?'. Filtra por estado si preguntan por lo deprecado/sin uso.",
    input_schema: { type: "object", properties: { estado: { type: "string", description: "opcional: activo | sin_consumidor | deprecado" } }, required: [] },
  },
  {
    name: "consultar_eventos",
    description: "Log de eventos/errores en vivo del sistema (modo programador). Úsalo para '¿qué errores hubo?', '¿algo falló hoy?'. Puedes filtrar por tipo (error/info/accion).",
    input_schema: { type: "object", properties: { tipo: { type: "string", description: "opcional: error | info | accion" }, limite: { type: "number" } }, required: [] },
  },
  {
    name: "proponer_accion",
    description: "Propone una acción que MODIFICA datos (el usuario la confirmará en pantalla antes de ejecutarse). NO la ejecutes tú; solo propón con params completos. Acciones válidas: 'registrar_pago' (cobro/pago; params: id_movimiento, id_contacto, monto, metodo_pago, categoria='Cobro' o 'Pago Agencia'), 'actualizar_contacto' (cambiar precio; params: id, precio), 'crear_contacto_multi' (nuevo contacto; params: nombre, items=[{tipo,precio}]), 'actualizar_adicionales' (extras de un movimiento; params: id_mov, adicionales objeto {clave:monto}), 'fusionar_contactos' (unir dos contactos DEL MISMO TIPO que son el mismo; params: origen=id a absorber/borrar, destino=id que se conserva; repunta movimientos/caja). Si te faltan datos (ej. el id del movimiento o los ids de contacto), pídelos antes de proponer.",
    input_schema: {
      type: "object",
      properties: {
        accion: { type: "string", description: "registrar_pago | actualizar_contacto" },
        params: { type: "object", description: "parámetros de la acción" },
        descripcion: { type: "string", description: "explicación humana y clara de lo que se hará, con montos y nombres" },
      },
      required: ["accion", "params", "descripcion"],
    },
  },
];

async function callRpc(fn: string, params: Record<string, unknown>, userToken: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, authorization: `Bearer ${userToken}`, "content-type": "application/json" },
    body: JSON.stringify(params || {}),
  });
  const txt = await r.text();
  if (!r.ok) return { _error: true, status: r.status, detalle: txt.slice(0, 300) };
  try { return JSON.parse(txt); } catch { return txt; }
}

async function runReadTool(name: string, input: Record<string, unknown>, userToken: string) {
  if (name === "consultar_balance_agencias") return await callRpc("get_balance_agencias", { p_desde: null, p_hasta: null }, userToken);
  if (name === "consultar_balance_aliados") return await callRpc("get_balance_aliados", {}, userToken);
  if (name === "consultar_kpis_dia") return await callRpc("get_kpis_ops", { p_fecha: (input?.fecha as string) || null }, userToken);
  if (name === "consultar_contacto") {
    const nom = String(input?.nombre || "").toLowerCase().trim();
    if (!nom) return { encontrado: false, nota: "falta el nombre" };
    const bal = await callRpc("get_balance_agencias", { p_desde: null, p_hasta: null }, userToken) as { agencias?: Array<Record<string, unknown>> };
    const ags = bal?.agencias || [];
    const found = ags.find((a) => String(a.nombre || "").toLowerCase().includes(nom));
    if (!found) return { encontrado: false, nota: "No hay una agencia con ese nombre y saldo. Verifica el nombre exacto; puede ser un aliado/comisionado (aún no tengo herramienta para esos) o no tener movimientos con dinero." };
    const movsRaw = (found.movimientos as Array<Record<string, unknown>>) || [];
    // solo lo esencial, ordenado por fecha desc, hasta 60 movimientos
    const movs = movsRaw.map((m) => ({ fecha: m.fecha, pax: m.pax, tipo: m.tipo, monto: m.monto, cobrado: m.cobrado })).slice(0, 60);
    return { encontrado: true, nombre: found.nombre, te_debe: found.te_debe, le_debo: found.le_debo, cobrado: found.cobrado, total_movimientos: movsRaw.length, movimientos: movs };
  }
  if (name === "consultar_aliado") {
    const nom = String(input?.nombre || "").toLowerCase().trim();
    if (!nom) return { encontrado: false, nota: "falta el nombre" };
    const bal = await callRpc("get_balance_aliados", {}, userToken) as { aliados?: Array<Record<string, unknown>> };
    const found = (bal?.aliados || []).find((a) => String(a.nombre || "").toLowerCase().includes(nom));
    if (!found) return { encontrado: false, nota: "No hay un aliado con ese nombre y saldo de pax." };
    return { encontrado: true, ...found };
  }
  if (name === "consultar_reparaciones") return await callRpc("listar_reparaciones", { p_limite: Number(input?.limite) || 40 }, userToken);
  if (name === "consultar_catalogo") return await callRpc("listar_catalogo", { p_estado: (input?.estado as string) || null }, userToken);
  if (name === "consultar_eventos") return await callRpc("listar_eventos", { p_tipo: (input?.tipo as string) || null, p_limite: Number(input?.limite) || 30 }, userToken);
  return { _error: true, motivo: "herramienta_desconocida" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return j({ ok: false, motivo: "metodo" }, 405);

  // sesión real (rol authenticated)
  const authz = req.headers.get("authorization") || "";
  const userToken = authz.replace(/^Bearer\s+/i, "");
  try {
    const seg = (userToken.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(seg));
    if (payload.role !== "authenticated") return j({ ok: false, motivo: "requiere_sesion" }, 403);
  } catch { return j({ ok: false, motivo: "sin_sesion" }, 401); }

  const KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!KEY) return j({ ok: false, motivo: "sin_config" }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* noop */ }
  // historial de la conversación: [{role:'user'|'assistant', content:'...'}]
  const historial = Array.isArray(body.messages) ? body.messages as Array<{ role: string; content: unknown }> : [];
  if (!historial.length) return j({ ok: false, motivo: "sin_mensajes" }, 400);

  // messages para Anthropic (formato content-blocks se arma sobre la marcha)
  const messages: Array<{ role: string; content: unknown }> = historial.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content ?? "") }));

  // FECHA REAL (America/Lima) inyectada al prompt → JADE nunca adivina el día.
  const now = new Date();
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const hoyLima = fmt(now);
  const diaSem = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", weekday: "long" }).format(now);
  const ayerLima = (() => { const d = new Date(hoyLima + "T12:00:00-05:00"); d.setDate(d.getDate() - 1); return fmt(d); })();
  const fechaLinea = `\n\n## FECHA ACTUAL (real, úsala SIEMPRE — no la inventes)\nHoy es ${hoyLima} (${diaSem}) en America/Lima. Ayer fue ${ayerLima}. Toda referencia a 'hoy', 'ayer', 'esta semana' parte de aquí.`;

  const anthropicCall = async () => {
    for (let intento = 0; intento < 2; intento++) {
      const r = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: SYSTEM + fechaLinea, tools: TOOLS, messages }),
      });
      if (r.status === 429 || r.status >= 500) { if (intento === 0) { await new Promise((x) => setTimeout(x, 1100)); continue; } return { _err: r.status }; }
      if (r.status === 401 || r.status === 403) return { _err: "key" };
      if (!r.ok) return { _err: r.status, detalle: (await r.text().catch(() => "")).slice(0, 200) };
      return await r.json();
    }
    return { _err: "retry" };
  };

  // Bucle agéntico: Claude puede pedir herramientas de lectura; las ejecutamos y volvemos.
  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    const resp = await anthropicCall();
    if ((resp as { _err?: unknown })._err) return j({ ok: false, motivo: "api", detalle: (resp as { _err?: unknown })._err }, 502);
    const content = (resp as { content?: Array<Record<string, unknown>> }).content || [];
    const toolUses = content.filter((c) => c.type === "tool_use");
    const textBlocks = content.filter((c) => c.type === "text").map((c) => String(c.text || "")).join("\n").trim();

    if (!toolUses.length) {
      // respuesta final de texto
      return j({ ok: true, reply: textBlocks || "…" });
    }

    // ¿propone una acción de escritura? → devolvemos la propuesta al widget (no ejecutamos)
    const propuesta = toolUses.find((t) => t.name === "proponer_accion");
    if (propuesta) {
      const inp = (propuesta.input || {}) as Record<string, unknown>;
      return j({ ok: true, reply: textBlocks, propuesta: { accion: inp.accion, params: inp.params, descripcion: inp.descripcion } });
    }

    // ejecutar herramientas de LECTURA y devolver resultados a Claude
    messages.push({ role: "assistant", content });
    const results: Array<Record<string, unknown>> = [];
    for (const t of toolUses) {
      const out = await runReadTool(String(t.name), (t.input || {}) as Record<string, unknown>, userToken);
      results.push({ type: "tool_result", tool_use_id: t.id, content: JSON.stringify(out).slice(0, 12000) });
    }
    messages.push({ role: "user", content: results });
  }

  return j({ ok: true, reply: "Disculpa, me enredé consultando los datos. ¿Puedes reformular la pregunta?" });
});
