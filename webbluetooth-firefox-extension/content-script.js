// webbluetooth-firefox-extension/content-script.js

// --- Message Bridging between Page and Background Script ---

// Admin/options-page commands must never originate from a web page. background.js
// already rejects these via isFromExtensionUI; dropping them here too means a web
// page can't even reach that gate (defense in depth).
const PAGE_BLOCKED_COMMANDS = new Set(["list_grants", "revoke_grant", "revoke_site", "revoke_all"]);

window.addEventListener('message', async (event) => {
    if (event.source === window && event.origin === window.location.origin && event.data && event.data.type === 'FROM_PAGE') {
        const { id, payload } = event.data;
        if (payload && PAGE_BLOCKED_COMMANDS.has(payload.command)) {
            window.postMessage({
                type: 'FROM_CONTENT_SCRIPT',
                id: id,
                error: 'SecurityError: command not available to web pages.'
            }, window.location.origin);
            return;
        }
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
