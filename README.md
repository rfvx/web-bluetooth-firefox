# WebBT for Firefox (Linux & Windows)

This extension enables Web Bluetooth in Firefox. It provides a bridge between the browser and the system's Bluetooth adapter using a native messaging host.

## Architecture

This project consists of three main components:

1.  **Polyfill (`polyfill.js`):** Injected into webpages to provide the `navigator.bluetooth` API. It handles the Web Bluetooth logic and communicates with the extension.
2.  **WebExtension:** Acts as a relay between the polyfill and the native messaging host. It manages permissions and event routing.
3.  **Native Messaging Host:**
    *   **Linux:** A Python script (`webbluetooth_host.py`) using the `bleak` library to interact with BlueZ.
    *   **Windows:** A C++ executable (`BLEServer.exe`) using Windows Runtime APIs.

## Linux Installation

### 1. Prerequisites
Ensure you have Python 3 and the necessary Bluetooth libraries installed:
```bash
sudo apt install python3 python3-pip bluez libbluetooth-dev
pip3 install bleak
```

### 2. Register the Native Messaging Host
Firefox needs a manifest file to know how to launch the Python host.
```bash
# Create the directory if it doesn't exist
mkdir -p ~/.mozilla/native-messaging-hosts/

# Create a symlink to the host manifest
ln -s $(pwd)/webbluetooth_host.json ~/.mozilla/native-messaging-hosts/webbluetooth_host.json

# Ensure the host script is executable
chmod +x webbluetooth_host.py
```

### 3. Install the Extension
1.  Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2.  Click **Load Temporary Add-on...**.
3.  Select the `manifest.json` file inside the `webbluetooth-firefox-extension` directory.

## Features

- [x] **Graphical Device Picker:** A user-friendly modal to select Bluetooth devices.
- [x] **GATT Operations:** Support for `readValue`, `writeValueWithResponse`, and `writeValueWithoutResponse`.
- [x] **Notifications:** Real-time characteristic notifications (e.g., heart rate, Meshtastic data).
- [x] **Filtering:** Basic device filtering by Service UUID and name.
- [x] **Disconnection Handling:** Automatic detection and notification of device disconnections.

## Troubleshooting

1.  **"Web Bluetooth API is available" but no devices found:**
    *   Ensure your Bluetooth adapter is turned on and visible.
    *   Check if the Python host is running: `ps aux | grep webbluetooth_host.py`.
2.  **Permissions Error:**
    *   Ensure your user is in the `bluetooth` group (on some distros): `sudo usermod -aG bluetooth $USER` (relog required).
3.  **Native host not connected:**
    *   Verify the path in `webbluetooth_host.json` points correctly to your `webbluetooth_host.py` script.

## Credits

This project is based on the [Web Bluetooth Polyfill](https://github.com/urish/web-bluetooth-polyfill) and has been expanded to support Linux and modern Web Bluetooth applications like the Meshtastic client.
