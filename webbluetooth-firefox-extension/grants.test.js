const { test } = require("node:test");
const assert = require("node:assert");
const { isFromExtensionUI, forgetGrant, revokeSite, revokeAll, listGrants } = require("./grants.js");

// Build an authorizedDevices Map shaped like background.js holds in memory.
// spec: { origin: { obfuscatedId: { address, name, services: [uuid,...] } } }
function buildMap(spec) {
    const m = new Map();
    for (const [origin, devices] of Object.entries(spec)) {
        const originMap = new Map();
        for (const [id, info] of Object.entries(devices)) {
            originMap.set(id, { address: info.address, name: info.name, services: new Set(info.services || []) });
        }
        m.set(origin, originMap);
    }
    return m;
}

const fakeRuntime = {
    id: "webbluetooth@rfvx.github.io",
    getURL: (p) => "moz-extension://abc-uuid/" + p
};

test("isFromExtensionUI: our options page passes", () => {
    const sender = { id: "webbluetooth@rfvx.github.io", url: "moz-extension://abc-uuid/options.html" };
    assert.strictEqual(isFromExtensionUI(sender, fakeRuntime), true);
});

test("isFromExtensionUI: web page content script is rejected", () => {
    const sender = { id: "webbluetooth@rfvx.github.io", url: "https://evil.com/page" };
    assert.strictEqual(isFromExtensionUI(sender, fakeRuntime), false);
});

test("isFromExtensionUI: missing url is rejected", () => {
    const sender = { id: "webbluetooth@rfvx.github.io" };
    assert.strictEqual(isFromExtensionUI(sender, fakeRuntime), false);
});

test("isFromExtensionUI: lookalike extension uuid is rejected", () => {
    const sender = { id: "webbluetooth@rfvx.github.io", url: "moz-extension://other-uuid/options.html" };
    assert.strictEqual(isFromExtensionUI(sender, fakeRuntime), false);
});

test("forgetGrant: removes the grant and signals disconnect when last reference", () => {
    const m = buildMap({ "https://a.com": { dev1: { address: "AA:BB", name: "Node", services: ["x"] } } });
    const r = forgetGrant(m, "https://a.com", "dev1");
    assert.strictEqual(r.removed, true);
    assert.strictEqual(r.disconnectAddress, "AA:BB");
    assert.strictEqual(m.has("https://a.com"), false); // empty origin dropped
});

test("forgetGrant: does NOT signal disconnect when another origin holds the MAC", () => {
    const m = buildMap({
        "https://a.com": { dev1: { address: "AA:BB", name: "Node" } },
        "https://b.com": { dev2: { address: "AA:BB", name: "Node" } }
    });
    const r = forgetGrant(m, "https://a.com", "dev1");
    assert.strictEqual(r.removed, true);
    assert.strictEqual(r.disconnectAddress, null);
});

test("forgetGrant: unknown grant is a no-op", () => {
    const m = buildMap({ "https://a.com": { dev1: { address: "AA:BB", name: "Node" } } });
    const r = forgetGrant(m, "https://a.com", "nope");
    assert.strictEqual(r.removed, false);
    assert.strictEqual(r.disconnectAddress, null);
    assert.strictEqual(m.get("https://a.com").size, 1);
});

test("revokeSite: removes all of one origin's grants and returns disconnects", () => {
    const m = buildMap({
        "https://a.com": { dev1: { address: "AA:BB", name: "N1" }, dev2: { address: "CC:DD", name: "N2" } },
        "https://b.com": { dev3: { address: "EE:FF", name: "N3" } }
    });
    const disconnects = revokeSite(m, "https://a.com");
    assert.deepStrictEqual(disconnects.sort(), ["AA:BB", "CC:DD"]);
    assert.strictEqual(m.has("https://a.com"), false);
    assert.strictEqual(m.has("https://b.com"), true);
});

test("revokeAll: clears everything", () => {
    const m = buildMap({
        "https://a.com": { dev1: { address: "AA:BB", name: "N1" } },
        "https://b.com": { dev3: { address: "EE:FF", name: "N3" } }
    });
    const disconnects = revokeAll(m);
    assert.deepStrictEqual(disconnects.sort(), ["AA:BB", "EE:FF"]);
    assert.strictEqual(m.size, 0);
});

test("listGrants: exposes name + serviceCount, never the address", () => {
    const m = buildMap({ "https://a.com": { dev1: { address: "AA:BB", name: "Node", services: ["x", "y"] } } });
    const out = listGrants(m);
    assert.deepStrictEqual(out, { "https://a.com": [{ obfuscatedId: "dev1", name: "Node", serviceCount: 2 }] });
    assert.strictEqual(JSON.stringify(out).includes("AA:BB"), false);
});
