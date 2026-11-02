// Prueba de la fase 1: «tocas una escala a 60 y aparece entera, sin notas perdidas».
// Compara las notas que llegan con las esperadas, en orden, tolerando un fallo o una omisión.

const subirYBajar = (notas) => [...notas, ...notas.slice(0, -1).reverse()];

export const ESCALAS = {
  'do-mayor': { nombre: 'Do mayor · Do4–Do5', notas: subirYBajar([60, 62, 64, 65, 67, 69, 71, 72]) },
  'la-menor': { nombre: 'La menor armónica · La3–La4', notas: subirYBajar([57, 59, 60, 62, 64, 65, 68, 69]) },
  'la-menor-2': {
    nombre: 'La menor armónica · 2 octavas',
    notas: subirYBajar([57, 59, 60, 62, 64, 65, 68, 69, 71, 72, 74, 76, 77, 80, 81]),
  },
};

export class PruebaEscala {
  constructor(notas) {
    this.esperadas = notas;
    this.reiniciar();
  }

  reiniciar() {
    this.estado = this.esperadas.map(() => 'pendiente'); // pendiente | ok | omitida
    this.desajustes = this.esperadas.map(() => null);
    this.falladas = []; // {midi, posicion}
    this.i = 0;
  }

  get terminada() {
    return this.i >= this.esperadas.length;
  }

  /** @returns {{resultado:'ok'|'fallada'|'ignorada', posicion:number}} */
  registrar(midi, desajuste = null) {
    if (this.terminada) return { resultado: 'ignorada', posicion: -1 };
    const e = this.esperadas;
    if (midi === e[this.i]) {
      this.estado[this.i] = 'ok';
      this.desajustes[this.i] = desajuste;
      return { resultado: 'ok', posicion: this.i++ };
    }
    if (this.i + 1 < e.length && midi === e[this.i + 1]) {
      this.estado[this.i] = 'omitida';
      this.estado[this.i + 1] = 'ok';
      this.desajustes[this.i + 1] = desajuste;
      this.i += 2;
      return { resultado: 'ok', posicion: this.i - 1 };
    }
    this.falladas.push({ midi, posicion: this.i });
    return { resultado: 'fallada', posicion: this.i };
  }

  resumen() {
    const ok = this.estado.filter((s) => s === 'ok').length;
    const omitidas = this.estado.filter((s) => s === 'omitida').length;
    const d = this.desajustes.filter((x) => x != null);
    const media = d.length ? d.reduce((a, b) => a + b, 0) / d.length : null;
    const absoluta = d.length ? d.reduce((a, b) => a + Math.abs(b), 0) / d.length : null;
    return { total: this.esperadas.length, ok, omitidas, falladas: this.falladas.length, desajusteMedio: media, desajusteAbsoluto: absoluta };
  }
}
