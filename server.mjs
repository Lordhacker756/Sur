#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Sur — local server.
//
// Serves the app and a small JSON API over a SQLite file, so a singer measures
// their range once and it is still there next week. Zero dependencies: only
// node: built-ins.
//
//   node server.mjs [--port 7070] [--db sur.db] [--open]
// ---------------------------------------------------------------------------

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import { spawn } from 'node:child_process';
import { openDb } from './lib/db.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}
const PORT = Number(arg('port', process.env.SUR_PORT || 7070));
const DB_FILE = path.resolve(HERE, arg('db', process.env.SUR_DB || 'sur.db'));
const OPEN = process.argv.includes('--open');

const db = openDb(DB_FILE);

/* ------------------------------------------------------------ static --- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
};

// Only these directories are reachable, and every path is resolved and then
// checked to be inside one of them, so a crafted URL cannot walk the disk.
const ROOTS = [path.join(HERE, 'public'), path.join(HERE, 'lib')];

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const candidates = rel.startsWith('/lib/')
    ? [path.join(HERE, rel)]
    : [path.join(HERE, 'public', rel)];

  for (const file of candidates) {
    const resolved = path.resolve(file);
    if (!ROOTS.some((r) => resolved === r || resolved.startsWith(r + path.sep))) continue;
    try {
      const st = await fsp.stat(resolved);
      if (!st.isFile()) continue;
      res.writeHead(200, {
        'content-type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
        'content-length': st.size,
      });
      fs.createReadStream(resolved).pipe(res);
      return true;
    } catch { /* fall through */ }
  }
  return false;
}

/* --------------------------------------------------------------- api --- */
const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(s) });
  res.end(s);
};

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

async function api(req, res, pathname, query) {
  const seg = pathname.split('/').filter(Boolean);   // ['api', ...]
  const m = req.method;
  const body = (m === 'POST' || m === 'PUT' || m === 'PATCH') ? await readBody(req) : {};

  // GET /api/bootstrap — everything the app needs to render its first screen
  if (seg[1] === 'bootstrap' && m === 'GET') {
    const singer = db.activeSinger();
    return json(res, 200, {
      singer,
      singers: db.listSingers(),
      stats: db.stats(singer.id),
      rangeHistory: db.rangeHistory(singer.id, 20),
      sessions: db.sessions(singer.id, 20),
    });
  }

  if (seg[1] === 'singers' && m === 'GET') return json(res, 200, db.listSingers());

  if (seg[1] === 'singer' && m === 'POST' && seg.length === 2) {
    const name = String(body.name || 'Me').slice(0, 60);
    return json(res, 201, db.createSinger(name));
  }

  if (seg[1] === 'singer' && seg[2] && m === 'PUT') {
    const id = Number(seg[2]);
    if (!db.getSinger(id)) return json(res, 404, { error: 'no such singer' });
    return json(res, 200, db.updateSinger(id, body));
  }

  if (seg[1] === 'singer' && seg[2] && seg[3] === 'activate' && m === 'POST') {
    try { return json(res, 200, db.setActiveSinger(Number(seg[2]))); }
    catch { return json(res, 404, { error: 'no such singer' }); }
  }

  if (seg[1] === 'singer' && seg[2] && m === 'DELETE') {
    db.deleteSinger(Number(seg[2]));
    return json(res, 200, { ok: true });
  }

  if (seg[1] === 'range-test' && m === 'POST') {
    const singer = db.activeSinger();
    if (!(num(body.low_hz) > 0) || !(num(body.high_hz) > num(body.low_hz))) {
      return json(res, 400, { error: 'low_hz and high_hz must be positive with high above low' });
    }
    const id = db.addRangeTest(singer.id, body);
    // an accepted test becomes the singer's working range
    if (body.accepted !== false) {
      db.updateSinger(singer.id, {
        low_hz: num(body.low_hz), high_hz: num(body.high_hz),
        low_note: body.low_note ?? null, high_note: body.high_note ?? null,
        semitones: num(body.semitones), tier: body.tier ?? null,
      });
    }
    return json(res, 201, { id, singer: db.getSinger(singer.id), history: db.rangeHistory(singer.id, 20) });
  }

  if (seg[1] === 'range-tests' && m === 'GET') {
    return json(res, 200, db.rangeHistory(db.activeSinger().id, Number(query.limit) || 60));
  }

  if (seg[1] === 'session' && m === 'POST' && seg.length === 2) {
    return json(res, 201, { id: db.startSession(db.activeSinger().id, body) });
  }

  if (seg[1] === 'session' && seg[2] && m === 'PUT') {
    return json(res, 200, db.finishSession(Number(seg[2]), body));
  }

  if (seg[1] === 'sessions' && m === 'GET') {
    return json(res, 200, db.sessions(db.activeSinger().id, Number(query.limit) || 60));
  }

  if (seg[1] === 'stats' && m === 'GET') {
    return json(res, 200, db.stats(db.activeSinger().id));
  }

  return json(res, 404, { error: 'unknown endpoint', path: pathname });
}

/* ------------------------------------------------------------ server --- */
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;
  const query = Object.fromEntries(parsed.searchParams);

  try {
    if (pathname.startsWith('/api/')) return await api(req, res, pathname, query);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    if (await serveStatic(req, res, pathname)) return;
    // unknown path: fall back to the app shell so the front end can route
    if (await serveStatic(req, res, '/index.html')) return;
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String((e && e.message) || e) });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Sur may already be running — open http://localhost:${PORT}`);
    console.error(`  Or start it elsewhere:  node server.mjs --port ${PORT + 1}\n`);
    process.exit(1);
  }
  throw e;
});

// 127.0.0.1, never 0.0.0.0: this is a personal practice log, not something to
// put on the network.
server.listen(PORT, '127.0.0.1', () => {
  const singer = db.activeSinger();
  const where = `http://localhost:${PORT}`;
  console.log(`
  सुर  Sur — riyaz for your voice

  ${where}

  singer    ${singer.name}${singer.sa_hz ? `  ·  Sa ${singer.sa_note} (${singer.sa_key})` : '  ·  no range measured yet'}
  database  ${path.relative(process.cwd(), DB_FILE)}

  Your range and your practice history are saved here, so you only
  find your Sa once. Ctrl-C to stop.
`);
  if (OPEN) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try { spawn(cmd, [where], { detached: true, stdio: 'ignore' }).unref(); } catch { /* no browser, no matter */ }
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { try { db.close(); } catch {} process.exit(0); });
}
