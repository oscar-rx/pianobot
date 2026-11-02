# pianobot

Profe de piano: la tablet escucha lo que tocas y te enseña el fragmento, y Claude decide qué practicar.
Pieza de prueba: la Invención n.º 13 de Bach (BWV 784).

**Estado:** fase 1, «Oír».

## Qué hace ya

- **Tres formas de escuchar:**
  - 🎙️ **Micrófono:** para ir probando sin el cable. El micro de la tablet oye el piano y saca las notas.
    Va con una nota cada vez: una mano y sin pedal.
  - 🎹 **Piano (cable):** MIDI por USB. Es el modo bueno: notas exactas, fuerza real y las dos manos.
  - ⌨️ **Pantalla:** un teclado táctil para comprobar que la app funciona sin piano.
- **Metrónomo** con tempo, compás y volumen.
- **Registro de notas:** cada nota con su momento, su fuerza, cuánto dura y su **desajuste** respecto al pulso
  (negativo = adelantada, positivo = retrasada).
- **Prueba de escala:** el criterio de «listo» de la fase 1. Tocas la escala subiendo y bajando, y la app marca
  cada nota que oye bien, las que se pierden y las que sobran.
- **Gasto de la API** en la esquina: lo que llevas en la sesión y en el mes, en dólares, con aviso si pasas el
  tope que elijas. Ahora mismo marca $0, porque el profe (Claude) llega en la fase 4.
- **Calibrar retraso:** con el metrónomo en marcha, tocas 8 notas justo con el clic y la app corrige el retraso
  del sistema, para que el desajuste salga bien medido. Se calibra aparte para el micro y para el cable.

## Cómo probarlo en la tablet

1. Abre la web en **Chrome**: `https://oscar-rx.github.io/pianobot/` (cuando GitHub Pages esté activado, ver abajo).
2. Elige **Micrófono** y pulsa **Empezar**. Acepta el permiso del micro.
3. Pon la tablet cerca del piano, con el piano sonando por su altavoz.
4. Toca notas sueltas: aparecen en grande y en la tabla.
5. Prueba de la fase 1: metrónomo a 60, «Medir contra: negras», escala de La menor armónica.
   Si sale «¡Entera!», el oído funciona.

Consejos para el micro:

- Si se pierden notas suaves, sube la **sensibilidad**. Si salen notas fantasma, bájala.
  La barra verde es el volumen que oye, la marca gris es el ruido de fondo y la roja, el umbral.
- El clic del metrónomo no cuenta como nota: es un ruido agudo sin tono, y el micro lo filtra.
- Con pedal o con legato muy pegado, el micro se lía: oye dos notas a la vez.
  Para eso hará falta el cable.

### Activar GitHub Pages (una vez)

En GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, elegir la rama y la carpeta
`/ (root)`. Al cabo de un minuto la web está en `https://oscar-rx.github.io/pianobot/`.
Hace falta https para que Chrome deje usar el micro y el MIDI.

## Cómo está hecho

Web estática, sin compilar nada, con módulos JavaScript que GitHub Pages sirve tal cual.

```
index.html, css/app.css     la interfaz (pensada para tablet en horizontal sobre el atril)
js/main.js                  une todo
js/audio.js                 reloj común: metrónomo, MIDI y micro se miden en el mismo reloj
js/metronomo.js             metrónomo programado con antelación (no se desfasa)
js/entradas/midi.js         Web MIDI
js/entradas/micro.js        micrófono → filtros → worklet → analizador
js/entradas/pantalla.js     teclado táctil
js/dsp/yin.js               detector de altura (YIN, con FFT)
js/dsp/seguidor-notas.js    de «energía + altura» a notas con su momento y su fuerza
js/dsp/analizador.js        une los dos anteriores; no depende del navegador
js/prueba-escala.js         la prueba de la fase 1
js/gasto.js                 precios por modelo y contador de gasto
```

Todas las entradas dan el mismo evento de nota: `{tipo, midi, velocidad, tiempo, fuente}`, con `tiempo` en
segundos del reloj de audio. La fase 3 (comparar con la partitura) podrá usar cualquiera de las tres.

### Cómo funciona el modo micro

1. Filtros: se quitan los retumbos (< 45 Hz) y todo lo que pasa de 3 kHz, donde están el clic y los siseos.
2. Cada 5 ms se mide la energía y la altura (YIN sobre unos 43 ms de audio).
3. Hay nota nueva cuando la energía sube de golpe y aparece un tono estable, o cuando cambia la altura en
   legato. Un golpe sin tono se descarta.
4. El momento de la nota se toma del ataque, no de cuando se reconoce. Así el desajuste rítmico sale bien.

En pruebas con audio sintético de piano, con dinámica normal y sin pedal, acierta el 97-99 % de las notas,
con un error de tiempo de unos 5 ms de media.

## Pruebas

```bash
npm test          # detector, seguidor de notas, gasto y prueba de escala (Node 22)
npm run e2e       # Chrome recibe un .wav como si fuera el micro y la escala debe salir entera
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
