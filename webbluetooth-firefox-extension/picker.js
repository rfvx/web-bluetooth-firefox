// picker.js
const params = new URLSearchParams(window.location.search);
const requestId = params.get('requestId');
const tabId = params.get('tabId');

if (!requestId) {
    console.error("No request ID provided to Bluetooth picker.");
    document.getElementById('status-text').textContent = "Error: Invalid request context.";
}

const deviceList = document.getElementById('device-list');
const emptyState = document.getElementById('empty-state');
const btnCancel = document.getElementById('btn-cancel');
const btnPair = document.getElementById('btn-pair');
const statusText = document.getElementById('status-text');

let selectedDevice = null;
const discoveredDevices = new Map(); // address -> DOM Element

// Connect a port to the background page
const port = browser.runtime.connect({ name: `picker-${requestId}` });

// Request initial state or scan trigger
port.postMessage({ command: "picker_ready" });

port.onMessage.addListener((message) => {
    if (message.event === "device_discovered") {
        addOrUpdateDevice(message.device);
    } else if (message.event === "scan_stopped") {
        statusText.textContent = "Scan completed.";
        const statusDot = document.querySelector('.status-dot');
        if (statusDot) statusDot.classList.remove('pulsing');
        const spinner = document.querySelector('.spinner');
        if (spinner) spinner.style.display = 'none';
    }
});

function getRssiBars(rssi) {
    if (!rssi) return 1;
    if (rssi >= -60) return 4;
    if (rssi >= -70) return 3;
    if (rssi >= -85) return 2;
    return 1;
}

function addOrUpdateDevice(device) {
    // Hide empty state if it's there
    if (emptyState.style.display !== 'none') {
        emptyState.style.display = 'none';
    }

    const { name, address, rssi } = device;
    const displayName = name || "Unknown Device";
    
    // Check if we already have this device in the UI
    if (discoveredDevices.has(address)) {
        const item = discoveredDevices.get(address);
        item.querySelector('.device-name').textContent = displayName;
        
        // Update RSSI bars
        const rssiText = item.querySelector('.device-rssi span');
        if (rssiText) rssiText.textContent = rssi ? rssi + ' dBm' : '';

        const rssiContainer = item.querySelector('.rssi-bars');
        const barsCount = getRssiBars(rssi);
        const bars = rssiContainer.querySelectorAll('.rssi-bar');
        bars.forEach((bar, i) => {
            bar.style.opacity = i < barsCount ? '1' : '0.2';
        });
        
        return;
    }

    // Create a new item
    const item = document.createElement('div');
    item.className = 'device-item';
    
    const barsCount = getRssiBars(rssi);
    
    const deviceInfo = document.createElement('div');
    deviceInfo.className = 'device-info';
    
    const deviceNameSpan = document.createElement('span');
    deviceNameSpan.className = 'device-name';
    deviceNameSpan.textContent = displayName;
    
    const deviceAddressSpan = document.createElement('span');
    deviceAddressSpan.className = 'device-address';
    deviceAddressSpan.textContent = address;
    
    deviceInfo.appendChild(deviceNameSpan);
    deviceInfo.appendChild(deviceAddressSpan);

    const deviceRssi = document.createElement('div');
    deviceRssi.className = 'device-rssi';
    
    const rssiText = document.createElement('span');
    rssiText.style.fontSize = '0.75rem';
    rssiText.style.marginRight = '4px';
    rssiText.textContent = rssi ? rssi + ' dBm' : '';
    
    const rssiBars = document.createElement('div');
    rssiBars.className = 'rssi-bars';
    for (let i = 0; i < 4; i++) {
        const bar = document.createElement('div');
        bar.className = 'rssi-bar';
        bar.style.opacity = i < barsCount ? '1' : '0.2';
        rssiBars.appendChild(bar);
    }
    
    deviceRssi.appendChild(rssiText);
    deviceRssi.appendChild(rssiBars);
    
    item.appendChild(deviceInfo);
    item.appendChild(deviceRssi);

    item.onclick = () => {
        // Deselect previous
        const prevSelected = deviceList.querySelector('.device-item.selected');
        if (prevSelected) prevSelected.classList.remove('selected');
        
        // Select new
        item.classList.add('selected');
        selectedDevice = device;
        btnPair.disabled = false;
    };

    deviceList.appendChild(item);
    discoveredDevices.set(address, item);
}

btnCancel.onclick = () => {
    port.postMessage({ command: "cancel" });
    window.close();
};

btnPair.onclick = () => {
    if (selectedDevice) {
        port.postMessage({
            command: "select_device",
            address: selectedDevice.address,
            name: selectedDevice.name
        });
        // Do not call window.close() here — background.js closes the window via
        // browser.windows.remove() after processing select_device, avoiding a race
        // with the onDisconnect cancel timer.
    }
};

// Handle window close or escape
window.onbeforeunload = () => {
    port.disconnect();
};
