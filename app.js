const GAS_URL = 'https://script.google.com/macros/s/AKfycbzi5aD18Xj0ikbQJZkiMSjZPkMg3HVFneL6XTEirRVg2MISZyDN-tTc-0OuUkakGXYWHw/exec';

let myOpName = localStorage.getItem('sot_operador');
if(!myOpName) {
    myOpName = prompt("Para empezar, ingresa tu Nombre u Operador (Ej: Operador 1, Luis):") || "Operador X";
    localStorage.setItem('sot_operador', myOpName);
}

let pendingPostRequests = 0;

document.addEventListener('DOMContentLoaded', () => {
    fetchDashboardData();
    setInterval(fetchDashboardDataBg, 15000);
});

function getHoyLocal() {
    let tzoffset = (new Date()).getTimezoneOffset() * 60000;
    return (new Date(Date.now() - tzoffset)).toISOString().split('T')[0];
}

function switchTab(tabId, title, btnElement) {
    const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => tab.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => item.classList.remove('active', 'red-tab'));
    btnElement.classList.add('active');
    if(tabId === 'tab-cierre') btnElement.classList.add('red-tab');
    document.getElementById('app-title').innerText = title;
}

function fetchDashboardData() {
    toggleSpinner(true);
    fetch(GAS_URL + "?action=getDashboardData")
        .then(res => res.json())
        .then(data => {
            toggleSpinner(false);
            if(data.status === 'error') return console.error("Error backend:", data.error);
            window.operacionesData = data.operaciones_abiertas || [];
            window.contactosData = data.catalogos ? data.catalogos.contactos : [];
            window.reservasData = data.sala_de_espera || [];
            
            renderCatalogos(data.catalogos);
            renderOperaciones(window.operacionesData);
            renderReservas(window.reservasData);
            renderCaja(data.movimientos_dia);
        })
        .catch(err => {
            toggleSpinner(false);
            console.error("Hubo un error cargando los datos:", err);
        });
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
            window.operacionesData = data.operaciones_abiertas || [];
            window.contactosData = data.catalogos ? data.catalogos.contactos : [];
            window.reservasData = data.sala_de_espera || [];
            
            renderCatalogos(data.catalogos);
            renderOperaciones(window.operacionesData);
            renderReservas(window.reservasData);
            renderCaja(data.movimientos_dia);
            let isModalOpen = !document.getElementById('modal-gestion-bote').classList.contains('hidden');
            let opId = document.getElementById('hidden-gestion-op').value;
            if(isModalOpen && opId) {
                let op = window.operacionesData.find(o => o.id === opId);
                if(op) {
                   document.getElementById('gestion-pax-total').innerText = op.ocupados;
                   document.getElementById('gestion-manifiesto-lista').innerHTML = generarListaHTML(op.manifiesto);
                }
            }
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
                <span class="bg-white border text-gray-800 text-xs px-2.5 py-1 rounded-full font-bold shadow-sm ml-2 shrink-0">${op.ocupados} / ${op.capacidad} PAX</span>
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
    }).join('');
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
        let isSyncing = res.id === 'Creando...';
        let f = String(res.fecha).trim();
        let isHoy = f === hoy || f === formatLocal || !res.fecha;
        let isFutureForMe = !isHoy && !isSyncing;
        
        let cardClasses = isSyncing ? "bg-yellow-50 border-yellow-300 border-l-[4px] opacity-90 animate-pulse border-y border-r" : (isFutureForMe ? "opacity-60 grayscale bg-gray-50 border-gray-200 border" : "bg-white border-blue-500 border-l-[4px] border-y border-r border-y-gray-100 border-r-gray-100");
        let btnClasses = isSyncing ? "pointer-events-none bg-yellow-400 text-white font-bold" : (isFutureForMe ? "pointer-events-none opacity-50 bg-gray-300 border-gray-300 text-gray-500" : "bg-green-500 text-white shadow-md shadow-green-500/20 hover:bg-green-600 border-green-600");
        let btnIcon = isSyncing ? "fa-sync-alt fa-spin" : (isFutureForMe ? "fa-lock" : "fa-clipboard-check");
        let btnText = isSyncing ? "Registrando..." : (isFutureForMe ? "No disponible hoy" : "Abordar Lancha");
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
            </div>
        </div>
        `;
    }).join('');
}

function renderCaja(movimientos) {
    const container = document.getElementById('caja-historial-container');
    if(!movimientos || movimientos.length === 0) {
        container.innerHTML = `<div class="px-4 py-5 text-center text-sm text-gray-500">Sin movimientos.</div>`;
        return;
    }
    container.innerHTML = movimientos.map(mov => {
        let isIngreso = parseFloat(mov.monto) > 0 || mov.tipo === 'Caja_Chica';
        let clsTxt = isIngreso ? 'text-green-600' : 'text-red-500';
        let clsBg = isIngreso ? 'bg-green-50' : 'bg-red-50';
        let signo = isIngreso ? '+' : '-';
        return `
        <div class="px-5 py-3.5 flex justify-between items-center border-b border-gray-100 bg-white">
            <div>
                <p class="font-bold text-gray-800 text-sm">${mov.tipo.replace('_', ' ')}</p>
                <p class="text-[10px] text-gray-400 font-bold uppercase tracking-wide mt-0.5">${mov.hora}</p>
            </div>
            <span class="${clsTxt} font-black ${clsBg} px-2.5 py-1 rounded-xl shadow-sm text-sm border border-gray-100">${signo} S/ ${Math.abs(mov.monto).toFixed(2)}</span>
        </div>
        `;
    }).join('');
}

function renderCatalogos(cats) {
    if(!cats) return;
    const selBote = document.getElementById('select-bote-id');
    const selCap = document.getElementById('select-capitan-id');
    const selGuia = document.getElementById('select-guia-id');
    
    selBote.innerHTML = '<option value="">- Lancha -</option>' + 
        (cats.botes.length ? cats.botes.map(b => `<option value="${b.id}">${b.nombre} (${b.cap} px)</option>`).join('') : '<option value="" disabled>Todos Ocupados</option>');
    selCap.innerHTML = '<option value="">- Capitán -</option>' + 
        (cats.capitanes.length ? cats.capitanes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('') : '<option value="" disabled>Ninguno disp.</option>');
    selGuia.innerHTML = '<option value="">- Guía -</option>' + 
        (cats.guias.length ? cats.guias.map(g => `<option value="${g.id}">${g.nombre}</option>`).join('') : '<option value="" disabled>Libres</option>');
}

function abrirModal(id) {
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById(id).classList.remove('hidden');
    
    if(id === 'modal-nueva-reserva') {
        document.getElementById('input-crm-fecha').value = getHoyLocal();
        cambiarTipoCRM();
        setTimeout(actualizarHoraSugeridaCRM, 50);
    } else if (id === 'modal-abrir-bote') {
        let selectHora = document.getElementById('select-bote-hora');
        if(selectHora) {
            let suggested = obtenerHoraSugerida();
            let found = Array.from(selectHora.options).find(opt => opt.value === suggested);
            if(found) selectHora.value = suggested; else selectHora.selectedIndex = 0;
        }
    }
}

function cerrarModales() {
    document.getElementById('modal-backdrop').classList.add('hidden');
    document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
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

    let opTemp = {
        id: 'Creando...', bote: boteNombre, capacidad: cap, ocupados: 0,
        estado: 'Abierta', capitan: selectCap.options[selectCap.selectedIndex].text,
        guia: selectGuia.value ? selectGuia.options[selectGuia.selectedIndex].text : 'Sin Guía',
        hora_salida: hora_salida, manifiesto: []
    };
    window.operacionesData.unshift(opTemp);
    renderOperaciones(window.operacionesData);
    cerrarModales();

    fetchPostBg('abrir_operacion', { id_bote, id_capitan, id_guia, hora_salida, creador: myOpName }).then(() => fetchDashboardDataBg());
}

function confirmarZarpe(id_op) {
    if(!confirm("¿Seguro que deseas ZARPAR esta lancha? Pasará a estado En Viaje.")) return;
    toggleSpinner(true);
    // Optimistic UI update
    let opIndex = window.operacionesData.findIndex(o => o.id === id_op);
    if(opIndex !== -1) {
        window.operacionesData[opIndex].estado = 'En_Viaje';
        renderOperaciones(window.operacionesData);
    }
    fetchPost('zarpar_operacion', { id_operacion: id_op }).then(res => {
        if(res.status === 'error') alert(res.message);
        fetchDashboardData();
    });
}

// ==========================
// VENTA DIRECTA (MUELLE)
// ==========================
function generarListaHTML(manifiesto) {
    if(!manifiesto || manifiesto.length === 0) return '<div class="text-center p-6 bg-white ..."><p>Lancha vacía.</p></div>';
    return manifiesto.map(m => {
        let isEditado = m.estado && m.estado.includes('(Editado)');
        let isSyncing = m.estado && m.estado.includes('Sincronizando');
        let bgClass = isEditado ? 'bg-orange-50' : 'bg-white';
        let opacityClass = isSyncing ? 'opacity-50 animate-pulse pointer-events-none' : '';
        let iconoEdicion = isEditado ? `<i class="fas fa-pen text-[9px] text-orange-400 ml-1"></i>` : '';
        let iconoSinc = isSyncing ? `<i class="fas fa-sync-alt fa-spin text-[9px] text-blue-400 ml-1"></i>` : '';
        
        let subBtns = m.tipo === 'Pase_Recibido' ? '' : `
        <div class="flex space-x-1 mt-2">
            <button class="flex-1 bg-green-100 text-green-700 text-[9px] font-bold py-1.5 rounded-lg border border-green-200 hover:bg-green-200" onclick="abrirModalCaja('Ingreso_Venta', '${m.id}', ${m.monto}); event.stopPropagation();"><i class="fas fa-money-bill-wave mr-1"></i> Pagar</button>
            <button class="flex-1 bg-purple-100 text-purple-700 text-[9px] font-bold py-1.5 rounded-lg border border-purple-200 hover:bg-purple-200" onclick="abrirModalDerivar('${m.id}', '${m.pax}'); event.stopPropagation();"><i class="fas fa-share-square mr-1"></i> Derivar</button>
        </div>`;

        return `
        <div class="flex flex-col ${bgClass} ${opacityClass} border border-gray-200 p-3 rounded-xl cursor-pointer hover:bg-blue-50 transition shadow-sm mb-2" onclick="cargarParaEditar('${m.id}')">
            <div class="flex justify-between items-center">
                <div>
                    <span class="text-xs font-bold text-gray-800 uppercase block">${m.contacto} ${iconoEdicion} ${iconoSinc}</span>
                    <span class="text-[10px] text-gray-500 font-bold">${m.tipo.replace('_',' ')}</span>
                </div>
                <div class="text-right">
                    <span class="font-black text-blue-600 text-sm">${m.pax} PAX</span>
                    <span class="text-[10px] text-gray-500 block font-bold">S/ ${parseFloat(m.monto).toFixed(2)}</span>
                </div>
            </div>
            ${subBtns}
        </div>`;
    }).join('');
}

function abrirModalGestionBote(id_op) {
    let op = window.operacionesData.find(o => o.id === id_op);
    if(!op || op.id === 'Creando...') return;
    
    let nodeH3 = document.getElementById('gestion-bote-nombre');
    if(nodeH3.childNodes[0].nodeType === 3) nodeH3.childNodes[0].nodeValue = op.bote + " ";
    document.getElementById('gestion-bote-aforo').innerText = `${op.ocupados} / ${op.capacidad} PAX`;
    
    document.getElementById('hidden-gestion-op').value = op.id;
    document.getElementById('gestion-pax-total').innerText = op.ocupados;
    document.getElementById('gestion-manifiesto-lista').innerHTML = generarListaHTML(op.manifiesto);
    
    let boxVenta = document.getElementById('box-formulario-venta');
    if(op.estado === 'En_Viaje') {
        boxVenta.classList.add('hidden');
    } else {
        boxVenta.classList.remove('hidden');
    }

    resetFormularioVenta();
    abrirModal('modal-gestion-bote');
}

function cambiarTipoVentaDirecta() {
    let tipo = document.getElementById('input-vd-tipo').value;
    let container = document.getElementById('container-contacto-input');
    if(tipo === 'Agencia' || tipo === 'Pase_Recibido') {
        let options = window.contactosData.map(c => `<option value="${c.nombre}">${c.nombre} (S/ ${c.precio})</option>`).join('');
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Aliado/Agencia</label><select id="input-vd-contacto-select" class="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-[11px] font-bold text-gray-800 shadow-sm mt-0.5 outline-none" onchange="actualizarPrecioDefecto()"><option value="">Seleccionar...</option>${options}</select>`;
    } else {
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Familia/Apellido</label><input type="text" id="input-vd-contacto-text" class="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs focus:outline-blue-500 shadow-sm mt-0.5 uppercase" placeholder="Ej: Familia Vasquez">`;
    }
    actualizarPrecioDefecto();
}

function actualizarPrecioDefecto() {
    let tipo = document.getElementById('input-vd-tipo').value;
    let pax = parseInt(document.getElementById('input-vd-pax').value) || 0;
    if((tipo === 'Agencia' || tipo === 'Pase_Recibido') && pax > 0) {
        let select = document.getElementById('input-vd-contacto-select');
        if(select && select.value) {
            let info = window.contactosData.find(c => c.nombre === select.value);
            if(info) document.getElementById('input-vd-precio').value = (info.precio * pax).toFixed(2);
        }
    }
}

function resetFormularioVenta() {
    document.getElementById('hidden-vd-idmov').value = '';
    document.getElementById('input-vd-tipo').value = 'Directo';
    cambiarTipoVentaDirecta(); 
    document.getElementById('input-vd-pax').value = '';
    document.getElementById('input-vd-precio').value = '';
    document.getElementById('titulo-form-venta').innerHTML = `<i class="fas fa-bolt text-yellow-500 text-sm mr-1"></i> Nuevo Embarque`;
    let btnSubmit = document.getElementById('btn-submit-venta');
    btnSubmit.innerHTML = `<i class="fas fa-arrow-up mr-2 text-base"></i> Subir al Bote`;
    btnSubmit.className = "w-full mt-3 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-black p-3.5 rounded-xl shadow-lg transition flex items-center justify-center uppercase text-xs tracking-wider border border-blue-700";
    document.getElementById('btn-cancelar-edicion').classList.add('hidden');
    document.getElementById('box-formulario-venta').classList.remove('border-orange-300', 'bg-orange-50');
    document.getElementById('box-formulario-venta').classList.add('border-blue-200', 'bg-blue-50');
}

function cargarParaEditar(id_mov) {
    let movToEdit = null;
    for(let op of window.operacionesData) {
        let m = op.manifiesto.find(x => x.id === id_mov);
        if(m) { movToEdit = m; break; }
    }
    if(!movToEdit || movToEdit.id.startsWith('temp-')) return;
    document.getElementById('hidden-vd-idmov').value = movToEdit.id;
    document.getElementById('input-vd-tipo').value = movToEdit.tipo;
    cambiarTipoVentaDirecta(); 
    if(movToEdit.tipo === 'Agencia' || movToEdit.tipo === 'Pase_Recibido') {
        let s = document.getElementById('input-vd-contacto-select');
        if(s) s.value = movToEdit.contacto;
    } else {
        let t = document.getElementById('input-vd-contacto-text');
        if(t) t.value = movToEdit.contacto;
    }
    document.getElementById('input-vd-pax').value = movToEdit.pax;
    document.getElementById('input-vd-precio').value = movToEdit.monto;
    
    document.getElementById('titulo-form-venta').innerHTML = `<i class="fas fa-pen text-orange-500 text-sm mr-1"></i> Editando Registro`;
    document.getElementById('btn-cancelar-edicion').classList.remove('hidden');
    let box = document.getElementById('box-formulario-venta');
    box.classList.remove('border-blue-200', 'bg-blue-50'); box.classList.add('border-orange-300', 'bg-orange-50');
    let btnSubmit = document.getElementById('btn-submit-venta');
    btnSubmit.innerHTML = `<i class="fas fa-save mr-2 text-base"></i> Actualizar`;
    btnSubmit.className = "w-full mt-3 bg-orange-500 hover:bg-orange-600 active:scale-95 text-white font-black p-3.5 rounded-xl shadow-lg transition border border-orange-600 uppercase text-xs";
}

function confirmarVentaDirecta() {
    let id_op = document.getElementById('hidden-gestion-op').value;
    let id_mov = document.getElementById('hidden-vd-idmov').value;
    let tipo = document.getElementById('input-vd-tipo').value;
    let pax = document.getElementById('input-vd-pax').value.trim();
    let precio = document.getElementById('input-vd-precio').value.trim();
    let contacto = tipo === 'Directo' ? document.getElementById('input-vd-contacto-text')?.value.trim().toUpperCase() : document.getElementById('input-vd-contacto-select')?.value;
    
    if(!contacto || !pax || !precio) return alert("❌ Cliente/Agencia, Pax y Precio total son obligatorios.");
    if(parseFloat(pax) <= 0) return alert("❌ Cantidad de pasajeros errónea.");
    
    let opIndex = window.operacionesData.findIndex(o => o.id === id_op);
    if(opIndex !== -1) {
        let currentOp = window.operacionesData[opIndex];
        let requestedDelta = id_mov ? (parseInt(pax) - parseInt(currentOp.manifiesto.find(m => m.id === id_mov).pax)) : parseInt(pax);
        if(currentOp.ocupados + requestedDelta > currentOp.capacidad) return alert(`❌ ¡El bote no tiene capacidad suficiente!`);

        if(id_mov) {
            let movIndex = currentOp.manifiesto.findIndex(m => m.id === id_mov);
            if(movIndex !== -1) {
                currentOp.ocupados += requestedDelta;
                currentOp.manifiesto[movIndex] = { id: id_mov, tipo, contacto, pax, monto: parseFloat(precio).toFixed(2), estado: 'Embarcado (Editado) (Sincronizando)' };
            }
        } else {
            currentOp.ocupados += requestedDelta;
            currentOp.manifiesto.unshift({ id: 'temp-' + Date.now(), tipo, contacto, pax, monto: parseFloat(precio).toFixed(2), estado: 'Embarcado (Sincronizando)' });
        }
        document.getElementById('gestion-pax-total').innerText = currentOp.ocupados;
        document.getElementById('gestion-bote-aforo').innerText = `${currentOp.ocupados} / ${currentOp.capacidad} PAX`;
        document.getElementById('gestion-manifiesto-lista').innerHTML = generarListaHTML(currentOp.manifiesto);
        renderOperaciones(window.operacionesData);
    }
    resetFormularioVenta(); 

    let endpoint = id_mov ? 'editar_movimiento_pax' : 'registrar_movimiento_pax';
    let payload = { id_operacion: id_op, tipo: tipo, contacto: contacto, pax: pax, precio_unitario: (parseFloat(precio)/parseFloat(pax)).toFixed(2), monto_total: parseFloat(precio), creador: myOpName };
    if(id_mov) payload.id_mov = id_mov;
    
    fetchPostBg(endpoint, payload).then(res => {
        if(res.status === 'error') alert(res.message);
        fetchDashboardDataBg();
    });
}

// ==========================
// FORMULARIO CRM RESERVAS
// ==========================
function cambiarTipoCRM() {
    let tipo = document.getElementById('input-crm-tipo').value;
    let container = document.getElementById('container-crm-contacto');
    if(tipo === 'Agencia' || tipo === 'Pase_Recibido') {
        let options = window.contactosData.map(c => `<option value="${c.nombre}">${c.nombre} (S/ ${c.precio})</option>`).join('');
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Aliado / Agencia</label><select id="input-crm-contacto-select" class="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-[11px] font-bold text-gray-800 shadow-sm mt-0.5 outline-none" onchange="actualizarPrecioDefectoCRM()"><option value="">Seleccionar...</option>${options}</select>`;
    } else {
        container.innerHTML = `<label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Familia / Apellido</label><input type="text" id="input-crm-contacto-text" class="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs focus:outline-blue-500 shadow-sm mt-0.5 uppercase" placeholder="Ej: Familia Vasquez">`;
    }
    actualizarPrecioDefectoCRM();
}

