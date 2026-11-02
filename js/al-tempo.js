// Modo «Al tempo»: el metrónomo marca el paso y cada nota de la partitura tiene su momento.
// Tras un compás de cuenta, la línea avanza sola; cada nota se juzga en su momento:
//   bien     si tocas esa tecla a tiempo (dentro de su margen),
//   fallada  si en ese momento tocas otra tecla,
//   omitida  si pasa su momento sin que toques nada.
// Las teclas que no caen cerca de ninguna nota son sobrantes.

const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const mediana = (xs) => {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

export class PracticaAlTempo {
  /**
   * @param {object} o
   * @param {Array} o.esperadas   esperadasDelFragmento (pos y dur en negras desde el principio del fragmento)
   * @param {number} o.t0         momento (reloj de audio, tal como suena) del primer tiempo del fragmento
   * @param {number} o.negra      segundos por negra (60 / ppm)
   * @param {number} o.duracion   duración del fragmento en negras
   */
  constructor({ esperadas, t0, negra, duracion }) {
    this.t0 = t0;
    this.negra = negra;
    this.tFin = t0 + duracion * negra;
    // Margen de cada nota: proporcional a lo juntas que van las de su mano (entre 80 y 250 ms)
    const posPorMano = new Map();
    for (const e of esperadas) posPorMano.set(e.mano, [...(posPorMano.get(e.mano) ?? []), e.pos]);
    this.notas = esperadas.map((e) => {
      const otras = posPorMano.get(e.mano).filter((p) => p !== e.pos);
      const espaciado = otras.length ? Math.min(...otras.map((p) => Math.abs(p - e.pos))) : 1;
      return { e, t: t0 + e.pos * negra, margen: Math.min(0.25, Math.max(0.08, 0.45 * espaciado * negra)), estado: null, tocada: null };
    });
    this.sobrantes = [];
    this.abiertas = new Map();
  }

  /** Una nota del piano. Devuelve los cambios de estado: [{clave, estado}]. */
  nota({ tipo, midi, tiempo }) {
    if (tipo === 'noteoff') {
      const tocada = this.abiertas.get(midi);
      if (tocada) tocada.fin = tiempo;
      this.abiertas.delete(midi);
      return [];
    }
    const tocada = { midi, t: tiempo, fin: null };
    this.abiertas.set(midi, tocada);
    const cerca = this.notas.filter((n) => !n.estado && Math.abs(tiempo - n.t) <= n.margen);
    const distancia = (n) => Math.abs(tiempo - n.t);
    const misma = cerca.filter((n) => n.e.midi === midi).sort((a, b) => distancia(a) - distancia(b))[0];
    const elegida = misma ?? cerca.sort((a, b) => distancia(a) - distancia(b) || Math.abs(a.e.midi - midi) - Math.abs(b.e.midi - midi))[0];
    if (!elegida) {
      this.sobrantes.push(tocada);
      return [];
    }
    elegida.estado = misma ? 'bien' : 'fallada';
    elegida.tocada = tocada;
    return [{ clave: elegida.e.clave, estado: elegida.estado }];
  }

  /** Avanza el reloj: las notas cuyo momento ya ha pasado sin tocarlas quedan omitidas. */
  avanzar(ahora) {
    const cambios = [];
    for (const n of this.notas) {
      if (!n.estado && ahora > n.t + n.margen) {
        n.estado = 'omitida';
        cambios.push({ clave: n.e.clave, estado: 'omitida' });
      }
    }
    return cambios;
  }

  /** Posición (en negras desde el principio del fragmento) en un momento dado; negativa durante la cuenta. */
  posicion(ahora) {
    return (ahora - this.t0) / this.negra;
  }

  terminado(ahora) {
    return ahora > this.tFin + Math.max(0.3, 0.5 * this.negra);
  }

  /** Resumen con el mismo formato que analizar() (comparar.js), para la tarjeta «Último intento». */
  resumen(compases) {
    const desajuste = (n) => (n.tocada ? Math.round((n.tocada.t - n.t) * 1000) : null);
    const articulacion = (n) => (n.estado === 'bien' && n.tocada.fin != null ? (n.tocada.fin - n.tocada.t) / (n.e.dur * this.negra) : null);
    const notas = new Map(this.notas.map((n) => [n.e.clave, { e: n.e, estado: n.estado ?? 'omitida', desajusteMs: desajuste(n), articulacion: articulacion(n) }]));
    // Sobrantes: en el compás y la mano de la nota esperada más cercana en el tiempo
    const sobrantes = this.sobrantes.map((t) => {
      const cerca = [...this.notas].sort((a, b) => Math.abs(a.t - t.t) - Math.abs(b.t - t.t))[0];
      return { midi: t.midi, t: t.t, compas: cerca?.e.compas ?? null, mano: cerca?.e.mano ?? null };
    });
    const manos = [...new Set([...this.notas].sort((a, b) => a.e.pentagrama - b.e.pentagrama).map((n) => n.e.mano))];
    const filas = [];
    for (const c of compases) {
      for (const mano of manos) {
        const es = [...notas.values()].filter((x) => x.e.compas === c.numero && x.e.mano === mano);
        if (!es.length) continue;
        const desaj = es.filter((x) => x.estado === 'bien').map((x) => x.desajusteMs);
        const artic = es.map((x) => x.articulacion).filter((x) => x != null);
        filas.push({
          compas: c.numero,
          mano,
          notas: es.length,
          bien: es.filter((x) => x.estado === 'bien').length,
          falladas: es.filter((x) => x.estado === 'fallada').length + sobrantes.filter((s) => s.compas === c.numero && s.mano === mano).length,
          omitidas: es.filter((x) => x.estado === 'omitida').length,
          titubeos: 0,
          desajusteMs: desaj.length ? Math.round(media(desaj)) : null,
          desajusteAbsMs: desaj.length ? Math.round(media(desaj.map(Math.abs))) : null,
          articulacion: artic.length ? Math.round(mediana(artic) * 100) : null,
        });
      }
    }
    const todas = [...notas.values()];
    const desajTodas = todas.filter((x) => x.estado === 'bien').map((x) => x.desajusteMs);
    return {
      total: {
        notas: todas.length,
        bien: todas.filter((x) => x.estado === 'bien').length,
        falladas: todas.filter((x) => x.estado === 'fallada').length + sobrantes.length,
        omitidas: todas.filter((x) => x.estado === 'omitida').length,
        sobrantes: sobrantes.length,
        titubeos: 0,
        tempo: Math.round(60 / this.negra),
        referencia: 'metrónomo',
        desajusteMs: desajTodas.length ? Math.round(media(desajTodas)) : null,
        desajusteAbsMs: desajTodas.length ? Math.round(media(desajTodas.map(Math.abs))) : null,
      },
      filas,
      pedal: [],
      notas,
      sobrantes,
    };
  }
}
