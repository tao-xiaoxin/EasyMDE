// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./wechat-managed-fonts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./wechat-managed-fonts")>()),
	collectFontFaces: () => [
		{
			descriptors: [
				'font-family:"KaTeX_Main"',
				"font-style:normal",
				"font-weight:400",
				"font-stretch:normal",
			],
			family: '"KaTeX_Main"',
			familyKey: "katex_main",
			sources: [
				{
					format: "woff2",
					scope: { kind: "katex", rootPath: "/assets/vendor/katex/fonts/" },
					url: new URL(
						"/wp-content/plugins/easymde/assets/vendor/katex/fonts/KaTeX_Main-Regular.woff2",
						document.baseURI,
					).href,
				},
			],
		},
	],
}));

import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import { computedStyle } from "./wechat-clipboard-test-fixtures";
import type { WechatMathVectorAtlas } from "./wechat-math-vector-scene";
import {
	type PreparedClipboardPayload,
	type PreparedClipboardSerializationReady,
	preparedClipboardPayload,
	preparedClipboardPayloadAfterWrite,
} from "./wechat-prepared-payload";
import {
	createHiddenPreviewGeometryMeasurement,
	type WechatPreviewMeasurementLease,
} from "./wechat-preview-measurement";
import {
	type ClipboardSourceFreshnessState,
	createClipboardSourceFreshnessGuard,
} from "./wechat-source-freshness";

const atlas: WechatMathVectorAtlas = {
	fonts: [
		{
			cmap: [{ codepoint: 65, glyphId: 1 }],
			file: "KaTeX_Main-Regular.woff2",
			glyphs: [
				{ advanceWidth: 500, id: 1, outline: { pathData: "M0 0L1 0L1 1Z" } },
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
};

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

function declaration(values: Record<string, string>): CSSStyleDeclaration {
	return {
		getPropertyValue: (property: string) => values[property] ?? "",
	} as CSSStyleDeclaration;
}

function domRect(
	left: number,
	top: number,
	width: number,
	height: number,
): DOMRect {
	return {
		bottom: top + height,
		height,
		left,
		right: left + width,
		top,
		width,
		x: left,
		y: top,
		toJSON: () => ({}),
	} as DOMRect;
}

function preview(
	markup = "<p>Prepared payload</p>",
	options: Readonly<{ vectorCaptureGeometry?: boolean }> = {},
): HTMLElement {
	Object.defineProperty(document, "getAnimations", {
		configurable: true,
		value: () => [],
	});
	const root = document.createElement("article");
	root.setAttribute("data-easymde-preview-html-sink", "1");
	root.innerHTML = markup;
	Object.defineProperty(root, "innerText", {
		configurable: true,
		get(this: HTMLElement) {
			return this.textContent ?? "";
		},
	});
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement): DOMRect {
			if (options.vectorCaptureGeometry) {
				if (this.style.width === "0px" && this.style.height === "0px")
					return domRect(10, 20, 0, 0);
				if (this.classList.contains("mord")) return domRect(10, 10, 30, 20);
				if (this.classList.contains("katex-html"))
					return domRect(10, 10, 30, 20);
				if (this.classList.contains("easymde-math-block"))
					return domRect(0, 0, 100, 40);
				return domRect(0, 0, 100, 40);
			}
			const owner = this.closest(".easymde-math-block");
			const inMeasurement = Boolean(
				this.closest(".easymde-wechat-preview-measurement"),
			);
			const offset = inMeasurement ? 10 : 0;
			const isMord = this.classList.contains("mord");
			const isHtml = this.classList.contains("katex-html");
			const isProbe =
				this.style.width === "0px" ||
				this.style.cssText.includes("width:0 !important");
			const width = isProbe
				? 0
				: isMord
					? 20
					: isHtml
						? 100
						: owner
							? 100
							: 400;
			const height = isProbe ? 0 : isMord ? 20 : isHtml ? 40 : owner ? 40 : 240;
			const left =
				isMord || isHtml ? offset + (inMeasurement ? 12 : 12) : offset;
			const top =
				isMord || isHtml ? offset + (inMeasurement ? 10 : 10) : offset;
			const right = left + width;
			const bottom = top + height;
			return {
				bottom,
				height,
				left,
				right,
				top,
				width,
				x: left,
				y: top,
				toJSON: () => ({}),
			} as DOMRect;
		},
	);
	Object.defineProperty(Range.prototype, "getBoundingClientRect", {
		configurable: true,
		value: function (this: Range): DOMRect {
			if (options.vectorCaptureGeometry) {
				const start = this.startOffset;
				return domRect(12 + start * 8, 10, 8, 20);
			}
			const offset = this.startContainer.parentElement?.closest(
				".easymde-wechat-preview-measurement",
			)
				? 10
				: 0;
			return {
				bottom: 30 + offset,
				height: 20,
				left: offset,
				right: 20 + offset,
				top: 10 + offset,
				width: 20,
				x: offset,
				y: 10 + offset,
				toJSON: () => ({}),
			} as DOMRect;
		},
	});
	root.style.display = "none";
	const workspace = document.createElement("div");
	workspace.style.width = "400px";
	workspace.append(root);
	document.body.append(workspace);
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: [
			{
				family: "KaTeX_Main",
				stretch: "normal",
				style: "normal",
				weight: "400",
				status: "loaded",
			},
		],
	});
	return root;
}

