// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ImageUploadPort } from "../../../contracts/ports/image-upload-port";
import type { WechatClipboardCopyOptions } from "../../../contracts/ports/wechat-clipboard-port";
import type {
	WechatVisualRasterizationPort,
	WechatVisualRasterizationRequest,
} from "../../../contracts/ports/wechat-visual-rasterization-port";
import { createBrowserWechatClipboard } from "./create-browser-wechat-clipboard";
import { createBrowserWechatVisualRasterizer } from "./create-browser-wechat-visual-rasterizer";

const MEASURE_HOST = '[data-easymde-wechat-measure-host="1"]';
const THEME_BACKGROUND = "rgb(250, 240, 230)";
const APPROVED_ASSET_BASE_URL = "https://example.test/plugin/";
const APPROVED_KATEX_CSS_URL =
	"https://example.test/plugin/assets/vendor/katex/katex.min.css";

function computedStyle(
	element: Element,
	pseudoElement?: string | null,
): CSSStyleDeclaration {
	return window.getComputedStyle(element, pseudoElement ?? undefined);
}

function pngOptions(
	visualRasterizationPort: WechatVisualRasterizationPort,
	imageUploadPort: ImageUploadPort,
	extra: Partial<WechatClipboardCopyOptions> = {},
): WechatClipboardCopyOptions {
	return {
		imageUploadPort,
		maxBytes: 1024 * 1024,
		pngConversionEnabled: true,
		postId: 7,
		visualRasterizationPort,
		...extra,
	};
}

class ImageStub {
	static sources: string[] = [];
	crossOrigin = "";
	decode = vi.fn(async () => undefined);
	onerror: (() => void) | null = null;
	onload: (() => void) | null = null;

	set src(value: string) {
		ImageStub.sources.push(value);
		this.onload?.();
	}
}

class ClipboardItemStub {
	constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
}

function decodedSvg(source: string | undefined): string {
	return decodeURIComponent(source?.split(",").slice(1).join(",") ?? "");
}

/**
 * Mirrors the unlocked visual editor: the formal Preview owner is hidden by
 * `easymde-preview-surface-hidden` (`display:none`) inside the themed scroll
 * canvas, next to the visible ProseMirror surface. jsdom has no layout, so
 * rects are simulated: only nodes inside a measurement host lay out.
 */
function hiddenVisualModePreview() {
	const style = document.createElement("style");
	style.textContent = [
		".easymde-preview-surface-hidden { display: none !important; }",
		`.theme-canvas { background-color: ${THEME_BACKGROUND}; }`,
	].join("\n");
	document.head.append(style);
	const canvas = document.createElement("div");
	canvas.className = "easymde-immersive-preview-canvas theme-canvas";
	const prosemirrorHost = document.createElement("div");
	prosemirrorHost.setAttribute("data-easymde-prosemirror-host", "1");
	const prosemirrorSurface = document.createElement("div");
	prosemirrorSurface.className = "easymde-prosemirror-surface";
	prosemirrorHost.append(prosemirrorSurface);
	const preview = document.createElement("article");
	preview.className = "easymde-preview easymde-preview-surface-hidden";
	preview.setAttribute("data-easymde-preview-html-sink", "1");
	preview.innerHTML = [
		"<p>Intro</p>",
		'<div class="easymde-mermaid"><svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg></div>',
		'<div class="easymde-math easymde-math-block"><span class="katex">',
		// jsdom cannot compute styles for connected MathML nodes, so the fallback
		// subtree is modelled with HTML elements carrying KaTeX's class contract.
		'<span class="katex-mathml"><span>MATHMLFALLBACK</span></span>',
		'<span class="katex-html">x2</span>',
		"</span></div>",
	].join("");
	Object.defineProperty(preview, "innerText", {
		configurable: true,
		value: "Intro",
	});
	canvas.append(prosemirrorHost, preview);
	document.body.append(canvas);
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
		function rect(this: Element): DOMRect {
			const width = this.closest(MEASURE_HOST)
				? 300
				: this === canvas
					? 700
					: this === prosemirrorSurface
						? 640
						: 0;
			const height = width > 0 ? 40 : 0;
			return {
				bottom: height,
				height,
				left: 0,
				right: width,
				toJSON: () => ({}),
				top: 0,
				width,
				x: 0,
				y: 0,
			} as DOMRect;
		},
	);
	return { canvas, preview };
}

function clipboardWithWrites() {
	const writes: unknown[] = [];
	const clipboard = createBrowserWechatClipboard({
		approvedAssetBaseUrl: APPROVED_ASSET_BASE_URL,
		approvedKaTeXCssUrl: APPROVED_KATEX_CSS_URL,
		blob: Blob,
		clipboardItem: ClipboardItemStub,
		document,
		getComputedStyle: computedStyle,
		getSelection: window.getSelection.bind(window),
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: vi.fn(),
		write: vi.fn((items) => {
			writes.push(items);
			return Promise.resolve();
		}),
	});
	return { clipboard, writes };
}

function uploadPort() {
	let count = 0;
	return {
		upload: vi.fn(async () => {
			count += 1;
			return {
				alt: "",
				status: "uploaded" as const,
				title: "",
				url: `https://example.test/wechat-${count}.png`,
			};
		}),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	ImageStub.sources = [];
	document.head.replaceChildren();
	document.body.replaceChildren();
});

