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

## Firefox Flatpak

If you installed Firefox via Flatpak, three extra steps are required after running `install.sh`. The Flatpak sandbox restricts access to D-Bus (needed for BlueZ) and to host processes. These overrides persist across Firefox updates.

**1. Grant the required sandbox permissions:**

```bash
# Access to your home directory (so the venv and host script are reachable)
flatpak override --user --filesystem=home org.mozilla.firefox

# Allow spawning processes on the host (needed to run the Python native host outside the sandbox)
flatpak override --user --talk-name=org.freedesktop.Flatpak org.mozilla.firefox

# BlueZ access via D-Bus
flatpak override --user --system-talk-name=org.bluez org.mozilla.firefox
```

> **Security note:** `--talk-name=org.freedesktop.Flatpak` lets Firefox launch
> processes *outside* the sandbox (this is how Firefox starts native messaging
> hosts), which largely defeats the Flatpak sandbox for this app. Only grant it
> if you accept that trade-off. `--filesystem=home` can likely be narrowed to
> `--filesystem=~/.local/share/webbluetooth-firefox:ro` — try the narrow form
> first and widen only if the host fails to start.

**2. Add yourself to the `bluetooth` group** (if not already) — see
[Troubleshooting](#troubleshooting) below for the command.

**3. Verify the overrides are active:**

```bash
flatpak override --user --show org.mozilla.firefox
```

You should see `filesystem=home`, `talk-name=org.freedesktop.Flatpak`, and `system-talk-name=org.bluez` in the output.

> **Note:** If you also need Web Serial support, you may additionally need:
> ```bash
> flatpak override --user --device=all org.mozilla.firefox
> flatpak override --user --filesystem=/dev/ttyACM0 org.mozilla.firefox
> ```

## Firefox Snap

Snap-confined Firefox (Ubuntu's default) reads the standard
`~/.mozilla/native-messaging-hosts/` manifest, but only through the
**xdg-desktop-portal WebExtensions backend** (available on Ubuntu 22.04+ /
`xdg-desktop-portal` ≥ 1.15). `install.sh` writes the manifest there; if the
portal is missing on your system, the native host will never connect even
though the manifest exists. Firefox will prompt for permission the first time
the extension starts the host.

---

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
- For Flatpak Firefox, follow the [Firefox Flatpak](#firefox-flatpak) section above.
- Check the manifest exists: `cat ~/.mozilla/native-messaging-hosts/webbluetooth_host.json`
  (Flatpak: `cat ~/.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts/webbluetooth_host.json`)
- Test the launcher directly:
  ```bash
  echo '{}' | ~/.local/share/webbluetooth-firefox/launcher.sh
  ```
  You should see log output, not a Python import error.

**`SyntaxError: name 'advertisement_scanner' is used prior to global declaration`**
- This occurs on Python 3.14+ due to duplicate `global` declarations in `webbluetooth_host.py`.
  Fixed in this repo. If you see it, re-clone or pull the latest version.

**"Bleak library not found" in native host log**
- Re-run `install.sh` to rebuild the venv.
- For Flatpak Firefox: make sure `--filesystem=home` and `--talk-name=org.freedesktop.Flatpak`
  overrides are set (see [Firefox Flatpak](#firefox-flatpak) above).

**Web Bluetooth not available at all**
- The API requires a **secure context** (HTTPS, `localhost`, or `moz-extension://`).

**After a Python version upgrade (e.g. 3.14 → 3.15), the host stops working**
- Re-run `install.sh` to rebuild the venv for the new Python version.

## Building the .xpi locally

```bash
bash build-xpi.sh
```

Produces `webbluetooth-for-firefox-1.0.xpi`. Upload to [AMO](https://addons.mozilla.org/developers/addon/submit/) for signing.

## Credits

Based on the [web-bluetooth-polyfill](https://github.com/urish/web-bluetooth-polyfill) by Uri Shaked, extended with Linux BlueZ support, a graphical device picker, security hardening, and advertisement watching.
