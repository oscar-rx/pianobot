// Metrónomo programado con antelación en el reloj del audio (no depende de los timers).
// Varios sonidos, todos sintetizados (sin ficheros). «Tic» es una ráfaga de ruido agudo sin
// altura: es el único que el modo micro nunca confunde con una nota.

import { contextoAudio } from './audio.js';

export const SONIDOS = {
  madera: { nombre: 'Madera', conTono: true },
  clasico: { nombre: 'Pitido', conTono: true },
  suave: { nombre: 'Suave', conTono: true },
  tic: { nombre: 'Tic (para el micro)', conTono: false },
};

export class Metronomo extends EventTarget {
  constructor() {
    super();
    this.ppm = 60;
    this.pulsosPorCompas = 4;
    this.volumen = 0.7;
    this.sonido = 'madera';
    this.sonando = false;
    this.pulsos = []; // {tiempo, numero, acento} programados (los últimos)
    this._timer = null;
  }

  #ruido(c) {
    if (this._ruido && this._ruido.sampleRate === c.sampleRate) return this._ruido;
    const n = Math.round(0.05 * c.sampleRate);
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      d[i] = (s / 2 ** 32 - 0.5) * 2;
    }
    this._ruido = b;
    return b;
  }

  // Envolvente percusiva: subida muy corta y caída exponencial.
  #envolvente(c, cuando, pico, caida, duracion) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, cuando);
    g.gain.exponentialRampToValueAtTime(pico, cuando + 0.0015);
    g.gain.setTargetAtTime(0.0001, cuando + 0.0015, caida);
    g.gain.setValueAtTime(0, cuando + duracion);
    g.connect(c.destination);
    return g;
  }

  #tono(c, cuando, tipo, frecuencia, pico, caida, duracion) {
    const o = c.createOscillator();
    o.type = tipo;
    o.frequency.value = frecuencia;
    o.connect(this.#envolvente(c, cuando, pico, caida, duracion));
    o.start(cuando);
    o.stop(cuando + duracion);
  }

  #rafaga(c, cuando, { tipo, frecuencia, q = 1, pico, caida, duracion }) {
    const src = c.createBufferSource();
    src.buffer = this.#ruido(c);
    let nodo = src;
    for (let i = 0; i < (tipo === 'highpass' ? 2 : 1); i++) {
      const f = c.createBiquadFilter();
      f.type = tipo;
      f.frequency.value = frecuencia;
      f.Q.value = q;
      nodo = nodo.connect(f);
    }
    nodo.connect(this.#envolvente(c, cuando, pico, caida, duracion));
    src.start(cuando);
    src.stop(cuando + duracion);
  }

  #programarClic(c, cuando, acento) {
    const v = this.volumen * (acento ? 1.3 : 1);
    if (v <= 0) return;
    switch (this.sonido) {
      case 'madera': {
        // Caja china: dos parciales inarmónicos que se apagan enseguida y un golpe de ruido.
        const f = acento ? 1250 : 950;
        this.#tono(c, cuando, 'sine', f, 0.55 * v, 0.012, 0.09);
        this.#tono(c, cuando, 'sine', f * 1.58, 0.22 * v, 0.008, 0.06);
        this.#rafaga(c, cuando, { tipo: 'bandpass', frecuencia: f * 2.2, q: 2, pico: 0.5 * v, caida: 0.003, duracion: 0.03 });
        break;
      }
      case 'clasico':
        this.#tono(c, cuando, 'triangle', acento ? 1320 : 880, 0.4 * v, 0.03, 0.12);
        break;
      case 'suave':
        this.#tono(c, cuando, 'sine', acento ? 784 : 523, 0.5 * v, 0.025, 0.15);
        break;
      default:
        this.#rafaga(c, cuando, { tipo: 'highpass', frecuencia: acento ? 5000 : 6500, pico: (acento ? 1.2 : 0.8) * v, caida: acento ? 0.009 : 0.006, duracion: 0.05 });
    }
  }

  /** Un clic suelto ahora mismo, para oír cómo suena. */
  probar() {
    const c = contextoAudio();
    this.#programarClic(c, c.currentTime + 0.02, true);
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
