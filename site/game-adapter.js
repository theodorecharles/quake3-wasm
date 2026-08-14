(function () {
  'use strict';

  const PROFILE_CVARS = Object.freeze({
    high: Object.freeze({ r_picmip: '0', r_lodbias: '0', r_subdivisions: '4' }),
    balanced: Object.freeze({ r_picmip: '1', r_lodbias: '1', r_subdivisions: '8' }),
    performance: Object.freeze({ r_picmip: '2', r_lodbias: '2', r_subdivisions: '16' })
  });

  let context;
  let module;
  let dataSet;
  let ownerData;
  let started = false;
  let nativeReady = false;
  let joining = false;
  let previousPointer = Object.freeze({ x: 320, y: 240 });
  let eventSlots = [];
  let nextEventSlot = 0;
  let stateTimer = 0;
  let rendererTimer = 0;
  let rendererState;
  let quality;
  let lastResize = Object.freeze({ width: 1280, height: 720 });

  function cleanName(value) {
    return String(value || 'Player').replace(/[;\n\r]/g, '').slice(0, 32) || 'Player';
  }

  function nativeString(value) {
    const bytes = new TextEncoder().encode(`${value}\0`);
    const pointer = module._malloc(bytes.length);
    globalThis.HEAPU8.set(bytes, pointer);
    return Object.freeze({ pointer, free: () => module._free(pointer) });
  }

  function setCvar(name, value) {
    if (!nativeReady) return;
    const key = nativeString(name);
    const text = nativeString(String(value));
    try { module._Cvar_Set(key.pointer, text.pointer); } finally { text.free(); key.free(); }
  }

  function getCvar(name) {
    if (!nativeReady) return '';
    const key = nativeString(name);
    try { return globalThis.Pointer_stringify(module._Cvar_VariableString(key.pointer)); } finally { key.free(); }
  }

  function allocateEventSlots() {
    if (eventSlots.length) return;
    eventSlots = Array.from({ length: 128 }, () => module._malloc(28));
  }

  function eventPointer() {
    allocateEventSlots();
    const pointer = eventSlots[nextEventSlot];
    nextEventSlot = (nextEventSlot + 1) % eventSlots.length;
    globalThis.HEAPU8.fill(0, pointer, pointer + 28);
    return pointer;
  }

  function pushMouseMove(x, y, dx, dy) {
    if (!nativeReady || !globalThis.SDL) return;
    if (rendererState && (dx || dy)) rendererState.motionEvents += 1;
    const pointer = eventPointer();
    globalThis.HEAP32[pointer >> 2] = 0x400;
    globalThis.HEAPU8[pointer + 8] = globalThis.SDL.buttonState || 0;
    globalThis.HEAP32[(pointer + 12) >> 2] = Math.round(x);
    globalThis.HEAP32[(pointer + 16) >> 2] = Math.round(y);
    globalThis.HEAP32[(pointer + 20) >> 2] = Math.round(dx);
    globalThis.HEAP32[(pointer + 24) >> 2] = Math.round(dy);
    globalThis.SDL.events.push(pointer);
  }

  function pushMouseButton(button, pressed, x, y) {
    if (!nativeReady || !globalThis.SDL) return;
    const pointer = eventPointer();
    globalThis.HEAP32[pointer >> 2] = pressed ? 0x401 : 0x402;
    globalThis.HEAPU8[pointer + 8] = Number(button) + 1;
    globalThis.HEAPU8[pointer + 9] = pressed ? 1 : 0;
    globalThis.HEAP32[(pointer + 12) >> 2] = Math.round(x);
    globalThis.HEAP32[(pointer + 16) >> 2] = Math.round(y);
    const mask = 1 << Number(button);
    globalThis.SDL.buttonState = pressed ? globalThis.SDL.buttonState | mask : globalThis.SDL.buttonState & ~mask;
    globalThis.SDL.events.push(pointer);
  }

  function pushEscape() {
    if (!nativeReady || !globalThis.SDL) return;
    for (const pressed of [true, false]) {
      const pointer = eventPointer();
      globalThis.HEAP32[pointer >> 2] = pressed ? 0x300 : 0x301;
      globalThis.HEAPU8[pointer + 8] = pressed ? 1 : 0;
      globalThis.HEAP32[(pointer + 12) >> 2] = 41;
      globalThis.HEAP32[(pointer + 16) >> 2] = 27;
      globalThis.HEAP32[(pointer + 24) >> 2] = 27;
      globalThis.SDL.events.push(pointer);
    }
  }

  function profileValues(values) {
    return PROFILE_CVARS[values.qualityProfile] || PROFILE_CVARS.balanced;
  }

  function applyPreferences(values) {
    if (!nativeReady) return;
    setCvar('name', cleanName(values.playerName));
    setCvar('com_maxfps', Math.max(20, Math.min(240, Number(values.targetFps) || 60)));
    for (const [name, value] of Object.entries(profileValues(values))) setCvar(name, value);
    quality?.setEnabled(values.dynamicQuality);
    quality?.setTargetFps(values.targetFps);
  }

  function updateEngineState() {
    if (!nativeReady) return;
    const menu = getCvar('ui_nativeMenu') === '1';
    const active = getCvar('cg_wasmActive') === '1';
    const paused = getCvar('cl_paused') === '1';
    if (menu) context.setEngineState(paused ? 'paused' : 'menu');
    else if (active) context.setEngineState('gameplay');
    else context.setEngineState('loading');
  }

  async function requestJoin() {
    setCvar('ui_joinGameRequested', '0');
    if (joining) return;
    joining = true;
    setCvar('ui_joinGameStatus', 'WAKING ARENA...');
    try {
      const wake = context.framework.createWakeClient({
        statusUrl: '/status', wakeUrl: '/wake', timeout: 60000,
        onStatus: status => {
          const label = status?.state === 'running' ? 'ARENA READY' : `ARENA ${String(status?.state || 'STARTING').toUpperCase()}`;
          setCvar('ui_joinGameStatus', label);
        }
      });
      const status = await wake.ensureRunning({ playerName: cleanName(context.preferences.values().playerName) });
      const port = location.port || (location.protocol === 'https:' ? '443' : '80');
      setCvar('ui_joinGameAddress', `${location.hostname}:${port}`);
      setCvar('ui_joinGameStatus', `JOINING ${String(status.map || 'ARENA').toUpperCase()}...`);
      setCvar('ui_joinGameReady', '1');
    } catch (error) {
      setCvar('ui_joinGameStatus', 'ARENA UNAVAILABLE');
      context.log(error?.stack || error);
    } finally {
      joining = false;
    }
  }

  function monitor() {
    clearInterval(stateTimer);
    stateTimer = setInterval(() => {
      if (getCvar('ui_joinGameRequested') === '1') requestJoin();
      updateEngineState();
    }, 100);
  }

  function rendererDiagnostics() {
    const diagnostics = {
      samples: 0,
      motionEvents: 0,
      errors: [],
      anomalies: [],
      stateChanges: [],
      lastSize: null,
      lastViewport: null,
      lastDepthRange: null,
      matrixVersionChanges: 0
    };
    rendererState = diagnostics;
    globalThis.__q3RendererDiagnostics = diagnostics;
    let priorSignature = '';
    let priorMatrixVersion = '';
    clearInterval(rendererTimer);
    rendererTimer = setInterval(() => {
      const gl = globalThis.GLctx;
      if (!gl || diagnostics.samples >= 120) return;
      diagnostics.samples += 1;
      diagnostics.lastSize = { width: module.canvas.width, height: module.canvas.height };
      const viewport = Array.from(gl.getParameter(gl.VIEWPORT));
      const depthRange = Array.from(gl.getParameter(gl.DEPTH_RANGE));
      diagnostics.lastViewport = viewport;
      diagnostics.lastDepthRange = depthRange;
      if ((viewport[2] <= 0 || viewport[3] <= 0 || viewport[0] < 0 || viewport[1] < 0 ||
          viewport[0] + viewport[2] > module.canvas.width || viewport[1] + viewport[3] > module.canvas.height) &&
          diagnostics.anomalies.length < 12) {
        diagnostics.anomalies.push({ sample: diagnostics.samples, kind: 'viewport', viewport, size: diagnostics.lastSize });
      }
      if ((!Number.isFinite(depthRange[0]) || !Number.isFinite(depthRange[1]) || depthRange[0] > depthRange[1]) &&
          diagnostics.anomalies.length < 12) {
        diagnostics.anomalies.push({ sample: diagnostics.samples, kind: 'depth-range', depthRange });
      }
      const immediate = globalThis.GLImmediate;
      const matrixVersion = JSON.stringify(Array.from(immediate?.matrixVersion || []));
      if (priorMatrixVersion && matrixVersion !== priorMatrixVersion) diagnostics.matrixVersionChanges += 1;
      priorMatrixVersion = matrixVersion;
      const buffers = globalThis.GL?.buffers || [];
      const arrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
      const elementBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
      const signature = JSON.stringify({
        arrayBuffer: arrayBuffer ? buffers.indexOf(arrayBuffer) : 0,
        elementBuffer: elementBuffer ? buffers.indexOf(elementBuffer) : 0,
        stride: Number(immediate?.stride ?? -1),
        matrixVersion,
        attributes: Array.from(immediate?.clientAttributes || []).map((attribute, index) => attribute &&
          immediate.enabledClientAttributes?.[index] ? {
            index,
            size: attribute.size,
            type: attribute.type,
            stride: attribute.stride,
            pointer: attribute.pointer,
            offset: attribute.offset
          } : null).filter(Boolean)
      });
      if (signature !== priorSignature && diagnostics.stateChanges.length < 24) {
        diagnostics.stateChanges.push({ sample: diagnostics.samples, ...JSON.parse(signature) });
        priorSignature = signature;
      }
      const error = gl.getError();
      if (error !== gl.NO_ERROR && diagnostics.errors.length < 12) {
        diagnostics.errors.push({ sample: diagnostics.samples, error });
        context.log(`[renderer] WebGL error 0x${error.toString(16)}`);
      }
    }, 250);
  }

  async function loadEngine() {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/ioquake3.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load the QuakeJS client engine.'));
      document.head.appendChild(script);
    });
  }

  globalThis.WasmGameAdapter = Object.freeze({
    async init(nextContext) {
      context = nextContext;
      const policy = await fetch('/wasm-game-data.json', { cache: 'no-store' }).then(response => response.json());
      dataSet = context.framework.createOwnerDataSet(policy);
      context.elements.canvas.addEventListener('contextmenu', event => event.preventDefault());
      document.addEventListener('pointermove', event => {
        if (!nativeReady || document.pointerLockElement !== context.elements.canvas) return;
        pushMouseMove(0, 0, event.movementX || 0, event.movementY || 0);
      }, true);
      document.addEventListener('pointerdown', event => {
        if (nativeReady && document.pointerLockElement === context.elements.canvas) pushMouseButton(event.button, true, 0, 0);
      }, true);
      document.addEventListener('pointerup', event => {
        if (nativeReady && document.pointerLockElement === context.elements.canvas) pushMouseButton(event.button, false, 0, 0);
      }, true);
    },

    async start() {
      if (started) {
        context.showRuntime('menu');
        return;
      }
      started = true;
      context.setLoading('Restoring Quake III PAKs…', 'Browser cache and container files are being validated.', 5);
      ownerData = await context.dataClient.load(dataSet, {
        onProgress: detail => {
          const position = Number(detail.index || 0) + 1;
          context.setLoading(`Restoring Quake III PAKs (${position}/9)…`, detail.phase || '', Math.min(60, position * 6));
        }
      });

      const uiPatch = await fetch('/q3-framework-ui.pk3').then(response => {
        if (!response.ok) throw new Error('The framework UI QVM patch is missing.');
        return response.blob();
      });
      const patchFile = new File([uiPatch], 'zz_wasm_framework.pk3', { type: 'application/zip' });
      const entries = [...ownerData.entries, { file: patchFile, mountName: patchFile.name }];

      const values = context.preferences.values();
      const width = Math.max(640, lastResize.width);
      const height = Math.max(480, lastResize.height);
      const profile = profileValues(values);
      globalThis.ioq3 = {
        noInitialRun: true,
        noImageDecoding: true,
        noAudioDecoding: true,
        canvas: context.elements.canvas,
        viewport: context.elements.runtime,
        elementPointerLock: false,
        print: value => context.log(value),
        printErr: value => context.log(value),
        exitHandler: () => context.setEngineState('crashed')
      };
      await loadEngine();
      module = globalThis.ioq3;
      globalThis.SYSC.FS_Startup = callback => {
        context.framework.mountOwnerFiles(globalThis.FS, entries, { root: '/base/baseq3' })
          .then(() => callback(null), callback);
      };
      globalThis.SYSC.FS_Shutdown = callback => callback(null);
      globalThis.SYS.LoadingDescription = value => value && context.setLoading(String(value), '', 70);
      globalThis.SYS.LoadingProgress = value => context.setLoading(undefined, undefined, 70 + Math.round((Number(value) || 0) * 20));
      globalThis.SYS.PromptEULA = callback => callback(new Error('Owner PAK validation unexpectedly requested the demo installer.'));
      context.setLoading('Starting the QuakeJS engine…', `${width} × ${height}`, 70);
      module.callMain([
        '+set', 'fs_homepath', '/base', '+set', 'fs_basepath', '/base', '+set', 'fs_game', 'baseq3',
        '+set', 'com_introplayed', '1', '+set', 'com_hunkMegs', '256', '+set', 'r_mode', '-1',
        '+set', 'r_customwidth', String(width), '+set', 'r_customheight', String(height),
        '+set', 'r_allowResize', '1', '+set', 'r_fullscreen', '0', '+set', 's_useOpenAL', '0',
        '+set', 'name', cleanName(values.playerName), '+set', 'com_maxfps', String(values.targetFps),
        '+set', 'r_picmip', profile.r_picmip, '+set', 'r_lodbias', profile.r_lodbias,
        '+set', 'r_subdivisions', profile.r_subdivisions
      ]);
      nativeReady = true;
      applyPreferences(values);
      quality = context.framework.createQualityController({
        profiles: ['high', 'balanced', 'performance'],
        initialIndex: Math.max(0, ['high', 'balanced', 'performance'].indexOf(values.qualityProfile)),
        targetFps: values.targetFps,
        enabled: values.dynamicQuality,
        apply: profileName => {
          for (const [name, value] of Object.entries(PROFILE_CVARS[profileName])) setCvar(name, value);
        }
      });
      quality.start();
      context.showRuntime('menu');
      monitor();
      rendererDiagnostics();
    },

    readEngineState() {
      if (!started) return 'launcher';
      if (!nativeReady) return 'loading';
      if (getCvar('ui_nativeMenu') === '1') return getCvar('cl_paused') === '1' ? 'paused' : 'menu';
      return getCvar('cg_wasmActive') === '1' ? 'gameplay' : 'loading';
    },

    resize(detail) {
      lastResize = Object.freeze({ width: Math.max(640, detail.requestedWidth), height: Math.max(480, detail.requestedHeight) });
      if (!nativeReady || typeof module.setCanvasSize !== 'function') return;
      if (module.canvas.width === lastResize.width && module.canvas.height === lastResize.height) return;
      module.setCanvasSize(lastResize.width, lastResize.height);
    },

    pointerMove(detail) {
      if (!nativeReady) return;
      pushMouseMove(detail.x, detail.y, detail.x - previousPointer.x, detail.y - previousPointer.y);
      previousPointer = Object.freeze({ x: detail.x, y: detail.y });
    },

    pointerButton(detail) {
      if (!nativeReady) return;
      pushMouseButton(detail.button, detail.pressed, detail.x, detail.y);
    },

    captureLost() { pushEscape(); },
    preferencesChanged(values) { applyPreferences(values); }
  });
})();
