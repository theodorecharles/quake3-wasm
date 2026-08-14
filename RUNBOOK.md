# quake3-wasm runbook

## Scope and downstream rule

This repository is a downstream browser port built directly from id Software's GPL Quake III Arena source at commit `dbe4ddb10315`. The browser platform layer, CMake target, launcher, and asset workflow in this branch are new downstream work. They do not invoke or borrow an existing WebAssembly port.

Do not submit these changes upstream, open upstream issues about this work, or push to the id Software remote. The configured remote is fetch-only (`upstream`) and its push URL is intentionally disabled. Proprietary retail data must never be committed, uploaded, served by the development HTTP server, placed in a container image, or copied into the source tree.

## Current milestone

As of 2026-08-14:

- A clean Emscripten build compiles all substantial client, renderer, common, server, botlib, JPEG, spline, and interpreted-QVM engine code into `quake3.js` and `quake3.wasm`.
- The native infinite loop is replaced by `emscripten_set_main_loop`.
- SDL2 supplies a canvas, keyboard events, text input, and pointer-lock-compatible relative mouse input.
- WebGL 2 is selected. Emscripten's fixed-function compatibility layer carries the original renderer for this first milestone; unsupported `glArrayElement` and display-list paths are isolated in small WebAssembly branches.
- Retail `vm/ui.qvm`, `vm/cgame.qvm`, and `vm/qagame.qvm` are loaded from the owner's PAKs through the original QVM interpreter. Native DLL loading and native JIT execution are disabled on WebAssembly.
- The launcher captures and persists the player's name before it downloads or instantiates the engine.
- Low, medium, high, and ultra launch-time graphics profiles are available.
- The browser validates the exact locally generated PAK allowlist by path/name, byte size, ZIP header, and streaming SHA-256 before starting the engine.
- PAK hashing and staging use 4 MiB chunks. No whole-PK3 `arrayBuffer()` is created. The validated data is copied once to read-only MEMFS because a main-thread engine needs synchronous POSIX reads; it is not copied to IndexedDB or CacheStorage.
- Config/home files use writable `/persist` on IDBFS. PAKs use read-only `/data/baseq3`; `/data` is chmod `0555` after staging.
- The selected directory handle, validation metadata, launcher preferences, and the small generated manifest response are cached browser-locally. Retail bytes are not cached in browser databases.
- Static checks and a local HTTP artifact check pass.

Serialized Chrome testing now confirms that `?localdata=1` streams all nine
PAKs from the portfolio's loopback-only, read-only mount, validates every file,
and enables Play. Title/menu rendering, input behavior, and launching an arena
still need the deeper manual pass.

The local-data mode is intentionally a workstation convenience: it must only be
served on `127.0.0.1`. The normal launcher continues to use the browser directory
picker and never transmits retail bytes.

Audio and remote multiplayer transport are intentionally disabled in this first milestone. Local listen-server loopback is retained in the native engine. Dynamic frame-target quality adjustment, an idle/wake dedicated server, eight-player bot-yield population management, and production container packaging are follow-on work, not implemented features.

## Build

Requirements:

- CMake 3.20 or newer
- Ninja
- Node.js (static JavaScript and manifest checks)
- An active Emscripten SDK, or an explicit `EMSDK_ENV`/`EMSDK`

The owner installation currently used to generate the local manifest is:

```text
/home/ted/.steam/debian-installation/steamapps/common/Quake 3 Arena/baseq3
```

The code-only build uses the tracked allowlist manifest and needs no retail
files:

```bash
cd /home/ted/Development/wasm/quake3-wasm
./build-web.sh
```

Optionally audit a legal installation against the tracked manifest during the
build:

```bash
EMSDK_ENV=/path/to/emsdk_env.sh \
PAK_SOURCE=/path/to/Quake\ 3\ Arena/baseq3 \
BUILD_DIR=/absolute/output/path \
./build-web.sh
```

