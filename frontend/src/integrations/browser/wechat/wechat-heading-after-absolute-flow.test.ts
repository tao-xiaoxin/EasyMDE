import { describe, expect, it, vi } from "vitest";

import { createBrowserWechatClipboard } from "./create-browser-wechat-clipboard";
import {
	blobText,
	declaration,
	declaredStyleValue,
	installClipboardTestEnvironment,
	prepareClipboard,
} from "./wechat-clipboard-test-fixtures";
import {
	EXPORT_TEXT_NORMALIZATIONS,
	GENERATED_EMPTY_HEADING_SUFFIX_CLONES,
	HEADING_EMPTY_PSEUDO_FLOW_CLONES,
} from "./wechat-clone-metadata";
import {
	connectedPlainText,
	finalizeMarkup,
} from "./wechat-portable-serialization";
import {
	assertHeadingEmptyPseudoFlows,
	HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS,
	type HeadingEmptyPseudoFlowExpectation,
} from "./wechat-pseudo-elements";

type HeadingCase = Readonly<{
	name: string;
	tag: "h1" | "h2" | "h3" | "h4";
	markup: string;
	text: string;
	height: number;
	paddingBottom: number;
	paddingLeft: number;
	borderTop: number;
	borderBottom: number;
	bottom: number;
	left: number;
	paintWidth: number;
	paintHeight: number;
	observedTop: number;
}>;

const cases: readonly HeadingCase[] = [
	{
		name: "h1 single line",
		tag: "h1",
		markup: "Heading",
		text: "Heading",
		height: 56.796875,
		paddingBottom: 10.8,
		paddingLeft: 0,
		borderTop: 0,
		borderBottom: 1,
		bottom: -18,
		left: 0,
		paintWidth: 76,
		paintHeight: 3,
		observedTop: 70.7969,
	},
	{
		name: "h1 two lines",
		tag: "h1",
		markup: "First<br>Second",
		text: "First\nSecond",
		height: 101.796875,
		paddingBottom: 10.8,
		paddingLeft: 0,
		borderTop: 0,
		borderBottom: 1,
		bottom: -18,
		left: 0,
		paintWidth: 76,
		paintHeight: 3,
		observedTop: 115.797,
	},
	// JSDOM uses this two-line height as a fixture; the browser probe checks actual soft wrapping.
	{
		name: "h1 soft-wrap geometry",
		tag: "h1",
		markup:
			"A long heading that naturally wraps when the available width becomes narrow",
		text: "A long heading that naturally wraps when the available width becomes narrow",
		height: 101.796875,
		paddingBottom: 10.8,
		paddingLeft: 0,
		borderTop: 0,
		borderBottom: 1,
		bottom: -18,
		left: 0,
		paintWidth: 76,
		paintHeight: 3,
		observedTop: 115.797,
	},
	{
		name: "h2 bottom border",
		tag: "h2",
		markup: "Heading",
		text: "Heading",
		height: 41.046875,
		paddingBottom: 6.4512,
		paddingLeft: 0,
		borderTop: 0,
		borderBottom: 1,
		bottom: -13.44,
		left: 0,
		paintWidth: 76,
		paintHeight: 3,
		observedTop: 50.4844,
	},
	{
		name: "h3 no bottom padding",
		tag: "h3",
		markup: "Heading",
		text: "Heading",
		height: 26.390625,
		paddingBottom: 0,
		paddingLeft: 0,
		borderTop: 0,
		borderBottom: 0,
		bottom: -8.0256,
		left: 0,
		paintWidth: 44,
		paintHeight: 2,
		observedTop: 32.4141,
	},
	{
		name: "h4 no bottom padding",
		tag: "h4",
		markup: "Heading",
		text: "Heading",
		height: 22.9921875,
		paddingBottom: 0,
		paddingLeft: 0,
		borderTop: 0,
		borderBottom: 0,
		bottom: -6.256,
		left: 0,
		paintWidth: 32,
		paintHeight: 2,
		observedTop: 27.2422,
	},
	{
		name: "independent left and padding",
		tag: "h2",
		markup: "Heading",
		text: "Heading",
		height: 38,
		paddingBottom: 4,
		paddingLeft: 7,
		borderTop: 3,
		borderBottom: 2,
		bottom: -6,
		left: 11,
		paintWidth: 38,
		paintHeight: 4,
		observedTop: 35,
	},
];

