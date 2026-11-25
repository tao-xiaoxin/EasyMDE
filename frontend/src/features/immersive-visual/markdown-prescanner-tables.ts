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
	cloneParagraphReferenceParser,
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
	hasMultilineDisplayMath: boolean;
	hasMultilineInlineMath: boolean;
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
	let hasMultilineInlineMath = false;
	let hasMultilineDisplayMath = false;
	for (let r = 0; r < ranges.length; r += 1) {
		const range = ranges[r];
		if (!range) continue;
		const nl = normalized.indexOf("\n", range.from);
		if (nl >= 0 && nl < range.to) {
			if (range.block) hasMultilineDisplayMath = true;
			else hasMultilineInlineMath = true;
			if (hasMultilineInlineMath && hasMultilineDisplayMath) break;
		}
	}
	return {
		hasMultilineDisplayMath,
		hasMultilineInlineMath,
		lineEnds,
		lineStarts,
		maskedDoc,
		normalized,
		ranges,
	};
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
	if (!mathIndex.hasMultilineInlineMath) {
		return startLine;
	}
	const { lineEnds, ranges } = mathIndex;
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
	let firstIdx = 0;
	while (
		firstIdx < candidate.length &&
		(candidate[firstIdx] === " " || candidate[firstIdx] === "\t")
	) {
		firstIdx += 1;
	}
	if (firstIdx >= candidate.length) {
		return false;
	}
	const firstCode = candidate.charCodeAt(firstIdx);
	if (
		!(
			(firstCode >= 0x30 && firstCode <= 0x39) ||
			firstCode === 0x2d ||
			firstCode === 0x2a ||
			firstCode === 0x2b ||
			firstCode === 0x5f ||
			firstCode === 0x3e ||
			firstCode === 0x23 ||
			firstCode === 0x3d ||
			firstCode === 0x60 ||
			firstCode === 0x7e ||
			firstCode === 0x3c
		)
	) {
		return false;
	}
	const listMarker = matchListMarker(candidate, candidateColumn);
	if (
		listMarker !== null &&
		(!inParagraph || canListMarkerInterruptParagraph(listMarker))
	) {
		return true;
	}
	const trimmedStart = firstIdx > 0 ? candidate.slice(firstIdx) : candidate;
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

export type ParagraphInterruptingBlockOptions = Readonly<{
	/**
	 * When `true` (e.g. continuing a `TableParser`, whose active block is not a
	 * `Paragraph`), 4+ columns of indentation opens an indented code block and
	 * interrupts. When `false` (lazy `ParagraphParser` continuation), 4+ columns
	 * of indentation cannot interrupt the active paragraph.
	 */
	allowIndentedCode?: boolean;
	/**
	 * Optional precomputed relative leading column count (e.g. from `markdown-it`
	 * `sCount` when `candidate` is already trimmed of leading whitespace).
	 */
	relativeIndentColumns?: number;
}>;

/**
 * Canonical PHP `League\CommonMark` guard for blocks that interrupt an active
 * lazy-continuation leaf (`ParagraphParser` when `allowIndentedCode: false`,
 * `TableParser` when `allowIndentedCode: true`). On an unmatched container
 * line, `$parserState->getParagraphContent()` is `null`, so ANY `< 4`-indented
 * list marker (`- `, `2. foo`, `01. foo`), blockquote, ATX heading, fenced
 * code, thematic break, or HTML block Types 1–6 interrupts, while Setext `===`
 * and HTML block Type 7 never do.
 */
export function startsParagraphInterruptingBlock(
	candidate: string,
	candidateColumn: number,
	options?: ParagraphInterruptingBlockOptions,
): boolean {
	const allowIndentedCode = options?.allowIndentedCode ?? false;
	const indentColumns =
		options?.relativeIndentColumns ??
		measureIndentColumns(candidate, candidateColumn);
	if (indentColumns >= 4) {
		return allowIndentedCode;
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

function refParserAbsorbsHeader(
	headerRest: string,
	inParagraph: boolean,
	activeRefParser: ParagraphReferenceParser | null,
): boolean {
	const probeRefParser: ParagraphReferenceParser | null = !inParagraph
		? createParagraphReferenceParser()
		: activeRefParser !== null && activeRefParser.state !== "paragraph"
			? cloneParagraphReferenceParser(activeRefParser)
			: null;
	return (
		probeRefParser !== null &&
		advanceParagraphReferenceParser(probeRefParser, headerRest)
	);
}

function matchHeaderWithContainerDelimiter(
	headerRest: string,
	containers: ReadonlyArray<ContainerStep>,
	maskedDelimiter: string,
	inParagraph: boolean,
	activeRefParser: ParagraphReferenceParser | null,
	paragraphHasPipe: boolean,
): boolean {
	if (!headerRest.includes("|") && !(inParagraph && paragraphHasPipe)) {
		return false;
	}
	const delimiterStripped = stripContainersWithColumn(
		maskedDelimiter,
		containers,
	);
	if (
		delimiterStripped === null ||
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
	const headerCells = countTableRowCells(headerRest);
	if (
		delimiterColumns === 0 ||
		headerCells === 0 ||
		headerCells > delimiterColumns
	) {
		return false;
	}
	return !refParserAbsorbsHeader(headerRest, inParagraph, activeRefParser);
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
	if (opensNonParagraphBlock(peeled.rest, peeled.column, inParagraph)) {
		return false;
	}
	return matchHeaderWithContainerDelimiter(
		peeled.rest,
		peeled.containers,
		maskedDelimiter,
		inParagraph,
		activeRefParser,
		paragraphHasPipe,
	);
}

const TABLE_INTERRUPTING_BLOCK_OPTIONS: ParagraphInterruptingBlockOptions = {
	allowIndentedCode: true,
};
const LAZY_PARAGRAPH_INTERRUPTING_BLOCK_OPTIONS: ParagraphInterruptingBlockOptions =
	{
		allowIndentedCode: false,
	};

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
						!startsParagraphInterruptingBlock(
							fullBefore.rest,
							fullBefore.column,
							TABLE_INTERRUPTING_BLOCK_OPTIONS,
						)
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
						!startsParagraphInterruptingBlock(
							partialBefore.remainder,
							partialBefore.column,
							TABLE_INTERRUPTING_BLOCK_OPTIONS,
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
				startsParagraphInterruptingBlock(
					candidate,
					candidateColumn,
					TABLE_INTERRUPTING_BLOCK_OPTIONS,
				)
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
			startsParagraphInterruptingBlock(
				partial.remainder,
				partial.column,
				TABLE_INTERRUPTING_BLOCK_OPTIONS,
			)
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
			!startsParagraphInterruptingBlock(
				partial.remainder,
				partial.column,
				LAZY_PARAGRAPH_INTERRUPTING_BLOCK_OPTIONS,
			)
		) {
			if (
				!matchHeaderWithContainerDelimiter(
					partial.remainder,
					lazyParagraphContainers,
					maskedDelimiter,
					true,
					activeRefParser,
					paragraphHasPipe,
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
	candidateLine = lines[lineIndex] ?? "",
): TableAlignMarkerMatch | null {
	if (!candidateLine.includes("<!--")) {
		return null;
	}
	const peeled = peelContainerStepsForLine(
		candidateLine,
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
