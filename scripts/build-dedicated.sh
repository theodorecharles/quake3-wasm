#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_ROOT="${Q3JS_BUILD_ROOT:-$ROOT/build}"
BUILD_DIR="$BUILD_ROOT/server"
DIST_DIR="${Q3JS_SERVER_DIST:-$BUILD_ROOT/dedicated}"
BUILD_TYPE="${Q3JS_BUILD_TYPE:-Release}"

for command_name in cmake ninja; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "quake3-wasm: required command '$command_name' was not found" >&2
    exit 1
  }
done

cmake \
  -S "$ROOT/ioq3" \
  -B "$BUILD_DIR" \
  -G Ninja \
  -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
  -DBUILD_CLIENT=OFF \
  -DBUILD_SERVER=ON \
  -DBUILD_GAME_LIBRARIES=OFF \
  -DBUILD_GAME_QVMS=ON \
  -DBUILD_RENDERER_GL1=OFF \
  -DBUILD_RENDERER_GL2=OFF \
  -DUSE_OPENAL=OFF \
  -DUSE_VOIP=OFF

cmake --build "$BUILD_DIR" --parallel "${Q3JS_BUILD_JOBS:-2}"

OUTPUT_DIR="$BUILD_DIR/$BUILD_TYPE"
SERVER_BINARY="$(find "$OUTPUT_DIR" -maxdepth 1 -type f -name 'ioq3ded*' -perm -u+x | head -n 1)"
[[ -n "$SERVER_BINARY" ]] || {
  echo "quake3-wasm: native ioq3ded binary was not produced in $OUTPUT_DIR" >&2
  exit 1
}

cmake -E make_directory "$DIST_DIR"
cmake -E copy_if_different "$SERVER_BINARY" "$DIST_DIR/ioq3ded"

for game_dir in baseq3 missionpack; do
  if [[ -d "$OUTPUT_DIR/$game_dir/vm" ]]; then
    cmake -E make_directory "$DIST_DIR/$game_dir/vm"
    cmake -E copy_directory "$OUTPUT_DIR/$game_dir/vm" "$DIST_DIR/$game_dir/vm"
  fi
done

echo "quake3-wasm: dedicated server ready in $DIST_DIR"
