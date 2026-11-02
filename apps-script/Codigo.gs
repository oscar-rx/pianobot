// pianobot · Apps Script: el puente entre la web (GitHub Pages) y tu Google Drive y el Sheet «pianobot».
//
// Va enlazado al Sheet (Extensiones → Apps Script) y se publica como aplicación web.
// La web le pide cosas con GET:  …/exec?accion=…&token=…
//   accion=hola                 comprueba que la conexión y el token funcionan
//   accion=piezas               el catálogo (pestaña «Piezas»)
//   accion=pieza&id=bwv784      el MusicXML de una pieza, leído de la carpeta «piezas» de Drive
//
// El token es una contraseña que solo conocen este script y tu tablet: sin él, nadie puede usar la URL.
// Se crea ejecutando una vez la función «configurar» (sale en el registro de ejecución).

// Carpeta de Drive con las partituras (pianobot/piezas). Admite .musicxml, .xml y .mxl (MusicXML comprimido).
const CARPETA_PIEZAS = '1GIa0Q2c4k_3Gu-2L4rtiDd47DoSe2IB9';

// Columnas de la pestaña «Piezas» → nombre del campo que recibe la web
const COLUMNAS_PIEZAS = {
  'ID': 'id',
  'Título': 'titulo',
  'Compositor': 'compositor',
  'Catálogo': 'catalogo',
  'Fichero': 'fichero',
  'Compases': 'compases',
  'Compás': 'compas',
  'Tempo objetivo (ppm)': 'tempoObjetivo',
};

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    comprobarToken(p.token);
    switch (p.accion) {
      case 'hola':
        return respuesta({ ok: true, hoja: SpreadsheetApp.getActiveSpreadsheet().getName() });
      case 'piezas':
        return respuesta({ piezas: leerPiezas() });
      case 'pieza':
        return respuesta({ id: p.id, musicxml: leerPartitura(p.id) });
      default:
        throw new Error('Acción desconocida: ' + p.accion);
    }
  } catch (err) {
    return respuesta({ error: err.message });
  }
}

/** Ejecútala una vez a mano: crea el token (si no hay) y pide los permisos de Drive y del Sheet. */
function configurar() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  // Tocar Drive y el Sheet hace que Google pida los permisos ahora, no en la primera llamada de la web.
  DriveApp.getFolderById(CARPETA_PIEZAS).getName();
  SpreadsheetApp.getActiveSpreadsheet().getName();
  Logger.log('Token para la tablet (cópialo en pianobot → Conexión): ' + token);
  return token;
}

function comprobarToken(token) {
  const esperado = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!esperado) throw new Error('Falta configurar el Apps Script: ejecuta la función «configurar».');
  if (!token || token !== esperado) throw new Error('Token incorrecto.');
}

function leerPiezas() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Piezas');
  if (!hoja) throw new Error('No encuentro la pestaña «Piezas».');
  const filas = hoja.getDataRange().getValues();
  const cabecera = filas.shift().map(function (c) { return String(c).trim(); });
  return filas
    .filter(function (f) { return String(f[0]).trim() !== ''; })
    .map(function (f) {
      const pieza = {};
      cabecera.forEach(function (nombre, i) {
        const campo = COLUMNAS_PIEZAS[nombre];
        if (campo) pieza[campo] = typeof f[i] === 'string' ? f[i].trim() : f[i];
      });
      return pieza;
    });
}

function leerPartitura(id) {
  const pieza = leerPiezas().filter(function (p) { return String(p.id) === String(id); })[0];
  if (!pieza) throw new Error('No hay ninguna pieza con ID «' + id + '» en la pestaña «Piezas».');
  const ficheros = DriveApp.getFolderById(CARPETA_PIEZAS).getFilesByName(pieza.fichero);
  if (!ficheros.hasNext()) throw new Error('No encuentro «' + pieza.fichero + '» en la carpeta pianobot/piezas de Drive.');
  return textoMusicXml(ficheros.next().getBlob());
}

/** Devuelve el MusicXML como texto, descomprimiéndolo si es un .mxl (un zip). */
function textoMusicXml(blob) {
  const bytes = blob.getBytes();
  const esZip = bytes.length > 1 && bytes[0] === 0x50 && bytes[1] === 0x4b; // «PK»
  if (!esZip) return quitarBom(blob.getDataAsString('UTF-8'));

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
  return quitarBom(porNombre[ruta].getDataAsString('UTF-8'));
}

function quitarBom(texto) {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

function respuesta(datos) {
  return ContentService.createTextOutput(JSON.stringify(datos)).setMimeType(ContentService.MimeType.JSON);
}
