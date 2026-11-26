import { describe, expect, it } from "vitest";

import {
	mathDomSourceMatchesSpan,
	normalizeMathTex,
} from "../../shared/markdown/normalize-math-tex";
import {
	associateGeneratedContentTarget,
	createGeneratedContentTarget,
	type GeneratedContentAcceptedPreview,
	mathElementMatchesSource,
} from "./generated-content-target";

const preview: GeneratedContentAcceptedPreview = {
	revision: 4,
	signature: "accepted-preview-4",
};

describe("generated content target association", () => {
	it("associates duplicate formulas by worker ordinal, preserving exact source ranges", () => {
		const source = "before $x$ and after $x$";
		const firstFrom = source.indexOf("$x$");
		const secondFrom = source.lastIndexOf("$x$");
		const result = associateGeneratedContentTarget({
			acceptedPreview: preview,
			blockId: "visual-block-0",
			kind: "math",
			mathSpans: [
				{
					bodyFrom: firstFrom + 1,
					bodyTo: firstFrom + 2,
					displayMode: false,
					from: firstFrom,
					to: firstFrom + 3,
				},
				{
					bodyFrom: secondFrom + 1,
					bodyTo: secondFrom + 2,
					displayMode: false,
					from: secondFrom,
					to: secondFrom + 3,
				},
			],
			ordinal: 1,
			source,
			sourceRevision: 9,
		});

		expect(result).toEqual({
			status: "associated",
			target: {
				acceptedPreview: preview,
				blockId: "visual-block-0",
				kind: "math",
				ordinal: 1,
				original: {
					body: "x",
					bodyRange: { from: secondFrom + 1, to: secondFrom + 2 },
					full: "$x$",
					fullRange: { from: secondFrom, to: secondFrom + 3 },
				},
				sourceRevision: 9,
			},
		});
	});

	it("rejects a math association that has no exact ordinal instead of searching text", () => {
		const result = associateGeneratedContentTarget({
			acceptedPreview: preview,
			blockId: "visual-block-0",
			kind: "math",
			mathSpans: [
				{ bodyFrom: 1, bodyTo: 2, displayMode: false, from: 0, to: 3 },
			],
			ordinal: 1,
			source: "$x$ $x$",
			sourceRevision: 1,
		});

		expect(result).toEqual({
			code: "generated-content-target-ordinal-unavailable",
			status: "failed",
		});
	});

	it("rejects a math span whose body range includes either delimiter", () => {
		const result = associateGeneratedContentTarget({
			acceptedPreview: preview,
			blockId: "visual-block-0",
			kind: "math",
			mathSpans: [
				{ bodyFrom: 0, bodyTo: 3, displayMode: false, from: 0, to: 3 },
			],
			ordinal: 0,
			source: "$x$",
			sourceRevision: 1,
		});

		expect(result).toEqual({
			code: "generated-content-target-math-span-invalid",
			status: "failed",
		});
	});

	it("validates caller-supplied Mermaid ranges without parsing or normalizing source", () => {
		const source = "before\n```mermaid\r\nA-->B\r\n```\nafter";
		const fullFrom = source.indexOf("```mermaid");
		const fullTo = source.indexOf("\nafter");
		const bodyFrom = source.indexOf("A-->B");
		const bodyTo = bodyFrom + "A-->B".length;
		const result = createGeneratedContentTarget({
			acceptedPreview: preview,
			blockId: "visual-block-1",
			kind: "mermaid",
			ordinal: 0,
			original: {
				body: "A-->B",
				bodyRange: { from: bodyFrom, to: bodyTo },
				full: source.slice(fullFrom, fullTo),
				fullRange: { from: fullFrom, to: fullTo },
			},
			source,
			sourceRevision: 10,
		});

		expect(result.status).toBe("associated");
		if (result.status !== "associated") return;
		expect(result.target.original.full).toBe(source.slice(fullFrom, fullTo));
		expect(result.target.original.bodyRange).toEqual({
			from: bodyFrom,
			to: bodyTo,
		});
	});

	it("rejects invalid range/source combinations explicitly", () => {
		const result = createGeneratedContentTarget({
			acceptedPreview: preview,
			blockId: "visual-block-2",
			kind: "math",
			ordinal: 0,
			original: {
				body: "wrong",
				bodyRange: { from: 1, to: 2 },
				full: "$x$",
				fullRange: { from: 0, to: 3 },
			},
			source: "$x$",
			sourceRevision: 1,
		});

		expect(result).toEqual({
			code: "generated-content-target-original-mismatch",
			status: "failed",
		});
	});

	it("keeps normalizeMathTex at 2 backslashes for KaTeX while matching live-PHP 4-backslash matrices, NBSP, and HTML5-decoded entities (R32A #1, R32B #1)", () => {
		expect(
			normalizeMathTex("\\begin{pmatrix}a \\, b \\\\ c & d\\end{pmatrix}"),
		).toBe("\\begin{pmatrix}a \\\\, b \\\\ c & d\\end{pmatrix}");

		const phpPreviewCases: ReadonlyArray<
			Readonly<{
				body: string;
				displayMode: boolean;
				domSource: string;
				full: string;
				label: string;
			}>
		> = [
			{
				body: "\\begin{pmatrix}a \\, b \\\\ c & d\\end{pmatrix}",
				displayMode: true,
				domSource: "$$\\begin{pmatrix}a \\\\\\\\, b \\\\ c & d\\end{pmatrix}$$",
				full: "$$\\begin{pmatrix}a \\, b \\\\ c & d\\end{pmatrix}$$",
				label: "block pmatrix with \\, and \\\\",
			},
			{
				body: "\\begin{array}{cc}a \\ b \\\\ c \\| d\\end{array}",
				displayMode: true,
				domSource:
					"$$\\begin{array}{cc}a \\\\\\\\ b \\\\ c \\\\\\\\| d\\end{array}$$",
				full: "$$\\begin{array}{cc}a \\ b \\\\ c \\| d\\end{array}$$",
				label: "block array with single-backslash row break and \\|",
			},
			{
				body: "\\begin{matrix}a \\; b \\: c \\! d \\} \\] \\_ \\%\\end{matrix}",
				displayMode: true,
				domSource:
					"$$\\begin{matrix}a \\\\\\\\; b \\\\\\\\: c \\\\\\\\! d \\\\\\\\} \\\\\\\\] \\\\\\\\_ \\\\\\\\%\\end{matrix}$$",
				full: "$$\\begin{matrix}a \\; b \\: c \\! d \\} \\] \\_ \\%\\end{matrix}$$",
				label: "matrix punctuation escapes",
			},
			{
				body: "frac\u00a0{1}{2}",
				displayMode: false,
				domSource: "\\(frac\u00a0{1}{2}\\)",
				full: "$frac\u00a0{1}{2}$",
				label: "NBSP before brace is not ASCII \\s in PHP",
			},
			{
				body: "\u00a0x\u00a0",
				displayMode: false,
				domSource: "\\(\u00a0x\u00a0\\)",
				full: "$\u00a0x\u00a0$",
				label: "NBSP is not trimmed by PHP trim()",
			},
			{
				body: "begin\u00a0{pmatrix}a\\end{pmatrix}",
				displayMode: false,
				domSource: "\\(begin\u00a0{pmatrix}a\\end{pmatrix}\\)",
				full: "$begin\u00a0{pmatrix}a\\end{pmatrix}$",
				label: "NBSP after begin",
			},
			{
				body: "left\u00a0(x)right\u00a0)",
				displayMode: false,
				domSource: "\\(left\u00a0(x)right\u00a0)\\)",
				full: "$left\u00a0(x)right\u00a0)$",
				label: "NBSP after left/right",
			},
			{
				body: "\\text{&lt;}",
				displayMode: false,
				domSource: "\\(\\text{<}\\)",
				full: "$\\text{&lt;}$",
				label: "HTML entity &lt;",
			},
			{
				body: "\\text{&gt;}",
				displayMode: false,
				domSource: "\\(\\text{>}\\)",
				full: "$\\text{&gt;}$",
				label: "HTML entity &gt;",
			},
			{
				body: "\\text{&amp;}",
				displayMode: false,
				domSource: "\\(\\text{&}\\)",
				full: "$\\text{&amp;}$",
				label: "HTML entity &amp;",
			},
			{
				body: "\\text{&quot;}",
				displayMode: false,
				domSource: '\\(\\text{"}\\)',
				full: "$\\text{&quot;}$",
				label: "HTML entity &quot;",
			},
			{
				body: "\\text{&#60;}",
				displayMode: false,
				domSource: "\\(\\text{<}\\)",
				full: "$\\text{&#60;}$",
				label: "decimal entity &#60;",
			},
			{
				body: "\\text{&#x3c;}",
				displayMode: false,
				domSource: "\\(\\text{<}\\)",
				full: "$\\text{&#x3c;}$",
				label: "hex entity &#x3c;",
			},
			{
				body: "\\text{&copy;}",
				displayMode: false,
				domSource: "\\(\\text{\u00a9}\\)",
				full: "$\\text{&copy;}$",
				label: "named entity &copy;",
			},
			{
				body: "\\text{&alpha;}",
				displayMode: false,
				domSource: "\\(\\text{\u03b1}\\)",
				full: "$\\text{&alpha;}$",
				label: "named entity &alpha;",
			},
			{
				body: "\\text{&notanentity;}",
				displayMode: false,
				domSource: "\\(\\text{&notanentity;}\\)",
				full: "$\\text{&notanentity;}$",
				label: "unknown entity &notanentity;",
			},
			{
				body: "x + &amp;lt;",
				displayMode: false,
				domSource: "\\(x + &lt;\\)",
				full: "$x + &amp;lt;$",
				label: "double-entity &amp;lt;",
			},
			{
				body: "&copy=1",
				displayMode: false,
				domSource: "\\(&copy=1\\)",
				full: "$&copy=1$",
				label: "non-terminated ampersand &copy=1",
			},
			{
				body: 'a < b & c > d "e" \'f\'',
				displayMode: false,
				domSource: '\\(a < b & c > d "e" \'f\'\\)',
				full: '$a < b & c > d "e" \'f\'$',
				label: "raw comparison and quotes",
			},
			{
				body: "\\text{&lt;&apos;}",
				displayMode: false,
				domSource: "\\(\\text{<&apos;}\\)",
				full: "$\\text{&lt;&apos;}$",
				label: "WP KSES mixed &lt; + &apos;",
			},
		];

		for (const item of phpPreviewCases) {
			const el = document.createElement(item.displayMode ? "div" : "span");
			el.className = item.displayMode
				? "easymde-math easymde-math-block"
				: "easymde-math easymde-math-inline";
			el.setAttribute("data-easymde-visual-markdown-source", item.domSource);
			expect(
				mathElementMatchesSource(el, {
					body: item.body,
					displayMode: item.displayMode,
					full: item.full,
				}),
				item.label,
			).toBe(true);
			expect(
				mathElementMatchesSource(el, {
					body: "z",
					displayMode: item.displayMode,
					full: item.displayMode ? "$$z$$" : "$z$",
				}),
				`${item.label} negative mismatch`,
			).toBe(false);
		}

		// Fallback decoder without ownerDocument handles standard + numeric entities and rejects mismatches.
		expect(
			mathDomSourceMatchesSpan("\\(\\text{<}\\)", "$\\text{&lt;}$", "\\text{&lt;}", false),
		).toBe(true);
		expect(
			mathDomSourceMatchesSpan("\\(x + &lt;\\)", "$x + &amp;lt;$", "x + &amp;lt;", false),
		).toBe(true);
		expect(
			mathDomSourceMatchesSpan("\\(\\text{<}\\)", "$\\text{&#x3c;}$", "\\text{&#x3c;}", false),
		).toBe(true);
		expect(mathDomSourceMatchesSpan("\\(y\\)", "$z$", "z", false)).toBe(false);
	});
});
