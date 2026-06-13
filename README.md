# WebBluetooth for Firefox

Enables the [Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API) in Firefox on Linux, which allows for the use of websites which access external Bluetooth devices. Chrome supports `navigator.bluetooth` natively; Firefox does not — this extension bridges the gap via a native messaging host. *Disclosure*: this project has so far been completely made with Generative AI.

## Quick Install

### Step 1 — Native host (one command, no interaction)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/rfvx/web-bluetooth-firefox/main/install.sh)
```

Or, if you've already cloned the repo:

```bash
bash install.sh
```

### Step 2 — Browser extension

**From the Firefox Add-on Store (recommended):**
> [Install WebBluetooth for Firefox on the Mozilla addons store](https://addons.mozilla.org/firefox/addon/webbluetooth-for-firefox/)

**From a local `.xpi` file:**
1. Download `webbluetooth-for-firefox-1.0.xpi` from the [Releases page](https://github.com/rfvx/web-bluetooth-firefox/releases).
2. In Firefox: `about:addons` → gear icon → **Install Add-on From File** → select the `.xpi`.

---

## Requirements

- Firefox 109+
- Python 3.8+ (`python3`)
- BlueZ (standard on most Linux distros; included in `bluez` package)

Installed Firefox via **Flatpak or Snap**? See [Sandboxed Firefox](#sandboxed-firefox-flatpak--snap) for the extra permissions required.

## Features

- **Device picker** — graphical chooser that appears when a site calls `requestDevice()`
- **GATT operations** — `readValue`, `writeValue`, descriptors
- **Notifications** — real-time characteristic notifications
- **Advertisement watching** — `watchAdvertisements()` API support
- **Device filtering** — by service UUID, name, or name prefix
- **Privacy** — real MAC addresses are never exposed to webpages; only per-origin obfuscated IDs
- **Disconnection handling** — automatic `gattserverdisconnected` events

## Architecture

```
Webpage JS  ←─postMessage─→  content-script.js  ←─runtime.sendMessage─→  background.js  ←─stdio─→  webbluetooth_host.py
```

- **`polyfill.js`** (MAIN world) — implements `navigator.bluetooth` on the page
- **`content-script.js`** (isolated world) — relays messages between page and background
- **`background.js`** — security hub: device authorization, service permission checks, picker management
- **`webbluetooth_host.py`** — Python native messaging host using `bleak` / BlueZ

See [CLAUDE.md](CLAUDE.md) for a full architecture reference.

## Troubleshooting

**"No devices found" / scan never returns results**
- Make sure your Bluetooth adapter is on: `bluetoothctl show`
- Add yourself to the `bluetooth` group:
  ```bash
  sudo usermod -aG bluetooth $USER
  ```
  Then log out and back in.

**"Native host is not connected" / constant reconnect loop in extension console**
- Re-run `install.sh` — it regenerates the NMH manifest and launcher with correct paths.
- For Flatpak or Snap Firefox, see [Sandboxed Firefox](#sandboxed-firefox-flatpak--snap) below.
- Check the manifest exists: `cat ~/.mozilla/native-messaging-hosts/webbluetooth_host.json`
  (Flatpak: `cat ~/.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts/webbluetooth_host.json`)
- Test the launcher directly:
  ```bash
  echo '{}' | ~/.local/share/webbluetooth-firefox/launcher.sh
  ```
  You should see log output, not a Python import error.

**"Bleak library not found" in native host log**
- Re-run `install.sh` to rebuild the venv.
- For Flatpak Firefox: make sure the sandbox overrides are set
  (see [Sandboxed Firefox](#sandboxed-firefox-flatpak--snap) below).

**Web Bluetooth not available at all**
- The API requires a **secure context** (HTTPS, `localhost`, or `moz-extension://`).

**After a Python version upgrade (e.g. 3.14 → 3.15), the host stops working**
- Re-run `install.sh` to rebuild the venv for the new Python version.

## Sandboxed Firefox (Flatpak & Snap)

**Flatpak** — the sandbox blocks BlueZ (D-Bus) and host process access. After running `install.sh`, grant:

```bash
flatpak override --user --filesystem=home org.mozilla.firefox                    # reach the venv + launcher
flatpak override --user --talk-name=org.freedesktop.Flatpak org.mozilla.firefox  # spawn the host outside the sandbox
flatpak override --user --system-talk-name=org.bluez org.mozilla.firefox         # BlueZ access
```

Verify with `flatpak override --user --show org.mozilla.firefox`, and make sure you're in the `bluetooth` group (see [Troubleshooting](#troubleshooting)). The overrides persist across Firefox updates.

> **Security note:** `--talk-name=org.freedesktop.Flatpak` lets Firefox run processes *outside* the sandbox — that is how native messaging hosts start, but it largely defeats the Flatpak sandbox. Only grant it if you accept the trade-off. `--filesystem=home` can likely be narrowed to `--filesystem=~/.local/share/webbluetooth-firefox:ro`; try the narrow form first and widen only if the host fails to start.

**Snap** (Ubuntu's default Firefox) — needs no overrides, but native messaging only works through the **xdg-desktop-portal WebExtensions backend** (Ubuntu 22.04+ / `xdg-desktop-portal` ≥ 1.15). `install.sh` writes the manifest to the standard `~/.mozilla/native-messaging-hosts/`; Firefox prompts for permission the first time the extension starts the host. If the portal is missing, the host will never connect even though the manifest exists.

## Building the .xpi locally

```bash
bash build-xpi.sh
```

Produces `webbluetooth-for-firefox-1.0.xpi`. Upload to [AMO](https://addons.mozilla.org/developers/addon/submit/) for signing.

## Credits

Based on the [web-bluetooth-polyfill](https://github.com/urish/web-bluetooth-polyfill) by Uri Shaked, extended with Linux BlueZ support, a graphical device picker, security hardening, and advertisement watching.