function actualizarPrecioDefectoCRM() {
    let tipo = document.getElementById('input-crm-tipo').value;
    let pax = parseInt(document.getElementById('input-crm-pax').value) || 0;
    if((tipo === 'Agencia' || tipo === 'Pase_Recibido') && pax > 0) {
        let select = document.getElementById('input-crm-contacto-select');
        if(select && select.value) {
            let info = window.contactosData.find(c => c.nombre === select.value);
            if(info) document.getElementById('input-crm-precio').value = (info.precio * pax).toFixed(2);
        }
    }
}

function confirmarNuevaReserva() {
    let fecha = document.getElementById('input-crm-fecha').value;
    let hora = document.getElementById('input-crm-hora').value || "Libre";
    let tipo = document.getElementById('input-crm-tipo').value;
    let pax = document.getElementById('input-crm-pax').value.trim();
    let precio = document.getElementById('input-crm-precio').value.trim();
    let contacto = tipo === 'Directo' ? document.getElementById('input-crm-contacto-text')?.value.trim().toUpperCase() : document.getElementById('input-crm-contacto-select')?.value;
    
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
    let id_reserva = document.getElementById('hidden-reserva-id').value;
    let pax = document.getElementById('hidden-reserva-pax').value;
    let contacto = document.getElementById('hidden-reserva-agencia').value;
    let id_operacion = document.getElementById('select-asignar-op').value.trim();
    if(!id_operacion) return alert("❌ Selecciona a qué lancha subirán los pasajeros.");
    cerrarModales(); toggleSpinner(true);
    fetchPost('asignar_reserva', { id_reserva, id_operacion, cant_pax: pax, id_contacto: contacto, creador: myOpName }).then(res => {
        if(res.status==='error') alert(res.message);
        fetchDashboardData();
    });
}

