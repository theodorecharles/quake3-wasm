# quake3-wasm implementation runbook

This document is the engineering handoff for turning the original QuakeJS
checkout into `theodorecharles/quake3-wasm`. It records the architecture and
browser behavior proven by `wolfet-wasm`, maps those concepts onto Quake III
Arena, and identifies the source of truth for every layer.

The target is not a themed webpage around a partial recreation. The target is
the real Quake III Arena engine, game code, menus, HUD, renderer, input, bots,
and dedicated match running through WebAssembly and WebSockets, with a small
browser shell handling lifecycle and delivery concerns that native id Tech 3
never had to solve.

## Current checkpoint

- GitHub fork: `theodorecharles/quake3-wasm`.
- Work branch: `devel`.
- The ioq3 submodule is initialized at upstream QuakeJS's pinned revision.
- The official id Software source is cloned locally at
  `references/quake3-source/` and ignored by Git.
- Steam `pak0.pk3` through `pak8.pk3` were located and checksummed; none are in
  Git.
- Emscripten 6.0.6 is installed under `/home/ted/emsdk`.
- The first build failure was the old source expecting `EMSCRIPTEN` while the
  modern compiler defines `__EMSCRIPTEN__`. The compatibility fix is recorded
  in `patches/ioq3-wasm.patch`.
- After applying that patch, the next build blocker is the Makefile dependency
  on `.git/index`. Because `ioq3` is a submodule, `.git` is a file and its real
  index is returned by `git rev-parse --git-path index`. Update the Makefile's
  three version-rebuild dependencies to use that resolved path, append the
  resulting diff to `patches/ioq3-wasm.patch`, and rebuild immediately.

Reproduce the current build loop with:

```bash
git submodule update --init
git -C ioq3 apply ../patches/ioq3-wasm.patch
source /home/ted/emsdk/emsdk_env.sh
make -C ioq3 -j2 PLATFORM=js EMSCRIPTEN=/home/ted/emsdk/upstream/emscripten
```

## Source layout and authority

- This repository is the product repository and is published as
  `theodorecharles/quake3-wasm`.
- `ioq3/` is the QuakeJS-pinned ioquake3 submodule. It already contains the old
  Emscripten platform and is the implementation base to modernize.
- `references/quake3-source/` is a local, ignored clone of
  `id-Software/Quake-III-Arena`. Use it to answer questions about original
  Quake III menu, HUD, input, renderer, game, and bot behavior. Never edit it as
  product code and never vendor it into this repository.
- `/home/ted/Development/wolfetjs` is the proven browser-runtime reference.
  Port concepts deliberately; do not blindly copy ET-specific cvars, protocol
  assumptions, UI coordinates, or game rules.
- The legally installed game data is under
  `/home/ted/.steam/debian-installation/steamapps/common/Quake 3 Arena/baseq3`.
  The supported install currently contains `pak0.pk3` through `pak8.pk3`.
- Quake III PK3s are proprietary data. They must never be committed, attached
  to a GitHub release, or baked into a public Docker image.

When original behavior is in doubt, compare in this order:

1. the Steam game in actual play;
2. the id Software GPL source in `references/quake3-source/`;
3. the corresponding ioquake3/QuakeJS implementation in `ioq3/`;
4. wolfet-wasm only for browser-platform mechanics.

## Product defaults

- One shared free-for-all match.
- Maintained population: 8 total players by default.
- Bots fill every unoccupied place and one bot leaves for every human who
  connects. A replacement bot returns after a human leaves.
- The lightweight website remains online continuously.
- The dedicated match sleeps when empty unless `KEEP_ALIVE=true`.
- Default idle timeout: 15 minutes without a human player.
- A random map is selected on every cold wake, avoiding an immediate repeat.
- The server begins waking when the player submits the outer player-name form,
  before the WebAssembly engine/main menu becomes interactive. Do not wait for
  a later in-engine Join action.
- Maximum graphics is the default ceiling. Dynamic quality is enabled by
  default with a 60 FPS target. The user can select 30, 60, or 120 FPS.
