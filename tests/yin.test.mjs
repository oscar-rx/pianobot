import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DetectorYin } from '../js/dsp/yin.js';
import { frecuenciaAMidi } from '../js/notas.js';
import { sintetizar, crearRuido } from './sintesis.mjs';

const sr = 48000;

test('detecta la altura de notas tipo piano en todo el registro útil', () => {
  const yin = new DetectorYin({ frecuenciaMuestreo: sr });
  // de La1 a Do7
  for (let midi = 33; midi <= 96; midi += 1) {
    const x = sintetizar([{ midi, inicio: 0, duracion: 0.3 }], { sr, duracion: 0.3 });
    const r = yin.detectar(x.subarray(4800, 4800 + 2048));
    assert.ok(r.frecuencia > 0, `sin tono para MIDI ${midi}`);
    const detectado = frecuenciaAMidi(r.frecuencia);
    assert.ok(Math.abs(detectado - midi) < 0.3, `MIDI ${midi}: detectado ${detectado.toFixed(2)}`);
  }
});

test('el ruido no tiene tono', () => {
  const yin = new DetectorYin({ frecuenciaMuestreo: sr });
  const ruido = crearRuido(5);
  const x = new Float32Array(2048).map(() => ruido());
  assert.equal(yin.detectar(x).frecuencia, 0);
});
