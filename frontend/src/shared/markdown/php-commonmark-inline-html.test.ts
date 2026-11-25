import { describe, expect, it } from "vitest";

import {
	collectTableRowCells,
	createPhpInlineStream,
	parseGfmTableSeparatorAlignments,
	parseGfmTableSeparatorColumns,
	parsePhpInlineLinkTail,
	unescapeTableCellPipes,
} from "./php-commonmark-block-helpers";
import {
	findTableRowCellInCells,
	isRangeDroppedByPhpTable,
	scanPhpCommonMarkBlocks,
} from "./php-commonmark-block-scan";
import {
	collectGfmAutolinkStops,
	createInlineHtmlScanGuard,
	gfmAutolinkTrailingContext,
	gfmEmailAutolinkEnd,
	matchBlockInlineHtmlOrAutolink,
	matchCommonMarkAutolinkOnLine,
	matchGfmUrlAutolink,
	matchSingleLineInlineHtmlOrAutolink,
} from "./php-commonmark-inline-html";

describe("php-commonmark-inline-html watermarks and linear performance", () => {
	it("does not poison guard.noGtAfter across skipped quoted attribute values in single-line and block scans", () => {
		const singleCases = [
			'![a <b q="<https://example.com/](wrong)>](right)"',
			`<a b="<span title='![a](u)'>" c`,
			'<a b="<https://example.com/![a](u)>" c',
		] as const;

		for (const source of singleCases) {
			const guard = createInlineHtmlScanGuard();
			const firstLt = source.indexOf("<");
			const secondLt = source.indexOf("<", firstLt + 1);
			expect(
				matchSingleLineInlineHtmlOrAutolink(
					source,
					firstLt,
					guard,
					source.length,
				),
				`single firstLt: ${source}`,
			).toEqual({ status: "none" });
			expect(guard.noGtAfter, `single watermark: ${source}`).toBeGreaterThan(
				secondLt,
			);
			const secondMatch = matchSingleLineInlineHtmlOrAutolink(
				source,
				secondLt,
				guard,
				source.length,
			);
			expect(secondMatch.status, `single secondLt: ${source}`).toBe("ok");

			const blockGuard = createInlineHtmlScanGuard();
			const scanned = scanPhpCommonMarkBlocks(source);
			expect(
				matchBlockInlineHtmlOrAutolink(
					source,
					scanned.lines,
					0,
					firstLt,
					0,
					blockGuard,
				),
				`block firstLt: ${source}`,
			).toBeNull();
			expect(
				blockGuard.noGtAfter,
				`block watermark: ${source}`,
			).toBeGreaterThan(secondLt);
			const blockSecond = matchBlockInlineHtmlOrAutolink(
				source,
				scanned.lines,
				0,
				secondLt,
				0,
				blockGuard,
			);
			expect(blockSecond, `block secondLt: ${source}`).not.toBeNull();
		}

		// Multiline unclosed open tag whose quoted attribute spans lines and holds `>`
		const multiline = `<a b="<span\ntitle='![a](u)'>" c`;
		const multiScan = scanPhpCommonMarkBlocks(multiline);
		const multiGuard = createInlineHtmlScanGuard();
		const firstLt = multiline.indexOf("<");
		const secondLt = multiline.indexOf("<", firstLt + 1);
		expect(
			matchBlockInlineHtmlOrAutolink(
				multiline,
				multiScan.lines,
				0,
				firstLt,
				1,
				multiGuard,
			),
		).toBeNull();
		expect(multiGuard.noGtAfter).toBeGreaterThan(secondLt);
		const spanMatch = matchBlockInlineHtmlOrAutolink(
			multiline,
			multiScan.lines,
			0,
			secondLt,
			1,
			multiGuard,
		);
		expect(spanMatch).toEqual({
			pos: multiline.indexOf(">") + 1,
			segIdx: 1,
		});
	});

	it("scans pathological repeated `<`, `<a `, `<!--`, and `<?` lines in strictly linear time", () => {
		const payloads = [
			`![A ${"<".repeat(16_300)}](/x.png)`,
			`![A ${"<a ".repeat(4_000)}](/x.png)`,
			`![A ${"<!--".repeat(4_000)}](/x.png)`,
			`![A ${"<?".repeat(4_000)}](/x.png)`,
		];

		for (const payload of payloads) {
			const singleGuard = createInlineHtmlScanGuard();
			const t0 = performance.now();
			for (let pos = 0; pos < payload.length; pos += 1) {
				if ("<" === payload[pos]) {
					matchSingleLineInlineHtmlOrAutolink(
						payload,
						pos,
						singleGuard,
						payload.length,
					);
				}
			}
			expect(performance.now() - t0).toBeLessThan(250);

			const scanned = scanPhpCommonMarkBlocks(payload);
			const blockGuard = createInlineHtmlScanGuard();
			const t1 = performance.now();
			for (let pos = 0; pos < payload.length; pos += 1) {
				if ("<" === payload[pos]) {
					matchBlockInlineHtmlOrAutolink(
						payload,
						scanned.lines,
						0,
						pos,
						0,
						blockGuard,
					);
				}
			}
			expect(performance.now() - t1).toBeLessThan(250);
		}
	});

	it("splits GFM table rows into per-cell ranges matching PHP TableParser::split()", () => {
		const row = "| ` | ![alt](https://example.com/a.png) | ` |";
		const rowCells = collectTableRowCells(row, 0, row.length);
		expect(rowCells).toHaveLength(3);
		const imgPos = row.indexOf("![alt]");
		const cell = findTableRowCellInCells(rowCells, imgPos);
		expect(cell).not.toBeNull();
		if (cell) {
			expect(cell.cellIndex).toBe(1);
			expect(row.slice(cell.start, cell.end)).toBe(
				" ![alt](https://example.com/a.png) ",
			);
		}
		// Delimiter pipes themselves belong to no cell.
		expect(findTableRowCellInCells(rowCells, 0)).toBeNull();
		expect(findTableRowCellInCells(rowCells, 4)).toBeNull();

		// Escaped `\|` stays inside the same cell.
		const escaped = '| ![a\\|b](https://example.com/a.png "t\\|u {width=50%}") |';
		const escCells = collectTableRowCells(escaped, 0, escaped.length);
		expect(escCells).toHaveLength(1);
		const escCell = findTableRowCellInCells(escCells, escaped.indexOf("!["));
		expect(escCell).not.toBeNull();
		if (escCell) {
			expect(escCell.cellIndex).toBe(0);
			expect(escaped.slice(escCell.start, escCell.end)).toBe(
				' ![a\\|b](https://example.com/a.png "t\\|u {width=50%}") ',
			);
		}
	});

	it("enforces PHP TableParser headerColumnCount limits and pre-inline pipe unescaping", () => {
		const row = "| a | b | ![extra](https://example.org/i.png) |";
		const extraPos = row.indexOf("![extra]");
		const unlimitedCells = collectTableRowCells(row, 0, row.length);
		expect(findTableRowCellInCells(unlimitedCells, extraPos)).toMatchObject({
			cellIndex: 2,
		});
		const twoColCells = collectTableRowCells(row, 0, row.length, 2);
		expect(twoColCells).toHaveLength(2);
		expect(findTableRowCellInCells(twoColCells, extraPos)).toBeNull();
		expect(
			findTableRowCellInCells(twoColCells, row.indexOf("b")),
		).toMatchObject({
			cellIndex: 1,
		});
		const zeroColCells = collectTableRowCells(row, 0, row.length, 0);
		expect(zeroColCells).toEqual([]);
		expect(findTableRowCellInCells(zeroColCells, 2)).toBeNull();

		// Scan records headerColumnCount on both header and body rows, including asymmetric and 0-col tables.
		const asymmetric =
			"| A |\n| --- | --- |\n| 1 | ![dropped](https://example.com/dropped.png) |\n| ![real](https://example.com/real.png) |";
		const asymScan = scanPhpCommonMarkBlocks(asymmetric);
		expect(asymScan.lines.map((line) => line.tableColumnCount)).toEqual([
			1,
			null,
			1,
			1,
		]);
		const droppedFrom = asymmetric.indexOf("![dropped]");
		const droppedTo = asymmetric.indexOf(")", droppedFrom) + 1;
		const realFrom = asymmetric.indexOf("![real]");
		const realTo = asymmetric.indexOf(")", realFrom) + 1;
		expect(
			isRangeDroppedByPhpTable(asymmetric, asymScan, droppedFrom, droppedTo),
		).toBe(true);
		expect(
			isRangeDroppedByPhpTable(asymmetric, asymScan, realFrom, realTo),
		).toBe(false);

		const zeroCol = "|\n| --- |\n| ![dropped](https://example.com/dropped.png) |";
		const zeroScan = scanPhpCommonMarkBlocks(zeroCol);
		expect(zeroScan.lines.map((line) => line.tableColumnCount)).toEqual([
			0,
			null,
			0,
		]);
		const zeroFrom = zeroCol.indexOf("![dropped]");
		expect(
			isRangeDroppedByPhpTable(
				zeroCol,
				zeroScan,
				zeroFrom,
				zeroCol.indexOf(")", zeroFrom) + 1,
			),
		).toBe(true);

		expect(unescapeTableCellPipes("a\\|b")).toBe("a|b");
		expect(unescapeTableCellPipes("a\\\\|b")).toBe("a\\|b");
		expect(unescapeTableCellPipes("a\\\\\\|b")).toBe("a\\\\|b");
	});
});

