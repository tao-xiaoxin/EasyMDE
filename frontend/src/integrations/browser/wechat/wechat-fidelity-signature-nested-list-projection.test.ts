// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
	createSerializationYield,
	type BrowserWechatClipboardRuntime,
} from "./wechat-clipboard-runtime";
import { createDimensionSemanticsContext } from "./wechat-dimension-semantics";
import {
	preparedDimensionGeometrySignature,
	preparedDimensionGeometrySignatureWithYield,
	preparedDimensionSemanticsSignature,
	preparedLayoutSignature,
	preparedLayoutSignatureWithYield,
} from "./wechat-fidelity-signature";
import { nestedOrdinaryListProjectionSignature } from "./wechat-nested-list-projection";

type Fixture = Readonly<{
	owner: HTMLElement;
	preview: HTMLElement;
	rectangles: Map<Element, DOMRect>;
}>;

function declaration(values: Readonly<Record<string, string>>): CSSStyleDeclaration {
	return {
		getPropertyValue: (property: string) => values[property] ?? "",
	} as CSSStyleDeclaration;
}

function rect(top: number, width: number, height: number, left = 20): DOMRect {
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

const commonStyle = {
	"border-bottom-width": "0px",
	"border-left-width": "0px",
	"border-right-width": "0px",
	"border-top-width": "0px",
	"break-after": "auto",
	"break-before": "auto",
	"break-inside": "auto",
	"clear": "none",
	"column-break-after": "auto",
	"column-break-before": "auto",
	"column-break-inside": "auto",
	"counter-increment": "none",
	"counter-reset": "none",
	"counter-set": "none",
	"float": "none",
	"height": "auto",
	"list-style-image": "none",
	"list-style-position": "outside",
	"list-style-type": "disc",
	"margin-bottom": "0px",
	"margin-top": "0px",
	"max-height": "none",
	"min-height": "0px",
	"padding-bottom": "0px",
	"padding-left": "0px",
	"padding-right": "0px",
	"padding-top": "0px",
	"position": "static",
	"transform": "none",
	"white-space": "normal",
	"writing-mode": "horizontal-tb",
} as const;

function createFixture(): Fixture {
	const preview = document.createElement("article");
	preview.innerHTML =
		'<ul><li><p>Parent</p><ul class="nested"><li><p>Child</p></li></ul></li></ul>';
	const owner = preview.querySelector(".nested")?.parentElement;
	if (!(owner instanceof HTMLElement))
		throw new Error("nested-list-fidelity-owner-missing");
	const rectangles = new Map<Element, DOMRect>();
	[preview, ...Array.from(preview.querySelectorAll("*"))].forEach((element) => {
		rectangles.set(element, rect(0, 200, 20));
		Object.defineProperty(element, "getBoundingClientRect", {
			configurable: true,
			value: () => rectangles.get(element),
		});
	});
	return { owner, preview, rectangles };
}

function createRuntime(fixture: Fixture): BrowserWechatClipboardRuntime {
	return {
		blob: Blob,
		clipboardItem: null,
		document,
		getComputedStyle: (element, pseudoElement) => {
			if (pseudoElement)
				return declaration({
					content: "none",
					display: "none",
				});
			const tag = element.tagName;
			if ("LI" === tag) {
				return declaration({
					...commonStyle,
					display: "list-item",
					position: element === fixture.owner ? "relative" : "static",
				});
			}
			if ("UL" === tag)
				return declaration({ ...commonStyle, display: "block" });
			return declaration({
				...commonStyle,
				display: "block",
				"list-style-image": "none",
				"list-style-position": "outside",
				"list-style-type": "none",
			});
		},
		getSelection: () => null,
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: vi.fn(),
		write: null,
	};
}

function setGeometry(fixture: Fixture, scrollTop: number, childOffset: number): void {
	const owner = fixture.owner;
	const parentList = owner.parentElement;
	const firstChild = owner.querySelector(":scope > p");
	const nestedList = owner.querySelector(":scope > ul");
	const nestedItem = nestedList?.querySelector(":scope > li");
	const nestedParagraph = nestedItem?.querySelector(":scope > p");
	if (
		!(parentList instanceof HTMLElement) ||
		!(firstChild instanceof HTMLElement) ||
		!(nestedList instanceof HTMLElement) ||
		!(nestedItem instanceof HTMLElement) ||
		!(nestedParagraph instanceof HTMLElement)
	)
		throw new Error("nested-list-fidelity-geometry-fixture-missing");
	fixture.rectangles.set(fixture.preview, rect(scrollTop, 400, 260, 0));
	fixture.rectangles.set(parentList, rect(20 + scrollTop, 200, 200));
	fixture.rectangles.set(
		owner,
		rect(100 + scrollTop, 200, 120),
	);
	fixture.rectangles.set(
		firstChild,
		rect(100.5 + scrollTop + childOffset, 200, 50),
	);
	fixture.rectangles.set(
		nestedList,
		rect(150.5 + scrollTop + childOffset, 200, 69.5),
	);
	fixture.rectangles.set(
		nestedItem,
		rect(150.5 + scrollTop + childOffset, 200, 40),
	);
	fixture.rectangles.set(
		nestedParagraph,
		rect(150.5 + scrollTop + childOffset, 200, 20),
	);
}

async function signatures(
	fixture: Fixture,
	runtime: BrowserWechatClipboardRuntime,
): Promise<readonly string[]> {
	const layoutYield = createSerializationYield(runtime, true);
	const geometryYield = createSerializationYield(runtime, true);
	if (!layoutYield || !geometryYield) throw new Error("yield-unavailable");
	const dimensionSemantics = createDimensionSemanticsContext(
		fixture.preview,
		fixture.preview,
		runtime,
	);
	try {
		dimensionSemantics.refresh();
		return [
			preparedLayoutSignature(
				fixture.preview,
				runtime,
				fixture.preview,
				dimensionSemantics,
			),
			await preparedLayoutSignatureWithYield(
				fixture.preview,
				runtime,
				layoutYield,
				undefined,
				fixture.preview,
				dimensionSemantics,
			),
			preparedDimensionGeometrySignature(
				fixture.preview,
				runtime,
				dimensionSemantics,
			),
			await preparedDimensionGeometrySignatureWithYield(
				fixture.preview,
				runtime,
				geometryYield,
				undefined,
				dimensionSemantics,
			),
			preparedDimensionSemanticsSignature(
				fixture.preview,
				runtime,
				dimensionSemantics,
			),
		];
	} finally {
		dimensionSemantics.cleanup();
	}
}

describe("nested ordinary list projection fidelity", () => {
	it("invalidates relative child-Y changes while ignoring uniform scroll translation", async () => {
		const fixture = createFixture();
		const runtime = createRuntime(fixture);
		setGeometry(fixture, 0, 0);
		const baseline = await signatures(fixture, runtime);
		const baselineDimensions = Array.from(fixture.rectangles.values()).map(
			({ width, height }) => [width, height],
		);
		expect(
			nestedOrdinaryListProjectionSignature(fixture.owner, runtime),
		).not.toBe("");

		setGeometry(fixture, 0, 20);
		expect(
			Array.from(fixture.rectangles.values()).map(({ width, height }) => [
				width,
				height,
			]),
		).toEqual(baselineDimensions);
		const relativeChange = await signatures(fixture, runtime);
		expect(relativeChange).not.toEqual(baseline);
		for (const index of baseline.keys()) {
			expect(relativeChange[index]).not.toBe(baseline[index]);
		}

		setGeometry(fixture, 40, 0);
		const uniformScroll = await signatures(fixture, runtime);
		expect(uniformScroll).toEqual(baseline);
	});
});
