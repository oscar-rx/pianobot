// Conexión con el Apps Script (el puente con Google Drive y el Sheet «pianobot»).
// La URL y el token se guardan solo en esta tablet, nunca en el repo.
// Las respuestas que interesa conservar (catálogo y partituras) se guardan también en la tablet:
// así cargan al instante y la app sigue funcionando si Google tarda o falla.

const CLAVE_CONEXION = 'pianobot.conexion';
const PREFIJO_COPIA = 'pianobot.copia.';

function leerLocal(clave) {
  try {
    return JSON.parse(localStorage.getItem(clave) ?? 'null');
  } catch {
    return null;
  }
}

function guardarLocal(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
    return true;
  } catch {
    return false; // sin espacio o almacenamiento bloqueado: se sigue sin copia
  }
}

export class Servidor {
  constructor() {
    const c = leerLocal(CLAVE_CONEXION) ?? {};
    this.url = c.url ?? '';
    this.token = c.token ?? '';
  }

  get configurado() {
    return !!(this.url && this.token);
  }

  guardarConexion(url, token) {
    this.url = url.trim();
    this.token = token.trim();
    guardarLocal(CLAVE_CONEXION, { url: this.url, token: this.token });
  }

  #url() {
    if (!this.configurado) throw new Error('Falta conectar con Google Drive.');
    try {
      return new URL(this.url);
    } catch {
      throw new Error('La URL del Apps Script no es válida.');
    }
  }

  // Peticiones «simples» (GET sin cabeceras propias, o POST con texto plano): el navegador no las
  // bloquea por ir a otro dominio. Apps Script responde con una redirección que fetch sigue sola.
  llamar(accion, parametros = {}) {
    const url = this.#url();
    url.searchParams.set('accion', accion);
    url.searchParams.set('token', this.token);
    for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v);
    return this.#pedir(url, { redirect: 'follow' });
  }

  enviar(accion, datos) {
    const url = this.#url();
    const cuerpo = JSON.stringify({ accion, token: this.token, ...datos });
    return this.#pedir(url, { method: 'POST', body: cuerpo, redirect: 'follow' });
  }

  async #pedir(url, opciones) {
    let respuesta;
    try {
      respuesta = await fetch(url, opciones);
    } catch {
      throw new Error('No hay conexión con el Apps Script.');
    }
    const texto = await respuesta.text();
    let datos;
    try {
      datos = JSON.parse(texto);
    } catch {
      throw new Error('El Apps Script no ha devuelto datos. ¿Está implementado como aplicación web con acceso «Cualquier usuario»?');
    }
    if (datos.error) throw new Error(datos.error);
    return datos;
  }

  probar() {
    return this.llamar('hola');
  }

  async piezas() {
    const { piezas } = await this.llamar('piezas');
    guardarLocal(`${PREFIJO_COPIA}piezas`, piezas);
    return piezas;
  }

  async partitura(id) {
    const { musicxml } = await this.llamar('pieza', { id });
    guardarLocal(`${PREFIJO_COPIA}pieza.${id}`, musicxml);
    return musicxml;
  }

  /** Sube una partitura (un File de la tablet) a la carpeta de Drive. Devuelve la pieza ya catalogada. */
  async subir(fichero) {
    if (fichero.size > 15 * 1024 * 1024) throw new Error('El fichero es demasiado grande (más de 15 MB).');
    const bytes = new Uint8Array(await fichero.arrayBuffer());
    let binario = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const { pieza } = await this.enviar('subir', { nombre: fichero.name, base64: btoa(binario) });
    return pieza;
  }

  copiaPiezas() {
    return leerLocal(`${PREFIJO_COPIA}piezas`);
  }

  copiaPartitura(id) {
    return leerLocal(`${PREFIJO_COPIA}pieza.${id}`);
  }
}
