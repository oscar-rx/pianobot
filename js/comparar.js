// Fase 3 · Comparar lo tocado con la partitura y sacar las métricas de un intento, por compás y por mano.
// La app solo mide; qué es un problema lo decide el profe (Claude), así que aquí no hay umbrales de «bien/mal»,
// salvo los imprescindibles para definir un titubeo.

const ACORDE_S = 0.035; // notas tocadas a menos de 35 ms se consideran a la vez (un acorde)
const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const mediana = (xs) => {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};
const nombreMano = (pentagrama) => (pentagrama === 0 ? 'derecha' : pentagrama === 1 ? 'izquierda' : `pentagrama ${pentagrama + 1}`);

export const MANOS = { ambas: null, derecha: [0], izquierda: [1] };

/**
 * Las notas que hay que tocar en un fragmento (sin las continuaciones de ligadura), ordenadas.
 * `pos` y `dur` en negras desde el principio del fragmento.
 * @param {{notas: Array, compases: Array}} indice  de indexarNotas (musicxml.js)
 */
export function esperadasDelFragmento(indice, { desde, hasta, mano = 'ambas' }) {
  const inicio = (indice.compases.find((c) => c.numero === desde) ?? indice.compases[0]).inicio;
  const pentagramas = MANOS[mano] ?? null;
  return indice.notas
    .filter((n) => !n.continuacion && n.compasNumero >= desde && n.compasNumero <= hasta)
    .filter((n) => !pentagramas || pentagramas.includes(n.pentagrama))
    .map((n) => ({
      clave: n.clave,
      midi: n.midi,
      pos: n.inicio - inicio,
      dur: n.duracion,
      compas: n.compasNumero,
      pentagrama: n.pentagrama,
      mano: nombreMano(n.pentagrama),
    }))
    .sort((a, b) => a.pos - b.pos || a.midi - b.midi);
}

/** Los compases del fragmento, con su inicio y duración en negras desde el principio del fragmento. */
export function compasesDelFragmento(indice, { desde, hasta }) {
  const inicio = (indice.compases.find((c) => c.numero === desde) ?? indice.compases[0]).inicio;
  return indice.compases
    .filter((c) => c.numero >= desde && c.numero <= hasta)
    .map((c) => ({ numero: c.numero, inicio: c.inicio - inicio, duracion: c.duracion }));
}

/** Ordena lo tocado: por momento, y dentro de un acorde de grave a agudo (como las esperadas). */
function ordenarTocadas(tocadas) {
  const porTiempo = [...tocadas].sort((a, b) => a.t - b.t);
  let grupo = 0;
  let inicioGrupo = -Infinity;
  const conGrupo = porTiempo.map((nota) => {
    if (nota.t - inicioGrupo > ACORDE_S) {
      grupo++;
      inicioGrupo = nota.t;
    }
    return { nota, grupo };
  });
  return conGrupo.sort((a, b) => a.grupo - b.grupo || a.nota.midi - b.nota.midi).map((x) => x.nota);
}

/**
 * Alineación tolerante a errores entre lo esperado y lo tocado (como un diff): cada nota esperada queda
 * bien (misma altura), fallada (se tocó otra en su sitio), omitida o, con `finLibre`, pendiente (aún no se ha
 * llegado). Lo tocado que no corresponde a nada queda como sobrante.
 * @param {Array<{midi:number}>} esperadas  ordenadas (esperadasDelFragmento)
 * @param {Array<{midi:number, t:number}>} tocadas
 * @param {{finLibre?: boolean}} o  finLibre: el intento puede no haber llegado al final (seguimiento en directo)
 */
