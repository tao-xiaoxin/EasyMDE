import { describe, expect, it, vi } from "vitest";

import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import { declaration } from "./wechat-clipboard-test-fixtures";
import {
	createWechatTreePredicateCache,
	hasVisualRasterizationAncestor,
	isKaTeXVisualNode,
	isMermaidForeignObject,
	isMermaidSvgRoot,
	isSvgDefinition,
	isSvgElement,
	visualRasterizationKind,
} from "./wechat-clone-metadata";
import {
	createDimensionSemanticsContext,
	type WechatDimensionSemanticsContext,
} from "./wechat-dimension-semantics";
import { collectPreparedSignatures } from "./wechat-fidelity-signature";
import {
	styleDeclarations,
	styleDeclarationsSynchronously,
} from "./wechat-pseudo-elements";
import {
	appendPortableStyleDeclaration,
	buildPaddingCascadeIndex,
	createStyleDeclarationContext,
	hasSpecialLayoutAncestor,
	semanticPaddingSignature,
	semanticPaddingValue,
	supportsSpecialLayout,
} from "./wechat-style-policy";

function mockStyle(values: Record<string, string>): CSSStyleDeclaration {
	return declaration(values);
}

function mockRuntime(
	resolver: (
		element: Element,
		pseudoElement?: string | null,
	) => CSSStyleDeclaration,
): BrowserWechatClipboardRuntime {
	return {
		blob: Blob,
		clipboardItem: null,
		document,
		getComputedStyle: (element, pseudoElement) =>
			resolver(element, pseudoElement),
		getSelection: () => null,
		pageOffset: () => ({ x: 0, y: 0 }),
		scrollTo: () => undefined,
		write: null,
	};
}

function mockPaddingSemantics(
	left: string,
	right: string,
): WechatDimensionSemanticsContext {
	const raw = mockStyle({
		"--easymde-portable-padding-left": left,
		"--easymde-portable-padding-right": right,
		"padding-left": "48px",
		"padding-right": "20px",
		position: "static",
	});
	let generation = 1;
	return {
		cleanup: vi.fn(),
		getComputedStyle: () => raw,
		getFormattingOwnerDisplay: () => null,
		getRefreshGeneration: () => generation,
		getRootComputedStyle: () => raw,
		getSourceComputedStyle: () => raw,
		rasterizesVisualRoots: false,
		refresh: vi.fn(() => {
			generation += 1;
		}),
	};
}

function createNestedQuoteFixture(): Readonly<{
	cleanup: () => void;
	outer: HTMLElement;
	root: HTMLElement;
	secondSource: HTMLElement;
	source: HTMLElement;
	stylesheet: HTMLStyleElement;
}> {
	const stylesheet = document.createElement("style");
	stylesheet.textContent = `
		body { color: #111; font-size: 16px; }
		.unrelated-admin-rule { background: white; margin: 12px; }
		.easymde-rendered-content blockquote blockquote {
			--easymde-portable-padding-left: 9%;
			--easymde-portable-padding-right: 5%;
			padding-left: var(--easymde-portable-padding-left);
			padding-right: var(--easymde-portable-padding-right);
		}
	`;
	document.head.append(stylesheet);
	const root = document.createElement("article");
	root.className = "easymde-rendered-content";
	const outer = document.createElement("blockquote");
	const source = document.createElement("blockquote");
	const secondSource = document.createElement("blockquote");
	outer.append(source, secondSource);
	root.append(outer);
	document.body.append(root);
	return {
		cleanup: () => {
			root.remove();
			stylesheet.remove();
		},
		outer,
		root,
		secondSource,
		source,
		stylesheet,
	};
}