function registrarCajaRapida(tipo) {
    let m = prompt(`💰 Ingrese el MONTO EXACTO de efectivo para:\n▶ ${tipo}`);
    if(m && !isNaN(m)) { toggleSpinner(true); fetchPost('registrar_caja', { categoria: tipo.replace(' ', '_'), monto: parseFloat(m), metodo_pago: 'Efectivo', operador: myOpName }).then(() => fetchDashboardData()); }
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
    
    cerrarModales(); toggleSpinner(true);
    fetchPost('registrar_caja_v2', { categoria: cat, monto: parseFloat(monto), metodo_pago: metodo, referencia: ref, operador: myOpName }).then(() => fetchDashboardData());
}

function abrirModalDerivar(id_mov, pax) {
    document.getElementById('hidden-derivar-idmov').value = id_mov;
    document.getElementById('derivar-pax').innerText = pax;
    
    let select = document.getElementById('select-derivar-aliado');
    if(window.contactosData) {
        select.innerHTML = '<option value="">- Elige Aliado -</option>' + window.contactosData.map(c => `<option value="${c.nombre}">${c.nombre}</option>`).join('');
    }
    abrirModal('modal-derivar');
}

function confirmarDerivacion() {
    let id_mov = document.getElementById('hidden-derivar-idmov').value;
    let aliado = document.getElementById('select-derivar-aliado').value;
    let id_op = document.getElementById('hidden-gestion-op').value;
    if(!aliado) return alert("Selecciona a quién se le emite el Pase.");

    cerrarModales(); toggleSpinner(true);
    fetchPost('derivar_pase', { id_mov, aliado, id_operacion_origen: id_op, operador: myOpName }).then(() => fetchDashboardData());
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
    return fetch(GAS_URL, { method: 'POST', redirect: 'follow', body: JSON.stringify({ action: action, payload: payload }), headers: {'Content-Type': 'text/plain;charset=utf-8'} }).then(res => res.json()).then(d => { pendingPostRequests--; if(refreshIcon) refreshIcon.classList.remove('fa-spin', 'text-yellow-400'); return d; }).catch(err => { pendingPostRequests--; if(refreshIcon) refreshIcon.classList.remove('fa-spin', 'text-yellow-400'); return { status: 'error', message: 'Error de conexión' }; }); 
}
function toggleSpinner(show) { const s = document.getElementById('global-spinner'); const u = document.getElementById('btn-refresh'); if(show) { s.classList.remove('hidden'); u.classList.add('hidden'); } else { s.classList.add('hidden'); u.classList.remove('hidden'); } }

