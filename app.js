const GAS_URL = 'https://script.google.com/macros/s/AKfycbzi5aD18Xj0ikbQJZkiMSjZPkMg3HVFneL6XTEirRVg2MISZyDN-tTc-0OuUkakGXYWHw/exec';

let myOpName = localStorage.getItem('sot_operador') || null;

function cambiarOperador() {
    mostrarModalLogin(true); // closeable = true (ya hay un operador activo)
}

let pendingPostRequests = 0;

document.addEventListener('DOMContentLoaded', () => {
    if(!myOpName) {
        mostrarModalLogin(false);
    } else {
        let el = document.getElementById('label-operador-actual');
        if(el) el.innerText = myOpName;
    }
    fetchDashboardData();
    setInterval(fetchDashboardDataBg, 15000);
});

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
    document.getElementById('login-error').classList.add('hidden');
    document.getElementById('login-matches').classList.add('hidden');
    document.getElementById('login-input').value = '';
    setTimeout(() => document.getElementById('login-input').focus(), 100);
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
    document.getElementById('modal-login').classList.add('hidden');
    let el = document.getElementById('label-operador-actual');
    if(el) el.innerText = myOpName;
    mostrarToast('✅ Bienvenido, ' + myOpName);
}

function getHoyLocal() {
    let tzoffset = (new Date()).getTimezoneOffset() * 60000;
    return (new Date(Date.now() - tzoffset)).toISOString().split('T')[0];
}

