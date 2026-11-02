// La partitura en pantalla: pinta un fragmento de la pieza (del compás n al m) con
// OpenSheetMusicDisplay (OSMD) y marca con un cursor el compás en el que vas.
// OSMD se carga como script clásico (js/vendor) y queda en window.opensheetmusicdisplay.

export class Partitura extends EventTarget {
  /** @param {HTMLElement} contenedor */
  constructor(contenedor) {
    super();
    this.contenedor = contenedor;
    this.osmd = null;
    this.desde = 1;
    this.hasta = 4;
    this.compas = 1; // el compás marcado por el cursor
    this.zoom = 1;
  }

  get numCompases() {
    return this.osmd?.Sheet?.SourceMeasures.length ?? 0;
  }

  async cargar(url) {
    const OSMD = window.opensheetmusicdisplay;
    if (!OSMD) throw new Error('No se ha cargado OpenSheetMusicDisplay');
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(`No se ha podido descargar la partitura (${respuesta.status})`);
    const xml = await respuesta.text();

    this.osmd = new OSMD.OpenSheetMusicDisplay(this.contenedor, {
      backend: 'svg',
      autoResize: true,
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: false,
      drawMeasureNumbers: true,
      measureNumberInterval: 1,
      useXMLMeasureNumbers: true,
      followCursor: false,
      cursorsOptions: [{ type: OSMD.CursorType.CurrentArea, color: '#e0775e', alpha: 0.18, follow: false }],
    });
    await this.osmd.load(xml);
    this.dispatchEvent(new CustomEvent('cargada', { detail: { compases: this.numCompases } }));
  }

  /** Enseña solo los compases del `desde` al `hasta` (ambos incluidos) y pone el cursor en el primero. */
  mostrar(desde, hasta) {
    const n = this.numCompases;
    desde = Math.max(1, Math.min(n, Math.round(desde)));
    hasta = Math.max(desde, Math.min(n, Math.round(hasta)));
    this.desde = desde;
    this.hasta = hasta;
    this.osmd.setOptions({ drawFromMeasureNumber: desde, drawUpToMeasureNumber: hasta });
    this.osmd.zoom = this.zoom;
    this.osmd.render();
    this.irACompas(desde);
    this.dispatchEvent(new CustomEvent('fragmento', { detail: { desde, hasta } }));
  }

  ponerZoom(zoom) {
    this.zoom = Math.max(0.5, Math.min(2.5, zoom));
    if (this.osmd) this.mostrar(this.desde, this.hasta);
  }

  /** Mueve el cursor al principio de un compás del fragmento. */
  irACompas(numero) {
    numero = Math.max(this.desde, Math.min(this.hasta, numero));
    const cursor = this.osmd.cursor;
    cursor.show();
    cursor.reset();
    while (!cursor.iterator.EndReached && cursor.iterator.CurrentMeasureIndex < numero - 1) cursor.next();
    cursor.update();
    this.compas = numero;
    this.dispatchEvent(new CustomEvent('compas', { detail: { compas: numero } }));
  }

  /** Números de los compases que hay pintados ahora mismo (para comprobar el fragmento). */
  compasesPintados() {
    const numeros = new Set();
    for (const pagina of this.osmd.GraphicSheet.MusicPages) {
      for (const sistema of pagina.MusicSystems) {
        for (const m of sistema.StaffLines[0].Measures) numeros.add(m.MeasureNumber);
      }
    }
    return [...numeros].sort((a, b) => a - b);
  }
}
