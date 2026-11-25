import { describe, expect, it } from "vitest";

import {
	EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE,
	type EditorMarkdownBlockIndexPackedData,
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
		expect(packEditorMarkdownLinkTableCells(undefined)).toBeNull();
		expect(packEditorMarkdownLinkTableCells(index.linkTableCells)).toBeNull();
		expect(
			unpackEditorMarkdownLinkTableCells(
				source,
				index.linkCandidates ?? [],
				index.mathSpans,
				index.blocks,
				basePackedPayload(source.length),
			),
		).toBeUndefined();
	});

	it.each([
		"| [a](/x\\|y) | [b](/u\\|v) |\n| - | - |",
		"| [x](https://example.com/a\\\\|b) $y$ | https://c.example |\n| - | - |",
		"10. item\n\n    | a | b |\n    | - | - |\n    | [x][a\\|b] | c |\n\n[a|b]: https://example.com/ok",
		"| [x][a\\|b] \\(a\nb\\) \\(c\nd\\) | col2 |\n| --- | --- |\n\n[a|b]: https://example.com/ok",
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
				index.mathSpans,
				index.blocks,
				payload,
			),
		).toEqual(index.linkTableCells);
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
					index.mathSpans,
					index.blocks,
					malformed,
				),
			).toBeNull();
		}
	});
});
