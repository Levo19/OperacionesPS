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
    const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => tab.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active', 'red-tab'));
    btnElement.classList.add('active');
    if(tabId === 'tab-cierre') {
        btnElement.classList.add('red-tab');
        poblarSelectorCierre();
    }
    document.getElementById('app-title').innerText = title;
}

function poblarSelectorCierre() {
    let sel = document.getElementById('select-cierre-op');
    if(!sel) return;
    let ops = (window.operacionesData || []).filter(op => op.estado === 'Abierta' || op.estado === 'En_Viaje');
    if(ops.length === 0) {
        sel.innerHTML = '<option value="">— No hay operaciones activas —</option>';
    } else {
        sel.innerHTML = '<option value="">— Selecciona —</option>' +
            ops.map(op => `<option value="${op.id}">${op.bote} · ${op.hora_salida || 'S/H'} · ${op.ocupados}/${op.capacidad} PAX · ${op.estado}</option>`).join('');
    }
}

function cerrarOperacion() {
    let id_operacion = document.getElementById('select-cierre-op')?.value;
    if(!id_operacion) return alert('❌ Selecciona primero la operación a cerrar.');
    if(!confirm('¿Confirmas el CIERRE y LIQUIDACIÓN de esta operación? Esta acción no se puede deshacer.')) return;

    toggleSpinner(true);
    fetchPost('cerrar_operacion', { id_operacion, creador: myOpName })
        .then(res => {
            toggleSpinner(false);
            if(res.status === 'error') return;
            // Mostrar resultado de liquidación
            let total = res.liquidacion ? res.liquidacion.total_a_entregar : 0;
            let result = document.getElementById('pdf-result');
            if(result) {
                result.classList.remove('hidden');
                result.innerHTML = `
                <i class="fas fa-check-circle text-4xl text-green-500 mb-3 block drop-shadow-sm"></i>
                <h3 class="font-extrabold text-green-800 text-lg mb-1">¡Turno Cerrado!</h3>
                <p class="text-sm text-gray-600 mb-3">Total a entregar: <span class="font-black text-green-700 text-xl">S/ ${parseFloat(total).toFixed(2)}</span></p>`;
            }
            // Actualizar datos
            fetchDashboardData();
        });
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
            let destino = p.aliadoDestino || p.contacto || '';
            let nombre  = p.nombreContacto || p.contacto || '';
            let ts      = p.timestamp ? new Date(p.timestamp).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : '';
            return `
            <tr class="border-t border-gray-100 cursor-pointer hover:bg-purple-50 transition" onclick="verDetallePase(${idx})">
                <td class="py-2 px-2">
                    <span class="text-[10px] font-bold text-gray-800 block uppercase">${nombre}</span>
                    <span class="text-[9px] text-purple-500 font-bold">→ ${destino}</span>
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
                    <th class="py-1.5 px-2 text-left font-bold">Contacto → Aliado</th>
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
            <div class="mt-2 w-full">
                <button class="w-full bg-orange-100 text-orange-800 font-bold py-2.5 rounded-xl border border-orange-200 hover:bg-orange-200 shadow-sm transition active:scale-95 text-xs flex items-center justify-center" onclick="abrirModalGestionBote('${op.id}')">
                    <i class="fas fa-clipboard-list mr-1.5"></i> Ver Manifiesto
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
    let container = document.getElementById('tab-caja');
    if(!container) return;

    let hoy = getHoyLocal();
    let txHoy = caja.filter(c => esFechaHoy(c.timestamp));

    let ingresos = 0;
    let salidas = 0;

    let html = txHoy.map(c => {
        let monto = parseFloat(c.monto) || 0;
        let esIngreso = ['Caja Chica', 'Ingreso por Venta', 'Ingreso_Venta', 'Caja_Chica'].includes(c.categoria);
        let isPase = c.metodo_pago === 'Pase_Canje' || c.metodo_pago === 'Pase / Canje';
        
        let colorText = isPase ? 'text-purple-600' : (esIngreso ? 'text-green-600' : 'text-red-600');
        let signo = isPase ? '🤝' : (esIngreso ? '+' : '-');
        
        if(!isPase) {
            if(esIngreso) ingresos += monto;
            else salidas += monto;
        }

        return `
        <div class="flex justify-between items-center bg-white p-4 rounded-2xl mb-3 shadow-sm border border-gray-100 cursor-pointer hover:bg-gray-50 transition active:scale-95" onclick="abrirDetalleCaja('${c.id}')">
            <div>
                <span class="text-sm font-extrabold text-gray-800 tracking-tight block flex items-center"><i class="fas fa-circle text-[8px] ${esIngreso ? 'text-green-400' : 'text-red-400'} mr-2"></i> ${c.categoria.replace('_',' ')}</span>
                <span class="text-[10px] text-gray-500 block font-bold mt-1">${new Date(c.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} • ${c.metodo_pago || 'Efectivo'}</span>
            </div>
            <span class="font-black ${colorText}">${signo} S/ ${monto.toFixed(2)}</span>
        </div>`;
    }).join('');

    let saldo = ingresos - salidas;
    
    // Calcular Estado de Pases
    let resumenPases = {};
    if(window.operacionesData) {
        window.operacionesData.forEach(op => {
            if(op.fecha === hoy || !op.fecha) {
                op.manifiesto.forEach(m => {
                    if(m.tipo === 'Pase_Recibido') {
                        if(!resumenPases[m.contacto]) resumenPases[m.contacto] = { recibidos: 0, emitidos: 0 };
                        resumenPases[m.contacto].recibidos += parseInt(m.pax);
                    }
                    if(m.estado && m.estado.includes('Pase Emitido a ')) {
                        let aliado = m.estado.replace('Pase Emitido a ', '').trim();
                        if(!resumenPases[aliado]) resumenPases[aliado] = { recibidos: 0, emitidos: 0 };
                        resumenPases[aliado].emitidos += parseInt(m.pax);
                    }
                });
            }
        });
    }

    if(window.pasesExternosData) {
        window.pasesExternosData.forEach(m => {
            if(m.estado && m.estado.includes('Pase Emitido a ')) {
                if(esFechaHoy(m.timestamp)) {
                    let aliado = m.estado.replace('Pase Emitido a ', '').trim();
                    if(!resumenPases[aliado]) resumenPases[aliado] = { recibidos: 0, emitidos: 0 };
                    resumenPases[aliado].emitidos += parseInt(m.pax);
                }
            }
        });
    }

    let pasesHtml = Object.keys(resumenPases).map(aliado => {
        let r = resumenPases[aliado].recibidos;
        let e = resumenPases[aliado].emitidos;
        let saldoPax = r - e; // Si > 0, nos llenaron el bote (le debemos). Si < 0 (favor nuestro).
        // En tu logica: Recibido = Aliado nos metió PAX (nos debe). Emitido = Nosotros le metimos PAX (les debemos).
        // Wait: User said "ingresaron por pase 5 pax de aliado A ... me deben 5 pax".
        // Entonces Recibidos = Favor nuestro (positivo). Emitidos = Favor en contra (negativo).
        
        return `
        <div class="flex items-center justify-between bg-white border border-purple-100 p-3 rounded-xl mb-2">
            <div>
                <span class="font-bold text-gray-700 text-xs uppercase">${aliado}</span>
                <div class="flex space-x-3 mt-1 text-[10px]">
                    <span class="text-green-600 font-bold"><i class="fas fa-arrow-down mr-1"></i> A nuestro favor: ${r} PAX</span>
                    <span class="text-red-500 font-bold"><i class="fas fa-arrow-up mr-1"></i> A su favor: ${e} PAX</span>
                </div>
            </div>
            <div class="text-right">
                <span class="text-[9px] uppercase tracking-widest text-gray-400 font-bold block mb-0.5">Saldo Final</span>
                <span class="font-black ${saldoPax >= 0 ? 'text-green-600' : 'text-red-500'} text-sm">${saldoPax >= 0 ? '+' : ''}${saldoPax} PAX</span>
            </div>
        </div>`;
    }).join('');

    if(!pasesHtml) pasesHtml = '<div class="text-[11px] text-gray-400 text-center py-4 bg-gray-50 rounded-xl font-bold border border-dashed border-gray-200">No hay pases registrados hoy.</div>';
    
    let headerHtml = `
    <h2 class="font-bold text-gray-700 mb-4 block"><i class="fas fa-coins text-yellow-500 mr-2"></i> Finanzas de Hoy</h2>
    
    <div class="bg-gradient-to-br from-blue-600 to-indigo-800 rounded-3xl p-6 mb-6 shadow-xl relative overflow-hidden">
        <i class="fas fa-wallet absolute -right-6 -bottom-6 text-8xl text-white opacity-10"></i>
        <p class="text-blue-100 text-[10px] font-bold uppercase tracking-widest mb-1">Balance Efectivo/Digital</p>
        <h3 class="text-4xl font-black text-white mb-4 shadow-sm">S/ ${saldo.toFixed(2)}</h3>
        <div class="flex space-x-3 bg-white/10 rounded-2xl p-3 backdrop-blur-sm border border-white/20">
            <div class="flex-1">
                <p class="text-green-300 text-[9px] font-bold uppercase tracking-wider mb-0.5"><i class="fas fa-arrow-down mr-1"></i> Entradas</p>
                <p class="text-white font-bold text-xs truncate">+ S/ ${ingresos.toFixed(2)}</p>
            </div>
            <div class="w-px bg-white/20"></div>
            <div class="flex-1 text-right">
                <p class="text-red-300 text-[9px] font-bold uppercase tracking-wider mb-0.5"><i class="fas fa-arrow-up mr-1"></i> Salidas</p>
                <p class="text-white font-bold text-xs truncate">- S/ ${salidas.toFixed(2)}</p>
            </div>
        </div>
    </div>
    
    <h3 class="font-extrabold text-gray-800 text-xs mb-3 uppercase tracking-wider flex items-center"><i class="fas fa-handshake mr-2 text-purple-500"></i> Balance de Pases (Favores)</h3>
    <div class="mb-6">
        ${pasesHtml}
    </div>
    
    <div class="grid grid-cols-2 gap-4 mb-6">

        <button class="bg-green-50 text-green-700 p-4 rounded-3xl flex flex-col items-center justify-center border border-green-200 shadow-sm transition hover:bg-green-100 active:scale-95" onclick="abrirModalCaja('Caja Chica')">
            <div class="bg-green-100/50 p-3 rounded-full mb-1"><i class="fas fa-plus text-xl"></i></div>
            <span class="font-black text-xs uppercase tracking-wider">Caja Chica</span>
        </button>
        <button class="bg-red-50 text-red-700 p-4 rounded-3xl flex flex-col items-center justify-center border border-red-200 shadow-sm transition hover:bg-red-100 active:scale-95" onclick="abrirModalCaja('Retiro Jefatura')">
            <div class="bg-red-100/50 p-3 rounded-full mb-1"><i class="fas fa-minus text-xl"></i></div>
            <span class="font-black text-xs uppercase tracking-wider">Retiro</span>
        </button>
    </div>
    
    <h3 class="font-extrabold text-gray-800 text-xs mb-3 uppercase tracking-wider flex items-center"><i class="fas fa-list-ul mr-2 text-blue-500"></i> Historial Turno</h3>
    <div id="lista-historial-caja" class="pb-10">
        ${html || '<div class="text-center p-6 bg-gray-50 rounded-2xl text-gray-400 font-bold border-2 border-dashed border-gray-200"><i class="fas fa-receipt text-3xl mb-2 opacity-30 block"></i> No hay movimientos hoy.</div>'}
    </div>
    `;

    container.innerHTML = headerHtml;
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
            ${!isAliado ? `<button class="flex-1 min-w-[70px] bg-green-500 text-white text-[11px] font-bold py-2 rounded-xl shadow-md shadow-green-500/30 hover:bg-green-600 transition" onclick="abrirModalCaja('Ingreso_Venta', '${m.id}', ${m.monto}); event.stopPropagation();"><i class="fas fa-money-bill-wave mr-1"></i> Cobrar</button>` : ''}
            ${isAgencia ? `<button class="bg-blue-100 text-blue-700 text-[11px] font-bold px-3 py-2 rounded-xl border border-blue-200 hover:bg-blue-200 transition" onclick="abrirModalImpuestos('${m.id}', '${m.contacto}'); event.stopPropagation();"><i class="fas fa-file-invoice-dollar mr-1"></i> Adicionales</button>` : ''}
            ${m.tipo !== 'Aliado(PaseOut)' ? `<button class="flex-1 min-w-[60px] bg-purple-500 text-white text-[11px] font-bold py-2 rounded-xl shadow-md shadow-purple-500/30 hover:bg-purple-600 transition" onclick="abrirModalDerivar('${m.id}', '${m.pax}'); event.stopPropagation();"><i class="fas fa-people-carry mr-1"></i> Pasar</button>` : ''}
            <button class="bg-red-100 text-red-600 text-[11px] font-bold px-3 py-2 rounded-xl border border-red-200 hover:bg-red-200 transition" onclick="eliminarMovimiento('${m.id}', '${m.pax}'); event.stopPropagation();"><i class="fas fa-trash-alt"></i></button>
        </div>` : '';

        // Monto display según tipo
        let montoDisplay = isAliado
            ? `<span class="text-[10px] font-black text-purple-500 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">PASE</span>`
            : `<span class="text-[10px] text-gray-500 block font-bold">S/ ${parseFloat(m.monto||0).toFixed(2)}</span>`;

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
function abrirModalCaja(tipo, id_ref = '', propMonto = '') {
    document.getElementById('caja-categoria').value = tipo;
    document.getElementById('caja-id-referencia').value = id_ref;
    document.getElementById('caja-monto').value = propMonto;
    
    // Forzar deshabilitar categoria si es Ingreso por Venta
    let catEl = document.getElementById('caja-categoria');
    if(tipo === 'Ingreso_Venta') { catEl.setAttribute('disabled', 'true'); } else { catEl.removeAttribute('disabled'); }

    abrirModal('modal-caja');
}

function confirmarCaja() {
    let cat = document.getElementById('caja-categoria').value;
    let monto = document.getElementById('caja-monto').value;
    let metodo = document.getElementById('caja-metodo').value;
    let ref = document.getElementById('caja-id-referencia').value;

    if(!monto || isNaN(monto) || monto <= 0) return alert('Ingresa un monto válido.');
    
    cerrarSubModal('modal-caja'); toggleSpinner(true);
    fetchPost('registrar_caja_v2', { categoria: cat, monto: parseFloat(monto), metodo_pago: metodo, referencia: ref, operador: myOpName }).then(() => fetchDashboardData());
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

function abrirDetalleCaja(id_tx) {
    let tx = window.cajaData.find(c => c.id === id_tx);
    if(!tx) return;
    
    let esIngreso = ['Caja Chica', 'Ingreso por Venta', 'Ingreso_Venta', 'Caja_Chica'].includes(tx.categoria);
    let isPase = tx.metodo_pago === 'Pase_Canje' || tx.metodo_pago === 'Pase / Canje';
    
    let icono = document.getElementById('detalle-caja-icono');
    let boxCat = document.getElementById('detalle-caja-cat');
    let signo = isPase ? '🤝' : (esIngreso ? '+' : '-');
    
    if(isPase) {
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
    
    document.getElementById('detalle-caja-id').innerText = tx.id;
    boxCat.innerText = tx.categoria.replace('_', ' ');
    document.getElementById('detalle-caja-metodo').innerText = tx.metodo_pago || 'Efectivo';
    document.getElementById('detalle-caja-op').innerText = tx.operador || 'Sistema';
    
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
    toast.style.background = tipo === 'error' ? '#fee2e2' : '#dbeafe';
    toast.style.color = tipo === 'error' ? '#991b1b' : '#1e40af';
    toast.style.border = tipo === 'error' ? '1px solid #fca5a5' : '1px solid #93c5fd';
    toast.style.opacity = '1';
    toast.innerText = msg;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
}
function toggleSpinner(show) { const s = document.getElementById('global-spinner'); const u = document.getElementById('btn-refresh'); if(show) { s.classList.remove('hidden'); u.classList.add('hidden'); } else { s.classList.add('hidden'); u.classList.remove('hidden'); } }
