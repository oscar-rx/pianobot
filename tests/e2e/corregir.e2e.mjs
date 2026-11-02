// Fase 3 · «Listo cuando: fallas a propósito el compás 11 y la app lo marca bien».
// Un piano MIDI simulado toca los compases 9-12 (con dos notas cambiadas en el 11 y un titubeo antes del 12)
// y se comprueba la corrección: tabla por compás y mano, notas en rojo, cursor y modo «solo mano derecha».
//   node tests/e2e/corregir.e2e.mjs [--capturas carpeta]

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
const XML = partituraPrueba(16);

async function appsScript(ruta) {
  const p = Object.fromEntries(new URL(ruta.request().url()).searchParams);
  const json = (datos) => ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(datos) });
  if (p.accion === 'piezas') return json({ piezas: [{ id: 'prueba', titulo: 'Pieza de prueba', compositor: '', compases: 16 }] });
  if (p.accion === 'pieza') return json({ id: p.id, musicxml: XML });
  return json({ ok: true, hoja: 'pianobot' });
}

// Web MIDI falso. window.__tocar(eventos) los lanza en su momento: [{ms, datos:[estado, nota, vel]}]
function pianoFalso() {
  const entrada = new EventTarget();
  Object.assign(entrada, { name: 'Piano de prueba', state: 'connected' });
  navigator.requestMIDIAccess = async () => ({ inputs: new Map([['p', entrada]]), outputs: new Map(), onstatechange: null });
  const lanzar = (datos) => {
    const e = new Event('midimessage');
    Object.defineProperty(e, 'data', { value: new Uint8Array(datos) });
    Object.defineProperty(e, 'timeStamp', { value: performance.now() });
    entrada.dispatchEvent(e);
  };
  window.__tocar = (eventos) => new Promise((ok) => {
    for (const ev of eventos) setTimeout(() => lanzar(ev.datos), ev.ms);
    setTimeout(ok, Math.max(...eventos.map((e) => e.ms)) + 50);
  });
}

// Partitura de prueba (partituraPrueba): mano derecha, escala en negras; izquierda, una redonda por compás.
const ESCALA = [0, 2, 4, 5, 7, 9, 11];
const OCTAVA = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
function notaDerecha(m, t) {
  const i = (m + t) % 7;
  return (4 + Math.floor((m + t) / 7) % 2 + 1) * 12 + ESCALA[i];
}
const notaIzquierda = (m) => 4 * 12 + ESCALA[m % 7];

/** Interpretación de los compases desde-hasta a `ppm`, con cambios: {cambiar: {'11:1': +1}, pausaAntes12: s, soloDerecha} */
function interpretacion({ desde = 9, hasta = 12, ppm = 120, cambiar = {}, pausaAntes12 = 0, soloDerecha = false }) {
  const q = 60000 / ppm;
  const eventos = [];
  let t0 = 300;
  for (let m = desde; m <= hasta; m++) {
    if (m === 12) t0 += pausaAntes12 * 1000;
    const inicio = t0 + (m - desde) * 4 * q;
    for (let t = 0; t < 4; t++) {
      const midi = notaDerecha(m, t) + (cambiar[`${m}:${t}`] ?? 0);
      eventos.push({ ms: inicio + t * q, datos: [0x90, midi, 80] }, { ms: inicio + (t + 0.8) * q, datos: [0x80, midi, 0] });
    }
    if (!soloDerecha) {
      const midi = notaIzquierda(m);
      eventos.push({ ms: inicio + 20, datos: [0x90, midi, 70] }, { ms: inicio + 3.6 * q, datos: [0x80, midi, 0] });
    }
  }
  return eventos;
}
void OCTAVA;

const puerto = 8774;
const servidor = await servir(puerto);
const navegador = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const fallos = [];
const comprobar = (ok, texto) => (ok ? console.log(`✓ ${texto}`) : fallos.push(texto));

