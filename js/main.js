// pianobot · fase 1: oír. Une entradas, metrónomo, registro de notas, prueba de escala y gasto.

import { activarAudio, ahoraSonando, contextoAudio } from './audio.js';
import { Metronomo, SONIDOS } from './metronomo.js';
import { EntradaMidi } from './entradas/midi.js';
import { EntradaMicro } from './entradas/micro.js';
import { EntradaPantalla } from './entradas/pantalla.js';
import { nombreNota, nombreIngles, frecuenciaAMidi } from './notas.js';
import { PruebaEscala, ESCALAS } from './prueba-escala.js';
import { ContadorGasto, formatoDolares, mesDe } from './gasto.js';

const $ = (id) => document.getElementById(id);

// ---------- Ajustes guardados ----------
const CLAVE_AJUSTES = 'pianobot.ajustes';
const ajustes = {
  fuente: 'micro',
  ppm: 60,
  compas: 4,
  subdivision: 1,
  volumen: 0.7,
  sonido: 'madera',
  sensibilidad: 12,
  escala: 'la-menor',
  retrasoMs: { micro: 0, midi: 0, pantalla: 0 },
};
try {
  Object.assign(ajustes, JSON.parse(localStorage.getItem(CLAVE_AJUSTES) || '{}'));
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
let entrada = null; // la entrada activa
let origen = null; // tiempo (reloj de audio) de la primera nota, para mostrar momentos relativos
let prueba = new PruebaEscala(ESCALAS[ajustes.escala]?.notas ?? ESCALAS['la-menor'].notas);
let calibrando = null; // {desajustes: []}
const filasActivas = new Map(); // midi → {fila, inicio}
const pulsadas = new Map(); // midi → frecuencia (o null): las teclas que suenan ahora, para ver acordes
let cuentaNotas = 0;
let ultimoAtaque = null; // momento del último noteon, para reconocer acordes
let bloqueoPantalla = null;

// ---------- Elección de fuente ----------
function pintarFuentes() {
  for (const b of document.querySelectorAll('[data-fuente]')) {
    const activa = b.dataset.fuente === ajustes.fuente;
    b.setAttribute('aria-checked', String(activa));
    b.classList.toggle('activa', activa);
  }
  $('bloque-micro').hidden = ajustes.fuente !== 'micro';
  avisoSonido();
}

function avisoSonido() {
  $('aviso-sonido').hidden = !(ajustes.fuente === 'micro' && SONIDOS[metronomo.sonido]?.conTono);
}

for (const b of document.querySelectorAll('[data-fuente]')) {
  b.addEventListener('click', async () => {
    if (ajustes.fuente === b.dataset.fuente) return;
    const estabaEscuchando = !!entrada;
    detenerEntrada();
    ajustes.fuente = b.dataset.fuente;
    guardar();
    pintarFuentes();
    if (estabaEscuchando) await empezar();
    else ponerEstado('Pulsa Empezar.', false);
  });
}

function crearEntrada(fuente) {
  if (fuente === 'midi') return new EntradaMidi();
  if (fuente === 'pantalla') return new EntradaPantalla($('teclado'));
  const m = new EntradaMicro();
  m.sensibilidadDb = ajustes.sensibilidad;
  return m;
}

async function empezar() {
  await activarAudio();
  detenerEntrada();
  entrada = crearEntrada(ajustes.fuente);
  entrada.ajusteMs = ajustes.retrasoMs[ajustes.fuente] ?? 0;
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
    if (err?.name === 'NotAllowedError') ponerEstado('No hay permiso. Actívalo en el candado de la barra de direcciones.', false);
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
  const midis = [...pulsadas.keys()].sort((a, b) => a - b);
  const grande = $('nota-actual');
  grande.textContent = midis.map(nombreNota).join(' ');
  grande.dataset.cuantas = Math.min(midis.length, 4);
  let sub = midis.map(nombreIngles).join(' ');
  const f = midis.length === 1 ? pulsadas.get(midis[0]) : null;
  if (f) {
    const cents = Math.round((frecuenciaAMidi(f) - midis[0]) * 100);
    sub += ` · ${f.toFixed(1)} Hz · ${cents >= 0 ? '+' : ''}${cents} cents`;
  }
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
  pulsadas.set(n.midi, n.frecuencia ?? null);
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
    celdaFuerza(n.velocidad, n.fuente, n.nivelDb),
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

function celdaFuerza(v, fuente, nivelDb) {
  const td = document.createElement('td');
  td.className = 'fuerza';
  const barra = document.createElement('span');
  barra.className = 'barrita';
  barra.style.setProperty('--v', (v ?? 0) / 127);
  td.append(barra, document.createTextNode(` ${v ?? '–'}${fuente === 'micro' ? '≈' : ''}`));
  if (nivelDb != null) {
    const db = document.createElement('span');
    db.className = 'tenue db';
    db.textContent = ` ${Math.round(nivelDb)} dB`;
    td.append(db);
  }
  td.title = fuente === 'micro' ? 'Aproximada a partir del volumen que oye el micro' : 'Velocidad MIDI (1-127)';
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
  avisoSonido();
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
  const fuente = ajustes.fuente;
  const nuevo = Math.round((ajustes.retrasoMs[fuente] ?? 0) + mediana * 1000);
  ajustes.retrasoMs[fuente] = nuevo;
  if (entrada) entrada.ajusteMs = nuevo;
  guardar();
  calibrando = null;
  $('calibrar-texto').textContent = `Hecho: retraso corregido ${nuevo} ms para ${fuente === 'micro' ? 'el micro' : fuente === 'midi' ? 'el cable' : 'la pantalla'}.`;
}

// ---------- Umbral del micro (dB por encima del ruido de fondo) ----------
$('sensibilidad').value = ajustes.sensibilidad;
$('sensibilidad-valor').textContent = `${ajustes.sensibilidad} dB`;
$('sensibilidad').addEventListener('input', () => {
  ajustes.sensibilidad = +$('sensibilidad').value;
  $('sensibilidad-valor').textContent = `${ajustes.sensibilidad} dB`;
  guardar();
  if (entrada instanceof EntradaMicro) entrada.configurar({ sensibilidadDb: ajustes.sensibilidad });
});

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
window.pianobot = { gasto, metronomo, get entrada() { return entrada; } };

// ---------- Bucle de dibujo: pulsos y medidor ----------
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
  if (entrada instanceof EntradaMicro) {
    const l = entrada.lectura;
    if (l) {
      const pct = (db) => `${Math.max(0, Math.min(100, ((db + 90) / 90) * 100))}%`;
      $('medidor-barra').style.width = pct(l.rmsDb);
      const umbral = entrada.analizador.seguidor.umbralAtaque;
      $('medidor-fondo').hidden = $('medidor-umbral').hidden = l.fondoDb == null;
      if (l.fondoDb != null) {
        $('medidor-fondo').style.left = pct(l.fondoDb);
        $('medidor-umbral').style.left = pct(umbral);
      }
      // Cifras para afinar: se refrescan unas 4 veces por segundo para que se puedan leer.
      const ahora = performance.now();
      if (ahora - (dibujar.ultimasCifras ?? 0) > 250) {
        dibujar.ultimasCifras = ahora;
        dibujar.picoReciente = Math.max(l.rmsDb, (dibujar.picoReciente ?? -120) - 6);
        $('medidor-cifras').textContent =
          l.fondoDb == null
            ? 'Midiendo el silencio… no toques un momento.'
            : `Ahora ${Math.round(dibujar.picoReciente)} dB · ruido ${Math.round(l.fondoDb)} dB · umbral ${Math.round(umbral)} dB`;
      } else {
        dibujar.picoReciente = Math.max(l.rmsDb, dibujar.picoReciente ?? -120);
      }
    }
  }
}

// ---------- Arranque ----------
pintarFuentes();
pintarMetronomo();
pintarEscala();
pintarGasto();
requestAnimationFrame(dibujar);
if (!window.isSecureContext) ponerEstado('Abre la app por https para poder usar el micro y el MIDI.', false);
