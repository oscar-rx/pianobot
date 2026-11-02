// pianobot · fases 1 y 2: oír y ver. Une el piano (MIDI), la partitura, el metrónomo, el registro de notas,
// la prueba de escala y el gasto.

import { activarAudio, ahoraSonando, contextoAudio } from './audio.js';
import { Metronomo, SONIDOS } from './metronomo.js';
import { EntradaMidi } from './entradas/midi.js';
import { nombreNota, nombreIngles } from './notas.js';
import { PruebaEscala, ESCALAS } from './prueba-escala.js';
import { ContadorGasto, formatoDolares, mesDe } from './gasto.js';
import { Partitura } from './partitura.js';
import { Servidor } from './servidor.js';
import { indexarNotas, claveOsmd, dedoDe, ponerDedo, siguienteNota, leerXml, escribirXml } from './digitacion.js';
import { esperadasDelFragmento, compasesDelFragmento, alinear, analizar } from './comparar.js';
import { GrabadorIntentos } from './intento.js';
import { PracticaAlTempo } from './al-tempo.js';

const $ = (id) => document.getElementById(id);

// ---------- Ajustes guardados ----------
const CLAVE_AJUSTES = 'pianobot.ajustes';
const ajustes = {
  ppm: 60,
  compas: 4,
  subdivision: 1,
  volumen: 0.7,
  sonido: 'madera',
  escala: 'la-menor',
  mano: 'ambas', // qué mano se corrige: ambas, derecha o izquierda
  retrasoMs: 0,
  pieza: null, // id de la pieza (pestaña «Piezas» del Sheet); null = la primera
  fragmentos: {}, // id de la pieza → {desde, hasta}: cada pieza recuerda su fragmento
  vista: 'linea', // 'linea' (un solo pentagrama que se desplaza compás a compás) o 'paginas'
  zoom: 1,
};
try {
  const guardados = JSON.parse(localStorage.getItem(CLAVE_AJUSTES) || '{}');
  // Versiones anteriores guardaban un retraso por fuente (micro, cable, pantalla): se queda el del cable.
  if (guardados.retrasoMs && typeof guardados.retrasoMs === 'object') guardados.retrasoMs = guardados.retrasoMs.midi ?? 0;
  delete guardados.fuente;
  delete guardados.fragmento; // antes había un solo fragmento para todas las piezas
  delete guardados.sensibilidad;
  Object.assign(ajustes, guardados);
} catch {}
const guardar = () => {
  try {
    localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(ajustes));
  } catch {}
};

// ---------- Estado ----------
const metronomo = new Metronomo();
metronomo.ppm = ajustes.ppm;
metronomo.pulsosPorCompas = ajustes.compas;
metronomo.volumen = ajustes.volumen;
metronomo.sonido = SONIDOS[ajustes.sonido] ? ajustes.sonido : 'madera';

const gasto = new ContadorGasto();
let entrada = null; // el piano, mientras se escucha
let origen = null; // tiempo (reloj de audio) de la primera nota, para mostrar momentos relativos
let prueba = new PruebaEscala(ESCALAS[ajustes.escala]?.notas ?? ESCALAS['la-menor'].notas);
let calibrando = null; // {desajustes: []}
const filasActivas = new Map(); // midi → {fila, inicio}
const pulsadas = new Set(); // las teclas que suenan ahora, para ver acordes
let cuentaNotas = 0;
let ultimoAtaque = null; // momento del último noteon, para reconocer acordes
let bloqueoPantalla = null;

async function empezar() {
  await activarAudio();
  detenerEntrada();
  entrada = new EntradaMidi();
  entrada.ajusteMs = ajustes.retrasoMs;
  entrada.addEventListener('estado', (e) => ponerEstado(e.detail.texto, e.detail.ok));
  entrada.addEventListener('nota', (e) => {
    alRecibirNota(e.detail);
    grabador.nota(e.detail);
    if (practica) aplicarAlTempo(practica.nota(e.detail));
  });
  entrada.addEventListener('pedal', (e) => {
    $('pedal').hidden = !e.detail.pisado;
    grabador.pedalCambia(e.detail);
  });
  $('empezar').textContent = 'Parar';
  $('empezar').classList.replace('primario', 'secundario');
  try {
    await entrada.iniciar();
  } catch (err) {
    console.error(err);
    if (err?.name === 'NotAllowedError') ponerEstado('No hay permiso para el MIDI. Actívalo en el candado de la barra de direcciones.', false);
    else if (!$('estado-texto').textContent.includes('navegador')) ponerEstado(`No se ha podido empezar: ${err.message}`, false);
    detenerEntrada();
    return;
  }
  try {
    bloqueoPantalla = await navigator.wakeLock?.request('screen');
  } catch {}
}

function detenerEntrada() {
  entrada?.detener();
  entrada = null;
  pulsadas.clear();
  $('pedal').hidden = true;
  bloqueoPantalla?.release?.().catch(() => {});
  bloqueoPantalla = null;
  $('empezar').textContent = 'Empezar';
  $('empezar').classList.replace('secundario', 'primario');
}

$('empezar').addEventListener('click', async () => {
  if (entrada) {
    detenerEntrada();
    ponerEstado('Parado.', false);
  } else await empezar();
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && entrada && !bloqueoPantalla) {
    try {
      bloqueoPantalla = await navigator.wakeLock?.request('screen');
    } catch {}
  }
});

function ponerEstado(texto, ok) {
  $('estado-texto').textContent = texto;
  $('estado-punto').classList.toggle('ok', !!ok);
}

// ---------- Notas ----------
// La nota grande enseña todas las teclas que suenan a la vez (un acorde, las dos manos).
// Al soltar, se queda lo último que sonó hasta la siguiente nota.
function pintarNotaGrande(destello) {
  if (!pulsadas.size) return;
  const midis = [...pulsadas].sort((a, b) => a - b);
  const grande = $('nota-actual');
  grande.textContent = midis.map(nombreNota).join(' ');
  grande.dataset.cuantas = Math.min(midis.length, 4);
  let sub = midis.map(nombreIngles).join(' ');
  if (midis.length > 1) sub += ` · ${midis.length} notas`;
  $('nota-sub').textContent = sub;
  if (destello) {
    grande.classList.remove('destello');
    void grande.offsetWidth;
    grande.classList.add('destello');
  }
}

