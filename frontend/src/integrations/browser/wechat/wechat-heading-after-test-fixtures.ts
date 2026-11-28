import {
	expect,
	vi,
} from "vitest";

import { createBrowserWechatClipboard } from "./create-browser-wechat-clipboard";
import {
	blobText,
	declaration,
	declaredStyleValue,
	prepareClipboard,
} from "./wechat-clipboard-test-fixtures";

export type HeadingCase = Readonly<{
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

export const cases: readonly HeadingCase[] = [
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

export const inBoxCases: readonly HeadingCase[] = [
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

export const gradient = "linear-gradient(90deg, rgb(60, 100, 180), transparent)";
export const headingWidth = 419.5;
export const geometryEpsilon = 1 / 64;

export class ClipboardItemStub {
	constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
}

export async function copyHeading(
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
	parentRectWidth?: number,
	sourceRectLeft = 0,
) {
	const preview = document.createElement("article");
	preview.setAttribute("data-easymde-preview-html-sink", "1");
	if (typeof parentRectWidth === "number") {
		Object.defineProperty(preview, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				bottom: 400,
				height: 400,
				left: 0,
				right: parentRectWidth,
				top: 0,
				width: parentRectWidth,
				x: 0,
				y: 0,
			}),
		});
	}
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
			left: sourceRectLeft,
			right: sourceRectLeft + headingWidth,
			top: 0,
			width: headingWidth,
			x: sourceRectLeft,
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

export function pixels(element: Element, property: string): number {
	const value =
		declaredStyleValue(element, property) ||
		(element as HTMLElement).style.getPropertyValue(property);
	if (!value) return 0;
	expect(value).toMatch(/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/u);
	return Number.parseFloat(value);
}
