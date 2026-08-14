#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_dir=${BUILD_DIR:-"$repo_dir/build-web"}
port=${PORT:-8083}

[[ -f "$build_dir/index.html" ]] || { echo "Run ./build-web.sh first." >&2; exit 1; }
echo "Serving quake3-wasm at http://127.0.0.1:${port}/"
exec python3 -m http.server "$port" --bind 127.0.0.1 --directory "$build_dir"