function alRecibirNota(n) {
  if (n.tipo === 'noteoff') {
    pulsadas.delete(n.midi);
    const a = filasActivas.get(n.midi);
    if (a) {
      a.celdaDura.textContent = `${Math.round((n.tiempo - a.inicio) * 1000)} ms`;
      filasActivas.delete(n.midi);
    }
    return;
  }

  if (origen == null) origen = n.tiempo;
  const desajuste = metronomo.sonando || metronomo.pulsos.length ? metronomo.desajuste(n.tiempo, ajustes.subdivision) : null;

  // Nota grande: si no queda nada pulsado, empieza un grupo nuevo
  pulsadas.add(n.midi);
  pintarNotaGrande(true);

  // Registro
  const fila = document.createElement('tr');
  const momento = n.tiempo - origen;
  const celdaDura = document.createElement('td');
  celdaDura.className = 'num tenue';
  celdaDura.textContent = '…';
  fila.append(
    celda(momento.toFixed(3) + ' s', 'num tenue'),
    celda(nombreNota(n.midi), 'nota'),
    celdaFuerza(n.velocidad),
    celdaDura,
    celdaDesajuste(desajuste),
  );
  $('registro').prepend(fila);
  while ($('registro').children.length > 300) $('registro').lastElementChild.remove();
  filasActivas.set(n.midi, { celdaDura, inicio: n.tiempo });
  cuentaNotas++;
  $('registro-cuenta').textContent = cuentaNotas;

  // Prueba de escala. Las notas que llegan casi a la vez que la anterior son un acorde: no cuentan.
  const enAcorde = ultimoAtaque != null && n.tiempo - ultimoAtaque < 0.05;
  ultimoAtaque = n.tiempo;
  if (!calibrando && !enAcorde) {
    prueba.registrar(n.midi, desajuste);
    pintarEscala();
  }

  // Calibración
  if (calibrando && desajuste != null) {
    calibrando.desajustes.push(desajuste);
    const faltan = 8 - calibrando.desajustes.length;
    if (faltan > 0) $('calibrar-texto').textContent = `Calibrando… ${faltan} más.`;
    else terminarCalibracion();
  }
}

function celda(texto, clase) {
  const td = document.createElement('td');
  td.textContent = texto;
  if (clase) td.className = clase;
  return td;
}

function celdaFuerza(v) {
  const td = document.createElement('td');
  td.className = 'fuerza';
  const barra = document.createElement('span');
  barra.className = 'barrita';
  barra.style.setProperty('--v', v / 127);
  td.append(barra, document.createTextNode(` ${v}`));
  td.title = 'Velocidad MIDI (1-127)';
  return td;
}

function celdaDesajuste(d) {
  const td = document.createElement('td');
  td.className = 'num';
  if (d == null) {
    td.textContent = '–';
    td.classList.add('tenue');
    return td;
  }
  const ms = Math.round(d * 1000);
  td.textContent = `${ms > 0 ? '+' : ''}${ms} ms`;
  td.classList.add(Math.abs(ms) <= 30 ? 'bien' : Math.abs(ms) <= 80 ? 'regular' : 'mal');
  td.title = ms < 0 ? 'Adelantada' : ms > 0 ? 'Retrasada' : 'En el pulso';
  return td;
}

$('registro-borrar').addEventListener('click', () => {
  $('registro').replaceChildren();
  filasActivas.clear();
  cuentaNotas = 0;
  origen = null;
  $('registro-cuenta').textContent = '0';
  $('nota-actual').textContent = '—';
  delete $('nota-actual').dataset.cuantas;
  $('nota-sub').innerHTML = '&nbsp;';
});

// ---------- Prueba de escala ----------
for (const [id, e] of Object.entries(ESCALAS)) {
  $('escala').append(new Option(e.nombre, id, false, id === ajustes.escala));
}
$('escala').addEventListener('change', () => {
  ajustes.escala = $('escala').value;
  guardar();
  prueba = new PruebaEscala(ESCALAS[ajustes.escala].notas);
  pintarEscala();
});
$('escala-reiniciar').addEventListener('click', () => {
  prueba.reiniciar();
  pintarEscala();
});

function pintarEscala() {
  const chips = prueba.esperadas.map((m, i) => {
    const s = document.createElement('span');
    s.className = `chip ${prueba.estado[i]}`;
    if (i === prueba.i) s.classList.add('siguiente');
    s.textContent = nombreNota(m).replace(/\d/, '');
    s.title = nombreNota(m);
    return s;
  });
  $('escala-chips').replaceChildren(...chips);
  const r = prueba.resumen();
  let texto;
  if (prueba.terminada) {
    texto = r.ok === r.total && !r.falladas ? '¡Entera! ' : '';
    texto += `${r.ok} de ${r.total} notas`;
    if (r.omitidas) texto += ` · ${r.omitidas} perdida${r.omitidas > 1 ? 's' : ''}`;
    if (r.falladas) texto += ` · ${r.falladas} de más o equivocada${r.falladas > 1 ? 's' : ''}`;
    if (r.desajusteMedio != null) {
      const m = Math.round(r.desajusteMedio * 1000);
      texto += ` · desajuste medio ${m > 0 ? '+' : ''}${m} ms (±${Math.round(r.desajusteAbsoluto * 1000)})`;
    }
  } else if (prueba.i === 0) {
    texto = 'Toca la escala subiendo y bajando. Mejor con el metrónomo a 60 y midiendo contra negras.';
  } else {
    texto = `Vas por la ${prueba.i + 1}.ª de ${r.total}` + (r.falladas ? ` · ${r.falladas} fallo${r.falladas > 1 ? 's' : ''}` : '');
  }
  $('escala-resumen').textContent = texto;
}

// ---------- Metrónomo ----------
function pintarMetronomo() {
  $('tempo-numero').textContent = metronomo.ppm;
  $('tempo').value = metronomo.ppm;
  $('compas').value = metronomo.pulsosPorCompas;
  $('subdivision').value = ajustes.subdivision;
  $('volumen').value = metronomo.volumen;
  $('sonido').value = metronomo.sonido;
  $('metro-boton').textContent = metronomo.sonando ? '■ Parar' : '▶ Arrancar';
  $('mini-tempo').textContent = metronomo.ppm;
  $('mini-metro').textContent = metronomo.sonando ? '♩ ■' : '♩ ▶';
  $('mini-metro').setAttribute('aria-pressed', String(metronomo.sonando));
  const puntos = [];
  for (let i = 0; i < metronomo.pulsosPorCompas; i++) {
    const p = document.createElement('span');
    p.className = i === 0 ? 'pulso acento' : 'pulso';
    puntos.push(p);
  }
  $('pulsos').replaceChildren(...puntos);
}