describe("compiled and cached padding cascade index", () => {
	it("indexes only padding-affecting rules and skips unrelated rules", () => {
		const fixture = createNestedQuoteFixture();
		try {
			const leftIndex = buildPaddingCascadeIndex(document, "padding-left");
			expect(leftIndex.unreadableStyleSheet).toBe(false);
			expect(leftIndex.entries).toHaveLength(1);
			expect(leftIndex.entries[0]?.isPortable).toBe(true);
			expect(leftIndex.entries[0]?.layeredPortable).toBe(false);
			expect(leftIndex.entries[0]?.important).toBe(false);
		} finally {
			fixture.cleanup();
		}
	});

	it("ignores color-only :scope rules but fails closed for uncertain padding", () => {
		const fixture = createNestedQuoteFixture();
		const style = document.createElement("style");
		document.head.append(style);
		try {
			style.textContent = ":scope .unrelated { color: red; }";
			expect(buildPaddingCascadeIndex(document, "padding-left").unreadableStyleSheet).toBe(false);
			style.textContent = ":scope .unrelated { padding-inline-start: 10px; }";
			expect(buildPaddingCascadeIndex(document, "padding-left").unreadableStyleSheet).toBe(true);
		} finally {
			style.remove();
			fixture.cleanup();
		}
	});

	it("respects @media and @supports conditions when building the cascade index", () => {
		const fixture = createNestedQuoteFixture();
		const conditional = document.createElement("style");
		conditional.textContent = `
			@media (max-width: 1px) {
				.easymde-rendered-content blockquote blockquote {
					padding-left: 12px !important;
				}
			}
			@supports (not (display: block)) {
				.easymde-rendered-content blockquote blockquote {
					padding-left: 14px !important;
				}
			}
		`;
		document.head.append(conditional);
		const originalMatchMedia = window.matchMedia;
		const originalCss = window.CSS;
		try {
			window.matchMedia = vi.fn((query: string) => ({
				matches: !query.includes("max-width: 1px"),
				media: query,
			})) as unknown as typeof window.matchMedia;
			Object.defineProperty(window, "CSS", {
				configurable: true,
				value: {
					supports: (condition: string) =>
						!condition.includes("not (display: block)"),
				},
			});

			const measured = mockStyle({
				"padding-left": "48px",
				position: "static",
			});
			const semantics = mockPaddingSemantics("9%", "5%");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBe("9%");

			// Flip matchMedia so the @media override matches and refresh semantics context
			window.matchMedia = vi.fn(() => ({
				matches: true,
				media: "",
			})) as unknown as typeof window.matchMedia;
			semantics.refresh();
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
		} finally {
			window.matchMedia = originalMatchMedia;
			Object.defineProperty(window, "CSS", {
				configurable: true,
				value: originalCss,
			});
			conditional.remove();
			fixture.cleanup();
		}
	});

	it("only fails closed on a layered portable rule when the element matches it", () => {
		const fixture = createNestedQuoteFixture();
		const layered = document.createElement("style");
		layered.textContent = `
			@layer theme {
				.only-layered-match {
					padding-left: var(--easymde-portable-padding-left);
				}
			}
		`;
		document.head.append(layered);
		try {
			const measured = mockStyle({
				"padding-left": "48px",
				position: "static",
			});
			const semantics = mockPaddingSemantics("9%", "5%");

			// Non-matching element still transports the unlayered portable rule
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBe("9%");

			// Matching element hits layeredPortable and fails closed
			fixture.secondSource.classList.add("only-layered-match");
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.secondSource,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.secondSource),
				),
			).toBeNull();
			expect(
				semanticPaddingSignature(
					fixture.secondSource,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.secondSource),
				),
			).toContain("reason=stylesheet-unreadable");
		} finally {
			layered.remove();
			fixture.cleanup();
		}
	});

	it("fails closed when Element.matches throws on a padding rule selector", () => {
		const fixture = createNestedQuoteFixture();
		const measured = mockStyle({
			"padding-left": "48px",
			position: "static",
		});
		const semantics = mockPaddingSemantics("9%", "5%");
		const matchesSpy = vi
			.spyOn(fixture.source, "matches")
			.mockImplementation(() => {
				throw new Error("unsupported-selector");
			});
		try {
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toBeNull();
			expect(
				semanticPaddingSignature(
					fixture.source,
					measured,
					semantics,
					semantics.getComputedStyle(fixture.source),
				),
			).toContain("reason=stylesheet-unreadable");
		} finally {
			matchesSpy.mockRestore();
			fixture.cleanup();
		}
	});

	it("caches the compiled index on real dimensionSemantics contexts and invalidates on refresh()", () => {
		const fixture = createNestedQuoteFixture();
		const raw = mockStyle({
			"--easymde-portable-padding-left": "9%",
			"--easymde-portable-padding-right": "5%",
			"padding-left": "48px",
			"padding-right": "20px",
			position: "static",
		});
		const measured = mockStyle({
			"padding-left": "48px",
			"padding-right": "20px",
			position: "static",
		});
		const dimensionSemantics = createDimensionSemanticsContext(
			fixture.root,
			fixture.root,
			mockRuntime(() => raw),
		);
		const sheet = fixture.stylesheet.sheet;
		if (!sheet) throw new Error("expected-stylesheet");
		const originalCssRulesDescriptor = Object.getOwnPropertyDescriptor(
			Object.getPrototypeOf(sheet),
			"cssRules",
		);
		let cssRulesReads = 0;
		Object.defineProperty(sheet, "cssRules", {
			configurable: true,
			get() {
				cssRulesReads += 1;
				return originalCssRulesDescriptor?.get?.call(this);
			},
		});
		try {
			// First evaluation for padding-left builds index once
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					dimensionSemantics,
					raw,
				),
			).toBe("9%");
			const readsAfterFirst = cssRulesReads;
			expect(readsAfterFirst).toBeGreaterThan(0);

			// Second evaluation on another element reuses cached index (0 additional reads)
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.secondSource,
					measured,
					dimensionSemantics,
					raw,
				),
			).toBe("9%");
			expect(cssRulesReads).toBe(readsAfterFirst);

			// Mutate existing sheet in-place via insertRule + call refresh()
			sheet.insertRule(
				".easymde-rendered-content blockquote blockquote { padding-left: 18px !important; }",
				sheet.cssRules.length,
			);
			const readsBeforeRefreshCall = cssRulesReads;
			dimensionSemantics.refresh();

			// After refresh(), cache is invalidated and rebuilt to see the new override
			expect(
				semanticPaddingValue(
					"padding-left",
					fixture.source,
					measured,
					dimensionSemantics,
					raw,
				),
			).toBeNull();
			expect(cssRulesReads).toBeGreaterThan(readsBeforeRefreshCall);
		} finally {
			delete (sheet as { cssRules?: CSSRuleList }).cssRules;
			dimensionSemantics.cleanup();
			fixture.cleanup();
		}
	});

	it("splits :is() arguments safely when attribute selectors contain commas", () => {
		const fixture = createNestedQuoteFixture();
		const attrOverride = document.createElement("style");
		attrOverride.textContent = `
			.easymde-rendered-content:is([data-tags=a,b], .extra) blockquote blockquote {
				padding-left: 18px;
			}
		`;
		document.head.append(attrOverride);
		try {
			const index = buildPaddingCascadeIndex(document, "padding-left");
			expect(index.unreadableStyleSheet).toBe(false);
			const overrideEntry = index.entries.find((entry) => !entry.isPortable);
			expect(overrideEntry).toBeDefined();
			// .easymde-rendered-content (0,1,0) + max([data-tags=a,b] -> 0,1,0, .extra -> 0,1,0) + blockquote blockquote (0,0,2) = [0, 2, 2]
			expect(overrideEntry?.selectors[0]?.specificity).toEqual([0, 2, 2]);
		} finally {
			attrOverride.remove();
			fixture.cleanup();
		}
	});
});

