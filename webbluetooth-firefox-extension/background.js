// background.js

let port = null;
let pendingWebRequests = new Map(); // webRequestId -> { resolve, reject, options, origin, tabId, pickerWindowId }
let pendingPickers = new Map(); // pickerId -> { webRequestId, port }
let currentRequestId = 0;

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10; // Max number of reconnect attempts
const BASE_RECONNECT_DELAY_MS = 1000; // 1 second base delay
const MAX_RECONNECT_DELAY_MS = 30000; // Max 30 seconds delay

// Memory cache of authorized devices:
// origin -> { obfuscatedId -> { address, name, services: Set(service_uuids) } }
let authorizedDevices = new Map();
let deviceSalt = null;
let initPromise = null;

// Track active connections per tab to clean them up:
// tabId -> Set of real addresses
let tabConnections = new Map();

// Track which tabs belong to which origin for fast lookup
// origin -> Set(tabId)
let originToTabs = new Map();

function getSubKey(serviceUuid, charUuid) {
    return `${normalizeUUID(serviceUuid)}|${normalizeUUID(charUuid)}`;
}

// Track which tabs have subscribed to notifications for specific characteristics:
// realAddress -> { "service_uuid|char_uuid" -> Set(tabId) }
let notificationSubscriptions = new Map();

// Reverse mapping for fast lookup during notifications:
// realAddress -> Map(origin -> obfuscatedId)
let addressToObfuscatedId = new Map();

function updateAddressMapping() {
    addressToObfuscatedId.clear();
    for (const [origin, originMap] of authorizedDevices.entries()) {
        for (const [obfuscatedId, devInfo] of originMap.entries()) {
            if (!addressToObfuscatedId.has(devInfo.address)) {
                addressToObfuscatedId.set(devInfo.address, new Map());
            }
            addressToObfuscatedId.get(devInfo.address).set(origin, obfuscatedId);
        }
    }
}

// Track tab origins for efficient event routing
let tabIdToOrigin = new Map();

function updateTabMapping(tabId, url) {
    try {
        const origin = new URL(url).origin;
        // Remove from old origin sets
        const oldOrigin = tabIdToOrigin.get(tabId);
        if (oldOrigin && originToTabs.has(oldOrigin)) {
            originToTabs.get(oldOrigin).delete(tabId);
        }
        
        if (!originToTabs.has(origin)) originToTabs.set(origin, new Set());
        originToTabs.get(origin).add(tabId);
        tabIdToOrigin.set(tabId, origin);
    } catch (e) {}
}

browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
        if (tab.url) updateTabMapping(tab.id, tab.url);
    });
});

function normalizeUUID(alias) {
    if (!alias) return null;
    let s = (typeof alias === 'number' ? alias.toString(16) : alias.toString()).toLowerCase();
    // Remove '0x' prefix if present
    if (s.startsWith('0x')) {
        s = s.substring(2);
    }
    
    // Pad to standard 128-bit format
    if (s.length === 4) { // 16-bit
        return `0000${s}-0000-1000-8000-00805f9b34fb`;
    } else if (s.length === 8) { // 32-bit
        return `${s}-0000-1000-8000-00805f9b34fb`;
    } else if (s.length === 32) { // Already 128-bit like, just reformat with hyphens
        return `${s.substring(0, 8)}-${s.substring(8, 12)}-${s.substring(12, 16)}-${s.substring(16, 20)}-${s.substring(20)}`;
    }
    // If it doesn't match a standard length, return as is or null depending on desired strictness
    // For now, return original string if not standard to avoid breaking unexpected cases.
    return s;
}

// SHA-256 for secure stable obfuscation
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Map native errors to DOMExceptions for spec compliance
function mapToDOMException(message) {
    message = message || "";
    if (message.includes("not found")) return new DOMException(message, "NotFoundError");
    if (message.includes("SecurityError") || message.includes("not authorized")) return new DOMException(message, "SecurityError");
    if (message.includes("timed out")) return new DOMException(message, "NetworkError");
    if (message.includes("Not connected")) return new DOMException(message, "NetworkError");
    return new Error(message);
}

