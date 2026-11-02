# pianobot

Profe de piano: la tablet escucha lo que tocas y te enseña el fragmento, y Claude decide qué practicar.
Pieza de prueba: la Invención n.º 13 de Bach (BWV 784).

**Estado:** fases 1 («Oír»), 2 («Ver»), 3 («Comparar») y 4 («El profe», en texto) hechas.

## Qué hace ya

- **Partituras en pantalla:** las de tu carpeta de Google Drive, pintadas con OpenSheetMusicDisplay. Para añadir
  una, botón **＋** (se sube sola a Drive) o métela en la carpeta: el catálogo se rellena solo. Selector de pieza.
  Los títulos que algunos ficheros traen escritos dentro de los compases (p. ej. los convertidos de Capella de Tobi's
  Notenarchiv) se quitan solos y pasan a los datos de la pieza; las indicaciones musicales no se tocan. Solo enseña los compases que
  pidas («Compases 9 a 12»), con ◀ ▶ para pasar al fragmento anterior o siguiente, A− A+ para el tamaño y un
  cursor que resalta el compás en el que vas (‹ ›). Recuerda el fragmento y el tamaño, y guarda una copia de
  la partitura en la tablet: carga al instante y funciona aunque Google falle. Cada pieza recuerda su fragmento.
- **Corrección de intentos (fase 3):** botón **🎯 Corregir** y mano (las dos, derecha o izquierda). Tocas el
  fragmento y, al parar unos 2,5 s, la app lo compara con la partitura: notas falladas en rojo y omitidas en naranja,
  y en «Último intento» las métricas por compás y mano: falladas, omitidas, titubeos, desajuste rítmico (contra el
  metrónomo si suena, si no contra tu propio pulso), tempo real, articulación (% del valor escrito que mantienes la
  tecla) y pedal (aparte: % del compás pisado y veces que se pisa). Mientras tocas, el cursor sigue por dónde vas.
  Se queda esperando el siguiente intento.
- **🧑‍🏫 Profe (fase 4):** Claude decide qué practicar. Dice la indicación en el panel («El 11 se te atasca en el
  salto. Solo el 11, mano derecha»), la app pone sola el fragmento y la mano y arranca los intentos en uno de dos
  modos: **sin metrónomo** (como Corregir, para aprender las notas: lo nuevo empieza así) o **con metrónomo** (al
  tempo, con la figura del pulso que diga: «♪ = 60» antes que «♩ = 30»). Repite las veces que pida o, con «hasta que
  salga limpio», sin límite hasta una vez sin fallos ni saltos; entonces le manda los resultados (los 6 últimos y
  cuántas veces van) y decide el siguiente paso. Botones para contestarle (Otra
  vez, Más lento, Más rápido, Siguiente, Para) y un cuadro para decirle algo. Se elige el modelo: Haiku 5.5 (rápido,
  ~0,0004 $ por indicación), Sonnet 5.5 (~0,008 $) u Opus 5.5 (~0,015 $). Cada llamada suma en el contador de gasto
  y queda apuntada en las pestañas «Gasto» e «Intentos» del Sheet.
- **⏱ Al tempo:** con el metrónomo. Al pulsarlo da un compás de cuenta y después la línea roja avanza sola y de forma continua al tempo (también en los silencios);
  cada nota se juzga en su momento: verde si la aciertas, rojo si tocas otra, naranja si se te pasa. Al acabar el
  fragmento se para el metrónomo y sale el resumen (desajuste respecto al metrónomo). El tempo, en el metrónomo de
  arriba. Una nota vale si cae más cerca de su sitio que del de la vecina (entre 120 y 350 ms de margen), y si vas
  siempre un poco tarde (o pronto) la app lo descuenta al juzgar (hasta 150 ms), aunque el desajuste se sigue midiendo.
- **Figura del pulso:** cada clic del metrónomo puede ser negra, corchea o semicorchea (selector «Cada clic es» o
  tocando la figura ♩/♪/♬ del metrónomo de arriba). Para ir lento se sigue mejor «♪ = 60» que «♩ = 30».
