# pianobot

Profe de piano: la tablet escucha lo que tocas y te enseña el fragmento, y Claude decide qué practicar.
Pieza de prueba: la Invención n.º 13 de Bach (BWV 784).

**Estado:** fases 1 («Oír») y 2 («Ver») hechas.

## Qué hace ya

- **Partitura en pantalla:** la Invención 13 pintada con OpenSheetMusicDisplay. Solo enseña los compases que
  pidas («Compases 9 a 12»), con ◀ ▶ para pasar al fragmento anterior o siguiente, A− A+ para el tamaño y un
  cursor que resalta el compás en el que vas (‹ ›). Recuerda el fragmento y el tamaño.
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

1. Conecta el piano a la tablet con el cable USB.
2. Abre https://oscar-rx.github.io/pianobot/ en **Chrome** y pulsa **Empezar**. Debe poner «Conectado:» y el
   nombre del piano.
3. Prueba de la fase 1: metrónomo a 60, «Medir contra: negras», escala de La menor armónica.
   Si sale «¡Entera!», el oído funciona.
4. Prueba de la fase 2: escribe 9 y 12 en «Compases»; deben salir solo esos cuatro compases.

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
js/vendor/                  OpenSheetMusicDisplay 2.2.1 (licencia BSD-3), guardada aquí para no depender de un CDN
piezas/                     catálogo (piezas.json) y MusicXML de las piezas de dominio público
js/notas.js                 nombres de notas (Do4 = Do central)
js/prueba-escala.js         la prueba de la fase 1
js/gasto.js                 precios por modelo y contador de gasto
```

El piano emite eventos `{tipo: 'noteon'|'noteoff', midi, velocidad, tiempo}` y `pedal`, con `tiempo` en segundos
del reloj de audio: se pueden comparar directamente con los clics del metrónomo. Es lo que usará la fase 3 para
comparar con la partitura.

## Pruebas

```bash
npm test          # gasto y prueba de escala (Node 22)
npm run e2e       # en Chrome: piano MIDI simulado (acordes, fuerza, pedal, dos voces) y partitura (fragmentos)
npm run servir    # la app en http://localhost:8080
```

## Precios de la API (en `js/gasto.js`)

| Modelo | Entrada | Salida | Uso |
|---|---|---|---|
| `claude-haiku-5-5` | $0.10 / M tokens | $0.50 / M | durante la sesión (rápido) |
| `claude-sonnet-5-5` | $2 / M | $10 / M | plan del día y resumen |

Una llamada típica del profe (unos 3000 tokens de entrada y 120 de salida con Haiku) cuesta unos $0.0004.
Pon también un límite de gasto mensual en la Claude Console, para que no se pase aunque falle la app.

## Plan

Fases 0 a 7, según el documento de diseño: oír → ver → comparar → profe en texto → voz → memoria → extras.

## Decisiones para la fase 3

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
