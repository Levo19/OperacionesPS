// ============================================================
// OPERACIONES PS — Google Apps Script Backend
// Versión corregida: todos los bugs del análisis aplicados
// ============================================================

const SPREADSHEET_ID = '1L_tmja28TvYENtqDJ-jraHKXoGv2NXkHQ7wTw-nMVo8';

function doGet(e) {
  const action = e.parameter.action;
  try {
    if (!action || action === 'getDashboardData') {
      return jsonResponse(getDashboardData());
    }
    return jsonResponse({ error: 'Acción no válida' }, 400);
  } catch (error) {
    return jsonResponse({ error: error.toString() }, 500);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    if (action === 'nueva_reserva')             { return jsonResponse(crearReserva(data.payload)); }
    else if (action === 'registrar_movimiento_pax') { return jsonResponse(registrarMovimientoPax(data.payload)); }
    else if (action === 'editar_movimiento_pax')    { return jsonResponse(editarMovimientoPax(data.payload)); }
    else if (action === 'registrar_caja')           { return jsonResponse(registrarCaja(data.payload)); }
    else if (action === 'cerrar_operacion')         { return jsonResponse(cerrarOperacion(data.payload)); }
    else if (action === 'abrir_operacion')          { return jsonResponse(abrirOperacion(data.payload)); }
    else if (action === 'asignar_reserva')          { return jsonResponse(asignarReserva(data.payload)); }
    else if (action === 'zarpar_operacion')         { return jsonResponse(zarparOperacion(data.payload)); }
    else if (action === 'registrar_caja_v2')        { return jsonResponse(registrarCajaV2(data.payload)); }
    else if (action === 'derivar_pase')             { return jsonResponse(derivarPase(data.payload)); }
    else if (action === 'eliminar_movimiento')      { return jsonResponse(eliminarMovimiento(data.payload)); }
    else if (action === 'actualizar_adicionales')   { return jsonResponse(actualizarAdicionales(data.payload)); }
    else if (action === 'pase_desde_reserva')       { return jsonResponse(paseDesdeReserva(data.payload)); }
    else if (action === 'editar_operacion')         { return jsonResponse(editarOperacion(data.payload)); }
    return jsonResponse({ error: 'Acción no requerida o desconocida' }, 400);
  } catch (error) {
    return jsonResponse({ error: error.toString() }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: status === 200 ? 'success' : 'error', ...data }))
    .setMimeType(ContentService.MimeType.JSON);
}

// FIX #8: parseDateForJS solo se usa para fechas (no timestamps).
// Para timestamps se usa formatTimestamp() que conserva la hora.
function parseDateForJS(sheetDateText) {
  if (!sheetDateText) return '';
  try {
    if (sheetDateText instanceof Date) return sheetDateText.toISOString().split('T')[0];
    let parts = sheetDateText.toString().split(/[/-]/);
    if (parts.length === 3) {
      if (parts[0].length <= 2 && parts[2].length === 4) {
        return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
      }
      if (parts[0].length === 4) return sheetDateText;
    }
    return sheetDateText;
  } catch(e) { return sheetDateText; }
}

// FIX #8: Nueva función para timestamps que conserva fecha Y hora
function formatTimestamp(val) {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString();
  return val.toString();
}

