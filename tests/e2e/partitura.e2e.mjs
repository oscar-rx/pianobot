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
const PARTITURAS = { prueba: partituraPrueba(25), corta: partituraPrueba(8), capella: partituraPrueba(6, { textosCapella: true }) };
const PIEZAS = [
  { id: 'prueba', titulo: 'Pieza de prueba', compositor: 'Nadie', fichero: 'prueba.musicxml', compases: 25 },
  { id: 'corta', titulo: 'Pieza corta', compositor: '', fichero: 'corta.musicxml', compases: 8 },
  { id: 'capella', titulo: 'Metida directamente en Drive', compositor: '', fichero: 'capella.xml', compases: 6 },
];

// Apps Script simulado. `estado.caido` hace que falle como si no hubiera conexión.
const estado = { caido: false, llamadas: [] };
async function appsScript(ruta) {
  const peticion = ruta.request();
  const url = new URL(peticion.url());
  const p = peticion.method() === 'POST' ? JSON.parse(peticion.postData()) : Object.fromEntries(url.searchParams);
  estado.llamadas.push(p.accion);
  if (estado.caido) return ruta.abort('internetdisconnected');
  const json = (datos) => ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(datos) });
  if (p.token !== TOKEN) return json({ error: 'Token incorrecto.' });
  if (peticion.method() === 'POST' && peticion.headers()['content-type']?.startsWith('application/json')) {
    return json({ error: 'La subida debe ir como texto plano (si no, el navegador la bloquea).' });
  }
  switch (p.accion) {
    case 'hola': return json({ ok: true, hoja: 'pianobot' });
    case 'piezas': return json({ piezas: PIEZAS });
    case 'pieza': return json({ id: p.id, musicxml: PARTITURAS[p.id] });
    case 'subir': {
      const id = p.nombre.replace(/\..*$/, '').toLowerCase();
      PARTITURAS[id] = Buffer.from(p.base64, 'base64').toString('utf8');
      PIEZAS.push({ id, titulo: 'Subida desde la tablet', compositor: '', fichero: p.nombre, compases: 12 });
      return json({ pieza: PIEZAS.at(-1) });
    }
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
    const opciones = await pagina.$$eval('#pieza option', (os) => os.map((o) => o.textContent));
    comprobar(opciones.length === 3 && opciones[0] === 'Pieza de prueba · Nadie' && opciones[1] === 'Pieza corta', 'el selector tiene las piezas de Drive');
    comprobar((await pagina.evaluate(() => window.pianobot.partitura.numCompases)) === 25, 'carga la primera pieza');

    // Cada pieza recuerda su fragmento
    await pagina.fill('#frag-desde', '5');
    await pagina.dispatchEvent('#frag-desde', 'change');
    await pagina.selectOption('#pieza', 'corta');
    await esperarCarga(pagina);
    comprobar((await pagina.evaluate(() => window.pianobot.partitura.numCompases)) === 8, 'cambiar de pieza carga la otra');
    comprobar(JSON.stringify(await pintados(pagina)) === '[1,2,3,4]', 'la otra pieza empieza en su compás 1');
    await pagina.selectOption('#pieza', 'prueba');
    await esperarCarga(pagina);
    comprobar((await pintados(pagina))[0] === 5, 'al volver, la primera sigue en el compás 5');
    await pagina.fill('#frag-desde', '1');
    await pagina.dispatchEvent('#frag-desde', 'change');
    await pagina.fill('#frag-hasta', '4');
    await pagina.dispatchEvent('#frag-hasta', 'change');

    // Añadir una partitura desde la tablet
    await pagina.setInputFiles('#fichero-pieza', { name: 'nueva.musicxml', mimeType: 'application/octet-stream', buffer: Buffer.from(partituraPrueba(12)) });
    await pagina.waitForFunction(() => document.querySelector('#pieza').value === 'nueva', null, { timeout: 15000 });
    await esperarCarga(pagina);
    comprobar((await pagina.evaluate(() => window.pianobot.partitura.numCompases)) === 12, 'subir una partitura la añade y la abre');
    // Una partitura con los títulos metidos en los compases: se limpia antes de subirla
    await pagina.setInputFiles('#fichero-pieza', { name: 'tobi.xml', mimeType: 'text/xml', buffer: Buffer.from(partituraPrueba(6, { textosCapella: true })) });
    await pagina.waitForFunction(() => /Quitados/.test(document.querySelector('#partitura-estado').textContent), null, { timeout: 15000 });
    const subida = PARTITURAS.tobi;
    comprobar(!/Invención de prueba\.|BWV 999|2\. Fughetta/.test(subida) && subida.includes('dolce'),
      'al subir, se quitan título, autor y movimiento de dentro de los compases (y se respeta el «dolce»)');
    comprobar(/<work-title>Invención de prueba<\/work-title>/.test(subida) && /<creator type="composer">Juan Sebastián Prueba<\/creator>/.test(subida),
      'el título y el autor pasan a los datos de la partitura');
    comprobar((await pagina.textContent('#partitura-estado')).includes('Quitados 3 textos'), `lo dice: ${await pagina.textContent('#partitura-estado')}`);
    // Una metida directamente en Drive (sin limpiar): se limpia al mostrarla
    await pagina.selectOption('#pieza', 'capella');
    await esperarCarga(pagina);
    const textosSvg = await pagina.$$eval('#partitura svg text', (ts) => ts.map((t) => t.textContent));
    comprobar(!textosSvg.some((t) => /Invención de prueba|BWV|Fughetta/.test(t)) && textosSvg.some((t) => t.includes('dolce')),
      'una metida directamente en Drive también se ve limpia (con su «dolce»)');
    await pagina.setInputFiles('#fichero-pieza', { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') });
    comprobar((await pagina.textContent('#partitura-estado')).includes('Solo se pueden añadir'), 'un fichero que no es partitura se rechaza');
    await pagina.selectOption('#pieza', 'prueba');
    await esperarCarga(pagina);
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
