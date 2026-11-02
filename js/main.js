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
  retrasoMs: 0,
  pieza: null, // id de la pieza (pestaña «Piezas» del Sheet); null = la primera
  fragmento: { desde: 1, hasta: 4 },
  zoom: 1,
};
try {
  const guardados = JSON.parse(localStorage.getItem(CLAVE_AJUSTES) || '{}');
  // Versiones anteriores guardaban un retraso por fuente (micro, cable, pantalla): se queda el del cable.
  if (guardados.retrasoMs && typeof guardados.retrasoMs === 'object') guardados.retrasoMs = guardados.retrasoMs.midi ?? 0;
  delete guardados.fuente;
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
  entrada.addEventListener('nota', (e) => alRecibirNota(e.detail));
  entrada.addEventListener('pedal', (e) => {
    $('pedal').hidden = !e.detail.pisado;
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
$('tempo-menos').addEventListener('click', () => cambiarTempo(metronomo.ppm - (metronomo.ppm > 100 ? 4 : 2)));
$('tempo-mas').addEventListener('click', () => cambiarTempo(metronomo.ppm + (metronomo.ppm >= 100 ? 4 : 2)));
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
window.pianobot = { gasto, metronomo, get entrada() { return entrada; }, get partitura() { return partitura; } };

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

function pintarFragmento() {
  $('frag-desde').value = partitura.desde;
  $('frag-hasta').value = partitura.hasta;
  $('frag-desde').max = $('frag-hasta').max = partitura.numCompases;
  $('frag-anterior').disabled = partitura.desde <= 1;
  $('frag-siguiente').disabled = partitura.hasta >= partitura.numCompases;
}

function verFragmento(desde, hasta) {
  if (!partitura.osmd) return;
  partitura.mostrar(desde, hasta);
  ajustes.fragmento = { desde: partitura.desde, hasta: partitura.hasta };
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
// en la tablet, al instante, y luego se comprueba en Drive si hay una versión nueva.
const servidor = new Servidor();
const elegirPieza = (piezas) => piezas?.find((p) => p.id === ajustes.pieza) ?? piezas?.[0];

async function mostrarPieza(pieza, xml) {
  $('pieza-titulo').textContent = pieza.titulo;
  $('pieza-autor').textContent = pieza.compositor ? `· ${pieza.compositor}` : '';
  await partitura.cargar(xml);
  verFragmento(ajustes.fragmento.desde, ajustes.fragmento.hasta);
}

async function cargarPartitura() {
  $('sin-conexion').hidden = servidor.configurado;
  $('partitura').hidden = !servidor.configurado;
  $('conexion-punto').classList.remove('ok');
  if (!servidor.configurado) {
    $('partitura-estado').textContent = 'Sin conectar con Drive';
    return;
  }

  let mostrado = null;
  const guardada = elegirPieza(servidor.copiaPiezas());
  const xmlGuardado = guardada && servidor.copiaPartitura(guardada.id);
  if (xmlGuardado) {
    try {
      await mostrarPieza(guardada, xmlGuardado);
      mostrado = xmlGuardado;
      $('partitura-estado').textContent = 'Comprobando Drive…';
    } catch (err) {
      console.error(err);
    }
  } else {
    $('partitura-estado').textContent = 'Descargando la partitura de Drive…';
  }

  try {
    const pieza = elegirPieza(await servidor.piezas());
    if (!pieza) throw new Error('La pestaña «Piezas» del Sheet está vacía.');
    const xml = await servidor.partitura(pieza.id);
    if (xml !== mostrado) await mostrarPieza(pieza, xml);
    $('conexion-punto').classList.add('ok');
    $('partitura-estado').textContent = `${partitura.numCompases} compases`;
  } catch (err) {
    console.warn(err);
    $('partitura-estado').textContent = mostrado
      ? `Copia guardada en la tablet (Drive: ${err.message})`
      : `No se ha podido cargar la partitura: ${err.message}`;
  }
}

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
