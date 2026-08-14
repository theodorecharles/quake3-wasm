#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
framework_dir="/home/ted/Development/wasm/wasm-game-framework"
image="${1:-wasm-quake3-framework:devel}"
framework_version="$(node -p "require('${framework_dir}/package.json').version")"

test "${framework_version}" = "0.7.0"
test "$(git -C "${framework_dir}" rev-parse --short HEAD)" = "536d919"
"${repo_dir}/build-web.sh"
"${framework_dir}/scripts/build-base-image.sh" "wasm-game-framework:${framework_version}"

context_dir="$(mktemp -d -t quake3-wasm-image.XXXXXX)"
trap 'rm -rf -- "${context_dir}"' EXIT
mkdir -p "${context_dir}/game-site" "${context_dir}/quakejs" "${context_dir}/q3-server" "${context_dir}/q3-framework"
cp -a "${repo_dir}/web/." "${context_dir}/game-site/"
node "${repo_dir}/scripts/rewrite-quakejs-dedicated.js" "${repo_dir}/build/ioq3ded.js" "${context_dir}/quakejs/ioq3ded.js"
cp "${repo_dir}/server/package.json" "${repo_dir}/server/supervisor.js" "${repo_dir}/server/server.cfg" "${context_dir}/q3-server/"
cp "${repo_dir}/ioq3/build/release-linux-x86_64/baseq3/vm/qagame.qvm" "${context_dir}/q3-server/qagame.qvm"
cp "${framework_dir}/server/lifecycle.js" "${context_dir}/q3-framework/lifecycle.js"
cp "${repo_dir}/docker/Dockerfile" "${context_dir}/Dockerfile"

docker build --build-arg "FRAMEWORK_IMAGE=wasm-game-framework:${framework_version}" --tag "${image}" "${context_dir}"
test "$(docker run --rm --entrypoint node "${image}" -p "require('/opt/wasm-game-framework/package.json').version")" = "0.7.0"
printf 'built %s\n' "${image}"
