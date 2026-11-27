import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import {
	declaration,
	installClipboardTestEnvironment,
} from "./wechat-clipboard-test-fixtures";
import type { WechatInlinePseudoPaintReadiness } from "./wechat-inline-pseudo-paint";
import { serializeClipboardPayload } from "./wechat-portable-serialization";

function rect(width: number, height: number): DOMRect {
	return {
		bottom: height,
		height,
		left: 0,
		right: width,
		top: 0,
		width,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	} as DOMRect;
}

function style(values: Record<string, string>): CSSStyleDeclaration {
	return declaration(
		new Proxy(values, {
			get: (target, property: string) => target[property] ?? "",
		}),
	);
}

function ownerStyle(display: "block" | "inline"): CSSStyleDeclaration {
	return style({
		display,
		position: "static",
		float: "none",
		transform: "none",
		"writing-mode": "horizontal-tb",
		direction: "ltr",
		overflow: "visible",
		"overflow-x": "visible",
		"overflow-y": "visible",
		contain: "none",
		"content-visibility": "visible",
		"box-sizing": "border-box",
		width: display === "block" ? "320px" : "80px",
		height: "24px",
		"min-width": "0px",
		"max-width": "none",
		"min-height": "0px",
		"max-height": "none",
		"inline-size": display === "block" ? "320px" : "80px",
		"block-size": "24px",
		"min-inline-size": "0px",
		"max-inline-size": "none",
		"min-block-size": "0px",
		"max-block-size": "none",
		padding: "0px",
		"padding-top": "0px",
		"padding-right": "0px",
		"padding-bottom": "0px",
		"padding-left": "0px",
		margin: "0px",
		"margin-top": "0px",
		"margin-right": "0px",
		"margin-bottom": "0px",
		"margin-left": "0px",
		"background-image": "none",
		color: "rgb(20, 20, 20)",
		"font-family": "Private Font",
		"font-size": "16px",
		"font-style": "normal",
		"font-weight": "400",
		"font-stretch": "100%",
		"font-variant": "normal",
		"line-height": "24px",
		"letter-spacing": "normal",
		"word-spacing": "0px",
		"text-align": "start",
		"text-decoration": "none",
		"text-decoration-line": "none",
		"text-transform": "none",
		"text-indent": "0px",
		"text-shadow": "none",
		background: "rgb(52, 152, 219)",
		"background-color": "rgb(52, 152, 219)",
		"box-shadow": "none",
		filter: "none",
		clip: "auto",
		"clip-path": "none",
		mask: "none",
		"mask-image": "none",
		"mask-mode": "match-source",
		"mask-size": "auto",
		"mask-repeat": "repeat",
		"mask-position": "0% 0%",
		"mask-composite": "add",
		"mask-origin": "border-box",
		"mask-clip": "border-box",
		"-webkit-mask": "none",
		"-webkit-mask-image": "none",
		"-webkit-mask-mode": "match-source",
		"-webkit-mask-size": "auto",
		"-webkit-mask-repeat": "repeat",
		"-webkit-mask-position": "0% 0%",
		"-webkit-mask-composite": "add",
		"-webkit-mask-origin": "border-box",
		"-webkit-mask-clip": "border-box",
	});
}

