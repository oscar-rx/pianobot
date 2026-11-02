// Prueba el Apps Script (apps-script/Codigo.gs) en Node, con Drive, el Sheet y las utilidades de
// Google simuladas. Comprueba el token, el catálogo y la lectura de MusicXML normal y comprimido (.mxl).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const codigo = readFileSync(new URL('../apps-script/Codigo.gs', import.meta.url), 'utf8');

class Blob {
  constructor(nombre, bytes) {
    this.nombre = nombre;
    this.bytes = Buffer.from(bytes);
  }
  getName() { return this.nombre; }
  getBytes() { return [...this.bytes].map((b) => (b > 127 ? b - 256 : b)); } // como Java: bytes con signo
  getDataAsString() { return this.bytes.toString('utf8'); }
  setContentType() { return this; }
}

// Zip mínimo (método deflate) y su lector, para simular un .mxl y Utilities.unzip
function crearZip(ficheros) {
  const locales = [];
  const centrales = [];
  let desplazamiento = 0;
  for (const [nombre, texto] of Object.entries(ficheros)) {
    const datos = Buffer.from(texto);
    const comprimido = deflateRawSync(datos);
    const n = Buffer.from(nombre);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(datos.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comprimido.length, 20); central.writeUInt32LE(datos.length, 24); central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    locales.push(local, n, comprimido);
    centrales.push(central, n);
    desplazamiento += 30 + n.length + comprimido.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(centrales.length / 2, 8); fin.writeUInt16LE(centrales.length / 2, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, dir, fin]);
}

function leerZip(buf) {
  const fuera = [];
  let i = 0;
  while (buf.readUInt32LE(i) === 0x04034b50) {
    const tam = buf.readUInt32LE(i + 18);
    const largoNombre = buf.readUInt16LE(i + 26);
    const extra = buf.readUInt16LE(i + 28);
    const nombre = buf.slice(i + 30, i + 30 + largoNombre).toString();
    const inicio = i + 30 + largoNombre + extra;
    fuera.push(new Blob(nombre, inflateRawSync(buf.slice(inicio, inicio + tam))));
    i = inicio + tam;
  }
  return fuera;
}

const XML = (titulo = 'Invención n.º 13', compositor = 'Johann Sebastian Bach', compases = 3) =>
  `<?xml version="1.0"?><score-partwise version="3.1"><work><work-title>${titulo}</work-title></work>` +
  `<identification><creator type="composer">${compositor}</creator></identification>` +
  `<part-list><score-part id="P1"/></part-list><part id="P1">` +
  Array.from({ length: compases }, (_, i) => `<measure number="${i + 1}">${i === 0 ? '<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="80"/></direction>' : ''}</measure>`).join('') +
  `</part></score-partwise>`;

