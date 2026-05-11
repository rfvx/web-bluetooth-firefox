// background.js

let port = null;
let pendingRequests = new Map();
let currentRequestId = 0;

// Function to establish connection to the native host
function connectNativeHost() {
    // Make sure the name here matches the "name" in webbluetooth_host.json
    // It's 'webbluetooth_host' for our Python script.
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
        } else if (response.event === "gatt_notification") {
            console.log(`Notification from ${response.address} for ${response.char_uuid}: ${response.value}`);
            // Forward GATT notifications to all content scripts or specific ones if sender info is available
            browser.tabs.query({}, (tabs) => {
                tabs.forEach((tab) => {
                    browser.tabs.sendMessage(tab.id, { type: "gatt_notification", data: response }).catch(() => {});
                });
            });
        } else if (response.status === "error") {
            console.error("Host error:", response.message);
            // Handle errors that are not tied to a specific request (e.g., general host issues)
        }
    });

    port.onDisconnect.addListener(() => {
        console.log("Disconnected from native host. Reason:", port.error);
        
        // Reject all pending requests
        for (const [requestId, { reject }] of pendingRequests) {
            reject(new Error("Native host disconnected."));
        }
        pendingRequests.clear();

        port = null;
        // Attempt to reconnect after a delay if the connection is lost
        setTimeout(connectNativeHost, 5000); // Reconnect after 5 seconds
    });

    console.log("Connected to native host.");
}

// Initial connection attempt
try {
    connectNativeHost();
} catch (error) {
    console.error("Failed to connect to native host during initial connect attempt:", error.message);
    // Note: "No such native application" errors might occur later during port.postMessage if not caught here.
}

// Listen for messages from content scripts or popup UI (if any)
// This listener handles messages sent from test_page.html using browser.runtime.sendMessage
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!port) {
        console.error("Native host not connected. Cannot send message.");
        sendResponse({ status: "error", message: "Native host not connected." });
        return true; 
    }

    currentRequestId++;
    const requestId = currentRequestId;

    console.log(`Sending to host (Request ID: ${requestId}): `, request);
    port.postMessage({ ...request, requestId: requestId });

    // Return a promise that will be resolved/rejected when the native host responds
    return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });
    });
});

console.log("Background script loaded.");
