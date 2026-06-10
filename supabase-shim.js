// ============================================================
// OperacionesPS · shim de cutover a Supabase (camino B)
// Cargar en index.html en este orden, ANTES de app.js:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="supabase-data.js"></script>
//   <script src="supabase-shim.js"></script>
//   <script src="app.js"></script>
//
// Con USE_SUPABASE=false NO cambia NADA (la app sigue hablando con GAS).
// Con true: (1) reenruta las llamadas fetch(GAS_URL ...) a window.SupaAPI sin
// tocar los call-sites de app.js; (2) exige PIN al elegir operador (login real
// contra Supabase Auth). Probar en navegador antes de dejarlo en true en prod.
// ============================================================
(function () {
  const USE_SUPABASE = true;    // cutover activo (datos + login + horario via Supabase)
  if (!USE_SUPABASE) { window.__SUPA_CUTOVER__ = false; return; }
  window.__SUPA_CUTOVER__ = true;

  const _jsonResp = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const _gas = () => (typeof GAS_URL !== 'undefined' ? GAS_URL : (window.GAS_URL || ''));

  // ── (1) reenrutado de fetch(GAS_URL ...) -> SupaAPI ──────────
  const _origFetch = window.fetch.bind(window);
  window.fetch = async function (url, opts) {
    try {
      const gas = _gas();
      if (gas && typeof url === 'string' && url.indexOf(gas) === 0) {
        const method = ((opts && opts.method) || 'GET').toUpperCase();
        if (method === 'GET') {
          const action = (new URL(url)).searchParams.get('action') || 'getDashboardData';
          if (action === 'getPersonal') return _jsonResp(await window.SupaAPI.getPersonal());
          return _jsonResp(await window.SupaAPI.getDashboardData());
        }
        const parsed = JSON.parse((opts && opts.body) || '{}');
        return _jsonResp(await window.SupaAPI.post(parsed.action, parsed.payload));
      }
    } catch (e) { return _jsonResp({ status: 'error', message: (e && e.message) || 'Error' }); }
    return _origFetch(url, opts);
  };

  // ── (1b) horario/estado de la app desde Supabase (reemplaza el lock 8 PM) ──
  // Desactiva el lock horario hardcodeado de app.js; ahora manda app_config (editable desde PS).
  // OJO: hay que reasignar DENTRO de un listener DOMContentLoaded — la *declaración*
  // `function isJornadaCerrada()` de app.js (que carga después) pisa cualquier asignación
  // hecha en el top-level del shim. Este listener se registra antes que el de app.js → corre antes.
  window.addEventListener('DOMContentLoaded', function () { window.isJornadaCerrada = function () { return false; }; });
  async function gateHorario() {
    try {
      const e = await window.SupaAPI.estadoApp();
      const ol = document.getElementById('lock-overlay');
      if (!e || e.abierta_ahora) { if (ol) ol.classList.remove('active'); return true; }
      // cerrada / fuera de horario → mostrar lock con el mensaje configurado
      if (typeof activarLock === 'function') activarLock();
      else if (ol) ol.classList.add('active');
      const fd = document.getElementById('lock-fecha');
      if (fd) {
        const txt = e.estado === 'mantenimiento' ? 'En mantenimiento'
          : e.mensaje ? e.mensaje
          : (e.hora_apertura && e.hora_cierre) ? ('Horario: ' + e.hora_apertura + ' a ' + e.hora_cierre) : 'Cerrado';
        fd.textContent = txt;
      }
      return false;
    } catch (err) { return true; }   // ante error, no bloquear
  }
  window.addEventListener('DOMContentLoaded', gateHorario);

  // ── AUTODIAGNÓSTICO visible (en el tag de versión) ───────────
  // Muestra dónde se rompe: SupaAPI cargado? operadores llegan? error?
  window.addEventListener('DOMContentLoaded', async function () {
    const tag = document.getElementById('ver-tag');
    const ver = (typeof OPS_VERSION !== 'undefined') ? OPS_VERSION : 'v?';
    const set = (s) => { if (tag) tag.textContent = ver + ' ' + s; };
    if (!window.SupaAPI) { set('SupaAPI:NO'); return; }
    set('cargando…');
    try {
      const r = await window.SupaAPI.listarOperadores();
      const n = (r && r.operadores && r.operadores.length) || 0;
      set('ops:' + n + (r && r.status === 'success' ? '' : ' (' + ((r && r.message) || '?') + ')'));
    } catch (e) { set('ERR:' + ((e && e.message) || 'x').slice(0, 24)); }
  });

  // ── (1c) forzar login si no hay sesión Supabase ──────────────
  // app.js restaura el operador guardado (sot_operador) del login viejo por-nombre
  // y se SALTA el modal → nunca se abre sesión Supabase → todos los RPCs dan NO_AUTH
  // y el muelle queda "cargando" para siempre. Si no hay sesión, limpiamos el
  // operador rancio y abrimos el login (que ahora pide PIN).
  window.addEventListener('DOMContentLoaded', async function () {
    try {
      const s = await window.SupaAPI.sesion();
      if (!s) {
        try { localStorage.removeItem('sot_operador'); } catch (e) {}
        if (typeof window.myOpName !== 'undefined') window.myOpName = null;
        if (typeof mostrarModalLogin === 'function') mostrarModalLogin(false);
      }
    } catch (e) {}
  });

  // ── (2) login con PIN al elegir operador ─────────────────────
  function pedirPin(nombre) {
    return new Promise((resolve) => {
      let ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:99999';
      ov.innerHTML =
        '<div style="background:#0f172a;border:1px solid rgba(255,255,255,.15);border-radius:18px;padding:22px;width:min(92vw,340px);color:#fff;font-family:inherit;text-align:center">' +
        '<div style="font-weight:800;font-size:1.05rem;margin-bottom:4px">Hola, ' + nombre + '</div>' +
        '<div style="opacity:.7;font-size:.85rem;margin-bottom:14px">Ingresa tu PIN</div>' +
        '<input id="_pin_in" type="tel" inputmode="numeric" autocomplete="off" maxlength="8" ' +
        'style="width:100%;text-align:center;font-size:1.6rem;letter-spacing:.4em;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#fff;margin-bottom:6px">' +
        '<div id="_pin_err" style="color:#f87171;font-size:.8rem;height:1.1em;margin-bottom:10px"></div>' +
        '<div style="display:flex;gap:8px">' +
        '<button id="_pin_x" style="flex:1;padding:11px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff;font-weight:700">Cancelar</button>' +
        '<button id="_pin_ok" style="flex:2;padding:11px;border-radius:12px;border:0;background:#22c55e;color:#06270f;font-weight:800">Entrar</button>' +
        '</div></div>';
      document.body.appendChild(ov);
      const inp = ov.querySelector('#_pin_in'); const errEl = ov.querySelector('#_pin_err');
      setTimeout(() => inp.focus(), 50);
      const close = (v) => { ov.remove(); resolve(v); };
      ov.querySelector('#_pin_x').onclick = () => close(null);
      const submit = () => { const v = inp.value.trim(); if (!v) { errEl.textContent = 'Escribe tu PIN'; return; } close(v); };
      ov.querySelector('#_pin_ok').onclick = submit;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    const orig = window.seleccionarOperador;
    if (typeof orig !== 'function') return;
    window.seleccionarOperador = async function (nombre) {
      const ops = (window.catalogosData && window.catalogosData.operadores) || [];
      const op = ops.find(o => o.nombre === nombre);
      const empId = (op && op.id) || nombre;
      const pin = await pedirPin(nombre);
      if (pin === null) return;                       // canceló
      const r = await window.SupaAPI.login(empId, pin);
      if (!r || r.status !== 'success') {
        if (typeof mostrarToast === 'function') mostrarToast('❌ PIN incorrecto', 'error');
        return window.seleccionarOperador(nombre);    // reintentar
      }
      orig(nombre);                                   // completa el login local (myOpName, toast, etc.)
      gateHorario();                                   // re-evalúa estado/horario tras entrar
      if (typeof fetchDashboardData === 'function') fetchDashboardData();  // poblar el dashboard ya (no esperar al poll)
    };
  });

  // al cerrar sesión local, cerrar también la de Supabase
  window.addEventListener('DOMContentLoaded', function () {
    const origOut = window.cerrarSesion || window.logout;
    if (typeof origOut === 'function') {
      const name = window.cerrarSesion ? 'cerrarSesion' : 'logout';
      window[name] = function () { try { window.SupaAPI.logout(); } catch (e) {} return origOut.apply(this, arguments); };
    }
  });
})();
