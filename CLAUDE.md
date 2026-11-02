# pianobot · notas para Claude

Profe de piano: la tablet (web en GitHub Pages) lee el piano por MIDI, enseña la partitura y, más adelante, Claude
decide qué practicar. El plan por fases y las decisiones están en `README.md`.

- **Idioma:** todo en español (código, comentarios, interfaz, commits). Oscar no programa: explicarle las cosas
  sin jerga y darle pasos exactos con enlaces cuando tenga que hacer algo.
- **Sin compilación:** módulos JS servidos tal cual. OpenSheetMusicDisplay está en `js/vendor/`.
- **Solo cable MIDI.** El modo micrófono y el teclado en pantalla se quitaron a propósito.
- **Nada de partituras ni datos en el repo** (es público): todo vive en Google Drive (carpeta `pianobot`, Sheet
  «pianobot») y lo sirve el Apps Script de `apps-script/`, con un token que solo tienen el script y la tablet.
- **Rama:** se trabaja y se publica (GitHub Pages) desde `claude/jolly-lamport-ytnces`.

## Pruebas

- `npm test`: Node (gasto, prueba de escala, Apps Script con Google simulado).
- `npm run e2e`: Chrome con Playwright (piano MIDI simulado y partitura con un Apps Script simulado).

## Subir el Apps Script

Cuando cambie `apps-script/`, súbelo tú con clasp (Oscar eligió esto en vez de guardar credenciales en GitHub):

1. `npx --yes @google/clasp@3.4.1 login --no-localhost`: muestra un enlace y espera la respuesta. Pásale el enlace
   a Oscar; él lo abre, acepta y te pega la dirección `http://localhost:8888/?…`. Como el comando espera por la
   entrada estándar, arráncalo en segundo plano leyendo de una tubería (`mkfifo`) y escribe ahí la dirección.
2. `herramientas/subir-apps-script.sh`: pruebas, `clasp push` y versión nueva en la misma implementación
   (la URL no cambia).

No muestres ni guardes las credenciales de clasp (`~/.clasprc.json`) fuera de la sesión.
