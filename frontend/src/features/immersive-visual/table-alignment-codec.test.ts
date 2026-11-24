import { describe, expect, it } from "vitest";
import {
	parseMarkdownToVisualDoc,
	parseMarkdownWithBlockSources,
} from "./markdown-parser";
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

	it("separates a table alignment marker from an immediately preceding paragraph without merging", () => {
		const marker = '<!-- easymde-table-align:v1 [[0,"center"]] -->';
		const source = `Hello\n${marker}\n| A | B |\n| --- | --- |\n| 1 | 2 |`;

		const parsed = parseMarkdownWithBlockSources(source);
		expect(parsed.doc.childCount).toBe(2);

		const paragraph = parsed.doc.child(0);
		expect(paragraph.type.name).toBe("paragraph");
		expect(paragraph.textContent).toBe("Hello");

		const table = parsed.doc.child(1);
		expect(table.type.name).toBe("table");
		expect(table.attrs.alignAnnotation).toBe(marker);
		expect(table.child(0).child(0).attrs.textAlign).toBe("center");
		expect(table.child(0).child(1).attrs.textAlign).toBe("center");
		expect(table.child(1).child(0).attrs.textAlign).toBeNull();
		expect(table.child(1).child(1).attrs.textAlign).toBeNull();

		// Zero-write source-block projection retains the exact single-newline gap.
		expect(parsed.blocks).toHaveLength(2);
		expect(parsed.blocks[0]?.raw).toBe("Hello");
		expect(parsed.blocks[1]?.separatorBefore).toBe("\n");
		expect(parsed.blocks[1]?.raw).toBe(
			`${marker}\n| A | B |\n| --- | --- |\n| 1 | 2 |`,
		);

		// Also keep blockquote container continuity when separating inside a quote.
		const quoted = `> Hello\n> ${marker}\n> | A | B |\n> | --- | --- |\n> | 1 | 2 |`;
		const quotedDoc = parseMarkdownToVisualDoc(quoted);
		expect(quotedDoc.childCount).toBe(1);
		const blockquote = quotedDoc.child(0);
		expect(blockquote.type.name).toBe("blockquote");
		expect(blockquote.childCount).toBe(2);
		expect(blockquote.child(0).type.name).toBe("paragraph");
		expect(blockquote.child(0).textContent).toBe("Hello");
		expect(blockquote.child(1).type.name).toBe("table");
		expect(blockquote.child(1).attrs.alignAnnotation).toBe(marker);
		expect(blockquote.child(1).child(0).child(0).attrs.textAlign).toBe("center");
		expect(blockquote.child(1).child(0).child(1).attrs.textAlign).toBe("center");
	});

	it("attaches table alignment annotations to single-column outerless GFM tables", () => {
		const marker = '<!-- easymde-table-align:v1 [[0,"center"]] -->';
		const validCases = [
			{
				name: "leading-pipe single-column table",
				source: `${marker}\n| A\n| ---\n| 1`,
			},
			{
				name: "trailing-pipe single-column table",
				source: `${marker}\nA |\n--- |\n1 |`,
			},
			{
				name: "leading-pipe single-dash table",
				source: `${marker}\n| A\n| -\n| 1`,
			},
			{
				name: "trailing-pipe single-dash no-space table",
				source: `${marker}\nA |\n-|\n1 |`,
			},
		] as const;

		for (const testCase of validCases) {
			const preScan = prescanMarkdown(testCase.source);
			expect(preScan.tableAlignMarkers.size, testCase.name).toBe(1);

			const doc = parseMarkdownToVisualDoc(testCase.source);
			expect(doc.childCount, testCase.name).toBe(1);
			const table = doc.child(0);
			expect(table.type.name, testCase.name).toBe("table");
			expect(table.attrs.alignAnnotation, testCase.name).toBe(marker);
			expect(table.childCount, testCase.name).toBe(2);
			expect(table.child(0).child(0).textContent, testCase.name).toBe("A");
			expect(table.child(0).child(0).attrs.textAlign, testCase.name).toBe(
				"center",
			);
			expect(table.child(1).child(0).textContent, testCase.name).toBe("1");
			expect(table.child(1).child(0).attrs.textAlign, testCase.name).toBeNull();

			// Also verify immediately after a paragraph without a blank line.
			const afterParagraph = parseMarkdownToVisualDoc(
				`Hello\n${testCase.source}`,
			);
			expect(afterParagraph.childCount, `${testCase.name} after para`).toBe(2);
			expect(
				afterParagraph.child(0).textContent,
				`${testCase.name} after para`,
			).toBe("Hello");
			expect(
				afterParagraph.child(1).type.name,
				`${testCase.name} after para`,
			).toBe("table");
			expect(
				afterParagraph.child(1).attrs.alignAnnotation,
				`${testCase.name} after para`,
			).toBe(marker);
			expect(
				afterParagraph.child(1).child(0).child(0).attrs.textAlign,
				`${testCase.name} after para`,
			).toBe("center");
		}

		// `- |` starts a bullet list item in both PHP CommonMark and markdown-it,
		// so it must not be tokenized as a table alignment marker.
		const listLookalike = `${marker}\nA |\n- |\n1 |`;
		expect(prescanMarkdown(listLookalike).tableAlignMarkers.size).toBe(0);
	});
});
