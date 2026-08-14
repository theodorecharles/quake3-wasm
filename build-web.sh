#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
build_dir=${BUILD_DIR:-"$repo_dir/build-web"}
pak_source=${PAK_SOURCE:-}

if [[ -z "$pak_source" ]]; then
  echo "PAK_SOURCE must explicitly name your legal Quake III baseq3 directory." >&2
  echo "Example: PAK_SOURCE=/path/to/Quake\\ 3\\ Arena/baseq3 ./build-web.sh" >&2
  exit 1
fi

if ! command -v emcmake >/dev/null 2>&1; then
  emsdk_env=${EMSDK_ENV:-${EMSDK:+$EMSDK/emsdk_env.sh}}
  if [[ -z "$emsdk_env" || ! -f "$emsdk_env" ]]; then
    echo "Emscripten is not active. Source emsdk_env.sh or set EMSDK_ENV explicitly." >&2
    exit 1
  fi
  # emsdk_env.sh intentionally updates PATH and compiler variables.
  set +u
  source "$emsdk_env" >/dev/null
  set -u
fi

emcmake cmake -S "$repo_dir" -B "$build_dir" -G Ninja \
  -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build "$build_dir" --parallel

"$repo_dir/scripts/generate-pak-manifest.sh" \
  "$pak_source" \
  "$build_dir/pak-manifest.json"

echo "Web build ready in $build_dir"
echo "Run: $repo_dir/scripts/serve-web.sh"