// Google simulado: una carpeta de Drive con ficheros y un Sheet con la pestaña «Piezas».
function entorno({ token = 'secreto', ficheros = {} } = {}) {
  const propiedades = new Map(token ? [['TOKEN', token]] : []);
  const registro = [];
  let siguienteId = 1;
  const drive = new Map(); // id → {nombre, bytes}
  const meter = (nombre, contenido) => {
    const id = `drive${siguienteId++}`;
    drive.set(id, { nombre, bytes: Buffer.from(contenido) });
    return id;
  };
  for (const [nombre, contenido] of Object.entries(ficheros)) meter(nombre, contenido);
  const papelera = new Set();
  const fichero = (id) => ({
    getId: () => id,
    getName: () => drive.get(id).nombre,
    getBlob: () => new Blob(drive.get(id).nombre, drive.get(id).bytes),
    setContent: (texto) => { drive.get(id).bytes = Buffer.from(texto); },
    setTrashed: () => { papelera.add(id); drive.delete(id); },
  });
  const iterador = (lista) => ({ hasNext: () => lista.length > 0, next: () => lista.shift() });

  let filas = [['ID', 'Título', 'Compositor', 'Catálogo']]; // cabecera antigua: el script debe rehacerla
  const hoja = {
    getLastRow: () => filas.length,
    getRange: (fila, col, nf = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nf }, (_, i) => Array.from({ length: nc }, (_, j) => filas[fila - 1 + i]?.[col - 1 + j] ?? '')),
      setValues: (valores) => {
        valores.forEach((v, i) => { filas[fila - 1 + i] = [...v]; });
        return { setFontWeight() {} };
      },
      setValue: (v) => { filas[fila - 1][col - 1] = v; },
    }),
    appendRow: (fila) => filas.push(fila.map((v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v))),
    setFrozenRows() {},
  };
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => propiedades.get(k) ?? null, setProperty: (k, v) => propiedades.set(k, v) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getName: () => 'pianobot', getSheetByName: (n) => (n === 'Piezas' ? hoja : null), insertSheet: () => hoja }) },
    DriveApp: {
      getFileById: (id) => fichero(id),
      getFolderById: () => ({
        getName: () => 'piezas',
        getFiles: () => iterador([...drive.keys()].map(fichero)),
        getFilesByName: (n) => iterador([...drive.keys()].filter((id) => drive.get(id).nombre === n).map(fichero)),
        createFile: (blobONombre, contenido) =>
          fichero(typeof blobONombre === 'string' ? meter(blobONombre, contenido) : meter(blobONombre.getName(), blobONombre.bytes)),
      }),
    },
    Utilities: {
      getUuid: () => '12345678-1234-1234-1234-123456789abc',
      unzip: (blob) => leerZip(blob.bytes),
      base64Decode: (b64) => [...Buffer.from(b64, 'base64')],
      newBlob: (bytes, _tipo, nombre) => new Blob(nombre, bytes.map((b) => b & 255)),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (texto) => ({ texto, setMimeType() { return this; } }) },
    Logger: { log: (m) => registro.push(m) },
  };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  const llamar = (parametros) => JSON.parse(ctx.doGet({ parameter: parametros }).texto);
  const enviar = (cuerpo) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(cuerpo) } }).texto);
  return { ctx, llamar, enviar, propiedades, registro, filas: () => filas, drive, papelera };
}

test('sin token o con uno incorrecto no da nada', () => {
  const { llamar, enviar } = entorno();
  assert.equal(llamar({ accion: 'piezas' }).error, 'Token incorrecto.');
  assert.equal(llamar({ accion: 'piezas', token: 'otro' }).error, 'Token incorrecto.');
  assert.equal(enviar({ accion: 'subir', token: 'otro', nombre: 'a.musicxml', base64: 'eA==' }).error, 'Token incorrecto.');
});

test('sin configurar, lo dice', () => {
  const { llamar } = entorno({ token: null });
  assert.match(llamar({ accion: 'hola', token: 'x' }).error, /configurar/);
});

test('configurar crea un token, lo apunta en el registro y no lo cambia si ya existe', () => {
  const { ctx, propiedades, registro } = entorno({ token: null });
  const t = ctx.configurar();
  assert.equal(t.length, 64);
  assert.equal(propiedades.get('TOKEN'), t);
  assert.ok(registro[0].includes(t));
  assert.equal(ctx.configurar(), t);
});

