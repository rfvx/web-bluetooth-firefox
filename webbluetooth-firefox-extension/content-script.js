// webbluetooth-firefox-extension/content-script.js

// --- Message Bridging between Page and Background Script ---
// This acts as a relay for messages between the webpage and the extension's background script.

window.addEventListener('message', async (event) => {
    // Only accept messages from our own window and of the expected type
    if (event.source === window && event.data && event.data.type === 'FROM_PAGE') {
        const { id, payload } = event.data;
        try {
            // Forward the payload to the background script
            const response = await browser.runtime.sendMessage(payload);
            // Post the response back to the page, including the original ID
            window.postMessage({
                type: 'FROM_CONTENT_SCRIPT',
                id: id,
                response: response
            }, '*');
        } catch (error) {
            // Post any errors back to the page
            window.postMessage({
                type: 'FROM_CONTENT_SCRIPT',
                id: id,
                error: error.message || 'Unknown error in content script relay.'
            }, '*');
        }
    }
});

// Listen for messages from the background script (e.g., GATT notifications)
browser.runtime.onMessage.addListener((message) => {
    if (message.type === "gatt_notification") {
        // Post GATT notifications directly to the page.
        // The page will need to handle these as generic events if not tied to a specific request ID.
        window.postMessage({
            type: 'FROM_CONTENT_SCRIPT',
            event: 'gatt_notification',
            data: message.data
        }, '*');
    }
});
