// webbluetooth-firefox-extension/content-script.js

// --- Message Bridging between Page and Background Script ---

window.addEventListener('message', async (event) => {
    if (event.source === window && event.origin === window.location.origin && event.data && event.data.type === 'FROM_PAGE') {
        const { id, payload } = event.data;
        try {
            const response = await browser.runtime.sendMessage(payload);
            window.postMessage({
                type: 'FROM_CONTENT_SCRIPT',
                id: id,
                response: response
            }, window.location.origin);
        } catch (error) {
            window.postMessage({
                type: 'FROM_CONTENT_SCRIPT',
                id: id,
                error: error.message || 'Unknown error in content script relay.'
            }, window.location.origin);
        }
    }
});

browser.runtime.onMessage.addListener((message) => {
    if (message.type === "host_event") {
        window.postMessage({
            type: 'FROM_CONTENT_SCRIPT',
            event: message.event,
            data: message.data
        }, window.location.origin);
    }
});

// --- Inject Polyfill into Page Context ---
// Note: We are using "world": "MAIN" in manifest.json for polyfill.js,
// so this content script mainly handles the message bridging.
console.log("WebBluetooth extension content script relay loaded.");
