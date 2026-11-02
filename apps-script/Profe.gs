// pianobot · el profe: Claude decide el siguiente paso de la práctica.
//
// La web manda (POST accion=profe) el resumen de los intentos y su contexto; aquí se llama a la API de Claude
// con el prompt del profe y se devuelve UNA instrucción: qué compases, qué mano, a qué tempo, cuántas veces,
// y qué decirle. Se apunta el gasto en «Gasto» y los intentos en «Intentos».
//
// La clave de la API va en las propiedades del script (ANTHROPIC_API_KEY), nunca en el repo.

// Modelos que se pueden elegir en la app. Haiku: el más rápido y barato. Sonnet y Opus: razonan más, cuestan más.
const MODELOS_PROFE = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const MODELO_PROFE = 'claude-haiku-5-5'; // por defecto
const VERSION_API = '2026-10-21';

// Precios en $ por millón de tokens (los mismos que js/gasto.js)
const PRECIOS = {
  'claude-haiku-5-5': { entrada: 0.1, salida: 0.5, largo: { umbral: 100000, entrada: 0.5, salida: 2.5 } },
  'claude-sonnet-5-5': { entrada: 2, salida: 10, lecturaCache: 0.2 },
  'claude-opus-5-5': { entrada: 4, salida: 20, lecturaCache: 0.2 },
};

const PROMPT_PROFE = [
  'Eres el profe de piano de Oscar. Estás a su lado mientras practica con una tablet que lee su piano digital:',
  'la app escucha cada nota, la compara con la partitura y te pasa un resumen de cada intento. Tú decides el',
  'siguiente paso, como un buen profe particular.',
  '',
  'Cómo hablas (campo «decir»):',
  '- En español, de tú, con frases cortas. Una sola indicación cada vez. Exigente pero sin sermones ni elogios vacíos.',
  '- Como mucho dos frases. Si algo concreto falla, nómbralo (compás, mano, qué pasa): «El 11 se te atasca en el salto».',
  '- No hace falta repetir el fragmento, la mano y el tempo: la app los enseña en pantalla.',
  '',
  'Qué decides:',
  '- accion: «repetir» (el mismo fragmento, quizá con otro tempo o mano), «cambiar» (otro fragmento: aislar un compás',
  '  que falla, ampliar, juntar), «avanzar» (siguiente tramo de la pieza), «descansar» (una pausa) o «terminar»',
  '  (cerrar la sesión).',
  '- desde y hasta: compases del fragmento (iguales para un solo compás). mano: «derecha», «izquierda» o «ambas».',
  '  tempo: negras por minuto del metrónomo. repeticiones: cuántas veces seguidas lo toca antes de que vuelvas a',
  '  hablar (de 1 a 6).',
  '- Sin reglas fijas: decide como un profe de verdad cuándo un pasaje está dominado, cuándo bajar o subir el tempo,',
  '  separar o juntar manos o avanzar, mirando el conjunto y los intentos anteriores. Lo nuevo se empieza lento; si',
  '  se atasca o se descuadra, baja el tempo o aísla el problema; cuando sale limpio varias veces, sube poco a poco',
  '  hacia el tempo objetivo o avanza. Fragmentos cortos (1-4 compases) para trabajar, más largos para consolidar.',
  '- Al empezar la sesión (sin intentos) parte del fragmento que Oscar tiene en pantalla, salvo que te pida otra cosa.',
  '- Si Oscar te dice algo (comentario), tenlo en cuenta antes que nada.',
  '',
  'Qué significan los datos de cada intento (por compás y mano):',
  '- Los intentos se tocan con el metrónomo, tras un compás de cuenta. tempo es el del metrónomo.',
  '- bien/notas: notas acertadas a tiempo. falladas: tocó otra nota o una de más. omitidas: se las saltó.',
  '- desajusteMs: media de cuánto se adelanta (−) o retrasa (+) respecto al metrónomo; desajusteAbsMs, su irregularidad.',
  '- articulacion: % del valor escrito que mantiene cada tecla (100 = legato pleno, 50 = picado). En Bach es normal',
  '  ligar las semicorcheas y separar algo las corcheas: no lo corrijas salvo que sea irregular o sucio.',
  '- titubeos: pausas largas. pedal: % del compás con el pedal pisado (en Bach, normalmente poco o nada).',
].join('\n');

