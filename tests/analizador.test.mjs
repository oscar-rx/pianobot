import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalizadorAudio } from '../js/dsp/analizador.js';
import { sintetizar, anadirGolpe } from './sintesis.mjs';

const sr = 48000;

function analizar(x) {
  const a = new AnalizadorAudio({ frecuenciaMuestreo: sr });
  const eventos = [];
  for (let i = 0; i < x.length; i += 512) eventos.push(...a.alimentar(x.subarray(i, i + 512)));
  return eventos;
}

const escalaDo = [60, 62, 64, 65, 67, 69, 71, 72];

test('escala de Do a negras, 60 ppm, notas separadas', () => {
  const notas = escalaDo.map((midi, i) => ({ midi, inicio: 0.5 + i, duracion: 0.8 }));
  const ons = analizar(sintetizar(notas, { sr })).filter((e) => e.tipo === 'noteon');
  assert.deepEqual(ons.map((e) => e.midi), escalaDo);
  ons.forEach((e, i) => assert.ok(Math.abs(e.tiempo - notas[i].inicio) < 0.015, `nota ${i}: ${(e.tiempo - notas[i].inicio) * 1000} ms`));
});

test('escala ligada a semicorcheas a 90 ppm (cada nota suena hasta la siguiente)', () => {
  const d = 60 / 90 / 4;
  const midis = [...escalaDo, ...escalaDo.slice(0, -1).reverse()];
  const notas = midis.map((midi, i) => ({ midi, inicio: 0.5 + i * d, duracion: d + 0.01 }));
  const ons = analizar(sintetizar(notas, { sr })).filter((e) => e.tipo === 'noteon');
  assert.deepEqual(ons.map((e) => e.midi), midis);
  ons.forEach((e, i) => assert.ok(Math.abs(e.tiempo - notas[i].inicio) < 0.025, `nota ${i}: ${(e.tiempo - notas[i].inicio) * 1000} ms`));
});

test('nota repetida: cada pulsación cuenta', () => {
  const notas = [0, 1, 2, 3].map((i) => ({ midi: 69, inicio: 0.5 + i * 0.4, duracion: 0.35 }));
  const ons = analizar(sintetizar(notas, { sr })).filter((e) => e.tipo === 'noteon');
  assert.equal(ons.length, 4);
});

test('nota repetida sin soltar del todo (el sonido no llega a apagarse)', () => {
  const notas = [0, 1, 2].map((i) => ({ midi: 57, inicio: 0.5 + i * 0.3, duracion: 0.6 }));
  const ons = analizar(sintetizar(notas, { sr })).filter((e) => e.tipo === 'noteon');
  assert.deepEqual(ons.map((e) => e.midi), [57, 57, 57]);
});

test('registro grave y agudo de la Invención 13', () => {
  const midis = [33, 40, 45, 52, 81, 84, 88];
  const notas = midis.map((midi, i) => ({ midi, inicio: 0.5 + i * 0.6, duracion: 0.5 }));
  const ons = analizar(sintetizar(notas, { sr })).filter((e) => e.tipo === 'noteon');
  assert.deepEqual(ons.map((e) => e.midi), midis);
});

test('notas suaves y fuertes: la fuerza aproximada respeta el orden', () => {
  const notas = [0.15, 0.4, 0.9].map((fuerza, i) => ({ midi: 64, inicio: 0.5 + i * 0.7, duracion: 0.6, fuerza }));
  const ons = analizar(sintetizar(notas, { sr })).filter((e) => e.tipo === 'noteon');
  assert.equal(ons.length, 3);
  assert.ok(ons[0].velocidad < ons[1].velocidad && ons[1].velocidad < ons[2].velocidad, ons.map((e) => e.velocidad).join(','));
});

test('golpes y clics sin tono no son notas', () => {
  const x = sintetizar([{ midi: 60, inicio: 3, duracion: 0.5 }], { sr, duracion: 4 });
  for (const t of [0.5, 1, 1.5, 2, 2.5]) anadirGolpe(x, t, { sr });
  const ons = analizar(x).filter((e) => e.tipo === 'noteon');
  assert.deepEqual(ons.map((e) => e.midi), [60]);
});

test('el silencio con ruido de fondo no genera notas', () => {
  const x = sintetizar([{ midi: 60, inicio: 10, duracion: 0.1 }], { sr, duracion: 3, ruidoDb: -50 });
  assert.equal(analizar(x).filter((e) => e.tipo === 'noteon').length, 0);
});

