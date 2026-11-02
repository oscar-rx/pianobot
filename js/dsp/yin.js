// Detector de altura YIN (de Cheveigné y Kawahara, 2002).
// La función diferencia se calcula con FFT (autocorrelación cruzada),
// así que cuesta dos FFT por análisis en vez de O(W·τ).

import { fft, siguientePotenciaDe2 } from './fft.js';

export class DetectorYin {
  /**
   * @param {object} o
   * @param {number} o.frecuenciaMuestreo
   * @param {number} [o.tamano=2048]  muestras que recibe detectar()
   * @param {number} [o.fMin=50]      Hz
   * @param {number} [o.fMax=2100]    Hz
   * @param {number} [o.umbral=0.15]  umbral absoluto de YIN
   * @param {number} [o.umbralSubarmonico=0.2] un divisor del periodo con un mínimo por debajo de esto gana
   * @param {number} [o.umbralAmbiguo=0.6] un divisor con un mínimo por debajo de esto hace la lectura dudosa
   */
  constructor({ frecuenciaMuestreo, tamano = 2048, fMin = 50, fMax = 2100, umbral = 0.15, umbralSubarmonico = 0.2, umbralAmbiguo = 0.6 }) {
    this.umbralSubarmonico = umbralSubarmonico;
    this.umbralAmbiguo = umbralAmbiguo;
    this.sr = frecuenciaMuestreo;
    this.tamano = tamano;
    this.W = tamano >> 1;
    this.tauMax = Math.min(this.W - 1, Math.floor(this.sr / fMin));
    this.tauMin = Math.max(2, Math.floor(this.sr / fMax));
    this.umbral = umbral;
    this.N = siguientePotenciaDe2(tamano + this.W);
    this.re = new Float64Array(this.N);
    this.im = new Float64Array(this.N);
    this.pr = new Float64Array(this.N);
    this.pi = new Float64Array(this.N);
    this.cuadrados = new Float64Array(tamano + 1);
    this.cmndf = new Float64Array(this.tauMax + 2);
  }

  /**
   * @param {Float32Array|Float64Array} x  `tamano` muestras, la más antigua primero
   * @returns {{frecuencia:number, aperiodicidad:number}} frecuencia 0 si no hay tono claro
   */
  detectar(x) {
    const { N, W, re, im, pr, pi, cuadrados, cmndf, tauMax } = this;
    const tam = this.tamano;

    // a = primeros W valores (parte real), b = ventana completa (parte imaginaria):
    // una sola FFT compleja da las dos transformadas.
    re.fill(0);
    im.fill(0);
    for (let j = 0; j < W; j++) re[j] = x[j];
    for (let j = 0; j < tam; j++) im[j] = x[j];
    fft(re, im);

    for (let k = 0; k < N; k++) {
      const nk = (N - k) & (N - 1);
      const zr = re[k], zi = im[k];
      const wr = re[nk], wi = -im[nk];
      const ar = (zr + wr) * 0.5, ai = (zi + wi) * 0.5;
      const br = (zi - wi) * 0.5, bi = -(zr - wr) * 0.5;
      // conj(A)·B, y conjugado otra vez para hacer la inversa con la FFT directa
      pr[k] = ar * br + ai * bi;
      pi[k] = -(ar * bi - ai * br);
    }
    fft(pr, pi);
    // pr[τ]/N = Σ_j a_j · b_{j+τ}

    cuadrados[0] = 0;
    for (let i = 0; i < tam; i++) cuadrados[i + 1] = cuadrados[i] + x[i] * x[i];
    const e0 = cuadrados[W];

    cmndf[0] = 1;
    let suma = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      const et = cuadrados[tau + W] - cuadrados[tau];
      const d = Math.max(0, e0 + et - (2 * pr[tau]) / N);
      suma += d;
      cmndf[tau] = suma > 0 ? (d * tau) / suma : 1;
    }

    let tau = -1;
    for (let t = this.tauMin; t <= tauMax; t++) {
      if (cmndf[t] < this.umbral) {
        while (t + 1 <= tauMax && cmndf[t + 1] < cmndf[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      let minimo = Infinity;
      for (let t = this.tauMin; t <= tauMax; t++) if (cmndf[t] < minimo) minimo = cmndf[t];
      return { frecuencia: 0, aperiodicidad: minimo };
    }

    // Dos notas sonando a la vez (la anterior aún no se ha apagado) comparten un periodo
    // común, más largo que los de cada una: YIN daría una nota grave que nadie ha tocado.
    // Si el periodo hallado tiene un divisor con un mínimo claro, la nota real es esa;
    // si el divisor solo se insinúa, la mezcla es ambigua y es mejor no dar altura.
    let mejorSub = -1, valorSub = Infinity, ambiguo = false;
    for (let k = 2; k <= 6; k++) {
      const centro = tau / k;
      if (centro < this.tauMin) break;
      const desde = Math.max(this.tauMin, Math.floor(centro * 0.97) - 1);
      const hasta = Math.min(tauMax - 1, Math.ceil(centro * 1.03) + 1);
      for (let t = desde; t <= hasta; t++) {
        const v = cmndf[t];
        if (v <= cmndf[t - 1] && v <= cmndf[t + 1]) {
          if (v < this.umbralSubarmonico && v < valorSub) {
            valorSub = v;
            mejorSub = t;
          } else if (v < this.umbralAmbiguo) ambiguo = true;
        }
      }
    }
    if (mejorSub > 0) tau = mejorSub;
    else if (ambiguo) return { frecuencia: 0, aperiodicidad: cmndf[tau] + this.umbral };

    let tauFino = tau;
    if (tau > 1 && tau < tauMax) {
      const a = cmndf[tau - 1], b = cmndf[tau], c = cmndf[tau + 1];
      const den = a - 2 * b + c;
      if (den > 0) tauFino = tau + (a - c) / (2 * den);
    }
    return { frecuencia: this.sr / tauFino, aperiodicidad: cmndf[tau] };
  }
}
