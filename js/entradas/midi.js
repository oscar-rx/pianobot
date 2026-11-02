// Entrada por cable: Web MIDI (Chrome en Android y escritorio).

import { tiempoDesdePerformance } from '../audio.js';

export class EntradaMidi extends EventTarget {
  constructor() {
    super();
    this.nombre = 'midi';
    this.acceso = null;
    this.ajusteMs = 0;
    this._alMensaje = (e) => this.#mensaje(e);
  }

  static disponible() {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async iniciar() {
    if (!EntradaMidi.disponible()) {
      this.#estado('Este navegador no tiene MIDI. Usa Chrome.', false);
      throw new Error('Web MIDI no disponible');
    }
    this.acceso = await navigator.requestMIDIAccess({ sysex: false });
    this.acceso.onstatechange = () => this.#conectar();
    this.#conectar();
  }

  detener() {
    if (!this.acceso) return;
    for (const entrada of this.acceso.inputs.values()) entrada.removeEventListener('midimessage', this._alMensaje);
    this.acceso.onstatechange = null;
    this.acceso = null;
  }

  #conectar() {
    const nombres = [];
    for (const entrada of this.acceso.inputs.values()) {
      entrada.removeEventListener('midimessage', this._alMensaje);
      if (entrada.state === 'connected') {
        entrada.addEventListener('midimessage', this._alMensaje);
        nombres.push(entrada.name || 'Teclado MIDI');
      }
    }
    if (nombres.length) this.#estado(`Conectado: ${nombres.join(', ')}`, true);
    else this.#estado('Esperando al piano… Conéctalo por USB.', false);
  }

  #mensaje(e) {
    const [estado, d1, d2] = e.data;
    const tipo = estado & 0xf0;
    const ahora = performance.now();
    // Algunos dispositivos dan marcas de tiempo raras: si no cuadran, se usa el momento de llegada.
    const ms = e.timeStamp > 0 && Math.abs(e.timeStamp - ahora) < 1000 ? e.timeStamp : ahora;
    const tiempo = tiempoDesdePerformance(ms) - this.ajusteMs / 1000;
    if (tipo === 0x90 && d2 > 0) {
      this.#nota({ tipo: 'noteon', midi: d1, velocidad: d2, tiempo });
    } else if (tipo === 0x80 || (tipo === 0x90 && d2 === 0)) {
      this.#nota({ tipo: 'noteoff', midi: d1, tiempo });
    } else if (tipo === 0xb0 && d1 === 64) {
      this.dispatchEvent(new CustomEvent('pedal', { detail: { pisado: d2 >= 64, tiempo } }));
    }
  }

  #nota(n) {
    this.dispatchEvent(new CustomEvent('nota', { detail: { ...n, fuente: 'midi' } }));
  }

  #estado(texto, ok) {
    this.dispatchEvent(new CustomEvent('estado', { detail: { texto, ok } }));
  }
}
