#!/bin/sh
set -eu

baseq3="${Q3JS_DATA_ROOT:-/data}/baseq3"
missing=""
for index in 0 1 2 3 4 5 6 7 8; do
  if [ ! -s "$baseq3/pak${index}.pk3" ]; then
    missing="$missing pak${index}.pk3"
  fi
done
if [ -n "$missing" ]; then
  echo "quake3-wasm: missing owner-provided Quake III files in $baseq3:$missing" >&2
  echo "Mount a legal baseq3 directory at /data/baseq3; no retail PK3s are in this image." >&2
  exit 64
fi

exec node /opt/quake3/server/index.js
