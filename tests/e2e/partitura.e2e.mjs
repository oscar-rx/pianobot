// Fase 2 · «Listo cuando: pides compases 9 a 12 y salen solos».
// Carga la Invención 13 en Chrome, pide fragmentos y comprueba qué compases quedan pintados.
//   node tests/e2e/partitura.e2e.mjs [--capturas carpeta]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { servir } from '../../herramientas/servidor.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const capturas = args.includes('--capturas') ? args[args.indexOf('--capturas') + 1] : null;
if (capturas) mkdirSync(capturas, { recursive: true });

const puerto = 8769;
const servidor = await servir(puerto);
const navegador = await chromium.launch();
const fallos = [];
const comprobar = (ok, texto) => (ok ? console.log(`✓ ${texto}`) : fallos.push(texto));
const pintados = (p) => p.evaluate(() => window.pianobot.partitura.compasesPintados());

try {
  for (const [nombre, viewport] of [['tablet', { width: 1280, height: 800 }], ['movil', { width: 390, height: 844 }]]) {
    const pagina = await navegador.newPage({ viewport });
    pagina.on('pageerror', (e) => fallos.push(`${nombre}: error en la página: ${e.message}`));
    pagina.on('console', (m) => m.type() === 'error' && fallos.push(`${nombre}: ${m.text()}`));
    await pagina.goto(`http://localhost:${puerto}/`);
    await pagina.waitForFunction(() => /compases$/.test(document.querySelector('#partitura-estado').textContent), null, { timeout: 15000 });
    comprobar((await pagina.textContent('#pieza-titulo')) === 'Invención n.º 13', `${nombre}: carga la Invención 13`);
    comprobar((await pagina.evaluate(() => window.pianobot.partitura.numCompases)) === 25, `${nombre}: 25 compases`);
    comprobar(JSON.stringify(await pintados(pagina)) === '[1,2,3,4]', `${nombre}: al empezar, compases 1 a 4`);

    await pagina.fill('#frag-desde', '9');
    await pagina.dispatchEvent('#frag-desde', 'change');
    await pagina.fill('#frag-hasta', '12');
    await pagina.dispatchEvent('#frag-hasta', 'change');
    comprobar(JSON.stringify(await pintados(pagina)) === '[9,10,11,12]', `${nombre}: pides 9 a 12 y salen solos`);
    comprobar((await pagina.textContent('#cursor-compas')) === '9', `${nombre}: el cursor marca el compás 9`);
    if (capturas) await pagina.screenshot({ path: join(capturas, `partitura-${nombre}.png`), fullPage: nombre === 'movil' });

    await pagina.click('#cursor-siguiente');
    await pagina.click('#cursor-siguiente');
    comprobar((await pagina.textContent('#cursor-compas')) === '11', `${nombre}: el cursor avanza al 11`);

    await pagina.click('#frag-siguiente');
    comprobar(JSON.stringify(await pintados(pagina)) === '[13,14,15,16]', `${nombre}: siguiente fragmento, 13 a 16`);
    await pagina.fill('#frag-hasta', '30');
    await pagina.dispatchEvent('#frag-hasta', 'change');
    const final = await pintados(pagina);
    comprobar(final[0] === 13 && final.at(-1) === 25, `${nombre}: un número fuera de rango se corrige (13 a 25)`);

    // El fragmento se recuerda al volver a abrir
    await pagina.reload();
    await pagina.waitForFunction(() => /compases$/.test(document.querySelector('#partitura-estado').textContent));
    comprobar(JSON.stringify(await pintados(pagina)) === JSON.stringify(final), `${nombre}: recuerda el fragmento al recargar`);

    const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth);
    comprobar(ancho <= viewport.width, `${nombre}: sin scroll horizontal de la página (${ancho}px)`);
    await pagina.close();
  }
} finally {
  await navegador.close();
  servidor.close();
}
if (fallos.length) {
  for (const f of fallos) console.error(`✗ ${f}`);
  process.exit(1);
}