const cambiarTempo = (ppm) => {
  metronomo.ponerTempo(ppm);
  ajustes.ppm = metronomo.ppm;
  guardar();
  if (metronomo.sonando) {
    // reiniciar para que la rejilla de medida empiece en el tempo nuevo
    metronomo.parar();
    metronomo.arrancar();
  }
};
const bajarTempo = () => cambiarTempo(metronomo.ppm - (metronomo.ppm > 100 ? 4 : 2));
const subirTempo = () => cambiarTempo(metronomo.ppm + (metronomo.ppm >= 100 ? 4 : 2));
$('tempo-menos').addEventListener('click', bajarTempo);
$('tempo-mas').addEventListener('click', subirTempo);
// El mismo metrónomo, en pequeño, en la barra de la partitura
$('mini-menos').addEventListener('click', bajarTempo);
$('mini-mas').addEventListener('click', subirTempo);
$('mini-metro').addEventListener('click', async () => {
  await activarAudio();
  if (metronomo.sonando) metronomo.parar();
  else metronomo.arrancar();
});
$('tempo').addEventListener('input', () => {
  $('tempo-numero').textContent = $('tempo').value;
});
$('tempo').addEventListener('change', () => cambiarTempo(+$('tempo').value));
$('compas').addEventListener('change', () => {
  metronomo.pulsosPorCompas = +$('compas').value;
  ajustes.compas = metronomo.pulsosPorCompas;
  guardar();
  pintarMetronomo();
});
$('subdivision').addEventListener('change', () => {
  ajustes.subdivision = +$('subdivision').value;
  guardar();
});
for (const [id, s] of Object.entries(SONIDOS)) $('sonido').append(new Option(s.nombre, id));
$('sonido').addEventListener('change', async () => {
  metronomo.sonido = $('sonido').value;
  ajustes.sonido = metronomo.sonido;
  guardar();
  await activarAudio();
  if (!metronomo.sonando) metronomo.probar();
});
$('volumen').addEventListener('input', () => {
  metronomo.volumen = +$('volumen').value;
  ajustes.volumen = metronomo.volumen;
  guardar();
});
$('metro-boton').addEventListener('click', async () => {
  await activarAudio();
  if (metronomo.sonando) metronomo.parar();
  else metronomo.arrancar();
});
metronomo.addEventListener('cambio', pintarMetronomo);

// ---------- Calibración del retraso ----------
$('calibrar').addEventListener('click', async () => {
  if (!entrada) {
    $('calibrar-texto').textContent = 'Primero pulsa Empezar.';
    return;
  }
  await activarAudio();
  if (!metronomo.sonando) metronomo.arrancar();
  calibrando = { desajustes: [] };
  $('calibrar-texto').textContent = 'Toca una nota justo con cada clic. Faltan 8.';
});

function terminarCalibracion() {
  const d = [...calibrando.desajustes].sort((a, b) => a - b);
  const mediana = (d[3] + d[4]) / 2;
  ajustes.retrasoMs = Math.round(ajustes.retrasoMs + mediana * 1000);
  if (entrada) entrada.ajusteMs = ajustes.retrasoMs;
  guardar();
  calibrando = null;
  $('calibrar-texto').textContent = `Hecho: retraso corregido ${ajustes.retrasoMs} ms.`;
}

// ---------- Gasto ----------
function pintarGasto() {
  $('gasto-sesion').textContent = formatoDolares(gasto.sesion);
  $('gasto-mes').textContent = formatoDolares(gasto.totalMes());
  const estado = gasto.estado();
  $('gasto').dataset.estado = estado;
  const aviso = $('aviso-gasto');
  aviso.hidden = estado === 'ok';
  if (estado === 'cerca') aviso.textContent = `Este mes llevas ${formatoDolares(gasto.totalMes())} de la API: cerca de tu tope de ${formatoDolares(gasto.tope)}.`;
  if (estado === 'pasado') aviso.textContent = `Este mes llevas ${formatoDolares(gasto.totalMes())} de la API: has pasado tu tope de ${formatoDolares(gasto.tope)}.`;
}
gasto.addEventListener('cambio', pintarGasto);
$('gasto').addEventListener('click', () => {
  const mes = gasto.datos.meses[mesDe()];
  const filas = [
    ['Esta sesión', `${formatoDolares(gasto.sesion)} · ${gasto.llamadasSesion} llamadas`],
    ['Este mes', `${formatoDolares(gasto.totalMes())} · ${mes?.llamadas ?? 0} llamadas`],
    ...Object.entries(mes?.porModelo ?? {}).map(([m, c]) => [`  ${m}`, formatoDolares(c)]),
  ];
  $('gasto-desglose').replaceChildren(
    ...filas.flatMap(([k, v]) => [Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v })]),
  );
  $('gasto-tope').value = gasto.tope;
  $('gasto-sin-llamadas').hidden = (mes?.llamadas ?? 0) > 0;
  $('dialogo-gasto').showModal();
});
$('gasto-tope').addEventListener('change', () => {
  gasto.tope = $('gasto-tope').value;
});
// Para que la fase 4 (y las pruebas) puedan apuntar llamadas: window.pianobot.gasto.registrar(modelo, usage)
window.pianobot = { gasto, metronomo, get entrada() { return entrada; }, get partitura() { return partitura; }, get digitacion() { return dig; }, get ultimoIntento() { return ultimoIntento; }, get alTempo() { return practica; } };

// ---------- Bucle de dibujo: pulsos del metrónomo ----------
function dibujar() {
  requestAnimationFrame(dibujar);
  const c = contextoAudio();
  if (c.state === 'running' && metronomo.sonando) {
    const ahora = ahoraSonando(c);
    let actual = null;
    for (const p of metronomo.pulsos) if (p.tiempo <= ahora) actual = p;
    const puntos = $('pulsos').children;
    for (let i = 0; i < puntos.length; i++) {
      const encendido = actual && actual.numero % metronomo.pulsosPorCompas === i && ahora - actual.tiempo < 0.15;
      puntos[i].classList.toggle('encendido', !!encendido);
    }
  }
}