// Initialize salt and load authorized devices
async function initStorage() {
    if (initPromise) return initPromise;
    
    initPromise = (async () => {
        try {
            const result = await browser.storage.local.get(['deviceSalt', 'authorizedDevices']);
            
            if (result.deviceSalt) {
                deviceSalt = result.deviceSalt;
            } else {
                deviceSalt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                    .map(b => b.toString(16).padStart(2, '0')).join('');
                await browser.storage.local.set({ deviceSalt });
            }

            if (result.authorizedDevices) {
                // Load into Map
                for (const [origin, devices] of Object.entries(result.authorizedDevices)) {
                    const originMap = new Map();
                    for (const [obfuscatedId, devInfo] of Object.entries(devices)) {
                        originMap.set(obfuscatedId, {
                            address: devInfo.address,
                            name: devInfo.name,
                            services: new Set(devInfo.services)
                        });
                    }
                    authorizedDevices.set(origin, originMap);
                }
                updateAddressMapping();
                console.log("Loaded authorized devices for origins:", Array.from(authorizedDevices.keys()));
            }
        } catch (e) {
            console.error("Failed to initialize storage:", e);
            if (!deviceSalt) {
                deviceSalt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                    .map(b => b.toString(16).padStart(2, '0')).join('');
                console.warn("Using ephemeral session salt due to storage error; paired devices won't persist.");
            }
            initPromise = null;
        }
    })();
    
    return initPromise;
}

// Flatten the in-memory Map-of-Maps into the plain object shape kept in storage.
function serializeAuthorizedDevices() {
    const obj = {};
    for (const [origin, originMap] of authorizedDevices.entries()) {
        obj[origin] = {};
        for (const [obfuscatedId, devInfo] of originMap.entries()) {
            obj[origin][obfuscatedId] = {
                address: devInfo.address,
                name: devInfo.name,
                services: Array.from(devInfo.services)
            };
        }
    }
    return obj;
}

// Deep-clone the in-memory state so a mutation can be rolled back if the
// subsequent storage write fails (keeps memory consistent with persisted state).
function cloneAuthorizedDevices(src) {
    const copy = new Map();
    for (const [origin, originMap] of src.entries()) {
        const m = new Map();
        for (const [obfuscatedId, devInfo] of originMap.entries()) {
            m.set(obfuscatedId, {
                address: devInfo.address,
                name: devInfo.name,
                services: new Set(devInfo.services)
            });
        }
        copy.set(origin, m);
    }
    return copy;
}

// Persist current state; throws if the storage write fails so callers can react.
async function persistAuthorizedDevices() {
    await browser.storage.local.set({ authorizedDevices: serializeAuthorizedDevices() });
    updateAddressMapping();
}

// Apply an in-memory grant mutation and persist it atomically. Snapshots first so
// the live Map is rolled back if the storage write fails, keeping memory and disk
// consistent. mutateFn mutates authorizedDevices and returns the MAC addresses to
// disconnect; callers apply those irreversible side effects only when ok === true.
async function mutateAndPersist(mutateFn) {
    const snapshot = cloneAuthorizedDevices(authorizedDevices);
    const disconnects = mutateFn() || [];
    try {
        await persistAuthorizedDevices();
        return { ok: true, disconnects };
    } catch (e) {
        authorizedDevices = snapshot; // roll back so memory matches what's on disk
        console.error("Failed to persist grant change; rolled back:", e);
        return { ok: false, disconnects: [] };
    }
}

// Disconnect devices at the host and drop them from per-tab connection tracking.
function dispatchDisconnects(addresses) {
    for (const addr of addresses) {
        if (port) port.postMessage({ command: "disconnect_device", address: addr });
        for (const addrs of tabConnections.values()) addrs.delete(addr);
    }
}

async function getObfuscatedId(origin, address) {
    await initStorage();
    const hash = await sha256(`${origin}-${address}-${deviceSalt}`);
    // Use more bits of the hash for better collision resistance (128 bits / 32 hex chars)
    return `device-${hash.substring(0, 32)}`;
}