test('basta con meter el fichero en la carpeta: el catálogo se rellena solo', () => {
  const { llamar, filas } = entorno({
    ficheros: { 'BWV_0784.musicxml': '﻿' + XML(), 'notas.txt': 'no es una partitura', 'Gymnopédie.xml': XML('Gymnopédie n.º 1', 'Erik Satie', 5) },
  });
  assert.deepEqual(llamar({ accion: 'hola', token: 'secreto' }), { ok: true, hoja: 'pianobot' });
  const { piezas } = llamar({ accion: 'piezas', token: 'secreto' });
  assert.deepEqual(piezas.map((p) => p.titulo), ['Gymnopédie n.º 1', 'Invención n.º 13']);
  assert.deepEqual(piezas[1], {
    id: 'bwv_0784', titulo: 'Invención n.º 13', compositor: 'Johann Sebastian Bach', fichero: 'BWV_0784.musicxml',
    compases: 3, compas: '4/4', tempoObjetivo: 80, idDrive: 'drive1',
  });
  assert.equal(piezas[0].id, 'gymnopedie');
  // Apuntadas en «Piezas» con la cabecera nueva, sin duplicarse en la siguiente llamada
  llamar({ accion: 'piezas', token: 'secreto' });
  assert.deepEqual(filas()[0], ['ID', 'Título', 'Compositor', 'Fichero', 'Compases', 'Compás', 'Tempo objetivo (ppm)', 'ID de Drive']);
  assert.equal(filas().length, 3);
});

test('lo que se retoca a mano en «Piezas» (p. ej. el tempo objetivo) se respeta', () => {
  const { llamar, filas } = entorno({ ficheros: { 'bwv784.musicxml': XML() } });
  llamar({ accion: 'piezas', token: 'secreto' });
  filas()[1][6] = 66;
  filas()[1][1] = 'Invención 13 (la menor)';
  const [pieza] = llamar({ accion: 'piezas', token: 'secreto' }).piezas;
  assert.equal(pieza.tempoObjetivo, 66);
  assert.equal(pieza.titulo, 'Invención 13 (la menor)');
});

test('lee la partitura (normal y .mxl comprimido, como los de MuseScore)', () => {
  const mxl = crearZip({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="partitura.xml"/></rootfiles></container>',
    'partitura.xml': XML('Prueba comprimida'),
  });
  const { llamar } = entorno({ ficheros: { 'bwv784.musicxml': '﻿' + XML(), 'prueba.mxl': mxl } });
  const { piezas } = llamar({ accion: 'piezas', token: 'secreto' });
  assert.equal(piezas.find((p) => p.id === 'prueba').titulo, 'Prueba comprimida');
  assert.equal(llamar({ accion: 'pieza', id: 'bwv784', token: 'secreto' }).musicxml, XML());
  assert.equal(llamar({ accion: 'pieza', id: 'prueba', token: 'secreto' }).musicxml, XML('Prueba comprimida'));
});

test('subir una partitura desde la app la guarda en Drive y la añade al catálogo', () => {
  const { enviar, llamar, drive } = entorno({ ficheros: { 'bwv784.musicxml': XML() } });
  const base64 = Buffer.from(XML('Preludio en Do', 'J. S. Bach', 35)).toString('base64');
  const { pieza } = enviar({ accion: 'subir', token: 'secreto', nombre: 'BWV 846.musicxml', base64 });
  assert.equal(pieza.id, 'bwv-846');
  assert.equal(pieza.compases, 35);
  assert.equal(drive.size, 2);
  assert.equal(llamar({ accion: 'piezas', token: 'secreto' }).piezas.length, 2);
  // Repetido, o que no es una partitura: error claro y no se guarda nada
  assert.match(enviar({ accion: 'subir', token: 'secreto', nombre: 'BWV 846.musicxml', base64 }).error, /Ya hay/);
  assert.match(enviar({ accion: 'subir', token: 'secreto', nombre: 'foto.jpg', base64 }).error, /Solo se admiten/);
  const noPartitura = Buffer.from('<html>hola</html>').toString('base64');
  assert.match(enviar({ accion: 'subir', token: 'secreto', nombre: 'raro.xml', base64: noPartitura }).error, /no es una partitura/);
  assert.equal(drive.size, 2);
});

test('errores claros', () => {
  const { llamar } = entorno();
  assert.match(llamar({ accion: 'pieza', id: 'nada', token: 'secreto' }).error, /No encuentro la pieza/);
  assert.match(llamar({ accion: 'otra', token: 'secreto' }).error, /Acción desconocida/);
});

