import { describe, expect, it, vi } from "vitest";

import {
	GENERATED_PSEUDO_CLONE_OWNERS,
	WECHAT_STRUCTURE_REPLACEMENTS,
} from "./wechat-clone-metadata";
import { normalizeStructure } from "./wechat-portable-serialization";

import {
	admitWechatInlinePseudoPaintInput,
	applyWechatInlinePseudoPaintBatch,
	assembleWechatInlinePseudoPaintSource,
	bindWechatInlinePseudoPaint,
	captureWechatInlinePseudoPaintInput,
	planWechatInlinePseudoPaint,
	readWechatInlinePseudoPaint,
} from "./wechat-inline-pseudo-paint";

type Values = Record<string, string>;
type Pseudo = "::before" | undefined;

function declaration(values: Values): CSSStyleDeclaration {
	return {
		getPropertyValue: (property: string) => values[property] ?? "",
	} as CSSStyleDeclaration;
}

function ownerValues(
	display: "block" | "inline",
	overrides: Values = {},
): Values {
	return {
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
		"box-sizing": "content-box",
		width: display === "block" ? "335px" : "128.59375px",
		height: "23px",
		"min-width": "0px",
		"max-width": "none",
		"min-height": "0px",
		"max-height": "none",
		"inline-size": display === "block" ? "335px" : "128.59375px",
		"block-size": "23px",
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
		"font-family": "Private Font",
		"font-size": "16px",
		"font-style": "normal",
		"font-weight": "500",
		"font-stretch": "100%",
		"font-variant": "normal",
		"line-height": "36px",
		"letter-spacing": "1.1px",
		"word-spacing": "2px",
		"text-align": "start",
		"text-decoration": "none",
		"text-decoration-line": "none",
		"text-transform": "none",
		"text-indent": "0px",
		"text-shadow": "none",
		background: "transparent",
		"background-color": "rgba(0, 0, 0, 0)",
		"background-image": "none",
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
		"-webkit-mask-mode": "",
		"-webkit-mask-size": "auto",
		"-webkit-mask-repeat": "repeat",
		"-webkit-mask-position": "0% 0%",
		"-webkit-mask-composite": "add",
		"-webkit-mask-origin": "border-box",
		"-webkit-mask-clip": "border-box",
		...overrides,
	};
}

function circleValues(overrides: Values = {}): Values {
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
		margin: "0px 7px 0px 0px",
		"margin-top": "0px",
		"margin-right": "7px",
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
		"font-size": "18.4px",
		"font-style": "normal",
		"font-weight": "400",
		"line-height": "23px",
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
		"transition-property": "all",
		"transition-duration": "0.3s",
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
		"-webkit-mask-mode": "",
		"-webkit-mask-size": "auto",
		"-webkit-mask-repeat": "repeat",
		"-webkit-mask-position": "0% 0%",
		"-webkit-mask-composite": "add",
		"-webkit-mask-origin": "border-box",
		"-webkit-mask-clip": "border-box",
		...overrides,
	};
}

const PATH_DATA = "M1 1H15V15H1Z";
const MASK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${PATH_DATA}" fill="#000000"/></svg>`;
const MASK_URL = `url("data:image/svg+xml;utf8,${encodeURIComponent(MASK_SVG)}")`;

function maskValues(overrides: Values = {}): Values {
	return circleValues({
		width: "16px",
		height: "16px",
		border: "0px none rgb(51, 51, 51)",
		"border-width": "0px",
		"border-style": "none",
		"border-top-width": "0px",
		"border-right-width": "0px",
		"border-bottom-width": "0px",
		"border-left-width": "0px",
		"border-top-style": "none",
		"border-right-style": "none",
		"border-bottom-style": "none",
		"border-left-style": "none",
		"border-radius": "0px",
		"border-top-left-radius": "0px",
		"border-top-right-radius": "0px",
		"border-bottom-right-radius": "0px",
		"border-bottom-left-radius": "0px",
		"transition-property": "transform",
		"transition-duration": "0.4s",
		mask: MASK_URL,
		"mask-image": MASK_URL,
		"mask-mode": "match-source",
		"mask-size": "contain",
		"mask-repeat": "no-repeat",
		"mask-position": "50% 50%",
		"mask-composite": "add",
		"mask-origin": "border-box",
		"mask-clip": "border-box",
		"-webkit-mask": MASK_URL,
		"-webkit-mask-image": MASK_URL,
		"-webkit-mask-mode": "",
		"-webkit-mask-size": "contain",
		"-webkit-mask-repeat": "no-repeat",
		"-webkit-mask-position": "50% 50%",
		"-webkit-mask-composite": "add",
		"-webkit-mask-origin": "border-box",
		"-webkit-mask-clip": "border-box",
		...overrides,
	});
}

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

type FixtureOptions = Readonly<{
	ownerTag?: "h4" | "h5" | "a";
	pseudo?: Values;
	owner?: Values;
}>;

type Styles = Map<
	Element,
	Readonly<{ owner: CSSStyleDeclaration; pseudo: CSSStyleDeclaration }>
>;

function makeSource(options: FixtureOptions = {}): Readonly<{
	root: HTMLElement;
	source: HTMLElement;
	styles: Styles;
	set: (element: Element, owner: Values, pseudo: Values) => void;
}> {
	const root = document.createElement("article");
	const source = document.createElement(options.ownerTag ?? "h4");
	source.textContent = "Private proof";
	if ("A" === source.tagName) source.setAttribute("href", "/target?x=1");
	source.getBoundingClientRect = () => rect(335, 23);
	root.append(source);
	document.body.append(root);
	const styles: Styles = new Map();
	const set = (element: Element, owner: Values, pseudo: Values): void => {
		styles.set(element, {
			owner: declaration(owner),
			pseudo: declaration(pseudo),
		});
	};
	set(
		source,
		options.owner ?? ownerValues("a" === source.tagName ? "inline" : "block"),
		options.pseudo ?? circleValues(),
	);
	return { root, source, styles, set };
}

function input(source: HTMLElement) {
	return {
		source,
		readiness: {
			existing: { kind: "transition" as const, lease: { isReady: () => true } },
			sourceFreshness: { isCurrent: () => true },
		},
		capabilities: {
			css: {
				getComputedStyle: (
					element: Element,
					pseudo?: Pseudo,
				): CSSStyleDeclaration => {
					const styles = STYLE_MAP.get(element);
					if (!styles) throw new Error("missing computed style");
					return pseudo ? styles.pseudo : styles.owner;
				},
				supports: (property: string, _value: string) =>
					"-webkit-mask-mode" !== property,
			},
			animations: { inspectAnimations: () => [] },
		},
	};
}

let STYLE_MAP: Styles = new Map();

function registerGeneratedPseudoMarker(
	owner: Element,
	marker: HTMLSpanElement,
): void {
	GENERATED_PSEUDO_CLONE_OWNERS.set(marker, { owner, pseudo: "::before" });
}

function readFixture(options: FixtureOptions = {}) {
	const fixture = makeSource(options);
	STYLE_MAP = fixture.styles;
	const source = readWechatInlinePseudoPaint(input(fixture.source));
	return { ...fixture, source };
}

function rawCapture(item: HTMLElement) {
	const raw = captureWechatInlinePseudoPaintInput(
		item,
		input(item).capabilities.css,
	);
	if (!raw) throw new Error("raw capture missing");
	return raw;
}

function mixedSource() {
	const root = document.createElement("article");
	const circle = document.createElement("h4");
	circle.textContent = "Circle owner";
	circle.getBoundingClientRect = () => rect(335, 23);
	const link = document.createElement("a");
	link.href = "/target";
	link.textContent = "Link owner";
	link.getBoundingClientRect = () => rect(335, 23);
	root.append(circle, link);
	document.body.append(root);
	const styles: Styles = new Map([
		[
			root,
			{
				owner: declaration(ownerValues("block")),
				pseudo: declaration(circleValues({ content: "none" })),
			},
		],
		[
			circle,
			{
				owner: declaration(ownerValues("block")),
				pseudo: declaration(circleValues()),
			},
		],
		[
			link,
			{
				owner: declaration(ownerValues("inline")),
				pseudo: declaration(maskValues()),
			},
		],
	]);
	STYLE_MAP = styles;
	return { circle, link, root, styles };
}

