import {
	COMMONMARK_ATX_HEADING_OPEN,
	COMMONMARK_FENCED_CODE_OPEN,
	COMMONMARK_THEMATIC_BREAK_LINE,
	countTableRowCells,
	matchHtmlBlockOpen,
	parseGfmTableSeparatorColumns,
} from "../../shared/markdown/php-commonmark-block-helpers";
import {
	advanceParagraphReferenceParser,
	createParagraphReferenceParser,
	type ParagraphReferenceParser,
} from "../../shared/markdown/php-commonmark-reference-def";
import {
	maskPhpMarkdownMathForTableScan,
	type PhpMarkdownMathRange,
	scanPhpMarkdownMathRanges,
} from "../../shared/markdown/php-markdown-math-mask";
import { parseReservedTableAlignmentMarkerLine } from "../../shared/table-alignment-marker";
import {
	type ContainerStep,
	canListMarkerInterruptParagraph,
	isCommonMarkBlankLine,
	matchListMarker,
	measureIndentColumns,
	type PeeledLineContainers,
	peelContainerStepsForLine,
	stripContainersWithColumn,
	stripPartialContainers,
} from "./markdown-prescanner-blocks";

/**
 * Feature-private PHP-exact math-range indexing, container-aware GFM table
 * boundary detection (including interleaved `list -> quote` containers,
 * multiline `\(...\)` rows, display-math table breaks, and PHP lazy table
 * continuations), and `<!-- easymde-table-align:v1 ... -->` matching.
 */

export type PhpDocumentMathIndex = Readonly<{
	lineEnds: ReadonlyArray<number>;
	lineStarts: ReadonlyArray<number>;
	maskedDoc: string;
	normalized: string;
	ranges: ReadonlyArray<PhpMarkdownMathRange>;
}>;

export type TableAlignMarkerMatch = Readonly<{
	containers: ReadonlyArray<ContainerStep>;
	markerPrefix: string;
	text: string;
}>;

export type GfmTableMatch = Readonly<{
	brokenByDisplayMathLine: number;
	containers: ReadonlyArray<ContainerStep>;
	delimiterLine: number;
	endLine: number;
	headerEndLine: number;
	lazyRowStartLines: ReadonlySet<number>;
}>;

export type GfmTableEndResult = Readonly<{
	brokenByDisplayMathLine: number;
	endLine: number;
	lazyRowStartLines: ReadonlySet<number>;
}>;

export function createPhpDocumentMathIndex(
	normalized: string,
	lines: ReadonlyArray<string>,
): PhpDocumentMathIndex {
	const lineStarts = new Array<number>(lines.length);
	const lineEnds = new Array<number>(lines.length);
	let offset = 0;
	for (let idx = 0; idx < lines.length; idx += 1) {
		const len = lines[idx]?.length ?? 0;
		lineStarts[idx] = offset;
		lineEnds[idx] = offset + len;
		offset += len + 1;
	}
	const ranges = scanPhpMarkdownMathRanges(normalized);
	const maskedDoc = maskPhpMarkdownMathForTableScan(normalized, ranges);
	return { lineEnds, lineStarts, maskedDoc, normalized, ranges };
}

