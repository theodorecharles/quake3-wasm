#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_dir=${BUILD_DIR:-"$repo_dir/build-web"}

node --check "$repo_dir/web/assets.js"
node --check "$repo_dir/web/launcher.js"
node - "$repo_dir/web/assets.js" <<'NODE'
const fs = require("fs");
const vm = require("vm");
global.window = {};
vm.runInThisContext(fs.readFileSync(process.argv[2], "utf8"));
const digest = window.Quake3Assets.hashBytesForTest(Buffer.from("abc"));
if (digest !== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") {
  throw new Error(`streaming SHA-256 self-test failed: ${digest}`);
}
NODE
for artifact in index.html launcher.js assets.js style.css quake3.js quake3.wasm pak-manifest.json; do
  [[ -s "$build_dir/$artifact" ]] || { echo "missing build artifact: $artifact" >&2; exit 1; }
done
node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1])); if(m.schema!==1||m.files.length!==9) process.exit(1)' "$build_dir/pak-manifest.json"
if git -C "$repo_dir" ls-files '*.pk3' | grep -q .; then
  echo "proprietary PK3 found in git index" >&2
  exit 1
fi
echo "static checks passed"
