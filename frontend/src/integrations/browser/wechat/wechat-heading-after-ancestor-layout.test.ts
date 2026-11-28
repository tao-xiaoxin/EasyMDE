import {
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { createBrowserWechatClipboard } from "./create-browser-wechat-clipboard";
import {
	blobText,
	declaration,
	declaredStyleValue,
	installClipboardTestEnvironment,
} from "./wechat-clipboard-test-fixtures";

import {
	cases,
	inBoxCases,
	gradient,
	headingWidth,
	geometryEpsilon,
	ClipboardItemStub,
	copyHeading,
	pixels,
	type HeadingCase,
} from "./wechat-heading-after-test-fixtures";

describe("WeChat heading-after ancestor layout", () => {
	installClipboardTestEnvironment();

	it.each([
		{ name: "inconsistent top", styles: { top: "0px" } },
		{ name: "inconsistent right", styles: { right: "0px" } },
		{ name: "nonzero margin", styles: { "margin-top": "1px" } },
		{ name: "nonzero border", styles: { "border-top-width": "1px" } },
		{
			name: "straddling bottom border",
			styles: { bottom: "-2px", top: "54.796875px" },
		},
	])(
		"keeps unsupported geometry on its existing path: $name",
		async ({ styles }) => {
			const fixture = cases[0];
			if (!fixture) throw new Error("heading fixture missing");
			const { holder } = await copyHeading(
				fixture,
				"none",
				"clipboard",
				styles,
			);
			const marker = holder.querySelector(
				`${fixture.tag} > span[aria-hidden="true"]`,
			);
			expect(marker?.textContent).toBe(" ");
			if (!marker) throw new Error("unsupported heading marker missing");
			expect(declaredStyleValue(marker, "position")).toBe("absolute");
		},
	);

	const nonNaturalBoxCases: ReadonlyArray<
		Readonly<{
			name: string;
			typed: Record<string, unknown> | null;
			styles: Record<string, string>;
			parent?: Record<string, string>;
			wrapParentInContents?: boolean;
		}>
	> = [
		{
			name: "fixed height",
			typed: { height: { value: 100, unit: "px" }, "block-size": { value: 100, unit: "px" } },
			styles: { height: "100px", "line-height": "20px" },
		},
		{
			name: "minimum height",
			typed: { "min-height": { value: 100, unit: "px" }, "min-block-size": { value: 100, unit: "px" } },
			styles: { "min-height": "100px", "line-height": "20px" },
		},
		{
			name: "maximum height",
			typed: { "max-height": { value: 100, unit: "px" }, "max-block-size": { value: 100, unit: "px" } },
			styles: { "max-height": "100px", "line-height": "20px" },
		},
		{
			name: "vertical writing",
			typed: { "writing-mode": { value: "vertical-rl" } },
			styles: { "writing-mode": "vertical-rl", "line-height": "20px" },
		},
		{
			name: "missing Typed OM",
			typed: null,
			styles: { "line-height": "20px" },
		},
		{
			name: "explicit CSSOM aspect-ratio",
			typed: {},
			styles: { "aspect-ratio": "4 / 1", "line-height": "20px" },
		},
		{
			name: "explicit Typed OM aspect-ratio ratio",
			typed: { "aspect-ratio": { value: "4 / 1" } },
			styles: { "line-height": "20px" },
		},
		{
			name: "explicit Typed OM CSSStyleValue aspect-ratio",
			typed: { "aspect-ratio": { toString: () => "4 / 1" } },
			styles: { "line-height": "20px" },
		},
		{
			name: "explicit numeric Typed OM aspect-ratio",
			typed: { "aspect-ratio": { value: 2, unit: "number" } },
			styles: { "line-height": "20px" },
		},
		{
			name: "size containment",
			typed: {},
			styles: { contain: "size", "line-height": "20px" },
		},
		{
			name: "strict containment",
			typed: {},
			styles: { contain: "strict", "line-height": "20px" },
		},
		{
			name: "CSSOM container-type size with contain-intrinsic-size",
			typed: { "container-type": { value: "size" } },
			styles: {
				contain: "none",
				"container-type": "size",
				"contain-intrinsic-size": "80px",
				"line-height": "20px",
			},
		},
		{
			name: "CSSOM container-type multi-token size with contain-intrinsic-size",
			typed: {},
			styles: {
				contain: "none",
				"container-type": "size scroll-state",
				"contain-intrinsic-size": "80px",
				"line-height": "20px",
			},
		},
		{
			name: "Typed OM container-type size with contain-intrinsic-size",
			typed: { "container-type": { value: "size" } },
			styles: {
				contain: "none",
				"container-type": "normal",
				"contain-intrinsic-size": "80px",
				"line-height": "20px",
			},
		},
		{
			name: "Typed OM CSSStyleValue container-type size",
			typed: { "container-type": { toString: () => "size scroll-state" } },
			styles: {
				contain: "none",
				"contain-intrinsic-size": "80px",
				"line-height": "20px",
			},
		},
		{
			name: "CSS Grid parent",
			typed: {},
			styles: { "line-height": "20px" },
			parent: { display: "grid" },
		},
		{
			name: "CSS inline-grid parent",
			typed: {},
			styles: { "line-height": "20px" },
			parent: { display: "inline-grid" },
		},
		{
			name: "CSS Grid parent through display: contents wrapper",
			typed: {},
			styles: { "line-height": "20px" },
			parent: { display: "grid" },
			wrapParentInContents: true,
		},
		{
			name: "CSS Flex parent",
			typed: {},
			styles: { "line-height": "20px" },
			parent: { display: "flex" },
		},
		{
			name: "CSS inline-flex parent",
			typed: {},
			styles: { "line-height": "20px" },
			parent: { display: "inline-flex" },
		},
		{
			name: "CSS table-cell parent",
			typed: {},
			styles: { "line-height": "20px" },
			parent: { display: "table-cell" },
		},
		{
			name: "vertical writing-mode parent",
			typed: {},
			styles: { "line-height": "20px" },
			parent: { display: "block", "writing-mode": "vertical-rl" },
		},
	];

	it.each(nonNaturalBoxCases)(
		"does not project $name without a proven natural horizontal box",
		async ({ typed, styles, parent = {}, wrapParentInContents = false }) => {
			const base = cases[0];
			if (!base) throw new Error("heading fixture missing");
			const fixture: HeadingCase = {
				...base,
				height: 100,
				paddingBottom: 0,
				borderTop: 0,
				borderBottom: 0,
				bottom: -10,
				paintHeight: 3,
				observedTop: 107,
			};
			const { holder } = await copyHeading(
				fixture,
				"none",
				"clipboard",
				{},
				typed,
				styles,
				parent,
				wrapParentInContents,
			);
			const heading = holder.querySelector("h1");
			const marker = heading?.querySelector(':scope > span[aria-hidden="true"]');
			if (!marker) throw new Error("unsupported heading marker missing");
			expect(declaredStyleValue(marker, "position")).toBe("absolute");
			expect(marker.textContent).toBe(" ");
			expect(20 + fixture.paddingBottom - fixture.bottom - fixture.paintHeight).toBe(27);
			expect(fixture.borderTop + fixture.observedTop).toBe(107);
		},
	);

	const naturalBlockParentCases: ReadonlyArray<
		Readonly<{
			name: string;
			typed: Record<string, unknown>;
			styles: Record<string, string>;
			parent: Record<string, string>;
			wrapParentInContents: boolean;
		}>
	> = [
		{
			name: "flow-root parent with auto aspect-ratio",
			typed: { "aspect-ratio": { value: "auto" } },
			styles: { "aspect-ratio": "auto" },
			parent: { display: "flow-root", "writing-mode": "horizontal-tb" },
			wrapParentInContents: false,
		},
		{
			name: "list-item parent with CSSStyleValue auto aspect-ratio",
			typed: { "aspect-ratio": { toString: () => "auto" } },
			styles: { "aspect-ratio": "auto" },
			parent: { display: "list-item", "writing-mode": "horizontal-tb" },
			wrapParentInContents: false,
		},
		{
			name: "block parent through display: contents wrapper",
			typed: { "aspect-ratio": { value: "normal" } },
			styles: { "aspect-ratio": "auto" },
			parent: { display: "block", "writing-mode": "horizontal-tb" },
			wrapParentInContents: true,
		},
		{
			name: "container-type inline-size stays eligible",
			typed: { "container-type": { value: "inline-size" } },
			styles: { "container-type": "inline-size" },
			parent: { display: "block", "writing-mode": "horizontal-tb" },
			wrapParentInContents: false,
		},
		{
			name: "container-type normal stays eligible",
			typed: { "container-type": { value: "normal" } },
			styles: { "container-type": "normal" },
			parent: { display: "block", "writing-mode": "horizontal-tb" },
			wrapParentInContents: false,
		},
	];

	it.each(naturalBlockParentCases)(
		"projects headings with a natural horizontal block parent and auto aspect-ratio: $name",
		async ({ typed, styles, parent, wrapParentInContents }) => {
			const fixture = cases[0];
			if (!fixture) throw new Error("heading fixture missing");
			const { holder } = await copyHeading(
				fixture,
				"none",
				"clipboard",
				{},
				typed,
				styles,
				parent,
				wrapParentInContents,
			);
			const heading = holder.querySelector(fixture.tag);
			if (!heading) throw new Error("copied heading missing");
			const paint = heading.nextElementSibling;
			if (!paint) throw new Error("projected heading paint missing");
			expect(paint.tagName).toBe("SECTION");
			expect(declaredStyleValue(paint, "position")).toBe("static");
			expect(paint.textContent).toBe("\u2060");
		},
	);

	it.each(cases)(
		"derives the observed source top without a fixed offset: $name",
		(fixture) => {
			const contentBottom =
				fixture.height - fixture.borderBottom - fixture.paddingBottom;
			const gap = fixture.paddingBottom - fixture.bottom - fixture.paintHeight;
			expect(
				Math.abs(contentBottom + gap - fixture.borderTop - fixture.observedTop),
			).toBeLessThanOrEqual(geometryEpsilon);
		},
	);

	it("preserves collapsed heading-to-paragraph spacing, horizontal offset, RTL alignment, and composed heading opacity for promoted below-border bars", async () => {
		const bloomH2 = cases[3];
		const inBoxH2 = inBoxCases[0];
		if (!bloomH2 || !inBoxH2) throw new Error("heading fixtures missing");

		// C2: Bloom Spring h2 (margin-bottom: 17.59375px, bar footprint 9.44 + 3 = 12.44px)
		// followed by <p> (margin-top: 17.59375px). Original collapsed gap is 17.59375px.
		const collapsed = await copyHeading(
			bloomH2,
			"none",
			"clipboard",
			{},
			{},
			{ "margin-bottom": "17.59375px" },
			{},
			false,
			false,
			{ "margin-top": "17.59375px" },
		);
		const collapsedHeading = collapsed.holder.querySelector("h2");
		const collapsedBar = collapsedHeading?.nextElementSibling;
		if (!collapsedHeading || !collapsedBar) throw new Error("collapsed bar missing");
		expect(collapsedBar.tagName).toBe("SECTION");
		const barTop = pixels(collapsedBar, "margin-top");
		const barHeight = pixels(collapsedBar, "height");
		const barBottom = pixels(collapsedBar, "margin-bottom");
		expect(barBottom).toBeCloseTo(-12.44, 4);
		// CSS 2.1 §8.3.1: positive 17.59375px + negative -12.44px = 5.15375px; plus 9.44 + 3 = 17.59375px
		expect(barTop + barHeight + (17.59375 + barBottom)).toBeCloseTo(17.59375, 4);

		// Ambiguous following sibling (floated or negative margin-top) declines promotion cleanly.
		for (const badFollowing of [{ float: "left" }, { "margin-top": "-8px" }]) {
			const declined = await copyHeading(
				bloomH2,
				"none",
				"clipboard",
				{},
				{},
				{},
				{},
				false,
				false,
				badFollowing,
			);
			const fallbackMarker = declined.holder.querySelector(
				'h2 > span[aria-hidden="true"]',
			);
			expect(fallbackMarker).not.toBeNull();
			expect(declaredStyleValue(fallbackMarker as Element, "position")).toBe(
				"absolute",
			);
		}

		// C3: Heading with margin-left: 40px + dir="rtl" parent preserves horizontal offset and left anchor
		// when the promoted bar fits within the RTL containing block.
		const shifted = await copyHeading(
			bloomH2,
			"none",
			"clipboard",
			{},
			{},
			{ "margin-left": "40px", direction: "rtl" },
			{ direction: "rtl" },
			false,
			false,
			{},
			720,
			40,
		);
		const shiftedBar = shifted.holder.querySelector("h2")?.nextElementSibling;
		if (!shiftedBar) throw new Error("shifted bar missing");
		expect(shiftedBar.tagName).toBe("SECTION");
		expect(pixels(shiftedBar, "margin-left")).toBeCloseTo(40 + bloomH2.left, 4);
		expect(declaredStyleValue(shiftedBar, "margin-right")).toBe("auto");
		expect(declaredStyleValue(shiftedBar, "direction")).toBe("ltr");

		// C4: Heading opacity < 1 composes onto promoted sibling, while in-box retains pseudo opacity only.
		const fadedBelow = await copyHeading(
			bloomH2,
			"none",
			"clipboard",
			{ opacity: "0.8" },
			{},
			{ opacity: "0.5" },
		);
		const fadedSibling = fadedBelow.holder.querySelector("h2")?.nextElementSibling;
		if (!fadedSibling) throw new Error("faded sibling missing");
		expect(Number.parseFloat(declaredStyleValue(fadedSibling, "opacity"))).toBeCloseTo(
			0.4,
			4,
		);

		const fadedInBox = await copyHeading(
			inBoxH2,
			"none",
			"clipboard",
			{ opacity: "0.8" },
			{},
			{ opacity: "0.5" },
		);
		const fadedInBoxPaint = fadedInBox.holder.querySelector(
			'h2 > span[aria-hidden="true"]',
		);
		if (!fadedInBoxPaint) throw new Error("faded in-box paint missing");
		expect(
			Number.parseFloat(declaredStyleValue(fadedInBoxPaint, "opacity")),
		).toBeCloseTo(0.8, 4);
	});

	it("preserves margin collapse across pass-through list/block ancestors and declines unsafe crossed ancestors", async () => {
		const bloomH2 = cases[3];
		if (!bloomH2) throw new Error("bloom h2 fixture missing");

		const copyStructuredHeading = async (
			innerHTML: string,
			plainText: string,
			styleFor: (element: Element, pseudo?: string | null) => Record<string, string>,
			wrapperTypedOverrides?: Record<string, unknown>,
		) => {
			const preview = document.createElement("article");
			preview.setAttribute("data-easymde-preview-html-sink", "1");
			preview.innerHTML = innerHTML;
			const source = preview.querySelector("h2");
			if (!source) throw new Error("h2 missing");
			const wrap = preview.querySelector(".wrap");
			if (wrap && wrapperTypedOverrides) {
				const wrapTyped: Record<string, unknown> = {
					height: { value: "auto" },
					"block-size": { value: "auto" },
					"min-height": { value: "auto" },
					"min-block-size": { value: "auto" },
					"max-height": { value: "none" },
					"max-block-size": { value: "none" },
					"writing-mode": { value: "horizontal-tb" },
					...wrapperTypedOverrides,
				};
				Object.defineProperty(wrap, "computedStyleMap", {
					configurable: true,
					value: () => ({ get: (property: string) => wrapTyped[property] }),
				});
			}
			Object.defineProperty(source, "computedStyleMap", {
				configurable: true,
				value: () => ({
					get: (property: string) =>
						({
							height: { value: "auto" },
							"block-size": { value: "auto" },
							"min-height": { value: "auto" },
							"min-block-size": { value: "auto" },
							"max-height": { value: "none" },
							"max-block-size": { value: "none" },
							"writing-mode": { value: "horizontal-tb" },
						})[property],
				}),
			});
			Object.defineProperty(source, "getBoundingClientRect", {
				configurable: true,
				value: () => ({
					bottom: bloomH2.height,
					height: bloomH2.height,
					left: 0,
					right: headingWidth,
					top: 0,
					width: headingWidth,
					x: 0,
					y: 0,
				}),
			});
			Object.defineProperty(preview, "innerText", {
				configurable: true,
				value: plainText,
			});
			let html = "";
			const clipboard = createBrowserWechatClipboard({
				blob: Blob,
				clipboardItem: ClipboardItemStub,
				document,
				getComputedStyle: (element, pseudo) => {
					if (element.tagName === "H2" && pseudo === "::after") {
						return declaration({
							background: gradient,
							"background-color": "rgba(0, 0, 0, 0)",
							"background-image": gradient,
							"border-radius": "999px",
							"border-bottom-style": "none",
							"border-bottom-width": "0px",
							"border-left-style": "none",
							"border-left-width": "0px",
							"border-right-style": "none",
							"border-right-width": "0px",
							"border-top-style": "none",
							"border-top-width": "0px",
							bottom: `${bloomH2.bottom}px`,
							"box-shadow": "none",
							"box-sizing": "content-box",
							content: '""',
							display: "block",
							filter: "none",
							float: "none",
							height: `${bloomH2.paintHeight}px`,
							left: `${bloomH2.left}px`,
							"margin-bottom": "0px",
							"margin-left": "0px",
							"margin-right": "0px",
							"margin-top": "0px",
							opacity: "1",
							"padding-bottom": "0px",
							"padding-left": "0px",
							"padding-right": "0px",
							"padding-top": "0px",
							position: "absolute",
							right: `${headingWidth - bloomH2.left - bloomH2.paintWidth}px`,
							top: `${bloomH2.observedTop}px`,
							transform: "none",
							visibility: "visible",
							width: `${bloomH2.paintWidth}px`,
						});
					}
					if (pseudo) return declaration({ content: "none" });
					if (element.tagName === "H2") {
						return declaration({
							"border-bottom-style": "solid",
							"border-bottom-width": `${bloomH2.borderBottom}px`,
							"border-left-width": "0px",
							"border-right-width": "0px",
							"border-top-width": `${bloomH2.borderTop}px`,
							display: "block",
							float: "none",
							"margin-bottom": "17.59375px",
							opacity: "1",
							overflow: "visible",
							"padding-bottom": `${bloomH2.paddingBottom}px`,
							"padding-left": `${bloomH2.paddingLeft}px`,
							"padding-right": "0px",
							"padding-top": "0px",
							position: "relative",
							transform: "none",
							visibility: "visible",
							"writing-mode": "horizontal-tb",
							...styleFor(element, pseudo),
						});
					}
					return declaration({
						display: element.tagName === "LI" ? "list-item" : "block",
						visibility: "visible",
						...styleFor(element, pseudo),
					});
				},
				getSelection: window.getSelection.bind(window),
				pageOffset: () => ({ x: 0, y: 0 }),
				scrollTo: vi.fn(),
				write: async (items) => {
					const item = items[0] as ClipboardItemStub;
					const htmlBlob = item.payload["text/html"];
					if (!htmlBlob) throw new Error("html blob missing");
					html = await blobText(htmlBlob);
				},
			});
			const result = await clipboard.copy(preview);
			expect(result).toEqual({ method: "clipboard", status: "copied" });
			const holder = document.createElement("div");
			holder.innerHTML = html;
			return holder;
		};

		// 1. Loose list heading (`- ## Heading\n\n- Next`): crosses li[0] -> li[1] > p.
		const listHolder = await copyStructuredHeading(
			"<ul><li><h2>Heading</h2></li><li><p>Next</p></li></ul>",
			"Heading\nNext",
			(element) => {
				if (element.tagName === "LI") return { "margin-top": "8px", "margin-bottom": "8px" };
				if (element.tagName === "P") return { "margin-top": "17.59375px" };
				return {};
			},
		);
		const listBar = listHolder.querySelector("h2")?.nextElementSibling;
		expect(listBar?.tagName).toBe("SECTION");
		expect(pixels(listBar as Element, "margin-bottom")).toBeCloseTo(-12.44, 4);
		expect(
			pixels(listBar as Element, "margin-top") +
				pixels(listBar as Element, "height") +
				(17.59375 + pixels(listBar as Element, "margin-bottom")),
		).toBeCloseTo(17.59375, 4);

		// 2. Multi-level ancestor crossing (`ul` margin-bottom 24px > h2 17.59375px and p 10px).
		const multiLevelHolder = await copyStructuredHeading(
			"<ul><li><h2>Heading</h2></li></ul><p>After</p>",
			"Heading\nAfter",
			(element) => {
				if (element.tagName === "LI") return { "margin-bottom": "8px" };
				if (element.tagName === "UL") return { "margin-bottom": "24px" };
				if (element.tagName === "P") return { "margin-top": "10px" };
				return {};
			},
		);
		const multiBar = multiLevelHolder.querySelector("h2")?.nextElementSibling;
		expect(multiBar?.tagName).toBe("SECTION");
		expect(pixels(multiBar as Element, "margin-bottom")).toBeCloseTo(-12.44, 4);
		expect(
			pixels(multiBar as Element, "margin-top") +
				pixels(multiBar as Element, "height") +
				(24 + pixels(multiBar as Element, "margin-bottom")),
		).toBeCloseTo(24, 4);

		// 3. Padded / BFC ancestor stops margin collapse cleanly inside wrapper.
		const paddedHolder = await copyStructuredHeading(
			'<div class="wrap"><h2>Heading</h2></div><p>After</p>',
			"Heading\nAfter",
			(element) => {
				if (element.classList.contains("wrap")) {
					return { "padding-bottom": "10px", "margin-bottom": "24px" };
				}
				if (element.tagName === "P") return { "margin-top": "30px" };
				return {};
			},
		);
		const paddedBar = paddedHolder.querySelector("h2")?.nextElementSibling;
		expect(paddedBar?.tagName).toBe("SECTION");
		expect(pixels(paddedBar as Element, "margin-bottom")).toBeCloseTo(5.15375, 4);

		// 4. Unsafe pass-through ancestors (painted, bordered, negative margin, fixed height, overflow clip)
		//    and cleared following siblings decline promotion cleanly.
		const unsafeAncestors: ReadonlyArray<
			Readonly<{ style: Record<string, string>; typed?: Record<string, unknown> }>
		> = [
			{ style: { "background-color": "rgb(255, 240, 240)" } },
			{ style: { "border-left-width": "4px", "border-left-style": "solid" } },
			{ style: { "margin-bottom": "-8px" } },
			{
				style: { height: "120px" },
				typed: {
					height: { value: 120, unit: "px" },
					"block-size": { value: 120, unit: "px" },
				},
			},
			{ style: { "overflow-y": "clip" } },
		];
		for (const { style: wrapperStyle, typed: wrapperTyped } of unsafeAncestors) {
			const declined = await copyStructuredHeading(
				'<div class="wrap"><h2>Heading</h2></div><p>After</p>',
				"Heading\nAfter",
				(element) => {
					if (element.classList.contains("wrap")) return wrapperStyle;
					if (element.tagName === "P") return { "margin-top": "17.59375px" };
					return {};
				},
				wrapperTyped,
			);
			const fallback = declined.querySelector('h2 > span[aria-hidden="true"]');
			expect(fallback).not.toBeNull();
			expect(declaredStyleValue(fallback as Element, "position")).toBe("absolute");
		}

		const clearedSibling = await copyStructuredHeading(
			"<h2>Heading</h2><p>Cleared</p>",
			"Heading\nCleared",
			(element) => (element.tagName === "P" ? { clear: "both", "margin-top": "17.59375px" } : {}),
		);
		const clearedFallback = clearedSibling.querySelector('h2 > span[aria-hidden="true"]');
		expect(clearedFallback).not.toBeNull();
		expect(declaredStyleValue(clearedFallback as Element, "position")).toBe("absolute");
	});

	it("declines promotion when the heading has non-zero relative offsets or over-constrained RTL bar geometry", async () => {
		const bloomH2 = cases[3];
		const inBoxH2 = inBoxCases[0];
		if (!bloomH2 || !inBoxH2) throw new Error("heading fixtures missing");

		// Zero / auto relative offsets still promote cleanly.
		for (const zeroOffset of [
			{ top: "auto", bottom: "auto", left: "auto", right: "auto" },
			{ top: "0px", bottom: "0px", left: "0px", right: "0px" },
		]) {
			const ok = await copyHeading(bloomH2, "none", "clipboard", {}, {}, zeroOffset);
			expect(ok.holder.querySelector("h2")?.nextElementSibling?.tagName).toBe("SECTION");
		}

		// Non-zero or non-pixel relative offsets decline promotion cleanly so the promoted sibling
		// cannot drop the heading's relative offset.
		for (const nonZeroOffset of [
			{ top: "10px" },
			{ bottom: "6px" },
			{ left: "8px" },
			{ right: "-4px" },
			{ top: "5%" },
		]) {
			const declined = await copyHeading(bloomH2, "none", "clipboard", {}, {}, nonZeroOffset);
			const fallback = declined.holder.querySelector('h2 > span[aria-hidden="true"]');
			expect(fallback).not.toBeNull();
			expect(declaredStyleValue(fallback as Element, "position")).toBe("absolute");
		}

		// RTL parent with wide over-constrained bar (parent 200px, bar 250px): decline promotion
		// rather than letting CSS 2.1 §10.3.3 override margin-left to -50px.
		const wideRtlFixture: HeadingCase = {
			...bloomH2,
			left: 0,
			paintWidth: 250,
		};
		const wideRtlDeclined = await copyHeading(
			wideRtlFixture,
			"none",
			"clipboard",
			{},
			{},
			{ direction: "rtl" },
			{ direction: "rtl" },
			false,
			false,
			{},
			200,
			0,
		);
		const wideRtlFallback = wideRtlDeclined.holder.querySelector('h2 > span[aria-hidden="true"]');
		expect(wideRtlFallback).not.toBeNull();
		expect(declaredStyleValue(wideRtlFallback as Element, "position")).toBe("absolute");

		// RTL parent where marginLeft + barWidth exceeds containing block width (150 + 80 > 200): decline promotion.
		const shiftedRtlOverflow = await copyHeading(
			{ ...bloomH2, left: 0, paintWidth: 80 },
			"none",
			"clipboard",
			{},
			{},
			{ "margin-left": "150px", direction: "rtl" },
			{ direction: "rtl" },
			false,
			false,
			{},
			200,
			150,
		);
		expect(
			declaredStyleValue(
				shiftedRtlOverflow.holder.querySelector('h2 > span[aria-hidden="true"]') as Element,
				"position",
			),
		).toBe("absolute");

		// Unmeasurable RTL parent (width = 0) fails closed.
		const unmeasurableRtl = await copyHeading(
			bloomH2,
			"none",
			"clipboard",
			{},
			{},
			{ direction: "rtl" },
			{ direction: "rtl" },
			false,
			false,
			{},
			0,
			0,
		);
		expect(
			declaredStyleValue(
				unmeasurableRtl.holder.querySelector('h2 > span[aria-hidden="true"]') as Element,
				"position",
			),
		).toBe("absolute");

		// RTL in-box bar overflowing the heading content width (width 450 > headingWidth 419.5): decline conversion.
		const rtlInBoxOverflow = await copyHeading(
			{ ...inBoxH2, left: 0, paintWidth: 450 },
			"none",
			"clipboard",
			{},
			{},
			{ direction: "rtl" },
		);
		expect(
			declaredStyleValue(
				rtlInBoxOverflow.holder.querySelector('h2 > span[aria-hidden="true"]') as Element,
				"position",
			),
		).toBe("absolute");
	});

	it("does not convert a rotated decoration into the supported flow model", async () => {
		const fixture = cases[0];
		if (!fixture) throw new Error("heading fixture missing");
		const { holder } = await copyHeading(fixture, "matrix(0, 1, -1, 0, 0, 0)");
		const marker = holder.querySelector(
			`${fixture.tag} > span[aria-hidden="true"]`,
		);
		expect(marker?.textContent).toBe(" ");
		if (!marker) throw new Error("unsupported heading marker missing");
		expect(declaredStyleValue(marker, "position")).toBe("absolute");
		expect(declaredStyleValue(marker, "transform")).toBe(
			"matrix(0, 1, -1, 0, 0, 0)",
		);
	});
});