describe("assembleWechatInlinePseudoPaintSource", () => {
	it("matches the root reader for mixed circle and mask evidence", () => {
		const { circle, link, root } = mixedSource();
		const reader = input(root);
		const rootRead = readWechatInlinePseudoPaint(reader);
		const assembled = assembleWechatInlinePseudoPaintSource(reader, [
			rawCapture(circle),
			rawCapture(link),
		]);

		expect(assembled.sourceKey).toBe(rootRead.sourceKey);
		expect(assembled.sourceKeyParts).toEqual(rootRead.sourceKeyParts);
		expect(assembled.evidence.map(({ source }) => source)).toEqual([
			circle,
			link,
		]);
		expect(assembled.evidence.map(({ paint }) => paint.kind)).toEqual([
			"circle",
			"mask",
		]);
		expect(Object.isFrozen(assembled)).toBe(true);
		expect(Object.isFrozen(assembled.evidence)).toBe(true);
		expect(assembled.evidence.every(Object.isFrozen)).toBe(true);
	});

	it("matches the root reader for zero captures with the same nonempty key shape", () => {
		const fixture = makeSource({
			pseudo: circleValues({ content: "none" }),
		});
		STYLE_MAP = fixture.styles;
		const reader = input(fixture.source);
		const rootRead = readWechatInlinePseudoPaint(reader);
		const assembled = assembleWechatInlinePseudoPaintSource(reader, []);

		expect(assembled.sourceKey).toBe(rootRead.sourceKey);
		expect(assembled.sourceKeyParts).toEqual(rootRead.sourceKeyParts);
		expect(assembled.sourceKeyParts).toEqual([
			"easymde-inline-pseudo-paint-source-v1",
			"http://www.w3.org/1999/xhtml",
			"h4",
			[],
		]);
		expect(assembled.evidence).toEqual([]);
	});

	it("fails without filtering when valid and unsafe captures are mixed", () => {
		const { circle, link, root } = mixedSource();
		const unsafe = {
			...rawCapture(circle),
			rawKey: "tampered",
		};

		expect(() =>
			assembleWechatInlinePseudoPaintSource(input(root), [
				rawCapture(link),
				unsafe,
			]),
		).toThrow(/wechat-inline-pseudo-paint-stale/u);
	});

	it("rejects captures outside the declared source", () => {
		const first = makeSource();
		const second = makeSource();
		document.body.append(first.root, second.root);
		STYLE_MAP = new Map([...first.styles, ...second.styles]);

		expect(() =>
			assembleWechatInlinePseudoPaintSource(input(first.root), [
				rawCapture(second.source),
			]),
		).toThrow(/wechat-inline-pseudo-paint-admission/u);
	});

	it("rejects a duplicate source owner", () => {
		const fixture = makeSource();
		STYLE_MAP = fixture.styles;
		const raw = rawCapture(fixture.source);

		expect(() =>
			assembleWechatInlinePseudoPaintSource(input(fixture.source), [raw, raw]),
		).toThrow(/wechat-inline-pseudo-paint-admission/u);
	});

	it("rejects captures outside canonical document order", () => {
		const root = document.createElement("article");
		const first = document.createElement("h4");
		const second = document.createElement("h5");
		first.textContent = "First owner";
		second.textContent = "Second owner";
		first.getBoundingClientRect = () => rect(335, 23);
		second.getBoundingClientRect = () => rect(335, 23);
		root.append(first, second);
		document.body.append(root);
		const styles: Styles = new Map([
			[
				first,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues()),
				},
			],
			[
				second,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues()),
				},
			],
		]);
		STYLE_MAP = styles;

		expect(() =>
			assembleWechatInlinePseudoPaintSource(input(root), [
				rawCapture(second),
				rawCapture(first),
			]),
		).toThrow(/wechat-inline-pseudo-paint-admission/u);
	});

	it("rejects a raw identity replaced with a valid foreign element key", () => {
		const fixture = makeSource();
		const foreign = document.createElement("h5");
		foreign.textContent = "Foreign owner";
		foreign.getBoundingClientRect = () => rect(335, 23);
		document.body.append(foreign);
		STYLE_MAP = new Map([
			...fixture.styles,
			[
				foreign,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues()),
				},
			],
		]);
		const foreignRaw = rawCapture(foreign);
		fixture.source.remove();

		expect(() =>
			assembleWechatInlinePseudoPaintSource(input(fixture.root), [
				{
					...foreignRaw,
					source: fixture.source,
				},
			]),
		).toThrow(/wechat-inline-pseudo-paint-stale/u);
	});

	it("accepts a capture for the declared source root", () => {
		const fixture = makeSource();
		STYLE_MAP = fixture.styles;
		const assembled = assembleWechatInlinePseudoPaintSource(
			input(fixture.source),
			[rawCapture(fixture.source)],
		);

		expect(assembled.evidence).toHaveLength(1);
		expect(assembled.evidence[0]?.source).toBe(fixture.source);
	});

	it("rejects tampered raw keys and source identity evidence", () => {
		const fixture = makeSource();
		STYLE_MAP = fixture.styles;
		const raw = rawCapture(fixture.source);
		const wrongIdentity = document.createElement("h5");
		wrongIdentity.textContent = fixture.source.textContent;
		wrongIdentity.getBoundingClientRect = () => rect(335, 23);
		document.body.append(wrongIdentity);
		const detached = rawCapture(fixture.source);
		fixture.source.remove();

		expect(() =>
			assembleWechatInlinePseudoPaintSource(input(fixture.source), [
				detached,
			]),
		).toThrow(/wechat-inline-pseudo-paint-stale/u);
		fixture.root.append(fixture.source);
		expect(() =>
			assembleWechatInlinePseudoPaintSource(input(fixture.source), [
				{ ...raw, rawKey: `${raw.rawKey} ` },
			]),
		).toThrow(/wechat-inline-pseudo-paint-stale/u);
		expect(() =>
			assembleWechatInlinePseudoPaintSource(input(fixture.source), [
				{ ...raw, source: wrongIdentity },
			]),
		).toThrow(/wechat-inline-pseudo-paint-stale/u);
	});

	it("checks existing freshness and readiness before returning zero evidence", () => {
		const fixture = makeSource({
			pseudo: circleValues({ content: "none" }),
		});
		STYLE_MAP = fixture.styles;
		const reader = input(fixture.source);

		expect(() =>
			assembleWechatInlinePseudoPaintSource(
				{
					...reader,
					readiness: {
						...reader.readiness,
						sourceFreshness: { isCurrent: () => false },
					},
				},
				[],
			),
		).toThrow(/wechat-inline-pseudo-paint-stale/u);
		expect(() =>
			assembleWechatInlinePseudoPaintSource(
				{
					...reader,
					readiness: {
						...reader.readiness,
						existing: {
							kind: "transition",
							lease: { isReady: () => false },
						},
					},
				},
				[],
			),
		).toThrow(/wechat-inline-pseudo-paint-animation/u);
	});

	it("performs no CSS reads or source traversal during assembly", () => {
		const fixture = makeSource();
		STYLE_MAP = fixture.styles;
		const raws = [rawCapture(fixture.source)];
		const getComputedStyle = vi.fn(() => {
			throw new Error("assembly CSS owner read");
		});
		const supports = vi.fn(() => {
			throw new Error("assembly CSS capability read");
		});
		const sourceQuery = vi.spyOn(fixture.source, "querySelectorAll");
		const treeWalker = vi.spyOn(fixture.source.ownerDocument, "createTreeWalker");
		const reader = input(fixture.source);
		const assembled = assembleWechatInlinePseudoPaintSource(
			{
				...reader,
				capabilities: {
					...reader.capabilities,
					css: { getComputedStyle, supports },
				},
			},
			raws,
		);

		expect(assembled.evidence).toHaveLength(1);
		expect(getComputedStyle).not.toHaveBeenCalled();
		expect(supports).not.toHaveBeenCalled();
		expect(sourceQuery).not.toHaveBeenCalled();
		expect(treeWalker).not.toHaveBeenCalled();
	});

	it("rejects source mutation caused by actual animation inspection", () => {
		const fixture = makeSource({
			pseudo: circleValues({
				"transition-duration": "0.2s",
				"transition-property": "color",
			}),
		});
		STYLE_MAP = fixture.styles;
		const raw = rawCapture(fixture.source);
		const before = fixture.root.innerHTML;
		const reader = input(fixture.root);
		reader.readiness.sourceFreshness.isCurrent = () =>
			fixture.root.innerHTML === before;
		const inspectAnimations = vi.fn(() => {
			fixture.source.append(
				fixture.source.ownerDocument.createTextNode(
					" changed during admission",
				),
			);
			return [];
		});
		reader.capabilities.animations.inspectAnimations = inspectAnimations;

		expect(() =>
			assembleWechatInlinePseudoPaintSource(reader, [raw]),
		).toThrow(/wechat-inline-pseudo-paint-stale/u);
		expect(inspectAnimations).toHaveBeenCalledTimes(1);
		expect(fixture.root.innerHTML).not.toBe(before);
	});

	it("rejects readiness loss caused by actual animation inspection", () => {
		const fixture = makeSource({
			pseudo: circleValues({
				"transition-duration": "0.2s",
				"transition-property": "color",
			}),
		});
		STYLE_MAP = fixture.styles;
		const raw = rawCapture(fixture.source);
		const reader = input(fixture.root);
		let ready = true;
		reader.readiness.existing.lease.isReady = () => ready;
		const inspectAnimations = vi.fn(() => {
			ready = false;
			return [];
		});
		reader.capabilities.animations.inspectAnimations = inspectAnimations;

		expect(() =>
			assembleWechatInlinePseudoPaintSource(reader, [raw]),
		).toThrow(/wechat-inline-pseudo-paint-animation/u);
		expect(inspectAnimations).toHaveBeenCalledTimes(1);
		expect(ready).toBe(false);
	});

	it("rechecks freshness after a zero-capture assembly completes", () => {
		const fixture = makeSource({
			pseudo: circleValues({ content: "none" }),
		});
		STYLE_MAP = fixture.styles;
		const reader = input(fixture.source);
		let freshnessChecks = 0;
		const isCurrent = vi.fn(() => {
			freshnessChecks += 1;
			return 1 === freshnessChecks;
		});
		reader.readiness.sourceFreshness.isCurrent = isCurrent;

		expect(() =>
			assembleWechatInlinePseudoPaintSource(reader, []),
		).toThrow(/wechat-inline-pseudo-paint-stale/u);
		expect(isCurrent).toHaveBeenCalledTimes(2);
	});

	it("rechecks lease readiness after a zero-capture assembly completes", () => {
		const fixture = makeSource({
			pseudo: circleValues({ content: "none" }),
		});
		STYLE_MAP = fixture.styles;
		const reader = input(fixture.source);
		let readinessChecks = 0;
		const isReady = vi.fn(() => {
			readinessChecks += 1;
			return 1 === readinessChecks;
		});
		reader.readiness.existing.lease.isReady = isReady;

		expect(() =>
			assembleWechatInlinePseudoPaintSource(reader, []),
		).toThrow(/wechat-inline-pseudo-paint-animation/u);
		expect(isReady).toHaveBeenCalledTimes(2);
	});
});

