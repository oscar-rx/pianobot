// Fase 4 · el profe. Con un Apps Script simulado que responde como lo haría Claude:
// «🧑‍🏫 Profe» → primera indicación → la app pone fragmento, mano y tempo y arranca sola los intentos al tempo
// las veces pedidas → manda los resultados → siguiente indicación. Órdenes rápidas, modelo elegido y gasto.
//   node tests/e2e/profe.e2e.mjs [--capturas carpeta]

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
const peticionesProfe = [];
const respuestas = [
  { decir: 'Empezamos por el 9 y el 10, mano derecha sola.', accion: 'cambiar', desde: 9, hasta: 10, mano: 'derecha', tempo: 120, repeticiones: 2 },
  { decir: 'El 10 te ha salido sucio. Otra vez las dos manos.', accion: 'repetir', desde: 9, hasta: 10, mano: 'ambas', tempo: 120, repeticiones: 1 },
  { decir: 'Bien por hoy.', accion: 'terminar', desde: 9, hasta: 10, mano: 'ambas', tempo: 120, repeticiones: 1 },
];

async function appsScript(ruta) {
  const peticion = ruta.request();
  const p = peticion.method() === 'POST' ? JSON.parse(peticion.postData()) : Object.fromEntries(new URL(peticion.url()).searchParams);
  const json = (datos) => ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(datos) });
  if (p.accion === 'piezas') return json({ piezas: [{ id: 'prueba', titulo: 'Pieza de prueba', compositor: 'Nadie', compases: 16, compas: '4/4', tempoObjetivo: 132 }] });
  if (p.accion === 'pieza') return json({ id: p.id, musicxml: XML });
  if (p.accion === 'profe') {
    peticionesProfe.push(p.peticion);
    await new Promise((ok) => setTimeout(ok, 300)); // lo que tarda Claude en pensar
    return json({ instruccion: respuestas[Math.min(peticionesProfe.length - 1, respuestas.length - 1)], modelo: p.peticion.modelo, uso: { input_tokens: 3000, output_tokens: 120 }, coste: 0 });
  }
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
  // Cuando empieza una vez «al tempo», el pianista toca todas sus notas en su momento (salvo las que se le digan)
  window.__fallar = new Set();
  window.__tocarCuandoEmpiece = () => {
    const vigilar = setInterval(async () => {
      const p = window.pianobot?.alTempo;
      if (!p || p.__tocada) return;
      p.__tocada = true;
      const { ahoraSonando } = await import('/js/audio.js');
      const ahora = ahoraSonando();
      for (const n of p.notas) {
        const midi = window.__fallar.has(n.e.compas) && n === p.notas.find((x) => x.e.compas === n.e.compas) ? n.e.midi + 1 : n.e.midi;
        const ms = (n.t - ahora) * 1000 + 10;
        // (si ese intento se cancela, p. ej. con «Más lento», el pianista deja de tocarlo)
        const tocar = (datos) => window.pianobot.alTempo === p && window.__lanzar(datos);
        setTimeout(() => tocar([0x90, midi, 80]), ms);
        setTimeout(() => tocar([0x80, midi, 0]), ms + n.e.dur * p.negra * 700);
      }
    }, 50);
    return vigilar;
  };
}

const puerto = 8783;
const servidor = await servir(puerto);
const navegador = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const fallos = [];
const comprobar = (ok, texto) => (ok ? console.log(`✓ ${texto}`) : fallos.push(texto));