- **Seguimiento en directo:** mientras tocas con «Corregir», una línea roja sigue la nota por la que vas, las notas se
  colorean al momento (verde bien, rojo fallada, naranja saltada) y la hoja baja sola al pasar de sistema.
- **Vista «una línea» (por defecto) o «páginas»** (botón ➡ / ☰): en «una línea» el fragmento va en un solo pentagrama
  que se desplaza en horizontal compás a compás, con el compás que tocas siempre a la izquierda y los siguientes a
  la vista; en «páginas», cada compás nuevo deja su línea arriba y la siguiente asoma debajo antes de llegar.
- **Controles arriba:** Digitar, Corregir, mano, compás y un metrónomo mínimo (− ♩ = tempo + ▶) encima de la partitura,
  que tiene su propio scroll; no hace falta bajar la página para llegar a ellos.
- **Digitación en la tablet:** botón **✍️ Digitar**, tocas una nota y eliges el dedo (1-5, o ✕ para quitarlo); salta
  sola a la siguiente nota de esa mano, así que un pasaje se digita pulsando números seguidos. Se guarda en el propio
  MusicXML de Drive (se ve también en MuseScore); sin conexión queda en la tablet y se sube después. Junto a
  «Digitar» se ve si está guardado («✓ Guardado en Drive» o «⚠ Guardado en la tablet»).
- **Lee el piano por cable (MIDI por USB):** cada tecla por separado, con su momento, su fuerza (1-127) y cuánto
  la mantienes. Recoge acordes, las dos manos a la vez y el pedal.
- **Nota grande:** enseña todas las teclas que suenan a la vez y avisa cuando pisas el pedal.
- **Metrónomo** con tempo, compás, volumen y tres sonidos: Madera, Pitido y Suave.
- **Registro de notas:** momento, nota, fuerza, duración y **desajuste** respecto al pulso
  (negativo = adelantada, positivo = retrasada).
- **Prueba de escala:** el criterio de «listo» de la fase 1. Tocas la escala subiendo y bajando, y la app marca
  cada nota bien, perdida o de más. Las notas de un acorde no cuentan.
- **Calibrar retraso:** con el metrónomo en marcha, tocas 8 notas justo con el clic y la app corrige el retraso
  del sistema, para que el desajuste salga bien medido.
- **Gasto de la API** en la esquina: lo que llevas en la sesión y en el mes, en dólares, con aviso si pasas el
  tope que elijas. Ahora mismo marca $0, porque el profe (Claude) llega en la fase 4.

## Cómo usarlo

1. La primera vez: conecta la app con tu Drive (botón **Drive**, arriba). Los pasos están en
   [`apps-script/README.md`](apps-script/README.md).
2. Conecta el piano a la tablet con el cable USB.
3. Abre https://oscar-rx.github.io/pianobot/ en **Chrome** y pulsa **Empezar**. Debe poner «Conectado:» y el
   nombre del piano.
4. Prueba de la fase 1: metrónomo a 60, «Medir contra: negras», escala de La menor armónica.
   Si sale «¡Entera!», el oído funciona.
5. Prueba de la fase 2: escribe 9 y 12 en «Compases»; deben salir solo esos cuatro compases.

La web se publica sola con GitHub Pages desde la rama `claude/jolly-lamport-ytnces`. Si después de un cambio la
tablet enseña la versión antigua, cierra la pestaña y vuelve a abrirla.

## Cómo está hecho

Web estática, sin compilar nada, con módulos JavaScript que GitHub Pages sirve tal cual.

