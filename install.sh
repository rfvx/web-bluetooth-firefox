#!/usr/bin/env bash
# install.sh — Sets up the WebBluetooth for Firefox native messaging host.
#
# Usage (from a cloned repo):
#   bash install.sh
#
# Usage (one-liner, no clone needed):
#   bash <(curl -fsSL https://raw.githubusercontent.com/rfvx/web-bluetooth-firefox/main/install.sh)

set -euo pipefail

EXTENSION_ID="webbluetooth@rfvx.github.io"
NMH_DIR="${HOME}/.mozilla/native-messaging-hosts"
INSTALL_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/webbluetooth-firefox"
REPO_RAW="https://raw.githubusercontent.com/rfvx/web-bluetooth-firefox/main"

# ── Resolve host script path ─────────────────────────────────────────────────
# If this script is being sourced from a cloned repo, use the local copy.
# Otherwise, download the host script to the user's data directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")"
if [[ -f "${SCRIPT_DIR}/webbluetooth_host.py" ]]; then
    HOST_SCRIPT="${SCRIPT_DIR}/webbluetooth_host.py"
else
    echo "Downloading host script to ${INSTALL_DIR} ..."
    mkdir -p "${INSTALL_DIR}"
    curl -fsSL "${REPO_RAW}/webbluetooth_host.py" -o "${INSTALL_DIR}/webbluetooth_host.py"
    HOST_SCRIPT="${INSTALL_DIR}/webbluetooth_host.py"
fi

chmod +x "${HOST_SCRIPT}"

# ── Python / bleak ───────────────────────────────────────────────────────────
PYTHON=""
for candidate in python3 python; do
    if command -v "${candidate}" &>/dev/null && "${candidate}" -c "import sys; sys.exit(0 if sys.version_info >= (3,8) else 1)" 2>/dev/null; then
        PYTHON="${candidate}"
        break
    fi
done

if [[ -z "${PYTHON}" ]]; then
    echo "ERROR: Python 3.8+ is required but was not found." >&2
    echo "       Install it with your package manager, e.g.:" >&2
    echo "         sudo apt install python3" >&2
    echo "         sudo dnf install python3" >&2
    exit 1
fi

echo "Using Python: $(command -v "${PYTHON}") ($(${PYTHON} --version))"
echo "Installing/upgrading bleak ..."
"${PYTHON}" -m pip install --quiet --user --upgrade bleak

# ── Native messaging host manifest ───────────────────────────────────────────
mkdir -p "${NMH_DIR}"
cat > "${NMH_DIR}/webbluetooth_host.json" <<JSON
{
  "name": "webbluetooth_host",
  "description": "WebBluetooth Native Messaging Host",
  "path": "${HOST_SCRIPT}",
  "type": "stdio",
  "allowed_extensions": ["${EXTENSION_ID}"]
}
JSON

echo ""
echo "Installation complete!"
echo ""
echo "  Host script : ${HOST_SCRIPT}"
echo "  NMH manifest: ${NMH_DIR}/webbluetooth_host.json"
echo ""
echo "Next step: install the Firefox extension(if not already installed)"
echo "  • From AMO  : https://addons.mozilla.org/firefox/addon/webbluetooth-for-firefox/"
echo "  • From file : open about:addons → gear icon → Install Add-on From File → select .xpi"
echo ""
echo "If you get a 'permission denied' Bluetooth error, add yourself to the bluetooth group:"
echo "  sudo usermod -aG bluetooth \$USER   (then log out and back in)"
