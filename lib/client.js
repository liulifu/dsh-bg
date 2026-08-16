window.__ModuleLoader__.load({
	id: "dsh-bg",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region config
		/** localStorage key holding the whole dsh-bg state (config + image library). */
		const CONFIG_KEY = "dsh-bg:config";
		/** Soft cap on one stored data-URL (keeps localStorage far under the 5MB quota). */
		const MAX_IMAGE_BYTES = 3.5e6;
		/** Cap on the library size (guards the quota across many images). */
		const MAX_IMAGES = 8;
		/** Dark overlay applied over the image so panel text stays readable. */
		const OVERLAY_COLOR = "14,16,20";
		/**
		* Built-in sample background (an inline SVG aurora gradient) so the three
		* modes can be tried immediately without uploading; deletable like any
		* library entry.
		*/
		const SAMPLE_ID = "sample-aurora";
		const SAMPLE_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900' viewBox='0 0 1600 900'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#12233f'/><stop offset='0.5' stop-color='#29386b'/><stop offset='1' stop-color='#523b6e'/></linearGradient></defs><rect width='1600' height='900' fill='url(#g)'/><circle cx='380' cy='180' r='280' fill='rgba(120,180,255,0.14)'/><circle cx='1240' cy='660' r='340' fill='rgba(255,150,200,0.12)'/><circle cx='860' cy='320' r='200' fill='rgba(140,220,255,0.10)'/><circle cx='150' cy='760' r='220' fill='rgba(255,255,255,0.05)'/></svg>";
		const SAMPLE_DATA_URL = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(SAMPLE_SVG);
		/**
		* Default state: background off, seamless mode, one built-in sample
		* selected, 25% overlay, text-color adjustment off (white grayscale when
		* enabled).
		* @returns a fresh deep copy (the config is mutated immutably by callers).
		*/
		function defaultConfig() {
			return {
				enabled: false,
				mode: "both",
				imageId: SAMPLE_ID,
				overlay: 0.25,
				blur: 0,
				imageOpacity: 1,
				images: [{
					id: SAMPLE_ID,
					name: "示例背景（可删除）",
					dataUrl: SAMPLE_DATA_URL,
					addedAt: 0
				}],
				text: {
					enabled: false,
					rgbMode: false,
					gray: 255,
					r: 255,
					g: 255,
					b: 255
				}
			};
		}
		/**
		* Read persisted state, falling back to defaults on any failure.
		* @returns the loaded config (never null).
		*/
		function loadConfig() {
			try {
				const raw = localStorage.getItem(CONFIG_KEY);
				if (raw === null) return defaultConfig();
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null) return defaultConfig();
				return { ...defaultConfig(), ...parsed };
			} catch (error) {
				console.warn("dsh-bg: failed to load config", error);
				return defaultConfig();
			}
		}
		/**
		* Persist state; throws on quota/other storage failure (the UI surfaces it).
		* @param config - the state to persist.
		*/
		function saveConfig(config) {
			localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
		}
		//#endregion

		//#region css engine
		/**
		* The layout classes are CSS-Module hashes (`pI_x6G_sidebarCol`), so they
		* are matched by their stable LOCAL-name suffix instead of the full hash:
		* `[class$="_sidebarCol"]` survives rebuilds of ui-layout while the hash
		* prefix changes. The direct-child divs are the opaque inner roots
		* (SidebarRoot / ConversationRoot / DetailsPanel) that repaint their own
		* background and would otherwise cover the column image.
		* The frame is disambiguated with :has() — other plugins (subagent,
		* user-questions) also emit `*_frame` classes for their own dialogs, and
		* only the AppFrame grid contains a `_sidebarCol` child.
		*/
		const SEL = {
			frame: '[class$="_frame"]:has(> [class$="_sidebarCol"])',
			leftCol: '[class$="_sidebarCol"]',
			leftInner: '[class$="_sidebarCol"] > div',
			centerCol: '[class$="_centerCol"]',
			centerInner: '[class$="_centerCol"] > div',
			rightCol: '[class$="_detailsCol"]',
			rightInner: '[class$="_detailsCol"] > div'
		};
		/**
		* The settings menu renders inside the sidebar column (its panel is the
		* only `*_panel` element in the app), so the blanket transparency would
		* make it see-through. These exclusions keep the settings panel — and
		* everything inside it — untouched: the element itself must not end in
		* `_panel`, and it must not have a `*_panel` ancestor.
		*/
		const NOT_SETTINGS_PANEL = ':not([class$="_panel"]):not([class$="_panel"] *)';
		/** The style element owning every dsh-bg rule (HMR removes it by data-plugin). */
		const STYLE_ID = "dsh-bg-style";
		let styleEl = null;
		/**
		* Get (or create) the plugin-owned style element, tagged data-plugin so the
		* HMR reload chain removes it together with the module's other styles.
		* @returns the style element.
		*/
		function ensureStyleEl() {
			if (styleEl !== null && styleEl.isConnected) return styleEl;
			styleEl = document.getElementById(STYLE_ID);
			if (styleEl === null) {
				styleEl = document.createElement("style");
				styleEl.id = STYLE_ID;
				styleEl.setAttribute("data-plugin", "dsh-bg");
				document.head.appendChild(styleEl);
			}
			return styleEl;
		}
		/**
		* Build the background stack: optional dark overlay gradient over the image.
		* @param dataUrl - the selected image as a data URL.
		* @param overlay - dark overlay opacity in [0, 0.8].
		* @returns the CSS background value.
		*/
		function bgStack(dataUrl, overlay) {
			const base = `url("${dataUrl}")`;
			if (overlay <= 0) return base;
			const o = overlay.toFixed(3);
			return `linear-gradient(rgba(${OVERLAY_COLOR},${o}),rgba(${OVERLAY_COLOR},${o})),${base}`;
		}
		/**
		* Clamp a number into a range.
		* @param value - the value.
		* @param min - lower bound.
		* @param max - upper bound.
		* @returns the clamped value.
		*/
		function clampNum(value, min, max) {
			const n = Number(value);
			return Math.min(max, Math.max(min, Number.isFinite(n) ? n : max));
		}
		/**
		* Compose the complete override stylesheet for a config.
		* Empty string means "no override" (default theme background).
		*
		* Images are painted on the surface's ::before pseudo-element so blur and
		* opacity apply to the picture only (never to the text above it); MP4
		* wallpapers are rendered by a real <video> element managed in applyVideo,
		* so isVideo suppresses the ::before image layer. The dark readability
		* overlay lives on ::after. The surface gets position:relative + z-index:0
		* (its own stacking context) so the z-index:-1 layers sit behind the panel
		* content but above the surface background — and the settings menu (the
		* only *_panel element) stays fully opaque.
		* @param config - current state.
		* @param isVideo - whether the active wallpaper is an MP4 (no ::before image).
		* @returns the CSS text ("" when the background is off or no entry is chosen).
		*/
		function cssFor(config, isVideo) {
			const entry = config.images.find((item) => item.id === config.imageId);
			if (config.enabled !== true || entry === void 0) return "";
			const overlay = clampNum(config.overlay, 0, 0.8);
			const blur = clampNum(config.blur, 0, 40);
			const opacity = clampNum(config.imageOpacity ?? 1, 0, 1);
			const rules = [];
			// the surface that carries the background in the active mode
			const surface = config.mode === "left" ? SEL.leftCol : config.mode === "right" ? SEL.rightCol : SEL.frame;
			// 1) surface: own stacking context, no own background
			rules.push(`${surface}{position:relative;z-index:0;background:transparent !important}`);
			// 2) the picture layer (images only): blur + opacity apply to the image alone
			if (isVideo !== true) {
				rules.push(`${surface}::before{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background:url("${entry.dataUrl}") center / cover no-repeat !important;filter:blur(${blur}px);opacity:${opacity.toFixed(3)}}`);
			}
			// 3) the dark readability overlay, above the image / video
			if (overlay > 0) {
				const o = overlay.toFixed(3);
				rules.push(`${surface}::after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background:linear-gradient(rgba(${OVERLAY_COLOR},${o}),rgba(${OVERLAY_COLOR},${o})) !important}`);
			}
			// 4) make the surfaces inside the columns transparent (settings panel excluded)
			if (config.mode === "left") {
				rules.push(`${SEL.leftCol} *${NOT_SETTINGS_PANEL}{background:transparent !important}`);
			} else if (config.mode === "right") {
				rules.push(`${SEL.rightCol} *${NOT_SETTINGS_PANEL}{background:transparent !important}`);
			} else {
				rules.push([
					SEL.leftCol, SEL.centerCol, SEL.rightCol,
					`${SEL.leftCol} *${NOT_SETTINGS_PANEL}`, `${SEL.centerCol} *${NOT_SETTINGS_PANEL}`, `${SEL.rightCol} *${NOT_SETTINGS_PANEL}`
				].join(",") + "{background:transparent !important}");
			}
			const textCss = textColorRule(config);
			if (textCss !== "") rules.push(textCss);
			return rules.join("\n");
		}
		/**
		* The text-color override for the surfaces that carry the background:
		* the theme label tokens are re-declared on the panel scope so all text
		* inside resolves to the chosen color. Secondary/tertiary/caption keep a
		* transparency hierarchy derived from the chosen color.
		* @param config - current state.
		* @returns the CSS rule, or "" when text adjustment is off.
		*/
		function textColorRule(config) {
			const text = config.text;
			if (text?.enabled !== true) return "";
			const scope = config.mode === "left"
				? SEL.leftCol
				: config.mode === "right" ? SEL.rightCol : `${SEL.leftCol},${SEL.centerCol},${SEL.rightCol}`;
			const rgba = (alpha) => text.rgbMode === true
				? `rgba(${clampByte(text.r)},${clampByte(text.g)},${clampByte(text.b)},${alpha})`
				: `rgba(${clampByte(text.gray)},${clampByte(text.gray)},${clampByte(text.gray)},${alpha})`;
			let css = `${scope}{--dsw-alias-label-primary:${rgba(1)};--dsw-alias-label-secondary:${rgba(0.75)};--dsw-alias-label-tertiary:${rgba(0.55)};--dsw-alias-label-caption:${rgba(0.45)}}`;
			// The settings menu keeps its own background, so its text must stay on
			// the theme's original label colors (read from the body's computed
			// style — correct in both light and dark themes). :is() keeps the
			// comma-list scope from leaking into the descendant combinator.
			if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
				const read = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
				const primary = read("--dsw-alias-label-primary");
				const secondary = read("--dsw-alias-label-secondary") || primary;
				const tertiary = read("--dsw-alias-label-tertiary") || primary;
				const caption = read("--dsw-alias-label-caption") || primary;
				if (primary !== "") {
					css += `:is(${scope}) [class$="_panel"]{--dsw-alias-label-primary:${primary};--dsw-alias-label-secondary:${secondary};--dsw-alias-label-tertiary:${tertiary};--dsw-alias-label-caption:${caption}}`;
				}
			}
			return css;
		}
		/** Clamp a color channel into [0, 255]. */
		function clampByte(value) {
			const n = Number(value);
			return Math.min(255, Math.max(0, Number.isFinite(n) ? Math.round(n) : 255));
		}
		/** The background <video> element (MP4 wallpaper), created on demand. */
		let videoEl = null;
		/** Pending retry timer for waiting on the layout surface to render. */
		let videoRetryTimer = null;
		/** Cap on surface-wait retries (10s). */
		let videoRetryCount = 0;
		/**
		* Manage the MP4 wallpaper: create / reposition / pause the background
		* video according to the config. The video is appended INSIDE the active
		* surface (frame for seamless mode, the column otherwise) at z-index:-1 so
		* it sits behind the panel content; blur + opacity apply to the element
		* itself, while the dark overlay and text colors come from the stylesheet.
		* The layout renders after plugin activation, so a missing surface retries
		* until it appears.
		* @param config - current state.
		*/
		async function applyVideo(config) {
			if (videoRetryTimer !== null) {
				clearTimeout(videoRetryTimer);
				videoRetryTimer = null;
			}
			const entry = config.images.find((item) => item.id === config.imageId);
			const wantVideo = config.enabled === true && entry?.kind === "video";
			if (!wantVideo) {
				videoRetryCount = 0;
				if (videoEl !== null) {
					videoEl.pause();
					videoEl.remove();
					videoEl = null;
				}
				return;
			}
			if (typeof document === "undefined") return;
			const surfaceSel = config.mode === "left" ? SEL.leftCol : config.mode === "right" ? SEL.rightCol : SEL.frame;
			const surface = document.querySelector(surfaceSel);
			if (surface === null) {
				if (videoRetryCount < 20) {
					videoRetryCount += 1;
					videoRetryTimer = setTimeout(() => {
						void applyVideo(config);
					}, 500);
				}
				return;
			}
			videoRetryCount = 0;
			if (videoEl === null) {
				videoEl = document.getElementById("dsh-bg-video");
				if (videoEl === null) {
					videoEl = document.createElement("video");
					videoEl.id = "dsh-bg-video";
					videoEl.muted = true;
					videoEl.loop = true;
					videoEl.autoplay = true;
					videoEl.playsInline = true;
					videoEl.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;z-index:-1;";
				}
			}
			videoEl.style.filter = `blur(${clampNum(config.blur, 0, 40)}px)`;
			videoEl.style.opacity = String(clampNum(config.imageOpacity ?? 1, 0, 1));
			if (videoEl.parentElement !== surface) surface.appendChild(videoEl);
			const url = await videoObjectUrl(entry);
			if (url !== null && videoEl.src !== url) {
				videoEl.src = url;
				videoEl.load();
			}
			videoEl.play().catch(() => {});
		}
		/**
		* Project a config onto the page: rewrite the stylesheet and (re)position
		* the MP4 wallpaper element.
		* @param config - current state.
		*/
		function applyConfig(config) {
			const entry = config.images.find((item) => item.id === config.imageId);
			const isVideo = config.enabled === true && entry?.kind === "video";
			ensureStyleEl().textContent = cssFor(config, isVideo);
			void applyVideo(config);
		}
		//#endregion

		//#region media library helpers
		/** Soft cap on one stored MP4 blob (IndexedDB can hold far more; this guards abuse). */
		const MAX_VIDEO_BYTES = 300e6;
		/** IndexedDB name + store for media blobs (videos). */
		const IDB_NAME = "dsh-bg";
		const IDB_STORE = "media";
		/** Cache of entry id → object URL for video blobs. */
		const videoUrlCache = /* @__PURE__ */ new Map();
		/**
		* Open the media IndexedDB (creates the store on first use).
		* @returns the DB connection.
		*/
		function openMediaDb() {
			return new Promise((resolve, reject) => {
				const request = indexedDB.open(IDB_NAME, 1);
				request.onupgradeneeded = () => {
					request.result.createObjectStore(IDB_STORE, { keyPath: "id" });
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
			});
		}
		/**
		* Store a media blob under an id.
		* @param id - the library entry id.
		* @param blob - the media blob.
		*/
		async function idbPut(id, blob) {
			const db = await openMediaDb();
			await new Promise((resolve, reject) => {
				const tx = db.transaction(IDB_STORE, "readwrite");
				tx.objectStore(IDB_STORE).put({ id, blob });
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
			});
		}
		/**
		* Read a stored media blob.
		* @param id - the library entry id.
		* @returns the blob, or null.
		*/
		async function idbGet(id) {
			const db = await openMediaDb();
			return await new Promise((resolve, reject) => {
				const request = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(id);
				request.onsuccess = () => resolve(request.result?.blob ?? null);
				request.onerror = () => reject(request.error ?? new Error("indexedDB get failed"));
			});
		}
		/**
		* Delete a stored media blob.
		* @param id - the library entry id.
		*/
		async function idbDelete(id) {
			const db = await openMediaDb();
			await new Promise((resolve, reject) => {
				const tx = db.transaction(IDB_STORE, "readwrite");
				tx.objectStore(IDB_STORE).delete(id);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error("indexedDB delete failed"));
			});
		}
		/**
		* Read a File as a data URL.
		* @param file - the image file.
		* @returns the data URL.
		*/
		function readFileAsDataUrl(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result);
				reader.onerror = () => reject(reader.error ?? new Error("read failed"));
				reader.readAsDataURL(file);
			});
		}
		/**
		* Unique id generator with a fallback for browsers without crypto.randomUUID.
		* @returns a unique id string.
		*/
		function nextId() {
			if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
			return `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
		}
		/**
		* Import files into the library: images (data URL, localStorage config) and
		* MP4 videos (blob in IndexedDB, entry kind "video"); the last accepted
		* entry becomes the selection.
		* @param config - current state.
		* @param files - FileList or File[] from the picker / paste.
		* @returns a new config, or the same reference when nothing was accepted.
		*/
		async function importMedia(config, files) {
			const candidates = [...files].filter((file) => file.type.startsWith("image/") || file.type === "video/mp4");
			if (candidates.length === 0) return config;
			let next = config;
			let lastId = null;
			for (const file of candidates) {
				if (next.images.length >= MAX_IMAGES) {
					console.warn("dsh-bg: library is full (max 8)");
					break;
				}
				const id = nextId();
				let entry;
				if (file.type === "video/mp4") {
					if (file.size > MAX_VIDEO_BYTES) {
						console.warn(`dsh-bg: ${file.name} exceeds the 300MB video cap`);
						continue;
					}
					try {
						await idbPut(id, file);
					} catch (error) {
						console.warn("dsh-bg: could not store video", error);
						continue;
					}
					entry = { id, name: file.name || id, kind: "video", addedAt: Date.now() };
				} else {
					let dataUrl;
					try {
						dataUrl = await readFileAsDataUrl(file);
					} catch (error) {
						console.warn("dsh-bg: could not read image", file.name, error);
						continue;
					}
					if (dataUrl.length > MAX_IMAGE_BYTES) {
						console.warn(`dsh-bg: ${file.name} is too large to store (limit ~3.4MB)`);
						continue;
					}
					entry = { id, name: file.name || id, dataUrl, addedAt: Date.now() };
				}
				next = { ...next, images: [...next.images, entry] };
				lastId = id;
			}
			if (lastId !== null) next = { ...next, imageId: lastId };
			return next;
		}
		/**
		* Remove one library entry (clears the selection when it was selected; also
		* drops the IndexedDB blob for videos).
		* @param config - current state.
		* @param id - the entry to remove.
		* @returns the new config.
		*/
		function removeEntry(config, id) {
			const images = config.images.filter((entry) => entry.id !== id);
			const imageId = config.imageId === id ? null : config.imageId;
			const removed = config.images.find((entry) => entry.id === id);
			if (removed?.kind === "video") {
				const url = videoUrlCache.get(id);
				if (url !== void 0) {
					URL.revokeObjectURL(url);
					videoUrlCache.delete(id);
				}
				void idbDelete(id).catch(() => {});
			}
			return { ...config, images, imageId };
		}
		/**
		* Resolve the playable object URL for a video entry (cached; reads the blob
		* from IndexedDB on first use).
		* @param entry - the library entry.
		* @returns the object URL, or null when the blob is missing.
		*/
		async function videoObjectUrl(entry) {
			if (entry?.kind !== "video") return null;
			const cached = videoUrlCache.get(entry.id);
			if (cached !== void 0) return cached;
			try {
				const blob = await idbGet(entry.id);
				if (blob === null) return null;
				const url = URL.createObjectURL(blob);
				videoUrlCache.set(entry.id, url);
				return url;
			} catch (error) {
				console.warn("dsh-bg: could not load video", error);
				return null;
			}
		}
		//#endregion

		//#region settings row
		/** Segmented mode options (key → label). */
		const MODES = [
			{ key: "left", label: "左面板", hint: "仅更换左侧固定面板（会话列表）背景" },
			{ key: "right", label: "右面板", hint: "仅更换右侧抽拉面板（工具检查）背景" },
			{ key: "both", label: "左右无缝", hint: "左右面板显示同一张图，整屏无缝衔接为一张图" }
		];
		/** Row group style, matching the Appearance row directly above it. */
		const groupStyle = {
			display: "flex",
			flexDirection: "column",
			gap: "10px",
			padding: "16px 0",
			borderBottom: "1px solid var(--dsw-alias-border-l2)",
			fontSize: "13px",
			lineHeight: "20px",
			color: "var(--dsw-alias-label-primary)"
		};
		const titleRowStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: "8px"
		};
		const titleStyle = {
			color: "var(--dsw-alias-label-primary)",
			fontSize: "14px",
			fontWeight: 400,
			lineHeight: "22px"
		};
		const titleActionsStyle = {
			display: "flex",
			alignItems: "center",
			gap: "10px"
		};
		const ghostBtnStyle = {
			border: "none",
			background: "transparent",
			cursor: "pointer",
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: "12px",
			lineHeight: "16px",
			padding: "2px 4px",
			borderRadius: "6px"
		};
		const segRowStyle = {
			display: "flex",
			gap: "6px"
		};
		const segStyle = (active) => ({
			flex: 1,
			cursor: "pointer",
			border: `1px solid ${active ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-border-l2)"}`,
			borderRadius: "8px",
			background: active ? "var(--dsw-alias-interactive-bg-hover-accent)" : "transparent",
			color: active ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)",
			padding: "6px 4px",
			fontSize: "12px",
			lineHeight: "16px",
			textAlign: "center"
		});
		const hintStyle = {
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: "11px",
			lineHeight: "16px"
		};
		/**
		* Current-background preview: a mini three-column mock of the real layout
		* (sidebar | conversation | details). The image is painted on the surfaces
		* the active mode targets — the whole box in seamless mode, one segment in
		* the single-panel modes — so the preview always mirrors what the page does.
		*/
		const previewStyle = {
			height: "96px",
			borderRadius: "10px",
			overflow: "hidden",
			display: "flex",
			position: "relative",
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-layer-1)"
		};
		/** One mock column inside the preview (flex weight mirrors the real grid). */
		const previewSegment = (flex, last) => ({
			flex: String(flex),
			minWidth: "0",
			height: "100%",
			borderRight: last ? "none" : "1px solid var(--dsw-alias-border-l2)",
			backgroundPosition: "center",
			backgroundSize: "cover",
			backgroundRepeat: "no-repeat"
		});
		const previewEmptyStyle = {
			position: "absolute",
			inset: "0",
			display: "grid",
			placeItems: "center",
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: "12px",
			lineHeight: "16px",
			textAlign: "center",
			padding: "0 8px"
		};
		const libRowStyle = {
			display: "flex",
			flexWrap: "wrap",
			gap: "8px",
			alignItems: "center"
		};
		const thumbWrapStyle = {
			position: "relative",
			width: "64px",
			height: "40px",
			borderRadius: "8px",
			overflow: "hidden",
			cursor: "pointer",
			border: "2px solid var(--dsw-alias-border-l2)",
			flex: "none"
		};
		const thumbSelStyle = {
			border: "2px solid var(--dsw-alias-brand-primary)"
		};
		const thumbStyle = {
			width: "100%",
			height: "100%",
			objectFit: "cover",
			display: "block"
		};
		const thumbDelStyle = {
			position: "absolute",
			top: "2px",
			right: "2px",
			width: "16px",
			height: "16px",
			borderRadius: "50%",
			border: "none",
			background: "rgba(0,0,0,0.6)",
			color: "#fff",
			fontSize: "10px",
			lineHeight: "1",
			cursor: "pointer",
			padding: "0",
			display: "grid",
			placeItems: "center"
		};
		/** Text-color sub-section: separated from the background controls by a rule. */
		const textSectionStyle = {
			borderTop: "1px solid var(--dsw-alias-border-l2)",
			paddingTop: "10px",
			display: "flex",
			flexDirection: "column",
			gap: "8px"
		};
		const subLabelStyle = {
			color: "var(--dsw-alias-label-primary)",
			fontSize: "13px",
			fontWeight: 500,
			lineHeight: "20px"
		};
		const sliderLabelStyle = {
			flex: "none",
			minWidth: "76px",
			color: "var(--dsw-alias-label-secondary)",
			fontSize: "12px",
			lineHeight: "16px"
		};
		const toggleLabelStyle = {
			display: "flex",
			alignItems: "center",
			gap: "6px",
			cursor: "pointer",
			color: "var(--dsw-alias-label-secondary)",
			fontSize: "12px",
			lineHeight: "16px"
		};
		const uploadBtnStyle = {
			flex: "none",
			width: "64px",
			height: "40px",
			borderRadius: "8px",
			border: "1px dashed var(--dsw-alias-border-l3)",
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			cursor: "pointer",
			fontSize: "20px"
		};
		const sliderRowStyle = {
			display: "flex",
			alignItems: "center",
			gap: "10px"
		};
		const sliderStyle = {
			flex: 1,
			accentColor: "var(--dsw-alias-brand-primary)"
		};
		const errorStyle = {
			color: "var(--dsw-alias-state-error-primary)",
			fontSize: "11px",
			lineHeight: "16px"
		};
		/** Ref holding the latest config for the async import path. */
		const fileInputRef = react.createRef();
		/**
		* The Background row, placed directly under the Appearance row in the
		* General section: a live preview of the current background (a mini mock
		* of the three-column layout), the three-mode selector, the image library
		* (upload / paste / thumbnails / delete), the overlay slider, and the
		* enable / remove-background controls. State lives in the config object
		* mirrored to localStorage.
		* @returns the row element.
		*/
		function BackgroundRow() {
			const [config, setConfig] = react.useState(loadConfig);
			const [saveError, setSaveError] = react.useState(null);
			const [videoUrls, setVideoUrls] = react.useState({});
			const configRef = react.useRef(config);
			react.useEffect(() => {
				configRef.current = config;
				try {
					saveConfig(config);
					setSaveError(null);
				} catch (error) {
					setSaveError(String(error?.message ?? error));
				}
				applyConfig(config);
			}, [config]);
			// Load object URLs for video entries (thumbnails + preview).
			react.useEffect(() => {
				let cancelled = false;
				(async () => {
					const map = {};
					for (const entry of config.images) {
						if (entry.kind === "video") {
							const url = await videoObjectUrl(entry);
							if (!cancelled && url !== null) map[entry.id] = url;
						}
					}
					if (!cancelled) setVideoUrls(map);
				})();
				return () => { cancelled = true; };
			}, [config.images]);
			const update = (patch) => setConfig((previous) => ({ ...previous, ...patch }));
			const handleFiles = async (files) => {
				const next = await importMedia(configRef.current, files);
				if (next !== configRef.current) setConfig(next);
			};
			const handlePaste = (event) => {
				const items = event.clipboardData?.items;
				if (!items) return;
				const files = [];
				for (const item of items) {
					const file = item.kind === "file" ? item.getAsFile() : null;
					if (file !== null && (file.type.startsWith("image/") || file.type === "video/mp4")) files.push(file);
				}
				if (files.length > 0) {
					event.preventDefault();
					void handleFiles(files);
				}
			};
			const selected = config.images.find((entry) => entry.id === config.imageId);
			const modeHint = MODES.find((m) => m.key === config.mode)?.hint ?? "";
			const active = config.enabled === true && selected !== void 0;
			const isVideo = selected?.kind === "video";
			const selectedUrl = isVideo ? (videoUrls[selected.id] ?? null) : null;
			const stack = active && !isVideo ? bgStack(selected.dataUrl, config.overlay) : "";
			// Preview surfaces mirror the active mode: the whole box in seamless
			// mode, one segment in the single-panel modes (videos cover the box).
			const previewImage = config.mode === "both" && active && !isVideo
				? { backgroundImage: stack, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }
				: null;
			const segmentImage = (key) => {
				if (!active || isVideo) return null;
				if ((config.mode === "left" && key === "sidebar") || (config.mode === "right" && key === "details")) {
					return { backgroundImage: stack, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
				}
				return null;
			};
			const previewStatus = !active
				? (selected !== void 0 ? "背景已停用" : "未设置背景，上传或选择一张图片")
				: (isVideo && selectedUrl === null ? "视频数据缺失" : null);
			const videoPreview = active && isVideo && selectedUrl !== null
				? react.createElement("video", {
					src: selectedUrl,
					muted: true,
					loop: true,
					autoPlay: true,
					playsInline: true,
					style: { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover" }
				})
				: null;
			// Text-color adjustment state (merged over defaults for old saved configs).
			const text = { enabled: false, rgbMode: false, gray: 255, r: 255, g: 255, b: 255, ...(config.text ?? {}) };
			const setText = (patch) => setConfig((previous) => ({ ...previous, text: { ...text, ...patch } }));
			const textColor = text.rgbMode === true
				? `rgb(${clampByte(text.r)},${clampByte(text.g)},${clampByte(text.b)})`
				: `rgb(${clampByte(text.gray)},${clampByte(text.gray)},${clampByte(text.gray)})`;
			const textChannels = [
				{ key: "r", label: "R 红" },
				{ key: "g", label: "G 绿" },
				{ key: "b", label: "B 蓝" }
			];
			return react.createElement("div", { style: groupStyle, onPaste: handlePaste },
				react.createElement("div", { style: titleRowStyle },
					react.createElement("span", { style: titleStyle }, "背景"),
					react.createElement("div", { style: titleActionsStyle },
						react.createElement("label", { style: { display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: "var(--dsw-alias-label-secondary)", fontSize: "12px" } },
							react.createElement("input", {
								type: "checkbox",
								checked: config.enabled === true,
								onChange: (event) => update({ enabled: event.target.checked }),
								style: { accentColor: "var(--dsw-alias-brand-primary)" }
							}),
							"启用"
						),
						react.createElement("button", {
							type: "button",
							style: ghostBtnStyle,
							title: "移除当前背景",
							onClick: () => setConfig((previous) => ({ ...previous, enabled: false, imageId: null }))
						}, "移除背景")
					)
				),
				react.createElement("div", { style: previewStyle },
					previewImage !== null && react.createElement("div", {
						style: { position: "absolute", inset: "0", ...previewImage }
					}),
					videoPreview,
					[
						{ key: "sidebar", flex: 1.4 },
						{ key: "center", flex: 3 },
						{ key: "details", flex: 1.8 }
					].map((segment, index) => react.createElement("div", {
						key: segment.key,
						style: { ...previewSegment(segment.flex, index === 2), ...segmentImage(segment.key) }
					})),
					previewStatus !== null && react.createElement("div", { style: previewEmptyStyle }, previewStatus)
				),
				react.createElement("div", { style: segRowStyle },
					MODES.map((mode) => react.createElement("button", {
						key: mode.key,
						type: "button",
						style: segStyle(config.mode === mode.key),
						onClick: () => update({ mode: mode.key })
					}, mode.label))
				),
				react.createElement("div", { style: hintStyle }, modeHint),
				react.createElement("div", { style: libRowStyle },
					config.images.map((image) => react.createElement("div", {
						key: image.id,
						style: { ...thumbWrapStyle, ...(image.id === config.imageId ? thumbSelStyle : null) },
						title: image.name,
						onClick: () => update({ imageId: image.id })
					},
						image.kind === "video"
							? (videoUrls[image.id] !== void 0
								? react.createElement("video", { src: videoUrls[image.id], muted: true, preload: "metadata", style: thumbStyle })
								: react.createElement("div", { style: { ...thumbStyle, display: "grid", placeItems: "center", color: "var(--dsw-alias-label-tertiary)", fontSize: "10px" } }, "MP4"))
							: react.createElement("img", { src: image.dataUrl, alt: image.name, style: thumbStyle }),
						image.kind === "video" ? react.createElement("span", {
							style: { position: "absolute", bottom: "2px", right: "2px", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: "9px", lineHeight: "1", padding: "1px 3px", borderRadius: "3px" }
						}, "MP4") : null,
						react.createElement("button", {
							type: "button",
							style: thumbDelStyle,
							title: "删除",
							onClick: (event) => {
								event.stopPropagation();
								setConfig((previous) => removeEntry(previous, image.id));
							}
						}, "×")
					)),
					react.createElement("button", {
						type: "button",
						style: uploadBtnStyle,
						title: "上传背景图片或 MP4 视频（也可粘贴图片）",
						onClick: () => fileInputRef.current?.click()
					}, "＋"),
					react.createElement("input", {
						ref: fileInputRef,
						type: "file",
						accept: "image/*,video/mp4",
						multiple: true,
						style: { display: "none" },
						onChange: (event) => {
							const files = event.target.files;
							if (files && files.length > 0) void handleFiles(files);
							event.target.value = "";
						}
					})
				),
				selected === void 0 && config.images.length === 0 ? react.createElement("div", { style: hintStyle }, "上传或粘贴图片 / MP4 视频即可开始（最多 8 项）") : null,
				react.createElement("div", { style: sliderRowStyle },
					react.createElement("span", { style: { flex: "none", color: "var(--dsw-alias-label-secondary)" } }, `压暗遮罩 ${Math.round(config.overlay * 100)}%`),
					react.createElement("input", {
						type: "range",
						min: 0,
						max: 0.8,
						step: 0.05,
						value: config.overlay,
						style: sliderStyle,
						onChange: (event) => update({ overlay: Number(event.target.value) })
					})
				),
				react.createElement("div", { style: sliderRowStyle },
					react.createElement("span", { style: { flex: "none", color: "var(--dsw-alias-label-secondary)" } }, `图片不透明度 ${Math.round((config.imageOpacity ?? 1) * 100)}%`),
					react.createElement("input", {
						type: "range",
						min: 0,
						max: 1,
						step: 0.05,
						value: config.imageOpacity ?? 1,
						style: sliderStyle,
						onChange: (event) => update({ imageOpacity: Number(event.target.value) })
					})
				),
				react.createElement("div", { style: sliderRowStyle },
					react.createElement("span", { style: { flex: "none", color: "var(--dsw-alias-label-secondary)" } }, `模糊度 ${Math.round(config.blur ?? 0)}px`),
					react.createElement("input", {
						type: "range",
						min: 0,
						max: 24,
						step: 1,
						value: config.blur ?? 0,
						style: sliderStyle,
						onChange: (event) => update({ blur: Number(event.target.value) })
					})
				),
				react.createElement("div", { style: textSectionStyle },
					react.createElement("div", { style: titleRowStyle },
						react.createElement("span", { style: subLabelStyle }, "文字颜色"),
						react.createElement("div", { style: titleActionsStyle },
							react.createElement("span", { style: { color: textColor, fontWeight: 700, fontSize: "15px", lineHeight: "16px" } }, "Aa"),
							react.createElement("label", { style: toggleLabelStyle },
								react.createElement("input", {
									type: "checkbox",
									checked: text.enabled === true,
									onChange: (event) => setText({ enabled: event.target.checked }),
									style: { accentColor: "var(--dsw-alias-brand-primary)" }
								}),
								"调整"
							)
						)
					),
					text.enabled === true ? react.createElement(react.Fragment, null,
						text.rgbMode !== true ? react.createElement("div", { style: sliderRowStyle },
							react.createElement("span", { style: sliderLabelStyle }, `灰度 ${clampByte(text.gray)}`),
							react.createElement("input", {
								type: "range",
								min: 0,
								max: 255,
								step: 1,
								value: clampByte(text.gray),
								style: sliderStyle,
								onChange: (event) => setText({ gray: Number(event.target.value) })
							})
						) : null,
						react.createElement("label", { style: toggleLabelStyle },
							react.createElement("input", {
								type: "checkbox",
								checked: text.rgbMode === true,
								onChange: (event) => setText({ rgbMode: event.target.checked }),
								style: { accentColor: "var(--dsw-alias-brand-primary)" }
							}),
							"RGB 调整（默认关闭，仅灰度）"
						),
						text.rgbMode === true ? textChannels.map((channel) => react.createElement("div", {
							key: channel.key,
							style: sliderRowStyle
						},
							react.createElement("span", { style: sliderLabelStyle }, `${channel.label} ${clampByte(text[channel.key])}`),
							react.createElement("input", {
								type: "range",
								min: 0,
								max: 255,
								step: 1,
								value: clampByte(text[channel.key]),
								style: sliderStyle,
								onChange: (event) => setText({ [channel.key]: Number(event.target.value) })
							})
						)) : react.createElement("div", { style: hintStyle }, "打开 RGB 调整可分别调节红/绿/蓝通道")
					) : null
				),
				saveError !== null ? react.createElement("div", { style: errorStyle }, `保存失败（存储空间不足？）：${saveError}`) : null
			);
		}
		//#endregion

		//#region plugin
		/** Services required by the plugin. */
		const inject = ["slots"];
		/**
		* Client plugin body: apply the persisted background immediately, then
		* register the Background row right under the Appearance row (order 10)
		* in the General section.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			applyConfig(loadConfig());
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "dsh-bg",
				order: 11
			}, BackgroundRow));
		}
		//#endregion

		exports.inject = inject;
		exports.apply = apply;
		exports.defaultConfig = defaultConfig;
		exports.cssFor = cssFor;
		return module.exports;
	}
});