function esFechaHoy(ts) {
    if(!ts) return false;
    // Soporta "YYYY-MM-DD" y "YYYY-MM-DDTHH:mm:ss..." tomando solo la parte de fecha
    return String(ts).split('T')[0] === getHoyLocal();
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

function fetchDashboardData() {
    toggleSpinner(true);
    fetch(GAS_URL + "?action=getDashboardData")
        .then(res => res.json())
        .then(data => {
            toggleSpinner(false);
            if(data.status === 'error') return console.error("Error backend:", data.error);
            window.operacionesData   = data.operaciones_abiertas || [];
            window.contactosData     = data.catalogos ? data.catalogos.contactos : [];
            window.catalogosData     = data.catalogos || {};
            window.reservasData      = data.sala_de_espera || [];
            window.pasesExternosData = data.pases_externos || [];
            window.cajaData          = data.movimientos_dia || [];

            renderCatalogos(data.catalogos);
            renderOperaciones(window.operacionesData);
            renderReservas(window.reservasData);
            renderCaja(window.cajaData);
            actualizarModalSiAbierto();
        })
        .catch(err => {
            toggleSpinner(false);
            console.error("Hubo un error cargando los datos:", err);
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

            // Re-inyectar temps que el servidor aún no confirmó (sin duplicar)
            if(localTemps.length > 0) {
                let newOp = window.operacionesData.find(o => o.id === opId);
                if(newOp) {
                    let stillPending = localTemps.filter(t =>
                        !newOp.manifiesto.some(s =>
                            s.contacto === t.contacto &&
                            String(s.pax) === String(t.pax) &&
                            s.tipo === t.tipo
                        )
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

            renderOperaciones(window.operacionesData);
            renderReservas(window.reservasData);
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
    document.getElementById('gestion-manifiesto-lista').innerHTML = generarListaHTML(op.manifiesto);
}

function fetchDashboardDataBg() {
    let spinner = document.getElementById('global-spinner');
    if(pendingPostRequests > 0 || !spinner.classList.contains('hidden')) return;

    let refreshIcon = document.querySelector('#btn-refresh i');
    if(refreshIcon) refreshIcon.classList.add('fa-spin');

    fetch(GAS_URL + "?action=getDashboardData")
        .then(res => res.json())
        .then(data => {
            if(refreshIcon) refreshIcon.classList.remove('fa-spin');
            if(data.status === 'error') return;

            window.operacionesData   = data.operaciones_abiertas || [];
            window.contactosData     = data.catalogos ? data.catalogos.contactos : [];
            window.catalogosData     = data.catalogos || {};
            window.reservasData      = data.sala_de_espera || [];
            window.pasesExternosData = data.pases_externos || [];
            window.cajaData          = data.movimientos_dia || [];

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
            // El modal de gestión bote NO se toca en BG refresh para no interrumpir al operador
        })
        .catch(err => {
            if(refreshIcon) refreshIcon.classList.remove('fa-spin');
        });
}

function renderOperaciones(operaciones) {
    const container = document.getElementById('operaciones-container');
    let hoy = getHoyLocal();
    let opHoy = operaciones.filter(op => op.fecha === hoy || !op.fecha);

    opHoy.sort((a, b) => {
        if (a.estado === 'Abierta' && b.estado !== 'Abierta') return -1;
        if (a.estado !== 'Abierta' && b.estado === 'Abierta') return 1;
        return 0; 
    });

    if(!opHoy || opHoy.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-gray-500"><i class="fas fa-ship text-4xl mb-3 opacity-20 block"></i> No hay lanchas programadas<br>para el día de HOY.</div>`;
        return;
    }
    
    // Tabla de pases del día (al final)
    let pasesDiaHTML = '';
    let pases = window.pasesExternosData || [];
    if(pases.length > 0) {
        let totalPaxPases = pases.reduce((s, p) => s + (parseInt(p.pax)||0), 0);
        let filas = pases.map((p, idx) => {
            // Resolver nombre real del aliado destino desde contactosData
            let contactos   = window.contactosData || [];
            let aliadoId    = p.aliadoDestino || p.contacto || '';
            let aliadoInfo  = contactos.find(c => c.id === aliadoId || c.nombre === aliadoId);
            let aliadoNombre= aliadoInfo ? aliadoInfo.nombre : aliadoId;
            // Origen: nombre del contacto original que generó el pase
            let origen      = p.nombreContacto || '';
            let ts          = p.timestamp ? new Date(p.timestamp).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : '';
            return `
            <tr class="border-t border-gray-100 cursor-pointer hover:bg-purple-50 transition" onclick="verDetallePase(${idx})">
                <td class="py-2 px-2">
                    <span class="text-[9px] font-bold text-purple-400 uppercase tracking-wide block">Para:</span>
                    <span class="text-[11px] font-black text-purple-800 block uppercase leading-tight">${aliadoNombre}</span>
                    ${origen ? `<span class="text-[9px] text-gray-400 font-bold"><i class="fas fa-arrow-right text-[7px] mr-0.5"></i>De: ${origen}</span>` : ''}
                </td>
                <td class="py-2 px-2 text-center text-sm font-black text-blue-600">${p.pax}</td>
                <td class="py-2 px-2 text-[9px] text-gray-400 text-right">${ts}</td>
            </tr>`;
        }).join('');
        pasesDiaHTML = `
        <div class="mt-4 bg-purple-50 border border-purple-200 rounded-2xl shadow-sm overflow-hidden">
            <div class="px-4 py-2.5 bg-purple-100 border-b border-purple-200 flex items-center justify-between">
                <span class="text-[11px] font-black text-purple-800 uppercase tracking-wider"><i class="fas fa-people-carry mr-1.5"></i>Pases del día</span>
                <span class="text-[10px] bg-purple-200 text-purple-800 font-black px-2 py-0.5 rounded-full">${totalPaxPases} pax · ${pases.length} pases</span>
            </div>
            <table class="w-full">
                <thead><tr class="text-[9px] text-purple-500 uppercase tracking-wider bg-purple-50">
                    <th class="py-1.5 px-2 text-left font-bold">Destino / Origen</th>
                    <th class="py-1.5 px-2 text-center font-bold">PAX</th>
                    <th class="py-1.5 px-2 text-right font-bold">Hora</th>
                </tr></thead>
                <tbody class="bg-white">${filas}</tbody>
            </table>
        </div>`;
    }

    container.innerHTML = opHoy.map(op => {
        let porcentaje = op.capacidad > 0 ? (op.ocupados / op.capacidad) * 100 : 0;
        let isViaje = op.estado === 'En_Viaje';
        let barColor = isViaje ? 'bg-orange-500' : 'bg-green-500';
        let titleColor = isViaje ? 'text-orange-900' : 'text-blue-900';
        let bgStyle = isViaje ? 'bg-orange-50 border-orange-200' : 'bg-white border-gray-100';
        let tagEstado = isViaje ? `<span class="absolute top-2 right-4 bg-orange-200 text-orange-800 text-[8px] px-2 py-0.5 rounded font-black tracking-widest uppercase shadow-sm border border-orange-300 z-10 animate-pulse"><i class="fas fa-water mr-1"></i>En Viaje</span>` : '';

        return `
        <div class="${bgStyle} rounded-2xl shadow-sm p-4 mb-4 border relative overflow-hidden">
            ${tagEstado}
            <div class="absolute top-0 left-0 w-2 h-full ${barColor}"></div>
            <div class="flex justify-between items-center mb-1 pl-3">
                <h3 class="font-extrabold text-lg flex-1 truncate ${titleColor}"><i class="fas fa-ship fa-sm mr-2 ${isViaje ? 'text-orange-400' : 'text-blue-400'} ${op.id === 'Creando...' ? 'fa-pulse text-yellow-500' : ''}"></i>${op.bote}</h3>
                <div class="flex items-center gap-1.5 shrink-0 ml-2">
                    ${op.id !== 'Creando...' ? `<button class="w-7 h-7 bg-white border border-gray-200 rounded-full text-gray-400 hover:text-blue-600 hover:border-blue-300 transition text-xs flex items-center justify-center shadow-sm" onclick="abrirModalEditarOp('${op.id}'); event.stopPropagation()"><i class="fas fa-pen"></i></button>` : ''}
                    <span class="bg-white border text-gray-800 text-xs px-2.5 py-1 rounded-full font-bold shadow-sm">${op.ocupados} / ${op.capacidad} PAX</span>
                </div>
            </div>
            <div class="flex justify-between text-[10px] text-gray-400 font-bold mb-3 uppercase tracking-wider pl-3 pr-2 ml-6">
                <span>CÓDIGO: <span class="${op.id === 'Creando...' ? 'text-yellow-500 animate-pulse' : 'text-gray-700'}">${op.id}</span></span>
                ${op.hora_salida ? `<span class="${isViaje ? 'text-orange-500' : 'text-blue-500'} font-black"><i class="fas fa-clock mr-1"></i>${op.hora_salida}</span>` : ''}
            </div>
            
            <div class="w-full bg-gray-100 rounded-full h-2 mb-3">
                <div class="bg-gradient-to-r ${isViaje ? 'from-orange-400 to-orange-500' : 'from-green-400 to-green-500'} h-2 rounded-full" style="width: ${porcentaje}%"></div>
            </div>
            <div class="text-[10px] text-gray-500 flex justify-between items-center mb-4 font-medium px-2 py-1.5 bg-white border border-gray-200 rounded-lg shadow-inner">
                <span class="truncate"><i class="fas fa-user-tie ${isViaje ? 'text-orange-400' : 'text-blue-400'} mr-1"></i><b class="text-gray-700">${op.capitan}</b></span>
                <span class="truncate text-right"><i class="fas fa-user-tag text-green-400 mr-1"></i><b class="text-gray-700">${op.guia}</b></span>
            </div>
            ${!isViaje ? `
            <div class="flex space-x-2 mt-2">
                <button class="flex-[2] bg-blue-50 text-blue-700 font-bold py-2.5 rounded-xl border border-blue-200 hover:bg-blue-100 shadow-sm transition active:scale-95 text-xs flex items-center justify-center" onclick="abrirModalGestionBote('${op.id}')">
                    <i class="fas fa-users mr-1.5"></i> Gest. PAX
                </button>
                <button class="flex-1 bg-green-500 text-white font-bold py-2.5 rounded-xl border border-green-600 shadow-md transition active:scale-95 text-xs flex items-center justify-center" onclick="confirmarZarpe('${op.id}')">
                    <i class="fas fa-anchor mr-1.5"></i> Zarpar
                </button>
            </div>
            ` : `
            <div class="mt-2 space-y-2">
                <button class="w-full bg-orange-100 text-orange-800 font-bold py-2.5 rounded-xl border border-orange-200 hover:bg-orange-200 shadow-sm transition active:scale-95 text-xs flex items-center justify-center" onclick="abrirModalGestionBote('${op.id}')">
                    <i class="fas fa-clipboard-list mr-1.5"></i> Ver Manifiesto
                </button>
                <button class="w-full bg-gray-50 text-gray-600 font-bold py-2 rounded-xl border border-gray-200 hover:bg-gray-100 transition active:scale-95 text-xs flex items-center justify-center" onclick="abrirModalZarpeFoto('${op.id}')">
                    <i class="fas fa-camera mr-1.5 text-gray-400"></i> Subir Foto de Zarpe
                </button>
            </div>
            `}
        </div>
        `;
    }).join('') + pasesDiaHTML;
}

function renderReservas(reservas) {
    const container = document.getElementById('reservas-container');
    let hoy = getHoyLocal();
    let hoyPartes = hoy.split('-');
    let formatLocal = `${hoyPartes[2]}/${hoyPartes[1]}/${hoyPartes[0]}`; // e.g., 26/03/2026
    
    let resAMostrar = reservas.filter(r => {
        let isSyncing = r.id === 'Creando...';
        let f = String(r.fecha).trim();
        let isHoy = f === hoy || f === formatLocal || !r.fecha;
        let isMine = String(r.creado_por || '').trim().toLowerCase() === String(myOpName).trim().toLowerCase();
        return isHoy || isMine || isSyncing;
    });

    if(!resAMostrar || resAMostrar.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-gray-500"><i class="fas fa-clipboard-list text-4xl mb-3 opacity-20 block"></i> No hay pasajeros pendientes hoy.</div>`;
        return;
    }

    container.innerHTML = resAMostrar.map(res => {
        let isSyncing   = res.id === 'Creando...';
        let isAsignando = !!res._asignando;
        let f = String(res.fecha).trim();
        let isHoy = f === hoy || f === formatLocal || !res.fecha;
        let isFutureForMe = !isHoy && !isSyncing && !isAsignando;

        let cardClasses = isAsignando ? "bg-green-50 border-green-400 border-l-[4px] opacity-80 animate-pulse border-y border-r"
            : isSyncing ? "bg-yellow-50 border-yellow-300 border-l-[4px] opacity-90 animate-pulse border-y border-r"
            : (isFutureForMe ? "opacity-60 grayscale bg-gray-50 border-gray-200 border" : "bg-white border-blue-500 border-l-[4px] border-y border-r border-y-gray-100 border-r-gray-100");
        let btnClasses = (isSyncing || isAsignando) ? "pointer-events-none bg-green-400 text-white font-bold"
            : (isFutureForMe ? "pointer-events-none opacity-50 bg-gray-300 border-gray-300 text-gray-500" : "bg-green-500 text-white shadow-md shadow-green-500/20 hover:bg-green-600 border-green-600");
        let btnIcon = isAsignando ? "fa-ship fa-pulse" : (isSyncing ? "fa-sync-alt fa-spin" : (isFutureForMe ? "fa-lock" : "fa-clipboard-check"));
        let btnText = isAsignando ? "¡Abordando!" : (isSyncing ? "Registrando..." : (isFutureForMe ? "No disponible hoy" : "Abordar Lancha"));
        let tagFecha = isHoy ? `<span class="bg-green-100 text-green-800 text-[9px] px-2 py-0.5 rounded font-bold mr-1 border border-green-200">HOY</span>` : `<span class="bg-yellow-100 text-yellow-800 text-[9px] px-2 py-0.5 rounded font-bold mr-1 border border-yellow-200">${res.fecha}</span>`;

        return `
        <div class="${cardClasses} rounded-2xl shadow-sm p-4 block mb-3 transition-all relative overflow-hidden">
            ${isSyncing ? '<div class="absolute top-2 right-3 text-[10px] items-center text-yellow-600 font-bold"><i class="fas fa-satellite-dish mr-1 animate-ping"></i> Nube</div>' : ''}
            <div class="flex justify-between items-start relative z-10">
                <div>
                    <h3 class="font-extrabold text-gray-800 text-lg">${res.cliente}</h3>
                    <p class="text-[10px] text-gray-500 mt-1 uppercase font-bold tracking-wider flex items-center">${tagFecha} <i class="fas fa-building text-xs mx-1 text-gray-400"></i> ${res.contacto.replace('_',' ')}</p>
                </div>
                <div class="text-right">
                    <span class="font-black text-2xl text-blue-600">${res.pax} <span class="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">PAX</span></span>
                    <p class="text-[10px] text-gray-400 mt-0 font-bold uppercase tracking-widest">${res.hora || 'Libre'}</p>
                </div>
            </div>
            <div class="flex mt-4 space-x-2 relative z-10">
                <button class="flex-[2] py-2.5 rounded-xl text-sm font-bold transition active:scale-95 border ${btnClasses}" onclick="prepararAsignacion('${res.id}', '${res.cliente}', '${res.pax}', '${res.contacto}')"><i class="fas ${btnIcon} mr-1"></i> ${btnText}</button>
                ${!isSyncing && !isAsignando ? `<button class="px-3 py-2.5 rounded-xl text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200 hover:bg-purple-200 transition active:scale-95" onclick="abrirPaseDesdeReserva('${res.id}', '${res.cliente}', '${res.pax}', '${res.contacto}')"><i class="fas fa-share-square mr-1"></i>Pasar</button>` : ''}
            </div>
        </div>
        `;
    }).join('');
}

function renderCaja(caja) {
    let txHoy = (caja || []).filter(c => esFechaHoy(c.timestamp));
    let ingresos = 0, salidas = 0;
    let comisionadosMap = {};

    // Categorías que son ingresos: Cobro, Varios-ingreso (modo ingreso), legacy
    let CATS_INGRESO = ['Cobro', 'Caja Chica', 'Ingreso por Venta', 'Ingreso_Venta', 'Caja_Chica'];
    // Categorías que son salidas: Pagos, Varios-salida, legacy
    let CATS_SALIDA  = ['Pagos', 'Pago_Comisionado', 'Pago Comisionado', 'Retiro_Jefatura', 'Retiro a Jefatura'];

    let historialHtml = txHoy.map(c => {
        let monto = parseFloat(c.monto) || 0;
        let isPase = c.metodo_pago === 'Pase_Canje' || c.metodo_pago === 'Pase / Canje';
        // Varios: detectar si es ingreso o salida por el campo modo guardado en comentarios (prefijo "[I]"/["S]")
        // Si no hay prefijo, asumir ingreso para Varios (retrocompatibilidad)
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
        let catLabel  = c.categoria === 'Varios' ? ('Varios · ' + (c.comentarios||'').replace(/^\[.\] ?/,'').substring(0,30)) : c.categoria.replace(/_/g,' ');
        let syncDot   = c._syncing ? `<span class="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse ml-1 align-middle"></span>` : '';
        let rowBg     = c._syncing ? 'bg-blue-50' : '';
        return `
        <div class="flex justify-between items-center p-3.5 ${rowBg} cursor-pointer hover:bg-gray-50 transition active:scale-95" onclick="${c._syncing ? '' : `abrirDetalleCaja('${c.id}')`}">
            <div class="flex-1 min-w-0 pr-2">
                <span class="text-xs font-extrabold text-gray-800 block truncate"><i class="fas fa-circle text-[7px] ${dotColor} mr-1.5"></i>${catLabel} ${syncDot}</span>
                <span class="text-[10px] text-gray-400 font-bold">${hora} · ${c.metodo_pago||'Efectivo'} · ${c.operador||''}</span>
            </div>
            <span class="font-black text-sm ${colorText} shrink-0">${signo} S/${monto.toFixed(2)}</span>
        </div>`;
    }).join('') || '<div class="text-center p-6 text-gray-400 text-sm font-bold">No hay movimientos hoy.</div>';

    let saldo = ingresos - salidas;

    // ── Panel Pases (solo hoy) ────────────────────────────────────────────
    let contactos = window.contactosData || [];
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

    // PaseOut: pases que enviamos a aliados (desde pasesExternosData de hoy)
    (window.pasesExternosData || []).filter(p => esFechaHoy(p.timestamp)).forEach(p => {
        let aliadoKey = resolverNombreAliado(p.aliadoDestino || p.contacto);
        let d = _getAliado(aliadoKey);
        let pax = parseInt(p.pax) || 0;
        d.out += pax;
        let hora = p.timestamp ? new Date(p.timestamp).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : '—';
        d.txs.push({ dir: 'out', pax, hora, detalle: p.nombreContacto || '' });
    });

    // PaseIn: pases que recibimos de aliados (desde manifiesto de operaciones de hoy)
    (window.operacionesData || []).filter(op => op.fecha === getHoyLocal() || !op.fecha).forEach(op => {
        (op.manifiesto || []).forEach(m => {
            if (m.tipo !== 'Aliado(PaseIn)' && m.tipo !== 'Aliado') return;
            let aliadoKey = resolverNombreAliado(m.contacto) || resolverNombreAliado(m.nombreContacto);
            let d = _getAliado(aliadoKey);
            let pax = parseInt(m.pax) || 0;
            d.in += pax;
            d.txs.push({ dir: 'in', pax, hora: '—', detalle: m.nombreContacto || '' });
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
    }).join('') || '<div class="text-center py-6 text-gray-400 text-sm font-bold">Sin pases registrados hoy.</div>';

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
    let pPanel = document.getElementById('fin-pases-content');
    if(pPanel) pPanel.innerHTML = pasesSummaryHtml + pasesHtml;

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

    fetchPostBg('abrir_operacion', { id_bote, id_capitan, id_guia, hora_salida, destino, creador: myOpName }).then(() => fetchDashboardDataBg());
}

function confirmarZarpe(id_op) {
    if(!confirm("¿Seguro que deseas ZARPAR esta lancha? Pasará a estado En Viaje.")) return;
    // Optimistic: actualizar estado local inmediatamente
    let opIndex = window.operacionesData.findIndex(o => o.id === id_op);
    if(opIndex !== -1) {
        window.operacionesData[opIndex].estado = 'En_Viaje';
        renderOperaciones(window.operacionesData);
    }
    fetchPostBg('zarpar_operacion', { id_operacion: id_op }).then(res => {
        if(res.status === 'error') { alert(res.message); return; }
        clearTimeout(window._syncTimer);
        window._syncTimer = setTimeout(fetchDashboardDataBg, 3000);
    });
}

// ==========================
// VENTA DIRECTA (MUELLE)
// ==========================
function generarListaHTML(manifiesto) {
    if(!manifiesto || manifiesto.length === 0) return '<div class="text-center p-6 bg-white border-2 border-dashed border-gray-200 rounded-2xl text-gray-400 font-bold"><i class="fas fa-ship text-4xl mb-3 opacity-20 block"></i> Lancha vacía.<br><span class="text-[10px] font-normal">Agrega pasajeros usando el formulario superior.</span></div>';
    
    return manifiesto.map(m => {
        let isSyncing  = !!m._syncing || (m.id && m.id.startsWith('temp-'));
        let isSelected = !isSyncing && window.editandoMovId === m.id;

        let bgClass    = isSelected ? 'bg-orange-50 ring-2 ring-orange-400' : 'bg-white';
        let iconoSinc  = isSyncing ? `<span class="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse ml-1 align-middle"></span>` : '';
        
        let isAliado       = m.tipo === 'Aliado' || m.tipo === 'Aliado(PaseIn)' || m.tipo === 'Aliado(PaseOut)' || m.tipo === 'Pase_Recibido';
        let isComisionado  = m.tipo === 'Comisionado';

        let isAgencia = m.tipo === 'Agencia';
        // Botones: Cobrar (no aliado), Adicionales (solo agencia), Pasar (no pase out), X (todos)
        let subBtns = (isSelected && !isSyncing) ? `
        <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t border-orange-200">
            ${!isAliado ? `<button class="flex-1 min-w-[70px] bg-green-500 text-white text-[11px] font-bold py-2 rounded-xl shadow-md shadow-green-500/30 hover:bg-green-600 transition" onclick="abrirModalCaja('cobro_directo', { id_operacion: document.getElementById('hidden-gestion-op').value, id_contacto: '${m.contacto}', nombre_contacto: '${(m.nombreContacto||m.contacto||'').replace(/'/g,"\\'")}', monto: ${m.monto||0}, bloqueado: false }); event.stopPropagation();"><i class="fas fa-money-bill-wave mr-1"></i> Cobrar</button>` : ''}
            ${isAgencia ? `<button class="bg-blue-100 text-blue-700 text-[11px] font-bold px-3 py-2 rounded-xl border border-blue-200 hover:bg-blue-200 transition" onclick="abrirModalImpuestos('${m.id}', '${m.contacto}'); event.stopPropagation();"><i class="fas fa-file-invoice-dollar mr-1"></i> Adicionales</button>` : ''}
            ${m.tipo !== 'Aliado(PaseOut)' ? `<button class="flex-1 min-w-[60px] bg-purple-500 text-white text-[11px] font-bold py-2 rounded-xl shadow-md shadow-purple-500/30 hover:bg-purple-600 transition" onclick="abrirModalDerivar('${m.id}', '${m.pax}'); event.stopPropagation();"><i class="fas fa-people-carry mr-1"></i> Pasar</button>` : ''}
            <button class="bg-red-100 text-red-600 text-[11px] font-bold px-3 py-2 rounded-xl border border-red-200 hover:bg-red-200 transition" onclick="eliminarMovimiento('${m.id}', '${m.pax}'); event.stopPropagation();"><i class="fas fa-trash-alt"></i></button>
        </div>` : '';

        // Monto display según tipo
        let montoDisplay;
        if (isAliado) {
            montoDisplay = `<span class="text-[10px] font-black text-purple-500 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">PASE</span>`;
        } else if (isAgencia && m.adicionales) {
            // Parse "Item1:25.00, Item2:10.00" and sum the amounts
            let adicionalesSum = (m.adicionales + '').split(',').reduce((acc, part) => {
                let val = parseFloat((part.split(':')[1] || '').trim()) || 0;
                return acc + val;
            }, 0);
            let montoBase = parseFloat(m.monto || 0);
            if (adicionalesSum > 0) {
                montoDisplay = `<span class="text-[10px] text-gray-500 block font-bold">S/ ${montoBase.toFixed(2)} <span class="inline-flex items-center gap-0.5 bg-amber-100 text-amber-700 border border-amber-300 text-[9px] font-black px-1 py-0.5 rounded ml-0.5">+${adicionalesSum.toFixed(2)}</span></span>`;
            } else {
                montoDisplay = `<span class="text-[10px] text-gray-500 block font-bold">S/ ${montoBase.toFixed(2)}</span>`;
            }
        } else {
            montoDisplay = `<span class="text-[10px] text-gray-500 block font-bold">S/ ${parseFloat(m.monto||0).toFixed(2)}</span>`;
        }

        // Etiqueta tipo legible
        let tipoLabel = { Libre:'Libre', Agencia:'Agencia', Aliado:'Aliado·Pase', 'Aliado(PaseIn)':'Pase·Entrada', 'Aliado(PaseOut)':'Pase·Salida', Comisionado:'Comisionado', Pase_Recibido:'Pase', Abordaje_CRM:'CRM', Directo:'Libre' }[m.tipo] || m.tipo.replace(/_/g,' ');

        // Nombre a mostrar: preferir nombreContacto si está disponible
        let nombreMostrar = m.nombreContacto || m.contacto || '';

        return `
        <div class="flex flex-col ${bgClass} border ${isSyncing ? 'border-blue-200' : 'border-gray-200'} p-3 rounded-xl cursor-pointer hover:bg-blue-50 transition shadow-sm mb-2" onclick="cargarParaEditar('${m.id}')">
            <div class="flex justify-between items-center">
                <div>
                    <span class="text-xs font-bold ${isSelected ? 'text-orange-800' : 'text-gray-800'} uppercase block">${nombreMostrar} ${iconoSinc}</span>
                    <span class="text-[10px] ${isAliado?'text-purple-500':isComisionado?'text-orange-500':'text-gray-500'} font-bold">${tipoLabel}</span>
                </div>
                <div class="text-right">
                    <span class="font-black text-blue-600 text-sm">${m.pax} PAX</span>
                    ${montoDisplay}
                </div>
            </div>
            ${subBtns}
        </div>`;
    }).join('');
}

function abrirModalGestionBote(id_op) {
    let op = window.operacionesData.find(o => o.id === id_op);
    if(!op || op.id === 'Creando...') return;

    // Nombre del bote en el H3 (preserva el span hijo)
    let nodeH3 = document.getElementById('gestion-bote-nombre');
    if(nodeH3.childNodes[0].nodeType === 3) nodeH3.childNodes[0].nodeValue = op.bote + " ";

    document.getElementById('hidden-gestion-op').value = op.id;
    document.getElementById('box-formulario-venta').classList.toggle('hidden', op.estado === 'En_Viaje');

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

    // Resetear estado del precio
    precioInput.readOnly = false;
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

    if(tipo === 'Libre') {
        if(pax > 0) precioInput.value = (30 * pax).toFixed(2);

    } else if(tipo === 'Agencia') {
        let sel = document.getElementById('input-vd-contacto-select');
        if(sel && sel.value) {
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
    document.getElementById('input-vd-tipo').value = 'Libre';
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
    if(op) {
        document.getElementById('gestion-manifiesto-lista').innerHTML = generarListaHTML(op.manifiesto);
    }
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
        if(t) t.value = movToEdit.contacto;
    } else {
        let s = document.getElementById('input-vd-contacto-select');
        if(s) s.value = movToEdit.contacto;
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
    if(opData) {
        document.getElementById('gestion-manifiesto-lista').innerHTML = generarListaHTML(opData.manifiesto);
    }
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
        id_contacto_payload = contacto;
        nombre_contacto_payload = contacto;
    } else {
        let sel = getContactoSeleccionado('input-vd-contacto-select');
        contacto = sel.nombre;
        id_contacto_payload = sel.id || sel.nombre;
        nombre_contacto_payload = sel.nombre;
    }

    if(!contacto) return alert("❌ Ingresa el nombre o selecciona el contacto.");
    if(!pax || parseFloat(pax) <= 0) return alert("❌ Cantidad de pasajeros inválida.");
    // Aliado no requiere precio (es 0), los demás sí
    if(tipo !== 'Aliado' && (!precio || parseFloat(precio) < 0)) return alert("❌ Ingresa el precio cobrado al pasajero.");

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
    if(opIndex !== -1) {
        let currentOp = window.operacionesData[opIndex];
        let requestedDelta = id_mov ? (parseInt(pax) - parseInt(currentOp.manifiesto.find(m => m.id === id_mov).pax)) : parseInt(pax);
        if(currentOp.ocupados + requestedDelta > currentOp.capacidad) return alert(`❌ ¡El bote no tiene capacidad suficiente!`);

        // IMPORTANTE: usar tipoGAS para que el dedup en syncManifestBg coincida con lo que devuelve GAS
        let tipoOptimista = tipo === 'Aliado' ? 'Aliado(PaseIn)' : tipo;
        if(id_mov) {
            let movIndex = currentOp.manifiesto.findIndex(m => m.id === id_mov);
            if(movIndex !== -1) {
                currentOp.ocupados += requestedDelta;
                currentOp.manifiesto[movIndex] = { id: id_mov, tipo: tipoOptimista, contacto, nombreContacto: nombre_contacto_payload, pax, monto: parseFloat(precio).toFixed(2), estado: 'Embarcado', _syncing: true };
            }
        } else {
            currentOp.ocupados += requestedDelta;
            currentOp.manifiesto.unshift({ id: 'temp-' + Date.now(), tipo: tipoOptimista, contacto, nombreContacto: nombre_contacto_payload, pax, monto: parseFloat(precio).toFixed(2), estado: 'Embarcado', _syncing: true });
        }
        actualizarModalSiAbierto();
        renderOperaciones(window.operacionesData);
    }
    
    // Limpiar el formulario YA — no esperar al POST
    resetFormularioVenta();

    let endpoint = id_mov ? 'editar_movimiento_pax' : 'registrar_movimiento_pax';
    let paxNum = parseFloat(pax);
    let precioNum = parseFloat(precio);
    // Mapear tipo UI → tipo GAS (Aliado en UI = PaseIn recibido por nosotros)
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

    fetchPostBg(endpoint, payload).then(res => {
        if(res.status === 'error') { alert(res.message); return; }
        // Programa sincronización debounced: si ya hay una pendiente, cancela la anterior
        // para que solo se dispare UNA vez luego del último POST completado
        clearTimeout(window._syncTimer);
        window._syncTimer = setTimeout(syncManifestBg, 2500);
    });
}

// ==========================
// FORMULARIO CRM RESERVAS
// ==========================
function cambiarTipoCRM() {
    let tipo = document.getElementById('input-crm-tipo').value;
    let container = document.getElementById('container-crm-contacto');

    if(tipo === 'Libre') {
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Apellido / Nombre</label>
            <input type="text" id="input-crm-contacto-text" class="${_textInputClass()}" placeholder="Ej: Familia Vasquez">`;

    } else if(tipo === 'Agencia') {
        let filtered = (window.contactosData||[]).filter(c => normTipo(c.tipo).includes('agencia'));
        let opts = filtered.map(c => `<option value="${c.nombre}">${c.nombre} (S/${c.precio}/pax)</option>`).join('');
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Agencia</label>
            <select id="input-crm-contacto-select" class="${_selectInputClass()}" onchange="actualizarPrecioDefectoCRM()">
                <option value="">Seleccionar...</option>${opts}</select>`;

    } else if(tipo === 'Aliado') {
        let filtered = (window.contactosData||[]).filter(c => normTipo(c.tipo).includes('aliado'));
        let opts = filtered.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('');
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Aliado</label>
            <select id="input-crm-contacto-select" class="${_selectInputClass()}">
                <option value="">Seleccionar...</option>${opts}</select>`;
        document.getElementById('input-crm-precio').value = '0';

    } else if(tipo === 'Comisionado') {
        let filtered = (window.contactosData||[]).filter(c => normTipo(c.tipo).includes('comision'));
        let opts = filtered.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('');
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
    let contacto = tipo === 'Libre'
        ? (document.getElementById('input-crm-contacto-text')?.value.trim().toUpperCase() || '')
        : (document.getElementById('input-crm-contacto-select')?.value || '');
    
    if(!fecha || !contacto || !pax || !precio) return alert("❌ Fecha, Cliente, PAX y Total son obligatorios.");
    
    let resTemp = { 
        id: 'Creando...', fecha: fecha, hora: hora, cliente: contacto, 
        contacto: contacto, pax: pax, monto: parseFloat(precio).toFixed(2), 
        creado_por: myOpName 
    };
    window.reservasData.unshift(resTemp);
    renderReservas(window.reservasData);
    cerrarModales();
    
    fetchPostBg('nueva_reserva', {
        fecha: fecha, hora: hora, tipo: tipo,
        id_contacto: contacto, cliente: contacto, cant_pax: pax, monto: parseFloat(precio).toFixed(2),
        creador: myOpName
    }).then(() => {
        document.getElementById('input-crm-pax').value = ''; document.getElementById('input-crm-precio').value = '';
        fetchDashboardDataBg();
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

    document.getElementById('caja-modo').value             = modo;
    document.getElementById('caja-id-operacion').value     = opts.id_operacion || '';
    document.getElementById('caja-id-contacto-hidden').value = opts.id_contacto || '';
    document.getElementById('caja-monto').value            = opts.monto || '';
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
    } else {
        // cobro_directo: desde botón "Cobrar" en el manifiesto
        titulo.innerHTML = '<i class="fas fa-money-bill-wave text-green-500 mr-2"></i> Cobrar';
        desc.textContent = opts.nombre_contacto ? `Cobro a ${opts.nombre_contacto}` : 'Registrar cobro.';
        btnOk.className  = btnOk.className.replace(/bg-\w+-\d+/g,'') + ' bg-green-500 hover:bg-green-600';
        catSel.innerHTML = `<option value="Cobro">💰 Cobro</option>`;
        catSel.setAttribute('disabled', 'true');
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
            // Excluir aliados — ellos manejan pases, no cobros en efectivo
            contactos.filter(c => !(c.tipo||'').toLowerCase().includes('aliado')).forEach(c => {
                let opt = document.createElement('option');
                opt.value = c.nombre; opt.dataset.id = c.id; opt.textContent = c.nombre + (c.tipo ? ' · ' + c.tipo : '');
                sel.appendChild(opt);
            });
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
    document.getElementById('caja-id-contacto-hidden').value = opt?.dataset?.id || '';
}

function confirmarCaja() {
    let modo      = document.getElementById('caja-modo').value;
    let cat       = document.getElementById('caja-categoria').value;
    let monto     = document.getElementById('caja-monto').value;
    let metodo    = document.getElementById('caja-metodo').value;
    let comentario= document.getElementById('caja-comentarios').value.trim();
    let idOp      = document.getElementById('caja-id-operacion').value;
    let idContacto= document.getElementById('caja-id-contacto-hidden').value;

    if (!monto || isNaN(monto) || parseFloat(monto) <= 0) { alert('Ingresa un monto válido.'); return; }
    if (cat === 'Varios' && !comentario) { alert('El campo "Comentarios" es obligatorio para movimientos varios.'); return; }

    // Prefixar comentarios de Varios con [I] o [S] para identificar dirección
    if (cat === 'Varios') {
        comentario = (modo === 'salida' ? '[S] ' : '[I] ') + comentario;
    }

    // Leer foto comprobante si existe
    let camFile = document.getElementById('comprobante-foto-camara').files[0];
    let galFile = document.getElementById('comprobante-foto-galeria').files[0];
    let fotoFile = camFile || galFile;

    // ── Optimistic update ─────────────────────────────────────────────────
    let tempId = 'temp-tx-' + Date.now();
    let tempTx = {
        id:           tempId,
        id_operacion: idOp,
        id_contacto:  idContacto,
        categoria:    cat,
        monto:        parseFloat(monto),
        metodo_pago:  metodo,
        comentarios:  comentario,
        foto_url:     '',
        operador:     myOpName,
        timestamp:    new Date().toISOString(),
        _syncing:     true
    };
    if (!window.cajaData) window.cajaData = [];
    window.cajaData.unshift(tempTx);
    renderCaja(window.cajaData);

    cerrarSubModal('modal-caja');

    function enviar(foto_base64) {
        fetchPostBg('registrar_transaccion', {
            id_operacion: idOp,
            id_contacto:  idContacto,
            categoria:    cat,
            monto:        parseFloat(monto),
            metodo_pago:  metodo,
            comentarios:  comentario,
            foto_base64:  foto_base64 || '',
            operador:     myOpName
        }).then(res => {
            // Reemplazar temp con ID real si volvió, luego sync completo
            let idx = (window.cajaData || []).findIndex(c => c.id === tempId);
            if (idx !== -1) {
                if (res && res.id_transaccion) {
                    window.cajaData[idx] = { ...window.cajaData[idx], id: res.id_transaccion, _syncing: false };
                } else {
                    window.cajaData.splice(idx, 1);
                }
            }
            fetchDashboardDataBg();
        }).catch(() => {
            let idx = (window.cajaData || []).findIndex(c => c.id === tempId);
            if (idx !== -1) window.cajaData.splice(idx, 1);
            renderCaja(window.cajaData);
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
    fetchPostBg('eliminar_movimiento', { id_mov, creador: myOpName }).then(res => {
        if(res.status === 'error') { alert(res.message); fetchDashboardData(); }
    });
}

function abrirModalImpuestos(id_mov, contacto) {
    document.getElementById('hidden-impuestos-idmov').value = id_mov;
    document.getElementById('impuestos-contacto').textContent = contacto;
    let lista = document.getElementById('impuestos-lista');
    let impuestos = (window.catalogosData && window.catalogosData.impuestos) || [];
    if(!impuestos.length) {
        lista.innerHTML = '<p class="text-center text-gray-400 text-xs py-4">No hay impuestos configurados en la hoja Impuestos.</p>';
    } else {
        lista.innerHTML = impuestos.map(imp => `
        <div class="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl p-3">
            <div>
                <span class="text-sm font-bold text-gray-800">${imp.nombre}</span>
                <span class="text-[11px] text-gray-500 block">S/ ${parseFloat(imp.monto).toFixed(2)} c/u</span>
            </div>
            <div class="flex items-center space-x-2">
                <button onclick="cambiarQtyImpuesto('${imp.id}', -1)" class="w-8 h-8 rounded-full bg-gray-200 text-gray-700 font-black text-base hover:bg-red-100 hover:text-red-600 transition flex items-center justify-center">−</button>
                <span id="qty-imp-${imp.id}" class="w-7 text-center font-black text-gray-800 text-sm" data-monto="${imp.monto}">0</span>
                <button onclick="cambiarQtyImpuesto('${imp.id}', 1)" class="w-8 h-8 rounded-full bg-gray-200 text-gray-700 font-black text-base hover:bg-green-100 hover:text-green-600 transition flex items-center justify-center">+</button>
            </div>
        </div>`).join('');
    }
    document.getElementById('impuestos-total').textContent = 'S/ 0.00';
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
    if(!partes.length) return alert('Agrega al menos un impuesto con cantidad mayor a 0.');
    let adicionales = partes.join(', ');
    cerrarSubModal('modal-impuestos');
    fetchPostBg('actualizar_adicionales', { id_mov, adicionales, creador: myOpName }).then(res => {
        if(res.status === 'error') alert(res.message);
        else mostrarToast('✅ Adicionales registrados: ' + adicionales);
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
                contacto: aliado_id,
                nombreContacto: mov.nombreContacto || mov.contacto,  // nombre original
                pax: mov.pax,
                monto: mov.monto,
                estado: 'Pasado',
                aliadoDestino: aliado,
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

function _esIngresoCaja(tx) {
    let CATS_INGRESO = ['Cobro', 'Caja Chica', 'Ingreso por Venta', 'Ingreso_Venta', 'Caja_Chica'];
    let CATS_SALIDA  = ['Pagos', 'Pago_Comisionado', 'Pago Comisionado', 'Retiro_Jefatura', 'Retiro a Jefatura'];
    if (tx.categoria === 'Varios') return !(tx.comentarios||'').startsWith('[S]');
    return CATS_INGRESO.includes(tx.categoria);
}

function abrirDetalleCaja(id_tx) {
    let tx = window.cajaData.find(c => c.id === id_tx);
    if(!tx) return;

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
function fetchPostBg(action, payload) {
    pendingPostRequests++;
    let refreshIcon = document.querySelector('#btn-refresh i'); if(refreshIcon) refreshIcon.classList.add('fa-spin', 'text-yellow-400');
    return fetch(GAS_URL, { method: 'POST', redirect: 'follow', body: JSON.stringify({ action: action, payload: payload }), headers: {'Content-Type': 'text/plain;charset=utf-8'} })
        .then(res => res.json())
        .then(d => {
            pendingPostRequests--;
            if(refreshIcon) refreshIcon.classList.remove('fa-spin', 'text-yellow-400');
            return d;
        })
        .catch(err => {
            pendingPostRequests--;
            if(refreshIcon) refreshIcon.classList.remove('fa-spin', 'text-yellow-400');
            mostrarToast('⚠️ Sin conexión. El dato puede no haberse guardado. Recarga para verificar.', 'error');
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

    // Optimistic: agregar a pases del día
    if(!window.pasesExternosData) window.pasesExternosData = [];
    window.pasesExternosData.unshift({
        id: 'temp-pase-' + Date.now(),
        tipo: 'Aliado(PaseOut)',
        contacto: sel.id || sel.nombre,
        nombreContacto: contacto,
        aliadoDestino: sel.nombre,
        pax: pax,
        monto: '0',
        estado: 'Pasado',
        timestamp: new Date().toISOString()
    });
    renderOperaciones(window.operacionesData);

    cerrarSubModal('modal-pase-reserva');

    fetchPostBg('pase_desde_reserva', {
        id_reserva,
        cant_pax: pax,
        aliado: sel.nombre,
        aliado_id: sel.id || sel.nombre,
        nombre_contacto_original: contacto,
        creador: myOpName
    }).then(res => {
        if(res.status === 'error') { alert(res.message); return; }
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
function abrirModalZarpeFoto(id_op) {
    let op = window.operacionesData.find(o => o.id === id_op);
    document.getElementById('hidden-zarpe-op-id').value     = id_op;
    document.getElementById('hidden-zarpe-hora').value      = op ? (op.hora_salida || '') : '';
    document.getElementById('zarpe-foto-op-id').textContent = id_op + (op ? ' · ' + op.bote : '');
    document.getElementById('zarpe-foto-nombre').classList.add('hidden');
    document.getElementById('zarpe-foto-camara').value  = '';
    document.getElementById('zarpe-foto-galeria').value = '';
    document.getElementById('zarpe-foto-preview').innerHTML = '<span class="text-sm text-gray-400 font-bold">Sin foto seleccionada</span>';
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
                if(res.status === 'error') mostrarToast('Error al subir foto.', 'error');
                else mostrarToast('✅ Foto de zarpe guardada.');
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
        let movRows = (op.manifiesto||[]).map(m => {
            let nombre = m.nombreContacto || m.contacto || '—';
            let tipoLabel = {'Aliado(PaseIn)':'Pase Entrada','Aliado(PaseOut)':'Pase Salida','Comisionado':'Comisionado','Agencia':'Agencia','Libre':'Libre','Directo':'Libre'}[m.tipo] || m.tipo;
            let isAliado = m.tipo && m.tipo.includes('Aliado');
            let montoStr = isAliado ? '<span style="color:#7c3aed;font-weight:900;">PASE</span>' : `S/ ${parseFloat(m.monto||0).toFixed(2)}`;
            return row(td(nombre) + td(tipoLabel,'center') + td(m.pax||0,'center') + td(montoStr,'right'));
        }).join('') || row(td('<i>Sin pasajeros</i>','left','color:#9ca3af;'));
        return `<div style="margin-bottom:16px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <div style="background:#56070c;color:white;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;">
                <span style="font-weight:900;font-size:13px;">⛵ ${op.bote}</span>
                <span style="font-size:10px;opacity:.9;">${op.hora_salida||'—'} &nbsp;·&nbsp; ${op.ocupados}/${op.capacidad} PAX &nbsp;·&nbsp; Cap: ${op.capitan||'—'} &nbsp;·&nbsp; Guía: ${op.guia||'—'}</span>
            </div>
            ${tbl(th('Contacto')+th('Tipo','center')+th('PAX','center')+th('Monto','right'), movRows)}
            <div style="background:#f9fafb;padding:5px 10px;text-align:right;font-weight:900;font-size:11px;color:#16a34a;border-top:1px solid #e5e7eb;">Total: S/ ${totalOp.toFixed(2)}</div>
        </div>`;
    }).join('') || '<p style="color:#9ca3af;font-size:12px;">Sin operaciones.</p>';

    // ── 2. PASES DEL DÍA (por aliado) ────────────────────────────────────
    let pasesAliado = {};
    // PaseOut
    pases.forEach(p => {
        let k = resolveNombre(p.aliadoDestino || p.contacto);
        if (!pasesAliado[k]) pasesAliado[k] = { out:[], in:[] };
        pasesAliado[k].out.push({ pax: parseInt(p.pax)||0, origen: p.nombreContacto||'—', hora: p.timestamp ? new Date(p.timestamp).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : '—' });
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
    ops.forEach(op => (op.manifiesto||[]).forEach(m => {
        if (m.tipo !== 'Comisionado') return;
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

function verDetallePase(idx) {
    let p = (window.pasesExternosData || [])[idx];
    if(!p) return;
    let nombre   = p.nombreContacto || p.contacto || '—';
    let destino  = p.aliadoDestino || p.contacto || '—';
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
    let toast = document.getElementById('app-toast');
    if(!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        toast.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:9999;padding:10px 18px;border-radius:12px;font-size:12px;font-weight:700;max-width:90vw;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.15);transition:opacity 0.3s;';
        document.body.appendChild(toast);
    }
    toast.style.background = tipo==='error'?'#fee2e2':tipo==='success'?'#dcfce7':'#dbeafe';
    toast.style.color      = tipo==='error'?'#991b1b':tipo==='success'?'#15803d':'#1e40af';
    toast.style.border     = tipo==='error'?'1px solid #fca5a5':tipo==='success'?'1px solid #86efac':'1px solid #93c5fd';
    toast.style.opacity = '1';
    toast.innerText = msg;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
}
function toggleSpinner(show) { const s = document.getElementById('global-spinner'); const u = document.getElementById('btn-refresh'); if(show) { s.classList.remove('hidden'); u.classList.add('hidden'); } else { s.classList.add('hidden'); u.classList.remove('hidden'); } }
