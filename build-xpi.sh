#!/usr/bin/env bash
# build-xpi.sh — Package the extension as a .xpi file.
#
# The produced .xpi can be:
#   • Submitted to addons.mozilla.org for signing (listed or unlisted)
#   • Installed directly in Firefox Developer Edition / Nightly
#     (about:addons → gear → Install Add-on From File)
#   • Submitted to AMO's self-distribution signing service for use in
#     standard Firefox releases
#
# Usage:
#   bash build-xpi.sh [output-filename]
#
# Default output: webbluetooth-for-firefox-<version>.xpi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="${SCRIPT_DIR}/webbluetooth-firefox-extension"

if [[ ! -f "${EXT_DIR}/manifest.json" ]]; then
    echo "ERROR: manifest.json not found in ${EXT_DIR}" >&2
    exit 1
fi

VERSION="$(python3 -c "import json; print(json.load(open('${EXT_DIR}/manifest.json'))['version'])")"
OUTPUT="${1:-webbluetooth-for-firefox-${VERSION}.xpi}"

# Resolve to absolute path so it works from any cwd
if [[ "${OUTPUT}" != /* ]]; then
    OUTPUT="${SCRIPT_DIR}/${OUTPUT}"
fi

rm -f "${OUTPUT}"

cd "${EXT_DIR}"
zip -r -9 "${OUTPUT}" \
    manifest.json \
    background.js \
    content-script.js \
    polyfill.js \
    picker.html \
    picker.js \
    picker.css \
    icons/

echo ""
echo "Built: ${OUTPUT}"
echo "Size : $(du -h "${OUTPUT}" | cut -f1)"
echo ""
echo "To submit for signing, upload to:"
echo "  https://addons.mozilla.org/developers/addon/submit/upload-listed"
echo "  (or upload-unlisted for self-distribution)"