// ---------- Partitura ----------
const partitura = new Partitura($('partitura'));
partitura.zoom = ajustes.zoom;
partitura.unaLinea = ajustes.vista !== 'paginas';

function pintarVista() {
  $('vista').textContent = partitura.unaLinea ? '➡ Una línea' : '☰ Páginas';
  $('vista').title = partitura.unaLinea
    ? 'Ahora: una línea (se desplaza compás a compás). Pulsa para ver en páginas.'
    : 'Ahora: páginas. Pulsa para ver en una línea que se desplaza compás a compás.';
}
pintarVista();
$('vista').addEventListener('click', () => {
  partitura.unaLinea = !partitura.unaLinea;
  ajustes.vista = partitura.unaLinea ? 'linea' : 'paginas';
  guardar();
  pintarVista();
  if (partitura.osmd) verFragmento(partitura.desde, partitura.hasta);
});

function pintarFragmento() {
  $('frag-desde').value = partitura.desde;
  $('frag-hasta').value = partitura.hasta;
  $('frag-desde').max = $('frag-hasta').max = partitura.numCompases;
  $('frag-anterior').disabled = partitura.desde <= 1;
  $('frag-siguiente').disabled = partitura.hasta >= partitura.numCompases;
}

// La hoja de la partitura ocupa el espacio que queda en la pantalla cuando la tarjeta está arriba del todo
// (con la barra de controles a la vista), sea cual sea la tablet, y se recalcula al girarla.
function ajustarHoja() {
  const tarjeta = document.querySelector('.partitura');
  const hoja = $('partitura');
  if (hoja.hidden) return;
  const encima = hoja.getBoundingClientRect().top - tarjeta.getBoundingClientRect().top;
  hoja.style.maxHeight = `${Math.max(240, window.innerHeight - encima - 28)}px`;
}
window.addEventListener('resize', () => ajustarHoja());

/** Coloca la página con la tarjeta de la partitura arriba del todo (controles y hoja enteros a la vista). */
function encuadrarPartitura() {
  const tarjeta = document.querySelector('.partitura');
  const y = tarjeta.getBoundingClientRect().top + window.scrollY - 8;
  if (Math.abs(window.scrollY - y) > 4) window.scrollTo({ top: y });
}

function verFragmento(desde, hasta) {
  if (!partitura.osmd) return;
  grabador.activar(grabador.activo); // un intento a medias de otro fragmento no vale
  if (practica) pararAlTempo();
  partitura.mostrar(desde, hasta);
  ajustarHoja();
  if (piezaActual) ajustes.fragmentos[piezaActual.id] = { desde: partitura.desde, hasta: partitura.hasta };
  guardar();
  pintarFragmento();
}

partitura.addEventListener('compas', (e) => {
  $('cursor-compas').textContent = e.detail.compas;
  $('cursor-anterior').disabled = e.detail.compas <= partitura.desde;
  $('cursor-siguiente').disabled = e.detail.compas >= partitura.hasta;
});

// Al cambiar un número, el otro se ajusta para que el fragmento siga teniendo sentido.
$('frag-desde').addEventListener('change', () => {
  const desde = +$('frag-desde').value || 1;
  verFragmento(desde, Math.max(desde, partitura.hasta));
});
$('frag-hasta').addEventListener('change', () => {
  const hasta = +$('frag-hasta').value || partitura.hasta;
  verFragmento(Math.min(partitura.desde, hasta), hasta);
});
$('frag-anterior').addEventListener('click', () => {
  const largo = partitura.hasta - partitura.desde + 1;
  const desde = Math.max(1, partitura.desde - largo);
  verFragmento(desde, desde + largo - 1);
});
$('frag-siguiente').addEventListener('click', () => {
  const largo = partitura.hasta - partitura.desde + 1;
  const hasta = Math.min(partitura.numCompases, partitura.hasta + largo);
  verFragmento(hasta - largo + 1, hasta);
});
$('zoom-menos').addEventListener('click', () => cambiarZoom(-0.15));
$('zoom-mas').addEventListener('click', () => cambiarZoom(0.15));
function cambiarZoom(delta) {
  partitura.ponerZoom(Math.round((partitura.zoom + delta) * 100) / 100);
  ajustes.zoom = partitura.zoom;
  guardar();
}
$('cursor-anterior').addEventListener('click', () => partitura.irACompas(partitura.compas - 1));
$('cursor-siguiente').addEventListener('click', () => partitura.irACompas(partitura.compas + 1));

// La partitura sale de Google Drive (a través del Apps Script). Primero se enseña la copia guardada
// en la tablet, al instante, y luego se comprueba en Drive si hay algo nuevo.
const servidor = new Servidor();
let piezas = [];
let piezaActual = null;
let carga = 0; // cada carga tiene su número: si llega tarde (ya se ha elegido otra pieza), se ignora

const estadoPartitura = (texto) => {
  $('partitura-estado').textContent = texto;
};
const preferida = () => piezas.find((p) => p.id === ajustes.pieza) ?? piezas[0];

function pintarSelector() {
  $('pieza').replaceChildren(
    ...piezas.map((p) => new Option(p.compositor ? `${p.titulo} · ${p.compositor}` : p.titulo, p.id, false, p.id === piezaActual?.id)),
  );
  $('pieza').hidden = !piezas.length;
}

async function mostrarXml(xml) {
  prepararDigitacion(xml);
  await partitura.cargar(xml);
  const f = ajustes.fragmentos[piezaActual.id] ?? { desde: 1, hasta: 4 };
  verFragmento(f.desde, f.hasta);
}

