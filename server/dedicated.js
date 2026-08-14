'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const { queryStatus } = require('./status');

const RCON_FILE = path.join(config.RUNTIME_ROOT, '.rcon-password');
const LAST_MAP_FILE = path.join(config.RUNTIME_ROOT, '.last-start-map');
let child = null;

function writeFileIfChanged(file, contents, mode = 0o644) {
  try { if (fs.readFileSync(file, 'utf8') === contents) return; } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode });
}

function rconPassword() {
  if (process.env.Q3JS_RCON) return process.env.Q3JS_RCON;
  try {
    const value = fs.readFileSync(RCON_FILE, 'utf8').trim();
    if (value.length >= 16) return value;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const value = crypto.randomBytes(24).toString('hex');
  writeFileIfChanged(RCON_FILE, value + '\n', 0o600);
  return value;
}

const RCON_PASSWORD = rconPassword();

function assertGameData() {
  const baseq3 = path.join(config.DATA_ROOT, 'baseq3');
  const missing = Array.from({ length: 9 }, (_, index) => 'pak' + index + '.pk3')
    .filter((name) => !fs.existsSync(path.join(baseq3, name)));
  if (missing.length) {
    throw new Error('Quake III data missing from ' + baseq3 + ': ' + missing.join(', ') +
      '. Set Q3_PATH and run npm run setup:data.');
  }
}

function prepareRuntime() {
  fs.mkdirSync(path.join(config.RUNTIME_ROOT, 'baseq3', 'vm'), { recursive: true });
  const builtVm = path.join(config.ROOT, 'build', 'dedicated', 'baseq3', 'vm');
  if (fs.existsSync(builtVm)) {
    for (const name of fs.readdirSync(builtVm)) {
      if (name.endsWith('.qvm')) {
        fs.copyFileSync(path.join(builtVm, name), path.join(config.RUNTIME_ROOT, 'baseq3', 'vm', name));
      }
    }
  }
}

function chooseStartMap(options = {}) {
  const maps = (options.maps || config.MAPS).slice();
  const stateFile = options.stateFile || LAST_MAP_FILE;
  const randomInt = options.randomInt || crypto.randomInt;
  let previous = '';
  try { previous = fs.readFileSync(stateFile, 'utf8').trim().toLowerCase(); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const choices = maps.length > 1 ? maps.filter((map) => map.toLowerCase() !== previous) : maps;
  const selected = choices[randomInt(choices.length)];
  writeFileIfChanged(stateFile, selected + '\n');
  return selected;
}

function launchArgs(map) {
  return [
    '+set', 'fs_basepath', config.DATA_ROOT,
    '+set', 'fs_homepath', config.RUNTIME_ROOT,
    '+set', 'dedicated', '1',
    '+set', 'net_port', String(config.DEDICATED_PORT),
    '+set', 'sv_maxclients', String(Math.min(64, config.SLOTS + 1)),
    '+set', 'sv_hostname', 'quake3-wasm Shared Match',
    '+set', 'sv_pure', '0',
    '+set', 'sv_allowDownload', '0',
    '+set', 'sv_master1', '',
    '+set', 'rconpassword', RCON_PASSWORD,
    '+set', 'g_gametype', '0',
    '+set', 'fraglimit', '30',
    '+set', 'timelimit', '15',
    '+set', 'bot_enable', '1',
    '+set', 'bot_nochat', '0',
    '+map', map
  ];
}

function isRunning() {
  return !!child && child.exitCode === null && !child.killed;
}

function start(map, log = console.log) {
  assertGameData();
  prepareRuntime();
  if (!fs.existsSync(config.DEDICATED_BIN)) {
    throw new Error('dedicated server missing: run npm run build:server');
  }
  if (isRunning()) throw new Error('dedicated server is already running');
  child = spawn(config.DEDICATED_BIN, launchArgs(map), {
    cwd: config.RUNTIME_ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const active = child;
  const emit = (data) => String(data).split(/\r?\n/).filter(Boolean)
    .forEach((line) => log('[ioq3ded] ' + line));
  active.stdout.on('data', emit);
  active.stderr.on('data', emit);
  active.on('exit', (code, signal) => {
    log('dedicated process exited (' + (signal || code) + ')');
    if (child === active) child = null;
  });
  active.on('error', (error) => log('dedicated process error: ' + error.message));
  return active;
}

async function waitUntilReady(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (!isRunning()) throw new Error('dedicated server exited during startup');
    try { return await queryStatus({ port: config.DEDICATED_PORT, timeoutMs: 700 }); } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('dedicated server was not ready in time: ' + (lastError?.message || 'timeout'));
}

async function stop(timeoutMs = 8000) {
  if (!isRunning()) { child = null; return; }
  const active = child;
  active.kill('SIGTERM');
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    active.once('exit', finish);
    const timer = setTimeout(() => { try { active.kill('SIGKILL'); } catch (_) {} finish(); }, timeoutMs);
  });
  if (child === active) child = null;
}

module.exports = {
  RCON_FILE, RCON_PASSWORD, LAST_MAP_FILE, assertGameData, prepareRuntime,
  chooseStartMap, launchArgs, isRunning, start, waitUntilReady, stop
};
