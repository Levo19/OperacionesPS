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
    let paxOcupados = movsBote.reduce((sum, m) => sum + (parseInt(m.cant_pax)||0), 0);

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
      manifiesto: movsBote.map(m => ({
        id: m.id_mov,
        tipo: m.tipo_movimiento,
        contacto: m.id_contacto,
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

  // FIX #9: campo correcto es timestamp_registro (no timestamp_regis)
  const pasesExternos = todosMovimientos
    .filter(m => m.id_operacion === 'EXTERNO')
    .map(m => ({
      id: m.id_mov,
      tipo: m.tipo_movimiento,
      contacto: m.id_contacto,
      pax: m.cant_pax,
      monto: m.monto_total_cobrar,
      estado: m.estado_movimiento,
      timestamp: formatTimestamp(m.timestamp_registro)   // FIX: nombre correcto
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
      contactos: contactosCat
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
    if (movData[i][1] === id_operacion && movData[i][0] !== ignore_mov_id) ocupados += parseInt(movData[i][4])||0;
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
    newId,                        // id_mov
    payload.id_operacion,         // id_operacion
    payload.tipo,                 // tipo_movimiento
    payload.contacto,             // id_contacto
    payload.pax,                  // cant_pax
    payload.precio_unitario,      // precio_unitario_aplicado
    payload.monto_total,          // monto_total_cobrar
    '',                           // adicionales (vacío)
    payload.creador || 'App',     // operador_registro  ← FIX
    new Date(),                   // timestamp_registro ← FIX
    'Embarcado'                   // estado_movimiento  ← FIX (columna 11, antes faltaba)
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
      sheetMov.getRange(i+1, 4).setValue(payload.contacto);
      sheetMov.getRange(i+1, 5).setValue(payload.pax);
      sheetMov.getRange(i+1, 6).setValue(payload.precio_unitario);
      sheetMov.getRange(i+1, 7).setValue(payload.monto_total);
      // FIX: columna 11 es estado_movimiento (índice 10)
      let estadoActual = movData[i][10] || '';
      if (!estadoActual.includes('(Editado)')) {
        sheetMov.getRange(i+1, 11).setValue(estadoActual + ' (Editado)');
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
    newMovId,                          // id_mov
    payload.id_operacion,              // id_operacion
    'Abordaje_CRM',                    // tipo_movimiento
    payload.id_contacto,               // id_contacto
    payload.cant_pax,                  // cant_pax
    0,                                 // precio_unitario_aplicado
    0,                                 // monto_total_cobrar
    '',                                // adicionales  ← FIX (antes tenía payload.creador)
    payload.creador || 'App',          // operador_registro ← FIX
    new Date(),                        // timestamp_registro ← FIX
    'Registrado'                       // estado_movimiento  ← FIX (columna 11, antes faltaba)
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
      sheetMov.getRange(i+1, 2).setValue('EXTERNO');
      sheetMov.getRange(i+1, 11).setValue('Pase Emitido a ' + payload.aliado); // FIX: col 11 = estado_movimiento
      SpreadsheetApp.flush();
      return { message: '🚀 Pase derivado a ' + payload.aliado + '. Cupo liberado.' };
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
        if (movData[j][1] === idOp) totalCobrado += parseFloat(movData[j][6]) || 0;
      }

      return {
        message: '✅ Operación cerrada correctamente.',
        liquidacion: { total_a_entregar: totalCobrado }
      };
    }
  }
  return { status: 'error', message: '❌ Operación no encontrada.' };
}
