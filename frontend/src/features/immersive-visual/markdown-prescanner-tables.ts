import {
	COMMONMARK_ATX_HEADING_OPEN,
	COMMONMARK_FENCED_CODE_OPEN,
	COMMONMARK_SETEXT_UNDERLINE,
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

export function findFirstDisplayMathInOffsetSlice(
	mathIndex: PhpDocumentMathIndex,
	fromOffset: number,
	toOffset: number,
): PhpMarkdownMathRange | null {
	if (mathIndex.ranges.length === 0 || toOffset <= fromOffset) {
		return null;
	}
	for (
		let idx = firstMathRangeEndingAfter(mathIndex.ranges, fromOffset);
		idx < mathIndex.ranges.length;
		idx += 1
	) {
		const range = mathIndex.ranges[idx];
		if (!range || range.from >= toOffset) {
			break;
		}
		if (range.block && range.from >= fromOffset) {
			return range;
		}
	}
	return null;
}

export function findFirstDisplayMathInLines(
	mathIndex: PhpDocumentMathIndex,
	startLine: number,
	endLine: number,
): PhpMarkdownMathRange | null {
	const startOffset = mathIndex.lineStarts[startLine] ?? 0;
	const endOffset = mathIndex.lineEnds[endLine] ?? startOffset;
	return findFirstDisplayMathInOffsetSlice(mathIndex, startOffset, endOffset);
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
		return !inParagraph;
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
		(inParagraph && COMMONMARK_SETEXT_UNDERLINE.test(trimmedStart)) ||
		COMMONMARK_FENCED_CODE_OPEN.test(trimmedStart) ||
		COMMONMARK_THEMATIC_BREAK_LINE.test(trimmedStart) ||
		matchHtmlBlockOpen(trimmedStart, !inParagraph) !== null
	);
}

/**
 * Exact PHP `League\CommonMark` priority guard for a candidate GFM table
 * delimiter line interrupting an open paragraph: returns `true` when any
 * higher-priority block start parser — BlockQuote (70), Heading/Setext (60),
 * FencedCode (50), HtmlBlock Types 1–6 (40), ThematicBreak (20), or
 * ListBlock (10) — interrupts the open paragraph before `TableStartParser`
 * (priority 0) runs. Lines indented >= 4 columns are never interrupted because
 * every higher-priority parser rejects indented lines and
 * `TableStartParser::parseSeparator()` skips all leading spaces and tabs.
 */
export function isTableSeparatorInterruptedByHigherPriorityBlock(
	candidate: string,
	candidateColumn: number,
	relativeIndentColumns = measureIndentColumns(candidate, candidateColumn),
): boolean {
	if (relativeIndentColumns >= 4) {
		return false;
	}
	return opensNonParagraphBlock(candidate, candidateColumn, true);
}

