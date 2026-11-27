import { describe, expect, it } from "vitest";

import {
	GENERATED_PSEUDO_CLONE_OWNERS,
	WECHAT_STRUCTURE_REPLACEMENTS,
} from "./wechat-clone-metadata";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import type { WechatPngConversionContext } from "./wechat-png-conversion-policy";
import {
	connectedPlainText,
	createMarkup,
	createMarkupSynchronously,
} from "./wechat-portable-serialization";
import {
	applyNestedOrdinaryListProjection,
	captureNestedOrdinaryListProjection,
	nestedOrdinaryListProjectionSignature,
	type WechatNestedListProjectionCapture,
} from "./wechat-nested-list-projection";

function declaration(
	values: Readonly<Record<string, string>>,
): CSSStyleDeclaration {
	const normalized = Object.fromEntries(
		Object.entries(values).map(([property, value]) => [
			property.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`),
			value,
		]),
	);
	return {
		getPropertyValue: (property: string) =>
			normalized[property.trim().toLowerCase()] ?? "",
	} as unknown as CSSStyleDeclaration;
}

const LIST_STYLE = {
	"counter-increment": "none",
	"counter-reset": "none",
	"counter-set": "none",
	display: "block",
	"list-style-image": "none",
	"list-style-position": "outside",
	"list-style-type": "disc",
	clear: "none",
	float: "none",
	transform: "none",
	"writing-mode": "horizontal-tb",
};

const ITEM_STYLE = {
	...LIST_STYLE,
	display: "list-item",
};

function rect(top: number, bottom: number, left = 20): DOMRect {
	return {
		bottom,
		height: bottom - top,
		left,
		right: left + 200,
		top,
		width: 200,
		x: left,
		y: top,
		toJSON: () => ({}),
	} as DOMRect;
}

function setRect(element: Element, value: DOMRect): void {
	Object.defineProperty(element, "getBoundingClientRect", {
		configurable: true,
		value: () => value,
	});
}

function captureRuntime(
	fixture: Readonly<{ sourceOwner: HTMLElement }>,
	options: Readonly<{
		childMarginBottom?: string;
		childMarginTop?: string;
		customList?: boolean;
		ownerHeight?: string;
		stemColor?: string;
		stem?: boolean;
	}> = {},
): BrowserWechatClipboardRuntime {
	return {
		blob: Blob,
		clipboardItem: null,
		document,
		getComputedStyle: (element: Element, pseudoElement?: string) => {
			if (pseudoElement) {
				if (
					options.stem &&
					element === fixture.sourceOwner &&
					"::before" === pseudoElement
				)
					return declaration({
						backgroundColor: "transparent",
						"background-image": "none",
						"border-bottom-style": "none",
						"border-bottom-width": "0px",
						"border-left-color": options.stemColor ?? "rgb(0, 0, 0)",
						"border-left-style": "solid",
						"border-left-width": "0.5px",
						"border-right-style": "none",
						"border-right-width": "0px",
						"border-top-style": "none",
						"border-top-width": "0px",
						"box-shadow": "none",
						bottom: "10px",
						content: '""',
						display: "block",
						filter: "none",
						float: "none",
						left: "-12.5px",
						"margin-bottom": "0px",
						"margin-left": "0px",
						"margin-top": "0px",
						mask: "none",
						"mix-blend-mode": "normal",
						opacity: "1",
						position: "absolute",
						top: "35px",
						transform: "none",
						visibility: "visible",
						writingMode: "horizontal-tb",
						"clip-path": "none",
						overflow: "visible",
					});
				return declaration({ content: "none", display: "none" });
			}
			if (element === fixture.sourceOwner)
				return declaration({
					...ITEM_STYLE,
					"border-left-width": "0px",
					"border-bottom-width": "0px",
					"border-top-width": "0px",
					"padding-bottom": "0px",
					"padding-left": "0px",
					"padding-top": "0px",
					clear: "none",
					height: options.ownerHeight ?? "auto",
					"margin-bottom": "0px",
					"margin-top": "0px",
					"max-height": "none",
					"min-height": "0px",
					padding: "0px",
					position: "relative",
					transform: "none",
					"white-space": "normal",
				});
			if ("UL" === element.tagName)
				return declaration({
					...LIST_STYLE,
					...(options.customList && element.classList.contains("custom")
						? { "list-style-image": "url(marker.png)" }
						: {}),
					height: "auto",
					"margin-bottom": options.childMarginBottom ?? "0px",
					"margin-top": options.childMarginTop ?? "0px",
					position: "static",
					"white-space": "normal",
				});
			if ("LI" === element.tagName)
				return declaration({
					...ITEM_STYLE,
					"border-bottom-width": "0px",
					"border-top-width": "0px",
					clear: "none",
					"margin-bottom": "0px",
					"margin-top": "0px",
					position: "static",
					transform: "none",
					"white-space": "normal",
				});
			return declaration({
				display: "block",
				clear: "none",
				float: "none",
				"margin-bottom": "0px",
				"margin-top": "0px",
				position: "static",
				transform: "none",
				"white-space": "normal",
				"writing-mode": "horizontal-tb",
			});
		},
		getSelection: () => window.getSelection(),
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: () => undefined,
		write: null,
	};
}

function pairedFixture(
	markup = '<ul><li><p>Parent</p><ul class="nested"><li><p>Child</p></li></ul></li></ul>',
): Readonly<{
	cloneRoot: HTMLElement;
	identity: Map<Element, Element>;
	sourceRoot: HTMLElement;
	sourceNested: HTMLElement;
	cloneNested: HTMLElement;
	sourceOwner: HTMLElement;
	cloneOwner: HTMLElement;
}> {
	const sourceRoot = document.createElement("article");
	sourceRoot.innerHTML = markup;
	const cloneRoot = sourceRoot.cloneNode(true) as HTMLElement;
	const sourceNested = sourceRoot.querySelector(".nested");
	const cloneNested = cloneRoot.querySelector(".nested");
	const sourceOwner = sourceNested?.parentElement;
	const cloneOwner = cloneNested?.parentElement;
	if (
		!(sourceNested instanceof HTMLElement) ||
		!(cloneNested instanceof HTMLElement) ||
		!(sourceOwner instanceof HTMLElement) ||
		!(cloneOwner instanceof HTMLElement)
	)
		throw new Error("nested-list-projection-test-fixture-missing");
	const identity = new Map<Element, Element>();
	const sourceElements = [
		sourceRoot,
		...Array.from(sourceRoot.querySelectorAll("*")),
	];
	const cloneElements = [
		cloneRoot,
		...Array.from(cloneRoot.querySelectorAll("*")),
	];
	sourceElements.forEach((source, index) => {
		const clone = cloneElements[index];
		if (!clone) throw new Error("nested-list-projection-test-identity-missing");
		identity.set(source, clone);
	});
	return {
		cloneRoot,
		identity,
		sourceRoot,
		sourceNested,
		cloneNested,
		sourceOwner,
		cloneOwner,
	};
}

function capture(
	fixture: ReturnType<typeof pairedFixture>,
	paint: WechatNestedListProjectionCapture["paint"] = null,
): WechatNestedListProjectionCapture {
	return {
		geometry: {
			firstChildTop: 0.5,
			lastChildBottom: 120,
			ownerRect: {
				bottom: 120,
				left: 20,
				top: 0,
			},
			wrapperOriginLeft: 20,
		},
		nestedLists: [fixture.sourceNested],
		owner: fixture.sourceOwner,
		paint,
		sourceKey: "test-source-key",
	};
}

function measureSourceFixture(
	fixture: ReturnType<typeof pairedFixture>,
	ownerTop = 100,
	ownerBottom = 220,
	lastChildBottom = ownerBottom,
): void {
	const firstChild = fixture.sourceOwner.querySelector(":scope > p");
	if (!(firstChild instanceof HTMLElement))
		throw new Error("nested-list-projection-test-first-child-missing");
	setRect(fixture.sourceOwner, rect(ownerTop, ownerBottom));
	setRect(firstChild, rect(ownerTop + 0.5, ownerTop + 50));
	setRect(fixture.sourceNested, rect(ownerTop + 50, lastChildBottom));
}

function pngConversionFor(preview: HTMLElement): WechatPngConversionContext {
	return {
		captureBoundary: preview,
		imageUploadPort: {} as never,
		maxBytes: 1_000_000,
		mermaidSnapshots: new Map(),
		postId: 1,
		rasterizationPort: {} as never,
		scale: 1,
		signal: new AbortController().signal,
		state: { uploadsMayRemain: false },
	};
}

describe("wechat nested list projection", () => {
	it("projects a tight ordinary nested list even when stem geometry is unavailable", () => {
		const fixture = pairedFixture(
			'<ul><li>Parent <p>Paragraph</p><ul class="nested"><li><p>Child</p></li></ul></li></ul>',
		);
		const sourceHtml = fixture.sourceRoot.innerHTML;
		const captureResult = captureNestedOrdinaryListProjection(
			fixture.sourceOwner,
			captureRuntime(fixture),
		);
		expect(captureResult).not.toBeNull();
		expect(captureResult?.geometry).toBeNull();
		expect(captureResult?.paint).toBeNull();

		applyNestedOrdinaryListProjection(
			fixture.cloneRoot,
			captureResult ? [captureResult] : [],
			fixture.identity,
		);
		expect(
			fixture.cloneOwner.querySelector(":scope > section[role=list]"),
		).toBeTruthy();
		expect(fixture.cloneRoot.querySelector(":scope > ul > li")).toBe(
			fixture.cloneOwner,
		);
		expect(fixture.sourceRoot.innerHTML).toBe(sourceHtml);
	});

	it("captures source-relative first/last edges and opaque black/red stem paint", () => {
		const fixture = pairedFixture();
		measureSourceFixture(fixture);
		const black = captureNestedOrdinaryListProjection(
			fixture.sourceOwner,
			captureRuntime(fixture, { stem: true, stemColor: "rgb(0, 0, 0)" }),
		);
		const red = captureNestedOrdinaryListProjection(
			fixture.sourceOwner,
			captureRuntime(fixture, { stem: true, stemColor: "rgb(255, 0, 0)" }),
		);
		const transparent = captureNestedOrdinaryListProjection(
			fixture.sourceOwner,
			captureRuntime(fixture, { stem: true, stemColor: "rgba(0, 0, 0, 0)" }),
		);
		expect(black?.geometry).toMatchObject({
			firstChildTop: 100.5,
			lastChildBottom: 220,
			ownerRect: { bottom: 220, left: 20, top: 100 },
			wrapperOriginLeft: 20,
		});
		expect(black?.paint).toMatchObject({
			bottom: 210,
			color: "rgb(0, 0, 0)",
			left: 7.5,
			top: 135,
			width: 0.5,
		});
		expect(red?.paint?.color).toBe("rgb(255, 0, 0)");
		expect(transparent?.geometry).not.toBeNull();
		expect(transparent?.paint).toBeNull();
	});

	it("keeps the projection signature scroll-invariant while changing on child-edge changes", () => {
		const fixture = pairedFixture();
		const runtime = captureRuntime(fixture, { stem: true });
		measureSourceFixture(fixture, 100, 220, 220);
		const first = nestedOrdinaryListProjectionSignature(
			fixture.sourceOwner,
			runtime,
		);
		measureSourceFixture(fixture, 150, 270, 270);
		const scrolled = nestedOrdinaryListProjectionSignature(
			fixture.sourceOwner,
			runtime,
		);
		measureSourceFixture(fixture, 150, 270, 269);
		const changed = nestedOrdinaryListProjectionSignature(
			fixture.sourceOwner,
			runtime,
		);
		expect(first).not.toBe("");
		expect(scrolled).toBe(first);
		expect(changed).not.toBe(first);

		const positiveMargins = captureNestedOrdinaryListProjection(
			fixture.sourceOwner,
			captureRuntime(fixture, {
				childMarginBottom: "2px",
				childMarginTop: "4px",
			}),
		);
		expect(positiveMargins?.geometry).not.toBeNull();
	});

	it("rejects ordered, task, custom-marker, negative-margin, empty-edge, and constrained-height cases", () => {
		const ordered = pairedFixture(
			'<ol><li><p>Parent</p><ul class="nested"><li><p>Child</p></li></ul></li></ol>',
		);
		expect(
			captureNestedOrdinaryListProjection(
				ordered.sourceOwner,
				captureRuntime(ordered),
			),
		).toBeNull();

		const task = pairedFixture(
			'<ul class="task-list"><li><p>Parent</p><ul class="nested"><li><p>Child</p></li></ul></li></ul>',
		);
		expect(
			captureNestedOrdinaryListProjection(
				task.sourceOwner,
				captureRuntime(task),
			),
		).toBeNull();

		const custom = pairedFixture(
			'<ul><li><p>Parent</p><ul class="nested custom"><li><p>Child</p></li></ul></li></ul>',
		);
		expect(
			captureNestedOrdinaryListProjection(
				custom.sourceOwner,
				captureRuntime(custom, { customList: true }),
			),
		).toBeNull();

		const negativeMargin = pairedFixture();
		measureSourceFixture(negativeMargin);
		expect(
			captureNestedOrdinaryListProjection(
				negativeMargin.sourceOwner,
				captureRuntime(negativeMargin, { childMarginTop: "-1px" }),
			),
		).toMatchObject({ geometry: null, paint: null });

		const emptyEdge = pairedFixture();
		measureSourceFixture(emptyEdge);
		const firstChild = emptyEdge.sourceOwner.querySelector(":scope > p");
		if (!(firstChild instanceof HTMLElement))
			throw new Error("nested-list-projection-test-first-child-missing");
		setRect(firstChild, rect(100, 100));
		expect(
			captureNestedOrdinaryListProjection(
				emptyEdge.sourceOwner,
				captureRuntime(emptyEdge),
			),
		).toMatchObject({ geometry: null, paint: null });

		const constrained = pairedFixture();
		measureSourceFixture(constrained);
		expect(
			captureNestedOrdinaryListProjection(
				constrained.sourceOwner,
				captureRuntime(constrained, { ownerHeight: "40px" }),
			),
		).toMatchObject({ geometry: null, paint: null });
	});

	it("keeps async/sync ordinary serialization and PNG conversion from rasterizing lists", async () => {
		const fixture = pairedFixture();
		Object.defineProperty(fixture.sourceRoot, "innerText", {
			configurable: true,
			value: "Parent\nChild",
		});
		const sourceHtml = fixture.sourceRoot.innerHTML;
		const runtime = captureRuntime(fixture);
		const asyncOff = await createMarkup(fixture.sourceRoot, runtime, new Map());
		const asyncOn = await createMarkup(
			fixture.sourceRoot,
			runtime,
			new Map(),
			null,
			pngConversionFor(fixture.sourceRoot),
		);
		const syncOff = createMarkupSynchronously(fixture.sourceRoot, runtime);
		if (!syncOff) throw new Error("nested-list-projection-test-sync-markup-missing");

		for (const clone of [asyncOff, asyncOn, syncOff]) {
			expect(clone.querySelector("section[role=list] > section[role=listitem]")).toBeTruthy();
			expect(clone.querySelectorAll("section[role=list]")).toHaveLength(1);
			expect(clone.querySelectorAll("img, canvas")).toHaveLength(0);
			expect(connectedPlainText(clone, fixture.sourceRoot)).toBe("Parent\nChild");
		}
		expect(fixture.sourceRoot.innerHTML).toBe(sourceHtml);
	});

	it("replaces maximal nested UL and LI structures while preserving identities", () => {
		const fixture = pairedFixture();
		const oldNested = fixture.cloneNested;
		const oldNestedItem = oldNested.querySelector("li");
		if (!(oldNestedItem instanceof HTMLElement))
			throw new Error("nested-list-projection-test-item-missing");
		const childParagraph = oldNestedItem.querySelector("p");
		if (!(childParagraph instanceof HTMLElement))
			throw new Error("nested-list-projection-test-child-missing");

		applyNestedOrdinaryListProjection(
			fixture.cloneRoot,
			[capture(fixture)],
			fixture.identity,
		);

		const projectedList = fixture.cloneOwner.querySelector(
			":scope > section[role=list]",
		);
		const projectedItem = projectedList?.querySelector(
			":scope > section[role=listitem]",
		);
		expect(projectedList).toBeInstanceOf(HTMLElement);
		expect(projectedItem).toBeInstanceOf(HTMLElement);
		expect(projectedItem?.querySelector(":scope > p")).toBe(childParagraph);
		expect(fixture.cloneRoot.querySelector(":scope > ul")).toBeTruthy();
		expect(fixture.cloneRoot.querySelector(":scope > ul > li")).toBe(
			fixture.cloneOwner,
		);
		expect(WECHAT_STRUCTURE_REPLACEMENTS.get(oldNested)).toBe(projectedList);
		expect(WECHAT_STRUCTURE_REPLACEMENTS.get(oldNestedItem)).toBe(
			projectedItem,
		);
	});

	it("wraps one admitted stem owner without changing the source structure", () => {
		const fixture = pairedFixture();
		const marker = document.createElement("span");
		marker.setAttribute("aria-hidden", "true");
		marker.textContent = " ";
		fixture.cloneOwner.insertBefore(marker, fixture.cloneOwner.firstChild);
		GENERATED_PSEUDO_CLONE_OWNERS.set(marker, {
			owner: fixture.cloneOwner,
			pseudo: "::before",
		});
		const originalParagraph = fixture.cloneOwner.querySelector(":scope > p");

		applyNestedOrdinaryListProjection(
			fixture.cloneRoot,
			[
				capture(fixture, {
					color: "rgb(52, 152, 219)",
					bottom: 110,
					left: 7.5,
					top: 35,
					width: 0.5,
				}),
			],
			fixture.identity,
		);

		const wrapper = Array.from(fixture.cloneOwner.children).find(
			(element) =>
				"SECTION" === element.tagName && !element.hasAttribute("role"),
		);
		expect(wrapper).toBeInstanceOf(HTMLElement);
		expect(marker.isConnected).toBe(false);
		expect(wrapper?.querySelector(":scope > p")).toBe(originalParagraph);
		expect(wrapper?.getAttribute("style")).toContain("margin-left:-12.5px");
		expect(wrapper?.getAttribute("style")).toContain("padding-left:12.5px");
		expect(wrapper?.getAttribute("style")).toContain(
			"background-size:0.5px 100%",
		);
		expect(wrapper?.getAttribute("style")).toContain(
			"background-position:0px -10px",
		);
		expect(wrapper?.getAttribute("style")).toContain(
			"linear-gradient(transparent 44.5px",
		);
	});

	it("rejects an unbound capture before mutating the detached tree", () => {
		const fixture = pairedFixture();
		const originalHtml = fixture.cloneRoot.innerHTML;
		const missingSource = document.createElement("ul");

		expect(() =>
			applyNestedOrdinaryListProjection(
				fixture.cloneRoot,
				[
					{
						...capture(fixture),
						nestedLists: [missingSource],
					},
				],
				fixture.identity,
			),
		).toThrow("wechat-nested-list-projection-clone-missing");
		expect(fixture.cloneRoot.innerHTML).toBe(originalHtml);
	});
});
