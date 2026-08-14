'use strict';

const dgram = require('dgram');
const { WebSocketServer } = require('ws');
const PORT_MAGIC = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x70, 0x6f, 0x72, 0x74]);

function isPortAnnouncement(packet) {
  return packet.length === 10 && packet.subarray(0, 8).equals(PORT_MAGIC);
}

function attachWsProxy(server, options = {}) {
  const wss = new WebSocketServer({ server, path: options.path || '/ws' });
  wss.on('connection', (ws) => {
    const udp = dgram.createSocket('udp4');
    let ready = !options.ensureDedicated;
    let wakePromise = null;
    let pending = [];
    let pendingBytes = 0;

    const wake = () => {
      if (wakePromise || ready) return;
      wakePromise = Promise.resolve(options.ensureDedicated('browser game connection')).then(() => {
        ready = true;
        pending.forEach((packet) => udp.send(packet, options.destPort, options.destHost || '127.0.0.1'));
        pending = [];
        pendingBytes = 0;
      }).catch(() => ws.close(1013, 'game server wake failed'));
    };

    udp.bind(0, '127.0.0.1');
    udp.on('message', (message) => {
      if (ws.readyState === ws.OPEN) ws.send(message, { binary: true });
    });
    udp.on('error', () => { try { ws.close(1011, 'UDP proxy failed'); } catch (_) {} });
    ws.on('message', (data) => {
      const packet = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (isPortAnnouncement(packet)) return;
      if (!ready) {
        if (pending.length >= 256 || pendingBytes + packet.length > 1024 * 1024) {
          return ws.close(1009, 'too much queued game data');
        }
        pending.push(Buffer.from(packet));
        pendingBytes += packet.length;
        wake();
        return;
      }
      udp.send(packet, options.destPort, options.destHost || '127.0.0.1');
    });
    const cleanup = () => {
      pending = [];
      try { udp.close(); } catch (_) { /* already closed */ }
    };
    ws.once('close', cleanup);
    ws.once('error', cleanup);
  });
  return wss;
}

module.exports = { PORT_MAGIC, isPortAnnouncement, attachWsProxy };
