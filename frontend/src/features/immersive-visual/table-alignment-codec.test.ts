import { describe, expect, it } from "vitest";
import {
	parseMarkdownToVisualDoc,
	parseMarkdownWithBlockSources,
} from "./markdown-parser";
import { prescanMarkdown } from "./markdown-prescanner";
import { serializeVisualDocToMarkdown } from "./markdown-serializer";
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

	it("preserves tight lists containing a paragraph followed by an annotated GFM table", () => {
		const marker = '<!-- easymde-table-align:v1 [[0,"center"]] -->';
		const tightListSource = [
			"- Para",
			`  ${marker}`,
			"  | A | B |",
			"  | --- | --- |",
			"  | 1 | 2 |",
			"- Next",
		].join("\n");

		const doc = parseMarkdownToVisualDoc(tightListSource);
		expect(doc.childCount).toBe(1);
		const list = doc.child(0);
		expect(list.type.name).toBe("bullet_list");
		expect(list.attrs.tight).toBe(true);
		expect(list.childCount).toBe(2);

		const firstItem = list.child(0);
		expect(firstItem.childCount).toBe(2);
		expect(firstItem.child(0).type.name).toBe("paragraph");
		expect(firstItem.child(0).textContent).toBe("Para");
		const table = firstItem.child(1);
		expect(table.type.name).toBe("table");
		expect(table.attrs.alignAnnotation).toBe(marker);
		expect(table.child(0).child(0).attrs.textAlign).toBe("center");
		expect(table.child(0).child(1).attrs.textAlign).toBe("center");

		const serialized = serializeVisualDocToMarkdown(doc);
		expect(serialized).toBe(tightListSource);
		expect(parseMarkdownToVisualDoc(serialized).eq(doc)).toBe(true);

		// Also works in an ordered list with a 4-column content indent.
		const orderedTight = [
			"10. Para",
			`    ${marker}`,
			"    | A | B |",
			"    | --- | --- |",
			"    | 1 | 2 |",
			"11. Next",
		].join("\n");
		const orderedDoc = parseMarkdownToVisualDoc(orderedTight);
		expect(orderedDoc.firstChild?.type.name).toBe("ordered_list");
		expect(orderedDoc.firstChild?.attrs.tight).toBe(true);
		expect(orderedDoc.firstChild?.firstChild?.child(1).type.name).toBe("table");
		expect(
			orderedDoc.firstChild?.firstChild?.child(1).attrs.alignAnnotation,
		).toBe(marker);
	});

	it("rejects indented code blocks, column-count mismatches, and mismatched container prefixes from TBLALIGN", () => {
		const marker = '<!-- easymde-table-align:v1 [[0,"center"]] -->';

		for (const indentedSource of [
			`${marker}\n    | A | B |\n    | --- | --- |`,
			`${marker}\n\t| A | B |\n\t| --- | --- |`,
		]) {
			expect(
				prescanMarkdown(indentedSource).tableAlignMarkers.size,
				indentedSource,
			).toBe(0);
			const doc = parseMarkdownToVisualDoc(indentedSource);
			expect(doc.childCount, indentedSource).toBe(2);
			expect(doc.child(0).type.name, indentedSource).toBe("protected_block");
			expect(doc.child(0).attrs.rawMarkdown, indentedSource).toBe(marker);
			expect(doc.child(1).type.name, indentedSource).toBe("code_block");
			expect(doc.child(1).textContent, indentedSource).toBe(
				"| A | B |\n| --- | --- |",
			);
			const serialized = serializeVisualDocToMarkdown(doc);
			expect(serialized, indentedSource).not.toContain("\\<!--");
			expect(serialized, indentedSource).toContain(marker);
		}

		for (const mismatchSource of [
			`${marker}\n| A | B | C |\n| --- | --- |`,
			`${marker}\n| A | B |\n| --- | --- | --- |`,
		]) {
			expect(
				prescanMarkdown(mismatchSource).tableAlignMarkers.size,
				mismatchSource,
			).toBe(0);
			const doc = parseMarkdownToVisualDoc(mismatchSource);
			expect(doc.childCount, mismatchSource).toBe(2);
			expect(doc.child(0).type.name, mismatchSource).toBe("protected_block");
			expect(doc.child(0).attrs.rawMarkdown, mismatchSource).toBe(marker);
			expect(doc.child(1).type.name, mismatchSource).toBe("paragraph");
			const serialized = serializeVisualDocToMarkdown(doc);
			expect(serialized, mismatchSource).not.toContain("\\<!--");
			expect(serialized, mismatchSource).toContain(marker);
		}

		// Blockquote prefix mismatch or list-item header must not attach TBLALIGN.
		for (const mismatchedContainer of [
			`${marker}\n> | A | B |\n> | --- | --- |`,
			`> ${marker}\n> | A | B |\n| --- | --- |`,
			`${marker}\n- | A |\n| --- | --- |`,
		]) {
			expect(
				prescanMarkdown(mismatchedContainer).tableAlignMarkers.size,
				mismatchedContainer,
			).toBe(0);
		}
	});

	it("separates tables in tight lists when a stale alignAnnotation drops or a following block starts with a pipe", () => {
		const marker = '<!-- easymde-table-align:v1 [[0,"center"]] -->';
		// 1. Two tables in a tight list where Table 2 has a stale alignAnnotation
		// that `reconcileTableAlignComment` drops after its cells match base alignment.
		const twoTablesTight = [
			"- Para",
			"  | A | B |",
			"  | --- | --- |",
			"  | 1 | 2 |",
			`  ${marker}`,
			"  | C | D |",
			"  | --- | --- |",
			"  | 3 | 4 |",
			"- Next",
		].join("\n");
		const parsedTwo = parseMarkdownToVisualDoc(twoTablesTight);
		const list = parsedTwo.firstChild;
		expect(list?.type.name).toBe("bullet_list");
		expect(list?.attrs.tight).toBe(true);
		const firstItem = list?.firstChild;
		expect(firstItem?.childCount).toBe(3);
		const table2 = firstItem?.child(2);
		expect(table2?.type.name).toBe("table");
		expect(table2?.attrs.alignAnnotation).toBe(marker);
		if (!list || !firstItem || !table2) {
			throw new Error("missing expected tight list tables");
		}

		// Clear Table 2 header cell alignments back to base (null) while leaving
		// the stale `alignAnnotation` attribute on the table node.
		const clearedHeaderCells = [];
		for (let c = 0; c < table2.child(0).childCount; c += 1) {
			const cell = table2.child(0).child(c);
			clearedHeaderCells.push(
				cell.type.create({ ...cell.attrs, textAlign: null }, cell.content),
			);
		}
		const clearedTable2 = table2.type.create(table2.attrs, [
			table2.child(0).type.create(table2.child(0).attrs, clearedHeaderCells),
			table2.child(1),
		]);
		const updatedItem = firstItem.type.create(firstItem.attrs, [
			firstItem.child(0),
			firstItem.child(1),
			clearedTable2,
		]);
		const updatedDoc = parsedTwo.type.create(parsedTwo.attrs, [
			list.type.create(list.attrs, [updatedItem, list.child(1)]),
		]);
		const serializedTwo = serializeVisualDocToMarkdown(updatedDoc);
		expect(serializedTwo).not.toContain(marker);
		expect(serializedTwo).toContain("| 1 | 2 |\n\n  | C | D |");
		const reparsedTwo = parseMarkdownToVisualDoc(serializedTwo);
		expect(reparsedTwo.firstChild?.firstChild?.childCount).toBe(3);
		expect(reparsedTwo.firstChild?.firstChild?.child(1).type.name).toBe("table");
		expect(reparsedTwo.firstChild?.firstChild?.child(2).type.name).toBe("table");

		// 2. Pipe-bearing heading (or blockquote) immediately after a table in a
		// tight list must be separated by a blank line so PHP TableParser does not
		// swallow it into the table.
		const tableThenHeadingPipe = parseMarkdownToVisualDoc(
			[
				"- Para",
				"  | A | B |",
				"  | --- | --- |",
				"  | 1 | 2 |",
				"  # Plain heading",
			].join("\n"),
		);
		const tightList = tableThenHeadingPipe.firstChild;
		const tightItem = tightList?.firstChild;
		expect(tightList?.attrs.tight).toBe(true);
		expect(tightItem?.childCount).toBe(3);
		// Plain heading without `|` stays tight.
		expect(serializeVisualDocToMarkdown(tableThenHeadingPipe)).toContain(
			"| 1 | 2 |\n  # Plain heading",
		);
		if (!tightList || !tightItem) {
			throw new Error("missing tight list");
		}
		const headingNode = tightItem.child(2);
		const pipeHeading = headingNode.type.create(
			headingNode.attrs,
			headingNode.type.schema.text("Heading | pipe"),
		);
		const pipeHeadingDoc = tableThenHeadingPipe.type.create(null, [
			tightList.type.create(tightList.attrs, [
				tightItem.type.create(tightItem.attrs, [
					tightItem.child(0),
					tightItem.child(1),
					pipeHeading,
				]),
			]),
		]);
		const serializedPipeHeading = serializeVisualDocToMarkdown(pipeHeadingDoc);
		expect(serializedPipeHeading).toContain("| 1 | 2 |\n\n  # Heading | pipe");
		const reparsedPipeHeading = parseMarkdownToVisualDoc(serializedPipeHeading);
		expect(reparsedPipeHeading.firstChild?.firstChild?.child(2).type.name).toBe(
			"heading",
		);
		expect(
			reparsedPipeHeading.firstChild?.firstChild?.child(2).textContent,
		).toBe("Heading | pipe");
	});
});
