import type { EditorMarkdownSourceBlock } from "../../contracts/ports/editor-block-index-port";
import {
	findLineIndexAtOffset,
	findTableRowCellInCells,
	getCachedPhpTableRowCells,
	getInlineBlockBounds,
	type ScannedMarkdownBlocks,
	type ScannedMarkdownLine,
	scanPhpCommonMarkBlocks,
	type TableRowCellRange,
} from "../../shared/markdown/php-commonmark-block-scan";
import type { ParserLinkNode } from "./editor-markdown-link-preparation";
import {
	createMathCrossingQuery,
	type PhpOwnedBlockLinks,
	type PhpReconciledBlockImage,
	type PhpReconciledBlocksContent,
	scanPhpInlineBlockLinks,
	scanPhpTableCellLinks,
} from "./editor-markdown-php-inline-scan";
import type { SourceRange } from "./editor-markdown-source-projection";

export { collectUncoveredBareAutolinkOffsets } from "./editor-markdown-php-autolink-offsets";
export type {
	PhpOwnedBlockLinks,
	PhpReconciledBlockImage,
	PhpReconciledBlocksContent,
};

type InlineBlockScope = Readonly<{
	from: number;
	groupEnd: number;
	groupStart: number;
	kind: "inline";
	to: number;
}>;

type PhpOwnedInlineScope =
	| InlineBlockScope
	| Readonly<{
			from: number;
			kind: "table-cell";
			line: ScannedMarkdownLine;
			to: number;
	  }>;

type LocalBareAutolinkScope =
	| InlineBlockScope
	| Readonly<{
			from: number;
			kind: "excluded";
			to: number;
	  }>;

type InlineBlockScopeSink = Readonly<{
	push: (scope: InlineBlockScope) => number;
}>;