export function findLineIndexForOffset(
	mathIndex: PhpDocumentMathIndex,
	offset: number,
): number {
	const { lineStarts } = mathIndex;
	let low = 0;
	let high = lineStarts.length - 1;
	let best = 0;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const start = lineStarts[mid] ?? 0;
		if (start <= offset) {
			best = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return best;
}

export function firstMathRangeEndingAfter(
	ranges: ReadonlyArray<PhpMarkdownMathRange>,
	offset: number,
): number {
	let low = 0;
	let high = ranges.length;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if ((ranges[mid]?.to ?? 0) <= offset) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return low;
}

export function findMathRangesInOffsetSlice(
	ranges: ReadonlyArray<PhpMarkdownMathRange>,
	startOffset: number,
	endOffset: number,
): PhpMarkdownMathRange[] {
	if (ranges.length === 0 || endOffset <= startOffset) {
		return [];
	}
	const result: PhpMarkdownMathRange[] = [];
	for (
		let idx = firstMathRangeEndingAfter(ranges, startOffset);
		idx < ranges.length;
		idx += 1
	) {
		const range = ranges[idx];
		if (!range || range.from >= endOffset) {
			break;
		}
		result.push(range);
	}
	return result;
}

/**
 * Returns inline (`block: false`) PHP math ranges fully contained in
 * `[startOffset, endOffset)`, shifted relative to `startOffset` plus an
 * optional `offsetShift` (e.g. virtual spaces prepended after a partially
 * consumed tab).
 */
export function collectRelativeInlineMathRanges(
	mathIndex: PhpDocumentMathIndex,
	startOffset: number,
	endOffset: number,
	offsetShift = 0,
	includeContainedDisplay = false,
): PhpMarkdownMathRange[] {
	const overlapping = findMathRangesInOffsetSlice(
		mathIndex.ranges,
		startOffset,
		endOffset,
	);
	const relative: PhpMarkdownMathRange[] = [];
	for (const range of overlapping) {
		if (
			(includeContainedDisplay || !range.block) &&
			range.from >= startOffset &&
			range.to <= endOffset
		) {
			relative.push({
				block: false,
				from: range.from - startOffset + offsetShift,
				to: range.to - startOffset + offsetShift,
			});
		}
	}
	return relative;
}

/**
 * Returns the last physical line belonging to the same logical PHP CommonMark
 * line starting at `startLine` when multiline inline math (`\(...\)`) bridges
 * trailing `\n` boundaries into one single-line token.
 */
export function findLogicalLineEnd(
	mathIndex: PhpDocumentMathIndex,
	startLine: number,
): number {
	const { lineEnds, ranges } = mathIndex;
	if (ranges.length === 0) {
		return startLine;
	}
	let endLine = startLine;
	const maxLine = lineEnds.length - 1;
	while (endLine < maxLine) {
		const nlOffset = lineEnds[endLine] ?? 0;
		const idx = firstMathRangeEndingAfter(ranges, nlOffset);
		const range = ranges[idx];
		if (!range || range.block || range.from > nlOffset) {
			break;
		}
		const targetLine = findLineIndexForOffset(
			mathIndex,
			Math.max(range.from, range.to - 1),
		);
		if (targetLine <= endLine) {
			break;
		}
		endLine = targetLine;
	}
	return endLine;
}

export function findFirstDisplayMathInLines(
	mathIndex: PhpDocumentMathIndex,
	startLine: number,
	endLine: number,
): PhpMarkdownMathRange | null {
	const startOffset = mathIndex.lineStarts[startLine] ?? 0;
	const endOffset = mathIndex.lineEnds[endLine] ?? startOffset;
	if (mathIndex.ranges.length === 0 || endOffset <= startOffset) {
		return null;
	}
	for (
		let idx = firstMathRangeEndingAfter(mathIndex.ranges, startOffset);
		idx < mathIndex.ranges.length;
		idx += 1
	) {
		const range = mathIndex.ranges[idx];
		if (!range || range.from >= endOffset) {
			break;
		}
		if (range.block) {
			return range;
		}
	}
	return null;
}

export function maskedSliceForLines(
	mathIndex: PhpDocumentMathIndex,
	lines: ReadonlyArray<string>,
	startLine: number,
	endLine: number,
): string {
	if (startLine === endLine && mathIndex.maskedDoc === mathIndex.normalized) {
		return lines[startLine] ?? "";
	}
	const startOffset = mathIndex.lineStarts[startLine] ?? 0;
	const endOffset = mathIndex.lineEnds[endLine] ?? startOffset;
	return mathIndex.maskedDoc.slice(startOffset, endOffset);
}

export function opensNonParagraphBlock(
	candidate: string,
	candidateColumn: number,
	inParagraph: boolean,
): boolean {
	if (measureIndentColumns(candidate, candidateColumn) >= 4) {
		return true;
	}
	const listMarker = matchListMarker(candidate, candidateColumn);
	if (
		listMarker !== null &&
		(!inParagraph || canListMarkerInterruptParagraph(listMarker))
	) {
		return true;
	}
	const trimmedStart = candidate.replace(/^[ \t]+/, "");
	return (
		trimmedStart.startsWith(">") ||
		COMMONMARK_ATX_HEADING_OPEN.test(trimmedStart) ||
		COMMONMARK_FENCED_CODE_OPEN.test(trimmedStart) ||
		COMMONMARK_THEMATIC_BREAK_LINE.test(trimmedStart) ||
		matchHtmlBlockOpen(trimmedStart, !inParagraph) !== null
	);
}

function startsInterruptingBlock(
	candidate: string,
	candidateColumn: number,
): boolean {
	if (measureIndentColumns(candidate, candidateColumn) >= 4) {
		return true;
	}
	if (matchListMarker(candidate, candidateColumn) !== null) {
		return true;
	}
	const trimmedStart = candidate.replace(/^[ \t]+/, "");
	return (
		trimmedStart.startsWith(">") ||
		COMMONMARK_ATX_HEADING_OPEN.test(trimmedStart) ||
		COMMONMARK_FENCED_CODE_OPEN.test(trimmedStart) ||
		COMMONMARK_THEMATIC_BREAK_LINE.test(trimmedStart) ||
		matchHtmlBlockOpen(trimmedStart, false) !== null
	);
}

/**
 * Validates that a container-peeled line (`peeled`) can legally start a GFM
 * table header paragraph and matches the GFM delimiter row on `maskedDelimiter`,
 * rejecting all non-paragraph CommonMark block openers (indented code, ATX
 * headings, fenced code, thematic breaks, HTML blocks Types 1–6 and Type 7
 * outside an open paragraph, blockquotes, list markers, and CommonMark §4.7
 * link reference definitions / titles).
 */
export function matchPeeledGfmTableHeader(
	peeled: PeeledLineContainers,
	maskedDelimiter: string,
	inParagraph: boolean,
	activeRefParser: ParagraphReferenceParser | null = null,
): boolean {
	if (
		!peeled.rest.includes("|") ||
		opensNonParagraphBlock(peeled.rest, peeled.column, inParagraph)
	) {
		return false;
	}
	const delimiterStripped = stripContainersWithColumn(
		maskedDelimiter,
		peeled.containers,
	);
	if (delimiterStripped === null) {
		return false;
	}
	if (
		measureIndentColumns(delimiterStripped.rest, delimiterStripped.column) >=
			4 ||
		matchListMarker(delimiterStripped.rest, delimiterStripped.column) !== null
	) {
		return false;
	}
	const delimiterColumns = parseGfmTableSeparatorColumns(
		delimiterStripped.rest,
	);
	if (
		delimiterColumns === 0 ||
		countTableRowCells(peeled.rest) !== delimiterColumns
	) {
		return false;
	}
	const probeRefParser: ParagraphReferenceParser | null = !inParagraph
		? createParagraphReferenceParser()
		: activeRefParser !== null && activeRefParser.state !== "paragraph"
			? {
					labelBuffer: activeRefParser.labelBuffer,
					labelCodePoints: activeRefParser.labelCodePoints,
					labelHasNonWhitespace: activeRefParser.labelHasNonWhitespace,
					referenceValid: activeRefParser.referenceValid,
					state: activeRefParser.state,
					titleDelimiter: activeRefParser.titleDelimiter,
				}
			: null;
	if (
		probeRefParser !== null &&
		(advanceParagraphReferenceParser(probeRefParser, peeled.rest) ||
			(probeRefParser.state === "destination" &&
				advanceParagraphReferenceParser(
					probeRefParser,
					delimiterStripped.rest,
				)))
	) {
		return false;
	}
	return true;
}

export function findGfmTableEnd(
	lines: ReadonlyArray<string>,
	delimiterLine: number,
	tableContainers: ReadonlyArray<ContainerStep>,
	mathIndex: PhpDocumentMathIndex,
): GfmTableEndResult {
	let endLine = delimiterLine;
	let brokenByDisplayMathLine = -1;
	const lazyRowStartLines = new Set<number>();

	let index = delimiterLine + 1;
	while (index < lines.length) {
		const logicalEnd = findLogicalLineEnd(mathIndex, index);
		const firstDisplayMath = findFirstDisplayMathInLines(
			mathIndex,
			index,
			logicalEnd,
		);
		if (firstDisplayMath !== null) {
			const lineStart = mathIndex.lineStarts[index] ?? 0;
			if (firstDisplayMath.from >= lineStart) {
				const rawBefore = mathIndex.normalized.slice(
					lineStart,
					firstDisplayMath.from,
				);
				const strippedBefore =
					tableContainers.length > 0
						? stripPartialContainers(rawBefore, tableContainers)
						: { column: 0, consumedLength: 0, remainder: rawBefore };
				if (
					isCommonMarkBlankLine(strippedBefore.remainder) ||
					!startsInterruptingBlock(
						strippedBefore.remainder,
						strippedBefore.column,
					)
				) {
					brokenByDisplayMathLine = index;
				}
			}
			break;
		}

		const maskedLogical = maskedSliceForLines(
			mathIndex,
			lines,
			index,
			logicalEnd,
		);
		const stripped = stripContainersWithColumn(maskedLogical, tableContainers);
		if (stripped !== null) {
			const candidate = stripped.rest;
			const candidateColumn = stripped.column;
			if (isCommonMarkBlankLine(candidate)) {
				break;
			}
			if (
				!candidate.includes("|") ||
				startsInterruptingBlock(candidate, candidateColumn)
			) {
				break;
			}
			endLine = logicalEnd;
			index = logicalEnd + 1;
			continue;
		}

		if (tableContainers.length === 0) {
			break;
		}

		const partial = stripPartialContainers(maskedLogical, tableContainers);
		if (
			isCommonMarkBlankLine(partial.remainder) ||
			!partial.remainder.includes("|") ||
			startsInterruptingBlock(partial.remainder, partial.column)
		) {
			break;
		}
		lazyRowStartLines.add(index);
		endLine = logicalEnd;
		index = logicalEnd + 1;
	}

	return { brokenByDisplayMathLine, endLine, lazyRowStartLines };
}

export function resolveGfmTableMatch(
	lines: ReadonlyArray<string>,
	headerIndex: number,
	baseContainers: ReadonlyArray<ContainerStep>,
	preMarkerListIndent: number,
	allowLeadingListMarker: boolean,
	allowAdditionalContainers: boolean,
	mathIndex: PhpDocumentMathIndex,
	inParagraph = false,
	activeRefParser: ParagraphReferenceParser | null = null,
): GfmTableMatch | null {
	if (headerIndex + 1 >= lines.length) {
		return null;
	}
	const headerEndLine = findLogicalLineEnd(mathIndex, headerIndex);
	if (
		headerEndLine === headerIndex &&
		!(lines[headerIndex] ?? "").includes("|")
	) {
		return null;
	}
	const delimiterLine = headerEndLine + 1;
	if (
		delimiterLine >= lines.length ||
		!(lines[delimiterLine] ?? "").includes("-")
	) {
		return null;
	}
	if (findFirstDisplayMathInLines(mathIndex, headerIndex, headerEndLine)) {
		return null;
	}
	if (
		findLogicalLineEnd(mathIndex, delimiterLine) !== delimiterLine ||
		findFirstDisplayMathInLines(mathIndex, delimiterLine, delimiterLine) !==
			null
	) {
		return null;
	}

	const maskedHeader = maskedSliceForLines(
		mathIndex,
		lines,
		headerIndex,
		headerEndLine,
	);
	const maskedDelimiter = maskedSliceForLines(
		mathIndex,
		lines,
		delimiterLine,
		delimiterLine,
	);
	const peeled = peelContainerStepsForLine(
		maskedHeader,
		baseContainers,
		preMarkerListIndent,
		allowLeadingListMarker,
		allowAdditionalContainers,
	);
	if (peeled === null) {
		return null;
	}
	const baseContainerCount =
		baseContainers.length + (preMarkerListIndent > 0 ? 1 : 0);
	const effectiveInParagraph =
		inParagraph && peeled.containers.length === baseContainerCount;
	if (
		!matchPeeledGfmTableHeader(
			peeled,
			maskedDelimiter,
			effectiveInParagraph,
			effectiveInParagraph ? activeRefParser : null,
		)
	) {
		return null;
	}

	const tableEnd = findGfmTableEnd(
		lines,
		delimiterLine,
		peeled.containers,
		mathIndex,
	);
	return {
		brokenByDisplayMathLine: tableEnd.brokenByDisplayMathLine,
		containers: peeled.containers,
		delimiterLine,
		endLine: tableEnd.endLine,
		headerEndLine,
		lazyRowStartLines: tableEnd.lazyRowStartLines,
	};
}

export function matchTableAlignmentMarkerLine(
	lines: ReadonlyArray<string>,
	lineIndex: number,
	baseContainers: ReadonlyArray<ContainerStep>,
	preMarkerListIndent: number,
	allowLeadingListMarker: boolean,
	mathIndex: PhpDocumentMathIndex,
): TableAlignMarkerMatch | null {
	const line = lines[lineIndex] ?? "";
	if (!line.includes("<!--")) {
		return null;
	}
	const peeled = peelContainerStepsForLine(
		line,
		baseContainers,
		preMarkerListIndent,
		allowLeadingListMarker,
		true,
	);
	if (peeled === null || measureIndentColumns(peeled.rest, peeled.column) > 3) {
		return null;
	}
	const parsed = parseReservedTableAlignmentMarkerLine(peeled.rest);
	if (parsed === null || "code" in parsed) {
		return null;
	}
	const followingTable = resolveGfmTableMatch(
		lines,
		lineIndex + 1,
		peeled.containers,
		0,
		false,
		false,
		mathIndex,
	);
	if (followingTable === null) {
		return null;
	}
	return {
		containers: peeled.containers,
		markerPrefix: `${peeled.linePrefix}${" ".repeat(parsed.fromOffset)}`,
		text: parsed.text,
	};
}
