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

  async llamar(accion, parametros = {}) {
    if (!this.configurado) throw new Error('Falta conectar con Google Drive.');
    let url;
    try {
      url = new URL(this.url);
    } catch {
      throw new Error('La URL del Apps Script no es válida.');
    }
    url.searchParams.set('accion', accion);
    url.searchParams.set('token', this.token);
    for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v);
    // Petición «simple» (GET sin cabeceras propias): el navegador no la bloquea por venir de otro dominio.
    let respuesta;
    try {
      respuesta = await fetch(url, { redirect: 'follow' });
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

  copiaPiezas() {
    return leerLocal(`${PREFIJO_COPIA}piezas`);
  }

  copiaPartitura(id) {
    return leerLocal(`${PREFIJO_COPIA}pieza.${id}`);
  }
}
