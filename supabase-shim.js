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

  // ════════════════════════════════════════════════════════════
  //  LOGIN MODERNO (selección de usuario + teclado PIN)
  //  Paleta guinda #56070c / dorado #e8b840. Sonidos + animaciones.
  // ════════════════════════════════════════════════════════════
  let origSeleccionar = null;

  // ── sonido (WebAudio, iOS-safe) ──
  let _ac;
  function ac() { try { if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)(); if (_ac.state === 'suspended') _ac.resume(); } catch (e) {} return _ac; }
  function beep(freq, dur, type, vol) {
    const a = ac(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.value = freq; o.connect(g); g.connect(a.destination);
    const t = a.currentTime; g.gain.setValueAtTime(vol || 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.12));
    o.start(t); o.stop(t + (dur || 0.12));
  }
  const sTap = () => beep(420, 0.05, 'sine', 0.035);
  const sOk  = () => { beep(680, 0.1, 'sine', 0.05); setTimeout(() => beep(1020, 0.16, 'sine', 0.05), 95); };
  const sErr = () => { beep(170, 0.22, 'square', 0.05); };
  const ini  = (n) => (n || '?').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  function injectCSS() {
    if (document.getElementById('sl-css')) return;
    const st = document.createElement('style'); st.id = 'sl-css';
    st.textContent = `
      #modal-login{display:none!important}
      .sl-ov{position:fixed;top:0;left:0;width:100%;height:100%;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
        background:radial-gradient(circle at 50% -8%,#6b0e12 0%,#2e0406 46%,#0a0608 100%);color:#fff;font-family:inherit;padding:max(34px,8vh) 18px 28px;overflow-y:auto;-webkit-overflow-scrolling:touch}
      .sl-ov.sl-hide{display:none}
      .sl-brand{width:76px;height:76px;border-radius:22px;margin-bottom:14px;box-shadow:0 10px 30px rgba(0,0,0,.55);display:block}
      .sl-logo{font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:#e8b840;font-weight:800;margin-bottom:6px;text-align:center}
      .sl-h{font-size:23px;font-weight:900;text-align:center;margin:0 0 3px}
      .sl-sub{font-size:13px;color:rgba(255,255,255,.6);text-align:center;margin-bottom:24px}
      .sl-last{display:flex;flex-direction:column;align-items:center;gap:9px;margin-bottom:8px;cursor:pointer;animation:slpop .4s ease}
      .sl-last .sl-av{width:92px;height:92px;font-size:33px;box-shadow:0 0 0 3px rgba(232,184,64,.5),0 10px 30px rgba(0,0,0,.5)}
      .sl-last .sl-nm{font-size:16px;font-weight:800}
      .sl-cont{font-size:11px;color:#e8b840;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
      .sl-div{display:flex;align-items:center;gap:10px;width:100%;max-width:380px;margin:18px 0 14px;color:rgba(255,255,255,.35);font-size:11px;text-transform:uppercase;letter-spacing:.1em}
      .sl-div::before,.sl-div::after{content:"";flex:1;height:1px;background:rgba(255,255,255,.12)}
      .sl-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;width:100%;max-width:380px}
      .sl-card{display:flex;flex-direction:column;align-items:center;gap:7px;padding:15px 6px;border-radius:18px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);cursor:pointer;transition:transform .12s,background .2s,border-color .2s}
      .sl-card:active{transform:scale(.92);background:rgba(232,184,64,.12);border-color:rgba(232,184,64,.4)}
      .sl-av{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:19px;background:linear-gradient(135deg,#a51d23,#56070c);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.45)}
      .sl-av.gold{background:linear-gradient(135deg,#f0c659,#c8920f);color:#2e0406}
      .sl-nm{font-size:12px;font-weight:700;text-align:center;line-height:1.2}
      .sl-pinwrap{display:flex;flex-direction:column;align-items:center;width:100%;max-width:330px;margin:0 auto;animation:slslide .35s ease}
      .sl-dots{display:flex;gap:15px;margin:20px 0 26px}
      .sl-dot{width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.3);transition:all .15s}
      .sl-dot.on{background:#e8b840;border-color:#e8b840;transform:scale(1.15);box-shadow:0 0 10px rgba(232,184,64,.6)}
      .sl-keys{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;width:100%}
      .sl-key{aspect-ratio:1;max-width:76px;width:100%;margin:0 auto;border-radius:50%;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;font-size:25px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .1s,background .15s;-webkit-tap-highlight-color:transparent;user-select:none}
      .sl-key:active{transform:scale(.88);background:rgba(232,184,64,.25)}
      .sl-key.sl-ghost{background:none;border:none;cursor:default}
      .sl-back{position:absolute;top:20px;left:18px;background:none;border:none;color:#fff;font-size:26px;cursor:pointer;opacity:.7;padding:6px}
      .sl-err{color:#fca5a5;font-size:13px;height:18px;margin-top:14px;font-weight:600}
      .sl-shake{animation:slshake .4s}
      .sl-okflash{animation:slok .5s ease}
      @keyframes slshake{0%,100%{transform:translateX(0)}20%{transform:translateX(-10px)}40%{transform:translateX(10px)}60%{transform:translateX(-7px)}80%{transform:translateX(7px)}}
      @keyframes slpop{from{transform:scale(.8);opacity:0}to{transform:scale(1);opacity:1}}
      @keyframes slslide{from{transform:translateX(28px);opacity:0}to{transform:translateX(0);opacity:1}}
      @keyframes slok{0%{box-shadow:0 0 0 0 rgba(74,222,128,0)}50%{box-shadow:0 0 0 14px rgba(74,222,128,.25)}100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}}
    `;
    document.head.appendChild(st);
  }

  let _ops = [], _sel = null, _pin = '', _busy = false;

  function ensureOverlay() {
    let ov = document.getElementById('sl-ov');
    if (!ov) { ov = document.createElement('div'); ov.id = 'sl-ov'; ov.className = 'sl-ov sl-hide'; document.body.appendChild(ov); }
    return ov;
  }
  const hideLogin = () => { const ov = document.getElementById('sl-ov'); if (ov) ov.classList.add('sl-hide'); };

  function renderPick() {
    _sel = null; _pin = '';
    const ov = ensureOverlay();
    const lastId = (() => { try { return localStorage.getItem('sot_last_op_id'); } catch (e) { return null; } })();
    const last = lastId ? _ops.find(o => o.id === lastId) : null;
    const others = last ? _ops.filter(o => o.id !== last.id) : _ops;
    let html = `<img class="sl-brand" src="icon.svg" alt="OPS">` +
               `<div class="sl-logo">Operaciones PS</div><div class="sl-h">¿Quién eres?</div><div class="sl-sub">Toca tu usuario para entrar</div>`;
    if (last) {
      html += `<div class="sl-last" data-id="${last.id}"><div class="sl-av gold">${ini(last.nombre)}</div><div class="sl-nm">${last.nombre}</div><div class="sl-cont">▸ Continuar</div></div>`;
      if (others.length) html += `<div class="sl-div">otros</div>`;
    }
    html += `<div class="sl-grid">` + others.map(o => `<div class="sl-card" data-id="${o.id}"><div class="sl-av">${ini(o.nombre)}</div><div class="sl-nm">${o.nombre}</div></div>`).join('') + `</div>`;
    ov.innerHTML = html;
    ov.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => { sTap(); pickUser(el.getAttribute('data-id')); }));
    ov.classList.remove('sl-hide');
  }

  function renderPin() {
    const ov = ensureOverlay();
    ov.innerHTML =
      `<button class="sl-back" id="sl-back">←</button>` +
      `<div style="margin-top:8px" class="sl-av gold">${ini(_sel.nombre)}</div>` +
      `<div class="sl-h" style="margin-top:12px">${_sel.nombre}</div>` +
      `<div class="sl-sub">Ingresa tu PIN</div>` +
      `<div class="sl-pinwrap"><div class="sl-dots" id="sl-dots">${[0,1,2,3].map(()=>'<div class="sl-dot"></div>').join('')}</div>` +
      `<div class="sl-keys">` + ['1','2','3','4','5','6','7','8','9'].map(d=>`<button class="sl-key" data-k="${d}">${d}</button>`).join('') +
      `<button class="sl-key sl-ghost"></button><button class="sl-key" data-k="0">0</button><button class="sl-key" data-k="del">⌫</button>` +
      `</div><div class="sl-err" id="sl-err"></div></div>`;
    ov.querySelector('#sl-back').addEventListener('click', () => { sTap(); renderPick(); });
    ov.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => keyPress(b.getAttribute('data-k'))));
    ov.classList.remove('sl-hide');
  }

  function pickUser(id) { _sel = _ops.find(o => o.id === id); if (!_sel) return; _pin = ''; renderPin(); }

  function paintDots(shake) {
    const dots = document.querySelectorAll('#sl-dots .sl-dot');
    dots.forEach((d, i) => d.classList.toggle('on', i < _pin.length));
    if (shake) { const w = document.getElementById('sl-dots'); if (w) { w.classList.add('sl-shake'); setTimeout(() => w.classList.remove('sl-shake'), 420); } }
  }

  async function keyPress(k) {
    if (_busy) return;
    if (k === 'del') { _pin = _pin.slice(0, -1); sTap(); paintDots(); return; }
    if (_pin.length >= 4) return;
    _pin += k; sTap(); paintDots();
    if (_pin.length === 4) { _busy = true; await submitPin(); _busy = false; }
  }

  async function submitPin() {
    const errEl = document.getElementById('sl-err');
    const r = await window.SupaAPI.login(_sel.id, _pin);
    if (!r || r.status !== 'success') {
      sErr(); paintDots(true);
      if (errEl) errEl.textContent = 'PIN incorrecto';
      _pin = ''; setTimeout(paintDots, 450);
      return;
    }
    sOk();
    const ov = document.getElementById('sl-ov'); if (ov) ov.classList.add('sl-okflash');
    try { localStorage.setItem('sot_last_op_id', _sel.id); } catch (e) {}
    setTimeout(() => {
      hideLogin();
      if (typeof origSeleccionar === 'function') origSeleccionar(_sel.nombre);   // setea myOpName, sot_operador, label, toast
      gateHorario();
      if (typeof fetchDashboardData === 'function') fetchDashboardData();
    }, 320);
  }

  async function abrirLogin() {
    injectCSS(); ensureOverlay();
    if (!_ops.length) {
      try { const res = await window.SupaAPI.listarOperadores(); _ops = (res && res.operadores) || []; } catch (e) { _ops = []; }
    }
    renderPick();
  }

  window.addEventListener('DOMContentLoaded', async function () {
    injectCSS();
    origSeleccionar = window.seleccionarOperador;          // el real de app.js
    window.mostrarModalLogin = function () { abrirLogin(); };   // cualquier intento de login → mi overlay
    // cerrar sesión Supabase al cerrar sesión local
    ['cerrarSesion', 'logout'].forEach(n => {
      const o = window[n];
      if (typeof o === 'function') window[n] = function () { try { window.SupaAPI.logout(); } catch (e) {} try { localStorage.removeItem('sot_last_op_id'); } catch (e) {} return o.apply(this, arguments); };
    });
    // precargar operadores y, si no hay sesión, abrir el login moderno
    try { const res = await window.SupaAPI.listarOperadores(); _ops = (res && res.operadores) || []; } catch (e) {}
    const tag = document.getElementById('ver-tag'); if (tag && typeof OPS_VERSION !== 'undefined') tag.textContent = OPS_VERSION;
    let sesion = null; try { sesion = await window.SupaAPI.sesion(); } catch (e) {}
    if (!sesion) {
      try { localStorage.removeItem('sot_operador'); } catch (e) {}
      abrirLogin();
    }
  });
})();
