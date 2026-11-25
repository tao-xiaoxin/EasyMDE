import {
	EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE,
	type EditorMarkdownLinkCandidate,
	type EditorMarkdownLinkTableCellContext,
	type EditorMarkdownLinkTableCellWireData,
	type EditorMarkdownSourceBlock,
	type EditorMarkdownTableCellMathRange,
	hasExactEditorBlockIndexPackedKeys,
} from "../../contracts/ports/editor-block-index-port";
import {
	collectTableRowCells,
	findFirstMathRangeEndingAfter,
	findLineAtOffset,
	findTableRowCellInCells,
	scanPhpTablePrefixThroughOffset,
	type TableRowCellRange,
	unescapeTableCellPipes,
} from "./php-commonmark-block-scan";
import {
	maskDisplayMathLength,
	maskInlineMathLength,
} from "./php-markdown-math-mask";

function maskSliceMathSpans(
	source: string,
	sliceFrom: number,
	sliceTo: number,
	mathSpans: ReadonlyArray<EditorMarkdownTableCellMathRange>,
	startIndex: number,
): string | undefined {
	if (startIndex >= mathSpans.length || sliceFrom >= sliceTo) return undefined;
	const first = mathSpans[startIndex];
	if (!first || first.from >= sliceTo) return undefined;

	const raw = source.slice(sliceFrom, sliceTo);
	const parts: string[] = [];
	let cursor = sliceFrom;
	for (let i = startIndex; i < mathSpans.length; i += 1) {
		const span = mathSpans[i];
		if (!span) continue;
		if (span.from >= sliceTo) break;
		if (span.to <= cursor) continue;
		const overlapFrom = Math.max(cursor, span.from);
		const overlapTo = Math.min(sliceTo, span.to);
		if (overlapTo <= overlapFrom) continue;
		if (overlapFrom > cursor) {
			parts.push(source.slice(cursor, overlapFrom));
		}
		const isDisplay = Boolean(span.displayMode ?? span.block);
		const fullMask = isDisplay
			? maskDisplayMathLength(span.to - span.from)
			: maskInlineMathLength(span.to - span.from);
		parts.push(
			overlapFrom === span.from && overlapTo === span.to
				? fullMask
				: fullMask.slice(overlapFrom - span.from, overlapTo - span.from),
		);
		cursor = overlapTo;
	}
	if (0 === parts.length) return undefined;
	if (cursor < sliceTo) parts.push(source.slice(cursor, sliceTo));
	const masked = parts.join("");
	return masked !== raw ? masked : undefined;
}

function unescapeSlicePipesOutsideMath(
	source: string,
	from: number,
	to: number,
	mathSpans: ReadonlyArray<EditorMarkdownTableCellMathRange>,
	startIndex: number,
): string | undefined {
	const raw = source.slice(from, to);
	if (!raw.includes("\\|")) return undefined;
	let unescaped: string;
	if (
		startIndex >= mathSpans.length ||
		(mathSpans[startIndex]?.from ?? to) >= to
	) {
		unescaped = unescapeTableCellPipes(raw);
	} else {
		const parts: string[] = [];
		let cursor = from;
		for (let i = startIndex; i < mathSpans.length; i += 1) {
			const span = mathSpans[i];
			if (!span || span.to <= cursor) continue;
			if (span.from >= to) break;
			if (span.from > cursor) {
				parts.push(unescapeTableCellPipes(source.slice(cursor, span.from)));
			}
			const overlapTo = Math.min(to, span.to);
			parts.push(source.slice(Math.max(cursor, span.from), overlapTo));
			cursor = overlapTo;
		}
		if (cursor < to) {
			parts.push(unescapeTableCellPipes(source.slice(cursor, to)));
		}
		unescaped = parts.join("");
	}
	return unescaped !== raw ? unescaped : undefined;
}

/**
 * Canonical derivation of PHP GFM table-cell link context from the
 * authoritative `source` and PHP-extracted math ranges. Shared by direct block
 * indexing and worker unpacking so both paths produce byte-identical contexts
 * without transferring untrusted strings over the worker boundary.
 */
