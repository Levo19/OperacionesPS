const GAS_URL = 'https://script.google.com/macros/s/AKfycbxkdyhxdZnySKaVN1MfMU-4VzJvGWC-hLiSYSQdph5G5MYHOLfHO62Cdl-SuFoCnvOqyA/exec';

let myOpName = localStorage.getItem('sot_operador') || null;

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
        window.operacionesData   = c.operaciones || [];
        window.contactosData     = c.contactos   || [];
        window.catalogosData     = c.catalogos   || {};
        window.reservasData      = c.reservas    || [];
        // Solo cargar pases de HOY desde el cache — descartar los de días anteriores
        window.pasesExternosData = (c.pases || []).filter(p => esFechaHoy(p.timestamp));
        window.cajaData          = c.caja        || [];
        if (window.catalogosData) renderCatalogos(window.catalogosData);
        renderOperaciones(window.operacionesData);
        renderReservas(window.reservasData);
        renderCaja(window.cajaData);
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

    // Cargar caché local inmediatamente para mostrar datos sin esperar la red
    _loadDashboardCache();

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
    setInterval(fetchDashboardDataBg, 30000);
    programarResetDiario();
    iniciarCountdownTimer();
    // Procesar cola offline si hay items pendientes del turno anterior
    if (navigator.onLine) setTimeout(_processOfflineQueue, 5000);
    // Detector de nueva versión: chequea cada 5 minutos
    setTimeout(checkForUpdates, 60000); // primera vez al minuto (GH Pages puede tardar en propagar)
    setInterval(checkForUpdates, 5 * 60 * 1000);
});

// ── Detector de actualizaciones ───────────────────────────────────────────────
let _pageEtag = null;

