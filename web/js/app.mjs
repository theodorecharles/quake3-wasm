import { normalizePlayerName, cvarTokens } from './player-name.mjs';
import { deleteCachedAsset, getCachedAsset, putCachedAsset } from './pk3-cache.mjs';
import { downloadRanges, sha256 } from './pk3-download.mjs';
import { createAdaptiveQuality, profileTokens, PROFILES } from './quality.mjs';

const gate = document.querySelector('#gate');
const startup = document.querySelector('#startup');
const form = document.querySelector('#play-form');
const nameInput = document.querySelector('#player-name');
const profileInput = document.querySelector('#profile');
const dynamicInput = document.querySelector('#dynamic');
const fpsInput = document.querySelector('#target-fps');
const terminal = document.querySelector('#terminal');
const progress = document.querySelector('#progress');
const retry = document.querySelector('#retry');
const canvas = document.querySelector('#game');
const diagnostics = document.querySelector('#diagnostics');
let activeSettings = null;
let runtime = null;
let lines = [];

function log(message) {
  const safe = String(message).replace(/[\u0000-\u0008\u000b-\u001f\u007f\u009b]|\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  lines.push(safe);
  lines = lines.slice(-15);
  terminal.textContent = lines.join('\n');
  terminal.scrollTop = terminal.scrollHeight;
}

function loadSettings() {
  nameInput.value = localStorage.getItem('q3js.playerName') || '';
  try {
    const settings = JSON.parse(localStorage.getItem('q3js.graphics') || '{}');
    if (PROFILES.some((profile) => profile.name === settings.profile)) profileInput.value = settings.profile;
    if ([30, 60, 120].includes(settings.targetFps)) fpsInput.value = String(settings.targetFps);
    if (typeof settings.dynamic === 'boolean') dynamicInput.checked = settings.dynamic;
  } catch (_) { /* use defaults */ }
}

function saveSettings() {
  const name = normalizePlayerName(nameInput.value);
  const settings = {
    name,
    profile: profileInput.value,
    profileIndex: PROFILES.findIndex((profile) => profile.name === profileInput.value),
    dynamic: dynamicInput.checked,
    targetFps: Number(fpsInput.value)
  };
  localStorage.setItem('q3js.playerName', name);
  localStorage.setItem('q3js.graphics', JSON.stringify({
    profile: settings.profile, dynamic: settings.dynamic, targetFps: settings.targetFps
  }));
  return settings;
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function wakeServer() {
  log('> waking shared arena...');
  const started = performance.now();
  const timer = setInterval(() => {
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    terminal.dataset.elapsed = seconds;
  }, 250);
  try {
    const response = await fetch('/wake', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || `wake failed (HTTP ${response.status})`);
    log(`> arena ready on ${result.map} (${((performance.now() - started) / 1000).toFixed(1)}s)`);
    return result;
  } finally { clearInterval(timer); }
}

async function assetBytes(asset, assetNumber, assetCount) {
  log(`> validating cache ${assetNumber}/${assetCount}: ${asset.path}`);
  let cached = await getCachedAsset(asset.cacheKey);
  if (cached && cached.byteLength === asset.bytes && await sha256(cached) === asset.sha256) {
    log(`> restored ${asset.path} from IndexedDB`);
    return cached;
  }
  if (cached) await deleteCachedAsset(asset.cacheKey);
  cached = null;
  log(`> downloading cache miss: ${asset.path}`);
  const bytes = await downloadRanges(asset, (loaded, total) => {
    progress.value = (assetNumber - 1 + loaded / total) / assetCount;
  });
  log(`> verified SHA-256: ${asset.path}`);
  await putCachedAsset(asset.cacheKey, bytes);
  return bytes;
}

async function installAssets(module, assets) {
  module.FS.mkdirTree('/baseq3');
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const bytes = await assetBytes(asset, index + 1, assets.length);
    module.FS.writeFile(asset.path, bytes);
    progress.value = (index + 1) / assets.length;
  }
}

function canvasSize() {
  const bounds = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  return {
    width: Math.max(640, Math.round(bounds.width * ratio)),
    height: Math.max(480, Math.round(bounds.height * ratio))
  };
}

function engineArguments(settings, config) {
  const size = canvasSize();
  canvas.width = size.width;
  canvas.height = size.height;
  return [
    ...cvarTokens('sv_pure', 0), ...cvarTokens('net_enabled', 1),
    ...cvarTokens('r_mode', -1), ...cvarTokens('r_customwidth', size.width),
    ...cvarTokens('r_customheight', size.height), ...cvarTokens('r_fullscreen', 0),
    ...cvarTokens('com_introplayed', 1), ...cvarTokens('fs_homepath', '/persist'),
    ...cvarTokens('name', settings.name), ...profileTokens(settings.profileIndex),
    '+connect', config.connect
  ];
}

function startAdaptiveQuality(settings) {
  let frames = 0;
  let windowStarted = performance.now();
  let measured = 0;
  const adaptive = createAdaptiveQuality({
    enabled: settings.dynamic,
    ceiling: settings.profileIndex,
    target: settings.targetFps,
    onChange: (level, profile) => {
      runtime?._Q3JS_SetQuality?.(level);
      log(`> dynamic quality: ${profile.name}`);
    }
  });
  diagnostics.classList.remove('hidden');
  function frame(now) {
    frames += 1;
    if (now - windowStarted >= 3000) {
      measured = frames * 1000 / (now - windowStarted);
      if (runtime?._Q3JS_IsConnected?.() === 1 && !document.hidden) adaptive.sample(measured);
      frames = 0;
      windowStarted = now;
    }
    diagnostics.textContent = `${PROFILES[adaptive.current()].name} · ${measured.toFixed(0)}/${settings.targetFps} FPS`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function installResize() {
  let timer;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const size = canvasSize();
      if (canvas.width === size.width && canvas.height === size.height) return;
      canvas.width = size.width;
      canvas.height = size.height;
      runtime?._Q3JS_Resize?.(size.width, size.height);
    }, 350);
  }).observe(canvas);
}