export function deriveEditorMarkdownLinkTableCellContext(
	source: string,
	candidateFrom: number,
	candidateTo: number,
	cellStart: number,
	cellEnd: number,
	mathSpans: ReadonlyArray<EditorMarkdownTableCellMathRange>,
	cachedMaskedCell?: Map<string, string | undefined>,
	knownMathStartIndex?: number,
): EditorMarkdownLinkTableCellContext {
	const mathStartIndex =
		undefined !== knownMathStartIndex
			? knownMathStartIndex
			: mathSpans.length > 0
				? findFirstMathRangeEndingAfter(mathSpans, cellStart)
				: 0;
	let maskedCellText: string | undefined;
	if (
		mathStartIndex < mathSpans.length &&
		(mathSpans[mathStartIndex]?.from ?? cellEnd) < cellEnd
	) {
		if (cachedMaskedCell) {
			const cellKey = `${cellStart}:${cellEnd}`;
			if (cachedMaskedCell.has(cellKey)) {
				maskedCellText = cachedMaskedCell.get(cellKey);
			} else {
				maskedCellText = maskSliceMathSpans(
					source,
					cellStart,
					cellEnd,
					mathSpans,
					mathStartIndex,
				);
				cachedMaskedCell.set(cellKey, maskedCellText);
			}
		} else {
			maskedCellText = maskSliceMathSpans(
				source,
				cellStart,
				cellEnd,
				mathSpans,
				mathStartIndex,
			);
		}
	}
	const candidateMathStartIndex =
		mathStartIndex < mathSpans.length &&
		(mathSpans[mathStartIndex]?.to ?? 0) <= candidateFrom
			? findFirstMathRangeEndingAfter(mathSpans, candidateFrom)
			: mathStartIndex;
	const unescapedSource = unescapeSlicePipesOutsideMath(
		source,
		candidateFrom,
		candidateTo,
		mathSpans,
		candidateMathStartIndex,
	);
	return {
		cellEnd,
		cellStart,
		...(undefined !== maskedCellText ? { maskedCellText } : {}),
		...(undefined !== unescapedSource ? { unescapedSource } : {}),
	};
}

/**
 * Packs `linkTableCells` into a compact 3-int stride
 * `[candidateFrom, cellStart, cellEnd]` buffer sorted by `candidateFrom`,
 * or returns `null` when empty. Never transfers cell strings across the wire.
 */
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
		entries.length * EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE,
	);
	entries.forEach(([candidateFrom, cell], index) => {
		const offset = index * EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE;
		records[offset] = candidateFrom;
		records[offset + 1] = cell.cellStart;
		records[offset + 2] = cell.cellEnd;
	});
	return {
		linkTableCellCount: entries.length,
		linkTableCells: records.buffer,
	};
}

/**
 * Strictly validates the optional textless 3-int table-cell wire extension
 * inside a `packed-v3` payload against exact PHP GFM table-row and table-cell
 * boundaries derived from the authoritative `source`, then recomputes
 * `maskedCellText` and `unescapedSource` locally.
 *
 * Returns:
 * - `undefined` when the payload has the exact 10 base `packed-v3` keys (no scan),
 * - a `ReadonlyMap` when the payload has the exact 12 keys and every record matches
 *   its exact PHP GFM table-cell range, or
 * - `null` on any structural, key-count, bounds, ordering, or cell-boundary violation.
 */
