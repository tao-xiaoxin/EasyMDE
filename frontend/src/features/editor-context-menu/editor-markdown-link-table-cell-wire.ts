import type { EditorMarkdownLinkCandidate } from "../../contracts/ports/editor-block-index-port";
import type { EditorMarkdownLinkTableCellContext } from "./editor-markdown-link-preparation";

/**
 * Transfer-only extension of the `packed-v3` worker payload that carries the
 * authoritative PHP table-cell context computed by
 * `createEditorMarkdownBlockIndex` (`linkTableCells`). The three keys are
 * present together only when at least one link candidate lies inside a PHP
 * GFM table cell; absence means "no table-cell candidates".
 *
 * `linkTableCells` holds flat Int32 records
 * `[candidateFrom, cellStart, cellEnd, maskedTextIndex, unescapedTextIndex]`
 * where text indices point into `linkTableCellTexts` (or `-1` when omitted).
 */
export type EditorMarkdownLinkTableCellWireData = Readonly<{
	linkTableCellCount: number;
	linkTableCells: ArrayBuffer;
	linkTableCellTexts: ReadonlyArray<string>;
}>;

export const EDITOR_LINK_TABLE_CELL_WIRE_KEYS: ReadonlyArray<string> = [
	"linkTableCellCount",
	"linkTableCells",
	"linkTableCellTexts",
];

export const EDITOR_LINK_TABLE_CELL_WIRE_FIELDS = 5;

/** Packs `linkTableCells` (sorted by candidate) or returns `null` when empty. */
export function packEditorMarkdownLinkTableCells(
	linkTableCells:
		| ReadonlyMap<number, EditorMarkdownLinkTableCellContext>
		| undefined,
): EditorMarkdownLinkTableCellWireData | null {
	if (!linkTableCells || 0 === linkTableCells.size) return null;
	const entries = Array.from(linkTableCells.entries()).sort(
		(left, right) => left[0] - right[0],
	);
	const records = new Int32Array(
		entries.length * EDITOR_LINK_TABLE_CELL_WIRE_FIELDS,
	);
	const texts: string[] = [];
	const textIndexes = new Map<string, number>();
	const textIndex = (text: string | undefined): number => {
		if (undefined === text) return -1;
		const existing = textIndexes.get(text);
		if (undefined !== existing) return existing;
		texts.push(text);
		textIndexes.set(text, texts.length - 1);
		return texts.length - 1;
	};
	entries.forEach(([candidateFrom, cell], index) => {
		const offset = index * EDITOR_LINK_TABLE_CELL_WIRE_FIELDS;
		records[offset] = candidateFrom;
		records[offset + 1] = cell.cellStart;
		records[offset + 2] = cell.cellEnd;
		records[offset + 3] = textIndex(cell.maskedCellText);
		records[offset + 4] = textIndex(cell.unescapedSource);
	});
	return {
		linkTableCellCount: entries.length,
		linkTableCells: records.buffer,
		linkTableCellTexts: texts,
	};
}

function wireText(
	texts: ReadonlyArray<unknown>,
	index: number,
): string | undefined | null {
	if (-1 === index) return undefined;
	if (index < 0 || index >= texts.length) return null;
	const text = texts[index];
	return "string" === typeof text ? text : null;
}

/**
 * Validates and rebuilds `linkTableCells` in O(K + L) from the transferred
 * records against the already validated, sorted `linkCandidates`. Returns
 * `null` for any malformed payload so the adapter can reject the result.
 */
export function unpackEditorMarkdownLinkTableCells(
	data: Readonly<Record<string, unknown>>,
	linkCandidates: ReadonlyArray<EditorMarkdownLinkCandidate>,
	sourceLength: number,
): ReadonlyMap<number, EditorMarkdownLinkTableCellContext> | null {
	const count = data.linkTableCellCount;
	const buffer = data.linkTableCells;
	const texts = data.linkTableCellTexts;
	if (
		"number" !== typeof count ||
		!Number.isSafeInteger(count) ||
		count <= 0 ||
		count > linkCandidates.length ||
		!(buffer instanceof ArrayBuffer) ||
		buffer.byteLength !==
			count * EDITOR_LINK_TABLE_CELL_WIRE_FIELDS * Int32Array.BYTES_PER_ELEMENT ||
		!Array.isArray(texts) ||
		texts.length > count * 2
	) {
		return null;
	}
	const records = new Int32Array(buffer);
	const cells = new Map<number, EditorMarkdownLinkTableCellContext>();
	let candidateIndex = 0;
	for (let index = 0; index < count; index += 1) {
		const offset = index * EDITOR_LINK_TABLE_CELL_WIRE_FIELDS;
		const from = records[offset] ?? -1;
		const cellStart = records[offset + 1] ?? -1;
		const cellEnd = records[offset + 2] ?? -1;
		while (
			candidateIndex < linkCandidates.length &&
			(linkCandidates[candidateIndex]?.from ?? sourceLength) < from
		) {
			candidateIndex += 1;
		}
		const candidate = linkCandidates[candidateIndex];
		const maskedCellText = wireText(texts, records[offset + 3] ?? -2);
		const unescapedSource = wireText(texts, records[offset + 4] ?? -2);
		if (
			!candidate ||
			candidate.from !== from ||
			cellStart < 0 ||
			cellStart > from ||
			candidate.to > cellEnd ||
			cellEnd > sourceLength ||
			null === maskedCellText ||
			null === unescapedSource ||
			(undefined !== maskedCellText &&
				maskedCellText.length !== cellEnd - cellStart) ||
			(undefined !== unescapedSource &&
				unescapedSource.length >= candidate.to - candidate.from)
		) {
			return null;
		}
		cells.set(from, {
			cellEnd,
			cellStart,
			...(undefined !== maskedCellText ? { maskedCellText } : {}),
			...(undefined !== unescapedSource ? { unescapedSource } : {}),
		});
		candidateIndex += 1;
	}
	return cells;
}