`build-web.sh` never searches a user directory. It uses an already active
`emcmake`, or an explicitly supplied `EMSDK_ENV`/`EMSDK`. It configures the
dedicated root `CMakeLists.txt`, builds the engine, and copies the code-only
launcher plus the pinned metadata manifest to `build-web`. When `PAK_SOURCE` is
set, the locally regenerated manifest must match the tracked manifest exactly.
It never copies a PAK.

The manifest generator can also be run independently:

```bash
./scripts/generate-pak-manifest.sh "/path/to/baseq3" build-web/pak-manifest.json
```

It refuses missing files or files without a `PK\x03\x04` header, then records each fixed allowlisted name, exact size, and SHA-256.

## Static and HTTP tests

```bash
./tests/static.sh
./scripts/serve-web.sh
```

The server binds only to loopback by default. The exact smoke URL is:

```text
http://127.0.0.1:8083/
```

Optional non-browser checks:

```bash
curl -fsS http://127.0.0.1:8083/ | grep "Quake III Arena"
curl -fsSI http://127.0.0.1:8083/quake3.wasm
curl -fsS http://127.0.0.1:8083/pak-manifest.json
```

Stop the HTTP server with `Ctrl-C`. Do not leave a local server running after handoff.

## Chromium smoke handoff

Only the coordinator should do this serialized smoke test:

1. Run `./scripts/serve-web.sh` in this repository.
2. Open `http://127.0.0.1:8083/` in Chromium.
3. Confirm that no engine script or Wasm request occurs before pressing **Play**.
4. Enter a player name and choose a graphics profile.
5. Click **Choose baseq3 folder** and select `/home/ted/.steam/debian-installation/steamapps/common/Quake 3 Arena/baseq3`. If directory selection is unavailable, choose exactly `pak0.pk3` through `pak8.pk3` in the file fallback. **Play** remains disabled until all nine files pass local validation.
6. Press **Play**. Expect per-file preparation progress. The first validation reads roughly 500 MB; later validation can reuse matching name/size/mtime/hash metadata, but MEMFS staging still occurs once per engine page load.
7. In DevTools, look for `[quake3-wasm] prepared 9 validated owner PAKs read-only`, `[quake3-wasm] starting official id Tech 3 engine`, filesystem search-path output, renderer initialization, and QVM load messages.
8. Expected first visual is the authentic retail main menu. The launcher supplies `+set com_introplayed 1` plus an `echo` startup command so the engine does not force its default intro cinematic.
9. Verify menu keyboard/text input, click-to-focus behavior, and that pointer lock is requested only after `CA_ACTIVE` gameplay with no UI or console key catcher.
10. Start a local skirmish/arena and verify rendering, WASD, mouse look, Escape, console text, Enter, Backspace, slash, and arrow-key command history.
11. Record the first meaningful console exception or engine fatal message verbatim. Do not enter a renderer-polish loop in this milestone.

If browser startup fails before engine logs, first inspect the asynchronous pre-run filesystem setup. If QVM loading fails, confirm that the browser-selected files exactly match the generated manifest and that `vm/ui.qvm`, `vm/cgame.qvm`, and `vm/qagame.qvm` exist inside the retail PAKs.

## Architecture

```text
owner Steam baseq3 directory
        | browser-local selection only
        v
name/size/PK3-header/streaming-SHA validation
        | 4 MiB bounded chunks
        v
read-only /data/baseq3 MEMFS ---- official filesystem/QVM loader

browser-local /persist IDBFS ---- configs and writable home data

official native GPL engine
        + new code/web platform layer
        + Emscripten cooperative main loop
        + SDL2 input/window
        + WebGL 2 compatibility renderer
        v
browser canvas
```

The launcher is deliberately outside the game VM. It owns identity, legal-data selection, validation, initial graphics policy, and the moment the engine artifact is loaded. The engine retains its authentic UI QVM and HUD rather than replacing them with an HTML imitation.

