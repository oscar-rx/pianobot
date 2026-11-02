// Lectura del MusicXML: las notas con su altura, mano, momento y duración. Lo usan la digitación
// (para escribir <fingering>) y la comparación con lo que se toca (fase 3).
//
// Cada nota tiene una clave única: compás (índice), pentagrama (contando todos los de la partitura),
// voz, momento dentro del compás (en redondas) y altura MIDI. La misma clave sale de una nota de OSMD
// (claveOsmd), así se emparejan las notas pintadas con las del fichero.

const PASOS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const redondear = (x) => Math.round(x * 1e6);
const clave = (compas, pentagrama, voz, momento, midi) => `${compas}|${pentagrama}|${voz}|${redondear(momento)}|${midi}`;
const hijo = (el, nombre) => [...el.children].find((c) => c.tagName === nombre) ?? null;
const texto = (el, nombre) => hijo(el, nombre)?.textContent.trim() ?? null;

/**
 * Recorre el MusicXML y devuelve sus notas con altura (sin silencios ni notas de adorno), en orden.
 * Tiempos en negras: `inicio` desde el principio de la pieza, `duracion` de la nota (si va ligada,
 * la primera de la cadena suma la de todas y las siguientes llevan `continuacion: true`).
 * @param {Document} doc
 */
export function indexarNotas(doc) {
  const notas = [];
  const compases = []; // {numero, inicio, duracion} en negras (de la primera parte)
  let basePentagrama = 0;
  [...doc.querySelectorAll('score-partwise > part')].forEach((parte, iParte) => {
    let pentagramas = 1;
    let divisiones = 1;
    let inicioCompas = 0; // en negras
    const ligaduras = new Map(); // pentagrama|voz|midi → primera nota de la cadena
    [...parte.children].filter((c) => c.tagName === 'measure').forEach((compas, iCompas) => {
      const numeroTexto = compas.getAttribute('number');
      const numero = /^\d+$/.test(numeroTexto ?? '') ? Number(numeroTexto) : iCompas + 1;
      let pos = 0; // en divisiones
      let maximo = 0;
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
          const duracionDiv = deAdorno ? 0 : Number(texto(el, 'duration') ?? 0);
          const inicio = enAcorde ? ultimo : pos;
          if (!enAcorde) {
            ultimo = pos;
            pos += duracionDiv;
          }
          maximo = Math.max(maximo, pos, inicio + duracionDiv);
          const altura = hijo(el, 'pitch');
          if (!altura || deAdorno) continue;
          const midi = (Number(texto(altura, 'octave')) + 1) * 12 + PASOS[texto(altura, 'step')] + Number(texto(altura, 'alter') ?? 0);
          const pentagrama = basePentagrama + Number(texto(el, 'staff') ?? 1) - 1;
          const voz = texto(el, 'voice') ?? '1';
          const nota = {
            el,
            clave: clave(iCompas, pentagrama, voz, inicio / (divisiones * 4), midi),
            compas: iCompas,
            compasNumero: numero,
            pentagrama,
            voz,
            momento: inicio / (divisiones * 4), // en redondas, dentro del compás (como OSMD)
            midi,
            inicio: inicioCompas + inicio / divisiones, // en negras, desde el principio
            duracion: duracionDiv / divisiones, // en negras
            continuacion: false,
          };
          // Ligaduras: la nota que termina una ligadura no se vuelve a tocar; alarga la primera.
          const tipos = [...el.children].filter((c) => c.tagName === 'tie').map((t) => t.getAttribute('type'));
          const cadena = `${pentagrama}|${voz}|${midi}`;
          const cabeza = ligaduras.get(cadena);
          if (tipos.includes('stop') && cabeza) {
            nota.continuacion = true;
            cabeza.duracion += nota.duracion;
            if (!tipos.includes('start')) ligaduras.delete(cadena);
          } else if (tipos.includes('start')) {
            ligaduras.set(cadena, nota);
          }
          notas.push(nota);
        }
      }
      const duracion = maximo / divisiones;
      if (iParte === 0) compases.push({ numero, indice: iCompas, inicio: inicioCompas, duracion });
      inicioCompas += duracion;
    });
    basePentagrama += pentagramas;
  });
  return { notas, compases, porClave: new Map(notas.map((n) => [n.clave, n])) };
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