// Connect to the native python host
function connectNativeHost() {
    const HOST_NAME = 'webbluetooth_host';
    try {
        port = browser.runtime.connectNative(HOST_NAME);
        reconnectAttempts = 0; // Reset attempts on successful connection
        console.log("Connected to native host.");
    } catch (e) {
        console.error("Failed to connect to native host:", e);
        scheduleReconnect();
        return;
    }

    port.onMessage.addListener((response) => {
        console.log("Received from host:", response);
        
        if (response.requestId && pendingWebRequests.has(response.requestId)) {
            const { resolve, reject } = pendingWebRequests.get(response.requestId);
            pendingWebRequests.delete(response.requestId);
            
            if (response.status === "error") {
                reject(mapToDOMException(response.message));
            } else {
                resolve(response);
            }
        } else if (response.event) {
            handleHostEvent(response);
        } else if (response.status === "error") {
            console.error("Host error:", response.message);
        }
    });

    port.onDisconnect.addListener(() => {
        console.log("Disconnected from native host. Reason:", port.error);
        for (const [reqId, { reject }] of pendingWebRequests) {
            if (reject) reject(new Error("Native host disconnected."));
        }
        pendingWebRequests.clear();
        notificationSubscriptions.clear();
        isScanning = false;

        // Notify each tab that had an active GATT connection so the polyfill
        // can update device.gatt.connected and fire gattserverdisconnected.
        for (const [tabId, addrs] of tabConnections.entries()) {
            for (const address of addrs) {
                const originMappings = addressToObfuscatedId.get(address);
                if (!originMappings) continue;
                const origin = tabIdToOrigin.get(tabId);
                if (!origin) continue;
                const obfuscatedId = originMappings.get(origin);
                if (!obfuscatedId) continue;
                browser.tabs.sendMessage(tabId, {
                    type: "host_event",
                    event: "device_disconnected",
                    data: { address: obfuscatedId }
                }).catch(() => {});
            }
        }
        tabConnections.clear();

        port = null;
        scheduleReconnect();
    });

    // Restore scanning state now that both listeners are registered
    updateScanningState();
}

