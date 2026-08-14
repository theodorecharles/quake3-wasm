#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_ROOT="${Q3JS_BUILD_ROOT:-$ROOT/build}"
BUILD_DIR="$BUILD_ROOT/client"
DIST_DIR="${Q3JS_CLIENT_DIST:-$ROOT/web/client}"
BUILD_TYPE="${Q3JS_BUILD_TYPE:-Release}"
PATCH_FILE="$ROOT/patches/ioq3-wasm.patch"
PATCH_APPLIED=0

restore_source_tree() {
  local build_status=$?
  if (( PATCH_APPLIED )); then
    if ! git -C "$ROOT/ioq3" apply --reverse "$PATCH_FILE"; then
      echo "quake3-wasm: failed to restore the ioq3 source tree after the build" >&2
      build_status=1
    fi
  fi
  trap - EXIT
  exit "$build_status"
}

trap restore_source_tree EXIT

if ! command -v emcmake >/dev/null 2>&1; then
  EMSDK_ROOT="${Q3JS_EMSDK:-/home/ted/emsdk}"
  if [[ ! -f "$EMSDK_ROOT/emsdk_env.sh" ]]; then
    echo "quake3-wasm: emcmake is unavailable; set Q3JS_EMSDK to an emsdk checkout" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$EMSDK_ROOT/emsdk_env.sh" >/dev/null
fi

for command_name in emcmake cmake ninja; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "quake3-wasm: required command '$command_name' was not found" >&2
    exit 1
  }
done

if git -C "$ROOT/ioq3" apply --reverse --check "$PATCH_FILE" >/dev/null 2>&1; then
  : # Browser integration patch is already present in this checkout.
elif git -C "$ROOT/ioq3" apply --check "$PATCH_FILE" >/dev/null 2>&1; then
  git -C "$ROOT/ioq3" apply "$PATCH_FILE"
  PATCH_APPLIED=1
else
  echo "quake3-wasm: $PATCH_FILE does not apply cleanly to the pinned ioq3 commit" >&2
  exit 1
fi

emcmake cmake \
  -S "$ROOT/ioq3" \
  -B "$BUILD_DIR" \
  -G Ninja \
  -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
  -DBUILD_CLIENT=ON \
  -DBUILD_SERVER=OFF \
  -DBUILD_GAME_LIBRARIES=OFF \
  -DBUILD_GAME_QVMS=OFF \
  -DBUILD_RENDERER_GL1=OFF \
  -DBUILD_RENDERER_GL2=ON \
  -DUSE_RENDERER_DLOPEN=OFF \
  -DUSE_OPENAL=OFF \
  -DUSE_VOIP=OFF

cmake --build "$BUILD_DIR" --parallel "${Q3JS_BUILD_JOBS:-2}"

OUTPUT_DIR="$BUILD_DIR/$BUILD_TYPE"
ARTIFACTS=(ioquake3.js ioquake3.wasm)
for artifact in "${ARTIFACTS[@]}"; do
  [[ -f "$OUTPUT_DIR/$artifact" ]] || {
    echo "quake3-wasm: expected client artifact was not produced: $OUTPUT_DIR/$artifact" >&2
    exit 1
  }
done

cmake -E make_directory "$DIST_DIR"
for artifact in "${ARTIFACTS[@]}"; do
  cmake -E copy_if_different "$OUTPUT_DIR/$artifact" "$DIST_DIR/$artifact"
done

echo "quake3-wasm: browser engine ready in $DIST_DIR"
