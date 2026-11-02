// Convierte el análisis cuadro a cuadro (energía + altura) en notas:
// eventos noteon / noteoff con su momento y una fuerza aproximada.
//
// Pensado para una nota a la vez (una mano, melodía). Dos señales disparan una nota:
//  1. Ataque: la energía sube de golpe. Se confirma cuando la altura se estabiliza;
//     si no aparece un tono claro (un golpe, el clic del metrónomo) se descarta.
//  2. Cambio de altura: suena otra nota estable sin un salto de energía claro (legato).

import { frecuenciaAMidi } from '../notas.js';

const POR_DEFECTO = {
  sensibilidadDb: 12, // dB por encima del ruido de fondo para aceptar un ataque
  saltoAtaqueDb: 3, // subida mínima de energía que cuenta como ataque
  minDbAbsoluto: -80, // nunca aceptar nada por debajo de esto (dBFS)
  maxAperiodicidad: 0.25, // por encima de esto el cuadro no tiene tono claro
  cuadrosConfirmar: 3, // cuadros seguidos con la misma nota para confirmar un ataque
  cuadrosCambio: 4, // cuadros seguidos con otra nota para aceptar un cambio sin ataque
  esperaTrasAtaque: 0.021, // s: la ventana de análisis tarda en llenarse con la nota nueva
  ventanaConfirmacion: 0.15, // s: tiempo máximo para que un ataque tenga tono
  refractario: 0.06, // s: tras un ataque no se busca otro
  caidaDb: 32, // la nota se da por acabada al caer esto desde su pico
  memoriaFondo: 3, // s de silencio que se miran para estimar el ruido de fondo
  silencioDigitalDb: -100, // por debajo de esto son ceros del micro, no ruido real
};

const CUADROS_MINIMOS_FONDO = 40; // ~0,2 s de ruido antes de aceptar notas

export class SeguidorNotas {
  /** @param {number} duracionVentana s que abarca el análisis de altura @param {number} duracionSalto s entre cuadros */
  constructor({ duracionVentana, duracionSalto, ...opciones } = {}) {
    this.o = { ...POR_DEFECTO, ...opciones };
    this.ventana = duracionVentana;
    this.salto = duracionSalto;
    this.historialFondo = new Float32Array(Math.max(CUADROS_MINIMOS_FONDO, Math.round(this.o.memoriaFondo / (duracionSalto || 0.005))));
    this.reiniciar();
  }

  reiniciar() {
    this.fondo = null;
    this.cuadrosFondo = 0; // cuántos cuadros de silencio se han guardado en total
    this.recientes = [];
    this.cortos = [];
    this.activa = null; // {midi, inicio, picoDb}
    this.candidato = null; // {t0, picoDb, midi, cuenta}
    this.ultimoAtaque = -Infinity;
    this.racha = null; // {midi, cuenta, primero}
    this.ultimoT = null;
  }

  configurar(opciones) {
    Object.assign(this.o, opciones);
  }

  // Sin estimación de fondo todavía (justo al arrancar) no se acepta ninguna nota.
  get umbralAtaque() {
    if (this.fondo == null) return Infinity;
    return Math.max(this.fondo + this.o.sensibilidadDb, this.o.minDbAbsoluto);
  }

  get umbralSilencio() {
    if (this.fondo == null) return Infinity;
    return Math.max(this.fondo + this.o.sensibilidadDb * 0.5, this.o.minDbAbsoluto - 6);
  }

