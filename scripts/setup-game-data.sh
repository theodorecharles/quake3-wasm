#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINATION="${Q3JS_DATA_DIR:-$ROOT/data/baseq3}"
MODE="link"

if [[ "${1:-}" == "--copy" ]]; then
  MODE="copy"
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--copy]" >&2
  exit 2
fi

CANDIDATES=()
[[ -n "${Q3_PATH:-}" ]] && CANDIDATES+=("$Q3_PATH")
CANDIDATES+=(
  "$HOME/.steam/debian-installation/steamapps/common/Quake 3 Arena/baseq3"
  "$HOME/.local/share/Steam/steamapps/common/Quake 3 Arena/baseq3"
  "$HOME/.steam/steam/steamapps/common/Quake 3 Arena/baseq3"
)

SOURCE_DIR=""
for candidate in "${CANDIDATES[@]}"; do
  if [[ -f "$candidate/pak0.pk3" ]]; then
    SOURCE_DIR="$candidate"
    break
  fi
done

if [[ -z "$SOURCE_DIR" ]]; then
  echo "quake3-wasm: Quake III data not found; set Q3_PATH to the directory containing pak0.pk3" >&2
  exit 1
fi

mkdir -p "$DESTINATION"
for index in {0..8}; do
  name="pak${index}.pk3"
  source_file="$SOURCE_DIR/$name"
  [[ -s "$source_file" ]] || {
    echo "quake3-wasm: required retail file is missing: $source_file" >&2
    exit 1
  }
  if [[ "$MODE" == "copy" ]]; then
    cp -f "$source_file" "$DESTINATION/$name"
  else
    ln -sfn "$source_file" "$DESTINATION/$name"
  fi
done

echo "quake3-wasm: installed pak0.pk3 through pak8.pk3 from $SOURCE_DIR into $DESTINATION ($MODE)"
