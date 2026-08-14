#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output_dir="${repo_dir}/web"
qvm_dir="${repo_dir}/ioq3/build/release-linux-x86_64/baseq3/vm"

make -C "${repo_dir}/ioq3" -j"${JOBS:-4}" \
  BUILD_CLIENT=0 BUILD_SERVER=0 BUILD_GAME_SO=0 BUILD_GAME_QVM=1 \
  BUILD_BASEGAME=1 BUILD_MISSIONPACK=0

rm -rf -- "${output_dir}"
mkdir -p "${output_dir}" "${output_dir}/qvm-patch/vm"
cp "${repo_dir}/site/wasm-game.json" "${repo_dir}/site/wasm-game-data.json" \
  "${repo_dir}/site/framework-install.json" "${repo_dir}/site/game-adapter.js" "${output_dir}/"
node "${repo_dir}/scripts/rewrite-quakejs.js" "${repo_dir}/build/ioquake3.js" "${output_dir}/ioquake3.js"
cp "${repo_dir}/ioq3/misc/quake3.ico" "${output_dir}/quake3.ico"
cp "${repo_dir}/ioq3/misc/quake3.svg" "${output_dir}/quake3.svg"
cp "${repo_dir}/ioq3/misc/quake3-tango.png" "${output_dir}/quake3-background.png"
cp "${repo_dir}/ioq3/misc/quake3_flat.iconset/icon_256x256@2x.png" "${output_dir}/pwa-512.png"
cp "${qvm_dir}/ui.qvm" "${qvm_dir}/cgame.qvm" "${output_dir}/qvm-patch/vm/"
(cd "${output_dir}/qvm-patch" && zip -q -r "${output_dir}/q3-framework-ui.pk3" vm)
rm -rf -- "${output_dir}/qvm-patch"

test ! -e "${output_dir}/index.html"
test ! -e "${output_dir}/service-worker.js"
test ! -e "${output_dir}/app.webmanifest"
printf 'built canonical QuakeJS site at %s\n' "${output_dir}"
