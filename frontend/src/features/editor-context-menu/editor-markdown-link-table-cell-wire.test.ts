import { describe, expect, it } from "vitest";

import {
	EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE,
	EDITOR_BLOCK_INDEX_PACKED_V3_WITH_TABLE_CELLS_KEYS,
	type EditorMarkdownBlockIndexPackedData,
	hasExactEditorBlockIndexPackedKeys,
	packEditorMarkdownLinkTableCells,
	unpackEditorMarkdownLinkTableCells,
} from "../../contracts/ports/editor-block-index-port";
import { createEditorMarkdownBlockIndex } from "./editor-markdown-block-index";

function build(source: string) {
	return createEditorMarkdownBlockIndex(source, {
		referenceLabelCaseFoldProfile: 14,
	});
}

function basePackedPayload(sourceLength: number): EditorMarkdownBlockIndexPackedData {
	return {
		blockCount: 0,
		blocks: new Int32Array().buffer,
		format: "packed-v3",
		imageCount: 0,
		images: new Int32Array().buffer,
		length: sourceLength,
		linkCount: 0,
		links: new Int32Array().buffer,
		mathSpanCount: 0,
		mathSpans: new Int32Array().buffer,
	};
}

describe("editor markdown link table-cell wire", () => {
	it("omits the wire payload when no candidate lies in a table cell and accepts 10-key payloads", () => {
		const source = "[a](/u) https://example.com";
		const index = build(source);
		const base = basePackedPayload(source.length);
		expect(EDITOR_BLOCK_INDEX_PACKED_V3_WITH_TABLE_CELLS_KEYS).toHaveLength(12);
		expect(hasExactEditorBlockIndexPackedKeys(base)).toBe("base");
		expect(
			hasExactEditorBlockIndexPackedKeys({
				...base,
				linkTableCellCount: 1,
				linkTableCells: new Int32Array(3).buffer,
			}),
		).toBe("with-table-cells");
		expect(
			hasExactEditorBlockIndexPackedKeys({ ...base, linkTableCellCount: 1 }),
		).toBeNull();
		expect(
			hasExactEditorBlockIndexPackedKeys({ ...base, extra: 1 }),
		).toBeNull();
		expect(packEditorMarkdownLinkTableCells(undefined)).toBeNull();
		expect(packEditorMarkdownLinkTableCells(index.linkTableCells)).toBeNull();
		expect(
			unpackEditorMarkdownLinkTableCells(
				source,
				index.linkCandidates ?? [],
				index.blocks,
				base,
			),
		).toBeUndefined();
	});

	it.each([
		"| [a](/x\\|y) | [b](/u\\|v) |\n| - | - |",
		"| [x](https://example.com/a\\\\|b) $y$ | https://c.example |\n| - | - |",
		"10. item\n\n    | a | b |\n    | - | - |\n    | [x][a\\|b] | c |\n\n[a|b]: https://example.com/ok",
		"| [x][a\\|b] \\(a\nb\\) \\(c\nd\\) | col2 |\n| --- | --- |\n\n[a|b]: https://example.com/ok",
		// Round 36 Track B Finding 3: cross-block multiline `\(...\)` PHP table cells (Inputs A–E + CRLF)
		'[r]: /u "\\(a"\nb\\) [x][a\\|b] | c |\n| --- | --- |\n\n[a|b]: https://example.com/ok',
		"| [x][a\\|b] \\(m\n\nn\\) | c |\n| --- | --- |\n\n[a|b]: https://example.com/ok",
		"| [x](https://example.com/1\\\\|2) \\(m\n\nn\\) | c |\n| --- | --- |",
		"| [x](https://example.com/1\\\\|2) \\(m\n# h\nn\\) | c |\n| --- | --- |",
		'[r]: /u "\\(a"\nb\\) [x](https://example.com/1\\\\|2) | c |\n| --- | --- |',
		"| [x][a\\|b] \\(m\r\n\r\nn\\) | c |\r\n| --- | --- |\r\n\r\n[a|b]: https://example.com/ok",
	])("round-trips the textless 3-int wire format identically to direct index %#", (source) => {
		const index = build(source);
		const wire = packEditorMarkdownLinkTableCells(index.linkTableCells);
		if (!wire) throw new Error("wire-missing");
		expect(Object.keys(wire).sort()).toEqual([
			"linkTableCellCount",
			"linkTableCells",
		]);
		expect(wire.linkTableCellCount).toBe(index.linkTableCells?.size);
		expect(wire.linkTableCells.byteLength).toBe(
			wire.linkTableCellCount * EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE * 4,
		);
		const payload: EditorMarkdownBlockIndexPackedData = {
			...basePackedPayload(source.length),
			linkTableCellCount: wire.linkTableCellCount,
			linkTableCells: wire.linkTableCells,
		};
		expect(Object.keys(payload)).toHaveLength(12);
		expect(
			unpackEditorMarkdownLinkTableCells(
				source,
				index.linkCandidates ?? [],
				index.blocks,
				payload,
			),
		).toEqual(index.linkTableCells);
	});

	it("rejects forged table cells on plain paragraphs, truncated real table cells, and non-table rows (Round 36 Track A #1)", () => {
		// Repro 1: plain paragraph with `\\|` forged as table cell `[0, 0, 11]`
		const plainPipe = "[a](/x\\\\|y)";
		const plainPipeIdx = build(plainPipe);
		expect(plainPipeIdx.linkTableCells?.size).toBe(0);
		expect(
			unpackEditorMarkdownLinkTableCells(
				plainPipe,
				plainPipeIdx.linkCandidates ?? [],
				plainPipeIdx.blocks,
				{
					...basePackedPayload(plainPipe.length),
					linkTableCellCount: 1,
					linkTableCells: Int32Array.from([0, 0, plainPipe.length]).buffer,
				},
			),
		).toBeNull();

		// Plain paragraph without any pipe forged as table cell
		const plainNoPipe = "[a](/x)";
		const plainNoPipeIdx = build(plainNoPipe);
		expect(
			unpackEditorMarkdownLinkTableCells(
				plainNoPipe,
				plainNoPipeIdx.linkCandidates ?? [],
				plainNoPipeIdx.blocks,
				{
					...basePackedPayload(plainNoPipe.length),
					linkTableCellCount: 1,
					linkTableCells: Int32Array.from([0, 0, plainNoPipe.length]).buffer,
				},
			),
		).toBeNull();

		// Repro 2: truncated or shifted cell boundaries inside a real PHP table cell
		const realTable = "| [a](/x\\\\|y) tail | c |\n| - | - |";
		const realTableIdx = build(realTable);
		const realCandidate = realTableIdx.linkCandidates?.[0];
		const realCell = realCandidate
			? realTableIdx.linkTableCells?.get(realCandidate.from)
			: undefined;
		if (!realCandidate || !realCell) throw new Error("real-cell-missing");
		for (const tamperedRange of [
			[realCandidate.from, realCandidate.from, realCandidate.to],
			[realCandidate.from, realCell.cellStart, realCell.cellEnd - 1],
			[realCandidate.from, realCell.cellStart + 1, realCell.cellEnd],
			[realCandidate.from, realCell.cellStart, realCandidate.to],
		]) {
			expect(
				unpackEditorMarkdownLinkTableCells(
					realTable,
					realTableIdx.linkCandidates ?? [],
					realTableIdx.blocks,
					{
						...basePackedPayload(realTable.length),
						linkTableCellCount: 1,
						linkTableCells: Int32Array.from(tamperedRange).buffer,
					},
				),
				JSON.stringify(tamperedRange),
			).toBeNull();
		}

		// Truncated cell around bare autolink hiding trailing `)`
		const autolinkTable = "| (https://a.com/b,) | c |\n| - | - |";
		const autolinkIdx = build(autolinkTable);
		const autolinkCandidate = autolinkIdx.linkCandidates?.[0];
		if (!autolinkCandidate) throw new Error("autolink-candidate-missing");
		expect(
			unpackEditorMarkdownLinkTableCells(
				autolinkTable,
				autolinkIdx.linkCandidates ?? [],
				autolinkIdx.blocks,
				{
					...basePackedPayload(autolinkTable.length),
					linkTableCellCount: 1,
					linkTableCells: Int32Array.from([
						autolinkCandidate.from,
						autolinkCandidate.from,
						autolinkCandidate.to,
					]).buffer,
				},
			),
		).toBeNull();

		// Fake table inside multiline `\(...\)` math cannot forge a table cell
		const mathHiddenTable = "\\(a\n| [x](/u\\\\|v) |\n| - |\nb\\)";
		const fakeFrom = mathHiddenTable.indexOf("[x]");
		const fakeTo = mathHiddenTable.indexOf(")", fakeFrom) + 1;
		expect(
			unpackEditorMarkdownLinkTableCells(
				mathHiddenTable,
				[
					{
						blockFrom: 0,
						blockTo: mathHiddenTable.length,
						from: fakeFrom,
						kind: "link",
						reference: false,
						to: fakeTo,
					},
				],
				[
					{
						editable: true,
						from: 0,
						kind: "paragraph",
						lineEnd: 3,
						lineStart: 0,
						to: mathHiddenTable.length,
					},
				],
				{
					...basePackedPayload(mathHiddenTable.length),
					linkTableCellCount: 1,
					linkTableCells: Int32Array.from([fakeFrom, fakeFrom - 1, fakeTo + 1])
						.buffer,
				},
			),
		).toBeNull();
	});

	it("rejects tampered, stale-text, cross-cell, and malformed table-cell payloads", () => {
		const source = "| [a](/x\\|y) $m$ | [b](/u\\|v) |\n| - | - |";
		const index = build(source);
		const wire = packEditorMarkdownLinkTableCells(index.linkTableCells);
		if (!wire) throw new Error("wire-missing");
		const candidates = index.linkCandidates ?? [];
		const base = basePackedPayload(source.length);
		const payload: EditorMarkdownBlockIndexPackedData = {
			...base,
			linkTableCellCount: wire.linkTableCellCount,
			linkTableCells: wire.linkTableCells,
		};
		const mutate = (edit: (words: Int32Array) => void) => {
			const words = Int32Array.from(new Int32Array(wire.linkTableCells));
			edit(words);
			return { ...payload, linkTableCells: words.buffer };
		};
		const secondCandidate = candidates[1];
		const secondCell = secondCandidate
			? index.linkTableCells?.get(secondCandidate.from)
			: undefined;
		if (!secondCandidate || !secondCell) throw new Error("second-cell-missing");

		for (const malformed of [
			null,
			[],
			{ ...base, linkTableCellCount: wire.linkTableCellCount },
			{ ...base, linkTableCells: wire.linkTableCells },
			{ ...base, extra: 1 },
			{ ...base, linkTableCellTexts: [12345, { evil: 1 }] },
			{ ...payload, extra: 1 },
			{ ...payload, linkTableCellTexts: ["[b](/u|v)"] },
			{ ...payload, linkTableCellTexts: [12345, { evil: 1 }] },
			{ ...payload, linkTableCellTexts: ["x".repeat(10_000_000)] },
			{ ...payload, linkTableCellCount: 0 },
			{ ...payload, linkTableCellCount: candidates.length + 1 },
			{ ...payload, linkTableCellCount: 1.5 },
			{ ...payload, linkTableCells: new Int32Array(1).buffer },
			{ ...payload, linkTableCells: new Int32Array(wire.linkTableCellCount * 5).buffer },
			{ ...payload, linkTableCells: "not-a-buffer" },
			// Non-matching candidateFrom
			mutate((words) => {
				words[0] = (words[0] ?? 0) + 1;
			}),
			// Duplicate candidateFrom
			mutate((words) => {
				words[3] = words[0] ?? 0;
			}),
			// Decreasing candidateFrom
			mutate((words) => {
				const a0 = words[0] ?? 0;
				const a1 = words[1] ?? 0;
				const a2 = words[2] ?? 0;
				words[0] = words[3] ?? 0;
				words[1] = words[4] ?? 0;
				words[2] = words[5] ?? 0;
				words[3] = a0;
				words[4] = a1;
				words[5] = a2;
			}),
			// Out-of-bounds cellStart / cellEnd
			mutate((words) => {
				words[1] = -1;
			}),
			mutate((words) => {
				words[1] = (words[0] ?? 0) + 1;
			}),
			mutate((words) => {
				words[2] = (words[0] ?? 0) + 2;
			}),
			mutate((words) => {
				words[2] = source.length + 1;
			}),
			// Cross-cell tampering: point link a at link b's cell or stretch across `|`
			mutate((words) => {
				words[1] = secondCell.cellStart;
				words[2] = secondCell.cellEnd;
			}),
			mutate((words) => {
				words[2] = secondCell.cellEnd;
			}),
			// Cross-line tampering: stretch link b's cell across `\n`
			mutate((words) => {
				words[5] = source.length;
			}),
			// Math-span slicing: cut cell a in the middle of `$m$`
			mutate((words) => {
				words[2] = source.indexOf("$m$") + 1;
			}),
		]) {
			expect(
				unpackEditorMarkdownLinkTableCells(
					source,
					candidates,
					index.blocks,
					malformed,
				),
			).toBeNull();
		}
	});
});
