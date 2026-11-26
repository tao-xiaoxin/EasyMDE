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
	materializeHeadingAfterEmptyPseudoFlows,
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

const inBoxCases: readonly HeadingCase[] = [
	{
		name: "h2 in-box flush bottom bar",
		tag: "h2",
		markup: "Heading",
		text: "Heading",
		height: 44,
		paddingBottom: 10,
		paddingLeft: 6,
		borderTop: 0,
		borderBottom: 1,
		bottom: 0,
		left: 8,
		paintWidth: 64,
		paintHeight: 3,
		observedTop: 40,
	},
	{
		name: "h3 in-box inset bar above border",
		tag: "h3",
		markup: "Heading",
		text: "Heading",
		height: 40,
		paddingBottom: 12,
		paddingLeft: 4,
		borderTop: 2,
		borderBottom: 2,
		bottom: 4,
		left: 10,
		paintWidth: 48,
		paintHeight: 4,
		observedTop: 28,
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
	wrapInBlockquote = false,
	followingOverrides: Record<string, string> = {},
) {
	const preview = document.createElement("article");
	preview.setAttribute("data-easymde-preview-html-sink", "1");
	preview.innerHTML = wrapInBlockquote
		? `<blockquote><${fixture.tag}>${fixture.markup}</${fixture.tag}><p>Following</p></blockquote>`
		: wrapParentInContents
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
					right: `${headingWidth - (Number.parseFloat(sourceOverrides["border-left-width"] ?? "0") || 0) - (Number.parseFloat(sourceOverrides["border-right-width"] ?? "0") || 0) - fixture.left - fixture.paintWidth}px`,
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
			if (element.tagName === "P") {
				return declaration({
					display: "block",
					visibility: "visible",
					...followingOverrides,
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
	[...saved.querySelectorAll("span, section")].reverse().forEach((marker) => {
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
	const value =
		declaredStyleValue(element, property) ||
		(element as HTMLElement).style.getPropertyValue(property);
	if (!value) return 0;
	expect(value).toMatch(/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/u);
	return Number.parseFloat(value);
}

function gradientPaint(scope: Element): Element | undefined {
	return [...scope.querySelectorAll("section, span")].find((element) =>
		/linear-gradient\(/u.test(
			`${declaredStyleValue(element, "background")} ${declaredStyleValue(element, "background-image")}`,
		),
	);
}

function assertNoZeroHeightFlowStyles(html: string): void {
	expect(html).not.toMatch(/(?:^|[;\s"])height\s*:\s*0(?:px)?(?=[;\s"!]|$)/iu);
	expect(html).not.toMatch(
		/(?:^|[;\s"])line-height\s*:\s*0(?:px)?(?=[;\s"!]|$)/iu,
	);
	expect(html).not.toMatch(
		/(?:^|[;\s"])font-size\s*:\s*0(?:px)?(?=[;\s"!]|$)/iu,
	);
}

describe("empty absolute heading after decoration", () => {
	installClipboardTestEnvironment();

	it.each(cases)(
		"retains below-border paint and sibling placement without zero-height wrappers: $name",
		async (fixture) => {
			const { holder: copied, html } = await copyHeading(fixture);
			assertNoZeroHeightFlowStyles(html);
			const copiedHeading = copied.querySelector(fixture.tag);
			if (!copiedHeading) throw new Error("copied heading missing");
			expect(
				copiedHeading.nextElementSibling?.tagName,
				"below-border bar must be promoted to an immediate sibling section",
			).toBe("SECTION");
			expect(
				gradientPaint(copied),
				"the clipboard must contain the source paint",
			).toBe(copiedHeading.nextElementSibling);

			const saved = saveModel(copied);
			const heading = saved.querySelector(fixture.tag);
			if (!heading) throw new Error("saved heading missing");
			expect(heading.querySelector('[aria-hidden="true"]')).toBeNull();
			expect(heading.textContent).toBe(fixture.markup.replace("<br>", ""));
			expect(heading.querySelectorAll("br")).toHaveLength(
				fixture.markup.includes("<br>") ? 1 : 0,
			);
			expect(saved.querySelector("p")?.textContent).toBe("Following");

			const sibling = heading.nextElementSibling;
			expect(
				sibling,
				"the modeled save must retain the painted sibling section",
			).not.toBeNull();
			if (!sibling) throw new Error("saved heading sibling missing");
			expect(sibling.tagName).toBe("SECTION");
			expect(sibling.parentElement).toBe(heading.parentElement);
			expect(sibling.getAttribute("aria-hidden")).toBe("true");
			expect(sibling.getAttribute("data-ignore-dm")).toBe("text-bg-gradient");
			expect(sibling.textContent).toBe("\u2060");
			expect(sibling.childNodes).toHaveLength(1);
			expect(sibling.firstChild?.nodeType).toBe(Node.TEXT_NODE);
			expect(declaredStyleValue(sibling, "display")).toBe("block");
			expect(declaredStyleValue(sibling, "direction")).toBe("ltr");
			expect(declaredStyleValue(sibling, "position")).toBe("static");
			expect(declaredStyleValue(sibling, "float")).toBe("none");
			expect(declaredStyleValue(sibling, "transform")).toBe("none");
			expect(declaredStyleValue(sibling, "overflow")).toBe("hidden");
			expect(pixels(sibling, "width")).toBe(fixture.paintWidth);
			expect(pixels(sibling, "height")).toBe(fixture.paintHeight);
			expect(pixels(sibling, "line-height")).toBe(fixture.paintHeight);
			expect(pixels(sibling, "font-size")).toBe(
				Math.max(1, Math.round(fixture.paintHeight)),
			);
			expect(declaredStyleValue(sibling, "margin-right")).toBe("auto");
			for (const side of ["top", "right", "bottom", "left"]) {
				expect(pixels(sibling, `padding-${side}`)).toBe(0);
				expect(pixels(sibling, `border-${side}-width`)).toBe(0);
			}
			expect(declaredStyleValue(sibling, "border-radius")).toBe("999px");
			expect(declaredStyleValue(sibling, "opacity")).toBe("1");

			expect(pixels(heading, "padding-bottom")).toBeCloseTo(
				fixture.paddingBottom,
				4,
			);
			expect(pixels(heading, "border-bottom-width")).toBe(fixture.borderBottom);
			expect(pixels(heading, "border-top-width")).toBe(fixture.borderTop);
			expect(pixels(heading, "margin-bottom")).toBe(0);

			const expectedGap = Math.max(
				0,
				-fixture.bottom - fixture.borderBottom - fixture.paintHeight,
			);
			const expectedRemainingMarginBottom =
				16 - expectedGap - fixture.paintHeight;
			expect(pixels(sibling, "margin-top")).toBeCloseTo(expectedGap, 4);
			expect(pixels(sibling, "margin-bottom")).toBeCloseTo(
				expectedRemainingMarginBottom,
				4,
			);
			expect(pixels(sibling, "margin-left")).toBeCloseTo(fixture.left, 4);
			expect(
				Math.abs(
					fixture.height +
						pixels(sibling, "margin-top") -
						fixture.borderTop -
						fixture.observedTop,
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

	it.each(inBoxCases)(
		"retains in-box paint without zero-height wrappers and matches both Clipboard paths: $name",
		async (fixture) => {
			const modern = await copyHeading(fixture);
			const legacy = await copyHeading(fixture, "none", "legacy");
			expect(legacy.html).toBe(modern.html);
			expect(legacy.text).toBe(modern.text);
			assertNoZeroHeightFlowStyles(modern.html);

			const saved = saveModel(modern.holder);
			const heading = saved.querySelector(fixture.tag);
			if (!heading) throw new Error("saved in-box heading missing");
			expect(heading.nextElementSibling?.tagName).toBe("P");
			const paint = heading.querySelector(':scope > span[aria-hidden="true"]');
			if (!paint) throw new Error("saved in-box paint span missing");
			expect(paint.getAttribute("data-ignore-dm")).toBe("text-bg-gradient");
			expect(paint.textContent).toBe("\u2060");
			expect(paint.childNodes).toHaveLength(1);
			expect(paint.firstChild?.nodeType).toBe(Node.TEXT_NODE);
			expect(declaredStyleValue(paint, "display")).toBe("block");
			expect(declaredStyleValue(paint, "direction")).toBe("ltr");
			expect(declaredStyleValue(paint, "position")).toBe("static");
			expect(declaredStyleValue(paint, "float")).toBe("none");
			expect(declaredStyleValue(paint, "transform")).toBe("none");
			expect(declaredStyleValue(paint, "overflow")).toBe("hidden");
			expect(pixels(paint, "width")).toBe(fixture.paintWidth);
			expect(pixels(paint, "height")).toBe(fixture.paintHeight);
			expect(pixels(paint, "line-height")).toBe(fixture.paintHeight);
			expect(pixels(paint, "font-size")).toBe(
				Math.max(1, Math.round(fixture.paintHeight)),
			);
			expect(declaredStyleValue(paint, "margin-right")).toBe("auto");
			expect(pixels(paint, "margin-bottom")).toBe(0);
			for (const side of ["top", "right", "bottom", "left"]) {
				expect(pixels(paint, `padding-${side}`)).toBe(0);
				expect(pixels(paint, `border-${side}-width`)).toBe(0);
			}
			expect(pixels(heading, "padding-bottom")).toBeCloseTo(
				Math.max(0, fixture.bottom),
				4,
			);
			expect(pixels(heading, "margin-bottom")).toBe(16);
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
					contentBottom +
						pixels(paint, "margin-top") +
						pixels(paint, "height") +
						pixels(heading, "padding-bottom") +
						fixture.borderBottom -
						fixture.height,
				),
			).toBeLessThanOrEqual(geometryEpsilon);
			expect(
				Math.abs(
					fixture.paddingLeft + pixels(paint, "margin-left") - fixture.left,
				),
			).toBeLessThanOrEqual(geometryEpsilon);
		},
	);

	it("omits data-ignore-dm on solid-color bars and preserves sibling placement inside blockquote", async () => {
		const belowBorderFixture = cases[0];
		const inBoxFixture = inBoxCases[0];
		if (!belowBorderFixture || !inBoxFixture)
			throw new Error("heading fixture missing");
		const solidOverrides = {
			background: "rgb(60, 100, 180)",
			"background-color": "rgb(60, 100, 180)",
			"background-image": "none",
		};
		const solidBelow = await copyHeading(
			belowBorderFixture,
			"none",
			"clipboard",
			solidOverrides,
			{},
			{ "border-left-width": "3px", "border-left-style": "solid" },
			{},
			false,
			true,
		);
		assertNoZeroHeightFlowStyles(solidBelow.html);
		const quoteSection = solidBelow.holder.querySelector("section > section");
		const heading = quoteSection?.querySelector(belowBorderFixture.tag);
		const sibling = heading?.nextElementSibling;
		expect(sibling?.tagName).toBe("SECTION");
		expect(sibling?.parentElement).toBe(quoteSection);
		expect(sibling?.getAttribute("aria-hidden")).toBe("true");
		expect(sibling?.getAttribute("data-ignore-dm")).toBeNull();
		expect(pixels(sibling as Element, "margin-left")).toBeCloseTo(
			3 + belowBorderFixture.left,
			4,
		);
		expect(declaredStyleValue(sibling as Element, "background-color")).toBe(
			"rgb(60, 100, 180)",
		);
		expect(sibling?.nextElementSibling?.tagName).toBe("P");

		const solidInBox = await copyHeading(
			inBoxFixture,
			"none",
			"clipboard",
			solidOverrides,
		);
		assertNoZeroHeightFlowStyles(solidInBox.html);
		const inBoxPaint = solidInBox.holder.querySelector(
			`${inBoxFixture.tag} > span[aria-hidden="true"]`,
		);
		expect(inBoxPaint).not.toBeNull();
		expect(inBoxPaint?.getAttribute("data-ignore-dm")).toBeNull();
	});

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

	it("normalizes and preserves the transport text node across sibling materialization and plain-text measurement", () => {
		const clone = document.createElement("article");
		const heading = document.createElement("h2");
		heading.setAttribute(
			"style",
			"margin-bottom:16px;padding-bottom:6px;padding-left:0px;border-top-width:0px;border-bottom-width:1px;border-left-width:0px",
		);
		heading.append("Heading");
		const pending = document.createElement("span");
		pending.setAttribute("aria-hidden", "true");
		const paintText = document.createTextNode(" ");
		pending.append(paintText);
		heading.append(pending);
		clone.append(heading);
		GENERATED_EMPTY_HEADING_SUFFIX_CLONES.add(pending);
		HEADING_EMPTY_PSEUDO_FLOW_CLONES.add(pending);
		const backgroundDeclarations = [
			{
				important: false,
				property: "background-image",
				value: gradient,
			},
		] as const;
		const expectation: HeadingEmptyPseudoFlowExpectation = {
			cloneHeading: heading,
			flow: {
				kind: "after",
				placement: "below-border",
				background: JSON.stringify(backgroundDeclarations),
				backgroundDeclarations,
				borderBottom: 1,
				borderLeft: 0,
				borderRadius: "999px",
				borderTop: 0,
				bottom: -14,
				gapBelowBorder: 10,
				hasGradientBackground: true,
				headingMarginBottom: 16,
				height: 3,
				left: 0,
				marginLeft: 0,
				marginTop: 10,
				opacity: 1,
				paddingBottom: 6,
				paddingLeft: 0,
				remainingMarginBottom: 3,
				width: 76,
			},
			marker: pending,
			paint: pending,
			source: heading,
		};
		HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.set(pending, expectation);
		const expectations: HeadingEmptyPseudoFlowExpectation[] = [expectation];

		const finalized = finalizeMarkup(clone, new Set());
		materializeHeadingAfterEmptyPseudoFlows(finalized, expectations);
		assertHeadingEmptyPseudoFlows(expectations, finalized);
		const sibling = heading.nextElementSibling;
		if (!sibling) throw new Error("materialized sibling missing");
		expect(sibling.tagName).toBe("SECTION");
		expect(sibling.childNodes).toHaveLength(1);
		expect(sibling.firstChild).toBe(paintText);
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
		expect(sibling.childNodes).toHaveLength(1);
	});

	it("rejects damage to below-border sibling placement, zero-height styles, geometry, paint, darkmode metadata, or text record", async () => {
		const fixture = cases[0];
		if (!fixture) throw new Error("heading fixture missing");
		const captured: HeadingEmptyPseudoFlowExpectation[] = [];
		let latestRoot: HTMLElement | null = null;
		const origOuterHtml = Object.getOwnPropertyDescriptor(
			Element.prototype,
			"outerHTML",
		);
		Object.defineProperty(Element.prototype, "outerHTML", {
			configurable: true,
			get: function (this: Element) {
				if (this instanceof HTMLElement && this.tagName === "SECTION") {
					const found = [...this.querySelectorAll("section")].find((el) =>
						HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.has(el),
					);
					if (found) {
						latestRoot = this;
						const exp = HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.get(found);
						if (exp) captured.push(exp);
					}
				}
				return origOuterHtml?.get?.call(this) ?? "";
			},
		});
		try {
			await copyHeading(fixture);
		} finally {
			if (origOuterHtml)
				Object.defineProperty(Element.prototype, "outerHTML", origOuterHtml);
		}
		const expectation = captured.at(-1);
		if (!expectation || !latestRoot)
			throw new Error("heading flow expectation missing");
		const root: HTMLElement = latestRoot;
		const { cloneHeading, marker } = expectation;
		const check = () => assertHeadingEmptyPseudoFlows([expectation], root);
		expect(check).not.toThrow();

		// Detach sibling
		marker.remove();
		expect(check).toThrow("wechat-heading-pseudo-flow-carrier-missing");

		// Misplace sibling inside heading instead of after heading
		cloneHeading.appendChild(marker);
		expect(check).toThrow("wechat-heading-pseudo-flow-carrier-missing");
		cloneHeading.parentElement?.insertBefore(marker, cloneHeading.nextSibling);
		expect(check).not.toThrow();

		// Extra child node
		marker.appendChild(document.createTextNode(" "));
		expect(check).toThrow("wechat-heading-pseudo-flow-carrier-missing");
		marker.lastChild?.remove();

		// Zero-height, zero line-height, and zero font-size declarations are strictly forbidden
		const markerStyle = marker.getAttribute("style");
		if (markerStyle === null) throw new Error("marker style missing");
		for (const zeroDecl of [
			"height:0px",
			"line-height:0px",
			"font-size:0px",
			"font-size:0",
		]) {
			marker.setAttribute("style", `${zeroDecl};${markerStyle}`);
			expect(check).toThrow("wechat-heading-pseudo-flow-geometry-mismatch");
			marker.setAttribute("style", markerStyle);
		}

		// Heading margin-bottom damage
		const headingStyle = cloneHeading.getAttribute("style");
		if (headingStyle === null) throw new Error("heading style missing");
		(cloneHeading as HTMLElement).style.marginBottom = "16px";
		expect(check).toThrow("wechat-heading-pseudo-flow-geometry-mismatch");
		cloneHeading.setAttribute("style", headingStyle);

		// Paint gradient damage
		marker.setAttribute(
			"style",
			markerStyle.replaceAll("linear-gradient", "radial-gradient"),
		);
		expect(check).toThrow("wechat-heading-pseudo-flow-paint-mismatch");
		marker.setAttribute("style", markerStyle);

		// Missing darkmode gradient metadata
		marker.removeAttribute("data-ignore-dm");
		expect(check).toThrow("wechat-heading-pseudo-flow-paint-mismatch");
		marker.setAttribute("data-ignore-dm", "text-bg-gradient");

		// Missing plain-text normalization entry
		const text = marker.firstChild;
		if (!(text instanceof Text)) throw new Error("paint text missing");
		const records = EXPORT_TEXT_NORMALIZATIONS.get(root);
		const record = records?.get(text);
		if (!record) throw new Error("paint normalization missing");
		records?.delete(text);
		expect(check).toThrow("wechat-heading-pseudo-flow-carrier-missing");
		records?.set(text, record);
		expect(check).not.toThrow();
	});

	it("rejects damage to in-box paint span geometry, heading padding-bottom, or darkmode metadata", async () => {
		const fixture = inBoxCases[0];
		if (!fixture) throw new Error("in-box heading fixture missing");
		let captured: HeadingEmptyPseudoFlowExpectation | null = null;
		let latestRoot: HTMLElement | null = null;
		const origOuterHtml = Object.getOwnPropertyDescriptor(
			Element.prototype,
			"outerHTML",
		);
		Object.defineProperty(Element.prototype, "outerHTML", {
			configurable: true,
			get: function (this: Element) {
				if (this instanceof HTMLElement && this.tagName === "SECTION") {
					const found = [...this.querySelectorAll("span")].find((el) =>
						HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.has(el),
					);
					if (found) {
						latestRoot = this;
						captured = HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.get(found) ?? null;
					}
				}
				return origOuterHtml?.get?.call(this) ?? "";
			},
		});
		try {
			await copyHeading(fixture);
		} finally {
			if (origOuterHtml)
				Object.defineProperty(Element.prototype, "outerHTML", origOuterHtml);
		}
		if (!captured || !latestRoot)
			throw new Error("in-box expectation missing");
		const expectation: HeadingEmptyPseudoFlowExpectation = captured;
		const root: HTMLElement = latestRoot;
		const { cloneHeading, marker } = expectation;
		const check = () => assertHeadingEmptyPseudoFlows([expectation], root);
		expect(check).not.toThrow();

		const headingStyle = cloneHeading.getAttribute("style") ?? "";
		(cloneHeading as HTMLElement).style.paddingBottom = "10px";
		expect(check).toThrow("wechat-heading-pseudo-flow-geometry-mismatch");
		cloneHeading.setAttribute("style", headingStyle);

		const markerStyle = marker.getAttribute("style") ?? "";
		marker.setAttribute("style", `font-size:0;${markerStyle}`);
		expect(check).toThrow("wechat-heading-pseudo-flow-geometry-mismatch");
		marker.setAttribute("style", markerStyle);

		marker.removeAttribute("data-ignore-dm");
		expect(check).toThrow("wechat-heading-pseudo-flow-paint-mismatch");
		marker.setAttribute("data-ignore-dm", "text-bg-gradient");
		expect(check).not.toThrow();
	});

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

		// C3: Heading with margin-left: 40px + dir="rtl" parent preserves horizontal offset and left anchor.
		const shifted = await copyHeading(
			bloomH2,
			"none",
			"clipboard",
			{},
			{},
			{ "margin-left": "40px", direction: "rtl" },
			{ direction: "rtl" },
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
