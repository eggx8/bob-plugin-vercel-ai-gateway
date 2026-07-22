#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VERSION="$(node -e "const fs=require('fs'); process.stdout.write(JSON.parse(fs.readFileSync('${PROJECT_DIR}/info.json','utf8')).version)")"
OUTPUT_DIR="${PROJECT_DIR}/bobplugin"
OUTPUT_FILE="${OUTPUT_DIR}/vercel-ai-gateway_${VERSION}.bobplugin"
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/vercel-ai-gateway.XXXXXX")"
RUNTIME_FILES=(info.json main.js languages.js icon.png)

cleanup() {
  rm -rf "${STAGING_DIR}"
}
trap cleanup EXIT

mkdir -p "${OUTPUT_DIR}"
for runtime_file in "${RUNTIME_FILES[@]}"; do
  install -m 0644 "${PROJECT_DIR}/${runtime_file}" "${STAGING_DIR}/${runtime_file}"
  touch -t 202001010000 "${STAGING_DIR}/${runtime_file}"
done

rm -f "${OUTPUT_FILE}"
(
  cd "${STAGING_DIR}"
  zip -q -X "${OUTPUT_FILE}" "${RUNTIME_FILES[@]}"
)

echo "Created ${OUTPUT_FILE}"
