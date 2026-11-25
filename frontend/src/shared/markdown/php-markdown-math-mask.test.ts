import { describe, expect, it } from "vitest";

import {
	isRangeDroppedByPhpTable,
	scanPhpCommonMarkBlocks,
	scanPhpCommonMarkReferenceLabels,
} from "./php-commonmark-block-scan";
import {
	maskPhpMarkdownMathForTableScan,
	scanPhpInlineCodeRanges,
	scanPhpMarkdownMathRanges,
} from "./php-markdown-math-mask";

describe("maskPhpMarkdownMathForTableScan", () => {
	it("fast-paths strings without matched math delimiter pairs and masks all PHP-extracted inline math", () => {
		const plain = "| A | B |\n| --- | --- |\n| 1 | 2 |";
		expect(maskPhpMarkdownMathForTableScan(plain)).toBe(plain);

		const unclosed = "| A | B |\n| --- | --- |\n| $5 | \\(open |";
		expect(maskPhpMarkdownMathForTableScan(unclosed)).toBe(unclosed);

		const inlineNoPipe = "| A | B |\n| --- | --- |\n| $x + y$ | \\(z\\) |";
		expect(maskPhpMarkdownMathForTableScan(inlineNoPipe)).toBe(
			"| A | B |\n| --- | --- |\n| M_____M | M___M |",
		);

		const knownInlineNoPipe = maskPhpMarkdownMathForTableScan(inlineNoPipe, [
			{
				block: false,
				from: inlineNoPipe.indexOf("$x"),
				to: inlineNoPipe.indexOf("$ |") + 1,
			},
		]);
		expect(knownInlineNoPipe).toBe(
			"| A | B |\n| --- | --- |\n| M_____M | \\(z\\) |",
		);
	});

	it("masks display math with O(1) fixed newlines while preserving exact byte length", () => {
		const largeDisplay = `$$${"a".repeat(850_000)}$$\n| A |\n| --- |\n| [link](https://example.com) |`;
		const masked = maskPhpMarkdownMathForTableScan(largeDisplay);
		expect(masked.length).toBe(largeDisplay.length);
		expect(masked.startsWith("\n\nMM")).toBe(true);
		const scan = scanPhpCommonMarkBlocks(largeDisplay);
		expect(scan.lines.length).toBeLessThan(15);
		expect(scan.tableCellSource).toBe(masked);

		const bracketDisplay = "| A |\n| --- |\n\\[a|b\\]\n| 1 | ![ok](/ok.png) |";
		const bracketMasked = maskPhpMarkdownMathForTableScan(bracketDisplay);
		expect(bracketMasked.length).toBe(bracketDisplay.length);
		const bracketScan = scanPhpCommonMarkBlocks(bracketDisplay);
		const okFrom = bracketDisplay.indexOf("![ok]");
		const okTo = bracketDisplay.indexOf(")", okFrom) + 1;
		expect(isRangeDroppedByPhpTable(bracketDisplay, bracketScan, okFrom, okTo)).toBe(false);
	});

	it("masks inline $...$ and \\(...\\) pipes while preserving line breaks and exact offsets", () => {
		const inlineDollar = "| A | B |\n| --- | --- |\n| $a|b$ | ![img](https://example.com/a.png) |";
		const maskedDollar = maskPhpMarkdownMathForTableScan(inlineDollar);
		expect(maskedDollar.length).toBe(inlineDollar.length);
		expect(maskedDollar).toBe(
			"| A | B |\n| --- | --- |\n| M___M | ![img](https://example.com/a.png) |",
		);

		const inlineParen = "| A | B |\n| --- | --- |\n| \\(a|b\\) | ![img](https://example.com/a.png) |";
		const maskedParen = maskPhpMarkdownMathForTableScan(inlineParen);
		expect(maskedParen.length).toBe(inlineParen.length);
		expect(maskedParen).toBe(
			"| A | B |\n| --- | --- |\n| M_____M | ![img](https://example.com/a.png) |",
		);

		const multilineParen = "| A | B |\n| --- | --- |\n| \\(a\n|b\\) | ![img](https://example.com/a.png) |";
		const maskedMulti = maskPhpMarkdownMathForTableScan(multilineParen);
		expect(maskedMulti.length).toBe(multilineParen.length);
		expect(maskedMulti).toBe(
			"| A | B |\n| --- | --- |\n| M______M | ![img](https://example.com/a.png) |",
		);
	});

	it("masks multiline inline \\(...\\) and UTF-16 surrogate pairs as single-line exact-length tokens matching PHP extract_math", () => {
		// 1. Multiline header cell keeps 3 columns so body cell 2 is kept.
		const headerMulti =
			"| A | \\(x\ny\\) | B |\n| --- | --- | --- |\n| 1 | 2 | ![kept](https://example.com/a.png) |";
		const headerMasked = maskPhpMarkdownMathForTableScan(headerMulti);
		expect(headerMasked.length).toBe(headerMulti.length);
		expect(headerMasked).toContain("| A | M_____M | B |");
		const headerScan = scanPhpCommonMarkBlocks(headerMulti);
		const kept1From = headerMulti.indexOf("![kept]");
		const kept1To = headerMulti.indexOf(")", kept1From) + 1;
		expect(isRangeDroppedByPhpTable(headerMulti, headerScan, kept1From, kept1To)).toBe(
			false,
		);

		// 2. Multiline body cell keeps row on one logical line so extra cell 2 is dropped.
		const bodyMulti =
			"| A | B |\n| --- | --- |\n| 1 | \\(x\ny\\) | ![dropped](https://example.com/b.png) |";
		const bodyMasked = maskPhpMarkdownMathForTableScan(bodyMulti);
		expect(bodyMasked.length).toBe(bodyMulti.length);
		expect(bodyMasked).toContain("| 1 | M_____M | ![dropped]");
		const bodyScan = scanPhpCommonMarkBlocks(bodyMulti);
		const drop2From = bodyMulti.indexOf("![dropped]");
		const drop2To = bodyMulti.indexOf(")", drop2From) + 1;
		expect(isRangeDroppedByPhpTable(bodyMulti, bodyScan, drop2From, drop2To)).toBe(
			true,
		);

		// 3. Blank line inside inline \(x\n\ny\) does not close the table; cell 1 kept, cell 2 dropped.
		const blankLineInMath =
			"| A | B |\n| --- | --- |\n| \\(x\n\ny\\) | ![kept](https://example.com/a.png) | ![dropped](https://example.com/b.png) |";
		const blankMasked = maskPhpMarkdownMathForTableScan(blankLineInMath);
		expect(blankMasked.length).toBe(blankLineInMath.length);
		expect(blankMasked).toContain("| M______M | ![kept]");
		const blankScan = scanPhpCommonMarkBlocks(blankLineInMath);
		const kept3From = blankLineInMath.indexOf("![kept]");
		const kept3To = blankLineInMath.indexOf(")", kept3From) + 1;
		const drop3From = blankLineInMath.indexOf("![dropped]");
		const drop3To = blankLineInMath.indexOf(")", drop3From) + 1;
		expect(isRangeDroppedByPhpTable(blankLineInMath, blankScan, kept3From, kept3To)).toBe(
			false,
		);
		expect(isRangeDroppedByPhpTable(blankLineInMath, blankScan, drop3From, drop3To)).toBe(
			true,
		);

		// 4. UTF-16 surrogate pair inside inline math preserves exact UTF-16 offsets (both auto and knownRanges).
		const surrogateSource =
			"\\(😀\nx|y\\)\n\n| A |\n| --- |\n| ![kept](https://example.com/a.png) |";
		const surrogateMasked = maskPhpMarkdownMathForTableScan(surrogateSource);
		expect(surrogateMasked.length).toBe(surrogateSource.length);
		expect(surrogateMasked.startsWith("M________M\n\n| A |")).toBe(true);
		const knownSurrogateMasked = maskPhpMarkdownMathForTableScan(surrogateSource, [
			{ block: false, from: 0, to: surrogateSource.indexOf("\\)") + 2 },
		]);
		expect(knownSurrogateMasked).toBe(surrogateMasked);
		const surrogateScan = scanPhpCommonMarkBlocks(surrogateSource);
		const kept4From = surrogateSource.indexOf("![kept]");
		const kept4To = surrogateSource.indexOf(")", kept4From) + 1;
		expect(
			isRangeDroppedByPhpTable(surrogateSource, surrogateScan, kept4From, kept4To),
		).toBe(false);
	});

	it("matches PHP extract_math delimiter edge cases and stays strictly linear on 80,000 unclosed delimiters", () => {
		// Exact PHP delimiter parity: empty delimiters do not match; 5-dollar matches `$`; `(?<!\\)` checks immediately preceding `\`.
		expect(maskPhpMarkdownMathForTableScan("$$a$$")).toBe("\n\nM\n\n");
		expect(maskPhpMarkdownMathForTableScan("$$$$")).toBe("$$$$");
		expect(maskPhpMarkdownMathForTableScan("$$$$$")).toBe("\n\nM\n\n");
		expect(maskPhpMarkdownMathForTableScan("$$$$$$")).toBe("\n\nM\n\n$");
		expect(maskPhpMarkdownMathForTableScan("\\[a\\]")).toBe("\n\nM\n\n");
		expect(maskPhpMarkdownMathForTableScan("\\[\\]")).toBe("\\[\\]");
		expect(maskPhpMarkdownMathForTableScan("| \\(\\) |")).toBe("| \\(\\) |");
		expect(maskPhpMarkdownMathForTableScan("| \\(a|b\\) |")).toBe("| M_____M |");
		expect(maskPhpMarkdownMathForTableScan("| \\\\$a|b$ |")).toBe("| \\\\$a|b$ |");
		expect(maskPhpMarkdownMathForTableScan("| $a\\$b|c$ |")).toBe("| $a\\$b|c$ |");
		expect(maskPhpMarkdownMathForTableScan("| $a\\\\$b|c$ |")).toBe("| $a\\\\$b|c$ |");
		expect(maskPhpMarkdownMathForTableScan("| $a\\$b$c|d$ |")).toBe(
			"| $a\\$bM___M |",
		);
		expect(maskPhpMarkdownMathForTableScan("| $$a|b$ |")).toBe("| $M___M |");
		expect(maskPhpMarkdownMathForTableScan("| $a|b$$ |")).toBe("| M___M$ |");
		expect(maskPhpMarkdownMathForTableScan("foo $a\rb$")).toBe("foo M___M");
		expect(maskPhpMarkdownMathForTableScan("| $a\r\nb|c$ |")).toBe("| $a\r\nb|c$ |");

		// Display math triggers block masking even when source contains zero `|` characters.
		for (const displayIndented of [
			"$$x$$    ![alt](https://example.com/a.png)",
			"\\[x\\]    ![alt](https://example.com/a.png)",
		]) {
			const scan = scanPhpCommonMarkBlocks(displayIndented);
			expect(scan.blockCodeRanges).toEqual([
				{ end: displayIndented.length, start: 5 },
			]);
		}
		const singleSpaceAfterDisplay = "$$x$$ ![alt](https://example.com/a.png)";
		expect(scanPhpCommonMarkBlocks(singleSpaceAfterDisplay).blockCodeRanges).toEqual(
			[],
		);

		// Strictly linear O(N) performance on 80,000 unclosed delimiters (both with and without one matched pair).
		for (const payload of [
			`${"\\(".repeat(80_000)}\n\n| A |\n| --- |\n| ![a](/a.png) |`,
			`\\(x|y\\)${"\\(".repeat(80_000)}\n\n| A |\n| --- |\n| ![a](/a.png) |`,
			`${"\\[".repeat(80_000)}\n\n| A |\n| --- |\n| ![a](/a.png) |`,
			`\\[x\\]${"\\[".repeat(80_000)}\n\n| A |\n| --- |\n| ![a](/a.png) |`,
			`${"$$ ".repeat(40_000)}\n\n| A |\n| --- |\n| ![a](/a.png) |`,
			`${"$\n".repeat(80_000)}\n| A |\n| --- |\n| ![a](/a.png) |`,
		]) {
			const started = performance.now();
			const masked = maskPhpMarkdownMathForTableScan(payload);
			const elapsed = performance.now() - started;
			expect(masked.length).toBe(payload.length);
			expect(elapsed).toBeLessThan(250);
		}
	});

	it("skips fenced code, indented code, inline backtick spans, and escaped dollars like PHP MarkdownCodeRegionScanner", () => {
		const inlineCode = "| A | B |\n| --- | --- |\n| `$a|b$` | ![img](https://example.com/a.png) |";
		expect(maskPhpMarkdownMathForTableScan(inlineCode)).toBe(inlineCode);
		const inlineCodeScan = scanPhpCommonMarkBlocks(inlineCode);
		const imgFrom = inlineCode.indexOf("![img]");
		const imgTo = inlineCode.indexOf(")", imgFrom) + 1;
		expect(isRangeDroppedByPhpTable(inlineCode, inlineCodeScan, imgFrom, imgTo)).toBe(true);

		const fencedCode = "```\n$a|b$\n```\n| A | B |\n| --- | --- |\n| $c|d$ | ![img](/a.png) |";
		const maskedFenced = maskPhpMarkdownMathForTableScan(fencedCode);
		expect(maskedFenced.startsWith("```\n$a|b$\n```\n")).toBe(true);
		expect(maskedFenced).toContain("| M___M | ![img](/a.png) |");

		const indentedCode = "    $a|b$\n\n| A | B |\n| --- | --- |\n| $c|d$ | ![img](/a.png) |";
		const maskedIndented = maskPhpMarkdownMathForTableScan(indentedCode);
		expect(maskedIndented.startsWith("    $a|b$\n\n")).toBe(true);
		expect(maskedIndented).toContain("| M___M | ![img](/a.png) |");

		const escapedDollar = "| A | B |\n| --- | --- |\n| \\$a|b\\$ | ![img](/a.png) |";
		expect(maskPhpMarkdownMathForTableScan(escapedDollar)).toBe(escapedDollar);

		// Unclosed backtick separated by a fenced code block does not swallow math after the fence.
		const unclosedBeforeFence = "`open\n```\ncode\n```\n| A | B |\n| --- | --- |\n| $a|b$ | ![img](/a.png) |";
		expect(maskPhpMarkdownMathForTableScan(unclosedBeforeFence)).toContain(
			"| M___M | ![img](/a.png) |",
		);

		// Escaped first backtick of a 2-backtick run opens a 1-backtick code span matching PHP.
		const escapedLeadingTick = "| A | B |\n| --- | --- |\n| \\``$a|b$` | ![img](/a.png) |";
		expect(maskPhpMarkdownMathForTableScan(escapedLeadingTick)).toBe(escapedLeadingTick);
	});

	it("preserves PHP sequential pattern precedence and supports precomputed knownRanges", () => {
		const parenContainsDollar = "| A | B |\n| --- | --- |\n| \\(a $ b\\) | $c|d$ |";
		expect(maskPhpMarkdownMathForTableScan(parenContainsDollar)).toBe(
			"| A | B |\n| --- | --- |\n| M_______M | M___M |",
		);

		const source = "| A |\n| - |\n| $a|b$ ![x](/i) |";
		const mathFrom = source.indexOf("$a|b$");
		const knownMasked = maskPhpMarkdownMathForTableScan(source, [
			{ block: false, from: mathFrom, to: mathFrom + 5 },
		]);
		expect(knownMasked).toBe("| A |\n| - |\n| M___M ![x](/i) |");
	});

	it("exports canonical scanPhpInlineCodeRanges and scanPhpMarkdownMathRanges with 1:1 PHP parity and fixes bare-CR block scans (Track B #9 & #11)", () => {
		// scanPhpInlineCodeRanges matches PHP MarkdownCodeRegionScanner::inline_code_ranges().
		const codeSrc = "`one` \\``two` ``three``\n```\n`in-fence`\n```\n`four`";
		const inlineRanges = scanPhpInlineCodeRanges(codeSrc);
		expect(inlineRanges.map((r) => codeSrc.slice(r.start, r.end))).toEqual([
			"`one`",
			"`two`",
			"``three``",
			"`four`",
		]);

		// Unclosed backtick before a fenced code block does not cross the fence boundary.
		const crossFence = "`open\n```\ncode\n```\n`still-unclosed";
		expect(scanPhpInlineCodeRanges(crossFence)).toEqual([]);

		// scanPhpMarkdownMathRanges returns sorted, non-overlapping UTF-16 ranges across all 4 sequential passes.
		const multiPass =
			"😀 $a$ $$b$$ \\[c\\] \\(d\\) $$unclosed$ $e\rf$ $g\r\nh$ \\$esc$ `$code$`";
		const ranges = scanPhpMarkdownMathRanges(multiPass);
		expect(
			ranges.map((r) => ({ block: r.block, text: multiPass.slice(r.from, r.to) })),
		).toEqual([
			{ block: false, text: "$a$" },
			{ block: true, text: "$$b$$" },
			{ block: true, text: "\\[c\\]" },
			{ block: false, text: "\\(d\\)" },
			{ block: false, text: "$unclosed$" },
			{ block: false, text: "$e\rf$" },
		]);

		// Sequential nesting collapses strictly inner earlier-pass spans into the outermost PHP owner.
		expect(scanPhpMarkdownMathRanges("\\[a $$b$$ c\\]")).toEqual([
			{ block: true, from: 0, to: 13, tokenIndex: 1 },
		]);
		expect(scanPhpMarkdownMathRanges("before \\(a $$b$$ c\\) after")).toEqual([
			{ block: false, from: 7, to: 20, tokenIndex: 1 },
		]);
		expect(scanPhpMarkdownMathRanges("$a \\(b\\) c$")).toEqual([
			{ block: false, from: 0, to: 11, tokenIndex: 1 },
		]);
		// Display math inserts \n\n so outer $...$ cannot cross it.
		expect(scanPhpMarkdownMathRanges("$a $$b$$ c$")).toEqual([
			{ block: true, from: 3, to: 8, tokenIndex: 0 },
		]);

		// Track B #9: bare `\r` inside inline `$...$` keeps following 4-space image in paragraph (not indented code).
		const bareCrIndented = "$a\r# b$\r    ![alt](https://example.com/a.png)";
		expect(scanPhpCommonMarkBlocks(bareCrIndented).blockCodeRanges).toEqual([]);
		// Contrast with CRLF (`\r\n`), where PHP does NOT extract `$...$`, so `# b$` is a heading and `    ![alt]` is indented code.
		const crlfIndented = "$a\r\n# b$\r\n    ![alt](https://example.com/a.png)";
		expect(scanPhpCommonMarkBlocks(crlfIndented).blockCodeRanges).toEqual([
			{ end: crlfIndented.length, start: crlfIndented.indexOf("    ![alt]") },
		]);

		// Strictly linear O(N) performance on 80,000+ unclosed delimiters in scanPhpMarkdownMathRanges.
		for (const payload of [
			"\\(".repeat(80_000),
			`\\(x|y\\)${"\\(".repeat(80_000)}`,
			"\\[".repeat(80_000),
			`\\[x\\]${"\\[".repeat(80_000)}`,
			"$\n".repeat(80_000),
			"\\$".repeat(80_000),
		]) {
			const started = performance.now();
			scanPhpMarkdownMathRanges(payload);
			expect(performance.now() - started).toBeLessThan(200);
		}
	});

	it("masks inline math without pipes so HTML block closers and refdef quotes match PHP (Round 25 Track B #3)", () => {
		for (const [label, source] of [
			["pre closer inside inline dollar math", "<pre>\n$x</pre>$\n| A |\n| --- |"],
			["comment closer inside inline dollar math", "<!-- $-->$\n| A |\n| --- |"],
			["comment closer before image", "<!-- $-->$\n![alt](/img.png)"],
			["pre closer before image", "<pre>\n$x</pre>$\n![alt](/img.png)"],
			["comment closer inside inline paren math", "<!-- \\(-->\\)\n![alt](/img.png)"],
			["PI closer inside inline dollar math", "<? $?>$\n| A |\n| --- |"],
			["CDATA closer inside inline dollar math", "<![CDATA[ $]]>$\n| A |\n| --- |"],
			["refdef title quote inside inline dollar math", '[a]: /u "$\\"$ ![alt](/img.png)"'],
		] as const) {
			const masked = maskPhpMarkdownMathForTableScan(source);
			expect(masked.length, `len:${label}`).toBe(source.length);
			expect(masked, `changed:${label}`).not.toBe(source);
			const scan = scanPhpCommonMarkBlocks(source);
			for (const line of scan.lines) {
				expect(line.inlineBlockId, `non-inline:${label}`).toBe(-1);
				expect(line.isTableRow, `no-table:${label}`).toBe(false);
			}
		}
	});

	it("scans inline backtick code spans in strictly O(N) time with PHP escaped-backtick parity (Round 25 Track A #5)", () => {
		// Escaped closing backtick inside code span still closes the span matching PHP MarkdownCodeRegionScanner.
		expect(scanPhpInlineCodeRanges("`a\\`")).toEqual([{ end: 4, start: 0 }]);
		expect(scanPhpInlineCodeRanges("\\`a`")).toEqual([]);
		expect(scanPhpInlineCodeRanges("\\``a`")).toEqual([{ end: 5, start: 2 }]);
		expect(scanPhpInlineCodeRanges("``a ` b`` c `d`")).toEqual([
			{ end: 9, start: 0 },
			{ end: 15, start: 12 },
		]);

		// Linear scaling check across 1,024..8,192 inline code spans.
		const sample8k = "a `x` ".repeat(8_192);
		const started = performance.now();
		const ranges8k = scanPhpInlineCodeRanges(sample8k);
		const elapsedMs = performance.now() - started;
		expect(ranges8k).toHaveLength(8_192);
		expect(ranges8k[0]).toEqual({ end: 5, start: 2 });
		expect(ranges8k[8_191]).toEqual({
			end: 8_191 * 6 + 5,
			start: 8_191 * 6 + 2,
		});
		expect(elapsedMs).toBeLessThan(100);
	});

	it("includes `_` in inline math masks to match PHP EASYMDE_MATH_0_TOKEN HTML block rules (Round 26 Track B F2)", () => {
		// `<div$a$>` and `</div$a$>` become `<divM_M>` / `</divM_M>` (`_` invalid in HTML tag names -> paragraph, not Type 7 HTML block).
		for (const [label, source] of [
			["open tag with inline math", "<div$a$>\n![a](/x.png)\n[link](https://example.com)"],
			["close tag with inline math", "</div$a$>\n![a](/x.png)\n[link](https://example.com)"],
		] as const) {
			expect(maskPhpMarkdownMathForTableScan(source), `mask:${label}`).toContain("M_M");
			const scan = scanPhpCommonMarkBlocks(source);
			expect(scan.lines[0]?.inlineBlockId, `line0:${label}`).toBeGreaterThan(0);
			expect(scan.lines[1]?.inlineBlockId, `line1:${label}`).toBeGreaterThan(0);
			expect(scan.lines[2]?.inlineBlockId, `line2:${label}`).toBeGreaterThan(0);
		}

		// `<span $a$="1">` becomes `<span M_M="1">` (`_` valid in HTML attribute names -> Type 7 HTML block matching PHP).
		const attrHtml = '<span $a$="1">\n![a](/x.png)';
		const attrScan = scanPhpCommonMarkBlocks(attrHtml);
		expect(attrScan.lines[0]?.inlineBlockId).toBe(-1);
		expect(attrScan.lines[1]?.inlineBlockId).toBe(-1);

		// `<!$a$>` starts with ASCII letter `M` -> single-line Type 4 HTML declaration; following line stays a live paragraph.
		const declHtml = "<!$a$>\n![a](/x.png)";
		const declScan = scanPhpCommonMarkBlocks(declHtml);
		expect(declScan.lines[0]?.inlineBlockId).toBe(-1);
		expect(declScan.lines[1]?.inlineBlockId).toBeGreaterThan(0);
	});

	it("collects canonical PHP link reference definition labels while excluding code, HTML blocks, and invalid definitions", () => {
		expect(scanPhpCommonMarkReferenceLabels("plain text without definitions")).toEqual([]);
		expect(
			scanPhpCommonMarkReferenceLabels(
				[
					"[  X  ]: /x",
					"[foo",
					"bar]: /fb",
					"[a\\]b]: /esc",
					"[same-line-fail]: /u \"bad\" extra",
					"",
					"[two-line-ok]: /ok",
					"\"bad\" extra",
					"",
					"```",
					"[fenced]: /no",
					"```",
					"",
					"<div>",
					"[html]: /no",
					"</div>",
					"",
					"> [quoted]: /q",
					"",
					"- [listed]: /l",
					"",
					"<!-- $-->$",
					"[hidden-by-math-comment]: /no",
				].join("\n"),
			),
		).toEqual(["X  ", "foo\nbar", "a\\]b", "two-line-ok", "quoted", "listed"]);

		// Inline math inside a reference definition label becomes its PHP token, never matching literal `M_M`.
		expect(scanPhpCommonMarkReferenceLabels("[$a$]: /x")).toEqual([
			"EASYMDE_MATH_0_TOKEN",
		]);
	});

	it("assigns per-segment 4-pass PHP EASYMDE_MATH_<k>_TOKEN indices across single- and multi-segment documents (Round 27 Track A #6 + Track B F6)", () => {
		// Within one outside-code segment, PHP runs passes in order: $$ -> \[ -> \( -> $.
		const singleSeg = "$d$ \\(c\\) \\[b\\] $$a$$";
		expect(
			scanPhpMarkdownMathRanges(singleSeg).map((r) => ({
				text: singleSeg.slice(r.from, r.to),
				tokenIndex: r.tokenIndex,
			})),
		).toEqual([
			{ text: "$d$", tokenIndex: 3 },
			{ text: "\\(c\\)", tokenIndex: 2 },
			{ text: "\\[b\\]", tokenIndex: 1 },
			{ text: "$$a$$", tokenIndex: 0 },
		]);

		// Across code-separated segments, PHP processes segment 0 (all 4 passes) before segment 1 (all 4 passes).
		const multiSeg = "$a$ `code` $$b$$";
		expect(
			scanPhpMarkdownMathRanges(multiSeg).map((r) => ({
				text: multiSeg.slice(r.from, r.to),
				tokenIndex: r.tokenIndex,
			})),
		).toEqual([
			{ text: "$a$", tokenIndex: 0 },
			{ text: "$$b$$", tokenIndex: 1 },
		]);

		const multiSegMixed = "$s0_inline$ $$s0_block$$ `code` $s1_inline$ \\[s1_block\\]";
		expect(
			scanPhpMarkdownMathRanges(multiSegMixed).map((r) => ({
				text: multiSegMixed.slice(r.from, r.to),
				tokenIndex: r.tokenIndex,
			})),
		).toEqual([
			{ text: "$s0_inline$", tokenIndex: 1 },
			{ text: "$$s0_block$$", tokenIndex: 0 },
			{ text: "$s1_inline$", tokenIndex: 3 },
			{ text: "\\[s1_block\\]", tokenIndex: 2 },
		]);

		// Reference label scanning uses exact per-segment 4-pass PHP token indices.
		expect(
			scanPhpCommonMarkReferenceLabels(
				"![EASYMDE_MATH_1_TOKEN] ![ok](/i)\n\n[$a$]: /x\n\n$$b$$",
			),
		).toEqual(["EASYMDE_MATH_1_TOKEN"]);
		expect(
			scanPhpCommonMarkReferenceLabels(
				"![a][EASYMDE_MATH_1_TOKEN]\n\n[$a$]: /x.png\n$$b$$",
			),
		).toEqual(["EASYMDE_MATH_1_TOKEN"]);
		expect(
			scanPhpCommonMarkReferenceLabels(
				"![a][EASYMDE_MATH_0_TOKEN]\n\n[$a$]: /x.png\n\n`code`\n\n$$b$$",
			),
		).toEqual(["EASYMDE_MATH_0_TOKEN"]);
		expect(
			scanPhpCommonMarkReferenceLabels(
				"\\[a $$b$$ c\\]\n\n[$d$]: /x.png",
			),
		).toEqual(["EASYMDE_MATH_2_TOKEN"]);
	});
});
