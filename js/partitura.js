// La partitura en pantalla: pinta un fragmento de la pieza (del compás n al m) con
// OpenSheetMusicDisplay (OSMD). Dos cursores: uno sombrea el compás en el que vas y otro, una línea roja
// fina, sigue la nota por la que vas mientras tocas. La hoja tiene su propio scroll y se mueve compás a compás:
//  - vista «una línea»: todo el fragmento en un solo pentagrama que se desplaza en horizontal; el compás que
//    tocas queda siempre a la izquierda y a la derecha se ven los siguientes;
//  - vista «páginas»: en cada compás nuevo, su línea se coloca arriba y la siguiente queda a la vista debajo.
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
    this.unaLinea = true; // vista «una línea» (true) o «páginas» (false)
  }

  get numCompases() {
    return this.osmd?.Sheet?.SourceMeasures.length ?? 0;
  }

  /** @param {string} xml  el MusicXML como texto */
  async cargar(xml) {
    const OSMD = window.opensheetmusicdisplay;
    if (!OSMD) throw new Error('No se ha cargado OpenSheetMusicDisplay');
    this.contenedor.replaceChildren();
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
      cursorsOptions: [
        { type: OSMD.CursorType.CurrentArea, color: '#e0775e', alpha: 0.18, follow: false },
        { type: OSMD.CursorType.ThinLeft, color: '#d1301f', alpha: 1, follow: false },
      ],
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
    this.osmd.setOptions({ drawFromMeasureNumber: desde, drawUpToMeasureNumber: hasta, renderSingleHorizontalStaffline: this.unaLinea });
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
  irACompas(numero, { desplazar = true } = {}) {
    numero = Math.max(this.desde, Math.min(this.hasta, numero));
    const cursor = this.osmd.cursors[0];
    cursor.show();
    cursor.reset();
    while (!cursor.iterator.EndReached && cursor.iterator.CurrentMeasureIndex < numero - 1) cursor.next();
    cursor.update();
    this.compas = numero;
    if (desplazar) this.#encuadrarCompas(cursor.cursorElement);
    this.dispatchEvent(new CustomEvent('compas', { detail: { compas: numero } }));
  }

  /**
   * Pone la línea roja en un momento de la pieza (en negras desde el principio) y baja la hoja si hace falta.
   * Avanza desde donde estaba (rápido mientras se toca) y solo vuelve al principio si hay que ir hacia atrás.
   */
  seguirA(negras) {
    const linea = this.osmd.cursors[1];
    if (!linea) return;
    const momento = () => linea.iterator.currentTimeStamp.RealValue * 4;
    if (linea.Hidden || momento() > negras + 1e-6) {
      linea.show();
      linea.reset();
    }
    while (!linea.iterator.EndReached && momento() < negras - 1e-6) linea.next();
    linea.update();
    this.#aLaVista(linea.cursorElement);
  }

  ocultarLinea() {
    this.osmd?.cursors[1]?.hide();
  }

  /**
   * Cabezal: una línea que avanza de forma CONTINUA (modo «Al tempo»). Se coloca en un momento cualquiera de la
   * pieza (en negras desde el principio): entre dos puntos pintados de la partitura (notas, silencios o el final
   * de un compás), avanza en proporción al tiempo, con la anchura real de cada compás. Devuelve el elemento.
   */
  moverCabezal(negras) {
    const puntos = this.#lineaDeTiempo();
    if (!puntos.length) return null;
    let i = puntos.findLastIndex((p) => p.pos <= negras);
    if (i < 0) i = 0;
    const a = puntos[i];
    const b = puntos[i + 1];
    let x = a.x;
    if (b && b.sistema === a.sistema && b.pos > a.pos) x = a.x + ((Math.min(negras, b.pos) - a.pos) / (b.pos - a.pos)) * (b.x - a.x);
    let el = this.contenedor.querySelector(':scope > .cabezal');
    if (!el) {
      el = document.createElement('div');
      el.className = 'cabezal';
      this.contenedor.append(el);
    }
    el.hidden = false;
    el.style.transform = `translate(${x}px, ${a.top}px)`;
    el.style.height = `${a.bottom - a.top}px`;
    this.#aLaVista(el);
    return el;
  }

  ocultarCabezal() {
    const el = this.contenedor.querySelector(':scope > .cabezal');
    if (el) el.hidden = true;
  }

  /**
   * Puntos de la línea de tiempo del fragmento pintado: {pos (negras desde el principio), x, top, bottom, sistema},
   * en píxeles dentro de la hoja. 1 unidad de OSMD = 10 px × zoom, contando desde la esquina del SVG.
   */
  #lineaDeTiempo() {
    const svg = this.contenedor.querySelector('svg');
    if (!svg || !this.osmd?.GraphicSheet) return [];
    const hoja = this.contenedor;
    const rh = hoja.getBoundingClientRect();
    const rs = svg.getBoundingClientRect();
    const ox = rs.left - rh.left + hoja.scrollLeft;
    const oy = rs.top - rh.top + hoja.scrollTop;
    const f = 10 * this.osmd.zoom;
    const puntos = [];
    for (const fila of this.osmd.GraphicSheet.MeasureList) {
      const gm = fila?.find(Boolean);
      const sistema = gm?.ParentMusicSystem;
      if (!gm || !sistema || gm.MeasureNumber < this.desde || gm.MeasureNumber > this.hasta) continue;
      const y0 = sistema.PositionAndShape.AbsolutePosition.y;
      const top = oy + (y0 + sistema.StaffLines[0].PositionAndShape.RelativePosition.y) * f - 8;
      const bottom = oy + (y0 + sistema.StaffLines.at(-1).PositionAndShape.RelativePosition.y + 4) * f + 8;
      const inicio = gm.parentSourceMeasure.AbsoluteTimestamp.RealValue * 4;
      const duracion = gm.parentSourceMeasure.Duration.RealValue * 4;
      // Un punto por cada momento del compás en que empieza algo (nota o silencio, en cualquier pentagrama)
      const porMomento = new Map();
      for (const compas of fila) {
        if (!compas) continue;
        for (const entrada of compas.staffEntries) {
          const rel = entrada.relInMeasureTimestamp.RealValue * 4;
          const x = ox + entrada.PositionAndShape.AbsolutePosition.x * f;
          if (!porMomento.has(rel) || x < porMomento.get(rel)) porMomento.set(rel, x);
        }
      }
      for (const [rel, x] of porMomento) puntos.push({ pos: inicio + rel, x, top, bottom, sistema });
      // Final del compás: su barra de la derecha
      puntos.push({ pos: inicio + duracion, x: ox + (gm.PositionAndShape.AbsolutePosition.x + gm.PositionAndShape.BorderRight) * f, top, bottom, sistema, fin: true });
    }
    puntos.sort((a, b) => a.pos - b.pos || (b.fin ? 1 : 0) - (a.fin ? 1 : 0));
    // Entre compases de la misma línea se va de la última nota a la primera del siguiente (pasando la barra)
    return puntos.filter((p, k) => !(p.fin && puntos[k + 1] && puntos[k + 1].pos === p.pos && puntos[k + 1].sistema === p.sistema));
  }

  /**
   * Coloca el compás actual (su cursor sombreado) siempre en el mismo sitio, para no mover la mirada:
   * en «una línea», a la izquierda (con un trocito del anterior); en «páginas», su línea arriba del todo.
   */
  #encuadrarCompas(el) {
    if (!el || el.style.display === 'none') return;
    const hoja = this.contenedor;
    const r = el.getBoundingClientRect();
    const h = hoja.getBoundingClientRect();
    if (this.unaLinea) {
      hoja.scrollTo({ left: Math.max(0, hoja.scrollLeft + (r.left - h.left) - 0.06 * hoja.clientWidth) });
    } else if (hoja.scrollHeight > hoja.clientHeight + 2) {
      // La línea (sistema) del compás, con todo lo que sobresale del pentagrama, arriba de la hoja
      const linea = this.#cajaSistema(this.compas) ?? r;
      const arriba = Math.min(linea.top, r.top);
      let objetivo = hoja.scrollTop + (arriba - h.top) - 12;
      // Si el compás siguiente está en la línea de abajo y no cabría, se sube lo justo para que asome
      // (sin tapar el compás actual): así se ve lo que viene antes de llegar.
      const siguiente = this.#cajaSistema(this.compas + 1);
      if (siguiente && siguiente.top > r.bottom) {
        const fondo = hoja.scrollTop + (siguiente.bottom - h.top) + 12 - hoja.clientHeight;
        if (fondo > objetivo) objetivo = Math.min(fondo, hoja.scrollTop + (r.top - h.top) - 4);
      }
      hoja.scrollTo({ top: Math.max(0, objetivo) });
    }
    this.#aLaVista(el);
  }

  /**
   * Caja (en pantalla) que ocupan las notas pintadas de la línea (sistema) en la que está un compás,
   * o null si el compás no está en el fragmento.
   */
  #cajaSistema(numero) {
    const notas = [...this.notasPintadas()];
    const sistemaDe = (g) => g.parentVoiceEntry?.parentStaffEntry?.parentMeasure?.ParentMusicSystem;
    const delCompas = notas.find((g) => g.sourceNote.SourceMeasure.MeasureNumberXML === numero);
    if (!delCompas) return null;
    const sistema = sistemaDe(delCompas);
    const cajas = notas
      .filter((g) => (sistema ? sistemaDe(g) === sistema : g.sourceNote.SourceMeasure.MeasureNumberXML === numero))
      .map((g) => g.getSVGGElement?.()?.getBoundingClientRect())
      .filter(Boolean);
    if (!cajas.length) return null;
    return {
      top: Math.min(...cajas.map((c) => c.top)),
      bottom: Math.max(...cajas.map((c) => c.bottom)),
      left: Math.min(...cajas.map((c) => c.left)),
      right: Math.max(...cajas.map((c) => c.right)),
    };
  }

  /**
   * Si el cursor no se ve, mueve la hoja (o la página) lo justo para verlo.
   * «Se ve» de verdad: dentro de la hoja y dentro de la pantalla (la hoja puede no caber entera).
   */
  #aLaVista(el) {
    if (!el || el.style.display === 'none') return;
    const hoja = this.contenedor;
    const r = el.getBoundingClientRect();
    const h = hoja.getBoundingClientRect();
    // En horizontal (vista «una línea»): que no se salga por la derecha ni por la izquierda
    if (r.right > h.right || r.left < h.left) {
      hoja.scrollTo({ left: Math.max(0, hoja.scrollLeft + (r.left - h.left) - 0.06 * hoja.clientWidth) });
    }
    const arriba = Math.max(h.top, 0);
    const abajo = Math.min(h.bottom, window.innerHeight);
    if (r.top >= arriba && r.bottom <= abajo) return;
    if (!this.unaLinea && hoja.scrollHeight > hoja.clientHeight + 2) {
      // Scroll de la propia hoja: el sistema del cursor arriba del todo
      hoja.scrollTo({ top: Math.max(0, hoja.scrollTop + (r.top - h.top) - 16) });
      if (h.top >= 0 && h.top + 16 + r.height <= window.innerHeight) return;
    }
    // La hoja no cabe en la pantalla (o no tiene scroll propio): se mueve la página
    window.scrollBy({ top: (hoja.scrollHeight > hoja.clientHeight + 2 ? h.top : r.top) - 12 });
  }

  /**
   * Colorea las notas según un estado: estadoDe(graphicalNote) → 'bien' | 'fallada' | 'omitida' | undefined.
   * Usa las clases nota-bien, nota-fallada y nota-omitida.
   */
  pintarEstados(estadoDe) {
    const clases = ['nota-bien', 'nota-fallada', 'nota-omitida'];
    for (const nota of this.notasPintadas()) {
      const g = nota.getSVGGElement?.();
      if (!g) continue;
      const estado = estadoDe(nota);
      for (const c of clases) g.classList.toggle(c, c === `nota-${estado}`);
    }
  }

  /** Vuelve a cargar la partitura (p. ej. con digitación nueva) sin perder fragmento ni cursor. */
  async recargar(xml) {
    const compas = this.compas;
    await this.osmd.load(xml);
    this.mostrar(this.desde, this.hasta);
    this.irACompas(compas);
  }

  /** Todas las notas pintadas (GraphicalNote de OSMD). */
  *notasPintadas() {
    for (const fila of this.osmd.GraphicSheet.MeasureList) {
      for (const compas of fila) {
        if (!compas) continue;
        for (const entrada of compas.staffEntries) {
          for (const voz of entrada.graphicalVoiceEntries) yield* voz.notes;
        }
      }
    }
  }

  /** La nota pintada más cercana a un punto de la pantalla (coordenadas de un evento), o null. */
  notaEn(x, y) {
    const OSMD = window.opensheetmusicdisplay;
    const hoja = this.osmd.GraphicSheet;
    const punto = hoja.svgToOsmd(hoja.domToSvg(new OSMD.PointF2D(x, y)));
    // Margen de unas 3 × 5 unidades de OSMD (≈ 30 × 50 px a tamaño normal): basta con tocar cerca.
    return hoja.GetNearestNote(punto, new OSMD.PointF2D(3, 5)) ?? null;
  }

  /** Marca en el SVG las notas que cumplan `elegir(nota)` con una clase CSS (quitándola de las demás). */
  marcar(clase, elegir) {
    for (const el of this.contenedor.querySelectorAll(`.${clase}`)) el.classList.remove(clase);
    for (const nota of this.notasPintadas()) {
      if (elegir(nota)) nota.getSVGGElement?.()?.classList.add(clase);
    }
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
