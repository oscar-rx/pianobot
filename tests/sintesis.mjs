// Audio sintético parecido a un piano para las pruebas: parciales algo inarmónicos,
// ataque rápido y doble caída exponencial (los armónicos agudos caen antes).

import { midiAFrecuencia } from '../js/notas.js';

export function crearRuido(semilla = 1) {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}

/**
 * @param {Array<{midi:number, inicio:number, duracion:number, fuerza?:number}>} notas
 * @param {object} o
 */
export function sintetizar(notas, { sr = 48000, duracion, ruidoDb = -70, semilla = 7 } = {}) {
  const total = Math.ceil((duracion ?? Math.max(...notas.map((n) => n.inicio + n.duracion)) + 0.5) * sr);
  const x = new Float32Array(total);
  const B = 0.0004; // inarmonicidad
  for (const n of notas) {
    // Volver a pulsar una tecla que aún suena corta la vibración anterior (el macillo la reinicia).
    const siguiente = notas.find((m) => m.midi === n.midi && m.inicio > n.inicio);
    const corte = siguiente ? siguiente.inicio - n.inicio : Infinity;
    const f0 = midiAFrecuencia(n.midi);
    const amp = (n.fuerza ?? 0.8) * 0.25;
    const i0 = Math.round(n.inicio * sr);
    const iFin = Math.min(total, i0 + Math.round((n.duracion + 0.25) * sr));
    for (let k = 1; k <= 10; k++) {
      const fk = k * f0 * Math.sqrt(1 + B * k * k);
      if (fk > sr / 2 - 1000) break;
      // En los graves del piano la fundamental es débil y mandan los armónicos.
      const debil = f0 < 130 ? [0.35, 0.9][k - 1] ?? 1 : 1;
      const ak = (amp * debil) / Math.pow(k, 1.1);
      // Doble caída típica del piano: un descenso rápido al principio y una cola larga.
      const caidaRapida = 5 + 0.8 * k;
      const caidaLenta = 0.6 + 0.3 * k;
      const w = (2 * Math.PI * fk) / sr;
      for (let i = i0; i < iFin; i++) {
        const t = (i - i0) / sr;
        const ataque = Math.min(1, t / 0.003);
        // al soltar la tecla, el apagador corta en ~80 ms
        if (t >= corte) break;
        const suelta = t > n.duracion ? Math.exp(-(t - n.duracion) / 0.03) : 1;
        const envolvente = 0.6 * Math.exp(-caidaRapida * t) + 0.4 * Math.exp(-caidaLenta * t);
        x[i] += ak * ataque * suelta * envolvente * Math.sin(w * (i - i0));
      }
    }
  }
  const ruido = crearRuido(semilla);
  const a = Math.pow(10, ruidoDb / 20) * 2;
  for (let i = 0; i < total; i++) x[i] += a * ruido();
  return x;
}

/** Ráfaga de ruido corta, como el clic del metrónomo o un golpe en la mesa. */
export function anadirGolpe(x, inicio, { sr = 48000, duracion = 0.02, amplitud = 0.3, semilla = 3 } = {}) {
  const ruido = crearRuido(semilla);
  const i0 = Math.round(inicio * sr);
  const n = Math.round(duracion * sr);
  for (let i = 0; i < n && i0 + i < x.length; i++) {
    x[i0 + i] += amplitud * 2 * ruido() * Math.exp(-(i / sr) / (duracion / 4));
  }
  return x;
}

export function wav(x, sr = 48000) {
  const datos = Buffer.alloc(44 + x.length * 2);
  datos.write('RIFF', 0);
  datos.writeUInt32LE(36 + x.length * 2, 4);
  datos.write('WAVEfmt ', 8);
  datos.writeUInt32LE(16, 16);
  datos.writeUInt16LE(1, 20);
  datos.writeUInt16LE(1, 22);
  datos.writeUInt32LE(sr, 24);
  datos.writeUInt32LE(sr * 2, 28);
  datos.writeUInt16LE(2, 32);
  datos.writeUInt16LE(16, 34);
  datos.write('data', 36);
  datos.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) {
    datos.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  }
  return datos;
}