async function launch() {
  activeSettings = saveSettings();
  gate.classList.add('hidden');
  retry.classList.add('hidden');
  startup.classList.remove('hidden');
  lines = [];
  progress.value = 0;
  log('> quake3-wasm boot sequence');
  await nextPaint();

  const configResponse = await fetch('/config.json', { cache: 'no-store' });
  if (!configResponse.ok) throw new Error(`configuration failed (HTTP ${configResponse.status})`);
  const config = await configResponse.json();
  const wakePromise = wakeServer();
  log('> loading WebAssembly engine...');
  const { default: createEngine } = await import('/client/ioquake3.js');
  runtime = await createEngine({
    canvas,
    elementPointerLock: true,
    noInitialRun: true,
    locateFile: (name) => name.endsWith('.wasm') ? '/client/ioquake3.wasm' : '/client/' + name,
    websocket: {
      url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${config.wsPath}`,
      subprotocol: 'binary'
    },
    print: (message) => log(message),
    printErr: (message) => log(message)
  });
  await Promise.all([wakePromise, installAssets(runtime, config.assets)]);
  log('> starting authentic Quake III client...');
  startup.classList.add('hidden');
  canvas.focus();
  runtime.callMain(engineArguments(activeSettings, config));
  startAdaptiveQuality(activeSettings);
  installResize();
}

async function handleLaunch() {
  try { await launch(); } catch (error) {
    console.error(error);
    log('ERROR: ' + (error?.message || error));
    retry.classList.remove('hidden');
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); handleLaunch(); });
retry.addEventListener('click', () => { gate.classList.remove('hidden'); startup.classList.add('hidden'); });
canvas.addEventListener('click', () => {
  canvas.focus();
  if (runtime?._Q3JS_IsConnected?.() === 1 && !document.pointerLockElement) canvas.requestPointerLock?.();
});
document.addEventListener('visibilitychange', () => { if (document.hidden && document.pointerLockElement) document.exitPointerLock(); });
loadSettings();
nameInput.focus();
