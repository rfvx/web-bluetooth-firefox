# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

WebBluetooth for Firefox is a browser extension + native messaging host that implements the Web Bluetooth API (`navigator.bluetooth`) in Firefox on Linux. Chrome supports Web Bluetooth natively; Firefox does not, so this polyfill bridges the gap.

## Setup (Linux)

```bash
# Install Python dependency
pip install bleak

# Register native messaging host with Firefox
mkdir -p ~/.mozilla/native-messaging-hosts/
ln -s $(pwd)/webbluetooth_host.json ~/.mozilla/native-messaging-hosts/webbluetooth_host.json
chmod +x webbluetooth_host.py
```

Then load the extension in Firefox at `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select `webbluetooth-firefox-extension/manifest.json`.

Open `test_page.html` via `localhost` or `https://` (required for secure context) to exercise the API.

**Note:** `webbluetooth_host.json` contains an absolute path to `webbluetooth_host.py` and must be updated if the repo is moved.

## Architecture

The system has four layers communicating in a strict chain:

```
Webpage JS  <--postMessage-->  content-script.js  <--runtime.sendMessage-->  background.js  <--stdio-->  webbluetooth_host.py (Python/bleak)
```

### Layer 1 – `polyfill.js` (MAIN world, runs in webpage context)
Injects `navigator.bluetooth` onto the page. All Web Bluetooth API calls (`requestDevice`, `connect`, `readValue`, etc.) are handled here as classes (`BluetoothDevice`, `BluetoothRemoteGATTServer`, `BluetoothRemoteGATTService`, `BluetoothRemoteGATTCharacteristic`, `BluetoothRemoteGATTDescriptor`). Communicates outward via `window.postMessage` using `FROM_PAGE` messages with a unique `id` for request/response correlation.

### Layer 2 – `content-script.js` (ISOLATED world)
Pure relay: forwards `FROM_PAGE` messages to `background.js` via `browser.runtime.sendMessage`, and forwards `host_event` messages from background back to the page via `window.postMessage`. No logic here.

### Layer 3 – `background.js` (extension background)
The security and routing hub. Key responsibilities:
- **Device picker:** Opens `picker.html` as a popup window for `requestDevice()`. The picker connects back via `browser.runtime.connect` with a `picker-<id>` port name.
- **Authorization model:** Stores origin → obfuscated device ID → `{realAddress, name, services}` in `browser.storage.local`. Real MAC addresses are never exposed to webpage JS; only SHA-256-based obfuscated IDs are sent to pages.
- **Command whitelisting:** Only commands in `GATT_COMMANDS` are forwarded to the host. `scan_devices` is explicitly blocked at this layer.
- **Service authorization:** GATT operations that require a `service_uuid` are checked against the set of services approved when the device was paired.
- **Notification fan-out:** Tracks which tabs subscribed to which characteristic notifications and routes incoming `gatt_notification` events to only the matching tabs for that origin.
- **Native host connection:** Connects to `webbluetooth_host` via `browser.runtime.connectNative` with exponential-backoff reconnection.

### Layer 4 – `webbluetooth_host.py` (Python native messaging host)
Runs as a subprocess started by Firefox. Reads length-prefixed JSON from stdin, processes BLE commands using the `bleak` library (which talks to BlueZ on Linux), and writes length-prefixed JSON responses to stdout. Uses `asyncio` internally; GATT operations are serialized per-device using `asyncio.Lock`.

Key host behaviors:
- `watch_advertisements` / `stop_watch_advertisements` control a single `BleakScanner` instance with per-device throttling (100ms interval).
- Notification callbacks fire on bleak's thread and are dispatched to the asyncio loop via `call_soon_threadsafe`.
- Binary values are base64-encoded for JSON transport in both directions.

### `picker.html` / `picker.js` / `picker.css`
The device chooser UI opened as a popup. Connects to background via `browser.runtime.connect({ name: "picker-<requestId>" })`, receives `device_discovered` events as the scanner finds matching devices, and sends `select_device` or `cancel` back to background.

## UUID Normalization

UUIDs are normalized to 128-bit lowercase format (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) throughout. Both `background.js` (`normalizeUUID`) and `webbluetooth_host.py` (`normalize_uuid`) implement this independently — 16-bit and 32-bit short UUIDs are expanded using the Bluetooth base UUID `0000xxxx-0000-1000-8000-00805f9b34fb`. Keep these two implementations consistent.

## Security Model

- Webpages never receive real MAC addresses — only per-origin, per-device obfuscated IDs derived from `SHA-256(origin + address + salt)`.
- The background script enforces that each GATT operation uses a device ID previously authorized for that origin, and that the requested service UUID was in the filter/optionalServices list at pairing time.
- The host enforces a MAC address regex and a command whitelist independently of the extension.
- Web Bluetooth is only available in secure contexts (HTTPS, localhost, or `moz-extension://`).