export function unpackEditorMarkdownLinkTableCells(
	source: string,
	candidateRanges: ReadonlyArray<EditorMarkdownLinkCandidate>,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	rawData: unknown,
	options?: Readonly<{ envelopeValidated?: boolean }>,
): ReadonlyMap<number, EditorMarkdownLinkTableCellContext> | undefined | null {
	if (!rawData || "object" !== typeof rawData || Array.isArray(rawData)) {
		return null;
	}
	const record = rawData as Readonly<Record<string, unknown>>;
	if (!options?.envelopeValidated) {
		const shape = hasExactEditorBlockIndexPackedKeys(record);
		if (null === shape) return null;
		if ("base" === shape) return undefined;
	}
	const count = record.linkTableCellCount;
	const buffer = record.linkTableCells;
	if (
		"number" !== typeof count ||
		!Number.isSafeInteger(count) ||
		count <= 0 ||
		count > candidateRanges.length ||
		!(buffer instanceof ArrayBuffer) ||
		buffer.byteLength !==
			count *
				EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE *
				Int32Array.BYTES_PER_ELEMENT
	) {
		return null;
	}
	let records: Int32Array;
	try {
		records = new Int32Array(buffer);
	} catch {
		return null;
	}

	const matchedCandidates: EditorMarkdownLinkCandidate[] = [];
	let candidateIndex = 0;
	let blockIndex = 0;
	let previousCandidateFrom = -1;
	let previousCellStart = -1;
	let previousCellEnd = -1;
	let maxCellEnd = 0;

	for (let index = 0; index < count; index += 1) {
		const offset = index * EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE;
		const from = records[offset] ?? -1;
		const cellStart = records[offset + 1] ?? -1;
		const cellEnd = records[offset + 2] ?? -1;
		if (from <= previousCandidateFrom) return null;
		while (
			candidateIndex < candidateRanges.length &&
			(candidateRanges[candidateIndex]?.from ?? source.length) < from
		) {
			candidateIndex += 1;
		}
		const candidate = candidateRanges[candidateIndex];
		if (!candidate || candidate.from !== from) return null;

		while (
			blockIndex < blocks.length &&
			(blocks[blockIndex]?.to ?? 0) <= from
		) {
			blockIndex += 1;
		}
		const block = blocks[blockIndex];
		if (
			!block?.editable ||
			"unavailable" === block.kind ||
			"code" === block.kind ||
			"math" === block.kind ||
			block.from !== candidate.blockFrom ||
			block.to !== candidate.blockTo ||
			cellStart < 0 ||
			cellStart > from ||
			candidate.to <= from ||
			candidate.to > cellEnd ||
			cellEnd > source.length
		) {
			return null;
		}

		const sameCell =
			cellStart === previousCellStart && cellEnd === previousCellEnd;
		if (!sameCell && cellStart < previousCellEnd) {
			return null;
		}
		previousCellStart = cellStart;
		previousCellEnd = cellEnd;
		if (cellEnd > maxCellEnd) maxCellEnd = cellEnd;
		matchedCandidates.push(candidate);
		previousCandidateFrom = from;
		candidateIndex += 1;
	}

	if (!source.includes("|")) return null;

	const {
		lines: scannedLines,
		maskedSource,
		phpMathRanges,
	} = scanPhpTablePrefixThroughOffset(source, maxCellEnd);
	const rowCellsCache = new Map<number, ReadonlyArray<TableRowCellRange>>();
	const cachedMaskedCell = new Map<string, string | undefined>();
	const cells = new Map<number, EditorMarkdownLinkTableCellContext>();
	let phpMathCursor = 0;

	for (let index = 0; index < count; index += 1) {
		const offset = index * EDITOR_BLOCK_INDEX_LINK_TABLE_CELL_STRIDE;
		const from = records[offset] ?? -1;
		const cellStart = records[offset + 1] ?? -1;
		const cellEnd = records[offset + 2] ?? -1;
		const candidate = matchedCandidates[index];
		if (!candidate) return null;

		const line = findLineAtOffset(scannedLines, from);
		if (
			!line?.isTableRow ||
			line.inlineBlockId < 0 ||
			from < line.contentOffset ||
			candidate.to > line.lineEnd
		) {
			return null;
		}
		let rowCells = rowCellsCache.get(line.lineStart);
		if (undefined === rowCells) {
			rowCells = collectTableRowCells(
				maskedSource,
				line.contentOffset,
				line.lineEnd,
				line.tableColumnCount,
			);
			rowCellsCache.set(line.lineStart, rowCells);
		}
		const cell = findTableRowCellInCells(rowCells, from);
		if (
			null === cell ||
			cell.start !== cellStart ||
			cell.end !== cellEnd ||
			candidate.to > cell.end
		) {
			return null;
		}

		while (
			phpMathCursor < phpMathRanges.length &&
			(phpMathRanges[phpMathCursor]?.to ?? 0) <= cellStart
		) {
			phpMathCursor += 1;
		}
		const context = deriveEditorMarkdownLinkTableCellContext(
			source,
			from,
			candidate.to,
			cellStart,
			cellEnd,
			phpMathRanges,
			cachedMaskedCell,
			phpMathCursor,
		);
		cells.set(from, context);
	}
	return cells;
}
