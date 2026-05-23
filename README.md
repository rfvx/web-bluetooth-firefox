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
- On some distros, add yourself to the `bluetooth` group:
  ```bash
  sudo usermod -aG bluetooth $USER
  ```
  Then log out and back in.

**"Native host is not connected"**
- Re-run `install.sh` — it regenerates the NMH manifest with the correct path.
- Check the manifest was written: `cat ~/.mozilla/native-messaging-hosts/webbluetooth_host.json`

**Web Bluetooth not available at all**
- The API requires a **secure context** (HTTPS, `localhost`, or `moz-extension://`).

## Building the .xpi locally

```bash
bash build-xpi.sh
```

Produces `webbluetooth-for-firefox-1.0.xpi`. Upload to [AMO](https://addons.mozilla.org/developers/addon/submit/) for signing.

## Credits

Based on the [web-bluetooth-polyfill](https://github.com/urish/web-bluetooth-polyfill) by Uri Shaked, extended with Linux BlueZ support, a graphical device picker, security hardening, and advertisement watching.
