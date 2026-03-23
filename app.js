const GAS_URL = 'https://script.google.com/macros/s/AKfycbzi5aD18Xj0ikbQJZkiMSjZPkMg3HVFneL6XTEirRVg2MISZyDN-tTc-0OuUkakGXYWHw/exec';

document.addEventListener('DOMContentLoaded', () => {
    fetchDashboardData();
});

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
            
            renderCatalogos(data.catalogos);
            renderOperaciones(data.operaciones_abiertas);
            renderReservas(data.sala_de_espera);
            renderCaja(data.movimientos_dia);
        })
        .catch(err => {
            toggleSpinner(false);
            alert("Hubo un error cargando los datos. Revisa la URL y tus permisos CORS.");
        });
}

function renderOperaciones(operaciones) {
    const container = document.getElementById('operaciones-container');
    if(!operaciones || operaciones.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-gray-500"><i class="fas fa-ship text-4xl mb-3 opacity-20 block"></i> No hay lanchas programadas.</div>`;
        return;
    }
    
    container.innerHTML = operaciones.map(op => {
        let porcentaje = op.capacidad > 0 ? (op.ocupados / op.capacidad) * 100 : 0;
        return `
        <div class="bg-white rounded-2xl shadow-sm p-4 mb-4 border border-gray-100 relative overflow-hidden">
            <div class="absolute top-0 right-0 w-2 h-full bg-green-500"></div>
            <div class="flex justify-between items-center mb-1">
                <h3 class="font-extrabold text-lg text-blue-900"><i class="fas fa-ship fa-sm mr-2 text-blue-400"></i>${op.bote}</h3>
                <span class="bg-green-100 text-green-800 text-xs px-2.5 py-1 rounded-full font-bold shadow-sm">${op.ocupados} / ${op.capacidad} PAX</span>
            </div>
            <span class="text-[10px] text-gray-400 font-bold block mb-3 uppercase tracking-wider ml-6">CÓDIGO: <span class="text-gray-700">${op.id}</span></span>
            
            <div class="w-full bg-gray-100 rounded-full h-2 mb-3">
                <div class="bg-gradient-to-r from-green-400 to-green-500 h-2 rounded-full" style="width: ${porcentaje}%"></div>
            </div>
            <div class="text-[10px] text-gray-500 flex justify-between items-center mb-4 font-medium px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">
                <span class="truncate"><i class="fas fa-user-tie text-blue-400 mr-1"></i><b class="text-gray-700">${op.capitan}</b></span>
                <span class="truncate text-right"><i class="fas fa-user-tag text-green-400 mr-1"></i><b class="text-gray-700">${op.guia}</b></span>
            </div>
            <button class="w-full bg-blue-50 text-blue-700 font-bold py-2.5 rounded-xl border border-blue-200 hover:bg-blue-100 shadow-sm transition active:scale-95" onclick="abrirModalGestionBote('${op.id}')">
                <i class="fas fa-users mr-1"></i> Gestionar Pasajeros
            </button>
        </div>
        `;
    }).join('');
}

