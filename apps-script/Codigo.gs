// pianobot · Apps Script: el puente entre la web (GitHub Pages) y tu Google Drive y el Sheet «pianobot».
//
// Va enlazado al Sheet (Extensiones → Apps Script) y se publica como aplicación web.
//   GET  …/exec?accion=hola&token=…              comprueba que la conexión y el token funcionan
//   GET  …/exec?accion=piezas&token=…            el catálogo: todas las partituras de la carpeta «piezas»
//   GET  …/exec?accion=pieza&id=…&token=…        el MusicXML de una pieza
//   POST …/exec  {"accion":"subir","token":…,"nombre":…,"base64":…}   guarda una partitura nueva en Drive
//   POST …/exec  {"accion":"guardar","token":…,"id":…,"musicxml":…}    guarda cambios (p. ej. la digitación)
//   POST …/exec  {"accion":"profe","token":…,"peticion":{…}}            el profe decide el siguiente paso (Profe.gs)
//
// Para añadir una pieza basta con meter el fichero en pianobot/piezas (o subirlo desde la app):
// el script lee de la partitura el título, el compositor, los compases, el compás y el tempo,
// y la apunta él solo en la pestaña «Piezas». Esa pestaña se puede retocar a mano (p. ej. el tempo objetivo).
//
// El token es una contraseña que solo conocen este script y tu tablet: sin él, nadie puede usar la URL.
// Se crea ejecutando una vez la función «configurar» (sale en el registro de ejecución).

// Carpeta de Drive con las partituras (pianobot/piezas). Admite .musicxml, .xml y .mxl (MusicXML comprimido).
const CARPETA_PIEZAS = '1GIa0Q2c4k_3Gu-2L4rtiDd47DoSe2IB9';
const EXTENSIONES = /\.(musicxml|xml|mxl)$/i;

// Pestaña «Piezas»: columna → campo que recibe la web. «ID de Drive» enlaza cada fila con su fichero.
const CABECERA_PIEZAS = ['ID', 'Título', 'Compositor', 'Fichero', 'Compases', 'Compás', 'Tempo objetivo (ppm)', 'ID de Drive'];
const CAMPOS_PIEZAS = ['id', 'titulo', 'compositor', 'fichero', 'compases', 'compas', 'tempoObjetivo', 'idDrive'];

function doGet(e) {
  return atender(function () {
    const p = (e && e.parameter) || {};
    comprobarToken(p.token);
    switch (p.accion) {
      case 'hola':
        return { ok: true, hoja: SpreadsheetApp.getActiveSpreadsheet().getName() };
      case 'piezas':
        return { piezas: catalogo() };
      case 'pieza':
        return { id: p.id, musicxml: leerPartitura(p.id) };
      default:
        throw new Error('Acción desconocida: ' + p.accion);
    }
  });
}

// La web manda el cuerpo como texto plano (JSON dentro) para que el navegador no bloquee la petición.
function doPost(e) {
  return atender(function () {
    let p;
    try {
      p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (err) {
      throw new Error('Petición mal formada.');
    }
    comprobarToken(p.token);
    switch (p.accion) {
      case 'subir':
        return { pieza: subirPartitura(p.nombre, p.base64) };
      case 'guardar':
        return { pieza: guardarPartitura(p.id, p.musicxml) };
      case 'profe':
        return pedirAlProfe(p.peticion);
      default:
        throw new Error('Acción desconocida: ' + p.accion);
    }
  });
}

/** Ejecútala una vez a mano: crea el token (si no hay) y pide los permisos de Drive y del Sheet. */
function configurar() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  // Tocar Drive, el Sheet y la conexión a internet hace que Google pida los permisos ahora, no en la primera
  // llamada de la web (si falta alguno, la web no puede ni cargar las partituras).
  DriveApp.getFolderById(CARPETA_PIEZAS).getName();
  hojaPiezas();
  UrlFetchApp.getRequest('https://api.anthropic.com/v1/messages');
  Logger.log(props.getProperty('ANTHROPIC_API_KEY') ? 'Clave de la API de Claude: puesta.' : 'Falta la clave de la API de Claude (ANTHROPIC_API_KEY en las propiedades del script).');
  Logger.log('Token para la tablet (cópialo en pianobot → Drive): ' + token);
  return token;
}

function atender(funcion) {
  let datos;
  try {
    datos = funcion();
  } catch (err) {
    datos = { error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(datos)).setMimeType(ContentService.MimeType.JSON);
}

function comprobarToken(token) {
  const esperado = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!esperado) throw new Error('Falta configurar el Apps Script: ejecuta la función «configurar».');
  if (!token || token !== esperado) throw new Error('Token incorrecto.');
}

// ---------- Catálogo ----------

/** Las piezas de la carpeta, apuntando antes en «Piezas» las que sean nuevas. */
function catalogo() {
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(20000);
  try {
    return catalogoSinBloqueo();
  } finally {
    bloqueo.releaseLock();
  }
}