function getDashboardData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  function sheetToJSON(sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    const displayData = sheet.getDataRange().getDisplayValues();
    if (data.length < 2) return [];
    const keys = displayData[0];
    return data.slice(1).map((row, rIndex) => {
      let obj = {};
      keys.forEach((k, i) => obj[k] = (row[i] instanceof Date) ? row[i] : displayData[rIndex+1][i]);
      return obj;
    });
  }

  const todosBotes      = sheetToJSON('Embarcaciones');
  const todoPersonal    = sheetToJSON('Personal');
  const todosContactos  = sheetToJSON('Contactos');
  const todosMovimientos = sheetToJSON('Movimientos');
  const todasOperaciones = sheetToJSON('Operaciones');

  const botesMap = {};
  todosBotes.forEach(b => { botesMap[b.id_bote] = { nombre: b.nombre, capacidad: parseInt(b.capacidad_pax)||0 }; });
  const personalMap = {};
  todoPersonal.forEach(p => { personalMap[p.id_empleado] = p.nombre; });

  const operacionesActivasRef = todasOperaciones.filter(op => op.estado === 'Abierta' || op.estado === 'En_Viaje');
  const operacionesAbiertas   = todasOperaciones.filter(op => op.estado === 'Abierta');
  const botesOcupados    = operacionesAbiertas.map(op => op.id_bote);
  const capitanesOcupados = operacionesAbiertas.map(op => op.id_capitan);
  const guiasOcupados    = operacionesAbiertas.map(op => op.id_guia);

  const operaciones = operacionesActivasRef.map(op => {
    let bData = botesMap[op.id_bote] || { nombre: 'Lancha ('+op.id_bote+')', capacidad: 0 };
    let nombreCapitan = personalMap[op.id_capitan] || op.id_capitan || 'No Asignado';
    let nombreGuia    = personalMap[op.id_guia] || 'Sin Guía';

    let movsBote  = todosMovimientos.filter(m => m.id_operacion === op.id_operacion).reverse();
    // Excluir movimientos ya pasados o cancelados del conteo y del manifiesto activo
    let movsActivos = movsBote.filter(m => {
      let e = (m.estado_movimiento || '').toLowerCase();
      return !e.includes('pasado') && !e.includes('cancelado');
    });
    let paxOcupados = movsActivos.reduce((sum, m) => sum + (parseInt(m.cant_pax)||0), 0);

    return {
      id: op.id_operacion,
      bote: bData.nombre,
      capacidad: bData.capacidad,
      ocupados: paxOcupados,
      estado: op.estado,
      capitan: nombreCapitan,
      guia: nombreGuia,
      hora_salida: op.hora_salida,
      destino: op.Destino || '',
      fecha: parseDateForJS(op.fecha),
      manifiesto: movsActivos.map(m => ({
        id: m.id_mov,
        tipo: m.tipo_movimiento,
        contacto: m.id_contacto,
        nombreContacto: m.nombreContacto || m.id_contacto,
        pax: m.cant_pax,
        monto: m.monto_total_cobrar,
        estado: m.estado_movimiento
      }))
    };
  });

  const botesDisponibles = todosBotes
    .filter(b => b.id_bote && !botesOcupados.includes(b.id_bote))
    .map(b => ({ id: b.id_bote, nombre: b.nombre, cap: b.capacidad_pax }));

  const normalizeStr = s => (s||'').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const capitanesDisponibles = todoPersonal
    .filter(p => p.id_empleado && normalizeStr(p.rol).includes('capit') && !capitanesOcupados.includes(p.id_empleado))
    .map(p => ({ id: p.id_empleado, nombre: p.nombre }));

  const guiasDisponibles = todoPersonal
    .filter(p => p.id_empleado && normalizeStr(p.rol).includes('guia') && !guiasOcupados.includes(p.id_empleado))
    .map(p => ({ id: p.id_empleado, nombre: p.nombre }));

  const contactosCat = todosContactos
    .filter(c => c.id_contacto)
    .map(c => ({ id: c.id_contacto, nombre: c.nombre_comercial, tipo: c.tipo, precio: parseFloat(c.precio_pax_defecto)||0 }));

  // FIX #6: campo correcto es r.usuario (no r.creado_por ni r.operador)
  const salaEspera = sheetToJSON('Reservas_CRM')
    .filter(r => r.estado_reserva === 'Pendiente')
    .map(r => ({
      id: r.id_reserva,
      cliente: r.nombre_cliente_final,
      pax: r.cant_pax,
      estado: r.estado_reserva,
      hora: r.hora_preferida,
      contacto: r.id_contacto,
      monto: parseFloat(r.monto) || 0,
      fecha: parseDateForJS(r.fecha_tour),
      creado_por: r.usuario || ''   // FIX: columna real en la hoja
    }));

  // FIX #8: usar formatTimestamp para conservar la hora
  const movimientosCaja = sheetToJSON('Caja_Operador').map(c => ({
    id: c.id_transaccion,
    categoria: c.categoria,
    metodo_pago: c.metodo_pago,
    operador: c.operador_caja,
    monto: parseFloat(c.monto)||0,
    timestamp: formatTimestamp(c.timestamp_transaccion)
  }));

  // Pases del día: movimientos con estado 'Pasado' del día de hoy
  const hoy = new Date();
  const hoyStr = hoy.toLocaleDateString('en-GB'); // dd/mm/yyyy
  const pasesExternos = todosMovimientos
    .filter(m => {
      if ((m.estado_movimiento || '').toLowerCase() !== 'pasado') return false;
      let ts = m.timestamp_registro;
      if (!ts) return true;
      let d = (ts instanceof Date) ? ts : new Date(ts);
      return d.toLocaleDateString('en-GB') === hoyStr;
    })
    .map(m => ({
      id: m.id_mov,
      tipo: m.tipo_movimiento,
      contacto: m.id_contacto,
      nombreContacto: m.nombreContacto || m.id_contacto,  // nombre original, no tocado
      pax: m.cant_pax,
      monto: m.monto_total_cobrar,
      estado: m.estado_movimiento,
      timestamp: formatTimestamp(m.timestamp_registro)
    }));

  return {
    operaciones_abiertas: operaciones,
    sala_de_espera: salaEspera,
    movimientos_dia: movimientosCaja,
    pases_externos: pasesExternos,
    catalogos: {
      botes: botesDisponibles,
      capitanes: capitanesDisponibles,
      guias: guiasDisponibles,
      contactos: contactosCat,
      operadores:      todoPersonal.filter(p => p.id_empleado && normalizeStr(p.rol).includes('operador')).map(p => ({ id: p.id_empleado, nombre: p.nombre })),
      impuestos:       sheetToJSON('Impuestos').filter(i => i.id_impuesto).map(i => ({ id: i.id_impuesto, nombre: i.nombre, monto: parseFloat(i.monto)||0 })),
      todos_capitanes: todoPersonal.filter(p => p.id_empleado && normalizeStr(p.rol).includes('capit')).map(p => ({ id: p.id_empleado, nombre: p.nombre })),
      todos_guias:     todoPersonal.filter(p => p.id_empleado && normalizeStr(p.rol).includes('guia')).map(p => ({ id: p.id_empleado, nombre: p.nombre }))
    }
  };
}

