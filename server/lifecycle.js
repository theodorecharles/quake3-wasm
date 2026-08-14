'use strict';

function createLifecycle(options) {
  const now = options.now || Date.now;
  const log = options.log || (() => {});
  const keepAlive = !!options.keepAlive;
  const idleTimeoutMs = options.idleTimeoutMs;
  const intervalMs = options.intervalMs || Math.min(5000, Math.max(1000, idleTimeoutMs / 4));
  let state = 'sleeping';
  let map = null;
  let humans = 0;
  let lastHumanAt = now();
  let startPromise = null;
  let stopPromise = null;
  let timer = null;

  const isRunning = () => !options.isRunning || options.isRunning();
  const status = () => ({
    state, map, humans, keepAlive,
    idleTimeoutSeconds: Math.round(idleTimeoutMs / 1000),
    idleSeconds: state === 'running' && humans === 0
      ? Math.max(0, Math.floor((now() - lastHumanAt) / 1000)) : 0
  });

  async function wake(reason) {
    if (stopPromise) await stopPromise;
    if (state === 'running' && isRunning()) return status();
    if (startPromise) return startPromise;
    state = 'starting';
    log('waking dedicated server' + (reason ? ' (' + reason + ')' : ''));
    startPromise = Promise.resolve().then(options.start).then((result) => {
      state = 'running';
      map = result.map;
      humans = 0;
      lastHumanAt = now();
      log('dedicated server awake on ' + map);
      return status();
    }).catch((error) => {
      state = 'sleeping';
      map = null;
      throw error;
    }).finally(() => { startPromise = null; });
    return startPromise;
  }

  function observeHumans(count) {
    humans = Math.max(0, Number(count) || 0);
    if (humans > 0) lastHumanAt = now();
  }

  async function sleep(reason) {
    if (startPromise) await startPromise.catch(() => {});
    if (stopPromise) return stopPromise;
    if (state === 'sleeping' && !isRunning()) return status();
    state = 'stopping';
    log('stopping dedicated server' + (reason ? ' (' + reason + ')' : ''));
    stopPromise = Promise.resolve().then(options.stop).then(() => {
      state = 'sleeping'; map = null; humans = 0;
      log('dedicated server is sleeping');
      return status();
    }).finally(() => { stopPromise = null; });
    return stopPromise;
  }

  async function checkIdle() {
    if (state === 'running' && !isRunning()) return sleep('process exited');
    if (keepAlive || state !== 'running' || humans > 0) return false;
    if (now() - lastHumanAt >= idleTimeoutMs) {
      await sleep('no human players for ' + Math.round(idleTimeoutMs / 1000) + 's');
      return true;
    }
    return false;
  }

  function startMonitoring() {
    if (timer) return;
    timer = setInterval(() => checkIdle().catch((error) => log('idle monitor: ' + error.message)), intervalMs);
    timer.unref?.();
  }

  async function shutdown() {
    if (timer) clearInterval(timer);
    timer = null;
    if (state !== 'sleeping' || isRunning()) await sleep('host shutdown');
  }

  return { wake, sleep, observeHumans, checkIdle, startMonitoring, shutdown, status };
}

module.exports = { createLifecycle };
