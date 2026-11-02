// Corre en el hilo de audio: junta bloques de 128 muestras y los manda al hilo principal
// con el índice de muestra (reloj del AudioContext) de la primera.

class CapturaPianobot extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tam = 512;
    this.buffer = new Float32Array(this.tam);
    this.lleno = 0;
    this.inicio = 0;
  }

  process(entradas) {
    const canal = entradas[0] && entradas[0][0];
    if (canal) {
      if (this.lleno === 0) this.inicio = currentFrame;
      this.buffer.set(canal, this.lleno);
      this.lleno += canal.length;
      if (this.lleno >= this.tam) {
        this.port.postMessage({ inicio: this.inicio, muestras: this.buffer }, [this.buffer.buffer]);
        this.buffer = new Float32Array(this.tam);
        this.lleno = 0;
      }
    }
    return true;
  }
}

registerProcessor('captura-pianobot', CapturaPianobot);
