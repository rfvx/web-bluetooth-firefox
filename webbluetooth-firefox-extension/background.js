// background.js

let port = null;
let pendingRequests = new Map();
let currentRequestId = 0;

// Function to establish connection to the native host
function connectNativeHost() {
    const HOST_NAME = 'webbluetooth_host';
    port = browser.runtime.connectNative(HOST_NAME);

    port.onMessage.addListener((response) => {
        console.log("Received from host: ", response);
        
        // Check if the response is for a pending request
        if (response.requestId && pendingRequests.has(response.requestId)) {
            const { resolve, reject } = pendingRequests.get(response.requestId);
            pendingRequests.delete(response.requestId);
            if (response.status === "error") {
                reject(new Error(response.message || "Unknown error from native host"));
            } else {
                resolve(response);
            }
        } else if (response.event) {
            // General event relay
            console.log(`Event from host: ${response.event}`, response);
            browser.tabs.query({}, (tabs) => {
                tabs.forEach((tab) => {
                    browser.tabs.sendMessage(tab.id, { type: "host_event", event: response.event, data: response }).catch(() => {});
                });
            });
        } else if (response.status === "error") {
            console.error("Host error:", response.message);
        }
    });

    port.onDisconnect.addListener(() => {
        console.log("Disconnected from native host. Reason:", port.error);
        
        for (const [requestId, { reject }] of pendingRequests) {
            reject(new Error("Native host disconnected."));
        }
        pendingRequests.clear();

        port = null;
        setTimeout(connectNativeHost, 5000); 
    });

    console.log("Connected to native host.");
}

try {
    connectNativeHost();
} catch (error) {
    console.error("Failed to connect to native host:", error.message);
}

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!port) {
        console.error("Native host not connected.");
        sendResponse({ status: "error", message: "Native host not connected." });
        return true; 
    }

    currentRequestId++;
    const requestId = currentRequestId;

    console.log(`Sending to host (Request ID: ${requestId}): `, request);
    port.postMessage({ ...request, requestId: requestId });

    return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });
    });
});

console.log("Background script loaded.");
