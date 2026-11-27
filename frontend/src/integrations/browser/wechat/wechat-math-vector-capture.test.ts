// @vitest-environment jsdom

import katex from "katex";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import type { FontFaceCandidate } from "./wechat-managed-fonts";
import {
	captureWechatMathVectorScenes,
	type WechatMathVectorCaptureOptions,
} from "./wechat-math-vector-capture";
import type { WechatMathVectorAtlas } from "./wechat-math-vector-scene";
import {
	pairMeasurementElements,
	previewWorkspaceMeasurementWidth,
} from "./wechat-preview-measurement";
import { clipboardSourceMarkup } from "./wechat-source-freshness";

const originalRangeRect = Object.getOwnPropertyDescriptor(
	Range.prototype,
	"getBoundingClientRect",
);

const managedFace: FontFaceCandidate = {
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
			url: "https://example.test/KaTeX_Main-Regular.woff2",
		},
	],
};

const atlas = (): WechatMathVectorAtlas => ({
	fonts: [
		{
			cmap: [
				{ codepoint: 65, glyphId: 1 },
				{ codepoint: 0x1f600, glyphId: 2 },
			],
			file: "KaTeX_Main-Regular.woff2",
			glyphs: [
				{ advanceWidth: 500, id: 1, outline: { pathData: "M0 0L1 0L1 1Z" } },
				{ advanceWidth: 500, id: 2, outline: { pathData: "M0 0L2 0L2 2Z" } },
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

function styleFor(element: Element): CSSStyleDeclaration {
	const values: Record<string, string> = {
		"border-bottom-style": "none",
		"border-bottom-width": "0px",
		"border-left-style": "none",
		"border-left-width": "0px",
		"border-right-style": "none",
		"border-right-width": "0px",
		"border-top-style": "none",
		"border-top-width": "0px",
		color: "#111111",
		display: "block",
		"font-family": "KaTeX_Main",
		"font-feature-settings": "normal",
		"font-size": "10px",
		"font-stretch": "100%",
		"font-style": "normal",
		"font-variation-settings": "normal",
		"font-weight": "400",
		height: "20px",
		opacity: "1",
		overflow: "visible",
		"overflow-x": "visible",
		"overflow-y": "visible",
		"padding-bottom": "0px",
		"padding-left": "0px",
		"padding-right": "0px",
		"padding-top": "0px",
		transform: "none",
		visibility: "visible",
		width: "30px",
	};
	if (element.localName === "svg") {
		values.display = "inline-block";
		values.overflow = "hidden";
		values["overflow-x"] = "hidden";
		values["overflow-y"] = "hidden";
	}
	return {
		getPropertyValue: (property: string) => values[property] ?? "",
	} as unknown as CSSStyleDeclaration;
}

function createRuntime(): BrowserWechatClipboardRuntime {
	return {
		blob: Blob,
		clipboardItem: null,
		document,
		getComputedStyle: styleFor,
		getSelection: () => null,
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: () => undefined,
		write: null,
	};
}

function installFonts(faces: readonly Record<string, unknown>[]): void {
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: faces,
	});
}

function installRects(): void {
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		function (this: HTMLElement) {
			if (this.style.width === "0px" && this.style.height === "0px")
				return domRect(10, 20, 0, 0);
			if (this.classList.contains("mord")) return domRect(10, 10, 30, 20);
			if (this.classList.contains("katex-html")) return domRect(10, 10, 30, 20);
			if (this.classList.contains("easymde-math-block"))
				return domRect(0, 0, 100, 40);
			return domRect(0, 0, 100, 40);
		},
	);
	vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue(
		domRect(10, 10, 20, 20),
	);
	Object.defineProperty(Range.prototype, "getBoundingClientRect", {
		configurable: true,
		value: function (this: Range): DOMRect {
			const start = this.startOffset;
			return domRect(12 + start * 8, 10, start ? 8 : 8, 20);
		},
	});
}

function makeMeasurement(
	preview: HTMLElement,
): WechatMathVectorCaptureOptions["measurement"] & {
	wrapperCleanup: ReturnType<typeof vi.fn>;
} {
	const clone = preview.cloneNode(true) as HTMLElement;
	document.body.append(clone);
	const pairing = pairMeasurementElements(preview, clone);
	const leaseCleanup = vi.fn(() => clone.remove());
	const lease = {
		cleanup: leaseCleanup,
		isReady: () => true,
		measurementFor: (source: Element) => pairing.bySource.get(source) ?? null,
		ready: Promise.resolve(),
		root: clone,
		sourceGeometryReference: "measurement" as const,
		sourceMarkup: clipboardSourceMarkup(preview),
		sourceFor: (measurement: Element) =>
			pairing.byMeasurement.get(measurement) ?? null,
		sourceRoot: preview,
		sourceWidthKey: previewWorkspaceMeasurementWidth(preview, createRuntime()),
		wait: () => Promise.resolve(),
	};
	const wrapperCleanup = vi.fn(() => leaseCleanup());
	return {
		cleanup: wrapperCleanup,
		lease,
		wrapperCleanup,
	} as WechatMathVectorCaptureOptions["measurement"] & {
		wrapperCleanup: ReturnType<typeof vi.fn>;
	};
}

function fixture(content = '<span class="mord">A😀</span>'): {
	owner: Element;
	options: WechatMathVectorCaptureOptions;
	preview: HTMLElement;
	wrapperCleanup: ReturnType<typeof vi.fn>;
} {
	const preview = document.createElement("div");
	preview.innerHTML = `<div class="easymde-math-block"><span class="katex"><span class="katex-html">${content}</span></span></div>`;
	document.body.append(preview);
	const owner = preview.querySelector(".easymde-math-block");
	if (!owner) throw new Error("fixture owner missing");
	const runtime = createRuntime();
	installRects();
	const measurement = makeMeasurement(preview);
	installFonts([
		{
			family: "KaTeX_Main",
			style: "normal",
			weight: "400",
			stretch: "normal",
			status: "loaded",
		},
	]);
	return {
		owner,
		options: {
			atlas: atlas(),
			managedFaces: [managedFace],
			measurement,
			preview,
			runtime,
			sourceOwners: [owner],
		},
		preview,
		wrapperCleanup: (
			measurement as typeof measurement & {
				wrapperCleanup: ReturnType<typeof vi.fn>;
			}
		).wrapperCleanup,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = "";
	if (originalRangeRect)
		Object.defineProperty(
			Range.prototype,
			"getBoundingClientRect",
			originalRangeRect,
		);
});

function runtimeWithOverrides(
	test: ReturnType<typeof fixture>,
	overridesFor: (element: Element) => Readonly<Record<string, string>>,
): BrowserWechatClipboardRuntime {
	const base = test.options.runtime.getComputedStyle;
	return {
		...test.options.runtime,
		getComputedStyle: (element: Element) => {
			const original = base(element);
			const overrides = overridesFor(element);
			return {
				getPropertyValue: (property: string) =>
					overrides[property] ?? original.getPropertyValue(property),
			} as CSSStyleDeclaration;
		},
	};
}

describe("captureWechatMathVectorScenes", () => {
	it("captures complete paired text and cleanup ownership exactly once", async () => {
		const test = fixture();
		const originalText = test.preview.textContent;
		const result = await captureWechatMathVectorScenes(test.options);
		expect(result).toHaveLength(1);
		expect(result[0]?.sourceOwner).toBe(test.owner);
		expect(result[0]?.replacementShell).toBe(test.owner);
		expect(
			result[0]?.scene.runs[0]?.glyphs.map((glyph) => glyph.codepoint),
		).toEqual([65, 0x1f600]);
		expect(test.preview.textContent).toBe(originalText);
		expect(test.wrapperCleanup).toHaveBeenCalledOnce();
	});

	it("shares one primitive paint admission across mixed subtrees", async () => {
		Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
			configurable: true,
			value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 10 }) as DOMMatrix,
		});

		const validSvg =
			'<svg width="20" height="20" viewBox="0 0 10 10"><path d="M0 0L1 1" fill="#abcdef" stroke="none"></path></svg>';
		const createMixed = (svg: string): ReturnType<typeof fixture> =>
			fixture(
				`<span class="shared-paint"><span class="glyph-parent"><span class="mord">A</span></span><span class="frac-line"></span>${svg}</span>`,
			);
		const mixedRuntime = (
			test: ReturnType<typeof fixture>,
			mode:
				| "host-opacity-zero"
				| "opacity-zero"
				| "partial-alpha"
				| "svg-fill-alpha"
				| "visibility-hidden"
				| "visibility-visible-child",
		) =>
			runtimeWithOverrides(test, (element) => {
				const overrides: Record<string, string> = {};
				if (element.classList.contains("frac-line")) {
					overrides["border-bottom-width"] = "1px";
					overrides["border-bottom-style"] = "solid";
					overrides["border-bottom-color"] = "#000000";
				}
				if (mode === "host-opacity-zero") {
					if (element === test.options.measurement.lease.root.parentElement)
						overrides.opacity = "0";
				}
				if (element.closest(".shared-paint")) {
					if (mode === "opacity-zero") overrides.opacity = "0";
					if (mode === "partial-alpha") overrides.opacity = "0.5";
					if (
						mode === "visibility-hidden" ||
						mode === "visibility-visible-child"
					)
						overrides.visibility = "hidden";
					if (
						mode === "visibility-visible-child" &&
						(element.closest(".glyph-parent") ||
							element.localName.toLowerCase() === "path")
					)
						overrides.visibility = "visible";
				}
				if (
					mode === "svg-fill-alpha" &&
					element.localName.toLowerCase() === "path"
				)
					overrides["fill-opacity"] = "0.5";
				return overrides;
			});
		const assertRestored = (
			test: ReturnType<typeof fixture>,
			before: string,
		): void => {
			expect(test.preview.innerHTML).toBe(before);
			expect(test.wrapperCleanup).toHaveBeenCalledOnce();
		};

		for (const [mode, expected] of [
			["opacity-zero", [0, 0, 0]],
			["visibility-hidden", [0, 0, 0]],
			["visibility-visible-child", [1, 0, 1]],
			["host-opacity-zero", [1, 1, 1]],
		] as const) {
			const test = createMixed(validSvg);
			const before = test.preview.innerHTML;
			const result = await captureWechatMathVectorScenes({
				...test.options,
				runtime: mixedRuntime(test, mode),
			});
			expect([
				result[0]?.scene.runs.length ?? -1,
				result[0]?.scene.rulePaint.length ?? -1,
				result[0]?.scene.svgFragments.length ?? -1,
			]).toEqual(expected);
			assertRestored(test, before);
		}

		for (const mode of ["partial-alpha", "svg-fill-alpha"] as const) {
			const test = createMixed(validSvg);
			const before = test.preview.innerHTML;
			await expect(
				captureWechatMathVectorScenes({
					...test.options,
					runtime: mixedRuntime(test, mode),
				}),
			).rejects.toThrow("paint-invalid");
			assertRestored(test, before);
		}

		const hiddenInvalid = createMixed(
			'<svg width="20" height="20"><script></script></svg>',
		);
		const hiddenBefore = hiddenInvalid.preview.innerHTML;
		await expect(
			captureWechatMathVectorScenes({
				...hiddenInvalid.options,
				runtime: runtimeWithOverrides(hiddenInvalid, (element) =>
					element.closest(".shared-paint") ? { visibility: "hidden" } : {},
				),
			}),
		).rejects.toThrow("fragment-invalid");
		assertRestored(hiddenInvalid, hiddenBefore);
	});

	it.each([
		[
			"colorbox",
			String.raw`\colorbox{red}{A}`,
			{ "background-color": "rgb(255, 0, 0)" },
			1,
		],
		[
			"fcolorbox",
			String.raw`\fcolorbox{blue}{red}{A}`,
			{
				"background-color": "rgb(255, 0, 0)",
				"border-bottom-color": "rgb(0, 0, 255)",
				"border-bottom-style": "solid",
				"border-bottom-width": "1px",
				"border-left-color": "rgb(0, 0, 255)",
				"border-left-style": "solid",
				"border-left-width": "1px",
				"border-right-color": "rgb(0, 0, 255)",
				"border-right-style": "solid",
				"border-right-width": "1px",
				"border-top-color": "rgb(0, 0, 255)",
				"border-top-style": "solid",
				"border-top-width": "1px",
			},
			5,
		],
	] as const)(
		"captures real KaTeX %s background paint",
		async (_name, formula, paintStyle, expectedPaint) => {
			const test = fixture(
				katex
					.renderToString(formula, {
						output: "htmlAndMathml",
						throwOnError: true,
					})
					.replace(/^<span class="katex">/, "")
					.replace(/<\/span>$/, ""),
			);
			const runtime = runtimeWithOverrides(test, (element) =>
				element.classList.contains("colorbox") ||
				element.classList.contains("fcolorbox")
					? paintStyle
					: {},
			);
			const result = await captureWechatMathVectorScenes({
				...test.options,
				runtime,
			});
			const paints = result[0]?.scene.rulePaint ?? [];
			expect(paints).toHaveLength(expectedPaint);
			expect(paints.map((rule) => rule.fill)).toEqual([
				"rgb(255, 0, 0)",
				...Array.from({ length: expectedPaint - 1 }, () => "rgb(0, 0, 255)"),
			]);
		},
	);

	it.each([
		["transparent background", { "background-color": "transparent" }, false],
		[
			"hidden background",
			{
				"background-color": "rgb(255, 0, 0)",
				visibility: "hidden",
			},
			false,
		],
		[
			"unsupported visible gradient",
			{
				"background-color": "transparent",
				"background-image": "linear-gradient(red, blue)",
			},
			true,
		],
		[
			"unsupported visible image",
			{
				"background-color": "transparent",
				"background-image": 'url("https://example.test/paint.png")',
			},
			true,
		],
	] as const)(
		"handles %s paint explicitly",
		async (_name, paintStyle, rejects) => {
			const test = fixture('<span class="paint-negative"><span></span></span>');
			const runtime = runtimeWithOverrides(test, (element) =>
				element.classList.contains("paint-negative") ? paintStyle : {},
			);
			const capture = captureWechatMathVectorScenes({
				...test.options,
				runtime,
			});
			if (rejects) {
				await expect(capture).rejects.toThrow("paint-invalid");
				return;
			}
			const result = await capture;
			expect(result[0]?.scene.rulePaint).toHaveLength(0);
		},
	);

	it("omits hidden and zero-opacity text before font or atlas reads", async () => {
		for (const hiddenStyle of [
			{ display: "none", "font-family": "MissingFace" },
			{ opacity: "0", "font-family": "MissingFace" },
		]) {
			const test = fixture(
				'<span class="hidden-text">A</span><span class="mord">😀</span>',
			);
			const runtime = runtimeWithOverrides(test, (element) =>
				element.classList.contains("hidden-text") ? hiddenStyle : {},
			);
			const result = await captureWechatMathVectorScenes({
				...test.options,
				runtime,
			});
			expect(
				result[0]?.scene.runs.flatMap((run) =>
					run.glyphs.map((glyph) => glyph.codepoint),
				),
			).toEqual([0x1f600]);
			expect(test.preview.textContent).toContain("A😀");
		}
	});

	it("allows a visible child to override inherited hidden visibility", async () => {
		const test = fixture(
			'<span class="hidden-parent"><span class="visible-child">A</span></span><span class="mord">😀</span>',
		);
		const runtime = runtimeWithOverrides(test, (element) => {
			if (element.classList.contains("hidden-parent"))
				return { visibility: "hidden" };
			if (element.classList.contains("visible-child"))
				return { visibility: "visible" };
			return {};
		});
		const result = await captureWechatMathVectorScenes({
			...test.options,
			runtime,
		});
		expect(
			result[0]?.scene.runs.flatMap((run) =>
				run.glyphs.map((glyph) => glyph.codepoint),
			),
		).toEqual([65, 0x1f600]);
	});

	it("ignores Typed OM rejects for engine-unsupported mask aliases", async () => {
		const test = fixture();
		const owner = test.options.measurement.lease.root.querySelector(".mord");
		if (!owner) throw new Error("unmasked fixture missing");
		const cssOwner = document.defaultView ?? window;
		const originalCss = Object.getOwnPropertyDescriptor(cssOwner, "CSS");
		Object.defineProperty(cssOwner, "CSS", {
			configurable: true,
			value: {
				supports: (property: string, value: string): boolean =>
					"none" === value && "mask-border" !== property,
			},
		});
		Object.defineProperty(owner, "computedStyleMap", {
			configurable: true,
			value: () => ({
				get: (property: string) => {
					if ("mask-border" === property)
						throw new TypeError("unsupported Typed OM property");
					return { value: "none" };
				},
			}),
		});
		try {
			const result = await captureWechatMathVectorScenes(test.options);
			expect(result[0]?.scene.runs[0]?.glyphs[0]?.codepoint).toBe(65);
		} finally {
			if (originalCss) Object.defineProperty(cssOwner, "CSS", originalCss);
			else Reflect.deleteProperty(cssOwner, "CSS");
		}
	});

	it("keeps a supported Typed OM mask read failure explicit", async () => {
		const test = fixture(
			'<span class="masked-interior"><span class="mord">A</span></span>',
		);
		const masked =
			test.options.measurement.lease.root.querySelector(".masked-interior");
		if (!masked) throw new Error("masked fixture missing");
		const cssOwner = document.defaultView ?? window;
		const originalCss = Object.getOwnPropertyDescriptor(cssOwner, "CSS");
		Object.defineProperty(cssOwner, "CSS", {
			configurable: true,
			value: {
				supports: (property: string, value: string): boolean =>
					"mask-image" === property && "none" === value,
			},
		});
		Object.defineProperty(masked, "computedStyleMap", {
			configurable: true,
			value: () => ({
				get: (property: string): unknown => {
					if ("mask-image" === property)
						throw new TypeError("supported Typed OM read failed");
					return { value: "none" };
				},
			}),
		});
		try {
			await expect(captureWechatMathVectorScenes(test.options)).rejects.toThrow(
				"wechat-math-vector-capture-mask-unsupported",
			);
		} finally {
			if (originalCss) Object.defineProperty(cssOwner, "CSS", originalCss);
			else Reflect.deleteProperty(cssOwner, "CSS");
		}
		expect(test.wrapperCleanup).toHaveBeenCalledOnce();
	});

	it("rejects a mask on a hidden ancestor when a visible child paints", async () => {
		const test = fixture(
			'<span class="masked-hidden-parent"><span class="visible-child"><span class="mord">A</span></span></span>',
		);
		const before = test.preview.innerHTML;
		const runtime = runtimeWithOverrides(test, (element) => {
			if (element.classList.contains("masked-hidden-parent"))
				return {
					"mask-image": "linear-gradient(black, transparent)",
					visibility: "hidden",
				};
			if (element.classList.contains("visible-child"))
				return { visibility: "visible" };
			return {};
		});
		await expect(
			captureWechatMathVectorScenes({ ...test.options, runtime }),
		).rejects.toThrow("wechat-math-vector-capture-mask-unsupported");
		expect(test.preview.innerHTML).toBe(before);
		expect(test.wrapperCleanup).toHaveBeenCalledOnce();
		expect(
			document.querySelectorAll(".easymde-wechat-preview-measurement"),
		).toHaveLength(0);
	});

	it.each([
		[
			"visible canonical mask",
			{ "mask-image": "linear-gradient(black, transparent)" },
			"visible",
			"wechat-math-vector-capture-mask-unsupported",
		],
		[
			"visible canonical shorthand",
			{ mask: 'url("mask.svg")' },
			"visible",
			"wechat-math-vector-capture-mask-unsupported",
		],
		[
			"visible border-mask longhand",
			{ "mask-border-source": 'url("mask.svg")' },
			"visible",
			"wechat-math-vector-capture-mask-unsupported",
		],
		[
			"visible WebKit alias",
			{ "-webkit-mask-image": 'url("mask.svg")' },
			"visible",
			"wechat-math-vector-capture-mask-unsupported",
		],
		[
			"hidden masked subtree",
			{ "mask-image": "linear-gradient(black, transparent)" },
			"hidden",
			null,
		],
		[
			"zero-opacity masked subtree",
			{ "mask-image": "linear-gradient(black, transparent)" },
			"zero",
			null,
		],
		[
			"visible Typed OM mask alias",
			{},
			"typed",
			"wechat-math-vector-capture-mask-unsupported",
		],
		[
			"none mask",
			{ "mask-image": "none", "-webkit-mask-image": "none" },
			"visible",
			null,
		],
		[
			"mask placement shorthand with no image",
			{ mask: "0% 0% / contain", "mask-image": "none" },
			"visible",
			null,
		],
		[
			"mask border configuration with no source",
			{ "mask-border": "fill", "mask-border-source": "none" },
			"visible",
			null,
		],
	] as const)(
		"admits or rejects interior mask paint explicitly for %s",
		async (_label, maskStyle, visibility, expectedError) => {
			const test = fixture(
				'<span class="masked-interior"><span class="mord">A</span></span>',
			);
			const before = test.preview.innerHTML;
			const runtime = runtimeWithOverrides(test, (element) => {
				if (!element.closest(".masked-interior")) return {};
				return {
					...(visibility === "hidden" ? { visibility: "hidden" } : {}),
					...(visibility === "zero" ? { opacity: "0" } : {}),
					...maskStyle,
				};
			});
			const cssOwner = document.defaultView ?? window;
			const originalCss = Object.getOwnPropertyDescriptor(cssOwner, "CSS");
			if (visibility === "typed") {
				const masked =
					test.options.measurement.lease.root.querySelector(".masked-interior");
				if (!masked) throw new Error("masked fixture missing");
				Object.defineProperty(cssOwner, "CSS", {
					configurable: true,
					value: {
						supports: (property: string, value: string): boolean =>
							"mask-image" === property && "none" === value,
					},
				});
				Object.defineProperty(masked, "computedStyleMap", {
					configurable: true,
					value: () => ({
						get: (property: string) => ({
							value:
								"mask-image" === property ? 'url("typed-mask.svg")' : "none",
						}),
					}),
				});
			}
			try {
				const capture = captureWechatMathVectorScenes({
					...test.options,
					runtime,
				});
				if (expectedError) {
					await expect(capture).rejects.toThrow(expectedError);
				} else {
					const result = await capture;
					if (visibility === "visible") {
						expect(result[0]?.scene.runs).toHaveLength(1);
					} else {
						expect(result[0]?.scene.runs).toHaveLength(0);
					}
				}
			} finally {
				if (originalCss) Object.defineProperty(cssOwner, "CSS", originalCss);
				else Reflect.deleteProperty(cssOwner, "CSS");
			}
			expect(test.preview.innerHTML).toBe(before);
			expect(test.wrapperCleanup).toHaveBeenCalledOnce();
			expect(
				document.querySelectorAll(".easymde-wechat-preview-measurement"),
			).toHaveLength(0);
		},
	);

	it("rejects partial effective opacity instead of emitting opaque glyphs", async () => {
		const test = fixture(
			'<span class="partial-opacity">A</span><span class="mord">😀</span>',
		);
		const runtime = runtimeWithOverrides(test, (element) =>
			element.classList.contains("partial-opacity")
				? { opacity: "0.5", "font-family": "MissingFace" }
				: {},
		);
		await expect(
			captureWechatMathVectorScenes({ ...test.options, runtime }),
		).rejects.toThrow("paint-invalid");
	});

	it("rejects transformed ancestors and accepts explicit neutral measurement ancestors", async () => {
		const transformed = fixture(
			'<span class="outer-transform"><span class="mord">A</span></span>',
		);
		const transformedRuntime = runtimeWithOverrides(transformed, (element) =>
			element.classList.contains("outer-transform")
				? { transform: "matrix(2, 0, 0, 2, 0, 0)" }
				: {},
		);
		await expect(
			captureWechatMathVectorScenes({
				...transformed.options,
				runtime: transformedRuntime,
			}),
		).rejects.toThrow("font-transform-unsupported");

		const nested = fixture(
			'<span class="outer-neutral"><span class="inner-transform"><span class="mord">A</span></span></span>',
		);
		const nestedRuntime = runtimeWithOverrides(nested, (element) => {
			if (element.classList.contains("inner-transform"))
				return { transform: "matrix(2, 0, 0, 2, 0, 0)" };
			if (element.classList.contains("outer-neutral"))
				return { transform: "none" };
			return {};
		});
		await expect(
			captureWechatMathVectorScenes({
				...nested.options,
				runtime: nestedRuntime,
			}),
		).rejects.toThrow("font-transform-unsupported");

		const neutral = fixture(
			'<span class="outer-neutral"><span class="mord">A</span></span>',
		);
		const neutralRuntime = runtimeWithOverrides(neutral, (element) =>
			element.classList.contains("outer-neutral") ? { transform: "none" } : {},
		);
		const result = await captureWechatMathVectorScenes({
			...neutral.options,
			runtime: neutralRuntime,
		});
		expect(result[0]?.scene.runs[0]?.glyphs[0]?.codepoint).toBe(65);
	});

	it("short-circuits empty owners before reading atlas or font witnesses", async () => {
		const test = fixture();
		const atlasProxy = new Proxy(test.options.atlas, {
			get: () => {
				throw new Error("atlas-read");
			},
		});
		const managedFaces = new Proxy(test.options.managedFaces, {
			get: () => {
				throw new Error("font-read");
			},
		});
		const result = await captureWechatMathVectorScenes({
			...test.options,
			atlas: atlasProxy,
			managedFaces,
			sourceOwners: [],
		});
		expect(result).toEqual([]);
		expect(test.wrapperCleanup).toHaveBeenCalledOnce();
	});

	it("skips only the paired vlist-s renderer strut and keeps authored zero-width text", async () => {
		const strut = fixture(
			'<span class="vlist-t vlist-t2"><span class="vlist-r"><span class="vlist-s">\u200b</span></span></span>',
		);
		const result = await captureWechatMathVectorScenes(strut.options);
		expect(result[0]?.scene.runs).toEqual([]);

		for (const content of [
			'<span class="vlist-t vlist-t2"><span class="vlist-r"><span class="vlist-s">\u200b\u200b</span></span></span>',
			'<span class="pstrut">\u200b</span>',
			'<span class="mord">\u200b</span>',
		]) {
			const negative = fixture(content);
			await expect(
				captureWechatMathVectorScenes(negative.options),
			).rejects.toThrow("glyph-missing");
		}
	});

	it("captures static path clips from paired SVGs and rejects active descendants", async () => {
		const svg = fixture(
			'<svg width="20" height="20" viewBox="0 0 10 10" preserveAspectRatio="xMinYMin slice"><path d="M0 0L1 1" fill="#abcdef" stroke="none"></path></svg>',
		);
		const matrices = (element: Element): DOMMatrix => {
			const isPath = element.localName === "path";
			return {
				a: isPath ? 2 : 2,
				b: 0,
				c: 0,
				d: isPath ? 2 : 2,
				e: 10,
				f: 10,
			} as DOMMatrix;
		};
		Object.defineProperty(SVGElement.prototype, "getScreenCTM", {
			configurable: true,
			value: function (this: Element) {
				return matrices(this);
			},
		});
		const result = await captureWechatMathVectorScenes(svg.options);
		const fragment = result[0]?.scene.svgFragments[0];
		expect(fragment?.nestedClipViewportRects[0]).toMatchObject({
			width: 10,
			height: 10,
			x: 0,
			y: 0,
		});
		expect(fragment?.children[0]?.kind).toBe("path");

		const active = fixture(
			'<svg width="20" height="20"><script></script></svg>',
		);
		await expect(captureWechatMathVectorScenes(active.options)).rejects.toThrow(
			"fragment-invalid",
		);
	});

	it("accepts Chrome computed 100% stretch against registered normal", async () => {
		const test = fixture();
		const result = await captureWechatMathVectorScenes(test.options);
		expect(result[0]?.scene.runs[0]?.fontFile).toBe("KaTeX_Main-Regular.woff2");
	});

	it("fails explicitly for stale, readiness, missing-font, and ambiguous-face proofs", async () => {
		const stale = fixture();
		await expect(
			captureWechatMathVectorScenes({
				...stale.options,
				isCurrent: () => false,
			}),
		).rejects.toThrow("wechat-copy-cancelled");

		const failed = fixture();
		const failure = new Error("measurement-failed");
		const failedMeasurement = {
			...failed.options.measurement,
			lease: {
				...failed.options.measurement.lease,
				ready: Promise.reject(failure),
			},
		};
		await expect(
			captureWechatMathVectorScenes({
				...failed.options,
				measurement: failedMeasurement,
			}),
		).rejects.toBe(failure);

		const missing = fixture();
		installFonts([]);
		await expect(
			captureWechatMathVectorScenes(missing.options),
		).rejects.toThrow("font-face-unloaded");

		const ambiguous = fixture();
		installFonts([
			{
				family: "KaTeX_Main",
				style: "normal",
				weight: "400",
				stretch: "normal",
				status: "loaded",
			},
			{
				family: "KaTeX_Main",
				style: "normal",
				weight: "400",
				stretch: "normal",
				status: "loaded",
			},
		]);
		await expect(
			captureWechatMathVectorScenes(ambiguous.options),
		).rejects.toThrow("font-face-ambiguous");
	});

	it("rejects a nonzero marker without retrying", async () => {
		const test = fixture();
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement) {
				if (
					this.getAttribute("aria-hidden") === "true" &&
					this.style.width === "0px"
				)
					return domRect(10, 20, 1, 1);
				if (this.classList.contains("mord")) return domRect(10, 10, 30, 20);
				if (this.classList.contains("katex-html"))
					return domRect(10, 10, 30, 20);
				if (this.classList.contains("easymde-math-block"))
					return domRect(0, 0, 100, 40);
				return domRect(0, 0, 100, 40);
			},
		);
		await expect(captureWechatMathVectorScenes(test.options)).rejects.toThrow(
			"marker-invalid",
		);
		expect(test.wrapperCleanup).toHaveBeenCalledOnce();
	});

	it("rejects an unpaired owner atomically", async () => {
		const test = fixture();
		const foreign = document.createElement("div");
		foreign.className = "easymde-math-block";
		await expect(
			captureWechatMathVectorScenes({
				...test.options,
				sourceOwners: [foreign],
			}),
		).rejects.toThrow("pairing-invalid");
		expect(test.wrapperCleanup).toHaveBeenCalledOnce();
	});

	it("aborts while the readiness promise is pending and still releases the wrapper", async () => {
		const test = fixture();
		let resolveReady!: () => void;
		const ready = new Promise<void>((resolve) => {
			resolveReady = resolve;
		});
		const controller = new AbortController();
		const measurement = {
			...test.options.measurement,
			lease: { ...test.options.measurement.lease, ready },
		};
		const pending = captureWechatMathVectorScenes({
			...test.options,
			measurement,
			signal: controller.signal,
		});
		controller.abort();
		await expect(pending).rejects.toThrow(
			"wechat-preview-measurement-cancelled",
		);
		resolveReady();
		expect(test.wrapperCleanup).toHaveBeenCalledOnce();
	});
});

