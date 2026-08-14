# Quake III Arena WASM

This is a fresh downstream integration of the original
[QuakeJS](https://github.com/inolen/quakejs) browser engine with the shared
WASM game framework. The downstream does not own a browser document, launcher
stylesheet, service worker, or web manifest. Framework 0.7.0 serves all four;
this project supplies declarative policy, a native adapter, QuakeJS artifacts,
and authentic source-tree artwork.

## Game-data boundary

Quake III retail PAKs are never committed or copied into the image. The exact
pak0.pk3 through pak8.pk3 set is provisioned into `/data`, validated against
`wasm-game-data.json`, downloaded only through the framework allowlist, and
cached by each browser in origin-private IndexedDB. The container is the
source of truth; the browser mount is read-only. The QVM overlay contains only
GPL source-built code. On a server wake, QuakeJS NODEFS receives an ephemeral
byte-for-byte runtime copy because its virtual filesystem cannot follow an
absolute host symlink outside the mount; it never writes back to the valid
`/data` PAKs, and the copy disappears with the container.

QuakeJS's 2014 installer bootstrap recognizes the demo pak0 CRC, not the retail
pak0 CRC. The dedicated build therefore bypasses that obsolete demo download
prompt after the framework has SHA-256 validated all nine retail PAKs. It does
not weaken the outer owner-data allowlist.

## Launch and server lifecycle

Play starts the authentic Quake III main menu. It does not connect to a server.
The deployed menu replaces SINGLE PLAYER and MULTIPLAYER with one JOIN GAME
action. That native action sets a bridge cvar; the adapter then POSTs `/wake`,
waits for a real same-origin QuakeJS dedicated server, and tells the native UI
to connect only after the server is ready.

The supervisor uses the framework `IdleServiceSupervisor` and supports:

- `KEEP_ALIVE=true|false` (default `false`)
- `IDLE_TIMEOUT=5m` (framework duration syntax)
- `MAP_ROTATION=q3dm6,q3dm7,q3dm11,q3dm17`

Every cold wake selects a rotation map randomly. `server.cfg` continues through
the rotation after each match.

The bot policy is real native Quake III behavior, not launcher copy. The server
sets `bot_minplayers 8` and `sv_maxclients 9`. `G_CheckMinimumPlayers` runs every
10 seconds and adds or removes bots until there are eight active players. The
ninth slot is the admission slot a human needs before the native game can drop
one bot. Therefore the arena idles with eight bots, converges to seven bots plus
one fully joined human, and adds a bot back after that human leaves. QVM markers
feed fully completed `ClientBegin`/`ClientDisconnect` transitions to the shared
idle supervisor.

## Build and local container

Prerequisites are Docker, a C compiler, make, zip, and the sibling
`/home/ted/Development/wasm/wasm-game-framework` checkout pinned at 0.7.0
commit `536d919`.

```sh
npm test
./scripts/build-image.sh wasm-quake3-framework:devel
docker run --rm --name wasm-quake3-framework3 \
  -p 127.0.0.1:8083:8088 \
  -v /home/ted/Development/wasm/data/quake3:/data \
  -e KEEP_ALIVE=false -e IDLE_TIMEOUT=5m \
  wasm-quake3-framework:devel
```

`./build-web.sh` builds the GPL QVM bridge, removes QuakeJS's obsolete embedded
launcher seams from the deployable engine, and emits `web/`. It deliberately
fails if downstream HTML, a service worker, or a web manifest appears.

## Input, resize, and graphics

The framework maps the live canvas content rectangle to Quake III's native
640x480 menu space with `pointerFit: "contain"`. Menus never acquire pointer
lock and the framework hides the host cursor over the canvas. Gameplay uses
relative SDL mouse events under framework-owned capture; W/A/S/D are bound to
the standard movement commands by the authentic retail `default.cfg`.

Dynamic resize calls QuakeJS's existing `Browser.setCanvasSize` path. Its SDL
resize event updates `r_customwidth`, `r_customheight`, and `r_mode -1`, then
uses QuakeJS's native `vid_restart fast` mode update. This is the original
QuakeJS rendering path; no renderer or desktop-GL workaround from the archived
implementation is reused. A bounded runtime diagnostic records at most 120
WebGL samples and 12 errors in `window.__q3RendererDiagnostics`.

## Licensing

QuakeJS integration code is MIT-licensed. ioquake3 and the built QVM changes are
GPLv2-compatible under `ioq3/COPYING.txt`. Quake III Arena data and trademarks
remain the owner's property and outside this repository and image.
