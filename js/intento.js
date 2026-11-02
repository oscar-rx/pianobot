// Graba intentos: un intento empieza con la primera nota y termina cuando dejas de tocar un rato
// (por defecto 2,5 s sin pulsar nada). Entonces avisa con 'intento' y se queda esperando al siguiente.

export class GrabadorIntentos extends EventTarget {
  /**
   * @param {object} o
   * @param {number} [o.silencio=2.5]  segundos sin tocar que cierran el intento
   * @param {number} [o.maxSostenida=10] si una tecla se queda «pulsada» más que esto (p. ej. se perdió el noteoff), se cierra igual
   * @param {Function} [o.programar] y [o.cancelar]: temporizadores (inyectables para las pruebas)
   * @param {Function} [o.ahora]  reloj en segundos
   */
  constructor({
    silencio = 2.5,
    maxSostenida = 10,
    // (envueltos: setTimeout llamado como método de otro objeto da «Illegal invocation» en el navegador)
    programar = (f, ms) => setTimeout(f, ms),
    cancelar = (id) => clearTimeout(id),
    ahora = () => performance.now() / 1000,
  } = {}) {
    super();
    Object.assign(this, { silencio, maxSostenida, programar, cancelar, ahora });
    this.activo = false;
    this.pedalPisado = false;
    this.#reiniciar();
  }

  #reiniciar() {
    this.cancelar(this.temporizador);
    this.temporizador = null;
    this.notas = [];
    this.abiertas = new Map();
    this.pedal = { inicial: this.pedalPisado, eventos: [] };
    this.ultimoEvento = null;
  }

  activar(activo) {
    this.activo = activo;
    this.#reiniciar();
  }

  get grabando() {
    return this.notas.length > 0;
  }

  /** @param {{tipo: 'noteon'|'noteoff', midi: number, velocidad?: number, tiempo: number}} n */
  nota(n) {
    if (!this.activo) return;
    if (n.tipo === 'noteon') {
      if (!this.notas.length) {
        this.pedal = { inicial: this.pedalPisado, eventos: [] };
        this.dispatchEvent(new Event('inicio'));
      }
      const nota = { midi: n.midi, t: n.tiempo, fin: null, velocidad: n.velocidad };
      this.notas.push(nota);
      this.abiertas.set(n.midi, nota);
      this.dispatchEvent(new CustomEvent('nota', { detail: nota }));
    } else {
      const nota = this.abiertas.get(n.midi);
      if (nota) {
        nota.fin = n.tiempo;
        this.abiertas.delete(n.midi);
      }
    }
    if (this.notas.length) this.#esperarSilencio();
  }

  /** @param {{pisado: boolean, tiempo: number}} p */
  pedalCambia(p) {
    this.pedalPisado = p.pisado;
    if (this.activo && this.notas.length) {
      this.pedal.eventos.push({ pisado: p.pisado, t: p.tiempo });
      this.#esperarSilencio();
    }
  }

  #esperarSilencio() {
    this.ultimoEvento = this.ahora();
    this.cancelar(this.temporizador);
    this.temporizador = this.programar(() => this.#quizaTerminar(), this.silencio * 1000);
  }

  #quizaTerminar() {
    // Con alguna tecla aún pulsada (una nota larga), se espera a que se suelte.
    if (this.abiertas.size && this.ahora() - this.ultimoEvento < this.maxSostenida) {
      this.temporizador = this.programar(() => this.#quizaTerminar(), 500);
      return;
    }
    this.terminar();
  }

  /** Cierra el intento en curso (si hay notas) y avisa con 'intento'. */
  terminar() {
    if (!this.notas.length) return;
    const detalle = { notas: this.notas, pedal: this.pedal };
    this.#reiniciar();
    this.dispatchEvent(new CustomEvent('intento', { detail: detalle }));
  }
}
