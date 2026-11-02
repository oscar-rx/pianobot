// Fase 2 · «Listo cuando: pides compases 9 a 12 y salen solos».
// La partitura llega de Google Drive a través del Apps Script; aquí el Apps Script está simulado
// (con una partitura de prueba de 25 compases) para comprobar también la conexión y la copia local.
//   node tests/e2e/partitura.e2e.mjs [--capturas carpeta]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { servir } from '../../herramientas/servidor.mjs';
import { partituraPrueba } from '../fixtures/partitura-prueba.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const capturas = args.includes('--capturas') ? args[args.indexOf('--capturas') + 1] : null;
if (capturas) mkdirSync(capturas, { recursive: true });

const APPS_SCRIPT = 'https://script.google.com/macros/s/PRUEBA/exec';
const TOKEN = 'token-de-prueba';
const XML = partituraPrueba(25);
const PIEZAS = [{ id: 'prueba', titulo: 'Pieza de prueba', compositor: 'Nadie', fichero: 'prueba.musicxml', compases: 25 }];

// Apps Script simulado. `estado.caido` hace que falle como si no hubiera conexión.
const estado = { caido: false, llamadas: [] };
async function appsScript(ruta) {
  const url = new URL(ruta.request().url());
  estado.llamadas.push(url.searchParams.get('accion'));
  if (estado.caido) return ruta.abort('internetdisconnected');
  const json = (datos) => ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(datos) });
  if (url.searchParams.get('token') !== TOKEN) return json({ error: 'Token incorrecto.' });
  switch (url.searchParams.get('accion')) {
    case 'hola': return json({ ok: true, hoja: 'pianobot' });
    case 'piezas': return json({ piezas: PIEZAS });
    case 'pieza': return json({ id: 'prueba', musicxml: XML });
    default: return json({ error: 'Acción desconocida' });
  }
}

const puerto = 8769;
const servidor = await servir(puerto);
const navegador = await chromium.launch();
const fallos = [];
const comprobar = (ok, texto) => (ok ? console.log(`✓ ${texto}`) : fallos.push(texto));
const pintados = (p) => p.evaluate(() => window.pianobot.partitura.compasesPintados());
const esperarCarga = (p) => p.waitForFunction(() => / compases$|Copia guardada/.test(document.querySelector('#partitura-estado').textContent), null, { timeout: 15000 });

try {
  // 1. Sin conectar: pide conectar con Drive. Con un token malo, avisa y no guarda nada.
  {
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
    await contexto.route(`${APPS_SCRIPT}**`, appsScript);
    const pagina = await contexto.newPage();
    pagina.on('pageerror', (e) => fallos.push(`error en la página: ${e.message}`));
    await pagina.goto(`http://localhost:${puerto}/`);
    comprobar(await pagina.isVisible('#conectar'), 'sin conectar: pide conectar con Drive');
    await pagina.click('#conectar');
    await pagina.fill('#conexion-url', APPS_SCRIPT);
    await pagina.fill('#conexion-token', 'malo');
    await pagina.click('#conexion-probar');
    await pagina.waitForFunction(() => /No funciona/.test(document.querySelector('#conexion-resultado').textContent));
    comprobar((await pagina.textContent('#conexion-resultado')).includes('Token incorrecto'), 'token incorrecto: lo dice y no guarda');
    await pagina.fill('#conexion-token', TOKEN);
    await pagina.click('#conexion-probar');
    await esperarCarga(pagina);
    comprobar(!(await pagina.isVisible('#dialogo-conexion')), 'token correcto: se guarda y se cierra');
    comprobar((await pagina.textContent('#pieza-titulo')) === 'Pieza de prueba', 'carga la pieza desde Drive');
    await contexto.storageState({ path: '/tmp/pianobot-e2e-estado.json' });
    await contexto.close();
  }

  // 2. Ya conectada: fragmentos (tablet y móvil)
  for (const [nombre, viewport] of [['tablet', { width: 1280, height: 800 }], ['movil', { width: 390, height: 844 }]]) {
    const contexto = await navegador.newContext({ viewport, storageState: '/tmp/pianobot-e2e-estado.json' });
    await contexto.route(`${APPS_SCRIPT}**`, appsScript);
    const pagina = await contexto.newPage();
    pagina.on('pageerror', (e) => fallos.push(`${nombre}: error en la página: ${e.message}`));
    // Mientras se simula que no hay conexión, los avisos de red de la consola son lo esperado.
    pagina.on('console', (m) => m.type() === 'error' && !estado.caido && fallos.push(`${nombre}: ${m.text()}`));
    await pagina.goto(`http://localhost:${puerto}/`);
    await esperarCarga(pagina);
    comprobar((await pagina.evaluate(() => window.pianobot.partitura.numCompases)) === 25, `${nombre}: 25 compases`);
    comprobar(JSON.stringify(await pintados(pagina)) === '[1,2,3,4]', `${nombre}: al empezar, compases 1 a 4`);

    await pagina.fill('#frag-desde', '9');
    await pagina.dispatchEvent('#frag-desde', 'change');
    await pagina.fill('#frag-hasta', '12');
    await pagina.dispatchEvent('#frag-hasta', 'change');
    comprobar(JSON.stringify(await pintados(pagina)) === '[9,10,11,12]', `${nombre}: pides 9 a 12 y salen solos`);
    comprobar((await pagina.textContent('#cursor-compas')) === '9', `${nombre}: el cursor marca el compás 9`);
    if (capturas) await pagina.screenshot({ path: join(capturas, `partitura-${nombre}.png`), fullPage: nombre === 'movil' });

    await pagina.click('#cursor-siguiente');
    await pagina.click('#cursor-siguiente');
    comprobar((await pagina.textContent('#cursor-compas')) === '11', `${nombre}: el cursor avanza al 11`);
    await pagina.click('#frag-siguiente');
    comprobar(JSON.stringify(await pintados(pagina)) === '[13,14,15,16]', `${nombre}: siguiente fragmento, 13 a 16`);
    await pagina.fill('#frag-hasta', '30');
    await pagina.dispatchEvent('#frag-hasta', 'change');
    const final = await pintados(pagina);
    comprobar(final[0] === 13 && final.at(-1) === 25, `${nombre}: un número fuera de rango se corrige (13 a 25)`);

    // 3. Sin conexión con Drive: usa la copia guardada en la tablet y recuerda el fragmento
    estado.caido = true;
    await pagina.reload();
    await esperarCarga(pagina);
    comprobar((await pagina.textContent('#partitura-estado')).startsWith('Copia guardada'), `${nombre}: sin conexión, usa la copia de la tablet`);
    comprobar(JSON.stringify(await pintados(pagina)) === JSON.stringify(final), `${nombre}: recuerda el fragmento al recargar`);
    estado.caido = false;

    const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth);
    comprobar(ancho <= viewport.width, `${nombre}: sin scroll horizontal de la página (${ancho}px)`);
    await contexto.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}
if (fallos.length) {
  for (const f of fallos) console.error(`✗ ${f}`);
  process.exit(1);
}
