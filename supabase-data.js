// ============================================================
// OperacionesPS · capa de datos Supabase (camino B)
// Reemplaza las llamadas fetch(GAS_URL). Cargar DESPUÉS del UMD de supabase-js:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="supabase-data.js"></script>
// Expone window.SupaAPI con la MISMA forma de respuesta que el backend GAS
// ({ status:'success'|'error', message, ... }) para minimizar cambios en app.js.
// ============================================================
(function () {
  const SUPABASE_URL = 'https://lintmcxqxnrholslatul.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_9dpGbh-aKwTxC8gvOk8Muw_aSpMby0G';
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: true, autoRefreshToken: true, storageKey: 'ops_ps_auth',
      // lock passthrough: evita el cuelgue de supabase-js con navigator.locks
      lock: (name, acquireTimeout, fn) => fn()
    }
  });
  // fetch directo a PostgREST (sin pasar por el cliente) — para llamadas anon
  // (lista de login, estado de app) que deben funcionar sí o sí, sin auth-init.
  async function restRpc(fn, body, token) {
    const headers = { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);   // nunca colgar infinito
    try {
      const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify(body || {}), signal: ctrl.signal });
      if (!r.ok) { let m = 'Error'; try { m = (await r.json()).message || m; } catch (e) {} throw new Error(m); }
      const txt = await r.text(); return txt ? JSON.parse(txt) : null;
    } finally { clearTimeout(tid); }
  }

  const ok  = (extra) => Object.assign({ status: 'success' }, extra || {});
  const err = (e)     => ({ status: 'error', message: (e && e.message) || String(e) || 'Error' });
  // "muelle:10,adulto:22" -> { muelle:10, adulto:22 }  (para actualizar_adicionales)
  const adicToObj = (s) => {
    const o = {}; if (!s) return o;
    String(s).split(',').forEach(p => { const i = p.indexOf(':'); if (i > 0) { const k = p.slice(0, i).trim().toLowerCase(); const v = parseFloat(p.slice(i + 1)); if (k && !isNaN(v)) o[k] = v; } });
    return o;
  };
  // TODO el data path va por fetch directo a PostgREST (con el token de sesión),
  // NO por sb.rpc — el cliente supabase-js se cuelga en algunos navegadores.
  // El cliente queda SOLO para auth (signIn/getSession/signOut).
  const rpc = async (fn, args) => {
    let token;
    try { const { data } = await sb.auth.getSession(); token = data && data.session && data.session.access_token; } catch (e) {}
    return restRpc(fn, args, token);
  };

  // ── AUTH ────────────────────────────────────────────────────
  async function listarOperadores() {
    try { return ok({ operadores: (await restRpc('listar_operadores')) || [] }); }
    catch (e) { return err(e); }
  }
  // login por PIN: el operador elige su nombre (con su id EMP-xx) y teclea el PIN
  async function login(empId, pin) {
    const email = String(empId).toLowerCase() + '@paracas.local';
    const { data, error } = await sb.auth.signInWithPassword({ email, password: String(pin) });
    if (error) return { status: 'error', message: 'PIN incorrecto' };
    const rol = data.user?.user_metadata?.rol || 'Operador';
    return ok({ id: empId, nombre: data.user?.user_metadata?.nombre, rol });
  }
  async function logout() { await sb.auth.signOut(); return ok(); }
  async function sesion() { const { data } = await sb.auth.getSession(); return data.session || null; }
  // estado/horario de la app (controlado desde PS). Callable sin login (anon, fetch directo).
  async function estadoApp() {
    try { return await restRpc('get_app_estado', { p_app: 'operacionesps' }); }
    catch (e) { return { existe: false, abierta_ahora: true }; }   // ante fallo, no bloquear
  }

  // ── LECTURAS ────────────────────────────────────────────────
  async function getDashboardData() {
    try { return await rpc('get_dashboard'); }   // ya viene con la forma exacta del GAS
    // status:'error' → app.js toma su rama limpia (_forceRenderEmpty) en vez de
    // seguir con campos undefined y reventar en renderCatalogos.
    catch (e) { return { status: 'error', error: (e && e.message) || 'Error' }; }
  }
  async function getPersonal() {
    // El login se puebla ANTES de autenticarse → usar el RPC anon-callable
    // (la tabla `personal` está bajo RLS y devolvería vacío sin sesión).
    try {
      const ops = (await restRpc('listar_operadores')) || [];
      const operadores = ops.map(o => ({ id: o.id, nombre: o.nombre }));
      const personal   = ops.map(o => ({ id_empleado: o.id, nombre: o.nombre, rol: 'Operador' }));
      return { operadores, personal };
    } catch (e) { return { operadores: [], personal: [] }; }
  }

  // ── STORAGE (fotos / cierres) ───────────────────────────────
  function dataUrlToBlob(d) {
    const m = /^data:(.+?);base64,(.*)$/.exec(d || '');
    const mime = m ? m[1] : 'image/jpeg'; const b64 = m ? m[2] : (d || '').replace(/^data:image\/\w+;base64,/, '');
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }
  async function subirArchivo(path, blob, contentType) {
    const { error } = await sb.storage.from('operaciones').upload(path, blob, { upsert: true, contentType });
    if (error) throw error;
    return sb.storage.from('operaciones').getPublicUrl(path).data.publicUrl;
  }
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

  // ── ESCRITURAS: action -> RPC (payload GAS -> params RPC) ────
  const handlers = {
    nueva_reserva: async p => ({ id_reserva: await rpc('crear_reserva', {
      p_fecha: p.fecha, p_hora: p.hora || null, p_contacto: p.id_contacto || null,
      p_cliente: p.cliente || null, p_pax: parseInt(p.cant_pax) || 0, p_monto: parseFloat(p.monto) || 0, p_creador: p.creador || 'App',
      p_local_id: p.localId || null }),
      message: '✅ Reserva originada con éxito.' }),

    registrar_movimiento_pax: async p => ({ id_mov: await rpc('registrar_movimiento', {
      p_op: p.id_operacion, p_tipo: p.tipo, p_contacto: p.id_contacto || p.contacto || null,
      p_nombre: p.nombre_contacto || p.contacto || null, p_pax: parseInt(p.pax) || 0,
      p_precio: parseFloat(p.precio_unitario) || 0, p_monto: parseFloat(p.monto_total) || 0, p_operador: p.creador || 'App',
      p_local_id: p.localId || null }),
      message: '✅ Abordaje directo registrado en Manifiesto.' }),

    editar_movimiento_pax: async p => ({ id_mov: await rpc('editar_movimiento', {
      p_id: p.id_mov, p_op: p.id_operacion, p_tipo: p.tipo, p_contacto: p.id_contacto || p.contacto || null,
      p_nombre: p.nombre_contacto || p.contacto || null, p_pax: parseInt(p.pax) || 0,
      p_precio: parseFloat(p.precio_unitario) || 0, p_monto: parseFloat(p.monto_total) || 0 }),
      message: '✅ Registro actualizado.' }),

    registrar_caja:        p => handlers.registrar_transaccion(p),
    registrar_caja_v2:     p => handlers.registrar_transaccion(p),
    registrar_transaccion: async p => {
      let fotoUrl = '';
      if (p.foto_base64) fotoUrl = await subirArchivo('comprobantes/' + stamp() + '.jpg', dataUrlToBlob(p.foto_base64), 'image/jpeg');
      const id = await rpc('registrar_transaccion', {
        p_op: p.id_operacion || null, p_contacto: p.id_contacto || null, p_categoria: p.categoria || 'Cobro',
        p_monto: parseFloat(p.monto) || 0, p_metodo: p.metodo_pago || 'Efectivo', p_comentarios: p.comentarios || null,
        p_foto_url: fotoUrl || null, p_operador: p.operador || '', p_mov: p.id_movimiento || null, p_local_id: p.localId || null });
      return { id_transaccion: id, foto_url: fotoUrl, message: '✅ Transacción registrada.' };
    },

    cerrar_operacion: async p => {
      const total = await rpc('cerrar_operacion', { p_op: p.id_operacion, p_foto_url: p.foto_zarpe_url || null });
      return { message: '✅ Operación cerrada correctamente.', liquidacion: { total_a_entregar: Number(total) || 0 } };
    },

    abrir_operacion: async p => ({ message: '✅ Operación abierta con éxito.', id_operacion: await rpc('abrir_operacion', {
      p_bote: p.id_bote, p_capitan: p.id_capitan || null, p_guia: p.id_guia || null,
      p_hora: p.hora_salida || null, p_destino: p.destino || null, p_creador: p.creador || 'App', p_local_id: p.localId || null }) }),

    asignar_reserva: async p => ({ message: '✅ Pasajeros asignados al Bote.', id_mov: await rpc('asignar_reserva', {
      p_reserva: p.id_reserva, p_op: p.id_operacion, p_tipo: p.tipo || 'Agencia', p_contacto: p.id_contacto || null,
      p_nombre: p.nombre_contacto || p.id_contacto || null, p_pax: parseInt(p.cant_pax) || 0,
      p_precio: parseFloat(p.precio_unitario) || 0, p_monto: parseFloat(p.monto_total) || 0, p_creador: p.creador || 'App', p_local_id: p.localId || null }) }),

    zarpar_operacion:  async p => { await rpc('zarpar_operacion', { p_op: p.id_operacion }); return { message: '✅ Lancha Zarpada con éxito.' }; },
    confirmar_llegada: async p => { await rpc('confirmar_llegada', { p_op: p.id_operacion }); return { message: '✅ Llegada confirmada. Recursos liberados.' }; },
    anular_operacion:  async p => { await rpc('anular_operacion', { p_op: p.id_operacion }); return { message: '✅ Operación anulada correctamente.' }; },

    derivar_pase: async p => { await rpc('derivar_pase', { p_mov: p.id_mov, p_aliado: p.aliado_id || p.aliado, p_operador: p.operador || 'App' });
      return { message: '✅ Pasajeros transferidos a ' + (p.aliado || '') + '.' }; },

    anular_pase: async p => ({ message: '✅ Pase anulado.', tipo: await rpc('anular_pase', { p_mov: p.id_mov, p_op_nueva: p.id_operacion_nueva }) }),

    convertir_pase_a_compra: async p => { await rpc('convertir_pase_compra', { p_mov: p.id_mov, p_agencia: p.id_agencia, p_monto: parseFloat(p.monto) || 0 });
      return { message: '✅ Pase convertido a compra con ' + (p.nombre_agencia || p.id_agencia) + '.' }; },

    eliminar_movimiento:  async p => { await rpc('eliminar_movimiento', { p_mov: p.id_mov }); return { message: '🗑️ Movimiento cancelado.' }; },
    eliminar_transaccion: async p => { await rpc('eliminar_transaccion', { p_id: p.id_transaccion }); return { message: '🗑️ Transacción eliminada.' }; },

    actualizar_adicionales: async p => { await rpc('actualizar_adicionales', { p_mov: p.id_mov, p_adic: adicToObj(p.adicionales) });
      return { message: '✅ Impuestos registrados.' }; },

    pase_desde_reserva: async p => ({ message: '✅ Pase registrado correctamente.', id_mov: await rpc('pase_desde_reserva', {
      p_reserva: p.id_reserva, p_contacto_orig: p.id_contacto_original || null, p_nombre_orig: p.nombre_contacto_original || null,
      p_aliado: p.aliado_id || p.aliado, p_pax: parseInt(p.cant_pax) || 0,
      p_precio: parseFloat(p.precio_unitario) || 0, p_monto: parseFloat(p.monto_total) || 0, p_creador: p.creador || 'App', p_local_id: p.localId || null }) }),

    editar_operacion: async p => { await rpc('editar_operacion', {
      p_op: p.id_operacion, p_capitan: p.id_capitan ?? null, p_guia: p.id_guia ?? null, p_hora: p.hora_salida ?? null });
      return { message: '✅ Operación actualizada.' }; },

    subir_foto_zarpe: async p => {
      const url = await subirArchivo('zarpes/' + (p.id_operacion || 'OP') + '_' + stamp() + '.jpg', dataUrlToBlob(p.foto_base64), 'image/jpeg');
      await rpc('set_foto_zarpe', { p_op: p.id_operacion, p_url: url });
      return { message: '✅ Foto guardada.', url };
    },

    guardar_cierre: async p => {
      const url = await subirArchivo('cierres/' + (p.nombre || 'Cierre ' + stamp()) + '.html', new Blob([p.html], { type: 'text/html' }), 'text/html');
      return { url, nombre: p.nombre };
    },

    emitir_comprobante: async p => await rpc('emitir_comprobante', {
      p_tipo: p.tipo, p_serie: p.serie, p_cliente_doc_tipo: p.cliente_doc_tipo || null, p_cliente_doc: p.cliente_doc || null,
      p_cliente_nombre: p.cliente_nombre, p_cliente_email: p.cliente_email || null, p_items: p.items || [],
      p_exonerado: !!p.exonerado, p_moneda: 'PEN', p_origen: 'muelle', p_creado_por: p.operador || 'App',
      p_local_id: p.localId || null, p_cliente_tel: p.cliente_tel || null })
  };

  // lecturas de facturación (toggle + catálogo) para el muelle
  async function facturacionMuelle() { try { return !!(await rpc('get_facturacion_muelle')); } catch (e) { return false; } }
  async function listarServiciosFac() { try { return (await rpc('listar_servicios')) || []; } catch (e) { return []; } }
  async function consultarDocumento(numero, tipo) { try { return await rpc('consultar_documento', { p_numero: numero, p_tipo: tipo || null }); } catch (e) { return { ok: false, motivo: 'error' }; } }
  async function facturacionConfig() { try { return (await rpc('get_facturacion_config')) || {}; } catch (e) { return {}; } }
  async function facturacionBootstrap() { try { return (await rpc('get_facturacion_bootstrap')) || {}; } catch (e) { return {}; } }
  async function buscarContactosFac(q) { try { return (await rpc('buscar_contactos_fac', { p_q: q })) || []; } catch (e) { return []; } }
  async function listarComprobantesDia(usuario) { try { return (await rpc('listar_comprobantes_dia', { p_usuario: usuario || null })) || []; } catch (e) { return []; } }
  async function solicitarAnulacion(id, motivo, por) { try { return await rpc('solicitar_anulacion', { p_id: id, p_motivo: motivo, p_por: por || null }); } catch (e) { return { ok: false, message: e.message }; } }

  async function post(action, payload) {
    const h = handlers[action];
    if (!h) return { status: 'error', message: 'Acción desconocida: ' + action };
    try { return ok(await h(payload || {})); }
    catch (e) { return err(e); }
  }

  window.SupaAPI = { sb, listarOperadores, login, logout, sesion, estadoApp, getDashboardData, getPersonal, post, facturacionMuelle, listarServiciosFac, consultarDocumento, facturacionConfig, facturacionBootstrap, buscarContactosFac, listarComprobantesDia, solicitarAnulacion };
})();
