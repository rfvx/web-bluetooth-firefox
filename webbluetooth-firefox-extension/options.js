const content = document.getElementById("content");
const footer = document.getElementById("footer");

function send(message) {
    return browser.runtime.sendMessage(message);
}

function deviceRow(origin, dev) {
    const row = document.createElement("div");
    row.className = "device-row";

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "device-name";
    name.textContent = dev.name || "Unknown device";
    const meta = document.createElement("div");
    meta.className = "device-meta";
    meta.textContent = dev.serviceCount + (dev.serviceCount === 1 ? " service" : " services");
    info.append(name, meta);

    const btn = document.createElement("button");
    btn.className = "btn btn-danger";
    btn.textContent = "Remove";
    btn.addEventListener("click", async () => {
        btn.disabled = true;
        const res = await send({ command: "revoke_grant", origin, obfuscatedId: dev.obfuscatedId }).catch(() => null);
        if (res && res.status === "success") {
            render();
        } else {
            btn.disabled = false;
            meta.textContent = "Couldn't remove — try again";
        }
    });

    row.append(info, btn);
    return row;
}

function siteCard(origin, devices) {
    const card = document.createElement("div");
    card.className = "site-card";

    const head = document.createElement("div");
    head.className = "site-header";
    const o = document.createElement("span");
    o.className = "site-origin";
    o.textContent = origin;
    const all = document.createElement("button");
    all.className = "btn";
    all.textContent = "Remove all for this site";
    all.addEventListener("click", async () => {
        all.disabled = true;
        const res = await send({ command: "revoke_site", origin }).catch(() => null);
        if (res && res.status === "success") render();
        else all.disabled = false;
    });
    head.append(o, all);
    card.append(head);

    for (const dev of devices) card.append(deviceRow(origin, dev));
    return card;
}

async function render() {
    content.innerHTML = "";
    footer.hidden = true;

    const res = await send({ command: "list_grants" }).catch(() => null);

    if (!res || res.status !== "success") {
        const err = document.createElement("div");
        err.className = "error-state";
        err.textContent = "Couldn't load permissions. ";
        const reload = document.createElement("button");
        reload.className = "btn";
        reload.textContent = "Reload";
        reload.addEventListener("click", render);
        err.append(reload);
        content.append(err);
        return;
    }

    const origins = Object.keys(res.grants).sort();
    if (origins.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No website has access to your Bluetooth devices yet. When you pair a device through a site, it'll appear here.";
        content.append(empty);
        return;
    }

    for (const origin of origins) {
        content.append(siteCard(origin, res.grants[origin]));
    }
    footer.hidden = false;
}

document.getElementById("revoke-all").addEventListener("click", async () => {
    if (!window.confirm("Remove every site's access to all Bluetooth devices?")) return;
    const res = await send({ command: "revoke_all" }).catch(() => null);
    if (res && res.status === "success") render();
    else window.alert("Couldn't remove all — please try again.");
});

render();