/** Enseña una pieza: su copia de la tablet si la hay y, después, la versión de Drive si es distinta. */
async function abrirPieza(pieza, yaMostrado = null) {
  const esta = ++carga;
  piezaActual = pieza;
  ajustes.pieza = pieza.id;
  guardar();
  pintarSelector();
  let mostrado = yaMostrado;
  if (!mostrado) {
    const copia = servidor.copiaPartitura(pieza.id);
    if (copia) {
      try {
        await mostrarXml(copia);
        mostrado = copia;
      } catch (err) {
        console.warn(err);
      }
    }
  }
  if (esta !== carga) return;
  // Cambios hechos en la tablet que aún no llegaron a Drive: primero se suben; si no se puede,
  // se sigue con la copia de la tablet (no se pisa con la versión antigua de Drive).
  if (mostrado && servidor.pendiente(pieza.id)) {
    estadoPartitura('Subiendo a Drive los cambios guardados en la tablet…');
    try {
      await servidor.guardarPartitura(pieza.id, mostrado);
      indicarGuardado('guardado');
    } catch (err) {
      if (esta === carga) {
        estadoPartitura(`Cambios guardados en la tablet; aún no se han podido subir a Drive (${err.message})`);
        indicarGuardado('tablet', err.message);
      }
      return;
    }
    if (esta !== carga) return;
  }
  estadoPartitura(mostrado ? 'Comprobando Drive…' : 'Descargando la partitura de Drive…');
  try {
    const xml = await servidor.partitura(pieza.id);
    if (esta !== carga) return;
    if (xml !== mostrado) await mostrarXml(xml);
    $('conexion-punto').classList.add('ok');
    estadoPartitura(`${partitura.numCompases} compases`);
  } catch (err) {
    console.warn(err);
    if (esta !== carga) return;
    estadoPartitura(mostrado ? `Copia guardada en la tablet (Drive: ${err.message})` : `No se ha podido cargar la partitura: ${err.message}`);
  }
}

async function cargarPartitura() {
  $('sin-conexion').hidden = servidor.configurado;
  $('partitura').hidden = !servidor.configurado;
  $('anadir-pieza').hidden = !servidor.configurado;
  $('conexion-punto').classList.remove('ok');
  if (!servidor.configurado) {
    piezas = [];
    pintarSelector();
    estadoPartitura('Sin conectar con Drive');
    return;
  }

  // 1. Lo guardado en la tablet, al instante
  piezas = servidor.copiaPiezas() ?? [];
  let mostrado = null;
  const deCopia = preferida();
  const xmlCopia = deCopia && servidor.copiaPartitura(deCopia.id);
  if (xmlCopia) {
    piezaActual = deCopia;
    pintarSelector();
    try {
      await mostrarXml(xmlCopia);
      mostrado = { id: deCopia.id, xml: xmlCopia };
    } catch (err) {
      console.warn(err);
    }
  }

  // 2. El catálogo de Drive (por si hay piezas nuevas) y la pieza
  estadoPartitura('Comprobando Drive…');
  try {
    piezas = await servidor.piezas();
  } catch (err) {
    console.warn(err);
    pintarSelector();
    estadoPartitura(mostrado ? `Copia guardada en la tablet (Drive: ${err.message})` : `No se ha podido cargar el catálogo: ${err.message}`);
    return;
  }
  if (!piezas.length) {
    pintarSelector();
    estadoPartitura('La carpeta pianobot/piezas está vacía: añade una partitura con ＋.');
    return;
  }
  const pieza = preferida();
  await abrirPieza(pieza, mostrado?.id === pieza.id ? mostrado.xml : null);
}

$('pieza').addEventListener('change', async () => {
  const pieza = piezas.find((p) => p.id === $('pieza').value);
  if (!pieza) return;
  await guardarDigitacionYa();
  activarDigitacion(false);
  abrirPieza(pieza);
});

// ---------- Digitación ----------
// Modo «Digitar»: tocas una nota, eliges el dedo (1-5) y salta a la siguiente nota de esa mano.
// El dedo se escribe en el propio MusicXML (<fingering>) y se guarda en Drive (y antes en la tablet).
const dig = { activo: false, doc: null, indice: null, elegida: null, cambios: false, repintar: null, guardar: null };
let xmlActual = null;

function prepararDigitacion(xml) {
  xmlActual = xml;
  try {
    dig.doc = leerXml(xml);
    dig.indice = indexarNotas(dig.doc);
  } catch (err) {
    console.warn(err);
    dig.doc = null;
    dig.indice = null;
  }
  dig.elegida = null;
  pintarPaleta();
}

const manoDe = (n) => (n.pentagrama === 0 ? 'mano derecha' : n.pentagrama === 1 ? 'mano izquierda' : `pentagrama ${n.pentagrama + 1}`);

function pintarPaleta() {
  const n = dig.elegida;
  const dedo = n ? dedoDe(n.el) : null;
  for (const b of document.querySelectorAll('.dedo')) {
    b.disabled = !n;
    b.classList.toggle('actual', b.dataset.dedo !== '' && Number(b.dataset.dedo) === dedo);
  }
  $('dig-nota').textContent = n
    ? `${nombreNota(n.midi)} · compás ${n.el.parentElement.getAttribute('number') ?? n.compas + 1} · ${manoDe(n)}`
    : 'Toca una nota de la partitura';
}

function resaltarElegida() {
  const k = dig.elegida?.clave;
  partitura.marcar('nota-elegida', (gn) => k != null && claveOsmd(gn.sourceNote) === k);
}

function elegirNota(nota) {
  dig.elegida = nota;
  resaltarElegida();
  pintarPaleta();
}

function activarDigitacion(activo) {
  if (activo && grabador.activo) activarCorreccion(false);
  if (activo && practica) pararAlTempo();
  dig.activo = !!(activo && dig.indice && partitura.osmd);
  $('digitar').setAttribute('aria-pressed', String(dig.activo));
  $('paleta-dedos').hidden = !dig.activo;
  $('partitura').classList.toggle('digitando', dig.activo);
  if (!dig.activo) {
    dig.elegida = null;
    if (partitura.osmd) resaltarElegida();
    guardarDigitacionYa();
  }
  pintarPaleta();
}

function escribirDedo(dedo) {
  const n = dig.elegida;
  if (!n) return;
  ponerDedo(n.el, dedo);
  xmlActual = escribirXml(dig.doc);
  dig.cambios = true;
  if (dedo != null) {
    const siguiente = siguienteNota(dig.indice.notas, n, { hastaCompas: partitura.hasta - 1 });
    if (siguiente) dig.elegida = siguiente;
  }
  resaltarElegida();
  pintarPaleta();
  // Se repinta y se guarda un poco después, para poder ir pulsando dedos seguidos sin esperas.
  clearTimeout(dig.repintar);
  dig.repintar = setTimeout(async () => {
    await partitura.recargar(xmlActual);
    resaltarElegida();
  }, 350);
  clearTimeout(dig.guardar);
  dig.guardar = setTimeout(guardarDigitacionYa, 2500);
  estadoPartitura('Cambios sin guardar…');
  indicarGuardado('cambios');
}

