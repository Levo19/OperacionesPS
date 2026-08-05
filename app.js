const GAS_URL = 'https://legacy.invalid/gas';   // sentinela: el shim intercepta TODO fetch a este prefijo → SupaAPI (cero GAS real)

let myOpName = localStorage.getItem('sot_operador') || null;

// ── COMPRESIÓN de fotos de zarpe ──────────────────────────────────────────
// Reescala a máx 2200px (lado largo) + JPEG 0.85 para que suban rápido PERO
// sigan legibles para la IA/OCR (Edge extraer-zarpe · Claude Vision).
// Si la imagen ya es chica (lado ≤2200 y peso <~900KB) se sube tal cual.
// Devuelve { blob, dataURL, width, height }. Si algo falla, cae al original.
async function comprimirFotoZarpe(file, opts) {
    opts = opts || {};
    const maxDim  = opts.maxDim  || 2200;
    const quality = opts.quality || 0.85;
    const SMALL_BYTES = 900 * 1024; // ~900KB
    try {
        if (!file || !/^image\//.test(file.type || '')) return { blob: file, dataURL: null, width: 0, height: 0 };
        // Cargar la imagen (createImageBitmap respeta orientación EXIF donde exista)
        let bmp = null, w = 0, h = 0;
        try {
            bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
            w = bmp.width; h = bmp.height;
        } catch (_) {
            // Fallback: FileReader + Image
            const dataURL = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
            const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = dataURL; });
            bmp = img; w = img.naturalWidth || img.width; h = img.naturalHeight || img.height;
        }
        const longSide = Math.max(w, h);
        // Ya chica en dimensiones y peso → subir original sin recomprimir
        if (longSide <= maxDim && file.size && file.size < SMALL_BYTES) {
            if (bmp && bmp.close) try { bmp.close(); } catch (_) {}
            return { blob: file, dataURL: null, width: w, height: h };
        }
        const scale = longSide > maxDim ? (maxDim / longSide) : 1;
        const nw = Math.round(w * scale), nh = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = nw; canvas.height = nh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0, nw, nh);
        if (bmp && bmp.close) try { bmp.close(); } catch (_) {}
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
        if (!blob) return { blob: file, dataURL: null, width: w, height: h };
        // Si comprimir no ayudó (raro) y el original era menor, quédate con el menor
        const outBlob = (file.size && blob.size >= file.size && longSide <= maxDim) ? file : blob;
        const dataURL = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(outBlob); });
        return { blob: outBlob, dataURL, width: nw, height: nh };
    } catch (e) {
        return { blob: file, dataURL: null, width: 0, height: 0 };
    }
}

// ── PWA Install prompt ────────────────────────────────────────────────────
let _pwaPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _pwaPrompt = e;
    let btn = document.getElementById('btn-instalar-pwa');
    if (btn) btn.classList.remove('hidden');
});
window.addEventListener('appinstalled', () => {
    _pwaPrompt = null;
    let btn = document.getElementById('btn-instalar-pwa');
    if (btn) btn.classList.add('hidden');
    mostrarToast('✅ App instalada correctamente.', 'success');
});
function instalarPWA() {
    if (!_pwaPrompt) return;
    _pwaPrompt.prompt();
    _pwaPrompt.userChoice.then(r => {
        if (r.outcome === 'accepted') mostrarToast('✅ Instalando OPS...', 'success');
        _pwaPrompt = null;
        let btn = document.getElementById('btn-instalar-pwa');
        if (btn) btn.classList.add('hidden');
    });
}

function cambiarOperador() {
    mostrarModalLogin(true);
}

// ── Cache local del dashboard (offline-first) ─────────────────────────────
const _CACHE_KEY = 'sot_dashboard_cache';

function _saveDashboardCache() {
    try {
        localStorage.setItem(_CACHE_KEY, JSON.stringify({
            ts:          Date.now(),
            operaciones: window.operacionesData   || [],
            contactos:   window.contactosData     || [],
            catalogos:   window.catalogosData     || {},
            reservas:    window.reservasData      || [],
            pases:       window.pasesExternosData || [],
            caja:        window.cajaData          || [],
        }));
    } catch(e) {} // localStorage lleno — silenciar
}

function _loadDashboardCache() {
    try {
        let raw = localStorage.getItem(_CACHE_KEY);
        if (!raw) return false;
        let c = JSON.parse(raw);
        // Solo poblar memoria — NO renderizar. Los datos rancios no deben mostrarse
        // antes de que llegue la respuesta fresca del servidor.
        // El render con caché solo ocurre como fallback offline en fetchDashboardData.
        window.operacionesData   = c.operaciones || [];
        window.contactosData     = c.contactos   || [];
        window.catalogosData     = c.catalogos   || {};
        window.reservasData      = c.reservas    || [];
        window.pasesExternosData = (c.pases || []).filter(p => esFechaHoy(p.timestamp));
        window.cajaData          = c.caja        || [];
        return true;
    } catch(e) { return false; }
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Reset de sesión diario (1 AM) ─────────────────────────────────────────
function resetSesion() {
    // Limpiar operador, fecha de sesión y caché del día
    localStorage.removeItem('sot_operador');
    localStorage.removeItem('sot_session_date');
    localStorage.removeItem(_CACHE_KEY);
    myOpName = null;

    // Limpiar datos en memoria
    window.operacionesData   = [];
    window.cajaData          = [];
    window.pasesExternosData = [];
    window.reservasData      = [];
    window.contactosData     = [];
    window.catalogosData     = null;
    window.editandoMovId     = null;

    // Re-renderizar vacío
    let cont = document.getElementById('operaciones-container');
    if (cont) cont.innerHTML = '';
    let hPanel = document.getElementById('caja-historial-container');
    if (hPanel) hPanel.innerHTML = '';

    mostrarToast('🌅 Nuevo día — ingresa tu nombre de operador.', 'info');
    mostrarModalLogin(false);
}

function programarResetDiario() {
    let ahora   = new Date();
    let reset1am = new Date(ahora);
    reset1am.setHours(1, 0, 0, 0);
    // Si ya pasó la 1 AM de hoy, apuntar a mañana a la 1 AM
    if (ahora >= reset1am) reset1am.setDate(reset1am.getDate() + 1);
    let msHasta1am = reset1am - ahora;
    setTimeout(() => {
        resetSesion();
        // Reprogramar para el siguiente día
        setInterval(resetSesion, 24 * 60 * 60 * 1000);
    }, msHasta1am);
}

let pendingPostRequests = 0;

const TRIP_DURATION_MS = 105 * 60 * 1000; // 1h 45min en ms

function calcularEndTs(op) {
    if (!op.hora_salida || !op.fecha) return 0;
    try {
        let parts = op.fecha.split('-').map(Number);
        let y = parts[0], m = parts[1], d = parts[2];
        let hs = (op.hora_salida || '').toString();
        let match = hs.match(/(\d{1,2}):(\d{2})/);
        if (!match) return 0;
        let zarpe = new Date(y, m - 1, d, parseInt(match[1]), parseInt(match[2]), 0);
        return zarpe.getTime() + TRIP_DURATION_MS;
    } catch(e) { return 0; }
}

function formatCountdown(ms) {
    if (ms <= 0) return null;
    let h = Math.floor(ms / 3600000);
    let m = Math.floor((ms % 3600000) / 60000);
    let s = Math.floor((ms % 60000) / 1000);
    return h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${m}m ${String(s).padStart(2,'0')}s`;
}

function iniciarCountdownTimer() {
    if (window._countdownInterval) clearInterval(window._countdownInterval);
    window._countdownInterval = setInterval(() => {
        let ahora = Date.now();
        document.querySelectorAll('[data-end-ts]').forEach(el => {
            let endTs = parseInt(el.dataset.endTs) || 0;
            if (!endTs) return;
            let rem = endTs - ahora;
            let card = el.closest('[data-op-id]');
            if (rem <= 0) {
                // Timer expiró: estado "En Puerto"
                el.textContent = '¡En Puerto!';
                el.className = 'inline-flex items-center gap-1 text-[9px] font-black text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full';
                if (card && !card.classList.contains('trip-done')) {
                    card.classList.add('trip-done');
                    card.classList.remove('bg-orange-50', 'border-orange-200');
                    card.classList.add('bg-emerald-50', 'border-emerald-200');
                    let sidebar = card.querySelector('.trip-sidebar');
                    if (sidebar) { sidebar.classList.remove('bg-orange-500'); sidebar.classList.add('bg-emerald-500'); }
                    let tag = card.querySelector('.trip-estado-tag');
                    if (tag) { tag.innerHTML = '<i class="fas fa-check-circle mr-1"></i>En Puerto'; tag.className = 'trip-estado-tag absolute top-2 right-4 bg-emerald-200 text-emerald-800 text-[8px] px-2 py-0.5 rounded font-black tracking-widest uppercase shadow-sm border border-emerald-300 z-10'; }
                }
            } else {
                // Countdown activo
                let texto = formatCountdown(rem);
                el.textContent = texto || '—';
                let colorClass = rem < 15 * 60 * 1000
                    ? 'inline-flex items-center gap-1 text-[9px] font-black text-amber-700 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full animate-pulse'
                    : 'inline-flex items-center gap-1 text-[9px] font-black text-orange-700 bg-orange-100 border border-orange-300 px-2 py-0.5 rounded-full';
                el.className = colorClass;
            }
        });
    }, 1000);
}

// ── Jornada cerrada (lock 8 PM) ──────────────────────────────────────────────
function isJornadaCerrada() {
    return new Date().getHours() >= 20;
}
function activarLock() {
    const ol = document.getElementById('lock-overlay');
    if (!ol) return;
    const fd = document.getElementById('lock-fecha');
    if (fd) fd.textContent = new Date().toLocaleDateString('es-PE', { weekday:'long', day:'2-digit', month:'long' });
    ol.classList.add('active');
}
function ocultarLoadingOverlay() {
    const ol = document.getElementById('loading-overlay');
    if (!ol) return;
    ol.classList.add('fade-out');
    setTimeout(() => ol.remove(), 420);
}

document.addEventListener('DOMContentLoaded', () => {
    // Detectar si el día cambió desde la última sesión
    let sessionDate = localStorage.getItem('sot_session_date');
    let hoyStr      = new Date().toLocaleDateString('es-PE');
    if (sessionDate && sessionDate !== hoyStr) {
        // Día distinto → limpiar operador, caché y pedir de nuevo
        localStorage.removeItem('sot_operador');
        localStorage.removeItem('sot_session_date');
        localStorage.removeItem(_CACHE_KEY);
        myOpName = null;
    }

    // WARM-START: poblar memoria desde caché y RENDERIZAR de inmediato (solo existe caché
    // del MISMO día — arriba se borra si cambió la fecha). Antes se esperaba la red con el
    // overlay a pantalla completa: en iPhone, al reabrir con la red despertando, eso se
    // sentía como "app congelada" (el overlay come el táctil). Ahora la app queda usable
    // al toque con los datos del último snapshot y el fetch fresco la actualiza en silencio.
    const _warm = _loadDashboardCache();
    if (_warm && (window.operacionesData || []).length + (window.reservasData || []).length + (window.cajaData || []).length > 0) {
        try { renderCatalogos(window.catalogosData); } catch(e) {}
        try { renderOperaciones(window.operacionesData || []); } catch(e) {}
        try { renderReservas(window.reservasData || []); } catch(e) {}
        try { renderCaja(window.cajaData || []); } catch(e) {}
        ocultarLoadingOverlay();
    }
    // Watchdog del overlay: pase lo que pase (red muerta, sesión colgada), a los 6s el
    // overlay se quita y la app responde al táctil. NUNCA más 35s de pantalla congelada.
    setTimeout(ocultarLoadingOverlay, 6000);

    // Activar lock si ya son las 8 PM — PERO no con cutover Supabase activo.
    // El horario lo maneja el shim vía Supabase app_config (gateHorario); el lock
    // hardcodeado de las 8PM cortaba el arranque (return) y dejaba el muelle en
    // "Cargando" de noche, porque fetchDashboardData nunca llegaba a ejecutarse.
    if (!window.__SUPA_CUTOVER__ && isJornadaCerrada()) {
        ocultarLoadingOverlay();
        activarLock();
        return; // no continuar cargando la app
    }

    // Programar activación del lock a las 8 PM si la app queda abierta
    const ahora = new Date();
    const ocho  = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 20, 0, 0);
    const msHasta8 = ocho - ahora;
    if (!window.__SUPA_CUTOVER__ && msHasta8 > 0) setTimeout(activarLock, msHasta8);

    if (!myOpName) {
        mostrarModalLogin(false);
    } else {
        let el = document.getElementById('label-operador-actual');
        if (el) el.innerText = myOpName;
        // Guardar fecha de sesión si no existe
        if (!sessionDate) localStorage.setItem('sot_session_date', hoyStr);
    }

    fetchPersonalRapido(); // precarga operadores para que el login funcione de inmediato
    fetchDashboardData();
    setInterval(fetchDashboardDataBg, 10000);
    setTimeout(_facMuelleInit, 3000); setInterval(_facMuelleInit, 20000);  // botón boleta según toggle admin (poll 20s)
    // Al enfocar/volver a la app → refleja el permiso del admin AL TOQUE (no espera al poll).
    document.addEventListener('visibilitychange', () => { if (!document.hidden) _facMuelleInit(); });
    window.addEventListener('focus', _facMuelleInit);
    programarResetDiario();
    iniciarCountdownTimer();
    // Procesar cola offline si hay items pendientes del turno anterior
    if (navigator.onLine) setTimeout(_processOfflineQueue, 5000);
    // Detector de nueva versión: chequea cada 5 minutos
    setTimeout(checkForUpdates, 60000); // primera vez al minuto (GH Pages puede tardar en propagar)
    setInterval(checkForUpdates, 5 * 60 * 1000);
    // Refrescar al volver a la pestaña si estuvo inactiva 30s+
    let _lastVisible = Date.now();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            _lastVisible = Date.now();
        } else {
            // Al VOLVER: primero desatorar la UI (overlay/flags pegados por la suspensión iOS),
            // luego refrescar en silencio si estuvo fuera 30s+ (sin overlay, sin bloquear).
            ocultarLoadingOverlay();
            _bgFetchInProgress = false;   // un fetch suspendido a mitad no debe vetar el refresco
            if (navigator.onLine) setTimeout(_processOfflineQueue, 1500);   // iOS recupera red al reanudar → vaciar cola
            if (Date.now() - _lastVisible > 30000) fetchDashboardDataBg();
        }
    });
    // iOS bfcache: si la página se restaura desde el congelador (pageshow persisted),
    // los timers/fetch vienen de un estado viejo → desatorar y refrescar suave.
    window.addEventListener('pageshow', (e) => {
        if (!e.persisted) return;
        ocultarLoadingOverlay();
        _bgFetchInProgress = false;
        fetchDashboardDataBg();
    });
});

// ── Detector de actualizaciones ───────────────────────────────────────────────
let _pageEtag = null;
let _updateCountdownTimer = null;

function checkForUpdates() {
    // Solo en producción (GitHub Pages), no en localhost/Live Server
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
    fetch(location.href, { method: 'HEAD', cache: 'no-store' })
        .then(r => {
            let fingerprint = r.headers.get('ETag') || r.headers.get('Last-Modified');
            if (!fingerprint) return;
            if (!_pageEtag) {
                _pageEtag = fingerprint;
            } else if (_pageEtag !== fingerprint && !_updateCountdownTimer) {
                _mostrarBannerActualizacion();
            }
        })
        .catch(() => {});
}

function _mostrarBannerActualizacion() {
    let banner = document.getElementById('modal-update');
    if (!banner) return;
    banner.classList.remove('hidden');
    let countEl = document.getElementById('update-countdown');
    let secs = 5;
    if (countEl) countEl.textContent = secs;
    _updateCountdownTimer = setInterval(() => {
        secs--;
        if (countEl) countEl.textContent = secs;
        if (secs <= 0) {
            clearInterval(_updateCountdownTimer);
            _updateCountdownTimer = null;
            window.location.reload();
        }
    }, 1000);
}

// ── Precarga ultraligera de operadores (solo hoja Personal) ──────────────────
function _loginEstado(estado) {
    // estado: 'cargando' | 'listo' | 'offline'
    let loading = document.getElementById('login-loading');
    let form    = document.getElementById('login-form');
    let offline = document.getElementById('login-offline');
    if (!loading) return; // modal no visible aún
    loading.classList.toggle('hidden', estado !== 'cargando');
    form.classList.toggle('hidden',    estado !== 'listo');
    offline.classList.toggle('hidden', estado !== 'offline');
    if (estado === 'listo') setTimeout(() => document.getElementById('login-input')?.focus(), 100);
}

function fetchPersonalRapido() {
    // Si ya tenemos operadores en memoria, mostrar form directamente
    let ops = window.catalogosData?.operadores || [];
    if (ops.length > 0) { _loginEstado('listo'); return; }

    // Mostrar spinner de carga en el modal si está abierto
    let modalOpen = !document.getElementById('modal-login')?.classList.contains('hidden');
    if (modalOpen) _loginEstado('cargando');

    let ctrl = new AbortController();
    let timer = setTimeout(() => ctrl.abort(), 12000); // 12s timeout

    fetch(GAS_URL + '?action=getPersonal', { signal: ctrl.signal, cache: 'no-store' })
        .then(r => { clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(data => {
            if (!data.operadores || !data.operadores.length) throw new Error('Sin datos');
            if (!window.catalogosData) window.catalogosData = {};
            window.catalogosData.operadores = data.operadores;
            _loginEstado('listo');
        })
        .catch(() => {
            clearTimeout(timer);
            // Si el dashboard completo ya cargó mientras tanto, usar esos operadores
            let opsAhora = window.catalogosData?.operadores || [];
            if (opsAhora.length > 0) { _loginEstado('listo'); return; }
            _loginEstado('offline');
        });
}

// =============================
// LOGIN / IDENTIFICACIÓN OPERADOR
// =============================
function normStr(s) {
    return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,'');
}

function mostrarModalLogin(closeable) {
    let modal = document.getElementById('modal-login');
    modal.classList.remove('hidden');
    document.getElementById('login-close-btn').classList.toggle('hidden', !closeable);
    document.getElementById('login-error')?.classList.add('hidden');
    document.getElementById('login-matches')?.classList.add('hidden');
    document.getElementById('login-input') && (document.getElementById('login-input').value = '');
    // Mostrar estado según si ya hay operadores o no
    let ops = window.catalogosData?.operadores || [];
    _loginEstado(ops.length > 0 ? 'listo' : 'cargando');
}

function confirmarLoginManual() {
    let input = document.getElementById('login-input').value.trim();
    if(!input) return;

    let errEl     = document.getElementById('login-error');
    let matchesEl = document.getElementById('login-matches');
    errEl.classList.add('hidden');
    matchesEl.classList.add('hidden');

    let ops = (window.catalogosData && window.catalogosData.operadores) || [];

    if(!ops.length) {
        // Lista aún no cargada — rechazar y pedir esperar
        errEl.textContent = '⏳ Aún cargando datos. Espera un momento e inténtalo de nuevo.';
        errEl.classList.remove('hidden');
        return;
    }

    // Buscar: el fragmento ingresado debe estar contenido en alguna palabra del nombre
    let q = normStr(input);
    let matches = ops.filter(op => normStr(op.nombre).includes(q));

    if(matches.length === 0) {
        errEl.textContent = '❌ Usuario no existe. Verifica tu nombre con el administrador.';
        errEl.classList.remove('hidden');

    } else if(matches.length === 1) {
        seleccionarOperador(matches[0].nombre);

    } else {
        // Más de un resultado — pedir que elijan
        errEl.textContent = `Se encontraron ${matches.length} coincidencias. Selecciona la tuya:`;
        errEl.classList.remove('hidden');
        errEl.className = errEl.className.replace('text-red-300','text-yellow-300');
        matchesEl.innerHTML = matches.map(op =>
            `<button onclick="seleccionarOperador('${op.nombre.replace(/'/g,"\\'")}' )" class="bg-white/10 border border-white/20 text-white font-bold text-sm px-4 py-3 rounded-xl hover:bg-white/20 active:scale-95 transition w-full text-left">` +
            `<i class="fas fa-user-check text-blue-300 mr-2"></i>${op.nombre}</button>`
        ).join('');
        matchesEl.classList.remove('hidden');
    }
}

function seleccionarOperador(nombre) {
    myOpName = nombre;
    localStorage.setItem('sot_operador', myOpName);
    localStorage.setItem('sot_session_date', new Date().toLocaleDateString('es-PE'));
    document.getElementById('modal-login').classList.add('hidden');
    let el = document.getElementById('label-operador-actual');
    if(el) el.innerText = myOpName;
    mostrarToast('✅ Bienvenido, ' + myOpName);
}

function getHoyLocal() {
    let tzoffset = (new Date()).getTimezoneOffset() * 60000;
    return (new Date(Date.now() - tzoffset)).toISOString().split('T')[0];
}

// Muestra la fecha seleccionada en formato dd/mm/yyyy bajo el input para evitar confusión de formato
function _mostrarFechaLegible(inputId, spanId) {
    let val = document.getElementById(inputId)?.value;
    let span = document.getElementById(spanId);
    if (!span) return;
    if (!val) { span.textContent = ''; return; }
    let parts = val.split('-'); // yyyy-mm-dd
    if (parts.length === 3) {
        let esHoy = val === getHoyLocal();
        span.textContent = `${parts[2]}/${parts[1]}/${parts[0]}${esHoy ? ' · HOY' : ''}`;
    }
}

function esFechaHoy(ts) {
    if(!ts) return false;
    try {
        let d = new Date(ts);
        if(isNaN(d.getTime())) {
            // Fallback para fechas sin hora (YYYY-MM-DD o DD/MM/YYYY)
            return String(ts).split('T')[0] === getHoyLocal();
        }
        // Usar fecha LOCAL del navegador — d.getDate() etc. respetan el timezone del browser
        let localStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        return localStr === getHoyLocal();
    } catch(e) { return false; }
}

function switchTab(tabId, title, btnElement) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    btnElement.classList.add('active');
    document.getElementById('app-title').innerText = title;
    // feedback táctil + destello (mismo lenguaje del FAB)
    try { resTap(); resHap(8); } catch (e) {}
    btnElement.classList.remove('tapped'); void btnElement.offsetWidth; btnElement.classList.add('tapped');
}

function switchFinanzas(seccion, btnEl) {
    document.querySelectorAll('.fin-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.fin-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('fin-' + seccion).classList.add('active');
    if(btnEl) btnEl.classList.add('active');
}

function _forceRenderEmpty() {
    // Limpia el estado de carga incondicionalmente (sin fingerprint check)
    const oc = document.getElementById('operaciones-container');
    if (oc && oc.querySelector('.fa-spinner')) {
        oc.innerHTML = `<div class="text-center py-8 text-gray-400"><i class="fas fa-wifi-slash text-4xl mb-3 opacity-30 block"></i><p class="text-sm">Sin conexión con el servidor.</p><button onclick="fetchDashboardData()" class="mt-3 px-4 py-1.5 bg-blue-500 text-white text-xs rounded-full">Reintentar</button></div>`;
    }
    const rc = document.getElementById('reservas-container');
    if (rc && rc.querySelector('.fa-spinner')) {
        rc.innerHTML = `<p class="text-center text-xs text-gray-400 py-6">Sin conexión.</p>`;
    }
}

function _cerrarOpsAntiguas() {
    let hoy = getHoyLocal();
    let stale = (window.operacionesData || []).filter(op =>
        op.fecha && op.fecha !== hoy &&
        op.estado !== 'Cerrada' && op.id !== 'Creando...'
    );
    if (stale.length === 0) return;

    // Auto-cerrar optimísticamente en estado local
    stale.forEach(op => {
        let idx = window.operacionesData.findIndex(o => o.id === op.id);
        if (idx !== -1) window.operacionesData[idx].estado = 'Cerrada';
    });

    // Enviar cierre al backend para cada op
    stale.forEach(op => {
        fetchPostBg('confirmar_llegada', { id_operacion: op.id, creador: 'auto_cierre' });
    });

    // Mostrar aviso
    let detalle = stale.map(op => `<li class="text-[11px] text-orange-800 font-bold">${op.bote} · ${op.fecha} · ${op.id}</li>`).join('');
    let bs = document.createElement('div');
    bs.id = '_stale-ops-bs';
    bs.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:flex-end;';
    bs.innerHTML = `<div style="background:white;border-radius:24px 24px 0 0;padding:24px;width:100%;box-shadow:0 -20px 60px rgba(0,0,0,.2);">
        <div style="width:40px;height:4px;background:#e5e7eb;border-radius:4px;margin:0 auto 20px;"></div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
            <div style="width:48px;height:48px;background:#fff7ed;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:22px;">⚠️</div>
            <div><strong style="font-size:17px;color:#111;">Operaciones de días anteriores</strong><br>
            <span style="font-size:12px;color:#6b7280;">Se cerraron automáticamente al abrir la app.</span></div>
        </div>
        <ul style="list-style:disc;padding-left:16px;margin-bottom:16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:10px 14px;">
            ${detalle}
        </ul>
        <button onclick="document.getElementById('_stale-ops-bs').remove()" style="width:100%;background:#f97316;color:white;font-weight:900;border:none;padding:14px;border-radius:14px;font-size:14px;cursor:pointer;">Entendido</button>
    </div>`;
    document.body.appendChild(bs);
    bs.addEventListener('click', e => { if (e.target === bs) bs.remove(); });
}

// ── Realtime: refresco INSTANTÁNEO cuando otro operador registra algo (sin esperar el poll de 10s) ──
function _muelleRTSubscribe() {
    try {
        if (window._muelleRTCh || !window.SupaAPI || !window.SupaAPI.sb) return;   // una sola vez
        let _bump = null;
        const onChange = () => { if (_bump) return; _bump = setTimeout(() => { _bump = null; fetchDashboardDataBg(); }, 600); };
        window._muelleRTCh = window.SupaAPI.sb.channel('ops-muelle-rt')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'operaciones' },   onChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos' },    onChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'caja_operador' },  onChange)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'contactos' },      onChange)
            .subscribe();
    } catch (e) { console.warn('[SOT] realtime subscribe fallo:', e && e.message); }
}

// Abre reporte/ticket del PS Panel (Vercel) YA autenticado: pasa mi sesión Gmail por el
// enlace (#at/#rt, no viaja al server) → abre directo, sin pedir login de nuevo. kind='report'|'ticket'
async function abrirPSDoc(kind) {
    if (kind !== 'report' && kind !== 'ticket') return;
    const w = window.open('about:blank', '_blank');   // abrir YA (dentro del gesto) para que el navegador no bloquee el popup
    const d = new Date();
    const fecha = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let hash = '';
    try {
        const r = await Promise.race([ window.SupaAPI.sb.auth.getSession(), new Promise((_, rej) => setTimeout(() => rej(new Error('T')), 4000)) ]);   // getSession puede colgarse → cap 4s
        const s = r && r.data && r.data.session;
        if (s && s.access_token && s.refresh_token) hash = '#at=' + encodeURIComponent(s.access_token) + '&rt=' + encodeURIComponent(s.refresh_token);
    } catch (e) {}
    const url = 'https://ps-panel.vercel.app/' + kind + '.html?fecha=' + fecha + hash;
    if (w && !w.closed) { try { w.location.href = url; } catch (e) { window.open(url, '_blank'); } }
    else window.open(url, '_blank');
}
window.abrirPSDoc = abrirPSDoc;

