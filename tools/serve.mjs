#!/usr/bin/env node
/**
 * Tiny static server for local development (ES modules don't load from file://).
 * Zero dependencies.  Usage:  node tools/serve.mjs [port]   (default 8080)
 */
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The game lives in site/ (that folder is what Cloudflare publishes); tools/ is served too for dev pages.
export const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const ROOT = resolve(REPO, 'site');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export function startServer({ port = 8080, host = '127.0.0.1', root = ROOT, quiet = false } = {}) {
  const server = http.createServer((req, res) => {
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (path === '/__blank') {
      // Same-origin empty page used by tools/shots.mjs to wipe storage without booting the game.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        .end('<!doctype html><title>blank</title><link rel="icon" href="data:,">');
      return;
    }
    if (path.endsWith('/')) path += 'index.html';
    const base = root === ROOT && path.startsWith('/tools/') ? REPO : root;
    const file = resolve(base, `.${path}`);
    if (file !== base && !file.startsWith(base + sep)) {
      res.writeHead(403).end();
      return;
    }
    let st;
    try {
      st = statSync(file);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    if (st.isDirectory()) {
      res.writeHead(301, { Location: `${path}/` }).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      const actual = server.address().port;
      const url = `http://${host}:${actual}/`;
      if (!quiet) console.log(`Wysepka: ${url}`);
      done({ server, port: actual, url });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] || process.env.PORT || 8080);
  startServer({ port }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
