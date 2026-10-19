import { describe, expect, it, vi } from "vitest";

import {
	computedStyle,
	declaration,
	installClipboardTestEnvironment,
	readyPreview,
} from "./wechat-clipboard-test-fixtures";
import type {
	BrowserWechatClipboardRuntime,
	SerializationYield,
} from "./wechat-clipboard-runtime";
import type { WechatMathSourceAdmissionResult } from "./wechat-math-static-flow";
import {
	captureWechatMathSourceAdmission,
	captureWechatMathSourceAdmissionSynchronously,
	createMarkupSynchronously,
} from "./wechat-portable-serialization";
import type { WechatMathSourceCaptureResult } from "./wechat-portable-serialization";
import {
	reusablePreparedClipboardPayload,
	type PreparedClipboardPayload,
} from "./wechat-prepared-payload";
import {
	serializeClipboardPayload,
	serializeClipboardPayloadSynchronously,
} from "./wechat-portable-serialization";

describe("portable serialization math admission plumbing", () => {
	installClipboardTestEnvironment();

	it("forwards an optional immutable admission through async and sync serializers without changing output", async () => {
		const preview = readyPreview();
		const runtime: BrowserWechatClipboardRuntime = {
			blob: Blob,
			clipboardItem: null,
			document,
			getComputedStyle: computedStyle,
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: () => undefined,
			write: null,
		};
		const sourceAdmission = Object.freeze({
			sourceRoot: preview,
		}) as unknown as WechatMathSourceAdmissionResult;

		try {
			const asyncBaseline = await serializeClipboardPayload(
				preview,
				runtime,
				new Map(),
			);
			const asyncWithAdmission = await serializeClipboardPayload(
				preview,
				runtime,
				new Map(),
				null,
				undefined,
				undefined,
				preview,
				null,
				null,
				sourceAdmission,
			);
			const syncBaseline = serializeClipboardPayloadSynchronously(
				preview,
				runtime,
			);
			const syncWithAdmission = serializeClipboardPayloadSynchronously(
				preview,
				runtime,
				preview,
				null,
				null,
				sourceAdmission,
			);

			expect(asyncWithAdmission).toEqual(asyncBaseline);
			expect(syncWithAdmission).toEqual(syncBaseline);
		} finally {
			preview.remove();
		}
	});

	it("uses document.getAnimations for descendant and ancestor WAAPI targets while keeping raw geometry distinct", () => {
		const sourceRoot = document.createElement("div");
		sourceRoot.className = "katex-html";
		const descendant = document.createElement("span");
		descendant.className = "vlist";
		sourceRoot.append(descendant);
		const ancestor = document.createElement("section");
		ancestor.append(sourceRoot);
		document.body.append(ancestor);

		const animations = [
			{ effect: { target: ancestor } },
			{ effect: { target: descendant } },
		] as unknown as Animation[];
		const getAnimations = vi.fn(() => animations);
		const originalDescriptor = Object.getOwnPropertyDescriptor(
			document,
			"getAnimations",
		);
		Object.defineProperty(document, "getAnimations", {
			configurable: true,
			value: getAnimations,
		});
		const runtime: BrowserWechatClipboardRuntime = {
			blob: Blob,
			clipboardItem: null,
			document,
			getComputedStyle: computedStyle,
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: () => undefined,
			write: null,
		};

		try {
			const result = captureWechatMathSourceAdmissionSynchronously(
				sourceRoot,
				runtime,
				true,
				undefined,
				undefined,
				"raw-geometry-signature",
			);
			if (!result.sourceAdmission)
				throw new Error("math-source-admission-missing");
			expect(
				result.sourceAdmission.sourceNodes.get(sourceRoot)?.animationIntersects,
			).toBe(true);
			expect(
				result.sourceAdmission.sourceNodes.get(descendant)?.animationIntersects,
			).toBe(true);
			expect(getAnimations).toHaveBeenCalledTimes(1);
			expect(result.sourceFingerprint).not.toBe(
				result.rawDimensionGeometrySignature,
			);
			expect(result.rawDimensionGeometrySignature).toBe(
				"raw-geometry-signature",
			);
		} finally {
			sourceRoot.remove();
			if (originalDescriptor)
				Object.defineProperty(document, "getAnimations", originalDescriptor);
			else Reflect.deleteProperty(document, "getAnimations");
		}
	});

	it("omits hidden math during synchronous and asynchronous serialization instead of failing visible content", async () => {
		const preview = document.createElement("article");
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		preview.innerHTML =
			'<p>Visible</p><div class="hidden-math easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="vlist">Hidden formula</span></span></span></span></div><div class="visible-math easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="vlist">Shown row<span class="hidden-row">Hidden row</span></span></span></span></span></div>';
		const originalRect = Element.prototype.getBoundingClientRect;
		const originalAnimations = Object.getOwnPropertyDescriptor(
			document,
			"getAnimations",
		);
		Object.defineProperty(Element.prototype, "getBoundingClientRect", {
			configurable: true,
			value(this: Element) {
				const hidden = Boolean(this.closest(".hidden-math, .hidden-row"));
				const left = hidden ? 10 : 0;
				const top = hidden ? 20 : 0;
				const width = hidden ? 120 : 320;
				const height = hidden ? 20 : 200;
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
				};
			},
		});
		Object.defineProperty(document, "getAnimations", {
			configurable: true,
			value: () => [],
		});
		const runtime: BrowserWechatClipboardRuntime = {
			blob: Blob,
			clipboardItem: null,
			document,
			getComputedStyle: (element, pseudoElement) => {
				if (pseudoElement)
					return element.classList.contains("vlist")
						? declaration({
								content: '"marker"',
								display: "inline",
								position: "static",
							})
						: declaration({
								content: "none",
								display: "inline",
								position: "static",
							});
				if (element.closest(".hidden-math, .hidden-row"))
					return declaration({ display: "none" });
				if (element.classList.contains("easymde-math-block")) {
					return declaration({
						display: "block",
						height: "20px",
						width: "120px",
						"overflow-x": "auto",
						"overflow-y": "hidden",
					});
				}
				if (
					element.classList.contains("katex") ||
					element.classList.contains("katex-display")
				) {
					return declaration({
						display: "inline",
						height: "20px",
						width: "120px",
						"white-space": "nowrap",
					});
				}
				if (element.classList.contains("katex-html"))
					return declaration({
						display: "inline",
						height: "20px",
						width: "120px",
					});
				if (element.classList.contains("vlist"))
					return declaration({
						display: "table-cell",
						height: "20px",
						width: "120px",
					});
				return declaration({ display: "block" });
			},
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: () => undefined,
			write: null,
		};
		try {
			const output = createMarkupSynchronously(preview, runtime);
			expect(output).not.toBeNull();
			expect(output?.textContent).toContain("Visible");
			expect(output?.textContent).toContain("Shown row");
			expect(output?.textContent).not.toContain("Hidden formula");
			expect(output?.textContent).not.toContain("Hidden row");
			expect(output?.querySelector(".hidden-math")).toBeNull();
			const asyncPayload = await serializeClipboardPayload(
				preview,
				runtime,
				new Map(),
			);
			expect(asyncPayload.html).toContain("Visible");
			expect(asyncPayload.html).not.toContain("Hidden formula");
		} finally {
			preview.remove();
			Object.defineProperty(Element.prototype, "getBoundingClientRect", {
				configurable: true,
				value: originalRect,
			});
			if (originalAnimations)
				Object.defineProperty(document, "getAnimations", originalAnimations);
			else Reflect.deleteProperty(document, "getAnimations");
		}
	});

	it("rejects prepared reuse when either math freshness sink changes", () => {
		const payload = { html: "<p>payload</p>", text: "payload" };
		const mathSourceAdmission: WechatMathSourceCaptureResult = {
			rawDimensionGeometrySignature: "raw-geometry",
			runtime: null,
			sourceAdmission: null,
			sourceFingerprint: "source-fingerprint",
		};
		const prepared: PreparedClipboardPayload = {
			backgroundCancel: null,
			dimensionSignature: "dimensions",
			fallback: null,
			layoutOwner: "live",
			layoutSignature: "layout",
			mathSourceAdmission,
			payload,
			promise: Promise.resolve(payload),
			recoveredAtLayoutSignature: null,
			sequence: 1,
			sourceMarkup: "source",
		};

		expect(
			reusablePreparedClipboardPayload(
				prepared,
				"source",
				"dimensions",
				"layout",
				null,
				"source-fingerprint",
				"raw-geometry",
			),
		).toBe(payload);
		expect(
			reusablePreparedClipboardPayload(
				prepared,
				"source",
				"dimensions",
				"layout",
				null,
				"other-source",
				"raw-geometry",
			),
		).toBeNull();
		expect(
			reusablePreparedClipboardPayload(
				prepared,
				"source",
				"dimensions",
				"layout",
				null,
				"source-fingerprint",
				"other-geometry",
			),
		).toBeNull();
		expect(
			reusablePreparedClipboardPayload(
				prepared,
				"source",
				"dimensions",
				"layout",
				null,
				"source-fingerprint",
				"",
			),
		).toBeNull();
	});

	it("cancels yielded capture and rejects stale synchronous capture", async () => {
		const sourceRoot = document.createElement("div");
		sourceRoot.className = "katex-html";
		sourceRoot.append(
			Object.assign(document.createElement("span"), { className: "vlist" }),
		);
		document.body.append(sourceRoot);
		const originalDescriptor = Object.getOwnPropertyDescriptor(
			document,
			"getAnimations",
		);
		Object.defineProperty(document, "getAnimations", {
			configurable: true,
			value: () => [],
		});
		const runtime: BrowserWechatClipboardRuntime = {
			blob: Blob,
			clipboardItem: null,
			document,
			getComputedStyle: computedStyle,
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: () => undefined,
			write: null,
		};
		try {
			const controller = new AbortController();
			const yieldToBrowser = Object.assign(
				async () => {
					controller.abort();
				},
				{ shouldYield: () => true },
			) as SerializationYield;
			await expect(
				captureWechatMathSourceAdmission(
					sourceRoot,
					runtime,
					yieldToBrowser,
					controller.signal,
				),
			).rejects.toMatchObject({ name: "AbortError" });
			expect(() =>
				captureWechatMathSourceAdmissionSynchronously(
					sourceRoot,
					runtime,
					true,
					undefined,
					() => false,
				),
			).toThrow("wechat-copy-cancelled");
		} finally {
			sourceRoot.remove();
			if (originalDescriptor)
				Object.defineProperty(document, "getAnimations", originalDescriptor);
			else Reflect.deleteProperty(document, "getAnimations");
		}
	});

	it("rejects a bound admission when the raw dimension signature is missing", async () => {
		const preview = readyPreview();
		const runtime: BrowserWechatClipboardRuntime = {
			blob: Blob,
			clipboardItem: null,
			document,
			getComputedStyle: computedStyle,
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: () => undefined,
			write: null,
		};
		const sourceAdmission = Object.freeze({
			groups: [{}],
			sourceRoot: preview,
		}) as unknown as WechatMathSourceAdmissionResult;
		try {
			await expect(
				serializeClipboardPayload(
					preview,
					runtime,
					new Map(),
					null,
					undefined,
					undefined,
					preview,
					null,
					null,
					sourceAdmission,
					"source-fingerprint",
					"",
					{} as never,
				),
			).rejects.toThrow("wechat-math-static-flow-dimension-signature-missing");
		} finally {
			preview.remove();
		}
	});

	it("skips supplied math admission and animation reads at the PNG conversion boundary", async () => {
		const preview = readyPreview();
		preview.className = "katex-html";
		const vlist = document.createElement("span");
		vlist.className = "vlist";
		vlist.textContent = "PNG";
		preview.append(vlist);
		let typedReads = 0;
		Object.defineProperty(preview, "computedStyleMap", {
			configurable: true,
			value: () => {
				typedReads += 1;
				return { get: () => ({ value: "auto" }) };
			},
		});
		const runtime: BrowserWechatClipboardRuntime = {
			blob: Blob,
			clipboardItem: null,
			document,
			getComputedStyle: computedStyle,
			getSelection: window.getSelection.bind(window),
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: () => undefined,
			write: null,
		};
		const getAnimations = vi.fn(() => {
			throw new Error("math-animation-read-should-be-skipped");
		});
		const originalDescriptor = Object.getOwnPropertyDescriptor(
			document,
			"getAnimations",
		);
		Object.defineProperty(document, "getAnimations", {
			configurable: true,
			value: getAnimations,
		});
		const conversionController = new AbortController();
		const conversion = {
			captureBoundary: preview,
			imageUploadPort: {} as never,
			isCurrent: () => true,
			maxBytes: 1024,
			mermaidSnapshots: new Map(),
			postId: 1,
			rasterizationPort: {} as never,
			scale: 1,
			signal: conversionController.signal,
			state: { uploadsMayRemain: false },
		} as never;
		const sourceAdmission = Object.freeze({
			groups: [],
			sourceRoot: preview,
		}) as unknown as WechatMathSourceAdmissionResult;

		try {
			await serializeClipboardPayload(
				preview,
				runtime,
				new Map(),
				null,
				conversion,
				undefined,
				preview,
				null,
				null,
				sourceAdmission,
				"supplied-source-fingerprint",
				"supplied-raw-geometry",
			);
			expect(getAnimations).not.toHaveBeenCalled();
			expect(typedReads).toBe(0);
		} finally {
			preview.remove();
			if (originalDescriptor)
				Object.defineProperty(document, "getAnimations", originalDescriptor);
			else Reflect.deleteProperty(document, "getAnimations");
		}
	});
});
