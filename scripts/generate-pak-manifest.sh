#!/usr/bin/env bash
set -euo pipefail

source_dir=${1:?usage: generate-pak-manifest.sh BASEQ3_DIRECTORY OUTPUT_JSON}
output=${2:?usage: generate-pak-manifest.sh BASEQ3_DIRECTORY OUTPUT_JSON}
temporary="${output}.tmp.$$"

cleanup() { rm -f -- "$temporary"; }
trap cleanup EXIT

for index in {0..8}; do
  pak="$source_dir/pak${index}.pk3"
  [[ -f "$pak" ]] || { echo "missing required owner file: $pak" >&2; exit 1; }
  header=$(od -An -tx1 -N4 "$pak" | tr -d ' \n')
  [[ "$header" == "504b0304" ]] || { echo "invalid PK3 header: $pak" >&2; exit 1; }
done

{
  printf '{\n  "schema": 1,\n  "source": "owner-provided Quake III Arena retail data",\n  "files": [\n'
  for index in {0..8}; do
    pak="$source_dir/pak${index}.pk3"
    size=$(stat -c '%s' "$pak")
    digest=$(sha256sum "$pak" | cut -d' ' -f1)
    comma=,
    [[ $index -eq 8 ]] && comma=
    printf '    {"name":"pak%d.pk3","size":%s,"sha256":"%s"}%s\n' \
      "$index" "$size" "$digest" "$comma"
  done
  printf '  ]\n}\n'
} > "$temporary"

mkdir -p -- "$(dirname -- "$output")"
mv -- "$temporary" "$output"
trap - EXIT
echo "generated validated owner manifest: $output"
