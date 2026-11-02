// Digitación en la tablet: «Digitar» → tocar una nota → dedo 1-5 → salta a la siguiente de esa mano.
// Se escribe como <fingering> en el MusicXML y se guarda en Drive (Apps Script simulado);
// sin conexión queda en la tablet y se sube en cuanto se puede.
//   node tests/e2e/digitacion.e2e.mjs [--capturas carpeta]

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
const drive = { prueba: partituraPrueba(12) };
const estado = { caido: false, guardados: [] };

async function appsScript(ruta) {
  const peticion = ruta.request();
  const p = peticion.method() === 'POST' ? JSON.parse(peticion.postData()) : Object.fromEntries(new URL(peticion.url()).searchParams);
  if (estado.caido) return ruta.abort('internetdisconnected');
  const json = (datos) => ruta.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(datos) });
  if (p.token !== TOKEN) return json({ error: 'Token incorrecto.' });
  switch (p.accion) {
    case 'hola': return json({ ok: true, hoja: 'pianobot' });
    case 'piezas': return json({ piezas: [{ id: 'prueba', titulo: 'Pieza de prueba', compositor: '', compases: 12 }] });
    case 'pieza': return json({ id: p.id, musicxml: drive[p.id] });
    case 'guardar':
      drive[p.id] = p.musicxml;
      estado.guardados.push(p.musicxml);
      return json({ pieza: { id: p.id } });
    default: return json({ error: 'Acción desconocida' });
  }
}

// Dedos escritos en el MusicXML, por compás: «compás:paso+octava=dedo»
function dedosEn(xml) {
  const fuera = [];
  for (const [, num, cuerpo] of xml.matchAll(/<measure number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g)) {
    for (const [nota] of cuerpo.matchAll(/<note>[\s\S]*?<\/note>/g)) {
      const dedo = nota.match(/<fingering>(\d)<\/fingering>/);
      if (dedo) fuera.push(`${num}:${nota.match(/<step>(\w)/)[1]}${nota.match(/<octave>(\d)/)[1]}=${dedo[1]}`);
    }
  }
  return fuera;
}

const puerto = 8770;
const servidor = await servir(puerto);
const navegador = await chromium.launch();
const fallos = [];
const comprobar = (ok, texto) => (ok ? console.log(`✓ ${texto}`) : fallos.push(texto));