test('cada noteon tiene su noteoff y no se solapan', () => {
  const notas = escalaDo.map((midi, i) => ({ midi, inicio: 0.5 + i * 0.25, duracion: 0.2 }));
  const ev = analizar(sintetizar(notas, { sr }));
  let activa = null;
  for (const e of ev) {
    if (e.tipo === 'noteon') {
      assert.equal(activa, null, 'noteon con otra nota activa');
      activa = e.midi;
    } else {
      assert.equal(e.midi, activa);
      activa = null;
    }
  }
});

test('arpegios con saltos, como el comienzo de la Invención 13, a semicorcheas a 70 ppm', () => {
  const d = 60 / 70 / 4;
  const midis = [64, 69, 72, 71, 64, 71, 74, 72, 76, 68, 76, 72, 69, 64, 57, 45, 52, 57, 60, 59];
  const notas = midis.map((midi, i) => ({ midi, inicio: 0.5 + i * d, duracion: d + 0.02 }));
  const ons = analizar(sintetizar(notas, { sr })).filter((e) => e.tipo === 'noteon');
  assert.deepEqual(ons.map((e) => e.midi), midis);
  ons.forEach((e, i) => assert.ok(Math.abs(e.tiempo - notas[i].inicio) < 0.025, `nota ${i}: ${(e.tiempo - notas[i].inicio) * 1000} ms`));
});

// Habitación «en silencio» como la oye un micro de tablet: arranca con silencio digital
// (ceros mientras el micro se enciende) y luego ruido que sube y baja, con un zumbido débil
// (nevera, red eléctrica). Las notas de verdad suenan mucho más fuertes.
function habitacion(duracion, { conZumbido = true } = {}) {
  const x = new Float32Array(Math.round(duracion * sr));
  let s = 99;
  const azar = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5);
  for (let i = Math.round(0.4 * sr); i < x.length; i++) {
    const t = i / sr;
    // ruido que fluctúa unos ±6 dB a ritmo irregular
    const vaiven = Math.pow(10, (6 * Math.sin(2 * Math.PI * 1.7 * t) * Math.sin(2 * Math.PI * 0.43 * t + 1)) / 20);
    x[i] = 0.002 * vaiven * azar();
    if (conZumbido) x[i] += 0.0015 * vaiven * Math.sin(2 * Math.PI * 100 * t) + 0.001 * Math.sin(2 * Math.PI * 150 * t);
  }
  return x;
}

for (const sensibilidadDb of [12, 30]) {
  test(`habitación en silencio con arranque en ceros: ninguna nota falsa (umbral ${sensibilidadDb} dB)`, () => {
    const a = new AnalizadorAudio({ frecuenciaMuestreo: sr, sensibilidadDb });
    const x = habitacion(8);
    const ons = [];
    for (let i = 0; i < x.length; i += 512) ons.push(...a.alimentar(x.subarray(i, i + 512)).filter((e) => e.tipo === 'noteon'));
    assert.deepEqual(ons.map((e) => e.midi), []);
  });
}

test('tras el arranque en ceros, las notas de verdad se siguen oyendo', () => {
  const ruido = habitacion(6);
  const notas = [64, 69, 72].map((midi, i) => ({ midi, inicio: 2 + i, duracion: 0.6 }));
  const piano = sintetizar(notas, { sr, duracion: 6, ruidoDb: -120 });
  for (let i = 0; i < piano.length; i++) piano[i] += ruido[i];
  const ons = analizar(piano).filter((e) => e.tipo === 'noteon');
  assert.deepEqual(ons.map((e) => e.midi), [64, 69, 72]);
});

test('el umbral responde: subirlo deja fuera las notas suaves', () => {
  const ruido = habitacion(5, { conZumbido: false });
  const piano = sintetizar([{ midi: 60, inicio: 2, duracion: 0.6, fuerza: 0.02 }], { sr, duracion: 5, ruidoDb: -120 });
  for (let i = 0; i < piano.length; i++) piano[i] += ruido[i];
  const contar = (sensibilidadDb) => {
    const a = new AnalizadorAudio({ frecuenciaMuestreo: sr, sensibilidadDb });
    let n = 0;
    for (let i = 0; i < piano.length; i += 512) n += a.alimentar(piano.subarray(i, i + 512)).filter((e) => e.tipo === 'noteon').length;
    return n;
  };
  assert.equal(contar(10), 1);
  assert.equal(contar(40), 0);
});
