// Un único AudioContext para toda la app: es el reloj común del metrónomo y del piano.
// Todos los tiempos de nota van en segundos de este reloj, «tal como suenan»:
// comparables directamente con el momento en que suena cada clic del metrónomo.

let ctx = null;

export function contextoAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  return ctx;
}

export async function activarAudio() {
  const c = contextoAudio();
  if (c.state !== 'running') await c.resume();
  return c;
}

/** Latencia de salida estimada (s): lo que tarda un sonido programado en llegar al altavoz. */
export function latenciaSalida(c = contextoAudio()) {
  return (c.baseLatency || 0) + (c.outputLatency || 0);
}

// Desfase entre los dos relojes (s): reloj de audio «tal como suena» − performance.now()/1000.
// Medirlo en cada nota mete ruido de un par de ms (la medida baila entre llamadas), así que se
// mide como mucho cada 0,5 s y se suaviza. Así las teclas de un acorde dan exactamente el mismo tiempo.
let desfase = null; // {valor, medido (ms), ctx}

function medirDesfase(c) {
  const ts = c.getOutputTimestamp?.();
  if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
    // contextTime es lo que está sonando en el altavoz en performanceTime
    return ts.contextTime - ts.performanceTime / 1000;
  }
  return c.currentTime - latenciaSalida(c) - performance.now() / 1000;
}

/** Convierte un instante de performance.now() (p. ej. event.timeStamp de MIDI) al reloj del audio. */
export function tiempoDesdePerformance(ms, c = contextoAudio()) {
  const ahora = performance.now();
  if (!desfase || desfase.ctx !== c || c.state !== 'running') {
    desfase = { valor: medirDesfase(c), medido: ahora, ctx: c };
  } else if (ahora - desfase.medido > 500) {
    const nuevo = medirDesfase(c);
    // Un salto grande (el audio se ha parado y reanudado) se toma tal cual; el ruido pequeño se suaviza.
    desfase.valor = Math.abs(nuevo - desfase.valor) > 0.05 ? nuevo : desfase.valor + 0.2 * (nuevo - desfase.valor);
    desfase.medido = ahora;
  }
  return desfase.valor + ms / 1000;
}

/** El instante del reloj de audio que está sonando ahora mismo por el altavoz. */
export function ahoraSonando(c = contextoAudio()) {
  return tiempoDesdePerformance(performance.now(), c);
}