- Desktop keyboard and mouse are the first-class input target.

Use product-prefixed environment variables such as `Q3JS_SLOTS`,
`Q3JS_HTTP_PORT`, and `Q3JS_DED_PORT`. Preserve generic `KEEP_ALIVE` and
`IDLE_TIMEOUT` for parity with wolfet-wasm.

## Why the wolfet-wasm model works

The browser shell and the game engine have separate responsibilities.

The shell owns:

- the player-name and graphics gate;
- server wake/sleep state;
- the visible startup terminal and progress messages;
- same-origin asset delivery, byte-range downloads, validation, and IndexedDB;
- canvas sizing and browser pointer-lock policy;
- preserving browser shortcuts outside captured input;
- WebSocket-to-game-server transport;
- Docker configuration, health/status endpoints, and persistent data.

The engine owns:

- the Quake III main menu and all in-game menus;
- the HUD, scoreboard, console, chat, crosshair, cursor art, and loading screen;
- rendering and projection;
- keyboard/mouse meaning after events enter the engine;
- authoritative player movement, combat, bots, visibility traces, and game
  state.

This boundary prevents a common failure mode: reproducing engine UI in HTML
until it looks close but behaves differently. HTML should orchestrate and then
get out of the way. Quake UI and cgame code should draw Quake UI.

## Startup sequence

Implement this exact state machine:

```text
name/settings gate
    -> submit Play
    -> immediately paint startup/loading UI
    -> POST /wake
    -> start dedicated server on a random rotation map
    -> poll until the match accepts connections
    -> load/restore PK3s into the Emscripten filesystem
    -> load the WebAssembly engine
    -> show the authentic Quake III main menu
    -> Join Game connects immediately to the already-ready match
```

Important details:

- Yield through `requestAnimationFrame` before sending `/wake`. Without that
  yield, synchronous or CPU-heavy startup can prevent the loading page from
  painting and the UI appears frozen.
- Deduplicate concurrent wake requests with one stored promise.
- Show elapsed wake time and meaningful phases rather than a static spinner.
- The engine must not reveal an interactive main menu while the dedicated
  server is still starting.
- The game loading screen must keep the engine's real connection text visible:
  resolving/connecting, awaiting challenge, awaiting gamestate, loading map,
  and awaiting snapshot. Do not hide the engine canvas merely because a
  connection log line appears.
- Only hide the outer startup panel when the engine has a real menu or loading
  surface ready to replace it.
- A failed wake returns to a retryable gate with the error visible.

The outer startup terminal should use the existing ModernDOS font treatment
from wolfet-wasm: light gray text on a desaturated blue background, bounded
history, sanitized ANSI/control sequences, and no noisy per-frame renderer
debug spam.

## Player name and settings gate

The first page asks for a player name before the engine is loaded.

- Sanitize control characters, quotes, backslashes, semicolons, and other
  command delimiters.
- Trim whitespace and enforce Quake III's safe name length.
- Persist the normalized name in `localStorage`.
- Pass it into the engine as command-line tokens, never by interpolating an
  unsanitized command string.
- Reopen the gate with the previous name populated on later visits.
- Put graphics profile, dynamic-quality toggle, and target FPS in a collapsed
  Advanced Settings section.
- Persist those settings separately from engine-generated config files.
- The form owns normal browser text entry. Game input handlers must ignore all
  events originating inside the gate.

The Play submit is the user gesture used to resume Web Audio and begin the
server wake. It is not merely a cosmetic transition.

## Server lifecycle and keep-alive behavior

Model the dedicated process as:

```text
sleeping -> starting -> running -> stopping -> sleeping
```

The host process stays alive in all states and serves `/`, `/health`,
`/status`, `/config.json`, PK3 files, and `/ws`.

`POST /wake` must:

- be idempotent while running;
- share one start promise while starting;
- wait for any in-progress stop;
- choose a random valid rotation map;
- avoid the last cold-start map when at least two maps exist;
- start the dedicated process;
- wait for a successful status response before returning ready.