export function alinear(esperadas, tocadas, { finLibre = false } = {}) {
  const E = esperadas;
  const T = ordenarTocadas(tocadas);
  const n = E.length;
  const m = T.length;
  const ancho = m + 1;
  const C = new Float64Array((n + 1) * ancho);
  for (let i = 0; i <= n; i++) C[i * ancho] = i;
  for (let j = 0; j <= m; j++) C[j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = C[(i - 1) * ancho + j - 1] + (E[i - 1].midi === T[j - 1].midi ? 0 : 1);
      const arriba = C[(i - 1) * ancho + j] + 1;
      const izquierda = C[i * ancho + j - 1] + 1;
      C[i * ancho + j] = Math.min(diag, arriba, izquierda);
    }
  }
  // Hasta dónde se ha llegado: todo (normal) o lo que mejor encaje con lo tocado (en directo)
  let iFin = n;
  if (finLibre) {
    for (let i = n; i >= 0; i--) if (C[i * ancho + m] < C[iFin * ancho + m]) iFin = i;
  }

  const pares = [];
  const omitidas = [];
  const sobrantes = [];
  let i = iFin;
  let j = m;
  while (i > 0 || j > 0) {
    const aqui = C[i * ancho + j];
    if (i > 0 && j > 0) {
      const igual = E[i - 1].midi === T[j - 1].midi;
      if (aqui === C[(i - 1) * ancho + j - 1] + (igual ? 0 : 1)) {
        pares.push({ e: E[i - 1], t: T[j - 1], bien: igual, iE: i - 1 });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && aqui === C[(i - 1) * ancho + j] + 1) {
      omitidas.push({ e: E[i - 1], iE: i - 1 });
      i--;
    } else {
      sobrantes.push({ t: T[j - 1], iE: i });
      j--;
    }
  }
  pares.reverse();
  omitidas.reverse();
  sobrantes.reverse();

  // Arreglos: dos notas cruzadas (Mi-Do en vez de Do-Mi) no son dos fallos
  for (let k = 1; k < pares.length; k++) {
    const a = pares[k - 1];
    const b = pares[k];
    if (!a.bien && !b.bien && a.e.midi === b.t.midi && b.e.midi === a.t.midi) {
      [a.t, b.t] = [b.t, a.t];
      a.bien = b.bien = true;
    }
  }
  // …ni una nota que se adelanta o se retrasa un poco respecto a su sitio (omitida + sobrante cercanas)
  for (let k = omitidas.length - 1; k >= 0; k--) {
    const o = omitidas[k];
    const s = sobrantes.findIndex((x) => x.t.midi === o.e.midi && Math.abs(x.iE - o.iE) <= 3);
    if (s >= 0) {
      pares.push({ e: o.e, t: sobrantes[s].t, bien: true, iE: o.iE });
      sobrantes.splice(s, 1);
      omitidas.splice(k, 1);
    }
  }
  pares.sort((a, b) => a.iE - b.iE);

  const pendientes = E.slice(iFin);
  return { pares, omitidas, sobrantes, pendientes };
}

/**
 * Pulso de un intento: segundos por negra, a partir de los intervalos entre notas seguidas de la misma mano
 * (la mediana), para que ni una pausa ni el pequeño desfase entre manos lo arrastren. null si hay muy pocas notas.
 */
function pulsoDe(puntos) {
  const ratios = [];
  const porMano = new Map();
  for (const p of puntos) porMano.set(p.mano, [...(porMano.get(p.mano) ?? []), p]);
  for (const lista of porMano.values()) {
    const orden = lista.sort((a, b) => a.pos - b.pos || a.t - b.t);
    for (let k = 1; k < orden.length; k++) {
      const dPos = orden[k].pos - orden[k - 1].pos;
      const dT = orden[k].t - orden[k - 1].t;
      if (dPos >= 0.125 && dT > 0) ratios.push(dT / dPos);
    }
  }
  return ratios.length >= 2 ? mediana(ratios) : null;
}

const esPausa = (antes, ahora, pulso) => ahora.pos > antes.pos && ahora.t - antes.t - (ahora.pos - antes.pos) * pulso > Math.max(0.5 * pulso, 0.3);

