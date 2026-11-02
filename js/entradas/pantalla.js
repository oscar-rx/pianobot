// Teclado en pantalla: para probar la app sin piano. Suena con un timbre sencillo.

import { contextoAudio, tiempoDesdePerformance } from '../audio.js';
import { esTeclaNegra, midiAFrecuencia, nombreNota } from '../notas.js';

export class EntradaPantalla extends EventTarget {
  constructor(contenedor, { desde = 57, hasta = 81 } = {}) {
    super();
    this.nombre = 'pantalla';
    this.ajusteMs = 0;
    this.contenedor = contenedor;
    this.desde = desde;
    this.hasta = hasta;
    this.voces = new Map();
  }

  static disponible() {
    return true;
  }

  async iniciar() {
    this.#pintar();
    this.contenedor.hidden = false;
    this.dispatchEvent(new CustomEvent('estado', { detail: { texto: 'Teclado en pantalla (para pruebas)', ok: true } }));
  }

  detener() {
    this.contenedor.hidden = true;
    this.contenedor.replaceChildren();
  }

  #pintar() {
    const teclas = [];
    for (let m = this.desde; m <= this.hasta; m++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = esTeclaNegra(m) ? 'tecla negra' : 'tecla blanca';
      b.dataset.midi = m;
      b.setAttribute('aria-label', nombreNota(m));
      if (!esTeclaNegra(m)) b.textContent = m % 12 === 0 || m % 12 === 9 ? nombreNota(m) : '';
      b.addEventListener('pointerdown', (e) => {
        try {
          b.setPointerCapture(e.pointerId);
        } catch {}
        this.#pulsar(m, e.timeStamp, b);
      });
      const soltar = (e) => this.#soltar(m, e.timeStamp, b);
      b.addEventListener('pointerup', soltar);
      b.addEventListener('pointercancel', soltar);
      teclas.push(b);
    }
    this.contenedor.replaceChildren(...teclas);
  }

  #pulsar(midi, ms, boton) {
    if (this.voces.has(midi)) return;
    const c = contextoAudio();
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiAFrecuencia(midi);
    const g = c.createGain();
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(0.25, c.currentTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.06, c.currentTime + 1.2);
    osc.connect(g).connect(c.destination);
    osc.start();
    this.voces.set(midi, { osc, g });
    boton.classList.add('pulsada');
    this.dispatchEvent(new CustomEvent('nota', {
      detail: { tipo: 'noteon', midi, velocidad: 90, tiempo: tiempoDesdePerformance(ms) - this.ajusteMs / 1000, fuente: 'pantalla' },
    }));
  }

  #soltar(midi, ms, boton) {
    const v = this.voces.get(midi);
    if (!v) return;
    const c = contextoAudio();
    v.g.gain.cancelScheduledValues(c.currentTime);
    v.g.gain.setTargetAtTime(0, c.currentTime, 0.03);
    v.osc.stop(c.currentTime + 0.2);
    this.voces.delete(midi);
    boton.classList.remove('pulsada');
    this.dispatchEvent(new CustomEvent('nota', {
      detail: { tipo: 'noteoff', midi, tiempo: tiempoDesdePerformance(ms) - this.ajusteMs / 1000, fuente: 'pantalla' },
    }));
  }
}
