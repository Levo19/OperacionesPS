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
    else if (action === 'registrar_transaccion')    { return jsonResponse(registrarTransaccion(data.payload)); }
    else if (action === 'cerrar_operacion')         { return jsonResponse(cerrarOperacion(data.payload)); }
    else if (action === 'abrir_operacion')          { return jsonResponse(abrirOperacion(data.payload)); }
    else if (action === 'asignar_reserva')          { return jsonResponse(asignarReserva(data.payload)); }
    else if (action === 'zarpar_operacion')         { return jsonResponse(zarparOperacion(data.payload)); }
    else if (action === 'registrar_caja_v2')        { return jsonResponse(registrarCajaV2(data.payload)); }
    else if (action === 'derivar_pase')             { return jsonResponse(derivarPase(data.payload)); }
    else if (action === 'anular_pase')              { return jsonResponse(anularPase(data.payload)); }
    else if (action === 'eliminar_movimiento')      { return jsonResponse(eliminarMovimiento(data.payload)); }
    else if (action === 'actualizar_adicionales')   { return jsonResponse(actualizarAdicionales(data.payload)); }
    else if (action === 'pase_desde_reserva')       { return jsonResponse(paseDesdeReserva(data.payload)); }
    else if (action === 'editar_operacion')         { return jsonResponse(editarOperacion(data.payload)); }
    else if (action === 'subir_foto_zarpe')         { return jsonResponse(subirFotoZarpe(data.payload)); }
    else if (action === 'guardar_cierre')           { return jsonResponse(guardarCierre(data.payload)); }
    else if (action === 'confirmar_llegada')        { return jsonResponse(confirmarLlegada(data.payload)); }
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

  // Recursos (bote/capitán/guía) solo se bloquean por operaciones Abiertas del día de HOY.
  // Operaciones de días anteriores que quedaron sin cerrar NO bloquean recursos al día siguiente.
  const hoyISO = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const operacionesAbiertas = todasOperaciones.filter(op => {
    if (op.estado !== 'Abierta') return false;
    let fechaOp = parseDateForJS(op.fecha);
    return fechaOp === hoyISO;
  });
  const botesOcupados     = operacionesAbiertas.map(op => op.id_bote);
  const capitanesOcupados = operacionesAbiertas.map(op => op.id_capitan);
  const guiasOcupados     = operacionesAbiertas.map(op => op.id_guia);

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
      foto_zarpe: op.foto_zarpe_url || '',
      manifiesto: movsActivos.map(m => ({
        id: m.id_mov,
        tipo: m.tipo_movimiento,
        contacto: m.id_contacto,
        nombreContacto: m.nombreContacto || m.id_contacto,
        pax: m.cant_pax,
        monto: m.monto_total_cobrar,
        estado: m.estado_movimiento,
        id_contactoPase: m.Id_contactoPase || '',
        adicionales: m.adicionales || ''
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

  // Caja_Operador: nueva estructura positional
  // cols: 0=id_transaccion 1=id_operacion 2=Id_Contacto 3=categoria 4=monto
  //        5=metodo_pago 6=comentarios 7=foto_comprobante_url 8=operador_caja 9=timestamp
  const movimientosCaja = sheetToJSON('Caja_Operador').map(c => {
    let v = Object.values(c);
    return {
      id:           v[0] || '',
      id_operacion: v[1] || '',
      id_contacto:  v[2] || '',
      categoria:    v[3] || '',
      monto:        parseFloat(v[4]) || 0,
      metodo_pago:  v[5] || '',
      comentarios:  v[6] || '',
      foto_url:     v[7] || '',
      operador:     v[8] || '',
      timestamp:    formatTimestamp(v[9])
    };
  });

  // Pases: todos los movimientos con aliado destino (Id_contactoPase con valor).
  // El frontend filtra por esFechaHoy() para la vista "Hoy" y muestra todo en "Histórico".
  const pasesExternos = todosMovimientos
    .filter(m => (m.Id_contactoPase || '').toString().trim() !== '')
    .map(m => ({
      id:            m.id_mov,
      tipo:          m.tipo_movimiento,
      aliadoId:      (m.Id_contactoPase || '').toString().trim(),   // ID del aliado destino (col 13)
      origenId:      (m.id_contacto     || '').toString().trim(),   // contacto original (col 4)
      nombreOrigen:  (m.nombreContacto  || m.id_contacto || '').toString(), // nombre del pasajero/agencia
      pax:           m.cant_pax,
      monto:         m.monto_total_cobrar,
      estado:        m.estado_movimiento,
      timestamp:     formatTimestamp(m.timestamp_registro)
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
      impuestos:       sheetToJSON('Impuestos').map(i => { let v = Object.values(i); return { id: v[0], nombre: v[1], monto: parseFloat(v[2])||0 }; }).filter(i => i.id && i.nombre),
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
    let estado = (movData[i][11] || '').toString().toLowerCase(); // col 12 = estado_movimiento (índice 11)
    if (movData[i][1] === id_operacion && movData[i][0] !== ignore_mov_id
        && !estado.includes('pasado') && !estado.includes('cancelado')) {
      ocupados += parseInt(movData[i][5])||0; // col 6 = cant_pax (índice 5)
    }
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

// Columnas Movimientos: id_mov(1) | id_operacion(2) | tipo_movimiento(3) | id_contacto(4) |
//   nombreContacto(5) | cant_pax(6) | precio_unitario_aplicado(7) | monto_total_cobrar(8) |
//   adicionales(9) | operador_registro(10) | timestamp_registro(11) | estado_movimiento(12) |
//   Id_contactoPase(13) ← ID del aliado destino cuando se hace un pase (col 4 conserva el contacto original)
function registrarMovimientoPax(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Validar que la operación exista y esté en estado Abierta
  const opsSheet = ss.getSheetByName('Operaciones');
  const opsData  = opsSheet.getDataRange().getValues();
  let opEstado = null;
  for (let i = 1; i < opsData.length; i++) {
    if (String(opsData[i][0]) === String(payload.id_operacion)) {
      opEstado = (opsData[i][6] || '').toString().trim();
      break;
    }
  }
  if (!opEstado || opEstado !== 'Abierta') {
    return { status: 'error', message: '❌ No se puede embarcar: la lancha ya zarpó o está cerrada.' };
  }

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
    payload.nombre_contacto || payload.contacto,   // col 5  nombreContacto
    payload.pax,                                   // col 6  cant_pax
    payload.precio_unitario,                       // col 7  precio_unitario_aplicado
    payload.monto_total,                           // col 8  monto_total_cobrar
    '',                                            // col 9  adicionales
    payload.creador || 'App',                      // col 10 operador_registro
    new Date(),                                    // col 11 timestamp_registro
    'Embarcado',                                   // col 12 estado_movimiento
    ''                                             // col 13 Id_contactoPase (vacío al crear)
  ]);
  SpreadsheetApp.flush();
  return { message: '✅ Abordaje directo registrado en Manifiesto.', id_mov: newId };
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
    payload.nombre_contacto || payload.id_contacto,       // col 5  nombreContacto
    payload.cant_pax,                                     // col 6  cant_pax
    parseFloat(payload.precio_unitario) || 0,             // col 7  precio_unitario_aplicado
    parseFloat(payload.monto_total) || 0,                 // col 8  monto_total_cobrar
    '',                                                   // col 9  adicionales
    payload.creador || 'App',                             // col 10 operador_registro
    new Date(),                                           // col 11 timestamp_registro
    'Embarcado',                                          // col 12 estado_movimiento
    ''                                                    // col 13 Id_contactoPase (vacío al crear)
  ]);
  SpreadsheetApp.flush();
  return { message: '✅ Pasajeros asignados al Bote.' };
}

// Deprecado — mantenido por compatibilidad
function registrarCaja(payload) { return registrarTransaccion(payload); }
function registrarCajaV2(payload) { return registrarTransaccion(payload); }

// Nueva estructura Caja_Operador:
// id_transaccion | id_operacion | Id_Contacto | categoria | monto | metodo_pago | comentarios | foto_comprobante_url | operador_caja | timestamp
// payload: { id_operacion, id_contacto, categoria, monto, metodo_pago, comentarios, foto_base64, operador }
function registrarTransaccion(payload) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Caja_Operador');
    const newId = 'TX-' + Date.now().toString().slice(-6);

    // Subir foto comprobante a Drive/Comprobantes si se proveyó
    let fotoUrl = '';
    if (payload.foto_base64) {
      let base64 = payload.foto_base64.replace(/^data:image\/\w+;base64,/, '');
      if (base64) {
        let hoy      = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        let filename = hoy + ' ' + newId + '.jpg';
        let blob     = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', filename);
        let folder   = getOrCreateSubfolder('Comprobantes');
        let file     = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        fotoUrl = 'https://drive.google.com/uc?id=' + file.getId();
      }
    }

    sheet.appendRow([
      newId,
      payload.id_operacion  || '',
      payload.id_contacto   || '',
      payload.categoria     || 'Cobro',
      parseFloat(payload.monto) || 0,
      payload.metodo_pago   || 'Efectivo',
      payload.comentarios   || '',
      fotoUrl,
      payload.operador      || '',
      new Date()
    ]);
    SpreadsheetApp.flush();
    return { message: '✅ Transacción registrada.', id_transaccion: newId, foto_url: fotoUrl };
  } catch(e) {
    return { status: 'error', message: e.toString() };
  }
}