`KEEP_ALIVE=false` is the default. Track actual human population, not WebSocket
count and not total players. Refresh `lastHumanAt` whenever at least one human
is present. Stop the dedicated process only after humans remain at zero for
`IDLE_TIMEOUT`. Accept integer seconds and values such as `15m` and `2h`, with
reasonable lower and upper bounds.

`KEEP_ALIVE=true` starts the match with the host and ignores the idle timeout.

WebSocket game traffic may race a sleeping server. The `/ws` handler should
buffer a small, bounded amount of client traffic while it awaits the same wake
promise, then open the game transport and flush the queue. Bound the queue and
close abusive clients rather than consuming unlimited memory.

Shutdown must handle SIGTERM/SIGINT, stop monitoring timers, terminate the
dedicated child cleanly, and escalate only after a bounded grace period.

## Eight-player bot backfill

`Q3JS_SLOTS` is the maintained human-plus-bot population and defaults to 8.

For `H` humans:

```text
targetBots = max(0, Q3JS_SLOTS - H)
```

Reconcile observed bots toward that target on a short interval. Add or remove
at most a small number per tick to avoid a burst of console commands. Bot names
and skills may rotate, but the population equation is authoritative.

Reserve one transient connection slot internally:

```text
sv_maxclients = min(engineLimit, Q3JS_SLOTS + 1)
```

That extra slot lets a human finish connecting before the supervisor removes
the displaced bot. It is not part of the advertised maintained population.
Without it, a nominally full eight-bot server rejects the human before the
supervisor has evidence that a bot should leave.

Human detection must come from authoritative server status/player metadata.
Do not count every connection as human and do not infer solely from names when
the protocol exposes a bot flag/address. Reconciliation should be safe to run
repeatedly.

## Browser transport

Serve the game page, assets, and WebSocket from one origin. Reverse proxies
must forward the WebSocket upgrade and HTTP Range headers.

The original QuakeJS client and `ioq3ded.js` already use WebSockets. Prefer a
direct same-origin `/ws` endpoint if the server can be configured for it. If a
separate game port or protocol boundary remains, put a bounded proxy in the
always-on Node host. Do not expose a cross-origin content server as the default.

`/config.json` is the browser contract. It should include:

- the same-origin WebSocket path/connect target;
- lifecycle state;
- current/random-start map and rotation;
- maintained slots;
- an ordered asset manifest with URL, byte size, SHA-256, and content-addressed
  cache key.

## Game data and browser caching

For local development, add a setup command that discovers the Steam install or
accepts `Q3_PATH`, verifies `pak0.pk3` through `pak8.pk3`, and copies or links
them into ignored local runtime data.

The currently installed Steam data is approximately 483 MiB. `pak0.pk3` alone
is approximately 458 MiB, so ordinary `localStorage` and monolithic proxy
responses are inappropriate.

Use the wolfet-wasm delivery pattern:

- browsers only request PK3s from the quake3-wasm origin;
- large files are fetched in 16 MiB HTTP byte ranges;
- expected response lengths are checked;
- the complete byte array is validated against the manifest checksum;
- successful bytes are stored in IndexedDB;
- the IndexedDB key includes the filename and full SHA-256;
- a hard refresh reuses the cached asset;
- a changed checksum naturally downloads a new version;
- the bytes are written into `/baseq3` in the Emscripten virtual filesystem
  before engine initialization.

Never show “Downloading official game data” on every load merely because the
page refreshed. Distinguish validating cache, downloading a cache miss, and
restoring cached data.

Public Docker images cannot legally contain Quake III retail PK3s, and there is
no equivalent to Enemy Territory's public Splash Damage installer. The image
must require user-supplied files under `/data/baseq3`. Document copying the
files from a legal Steam/GOG/CD installation. A setup helper may discover and
copy the local Steam install; it must not upload those files or silently obtain
them from an unofficial source.

## Mouse, keyboard, cursor, and browser shortcuts

Input capture is a state, not a blanket page-level event cancellation.

Captured input means at least one of:

