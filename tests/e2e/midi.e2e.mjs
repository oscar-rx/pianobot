// Prueba de extremo a extremo de la entrada MIDI con un piano simulado: acordes, dos voces
// a la vez y pedal. Comprueba que cada tecla llega por separado y que la nota grande
// enseña todas las que suenan juntas.
//   node tests/e2e/midi.e2e.mjs [--capturas carpeta]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { servir } from '../../herramientas/servidor.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const capturas = args.includes('--capturas') ? args[args.indexOf('--capturas') + 1] : null;
if (capturas) mkdirSync(capturas, { recursive: true });

// Sustituye Web MIDI por un teclado falso que la prueba controla con window.__piano(bytes)
function pianoFalso() {
  const entrada = new EventTarget();
  Object.assign(entrada, { name: 'Piano de prueba', state: 'connected' });
  const acceso = { inputs: new Map([['p', entrada]]), outputs: new Map(), onstatechange: null };
  navigator.requestMIDIAccess = async () => acceso;
  window.__piano = (...mensajes) => {
    const t = performance.now();
    for (const datos of mensajes) {
      const e = new Event('midimessage');
      Object.defineProperty(e, 'data', { value: new Uint8Array(datos) });
      Object.defineProperty(e, 'timeStamp', { value: t });
      entrada.dispatchEvent(e);
    }
  };
}

const puerto = 8768;
const servidor = await servir(puerto);
const navegador = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const fallos = [];
const comprobar = (ok, texto) => (ok ? console.log(`✓ ${texto}`) : fallos.push(texto));
try {
  const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 } });
  pagina.on('pageerror', (e) => fallos.push(`Error en la página: ${e.message}`));
  await pagina.addInitScript(pianoFalso);
  await pagina.goto(`http://localhost:${puerto}/`);
  await pagina.click('[data-fuente="midi"]');
  await pagina.click('#empezar');
  await pagina.waitForFunction(() => document.querySelector('#estado-punto.ok'));
  comprobar((await pagina.textContent('#estado-texto')).includes('Piano de prueba'), 'detecta el piano conectado');

  // Acorde de La menor (La3 Do4 Mi4) a la vez
  await pagina.evaluate(() => window.__piano([0x90, 57, 70], [0x90, 60, 80], [0x90, 64, 90]));
  await pagina.waitForTimeout(100);
  comprobar((await pagina.textContent('#nota-actual')) === 'La3 Do4 Mi4', 'la nota grande enseña el acorde entero');
  const filas = await pagina.$$eval('#registro tr', (rs) => rs.map((r) => [...r.cells].map((c) => c.textContent.trim())));
  comprobar(filas.length === 3, 'cada tecla del acorde es una fila');
  comprobar(new Set(filas.map((f) => f[0])).size === 1, 'las tres teclas llegan en el mismo momento');
  comprobar(filas.map((f) => f[2]).join(',') === '90,80,70', 'cada tecla con su fuerza real');
  if (capturas) await pagina.screenshot({ path: join(capturas, 'midi-acorde.png') });
  const marcadas = await pagina.$$eval('#escala-chips .chip.ok, #escala-chips .chip.omitida', (c) => c.length);
  comprobar(marcadas === 1, `la prueba de escala cuenta solo la primera nota del acorde (marcadas ${marcadas})`);

  // Pedal
  await pagina.evaluate(() => window.__piano([0xb0, 64, 127]));
  comprobar(await pagina.isVisible('#pedal'), 'se ve el pedal pisado');
  await pagina.evaluate(() => window.__piano([0xb0, 64, 0], [0x80, 57, 0], [0x80, 60, 0], [0x90, 64, 0]));
  comprobar(!(await pagina.isVisible('#pedal')), 'se ve el pedal suelto');

  // Dos voces: la mano izquierda mantiene La2 mientras la derecha toca Mi4 Fa4 Mi4
  await pagina.evaluate(() => window.__piano([0x90, 45, 60], [0x90, 76, 70]));
  await pagina.waitForTimeout(50);
  await pagina.evaluate(() => window.__piano([0x80, 76, 0], [0x90, 77, 70]));
  await pagina.waitForTimeout(50);
  comprobar((await pagina.textContent('#nota-actual')) === 'La2 Fa5', 'dos voces: la nota larga sigue mientras cambia la otra');
  const total = await pagina.$$eval('#registro tr', (rs) => rs.length);
  comprobar(total === 6, `seis teclas en total (hay ${total})`);

  // El sonido del metrónomo se puede cambiar sin errores
  for (const s of ['clasico', 'suave', 'tic', 'madera']) await pagina.selectOption('#sonido', s);
  await pagina.click('#metro-boton');
  await pagina.waitForTimeout(1200);
  await pagina.click('#metro-boton');
  comprobar(true, 'los cuatro sonidos del metrónomo');
} finally {
  await navegador.close();
  servidor.close();
}
if (fallos.length) {
  for (const f of fallos) console.error(`✗ ${f}`);
  process.exit(1);
}
