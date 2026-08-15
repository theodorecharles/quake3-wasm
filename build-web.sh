#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
build_dir=${BUILD_DIR:-"$repo_dir/build-web"}
quakejs_dir=${QUAKEJS_DIR:-"$repo_dir/vendor/quakejs"}
framework_dir=${WASM_FRAMEWORK_DIR:-"$repo_dir/../wasm-game-framework"}
pak_source=${PAK_SOURCE:-}

if [[ ! -s "$quakejs_dir/build/ioquake3.js" ]]; then
  echo "Pinned QuakeJS source/artifact is missing. Run: git submodule update --init vendor/quakejs" >&2
  exit 1
fi
if [[ ! -x "$framework_dir/scripts/install-browser-package.sh" ]]; then
  echo "Shared wasm-game-framework is unavailable at $framework_dir" >&2
  exit 1
fi

mkdir -p "$build_dir"
rm -f "$build_dir/index.html" "$build_dir/style.css" "$build_dir/launcher.js"
install -m 0644 "$repo_dir/web/wasm-game.json" "$build_dir/wasm-game.json"
install -m 0644 "$repo_dir/web/assets.js" "$build_dir/assets.js"
install -m 0644 "$repo_dir/web/game-adapter.js" "$build_dir/game-adapter.js"
install -m 0644 "$repo_dir/web/pak-manifest.json" "$build_dir/pak-manifest.json"
install -m 0644 "$repo_dir/web/wasm-game-data.json" "$build_dir/wasm-game-data.json"
install -m 0644 "$quakejs_dir/build/ioquake3.js" "$build_dir/ioquake3.js"
install -m 0644 "$repo_dir/code/win32/icon2.ico" "$build_dir/quake3.ico"
install -m 0644 "$repo_dir/code/win32/background.bmp" "$build_dir/quake3-background.bmp"
"$framework_dir/scripts/install-browser-package.sh" "$build_dir/shared-shell" copy

if [[ -n "$pak_source" ]]; then
  generated_manifest="$build_dir/pak-manifest.generated.json"
  "$repo_dir/scripts/generate-pak-manifest.sh" "$pak_source" "$generated_manifest"
  cmp "$repo_dir/web/pak-manifest.json" "$generated_manifest" >/dev/null || {
    echo "Owner PAKs do not match the tracked supported manifest." >&2
    exit 1
  }
  rm -f "$generated_manifest"
fi

"$repo_dir/tests/static.sh"
echo "QuakeJS-backed browser build ready in $build_dir"
echo "Run: $repo_dir/scripts/serve-web.sh"
