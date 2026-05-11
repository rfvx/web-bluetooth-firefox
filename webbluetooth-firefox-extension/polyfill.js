// webbluetooth-firefox-extension/polyfill.js

// --- Web Bluetooth Polyfill ---
// This script is injected into the webpage's context.

if (!navigator.bluetooth) {
    console.log("WebBluetooth API not found, injecting polyfill from webbluetooth-firefox-extension.");

    // Function to send messages from the polyfill to the background script (via page bridge)
    async function sendMessageFromPolyfill(command, args) {
        return new Promise((resolve, reject) => {
            const polyfillMessageId = `polyfill-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

            const listener = (event) => {
                if (event.source === window && event.data && event.data.type === 'FROM_CONTENT_SCRIPT' && event.data.id === polyfillMessageId) {
                    window.removeEventListener('message', listener);
                    if (event.data.error) {
                        reject(new Error(event.data.error));
                    } else {
                        resolve(event.data.response);
                    }
                }
            };
            window.addEventListener('message', listener);

            window.postMessage({
                type: 'FROM_PAGE',
                id: polyfillMessageId,
                payload: { command: command, ...args }
            }, '*');
        });
    }

    class BluetoothEventTarget {
        constructor() {
            this._listeners = {};
        }
        addEventListener(type, callback) {
            if (!(type in this._listeners)) {
                this._listeners[type] = [];
            }
            this._listeners[type].push(callback);
        }
        removeEventListener(type, callback) {
            if (!(type in this._listeners)) {
                return;
            }
            const stack = this._listeners[type];
            for (let i = 0, l = stack.length; i < l; i++) {
                if (stack[i] === callback) {
                    stack.splice(i, 1);
                    return;
                }
            }
        }
        dispatchEvent(event) {
            event.target = this;
            if (!(event.type in this._listeners)) {
                return true;
            }
            const stack = [...this._listeners[event.type]];
            for (let i = 0, l = stack.length; i < l; i++) {
                stack[i].call(this, event);
            }
            return !event.defaultPrevented;
        }
    }

    class BluetoothRemoteGATTServer extends BluetoothEventTarget {
        constructor(device) {
            super();
            this.device = device;
            this._connected = false;
        }

        get connected() {
            return this._connected;
        }

        async connect() {
            console.log(`Polyfill: Attempting to connect to ${this.device.address}`);
            const response = await sendMessageFromPolyfill('connect_device', { address: this.device.address });
            if (response.status === "success") {
                this._connected = true;
                return this;
            } else {
                this._connected = false;
                throw new Error(`Failed to connect: ${response.message}`);
            }
        }

        async disconnect() {
            console.log(`Polyfill: Disconnecting from ${this.device.address}`);
            await sendMessageFromPolyfill('disconnect_device', { address: this.device.address });
            this._onDisconnected();
        }

        _onDisconnected() {
            if (this._connected) {
                this._connected = false;
                this.device.dispatchEvent(new Event('gattserverdisconnected'));
            }
        }

        async getPrimaryService(service) {
            const serviceUuid = window.BluetoothUUID.getService(service);
            const response = await sendMessageFromPolyfill('get_primary_service', { address: this.device.address, service_uuid: serviceUuid });
            if (response.status === "success" && response.uuid) {
                 return new BluetoothRemoteGATTService(this.device, response.uuid, true);
            }
            throw new Error(`Service ${service} not found or error: ${response.message}`);
        }

        async getPrimaryServices(service) {
            const serviceUuid = service ? window.BluetoothUUID.getService(service) : null;
            const response = await sendMessageFromPolyfill('get_primary_services', { address: this.device.address, service_uuid: serviceUuid });
            if (response.status === "success" && response.uuids) {
                return response.uuids.map(uuid => new BluetoothRemoteGATTService(this.device, uuid, true));
            }
            return [];
        }
    }

    class BluetoothRemoteGATTService extends BluetoothEventTarget {
        constructor(device, uuid, isPrimary) {
            super();
            this.device = device;
            this.uuid = uuid;
            this.isPrimary = isPrimary;
        }

        async getCharacteristic(characteristic) {
            const charUuid = window.BluetoothUUID.getCharacteristic(characteristic);
            const response = await sendMessageFromPolyfill('get_characteristics', {
                address: this.device.address,
                service_uuid: this.uuid
            });
            if (response.status === "success" && response.uuids.includes(charUuid)) {
                return new BluetoothRemoteGATTCharacteristic(this, charUuid);
            }
            throw new Error(`Characteristic ${characteristic} not found in service ${this.uuid}`);
        }

        async getCharacteristics(characteristic) {
            const response = await sendMessageFromPolyfill('get_characteristics', {
                address: this.device.address,
                service_uuid: this.uuid
            });
            if (response.status === "success" && response.uuids) {
                let uuids = response.uuids;
                if (characteristic) {
                    const filterUuid = window.BluetoothUUID.getCharacteristic(characteristic);
                    uuids = uuids.filter(u => u === filterUuid);
                }
                return uuids.map(uuid => new BluetoothRemoteGATTCharacteristic(this, uuid));
            }
            return [];
        }
    }

    const characteristicRegistry = new Map();

    class BluetoothRemoteGATTCharacteristic extends BluetoothEventTarget {
        constructor(service, uuid) {
            super();
            this.service = service;
            this.uuid = uuid;
            this.value = null;
            
            const registryKey = `${this.service.device.address}-${this.uuid}`;
            if (!characteristicRegistry.has(registryKey)) {
                characteristicRegistry.set(registryKey, []);
            }
            characteristicRegistry.get(registryKey).push(this);
        }

        async readValue() {
            const response = await sendMessageFromPolyfill('read_gatt_char', {
                address: this.service.device.address,
                service_uuid: this.service.uuid,
                char_uuid: this.uuid
            });
            if (response.status === "success") {
                this._updateValue(response.value);
                return this.value;
            } else {
                throw new Error(`Failed to read characteristic: ${response.message}`);
            }
        }

        _updateValue(base64Value) {
            const binaryString = atob(base64Value);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            this.value = new DataView(bytes.buffer);
            this.dispatchEvent(new Event('characteristicvaluechanged'));
        }

        async writeValue(value) {
             return this.writeValueWithResponse(value);
        }

        async writeValueWithResponse(value) {
            return this._write(value, true);
        }

        async writeValueWithoutResponse(value) {
            return this._write(value, false);
        }

        async _write(value, response) {
            let bytes;
            if (value instanceof DataView) {
                bytes = new Uint8Array(value.buffer);
            } else if (value.buffer instanceof ArrayBuffer) {
                bytes = new Uint8Array(value.buffer);
            } else if (value instanceof Uint8Array) {
                bytes = value;
            } else {
                bytes = new Uint8Array(value);
            }

            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64Value = btoa(binary);

            const res = await sendMessageFromPolyfill('write_gatt_char', {
                address: this.service.device.address,
                service_uuid: this.service.uuid,
                char_uuid: this.uuid,
                value: base64Value,
                response: response
            });

            if (res.status !== "success") {
                throw new Error(`Failed to write characteristic: ${res.message}`);
            }
        }

        async startNotifications() {
            const response = await sendMessageFromPolyfill('start_notify', {
                address: this.service.device.address,
                service_uuid: this.service.uuid,
                char_uuid: this.uuid
            });
            if (response.status !== "success") {
                throw new Error(`Failed to start notifications: ${response.message}`);
            }
            return this;
        }

        async stopNotifications() {
            const response = await sendMessageFromPolyfill('stop_notify', {
                address: this.service.device.address,
                service_uuid: this.service.uuid,
                char_uuid: this.uuid
            });
            if (response.status !== "success") {
                throw new Error(`Failed to stop notifications: ${response.message}`);
            }
            return this;
        }

        async getDescriptor(descriptor) {
            console.warn("Polyfill: getDescriptor not implemented.");
            throw new Error("getDescriptor not implemented");
        }

        async getDescriptors(descriptor) {
            console.warn("Polyfill: getDescriptors not implemented.");
            return [];
        }
    }

    const deviceRegistry = new Map();

    window.addEventListener('message', (event) => {
        if (event.source === window && event.data && event.data.type === 'FROM_CONTENT_SCRIPT') {
            if (event.data.event === 'gatt_notification') {
                const { address, char_uuid, value } = event.data.data;
                const registryKey = `${address}-${char_uuid}`;
                const characteristics = characteristicRegistry.get(registryKey);
                if (characteristics) {
                    characteristics.forEach(char => char._updateValue(value));
                }
            } else if (event.data.event === 'device_disconnected') {
                const { address } = event.data;
                const device = deviceRegistry.get(address);
                if (device && device.gatt) {
                    device.gatt._onDisconnected();
                }
            }
        }
    });

    class BluetoothDevice extends BluetoothEventTarget {
        constructor(address, name) {
            super();
            this.id = address;
            this.name = name;
            this.address = address;
            this.gatt = new BluetoothRemoteGATTServer(this);
            deviceRegistry.set(address, this);
        }

        async watchAdvertisements(options) {
            console.warn("Polyfill: watchAdvertisements not implemented.");
        }
        async forget() {
            console.warn("Polyfill: forget not implemented.");
        }
    }

    // --- Device Picker UI ---
    class DevicePicker {
        constructor() {
            this.overlay = null;
            this.container = null;
            this.deviceList = null;
            this.selectedDevice = null;
            this.resolve = null;
            this.reject = null;
        }

        _setupStyles() {
            if (document.getElementById('webbluetooth-polyfill-styles')) return;
            const style = document.createElement('style');
            style.id = 'webbluetooth-polyfill-styles';
            style.textContent = `
                #webbluetooth-picker-overlay {
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                    background: rgba(0,0,0,0.5); z-index: 1000000;
                    display: flex; align-items: center; justify-content: center;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }
                #webbluetooth-picker-container {
                    background: white; padding: 20px; border-radius: 8px;
                    width: 400px; max-width: 90%; max-height: 80%;
                    display: flex; flex-direction: column; box-shadow: 0 4px 15px rgba(0,0,0,0.2);
                }
                #webbluetooth-picker-header { margin: 0 0 15px 0; font-size: 1.2em; font-weight: bold; }
                #webbluetooth-picker-list {
                    border: 1px solid #ddd; border-radius: 4px;
                    overflow-y: auto; flex-grow: 1; margin-bottom: 15px;
                    min-height: 150px;
                }
                .webbluetooth-device-item {
                    padding: 10px; cursor: pointer; border-bottom: 1px solid #eee;
                }
                .webbluetooth-device-item:last-child { border-bottom: none; }
                .webbluetooth-device-item:hover { background: #f5f5f5; }
                .webbluetooth-device-item.selected { background: #e3f2fd; font-weight: bold; }
                #webbluetooth-picker-footer { display: flex; justify-content: flex-end; gap: 10px; }
                .webbluetooth-btn {
                    padding: 8px 16px; border-radius: 4px; border: none; cursor: pointer; font-size: 14px;
                }
                #webbluetooth-btn-cancel { background: #f0f0f0; }
                #webbluetooth-btn-pair { background: #007bff; color: white; }
                #webbluetooth-btn-pair:disabled { background: #ccc; cursor: not-allowed; }
            `;
            (document.head || document.documentElement).appendChild(style);
        }

        show(devices) {
            this._setupStyles();
            return new Promise((resolve, reject) => {
                this.resolve = resolve;
                this.reject = reject;
                this.selectedDevice = null;

                this.overlay = document.createElement('div');
                this.overlay.id = 'webbluetooth-picker-overlay';
                
                this.container = document.createElement('div');
                this.container.id = 'webbluetooth-picker-container';
                
                this.container.innerHTML = `
                    <div id="webbluetooth-picker-header">Select a device</div>
                    <div id="webbluetooth-picker-list"></div>
                    <div id="webbluetooth-picker-footer">
                        <button id="webbluetooth-btn-cancel" class="webbluetooth-btn">Cancel</button>
                        <button id="webbluetooth-btn-pair" class="webbluetooth-btn" disabled>Pair</button>
                    </div>
                `;

                this.overlay.appendChild(this.container);
                document.body.appendChild(this.overlay);

                this.deviceList = this.container.querySelector('#webbluetooth-picker-list');
                const pairBtn = this.container.querySelector('#webbluetooth-btn-pair');
                const cancelBtn = this.container.querySelector('#webbluetooth-btn-cancel');

                if (devices.length === 0) {
                    this.deviceList.innerHTML = '<div style="padding: 20px; color: #666; text-align: center;">No devices found.</div>';
                } else {
                    devices.forEach(device => {
                        const item = document.createElement('div');
                        item.className = 'webbluetooth-device-item';
                        item.textContent = `${device.name} (${device.address})`;
                        item.onclick = () => {
                            this.container.querySelectorAll('.webbluetooth-device-item').forEach(el => el.classList.remove('selected'));
                            item.classList.add('selected');
                            this.selectedDevice = device;
                            pairBtn.disabled = false;
                        };
                        this.deviceList.appendChild(item);
                    });
                }

                pairBtn.onclick = () => {
                    this.close();
                    this.resolve(this.selectedDevice);
                };

                cancelBtn.onclick = () => {
                    this.close();
                    this.reject(new Error('User cancelled the device picker.'));
                };
            });
        }

        close() {
            if (this.overlay) {
                document.body.removeChild(this.overlay);
                this.overlay = null;
            }
        }
    }

    const picker = new DevicePicker();

    const bluetoothPolyfill = {
        requestDevice: async function (options) {
            console.log("Polyfill: requestDevice called with options:", options);
            
            const scanningOverlay = document.createElement('div');
            scanningOverlay.innerHTML = '<div style="position: fixed; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 10px; border-radius: 5px; z-index: 1000001;">Scanning for Bluetooth devices...</div>';
            document.body.appendChild(scanningOverlay);

            try {
                const response = await sendMessageFromPolyfill('scan_devices', { options: options });
                document.body.removeChild(scanningOverlay);

                if (response.status === "success" && response.devices) {
                    let devices = response.devices;
                    console.log(`Polyfill: Received ${devices.length} devices from host.`);
                    
                    // Basic filtering
                    if (options && !options.acceptAllDevices && options.filters) {
                        devices = devices.filter(device => {
                            const match = options.filters.some(filter => {
                                // Filter by Services
                                if (filter.services) {
                                    const hasAllServices = filter.services.every(service => {
                                        const filterUuid = window.BluetoothUUID.getService(service).toLowerCase();
                                        const deviceUuids = (device.uuids || []).map(u => u.toLowerCase());
                                        const found = deviceUuids.includes(filterUuid);
                                        if (!found) {
                                             console.debug(`Polyfill: Device ${device.name} (${device.address}) missing required service ${filterUuid}`);
                                        }
                                        return found;
                                    });
                                    if (hasAllServices) return true;
                                }
                                
                                // Filter by Name
                                if (filter.name && device.name === filter.name) return true;
                                
                                // Filter by Name Prefix
                                if (filter.namePrefix && device.name && device.name.startsWith(filter.namePrefix)) return true;
                                
                                return false;
                            });
                            return match;
                        });
                        console.log(`Polyfill: ${devices.length} devices remaining after filtering.`);
                    } else if (options && options.acceptAllDevices) {
                        console.log("Polyfill: acceptAllDevices is true, showing all devices.");
                    }

                    // Show the picker UI
                    const selected = await picker.show(devices);
                    return new BluetoothDevice(selected.address, selected.name);
                } else {
                    throw new Error(response.message || "Scan failed.");
                }
            } catch (error) {
                if (scanningOverlay.parentNode) document.body.removeChild(scanningOverlay);
                console.error("Polyfill: requestDevice error:", error);
                throw error;
            }
        },
        getAvailability: async function () {
            try {
                const response = await sendMessageFromPolyfill('check_availability', {});
                return response.status === "success" && response.available;
            } catch (error) {
                return false;
            }
        },
        getDevices: async function () {
            return [];
        },
        addEventListener: function(type, listener) {
            console.warn(`Polyfill: navigator.bluetooth.addEventListener('${type}') not fully supported.`);
        }
    };

    try {
        Object.defineProperty(navigator, 'bluetooth', {
            value: bluetoothPolyfill,
            configurable: true,
            enumerable: true,
            writable: true
        });
        console.log("Polyfill: Successfully defined navigator.bluetooth");
    } catch (e) {
        console.error("Polyfill: Failed to define navigator.bluetooth using Object.defineProperty", e);
        // Fallback to simple assignment
        navigator.bluetooth = bluetoothPolyfill;
    }

    function handleUnnamedUUID(alias, result) {
        if (result) {
            return BluetoothUUID.canonicalUUID(result);
        }
        try {
            return BluetoothUUID.canonicalUUID(alias);
        } catch {}
        if (typeof alias === 'string' && alias.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
            return alias.toLowerCase();
        }
        throw new TypeError('Not a valid name, short UUID, or full UUID');
    }

    const STANDARD_GATT_SERVICES = {
        'heart_rate': '0000180d-0000-1000-8000-00805f9b34fb',
        'battery_service': '0000180f-0000-1000-8000-00805f9b34fb',
        'device_information': '0000180a-0000-1000-8000-00805f9b34fb',
        'generic_access': '00001800-0000-1000-8000-00805f9b34fb',
        'generic_attribute': '00001801-0000-1000-8000-00805f9b34fb'
    };
    const STANDARD_GATT_CHARACTERISTICS = {
        'heart_rate_measurement': '00002a37-0000-1000-8000-00805f9b34fb',
        'battery_level': '00002a19-0000-1000-8000-00805f9b34fb',
        'manufacturer_name_string': '00002a29-0000-1000-8000-00805f9b34fb',
        'model_number_string': '00002a24-0000-1000-8000-00805f9b34fb',
        'serial_number_string': '00002a25-0000-1000-8000-00805f9b34fb',
        'hardware_revision_string': '00002a27-0000-1000-8000-00805f9b34fb',
        'firmware_revision_string': '00002a26-0000-1000-8000-00805f9b34fb',
        'software_revision_string': '00002a28-0000-1000-8000-00805f9b34fb',
        'device_name': '00002a00-0000-1000-8000-00805f9b34fb',
        'appearance': '00002a01-0000-1000-8000-00805f9b34fb'
    };
    const STANDARD_GATT_DESCRIPTORS = {
        'gatt.client_characteristic_configuration': '00002902-0000-1000-8000-00805f9b34fb'
    };

    window.BluetoothUUID = {
        canonicalUUID: function (alias) {
            if (typeof alias === 'string' && alias.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
                return alias.toLowerCase();
            }
            let aliasint = Number(alias);
            if (isNaN(aliasint)) {
                throw new TypeError('Not a valid number or UUID string');
            }
            if (aliasint > 0xFFFFFFFF) {
                throw new TypeError('Value is too large');
            }
            let result = aliasint.toString(16).padStart(8, '0') + '-0000-1000-8000-00805f9b34fb';
            return result;
        },
        getService: function (alias) {
            return handleUnnamedUUID(alias, STANDARD_GATT_SERVICES[alias] || null);
        },
        getCharacteristic: function (alias) {
            return handleUnnamedUUID(alias, STANDARD_GATT_CHARACTERISTICS[alias] || null);
        },
        getDescriptor: function (alias) {
            return handleUnnamedUUID(alias, STANDARD_GATT_DESCRIPTORS[alias] || null);
        },
    };

} else {
    console.log("WebBluetooth API already available, no polyfill injected by webbluetooth-firefox-extension.");
}