const gradient = "linear-gradient(90deg, rgb(60, 100, 180), transparent)";
const headingWidth = 419.5;
const geometryEpsilon = 1 / 64;

class ClipboardItemStub {
	constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
}

async function copyHeading(
	fixture: HeadingCase,
	transform = "none",
	mode: "clipboard" | "legacy" = "clipboard",
	pseudoOverrides: Record<string, string> = {},
	typedOverrides: Record<string, unknown> | null = {},
	sourceOverrides: Record<string, string> = {},
	parentOverrides: Record<string, string> = {},
	wrapParentInContents = false,
) {
	const preview = document.createElement("article");
	preview.setAttribute("data-easymde-preview-html-sink", "1");
	preview.innerHTML = wrapParentInContents
		? `<div data-contents-wrapper="1"><${fixture.tag}>${fixture.markup}</${fixture.tag}></div><p>Following</p>`
		: `<${fixture.tag}>${fixture.markup}</${fixture.tag}><p>Following</p>`;
	const source = preview.querySelector(fixture.tag);
	if (!source) throw new Error("heading fixture missing");
	for (const [property, value] of Object.entries(sourceOverrides)) {
		(source as HTMLElement).style.setProperty(property, value);
	}
	const originalMarkup = preview.innerHTML;
	const typedStyles: Record<string, unknown> = {
		height: { value: "auto" },
		"block-size": { value: "auto" },
		"min-height": { value: "auto" },
		"min-block-size": { value: "auto" },
		"max-height": { value: "none" },
		"max-block-size": { value: "none" },
		"writing-mode": { value: "horizontal-tb" },
		...typedOverrides,
	};
	Object.defineProperty(source, "computedStyleMap", {
		configurable: true,
		value: typedOverrides === null ? undefined : () => ({
			get: (property: string) => typedStyles[property],
		}),
	});
	Object.defineProperty(source, "getBoundingClientRect", {
		configurable: true,
		value: () => ({
			bottom: fixture.height,
			height: fixture.height,
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
		value: `${fixture.text}\nFollowing`,
	});
	let html = "";
	let text = "";
	let writeError: unknown;
	const clipboard = createBrowserWechatClipboard({
		blob: Blob,
		clipboardItem: mode === "legacy" ? null : ClipboardItemStub,
		document,
		getComputedStyle: (element, pseudo) => {
			if (
				element.tagName.toLowerCase() === fixture.tag &&
				"::after" === pseudo
			) {
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
					bottom: `${fixture.bottom}px`,
					"box-shadow": "none",
					"box-sizing": "content-box",
					content: '""',
					display: "block",
					filter: "none",
					float: "none",
					height: `${fixture.paintHeight}px`,
					left: `${fixture.left}px`,
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
					right: `${headingWidth - fixture.left - fixture.paintWidth}px`,
					top: `${fixture.observedTop}px`,
					transform,
					visibility: "visible",
					width: `${fixture.paintWidth}px`,
					...pseudoOverrides,
				});
			}
			if (pseudo) return declaration({ content: "none" });
			if (element.tagName.toLowerCase() === fixture.tag) {
				return declaration({
					"border-bottom-style": fixture.borderBottom ? "solid" : "none",
					"border-bottom-width": `${fixture.borderBottom}px`,
					"border-left-width": "0px",
					"border-right-width": "0px",
					"border-top-width": `${fixture.borderTop}px`,
					"border-top-style": fixture.borderTop ? "solid" : "none",
					display: "block",
					float: "none",
					"margin-bottom": "16px",
					opacity: "1",
					overflow: "visible",
					"padding-bottom": `${fixture.paddingBottom}px`,
					"padding-left": `${fixture.paddingLeft}px`,
					"padding-right": "0px",
					"padding-top": "0px",
					position: "relative",
					transform: "none",
					visibility: "visible",
					"writing-mode": "horizontal-tb",
					...sourceOverrides,
				});
			}
			if (element.hasAttribute("data-contents-wrapper")) {
				return declaration({ display: "contents", visibility: "visible" });
			}
			if (element.tagName === "ARTICLE") {
				return declaration({
					display: "block",
					visibility: "visible",
					...parentOverrides,
				});
			}
			return declaration({ display: "block", visibility: "visible" });
		},
		getSelection: window.getSelection.bind(window),
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: vi.fn(),
		write:
			mode === "legacy"
				? null
				: async (items) => {
						const item = items[0] as ClipboardItemStub;
						const htmlBlob = item.payload["text/html"];
						const textBlob = item.payload["text/plain"];
						if (!htmlBlob || !textBlob)
							throw new Error("heading payload missing");
						try {
							html = await blobText(htmlBlob);
							text = await blobText(textBlob);
						} catch (error) {
							writeError = error;
							throw error;
						}
					},
	});
	const originalExecCommand = Object.getOwnPropertyDescriptor(
		document,
		"execCommand",
	);
	if (mode === "legacy") {
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: () => {
				const event = new Event("copy", { bubbles: true, cancelable: true });
				Object.defineProperty(event, "clipboardData", {
					value: {
						setData: (type: string, value: string) => {
							if (type === "text/html") html = value;
							if (type === "text/plain") text = value;
						},
					},
				});
				document.dispatchEvent(event);
				return true;
			},
		});
	}
	try {
		if (mode === "legacy") await prepareClipboard(clipboard, preview);
		const result = await clipboard.copy(preview);
		expect(writeError).toBeUndefined();
		expect(result).toEqual({ method: mode, status: "copied" });
	} finally {
		if (mode === "legacy") {
			if (originalExecCommand)
				Object.defineProperty(document, "execCommand", originalExecCommand);
			else
				delete (document as unknown as { execCommand?: unknown }).execCommand;
		}
	}
	expect(preview.innerHTML).toBe(originalMarkup);
	expect(text).toBe(`${fixture.text}\nFollowing`);
	const holder = document.createElement("div");
	holder.innerHTML = html;
	return { holder, html, text };
}