// =============================================
// Helpers
// =============================================
function CheckCapacidadDisponible(ss, id_operacion, ignore_mov_id = null) {
  let ocupados = 0;
  const movData = ss.getSheetByName('Movimientos').getDataRange().getValues();
  for (let i = 1; i < movData.length; i++) {
    if (movData[i][1] === id_operacion && movData[i][0] !== ignore_mov_id) ocupados += parseInt(movData[i][5])||0; // col 6 = cant_pax (índice 5)
  }
  const opsData = ss.getSheetByName('Operaciones').getDataRange().getValues();
  let idBote = '';
  for (let i = 1; i < opsData.length; i++) {
    if (opsData[i][0] === id_operacion) { idBote = opsData[i][3]; break; }
  }
  let capacidad = 999;
  if (idBote) {
    const botsData = ss.getSheetByName('Embarcaciones').getDataRange().getValues();
    for (let i = 1; i < botsData.length; i++) {
      if (botsData[i][0] === idBote) { capacidad = parseInt(botsData[i][2])||0; break; }
    }
  }
  return { ocupados, capacidad };
}

// =============================================
// Endpoints POST
// =============================================

// FIX #2: orden correcto de columnas + estado_movimiento incluido
// Columnas Movimientos: id_mov(1) | id_operacion(2) | tipo_movimiento(3) | id_contacto(4) |
//   cant_pax(5) | precio_unitario_aplicado(6) | monto_total_cobrar(7) | adicionales(8) |
//   operador_registro(9) | timestamp_registro(10) | estado_movimiento(11)
function registrarMovimientoPax(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const check = CheckCapacidadDisponible(ss, payload.id_operacion);
  if (check.ocupados + parseInt(payload.pax) > check.capacidad) {
    return { status: 'error', message: `❌ ¡Alerta de Cruce! Operador simultáneo. Quedan ${check.capacidad - check.ocupados} cupos.` };
  }
  const sheet = ss.getSheetByName('Movimientos');
  const newId = 'MOV-' + Date.now().toString().slice(-6);
  sheet.appendRow([
    newId,                                          // col 1  id_mov
    payload.id_operacion,                          // col 2  id_operacion
    payload.tipo,                                  // col 3  tipo_movimiento
    payload.id_contacto || payload.contacto,       // col 4  id_contacto
    payload.nombre_contacto || payload.contacto,   // col 5  nombreContacto ← NEW
    payload.pax,                                   // col 6  cant_pax
    payload.precio_unitario,                       // col 7  precio_unitario_aplicado
    payload.monto_total,                           // col 8  monto_total_cobrar
    '',                                            // col 9  adicionales
    payload.creador || 'App',                      // col 10 operador_registro
    new Date(),                                    // col 11 timestamp_registro
    'Embarcado'                                    // col 12 estado_movimiento
  ]);
  SpreadsheetApp.flush();
  return { message: '✅ Abordaje directo registrado en Manifiesto.' };
}