try {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  await contexto.route(`${APPS_SCRIPT}**`, appsScript);
  await contexto.addInitScript(pianoFalso);
  await contexto.addInitScript(([url, token]) => {
    localStorage.setItem('pianobot.conexion', JSON.stringify({ url, token }));
  }, [APPS_SCRIPT, TOKEN]);
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => fallos.push(`error en la página: ${e.message}`));
  pagina.on('console', (m) => m.type() === 'error' && fallos.push(m.text()));
  await pagina.goto(`http://localhost:${puerto}/`);
  await pagina.waitForFunction(() => / compases$/.test(document.querySelector('#partitura-estado').textContent), null, { timeout: 15000 });

  await pagina.fill('#frag-desde', '9');
  await pagina.dispatchEvent('#frag-desde', 'change');
  await pagina.fill('#frag-hasta', '12');
  await pagina.dispatchEvent('#frag-hasta', 'change');

  await pagina.click('#corregir');
  await pagina.waitForFunction(() => document.querySelector('#estado-punto.ok'));
  comprobar((await pagina.getAttribute('#corregir', 'aria-pressed')) === 'true', '«Corregir» conecta el piano y se activa');
  comprobar((await pagina.textContent('#partitura-estado')).includes('Toca los compases 9–12'), 'dice qué compases tocar');

  // Intento 1: dos notas cambiadas en el compás 11 (mano derecha) y una pausa de 1,5 s antes del 12
  const cursores = [];
  await pagina.exposeFunction('__cursor', (c) => cursores.push(c));
  await pagina.evaluate(() => window.pianobot.partitura.addEventListener('compas', (e) => window.__cursor(e.detail.compas)));
  await pagina.evaluate((ev) => window.__tocar(ev), interpretacion({ cambiar: { '11:1': 1, '11:2': -2 }, pausaAntes12: 1.5 }));
  comprobar([10, 11, 12].every((c) => cursores.includes(c)), `el cursor sigue por dónde vas (${[...new Set(cursores)].join(', ')})`);
  // En directo, antes de que acabe el intento: notas coloreadas y la línea roja en marcha
  await pagina.waitForTimeout(300);
  const enDirecto = await pagina.evaluate(() => ({
    acabado: !!window.pianobot.ultimoIntento,
    falladas: document.querySelectorAll('#partitura .nota-fallada').length,
    bien: document.querySelectorAll('#partitura .nota-bien').length,
    linea: !window.pianobot.partitura.osmd.cursors[1].Hidden,
  }));
  comprobar(!enDirecto.acabado && enDirecto.falladas === 2 && enDirecto.bien >= 15,
    `en directo (antes de acabar), las falladas en rojo y las demás en verde (${enDirecto.falladas} rojas, ${enDirecto.bien} verdes)`);
  comprobar(enDirecto.linea, 'en directo, se ve la línea roja que sigue la nota'); 
  await pagina.waitForFunction(() => window.pianobot.ultimoIntento, null, { timeout: 8000 });
  const r = await pagina.evaluate(() => {
    const u = window.pianobot.ultimoIntento;
    return { total: u.total, filas: u.filas };
  });
  const fila = (c, mano) => r.filas.find((f) => f.compas === c && f.mano === mano);
  comprobar(fila(11, 'derecha').falladas === 2, 'marca 2 falladas en el compás 11, mano derecha');
  comprobar(r.filas.filter((f) => !(f.compas === 11 && f.mano === 'derecha')).every((f) => f.falladas === 0 && f.omitidas === 0), 'ningún otro compás ni mano tiene fallos');
  comprobar(fila(12, 'derecha').titubeos + fila(12, 'izquierda').titubeos === 1 && r.total.titubeos === 1, 'detecta el titubeo antes del compás 12');
  comprobar(r.total.tempo >= 115 && r.total.tempo <= 125, `tempo real ≈ 120 (${r.total.tempo})`);
  comprobar(fila(9, 'derecha').articulacion >= 75 && fila(9, 'derecha').articulacion <= 85, `articulación ≈ 80 % (${fila(9, 'derecha').articulacion})`);
  comprobar(await pagina.evaluate(() => window.pianobot.partitura.osmd.cursors[1].Hidden), 'al acabar, la línea roja se esconde');
  const rojas = await pagina.$$eval('#partitura .nota-fallada', (els) => els.length);
  comprobar(rojas === 2, `las 2 notas falladas, en rojo en la partitura (${rojas})`);
  comprobar(await pagina.isVisible('#tarjeta-intento'), 'se ve la tarjeta «Último intento»');
  const resumen = await pagina.textContent('#intento-resumen');
  comprobar(resumen.includes('18 de 20 bien') && resumen.includes('2 falladas') && resumen.includes('1 titubeo'), `resumen: ${resumen}`);
  const filasTabla = await pagina.$$eval('#intento-filas tr', (trs) => trs.length);
  comprobar(filasTabla === 8, 'tabla: 4 compases × 2 manos');
  if (capturas) await pagina.screenshot({ path: join(capturas, 'corregir.png'), fullPage: false });

  // Intento 2: solo mano derecha, sin fallos, con metrónomo
  await pagina.selectOption('#mano', 'derecha');
  // El metrónomo pequeño de la barra de la partitura
  await pagina.click('#mini-mas');
  comprobar((await pagina.textContent('#mini-tempo')) === '62' && (await pagina.textContent('#tempo-numero')) === '62', 'el + de arriba sube el tempo (y el metrónomo grande lo refleja)');
  await pagina.click('#mini-metro');
  comprobar(await pagina.evaluate(() => window.pianobot.metronomo.sonando), 'el ▶ de arriba arranca el metrónomo');
  await pagina.evaluate(() => { window.pianobot.metronomo.ponerTempo(120); });
  await pagina.evaluate(() => { window.pianobot.ultimoIntentoAnterior = window.pianobot.ultimoIntento; });
  await pagina.evaluate((ev) => window.__tocar(ev), interpretacion({ soloDerecha: true }));
  await pagina.waitForFunction(() => window.pianobot.ultimoIntento?.mano === 'derecha', null, { timeout: 8000 });
  const r2 = await pagina.evaluate(() => window.pianobot.ultimoIntento.total);
  comprobar(r2.notas === 16 && r2.bien === 16 && r2.falladas === 0 && r2.omitidas === 0, 'solo mano derecha: 16 de 16, sin contar la izquierda como omitida');
  comprobar(r2.referencia === 'metrónomo', 'con el metrónomo en marcha, el desajuste se mide contra él');
  comprobar((await pagina.$$eval('#partitura .nota-fallada', (els) => els.length)) === 0, 'un intento nuevo borra las marcas del anterior');

  // Fragmento largo (compases 1-16, letra grande): la hoja baja sola mientras tocas
  await pagina.click('#mini-metro');
  await pagina.selectOption('#mano', 'ambas');
  for (let i = 0; i < 3; i++) await pagina.click('#zoom-mas');
  await pagina.fill('#frag-desde', '1');
  await pagina.dispatchEvent('#frag-desde', 'change');
  await pagina.fill('#frag-hasta', '16');
  await pagina.dispatchEvent('#frag-hasta', 'change');
  await pagina.evaluate(() => {
    const hoja = document.querySelector('#partitura');
    window.__maxScroll = 0;
    hoja.addEventListener('scroll', () => { window.__maxScroll = Math.max(window.__maxScroll, hoja.scrollTop); });
  });
  const altura = await pagina.evaluate(() => ({ hoja: document.querySelector('#partitura').clientHeight, total: document.querySelector('#partitura').scrollHeight }));
  await pagina.evaluate((ev) => window.__tocar(ev), interpretacion({ desde: 1, hasta: 16, ppm: 240 }));
  const bajada = await pagina.evaluate(() => window.__maxScroll);
  comprobar(altura.total > altura.hoja && bajada > 100, `con 16 compases la hoja baja sola (contenido ${altura.total}px en ${altura.hoja}px, bajó ${Math.round(bajada)}px)`);
  const lineaAbajo = await pagina.evaluate(() => {
    const hoja = document.querySelector('#partitura');
    const el = window.pianobot.partitura.osmd.cursors[1].cursorElement;
    return el.offsetTop >= hoja.scrollTop && el.offsetTop + el.offsetHeight <= hoja.scrollTop + hoja.clientHeight + 1;
  });
  comprobar(lineaAbajo, 'la línea roja queda a la vista al llegar al último sistema');
  if (capturas) await pagina.screenshot({ path: join(capturas, 'seguimiento.png') });

  await pagina.click('#corregir');
  comprobar((await pagina.getAttribute('#corregir', 'aria-pressed')) === 'false', 'se desactiva');
  await contexto.close();
} finally {
  await navegador.close();
  servidor.close();
}
if (fallos.length) {
  for (const f of fallos) console.error(`✗ ${f}`);
  process.exit(1);
}
