# Apps Script de pianobot

El puente entre la web (GitHub Pages) y tu Google Drive. Va pegado al Sheet «pianobot» y se publica como
aplicación web. Ahora mismo sirve el catálogo de piezas y las partituras; en la fase 4 llamará a Claude.

- `Codigo.gs`: el código. Se copia tal cual en el editor de Apps Script.
- `appsscript.json`: la configuración del proyecto (para cuando se suba con clasp).

## Dónde están las cosas en Drive

```
pianobot/                  carpeta
├── pianobot               el Sheet: pestañas Piezas, Secciones, Sesiones, Intentos, Progreso y Gasto
└── piezas/                las partituras: .musicxml, .xml o .mxl (el comprimido que exporta MuseScore)
```

Para añadir una pieza: sube el fichero a `pianobot/piezas` y añade una fila en la pestaña «Piezas» con su ID
(corto y sin espacios, p. ej. `bwv784`) y el nombre exacto del fichero en la columna «Fichero».

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
