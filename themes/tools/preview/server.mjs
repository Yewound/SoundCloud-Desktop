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

function pageHtml(dist, payload) {
  const data = JSON.stringify(payload).replace(/</g, '\\u003c');
  const head = `<script>window.__SC_PREVIEW__=${data};</script><script>${STUB}</script>`;
  return readFileSync(join(dist, 'index.html'), 'utf8').replace('<head>', `<head>${head}`);
}

export function startServer(dist, payloads) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = readStatic(dist, url.pathname);
    if (file) {
      res.writeHead(200, { 'content-type': file.type });
      res.end(file.body);
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
