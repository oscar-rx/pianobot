import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costeLlamada, ContadorGasto, formatoDolares } from '../js/gasto.js';

const cerca = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≠ ${b}`);

class Memoria {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.get(k) ?? null; }
  setItem(k, v) { this.m.set(k, String(v)); }
}

test('coste de una llamada típica del profe con Haiku', () => {
  // 3000 de entrada, 120 de salida → 3000·0.10/1e6 + 120·0.50/1e6
  cerca(costeLlamada('claude-haiku-5-5', { input_tokens: 3000, output_tokens: 120 }), 0.0003 + 0.00006);
});

test('Sonnet con caché', () => {
  const c = costeLlamada('claude-sonnet-5-5', {
    input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2000,
  });
  cerca(c, (1000 * 2 + 500 * 10 + 10_000 * 0.2 + 2000 * 2.5) / 1e6);
});

test('Haiku con prompt largo pasa a la tarifa alta', () => {
  cerca(costeLlamada('claude-haiku-5-5', { input_tokens: 150_000, output_tokens: 1000 }), (150_000 * 0.5 + 1000 * 2.5) / 1e6);
});

test('modelo desconocido da error en vez de contar cero', () => {
  assert.throws(() => costeLlamada('claude-desconocido', { input_tokens: 1 }));
});

test('acumula por sesión y por mes, y avisa al acercarse al tope', () => {
  const almacen = new Memoria();
  const g = new ContadorGasto(almacen);
  g.tope = 1;
  const nov = new Date(2026, 10, 2);
  for (let i = 0; i < 2000; i++) g.registrar('claude-haiku-5-5', { input_tokens: 3000, output_tokens: 120 }, nov);
  cerca(g.totalMes(nov), 2000 * 0.00036);
  assert.equal(g.estado(nov), 'ok');
  for (let i = 0; i < 50; i++) g.registrar('claude-sonnet-5-5', { input_tokens: 500, output_tokens: 100 }, nov);
  assert.equal(g.estado(nov), 'cerca');
  for (let i = 0; i < 100; i++) g.registrar('claude-sonnet-5-5', { input_tokens: 500, output_tokens: 100 }, nov);
  assert.equal(g.estado(nov), 'pasado');

  // El mes se guarda; la sesión empieza de cero al recargar
  const otra = new ContadorGasto(almacen);
  cerca(otra.totalMes(nov), g.totalMes(nov));
  assert.equal(otra.sesion, 0);
  assert.equal(otra.tope, 1);
  assert.equal(otra.totalMes(new Date(2026, 11, 1)), 0);
});

test('formato en dólares', () => {
  assert.equal(formatoDolares(0), '$0.00');
  assert.equal(formatoDolares(0.00042), '$0.0004');
  assert.equal(formatoDolares(0.314), '$0.314');
  assert.equal(formatoDolares(12.4), '$12.40');
});