const ESQUEMA_INSTRUCCION = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decir: { type: 'string', description: 'Lo que le dices a Oscar: una indicación, como mucho dos frases cortas.' },
    accion: { type: 'string', enum: ['repetir', 'cambiar', 'avanzar', 'descansar', 'terminar'] },
    desde: { type: 'integer', description: 'Primer compás del fragmento.' },
    hasta: { type: 'integer', description: 'Último compás del fragmento.' },
    mano: { type: 'string', enum: ['ambas', 'derecha', 'izquierda'] },
    tempo: { type: 'integer', description: 'Negras por minuto del metrónomo.' },
    repeticiones: { type: 'integer', description: 'Veces seguidas antes de volver a hablar (1-6).' },
  },
  required: ['decir', 'accion', 'desde', 'hasta', 'mano', 'tempo', 'repeticiones'],
};

/**
 * @param {object} p  {sesion, pieza: {titulo, compositor, compases, compas, tempoObjetivo}, ahora: {desde, hasta, mano, tempo},
 *                     intentos: [...] (los de este bloque), historial: [...] (bloques anteriores de la sesión), comentario}
 */
function pedirAlProfe(p) {
  const clave = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!clave) throw new Error('Falta la clave de la API de Claude: ponla en las propiedades del script (ANTHROPIC_API_KEY).');
  if (!p || !p.pieza || !p.ahora) throw new Error('Faltan datos para el profe.');
  const contexto = {
    pieza: p.pieza,
    enPantalla: p.ahora,
    intentos: p.intentos || [],
    anteriores: (p.historial || []).slice(-5),
    comentario: p.comentario || null,
    minutosDeSesion: p.minutos || 0,
  };
  const modeloPedido = MODELOS_PROFE.indexOf(p.modelo) >= 0 ? p.modelo : MODELO_PROFE;
  const cuerpo = {
    model: modeloPedido,
    max_tokens: 4096,
    system: PROMPT_PROFE,
    // Esfuerzo bajo: la decisión es sencilla y así responde en pocos segundos (también con Sonnet y Opus)
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA_INSTRUCCION } },
    messages: [{ role: 'user', content: JSON.stringify(contexto) }],
  };
  const cabeceras = { 'x-api-key': clave, 'anthropic-version': VERSION_API };
  if (modeloPedido !== 'claude-haiku-5-5') {
    // Sonnet y Opus: si sus filtros de seguridad rechazaran por error la petición, la API la repite sola con
    // otro modelo en la misma llamada, en vez de dejar al profe sin respuesta (Haiku no lo admite).
    cuerpo.fallbacks = 'default';
    cabeceras['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  const respuesta = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: cabeceras,
    payload: JSON.stringify(cuerpo),
    muteHttpExceptions: true,
  });
  const codigo = respuesta.getResponseCode();
  let datos;
  try {
    datos = JSON.parse(respuesta.getContentText());
  } catch (err) {
    throw new Error('La API de Claude ha respondido algo inesperado (código ' + codigo + ').');
  }
  if (codigo !== 200) throw new Error(errorDeLaApi(codigo, datos));
  if (datos.stop_reason === 'refusal') throw new Error('El profe no ha querido responder a esto. Prueba otra vez.');
  if (datos.stop_reason === 'max_tokens') throw new Error('La respuesta del profe se ha cortado. Prueba otra vez.');
  const texto = (datos.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  let instruccion;
  try {
    instruccion = JSON.parse(texto);
  } catch (err) {
    throw new Error('El profe ha respondido en un formato inesperado. Prueba otra vez.');
  }
  instruccion = validarInstruccion(instruccion, p);
  const modelo = datos.model || modeloPedido;
  const uso = datos.usage || {};
  const coste = costeLlamada(modelo, uso);
  apuntarEnElSheet(p, instruccion, modelo, uso, coste);
  return { instruccion: instruccion, modelo: modelo, uso: uso, coste: coste };
}

function errorDeLaApi(codigo, datos) {
  const mensaje = (datos && datos.error && datos.error.message) || '';
  if (codigo === 401) return 'La clave de la API de Claude no es válida.';
  if (/credit|balance/i.test(mensaje)) return 'No queda saldo en la cuenta de la API de Claude.';
  if (codigo === 429) return 'Demasiadas peticiones a la vez; espera un momento.';
  if (codigo === 529 || codigo >= 500) return 'La API de Claude está saturada ahora mismo; prueba otra vez.';
  return 'Error de la API de Claude (' + codigo + '): ' + mensaje;
}

