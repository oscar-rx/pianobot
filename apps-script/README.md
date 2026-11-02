# Apps Script de pianobot

El puente entre la web (GitHub Pages) y tu Google Drive. Va pegado al Sheet «pianobot» y se publica como
aplicación web. Ahora mismo sirve el catálogo de piezas y las partituras, recibe las que subes desde la app y
guarda los cambios (la digitación); en la fase 4 llamará a Claude.

Al guardar, sobrescribe el fichero de Drive; Drive conserva las versiones anteriores (clic derecho → Gestionar
versiones). Si era un `.mxl`, lo guarda como `.musicxml` al lado y manda el `.mxl` a la papelera.

- `Codigo.gs`: el código (partituras, catálogo, subidas).
- `Profe.gs`: el profe: llama a la API de Claude con el resumen de los intentos y devuelve la siguiente indicación;
  apunta el gasto en «Gasto» y los intentos en «Intentos».
- `appsscript.json`: la configuración del proyecto.
- `.clasp.json` y `.claspignore`: para subirlo con clasp (ver «Cuando cambie el código»).

## Dónde están las cosas en Drive

```
pianobot/                  carpeta
├── pianobot               el Sheet: pestañas Piezas, Secciones, Sesiones, Intentos, Progreso y Gasto
└── piezas/                las partituras: .musicxml, .xml o .mxl (el comprimido que exporta MuseScore)
```

## Añadir una pieza

Cualquiera de las dos:

- En la app, botón **＋** junto al nombre de la pieza: eliges el fichero en la tablet y se sube solo a Drive.
- O mete el fichero directamente en la carpeta `pianobot/piezas` de Drive.

No hay que tocar el Sheet: el script lee de la partitura el título, el compositor, los compases, el compás y el
tempo, y la apunta él solo en la pestaña «Piezas». Si quieres, retoca allí el título o el tempo objetivo; lo que
cambies se respeta. La columna «ID de Drive» la usa el script para saber qué fichero es cada fila: no la toques.

## Instalarlo (una vez)

1. Abre el Sheet «pianobot» → menú **Extensiones → Apps Script**.
2. Borra lo que haya en `Código.gs` y pega el contenido de [`Codigo.gs`](Codigo.gs). Guarda (icono del disquete).
3. Arriba, en el desplegable de funciones, elige **configurar** y pulsa **Ejecutar**. Google pedirá permisos:
   «Revisar permisos» → tu cuenta → «Configuración avanzada» → «Ir a pianobot (no seguro)» → «Permitir».
   Es «no seguro» solo porque el script es tuyo y Google no lo ha revisado.
4. Abajo, en el **registro de ejecución**, sale una línea «Token para la tablet: …». Cópiala: es el token.
5. **Implementar → Nueva implementación** → engranaje → **Aplicación web**.
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario**.
   - **Implementar** y copia la **URL de la aplicación web** (acaba en `/exec`).
6. En la tablet, en pianobot, pulsa **Drive** (arriba a la derecha), pega la URL y el token y pulsa
   **Probar y guardar**.

«Cualquier usuario» significa que la URL responde a quien la tenga, pero sin el token no devuelve nada. Nunca
pongas la URL ni el token en el repo ni los compartas.

## La clave de la API de Claude (para el profe)

1. En la Claude Console (https://platform.claude.com): crea una API key, carga saldo y pon un **límite de gasto
   mensual** (así no se pasa aunque la app falle).
2. En el editor de Apps Script de «pianobot»: ⚙ **Project Settings** → **Script properties** → **Add script
   property**: nombre `ANTHROPIC_API_KEY`, valor la clave. Nunca en el repo ni en la tablet.
3. El profe necesita permiso para conectarse a internet (la API de Claude): en el editor, elige **configurar** →
   **▶ Run** y acepta. Hay que hacerlo en cuanto se publique un Apps Script que lo use: hasta entonces Google no
   deja usar la aplicación web (ni para las partituras). El registro de «configurar» dice si la clave está puesta.

Modelos que se pueden elegir en la app: Haiku 5.5 (por defecto: el más rápido y barato), Sonnet 5.5 y Opus 5.5.

## Cuando cambie el código

Se sube solo, igual que en el entrenabot: cada push a la rama que toque `apps-script/` lanza
`.github/workflows/apps-script.yml`, que pasa las pruebas, sube `Codigo.gs` y `appsscript.json` con clasp (los únicos
que deja pasar `.claspignore`) y publica una versión nueva en la misma implementación. La URL y el token no cambian.

Necesita dos secretos en GitHub (**Settings → Secrets and variables → Actions**):

- `CLASPRC_JSON`: la autorización de clasp de tu cuenta de Google. Vale la misma que la del entrenabot.
- `APPS_SCRIPT_DEPLOYMENT_ID`: el ID de la implementación (el trozo de la URL entre `/s/` y `/exec`).

Mientras falten, la tarea avisa y no sube nada. `.clasp.json` enlaza esta carpeta con el proyecto «pianobot».

Si alguna vez hiciera falta subirlo desde una sesión de Claude: `herramientas/subir-apps-script.sh` (antes,
`npx --yes @google/clasp@3.4.1 login --no-localhost`). Y a mano: pega el `Codigo.gs` nuevo en el editor, guarda y
ve a **Deploy → Manage deployments** → lápiz → Version: **New version** → **Deploy**.
