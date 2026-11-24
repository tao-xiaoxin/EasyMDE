import { describe, expect, it } from "vitest";

import { findTableRowCellAt } from "./php-commonmark-block-helpers";
import { scanPhpCommonMarkBlocks } from "./php-commonmark-block-scan";
import {
	createInlineHtmlScanGuard,
	matchBlockInlineHtmlOrAutolink,
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
		const imgPos = row.indexOf("![alt]");
		const cell = findTableRowCellAt(row, 0, row.length, imgPos);
		expect(cell).not.toBeNull();
		if (cell) {
			expect(row.slice(cell.start, cell.end)).toBe(
				" ![alt](https://example.com/a.png) ",
			);
		}
		// Delimiter pipes themselves belong to no cell.
		expect(findTableRowCellAt(row, 0, row.length, 0)).toBeNull();
		expect(findTableRowCellAt(row, 0, row.length, 4)).toBeNull();

		// Escaped `\|` stays inside the same cell.
		const escaped = '| ![a\\|b](https://example.com/a.png "t\\|u {width=50%}") |';
		const escCell = findTableRowCellAt(
			escaped,
			0,
			escaped.length,
			escaped.indexOf("!["),
		);
		expect(escCell).not.toBeNull();
		if (escCell) {
			expect(escaped.slice(escCell.start, escCell.end)).toBe(
				' ![a\\|b](https://example.com/a.png "t\\|u {width=50%}") ',
			);
		}
	});
});
