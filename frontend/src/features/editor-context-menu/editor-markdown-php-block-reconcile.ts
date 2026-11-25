import type {
	EditorMarkdownBlockKind,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";
import {
	findFirstMathRangeEndingAfter,
	findLineIndexAtOffset,
	inCodeRange,
	type PhpMarkdownMathRange,
	type ScannedMarkdownBlocks,
	type ScannedMarkdownLine,
} from "../../shared/markdown/php-commonmark-block-scan";
import { lineIndexAtOffsets } from "./editor-markdown-lines";
import type { SourceRange } from "./editor-markdown-source-projection";

export type ReconciledPhpTableBlocks = Readonly<{
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	reconciledTableBlocks: ReadonlyArray<EditorMarkdownSourceBlock>;
}>;

export function trimBlockSlice(
	source: string,
	sliceFrom: number,
	sliceTo: number,
	starts: ReadonlyArray<number>,
	kind: EditorMarkdownBlockKind,
	editable: boolean,
): EditorMarkdownSourceBlock | null {
	let from = sliceFrom;
	let to = sliceTo;
	while (from < to) {
		let probe = from;
		while (probe < to && (" " === source[probe] || "\t" === source[probe])) {
			probe += 1;
		}
		if (probe < to && ("\r" === source[probe] || "\n" === source[probe])) {
			from =
				"\r" === source[probe] && "\n" === source[probe + 1]
					? probe + 2
					: probe + 1;
			continue;
		}
		break;
	}
	while (to > from) {
		let probe = to;
		while (
			probe > from &&
			(" " === source[probe - 1] || "\t" === source[probe - 1])
		) {
			probe -= 1;
		}
		if (
			probe > from &&
			("\r" === source[probe - 1] || "\n" === source[probe - 1])
		) {
			to =
				"\n" === source[probe - 1] &&
				probe - 2 >= from &&
				"\r" === source[probe - 2]
					? probe - 2
					: probe - 1;
			continue;
		}
		break;
	}
	if (from >= to || !source.slice(from, to).trim()) return null;
	return {
		editable,
		from,
		kind,
		lineEnd: lineIndexAtOffsets(starts, Math.max(from, to - 1)),
		lineStart: lineIndexAtOffsets(starts, from),
		to,
	};
}

export function isOffsetInsideInlineParenMath(
	source: string,
	offset: number,
	minMathFrom: number,
	phpMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	mathCursor: { value: number },
): boolean {
	while (
		mathCursor.value < phpMathRanges.length &&
		(phpMathRanges[mathCursor.value]?.to ?? 0) <= offset
	) {
		mathCursor.value += 1;
	}
	const math = phpMathRanges[mathCursor.value];
	return Boolean(
		math &&
			!math.block &&
			math.from >= minMathFrom &&
			math.from < offset &&
			offset < math.to &&
			"\\" === source[math.from] &&
			"(" === source[math.from + 1],
	);
}

/**
 * Reconciles top-level Lezer `unavailable` blocks that PHP `extract_math()` +
 * `League\CommonMark` GFM `TableParser` renders as a real top-level table:
 *
 * 1. Exact refdef-as-table matches without math or image syntax (where Lezer
 *    parses a 2-line or multiline link reference definition while PHP renders a
 *    table).
 * 2. Multiline inline `\(...\)` math starting in an earlier editable block and
 *    bridging into a Lezer `unavailable` block (for example `<div>` or `<!--`
 *    hidden inside `\(...\)`) inside a top-level PHP GFM table.
 *
 * Non-table HTML blocks, refdefs containing math, and any trailing non-table
 * HTML block after a reconciled table stay strictly `unavailable`.
 */
export function reconcilePhpTableUnavailableBlocks(
	source: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	phpBlockScan: ScannedMarkdownBlocks,
	phpMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	starts: ReadonlyArray<number>,
): ReconciledPhpTableBlocks {
	const tableSpans: SourceRange[] = [];
	const evaluatedTableStarts = new Set<number>();
	const evaluatedUntilLineIdx = { value: -1 };
	let mathIndex = 0;

	for (let index = 0; index < blocks.length; index += 1) {
		const block = blocks[index];
		if ("unavailable" !== block?.kind) continue;

		const lastSpan = tableSpans[tableSpans.length - 1];
		if (lastSpan && block.from >= lastSpan.from && block.to <= lastSpan.to) {
			continue;
		}

		const bridgedSpan = findMathBridgedPhpTableSpan(
			source,
			blocks,
			index,
			phpBlockScan,
			phpMathRanges,
			evaluatedTableStarts,
			evaluatedUntilLineIdx,
		);
		if (bridgedSpan) {
			if (!lastSpan || bridgedSpan.from >= lastSpan.to) {
				tableSpans.push(bridgedSpan);
			}
			continue;
		}

		if (block.lineEnd - block.lineStart < 1) continue;
		while (
			mathIndex < phpMathRanges.length &&
			(phpMathRanges[mathIndex]?.to ?? 0) <= block.from
		) {
			mathIndex += 1;
		}
		const math = phpMathRanges[mathIndex];
		if (
			(math && math.from < block.to) ||
			source.slice(block.from, block.to).includes("![") ||
			!blockIsExactPhpTable(block, phpBlockScan)
		) {
			continue;
		}
		if (!lastSpan || block.from >= lastSpan.to) {
			tableSpans.push({ from: block.from, to: block.to });
		}
	}

	if (0 === tableSpans.length) {
		return { blocks, reconciledTableBlocks: [] };
	}

	const result: EditorMarkdownSourceBlock[] = [];
	const reconciledTableBlocks: EditorMarkdownSourceBlock[] = [];
	const emittedSpan = new Uint8Array(tableSpans.length);
	let spanIndex = 0;

	for (let blockIdx = 0; blockIdx < blocks.length; blockIdx += 1) {
		const block = blocks[blockIdx];
		if (!block) continue;
		while (
			spanIndex < tableSpans.length &&
			(tableSpans[spanIndex]?.to ?? 0) <= block.from
		) {
			spanIndex += 1;
		}
		let cursor = block.from;
		let probe = spanIndex;
		while (probe < tableSpans.length) {
			const span = tableSpans[probe];
			if (!span || span.from >= block.to) break;
			if (cursor < span.from) {
				const leading = trimBlockSlice(
					source,
					cursor,
					span.from,
					starts,
					block.kind,
					block.editable,
				);
				if (leading) result.push(leading);
			}
			if (0 === emittedSpan[probe]) {
				emittedSpan[probe] = 1;
				const tableBlock: EditorMarkdownSourceBlock = {
					editable: true,
					from: span.from,
					kind: "table",
					lineEnd: lineIndexAtOffsets(starts, Math.max(span.from, span.to - 1)),
					lineStart: lineIndexAtOffsets(starts, span.from),
					to: span.to,
				};
				result.push(tableBlock);
				reconciledTableBlocks.push(tableBlock);
			}
			cursor = Math.max(cursor, Math.min(block.to, span.to));
			if (span.to <= block.to) probe += 1;
			else break;
		}
		if (cursor < block.to) {
			const trailing =
				cursor === block.from
					? block
					: trimBlockSlice(
							source,
							cursor,
							block.to,
							starts,
							block.kind,
							block.editable,
						);
			if (trailing) result.push(trailing);
		}
	}

	return { blocks: result, reconciledTableBlocks };
}

export function findFirstBlockEndingAfter(
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	offset: number,
): number {
	let low = 0;
	let high = blocks.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if ((blocks[middle]?.to ?? 0) <= offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

function hasBridgingEditableParenMath(
	source: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	blockIndex: number,
	phpMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
): boolean {
	const block = blocks[blockIndex];
	if (!block || 0 === phpMathRanges.length) return false;
	const mathIdx = findFirstMathRangeEndingAfter(phpMathRanges, block.from);
	const math = phpMathRanges[mathIdx];
	if (
		!math ||
		math.block ||
		math.from >= block.from ||
		math.to <= block.from ||
		"\\" !== source[math.from] ||
		"(" !== source[math.from + 1]
	) {
		return false;
	}
	const startBlockIdx = findFirstBlockEndingAfter(blocks, math.from);
	if (startBlockIdx >= blockIndex) return false;
	const candidate = blocks[startBlockIdx];
	return Boolean(
		candidate &&
			candidate.from <= math.from &&
			candidate.editable &&
			"code" !== candidate.kind &&
			"unavailable" !== candidate.kind &&
			"math" !== candidate.kind,
	);
}

function advanceEvaluatedContiguousTableRows(
	lines: ReadonlyArray<ScannedMarkdownLine>,
	fromIdx: number,
	columnCount: number | null,
	evaluatedUntilLineIdx: { value: number },
): void {
	let endProbe = fromIdx;
	while (
		endProbe + 1 < lines.length &&
		lines[endProbe + 1]?.isTableRow &&
		(lines[endProbe + 1]?.inlineBlockId ?? -1) >= 0 &&
		lines[endProbe + 1]?.tableColumnCount === columnCount
	) {
		endProbe += 1;
	}
	if (endProbe > evaluatedUntilLineIdx.value) {
		evaluatedUntilLineIdx.value = endProbe;
	}
}

export function findPhpTableSpanContainingLine(
	lines: ReadonlyArray<ScannedMarkdownLine>,
	targetLineIdx: number,
	evaluatedUntilLineIdx?: { value: number },
): Readonly<{ endLineIdx: number; startLineIdx: number }> | null {
	if (evaluatedUntilLineIdx && targetLineIdx <= evaluatedUntilLineIdx.value) {
		return null;
	}
	const target = lines[targetLineIdx];
	if (!target?.isTableRow || target.inlineBlockId < 0) return null;

	let headerIdx = targetLineIdx;
	if (!lines[targetLineIdx + 1]?.isTableDelimiter) {
		let probe = targetLineIdx - 1;
		while (probe >= 0) {
			const row = lines[probe];
			if (
				!row?.isTableRow ||
				row.inlineBlockId < 0 ||
				row.tableColumnCount !== target.tableColumnCount
			) {
				break;
			}
			probe -= 1;
		}
		if (probe <= 0 || !lines[probe]?.isTableDelimiter) {
			if (evaluatedUntilLineIdx) {
				advanceEvaluatedContiguousTableRows(
					lines,
					targetLineIdx,
					target.tableColumnCount,
					evaluatedUntilLineIdx,
				);
			}
			return null;
		}
		headerIdx = probe - 1;
	}

	const header = lines[headerIdx];
	const delimiter = lines[headerIdx + 1];
	const previous = headerIdx > 0 ? lines[headerIdx - 1] : null;
	if (
		!header?.isTableRow ||
		header.inlineBlockId < 0 ||
		previous?.isTableRow ||
		previous?.isTableDelimiter ||
		!delimiter?.isTableDelimiter ||
		delimiter.isTableRow ||
		delimiter.inlineBlockId >= 0
	) {
		if (evaluatedUntilLineIdx) {
			advanceEvaluatedContiguousTableRows(
				lines,
				Math.max(targetLineIdx, headerIdx + 1),
				target.tableColumnCount,
				evaluatedUntilLineIdx,
			);
		}
		return null;
	}

	let endIdx = headerIdx + 1;
	while (endIdx + 1 < lines.length) {
		const row = lines[endIdx + 1];
		if (
			!row?.isTableRow ||
			row.inlineBlockId < 0 ||
			row.tableColumnCount !== header.tableColumnCount
		) {
			break;
		}
		endIdx += 1;
	}
	if (evaluatedUntilLineIdx && endIdx > evaluatedUntilLineIdx.value) {
		evaluatedUntilLineIdx.value = endIdx;
	}
	const after = endIdx + 1 < lines.length ? lines[endIdx + 1] : null;
	if (after?.isTableRow || after?.isTableDelimiter) return null;
	if (targetLineIdx < headerIdx || targetLineIdx > endIdx) return null;
	return { endLineIdx: endIdx, startLineIdx: headerIdx };
}

function findMathBridgedPhpTableSpan(
	source: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	blockIndex: number,
	phpBlockScan: ScannedMarkdownBlocks,
	phpMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	evaluatedTableStarts: Set<number>,
	evaluatedUntilLineIdx: { value: number },
): SourceRange | null {
	const block = blocks[blockIndex];
	if (!block) return null;
	if (!hasBridgingEditableParenMath(source, blocks, blockIndex, phpMathRanges)) {
		return null;
	}
	const lines = phpBlockScan.lines;
	const phpLineIdx = findLineIndexAtOffset(lines, block.from);
	if (phpLineIdx < 0 || phpLineIdx <= evaluatedUntilLineIdx.value) return null;
	const tableLineSpan = findPhpTableSpanContainingLine(
		lines,
		phpLineIdx,
		evaluatedUntilLineIdx,
	);
	if (!tableLineSpan) return null;
	if (evaluatedTableStarts.has(tableLineSpan.startLineIdx)) return null;
	evaluatedTableStarts.add(tableLineSpan.startLineIdx);

	for (
		let idx = tableLineSpan.startLineIdx;
		idx <= tableLineSpan.endLineIdx;
		idx += 1
	) {
		if (lines[idx]?.consumedBlockquote) return null;
	}
	const tableFrom = lines[tableLineSpan.startLineIdx]?.lineStart ?? -1;
	const tableTo = lines[tableLineSpan.endLineIdx]?.lineEnd ?? -1;
	if (tableFrom < 0 || tableTo <= tableFrom) return null;
	if (inCodeRange(phpBlockScan.blockCodeRanges, tableFrom, tableTo)) {
		return null;
	}

	for (
		let mIdx = findFirstMathRangeEndingAfter(phpMathRanges, tableFrom);
		mIdx < phpMathRanges.length;
		mIdx += 1
	) {
		const math = phpMathRanges[mIdx];
		if (!math || math.from >= tableTo) break;
		if (math.block) return null;
	}

	// Verify overlapping Lezer blocks are top-level non-code/non-container blocks
	// (allowing phantom `quote`/`list` blocks whose markers lie strictly inside
	// inline `\(...\)` math) and the table does not start in `unavailable`.
	const mathCursor = {
		value: findFirstMathRangeEndingAfter(phpMathRanges, tableFrom),
	};
	let firstOverlappingKind: EditorMarkdownBlockKind | null = null;
	for (
		let i = findFirstBlockEndingAfter(blocks, tableFrom);
		i < blocks.length;
		i += 1
	) {
		const candidate = blocks[i];
		if (!candidate || candidate.from >= tableTo) break;
		if (null === firstOverlappingKind) firstOverlappingKind = candidate.kind;
		if ("code" === candidate.kind || "math" === candidate.kind) {
			return null;
		}
		if (
			("quote" === candidate.kind || "list" === candidate.kind) &&
			!isOffsetInsideInlineParenMath(
				source,
				candidate.from,
				tableFrom,
				phpMathRanges,
				mathCursor,
			)
		) {
			return null;
		}
	}
	if (null === firstOverlappingKind || "unavailable" === firstOverlappingKind) {
		return null;
	}
	return { from: tableFrom, to: tableTo };
}

function blockIsExactPhpTable(
	block: EditorMarkdownSourceBlock,
	phpBlockScan: ScannedMarkdownBlocks,
): boolean {
	const lines = phpBlockScan.lines;
	const headerIdx = findLineIndexAtOffset(lines, block.from);
	if (headerIdx < 0) return false;
	const header = lines[headerIdx];
	const delimiter = lines[headerIdx + 1];
	const previous = headerIdx > 0 ? lines[headerIdx - 1] : null;
	if (
		!header ||
		!delimiter ||
		header.lineStart !== block.from ||
		!header.isTableRow ||
		header.inlineBlockId < 0 ||
		previous?.isTableRow ||
		previous?.isTableDelimiter ||
		!delimiter.isTableDelimiter ||
		delimiter.isTableRow ||
		delimiter.inlineBlockId >= 0
	) {
		return false;
	}
	const endIdx = findLineIndexAtOffset(lines, Math.max(block.from, block.to - 1));
	if (endIdx < headerIdx + 1) return false;
	const next = endIdx + 1 < lines.length ? lines[endIdx + 1] : null;
	if (next?.isTableRow || next?.isTableDelimiter) return false;
	for (let line = headerIdx + 2; line <= endIdx; line += 1) {
		const row = lines[line];
		if (
			!row?.isTableRow ||
			row.inlineBlockId < 0 ||
			row.tableColumnCount !== header.tableColumnCount
		) {
			return false;
		}
	}
	return lines[endIdx]?.lineEnd === block.to;
}
