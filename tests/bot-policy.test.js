'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { IdleServiceSupervisor } = require('../../wasm-game-framework/server/lifecycle.js');

const root = path.resolve(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'server/server.cfg'), 'utf8');
const supervisor = fs.readFileSync(path.join(root, 'server/supervisor.js'), 'utf8');
const botSource = fs.readFileSync(path.join(root, 'ioq3/code/game/g_bot.c'), 'utf8');

assert.match(config, /seta sv_maxclients 9/);
assert.match(config, /seta bot_minplayers 8/);
assert.match(config, /set d1 "map q3dm6/);
assert.match(config, /set d4 "map q3dm17 ; set nextmap vstr d1"/);
assert.match(botSource, /G_CheckMinimumPlayers/);
assert.match(botSource, /if \(\s*humanplayers \+ botplayers < minplayers\s*\)/);
assert.match(botSource, /G_RemoveRandomBot/);
assert.match(supervisor, /WASM_HUMAN_JOINED/);
assert.match(supervisor, /WASM_HUMAN_LEFT/);
assert.match(supervisor, /WASM_BOT_JOINED/);
assert.match(supervisor, /WASM_BOT_LEFT/);
assert.match(supervisor, /bots: botClients\.size/);
assert.match(supervisor, /environmentOptions\(process\.env\)/);
assert.match(supervisor, /MAP_ROTATION/);

let started;
const lifecycle = new IdleServiceSupervisor({
  maps: ['q3dm6', 'q3dm17'], random: () => 0.75,
  keepAlive: true, idleMs: 10,
  start: async detail => { started = detail; return {}; },
  stop: async () => undefined
});

(async () => {
  const status = await lifecycle.wake();
  assert.equal(started.map, 'q3dm17');
  assert.equal(status.map, 'q3dm17');
  assert.equal(status.state, 'running');
  assert.equal(lifecycle.observeHumans(1).humans, 1);
  assert.equal(lifecycle.observeHumans(0).humans, 0);
  console.log('native bot target, human lifecycle, and random rotation checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
