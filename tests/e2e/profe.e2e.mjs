// Fase 4 · el profe. Con un Apps Script simulado que responde como lo haría Claude:
// «🧑‍🏫 Profe» → primera indicación (sin metrónomo, hasta que salga limpio) → la app pone fragmento y mano y
// escucha como en Corregir hasta una vez limpia → segunda (con metrónomo, ♪ = 120, 2 veces) → la app arranca sola
// los intentos al tempo → manda los resultados → siguiente indicación. Órdenes rápidas, modelo elegido y gasto.
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
  { decir: 'Empezamos por el 9 y el 10, mano derecha sola, sin metrónomo.', accion: 'cambiar', desde: 9, hasta: 10, mano: 'derecha', modo: 'notas', pulso: 'negra', tempo: 60, repeticiones: 1, hastaLimpio: true },
  { decir: 'Ya salen. Ahora las dos manos con metrónomo.', accion: 'repetir', desde: 9, hasta: 10, mano: 'ambas', modo: 'metronomo', pulso: 'corchea', tempo: 120, repeticiones: 2, hastaLimpio: false },
  { decir: 'Bien por hoy.', accion: 'terminar', desde: 9, hasta: 10, mano: 'ambas', modo: 'metronomo', pulso: 'corchea', tempo: 120, repeticiones: 1, hastaLimpio: false },
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
  // Sin metrónomo (modo «notas» del profe): en cuanto escucha, toca el fragmento a negra = 120, una vez por repetición
  window.__tocarSinMetronomo = () => {
    let tocada = -1;
    setInterval(async () => {
      const { profe, digitacion, partitura } = window.pianobot;
      if (!profe.activo || profe.esperando || profe.instruccion?.modo !== 'notas') return;
      if (document.querySelector('#corregir').getAttribute('aria-pressed') !== 'true' || tocada === profe.rep) return;
      tocada = profe.rep;
      const { esperadasDelFragmento } = await import('/js/comparar.js');
      const esperadas = esperadasDelFragmento(digitacion.indice, { desde: partitura.desde, hasta: partitura.hasta, mano: document.querySelector('#mano').value });
      for (const e of esperadas) {
        const midi = window.__fallar.has(e.compas) && e === esperadas.find((x) => x.compas === e.compas) ? e.midi + 1 : e.midi;
        setTimeout(() => window.__lanzar([0x90, midi, 80]), 300 + e.pos * 500);
        setTimeout(() => window.__lanzar([0x80, midi, 0]), 300 + e.pos * 500 + e.dur * 350);
      }
    }, 100);
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
  await pagina.evaluate(() => {
    window.__tocarCuandoEmpiece();
    window.__tocarSinMetronomo();
    window.__fallar.add(10); // la primera vez sin metrónomo, un fallo en el 10
  });

  // Modelo elegido: Sonnet
  await pagina.click('#profe');
  await pagina.selectOption('#modelo-profe', 'claude-sonnet-5-5');
  comprobar((await pagina.textContent('#profe-dice')).includes('pensando'), 'al empezar, «El profe está pensando…»');
  await pagina.waitForFunction(() => /Empezamos por el 9/.test(document.querySelector('#profe-dice').textContent), null, { timeout: 8000 });
  const p1 = peticionesProfe[0];
  comprobar(p1.intentos.length === 0 && p1.pieza.titulo === 'Pieza de prueba' && p1.pieza.tempoObjetivo === 132 && /Empezamos/.test(p1.comentario),
    'primera petición: la pieza y lo que hay en pantalla, sin intentos');
  comprobar(p1.modelo === 'claude-haiku-5-5', `la primera va con el modelo por defecto (${p1.modelo})`);

  comprobar(typeof p1.pieza.figuraMasCorta === 'string' && /corchea|negra/.test(p1.pieza.figuraMasCorta), `le dice la figura más corta de cada tramo (${p1.pieza.figuraMasCorta})`);

  // 1.ª indicación: sin metrónomo y hasta que salga limpio. La app pone fragmento y mano y escucha como en Corregir.
  const aplicado = await pagina.evaluate(() => ({ desde: window.pianobot.partitura.desde, hasta: window.pianobot.partitura.hasta, mano: document.querySelector('#mano').value }));
  comprobar(JSON.stringify(aplicado) === JSON.stringify({ desde: 9, hasta: 10, mano: 'derecha' }), `aplica la indicación: ${JSON.stringify(aplicado)}`);
  const plan1 = await pagina.textContent('#profe-plan');
  comprobar(plan1.includes('Compases 9–10 · mano derecha · sin metrónomo · vez 1 · hasta que salga limpio'), `plan en pantalla: ${plan1}`);
  comprobar(await pagina.isHidden('[data-orden="mas-lento"]'), 'sin metrónomo no se ofrece «Más lento»');
  await pagina.waitForFunction(() => document.querySelector('#corregir').getAttribute('aria-pressed') === 'true', null, { timeout: 6000 });
  comprobar(!(await pagina.evaluate(() => window.pianobot.metronomo.sonando || window.pianobot.alTempo)), 'escucha sin metrónomo (como Corregir)');
  // Sale sucia: otra vez, sin preguntar al profe
  await pagina.waitForFunction(() => window.pianobot.profe.rep >= 1, null, { timeout: 20000 });
  await pagina.evaluate(() => window.__fallar.clear());
  comprobar(peticionesProfe.length === 1 && (await pagina.textContent('#profe-plan')).includes('vez 2 · hasta que salga limpio'), 'si sale con fallos, repite sin límite y sin gastar llamadas');
  // Sale limpia: ahora sí, al profe
  await pagina.waitForFunction(() => /Ahora las dos manos/.test(document.querySelector('#profe-dice').textContent), null, { timeout: 20000 });
  const p2 = peticionesProfe[1];
  comprobar(p2.modelo === 'claude-sonnet-5-5', 'la siguiente va con el modelo elegido (Sonnet)');
  comprobar(p2.intentos.length === 2 && p2.vecesTotal === 2 && p2.vecesLimpias === 1 && p2.intentos.every((i) => i.modo === 'notas' && i.metronomo === null),
    `manda las dos veces sin metrónomo (${p2.intentos.map((i) => `${i.total.bien}/${i.total.notas}`).join(', ')})`);
  comprobar(p2.intentos[0].filas.some((f) => f.compas === 10 && f.falladas === 1) && p2.intentos[1].total.falladas === 0, 'con el detalle por compás y mano');

  // 2.ª indicación: con metrónomo, ♪ = 120, dos veces
  await pagina.waitForFunction(() => window.pianobot.alTempo, null, { timeout: 6000 });
  const metro = await pagina.evaluate(() => {
    const { metronomo, alTempo } = window.pianobot;
    return { pulso: metronomo.pulso, ppm: metronomo.ppm, clics: alTempo.tiempos, cuenta: alTempo.t0 - metronomo.pulsos[0].tiempo, negra: alTempo.negra };
  });
  comprobar(metro.pulso === 'corchea' && metro.ppm === 120 && (await pagina.textContent('#mini-figura')) === '♪', `pone el metrónomo en ♪ = 120 (${JSON.stringify(metro)})`);
  comprobar(metro.clics === 8 && Math.abs(metro.cuenta - 4) < 0.01 && Math.abs(metro.negra - 1) < 1e-9, 'cuenta de un compás en corcheas (8 clics) y la negra a 60');
  comprobar((await pagina.textContent('#profe-plan')).includes('Compases 9–10 · las dos manos · ♪ = 120 · vez 1 de 2'), `plan: ${await pagina.textContent('#profe-plan')}`);
  // «Más lento»: lo hace la app sola (sin llamar al profe) y se lo cuenta después
  await pagina.click('[data-orden="mas-lento"]');
  comprobar((await pagina.evaluate(() => window.pianobot.metronomo.ppm)) === 112 && peticionesProfe.length === 2, '«Más lento» baja el tempo sin gastar una llamada');
  await pagina.waitForFunction(() => window.pianobot.profe.rep >= 1, null, { timeout: 30000 });
  comprobar((await pagina.textContent('#profe-plan')).includes('vez 2 de 2'), 'cuenta las repeticiones');
  await pagina.evaluate(() => window.__fallar.add(10));
  await pagina.waitForFunction(() => document.querySelector('#profe-dice').textContent === 'Bien por hoy.', null, { timeout: 30000 });
  const p3 = peticionesProfe[2];
  comprobar(p3.intentos.length === 2 && p3.intentos[0].total.bien === p3.intentos[0].total.notas && p3.intentos[1].total.falladas === 1,
    `manda los dos intentos al tempo (${p3.intentos.map((i) => `${i.total.bien}/${i.total.notas}`).join(', ')})`);
  comprobar(p3.intentos[0].modo === 'metronomo' && p3.intentos[0].metronomo === '♪ = 112' && p3.intentos[0].tempo === 56 && /más lento/.test(p3.comentario),
    `le cuenta que pidió ir más lento (${p3.intentos[0].metronomo}, ♩ = ${p3.intentos[0].tempo})`);
  comprobar(p3.ahora.modo === 'metronomo' && p3.ahora.pulso === 'corchea' && p3.ahora.tempo === 112, 'y en qué está ahora');
  const gasto = await pagina.evaluate(() => window.pianobot.gasto.sesion);
  const esperado = (3000 * 0.1 + 120 * 0.5) / 1e6 + 2 * (3000 * 2 + 120 * 10) / 1e6;
  comprobar(Math.abs(gasto - esperado) < 1e-9, `el gasto de la sesión suma cada llamada a su precio ($${gasto.toFixed(5)})`);
  if (capturas) await pagina.screenshot({ path: join(capturas, 'profe.png') });

  // El profe da por terminada la sesión
  await pagina.waitForFunction(() => !window.pianobot.profe.activo, null, { timeout: 5000 });
  comprobar((await pagina.textContent('#profe-dice')) === 'Bien por hoy.' && (await pagina.getAttribute('#profe', 'aria-pressed')) === 'false', 'el profe cierra la sesión');
  comprobar(p3.historial.length === 2 && p3.historial[1].decision.includes('Ya salen') && p3.historial[1].modo === 'notas', 'el profe recibe lo hablado antes en la sesión');
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