function scheduleReconnect() {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(
            BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
            MAX_RECONNECT_DELAY_MS
        );
        reconnectAttempts++;
        console.log(`Attempting to reconnect to native host in ${delay / 1000} seconds (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        setTimeout(connectNativeHost, delay);
    } else {
        console.error("Max native host reconnection attempts reached. Giving up.");
    }
}

// Broadcast notifications to subscribing tabs
function handleHostEvent(event) {
    if (event.event === "gatt_notification") {
        const charSubs = notificationSubscriptions.get(event.address);
        if (!charSubs) return;
        
        const subKey = getSubKey(event.service_uuid, event.char_uuid);
        const tabIds = charSubs.get(subKey);
        if (!tabIds) return;

        const originMappings = addressToObfuscatedId.get(event.address);
        if (!originMappings) return;

        for (const [origin, obfuscatedId] of originMappings.entries()) {
            const message = {
                type: "host_event",
                event: "gatt_notification",
                data: {
                    address: obfuscatedId,
                    service_uuid: event.service_uuid,
                    char_uuid: event.char_uuid,
                    value: event.value
                }
            };

            for (const tabId of tabIds) {
                // Check if this tab matches the origin
                const tabsForOrigin = originToTabs.get(origin);
                if (tabsForOrigin && tabsForOrigin.has(tabId)) {
                    browser.tabs.sendMessage(tabId, message).catch(() => {
                        // Cleanup if message fails (tab likely gone)
                        tabIds.delete(tabId);
                        tabsForOrigin.delete(tabId);
                    });
                }
            }
        }
    } else if (event.event === "device_disconnected") {
        notificationSubscriptions.delete(event.address);
        for (const addrs of tabConnections.values()) addrs.delete(event.address);
        const originMappings = addressToObfuscatedId.get(event.address);
        if (originMappings) {
            for (const [origin, obfuscatedId] of originMappings.entries()) {
                const tabsForOrigin = originToTabs.get(origin);
                if (tabsForOrigin) {
                    for (const tabId of tabsForOrigin) {
                        browser.tabs.sendMessage(tabId, {
                            type: "host_event",
                            event: "device_disconnected",
                            data: { address: obfuscatedId }
                        }).catch(() => {
                            tabsForOrigin.delete(tabId);
                        });
                    }
                }
            }
        }
    } else if (event.event === "advertisement_received") {
        // 1. Forward advertisements to any open picker window
        for (const [pickerId, picker] of pendingPickers.entries()) {
            const request = pendingWebRequests.get(pickerId);
            if (request && picker.port) {
                // Check if device matches filters
                if (matchesFilters(event, request.options)) {
                    picker.port.postMessage({
                        event: "device_discovered",
                        device: {
                            name: event.name,
                            address: event.address,
                            rssi: event.rssi
                        }
                    });
                }
            }
        }

        // 2. Forward to authorized tabs for watchAdvertisements()
        const originMappings = addressToObfuscatedId.get(event.address);
        if (originMappings) {
            for (const [origin, obfuscatedId] of originMappings.entries()) {
                const message = {
                    type: "host_event",
                    event: "advertisement_received",
                    data: { 
                        address: obfuscatedId,
                        name: event.name,
                        rssi: event.rssi,
                        txPower: event.txPower,
                        uuids: event.uuids,
                        manufacturerData: event.manufacturerData,
                        serviceData: event.serviceData
                    }
                };
                
                const tabsForOrigin = originToTabs.get(origin);
                if (tabsForOrigin) {
                    for (const tabId of tabsForOrigin) {
                        browser.tabs.sendMessage(tabId, message).catch(() => {
                            tabsForOrigin.delete(tabId);
                        });
                    }
                }
            }
        }
    }
}

function matchesFilters(device, options) {
    if (!options) return true;
    if (options.acceptAllDevices) return true;
    if (!options.filters) return true;
    
    return options.filters.some(f => {
        if (f.name && device.name !== f.name) return false;
        if (f.namePrefix && (!device.name || !device.name.startsWith(f.namePrefix))) return false;
        if (f.services) {
            const devUUIDs = (device.uuids || []).map(u => normalizeUUID(u));
            const filterUUIDs = f.services.map(s => normalizeUUID(s));
            if (!filterUUIDs.every(s => devUUIDs.includes(s))) return false;
        }
        return true;
    });
}

// Track which tabs/pickers have requested scanning:
let scanningSubscribers = new Set(); 
let isScanning = false;

// Start scanning if needed
function updateScanningState() {
    if (!port) return;
    const shouldScan = scanningSubscribers.size > 0 || pendingPickers.size > 0;
    
    if (shouldScan && !isScanning) {
        isScanning = true;
        port.postMessage({ command: "watch_advertisements" });
    } else if (!shouldScan && isScanning) {
        isScanning = false;
        port.postMessage({ command: "stop_watch_advertisements" });
    }
}

// Start continuous scanning (legacy, will use updateScanningState instead)
function startScanning() {
    updateScanningState();
}

// Stop continuous scanning if no picker is active (legacy, will use updateScanningState instead)
function stopScanning() {
    updateScanningState();
}

initStorage().then(connectNativeHost);

// Handle picker connections via runtime.connect
browser.runtime.onConnect.addListener((connectionPort) => {
    if (connectionPort.name.startsWith("picker-")) {
        const pickerId = connectionPort.name.replace("picker-", "");
        console.log(`Picker connected: ${pickerId}`);

        if (pendingWebRequests.has(pickerId)) {
            pendingPickers.set(pickerId, { webRequestId: pickerId, port: connectionPort });
            
            connectionPort.onMessage.addListener(async (message) => {
                if (message.command === "picker_ready") {
                    updateScanningState();
                } else if (message.command === "select_device") {
                    const req = pendingWebRequests.get(pickerId);
                    if (req) {
                        const { resolve, reject, origin, options, pickerWindowId } = req;
                        const { address, name } = message;
                        
                        // Generate obfuscated ID
                        const obfuscatedId = await getObfuscatedId(origin, address);
                        
                        // Save permissions
                        if (!authorizedDevices.has(origin)) {
                            authorizedDevices.set(origin, new Map());
                        }
                        
                        const allowedServices = new Set();
                        
                        // Merge with existing services if device already authorized
                        const existingRecord = authorizedDevices.get(origin).get(obfuscatedId);
                        if (existingRecord) {
                            existingRecord.services.forEach(s => allowedServices.add(s));
                        }

                        if (options.filters) {
                            options.filters.forEach(f => {
                                if (f.services) f.services.forEach(s => allowedServices.add(normalizeUUID(s)));
                            });
                        }
                        if (options.optionalServices) {
                            options.optionalServices.forEach(s => allowedServices.add(normalizeUUID(s)));
                        }
                        
                        const { ok } = await mutateAndPersist(() => {
                            authorizedDevices.get(origin).set(obfuscatedId, {
                                address,
                                name,
                                services: allowedServices
                            });
                            return [];
                        });

                        if (ok) {
                            resolve({
                                status: "success",
                                device: { id: obfuscatedId, name }
                            });
                        } else {
                            reject(new Error("Failed to save device authorization. Please try again."));
                        }

                        pendingWebRequests.delete(pickerId);
                        pendingPickers.delete(pickerId);
                        updateScanningState();

                        if (pickerWindowId) {
                            browser.windows.remove(pickerWindowId).catch(() => {});
                        }
                    }
                } else if (message.command === "cancel") {
                    rejectRequest(pickerId, "User cancelled the requestDevice() chooser.");
                }
            });

            connectionPort.onDisconnect.addListener(() => {
                // If port disconnects without select, treat as cancel
                setTimeout(() => {
                    if (pendingWebRequests.has(pickerId)) {
                        rejectRequest(pickerId, "User cancelled the requestDevice() chooser.");
                    }
                }, 100);
            });
        }
    }
});

function rejectRequest(pickerId, errorMsg) {
    const req = pendingWebRequests.get(pickerId);
    if (req) {
        const { reject, pickerWindowId } = req;
        reject(new Error(errorMsg));
        pendingWebRequests.delete(pickerId);
        pendingPickers.delete(pickerId);
        updateScanningState();
        if (pickerWindowId) {
            browser.windows.remove(pickerWindowId).catch(() => {});
        }
    }
}

// Listener for content script requests
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // --- Admin commands from the extension's own UI (options page) ---
    // These are gated by isFromExtensionUI: a web page / content script can never
    // forge a moz-extension://<our-uuid>/ sender URL, so it cannot reach them.
    if (isAdminCommand(request.command)) {
        if (!isFromExtensionUI(sender, browser.runtime)) {
            sendResponse({ status: "error", message: "SecurityError: not authorized." });
            return;
        }
        initStorage().then(async () => {
            if (request.command === "list_grants") {
                sendResponse({ status: "success", grants: listGrants(authorizedDevices) });
                return;
            }
            const { ok, disconnects } = await mutateAndPersist(() => {
                if (request.command === "revoke_grant") {
                    const r = forgetGrant(authorizedDevices, request.origin, request.obfuscatedId);
                    return r.disconnectAddress ? [r.disconnectAddress] : [];
                }
                if (request.command === "revoke_site") return revokeSite(authorizedDevices, request.origin);
                return revokeAll(authorizedDevices);
            });
            if (!ok) {
                sendResponse({ status: "error", message: "Storage unavailable — nothing was changed." });
                return;
            }
            // Persisted successfully — only now apply the irreversible side effects.
            dispatchDisconnects(disconnects);
            sendResponse({ status: "success" });
        }).catch(() => sendResponse({ status: "error", message: "Storage unavailable." }));
        return true; // asynchronous response
    }

    if (!sender.tab) {
        sendResponse({ status: "error", message: "Only webpage tabs can invoke WebBluetooth commands." });
        return;
    }

    const tabId = sender.tab.id;
    const origin = new URL(sender.url).origin;

    // Secure context check
    const senderUrl = new URL(sender.url);
    const isSecureContext = 
        senderUrl.protocol === "https:" || 
        senderUrl.hostname === "localhost" || 
        senderUrl.hostname === "127.0.0.1" ||
        senderUrl.protocol === "moz-extension:";

    if (!isSecureContext) {
        sendResponse({ status: "error", message: "SecurityError: Web Bluetooth is only allowed in secure contexts (HTTPS or localhost)." });
        return;
    }

    // Secure command handling
    if (request.command === "request_device") {
        handleRequestDevice(request.options, origin, tabId)
            .then(res => sendResponse(res))
            .catch(err => sendResponse({ status: "error", message: err.message }));
        return true; // asynchronous response
    }

    if (request.command === "get_authorized_devices") {
        initStorage().then(() => {
            const list = [];
            const originMap = authorizedDevices.get(origin);
            if (originMap) {
                for (const [obfuscatedId, devInfo] of originMap.entries()) {
                    list.push({ id: obfuscatedId, name: devInfo.name });
                }
            }
            sendResponse({ status: "success", devices: list });
        }).catch(() => {
            sendResponse({ status: "error", message: "Storage unavailable." });
        });
        return true;
    }

    if (request.command === "check_availability") {
        if (!port) {
            sendResponse({ status: "success", available: false });
            return;
        }
        currentRequestId++;
        const hostRequestId = currentRequestId;
        port.postMessage({ command: "check_availability", requestId: hostRequestId });
        new Promise((resolve, reject) => {
            pendingWebRequests.set(hostRequestId, { resolve, reject });
        })
        .then(res => sendResponse(res))
        .catch(err => sendResponse({ status: "error", message: err.message }));
        return true; // asynchronous response
    }

    // --- SECURITY: WHITESLIST COMMANDS ---
    const GATT_COMMANDS = [
        "connect_device", "disconnect_device",
        "get_primary_services", "get_primary_service", 
        "get_characteristics", "get_descriptors",
        "read_gatt_char", "write_gatt_char",
        "read_gatt_descriptor", "write_gatt_descriptor",
        "start_notify", "stop_notify",
        "watch_advertisements", "stop_watch_advertisements",
        "forget_device"
    ];

    if (!GATT_COMMANDS.includes(request.command)) {
        sendResponse({ status: "error", message: "SecurityError: Invalid or restricted command." });
        return;
    }

    if (request.command === "forget_device") {
        const originMap = authorizedDevices.get(origin);
        if (!originMap || !originMap.has(request.address)) {
            sendResponse({ status: "success" }); // Already forgotten or not found
            return;
        }
        mutateAndPersist(() => {
            const r = forgetGrant(authorizedDevices, origin, request.address);
            return r.disconnectAddress ? [r.disconnectAddress] : [];
        }).then(({ ok, disconnects }) => {
            if (!ok) {
                sendResponse({ status: "error", message: "Storage unavailable — nothing was changed." });
                return;
            }
            // Persisted successfully — only now apply the irreversible side effects.
            dispatchDisconnects(disconnects);
            sendResponse({ status: "success" });
        });
        return true;
    }

    // Check if host port is connected
    if (!port) {
        sendResponse({ status: "error", message: "Bluetooth Native Host is not connected." });
        return;
    }

    // All other GATT operations must have permission verified
    const obfuscatedId = request.address;
    if (!obfuscatedId) {
        sendResponse({ status: "error", message: "Invalid arguments: Device ID is required." });
        return;
    }

    // Translate and verify permission
    const originMap = authorizedDevices.get(origin);
    const deviceRecord = originMap ? originMap.get(obfuscatedId) : null;
    if (!deviceRecord) {
        sendResponse({ status: "error", message: "SecurityError: Device not authorized." });
        return;
    }

    const realAddress = deviceRecord.address;

    // Verify service permission if applicable
    const SERVICE_OPERATIONS = [
        "get_primary_service", 
        "get_characteristics", 
        "read_gatt_char", 
        "write_gatt_char", 
        "start_notify", 
        "stop_notify",
        "read_gatt_descriptor",
        "write_gatt_descriptor",
        "get_descriptors"
    ];
    if (SERVICE_OPERATIONS.includes(request.command)) {
        if (!request.service_uuid) {
            sendResponse({ status: "error", message: `SecurityError: service_uuid is required for ${request.command}` });
            return;
        }
        const reqService = normalizeUUID(request.service_uuid);
        if (!deviceRecord.services.has(reqService)) {
            sendResponse({ status: "error", message: `SecurityError: Service ${request.service_uuid} not authorized.` });
            return;
        }
    }

    // Handle scanning tracking
    if (request.command === "watch_advertisements") {
        scanningSubscribers.add(tabId);
        updateScanningState();
        sendResponse({ status: "success" });
        return;
    }
    if (request.command === "stop_watch_advertisements") {
        scanningSubscribers.delete(tabId);
        updateScanningState();
        sendResponse({ status: "success" });
        return;
    }

    // Handle notifications subscription tracking
    if (request.command === "start_notify") {
        const subKey = getSubKey(request.service_uuid, request.char_uuid);
        if (!notificationSubscriptions.has(realAddress)) {
            notificationSubscriptions.set(realAddress, new Map());
        }
        const charSubs = notificationSubscriptions.get(realAddress);
        if (!charSubs.has(subKey)) {
            charSubs.set(subKey, new Set());
        }
        
        const alreadyNotifying = charSubs.get(subKey).size > 0;
        charSubs.get(subKey).add(tabId);
        
        if (alreadyNotifying) {
            sendResponse({ status: "success" });
            return;
        }
    } else if (request.command === "stop_notify") {
        const subKey = getSubKey(request.service_uuid, request.char_uuid);
        const charSubs = notificationSubscriptions.get(realAddress);
        if (charSubs && charSubs.has(subKey)) {
            charSubs.get(subKey).delete(tabId);
            if (charSubs.get(subKey).size > 0) {
                sendResponse({ status: "success" });
                return;
            }
        } else {
            sendResponse({ status: "success" });
            return;
        }
    }

    // Map request properties before sending to native host
    // Explicitly reconstruct to prevent extra fields
    const mappedRequest = { 
        command: request.command,
        address: realAddress,
        service_uuid: request.service_uuid,
        char_uuid: request.char_uuid,
        descriptor_uuid: request.descriptor_uuid,
        value: request.value,
        response: request.response
    };
    
    // Forward to host
    currentRequestId++;
    const hostRequestId = currentRequestId;
    mappedRequest.requestId = hostRequestId;
    
    port.postMessage(mappedRequest);

    new Promise((resolve, reject) => {
        pendingWebRequests.set(hostRequestId, { resolve, reject });
    })
    .then(res => {
        // Track connection state ONLY on success
        if (request.command === "connect_device" && res.status === "success") {
            if (!tabConnections.has(tabId)) tabConnections.set(tabId, new Set());
            tabConnections.get(tabId).add(realAddress);
        }

        // Filter results for get_primary_services
        if (request.command === "get_primary_services" && res.status === "success" && res.uuids) {
            res.uuids = res.uuids.filter(uuid => deviceRecord.services.has(normalizeUUID(uuid)));
        }
        sendResponse(res);
    })
    .catch(err => sendResponse({ status: "error", message: err.message }));

    return true; // asynchronous response
});

async function handleRequestDevice(options, origin, tabId) {
    return new Promise(async (resolve, reject) => {
        const pickerId = `picker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        
        pendingWebRequests.set(pickerId, { 
            resolve, 
            reject, 
            options, 
            origin, 
            tabId,
            pickerWindowId: null 
        });

        // Open secure popup window
        try {
            const win = await browser.windows.create({
                url: browser.runtime.getURL(`picker.html?requestId=${pickerId}&tabId=${tabId}`),
                type: "popup",
                width: 420,
                height: 560
            });
            
            const req = pendingWebRequests.get(pickerId);
            if (req) {
                req.pickerWindowId = win.id;
            }
        } catch (e) {
            reject(new Error("Failed to open device chooser UI: " + e.message));
            pendingWebRequests.delete(pickerId);
        }
    });
}