/**
 * Dónde «debería» caer cada posición de la partitura según cómo estás tocando: tu pulso, con el punto de
 * partida tomado de las notas cercanas (±1 negra) y separado en tramos por las pausas largas.
 * @returns {(pos: number) => number}
 */
function mapaDeTiempo(puntos, pulso) {
  const orden = [...puntos].sort((a, b) => a.pos - b.pos || a.t - b.t);
  const tramos = [[]];
  orden.forEach((p, k) => {
    if (k > 0 && esPausa(orden[k - 1], p, pulso)) tramos.push([]);
    tramos.at(-1).push(p);
  });
  const tramoDe = (pos) => tramos.findLast((tr) => tr.length && tr[0].pos <= pos) ?? tramos[0];
  return (pos) => {
    const tramo = tramoDe(pos);
    const cerca = tramo.filter((p) => Math.abs(p.pos - pos) <= 1);
    return mediana((cerca.length ? cerca : tramo).map((p) => p.t - p.pos * pulso)) + pos * pulso;
  };
}

/**
 * Emparejamiento por altura y tiempo: cada nota esperada se queda con la tecla de su misma altura más cercana
 * a su momento previsto. Lo que sobra cerca de una nota sin pareja es una nota fallada (se tocó otra en su
 * sitio); lo demás, omitidas y sobrantes. Mismo formato que alinear().
 */
function emparejarPorTiempo(E, T, prevista, pulso) {
  const momento = E.map((e) => prevista(e.pos));
  // Margen de tiempo de cada nota: proporcional a lo juntas que van las notas de su mano (en semicorcheas,
  // más estrecho que en negras), para no confundirla con la de al lado. Entre 80 ms y 0,4 negras.
  const posPorMano = new Map();
  for (const e of E) posPorMano.set(e.mano, [...(posPorMano.get(e.mano) ?? []), e.pos]);
  const margen = E.map((e) => {
    const otras = posPorMano.get(e.mano).filter((p) => p !== e.pos);
    const espaciado = otras.length ? Math.min(...otras.map((p) => Math.abs(p - e.pos))) : 1;
    return Math.max(0.08, Math.min(0.4, 0.6 * espaciado) * pulso);
  });
  const candidatos = [];
  E.forEach((e, i) => {
    T.forEach((t, j) => {
      const d = Math.abs(t.t - momento[i]);
      if (t.midi === e.midi && d <= margen[i]) candidatos.push({ i, j, d });
    });
  });
  candidatos.sort((a, b) => a.d - b.d);
  const parejaE = new Array(E.length).fill(-1);
  const usadaT = new Array(T.length).fill(false);
  const pares = [];
  for (const c of candidatos) {
    if (parejaE[c.i] >= 0 || usadaT[c.j]) continue;
    parejaE[c.i] = c.j;
    usadaT[c.j] = true;
    pares.push({ e: E[c.i], t: T[c.j], bien: true, iE: c.i });
  }
  // Notas tocadas en el sitio de otra (otra altura): falladas
  E.forEach((e, i) => {
    if (parejaE[i] >= 0) return;
    let mejor = -1;
    let coste = Infinity;
    T.forEach((t, j) => {
      if (usadaT[j]) return;
      const d = Math.abs(t.t - momento[i]);
      const c = d + 0.005 * Math.abs(t.midi - e.midi);
      if (d <= margen[i] && c < coste) {
        mejor = j;
        coste = c;
      }
    });
    if (mejor >= 0) {
      parejaE[i] = mejor;
      usadaT[mejor] = true;
      pares.push({ e, t: T[mejor], bien: false, iE: i });
    }
  });
  pares.sort((a, b) => a.iE - b.iE);
  const omitidas = E.map((e, iE) => ({ e, iE })).filter((o) => parejaE[o.iE] < 0);
  const sobrantes = T.filter((_, j) => !usadaT[j]).map((t) => {
    let iE = 0;
    momento.forEach((m, i) => {
      if (Math.abs(m - t.t) < Math.abs(momento[iE] - t.t)) iE = i;
    });
    return { t, iE: Math.min(iE + 1, E.length) };
  });
  return { pares, omitidas, sobrantes, pendientes: [] };
}

