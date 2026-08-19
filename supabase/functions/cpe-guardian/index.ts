// Edge Function `cpe-guardian` — el GUARDIÁN de comprobantes (cero GAS).
// Lo dispara pg_cron cada hora (tras el reconciliador). Pide a la base los avisos NUEVOS
// (`cpe_avisos_pendientes`: rechazos de NubeFact, SUNAT sin confirmar pasado el plazo prudente,
// bajas sin resolver, emisiones sin respuesta), manda UN push resumen a cada dispositivo de los
// admins del panel (Web Push estándar / VAPID, sin Firebase) y marca los avisos como notificados
// para no repetir el mismo push cada hora. La lista viva con el motivo de cada uno la muestra el
// panel en la balanza (RPC `cpe_guardian`).
//
// AUTORIZACIÓN: solo service_role (lo llama el cron con la service key). Un JWT de usuario o la
// anon key se rechazan.
// SECRETS: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:), SUPABASE_URL,
//          SUPABASE_SERVICE_ROLE_KEY (estos dos los inyecta la plataforma).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (p: unknown, s = 200) => new Response(JSON.stringify(p), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
function claims(tok: string): Record<string, unknown> | null {
  try { const b = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(b.padEnd(Math.ceil(b.length / 4) * 4, '='))); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const cl = claims(auth);
  if (!cl || cl.role !== 'service_role') return json({ ok: false, error: 'solo service_role' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!, key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(url, key);
  const pub = Deno.env.get('VAPID_PUBLIC_KEY') || '', priv = Deno.env.get('VAPID_PRIVATE_KEY') || '';
  if (!pub || !priv) return json({ ok: false, error: 'faltan VAPID keys' }, 500);
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:soporte@paracas.local', pub, priv);

  let body: { modo?: string; prueba?: boolean } = {};
  try { body = await req.json(); } catch { /* sin body = corrida normal */ }

  // 1) ¿qué hay nuevo que avisar?
  const { data: pend, error: e1 } = await sb.rpc('cpe_avisos_pendientes');
  if (e1) return json({ ok: false, error: 'pendientes: ' + e1.message }, 500);
  const avisos: any[] = Array.isArray(pend) ? pend : [];

  // Modo prueba (dueño): manda un push de verificación aunque no haya nada nuevo.
  const esPrueba = !!body.prueba;
  if (!avisos.length && !esPrueba) return json({ ok: true, avisos: 0, enviados: 0, nota: 'nada nuevo' });

  // 2) UN resumen por dispositivo, priorizado (rechazos primero)
  const n = (c: string) => avisos.filter(a => a.caso === c).length;
  const partes: string[] = [];
  if (n('nubefact_rechazo')) partes.push(`${n('nubefact_rechazo')} rechazado(s) por NubeFact`);
  if (n('sin_respuesta')) partes.push(`${n('sin_respuesta')} sin respuesta`);
  if (n('baja_sin_resolver')) partes.push(`${n('baja_sin_resolver')} anulación(es) sin confirmar`);
  if (n('sunat_pendiente')) partes.push(`${n('sunat_pendiente')} sin confirmación de SUNAT`);
  const primero = avisos[0];
  const titulo = esPrueba && !avisos.length ? '🧾 Guardián de comprobantes · prueba OK'
    : (n('nubefact_rechazo') ? '⚠️ Comprobante rechazado por NubeFact' : '⏳ Comprobantes por revisar');
  const cuerpo = esPrueba && !avisos.length ? 'El push del panel funciona. Cuando un CPE no sea aceptado, te avisaré por aquí.'
    : partes.join(' · ') + (primero ? `\n${primero.serie}-${primero.numero}: ${String(primero.errores || primero.explicacion || '').slice(0, 90)}` : '');
  const payload = JSON.stringify({ title: titulo, body: cuerpo, tag: 'cpe-guardian', url: '/?fac=guardian',
    icon: 'https://levo19.github.io/PS-Panel/icon-192.png', badge: 'https://levo19.github.io/PS-Panel/icon-192.png', casos: partes });

  // 3) a cada dispositivo de los admins
  const { data: subs, error: e2 } = await sb.rpc('push_subs_admins');
  if (e2) return json({ ok: false, error: 'subs: ' + e2.message }, 500);
  let enviados = 0, muertos = 0; const detalle: any[] = [];
  for (const s of (Array.isArray(subs) ? subs : [])) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' });
      enviados++; await sb.rpc('push_marcar', { p_id: s.id, p_ok: true }); detalle.push({ id: s.id, ok: true });
    } catch (err: any) {
      const code = err && err.statusCode;
      muertos += (code === 404 || code === 410) ? 1 : 0;
      await sb.rpc('push_marcar', { p_id: s.id, p_ok: false });
      detalle.push({ id: s.id, ok: false, code, msg: String(err && err.message || err).slice(0, 80) });
    }
  }
  // 4) marcar como notificados SOLO si al menos un dispositivo lo recibió (si no, se reintenta la próxima hora)
  if (avisos.length && enviados > 0) await sb.rpc('cpe_avisos_marcar', { p: avisos.map(a => ({ id: a.id, caso: a.caso })) });
  return json({ ok: true, avisos: avisos.length, enviados, dispositivos: (subs || []).length, muertos, prueba: esPrueba, detalle });
});
