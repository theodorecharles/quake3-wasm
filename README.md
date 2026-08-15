# quake3-wasm

`quake3-wasm` is the downstream browser port of Quake III Arena based on
modern ioquake3. It builds a WebGL 2/WebAssembly client, a native dedicated
server and game QVMs, and serves them from one Node host with same-origin PK3
range delivery and WebSocket-to-UDP game transport.

The engine, menus, HUD, game code, and bots remain Quake III. The HTML layer is
only a launcher for player/settings capture, runtime integration, server
lifecycle, and browser input policy.

## Game data

The required Quake III Arena `pak0.pk3` through `pak8.pk3` files are ignored by
Git, are never included in public build artifacts, and must not be added to an
image or release.

For local development, discover the Steam installation automatically or set
`Q3_PATH` to the directory containing the nine PK3 files:

```bash
npm run setup:data
Q3_PATH=/path/to/baseq3 npm run setup:data
```

The default setup creates ignored symlinks under `data/baseq3`. Pass `--copy`
directly to `scripts/setup-game-data.sh` when an ignored local copy is needed.
The helper never downloads or uploads game data.

## Build

Requirements are Node.js 20 or newer, CMake, Ninja, a native C toolchain, and a
current Emscripten SDK. The client script uses `/home/ted/emsdk` by default;
set `Q3JS_EMSDK` for another checkout.

```bash
git submodule update --init
npm ci
npm run build:client
npm run build:server
npm test
```

Generated client files live in ignored `web/client/`. The dedicated binary and
QVMs live in ignored `build/dedicated/`. Product-specific ioquake3 changes are
kept in `patches/ioq3-wasm.patch`; the client build applies and then restores
that patch when the submodule checkout is clean, and preserves a patch that was
already present before the build.

## Run locally

```bash
Q3JS_HTTP_PORT=8083 npm start
```

Open `http://127.0.0.1:8083/`. The host remains available while the native
match sleeps. Submitting Play wakes a random map, validates or restores the
PK3 cache, loads the WASM engine, and connects through the same-origin `/ws`
endpoint.

Useful endpoints are `/health`, `/status`, and `/config.json`. PK3 responses
support HTTP byte ranges. Runtime logs, generated configs, RCON credentials,
and copied QVMs stay under ignored `runtime/`.

Important environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `Q3JS_HTTP_PORT` | `8080` | HTTP and WebSocket listener |
| `Q3JS_DED_PORT` | `27960` | Internal native game port |
| `Q3JS_SLOTS` | `8` | Maintained human-plus-bot population |
| `Q3JS_BOT_SKILL` | `3` | ioquake3 bot skill from 1 to 5 |
| `Q3JS_MAPS` | built-in q3dm rotation | Comma-separated cold-start maps |
| `KEEP_ALIVE` | `false` | Keep the dedicated match continuously awake |
| `IDLE_TIMEOUT` | `15m` | Empty-human sleep delay |
| `Q3JS_RCON` | generated | Optional server-side RCON password |

## Project status

Reproducible clean builds produce a substantial Emscripten client and native
dedicated match. Automated local checks prove PK3 validation/range serving,
random wake, baseq3 map/QVM loading, eight-bot convergence with a reserved
join slot, and a binary WebSocket-to-UDP status round trip. Interactive engine
initialization, authentic-menu rendering, input, and audio still require the
coordinator's Chrome acceptance pass described in `RUNBOOK.md`.

All work stays in `theodorecharles/quake3-wasm`; nothing is submitted upstream.
Licensing remains component-specific. ioquake3 and the engine patch are under
the terms in `ioq3/COPYING.txt`; retained QuakeJS files keep their existing
copyright and license terms. Retail game data is not part of this repository.
