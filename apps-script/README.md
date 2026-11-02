# Apps Script de pianobot

El puente entre la web (GitHub Pages) y tu Google Drive. Va pegado al Sheet «pianobot» y se publica como
aplicación web. Ahora mismo sirve el catálogo de piezas y las partituras y recibe las que subes desde la app;
en la fase 4 llamará a Claude.

- `Codigo.gs`: el código. Se copia tal cual en el editor de Apps Script.
- `appsscript.json`: la configuración del proyecto (para cuando se suba con clasp).

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

## Cuando cambie el código

Pega el `Codigo.gs` nuevo, guarda y ve a **Implementar → Gestionar implementaciones** → lápiz → Versión:
**Nueva versión** → **Implementar**. Así la URL sigue siendo la misma y la tablet no hay que tocarla.