function firstCellIndexEndingAfter(
	cells: ReadonlyArray<TableRowCellRange>,
	offset: number,
): number {
	let low = 0;
	let high = cells.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if ((cells[middle]?.end ?? 0) <= offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

function collectNonDisplayMathSlices(
	brokenImageRanges: ReadonlyArray<SourceRange>,
	displayMathRanges: ReadonlyArray<SourceRange>,
): SourceRange[] {
	const sortedImages = [...brokenImageRanges].sort(
		(left, right) => left.from - right.from || left.to - right.to,
	);
	const slices: SourceRange[] = [];
	let mathIdx = 0;
	for (let i = 0; i < sortedImages.length; i += 1) {
		const image = sortedImages[i];
		if (!image || image.to <= image.from) continue;
		while (
			mathIdx < displayMathRanges.length &&
			(displayMathRanges[mathIdx]?.to ?? 0) <= image.from
		) {
			mathIdx += 1;
		}
		let cursor = image.from;
		let probe = mathIdx;
		while (probe < displayMathRanges.length) {
			const math = displayMathRanges[probe];
			if (!math || math.from >= image.to) break;
			if (math.from > cursor) slices.push({ from: cursor, to: math.from });
			cursor = Math.max(cursor, math.to);
			probe += 1;
		}
		if (cursor < image.to) slices.push({ from: cursor, to: image.to });
	}
	return slices;
}

function pushTableCellScope(
	scopes: PhpOwnedInlineScope[],
	seenCells: Set<string>,
	line: ScannedMarkdownLine,
	cell: TableRowCellRange,
): void {
	if (cell.end <= cell.start) return;
	const cellKey = `${cell.start}:${cell.end}`;
	if (seenCells.has(cellKey)) return;
	seenCells.add(cellKey);
	scopes.push({ from: cell.start, kind: "table-cell", line, to: cell.end });
}

function pushInlineBlockScope(
	scopes: InlineBlockScopeSink,
	seenBlockIds: Set<number>,
	scan: ScannedMarkdownBlocks,
	sourceLength: number,
	lineIdx: number,
	inlineBlockId: number,
): number {
	const bounds = getInlineBlockBounds(scan, lineIdx, inlineBlockId);
	if (seenBlockIds.has(inlineBlockId)) return bounds.groupEnd;
	seenBlockIds.add(inlineBlockId);
	const from = scan.lines[bounds.groupStart]?.contentOffset ?? 0;
	const to = scan.lines[bounds.groupEnd]?.lineEnd ?? sourceLength;
	if (to > from) {
		scopes.push({
			from,
			groupEnd: bounds.groupEnd,
			groupStart: bounds.groupStart,
			kind: "inline",
			to,
		});
	}
	return bounds.groupEnd;
}

function collectEscapedPipeTableCells(
	source: string,
	scan: ScannedMarkdownBlocks,
	scopes: PhpOwnedInlineScope[],
	seenCells: Set<string>,
): void {
	const text = scan.tableCellSource ?? source;
	let searchPos = text.indexOf("\\|", 0);
	while (searchPos >= 0) {
		const lineIdx = findLineIndexAtOffset(scan.lines, searchPos);
		if (lineIdx < 0) break;
		const line = scan.lines[lineIdx];
		if (!line) break;
		if (
			line.isTableRow &&
			line.inlineBlockId >= 0 &&
			searchPos >= line.contentOffset &&
			searchPos < line.lineEnd
		) {
			const cells = getCachedPhpTableRowCells(source, scan, line);
			const cell = findTableRowCellInCells(cells, searchPos);
			if (cell && cell.end > cell.start) {
				pushTableCellScope(scopes, seenCells, line, cell);
				searchPos = text.indexOf("\\|", cell.end);
				continue;
			}
		}
		searchPos = text.indexOf(
			"\\|",
			Math.max(searchPos + 2, line.nextLineStart),
		);
	}
}

function collectReconciledTableCellScopes(
	source: string,
	scan: ScannedMarkdownBlocks,
	reconciledTableBlocks: ReadonlyArray<SourceRange>,
	scopes: PhpOwnedInlineScope[],
	seenCells: Set<string>,
): void {
	for (let i = 0; i < reconciledTableBlocks.length; i += 1) {
		const block = reconciledTableBlocks[i];
		if (!block || block.to <= block.from) continue;
		const startLineIdx = findLineIndexAtOffset(scan.lines, block.from);
		const endLineIdx = findLineIndexAtOffset(
			scan.lines,
			Math.max(block.from, block.to - 1),
		);
		if (startLineIdx < 0 || endLineIdx < startLineIdx) continue;
		for (let lineIdx = startLineIdx; lineIdx <= endLineIdx; lineIdx += 1) {
			const line = scan.lines[lineIdx];
			if (!line?.isTableRow || line.inlineBlockId < 0) continue;
			const cells = getCachedPhpTableRowCells(source, scan, line);
			for (let cellIdx = 0; cellIdx < cells.length; cellIdx += 1) {
				const cell = cells[cellIdx];
				if (cell) pushTableCellScope(scopes, seenCells, line, cell);
			}
		}
	}
}

function collectReconciledInlineBlockScopes(
	source: string,
	scan: ScannedMarkdownBlocks,
	reconciledInlineBlocks: ReadonlyArray<SourceRange>,
	scopes: PhpOwnedInlineScope[],
	seenBlockIds: Set<number>,
): void {
	for (let i = 0; i < reconciledInlineBlocks.length; i += 1) {
		const block = reconciledInlineBlocks[i];
		if (!block || block.to <= block.from) continue;
		const startLineIdx = findLineIndexAtOffset(scan.lines, block.from);
		const endLineIdx = findLineIndexAtOffset(
			scan.lines,
			Math.max(block.from, block.to - 1),
		);
		if (startLineIdx < 0 || endLineIdx < startLineIdx) continue;
		for (let lineIdx = startLineIdx; lineIdx <= endLineIdx; lineIdx += 1) {
			const line = scan.lines[lineIdx];
			if (!line || line.inlineBlockId < 0 || line.isTableRow) continue;
			lineIdx = pushInlineBlockScope(
				scopes,
				seenBlockIds,
				scan,
				source.length,
				lineIdx,
				line.inlineBlockId,
			);
		}
	}
}

function rangeCoveredBySorted(
	ranges: ReadonlyArray<SourceRange>,
	from: number,
	to: number,
): boolean {
	if (0 === ranges.length) return false;
	let low = 0;
	let high = ranges.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const range = ranges[middle];
		if (!range) return false;
		if (range.to <= from) low = middle + 1;
		else if (range.from >= to) high = middle - 1;
		else return range.from <= from && to <= range.to;
	}
	return false;
}

function scanOwnedInlineScopes(
	source: string,
	scan: ScannedMarkdownBlocks,
	scopes: PhpOwnedInlineScope[],
	isReferenceDefined: (from: number, to: number) => boolean,
	mathRanges: ReadonlyArray<SourceRange>,
	options?: Readonly<{
		imagesOut?: PhpReconciledBlockImage[];
		skipOwnedRanges?: ReadonlyArray<SourceRange>;
	}>,
): PhpOwnedBlockLinks {
	const crossesMath = createMathCrossingQuery(mathRanges);
	scopes.sort((left, right) => left.from - right.from || left.to - right.to);
	const text = scan.tableCellSource ?? source;
	const ownedRanges: SourceRange[] = [];
	const links: ParserLinkNode[] = [];
	const imagesOut = options?.imagesOut;
	const skipOwnedRanges = options?.skipOwnedRanges;

	for (let i = 0; i < scopes.length; i += 1) {
		const scope = scopes[i];
		if (!scope) continue;
		if (
			skipOwnedRanges &&
			skipOwnedRanges.length > 0 &&
			rangeCoveredBySorted(skipOwnedRanges, scope.from, scope.to)
		) {
			continue;
		}
		ownedRanges.push({ from: scope.from, to: scope.to });
		const found =
			"table-cell" === scope.kind
				? scanPhpTableCellLinks(
						text,
						scope.line,
						scope.from,
						scope.to,
						isReferenceDefined,
						crossesMath,
						imagesOut,
					)
				: scanPhpInlineBlockLinks(
						text,
						scan.lines,
						scope.groupStart,
						scope.groupEnd,
						isReferenceDefined,
						crossesMath,
						imagesOut,
					);
		for (let j = 0; j < found.length; j += 1) {
			const link = found[j];
			if (link) links.push(link);
		}
	}
	return { links, ownedRanges };
}

/**
 * Takes sole PHP inline ownership for every reconciled paragraph block and
 * reconciled GFM table cell (where Lezer originally parsed a `CodeBlock` or
 * `unavailable` block), returning all PHP-rendered links, bare autolinks, and
 * inline/reference images in one single pass.
 */
export function collectPhpReconciledBlocksContent(
	source: string,
	scan: ScannedMarkdownBlocks,
	reconciledInlineBlocks: ReadonlyArray<SourceRange>,
	reconciledTableBlocks: ReadonlyArray<SourceRange>,
	isReferenceDefined: (from: number, to: number) => boolean,
	mathRanges: ReadonlyArray<SourceRange> = [],
): PhpReconciledBlocksContent {
	const scopes: PhpOwnedInlineScope[] = [];
	const seenBlockIds = new Set<number>();
	const seenCells = new Set<string>();

	if (reconciledInlineBlocks.length > 0) {
		collectReconciledInlineBlockScopes(
			source,
			scan,
			reconciledInlineBlocks,
			scopes,
			seenBlockIds,
		);
	}
	if (reconciledTableBlocks.length > 0) {
		collectReconciledTableCellScopes(
			source,
			scan,
			reconciledTableBlocks,
			scopes,
			seenCells,
		);
	}

	const images: PhpReconciledBlockImage[] = [];
	const { links, ownedRanges } = scanOwnedInlineScopes(
		source,
		scan,
		scopes,
		isReferenceDefined,
		mathRanges,
		{ imagesOut: images },
	);
	return { images, links, ownedRanges };
}

/** Merges two sorted range arrays in O(N) ordered by `(from, to)`. */
export function mergeSortedByRange<T extends SourceRange>(
	first: ReadonlyArray<T>,
	second: ReadonlyArray<T>,
): T[] {
	if (0 === first.length) return [...second];
	if (0 === second.length) return [...first];
	const merged: T[] = [];
	let a = 0;
	let b = 0;
	while (a < first.length && b < second.length) {
		const left = first[a];
		const right = second[b];
		if (!left || !right) break;
		if (
			left.from < right.from ||
			(left.from === right.from && left.to <= right.to)
		) {
			merged.push(left);
			a += 1;
		} else {
			merged.push(right);
			b += 1;
		}
	}
	while (a < first.length) {
		const left = first[a];
		if (left) merged.push(left);
		a += 1;
	}
	while (b < second.length) {
		const right = second[b];
		if (right) merged.push(right);
		b += 1;
	}
	return merged;
}

/** Merges two disjoint sorted PHP-owned block-link results in O(N). */
export function mergePhpOwnedBlockLinks(
	first: PhpOwnedBlockLinks,
	second: PhpOwnedBlockLinks,
): PhpOwnedBlockLinks {
	if (0 === first.ownedRanges.length) return second;
	if (0 === second.ownedRanges.length) return first;
	return {
		links: mergeSortedByRange(first.links, second.links),
		ownedRanges: mergeSortedByRange(first.ownedRanges, second.ownedRanges),
	};
}

function collectBareAutolinkScopesInScan(
	source: string,
	scan: ScannedMarkdownBlocks,
	bareAutolinkOffsets: ReadonlyArray<number>,
	scopes: PhpOwnedInlineScope[],
	seenBlockIds: Set<number>,
	seenCells: Set<string>,
): void {
	for (let i = 0; i < bareAutolinkOffsets.length; i += 1) {
		const offset = bareAutolinkOffsets[i];
		if (undefined === offset || offset < 0 || offset >= source.length) continue;
		const lineIdx = findLineIndexAtOffset(scan.lines, offset);
		if (lineIdx < 0) continue;
		const line = scan.lines[lineIdx];
		if (
			!line ||
			line.inlineBlockId < 0 ||
			offset < line.contentOffset ||
			offset >= line.lineEnd
		) {
			continue;
		}
		if (!line.isTableRow) {
			pushInlineBlockScope(
				scopes,
				seenBlockIds,
				scan,
				source.length,
				lineIdx,
				line.inlineBlockId,
			);
			continue;
		}
		const cells = getCachedPhpTableRowCells(source, scan, line);
		const cell = findTableRowCellInCells(cells, offset);
		if (cell) pushTableCellScope(scopes, seenCells, line, cell);
	}
}

type CollectPhpDisplayMathBrokenBlockLinksOptions = Readonly<{
	bareAutolinkOffsets?: ReadonlyArray<number>;
	brokenImageRanges: ReadonlyArray<SourceRange>;
	displayMathRanges: ReadonlyArray<SourceRange>;
	includeEscapedPipeTableCells?: boolean;
	isReferenceDefined: (from: number, to: number) => boolean;
	mathRanges?: ReadonlyArray<SourceRange>;
	scan: ScannedMarkdownBlocks;
	skipOwnedRanges?: ReadonlyArray<SourceRange>;
	source: string;
}>;

/**
 * Takes sole link ownership for every PHP inline block and GFM table cell
 * touched by a display-math-broken Lezer image (both pre-math and post-math
 * fragments), optionally for every GFM table cell containing an escaped pipe
 * `\|` outside math spans, and optionally for ordinary inline blocks and table
 * cells containing uncovered bare GFM autolink triggers.
 */
export function collectPhpDisplayMathBrokenBlockLinks(
	options: CollectPhpDisplayMathBrokenBlockLinksOptions,
): PhpOwnedBlockLinks {
	const {
		bareAutolinkOffsets,
		brokenImageRanges,
		displayMathRanges,
		includeEscapedPipeTableCells = false,
		isReferenceDefined,
		mathRanges = [],
		scan,
		skipOwnedRanges,
		source,
	} = options;
	const slices = collectNonDisplayMathSlices(
		brokenImageRanges,
		displayMathRanges,
	);
	const scopes: PhpOwnedInlineScope[] = [];
	const seenBlockIds = new Set<number>();
	const seenCells = new Set<string>();

	for (let i = 0; i < slices.length; i += 1) {
		const slice = slices[i];
		if (!slice || slice.to <= slice.from) continue;
		const startLineIdx = findLineIndexAtOffset(scan.lines, slice.from);
		const endLineIdx = findLineIndexAtOffset(scan.lines, slice.to - 1);
		if (startLineIdx < 0 || endLineIdx < startLineIdx) continue;
		for (let lineIdx = startLineIdx; lineIdx <= endLineIdx; lineIdx += 1) {
			const line = scan.lines[lineIdx];
			if (!line || line.inlineBlockId < 0) continue;
			if (!line.isTableRow) {
				lineIdx = pushInlineBlockScope(
					scopes,
					seenBlockIds,
					scan,
					source.length,
					lineIdx,
					line.inlineBlockId,
				);
				continue;
			}
			const segFrom = Math.max(slice.from, line.contentOffset);
			const segTo = Math.min(slice.to, line.lineEnd);
			if (segTo <= segFrom) continue;
			const cells = getCachedPhpTableRowCells(source, scan, line);
			if (0 === cells.length) continue;
			for (
				let cellIdx = firstCellIndexEndingAfter(cells, segFrom);
				cellIdx < cells.length;
				cellIdx += 1
			) {
				const cell = cells[cellIdx];
				if (!cell || cell.start >= segTo) break;
				pushTableCellScope(scopes, seenCells, line, cell);
			}
		}
	}

	if (includeEscapedPipeTableCells) {
		collectEscapedPipeTableCells(source, scan, scopes, seenCells);
	}

	if (bareAutolinkOffsets && bareAutolinkOffsets.length > 0) {
		collectBareAutolinkScopesInScan(
			source,
			scan,
			bareAutolinkOffsets,
			scopes,
			seenBlockIds,
			seenCells,
		);
	}

	return scanOwnedInlineScopes(
		source,
		scan,
		scopes,
		isReferenceDefined,
		mathRanges,
		skipOwnedRanges ? { skipOwnedRanges } : undefined,
	);
}

/**
 * Reconciles bare GFM autolinks against PHP `AutolinkExtension` on pipe-free,
 * math-free documents by scanning ONLY the specific editable top-level blocks
 * touched by `bareAutolinkOffsets` instead of scanning the full document.
 */
export function collectLocalPhpBareAutolinkBlockLinks(
	source: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	bareAutolinkOffsets: ReadonlyArray<number>,
	isReferenceDefined: (from: number, to: number) => boolean,
): PhpOwnedBlockLinks {
	const ownedRanges: SourceRange[] = [];
	const links: ParserLinkNode[] = [];
	let blockIdx = 0;
	let offsetIdx = 0;

	while (offsetIdx < bareAutolinkOffsets.length) {
		const firstOffset = bareAutolinkOffsets[offsetIdx];
		if (undefined === firstOffset) break;
		while (
			blockIdx < blocks.length &&
			(blocks[blockIdx]?.to ?? 0) <= firstOffset
		) {
			blockIdx += 1;
		}
		const block = blocks[blockIdx];
		if (!block) break;
		if (firstOffset < block.from) {
			offsetIdx += 1;
			continue;
		}
		const blockStartOffsetIdx = offsetIdx;
		while (
			offsetIdx < bareAutolinkOffsets.length &&
			(bareAutolinkOffsets[offsetIdx] ?? source.length) < block.to
		) {
			offsetIdx += 1;
		}
		if (
			!block.editable ||
			"code" === block.kind ||
			"math" === block.kind ||
			"unavailable" === block.kind
		) {
			continue;
		}
		const blockSlice = source.slice(block.from, block.to);
		const blockScan = scanPhpCommonMarkBlocks(blockSlice);
		const seenBlockIds = new Set<number>();
		const seenExcludedLines = new Set<number>();
		const localScopes: LocalBareAutolinkScope[] = [];
		for (let i = blockStartOffsetIdx; i < offsetIdx; i += 1) {
			const globalOffset = bareAutolinkOffsets[i];
			if (undefined === globalOffset) continue;
			const localOffset = globalOffset - block.from;
			const lineIdx = findLineIndexAtOffset(blockScan.lines, localOffset);
			if (lineIdx < 0) continue;
			const line = blockScan.lines[lineIdx];
			if (!line) continue;
			if (line.inlineBlockId < 0) {
				if (!seenExcludedLines.has(lineIdx) && line.lineEnd > line.lineStart) {
					seenExcludedLines.add(lineIdx);
					localScopes.push({
						from: line.lineStart,
						kind: "excluded",
						to: line.lineEnd,
					});
				}
				continue;
			}
			if (localOffset < line.contentOffset || localOffset >= line.lineEnd) {
				continue;
			}
			pushInlineBlockScope(
				localScopes,
				seenBlockIds,
				blockScan,
				blockSlice.length,
				lineIdx,
				line.inlineBlockId,
			);
		}
		localScopes.sort(
			(left, right) => left.from - right.from || left.to - right.to,
		);
		for (let i = 0; i < localScopes.length; i += 1) {
			const scope = localScopes[i];
			if (!scope) continue;
			ownedRanges.push({
				from: block.from + scope.from,
				to: block.from + scope.to,
			});
			if ("excluded" === scope.kind) continue;
			const found = scanPhpInlineBlockLinks(
				blockSlice,
				blockScan.lines,
				scope.groupStart,
				scope.groupEnd,
				(cFrom, cTo) =>
					isReferenceDefined(block.from + cFrom, block.from + cTo),
			);
			for (let j = 0; j < found.length; j += 1) {
				const link = found[j];
				if (link) {
					links.push({
						from: block.from + link.from,
						kind: link.kind,
						reference: link.reference,
						to: block.from + link.to,
					});
				}
			}
		}
	}

	return { links, ownedRanges };
}