describe("tree predicate cache and isSvgElement fast path", () => {
	it("short-circuits SVG namespace elements while preserving foreignObject HTML detection", () => {
		const host = document.createElement("div");
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		const foreign = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"foreignObject",
		);
		const htmlInSvg = document.createElement("div");
		const spanInForeign = document.createElement("span");
		htmlInSvg.append(spanInForeign);
		foreign.append(htmlInSvg);
		group.append(path, foreign);
		svg.append(group);
		host.append(svg);

		// Detached foreignObject without <svg> ancestor
		const detachedForeign = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"foreignObject",
		);
		const detachedHtml = document.createElement("div");
		detachedForeign.append(detachedHtml);

		const parentSpy = vi.spyOn(path, "parentElement", "get");
		expect(isSvgElement(path)).toBe(true);
		expect(parentSpy).not.toHaveBeenCalled();
		parentSpy.mockRestore();

		expect(isSvgElement(svg)).toBe(true);
		expect(isSvgElement(group)).toBe(true);
		expect(isSvgElement(foreign)).toBe(true);
		expect(isSvgElement(htmlInSvg)).toBe(true);
		expect(isSvgElement(spanInForeign)).toBe(true);
		expect(isSvgElement(host)).toBe(false);
		expect(isSvgElement(detachedHtml)).toBe(false);
	});

	it("matches standalone predicates in both top-down and bottom-up order and memoizes querySelector", () => {
		const article = document.createElement("article");
		const mermaid = document.createElement("div");
		mermaid.className = "easymde-mermaid";
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
		const clip = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"clipPath",
		);
		const foreign = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"foreignObject",
		);
		const foreignLabel = document.createElement("span");
		defs.append(clip);
		foreign.append(foreignLabel);
		svg.append(defs, foreign);
		for (let i = 0; i < 20; i += 1) {
			svg.append(document.createElementNS("http://www.w3.org/2000/svg", "rect"));
		}
		mermaid.append(svg);

		const mathBlock = document.createElement("div");
		mathBlock.className = "easymde-math-block";
		const katex = document.createElement("span");
		katex.className = "katex";
		const katexHtml = document.createElement("span");
		katexHtml.className = "katex-html";
		const mathLeaf = document.createElement("span");
		const katexMathMl = document.createElement("span");
		katexMathMl.className = "katex-mathml";
		const mathEl = document.createElementNS(
			"http://www.w3.org/1998/Math/MathML",
			"math",
		);
		katexHtml.append(mathLeaf);
		katexMathMl.append(mathEl);
		katex.append(katexMathMl, katexHtml);
		mathBlock.append(katex);

		const paragraph = document.createElement("p");
		article.append(mermaid, mathBlock, paragraph);
		document.body.append(article);

		const allNodes = [article, ...Array.from(article.querySelectorAll("*"))];
		try {
			// Top-down pass
			const querySpy = vi.spyOn(Element.prototype, "querySelector");
			const topDown = createWechatTreePredicateCache();
			for (const node of allNodes) {
				expect(topDown.visualRasterizationKind(node)).toBe(
					visualRasterizationKind(node),
				);
				expect(topDown.hasVisualRasterizationAncestor(node)).toBe(
					hasVisualRasterizationAncestor(node),
				);
				expect(topDown.isSvgElement(node)).toBe(isSvgElement(node));
				expect(topDown.supportsSpecialLayout(node)).toBe(
					supportsSpecialLayout(node),
				);
				expect(topDown.hasSpecialLayoutAncestor(node)).toBe(
					hasSpecialLayoutAncestor(node),
				);
				expect(topDown.isKaTeXVisualNode(node)).toBe(isKaTeXVisualNode(node));
				expect(topDown.isSvgDefinition(node)).toBe(isSvgDefinition(node));
				expect(topDown.isMermaidSvgRoot(node)).toBe(isMermaidSvgRoot(node));
				expect(topDown.isMermaidForeignObject(node)).toBe(
					isMermaidForeignObject(node),
				);
			}
			querySpy.mockRestore();

			// Verify querySelector runs only once per candidate root with cache
			const cachedQuerySpy = vi.spyOn(Element.prototype, "querySelector");
			const cachedOnly = createWechatTreePredicateCache();
			for (const node of allNodes) {
				cachedOnly.visualRasterizationKind(node);
				cachedOnly.hasVisualRasterizationAncestor(node);
			}
			// Only 2 candidate roots (.easymde-mermaid -> 'svg', .easymde-math-block -> '.katex')
			expect(cachedQuerySpy).toHaveBeenCalledTimes(2);
			cachedQuerySpy.mockRestore();

			// Bottom-up pass matches standalone results identically
			const bottomUp = createWechatTreePredicateCache();
			for (const node of [...allNodes].reverse()) {
				expect(bottomUp.visualRasterizationKind(node)).toBe(
					visualRasterizationKind(node),
				);
				expect(bottomUp.hasVisualRasterizationAncestor(node)).toBe(
					hasVisualRasterizationAncestor(node),
				);
				expect(bottomUp.isSvgElement(node)).toBe(isSvgElement(node));
				expect(bottomUp.supportsSpecialLayout(node)).toBe(
					supportsSpecialLayout(node),
				);
				expect(bottomUp.hasSpecialLayoutAncestor(node)).toBe(
					hasSpecialLayoutAncestor(node),
				);
				expect(bottomUp.isKaTeXVisualNode(node)).toBe(isKaTeXVisualNode(node));
				expect(bottomUp.isSvgDefinition(node)).toBe(isSvgDefinition(node));
				expect(bottomUp.isMermaidSvgRoot(node)).toBe(isMermaidSvgRoot(node));
				expect(bottomUp.isMermaidForeignObject(node)).toBe(
					isMermaidForeignObject(node),
				);
			}
		} finally {
			article.remove();
		}
	});

	it("reflects dynamic DOM mutations between fresh passes without cross-pass staleness", () => {
		const root = document.createElement("div");
		const box = document.createElement("div");
		const child = document.createElement("span");
		box.append(child);
		root.append(box);
		document.body.append(root);
		const emptyStyle = mockStyle({ content: "none", display: "block" });
		const rt = mockRuntime(() => emptyStyle);
		try {
			const before = collectPreparedSignatures({
				preview: root,
				runtime: rt,
				conversionActive: true,
				includeDimension: false,
			}).layout;
			// Mutate box into a visual rasterization root containing KaTeX
			box.className = "easymde-math-block";
			const katex = document.createElement("span");
			katex.className = "katex";
			box.append(katex);
			const after = collectPreparedSignatures({
				preview: root,
				runtime: rt,
				conversionActive: true,
				includeDimension: false,
			}).layout;
			expect(after).not.toBe(before);

			const freshCache = createWechatTreePredicateCache();
			expect(freshCache.visualRasterizationKind(box)).toBe("math");
			expect(freshCache.hasVisualRasterizationAncestor(child)).toBe(true);
		} finally {
			root.remove();
		}
	});
});

