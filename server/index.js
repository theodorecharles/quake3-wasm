'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const config = require('./config');
const dedicated = require('./dedicated');
const { createLifecycle } = require('./lifecycle');
const { queryStatus } = require('./status');
const { createSupervisor } = require('./supervisor');
const { attachWsProxy } = require('./ws-proxy');

const MIME = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.pk3': 'application/octet-stream',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm'
};

function log(message) {
  console.log('[' + new Date().toISOString() + '] ' + message);
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    do { read = fs.readSync(fd, buffer, 0, buffer.length, null); if (read) hash.update(buffer.subarray(0, read)); }
    while (read);
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function assetManifest() {
  const base = path.join(config.DATA_ROOT, 'baseq3');
  return Array.from({ length: 9 }, (_, index) => {
    const name = 'pak' + index + '.pk3';
    const file = path.join(base, name);
    const sha256 = hashFile(file);
    return {
      path: '/baseq3/' + name,
      url: '/baseq3/' + name + '?v=' + sha256.slice(0, 16),
      bytes: fs.statSync(file).size,
      sha256,
      cacheKey: name + '@sha256:' + sha256
    };
  });
}

function safeJoin(root, requested) {
  let decoded;
  try { decoded = decodeURIComponent(String(requested || '/').split('?')[0]); } catch (_) { return null; }
  const file = path.normalize(path.join(root, decoded.replace(/^\/+/, '')));
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

function sendJson(res, code, object) {
  res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(object));
}

function sendFile(req, res, file) {
  let stat;
  try { stat = fs.statSync(file); } catch (_) { res.writeHead(404); res.end('not found\n'); return; }
  if (!stat.isFile()) { res.writeHead(404); res.end('not found\n'); return; }
  const ext = path.extname(file).toLowerCase();
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': ext === '.pk3' ? 'public, max-age=3600' :
      (ext === '.js' || ext === '.wasm' ? 'no-store' : 'no-cache')
  };
  const match = req.headers.range && /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
  if (req.headers.range) {
    const start = match ? Number(match[1]) : -1;
    const end = match && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < 0 || start >= stat.size || end < start) {
      res.writeHead(416, { ...headers, 'content-range': 'bytes */' + stat.size }); res.end(); return;
    }
    res.writeHead(206, { ...headers, 'content-range': 'bytes ' + start + '-' + end + '/' + stat.size,
      'content-length': String(end - start + 1) });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': String(stat.size) });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
}

function createHost() {
  dedicated.assertGameData();
  const assets = assetManifest();
  let supervisor = null;
  let lifecycle;

  async function startMatch() {
    const map = dedicated.chooseStartMap();
    dedicated.start(map, log);
    try { await dedicated.waitUntilReady(); } catch (error) { await dedicated.stop(); throw error; }
    supervisor = createSupervisor({
      password: dedicated.RCON_PASSWORD,
      log,
      onHumans: (humans) => lifecycle.observeHumans(humans)
    });
    supervisor.start();
    return { map };
  }

  async function stopMatch() {
    supervisor?.stop();
    supervisor = null;
    await dedicated.stop();
  }

  lifecycle = createLifecycle({
    keepAlive: config.KEEP_ALIVE,
    idleTimeoutMs: config.IDLE_TIMEOUT_SECONDS * 1000,
    isRunning: dedicated.isRunning,
    start: startMatch,
    stop: stopMatch,
    log
  });

  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/health') return sendJson(res, 200, { ok: true, ...lifecycle.status() });
    if (urlPath === '/wake') {
      if (req.method !== 'POST') { res.setHeader('allow', 'POST'); return sendJson(res, 405, { error: 'POST required' }); }
      return lifecycle.wake('browser Play button')
        .then((state) => sendJson(res, 200, { ok: true, ...state }))
        .catch((error) => sendJson(res, 503, { ok: false, error: error.message }));
    }
    if (urlPath === '/status') {
      if (lifecycle.status().state !== 'running') return sendJson(res, 200, { sleeping: true, players: [], ...lifecycle.status() });
      return queryStatus({ port: config.DEDICATED_PORT })
        .then((status) => sendJson(res, 200, { ...status, ...lifecycle.status() }))
        .catch((error) => sendJson(res, 503, { error: error.message, ...lifecycle.status() }));
    }
    if (urlPath === '/config.json') {
      return sendJson(res, 200, {
        connect: '127.0.0.1:' + config.DEDICATED_PORT,
        wsPath: '/ws', slots: config.SLOTS, maps: config.MAPS, assets,
        server: lifecycle.status()
      });
    }
    if (urlPath.startsWith('/baseq3/')) {
      const file = safeJoin(path.join(config.DATA_ROOT, 'baseq3'), urlPath.slice('/baseq3'.length));
      return file ? sendFile(req, res, file) : sendJson(res, 400, { error: 'invalid path' });
    }
    const requested = urlPath === '/' ? '/index.html' : urlPath;
    const file = safeJoin(config.WEB_ROOT, requested);
    return file ? sendFile(req, res, file) : sendJson(res, 400, { error: 'invalid path' });
  });

  const wss = attachWsProxy(server, {
    path: '/ws', destHost: '127.0.0.1', destPort: config.DEDICATED_PORT,
    ensureDedicated: lifecycle.wake
  });
  lifecycle.startMonitoring();

  async function start() {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.HTTP_PORT, '0.0.0.0', resolve);
    });
    log('quake3-wasm listening on http://0.0.0.0:' + config.HTTP_PORT);
    if (config.KEEP_ALIVE) await lifecycle.wake('KEEP_ALIVE=true');
    return server;
  }

  async function shutdown() {
    wss.clients.forEach((ws) => ws.close(1001, 'server shutting down'));
    await lifecycle.shutdown();
    await new Promise((resolve) => server.close(resolve));
  }

  return { server, wss, lifecycle, assets, start, shutdown };
}

if (require.main === module) {
  let host;
  try { host = createHost(); } catch (error) { console.error(error.message); process.exit(1); }
  host.start().catch((error) => { console.error(error); process.exit(1); });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    host.shutdown().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { hashFile, assetManifest, safeJoin, sendFile, createHost };
