#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
build_dir=${BUILD_DIR:-"$repo_dir/build-web"}
pak_source=${PAK_SOURCE:-}

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

if [[ -n "$pak_source" ]]; then
  "$repo_dir/scripts/generate-pak-manifest.sh" \
    "$pak_source" \
    "$build_dir/pak-manifest.json"
  cmp "$repo_dir/web/pak-manifest.json" "$build_dir/pak-manifest.json" >/dev/null || {
    echo "Owner PAKs do not match the tracked supported manifest." >&2
    exit 1
  }
fi

echo "Web build ready in $build_dir"
echo "Run: $repo_dir/scripts/serve-web.sh"
