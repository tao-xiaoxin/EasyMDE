import type {
	EditorMarkdownBlockKind,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";
import {
	findFirstMathRangeEndingAfter,
	findLineIndexAtOffset,
	getInlineBlockBounds,
	inCodeRange,
	type PhpMarkdownMathRange,
	type ScannedCodeRange,
	type ScannedMarkdownBlocks,
	type ScannedMarkdownLine,
} from "../../shared/markdown/php-commonmark-block-scan";
import {
	findFirstBlockEndingAfter,
	findPhpTableSpanContainingLine,
	isValidReconciledPhpTableSpan,
	trimBlockSlice,
} from "./editor-markdown-php-block-reconcile";
import type { SourceRange } from "./editor-markdown-source-projection";

type ReconciledPhpNonCodeBlocks = Readonly<{
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	reconciledInlineBlocks: ReadonlyArray<SourceRange>;
	reconciledTableBlocks: ReadonlyArray<SourceRange>;
}>;

type PendingNonCodeSliceKind =
	| "code"
	| "paragraph-inline"
	| "paragraph-math"
	| "unavailable";

function isBlockCoveredByCodeRanges(
	source: string,
	block: SourceRange,
	codeRanges: ReadonlyArray<ScannedCodeRange>,
	startCodeIndex: number,
): Readonly<{ covered: boolean; nextCodeIndex: number }> {
	let codeIndex = startCodeIndex;
	while (
		codeIndex < codeRanges.length &&
		(codeRanges[codeIndex]?.end ?? 0) <= block.from
	) {
		codeIndex += 1;
	}
	let cursor = block.from;
	let probe = codeIndex;
	while (probe < codeRanges.length) {
		const codeRange = codeRanges[probe];
		if (!codeRange || codeRange.start >= block.to) break;
		const overlapStart = Math.max(cursor, codeRange.start);
		const overlapEnd = Math.min(block.to, codeRange.end);
		if (
			overlapStart > cursor &&
			source.slice(cursor, overlapStart).trim().length > 0
		) {
			return { covered: false, nextCodeIndex: codeIndex };
		}
		if (overlapEnd > overlapStart) cursor = overlapEnd;
		if (codeRange.end <= block.to) probe += 1;
		else break;
	}
	if (cursor < block.to && source.slice(cursor, block.to).trim().length > 0) {
		return { covered: false, nextCodeIndex: codeIndex };
	}
	return { covered: true, nextCodeIndex: probe };
}

type WalkBlockLineSegmentsCallbacks = Readonly<{
	onDisplayMath?: (from: number, to: number) => void;
	onEmptySegment?: () => void;
	onSegment: (
		from: number,
		to: number,
		line: ScannedMarkdownLine,
		lineIdx: number,
	) => number | undefined;
}>;

function walkBlockLineSegments(
	blockFrom: number,
	blockTo: number,
	lines: ReadonlyArray<ScannedMarkdownLine>,
	displayMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	callbacks: WalkBlockLineSegmentsCallbacks,
): void {
	let cursor = blockFrom;
	let dmIdx = findFirstMathRangeEndingAfter(displayMathRanges, blockFrom);
	let lineIdx = findLineIndexAtOffset(lines, blockFrom);
	if (lineIdx < 0) lineIdx = 0;

	while (cursor < blockTo) {
		while (
			dmIdx < displayMathRanges.length &&
			(displayMathRanges[dmIdx]?.to ?? 0) <= cursor
		) {
			dmIdx += 1;
		}
		const dm = displayMathRanges[dmIdx];
		if (dm && dm.from <= cursor && cursor < dm.to) {
			const segTo = Math.min(blockTo, dm.to);
			callbacks.onDisplayMath?.(cursor, segTo);
			cursor = segTo;
			continue;
		}

		while (
			lineIdx < lines.length &&
			(lines[lineIdx]?.nextLineStart ?? 0) <= cursor
		) {
			lineIdx += 1;
		}
		const line = lines[lineIdx];
		if (!line || line.lineStart >= blockTo) break;
		if (cursor < line.lineStart) {
			cursor = line.lineStart;
			continue;
		}

		let segEnd = Math.min(blockTo, line.lineEnd);
		if (dm && dm.from > cursor && dm.from < segEnd) {
			segEnd = dm.from;
		}
		if (segEnd <= cursor) {
			callbacks.onEmptySegment?.();
			const nextPos = Math.min(
				blockTo,
				Math.max(cursor + 1, line.nextLineStart),
			);
			if (nextPos <= cursor) break;
			cursor = nextPos;
			continue;
		}

		const nextCursor = callbacks.onSegment(cursor, segEnd, line, lineIdx);
		cursor =
			undefined !== nextCursor
				? nextCursor
				: segEnd === line.lineEnd && (!dm || dm.from > segEnd)
					? Math.min(blockTo, line.nextLineStart)
					: segEnd;
	}
}

function collectNestedNonCodeRanges(
	source: string,
	nestedCodeBlocks: ReadonlyArray<SourceRange>,
	phpBlockScan: ScannedMarkdownBlocks,
	displayMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	reconciledInlineBlocks: SourceRange[],
	reconciledTableBlocks: SourceRange[],
): void {
	const phpBlockCodeRanges = phpBlockScan.blockCodeRanges;
	const lines = phpBlockScan.lines;
	let codeIndex = 0;

	for (let index = 0; index < nestedCodeBlocks.length; index += 1) {
		const block = nestedCodeBlocks[index];
		if (!block || block.to <= block.from) continue;

		const coverage = isBlockCoveredByCodeRanges(
			source,
			block,
			phpBlockCodeRanges,
			codeIndex,
		);
		codeIndex = coverage.nextCodeIndex;
		if (coverage.covered) continue;

		walkBlockLineSegments(block.from, block.to, lines, displayMathRanges, {
			onSegment: (segFrom, segEnd, line) => {
				if (
					!inCodeRange(phpBlockCodeRanges, segFrom, segEnd) &&
					line.inlineBlockId >= 0 &&
					source.slice(segFrom, segEnd).trim().length > 0
				) {
					if (line.isTableRow) {
						reconciledTableBlocks.push({ from: segFrom, to: segEnd });
					} else {
						reconciledInlineBlocks.push({ from: segFrom, to: segEnd });
					}
				}
				return undefined;
			},
		});
	}
}

function canMergeInlineParagraphAcrossBlocks(
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	phpBlockCodeRanges: ReadonlyArray<ScannedCodeRange>,
	displayMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	from: number,
	afterBlockTo: number,
	groupTo: number,
): boolean {
	const firstDisplayMath =
		displayMathRanges[findFirstMathRangeEndingAfter(displayMathRanges, from)];
	if (firstDisplayMath && firstDisplayMath.from < groupTo) {
		return false;
	}
	for (
		let i = findFirstBlockEndingAfter(blocks, afterBlockTo);
		i < blocks.length;
		i += 1
	) {
		const candidate = blocks[i];
		if (!candidate || candidate.from >= groupTo) break;
		if ("paragraph" === candidate.kind) continue;
		if (
			"code" === candidate.kind &&
			!inCodeRange(
				phpBlockCodeRanges,
				Math.max(afterBlockTo, candidate.from),
				Math.min(groupTo, candidate.to),
			)
		) {
			continue;
		}
		return false;
	}
	return true;
}

/**
 * Reconciles Lezer `code` blocks whose non-blank lines are not classified as
 * CommonMark block code by post-math PHP `phpBlockScan` (such as 4-space/tab
 * indented paragraphs, tables, display math, or nested reference definitions
 * immediately following a link reference definition like `[r]: /u\n    ...`).
 *
 * Genuine indented and fenced code blocks (including post-display-math indented
 * code lines and indented code blocks with interior blank lines) remain
 * untouched `code` blocks. Reconciled inline paragraphs and GFM tables are
 * returned so PHP's inline scanner owns their links, bare autolinks, and images.
 */
export function reconcilePhpNonCodeBlocks(
	source: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	phpBlockScan: ScannedMarkdownBlocks,
	phpMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	starts: ReadonlyArray<number>,
	nestedCodeBlocks: ReadonlyArray<SourceRange> = [],
): ReconciledPhpNonCodeBlocks {
	const phpBlockCodeRanges = phpBlockScan.blockCodeRanges;
	const lines = phpBlockScan.lines;
	const displayMathRanges = phpMathRanges.filter((range) => range.block);

	let reconciled: EditorMarkdownSourceBlock[] | null = null;
	const reconciledInlineBlocks: SourceRange[] = [];
	const reconciledTableBlocks: SourceRange[] = [];
	const evaluatedTableUntilLineIdx = { value: -1 };
	let codeIndex = 0;
	let consumedUntil = 0;

	for (let index = 0; index < blocks.length; index += 1) {
		const rawBlock = blocks[index];
		if (!rawBlock) continue;
		if (rawBlock.to <= consumedUntil) continue;

		const block =
			rawBlock.from < consumedUntil
				? trimBlockSlice(
						source,
						consumedUntil,
						rawBlock.to,
						starts,
						rawBlock.kind,
						rawBlock.editable,
					)
				: rawBlock;
		if (!block) continue;

		if ("code" !== block.kind) {
			if (reconciled) reconciled.push(block);
			continue;
		}

		const coverage = isBlockCoveredByCodeRanges(
			source,
			block,
			phpBlockCodeRanges,
			codeIndex,
		);
		codeIndex = coverage.nextCodeIndex;
		if (coverage.covered) {
			if (reconciled) reconciled.push(block);
			continue;
		}

		if (!reconciled) reconciled = blocks.slice(0, index);
		const out = reconciled;

		let pendingKind: PendingNonCodeSliceKind | null = null;
		let pendingFrom = -1;
		let pendingTo = -1;
		let pendingInlineBlockId = -1;

		const flushPending = (): void => {
			if (null === pendingKind || pendingFrom < 0 || pendingTo <= pendingFrom) {
				pendingKind = null;
				pendingFrom = -1;
				pendingTo = -1;
				pendingInlineBlockId = -1;
				return;
			}
			const blockKind: EditorMarkdownBlockKind =
				"code" === pendingKind
					? "code"
					: "unavailable" === pendingKind
						? "unavailable"
						: "paragraph";
			const slice = trimBlockSlice(
				source,
				pendingFrom,
				pendingTo,
				starts,
				blockKind,
				"unavailable" !== blockKind,
			);
			if (slice) {
				out.push(slice);
				if ("paragraph-inline" === pendingKind) {
					reconciledInlineBlocks.push(slice);
				}
			}
			pendingKind = null;
			pendingFrom = -1;
			pendingTo = -1;
			pendingInlineBlockId = -1;
		};

		const pushPending = (
			kind: PendingNonCodeSliceKind,
			from: number,
			to: number,
			inlineBlockId = -1,
		): void => {
			if (to <= from) return;
			if (
				pendingKind === kind &&
				("paragraph-inline" !== kind || pendingInlineBlockId === inlineBlockId)
			) {
				pendingTo = to;
				return;
			}
			flushPending();
			pendingKind = kind;
			pendingFrom = from;
			pendingTo = to;
			pendingInlineBlockId = inlineBlockId;
		};

		walkBlockLineSegments(block.from, block.to, lines, displayMathRanges, {
			onDisplayMath: (segFrom, segTo) => {
				pushPending("paragraph-math", segFrom, segTo);
			},
			onEmptySegment: () => {
				if ("code" !== pendingKind) flushPending();
			},
			onSegment: (segFrom, segEnd, line, lineIdx) => {
				if (inCodeRange(phpBlockCodeRanges, segFrom, segEnd)) {
					pushPending("code", segFrom, segEnd);
					return undefined;
				}

				if (0 === source.slice(segFrom, segEnd).trim().length) {
					if ("code" !== pendingKind) flushPending();
					return undefined;
				}

				if (line.isTableRow && line.inlineBlockId >= 0) {
					const tableLineSpan = findPhpTableSpanContainingLine(
						lines,
						lineIdx,
						evaluatedTableUntilLineIdx,
					);
					if (tableLineSpan) {
						const tableFrom =
							lines[tableLineSpan.startLineIdx]?.lineStart ?? -1;
						const tableTo = lines[tableLineSpan.endLineIdx]?.lineEnd ?? -1;
						if (
							tableFrom >= block.from &&
							tableFrom >= consumedUntil &&
							tableTo > tableFrom &&
							isValidReconciledPhpTableSpan({
								allowTrailingUnavailableBlocks: false,
								blocks,
								endLineIdx: tableLineSpan.endLineIdx,
								phpBlockScan,
								phpMathRanges,
								rejectCodeBlocks: false,
								source,
								startLineIdx: tableLineSpan.startLineIdx,
								tableFrom,
								tableTo,
							})
						) {
							flushPending();
							const tableBlock = trimBlockSlice(
								source,
								tableFrom,
								tableTo,
								starts,
								"table",
								true,
							);
							if (tableBlock) {
								out.push(tableBlock);
								reconciledTableBlocks.push(tableBlock);
							}
							if (tableTo > consumedUntil) consumedUntil = tableTo;
							const afterTable =
								lines[tableLineSpan.endLineIdx]?.nextLineStart ?? tableTo;
							return Math.min(block.to, Math.max(segEnd, afterTable));
						}
					}
				}

				if (line.inlineBlockId >= 0 && !line.isTableRow) {
					const bounds = getInlineBlockBounds(
						phpBlockScan,
						lineIdx,
						line.inlineBlockId,
					);
					const groupEndLine = lines[bounds.groupEnd];
					const groupTo = groupEndLine ? groupEndLine.lineEnd : segEnd;
					if (
						groupTo > block.to &&
						canMergeInlineParagraphAcrossBlocks(
							blocks,
							phpBlockCodeRanges,
							displayMathRanges,
							segFrom,
							block.to,
							groupTo,
						)
					) {
						let mergedFrom = segFrom;
						if (
							"paragraph-inline" === pendingKind &&
							pendingInlineBlockId === line.inlineBlockId &&
							pendingFrom >= 0
						) {
							mergedFrom = pendingFrom;
							pendingKind = null;
							pendingFrom = -1;
							pendingTo = -1;
							pendingInlineBlockId = -1;
						} else {
							flushPending();
						}
						const paraBlock = trimBlockSlice(
							source,
							mergedFrom,
							groupTo,
							starts,
							"paragraph",
							true,
						);
						if (paraBlock) {
							out.push(paraBlock);
							reconciledInlineBlocks.push(paraBlock);
						}
						if (groupTo > consumedUntil) consumedUntil = groupTo;
						return block.to;
					}
					pushPending("paragraph-inline", segFrom, segEnd, line.inlineBlockId);
					return undefined;
				}

				pushPending("unavailable", segFrom, segEnd);
				return undefined;
			},
		});

		flushPending();
	}

	if (nestedCodeBlocks.length > 0) {
		collectNestedNonCodeRanges(
			source,
			nestedCodeBlocks,
			phpBlockScan,
			displayMathRanges,
			reconciledInlineBlocks,
			reconciledTableBlocks,
		);
	}

	return {
		blocks: reconciled ?? blocks,
		reconciledInlineBlocks,
		reconciledTableBlocks,
	};
}
