// Smoke test for dsh-bg/lib/client.js: load the bundle in a stubbed browser
// context, exercise the pure CSS-generation surface, and drive apply() with a
// stubbed slots ctx to prove the plugin activates without throwing.
const fs = require("fs");
const vm = require("vm");

const src = fs.readFileSync("D:/deepseekharness/dsh-bg/lib/client.js", "utf8");

// --- stubbed browser context ---
let styleEl = null;
const dom = {
	styleEl: null,
	createElement(tag) {
		const el = { tagName: tag, id: "", textContent: "", isConnected: true };
		el.setAttribute = (k, v) => { el[k] = v; };
		el.appendChild = () => {};
		return el;
	}
};
const storage = new Map();
const sandbox = {
	window: { __ModuleLoader__: { load: (h) => { sandbox.h = h; } } },
	localStorage: {
		getItem: (k) => (storage.has(k) ? storage.get(k) : null),
		setItem: (k, v) => { storage.set(k, String(v)); },
		removeItem: (k) => { storage.delete(k); }
	},
	document: {
		getElementById: (id) => (id === "dsh-bg-style" ? dom.styleEl : null),
		createElement: (tag) => dom.createElement(tag),
		head: { appendChild: (el) => { dom.styleEl = el; } },
		querySelectorAll: () => []
	},
	crypto: require("crypto").webcrypto,
	console
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
if (!sandbox.h) throw new Error("bundle did not register a factory");
const mod = sandbox.h.factory((spec) => {
	if (spec === "react") return { createRef: () => ({}) };
	throw new Error("unexpected require: " + spec);
});
if (typeof mod.apply !== "function") throw new Error("apply missing");

let failed = 0;
const check = (name, cond, detail = "") => {
	if (cond) console.log(`ok   ${name}`);
	else { console.error(`FAIL ${name} ${detail}`); failed++; }
};

// --- pure CSS surface ---
const img = { id: "a", dataUrl: "data:image/png;base64,AAAA", name: "t" };
const base = mod.defaultConfig();
const cases = [
	["disabled", { ...base, enabled: false, imageId: "a", images: [img] }, ""],
	["no image", { ...base, enabled: true, imageId: null, images: [] }, ""],
	["left", { ...base, enabled: true, mode: "left", imageId: "a", images: [img], overlay: 0 }, ["[class$=\"_sidebarCol\"]", "transparent"]],
	["right", { ...base, enabled: true, mode: "right", imageId: "a", images: [img], overlay: 0.5 }, ["[class$=\"_detailsCol\"]", "transparent", "linear-gradient"]],
	["both", { ...base, enabled: true, mode: "both", imageId: "a", images: [img], overlay: 0.25 }, ["[class$=\"_frame\"]", "::before", "blur(", "opacity", "linear-gradient"]],
	["blur+opacity", { ...base, enabled: true, mode: "both", imageId: "a", images: [img], overlay: 0.2, blur: 12, imageOpacity: 0.5 }, ["blur(12px)", "opacity:0.500", "rgba(14,16,20,0.200)"]],
	["text gray", { ...base, enabled: true, mode: "both", imageId: "a", images: [img], overlay: 0.25, text: { enabled: true, rgbMode: false, gray: 200 } }, ["--dsw-alias-label-primary:rgba(200,200,200,1)", "--dsw-alias-label-secondary:rgba(200,200,200,0.75)"]],
	["text rgb", { ...base, enabled: true, mode: "left", imageId: "a", images: [img], overlay: 0, text: { enabled: true, rgbMode: true, r: 10, g: 200, b: 30 } }, ["--dsw-alias-label-primary:rgba(10,200,30,1)", "rgba(10,200,30,0.55)"]],
	["text off", { ...base, enabled: true, mode: "left", imageId: "a", images: [img], overlay: 0, text: { enabled: false, rgbMode: false, gray: 200 } }, ["[class$=\"_sidebarCol\"]", "!--dsw-alias-label-"]]
];
for (const [name, cfg, expect] of cases) {
	const css = mod.cssFor(cfg);
	if (expect === "") check(`${name}: no override`, css === "", `got: ${css}`);
	else {
		const missing = expect.filter((t) => (t.startsWith("!") ? css.includes(t.slice(1)) : !css.includes(t)));
		check(`${name}: rules`, missing.length === 0, `bad: ${missing.join(",")}`);
	}
}

// --- MP4 wallpaper: isVideo suppresses the ::before image layer ---
const videoCss = mod.cssFor({ ...base, enabled: true, mode: "both", imageId: "v", images: [{ id: "v", name: "v", kind: "video" }], overlay: 0.3 }, true);
check("video: no ::before image", !videoCss.includes("::before{content"));
check("video: surface present", videoCss.includes("[class$=\"_frame\"]"));
check("video: overlay ::after present", videoCss.includes("::after{content"));
const videoOff = mod.cssFor({ ...base, enabled: false, imageId: "v", images: [{ id: "v", name: "v", kind: "video" }] }, true);
check("video: disabled yields nothing", videoOff === "");

// --- apply() activation with a persisted enabled config ---
const persisted = { enabled: true, mode: "both", imageId: "a", overlay: 0.25, images: [img] };
storage.set("dsh-bg:config", JSON.stringify(persisted));
let registered = null;
const ctx = {
	slots: {
		register: (options, component) => {
			registered = { options, component };
			return () => {};
		},
		inject: (name, callback) => {
			check("slots.inject target", name === "settings.general.item", name);
			callback();
		}
	}
};
try {
	mod.apply(ctx);
	check("apply() ran without throwing", true);
} catch (error) {
	check("apply() ran without throwing", false, String(error));
}
check("style element created", dom.styleEl !== null);
check("style tagged data-plugin", dom.styleEl !== null && dom.styleEl["data-plugin"] === "dsh-bg");
check("style carries both-mode css", dom.styleEl !== null && typeof dom.styleEl.textContent === "string" && dom.styleEl.textContent.includes("[class$=\"_frame\"]"));
check("slot registration captured", registered !== null);
if (registered !== null) {
	check("slot id", registered.options.id === "dsh-bg", JSON.stringify(registered.options));
	check("slot name", registered.options.name === "settings.general.item");
	check("slot order under appearance", registered.options.order === 11, String(registered.options.order));
	check("slot component", typeof registered.component === "function");
}

// --- apply() with no persisted config must not throw ---
storage.delete("dsh-bg:config");
try {
	mod.apply(ctx);
	check("apply() with empty config ok", true);
} catch (error) {
	check("apply() with empty config ok", false, String(error));
}

process.exit(failed === 0 ? 0 : 1);