function checkForUpdates() {
    // Solo en producción (GitHub Pages), no en localhost/Live Server
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
    fetch(location.href, { method: 'HEAD', cache: 'no-store' })
        .then(r => {
            let fingerprint = r.headers.get('ETag') || r.headers.get('Last-Modified');
            if (!fingerprint) return;
            if (!_pageEtag) {
                _pageEtag = fingerprint; // guardar valor inicial
            } else if (_pageEtag !== fingerprint) {
                // Nueva versión detectada — bloquear UI y forzar recarga
                let overlay = document.getElementById('modal-update');
                if (overlay) overlay.classList.remove('hidden');
            }
        })
        .catch(() => {}); // silenciar si no hay red
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

function fetchDashboardData() {
    toggleSpinner(true);
    // Safety net: si en 15s todavía no terminó, forzar limpieza de UI
    let safetyTimer = setTimeout(() => {
        toggleSpinner(false);
        _forceRenderEmpty();
        console.warn('[SOT] fetchDashboardData timeout — forzando limpieza de UI');
    }, 35000);

    let ctrl = new AbortController();
    let abortTimer = setTimeout(() => ctrl.abort(), 30000);

    fetch(GAS_URL + "?action=getDashboardData", { signal: ctrl.signal })
        .then(res => {
            clearTimeout(abortTimer);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        })
        .then(data => {
            clearTimeout(safetyTimer);
            toggleSpinner(false);
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
            try { renderOperaciones(window.operacionesData); } catch(e) { console.error('renderOperaciones:', e); }
            try { renderReservas(window.reservasData); } catch(e) { console.error('renderReservas:', e); }
            try { renderCaja(window.cajaData); } catch(e) { console.error('renderCaja:', e); }
            try { actualizarModalSiAbierto(); } catch(e) { console.error('actualizarModal:', e); }
            // Si el login estaba esperando operadores, ahora ya los tiene
            try { _loginEstado('listo'); } catch(e) {}
            _saveDashboardCache();
        })
        .catch(err => {
            clearTimeout(safetyTimer);
            clearTimeout(abortTimer);
            toggleSpinner(false);
            console.warn('[SOT] fetchDashboardData error:', err.message);
            _forceRenderEmpty();
            // También intentar renderizar con datos de caché si existen
            try { renderOperaciones(window.operacionesData || []); } catch(e) {}
            try { renderReservas(window.reservasData || []); } catch(e) {}
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

    fetch(GAS_URL + "?action=getDashboardData")
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
        let paseNombreEsc = origen.replace(/'/g,"\\'");

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
            return `
            <tr class="border-t border-gray-100 hover:bg-orange-50 transition">
                <td class="py-2 px-2">
                    <span class="text-[9px] font-bold text-orange-400 uppercase tracking-wide block">Compra:</span>
                    <span class="text-[11px] font-black text-orange-800 block uppercase leading-tight">${agNombre}</span>
                    ${origen ? `<span class="text-[9px] text-gray-400 font-bold"><i class="fas fa-arrow-right text-[7px] mr-0.5"></i>De: ${origen}</span>` : ''}
                    ${estadoChip}
                    ${pagarBtn}
                </td>
                <td class="py-2 px-2 text-center text-sm font-black text-blue-600">${p.pax}</td>
                <td class="py-2 px-2 text-[9px] text-gray-400 text-right">${ts}</td>
                <td class="py-1.5 px-1.5"></td>
            </tr>`;
        }

        // ── Pase normal a aliado ──────────────────────────────────────────
        // Cobrar button: only if origin is NOT an aliado (i.e., Libre / Agencia / Comisionado)
        let origenTipo = p.origenTipo || '';
        let origenId   = p.origenId   || '';
        let paseEsCobrable = !_TIPOS_SIN_COBRO.includes(origenTipo) && !!(origenId);
        let pagoStPase = paseEsCobrable ? _calcPagoEstado({ id: paseId, tipo: origenTipo, monto: p.monto || 0 }) : null;
        let cobrarPaseBtn = '';
        if (paseEsCobrable && pagoStPase && pagoStPase.estado !== 'pagado_completo') {
            let montoNum = parseFloat(p.monto) || 0;
            let pendNum  = pagoStPase.pendiente;
            let etiqueta = pagoStPase.estado === 'pagado_parcial'
                ? `Pend. S/${pendNum.toFixed(2)}`
                : `S/${montoNum.toFixed(2)}`;
            let nombreEsc = origen.replace(/'/g,"\\'");
            cobrarPaseBtn = `<button class="cobrar-btn-appear mt-1 w-full bg-green-500 text-white text-[9px] font-bold py-1 rounded-lg flex items-center justify-center gap-1 hover:bg-green-600 active:scale-95 transition"
                onclick="abrirModalCaja('cobro_directo', { id_contacto: '${origenId}', nombre_contacto: '${nombreEsc}', monto: ${montoNum}, id_mov: '${paseId}', pendiente: ${pendNum.toFixed(2)}, bloqueado: true }); event.stopPropagation();">
                <span class='w-1 h-1 rounded-full bg-white animate-pulse'></span>
                <i class='fas fa-money-bill-wave text-[8px]'></i> Cobrar ${etiqueta}
            </button>`;
        }
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

    // Container-level fingerprint — incluye contenido de pases para detectar cambios de aliado/nombre
    let fp = opHoy.map(o => _generarCardFP(o)).join(';')
           + '|p:' + (window.pasesExternosData || []).map(p => `${p.id}|${p.aliadoId}|${p.pax}`).join(',');
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

    // Actualizar sección de pases — solo los de HOY (los _syncing son recién enviados, siempre incluirlos)
    let pasesDiaHTML = _generarPasesDiaHTML(
        (window.pasesExternosData || []).filter(p => esFechaHoy(p.timestamp))
    );
    if (pasesDiaHTML) {
        let tmp = document.createElement('div');
        tmp.innerHTML = pasesDiaHTML.trim();
        container.appendChild(tmp.firstElementChild);
    }
}

// ── Helpers DOM-diffing reservas ─────────────────────────────────────────────
function _resCardFP(res, hoy, formatLocal) {
    let f = String(res.fecha || '').trim();
    let isHoy = f === hoy || f === formatLocal || !res.fecha;
    return `${res.id}|${res._asignando?1:0}|${res.pax}|${res.cliente}|${res.hora||''}|${isHoy?1:0}`;
}

function _resCardHTML(res, hoy, formatLocal) {
    let fp         = _resCardFP(res, hoy, formatLocal);
    let isSyncing  = res.id === 'Creando...';
    let isAsignando = !!res._asignando;
    let f          = String(res.fecha || '').trim();
    let isHoy      = f === hoy || f === formatLocal || !res.fecha;
    let isFuture   = !isHoy && !isSyncing && !isAsignando;

    let cardClasses = isAsignando
        ? 'bg-green-50 border-green-400 border-l-[4px] opacity-80 animate-pulse border-y border-r'
        : isSyncing
            ? 'bg-yellow-50 border-yellow-300 border-l-[4px] opacity-90 animate-pulse border-y border-r'
            : isFuture
                ? 'opacity-60 grayscale bg-gray-50 border-gray-200 border'
                : 'bg-white border-blue-500 border-l-[4px] border-y border-r border-y-gray-100 border-r-gray-100';
    let btnClasses = (isSyncing || isAsignando)
        ? 'pointer-events-none bg-green-400 text-white font-bold'
        : isFuture
            ? 'pointer-events-none opacity-50 bg-gray-300 border-gray-300 text-gray-500'
            : 'bg-green-500 text-white shadow-md shadow-green-500/20 hover:bg-green-600 border-green-600';
    let btnIcon = isAsignando ? 'fa-ship fa-pulse' : isSyncing ? 'fa-sync-alt fa-spin' : isFuture ? 'fa-lock' : 'fa-clipboard-check';
    let btnText = isAsignando ? '¡Abordando!' : isSyncing ? 'Registrando...' : isFuture ? 'No disponible hoy' : 'Abordar Lancha';
    let tagFecha = isHoy
        ? `<span class="bg-green-100 text-green-800 text-[9px] px-2 py-0.5 rounded font-bold mr-1 border border-green-200">HOY</span>`
        : `<span class="bg-yellow-100 text-yellow-800 text-[9px] px-2 py-0.5 rounded font-bold mr-1 border border-yellow-200">${res.fecha}</span>`;
    let clienteEsc = (res.cliente || '').replace(/'/g, "\\'");
    let contactoEsc = (res.contacto || '').replace(/'/g, "\\'");

    return `<div class="${cardClasses} rounded-2xl shadow-sm p-4 block mb-3 transition-all relative overflow-hidden" data-res-id="${res.id}" data-res-fp="${fp}">
        ${isSyncing ? '<div class="absolute top-2 right-3 text-[10px] items-center text-yellow-600 font-bold"><i class="fas fa-satellite-dish mr-1 animate-ping"></i> Nube</div>' : ''}
        <div class="flex justify-between items-start relative z-10">
            <div>
                <h3 class="font-extrabold text-gray-800 text-lg">${res.cliente}</h3>
                <p class="text-[10px] text-gray-500 mt-1 uppercase font-bold tracking-wider flex items-center">${tagFecha} <i class="fas fa-building text-xs mx-1 text-gray-400"></i> ${(res.contacto||'').replace('_',' ')}</p>
            </div>
            <div class="text-right">
                <span class="font-black text-2xl text-blue-600">${res.pax} <span class="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">PAX</span></span>
                <p class="text-[10px] text-gray-400 mt-0 font-bold uppercase tracking-widest">${res.hora || 'Libre'}</p>
            </div>
        </div>
        <div class="flex mt-4 space-x-2 relative z-10">
            <button class="flex-[2] py-2.5 rounded-xl text-sm font-bold transition active:scale-95 border ${btnClasses}" onclick="prepararAsignacion('${res.id}', '${clienteEsc}', '${res.pax}', '${contactoEsc}')"><i class="fas ${btnIcon} mr-1"></i> ${btnText}</button>
            ${!isSyncing && !isAsignando ? `<button class="px-3 py-2.5 rounded-xl text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200 hover:bg-purple-200 transition active:scale-95" onclick="abrirPaseDesdeReserva('${res.id}', '${clienteEsc}', '${res.pax}', '${contactoEsc}')"><i class="fas fa-share-square mr-1"></i>Pasar</button>` : ''}
        </div>
    </div>`;
}
// ─────────────────────────────────────────────────────────────────────────────

function renderReservas(reservas) {
    const container = document.getElementById('reservas-container');
    let hoy = getHoyLocal();
    let hoyPartes = hoy.split('-');
    let formatLocal = `${hoyPartes[2]}/${hoyPartes[1]}/${hoyPartes[0]}`;

    let resAMostrar = reservas.filter(r => {
        let isSyncing = r.id === 'Creando...';
        let f = String(r.fecha || '').trim();
        let isHoy = f === hoy || f === formatLocal || !r.fecha;
        let isMine = String(r.creado_por || '').trim().toLowerCase() === String(myOpName || '').trim().toLowerCase();
        return isHoy || isMine || isSyncing;
    });

    // Container FP
    let fp = resAMostrar.map(r => _resCardFP(r, hoy, formatLocal)).join(';');
    if (container._fp === fp) return;
    container._fp = fp;

    if (!resAMostrar || resAMostrar.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-gray-500"><i class="fas fa-clipboard-list text-4xl mb-3 opacity-20 block"></i> No hay pasajeros pendientes hoy.</div>`;
        return;
    }

    // Eliminar cualquier elemento que no sea una card (spinner inicial, mensajes vacíos, etc.)
    container.querySelectorAll(':scope > :not([data-res-id])').forEach(el => el.remove());

    // Recopilar cards existentes
    let existing = new Map();
    container.querySelectorAll('[data-res-id]').forEach(el => existing.set(el.dataset.resId, el));

    // Eliminar cards que ya no están
    let newIds = new Set(resAMostrar.map(r => r.id));
    existing.forEach((el, id) => { if (!newIds.has(id)) el.remove(); });

    // Actualizar o crear cada card
    resAMostrar.forEach(res => {
        let cardFp  = _resCardFP(res, hoy, formatLocal);
        let existEl = existing.get(res.id);
        if (existEl) {
            if (existEl.dataset.resFp !== cardFp) {
                let tmp = document.createElement('div');
                tmp.innerHTML = _resCardHTML(res, hoy, formatLocal).trim();
                let newEl = tmp.firstElementChild;
                existEl.replaceWith(newEl);
                existing.set(res.id, newEl);
            }
        } else {
            let tmp = document.createElement('div');
            tmp.innerHTML = _resCardHTML(res, hoy, formatLocal).trim();
            let newEl = tmp.firstElementChild;
            newEl.classList.add('card-enter');
            existing.set(res.id, newEl);
        }
    });

    // Re-ordenar sin recrear nodos
    resAMostrar.forEach(res => container.appendChild(existing.get(res.id)));
}

function renderFinanzas() { renderCaja(window.cajaData); }

function renderCaja(caja) {
    let txHoy = (caja || []).filter(c => esFechaHoy(c.timestamp));
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

        let syncDot = c._syncing ? `<span class="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse ml-1 align-middle"></span>` : '';
        let rowBg   = c._syncing ? 'bg-blue-50' : '';
        return `
        <div class="flex justify-between items-center p-3.5 ${rowBg} cursor-pointer hover:bg-gray-50 transition active:scale-95" data-caja-id="${c.id}" onclick="${c._syncing ? '' : `abrirDetalleCaja('${c.id}')`}">
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
            // Buscar precio base del contacto en el catálogo
            let info       = (window.contactosData || []).find(c =>
                c.id === m.contacto || c.nombre === (m.nombreContacto || m.contacto));
            let precioBase = info ? (parseFloat(info.precio) || 0) : 0;
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

    fetchPostBg('abrir_operacion', { id_bote, id_capitan, id_guia, hora_salida, destino, creador: myOpName }).then(() => setTimeout(fetchDashboardDataBg, 5000));
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
    // En modo solo-lectura las cards no son seleccionables (no hay botones de edición)
    let isSelected = !isSyncing && !soloLectura && window.editandoMovId === m.id;
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

    // ── Sub-botones secundarios (solo al seleccionar) ──
    let esPaseOut = m.tipo === 'Aliado(PaseOut)';
    let subBtns = (isSelected && !isSyncing) ? `
    <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-orange-200">
        ${!soloLectura && m.tipo === 'Agencia' ? `<button class="bg-blue-100 text-blue-700 text-[11px] font-bold px-3 py-2 rounded-xl border border-blue-200 hover:bg-blue-200 transition" onclick="abrirModalImpuestos('${m.id}', '${m.contacto}'); event.stopPropagation();"><i class="fas fa-file-invoice-dollar mr-1"></i> Adicionales</button>` : ''}
        ${!soloLectura && !esPaseOut ? `<button class="flex-1 min-w-[60px] bg-purple-500 text-white text-[11px] font-bold py-2 rounded-xl shadow-md shadow-purple-500/30 hover:bg-purple-600 transition" onclick="abrirModalDerivar('${m.id}', '${m.pax}'); event.stopPropagation();"><i class="fas fa-people-carry mr-1"></i> Pasar</button>` : ''}
        ${!soloLectura ? `<button class="bg-red-100 text-red-600 text-[11px] font-bold px-3 py-2 rounded-xl border border-red-200 hover:bg-red-200 transition" onclick="eliminarMovimiento('${m.id}', '${m.pax}'); event.stopPropagation();"><i class="fas fa-trash-alt"></i></button>` : ''}
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

    let clickable = !isSyncing && !soloLectura;
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
function getContactoSeleccionado(selectId) {
    let sel = document.getElementById(selectId);
    if(!sel) return { id: '', nombre: '' };
    let opt = sel.options[sel.selectedIndex];
    return { id: opt?.dataset?.id || sel.value, nombre: sel.value };
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
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Apellido / Nombre</label>
            <input type="text" id="input-vd-contacto-text" class="${_textInputClass()}" placeholder="Ej: Familia Vasquez">`;

    } else if(tipo === 'Agencia') {
        precioLabel.textContent = 'S/ Total (precio especial)';
        let filtered = (window.contactosData||[]).filter(c => normTipo(c.tipo).includes('agencia'));
        let opts = filtered.map(c => `<option value="${c.nombre}" data-id="${c.id}">${c.nombre} (S/${c.precio}/pax)</option>`).join('');
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Agencia</label>
            <select id="input-vd-contacto-select" class="${_selectInputClass()}" onchange="actualizarPrecioDefecto()">
                <option value="">Seleccionar...</option>${opts}</select>`;

    } else if(tipo === 'Aliado') {
        precioLabel.textContent = 'Pase (sin cobro)';
        let filtered = (window.contactosData||[]).filter(c => normTipo(c.tipo).includes('aliado'));
        let opts = filtered.map(c => `<option value="${c.nombre}" data-id="${c.id}">${c.nombre}</option>`).join('');
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Aliado</label>
            <select id="input-vd-contacto-select" class="${_selectInputClass()}">
                <option value="">Seleccionar...</option>${opts}</select>`;
        // Aliado = pase, no hay cobro de dinero
        precioInput.value = '0';
        precioInput.readOnly = true;
        precioInput.setAttribute('readonly', 'readonly');
        precioInput.classList.add('bg-gray-100', 'opacity-60');

    } else if(tipo === 'Comisionado') {
        precioLabel.textContent = 'S/ Precio cobrado al PAX';
        let filtered = (window.contactosData||[]).filter(c => normTipo(c.tipo).includes('comision'));
        let opts = filtered.map(c => `<option value="${c.nombre}" data-id="${c.id}" data-comision="${c.precio}">${c.nombre}</option>`).join('');
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Comisionado</label>
            <select id="input-vd-contacto-select" class="${_selectInputClass()}" onchange="actualizarPrecioDefecto()">
                <option value="">Seleccionar...</option>${opts}</select>`;
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
        let sel = document.getElementById('input-vd-contacto-select');
        if(sel && sel.value && !usuarioEditandoPrecio) {
            let info = (window.contactosData||[]).find(c => c.nombre === sel.value);
            if(info) precioInput.value = (info.precio * pax).toFixed(2);
        }

    } else if(tipo === 'Aliado') {
        precioInput.value = '0';

    } else if(tipo === 'Comisionado') {
        let sel = document.getElementById('input-vd-contacto-select');
        let comisionBox = document.getElementById('box-comision-info');
        if(sel && sel.value && pax > 0) {
            let info = (window.contactosData||[]).find(c => c.nombre === sel.value);
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
        let contactoInput = document.getElementById('input-vd-contacto-text') || document.getElementById('input-vd-contacto-select');
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
        let s = document.getElementById('input-vd-contacto-select');
        // Las opciones del select usan value="${c.nombre}", no el ID
        if(s) s.value = movToEdit.nombreContacto || movToEdit.contacto;
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

    if(!contacto) { mostrarToast('❌ Ingresa el nombre o selecciona el contacto.', 'error'); return; }
    if(!pax || parseFloat(pax) <= 0) { mostrarToast('❌ Cantidad de pasajeros inválida.', 'error'); return; }
    if(tipo !== 'Aliado' && (!precio || parseFloat(precio) < 0)) { mostrarToast('❌ Ingresa el precio cobrado.', 'error'); return; }

    // Para Aliado forzar precio 0
    if(tipo === 'Aliado') precio = '0';

    // Calcular comisión para Comisionado (se guarda en adicionales)
    let adicionales = '';
    if(tipo === 'Comisionado') {
        let info = (window.contactosData||[]).find(c => c.nombre === contacto);
        if(info) {
            let paxNum2    = parseFloat(pax) || 0;
            let precioNum2 = parseFloat(precio) || 0;
            let comision   = Math.max(0, precioNum2 - (info.precio * paxNum2)).toFixed(2);
            adicionales    = `Comision:S/${comision}`;
        }
    }

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
        let filtered = (window.contactosData||[]).filter(c => normTipo(c.tipo).includes('agencia'));
        let opts = filtered.map(c => `<option value="${c.nombre}" data-id="${c.id}">${c.nombre} (S/${c.precio}/pax)</option>`).join('');
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Agencia</label>
            <select id="input-crm-contacto-select" class="${_selectInputClass()}" onchange="actualizarPrecioDefectoCRM()">
                <option value="">Seleccionar...</option>${opts}</select>`;

    } else if(tipo === 'Aliado') {
        let filtered = (window.contactosData||[]).filter(c => normTipo(c.tipo).includes('aliado'));
        let opts = filtered.map(c => `<option value="${c.nombre}" data-id="${c.id}">${c.nombre}</option>`).join('');
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Aliado</label>
            <select id="input-crm-contacto-select" class="${_selectInputClass()}">
                <option value="">Seleccionar...</option>${opts}</select>`;
        precioInput.value = '0';
        precioInput.readOnly = true;
        precioInput.setAttribute('readonly', 'readonly');
        precioInput.classList.add('bg-gray-100', 'opacity-50', 'cursor-not-allowed');

    } else if(tipo === 'Comisionado') {
        let filtered = (window.contactosData||[]).filter(c => normTipo(c.tipo).includes('comision'));
        let opts = filtered.map(c => `<option value="${c.nombre}" data-id="${c.id}">${c.nombre}</option>`).join('');
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Comisionado</label>
            <select id="input-crm-contacto-select" class="${_selectInputClass()}" onchange="actualizarPrecioDefectoCRM()">
                <option value="">Seleccionar...</option>${opts}</select>`;
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
        let sel = document.getElementById('input-crm-contacto-select');
        if(sel && sel.value) {
            let info = (window.contactosData||[]).find(c => c.nombre === sel.value);
            if(info) precioInput.value = (info.precio * pax).toFixed(2);
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
        let sel = document.getElementById('input-crm-contacto-select');
        nombreCliente = sel?.value || '';
        let opt = sel?.options[sel.selectedIndex];
        id_contacto   = opt?.dataset?.id || nombreCliente;
    }

    if(!fecha || !nombreCliente || !pax || !precio) { mostrarToast('❌ Fecha, Cliente, PAX y Total son obligatorios.', 'error'); return; }

    let resTemp = {
        id: 'Creando...', fecha: fecha, hora: hora, cliente: nombreCliente,
        contacto: id_contacto, pax: pax, monto: parseFloat(precio).toFixed(2),
        creado_por: myOpName
    };
    window.reservasData.unshift(resTemp);
    renderReservas(window.reservasData);
    cerrarModales();

    fetchPostBg('nueva_reserva', {
        fecha: fecha, hora: hora, tipo: tipo,
        id_contacto: id_contacto, cliente: nombreCliente, cant_pax: pax, monto: parseFloat(precio).toFixed(2),
        creador: myOpName
    }).then(() => {
        document.getElementById('input-crm-pax').value = ''; document.getElementById('input-crm-precio').value = '';
        setTimeout(fetchDashboardDataBg, 5000);
    });
}

function prepararAsignacion(id_reserva, cliente, pax, contacto) { 
    document.getElementById('hidden-reserva-id').value = id_reserva; 
    document.getElementById('hidden-reserva-pax').value = pax; 
    document.getElementById('hidden-reserva-agencia').value = contacto; 
    document.getElementById('text-pax').innerText = pax;
    document.getElementById('text-cliente').innerText = cliente;

    let selectOp = document.getElementById('select-asignar-op');
    let opsAbiertas = window.operacionesData.filter(op => op.estado === 'Abierta');
    
    if(opsAbiertas.length === 0) {
        selectOp.innerHTML = '<option value="">No hay lanchas abiertas disponibles</option>';
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
    let tipoMovimiento = tipoRaw.includes('aliado')   ? 'Aliado'
                       : tipoRaw.includes('comision') ? 'Comisionado'
                       : 'Agencia'; // default for Agencia or unknown

    // Optimistic: mark reserva card as "abordando"
    let resIdx = (window.reservasData||[]).findIndex(r => r.id === id_reserva);
    if(resIdx !== -1) window.reservasData[resIdx]._asignando = true;
    renderReservas(window.reservasData);

    // Optimistic: add temp item to manifest
    let opIdx = window.operacionesData.findIndex(o => o.id === id_operacion);
    if(opIdx !== -1) {
        let op = window.operacionesData[opIdx];
        op.manifiesto.unshift({
            id: 'temp-crm-' + Date.now(),
            tipo: tipoMovimiento,
            contacto: contacto,
            pax: pax,
            monto: monto.toFixed(2),
            estado: 'Embarcado', _syncing: true
        });
        op.ocupados += paxNum;
        renderOperaciones(window.operacionesData);
    }

    cerrarModales();

    fetchPost('asignar_reserva', {
        id_reserva,
        id_operacion,
        cant_pax: pax,
        id_contacto: contactInfo ? contactInfo.id : contacto,
        nombre_contacto: contactInfo ? contactInfo.nombre : contacto,
        tipo: tipoMovimiento,
        monto_total: monto,
        precio_unitario: paxNum > 0 ? (monto / paxNum).toFixed(2) : '0',
        creador: myOpName
    }).then(res => {
        if(res.status === 'error') alert(res.message);
        fetchDashboardData();
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
        desc.textContent = 'Pagos a comisionados u otros egresos.';
        btnOk.className  = btnOk.className.replace(/bg-\w+-\d+/g,'') + ' bg-red-500 hover:bg-red-600';
        catSel.innerHTML = `
            <option value="Pagos">🤝 Pagos (Comisionados)</option>
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

    // Mostrar selector de contacto en Cobro o Pagos
    if (cat === 'Cobro' || cat === 'Pagos') {
        contactoRow.classList.remove('hidden');
        sel.innerHTML = '<option value="">— Seleccionar —</option>';
        let contactos = window.contactosData || [];
        if (cat === 'Cobro') {
            // ── Recopilar contactos cobrables de HOY (activos + derivados, excluir PaseIn) ──
            let hoyMovs = []; // { contactoId, nombreContacto }
            (window.operacionesData || []).forEach(op => {
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
                    (window.operacionesData || []).forEach(op => {
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

    // FIFO: pre-llenar monto con total pendiente del contacto (para Cobro regular en Caja tab)
    window._pendingMovsForCobro = null;
    let modo = document.getElementById('caja-modo').value;
    let cat  = document.getElementById('caja-categoria').value;
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
                comentarios: comentario, foto_base64: foto_base64 || '', operador: myOpName
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
            operador:      myOpName
        }).then(res => {
            // Reemplazar temp con ID real si volvió, luego sync completo
            let idx = (window.cajaData || []).findIndex(c => c.id === tempId);
            if (idx !== -1) {
                if (res && res.id_transaccion) {
                    window.cajaData[idx] = { ...window.cajaData[idx], id: res.id_transaccion, _syncing: true };
                } else {
                    window.cajaData.splice(idx, 1);
                }
            }
            renderCaja(window.cajaData);
            if (idMovimiento) actualizarModalSiAbierto();
            setTimeout(fetchDashboardDataBg, 5000);
        }).catch(() => {
            let idx = (window.cajaData || []).findIndex(c => c.id === tempId);
            if (idx !== -1) window.cajaData.splice(idx, 1);
            renderCaja(window.cajaData);
            if (idMovimiento) actualizarModalSiAbierto();
            mostrarToast('Error al registrar transacción.', 'error');
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
    for (let op of (window.operacionesData || [])) {
        let mov = (op.manifiesto || []).find(m => m.id === id_mov);
        if (mov && mov.adicionales) {
            (mov.adicionales + '').split(',').forEach(part => {
                let sep = part.indexOf(':');
                if (sep === -1) return;
                let nombre = part.substring(0, sep).trim();
                let monto  = parseFloat(part.substring(sep + 1).trim()) || 0;
                if (nombre) existingAdics[nombre] = monto;
            });
            break;
        }
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
    for (let op of (window.operacionesData || [])) {
        let mov = (op.manifiesto || []).find(m => m.id === id_mov);
        if (mov) { mov.adicionales = adicionales; break; }
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
function iniciarAnularPase(id_mov, pax, nombreContacto) {
    document.getElementById('hidden-anular-idmov').value = id_mov;
    document.getElementById('anular-pase-info').textContent = `${pax} PAX · ${nombreContacto}`;

    // Poblar select con operaciones activas
    let sel = document.getElementById('select-anular-op');
    let hoy = getHoyLocal();
    let ops = (window.operacionesData || []).filter(op => op.estado === 'Abierta' && (op.fecha === hoy || !op.fecha));
    if(ops.length === 0) {
        sel.innerHTML = '<option value="">No hay lanchas abiertas hoy</option>';
    } else {
        sel.innerHTML = '<option value="">- Selecciona lancha -</option>' +
            ops.map(op => `<option value="${op.id}">${op.bote} · ${op.id} (${op.ocupados}/${op.capacidad} pax)</option>`).join('');
    }
    abrirModal('modal-anular-pase');
}

function confirmarAnularPase() {
    let id_mov = document.getElementById('hidden-anular-idmov').value;
    let id_op  = document.getElementById('select-anular-op').value;
    if(!id_op) return alert('Selecciona una operación activa para reasignar el movimiento.');

    cerrarSubModal('modal-anular-pase');

    // Optimistic: quitar de pasesExternosData y reasignar en la op
    let idx = (window.pasesExternosData || []).findIndex(p => p.id === id_mov);
    if(idx !== -1) {
        let pase = window.pasesExternosData.splice(idx, 1)[0];
        let op = window.operacionesData.find(o => o.id === id_op);
        if(op) {
            let paxNum = parseInt(pase.pax) || 0;
            // Recuperar tipo real del contacto original (no dejar 'Libre')
            let origenId = pase.origenId || '';
            let contactoInfo = (window.contactosData || []).find(c => c.id === origenId || c.nombre === origenId);
            let tipoMov = contactoInfo ? (contactoInfo.tipo || 'Directo') : 'Directo';
            op.manifiesto.unshift({ id: id_mov, tipo: tipoMov, contacto: pase.origenId || pase.nombreOrigen, nombreContacto: pase.nombreOrigen, pax: pase.pax, monto: pase.monto, estado: 'Embarcado' });
            op.ocupados += paxNum;
        }
        renderOperaciones(window.operacionesData);
    }

    fetchPostBg('anular_pase', { id_mov, id_operacion_nueva: id_op, operador: myOpName }).then(res => {
        if(res.status === 'error') { alert(res.message); return; }
        mostrarToast('✅ Pase anulado. Movimiento reasignado.', 'success');
        clearTimeout(window._syncTimer);
        window._syncTimer = setTimeout(syncManifestBg, 2000);
    });
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
        window.pasesExternosData[paseIdx].aliadoId            = '';
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
    let q;
    try { q = JSON.parse(localStorage.getItem(_OFFLINE_Q_KEY) || '[]'); } catch(e) { q = []; }
    if (!q.length) return;
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
        fetchDashboardDataBg();
    } else {
        mostrarToast(`⚠️ ${failed.length} acción(es) no se pudieron enviar aún.`, 'error');
    }
}
window.addEventListener('online',  () => { mostrarToast('📶 Conexión restaurada.', 'success'); _processOfflineQueue(); });
window.addEventListener('offline', () => { mostrarToast('📶 Sin conexión. Las acciones se guardarán para reenviar.', 'error'); });

function fetchPostBg(action, payload) {
    pendingPostRequests++;
    let dot = document.getElementById('sync-dot');
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-300 animate-ping';
    return fetch(GAS_URL, { method: 'POST', redirect: 'follow', body: JSON.stringify({ action: action, payload: payload }), headers: {'Content-Type': 'text/plain;charset=utf-8'} })
        .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
        .then(d => {
            pendingPostRequests--;
            if (dot && pendingPostRequests === 0) dot.className = 'w-2 h-2 rounded-full bg-emerald-300 animate-pulse';
            return d;
        })
        .catch(err => {
            pendingPostRequests--;
            if (dot) dot.className = 'w-2 h-2 rounded-full bg-red-400';
            setTimeout(() => { if (dot && pendingPostRequests === 0) dot.className = 'w-2 h-2 rounded-full bg-emerald-300 animate-pulse'; }, 3000);
            _enqueueOffline(action, payload);
            mostrarToast('📶 Sin conexión. La acción se reintentará al reconectar.', 'error');
            return { status: 'error', message: 'Error de conexión' };
        });
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
        creador: myOpName
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

function confirmarFotoZarpe() {
    let id_op = document.getElementById('hidden-zarpe-op-id').value;
    let hora  = document.getElementById('hidden-zarpe-hora').value;
    // Priorizar cámara, luego galería
    let inputCam = document.getElementById('zarpe-foto-camara');
    let inputGal = document.getElementById('zarpe-foto-galeria');
    let file = (inputCam.files[0]) || (inputGal.files[0]);

    cerrarSubModal('modal-zarpe-foto');
    if(!file) { mostrarToast('Sin foto seleccionada.', 'error'); return; }

    let reader = new FileReader();
    reader.onload = e => {
        fetchPostBg('subir_foto_zarpe', { id_operacion: id_op, hora_salida: hora, foto_base64: e.target.result, creador: myOpName })
            .then(res => {
                if (res.status === 'error') {
                    mostrarToast('Error al subir foto.', 'error');
                } else {
                    mostrarToast('✅ Foto de zarpe guardada.');
                    // Actualizar local state para que el botón cambie a "Ver Foto"
                    let opLocal = window.operacionesData.find(o => o.id === id_op);
                    if (opLocal && res.foto_url) {
                        opLocal.foto_zarpe = res.foto_url;
                        let cont = document.getElementById('operaciones-container');
                        if (cont) cont._fp = null; // invalidar fingerprint
                        renderOperaciones(window.operacionesData);
                    }
                }
            });
    };
    reader.readAsDataURL(file);
}

// ==========================
// CIERRE DEL DÍA — PDF
// ==========================
function generarCierreDelDia() {
    if(!confirm('¿Confirmas el CIERRE DEL DÍA? Se generará el reporte y se anularán las operaciones pendientes.')) return;

    let ops       = window.operacionesData || [];
    let cajaAll   = (window.cajaData || []).filter(c => esFechaHoy(c.timestamp) && !c._syncing);
    let pases     = (window.pasesExternosData || []).filter(p => esFechaHoy(p.timestamp));
    let contactos = window.contactosData || [];
    let ahora     = new Date();
    let hoy       = ahora.toLocaleDateString('es-PE', {day:'2-digit', month:'long', year:'numeric'});
    let horaCorte = ahora.toLocaleTimeString('es-PE', {hour:'2-digit', minute:'2-digit'});
    let caja      = cajaAll; // alias

    // ── Helpers inline ────────────────────────────────────────────────────
    const S = x => `<b style="color:#56070c">S/</b> ${parseFloat(x||0).toFixed(2)}`;
    const sec = t => `<h3 style="color:#56070c;font-size:12px;font-weight:900;text-transform:uppercase;margin:20px 0 8px;border-left:4px solid #56070c;padding-left:10px;letter-spacing:.06em;">${t}</h3>`;
    const tbl = (head, body) => `<table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:11px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead><tr style="background:#fdf2f2;color:#56070c;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;">${head}</tr></thead>
        <tbody style="background:white;">${body}</tbody></table>`;
    const th  = (t, a='left') => `<th style="padding:6px 8px;text-align:${a};">${t}</th>`;
    const td  = (t, a='left', extra='') => `<td style="padding:5px 8px;text-align:${a};${extra}">${t}</td>`;
    const row = (cells, bg='') => `<tr style="border-top:1px solid #f3f4f6;${bg}">${cells}</tr>`;
    const resolveNombre = id => { let c = contactos.find(x => x.id===id||x.nombre===id); return c ? c.nombre : (id||'—'); };

    // ── Totales globales ──────────────────────────────────────────────────
    let ingresos = 0, salidas = 0, totalPaxGlobal = 0;
    caja.forEach(c => {
        let m = parseFloat(c.monto)||0;
        let isPase = c.metodo_pago === 'Pase_Canje';
        if (!isPase) { if (_esIngresoCaja(c)) ingresos += m; else salidas += m; }
    });
    ops.forEach(op => { totalPaxGlobal += parseInt(op.ocupados)||0; });

    // ── 1. OPERACIONES DEL DÍA ────────────────────────────────────────────
    let opsHtml = ops.map(op => {
        let totalOp = (op.manifiesto||[]).reduce((s,m)=>s+(parseFloat(m.monto)||0), 0);
        // Estado de cierre: En_Viaje → Finalizado, Abierta → Cancelada (no zarpó)
        let estadoCierre = op.estado === 'En_Viaje' ? '✅ FINALIZADO' : '❌ CANCELADO (no zarpó)';
        let estadoColor  = op.estado === 'En_Viaje' ? '#16a34a' : '#dc2626';
        let headerBg     = op.estado === 'En_Viaje' ? '#56070c' : '#6b7280';
        let movRows = (op.manifiesto||[]).map(m => {
            let nombre = m.nombreContacto || m.contacto || '—';
            let tipoLabel = {'Aliado(PaseIn)':'Pase Entrada','Aliado(PaseOut)':'Pase Salida','Comisionado':'Comisionado','Agencia':'Agencia','Libre':'Libre','Directo':'Libre'}[m.tipo] || m.tipo;
            let isAliado = m.tipo && m.tipo.includes('Aliado');
            let montoStr = isAliado ? '<span style="color:#7c3aed;font-weight:900;">PASE</span>' : `S/ ${parseFloat(m.monto||0).toFixed(2)}`;
            return row(td(nombre) + td(tipoLabel,'center') + td(m.pax||0,'center') + td(montoStr,'right'));
        }).join('') || row(td('<i>Sin pasajeros</i>','left','color:#9ca3af;'));
        return `<div style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <div style="background:${headerBg};color:white;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:900;font-size:13px;">⛵ ${op.bote}</span>
                <span style="font-size:10px;opacity:.9;">${op.hora_salida||'—'} &nbsp;·&nbsp; ${op.ocupados}/${op.capacidad} PAX &nbsp;·&nbsp; Cap: ${op.capitan||'—'} &nbsp;·&nbsp; Guía: ${op.guia||'—'}</span>
            </div>
            ${tbl(th('Contacto')+th('Tipo','center')+th('PAX','center')+th('Monto','right'), movRows)}
            <div style="background:#f9fafb;padding:5px 10px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e5e7eb;">
                <span style="font-size:9px;font-weight:900;color:${estadoColor};">${estadoCierre}</span>
                <span style="font-weight:900;font-size:11px;color:#16a34a;">Total: S/ ${totalOp.toFixed(2)}</span>
            </div>
        </div>`;
    }).join('') || '<p style="color:#9ca3af;font-size:12px;">Sin operaciones.</p>';

    // ── 2. PASES DEL DÍA (por aliado) ────────────────────────────────────
    let pasesAliado = {};
    // PaseOut
    pases.forEach(p => {
        let k = resolveNombre(p.aliadoId || p.aliadoDestino || p.contacto);
        if (!pasesAliado[k]) pasesAliado[k] = { out:[], in:[] };
        pasesAliado[k].out.push({ pax: parseInt(p.pax)||0, origen: p.nombreOrigen || p.nombreContacto || '—', hora: p.timestamp ? new Date(p.timestamp).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : '—' });
    });
    // PaseIn
    ops.forEach(op => (op.manifiesto||[]).forEach(m => {
        if (m.tipo !== 'Aliado(PaseIn)' && m.tipo !== 'Aliado') return;
        let k = resolveNombre(m.contacto) || resolveNombre(m.nombreContacto);
        if (!pasesAliado[k]) pasesAliado[k] = { out:[], in:[] };
        pasesAliado[k].in.push({ pax: parseInt(m.pax)||0, origen: m.nombreContacto||'—' });
    }));
    let totalPaxPaseOut = 0, totalPaxPaseIn = 0;
    let pasesRows = Object.keys(pasesAliado).map(aliado => {
        let d = pasesAliado[aliado];
        let sumOut = d.out.reduce((s,x)=>s+x.pax,0);
        let sumIn  = d.in.reduce((s,x)=>s+x.pax,0);
        let saldo  = sumIn - sumOut;
        totalPaxPaseOut += sumOut; totalPaxPaseIn += sumIn;
        let detOut = d.out.map(x=>`↑ ${x.pax} pax enviados · de: ${x.origen} (${x.hora})`).join('<br>');
        let detIn  = d.in.map(x=>`↓ ${x.pax} pax recibidos`).join('<br>');
        let saldoColor = saldo > 0 ? '#16a34a' : saldo < 0 ? '#dc2626' : '#6b7280';
        let saldoTxt   = saldo === 0 ? 'Tablas' : (saldo > 0 ? `+${saldo} a favor` : `${saldo} a deber`);
        return row(
            td(`<b>${aliado}</b>`) +
            td(detOut || '—') +
            td(detIn  || '—') +
            td(`<b style="color:${saldoColor}">${saldoTxt}</b>`,'center')
        );
    }).join('') || row(td('<i>Sin pases del día.</i>','left','color:#9ca3af;'));
    let pasesHtml = tbl(th('Aliado')+th('Enviados')+th('Recibidos')+th('Saldo','center'), pasesRows);

    // ── 3. COMISIONES ─────────────────────────────────────────────────────
    let comMap = {};
    let _seenMovIds = new Set();
    ops.forEach(op => (op.manifiesto||[]).forEach(m => {
        if (m.tipo !== 'Comisionado') return;
        if (m.id && _seenMovIds.has(m.id)) return; // evitar duplicados por race condition
        if (m.id) _seenMovIds.add(m.id);
        let pax      = parseInt(m.pax)||0; if (!pax) return;
        let cobrado  = parseFloat(m.monto)||0;
        let info     = contactos.find(c => c.id===m.contacto || c.nombre===(m.nombreContacto||m.contacto));
        let base     = (info ? parseFloat(info.precio)||0 : 0) * pax;
        let comision = Math.max(0, cobrado - base);
        let key      = m.nombreContacto || m.contacto || '—';
        if (!comMap[key]) comMap[key] = { pax:0, cobrado:0, base:0, comision:0, pagado:0 };
        comMap[key].pax += pax; comMap[key].cobrado += cobrado; comMap[key].base += base; comMap[key].comision += comision;
    }));
    caja.filter(c=>c.categoria==='Pagos').forEach(c => {
        let key = resolveNombre(c.id_contacto);
        if (!comMap[key]) comMap[key] = { pax:0, cobrado:0, base:0, comision:0, pagado:0 };
        comMap[key].pagado += parseFloat(c.monto)||0;
    });
    let totalComision=0, totalPagado=0;
    let comRows = Object.keys(comMap).map(nombre => {
        let d = comMap[nombre];
        let pendiente = Math.max(0, d.comision - d.pagado);
        totalComision += d.comision; totalPagado += d.pagado;
        let pColor = pendiente > 0 ? '#dc2626' : '#16a34a';
        return row(
            td(`<b>${nombre}</b>`) +
            td(d.pax,'center') +
            td(`S/ ${d.cobrado.toFixed(2)}`,'right') +
            td(`S/ ${d.base.toFixed(2)}`,'right','color:#6b7280') +
            td(`<b>S/ ${d.comision.toFixed(2)}</b>`,'right','color:#d97706') +
            td(`S/ ${d.pagado.toFixed(2)}`,'right','color:#16a34a') +
            td(`<b style="color:${pColor}">S/ ${pendiente.toFixed(2)}</b>`,'right')
        );
    }).join('') || row(td('<i>Sin comisionados hoy.</i>','left','color:#9ca3af;'));
    let comisionesHtml = tbl(th('Comisionado')+th('PAX','center')+th('Cobrado','right')+th('Base','right')+th('Comisión','right')+th('Pagado','right')+th('Pendiente','right'), comRows);

    // ── 4. HISTORIAL CAJA (global) ────────────────────────────────────────
    let cajaRows = caja.map(c => {
        let m = parseFloat(c.monto)||0;
        let esI = _esIngresoCaja(c);
        let catLabel = c.categoria === 'Varios'
            ? 'Varios · ' + (c.comentarios||'').replace(/^\[.\] ?/,'').substring(0,35)
            : c.categoria.replace(/_/g,' ');
        let hora = c.timestamp ? new Date(c.timestamp).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : '—';
        return row(td(hora) + td(catLabel) + td(c.operador||'—') + td(c.metodo_pago||'Efectivo') +
            td(`<b style="color:${esI?'#16a34a':'#dc2626'}">${esI?'+':'-'} S/ ${m.toFixed(2)}</b>`,'right'));
    }).join('') || row(td('<i>Sin movimientos.</i>','left','color:#9ca3af;'));
    let cajaHtml = tbl(th('Hora')+th('Categoría')+th('Operador')+th('Método')+th('Monto','right'), cajaRows);

    // ── 5. POR OPERADOR ───────────────────────────────────────────────────
    let operadores = [...new Set(caja.map(c => c.operador).filter(Boolean))];
    let porOperadorHtml = operadores.map(op => {
        let txsOp = caja.filter(c => c.operador === op);
        let ingOp = 0, salOp = 0;
        let rowsOp = txsOp.map(c => {
            let m = parseFloat(c.monto)||0;
            let esI = _esIngresoCaja(c);
            if (esI) ingOp+=m; else salOp+=m;
            let cat = c.categoria === 'Varios' ? 'Varios · '+(c.comentarios||'').replace(/^\[.\] ?/,'').substring(0,30) : c.categoria.replace(/_/g,' ');
            let hora = c.timestamp ? new Date(c.timestamp).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : '—';
            return row(td(hora)+td(cat)+td(c.metodo_pago||'Efectivo')+td(`<b style="color:${esI?'#16a34a':'#dc2626'}">${esI?'+':'-'} S/ ${m.toFixed(2)}</b>`,'right'));
        }).join('') || row(td('<i>Sin movimientos.</i>','left','color:#9ca3af;'));
        return `<div style="margin-bottom:14px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <div style="background:#1f2937;color:white;padding:7px 12px;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:900;font-size:12px;">👤 ${op}</span>
                <span style="font-size:10px;opacity:.85;">Ingresos: S/${ingOp.toFixed(2)} &nbsp;·&nbsp; Salidas: S/${salOp.toFixed(2)} &nbsp;·&nbsp; Saldo: S/${(ingOp-salOp).toFixed(2)}</span>
            </div>
            ${tbl(th('Hora')+th('Categoría')+th('Método')+th('Monto','right'), rowsOp)}
        </div>`;
    }).join('') || '<p style="color:#9ca3af;font-size:12px;">Sin operadores registrados.</p>';

    // ── HTML COMPLETO ─────────────────────────────────────────────────────
    let htmlCierre = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Cierre del Día · ${hoy}</title>
    <style>
        body { font-family: Arial, Helvetica, sans-serif; margin:0; padding:0; background:#f9fafb; color:#111827; }
        .page { max-width:800px; margin:0 auto; padding:24px; background:white; }
        @media print { body{background:white;} .no-print{display:none;} }
    </style></head><body>
    <div class="page">

        <!-- CABECERA -->
        <div style="text-align:center;padding-bottom:20px;border-bottom:3px solid #56070c;margin-bottom:20px;">
            <div style="background:#56070c;color:white;display:inline-block;padding:10px 28px;border-radius:10px;font-weight:900;font-size:20px;letter-spacing:2px;margin-bottom:10px;">CIERRE DEL DÍA</div>
            <p style="font-size:15px;font-weight:700;color:#374151;margin:4px 0;">${hoy}</p>
            <p style="font-size:12px;color:#6b7280;margin:0;">Hora de corte: <b>${horaCorte}</b> &nbsp;·&nbsp; Generado por: <b>${myOpName||'Sistema'}</b></p>
        </div>

        <!-- RESUMEN EJECUTIVO -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;text-align:center;">
                <p style="font-size:9px;font-weight:900;color:#15803d;text-transform:uppercase;margin:0 0 4px;">Ingresos</p>
                <p style="font-size:18px;font-weight:900;color:#15803d;margin:0;">S/ ${ingresos.toFixed(2)}</p>
            </div>
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px;text-align:center;">
                <p style="font-size:9px;font-weight:900;color:#dc2626;text-transform:uppercase;margin:0 0 4px;">Salidas</p>
                <p style="font-size:18px;font-weight:900;color:#dc2626;margin:0;">S/ ${salidas.toFixed(2)}</p>
            </div>
            <div style="background:#fdf2f2;border:2px solid #56070c;border-radius:8px;padding:10px;text-align:center;">
                <p style="font-size:9px;font-weight:900;color:#56070c;text-transform:uppercase;margin:0 0 4px;">Saldo</p>
                <p style="font-size:18px;font-weight:900;color:#56070c;margin:0;">S/ ${(ingresos-salidas).toFixed(2)}</p>
            </div>
            <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px;text-align:center;">
                <p style="font-size:9px;font-weight:900;color:#1d4ed8;text-transform:uppercase;margin:0 0 4px;">PAX Total</p>
                <p style="font-size:18px;font-weight:900;color:#1d4ed8;margin:0;">${totalPaxGlobal}</p>
            </div>
        </div>

        ${sec('1. Operaciones del día')} ${opsHtml}
        ${sec('2. Pases del día (por aliado)')} ${pasesHtml}
        ${sec('3. Comisiones')} ${comisionesHtml}
        ${sec('4. Historial de caja (global)')} ${cajaHtml}
        ${sec('5. Detalle por operador')} ${porOperadorHtml}

        <!-- PIE -->
        <p style="font-size:10px;color:#9ca3af;text-align:center;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:10px;">
            OperacionesPS · Cierre generado el ${new Date().toLocaleString('es-PE')} · Todos los datos corresponden al día ${hoy}
        </p>
    </div>
    </body></html>`;

    // ── Mostrar en pantalla para imprimir + guardar en Drive ──────────────
    let printDiv = document.getElementById('print-cierre');
    printDiv.innerHTML = htmlCierre;

    // Anular ops pendientes
    ops.filter(op => op.estado === 'Abierta').forEach(op => {
        fetchPostBg('cerrar_operacion', { id_operacion: op.id, creador: myOpName });
    });

    // Nombre del archivo
    let fechaFile = ahora.toLocaleDateString('es-PE',{year:'numeric',month:'2-digit',day:'2-digit'}).replace(/\//g,'-');
    let horaFile  = horaCorte.replace(':','-');
    let nombreCierre = `Cierre ${fechaFile} ${horaFile}`;

    // Guardar en Drive y mostrar link
    mostrarToast('⏳ Guardando cierre en Drive...', 'info');
    fetchPostBg('guardar_cierre', { html: htmlCierre, nombre: nombreCierre }).then(res => {
        if (res && res.url) {
            mostrarToast('✅ Cierre guardado en Drive', 'success');
            // Mostrar modal con link
            let linkModal = document.createElement('div');
            linkModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
            linkModal.innerHTML = `<div style="background:white;border-radius:20px;padding:24px;max-width:320px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3);">
                <div style="width:56px;height:56px;background:#f0fdf4;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:24px;">✅</div>
                <h3 style="font-weight:900;font-size:16px;color:#111827;margin:0 0 6px;">Cierre guardado</h3>
                <p style="font-size:12px;color:#6b7280;margin:0 0 16px;">${nombreCierre}</p>
                <a href="${res.url}" target="_blank" style="display:block;background:#56070c;color:white;text-decoration:none;font-weight:900;padding:12px;border-radius:12px;font-size:13px;margin-bottom:10px;">📄 Abrir PDF en Drive</a>
                <button onclick="window.print()" style="width:100%;background:#f9fafb;border:1px solid #e5e7eb;color:#374151;font-weight:700;padding:10px;border-radius:12px;font-size:12px;cursor:pointer;margin-bottom:8px;">🖨️ Imprimir / Guardar PDF</button>
                <button onclick="this.closest('[style*=fixed]').remove();document.getElementById('print-cierre').innerHTML='';fetchDashboardDataBg();" style="width:100%;background:transparent;border:none;color:#9ca3af;font-size:12px;cursor:pointer;padding:6px;">Cerrar</button>
            </div>`;
            document.body.appendChild(linkModal);
        } else {
            mostrarToast('Error al guardar en Drive. Puedes imprimir desde aquí.', 'error');
            setTimeout(() => window.print(), 300);
        }
    }).catch(() => {
        mostrarToast('Error de conexión. Puedes imprimir directamente.', 'error');
        setTimeout(() => window.print(), 300);
    });
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
