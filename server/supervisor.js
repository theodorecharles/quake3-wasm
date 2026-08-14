'use strict';

const config = require('./config');
const { fillPlan } = require('./botfill');
const { sendRcon } = require('./rcon');

const BOT_NAMES = Object.freeze([
  'Sarge', 'Major', 'Xaero', 'Anarki', 'Slash', 'Ranger', 'Mynx', 'Orbb',
  'Klesk', 'Visor', 'Bitterman', 'Sorlag', 'Crash', 'Hunter', 'Doom', 'Uriel'
]);

function parseRconStatus(text) {
  const players = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    // Current ioquake3 prints: slot, score, ping/state, padded name,
    // color-reset-prefixed address, and rate. Parse from the stable address
    // suffix so names containing spaces or Quake color codes remain intact.
    const match = /^\s*(\d+)\s+(-?\d+)\s+(\d+|CON|ZMB)\s+(.+?)\s+\^7(\S+)\s+(\d+)\s*$/.exec(line);
    if (match) {
      const address = match[5];
      players.push({
        slot: Number(match[1]), score: Number(match[2]),
        ping: /^\d+$/.test(match[3]) ? Number(match[3]) : null,
        name: match[4], address,
        kind: address.toLowerCase() === 'bot' ? 'bot' : 'human'
      });
    }
  }
  return {
    players,
    humans: players.filter((player) => player.kind === 'human').length,
    bots: players.filter((player) => player.kind === 'bot').length
  };
}

function createSupervisor(options = {}) {
  const rcon = (command) => sendRcon(command, {
    host: '127.0.0.1', port: config.DEDICATED_PORT, password: options.password
  });
  const log = options.log || (() => {});
  let timer = null;
  let busy = false;
  let nameIndex = 0;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const roster = parseRconStatus(await rcon('status'));
      options.onHumans?.(roster.humans);
      const plan = fillPlan({ humans: roster.humans, bots: roster.bots, slots: config.SLOTS });
      for (let index = 0; index < plan.remove; index += 1) {
        const bot = roster.players.filter((player) => player.kind === 'bot')[index];
        if (bot) { log('botfill remove: clientkick ' + bot.slot); await rcon('clientkick ' + bot.slot); }
      }
      for (let index = 0; index < plan.add; index += 1) {
        const name = BOT_NAMES[nameIndex++ % BOT_NAMES.length];
        const command = 'addbot ' + name + ' ' + config.BOT_SKILL + ' free 0';
        log('botfill add: ' + command);
        await rcon(command);
      }
      return { roster, plan };
    } catch (error) {
      log('bot supervisor: ' + error.message);
      return null;
    } finally { busy = false; }
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, options.intervalMs || 3500);
    timer.unref?.();
    tick();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { start, stop, tick };
}

module.exports = { BOT_NAMES, parseRconStatus, createSupervisor };
