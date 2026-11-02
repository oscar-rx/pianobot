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

const XML = '<?xml version="1.0"?><score-partwise><part id="P1"><measure number="1"/></part></score-partwise>';

function entorno({ token = 'secreto', ficheros = {}, filas } = {}) {
  const propiedades = new Map(token ? [['TOKEN', token]] : []);
  const registro = [];
  const hojaPiezas = filas ?? [
    ['ID', 'Título', 'Compositor', 'Catálogo', 'Fichero', 'Compases', 'Compás', 'Tempo objetivo (ppm)'],
    ['bwv784', 'Invención n.º 13', 'J. S. Bach', 'BWV 784', 'bwv784.musicxml', 25, '4/4', 80],
    ['prueba', 'Prueba comprimida', 'Nadie', '', 'prueba.mxl', 1, '4/4', 60],
    ['', '', '', '', '', '', '', ''],
  ];
  const ctx = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => propiedades.get(k) ?? null,
        setProperty: (k, v) => propiedades.set(k, v),
      }),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getName: () => 'pianobot',
        getSheetByName: (n) => (n === 'Piezas' ? { getDataRange: () => ({ getValues: () => hojaPiezas.map((f) => [...f]) }) } : null),
      }),
    },
    DriveApp: {
      getFolderById: () => ({
        getName: () => 'piezas',
        getFilesByName: (nombre) => {
          const lista = nombre in ficheros ? [new Blob(nombre, ficheros[nombre])] : [];
          return { hasNext: () => lista.length > 0, next: () => ({ getBlob: () => lista.shift() }) };
        },
      }),
    },
    Utilities: {
      getUuid: () => '12345678-1234-1234-1234-123456789abc',
      unzip: (blob) => leerZip(blob.bytes),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (texto) => ({ texto, setMimeType() { return this; } }),
    },
    Logger: { log: (m) => registro.push(m) },
  };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  const llamar = (parametros) => JSON.parse(ctx.doGet({ parameter: parametros }).texto);
  return { ctx, llamar, propiedades, registro };
}

test('sin token o con uno incorrecto no da nada', () => {
  const { llamar } = entorno();
  assert.equal(llamar({ accion: 'piezas' }).error, 'Token incorrecto.');
  assert.equal(llamar({ accion: 'piezas', token: 'otro' }).error, 'Token incorrecto.');
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

test('hola y catálogo', () => {
  const { llamar } = entorno();
  assert.deepEqual(llamar({ accion: 'hola', token: 'secreto' }), { ok: true, hoja: 'pianobot' });
  const { piezas } = llamar({ accion: 'piezas', token: 'secreto' });
  assert.equal(piezas.length, 2);
  assert.deepEqual(piezas[0], {
    id: 'bwv784', titulo: 'Invención n.º 13', compositor: 'J. S. Bach', catalogo: 'BWV 784',
    fichero: 'bwv784.musicxml', compases: 25, compas: '4/4', tempoObjetivo: 80,
  });
});

test('lee un MusicXML normal (y le quita el BOM)', () => {
  const { llamar } = entorno({ ficheros: { 'bwv784.musicxml': '﻿' + XML } });
  assert.deepEqual(llamar({ accion: 'pieza', id: 'bwv784', token: 'secreto' }), { id: 'bwv784', musicxml: XML });
});

test('lee un .mxl comprimido, como los que exporta MuseScore', () => {
  const mxl = crearZip({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="partitura.xml"/></rootfiles></container>',
    'partitura.xml': XML,
  });
  const { llamar } = entorno({ ficheros: { 'prueba.mxl': mxl } });
  assert.equal(llamar({ accion: 'pieza', id: 'prueba', token: 'secreto' }).musicxml, XML);
});

test('errores claros: pieza que no existe y fichero que falta en Drive', () => {
  const { llamar } = entorno();
  assert.match(llamar({ accion: 'pieza', id: 'nada', token: 'secreto' }).error, /No hay ninguna pieza/);
  assert.match(llamar({ accion: 'pieza', id: 'bwv784', token: 'secreto' }).error, /No encuentro «bwv784.musicxml»/);
  assert.match(llamar({ accion: 'otra', token: 'secreto' }).error, /Acción desconocida/);
});
