// Control de gasto de la API de Claude.
//
// Cada respuesta de la API trae `usage` con los tokens usados. Aquí se convierten a dólares
// con el precio de cada modelo y se acumulan por sesión y por mes. Más adelante (fase 6)
// el Apps Script los apuntará también en la pestaña «Gasto» del Sheet.
//
// Precios en dólares por millón de tokens (tarifa de la API de Anthropic, noviembre 2026).
// Revisarlos de vez en cuando en https://platform.claude.com/docs/en/about-claude/pricing

export const PRECIOS = {
  'claude-haiku-5-5': {
    entrada: 0.1,
    salida: 0.5,
    // Por encima de 100 000 tokens de prompt el precio sube.
    largo: { umbral: 100_000, entrada: 0.5, salida: 2.5 },
  },
  'claude-sonnet-5-5': {
    entrada: 2,
    salida: 10,
    lecturaCache: 0.2,
  },
};

// Si un modelo no da precio de caché, se usa la regla habitual de Anthropic:
// leer de caché cuesta el 10 % de la entrada y escribir en caché, el 125 %.
const FACTOR_LECTURA_CACHE = 0.1;
const FACTOR_ESCRITURA_CACHE = 1.25;

/**
 * Coste en dólares de una llamada.
 * @param {string} modelo  p. ej. 'claude-haiku-5-5'
 * @param {{input_tokens?:number, output_tokens?:number, cache_read_input_tokens?:number, cache_creation_input_tokens?:number}} uso
 */
export function costeLlamada(modelo, uso = {}) {
  const p = PRECIOS[modelo];
  if (!p) throw new Error(`No sé el precio de ${modelo}`);
  const entrada = uso.input_tokens ?? 0;
  const salida = uso.output_tokens ?? 0;
  const lectura = uso.cache_read_input_tokens ?? 0;
  const escritura = uso.cache_creation_input_tokens ?? 0;
  const prompt = entrada + lectura + escritura;
  const tarifa = p.largo && prompt > p.largo.umbral ? { ...p, ...p.largo } : p;
  const precioLectura = tarifa.lecturaCache ?? tarifa.entrada * FACTOR_LECTURA_CACHE;
  const precioEscritura = tarifa.escrituraCache ?? tarifa.entrada * FACTOR_ESCRITURA_CACHE;
  return (
    (entrada * tarifa.entrada + salida * tarifa.salida + lectura * precioLectura + escritura * precioEscritura) / 1e6
  );
}

const CLAVE = 'pianobot.gasto';

export const mesDe = (fecha = new Date()) =>
  `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;

export class ContadorGasto extends EventTarget {
  /** @param {Storage|null} almacen  localStorage o similar; null para no guardar nada */
  constructor(almacen = globalThis.localStorage ?? null) {
    super();
    this.almacen = almacen;
    this.sesion = 0;
    this.llamadasSesion = 0;
    this.datos = this.#leer();
  }

  #leer() {
    try {
      const d = JSON.parse(this.almacen?.getItem(CLAVE) ?? 'null');
      if (d && typeof d === 'object') return { tope: 5, meses: {}, ...d };
    } catch {}
    return { tope: 5, meses: {} };
  }

  #guardar() {
    try {
      this.almacen?.setItem(CLAVE, JSON.stringify(this.datos));
    } catch {}
  }

  /** Apunta una llamada y devuelve su coste. */
  registrar(modelo, uso, fecha = new Date()) {
    const coste = costeLlamada(modelo, uso);
    const mes = mesDe(fecha);
    const m = (this.datos.meses[mes] ??= { total: 0, llamadas: 0, porModelo: {} });
    m.total += coste;
    m.llamadas += 1;
    m.porModelo[modelo] = (m.porModelo[modelo] ?? 0) + coste;
    this.sesion += coste;
    this.llamadasSesion += 1;
    this.#guardar();
    this.dispatchEvent(new CustomEvent('cambio', { detail: { coste, modelo } }));
    return coste;
  }

  totalMes(fecha = new Date()) {
    return this.datos.meses[mesDe(fecha)]?.total ?? 0;
  }

  get tope() {
    return this.datos.tope;
  }

  set tope(dolares) {
    this.datos.tope = Math.max(0, Number(dolares) || 0);
    this.#guardar();
    this.dispatchEvent(new CustomEvent('cambio'));
  }

  /** 'ok' | 'cerca' (≥ 80 % del tope) | 'pasado' */
  estado(fecha = new Date()) {
    const t = this.tope;
    if (!t) return 'ok';
    const m = this.totalMes(fecha);
    if (m >= t) return 'pasado';
    if (m >= 0.8 * t) return 'cerca';
    return 'ok';
  }

  nuevaSesion() {
    this.sesion = 0;
    this.llamadasSesion = 0;
    this.dispatchEvent(new CustomEvent('cambio'));
  }
}

/** $0.0042 · $0.31 · $12.40 */
export function formatoDolares(x) {
  if (x === 0) return '$0.00';
  if (x < 0.01) return `$${x.toFixed(4)}`;
  if (x < 1) return `$${x.toFixed(3)}`;
  return `$${x.toFixed(2)}`;
}
