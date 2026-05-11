// webbluetooth-firefox-extension/polyfill.js

// --- Web Bluetooth Polyfill ---
// This script is injected into the webpage's context.

if (!navigator.bluetooth) {
    console.log("WebBluetooth API not found, injecting polyfill from webbluetooth-firefox-extension.");

    // Function to send messages from the polyfill to the background script (via page bridge)
    async function sendMessageFromPolyfill(command, args) {
        return new Promise((resolve, reject) => {
            // Generate a unique ID for this polyfill-originated message
            const polyfillMessageId = `polyfill-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

            // Listen for the response specific to this message
            const listener = (event) => {
                if (event.source === window && event.data && event.data.type === 'FROM_CONTENT_SCRIPT' && event.data.id === polyfillMessageId) {
                    window.removeEventListener('message', listener); // Clean up listener
                    if (event.data.error) {
                        reject(new Error(event.data.error));
                    } else {
                        resolve(event.data.response);
                    }
                }
            };
            window.addEventListener('message', listener);

            // Post the message to the content script via the page bridge
            window.postMessage({
                type: 'FROM_PAGE', // Use the same type as regular page messages
                id: polyfillMessageId,
                payload: { command: command, ...args } // Spread args into the payload
            }, '*');
        });
    }

    // --- Polyfill classes (simplified for initial implementation) ---

    // Define basic EventTarget for dispatching events
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
            const stack = [...this._listeners[event.type]]; // Copy to prevent issues if listeners modify the list
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
            this._connected = false; // Internal state for connection
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
            this._connected = false;
            this.dispatchEvent(new Event('gattserverdisconnected'));
        }

        // Placeholder for GATT services/characteristics/descriptors
        async getPrimaryService(service) {
            console.log(`Polyfill: getPrimaryService called for ${service}`);
            const serviceUuid = window.BluetoothUUID.getService(service);
            const response = await sendMessageFromPolyfill('get_primary_service', { address: this.device.address, service_uuid: serviceUuid });
            if (response.status === "success" && response.uuid) {
                 return new BluetoothRemoteGATTService(this.device, response.uuid, true);
            }
            throw new Error(`Service ${service} not found or error: ${response.message}`);
        }
        async getPrimaryServices(service) {
            console.log(`Polyfill: getPrimaryServices called for ${service}`);
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
            // Verify with host
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

    // Registry to keep track of active characteristics for notification dispatch
    const characteristicRegistry = new Map();

    class BluetoothRemoteGATTCharacteristic extends BluetoothEventTarget {
        constructor(service, uuid) {
            super();
            this.service = service;
            this.uuid = uuid;
            this.value = null;
            
            // Register this characteristic for notifications
            const registryKey = `${this.service.device.address}-${this.uuid}`;
            if (!characteristicRegistry.has(registryKey)) {
                characteristicRegistry.set(registryKey, []);
            }
            characteristicRegistry.get(registryKey).push(this);
        }

        async readValue() {
            console.log(`Polyfill: Reading characteristic ${this.uuid}`);
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
            // value can be ArrayBuffer, TypedArray, or DataView
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

            // Safe base64 conversion
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64Value = btoa(binary);

            console.log(`Polyfill: Writing characteristic ${this.uuid}`);
            const response = await sendMessageFromPolyfill('write_gatt_char', {
                address: this.service.device.address,
                service_uuid: this.service.uuid,
                char_uuid: this.uuid,
                value: base64Value
            });

            if (response.status !== "success") {
                throw new Error(`Failed to write characteristic: ${response.message}`);
            }
        }

        async startNotifications() {
            console.log(`Polyfill: Starting notifications for ${this.uuid}`);
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
            console.log(`Polyfill: Stopping notifications for ${this.uuid}`);
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
    }

    // Listen for notifications from the content script relay
    window.addEventListener('message', (event) => {
        if (event.source === window && event.data && event.data.type === 'FROM_CONTENT_SCRIPT' && event.data.event === 'gatt_notification') {
            const { address, char_uuid, value } = event.data.data;
            const registryKey = `${address}-${char_uuid}`;
            const characteristics = characteristicRegistry.get(registryKey);
            if (characteristics) {
                characteristics.forEach(char => char._updateValue(value));
            }
        }
    });

    class BluetoothDevice extends BluetoothEventTarget {
        constructor(address, name) {
            super();
            this.id = address; // Web Bluetooth ID is typically a UUID, but using address for now
            this.name = name;
            this.address = address; // Keep address for native host communication
            this.gatt = new BluetoothRemoteGATTServer(this);
        }

        // Placeholder for other BluetoothDevice methods
        async watchAdvertisements(options) {
            console.warn("Polyfill: watchAdvertisements not implemented.");
            // Example of how to send a command
            await sendMessageFromPolyfill('watch_advertisements', { address: this.address, options });
        }
        async forget() {
            console.warn("Polyfill: forget not implemented.");
            await sendMessageFromPolyfill('forget_device', { address: this.address });
        }
    }

    // --- Implement navigator.bluetooth ---
    navigator.bluetooth = {
        requestDevice: async function (options) {
            console.log("Polyfill: requestDevice called with options:", options);
            // In a real polyfill, this would display a chooser UI.
            // For now, we'll send a scan command and assume the first device if any.
            // This is a simplified implementation for direct testing purposes.
            const response = await sendMessageFromPolyfill('scan_devices', { options: options.filters }); // Pass filters for scanning
            if (response.status === "success" && response.devices && response.devices.length > 0) {
                // If there's a devices property, use it. Otherwise, assume a direct device response.
                const devicesToProcess = response.devices || [response]; // Handle both list and single device response
                
                // For simplicity, let's just return the first device found during scan
                // A real implementation would show a chooser UI
                const firstDevice = devicesToProcess[0];
                return new BluetoothDevice(firstDevice.address, firstDevice.name);
            } else {
                throw new Error(response.message || "No devices found or scan failed.");
            }
        },
        getAvailability: async function () {
            console.warn("Polyfill: getAvailability not fully implemented.");
            try {
                // Send a simple command to check if the native host is responsive
                const response = await sendMessageFromPolyfill('check_availability', {});
                return response.status === "success";
            } catch (error) {
                return false;
            }
        },
        getDevices: async function () {
            console.warn("Polyfill: getDevices not fully implemented.");
            const response = await sendMessageFromPolyfill('get_origin_devices', {});
            if (response.status === "success" && response.devices) {
                return response.devices.map(d => new BluetoothDevice(d.address, d.name));
            }
            return [];
        }
    };

    // --- BluetoothUUID utility (copied from webbt/extension/polyfill.js) ---
    function handleUnnamedUUID(alias, result) {
        if (result) {
            return BluetoothUUID.canonicalUUID(result);
        }
        try {
            return BluetoothUUID.canonicalUUID(alias);
        /* eslint-disable-next-line no-empty*/
        } catch {}
        if (typeof alias === 'string' && alias.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
            return alias.toLowerCase();
        }
        throw new TypeError('Not a valid name, short UUID, or full UUID');
    }

    // Placeholder for actual GATT UUID maps - these would typically come from gatt-services.js, etc.
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
