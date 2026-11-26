import { describe, expect, it } from "vitest";

import { isLeagueUnicodeWhitespaceCode } from "../../shared/markdown/markdown-char-codes";
import { MAX_LEAGUE_DELIMITERS_PER_INLINE_BLOCK } from "./editor-markdown-delimiters";
import { analyzeLeagueInlineBlock } from "./editor-markdown-league-inline";
import { scanRawMarkdownInlineCodeRanges } from "./editor-markdown-math-preparation";

describe("editor-markdown-delimiters and editor-markdown-league-inline", () => {
	it("early-exits League delimiter counting once pushed exceeds limit", () => {
		const massive = "*x* ".repeat(10_000);
		expect(
			analyzeLeagueInlineBlock(massive, {
				limit: MAX_LEAGUE_DELIMITERS_PER_INLINE_BLOCK,
			}).delimiterCount,
		).toBe(MAX_LEAGUE_DELIMITERS_PER_INLINE_BLOCK + 1);
		expect(analyzeLeagueInlineBlock(massive, { limit: 10 }).delimiterCount).toBe(
			11,
		);
		expect(
			analyzeLeagueInlineBlock("*x* *y*", { limit: 10 }).delimiterCount,
		).toBe(4);
	});

	it("matches the exact 26 PHP 8.3 PCRE2 /\\pZ|\\s/u BMP whitespace code points", () => {
		const expected = [
			0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680,
			0x180e, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
			0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
		];
		const matched: number[] = [];
		for (let cp = 0; cp <= 0xffff; cp += 1) {
			if (isLeagueUnicodeWhitespaceCode(cp)) matched.push(cp);
		}
		expect(matched).toEqual(expected);
		expect(isLeagueUnicodeWhitespaceCode(0xfeff)).toBe(false);
		expect(isLeagueUnicodeWhitespaceCode(0x0085)).toBe(true);
		expect(isLeagueUnicodeWhitespaceCode(0x180e)).toBe(true);
	});

	it("matches League 2.8.2 case-sensitive HTML, comments, declarations, angle autolinks, backticks, math, links, and bare email/URL precedence", () => {
		// Inline HTML is opaque to delimiters: `*x*` inside a valid tag never counts.
		const expectDelimiterCount = (text: string, expected: number): void => {
			expect(analyzeLeagueInlineBlock(text).delimiterCount).toBe(expected);
		};
		const expectAutolinkSlices = (text: string, expected: string[]): void => {
			const analysis = analyzeLeagueInlineBlock(text);
			const slices = [...analysis.angleAutolinks, ...analysis.gfmAutolinks]
				.sort((left, right) => left.from - right.from)
				.map((r) => text.slice(r.from, r.to));
			expect(slices).toEqual(expected);
		};

		expectDelimiterCount('< a title="*x*"> **word**', 4);
		expectDelimiterCount('<A title="*x*"> **word**', 4);
		expectDelimiterCount('<a TITLE="*x*"> **word**', 4);
		expectDelimiterCount("</ a *x*> **word**", 4);
		expectDelimiterCount('<a title="*x*" / > **word**', 4);
		expectDelimiterCount('<a title="*x*"> **word**', 2);
		expectDelimiterCount('<a title="*x*" /> **word**', 2);
		expectDelimiterCount('<a\u00a0title="*x*"> **word**', 2);
		expectDelimiterCount('<a\u0085title="*x*"> **word**', 2);
		expectDelimiterCount('<a\u180etitle="*x*"> **word**', 2);
		expectDelimiterCount("<!-- a -- *x* --> **word**", 2);
		expectDelimiterCount("<!--> *x* -->", 2);
		expectDelimiterCount("<!---> *x* -->", 2);
		expectDelimiterCount("<!----> *x* -->", 2);
		expectDelimiterCount("<!doctype *x*> word", 0);
		expectDelimiterCount("<?php *x* ?> <![CDATA[*x*]]>", 0);
		const htmlTick = analyzeLeagueInlineBlock('<a title="`"> *x* ` **word**');
		expect(htmlTick.codeSpans).toEqual([]);
		expect(htmlTick.delimiterCount).toBe(4);
		const spacedTickText = '< a title="`"> *x* ` **word**';
		const spacedTick = analyzeLeagueInlineBlock(spacedTickText);
		expect(
			spacedTick.codeSpans.map((r) => spacedTickText.slice(r.from, r.to)),
		).toEqual(["`\"> *x* `"]);
		expect(spacedTick.delimiterCount).toBe(2);
		expectAutolinkSlices("<ab:> <a_b:*x*> <user+1@sub-1.example.com>", [
			"<ab:>",
			"<user+1@sub-1.example.com>",
		]);
		expectAutolinkSlices(`<${"a".repeat(32)}:*x*> <${"a".repeat(33)}:*x*>`, [
			`<${"a".repeat(32)}:*x*>`,
		]);
		expectAutolinkSlices("a_x_@example.com a_x_@example.com_ a_x_@example.com.", [
			"a_x_@example.com",
			"a_x_@example.com",
		]);
		expectAutolinkSlices("\\_a_x_@example.com \\\\_a_x_@example.com", [
			"_a_x_@example.com",
		]);
		expectAutolinkSlices(
			"https://user_name@example.com_ www.a_b@example.com",
			["https://user_name@example.com", "www.a_b@example.com"],
		);

		// Stage 1 raw lexical backtick + math extraction & Stage 2/3/4 League engine parity:
		expectDelimiterCount('<a title="*x*" $y>$ **word**', 4);
		expectDelimiterCount("<!-- *x* $-->$ **word**", 4);
		expect(analyzeLeagueInlineBlock("\\``*x*` y ` **word**").delimiterCount).toBe(4);
		expect(
			analyzeLeagueInlineBlock(`\` *x* ${"`".repeat(1001)} **word**`)
				.delimiterCount,
		).toBe(2);
		expect(
			analyzeLeagueInlineBlock('<a title="`"> $*x*$ ` **word**').delimiterCount,
		).toBe(4);
		expect(
			analyzeLeagueInlineBlock('<a title="`"> \\(*x*\\) ` **word**')
				.delimiterCount,
		).toBe(4);
		expect(
			analyzeLeagueInlineBlock("$a[$](u/*y*) **word**").delimiterCount,
		).toBe(4);
		expect(
			analyzeLeagueInlineBlock("<!-- a -- [ -->](u/*y*) **word**")
				.delimiterCount,
		).toBe(4);
		expect(
			analyzeLeagueInlineBlock("<!doctype [ >](u/*y*) **word**").delimiterCount,
		).toBe(4);
		expect(
			analyzeLeagueInlineBlock('<a\u0085b="[">](u/*y*) **word**')
				.delimiterCount,
		).toBe(4);
		expect(
			analyzeLeagueInlineBlock("\\<a title=\"<b title='*x*'>\"> **word**")
				.delimiterCount,
		).toBe(4);
		expect(analyzeLeagueInlineBlock("a_$x$ **word**").delimiterCount).toBe(2);
		expect(analyzeLeagueInlineBlock("a_$x$_b **word**").delimiterCount).toBe(2);
		expect(analyzeLeagueInlineBlock("a_\\(x\\)_b **word**").delimiterCount).toBe(2);
		expect(
			analyzeLeagueInlineBlock("a_b_$x$@example.com **word**").delimiterCount,
		).toBe(2);
		expect(
			analyzeLeagueInlineBlock("https://example.com/$x$_a_b **word**")
				.delimiterCount,
		).toBe(2);

		// Stage 4 Round 20 single-pass League 2.8.2 parity cases:
		// R20A #1: real `EASYMDE_MATH_0_TOKEN` invalidates angle URI scheme via `_`.
		const r20a1 = analyzeLeagueInlineBlock("Lead <ab$x$:*y*> target\nphrase");
		expect(r20a1.angleAutolinks).toEqual([]);
		expect(r20a1.delimiterCount).toBe(2);

		// R20A #2: URL autolink swallows `]` inside `[a https://.../?q=x](u "*y*")`.
		const r20a2 = analyzeLeagueInlineBlock(
			'Lead [a https://example.com/?q=x](u "*y*") target\nphrase',
		);
		expect(r20a2.bindings).toEqual([]);
		expect(r20a2.gfmAutolinks).toHaveLength(1);
		expect(r20a2.delimiterCount).toBe(2);

		// R20B #1.1: CloseBracket jumps over link tails and full-ref labels.
		const linkTailCases: ReadonlyArray<
			Readonly<[string, ReadonlySet<string>?]>
		> = [
			['[a](u "`") *x* ` **word**'],
			["[a](`u) *x* ` **word**"],
			['[a](u "<!--") *x* --> **word**'],
			["[a](u \"<a title='\") *x* '> **word**"],
			['[a](u "<?") *x* ?> **word**'],
			['[a](u "<![CDATA[") *x* ]]> **word**'],
			['[a](u "<!a") *x* > **word**'],
			["[a][`] *x* ` **word**", new Set(["`"])],
			["[a][<!--] *x* --> **word**", new Set(["<!--"])],
		];
		for (const [doc, refs] of linkTailCases) {
			const analysis = analyzeLeagueInlineBlock(doc, {
				...(refs ? { definedReferenceLabels: refs } : {}),
			});
			expect(analysis.bindings).toHaveLength(1);
			expect(analysis.delimiterCount).toBe(4);
		}

		// R20B #1.2: URL autolink swallows `[` in query before OpenBracket.
		const r20b12 = analyzeLeagueInlineBlock(
			"https://example.com/?a=[b x](u/*y*) **word**",
		);
		expect(r20b12.bindings).toEqual([]);
		expect(r20b12.gfmAutolinks).toHaveLength(1);
		expect(r20b12.delimiterCount).toBe(4);

		// R20B #1.3: Prefix-only URL pre-scan prevents shadowed second URL after link tail.
		const r20b13 = analyzeLeagueInlineBlock(
			"[a](u '(https://a.com/x')(https://b.com/*x*a) **word**",
		);
		expect(r20b13.bindings).toHaveLength(1);
		expect(r20b13.gfmAutolinks).toHaveLength(1);
		expect(r20b13.delimiterCount).toBe(2);

		// R20B #1.4b: Block math splits paragraphs with separate delimiter budgets & `\n` flanking.
		const blockMathAnalysis = analyzeLeagueInlineBlock("a_$$x$$_b");
		expect(blockMathAnalysis.hasMathTokens).toBe(true);
		expect(blockMathAnalysis.emphRanges).toEqual([]);
		expect(blockMathAnalysis.delimiterCount).toBe(1);
		expect(blockMathAnalysis.hasUnverifiableReferences).toBe(false);
		const blockMathWithBudget = analyzeLeagueInlineBlock(
			`${"*x* ".repeat(499)}a_$$x$$_b **word**`,
		);
		expect(blockMathWithBudget.delimiterCount).toBe(999);
		expect(blockMathWithBudget.hasUnverifiableReferences).toBe(false);

		// R21A #2 + R21B #1: Single-pass token-space delimiter resolution.
		expect(analyzeLeagueInlineBlock("**word!**$x$").strongRanges).toEqual([]);
		expect(analyzeLeagueInlineBlock("Lead $a**b$ word**").strongRanges).toEqual([]);
		expect(analyzeLeagueInlineBlock("Lead $x$__word__").strongRanges).toEqual([]);
		expect(analyzeLeagueInlineBlock("Lead __word__$x$").strongRanges).toEqual([]);
		expect(
			analyzeLeagueInlineBlock("[a $x$__b__](https://e.com) word").strongRanges,
		).toEqual([]);
		expect(
			analyzeLeagueInlineBlock("[a $x**y$ b**](https://e.com) word").strongRanges,
		).toEqual([]);

		// Bracket-scoped delimiter resolution matching League CloseBracketParser:
		const linkScoped = analyzeLeagueInlineBlock("*a [b*](u) c*");
		expect(linkScoped.emphRanges).toEqual([{ from: 1, to: 12 }]);
		const imageScoped = analyzeLeagueInlineBlock("*a ![b*](u) c*");
		expect(imageScoped.emphRanges).toEqual([{ from: 1, to: 13 }]);
		const unboundBracket = analyzeLeagueInlineBlock("*a [b*] c*");
		expect(unboundBracket.emphRanges).toEqual([{ from: 1, to: 5 }]);

		// R21A #1: Block-math substitution block-boundary reclassification fails closed.
		for (const reclassified of [
			"lead $$x$$    **word**",
			"lead $$x$$ \t**word**",
			"lead $$x$$ > **word**",
			"lead $$x$$ # **word**",
			"lead $$x$$ - **word**",
		]) {
			expect(
				analyzeLeagueInlineBlock(reclassified).hasUnverifiableReferences,
			).toBe(true);
		}
		expect(
			analyzeLeagueInlineBlock("lead $$x$$ **word**", {
				isNonParagraphHost: true,
			}).hasUnverifiableReferences,
		).toBe(true);

		// R21A #3: TaskMarker raw `]` predecessor context via `taskMarkerLength`.
		const tmNoSpace = analyzeLeagueInlineBlock(
			"[x]https://example.com/?q=*z*x",
			{ taskMarkerLength: 3 },
		);
		expect(tmNoSpace.gfmAutolinks).toEqual([]);
		expect(tmNoSpace.delimiterCount).toBe(2);
		expect(tmNoSpace.emphRanges).toEqual([{ from: 27, to: 28 }]);
		const tmWithSpace = analyzeLeagueInlineBlock(
			"[x] https://example.com/?q=*z*x",
			{ taskMarkerLength: 3 },
		);
		expect(tmWithSpace.gfmAutolinks).toHaveLength(1);
		expect(tmWithSpace.delimiterCount).toBe(0);
		expect(
			analyzeLeagueInlineBlock("[x]*word*", { taskMarkerLength: 3 }).emphRanges,
		).toEqual([{ from: 4, to: 8 }]);
		expect(
			analyzeLeagueInlineBlock("[x]__word__", { taskMarkerLength: 3 })
				.strongRanges,
		).toEqual([{ from: 5, to: 9 }]);
	});

	it("scales strictly linearly on pathological unclosed HTML, comment, PI, backtick, URL prefix, and bare email inputs", () => {
		const workloads: ReadonlyArray<Readonly<[string, number]>> = [
			[`<a b='`.repeat(16_000), 0],
			[`${"<a b='".repeat(16_000)}>`, 0],
			[`<!-- `.repeat(16_000), 0],
			[`<? `.repeat(16_000), 0],
			[`${"a_b_".repeat(8_000)}@x.y_`, 0],
			[`${"a_b_@x.y_ ".repeat(8_000)}`, 0],
			["a `k` ".repeat(40_000), 40_000],
			["https://user_name:pass ".repeat(16_000), 16_000],
			["www.x_y.z ".repeat(16_000), 16_000],
			["www.★_".repeat(8_000), 0],
		];
		for (const [input, expectedCount] of workloads) {
			const startedAt = performance.now();
			const { angleAutolinks, codeSpans, gfmAutolinks } = analyzeLeagueInlineBlock(input);
			const elapsedMs = performance.now() - startedAt;
			expect(angleAutolinks.length + codeSpans.length + gfmAutolinks.length).toBe(expectedCount);
			expect(elapsedMs).toBeLessThan(1_000);
		}
	});

	it("owns PHP raw-backtick scanning and maps League token-space strong spans across math (Stage 4 Round 22)", () => {
		// PHP `inline_code_ranges()` never pairs a backtick with one inside a fenced code block.
		const fenced = "`a\n```\n`\n```";
		expect(scanRawMarkdownInlineCodeRanges(fenced)).toEqual([{ from: 0, to: 8 }]);
		expect(scanRawMarkdownInlineCodeRanges(fenced, [{ from: 3, to: fenced.length }])).toEqual([]);
		// HTML-blind: the attribute backtick opens a raw code span exposing `$$x$$`.
		expect(scanRawMarkdownInlineCodeRanges('<a title="`"> ` $$x$$ ` word')).toEqual([
			{ from: 10, to: 15 },
		]);

		const mathStrong = analyzeLeagueInlineBlock("**$x**y$ word**");
		expect(mathStrong.hasMathTokens).toBe(true);
		expect(mathStrong.strongSpans).toEqual([
			{ closeMark: "**", from: 0, innerFrom: 2, innerTo: 13, openMark: "**", to: 15 },
		]);
		expect(mathStrong.strongRanges).toEqual([{ from: 2, to: 13 }]);
		const plain = analyzeLeagueInlineBlock("a __b__ c");
		expect(plain.hasMathTokens).toBe(false);
		expect(plain.strongSpans).toEqual([
			{ closeMark: "__", from: 2, innerFrom: 4, innerTo: 5, openMark: "__", to: 7 },
		]);
	});
});