test('guardar: sobrescribe la partitura (p. ej. con digitación) y la siguiente lectura la trae', () => {
  const { enviar, llamar, drive } = entorno({ ficheros: { 'bwv784.musicxml': XML() } });
  llamar({ accion: 'piezas', token: 'secreto' });
  const conDedos = XML().replace('<measure number="2">', '<measure number="2"><!-- dedo 3 -->');
  const { pieza } = enviar({ accion: 'guardar', token: 'secreto', id: 'bwv784', musicxml: conDedos });
  assert.equal(pieza.id, 'bwv784');
  assert.equal(drive.size, 1);
  assert.equal(llamar({ accion: 'pieza', id: 'bwv784', token: 'secreto' }).musicxml, conDedos);
});

test('guardar: si no es un MusicXML completo, no toca nada', () => {
  const { enviar, llamar } = entorno({ ficheros: { 'bwv784.musicxml': XML() } });
  llamar({ accion: 'piezas', token: 'secreto' });
  const cortado = XML().slice(0, 200);
  assert.match(enviar({ accion: 'guardar', token: 'secreto', id: 'bwv784', musicxml: cortado }).error, /no es una partitura/);
  assert.match(enviar({ accion: 'guardar', token: 'secreto', id: 'bwv784', musicxml: '' }).error, /no es una partitura/);
  assert.equal(llamar({ accion: 'pieza', id: 'bwv784', token: 'secreto' }).musicxml, XML());
});

test('guardar un .mxl: queda como .musicxml, la fila apunta al nuevo y el .mxl va a la papelera', () => {
  const mxl = crearZip({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="p.xml"/></rootfiles></container>',
    'p.xml': XML('Comprimida'),
  });
  const { enviar, llamar, filas, papelera } = entorno({ ficheros: { 'comprimida.mxl': mxl } });
  llamar({ accion: 'piezas', token: 'secreto' });
  const nuevo = XML('Comprimida con dedos');
  const { pieza } = enviar({ accion: 'guardar', token: 'secreto', id: 'comprimida', musicxml: nuevo });
  assert.equal(pieza.fichero, 'comprimida.musicxml');
  assert.deepEqual([...papelera], ['drive1']);
  assert.equal(filas()[1][3], 'comprimida.musicxml');
  const { piezas } = llamar({ accion: 'piezas', token: 'secreto' });
  assert.equal(piezas.length, 1, 'no se duplica en el catálogo');
  assert.equal(piezas[0].id, 'comprimida', 'conserva su ID (y con él su progreso)');
  assert.equal(llamar({ accion: 'pieza', id: 'comprimida', token: 'secreto' }).musicxml, nuevo);
});

test('ficheros convertidos de Capella: el título y el autor se sacan de los textos de los primeros compases', () => {
  const capella = `<?xml version="1.0"?><score-partwise version="2.0"><part-list><score-part id="P1"/></part-list><part id="P1">` +
    `<measure number="1"><direction placement="above"><direction-type><words font-size="12" font-weight="bold">1. Präludium</words></direction-type></direction>` +
    `<direction placement="above"><direction-type><words relative-x="317" font-size="17" font-weight="bold" justify="center">Präludium und Fughetta in G-Dur.</words></direction-type></direction></measure>` +
    `<measure number="2"><direction placement="above"><direction-type><words font-size="10" justify="right">Johann Sebastian Bach\nBWV 902</words></direction-type></direction></measure>` +
    `</part></score-partwise>`;
  const { llamar } = entorno({ ficheros: { 'BWV_0902.xml': capella } });
  const [pieza] = llamar({ accion: 'piezas', token: 'secreto' }).piezas;
  assert.equal(pieza.titulo, 'Präludium und Fughetta in G-Dur');
  assert.equal(pieza.compositor, 'Johann Sebastian Bach');
});