The current remote network functions accept loopback only. A production dedicated-server bridge must use a browser-capable transport such as WebSocket-to-UDP on the same origin. It must not expose a public asset `PUT`, upload endpoint, or retail-data URL.

## Required lifecycle semantics for the next multiplayer milestone

These are requirements, not current claims:

- Keep player identity collection before engine loading.
- Keep the authentic retail main menu.
- Wake a sleeping dedicated server only after a confirmed **Multiplayer** intent in the browser/game bridge. Do not treat the engine's generic Join command as the wake signal.
- Show wake/connect status immediately while the server starts.
- Count only fully connected human clients for idle shutdown and bot-yield decisions; connecting sockets, spectators used for probes, and bots do not count as humans.
- Default the match population target to 8 and make it configurable. Bots fill empty slots and yield one-for-one as fully connected humans enter.
- Begin the idle timer only after the last fully connected human leaves. A keep-alive option disables sleeping.
- Start a newly awakened server on a randomly selected valid rotation map.
- Never start or mutate external server/container state merely by loading the page.

## Graphics follow-on

Launch profiles are working launcher policy; dynamic adjustment is not. A dynamic-quality implementation should be opt-in with 30, 60, and 120 FPS targets. It should use hysteresis and cooldowns, change one inexpensive setting at a time, avoid `vid_restart` during active combat, and persist the user's opt-in/profile separately from engine config. Test renderer correctness before attempting performance tuning.

The current fixed-function compatibility path is a bootstrap, not a final renderer architecture. Runtime smoke results should determine whether the smallest next step is state-call shimming or a deliberate GLES/WebGL renderer conversion. Do not import another project's renderer as a shortcut.

## Known risks and honest blockers

- Chrome loaded the identity/graphics/data launcher, fetched the pinned metadata
  manifest, and correctly kept **Play** disabled before owner data was selected.
  The automation extension could not attach local files, so engine initialization
  and playability remain a short manual owner-data smoke rather than a claim.
- Staging the retail PAK set into main-thread MEMFS holds one roughly 500 MB browser copy. Chunking prevents transient whole-file copies, but true zero-copy local File access requires moving the engine to a worker with synchronous Blob reads or another purpose-built synchronous storage bridge.
- The directory handle is browser-private and is reused only while read permission remains granted. Chromium may ask the user to select/grant the folder again after a hard refresh. The fallback `<input type=file>` selection is intentionally session-only; persisting roughly 500 MB of duplicate Blob bodies in IndexedDB would conflict with the bounded-storage design.
- Original desktop OpenGL behavior is running through legacy emulation. Link-time unsupported immediate/display-list calls were bypassed only where the native renderer already has an indexed draw path or where the display-list path is documented as unimplemented.
- Audio is disabled.
- Remote networking, dedicated-server proxying, server wake/sleep, connected-human accounting, and bot yield are not implemented.
- There is no Docker image or deployment configuration in this milestone.

## Source-change map

- `CMakeLists.txt`: dedicated Emscripten target from official native source lists.
- `code/web/`: new browser system, main loop, SDL input/window, WebGL setup, network stubs, and null audio backend.
- `code/game/q_shared.h`: WebAssembly platform/endian definitions.
- `code/qcommon/common.c`: WebAssembly socket-header selection.
- `code/qcommon/vm.c`: interpreted retail QVM enforcement.
- `code/botlib/l_precomp.c`: WebAssembly-compatible `time_t` handling.
- `code/renderer/qgl.h`, `tr_shade.c`, `tr_surface.c`: WebGL include and narrowly isolated unsupported desktop GL paths.
- `web/`: identity-first launcher, graphics profiles, pinned PAK manifest, asset validation, persistence, and pre-run filesystem setup.
- `scripts/`: manifest generation and loopback dev server.
- `tests/static.sh`: JavaScript syntax, SHA implementation, artifact, manifest, and no-PK3 checks.

All future work should remain on downstream branches and preserve the no-retail-assets rule.