describe("inline allocation capture", () => {
	it("freezes the sibling-probe line baseline for inline-block owners", async () => {
		const test = fixture();
		const base = test.options.runtime.getComputedStyle;
		const runtime = {
			...test.options.runtime,
			getComputedStyle: (element: Element) => {
				const original = base(element);
				return {
					getPropertyValue: (property: string) => {
						if (element.classList.contains("easymde-math-block")) {
							return (
								{
									display: "inline-block",
									"margin-top": "2px",
									"margin-bottom": "3px",
									"margin-left": "4px",
									"margin-right": "5px",
									"overflow-x": "hidden",
									"overflow-y": "visible",
									"vertical-align": "middle",
									"writing-mode": "horizontal-tb",
									float: "none",
									position: "static",
									transform: "none",
								}[property] ?? original.getPropertyValue(property)
							);
						}
						return original.getPropertyValue(property);
					},
				} as CSSStyleDeclaration;
			},
		};
		const result = await captureWechatMathVectorScenes({
			...test.options,
			runtime,
		});
		const allocation = result[0]?.allocation;
		expect(allocation?.geometry.requiresBaseline).toBe(true);
		expect(allocation?.geometry.inlineLayout).toMatchObject({
			baseline: 22,
			height: 45,
			width: 100,
			viewport: { height: 40, offsetX: 0, offsetY: 2, width: 100 },
			paintOffsetX: 10,
			paintOffsetY: 12,
		});
		expect(allocation?.baselineHeight).toBe(-23);
		expect(allocation?.edges).toEqual({
			borderBottom: 0,
			borderLeft: 0,
			borderRight: 0,
			borderTop: 0,
			marginLeft: 4,
			marginRight: 5,
			paddingBottom: 0,
			paddingLeft: 0,
			paddingRight: 0,
			paddingTop: 0,
		});
	});

	it.each([
		["auto", "0", "0"],
		["", "3px", "3px"],
	] as const)(
		"normalizes authored %j left margin to computed %s",
		async (_authoredMarginLeft, computedMarginLeft, expectedMarginLeft) => {
			const test = fixture();
			const owner = test.owner as HTMLElement;
			const base = test.options.runtime.getComputedStyle;
			const runtime = {
				...test.options.runtime,
				getComputedStyle: (element: Element) => {
					const original = base(element);
					return {
						getPropertyValue: (property: string) => {
							if (element === owner) {
								if (property === "display") return "inline-block";
								if (property === "margin-left") return computedMarginLeft;
								if (property === "margin-right") return "6px";
							}
							return original.getPropertyValue(property);
						},
					} as CSSStyleDeclaration;
				},
			};
			const result = await captureWechatMathVectorScenes({
				...test.options,
				runtime,
			});
			expect(result[0]?.allocation.edges).toMatchObject({
				marginLeft: Number.parseFloat(expectedMarginLeft),
				marginRight: 6,
			});
		},
	);

	it("captures complete block box edges before asynchronous materialization", async () => {
		const test = fixture();
		const runtime = runtimeWithOverrides(test, (element) =>
			element === test.owner
				? {
						"border-bottom-style": "solid",
						"border-bottom-width": "3px",
						"border-left-style": "solid",
						"border-left-width": "5px",
						"border-right-style": "solid",
						"border-right-width": "7px",
						"border-top-style": "solid",
						"border-top-width": "2px",
						"padding-bottom": "11px",
						"padding-left": "13px",
						"padding-right": "17px",
						"padding-top": "19px",
					}
				: {},
		);
		const result = await captureWechatMathVectorScenes({
			...test.options,
			runtime,
		});
		expect(result[0]?.allocation.edges).toEqual({
			borderBottom: 3,
			borderLeft: 5,
			borderRight: 7,
			borderTop: 2,
			marginLeft: 0,
			marginRight: 0,
			paddingBottom: 11,
			paddingLeft: 13,
			paddingRight: 17,
			paddingTop: 19,
		});
	});

	it("rejects a negative computed padding as invalid geometry", async () => {
		const test = fixture();
		const runtime = runtimeWithOverrides(test, (element) =>
			element === test.owner ? { "padding-top": "-1px" } : {},
		);
		await expect(
			captureWechatMathVectorScenes({ ...test.options, runtime }),
		).rejects.toThrow("geometry-invalid");
	});

	it.each([
		["padding-top", ""],
		["padding-right", "auto"],
		["padding-bottom", ""],
		["padding-left", "auto"],
	] as const)(
		"rejects an empty or auto computed %s instead of treating it as zero",
		async (property, value) => {
			const test = fixture();
			const runtime = runtimeWithOverrides(test, (element) =>
				element === test.owner ? { [property]: value } : {},
			);
			await expect(
				captureWechatMathVectorScenes({ ...test.options, runtime }),
			).rejects.toThrow("geometry-invalid");
		},
	);

	it.each(["top", "bottom"] as const)(
		"rejects an empty computed width for an active %s border",
		async (side) => {
			const test = fixture();
			const runtime = runtimeWithOverrides(test, (element) =>
				element === test.owner
					? {
							[`border-${side}-style`]: "solid",
							[`border-${side}-width`]: "",
						}
					: {},
			);
			await expect(
				captureWechatMathVectorScenes({ ...test.options, runtime }),
			).rejects.toThrow("geometry-invalid");
		},
	);

	it("keeps positive none and hidden border widths as zero edges", async () => {
		const test = fixture();
		const runtime = runtimeWithOverrides(test, (element) =>
			element === test.owner
				? {
						"border-bottom-style": "hidden",
						"border-bottom-width": "13px",
						"border-left-style": "solid",
						"border-left-width": "2px",
						"border-right-style": "solid",
						"border-right-width": "3px",
						"border-top-style": "none",
						"border-top-width": "11px",
					}
				: {},
		);
		const result = await captureWechatMathVectorScenes({
			...test.options,
			runtime,
		});
		expect(result[0]?.allocation.edges).toMatchObject({
			borderBottom: 0,
			borderLeft: 2,
			borderRight: 3,
			borderTop: 0,
		});
	});

	it("freezes all supported vertical-align keywords and multiple glyph runs", async () => {
		for (const verticalAlign of [
			"baseline",
			"sub",
			"super",
			"text-top",
			"text-bottom",
			"middle",
			"top",
			"bottom",
		]) {
			const test = fixture();
			const base = test.options.runtime.getComputedStyle;
			const runtime = {
				...test.options.runtime,
				getComputedStyle: (element: Element) => {
					const original = base(element);
					return {
						getPropertyValue: (property: string) => {
							if (element.classList.contains("easymde-math-block")) {
								return (
									{
										display: "inline-block",
										"vertical-align": verticalAlign,
										"writing-mode": "horizontal-tb",
										position: "static",
										float: "none",
										transform: "none",
									}[property] ?? original.getPropertyValue(property)
								);
							}
							return original.getPropertyValue(property);
						},
					} as CSSStyleDeclaration;
				},
			};
			const result = await captureWechatMathVectorScenes({
				...test.options,
				runtime,
			});
			expect(result[0]?.allocation.geometry.inlineLayout?.baseline).toBeTypeOf(
				"number",
			);
		}
		const multi = fixture(
			'<span class="mord">A</span><span class="mord">😀</span>',
		);
		const base = multi.options.runtime.getComputedStyle;
		const runtime = {
			...multi.options.runtime,
			getComputedStyle: (element: Element) => {
				const original = base(element);
				return {
					getPropertyValue: (property: string) =>
						element.classList.contains("easymde-math-block") &&
						property === "display"
							? "inline-block"
							: original.getPropertyValue(property),
				} as CSSStyleDeclaration;
			},
		};
		const result = await captureWechatMathVectorScenes({
			...multi.options,
			runtime,
		});
		expect(result[0]?.scene.runs).toHaveLength(2);
	});

	it("rejects true inline owners pending a separate line-box proof", async () => {
		const test = fixture();
		const base = test.options.runtime.getComputedStyle;
		const runtime = {
			...test.options.runtime,
			getComputedStyle: (element: Element) => {
				const original = base(element);
				return {
					getPropertyValue: (property: string) =>
						property === "display" &&
						element.classList.contains("easymde-math-block")
							? "inline"
							: original.getPropertyValue(property),
				} as CSSStyleDeclaration;
			},
		};
		await expect(
			captureWechatMathVectorScenes({ ...test.options, runtime }),
		).rejects.toThrow("inline-unsupported");
	});
});