const CATALOGO = /\b(BWV|Op\.?|KV|K\.|Hob\.?|WoO|D\.)\s*\d/i;

/**
 * Quita de la partitura los títulos escritos como texto DENTRO de los compases (pasa con los ficheros
 * convertidos de Capella, p. ej. de Tobi's Notenarchiv), que se pintarían encima de las notas:
 *  - título: letra grande (≥ 14) en los dos primeros compases;
 *  - autor: alineado a la derecha, en varias líneas o con número de catálogo (BWV, Op., KV…), en los dos primeros;
 *  - movimiento: en negrita y numerado («2. Fughetta»), en cualquier compás.
 * Las indicaciones musicales («dolce», «a tempo», dinámicas, tempo) no se tocan. Si la partitura no traía título
 * ni autor en sus datos, se ponen los encontrados. Modifica `doc` y devuelve lo que ha hecho.
 */
export function limpiarPartitura(doc) {
  const quitados = [];
  let titulo = null;
  let compositor = null;
  for (const parte of doc.querySelectorAll('score-partwise > part')) {
    [...parte.children].filter((c) => c.tagName === 'measure').forEach((compas, i) => {
      for (const direccion of [...compas.children].filter((c) => c.tagName === 'direction')) {
        for (const tipo of [...direccion.children].filter((c) => c.tagName === 'direction-type')) {
          const palabras = [...tipo.children];
          if (palabras.length !== 1 || palabras[0].tagName !== 'words') continue;
          const w = palabras[0];
          const texto = w.textContent.trim();
          const tam = parseFloat(w.getAttribute('font-size')) || 0;
          const negrita = w.getAttribute('font-weight') === 'bold';
          let clase = null;
          if (i < 2 && tam >= 14) clase = 'titulo';
          else if (i < 2 && w.getAttribute('justify') === 'right' && (texto.includes('\n') || CATALOGO.test(texto))) clase = 'autor';
          else if (negrita && /^\d+\.\s+\S/.test(texto)) clase = 'movimiento';
          if (!clase) continue;
          if (clase === 'titulo') titulo ??= texto.replace(/\.$/, '');
          if (clase === 'autor') compositor ??= texto.split('\n')[0].trim();
          tipo.remove();
          quitados.push(texto);
        }
        const queda = [...direccion.children].some((c) => c.tagName === 'direction-type' || c.tagName === 'sound');
        if (!queda) direccion.remove();
      }
    });
  }
  // Título y autor a los datos de la partitura, si no los tenía
  const raiz = doc.documentElement;
  const hijo = (el, nombre) => [...el.children].find((c) => c.tagName === nombre) ?? null;
  if (titulo && !hijo(raiz, 'work')?.querySelector('work-title') && !hijo(raiz, 'movement-title')) {
    const obra = doc.createElement('work');
    obra.appendChild(doc.createElement('work-title')).textContent = titulo;
    raiz.insertBefore(obra, raiz.firstElementChild);
  }
  if (compositor && !raiz.querySelector('identification > creator[type="composer"]')) {
    let ident = hijo(raiz, 'identification');
    if (!ident) {
      ident = doc.createElement('identification');
      const despues = [...raiz.children].find((c) => !['work', 'movement-number', 'movement-title'].includes(c.tagName));
      raiz.insertBefore(ident, despues ?? null);
    }
    const creador = doc.createElement('creator');
    creador.setAttribute('type', 'composer');
    creador.textContent = compositor;
    ident.insertBefore(creador, ident.firstElementChild);
  }
  return { quitados, titulo, compositor };
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