function renderReservas(reservas) {
    const container = document.getElementById('reservas-container');
    if(!reservas || reservas.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-gray-500"><i class="fas fa-clipboard-list text-4xl mb-3 opacity-20 block"></i> No hay pasajeros pendientes en sala.</div>`;
        return;
    }

    container.innerHTML = reservas.map(res => {
        return `
        <div class="bg-white rounded-2xl shadow-sm p-4 border border-l-4 border-l-yellow-400 mb-3 block">
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="font-bold text-gray-800 text-lg">${res.cliente}</h3>
                    <p class="text-xs text-gray-500 mt-0.5"><i class="fas fa-building mr-1"></i>Agn: ${res.contacto} | Res: ${res.id}</p>
                </div>
                <div class="text-right">
                    <span class="font-black text-xl text-blue-600">${res.pax} <span class="text-xs font-semibold text-gray-400 uppercase">PAX</span></span>
                    <p class="text-[10px] text-gray-400 mt-1 font-bold uppercase">${res.hora}</p>
                </div>
            </div>
            <div class="flex mt-4 space-x-2">
                <button class="flex-[2] bg-green-500 text-white py-2.5 rounded-xl text-sm font-bold shadow-md shadow-green-500/20 hover:bg-green-600 transition active:scale-95 border border-green-600" onclick="prepararAsignacion('${res.id}', '${res.cliente}', '${res.pax}', '${res.contacto}')"><i class="fas fa-clipboard-check mr-1"></i> Abordar Lancha</button>
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
}

function cerrarModales() {
    document.getElementById('modal-backdrop').classList.add('hidden');
    document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
}

function confirmarAbrirBote() {
    let id_bote = document.getElementById('select-bote-id').value;
    let id_capitan = document.getElementById('select-capitan-id').value;
    let id_guia = document.getElementById('select-guia-id').value;
    
    if(!id_bote) return alert("❌ Selecciona la lancha a operar.");
    if(!id_capitan) return alert("❌ Selecciona el Capitán.");
    
    cerrarModales(); toggleSpinner(true);
    fetchPost('abrir_operacion', { id_bote, id_capitan, id_guia }).then(() => fetchDashboardData());
}

function confirmarNuevaReserva() {
    let cliente = document.getElementById('input-reserva-cliente').value.trim();
    let agencia = document.getElementById('input-reserva-agencia').value.toUpperCase().trim() || 'DIRECTO';
    let pax = document.getElementById('input-reserva-pax').value.trim();
    
    if(!cliente || !pax) return alert("❌ Cliente y PAX son obligatorios.");
    
    cerrarModales(); toggleSpinner(true);
    fetchPost('nueva_reserva', {
        fecha: new Date().toLocaleDateString(),
        hora: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), 
        id_contacto: agencia, 
        cliente, cant_pax: pax
    }).then(() => {
        document.getElementById('input-reserva-cliente').value = '';
        document.getElementById('input-reserva-agencia').value = '';
        document.getElementById('input-reserva-pax').value = '';
        fetchDashboardData();
    });
}

function prepararAsignacion(id_reserva, cliente, pax, contacto) {
    document.getElementById('hidden-reserva-id').value = id_reserva;
    document.getElementById('hidden-reserva-pax').value = pax;
    document.getElementById('hidden-reserva-agencia').value = contacto;
    document.getElementById('text-cliente').innerText = cliente;
    document.getElementById('text-pax').innerText = pax;
    
    abrirModal('modal-asignar-bote');
}

function confirmarAsignacion() {
    let id_reserva = document.getElementById('hidden-reserva-id').value;
    let pax = document.getElementById('hidden-reserva-pax').value;
    let contacto = document.getElementById('hidden-reserva-agencia').value;
    let id_operacion = document.getElementById('input-asignar-op').value.toUpperCase().trim();
    
    if(!id_operacion || !id_operacion.startsWith('OP-')) return alert("❌ Escribe el código exacto de la Operación (Ej: OP-12345).");
    
    cerrarModales(); toggleSpinner(true);
    fetchPost('asignar_reserva', { id_reserva, id_operacion, cant_pax: pax, id_contacto: contacto })
    .then(() => fetchDashboardData());
}

function registrarCajaRapida(tipo) {
    let m = prompt(`💰 Ingrese el MONTO EXACTO de efectivo para:\n▶ ${tipo}`);
    if(m && !isNaN(m)) {
        toggleSpinner(true);
        fetchPost('registrar_caja', {
            categoria: tipo.replace(' ', '_'),
            monto: parseFloat(m),
            metodo_pago: 'Efectivo',
            operador: 'Op_Turno'
        }).then(() => fetchDashboardData());
    }
}

// ==========================
// VENTA DIRECTA (GESTION BOTE)
// ==========================
function abrirModalGestionBote(id_op) {
    let op = window.operacionesData.find(o => o.id === id_op);
    if(!op) return;
    
    document.getElementById('gestion-bote-nombre').innerText = op.bote;
    document.getElementById('hidden-gestion-op').value = op.id;
    document.getElementById('gestion-pax-total').innerText = op.ocupados;
    
    let listaHTML = op.manifiesto.map(m => {
        let isEditado = m.estado && m.estado.includes('(Editado)');
        let bgClass = isEditado ? 'bg-orange-50' : 'bg-white';
        let iconoEdicion = isEditado ? `<i class="fas fa-pen text-[9px] text-orange-400 ml-1" title="Editado"></i>` : '';
        return `
        <div class="flex justify-between items-center ${bgClass} border border-gray-200 p-3 rounded-xl cursor-pointer hover:bg-blue-50 transition shadow-sm" onclick="cargarParaEditar('${m.id}')">
            <div>
                <span class="text-xs font-bold text-gray-800 uppercase block">${m.contacto} ${iconoEdicion}</span>
                <span class="text-[10px] text-gray-500 font-bold">${m.tipo.replace('_',' ')}</span>
            </div>
            <div class="text-right">
                <span class="font-black text-blue-600 text-sm">${m.pax} PAX</span>
                <span class="text-[10px] text-gray-500 block font-bold">S/ ${parseFloat(m.monto).toFixed(2)}</span>
            </div>
        </div>`;
    }).join('');
    
    if(!listaHTML) listaHTML = '<div class="text-center p-6 bg-white rounded-xl border border-dashed border-gray-300"><i class="fas fa-ship text-gray-300 text-3xl mb-2"></i><p class="text-xs text-gray-400">Lancha vacía.<br>Registra ventas abajo.</p></div>';
    
    document.getElementById('gestion-manifiesto-lista').innerHTML = listaHTML;
    
    resetFormularioVenta();
    abrirModal('modal-gestion-bote');
}

function cambiarTipoVentaDirecta() {
    let tipo = document.getElementById('input-vd-tipo').value;
    let container = document.getElementById('container-contacto-input');
    
    if(tipo === 'Agencia' || tipo === 'Pase_Recibido') {
        let options = window.contactosData.map(c => `<option value="${c.nombre}">${c.nombre} (S/ ${c.precio})</option>`).join('');
        container.innerHTML = `
            <label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Elegir Aliado / Agencia</label>
            <select id="input-vd-contacto-select" class="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-[11px] font-bold text-gray-800 shadow-sm mt-0.5 outline-none" onchange="actualizarPrecioDefecto()">
                <option value="">Seleccionar...</option>
                ${options}
            </select>`;
    } else {
        container.innerHTML = `
            <label class="text-[9px] font-bold text-gray-600 uppercase tracking-widest ml-1">Familia / Apellido</label>
            <input type="text" id="input-vd-contacto-text" class="w-full bg-white border border-gray-200 rounded-xl p-2.5 text-xs focus:outline-blue-500 shadow-sm mt-0.5 uppercase" placeholder="Ej: Familia Vasquez">`;
    }
    actualizarPrecioDefecto();
}

function actualizarPrecioDefecto() {
    let tipo = document.getElementById('input-vd-tipo').value;
    let inputPax = document.getElementById('input-vd-pax');
    let inputPrecio = document.getElementById('input-vd-precio');
    let pax = parseInt(inputPax.value) || 0;
    
    if(tipo === 'Agencia' || tipo === 'Pase_Recibido') {
        let selectContacto = document.getElementById('input-vd-contacto-select');
        if(selectContacto && selectContacto.value) {
            let info = window.contactosData.find(c => c.nombre === selectContacto.value);
            if(info && pax > 0) {
                inputPrecio.value = (info.precio * pax).toFixed(2);
            } else if(info) {
                inputPrecio.value = "0.00";
            }
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
    if(!movToEdit) return;
    
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
    box.classList.remove('border-blue-200', 'bg-blue-50');
    box.classList.add('border-orange-300', 'bg-orange-50');
    
    let btnSubmit = document.getElementById('btn-submit-venta');
    btnSubmit.innerHTML = `<i class="fas fa-save mr-2 text-base"></i> Actualizar`;
    btnSubmit.className = "w-full mt-3 bg-orange-500 hover:bg-orange-600 active:scale-95 text-white font-black p-3.5 rounded-xl shadow-lg transition flex items-center justify-center uppercase text-xs tracking-wider border border-orange-600";
}

function confirmarVentaDirecta() {
    let id_op = document.getElementById('hidden-gestion-op').value;
    let id_mov = document.getElementById('hidden-vd-idmov').value;
    let tipo = document.getElementById('input-vd-tipo').value;
    let pax = document.getElementById('input-vd-pax').value.trim();
    let precio = document.getElementById('input-vd-precio').value.trim();
    
    let contacto = "";
    if(tipo === 'Agencia' || tipo === 'Pase_Recibido') {
        let selectEl = document.getElementById('input-vd-contacto-select');
        if(selectEl) contacto = selectEl.value;
    } else {
        let textEl = document.getElementById('input-vd-contacto-text');
        if(textEl) contacto = textEl.value.trim().toUpperCase();
    }
    
    if(!contacto || !pax || !precio) return alert("❌ Cliente/Agencia, Pax y Precio total son obligatorios.");
    if(parseFloat(pax) <= 0) return alert("❌ Cantidad de pasajeros errónea.");
    
    let endpoint = id_mov ? 'editar_movimiento_pax' : 'registrar_movimiento_pax';
    let payload = {
        id_operacion: id_op,
        tipo: tipo,
        contacto: contacto,
        pax: pax,
        precio_unitario: (parseFloat(precio)/parseFloat(pax)).toFixed(2),
        monto_total: parseFloat(precio)
    };
    if(id_mov) payload.id_mov = id_mov;
    
    cerrarModales(); toggleSpinner(true);
    fetchPost(endpoint, payload).then(() => {
        resetFormularioVenta();
        fetchDashboardData();
    });
}

function fetchPost(action, payload) {
    return fetch(GAS_URL, {
        method: 'POST', redirect: 'follow',
        body: JSON.stringify({ action: action, payload: payload }),
        headers: {'Content-Type': 'text/plain;charset=utf-8'}
    })
    .then(res => res.json())
    .then(data => { alert(data.message); return data; })
    .catch(err => {
        return { message: 'ok' }; 
    });
}

function toggleSpinner(show) {
    const s = document.getElementById('global-spinner');
    const u = document.getElementById('btn-refresh');
    if(show) { s.classList.remove('hidden'); u.classList.add('hidden'); }
    else { s.classList.add('hidden'); u.classList.remove('hidden'); }
}