function startsLazyParagraphInterruptingBlock(
	candidate: string,
	candidateColumn: number,
): boolean {
	if (measureIndentColumns(candidate, candidateColumn) >= 4) {
		return false;
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

function refParserAbsorbsHeaderOrDelimiter(
	headerRest: string,
	delimiterRest: string,
	inParagraph: boolean,
	activeRefParser: ParagraphReferenceParser | null,
): boolean {
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
	return (
		probeRefParser !== null &&
		(advanceParagraphReferenceParser(probeRefParser, headerRest) ||
			(probeRefParser.state === "destination" &&
				advanceParagraphReferenceParser(probeRefParser, delimiterRest)))
	);
}

/**
 * Validates that a container-peeled line (`peeled`) can legally start a GFM
 * table header paragraph and matches the GFM delimiter row on `maskedDelimiter`,
 * rejecting all non-paragraph CommonMark block openers (indented code, ATX
 * headings, Setext underlines, fenced code, thematic breaks, HTML blocks
 * Types 1–6 and Type 7 outside an open paragraph, blockquotes, list markers,
 * higher-priority interrupting blocks on the delimiter row, and CommonMark
 * §4.7 link reference definitions / titles).
 */
export function matchPeeledGfmTableHeader(
	peeled: PeeledLineContainers,
	maskedDelimiter: string,
	inParagraph: boolean,
	activeRefParser: ParagraphReferenceParser | null = null,
	paragraphHasPipe = false,
): boolean {
	if (
		(!peeled.rest.includes("|") && !(inParagraph && paragraphHasPipe)) ||
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
		isTableSeparatorInterruptedByHigherPriorityBlock(
			delimiterStripped.rest,
			delimiterStripped.column,
		)
	) {
		return false;
	}
	const delimiterColumns = parseGfmTableSeparatorColumns(
		delimiterStripped.rest,
	);
	const headerCells = countTableRowCells(peeled.rest);
	if (
		delimiterColumns === 0 ||
		headerCells === 0 ||
		headerCells > delimiterColumns
	) {
		return false;
	}
	if (
		refParserAbsorbsHeaderOrDelimiter(
			peeled.rest,
			delimiterStripped.rest,
			inParagraph,
			activeRefParser,
		)
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
				const maskedBefore = mathIndex.maskedDoc.slice(
					lineStart,
					firstDisplayMath.from,
				);
				const fullBefore = stripContainersWithColumn(
					maskedBefore,
					tableContainers,
				);
				if (fullBefore !== null) {
					if (
						isCommonMarkBlankLine(fullBefore.rest) ||
						fullBefore.rest.includes("|") ||
						!startsInterruptingBlock(fullBefore.rest, fullBefore.column)
					) {
						brokenByDisplayMathLine = index;
					}
				} else {
					const partialBefore = stripPartialContainers(
						maskedBefore,
						tableContainers,
					);
					if (
						isCommonMarkBlankLine(partialBefore.remainder) ||
						!startsInterruptingBlock(
							partialBefore.remainder,
							partialBefore.column,
						)
					) {
						brokenByDisplayMathLine = index;
					}
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
				!candidate.includes("|") &&
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
	paragraphHasPipe = false,
	lazyParagraphContainers: ReadonlyArray<ContainerStep> | null = null,
): GfmTableMatch | null {
	if (headerIndex + 1 >= lines.length) {
		return null;
	}
	const headerEndLine = findLogicalLineEnd(mathIndex, headerIndex);
	if (
		!(
			(inParagraph || lazyParagraphContainers !== null) &&
			paragraphHasPipe
		) &&
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
	if (
		lazyParagraphContainers !== null &&
		lazyParagraphContainers.length > 0 &&
		stripContainersWithColumn(maskedHeader, lazyParagraphContainers) === null
	) {
		const partial = stripPartialContainers(
			maskedHeader,
			lazyParagraphContainers,
		);
		if (
			!isCommonMarkBlankLine(partial.remainder) &&
			!startsLazyParagraphInterruptingBlock(partial.remainder, partial.column)
		) {
			const delimiterStripped = stripContainersWithColumn(
				maskedDelimiter,
				lazyParagraphContainers,
			);
			if (delimiterStripped === null) {
				return null;
			}
			if (
				(!partial.remainder.includes("|") && !paragraphHasPipe) ||
				isTableSeparatorInterruptedByHigherPriorityBlock(
					delimiterStripped.rest,
					delimiterStripped.column,
				)
			) {
				return null;
			}
			const delimiterColumns = parseGfmTableSeparatorColumns(
				delimiterStripped.rest,
			);
			const headerCells = countTableRowCells(partial.remainder);
			if (
				delimiterColumns === 0 ||
				headerCells === 0 ||
				headerCells > delimiterColumns ||
				refParserAbsorbsHeaderOrDelimiter(
					partial.remainder,
					delimiterStripped.rest,
					true,
					activeRefParser,
				)
			) {
				return null;
			}
			const tableEnd = findGfmTableEnd(
				lines,
				delimiterLine,
				lazyParagraphContainers,
				mathIndex,
			);
			return {
				brokenByDisplayMathLine: tableEnd.brokenByDisplayMathLine,
				containers: lazyParagraphContainers,
				delimiterLine,
				endLine: tableEnd.endLine,
				headerEndLine,
				lazyRowStartLines: tableEnd.lazyRowStartLines,
			};
		}
	}
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
			effectiveInParagraph && paragraphHasPipe,
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