```
index.html, css/app.css     la interfaz (pensada para tablet en horizontal sobre el atril)
js/main.js                  une todo
js/audio.js                 reloj común: metrónomo y piano se miden en el mismo reloj
js/metronomo.js             metrónomo programado con antelación (no se desfasa)
js/entradas/midi.js         el piano por Web MIDI
js/partitura.js             la partitura (fragmento y cursor) sobre OpenSheetMusicDisplay
js/musicxml.js              notas del MusicXML (altura, mano, momento, duración, ligaduras) y su pareja en OSMD
js/digitacion.js            escribe y lee <fingering>
js/comparar.js              fase 3: alineación tolerante (como un diff) y métricas por compás y mano
js/intento.js               graba intentos: empiezan con la primera nota y acaban tras unos segundos sin tocar
js/al-tempo.js              modo «Al tempo»: cada nota se juzga en su momento según el metrónomo
apps-script/Profe.gs        el profe: prompt, llamada a la API de Claude (salida JSON) y registro de gasto e intentos
js/vendor/                  OpenSheetMusicDisplay 2.2.1 (licencia BSD-3), guardada aquí para no depender de un CDN
js/servidor.js              conexión con el Apps Script y copia local (catálogo y partituras)
apps-script/                el Apps Script: el puente con Google Drive y el Sheet «pianobot»
js/notas.js                 nombres de notas (Do4 = Do central)
js/prueba-escala.js         la prueba de la fase 1
js/gasto.js                 precios por modelo y contador de gasto
```

El piano emite eventos `{tipo: 'noteon'|'noteoff', midi, velocidad, tiempo}` y `pedal`, con `tiempo` en segundos
del reloj de audio: se pueden comparar directamente con los clics del metrónomo. Es lo que usará la fase 3 para
comparar con la partitura.

## Pruebas

```bash
npm test          # gasto, prueba de escala, comparación (fase 3) y Apps Script con Google simulado (Node 22)
npm run e2e       # en Chrome: piano MIDI simulado, partitura, digitación y corrección («fallas el compás 11»)
npm run servir    # la app en http://localhost:8080
```

## Partituras y datos: en Google Drive

Todas las partituras (de dominio público o compradas) y los datos (sesiones, progreso, gasto) están en tu
Google Drive, en la carpeta `pianobot`, nunca en este repo, que es público. La web los pide al Apps Script con un
token que solo conocen el script y la tablet. Detalles en [`apps-script/README.md`](apps-script/README.md).

## Precios de la API (en `js/gasto.js`)

| Modelo | Entrada | Salida | Uso |
|---|---|---|---|
| `claude-haiku-5-5` | $0.10 / M tokens | $0.50 / M | durante la sesión (rápido) |
| `claude-sonnet-5-5` | $2 / M | $10 / M | plan del día y resumen |

Una llamada típica del profe (unos 3000 tokens de entrada y 120 de salida con Haiku) cuesta unos $0.0004.
Pon también un límite de gasto mensual en la Claude Console, para que no se pase aunque falle la app.

## Plan

Fases 0 a 7, según el documento de diseño: oír → ver → comparar → profe en texto → voz → memoria → extras.

## Decisiones de la fase 3 (hechas)

- **Duración / articulación (dedos):** nueva métrica. Para cada nota, qué proporción de su valor escrito se mantiene
  la tecla (p. ej. una blanca al 60 %) y si se encadena con la siguiente o deja hueco (legato, picado, solapada).
  Se mide solo con las teclas, sin tener en cuenta el pedal.
- **Pedal:** métrica aparte y 100 % independiente de la anterior: cuándo se pisa y se suelta, respecto al pulso y
  a los compases. Nunca se mezcla con la duración de las notas.
- **Quién juzga:** la app solo mide y Claude decide si es un problema según el contexto y el estilo. En Bach una
  nota cortada o un picado pueden ser lo que se busca; en una pieza romántica, el legato largo o el solapado
  pueden ayudar. Sin umbrales fijos en la app.

## Ideas apuntadas

- **Armonía del pasaje en pantalla** (para el profe con IA): enseñar el acorde de cada compás o pulso del
  fragmento (p. ej. «Lam → Mi7/Sol# → Lam»), como ayuda para memorizar. En la Invención 13 los acordes van
  arpegiados entre las dos voces, así que el análisis lo haría Claude una sola vez por pieza (con Sonnet), se
  guardaría con la pieza y se pintaría como cifrado encima del pentagrama: el MusicXML admite acordes
  (`<harmony>`) y OSMD los dibuja. El profe también podría usarlo al hablar («el 11 es Mi7: piensa en el arpegio»).