describe("WeChat PNG export from a hidden formal Preview owner", () => {
	it("measures visuals in a connected off-screen clone and tears it down without touching the live owner", async () => {
		const { preview } = hiddenVisualModePreview();
		const liveMarkup = preview.outerHTML;
		const observed: Array<
			Readonly<{
				hostCss: string;
				hostWidth: string;
				hasThemedAncestor: boolean;
				inHost: boolean;
				hostConnected: boolean;
				measuredClasses: string;
				request: WechatVisualRasterizationRequest;
			}>
		> = [];
		const rasterize = vi.fn(
			async (request: WechatVisualRasterizationRequest) => {
				const host = document.querySelector(MEASURE_HOST) as HTMLElement | null;
				const measuredSelector =
					request.kind === "mermaid" ? ".easymde-mermaid" : ".easymde-math";
				const measuredNode = host?.querySelector(measuredSelector) ?? null;
				observed.push({
					hostConnected: Boolean(host?.isConnected),
					hostCss: host?.style.cssText ?? "",
					hostWidth: host?.style.width ?? "",
					hasThemedAncestor: Boolean(measuredNode?.closest(".theme-canvas")),
					inHost: Boolean(host && measuredNode),
					measuredClasses: measuredNode?.getAttribute("class") ?? "",
					request,
				});
				return {
					file: new File(["png"], "visual.png", { type: "image/png" }),
					height: request.height,
					pixelCount: Math.ceil(request.width) * Math.ceil(request.height),
					width: request.width,
				};
			},
		);
		let resolverSignal: AbortSignal | undefined;
		const { clipboard } = clipboardWithWrites();

		await expect(
			clipboard.copy(
				preview,
				pngOptions({ rasterize }, uploadPort(), {
					resolvePreview: async (signal) => {
						resolverSignal = signal;
						return preview;
					},
				}),
			),
		).resolves.toEqual({ method: "clipboard", status: "copied" });

		expect(resolverSignal).toBeInstanceOf(AbortSignal);
		expect(rasterize).toHaveBeenCalledTimes(2);
		expect(observed.map(({ request }) => request.kind)).toEqual([
			"mermaid",
			"math",
		]);
		for (const call of observed) {
			expect(call.hostConnected).toBe(true);
			expect(call.inHost).toBe(true);
			expect(call.hasThemedAncestor).toBe(true);
			expect(call.request.width).toBeGreaterThan(0);
			expect(call.request.height).toBeGreaterThan(0);
			expect(call.hostWidth).toBe("640px");
			expect(call.hostCss).toContain("opacity: 0");
			expect(call.hostCss).not.toContain("visibility");
		}
		expect(observed[0]?.measuredClasses).toContain("easymde-mermaid");
		expect(observed[1]?.measuredClasses).toContain("easymde-math");
		expect(document.querySelector(MEASURE_HOST)).toBeNull();
		expect(preview.outerHTML).toBe(liveMarkup);
		expect(preview.classList.contains("easymde-preview-surface-hidden")).toBe(
			true,
		);
	});

	it("rasterizes the connected class-bearing source so MathML is dropped and the themed background is found", async () => {
		const { preview } = hiddenVisualModePreview();
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
		} as unknown as CanvasRenderingContext2D);
		vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
			(callback) => {
				callback(new Blob(["png"], { type: "image/png" }));
			},
		);
		const rasterizer = createBrowserWechatVisualRasterizer({
			approvedAssetBaseUrl: APPROVED_ASSET_BASE_URL,
			approvedKaTeXCssUrl: APPROVED_KATEX_CSS_URL,
			blob: Blob,
			document,
			file: File,
			image: ImageStub as unknown as typeof Image,
			xmlSerializer: XMLSerializer,
		});
		const { clipboard, writes } = clipboardWithWrites();

		await expect(
			clipboard.copy(
				preview,
				pngOptions(rasterizer, uploadPort(), {
					maxBytes: 4096,
					resolvePreview: async () => preview,
				}),
			),
		).resolves.toEqual({ method: "clipboard", status: "copied" });

		expect(ImageStub.sources).toHaveLength(2);
		const mermaidSvg = decodedSvg(ImageStub.sources[0]);
		const mathSvg = decodedSvg(ImageStub.sources[1]);
		expect(mermaidSvg).toContain(`background-color: ${THEME_BACKGROUND}`);
		expect(mathSvg).toContain("x2");
		expect(mathSvg).not.toContain("MATHMLFALLBACK");
		const item = (writes[0] as ClipboardItemStub[])[0];
		const html = await (await item?.payload["text/html"])?.text();
		expect(html).toContain("https://example.test/wechat-1.png");
		expect(html).toContain("https://example.test/wechat-2.png");
		expect(html).not.toContain("MATHMLFALLBACK");
		expect(document.querySelector(MEASURE_HOST)).toBeNull();
	});

	it("removes the measurement host when PNG conversion fails", async () => {
		const { preview } = hiddenVisualModePreview();
		const rasterize = vi.fn(async () => {
			expect(document.querySelector(MEASURE_HOST)).not.toBeNull();
			throw new Error("native-rasterizer-failed");
		});
		const { clipboard } = clipboardWithWrites();

		await expect(
			clipboard.copy(
				preview,
				pngOptions({ rasterize }, uploadPort(), {
					resolvePreview: async () => preview,
				}),
			),
		).resolves.toMatchObject({
			code: "wechat-png-rasterization-failed",
			status: "failed",
		});

		expect(rasterize).toHaveBeenCalledOnce();
		expect(document.querySelector(MEASURE_HOST)).toBeNull();
	});
});

