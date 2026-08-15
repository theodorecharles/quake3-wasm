"use strict";

(() => {
  const profileArgs = Object.freeze({
    medium: ["+set", "r_picmip", "1", "+set", "r_vertexLight", "0", "+set", "r_dynamiclight", "0", "+set", "r_lodbias", "2", "+set", "r_subdivisions", "8"],
    high: ["+set", "r_picmip", "0", "+set", "r_vertexLight", "0", "+set", "r_dynamiclight", "1", "+set", "r_lodbias", "1", "+set", "r_subdivisions", "4"],
    ultra: ["+set", "r_picmip", "0", "+set", "r_vertexLight", "0", "+set", "r_dynamiclight", "1", "+set", "r_lodbias", "0", "+set", "r_subdivisions", "2", "+set", "r_texturebits", "32", "+set", "r_colorbits", "24", "+set", "r_depthbits", "24"]
  });

  let ownerData;
  let preparedData;
  let engineStarted = false;
  let adapterState = "menu";
  let qualityController;
  let lastResize;
  let lastEscapeAt = 0;
  let nativeResizeReady = false;
  let nativeCursor = { x: 0, y: 0 };
  let nativeStatePoll;
  let legacyPointerBridgeInstalled = false;

  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = source;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${source}.`));
      document.head.appendChild(script);
    });
  }

  function quoteStartupValue(value) {
    return `"${String(value).replace(/["\r\n]/g, "")}"`;
  }

  function viewportSize(detail = lastResize) {
    const viewport = window.visualViewport;
    return {
      width: Math.max(320, Math.floor(detail?.requestedWidth || viewport?.width || window.innerWidth)),
      height: Math.max(200, Math.floor(detail?.requestedHeight || viewport?.height || window.innerHeight))
    };
  }

  function ensureDirectory(path) {
    const parts = String(path).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      try {
        FS.mkdir(current);
      } catch (error) {
        if (!error || (error.errno !== 20 && error.errno !== 17)) {
          try { FS.stat(current); } catch (_) { throw error; }
        }
      }
    }
  }

  function installEarlyConfig(viewport, preferences) {
    const profile = preferences.qualityProfile === "medium" ? {
      r_picmip: 1, r_vertexLight: 0, r_dynamiclight: 0, r_lodbias: 2, r_subdivisions: 8
    } : preferences.qualityProfile === "ultra" ? {
      r_picmip: 0, r_vertexLight: 0, r_dynamiclight: 1, r_lodbias: 0, r_subdivisions: 2,
      r_texturebits: 32, r_colorbits: 24, r_depthbits: 24
    } : {
      r_picmip: 0, r_vertexLight: 0, r_dynamiclight: 1, r_lodbias: 1, r_subdivisions: 4
    };
    const values = {
      r_fullscreen: 0,
      r_mode: -1,
      r_customwidth: viewport.width,
      r_customheight: viewport.height,
      r_customaspect: 1,
      com_maxfps: preferences.targetFps,
      ...profile
    };
    const config = Object.entries(values).map(([name, value]) => `seta ${name} "${value}"`).join("\n") + "\n";
    FS.writeFile("/base/baseq3/autoexec.cfg", config, { encoding: "utf8", flags: "w" });
  }

  async function waitForQuakeJsRuntime(timeoutMs = 10000) {
    const deadline = performance.now() + timeoutMs;
    while (!globalThis.FS?.init?.initialized) {
      if (performance.now() >= deadline) {
        throw new Error("The QuakeJS filesystem did not finish initializing.");
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  async function loadQuakeJs(context) {
    if (globalThis.ioq3 && typeof globalThis.ioq3.callMain === "function") {
      await waitForQuakeJsRuntime();
      return;
    }
    globalThis.ioq3 = {
      noInitialRun: true,
      canvas: context.elements.canvas,
      viewport: context.elements.runtime,
      elementPointerLock: false,
      print: context.log,
      printErr: context.log,
      setStatus(message) {
        if (message) context.setLoading(message);
      }
    };
    await loadScript("/ioquake3.js");
    if (!globalThis.ioq3 || typeof globalThis.ioq3.callMain !== "function" || typeof globalThis.FS === "undefined") {
      throw new Error("The QuakeJS runtime did not expose its browser entry points.");
    }
    /* This historical Emscripten runtime defers initialization when setStatus
     * is present. Wait until it reserves descriptors 0-2 before opening PAKs. */
    await waitForQuakeJsRuntime();
  }

  function cvar(name, value) {
    if (globalThis.ioq3?.ccall) {
      ioq3.ccall("Cvar_Set", null, ["string", "string"], [name, String(value)]);
    }
  }

  function cvarString(name) {
    if (!globalThis.ioq3?.ccall) return "";
    try {
      return String(ioq3.ccall("Cvar_VariableString", "string", ["string"], [name]) || "");
    } catch (_) {
      return "";
    }
  }

  function readNativeState() {
    if (!engineStarted || !globalThis.ioq3?.ccall) return adapterState;
    if (cvarString("cl_paused") === "1") return "paused";
    if (cvarString("sv_running") === "1") return "gameplay";
    return "menu";
  }

  function setAdapterState(next, context) {
    if (!next || next === adapterState) return;
    const prior = adapterState;
    adapterState = next;
    if (next === "paused" && prior === "gameplay") nativeCursor = { x: 319, y: 80 };
    context.setEngineState(next);
  }

  function startNativeStatePoll(context) {
    clearInterval(nativeStatePoll);
    nativeStatePoll = setInterval(() => setAdapterState(readNativeState(), context), 125);
  }

  function mappedMouseEvent(type, detail, extras = {}) {
    return {
      type,
      q3MappedPointer: true,
      q3X: detail.x,
      q3Y: detail.y,
      movementX: detail.x - nativeCursor.x,
      movementY: detail.y - nativeCursor.y,
      pageX: 0,
      pageY: 0,
      preventDefault() {},
      ...extras
    };
  }

  function injectMappedMove(detail) {
    if (!engineStarted || !globalThis.SDL?.events || readNativeState() === "gameplay") return;
    const next = { x: Math.round(detail.x), y: Math.round(detail.y) };
    const event = mappedMouseEvent("mousemove", next);
    nativeCursor = next;
    if (event.movementX || event.movementY) SDL.events.push(event);
  }

  function injectMappedButton(detail) {
    if (!engineStarted || !globalThis.SDL?.events) return;
    injectMappedMove(detail);
    SDL.events.push(mappedMouseEvent(detail.pressed ? "mousedown" : "mouseup", {
      x: Math.round(detail.x), y: Math.round(detail.y)
    }, { button: detail.button }));
  }

  function installLegacyPointerBridge(canvas) {
    if (legacyPointerBridgeInstalled || !globalThis.Browser || !globalThis.SDL) return;
    legacyPointerBridgeInstalled = true;
    const calculateMouseEvent = Browser.calculateMouseEvent;
    Browser.calculateMouseEvent = function (event) {
      if (!event?.q3MappedPointer) return calculateMouseEvent.call(Browser, event);
      Browser.mouseX = event.q3X;
      Browser.mouseY = event.q3Y;
      Browser.mouseMovementX = event.movementX;
      Browser.mouseMovementY = event.movementY;
    };
    const blockUncapturedLegacyMouse = event => {
      if (document.pointerLockElement !== canvas) event.stopImmediatePropagation();
    };
    for (const type of ["mousemove", "mousedown", "mouseup"]) {
      canvas.addEventListener(type, blockUncapturedLegacyMouse, true);
    }
  }

  function stopDynamicQuality() {
    qualityController?.stop();
    qualityController = undefined;
  }

  function startDynamicQuality(context, preferences) {
    stopDynamicQuality();
    if (!preferences.dynamicQuality || !globalThis.ioq3?.ccall) return;
    const profiles = preferences.qualityProfile === "ultra" ? ["ultra", "high", "medium"] :
      preferences.qualityProfile === "high" ? ["high", "medium"] : ["medium"];
    const levels = { ultra: ["1", "0"], high: ["1", "1"], medium: ["0", "2"] };
    qualityController = context.framework.createQualityController({
      profiles,
      targetFps: Number(preferences.targetFps),
      enabled: true,
      apply(name, detail) {
        cvar("r_dynamiclight", levels[name][0]);
        cvar("r_lodbias", levels[name][1]);
        document.documentElement.dataset.quake3Quality = `${name}:${detail.reason}`;
      }
    });
    qualityController.start();
  }

  function dispatchEscape(canvas) {
    for (const type of ["keydown", "keyup"]) {
      const event = new KeyboardEvent(type, {
        key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true
      });
      canvas.dispatchEvent(event);
    }
  }

  function installRendererDiagnostics(context) {
    const enabled = new URLSearchParams(location.search).get("q3_renderer_debug") === "1";
    const gl = globalThis.ioq3?.ctx || globalThis.GLctx ||
      context.elements.canvas.getContext("webgl") || context.elements.canvas.getContext("experimental-webgl");
    if (!enabled || !gl || globalThis.Quake3RendererDiagnostics) return;

    const state = {
      draws: 0, errors: Object.create(null), anomalies: Object.create(null),
      viewport: null, depthRange: null, arrayBufferBytes: 0, elementBufferBytes: 0,
      logs: 0, maxLogs: 24
    };
    const bound = new Map();
    const sizes = new WeakMap();
    let framebuffer = null;

    function anomaly(kind, detail) {
      state.anomalies[kind] = (state.anomalies[kind] || 0) + 1;
      if (state.logs < state.maxLogs) {
        state.logs += 1;
        context.log(`[q3-render] ${kind}: ${detail}`);
      }
    }

    function wrap(name, inspect) {
      const original = gl[name];
      if (typeof original !== "function") return;
      try {
        gl[name] = function (...args) {
          inspect?.(args);
          return original.apply(gl, args);
        };
      } catch (error) {
        anomaly("instrumentation", `${name}: ${error.message}`);
      }
    }

    wrap("getError", null);
    const originalGetError = gl.getError;
    if (typeof originalGetError === "function") {
      gl.getError = function () {
        const error = originalGetError.call(gl);
        if (error) {
          state.errors[error] = (state.errors[error] || 0) + 1;
          anomaly("gl-error", `0x${error.toString(16)}`);
        }
        return error;
      };
    }
    wrap("bindBuffer", args => bound.set(args[0], args[1]));
    wrap("bufferData", args => {
      const bytes = typeof args[1] === "number" ? args[1] : Number(args[1]?.byteLength || 0);
      const buffer = bound.get(args[0]);
      if (buffer && typeof buffer === "object") sizes.set(buffer, bytes);
      if (args[0] === gl.ARRAY_BUFFER) state.arrayBufferBytes = bytes;
      if (args[0] === gl.ELEMENT_ARRAY_BUFFER) state.elementBufferBytes = bytes;
    });
    wrap("bufferSubData", args => {
      const bytes = Number(args[2]?.byteLength || 0);
      const size = sizes.get(bound.get(args[0]));
      if (Number.isFinite(size) && Number(args[1]) + bytes > size) {
        anomaly("buffer-overrun", `${args[0]} ${args[1]}+${bytes}>${size}`);
      }
    });
    wrap("bindFramebuffer", args => { framebuffer = args[1]; });
    wrap("viewport", args => {
      state.viewport = args.slice(0, 4);
      if (!framebuffer && (args[0] < 0 || args[1] < 0 || args[0] + args[2] > gl.canvas.width || args[1] + args[3] > gl.canvas.height)) {
        anomaly("viewport", `${args.join(",")} for ${gl.canvas.width}x${gl.canvas.height}`);
      }
    });
    wrap("depthRange", args => {
      state.depthRange = args.slice(0, 2);
      if (!args.every(Number.isFinite) || args[0] < 0 || args[1] > 1 || args[0] > args[1]) {
        anomaly("depth-range", args.join(","));
      }
    });
    wrap("vertexAttribPointer", args => {
      if (!bound.get(gl.ARRAY_BUFFER)) anomaly("attribute-buffer", `index ${args[0]} has no ARRAY_BUFFER`);
      if (!args.slice(0, 6).every(value => typeof value === "boolean" || Number.isFinite(value))) {
        anomaly("attribute-pointer", args.join(","));
      }
    });
    wrap("uniformMatrix4fv", args => {
      const matrix = args[2];
      if (matrix && Array.from(matrix).some(value => !Number.isFinite(value))) {
        anomaly("matrix", "non-finite projection/model-view value");
      }
    });
    wrap("drawElements", args => {
      state.draws += 1;
      if (!bound.get(gl.ELEMENT_ARRAY_BUFFER)) anomaly("index-buffer", `draw ${state.draws} has no ELEMENT_ARRAY_BUFFER`);
      const alignment = args[2] === gl.UNSIGNED_INT ? 4 : args[2] === gl.UNSIGNED_SHORT ? 2 : 1;
      if (args[3] % alignment) anomaly("index-offset", `${args[3]} is not ${alignment}-byte aligned`);
    });
    wrap("drawArrays", () => { state.draws += 1; });

    globalThis.Quake3RendererDiagnostics = Object.freeze({
      state,
      snapshot() {
        return Object.freeze({
          draws: state.draws,
          errors: { ...state.errors }, anomalies: { ...state.anomalies },
          viewport: state.viewport?.slice() || null, depthRange: state.depthRange?.slice() || null,
          canvas: [gl.canvas.width, gl.canvas.height],
          arrayBufferBytes: state.arrayBufferBytes, elementBufferBytes: state.elementBufferBytes
        });
      }
    });
    context.log("[q3-render] bounded WebGL diagnostics enabled");
    let reports = 0;
    const reporter = setInterval(() => {
      reports += 1;
      context.log(`[q3-render] sample ${reports}: ${JSON.stringify(globalThis.Quake3RendererDiagnostics.snapshot())}`);
      if (reports >= 3) clearInterval(reporter);
    }, 5000);
  }

  async function loadOwnerData(context) {
    context.setLoading("Caching validated Quake III data…", "", 2);
    let currentIndex = 0;
    const fileCount = ownerData.policies.length;
    preparedData = await context.dataClient.load(ownerData, {
      onProgress(detail) {
        if (Number.isInteger(detail.index)) currentIndex = detail.index;
        const fileShare = 90 / Math.max(1, fileCount);
        const base = 2 + fileShare * currentIndex;
        const fraction = detail.phase === "downloading" && detail.total ? detail.received / detail.total :
          ["validated", "cached", "restored"].includes(detail.phase) ? 1 : 0;
        context.setLoading(
          detail.phase === "downloading" ? `Caching ${detail.key} from this container…` :
            `${detail.phase} ${detail.key || "game data"}…`,
          "",
          Math.min(92, base + fileShare * fraction)
        );
      }
    });
    document.documentElement.dataset.wasmDataSource = preparedData.entries.every(entry => entry.cached) ?
      "browser-cache" : "verified-owner-data";
  }

  async function startEngine(context) {
    if (engineStarted) {
      context.showRuntime(adapterState);
      return;
    }
    engineStarted = true;
    try {
      await loadOwnerData(context);
      context.setLoading("Loading the QuakeJS id Tech 3 runtime…", "", 93);
      await loadQuakeJs(context);
      installLegacyPointerBridge(context.elements.canvas);
      const viewport = viewportSize();
      if (context.elements.canvas.width !== viewport.width || context.elements.canvas.height !== viewport.height) {
        ioq3.setCanvasSize(viewport.width, viewport.height);
      }
      installRendererDiagnostics(context);
      ensureDirectory("/base/baseq3");
      context.setLoading("Mounting cached PAKs read-only…", "", 95);
      await context.framework.mountOwnerFiles(FS, preparedData, {
        root: "/base/baseq3",
        mode: "memfs",
        chunkBytes: 16 * 1024 * 1024,
        onProgress(detail) {
          if (detail.total) context.setLoading(
            "Mounting cached PAKs read-only…", "", 95 + Math.round(4 * detail.copied / detail.total)
          );
        }
      });

      const preferences = context.preferences.values();
      installEarlyConfig(viewport, preferences);

      /* QuakeJS normally asks its public CDN for a manifest. Exact owner PAKs
       * are already validated and mounted, so only that downloader is bypassed. */
      SYSC.FS_Startup = callback => {
        context.log("[quake3-wasm] using exact validated browser-local owner PAKs");
        callback();
      };

      const args = [
        "+set", "fs_basepath", "/base",
        "+set", "fs_homepath", "/persist",
        "+set", "name", quoteStartupValue(preferences.playerName),
        "+set", "sv_maxclients", "8",
        "+set", "com_introplayed", "1",
        "+set", "com_maxfps", String(preferences.targetFps),
        "+set", "r_fullscreen", "0",
        "+set", "r_mode", "-1",
        "+set", "r_customwidth", String(viewport.width),
        "+set", "r_customheight", String(viewport.height),
        "+set", "r_customaspect", "1",
        "+bind", "w", quoteStartupValue("+forward"),
        "+bind", "s", quoteStartupValue("+back"),
        "+bind", "a", quoteStartupValue("+moveleft"),
        "+bind", "d", quoteStartupValue("+moveright"),
        "+bind", "SPACE", quoteStartupValue("+moveup"),
        "+bind", "MOUSE1", quoteStartupValue("+attack"),
        "+set", "sensitivity", "5",
        ...(profileArgs[preferences.qualityProfile] || profileArgs.high)
      ];
      context.showRuntime("menu");
      context.shell.resize();
      context.elements.canvas.focus();
      ioq3.callMain(args);
      installRendererDiagnostics(context);
      nativeResizeReady = true;
      context.shell.resize();
      startDynamicQuality(context, preferences);
      adapterState = "menu";
      context.setEngineState("menu");
      startNativeStatePoll(context);
      document.documentElement.dataset.quake3Controls = "wasd-mouselook";
      context.setLoading("", "", 100);
    } catch (error) {
      engineStarted = false;
      nativeResizeReady = false;
      context.log(error?.stack || error);
      context.setStatus(error?.message || String(error), true);
      context.showLauncher();
      throw error;
    }
  }

  globalThis.WasmGameAdapter = Object.freeze({
    async init(context) {
      await loadScript("/assets.js");
      const manifest = await Quake3Assets.loadManifest();
      ownerData = context.framework.createOwnerDataSet({
        namespace: "quake3-arena-retail",
        version: `pak0-pak8-${manifest.files.map(file => file.sha256.slice(0, 12)).join("-")}`,
        files: manifest.files.map(file => ({
          key: file.name,
          name: file.name,
          size: file.size,
          magic: [0x50, 0x4b, 0x03, 0x04],
          mountName: file.name,
          validateCached: false,
          validate: async (blob, detail) => {
            const digest = await Quake3Assets.sha256(blob, (done, total) => detail.onProgress?.({
              phase: "hashing", key: file.name, received: done, total
            }));
            if (digest !== file.sha256) throw new Error(`${file.name} failed SHA-256 validation.`);
          }
        }))
      });
      document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        lastEscapeAt = performance.now();
        setTimeout(() => setAdapterState(readNativeState(), context), 0);
      }, true);
    },

    start: startEngine,

    readEngineState() {
      return readNativeState();
    },

    pointerMove(detail, _event, context) {
      setAdapterState(readNativeState(), context);
      injectMappedMove(detail);
    },

    pointerButton(detail, _event, context) {
      setAdapterState(readNativeState(), context);
      injectMappedButton(detail);
    },

    resize(detail, context) {
      lastResize = detail;
      if (!nativeResizeReady || typeof globalThis.ioq3?.setCanvasSize !== "function") return;
      const next = viewportSize(detail);
      if (context.elements.canvas.width !== next.width || context.elements.canvas.height !== next.height) {
        ioq3.setCanvasSize(next.width, next.height);
      }
    },

    inputCaptureChanged(captured, context) {
      if (!engineStarted || !captured) return;
      setAdapterState("gameplay", context);
    },

    captureLost(_detail, context) {
      if (!engineStarted) return;
      if (performance.now() - lastEscapeAt > 250) dispatchEscape(context.elements.canvas);
      nativeCursor = { x: 319, y: 80 };
      adapterState = "paused";
      context.setEngineState("paused");
    },

    preferencesChanged(preferences, context) {
      if (!engineStarted) return;
      cvar("name", preferences.playerName);
      cvar("com_maxfps", preferences.targetFps);
      const levels = { medium: ["0", "2"], high: ["1", "1"], ultra: ["1", "0"] };
      const level = levels[preferences.qualityProfile] || levels.high;
      cvar("r_dynamiclight", level[0]);
      cvar("r_lodbias", level[1]);
      startDynamicQuality(context, preferences);
    },

    contextLost(_event, context) {
      stopDynamicQuality();
      clearInterval(nativeStatePoll);
      adapterState = "crashed";
      context.setEngineState("crashed");
      context.setStatus("The WebGL context was lost. Reload Quake III to continue.", true);
    }
  });
})();