/** Indicador junto a «Digitar»: 'cambios' | 'guardando' | 'guardado' | 'tablet' | null (oculto) */
function indicarGuardado(estado, detalle = '') {
  const el = $('guardado');
  const textos = {
    cambios: '• Sin guardar',
    guardando: 'Guardando…',
    guardado: `✓ Guardado en Drive ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`,
    tablet: '⚠ Guardado en la tablet; falta subirlo a Drive',
  };
  el.hidden = !estado;
  el.textContent = textos[estado] ?? '';
  el.title = detalle;
  el.className = `guardado${estado === 'guardado' ? ' ok' : estado === 'tablet' ? ' aviso' : ''}`;
}

async function guardarDigitacionYa() {
  clearTimeout(dig.guardar);
  if (!dig.cambios || !piezaActual) return;
  dig.cambios = false;
  const id = piezaActual.id;
  estadoPartitura('Guardando en Drive…');
  indicarGuardado('guardando');
  try {
    await servidor.guardarPartitura(id, xmlActual);
    if (!dig.cambios) {
      estadoPartitura('Digitación guardada en Drive');
      indicarGuardado('guardado');
    }
  } catch (err) {
    console.warn(err);
    estadoPartitura(`Guardada en la tablet; se subirá a Drive cuando se pueda (${err.message})`);
    indicarGuardado('tablet', err.message);
  }
}

