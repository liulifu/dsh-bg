// CDP driver: verify dsh-bg in the real browser (headless Chrome via DevTools protocol).
// Uses Node's global fetch + WebSocket (Node >= 22).
const CDP_HTTP = "http://127.0.0.1:9222";
const APP_URL = "http://127.0.0.1:3080/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createTab(url) {
	const res = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
	if (!res.ok) throw new Error("createTab failed: " + res.status);
	return res.json();
}

async function connect(wsUrl) {
	const ws = new WebSocket(wsUrl);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = () => reject(new Error("ws error"));
	});
	let nextId = 0;
	const pending = new Map();
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		if (msg.id !== undefined && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			if (msg.error) reject(new Error(msg.error.message));
			else resolve(msg.result);
		}
	};
	const send = (method, params = {}) => new Promise((resolve, reject) => {
		const id = ++nextId;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});
	return { ws, send };
}

async function evalJs(cdp, expression) {
	const res = await cdp.send("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true
	});
	if (res.exceptionDetails) throw new Error("eval threw: " + JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text));
	return res.result.value;
}

async function waitFor(cdp, expression, label, timeoutMs = 30000, intervalMs = 500) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			if (await evalJs(cdp, expression)) return true;
		} catch { /* page mid-load */ }
		await sleep(intervalMs);
	}
	console.error(`TIMEOUT waiting for: ${label}`);
	return false;
}

(async () => {
	const tab = await createTab(APP_URL);
	const cdp = await connect(tab.webSocketDebuggerUrl);
	await cdp.send("Runtime.enable");
	await cdp.send("Page.enable");

	const consoleErrors = [];
	cdp.ws.addEventListener("message", (event) => {
		const msg = JSON.parse(event.data);
		if (msg.method === "Runtime.exceptionThrown") {
			consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? "exception");
		}
		if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
			consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
		}
	});

	// 1) Wait for the app shell + dsh-bg plugin activation (style element created in apply()).
	const booted = await waitFor(cdp, `document.getElementById("dsh-bg-style") !== null`, "dsh-bg style element");
	console.log("booted=" + booted);

	// 2) Boot manifest contains dsh-bg?
	const manifestHas = await evalJs(cdp, `(window.__DSH_BOOT__?.entries ?? []).some((e) => e.id === "dsh-bg")`);
	console.log("manifestHasDshBg=" + manifestHas);

	// 3) Style element state.
	const styleInfo = await evalJs(cdp, `(() => {
		const el = document.getElementById("dsh-bg-style");
		if (!el) return null;
		return { tag: el.getAttribute("data-plugin"), len: el.textContent.length, text: el.textContent.slice(0, 200) };
	})()`);
	console.log("styleInfo=" + JSON.stringify(styleInfo));

	// 4) Layout columns exist (suffix selectors will match them).
	const layout = await evalJs(cdp, `(() => {
		const f = document.querySelector('[class$="_frame"]');
		const l = document.querySelector('[class$="_sidebarCol"]');
		const c = document.querySelector('[class$="_centerCol"]');
		const d = document.querySelector('[class$="_detailsCol"]');
		return {
			frame: !!f && !!f.querySelector(':scope > [class$="_sidebarCol"]'),
			leftCol: !!l,
			centerCol: !!c,
			detailsCol: !!d,
			frameClass: f ? f.className : null
		};
	})()`);
	console.log("layout=" + JSON.stringify(layout));

	// 5) Open settings via the sidebar footer settings button.
	const opened = await evalJs(cdp, `(() => {
		const btn = document.querySelector('[class$="_settingsArea"] button, [class$="_settingsArea"] [role="button"], [class$="_settings"] button');
		if (btn) { btn.click(); return true; }
		return false;
	})()`);
	console.log("settingsButtonClicked=" + opened);
	if (opened) await sleep(1200);

	// 6) Look for the Background row: title 背景 + mode buttons 左面板/右面板/左右无缝.
	const row = await evalJs(cdp, `(() => {
		const buttons = [...document.querySelectorAll("button")];
		const modeBtns = buttons.filter((b) => ["左面板", "右面板", "左右无缝"].includes(b.textContent.trim()));
		const allText = document.body.innerText;
		return {
			modeButtons: modeBtns.map((b) => b.textContent.trim()),
			hasBackgroundTitle: allText.includes("背景"),
			hasEnableLabel: allText.includes("启用"),
			hasRemoveBtn: allText.includes("移除背景"),
			hasOverlay: allText.includes("压暗遮罩"),
			settingsVisible: allText.includes("通用") && allText.includes("外观")
		};
	})()`);
	console.log("settingsRow=" + JSON.stringify(row));

	// 7) Enable the background: click the 启用 checkbox.
	const enabled = await evalJs(cdp, `(() => {
		const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
		const box = boxes.find((b) => b.closest("div")?.innerText?.includes("启用"));
		if (box && !box.checked) { box.click(); return true; }
		return !!box;
	})()`);
	console.log("enableClicked=" + enabled);
	await sleep(800);

	// 8) Computed background of the frame in seamless (both) mode.
	const frameBg = await evalJs(cdp, `(() => {
		const f = document.querySelector('[class$="_frame"]');
		const cs = getComputedStyle(f);
		return { image: cs.backgroundImage.slice(0, 120), size: cs.backgroundSize };
	})()`);
	console.log("frameBg=" + JSON.stringify(frameBg));

	// 9) Switch to left mode and read the sidebar column background.
	await evalJs(cdp, `(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "左面板"); if (b) b.click(); return !!b; })()`);
	await sleep(600);
	const leftBg = await evalJs(cdp, `(() => {
		const l = document.querySelector('[class$="_sidebarCol"]');
		const inner = l.querySelector(':scope > div');
		return {
			colImage: getComputedStyle(l).backgroundImage.slice(0, 120),
			innerBg: getComputedStyle(inner).backgroundColor
		};
	})()`);
	console.log("leftModeBg=" + JSON.stringify(leftBg));

	// 10) Switch to right mode.
	await evalJs(cdp, `(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "右面板"); if (b) b.click(); return !!b; })()`);
	await sleep(600);
	const rightBg = await evalJs(cdp, `(() => {
		const d = document.querySelector('[class$="_detailsCol"]');
		const inner = d.querySelector(':scope > div');
		return {
			colImage: getComputedStyle(d).backgroundImage.slice(0, 120),
			innerBg: getComputedStyle(inner).backgroundColor,
			detailsWidth: d.getBoundingClientRect().width
		};
	})()`);
	console.log("rightModeBg=" + JSON.stringify(rightBg));

	// 11) Disable again, confirm frame back to default.
	await evalJs(cdp, `(() => { const boxes = [...document.querySelectorAll('input[type="checkbox"]')]; const box = boxes.find((b) => b.closest("div")?.innerText?.includes("启用")); if (box && box.checked) box.click(); return !!box; })()`);
	await sleep(600);
	const offBg = await evalJs(cdp, `(() => {
		const f = document.querySelector('[class$="_frame"]');
		return getComputedStyle(f).backgroundImage.slice(0, 120);
	})()`);
	console.log("disabledFrameBg=" + JSON.stringify(offBg));

	console.log("consoleErrors=" + JSON.stringify(consoleErrors.slice(0, 5)));

	cdp.ws.close();
	process.exit(0);
})().catch((error) => {
	console.error("CDP-DRIVER FAILED: " + error.message);
	process.exit(1);
});