// This conservative model is not a description of WeChat's internal sanitizer.
function saveModel(holder: HTMLElement): HTMLElement {
	const saved = holder.cloneNode(true) as HTMLElement;
	[...saved.querySelectorAll("span")].reverse().forEach((marker) => {
		const isPaint = /linear-gradient\(/u.test(
			`${declaredStyleValue(marker, "background")} ${declaredStyleValue(marker, "background-image")}`,
		);
		if (
			(marker.getAttribute("aria-hidden") === "true" || isPaint) &&
			(["", " "].includes(marker.textContent ?? "") ||
				declaredStyleValue(marker, "position") === "absolute")
		) {
			marker.remove();
		}
	});
	return saved;
}

function pixels(element: Element, property: string): number {
	const value = (element as HTMLElement).style.getPropertyValue(property);
	if (!value) return 0;
	expect(value).toMatch(/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/u);
	return Number.parseFloat(value);
}

function gradientPaint(heading: Element): Element | undefined {
	return [...heading.querySelectorAll("span")].find((element) =>
		/linear-gradient\(/u.test(
			`${declaredStyleValue(element, "background")} ${declaredStyleValue(element, "background-image")}`,
		),
	);
}

describe("empty absolute heading after decoration", () => {
	installClipboardTestEnvironment();

	it.each(cases)(
		"retains paint and placement in the save model: $name",
		async (fixture) => {
			const { holder: copied } = await copyHeading(fixture);
			const copiedHeading = copied.querySelector(fixture.tag);
			if (!copiedHeading) throw new Error("copied heading missing");
			expect(
				gradientPaint(copiedHeading),
				"the clipboard must contain the source paint",
			).toBeDefined();
			const saved = saveModel(copied);
			const heading = saved.querySelector(fixture.tag);
			if (!heading) throw new Error("saved heading missing");
			const visible = heading.cloneNode(true) as HTMLElement;
			visible.querySelectorAll('[aria-hidden="true"]').forEach((marker) => {
				marker.remove();
			});
			expect(visible.textContent).toBe(fixture.markup.replace("<br>", ""));
			expect(visible.querySelectorAll("br")).toHaveLength(
				fixture.markup.includes("<br>") ? 1 : 0,
			);
			expect(saved.querySelector("p")?.textContent).toBe("Following");

			const paint = gradientPaint(heading);
			expect(
				paint,
				"the modeled save must retain the painted carrier",
			).toBeDefined();
			if (!paint) throw new Error("saved heading paint missing");
			const carrier = paint.parentElement;
			expect(carrier?.parentElement).toBe(heading);
			if (!carrier) throw new Error("saved heading carrier missing");
			expect(carrier.getAttribute("aria-hidden")).toBe("true");
			expect(carrier.textContent).toBe("\u2060");
			expect(paint.textContent).toBe("\u2060");
			expect(carrier.childNodes).toHaveLength(1);
			expect(carrier.firstChild).toBe(paint);
			expect(paint.childNodes).toHaveLength(1);
			expect(paint.firstChild?.nodeType).toBe(Node.TEXT_NODE);
			expect(declaredStyleValue(carrier, "display")).toBe("block");
			expect(declaredStyleValue(carrier, "text-align")).toBe("left");
			expect(declaredStyleValue(carrier, "height")).toMatch(/^0(?:px)?$/u);
			expect(declaredStyleValue(carrier, "line-height")).toMatch(/^0(?:px)?$/u);
			expect(declaredStyleValue(carrier, "font-size")).toMatch(/^0(?:px)?$/u);
			expect(pixels(carrier, "height")).toBe(0);
			expect(pixels(carrier, "line-height")).toBe(0);
			expect(["", "static"]).toContain(declaredStyleValue(carrier, "position"));
			expect(["", "static"]).toContain(declaredStyleValue(paint, "position"));
			expect(["", "none"]).toContain(declaredStyleValue(carrier, "float"));
			expect(["", "none"]).toContain(declaredStyleValue(paint, "float"));
			expect(["", "none"]).toContain(declaredStyleValue(carrier, "transform"));
			expect(["", "none"]).toContain(declaredStyleValue(paint, "transform"));
			expect(["", "visible"]).toContain(
				declaredStyleValue(carrier, "overflow"),
			);
			expect(declaredStyleValue(paint, "display")).toBe("inline-block");
			expect(declaredStyleValue(paint, "vertical-align")).toBe("top");
			for (const side of ["top", "right", "bottom", "left"]) {
				expect(pixels(carrier, `margin-${side}`)).toBe(0);
				expect(pixels(carrier, `padding-${side}`)).toBe(0);
				expect(pixels(carrier, `border-${side}-width`)).toBe(0);
				expect(pixels(paint, `padding-${side}`)).toBe(0);
				expect(pixels(paint, `border-${side}-width`)).toBe(0);
			}
			expect(pixels(heading, "padding-bottom")).toBeCloseTo(
				fixture.paddingBottom,
				4,
			);
			expect(pixels(heading, "border-bottom-width")).toBe(fixture.borderBottom);
			expect(pixels(heading, "border-top-width")).toBe(fixture.borderTop);
			expect(pixels(heading, "margin-bottom")).toBe(16);
			expect(pixels(paint, "width")).toBe(fixture.paintWidth);
			expect(pixels(paint, "height")).toBe(fixture.paintHeight);
			expect(declaredStyleValue(paint, "border-radius")).toBe("999px");
			const contentBottom =
				fixture.height - fixture.borderBottom - fixture.paddingBottom;
			expect(
				Math.abs(
					contentBottom +
						pixels(paint, "margin-top") -
						fixture.borderTop -
						fixture.observedTop,
				),
			).toBeLessThanOrEqual(geometryEpsilon);
			expect(
				Math.abs(
					fixture.paddingLeft + pixels(paint, "margin-left") - fixture.left,
				),
			).toBeLessThanOrEqual(geometryEpsilon);
		},
	);

	it.each(cases)("matches both Clipboard paths: $name", async (fixture) => {
		const modern = await copyHeading(fixture);
		const legacy = await copyHeading(fixture, "none", "legacy");
		expect(legacy.html).toBe(modern.html);
		expect(legacy.text).toBe(modern.text);
	});

	it.each([
		{ name: "inconsistent top", styles: { top: "0px" } },
		{ name: "inconsistent right", styles: { right: "0px" } },
		{ name: "nonzero margin", styles: { "margin-top": "1px" } },
		{ name: "nonzero border", styles: { "border-top-width": "1px" } },
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
			const paint = gradientPaint(heading);
			if (!paint) throw new Error("projected heading paint missing");
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

	it("normalizes only the inner paint text and restores it after connected plain-text measurement", () => {
		const clone = document.createElement("article");
		const heading = document.createElement("h2");
		heading.append("Heading");
		const wrapper = document.createElement("span");
		wrapper.setAttribute("aria-hidden", "true");
		const paint = document.createElement("span");
		paint.setAttribute("aria-hidden", "true");
		const paintText = document.createTextNode(" ");
		paint.append(paintText);
		wrapper.append(paint);
		heading.append(wrapper);
		clone.append(heading);
		GENERATED_EMPTY_HEADING_SUFFIX_CLONES.add(paint);
		HEADING_EMPTY_PSEUDO_FLOW_CLONES.add(paint);

		const finalized = finalizeMarkup(clone, new Set());
		expect(wrapper.childNodes).toHaveLength(1);
		expect(wrapper.firstChild).toBe(paint);
		expect(paint.childNodes).toHaveLength(1);
		expect(paintText.nodeValue).toBe("\u2060");
		expect(EXPORT_TEXT_NORMALIZATIONS.get(finalized)?.get(paintText)).toEqual({
			original: "",
			encoded: "\u2060",
		});
		let duringMeasurement: string | null = null;
		Object.defineProperty(finalized, "innerText", {
			configurable: true,
			get: () => {
				duringMeasurement = paintText.nodeValue;
				return `Heading${paintText.nodeValue ?? ""}`;
			},
		});
		const source = document.createElement("article");
		Object.defineProperty(source, "innerText", {
			configurable: true,
			value: "Heading",
		});
		expect(connectedPlainText(finalized, source)).toBe("Heading");
		expect(duringMeasurement).toBe("");
		expect(paintText.nodeValue).toBe("\u2060");
		expect(wrapper.childNodes).toHaveLength(1);
	});

	it("rejects damage to the registered wrapper, paint, geometry, or text record", async () => {
		const fixture = cases[0];
		if (!fixture) throw new Error("heading fixture missing");
		const captured: HeadingEmptyPseudoFlowExpectation[] = [];
		const appendChild = Node.prototype.appendChild;
		Object.defineProperty(Node.prototype, "appendChild", {
			configurable: true,
			writable: true,
			value: function (this: Node, child: Node): Node {
				const result = appendChild.call(this, child);
				if (child instanceof Element) {
					const expectation = HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.get(child);
					if (expectation && this === expectation.cloneHeading)
						captured.push(expectation);
				}
				return result;
			},
		});
		try {
			await copyHeading(fixture);
		} finally {
			Object.defineProperty(Node.prototype, "appendChild", {
				configurable: true,
				writable: true,
				value: appendChild,
			});
		}
		const expectation = captured.at(-1);
		if (!expectation) throw new Error("heading flow expectation missing");
		const { cloneHeading, marker, paint } = expectation;
		const root = cloneHeading.parentElement;
		if (!(root instanceof HTMLElement))
			throw new Error("finalized heading root missing");
		const check = () => assertHeadingEmptyPseudoFlows([expectation], root);
		expect(check).not.toThrow();

		marker.remove();
		expect(check).toThrow("wechat-heading-pseudo-flow-carrier-missing");
		cloneHeading.appendChild(marker);
		marker.removeChild(paint);
		cloneHeading.appendChild(paint);
		expect(check).toThrow("wechat-heading-pseudo-flow-carrier-missing");
		marker.appendChild(paint);
		marker.appendChild(document.createTextNode(" "));
		expect(check).toThrow("wechat-heading-pseudo-flow-carrier-missing");
		marker.lastChild?.remove();

		const wrapperStyle = marker.getAttribute("style");
		(marker as HTMLElement).style.height = "1px";
		expect(check).toThrow("wechat-heading-pseudo-flow-geometry-mismatch");
		if (wrapperStyle === null) throw new Error("wrapper style missing");
		marker.setAttribute("style", wrapperStyle);

		const paintStyle = paint.getAttribute("style");
		if (paintStyle === null) throw new Error("paint style missing");
		paint.setAttribute(
			"style",
			paintStyle.replaceAll("linear-gradient", "radial-gradient"),
		);
		expect(check).toThrow("wechat-heading-pseudo-flow-paint-mismatch");
		paint.setAttribute("style", paintStyle);

		const text = paint.firstChild;
		if (!(text instanceof Text)) throw new Error("paint text missing");
		const records = EXPORT_TEXT_NORMALIZATIONS.get(root);
		const record = records?.get(text);
		if (!record) throw new Error("paint normalization missing");
		records?.delete(text);
		expect(check).toThrow("wechat-heading-pseudo-flow-carrier-missing");
		records?.set(text, record);
		expect(check).not.toThrow();
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