$('digitar').addEventListener('click', () => activarDigitacion(!dig.activo));
$('partitura').addEventListener('click', (e) => {
  if (!dig.activo) return;
  const nota = partitura.notaEn(e.clientX, e.clientY);
  const elegida = nota && dig.indice.porClave.get(claveOsmd(nota.sourceNote));
  if (elegida) elegirNota(elegida);
});
for (const b of document.querySelectorAll('.dedo')) {
  b.addEventListener('click', () => escribirDedo(b.dataset.dedo === '' ? null : Number(b.dataset.dedo)));
}
// Con teclado (en el ordenador): 1-5 pone el dedo, 0 o Supr lo quita, Esc sale del modo.
document.addEventListener('keydown', (e) => {
  if (!dig.activo || e.target.closest('input, select, textarea')) return;
  if (/^[1-5]$/.test(e.key)) escribirDedo(Number(e.key));
  else if (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace') escribirDedo(null);
  else if (e.key === 'Escape') activarDigitacion(false);
  else return;
  e.preventDefault();
});
// ---------- Corrección (fase 3) ----------
// Con «Corregir» activo, cada vez que tocas el fragmento y paras unos segundos, se compara con la partitura:
// notas falladas en rojo y omitidas en naranja, y las métricas por compás y mano en «Último intento».
const grabador = new GrabadorIntentos();
let esperadasDelIntento = null;
let ultimoIntento = null;
const textoMano = () => ({ ambas: '', derecha: ' con la mano derecha', izquierda: ' con la mano izquierda' })[ajustes.mano];

function limpiarMarcas() {
  if (!partitura.osmd) return;
  partitura.pintarEstados(() => undefined);
  partitura.ocultarLinea();
}

// Dónde empieza el fragmento (en negras desde el principio de la pieza), para mover la línea roja
const inicioFragmento = () => (dig.indice.compases.find((c) => c.numero === partitura.desde) ?? dig.indice.compases[0]).inicio;

async function activarCorreccion(activo) {
  if (activo && (!dig.indice || !partitura.osmd)) {
    estadoPartitura('Primero tiene que estar cargada la partitura.');
    return;
  }
  if (activo && dig.activo) activarDigitacion(false);
  if (activo && practica) pararAlTempo();
  if (activo && !entrada) await empezar();
  const ok = !!(activo && entrada);
  grabador.activar(ok);
  $('corregir').setAttribute('aria-pressed', String(ok));
  if (ok) {
    ajustarHoja();
    encuadrarPartitura();
    estadoPartitura(`Toca los compases ${partitura.desde}–${partitura.hasta}${textoMano()}; al parar unos segundos, se corrige.`);
  }
  else if (activo) estadoPartitura('Conecta el piano para corregir.');
  else estadoPartitura(`${partitura.numCompases} compases`);
}

$('corregir').addEventListener('click', () => activarCorreccion(!grabador.activo));
$('mano').value = ajustes.mano;
$('mano').addEventListener('change', () => {
  ajustes.mano = $('mano').value;
  guardar();
  limpiarMarcas();
  if (grabador.activo) activarCorreccion(true);
});

grabador.addEventListener('inicio', () => {
  limpiarMarcas();
  ajustarHoja();
  encuadrarPartitura();
  esperadasDelIntento = esperadasDelFragmento(dig.indice, { desde: partitura.desde, hasta: partitura.hasta, mano: ajustes.mano });
  estadoPartitura('Escuchando…');
});

// En directo: la línea roja sigue la nota por la que vas, la hoja baja sola y las notas se colorean
// según las tocas (verde bien, rojo fallada; naranja las que te has saltado). Como mucho cada 120 ms.
let seguimientoPendiente = null;
grabador.addEventListener('nota', () => {
  if (seguimientoPendiente) return;
  seguimientoPendiente = setTimeout(() => {
    seguimientoPendiente = null;
    seguirIntento();
  }, 0);
});

let ultimoSeguimiento = 0;
function seguirIntento() {
  const E = esperadasDelIntento;
  if (!E?.length || !grabador.grabando) return;
  const ahora = performance.now();
  if (ahora - ultimoSeguimiento < 120) {
    seguimientoPendiente = setTimeout(() => {
      seguimientoPendiente = null;
      seguirIntento();
    }, 120);
    return;
  }
  ultimoSeguimiento = ahora;
  const { pares } = alinear(E, grabador.notas, { finLibre: true });
  const ultimo = pares.at(-1)?.e;
  if (!ultimo) return;
  const hechas = E.filter((e) => e.pos <= ultimo.pos + 1e-6);
  const compases = compasesDelFragmento(dig.indice, { desde: partitura.desde, hasta: partitura.hasta });
  const r = analizar({ esperadas: hechas, compases, tocadas: grabador.notas });
  const estados = new Map();
  for (const [clave, x] of r.notas) {
    // Una omitida solo se marca cuando ya has pasado de largo (no la que estás a punto de tocar)
    if (x.estado === 'omitida' && x.e.pos >= ultimo.pos - 0.25) continue;
    estados.set(clave, x.estado);
  }
  partitura.pintarEstados((gn) => estados.get(claveOsmd(gn.sourceNote)));
  // Compás nuevo: se encuadra (la mirada se queda en el mismo sitio); la línea roja, dentro del compás
  if (ultimo.compas !== partitura.compas) partitura.irACompas(ultimo.compas);
  partitura.seguirA(inicioFragmento() + ultimo.pos);
}

grabador.addEventListener('intento', (e) => {
  const esperadas = esperadasDelIntento ?? esperadasDelFragmento(dig.indice, { desde: partitura.desde, hasta: partitura.hasta, mano: ajustes.mano });
  const compases = compasesDelFragmento(dig.indice, { desde: partitura.desde, hasta: partitura.hasta });
  const pulso = metronomo.sonando && metronomo.pulsos.length ? { ppm: metronomo.ppm, origen: metronomo.pulsos[0].tiempo } : null;
  const resultado = analizar({ esperadas, compases, tocadas: e.detail.notas, pedal: e.detail.pedal, metronomo: pulso });
  ultimoIntento = { desde: partitura.desde, hasta: partitura.hasta, mano: ajustes.mano, metronomo: pulso?.ppm ?? null, ...resultado };
  esperadasDelIntento = null;
  pintarIntento(ultimoIntento);
  clearTimeout(seguimientoPendiente);
  seguimientoPendiente = null;
  partitura.ocultarLinea();
  partitura.pintarEstados((gn) => resultado.notas.get(claveOsmd(gn.sourceNote))?.estado);
  partitura.irACompas(partitura.desde);
  estadoPartitura('Corregido. Toca otra vez cuando quieras.');
});

// ---------- Al tempo ----------
// Con el metrónomo: un compás de cuenta y, después, la línea avanza sola al tempo. Cada nota se juzga en su
// momento (verde si aciertas, rojo si tocas otra, naranja si se te pasa). Al acabar el fragmento, se para.
let practica = null;
let estadosAlTempo = new Map();

async function empezarAlTempo() {
  if (!dig.indice || !partitura.osmd) {
    estadoPartitura('Primero tiene que estar cargada la partitura.');
    return;
  }
  if (dig.activo) activarDigitacion(false);
  if (grabador.activo) await activarCorreccion(false);
  await activarAudio();
  if (!entrada) await empezar();
  if (!entrada) {
    estadoPartitura('Conecta el piano para practicar al tempo.');
    return;
  }
  const esperadas = esperadasDelFragmento(dig.indice, { desde: partitura.desde, hasta: partitura.hasta, mano: ajustes.mano });
  const compases = compasesDelFragmento(dig.indice, { desde: partitura.desde, hasta: partitura.hasta });
  const duracion = compases.reduce((s, c) => s + c.duracion, 0);
  const tiempos = Math.max(1, Math.round(compases[0]?.duracion ?? 4));
  // El metrónomo arranca de cero: su primer clic abre el compás de cuenta
  metronomo.parar();
  metronomo.pulsosPorCompas = tiempos;
  metronomo.arrancar();
  const negra = 60 / metronomo.ppm;
  const t0 = metronomo.pulsos[0].tiempo + tiempos * negra;
  practica = new PracticaAlTempo({ esperadas, t0, negra, duracion });
  practica.compases = compases;
  practica.tiempos = tiempos;
  practica.momentos = [...new Set(esperadas.map((e) => e.pos))].sort((a, b) => a - b);
  practica.siguiente = 0;
  estadosAlTempo = new Map();
  limpiarMarcas();
  ajustarHoja();
  encuadrarPartitura();
  partitura.irACompas(partitura.desde);
  $('al-tempo').setAttribute('aria-pressed', 'true');
  $('al-tempo').textContent = '■ Parar';
  estadoPartitura(`Cuenta: ${'○'.repeat(tiempos)} · empieza en el siguiente compás`);
  requestAnimationFrame(bucleAlTempo);
}

function aplicarAlTempo(cambios) {
  if (!cambios.length) return;
  for (const c of cambios) estadosAlTempo.set(c.clave, c.estado);
  partitura.pintarEstados((gn) => estadosAlTempo.get(claveOsmd(gn.sourceNote)));
}

function bucleAlTempo() {
  if (!practica) return;
  const ahora = ahoraSonando();
  const pos = practica.posicion(ahora);
  if (pos < 0) {
    const n = Math.min(practica.tiempos, Math.floor(pos + practica.tiempos) + 1);
    estadoPartitura(`Cuenta: ${'●'.repeat(Math.max(0, n))}${'○'.repeat(Math.max(0, practica.tiempos - n))} · empieza en el siguiente compás`);
  } else {
    // La línea salta a cada nota en su momento; el sombreado, a cada compás
    let movida = false;
    while (practica.siguiente < practica.momentos.length && practica.momentos[practica.siguiente] <= pos) {
      practica.siguiente++;
      movida = true;
    }
    if (movida) {
      const c = practica.compases.findLast((x) => x.inicio <= pos);
      if (c && c.numero !== partitura.compas) partitura.irACompas(c.numero);
      partitura.seguirA(inicioFragmento() + practica.momentos[practica.siguiente - 1]);
      estadoPartitura(`Al tempo · compás ${partitura.compas}`);
    }
    aplicarAlTempo(practica.avanzar(ahora));
  }
  if (practica.terminado(ahora)) terminarAlTempo();
  else requestAnimationFrame(bucleAlTempo);
}

function terminarAlTempo() {
  const p = practica;
  pararAlTempo();
  const r = p.resumen(p.compases);
  ultimoIntento = { desde: partitura.desde, hasta: partitura.hasta, mano: ajustes.mano, metronomo: r.total.tempo, modo: 'al tempo', ...r };
  pintarIntento(ultimoIntento);
  partitura.pintarEstados((gn) => r.notas.get(claveOsmd(gn.sourceNote))?.estado);
  partitura.irACompas(partitura.desde);
  estadoPartitura('Hecho. Pulsa ⏱ Al tempo para repetir.');
}

function pararAlTempo() {
  practica = null;
  metronomo.parar();
  partitura.ocultarLinea();
  $('al-tempo').setAttribute('aria-pressed', 'false');
  $('al-tempo').textContent = '⏱ Al tempo';
}

$('al-tempo').addEventListener('click', () => {
  if (practica) {
    pararAlTempo();
    estadoPartitura('Parado.');
  } else empezarAlTempo();
});

const conSigno = (ms) => (ms == null ? '–' : `${ms > 0 ? '+' : ''}${ms} ms`);

function pintarIntento(r) {
  const t = r.total;
  const partes = [
    `Compases ${r.desde}–${r.hasta}`,
    { ambas: 'las dos manos', derecha: 'mano derecha', izquierda: 'mano izquierda' }[r.mano],
    `${t.bien} de ${t.notas} bien`,
  ];
  if (t.falladas) partes.push(`${t.falladas} fallada${t.falladas > 1 ? 's' : ''}`);
  if (t.omitidas) partes.push(`${t.omitidas} omitida${t.omitidas > 1 ? 's' : ''}`);
  if (t.titubeos) partes.push(`${t.titubeos} titubeo${t.titubeos > 1 ? 's' : ''}`);
  if (r.modo === 'al tempo') partes.push(`al tempo, a ${t.tempo} ppm`);
  else if (t.tempo) partes.push(`tempo ${t.tempo} ppm${r.metronomo ? ` (metrónomo a ${r.metronomo})` : ''}`);
  if (t.desajusteMs != null) partes.push(`desajuste medio ${conSigno(t.desajusteMs)} (±${t.desajusteAbsMs} ms, respecto ${t.referencia === 'metrónomo' ? 'al metrónomo' : 'a tu pulso'})`);
  $('intento-resumen').textContent = partes.join(' · ');

  const pedal = new Map(r.pedal.map((p) => [p.compas, p]));
  let compasAnterior = null;
  const filas = r.filas.map((f) => {
    const tr = document.createElement('tr');
    const primera = f.compas !== compasAnterior;
    if (primera && compasAnterior != null) tr.className = 'primera-mano';
    compasAnterior = f.compas;
    const p = pedal.get(f.compas);
    const celdas = [
      [primera ? f.compas : '', 'num'],
      [f.mano, ''],
      [`${f.bien}/${f.notas}`, 'cuenta'],
      [f.falladas, `cuenta${f.falladas ? ' hay' : ''}`],
      [f.omitidas, `cuenta${f.omitidas ? ' hay' : ''}`],
      [f.titubeos, `cuenta${f.titubeos ? ' hay' : ''}`],
      [conSigno(f.desajusteMs), 'num'],
      [f.articulacion == null ? '–' : `${f.articulacion} %`, 'num'],
      [primera && p ? `${p.pisadoPct} %${p.pisadas ? ` · ${p.pisadas}×` : ''}` : '', 'num'],
    ];
    for (const [texto, clase] of celdas) {
      const td = document.createElement('td');
      td.textContent = texto;
      if (clase) td.className = clase;
      tr.append(td);
    }
    return tr;
  });
  $('intento-filas').replaceChildren(...filas);
  $('tarjeta-intento').hidden = false;
}

// Si la app se cierra o pasa a segundo plano, se guarda lo pendiente (y si aún no ha dado tiempo, se avisa).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') guardarDigitacionYa();
});
window.addEventListener('beforeunload', (e) => {
  if (!dig.cambios) return;
  guardarDigitacionYa();
  e.preventDefault();
  e.returnValue = '';
});