describe("canonical PHP CommonMark table-separator and autolink exports (Round 30 Track B F6/F8a)", () => {
	it("parses GFM separator alignments once and derives the column count from them", () => {
		for (const [line, alignments] of [
			["| --- | :-- | --: | :-: |", [null, "left", "right", "center"]],
			["---|:---:", [null, "center"]],
			["|", []],
			["| :- |\t-", ["left", null]],
			["| | --- |", null],
			["--- ---", null],
			["| :: |", null],
			["| --- | x |", null],
			["", null],
		] as const) {
			expect(parseGfmTableSeparatorAlignments(line), line).toEqual(alignments);
			expect(parseGfmTableSeparatorColumns(line), line).toBe(alignments?.length ?? 0);
		}
	});

	it("matches CommonMark §6.5 URI and email autolinks within one line", () => {
		for (const [source, end] of [
			["<https://a.com/b>", 17],
			["<mailto:a@b.c>", 14],
			["<a@b.c>", 7],
			["<!@example.com>", 15],
			["<a@b!c>", -1],
			["<www.example.com>", -1],
			["<a@b.c_>", -1],
			["<https://a.com b>", -1],
			["<x:>", -1],
		] as const) {
			expect(matchCommonMarkAutolinkOnLine(source, 0, source.length), source).toBe(end);
		}
		expect(matchCommonMarkAutolinkOnLine("<https://a.com>", 0, 10)).toBe(-1);
	});

	it("mirrors PHP GFM email and URL autolink stops and consumed ranges", () => {
		const stops = collectGfmAutolinkStops("x a@b.c_/d@e.f http://www.q.r", 2, 29);
		expect([...stops.emails]).toEqual([[2, 8], [9, 14]]);
		expect([...stops.urls]).toEqual([15, 22]);
		expect(gfmEmailAutolinkEnd("a@b.c_", 6)).toBe(-1);
		expect(gfmEmailAutolinkEnd("a@b.c.", 6)).toBe(5);
		for (const [source, consumed] of [
			["https://example.)", "https://example"],
			["https://a.com/b,:", "https://a.com/b"],
			["https://a.com/(x))", "https://a.com/(x)"],
			["https://a.com/a&amp;", "https://a.com/a"],
			["www.a.b-c", "www.a.b"],
			// PCRE possessive punycode `*+` falls through to the multi-level label.
			["https://xn--a.xn--b.)", "https://xn--a.xn"],
			["https://[::1]:8/p?q=[1]#f.", "https://[::1]:8/p?q=[1]#f"],
			["ftp://例子.测试/路径", "ftp://例子.测试/路径"],
		] as const) {
			expect(source.slice(0, matchGfmUrlAutolink(source, 0)), source).toBe(consumed);
		}
		expect(matchGfmUrlAutolink("https://", 0)).toBe(-1);
	});

	it("scans GFM email autolink stops linearly without quadratic regex backtracking (Round 31 Track B F7a)", () => {
		const emailRe = /[A-Za-z0-9.\-_+]+@[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.]+/g;
		const equivalenceInputs = [
			"a@b.c",
			"a@b@c.d",
			"a@b.c@d.e",
			"a@b.c+d@e.f",
			"a@b..c",
			"a@.b.c",
			"a@b.",
			"a@b.c_@d.e",
			"a@b.c_/d@e.f",
			"@a.b a@b a.b+c_d-e@f-g_h.i.j_ -@x.y",
			"prefix a@b.c. suffix",
		];
		for (const input of equivalenceInputs) {
			const expected = Array.from(input.matchAll(emailRe)).map((match) => [
				match.index ?? 0,
				(match.index ?? 0) + match[0].length,
			]);
			const stops = collectGfmAutolinkStops(input, 0, input.length);
			expect([...stops.emails], input).toEqual(expected);
		}

		// Adversarial 30,000-char local-part runs without `@`, repeated `@`, and long non-matching domains.
		const payloads = [
			`x@y.z ${"a".repeat(30_000)}!`,
			`${"a".repeat(30_000)}@`,
			`${"a@".repeat(15_000)}x@y.z`,
			`${"a.b+c_d-".repeat(4_000)}!`,
		];
		for (const payload of payloads) {
			const started = performance.now();
			const stops = collectGfmAutolinkStops(payload, 0, payload.length);
			expect(performance.now() - started, payload.slice(0, 24)).toBeLessThan(
				1_000,
			);
			expect(stops.emails.size).toBeLessThanOrEqual(1);
		}
	});

	it("extracts minimal trailing parsing context for bare GFM URL and email autolinks (Round 31 Track A #4)", () => {
		for (const [source, candidate, expected] of [
			["![$$x$$](https://x?)", "https://x?", ")"],
			["(https://x?)", "https://x?", ")"],
			["(https://a.com/b,)", "https://a.com/b,", ")"],
			["(https://a.com/b:)", "https://a.com/b:", ")"],
			["(https://a.com/x!)", "https://a.com/x!", ")"],
			["(www.example.com?)", "www.example.com?", ")"],
			["(https://a.com/a&amp;)", "https://a.com/a&amp;", ")"],
			["![$$x$$](https://a.com/b?))", "https://a.com/b?", "))"],
			["![$$x$$](https://example.)", "https://example", ""],
			["![$$x$$](https://x!)", "https://x", ""],
			["![$$x$$](https://a.com/(x)))", "https://a.com/(x)", ""],
			["https://x?", "https://x?", ""],
			["https://x? tail", "https://x?", ""],
			["![$$x$$](a@b.c.)", "a@b.c", ""],
			["![$$x$$](a@b.c_.)", "a@b.c_", "."],
			["![$$x$$](a@b.c-.)", "a@b.c-", "."],
			["![$$x$$](a@b.c..)", "a@b.c.", "."],
			["a@b.c_.x", "a@b.c_", ""],
			["a@b.c_", "a@b.c_", ""],
		] as const) {
			const from = source.indexOf(candidate);
			expect(
				gfmAutolinkTrailingContext(source, from, from + candidate.length),
				`${source} :: ${candidate}`,
			).toBe(expected);
		}
	});

	it("skips leading tabs on paragraph continuation lines while keeping same-line tabs rejected (Round 31 Track B F9)", () => {
		const parseTail = (source: string): string | null => {
			const scan = scanPhpCommonMarkBlocks(source);
			const stream = createPhpInlineStream(source, scan.lines, scan.lines.length - 1);
			const openParen = source.indexOf("(");
			const end = parsePhpInlineLinkTail(source, stream, { p: openParen, s: 0 });
			return end ? source.slice(openParen, end.p) : null;
		};

		expect(parseTail('(/rel\n\t"title")')).toBe('(/rel\n\t"title")');
		expect(parseTail('(/rel\n \t "title")')).toBe('(/rel\n \t "title")');
		expect(parseTail("(\n\t/rel)")).toBe("(\n\t/rel)");
		expect(parseTail("(/rel\n\t)")).toBe("(/rel\n\t)");
		expect(parseTail('(/rel "title"\n\t)')).toBe('(/rel "title"\n\t)');
		// Same-line tabs before title, destination, newline, or closing paren remain rejected.
		expect(parseTail('(/rel\t"title")')).toBeNull();
		expect(parseTail('(/rel \t"title")')).toBeNull();
		expect(parseTail('(/rel\t\n"title")')).toBeNull();
		expect(parseTail("(\t/rel)")).toBeNull();
		expect(parseTail('(/rel "title"\t)')).toBeNull();
	});
});
