// Configura aquí la URL que te dará Google Apps Script al publicar "Como Web App"
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzi5aD18Xj0ikbQJZkiMSjZPkMg3HVFneL6XTEirRVg2MISZyDN-tTc-0OuUkakGXYWHw/exec';

document.addEventListener('DOMContentLoaded', () => {
    console.log("SOT MVP Inicializado");
    // Aquí puedes llamar a fetchData() inicialmente para poblar la UI
});

// ======================================
// 1. Navegación entre Pestañas (Tabs)
// ======================================
function switchTab(tabId, title, btnElement) {
    // 1. Ocultar todas las pestañas
    const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => tab.classList.remove('active'));

    // 2. Mostrar la seleccionada
    document.getElementById(tabId).classList.add('active');

    // 3. Resetear todos los botones de la barra inferior
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.classList.remove('active', 'red-tab');
    });

    // 4. Activar el botón pinchado
    btnElement.classList.add('active');
    
    // Si es "Cierre", darle color rojo para destacar
    if(tabId === 'tab-cierre') {
        btnElement.classList.add('red-tab');
    }

    // 5. Actualizar Título
    document.getElementById('app-title').innerText = title;
}

// ======================================
// 2. Logica de Caja (Mock Modal/Alert)
// ======================================
function abrirModalCaja(tipo) {
    const monto = prompt(`Ingrese el monto para: ${tipo}\n(Ejemplo: 50)`);
    if(monto && !isNaN(monto)) {
        // Mock API Call
        console.log(`Guardando => Acción: registrar_caja | Categoria: ${tipo} | Monto: S/ ${monto}`);
        alert(`Se registró exitosamente: ${tipo} por S/ ${parseFloat(monto).toFixed(2)}`);
        // Aqui iría un fetch() tipo POST a GAS_URL
    } else if (monto) {
        alert("Por favor ingrese un monto numérico válido.");
    }
}

// ======================================
// 3. Lógica de Cierre y Liquidación
// ======================================
function cerrarOperacion() {
    const fileInput = document.getElementById('zarpe-foto');
    if (!fileInput.files.length) {
        alert('Por favor, selecciona o toma la foto del documento Zarpe firmado para continuar.');
        return;
    }

    // Cambiar estado del botón a cargando
    const btn = document.querySelector('button[onclick="cerrarOperacion()"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i> PROCESANDO...';
    btn.disabled = true;

    // Simular un fetch delay de 2 segundos al backend (Apps Script -> Drive -> PDF)
    setTimeout(() => {
        // Restaurar estado
        btn.classList.add('hidden'); // Ocultar el botón para evitar doble envío
        document.getElementById('pdf-result').classList.remove('hidden'); // Mostrar resultado verde con boton de descarga
    }, 2000);

    /* 
    Ejemplo de Fetch Real a Google Apps Script para Post:
    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Img = e.target.result.split(',')[1];
        fetch(GAS_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'cerrar_operacion',
                payload: {
                    id_operacion: 'OP-001',
                    foto_base64: base64Img
                }
            })
        }).then(res => res.json()).then(data => {
            console.log(data);
            // Mostrar modal de éxito
        });
    }
    reader.readAsDataURL(fileInput.files[0]);
    */
}

// Preview del nombre del archivo al seleccionar la foto del Zarpe
document.getElementById('zarpe-foto')?.addEventListener('change', function(e) {
    if(this.files && this.files.length > 0) {
        document.getElementById('file-name').innerText = "Archivo cargado: " + this.files[0].name;
    }
});
