import { describe, expect, it, vi } from "vitest";

import {
	CLIPBOARD_COMMIT_TIMEOUT_MS,
	createBrowserWechatClipboard,
	WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS,
} from "./create-browser-wechat-clipboard";

import {
	blobText,
	computedStyle,
	declaration,
	deferred,
	dispatchSuccessfulLegacyCopy,
	installClipboardTestEnvironment,
	prepareClipboard,
	readyPreview,
} from "./wechat-clipboard-test-fixtures";

const initialMathBoxStyle = {
	"border-bottom-style": "none",
	"border-bottom-width": "0px",
	"border-left-style": "none",
	"border-left-width": "0px",
	"border-right-style": "none",
	"border-right-width": "0px",
	"border-top-style": "none",
	"border-top-width": "0px",
	"padding-bottom": "0px",
	"padding-left": "0px",
	"padding-right": "0px",
	"padding-top": "0px",
} as const;

describe("createBrowserWechatClipboard", () => {
	installClipboardTestEnvironment();

	it("rejects pending, failed, or empty preview surfaces before touching Clipboard", async () => {
		const write = vi.fn();
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: class {
				constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
			},
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			scrollTo: vi.fn(),
			write,
			pageOffset: () => ({ x: 0, y: 0 }),
		});
		const preview = readyPreview();
		preview.setAttribute("aria-busy", "true");
		preview.setAttribute("data-easymde-preview-refreshing", "1");
		preview.removeAttribute("data-easymde-preview-accepted");

		await expect(clipboard.copy(preview)).resolves.toEqual({
			code: "wechat-preview-unavailable",
			status: "failed",
		});
		expect(write).not.toHaveBeenCalled();
	});

	it("copies the previously accepted Preview while its replacement is refreshing", async () => {
		const writes: unknown[] = [];
		class ClipboardItemStub {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			scrollTo: vi.fn(),
			write: async (items) => {
				writes.push(items);
			},
			pageOffset: () => ({ x: 0, y: 0 }),
		});
		const preview = readyPreview();
		preview.setAttribute("aria-busy", "true");
		preview.setAttribute("data-easymde-preview-refreshing", "1");
		preview.setAttribute("data-easymde-preview-accepted", "1");

		await expect(clipboard.copy(preview)).resolves.toMatchObject({
			status: "copied",
		});
		expect(writes).toHaveLength(1);
	});

	it("reuses the prepared legacy payload when only refresh attributes change", async () => {
		const preview = readyPreview();
		const execCommand = vi.fn(() => {
			dispatchSuccessfulLegacyCopy();
			return true;
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: null,
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: null,
		});

		await prepareClipboard(clipboard, preview);
		preview.setAttribute("aria-busy", "true");
		preview.setAttribute("data-easymde-preview-refreshing", "1");
		preview.setAttribute("data-easymde-preview-accepted", "1");

		await expect(clipboard.copy(preview)).resolves.toEqual({
			method: "legacy",
			status: "copied",
		});
		expect(execCommand).toHaveBeenCalledWith("copy");
	});

	it.each([
		[
			"root style",
			(preview: HTMLElement) => preview.setAttribute("style", "color: red"),
		],
		[
			"descendant text",
			(preview: HTMLElement) => {
				const paragraph = preview.querySelector("p");
				if (!paragraph) throw new Error("paragraph missing");
				paragraph.textContent = "Replaced";
			},
		],
		[
			"descendant class",
			(preview: HTMLElement) => {
				const paragraph = preview.querySelector("p");
				if (!paragraph) throw new Error("paragraph missing");
				paragraph.classList.add("changed");
			},
		],
		[
			"descendant refresh-named attribute",
			(preview: HTMLElement) => {
				const paragraph = preview.querySelector("p");
				if (!paragraph) throw new Error("paragraph missing");
				paragraph.setAttribute("data-easymde-preview-refreshing", "1");
			},
		],
	])(
		"invalidates a prepared legacy payload after %s changes",
		async (_, change) => {
			const execCommand = vi.fn(() => {
				dispatchSuccessfulLegacyCopy();
				return true;
			});
			Object.defineProperty(document, "execCommand", {
				configurable: true,
				value: execCommand,
			});
			const clipboard = createBrowserWechatClipboard({
				blob: Blob,
				clipboardItem: null,
				document,
				getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
				getSelection: window.getSelection.bind(window),
				pageOffset: () => ({ x: 0, y: 0 }),
				scrollTo: vi.fn(),
				write: null,
			});
			const preview = readyPreview();
			await prepareClipboard(clipboard, preview);
			change(preview);

			await expect(clipboard.copy(preview)).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(execCommand).not.toHaveBeenCalled();
		},
	);

	it("fails legacy Copy when execCommand reports success without dispatching a copy event", async () => {
		const originalExecCommand = Object.getOwnPropertyDescriptor(
			document,
			"execCommand",
		);
		const execCommand = vi.fn(() => true);
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: null,
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: null,
		});
		try {
			const preview = readyPreview();
			await prepareClipboard(clipboard, preview);
			await expect(clipboard.copy(preview)).resolves.toEqual({
				code: "wechat-clipboard-unsupported",
				status: "failed",
			});
			expect(execCommand).toHaveBeenCalledWith("copy");
			let postCopyWrites = 0;
			const postCopyEvent = new Event("copy", {
				bubbles: true,
				cancelable: true,
			});
			Object.defineProperty(postCopyEvent, "clipboardData", {
				configurable: true,
				value: {
					setData: (): void => {
						postCopyWrites += 1;
					},
				},
			});
			document.dispatchEvent(postCopyEvent);
			expect(postCopyWrites).toBe(0);
			expect(postCopyEvent.defaultPrevented).toBe(false);
		} finally {
			if (originalExecCommand)
				Object.defineProperty(document, "execCommand", originalExecCommand);
			else
				delete (document as unknown as { execCommand?: unknown }).execCommand;
		}
	});

	it("fails legacy Copy when the browser omits clipboardData and removes the listener", async () => {
		const originalExecCommand = Object.getOwnPropertyDescriptor(
			document,
			"execCommand",
		);
		const execCommand = vi.fn(() => {
			document.dispatchEvent(
				new Event("copy", { bubbles: true, cancelable: true }),
			);
			return true;
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: null,
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: null,
		});
		try {
			const preview = readyPreview();
			await prepareClipboard(clipboard, preview);
			await expect(clipboard.copy(preview)).resolves.toEqual({
				code: "wechat-clipboard-unsupported",
				status: "failed",
			});
			let postCopyWrites = 0;
			const postCopyEvent = new Event("copy", {
				bubbles: true,
				cancelable: true,
			});
			Object.defineProperty(postCopyEvent, "clipboardData", {
				configurable: true,
				value: {
					setData: (): void => {
						postCopyWrites += 1;
					},
				},
			});
			document.dispatchEvent(postCopyEvent);
			expect(postCopyWrites).toBe(0);
			expect(postCopyEvent.defaultPrevented).toBe(false);
		} finally {
			if (originalExecCommand)
				Object.defineProperty(document, "execCommand", originalExecCommand);
			else
				delete (document as unknown as { execCommand?: unknown }).execCommand;
		}
	});

	it("fails legacy Copy when either normalized MIME write throws and cleans up the listener", async () => {
		const originalExecCommand = Object.getOwnPropertyDescriptor(
			document,
			"execCommand",
		);
		let setDataCalls = 0;
		const execCommand = vi.fn(() => {
			const event = new Event("copy", { bubbles: true, cancelable: true });
			Object.defineProperty(event, "clipboardData", {
				configurable: true,
				value: {
					setData(type: string): void {
						setDataCalls += 1;
						if ("text/plain" === type)
							throw new Error("clipboard-data-write-failed");
					},
				},
			});
			document.dispatchEvent(event);
			return true;
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: null,
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: null,
		});
		try {
			const preview = readyPreview();
			await prepareClipboard(clipboard, preview);
			await expect(clipboard.copy(preview)).resolves.toEqual({
				code: "wechat-clipboard-unsupported",
				status: "failed",
			});
			expect(setDataCalls).toBe(2);
			let postCopyWrites = 0;
			const postCopyEvent = new Event("copy", {
				bubbles: true,
				cancelable: true,
			});
			Object.defineProperty(postCopyEvent, "clipboardData", {
				configurable: true,
				value: {
					setData: (): void => {
						postCopyWrites += 1;
					},
				},
			});
			document.dispatchEvent(postCopyEvent);
			expect(postCopyWrites).toBe(0);
			expect(postCopyEvent.defaultPrevented).toBe(false);
		} finally {
			if (originalExecCommand)
				Object.defineProperty(document, "execCommand", originalExecCommand);
			else
				delete (document as unknown as { execCommand?: unknown }).execCommand;
		}
	});

	it("rejects an accepted windowed Preview during refresh before resolving materialization", async () => {
		const write = vi.fn();
		const resolvePreview = vi.fn(async () => null);
		class ClipboardItemStub {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write,
		});
		const preview = readyPreview();
		preview.setAttribute("aria-busy", "true");
		preview.setAttribute("data-easymde-preview-refreshing", "1");
		preview.setAttribute("data-easymde-preview-accepted", "1");
		const spacer = document.createElement("div");
		spacer.setAttribute("data-easymde-preview-window-spacer", "1");
		preview.append(spacer);

		await expect(clipboard.copy(preview, { resolvePreview })).resolves.toEqual({
			code: "wechat-preview-unavailable",
			status: "failed",
		});
		expect(resolvePreview).not.toHaveBeenCalled();
		expect(write).not.toHaveBeenCalled();
	});

	type AtlasRetryFixture = Readonly<{
		assetBaseUrl: string;
		atlasUrl: string;
		execCommand: ReturnType<typeof vi.fn>;
		kataxCssUrl: string;
		preview: HTMLElement;
		resolveFonts: () => void;
		restore: () => void;
	}>;

	function installAtlasRetryFixture(): AtlasRetryFixture {
		const originalExecCommand = Object.getOwnPropertyDescriptor(
			document,
			"execCommand",
		);
		const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
		const originalStyleSheets = Object.getOwnPropertyDescriptor(
			document,
			"styleSheets",
		);
		const fontsReady = deferred<void>();
		const registeredFace = {
			family: "KaTeX_Main",
			status: "loaded",
			stretch: "normal",
			style: "normal",
			weight: "400",
		};
		Object.defineProperty(document, "fonts", {
			configurable: true,
			value: {
				[Symbol.iterator]: function* () {
					yield registeredFace;
				},
				ready: fontsReady.promise,
				status: "loading",
			},
		});
		const assetBaseUrl = new URL(
			"/wp-content/plugins/easymde/",
			document.baseURI,
		).href;
		const kataxCssUrl = new URL(
			"assets/vendor/katex/katex.min.css",
			assetBaseUrl,
		).href;
		Object.defineProperty(document, "styleSheets", {
			configurable: true,
			value: [
				{
					cssRules: [
						{
							style: declaration({
								"font-family": "KaTeX_Main",
								"font-stretch": "normal",
								"font-style": "normal",
								"font-weight": "400",
								src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
							}),
							type: 5,
						},
					],
					href: kataxCssUrl,
				},
			],
		});
		const contentVersion = "0123456789abcdef";
		const atlasUrl = new URL(
			`assets/math/easymde-katex-glyph-atlas.json?contentversion=${contentVersion}`,
			assetBaseUrl,
		).href;
		const preview = document.createElement("article");
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML =
			'<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">A</span></span></span></div>';
		Object.defineProperty(preview, "innerText", {
			configurable: true,
			value: "A",
		});
		const execCommand = vi.fn(() => {
			dispatchSuccessfulLegacyCopy();
			return true;
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		return {
			assetBaseUrl,
			atlasUrl,
			execCommand,
			kataxCssUrl,
			preview,
			resolveFonts: () => {
				(document.fonts as unknown as { status: string }).status = "loaded";
				fontsReady.resolve();
			},
			restore: () => {
				if (originalFonts)
					Object.defineProperty(document, "fonts", originalFonts);
				else delete (document as unknown as { fonts?: unknown }).fonts;
				if (originalStyleSheets)
					Object.defineProperty(document, "styleSheets", originalStyleSheets);
				else
					delete (document as unknown as { styleSheets?: unknown }).styleSheets;
				if (originalExecCommand)
					Object.defineProperty(document, "execCommand", originalExecCommand);
				else
					delete (document as unknown as { execCommand?: unknown }).execCommand;
				document
					.querySelectorAll(".easymde-wechat-preview-measurement")
					.forEach((host) => {
						host.remove();
					});
			},
		};
	}

	function atlasResponse(payload: string): Response {
		return {
			arrayBuffer: async () => new TextEncoder().encode(payload).buffer,
			headers: new Headers(),
			ok: true,
		} as Response;
	}

	function atlasPayload(): string {
		return JSON.stringify({
			fonts: [
				{
					cmap: [{ codepoint: 65, glyphId: 1 }],
					file: "KaTeX_Main-Regular.woff2",
					glyphs: [
						{
							advanceWidth: 500,
							id: 1,
							outline: { pathData: "M0 0L1 0L1 1Z" },
						},
					],
					unitsPerEm: 1000,
				},
			],
			schema: "easymde-katex-glyph-atlas/1",
			serialization: {
				coordinateSystem: "font-units-y-up",
				decimalPlaces: 6,
				flipY: false,
				optimize: false,
			},
		});
	}

	function installAtlasRetryVectorGeometry(): () => void {
		const originalHtmlRect = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			"getBoundingClientRect",
		);
		const originalRangeRect = Object.getOwnPropertyDescriptor(
			Range.prototype,
			"getBoundingClientRect",
		);
		const rect = (
			left: number,
			top: number,
			width: number,
			height: number,
		): DOMRect =>
			({
				bottom: top + height,
				height,
				left,
				right: left + width,
				top,
				width,
				x: left,
				y: top,
				toJSON: () => ({}),
			}) as DOMRect;
		Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
			configurable: true,
			value: function (this: HTMLElement): DOMRect {
				if (this.style.width === "0px" && this.style.height === "0px")
					return rect(10, 20, 0, 0);
				if (this.classList.contains("mord")) return rect(10, 10, 30, 20);
				if (this.classList.contains("katex-html")) return rect(10, 10, 30, 20);
				if (this.classList.contains("easymde-math-block"))
					return rect(0, 0, 100, 40);
				return rect(0, 0, 100, 40);
			},
		});
		Object.defineProperty(Range.prototype, "getBoundingClientRect", {
			configurable: true,
			value: function (this: Range): DOMRect {
				return rect(12 + this.startOffset * 8, 10, 8, 20);
			},
		});
		return () => {
			if (originalHtmlRect)
				Object.defineProperty(
					HTMLElement.prototype,
					"getBoundingClientRect",
					originalHtmlRect,
				);
			else
				Reflect.deleteProperty(HTMLElement.prototype, "getBoundingClientRect");
			if (originalRangeRect)
				Object.defineProperty(
					Range.prototype,
					"getBoundingClientRect",
					originalRangeRect,
				);
			else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
		};
	}

	function atlasRetryClipboard(
		fixture: AtlasRetryFixture,
		fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
	) {
		return createBrowserWechatClipboard({
			approvedAssetBaseUrl: fixture.assetBaseUrl,
			approvedKaTeXCssUrl: fixture.kataxCssUrl,
			blob: Blob,
			clipboardItem: null,
			document,
			fetch,
			getComputedStyle: (element, pseudoElement) => {
				if (pseudoElement) return declaration({ content: "none" });
				if (element === fixture.preview) {
					return declaration({
						display: "none",
						"font-family": "KaTeX_Main",
						height: "40px",
						width: "100px",
					});
				}
				if (
					element.classList.contains("easymde-math-block") ||
					element.classList.contains("katex-html") ||
					element.classList.contains("mord")
				) {
					return declaration({
						...initialMathBoxStyle,
						color: "#111111",
						display:
							element.classList.contains("mord") ||
							element.classList.contains("easymde-math-block")
								? "inline-block"
								: "block",
						"font-family": "KaTeX_Main",
						"font-size": "10px",
						"font-stretch": "normal",
						"font-style": "normal",
						"font-weight": "400",
						height: element.classList.contains("mord") ? "20px" : "40px",
						opacity: "1",
						"overflow-x": "visible",
						"overflow-y": "visible",
						transform: "none",
						visibility: "visible",
						width: element.classList.contains("mord") ? "20px" : "100px",
					});
				}
				return pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element);
			},
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			wechatMathAtlasContentVersion: "0123456789abcdef",
			wechatMathAtlasUrl: fixture.atlasUrl,
			write: null,
		});
	}

	it("keeps a pending legacy retry failing when the configured atlas fetch fails", async () => {
		const fetch = vi.fn(
			async (
				_input: RequestInfo | URL,
				_init?: RequestInit,
			): Promise<Response> => {
				throw new Error("wechat-math-vector-atlas-fetch-failed");
			},
		);
		const fixture = installAtlasRetryFixture();
		const clipboard = atlasRetryClipboard(fixture, fetch);
		try {
			await expect(clipboard.copy(fixture.preview)).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(fetch).not.toHaveBeenCalled();
			expect(fixture.execCommand).not.toHaveBeenCalled();

			fixture.resolveFonts();
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
			expect(fetch).toHaveBeenCalledWith(fixture.atlasUrl, undefined);
			await vi.waitFor(() =>
				expect(
					document.querySelectorAll(".easymde-wechat-preview-measurement"),
				).toHaveLength(0),
			);

			await expect(clipboard.copy(fixture.preview)).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
			await vi.waitFor(() =>
				expect(
					document.querySelectorAll(".easymde-wechat-preview-measurement"),
				).toHaveLength(0),
			);
			expect(fixture.execCommand).not.toHaveBeenCalled();
		} finally {
			fixture.restore();
		}
	});

	it("copies vector output after a pending legacy retry prepares with the configured atlas", async () => {
		const fetch = vi.fn(
			async (
				_input: RequestInfo | URL,
				_init?: RequestInit,
			): Promise<Response> => atlasResponse(atlasPayload()),
		);
		const fixture = installAtlasRetryFixture();
		fixture.preview.style.display = "block";
		const restoreGeometry = installAtlasRetryVectorGeometry();
		const clipboard = atlasRetryClipboard(fixture, fetch);
		let legacyHtml = "";
		fixture.execCommand.mockImplementation(() => {
			legacyHtml =
				document.querySelector(".easymde-copy-sandbox")?.innerHTML ?? "";
			dispatchSuccessfulLegacyCopy();
			return true;
		});
		try {
			await expect(clipboard.copy(fixture.preview)).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(fetch).not.toHaveBeenCalled();
			expect(fixture.execCommand).not.toHaveBeenCalled();

			fixture.resolveFonts();
			await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
			expect(fetch).toHaveBeenCalledWith(fixture.atlasUrl, undefined);
			await vi.waitFor(() =>
				expect(
					document.querySelectorAll(".easymde-wechat-preview-measurement"),
				).toHaveLength(0),
			);

			await expect(clipboard.copy(fixture.preview)).resolves.toEqual({
				method: "legacy",
				status: "copied",
			});
			expect(fixture.execCommand).toHaveBeenCalledWith("copy");
			expect(fetch).toHaveBeenCalledOnce();
			expect(legacyHtml).toContain("<svg");
			expect(legacyHtml).toContain("<path");
			expect(legacyHtml).not.toContain("katex-html");
		} finally {
			restoreGeometry();
			fixture.restore();
		}
	});

	it("does not start legacy serialization before preview preparation", async () => {
		const originalExecCommand = Object.getOwnPropertyDescriptor(
			document,
			"execCommand",
		);
		const execCommand = vi.fn(() => {
			dispatchSuccessfulLegacyCopy();
			return true;
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		const imageUrl = new URL(
			"/assets/images/cupid-busy-heart.png",
			document.baseURI,
		).href;
		const fetch = vi.fn(
			async () =>
				({
					ok: true,
					blob: async () =>
						new window.Blob(["theme image"], { type: "image/png" }),
				}) as unknown as Response,
		);
		const preview = document.createElement("article");
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML = "<h1>Theme heading</h1>";
		Object.defineProperty(preview, "innerText", {
			configurable: true,
			value: "Theme heading",
		});
		const clipboard = createBrowserWechatClipboard({
			blob: window.Blob,
			clipboardItem: null,
			document,
			fetch,
			getComputedStyle: (element, pseudoElement) => {
				if ("H1" === element.tagName && "::before" === pseudoElement) {
					return declaration({
						content: '""',
						display: "block",
						width: "20px",
						height: "20px",
						background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
						"background-image": `url("${imageUrl}")`,
					});
				}
				return pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element);
			},
			getSelection: window.getSelection.bind(window),
			scrollTo: vi.fn(),
			write: null,
			pageOffset: () => ({ x: 0, y: 0 }),
		});

		try {
			await expect(clipboard.copy(preview)).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(fetch).not.toHaveBeenCalled();
			expect(execCommand).not.toHaveBeenCalled();
		} finally {
			if (originalExecCommand) {
				Object.defineProperty(document, "execCommand", originalExecCommand);
			} else {
				delete (document as unknown as { execCommand?: unknown }).execCommand;
			}
		}
	});

	it("does not enter legacy copy after an asynchronous modern write rejection", async () => {
		const originalExecCommand = Object.getOwnPropertyDescriptor(
			document,
			"execCommand",
		);
		const execCommand = vi.fn(() => {
			dispatchSuccessfulLegacyCopy();
			return true;
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: class {
				constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
			},
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			scrollTo: vi.fn(),
			write: async () => {
				throw new Error("denied");
			},
			pageOffset: () => ({ x: 0, y: 0 }),
		});

		try {
			await expect(clipboard.copy(readyPreview())).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(execCommand).not.toHaveBeenCalled();
		} finally {
			if (originalExecCommand) {
				Object.defineProperty(document, "execCommand", originalExecCommand);
			} else {
				delete (document as unknown as { execCommand?: unknown }).execCommand;
			}
		}
	});

	it("acquires a fresh actual transition owner for warm cached HTML through both Blob and post-write checks", async () => {
		const measurementModule = await import("./wechat-preview-measurement");
		const transitionOwners: Array<ReturnType<typeof vi.fn>> = [];
		let expectedTransitionOwners = 0;
		vi.spyOn(measurementModule, "createPreviewMeasurementLease").mockReturnValue(
			null,
		);
		vi.spyOn(measurementModule, "createPreviewTransitionLease").mockImplementation(
			() => {
				const cleanup = vi.fn();
				transitionOwners.push(cleanup);
				expectedTransitionOwners += 1;
				return {
					cleanup,
					isReady: () => true,
					ready: Promise.resolve(),
					wait: vi.fn(async () => undefined),
				};
			},
		);
		const writes: unknown[] = [];
		let releaseSecondWrite!: () => void;
		const secondWriteGate = new Promise<void>((resolve) => {
			releaseSecondWrite = resolve;
		});
		let secondPostWriteReached!: () => void;
		const secondPostWrite = new Promise<void>((resolve) => {
			secondPostWriteReached = resolve;
		});
		class ClipboardItemStub {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		const preview = readyPreview();
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: async (items) => {
				writes.push(items);
				const item = items[0] as ClipboardItemStub;
				await item.payload["text/html"];
				await item.payload["text/plain"];
				if (writes.length === 2) {
					expect(transitionOwners).toHaveLength(expectedTransitionOwners);
					expect(expectedTransitionOwners).toBe(2);
					expect(transitionOwners[0]).toHaveBeenCalledOnce();
					expect(transitionOwners[1]).not.toHaveBeenCalled();
					secondPostWriteReached();
					await secondWriteGate;
				}
			},
		});
		await expect(clipboard.copy(preview)).resolves.toEqual({
			method: "clipboard",
			status: "copied",
		});
		expect(transitionOwners).toHaveLength(1);
		expect(transitionOwners[0]).toHaveBeenCalledOnce();
		const secondCopy = clipboard.copy(preview);
		await secondPostWrite;
		expect(transitionOwners[1]).not.toHaveBeenCalled();
		releaseSecondWrite();
		await expect(secondCopy).resolves.toEqual({
			method: "clipboard",
			status: "copied",
		});
		expect(writes).toHaveLength(2);
		expect(transitionOwners[1]).toHaveBeenCalledOnce();
	});

	it("waits for a delayed modern write instead of misclassifying it as failed", async () => {
		vi.useFakeTimers();
		let resolveWrite: (() => void) | undefined;
		const write = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveWrite = resolve;
				}),
		);
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: class {
				constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
			},
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			scrollTo: vi.fn(),
			write,
			pageOffset: () => ({ x: 0, y: 0 }),
		});
		const copy = clipboard.copy(readyPreview());
		let settled = false;
		copy.finally(() => {
			settled = true;
		});

		try {
			await vi.advanceTimersByTimeAsync(2_501);
			expect(settled).toBe(false);
			resolveWrite?.();
			await expect(copy).resolves.toEqual({
				method: "clipboard",
				status: "copied",
			});
			expect(write).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it("fails a modern write that remains stalled after payload preparation", async () => {
		vi.useFakeTimers();
		let payloadConsumed = false;
		const write = vi.fn(async (items: unknown[]) => {
			const item = items[0] as {
				payload: Record<string, Blob | PromiseLike<Blob>>;
			};
			await item.payload["text/html"];
			payloadConsumed = true;
			await new Promise<void>(() => undefined);
		});
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: class {
				constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
			},
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			scrollTo: vi.fn(),
			write,
			pageOffset: () => ({ x: 0, y: 0 }),
		});

		try {
			const copy = clipboard.copy(readyPreview());
			for (
				let elapsed = 0;
				elapsed < 1_000 && !payloadConsumed;
				elapsed += 10
			) {
				await vi.advanceTimersByTimeAsync(10);
			}
			expect(payloadConsumed).toBe(true);
			await vi.advanceTimersByTimeAsync(CLIPBOARD_COMMIT_TIMEOUT_MS);
			await expect(copy).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(write).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it("bounds deferred payload preparation separately from the browser commit", async () => {
		vi.useFakeTimers();
		const pendingImage = deferred<Response>();
		let committed = false;
		class ClipboardItemStub {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		const preview = document.createElement("article");
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML = "<h1>Timeout payload</h1>";
		Object.defineProperty(preview, "innerText", {
			configurable: true,
			value: "Timeout payload",
		});
		const imageUrl = new URL(
			"/assets/images/timeout-payload.png",
			document.baseURI,
		).href;
		const fetch = vi.fn(() => pendingImage.promise);
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			fetch,
			getComputedStyle: (element, pseudoElement) => {
				if ("H1" === element.tagName && "::before" === pseudoElement) {
					return declaration({
						content: '""',
						display: "block",
						background: `url("${imageUrl}")`,
						"background-image": `url("${imageUrl}")`,
					});
				}
				return pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element);
			},
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: vi.fn(async (items) => {
				const item = items[0] as ClipboardItemStub;
				await item.payload["text/html"];
				committed = true;
			}),
		});

		try {
			const copy = clipboard.copy(preview);
			let settled = false;
			void copy.then(
				() => {
					settled = true;
				},
				() => {
					settled = true;
				},
			);
			await vi.advanceTimersByTimeAsync(CLIPBOARD_COMMIT_TIMEOUT_MS);
			expect(settled).toBe(false);
			await vi.advanceTimersByTimeAsync(
				WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS - CLIPBOARD_COMMIT_TIMEOUT_MS,
			);
			await expect(copy).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(committed).toBe(false);
			pendingImage.resolve({
				blob: async () => new Blob(["late"], { type: "image/png" }),
				ok: true,
				url: imageUrl,
			} as unknown as Response);
			await vi.advanceTimersByTimeAsync(1);
			expect(fetch).toHaveBeenCalledOnce();
			expect(committed).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not commit a portable payload when the copy is aborted before the first browser task", async () => {
		let committed = false;
		const controller = new AbortController();
		class ClipboardItemStub {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: vi.fn(async (items) => {
				const item = items[0] as ClipboardItemStub;
				await item.payload["text/html"];
				committed = true;
			}),
		});

		const copy = clipboard.copy(readyPreview(), {
			isCurrent: () => true,
			signal: controller.signal,
		});
		controller.abort();

		await expect(copy).resolves.toEqual({
			code: "wechat-copy-failed",
			status: "failed",
		});
		expect(committed).toBe(false);
	});

	it("does not commit a portable payload after the copy generation becomes stale before the first browser task", async () => {
		let committed = false;
		let current = true;
		class ClipboardItemStub {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: vi.fn(async (items) => {
				const item = items[0] as ClipboardItemStub;
				await item.payload["text/html"];
				committed = true;
			}),
		});

		const copy = clipboard.copy(readyPreview(), { isCurrent: () => current });
		current = false;

		await expect(copy).resolves.toEqual({
			code: "wechat-copy-failed",
			status: "failed",
		});
		expect(committed).toBe(false);
	});

	it("uses a prepared legacy payload when modern Clipboard setup throws synchronously", async () => {
		const originalExecCommand = Object.getOwnPropertyDescriptor(
			document,
			"execCommand",
		);
		const execCommand = vi.fn(() => {
			dispatchSuccessfulLegacyCopy();
			return true;
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		const write = vi.fn(() => {
			throw new Error("clipboard-write-setup-failed");
		});
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: class {
				constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
			},
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write,
		});
		const preview = readyPreview();

		try {
			await prepareClipboard(clipboard, preview);
			await expect(clipboard.copy(preview)).resolves.toEqual({
				method: "legacy",
				status: "copied",
			});
			expect(write).toHaveBeenCalledOnce();
			expect(execCommand).toHaveBeenCalledWith("copy");
		} finally {
			if (originalExecCommand) {
				Object.defineProperty(document, "execCommand", originalExecCommand);
			} else {
				delete (document as unknown as { execCommand?: unknown }).execCommand;
			}
		}
	});

	it("does not use a stale ready payload after a computed layout change", async () => {
		const originalExecCommand = Object.getOwnPropertyDescriptor(
			document,
			"execCommand",
		);
		let width = "100px";
		let legacyHtml = "";
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: vi.fn(() => {
				legacyHtml =
					document.querySelector(".easymde-copy-sandbox")?.innerHTML ?? "";
				dispatchSuccessfulLegacyCopy();
				return true;
			}),
		});
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: class {
				constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
			},
			document,
			getComputedStyle: (element, pseudoElement) => {
				if (!pseudoElement && "P" === element.tagName) {
					return declaration({ display: "block", width });
				}
				return pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element);
			},
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: vi.fn(() => {
				throw new Error("clipboard-write-setup-failed");
			}),
		});
		const preview = readyPreview();

		try {
			await prepareClipboard(clipboard, preview);
			width = "200px";
			await expect(clipboard.copy(preview)).resolves.toEqual({
				method: "legacy",
				status: "copied",
			});
			expect(legacyHtml).toContain("width:200px");
			expect(legacyHtml).not.toContain("width:100px");
		} finally {
			if (originalExecCommand) {
				Object.defineProperty(document, "execCommand", originalExecCommand);
			} else {
				delete (document as unknown as { execCommand?: unknown }).execCommand;
			}
		}
	});

	it("reports deferred payload failure even when modern write resolves first", async () => {
		const imageUrl = new URL(
			"/assets/images/cupid-busy-heart.png",
			document.baseURI,
		).href;
		const fetch = vi.fn(
			async () =>
				({
					ok: false,
					blob: async () => new window.Blob([], { type: "image/png" }),
				}) as unknown as Response,
		);
		const preview = document.createElement("article");
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML = "<h1>Theme heading</h1>";
		Object.defineProperty(preview, "innerText", {
			configurable: true,
			value: "Theme heading",
		});
		const clipboard = createBrowserWechatClipboard({
			blob: window.Blob,
			clipboardItem: class {
				constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
			},
			document,
			fetch,
			getComputedStyle: (element, pseudoElement) => {
				if ("H1" === element.tagName && "::before" === pseudoElement) {
					return declaration({
						content: '""',
						display: "block",
						width: "20px",
						height: "20px",
						background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
						"background-image": `url("${imageUrl}")`,
					});
				}
				return pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element);
			},
			getSelection: window.getSelection.bind(window),
			scrollTo: vi.fn(),
			write: async () => undefined,
			pageOffset: () => ({ x: 0, y: 0 }),
		});

		await expect(clipboard.copy(preview)).resolves.toEqual({
			code: "wechat-copy-failed",
			status: "failed",
		});
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("uses the synchronous compatibility copy only when modern write is unavailable", async () => {
		const source = document.createElement("button");
		let copiedMarkup = "";
		const scrollTo = vi.fn();
		const originalExecCommand = Object.getOwnPropertyDescriptor(
			document,
			"execCommand",
		);
		document.body.appendChild(source);
		source.focus();
		try {
			Object.defineProperty(document, "execCommand", {
				configurable: true,
				value: vi.fn(() => {
					const sandbox = document.querySelector(
						".easymde-copy-sandbox",
					) as HTMLElement | null;
					copiedMarkup = sandbox?.innerHTML ?? "";
					sandbox?.focus();
					dispatchSuccessfulLegacyCopy();
					return true;
				}),
			});
			const execCommand = vi.spyOn(document, "execCommand");
			const clipboard = createBrowserWechatClipboard({
				blob: Blob,
				clipboardItem: null,
				document,
				getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
				getSelection: window.getSelection.bind(window),
				scrollTo,
				write: null,
				pageOffset: () => ({ x: 5, y: 8 }),
			});

			const preview = readyPreview();
			await prepareClipboard(clipboard, preview);
			await expect(clipboard.copy(preview)).resolves.toEqual({
				method: "legacy",
				status: "copied",
			});
			expect(copiedMarkup).toContain("max-width:100%");
			expect(copiedMarkup).not.toContain("data-easymde-");
			expect(execCommand).toHaveBeenCalledWith("copy");
			expect(document.querySelector(".easymde-copy-sandbox")).toBeNull();
			expect(document.activeElement).toBe(source);
			expect(scrollTo).toHaveBeenCalledWith(5, 8);
		} finally {
			if (originalExecCommand) {
				Object.defineProperty(document, "execCommand", originalExecCommand);
			} else {
				delete (document as unknown as { execCommand?: unknown }).execCommand;
			}
			source.remove();
		}
	});

	it("falls back to the current payload when ClipboardItem setup rejects synchronously", async () => {
		let legacyHtml = "";
		const originalExecCommand = Object.getOwnPropertyDescriptor(
			document,
			"execCommand",
		);
		try {
			Object.defineProperty(document, "execCommand", {
				configurable: true,
				value: vi.fn(() => {
					legacyHtml =
						document.querySelector(".easymde-copy-sandbox")?.innerHTML ?? "";
					dispatchSuccessfulLegacyCopy();
					return true;
				}),
			});
			class RejectingClipboardItem {
				constructor(_payload: Record<string, Blob | PromiseLike<Blob>>) {
					throw new TypeError("deferred clipboard items are unsupported");
				}
			}
			const write = vi.fn(async () => undefined);
			const clipboard = createBrowserWechatClipboard({
				blob: Blob,
				clipboardItem: RejectingClipboardItem,
				document,
				getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
				getSelection: window.getSelection.bind(window),
				scrollTo: vi.fn(),
				write,
				pageOffset: () => ({ x: 0, y: 0 }),
			});

			await expect(clipboard.copy(readyPreview())).resolves.toEqual({
				method: "legacy",
				status: "copied",
			});
			expect(write).not.toHaveBeenCalled();
			expect(legacyHtml).toContain("Rendered");
		} finally {
			if (originalExecCommand) {
				Object.defineProperty(document, "execCommand", originalExecCommand);
			} else {
				delete (document as unknown as { execCommand?: unknown }).execCommand;
			}
		}
	});

	it.each([
		[
			"ClipboardItem construction",
			() =>
				class ThrowingClipboardItem {
					constructor() {
						throw new TypeError("deferred clipboard items are unsupported");
					}
				},
			vi.fn(async () => undefined),
		],
		[
			"synchronous write invocation",
			() =>
				class ClipboardItemStub {
					constructor(
						public payload: Record<string, Blob | PromiseLike<Blob>>,
					) {}
				},
			vi.fn(() => {
				throw new TypeError("clipboard write rejected synchronously");
			}),
		],
	])(
		"does not copy portable math when eligible vector adoption is unavailable during %s",
		async (_failure, clipboardItem, write) => {
			const assetBaseUrl = new URL(
				"/wp-content/plugins/easymde/",
				document.baseURI,
			).href;
			const contentVersion = "0123456789abcdef";
			const atlasUrl = new URL(
				`assets/math/easymde-katex-glyph-atlas.json?contentversion=${contentVersion}`,
				assetBaseUrl,
			).href;
			const fetch = vi.fn(
				async () =>
					({
						arrayBuffer: async () =>
							new TextEncoder().encode('{"schema":"unused"}').buffer,
						headers: new Headers(),
						ok: true,
					}) as Response,
			);
			const preview = document.createElement("article");
			preview.setAttribute("data-easymde-preview-html-sink", "1");
			preview.innerHTML =
				'<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">A</span></span></span></div>';
			Object.defineProperty(preview, "innerText", {
				configurable: true,
				value: "A",
			});
			const execCommand = vi.fn(() => {
				dispatchSuccessfulLegacyCopy();
				return true;
			});
			Object.defineProperty(document, "execCommand", {
				configurable: true,
				value: execCommand,
			});
			const clipboard = createBrowserWechatClipboard({
				approvedAssetBaseUrl: assetBaseUrl,
				approvedKaTeXCssUrl: new URL(
					"assets/vendor/katex/katex.min.css",
					assetBaseUrl,
				).href,
				blob: Blob,
				clipboardItem: clipboardItem(),
				document,
				fetch,
				getComputedStyle: (element, pseudoElement) => {
					if (pseudoElement) return declaration({ content: "none" });
					if (element.classList.contains("easymde-math-block")) {
						return declaration({
							display: "inline-block",
							width: "100px",
							height: "40px",
						});
					}
					if (element.classList.contains("mord"))
						return declaration({ display: "inline" });
					return pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element);
				},
				getSelection: window.getSelection.bind(window),
				pageOffset: () => ({ x: 0, y: 0 }),
				scrollTo: vi.fn(),
				wechatMathAtlasContentVersion: contentVersion,
				wechatMathAtlasUrl: atlasUrl,
				write,
			});

			await expect(clipboard.copy(preview)).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(execCommand).not.toHaveBeenCalled();
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it("keeps true-inline math on the legacy path when no vector owner is eligible", async () => {
		const legacyHtml: string[] = [];
		const execCommand = vi.fn(() => {
			legacyHtml.push(
				document.querySelector(".easymde-copy-sandbox")?.innerHTML ?? "",
			);
			dispatchSuccessfulLegacyCopy();
			return true;
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		const preview = document.createElement("article");
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML =
			'<span class="easymde-math-inline"><span class="katex"><span class="katex-html"><span class="mord">A</span></span></span></span>';
		Object.defineProperty(preview, "innerText", {
			configurable: true,
			value: "A",
		});
		class ThrowingClipboardItem {
			constructor() {
				throw new TypeError("deferred clipboard items are unsupported");
			}
		}

		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: ThrowingClipboardItem,
			document,
			getComputedStyle: (element, pseudoElement) => {
				if (pseudoElement) return declaration({ content: "none" });
				if (element.classList.contains("easymde-math-inline")) {
					return declaration({ display: "inline" });
				}
				if (element.classList.contains("mord"))
					return declaration({ display: "inline" });
				return pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element);
			},
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: vi.fn(async () => undefined),
		});

		await expect(clipboard.copy(preview)).resolves.toEqual({
			method: "legacy",
			status: "copied",
		});
		expect(execCommand).toHaveBeenCalledOnce();
		expect(legacyHtml[0]).toContain("A");
	});

	it("does not reuse a prepared payload after root-only style changes", async () => {
		const originalExecCommand = Object.getOwnPropertyDescriptor(
			document,
			"execCommand",
		);
		const execCommand = vi.fn(() => {
			dispatchSuccessfulLegacyCopy();
			return true;
		});
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		});
		try {
			const clipboard = createBrowserWechatClipboard({
				blob: Blob,
				clipboardItem: null,
				document,
				getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
				getSelection: window.getSelection.bind(window),
				scrollTo: vi.fn(),
				write: null,
				pageOffset: () => ({ x: 0, y: 0 }),
			});
			const preview = readyPreview();
			await prepareClipboard(clipboard, preview);

			preview.classList.add("easymde-font-overrides");

			await expect(clipboard.copy(preview)).resolves.toEqual({
				code: "wechat-copy-failed",
				status: "failed",
			});
			expect(execCommand).not.toHaveBeenCalled();
		} finally {
			if (originalExecCommand) {
				Object.defineProperty(document, "execCommand", originalExecCommand);
			} else {
				delete (document as unknown as { execCommand?: unknown }).execCommand;
			}
		}
	});

	it("does not reuse a prepared payload after responsive computed layout changes", async () => {
		const writes: unknown[] = [];
		let width = "100px";
		class ClipboardItemStub {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		const preview = document.createElement("article");
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML = "<p>Responsive layout</p>";
		Object.defineProperty(preview, "innerText", {
			configurable: true,
			value: "Responsive layout",
		});
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			getComputedStyle: (element, pseudoElement) => {
				if (!pseudoElement && "P" === element.tagName) {
					return declaration({ display: "block", width });
				}
				return pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element);
			},
			getSelection: window.getSelection.bind(window),
			scrollTo: vi.fn(),
			write: async (items) => {
				writes.push(items);
			},
			pageOffset: () => ({ x: 0, y: 0 }),
		});

		await prepareClipboard(clipboard, preview);
		await expect(clipboard.copy(preview)).resolves.toEqual({
			method: "clipboard",
			status: "copied",
		});
		const firstItem = (writes[0] as ClipboardItemStub[])[0];
		const firstHtml = firstItem?.payload["text/html"];
		if (!firstHtml) throw new Error("first clipboard html missing");
		expect(await blobText(firstHtml)).toContain("width:100px");

		width = "200px";
		await expect(clipboard.copy(preview)).resolves.toEqual({
			method: "clipboard",
			status: "copied",
		});
		const secondItem = (writes[1] as ClipboardItemStub[])[0];
		const secondHtml = secondItem?.payload["text/html"];
		if (!secondHtml) throw new Error("second clipboard html missing");
		expect(await blobText(secondHtml)).toContain("width:200px");
	});

	it("rejects live source markup changes after the warm-cache freshness walk", async () => {
		const writes: unknown[] = [];
		let committed = false;
		class ClipboardItemStub {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		const preview = document.createElement("article");
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML = "<p>Original</p>";
		Object.defineProperty(preview, "innerText", {
			configurable: true,
			value: "Original",
		});
		let mutateDuringFreshness = false;
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			getComputedStyle: (element, pseudoElement) => {
				if (
					!pseudoElement &&
					"P" === element.tagName &&
					mutateDuringFreshness
				) {
					mutateDuringFreshness = false;
					element.textContent = "Changed";
				}
				return pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element);
			},
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: vi.fn(),
			write: async (items) => {
				writes.push(items);
				const item = items[0] as ClipboardItemStub | undefined;
				const html = item?.payload["text/html"];
				if (!html) throw new Error("clipboard html missing");
				await blobText(html);
				committed = true;
			},
		});

		await prepareClipboard(clipboard, preview);
		mutateDuringFreshness = true;
		await expect(clipboard.copy(preview)).resolves.toEqual({
			code: "wechat-copy-failed",
			status: "failed",
		});
		expect(writes).toHaveLength(1);
		expect(committed).toBe(false);
	});

	it("feeds modern Clipboard and legacy copy with the same normalized HTML", async () => {
		const preview = document.createElement("article");
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML =
			"<div><h4>相同载荷</h4><p><strong>Portable</strong></p></div>";
		Object.defineProperty(preview, "innerText", {
			configurable: true,
			value: "相同载荷\nPortable",
		});
		class ClipboardItemStub {
			constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
		}
		const writes: unknown[] = [];
		const runtime = {
			blob: Blob,
			clipboardItem: ClipboardItemStub,
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			scrollTo: vi.fn(),
			write: async (items: unknown[]) => {
				writes.push(items);
			},
			pageOffset: () => ({ x: 0, y: 0 }),
		};
		const modern = createBrowserWechatClipboard(runtime);
		await expect(modern.copy(preview)).resolves.toEqual({
			method: "clipboard",
			status: "copied",
		});
		const modernItem = (writes[0] as ClipboardItemStub[])[0];
		const modernBlob = modernItem?.payload["text/html"];
		if (!modernBlob) throw new Error("modern clipboard html missing");
		const modernHtml = await blobText(modernBlob);

		let legacyHtml = "";
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: vi.fn(() => {
				legacyHtml =
					document.querySelector(".easymde-copy-sandbox")?.innerHTML ?? "";
				dispatchSuccessfulLegacyCopy();
				return true;
			}),
		});
		const legacy = createBrowserWechatClipboard({
			...runtime,
			clipboardItem: null,
			write: null,
		});
		await prepareClipboard(legacy, preview);
		await expect(legacy.copy(preview)).resolves.toEqual({
			method: "legacy",
			status: "copied",
		});
		expect(legacyHtml).toBe(modernHtml);
	});

	it("returns an explicit failure when modern and compatibility copy both fail", async () => {
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: vi.fn(() => false),
		});
		const clipboard = createBrowserWechatClipboard({
			blob: Blob,
			clipboardItem: class {
				constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
			},
			document,
			getComputedStyle: (element: Element, pseudoElement?: string) =>
				pseudoElement
					? declaration({ content: "none" })
					: computedStyle(element),
			getSelection: window.getSelection.bind(window),
			scrollTo: vi.fn(),
			write: vi.fn(async () => {
				throw new Error("denied");
			}),
			pageOffset: () => ({ x: 0, y: 0 }),
		});

		await expect(clipboard.copy(readyPreview())).resolves.toEqual({
			code: "wechat-copy-failed",
			status: "failed",
		});
		expect(document.querySelector(".easymde-copy-sandbox")).toBeNull();
	});
});