function runtime(
	overrides: Partial<BrowserWechatClipboardRuntime> = {},
): BrowserWechatClipboardRuntime {
	return {
		approvedAssetBaseUrl: new URL(
			"/wp-content/plugins/easymde/",
			document.baseURI,
		).href,
		approvedKaTeXCssUrl: new URL(
			"/wp-content/plugins/easymde/assets/vendor/katex/katex.min.css",
			document.baseURI,
		).href,
		blob: Blob,
		clipboardItem: null,
		document,
		getComputedStyle: (element, pseudoElement) =>
			pseudoElement
				? computedStyle(element, pseudoElement)
				: declaration({
						...initialMathBoxStyle,
						display: element.matches(".mord")
							? "inline-block"
							: element.matches(".easymde-math-block")
								? "inline-block"
								: "block",
						"font-family": "KaTeX_Main",
						"font-size": "10px",
						"font-style": "normal",
						"font-weight": "400",
						"font-stretch": "normal",
						color: "#111111",
						height: element.matches(".easymde-math-block, .katex-html")
							? "40px"
							: element.matches(".mord")
								? "20px"
								: "",
						opacity: "1",
						transform: "none",
						visibility: "visible",
						width: element.matches(".easymde-math-block, .katex-html")
							? "100px"
							: element.matches(".mord")
								? "20px"
								: "",
					}),
		getSelection: () => null,
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: () => undefined,
		wechatMathAtlasContentVersion: "0123456789abcdef",
		wechatMathAtlasUrl: new URL(
			"/wp-content/plugins/easymde/assets/math/easymde-katex-glyph-atlas.json?contentversion=0123456789abcdef",
			document.baseURI,
		).href,
		write: null,
		...overrides,
	};
}

