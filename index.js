/* =====================================================================
   Servidor - Dominio & Coffee
   - Sin dependencias: solo módulos nativos de Node.js (>= 18)
   - Sirve la carpeta /public de forma segura
   - Uso:  node index.js      (o)   npm start
   - Puerto: variable de entorno PORT (por defecto 3000)
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt']);

// Cabeceras de seguridad (complementan la CSP que ya trae el index.html)
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer-when-downgrade',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Cross-Origin-Opener-Policy': 'same-origin'
};

// Horario de atención (hora de Colombia, UTC-5): 10:00 - 16:30
function estadoTienda() {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false
  });
  const [h, m] = fmt.format(new Date()).split(':').map(Number);
  const minutos = h * 60 + m;
  const abierto = minutos >= 10 * 60 && minutos < 16 * 60 + 30;
  return { abierto, horario: '10:00 am - 4:30 pm', zona: 'America/Bogota' };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
}

function serveFile(req, res, filePath, statusCode = 200) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return notFound(req, res);

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=86400';

    if (req.headers['if-none-match'] === etag && statusCode === 200) {
      return send(res, 304, '', { ETag: etag, 'Cache-Control': cache });
    }

    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': type,
      'Cache-Control': cache,
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString()
    };

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => send(res, 500, 'Error interno del servidor'));

    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (COMPRESSIBLE.has(ext) && acceptsGzip) {
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      res.writeHead(statusCode, headers);
      if (req.method === 'HEAD') return res.end();
      stream.pipe(zlib.createGzip()).pipe(res);
    } else {
      headers['Content-Length'] = stat.size;
      res.writeHead(statusCode, headers);
      if (req.method === 'HEAD') return res.end();
      stream.pipe(res);
    }
  });
}

function notFound(req, res) {
  const page404 = path.join(PUBLIC_DIR, '404.html');
  if (fs.existsSync(page404)) return serveFile(req, res, page404, 404);
  send(res, 404, '404 - Página no encontrada', { 'Content-Type': 'text/plain; charset=utf-8' });
}

const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return send(res, 405, 'Método no permitido', { Allow: 'GET, HEAD' });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Solicitud inválida');
  }

  // Endpoints de API
  if (pathname === '/health') return sendJson(res, 200, { ok: true, uptime: process.uptime() });
  if (pathname === '/api/estado') return sendJson(res, 200, estadoTienda());

  // Bloquear bytes nulos y rutas ocultas (.git, .env, etc.)
  if (pathname.includes('\0') || /(^|\/)\.[^/]/.test(pathname)) {
    return send(res, 403, 'Acceso denegado');
  }

  if (pathname === '/') pathname = '/index.html';

  // Protección contra path traversal: la ruta final debe quedar dentro de /public
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return send(res, 403, 'Acceso denegado');
  }

  serveFile(req, res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log('☕ Dominio & Coffee - servidor activo');
  console.log(`   Local:  http://localhost:${PORT}`);
  console.log(`   Salud:  http://localhost:${PORT}/health`);
});

// Cierre ordenado (Ctrl+C / despliegues)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\nRecibido ${sig}, cerrando servidor...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