function derivarPase(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetMov = ss.getSheetByName('Movimientos');
  const movData  = sheetMov.getDataRange().getValues();
  for (let i = 1; i < movData.length; i++) {
    if (movData[i][0] === payload.id_mov) {
      // col 2 (id_operacion) y col 4 (id_contacto) se conservan — no se sobreescriben
      sheetMov.getRange(i+1, 3).setValue('Aliado(PaseOut)');                     // tipo_movimiento
      // col 4 (id_contacto): conserva el contacto/agencia original del pasajero
      // col 5 (nombreContacto): conserva el nombre original — NO se toca
      sheetMov.getRange(i+1, 10).setValue(payload.operador || 'App');            // operador_registro (quien hace el pase)
      sheetMov.getRange(i+1, 11).setValue(new Date());                           // timestamp_registro (momento del pase)
      sheetMov.getRange(i+1, 12).setValue('Pasado');                             // estado_movimiento
      sheetMov.getRange(i+1, 13).setValue(payload.aliado_id || payload.aliado);  // Id_contactoPase = aliado destino
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

// Confirmar llegada de una lancha En_Viaje → la cierra y registra hora de llegada
function confirmarLlegada(payload) {
  if (!payload || !payload.id_operacion) return { status: 'error', message: '❌ Se requiere id_operacion.' };
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Operaciones');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === payload.id_operacion) {
      sheet.getRange(i+1, 7).setValue('Cerrada');
      // Col 11 = hora_llegada si existe, si no se ignora
      try { sheet.getRange(i+1, 11).setValue(new Date()); } catch(e) {}
      SpreadsheetApp.flush();
      return { message: '✅ Llegada confirmada. Recursos liberados.' };
    }
  }
  return { status: 'error', message: '❌ Operación no encontrada.' };
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

// Helper: obtiene (o crea) una subcarpeta por nombre dentro de la carpeta del Spreadsheet
function getOrCreateSubfolder(nombreCarpeta) {
  const ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
  const fileId     = ss.getId();
  const ssFile     = DriveApp.getFileById(fileId);
  const parentIter = ssFile.getParents();
  const parent     = parentIter.hasNext() ? parentIter.next() : DriveApp.getRootFolder();
  const existing   = parent.getFoldersByName(nombreCarpeta);
  return existing.hasNext() ? existing.next() : parent.createFolder(nombreCarpeta);
}

// Guardar foto de zarpe (base64) en Drive/Zarpes y URL en Operaciones col 10
// payload: { id_operacion, foto_base64, hora_salida }
function subirFotoZarpe(payload) {
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Operaciones');
    const data  = sheet.getDataRange().getValues();

    let base64 = (payload.foto_base64 || '').replace(/^data:image\/\w+;base64,/, '');
    if(!base64) return { status: 'error', message: 'Sin imagen.' };

    // Nombre: [fecha] [hora_salida] [id_operacion]
    let hoy      = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    let horaNorm = (payload.hora_salida || '').replace(/:/g, '-') || 'sin-hora';
    let filename = hoy + ' ' + horaNorm + ' ' + (payload.id_operacion || 'OP') + '.jpg';

    let blob   = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', filename);
    let folder = getOrCreateSubfolder('Zarpes');
    let file   = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    let url    = 'https://drive.google.com/uc?id=' + file.getId();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === payload.id_operacion) {
        sheet.getRange(i+1, 10).setValue(url);
        SpreadsheetApp.flush();
        return { message: '✅ Foto guardada.', url };
      }
    }
    return { status: 'error', message: 'Operación no encontrada.' };
  } catch(e) {
    return { status: 'error', message: e.toString() };
  }
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
    payload.id_contacto_original || '',               // col 4  id_contacto = contacto CRM original
    payload.nombre_contacto_original,                 // col 5  nombreContacto = nombre CRM original
    payload.cant_pax,                                 // col 6  cant_pax
    0,                                                // col 7  precio_unitario
    0,                                                // col 8  monto_total
    '',                                               // col 9  adicionales
    payload.creador || 'App',                         // col 10 operador_registro
    new Date(),                                       // col 11 timestamp_registro
    'Pasado',                                         // col 12 estado_movimiento
    payload.aliado_id || payload.aliado               // col 13 Id_contactoPase = aliado destino
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