/** Deja la instrucción dentro de lo que la app puede hacer (compases de la pieza, tempos razonables…). */
function validarInstruccion(i, p) {
  const entero = function (x, porDefecto) { const n = Math.round(Number(x)); return isFinite(n) ? n : porDefecto; };
  const total = entero(p.pieza.compases, 9999) || 9999;
  let desde = Math.min(Math.max(entero(i.desde, p.ahora.desde), 1), total);
  let hasta = Math.min(Math.max(entero(i.hasta, p.ahora.hasta), 1), total);
  if (hasta < desde) { const t = desde; desde = hasta; hasta = t; }
  return {
    decir: String(i.decir || '').trim().slice(0, 400),
    accion: ['repetir', 'cambiar', 'avanzar', 'descansar', 'terminar'].indexOf(i.accion) >= 0 ? i.accion : 'repetir',
    desde: desde,
    hasta: hasta,
    mano: ['ambas', 'derecha', 'izquierda'].indexOf(i.mano) >= 0 ? i.mano : (p.ahora.mano || 'ambas'),
    tempo: Math.min(Math.max(entero(i.tempo, p.ahora.tempo || 60), 20), 240),
    repeticiones: Math.min(Math.max(entero(i.repeticiones, 1), 1), 6),
  };
}

/** Coste en dólares de una llamada, con los precios de cada modelo. */
function costeLlamada(modelo, uso) {
  const precio = PRECIOS[modelo] || PRECIOS[MODELO_PROFE];
  const entrada = uso.input_tokens || 0;
  const salida = uso.output_tokens || 0;
  const lectura = uso.cache_read_input_tokens || 0;
  const escritura = uso.cache_creation_input_tokens || 0;
  const tarifa = precio.largo && entrada + lectura + escritura > precio.largo.umbral ? precio.largo : precio;
  const lecturaCache = tarifa.lecturaCache || tarifa.entrada * 0.1;
  return (entrada * tarifa.entrada + salida * tarifa.salida + lectura * lecturaCache + escritura * tarifa.entrada * 1.25) / 1e6;
}

const CABECERA_GASTO = ['Fecha', 'Sesión', 'Modelo', 'Tokens entrada', 'Tokens salida', 'Caché lectura', 'Caché escritura', 'Coste ($)'];
const CABECERA_INTENTOS = ['Sesión', 'Hora', 'Compases', 'Mano', 'Tempo (ppm)', 'Falladas', 'Omitidas', 'Titubeos', 'Desajuste (ms)',
  'Articulación (% del valor)', 'Pedal', 'Decisión del profe'];

function hoja_(nombre, cabecera) {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName(nombre);
  if (!hoja) {
    hoja = libro.insertSheet(nombre);
    hoja.getRange(1, 1, 1, cabecera.length).setValues([cabecera]).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function apuntarEnElSheet(p, instruccion, modelo, uso, coste) {
  const ahora = new Date();
  hoja_('Gasto', CABECERA_GASTO).appendRow([ahora, p.sesion || '', modelo, uso.input_tokens || 0, uso.output_tokens || 0,
    uso.cache_read_input_tokens || 0, uso.cache_creation_input_tokens || 0, coste]);
  const intentos = p.intentos || [];
  if (!intentos.length) return;
  const hoja = hoja_('Intentos', CABECERA_INTENTOS);
  intentos.forEach(function (it, k) {
    const t = it.total || {};
    const articulaciones = (it.filas || []).map(function (f) { return f.articulacion; }).filter(function (x) { return x != null; });
    const pedales = (it.pedal || []).map(function (x) { return x.pisadoPct; });
    hoja.appendRow([
      p.sesion || '', ahora, "'" + it.desde + '-' + it.hasta, it.mano, it.tempo,
      t.falladas || 0, t.omitidas || 0, t.titubeos || 0, t.desajusteMs == null ? '' : t.desajusteMs,
      articulaciones.length ? Math.round(articulaciones.reduce(function (a, b) { return a + b; }, 0) / articulaciones.length) : '',
      pedales.length ? Math.round(pedales.reduce(function (a, b) { return a + b; }, 0) / pedales.length) + ' %' : '',
      k === intentos.length - 1 ? instruccion.decir : '',
    ]);
  });
}
