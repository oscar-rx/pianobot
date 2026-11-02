// Recibe muestras de audio en bruto y devuelve notas.
// Une el detector de altura (YIN) y el seguidor de notas. No depende del navegador,
// así que se puede probar en Node con audio sintético.

import { DetectorYin } from './yin.js';
import { SeguidorNotas } from './seguidor-notas.js';

export class AnalizadorAudio {
  constructor({ frecuenciaMuestreo, tamano = 2048, salto = 256, fMin = 50, fMax = 2100, ...opcionesSeguidor }) {
    this.sr = frecuenciaMuestreo;
    this.tamano = tamano;
    this.salto = salto;
    this.ventanaEnergia = Math.min(tamano, 1024);
    this.yin = new DetectorYin({ frecuenciaMuestreo, tamano, fMin, fMax });
    this.seguidor = new SeguidorNotas({
      duracionVentana: tamano / frecuenciaMuestreo,
      duracionSalto: salto / frecuenciaMuestreo,
      ...opcionesSeguidor,
    });
    this.anillo = new Float32Array(tamano * 4);
    this.ventana = new Float32Array(tamano);
    this.invertida = new Float32Array(tamano);
    this.escritas = 0; // muestras recibidas en total
    this.siguienteCuadro = tamano; // índice (exclusivo) donde acaba el próximo cuadro
    this.primeraMuestra = null; // índice de muestra (en el reloj del audio) de la primera recibida
    this.ultimo = { rmsDb: -120, frecuencia: 0, aperiodicidad: 1 };
  }

  /**
   * @param {Float32Array} muestras
   * @param {number} [indiceInicio] índice de la primera muestra en el reloj del AudioContext
   * @returns {Array} eventos de nota con `tiempo` en segundos de ese reloj
   */
  alimentar(muestras, indiceInicio) {
    if (this.primeraMuestra == null) this.primeraMuestra = indiceInicio ?? 0;
    if (muestras.length > this.tamano) {
      const eventos = [];
      for (let i = 0; i < muestras.length; i += this.tamano) {
        eventos.push(...this.alimentar(muestras.subarray(i, i + this.tamano)));
      }
      return eventos;
    }
    const eventos = [];
    const n = this.anillo.length;
    for (let i = 0; i < muestras.length; i++) {
      this.anillo[(this.escritas + i) % n] = muestras[i];
    }
    this.escritas += muestras.length;

    while (this.siguienteCuadro <= this.escritas) {
      const fin = this.siguienteCuadro;
      const ini = fin - this.tamano;
      for (let i = 0; i < this.tamano; i++) this.ventana[i] = this.anillo[(ini + i) % n];

      // Energía larga (≥ un periodo de la nota más grave, estable) y corta (último salto, precisa en el tiempo)
      let sumaCorta = 0;
      for (let i = this.tamano - this.salto; i < this.tamano; i++) sumaCorta += this.ventana[i] * this.ventana[i];
      let sumaLarga = sumaCorta;
      for (let i = this.tamano - this.ventanaEnergia; i < this.tamano - this.salto; i++) sumaLarga += this.ventana[i] * this.ventana[i];
      const rmsDb = 10 * Math.log10(sumaLarga / this.ventanaEnergia + 1e-12);
      const rmsCortoDb = 10 * Math.log10(sumaCorta / this.salto + 1e-12);

      // YIN compara su primera mitad con el resto. Al pasarle la ventana al revés, la referencia
      // son los ~21 ms más recientes, y una nota nueva se reconoce antes de que la anterior salga del todo.
      for (let i = 0; i < this.tamano; i++) this.invertida[i] = this.ventana[this.tamano - 1 - i];
      const { frecuencia, aperiodicidad } =
        rmsDb > -90 ? this.yin.detectar(this.invertida) : { frecuencia: 0, aperiodicidad: 1 };

      const t = (this.primeraMuestra + fin) / this.sr;
      this.ultimo = { t, rmsDb, frecuencia, aperiodicidad, fondoDb: this.seguidor.fondo };
      eventos.push(...this.seguidor.procesar({ t, rmsDb, rmsCortoDb, frecuencia, aperiodicidad }));
      this.siguienteCuadro += this.salto;
    }
    return eventos;
  }
}
