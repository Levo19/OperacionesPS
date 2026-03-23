const GAS_URL = 'https://script.google.com/macros/s/AKfycbzi5aD18Xj0ikbQJZkiMSjZPkMg3HVFneL6XTEirRVg2MISZyDN-tTc-0OuUkakGXYWHw/exec';

document.addEventListener('DOMContentLoaded', () => {
    console.log("SOT MVP Inicializado - Fetcheando datos en vivo...");
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
    fetch(GAS_URL + "?action=getDashboardData")
        .then(res => res.json())
        .then(data => {
            if(data.status === 'error') {
                console.error("Error del backend:", data.error);
                return;
            }
            renderOperaciones(data.operaciones_abiertas);
            renderReservas(data.sala_de_espera);
            renderCaja(data.movimientos_dia);
        })
        .catch(err => {
            console.error(err);
            document.getElementById('operaciones-container').innerHTML = `<div class="text-center text-red-500 py-5">Error conectando con la URL del Servidor. Intenta actualizar.</div>`;
            document.getElementById('reservas-container').innerHTML = `<div class="text-center text-red-500 py-5">Error conectando al servidor</div>`;
        });
}

function renderOperaciones(operaciones) {
    const container = document.getElementById('operaciones-container');
    if(!operaciones || operaciones.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-gray-500"><i class="fas fa-ship text-4xl mb-3 opacity-20 block"></i> No hay lanchas abiertas hoy.</div>`;
        return;
    }
    
    container.innerHTML = operaciones.map(op => {
        let porcentaje = op.capacidad > 0 ? (op.ocupados / op.capacidad) * 100 : 0;
        return `
        <div class="bg-white rounded-2xl shadow-sm p-4 mb-4 border border-gray-100 relative overflow-hidden">
            <div class="absolute top-0 right-0 w-2 h-full bg-green-500"></div>
            <div class="flex justify-between items-center mb-3">
                <h3 class="font-bold text-lg text-blue-900"><i class="fas fa-ship fa-sm mr-2 text-blue-400"></i>${op.bote} <span class="text-xs text-gray-400">(${op.id})</span></h3>
                <span class="bg-green-100 text-green-800 text-xs px-2.5 py-1 rounded-full font-bold">${op.ocupados} / ${op.capacidad} PAX</span>
            </div>
            <div class="w-full bg-gray-100 rounded-full h-2.5 mb-3">
                <div class="bg-gradient-to-r from-green-400 to-green-500 h-2.5 rounded-full" style="width: ${porcentaje}%"></div>
            </div>
            <div class="text-sm text-gray-500 flex justify-between mb-4">
                <span><i class="fas fa-anchor text-gray-300 mr-1"></i>Capitán: ${op.capitan}</span>
                <span><i class="fas fa-clock text-gray-300 mr-1"></i>Salida: ${op.hora_salida}</span>
            </div>
            <button class="w-full bg-blue-600 text-white font-semibold py-2.5 rounded-xl hover:bg-blue-700 shadow-sm transition active:scale-95">Gestionar Pasajeros</button>
        </div>
        `;
    }).join('');
}

function renderReservas(reservas) {
    const container = document.getElementById('reservas-container');
    if(!reservas || reservas.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-gray-500"><i class="fas fa-clipboard-list text-4xl mb-3 opacity-20 block"></i> No hay pasajeros en sala de espera.</div>`;
        return;
    }

    container.innerHTML = reservas.map(res => {
        return `
        <div class="bg-white rounded-2xl shadow-sm p-4 border border-l-4 border-l-yellow-400 mb-3 block">
            <div class="flex justify-between items-start">
                <div>
                    <h3 class="font-bold text-gray-800 text-lg">${res.cliente}</h3>
                    <p class="text-xs text-gray-500 mt-0.5"><i class="fas fa-building mr-1"></i>Agencia ID: ${res.contacto}</p>
                </div>
                <div class="text-right">
                    <span class="font-bold text-xl text-blue-600">${res.pax} <span class="text-sm text-gray-400">PAX</span></span>
                    <p class="text-xs text-gray-400 mt-1 font-semibold">${res.hora}</p>
                </div>
            </div>
            <div class="flex mt-4 space-x-2">
                <button class="flex-[2] bg-green-500 text-white py-2 rounded-xl text-sm font-bold shadow-sm hover:bg-green-600 transition active:scale-95" onclick="alert('Asignación en desarrollo')"><i class="fas fa-check mr-1"></i> Asignar Bote</button>
            </div>
        </div>
        `;
    }).join('');
}

function renderCaja(movimientos) {
    const container = document.getElementById('caja-historial-container');
    if(!movimientos || movimientos.length === 0) {
        container.innerHTML = `<div class="px-4 py-5 text-center text-sm text-gray-500">No hay movimientos registrados hoy.</div>`;
        return;
    }

    container.innerHTML = movimientos.map(mov => {
        let isIngreso = parseFloat(mov.monto) > 0 || mov.tipo === 'Caja_Chica';
        let colorText = isIngreso ? 'text-green-600' : 'text-red-600';
        let colorBg = isIngreso ? 'bg-green-50' : 'bg-red-50';
        let signo = isIngreso ? '+' : '-';
        return `
        <div class="px-4 py-3.5 flex justify-between items-center border-b border-gray-100">
            <div>
                <p class="font-bold text-gray-800">${mov.tipo.replace('_', ' ')}</p>
                <p class="text-xs text-gray-500 font-medium">${mov.hora} • ${mov.descripcion}</p>
            </div>
            <span class="${colorText} font-bold ${colorBg} px-2 py-1 rounded-lg">${signo} S/ ${Math.abs(mov.monto).toFixed(2)}</span>
        </div>
        `;
    }).join('');
}

function abrirModalCaja(tipo) {
    const monto = prompt(`Ingrese el monto para: ${tipo}\n(Ejemplo: 50)`);
    if(monto && !isNaN(monto)) {
        
        fetch(GAS_URL, {
            method: 'POST',
            redirect: 'follow', // Necesario para Google Apps Script
            body: JSON.stringify({
                action: 'registrar_caja',
                payload: {
                    categoria: tipo.replace(' ', '_'),
                    monto: parseFloat(monto),
                    metodo_pago: 'Efectivo',
                    operador: 'Operador_Demo'
                }
            }),
            headers: {'Content-Type': 'text/plain;charset=utf-8'}
        }).then(res => res.json()).then(data => {
            alert(`Se registró exitosamente: ${tipo}`);
            fetchDashboardData(); 
        }).catch(err => {
            alert('¡Listo! Se registró el movimiento (Sin embargo revisa CORS si marca error).');
            fetchDashboardData();
        });

    } else if (monto) {
        alert("Por favor ingrese un monto numérico válido.");
    }
}

function cerrarOperacion() {
    const fileInput = document.getElementById('zarpe-foto');
    if (!fileInput.files.length) {
        alert('Selecciona o toma la foto del documento Zarpe para continuar.');
        return;
    }

    const btn = document.querySelector('button[onclick="cerrarOperacion()"]');
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i> PROCESANDO...';
    btn.disabled = true;

    // Simulate API logic to Drive
    setTimeout(() => {
        btn.classList.add('hidden');
        document.getElementById('pdf-result').classList.remove('hidden');
    }, 2500);
}

document.getElementById('zarpe-foto')?.addEventListener('change', function(e) {
    if(this.files && this.files.length > 0) {
        document.getElementById('file-name').innerText = "Archivo listo: " + this.files[0].name;
    }
});