function catalogoSinBloqueo() {
  const hoja = hojaPiezas();
  const filas = leerFilas(hoja);
  const porDrive = {};
  filas.forEach(function (f) { porDrive[f.idDrive] = f; });
  const usados = {};
  filas.forEach(function (f) { usados[f.id] = true; });

  const piezas = [];
  const ficheros = DriveApp.getFolderById(CARPETA_PIEZAS).getFiles();
  while (ficheros.hasNext()) {
    const fichero = ficheros.next();
    if (!EXTENSIONES.test(fichero.getName())) continue;
    let pieza = porDrive[fichero.getId()];
    if (!pieza) {
      pieza = registrar(hoja, fichero, usados);
      usados[pieza.id] = true;
    }
    piezas.push(pieza);
  }
  piezas.sort(function (a, b) { return String(a.titulo).localeCompare(String(b.titulo), 'es'); });
  return piezas;
}

function hojaPiezas() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let hoja = libro.getSheetByName('Piezas');
  if (!hoja) hoja = libro.insertSheet('Piezas', 0);
  const actual = hoja.getRange(1, 1, 1, CABECERA_PIEZAS.length).getValues()[0].map(String);
  if (actual.join('|') !== CABECERA_PIEZAS.join('|')) {
    hoja.getRange(1, 1, 1, CABECERA_PIEZAS.length).setValues([CABECERA_PIEZAS]).setFontWeight('bold');
    hoja.setFrozenRows(1);
  }
  return hoja;
}

function leerFilas(hoja) {
  const n = hoja.getLastRow() - 1;
  if (n < 1) return [];
  return hoja.getRange(2, 1, n, CABECERA_PIEZAS.length).getValues()
    .filter(function (f) { return String(f[7]).trim() !== ''; })
    .map(function (f) {
      const pieza = {};
      CAMPOS_PIEZAS.forEach(function (campo, i) { pieza[campo] = typeof f[i] === 'string' ? f[i].trim() : f[i]; });
      return pieza;
    });
}

/** Lee los datos de la partitura y añade su fila a «Piezas». */
function registrar(hoja, fichero, usados) {
  const datos = datosDePartitura(textoMusicXml(fichero.getBlob()), fichero.getName());
  let id = identificador(fichero.getName());
  for (let i = 2; usados[id]; i++) id = identificador(fichero.getName()) + '-' + i;
  const pieza = {
    id: id,
    titulo: datos.titulo,
    compositor: datos.compositor,
    fichero: fichero.getName(),
    compases: datos.compases,
    compas: datos.compas,
    tempoObjetivo: datos.tempo,
    idDrive: fichero.getId(),
  };
  // Apóstrofo delante del compás y del ID para que el Sheet no los convierta en fecha o número.
  hoja.appendRow(CAMPOS_PIEZAS.map(function (c) {
    return c === 'compas' || c === 'id' ? "'" + pieza[c] : pieza[c];
  }));
  return pieza;
}

/** «BWV_0784 (Bach).musicxml» → «bwv_0784-bach» */
function identificador(nombre) {
  return String(nombre).replace(EXTENSIONES, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^-+|-+$/g, '') || 'pieza';
}

/** Título, compositor, número de compases, compás y tempo, leídos del propio MusicXML. */
function datosDePartitura(xml, nombreFichero) {
  const texto = function (re) {
    const m = xml.match(re);
    return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  };
  // Ficheros convertidos de Capella: título y autor escritos como texto en los dos primeros compases
  const primeros = (xml.match(/<measure[\s>][\s\S]*?<\/measure>/g) || []).slice(0, 2).join('');
  const palabras = [];
  primeros.replace(/<words([^>]*)>([\s\S]*?)<\/words>/g, function (_, atributos, contenido) {
    const tam = (atributos.match(/font-size="([\d.]+)"/) || [])[1];
    palabras.push({ texto: contenido.trim(), tam: Number(tam || 0), derecha: /justify="right"/.test(atributos) });
    return '';
  });
  const tituloEnTexto = (palabras.filter(function (p) { return p.tam >= 14; })[0] || {}).texto;
  const autorEnTexto = (palabras.filter(function (p) { return p.derecha && (/\n/.test(p.texto) || /\b(BWV|Op\.?|KV|K\.|Hob\.?|WoO|D\.)\s*\d/i.test(p.texto)); })[0] || {}).texto;
  const titulo = texto(/<work-title>([\s\S]*?)<\/work-title>/) || texto(/<movement-title>([\s\S]*?)<\/movement-title>/) ||
    (tituloEnTexto ? tituloEnTexto.replace(/\.$/, '') : '') || String(nombreFichero).replace(EXTENSIONES, '');
  const compositor = texto(/<creator[^>]*type="composer"[^>]*>([\s\S]*?)<\/creator>/) ||
    (autorEnTexto ? autorEnTexto.split('\n')[0].trim() : '');
  const primeraParte = (xml.match(/<part\s[^>]*id="[^"]*"[^>]*>([\s\S]*?)<\/part>/) || [])[1] || '';
  const compases = (primeraParte.match(/<measure[\s>]/g) || []).length;
  const tiempos = xml.match(/<beats>(\d+)<\/beats>\s*<beat-type>(\d+)<\/beat-type>/);
  const tempo = xml.match(/<sound[^>]*\stempo="([\d.]+)"/);
  return {
    titulo: titulo,
    compositor: compositor,
    compases: compases,
    compas: tiempos ? tiempos[1] + '/' + tiempos[2] : '',
    tempo: tempo ? Math.round(Number(tempo[1])) : '',
  };
}

// ---------- Partituras ----------

function leerPartitura(id) {
  const pieza = catalogo().filter(function (p) { return String(p.id) === String(id); })[0];
  if (!pieza) throw new Error('No encuentro la pieza «' + id + '» en la carpeta pianobot/piezas.');
  return textoMusicXml(DriveApp.getFileById(pieza.idDrive).getBlob());
}

/** Guarda en la carpeta una partitura que llega de la app y la apunta en el catálogo. */
function subirPartitura(nombre, base64) {
  nombre = String(nombre || '').trim().replace(/[\\/]/g, '-');
  if (!EXTENSIONES.test(nombre)) throw new Error('Solo se admiten ficheros .musicxml, .xml o .mxl.');
  if (!base64) throw new Error('El fichero está vacío.');
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'application/octet-stream', nombre);
  textoMusicXml(blob); // comprueba que se puede leer antes de guardarlo
  const carpeta = DriveApp.getFolderById(CARPETA_PIEZAS);
  if (carpeta.getFilesByName(nombre).hasNext()) throw new Error('Ya hay un fichero «' + nombre + '» en la carpeta.');
  const fichero = carpeta.createFile(blob);
  return catalogo().filter(function (p) { return p.idDrive === fichero.getId(); })[0];
}

