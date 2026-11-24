import { describe, expect, it } from "vitest";
import { prescanMarkdown } from "./markdown-prescanner";
import {
	parseTableAlignComment,
	reconcileTableAlignComment,
	validateTableAlignEntries,
} from "./table-alignment-codec";

describe("immersive-visual table alignment codec and prescanner parity", () => {
	const tableLines = "| A | B |\n| - | - |\n| 1 | 2 |";

	it("accepts PHP-valid marker lines with 0-3 leading spaces and trailing ASCII spaces", () => {
		for (const candidate of [
			'<!-- easymde-table-align:v1 [[0,"center"]] -->',
			'   <!-- easymde-table-align:v1 [[0,"center"]] -->   ',
			'<!-- easymde-table-align:v1 [[1.0,"right"]] -->',
		]) {
			expect(parseTableAlignComment(candidate), candidate).not.toBeNull();
		}
		expect(
			parseTableAlignComment('<!-- easymde-table-align:v1 [[1.0,"right"]] -->'),
		).toEqual([[1, "right"]]);
	});

	it("rejects trailing/leading NBSP, 4+ leading spaces, tabs, >4096 UTF-8 bytes, and unsafe integers", () => {
		const oversizedUtf8 = `<!-- easymde-table-align:v1 "${"中".repeat(1400)}" -->`;
		expect(oversizedUtf8.length).toBeLessThanOrEqual(4096);

		const invalidComments = [
			// Trailing NBSP (PHP trim($literal, ' ') keeps NBSP so suffix check fails).
			'<!-- easymde-table-align:v1 [[0,"center"]] -->\u00a0',
			// Leading NBSP (not a reserved marker prefix in PHP).
			'\u00a0<!-- easymde-table-align:v1 [[0,"center"]] -->',
			// 4+ leading spaces or leading tab (indented code in PHP).
			'    <!-- easymde-table-align:v1 [[0,"center"]] -->',
			'\t<!-- easymde-table-align:v1 [[0,"center"]] -->',
			' \t<!-- easymde-table-align:v1 [[0,"center"]] -->',
			// Trailing or internal tab (rejected anywhere in marker in PHP).
			'<!-- easymde-table-align:v1 [[0,"center"]] -->\t',
			'<!-- easymde-table-align:v1 [\t[0,"center"]] -->',
			// Exceeds 4096 UTF-8 bytes despite <= 4096 UTF-16 code units.
			oversizedUtf8,
			// Non-safe integer index (> Number.MAX_SAFE_INTEGER = 9007199254740991).
			'<!-- easymde-table-align:v1 [[9007199254740992,"center"]] -->',
			'<!-- easymde-table-align:v1 [[0,9007199254740992,"center"]] -->',
			// Non-integer float.
			'<!-- easymde-table-align:v1 [[1.5,"center"]] -->',
		];

		for (const comment of invalidComments) {
			expect(parseTableAlignComment(comment), JSON.stringify(comment)).toBeNull();
		}
	});

	it("prescanner tokenizes only PHP-valid markers and rejects NBSP, tab, >3-space, and oversized lines", () => {
		const validPrescan = prescanMarkdown(
			`   <!-- easymde-table-align:v1 [[0,"center"]] -->   \n${tableLines}`,
		);
		expect(validPrescan.tableAlignMarkers.size).toBe(1);
		expect([...validPrescan.tableAlignMarkers.values()]).toEqual([
			'<!-- easymde-table-align:v1 [[0,"center"]] -->',
		]);

		const oversizedUtf8 = `<!-- easymde-table-align:v1 "${"中".repeat(1400)}" -->`;
		const rejectedMarkerLines = [
			'<!-- easymde-table-align:v1 [[0,"center"]] -->\u00a0',
			'\u00a0<!-- easymde-table-align:v1 [[0,"center"]] -->',
			'<!-- easymde-table-align:v1 [[0,"center"]] -->\t',
			'<!-- easymde-table-align:v1 [\t[0,"center"]] -->',
			'    <!-- easymde-table-align:v1 [[0,"center"]] -->',
			'\t<!-- easymde-table-align:v1 [[0,"center"]] -->',
			oversizedUtf8,
		];

		for (const markerLine of rejectedMarkerLines) {
			const topLevel = prescanMarkdown(`${markerLine}\n${tableLines}`);
			expect(
				topLevel.tableAlignMarkers.size,
				`top-level: ${JSON.stringify(markerLine)}`,
			).toBe(0);

			// Also verify after an open paragraph where indented code does not trigger.
			const afterParagraph = prescanMarkdown(
				`Paragraph\n${markerLine}\n${tableLines}`,
			);
			expect(
				afterParagraph.tableAlignMarkers.size,
				`after paragraph: ${JSON.stringify(markerLine)}`,
			).toBe(0);
		}
	});

	it("validates entries and reconciles comments using the shared grammar", () => {
		const snapshot = {
			baseAlignments: ["left", "right"] as const,
			cellAlignments: [
				["center", "center"],
				["left", "right"],
			] as const,
			columnCount: 2,
			rowCount: 2,
		};

		expect(validateTableAlignEntries([[0, "center"]], snapshot)).toBe(true);
		expect(
			validateTableAlignEntries([[9007199254740992, "center"]], snapshot),
		).toBe(false);
		expect(
			reconcileTableAlignComment(
				'<!-- easymde-table-align:v1 [[0,"center"]] -->\u00a0',
				snapshot,
			),
		).toBe('<!-- easymde-table-align:v1 [[0,"center"]] -->');
	});
});
