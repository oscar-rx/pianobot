// Servidor estático mínimo para probar la app en local: node herramientas/servidor.mjs [puerto]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.musicxml': 'application/xml' };
const puerto = Number(process.argv[2] ?? 8080);

export function servir(p = puerto) {
  const servidor = createServer(async (req, res) => {
    const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const fichero = join(raiz, ruta.endsWith('/') ? `${ruta}index.html` : ruta);
    if (!fichero.startsWith(raiz)) return res.writeHead(403).end();
    try {
      const datos = await readFile(fichero);
      res.writeHead(200, { 'content-type': tipos[extname(fichero)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(datos);
    } catch {
      res.writeHead(404).end('No encontrado');
    }
  });
  return new Promise((ok) => servidor.listen(p, () => ok(servidor)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await servir();
  console.log(`pianobot en http://localhost:${puerto}`);
}
