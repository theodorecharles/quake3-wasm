#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_dir=${BUILD_DIR:-"$repo_dir/build-web"}
framework_dir=${WASM_FRAMEWORK_DIR:-"$repo_dir/../wasm-game-framework"}

node --check "$repo_dir/web/assets.js"
node --check "$repo_dir/web/game-adapter.js"
node --check "$build_dir/ioquake3.js"
node - "$repo_dir/web/assets.js" <<'NODE'
const fs = require("fs");
const vm = require("vm");
vm.runInThisContext(fs.readFileSync(process.argv[2], "utf8"));
const digest = globalThis.Quake3Assets.hashBytesForTest(Buffer.from("abc"));
if (digest !== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") {
  throw new Error(`streaming SHA-256 self-test failed: ${digest}`);
}
NODE

for artifact in wasm-game.json game-adapter.js assets.js ioquake3.js pak-manifest.json wasm-game-data.json quake3.ico quake3-background.bmp shared-shell/wolfwasm-shell.js shared-shell/wolfwasm-shell.css shared-shell/wolfwasm-bootstrap.js shared-shell/wasm-game-framework.json; do
  [[ -s "$build_dir/$artifact" ]] || { echo "missing build artifact: $artifact" >&2; exit 1; }
done
for forbidden in "$repo_dir/web/index.html" "$repo_dir/web/style.css" "$repo_dir/web/launcher.js" "$build_dir/index.html" "$build_dir/style.css" "$build_dir/launcher.js"; do
  [[ ! -e "$forbidden" ]] || { echo "downstream shell artifact must not exist: $forbidden" >&2; exit 1; }
done

cmp "$framework_dir/dist/wolfwasm-shell.js" "$build_dir/shared-shell/wolfwasm-shell.js" >/dev/null
cmp "$framework_dir/dist/wolfwasm-shell.css" "$build_dir/shared-shell/wolfwasm-shell.css" >/dev/null
cmp "$framework_dir/dist/wolfwasm-bootstrap.js" "$build_dir/shared-shell/wolfwasm-bootstrap.js" >/dev/null
node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1])); if(m.version!=="0.5.3"||!m.bootstrapSha256) process.exit(1)' "$build_dir/shared-shell/wasm-game-framework.json"
node - "$build_dir/wasm-game.json" <<'NODE'
const fs = require('fs');
const game = JSON.parse(fs.readFileSync(process.argv[2]));
if (game.id !== 'quake3' || game.adapter !== '/game-adapter.js') throw new Error('invalid Q3 adapter manifest');
if (game.displayMode !== 'dynamic' || game.nativeManaged !== true || game.syncBackbuffer !== false) {
  throw new Error('Q3 must use native-managed dynamic resolution');
}
if (game.pointerWidth !== 640 || game.pointerHeight !== 480 || game.pointerFit !== 'contain' || game.resizeTransition !== 'immediate') {
  throw new Error('Q3 must declare its 640x480 native menu pointer and immediate resize contract');
}
if (!game.icon || !game.background || game.profiles.length !== 3 || game.fpsTargets.length !== 3) {
  throw new Error('Q3 branding and launcher preferences are incomplete');
}
NODE

if rg -i 'The container stores your legally owned PAKs once|browser also caches them for fast reloads' "$repo_dir/web" "$build_dir" "$framework_dir/dist/index.html" >/dev/null; then
  echo "stale owner-data explainer is visible on the normal launcher" >&2
  exit 1
fi
grep -q "globalThis.WasmGameAdapter" "$repo_dir/web/game-adapter.js"
grep -q "createOwnerDataSet" "$repo_dir/web/game-adapter.js"
grep -q "createQualityController" "$repo_dir/web/game-adapter.js"
grep -q "waitForQuakeJsRuntime" "$repo_dir/web/game-adapter.js"
grep -Fq "FS?.init?.initialized" "$repo_dir/web/game-adapter.js"
grep -q "using exact validated browser-local owner PAKs" "$repo_dir/web/game-adapter.js"
grep -Fq '"+bind", "w", quoteStartupValue("+forward")' "$repo_dir/web/game-adapter.js"
grep -q "setCanvasSize" "$repo_dir/web/game-adapter.js"
grep -q "installEarlyConfig" "$repo_dir/web/game-adapter.js"
grep -q 'autoexec.cfg' "$repo_dir/web/game-adapter.js"
grep -q "captureLost" "$repo_dir/web/game-adapter.js"
grep -q "pointerMove(detail" "$repo_dir/web/game-adapter.js"
grep -q "q3MappedPointer" "$repo_dir/web/game-adapter.js"
grep -q "Quake3RendererDiagnostics" "$repo_dir/web/game-adapter.js"
if rg '/local-data/' "$repo_dir/web/game-adapter.js"; then
  echo "legacy direct owner-data route is still referenced" >&2
  exit 1
fi
if rg 'createQuake3Module|src="quake3\.js"' "$repo_dir/web"; then
  echo "broken experimental renderer launcher is still referenced" >&2
  exit 1
fi

node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1])); if(m.schema!==1||m.files.length!==9) process.exit(1)' "$build_dir/pak-manifest.json"
node - "$build_dir/pak-manifest.json" "$build_dir/wasm-game-data.json" <<'NODE'
const fs = require('fs');
const browser = JSON.parse(fs.readFileSync(process.argv[2]));
const server = JSON.parse(fs.readFileSync(process.argv[3]));
if (server.files.length !== browser.files.length) throw new Error('server/browser PAK policy count differs');
for (const expected of browser.files) {
  const actual = server.files.find(file => file.name === expected.name);
  if (!actual || actual.size !== expected.size || actual.sha256 !== expected.sha256) {
    throw new Error(`server/browser policy differs for ${expected.name}`);
  }
}
NODE

if git -C "$repo_dir" ls-files '*.pk3' | grep -q .; then
  echo "proprietary PK3 found in git index" >&2
  exit 1
fi
if find "$build_dir" -maxdepth 2 -type f \( -iname '*.pk3' -o -iname '*.pak' \) | grep -q .; then
  echo "proprietary PAK found in browser build" >&2
  exit 1
fi
git -C "$repo_dir" diff --check
echo "Quake III canonical adapter, framework, cache, controls, diagnostics, and retail boundary checks passed"
