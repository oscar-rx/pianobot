// Entrada por micrófono: el micro de la tablet escucha el piano y el analizador saca las notas.
// Funciona con una nota cada vez (una mano, sin pedal). Es el modo de prueba hasta tener el cable.

import { contextoAudio, latenciaSalida } from '../audio.js';
import { AnalizadorAudio } from '../dsp/analizador.js';

export class EntradaMicro extends EventTarget {
  constructor() {
    super();
    this.nombre = 'micro';
    this.ajusteMs = 0;
    this.sensibilidadDb = 12;
    this.analizador = null;
  }

  static disponible() {
    return !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== 'undefined';
  }

  async iniciar() {
    if (!EntradaMicro.disponible()) {
      this.#estado('Este navegador no deja usar el micro aquí (hace falta https y Chrome).', false);
      throw new Error('Micro no disponible');
    }
    const c = contextoAudio();
    this.#estado('Pidiendo permiso para el micro…', false);
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    await c.audioWorklet.addModule(new URL('./captura-worklet.js', import.meta.url));

    this.analizador = new AnalizadorAudio({ frecuenciaMuestreo: c.sampleRate, sensibilidadDb: this.sensibilidadDb });

    const fuente = c.createMediaStreamSource(this.stream);
    // Filtros: fuera retumbos (< 45 Hz) y todo lo que pase de ~3 kHz (el clic del metrónomo,
    // siseos). Las notas de la Invención 13 tienen la fundamental muy por debajo.
    const filtros = [
      Object.assign(c.createBiquadFilter(), { type: 'highpass' }),
      Object.assign(c.createBiquadFilter(), { type: 'lowpass' }),
      Object.assign(c.createBiquadFilter(), { type: 'lowpass' }),
    ];
    filtros[0].frequency.value = 45;
    filtros[1].frequency.value = 3000;
    filtros[2].frequency.value = 3000;
    this.nodo = new AudioWorkletNode(c, 'captura-pianobot', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    this.silencio = c.createGain();
    this.silencio.gain.value = 0;
    fuente.connect(filtros[0]).connect(filtros[1]).connect(filtros[2]).connect(this.nodo).connect(this.silencio).connect(c.destination);
    this.fuente = fuente;

    this.nodo.port.onmessage = ({ data }) => {
      const eventos = this.analizador.alimentar(data.muestras, data.inicio);
      if (!eventos.length) return;
      // Lo que entra por el micro llega tarde (latencia de entrada) y el clic sale tarde
      // (latencia de salida): se descuentan las dos para comparar con el metrónomo.
      const compensacion = 2 * latenciaSalida(c) + this.ajusteMs / 1000;
      for (const e of eventos) {
        this.dispatchEvent(new CustomEvent('nota', { detail: { ...e, tiempo: e.tiempo - compensacion, fuente: 'micro' } }));
      }
    };
    const pista = this.stream.getAudioTracks()[0];
    this.#estado(`Escuchando: ${pista?.label || 'micrófono'}`, true);
  }

  configurar({ sensibilidadDb }) {
    if (sensibilidadDb != null) {
      this.sensibilidadDb = sensibilidadDb;
      this.analizador?.seguidor.configurar({ sensibilidadDb });
    }
  }

  /** Último cuadro analizado: nivel, fondo y altura, para el medidor. */
  get lectura() {
    return this.analizador?.ultimo ?? null;
  }

  detener() {
    this.nodo?.port && (this.nodo.port.onmessage = null);
    try {
      this.fuente?.disconnect();
      this.nodo?.disconnect();
      this.silencio?.disconnect();
    } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analizador = null;
  }

  #estado(texto, ok) {
    this.dispatchEvent(new CustomEvent('estado', { detail: { texto, ok } }));
  }
}
