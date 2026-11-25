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

	it("round-trips multiline paren-math HTML-tag table cells, rejects plain HTML forgeries, and unpacks 100k-line trailing-math docs without scanning trailing math (Round 37 Track A #3 & #4)", () => {
		for (const source of [
			"\\(a\n<div>\nb\\) | [x](/u)\n-|-",
			"\\(a\n<div>\nb\\) | [x](/a\\\\|b)\n-|-",
			"\\(a\n<div>\nb\\) | [x][k]\n-|-\n\n[k]: https://k.example",
			"\\(a\n<div>\nb\\) | https://a.example\n-|-",
			"\\(a\r\n<div>\r\nb\\) | [x](/a\\\\|b)\r\n-|-",
			"[r]: /u\n    $x$\n\n| [a](https://example.com) | b |\n| - | - |",
		]) {
			const index = build(source);
			const wire = packEditorMarkdownLinkTableCells(index.linkTableCells);
			if (!wire) throw new Error(`wire-missing:${source}`);
			const payload: EditorMarkdownBlockIndexPackedData = {
				...basePackedPayload(source.length),
				linkTableCellCount: wire.linkTableCellCount,
				linkTableCells: wire.linkTableCells,
			};
			expect(
				unpackEditorMarkdownLinkTableCells(
					source,
					index.linkCandidates ?? [],
					index.blocks,
					payload,
				),
				source,
			).toEqual(index.linkTableCells);
		}

		// Forged table cell inside an HTML block without math stays rejected.
		const plainHtml = "<div>\n[x](/u)\n</div>";
		const linkFrom = plainHtml.indexOf("[x]");
		const linkTo = plainHtml.indexOf(")", linkFrom) + 1;
		expect(
			unpackEditorMarkdownLinkTableCells(
				plainHtml,
				[
					{
						blockFrom: 0,
						blockTo: plainHtml.length,
						from: linkFrom,
						kind: "link",
						reference: false,
						to: linkTo,
					},
				],
				[
					{
						editable: true,
						from: 0,
						kind: "table",
						lineEnd: 2,
						lineStart: 0,
						to: plainHtml.length,
					},
				],
				{
					...basePackedPayload(plainHtml.length),
					linkTableCellCount: 1,
					linkTableCells: Int32Array.from([linkFrom, linkFrom, linkTo]).buffer,
				},
			),
		).toBeNull();

		// Forged table cell whose header opens `$$` that closes 100k lines later stays rejected.
		const unclosedHeaderDisplayMath = `| [x](/u) | $$a |\n| - | - |\n\n${"z\n".repeat(10_000)}$$`;
		const forgedFrom = unclosedHeaderDisplayMath.indexOf("[x]");
		const forgedTo = forgedFrom + "[x](/u)".length;
		expect(
			unpackEditorMarkdownLinkTableCells(
				unclosedHeaderDisplayMath,
				[
					{
						blockFrom: 0,
						blockTo: 27,
						from: forgedFrom,
						kind: "link",
						reference: false,
						to: forgedTo,
					},
				],
				[
					{
						editable: true,
						from: 0,
						kind: "table",
						lineEnd: 1,
						lineStart: 0,
						to: 27,
					},
				],
				{
					...basePackedPayload(unclosedHeaderDisplayMath.length),
					linkTableCellCount: 1,
					linkTableCells: Int32Array.from([forgedFrom, 1, 10]).buffer,
				},
			),
		).toBeNull();

		// Track A #4 perf regression guard: 100k-line trailing math after top table unpacks in bounded prefix time.
		const trailingMathDoc = `| [x](/u) | c |\n| - | - |\n\n${"p $x$ $y$\n".repeat(100_000)}`;
		const trailingIdx = build(trailingMathDoc);
		const trailingWire = packEditorMarkdownLinkTableCells(
			trailingIdx.linkTableCells,
		);
		if (!trailingWire) throw new Error("trailing-wire-missing");
		const trailingPayload: EditorMarkdownBlockIndexPackedData = {
			...basePackedPayload(trailingMathDoc.length),
			linkTableCellCount: trailingWire.linkTableCellCount,
			linkTableCells: trailingWire.linkTableCells,
		};
		const started = performance.now();
		const unpackedTrailing = unpackEditorMarkdownLinkTableCells(
			trailingMathDoc,
			trailingIdx.linkCandidates ?? [],
			trailingIdx.blocks,
			trailingPayload,
		);
		const elapsedMs = performance.now() - started;
		expect(unpackedTrailing).toEqual(trailingIdx.linkTableCells);
		expect(elapsedMs).toBeLessThanOrEqual(150);

		// Multiline `\(...\)` on the header row followed by 100k trailing math lines also unpacks cleanly and fast.
		const multilineHeaderTrailing = `| [x](/u) | \\(a\n\nb\\) |\n| - | - |\n\n${"p $x$ $y$\n".repeat(100_000)}`;
		const multiIdx = build(multilineHeaderTrailing);
		const multiWire = packEditorMarkdownLinkTableCells(multiIdx.linkTableCells);
		if (!multiWire) throw new Error("multi-wire-missing");
		const multiPayload: EditorMarkdownBlockIndexPackedData = {
			...basePackedPayload(multilineHeaderTrailing.length),
			linkTableCellCount: multiWire.linkTableCellCount,
			linkTableCells: multiWire.linkTableCells,
		};
		const multiStarted = performance.now();
		const unpackedMulti = unpackEditorMarkdownLinkTableCells(
			multilineHeaderTrailing,
			multiIdx.linkCandidates ?? [],
			multiIdx.blocks,
			multiPayload,
		);
		expect(unpackedMulti).toEqual(multiIdx.linkTableCells);
		expect(performance.now() - multiStarted).toBeLessThanOrEqual(150);
	}, 60_000);

	it("round-trips post-refdef and quote/list-in-paren-math table cells and keeps exact backtick run-length unpack fast on 100k-line trailing math (Round 38 Track A #4/#5, Track B Findings 2 & 3)", () => {
		for (const source of [
			"[r]: /u\n    c | [x](/v)\n-|-",
			"[r]: /u\n    | a | b |\n    | --- | --- |\n    | [link](/local) | 2 |",
			"| A | B |\n| --- | --- |\n| \\(x\n> quote\n<div>\ny\\) | [link](https://example.com) |",
			"| A | B |\n| --- | --- |\n| \\(x\n- list\n<div>\ny\\) | [link](https://example.com) |",
		]) {
			const index = build(source);
			const wire = packEditorMarkdownLinkTableCells(index.linkTableCells);
			if (!wire) throw new Error(`wire-missing:${source}`);
			const payload: EditorMarkdownBlockIndexPackedData = {
				...basePackedPayload(source.length),
				linkTableCellCount: wire.linkTableCellCount,
				linkTableCells: wire.linkTableCells,
			};
			expect(
				unpackEditorMarkdownLinkTableCells(
					source,
					index.linkCandidates ?? [],
					index.blocks,
					payload,
				),
				source,
			).toEqual(index.linkTableCells);
		}

		// Track A #5 perf guard: 1-backtick open + 100k trailing math + trailing 2-backtick run unpacks in bounded prefix time.
		const trailing = "p $x$ $y$\n".repeat(100_000);
		for (const source of [
			`| $a$ \` | [x](/u) |\n| - | - |\n\n${trailing}\`\``,
			`| $a$ \` | [x](/u) |\n| - | - |\n\n${trailing}\``,
			`| \` $a$ | [x](/u) |\n| - | - |\n\n${trailing}\`\``,
		]) {
			const idx = build(source);
			const wire = packEditorMarkdownLinkTableCells(idx.linkTableCells);
			if (!wire) throw new Error("backtick-wire-missing");
			const payload: EditorMarkdownBlockIndexPackedData = {
				...basePackedPayload(source.length),
				linkTableCellCount: wire.linkTableCellCount,
				linkTableCells: wire.linkTableCells,
			};
			const started = performance.now();
			const unpacked = unpackEditorMarkdownLinkTableCells(
				source,
				idx.linkCandidates ?? [],
				idx.blocks,
				payload,
			);
			const elapsedMs = performance.now() - started;
			expect(unpacked).toEqual(idx.linkTableCells);
			expect(elapsedMs).toBeLessThanOrEqual(150);
		}

		// Forged table cell inside post-display-math indented code stays rejected.
		const postDisplay = "[r]: /u\n    $$x$$\n    [link](https://example.com)";
		const forgedFrom = postDisplay.indexOf("[link]");
		const forgedTo = postDisplay.length;
		expect(
			unpackEditorMarkdownLinkTableCells(
				postDisplay,
				[
					{
						blockFrom: 18,
						blockTo: postDisplay.length,
						from: forgedFrom,
						kind: "link",
						reference: false,
						to: forgedTo,
					},
				],
				[
					{
						editable: false,
						from: 0,
						kind: "unavailable",
						lineEnd: 0,
						lineStart: 0,
						to: 7,
					},
					{
						editable: true,
						from: 12,
						kind: "math",
						lineEnd: 1,
						lineStart: 1,
						to: 17,
					},
					{
						editable: true,
						from: 18,
						kind: "table",
						lineEnd: 2,
						lineStart: 2,
						to: postDisplay.length,
					},
				],
				{
					...basePackedPayload(postDisplay.length),
					linkTableCellCount: 1,
					linkTableCells: Int32Array.from([forgedFrom, 18, postDisplay.length])
						.buffer,
				},
			),
		).toBeNull();
	}, 60_000);
});
