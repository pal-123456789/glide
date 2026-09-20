#!/usr/bin/env node
/* serve.js — tiny zero-dependency static server for Glide.
 *
 * WHY THIS EXISTS: Glide uses ES modules (`import ...`). Browsers refuse to
 * load ES modules over the file:// protocol (CORS), so double-clicking
 * index.html leaves every button dead. Serving over http:// fixes it.
 *
 *   node serve.js            # serves this folder on http://localhost:8080
 *   node serve.js 3000       # ...on port 3000
 *
 * (GitHub Pages serves over https, so the deployed site needs none of this.)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2], 10) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    // prevent path traversal outside ROOT
    const safe = path.normalize(path.join(ROOT, urlPath));
    if (!safe.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

    fs.stat(safe, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('404 Not Found: ' + urlPath);
      }
      const ext = path.extname(safe).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(safe).pipe(res);
    });
  } catch (e) {
    res.writeHead(500); res.end('Server error');
  }
});

server.listen(PORT, () => {
  console.log('\n  Glide is being served at:');
  console.log('    \x1b[36mhttp://localhost:' + PORT + '/\x1b[0m        (landing page)');
  console.log('    \x1b[36mhttp://localhost:' + PORT + '/app.html\x1b[0m  (the app)\n');
  console.log('  Press Ctrl+C to stop.\n');
});