function circleStyle(): CSSStyleDeclaration {
	return style({
		content: '""',
		display: "inline-block",
		position: "static",
		float: "none",
		transform: "none",
		"transform-origin": "50% 50%",
		"writing-mode": "horizontal-tb",
		direction: "ltr",
		"box-sizing": "content-box",
		width: "10px",
		height: "10px",
		"min-width": "10px",
		"max-width": "10px",
		"min-height": "10px",
		"max-height": "10px",
		"inline-size": "10px",
		"block-size": "10px",
		"min-inline-size": "10px",
		"max-inline-size": "10px",
		"min-block-size": "10px",
		"max-block-size": "10px",
		padding: "0px",
		"padding-top": "0px",
		"padding-right": "0px",
		"padding-bottom": "0px",
		"padding-left": "0px",
		margin: "0px",
		"margin-top": "0px",
		"margin-right": "0px",
		"margin-bottom": "0px",
		"margin-left": "0px",
		border: "1px solid rgb(52, 152, 219)",
		"border-width": "1px",
		"border-style": "solid",
		"border-color": "rgb(52, 152, 219)",
		"border-top-width": "1px",
		"border-right-width": "1px",
		"border-bottom-width": "1px",
		"border-left-width": "1px",
		"border-top-style": "solid",
		"border-right-style": "solid",
		"border-bottom-style": "solid",
		"border-left-style": "solid",
		"border-top-color": "rgb(52, 152, 219)",
		"border-right-color": "rgb(52, 152, 219)",
		"border-bottom-color": "rgb(52, 152, 219)",
		"border-left-color": "rgb(52, 152, 219)",
		"border-radius": "100%",
		"border-top-left-radius": "100%",
		"border-top-right-radius": "100%",
		"border-bottom-right-radius": "100%",
		"border-bottom-left-radius": "100%",
		"vertical-align": "baseline",
		"font-family": "Private Font",
		"font-size": "16px",
		"font-style": "normal",
		"font-weight": "400",
		"font-stretch": "100%",
		"font-variant": "normal",
		"line-height": "24px",
		"letter-spacing": "normal",
		"word-spacing": "0px",
		"text-decoration": "none",
		"text-decoration-line": "none",
		background: "rgb(52, 152, 219)",
		"background-color": "rgb(52, 152, 219)",
		"background-image": "none",
		outline: "none",
		"outline-width": "0px",
		"outline-style": "none",
		"outline-color": "invert",
		"box-shadow": "none",
		filter: "none",
		opacity: "1",
		visibility: "visible",
		"content-visibility": "visible",
		clip: "auto",
		"clip-path": "none",
		"animation-name": "none",
		"animation-duration": "0s",
		"animation-delay": "0s",
		"animation-iteration-count": "1",
		"transition-property": "none",
		"transition-duration": "0s",
		"transition-delay": "0s",
		"transition-behavior": "normal",
		mask: "none",
		"mask-image": "none",
		"mask-mode": "match-source",
		"mask-size": "auto",
		"mask-repeat": "repeat",
		"mask-position": "0% 0%",
		"mask-composite": "add",
		"mask-origin": "border-box",
		"mask-clip": "border-box",
		"-webkit-mask": "none",
		"-webkit-mask-image": "none",
		"-webkit-mask-mode": "match-source",
		"-webkit-mask-size": "auto",
		"-webkit-mask-repeat": "repeat",
		"-webkit-mask-position": "0% 0%",
		"-webkit-mask-composite": "add",
		"-webkit-mask-origin": "border-box",
		"-webkit-mask-clip": "border-box",
	});
}

function maskStyle(): CSSStyleDeclaration {
	const path = "M1 1H15V15H1Z";
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${path}" fill="#000000"/></svg>`;
	const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
	return style({
		...circleStyleValuesForMask(),
		mask: url,
		"mask-image": url,
		"mask-mode": "match-source",
		"mask-size": "contain",
		"mask-repeat": "no-repeat",
		"mask-position": "50% 50%",
		"mask-composite": "add",
		"mask-origin": "border-box",
		"mask-clip": "border-box",
		"-webkit-mask": url,
		"-webkit-mask-image": url,
		"-webkit-mask-mode": "",
		"-webkit-mask-size": "contain",
		"-webkit-mask-repeat": "no-repeat",
		"-webkit-mask-position": "50% 50%",
		"-webkit-mask-composite": "add",
		"-webkit-mask-origin": "border-box",
		"-webkit-mask-clip": "border-box",
	});
}

function circleStyleValuesForMask(): Record<string, string> {
	return {
		content: '""',
		display: "inline-block",
		position: "static",
		float: "none",
		transform: "none",
		"transform-origin": "50% 50%",
		"writing-mode": "horizontal-tb",
		direction: "ltr",
		"box-sizing": "content-box",
		width: "16px",
		height: "16px",
		"min-width": "16px",
		"max-width": "16px",
		"min-height": "16px",
		"max-height": "16px",
		"inline-size": "16px",
		"block-size": "16px",
		"min-inline-size": "16px",
		"max-inline-size": "16px",
		"min-block-size": "16px",
		"max-block-size": "16px",
		padding: "0px",
		"padding-top": "0px",
		"padding-right": "0px",
		"padding-bottom": "0px",
		"padding-left": "0px",
		margin: "0px",
		"margin-top": "0px",
		"margin-right": "0px",
		"margin-bottom": "0px",
		"margin-left": "0px",
		border: "0px none rgb(0, 0, 0)",
		"border-width": "0px",
		"border-style": "none",
		"border-color": "rgb(0, 0, 0)",
		"border-top-width": "0px",
		"border-right-width": "0px",
		"border-bottom-width": "0px",
		"border-left-width": "0px",
		"border-top-style": "none",
		"border-right-style": "none",
		"border-bottom-style": "none",
		"border-left-style": "none",
		"border-top-color": "rgb(0, 0, 0)",
		"border-right-color": "rgb(0, 0, 0)",
		"border-bottom-color": "rgb(0, 0, 0)",
		"border-left-color": "rgb(0, 0, 0)",
		"border-radius": "0px",
		"border-top-left-radius": "0px",
		"border-top-right-radius": "0px",
		"border-bottom-right-radius": "0px",
		"border-bottom-left-radius": "0px",
		"vertical-align": "baseline",
		"font-family": "Private Font",
		"font-size": "16px",
		"font-style": "normal",
		"font-weight": "400",
		"font-stretch": "100%",
		"font-variant": "normal",
		"line-height": "24px",
		"letter-spacing": "normal",
		"word-spacing": "0px",
		"text-decoration": "none",
		"text-decoration-line": "none",
		background: "rgb(52, 152, 219)",
		"background-color": "rgb(52, 152, 219)",
		"background-image": "none",
		outline: "none",
		"outline-width": "0px",
		"outline-style": "none",
		"outline-color": "invert",
		"box-shadow": "none",
		filter: "none",
		opacity: "1",
		visibility: "visible",
		"content-visibility": "visible",
		clip: "auto",
		"clip-path": "none",
		"animation-name": "none",
		"animation-duration": "0s",
		"animation-delay": "0s",
		"animation-iteration-count": "1",
		"transition-property": "none",
		"transition-duration": "0s",
		"transition-delay": "0s",
		"transition-behavior": "normal",
	};
}