try {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  await contexto.route(`${APPS_SCRIPT}**`, appsScript);
  await contexto.addInitScript(pianoFalso);
  await contexto.addInitScript((url) => {
    localStorage.setItem('pianobot.conexion', JSON.stringify({ url, token: 't' }));
  }, APPS_SCRIPT);
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => fallos.push(`error en la página: ${e.message}`));
  pagina.on('console', (m) => m.type() === 'error' && fallos.push(m.text()));
  await pagina.goto(`http://localhost:${puerto}/`);
  await pagina.waitForFunction(() => / compases$/.test(document.querySelector('#partitura-estado').textContent), null, { timeout: 15000 });
  await pagina.evaluate(() => window.__tocarCuandoEmpiece());

  // Modelo elegido: Sonnet
  await pagina.click('#profe');
  await pagina.selectOption('#modelo-profe', 'claude-sonnet-5-5');
  comprobar((await pagina.textContent('#profe-dice')).includes('pensando'), 'al empezar, «El profe está pensando…»');
  await pagina.waitForFunction(() => /Empezamos por el 9/.test(document.querySelector('#profe-dice').textContent), null, { timeout: 8000 });
  const p1 = peticionesProfe[0];
  comprobar(p1.intentos.length === 0 && p1.pieza.titulo === 'Pieza de prueba' && p1.pieza.tempoObjetivo === 132 && /Empezamos/.test(p1.comentario),
    'primera petición: la pieza y lo que hay en pantalla, sin intentos');
  comprobar(p1.modelo === 'claude-haiku-5-5', `la primera va con el modelo por defecto (${p1.modelo})`);

  // La app aplica la indicación sola y arranca
  const aplicado = await pagina.evaluate(() => ({ desde: window.pianobot.partitura.desde, hasta: window.pianobot.partitura.hasta, mano: document.querySelector('#mano').value, tempo: window.pianobot.metronomo.ppm }));
  comprobar(JSON.stringify(aplicado) === JSON.stringify({ desde: 9, hasta: 10, mano: 'derecha', tempo: 120 }), `aplica la indicación: ${JSON.stringify(aplicado)}`);
  comprobar((await pagina.textContent('#profe-plan')).includes('Compases 9–10 · mano derecha · 120 ppm · vez 1 de 2'), `plan en pantalla: ${await pagina.textContent('#profe-plan')}`);
  await pagina.waitForFunction(() => window.pianobot.alTempo, null, { timeout: 6000 });
  comprobar(true, 'arranca solo el intento al tempo');

  // «Más lento»: lo hace la app sola (sin llamar al profe) y se lo cuenta después
  await pagina.click('[data-orden="mas-lento"]');
  comprobar((await pagina.evaluate(() => window.pianobot.metronomo.ppm)) === 112 && peticionesProfe.length === 1, '«Más lento» baja el tempo sin gastar una llamada');

  // Las dos veces seguidas, y luego los resultados al profe (con Sonnet)
  await pagina.waitForFunction(() => window.pianobot.profe.rep >= 1, null, { timeout: 20000 });
  comprobar((await pagina.textContent('#profe-plan')).includes('vez 2 de 2'), 'cuenta las repeticiones');
  await pagina.evaluate(() => window.__fallar.add(10));
  await pagina.waitForFunction(() => document.querySelector('#profe-dice').textContent.includes('El 10 te ha salido sucio'), null, { timeout: 20000 });
  const p2 = peticionesProfe[1];
  comprobar(p2.modelo === 'claude-sonnet-5-5', 'la siguiente va con el modelo elegido (Sonnet)');
  comprobar(p2.intentos.length === 2 && p2.intentos[0].total.bien === p2.intentos[0].total.notas && p2.intentos[1].total.falladas === 1,
    `manda los dos intentos (${p2.intentos.map((i) => `${i.total.bien}/${i.total.notas}`).join(', ')})`);
  comprobar(p2.intentos[0].tempo === 112 && /más lento/.test(p2.comentario), 'le cuenta que pidió ir más lento');
  comprobar(p2.intentos[1].filas.some((f) => f.compas === 10 && f.falladas === 1), 'con el detalle por compás y mano');
  const gasto = await pagina.evaluate(() => window.pianobot.gasto.sesion);
  const esperado = (3000 * 0.1 + 120 * 0.5) / 1e6 + (3000 * 2 + 120 * 10) / 1e6;
  comprobar(Math.abs(gasto - esperado) < 1e-9, `el gasto de la sesión suma cada llamada a su precio ($${gasto.toFixed(5)})`);
  if (capturas) await pagina.screenshot({ path: join(capturas, 'profe.png') });

  // Tras la siguiente vez, el profe da por terminada la sesión
  await pagina.evaluate(() => window.__fallar.clear());
  await pagina.waitForFunction(() => !window.pianobot.profe.activo, null, { timeout: 20000 });
  comprobar((await pagina.textContent('#profe-dice')) === 'Bien por hoy.' && (await pagina.getAttribute('#profe', 'aria-pressed')) === 'false', 'el profe cierra la sesión');
  const p3 = peticionesProfe[2];
  comprobar(p3.historial.length === 2 && p3.historial[1].decision.includes('sucio'), 'el profe recibe lo hablado antes en la sesión');
  comprobar(!(await pagina.evaluate(() => window.pianobot.metronomo.sonando)), 'el metrónomo queda parado');
  await contexto.close();
} finally {
  await navegador.close();
  servidor.close();
}
if (fallos.length) {
  for (const f of fallos) console.error(`✗ ${f}`);
  process.exit(1);
}
