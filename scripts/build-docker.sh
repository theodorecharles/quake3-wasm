#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${IMAGE_REPO:-theodorecharles/quake3-wasm}:${IMAGE_TAG:-dev}"

for artifact in \
  package-lock.json \
  web/index.html \
  web/client/ioquake3.js \
  web/client/ioquake3.wasm \
  build/dedicated/ioq3ded \
  build/dedicated/baseq3/vm/cgame.qvm \
  build/dedicated/baseq3/vm/qagame.qvm \
  build/dedicated/baseq3/vm/ui.qvm; do
  test -s "$repo_root/$artifact" || {
    echo "Missing $artifact; run npm run build:client and npm run build:server first." >&2
    exit 1
  }
done

docker build --platform linux/amd64 \
  --build-arg "VCS_REF=$(git -C "$repo_root" rev-parse HEAD)" \
  --tag "$image" "$repo_root"
echo "Built $image"