- the game canvas owns pointer lock;
- the focused game canvas is intentionally accepting keyboard input;
- the engine is in console/chat text-entry mode.

Rules:

- Bind SDL/Emscripten keyboard input to the focusable canvas, not `window`.
- Before Play or outside captured input, browser behavior wins: copy/paste,
  Ctrl/Cmd+R, Ctrl+Shift+R, Ctrl/Cmd+L, devtools, browser find, and ordinary
  form editing must work.
- A click on live gameplay focuses the canvas, resumes audio, and requests
  pointer lock. The capture click itself must not fire the weapon.
- Pointer-locked `movementX/movementY` drives relative mouselook exactly once.
  Do not let both SDL and a JavaScript bridge apply the same delta.
- On menus, scoreboard interaction, console, intermission, or other absolute
  UI, release pointer lock and convert page coordinates into the engine's
  virtual 640x480 space using the actual contained viewport.
- Quake draws its own menu cursor. Hide the OS cursor only over the canvas when
  the engine cursor is active; keep the normal OS cursor everywhere else.
- In gameplay without pointer lock, show the OS cursor so the user understands
  input is not captured. Pressing Escape or losing capture should expose the
  authentic Quake pause/menu state.
- Flush held movement/fire keys on blur, visibility loss, pointer-lock loss,
  death/respawn transitions, menu transitions, and communication mode changes.
- Console and chat require explicit handling for printable characters plus
  Backspace, Enter, Escape, Tab, and Up/Down command history. Cancel Firefox
  Quick Find for `/` only while the engine owns text entry.
- Never steal `T`, team-chat keys, console keys, or Escape at the DOM layer and
  then assume SDL also received them. If JavaScript cancels an event it must
  inject the corresponding engine key/character exactly once.

Treat pointer-lock changes as asynchronous. The engine should not infer camera
pitch/yaw from an absolute page cursor, and stale deltas after respawn must be
discarded to prevent instant up/down snaps.

## Canvas, aspect ratio, menus, HUD, and loading screens

CSS dimensions and the drawing buffer must agree. On every material resize:

- measure the actual game frame;
- set the canvas drawing-buffer width/height to that size (with a deliberate,
  tested device-pixel-ratio policy);
- update `r_customwidth`, `r_customheight`, and the renderer viewport without
  repeatedly restarting the renderer;
- clear unused bars to black every frame.

Do not stretch a 4:3 UI across a widescreen or tall canvas. Quake III menus and
HUD are authored in a 640x480 virtual coordinate system. Use one uniform scale
that fits that virtual surface within the canvas, then center it. Convert mouse
coordinates through that identical transform. World rendering may use the full
aspect-aware viewport, but 2D UI geometry, cursor hit testing, crosshair, and
name labels must share the renderer's projection/viewport transform.

Faithfulness requirements:

- use original menu/HUD art and engine code from the legally supplied PK3s;
- preserve the original proportions of every icon and model viewport;
- do not replace the animated player head with a stretched static icon;
- keep transparent sprite edges and overlays alpha-correct;
- show the real levelshot/loading background and real server/map/status text;
- keep the scoreboard and console aligned with the same virtual canvas;
- test 4:3, 16:9, ultrawide, and portrait/tall layouts;
- test browser zoom at 100% first, then common zoom/DPI combinations.

Use screenshot comparisons against the Steam build for the main menu, HUD,
scoreboard, console, loading screen, and pause menu. “Looks plausible” is not a
completion criterion.

## Graphics profiles and adaptive quality

Offer four ceilings: Minimum, Performance, Balanced, and Maximum. Default to
Maximum. Profiles should use live cvars that do not require `vid_restart`.
Candidate Quake III controls include:

- `r_picmip`;
- `r_subdivisions`;
- `r_detailtextures`;
- texture bit depth/filter mode and anisotropy where WebGL supports them;
- `r_dynamiclight`;
- `cg_shadows`;
- marks/decals lifetime;
- `r_lodbias`;
- `r_fastsky` only in the lowest emergency profile.

