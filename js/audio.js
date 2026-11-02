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

/** Convierte un instante de performance.now() (p. ej. event.timeStamp de MIDI) al reloj del audio. */
export function tiempoDesdePerformance(ms, c = contextoAudio()) {
  const ts = c.getOutputTimestamp?.();
  if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
    // contextTime es lo que está sonando en el altavoz en performanceTime
    return ts.contextTime + (ms - ts.performanceTime) / 1000;
  }
  return c.currentTime - latenciaSalida(c) + (ms - performance.now()) / 1000;
}

/** El instante del reloj de audio que está sonando ahora mismo por el altavoz. */
export function ahoraSonando(c = contextoAudio()) {
  return tiempoDesdePerformance(performance.now(), c);
}