describe("wechat inline pseudo paint helper", () => {
	it("reads Source-only circle evidence and canonical keys without clone state", () => {
		const { source, root } = readFixture();
		expect(source.evidence).toHaveLength(1);
		expect(source.evidence[0]?.source).toBe(root.querySelector("h4"));
		expect(source.evidence[0]?.paint.kind).toBe("circle");
		expect(source.evidence[0]?.ownerStyle["font-family"]).toEqual({
			support: "supported",
			value: "Private Font",
		});
		expect(source.evidence[0]?.pseudoStyle["-webkit-mask-mode"]).toEqual({
			support: "unsupported",
			value: null,
		});
		expect(source.sourceKey).not.toContain("marker");
		expect(source.sourceKey).not.toContain("clone");
	});

	it("uses the required second argument for supports and rejects unreadable supported values", () => {
		const fixture = makeSource();
		STYLE_MAP = fixture.styles;
		const raw = input(fixture.source);
		const supportsCalls: Array<readonly [string, string]> = [];
		const query = {
			...raw,
			capabilities: {
				...raw.capabilities,
				css: {
					...raw.capabilities.css,
					supports: (property: string, value: string) => {
						supportsCalls.push([property, value]);
						return "-webkit-mask-mode" !== property;
					},
				},
			},
		};
		readWechatInlinePseudoPaint(query);
		expect(supportsCalls).toContainEqual(["mask-image", "initial"]);
		expect(supportsCalls).toContainEqual(["-webkit-mask-mode", "initial"]);
		STYLE_MAP.set(fixture.source, {
			owner: declaration(ownerValues("block")),
			pseudo: declaration(
				circleValues({ display: "inline-block", "border-top-width": "" }),
			),
		});
		expect(() => readWechatInlinePseudoPaint(query)).toThrow(/style/);
	});

	it("admits exactly the owned atomic paints in a mixed real-family root", () => {
		const root = document.createElement("article");
		root.innerHTML = [
			"<h4>Circle H4</h4>",
			"<h5>Circle H5</h5>",
			...Array.from(
				{ length: 6 },
				(_, index) => `<a href="/${index}">Link ${index}</a>`,
			),
			"<blockquote>Quote text</blockquote>",
			"<span>Inline text pseudo</span>",
			'<div class="neutral-rect">Neutral rectangle</div>',
			"<ol><li>List item</li></ol>",
			'<ul><li class="absolute-stroke">Absolute stroke</li></ul>',
			'<ul class="task-list"><li class="task-list-item">Task</li></ul>',
			"<pre><code>Code</code></pre>",
			'<span class="katex">Math</span>',
		].join("");
		document.body.append(root);
		const headings = Array.from(root.querySelectorAll("h4, h5"));
		const links = Array.from(root.querySelectorAll("a"));
		[...headings, ...links].forEach((owner) => {
			owner.getBoundingClientRect = () => rect(335, 23);
		});
		const styles: Styles = new Map([
			[
				root,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues({ content: "none" })),
				},
			],
		]);
		styles.set(headings[0] as HTMLElement, {
			owner: declaration(ownerValues("block")),
			pseudo: declaration(circleValues()),
		});
		styles.set(headings[1] as HTMLElement, {
			owner: declaration(ownerValues("block")),
			pseudo: declaration(
				circleValues({
					"box-sizing": "border-box",
					"border-width": "2px",
					"border-top-width": "2px",
					"border-right-width": "2px",
					"border-bottom-width": "2px",
					"border-left-width": "2px",
				}),
			),
		});
		links.forEach((link) => {
			styles.set(link, {
				owner: declaration(ownerValues("inline")),
				pseudo: declaration(maskValues()),
			});
		});
		const quote = root.querySelector("blockquote");
		if (!quote) throw new Error("quote missing");
		styles.set(quote, {
			owner: declaration(ownerValues("block")),
			pseudo: declaration(
				circleValues({ content: '"“"', display: "inline", position: "static" }),
			),
		});
		const inlineText = root.querySelector("span");
		if (!inlineText) throw new Error("inline text owner missing");
		styles.set(inlineText, {
			owner: declaration(ownerValues("inline")),
			pseudo: declaration(circleValues({ content: '"•"', display: "inline" })),
		});
		const neutralRect = root.querySelector(".neutral-rect");
		if (!neutralRect) throw new Error("neutral rectangle missing");
		styles.set(neutralRect, {
			owner: declaration(ownerValues("block")),
			pseudo: declaration(
				circleValues({
					width: "20px",
					height: "4px",
					"inline-size": "20px",
					"block-size": "4px",
					"border-width": "0px",
					"border-top-width": "0px",
					"border-right-width": "0px",
					"border-bottom-width": "0px",
					"border-left-width": "0px",
					"border-radius": "0px",
					"border-top-left-radius": "0px",
					"border-top-right-radius": "0px",
					"border-bottom-right-radius": "0px",
					"border-bottom-left-radius": "0px",
				}),
			),
		});
		const listItem = root.querySelector("li");
		if (!listItem) throw new Error("list item missing");
		styles.set(listItem, {
			owner: declaration(ownerValues("block", { display: "list-item" })),
			pseudo: declaration(
				circleValues({
					content: '""',
					display: "inline",
					position: "absolute",
				}),
			),
		});
		const absoluteStroke = root.querySelector(".absolute-stroke");
		if (!absoluteStroke) throw new Error("absolute stroke owner missing");
		styles.set(absoluteStroke, {
			owner: declaration(ownerValues("block", { display: "list-item" })),
			pseudo: declaration(
				circleValues({
					"background-color": "rgba(0, 0, 0, 0)",
					"border-width": "0px 0px 0px 0.5px",
					"border-top-width": "0px",
					"border-right-width": "0px",
					"border-bottom-width": "0px",
					"border-left-width": "0.5px",
					"border-top-style": "none",
					"border-right-style": "none",
					"border-bottom-style": "none",
					"border-left-style": "solid",
					position: "absolute",
				}),
			),
		});
		[".task-list", ".task-list-item", "pre", "code", ".katex"].forEach(
			(selector) => {
				root.querySelectorAll(selector).forEach((element) => {
					styles.set(element, {
						owner: declaration(ownerValues("block")),
						pseudo: declaration(
							circleValues({
								content: '""',
								display: "inline",
								position: "absolute",
							}),
						),
					});
				});
			},
		);
		root.querySelectorAll("*").forEach((element) => {
			if (!styles.has(element)) {
				styles.set(element, {
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues({ content: "none" })),
				});
			}
		});
		STYLE_MAP = styles;
		const before = root.innerHTML;
		const read = readWechatInlinePseudoPaint(input(root));
		expect(read.evidence.map(({ source }) => source.tagName)).toEqual([
			"H4",
			"H5",
			"A",
			"A",
			"A",
			"A",
			"A",
			"A",
		]);
		expect(root.innerHTML).toBe(before);
	});

	it.each([
		[
			"circle",
			{
				ownerTag: "h4" as const,
				pseudo: circleValues({ "border-right-width": "2px" }),
			},
		],
		[
			"mask",
			{
				ownerTag: "a" as const,
				owner: ownerValues("inline"),
				pseudo: maskValues({ "mask-size": "cover" }),
			},
		],
	])(
		"keeps an unsafe admitted %s family fatal beside untouched noncandidates",
		(_label, fixture) => {
			const root = document.createElement("article");
			const owner = document.createElement(fixture.ownerTag);
			owner.textContent = "Admitted owner";
			owner.getBoundingClientRect = () => rect(335, 23);
			const quote = document.createElement("blockquote");
			quote.textContent = "Quote";
			const list = document.createElement("ol");
			const listItem = document.createElement("li");
			listItem.textContent = "Item";
			list.append(listItem);
			const neutralRect = document.createElement("div");
			neutralRect.textContent = "Neutral rectangle";
			root.append(owner, quote, list, neutralRect);
			document.body.append(root);
			STYLE_MAP = new Map([
				[
					root,
					{
						owner: declaration(ownerValues("block")),
						pseudo: declaration(circleValues({ content: "none" })),
					},
				],
				[
					owner,
					{
						owner: declaration(
							fixture.ownerTag === "a"
								? ownerValues("inline")
								: ownerValues("block"),
						),
						pseudo: declaration(fixture.pseudo),
					},
				],
				[
					quote,
					{
						owner: declaration(ownerValues("block")),
						pseudo: declaration(
							circleValues({
								content: '"“"',
								display: "inline",
								position: "absolute",
							}),
						),
					},
				],
				[
					list,
					{
						owner: declaration(ownerValues("block")),
						pseudo: declaration(circleValues({ content: "none" })),
					},
				],
				[
					listItem,
					{
						owner: declaration(ownerValues("block", { display: "list-item" })),
						pseudo: declaration(
							circleValues({
								content: '""',
								display: "block",
								position: "absolute",
							}),
						),
					},
				],
				[
					neutralRect,
					{
						owner: declaration(ownerValues("block")),
						pseudo: declaration(
							circleValues({
								width: "20px",
								height: "4px",
								"inline-size": "20px",
								"block-size": "4px",
								"border-radius": "0px",
								"border-top-left-radius": "0px",
								"border-top-right-radius": "0px",
								"border-bottom-right-radius": "0px",
								"border-bottom-left-radius": "0px",
							}),
						),
					},
				],
			]);
			expect(() => readWechatInlinePseudoPaint(input(root))).toThrow(
				/wechat-inline-pseudo-paint-(?:admission|geometry|mask)/,
			);
		},
	);

	it("leaves a neutral rectangle unowned and keeps only positive circle evidence", () => {
		const rectangle = readFixture({
			pseudo: circleValues({
				width: "20px",
				height: "4px",
				"inline-size": "20px",
				"block-size": "4px",
				border: "0px none rgba(0, 0, 0, 0)",
				"border-width": "0px",
				"border-top-width": "0px",
				"border-right-width": "0px",
				"border-bottom-width": "0px",
				"border-left-width": "0px",
				"border-top-style": "none",
				"border-right-style": "none",
				"border-bottom-style": "none",
				"border-left-style": "none",
				"border-radius": "0px",
				"border-top-left-radius": "0px",
				"border-top-right-radius": "0px",
				"border-bottom-right-radius": "0px",
				"border-bottom-left-radius": "0px",
			}),
		});
		expect(rectangle.source.evidence).toHaveLength(0);
		expect(
			readFixture({ pseudo: circleValues() }).source.evidence,
		).toHaveLength(1);
	});

	it.each([
		[
			"nonzero mask radius",
			{
				ownerTag: "a" as const,
				owner: ownerValues("inline"),
				pseudo: maskValues({ "border-top-left-radius": "1px" }),
			},
		],
		[
			"mask outline",
			{
				ownerTag: "a" as const,
				owner: ownerValues("inline"),
				pseudo: maskValues({
					outline: "1px solid rgb(0, 0, 0)",
					"outline-width": "1px",
					"outline-style": "solid",
				}),
			},
		],
		[
			"circle outline",
			{
				ownerTag: "h4" as const,
				pseudo: circleValues({
					outline: "1px solid rgb(0, 0, 0)",
					"outline-width": "1px",
					"outline-style": "solid",
				}),
			},
		],
	])("rejects admitted %s", (_label, fixture) => {
		expect(() => readFixture(fixture)).toThrow(/admission|mask/);
	});

	it("retains circle and mask outlines whose style is none with readable nonnegative width", () => {
		expect(
			readFixture({
				pseudo: circleValues({
					outline: "3px none rgb(0, 0, 0)",
					"outline-width": "3px",
					"outline-style": "none",
				}),
			}).source.evidence[0]?.paint.kind,
		).toBe("circle");
		expect(
			readFixture({
				ownerTag: "a",
				owner: ownerValues("inline"),
				pseudo: maskValues({
					outline: "3px none rgb(0, 0, 0)",
					"outline-width": "3px",
					"outline-style": "none",
				}),
			}).source.evidence[0]?.paint.kind,
		).toBe("mask");
		expect(
			readFixture({
				pseudo: circleValues({
					outline: "none",
					"outline-width": "0px",
					"outline-style": "none",
				}),
			}).source.evidence[0]?.paint.kind,
		).toBe("circle");
		expect(
			readFixture({
				ownerTag: "a",
				owner: ownerValues("inline"),
				pseudo: maskValues({
					outline: "none",
					"outline-width": "0px",
					"outline-style": "none",
				}),
			}).source.evidence[0]?.paint.kind,
		).toBe("mask");
	});

	it.each([
		[
			"circle zero-width painting style",
			{
				outline: "0px solid rgb(0, 0, 0)",
				"outline-width": "0px",
				"outline-style": "solid",
			},
			undefined,
		],
		[
			"mask zero-width painting style",
			{
				outline: "0px solid rgb(0, 0, 0)",
				"outline-width": "0px",
				"outline-style": "solid",
			},
			"a" as const,
		],
		[
			"circle unreadable width",
			{ "outline-width": "medium", "outline-style": "none" },
			undefined,
		],
		[
			"mask unreadable width",
			{ "outline-width": "", "outline-style": "none" },
			"a" as const,
		],
		[
			"circle negative width",
			{ "outline-width": "-1px", "outline-style": "none" },
			undefined,
		],
		[
			"mask negative width",
			{ "outline-width": "-1px", "outline-style": "none" },
			"a" as const,
		],
		[
			"circle nonfinite width",
			{ "outline-width": "Infinitypx", "outline-style": "none" },
			undefined,
		],
		[
			"mask nonfinite width",
			{ "outline-width": "Infinitypx", "outline-style": "none" },
			"a" as const,
		],
	])("rejects %s", (_label, outline, ownerTag) => {
		const pseudo = {
			...outline,
			outline: `${outline["outline-width"]} ${outline["outline-style"]}`,
		};
		const fixture =
			"a" === ownerTag
				? { ownerTag, owner: ownerValues("inline"), pseudo: maskValues(pseudo) }
				: { pseudo: circleValues(pseudo) };
		expect(() => readFixture(fixture)).toThrow(/admission|style|geometry/);
	});

	it.each([
		["circle", undefined],
		["mask", "a" as const],
	])(
		"changes the Source key when a none-style outline width changes from 3px to 4px on the %s family",
		(kind, ownerTag) => {
			const read = (width: string) =>
				readFixture(
					"a" === ownerTag
						? {
								ownerTag,
								owner: ownerValues("inline"),
								pseudo: maskValues({
									outline: `${width} none rgb(0, 0, 0)`,
									"outline-width": width,
									"outline-style": "none",
								}),
							}
						: {
								pseudo: circleValues({
									outline: `${width} none rgb(0, 0, 0)`,
									"outline-width": width,
									"outline-style": "none",
								}),
							},
				);
			const first = read("3px");
			const second = read("4px");
			expect(first.source.evidence[0]?.paint.kind).toBe(kind);
			expect(second.source.evidence[0]?.paint.kind).toBe(kind);
			expect(second.source.evidence[0]?.paint).toEqual(
				first.source.evidence[0]?.paint,
			);
			expect(second.source.sourceKey).not.toBe(first.source.sourceKey);
		},
	);

	it.each([
		["width", "32", "16"],
		["height", "16", "32"],
	])(
		"rejects explicit SVG %s overriding a square viewBox",
		(attribute, width, height) => {
			const svg = MASK_SVG.replace(
				'<svg xmlns="http://www.w3.org/2000/svg"',
				`<svg ${attribute}="${"width" === attribute ? width : height}" xmlns="http://www.w3.org/2000/svg"`,
			);
			const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
			expect(() =>
				readFixture({
					ownerTag: "a",
					owner: ownerValues("inline"),
					pseudo: maskValues({ "mask-image": url, "-webkit-mask-image": url }),
				}),
			).toThrow(/mask/);
		},
	);

	it("checks freshness at both batch boundaries without probing motion", () => {
		const sourceRoot = document.createElement("article");
		const absent = document.createElement("p");
		absent.textContent = "Ordinary text";
		absent.getBoundingClientRect = () => rect(335, 23);
		sourceRoot.append(absent);
		document.body.append(sourceRoot);
		const styles: Styles = new Map([
			[
				sourceRoot,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues({ content: "none" })),
				},
			],
			[
				absent,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues({ content: "normal" })),
				},
			],
		]);
		STYLE_MAP = styles;
		let freshnessChecks = 0;
		let readinessChecks = 0;
		let animationChecks = 0;
		const query: Parameters<typeof readWechatInlinePseudoPaint>[0] = {
			source: sourceRoot,
			readiness: {
				existing: {
					kind: "transition" as const,
					lease: {
						isReady: () => {
							readinessChecks += 1;
							return true;
						},
					},
				},
				sourceFreshness: {
					isCurrent: () => {
						freshnessChecks += 1;
						return true;
					},
				},
			},
			capabilities: {
				...input(sourceRoot).capabilities,
				animations: {
					inspectAnimations: () => {
						animationChecks += 1;
						return [];
					},
				},
			},
		};
		expect(readWechatInlinePseudoPaint(query).evidence).toHaveLength(0);
		expect(freshnessChecks).toBe(2);
		expect(readinessChecks).toBe(2);
		expect(animationChecks).toBe(0);
	});

	it("derives exact content-box and border-box circle geometry from the actual evidence", () => {
		const contentBox = planWechatInlinePseudoPaint(
			readFixture({
				pseudo: circleValues(),
			}).source,
		);
		expect(contentBox.items[0]?.paint.attributes).toContainEqual([
			"width",
			"12",
		]);
		expect(contentBox.items[0]?.paint.attributes).toContainEqual([
			"height",
			"12",
		]);
		expect(contentBox.items[0]?.paint.attributes).toContainEqual([
			"viewBox",
			"0 0 12 12",
		]);
		expect(contentBox.items[0]?.paint.children[0]?.attributes).toEqual([
			["cx", "6"],
			["cy", "6"],
			["r", "5.5"],
			["fill", "rgb(52, 152, 219)"],
			["stroke", "rgb(52, 152, 219)"],
			["stroke-width", "1"],
		]);

		const borderBox = planWechatInlinePseudoPaint(
			readFixture({
				pseudo: circleValues({
					"box-sizing": "border-box",
					background: "rgb(255, 255, 255)",
					"background-color": "rgb(255, 255, 255)",
					border: "2px solid rgb(52, 152, 219)",
					"border-width": "2px",
					"border-top-width": "2px",
					"border-right-width": "2px",
					"border-bottom-width": "2px",
					"border-left-width": "2px",
					"border-top-color": "rgb(52, 152, 219)",
					"border-right-color": "rgb(52, 152, 219)",
					"border-bottom-color": "rgb(52, 152, 219)",
					"border-left-color": "rgb(52, 152, 219)",
				}),
			}).source,
		);
		expect(borderBox.items[0]?.paint.attributes).toContainEqual([
			"width",
			"10",
		]);
		expect(borderBox.items[0]?.paint.attributes).toContainEqual([
			"height",
			"10",
		]);
		expect(borderBox.items[0]?.paint.attributes).toContainEqual([
			"viewBox",
			"0 0 10 10",
		]);
		expect(borderBox.items[0]?.paint.children[0]?.attributes).toEqual([
			["cx", "5"],
			["cy", "5"],
			["r", "4"],
			["fill", "rgb(255, 255, 255)"],
			["stroke", "rgb(52, 152, 219)"],
			["stroke-width", "2"],
		]);
	});

	it("rejects malformed geometry and unsupported layout before planning", () => {
		expect(
			readFixture({ pseudo: circleValues({ width: "NaNpx" }) }).source.evidence,
		).toHaveLength(0);
		expect(
			readFixture({
				pseudo: circleValues({ "border-top-right-radius": "10%" }),
			}).source.evidence,
		).toHaveLength(0);
		expect(() =>
			readFixture({ pseudo: circleValues({ "border-right-width": "2px" }) }),
		).toThrow(/geometry/);
		expect(() =>
			readFixture({ pseudo: circleValues({ "padding-left": "1px" }) }),
		).toThrow(/geometry/);
		expect(
			readFixture({ owner: ownerValues("inline") }).source.evidence,
		).toHaveLength(0);
	});

	it.each([
		["rounded rectangle", "20px", "4px", "1px"],
		["rounded square", "20px", "20px", "1px"],
		["insufficient square radius", "20px", "20px", "9.99px"],
	])(
		"leaves %s unowned without circular commitment",
		(_label, width, height, radius) => {
			const result = readFixture({
				pseudo: circleValues({
					width,
					height,
					"inline-size": width,
					"block-size": height,
					"border-radius": radius,
					"border-top-left-radius": radius,
					"border-top-right-radius": radius,
					"border-bottom-right-radius": radius,
					"border-bottom-left-radius": radius,
				}),
			});
			expect(result.source.evidence).toHaveLength(0);
		},
	);

	it.each([
		["fifty percent", "50%"],
		["one hundred percent", "100%"],
	])("commits square CSS sizing with %s circular radii", (_label, radius) => {
		expect(
			readFixture({
				pseudo: circleValues({
					"border-radius": radius,
					"border-top-left-radius": radius,
					"border-top-right-radius": radius,
					"border-bottom-right-radius": radius,
					"border-bottom-left-radius": radius,
				}),
			}).source.evidence,
		).toHaveLength(1);
	});

	it("rejects a content-box pixel radius at half the CSS side after outer-box projection", () => {
		expect(() =>
			readFixture({
				pseudo: circleValues({
					"border-radius": "5px",
					"border-top-left-radius": "5px",
					"border-top-right-radius": "5px",
					"border-bottom-right-radius": "5px",
					"border-bottom-left-radius": "5px",
				}),
			}),
		).toThrow(/geometry/);
	});

	it.each([
		["border-box half outer side", "border-box", "5px"],
		["content-box full outer half", "content-box", "6px"],
		["uniform oversized pixel radius", "content-box", "20px"],
	])(
		"accepts %s resolved uniformly against the actual outer square",
		(_label, boxSizing, radius) => {
			expect(
				readFixture({
					pseudo: circleValues({
						"box-sizing": boxSizing,
						"border-radius": radius,
						"border-top-left-radius": radius,
						"border-top-right-radius": radius,
						"border-bottom-right-radius": radius,
						"border-bottom-left-radius": radius,
					}),
				}).source.evidence,
			).toHaveLength(1);
		},
	);

	it.each([
		["mixed percentage radii", ["50%", "100%", "50%", "50%"]],
		["unequal pixel radii", ["6px", "7px", "6px", "6px"]],
	])(
		"rejects %s after family commitment with explicit geometry failure",
		(_label, radii) => {
			expect(() =>
				readFixture({
					pseudo: circleValues({
						"border-radius": radii[0] ?? "",
						"border-top-left-radius": radii[0] ?? "",
						"border-top-right-radius": radii[1] ?? "",
						"border-bottom-right-radius": radii[2] ?? "",
						"border-bottom-left-radius": radii[3] ?? "",
					}),
				}),
			).toThrow(/wechat-inline-pseudo-paint-geometry$/u);
		},
	);

	it.each([
		["outside square edge", "M-4 -4H20V20H-4Z"],
		["outside line", "M2 2H20V14H2Z"],
		["outside curve", "M2 2 C -16 2 -16 14 -2 14 L2 14Z"],
		["outside arc", "M2 8 A 10 10 0 1 1 14 8 L14 14 L2 14Z"],
	])("rejects a parsed mask path %s", (_label, path) => {
		const svg = MASK_SVG.replace(PATH_DATA, path);
		const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
		expect(() =>
			readFixture({
				ownerTag: "a",
				owner: ownerValues("inline"),
				pseudo: maskValues({ "mask-image": url, "-webkit-mask-image": url }),
			}),
		).toThrow(/mask/);
	});

	it.each([
		["exact min edge", "M0 1H15V15H0Z"],
		["exact max edge", "M1 1H16V15H1Z"],
		["exact all edges", "M0 0H16V16H0Z"],
	])("accepts an accepted path touching %s", (_label, path) => {
		const svg = MASK_SVG.replace(PATH_DATA, path);
		const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
		const result = readFixture({
			ownerTag: "a",
			owner: ownerValues("inline"),
			pseudo: maskValues({ "mask-image": url, "-webkit-mask-image": url }),
		});
		expect(result.source.evidence[0]?.paint.kind).toBe("mask");
	});

	it.each([
		["left", "M-0.000001 1H15V15H0Z"],
		["top", "M1 -0.000001H15V15H1Z"],
		["right", "M1 1H16.000001V15H1Z"],
		["bottom", "M1 1H15V16.000001H1Z"],
	])(
		"rejects a finite path outside the %s boundary without epsilon",
		(_label, path) => {
			const svg = MASK_SVG.replace(PATH_DATA, path);
			const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
			expect(() =>
				readFixture({
					ownerTag: "a",
					owner: ownerValues("inline"),
					pseudo: maskValues({ "mask-image": url, "-webkit-mask-image": url }),
				}),
			).toThrow(/mask/);
		},
	);

	it("rejects nested path elements and accepts flat multiple-subpath boundary masks", () => {
		const nestedGroup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><g><path d="${PATH_DATA}" fill="#000000"/></g></svg>`;
		const nestedPath = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="${PATH_DATA}" fill="#000000"><path d="M2 2H14V14H2Z" fill="#000000"/></path></svg>`;
		for (const nested of [nestedGroup, nestedPath]) {
			const nestedUrl = `url("data:image/svg+xml;utf8,${encodeURIComponent(nested)}")`;
			expect(() =>
				readFixture({
					ownerTag: "a",
					owner: ownerValues("inline"),
					pseudo: maskValues({
						"mask-image": nestedUrl,
						"-webkit-mask-image": nestedUrl,
					}),
				}),
			).toThrow(/mask/);
		}
		const multiple = MASK_SVG.replace(PATH_DATA, "M0 1H7V15H0Z M9 1H16V15H9Z");
		const multipleUrl = `url("data:image/svg+xml;utf8,${encodeURIComponent(multiple)}")`;
		const result = readFixture({
			ownerTag: "a",
			owner: ownerValues("inline"),
			pseudo: maskValues({
				"mask-image": multipleUrl,
				"-webkit-mask-image": multipleUrl,
			}),
		});
		expect(result.source.evidence[0]?.paint.kind).toBe("mask");
	});

	it("admits a mask source without any Source SVG and validates alpha before recolor", () => {
		const read = readFixture({
			ownerTag: "a",
			owner: ownerValues("inline"),
			pseudo: maskValues(),
		});
		expect(read.source.evidence[0]?.link?.text).toBe("Private proof");
		expect(read.source.evidence[0]?.paint.kind).toBe("mask");
		const plan = planWechatInlinePseudoPaint(read.source);
		expect(plan.links).toHaveLength(1);
		expect(plan.items[0]?.paint.children[0]?.attributes).toContainEqual([
			"fill",
			"rgb(52, 152, 219)",
		]);
		expect(plan.items[0]?.paint.children.length).toBe(1);
		expect(readFixture({ pseudo: maskValues() }).source.evidence).toHaveLength(
			0,
		);
	});

	it.each([
		[
			"partial fill alpha",
			MASK_SVG.replace('fill="#000000"', 'fill-opacity="0.5" fill="#000000"'),
		],
		[
			"paint reference",
			MASK_SVG.replace('fill="#000000"', 'fill="url(#paint)"'),
		],
		[
			"stroke paint",
			MASK_SVG.replace('fill="#000000"', 'stroke="#000000" stroke-width="1"'),
		],
		[
			"partial hex alpha",
			MASK_SVG.replace('fill="#000000"', 'fill="#1122330f"'),
		],
	])("rejects %s masks", (_label, svg) => {
		const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
		expect(() =>
			readFixture({
				ownerTag: "a",
				owner: ownerValues("inline"),
				pseudo: maskValues({ "mask-image": url, "-webkit-mask-image": url }),
			}),
		).toThrow(/mask/);
	});

	it("treats opaque rgb and full hex alpha as valid mask silhouettes", () => {
		for (const fill of ["rgb(0, 0, 0)", "#112233ff"]) {
			const svg = MASK_SVG.replace('fill="#000000"', `fill="${fill}"`);
			const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
			expect(
				readFixture({
					ownerTag: "a",
					owner: ownerValues("inline"),
					pseudo: maskValues({ "mask-image": url, "-webkit-mask-image": url }),
				}).source.evidence[0]?.paint.kind,
			).toBe("mask");
		}
	});

	it("requires intrinsic ratio equality and rejects non-adjacent masks", () => {
		expect(() =>
			readFixture({
				ownerTag: "a",
				owner: ownerValues("inline"),
				pseudo: maskValues({ width: "20px" }),
			}),
		).toThrow(/mask/);
		const wide = MASK_SVG.replace('viewBox="0 0 16 16"', 'viewBox="0 0 20 16"');
		const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(wide)}")`;
		expect(() =>
			readFixture({
				ownerTag: "a",
				owner: ownerValues("inline"),
				pseudo: maskValues({ "mask-image": url, "-webkit-mask-image": url }),
			}),
		).toThrow(/mask/);
	});

	it("rejects unsupported visible candidates and fake animation proof", () => {
		expect(
			readFixture({ pseudo: circleValues({ display: "inline" }) }).source
				.evidence,
		).toHaveLength(0);
		const fixture = makeSource();
		STYLE_MAP = fixture.styles;
		const raw = input(fixture.source);
		const query = {
			...raw,
			capabilities: {
				...raw.capabilities,
				animations: {
					inspectAnimations: () => [
						{
							endTime: Number.NaN,
							kind: "css-transition" as const,
							pending: false,
							playState: "finished",
							transitionProperty: "all",
						},
					],
				},
			},
		};
		expect(() => readWechatInlinePseudoPaint(query)).toThrow(/animation/);
	});

	it("accepts only finished finite CSS transition inspection for settled owners", () => {
		const fixture = makeSource();
		STYLE_MAP = fixture.styles;
		const raw = input(fixture.source);
		let firstInspection = true;
		const query: Parameters<typeof readWechatInlinePseudoPaint>[0] = {
			...raw,
			capabilities: {
				...raw.capabilities,
				animations: {
					inspectAnimations: () => {
						if (firstInspection) {
							firstInspection = false;
							return [
								{
									endTime: 300,
									kind: "css-transition",
									pending: false,
									playState: "finished",
									transitionProperty: "all",
								},
							];
						}
						return [];
					},
				},
			},
		};
		expect(readWechatInlinePseudoPaint(query).evidence).toHaveLength(1);
		expect(() =>
			readWechatInlinePseudoPaint({
				...query,
				capabilities: {
					...query.capabilities,
					animations: {
						inspectAnimations: () => [
							{
								endTime: 300,
								kind: "css-animation",
								pending: false,
								playState: "finished",
								transitionProperty: null,
							},
						],
					},
				},
			}),
		).toThrow(/animation/);
	});

	it("captures zero geometry and rejects nonfinite geometry without readiness or parser work", () => {
		const fixture = makeSource();
		STYLE_MAP = fixture.styles;
		fixture.source.getBoundingClientRect = () => rect(0, 0);
		const animationChecks = 0;
		const readinessChecks = 0;
		const freshnessChecks = 0;
		const raw = captureWechatInlinePseudoPaintInput(
			fixture.source,
			input(fixture.source).capabilities.css,
		);
		expect(raw?.borderBox).toEqual({ height: 0, width: 0 });
		fixture.source.getBoundingClientRect = () => ({
			...rect(10, 10),
			width: Number.POSITIVE_INFINITY,
		});
		expect(() =>
			captureWechatInlinePseudoPaintInput(
				fixture.source,
				input(fixture.source).capabilities.css,
			),
		).toThrow(/geometry/);
		expect({ animationChecks, readinessChecks, freshnessChecks }).toEqual({
			animationChecks: 0,
			readinessChecks: 0,
			freshnessChecks: 0,
		});
	});

	it.each([
		["circle", undefined],
		["mask", "a" as const],
	])(
		"allows raw zero geometry but rejects ready %s admission",
		(_label, ownerTag) => {
			const fixture = makeSource(
				"a" === ownerTag
					? { ownerTag, owner: ownerValues("inline"), pseudo: maskValues() }
					: {},
			);
			STYLE_MAP = fixture.styles;
			fixture.source.getBoundingClientRect = () => rect(0, 0);
			const raw = captureWechatInlinePseudoPaintInput(
				fixture.source,
				input(fixture.source).capabilities.css,
			);
			if (!raw) throw new Error("raw capture missing");
			expect(raw.borderBox).toEqual({ height: 0, width: 0 });
			expect(() =>
				admitWechatInlinePseudoPaintInput(raw, input(fixture.source)),
			).toThrow(/geometry/);
		},
	);

	it("reads href only from the frozen attribute snapshot after capture", () => {
		const fixture = makeSource({
			ownerTag: "a",
			owner: ownerValues("inline"),
			pseudo: maskValues(),
		});
		STYLE_MAP = fixture.styles;
		const raw = captureWechatInlinePseudoPaintInput(
			fixture.source,
			input(fixture.source).capabilities.css,
		);
		if (!raw) throw new Error("raw capture missing");
		const hasAttribute = vi.spyOn(fixture.source, "hasAttribute");
		const getAttribute = vi.spyOn(fixture.source, "getAttribute");
		fixture.source.removeAttribute("href");
		const evidence = admitWechatInlinePseudoPaintInput(
			raw,
			input(fixture.source),
		);
		expect(evidence.link?.text).toBe("Private proof");
		expect(hasAttribute).not.toHaveBeenCalled();
		expect(getAttribute).not.toHaveBeenCalled();
	});

	it("exposes a recursively frozen raw key tuple without a second deep-freeze implementation", () => {
		const fixture = makeSource();
		STYLE_MAP = fixture.styles;
		const raw = captureWechatInlinePseudoPaintInput(
			fixture.source,
			input(fixture.source).capabilities.css,
		);
		if (!raw) throw new Error("raw capture missing");
		const expectRecursivelyFrozen = (value: unknown): void => {
			if (!Array.isArray(value)) return;
			expect(Object.isFrozen(value)).toBe(true);
			value.forEach(expectRecursivelyFrozen);
		};
		expectRecursivelyFrozen(raw.rawKeyParts);
		expect(() =>
			(raw.rawKeyParts as unknown as string[]).push("mutation"),
		).toThrow(TypeError);
	});

	it("freezes malformed mask syntax in raw capture and rejects it only during ready admission", () => {
		const fixture = makeSource({
			ownerTag: "a",
			owner: ownerValues("inline"),
			pseudo: maskValues({
				"mask-image": 'url("data:image/svg+xml,%3Csvg%3E")',
				"-webkit-mask-image": 'url("data:image/svg+xml,%3Csvg%3E")',
			}),
		});
		STYLE_MAP = fixture.styles;
		const raw = captureWechatInlinePseudoPaintInput(
			fixture.source,
			input(fixture.source).capabilities.css,
		);
		expect(raw?.family).toBe("mask");
		expect(raw?.rawKey).toContain("data:image/svg+xml");
		expect(() =>
			admitWechatInlinePseudoPaintInput(
				raw as NonNullable<typeof raw>,
				input(fixture.source),
			),
		).toThrow(/mask/);
	});

	it("derives ready evidence from one frozen raw tuple without rereading CSS or attributes", () => {
		const fixture = makeSource({
			ownerTag: "a",
			owner: ownerValues("inline"),
			pseudo: maskValues(),
		});
		STYLE_MAP = fixture.styles;
		const raw = captureWechatInlinePseudoPaintInput(
			fixture.source,
			input(fixture.source).capabilities.css,
		);
		if (!raw) throw new Error("raw capture missing");
		let cssReads = 0;
		const frozenInput = {
			...input(fixture.source),
			capabilities: {
				...input(fixture.source).capabilities,
				css: {
					getComputedStyle: () => {
						cssReads += 1;
						throw new Error("CSS reread");
					},
					supports: () => {
						cssReads += 1;
						throw new Error("CSS reread");
					},
				},
			},
		};
		fixture.source.textContent = "Changed source text";
		const evidence = admitWechatInlinePseudoPaintInput(raw, frozenInput);
		expect(evidence.sourceKey).toBe(raw.rawKey);
		expect(evidence.link?.text).toBe(raw.textContent.trim());
		expect(cssReads).toBe(0);
	});

	it("lets the next raw capture observe CSS changes while the frozen admission retains its key", () => {
		const fixture = makeSource();
		STYLE_MAP = fixture.styles;
		const before = captureWechatInlinePseudoPaintInput(
			fixture.source,
			input(fixture.source).capabilities.css,
		);
		if (!before) throw new Error("raw capture missing");
		STYLE_MAP.set(fixture.source, {
			owner: declaration(ownerValues("block")),
			pseudo: declaration(
				circleValues({
					"outline-width": "4px",
					outline: "4px none rgb(0, 0, 0)",
				}),
			),
		});
		const after = captureWechatInlinePseudoPaintInput(
			fixture.source,
			input(fixture.source).capabilities.css,
		);
		expect(after?.rawKey).not.toBe(before.rawKey);
		const evidence = admitWechatInlinePseudoPaintInput(
			before,
			input(fixture.source),
		);
		expect(evidence.sourceKey).toBe(before.rawKey);
	});

	it("plans purely and refuses Source rereads after the plan", () => {
		const read = readFixture();
		const plan = planWechatInlinePseudoPaint(read.source);
		expect(plan.sourceKey).toBe(read.source.sourceKey);
		expect(plan.items[0]?.paint).not.toBeInstanceOf(SVGElement);
		expect(plan.items[0]?.paint.attributes).toHaveLength(6);
	});

	it("changes the canonical key for path, paint, and owner admission inputs at equal geometry", () => {
		const baseline = readFixture({
			ownerTag: "a",
			owner: ownerValues("inline"),
			pseudo: maskValues(),
		});
		const changedPath = MASK_SVG.replace(PATH_DATA, "M2 2H14V14H2Z");
		const pathUrl = `url("data:image/svg+xml;utf8,${encodeURIComponent(changedPath)}")`;
		const changedColor = readFixture({
			ownerTag: "a",
			owner: ownerValues("inline"),
			pseudo: maskValues({ "background-color": "rgb(255, 0, 0)" }),
		});
		const pathMutations = readFixture({
			ownerTag: "a",
			owner: ownerValues("inline"),
			pseudo: maskValues({
				"mask-image": pathUrl,
				"-webkit-mask-image": pathUrl,
			}),
		});
		const admissionMutation = readFixture({
			ownerTag: "a",
			owner: ownerValues("inline", { "text-decoration": "underline" }),
			pseudo: maskValues(),
		});
		const readings = [baseline, changedColor, pathMutations, admissionMutation];
		readings.forEach((reading) => {
			expect(reading.source.evidence[0]?.borderBox.width).toBe(335);
			expect(reading.source.evidence[0]?.borderBox.height).toBe(23);
			expect(reading.source.evidence[0]?.paint.kind).toBe("mask");
		});
		expect(new Set(readings.map(({ source }) => source.sourceKey)).size).toBe(
			4,
		);
	});

	it("ignores scroll-only viewport coordinates while retaining consumed dimensions", () => {
		const fixture = makeSource();
		STYLE_MAP = fixture.styles;
		fixture.source.getBoundingClientRect = () => ({
			...rect(335, 23),
			x: 19,
			y: 41,
			top: 41,
			left: 19,
			right: 354,
			bottom: 64,
		});
		const shifted = readWechatInlinePseudoPaint(input(fixture.source));
		fixture.source.getBoundingClientRect = () => ({
			...rect(335, 23),
			x: -83,
			y: -117,
			top: -117,
			left: -83,
			right: 252,
			bottom: -94,
		});
		const scrolled = readWechatInlinePseudoPaint(input(fixture.source));
		expect(scrolled.sourceKey).toBe(shifted.sourceKey);
		expect(scrolled.evidence[0]?.borderBox).toEqual({ height: 23, width: 335 });
	});

	it("rejects tampered canonical keys without equivalence substitution", () => {
		const read = readFixture();
		const tampered = {
			...read.source,
			sourceKeyParts: read.source.sourceKeyParts
				.slice(0, -1)
				.concat([Number.NaN]),
		} as unknown as typeof read.source;
		expect(() => planWechatInlinePseudoPaint(tampered)).toThrow(/stale/);
	});

	it("rejects duplicate evidence and wrong or detached clone bindings", () => {
		const read = readFixture();
		const evidence = read.source.evidence[0];
		if (!evidence) throw new Error("source evidence missing");
		const duplicate = {
			...read.source,
			evidence: [evidence, evidence],
		} as unknown as typeof read.source;
		expect(() => planWechatInlinePseudoPaint(duplicate)).toThrow(/admission/);
		const plan = planWechatInlinePseudoPaint(read.source);
		const documentClone = document.implementation.createHTMLDocument("clone");
		const wrong = documentClone.createElement("h5");
		const wrongMarker = documentClone.createElement("span");
		wrongMarker.setAttribute("style", "display:inline-block");
		wrongMarker.textContent = " ";
		wrong.append(wrongMarker);
		expect(() =>
			bindWechatInlinePseudoPaint(
				read.source,
				plan,
				documentClone.documentElement,
				() => ({
					clone: wrong,
					generatedMarker: wrongMarker,
					parent: wrong,
				}),
			),
		).toThrow(/binding/);
		const detached = evidence.source.cloneNode(true) as HTMLElement;
		const detachedMarker = documentClone.createElement("span");
		detachedMarker.setAttribute("style", "display:inline-block");
		detachedMarker.textContent = " ";
		detached.append(detachedMarker);
		expect(() =>
			bindWechatInlinePseudoPaint(
				read.source,
				plan,
				documentClone.documentElement,
				() => ({
					clone: detached,
					generatedMarker: detachedMarker,
					parent: detached,
				}),
			),
		).toThrow(/binding/);
	});

	it("binds through real normalized DIV and BLOCKQUOTE replacements while ARTICLE keeps identity", () => {
		const sourceRoot = document.createElement("article");
		const definitions = [
			{ tag: "div" as const, text: "DIV owner" },
			{ tag: "blockquote" as const, text: "BLOCKQUOTE owner" },
			{ tag: "article" as const, text: "ARTICLE owner" },
		];
		const sources = definitions.map(({ tag, text }) => {
			const source = document.createElement(tag);
			source.textContent = text;
			source.getBoundingClientRect = () => rect(335, 23);
			sourceRoot.append(source);
			return source;
		});
		document.body.append(sourceRoot);
		STYLE_MAP = new Map([
			[
				sourceRoot,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues({ content: "none" })),
				},
			],
			...sources.map(
				(
					source,
				): [
					Element,
					Readonly<{ owner: CSSStyleDeclaration; pseudo: CSSStyleDeclaration }>,
				] => [
					source,
					{
						owner: declaration(ownerValues("block")),
						pseudo: declaration(circleValues()),
					},
				],
			),
		]);
		const read = readWechatInlinePseudoPaint(input(sourceRoot));
		expect(read.evidence).toHaveLength(3);
		const plan = planWechatInlinePseudoPaint(read);
		const cloneDocument = document.implementation.createHTMLDocument("clone");
		const cloneRoot = cloneDocument.importNode(sourceRoot, true) as HTMLElement;
		const originalOwners = Array.from(cloneRoot.children);
		originalOwners.forEach((owner) => {
			const marker = cloneDocument.createElement("span");
			marker.setAttribute("aria-hidden", "true");
			marker.setAttribute(
				"style",
				"display:inline-block;width:10px;height:10px",
			);
			marker.textContent = " ";
			owner.append(marker);
			registerGeneratedPseudoMarker(owner, marker);
		});
		const normalized = normalizeStructure(cloneRoot);
		const expectedFinalOwners = originalOwners.map(
			(owner) => WECHAT_STRUCTURE_REPLACEMENTS.get(owner) ?? owner,
		);
		expectedFinalOwners.forEach((finalOwner, index) => {
			const original = originalOwners[index];
			if (!original) throw new Error("original owner missing");
			if (original === finalOwner) {
				expect(WECHAT_STRUCTURE_REPLACEMENTS.get(original)).toBeUndefined();
			} else {
				expect(WECHAT_STRUCTURE_REPLACEMENTS.get(original)).toBe(finalOwner);
				expect(normalized.contains(finalOwner)).toBe(true);
			}
		});
		expect(originalOwners.map(({ localName }) => localName)).toEqual([
			"div",
			"blockquote",
			"article",
		]);
		expect(expectedFinalOwners.map(({ localName }) => localName)).toEqual([
			"section",
			"section",
			"article",
		]);
		const batch = bindWechatInlinePseudoPaint(
			read,
			plan,
			normalized,
			(evidence) => {
				const index = read.evidence.findIndex(
					({ source }) => source === evidence.source,
				);
				const original = originalOwners[index];
				const final = expectedFinalOwners[index];
				const marker = final?.querySelector("span") as HTMLSpanElement | null;
				if (!original || !final || !marker) {
					throw new Error("normalized clone binding missing");
				}
				return {
					clone: original,
					generatedMarker: marker,
					parent: final,
				};
			},
		);
		const finalSequences = expectedFinalOwners.map((owner) =>
			Array.from(owner.childNodes),
		);
		const invariants = applyWechatInlinePseudoPaintBatch(batch);
		expect(invariants).toHaveLength(3);
		invariants.forEach((invariant, index) => {
			expect(invariant.parent).toBe(expectedFinalOwners[index]);
			expect(invariant.installedSVG.parentElement).toBe(
				expectedFinalOwners[index],
			);
		});
		expectedFinalOwners.forEach((owner, index) => {
			expect(Array.from(owner.childNodes).length).toBe(
				finalSequences[index]?.length,
			);
		});
	});

	it.each([
		["unregistered owner", "unregistered"],
		["wrong registered owner", "wrong-owner"],
		["wrong pseudo", "wrong-pseudo"],
		["detached original owner", "detached"],
		["out-of-clone final parent", "out-of-root"],
		["replacement cycle", "cycle"],
		["replacement targets clone root", "root-target"],
	])("rejects a %s binding", (_label, scenario) => {
		const read = readFixture();
		const plan = planWechatInlinePseudoPaint(read.source);
		const cloneDocument = document.implementation.createHTMLDocument("clone");
		const cloneRoot = cloneDocument.createElement("article");
		const original = cloneDocument.createElement("h4");
		const marker = cloneDocument.createElement("span");
		marker.setAttribute("style", "display:inline-block;width:10px;height:10px");
		marker.textContent = " ";
		original.append(marker);
		cloneRoot.append(original);
		if ("unregistered" !== scenario)
			registerGeneratedPseudoMarker(original, marker);
		const clone = original;
		let parent: Element = original;
		if ("unregistered" === scenario) {
			// The marker intentionally has no generated-owner registry entry.
		} else if ("wrong-owner" === scenario) {
			GENERATED_PSEUDO_CLONE_OWNERS.set(marker, {
				owner: cloneRoot,
				pseudo: "::before",
			});
		} else if ("wrong-pseudo" === scenario) {
			GENERATED_PSEUDO_CLONE_OWNERS.set(marker, {
				owner: original,
				pseudo: "::after",
			});
		} else if ("detached" === scenario) {
			original.remove();
		} else if ("out-of-root" === scenario) {
			const outside = cloneDocument.createElement("section");
			outside.append(original);
			parent = outside;
		} else if ("cycle" === scenario) {
			const other = cloneDocument.createElement("h4");
			WECHAT_STRUCTURE_REPLACEMENTS.set(original, other);
			WECHAT_STRUCTURE_REPLACEMENTS.set(other, original);
			parent = other;
		} else {
			WECHAT_STRUCTURE_REPLACEMENTS.set(original, cloneRoot);
			parent = cloneRoot;
		}
		expect(() =>
			bindWechatInlinePseudoPaint(read.source, plan, cloneRoot, () => ({
				clone,
				generatedMarker: marker,
				parent,
			})),
		).toThrow(/binding/);
	});

	it("binds a detached normalized control then rejects that same tree after attachment", () => {
		const sourceRoot = document.createElement("article");
		const source = document.createElement("div");
		source.textContent = "Normalized control source";
		source.getBoundingClientRect = () => rect(335, 23);
		sourceRoot.append(source);
		document.body.append(sourceRoot);
		STYLE_MAP = new Map([
			[
				sourceRoot,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues({ content: "none" })),
				},
			],
			[
				source,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues()),
				},
			],
		]);
		const read = readWechatInlinePseudoPaint(input(source));
		const plan = planWechatInlinePseudoPaint(read);
		const cloneRoot = document.createElement("article");
		const original = document.createElement("div");
		original.textContent = "Normalized clone owner";
		cloneRoot.append(original);
		const marker = document.createElement("span");
		marker.setAttribute("style", "display:inline-block;width:10px;height:10px");
		marker.textContent = " ";
		original.append(marker);
		registerGeneratedPseudoMarker(original, marker);
		const normalized = normalizeStructure(cloneRoot);
		const finalOwner = WECHAT_STRUCTURE_REPLACEMENTS.get(original);
		if (!finalOwner) throw new Error("replacement owner missing");
		expect(normalized.isConnected).toBe(false);
		expect(finalOwner.isConnected).toBe(false);
		expect(original.isConnected).toBe(false);
		const markerFor = () => ({
			clone: original,
			generatedMarker: marker,
			parent: finalOwner,
		});
		const detachedControl = bindWechatInlinePseudoPaint(
			read,
			plan,
			normalized,
			markerFor,
		);
		expect(detachedControl.cloneRoot).toBe(normalized);
		document.body.append(normalized);
		expect(normalized.isConnected).toBe(true);
		expect(finalOwner.isConnected).toBe(true);
		expect(original.isConnected).toBe(false);
		expect(() =>
			bindWechatInlinePseudoPaint(read, plan, normalized, markerFor),
		).toThrow(/binding/);
		normalized.remove();
	});

	it("rechecks detached targets before any mutation when the clone becomes connected after bind", () => {
		const sourceRoot = document.createElement("article");
		const sources = Array.from({ length: 2 }, (_, sourceIndex) => {
			const source = document.createElement("h4");
			source.textContent = `Connected owner ${sourceIndex}`;
			source.getBoundingClientRect = () => rect(335, 23);
			sourceRoot.append(source);
			return source;
		});
		document.body.append(sourceRoot);
		STYLE_MAP = new Map([
			[
				sourceRoot,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues({ content: "none" })),
				},
			],
			...sources.map(
				(
					source,
				): [
					Element,
					Readonly<{ owner: CSSStyleDeclaration; pseudo: CSSStyleDeclaration }>,
				] => [
					source,
					{
						owner: declaration(ownerValues("block")),
						pseudo: declaration(circleValues()),
					},
				],
			),
		]);
		const read = readWechatInlinePseudoPaint(input(sourceRoot));
		const plan = planWechatInlinePseudoPaint(read);
		const boundary = document.createElement("article");
		const cloneOwners = sources.map(() => document.createElement("h4"));
		cloneOwners.forEach((owner) => {
			boundary.append(owner);
		});
		const markers = cloneOwners.map((owner) => {
			const marker = document.createElement("span");
			marker.setAttribute(
				"style",
				"display:inline-block;width:10px;height:10px",
			);
			marker.textContent = " ";
			owner.append(marker);
			registerGeneratedPseudoMarker(owner, marker);
			return marker;
		});
		let callbackIndex = 0;
		const batch = bindWechatInlinePseudoPaint(read, plan, boundary, () => {
			const owner = cloneOwners[callbackIndex];
			const marker = markers[callbackIndex];
			callbackIndex += 1;
			if (!owner || !marker) throw new Error("clone binding missing");
			return { clone: owner, generatedMarker: marker, parent: owner };
		});
		let replaceCalls = 0;
		cloneOwners.forEach((owner, index) => {
			owner.replaceChild = (() => {
				replaceCalls += 1;
				throw new Error("mutation-must-not-run");
			}) as typeof owner.replaceChild;
			const marker = markers[index];
			if (!marker) throw new Error("marker missing");
			marker.replaceChild = (() => {
				replaceCalls += 1;
				throw new Error("mutation-must-not-run");
			}) as typeof marker.replaceChild;
		});
		document.body.append(boundary);
		expect(boundary.isConnected).toBe(true);
		expect(() => applyWechatInlinePseudoPaintBatch(batch)).toThrow(/binding/);
		expect(replaceCalls).toBe(0);
		boundary.remove();
	});

	it.each([
		["original clone", "original"],
		["final owner", "final"],
	])(
		"rejects repeated %s identity after both callbacks are reached",
		(_label, repeated) => {
			const sourceRoot = document.createElement("article");
			const sources = Array.from({ length: 2 }, (_, sourceIndex) => {
				const source = document.createElement("h4");
				source.textContent = `Distinct Source ${sourceIndex}`;
				source.getBoundingClientRect = () => rect(335, 23);
				sourceRoot.append(source);
				return source;
			});
			document.body.append(sourceRoot);
			STYLE_MAP = new Map([
				[
					sourceRoot,
					{
						owner: declaration(ownerValues("block")),
						pseudo: declaration(circleValues({ content: "none" })),
					},
				],
				...sources.map(
					(
						source,
					): [
						Element,
						Readonly<{
							owner: CSSStyleDeclaration;
							pseudo: CSSStyleDeclaration;
						}>,
					] => [
						source,
						{
							owner: declaration(ownerValues("block")),
							pseudo: declaration(circleValues()),
						},
					],
				),
			]);
			const read = readWechatInlinePseudoPaint(input(sourceRoot));
			const plan = planWechatInlinePseudoPaint(read);
			const cloneDocument = document.implementation.createHTMLDocument("clone");
			const cloneRoot = cloneDocument.createElement("article");
			const createMarker = (owner: Element): HTMLSpanElement => {
				const marker = cloneDocument.createElement("span");
				marker.setAttribute(
					"style",
					"display:inline-block;width:10px;height:10px",
				);
				marker.textContent = " ";
				owner.append(marker);
				return marker;
			};
			let callbackCount = 0;
			if ("original" === repeated) {
				const sharedOriginal = cloneDocument.createElement("h4");
				cloneRoot.append(sharedOriginal);
				const firstMarker = createMarker(sharedOriginal);
				const secondMarker = createMarker(sharedOriginal);
				registerGeneratedPseudoMarker(sharedOriginal, firstMarker);
				registerGeneratedPseudoMarker(sharedOriginal, secondMarker);
				expect(() =>
					bindWechatInlinePseudoPaint(read, plan, cloneRoot, () => {
						callbackCount += 1;
						const marker = 1 === callbackCount ? firstMarker : secondMarker;
						return {
							clone: sharedOriginal,
							generatedMarker: marker,
							parent: sharedOriginal,
						};
					}),
				).toThrow(/binding/);
			} else {
				const firstOriginal = cloneDocument.createElement("h4");
				const secondOriginal = cloneDocument.createElement("h4");
				const sharedFinal = cloneDocument.createElement("h4");
				cloneRoot.append(sharedFinal);
				WECHAT_STRUCTURE_REPLACEMENTS.set(firstOriginal, sharedFinal);
				WECHAT_STRUCTURE_REPLACEMENTS.set(secondOriginal, sharedFinal);
				expect(firstOriginal.parentNode).toBeNull();
				expect(secondOriginal.parentNode).toBeNull();
				const firstMarker = createMarker(sharedFinal);
				const secondMarker = createMarker(sharedFinal);
				registerGeneratedPseudoMarker(firstOriginal, firstMarker);
				registerGeneratedPseudoMarker(secondOriginal, secondMarker);
				expect(() =>
					bindWechatInlinePseudoPaint(read, plan, cloneRoot, () => {
						callbackCount += 1;
						const original =
							1 === callbackCount ? firstOriginal : secondOriginal;
						const marker = 1 === callbackCount ? firstMarker : secondMarker;
						return {
							clone: original,
							generatedMarker: marker,
							parent: sharedFinal,
						};
					}),
				).toThrow(/binding/);
			}
			expect(callbackCount).toBe(2);
		},
	);

	it.each([
		["space", " "],
		["word joiner", "\u2060"],
	])(
		"rejects deletion of a %s carrier before mutating any owner",
		(_label, carrier) => {
			const read = readFixture();
			const plan = planWechatInlinePseudoPaint(read.source);
			const cloneDocument = document.implementation.createHTMLDocument("clone");
			const sourceEvidence = read.source.evidence[0];
			if (!sourceEvidence) throw new Error("source evidence missing");
			const boundary = cloneDocument.createElement("article");
			const owner = cloneDocument.importNode(
				sourceEvidence.source,
				true,
			) as HTMLElement;
			boundary.append(owner);
			const generatedMarker = cloneDocument.createElement("span");
			generatedMarker.setAttribute(
				"style",
				"display:inline-block;width:12px;height:12px",
			);
			generatedMarker.textContent = carrier;
			owner.append(generatedMarker);
			registerGeneratedPseudoMarker(owner, generatedMarker);
			const batch = bindWechatInlinePseudoPaint(
				read.source,
				plan,
				boundary,
				() => ({
					clone: owner,
					generatedMarker,
					parent: owner,
				}),
			);
			generatedMarker.replaceChildren();
			const before = Array.from(owner.childNodes);
			const attrs = Array.from(owner.attributes).map(({ name, value }) => [
				name,
				value,
			]);
			expect(() => applyWechatInlinePseudoPaintBatch(batch)).toThrow(/binding/);
			expect(Array.from(owner.childNodes)).toEqual(before);
			expect(
				Array.from(owner.attributes).map(({ name, value }) => [name, value]),
			).toEqual(attrs);
		},
	);

	it("returns one invariant for each of eight actual owners", () => {
		const sourceRoot = document.createElement("article");
		const sourceElements = Array.from({ length: 8 }, (_, index) => {
			const heading = document.createElement(index % 2 ? "h5" : "h4");
			heading.textContent = `Owner ${index}`;
			heading.getBoundingClientRect = () => rect(335, 23);
			sourceRoot.append(heading);
			return heading;
		});
		document.body.append(sourceRoot);
		const styles: Styles = new Map([
			[
				sourceRoot,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues({ content: "none" })),
				},
			],
			...sourceElements.map(
				(
					source,
				): [
					Element,
					Readonly<{ owner: CSSStyleDeclaration; pseudo: CSSStyleDeclaration }>,
				] => [
					source,
					{
						owner: declaration(ownerValues("block")),
						pseudo: declaration(circleValues()),
					},
				],
			),
		]);
		STYLE_MAP = styles;
		const read = readWechatInlinePseudoPaint(input(sourceRoot));
		expect(read.evidence).toHaveLength(8);
		const plan = planWechatInlinePseudoPaint(read);
		const cloneDocument = document.implementation.createHTMLDocument("clone");
		const cloneRoot = cloneDocument.importNode(sourceRoot, true);
		const cloneOwners = Array.from(cloneRoot.children);
		const batch = bindWechatInlinePseudoPaint(
			read,
			plan,
			cloneRoot,
			(evidence) => {
				const index = read.evidence.findIndex(
					({ source }) => source === evidence.source,
				);
				const owner = cloneOwners[index];
				if (!owner) throw new Error("clone owner missing");
				const generatedMarker = owner.ownerDocument.createElement("span");
				generatedMarker.setAttribute("aria-hidden", "true");
				generatedMarker.setAttribute(
					"style",
					"display:inline-block;width:10px;height:10px",
				);
				generatedMarker.textContent = " ";
				owner.append(generatedMarker);
				registerGeneratedPseudoMarker(owner, generatedMarker);
				return { clone: owner, generatedMarker, parent: owner };
			},
		);
		const invariants = applyWechatInlinePseudoPaintBatch(batch);
		expect(invariants).toHaveLength(8);
		expect(
			new Set(invariants.map(({ evidenceIndex }) => evidenceIndex)).size,
		).toBe(8);
		invariants.forEach((invariant) => {
			expect(invariant.installedSVG.parentElement).toBe(invariant.parent);
		});
	});

	it("moves link children exactly once and adds only the empty inner span bridge", () => {
		const read = readFixture({
			ownerTag: "a",
			owner: ownerValues("inline"),
			pseudo: maskValues(),
		});
		const plan = planWechatInlinePseudoPaint(read.source);
		const cloneDocument = document.implementation.createHTMLDocument("clone");
		const sourceEvidence = read.source.evidence[0];
		if (!sourceEvidence) throw new Error("source evidence missing");
		const sourceClone = cloneDocument.importNode(
			sourceEvidence.source,
			true,
		) as HTMLAnchorElement;
		cloneDocument.adoptNode(sourceClone);
		const marker = cloneDocument.createElement("span");
		marker.setAttribute("aria-hidden", "true");
		marker.setAttribute("style", "display:inline-block;width:16px;height:16px");
		marker.textContent = " ";
		sourceClone.replaceChildren(marker, "Private proof");
		registerGeneratedPseudoMarker(sourceClone, marker);
		sourceClone.setAttribute("href", "/target?x=1");
		sourceClone.setAttribute(
			"style",
			'font-family:"Quoted;Face";text-decoration:underline',
		);
		const anchor = sourceClone;
		const parent = cloneDocument.createElement("article");
		parent.append(anchor);
		const batch = bindWechatInlinePseudoPaint(
			read.source,
			plan,
			parent,
			(evidence) => {
				const clone = parent.firstElementChild as HTMLAnchorElement;
				const generatedMarker = clone.firstElementChild as HTMLSpanElement;
				expect(evidence.source).toBe(read.source.evidence[0]?.source);
				return { clone, generatedMarker, parent: clone };
			},
		);
		const childrenBefore = Array.from(anchor.childNodes);
		const invariants = applyWechatInlinePseudoPaintBatch(batch);
		const invariant = invariants[0];
		expect(invariant?.kind).toBe("link");
		if ("link" !== invariant?.kind) throw new Error("link invariant missing");
		const span = anchor.firstElementChild;
		expect(span).toBe(invariant.innerSpan);
		expect(span?.childNodes).toHaveLength(2);
		expect(invariant.expectedOriginalChildIdentities).toEqual(childrenBefore);
		expect(span?.childNodes[0]).toBe(invariant.installedSVG);
		expect(span?.childNodes[1]).toBe(childrenBefore[1]);
		expect(anchor.childNodes).toHaveLength(1);
		expect(anchor.textContent).toBe("Private proof");
		expect(anchor.getAttribute("href")).toBe("/target?x=1");
		expect((span as HTMLElement | null)?.style.fontFamily).toBe(
			'"Quoted;Face"',
		);
		expect(span?.getAttribute("style")).toContain('font-family:"Quoted;Face"');
		expect(anchor.getAttribute("style")).not.toContain("font-family");
		expect(anchor.getAttribute("style")).toContain("text-decoration:none");
	});

	it.each([
		["absent", null],
		["present empty", ""],
	])(
		"restores an %s original anchor style exactly after rollback",
		(_label, originalStyle) => {
			const read = readFixture({
				ownerTag: "a",
				owner: ownerValues("inline"),
				pseudo: maskValues(),
			});
			const plan = planWechatInlinePseudoPaint(read.source);
			const sourceEvidence = read.source.evidence[0];
			if (!sourceEvidence) throw new Error("source evidence missing");
			const anchor = sourceEvidence.source.cloneNode(true) as HTMLAnchorElement;
			const parent = document.createElement("article");
			anchor.setAttribute("href", "/target?x=1");
			if (null === originalStyle) anchor.removeAttribute("style");
			else anchor.setAttribute("style", originalStyle);
			const marker = document.createElement("span");
			marker.setAttribute("aria-hidden", "true");
			marker.setAttribute(
				"style",
				"display:inline-block;width:16px;height:16px",
			);
			marker.textContent = " ";
			anchor.replaceChildren(marker, "Private proof");
			registerGeneratedPseudoMarker(anchor, marker);
			parent.append(anchor);
			const batch = bindWechatInlinePseudoPaint(
				read.source,
				plan,
				parent,
				(evidence) => {
					expect(evidence.source).toBe(read.source.evidence[0]?.source);
					const generatedMarker = anchor.firstElementChild as HTMLSpanElement;
					return { clone: anchor, generatedMarker, parent: anchor };
				},
			);
			const attributesBefore = Array.from(anchor.attributes).map(
				({ name, value }) => [name, value],
			);
			const childrenBefore = Array.from(parent.childNodes);
			const originalReplaceChildren = anchor.replaceChildren.bind(anchor);
			let calls = 0;
			anchor.replaceChildren = (...nodes: (Node | string)[]): void => {
				calls += 1;
				if (2 === calls) throw new Error("exact-style-rollback");
				originalReplaceChildren(...nodes);
			};
			expect(() => applyWechatInlinePseudoPaintBatch(batch)).toThrow(
				"exact-style-rollback",
			);
			expect(Array.from(parent.childNodes)).toEqual(childrenBefore);
			expect(
				Array.from(anchor.attributes).map(({ name, value }) => [name, value]),
			).toEqual(attributesBefore);
			expect(anchor.hasAttribute("style")).toBe(null !== originalStyle);
			if (null !== originalStyle)
				expect(anchor.getAttribute("style")).toBe(originalStyle);
		},
	);

	it("rolls back all parents and exact anchor attributes after a post-SVG failure", () => {
		const read = readFixture({
			ownerTag: "a",
			owner: ownerValues("inline"),
			pseudo: maskValues(),
		});
		const plan = planWechatInlinePseudoPaint(read.source);
		const parent = document.createElement("article");
		const sourceEvidence = read.source.evidence[0];
		if (!sourceEvidence) throw new Error("source evidence missing");
		const anchor = sourceEvidence.source.cloneNode(true) as HTMLAnchorElement;
		anchor.removeAttribute("style");
		const marker = document.createElement("span");
		marker.setAttribute("aria-hidden", "true");
		marker.setAttribute("style", "display:inline-block;width:16px;height:16px");
		marker.textContent = " ";
		anchor.setAttribute("href", "/target?x=1");
		anchor.replaceChildren(marker, "Private proof");
		registerGeneratedPseudoMarker(anchor, marker);
		parent.append(anchor);
		const batch = bindWechatInlinePseudoPaint(
			read.source,
			plan,
			parent,
			(evidence) => {
				expect(evidence.source).toBe(read.source.evidence[0]?.source);
				const generatedMarker = anchor.firstElementChild as HTMLSpanElement;
				return { clone: anchor, generatedMarker, parent: anchor };
			},
		);
		const parentChildrenBefore = Array.from(parent.childNodes);
		const attributesBefore = Array.from(anchor.attributes).map(
			({ name, value }) => [name, value],
		);
		const originalReplaceChildren = anchor.replaceChildren.bind(anchor);
		const anchorChildrenAfterBind = Array.from(anchor.childNodes);
		let calls = 0;
		anchor.replaceChildren = (...nodes: (Node | string)[]): void => {
			calls += 1;
			if (1 === calls) throw new Error("post-svg-failure");
			originalReplaceChildren(...nodes);
		};
		expect(() => applyWechatInlinePseudoPaintBatch(batch)).toThrow(
			"post-svg-failure",
		);
		expect(Array.from(parent.childNodes)).toEqual(parentChildrenBefore);
		expect(Array.from(anchor.childNodes)).toEqual(anchorChildrenAfterBind);
		expect(
			Array.from(anchor.attributes).map(({ name, value }) => [name, value]),
		).toEqual(attributesBefore);
		expect(anchor.hasAttribute("style")).toBe(false);
	});

	it("restores exact finalized SECTION children after a later normalized owner fails", () => {
		const sourceRoot = document.createElement("article");
		const sources = ["div", "blockquote"].map((tag, index) => {
			const source = document.createElement(tag);
			source.textContent = `Finalized owner ${index}`;
			source.getBoundingClientRect = () => rect(335, 23);
			sourceRoot.append(source);
			return source;
		});
		document.body.append(sourceRoot);
		STYLE_MAP = new Map([
			[
				sourceRoot,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues({ content: "none" })),
				},
			],
			...sources.map(
				(
					source,
				): [
					Element,
					Readonly<{ owner: CSSStyleDeclaration; pseudo: CSSStyleDeclaration }>,
				] => [
					source,
					{
						owner: declaration(ownerValues("block")),
						pseudo: declaration(circleValues()),
					},
				],
			),
		]);
		const read = readWechatInlinePseudoPaint(input(sourceRoot));
		const plan = planWechatInlinePseudoPaint(read);
		const cloneDocument = document.implementation.createHTMLDocument("clone");
		const cloneRoot = cloneDocument.importNode(sourceRoot, true) as HTMLElement;
		const originalOwners = Array.from(cloneRoot.children);
		originalOwners.forEach((owner) => {
			const marker = cloneDocument.createElement("span");
			marker.setAttribute("aria-hidden", "true");
			marker.setAttribute(
				"style",
				"display:inline-block;width:10px;height:10px",
			);
			marker.textContent = " ";
			owner.append(marker);
			registerGeneratedPseudoMarker(owner, marker);
		});
		const normalized = normalizeStructure(cloneRoot);
		const finalOwners = originalOwners.map(
			(owner) => WECHAT_STRUCTURE_REPLACEMENTS.get(owner) ?? owner,
		);
		finalOwners.forEach((owner) => {
			expect(normalized.contains(owner)).toBe(true);
		});
		const batch = bindWechatInlinePseudoPaint(
			read,
			plan,
			normalized,
			(evidence) => {
				const index = read.evidence.findIndex(
					({ source }) => source === evidence.source,
				);
				const original = originalOwners[index];
				const final = finalOwners[index];
				const marker = final?.querySelector("span") as HTMLSpanElement | null;
				if (!original || !final || !marker)
					throw new Error("finalized clone binding missing");
				return { clone: original, generatedMarker: marker, parent: final };
			},
		);
		const childSequences = finalOwners.map((owner) =>
			Array.from(owner.childNodes),
		);
		const secondOwner = finalOwners[1];
		if (!secondOwner) throw new Error("second finalized owner missing");
		const originalReplaceChild = secondOwner.replaceChild.bind(secondOwner);
		let calls = 0;
		secondOwner.replaceChild = ((newChild: Node, oldChild: Node) => {
			calls += 1;
			const result = originalReplaceChild(newChild, oldChild);
			if (1 === calls) throw new Error("finalized-owner-failure");
			return result;
		}) as typeof secondOwner.replaceChild;
		expect(() => applyWechatInlinePseudoPaintBatch(batch)).toThrow(
			"finalized-owner-failure",
		);
		finalOwners.forEach((owner, index) => {
			const children = childSequences[index];
			expect(children).toBeDefined();
			expect(Array.from(owner.childNodes)).toEqual(children);
			expect(Array.from(owner.childNodes)).toHaveLength(children?.length ?? -1);
			children?.forEach((child, childIndex) => {
				expect(owner.childNodes[childIndex]).toBe(child);
			});
		});
	});

	it("restores every distinct parent when a later owner installs the SVG and then fails", () => {
		const sourceRoot = document.createElement("article");
		const owners = [document.createElement("h4"), document.createElement("h5")];
		owners.forEach((owner, index) => {
			owner.textContent = `Owner ${index}`;
			owner.getBoundingClientRect = () => rect(335, 23);
			sourceRoot.append(owner);
		});
		document.body.append(sourceRoot);
		STYLE_MAP = new Map([
			[
				sourceRoot,
				{
					owner: declaration(ownerValues("block")),
					pseudo: declaration(circleValues({ content: "none" })),
				},
			],
			...owners.map(
				(
					owner,
				): [
					Element,
					Readonly<{ owner: CSSStyleDeclaration; pseudo: CSSStyleDeclaration }>,
				] => [
					owner,
					{
						owner: declaration(ownerValues("block")),
						pseudo: declaration(circleValues()),
					},
				],
			),
		]);
		const read = readWechatInlinePseudoPaint(input(sourceRoot));
		const plan = planWechatInlinePseudoPaint(read);
		const cloneDocument = document.implementation.createHTMLDocument("clone");
		const cloneRoot = cloneDocument.importNode(sourceRoot, true) as HTMLElement;
		const cloneOwners = Array.from(cloneRoot.children);
		const batch = bindWechatInlinePseudoPaint(
			read,
			plan,
			cloneRoot,
			(evidence) => {
				const index = read.evidence.findIndex(
					({ source }) => source === evidence.source,
				);
				const owner = cloneOwners[index];
				if (!owner) throw new Error("clone owner missing");
				const generatedMarker = owner.ownerDocument.createElement("span");
				generatedMarker.setAttribute(
					"style",
					"display:inline-block;width:10px;height:10px",
				);
				generatedMarker.textContent = " ";
				owner.append(generatedMarker);
				registerGeneratedPseudoMarker(owner, generatedMarker);
				return { clone: owner, generatedMarker, parent: owner };
			},
		);
		const parentStates = cloneOwners.map((owner) =>
			Array.from(owner.childNodes),
		);
		const secondOwner = cloneOwners[1];
		if (!secondOwner) throw new Error("second clone owner missing");
		const originalReplaceChild = secondOwner.replaceChild.bind(secondOwner);
		let calls = 0;
		secondOwner.replaceChild = ((newChild: Node, oldChild: Node) => {
			calls += 1;
			const result = originalReplaceChild(newChild, oldChild);
			if (1 === calls) throw new Error("second-owner-failure");
			return result;
		}) as typeof secondOwner.replaceChild;
		expect(() => applyWechatInlinePseudoPaintBatch(batch)).toThrow(
			"second-owner-failure",
		);
		cloneOwners.forEach((owner, index) => {
			expect(Array.from(owner.childNodes)).toEqual(parentStates[index]);
		});
	});
});
