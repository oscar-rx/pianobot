import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PracticaAlTempo } from '../js/al-tempo.js';

// 2 compases de 4/4: mano derecha en corcheas (Do-Re-Mi-Fa-Sol-La-Si-Do ×2), izquierda en blancas
function fragmento() {
  const esperadas = [];
  [60, 62, 64, 65, 67, 69, 71, 72].forEach((midi, k) => {
    for (let c = 0; c < 2; c++) esperadas.push({ clave: `d${c}-${k}`, midi, pos: c * 4 + k / 2, dur: 0.5, compas: 1 + c, pentagrama: 0, mano: 'derecha' });
  });
  for (let c = 0; c < 2; c++) for (let k = 0; k < 2; k++) esperadas.push({ clave: `i${c}-${k}`, midi: 48 + k * 7, pos: c * 4 + k * 2, dur: 2, compas: 1 + c, pentagrama: 1, mano: 'izquierda' });
  esperadas.sort((a, b) => a.pos - b.pos || a.midi - b.midi);
  return { esperadas, compases: [{ numero: 1, inicio: 0, duracion: 4 }, { numero: 2, inicio: 4, duracion: 4 }] };
}

test('al tempo: acierto en verde, fallo en rojo, saltada en naranja, y en su momento', () => {
  const { esperadas, compases } = fragmento();
  const p = new PracticaAlTempo({ esperadas, t0: 10, negra: 0.5, duracion: 8 }); // 120 ppm
  const estados = new Map();
  const apuntar = (cambios) => cambios.forEach((c) => estados.set(c.clave, c.estado));
  for (const e of esperadas) {
    const t = 10 + e.pos * 0.5 + 0.02; // 20 ms tarde
    apuntar(p.avanzar(t));
    if (e.clave === 'd0-3') continue; // se salta el Fa del compás 1
    const midi = e.clave === 'd1-5' ? 70 : e.midi; // La del compás 2 → La#: fallo
    apuntar(p.nota({ tipo: 'noteon', midi, tiempo: t }));
    apuntar(p.nota({ tipo: 'noteoff', midi, tiempo: t + e.dur * 0.5 * 0.7 }));
  }
  // El Fa saltado se marca en naranja en cuanto pasa su momento, sin esperar al final
  assert.equal(estados.get('d0-3'), 'omitida');
  assert.equal(estados.get('d1-5'), 'fallada');
  assert.equal(estados.get('d0-0'), 'bien');
  assert.equal([...estados.values()].filter((x) => x === 'bien').length, esperadas.length - 2);
  assert.ok(!p.terminado(14), 'a mitad no ha terminado');
  assert.ok(p.terminado(10 + 8 * 0.5 + 0.4), 'termina tras el último tiempo');
  const r = p.resumen(compases);
  assert.equal(r.total.bien, esperadas.length - 2);
  assert.equal(r.total.falladas, 1);
  assert.equal(r.total.omitidas, 1);
  assert.equal(r.total.desajusteMs, 20);
  assert.equal(r.total.referencia, 'metrónomo');
  assert.equal(r.filas.find((f) => f.compas === 1 && f.mano === 'derecha').omitidas, 1);
  assert.equal(r.filas.find((f) => f.compas === 2 && f.mano === 'derecha').falladas, 1);
  assert.equal(r.filas.find((f) => f.compas === 1 && f.mano === 'izquierda').articulacion, 70);
});

test('al tempo: tocar a destiempo (fuera del margen) no cuenta como acierto', () => {
  const { esperadas } = fragmento();
  const p = new PracticaAlTempo({ esperadas, t0: 0, negra: 0.5, duracion: 8 });
  const do4 = esperadas.find((e) => e.clave === 'd0-0');
  // Do4 tocado 375 ms tarde (justo entre el Re y el Mi siguientes): ya ha pasado su momento → omitida,
  // y la tecla no cae en el margen de ninguna nota → sobrante
  // (a los 0,36 s también ha pasado la primera de la izquierda, cuyo margen es el máximo, 350 ms)
  assert.deepEqual(p.avanzar(0.36).map((c) => c.clave).sort(), ['d0-0', 'i0-0']);
  assert.deepEqual(p.nota({ tipo: 'noteon', midi: do4.midi, tiempo: 0.375 }), []);
  assert.equal(p.sobrantes.length, 1);
  // Durante la cuenta la posición es negativa
  assert.equal(p.posicion(-1), -2);
});

test('al tempo: un retraso constante (teclado o costumbre) se descuenta, pero se sigue midiendo', () => {
  const { esperadas, compases } = fragmento();
  const p = new PracticaAlTempo({ esperadas, t0: 0, negra: 0.5, duracion: 8 });
  const estados = new Map();
  for (const e of esperadas) {
    // ~110 ms tarde, unas veces 70 y otras 150: 150 se sale del margen de las corcheas (125 ms) si no se descuenta
    const t = e.pos * 0.5 + (Math.round(e.pos * 2) % 2 ? 0.15 : 0.07);
    p.avanzar(t).forEach((c) => estados.set(c.clave, c.estado));
    p.nota({ tipo: 'noteon', midi: e.midi, tiempo: t }).forEach((c) => estados.set(c.clave, c.estado));
  }
  const bien = [...estados.values()].filter((x) => x === 'bien').length;
  // Las primeras pueden caer (aún no sabe que vas tarde); en cuanto lo nota, las demás cuentan
  assert.ok(bien >= esperadas.length - 4, `${bien} de ${esperadas.length}`);
  assert.ok(esperadas.filter((e) => e.compas === 2).every((e) => estados.get(e.clave) === 'bien'), 'el compás 2, entero bien');
  assert.ok(p.sesgo > 0.06 && p.sesgo < 0.16, `sesgo ${p.sesgo}`);
  const ms = p.resumen(compases).total.desajusteMs;
  assert.ok(ms >= 70 && ms <= 150, `desajuste ${ms}`);
});