function editarMovimientoPax(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const check = CheckCapacidadDisponible(ss, payload.id_operacion, payload.id_mov);
  if (check.ocupados + parseInt(payload.pax) > check.capacidad) {
    return { status: 'error', message: `❌ Límite excedido. Quedan ${check.capacidad - check.ocupados} lugares libres.` };
  }
  const sheetMov = ss.getSheetByName('Movimientos');
  const movData  = sheetMov.getDataRange().getValues();
  for (let i = 1; i < movData.length; i++) {
    if (movData[i][0] === payload.id_mov) {
      sheetMov.getRange(i+1, 3).setValue(payload.tipo);
      sheetMov.getRange(i+1, 4).setValue(payload.id_contacto || payload.contacto);
      sheetMov.getRange(i+1, 5).setValue(payload.nombre_contacto || payload.contacto); // nombreContacto
      sheetMov.getRange(i+1, 6).setValue(payload.pax);           // cant_pax (col 6)
      sheetMov.getRange(i+1, 7).setValue(payload.precio_unitario); // col 7
      sheetMov.getRange(i+1, 8).setValue(payload.monto_total);   // col 8
      let estadoActual = movData[i][11] || ''; // col 12 (índice 11)
      if (!estadoActual.includes('(Editado)')) {
        sheetMov.getRange(i+1, 12).setValue(estadoActual + ' (Editado)');
      }
      SpreadsheetApp.flush();
      return { message: '✅ Registro actualizado.' };
    }
  }
  return { message: '❌ Error: Registro no encontrado en DB.', status: 'error' };
}

// FIX #7: incluye columna Destino (columna 11 de Operaciones)
// Columnas Operaciones: id_operacion(1) | fecha(2) | hora_salida(3) | id_bote(4) |
//   id_capitan(5) | id_guia(6) | estado(7) | creado_por(8) | timestamp_creacion(9) |
//   foto_zarpe_url(10) | Destino(11)
function abrirOperacion(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Operaciones');
  let d = new Date();
  const newId = 'OP-' + Date.now().toString().slice(-6);
  sheet.appendRow([
    newId,
    d.toLocaleDateString('en-GB'),
    payload.hora_salida || d.toLocaleTimeString(),
    payload.id_bote,
    payload.id_capitan || '',
    payload.id_guia || '',
    'Abierta',
    payload.creador || 'App',
    d,
    '',                          // foto_zarpe_url
    payload.destino || ''        // FIX: columna Destino
  ]);
  SpreadsheetApp.flush();
  return { message: '✅ Operación abierta con éxito.' };
}

function crearReserva(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Reservas_CRM');
  const newId = 'RES-' + Date.now().toString().slice(-5);
  // Columnas: id_reserva | fecha_tour | hora_preferida | id_contacto | nombre_cliente_final | cant_pax | estado_reserva | usuario | monto
  sheet.appendRow([
    newId,
    payload.fecha,
    payload.hora,
    payload.id_contacto,
    payload.cliente,
    payload.cant_pax,
    'Pendiente',
    payload.creador,
    payload.monto
  ]);
  SpreadsheetApp.flush();
  return { message: '✅ Reserva originada con éxito.' };
}

