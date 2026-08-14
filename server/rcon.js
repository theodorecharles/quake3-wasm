'use strict';

const dgram = require('dgram');
const OOB = Buffer.from([0xff, 0xff, 0xff, 0xff]);

function sendRcon(command, options = {}) {
  if (!options.password) throw new Error('RCON password is required');
  const timeoutMs = options.timeoutMs || 1500;
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const chunks = [];
    let settled = false;
    let quietTimer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(quietTimer);
      try { socket.close(); } catch (_) { /* already closed */ }
      if (error && !chunks.length) return reject(error);
      resolve(Buffer.concat(chunks).toString('binary').replace(/\xff\xff\xff\xffprint\n?/g, ''));
    };
    const timeoutTimer = setTimeout(() => finish(new Error('rcon timeout')), timeoutMs);
    socket.on('error', finish);
    socket.on('message', (message) => {
      chunks.push(message);
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(), 75);
    });
    const payload = Buffer.concat([OOB, Buffer.from('rcon ' + options.password + ' ' + command)]);
    socket.send(payload, options.port || 27960, options.host || '127.0.0.1',
      (error) => { if (error) finish(error); });
  });
}

module.exports = { sendRcon };