function fetchDashboardData() {
    toggleSpinner(true);
    // Safety net: si en 12s todavía no terminó, forzar limpieza de UI (es una LECTURA;
    // el shim ya corta get_dashboard a los 10s — mejor "Reintentar" que pantalla pegada)
    let safetyTimer = setTimeout(() => {
        toggleSpinner(false);
        ocultarLoadingOverlay();
        _forceRenderEmpty();
        console.warn('[SOT] fetchDashboardData timeout — forzando limpieza de UI');
    }, 12000);

    let ctrl = new AbortController();
    let abortTimer = setTimeout(() => ctrl.abort(), 12000);

    fetch(GAS_URL + "?action=getDashboardData", { signal: ctrl.signal })
        .then(res => {
            clearTimeout(abortTimer);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(data => {
            clearTimeout(safetyTimer);
            toggleSpinner(false);
            ocultarLoadingOverlay();
            if(data.status === 'error') {
                console.error("Error backend:", data.error);
                _forceRenderEmpty();
                return;
            }
            window.operacionesData   = data.operaciones_abiertas || [];
            window.contactosData     = data.catalogos ? data.catalogos.contactos : [];
            window.catalogosData     = data.catalogos || {};
            window.reservasData      = data.sala_de_espera || [];
            window.pasesExternosData = (data.pases_externos || []).filter(p => esFechaHoy(p.timestamp));
            window.cajaData          = data.movimientos_dia || [];

            try { renderCatalogos(data.catalogos); } catch(e) { console.error('renderCatalogos:', e); }
            try { _cerrarOpsAntiguas(); } catch(e) { console.error('_cerrarOpsAntiguas:', e); }
            try { renderOperaciones(window.operacionesData); } catch(e) { console.error('renderOperaciones:', e); }
            try { renderReservas(window.reservasData); } catch(e) { console.error('renderReservas:', e); }
            try { renderCaja(window.cajaData); } catch(e) { console.error('renderCaja:', e); }
            try { actualizarModalSiAbierto(); } catch(e) { console.error('actualizarModal:', e); }
            // Si el login estaba esperando operadores, ahora ya los tiene
            try { _loginEstado('listo'); } catch(e) {}
            _saveDashboardCache();
            _muelleRTSubscribe();   // sesión válida → suscribe al Realtime (una sola vez)
        })
        .catch(err => {
            clearTimeout(safetyTimer);
            clearTimeout(abortTimer);
            toggleSpinner(false);
            ocultarLoadingOverlay();
            console.warn('[SOT] fetchDashboardData error:', err.message);
            _forceRenderEmpty();
            // Fallback offline: renderizar con datos de caché si existen
            try { renderCatalogos(window.catalogosData); } catch(e) {}
            try { renderOperaciones(window.operacionesData || []); } catch(e) {}
            try { renderReservas(window.reservasData || []); } catch(e) {}
            try { renderCaja(window.cajaData || []); } catch(e) {}
            let hayCaché = !!localStorage.getItem(_CACHE_KEY);
            mostrarToast(
                hayCaché ? '📴 Sin conexión — mostrando datos guardados' : '❌ Sin conexión y sin datos previos',
                'error'
            );
        });
}

// Sincroniza el modal silenciosamente después de un POST de embarque
function syncManifestBg() {
    let opId = document.getElementById('hidden-gestion-op')?.value;
    if(!opId || document.getElementById('modal-gestion-bote').classList.contains('hidden')) return;
    // Si hay POSTs en vuelo todavía, esperar
    if(pendingPostRequests > 0) {
        clearTimeout(window._syncTimer);
        window._syncTimer = setTimeout(syncManifestBg, 1500);
        return;
    }

    // Guardar los temps locales ANTES de sobrescribir — para re-inyectar los no confirmados
    let localOp     = window.operacionesData?.find(o => o.id === opId);
    let localTemps  = (localOp?.manifiesto || []).filter(m => m._syncing || (m.id && m.id.startsWith('temp-')));

    fetch(GAS_URL + "?action=getDashboardData")
        .then(r => r.json())
        .then(data => {
            if(data.status === 'error') return;
            window.operacionesData   = data.operaciones_abiertas || [];
            window.contactosData     = data.catalogos?.contactos || window.contactosData;
            window.catalogosData     = data.catalogos || window.catalogosData;
            window.reservasData      = data.sala_de_espera || [];
            window.cajaData          = data.movimientos_dia || [];

            // Filtrar items eliminados localmente que GAS aún no procesó
            let _delIds = window._deletedMovIds || new Set();
            if (_delIds.size > 0) {
                (window.operacionesData || []).forEach(op => {
                    let before = op.manifiesto.length;
                    op.manifiesto = op.manifiesto.filter(m => !_delIds.has(m.id));
                    let removed = before - op.manifiesto.length;
                    if (removed > 0) op.ocupados = Math.max(0, op.ocupados - removed);
                });
            }

            // Re-inyectar temps que el servidor aún no confirmó (sin duplicar)
            if(localTemps.length > 0) {
                let newOp = window.operacionesData.find(o => o.id === opId);
                if(newOp) {
                    // Solo excluir temps que ya tienen un ID real en los datos de GAS (nunca por contenido)
                    let stillPending = localTemps.filter(t =>
                        !newOp.manifiesto.some(s => s.id === t.id)
                    );
                    if(stillPending.length > 0) {
                        newOp.manifiesto  = [...stillPending, ...newOp.manifiesto];
                        newOp.ocupados   += stillPending.reduce((sum, m) => sum + (parseInt(m.pax) || 0), 0);
                        // Reprogramar otro sync para cuando GAS confirme los que faltan
                        clearTimeout(window._syncTimer);
                        window._syncTimer = setTimeout(syncManifestBg, 3000);
                    }
                }
            }

            actualizarModalSiAbierto();
        })
        .catch(() => {});
}

// Actualiza el modal de gestión bote con los datos actuales de window.operacionesData
function actualizarModalSiAbierto() {
    let isOpen = !document.getElementById('modal-gestion-bote').classList.contains('hidden');
    let opId   = document.getElementById('hidden-gestion-op')?.value;
    if(!isOpen || !opId) return;
    let op = window.operacionesData.find(o => o.id === opId);
    if(!op) return;
    let libres = op.capacidad - op.ocupados;
    document.getElementById('gestion-pax-total').innerText = op.ocupados;
    document.getElementById('gestion-bote-aforo').innerText = `${op.ocupados} / ${op.capacidad} PAX`;
    // Barra de capacidad
    let pct = op.capacidad > 0 ? Math.round((op.ocupados / op.capacidad) * 100) : 0;
    let barColor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-orange-400' : 'bg-green-500';
    let barEl = document.getElementById('barra-capacidad');
    let labelEl = document.getElementById('label-cupos');
    if(barEl) { barEl.style.width = pct + '%'; barEl.className = `h-full rounded-full transition-all duration-500 ${barColor}`; }
    if(labelEl) labelEl.innerText = libres > 0 ? `${libres} cupo${libres !== 1 ? 's' : ''} libre${libres !== 1 ? 's' : ''}` : '¡LLENO!';
    actualizarListaManifiestoSuave(op.manifiesto);
}

// Actualiza la lista del manifiesto con DOM diffing por-item: sin flash, sin reflow innecesario
function actualizarListaManifiestoSuave(manifiesto) {
    let lista = document.getElementById('gestion-manifiesto-lista');
    if (!lista) return;

    let _delIds = window._deletedMovIds || new Set();
    let filtered = _delIds.size > 0 ? manifiesto.filter(m => !_delIds.has(m.id)) : manifiesto;
    let q = (window._manifestSearch || '').trim().toLowerCase();
    if (q) filtered = filtered.filter(m => {
        let nombre = (m.nombreContacto || m.contacto || '').toLowerCase();
        return nombre.includes(q) || (m.tipo || '').toLowerCase().includes(q);
    });

    // Container FP: si nada cambió, salir
    let fp = filtered.map(m => _itemManifiestoFP(m)).join(';');
    if (lista._fp === fp) return;
    lista._fp = fp;

    // Estado vacío
    if (!filtered || filtered.length === 0) {
        lista.innerHTML = '<div class="text-center p-6 bg-white border-2 border-dashed border-gray-200 rounded-2xl text-gray-400 font-bold"><i class="fas fa-ship text-4xl mb-3 opacity-20 block"></i> Lancha vacía.<br><span class="text-[10px] font-normal">Agrega pasajeros usando el formulario superior.</span></div>';
        return;
    }

    let scrollTop = lista.scrollTop;

    // Recopilar items existentes
    let existing = new Map();
    lista.querySelectorAll('[data-mov-id]').forEach(el => existing.set(el.dataset.movId, el));

    // Eliminar items que ya no están
    let newIds = new Set(filtered.map(m => m.id));
    existing.forEach((el, id) => { if (!newIds.has(id)) el.remove(); });

    // Actualizar o crear cada item (solo los que cambiaron)
    filtered.forEach(m => {
        let itemFp   = _itemManifiestoFP(m);
        let existEl  = existing.get(m.id);
        if (existEl) {
            if (existEl.dataset.itemFp !== itemFp) {
                let tmp = document.createElement('div');
                tmp.innerHTML = _itemManifiestoHTML(m);
                let newEl = tmp.firstElementChild;
                existEl.replaceWith(newEl);
                existing.set(m.id, newEl);
            }
        } else {
            let tmp = document.createElement('div');
            tmp.innerHTML = _itemManifiestoHTML(m);
            let newEl = tmp.firstElementChild;
            newEl.classList.add('row-enter');
            existing.set(m.id, newEl);
        }
    });

    // Re-ordenar sin recrear nodos
    filtered.forEach(m => lista.appendChild(existing.get(m.id)));

    // ── Sección de movimientos PASADOS (derivados) al fondo de la lista ──
    let pasadosSection = lista.querySelector('[data-section="pasados-section"]');
    let opId2 = document.getElementById('hidden-gestion-op')?.value;
    let op2   = (window.operacionesData || []).find(o => o.id === opId2);
    let pasados = op2 ? (op2.manifiesto_pasados || []) : [];
    if (pasados.length > 0) {
        let pasadosFp = pasados.map(m => _itemManifiestoFP(m)).join(';');
        if (!pasadosSection || pasadosSection.dataset.fp !== pasadosFp) {
            if (pasadosSection) pasadosSection.remove();
            let wrapper = document.createElement('div');
            wrapper.dataset.section = 'pasados-section';
            wrapper.dataset.fp = pasadosFp;
            wrapper.innerHTML = `
                <div class="flex items-center gap-2 my-2 px-1">
                    <span class="text-[9px] font-black text-gray-400 uppercase tracking-wider whitespace-nowrap"><i class="fas fa-share-square mr-1 text-purple-400"></i>Derivados · ${pasados.reduce((s,m) => s+(parseInt(m.pax)||0), 0)} PAX</span>
                    <div class="flex-1 h-px bg-gray-200"></div>
                </div>
                ${pasados.map(m => _itemManifiestoHTML(m)).join('')}`;
            lista.appendChild(wrapper);
        }
    } else if (pasadosSection) {
        pasadosSection.remove();
    }

    lista.scrollTop = scrollTop;
}

function filtrarManifiestoModal(q) {
    window._manifestSearch = q;
    let opId = document.getElementById('hidden-gestion-op')?.value;
    let op = (window.operacionesData || []).find(o => o.id === opId);
    if (op) actualizarListaManifiestoSuave(op.manifiesto);
}

let _bgFetchInProgress = false;

function fetchDashboardDataBg() {
    let spinner = document.getElementById('global-spinner');
    // Contador huérfano (p.ej. iOS suspendió la página a mitad de un POST y el watchdog
    // durmió): si lleva >60s "en vuelo", es mentira — resetear para no vetar refrescos.
    if (pendingPostRequests > 0 && Date.now() - (window._lastPostAt || 0) > 60000) pendingPostRequests = 0;
    if(pendingPostRequests > 0 || !spinner.classList.contains('hidden')) return;
    if(_bgFetchInProgress) return; // evitar fetches concurrentes
    // No interrumpir si hay algún modal abierto (usuario activo) o si hay items pendientes
    let anyModalOpen = !!document.querySelector('[id^="modal-"]:not(.hidden)');
    if (anyModalOpen) return;

    _bgFetchInProgress = true;

    // Dot ámbar suave mientras sincroniza en background
    let dot = document.getElementById('sync-dot');
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-300 animate-pulse';

    // Snapshot pre-refresh para detectar cambios de otros operadores (Task #5)
    let _prevOpStates  = new Map((window.operacionesData || []).filter(o => o.id !== 'Creando...').map(o => [o.id, { estado: o.estado, pax: o.ocupados }]));
    let _prevCajaCount = (window.cajaData || []).filter(c => !c._syncing).length;
    let _prevPaxTotal  = (window.operacionesData || []).reduce((s, o) => s + (o.ocupados || 0), 0);
    let _isFirstLoad   = !window._bgRefreshDone;
    window._bgRefreshDone = true;

    // Watchdog: si el refetch no resuelve en 15s, rechazamos para NO dejar _bgFetchInProgress
    // pegado en true (eso congelaría todos los refrescos futuros → "cargando" eterno).
    Promise.race([
        fetch(GAS_URL + "?action=getDashboardData"),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout refetch')), 15000))
    ])
        .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
        .then(data => {
            _bgFetchInProgress = false;
            if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-300 animate-pulse';
            if(data.status === 'error') return;

            // Preservar temps locales antes de sobrescribir
            let tempOps   = (window.operacionesData || []).filter(o => o.id === 'Creando...');
            let tempRes   = (window.reservasData || []).filter(r => r.id === 'Creando...');
            let tempCaja  = (window.cajaData || []).filter(c => c._syncing);
            let tempPases = (window.pasesExternosData || []).filter(p => p._syncing);

            // Preservar items del manifiesto aún no confirmados por GAS
            let manifestTemps = {};
            (window.operacionesData || []).forEach(op => {
                let temps = (op.manifiesto || []).filter(m => m._syncing || (m.id && m.id.startsWith('temp-')));
                if (temps.length > 0) manifestTemps[op.id] = temps;
            });

            window.operacionesData   = data.operaciones_abiertas || [];
            window.contactosData     = data.catalogos ? data.catalogos.contactos : [];
            window.catalogosData     = data.catalogos || {};
            window.reservasData      = data.sala_de_espera || [];
            window.pasesExternosData = (data.pases_externos || []).filter(p => esFechaHoy(p.timestamp));
            window.cajaData          = data.movimientos_dia || [];

            // Filtrar items eliminados localmente que GAS aún no procesó
            let _delIds = window._deletedMovIds || new Set();
            if (_delIds.size > 0) {
                (window.operacionesData || []).forEach(op => {
                    let before = op.manifiesto.length;
                    op.manifiesto = op.manifiesto.filter(m => !_delIds.has(m.id));
                    let removed = before - op.manifiesto.length;
                    if (removed > 0) op.ocupados = Math.max(0, op.ocupados - removed);
                });
            }

            // Re-inyectar temps de manifiesto no confirmados aún
            Object.keys(manifestTemps).forEach(opId => {
                let newOp = window.operacionesData.find(o => o.id === opId);
                if (!newOp) return;
                let temps = manifestTemps[opId];
                let stillPending = temps.filter(t =>
                    !newOp.manifiesto.some(s => s.id === t.id)
                );
                if (stillPending.length > 0) {
                    newOp.manifiesto = [...stillPending, ...newOp.manifiesto];
                    newOp.ocupados += stillPending.reduce((sum, m) => sum + (parseInt(m.pax) || 0), 0);
                }
            });

            // Re-inyectar temps no confirmados aún por el servidor
            tempOps.forEach(t => {
                if (!window.operacionesData.some(o => o.bote === t.bote && o.capitan === t.capitan))
                    window.operacionesData.unshift(t);
            });
            tempRes.forEach(t => {
                if (!window.reservasData.some(r => r.cliente === t.cliente && String(r.pax) === String(t.pax) && r.fecha === t.fecha))
                    window.reservasData.unshift(t);
            });
            tempCaja.forEach(t => {
                if (!window.cajaData.some(c => c.id === t.id))
                    window.cajaData.unshift(t);
            });
            tempPases.forEach(t => {
                if (!window.pasesExternosData.some(p => p.id === t.id))
                    window.pasesExternosData.unshift(t);
            });

            // ── Notificaciones de cambios por otro operador (Task #5) ──────────
            if (!_isFirstLoad) {
                let hoy = getHoyLocal();
                (window.operacionesData || []).forEach(op => {
                    if (op.id === 'Creando...' || op.fecha !== hoy) return;
                    let prev = _prevOpStates.get(op.id);
                    if (!prev) {
                        mostrarToast(`🆕 Nueva lancha: ${op.bote} (${op.ocupados} PAX)`, 'info');
                    } else if (prev.estado === 'Abierta' && op.estado === 'En_Viaje') {
                        mostrarToast(`⚓ ${op.bote} ha zarpado`, 'info');
                    } else if (prev.pax !== op.ocupados && op.estado === 'Abierta') {
                        let diff = op.ocupados - prev.pax;
                        if (diff > 0) mostrarToast(`👤 +${diff} PAX en ${op.bote}`, 'info');
                    }
                });
                // Op que desapareció (cerrada por otro operador)
                _prevOpStates.forEach((prev, id) => {
                    if (!(window.operacionesData || []).some(o => o.id === id)) {
                        if (prev.estado === 'En_Viaje') mostrarToast(`🏁 Una lancha confirmó llegada`, 'info');
                    }
                });
                // Nuevos movimientos de caja
                let newCajaCount = (window.cajaData || []).filter(c => !c._syncing).length;
                if (newCajaCount > _prevCajaCount) {
                    let diff = newCajaCount - _prevCajaCount;
                    mostrarToast(`💰 ${diff} nuevo${diff > 1 ? 's' : ''} movimiento${diff > 1 ? 's' : ''} de caja`, 'info');
                }
            }
            // ─────────────────────────────────────────────────────────────────

            // Modal Abrir Bote: preservar selecciones del usuario
            let modalAbrirOpen = !document.getElementById('modal-abrir-bote').classList.contains('hidden');
            if(modalAbrirOpen) {
                let savedBote = document.getElementById('select-bote-id')?.value;
                let savedCap  = document.getElementById('select-capitan-id')?.value;
                let savedGuia = document.getElementById('select-guia-id')?.value;
                renderCatalogos(data.catalogos);
                if(savedBote) document.getElementById('select-bote-id').value = savedBote;
                if(savedCap)  document.getElementById('select-capitan-id').value = savedCap;
                if(savedGuia) document.getElementById('select-guia-id').value = savedGuia;
            } else {
                renderCatalogos(data.catalogos);
            }

            renderOperaciones(window.operacionesData);
            renderReservas(window.reservasData);
            renderCaja(window.cajaData);
            _saveDashboardCache(); // mantener caché actualizada
            // El modal de gestión bote NO se toca en BG refresh para no interrumpir al operador
        })
        .catch(() => {
            _bgFetchInProgress = false;
            if (dot) dot.className = 'w-2 h-2 rounded-full bg-red-400';
            // Restaurar a verde después de 3s
            setTimeout(() => {
                if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-300 animate-pulse';
            }, 3000);
        });
}

// ── Helpers para renderOperaciones (DOM diffing) ─────────────────────────────
function _generarCardFP(op) {
    let isViaje = op.estado === 'En_Viaje';
    let endTs   = isViaje ? calcularEndTs(op) : 0;
    let isExp   = endTs > 0 && (endTs - Date.now()) <= 0;
    return `${op.id}|${op.estado}|${op.ocupados}|${op.capacidad}|${op.foto_zarpe||''}|${isExp?1:0}`;
}

function _generarCardHTML(op) {
    let porcentaje = op.capacidad > 0 ? (op.ocupados / op.capacidad) * 100 : 0;
    let isViaje   = op.estado === 'En_Viaje';
    let isCerrada = op.estado === 'Cerrada';
    let endTs   = isViaje ? calcularEndTs(op) : 0;
    let remMs   = endTs > 0 ? endTs - Date.now() : -1;
    let isExpired = endTs > 0 && remMs <= 0;
    let fp = _generarCardFP(op);

    let bgStyle, barColor, titleColor, gradientBar;
    if (isCerrada) {
        bgStyle = 'bg-gray-50 border-gray-300 opacity-80'; barColor = 'bg-gray-400';
        titleColor = 'text-gray-500'; gradientBar = 'from-gray-300 to-gray-400';
    } else if (!isViaje) {
        bgStyle = 'bg-white border-gray-100'; barColor = 'bg-green-500';
        titleColor = 'text-blue-900'; gradientBar = 'from-green-400 to-green-500';
    } else if (isExpired) {
        bgStyle = 'bg-emerald-50 border-emerald-200 trip-done'; barColor = 'bg-emerald-500';
        titleColor = 'text-emerald-900'; gradientBar = 'from-emerald-400 to-emerald-500';
    } else {
        bgStyle = 'bg-orange-50 border-orange-200'; barColor = 'bg-orange-500';
        titleColor = 'text-orange-900'; gradientBar = 'from-orange-400 to-orange-500';
    }

    let tagEstado = '';
    if (isCerrada) {
        tagEstado = `<span class="trip-estado-tag absolute top-2 right-4 bg-gray-200 text-gray-600 text-[8px] px-2 py-0.5 rounded font-black tracking-widest uppercase shadow-sm border border-gray-300 z-10"><i class="fas fa-check-double mr-1"></i>Cerrada</span>`;
    } else if (isViaje) {
        if (isExpired) {
            tagEstado = `<span class="trip-estado-tag absolute top-2 right-4 bg-emerald-200 text-emerald-800 text-[8px] px-2 py-0.5 rounded font-black tracking-widest uppercase shadow-sm border border-emerald-300 z-10"><i class="fas fa-check-circle mr-1"></i>En Puerto</span>`;
        } else {
            tagEstado = `<span class="trip-estado-tag absolute top-2 right-4 bg-orange-200 text-orange-800 text-[8px] px-2 py-0.5 rounded font-black tracking-widest uppercase shadow-sm border border-orange-300 z-10 animate-pulse"><i class="fas fa-water mr-1"></i>En Viaje</span>`;
        }
    }

    let countdownBadge = '';
    if (isViaje && endTs > 0) {
        let cdText  = isExpired ? '¡En Puerto!' : (formatCountdown(remMs) || '—');
        let cdClass = isExpired
            ? 'inline-flex items-center gap-1 text-[9px] font-black text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full'
            : remMs < 15 * 60 * 1000
                ? 'inline-flex items-center gap-1 text-[9px] font-black text-amber-700 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full animate-pulse'
                : 'inline-flex items-center gap-1 text-[9px] font-black text-orange-700 bg-orange-100 border border-orange-300 px-2 py-0.5 rounded-full';
        countdownBadge = `<span class="${cdClass}" data-end-ts="${endTs}"><i class="fas fa-hourglass-half text-[8px]"></i>${cdText}</span>`;
    }

    let fotoBtns = '';
    if (isViaje || isCerrada) {
        if (op.foto_zarpe) {
            let fotoEsc = op.foto_zarpe.replace(/'/g, "\\'");
            let btnVer = isCerrada
                ? 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                : isExpired ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100';
            fotoBtns = `
            <div class="flex gap-2">
                <button class="flex-1 ${btnVer} font-bold py-2 rounded-xl border shadow-sm transition active:scale-95 text-xs flex items-center justify-center" onclick="verFotoZarpe('${fotoEsc}')">
                    <i class="fas fa-camera mr-1.5"></i> Ver Foto
                </button>
                <button class="bg-gray-50 text-gray-500 font-bold px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-100 transition active:scale-95 text-xs" title="Cambiar foto" onclick="abrirModalZarpeFoto('${op.id}', true)">
                    <i class="fas fa-sync-alt"></i>
                </button>
            </div>`;
        } else {
            fotoBtns = `<button class="w-full bg-gray-50 text-gray-600 font-bold py-2 rounded-xl border border-gray-200 hover:bg-gray-100 transition active:scale-95 text-xs flex items-center justify-center" onclick="abrirModalZarpeFoto('${op.id}')">
                <i class="fas fa-camera mr-1.5 text-gray-400"></i> Subir Foto de Zarpe
            </button>`;
        }
    }

    let html = `
    <div class="${bgStyle} rounded-2xl shadow-sm p-4 mb-4 border relative overflow-hidden" data-op-id="${op.id}" data-card-fp="${fp}">
        ${tagEstado}
        <div class="trip-sidebar absolute top-0 left-0 w-2 h-full ${barColor}"></div>
        <div class="flex justify-between items-center mb-1 pl-3">
            <h3 class="font-extrabold text-lg flex-1 truncate ${titleColor}"><i class="fas fa-ship fa-sm mr-2 ${isViaje ? (isExpired ? 'text-emerald-400' : 'text-orange-400') : 'text-blue-400'} ${op.id === 'Creando...' ? 'fa-pulse text-yellow-500' : ''}"></i>${op.bote}</h3>
            <div class="flex items-center gap-1.5 shrink-0 ml-2">
                ${op.id !== 'Creando...' ? `<button class="w-7 h-7 bg-white border border-gray-200 rounded-full text-gray-400 hover:text-blue-600 hover:border-blue-300 transition text-xs flex items-center justify-center shadow-sm" onclick="abrirModalEditarOp('${op.id}'); event.stopPropagation()"><i class="fas fa-pen"></i></button>` : ''}
                <span class="bg-white border text-gray-800 text-xs px-2.5 py-1 rounded-full font-bold shadow-sm">${op.ocupados} / ${op.capacidad} PAX</span>
            </div>
        </div>
        <div class="flex justify-between text-[10px] text-gray-400 font-bold mb-2 uppercase tracking-wider pl-3 pr-2 ml-6">
            <span>CÓDIGO: <span class="${op.id === 'Creando...' ? 'text-yellow-500 animate-pulse' : 'text-gray-700'}">${op.id}</span></span>
            <div class="flex items-center gap-2">
                ${op.hora_salida ? `<span class="${isViaje ? (isExpired ? 'text-emerald-600' : 'text-orange-500') : 'text-blue-500'} font-black"><i class="fas fa-clock mr-1"></i>${op.hora_salida}</span>` : ''}
                ${countdownBadge}
            </div>
        </div>
        <div class="w-full bg-gray-100 rounded-full h-2 mb-3">
            <div class="bg-gradient-to-r ${gradientBar} h-2 rounded-full" style="width: ${porcentaje}%"></div>
        </div>
        <div class="text-[10px] text-gray-500 flex justify-between items-center mb-3 font-medium px-2 py-1.5 bg-white border border-gray-200 rounded-lg shadow-inner">
            <span class="truncate"><i class="fas fa-user-tie ${isViaje ? (isExpired ? 'text-emerald-400' : 'text-orange-400') : 'text-blue-400'} mr-1"></i><b class="text-gray-700">${op.capitan}</b></span>
            <span class="truncate text-right"><i class="fas fa-user-tag text-green-400 mr-1"></i><b class="text-gray-700">${op.guia}</b></span>
        </div>
        ${isCerrada ? `
        <div class="mt-2 space-y-2">
            <button class="w-full bg-gray-100 text-gray-500 font-bold py-2.5 rounded-xl border border-gray-300 transition active:scale-95 text-xs flex items-center justify-center" onclick="abrirModalGestionBote('${op.id}')">
                <i class="fas fa-clipboard-check mr-1.5 text-gray-400"></i> Ver Manifiesto Final
            </button>
            ${fotoBtns}
        </div>
        ` : !isViaje ? `
        <div class="flex space-x-2 mt-2">
            <button class="flex-[2] bg-blue-50 text-blue-700 font-bold py-2.5 rounded-xl border border-blue-200 hover:bg-blue-100 shadow-sm transition active:scale-95 text-xs flex items-center justify-center" onclick="abrirModalGestionBote('${op.id}')">
                <i class="fas fa-users mr-1.5"></i> Gest. PAX
            </button>
            <button class="flex-1 bg-green-500 text-white font-bold py-2.5 rounded-xl border border-green-600 shadow-md transition active:scale-95 text-xs flex items-center justify-center" onclick="confirmarZarpe('${op.id}')">
                <i class="fas fa-anchor mr-1.5"></i> Zarpar
            </button>
        </div>
        ${op.id !== 'Creando...' && op.ocupados === 0 ? `
        <button class="w-full mt-2 bg-red-50 text-red-600 font-bold py-2 rounded-xl border border-red-200 hover:bg-red-100 shadow-sm transition active:scale-95 text-xs flex items-center justify-center" onclick="confirmarAnularOp('${op.id}'); event.stopPropagation()">
            <i class="fas fa-ban mr-1.5"></i> Anular Operación
        </button>` : ''}
        ` : `
        <div class="mt-2 space-y-2">
            <button class="w-full ${isExpired ? 'bg-emerald-500 text-white border-emerald-600 shadow-md shadow-emerald-500/30 font-black' : 'bg-amber-500 text-white border-amber-600 shadow-md shadow-amber-500/20 font-black'} py-3 rounded-xl border transition active:scale-95 text-xs flex items-center justify-center" onclick="confirmarLlegada('${op.id}')">
                <i class="fas fa-flag-checkered mr-1.5"></i> ${isExpired ? 'Confirmar Llegada' : 'Finalizar Viaje'}
            </button>
            <button class="w-full ${isExpired ? 'bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200' : 'bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-200'} font-bold py-2.5 rounded-xl border shadow-sm transition active:scale-95 text-xs flex items-center justify-center" onclick="abrirModalGestionBote('${op.id}')">
                <i class="fas fa-clipboard-list mr-1.5"></i> Ver Manifiesto
            </button>
            ${fotoBtns}
        </div>
        `}
    </div>`;
    return { fp, html };
}

function _generarPasesDiaHTML(pases) {
    if (!pases || pases.length === 0) return '';
    let totalPaxPases = pases.reduce((s, p) => s + (parseInt(p.pax)||0), 0);
    let contactos = window.contactosData || [];
    let filas = pases.map((p, idx) => {
        let aid = (p.aliadoId || '').toString().trim();
        let aliadoInfo   = contactos.find(c =>
            c.id === aid ||
            c.nombre === aid ||
            (c.id || '').toLowerCase() === aid.toLowerCase() ||
            (c.nombre || '').toLowerCase() === aid.toLowerCase()
        );
        let aliadoNombre = aliadoInfo ? aliadoInfo.nombre : (aid || '—');
        let origen       = p.nombreOrigen || '';
        let ts           = p.timestamp ? new Date(p.timestamp).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : '';
        let paseId       = p.id || '';
        let paseNombreEsc = _escArg(origen);   // escapa comilla simple/doble/\\ para el onclick (antes solo comilla simple)

        // ── Pase convertido a compra de agencia ──────────────────────────
        let agenciaCompradaId = (p.id_agencia_comprada || '').trim();
        if (agenciaCompradaId) {
            let agInfo        = contactos.find(c => c.id === agenciaCompradaId);
            let agNombre      = agInfo ? agInfo.nombre : agenciaCompradaId;
            let montoComprado = parseFloat(p.monto_comprado) || 0;
            // Detectar si ya fue pagado (hay entrada en cajaData con id_movimiento = paseId y categoria Pago Agencia)
            let pagadoTx = (window.cajaData || []).find(c =>
                (c.id_movimiento || '') === paseId && c.categoria === 'Pago Agencia'
            );
            let estadoChip = pagadoTx
                ? `<span class="inline-flex items-center gap-1 text-[8px] font-black text-green-700 bg-green-100 px-2 py-0.5 rounded-full mt-1"><i class="fas fa-check-circle text-[7px]"></i>Pagado S/${montoComprado.toFixed(2)}</span>`
                : `<span class="inline-flex items-center gap-1 text-[8px] font-black text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full mt-1"><i class="fas fa-clock text-[7px]"></i>Pendiente S/${montoComprado.toFixed(2)}</span>`;
            let pagarBtn = pagadoTx ? '' :
                `<button class="mt-1 w-full bg-orange-500 text-white text-[9px] font-bold py-1 rounded-lg flex items-center justify-center gap-1 hover:bg-orange-600 active:scale-95 transition"
                    onclick="abrirModalCaja('pago_agencia', { id_contacto: '${agenciaCompradaId}', nombre_contacto: '${agNombre.replace(/'/g,"\\'")}', monto: ${montoComprado}, id_mov: '${paseId}', pax: ${parseInt(p.pax)||0} }); event.stopPropagation();">
                    <i class='fas fa-store text-[8px]'></i> Pagar a ${agNombre}
                </button>`;
            // Cobrar al origen (parte A) — aunque el asiento sea comprado, aún se cobra al cliente original
            let cobrarOrigenBtn = '';
            let origenIdC  = p.origenId || '';
            let origenTipoC = p.tipo    || '';
            if (origenIdC && !_TIPOS_SIN_COBRO.includes(origenTipoC)) {
                let pagoStC = _calcPagoEstado({ id: paseId, tipo: origenTipoC, monto: p.monto || 0 });
                if (pagoStC && pagoStC.estado !== 'pagado_completo' && pagoStC.estado !== 'sin_cobro') {
                    let montoNum = parseFloat(p.monto) || 0;
                    let pendNum  = pagoStC.pendiente;
                    let etiqueta = pagoStC.estado === 'pagado_parcial' ? `Pend. S/${pendNum.toFixed(2)}` : `S/${montoNum.toFixed(2)}`;
                    let nombreEsc = origen.replace(/'/g,"\\'");
                    cobrarOrigenBtn = `<button class="cobrar-btn-appear mt-1 w-full bg-green-500 text-white text-[9px] font-bold py-1 rounded-lg flex items-center justify-center gap-1 hover:bg-green-600 active:scale-95 transition"
                        onclick="abrirModalCaja('cobro_directo', { id_contacto: '${origenIdC}', nombre_contacto: '${nombreEsc}', monto: ${montoNum}, id_mov: '${paseId}', pendiente: ${pendNum.toFixed(2)}, bloqueado: true }); event.stopPropagation();">
                        <span class='w-1 h-1 rounded-full bg-white animate-pulse'></span>
                        <i class='fas fa-money-bill-wave text-[8px]'></i> Cobrar ${etiqueta}
                    </button>`;
                }
            }
            return `
            <tr class="border-t border-gray-100 hover:bg-orange-50 transition">
                <td class="py-2 px-2">
                    <span class="text-[9px] font-bold text-orange-400 uppercase tracking-wide block">Compra:</span>
                    <span class="text-[11px] font-black text-orange-800 block uppercase leading-tight">${agNombre}</span>
                    ${origen ? `<span class="text-[9px] text-gray-400 font-bold"><i class="fas fa-arrow-right text-[7px] mr-0.5"></i>De: ${origen}</span>` : ''}
                    ${cobrarOrigenBtn}
                    ${estadoChip}
                    ${pagarBtn}
                </td>
                <td class="py-2 px-2 text-center text-sm font-black text-blue-600">${p.pax}</td>
                <td class="py-2 px-2 text-[9px] text-gray-400 text-right">${ts}</td>
                <td class="py-1.5 px-1.5"></td>
            </tr>`;
        }

        // ── Pase normal a aliado ──────────────────────────────────────────
        // Cobrar button: only if origin generates cobro (Libre / Agencia / Comisionado, no Aliado)
        let origenTipo = p.tipo    || '';   // p.tipo es el tipo del movimiento = tipo del origen
        let origenId   = p.origenId || '';
        // Leer adicionales: primero del objeto pase (si ya fue actualizado), luego manifiesto como fallback
        let movAdicionalesPase = p.adicionales || '';
        if (!movAdicionalesPase) {
            for (let op of (window.operacionesData || [])) {
                let movManifPase = (op.manifiesto || []).find(m => m.id === paseId);
                if (movManifPase) { movAdicionalesPase = movManifPase.adicionales || ''; break; }
            }
        }
        let movAdicionalesSumPase = movAdicionalesPase ? movAdicionalesPase.split(',').reduce((acc, part) => {
            return acc + (parseFloat((part.split(':')[1] || '').trim()) || 0);
        }, 0) : 0;
        let paseEsCobrable = !_TIPOS_SIN_COBRO.includes(origenTipo) && !!(origenId);
        let pagoStPase = paseEsCobrable ? _calcPagoEstado({ id: paseId, tipo: origenTipo, monto: p.monto || 0, adicionales: movAdicionalesPase }) : null;
        let cobrarPaseBtn = '';
        if (paseEsCobrable && pagoStPase && pagoStPase.estado !== 'pagado_completo') {
            let montoNum = parseFloat(p.monto) || 0;
            let totalNum = montoNum + movAdicionalesSumPase;
            let pendNum  = pagoStPase.pendiente;
            let etiqueta = pagoStPase.estado === 'pagado_parcial'
                ? `Pend. S/${pendNum.toFixed(2)}`
                : `S/${totalNum.toFixed(2)}`;
            let nombreEsc = origen.replace(/'/g,"\\'");
            let adicsEsc  = movAdicionalesPase.replace(/'/g,"\\'");
            cobrarPaseBtn = `<button class="cobrar-btn-appear mt-1 w-full bg-green-500 text-white text-[9px] font-bold py-1 rounded-lg flex items-center justify-center gap-1 hover:bg-green-600 active:scale-95 transition"
                onclick="abrirModalCaja('cobro_directo', { id_contacto: '${origenId}', nombre_contacto: '${nombreEsc}', monto: ${montoNum}, monto_adicionales: ${movAdicionalesSumPase.toFixed(2)}, detalle_adicionales: '${adicsEsc}', id_mov: '${paseId}', pendiente: ${pendNum.toFixed(2)}, bloqueado: true }); event.stopPropagation();">
                <span class='w-1 h-1 rounded-full bg-white animate-pulse'></span>
                <i class='fas fa-money-bill-wave text-[8px]'></i> Cobrar ${etiqueta}
            </button>`;
        }
        let adicionalesPaseBtn = paseEsCobrable ? `<button class="mt-1 w-full bg-amber-100 text-amber-700 border border-amber-200 text-[9px] font-bold py-1 rounded-lg flex items-center justify-center gap-1 hover:bg-amber-200 active:scale-95 transition"
            onclick="abrirModalImpuestos('${paseId}', '${origen.replace(/'/g,"\\'")}'); event.stopPropagation();">
            <i class='fas fa-file-invoice-dollar text-[8px]'></i> Adicionales${movAdicionalesSumPase > 0 ? ` +S/${movAdicionalesSumPase.toFixed(2)}` : ''}
        </button>` : '';
        // Botón Comprar — convierte este pase a compra de agencia
        let comprarBtn = `<button class="mt-1 w-full bg-orange-100 text-orange-700 border border-orange-200 text-[9px] font-bold py-1 rounded-lg flex items-center justify-center gap-1 hover:bg-orange-200 active:scale-95 transition"
            onclick="abrirModalComprarPase('${paseId}', ${parseInt(p.pax)||0}, '${paseNombreEsc}'); event.stopPropagation();">
            <i class='fas fa-store text-[8px]'></i> Comprar
        </button>`;

        return `
        <tr class="border-t border-gray-100 hover:bg-purple-50 transition">
            <td class="py-2 px-2 cursor-pointer" onclick="verDetallePase(${idx})">
                <span class="text-[9px] font-bold text-purple-400 uppercase tracking-wide block">Para:</span>
                <span class="text-[11px] font-black text-purple-800 block uppercase leading-tight">${aliadoNombre}</span>
                ${origen ? `<span class="text-[9px] text-gray-400 font-bold"><i class="fas fa-arrow-right text-[7px] mr-0.5"></i>De: ${origen}</span>` : ''}
                ${cobrarPaseBtn}
                ${adicionalesPaseBtn}
                ${comprarBtn}
            </td>
            <td class="py-2 px-2 text-center text-sm font-black text-blue-600 cursor-pointer" onclick="verDetallePase(${idx})">${p.pax}</td>
            <td class="py-2 px-2 text-[9px] text-gray-400 text-right cursor-pointer" onclick="verDetallePase(${idx})">${ts}</td>
            <td class="py-1.5 px-1.5 text-right">
                <button class="bg-red-50 text-red-500 border border-red-200 text-[9px] font-black px-2 py-1 rounded-lg hover:bg-red-100 active:scale-95 transition" onclick="iniciarAnularPase('${paseId}','${p.pax}','${paseNombreEsc}'); event.stopPropagation();">
                    <i class="fas fa-undo-alt mr-0.5"></i>Anular
                </button>
            </td>
        </tr>`;
    }).join('');
    return `
    <div class="mt-4 bg-purple-50 border border-purple-200 rounded-2xl shadow-sm overflow-hidden" data-section="pases">
        <div class="px-4 py-2.5 bg-purple-100 border-b border-purple-200 flex items-center justify-between">
            <span class="text-[11px] font-black text-purple-800 uppercase tracking-wider"><i class="fas fa-people-carry mr-1.5"></i>Pases del día</span>
            <span class="text-[10px] bg-purple-200 text-purple-800 font-black px-2 py-0.5 rounded-full">${totalPaxPases} pax · ${pases.length} pases</span>
        </div>
        <table class="w-full">
            <thead><tr class="text-[9px] text-purple-500 uppercase tracking-wider bg-purple-50">
                <th class="py-1.5 px-2 text-left font-bold">Destino / Origen</th>
                <th class="py-1.5 px-2 text-center font-bold">PAX</th>
                <th class="py-1.5 px-2 text-right font-bold">Hora</th>
                <th class="py-1.5 px-2"></th>
            </tr></thead>
            <tbody class="bg-white">${filas}</tbody>
        </table>
    </div>`;
}
// ─────────────────────────────────────────────────────────────────────────────

function renderOperaciones(operaciones) {
    const container = document.getElementById('operaciones-container');
    let hoy = getHoyLocal();
    let opHoy = operaciones.filter(op => op.fecha === hoy || op.id === 'Creando...');

    const _estadoOrden = { 'Abierta': 0, 'En_Viaje': 1, 'Cerrada': 2 };
    opHoy.sort((a, b) => (_estadoOrden[a.estado] ?? 3) - (_estadoOrden[b.estado] ?? 3));

    // Container-level fingerprint — incluye pases y estado de pagos/cobros vinculados.
    // MISMO filtro que el render (vivos): si un pase pasa a Cancelado, el fp cambia → repinta.
    let fp = opHoy.map(o => _generarCardFP(o)).join(';')
           + '|p:' + (window.pasesExternosData || []).filter(p => !/cancel/i.test(p.estado || '')).map(p => {
               let pagado  = (window.cajaData || []).some(c => (c.id_movimiento||'') === p.id && c.categoria === 'Pago Agencia') ? 1 : 0;
               let cobrado = (window.cajaData || []).some(c => (c.id_movimiento||'') === p.id && c.categoria === 'Cobro') ? 1 : 0;
               return `${p.id}|${p.aliadoId}|${p.id_agencia_comprada||''}|${pagado}|${cobrado}|${p.pax}`;
           }).join(',');
    if (container._fp === fp) return;
    container._fp = fp;

    if (!opHoy || opHoy.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-gray-500"><i class="fas fa-ship text-4xl mb-3 opacity-20 block"></i> No hay lanchas programadas<br>para el día de HOY.</div>`;
        return;
    }

    // Eliminar cualquier elemento que no sea una card (spinner inicial, mensajes de error, etc.)
    container.querySelectorAll(':scope > :not([data-op-id])').forEach(el => el.remove());

    // Recopilar cards existentes en el DOM
    let existingCards = new Map();
    container.querySelectorAll('[data-op-id]').forEach(el => existingCards.set(el.dataset.opId, el));

    // Eliminar cards que ya no están en opHoy
    let newIds = new Set(opHoy.map(o => o.id));
    existingCards.forEach((el, id) => { if (!newIds.has(id)) el.remove(); });

    // Actualizar o crear cada card (sin tocar las que no cambiaron)
    opHoy.forEach(op => {
        let { fp: cardFp, html } = _generarCardHTML(op);
        let existing = existingCards.get(op.id);
        if (existing) {
            if (existing.dataset.cardFp !== cardFp) {
                let tmp = document.createElement('div');
                tmp.innerHTML = html.trim();
                let newEl = tmp.firstElementChild;
                existing.replaceWith(newEl);
                existingCards.set(op.id, newEl);
            }
        } else {
            let tmp = document.createElement('div');
            tmp.innerHTML = html.trim();
            let newEl = tmp.firstElementChild;
            newEl.classList.add('card-enter');
            existingCards.set(op.id, newEl);
        }
    });

    // Re-ordenar: sacar sección de pases, appendear cards en orden correcto
    let pasesSectionEl = container.querySelector('[data-section="pases"]');
    if (pasesSectionEl) pasesSectionEl.remove();

    opHoy.forEach(op => container.appendChild(existingCards.get(op.id)));

    // Actualizar sección de pases — solo los de HOY y VIVOS (un pase anulado está Cancelado
    // en BD: si se pintara aquí con botón "Anular", parecería que la anulación no funcionó)
    let pasesDiaHTML = _generarPasesDiaHTML(
        (window.pasesExternosData || []).filter(p => esFechaHoy(p.timestamp) && !/cancel/i.test(p.estado || ''))
    );
    if (pasesDiaHTML) {
        let tmp = document.createElement('div');
        tmp.innerHTML = pasesDiaHTML.trim();
        container.appendChild(tmp.firstElementChild);
    }
}

// ── Helpers DOM-diffing reservas ─────────────────────────────────────────────
// ── Reservas · helpers (fecha robusta + feedback sonoro/háptico) ─────────────
function _resFechaISO(f) {
    let s = String(f || '').trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);          // dd/mm/yyyy → yyyy-MM-dd
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return s.slice(0, 10);                                       // ya viene yyyy-MM-dd
}
function _resFechaLegible(f) {
    let parts = String(f || '').split('-'); if (parts.length !== 3) return f || '';
    let tz = (new Date()).getTimezoneOffset() * 60000;
    let manana = (new Date(Date.now() - tz + 86400000)).toISOString().split('T')[0];
    let meses = ['', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    let etiqueta = `${parseInt(parts[2])} ${meses[parseInt(parts[1])] || ''}`;
    return f === manana ? `mañana · ${etiqueta}` : etiqueta;
}
function _resEsc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function _resArg(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
// minutos desde medianoche, tolerando 12h '08:00 AM'/'02:00 PM', 24h '14:00' y 'Libre' (→ al final)
function _resHoraMin(h) {
    let m = String(h || '').match(/(\d{1,2}):(\d{2})\s*([ap])\.?\s*m/i);
    if (m) { let hh = parseInt(m[1]) % 12; if (/p/i.test(m[3])) hh += 12; return hh * 60 + parseInt(m[2]); }
    let m2 = String(h || '').match(/^(\d{1,2}):(\d{2})/);
    if (m2) return parseInt(m2[1]) * 60 + parseInt(m2[2]);
    return 99999;
}
// separa '08:00 AM' → { t:'08:00', ap:'AM' } para mostrar hora grande + meridiano chico
function _resHoraDisp(h) {
    let m = String(h || '').match(/(\d{1,2}:\d{2})\s*([ap])\.?\s*m/i);
    if (m) return { t: m[1], ap: m[2].toUpperCase() + 'M' };
    let s = String(h || '').trim();
    return { t: (s && s !== '—') ? s : '—', ap: '' };
}
let _resAc = null;
function _resBeep(freqs, opts) {
    try {
        _resAc = _resAc || new (window.AudioContext || window.webkitAudioContext)();
        if (_resAc.state === 'suspended') _resAc.resume();
        const o = opts || {}, dur = o.dur || 0.1, type = o.type || 'sine', gain = o.gain || 0.05;
        let t = _resAc.currentTime;
        (Array.isArray(freqs) ? freqs : [freqs]).forEach(fr => {
            const osc = _resAc.createOscillator(), gn = _resAc.createGain();
            osc.type = type; osc.frequency.value = fr;
            gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(gain, t + 0.01);
            gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            osc.connect(gn); gn.connect(_resAc.destination); osc.start(t); osc.stop(t + dur); t += dur * 0.8;
        });
    } catch (e) {}
}
function resTap() { _resBeep(620, { dur: 0.05, gain: 0.04 }); }
function resOk()  { _resBeep([660, 990, 1320], { type: 'triangle', dur: 0.11 }); }
function resErr() { _resBeep([220, 165], { type: 'square', dur: 0.16, gain: 0.05 }); }
function resHap(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

// ── Vocabulario HÁPTICO semántico (patrones distintos y detectables por el humano) ──
// Cada evento tiene su "firma" en la piel: el cajero SIENTE qué pasó sin leer.
const _HAP = {
  tap:   12,                      // toque de botón (suave)
  sel:   [0, 14],                 // selección/cambio de pestaña
  ok:    [0, 25, 45, 25],         // confirmación amable
  emit:  [0, 45, 30, 110],        // ★ EMITIDO — golpe satisfactorio (punch final)
  warn:  [0, 22, 80, 22],         // advertencia (doble espaciado, "ojo")
  err:   [0, 75, 45, 75, 45, 75], // ERROR — triple buzz inconfundible
  ready: [0, 16],                 // listo para el siguiente
  scan:  [0, 10, 90, 10, 90, 10], // IA analizando (pulso de escaneo)
  done:  [0, 30, 35, 30],         // IA terminó
};
// fx(nombre): feedback TRIPLE (háptico + sonoro) en una sola llamada = sensación coherente.
function fx(name) {
  try { if (navigator.vibrate) navigator.vibrate(_HAP[name] || 12); } catch (e) {}
  if (name === 'emit' || name === 'ok' || name === 'done') { try { resOk(); } catch (e) {} }
  else if (name === 'err') { try { resErr(); } catch (e) {} }
  else if (name === 'warn') { try { _resBeep([880, 620], { type: 'triangle', dur: 0.09, gain: 0.045 }); } catch (e) { try { resTap(); } catch (_) {} } }  // dos tonos: atención, no error
  else { try { resTap(); } catch (e) {} }
}

// ════════════════ BOLETA RÁPIDA (muelle · solo si el admin la habilitó) ════════════════
let _facM = null;
// ícono "boleta" (estilo recibo) en SVG — se pinta dorado vía CSS
const _FAC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 6.5v11"/></svg>';
async function _facMuelleInit() {
  try {
    if (!window.SupaAPI || !window.SupaAPI.facturacionMuelle) return;
    const on = await window.SupaAPI.facturacionMuelle();
    let btn = document.getElementById('fab-boleta');
    if (on) {
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'fab-boleta'; btn.className = 'fac-fab'; btn.title = 'Emitir boleta';
        btn.innerHTML = '<span class="fac-fab-inner">' + _FAC_ICON + '</span>';
        btn.onclick = abrirBoletaMuelle;
        document.body.appendChild(btn);   // se crea solo si el admin autorizó → efecto de aparición
      } else if (btn.style.display === 'none') {
        btn.style.display = '';
        const inner = btn.querySelector('.fac-fab-inner');   // re-dispara la animación de aparición
        if (inner) { inner.style.animation = 'none'; void inner.offsetWidth; inner.style.animation = ''; }
      }
    } else if (btn) { btn.style.display = 'none'; }
  } catch (e) {}
}
const _facEscM = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Items por defecto del muelle = paquete del zarpe (Paseo + Guiado, 1 unidad c/u) — igual que PS.
function _facMItemsDefecto() {
  const S = _facM;
  const base = (S.paquete && S.paquete.length) ? S.paquete : (S.servicios || []).slice(0, 2);
  if (!base.length) return [{ nombre: 'Tour Islas Ballestas', precio: S.precioDef || 30, cantidad: 1 }];
  return base.map(p => ({ nombre: p.nombre, precio: Number(p.precio) || 0, cantidad: 1 }));
}
async function abrirBoletaMuelle() {
  resTap(); resHap(10);
  let boot = {}, paq = [];
  try { boot = (window.SupaAPI && window.SupaAPI.facturacionBootstrap) ? await window.SupaAPI.facturacionBootstrap() : {}; } catch (e) {}
  try { paq = (window.SupaAPI && window.SupaAPI.paqueteFac) ? await window.SupaAPI.paqueteFac() : []; } catch (e) {}
  const servicios = boot.servicios || [];
  const precioDef = Number(boot.precio_defecto) || (servicios[0] && servicios[0].precio) || 30;
  _facM = {
    tab: 'emitir', servicios, paquete: paq || [], serieB: boot.serie_boleta || 'B002', serieF: boot.serie_factura || 'F002', precioDef,
    tipo: 2,
    // VARIOS por defecto (con su ×) — el flujo más común del muelle; buscar solo si hace falta
    cliente: { doc_tipo: '0', doc_numero: '', nombre: 'Cliente varios' },
    q: '', resultados: [], buscando: false, apiResult: null, noEncontrado: false,
    manual: false, manualTipo: '1', _manualNombre: '', _manualDoc: '', _manualDir: '',
    tel: '', email: '',
    items: [], exonerado: false, export: false, medioPago: '', _svcPick: null, _precioEdit: null,
    historial: [], cargandoHist: false, contadorHoy: 0,
    shake: false, _t: null, anularId: null, _anularMotivo: '', _feed: [], _emitCd: 0
  };
  _facM.items = _facMItemsDefecto();
  _facMRender();
}
function cerrarBoletaMuelle() { const ov = document.getElementById('facm-ov'); if (ov) ov.style.display = 'none'; resHap(8); }

function _facMDocLbl(tipo) { return ({ '1': 'DNI', '6': 'RUC', '4': 'CE', '7': 'Pasaporte', '0': 'Varios' })[tipo] || tipo; }
function _facMTab(t) {
  const S = _facM; if (S.tab === t) return; fx('sel');
  const box = document.getElementById('facm-box'); const fromH = box ? box.offsetHeight : 0;
  S.tab = t; S.anularId = null; S._tabFade = true; _facMRender();
  _facMAnimHeight(fromH);
  if (t === 'historial') _facMHist();
}
// Anima la altura del modal desde fromH hacia su altura NATURAL actual (sin acumular).
function _facMAnimHeight(fromH) {
  const box = document.getElementById('facm-box'); if (!box || !fromH) return;
  const toH = box.offsetHeight;   // ya viene capado por max-height:92vh
  if (Math.abs(toH - fromH) < 4) return;
  box.style.height = fromH + 'px'; box.style.overflow = 'hidden';
  void box.offsetHeight;   // reflow
  box.style.transition = 'height .28s cubic-bezier(.4,0,.2,1)';
  box.style.height = toH + 'px';
  const done = () => { box.style.transition = ''; box.style.height = ''; box.style.overflow = ''; box.removeEventListener('transitionend', done); };
  box.addEventListener('transitionend', done);
  setTimeout(done, 380);
}
function _facMSearch(q) {
  const S = _facM; S.q = q; S.apiResult = null; S.noEncontrado = false;
  clearTimeout(S._t);
  const qq = (q || '').trim();
  if (qq.length < 2) { S.resultados = []; S.buscando = false; _facMDrop(); return; }
  S.buscando = true; _facMDrop();   // los resultados previos SIGUEN visibles mientras busca (sin parpadeo)
  // capa 1: clientes frecuentes (rápida) — un doc completo (8/11 díg) NO espera el debounce largo
  const digits = qq.replace(/\D/g, '');
  const esDocCompleto = digits === qq && (digits.length === 8 || digits.length === 11);
  S._t = setTimeout(async () => {
    let res = [];
    try { res = await window.SupaAPI.buscarContactosFac(qq); } catch (e) {}
    if (S.q.trim() !== qq) return;
    S.resultados = res || [];
    if (S.resultados.length) { S.buscando = false; _facMDrop(); return; }
    _facMDrop();   // sigue "buscando" → capa 2 API
    if (digits.length === 8 || digits.length === 11) {
      try { const d = await window.SupaAPI.consultarDocumento(digits, digits.length === 8 ? '1' : '6'); if (S.q.trim() !== qq) return; if (d && d.ok && d.nombre) S.apiResult = d; else S.noEncontrado = true; } catch (e) { S.noEncontrado = true; }
    } else { S.noEncontrado = true; }
    S.buscando = false; _facMDrop();
  }, esDocCompleto ? 120 : 250);
}
function _facMPick(c) {
  const S = _facM; fx('sel');
  S._localId = null;   // P2-1: cliente nuevo = venta nueva → nunca reusar el localId de otra venta
  S.cliente = { doc_tipo: c.doc_tipo || '1', doc_numero: c.doc_numero || '', nombre: c.nombre || '', direccion: c.direccion || '', es_extranjero: !!c.es_extranjero };
  if (c.email) S.email = c.email;
  if (c.telefono) S.tel = c.telefono;
  S.q = ''; S.resultados = []; S.apiResult = null; S.noEncontrado = false; S.manual = false;
  _facMRender();
}
function _facMClearCliente() { fx('sel'); const S = _facM; S._localId = null; S.cliente = null; S.q = ''; S.resultados = []; S.noEncontrado = false; S.apiResult = null; S.manual = false; _facMRender(); }
// ＋ cliente: OVERLAY (como PS) — 4 tipos con sus condiciones (RUC exige domicilio fiscal),
// autograba el contacto. El overlay vive fuera del modal → cero parpadeo.
function _facMManual() { _facMManOvOpen(); }
function _facMManOvOpen() {
  resTap(); const S = _facM; S.noEncontrado = false;
  const digits = (S.q || '').replace(/\D/g, '');
  S._manualDoc = (S.q || '').trim();
  S.manualTipo = (/^\d{8}$/.test(digits) && digits === S._manualDoc) ? '1' : ((/^(10|15|17|20)\d{9}$/.test(digits) && digits === S._manualDoc) ? '6' : '7');
  S._manualNombre = ''; S._manualDir = '';
  _facMManOvRender();
  requestAnimationFrame(() => { const el = document.getElementById('facm-mnom'); if (el) el.focus(); });
}
function _facMManOvClose() { const ov = document.getElementById('facm-manov'); if (ov) ov.remove(); }
function _facMManOvRender() {
  const S = _facM;
  let ov = document.getElementById('facm-manov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'facm-manov'; ov.style.cssText = 'position:fixed;inset:0;z-index:9700;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:18px'; ov.onclick = e => { if (e.target === ov) _facMManOvClose(); }; document.body.appendChild(ov); }
  const segT = [['1', 'DNI'], ['4', 'CE'], ['7', 'Pasaporte'], ['6', 'RUC']];
  const hint = { '1': 'DNI: 8 dígitos', '4': 'Carné de extranjería', '7': 'Pasaporte del turista', '6': 'RUC: 11 dígitos + domicilio fiscal' }[S.manualTipo] || '';
  ov.innerHTML = `<div class="facm-pop" style="width:100%;max-width:360px;max-height:88vh;overflow-y:auto;background:#fff;border-radius:18px;padding:18px;box-shadow:0 18px 50px rgba(60,5,8,.35)">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <div style="width:34px;height:34px;border-radius:11px;background:linear-gradient(140deg,#7a1015,#56070c);display:flex;align-items:center;justify-content:center;color:#e8b840;font-size:18px;font-weight:900;flex:0 0 auto">＋</div>
      <div style="flex:1;font-weight:900;font-size:15px;color:#3d0508">Registrar cliente</div>
      <button onclick="_facMManOvClose()" style="border:none;background:#f6eef0;width:30px;height:30px;border-radius:50%;font-size:18px;color:#9b6b6e;cursor:pointer;flex:0 0 auto">×</button>
    </div>
    <div style="font-size:11.5px;color:#9b6b6e;margin:2px 0 12px;line-height:1.4">No está en el registro — puede ser real igual. Confirma sus datos.</div>
    <div style="font-size:10px;font-weight:800;color:#9b7d80;letter-spacing:.4px;margin-bottom:6px">TIPO DE DOCUMENTO</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-bottom:5px">
      ${segT.map(d => `<button onclick="_facMManTipo('${d[0]}')" style="padding:11px 6px;border-radius:11px;font-weight:800;font-size:13px;cursor:pointer;transition:all .15s;border:1.5px solid ${S.manualTipo === d[0] ? '#56070c' : '#e5e7eb'};background:${S.manualTipo === d[0] ? '#fdf2f2' : '#fff'};color:${S.manualTipo === d[0] ? '#56070c' : '#6b7280'};box-shadow:${S.manualTipo === d[0] ? '0 2px 8px rgba(86,7,12,.14)' : 'none'}">${d[1]}</button>`).join('')}
    </div>
    <div style="font-size:10.5px;color:#a16207;margin:0 2px 12px">${hint}</div>
    <input id="facm-mdoc" inputmode="text" placeholder="N° de documento" value="${_facEscM(S._manualDoc)}" autocomplete="off" oninput="_facM._manualDoc=this.value" style="width:100%;padding:12px;border:1px solid #e5e7eb;border-radius:11px;margin-bottom:9px;font-size:14px">
    <input id="facm-mnom" placeholder="Nombre / Razón social" value="${_facEscM(S._manualNombre)}" autocomplete="off" oninput="_facM._manualNombre=this.value" style="width:100%;padding:12px;border:1px solid #e5e7eb;border-radius:11px;margin-bottom:9px;font-size:14px">
    ${S.manualTipo === '6' ? `<input id="facm-mdir" placeholder="Domicilio fiscal (obligatorio)" value="${_facEscM(S._manualDir)}" autocomplete="off" oninput="_facM._manualDir=this.value" style="width:100%;padding:12px;border:1px solid #e5e7eb;border-radius:11px;margin-bottom:9px;font-size:14px"><div style="font-size:10px;color:#a16207;margin:-3px 2px 10px">Va impreso en la factura.</div>` : ''}
    <div style="display:flex;gap:9px;margin-top:4px"><button onclick="_facMManOvClose()" style="flex:1;padding:12px;border-radius:11px;border:1px solid #e5e7eb;background:#fff;color:#6b7280;font-weight:700;font-size:14px;cursor:pointer">Cancelar</button><button onclick="_facMManualOK()" style="flex:1.5;padding:12px;border-radius:11px;border:none;background:linear-gradient(135deg,#8b1a1f,#56070c);color:#fff;font-weight:800;font-size:14px;cursor:pointer">💾 Guardar</button></div>
  </div>`;
}
function _facMManTipo(t) { resTap(); resHap(6); _facM.manualTipo = t; _facMManOvRender(); }
async function _facMManualOK() {
  const S = _facM;
  const nom = (S._manualNombre || '').trim(), doc = (S._manualDoc || '').trim().toUpperCase(), dir = (S._manualDir || '').trim();
  if (!nom) return _facMErr('Escribe el nombre / razón social');
  if (!doc) return _facMErr('Escribe el número de documento');
  if (S.manualTipo === '1' && !/^\d{8}$/.test(doc)) return _facMErr('Un DNI tiene 8 dígitos');
  if (S.manualTipo === '6' && !/^(10|15|17|20)\d{9}$/.test(doc)) return _facMErr('Un RUC tiene 11 dígitos (empieza en 10/15/17/20)');
  if (S.manualTipo === '6' && !dir) return _facMErr('El RUC necesita su domicilio fiscal (obligatorio en factura)');
  resTap(); resHap(10);
  _facMManOvClose();
  // autograba como cliente frecuente (la próxima búsqueda SÍ lo encuentra) — fire-and-forget
  try { window.SupaAPI.guardarClienteFac({ doc_tipo: S.manualTipo, doc_numero: doc, nombre: nom, direccion: dir || null, es_extranjero: S.manualTipo === '7' }); } catch (e) {}
  _facMPick({ doc_tipo: S.manualTipo, doc_numero: doc, nombre: nom, direccion: dir, es_extranjero: S.manualTipo === '7' });
  mostrarToast('✓ Cliente registrado', 'success');
}
function _facMVarios() { _facMPick({ doc_tipo: '0', doc_numero: '', nombre: 'Cliente varios' }); }
// Cliente incompatible con el tipo → motivo (para pulso rojo). Como PS: Factura exige RUC.
function _facMCliInvalido() {
  const S = _facM, c = S.cliente;
  if (!c || S.tipo !== 1) return '';
  if (c.doc_tipo === '0') return 'La factura no puede ser a “Varios” — necesita un RUC';
  if (c.doc_tipo !== '6') return 'La factura necesita un RUC — este cliente no lo tiene';
  return '';
}
// Zona-cliente (chip seleccionado con estado inválido, o buscador). Se repinta en sitio.
function _facMCliHtml() {
  const S = _facM;
  if (S.cliente) {
    const c = S.cliente, inv = _facMCliInvalido();
    const bord = inv ? '#dc2626' : '#f0c4c6';
    const bg = inv ? 'linear-gradient(135deg,#fef2f2,#fee2e2)' : 'linear-gradient(135deg,#fdf2f2,#fbe9ea)';
    const hint = inv ? `<div style="font-size:10.5px;color:#dc2626;font-weight:800;margin-top:6px;display:flex;align-items:center;gap:5px">⚠ ${inv} <button onclick="_facMClearCliente()" style="margin-left:auto;border:none;background:#dc2626;color:#fff;font-weight:800;font-size:10.5px;border-radius:7px;padding:3px 9px;cursor:pointer">Cambiar</button></div>` : '';
    return `<div class="facm-row${inv ? ' facm-pulse' : ''}" style="padding:11px 12px;border-radius:12px;background:${bg};border:1.5px solid ${bord};margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="flex:1;min-width:0"><div style="font-weight:800;font-size:14px;color:#3d0508;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_facEscM(c.nombre)}</div><div style="font-size:11px;color:${inv ? '#dc2626' : '#9b6b6e'}">${_facMDocLbl(c.doc_tipo)}${c.doc_numero ? ' · ' + _facEscM(c.doc_numero) : ''}</div></div>
        <button onclick="_facMClearCliente()" style="flex:0 0 auto;width:30px;height:30px;border-radius:50%;border:none;background:#fff;color:#9b6b6e;font-size:16px;cursor:pointer">×</button>
      </div>${hint}
    </div>`;
  }
  // buscador — "Cliente varios" NO aparece en Factura (no aplica; exige RUC)
  return `<input id="facm-q" autocomplete="off" placeholder="Buscar cliente o documento…" value="${_facEscM(S.q)}" style="width:100%;padding:11px 12px;border:1px solid #e5e7eb;border-radius:11px;font-size:14px;margin-bottom:6px">
    <div id="facm-drop" style="margin-bottom:6px"></div>
    ${S.tipo === 1 ? '' : `<button onclick="_facMVarios()" style="width:100%;padding:8px;border-radius:9px;border:1px dashed #e0c9cb;background:none;color:#9b6b6e;font-size:12px;font-weight:700;cursor:pointer;margin-bottom:10px">Cliente varios (sin documento)</button>`}`;
}
function _facMBindCli() {
  const S = _facM; const qi = document.getElementById('facm-q');
  if (qi) { qi.oninput = e => _facMSearch(e.target.value); if (S.q) { qi.focus(); try { qi.setSelectionRange(qi.value.length, qi.value.length); } catch (e) {} } _facMDrop(); }
}
function _facMRepaintCli() { const el = document.getElementById('facm-cli'); if (el) { el.innerHTML = _facMCliHtml(); _facMBindCli(); } }
// Cliente de un resultado de API (RENIEC/SUNAT): AUTOGRABA para que la próxima búsqueda por
// NOMBRE lo encuentre en frecuentes (antes solo se guardaba al emitir → no aparecía por nombre).
async function _facMPickApi(a) {
  try { window.SupaAPI.guardarClienteFac({ doc_tipo: a.doc_tipo, doc_numero: a.doc_numero, nombre: a.nombre, direccion: a.direccion || null, es_extranjero: a.doc_tipo === '7' }); } catch (e) {}
  _facMPick(a);
}
// ── Servicios como en PS: stepper −/+ por línea, a CERO se elimina, ＋ del catálogo.
// ANTI-PARPADEO: cantidad/precio/total se actualizan EN SITIO — el modal completo NO se
// re-renderiza (el re-render replayaba slideUp y "aparecía y reaparecía" todo).
function _facMItQty(i, d) {
  const S = _facM; const it = S.items[i]; if (!it) return;
  const nv = Math.max(0, (Number(it.cantidad) || 0) + d);
  if (nv === 0) { S.items.splice(i, 1); fx('sel'); resHap([8, 20, 8]); _facMRepaintItems(); return; }
  it.cantidad = nv; resTap(); resHap(d > 0 ? 8 : 6);
  const q = document.getElementById('facm-itq-' + i); if (q) { q.textContent = nv; q.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 160 }); }
  _facMRepaintSouth();
  if (d > 0) _facMPlusFx(i);
}
function _facMPlusFx(i) {   // "+1" flotante como en PS
  const row = document.querySelector('[data-facm-it="' + i + '"]');
  if (row) { const el = document.createElement('span'); el.className = 'facm-plus1'; el.textContent = '+1'; row.appendChild(el); setTimeout(() => el.remove(), 800); }
}
function _facMItPrecioEdit(i) {
  resTap(); const S = _facM; S._precioEdit = i;
  const chip = document.getElementById('facm-iprice-' + i);
  if (!chip) return;
  chip.outerHTML = `<input id="facm-pin-${i}" type="number" inputmode="decimal" value="${S.items[i] ? S.items[i].precio : 0}" onblur="_facMItPrecioSet(${i},this.value)" onkeydown="if(event.key==='Enter')this.blur()" style="width:64px;padding:4px 6px;border:1px solid #e0b04a;border-radius:8px;text-align:center;font-weight:800;font-size:12px">`;
  requestAnimationFrame(() => { const el = document.getElementById('facm-pin-' + i); if (el) { el.focus(); el.select(); } });
}
function _facMItPrecioSet(i, v) {
  const S = _facM; if (S.items[i]) S.items[i].precio = Math.max(0, parseFloat(v) || 0);
  S._precioEdit = null; resHap(8);
  const el = document.getElementById('facm-pin-' + i);
  if (el) el.outerHTML = _facMPriceChip(i);
  _facMRepaintSouth();
}
function _facMPriceChip(i) {
  const it = _facM.items[i] || { precio: 0 };
  if (it.gratis) return `<button id="facm-iprice-${i}" onclick="_facMItPrecioEdit(${i})" title="GRATIS — valor referencial S/ ${Number(it.precio) || 0} (toca para editarlo)" style="border:1px solid rgba(192,132,252,.45);background:rgba(192,132,252,.12);border-radius:8px;padding:4px 8px;font-weight:800;font-size:11px;color:#9333ea;cursor:pointer;white-space:nowrap">🎁 GRATIS</button>`;
  return `<button id="facm-iprice-${i}" onclick="_facMItPrecioEdit(${i})" title="Toca para editar el precio" style="border:1px solid #f0e6e7;background:#faf7f7;border-radius:8px;padding:4px 8px;font-weight:800;font-size:11.5px;color:#56070c;cursor:pointer;white-space:nowrap">S/ ${it.precio}</button>`;
}
// 🎁 Cortesía por servicio: no se cobra pero viaja con valor referencial (afectacion 'gratuito').
// No se mezcla con exportación (regla SUNAT; el backend también lo rechaza).
function _facMItGift(i) {
  const S = _facM; const it = S.items[i]; if (!it) return;
  if (S.export) return _facMErr('La cortesía no se mezcla con exportación');
  it.gratis = !it.gratis;
  fx(it.gratis ? 'ok' : 'sel');
  _facMRepaintItems();   // repinta la fila (🎁/precio) + el sur (el total cambia)
}
// 🌎 Exportación de servicios (turismo receptivo) = 0% IGV. Solo factura; exige pasaporte/Tax-ID + 2 servicios.
function _facMToggleExport() {
  const S = _facM;
  S.export = !S.export;
  if (S.export) (S.items || []).forEach(it => { it.gratis = false; });   // export no mezcla cortesía
  fx(S.export ? 'ok' : 'sel');
  _facMRender();   // cambia reglas + total + oculta 🎁 en las filas → render completo
}
function _facMItemRow(it, i) {
  const d = String(it.nombre || ''); const sp = d.indexOf(' — ');
  const tit = sp > 0 ? d.slice(0, sp) : d; const sub = sp > 0 ? d.slice(sp + 3) : '';
  const q = Number(it.cantidad) || 0;
  return `<div data-facm-it="${i}" style="position:relative;display:flex;align-items:center;gap:8px;padding:8px 9px;border:1px solid #f0e6e7;border-radius:11px;margin-bottom:6px;background:#fff">
    <div style="flex:1;min-width:0"><div style="font-weight:700;font-size:12.5px;color:#3d0508;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_facEscM(tit)}</div>${sub ? `<div style="font-size:10px;color:#9b6b6e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_facEscM(sub)}</div>` : ''}</div>
    ${_facM.export ? '' : `<button onclick="_facMItGift(${i})" title="${it.gratis ? 'Quitar cortesía (vuelve a cobrarse)' : 'Marcar como cortesía — gratis'}" style="width:30px;height:30px;border-radius:8px;border:1px solid ${it.gratis ? 'rgba(192,132,252,.5)' : '#eee'};background:${it.gratis ? 'rgba(192,132,252,.15)' : '#fff'};font-size:14px;cursor:pointer;line-height:1;padding:0;flex:0 0 auto">🎁</button>`}
    ${_facMPriceChip(i)}
    <button class="facm-step" onclick="_facMItQty(${i},-1)" style="width:32px;height:32px;border-radius:9px;border:1px solid #e5e7eb;background:#fff;color:#56070c;font-size:17px;font-weight:800;cursor:pointer;line-height:1">−</button>
    <span id="facm-itq-${i}" style="min-width:20px;text-align:center;font-weight:900;font-size:15px;color:#3d0508;display:inline-block">${q}</span>
    <button class="facm-step" onclick="_facMItQty(${i},1)" style="width:32px;height:32px;border-radius:9px;border:none;background:linear-gradient(135deg,#8b1a1f,#56070c);color:#fff;font-size:17px;font-weight:800;cursor:pointer;line-height:1">+</button>
  </div>`;
}
function _facMItemsHtml() {
  const rows = (_facM.items || []).map((it, i) => _facMItemRow(it, i)).join('');
  return rows || '<div style="padding:14px;text-align:center;color:#b91c1c;font-size:12px;border:1px dashed #f0c4c6;border-radius:11px;margin-bottom:8px">Sin servicios — toca ＋ para agregar</div>';
}
// Zona sur (mp + reglas + total + botón): depende del total → se repinta junta, EN SITIO.
function _facMSouthHtml() {
  const S = _facM, t = _facMTotal();
  const puede = t.total > 0 && _facMPuede();   // sin monto cobrado el botón se atenúa (no solo al tocarlo)
  const hint = t.total <= 0 ? ' · agrega un servicio' : (_facMPuede() ? '' : ' · faltan requisitos');
  const detrM = S.tipo === 1 && !S.export && t.total > 700;   // detracción SPOT (factura nacional > S/700)
  const detrMonto = detrM ? Math.round(t.total * 0.12 * 100) / 100 : 0;
  const detrNeto = detrM ? Math.round((t.total - detrMonto) * 100) / 100 : 0;
  return `${S.tipo === 1 ? `<div style="margin-bottom:10px"><button onclick="_facMToggleExport()" title="${S.export ? 'Volver a factura nacional 18%' : 'Exportación de servicios (turismo receptivo) — 0% IGV'}" style="width:100%;padding:9px;border-radius:10px;border:1px solid ${S.export ? '#0ea5e9' : '#e5e7eb'};background:${S.export ? 'rgba(14,165,233,.1)' : '#fff'};color:${S.export ? '#0369a1' : '#6b7280'};font-weight:800;font-size:12.5px;cursor:pointer">🌎 ${S.export ? 'Exportación 0% IGV — activa' : '¿Exportación? (turista extranjero)'}</button></div>` : ''}${t.total >= 2000 ? `<div style="margin-bottom:10px"><div style="font-size:11px;color:#a16207;font-weight:800;margin-bottom:4px">⚠️ ≥ S/2000 · medio de pago (bancarización)</div><select id="facm-mp" onchange="_facMSetMp(this.value)" style="width:100%;padding:10px;border:1px solid #e0b04a;border-radius:10px;font-weight:700;background:#fffdf5">${['', 'Efectivo', 'Transferencia', 'Yape/Plin', 'Tarjeta', 'Depósito en cuenta'].map(o => `<option value="${o}"${(S.medioPago || '') === o ? ' selected' : ''}>${o || 'Elige…'}</option>`).join('')}</select></div>` : ''}
    ${_facMReglasHtml()}
    ${detrM ? `<div style="margin:8px 0;padding:7px 10px;border:1px solid #A81C2D;background:#FBF0EE;border-radius:8px;line-height:1.35">
      <div style="display:flex;justify-content:space-between;gap:8px;font-weight:900;color:#A81C2D;font-size:11px"><span>Neto a pagar al proveedor</span><span>S/ ${detrNeto.toFixed(2)}</span></div>
      <div style="display:flex;justify-content:space-between;gap:8px;font-weight:800;color:#A81C2D;font-size:11px;margin-top:1px"><span>Detracción 12% → depositar en cta. BN</span><span>S/ ${detrMonto.toFixed(2)}</span></div>
    </div>` : ''}
    <div style="display:flex;justify-content:space-between;font-weight:900;font-size:17px;margin-bottom:12px;padding:10px 2px;border-top:1px dashed #e5e7eb;color:#3d0508"><span>TOTAL</span><span id="facm-tt">S/ ${t.total.toFixed(2)}</span></div>
    <button id="facm-emitir" onclick="_facMEmitir()" style="width:100%;padding:14px;border-radius:13px;border:none;background:linear-gradient(135deg,#8b1a1f,#56070c);color:#fff;font-weight:800;font-size:15px;box-shadow:0 6px 16px rgba(86,7,12,.32);${puede ? '' : 'opacity:.55'}">${S.tipo === 1 ? 'Emitir factura' : 'Emitir boleta'}${puede ? '' : hint}</button>`;
}
function _facMRepaintItems() { const el = document.getElementById('facm-items'); if (el) el.innerHTML = _facMItemsHtml(); _facMRepaintSouth(); }
function _facMRepaintSouth() { const el = document.getElementById('facm-south'); if (el) el.innerHTML = _facMSouthHtml(); }
// ── ＋ servicio: OVERLAY con check (como PS) — no estorba dentro del modal ──
function _facMSvcOvOpen() { resTap(); resHap(8); _facM._svcPick = { sel: {} }; _facMSvcOvRender(); }
function _facMSvcOvClose() { _facM._svcPick = null; const ov = document.getElementById('facm-svcov'); if (ov) ov.remove(); }
function _facMSvcOvRender() {
  const S = _facM, P = S._svcPick; if (!P) return;
  let ov = document.getElementById('facm-svcov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'facm-svcov'; ov.style.cssText = 'position:fixed;inset:0;z-index:9700;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:18px'; ov.onclick = e => { if (e.target === ov) _facMSvcOvClose(); }; document.body.appendChild(ov); }
  const n = Object.keys(P.sel).length;
  ov.innerHTML = `<div class="facm-pop" style="width:100%;max-width:380px;background:#fff;border-radius:16px;padding:14px;max-height:70vh;display:flex;flex-direction:column">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px"><span style="font-weight:900;font-size:14px;color:#3d0508">Servicios del catálogo</span><button onclick="_facMSvcOvClose()" style="border:none;background:none;font-size:20px;color:#9ca3af;cursor:pointer">×</button></div>
    <div style="flex:1;overflow-y:auto">
    ${(S.servicios || []).map(sv => { const on = !!P.sel[sv.id]; const d = String(sv.nombre || ''); const sp = d.indexOf(' — '); const tit = sp > 0 ? d.slice(0, sp) : d; const sub = sp > 0 ? d.slice(sp + 3) : '';
      return `<button data-facm-sv="${String(sv.id).replace(/"/g, '')}" onclick="_facMSvcOvToggle('${String(sv.id).replace(/'/g, '')}')" style="display:flex;width:100%;align-items:center;gap:9px;padding:10px;border-radius:11px;border:1px solid ${on ? '#c9a84c' : '#eee'};background:${on ? '#fdf6ec' : '#fff'};margin-bottom:6px;cursor:pointer;text-align:left;transition:background .15s,border-color .15s">
        <span class="facm-svchk" style="width:18px;font-weight:900;color:#8a6d1e">${on ? '✓' : ''}</span>
        <span style="flex:1;min-width:0"><span style="display:block;font-weight:700;font-size:12.5px;color:#3d0508;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_facEscM(tit)}</span>${sub ? `<span style="display:block;font-size:10px;color:#9b6b6e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_facEscM(sub)}</span>` : ''}</span>
        <span style="font-size:11px;color:#9b6b6e;white-space:nowrap">S/ ${sv.precio}</span>
      </button>`; }).join('') || '<div style="padding:12px;color:#9ca3af;font-size:12px;text-align:center">Catálogo vacío</div>'}
    </div>
    <button id="facm-svgo" onclick="_facMSvcPickAdd()" ${n ? '' : 'disabled'} style="margin-top:10px;width:100%;padding:11px;border-radius:11px;border:none;background:linear-gradient(135deg,#8b1a1f,#56070c);color:#fff;font-weight:800;font-size:13px;${n ? '' : 'opacity:.5'}">${n ? `✓ Agregar ${n} servicio${n === 1 ? '' : 's'}` : 'Elige uno o más servicios'}</button>
  </div>`;
}
function _facMSvcOvToggle(id) {
  const P = _facM._svcPick; if (!P) return;
  const on = !P.sel[id];
  if (on) P.sel[id] = true; else delete P.sel[id];
  resTap(); resHap(6);
  // EN SITIO: solo esta fila + el botón (el overlay NO se reconstruye)
  const it = document.querySelector('[data-facm-sv="' + id + '"]');
  if (it) { it.style.borderColor = on ? '#c9a84c' : '#eee'; it.style.background = on ? '#fdf6ec' : '#fff'; const chk = it.querySelector('.facm-svchk'); if (chk) chk.textContent = on ? '✓' : ''; }
  const go = document.getElementById('facm-svgo');
  if (go) { const n = Object.keys(P.sel).length; go.disabled = !n; go.style.opacity = n ? '' : '.5'; go.textContent = n ? `✓ Agregar ${n} servicio${n === 1 ? '' : 's'}` : 'Elige uno o más servicios'; }
}
function _facMSvcPickAdd() {
  const S = _facM, P = S._svcPick; if (!P) return;
  const ids = Object.keys(P.sel);
  ids.forEach(id => { const sv = (S.servicios || []).find(x => String(x.id) === String(id)); if (sv) S.items.push({ nombre: sv.nombre, precio: Number(sv.precio) || 0, cantidad: 1 }); });
  _facMSvcOvClose();
  if (ids.length) { fx('sel'); resHap([10, 25, 10]); }
  _facMRepaintItems();
}
function _facMDrop() {
  const d = document.getElementById('facm-drop'); if (!d) return;
  const S = _facM; let h = '';
  const J = o => JSON.stringify(o).replace(/'/g, '&#39;');
  // resultados previos visibles MIENTRAS busca (solo spinner cuando no hay nada que mostrar)
  if (S.resultados.length) h = S.resultados.map((c, i) => `<div class="facm-drop-item" style="animation-delay:${i * 30}ms;padding:9px 11px;border-bottom:1px solid #f3e9ea;cursor:pointer;display:flex;justify-content:space-between;gap:8px;align-items:center;${S.buscando ? 'opacity:.6' : ''}" onclick='_facMPick(${J(c)})'><span style="font-weight:700;font-size:13px;color:#3d0508">${_facEscM(c.nombre)}</span><span style="font-size:11px;color:#9ca3af;white-space:nowrap">${_facMDocLbl(c.doc_tipo)} ${_facEscM(c.doc_numero)}</span></div>`).join('');
  else if (S.buscando) h = '<div style="padding:10px;text-align:center;color:#9ca3af;font-size:12px">Buscando…</div>';
  else if (S.apiResult) { const a = S.apiResult; h = `<div class="facm-drop-item" style="padding:11px;cursor:pointer;background:#fdf6ec;border:1px solid #f0d9a8;border-radius:10px;display:flex;justify-content:space-between;gap:8px;align-items:center" onclick='_facMPickApi(${J({ doc_tipo: a.doc_tipo, doc_numero: a.doc_numero, nombre: a.nombre, direccion: a.direccion })})'><span style="font-weight:800;font-size:13px;color:#3d0508">✓ ${_facEscM(a.nombre)}</span><span style="font-size:11px;color:#a16207;white-space:nowrap">${_facMDocLbl(a.doc_tipo)}</span></div>`; }
  else if (S.noEncontrado) {
    // Mensaje honesto: por NOMBRE solo se busca en tus clientes (RENIEC/SUNAT es por documento);
    // por DNI/RUC sí se consultó el registro oficial.
    const esDoc = /^\d{8}$|^\d{11}$/.test((S.q || '').replace(/\D/g, '')) && (S.q || '').replace(/\D/g, '') === (S.q || '').trim();
    const msg = esDoc
      ? 'No está en RENIEC/SUNAT ni en tus clientes — puede ser real igual: regístralo.'
      : 'No está en tus clientes guardados. Búscalo por su DNI/RUC o regístralo a mano.';
    h = `<div class="facm-expand" style="padding:8px 2px"><div style="font-size:12px;color:#9ca3af;margin-bottom:8px">${msg}</div><div style="display:flex;gap:8px"><button onclick="_facMClearCliente()" style="flex:1;padding:9px;border-radius:10px;border:1px solid #e5e7eb;background:#fff;color:#6b7280;font-weight:700;font-size:13px">Limpiar</button><button onclick="_facMManual()" style="flex:1;padding:9px;border-radius:10px;border:none;background:linear-gradient(135deg,#8b1a1f,#56070c);color:#fff;font-weight:800;font-size:13px">＋ Registrar cliente</button></div></div>`;
  }
  d.innerHTML = h;
}
async function _facMHist() {
  const S = _facM; _facMVchStyle(); S.cargandoHist = true; _facMRender();
  try { S.historial = await window.SupaAPI.listarComprobantesDia(myOpName); } catch (e) { S.historial = []; }
  if (!_facM || _facM.tab !== 'historial') return;
  const box = document.getElementById('facm-box'); const fromH = box ? box.offsetHeight : 0;
  S.cargandoHist = false; _facMRender();
  _facMAnimHeight(fromH);   // "Cargando…" → lista: anima la altura, no salta
}
// Reenviar por WhatsApp — 3 partes (imagen ticket 80mm + PDF + texto) vía el módulo compartido.
// Móvil: navigator.share embebe la imagen + texto con enlace PDF. Escritorio/WebView: wa.me con
// texto + enlaces (imagen y PDF). Robusto en todo dispositivo.
function _facMReenviar(c, btn) {
  if (window.CPEShare && window.CPEShare.compartir) {
    window.CPEShare.compartir(c, { origen: 'ops', tel: c.cliente_tel || '', btn: btn });
  } else {   // fallback mínimo si el módulo no cargó (sin red)
    resTap(); resOk();
    const numero = c.serie + '-' + String(c.numero).padStart(6, '0');
    const pdf = String(c.enlace_pdf || ''); const realPdf = /^https?:\/\//.test(pdf);
    const msg = 'Hola ' + (c.cliente_nombre || '') + ', tu comprobante ' + numero + (realPdf ? ': ' + pdf : ' por S/ ' + (c.total || 0));
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  }
}
// ── VOUCHER de detracción (constancia del depósito del 12% en cta. BN) — botón verde/rojo en el historial ──
function _facMVchStyle() { if (document.getElementById('facm-vch-style')) return; var s = document.createElement('style'); s.id = 'facm-vch-style'; s.textContent = '@keyframes facmVchPulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.35)}50%{box-shadow:0 0 0 5px rgba(220,38,38,0)}}'; document.head.appendChild(s); }
function _facMVchFind(id) { return ((_facM && _facM.historial) || []).find(function (x) { return String(x.id) === String(id); }); }
function _facMVoucher(id) {
  var c = _facMVchFind(id); if (!c) return;
  if (c.detraccion_voucher && String(c.detraccion_voucher).trim()) _facMVoucherVer(id);
  else _facMVoucherPick(id);
}
function _facMVchCloseSheet() { var s = document.getElementById('facm-vch-sheet'); if (s) s.remove(); }
function _facMVoucherPick(id) {
  _facMVchCloseSheet();
  var ov = document.createElement('div'); ov.id = 'facm-vch-sheet';
  ov.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center';
  ov.innerHTML = '<div style="width:100%;max-width:430px;background:#fff;border-radius:18px 18px 0 0;padding:18px;padding-bottom:max(18px,env(safe-area-inset-bottom))" onclick="event.stopPropagation()">' +
    '<div style="font-weight:800;font-size:15px;color:#3d0508;margin-bottom:3px">Voucher de detracción</div>' +
    '<div style="font-size:12px;color:#9b6b6e;margin-bottom:13px;line-height:1.4">Sube la constancia del depósito del 12% en la cuenta del Banco de la Nación.</div>' +
    '<label style="display:flex;align-items:center;gap:10px;padding:14px;border:1px solid #f0e6e7;border-radius:12px;margin-bottom:9px;font-weight:700;font-size:14px;color:#3d0508;cursor:pointer">📷 Tomar foto<input type="file" accept="image/*" capture="environment" style="display:none" onchange="_facMVoucherUpload(&#39;' + id + '&#39;,this.files&&this.files[0])"></label>' +
    '<label style="display:flex;align-items:center;gap:10px;padding:14px;border:1px solid #f0e6e7;border-radius:12px;margin-bottom:9px;font-weight:700;font-size:14px;color:#3d0508;cursor:pointer">🖼️ Elegir de galería<input type="file" accept="image/*" style="display:none" onchange="_facMVoucherUpload(&#39;' + id + '&#39;,this.files&&this.files[0])"></label>' +
    '<button onclick="_facMVchCloseSheet()" style="width:100%;padding:12px;border:none;background:transparent;color:#9b6b6e;font-weight:700;font-size:14px;cursor:pointer">Cancelar</button>' +
    '</div>';
  ov.onclick = function (e) { if (e.target === ov) _facMVchCloseSheet(); };
  document.body.appendChild(ov); resHap(8);
}
async function _facMVoucherUpload(id, file) {
  _facMVchCloseSheet(); if (!file) return;
  var c = _facMVchFind(id); if (!c) return;
  try {
    mostrarToast('Subiendo voucher…');
    var ext = (file.type && file.type.indexOf('png') >= 0) ? 'png' : 'jpg';
    var path = 'voucher/' + String(id) + '.' + ext;
    var up = await window.SupaAPI.sb.storage.from('comprobante-pdfs').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true });
    if (up.error) throw up.error;
    var r = await window.SupaAPI.post('set_detraccion_voucher', { ref_id: id, path: path });
    if (!r || r.status === 'error') throw new Error('no se pudo guardar');
    c.detraccion_voucher = path; fx('ok'); mostrarToast('✓ Voucher guardado'); _facMRender();
  } catch (e) { fx('err'); mostrarToast('No se pudo subir el voucher', 'error'); }
}
function _facMVchCerrar() { var s = document.getElementById('facm-vch-ov'); if (s) s.remove(); }
async function _facMVoucherVer(id) {
  var c = _facMVchFind(id); if (!c || !c.detraccion_voucher) return;
  var url = '';
  try { var sd = await window.SupaAPI.sb.storage.from('comprobante-pdfs').createSignedUrl(c.detraccion_voucher, 3600); url = (sd.data && sd.data.signedUrl) || ''; } catch (e) {}
  if (!url) { mostrarToast('No se pudo abrir el voucher', 'error'); return; }
  var ov = document.createElement('div'); ov.id = 'facm-vch-ov';
  ov.style.cssText = 'position:fixed;inset:0;z-index:10060;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:16px';
  ov.innerHTML = '<div style="width:100%;max-width:430px;background:#fff;border-radius:16px;overflow:hidden;position:relative">' +
    '<button onclick="_facMVchCerrar()" style="position:absolute;top:8px;right:10px;z-index:2;border:none;background:rgba(0,0,0,.5);color:#fff;width:30px;height:30px;border-radius:50%;font-size:17px;cursor:pointer">×</button>' +
    '<div style="max-height:70vh;overflow:auto"><img src="' + url + '" alt="Voucher de detracción" style="width:100%;display:block"></div>' +
    '<div style="display:flex;gap:8px;padding:10px 12px">' +
    '<button onclick="_facMVchCerrar();_facMVoucherPick(&#39;' + id + '&#39;)" style="flex:1;padding:11px;border-radius:11px;border:1px solid #f0e6e7;background:#fff;color:#3d0508;font-weight:700;cursor:pointer">Cambiar</button>' +
    '<button onclick="_facMVoucherDel(&#39;' + id + '&#39;)" style="flex:1;padding:11px;border-radius:11px;border:none;background:linear-gradient(135deg,#b91c1c,#7f1d1d);color:#fff;font-weight:800;cursor:pointer">Quitar</button>' +
    '</div></div>';
  ov.onclick = function (e) { if (e.target === ov) _facMVchCerrar(); };
  document.body.appendChild(ov);
}
async function _facMVoucherDel(id) {
  var c = _facMVchFind(id); if (!c) return;
  try { if (c.detraccion_voucher) await window.SupaAPI.sb.storage.from('comprobante-pdfs').remove([c.detraccion_voucher]); } catch (e) {}
  try {
    var r = await window.SupaAPI.post('set_detraccion_voucher', { ref_id: id, path: '' });
    if (!r || r.status === 'error') throw new Error('error');
    c.detraccion_voucher = null; _facMVchCerrar(); fx('sel'); _facMRender();
  } catch (e) { mostrarToast('No se pudo quitar el voucher', 'error'); }
}
function _facMAnularToggle(id) { const S = _facM; S.anularId = (S.anularId === id ? null : id); S._anularMotivo = ''; resTap(); resHap(8); _facMRender(); }
async function _facMAnularEnviar(id) {
  const S = _facM; const motivo = (S._anularMotivo || '').trim();
  if (!motivo) return _facMErr('Escribe el motivo de la anulación');
  fx('tap');
  const r = await window.SupaAPI.solicitarAnulacion(id, motivo, myOpName);
  if (r && r.ok) { fx('ok'); S.anularId = null; mostrarToast('Solicitud enviada a PS para revisión', 'success'); _facMHist(); }
  else _facMErr((r && r.message || 'No se pudo solicitar').replace(/^.*?:\s*/, ''));
}
function _facMTotal() {
  const items = _facM.items || [];
  // Cortesías (🎁 gratuito) NO suman al total a cobrar; Exportación = 0% IGV (el backend fija la afectación).
  const total = items.reduce((a, it) => it.gratis ? a : a + (Number(it.cantidad) || 0) * (Number(it.precio) || 0), 0);
  const gratis = items.reduce((a, it) => it.gratis ? a + (Number(it.cantidad) || 0) * (Number(it.precio) || 0) : a, 0);
  const esExport = !!_facM.export;
  const grav = esExport ? 0 : Math.round(total / 1.18 * 100) / 100;
  return { total: Math.round(total * 100) / 100, grav, igv: esExport ? 0 : Math.round((total - grav) * 100) / 100, gratis: Math.round(gratis * 100) / 100, esExport };
}
// Motor de reglas SUNAT en vivo: devuelve [{ok, dura, txt}] según el estado actual del modal.
function _facMReglas() {
  const S = _facM, t = _facMTotal(), cli = S.cliente, rules = [];
  const doc = cli && cli.doc_tipo !== '0' ? (cli.doc_numero || '') : '';
  const esTaxId = cli && cli.doc_tipo === '0' && cli.doc_numero && cli.doc_numero !== '00000000';   // '0' con doc REAL = Tax-ID extranjero
  if (S.export) { // EXPORTACIÓN (0% IGV) — factura a turista/empresa extranjera
    rules.push({ dura: true, ok: !!cli && (cli.doc_tipo === '7' || esTaxId) && !!(cli.doc_numero || ''), txt: 'Exportación → pasaporte del turista o Tax-ID extranjero' });
    rules.push({ dura: true, ok: (S.items || []).length >= 2, txt: 'Paquete de 2 o más servicios' });
  } else if (S.tipo === 1) { // FACTURA
    rules.push({ dura: true, ok: !!cli && cli.doc_tipo === '6' && /^\d{11}$/.test(doc), txt: 'Factura → RUC de 11 dígitos' });
    rules.push({ dura: true, ok: !!cli && !!(cli.nombre || '').trim(), txt: 'Razón social' });
    rules.push({ dura: true, ok: !!cli && !!(cli.direccion || '').trim(), txt: 'Dirección fiscal' });
  } else if (t.total > 700) { // BOLETA > 700
    rules.push({ dura: true, ok: !!doc, txt: 'Boleta > S/700 → identificar cliente (DNI/CE/pasaporte)' });
    rules.push({ dura: true, ok: !!cli && !!(cli.nombre || '').trim(), txt: 'Nombre del cliente' });
  }
  if (t.total >= 2000) {
    rules.push({ dura: true, ok: !!S.medioPago, txt: 'Medio de pago (bancarización ≥ S/2000)' });
  }
  return rules;
}
function _facMSetMp(v) { _facM.medioPago = v; _facMRepaintSouth(); }
// Toggle Boleta⇄Factura SUAVE: desliza la pastilla + repinta solo requisitos/total/botón (fade).
function _facMSetTipo(t) {
  const S = _facM; if (S.tipo === t) return;
  S.tipo = t; if (t === 2) S.export = false;   // exportación solo aplica a factura
  resTap(); resHap(6);
  const pill = document.getElementById('facm-tgl-pill'); if (pill) pill.style.transform = t === 1 ? 'translateX(100%)' : 'translateX(0)';
  const bB = document.getElementById('facm-tgl-b'), bF = document.getElementById('facm-tgl-f');
  if (bB) bB.style.color = t === 2 ? '#56070c' : '#9b7d80';
  if (bF) bF.style.color = t === 1 ? '#56070c' : '#9b7d80';
  _facMRepaintCli();   // Varios pasa a inválido (pulso rojo) en Factura; el buscador oculta "Varios"
  const south = document.getElementById('facm-south');
  if (south) { south.innerHTML = _facMSouthHtml(); south.classList.remove('facm-softfade'); void south.offsetWidth; south.classList.add('facm-softfade'); }
  else _facMRepaintSouth();
}
// Chip de estado SUNAT para el historial
function _facMChip(c) {
  // baja enviada a SUNAT pero aún no confirmada (asíncrona): no mentir que ya está anulada
  if (c.estado === 'anulada' && c.anulacion_estado === 'enviada') return '<span style="font-size:9px;font-weight:800;background:#fef9c3;color:#a16207;border-radius:6px;padding:1px 6px">⊘ baja enviada</span>';
  if (c.estado === 'anulada' || c.anulacion_estado === 'aprobada') return '<span style="font-size:9px;font-weight:800;background:#eee;color:#888;border-radius:6px;padding:1px 6px">⊘ anulada</span>';
  const m = { aceptada: ['🟢', '#15803d', '#dcfce7', 'SUNAT'], pendiente: ['🟡', '#a16207', '#fef9c3', 'pendiente'], rechazada: ['🔴', '#b91c1c', '#fee2e2', 'rechazada'], stub: ['⚪', '#6b7280', '#f3f4f6', 'demo'] }[c.estado] || ['⚪', '#6b7280', '#f3f4f6', c.estado || '—'];
  return `<span style="font-size:9px;font-weight:800;background:${m[2]};color:${m[1]};border-radius:6px;padding:1px 6px">${m[0]} ${m[3]}</span>`;
}
function _facMReglasHtml() {
  const rules = _facMReglas();
  if (!rules.length) return '';
  const filas = rules.map(r => `<div style="display:flex;align-items:center;gap:7px;font-size:11.5px;padding:2px 0;color:${r.ok ? '#15803d' : '#a16207'}"><span style="width:14px">${r.ok ? '✅' : '⛔'}</span>${r.txt}</div>`).join('');
  return `<div style="background:#faf7f2;border:1px solid #eadfce;border-radius:11px;padding:9px 11px;margin-bottom:10px"><div style="font-size:10px;color:#9b7d80;font-weight:800;letter-spacing:.5px;margin-bottom:3px">REQUISITOS SUNAT</div>${filas}</div>`;
}
function _facMPuede() { return _facMReglas().every(r => !r.dura || r.ok); }   // ¿cumple todas las reglas duras?
function _facMErr(m) { fx('err'); mostrarToast('⚠️ ' + m, 'error'); if (_facM){ _facM.shake=true; _facMRender(); setTimeout(()=>{ if(_facM){_facM.shake=false;_facMRender();} },450); } }
// Mini-feed OPTIMISTA de emisiones (arriba del Emitir): "enviando → ✓/⏳/⚠".
function _facMFeedHtml() {
  const S = _facM; const f = S._feed || [];
  if (!f.length) return '';
  return '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">' + f.map((e, i) => {
    if (e.estado === 'enviando') return `<div class="facm-feed-it" style="display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:11px;background:#fff7ed;border:1px solid #fed7aa;font-size:12px;color:#9a3412"><span class="facm-spin"></span><span style="flex:1;min-width:0">Emitiendo · ${_facEscM(e.nombre)} · S/ ${e.total.toFixed(2)}</span></div>`;
    if (e.estado === 'error') return `<div class="facm-feed-it" style="display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:11px;background:#fef2f2;border:1px solid #fecaca;font-size:11.5px;color:#b91c1c"><span>⚠</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${_facEscM(e._err || 'No se pudo emitir')}</span><button onclick="_facMReintentar(${i})" style="border:none;background:#b91c1c;color:#fff;font-weight:800;font-size:11px;border-radius:7px;padding:5px 11px;cursor:pointer;flex:0 0 auto">Reintentar</button></div>`;
    const num = e.serie + '-' + String(e.numero).padStart(6, '0'); const pend = e.estado === 'pendiente';
    return `<div class="facm-feed-it" style="display:flex;align-items:center;gap:8px;padding:9px 11px;border-radius:11px;background:${pend ? '#fefce8' : '#f0fdf4'};border:1px solid ${pend ? '#fde68a' : '#bbf7d0'};font-size:12px;color:${pend ? '#a16207' : '#15803d'}"><span>${pend ? '⏳' : '✓'}</span><span style="flex:1;min-width:0;font-weight:800">${num}${pend ? ' · en proceso' : ''}</span><span style="color:#6b7280">S/ ${e.total.toFixed(2)}</span></div>`;
  }).join('') + '</div>';
}
function _facMRepaintFeed() { const el = document.getElementById('facm-feed'); if (el) el.innerHTML = _facMFeedHtml(); }
function _facMReintentar(i) { const e = _facM._feed && _facM._feed[i]; if (!e) return; resTap(); resHap(8); _facMSend(e); }
// EMISIÓN OPTIMISTA: libera el formulario al instante, el feed resuelve en 2º plano.
function _facMEmitir() {
  const S = _facM;
  if (!S.cliente) return _facMErr('Elige o registra un cliente');
  const items = (S.items || []).filter(it => (Number(it.cantidad) || 0) > 0);
  const t = _facMTotal();
  if (!items.length || t.total <= 0) return _facMErr('Agrega al menos un servicio con monto');
  if (!items.some(it => !it.gratis)) return _facMErr('La cortesía necesita al menos un servicio cobrado');
  if (items.some(it => !it.gratis && (Number(it.precio) || 0) <= 0)) return _facMErr('Hay un servicio a S/0 — marca 🎁 para cortesías');
  if (!_facMPuede()) return _facMErr('Faltan requisitos SUNAT — revisa la lista');
  if (t.total >= 2000 && !S.medioPago) return _facMErr('Elige el medio de pago (operación ≥ S/2000 · bancarización)');
  if (S._emitCd && (window.performance.now() - S._emitCd) < 600) return;   // anti doble-toque
  S._emitCd = window.performance.now();
  const cli = S.cliente;
  const payload = {
    tipo: S.tipo, serie: S.tipo === 1 ? S.serieF : S.serieB,
    cliente_doc_tipo: cli.doc_tipo, cliente_doc: (cli.doc_tipo === '0' && (!cli.doc_numero || cli.doc_numero === '00000000')) ? '' : cli.doc_numero, cliente_nombre: cli.nombre,   // '0' con doc REAL = Tax-ID extranjero (no blanquear); '0' vacío/00000000 = Varios
    cliente_email: '', cliente_tel: '', cliente_dir: cli.direccion || '', es_extranjero: !!S.export || !!cli.es_extranjero,
    items: items.map(it => Object.assign({ descripcion: it.nombre, cantidad: Number(it.cantidad) || 0, precio: Number(it.precio) || 0 }, it.gratis ? { afectacion: 'gratuito' } : {})),
    exonerado: false, medio_pago: S.medioPago || null, exportacion: !!S.export, detraccion: (S.tipo === 1 && !S.export && t.total > 700), operador: myOpName,   // SPOT 037: factura nacional > S/700
    localId: 'facm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)   // idempotente por intento (mismo en reintentos)
  };
  const entry = { estado: 'enviando', nombre: cli.nombre, total: t.total, _payload: payload };
  S._feed = S._feed || []; S._feed.unshift(entry); if (S._feed.length > 5) S._feed.length = 5;
  fx('emit'); resHap([10, 25, 10]);
  // libera el form YA — el operador arranca el siguiente sin esperar a SUNAT
  S.cliente = { doc_tipo: '0', doc_numero: '', nombre: 'Cliente varios' };
  S.tipo = 2; S.export = false;   // vuelve a Boleta nacional — evita quedar Factura+Varios pulsando rojo tras emitir
  S.items = []; S.exonerado = false; S.medioPago = ''; S.q = ''; S.resultados = [];   // A3: NO re-poblar el paquete por defecto → el botón queda bloqueado hasta agregar un servicio (evita re-emitir un CPE real por doble toque)
  _facMRender();
  _facMSend(entry);
}
async function _facMSend(entry) {
  entry.estado = 'enviando'; entry._err = null; _facMRepaintFeed();
  let r;
  try { r = await window.SupaAPI.post('emitir_comprobante', entry._payload); }
  catch (e) { r = { status: 'error', message: e.message }; }
  if (!_facM) return;
  if (r && r.status !== 'error' && (r.id || r.numero) && r.estado !== 'rechazada') {
    entry.estado = (r.estado === 'pendiente') ? 'pendiente' : 'ok';
    entry.serie = r.serie; entry.numero = r.numero;
    _facM.contadorHoy++;
    fx(entry.estado === 'pendiente' ? 'warn' : 'emit'); resHap([12, 30, 12]);
    _facMPlusFloat();
    _facMRepaintFeed(); _facMRepaintHistBadge();
  } else {
    entry.estado = 'error';
    entry._err = String((r && (r.errores || r.message)) || 'No se pudo emitir').replace(/^.*?:\s*/, '').slice(0, 120);
    fx('err'); resHap([50, 25, 50]);
    _facMRepaintFeed();
  }
}
function _facMPlusFloat() {
  const box = document.getElementById('facm-box'); if (!box) return;
  const el = document.createElement('div'); el.className = 'facm-plusone'; el.textContent = '+1'; box.appendChild(el); setTimeout(() => el.remove(), 1150);
}
function _facMRepaintHistBadge() {
  const b = document.getElementById('facm-histbadge'); const n = _facM.contadorHoy;
  if (b) b.textContent = n || '';
  else { const t = document.getElementById('facm-historialtab'); if (t && n) t.insertAdjacentHTML('beforeend', `<span id="facm-histbadge" style="background:#56070c;color:#fff;border-radius:999px;font-size:10px;font-weight:800;padding:1px 6px;margin-left:5px">${n}</span>`); }
}
function _facMRender() {
  let ov = document.getElementById('facm-ov');
  if (!ov) { ov = document.createElement('div'); ov.id = 'facm-ov'; ov.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center'; ov.onclick = e => { if (e.target === ov) cerrarBoletaMuelle(); }; document.body.appendChild(ov); }
  ov.style.display = 'flex';
  const S = _facM, t = _facMTotal();
  const esFactura = S.tipo === 1;

  // ─────────── EMITIR ───────────
  // Toggle Boleta/Factura = pastilla DESLIZANTE (segmented control iOS): cambiar NO re-renderiza
  // el modal (todo es casi igual); solo desliza la pastilla y repinta los requisitos con un fade.
  let emitir = `
    <div id="facm-feed">${_facMFeedHtml()}</div>
    <div style="position:relative;display:flex;background:#f6eef0;border-radius:12px;padding:4px;margin-bottom:12px">
      <div id="facm-tgl-pill" style="position:absolute;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);background:#fff;border-radius:9px;box-shadow:0 2px 6px rgba(86,7,12,.12);transition:transform .28s cubic-bezier(.34,1.4,.5,1);transform:translateX(${esFactura ? '100%' : '0'})"></div>
      <button id="facm-tgl-b" onclick="_facMSetTipo(2)" style="position:relative;z-index:1;flex:1;padding:9px;border-radius:9px;font-weight:800;font-size:13px;border:none;background:none;cursor:pointer;transition:color .2s;color:${!esFactura ? '#56070c' : '#9b7d80'}">Boleta</button>
      <button id="facm-tgl-f" onclick="_facMSetTipo(1)" style="position:relative;z-index:1;flex:1;padding:9px;border-radius:9px;font-weight:800;font-size:13px;border:none;background:none;cursor:pointer;transition:color .2s;color:${esFactura ? '#56070c' : '#9b7d80'}">Factura</button>
    </div>
    `;   // "Jalar zarpe" fuera del muelle: es tarea del ADMIN en PS Panel (decisión dueño 2026-08-03)
  emitir += `<div id="facm-cli">${_facMCliHtml()}</div>`;
  // ── SERVICIOS como en PS: lista con stepper por línea + ＋ overlay del catálogo ──
  emitir += `<div style="display:flex;align-items:center;justify-content:space-between;margin:2px 0 7px">
      <div style="font-size:11px;color:#6b7280;font-weight:800;letter-spacing:.4px">SERVICIOS</div>
      <button onclick="_facMSvcOvOpen()" title="Agregar servicio del catálogo" style="width:30px;height:30px;border-radius:9px;border:1px dashed #c9a84c;background:#fffdf5;color:#8a6d1e;font-size:16px;font-weight:800;cursor:pointer;line-height:1">＋</button>
    </div>
    <div id="facm-items">${_facMItemsHtml()}</div>
    <div id="facm-south">${_facMSouthHtml()}</div>`;

  // ─────────── HISTORIAL ───────────
  let historial;
  if (S.cargandoHist) historial = '<div style="padding:30px;text-align:center;color:#9ca3af;font-size:13px">Cargando…</div>';
  else if (!S.historial.length) historial = '<div style="padding:34px 12px;text-align:center;color:#9ca3af;font-size:13px">Aún no emitiste comprobantes hoy.</div>';
  else historial = S.historial.map((c, i) => {
    const num = c.serie + '-' + String(c.numero).padStart(6, '0');
    const anulada = c.estado === 'anulada' || c.anulacion_estado === 'aprobada';
    const pend = c.anulacion_estado === 'solicitada';
    const abierto = S.anularId === c.id;
    const cj = JSON.stringify(c).replace(/'/g, '&#39;');
    const detrM = !!(c.detraccion || Number(c.detraccion_total) > 0);   // factura con detracción → control de voucher
    const vhas = !!(c.detraccion_voucher && String(c.detraccion_voucher).trim());
    return `<div class="facm-row" style="animation-delay:${i*40}ms;border:1px solid #f0e6e7;border-radius:13px;padding:11px;margin-bottom:9px;${anulada?'opacity:.55':''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="min-width:0"><div style="font-weight:800;font-size:13px;color:#3d0508;${anulada?'text-decoration:line-through':''}">${num} ${_facMChip(c)}</div><div style="font-size:11px;color:#9b6b6e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_facEscM(c.cliente_nombre||'—')} · ${c.hora}</div></div>
        <div style="font-weight:800;font-size:13px;color:#56070c;white-space:nowrap">S/ ${(c.total||0)}</div>
      </div>
      ${pend?'<div style="margin-top:7px;font-size:11px;font-weight:700;color:#a16207;background:#fdf6ec;border-radius:7px;padding:4px 8px">⏳ Anulación en revisión por PS</div>':''}
      ${anulada?'<div style="margin-top:7px;font-size:11px;font-weight:700;color:#9ca3af">Anulada</div>':`
      <div style="display:flex;gap:6px;margin-top:9px">
        <button onclick='_facMReenviar(${cj},this)' style="flex:1.6;padding:8px;border-radius:9px;border:none;background:#25D366;color:#fff;font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px"><i class="fab fa-whatsapp" style="font-size:15px"></i> Enviar</button>
        ${detrM ? `<button onclick="_facMVoucher('${c.id}')" title="${vhas ? 'Voucher de detracción cargado — ver/cambiar' : 'Falta el voucher de detracción (12% BN) — subir'}" aria-label="Voucher de detracción" style="flex:0 0 auto;padding:8px 11px;border-radius:9px;border:1px solid ${vhas ? '#22c55e' : '#dc2626'};background:${vhas ? '#f0fdf4' : '#fef2f2'};color:${vhas ? '#15803d' : '#dc2626'};font-weight:800;font-size:14px;cursor:pointer${vhas ? '' : ';animation:facmVchPulse 1.5s ease-in-out infinite'}">🧾</button>` : ''}
        <button onclick="_facMAnularToggle('${c.id}')" style="flex:1;padding:8px;border-radius:9px;border:1px solid ${abierto?'#dc2626':'#f0c4c6'};background:${abierto?'#fef2f2':'#fff'};color:#dc2626;font-weight:800;font-size:12px;cursor:pointer">⊘ Anular</button>
      </div>
      ${abierto?`<div class="facm-expand" style="margin-top:8px"><input id="facm-anmot" placeholder="Motivo de la anulación…" value="${_facEscM(S._anularMotivo)}" style="width:100%;padding:9px;border:1px solid #f0c4c6;border-radius:9px;margin-bottom:6px;font-size:13px"><button onclick="_facMAnularEnviar('${c.id}')" style="width:100%;padding:9px;border-radius:9px;border:none;background:linear-gradient(135deg,#b91c1c,#7f1d1d);color:#fff;font-weight:800;font-size:13px">Enviar solicitud a PS</button><div style="font-size:10px;color:#9ca3af;margin-top:4px;text-align:center">No anula directo — un admin de PS revisa y aprueba.</div></div>`:''}`}
    </div>`;
  }).join('');

  const histBadge = S.contadorHoy ? `<span id="facm-histbadge" style="background:#56070c;color:#fff;border-radius:999px;font-size:10px;font-weight:800;padding:1px 6px;margin-left:5px">${S.contadorHoy}</span>` : '';
  const tabBtn = (id, label, extra) => `<button id="facm-${id}tab" onclick="_facMTab('${id}')" style="flex:1;padding:9px;border:none;background:none;cursor:pointer;font-weight:800;font-size:13px;border-bottom:2px solid ${S.tab===id?'#56070c':'transparent'};color:${S.tab===id?'#56070c':'#9b7d80'}">${label}${extra||''}</button>`;

  // ANTI-PARPADEO: slideUp SOLO al abrir — un re-render no debe "reaparecer" el modal entero
  const _anim = S.shake ? 'animation:siShakeM .42s' : (S._animado ? '' : 'animation:slideUp .25s ease');
  S._animado = true;
  // Cambio Emitir⇄Historial SUAVE: el cuerpo hace fade y el modal ANIMA su altura hacia el
  // contenido natural (sin min-height acumulativo — antes crecía y nunca encogía).
  const bodyFade = S._tabFade ? ' facm-tabfade' : ''; S._tabFade = false;
  ov.innerHTML = `<div id="facm-box" style="position:relative;width:100%;max-width:430px;background:#fff;border-radius:20px 20px 0 0;padding:18px;padding-bottom:max(18px,env(safe-area-inset-bottom));max-height:92vh;overflow-y:auto;${_anim}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="width:38px;height:38px;border-radius:12px;background:linear-gradient(140deg,#7a1015,#56070c);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(86,7,12,.3)"><span style="color:#e8b840;display:flex">${_FAC_ICON.replace('<svg ', '<svg width="21" height="21" ')}</span></div><div style="flex:1;font-weight:900;font-size:17px;color:#3d0508">Facturación</div><button onclick="cerrarBoletaMuelle()" style="font-size:24px;color:#9ca3af;background:none;border:none">×</button></div>
    <div style="display:flex;border-bottom:1px solid #f0e6e7;margin-bottom:14px">${tabBtn('emitir','Emitir')}${tabBtn('historial','Historial',histBadge)}</div>
    <div id="facm-tabbody" class="${bodyFade}">${S.tab === 'emitir' ? emitir : historial}</div>
  </div>`;

  const g = id => ov.querySelector('#' + id);
  _facMBindCli();
  if (g('facm-mdoc')) { const el = g('facm-mdoc'); el.oninput = e => { S._manualDoc = e.target.value; }; }
  if (g('facm-mnom')) { const el = g('facm-mnom'); el.oninput = e => { S._manualNombre = e.target.value; }; if (!S._manualNombre) el.focus(); }
  if (g('facm-mdir')) { const el = g('facm-mdir'); el.oninput = e => { S._manualDir = e.target.value; }; }
  // (WhatsApp/correo y PAX/P.U. globales eliminados — decisión dueño 2026-08-03: items por servicio como PS)
  if (g('facm-anmot')) g('facm-anmot').oninput = e => { S._anularMotivo = e.target.value; };
}
function toggleVencidas() {
    window._resVencidasOpen = !window._resVencidasOpen;
    resTap(); resHap(8);
    const c = document.getElementById('reservas-container');
    if (c) { c._fp = null; renderReservas(window.reservasData || []); }
}
function _resAutorChip(res) {
    let autor = String(res.creado_por || '').trim();
    if (!autor) return '';
    let mio = autor.toLowerCase() === String(myOpName || '').trim().toLowerCase();
    return `<span class="text-[9px] text-gray-400 font-semibold whitespace-nowrap"><i class="fas fa-user-pen text-[8px] mr-0.5"></i>${mio ? 'por ti' : 'por ' + _resEsc(autor)}</span>`;
}

// Tarjeta HOY · POR EMBARCAR (héroe = hora + familia, con CTA)
function _resCardHoy(res) {
    let isSyncing   = res.id === 'Creando...';
    let isAsignando = !!res._asignando;
    let clienteEsc  = _resArg(res.cliente);
    let contactoEsc = _resArg(res.contacto);
    let hd = _resHoraDisp(res.hora);
    let pasoHora = false;
    if (!isSyncing && !isAsignando) {
        let hMin = _resHoraMin(res.hora);
        if (hMin < 1440) { let now = new Date(); pasoHora = (now.getHours() * 60 + now.getMinutes()) > hMin; }
    }
    let isQueued = !!res._queued;   // POST sin red → en cola offline (se reenvía al reconectar)
    let border = isAsignando ? 'border-green-400 bg-green-50' : isQueued ? 'border-amber-400 bg-amber-50' : isSyncing ? 'border-yellow-300 bg-yellow-50' : pasoHora ? 'border-amber-300 bg-amber-50' : 'border-blue-500 bg-white';
    let btnCls = (isSyncing || isAsignando) ? 'pointer-events-none ' + (isQueued ? 'bg-amber-400 text-white' : 'bg-green-400 text-white') : 'bg-green-500 text-white shadow-md shadow-green-500/20 hover:bg-green-600 border-green-600 active:scale-95';
    let btnIcon = isAsignando ? 'fa-ship fa-pulse' : isQueued ? 'fa-wifi' : isSyncing ? 'fa-sync-alt fa-spin' : 'fa-clipboard-check';
    let btnText = isAsignando ? '¡Abordando!' : isQueued ? 'En cola 📶 — al reconectar' : isSyncing ? 'Registrando…' : 'Subir a lancha';
    return `<div class="${border} border border-l-[5px] rounded-2xl shadow-sm p-3.5 mb-2.5 card-enter relative overflow-hidden" data-res-id="${res.id}">
        ${isQueued ? '<div class="absolute top-2 right-3 text-[9px] text-amber-600 font-bold"><i class="fas fa-clock mr-1"></i>Pendiente de red</div>' : isSyncing ? '<div class="absolute top-2 right-3 text-[9px] text-yellow-600 font-bold"><i class="fas fa-satellite-dish mr-1 animate-ping"></i>Nube</div>' : ''}
        <div class="flex items-center gap-3">
            <div class="text-center shrink-0 ${pasoHora ? 'text-amber-600' : 'text-blue-600'}" style="min-width:64px">
                <div class="font-black text-2xl leading-none">${_resEsc(hd.t)}${hd.ap ? `<span class="text-[10px] font-bold ml-0.5 align-top">${hd.ap}</span>` : ''}</div>
                <div class="text-[8px] font-bold uppercase tracking-wider mt-1 ${pasoHora ? 'text-amber-500' : 'text-gray-400'}">${pasoHora ? '⚠ ya pasó' : 'reservó'}</div>
            </div>
            <div class="flex-1 min-w-0">
                <h3 class="font-extrabold text-gray-800 text-base leading-tight truncate">${_resEsc(res.cliente)}</h3>
                <div class="flex items-center gap-2 mt-1 flex-wrap">
                    <span class="text-[10px] text-gray-600 font-bold"><i class="fas fa-users text-[9px] mr-0.5 text-blue-400"></i>${res.pax} PAX</span>
                    ${res.monto ? `<span class="text-[10px] text-gray-500 font-bold">S/ ${res.monto}</span>` : ''}
                    <span class="text-[9px] text-gray-400 truncate"><i class="fas fa-building text-[8px] mr-0.5"></i>${_resEsc((res.contacto || '').replace('_', ' '))}</span>
                    ${_resAutorChip(res)}
                </div>
            </div>
        </div>
        <div class="flex mt-3 gap-2">
            <button class="flex-[2] py-2.5 rounded-xl text-sm font-bold transition border ${btnCls}" onclick="resTap();resHap(10);prepararAsignacion('${res.id}', '${clienteEsc}', '${res.pax}', '${contactoEsc}')"><i class="fas ${btnIcon} mr-1"></i>${btnText}</button>
            ${(!isSyncing && !isAsignando) ? `<button class="px-3 py-2.5 rounded-xl text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200 hover:bg-purple-200 transition active:scale-95" onclick="resTap();resHap(10);abrirPaseDesdeReserva('${res.id}', '${clienteEsc}', '${res.pax}', '${contactoEsc}')"><i class="fas fa-share-square mr-1"></i>Pasar</button>` : ''}
        </div>
    </div>`;
}

// Tarjeta HOY · YA EMBARCÓ (tachada, sin CTA)
function _resCardDone(res) {
    let pasado = String(res.estado || '').toLowerCase() === 'pasado';
    let badge = pasado
        ? '<span class="text-[9px] font-black text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full shrink-0">✓ pasado</span>'
        : '<span class="text-[9px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">✓ a bordo</span>';
    let hd = _resHoraDisp(res.hora);
    return `<div class="bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 mb-2 flex items-center gap-3 card-enter" data-res-id="${res.id}">
        <div class="font-bold text-sm text-gray-400 line-through shrink-0" style="min-width:56px;text-align:center">${_resEsc(hd.t)}${hd.ap ? `<span class="text-[8px] ml-0.5">${hd.ap}</span>` : ''}</div>
        <div class="flex-1 min-w-0">
            <div class="font-bold text-gray-500 text-sm line-through truncate">${_resEsc(res.cliente)}</div>
            <div class="text-[9px] text-gray-400">${res.pax} PAX · ${_resEsc((res.contacto || '').replace('_', ' '))}</div>
        </div>
        ${badge}
    </div>`;
}

// Tarjeta futura / vencida (compacta, solo lectura)
function _resCardFutura(res, vencida) {
    let tone = vencida ? 'bg-gray-50 border-gray-200 opacity-75' : 'bg-white border-gray-100 shadow-sm';
    let hd = _resHoraDisp(res.hora);
    return `<div class="${tone} border rounded-xl px-3.5 py-2.5 mb-2 flex items-center gap-3 card-enter" data-res-id="${res.id}">
        <div class="text-center shrink-0 ${vencida ? 'text-gray-400' : 'text-emerald-600'}" style="min-width:56px">
            <div class="font-black text-sm leading-none">${_resEsc(hd.t)}${hd.ap ? `<span class="text-[8px] ml-0.5 font-bold">${hd.ap}</span>` : ''}</div>
            ${vencida ? '' : '<div class="text-[8px] text-emerald-500 font-bold mt-0.5">✓ ok</div>'}
        </div>
        <div class="flex-1 min-w-0">
            <div class="font-bold ${vencida ? 'text-gray-500' : 'text-gray-800'} text-sm truncate">${_resEsc(res.cliente)}</div>
            <div class="text-[9px] text-gray-400">${res.pax} PAX${res.monto ? ' · S/ ' + res.monto : ''} · ${_resEsc((res.contacto || '').replace('_', ' '))}</div>
        </div>
        ${vencida ? '<span class="text-[9px] font-bold text-amber-600 shrink-0">vencida</span>' : ''}
    </div>`;
}

function _resHeader(icon, titulo, sub) {
    return `<div class="px-3 py-2 mb-2 rounded-xl shadow-sm flex items-center justify-between" style="background:linear-gradient(135deg,#2563eb,#3b82f6)">
        <span class="text-white font-extrabold text-sm">${icon} ${titulo}</span>
        ${sub ? `<span class="text-blue-100 text-[10px] font-bold whitespace-nowrap">${sub}</span>` : ''}
    </div>`;
}
// ─────────────────────────────────────────────────────────────────────────────

function renderReservas(reservas) {
    const container = document.getElementById('reservas-container');
    if (!container) return;
    const hoy = getHoyLocal();
    const estadoDe  = r => String(r.estado || '').toLowerCase();
    const esBoarded = r => estadoDe(r) === 'asignado' || estadoDe(r) === 'pasado';

    // ── Bucketeo: hoy-por-embarcar / hoy-ya-embarcó / futuras / vencidas ──
    // Futuras y vencidas se muestran a TODOS (no se filtran por "dueño"): el muelle es compartido
    // y el nombre del operador no siempre se captura (creado_por suele ser 'App'). Así una reserva
    // a futuro SIEMPRE aparece tras registrarla — no depende de que coincida el creador.
    let hoyPend = [], hoyDone = [], futuras = [], vencidas = [];
    (reservas || []).forEach(r => {
        let f = _resFechaISO(r.fecha) || hoy;
        if (esBoarded(r)) { if (f === hoy) hoyDone.push(r); return; }   // ya embarcó: solo las de hoy, abajo
        if (f === hoy) hoyPend.push(r);                                 // pendiente de hoy
        else if (f > hoy) futuras.push(r);                             // TODA reserva a futuro
        else vencidas.push(r);                                        // pendiente de fecha pasada, sin embarcar
    });
    const byHora = (a, b) => _resHoraMin(a.hora) - _resHoraMin(b.hora);
    hoyPend.sort(byHora);
    hoyDone.sort(byHora);
    futuras.sort((a, b) => { let d = _resFechaISO(a.fecha).localeCompare(_resFechaISO(b.fecha)); return d !== 0 ? d : _resHoraMin(a.hora) - _resHoraMin(b.hora); });
    vencidas.sort((a, b) => _resFechaISO(b.fecha).localeCompare(_resFechaISO(a.fecha)));

    const vOpen = !!window._resVencidasOpen;
    const fp = JSON.stringify({
        a: hoyPend.map(r => `${r.id}|${r._asignando ? 1 : 0}|${r.id === 'Creando...' ? 1 : 0}|${r._queued ? 1 : 0}|${r.pax}|${r.cliente}|${r.hora || ''}`),
        b: hoyDone.map(r => `${r.id}|${r.estado}|${r.cliente}|${r.hora || ''}`),
        c: futuras.map(r => `${r.id}|${r.cliente}|${r.hora || ''}|${r.pax}|${_resFechaISO(r.fecha)}`),
        d: vencidas.map(r => r.id), v: vOpen
    });
    if (container._fp === fp) return;
    container._fp = fp;

    let html = '';
    // ── SECCIÓN: RESERVAS DE HOY ──
    html += _resHeader('🛟', 'Reservas de hoy', `${hoyPend.length} por embarcar${hoyDone.length ? ' · ' + hoyDone.length + ' listas' : ''}`);
    if (!hoyPend.length && !hoyDone.length) {
        html += `<div class="text-center py-6 text-gray-400 text-sm"><i class="fas fa-water text-2xl mb-2 block opacity-30"></i>Nadie por embarcar hoy 🌊</div>`;
    } else {
        html += hoyPend.map(_resCardHoy).join('');
        if (!hoyPend.length && hoyDone.length) html += `<div class="text-center py-3 text-emerald-500 text-xs font-bold">✓ ¡Todos embarcados!</div>`;
        if (hoyDone.length) {
            html += `<div class="flex items-center gap-2 my-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider"><div class="flex-1 h-px bg-gray-200"></div>✓ ya embarcaron (${hoyDone.length})<div class="flex-1 h-px bg-gray-200"></div></div>`;
            html += hoyDone.map(_resCardDone).join('');
        }
    }
    // ── SECCIÓN: MIS RESERVAS A FUTURO ──
    html += `<div class="mt-5">`;
    html += _resHeader('🗓', 'Reservas a futuro', futuras.length ? `${futuras.length} · registradas ✓` : '');
    if (!futuras.length) {
        html += `<div class="text-center py-5 text-gray-400 text-xs">No hay reservas a futuro registradas.</div>`;
    } else {
        let curFecha = '';
        futuras.forEach(r => {
            let f = _resFechaISO(r.fecha);
            if (f !== curFecha) { curFecha = f; html += `<div class="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider mt-2 mb-1 px-1">${_resFechaLegible(f)}</div>`; }
            html += _resCardFutura(r, false);
        });
    }
    html += `</div>`;
    // ── CAJÓN: VENCIDAS (mías, sin embarcar) ──
    if (vencidas.length) {
        html += `<button onclick="toggleVencidas()" class="w-full mt-5 mb-1 flex items-center justify-between px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 active:scale-95 transition">
            <span class="text-xs font-bold"><i class="fas fa-triangle-exclamation mr-1.5"></i>${vencidas.length} vencida${vencidas.length > 1 ? 's' : ''} (sin embarcar)</span>
            <i class="fas fa-chevron-${vOpen ? 'up' : 'down'} text-xs"></i></button>`;
        if (vOpen) html += `<div class="pt-1">` + vencidas.map(r => _resCardFutura(r, true)).join('') + `</div>`;
    }
    container.innerHTML = html;
}

function renderFinanzas() { renderCaja(window.cajaData); }

function renderCaja(caja) {
    // Ordenar: _syncing/_queued primero, luego descendente por timestamp
    let txHoy = (caja || [])
        .filter(c => esFechaHoy(c.timestamp))
        .sort((a, b) => {
            let aPrio = (a._syncing || a._queued) ? 1 : 0;
            let bPrio = (b._syncing || b._queued) ? 1 : 0;
            if (aPrio !== bPrio) return bPrio - aPrio;
            return new Date(b.timestamp) - new Date(a.timestamp);
        });
    let ingresos = 0, salidas = 0;
    let comisionadosMap = {};

    // Capturar IDs existentes del historial antes de re-renderizar
    let hPanelPrev = document.getElementById('caja-historial-container');
    let prevCajaIds = new Set([...(hPanelPrev ? hPanelPrev.querySelectorAll('[data-caja-id]') : [])].map(el => el.dataset.cajaId));

    // Categorías que son ingresos: Cobro, Varios-ingreso (modo ingreso), legacy
    let CATS_INGRESO = ['Cobro', 'Caja Chica', 'Ingreso por Venta', 'Ingreso_Venta', 'Caja_Chica'];
    // Categorías que son salidas: Pagos, Varios-salida, legacy
    let CATS_SALIDA  = ['Pagos', 'Pago_Comisionado', 'Pago Comisionado', 'Retiro_Jefatura', 'Retiro a Jefatura', 'Pago Agencia'];

    const _METODO_BADGE = {
        'Efectivo':      ['💵', 'bg-green-100 text-green-700'],
        'Transferencia': ['🏦', 'bg-blue-100 text-blue-700'],
        'Yape':          ['📱', 'bg-violet-100 text-violet-700'],
        'Plin':          ['📲', 'bg-teal-100 text-teal-700'],
        'Tarjeta':       ['💳', 'bg-indigo-100 text-indigo-700'],
        'Pase_Canje':    ['🤝', 'bg-purple-100 text-purple-700'],
        'Pase / Canje':  ['🤝', 'bg-purple-100 text-purple-700'],
    };
    let historialHtml = txHoy.map(c => {
        let monto = parseFloat(c.monto) || 0;
        let isPase = c.metodo_pago === 'Pase_Canje' || c.metodo_pago === 'Pase / Canje';
        let esIngreso, esSalida;
        if (c.categoria === 'Varios') {
            esSalida  = (c.comentarios || '').startsWith('[S]');
            esIngreso = !esSalida;
        } else {
            esIngreso = CATS_INGRESO.includes(c.categoria);
            esSalida  = CATS_SALIDA.includes(c.categoria);
        }
        if (!isPase) { if (esIngreso) ingresos += monto; else if (esSalida) salidas += monto; }

        let colorText = isPase ? 'text-purple-600' : (esIngreso ? 'text-green-600' : 'text-red-600');
        let signo     = isPase ? '🤝' : (esIngreso ? '+' : '-');
        let dotColor  = isPase ? 'text-purple-400' : (esIngreso ? 'text-green-400' : 'text-red-400');
        let hora      = c.timestamp ? new Date(c.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—';

        // ── Nombre del contacto ──────────────────────────────────────────────
        let contactNombre = '';
        if (c.id_contacto) {
            if (/^CON-00/i.test(c.id_contacto)) {
                // Varios: el nombre de la familia está en comentarios (sin prefijo [I]/[S])
                contactNombre = (c.comentarios || '').replace(/^\[.\] ?/, '').trim();
            } else {
                let cInfo = (window.contactosData || []).find(ct => ct.id === c.id_contacto);
                contactNombre = cInfo ? cInfo.nombre : '';
            }
        }
        let catLabel = c.categoria === 'Varios'
            ? (esIngreso ? 'Ingreso varios' : 'Salida varios')
            : c.categoria.replace(/_/g, ' ');
        // Nombre principal: contacto si existe, si no la categoría
        let nombrePrincipal = contactNombre || catLabel;
        // Subtítulo: categoría si ya usamos el nombre arriba
        let subLabel = contactNombre ? catLabel : '';

        // ── Badge método de pago ─────────────────────────────────────────────
        let metodo = c.metodo_pago || 'Efectivo';
        let [metIco, metCls] = _METODO_BADGE[metodo] || ['💰', 'bg-gray-100 text-gray-600'];
        let metodoBadge = `<span class="inline-flex items-center gap-0.5 text-[9px] font-black px-1.5 py-0.5 rounded ${metCls} ml-1">${metIco} ${metodo.replace('_', ' ')}</span>`;

        let syncDot = c._queued
            ? `<span class="inline-block w-2 h-2 rounded-full bg-orange-400 animate-pulse ml-1 align-middle" title="En cola — se enviará al reconectar"></span>`
            : c._syncing
                ? `<span class="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse ml-1 align-middle"></span>`
                : '';
        let rowBg  = c._queued ? 'bg-orange-50' : c._syncing ? 'bg-blue-50' : '';
        let blocked = c._syncing || c._queued;
        return `
        <div class="flex justify-between items-center p-3.5 ${rowBg} cursor-pointer hover:bg-gray-50 transition active:scale-95" data-caja-id="${c.id}" onclick="${blocked ? '' : `abrirDetalleCaja('${c.id}')`}">
            <div class="flex-1 min-w-0 pr-2">
                <span class="text-xs font-extrabold text-gray-800 block truncate">
                    <i class="fas fa-circle text-[7px] ${dotColor} mr-1.5"></i>${nombrePrincipal} ${metodoBadge} ${syncDot}
                </span>
                <span class="text-[10px] text-gray-400 font-bold">${hora}${subLabel ? ' · ' + subLabel : ''} · ${c.operador||''}</span>
            </div>
            <span class="font-black text-sm ${colorText} shrink-0">${signo} S/${monto.toFixed(2)}</span>
        </div>`;
    }).join('') || '<div class="text-center p-6 text-gray-400 text-sm font-bold">No hay movimientos hoy.</div>';

    let saldo = ingresos - salidas;

    // ── Panel Pases (Hoy / Histórico) ────────────────────────────────────
    let contactos = window.contactosData || [];
    let _pasesVerHistorico = window._pasesVerHistorico || false;
    function resolverNombreAliado(idONombre) {
        if (!idONombre) return '—';
        let info = contactos.find(c => c.id === idONombre || c.nombre === idONombre);
        return info ? info.nombre : idONombre;
    }

    let resumenPases = {};
    function _getAliado(key) {
        if (!resumenPases[key]) resumenPases[key] = { out: 0, in: 0, txs: [] };
        return resumenPases[key];
    }

    // PaseOut: filtrar por hoy o todo según toggle
    let pasesPool = _pasesVerHistorico
        ? (window.pasesExternosData || [])
        : (window.pasesExternosData || []).filter(p => esFechaHoy(p.timestamp));
    pasesPool.forEach(p => {
        let aliadoKey = resolverNombreAliado(p.aliadoId);
        if (!aliadoKey || aliadoKey === '—') return;
        let d = _getAliado(aliadoKey);
        let pax = parseInt(p.pax) || 0;
        d.out += pax;
        let hora = p.timestamp ? new Date(p.timestamp).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : '—';
        let fechaLabel = p.timestamp ? new Date(p.timestamp).toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit'}) : '';
        d.txs.push({ dir: 'out', pax, hora: _pasesVerHistorico && fechaLabel ? fechaLabel : hora, detalle: p.nombreOrigen || '' });
    });

    // PaseIn: si es histórico incluimos todas las ops, si es hoy solo las de hoy
    let opsPool = _pasesVerHistorico
        ? (window.operacionesData || [])
        : (window.operacionesData || []).filter(op => op.fecha === getHoyLocal() || !op.fecha);
    opsPool.forEach(op => {
        (op.manifiesto || []).forEach(m => {
            if (m.tipo !== 'Aliado(PaseIn)' && m.tipo !== 'Aliado') return;
            let aliadoKey = resolverNombreAliado(m.contacto) || resolverNombreAliado(m.nombreContacto);
            if (!aliadoKey || aliadoKey === '—') return;
            let d = _getAliado(aliadoKey);
            let pax = parseInt(m.pax) || 0;
            d.in += pax;
            d.txs.push({ dir: 'in', pax, hora: '—', detalle: m.nombreContacto || m.contacto || '' });
        });
    });

    let totalPaxOut = 0, totalPaxIn = 0;
    let pasesHtml = Object.keys(resumenPases).map((aliado, idx) => {
        let d = resumenPases[aliado];
        totalPaxOut += d.out; totalPaxIn += d.in;
        let saldoPax   = d.in - d.out;
        let saldoColor = saldoPax > 0 ? 'text-green-600' : saldoPax < 0 ? 'text-red-500' : 'text-gray-400';
        let saldoLabel = saldoPax === 0 ? 'tablas' : (saldoPax > 0 ? `+${saldoPax} a favor` : `${saldoPax} a deber`);

        let detalleHtml = d.txs.map(tx => {
            let isOut = tx.dir === 'out';
            let icon  = isOut ? 'fa-arrow-up text-red-400' : 'fa-arrow-down text-green-500';
            let label = isOut ? `Enviamos ${tx.pax} pax` : `Recibimos ${tx.pax} pax`;
            let sub   = tx.detalle ? `<span class="text-gray-400"> · De: ${tx.detalle}</span>` : '';
            let hora  = tx.hora !== '—' ? `<span class="text-gray-400 ml-1">${tx.hora}</span>` : '';
            return `<div class="flex items-center gap-2 py-1.5 border-t border-gray-100 first:border-0">
                <i class="fas ${icon} text-xs w-4 text-center"></i>
                <span class="text-[11px] font-bold text-gray-700">${label}${sub}</span>
                ${hora}
            </div>`;
        }).join('');

        return `
        <div class="bg-white border border-purple-100 rounded-xl mb-2 shadow-sm overflow-hidden">
            <div class="flex items-center justify-between p-3 cursor-pointer select-none" onclick="this.nextElementSibling.classList.toggle('hidden')">
                <div class="flex-1 min-w-0">
                    <span class="text-[9px] font-bold text-purple-400 uppercase tracking-wide block">Aliado</span>
                    <span class="font-black text-gray-800 text-xs uppercase truncate block">${aliado}</span>
                    <span class="text-[9px] font-bold ${saldoColor}">${d.in ? `↓${d.in} recibidos` : ''}${d.in && d.out ? ' · ' : ''}${d.out ? `↑${d.out} enviados` : ''}</span>
                </div>
                <div class="text-right shrink-0 ml-3">
                    <span class="font-black text-base ${saldoColor} block">${saldoPax > 0 ? '+' : ''}${saldoPax} pax</span>
                    <span class="text-[9px] font-bold ${saldoColor}">${saldoLabel}</span>
                </div>
            </div>
            <div class="hidden px-3 pb-3 bg-gray-50">${detalleHtml}</div>
        </div>`;
    }).join('');

    let pasesSummaryHtml = (totalPaxIn || totalPaxOut) ? `
        <div class="grid grid-cols-2 gap-3 mb-4">
            <div class="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                <p class="text-[9px] font-bold text-green-600 uppercase">Recibidos</p>
                <p class="text-xl font-black text-green-700">${totalPaxIn} <span class="text-xs font-bold">pax</span></p>
            </div>
            <div class="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                <p class="text-[9px] font-bold text-red-600 uppercase">Enviados</p>
                <p class="text-xl font-black text-red-600">${totalPaxOut} <span class="text-xs font-bold">pax</span></p>
            </div>
        </div>` : '';

    // ── Panel Comisionados ────────────────────────────────────────────────
    // Comisión = monto_total_cobrado − (precio_pax_defecto × cant_pax)
    // precio_pax_defecto viene de contactosData (campo precio)
    let comisionMovMap = {};
    (window.operacionesData || []).filter(op => op.fecha === getHoyLocal() || !op.fecha).forEach(op => {
        (op.manifiesto || []).forEach(m => {
            if(m.tipo !== 'Comisionado') return;
            let cantPax    = parseInt(m.pax) || 0;
            let cobrado    = parseFloat(m.monto) || 0;
            // Tarifa base CONGELADA al embarcar (tarifa_base del movimiento). Si falta (movs viejos
            // sin backfill), cae al catálogo POR ID (nunca por nombre → distinguir por id).
            let precioBase = (m.tarifa_base !== undefined && m.tarifa_base !== null && m.tarifa_base !== '')
                ? (parseFloat(m.tarifa_base) || 0)
                : ((window.contactosData || []).find(c => c.id === m.contacto) || {}).precio || 0;
            precioBase = parseFloat(precioBase) || 0;
            let baseTotal  = precioBase * cantPax;
            let comision   = Math.max(0, cobrado - baseTotal);
            if(cantPax === 0) return;
            let key = m.nombreContacto || m.contacto || '—';
            if(!comisionMovMap[key]) comisionMovMap[key] = { cobrado: 0, base: 0, comision: 0, pax: 0, precioBase };
            comisionMovMap[key].cobrado  += cobrado;
            comisionMovMap[key].base     += baseTotal;
            comisionMovMap[key].comision += comision;
            comisionMovMap[key].pax      += cantPax;
        });
    });

    // ── Cruzar con pagos ya realizados (categoria='Pagos' en cajaData de hoy) ──
    let pagosMap = {};
    txHoy.filter(c => c.categoria === 'Pagos').forEach(c => {
        // Resolver nombre: primero por id_contacto en catálogo, luego usar id_contacto directo
        let key = '';
        if (c.id_contacto) {
            let info = (window.contactosData || []).find(ct => ct.id === c.id_contacto || ct.nombre === c.id_contacto);
            key = info ? info.nombre : c.id_contacto;
        }
        if (!key) key = '—';
        if (!pagosMap[key]) pagosMap[key] = 0;
        pagosMap[key] += parseFloat(c.monto) || 0;
    });

    // Unir comisionMovMap con pagosMap: incluir comisionados que solo tienen pago (sin movimiento aún)
    let todosComisionados = new Set([...Object.keys(comisionMovMap), ...Object.keys(pagosMap)]);

    let totalDebe = 0, totalPagado = 0;
    let comisionesHtml = todosComisionados.size === 0
        ? '<div class="text-center py-6 text-gray-400 text-sm font-bold">Sin comisiones registradas hoy.</div>'
        : `<div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-3">
            <table class="w-full text-xs">
                <thead><tr class="bg-orange-50 text-orange-700 font-bold uppercase text-[9px] tracking-wider">
                    <th class="py-2 px-3 text-left">Comisionado</th>
                    <th class="py-2 px-2 text-right">Comisión</th>
                    <th class="py-2 px-2 text-right">Pagado</th>
                    <th class="py-2 px-2 text-right">Pendiente</th>
                </tr></thead>
                <tbody class="divide-y divide-gray-100">
                ${[...todosComisionados].map(nombre => {
                    let d        = comisionMovMap[nombre] || { comision: 0, pax: 0, cobrado: 0, base: 0 };
                    let pagado   = pagosMap[nombre] || 0;
                    let pendiente= Math.max(0, d.comision - pagado);
                    totalDebe   += d.comision;
                    totalPagado += pagado;
                    let pendColor = pendiente > 0 ? 'text-red-600' : 'text-green-600';
                    let pendIcon  = pendiente > 0 ? '' : '<i class="fas fa-check-circle mr-1"></i>';
                    return `<tr class="hover:bg-gray-50 cursor-pointer" onclick="abrirModalCaja('salida', { id_contacto: '', nombre_contacto: '${nombre.replace(/'/g,"\\'")}' })">
                        <td class="py-2.5 px-3 font-bold text-gray-800 uppercase text-[10px]">${nombre}<br><span class="text-gray-400 font-normal normal-case">${d.pax} pax · cobrado S/${d.cobrado.toFixed(2)}</span></td>
                        <td class="py-2 px-2 text-right font-bold text-orange-600">S/${d.comision.toFixed(2)}</td>
                        <td class="py-2 px-2 text-right text-green-600 font-bold">S/${pagado.toFixed(2)}</td>
                        <td class="py-2 px-2 text-right font-black ${pendColor}">${pendIcon}S/${pendiente.toFixed(2)}</td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table>
           </div>`;

    let totalPendiente = Math.max(0, totalDebe - totalPagado);
    let comisionesSummaryHtml = (totalDebe > 0 || totalPagado > 0) ? `
        <div class="grid grid-cols-3 gap-2 mb-3">
            <div class="bg-orange-50 border border-orange-200 rounded-xl p-2.5 text-center">
                <p class="text-[8px] font-bold text-orange-600 uppercase tracking-wide">A pagar</p>
                <p class="font-black text-orange-700 text-base">S/${totalDebe.toFixed(2)}</p>
            </div>
            <div class="bg-green-50 border border-green-200 rounded-xl p-2.5 text-center">
                <p class="text-[8px] font-bold text-green-600 uppercase tracking-wide">Pagado</p>
                <p class="font-black text-green-700 text-base">S/${totalPagado.toFixed(2)}</p>
            </div>
            <div class="bg-${totalPendiente>0?'red':'gray'}-50 border border-${totalPendiente>0?'red':'gray'}-200 rounded-xl p-2.5 text-center">
                <p class="text-[8px] font-bold text-${totalPendiente>0?'red':'gray'}-600 uppercase tracking-wide">Pendiente</p>
                <p class="font-black text-${totalPendiente>0?'red-600':'gray-500'} text-base">S/${totalPendiente.toFixed(2)}</p>
            </div>
        </div>` : '';

    // ── Actualizar DOM ────────────────────────────────────────────────────
    // Toggle Hoy / Histórico para pases
    let pasesToggleHtml = `
    <div class="flex items-center justify-between mb-3">
        <span class="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Panel de Pases</span>
        <button onclick="window._pasesVerHistorico=!window._pasesVerHistorico;renderFinanzas()" class="flex items-center gap-1.5 text-[10px] font-black px-3 py-1.5 rounded-full border transition ${_pasesVerHistorico ? 'bg-purple-100 text-purple-700 border-purple-300' : 'bg-gray-100 text-gray-500 border-gray-200'}">
            <i class="fas ${_pasesVerHistorico ? 'fa-history' : 'fa-calendar-day'}"></i>
            ${_pasesVerHistorico ? 'Histórico' : 'Hoy'}
        </button>
    </div>`;

    let noRegistrosMsg = _pasesVerHistorico
        ? '<div class="text-center py-6 text-gray-400 text-sm font-bold">Sin pases históricos.</div>'
        : '<div class="text-center py-6 text-gray-400 text-sm font-bold">Sin pases registrados hoy.</div>';
    let pasesHtmlFinal = Object.keys(resumenPases).length > 0 ? pasesHtml : noRegistrosMsg;

    let pPanel = document.getElementById('fin-pases-content');
    if(pPanel) pPanel.innerHTML = pasesToggleHtml + pasesSummaryHtml + pasesHtmlFinal;

    let cPanel = document.getElementById('fin-comisionados-content');
    if(cPanel) cPanel.innerHTML = comisionesSummaryHtml + comisionesHtml;

    let hPanel = document.getElementById('caja-historial-container');
    if(hPanel) {
        hPanel.innerHTML = `
        <div class="bg-[#56070c] rounded-t-2xl p-4 text-white">
            <p class="text-[9px] font-bold uppercase tracking-widest opacity-70 mb-1">Balance del turno</p>
            <p class="text-3xl font-black">S/ ${saldo.toFixed(2)}</p>
            <div class="flex justify-between mt-2 text-xs opacity-80">
                <span>+ S/${ingresos.toFixed(2)} entradas</span>
                <span>- S/${salidas.toFixed(2)} salidas</span>
            </div>
        </div>
        <div class="divide-y divide-gray-100">${historialHtml}</div>`;

        // Animar solo los items del historial genuinamente nuevos
        hPanel.querySelectorAll('[data-caja-id]').forEach(el => {
            if (!prevCajaIds.has(el.dataset.cajaId)) el.classList.add('row-enter');
        });
    }
}


function renderCatalogos(cats) {
    if(!cats) return;
    const selBote = document.getElementById('select-bote-id');
    const selCap  = document.getElementById('select-capitan-id');
    const selGuia = document.getElementById('select-guia-id');
    if(!selBote || !selCap || !selGuia) return;

    selBote.innerHTML = '<option value="">- Lancha -</option>' +
        (cats.botes && cats.botes.length
            ? cats.botes.map(b => `<option value="${b.id}">${b.nombre} (${b.cap} px)</option>`).join('')
            : '<option value="" disabled>Todos ocupados</option>');
    selCap.innerHTML = '<option value="">- Capitán -</option>' +
        (cats.capitanes && cats.capitanes.length
            ? cats.capitanes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')
            : '<option value="" disabled>Ninguno disponible</option>');
    selGuia.innerHTML = '<option value="">- Guía (opcional) -</option>' +
        (cats.guias && cats.guias.length
            ? cats.guias.map(g => `<option value="${g.id}">${g.nombre}</option>`).join('')
            : '<option value="" disabled>Ninguno disponible</option>');
}

// Refresca catálogos desde la Sheet sin cerrar el modal.
// Guarda y restaura la selección actual.
function refrescarCatalogosModal() {
    let btn = document.getElementById('btn-refrescar-catalogo');
    if(btn) { btn.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Cargando...'; btn.disabled = true; }

    let savedBote = document.getElementById('select-bote-id')?.value;
    let savedCap  = document.getElementById('select-capitan-id')?.value;
    let savedGuia = document.getElementById('select-guia-id')?.value;

    fetch(GAS_URL + "?action=getDashboardData")
        .then(res => res.json())
        .then(data => {
            if(data.status !== 'error') {
                window.operacionesData   = data.operaciones_abiertas || [];
                window.contactosData     = data.catalogos?.contactos || [];
                window.catalogosData     = data.catalogos || {};
                renderCatalogos(data.catalogos);

                // Restaurar selección si el recurso sigue disponible
                let selBote = document.getElementById('select-bote-id');
                let selCap  = document.getElementById('select-capitan-id');
                let selGuia = document.getElementById('select-guia-id');
                if(savedBote) selBote.value = savedBote;
                if(savedCap)  selCap.value  = savedCap;
                if(savedGuia) selGuia.value = savedGuia;

                mostrarToast('✅ Lista actualizada desde la planilla.');
            }
            if(btn) { btn.innerHTML = '<i class="fas fa-sync-alt"></i> Actualizar lista'; btn.disabled = false; }
        })
        .catch(() => {
            mostrarToast('⚠️ No se pudo actualizar. Verifica conexión.', 'error');
            if(btn) { btn.innerHTML = '<i class="fas fa-sync-alt"></i> Actualizar lista'; btn.disabled = false; }
        });
}

function abrirModal(id) {
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById(id).classList.remove('hidden');
    
    if(id === 'modal-nueva-reserva') {
        document.getElementById('input-crm-fecha').value = getHoyLocal();
        _mostrarFechaLegible('input-crm-fecha', 'crm-fecha-legible');
        cambiarTipoCRM();
        setTimeout(actualizarHoraSugeridaCRM, 50);
    } else if (id === 'modal-abrir-bote') {
        // Repoblar con los catálogos más frescos en memoria
        if(window.catalogosData) renderCatalogos(window.catalogosData);
        let selectHora = document.getElementById('select-bote-hora');
        if(selectHora) {
            let suggested = obtenerHoraSugerida();
            let found = Array.from(selectHora.options).find(opt => opt.value === suggested);
            if(found) selectHora.value = suggested; else selectHora.selectedIndex = 0;
        }
    }
}

function cerrarModales() {
    window._manifestSearch = '';
    window._ultimoTipoEmbarque = 'Libre'; // reset tipo al cerrar modal
    let searchInput = document.getElementById('input-buscar-manifiesto');
    if (searchInput) searchInput.value = '';
    document.querySelectorAll('.fixed').forEach(el => {
        if(el.id !== 'modal-backdrop' && el.id !== 'global-spinner' && el.id.startsWith('modal-')) {
            el.classList.add('hidden');
        }
    });
    document.getElementById('modal-backdrop').classList.add('hidden');
    resetFormularioVenta();
}

function cerrarSubModal(id) {
    document.getElementById(id).classList.add('hidden');
    let act = Array.from(document.querySelectorAll('.fixed')).filter(el => el.id !== 'modal-backdrop' && el.id !== 'global-spinner' && el.id.startsWith('modal-') && !el.classList.contains('hidden'));
    if(act.length === 0) document.getElementById('modal-backdrop').classList.add('hidden');
}

function confirmarAbrirBote() {
    let selectBote = document.getElementById('select-bote-id');
    let selectCap = document.getElementById('select-capitan-id');
    let selectGuia = document.getElementById('select-guia-id');

    let id_bote = selectBote.value;
    let id_capitan = selectCap.value;
    let id_guia = selectGuia.value;
    
    if(!id_bote) return alert("❌ Selecciona la lancha a operar.");
    if(!id_capitan) return alert("❌ Selecciona el Capitán.");
    
    // Optimistic UI para Lanchas
    let boteNombreRaw = selectBote.options[selectBote.selectedIndex].text;
    let boteNombre = boteNombreRaw.split(' (')[0];
    let cap = parseInt(boteNombreRaw.match(/\((\d+)/)[1]) || 20;

    let selectHora = document.getElementById('select-bote-hora');
    let hora_salida = selectHora ? selectHora.value : '';
    let selectDestino = document.getElementById('select-bote-destino');
    let destino = selectDestino ? selectDestino.value : '';

    let opTemp = {
        id: 'Creando...', bote: boteNombre, capacidad: cap, ocupados: 0,
        estado: 'Abierta', capitan: selectCap.options[selectCap.selectedIndex].text,
        guia: selectGuia.value ? selectGuia.options[selectGuia.selectedIndex].text : 'Sin Guía',
        hora_salida: hora_salida, manifiesto: []
    };
    window.operacionesData.unshift(opTemp);
    renderOperaciones(window.operacionesData);
    cerrarModales();

    fetchPostBg('abrir_operacion', { id_bote, id_capitan, id_guia, hora_salida, destino, creador: myOpName, localId: 'temp-op-' + Date.now() + '-' + Math.random().toString(36).slice(2,8) }).then(() => setTimeout(fetchDashboardDataBg, 5000));
}

function confirmarZarpe(id_op) {
    let op = window.operacionesData.find(o => o.id === id_op);
    if (!op) return;

    let totalPax = (op.manifiesto || []).reduce((s, m) => s + (parseFloat(m.pax) || 0), 0);

    document.getElementById('zarpe-confirm-subtitulo').textContent = `Operación ${id_op}`;
    document.getElementById('zarpe-confirm-bote').textContent = op.bote || op.nombre_bote || '–';
    document.getElementById('zarpe-confirm-pax').textContent = `${totalPax} PAX`;
    document.getElementById('zarpe-confirm-destino').textContent = op.destino || '–';
    document.getElementById('zarpe-confirm-hora').textContent = op.hora_salida || '–';

    let btnOk = document.getElementById('btn-zarpe-confirm-ok');
    btnOk.onclick = function() {
        cerrarSubModal('modal-zarpe-confirm');
        ejecutarZarpe(id_op);
    };

    abrirModal('modal-zarpe-confirm');
}

function confirmarLlegada(id_op) {
    let op = window.operacionesData.find(o => o.id === id_op);
    if (!op) return;
    let totalPax = (op.manifiesto || []).reduce((s, m) => s + (parseFloat(m.pax) || 0), 0);
    // Mostrar bottom-sheet de confirmación
    let bs = document.createElement('div');
    bs.id = '_llegada-bs';
    bs.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:flex-end;';
    bs.innerHTML = `<div style="background:white;border-radius:24px 24px 0 0;padding:24px;width:100%;box-shadow:0 -20px 60px rgba(0,0,0,.2);">
        <div style="width:40px;height:4px;background:#e5e7eb;border-radius:4px;margin:0 auto 20px;"></div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
            <div style="width:48px;height:48px;background:#f0fdf4;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:22px;">🏁</div>
            <div><strong style="font-size:17px;color:#111;">Confirmar Llegada</strong><br><span style="font-size:12px;color:#6b7280;">${op.bote} · ${totalPax} PAX</span></div>
        </div>
        <p style="font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:10px 14px;margin-bottom:16px;">
            Al confirmar, la embarcación, capitán y guía quedarán <strong>disponibles</strong> para nuevas operaciones.
        </p>
        <div style="display:flex;gap:10px;">
            <button onclick="document.getElementById('_llegada-bs').remove()" style="flex:1;background:#f3f4f6;color:#374151;font-weight:700;border:none;padding:14px;border-radius:14px;font-size:14px;cursor:pointer;">Cancelar</button>
            <button onclick="document.getElementById('_llegada-bs').remove();_ejecutarConfirmarLlegada('${id_op}')" style="flex:2;background:#059669;color:white;font-weight:900;border:none;padding:14px;border-radius:14px;font-size:14px;cursor:pointer;">✅ Confirmar Llegada</button>
        </div>
    </div>`;
    document.body.appendChild(bs);
    bs.addEventListener('click', e => { if (e.target === bs) bs.remove(); });
}

function _ejecutarConfirmarLlegada(id_op) {
    // Optimistic: cambiar estado a Cerrada sin eliminar la card (evita parpadeo)
    let opIndex = window.operacionesData.findIndex(o => o.id === id_op);
    if (opIndex !== -1) {
        window.operacionesData[opIndex].estado = 'Cerrada';
        // Si el modal de gestión estaba abierto para esta op, actualizar su modo
        if (window._gestionOpEstado && document.getElementById('hidden-gestion-op')?.value === id_op) {
            window._gestionOpEstado = 'Cerrada';
            document.getElementById('box-formulario-venta')?.classList.add('hidden');
        }
        renderOperaciones(window.operacionesData);
    }
    fetchPostBg('confirmar_llegada', { id_operacion: id_op, creador: myOpName }).then(res => {
        if (res.status === 'error') { mostrarToast(res.message, 'error'); fetchDashboardDataBg(); return; }
        mostrarToast('✅ Llegada confirmada. Recursos liberados.', 'success');
        clearTimeout(window._syncTimer);
        window._syncTimer = setTimeout(fetchDashboardDataBg, 3000);
    });
}

function confirmarAnularOp(id_op) {
    let op = window.operacionesData.find(o => o.id === id_op);
    if (!op) return;
    let bs = document.createElement('div');
    bs.id = '_anular-op-bs';
    bs.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:flex-end;';
    bs.innerHTML = `<div style="background:white;border-radius:24px 24px 0 0;padding:24px;width:100%;box-shadow:0 -20px 60px rgba(0,0,0,.2);">
        <div style="width:40px;height:4px;background:#e5e7eb;border-radius:4px;margin:0 auto 20px;"></div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
            <div style="width:48px;height:48px;background:#fef2f2;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:22px;">🚫</div>
            <div><strong style="font-size:17px;color:#111;">Anular Operación</strong><br><span style="font-size:12px;color:#6b7280;">${op.bote} · ${id_op}</span></div>
        </div>
        <p style="font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:10px 14px;margin-bottom:16px;">
            Esta acción marcará la operación como <strong>Cancelada</strong> y liberará los recursos asignados. Solo disponible sin pasajeros a bordo.
        </p>
        <div style="display:flex;gap:10px;">
            <button onclick="document.getElementById('_anular-op-bs').remove()" style="flex:1;background:#f3f4f6;color:#374151;font-weight:700;border:none;padding:14px;border-radius:14px;font-size:14px;cursor:pointer;">Cancelar</button>
            <button onclick="document.getElementById('_anular-op-bs').remove();_ejecutarAnularOp('${id_op}')" style="flex:2;background:#dc2626;color:white;font-weight:900;border:none;padding:14px;border-radius:14px;font-size:14px;cursor:pointer;">🚫 Confirmar Anulación</button>
        </div>
    </div>`;
    document.body.appendChild(bs);
    bs.addEventListener('click', e => { if (e.target === bs) bs.remove(); });
}

function _ejecutarAnularOp(id_op) {
    let opIndex = window.operacionesData.findIndex(o => o.id === id_op);
    if (opIndex !== -1) {
        window.operacionesData.splice(opIndex, 1);
        renderOperaciones(window.operacionesData);
    }
    fetchPostBg('anular_operacion', { id_operacion: id_op, creador: myOpName }).then(res => {
        if (res.status === 'error') {
            mostrarToast(res.message, 'error');
            fetchDashboardDataBg();
            return;
        }
        mostrarToast('✅ Operación anulada correctamente.', 'success');
        clearTimeout(window._syncTimer);
        window._syncTimer = setTimeout(fetchDashboardDataBg, 3000);
    });
}

function ejecutarZarpe(id_op) {
    // Optimistic: actualizar estado local inmediatamente
    let opIndex = window.operacionesData.findIndex(o => o.id === id_op);
    if(opIndex !== -1) {
        window.operacionesData[opIndex].estado = 'En_Viaje';
        window.operacionesData[opIndex].hora_salida = window.operacionesData[opIndex].hora_salida || new Date().toTimeString().slice(0,5);
        renderOperaciones(window.operacionesData);
    }
    fetchPostBg('zarpar_operacion', { id_operacion: id_op }).then(res => {
        if(res.status === 'error') { alert(res.message); fetchDashboardDataBg(); return; }
        clearTimeout(window._syncTimer);
        window._syncTimer = setTimeout(fetchDashboardDataBg, 3000);
    });
}

// ==========================
// VENTA DIRECTA (MUELLE)
// ==========================
// ── Helpers DOM-diffing manifiesto ───────────────────────────────────────────
// ── Helpers de tipo y estado de cobro ────────────────────────────────────────
// Tipos que NO generan cobro (pases recibidos de aliados — ellos no nos pagan)
// Aliado(PaseOut): la agencia original derivó sus PAX → SÍ se cobra a la agencia
const _TIPOS_SIN_COBRO = ['Aliado(PaseIn)', 'Pase_Recibido', 'Aliado'];

function _calcPagoEstado(m) {
    if (_TIPOS_SIN_COBRO.includes(m.tipo)) {
        return { cobrable: false, estado: 'sin_cobro', totalACobrar: 0, totalPagado: 0, pendiente: 0 };
    }
    let adicionalesSum = 0;
    if (m.adicionales) {
        adicionalesSum = (m.adicionales + '').split(',').reduce((acc, p) => {
            return acc + (parseFloat((p.split(':')[1] || '').trim()) || 0);
        }, 0);
    }
    let totalACobrar = (parseFloat(m.monto) || 0) + adicionalesSum;
    let totalPagado  = (window.cajaData || [])
        .filter(c => c.id_movimiento && c.id_movimiento === m.id)
        .reduce((sum, c) => sum + (parseFloat(c.monto) || 0), 0);
    let pendiente = Math.max(0, totalACobrar - totalPagado);
    let estado = totalPagado <= 0 ? 'por_cobrar'
               : pendiente > 0.005 ? 'pagado_parcial'
               : 'pagado_completo';
    return { cobrable: true, estado, totalACobrar, totalPagado, pendiente };
}

function _tipoBadgeHTML(tipo) {
    const MAP = {
        'Libre':           ['Libre',        'bg-gray-100 text-gray-600 border-gray-300'],
        'Directo':         ['Libre',        'bg-gray-100 text-gray-600 border-gray-300'],
        'Agencia':         ['Agencia',      'bg-blue-100 text-blue-700 border-blue-300'],
        'Comisionado':     ['Comisionado',  'bg-orange-100 text-orange-700 border-orange-300'],
        'Aliado(PaseIn)':  ['Pase·Entrada', 'bg-teal-100 text-teal-700 border-teal-300'],
        'Aliado(PaseOut)': ['Pase·Salida',  'bg-purple-100 text-purple-700 border-purple-300'],
        'Aliado':          ['Aliado',       'bg-purple-100 text-purple-700 border-purple-300'],
        'Pase_Recibido':   ['Pase',         'bg-teal-100 text-teal-700 border-teal-300'],
        'Abordaje_CRM':    ['CRM',          'bg-indigo-100 text-indigo-700 border-indigo-300'],
    };
    let [label, cls] = MAP[tipo] || [tipo.replace(/_/g,' '), 'bg-gray-100 text-gray-600 border-gray-300'];
    return `<span class="inline-block text-[8px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded border ${cls}">${label}</span>`;
}
// ─────────────────────────────────────────────────────────────────────────────

function _itemManifiestoFP(m) {
    let isSyncing  = !!m._syncing || (m.id && m.id.startsWith('temp-'));
    let isSelected = !isSyncing && window.editandoMovId === m.id;
    let opEstado   = window._gestionOpEstado || 'Abierta';
    let pagoSt     = _calcPagoEstado(m).estado;
    return `${m.id}|${isSyncing?1:0}|${isSelected?1:0}|${m.pax}|${m.monto}|${m.adicionales||''}|${opEstado}|${pagoSt}`;
}

function _itemManifiestoHTML(m) {
    let isSyncing  = !!m._syncing || (m.id && m.id.startsWith('temp-'));
    let opEstado   = window._gestionOpEstado || 'Abierta';
    let soloLectura = opEstado === 'En_Viaje' || opEstado === 'Cerrada';
    // Seleccionable siempre (incl. op cerrada/en-viaje) → así se llega a Adicionales/Cobrar de olvidos.
    // Pasar/derivar/borrar siguen gateados por soloLectura (solo op abierta).
    let isSelected = !isSyncing && window.editandoMovId === m.id;
    let fp         = _itemManifiestoFP(m);

    let pagoInfo   = _calcPagoEstado(m);
    let { cobrable, estado: pagoEstado, totalACobrar, pendiente } = pagoInfo;

    // Color del card según estado de cobro (no por tipo de contacto)
    let bgClass, borderClass;
    if (isSelected) {
        bgClass = 'bg-orange-50'; borderClass = 'ring-2 ring-orange-400 border-orange-200';
    } else if (isSyncing) {
        bgClass = 'bg-blue-50/60'; borderClass = 'border-blue-200';
    } else if (!cobrable) {
        bgClass = 'bg-white'; borderClass = 'border-gray-200';
    } else if (pagoEstado === 'pagado_completo') {
        bgClass = 'bg-green-50'; borderClass = 'border-green-300';
    } else if (pagoEstado === 'pagado_parcial') {
        bgClass = 'bg-amber-50'; borderClass = 'border-amber-300';
    } else { // por_cobrar
        bgClass = 'bg-red-50'; borderClass = 'border-red-200';
    }

    let iconoSinc = isSyncing
        ? `<span class="inline-flex items-center gap-0.5 text-[9px] font-black text-blue-500 ml-1"><span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping inline-block"></span>guardando</span>`
        : '';

    let adicionalesSum = totalACobrar - (parseFloat(m.monto) || 0);

    // ── Botón Cobrar (siempre visible para ítems cobrables no completamente pagados) ──
    let cobrarBtn = '';
    if (cobrable && pagoEstado !== 'pagado_completo' && !isSyncing) {
        let etiquetaMonto = pagoEstado === 'pagado_parcial'
            ? `<span class="bg-white/25 border border-white/30 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full ml-1">Pend. S/${pendiente.toFixed(2)}</span>`
            : `S/ ${totalACobrar.toFixed(2)}`;
        cobrarBtn = `
        <button class="cobrar-btn-appear mt-2 w-full bg-green-500 text-white text-[11px] font-bold py-2 rounded-xl flex items-center justify-center gap-1.5 transition hover:bg-green-600 active:scale-95 shadow-sm"
            onclick="abrirModalCaja('cobro_directo', { id_operacion: document.getElementById('hidden-gestion-op').value, id_contacto: '${m.contacto}', nombre_contacto: '${(m.nombreContacto||m.contacto||'').replace(/'/g,"\\'")}', monto: ${m.monto||0}, monto_adicionales: ${adicionalesSum.toFixed(2)}, detalle_adicionales: '${(m.adicionales||'').replace(/'/g,"\\'")}', id_mov: '${m.id}', pendiente: ${pendiente.toFixed(2)}, bloqueado: true }); event.stopPropagation();">
            <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse shrink-0"></span>
            <i class="fas fa-money-bill-wave text-[10px]"></i>
            Cobrar ${etiquetaMonto}
        </button>`;
    } else if (cobrable && pagoEstado === 'pagado_completo') {
        cobrarBtn = `<div class="mt-2 flex items-center justify-center gap-1 text-[10px] font-black text-green-700"><i class="fas fa-check-circle"></i> Pagado S/ ${totalACobrar.toFixed(2)}</div>`;
    }

    // ── Adicionales: SIEMPRE visible en la card (como Cobrar), para cualquier movimiento cobrable ──
    let esPaseOut = m.tipo === 'Aliado(PaseOut)';
    let adicionalesBtn = cobrable ? `
    <button class="mt-2 w-full bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-bold py-2 rounded-xl flex items-center justify-center gap-1.5 transition hover:bg-amber-100 active:scale-95"
        onclick="abrirModalImpuestos('${m.id}', '${m.contacto}'); event.stopPropagation();">
        <i class="fas fa-file-invoice-dollar text-[10px]"></i> ${adicionalesSum > 0 ? `Adicionales · +S/${adicionalesSum.toFixed(2)}` : 'Adicionales'}
    </button>` : '';
    // ── Sub-botones de edición (solo al seleccionar Y op abierta): Pasar / borrar ──
    let subBtns = (isSelected && !isSyncing && !soloLectura) ? `
    <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-orange-200">
        ${!esPaseOut ? `<button class="flex-1 min-w-[60px] bg-purple-500 text-white text-[11px] font-bold py-2 rounded-xl shadow-md shadow-purple-500/30 hover:bg-purple-600 transition" onclick="abrirModalDerivar('${m.id}', '${m.pax}'); event.stopPropagation();"><i class="fas fa-people-carry mr-1"></i> Pasar</button>` : ''}
        <button class="bg-red-100 text-red-600 text-[11px] font-bold px-3 py-2 rounded-xl border border-red-200 hover:bg-red-200 transition" onclick="eliminarMovimiento('${m.id}', '${m.pax}'); event.stopPropagation();"><i class="fas fa-trash-alt"></i></button>
    </div>` : '';

    // ── Display monto ──
    let montoDisplay;
    if (_TIPOS_SIN_COBRO.includes(m.tipo)) {
        montoDisplay = `<span class="text-[10px] font-black text-purple-500 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">PASE</span>`;
    } else if (adicionalesSum > 0) {
        let montoBase    = parseFloat(m.monto || 0);
        let detalleAdics = (m.adicionales || '').replace(/'/g, "\\'");
        let detalleTitle = (m.adicionales || '').replace(/, /g, ' | ');
        montoDisplay = `<span class="text-[10px] text-gray-500 block font-bold">S/ ${montoBase.toFixed(2)} <span class="inline-flex items-center gap-0.5 bg-amber-100 text-amber-700 border border-amber-300 text-[9px] font-black px-1 py-0.5 rounded ml-0.5 cursor-pointer active:bg-amber-200" title="${detalleTitle}" onclick="mostrarDetalleAdicionales('${detalleAdics}'); event.stopPropagation();">+${adicionalesSum.toFixed(2)} <i class='fas fa-info-circle text-[8px]'></i></span></span>`;
    } else {
        montoDisplay = `<span class="text-[10px] text-gray-500 block font-bold">S/ ${parseFloat(m.monto||0).toFixed(2)}</span>`;
    }

    let nombreMostrar = m.nombreContacto || m.contacto || '';
    let tipoBadge     = _tipoBadgeHTML(m.tipo);

    let clickable = !isSyncing;   // seleccionable incl. op cerrada (para Adicionales/Cobrar de olvidos)
    return `<div class="flex flex-col ${bgClass} border ${borderClass} p-3 rounded-xl ${clickable ? 'cursor-pointer' : 'cursor-default'} transition shadow-sm mb-2" data-mov-id="${m.id}" data-item-fp="${fp}" ${clickable ? `onclick="cargarParaEditar('${m.id}')"` : ''}>
        <div class="flex justify-between items-center">
            <div class="flex-1 min-w-0 pr-2">
                <span class="text-xs font-bold ${isSelected ? 'text-orange-800' : 'text-gray-800'} uppercase block truncate">${nombreMostrar} ${iconoSinc}</span>
                <div class="flex items-center gap-1 mt-0.5">${tipoBadge}</div>
            </div>
            <div class="text-right shrink-0">
                <span class="font-black text-blue-600 text-sm">${m.pax} PAX</span>
                ${montoDisplay}
            </div>
        </div>
        ${cobrarBtn}
        ${adicionalesBtn}
        ${subBtns}
    </div>`;
}
// ─────────────────────────────────────────────────────────────────────────────

function abrirModalGestionBote(id_op) {
    let op = window.operacionesData.find(o => o.id === id_op);
    if(!op || op.id === 'Creando...') return;

    // Limpiar búsqueda al abrir
    window._manifestSearch = '';
    let searchInput = document.getElementById('input-buscar-manifiesto');
    if (searchInput) searchInput.value = '';

    // Nombre del bote en el H3 (preserva el span hijo)
    let nodeH3 = document.getElementById('gestion-bote-nombre');
    if(nodeH3.childNodes[0].nodeType === 3) nodeH3.childNodes[0].nodeValue = op.bote + " ";

    document.getElementById('hidden-gestion-op').value = op.id;
    window._gestionOpEstado = op.estado; // usado por _itemManifiestoHTML para modo solo-cobro
    let soloLectura = op.estado === 'En_Viaje' || op.estado === 'Cerrada';
    if (soloLectura) window.editandoMovId = null;
    document.getElementById('box-formulario-venta').classList.toggle('hidden', soloLectura);

    resetFormularioVenta();
    abrirModal('modal-gestion-bote');
    actualizarModalSiAbierto(); // Renderiza lista + barra de capacidad
}

// Helper: normaliza strings para comparar tipos sin acento/mayúsculas
function normTipo(s) { return (s||'').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""); }

// Helper: obtiene {id, nombre} del select de contacto activo
// ── Buscador filtrable de contacto para el embarque (reemplaza el <select> largo) ──
// El operador escribe y filtra por nombre (como en PS). Guarda el id oculto → distinguir por id.
function _pickerContactoHTML(want, label) {
    let showP = (want === 'agencia' || want === 'comision');
    return `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">${label}</label>
      <div class="relative">
        <input type="text" id="input-vd-contacto-buscar" data-want="${want}" data-precio="${showP?1:0}" autocomplete="off"
          class="${_selectInputClass()}" placeholder="🔍 Escribe para buscar ${label.toLowerCase()}..."
          oninput="filtrarPickerContacto()" onfocus="filtrarPickerContacto()"
          onblur="setTimeout(function(){var l=document.getElementById('input-vd-contacto-lista');if(l)l.classList.add('hidden');},200)">
        <div id="input-vd-contacto-lista" class="hidden absolute z-40 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-52 overflow-y-auto"></div>
        <input type="hidden" id="input-vd-contacto-id">
        <input type="hidden" id="input-vd-contacto-nombre">
      </div>`;
}
function filtrarPickerContacto() {
    let inp = document.getElementById('input-vd-contacto-buscar');
    let lista = document.getElementById('input-vd-contacto-lista');
    if(!inp || !lista) return;
    let want = inp.dataset.want || '', showP = inp.dataset.precio === '1';
    let q = (inp.value || '').trim().toLowerCase();
    // si el texto ya no coincide con lo seleccionado, limpiar la selección (evita id colgante)
    let idH = document.getElementById('input-vd-contacto-id'), nomH = document.getElementById('input-vd-contacto-nombre');
    if(nomH && idH && inp.value !== nomH.value) { idH.value = ''; nomH.value = ''; }
    let items = (window.contactosData || []).filter(c => normTipo(c.tipo).includes(want) && (!q || String(c.nombre || '').toLowerCase().includes(q))).slice(0, 40);
    if(!items.length) { lista.innerHTML = '<div class="px-3 py-2 text-[11px] text-gray-400">Sin resultados</div>'; lista.classList.remove('hidden'); return; }
    lista.innerHTML = items.map(c => `<div class="px-3 py-2 text-[11px] font-bold text-gray-800 hover:bg-blue-50 active:bg-blue-100 cursor-pointer border-b border-gray-50"
        onmousedown="pickContacto('${c.id}', '${String(c.nombre).replace(/'/g, "\\'")}')">${c.nombre}${showP ? ` <span class="text-gray-400 font-normal">S/${c.precio}/pax</span>` : ''}</div>`).join('');
    lista.classList.remove('hidden');
}
function pickContacto(id, nombre) {
    let idH = document.getElementById('input-vd-contacto-id'), nomH = document.getElementById('input-vd-contacto-nombre'), inp = document.getElementById('input-vd-contacto-buscar');
    if(idH) idH.value = id; if(nomH) nomH.value = nombre; if(inp) inp.value = nombre;
    let lista = document.getElementById('input-vd-contacto-lista'); if(lista) lista.classList.add('hidden');
    actualizarPrecioDefecto();
}
// ── Buscador filtrable de contacto para el CRM de reservas (gemelo del embarque) ──
// Mismo UX que en PS: el operador escribe y la lista se filtra; guarda el id oculto
// para distinguir por id (hay nombres repetidos: agencia vs aliado con el mismo nombre).
function _pickerContactoCRMHTML(want, label) {
    let showP = (want === 'agencia' || want === 'comision');
    return `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">${label}</label>
      <div class="relative">
        <input type="text" id="input-crm-contacto-buscar" data-want="${want}" data-precio="${showP?1:0}" autocomplete="off"
          class="${_selectInputClass()}" placeholder="🔍 Escribe para buscar ${label.toLowerCase()}..."
          oninput="filtrarPickerContactoCRM()" onfocus="filtrarPickerContactoCRM()"
          onblur="setTimeout(function(){var l=document.getElementById('input-crm-contacto-lista');if(l)l.classList.add('hidden');},200)">
        <div id="input-crm-contacto-lista" class="hidden absolute z-40 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl max-h-52 overflow-y-auto"></div>
        <input type="hidden" id="input-crm-contacto-id">
        <input type="hidden" id="input-crm-contacto-nombre">
      </div>`;
}
function filtrarPickerContactoCRM() {
    let inp = document.getElementById('input-crm-contacto-buscar');
    let lista = document.getElementById('input-crm-contacto-lista');
    if(!inp || !lista) return;
    let want = inp.dataset.want || '', showP = inp.dataset.precio === '1';
    let q = (inp.value || '').trim().toLowerCase();
    // si el texto ya no coincide con lo seleccionado, limpiar la selección (evita id colgante)
    let idH = document.getElementById('input-crm-contacto-id'), nomH = document.getElementById('input-crm-contacto-nombre');
    if(nomH && idH && inp.value !== nomH.value) { idH.value = ''; nomH.value = ''; }
    let items = (window.contactosData || []).filter(c => normTipo(c.tipo).includes(want) && (!q || String(c.nombre || '').toLowerCase().includes(q))).slice(0, 40);
    if(!items.length) { lista.innerHTML = '<div class="px-3 py-2 text-[11px] text-gray-400">Sin resultados</div>'; lista.classList.remove('hidden'); return; }
    lista.innerHTML = items.map(c => `<div class="px-3 py-2 text-[11px] font-bold text-gray-800 hover:bg-blue-50 active:bg-blue-100 cursor-pointer border-b border-gray-50"
        onmousedown="pickContactoCRM('${c.id}', '${String(c.nombre).replace(/'/g, "\\'")}')">${c.nombre}${showP ? ` <span class="text-gray-400 font-normal">S/${c.precio}/pax</span>` : ''}</div>`).join('');
    lista.classList.remove('hidden');
}
function pickContactoCRM(id, nombre) {
    let idH = document.getElementById('input-crm-contacto-id'), nomH = document.getElementById('input-crm-contacto-nombre'), inp = document.getElementById('input-crm-contacto-buscar');
    if(idH) idH.value = id; if(nomH) nomH.value = nombre; if(inp) inp.value = nombre;
    let lista = document.getElementById('input-crm-contacto-lista'); if(lista) lista.classList.add('hidden');
    try { resTap(); resHap(6); } catch(e) {}
    actualizarPrecioDefectoCRM();
}
function getContactoSeleccionado(selectId) {
    // Embarque: usa el buscador (id oculto). Otros selects (derivar/pase-reserva): lógica legacy.
    if(selectId === 'input-vd-contacto-select') {
        let hid = document.getElementById('input-vd-contacto-id');
        if(hid) return { id: hid.value || '', nombre: (document.getElementById('input-vd-contacto-nombre') || {}).value || '' };
    }
    if(selectId === 'input-crm-contacto-select') {
        let hid = document.getElementById('input-crm-contacto-id');
        if(hid) return { id: hid.value || '', nombre: (document.getElementById('input-crm-contacto-nombre') || {}).value || '' };
    }
    let sel = document.getElementById(selectId);
    if(!sel) return { id: '', nombre: '' };
    let opt = sel.options ? sel.options[sel.selectedIndex] : null;
    return { id: (opt && opt.dataset && opt.dataset.id) || sel.value, nombre: sel.value };
}

function _selectInputClass() {
    return 'w-full bg-white border border-gray-200 rounded-xl p-2.5 text-[11px] font-bold text-gray-800 shadow-sm mt-0.5 outline-none';
}
function _textInputClass() {
    return 'w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs focus:outline-blue-500 shadow-sm mt-0.5 uppercase';
}

function cambiarTipoVentaDirecta() {
    let tipo = document.getElementById('input-vd-tipo').value;
    let container   = document.getElementById('container-contacto-input');
    let precioInput = document.getElementById('input-vd-precio');
    let precioLabel = document.getElementById('label-precio-venta');
    let comisionBox = document.getElementById('box-comision-info');
    let precioContainer = document.getElementById('container-precio-venta');

    // Resetear estado del precio (removeAttribute necesario para iOS Safari)
    precioInput.readOnly = false;
    precioInput.removeAttribute('readonly');
    precioInput.classList.remove('bg-gray-100', 'opacity-60');
    precioContainer.classList.remove('hidden');
    comisionBox.classList.add('hidden');

    if(tipo === 'Libre') {
        precioLabel.textContent = 'S/ Total Cobrado';
        container.innerHTML = `<label class="text-[9px] font-bold text-red-500 uppercase tracking-widest ml-1">Apellido * obligatorio</label>
            <input type="text" id="input-vd-contacto-text" class="${_textInputClass()}" placeholder="Ej: García, Torres..." autocomplete="off">`;

    } else if(tipo === 'Agencia') {
        precioLabel.textContent = 'S/ Total (precio especial)';
        container.innerHTML = _pickerContactoHTML('agencia', 'Agencia');

    } else if(tipo === 'Aliado') {
        precioLabel.textContent = 'Pase (sin cobro)';
        container.innerHTML = _pickerContactoHTML('aliado', 'Aliado');
        // Aliado = pase, no hay cobro de dinero
        precioInput.value = '0';
        precioInput.readOnly = true;
        precioInput.setAttribute('readonly', 'readonly');
        precioInput.classList.add('bg-gray-100', 'opacity-60');

    } else if(tipo === 'Comisionado') {
        precioLabel.textContent = 'S/ Precio cobrado al PAX';
        container.innerHTML = _pickerContactoHTML('comision', 'Comisionado');
        comisionBox.classList.remove('hidden');
    }

    actualizarPrecioDefecto();
}

function actualizarPrecioDefecto() {
    let tipo = document.getElementById('input-vd-tipo').value;
    let pax  = parseInt(document.getElementById('input-vd-pax').value) || 0;
    let precioInput = document.getElementById('input-vd-precio');
    // Si el usuario está editando el campo de precio directamente, no sobreescribir su valor
    let usuarioEditandoPrecio = (document.activeElement === precioInput);

    if(tipo === 'Libre') {
        let varios = (window.contactosData || []).find(c => c.id === 'CON-00');
        let precioVarios = varios ? parseFloat(varios.precio) || 30 : 30;
        if(pax > 0 && !usuarioEditandoPrecio) precioInput.value = (precioVarios * pax).toFixed(2);

    } else if(tipo === 'Agencia') {
        // POR ID (data-id), no por nombre: hay nombres repetidos (Overland agencia vs Overland aliado).
        let selc = getContactoSeleccionado('input-vd-contacto-select');
        if(selc.id && !usuarioEditandoPrecio) {
            let info = (window.contactosData||[]).find(c => c.id === selc.id);
            if(info) precioInput.value = ((parseFloat(info.precio)||0) * pax).toFixed(2);
        }

    } else if(tipo === 'Aliado') {
        precioInput.value = '0';

    } else if(tipo === 'Comisionado') {
        let selc = getContactoSeleccionado('input-vd-contacto-select');   // POR ID (nombres repetidos)
        let comisionBox = document.getElementById('box-comision-info');
        if(selc.id && pax > 0) {
            let info = (window.contactosData||[]).find(c => c.id === selc.id);
            if(info) {
                let montoCobrado = parseFloat(precioInput.value) || 0;
                let tarifaBase   = info.precio * pax;
                let comision     = Math.max(0, montoCobrado - tarifaBase).toFixed(2);
                document.getElementById('text-comision-monto').textContent = 'S/ ' + comision;
                document.getElementById('text-comision-detalle').textContent = `S/${montoCobrado.toFixed(2)} cobrado − S/${tarifaBase.toFixed(2)} tarifa (S/${info.precio}×${pax})`;
                comisionBox.classList.remove('hidden');
            }
        } else {
            if(comisionBox) comisionBox.classList.add('hidden');
        }
    }
}

function resetFormularioVenta() {
    window.editandoMovId = null;
    document.getElementById('hidden-vd-idmov').value = '';
    // Recordar el tipo usado para agilizar embarques consecutivos del mismo tipo
    let ultimoTipo = window._ultimoTipoEmbarque || 'Libre';
    document.getElementById('input-vd-tipo').value = ultimoTipo;
    cambiarTipoVentaDirecta(); 
    document.getElementById('input-vd-pax').value = '';
    document.getElementById('input-vd-precio').value = '';
    document.getElementById('titulo-form-venta').innerHTML = `<i class="fas fa-bolt text-yellow-500 text-sm mr-1"></i> Nuevo Embarque`;
    let btnSubmit = document.getElementById('btn-submit-venta');
    if(btnSubmit) {
        btnSubmit.innerHTML = `<i class="fas fa-arrow-up mr-2 text-base"></i> Subir al Bote`;
        btnSubmit.className = "w-full mt-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-black p-3.5 rounded-xl shadow-lg transition flex items-center justify-center uppercase text-xs tracking-wider border border-blue-700";
        btnSubmit.disabled = false;
    }
    let btnGuardar = document.getElementById('btn-guardar-venta');
    if(btnGuardar) btnGuardar.disabled = false;
    document.getElementById('btn-cancelar-edicion').classList.add('hidden');
    document.getElementById('box-formulario-venta').classList.remove('border-orange-300', 'bg-orange-50');
    document.getElementById('box-formulario-venta').classList.add('border-blue-200', 'bg-blue-50');
    
    // Al cancelar, re-renderizar para quitar estado naranja de los items
    let currentDetailOpId = document.getElementById('hidden-gestion-op').value;
    let op = window.operacionesData.find(o => o.id === currentDetailOpId);
    if(op) actualizarListaManifiestoSuave(op.manifiesto);

    // Auto-focus inmediato al campo de nombre/contacto
    setTimeout(() => {
        let contactoInput = document.getElementById('input-vd-contacto-text') || document.getElementById('input-vd-contacto-buscar') || document.getElementById('input-vd-contacto-select');
        if (contactoInput && !document.getElementById('modal-gestion-bote').classList.contains('hidden')) {
            contactoInput.focus();
            if (contactoInput.tagName === 'INPUT') contactoInput.select();
        }
    }, 50);
}

function cargarParaEditar(id_mov) {
    let movToEdit = null;
    let opData = null;
    for(let op of window.operacionesData) {
        let m = op.manifiesto.find(x => x.id === id_mov);
        if(m) { movToEdit = m; opData = op; break; }
    }
    if(!movToEdit || movToEdit.id.startsWith('temp-') || movToEdit.id === 'Creando...') return;
    
    if(window.editandoMovId === id_mov) {
        // Toggle: Si clickeo el mismo, cancelo edicion
        resetFormularioVenta();
        return;
    }

    window.editandoMovId = id_mov;
    document.getElementById('hidden-vd-idmov').value = movToEdit.id;

    // Compatibilidad con tipos viejos y nuevos almacenados en la sheet
    let tipoMapeado = movToEdit.tipo;
    if(tipoMapeado === 'Directo')           tipoMapeado = 'Libre';
    if(tipoMapeado === 'Pase_Recibido')     tipoMapeado = 'Aliado';
    if(tipoMapeado === 'Aliado(PaseIn)')    tipoMapeado = 'Aliado';
    if(tipoMapeado === 'Aliado(PaseOut)')   tipoMapeado = 'Aliado';
    if(tipoMapeado === 'Pase_Externo')      tipoMapeado = 'Aliado';

    document.getElementById('input-vd-tipo').value = tipoMapeado;
    cambiarTipoVentaDirecta();

    // Cargar contacto según tipo
    if(tipoMapeado === 'Libre') {
        let t = document.getElementById('input-vd-contacto-text');
        // nombreContacto se guarda como "LIBRE:FAMILIA VASQUEZ" — extraer solo el nombre de familia
        let nc = movToEdit.nombreContacto || movToEdit.contacto || '';
        let colonIdx = nc.indexOf(':');
        if(t) t.value = colonIdx !== -1 ? nc.slice(colonIdx + 1) : nc;
    } else {
        // Preseleccionar en el buscador (id oculto + nombre visible)
        let nom = movToEdit.nombreContacto || movToEdit.contacto || '';
        let idH = document.getElementById('input-vd-contacto-id'), nomH = document.getElementById('input-vd-contacto-nombre'), inp = document.getElementById('input-vd-contacto-buscar');
        if(idH) idH.value = movToEdit.contacto || '';
        if(nomH) nomH.value = nom;
        if(inp) inp.value = nom;
    }
    document.getElementById('input-vd-pax').value = movToEdit.pax;
    document.getElementById('input-vd-precio').value = movToEdit.monto;
    actualizarPrecioDefecto(); // recalcular comisión si aplica
    
    document.getElementById('titulo-form-venta').innerHTML = `<i class="fas fa-pen text-orange-500 text-sm mr-1"></i> Editando Registro`;
    // Assuming 'titulo-form-venta' is the correct ID for the title, not 'titulo-formulario'
    // document.getElementById('titulo-formulario').classList.replace('text-blue-800', 'text-orange-500'); 
    
    let btnSubmit = document.getElementById('btn-submit-venta');
    if(btnSubmit) {
        btnSubmit.innerHTML = `<i class="fas fa-save mr-2 text-base"></i> Actualizar`;
        btnSubmit.className = "w-full mt-3 bg-orange-500 hover:bg-orange-600 active:scale-95 text-white font-black p-3.5 rounded-xl shadow-lg transition border border-orange-600 uppercase text-xs";
    }
    
    document.getElementById('btn-cancelar-edicion').classList.remove('hidden');
    let box = document.getElementById('box-formulario-venta');
    box.classList.remove('border-blue-200', 'bg-blue-50'); box.classList.add('border-orange-300', 'bg-orange-50');

    // Re-renderizar lista para colorear el item
    if(opData) actualizarListaManifiestoSuave(opData.manifiesto);
}

function confirmarVentaDirecta() {
    let id_op = document.getElementById('hidden-gestion-op').value;
    let id_mov = document.getElementById('hidden-vd-idmov').value;
    let tipo   = document.getElementById('input-vd-tipo').value;
    let pax    = document.getElementById('input-vd-pax').value.trim();
    let precio = document.getElementById('input-vd-precio').value.trim();

    // Contacto: texto libre para Libre, select para el resto
    let contacto, id_contacto_payload, nombre_contacto_payload;
    if(tipo === 'Libre') {
        contacto = (document.getElementById('input-vd-contacto-text')?.value.trim().toUpperCase() || '');
        id_contacto_payload = 'CON-00';
        let con00 = (window.contactosData || []).find(c => c.id === 'CON-00');
        let con00Nombre = con00 ? con00.nombre : 'LIBRE';
        nombre_contacto_payload = con00Nombre + ':' + (contacto || 'VARIOS');
    } else {
        let sel = getContactoSeleccionado('input-vd-contacto-select');
        contacto = sel.nombre;
        id_contacto_payload = sel.id || sel.nombre;
        nombre_contacto_payload = sel.nombre;
    }

    if(tipo === 'Libre' && !contacto) {
        let inp = document.getElementById('input-vd-contacto-text');
        if(inp) {
            inp.classList.add('!border-red-400', '!bg-red-50');
            inp.focus();
            inp.addEventListener('input', () => inp.classList.remove('!border-red-400', '!bg-red-50'), { once: true });
        }
        mostrarToast('❌ Escribe el apellido de familia (mínimo 1 letra).', 'error');
        return;
    }
    if(!contacto) { mostrarToast('❌ Selecciona el contacto.', 'error'); return; }
    if(!pax || parseFloat(pax) <= 0) { mostrarToast('❌ Cantidad de pasajeros inválida.', 'error'); return; }
    if(tipo !== 'Aliado' && (!precio || parseFloat(precio) < 0)) { mostrarToast('❌ Ingresa el precio cobrado.', 'error'); return; }

    // Para Aliado forzar precio 0
    if(tipo === 'Aliado') precio = '0';

    // La comisión del comisionado NO se guarda en adicionales (eso es solo para extras).
    // Se congela por tarifa_base al insertar (trigger tg_freeze_tarifa) y el panel la calcula
    // como cobrado − tarifa_base×pax. Aquí adicionales queda vacío en el embarque.
    let adicionales = '';

    let opIndex = window.operacionesData.findIndex(o => o.id === id_op);
    let newTempId = null; // para rollback en caso de error
    let requestedDelta = 0;

    if(opIndex !== -1) {
        let currentOp = window.operacionesData[opIndex];
        requestedDelta = id_mov ? (parseInt(pax) - parseInt(currentOp.manifiesto.find(m => m.id === id_mov)?.pax || 0)) : parseInt(pax);

        // Guardia local de capacidad (la definitiva la tiene GAS)
        if(currentOp.ocupados + requestedDelta > currentOp.capacidad) {
            mostrarToast(`❌ ¡Bote lleno! Solo quedan ${currentOp.capacidad - currentOp.ocupados} cupos.`, 'error');
            return;
        }

        let tipoOptimista = tipo === 'Aliado' ? 'Aliado(PaseIn)' : tipo;
        if(id_mov) {
            let movIndex = currentOp.manifiesto.findIndex(m => m.id === id_mov);
            if(movIndex !== -1) {
                let movPrevio = currentOp.manifiesto[movIndex];
                currentOp.ocupados += requestedDelta;
                currentOp.manifiesto[movIndex] = { id: id_mov, tipo: tipoOptimista, contacto: id_contacto_payload, nombreContacto: nombre_contacto_payload, pax, monto: parseFloat(precio).toFixed(2), estado: 'Embarcado', adicionales: movPrevio.adicionales || '', _syncing: true };
            }
        } else {
            newTempId = 'temp-' + Date.now();
            currentOp.ocupados += requestedDelta;
            currentOp.manifiesto.unshift({ id: newTempId, tipo: tipoOptimista, contacto: id_contacto_payload, nombreContacto: nombre_contacto_payload, pax, monto: parseFloat(precio).toFixed(2), estado: 'Embarcado', _syncing: true });
        }
        // Actualizar modal + card de operaciones (DOM diffing, solo cambia el card afectado)
        actualizarModalSiAbierto();
        renderOperaciones(window.operacionesData);
    }

    // Recordar tipo para próximo embarque y limpiar formulario
    window._ultimoTipoEmbarque = tipo;
    resetFormularioVenta();

    let endpoint = id_mov ? 'editar_movimiento_pax' : 'registrar_movimiento_pax';
    let paxNum = parseFloat(pax);
    let precioNum = parseFloat(precio);
    let tipoGAS = tipo === 'Aliado' ? 'Aliado(PaseIn)' : tipo;
    let payload = {
        id_operacion: id_op, tipo: tipoGAS, contacto,
        id_contacto: id_contacto_payload,
        nombre_contacto: nombre_contacto_payload,
        pax,
        precio_unitario: paxNum > 0 ? (precioNum / paxNum).toFixed(2) : '0',
        monto_total: precioNum,
        adicionales,
        creador: myOpName
    };
    if(id_mov) payload.id_mov = id_mov;
    if(newTempId) payload.localId = newTempId;   // clave de idempotencia (no duplicar en reintento/cola offline)

    // Timer local: si GAS tarda >8s, quitar "guardando" visualmente (el dato ya está en GAS)
    let _confirmTimer = null;
    if(newTempId) {
        _confirmTimer = setTimeout(() => {
            let opIdx2 = window.operacionesData.findIndex(o => o.id === id_op);
            if(opIdx2 === -1) return;
            let mIdx2 = window.operacionesData[opIdx2].manifiesto.findIndex(m => m.id === newTempId);
            if(mIdx2 !== -1 && window.operacionesData[opIdx2].manifiesto[mIdx2]._syncing) {
                window.operacionesData[opIdx2].manifiesto[mIdx2]._syncing = false;
                actualizarModalSiAbierto();
            }
        }, 8000);
    }

    fetchPostBg(endpoint, payload).then(res => {
        if(_confirmTimer) clearTimeout(_confirmTimer);
        if(res.status === 'error') {
            // ROLLBACK: revertir el item optimista si GAS rechazó
            let opIdx = window.operacionesData.findIndex(o => o.id === id_op);
            if(opIdx !== -1) {
                let op = window.operacionesData[opIdx];
                if(newTempId) {
                    let tIdx = op.manifiesto.findIndex(m => m.id === newTempId);
                    if(tIdx !== -1) { op.manifiesto.splice(tIdx, 1); op.ocupados -= requestedDelta; }
                } else if(id_mov) {
                    let mIdx = op.manifiesto.findIndex(m => m.id === id_mov);
                    if(mIdx !== -1) op.manifiesto[mIdx]._syncing = false;
                }
                actualizarModalSiAbierto();
                renderOperaciones(window.operacionesData);
            }
            mostrarToast('❌ ' + (res.message || 'Error al registrar. Verifica el aforo.'), 'error');
            return;
        }

        // ── Resolución inmediata del temp con el ID real de GAS ──────────────
        if(newTempId && res.id_mov) {
            let opIdx = window.operacionesData.findIndex(o => o.id === id_op);
            if(opIdx !== -1) {
                let mIdx = window.operacionesData[opIdx].manifiesto.findIndex(m => m.id === newTempId);
                if(mIdx !== -1) {
                    window.operacionesData[opIdx].manifiesto[mIdx].id       = res.id_mov;
                    window.operacionesData[opIdx].manifiesto[mIdx]._syncing = false;
                    actualizarModalSiAbierto(); // quita "guardando" del item en la lista
                }
            }
        } else if(id_mov) {
            let opIdx = window.operacionesData.findIndex(o => o.id === id_op);
            if(opIdx !== -1) {
                let mIdx = window.operacionesData[opIdx].manifiesto.findIndex(m => m.id === id_mov);
                if(mIdx !== -1) {
                    window.operacionesData[opIdx].manifiesto[mIdx]._syncing = false;
                    actualizarModalSiAbierto();
                }
            }
        }

    });
}

// ==========================
// FORMULARIO CRM RESERVAS
// ==========================
function cambiarTipoCRM() {
    let tipo = document.getElementById('input-crm-tipo').value;
    let container = document.getElementById('container-crm-contacto');
    let precioInput = document.getElementById('input-crm-precio');

    // Resetear estado del precio antes de aplicar tipo (removeAttribute necesario para iOS Safari)
    precioInput.readOnly = false;
    precioInput.removeAttribute('readonly');
    precioInput.classList.remove('bg-gray-100', 'opacity-50', 'cursor-not-allowed');

    if(tipo === 'Libre') {
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Apellido / Nombre</label>
            <input type="text" id="input-crm-contacto-text" class="${_textInputClass()}" placeholder="Ej: Familia Vasquez">`;

    } else if(tipo === 'Agencia') {
        container.innerHTML = _pickerContactoCRMHTML('agencia', 'Agencia');

    } else if(tipo === 'Aliado') {
        container.innerHTML = _pickerContactoCRMHTML('aliado', 'Aliado');
        precioInput.value = '0';
        precioInput.readOnly = true;
        precioInput.setAttribute('readonly', 'readonly');
        precioInput.classList.add('bg-gray-100', 'opacity-50', 'cursor-not-allowed');

    } else if(tipo === 'Comisionado') {
        container.innerHTML = _pickerContactoCRMHTML('comision', 'Comisionado');
    }
    actualizarPrecioDefectoCRM();
}

function actualizarPrecioDefectoCRM() {
    let tipo = document.getElementById('input-crm-tipo').value;
    let pax  = parseInt(document.getElementById('input-crm-pax').value) || 0;
    let precioInput = document.getElementById('input-crm-precio');

    if(tipo === 'Libre' && pax > 0) {
        precioInput.value = (30 * pax).toFixed(2);

    } else if(tipo === 'Agencia' && pax > 0) {
        // POR ID (no por nombre): hay nombres repetidos (Overland agencia vs aliado).
        let selc = getContactoSeleccionado('input-crm-contacto-select');
        if(selc.id) {
            let info = (window.contactosData||[]).find(c => c.id === selc.id);
            if(info) precioInput.value = ((parseFloat(info.precio)||0) * pax).toFixed(2);
        }

    } else if(tipo === 'Aliado') {
        precioInput.value = '0';
        precioInput.readOnly = true;
        precioInput.setAttribute('readonly', 'readonly');
        precioInput.classList.add('bg-gray-100', 'opacity-50', 'cursor-not-allowed');

    } else if(tipo === 'Comisionado' && pax > 0) {
        let sel = document.getElementById('input-crm-contacto-select');
        if(sel && sel.value) {
            let info = (window.contactosData||[]).find(c => c.nombre === sel.value);
            // Para reservas CRM de comisionado se registra el precio al PAX (se ingresa manual)
            // No auto-llenamos para que el operador lo ingrese conscientemente
        }
    }
}

function confirmarNuevaReserva() {
    let fecha = document.getElementById('input-crm-fecha').value;
    let hora = document.getElementById('input-crm-hora').value || "Libre";
    let tipo = document.getElementById('input-crm-tipo').value;
    let pax = document.getElementById('input-crm-pax').value.trim();
    let precio = document.getElementById('input-crm-precio').value.trim();
    let nombreCliente, id_contacto;
    if (tipo === 'Libre') {
        let apellido  = (document.getElementById('input-crm-contacto-text')?.value.trim().toUpperCase() || '');
        id_contacto   = 'CON-00';
        let con00     = (window.contactosData || []).find(c => c.id === 'CON-00');
        let con00Nombre = con00 ? con00.nombre : 'LIBRE';
        nombreCliente = con00Nombre + ':' + (apellido || 'VARIOS');
    } else {
        let selc = getContactoSeleccionado('input-crm-contacto-select');
        nombreCliente = selc.nombre || '';
        id_contacto   = selc.id || nombreCliente;
    }

    if(!fecha || !nombreCliente || !pax || !precio) { mostrarToast('❌ Fecha, Cliente, PAX y Total son obligatorios.', 'error'); return; }

    let resTemp = {
        id: 'Creando...', fecha: fecha, hora: hora, cliente: nombreCliente,
        contacto: id_contacto, pax: pax, monto: parseFloat(precio).toFixed(2),
        creado_por: myOpName
    };
    window.reservasData.unshift(resTemp);
    try { resOk(); resHap([15, 40, 15]); } catch(e) {}   // reserva registrada ✓
    renderReservas(window.reservasData);
    cerrarModales();

    fetchPostBg('nueva_reserva', {
        fecha: fecha, hora: hora, tipo: tipo,
        id_contacto: id_contacto, cliente: nombreCliente, cant_pax: pax, monto: parseFloat(precio).toFixed(2),
        creador: myOpName, localId: 'temp-res-' + Date.now() + '-' + Math.random().toString(36).slice(2,8)
    }).then((d) => {
        // Si quedó EN COLA (sin red / tiempo agotado), la card lo dice honesto — nada de
        // "Registrando…" con spinner eterno. Al reconectar, la cola la envía y el refresh
        // la reemplaza por la real.
        if (d && d.queued) {
            let t = (window.reservasData || []).find(r => r.id === 'Creando...' && r.cliente === nombreCliente);
            if (t) { t._queued = true; renderReservas(window.reservasData); }
        }
        document.getElementById('input-crm-pax').value = ''; document.getElementById('input-crm-precio').value = '';
        setTimeout(fetchDashboardDataBg, 5000);
    });
}

function prepararAsignacion(id_reserva, cliente, pax, contacto) {
    document.getElementById('hidden-reserva-id').value = id_reserva;
    document.getElementById('hidden-reserva-pax').value = pax;
    document.getElementById('hidden-reserva-agencia').value = contacto;
    document.getElementById('hidden-reserva-cliente').value = cliente;
    document.getElementById('text-pax').innerText = pax;
    document.getElementById('text-cliente').innerText = cliente;

    let selectOp = document.getElementById('select-asignar-op');
    let hoyOp = getHoyLocal();
    let opsAbiertas = window.operacionesData.filter(op => op.estado === 'Abierta' && op.fecha === hoyOp);

    if(opsAbiertas.length === 0) {
        selectOp.innerHTML = '<option value="">No hay lanchas abiertas hoy</option>';
    } else {
        selectOp.innerHTML = '<option value="">- Selecciona un lancha viva -</option>' +
            opsAbiertas.map(op => `<option value="${op.id}">${op.bote} - ${op.ocupados}/${op.capacidad} PAX</option>`).join('');
    }

    abrirModal('modal-asignar-bote'); 
}
function confirmarAsignacion() {
    let id_reserva   = document.getElementById('hidden-reserva-id').value;
    let pax          = document.getElementById('hidden-reserva-pax').value;
    let contacto     = document.getElementById('hidden-reserva-agencia').value;
    let id_operacion = document.getElementById('select-asignar-op').value.trim();
    if(!id_operacion) return alert("❌ Selecciona a qué lancha subirán los pasajeros.");

    let paxNum = parseInt(pax) || 1;

    // Get monto from reserva
    let reserva = (window.reservasData||[]).find(r => r.id === id_reserva);
    let monto   = reserva ? parseFloat(reserva.monto||0) : 0;

    // Determine tipo from contactosData
    let contactInfo   = (window.contactosData||[]).find(c => c.nombre === contacto || c.id === contacto);
    let tipoRaw       = contactInfo ? normTipo(contactInfo.tipo) : '';
    let tipoMovimiento = tipoRaw.includes('aliado')   ? 'Aliado(PaseIn)'  // normalizado: nunca 'Aliado' pelado (evita pases huérfanos)
                       : tipoRaw.includes('comision') ? 'Comisionado'
                       : 'Agencia'; // default for Agencia or unknown

    // Para CON-00 (Libre/Varios) preservar el nombre de familia de la reserva
    let clienteGuardado = document.getElementById('hidden-reserva-cliente')?.value || '';
    let esCon00 = contactInfo && /^CON-00/i.test(contactInfo.id);
    let nombreContacto = esCon00
        ? (clienteGuardado || (reserva ? reserva.cliente : '') || contactInfo.nombre)
        : (contactInfo ? contactInfo.nombre : contacto);
    let idContacto = contactInfo ? contactInfo.id : contacto;

    // Optimistic: mark reserva card as "abordando"
    let resIdx = (window.reservasData||[]).findIndex(r => r.id === id_reserva);
    if(resIdx !== -1) window.reservasData[resIdx]._asignando = true;
    try { resOk(); resHap([15, 40, 15]); } catch(e) {}   // feedback de abordaje confirmado
    renderReservas(window.reservasData);

    // Optimistic: add temp item to manifest
    let tempMovId = 'temp-crm-' + Date.now();
    let opIdx = window.operacionesData.findIndex(o => o.id === id_operacion);
    if(opIdx !== -1) {
        let op = window.operacionesData[opIdx];
        op.manifiesto.unshift({
            id: tempMovId,
            tipo: tipoMovimiento,
            contacto: idContacto,
            nombreContacto: nombreContacto,
            pax: pax,
            monto: monto.toFixed(2),
            estado: 'Embarcado', _syncing: true
        });
        op.ocupados += paxNum;
        renderOperaciones(window.operacionesData);
    }

    cerrarModales();

    // Red de seguridad: si en 12s no se resolvió, limpiar el "cargando" y refrescar
    // (nunca dejar el card en estado ⏳ eterno aunque el refetch de fondo se cuelgue).
    let _resuelto = false;
    let _wd = setTimeout(() => {
        if (_resuelto) return;
        let i = (window.reservasData||[]).findIndex(r => r.id === id_reserva);
        if (i !== -1) { delete window.reservasData[i]._asignando; renderReservas(window.reservasData); }
        fetchDashboardDataBg();
    }, 12000);

    fetchPostBg('asignar_reserva', {
        id_reserva,
        id_operacion,
        cant_pax: pax,
        id_contacto: idContacto,
        nombre_contacto: nombreContacto,
        tipo: tipoMovimiento,
        monto_total: monto,
        precio_unitario: paxNum > 0 ? (monto / paxNum).toFixed(2) : '0',
        creador: myOpName,
        localId: 'temp-asig-' + Date.now() + '-' + Math.random().toString(36).slice(2,8)   // idempotente + resiliente (cola offline)
    }).then(res => {
        _resuelto = true; clearTimeout(_wd);
        // Resolver el estado optimista SIEMPRE aquí — no depender solo del refetch de fondo,
        // que puede saltarse (modal/POST en vuelo) o colgarse y dejar el card en "cargando" eterno.
        let rIdx = (window.reservasData||[]).findIndex(r => r.id === id_reserva);
        let ok = !(res && res.status === 'error');
        if (ok) {
            if (rIdx !== -1) { delete window.reservasData[rIdx]._asignando; window.reservasData[rIdx].estado = 'Asignado'; }  // pasa a "✓ ya embarcaron"
            if (opIdx !== -1) {   // fijar el id real en el item del manifiesto y quitar el "sincronizando"
                let t = (window.operacionesData[opIdx].manifiesto||[]).find(m => m.id === tempMovId);
                if (t) { if (res && res.id_mov) t.id = res.id_mov; delete t._syncing; }
            }
        } else {
            if (rIdx !== -1) delete window.reservasData[rIdx]._asignando;   // devuelve el card a "por embarcar"
            if (opIdx !== -1) {   // revertir el item optimista + liberar aforo
                let op = window.operacionesData[opIdx];
                let before = (op.manifiesto||[]).length;
                op.manifiesto = (op.manifiesto||[]).filter(m => m.id !== tempMovId);
                if (op.manifiesto.length < before) op.ocupados = Math.max(0, op.ocupados - paxNum);
            }
            mostrarToast('❌ ' + (res.message || 'No se pudo asignar. Intenta de nuevo.'), 'error');
        }
        renderReservas(window.reservasData);
        renderOperaciones(window.operacionesData);
        fetchDashboardDataBg();
    }).catch(() => {
        _resuelto = true; clearTimeout(_wd);
        let rIdx = (window.reservasData||[]).findIndex(r => r.id === id_reserva);
        if (rIdx !== -1) { delete window.reservasData[rIdx]._asignando; renderReservas(window.reservasData); }
        fetchDashboardDataBg();
    });
}

// Extras CRM
// modo: 'ingreso' | 'salida' | 'cobro_directo'
// opts: { id_operacion, id_contacto, nombre_contacto, monto, bloqueado }
function abrirModalCaja(modo, opts = {}) {
    let titulo = document.getElementById('titulo-modal-caja');
    let desc   = document.getElementById('desc-modal-caja');
    let btnOk  = document.getElementById('btn-confirmar-caja');

    window._pendingMovsForCobro = null;
    document.getElementById('caja-modo').value               = modo;
    document.getElementById('caja-id-operacion').value       = opts.id_operacion || '';
    document.getElementById('caja-id-contacto-hidden').value = opts.id_contacto || '';
    document.getElementById('caja-id-movimiento').value      = opts.id_mov || '';
    document.getElementById('caja-monto').value              = opts.monto || '';
    document.getElementById('caja-comentarios').value      = '';
    document.getElementById('comprobante-foto-camara').value  = '';
    document.getElementById('comprobante-foto-galeria').value = '';
    document.getElementById('comprobante-foto-preview').innerHTML = '<span class="text-xs text-gray-400">Sin foto</span>';
    document.getElementById('comprobante-foto-nombre').classList.add('hidden');

    let catSel = document.getElementById('caja-categoria');

    if (modo === 'ingreso') {
        titulo.innerHTML = '<i class="fas fa-plus-circle text-green-500 mr-2"></i> Registrar Ingreso';
        desc.textContent = 'Cobros del día o ingresos varios.';
        btnOk.className  = btnOk.className.replace(/bg-\w+-\d+/g,'') + ' bg-green-500 hover:bg-green-600';
        catSel.innerHTML = `
            <option value="Cobro">💰 Cobro (Agencia / Libre / Comisionado)</option>
            <option value="Varios">🔀 Varios</option>`;
        catSel.removeAttribute('disabled');
    } else if (modo === 'salida') {
        titulo.innerHTML = '<i class="fas fa-minus-circle text-red-500 mr-2"></i> Registrar Salida';
        desc.textContent = 'Pagos a comisionados, agencias u otros egresos.';
        btnOk.className  = btnOk.className.replace(/bg-\w+-\d+/g,'') + ' bg-red-500 hover:bg-red-600';
        catSel.innerHTML = `
            <option value="Pagos">🤝 Pagos (Comisionados)</option>
            <option value="Pago Agencia">🏢 Pago Agencia</option>
            <option value="Varios">🔀 Varios</option>`;
        catSel.removeAttribute('disabled');
    } else if (modo === 'pago_agencia') {
        titulo.innerHTML = '<i class="fas fa-store text-orange-500 mr-2"></i> Pagar a Agencia';
        desc.innerHTML   = opts.nombre_contacto
            ? `Pago a <strong>${opts.nombre_contacto}</strong> por ${opts.pax || '?'} PAX.`
            : 'Registrar pago a agencia.';
        btnOk.className  = btnOk.className.replace(/bg-\w+-\d+/g,'') + ' bg-orange-500 hover:bg-orange-600';
        catSel.innerHTML = `<option value="Pago Agencia">🏢 Pago Agencia</option>`;
        catSel.setAttribute('disabled', 'true');
        document.getElementById('caja-monto').value = parseFloat(opts.monto || 0).toFixed(2);
        // Guardar id_mov para que confirmarCaja lo incluya en la tx y el chip cambie inmediatamente
        let idMovEl = document.getElementById('caja-id-movimiento');
        if (idMovEl) idMovEl.value = opts.id_mov || '';
        // Contacto bloqueado — ocultar el selector y forzar el id
        let contactoRow = document.getElementById('caja-contacto-row');
        if (contactoRow) contactoRow.classList.add('hidden');
    } else {
        // cobro_directo: desde botón "Cobrar" en el manifiesto
        titulo.innerHTML = '<i class="fas fa-money-bill-wave text-green-500 mr-2"></i> Cobrar';
        btnOk.className  = btnOk.className.replace(/bg-\w+-\d+/g,'') + ' bg-green-500 hover:bg-green-600';
        catSel.innerHTML = `<option value="Cobro">💰 Cobro</option>`;
        catSel.setAttribute('disabled', 'true');

        let baseNum      = parseFloat(opts.monto || 0);
        let adicNum      = parseFloat(opts.monto_adicionales || 0);
        let totalNum     = baseNum + adicNum;
        let pendienteNum = parseFloat(opts.pendiente || 0);

        // Pre-llenar con monto pendiente si hay pago parcial previo, si no con total
        let montoSugerido = (pendienteNum > 0 && pendienteNum < totalNum) ? pendienteNum : totalNum;
        document.getElementById('caja-monto').value = montoSugerido.toFixed(2);

        // Descripción según estado de pago
        if (pendienteNum > 0 && pendienteNum < totalNum) {
            let pagadoNum = totalNum - pendienteNum;
            desc.innerHTML = opts.nombre_contacto
                ? `Cobro a <strong>${opts.nombre_contacto}</strong><br><span class="text-[11px] text-gray-500">Total S/ ${totalNum.toFixed(2)} · Pagado S/ ${pagadoNum.toFixed(2)} · <span class="text-amber-600 font-black">Pendiente S/ ${pendienteNum.toFixed(2)}</span></span>`
                : 'Registrar cobro parcial.';
        } else if (adicNum > 0) {
            desc.innerHTML = opts.nombre_contacto
                ? `Cobro a <strong>${opts.nombre_contacto}</strong><br><span class="text-[11px] text-gray-500">Base S/ ${baseNum.toFixed(2)} <span class="text-amber-600 font-black">+ Adicionales S/ ${adicNum.toFixed(2)}</span> = <span class="text-green-700 font-black">Total S/ ${totalNum.toFixed(2)}</span></span>`
                : 'Registrar cobro.';
        } else {
            desc.textContent = opts.nombre_contacto ? `Cobro a ${opts.nombre_contacto}` : 'Registrar cobro.';
        }
    }

    onCajaCategoriaChange();
    // Pre-seleccionar contacto si viene en opts
    if (opts.id_contacto) {
        let sel = document.getElementById('caja-select-contacto');
        for (let i = 0; i < sel.options.length; i++) {
            if (sel.options[i].dataset.id === opts.id_contacto) { sel.selectedIndex = i; break; }
        }
        document.getElementById('caja-id-contacto-hidden').value = opts.id_contacto;
    }
    if (opts.bloqueado) {
        document.getElementById('caja-select-contacto').setAttribute('disabled','true');
    }
    // Para contactos Varios (CON-00*): pre-llenar comentarios con nombre de familia
    // (en cobro_directo onCajaContactoChange no se dispara, así que lo hacemos aquí)
    if (/^CON-00/i.test(opts.id_contacto || '') && (opts.nombre_contacto || '')) {
        document.getElementById('caja-comentarios').value = opts.nombre_contacto;
    }
    abrirModal('modal-caja');
}

// Actualiza la UI cuando cambia la categoría
function onCajaCategoriaChange() {
    let modo = document.getElementById('caja-modo').value;
    let cat  = document.getElementById('caja-categoria').value;

    let contactoRow  = document.getElementById('caja-contacto-row');
    let comentReq    = document.getElementById('caja-comentarios-req');
    let sel          = document.getElementById('caja-select-contacto');

    // Mostrar selector de contacto en Cobro, Pagos o Pago Agencia
    if (cat === 'Cobro' || cat === 'Pagos' || cat === 'Pago Agencia') {
        contactoRow.classList.remove('hidden');
        sel.innerHTML = '<option value="">— Seleccionar —</option>';
        let contactos = window.contactosData || [];
        if (cat === 'Pago Agencia') {
            // Agencias con compras pendientes hoy (primero), luego resto
            let deudas = [];
            (window.pasesExternosData || []).filter(p => esFechaHoy(p.timestamp)).forEach(p => {
                let agId = (p.id_agencia_comprada || '').trim();
                if (!agId) return;
                let pagado = (window.cajaData || []).some(c =>
                    (c.id_movimiento || '') === p.id && c.categoria === 'Pago Agencia'
                );
                if (pagado) return;
                let monto = parseFloat(p.monto_comprado) || 0;
                if (!(monto > 0)) return;
                let agInfo = contactos.find(c => c.id === agId);
                let agNombre = agInfo ? agInfo.nombre : agId;
                let ex = deudas.find(d => d.agenciaId === agId);
                if (ex) { ex.pendiente += monto; ex.paseIds.push(p.id); }
                else deudas.push({ agenciaId: agId, agenciaNombre: agNombre, pendiente: monto, paseIds: [p.id] });
            });
            if (deudas.length > 0) {
                let grp = document.createElement('optgroup');
                grp.label = '⚠️ Deudas pendientes hoy';
                deudas.forEach(d => {
                    let opt = document.createElement('option');
                    opt.value = d.agenciaNombre;
                    opt.dataset.id = d.agenciaId;
                    opt.dataset.paseIds = d.paseIds.join(',');
                    opt.textContent = `${d.agenciaNombre} — Debe S/${d.pendiente.toFixed(2)}`;
                    grp.appendChild(opt);
                });
                sel.appendChild(grp);
            }
            let deudaIds = new Set(deudas.map(d => d.agenciaId));
            let restoAg = contactos.filter(c => normTipo(c.tipo).includes('agencia') && !deudaIds.has(c.id));
            if (restoAg.length > 0) {
                let grp2 = document.createElement('optgroup');
                grp2.label = '📋 Otras Agencias';
                restoAg.forEach(c => {
                    let opt = document.createElement('option');
                    opt.value = c.nombre; opt.dataset.id = c.id;
                    opt.textContent = c.nombre;
                    grp2.appendChild(opt);
                });
                sel.appendChild(grp2);
            }
            sel.removeAttribute('disabled');
        } else if (cat === 'Cobro') {
            // ── Recopilar contactos cobrables de HOY (activos + derivados, excluir PaseIn) ──
            let hoyMovs = []; // { contactoId, nombreContacto }
            let _hoyFin = getHoyLocal();
            (window.operacionesData || []).filter(op => op.fecha === _hoyFin).forEach(op => {
                // Manifiesto activo: excluir tipos sin cobro (PaseIn, Pase_Recibido, Aliado)
                [...(op.manifiesto || []), ...(op.manifiesto_pasados || [])].forEach(m => {
                    if (_TIPOS_SIN_COBRO.includes(m.tipo)) return;
                    let cid    = m.contacto || '';
                    let nombre = m.nombreContacto || m.contacto || '';
                    if (!cid || !nombre) return;
                    if (!hoyMovs.some(h => h.contactoId === cid && h.nombreContacto === nombre)) {
                        hoyMovs.push({ contactoId: cid, nombreContacto: nombre });
                    }
                });
            });
            let hoyIds = new Set(hoyMovs.map(h => h.contactoId));

            // Excluir aliados en ambas listas
            let sinAliados = contactos.filter(c => !(c.tipo||'').toLowerCase().includes('aliado'));

            if (hoyMovs.length > 0) {
                let grpHoy = document.createElement('optgroup');
                grpHoy.label = '💡 Ingresaron Hoy';
                hoyMovs.forEach(h => {
                    // Para Varios (CON-00*): solo sumar los movimientos de ESA familia específica
                    let isVarios = /^CON-00/i.test(h.contactoId);
                    let totalPend = 0;
                    (window.operacionesData || []).filter(op => op.fecha === _hoyFin).forEach(op => {
                        [...(op.manifiesto || []), ...(op.manifiesto_pasados || [])].forEach(m => {
                            if (m.contacto !== h.contactoId) return;
                            if (isVarios && m.nombreContacto !== h.nombreContacto) return;
                            totalPend += _calcPagoEstado(m).pendiente;
                        });
                    });
                    let opt = document.createElement('option');
                    opt.value = h.nombreContacto;
                    opt.dataset.id = h.contactoId;
                    opt.dataset.nombreContacto = h.nombreContacto;
                    let cInfo = sinAliados.find(c => c.id === h.contactoId);
                    let tipoLabel = cInfo && cInfo.tipo ? ' · ' + cInfo.tipo : '';
                    let pendLabel = totalPend > 0.01 ? ` 💳 Pend. S/${totalPend.toFixed(2)}` : ' ✓ Al día';
                    opt.textContent = h.nombreContacto + tipoLabel + pendLabel;
                    grpHoy.appendChild(opt);
                });
                sel.appendChild(grpHoy);
            }

            // Resto: contactos no vistos hoy
            let resto = sinAliados.filter(c => !hoyIds.has(c.id));
            if (resto.length > 0) {
                let grpResto = document.createElement('optgroup');
                grpResto.label = '📋 Otros Contactos';
                resto.forEach(c => {
                    let opt = document.createElement('option');
                    opt.value = c.nombre; opt.dataset.id = c.id;
                    opt.textContent = c.nombre + (c.tipo ? ' · ' + c.tipo : '');
                    grpResto.appendChild(opt);
                });
                sel.appendChild(grpResto);
            }
        } else {
            // Pagos: solo comisionados
            contactos.filter(c => (c.tipo||'').toLowerCase().includes('comisionado')).forEach(c => {
                let opt = document.createElement('option');
                opt.value = c.nombre; opt.dataset.id = c.id; opt.textContent = c.nombre;
                sel.appendChild(opt);
            });
        }
        sel.removeAttribute('disabled');
    } else {
        contactoRow.classList.add('hidden');
    }

    // Comentarios obligatorios en Varios
    if (cat === 'Varios') { comentReq.classList.remove('hidden'); }
    else { comentReq.classList.add('hidden'); }
}

function onCajaContactoChange() {
    let sel = document.getElementById('caja-select-contacto');
    let opt = sel.options[sel.selectedIndex];
    let contactoId = opt?.dataset?.id || '';
    document.getElementById('caja-id-contacto-hidden').value = contactoId;

    // Para contactos CON-00* (familia/varios directos) del grupo "Hoy":
    // auto-rellenar comentarios con el nombreContacto específico de ese movimiento
    let nombreContacto = opt?.dataset?.nombreContacto || '';
    if (contactoId && /^CON-00/i.test(contactoId) && nombreContacto) {
        document.getElementById('caja-comentarios').value = nombreContacto;
    }

    // Para Pago Agencia: si hay exactamente un pase pendiente para esa agencia, auto-linkar id_movimiento
    let modo = document.getElementById('caja-modo').value;
    let cat  = document.getElementById('caja-categoria').value;
    let idMovEl = document.getElementById('caja-id-movimiento');
    if (cat === 'Pago Agencia' && idMovEl) {
        let paseIds = (opt?.dataset?.paseIds || '').split(',').filter(Boolean);
        idMovEl.value = paseIds.length === 1 ? paseIds[0] : '';
        // Pre-llenar monto con la deuda de ese pase concreto si es uno solo
        if (paseIds.length === 1) {
            let pase = (window.pasesExternosData || []).find(p => p.id === paseIds[0]);
            if (pase) document.getElementById('caja-monto').value = parseFloat(pase.monto_comprado || 0).toFixed(2);
        }
    }

    // FIFO: pre-llenar monto con total pendiente del contacto (para Cobro regular en Caja tab)
    window._pendingMovsForCobro = null;
    if (contactoId && modo !== 'cobro_directo' && cat === 'Cobro') {
        // Para Varios (CON-00*): filtrar solo por la familia seleccionada, no por todas
        let isVarios = /^CON-00/i.test(contactoId);
        let pendingMovs = [];
        (window.operacionesData || []).forEach(op => {
            [...(op.manifiesto || []), ...(op.manifiesto_pasados || [])].forEach(m => {
                if (m.contacto !== contactoId) return;
                if (isVarios && m.nombreContacto !== nombreContacto) return;
                let ps = _calcPagoEstado(m);
                if (ps.cobrable && ps.pendiente > 0.005) {
                    pendingMovs.push({ id_mov: m.id, pendiente: ps.pendiente });
                }
            });
        });
        if (pendingMovs.length > 0) {
            let totalPend = pendingMovs.reduce((s, m) => s + m.pendiente, 0);
            document.getElementById('caja-monto').value = totalPend.toFixed(2);
            window._pendingMovsForCobro = pendingMovs;
        }
    }
}

function confirmarCaja() {
    let modo        = document.getElementById('caja-modo').value;
    let cat         = document.getElementById('caja-categoria').value;
    let monto       = document.getElementById('caja-monto').value;
    let metodo      = document.getElementById('caja-metodo').value;
    let comentario  = document.getElementById('caja-comentarios').value.trim();
    let idOp        = document.getElementById('caja-id-operacion').value;
    let idContacto  = document.getElementById('caja-id-contacto-hidden').value;
    let idMovimiento= document.getElementById('caja-id-movimiento')?.value || '';

    if (!monto || isNaN(monto) || parseFloat(monto) <= 0) { alert('Ingresa un monto válido.'); return; }
    if (cat === 'Varios' && !comentario) { alert('El campo "Comentarios" es obligatorio para movimientos varios.'); return; }
    if (/^CON-00/i.test(idContacto) && !comentario) { alert('⚠️ Debes ingresar el nombre de la familia en Comentarios para identificar este cobro.'); return; }

    // Prefixar comentarios de Varios con [I] o [S] para identificar dirección
    if (cat === 'Varios') {
        comentario = (modo === 'salida' ? '[S] ' : '[I] ') + comentario;
    }

    // Leer foto comprobante si existe
    let camFile = document.getElementById('comprobante-foto-camara').files[0];
    let galFile = document.getElementById('comprobante-foto-galeria').files[0];
    let fotoFile = camFile || galFile;

    // ── FIFO: distribuir pago entre movimientos pendientes del contacto ────
    let pendMovs = window._pendingMovsForCobro;
    if (!idMovimiento && cat === 'Cobro' && pendMovs && pendMovs.length > 0) {
        window._pendingMovsForCobro = null;
        if (!window.cajaData) window.cajaData = [];
        let remaining = parseFloat(monto);

        function enviarFifo(idMov, amount, foto_base64) {
            let tId = 'temp-tx-' + Date.now() + '-' + Math.random().toString(36).slice(2);
            window.cajaData.unshift({
                id: tId, id_operacion: idOp, id_contacto: idContacto,
                id_movimiento: idMov, categoria: cat,
                monto: amount, metodo_pago: metodo, comentarios: comentario,
                foto_url: '', operador: myOpName, timestamp: new Date().toISOString(), _syncing: true
            });
            fetchPostBg('registrar_transaccion', {
                id_operacion: idOp, id_contacto: idContacto, id_movimiento: idMov,
                categoria: cat, monto: amount, metodo_pago: metodo,
                comentarios: comentario, foto_base64: foto_base64 || '', operador: myOpName, localId: tId
            }).then(res => {
                let idx = (window.cajaData || []).findIndex(c => c.id === tId);
                if (idx !== -1) {
                    if (res && res.id_transaccion) window.cajaData[idx] = { ...window.cajaData[idx], id: res.id_transaccion, _syncing: true };
                    else window.cajaData.splice(idx, 1);
                }
                renderCaja(window.cajaData);
                actualizarModalSiAbierto();
            }).catch(() => {
                let idx = (window.cajaData || []).findIndex(c => c.id === tId);
                if (idx !== -1) window.cajaData.splice(idx, 1);
                renderCaja(window.cajaData);
                actualizarModalSiAbierto();
            });
        }

        function distribuirFifo(foto_base64) {
            for (let mov of pendMovs) {
                if (remaining <= 0.005) break;
                let amount = Math.min(remaining, mov.pendiente);
                enviarFifo(mov.id_mov, amount, foto_base64);
                remaining -= amount;
            }
            // Sobrante sin id_movimiento (exceso de pago)
            if (remaining > 0.005) {
                enviarFifo('', remaining, foto_base64);
            }
        }

        cerrarSubModal('modal-caja');
        if (fotoFile) {
            let reader = new FileReader();
            reader.onload = e => distribuirFifo(e.target.result);
            reader.readAsDataURL(fotoFile);
        } else {
            distribuirFifo('');
        }
        renderCaja(window.cajaData);
        actualizarModalSiAbierto();
        return;
    }

    // ── Optimistic update ─────────────────────────────────────────────────
    let tempId = 'temp-tx-' + Date.now();
    let tempTx = {
        id:            tempId,
        id_operacion:  idOp,
        id_contacto:   idContacto,
        id_movimiento: idMovimiento,
        categoria:     cat,
        monto:         parseFloat(monto),
        metodo_pago:   metodo,
        comentarios:   comentario,
        foto_url:      '',
        operador:      myOpName,
        timestamp:     new Date().toISOString(),
        _syncing:      true
    };
    if (!window.cajaData) window.cajaData = [];
    window.cajaData.unshift(tempTx);
    renderCaja(window.cajaData);
    // Para pago_agencia el chip de la fila de pase depende de cajaData — re-renderizar pases
    if (modo === 'pago_agencia') renderOperaciones(window.operacionesData);
    // Si hay modal de manifiesto abierto, actualizar cards (estado cobro cambió)
    if (idMovimiento) actualizarModalSiAbierto();

    cerrarSubModal('modal-caja');
    // Si venimos de cobro directo (desde el manifiesto), volver al modal del bote
    if (modo === 'cobro_directo' && idOp) {
        document.getElementById('modal-gestion-bote').classList.remove('hidden');
        document.getElementById('modal-backdrop').classList.remove('hidden');
    }

    function enviar(foto_base64) {
        fetchPostBg('registrar_transaccion', {
            id_operacion:  idOp,
            id_contacto:   idContacto,
            id_movimiento: idMovimiento,
            categoria:     cat,
            monto:         parseFloat(monto),
            metodo_pago:   metodo,
            comentarios:   comentario,
            foto_base64:   foto_base64 || '',
            operador:      myOpName,
            localId:       tempId
        }).then(res => {
            let idx = (window.cajaData || []).findIndex(c => c.id === tempId);
            if (idx !== -1) {
                if (res && res.id_transaccion) {
                    // Confirmado por GAS — reemplazar con ID real
                    window.cajaData[idx] = { ...window.cajaData[idx], id: res.id_transaccion, _syncing: true, _queued: false };
                } else if (res && res.queued) {
                    // Error de red — acción encolada offline, mantener visible con indicador naranja
                    window.cajaData[idx] = { ...window.cajaData[idx], _syncing: false, _queued: true };
                } else {
                    // Error real de GAS — rollback
                    window.cajaData.splice(idx, 1);
                }
            }
            renderCaja(window.cajaData);
            if (modo === 'pago_agencia') renderOperaciones(window.operacionesData);
            if (idMovimiento) actualizarModalSiAbierto();
            if (res && res.id_transaccion) setTimeout(fetchDashboardDataBg, 5000);
        }).catch(() => {
            // Error JS inesperado — rollback
            let idx = (window.cajaData || []).findIndex(c => c.id === tempId);
            if (idx !== -1) window.cajaData.splice(idx, 1);
            renderCaja(window.cajaData);
            if (idMovimiento) actualizarModalSiAbierto();
            mostrarToast('❌ Error inesperado al registrar.', 'error');
        });
    }

    if (fotoFile) {
        let reader = new FileReader();
        reader.onload = e => enviar(e.target.result);
        reader.readAsDataURL(fotoFile);
    } else {
        enviar('');
    }
}

function eliminarMovimiento(id_mov, pax) {
    if(!confirm(`¿Eliminar este movimiento (${pax} PAX)? Se marcará como Cancelado.`)) return;
    let id_op = document.getElementById('hidden-gestion-op').value;

    // Registrar como eliminado localmente para prevenir re-aparición en refreshes de fondo
    if (!window._deletedMovIds) window._deletedMovIds = new Set();
    window._deletedMovIds.add(id_mov);

    // Optimistic: quitar de lista local
    let opIdx = window.operacionesData.findIndex(o => o.id === id_op);
    if(opIdx !== -1) {
        let op = window.operacionesData[opIdx];
        let movIdx = op.manifiesto.findIndex(m => m.id === id_mov);
        if(movIdx !== -1) {
            op.ocupados -= parseInt(op.manifiesto[movIdx].pax) || 0;
            op.manifiesto.splice(movIdx, 1);
        }
        actualizarModalSiAbierto();
        renderOperaciones(window.operacionesData);
    }
    window.editandoMovId = null;
    resetFormularioVenta();
    fetchPostBg('eliminar_movimiento', { id_mov, creador: myOpName }).then(res => {
        if(res.status === 'error') { alert(res.message); fetchDashboardData(); }
        // Limpiar del registro de eliminados cuando GAS confirma
        if (window._deletedMovIds) window._deletedMovIds.delete(id_mov);
    });
}

function abrirModalImpuestos(id_mov, contacto) {
    document.getElementById('hidden-impuestos-idmov').value = id_mov;
    document.getElementById('impuestos-contacto').textContent = contacto;
    let lista = document.getElementById('impuestos-lista');
    let impuestos = (window.catalogosData && window.catalogosData.impuestos) || [];

    // Leer adicionales actuales del movimiento para pre-cargar cantidades
    let existingAdics = {};
    let _adicsStr = '';
    for (let op of (window.operacionesData || [])) {
        let mov = (op.manifiesto || []).find(m => m.id === id_mov);
        if (mov) { _adicsStr = mov.adicionales || ''; break; }
    }
    // Fallback: buscar en pases (movimientos convertidos a PASEOUT)
    if (!_adicsStr) {
        let pase = (window.pasesExternosData || []).find(p => p.id === id_mov);
        if (pase) _adicsStr = pase.adicionales || '';
    }
    if (_adicsStr) {
        (_adicsStr + '').split(',').forEach(part => {
            let sep = part.indexOf(':');
            if (sep === -1) return;
            let nombre = part.substring(0, sep).trim();
            let monto  = parseFloat(part.substring(sep + 1).trim()) || 0;
            if (nombre) existingAdics[nombre] = monto;
        });
    }

    if(!impuestos.length) {
        lista.innerHTML = '<p class="text-center text-gray-400 text-xs py-4">No hay impuestos configurados en la hoja Impuestos.</p>';
    } else {
        lista.innerHTML = impuestos.map(imp => {
            let existingMonto = existingAdics[imp.nombre] || 0;
            let qty = (imp.monto > 0) ? Math.round(existingMonto / parseFloat(imp.monto)) : 0;
            let hasQty = qty > 0;
            return `
        <div class="flex items-center justify-between ${hasQty ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200'} border rounded-xl p-3 transition">
            <div>
                <span class="text-sm font-bold text-gray-800">${imp.nombre}</span>
                <span class="text-[11px] text-gray-500 block">S/ ${parseFloat(imp.monto).toFixed(2)} c/u${hasQty ? ` · <span class="text-amber-600 font-black">S/ ${existingMonto.toFixed(2)} cargado</span>` : ''}</span>
            </div>
            <div class="flex items-center space-x-2">
                <button onclick="cambiarQtyImpuesto('${imp.id}', -1)" class="w-8 h-8 rounded-full bg-gray-200 text-gray-700 font-black text-base hover:bg-red-100 hover:text-red-600 transition flex items-center justify-center">−</button>
                <span id="qty-imp-${imp.id}" class="w-7 text-center font-black text-gray-800 text-sm" data-monto="${imp.monto}">${qty}</span>
                <button onclick="cambiarQtyImpuesto('${imp.id}', 1)" class="w-8 h-8 rounded-full bg-gray-200 text-gray-700 font-black text-base hover:bg-green-100 hover:text-green-600 transition flex items-center justify-center">+</button>
            </div>
        </div>`;
        }).join('');
    }

    // Total inicial basado en adicionales existentes
    let initialTotal = Object.values(existingAdics).reduce((sum, v) => sum + v, 0);
    document.getElementById('impuestos-total').textContent = 'S/ ' + initialTotal.toFixed(2);
    abrirModal('modal-impuestos');
}

function cambiarQtyImpuesto(id, delta) {
    let el = document.getElementById('qty-imp-' + id);
    if(!el) return;
    let qty = Math.max(0, parseInt(el.textContent||0) + delta);
    el.textContent = qty;
    // Recalcular total
    let total = 0;
    document.querySelectorAll('[id^="qty-imp-"]').forEach(e => {
        total += parseInt(e.textContent||0) * parseFloat(e.dataset.monto||0);
    });
    document.getElementById('impuestos-total').textContent = 'S/ ' + total.toFixed(2);
}

function confirmarImpuestos() {
    let id_mov = document.getElementById('hidden-impuestos-idmov').value;
    let impuestos = (window.catalogosData && window.catalogosData.impuestos) || [];
    let partes = [];
    impuestos.forEach(imp => {
        let el = document.getElementById('qty-imp-' + imp.id);
        let qty = parseInt(el ? el.textContent : 0) || 0;
        if(qty > 0) partes.push(`${imp.nombre}:${(qty * imp.monto).toFixed(2)}`);
    });
    let adicionales = partes.join(', ');
    cerrarSubModal('modal-impuestos');

    // Optimistic: actualizar adicionales en local state inmediatamente
    let _updatedLocal = false;
    for (let op of (window.operacionesData || [])) {
        let mov = (op.manifiesto || []).find(m => m.id === id_mov);
        if (mov) { mov.adicionales = adicionales; _updatedLocal = true; break; }
    }
    // Fallback: actualizar en pases (movimientos convertidos a PASEOUT)
    if (!_updatedLocal) {
        let pase = (window.pasesExternosData || []).find(p => p.id === id_mov);
        if (pase) pase.adicionales = adicionales;
    }
    let cont = document.getElementById('operaciones-container');
    if (cont) cont._fp = null;
    actualizarModalSiAbierto();
    renderOperaciones(window.operacionesData);

    fetchPostBg('actualizar_adicionales', { id_mov, adicionales, creador: myOpName }).then(res => {
        if (res.status === 'error') alert(res.message);
        else mostrarToast(adicionales ? '✅ Adicionales: ' + adicionales : '✅ Adicionales eliminados.');
    });
}

function abrirModalDerivar(id_mov, pax) {
    document.getElementById('hidden-derivar-idmov').value = id_mov;
    document.getElementById('derivar-pax').innerText = pax;
    
    let select = document.getElementById('select-derivar-aliado');
    if(window.contactosData) {
        let aliados = window.contactosData.filter(c => c.tipo && c.tipo.toLowerCase().includes('aliado'));
        if (aliados.length === 0) aliados = window.contactosData; // fallback
        
        select.innerHTML = '<option value="">- Elige Aliado -</option>' + aliados.map(c => `<option value="${c.nombre}" data-id="${c.id}">${c.nombre}</option>`).join('');
    }
    abrirModal('modal-derivar');
}

function confirmarDerivacion() {
    let id_mov = document.getElementById('hidden-derivar-idmov').value;
    let selAliado = getContactoSeleccionado('select-derivar-aliado');
    let aliado = selAliado.nombre;
    let aliado_id = selAliado.id || aliado;
    let id_op = document.getElementById('hidden-gestion-op').value;
    if(!aliado) return alert("Selecciona a quién se le emite el Pase.");

    cerrarSubModal('modal-derivar');
    window.editandoMovId = null;
    resetFormularioVenta();

    let opIndex = window.operacionesData.findIndex(o => o.id === id_op);
    if(opIndex !== -1) {
        let op = window.operacionesData[opIndex];
        let movIndex = op.manifiesto.findIndex(m => m.id === id_mov);
        if(movIndex !== -1) {
            let mov = op.manifiesto[movIndex];
            let paxNum = parseInt(mov.pax) || 0;
            op.ocupados -= paxNum;

            // Agregar a pases del día con los campos que muestra la tabla
            if(!window.pasesExternosData) window.pasesExternosData = [];
            window.pasesExternosData.unshift({
                id: mov.id,
                tipo: 'Aliado(PaseOut)',
                aliadoId:     aliado_id,
                origenId:     mov.contacto || '',
                origenTipo:   mov.tipo || '',
                nombreOrigen: mov.nombreContacto || mov.contacto,
                pax: mov.pax,
                monto: mov.monto,
                estado: 'Pasado',
                _syncing: true,
                timestamp: new Date().toISOString()
            });

            op.manifiesto.splice(movIndex, 1);
            actualizarModalSiAbierto();
            renderOperaciones(window.operacionesData);
        }
    }

    fetchPostBg('derivar_pase', { id_mov, aliado, aliado_id, id_operacion_origen: id_op, operador: myOpName }).then(res => {
        if(res.status === 'error') { alert(res.message); return; }
        clearTimeout(window._syncTimer);
        window._syncTimer = setTimeout(syncManifestBg, 3000);
    });
}

// ============================
// ANULAR PASE
// ============================
// Escapes para el modal dinámico: _escArg (arg dentro de onclick — comilla simple Y doble); _escHtml (texto en innerHTML).
function _escArg(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, "\\'"); }
function _escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function iniciarAnularPase(id_mov, pax, nombreContacto) {
    document.getElementById('hidden-anular-idmov').value = id_mov;
    const pase = (window.pasesExternosData || []).find(p => p.id === id_mov) || {};
    const paxN = parseInt(pax) || parseInt(pase.pax) || 0;
    const origen = pase.nombreOrigen || nombreContacto || '—';
    // Deuda del ORIGEN = monto + adicionales (mismo criterio que el balance de agencias).
    const monto = parseFloat(pase.monto) || 0;
    let adic = pase.adicionales || '';
    if (!adic) { for (const op of (window.operacionesData || [])) { const m = (op.manifiesto || []).find(x => x.id === id_mov); if (m) { adic = m.adicionales || ''; break; } } }
    const adicSum = adic ? adic.split(',').reduce((a, part) => a + (parseFloat((part.split(':')[1] || '').trim()) || 0), 0) : 0;
    const deuda = Math.round((monto + adicSum) * 100) / 100;
    // ¿el origen genera deuda? (Aliado/PaseIn no cobran). Reusa el mismo criterio que el botón Cobrar.
    const cobrable = !_TIPOS_SIN_COBRO.includes(pase.tipo || '') && !!(pase.origenId);
    // Pagos ligados = MISMA guarda que el backend eliminar_movimiento (cualquier fila de caja con este movimiento).
    const pagosLig = (window.cajaData || []).filter(c => (c.id_movimiento || '') === id_mov);
    const cobrado = Math.round(pagosLig.reduce((a, c) => a + (parseFloat(c.monto) || 0), 0) * 100) / 100;
    const tienePagos = pagosLig.length > 0;
    // Lanchas abiertas hoy
    const hoy = getHoyLocal();
    const ops = (window.operacionesData || []).filter(op => op.estado === 'Abierta' && (op.fecha === hoy || !op.fecha));
    const S = v => 'S/ ' + (parseFloat(v) || 0).toFixed(2);
    const oH = _escHtml(origen);           // texto visible
    const oA = _escArg(origen), idA = _escArg(id_mov);   // dentro de onclick

    let html = `<div class="bg-gray-50 border border-gray-200 rounded-2xl p-3 mb-4 text-[12px]">
        <div class="font-black text-gray-800">${paxN} pax · ${oH}</div>`;
    if (cobrable) {
        html += `<div class="mt-1 flex justify-between"><span class="text-gray-500">${oH} debe</span><b class="text-red-600">${S(deuda)}</b></div>
                 <div class="flex justify-between"><span class="text-gray-500">Cobrado</span><b class="${cobrado > 0 ? 'text-green-600' : 'text-gray-400'}">${S(cobrado)}</b></div>`;
    } else {
        html += `<div class="mt-1 text-[11px] text-gray-400">Este pase no genera deuda de cobro.</div>`;
    }
    html += `</div>`;

    // ── REASIGNAR ──
    html += `<div class="mb-4"><div class="text-[10px] font-bold text-red-800 uppercase tracking-widest mb-2">Reasignar a una lancha</div>`;
    if (ops.length) {
        html += `<select id="select-anular-op" class="w-full bg-white border border-red-200 rounded-xl p-3 text-[11px] font-bold shadow-sm">
                <option value="">- Selecciona lancha -</option>` +
            ops.map(op => `<option value="${_escHtml(op.id)}">${_escHtml(op.bote)} · ${_escHtml(op.id)} (${op.ocupados}/${op.capacidad} pax)</option>`).join('') +
            `</select>
             <button class="mt-2 w-full bg-red-600 text-white py-3 rounded-xl font-bold uppercase tracking-wide text-[11px] shadow-md shadow-red-500/30" onclick="confirmarAnularPase()"><i class="fas fa-undo-alt mr-1"></i> Reasignar aquí</button>
             <p class="mt-1 text-[10px] text-gray-400 leading-snug">Los ${paxN} pax vuelven a esa lancha; el registro y la deuda siguen vivos.</p>`;
    } else {
        html += `<div class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-800 leading-snug">
            <i class="fas fa-info-circle mr-1"></i> No hay lanchas abiertas hoy. Abre una operación para poder reasignar los ${paxN} pax, o elimina el registro abajo.</div>`;
    }
    html += `</div>`;

    // ── ELIMINAR (siempre visible; candado = tiene pago) ──
    html += `<div class="border-t border-gray-100 pt-4"><div class="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-2">Eliminar registro</div>`;
    if (tienePagos) {
        html += `<div class="bg-gray-100 border border-gray-200 rounded-xl p-3 text-[11px] text-gray-600 leading-snug mb-2">
            <i class="fas fa-lock mr-1"></i> Este pase tiene un pago registrado (${S(cobrado)}). Para eliminarlo, primero anula el/los cobro(s) en <b>Caja</b> y devuelve la plata.</div>
            <button disabled class="w-full bg-gray-100 text-gray-400 py-3 rounded-xl font-bold text-[11px] cursor-not-allowed"><i class="fas fa-lock mr-1"></i> Bloqueado — tiene un pago registrado</button>`;
    } else {
        html += `<button class="w-full bg-red-50 text-red-600 border border-red-200 py-3 rounded-xl font-bold text-[11px] hover:bg-red-100 active:scale-95 transition" onclick="eliminarPaseRegistro('${idA}', ${deuda}, '${oA}', ${cobrable && deuda > 0 ? 1 : 0})"><i class="fas fa-trash-alt mr-1"></i> Eliminar este registro</button>`;
    }
    html += `</div>`;

    document.getElementById('anular-pase-body').innerHTML = html;
    abrirModal('modal-anular-pase');
}

// Paso de confirmación (dentro del mismo modal) antes de eliminar el pase.
function eliminarPaseRegistro(id_mov, deuda, origen, absuelve) {
    const S = 'S/ ' + (parseFloat(deuda) || 0).toFixed(2);
    const aviso = absuelve
        ? `Se cancelará este pase <b>y la deuda de ${_escHtml(origen)} por ${S} quedará absuelta</b> — ya no te deberá nada.`
        : `Se cancelará este pase (no genera deuda de cobro).`;
    document.getElementById('anular-pase-body').innerHTML = `
        <div class="bg-red-50 border border-red-200 rounded-2xl p-4 text-[12px] text-red-800 leading-snug mb-4">
            <div class="font-black mb-1"><i class="fas fa-exclamation-triangle mr-1"></i> ¿Eliminar el pase?</div>${aviso}
        </div>
        <div class="flex space-x-3">
            <button class="flex-1 bg-gray-100 text-gray-600 py-3.5 rounded-xl font-bold text-sm" onclick="cerrarSubModal('modal-anular-pase')">Cancelar</button>
            <button class="flex-[2] bg-red-600 text-white py-3.5 rounded-xl font-bold uppercase tracking-wide text-[11px] shadow-md shadow-red-500/30" onclick="ejecutarEliminarPase('${_escArg(id_mov)}', ${absuelve ? 1 : 0})"><i class="fas fa-trash-alt mr-1"></i> Sí, eliminar</button>
        </div>`;
}

function ejecutarEliminarPase(id_mov, absuelve) {
    if (window._eliminandoPase) return;   // lock anti doble-tap
    window._eliminandoPase = true;
    const restaurar = () => { try { fetchDashboardDataBg(); } catch (e) {} };   // repuebla pasesExternosData (syncManifestBg NO lo hace)
    let p;
    try {
        cerrarSubModal('modal-anular-pase');
        // Optimista: quitar de la vista; el backend es la guarda real (bloquea si aparece un pago).
        const idx = (window.pasesExternosData || []).findIndex(x => x.id === id_mov);
        if (idx !== -1) { window.pasesExternosData.splice(idx, 1); renderOperaciones(window.operacionesData); }
        p = fetchPostBg('eliminar_movimiento', { id_mov });
    } catch (e) { window._eliminandoPase = false; restaurar(); return; }   // nunca dejar el lock atascado si algo lanza síncrono
    p.then(res => {
        if (res && res.status === 'error') {
            mostrarToast('⚠️ ' + (res.message || 'No se pudo eliminar el pase.'), 'error');
            restaurar();   // el backend lo rechazó → traer de vuelta el pase
            return;
        }
        mostrarToast(res && res.queued ? '⏳ Se eliminará al reconectar' : ('🗑️ Pase eliminado' + (absuelve ? ' · deuda absuelta' : '')), res && res.queued ? 'info' : 'success');
        clearTimeout(window._syncTimer); window._syncTimer = setTimeout(syncManifestBg, 1500);
    }).catch(() => { mostrarToast('⚠️ Sin conexión — reintenta', 'error'); restaurar(); })
      .finally(() => { window._eliminandoPase = false; });
}

function confirmarAnularPase() {
    let id_mov = document.getElementById('hidden-anular-idmov').value;
    let id_op  = document.getElementById('select-anular-op').value;
    if(!id_op) return mostrarToast('Selecciona una lancha abierta para reasignar.', 'error');
    if (window._reasignandoPase) return;   // lock anti doble-tap (evita doble POST de reasignación)
    window._reasignandoPase = true;
    const restaurar = () => { try { fetchDashboardDataBg(); } catch (e) {} };
    let p;
    try {
        cerrarSubModal('modal-anular-pase');
        // Optimista: quitar de pasesExternosData y reasignar en la op
        let idx = (window.pasesExternosData || []).findIndex(x => x.id === id_mov);
        if(idx !== -1) {
            let pase = window.pasesExternosData.splice(idx, 1)[0];
            let op = window.operacionesData.find(o => o.id === id_op);
            if(op) {
                let paxNum = parseInt(pase.pax) || 0;
                let origenId = pase.origenId || '';
                let contactoInfo = (window.contactosData || []).find(c => c.id === origenId || c.nombre === origenId);
                let tipoMov = contactoInfo ? (contactoInfo.tipo || 'Directo') : 'Directo';
                op.manifiesto.unshift({ id: id_mov, tipo: tipoMov, contacto: pase.origenId || pase.nombreOrigen, nombreContacto: pase.nombreOrigen, pax: pase.pax, monto: pase.monto, estado: 'Embarcado' });
                op.ocupados += paxNum;
            }
            renderOperaciones(window.operacionesData);
        }
        p = fetchPostBg('anular_pase', { id_mov, id_operacion_nueva: id_op, operador: myOpName });
    } catch (e) { window._reasignandoPase = false; restaurar(); return; }
    p.then(res => {
        if(res && res.status === 'error') {
            mostrarToast('⚠️ ' + (res.message || 'No se pudo reasignar.'), 'error');
            restaurar();   // el splice/manifiesto optimista se revierte al repoblar
            return;
        }
        mostrarToast(res && res.queued ? '⏳ Se reasignará al reconectar' : '✅ Pase anulado. Movimiento reasignado.', res && res.queued ? 'info' : 'success');
        clearTimeout(window._syncTimer);
        window._syncTimer = setTimeout(syncManifestBg, 2000);
    }).catch(() => { mostrarToast('⚠️ Sin conexión — reintenta', 'error'); restaurar(); })
      .finally(() => { window._reasignandoPase = false; });
}

// ============================
// COMPRAR PASE (pase → compra agencia)
// ============================
function abrirModalComprarPase(id_mov, cantPax, nombreOrigen) {
    document.getElementById('hidden-comprar-idmov').value = id_mov;
    document.getElementById('hidden-comprar-pax').value   = cantPax;
    document.getElementById('comprar-pase-info').textContent = `${cantPax} PAX · ${nombreOrigen}`;
    document.getElementById('comprar-monto').value = '';
    document.getElementById('comprar-monto-referencia').classList.add('hidden');

    // Poblar selector solo con agencias
    let sel = document.getElementById('select-comprar-agencia');
    let agencias = (window.contactosData || []).filter(c => (c.tipo || '').toLowerCase().includes('agencia'));
    sel.innerHTML = '<option value="">— Seleccionar agencia —</option>' +
        agencias.map(a => `<option value="${a.id}" data-precio="${a.precio||0}">${a.nombre}</option>`).join('');

    abrirModal('modal-comprar-pase');
}

function onComprarAgenciaChange() {
    let sel    = document.getElementById('select-comprar-agencia');
    let opt    = sel.options[sel.selectedIndex];
    let precio = parseFloat(opt?.dataset?.precio || 0);
    let pax    = parseInt(document.getElementById('hidden-comprar-pax').value) || 0;
    let ref    = document.getElementById('comprar-monto-referencia');
    if (precio > 0 && pax > 0) {
        let calc = precio * pax;
        document.getElementById('comprar-monto').value = calc.toFixed(2);
        ref.textContent = `Precio pax defecto S/${precio.toFixed(2)} × ${pax} PAX = S/${calc.toFixed(2)}`;
        ref.classList.remove('hidden');
    } else {
        ref.classList.add('hidden');
    }
}

function confirmarComprarPase() {
    let id_mov = document.getElementById('hidden-comprar-idmov').value;
    let sel    = document.getElementById('select-comprar-agencia');
    let id_agencia   = sel.value;
    let nombre_agencia = sel.options[sel.selectedIndex]?.text || id_agencia;
    let monto  = parseFloat(document.getElementById('comprar-monto').value);

    if (!id_agencia)  return alert('Selecciona una agencia.');
    if (!(monto > 0)) return alert('Ingresa un monto válido.');

    cerrarSubModal('modal-comprar-pase');

    // Optimistic: actualizar pasesExternosData inmediatamente
    let paseIdx = (window.pasesExternosData || []).findIndex(p => p.id === id_mov);
    let paseAnterior = paseIdx !== -1 ? { ...window.pasesExternosData[paseIdx] } : null;
    if (paseIdx !== -1) {
        // el aliado se CONSERVA (rastro de a quién se intentó pasar); solo se agrega la compra
        window.pasesExternosData[paseIdx].id_agencia_comprada = id_agencia;
        window.pasesExternosData[paseIdx].monto_comprado      = monto;
        window.pasesExternosData[paseIdx]._syncing            = true;
    }
    // Los pases se renderizan dentro de renderOperaciones, no de renderCaja
    renderOperaciones(window.operacionesData);

    fetchPostBg('convertir_pase_a_compra', { id_mov, id_agencia, nombre_agencia, monto, operador: myOpName }).then(res => {
        if (paseIdx !== -1) window.pasesExternosData[paseIdx]._syncing = false;
        if (res.status === 'error') {
            // Rollback
            if (paseIdx !== -1 && paseAnterior) window.pasesExternosData[paseIdx] = paseAnterior;
            renderOperaciones(window.operacionesData);
            mostrarToast('❌ ' + (res.message || 'Error al convertir pase.'), 'error');
            return;
        }
        mostrarToast('✅ Pase convertido a compra con ' + nombre_agencia + '.', 'success');
        renderOperaciones(window.operacionesData);
        clearTimeout(window._syncTimer);
        window._syncTimer = setTimeout(syncManifestBg, 2000);
    }).catch(() => {
        if (paseIdx !== -1 && paseAnterior) window.pasesExternosData[paseIdx] = paseAnterior;
        renderOperaciones(window.operacionesData);
        mostrarToast('❌ Error de conexión al convertir pase.', 'error');
    });
}

function _esIngresoCaja(tx) {
    let CATS_INGRESO = ['Cobro', 'Caja Chica', 'Ingreso por Venta', 'Ingreso_Venta', 'Caja_Chica'];
    let CATS_SALIDA  = ['Pagos', 'Pago_Comisionado', 'Pago Comisionado', 'Retiro_Jefatura', 'Retiro a Jefatura', 'Pago Agencia'];
    if (tx.categoria === 'Varios') return !(tx.comentarios||'').startsWith('[S]');
    return CATS_INGRESO.includes(tx.categoria);
}

function abrirDetalleCaja(id_tx) {
    let tx = window.cajaData.find(c => c.id === id_tx);
    if(!tx) return;
    window._detalleCajaTxId = id_tx;

    let isPase    = tx.metodo_pago === 'Pase_Canje' || tx.metodo_pago === 'Pase / Canje';
    let esIngreso = _esIngresoCaja(tx);

    let icono  = document.getElementById('detalle-caja-icono');
    let boxCat = document.getElementById('detalle-caja-cat');
    let signo  = isPase ? '🤝' : (esIngreso ? '+' : '-');

    if (isPase) {
        icono.className = 'w-16 h-16 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center mx-auto mb-3 text-2xl shadow-inner';
        icono.innerHTML = '<i class="fas fa-handshake"></i>';
    } else if (esIngreso) {
        icono.className = 'w-16 h-16 rounded-full bg-green-100 text-green-500 flex items-center justify-center mx-auto mb-3 text-2xl shadow-inner';
        icono.innerHTML = '<i class="fas fa-arrow-down"></i>';
    } else {
        icono.className = 'w-16 h-16 rounded-full bg-red-100 text-red-500 flex items-center justify-center mx-auto mb-3 text-2xl shadow-inner';
        icono.innerHTML = '<i class="fas fa-arrow-up"></i>';
    }

    document.getElementById('detalle-caja-monto').innerText = signo + ' S/ ' + parseFloat(tx.monto).toFixed(2);
    document.getElementById('detalle-caja-fecha').innerText = new Date(tx.timestamp).toLocaleString();
    document.getElementById('detalle-caja-id').innerText    = tx.id;
    boxCat.innerText = (tx.categoria === 'Varios'
        ? 'Varios · ' + (tx.comentarios||'').replace(/^\[.\] ?/,'')
        : tx.categoria.replace(/_/g,' '));
    document.getElementById('detalle-caja-metodo').innerText = tx.metodo_pago || 'Efectivo';
    document.getElementById('detalle-caja-op').innerText     = tx.operador || 'Sistema';

    abrirModal('modal-detalle-caja');
}

function anularTransaccionCaja() {
    let id_tx = window._detalleCajaTxId;
    if (!id_tx) return;
    let tx = (window.cajaData || []).find(c => c.id === id_tx);
    if (!tx) return;

    let monto = parseFloat(tx.monto).toFixed(2);
    let cat   = (tx.categoria || '').replace(/_/g, ' ');
    if (!confirm(`¿Anular este registro?\n\n${cat} · S/ ${monto}\n\nEsta acción no se puede deshacer.`)) return;

    cerrarSubModal('modal-detalle-caja');

    // Quitar de local state
    let idx = window.cajaData.findIndex(c => c.id === id_tx);
    if (idx !== -1) window.cajaData.splice(idx, 1);
    renderCaja(window.cajaData);

    // Invalidar FP del manifiesto y container para que recalculen el estado de cobro
    // en la próxima apertura del modal (el botón Cobrar debe reaparecer)
    let listaEl = document.getElementById('gestion-manifiesto-lista');
    if (listaEl) listaEl._fp = null;
    let contEl = document.getElementById('operaciones-container');
    if (contEl) contEl._fp = null;

    actualizarModalSiAbierto();
    window._detalleCajaTxId = null;

    fetchPostBg('eliminar_transaccion', { id_transaccion: id_tx, operador: myOpName })
        .then(res => {
            if (res && res.status === 'error') {
                mostrarToast('Error al anular: ' + res.message, 'error');
                // Revertir si falla
                setTimeout(fetchDashboardDataBg, 1000);
            } else {
                mostrarToast('✅ Cobro anulado correctamente.');
                setTimeout(fetchDashboardDataBg, 3000);
            }
        })
        .catch(() => {
            mostrarToast('Error de conexión al anular.', 'error');
            setTimeout(fetchDashboardDataBg, 2000);
        });
}

function obtenerHoraSugerida() {
    let siguiente = new Date().getHours() + 1;
    if(siguiente < 7) siguiente = 7;
    let ampm = siguiente >= 12 ? 'PM' : 'AM';
    let h12 = siguiente > 12 ? siguiente - 12 : siguiente;
    if(h12 === 0) h12 = 12;
    return h12.toString().padStart(2, '0') + ":00 " + ampm;
}

function actualizarHoraSugeridaCRM() {
    let fechaInput = document.getElementById('input-crm-fecha').value; 
    let selectHora = document.getElementById('input-crm-hora');
    if(!selectHora) return;
    
    let hoy = getHoyLocal();
    if(fechaInput === hoy) {
        let hStr = obtenerHoraSugerida();
        let found = Array.from(selectHora.options).find(opt => opt.value === hStr);
        if(found) selectHora.value = hStr; else selectHora.selectedIndex = 0;
    } else {
        selectHora.selectedIndex = 0;
    }
}

function fetchPost(action, payload) { return fetch(GAS_URL, { method: 'POST', redirect: 'follow', body: JSON.stringify({ action: action, payload: payload }), headers: {'Content-Type': 'text/plain;charset=utf-8'} }).then(res => res.json()).then(data => { if(data.message) alert(data.message); return data; }).catch(err => { return { status: 'error', message: 'Fallo red' }; }); }
// ── Cola offline ─────────────────────────────────────────────────────────────
const _OFFLINE_Q_KEY = 'sot_offline_queue';
function _enqueueOffline(action, payload) {
    try {
        let q = JSON.parse(localStorage.getItem(_OFFLINE_Q_KEY) || '[]');
        q.push({ action, payload, ts: Date.now() });
        localStorage.setItem(_OFFLINE_Q_KEY, JSON.stringify(q));
    } catch(e) {}
}
async function _processOfflineQueue() {
    if (window._offlineQBusy) return;   // ya hay un vaciado en curso (online + resume pueden coincidir)
    let q;
    try { q = JSON.parse(localStorage.getItem(_OFFLINE_Q_KEY) || '[]'); } catch(e) { q = []; }
    if (!q.length) return;
    window._offlineQBusy = true;
    try {
    mostrarToast(`🔄 Enviando ${q.length} acción(es) pendiente(s)...`, 'info');
    let failed = [];
    for (let item of q) {
        try {
            let res = await fetch(GAS_URL, { method: 'POST', redirect: 'follow', body: JSON.stringify({ action: item.action, payload: item.payload }), headers: {'Content-Type': 'text/plain;charset=utf-8'} }).then(r => r.json());
            if (res.status === 'error') failed.push(item);
        } catch(e) { failed.push(item); }
    }
    localStorage.setItem(_OFFLINE_Q_KEY, JSON.stringify(failed));
    if (!failed.length) {
        mostrarToast('✅ Acciones pendientes enviadas.', 'success');
        // Limpiar entradas _queued del cajaData local — el BG refresh traerá las reales de GAS
        window.cajaData = (window.cajaData || []).filter(c => !c._queued);
        renderCaja(window.cajaData);
        // Reservas en cola: quitar el flag (el refresh trae la real y reemplaza la temp)
        (window.reservasData || []).forEach(r => { if (r._queued) delete r._queued; });
        renderReservas(window.reservasData || []);
        fetchDashboardDataBg();
    } else {
        mostrarToast(`⚠️ ${failed.length} acción(es) no se pudieron enviar aún.`, 'error');
    }
    } finally { window._offlineQBusy = false; }
}
window.addEventListener('online',  () => { mostrarToast('📶 Conexión restaurada.', 'success'); _processOfflineQueue(); });
window.addEventListener('offline', () => { mostrarToast('📶 Sin conexión. Las acciones se guardarán para reenviar.', 'error'); });

function fetchPostBg(action, payload) {
    pendingPostRequests++;
    window._lastPostAt = Date.now();
    let dot = document.getElementById('sync-dot');
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-300 animate-ping';
    // WATCHDOG 25s: en iPhone un fetch puede COLGARSE (red suspendida a mitad) → la promesa
    // jamás resolvía → pendingPostRequests quedaba >0 PARA SIEMPRE → todos los refrescos de
    // fondo vetados → la card "Registrando…" eterna y la app "muerta". El settle único
    // garantiza que el contador SIEMPRE baja; si el fetch tardío al final responde, no
    // decrementa doble ni encola doble (y el reenvío de la cola es idempotente por localId).
    let settled = false;
    const settle = () => { if (settled) return false; settled = true; pendingPostRequests = Math.max(0, pendingPostRequests - 1); return true; };
    const okDot  = () => { if (dot && pendingPostRequests === 0) dot.className = 'w-2 h-2 rounded-full bg-emerald-300 animate-pulse'; };
    const aCola  = (msg) => {
        if (dot) dot.className = 'w-2 h-2 rounded-full bg-red-400';
        setTimeout(okDot, 3000);
        _enqueueOffline(action, payload);
        mostrarToast('📶 Sin conexión. La acción se reintentará al reconectar.', 'error');
        return { status: 'error', queued: true, message: msg };
    };
    const req = fetch(GAS_URL, { method: 'POST', redirect: 'follow', body: JSON.stringify({ action: action, payload: payload }), headers: {'Content-Type': 'text/plain;charset=utf-8'} })
        .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
        .then(d => { if (!settle()) return d; okDot(); return d; })
        .catch(() => { if (!settle()) return { status: 'error', message: 'tarde' }; return aCola('Error de conexión'); });
    const watchdog = new Promise(resolve => setTimeout(() => { if (settle()) resolve(aCola('Tiempo agotado')); }, 25000));
    return Promise.race([req, watchdog]);
}

// ==========================
// PASE DIRECTO DESDE RESERVA
// ==========================
function abrirPaseDesdeReserva(id_reserva, cliente, pax, contacto) {
    document.getElementById('hidden-pase-res-id').value      = id_reserva;
    document.getElementById('hidden-pase-res-pax').value     = pax;
    document.getElementById('hidden-pase-res-contacto').value = contacto;
    document.getElementById('pase-res-cliente').textContent  = cliente;
    document.getElementById('pase-res-pax').textContent      = pax;

    let sel = document.getElementById('select-pase-res-aliado');
    let aliados = (window.contactosData||[]).filter(c => normTipo(c.tipo).includes('aliado'));
    if(!aliados.length) aliados = window.contactosData || [];
    sel.innerHTML = '<option value="">- Elige Aliado -</option>' +
        aliados.map(c => `<option value="${c.nombre}" data-id="${c.id}">${c.nombre}</option>`).join('');

    abrirModal('modal-pase-reserva');
}

function confirmarPaseDesdeReserva() {
    let id_reserva = document.getElementById('hidden-pase-res-id').value;
    let pax        = document.getElementById('hidden-pase-res-pax').value;
    let contacto   = document.getElementById('hidden-pase-res-contacto').value;
    let sel        = getContactoSeleccionado('select-pase-res-aliado');
    if(!sel.nombre) return alert('Selecciona a qué aliado enviamos los pax.');

    // Optimistic: marcar reserva como procesando
    let resIdx = (window.reservasData||[]).findIndex(r => r.id === id_reserva);
    if(resIdx !== -1) window.reservasData[resIdx]._asignando = true;
    renderReservas(window.reservasData);

    // Optimistic: agregar a pases del día.
    // Se usa tempId para poder eliminarlo al confirmar GAS y evitar duplicado.
    if(!window.pasesExternosData) window.pasesExternosData = [];
    let tempPaseId = 'temp-pase-' + Date.now();
    window.pasesExternosData.unshift({
        id: tempPaseId,
        tipo: 'Aliado(PaseOut)',
        aliadoId:     sel.id || sel.nombre,
        nombreOrigen: contacto,
        pax: pax,
        monto: '0',
        estado: 'Pasado',
        _syncing: true,
        timestamp: new Date().toISOString()
    });
    renderOperaciones(window.operacionesData);

    cerrarSubModal('modal-pase-reserva');

    // Recuperar monto de la reserva original para no perder la información de cobranza
    let resObj = (window.reservasData || []).find(r => r.id === id_reserva);
    let montoTotal  = resObj ? (parseFloat(resObj.monto) || 0) : 0;
    let paxNum      = parseInt(pax) || 1;
    let precioUnit  = paxNum > 0 ? montoTotal / paxNum : 0;
    // Resolver nombre real del contacto (no mandar el ID como nombre)
    let contactoInfo = (window.contactosData || []).find(c => c.id === contacto || c.nombre === contacto);
    let nombreContactoReal = contactoInfo ? contactoInfo.nombre : contacto;

    fetchPostBg('pase_desde_reserva', {
        id_reserva,
        cant_pax: pax,
        aliado: sel.nombre,
        aliado_id: sel.id || sel.nombre,
        id_contacto_original: contacto,
        nombre_contacto_original: nombreContactoReal,
        precio_unitario: precioUnit,
        monto_total: montoTotal,
        creador: myOpName,
        localId: tempPaseId
    }).then(res => {
        if(res.status === 'error') { alert(res.message); return; }
        // Eliminar el temp optimista ANTES del BG fetch para evitar que se re-inyecte como duplicado.
        // El BG fetch traerá el pase real con su MOV-id definitivo.
        window.pasesExternosData = (window.pasesExternosData || []).filter(p => p.id !== tempPaseId);
        clearTimeout(window._syncTimer);
        window._syncTimer = setTimeout(fetchDashboardDataBg, 3000);
    });
}

// ==========================
// EDITAR OPERACIÓN
// ==========================
function abrirModalEditarOp(id_op) {
    let op = window.operacionesData.find(o => o.id === id_op);
    if(!op) return;

    document.getElementById('hidden-editar-op-id').value = id_op;
    document.getElementById('editar-op-id').textContent  = id_op;
    document.getElementById('editar-op-hora').value      = op.hora_salida || '';

    // Usar todos_capitanes / todos_guias (incluye los que están en uso)
    let todosCapitanes = window.catalogosData?.todos_capitanes || window.catalogosData?.capitanes || [];
    let selCap = document.getElementById('editar-op-capitan');
    selCap.innerHTML = '<option value="">Sin capitán</option>' +
        todosCapitanes.map(c => `<option value="${c.id}" ${c.nombre === op.capitan ? 'selected' : ''}>${c.nombre}</option>`).join('');

    let todosGuias = window.catalogosData?.todos_guias || window.catalogosData?.guias || [];
    let selGuia = document.getElementById('editar-op-guia');
    selGuia.innerHTML = '<option value="">Sin guía</option>' +
        todosGuias.map(g => `<option value="${g.id}" ${g.nombre === op.guia ? 'selected' : ''}>${g.nombre}</option>`).join('');

    abrirModal('modal-editar-op');
}

function confirmarEditarOp() {
    let id_op   = document.getElementById('hidden-editar-op-id').value;
    let selCap  = document.getElementById('editar-op-capitan');
    let selGuia = document.getElementById('editar-op-guia');
    let hora    = document.getElementById('editar-op-hora').value.trim();

    let id_capitan = selCap.value;
    let id_guia    = selGuia.value;
    let nombreCap  = selCap.options[selCap.selectedIndex]?.text || '';
    let nombreGuia = selGuia.options[selGuia.selectedIndex]?.text || '';

    // Optimistic: actualizar local
    let opIdx = window.operacionesData.findIndex(o => o.id === id_op);
    if(opIdx !== -1) {
        if(id_capitan) window.operacionesData[opIdx].capitan    = nombreCap;
        if(id_guia)    window.operacionesData[opIdx].guia       = nombreGuia;
        if(hora)       window.operacionesData[opIdx].hora_salida = hora;
        renderOperaciones(window.operacionesData);
    }
    cerrarSubModal('modal-editar-op');

    fetchPostBg('editar_operacion', {
        id_operacion: id_op,
        id_capitan, id_guia, hora_salida: hora,
        creador: myOpName
    }).then(res => {
        if(res.status === 'error') alert(res.message);
        else clearTimeout(window._syncTimer), window._syncTimer = setTimeout(fetchDashboardDataBg, 3000);
    });
}

// ==========================
// FOTO DE ZARPE
// ==========================
function verFotoZarpe(url) {
    let existing = document.getElementById('lightbox-zarpe');
    if (existing) existing.remove();
    let div = document.createElement('div');
    div.id = 'lightbox-zarpe';
    div.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;animation:fadeIn .2s ease;';
    div.innerHTML = `
        <div class="relative max-w-sm w-full mx-4">
            <img src="${url}" class="w-full rounded-2xl shadow-2xl object-contain max-h-[80vh]" onerror="this.src='';this.parentElement.innerHTML='<p class=\\'text-white text-center p-8\\'>No se pudo cargar la foto.</p>'">
            <button onclick="document.getElementById('lightbox-zarpe').remove()"
                class="absolute -top-3 -right-3 w-9 h-9 bg-white rounded-full shadow-xl text-gray-700 font-black text-sm flex items-center justify-center hover:bg-red-50 active:scale-90 transition">
                <i class="fas fa-times"></i>
            </button>
        </div>`;
    document.body.appendChild(div);
    div.addEventListener('click', e => { if (e.target === div) div.remove(); });
}

function abrirModalZarpeFoto(id_op, esReemplazo) {
    let op = window.operacionesData.find(o => o.id === id_op);
    document.getElementById('hidden-zarpe-op-id').value     = id_op;
    document.getElementById('hidden-zarpe-hora').value      = op ? (op.hora_salida || '') : '';
    document.getElementById('zarpe-foto-op-id').textContent = id_op + (op ? ' · ' + op.bote : '');
    document.getElementById('zarpe-foto-nombre').classList.add('hidden');
    document.getElementById('zarpe-foto-camara').value  = '';
    document.getElementById('zarpe-foto-galeria').value = '';

    if (esReemplazo && op && op.foto_zarpe) {
        document.getElementById('zarpe-foto-preview').innerHTML =
            `<div class="space-y-1">
                <p class="text-[10px] text-amber-600 font-bold"><i class="fas fa-exclamation-triangle mr-1"></i>Esta foto será reemplazada:</p>
                <img src="${op.foto_zarpe}" class="w-full max-h-28 object-cover rounded-xl opacity-60">
             </div>`;
    } else {
        document.getElementById('zarpe-foto-preview').innerHTML = '<span class="text-sm text-gray-400 font-bold">Sin foto seleccionada</span>';
    }
    abrirModal('modal-zarpe-foto');
}

// Usado por zarpe (prefijo='zarpe') y comprobante (prefijo='comprobante')
function previsualizarFotoZarpe(input, prefijo) {
    let file = input.files[0];
    if(!file) return;
    let previewId = prefijo === 'zarpe' ? 'zarpe-foto-preview' : 'comprobante-foto-preview';
    let nombreId  = prefijo === 'zarpe' ? 'zarpe-foto-nombre'  : 'comprobante-foto-nombre';
    let reader = new FileReader();
    reader.onload = e => {
        document.getElementById(previewId).innerHTML =
            `<img src="${e.target.result}" class="w-full max-h-40 object-cover rounded-xl">`;
        let label = document.getElementById(nombreId);
        if(label) { label.textContent = '✅ ' + file.name; label.classList.remove('hidden'); }
    };
    reader.readAsDataURL(file);
}

async function confirmarFotoZarpe() {
    let id_op = document.getElementById('hidden-zarpe-op-id').value;
    let inputCam = document.getElementById('zarpe-foto-camara');
    let inputGal = document.getElementById('zarpe-foto-galeria');
    let file = (inputCam && inputCam.files[0]) || (inputGal && inputGal.files[0]);

    cerrarSubModal('modal-zarpe-foto');
    if(!file) { mostrarToast('Sin foto seleccionada.', 'error'); return; }
    if(!window.SupaAPI || !window.SupaAPI.sb) { mostrarToast('Sin conexión al servidor.', 'error'); return; }
    if(window._zarpeSubiendo) return;   // anti doble-tap
    window._zarpeSubiendo = true;

    mostrarToast('📤 Subiendo foto…');
    try {
        // Comprimir (máx 2200px, JPEG 0.85 — legible para la IA) y SUBIR EL BLOB DIRECTO a Storage.
        // Antes iba como base64 por fetchPostBg → JSON de varios MB + cola en localStorage (síncrono)
        // → la 2a foto colgaba el sistema. La subida directa del blob no bloquea el hilo.
        const cmp  = await comprimirFotoZarpe(file);
        const blob = (cmp && cmp.blob) || file;
        const sb   = window.SupaAPI.sb;
        const path = 'zarpes/' + (id_op || 'OP') + '_' + Date.now() + '.jpg';
        const { error: upErr } = await sb.storage.from('operaciones').upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
        if (upErr) throw upErr;
        const url = sb.storage.from('operaciones').getPublicUrl(path).data.publicUrl;
        const { error: rpcErr } = await sb.rpc('set_foto_zarpe', { p_op: id_op, p_url: url });
        if (rpcErr) throw rpcErr;
        mostrarToast('✅ Foto de zarpe guardada.');
        let opLocal = window.operacionesData.find(o => o.id === id_op);
        if (opLocal) {
            opLocal.foto_zarpe = url;
            let cont = document.getElementById('operaciones-container');
            if (cont) cont._fp = null;   // invalidar fingerprint para re-render
            renderOperaciones(window.operacionesData);
        }
    } catch (e) {
        mostrarToast('⚠ No se pudo subir la foto. Intenta de nuevo.', 'error');
    } finally {
        window._zarpeSubiendo = false;
    }
}


function mostrarDetalleAdicionales(adicionales) {
    let lineas = (adicionales || '').split(',').map(p => {
        let sep = p.indexOf(':');
        if (sep === -1) return p.trim();
        let nombre = p.substring(0, sep).trim();
        let monto  = parseFloat(p.substring(sep + 1).trim()) || 0;
        return `${nombre}: S/ ${monto.toFixed(2)}`;
    }).filter(Boolean);

    let existing = document.getElementById('popover-adicionales');
    if (existing) existing.remove();

    let div = document.createElement('div');
    div.id = 'popover-adicionales';
    div.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;width:80%;max-width:280px;';
    div.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl border border-amber-200 overflow-hidden">
            <div class="bg-amber-50 px-4 py-3 flex justify-between items-center border-b border-amber-200">
                <span class="font-black text-amber-700 text-sm uppercase tracking-wider"><i class="fas fa-tag mr-2"></i>Adicionales</span>
                <button onclick="document.getElementById('popover-adicionales').remove()" class="w-7 h-7 bg-amber-100 hover:bg-amber-200 rounded-full text-amber-700 text-xs font-bold transition"><i class="fas fa-times"></i></button>
            </div>
            <div class="p-4 space-y-2">
                ${lineas.map(l => `<div class="flex justify-between text-xs font-bold text-gray-700 py-1 border-b border-gray-100 last:border-0"><span>${l.split(':')[0]}</span><span class="text-amber-600">${l.split(':').slice(1).join(':').trim()}</span></div>`).join('')}
                <div class="flex justify-between text-sm font-black text-gray-900 pt-2 border-t-2 border-amber-300 mt-1">
                    <span>Total adicionales</span>
                    <span class="text-amber-600">S/ ${(adicionales||'').split(',').reduce((sum, p) => { let sep = p.indexOf(':'); return sum + (sep !== -1 ? parseFloat(p.substring(sep+1).trim())||0 : 0); }, 0).toFixed(2)}</span>
                </div>
            </div>
        </div>`;
    document.body.appendChild(div);
    // Cerrar al tocar fuera
    setTimeout(() => document.addEventListener('click', function _close(e) {
        if (!div.contains(e.target)) { div.remove(); document.removeEventListener('click', _close); }
    }), 100);
}

function verDetallePase(idx) {
    let p = (window.pasesExternosData || [])[idx];
    if(!p) return;
    let contactos = window.contactosData || [];
    let nombre   = p.nombreOrigen || '—';
    let aliadoInfo = contactos.find(c => c.id === p.aliadoId || c.nombre === p.aliadoId);
    let destino  = aliadoInfo ? aliadoInfo.nombre : (p.aliadoId || '—');
    let pax      = p.pax || '—';
    let monto    = p.monto ? 'S/ ' + parseFloat(p.monto).toFixed(2) : '—';
    let ts       = p.timestamp ? new Date(p.timestamp).toLocaleString('es-PE') : '—';

    // Mini modal de detalle inline (reutilizamos el overlay del backdrop existente)
    let existing = document.getElementById('modal-detalle-pase');
    if(existing) existing.remove();

    let div = document.createElement('div');
    div.id = 'modal-detalle-pase';
    div.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;width:88%;max-width:320px;';
    div.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl border border-purple-200 overflow-hidden">
            <div class="bg-purple-100 px-4 py-3 flex justify-between items-center border-b border-purple-200">
                <span class="font-black text-purple-800 text-sm uppercase tracking-wider"><i class="fas fa-people-carry mr-2"></i>Detalle del Pase</span>
                <button onclick="document.getElementById('modal-detalle-pase').remove()" class="w-7 h-7 bg-purple-200 hover:bg-purple-300 rounded-full text-purple-700 text-xs font-bold transition"><i class="fas fa-times"></i></button>
            </div>
            <div class="p-4 space-y-2.5">
                <div class="flex justify-between items-center">
                    <span class="text-[10px] text-gray-500 font-bold uppercase">Contacto original</span>
                    <span class="text-xs font-black text-gray-800 uppercase">${nombre}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-[10px] text-gray-500 font-bold uppercase">Aliado destino</span>
                    <span class="text-xs font-black text-purple-700">${destino}</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-[10px] text-gray-500 font-bold uppercase">PAX pasados</span>
                    <span class="text-sm font-black text-blue-600">${pax} PAX</span>
                </div>
                <div class="flex justify-between items-center">
                    <span class="text-[10px] text-gray-500 font-bold uppercase">Monto</span>
                    <span class="text-xs font-black text-gray-700">${monto}</span>
                </div>
                <div class="flex justify-between items-center pt-1 border-t border-gray-100">
                    <span class="text-[10px] text-gray-500 font-bold uppercase">Hora</span>
                    <span class="text-[10px] text-gray-500">${ts}</span>
                </div>
            </div>
        </div>`;
    document.body.appendChild(div);

    // Cerrar al tocar fuera
    setTimeout(() => {
        let handler = (e) => { if(!div.querySelector('.bg-white').contains(e.target)) { div.remove(); document.removeEventListener('click', handler); } };
        document.addEventListener('click', handler);
    }, 100);
}

function mostrarToast(msg, tipo = 'info') {
    let banner = document.getElementById('header-toast');
    if (!banner) return; // fallback: header aún no montado

    let bg    = tipo === 'error'   ? 'rgba(254,226,226,0.97)' : tipo === 'success' ? 'rgba(220,252,231,0.97)' : 'rgba(219,234,254,0.97)';
    let color = tipo === 'error'   ? '#991b1b' : tipo === 'success' ? '#15803d' : '#1e40af';
    let bord  = tipo === 'error'   ? '#fca5a5' : tipo === 'success' ? '#86efac' : '#93c5fd';
    let icon  = tipo === 'error'   ? '✕ ' : tipo === 'success' ? '✓ ' : '';

    banner.style.background   = bg;
    banner.style.color        = color;
    banner.style.borderBottom = `2px solid ${bord}`;
    banner.style.padding      = '7px 16px';
    banner.style.fontSize     = '11px';
    banner.style.fontWeight   = '700';
    banner.style.textAlign    = 'center';
    banner.style.letterSpacing = '0.01em';
    banner.textContent = icon + msg;

    // Slide-down
    banner.style.maxHeight = '0';
    banner.style.opacity   = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        banner.style.maxHeight = '48px';
        banner.style.opacity   = '1';
    }));

    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => {
        banner.style.maxHeight = '0';
        banner.style.opacity   = '0';
    }, tipo === 'error' ? 5000 : 3000);
}

function toggleSpinner(show) {
    const s   = document.getElementById('global-spinner');
    const u   = document.getElementById('btn-refresh');
    const dot = document.getElementById('sync-dot');
    if (show) {
        s.classList.remove('hidden');
        u.classList.add('hidden');
    } else {
        s.classList.add('hidden');
        u.classList.remove('hidden');
    }
    if (dot) {
        dot.style.background = show ? '#fbbf24' : '';
        dot.className = show
            ? 'w-2 h-2 rounded-full bg-amber-300'
            : 'w-2 h-2 rounded-full bg-emerald-300 animate-pulse';
    }
}