try {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  await contexto.route(`${APPS_SCRIPT}**`, appsScript);
  await contexto.addInitScript(([url, token]) => {
    if (!localStorage.getItem('pianobot.conexion')) localStorage.setItem('pianobot.conexion', JSON.stringify({ url, token }));
  }, [APPS_SCRIPT, TOKEN]);
  const pagina = await contexto.newPage();
  pagina.on('pageerror', (e) => fallos.push(`error en la página: ${e.message}`));
  pagina.on('console', (m) => m.type() === 'error' && !estado.caido && fallos.push(m.text()));
  const cargada = () => pagina.waitForFunction(() => / compases$|Copia guardada|tablet/.test(document.querySelector('#partitura-estado').textContent), null, { timeout: 15000 });
  const elegida = () => pagina.textContent('#dig-nota');
  // Centro de la cabeza de la n-ésima nota pintada de un pentagrama (0 = mano derecha)
  const posicionNota = (pentagrama, n) => pagina.evaluate(([pentagrama, n]) => {
    const notas = [...window.pianobot.partitura.notasPintadas()].filter((g) => !g.sourceNote.isRest() && g.sourceNote.ParentStaff.idInMusicSheet === pentagrama);
    const cabeza = notas[n].getSVGGElement().querySelector('.vf-notehead') ?? notas[n].getSVGGElement();
    const r = cabeza.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, [pentagrama, n]);

  await pagina.goto(`http://localhost:${puerto}/`);
  await cargada();

  comprobar(!(await pagina.isVisible('#paleta-dedos')), 'sin «Digitar», no hay paleta');
  await pagina.click('#digitar');
  comprobar(await pagina.isVisible('#paleta-dedos'), '«Digitar» enseña la paleta de dedos');
  comprobar((await elegida()) === 'Toca una nota de la partitura', 'pide tocar una nota');

  // Compás 1, mano derecha: Re4 Mi4 Fa4 Sol4 (la partitura de prueba es una escala)
  const p0 = await posicionNota(0, 0);
  await pagina.mouse.click(p0.x, p0.y);
  comprobar((await elegida()).startsWith('Re4 · compás 1 · mano derecha'), `tocar la nota la elige (${await elegida()})`);
  for (const dedo of ['1', '2', '3']) await pagina.click(`.dedo[data-dedo="${dedo}"]`);
  comprobar((await elegida()).startsWith('Sol4 · compás 1'), 'tras cada dedo salta a la siguiente nota de la mano');
  await pagina.keyboard.press('4');
  comprobar((await elegida()).startsWith('Mi4 · compás 2'), 'con el teclado también (y pasa al compás siguiente)');

  // Mano izquierda: redonda del compás 1
  const p1 = await posicionNota(1, 0);
  await pagina.mouse.click(p1.x, p1.y);
  comprobar((await elegida()).includes('mano izquierda'), 'elige notas de la mano izquierda');
  await pagina.click('.dedo[data-dedo="5"]');

  // Se ve en la partitura (OSMD pinta el texto de la digitación) y se guarda en Drive
  // (Los números 2, 3 y 4 también son números de compás; el 1 y el 5 solo pueden ser dedos en los compases 1-4)
  const dibujados = await pagina.waitForFunction(() => {
    const t = [...document.querySelectorAll('#partitura svg text')].map((x) => x.textContent.trim());
    return t.includes('1') && t.includes('5');
  }, null, { timeout: 5000 }).then(() => true, () => false);
  comprobar(dibujados, 'los dedos se dibujan sobre las notas');
  await pagina.waitForFunction(() => /guardada en Drive/.test(document.querySelector('#partitura-estado').textContent), null, { timeout: 8000 });
  const guardado = dedosEn(estado.guardados.at(-1));
  comprobar(JSON.stringify(guardado) === JSON.stringify(['1:D4=1', '1:E4=2', '1:F4=3', '1:G4=4', '1:D3=5']),
    `se guarda en Drive en las notas correctas (${guardado.join(' ')})`);
  comprobar((await pagina.textContent('#guardado')).startsWith('✓ Guardado en Drive'), 'junto a «Digitar» se ve «✓ Guardado en Drive»');
  if (capturas) await pagina.screenshot({ path: join(capturas, 'digitacion.png') });

  // Corregir y borrar: tocar Mi4 (dedo 2) → 3, y Fa4 (dedo 3) → ✕
  const pMi = await posicionNota(0, 1);
  await pagina.mouse.click(pMi.x, pMi.y);
  comprobar(await pagina.$eval('.dedo[data-dedo="2"]', (b) => b.classList.contains('actual')), 'la paleta marca el dedo que ya tiene');
  await pagina.click('.dedo[data-dedo="3"]');
  const pFa = await posicionNota(0, 2);
  await pagina.mouse.click(pFa.x, pFa.y);
  await pagina.click('.dedo.borrar');
  await pagina.click('#digitar'); // salir guarda en el acto
  await pagina.waitForFunction(() => /guardada en Drive/.test(document.querySelector('#partitura-estado').textContent), null, { timeout: 8000 });
  comprobar(JSON.stringify(dedosEn(drive.prueba)) === JSON.stringify(['1:D4=1', '1:E4=3', '1:G4=4', '1:D3=5']), 'corregir y quitar dedos');
  comprobar(!(await pagina.isVisible('#paleta-dedos')), 'salir de «Digitar» esconde la paleta');

  // Sin conexión: se queda en la tablet y se sube al volver
  estado.caido = true;
  await pagina.click('#digitar');
  const pRe = await posicionNota(0, 0);
  await pagina.mouse.click(pRe.x, pRe.y);
  await pagina.click('.dedo[data-dedo="2"]');
  await pagina.click('#digitar');
  await pagina.waitForFunction(() => /Guardada en la tablet/.test(document.querySelector('#partitura-estado').textContent), null, { timeout: 8000 });
  comprobar((await pagina.textContent('#guardado')).startsWith('⚠ Guardado en la tablet'), 'sin conexión: avisa de que queda guardada en la tablet');
  await pagina.reload();
  await cargada();
  const dedosTablet = await pagina.evaluate(() => [...window.pianobot.digitacion.indice.notas].filter((n) => n.el.querySelector('fingering')).length);
  comprobar(dedosTablet === 4, 'al recargar sin conexión, la tablet conserva el cambio');
  estado.caido = false;
  const antes = estado.guardados.length;
  await pagina.reload();
  await pagina.waitForFunction(() => / compases$/.test(document.querySelector('#partitura-estado').textContent), null, { timeout: 15000 });
  comprobar(estado.guardados.length === antes + 1 && dedosEn(drive.prueba)[0] === '1:D4=2', 'con conexión, sube a Drive lo pendiente sin pisarlo con lo viejo');
  await contexto.close();
} finally {
  await navegador.close();
  servidor.close();
}
if (fallos.length) {
  for (const f of fallos) console.error(`✗ ${f}`);
  process.exit(1);
}
