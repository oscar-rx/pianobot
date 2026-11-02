// Metrónomo programado con antelación en el reloj del audio (no depende de los timers).
// El clic es una ráfaga de ruido agudo y corto: sin altura definida y por encima
// de lo que escucha el detector, para que el micro no lo confunda con una nota.

import { contextoAudio } from './audio.js';

export class Metronomo extends EventTarget {
  constructor() {
    super();
    this.ppm = 60;
    this.pulsosPorCompas = 4;
    this.volumen = 0.7;
    this.sonando = false;
    this.pulsos = []; // {tiempo, numero, acento} programados (los últimos)
    this._timer = null;
  }

  #buffers(c) {
    if (this._clics && this._clics.sr === c.sampleRate) return this._clics;
    const crear = (dur, caida) => {
      const n = Math.round(dur * c.sampleRate);
      const b = c.createBuffer(1, n, c.sampleRate);
      const d = b.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < n; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        d[i] = (s / 2 ** 32 - 0.5) * 2 * Math.exp(-i / (caida * c.sampleRate));
      }
      return b;
    };
    this._clics = { sr: c.sampleRate, normal: crear(0.03, 0.006), acento: crear(0.04, 0.009) };
    return this._clics;
  }

  #programarClic(c, cuando, acento) {
    const b = this.#buffers(c);
    const src = c.createBufferSource();
    src.buffer = acento ? b.acento : b.normal;
    const f1 = c.createBiquadFilter();
    f1.type = 'highpass';
    f1.frequency.value = acento ? 5000 : 6500;
    const f2 = c.createBiquadFilter();
    f2.type = 'highpass';
    f2.frequency.value = f1.frequency.value;
    const g = c.createGain();
    g.gain.value = this.volumen * (acento ? 1.6 : 1.0);
    src.connect(f1).connect(f2).connect(g).connect(c.destination);
    src.start(cuando);
  }

  arrancar() {
    if (this.sonando) return;
    const c = contextoAudio();
    this.sonando = true;
    this.numero = 0;
    this.siguiente = c.currentTime + 0.12;
    this.pulsos = [];
    const programar = () => {
      const limite = c.currentTime + 0.2;
      while (this.siguiente < limite) {
        const acento = this.pulsosPorCompas > 1 && this.numero % this.pulsosPorCompas === 0;
        this.#programarClic(c, this.siguiente, acento);
        const p = { tiempo: this.siguiente, numero: this.numero, acento };
        this.pulsos.push(p);
        if (this.pulsos.length > 64) this.pulsos.shift();
        this.dispatchEvent(new CustomEvent('pulso', { detail: p }));
        this.siguiente += 60 / this.ppm;
        this.numero++;
      }
    };
    programar();
    this._timer = setInterval(programar, 25);
    this.dispatchEvent(new Event('cambio'));
  }

  parar() {
    clearInterval(this._timer);
    this._timer = null;
    this.sonando = false;
    this.dispatchEvent(new Event('cambio'));
  }

  ponerTempo(ppm) {
    this.ppm = Math.max(20, Math.min(240, Math.round(ppm)));
    this.dispatchEvent(new Event('cambio'));
  }

  /**
   * Desajuste (s) de un instante respecto a la subdivisión más cercana del pulso.
   * Negativo = adelantado, positivo = retrasado. null si el metrónomo no suena.
   */
  desajuste(tiempo, subdivision = 1) {
    if (!this.pulsos.length) return null;
    const primero = this.pulsos[0];
    const periodo = 60 / this.ppm / subdivision;
    // Solo tiene sentido mientras suena o justo después
    const ultimo = this.pulsos[this.pulsos.length - 1];
    if (tiempo < primero.tiempo - periodo || tiempo > ultimo.tiempo + 2 * periodo) return null;
    const k = Math.round((tiempo - primero.tiempo) / periodo);
    return tiempo - (primero.tiempo + k * periodo);
  }
}
