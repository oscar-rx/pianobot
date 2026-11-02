// Modo «⏱ Al tempo»: un compás de cuenta con el metrónomo y, después, la línea avanza sola; cada nota se juzga
// en su momento (verde bien, rojo fallada, naranja saltada) y al acabar el fragmento se para con el resumen.
//   node tests/e2e/al-tempo.e2e.mjs [--capturas carpeta]

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
const XML = partituraPrueba(16);

async function appsScript(ruta) {
  const p = Object.fromEntries(new URL(ruta.request().url()).searchParams);
  const json = (datos) => ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(datos) });
  if (p.accion === 'piezas') return json({ piezas: [{ id: 'prueba', titulo: 'Pieza de prueba', compositor: '', compases: 16 }] });
  if (p.accion === 'pieza') return json({ id: p.id, musicxml: XML });
  return json({ ok: true, hoja: 'pianobot' });
}

function pianoFalso() {
  const entrada = new EventTarget();
  Object.assign(entrada, { name: 'Piano de prueba', state: 'connected' });
  navigator.requestMIDIAccess = async () => ({ inputs: new Map([['p', entrada]]), outputs: new Map(), onstatechange: null });
  window.__lanzar = (datos) => {
    const e = new Event('midimessage');
    Object.defineProperty(e, 'data', { value: new Uint8Array(datos) });
    Object.defineProperty(e, 'timeStamp', { value: performance.now() });
    entrada.dispatchEvent(e);
  };
}

const puerto = 8778;
const servidor = await servir(puerto);
const navegador = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const fallos = [];
const comprobar = (ok, texto) => (ok ? console.log(`✓ ${texto}`) : fallos.push(texto));
const contar = (p) => p.evaluate(() => ({
  bien: document.querySelectorAll('#partitura .nota-bien').length,
  fallada: document.querySelectorAll('#partitura .nota-fallada').length,
  omitida: document.querySelectorAll('#partitura .nota-omitida').length,
}));

try {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  await contexto.route(`${APPS_SCRIPT}**`, appsScript);
  await contexto.addInitScript(pianoFalso);
  await contexto.addInitScript((url) => {
    localStorage.setItem('pianobot.conexion', JSON.stringify({ url, token: 't' }));
    localStorage.setItem('pianobot.ajustes', JSON.stringify({ ppm: 120, fragmentos: { prueba: { desde: 9, hasta: 10 } } }));
  }, APPS_SCRIPT);
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => fallos.push(`error en la página: ${e.message}`));
  pagina.on('console', (m) => m.type() === 'error' && fallos.push(m.text()));
  await pagina.goto(`http://localhost:${puerto}/`);
  await pagina.waitForFunction(() => / compases$/.test(document.querySelector('#partitura-estado').textContent), null, { timeout: 15000 });

  await pagina.click('#al-tempo');
  await pagina.waitForFunction(() => window.pianobot.alTempo, null, { timeout: 5000 });
  comprobar(await pagina.evaluate(() => window.pianobot.metronomo.sonando), 'arranca el metrónomo');
  comprobar((await pagina.textContent('#partitura-estado')).startsWith('Cuenta:'), `compás de cuenta: ${await pagina.textContent('#partitura-estado')}`);
  comprobar((await pagina.textContent('#al-tempo')).includes('Parar'), 'el botón pasa a «Parar»');

  // El pianista toca cada nota en su momento (+15 ms), salvo: se salta la 2.ª del compás 9 (mano derecha)
  // y en la 3.ª del compás 10 toca otra tecla.
  const plan = await pagina.evaluate(async () => {
    const { ahoraSonando } = await import('/js/audio.js');
    const p = window.pianobot.alTempo;
    const ahora = ahoraSonando();
    const derecha = (c) => p.notas.filter((n) => n.e.compas === c && n.e.mano === 'derecha');
    const saltar = derecha(9)[1].e.clave;
    const cambiar = derecha(10)[2].e.clave;
    const eventos = [];
    for (const n of p.notas) {
      if (n.e.clave === saltar) continue;
      const ms = (n.t - ahora) * 1000 + 15;
      const midi = n.e.clave === cambiar ? n.e.midi + 1 : n.e.midi;
      eventos.push({ ms, datos: [0x90, midi, 80] }, { ms: ms + n.e.dur * p.negra * 800, datos: [0x80, midi, 0] });
    }
    for (const ev of eventos) setTimeout(() => window.__lanzar(ev.datos), ev.ms);
    return { saltar, cambiar, total: p.notas.length, cuentaMs: (p.t0 - ahora) * 1000, finMs: (p.tFin - ahora) * 1000 };
  });
  comprobar(plan.cuentaMs > 1500 && plan.cuentaMs < 2200, `la primera nota llega tras un compás de cuenta (${Math.round(plan.cuentaMs)} ms a 120 ppm)`);

  // A mitad del compás 10: el Mi saltado del 9 ya está en naranja, sin esperar al final
  await pagina.waitForTimeout(plan.cuentaMs + 2000 + 600);
  const aMitad = await contar(pagina);
  comprobar(aMitad.omitida === 1 && aMitad.bien >= 5, `en su momento: la saltada en naranja y las tocadas en verde (${JSON.stringify(aMitad)})`);
  comprobar(!(await pagina.evaluate(() => window.pianobot.partitura.osmd.cursors[1].Hidden)), 'la línea roja avanza sola');

  await pagina.waitForFunction(() => !window.pianobot.alTempo, null, { timeout: plan.finMs + 4000 });
  const final = await contar(pagina);
  comprobar(final.bien === plan.total - 2 && final.fallada === 1 && final.omitida === 1, `al acabar: ${final.bien} verdes, ${final.fallada} roja, ${final.omitida} naranja`);
  comprobar(!(await pagina.evaluate(() => window.pianobot.metronomo.sonando)), 'al acabar el fragmento se para el metrónomo');
  const resumen = await pagina.textContent('#intento-resumen');
  comprobar(resumen.includes(`${plan.total - 2} de ${plan.total} bien`) && resumen.includes('al tempo, a 120 ppm'), `resumen: ${resumen}`);
  const desaj = await pagina.evaluate(() => window.pianobot.ultimoIntento.total.desajusteMs);
  comprobar(desaj >= 5 && desaj <= 40, `desajuste respecto al metrónomo ≈ +15 ms (${desaj})`);
  comprobar((await pagina.textContent('#al-tempo')).includes('Al tempo'), 'el botón vuelve a «⏱ Al tempo»');
  if (capturas) await pagina.screenshot({ path: join(capturas, 'al-tempo.png') });

  // Parar a mitad: no deja nada a medias
  await pagina.click('#al-tempo');
  await pagina.waitForTimeout(300);
  await pagina.click('#al-tempo');
  comprobar(!(await pagina.evaluate(() => window.pianobot.alTempo || window.pianobot.metronomo.sonando)), '«Parar» lo detiene todo');
  await contexto.close();
} finally {
  await navegador.close();
  servidor.close();
}
if (fallos.length) {
  for (const f of fallos) console.error(`✗ ${f}`);
  process.exit(1);
}
