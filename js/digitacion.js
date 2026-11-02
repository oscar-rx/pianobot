// Digitación: une cada nota que pinta OSMD con su <note> del MusicXML, para leer y escribir
// <fingering> en el propio fichero (así también se ve en MuseScore).
//
// Una nota se identifica por: compás (índice), pentagrama (contando todos los de la partitura),
// voz, momento dentro del compás (en redondas) y altura MIDI. Así no hay ambigüedad ni en acordes.

const PASOS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const redondear = (x) => Math.round(x * 1e6);
const clave = (compas, pentagrama, voz, momento, midi) => `${compas}|${pentagrama}|${voz}|${redondear(momento)}|${midi}`;
const hijo = (el, nombre) => [...el.children].find((c) => c.tagName === nombre) ?? null;
const texto = (el, nombre) => hijo(el, nombre)?.textContent.trim() ?? null;

/**
 * Recorre el MusicXML y devuelve sus notas con altura, en orden.
 * @param {Document} doc
 * @returns {{notas: Array<{el: Element, clave: string, compas: number, pentagrama: number, voz: string, momento: number, midi: number}>, porClave: Map<string, object>}}
 */
export function indexarNotas(doc) {
  const notas = [];
  let basePentagrama = 0;
  for (const parte of doc.querySelectorAll('score-partwise > part')) {
    let pentagramas = 1;
    let divisiones = 1;
    [...parte.children].filter((c) => c.tagName === 'measure').forEach((compas, iCompas) => {
      let pos = 0;
      let ultimo = 0;
      for (const el of compas.children) {
        if (el.tagName === 'attributes') {
          divisiones = Number(texto(el, 'divisions') ?? divisiones);
          pentagramas = Number(texto(el, 'staves') ?? pentagramas);
        } else if (el.tagName === 'backup') {
          pos -= Number(texto(el, 'duration') ?? 0);
        } else if (el.tagName === 'forward') {
          pos += Number(texto(el, 'duration') ?? 0);
        } else if (el.tagName === 'note') {
          const enAcorde = !!hijo(el, 'chord');
          const deAdorno = !!hijo(el, 'grace');
          const inicio = enAcorde ? ultimo : pos;
          if (!enAcorde) {
            ultimo = pos;
            if (!deAdorno) pos += Number(texto(el, 'duration') ?? 0);
          }
          const altura = hijo(el, 'pitch');
          if (!altura || deAdorno) continue;
          const midi = (Number(texto(altura, 'octave')) + 1) * 12 + PASOS[texto(altura, 'step')] + Number(texto(altura, 'alter') ?? 0);
          const pentagrama = basePentagrama + Number(texto(el, 'staff') ?? 1) - 1;
          const voz = texto(el, 'voice') ?? '1';
          const momento = inicio / (divisiones * 4);
          notas.push({ el, clave: clave(iCompas, pentagrama, voz, momento, midi), compas: iCompas, pentagrama, voz, momento, midi });
        }
      }
    });
    basePentagrama += pentagramas;
  }
  return { notas, porClave: new Map(notas.map((n) => [n.clave, n])) };
}

/** La clave de una nota de OSMD (sourceNote de un GraphicalNote), o null si es un silencio o de adorno. */
export function claveOsmd(nota) {
  if (!nota || nota.isRest() || nota.IsGraceNote) return null;
  return clave(
    nota.SourceMeasure.measureListIndex,
    nota.ParentStaff.idInMusicSheet,
    String(nota.voiceEntry.ParentVoice.VoiceId),
    nota.ParentStaffEntry.Timestamp.RealValue,
    nota.halfTone + 12,
  );
}

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

export function leerXml(texto) {
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('La partitura no es un MusicXML válido.');
  return doc;
}

export function escribirXml(doc) {
  const xml = new XMLSerializer().serializeToString(doc);
  return xml.startsWith('<?xml') ? xml : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}