/**
 * Analiza un intento.
 * @param {object} o
 * @param {Array} o.esperadas  esperadasDelFragmento
 * @param {Array} o.compases   compasesDelFragmento
 * @param {Array<{midi, t, fin, velocidad}>} o.tocadas  t y fin en segundos (reloj de audio, tal como suena)
 * @param {{inicial: boolean, eventos: Array<{pisado: boolean, t: number}>}} [o.pedal]
 * @param {{ppm: number, origen: number}} [o.metronomo]  si sonaba: tempo y el momento de uno de sus pulsos
 */
export function analizar({ esperadas, compases, tocadas, pedal = { inicial: false, eventos: [] }, metronomo = null }) {
  // 1) Alineación por orden: una primera idea de cómo estás tocando (tu pulso y por dónde vas en cada momento).
  // 2) Emparejamiento por altura y tiempo: con eso, cada nota esperada busca su tecla cerca de su momento previsto.
  //    Así dos voces que se cruzan, o una mano un poco por delante de la otra, no descuadran la comparación.
  const previa = alinear(esperadas, tocadas);
  const aPunto = (p) => ({ pos: p.e.pos, t: p.t.t, mano: p.e.mano, par: p });
  const pulsoPrevio = pulsoDe(previa.pares.filter((p) => p.bien).map(aPunto));
  const al = pulsoPrevio
    ? emparejarPorTiempo(esperadas, tocadas, mapaDeTiempo(previa.pares.filter((p) => p.bien).map(aPunto), pulsoPrevio), pulsoPrevio)
    : previa;
  const puntos = al.pares.map(aPunto);
  const orden = [...puntos].sort((a, b) => a.pos - b.pos || a.t - b.t);
  const pulso = pulsoDe(puntos) ?? pulsoPrevio; // segundos por negra, tal como tocas

  // Titubeos: una pausa entre dos notas consecutivas mucho más larga de lo que pide la partitura
  const titubeos = [];
  if (pulso) {
    for (let k = 1; k < orden.length; k++) {
      if (esPausa(orden[k - 1], orden[k], pulso)) titubeos.push({ e: orden[k].par.e });
    }
  }
  // Dónde «debería» caer cada nota según tu pulso (por tramos entre pausas y mirando las notas cercanas)
  const aTiempo = pulso && puntos.length ? mapaDeTiempo(puntos.filter((p) => p.par.bien), pulso) : null;

  // Desajuste rítmico: respecto al metrónomo si sonaba; si no, respecto a tu propio pulso
  let desajuste = () => null;
  let referencia = null;
  if (metronomo && puntos.length) {
    const q = 60 / metronomo.ppm;
    const r = puntos.map((p) => p.t - p.pos * q);
    const t0 = metronomo.origen + Math.round((mediana(r) - metronomo.origen) / q) * q;
    desajuste = (p) => p.t - (t0 + p.pos * q);
    referencia = 'metrónomo';
  } else if (aTiempo) {
    desajuste = (p) => p.t - aTiempo(p.pos);
    referencia = 'tu pulso';
  }

  // Estado de cada nota esperada
  const notas = new Map();
  for (const p of al.pares) {
    const d = desajuste({ pos: p.e.pos, t: p.t.t });
    // La articulación se mide contra tu propio pulso (no el del metrónomo): cuánto mantienes la tecla
    const escrito = pulso ? p.e.dur * pulso : null;
    notas.set(p.e.clave, {
      e: p.e,
      estado: p.bien ? 'bien' : 'fallada',
      tocada: p.t.midi,
      desajusteMs: d == null ? null : Math.round(d * 1000),
      articulacion: p.bien && p.t.fin != null && escrito ? (p.t.fin - p.t.t) / escrito : null,
    });
  }
  for (const o of al.omitidas) notas.set(o.e.clave, { e: o.e, estado: 'omitida' });

  // Las notas de más se apuntan en el compás y la mano de la esperada más cercana en altura
  const sobrantes = al.sobrantes.map((s) => {
    const vecinas = [esperadas[s.iE - 1], esperadas[s.iE]].filter(Boolean);
    const cerca = vecinas.sort((a, b) => Math.abs(a.midi - s.t.midi) - Math.abs(b.midi - s.t.midi))[0];
    return { midi: s.t.midi, t: s.t.t, compas: cerca?.compas ?? null, mano: cerca?.mano ?? null };
  });

  // Por compás y mano
  const filas = [];
  const manos = [...new Set([...esperadas].sort((a, b) => a.pentagrama - b.pentagrama).map((e) => e.mano))];
  for (const c of compases) {
    for (const mano of manos) {
      const es = [...notas.values()].filter((x) => x.e.compas === c.numero && x.e.mano === mano);
      const total = esperadas.filter((e) => e.compas === c.numero && e.mano === mano).length;
      if (!total) continue;
      const desaj = es.map((x) => x.desajusteMs).filter((x) => x != null);
      const artic = es.map((x) => x.articulacion).filter((x) => x != null);
      filas.push({
        compas: c.numero,
        mano,
        notas: total,
        bien: es.filter((x) => x.estado === 'bien').length,
        falladas: es.filter((x) => x.estado === 'fallada').length + sobrantes.filter((s) => s.compas === c.numero && s.mano === mano).length,
        omitidas: es.filter((x) => x.estado === 'omitida').length,
        titubeos: titubeos.filter((t) => t.e.compas === c.numero && t.e.mano === mano).length,
        desajusteMs: desaj.length ? Math.round(media(desaj)) : null,
        desajusteAbsMs: desaj.length ? Math.round(media(desaj.map(Math.abs))) : null,
        articulacion: artic.length ? Math.round(mediana(artic) * 100) : null,
      });
    }
  }

  // Pedal, aparte e independiente de las notas: por compás, cuánto rato está pisado y cuántas veces se pisa
  const pedalPorCompas = [];
  if (aTiempo) {
    const tramos = [];
    let pisadoDesde = pedal.inicial ? -Infinity : null;
    for (const ev of [...pedal.eventos].sort((a, b) => a.t - b.t)) {
      if (ev.pisado && pisadoDesde == null) pisadoDesde = ev.t;
      if (!ev.pisado && pisadoDesde != null) {
        tramos.push([pisadoDesde, ev.t]);
        pisadoDesde = null;
      }
    }
    if (pisadoDesde != null) tramos.push([pisadoDesde, Infinity]);
    for (const c of compases) {
      const ini = aTiempo(c.inicio);
      const fin = aTiempo(c.inicio + c.duracion);
      const pisado = tramos.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, fin) - Math.max(a, ini)), 0);
      const pisadas = pedal.eventos.filter((ev) => ev.pisado && ev.t >= ini && ev.t < fin).length;
      pedalPorCompas.push({ compas: c.numero, pisadoPct: Math.round((pisado / (fin - ini)) * 100), pisadas });
    }
  }

  const desajTodas = [...notas.values()].map((x) => x.desajusteMs).filter((x) => x != null);
  return {
    total: {
      notas: esperadas.length,
      bien: [...notas.values()].filter((x) => x.estado === 'bien').length,
      falladas: [...notas.values()].filter((x) => x.estado === 'fallada').length + sobrantes.length,
      omitidas: al.omitidas.length,
      sobrantes: sobrantes.length,
      titubeos: titubeos.length,
      tempo: pulso ? Math.round(60 / pulso) : null,
      referencia,
      desajusteMs: desajTodas.length ? Math.round(media(desajTodas)) : null,
      desajusteAbsMs: desajTodas.length ? Math.round(media(desajTodas.map(Math.abs))) : null,
    },
    filas,
    pedal: pedalPorCompas,
    notas, // clave → {estado, desajusteMs, articulacion}
    sobrantes,
  };
}
