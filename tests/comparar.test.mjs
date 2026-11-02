import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alinear, analizar } from '../js/comparar.js';
import { GrabadorIntentos } from '../js/intento.js';

// Fragmento de prueba: 4 compases de 4/4 (compases 9 a 12). Mano derecha en semicorcheas (escala que sube y baja),
// mano izquierda en negras. pos y dur en negras desde el principio del fragmento.
const DERECHA = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62];
function fragmento() {
  const esperadas = [];
  for (let c = 0; c < 4; c++) {
    DERECHA.forEach((midi, k) => esperadas.push({ clave: `d${c}-${k}`, midi: midi + (c % 2 ? 12 : 0), pos: c * 4 + k / 4, dur: 0.25, compas: 9 + c, pentagrama: 0, mano: 'derecha' }));
    [48, 43, 45, 41].forEach((midi, k) => esperadas.push({ clave: `i${c}-${k}`, midi, pos: c * 4 + k, dur: 1, compas: 9 + c, pentagrama: 1, mano: 'izquierda' }));
  }
  esperadas.sort((a, b) => a.pos - b.pos || a.midi - b.midi);
  const compases = [0, 1, 2, 3].map((c) => ({ numero: 9 + c, inicio: c * 4, duracion: 4 }));
  return { esperadas, compases };
}

/** Toca las esperadas a un tempo, con retoques: {cambiar: {clave: midi}, saltar: Set, extra: [{midi, pos}], retraso: {clave: s}, legato: 0.9} */
function tocar(esperadas, { ppm = 60, inicio = 10, cambiar = {}, saltar = new Set(), extra = [], retraso = {}, legato = 0.9, ruido = 0 } = {}) {
  const q = 60 / ppm;
  let semilla = 1;
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const tocadas = [];
  let empuje = 0;
  for (const e of esperadas) {
    if (saltar.has(e.clave)) continue;
    empuje += retraso[e.clave] ?? 0;
    const t = inicio + e.pos * q + empuje + ruido * azar();
    tocadas.push({ midi: cambiar[e.clave] ?? e.midi, t, fin: t + e.dur * q * legato, velocidad: 80 });
  }
  for (const x of extra) tocadas.push({ midi: x.midi, t: inicio + x.pos * q + 0.01, fin: inicio + x.pos * q + 0.1, velocidad: 60 });
  return tocadas;
}
const fila = (r, compas, mano) => r.filas.find((f) => f.compas === compas && f.mano === mano);

test('intento perfecto: todo bien, tempo y desajuste ~0', () => {
  const { esperadas, compases } = fragmento();
  const r = analizar({ esperadas, compases, tocadas: tocar(esperadas, { ppm: 72, ruido: 0.005 }) });
  assert.equal(r.total.bien, esperadas.length);
  assert.equal(r.total.falladas + r.total.omitidas + r.total.titubeos, 0);
  assert.equal(r.total.tempo, 72);
  assert.equal(r.total.referencia, 'tu pulso');
  assert.ok(r.total.desajusteAbsMs <= 6, `desajuste ${r.total.desajusteAbsMs}`);
  assert.equal(fila(r, 10, 'derecha').articulacion, 90);
  assert.equal(r.filas.length, 8);
});

test('fallas a propósito el compás 11: lo marca en el 11 y en la mano correcta', () => {
  const { esperadas, compases } = fragmento();
  const mal = esperadas.filter((e) => e.compas === 11 && e.mano === 'derecha').slice(4, 6); // dos notas cambiadas
  const r = analizar({ esperadas, compases, tocadas: tocar(esperadas, { cambiar: { [mal[0].clave]: mal[0].midi + 1, [mal[1].clave]: mal[1].midi - 2 } }) });
  assert.equal(fila(r, 11, 'derecha').falladas, 2);
  for (const f of r.filas) if (!(f.compas === 11 && f.mano === 'derecha')) assert.equal(f.falladas + f.omitidas, 0, `${f.compas} ${f.mano}`);
  assert.equal(r.notas.get(mal[0].clave).estado, 'fallada');
  assert.equal(r.notas.get(mal[0].clave).tocada, mal[0].midi + 1);
});

test('una nota omitida y una de más no descuadran el resto', () => {
  const { esperadas, compases } = fragmento();
  const omitida = esperadas.find((e) => e.compas === 10 && e.mano === 'izquierda');
  const r = analizar({ esperadas, compases, tocadas: tocar(esperadas, { saltar: new Set([omitida.clave]), extra: [{ midi: 90, pos: 9.5 }] }) });
  assert.equal(fila(r, 10, 'izquierda').omitidas, 1);
  assert.equal(r.notas.get(omitida.clave).estado, 'omitida');
  assert.equal(r.total.sobrantes, 1);
  assert.equal(r.total.omitidas, 1);
  assert.equal(r.total.bien, esperadas.length - 1);
  assert.equal(r.sobrantes[0].compas, 11);
});

test('las dos manos un poco desfasadas (acordes no del todo juntos) siguen bien', () => {
  const { esperadas, compases } = fragmento();
  const tocadas = tocar(esperadas).map((t) => (t.midi < 55 ? { ...t, t: t.t + 0.05, fin: t.fin + 0.05 } : t));
  const r = analizar({ esperadas, compases, tocadas });
  assert.equal(r.total.bien, esperadas.length);
  assert.equal(r.total.falladas, 0);
});

