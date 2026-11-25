import { describe, expect, it } from "vitest";

import { createEditorMarkdownBlockIndex } from "./editor-markdown-block-index";
import {
	EDITOR_LINK_TABLE_CELL_WIRE_FIELDS,
	packEditorMarkdownLinkTableCells,
	unpackEditorMarkdownLinkTableCells,
} from "./editor-markdown-link-table-cell-wire";

function build(source: string) {
	return createEditorMarkdownBlockIndex(source, {
		referenceLabelCaseFoldProfile: 14,
	});
}

describe("editor markdown link table-cell wire", () => {
	it("omits the wire payload when no candidate lies in a table cell", () => {
		expect(packEditorMarkdownLinkTableCells(undefined)).toBeNull();
		expect(
			packEditorMarkdownLinkTableCells(build("[a](/u) https://example.com").linkTableCells),
		).toBeNull();
	});

	it.each([
		"| [x](https://example.com/a\\\\|b) $y$ | https://c.example |\n| - | - |",
		"10. item\n\n    | a | b |\n    | - | - |\n    | [x][a\\|b] | c |\n\n[a|b]: https://example.com/ok",
		"| [x][a\\|b] \\(a\nb\\) \\(c\nd\\) | col2 |\n| --- | --- |\n\n[a|b]: https://example.com/ok",
	])("round-trips the exact table-cell context %#", (source) => {
		const index = build(source);
		const wire = packEditorMarkdownLinkTableCells(index.linkTableCells);
		if (!wire) throw new Error("wire-missing");
		expect(wire.linkTableCellCount).toBe(index.linkTableCells?.size);
		expect(wire.linkTableCells.byteLength).toBe(
			wire.linkTableCellCount * EDITOR_LINK_TABLE_CELL_WIRE_FIELDS * 4,
		);
		expect(
			unpackEditorMarkdownLinkTableCells(
				wire,
				index.linkCandidates ?? [],
				source.length,
			),
		).toEqual(index.linkTableCells);
	});

	it("rejects malformed table-cell payloads", () => {
		const source = "| [x](https://example.com/a\\\\|b) $y$ | c |\n| - | - |";
		const index = build(source);
		const wire = packEditorMarkdownLinkTableCells(index.linkTableCells);
		if (!wire) throw new Error("wire-missing");
		const candidates = index.linkCandidates ?? [];
		const mutate = (offset: number, value: number) => {
			const words = Int32Array.from(new Int32Array(wire.linkTableCells));
			words[offset] = value;
			return { ...wire, linkTableCells: words.buffer };
		};
		for (const malformed of [
			{ ...wire, linkTableCellCount: 0 },
			{ ...wire, linkTableCellCount: candidates.length + 1 },
			{ ...wire, linkTableCells: new Int32Array(1).buffer },
			{ ...wire, linkTableCellTexts: "x" },
			{ ...wire, linkTableCellTexts: [1, 2] },
			mutate(0, 1),
			mutate(1, -1),
			mutate(2, source.length + 1),
			mutate(2, 3),
			mutate(3, 99),
			mutate(4, 99),
		]) {
			expect(
				unpackEditorMarkdownLinkTableCells(malformed, candidates, source.length),
			).toBeNull();
		}
		expect(
			unpackEditorMarkdownLinkTableCells(
				{ ...wire, linkTableCellTexts: ["short"] },
				candidates,
				source.length,
			),
		).toBeNull();
	});
});
