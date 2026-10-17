import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

const STUB = readFileSync(join(import.meta.dirname, 'stub.js'), 'utf8');

function readStatic(dist, pathname) {
  const path = normalize(join(dist, decodeURIComponent(pathname)));
  if (!path.startsWith(dist) || !extname(path)) return null;
  try {
    return { body: readFileSync(path), type: TYPES[extname(path)] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

function artwork(pathname) {
  let seed = 0;
  for (const char of pathname) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const hue = seed % 360;
  const x = 20 + (seed % 60);
  const y = 20 + ((seed >> 8) % 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 100 100">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue} 70% 58%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 65% 22%)"/>
</linearGradient></defs>
<rect width="100" height="100" fill="url(#g)"/>
<circle cx="${x}" cy="${y}" r="${18 + (seed % 14)}" fill="hsl(${(hue + 180) % 360} 80% 70%)" opacity="0.35"/>
</svg>`;
}

function pageHtml(dist, payload) {
  const data = JSON.stringify(payload).replace(/</g, '\\u003c');
  const head = `<script>window.__SC_PREVIEW__=${data};</script><script>${STUB}</script>`;
  return readFileSync(join(dist, 'index.html'), 'utf8').replace('<head>', `<head>${head}`);
}

export function startServer(dist, payloads) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (/^\/(img|p)\//.test(url.pathname)) {
      res.writeHead(200, { 'content-type': TYPES['.svg'], 'access-control-allow-origin': '*' });
      res.end(artwork(url.pathname));
      return;
    }
    const file = readStatic(dist, url.pathname);
    if (file) {
      res.writeHead(200, { 'content-type': file.type });
      const body =
        file.type === TYPES['.css']
          ? file.body.toString('utf8').replace(/-webkit-backdrop-filter:([^;}]*)/g, '$&;backdrop-filter:$1')
          : file.body;
      res.end(body);
      return;
    }
    const payload = payloads.get(url.searchParams.get('theme'));
    if (!payload) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    res.end(pageHtml(dist, payload));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