test('un titubeo: pausa larga antes del compás 12', () => {
  const { esperadas, compases } = fragmento();
  const primera12 = esperadas.find((e) => e.compas === 12);
  const r = analizar({ esperadas, compases, tocadas: tocar(esperadas, { retraso: { [primera12.clave]: 1.2 } }) });
  assert.equal(r.total.titubeos, 1);
  assert.equal(fila(r, 12, primera12.mano).titubeos, 1);
  // La pausa no arrastra ni el tempo, ni la articulación, ni el desajuste respecto a tu pulso
  assert.equal(r.total.tempo, 60);
  assert.equal(fila(r, 12, 'izquierda').articulacion, 90);
  assert.ok(r.total.desajusteAbsMs <= 2, `desajuste ${r.total.desajusteAbsMs}`);
});

test('con metrónomo: el desajuste se mide contra sus clics (vas 40 ms tarde)', () => {
  const { esperadas, compases } = fragmento();
  // El metrónomo a 60 tiene un pulso en t = 100.5; tocas con el compás empezando en 103.54 (40 ms tarde)
  const r = analizar({ esperadas, compases, tocadas: tocar(esperadas, { ppm: 60, inicio: 103.54 }), metronomo: { ppm: 60, origen: 100.5 } });
  assert.equal(r.total.referencia, 'metrónomo');
  assert.equal(r.total.desajusteMs, 40);
  // Si vas más lento que el metrónomo, el desajuste crece y el tempo real lo dice
  const lento = analizar({ esperadas, compases, tocadas: tocar(esperadas, { ppm: 56, inicio: 103.5 }), metronomo: { ppm: 60, origen: 100.5 } });
  assert.equal(lento.total.tempo, 56);
  assert.ok(fila(lento, 12, 'derecha').desajusteMs > fila(lento, 9, 'derecha').desajusteMs + 500);
});

test('articulación: picado y legato largo se distinguen (en % del valor escrito)', () => {
  const { esperadas, compases } = fragmento();
  assert.equal(fila(analizar({ esperadas, compases, tocadas: tocar(esperadas, { legato: 0.4 }) }), 9, 'izquierda').articulacion, 40);
  assert.equal(fila(analizar({ esperadas, compases, tocadas: tocar(esperadas, { legato: 1.15 }) }), 9, 'izquierda').articulacion, 115);
});

test('pedal: aparte de las notas, por compás', () => {
  const { esperadas, compases } = fragmento();
  // A 60 ppm el fragmento empieza en t=10: compás 9 = 10-14, 10 = 14-18, 11 = 18-22, 12 = 22-26.
  // Pedal pisado de 14,1 a 16,1 y de 20,1 a 30.
  const pedal = { inicial: false, eventos: [{ pisado: true, t: 14.1 }, { pisado: false, t: 16.1 }, { pisado: true, t: 20.1 }, { pisado: false, t: 30 }] };
  const r = analizar({ esperadas, compases, tocadas: tocar(esperadas), pedal });
  assert.deepEqual(r.pedal.map((p) => [p.compas, p.pisadoPct, p.pisadas]), [[9, 0, 0], [10, 50, 1], [11, 47, 1], [12, 100, 0]]);
});

test('en directo (finLibre): lo que aún no se ha tocado no cuenta como omitido', () => {
  const { esperadas } = fragmento();
  const tocadas = tocar(esperadas).slice(0, 12);
  const al = alinear(esperadas, tocadas, { finLibre: true });
  assert.equal(al.omitidas.length, 0);
  assert.equal(al.pares.length, 12);
  assert.equal(al.pendientes.length, esperadas.length - 12);
});

test('grabador: un intento termina tras el silencio, con su pedal; espera si hay una tecla pulsada', () => {
  let reloj = 0;
  const tareas = [];
  const g = new GrabadorIntentos({
    silencio: 2.5,
    ahora: () => reloj,
    programar: (f, ms) => tareas.push({ f, cuando: reloj + ms / 1000 }) - 1,
    cancelar: (i) => i != null && tareas[i] && (tareas[i].f = null),
  });
  const avanzar = (s) => {
    reloj += s;
    for (const t of tareas) if (t.f && t.cuando <= reloj) { const f = t.f; t.f = null; f(); }
  };
  const intentos = [];
  g.addEventListener('intento', (e) => intentos.push(e.detail));
  g.nota({ tipo: 'noteon', midi: 60, tiempo: 1 }); // inactivo: no cuenta
  g.activar(true);
  g.pedalCambia({ pisado: true, tiempo: 1.5 }); // antes de empezar: estado inicial
  g.nota({ tipo: 'noteon', midi: 60, tiempo: 2 });
  g.pedalCambia({ pisado: false, tiempo: 2.2 });
  g.nota({ tipo: 'noteon', midi: 64, tiempo: 2.5 });
  g.nota({ tipo: 'noteoff', midi: 60, tiempo: 2.6 });
  avanzar(3); // 64 sigue pulsada: no termina
  assert.equal(intentos.length, 0);
  g.nota({ tipo: 'noteoff', midi: 64, tiempo: 6 });
  avanzar(2);
  assert.equal(intentos.length, 0);
  avanzar(1);
  assert.equal(intentos.length, 1);
  assert.deepEqual(intentos[0].notas.map((n) => [n.midi, n.t, n.fin]), [[60, 2, 2.6], [64, 2.5, 6]]);
  assert.deepEqual(intentos[0].pedal, { inicial: true, eventos: [{ pisado: false, t: 2.2 }] });
  g.nota({ tipo: 'noteon', midi: 67, tiempo: 10 });
  g.activar(false); // desactivar descarta lo empezado
  avanzar(5);
  assert.equal(intentos.length, 1);
});