describe("semanticCandidate guard and styleDeclarations flag reuse", () => {
	it("never queries semanticComputed.getPropertyValue for unrelated properties", async () => {
		const source = document.createElement("p");
		const measured = mockStyle({
			"background-color": "rgb(255, 255, 255)",
			"box-sizing": "border-box",
			color: "rgb(34, 34, 34)",
			display: "block",
			"font-size": "16px",
			height: "40px",
			"letter-spacing": "0.5px",
			"max-height": "none",
			"max-width": "100%",
			"min-height": "0px",
			"min-width": "0px",
			position: "static",
			"transform-origin": "320px 20px",
			width: "640px",
		});
		const queriedProperties: string[] = [];
		const rawValues: Record<string, string> = {
			"box-sizing": "border-box",
			display: "block",
			float: "none",
			height: "auto",
			"margin-bottom": "0px",
			"margin-left": "0px",
			"margin-right": "0px",
			"margin-top": "0px",
			"max-height": "none",
			"max-width": "100%",
			"min-height": "0px",
			"min-width": "0px",
			position: "static",
			"transform-origin": "50% 50%",
			width: "100%",
		};
		const semanticComputed = {
			getPropertyValue: (property: string): string => {
				queriedProperties.push(property);
				return rawValues[property] ?? "";
			},
		} as unknown as CSSStyleDeclaration;
		const semantics: WechatDimensionSemanticsContext = {
			cleanup: vi.fn(),
			getComputedStyle: () => semanticComputed,
			getFormattingOwnerDisplay: () => null,
			getRefreshGeneration: () => 1,
			getRootComputedStyle: () => semanticComputed,
			getSourceComputedStyle: () => measured,
			rasterizesVisualRoots: false,
			refresh: vi.fn(),
		};

		const context = createStyleDeclarationContext(
			source,
			measured,
			false,
			false,
			semantics,
		);
		queriedProperties.length = 0;

		const declarations: string[] = [];
		for (const property of [
			"color",
			"font-size",
			"background-color",
			"letter-spacing",
			"display",
			"border-radius",
		]) {
			const val = measured.getPropertyValue(property);
			appendPortableStyleDeclaration(context, property, val, val, declarations);
		}
		expect(queriedProperties).toEqual([]);

		// Verify dimension and transform-origin properties still read semanticComputed and preserve output
		for (const property of [
			"width",
			"min-width",
			"max-width",
			"height",
			"min-height",
			"max-height",
			"transform-origin",
		]) {
			const val = measured.getPropertyValue(property);
			appendPortableStyleDeclaration(context, property, val, val, declarations);
		}
		expect(queriedProperties).toEqual([
			"width",
			"min-width",
			"max-width",
			"height",
			"min-height",
			"max-height",
			"transform-origin",
		]);
		expect(declarations).toContain("width:100%");
		expect(declarations).toContain("transform-origin:50% 50%");

		// Full modern and legacy serialization match identically without querying unrelated properties
		queriedProperties.length = 0;
		const modern = await styleDeclarations(
			source,
			measured,
			false,
			false,
			mockRuntime(() => measured),
			new Map(),
			null,
			undefined,
			semantics,
		);
		const unrelatedQueried = queriedProperties.filter((prop) =>
			["color", "font-size", "background-color", "letter-spacing"].includes(
				prop,
			),
		);
		expect(unrelatedQueried).toEqual([]);

		const legacy = styleDeclarationsSynchronously(
			source,
			measured,
			false,
			false,
			mockRuntime(() => measured),
			semantics,
		);
		expect(legacy).toEqual(modern);
	});

	it("preserves raw box-sizing and dimensions when promoteContentBoxBounds is active", () => {
		const article = document.createElement("article");
		const box = document.createElement("div");
		article.append(box);
		document.body.append(article);
		try {
			const measured = mockStyle({
				"border-left-width": "2px",
				"border-right-width": "2px",
				"box-sizing": "content-box",
				display: "block",
				float: "none",
				height: "auto",
				"max-height": "none",
				"max-width": "none",
				"min-height": "0px",
				"min-width": "0px",
				"padding-left": "10px",
				"padding-right": "10px",
				position: "static",
				width: "320px",
			});
			const raw = mockStyle({
				"border-bottom-width": "0px",
				"border-left-width": "2px",
				"border-right-width": "2px",
				"border-top-width": "0px",
				"box-sizing": "content-box",
				display: "block",
				float: "none",
				height: "auto",
				"max-height": "none",
				"max-width": "80%",
				"min-height": "0px",
				"min-width": "0px",
				"padding-bottom": "0px",
				"padding-left": "10px",
				"padding-right": "10px",
				"padding-top": "0px",
				position: "static",
				width: "50%",
			});
			const semantics: WechatDimensionSemanticsContext = {
				cleanup: vi.fn(),
				getComputedStyle: () => raw,
				getFormattingOwnerDisplay: () => "block",
				getRefreshGeneration: () => 1,
				getRootComputedStyle: () => raw,
				getSourceComputedStyle: () => measured,
				rasterizesVisualRoots: false,
				refresh: vi.fn(),
			};
			const context = createStyleDeclarationContext(
				box,
				measured,
				false,
				false,
				semantics,
			);
			expect(context.promoteContentBoxBounds).toBe(true);
			const declarations: string[] = [];
			appendPortableStyleDeclaration(
				context,
				"box-sizing",
				"content-box",
				"content-box",
				declarations,
			);
			appendPortableStyleDeclaration(
				context,
				"width",
				"320px",
				"320px",
				declarations,
			);
			appendPortableStyleDeclaration(
				context,
				"max-width",
				"none",
				"none",
				declarations,
			);
			appendPortableStyleDeclaration(
				context,
				"max-height",
				"none",
				"none",
				declarations,
			);
			expect(declarations).toContain("box-sizing:content-box!important");
			expect(declarations).toContain("width:50%");
			expect(declarations).toContain("max-width:80%!important");
			expect(declarations).toContain("max-height:none");
		} finally {
			article.remove();
		}
	});
});
