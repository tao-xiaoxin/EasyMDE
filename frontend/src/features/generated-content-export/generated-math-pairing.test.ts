import { describe, expect, it } from "vitest";

import { VISUAL_MARKDOWN_SOURCE_ATTRIBUTE } from "../../shared/markdown/normalize-math-tex";
import { createEditorMarkdownBlockIndex as createProfiledMarkdownBlockIndex } from "../editor-context-menu/editor-markdown-block-index";
import {
	createMathPairingContext,
	pairMathDomIndexToSpanIndex,
	pairMathSpanIndexToDomIndex,
} from "./generated-math-pairing";

function createEditorMarkdownBlockIndex(source: string) {
	return createProfiledMarkdownBlockIndex(source, {
		referenceLabelCaseFoldProfile: 14,
	});
}

function createMathElement(
	domSource: string | null,
	displayMode: boolean,
): HTMLElement {
	const element = document.createElement(displayMode ? "div" : "span");
	element.className = displayMode
		? "easymde-math easymde-math-block"
		: "easymde-math easymde-math-inline";
	if (null !== domSource) {
		element.setAttribute(VISUAL_MARKDOWN_SOURCE_ATTRIBUTE, domSource);
	}
	return element;
}

describe("generated-math-pairing strictly O(D + S) bidirectional math pairing (R35A #1/#2, R35B #1)", () => {
	it("pairs equal-cardinality duplicate classes and rejects ambiguous or non-complete classes symmetrically", () => {
		// 1. [note](/url "year $199$") then $x$ and $x$ (WP 6.7: 2 DOM roots vs 3 spans).
		{
			const source = '[note](/url "year $199$") then $x$ and $x$';
			const index = createEditorMarkdownBlockIndex(source);
			expect(index.mathSpans).toHaveLength(3);
			const roots = [
				createMathElement("\\(x\\)", false),
				createMathElement("\\(x\\)", false),
			];
			const ctx = createMathPairingContext(source, roots, index.mathSpans);
			expect(ctx).not.toBeNull();
			expect(ctx?.pairDomIndexToSpanIndex(0)).toBe(1);
			expect(ctx?.pairDomIndexToSpanIndex(1)).toBe(2);
			expect(ctx?.pairSpanIndexToDomIndex(0)).toBeNull();
			expect(ctx?.pairSpanIndexToDomIndex(1)).toBe(0);
			expect(ctx?.pairSpanIndexToDomIndex(2)).toBe(1);
		}

		// 2. Before $x$ and [note](/url "year $199$") and $x$ (WP 6.7: 2 DOM roots vs 3 spans).
		{
			const source = 'Before $x$ and [note](/url "year $199$") and $x$';
			const index = createEditorMarkdownBlockIndex(source);
			expect(index.mathSpans).toHaveLength(3);
			const roots = [
				createMathElement("\\(x\\)", false),
				createMathElement("\\(x\\)", false),
			];
			expect(
				pairMathDomIndexToSpanIndex(source, roots, index.mathSpans, 0),
			).toBe(0);
			expect(
				pairMathDomIndexToSpanIndex(source, roots, index.mathSpans, 1),
			).toBe(2);
			expect(
				pairMathSpanIndexToDomIndex(source, roots, index.mathSpans, 0),
			).toBe(0);
			expect(
				pairMathSpanIndexToDomIndex(source, roots, index.mathSpans, 1),
			).toBeNull();
			expect(
				pairMathSpanIndexToDomIndex(source, roots, index.mathSpans, 2),
			).toBe(1);
		}

		// 3. [note](/url "cost $x$") and same $x$ (WP 6.7: 1 DOM root vs 2 matching spans -> rejected).
		{
			const source = '[note](/url "cost $x$") and same $x$';
			const index = createEditorMarkdownBlockIndex(source);
			expect(index.mathSpans).toHaveLength(2);
			const roots = [createMathElement("\\(x\\)", false)];
			expect(
				pairMathDomIndexToSpanIndex(source, roots, index.mathSpans, 0),
			).toBeNull();
			expect(
				pairMathSpanIndexToDomIndex(source, roots, index.mathSpans, 0),
			).toBeNull();
			expect(
				pairMathSpanIndexToDomIndex(source, roots, index.mathSpans, 1),
			).toBeNull();
		}

		// 4. Non-complete bipartite component ($x$ accepts both "$x$" and "\(x\)", while \(x\) accepts only "\(x\)") -> rejected.
		{
			const source = '[note](/url "year $199$") $x$ \\(x\\)';
			const index = createEditorMarkdownBlockIndex(source);
			expect(index.mathSpans).toHaveLength(3);
			const roots = [
				createMathElement("$x$", false),
				createMathElement("\\(x\\)", false),
			];
			expect(
				pairMathDomIndexToSpanIndex(source, roots, index.mathSpans, 0),
			).toBeNull();
			expect(
				pairMathDomIndexToSpanIndex(source, roots, index.mathSpans, 1),
			).toBeNull();
			expect(
				pairMathSpanIndexToDomIndex(source, roots, index.mathSpans, 1),
			).toBeNull();
			expect(
				pairMathSpanIndexToDomIndex(source, roots, index.mathSpans, 2),
			).toBeNull();
		}

		// 5. Stripped-only block (0 DOM roots < 1 span) and excess DOM roots (> spans) fail closed.
		{
			const source = '[note](/url "year $199$")';
			const index = createEditorMarkdownBlockIndex(source);
			expect(index.mathSpans).toHaveLength(1);
			expect(
				pairMathSpanIndexToDomIndex(source, [], index.mathSpans, 0),
			).toBeNull();
			const twoRoots = [
				createMathElement("\\(199\\)", false),
				createMathElement("\\(199\\)", false),
			];
			expect(
				pairMathDomIndexToSpanIndex(source, twoRoots, index.mathSpans, 0),
			).toBeNull();
		}

		// 6. Missing source marker when roots < spans fails closed.
		{
			const source = '[note](/url "year $199$") then $x$';
			const index = createEditorMarkdownBlockIndex(source);
			const unmarked = [createMathElement(null, false)];
			expect(
				pairMathDomIndexToSpanIndex(source, unmarked, index.mathSpans, 0),
			).toBeNull();
			expect(
				pairMathSpanIndexToDomIndex(source, unmarked, index.mathSpans, 1),
			).toBeNull();
		}
	});

	it("completes 1,200 identical $x$ + stripped title formula and 400 distinct formulas + stripped title formula in strictly O(D + S) (< 100 ms)", () => {
		// Benchmark A: 1,200 identical $x$ + [note](/url "year $199$")
		const dupSource = `[note](/url "year $199$") then ${"$x$ ".repeat(1_200).trimEnd()}`;
		const dupIndex = createEditorMarkdownBlockIndex(dupSource);
		expect(dupIndex.mathSpans).toHaveLength(1_201);
		const dupRoots = Array.from({ length: 1_200 }, () =>
			createMathElement("\\(x\\)", false),
		);

		const dupStart = performance.now();
		const dupCtx = createMathPairingContext(
			dupSource,
			dupRoots,
			dupIndex.mathSpans,
		);
		expect(dupCtx).not.toBeNull();
		expect(dupCtx?.pairDomIndexToSpanIndex(0)).toBe(1);
		expect(dupCtx?.pairDomIndexToSpanIndex(599)).toBe(600);
		expect(dupCtx?.pairDomIndexToSpanIndex(1_199)).toBe(1_200);
		expect(dupCtx?.pairSpanIndexToDomIndex(0)).toBeNull();
		expect(dupCtx?.pairSpanIndexToDomIndex(1)).toBe(0);
		expect(dupCtx?.pairSpanIndexToDomIndex(1_200)).toBe(1_199);
		const dupElapsedMs = performance.now() - dupStart;
		expect(
			dupElapsedMs,
			`1,200 identical $x$ pairing took ${dupElapsedMs.toFixed(2)}ms`,
		).toBeLessThan(100);

		// Benchmark B: 400 distinct formulas + [note](/url "year $199$")
		const distinctFormulas = Array.from({ length: 400 }, (_, i) => `$f_{${i}}$`);
		const distinctSource = `[note](/url "year $199$") then ${distinctFormulas.join(" ")}`;
		const distinctIndex = createEditorMarkdownBlockIndex(distinctSource);
		expect(distinctIndex.mathSpans).toHaveLength(401);
		const distinctRoots = Array.from({ length: 400 }, (_, i) =>
			createMathElement(`\\(f_{${i}}\\)`, false),
		);

		const distinctStart = performance.now();
		const distinctCtx = createMathPairingContext(
			distinctSource,
			distinctRoots,
			distinctIndex.mathSpans,
		);
		expect(distinctCtx).not.toBeNull();
		expect(distinctCtx?.pairDomIndexToSpanIndex(0)).toBe(1);
		expect(distinctCtx?.pairDomIndexToSpanIndex(200)).toBe(201);
		expect(distinctCtx?.pairDomIndexToSpanIndex(399)).toBe(400);
		expect(distinctCtx?.pairSpanIndexToDomIndex(0)).toBeNull();
		expect(distinctCtx?.pairSpanIndexToDomIndex(1)).toBe(0);
		expect(distinctCtx?.pairSpanIndexToDomIndex(400)).toBe(399);
		const distinctElapsedMs = performance.now() - distinctStart;
		expect(
			distinctElapsedMs,
			`400 distinct formulas pairing took ${distinctElapsedMs.toFixed(2)}ms`,
		).toBeLessThan(100);
	});
});