  // Ruido de fondo = nivel típico (mediana) de los últimos segundos sin nota.
  // No vale el mínimo: un instante de ceros (el micro arrancando) lo hundiría y
  // el umbral dejaría pasar cualquier ruido, se pusiera como se pusiera.
  #actualizarFondo(rmsDb) {
    if (rmsDb < this.o.silencioDigitalDb || this.activa || this.candidato) return;
    const h = this.historialFondo;
    h[this.cuadrosFondo % h.length] = rmsDb;
    this.cuadrosFondo++;
    const n = Math.min(this.cuadrosFondo, h.length);
    if (n < CUADROS_MINIMOS_FONDO) return;
    if (this.fondo == null || this.cuadrosFondo % 8 === 0) {
      const orden = Array.from(h.subarray(0, n)).sort((a, b) => a - b);
      this.fondo = orden[Math.floor(n / 2)];
    }
  }

  /**
   * @param {{t:number, rmsDb:number, rmsCortoDb?:number, frecuencia:number, aperiodicidad:number}} c
   *   t = final del cuadro (s); rmsDb = energía estable (~20 ms); rmsCortoDb = energía del último salto
   * @returns {Array<{tipo:'noteon'|'noteoff', midi:number, tiempo:number, velocidad?:number, frecuencia?:number}>}
   */
  procesar({ t, rmsDb, rmsCortoDb = rmsDb, frecuencia, aperiodicidad }) {
    const o = this.o;
    const eventos = [];
    this.ultimoT = t;
    this.#actualizarFondo(rmsDb);

    const conTono = frecuencia > 0 && aperiodicidad <= o.maxAperiodicidad && rmsDb > this.umbralSilencio;
    const midiCuadro = conTono ? Math.round(frecuenciaAMidi(frecuencia)) : null;

    // 1. ¿Ataque?
    const minimoReciente = this.recientes.length ? Math.min(...this.recientes) : rmsDb;
    if (
      rmsDb >= this.umbralAtaque &&
      rmsDb - minimoReciente >= o.saltoAtaqueDb &&
      t - this.ultimoAtaque >= o.refractario
    ) {
      this.candidato = { t0: this.#momentoAtaque(t - 4 * this.salto, t, rmsCortoDb), picoDb: rmsDb, midi: null, cuenta: 0, frecuencia: 0 };
      this.ultimoAtaque = t;
      this.racha = null;
    }
    this.recientes.push(rmsDb);
    if (this.recientes.length > 4) this.recientes.shift();
    this.cortos.push({ t, db: rmsCortoDb });
    if (this.cortos.length > 16) this.cortos.shift();

    if (this.candidato) {
      const c = this.candidato;
      c.picoDb = Math.max(c.picoDb, rmsDb);
      if (t - c.t0 >= o.esperaTrasAtaque && midiCuadro != null) {
        if (midiCuadro === c.midi) c.cuenta++;
        else {
          c.midi = midiCuadro;
          c.cuenta = 1;
        }
        c.frecuencia = frecuencia;
        if (c.cuenta >= o.cuadrosConfirmar) {
          this.#empezarNota(eventos, c.midi, c.t0, c.picoDb, c.frecuencia);
          this.candidato = null;
        }
      }
      if (this.candidato && t - c.t0 > o.ventanaConfirmacion) this.candidato = null;
    } else if (this.activa && midiCuadro != null && midiCuadro !== this.activa.midi) {
      // 2. ¿Cambio de altura sin ataque claro? (legato: la nota anterior aún suena).
      //    Desde el silencio siempre hay ataque, así que solo se mira con una nota activa.
      if (this.racha && this.racha.midi === midiCuadro) this.racha.cuenta++;
      else this.racha = { midi: midiCuadro, cuenta: 1, primero: t, picoDb: rmsDb, frecuencia };
      this.racha.picoDb = Math.max(this.racha.picoDb, rmsDb);
      if (this.racha.cuenta >= o.cuadrosCambio) {
        const r = this.racha;
        const intervalo = Math.abs(r.midi - this.activa.midi);
        // Saltos de octava, duodécima o dos octavas sin ataque suelen ser
        // errores de armónicos en la cola de la nota, no notas nuevas.
        const armonico = [12, 19, 24].includes(intervalo);
        if (!armonico && r.picoDb >= this.umbralSilencio) {
          const inicio = Math.max(this.#momentoAtaque(r.primero - this.ventana, r.primero), this.activa.inicio + this.salto);
          this.#empezarNota(eventos, r.midi, inicio, r.picoDb, r.frecuencia);
        }
        this.racha = null;
      }
    } else {
      this.racha = null;
    }

    // 3. ¿Se ha apagado la nota?
    if (this.activa) {
      const a = this.activa;
      if (t - a.inicio < 0.1) a.picoDb = Math.max(a.picoDb, rmsDb);
      if (rmsDb < this.umbralSilencio || rmsDb < a.picoDb - o.caidaDb) {
        eventos.push({ tipo: 'noteoff', midi: a.midi, tiempo: t });
        this.activa = null;
      }
    }
    return eventos;
  }

  // El ataque cae en el salto donde más sube la energía corta, buscando entre `desde` y `hasta`.
  #momentoAtaque(desde, hasta, dbActual) {
    const cortos = dbActual == null ? this.cortos : [...this.cortos, { t: hasta, db: dbActual }];
    let mejor = hasta, mayorSubida = -Infinity;
    for (let i = 1; i < cortos.length; i++) {
      if (cortos[i].t < desde || cortos[i].t > hasta) continue;
      const subida = cortos[i].db - cortos[i - 1].db;
      if (subida > mayorSubida) {
        mayorSubida = subida;
        mejor = cortos[i].t;
      }
    }
    return mejor - this.salto / 2;
  }

  #empezarNota(eventos, midi, inicio, picoDb, frecuencia) {
    if (this.activa) eventos.push({ tipo: 'noteoff', midi: this.activa.midi, tiempo: inicio });
    eventos.push({ tipo: 'noteon', midi, tiempo: inicio, velocidad: velocidadDesdeDb(picoDb), frecuencia, nivelDb: picoDb });
    this.activa = { midi, inicio, picoDb };
  }
}

/** Fuerza aproximada (1-127) a partir del pico de energía en dBFS. */
export function velocidadDesdeDb(db) {
  return Math.max(1, Math.min(127, Math.round(((db + 60) / 54) * 126 + 1)));
}
