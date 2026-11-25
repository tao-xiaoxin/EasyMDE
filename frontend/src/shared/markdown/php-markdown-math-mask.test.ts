import { describe, expect, it } from "vitest";

import {
	isRangeDroppedByPhpTable,
	scanPhpCommonMarkBlocks,
} from "./php-commonmark-block-scan";
import { maskPhpMarkdownMathForTableScan } from "./php-markdown-math-mask";

describe("maskPhpMarkdownMathForTableScan", () => {
	it("fast-paths strings without math delimiters or without table-affecting math", () => {
		const plain = "| A | B |\n| --- | --- |\n| 1 | 2 |";
		expect(maskPhpMarkdownMathForTableScan(plain)).toBe(plain);

		const inlineNoPipe = "| A | B |\n| --- | --- |\n| $x + y$ | \\(z\\) |";
		expect(maskPhpMarkdownMathForTableScan(inlineNoPipe)).toBe(inlineNoPipe);

		const knownInlineNoPipe = maskPhpMarkdownMathForTableScan(inlineNoPipe, [
			{ block: false, from: inlineNoPipe.indexOf("$x"), to: inlineNoPipe.indexOf("$ |") + 1 },
		]);
		expect(knownInlineNoPipe).toBe(inlineNoPipe);
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
			"| A | B |\n| --- | --- |\n| MMMMM | ![img](https://example.com/a.png) |",
		);

		const inlineParen = "| A | B |\n| --- | --- |\n| \\(a|b\\) | ![img](https://example.com/a.png) |";
		const maskedParen = maskPhpMarkdownMathForTableScan(inlineParen);
		expect(maskedParen.length).toBe(inlineParen.length);
		expect(maskedParen).toBe(
			"| A | B |\n| --- | --- |\n| MMMMMMM | ![img](https://example.com/a.png) |",
		);

		const multilineParen = "| A | B |\n| --- | --- |\n| \\(a\n|b\\) | ![img](https://example.com/a.png) |";
		const maskedMulti = maskPhpMarkdownMathForTableScan(multilineParen);
		expect(maskedMulti.length).toBe(multilineParen.length);
		expect(maskedMulti).toBe(
			"| A | B |\n| --- | --- |\n| MMM\nMMMM | ![img](https://example.com/a.png) |",
		);
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
		expect(maskedFenced).toContain("| MMMMM | ![img](/a.png) |");

		const indentedCode = "    $a|b$\n\n| A | B |\n| --- | --- |\n| $c|d$ | ![img](/a.png) |";
		const maskedIndented = maskPhpMarkdownMathForTableScan(indentedCode);
		expect(maskedIndented.startsWith("    $a|b$\n\n")).toBe(true);
		expect(maskedIndented).toContain("| MMMMM | ![img](/a.png) |");

		const escapedDollar = "| A | B |\n| --- | --- |\n| \\$a|b\\$ | ![img](/a.png) |";
		expect(maskPhpMarkdownMathForTableScan(escapedDollar)).toBe(escapedDollar);

		// Unclosed backtick separated by a fenced code block does not swallow math after the fence.
		const unclosedBeforeFence = "`open\n```\ncode\n```\n| A | B |\n| --- | --- |\n| $a|b$ | ![img](/a.png) |";
		expect(maskPhpMarkdownMathForTableScan(unclosedBeforeFence)).toContain(
			"| MMMMM | ![img](/a.png) |",
		);

		// Escaped first backtick of a 2-backtick run opens a 1-backtick code span matching PHP.
		const escapedLeadingTick = "| A | B |\n| --- | --- |\n| \\``$a|b$` | ![img](/a.png) |";
		expect(maskPhpMarkdownMathForTableScan(escapedLeadingTick)).toBe(escapedLeadingTick);
	});

	it("preserves PHP sequential pattern precedence and supports precomputed knownRanges", () => {
		const parenContainsDollar = "| A | B |\n| --- | --- |\n| \\(a $ b\\) | $c|d$ |";
		expect(maskPhpMarkdownMathForTableScan(parenContainsDollar)).toBe(
			"| A | B |\n| --- | --- |\n| MMMMMMMMM | MMMMM |",
		);

		const source = "| A |\n| - |\n| $a|b$ ![x](/i) |";
		const mathFrom = source.indexOf("$a|b$");
		const knownMasked = maskPhpMarkdownMathForTableScan(source, [
			{ block: false, from: mathFrom, to: mathFrom + 5 },
		]);
		expect(knownMasked).toBe("| A |\n| - |\n| MMMMM ![x](/i) |");
	});
});