// FIX #3: orden correcto de columnas en Movimientos + estado_movimiento incluido
function asignarReserva(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const check = CheckCapacidadDisponible(ss, payload.id_operacion);
  if (check.ocupados + parseInt(payload.cant_pax) > check.capacidad) {
    return { status: 'error', message: `❌ Capacidad insuficiente para asignar esta reserva.` };
  }
  const sheetRes = ss.getSheetByName('Reservas_CRM');
  const dataRes  = sheetRes.getDataRange().getValues();
  for (let i = 1; i < dataRes.length; i++) {
    if (dataRes[i][0] === payload.id_reserva) { sheetRes.getRange(i+1, 7).setValue('Asignado'); break; }
  }
  const sheetMov = ss.getSheetByName('Movimientos');
  const newMovId = 'MOV-' + Date.now().toString().slice(-6);
  sheetMov.appendRow([
    newMovId,                                              // col 1  id_mov
    payload.id_operacion,                                 // col 2  id_operacion
    payload.tipo || 'Agencia',                            // col 3  tipo_movimiento
    payload.id_contacto,                                  // col 4  id_contacto
    payload.nombre_contacto || payload.id_contacto,       // col 5  nombreContacto ← NEW
    payload.cant_pax,                                     // col 6  cant_pax
    parseFloat(payload.precio_unitario) || 0,             // col 7  precio_unitario_aplicado
    parseFloat(payload.monto_total) || 0,                 // col 8  monto_total_cobrar
    '',                                                   // col 9  adicionales
    payload.creador || 'App',                             // col 10 operador_registro
    new Date(),                                           // col 11 timestamp_registro
    'Embarcado'                                           // col 12 estado_movimiento
  ]);
  SpreadsheetApp.flush();
  return { message: '✅ Pasajeros asignados al Bote.' };
}

function registrarCaja(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Caja_Operador');
  const newId = 'TX-' + Date.now().toString().slice(-6);
  sheet.appendRow([newId, '', '', payload.categoria, payload.monto, payload.metodo_pago, '', payload.operador, new Date()]);
  SpreadsheetApp.flush();
  return { message: 'Caja actualizada', id_transaccion: newId };
}

function registrarCajaV2(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Caja_Operador');
  const newId = 'TX-' + Date.now().toString().slice(-6);
  sheet.appendRow([newId, payload.referencia || '', '', payload.categoria, payload.monto, payload.metodo_pago, '', payload.operador, new Date()]);
  SpreadsheetApp.flush();
  return { message: '✅ Transacción registrada en Caja.' };
}

function derivarPase(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetMov = ss.getSheetByName('Movimientos');
  const movData  = sheetMov.getDataRange().getValues();
  for (let i = 1; i < movData.length; i++) {
    if (movData[i][0] === payload.id_mov) {
      // Mantener id_operacion real pero marcar con sufijo -EXT para lectura posterior
      let idOpOriginal = movData[i][1];
      sheetMov.getRange(i+1, 2).setValue(idOpOriginal);                          // mantener id_op original
      sheetMov.getRange(i+1, 3).setValue('Aliado(PaseOut)');                     // tipo_movimiento
      sheetMov.getRange(i+1, 4).setValue(payload.aliado_id || payload.aliado);   // id_contacto = ID del aliado destino
      // col 5 (nombreContacto) NO se toca: conserva el nombre original del pasajero/contacto
      sheetMov.getRange(i+1, 12).setValue('Pasado');                             // estado simple para filtrar
      SpreadsheetApp.flush();
      return { message: '✅ Pasajeros transferidos a ' + payload.aliado + '.' };
    }
  }
  return { status: 'error', message: 'Movimiento no encontrado.' };
}

function eliminarMovimiento(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetMov = ss.getSheetByName('Movimientos');
  const movData  = sheetMov.getDataRange().getValues();
  for (let i = 1; i < movData.length; i++) {
    if (movData[i][0] === payload.id_mov) {
      sheetMov.getRange(i+1, 12).setValue('Cancelado'); // col 12 = estado_movimiento
      SpreadsheetApp.flush();
      return { message: '🗑️ Movimiento cancelado.' };
    }
  }
  return { status: 'error', message: 'Movimiento no encontrado.' };
}

function actualizarAdicionales(payload) {
  // payload: { id_mov, adicionales }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetMov = ss.getSheetByName('Movimientos');
  const movData  = sheetMov.getDataRange().getValues();
  for (let i = 1; i < movData.length; i++) {
    if (movData[i][0] === payload.id_mov) {
      sheetMov.getRange(i+1, 9).setValue(payload.adicionales); // col 9 = adicionales
      SpreadsheetApp.flush();
      return { message: '✅ Impuestos registrados.' };
    }
  }
  return { status: 'error', message: 'Movimiento no encontrado.' };
}