describe("production inline pseudo-paint integration", () => {
	installClipboardTestEnvironment();

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("assembles, binds, and applies six link plus two heading owners after finalization", async () => {
		vi.stubGlobal("CSS", {
			supports: (property: string) => "-webkit-mask-mode" !== property,
		});
		const preview = document.createElement("article");
		preview.setAttribute("data-easymde-preview-html-sink", "1");
		const styles = new Map<
			Element,
			Readonly<{ owner: CSSStyleDeclaration; pseudo: CSSStyleDeclaration }>
		>();
		for (let index = 0; index < 6; index += 1) {
			const link = document.createElement("a");
			link.href = `/owner-${index}`;
			link.setAttribute("data-owner", String(index));
			link.setAttribute("title", `Owner ${index}`);
			link.textContent = `Link ${index}`;
			preview.append(link);
			styles.set(link, { owner: ownerStyle("inline"), pseudo: maskStyle() });
		}
		for (let index = 0; index < 2; index += 1) {
			const heading = document.createElement("h4");
			heading.setAttribute("data-heading", String(index));
			heading.textContent = `Heading ${index}`;
			preview.append(heading);
			styles.set(heading, {
				owner: ownerStyle("block"),
				pseudo: circleStyle(),
			});
		}
		styles.set(preview, {
			owner: ownerStyle("block"),
			pseudo: style({ content: "none" }),
		});
		document.body.append(preview);
		for (const element of [
			preview,
			...Array.from(preview.querySelectorAll("*")),
		]) {
			element.getBoundingClientRect = () => rect(320, 24);
		}
		const getComputedStyle = (
			element: Element,
			pseudoElement?: string,
		): CSSStyleDeclaration => {
			const pair = styles.get(element);
			if (!pair) return style({ display: "block" });
			if ("::before" === pseudoElement) return pair.pseudo;
			if (pseudoElement) return style({ content: "none" });
			return pair.owner;
		};
		const runtime: BrowserWechatClipboardRuntime = {
			blob: Blob,
			clipboardItem: null,
			document,
			getComputedStyle,
			getSelection: () => null,
			pageOffset: () => ({ x: 0, y: 0 }),
			scrollTo: () => undefined,
			write: null,
		};
		const isReady = vi.fn(() => true);
		const isCurrent = vi.fn(() => true);
		const readiness: WechatInlinePseudoPaintReadiness = {
			existing: { kind: "transition", lease: { isReady } },
			sourceFreshness: { isCurrent },
		};
		const source = preview.innerHTML;

		const payload = await serializeClipboardPayload(
			preview,
			runtime,
			new Map(),
			null,
			undefined,
			undefined,
			preview,
			null,
			null,
			null,
			"",
			"",
			null,
			undefined,
			null,
			readiness,
		);

		const output = document.createElement("div");
		output.innerHTML = payload.html;
		expect(output.querySelectorAll("a")).toHaveLength(6);
		expect(output.querySelectorAll("h4")).toHaveLength(2);
		expect(output.querySelectorAll("svg")).toHaveLength(8);
		expect(output.querySelectorAll("a[href][title]")).toHaveLength(6);
		expect(payload.text).toContain("Link 0");
		expect(payload.text).toContain("Heading 1");
		expect(preview.innerHTML).toBe(source);
		expect(isReady).toHaveBeenCalled();
		expect(isCurrent).toHaveBeenCalled();
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
				null,
				"",
				"",
				null,
				undefined,
				null,
				null,
			),
		).rejects.toThrow("wechat-inline-pseudo-paint-readiness-missing");
		preview.remove();
	});
});
