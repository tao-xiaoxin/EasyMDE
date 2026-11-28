import {
	describe,
	expect,
	it,
} from "vitest";

import {
	declaredStyleValue,
	installClipboardTestEnvironment,
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

import {
	cases,
	inBoxCases,
	gradient,
	geometryEpsilon,
	copyHeading,
	pixels,
} from "./wechat-heading-after-test-fixtures";

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

describe("WeChat heading-after Clipboard output and integrity", () => {
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
});
