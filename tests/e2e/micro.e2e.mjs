// Prueba de extremo a extremo del modo micrófono: Chrome recibe un .wav como si fuera el micro
// (escala de La menor armónica sintetizada, a 60 ppm) y la prueba de escala debe salir entera.
//   node tests/e2e/micro.e2e.mjs [--capturas carpeta]

import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { servir } from '../../herramientas/servidor.mjs';
import { sintetizar, wav } from '../sintesis.mjs';
import { ESCALAS } from '../../js/prueba-escala.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const capturas = args.includes('--capturas') ? args[args.indexOf('--capturas') + 1] : null;
if (capturas) mkdirSync(capturas, { recursive: true });

const sr = 48000;
const midis = ESCALAS['la-menor'].notas;
const notas = midis.map((midi, i) => ({ midi, inicio: 2 + i, duracion: 0.85 }));
const dir = mkdtempSync(join(tmpdir(), 'pianobot-'));
const fichero = join(dir, 'escala.wav');
writeFileSync(fichero, wav(sintetizar(notas, { sr, duracion: 2 + midis.length + 1.5, ruidoDb: -65 }), sr));

const puerto = 8765;
const servidor = await servir(puerto);
const navegador = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${fichero}%noloop`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
let fallo = false;
try {
  const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 } });
  const errores = [];
  pagina.on('pageerror', (e) => errores.push(e.message));
  pagina.on('console', (m) => m.type() === 'error' && errores.push(m.text()));
  await pagina.goto(`http://localhost:${puerto}/`);
  await pagina.selectOption('#escala', 'la-menor');
  await pagina.click('[data-fuente="micro"]');
  await pagina.click('#empezar');
  await pagina.waitForFunction(() => document.querySelector('#estado-punto.ok'), null, { timeout: 10000 });
  console.log('Estado:', await pagina.textContent('#estado-texto'));

  await pagina.waitForFunction(
    (n) => document.querySelectorAll('#escala-chips .chip.ok, #escala-chips .chip.omitida').length >= n,
    midis.length,
    { timeout: (midis.length + 8) * 1000 },
  ).catch(() => {});

  const estado = await pagina.$$eval('#escala-chips .chip', (cs) => cs.map((c) => c.className.replace('chip ', '')));
  const notasVistas = await pagina.$$eval('#registro tr td.nota', (tds) => tds.map((t) => t.textContent).reverse());
  console.log('Notas detectadas:', notasVistas.join(' '));
  console.log('Resumen:', await pagina.textContent('#escala-resumen'));
  if (capturas) await pagina.screenshot({ path: join(capturas, 'micro-escala.png'), fullPage: true });

  const ok = estado.filter((s) => s.startsWith('ok')).length;
  if (ok !== midis.length) {
    fallo = true;
    console.error(`✗ Esperaba ${midis.length} notas bien y hay ${ok}`);
  }
  if (errores.length) {
    fallo = true;
    console.error('✗ Errores en la página:', errores);
  }
  if (!fallo) console.log(`✓ Escala entera por el micro (${ok}/${midis.length})`);
} finally {
  await navegador.close();
  servidor.close();
}
process.exit(fallo ? 1 : 0);
