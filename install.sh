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
INSTALL_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/webbluetooth-firefox"
REPO_RAW="https://raw.githubusercontent.com/rfvx/web-bluetooth-firefox/main"
DEFAULT_NMH="${HOME}/.mozilla/native-messaging-hosts"

# ── Resolve host script path ─────────────────────────────────────────────────
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

# ── Python — find 3.8+ ───────────────────────────────────────────────────────
PYTHON=""
for candidate in python3 python; do
    if command -v "${candidate}" &>/dev/null \
       && "${candidate}" -c "import sys; sys.exit(0 if sys.version_info >= (3,8) else 1)" 2>/dev/null; then
        PYTHON="${candidate}"
        break
    fi
done

if [[ -z "${PYTHON}" ]]; then
    echo "ERROR: Python 3.8+ is required but was not found." >&2
    echo "       Install it with: sudo apt install python3" >&2
    exit 1
fi

echo "Using Python: $(command -v "${PYTHON}") ($(${PYTHON} --version))"

# ── Virtual environment + bleak ──────────────────────────────────────────────
# bleak is a library, not a CLI tool, so pipx is not appropriate here.
# A dedicated venv keeps bleak isolated from the system Python.
VENV_DIR="${INSTALL_DIR}/venv"

# A venv built against a Python that was since upgraded/removed has a dangling
# bin/python3 symlink — detect that and rebuild instead of failing on pip below.
if [[ -d "${VENV_DIR}" ]] && ! "${VENV_DIR}/bin/python3" -c '' &>/dev/null; then
    echo "Existing virtual environment is broken or built for a removed Python — rebuilding."
    rm -rf "${VENV_DIR}"
fi

if [[ ! -d "${VENV_DIR}" ]]; then
    echo "Creating virtual environment at ${VENV_DIR} ..."
    "${PYTHON}" -m venv "${VENV_DIR}"
else
    echo "Virtual environment already exists at ${VENV_DIR}, reusing."
fi

echo "Installing/upgrading bleak inside venv ..."
# The host requires bleak >= 0.20 (service discovery during connect();
# BleakClient.get_services() was removed in bleak 1.x).
"${VENV_DIR}/bin/pip" install --quiet --upgrade pip 'bleak>=0.20'

# ── Launcher wrapper ─────────────────────────────────────────────────────────
# The NMH manifest points to this wrapper, which ensures the host script
# always runs with the venv Python regardless of the system PATH.
LAUNCHER="${INSTALL_DIR}/launcher.sh"
cat > "${LAUNCHER}" <<LAUNCHER
#!/usr/bin/env bash
exec "${VENV_DIR}/bin/python3" "${HOST_SCRIPT}" "\$@"
LAUNCHER
chmod +x "${LAUNCHER}"

echo "Launcher: ${LAUNCHER}"

# ── Detect Firefox installations → collect NMH directories ──────────────────
NMH_DIRS=()

# Flatpak Firefox
if flatpak list --app 2>/dev/null | grep -q "org.mozilla.firefox"; then
    NMH_DIRS+=("${HOME}/.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts")
    echo "  ✓ Flatpak Firefox detected"
fi

# System Firefox (apt, rpm, tarball) — command exists and is not a flatpak wrapper
FF_PATH="$(command -v firefox 2>/dev/null || true)"
if [[ -n "${FF_PATH}" && "${FF_PATH}" != *"flatpak"* && "${FF_PATH}" != *"snap"* ]]; then
    NMH_DIRS+=("${DEFAULT_NMH}")
    echo "  ✓ System Firefox detected (${FF_PATH})"
fi

# Snap Firefox — reads the standard NMH path, but only through the
# xdg-desktop-portal WebExtensions backend (Ubuntu 22.04+; see README).
if snap list firefox &>/dev/null; then
    if [[ " ${NMH_DIRS[*]} " != *" ${DEFAULT_NMH} "* ]]; then
        NMH_DIRS+=("${DEFAULT_NMH}")
    fi
    echo "  ✓ Snap Firefox detected (requires xdg-desktop-portal WebExtensions support; see README)"
fi

# Fallback — no Firefox found on PATH, write to standard location anyway
if [[ ${#NMH_DIRS[@]} -eq 0 ]]; then
    echo "  ! No running Firefox installation detected — using default path"
    NMH_DIRS+=("${DEFAULT_NMH}")
fi

# ── Write NMH manifest to every detected location ────────────────────────────
for NMH_DIR in "${NMH_DIRS[@]}"; do
    mkdir -p "${NMH_DIR}"
    cat > "${NMH_DIR}/webbluetooth_host.json" <<JSON
{
  "name": "webbluetooth_host",
  "description": "WebBluetooth Native Messaging Host",
  "path": "${LAUNCHER}",
  "type": "stdio",
  "allowed_extensions": ["${EXTENSION_ID}"]
}
JSON
    echo "  ✓ NMH manifest written: ${NMH_DIR}/webbluetooth_host.json"
done

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "Installation complete!"
echo ""
echo "  Host script : ${HOST_SCRIPT}"
echo "  Python venv : ${VENV_DIR}"
echo "  Launcher    : ${LAUNCHER}"
echo ""
echo "Next step: install the Firefox extension (if not already installed)"
echo "  • From AMO  : https://addons.mozilla.org/firefox/addon/webbluetooth-for-firefox/"
echo "  • From file : open about:addons → gear icon → Install Add-on From File → select .xpi"
echo ""
echo "If you get a 'permission denied' Bluetooth error, add yourself to the bluetooth group:"
echo "  sudo usermod -aG bluetooth \$USER   (then log out and back in)"