describe("Mermaid background ancestor walk", () => {
	it("skips empty computed background colors instead of stopping at the first node", async () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
		} as unknown as CanvasRenderingContext2D);
		vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
			(callback) => {
				callback(new Blob(["png"], { type: "image/png" }));
			},
		);
		const themed = document.createElement("section");
		const source = document.createElement("div");
		source.className = "easymde-mermaid";
		source.innerHTML =
			'<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
		themed.append(source);
		document.body.append(themed);
		vi.spyOn(window, "getComputedStyle").mockImplementation(
			(element) =>
				({
					backgroundColor: element === themed ? "rgb(1, 2, 3)" : "",
					backgroundImage: "",
					backgroundPosition: "",
					backgroundRepeat: "",
					backgroundSize: "",
					getPropertyValue: () => "",
				}) as unknown as CSSStyleDeclaration,
		);

		await createBrowserWechatVisualRasterizer({
			approvedAssetBaseUrl: APPROVED_ASSET_BASE_URL,
			approvedKaTeXCssUrl: APPROVED_KATEX_CSS_URL,
			blob: Blob,
			document,
			file: File,
			image: ImageStub as unknown as typeof Image,
			xmlSerializer: XMLSerializer,
		}).rasterize({
			height: 10,
			kind: "mermaid",
			maxPixels: 16_777_216,
			scale: 1,
			signal: new AbortController().signal,
			source,
			width: 20,
		});

		expect(decodedSvg(ImageStub.sources[0])).toContain(
			"background-color: rgb(1, 2, 3)",
		);
	});

	it("inherits both solid background-color and safe CSS gradients on native WeChat PNG capture while skipping zero-alpha ancestors and never leaking body/#wpbody", async () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
		} as unknown as CanvasRenderingContext2D);
		vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
			(callback) => {
				callback(new Blob(["png"], { type: "image/png" }));
			},
		);
		document.body.style.backgroundColor = "rgb(240, 240, 241)";
		const wpwrap = document.createElement("div");
		wpwrap.id = "wpwrap";
		wpwrap.style.backgroundColor = "rgb(240, 240, 241)";
		const wpbody = document.createElement("div");
		wpbody.id = "wpbody";
		wpbody.style.backgroundColor = "rgb(240, 240, 241)";
		const canvas = document.createElement("div");
		canvas.className = "easymde-immersive-preview-canvas";
		canvas.style.backgroundColor = "rgb(250, 240, 230)";
		canvas.style.backgroundImage =
			"linear-gradient(135deg, rgb(255, 250, 240), rgb(240, 245, 255))";
		canvas.style.backgroundPosition = "0% 0%";
		canvas.style.backgroundSize = "cover";
		canvas.style.backgroundRepeat = "no-repeat";
		const preview = document.createElement("article");
		preview.className = "easymde-preview";
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML =
			'<div class="easymde-mermaid"><svg width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20"></rect></svg></div>';
		Object.defineProperty(preview, "innerText", {
			configurable: true,
			value: "Diagram",
		});
		canvas.append(preview);
		wpbody.append(canvas);
		wpwrap.append(wpbody);
		document.body.append(wpwrap);
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
			() =>
				({
					bottom: 20,
					height: 20,
					left: 0,
					right: 40,
					toJSON: () => ({}),
					top: 0,
					width: 40,
					x: 0,
					y: 0,
				}) as DOMRect,
		);
		const originalGetComputedStyle = window.getComputedStyle.bind(window);
		const gradientAwareStyle = (
			element: Element,
			pseudo?: string | null,
		): CSSStyleDeclaration => {
			if (!element.isConnected) {
				// Simulate real Chromium: detached nodes report empty computed styles.
				return {
					backgroundColor: "",
					backgroundImage: "",
					backgroundPosition: "",
					backgroundRepeat: "",
					backgroundSize: "",
					getPropertyValue: () => "",
				} as unknown as CSSStyleDeclaration;
			}
			const base = originalGetComputedStyle(element, pseudo ?? undefined);
			if (element === preview) {
				return {
					backgroundColor: "rgb(0 0 0 / 0)",
					backgroundImage: "none",
					backgroundPosition: "",
					backgroundRepeat: "",
					backgroundSize: "",
					getPropertyValue: (property: string) =>
						"background-color" === property
							? "rgb(0 0 0 / 0)"
							: "background-image" === property
								? "none"
								: base.getPropertyValue(property),
				} as unknown as CSSStyleDeclaration;
			}
			if (element.classList.contains("easymde-mermaid")) {
				return {
					backgroundColor: "rgba(255, 255, 255, 0)",
					backgroundImage: "none",
					backgroundPosition: "",
					backgroundRepeat: "",
					backgroundSize: "",
					getPropertyValue: (property: string) =>
						"background-color" === property
							? "rgba(255, 255, 255, 0)"
							: "background-image" === property
								? "none"
								: base.getPropertyValue(property),
				} as unknown as CSSStyleDeclaration;
			}
			return base;
		};
		vi.spyOn(window, "getComputedStyle").mockImplementation(gradientAwareStyle);

		const rasterizer = createBrowserWechatVisualRasterizer({
			approvedAssetBaseUrl: APPROVED_ASSET_BASE_URL,
			approvedKaTeXCssUrl: APPROVED_KATEX_CSS_URL,
			blob: Blob,
			document,
			file: File,
			image: ImageStub as unknown as typeof Image,
			xmlSerializer: XMLSerializer,
		});
		const clipboard = createBrowserWechatClipboard({
			approvedAssetBaseUrl: APPROVED_ASSET_BASE_URL,
			approvedKaTeXCssUrl: APPROVED_KATEX_CSS_URL,
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			getComputedStyle: gradientAwareStyle,
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: vi.fn(async () => undefined),
		});

		await expect(
			clipboard.copy(preview, pngOptions(rasterizer, uploadPort())),
		).resolves.toEqual({ method: "clipboard", status: "copied" });

		const gradientSvg = decodedSvg(ImageStub.sources[0]);
		expect(gradientSvg).toContain("background-color: rgb(250, 240, 230)");
		expect(gradientSvg).toContain(
			"background-image: linear-gradient(135deg, rgb(255, 250, 240), rgb(240, 245, 255))",
		);
		expect(gradientSvg).toContain("background-position: 0% 0%");
		expect(gradientSvg).toContain("background-size: cover");
		expect(gradientSvg).toContain("background-repeat: no-repeat");
		expect(gradientSvg).not.toContain("rgb(240, 240, 241)");

		// Verify unsafe url(...) ancestor background images are never copied while solid fallback color is retained.
		ImageStub.sources = [];
		canvas.style.backgroundColor = "rgb(250, 240, 230)";
		canvas.style.backgroundImage = 'url("https://blocked.example/theme-bg.png")';
		await expect(
			clipboard.copy(preview, pngOptions(rasterizer, uploadPort())),
		).resolves.toEqual({ method: "clipboard", status: "copied" });

		const blockedUrlSvg = decodedSvg(ImageStub.sources[0]);
		const blockedUrlDoc = new DOMParser().parseFromString(
			blockedUrlSvg,
			"text/html",
		);
		const blockedUrlOuterSvg = blockedUrlDoc.querySelector("svg");
		expect(blockedUrlOuterSvg).not.toBeNull();
		const blockedUrlOuterStyle =
			blockedUrlOuterSvg?.getAttribute("style") ?? "";
		expect(blockedUrlOuterStyle).toContain("background-color: rgb(250, 240, 230)");
		expect(blockedUrlOuterStyle).not.toContain("background-image");
		expect(blockedUrlSvg).not.toContain("blocked.example");

		// Now clear the canvas theme background and verify wp-admin body/#wpbody never leaks.
		ImageStub.sources = [];
		canvas.style.backgroundColor = "rgba(0, 0, 0, 0)";
		canvas.style.backgroundImage = "none";
		await expect(
			clipboard.copy(preview, pngOptions(rasterizer, uploadPort())),
		).resolves.toEqual({ method: "clipboard", status: "copied" });

		const transparentSvg = decodedSvg(ImageStub.sources[0]);
		const transparentDoc = new DOMParser().parseFromString(
			transparentSvg,
			"text/html",
		);
		const transparentOuterSvg = transparentDoc.querySelector("svg");
		expect(transparentOuterSvg).not.toBeNull();
		const outerSvgStyle = transparentOuterSvg?.getAttribute("style") ?? "";
		expect(transparentSvg).not.toContain("rgb(240, 240, 241)");
		expect(outerSvgStyle).not.toContain("background-color");
		expect(outerSvgStyle).not.toContain("background-image");
		document.body.style.backgroundColor = "";
	});

	it("transfers inherited theme gradient to mermaid-responsive PNGs even when detached nodes have empty computed styles", async () => {
		const originalGetAnimations = Object.getOwnPropertyDescriptor(
			document,
			"getAnimations",
		);
		Object.defineProperty(document, "getAnimations", {
			configurable: true,
			value: () => [],
		});
		try {
			vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
				drawImage: vi.fn(),
			} as unknown as CanvasRenderingContext2D);
			vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
				(callback) => {
					callback(new Blob(["png"], { type: "image/png" }));
				},
			);
			const canvas = document.createElement("div");
			canvas.className = "easymde-immersive-preview-canvas";
			canvas.style.backgroundColor = "rgb(250, 240, 230)";
			canvas.style.backgroundImage =
				"linear-gradient(90deg, rgb(250, 240, 230), rgb(230, 240, 250))";
			canvas.style.backgroundPosition = "0% 0%";
			canvas.style.backgroundSize = "100% 100%";
			canvas.style.backgroundRepeat = "no-repeat";
			const preview = document.createElement("article");
			preview.className = "easymde-preview";
			preview.setAttribute("data-easymde-preview-html-sink", "1");
			preview.innerHTML =
				'<div class="easymde-mermaid"><svg width="100%" viewBox="0 0 350 200"' +
				' style="display:block;margin-left:auto;margin-right:auto;">' +
				'<rect width="350" height="200"></rect></svg></div>';
			Object.defineProperty(preview, "innerText", {
				configurable: true,
				value: "Responsive",
			});
			const root = preview.querySelector(".easymde-mermaid");
			const svg = preview.querySelector("svg");
			if (!root || !svg) throw new Error("mermaid-responsive-fixture-missing");
			const setTypedStyleMap = (
				element: Element,
				values: Record<string, string>,
			): void => {
				Object.defineProperty(element, "computedStyleMap", {
					configurable: true,
					value: () => ({
						get: (property: string) => ({
							value: values[property] ?? "auto",
						}),
					}),
				});
			};
			setTypedStyleMap(root, {
				"block-size": "auto",
				height: "auto",
				"max-block-size": "none",
				"max-height": "none",
				"max-width": "100%",
				"min-block-size": "auto",
				"min-height": "auto",
			});
			setTypedStyleMap(svg, {
				"block-size": "auto",
				height: "auto",
				"margin-left": "auto",
				"margin-right": "auto",
				"max-block-size": "none",
				"max-height": "none",
				"max-width": "350px",
				"min-block-size": "auto",
				"min-height": "auto",
				width: "100%",
			});
			Object.defineProperty(root, "clientWidth", {
				configurable: true,
				value: 600,
			});
			Object.defineProperty(root, "scrollLeft", {
				configurable: true,
				value: 0,
			});
			Object.defineProperty(root, "scrollWidth", {
				configurable: true,
				value: 600,
			});
			Object.defineProperty(svg, "getScreenCTM", {
				configurable: true,
				value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
			});
			canvas.append(preview);
			document.body.append(canvas);

			vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
				function (this: Element): DOMRect {
					if (this === svg) {
						return {
							bottom: 200,
							height: 200,
							left: 125,
							right: 475,
							toJSON: () => ({}),
							top: 0,
							width: 350,
							x: 125,
							y: 0,
						} as DOMRect;
					}
					return {
						bottom: 200,
						height: 200,
						left: 0,
						right: 600,
						toJSON: () => ({}),
						top: 0,
						width: 600,
						x: 0,
						y: 0,
					} as DOMRect;
				},
			);

			const responsiveStyleMap: Record<string, string> = {
				"background-color": "rgba(0, 0, 0, 0)",
				"background-image": "none",
				"border-bottom-style": "none",
				"border-bottom-width": "0px",
				"border-image-source": "none",
				"border-left-style": "none",
				"border-left-width": "0px",
				"border-radius": "0px",
				"border-right-style": "none",
				"border-right-width": "0px",
				"border-top-style": "none",
				"border-top-width": "0px",
				"box-shadow": "none",
				"box-sizing": "border-box",
				display: "block",
				filter: "none",
				float: "none",
				height: "auto",
				"mask-image": "none",
				"max-width": "100%",
				opacity: "1",
				"outline-style": "none",
				overflow: "auto",
				"overflow-x": "auto",
				"overflow-y": "auto",
				"padding-bottom": "0px",
				"padding-left": "0px",
				"padding-right": "0px",
				"padding-top": "0px",
				position: "static",
				transform: "none",
				width: "600px",
			};
			const svgStyleMap: Record<string, string> = {
				...responsiveStyleMap,
				"margin-left": "auto",
				"margin-right": "auto",
				"max-width": "350px",
				width: "350px",
			};
			const originalGetComputedStyle = window.getComputedStyle.bind(window);
			const chromiumStyle = (
				element: Element,
				pseudo?: string | null,
			): CSSStyleDeclaration => {
				if (pseudo) {
					return {
						getPropertyValue: (property: string) =>
							"content" === property ? "none" : "",
					} as unknown as CSSStyleDeclaration;
				}
				if (!element.isConnected) {
					// Simulate real Chromium: getComputedStyle on detached clone returns empty strings.
					return {
						backgroundColor: "",
						backgroundImage: "",
						backgroundPosition: "",
						backgroundRepeat: "",
						backgroundSize: "",
						getPropertyValue: () => "",
					} as unknown as CSSStyleDeclaration;
				}
				if (element === root) {
					return {
						getPropertyValue: (property: string) =>
							responsiveStyleMap[property] ?? "",
					} as unknown as CSSStyleDeclaration;
				}
				if (element === svg) {
					return {
						getPropertyValue: (property: string) =>
							svgStyleMap[property] ?? "",
					} as unknown as CSSStyleDeclaration;
				}
				return originalGetComputedStyle(element);
			};
			vi.spyOn(window, "getComputedStyle").mockImplementation(chromiumStyle);

			const rasterizer = createBrowserWechatVisualRasterizer({
				approvedAssetBaseUrl: APPROVED_ASSET_BASE_URL,
				approvedKaTeXCssUrl: APPROVED_KATEX_CSS_URL,
				blob: Blob,
				document,
				file: File,
				image: ImageStub as unknown as typeof Image,
				xmlSerializer: XMLSerializer,
			});
			const rasterizeSpy = vi.spyOn(rasterizer, "rasterize");
			const clipboard = createBrowserWechatClipboard({
				approvedAssetBaseUrl: APPROVED_ASSET_BASE_URL,
				approvedKaTeXCssUrl: APPROVED_KATEX_CSS_URL,
				blob: Blob,
				clipboardItem: ClipboardItemStub,
				document,
				getComputedStyle: chromiumStyle,
				getSelection: window.getSelection.bind(window),
				pageOffset: () => ({ x: 0, y: 0 }),
				scrollTo: vi.fn(),
				write: vi.fn(async () => undefined),
			});

			await expect(
				clipboard.copy(preview, pngOptions(rasterizer, uploadPort())),
			).resolves.toEqual({ method: "clipboard", status: "copied" });

			expect(rasterizeSpy).toHaveBeenCalledOnce();
			expect(rasterizeSpy.mock.calls[0]?.[0]).toMatchObject({
				inheritedBackground: {
					color: "rgb(250, 240, 230)",
					image:
						"linear-gradient(90deg, rgb(250, 240, 230), rgb(230, 240, 250))",
					position: "0% 0%",
					repeat: "no-repeat",
					size: "100% 100%",
				},
				kind: "mermaid",
				mermaidCapture: "responsive-viewport",
			});
			const responsiveSvg = decodedSvg(ImageStub.sources[0]);
			expect(responsiveSvg).toContain("background-color: rgb(250, 240, 230)");
			expect(responsiveSvg).toContain(
				"background-image: linear-gradient(90deg, rgb(250, 240, 230), rgb(230, 240, 250))",
			);
			expect(responsiveSvg).toContain("background-position: 0% 0%");
			expect(responsiveSvg).toContain("background-size: 100% 100%");
			expect(responsiveSvg).toContain("background-repeat: no-repeat");

			// Clear canvas theme background inside #wpbody and verify mermaid-responsive
			// receives explicit inheritedBackground: null without leaking body/#wpbody.
			ImageStub.sources = [];
			rasterizeSpy.mockClear();
			const wpbody = document.createElement("div");
			wpbody.id = "wpbody";
			wpbody.style.backgroundColor = "rgb(240, 240, 241)";
			document.body.style.backgroundColor = "rgb(240, 240, 241)";
			canvas.style.backgroundColor = "rgba(0, 0, 0, 0)";
			canvas.style.backgroundImage = "none";
			wpbody.append(canvas);
			document.body.append(wpbody);

			await expect(
				clipboard.copy(preview, pngOptions(rasterizer, uploadPort())),
			).resolves.toEqual({ method: "clipboard", status: "copied" });

			expect(rasterizeSpy).toHaveBeenCalledOnce();
			expect(rasterizeSpy.mock.calls[0]?.[0]).toMatchObject({
				inheritedBackground: null,
				kind: "mermaid",
				mermaidCapture: "responsive-viewport",
			});
			const noBackdropResponsiveSvg = decodedSvg(ImageStub.sources[0]);
			expect(noBackdropResponsiveSvg).not.toContain("rgb(240, 240, 241)");
			const noBackdropResponsiveStyle =
				new DOMParser()
					.parseFromString(noBackdropResponsiveSvg, "text/html")
					.querySelector("svg")
					?.getAttribute("style") ?? "";
			expect(noBackdropResponsiveStyle).not.toContain("background-color");
			expect(noBackdropResponsiveStyle).not.toContain("gradient");
			expect(noBackdropResponsiveStyle).not.toContain("url(");
			document.body.style.backgroundColor = "";
		} finally {
			if (originalGetAnimations) {
				Object.defineProperty(document, "getAnimations", originalGetAnimations);
			} else {
				delete (document as unknown as { getAnimations?: unknown })
					.getAnimations;
			}
		}
	});

	it("passes explicit inheritedBackground without double-compositing 50%-opacity or rounded Mermaid cards", async () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
			drawImage: vi.fn(),
		} as unknown as CanvasRenderingContext2D);
		vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
			(callback) => {
				callback(new Blob(["png"], { type: "image/png" }));
			},
		);
		const canvas = document.createElement("div");
		canvas.className = "easymde-immersive-preview-canvas";
		canvas.style.backgroundColor = "rgb(30, 30, 46)";
		const translucentWrapper = document.createElement("div");
		translucentWrapper.style.backgroundColor = "rgba(255, 255, 255, 0.04)";
		const preview = document.createElement("article");
		preview.className = "easymde-preview";
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML = [
			'<div class="easymde-mermaid" data-case="half-alpha" style="background-color: rgba(10, 20, 30, 0.5);">' +
				'<svg width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20"></rect></svg></div>',
			'<div class="easymde-mermaid" data-case="rounded-card" style="background-color: rgb(245, 247, 250); border-radius: 12px;">' +
				'<svg width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20"></rect></svg></div>',
			'<div class="easymde-mermaid" data-case="square-opaque" style="background-color: rgb(28, 31, 38);">' +
				'<svg width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20"></rect></svg></div>',
		].join("");
		Object.defineProperty(preview, "innerText", {
			configurable: true,
			value: "Diagrams",
		});
		translucentWrapper.append(preview);
		canvas.append(translucentWrapper);
		document.body.append(canvas);
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
			() =>
				({
					bottom: 20,
					height: 20,
					left: 0,
					right: 40,
					toJSON: () => ({}),
					top: 0,
					width: 40,
					x: 0,
					y: 0,
				}) as DOMRect,
		);

		const rasterizer = createBrowserWechatVisualRasterizer({
			approvedAssetBaseUrl: APPROVED_ASSET_BASE_URL,
			approvedKaTeXCssUrl: APPROVED_KATEX_CSS_URL,
			blob: Blob,
			document,
			file: File,
			image: ImageStub as unknown as typeof Image,
			xmlSerializer: XMLSerializer,
		});
		const rasterizeSpy = vi.spyOn(rasterizer, "rasterize");
		const clipboard = createBrowserWechatClipboard({
			approvedAssetBaseUrl: APPROVED_ASSET_BASE_URL,
			approvedKaTeXCssUrl: APPROVED_KATEX_CSS_URL,
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			getComputedStyle: computedStyle,
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: vi.fn(async () => undefined),
		});

		await expect(
			clipboard.copy(preview, pngOptions(rasterizer, uploadPort())),
		).resolves.toEqual({ method: "clipboard", status: "copied" });

		expect(rasterizeSpy).toHaveBeenCalledTimes(3);
		expect(rasterizeSpy.mock.calls[0]?.[0]).toMatchObject({
			inheritedBackground: { color: "rgb(39, 39, 54)" },
			kind: "mermaid",
		});
		expect(rasterizeSpy.mock.calls[1]?.[0]).toMatchObject({
			inheritedBackground: { color: "rgb(39, 39, 54)" },
			kind: "mermaid",
		});
		expect(rasterizeSpy.mock.calls[2]?.[0]).toMatchObject({
			inheritedBackground: null,
			kind: "mermaid",
		});

		const halfAlphaDoc = new DOMParser().parseFromString(
			decodedSvg(ImageStub.sources[0]),
			"text/html",
		);
		const halfAlphaOuterStyle =
			halfAlphaDoc.querySelector("svg")?.getAttribute("style") ?? "";
		const halfAlphaCloneStyle =
			halfAlphaDoc.querySelector(".easymde-mermaid")?.getAttribute("style") ??
			"";
		expect(halfAlphaOuterStyle).toContain("background-color: rgb(39, 39, 54)");
		expect(halfAlphaOuterStyle).not.toContain("rgba(10, 20, 30, 0.5)");
		expect(halfAlphaCloneStyle).toMatch(
			/background-color:\s*rgba\(10, 20, 30, 0\.5\)/u,
		);

		const roundedDoc = new DOMParser().parseFromString(
			decodedSvg(ImageStub.sources[1]),
			"text/html",
		);
		const roundedOuterStyle =
			roundedDoc.querySelector("svg")?.getAttribute("style") ?? "";
		const roundedCloneStyle =
			roundedDoc.querySelector(".easymde-mermaid")?.getAttribute("style") ?? "";
		expect(roundedOuterStyle).toContain("background-color: rgb(39, 39, 54)");
		expect(roundedOuterStyle).not.toContain("rgb(245, 247, 250)");
		expect(roundedCloneStyle).toMatch(
			/background-color:\s*rgb\(245, 247, 250\)/u,
		);
		expect(roundedCloneStyle).toMatch(/border-radius:\s*12px/u);

		const squareOpaqueDoc = new DOMParser().parseFromString(
			decodedSvg(ImageStub.sources[2]),
			"text/html",
		);
		const squareOpaqueOuterStyle =
			squareOpaqueDoc.querySelector("svg")?.getAttribute("style") ?? "";
		const squareOpaqueCloneStyle =
			squareOpaqueDoc
				.querySelector(".easymde-mermaid")
				?.getAttribute("style") ?? "";
		expect(squareOpaqueOuterStyle).not.toContain("background-color");
		expect(squareOpaqueOuterStyle).not.toContain("background-image");
		expect(squareOpaqueCloneStyle).toMatch(
			/background-color:\s*rgb\(28, 31, 38\)/u,
		);
	});

	it("routes mermaid-responsive to foreignObject when SVG or an article ancestor has opacity < 1", async () => {
		const originalGetAnimations = Object.getOwnPropertyDescriptor(
			document,
			"getAnimations",
		);
		Object.defineProperty(document, "getAnimations", {
			configurable: true,
			value: () => [],
		});
		try {
			vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
				drawImage: vi.fn(),
			} as unknown as CanvasRenderingContext2D);
			vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
				(callback) => {
					callback(new Blob(["png"], { type: "image/png" }));
				},
			);
			const canvas = document.createElement("div");
			canvas.className = "easymde-immersive-preview-canvas";
			canvas.style.backgroundColor = "rgb(255, 255, 255)";
			const preview = document.createElement("article");
			preview.className = "easymde-preview";
			preview.setAttribute("data-easymde-preview-html-sink", "1");
			preview.innerHTML =
				'<blockquote><div class="easymde-mermaid"><svg width="100%" viewBox="0 0 350 200"' +
				' style="display:block;margin-left:auto;margin-right:auto;">' +
				'<rect width="350" height="200"></rect></svg></div></blockquote>';
			Object.defineProperty(preview, "innerText", {
				configurable: true,
				value: "ResponsiveOpacity",
			});
			const blockquote = preview.querySelector("blockquote");
			const root = preview.querySelector(".easymde-mermaid");
			const svg = preview.querySelector("svg");
			if (!blockquote || !root || !svg) {
				throw new Error("mermaid-responsive-opacity-fixture-missing");
			}
			const setTypedStyleMap = (
				element: Element,
				values: Record<string, string>,
			): void => {
				Object.defineProperty(element, "computedStyleMap", {
					configurable: true,
					value: () => ({
						get: (property: string) => ({
							value: values[property] ?? "auto",
						}),
					}),
				});
			};
			setTypedStyleMap(root, {
				"block-size": "auto",
				height: "auto",
				"max-block-size": "none",
				"max-height": "none",
				"max-width": "100%",
				"min-block-size": "auto",
				"min-height": "auto",
			});
			setTypedStyleMap(svg, {
				"block-size": "auto",
				height: "auto",
				"margin-left": "auto",
				"margin-right": "auto",
				"max-block-size": "none",
				"max-height": "none",
				"max-width": "350px",
				"min-block-size": "auto",
				"min-height": "auto",
				width: "100%",
			});
			Object.defineProperty(root, "clientWidth", {
				configurable: true,
				value: 600,
			});
			Object.defineProperty(root, "scrollLeft", {
				configurable: true,
				value: 0,
			});
			Object.defineProperty(root, "scrollWidth", {
				configurable: true,
				value: 600,
			});
			Object.defineProperty(svg, "getScreenCTM", {
				configurable: true,
				value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
			});
			canvas.append(preview);
			document.body.append(canvas);

			vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
				function (this: Element): DOMRect {
					if (this === svg) {
						return {
							bottom: 200,
							height: 200,
							left: 125,
							right: 475,
							toJSON: () => ({}),
							top: 0,
							width: 350,
							x: 125,
							y: 0,
						} as DOMRect;
					}
					return {
						bottom: 200,
						height: 200,
						left: 0,
						right: 600,
						toJSON: () => ({}),
						top: 0,
						width: 600,
						x: 0,
						y: 0,
					} as DOMRect;
				},
			);

			const baseStyleMap: Record<string, string> = {
				"background-color": "rgba(0, 0, 0, 0)",
				"background-image": "none",
				"border-bottom-style": "none",
				"border-bottom-width": "0px",
				"border-image-source": "none",
				"border-left-style": "none",
				"border-left-width": "0px",
				"border-radius": "0px",
				"border-right-style": "none",
				"border-right-width": "0px",
				"border-top-style": "none",
				"border-top-width": "0px",
				"box-shadow": "none",
				"box-sizing": "border-box",
				display: "block",
				filter: "none",
				float: "none",
				height: "auto",
				"mask-image": "none",
				"max-width": "100%",
				opacity: "1",
				"outline-style": "none",
				overflow: "auto",
				"overflow-x": "auto",
				"overflow-y": "auto",
				"padding-bottom": "0px",
				"padding-left": "0px",
				"padding-right": "0px",
				"padding-top": "0px",
				position: "static",
				transform: "none",
				width: "600px",
			};
			let quoteOpacity = "1";
			let svgComputedOpacity = "1";
			const originalGetComputedStyle = window.getComputedStyle.bind(window);
			const mockStyle = (
				element: Element,
				pseudo?: string | null,
			): CSSStyleDeclaration => {
				if (pseudo) {
					return {
						getPropertyValue: (property: string) =>
							"content" === property ? "none" : "",
					} as unknown as CSSStyleDeclaration;
				}
				if (element === blockquote) {
					const map: Record<string, string> = {
						...baseStyleMap,
						opacity: quoteOpacity,
						overflow: "visible",
						"overflow-x": "visible",
						"overflow-y": "visible",
					};
					return {
						getPropertyValue: (property: string) => map[property] ?? "",
					} as unknown as CSSStyleDeclaration;
				}
				if (element === root) {
					return {
						getPropertyValue: (property: string) =>
							baseStyleMap[property] ?? "",
					} as unknown as CSSStyleDeclaration;
				}
				if (element === svg) {
					const map: Record<string, string> = {
						...baseStyleMap,
						"margin-left": "auto",
						"margin-right": "auto",
						"max-width": "350px",
						opacity: svgComputedOpacity,
						width: "350px",
					};
					return {
						getPropertyValue: (property: string) => map[property] ?? "",
					} as unknown as CSSStyleDeclaration;
				}
				return originalGetComputedStyle(element);
			};
			vi.spyOn(window, "getComputedStyle").mockImplementation(mockStyle);

			const rasterizer = createBrowserWechatVisualRasterizer({
				approvedAssetBaseUrl: APPROVED_ASSET_BASE_URL,
				approvedKaTeXCssUrl: APPROVED_KATEX_CSS_URL,
				blob: Blob,
				document,
				file: File,
				image: ImageStub as unknown as typeof Image,
				xmlSerializer: XMLSerializer,
			});
			const rasterizeSpy = vi.spyOn(rasterizer, "rasterize");
			const clipboard = createBrowserWechatClipboard({
				approvedAssetBaseUrl: APPROVED_ASSET_BASE_URL,
				approvedKaTeXCssUrl: APPROVED_KATEX_CSS_URL,
				blob: Blob,
				clipboardItem: ClipboardItemStub,
				document,
				getComputedStyle: mockStyle,
				getSelection: window.getSelection.bind(window),
				pageOffset: () => ({ x: 0, y: 0 }),
				scrollTo: vi.fn(),
				write: vi.fn(async () => undefined),
			});

			// Baseline: opacity 1 on both blockquote and SVG admits responsive-viewport.
			await expect(
				clipboard.copy(preview, pngOptions(rasterizer, uploadPort())),
			).resolves.toEqual({ method: "clipboard", status: "copied" });
			expect(rasterizeSpy.mock.calls[0]?.[0]).toMatchObject({
				kind: "mermaid",
				mermaidCapture: "responsive-viewport",
			});

			// 1. SVG computed opacity < 1 rejects responsive-viewport -> routes to foreignObject (mermaidCapture undefined).
			rasterizeSpy.mockClear();
			svgComputedOpacity = "0.5";
			await expect(
				clipboard.copy(preview, pngOptions(rasterizer, uploadPort())),
			).resolves.toEqual({ method: "clipboard", status: "copied" });
			expect(rasterizeSpy.mock.calls[0]?.[0]?.mermaidCapture).toBeUndefined();

			// 2. SVG presentation attribute opacity="0.5" (empty computed opacity) also rejects responsive-viewport.
			rasterizeSpy.mockClear();
			svgComputedOpacity = "";
			svg.setAttribute("opacity", "0.5");
			await expect(
				clipboard.copy(preview, pngOptions(rasterizer, uploadPort())),
			).resolves.toEqual({ method: "clipboard", status: "copied" });
			expect(rasterizeSpy.mock.calls[0]?.[0]?.mermaidCapture).toBeUndefined();

			// 3. Ancestor <blockquote style="opacity: 0.5"> rejects responsive-viewport -> routes to foreignObject.
			rasterizeSpy.mockClear();
			svg.removeAttribute("opacity");
			svgComputedOpacity = "1";
			quoteOpacity = "0.5";
			await expect(
				clipboard.copy(preview, pngOptions(rasterizer, uploadPort())),
			).resolves.toEqual({ method: "clipboard", status: "copied" });
			expect(rasterizeSpy.mock.calls[0]?.[0]?.mermaidCapture).toBeUndefined();
		} finally {
			if (originalGetAnimations) {
				Object.defineProperty(document, "getAnimations", originalGetAnimations);
			} else {
				delete (document as unknown as { getAnimations?: unknown })
					.getAnimations;
			}
		}
	});
});