function zarparOperacion(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Operaciones');
  const data   = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === payload.id_operacion) {
      sheet.getRange(i+1, 7).setValue('En_Viaje');
      SpreadsheetApp.flush();
      return { message: '✅ Lancha Zarpada con éxito.' };
    }
  }
  return { status: 'error', message: 'Operación no encontrada.' };
}

// FIX #4: implementación real de cerrarOperacion (antes era un stub)
function cerrarOperacion(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Operaciones');
  const data   = sheet.getDataRange().getValues();

  let idOp = payload ? payload.id_operacion : null;
  if (!idOp) return { status: 'error', message: '❌ Se requiere id_operacion para cerrar.' };

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === idOp) {
      sheet.getRange(i+1, 7).setValue('Cerrada');
      // Guardar URL foto de zarpe si viene en payload
      if (payload.foto_zarpe_url) sheet.getRange(i+1, 10).setValue(payload.foto_zarpe_url);
      SpreadsheetApp.flush();

      // Calcular liquidación: suma de monto_total_cobrar de los movimientos de esta operación
      const movSheet = ss.getSheetByName('Movimientos');
      const movData  = movSheet.getDataRange().getValues();
      let totalCobrado = 0;
      for (let j = 1; j < movData.length; j++) {
        if (movData[j][1] === idOp) totalCobrado += parseFloat(movData[j][7]) || 0; // col 8 = monto_total_cobrar (índice 7)
      }

      return {
        message: '✅ Operación cerrada correctamente.',
        liquidacion: { total_a_entregar: totalCobrado }
      };
    }
  }
  return { status: 'error', message: '❌ Operación no encontrada.' };
}

// Pase directo desde reserva CRM (sin asignar a lancha)
// id_contacto = aliado destino, nombreContacto = contacto original del CRM
function paseDesdeReserva(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Marcar reserva como Pasado
  const sheetRes = ss.getSheetByName('Reservas_CRM');
  const dataRes  = sheetRes.getDataRange().getValues();
  for (let i = 1; i < dataRes.length; i++) {
    if (dataRes[i][0] === payload.id_reserva) {
      sheetRes.getRange(i+1, 7).setValue('Pasado');
      break;
    }
  }

  // Registrar movimiento como pase externo
  const sheetMov = ss.getSheetByName('Movimientos');
  const newMovId = 'MOV-' + Date.now().toString().slice(-6);
  sheetMov.appendRow([
    newMovId,                                          // col 1  id_mov
    'PASE_DIRECTO',                                   // col 2  id_operacion (no ligado a lancha)
    'Aliado(PaseOut)',                                // col 3  tipo_movimiento
    payload.aliado_id || payload.aliado,              // col 4  id_contacto = aliado destino
    payload.nombre_contacto_original,                 // col 5  nombreContacto = contacto CRM original
    payload.cant_pax,                                 // col 6  cant_pax
    0,                                                // col 7  precio_unitario
    0,                                                // col 8  monto_total
    '',                                               // col 9  adicionales
    payload.creador || 'App',                         // col 10 operador_registro
    new Date(),                                       // col 11 timestamp_registro
    'Pasado'                                          // col 12 estado_movimiento
  ]);
  SpreadsheetApp.flush();
  return { message: '✅ Pase registrado correctamente.' };
}

// Editar datos de una operación (capitán, guía, hora)
function editarOperacion(payload) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Operaciones');
  const data  = sheet.getDataRange().getValues();
  // Columnas Operaciones: id(1) fecha(2) hora_salida(3) id_bote(4) id_capitan(5) id_guia(6) estado(7)...
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === payload.id_operacion) {
      if (payload.id_capitan !== undefined) sheet.getRange(i+1, 5).setValue(payload.id_capitan);
      if (payload.id_guia    !== undefined) sheet.getRange(i+1, 6).setValue(payload.id_guia);
      if (payload.hora_salida !== undefined && payload.hora_salida !== '') sheet.getRange(i+1, 3).setValue(payload.hora_salida);
      SpreadsheetApp.flush();
      return { message: '✅ Operación actualizada.' };
    }
  }
  return { status: 'error', message: '❌ Operación no encontrada.' };
}
