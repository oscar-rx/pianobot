// FFT compleja radix-2, in situ. re e im tienen la misma longitud, potencia de 2.
// Dirección directa: X_k = Σ x_n · e^{-2πi·kn/N}

const tablas = new Map();

function obtenerTablas(n) {
  let t = tablas.get(n);
  if (t) return t;
  const bits = Math.round(Math.log2(n));
  if (1 << bits !== n) throw new Error(`El tamaño de la FFT debe ser potencia de 2 (recibido ${n})`);
  const inv = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
    inv[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sen = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sen[k] = Math.sin((2 * Math.PI * k) / n);
  }
  t = { inv, cos, sen };
  tablas.set(n, t);
  return t;
}

export function fft(re, im) {
  const n = re.length;
  const { inv, cos, sen } = obtenerTablas(n);
  for (let i = 0; i < n; i++) {
    const j = inv[i];
    if (j > i) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let tam = 2; tam <= n; tam <<= 1) {
    const mitad = tam >> 1;
    const paso = n / tam;
    for (let i = 0; i < n; i += tam) {
      for (let j = 0, k = 0; j < mitad; j++, k += paso) {
        const a = i + j;
        const b = a + mitad;
        const c = cos[k];
        const s = sen[k];
        const tr = re[b] * c + im[b] * s;
        const ti = im[b] * c - re[b] * s;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

export function siguientePotenciaDe2(x) {
  let n = 1;
  while (n < x) n <<= 1;
  return n;
}