function measurementLease(
	root: HTMLElement,
	cleanup = vi.fn(),
): ReturnType<typeof createHiddenPreviewGeometryMeasurement> {
	const lease = createHiddenPreviewGeometryMeasurement(root, runtime());
	const cleanupLease = lease.cleanup;
	let released = false;
	return {
		...lease,
		cleanup: () => {
			if (released) return;
			released = true;
			cleanup();
			cleanupLease();
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = "";
	delete (Range.prototype as unknown as { getBoundingClientRect?: unknown })
		.getBoundingClientRect;
	if (Object.hasOwn(document, "getAnimations")) {
		Reflect.deleteProperty(document, "getAnimations");
	}
});

describe("prepared Clipboard quote snapshot freshness", () => {
	type NestedCapRead = Readonly<{
		maxInlineSize: string;
		maxWidth: string;
		measurement: boolean;
		source: boolean;
	}>;

	function quoteRuntime(
		sourceNested: Element,
		reads: NestedCapRead[],
	): BrowserWechatClipboardRuntime {
		const ownerValues: Record<string, string> = {
			"block-size": "auto",
			"border-bottom-style": "none",
			"border-bottom-width": "0px",
			"border-left-style": "none",
			"border-left-width": "0px",
			"border-right-style": "none",
			"border-right-width": "0px",
			"border-top-style": "none",
			"border-top-width": "0px",
			direction: "ltr",
			display: "block",
			float: "none",
			height: "auto",
			"inline-size": "auto",
			"margin-bottom": "20px",
			"margin-left": "0px",
			"margin-right": "0px",
			"margin-top": "20px",
			"max-block-size": "none",
			"max-height": "none",
			"max-inline-size": "none",
			"max-width": "none",
			"min-block-size": "auto",
			"min-height": "0px",
			"min-inline-size": "auto",
			"min-width": "auto",
			"padding-bottom": "18px",
			"padding-left": "48px",
			"padding-right": "20px",
			"padding-top": "18px",
			position: "relative",
			transform: "none",
			visibility: "visible",
			width: "auto",
			"writing-mode": "horizontal-tb",
		};
		const beforeValues: Record<string, string> = {
			bottom: "auto",
			"border-bottom-style": "none",
			"border-bottom-width": "0px",
			"border-left-style": "none",
			"border-left-width": "0px",
			"border-right-style": "none",
			"border-right-width": "0px",
			"border-top-style": "none",
			"border-top-width": "0px",
			"box-sizing": "content-box",
			content: '"✨"',
			"counter-increment": "none",
			"counter-reset": "none",
			"counter-set": "none",
			display: "block",
			filter: "none",
			float: "none",
			height: "20px",
			left: "16px",
			"margin-bottom": "0px",
			"margin-left": "0px",
			"margin-right": "0px",
			"margin-top": "0px",
			mask: "none",
			"mask-image": "none",
			"max-block-size": "none",
			"max-height": "none",
			"max-inline-size": "none",
			"max-width": "none",
			"min-block-size": "auto",
			"min-height": "0px",
			"min-inline-size": "auto",
			"min-width": "0px",
			opacity: "1",
			"padding-bottom": "0px",
			"padding-left": "0px",
			"padding-right": "0px",
			"padding-top": "0px",
			position: "absolute",
			right: "auto",
			top: "18px",
			transform: "none",
			visibility: "visible",
			width: "21.1016px",
			"writing-mode": "horizontal-tb",
		};
		return runtime({
			getComputedStyle: (element, pseudoElement) => {
				if (element.matches("blockquote")) {
					if (pseudoElement === "::before") return declaration(beforeValues);
					if (pseudoElement === "::after")
						return declaration({
							content: "none",
							display: "none",
							visibility: "visible",
						});
					const nested = element.matches(".nested-quote");
					if (nested) {
						const nestedOwner = {
							...ownerValues,
							"max-inline-size": "100%",
							"max-width": "100%",
						};
						reads.push({
							maxInlineSize: nestedOwner["max-inline-size"],
							maxWidth: nestedOwner["max-width"],
							measurement: Boolean(
								element.closest(".easymde-wechat-preview-measurement"),
							),
							source: element === sourceNested,
						});
						return declaration(nestedOwner);
					}
					return declaration(ownerValues);
				}
				if (pseudoElement) return computedStyle(element, pseudoElement);
				if (element.matches("p"))
					return declaration({ display: "block", "margin-top": "10px" });
				return declaration({ display: "block" });
			},
		});
	}

	it.each([false, true])(
		"observes nested owner caps and reuses one cold transaction payload (background=%s)",
		async (background) => {
			const root = preview(
				'<blockquote class="outer-quote"><p>Outer text</p><blockquote class="nested-quote"><p>Nested text</p></blockquote></blockquote>',
			);
			const nestedSource = root.querySelector(".nested-quote");
			if (!nestedSource) throw new Error("nested quote source missing");
			const reads: NestedCapRead[] = [];
			const runtimeValue = quoteRuntime(nestedSource, reads);
			const backgroundAssetCache = new Map();
			const preparedPayloads = new WeakMap<
				HTMLElement,
				PreparedClipboardPayload
			>();
			const sourceMarkup = root.innerHTML;
			const serialization = await import("./wechat-portable-serialization");
			const serialize = vi.spyOn(serialization, "serializeClipboardPayload");
			const measurement = createHiddenPreviewGeometryMeasurement(
				root,
				runtimeValue,
			);
			const cleanupMeasurement = measurement.cleanup;
			const supplied: WechatPreviewMeasurementLease = {
				...measurement,
				cleanup: vi.fn(),
				root: measurement.root,
			};
			const prepared = preparedClipboardPayload(
				root,
				runtimeValue,
				backgroundAssetCache,
				preparedPayloads,
				() => 1,
				false,
				background,
				undefined,
				supplied,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				null,
				undefined,
			);
			const firstPayload = await prepared.promise;
			expect(firstPayload).toMatchObject({
				html: expect.stringContaining("<section"),
				text: expect.stringContaining("Nested text"),
			});
			expect(prepared.payload).not.toBeNull();
			expect(reads.some((read) => read.source)).toBe(true);
			expect(reads.some((read) => read.measurement)).toBe(true);
			expect(reads.length).toBeGreaterThan(0);
			expect(
				reads.every(
					(read) => read.maxInlineSize === "100%" && read.maxWidth === "100%",
				),
			).toBe(true);

			const reuseSupplied: WechatPreviewMeasurementLease = {
				...supplied,
			};
			const reused = preparedClipboardPayload(
				root,
				runtimeValue,
				backgroundAssetCache,
				preparedPayloads,
				() => 2,
				false,
				false,
				undefined,
				reuseSupplied,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				null,
				undefined,
			);
			await expect(reused.promise).resolves.toBe(firstPayload);
			expect(reused).toBe(prepared);
			expect(preparedPayloads.get(root)).toBe(prepared);
			expect(serialize).toHaveBeenCalledOnce();
			cleanupMeasurement();
			expect(
				document.querySelectorAll(".easymde-wechat-preview-measurement"),
			).toHaveLength(0);
			expect(root.innerHTML).toBe(sourceMarkup);
		},
	);
});

describe("prepared Clipboard math vector admission", () => {
	it("does not request an atlas when no owner is vector eligible", async () => {
		const root = preview(
			'<span class="easymde-math-inline"><span class="katex"><span class="katex-html">A</span></span></span>',
		);
		const loader = vi.fn(async () => atlas);
		const prepared = preparedClipboardPayload(
			root,
			runtime({
				getComputedStyle: (element, pseudoElement) =>
					["::before", "::after"].includes(pseudoElement ?? "")
						? computedStyle(element, pseudoElement)
						: declaration({ display: "inline" }),
			}),
			new Map(),
			new WeakMap(),
			() => 1,
			false,
			false,
			undefined,
			measurementLease(root),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			null,
			loader,
		);
		await expect(prepared.promise).resolves.toMatchObject({
			text: expect.stringContaining("A"),
		});
		expect(loader).not.toHaveBeenCalled();
	});

	it("copies visible configured vector math through one owned offscreen measurement", async () => {
		const root = preview(
			'<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">A</span></span></span></div>',
			{ vectorCaptureGeometry: true },
		);
		root.style.display = "block";
		const sourceMarkup = root.outerHTML;
		const loader = vi.fn(async () => atlas);
		const prepared = preparedClipboardPayload(
			root,
			runtime(),
			new Map(),
			new WeakMap(),
			() => 1,
			false,
			false,
			undefined,
			null,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			null,
			loader,
		);

		const payload = await prepared.promise;
		const holder = document.createElement("div");
		holder.innerHTML = payload.html;
		expect(payload.text).toBe("A");
		expect(holder.querySelector("svg")).not.toBeNull();
		expect(root.outerHTML).toBe(sourceMarkup);
		expect(root.textContent).toBe("A");
		expect(loader).toHaveBeenCalledOnce();
		expect(
			document.querySelectorAll(".easymde-wechat-preview-measurement"),
		).toHaveLength(0);
	});

	it("excludes only the visible vector owner subtree from legacy static flow", async () => {
		const root = preview(
			'<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="vlist">A</span></span></span></div><span class="vlist">B</span>',
			{ vectorCaptureGeometry: true },
		);
		root.style.display = "block";
		const owner = root.querySelector(".easymde-math-block");
		const nestedGroup = owner?.querySelector(".vlist");
		const siblingGroup = root.querySelector(":scope > .vlist");
		if (!owner || !nestedGroup || !siblingGroup)
			throw new Error("static-flow fixture missing");
		const snapshot = vi.spyOn(
			await import("./wechat-math-static-flow"),
			"captureWechatMathStaticFlowSnapshot",
		);
		const loader = vi.fn(async () => atlas);
		const prepared = preparedClipboardPayload(
			root,
			runtime(),
			new Map(),
			new WeakMap(),
			() => 1,
			false,
			false,
			undefined,
			null,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			null,
			loader,
		);

		await expect(prepared.promise).resolves.toBeTruthy();
		expect(snapshot).toHaveBeenCalledOnce();
		const admission = snapshot.mock.calls[0]?.[0].sourceAdmission;
		const retainedSources =
			admission?.groups.map((group) => group.source) ?? [];
		expect(retainedSources).toContain(siblingGroup);
		expect(retainedSources).not.toContain(nestedGroup);
		expect(owner.isConnected).toBe(true);
	});

	it.each([
		[
			"abort",
			(_root: HTMLElement, controller: AbortController) => controller.abort(),
			"wechat-background-preparation-cancelled",
		],
		[
			"stale",
			(root: HTMLElement) => root.setAttribute("data-stale", "1"),
			"wechat-copy-stale",
		],
	] as const)(
		"releases a captured visible vector measurement after post-capture %s",
		async (_label, invalidate, expectedError) => {
			const root = preview(
				'<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">A</span></span></span></div>',
				{ vectorCaptureGeometry: true },
			);
			root.style.display = "block";
			const controller = new AbortController();
			const serialization = await import("./wechat-portable-serialization");
			const originalSerialize = serialization.serializeClipboardPayload;
			const serialize = vi
				.spyOn(serialization, "serializeClipboardPayload")
				.mockImplementation(async (...args) => {
					expect(
						document.querySelectorAll(".easymde-wechat-preview-measurement"),
					).toHaveLength(1);
					invalidate(root, controller);
					return originalSerialize(...args);
				});
			const prepared = preparedClipboardPayload(
				root,
				runtime(),
				new Map(),
				new WeakMap(),
				() => 1,
				false,
				false,
				controller.signal,
				null,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				null,
				async () => atlas,
			);

			await expect(prepared.promise).rejects.toThrow(expectedError);
			await vi.waitFor(() =>
				expect(
					document.querySelectorAll(".easymde-wechat-preview-measurement"),
				).toHaveLength(0),
			);
			expect(serialize).toHaveBeenCalledOnce();
			expect(prepared.payload).toBeNull();
		},
	);

	it("releases each visible vector measurement across repeated cold preparations", async () => {
		const root = preview(
			'<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">A</span></span></span></div>',
			{ vectorCaptureGeometry: true },
		);
		root.style.display = "block";
		const backgroundAssetCache = new Map();
		const preparedPayloads = new WeakMap<
			HTMLElement,
			PreparedClipboardPayload
		>();
		const loader = vi.fn(async () => atlas);

		for (let revision = 0; revision < 3; revision += 1) {
			root.setAttribute("data-revision", String(revision));
			const prepared = preparedClipboardPayload(
				root,
				runtime(),
				backgroundAssetCache,
				preparedPayloads,
				() => revision + 1,
				false,
				false,
				undefined,
				null,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				null,
				loader,
			);
			const payload = await prepared.promise;
			expect(payload.text).toBe("A");
			expect(
				document.querySelectorAll(".easymde-wechat-preview-measurement"),
			).toHaveLength(0);
		}
		expect(loader).toHaveBeenCalledTimes(3);
	});

	it("keeps eligible legacy math portable when both atlas fields are absent", async () => {
		const root = preview(
			'<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">A</span></span></span></div>',
		);
		const cleanup = vi.fn();
		const prepared = preparedClipboardPayload(
			root,
			runtime(),
			new Map(),
			new WeakMap(),
			() => 1,
			false,
			false,
			undefined,
			measurementLease(root, cleanup),
		);
		await expect(prepared.promise).resolves.toMatchObject({
			text: expect.stringContaining("A"),
		});
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("rejects font-scope gaps before atlas fetch", async () => {
		const root = preview(
			'<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">A</span></span></span></div>',
		);
		const loader = vi.fn(async () => atlas);
		const prepared = preparedClipboardPayload(
			root,
			runtime({ approvedAssetBaseUrl: "", approvedKaTeXCssUrl: "" }),
			new Map(),
			new WeakMap(),
			() => 1,
			false,
			false,
			undefined,
			measurementLease(root),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			null,
			loader,
		);
		await expect(prepared.promise).rejects.toThrow(
			"wechat-math-vector-font-scope-missing",
		);
		expect(loader).not.toHaveBeenCalled();
	});

	it("keeps a background vector failure explicit with no payload or partial reusable scene", async () => {
		const root = preview(
			'<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">A</span></span></span></div>',
		);
		const cache = new WeakMap();
		const cleanup = vi.fn();
		const loader = vi.fn(async () => {
			throw new Error("atlas-injected-failure");
		});
		const prepared = preparedClipboardPayload(
			root,
			runtime(),
			new Map(),
			cache,
			() => 1,
			false,
			true,
			undefined,
			measurementLease(root, cleanup),
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			null,
			loader,
		);
		await expect(prepared.promise).rejects.toThrow("atlas-injected-failure");
		expect(prepared.payload).toBeNull();
		expect(prepared.fallback).toBeNull();
		expect(cache.get(root)).toBeUndefined();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(loader).toHaveBeenCalledOnce();
	});

	it("passes the atlas loader through after-write preparation and releases its lease exactly once when capture fails", async () => {
		const root = preview(
			'<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">A</span></span></span></div>',
		);
		const cleanup = vi.fn();
		const lease = measurementLease(root, cleanup);
		vi.spyOn(
			await import("./wechat-preview-measurement"),
			"createPreviewMeasurementLease",
		).mockReturnValue(lease);
		const freshness: ClipboardSourceFreshnessState = {
			current: () => createClipboardSourceFreshnessGuard(root),
			ready: Promise.resolve(),
		};
		const loader = vi.fn(async () => atlas);
		const prepared = await preparedClipboardPayloadAfterWrite(
			root,
			runtime(),
			new Map(),
			new WeakMap(),
			() => 1,
			{},
			freshness,
			undefined,
			undefined,
			undefined,
			loader,
		);
		await expect(prepared.promise).rejects.toThrow(
			"wechat-math-vector-capture-baseline-invalid",
		);
		await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
		expect(loader).toHaveBeenCalledOnce();
		expect(prepared.payload).toBeNull();
	});

	it("releases a background owner once after successful settlement", async () => {
		const root = preview("<p>Background owner settlement</p>");
		const cleanup = vi.fn();
		const lease = measurementLease(root, cleanup);
		const prepared = preparedClipboardPayload(
			root,
			runtime(),
			new Map(),
			new WeakMap(),
			() => 1,
			false,
			true,
			undefined,
			lease,
		);
		await expect(prepared.promise).resolves.toBeTruthy();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("does not serialize a background payload after its signal aborts", async () => {
		const root = preview(
			'<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">A</span></span></span></div>',
		);
		const controller = new AbortController();
		const cleanup = vi.fn();
		const lease = measurementLease(root, cleanup);
		const prepared = preparedClipboardPayload(
			root,
			runtime(),
			new Map(),
			new WeakMap(),
			() => 1,
			false,
			true,
			controller.signal,
			lease,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			null,
			async () => {
				controller.abort();
				return atlas;
			},
		);
		await expect(prepared.promise).rejects.toThrow("wechat-copy-cancelled");
		await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
		expect(prepared.payload).toBeNull();
	});


	it.each(["false", "throw"] as const)(
		"keeps producer cleanup ownership when registration returns %s",
		async (registration) => {
			const root = preview("<p>Registration owner source</p>");
			const cleanup = vi.fn();
			const lease = measurementLease(root, cleanup);
			vi.spyOn(
				await import("./wechat-preview-measurement"),
				"createPreviewMeasurementLease",
			).mockReturnValue(lease);
			const freshness: ClipboardSourceFreshnessState = {
				current: () => createClipboardSourceFreshnessGuard(root),
				ready: Promise.resolve(),
			};
			const callbackCleanup = vi.fn();
			await expect(
				preparedClipboardPayloadAfterWrite(
					root,
					runtime(),
					new Map(),
					new WeakMap(),
					() => 1,
					{},
					freshness,
					(cleanupOwner) => {
						callbackCleanup(cleanupOwner);
						if ("throw" === registration) {
							throw new Error("owner-registration-failed");
						}
						return false;
					},
					undefined,
					undefined,
					undefined,
					undefined,
				),
			).rejects.toThrow(
				"throw" === registration
					? "owner-registration-failed"
					: "wechat-copy-cancelled",
			);
			expect(callbackCleanup).toHaveBeenCalledOnce();
			expect(cleanup).toHaveBeenCalledOnce();
		},
	);

	it("registers the active transition owner before readiness settles", async () => {
		const root = preview("<p>Transition registration source</p>");
		root.style.display = "block";
		const cleanup = vi.fn();
		let settleReady!: () => void;
		const transition = {
			cleanup,
			isReady: () => false,
			ready: new Promise<void>((resolve) => {
				settleReady = resolve;
			}),
			wait: vi.fn(),
		};
		vi.spyOn(
			await import("./wechat-preview-measurement"),
			"createPreviewTransitionLease",
		).mockReturnValue(transition);
		const freshness: ClipboardSourceFreshnessState = {
			current: () => createClipboardSourceFreshnessGuard(root),
			ready: Promise.resolve(),
		};
		let registeredCleanup: (() => void) | null = null;
		let handedOffDimensionSemantics:
			| PreparedClipboardSerializationReady["dimensionSemantics"]
			| null = null;
		const preparedPromise = preparedClipboardPayloadAfterWrite(
			root,
			runtime(),
			new Map(),
			new WeakMap(),
			() => 1,
			{},
			freshness,
			(cleanupOwner) => {
				registeredCleanup = cleanupOwner;
				return true;
			},
			undefined,
			undefined,
			undefined,
			(value) => {
				handedOffDimensionSemantics = value.dimensionSemantics;
				expect(value.activeOwner).toBe("transition");
				expect(value.measurement).toBeNull();
				expect(value.transition).toBe(transition);
				expect(value.root).toBe(root);
			},
		);
		await vi.waitFor(() => expect(registeredCleanup).not.toBeNull());
		expect(cleanup).not.toHaveBeenCalled();
		settleReady();
		const prepared = await preparedPromise;
		await prepared.promise;
		expect(cleanup).not.toHaveBeenCalled();
		expect(handedOffDimensionSemantics).not.toBeNull();
		expect(
			document.querySelectorAll(".easymde-wechat-raw-dimension-context"),
		).toHaveLength(1);
		const acceptedCleanup = registeredCleanup as (() => void) | null;
		if (!acceptedCleanup) throw new Error("transition cleanup not registered");
		acceptedCleanup();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(
			document.querySelectorAll(".easymde-wechat-raw-dimension-context"),
		).toHaveLength(0);
		acceptedCleanup();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("invalidates a late ready callback after transaction close without cleanup callback side effects", async () => {
		const root = preview("<p>Late ready source</p>");
		const cleanup = vi.fn();
		let settleReady!: () => void;
		const transition = {
			cleanup,
			isReady: () => false,
			ready: new Promise<void>((resolve) => {
				settleReady = resolve;
			}),
			wait: vi.fn(),
		};
		vi.spyOn(
			await import("./wechat-preview-measurement"),
			"createPreviewTransitionLease",
		).mockReturnValue(transition);
		const freshness: ClipboardSourceFreshnessState = {
			current: () => createClipboardSourceFreshnessGuard(root),
			ready: Promise.resolve(),
		};
		let transactionOpen = true;
		let registeredCleanup: (() => void) | null = null;
		const preparedPromise = preparedClipboardPayloadAfterWrite(
			root,
			runtime(),
			new Map(),
			new WeakMap(),
			() => 1,
			{},
			freshness,
			(cleanupOwner) => {
				registeredCleanup = cleanupOwner;
				return transactionOpen;
			},
			undefined,
			undefined,
			undefined,
			() => {
				if (!transactionOpen) throw new Error("wechat-copy-cancelled");
			},
		);
		await vi.waitFor(() => expect(registeredCleanup).not.toBeNull());
		expect(cleanup).not.toHaveBeenCalled();
		transactionOpen = false;
		settleReady();
		await expect(preparedPromise).rejects.toThrow("wechat-copy-cancelled");
		expect(cleanup).not.toHaveBeenCalled();
		const acceptedCleanup = registeredCleanup as (() => void) | null;
		if (!acceptedCleanup) throw new Error("accepted cleanup missing");
		acceptedCleanup();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("retains an accepted owner when the later ready callback throws", async () => {
		const root = preview("<p>Ready callback failure source</p>");
		const cleanup = vi.fn();
		const lease = measurementLease(root, cleanup);
		vi.spyOn(
			await import("./wechat-preview-measurement"),
			"createPreviewMeasurementLease",
		).mockReturnValue(lease);
		const freshness: ClipboardSourceFreshnessState = {
			current: () => createClipboardSourceFreshnessGuard(root),
			ready: Promise.resolve(),
		};
		let acceptedCleanup: (() => void) | undefined;
		await expect(
			preparedClipboardPayloadAfterWrite(
				root,
				runtime(),
				new Map(),
				new WeakMap(),
				() => 1,
				{},
				freshness,
				(cleanupOwner) => {
					acceptedCleanup = cleanupOwner;
					return true;
				},
				undefined,
				undefined,
				undefined,
				() => {
					throw new Error("ready-callback-failed");
				},
			),
		).rejects.toThrow("ready-callback-failed");
		expect(cleanup).not.toHaveBeenCalled();
		if (!acceptedCleanup) throw new Error("accepted cleanup missing");
		acceptedCleanup();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("releases a warm-cache foreground owner when no transaction accepted it", async () => {
		const root = preview("<p>Unaccepted warm cache owner</p>");
		const backgroundAssetCache = new Map();
		const preparedPayloads = new WeakMap<
			HTMLElement,
			PreparedClipboardPayload
		>();
		const first = preparedClipboardPayload(
			root,
			runtime(),
			backgroundAssetCache,
			preparedPayloads,
			() => 1,
		);
		await first.promise;
		const cleanup = vi.fn();
		const lease = measurementLease(root, cleanup);
		vi.spyOn(
			await import("./wechat-preview-measurement"),
			"createPreviewMeasurementLease",
		).mockReturnValue(lease);
		const freshness: ClipboardSourceFreshnessState = {
			current: () => createClipboardSourceFreshnessGuard(root),
			ready: Promise.resolve(),
		};
		const warm = await preparedClipboardPayloadAfterWrite(
			root,
			runtime(),
			backgroundAssetCache,
			preparedPayloads,
			() => 2,
			{},
			freshness,
		);
		expect(warm).toBe(first);
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("hands the same ready hidden measurement lease to one transaction owner", async () => {
		const root = preview("<p>Ready table source</p>");
		const cleanup = vi.fn();
		const lease = measurementLease(root, cleanup);
		vi.spyOn(
			await import("./wechat-preview-measurement"),
			"createPreviewMeasurementLease",
		).mockReturnValue(lease);
		const freshness: ClipboardSourceFreshnessState = {
			current: () => createClipboardSourceFreshnessGuard(root),
			ready: Promise.resolve(),
		};
		let ready: PreparedClipboardSerializationReady | null = null;
		const prepared = await preparedClipboardPayloadAfterWrite(
			root,
			runtime(),
			new Map(),
			new WeakMap(),
			() => 1,
			{},
			freshness,
			() => true,
			undefined,
			undefined,
			undefined,
			(value) => {
				ready = value;
			},
		);
		const handedOff = ready as PreparedClipboardSerializationReady | null;
		if (!handedOff)
			throw new Error("serialization readiness was not handed off");
		expect(handedOff.activeOwner).toBe("measurement");
		expect(handedOff.measurement).toBe(lease);
		expect(handedOff.root).toBe(lease.root);
		expect(handedOff.transition).toBeNull();
		await prepared.promise;
		expect(cleanup).not.toHaveBeenCalled();
		lease.cleanup();
		lease.cleanup();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it("retains an accepted measurement owner when serialization readiness rejects", async () => {
		const root = preview("<p>Rejected readiness source</p>");
		const cleanup = vi.fn();
		const lease = measurementLease(root, cleanup);
		vi.spyOn(
			await import("./wechat-preview-measurement"),
			"createPreviewMeasurementLease",
		).mockReturnValue(lease);
		const sourceGuard = createClipboardSourceFreshnessGuard(root);
		const freshness: ClipboardSourceFreshnessState = {
			current: () => sourceGuard,
			ready: Promise.resolve(),
		};
		let acceptedCleanup: (() => void) | undefined;

		await expect(
			preparedClipboardPayloadAfterWrite(
				root,
				runtime(),
				new Map(),
				new WeakMap(),
				() => 1,
				{},
				freshness,
				(cleanupOwner) => {
					acceptedCleanup = cleanupOwner;
					return true;
				},
				undefined,
				undefined,
				undefined,
				() => {
					throw new Error("table-guard-readiness-failed");
				},
			),
		).rejects.toThrow("table-guard-readiness-failed");
		expect(cleanup).not.toHaveBeenCalled();
		if (!acceptedCleanup) throw new Error("accepted cleanup missing");
		acceptedCleanup();
		expect(cleanup).toHaveBeenCalledOnce();
		sourceGuard.dispose();
	});

	it("releases a handed-off measurement exactly once when the transaction cancels", async () => {
		const root = preview("<p>Cancelled table source</p>");
		const cleanup = vi.fn();
		const lease = measurementLease(root, cleanup);
		vi.spyOn(
			await import("./wechat-preview-measurement"),
			"createPreviewMeasurementLease",
		).mockReturnValue(lease);
		const sourceGuard = createClipboardSourceFreshnessGuard(root);
		const freshness: ClipboardSourceFreshnessState = {
			current: () => sourceGuard,
			ready: Promise.resolve(),
		};
		const prepared = await preparedClipboardPayloadAfterWrite(
			root,
			runtime(),
			new Map(),
			new WeakMap(),
			() => 1,
			{},
			freshness,
			() => true,
			undefined,
			undefined,
			undefined,
			() => undefined,
		);
		await prepared.promise;
		expect(cleanup).not.toHaveBeenCalled();
		lease.cleanup();
		lease.cleanup();
		sourceGuard.dispose();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	it.each(["resolve", "reject"] as const)(
		"hands measurement cleanup to the terminal transaction owner on %s",
		async (terminal) => {
			const root = preview(
				"reject" === terminal
					? '<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">A</span></span></span></div>'
					: "<p>Owned table source</p>",
			);
			const cleanup = vi.fn();
			const lease = measurementLease(root, cleanup);
			vi.spyOn(
				await import("./wechat-preview-measurement"),
				"createPreviewMeasurementLease",
			).mockReturnValue(lease);
			const freshness: ClipboardSourceFreshnessState = {
				current: () => createClipboardSourceFreshnessGuard(root),
				ready: Promise.resolve(),
			};
			let transactionCleanup: (() => void) | undefined;
			const prepared = await preparedClipboardPayloadAfterWrite(
				root,
				runtime(
					"reject" === terminal
						? { approvedAssetBaseUrl: "", approvedKaTeXCssUrl: "" }
						: {},
				),
				new Map(),
				new WeakMap(),
				() => 1,
				{},
				freshness,
				(cleanupOwner) => {
					transactionCleanup = cleanupOwner;
					return true;
				},
				undefined,
				undefined,
				"reject" === terminal ? async () => atlas : undefined,
				() => undefined,
			);
			if ("reject" === terminal) {
				await expect(prepared.promise).rejects.toThrow(
					"wechat-math-vector-font-scope-missing",
				);
			} else {
				await prepared.promise;
			}
			expect(cleanup).not.toHaveBeenCalled();
			if (!transactionCleanup)
				throw new Error("transaction cleanup owner missing");
			transactionCleanup();
			transactionCleanup();
			expect(cleanup).toHaveBeenCalledOnce();
		},
	);

	it("reuses fallback payload during background re-preparation when source and layout are unchanged", async () => {
		const root = preview("<p>Warm background reuse</p>");
		root.style.display = "block";
		const backgroundAssetCache = new Map();
		const preparedPayloads = new WeakMap<
			HTMLElement,
			PreparedClipboardPayload
		>();
		const serialization = await import("./wechat-portable-serialization");
		const serialize = vi.spyOn(serialization, "serializeClipboardPayload");
		const runtimeValue = runtime();

		const first = preparedClipboardPayload(
			root,
			runtimeValue,
			backgroundAssetCache,
			preparedPayloads,
			() => 1,
			true,
			true,
		);
		const firstPayload = await first.promise;
		expect(serialize).toHaveBeenCalledTimes(1);

		const second = preparedClipboardPayload(
			root,
			runtimeValue,
			backgroundAssetCache,
			preparedPayloads,
			() => 2,
			true,
			true,
		);
		const secondPayload = await second.promise;
		expect(secondPayload).toBe(firstPayload);
		expect(serialize).toHaveBeenCalledTimes(1);

		// A subsequent copy after background re-prep hits the warm cache without re-serializing
		const freshness: ClipboardSourceFreshnessState = {
			current: () => createClipboardSourceFreshnessGuard(root),
			ready: Promise.resolve(),
		};
		const warm = await preparedClipboardPayloadAfterWrite(
			root,
			runtimeValue,
			backgroundAssetCache,
			preparedPayloads,
			() => 3,
			{},
			freshness,
		);
		expect(warm.payload).toBe(firstPayload);
		expect(serialize).toHaveBeenCalledTimes(1);
	});
});
