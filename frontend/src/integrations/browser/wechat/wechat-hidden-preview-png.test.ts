// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { WechatVisualRasterizationRequest } from "../../../contracts/ports/wechat-visual-rasterization-port";
import { createBrowserWechatClipboard } from "./create-browser-wechat-clipboard";
import { createBrowserWechatVisualRasterizer } from "./create-browser-wechat-visual-rasterizer";
import {
	computedStyle,
	pngOptions,
	registerWechatClipboardCleanup,
} from "./wechat-clipboard.test-harness";

const MEASURE_HOST = '[data-easymde-wechat-measure-host="1"]';
const THEME_BACKGROUND = "rgb(250, 240, 230)";

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
	constructor(public payload: Record<string, Blob>) {}
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
		'<div class="easymde-mermaid"><svg width="20" height="10"><path d="M0 0"></path></svg></div>',
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
	registerWechatClipboardCleanup();

	it("measures visuals in a connected off-screen clone and tears it down without touching the live owner", async () => {
		const { canvas, preview } = hiddenVisualModePreview();
		const liveMarkup = preview.outerHTML;
		const observed: Array<
			Readonly<{
				classes: string;
				hostCss: string;
				hostParent: Element | null;
				hostWidth: string;
				inHost: boolean;
				isConnected: boolean;
				request: WechatVisualRasterizationRequest;
			}>
		> = [];
		const rasterize = vi.fn(
			async (request: WechatVisualRasterizationRequest) => {
				const host = request.source.closest(MEASURE_HOST) as HTMLElement | null;
				observed.push({
					classes: request.source.getAttribute("class") ?? "",
					hostCss: host?.style.cssText ?? "",
					hostParent: host?.parentElement ?? null,
					hostWidth: host?.style.width ?? "",
					inHost: Boolean(host),
					isConnected: request.source.isConnected,
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
			expect(call.isConnected).toBe(true);
			expect(call.inHost).toBe(true);
			expect(call.request.width).toBeGreaterThan(0);
			expect(call.request.height).toBeGreaterThan(0);
			// Mounted beside the hidden owner inside the themed canvas, sized from
			// the visible ProseMirror surface, and invisible without `visibility`.
			expect(call.hostParent).toBe(canvas);
			expect(call.hostWidth).toBe("640px");
			expect(call.hostCss).toContain("opacity: 0");
			expect(call.hostCss).not.toContain("visibility");
		}
		expect(observed[0]?.classes).toContain("easymde-mermaid");
		expect(observed[1]?.classes).toContain("easymde-math");
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
			'<svg width="20" height="10"><path d="M0 0"></path></svg>';
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
});
