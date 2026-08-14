#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_dir}"

test "$(git branch --show-current)" = "devel"
test "$(node -p "require('./site/framework-install.json').version")" = "0.7.0"
test "$(node -p "require('./site/framework-install.json').commit")" = "536d919"
test ! -e site/index.html
test ! -e site/style.css
test ! -e site/service-worker.js
test ! -e site/app.webmanifest
test ! -e bin/index.ejs
test ! -e bin/web.js
test ! -e index.html
test ! -e service-worker.js
test ! -e app.webmanifest

if find site web -type f \( -name '*.html' -o -name '*.css' -o -name 'service-worker.js' -o -name '*.webmanifest' \) 2>/dev/null | grep -q .; then
  echo 'downstream launcher documents/styles/PWA runtime are forbidden' >&2
  exit 1
fi

node --check site/game-adapter.js
node --check server/supervisor.js
node --check scripts/rewrite-quakejs.js
node --check scripts/rewrite-quakejs-dedicated.js
node scripts/rewrite-quakejs-dedicated.js build/ioq3ded.js /tmp/ioq3ded-framework-test.js
rg -q 'FS_Startup:function \(callback\) \{ callback\(null\);' /tmp/ioq3ded-framework-test.js
rg -q "NODE_PATH: '/opt/q3-server/node_modules'" server/supervisor.js
node -e '
  const fs = require("fs");
  const game = JSON.parse(fs.readFileSync("site/wasm-game.json"));
  const data = JSON.parse(fs.readFileSync("site/wasm-game-data.json"));
  if (game.adapter !== "/game-adapter.js") throw new Error("canonical adapter missing");
  if (game.displayMode !== "dynamic" || game.resizeTransition !== "immediate") throw new Error("dynamic immediate display policy missing");
  if (game.pointerWidth !== 640 || game.pointerHeight !== 480 || game.pointerFit !== "contain") throw new Error("Q3 pointer mapping policy missing");
  if (game.fullscreen !== true) throw new Error("remembered fullscreen control is not enabled");
  if (!game.pwa || !game.pwa.icons.some(icon => icon.sizes === "any") || !game.pwa.icons.some(icon => icon.sizes === "512x512")) throw new Error("authentic PWA icons missing");
  if (data.files.length !== 9 || data.files.some((file, index) => file.name !== `pak${index}.pk3` || !/^[a-f0-9]{64}$/.test(file.sha256))) throw new Error("retail PAK allowlist incomplete");
'

rg -q 's_main\.joinGame\.string[[:space:]]*=[[:space:]]*"JOIN GAME"' ioq3/code/q3_ui/ui_menu.c
! rg -q 's_main\.(singleplayer|multiplayer)' ioq3/code/q3_ui/ui_menu.c
rg -q 'ui_joinGameRequested' ioq3/code/q3_ui/ui_menu.c
rg -q 'cg_wasmActive' ioq3/code/cgame/cg_main.c
rg -q 'WASM_HUMAN_JOINED' ioq3/code/game/g_client.c
rg -q 'WASM_HUMAN_LEFT' ioq3/code/game/g_client.c
rg -q 'WASM_BOT_JOINED' ioq3/code/game/g_client.c
rg -q 'WASM_BOT_LEFT' ioq3/code/game/g_client.c
rg -q "createWakeClient" site/game-adapter.js
rg -q "location\.hostname" site/game-adapter.js
rg -q "pointerFit" site/wasm-game.json

! rg -q 'The container stores your legally owned PAKs once; this browser also caches them for fast reloads\.' . 
! git ls-files | rg -q '(^|/)pak[0-8]\.pk3$'
! git ls-files | rg -q '(^|/)(index\.html|service-worker\.js|app\.webmanifest)$'

if [[ -d web ]]; then
  test ! -e web/index.html
  test ! -e web/service-worker.js
  test ! -e web/app.webmanifest
  test -s web/wasm-game.json
  test -s web/game-adapter.js
  test -s web/ioquake3.js
  ! rg -q "eula-frame-inner|id = 'dialog'|addEventListener\(event, SDL\.receiveEvent, true\)" web/ioquake3.js
fi

echo 'static architecture/security checks passed'
