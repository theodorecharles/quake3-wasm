'use strict';

const dgram = require('dgram');
const OOB = Buffer.from([0xff, 0xff, 0xff, 0xff]);

function infoStringToObject(value) {
  const parts = String(value || '').replace(/^\\/, '').split('\\');
  const result = {};
  for (let index = 0; index + 1 < parts.length; index += 2) {
    result[parts[index]] = parts[index + 1];
  }
  return result;
}

function parsePlayerLine(line) {
  const match = /^(-?\d+)\s+(\d+)\s+"(.*)"\s*$/.exec(line);
  return match ? { score: Number(match[1]), ping: Number(match[2]), name: match[3] } : null;
}

function parseStatusResponse(packet) {
  const text = (Buffer.isBuffer(packet) ? packet.toString('binary') : String(packet))
    .replace(/^\xff\xff\xff\xff/, '');
  if (!text.startsWith('statusResponse')) throw new Error('unexpected game status response');
  const lines = text.replace(/^statusResponse\n?/, '').split('\n').filter(Boolean);
  const info = infoStringToObject(lines.shift());
  const players = lines.map(parsePlayerLine).filter(Boolean);
  return {
    info,
    players,
    map: info.mapname || '',
    hostname: info.sv_hostname || '',
    gametype: info.g_gametype || ''
  };
}

function queryStatus(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = options.port || 27960;
  const timeoutMs = options.timeoutMs || 1500;
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch (_) { /* already closed */ }
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('getstatus timeout')), timeoutMs);
    socket.on('error', (error) => finish(error));
    socket.on('message', (message) => {
      try { finish(null, parseStatusResponse(message)); } catch (error) { finish(error); }
    });
    socket.send(Buffer.concat([OOB, Buffer.from('getstatus')]), port, host,
      (error) => { if (error) finish(error); });
  });
}

module.exports = { infoStringToObject, parsePlayerLine, parseStatusResponse, queryStatus };