/**
 * Sobrescribe la partitura de una pieza con el MusicXML que manda la app (p. ej. con digitación nueva).
 * Drive guarda las versiones anteriores del fichero (clic derecho → Gestionar versiones).
 * Si la pieza era un .mxl (comprimido), se guarda como .musicxml al lado, la fila de «Piezas» pasa a apuntar
 * al nuevo y el .mxl va a la papelera (se puede recuperar durante 30 días).
 */
function guardarPartitura(id, xml) {
  xml = String(xml || '');
  if (!/<score-(partwise|timewise)[\s>]/.test(xml) || !/<\/score-(partwise|timewise)>\s*$/.test(xml)) {
    throw new Error('Lo recibido no es una partitura MusicXML completa: no se guarda nada.');
  }
  const bloqueo = LockService.getScriptLock();
  bloqueo.waitLock(20000);
  try {
    const pieza = catalogoSinBloqueo().filter(function (p) { return String(p.id) === String(id); })[0];
    if (!pieza) throw new Error('No encuentro la pieza «' + id + '».');
    const fichero = DriveApp.getFileById(pieza.idDrive);
    const bytes = fichero.getBlob().getBytes();
    const esZip = bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (!esZip) {
      fichero.setContent(xml);
      return pieza;
    }
    const nombre = fichero.getName().replace(/\.mxl$/i, '') + '.musicxml';
    const nuevo = DriveApp.getFolderById(CARPETA_PIEZAS).createFile(nombre, xml, 'application/xml');
    const hoja = hojaPiezas();
    const columnaDrive = CABECERA_PIEZAS.indexOf('ID de Drive') + 1;
    const columnaFichero = CABECERA_PIEZAS.indexOf('Fichero') + 1;
    const ids = hoja.getRange(2, columnaDrive, Math.max(hoja.getLastRow() - 1, 1), 1).getValues();
    ids.forEach(function (fila, i) {
      if (String(fila[0]) === pieza.idDrive) {
        hoja.getRange(i + 2, columnaFichero).setValue(nombre);
        hoja.getRange(i + 2, columnaDrive).setValue(nuevo.getId());
      }
    });
    fichero.setTrashed(true);
    pieza.fichero = nombre;
    pieza.idDrive = nuevo.getId();
    return pieza;
  } finally {
    bloqueo.releaseLock();
  }
}

/** Devuelve el MusicXML como texto, descomprimiéndolo si es un .mxl (un zip). */
function textoMusicXml(blob) {
  const bytes = blob.getBytes();
  const esZip = bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b; // «PK»
  let xml;
  if (!esZip) {
    xml = blob.getDataAsString('UTF-8');
  } else {
    const partes = Utilities.unzip(blob.setContentType('application/zip'));
    const porNombre = {};
    partes.forEach(function (b) { porNombre[b.getName()] = b; });
    let ruta = null;
    const contenedor = porNombre['META-INF/container.xml'];
    if (contenedor) {
      const m = contenedor.getDataAsString('UTF-8').match(/full-path="([^"]+)"/);
      if (m) ruta = m[1];
    }
    if (!ruta) {
      ruta = Object.keys(porNombre).filter(function (n) { return !/^META-INF\//.test(n) && /\.(xml|musicxml)$/i.test(n); })[0];
    }
    if (!ruta || !porNombre[ruta]) throw new Error('El .mxl no contiene ninguna partitura MusicXML.');
    xml = porNombre[ruta].getDataAsString('UTF-8');
  }
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  if (!/<score-(partwise|timewise)[\s>]/.test(xml)) throw new Error('El fichero no es una partitura MusicXML.');
  return xml;
}
