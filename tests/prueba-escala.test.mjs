import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PruebaEscala, ESCALAS } from '../js/prueba-escala.js';

test('escala perfecta', () => {
  const p = new PruebaEscala(ESCALAS['do-mayor'].notas);
  for (const m of ESCALAS['do-mayor'].notas) p.registrar(m, 0.01);
  assert.ok(p.terminada);
  const r = p.resumen();
  assert.deepEqual([r.ok, r.omitidas, r.falladas], [15, 0, 0]);
  assert.ok(Math.abs(r.desajusteMedio - 0.01) < 1e-9);
});

test('una omitida y una fallada', () => {
  const p = new PruebaEscala([60, 62, 64, 65, 67]);
  p.registrar(60);
  p.registrar(64); // se salta el 62
  p.registrar(66); // fallo
  p.registrar(65);
  p.registrar(67);
  assert.deepEqual(p.estado, ['ok', 'omitida', 'ok', 'ok', 'ok']);
  assert.deepEqual(p.falladas, [{ midi: 66, posicion: 3 }]);
  assert.ok(p.terminada);
});