// Guardar reporte de cierre del día como archivo HTML en Drive/Cierres
// payload: { html, nombre }  →  nombre ej: "Cierre 2026-03-31 14-30"
function guardarCierre(payload) {
  try {
    if (!payload.html || !payload.nombre) return { status: 'error', message: 'Faltan datos.' };
    let folder   = getOrCreateSubfolder('Cierres');
    let filename = payload.nombre + '.html';
    let blob     = Utilities.newBlob(payload.html, 'text/html', filename);
    let file     = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    let url = 'https://drive.google.com/file/d/' + file.getId() + '/view';
    return { url, nombre: payload.nombre };
  } catch(e) {
    return { status: 'error', message: e.toString() };
  }
}

// Anular un pase: limpia Id_contactoPase, reasigna id_operacion y restaura estado a Embarcado
// payload: { id_mov, id_operacion_nueva }
function anularPase(payload) {
  if (!payload.id_mov || !payload.id_operacion_nueva) {
    return { status: 'error', message: 'Faltan id_mov o id_operacion_nueva.' };
  }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetMov = ss.getSheetByName('Movimientos');
  const movData  = sheetMov.getDataRange().getValues();
  for (let i = 1; i < movData.length; i++) {
    if (movData[i][0] === payload.id_mov) {
      sheetMov.getRange(i+1, 2).setValue(payload.id_operacion_nueva);  // col 2  id_operacion
      sheetMov.getRange(i+1, 3).setValue('Libre');                     // col 3  tipo_movimiento (reset a Libre)
      sheetMov.getRange(i+1, 12).setValue('Embarcado');                // col 12 estado_movimiento
      sheetMov.getRange(i+1, 13).setValue('');                         // col 13 Id_contactoPase → vaciar
      SpreadsheetApp.flush();
      return { message: '✅ Pase anulado. Movimiento reasignado a ' + payload.id_operacion_nueva + '.' };
    }
  }
  return { status: 'error', message: 'Movimiento no encontrado.' };
}
