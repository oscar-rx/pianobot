// Digitación: leer y escribir <fingering> en las notas del MusicXML (así también se ve en MuseScore).
// Las notas y su emparejamiento con las de OSMD salen de musicxml.js.

export { indexarNotas, claveOsmd, leerXml, escribirXml } from './musicxml.js';

const hijo = (el, nombre) => [...el.children].find((c) => c.tagName === nombre) ?? null;

/** El dedo escrito en una <note> (1-5), o null. */
export function dedoDe(el) {
  const f = el.querySelector('notations > technical > fingering');
  const n = f ? Number(f.textContent.trim()) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Orden de los hijos de <note> en MusicXML: <notations> va antes de estos.
const DESPUES_DE_NOTATIONS = ['lyric', 'play', 'listen'];

/** Escribe (dedo 1-5) o borra (null) la digitación de una <note>. */
export function ponerDedo(el, dedo) {
  const doc = el.ownerDocument;
  for (const f of el.querySelectorAll('notations > technical > fingering')) f.remove();
  if (dedo != null) {
    let notations = hijo(el, 'notations');
    if (!notations) {
      notations = doc.createElement('notations');
      const siguiente = [...el.children].find((c) => DESPUES_DE_NOTATIONS.includes(c.tagName));
      el.insertBefore(notations, siguiente ?? null);
    }
    let tecnica = hijo(notations, 'technical');
    if (!tecnica) tecnica = notations.appendChild(doc.createElement('technical'));
    tecnica.appendChild(doc.createElement('fingering')).textContent = String(dedo);
  }
  // Limpieza: no dejar <technical> ni <notations> vacíos
  for (const t of el.querySelectorAll('notations > technical')) if (!t.children.length) t.remove();
  for (const n of el.querySelectorAll(':scope > notations')) if (!n.children.length) n.remove();
}

/** La siguiente nota del mismo pentagrama (por compás y momento; en un acorde, de grave a agudo). */
export function siguienteNota(notas, actual, { hastaCompas = Infinity } = {}) {
  const mismas = notas
    .filter((n) => n.pentagrama === actual.pentagrama && n.compas <= hastaCompas)
    .sort((a, b) => a.compas - b.compas || a.momento - b.momento || a.midi - b.midi);
  const i = mismas.indexOf(actual);
  return i >= 0 ? mismas[i + 1] ?? null : null;
}
