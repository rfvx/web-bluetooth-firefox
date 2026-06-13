// grants.js — pure grant-management logic shared by background.js and unit tests.
// Loaded as a classic script BEFORE background.js (see manifest background.scripts),
// so these top-level function declarations are visible to background.js.
// Also require()-able from Node tests via the module.exports guard at the bottom.

// True only when the message came from this extension's own UI page (e.g. the
// options page), never from a web page / content script. `runtime` is injected
// (browser.runtime in the extension; a fake in tests).
function isFromExtensionUI(sender, runtime) {
    return !!sender
        && sender.id === runtime.id
        && typeof sender.url === "string"
        && sender.url.startsWith(runtime.getURL(""));
}

// Remove one grant (origin + obfuscatedId) from the authorizedDevices Map.
// Mutates the passed Map only. Returns what the caller must do next:
//   removed: whether a grant was actually present and deleted
//   disconnectAddress: real MAC to disconnect, or null if another origin still holds it
function forgetGrant(authorizedDevices, origin, obfuscatedId) {
    const originMap = authorizedDevices.get(origin);
    if (!originMap || !originMap.has(obfuscatedId)) {
        return { removed: false, disconnectAddress: null };
    }
    const realAddress = originMap.get(obfuscatedId).address;
    originMap.delete(obfuscatedId);
    if (originMap.size === 0) {
        authorizedDevices.delete(origin);
    }
    const stillAuthorized = [...authorizedDevices.values()].some(m =>
        [...m.values()].some(d => d.address === realAddress)
    );
    return { removed: true, disconnectAddress: stillAuthorized ? null : realAddress };
}

// Remove every grant for one origin. Returns the list of real MACs to disconnect.
function revokeSite(authorizedDevices, origin) {
    const originMap = authorizedDevices.get(origin);
    if (!originMap) return [];
    const disconnects = [];
    for (const obfuscatedId of [...originMap.keys()]) {
        const r = forgetGrant(authorizedDevices, origin, obfuscatedId);
        if (r.disconnectAddress) disconnects.push(r.disconnectAddress);
    }
    return disconnects;
}

// Remove every grant for every origin. Returns the list of real MACs to disconnect.
function revokeAll(authorizedDevices) {
    const disconnects = [];
    for (const origin of [...authorizedDevices.keys()]) {
        for (const addr of revokeSite(authorizedDevices, origin)) {
            disconnects.push(addr);
        }
    }
    return disconnects;
}

// Shape the authorizedDevices Map for the options page.
// Exposes only name + service COUNT — never the real MAC address.
function listGrants(authorizedDevices) {
    const out = {};
    for (const [origin, originMap] of authorizedDevices.entries()) {
        out[origin] = [];
        for (const [obfuscatedId, devInfo] of originMap.entries()) {
            out[origin].push({
                obfuscatedId,
                name: devInfo.name,
                serviceCount: devInfo.services ? devInfo.services.size : 0
            });
        }
    }
    return out;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { isFromExtensionUI, forgetGrant, revokeSite, revokeAll, listGrants };
}