// Añadir una partitura desde la tablet: se sube a la carpeta de Drive y queda en el catálogo.
$('anadir-pieza').addEventListener('click', () => $('fichero-pieza').click());
$('fichero-pieza').addEventListener('change', async () => {
  const fichero = $('fichero-pieza').files[0];
  $('fichero-pieza').value = '';
  if (!fichero) return;
  if (!/\.(musicxml|xml|mxl)$/i.test(fichero.name)) {
    estadoPartitura('Solo se pueden añadir partituras .musicxml, .xml o .mxl (las exporta MuseScore).');
    return;
  }
  $('anadir-pieza').disabled = true;
  estadoPartitura(`Subiendo «${fichero.name}» a Drive…`);
  try {
    const pieza = await servidor.subir(fichero);
    piezas = await servidor.piezas();
    await abrirPieza(piezas.find((p) => p.id === pieza.id) ?? pieza);
  } catch (err) {
    estadoPartitura(`No se ha podido añadir: ${err.message}`);
  } finally {
    $('anadir-pieza').disabled = false;
  }
});

// ---------- Conexión con Drive ----------
function abrirConexion() {
  $('conexion-url').value = servidor.url;
  $('conexion-token').value = servidor.token;
  $('conexion-resultado').textContent = '';
  $('dialogo-conexion').showModal();
}
$('conexion').addEventListener('click', abrirConexion);
$('conectar').addEventListener('click', abrirConexion);
$('conexion-cancelar').addEventListener('click', () => $('dialogo-conexion').close());
$('form-conexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prueba = new Servidor();
  prueba.url = $('conexion-url').value.trim();
  prueba.token = $('conexion-token').value.trim();
  $('conexion-probar').disabled = true;
  $('conexion-resultado').textContent = 'Probando…';
  try {
    const r = await prueba.probar();
    servidor.guardarConexion(prueba.url, prueba.token);
    $('conexion-resultado').textContent = `Conectado con el Sheet «${r.hoja}».`;
    $('dialogo-conexion').close();
    cargarPartitura();
  } catch (err) {
    $('conexion-resultado').textContent = `No funciona: ${err.message}`;
  } finally {
    $('conexion-probar').disabled = false;
  }
});

// ---------- Arranque ----------
pintarMetronomo();
pintarEscala();
pintarGasto();
requestAnimationFrame(dibujar);
if (!window.isSecureContext) ponerEstado('Abre la app por https para poder usar el MIDI.', false);
cargarPartitura();