WebGL extension availability is authoritative. Do not claim or enable desktop
compression/extensions that the browser did not expose.

Adaptive quality behavior copied from the proven implementation:

- sample rendered frames in three-second windows;
- monitor only while a live world is rendering and the document is visible;
- downgrade one level after two consecutive windows below 92% of target;
- upgrade one level after five consecutive windows at or above 98.5% of
  target;
- reset hysteresis counters after a level change;
- never exceed the user-selected profile ceiling;
- expose the current profile, measured FPS, and target for diagnostics;
- support 30, 60, and 120 FPS targets;
- permit dynamic quality to be disabled, leaving the chosen profile fixed.

Start at the selected ceiling. Do not reduce render resolution as the first
quality response because that makes HUD/text and crosshair alignment fragile.
Prefer reversible world-effect and texture/LOD changes.

## Renderer priorities

Modernize the existing Emscripten target to a supported SDK and WebGL 2/GLES
path. Compile early and preserve native builds behind `#ifdef __EMSCRIPTEN__`.

The visual acceptance order is:

1. correct world geometry and projection;
2. correct sky, lightmaps, fog, blend modes, alpha-tested foliage/grates, and
   transparent sprites;
3. visible players, projectiles, weapons, effects, items, and movers;
4. faithful HUD, crosshair, names, scoreboard, menus, and cursor;
5. dynamic lights, marks, shadows, and optional effects;
6. performance tuning.

Do not hide broken assets with generic fallbacks. Diagnose texture upload,
stride, wrap mode, shader stage, index type, and WebGL error state. Add bounded
diagnostics, then remove per-frame spam after fixing the defect.

## Aimbot and visibility assist

Add the optional assist in the Quake III cgame/client layer so it uses
authoritative snapshot entities and collision traces. Keep it disabled by
default and expose an explicit toggle/cvar.

Required targeting behavior:

- target enemies only; never the local player, spectators, dead players, or
  teammates in team modes;
- require a current unobstructed trace from the firing/view origin to the aim
  point; never aim at a player behind a wall;
- prioritize visible targets using angular error first with distance as a
  stable secondary score, or a documented weighted score that strongly favors
  an on-screen unobstructed threat;
- aim at a model-derived head/upper-torso point and tune against actual Quake
  player bounds, not an arbitrary world-space offset;
- reject invalid/NaN vectors and degenerate distances;
- normalize yaw and clamp pitch to Quake's legal view range;
- cap per-frame angular change or otherwise prevent a stale snapshot from
  snapping the camera straight up/down;
- clear the target on death, respawn, teleport, map change, intermission,
  spectator transition, or loss of visibility;
- run aim selection once per rendered snapshot, not independently in multiple
  browser event handlers.

If player highlighting is carried over, teammates must not glow. Use separate
colors for currently visible and occluded enemies and make the material follow
the animated model. Wall visualization may show an occluded enemy, but aim
selection must still reject that enemy. Keep the assist isolated enough that
server owners can compile or configure it out.

## Docker image and runtime data

Target `linux/amd64` first. The image should contain:

- the browser client and launcher;
- the lightweight Node host;
- the QuakeJS-compatible dedicated server;
- product-owned scripts/configuration;
- no retail PK3s.

Expected runtime layout:

```text
/data/
  baseq3/
    pak0.pk3 ... pak8.pk3   # user supplied
  custom_maps/              # optional PK3s
  runtime/                  # generated/cached server state
  config/                   # generated server config and secrets
```

The entrypoint validates required files and fails with a concise, actionable
message when they are absent. It should not start a broken server that later
fails inside the browser.

Initial environment contract:

| Variable | Default | Meaning |
| --- | --- | --- |
| `Q3JS_SLOTS` | `8` | Maintained human-plus-bot population |
| `Q3JS_HTTP_PORT` | `8088` | Website and WebSocket port |
| `Q3JS_DED_PORT` | implementation-defined | Internal dedicated game port |
| `Q3JS_BOTS` | `1` | Enable automatic bot fill |
| `KEEP_ALIVE` | `false` | Keep dedicated process running indefinitely |
| `IDLE_TIMEOUT` | `15m` | Empty-human shutdown delay |
| `Q3JS_RCON` | generated | Optional supplied RCON password |
| `Q3JS_MAPS` | built-in rotation | Optional comma-separated map rotation |