function cleanupTabResources(tabId) {
    // Cleanup notification subscriptions
    for (const [address, charSubs] of notificationSubscriptions.entries()) {
        for (const [subKey, tabIds] of charSubs.entries()) {
            if (tabIds.has(tabId)) {
                tabIds.delete(tabId);
                // If this was the last tab for this characteristic, tell the host to stop
                if (tabIds.size === 0 && port) {
                    const [serviceUuid, charUuid] = subKey.split('|');
                    port.postMessage({
                        command: "stop_notify",
                        address: address,
                        service_uuid: serviceUuid,
                        char_uuid: charUuid
                    });
                }
            }
        }
    }

    // Cleanup scanning
    if (scanningSubscribers.has(tabId)) {
        scanningSubscribers.delete(tabId);
        updateScanningState();
    }

    // Cleanup tab/origin tracking
    const origin = tabIdToOrigin.get(tabId);
    if (origin) {
        if (originToTabs.has(origin)) {
            originToTabs.get(origin).delete(tabId);
        }
        tabIdToOrigin.delete(tabId);
    }

    // If any pending request was for this tab, cancel it
    for (const [pickerId, req] of pendingWebRequests.entries()) {
        if (req.tabId === tabId) {
            rejectRequest(pickerId, "Tab context lost.");
        }
    }

    // Clean up active connections for this tab
    const conns = tabConnections.get(tabId);
    if (conns && port) {
        conns.forEach(address => {
            // Disconnect if no other tab is using it
            let inUse = false;
            for (const [otherTabId, otherConns] of tabConnections.entries()) {
                if (otherTabId !== tabId && otherConns.has(address)) {
                    inUse = true;
                    break;
                }
            }
            if (!inUse) {
                port.postMessage({ command: "disconnect_device", address });
            }
        });
    }
    tabConnections.delete(tabId);
}

// Cleanup closed windows/tabs connections
browser.tabs.onRemoved.addListener((tabId) => {
    cleanupTabResources(tabId);
});

// Cleanup on navigation to prevent origin leaks and resource waste
browser.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) { // Only main frame navigation
        cleanupTabResources(details.tabId);
        updateTabMapping(details.tabId, details.url);
    }
});

console.log("Secure Background script loaded.");