Provide `/health` for container health and `/status` for lifecycle/map/roster
diagnostics. Keep RCON secrets server-side.

## Git and release workflow

- `master` is the stable branch and publishes Docker tag `latest`.
- `devel` is the integration branch and publishes Docker tag `dev`.
- Use the existing self-hosted Mac runner pattern from wolfet-wasm, building a
  `linux/amd64` image through Docker Desktop/buildx without the macOS keychain
  credential helper.
- Repository secrets are `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.
- Do not run the expensive image build on GitHub-hosted runners.
- Add OCI source/revision labels.
- Test `dev` before fast-forwarding the same commit to `master`.

The upstream QuakeJS branch is preserved as remote `upstream`; this fork is
remote `origin`. Keep changes reviewable and do not rewrite upstream history.

Engine/submodule changes must be reproducible. Prefer a maintained
`patches/ioq3-wasm.patch` plus setup script, or move the submodule pointer to a
clearly identified fork if patching becomes unmanageable. Never leave the only
copy of a fix as dirty, uncommitted submodule state.

## Tests and acceptance gates

Automate the shell/runtime boundary with Node tests and structural source
checks. Browser rendering still requires real visual testing.

Minimum automated checks:

- name normalization and argument tokenization;
- settings persistence and 30/60/120 targets;
- content-addressed IndexedDB cache behavior;
- range-download assembly and length/hash rejection;
- lifecycle wake deduplication and idle shutdown;
- random map selection without immediate repetition;
- eight-player bot-fill arithmetic, including human join/leave;
- bounded WebSocket wake queue;
- environment parsing and invalid-value rejection;
- proprietary PK3 ignore rules and Docker-image absence;
- HTML/CSS/client startup contract;
- compiled WASM contains expected connection-state strings.

Manual acceptance path:

1. New private browsing profile opens the name/settings gate.
2. Play immediately paints a live server-starting screen.
3. Retail assets download once, validate, and enter IndexedDB.
4. The authentic main menu renders with correct music and mouse cursor.
5. Join shows resolving/connecting/challenge/gamestate/map/snapshot text.
6. A level renders with correct sky, lightmaps, players, items, effects, HUD,
   crosshair, and scoreboard.
7. WASD, jump, fire, weapon selection, mouselook, chat, console editing/history,
   Escape menu, and browser shortcuts behave correctly.
8. A human connection replaces one bot and total population remains eight.
9. A hard refresh reuses cached PK3s.
10. Dynamic quality moves down/up with hysteresis and never exceeds its ceiling.
11. The optional aimbot excludes teammates and occluded targets and never
    produces an up/down snap.
12. After the last human leaves, the server sleeps at the configured timeout
    and wakes again from the outer Play action.

## Implementation order

Work in vertical slices and compile/test after each:

1. Reproduce the current upstream QuakeJS build and dedicated match.
2. Modernize the Emscripten build enough to produce a working browser artifact.
3. Replace the old split content/master flow with one same-origin host.
4. Add local Steam asset import, manifest generation, range delivery, and
   IndexedDB restore.
5. Add the name/settings gate and server wake sequencing.
6. Add supervised sleep/wake and the eight-player bot backfill.
7. Fix input ownership, pointer lock, console/chat keys, and cursor behavior.
8. Fix canvas/aspect/HUD/loading/menu fidelity using original-source and Steam
   comparisons.
9. Add maximum and adaptive graphics profiles.
10. Add and test the optional aimbot/visibility assist.
11. Package the amd64 Docker image and publish `dev`; validate it before
    publishing `latest`.

Compile early. For platform code, fix the first meaningful compiler/runtime
error, rerun, and keep browser-specific changes behind explicit Emscripten
guards. Do not spend a long phase rewriting architecture without producing a
launchable artifact.
