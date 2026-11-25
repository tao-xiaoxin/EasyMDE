import {
	COMMONMARK_ATX_HEADING_OPEN,
	COMMONMARK_FENCED_CODE_OPEN,
	COMMONMARK_THEMATIC_BREAK_LINE,
	consumeBlockquoteMarker,
	consumeWhitespaceColumns,
	countTableRowCells,
	cursorRemainder,
	isCursorBlank,
	matchHtmlBlockOpen,
	measureLeadingColumns,
	nextNonSpaceIndex,
	parseGfmTableSeparatorColumns,
} from "../../shared/markdown/php-commonmark-block-helpers";
import {
	maskPhpMarkdownMathForTableScan,
	type PhpMarkdownMathRange,
	scanPhpMarkdownMathRanges,
} from "../../shared/markdown/php-markdown-math-mask";
import { parseReservedTableAlignmentMarkerLine } from "../../shared/table-alignment-marker";
import {
	type ContainerStep,
	canListMarkerInterruptParagraph,
	createLineCursor,
	cursorPrefix,
	isCommonMarkBlankLine,
	matchListMarker,
	measureIndentColumns,
	stripContainersWithColumn,
} from "./markdown-prescanner-blocks";
import {
	extractInlineProtectedSyntax,
	type ProtectedInlineEntry,
} from "./markdown-prescanner-inline";
import type { ProtectedBlockKind } from "./visual-schema";

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

export type PeeledLineContainers = Readonly<{
	column: number;
	containers: ReadonlyArray<ContainerStep>;
	linePrefix: string;
	rest: string;
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

function firstMathRangeEndingAfter(
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
 * `[startOffset, endOffset)`, shifted relative to `startOffset`.
 */
export function collectRelativeInlineMathRanges(
	mathIndex: PhpDocumentMathIndex,
	startOffset: number,
	endOffset: number,
): PhpMarkdownMathRange[] {
	const overlapping = findMathRangesInOffsetSlice(
		mathIndex.ranges,
		startOffset,
		endOffset,
	);
	const relative: PhpMarkdownMathRange[] = [];
	for (const range of overlapping) {
		if (!range.block && range.from >= startOffset && range.to <= endOffset) {
			relative.push({
				block: false,
				from: range.from - startOffset,
				to: range.to - startOffset,
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
	const overlapping = findMathRangesInOffsetSlice(
		mathIndex.ranges,
		startOffset,
		endOffset,
	);
	for (const range of overlapping) {
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

export function formatContainerPrefix(
	containers: ReadonlyArray<ContainerStep>,
): string {
	let prefix = "";
	for (const step of containers) {
		prefix += step.kind === "blockquote" ? "> " : " ".repeat(step.indent);
	}
	return prefix;
}

/**
 * Peels as many leading steps of `containers` as match `line`, returning the
 * byte count consumed from `line` and the unconsumed remainder (preserving
 * virtual spaces from partially consumed tabs).
 */
export function stripPartialContainers(
	line: string,
	containers: ReadonlyArray<ContainerStep>,
): Readonly<{ consumedLength: number; remainder: string; column: number }> {
	const cursor = createLineCursor(line);
	for (const step of containers) {
		if (step.kind === "blockquote") {
			if (!consumeBlockquoteMarker(cursor)) {
				break;
			}
			continue;
		}
		if (isCursorBlank(cursor)) {
			break;
		}
		if (measureLeadingColumns(cursor) < step.indent) {
			break;
		}
		consumeWhitespaceColumns(cursor, step.indent);
	}
	return {
		column: cursor.column,
		consumedLength: cursor.index,
		remainder: cursorRemainder(cursor),
	};
}

export function peelContainerStepsForLine(
	line: string,
	baseContainers: ReadonlyArray<ContainerStep>,
	preMarkerListIndent: number,
	allowLeadingListMarker: boolean,
	allowAdditionalContainers: boolean,
): PeeledLineContainers | null {
	const cursor = createLineCursor(line);
	const containers: ContainerStep[] = [];

	for (const step of baseContainers) {
		if (step.kind === "blockquote") {
			if (!consumeBlockquoteMarker(cursor)) {
				return null;
			}
			containers.push(step);
			continue;
		}
		if (isCursorBlank(cursor) || measureLeadingColumns(cursor) < step.indent) {
			return null;
		}
		consumeWhitespaceColumns(cursor, step.indent);
		containers.push(step);
	}

	if (preMarkerListIndent > 0) {
		if (
			isCursorBlank(cursor) ||
			measureLeadingColumns(cursor) < preMarkerListIndent
		) {
			return null;
		}
		consumeWhitespaceColumns(cursor, preMarkerListIndent);
		containers.push({ indent: preMarkerListIndent, kind: "list" });
	}

	if (allowAdditionalContainers) {
		let firstPeeled = true;
		for (let depth = 0; depth < 32; depth += 1) {
			if (isCursorBlank(cursor)) {
				break;
			}
			const leadCols = measureLeadingColumns(cursor);
			if (leadCols >= 4) {
				break;
			}
			const nonSpaceIdx = nextNonSpaceIndex(cursor);
			if (line[nonSpaceIdx] === ">") {
				if (!consumeBlockquoteMarker(cursor)) {
					break;
				}
				containers.push({ kind: "blockquote" });
				firstPeeled = false;
				continue;
			}
			const marker = matchListMarker(cursorRemainder(cursor), cursor.column);
			if (marker === null || marker.leadCols > 3) {
				break;
			}
			if (
				firstPeeled &&
				!allowLeadingListMarker &&
				!canListMarkerInterruptParagraph(marker)
			) {
				break;
			}
			const afterLead = line.slice(nonSpaceIdx);
			const markerMatch = /^([-*+]|(\d{1,9})[.)])(?=[ \t]|$)/.exec(afterLead);
			if (!markerMatch?.[1]) {
				break;
			}
			const markerText = markerMatch[1];
			consumeWhitespaceColumns(cursor, leadCols);
			cursor.index += markerText.length;
			cursor.column += markerText.length;
			const spacingCols = measureLeadingColumns(cursor);
			const isBlank = isCursorBlank(cursor);
			const padding =
				isBlank || spacingCols < 1 || spacingCols >= 5 ? 1 : spacingCols;
			consumeWhitespaceColumns(cursor, Math.min(padding, spacingCols));
			containers.push({
				indent: leadCols + markerText.length + padding,
				kind: "list",
			});
			firstPeeled = false;
		}
	}

	return {
		column: cursor.column,
		containers,
		linePrefix: cursorPrefix(cursor),
		rest: cursorRemainder(cursor),
	};
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
				measureIndentColumns(candidate, candidateColumn) >= 4 ||
				matchListMarker(candidate, candidateColumn) !== null
			) {
				break;
			}
			const trimmedStart = candidate.replace(/^[ \t]+/, "");
			if (
				!candidate.includes("|") ||
				trimmedStart.startsWith(">") ||
				/^(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,})/.test(trimmedStart)
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
	if (
		peeled === null ||
		measureIndentColumns(peeled.rest, peeled.column) >= 4
	) {
		return null;
	}
	if (
		!allowAdditionalContainers &&
		(peeled.rest.replace(/^[ \t]+/, "").startsWith(">") ||
			matchListMarker(peeled.rest, peeled.column) !== null)
	) {
		return null;
	}

	const delimiterStripped = stripContainersWithColumn(
		maskedDelimiter,
		peeled.containers,
	);
	if (delimiterStripped === null) {
		return null;
	}
	if (
		measureIndentColumns(delimiterStripped.rest, delimiterStripped.column) >=
			4 ||
		matchListMarker(delimiterStripped.rest, delimiterStripped.column) !== null
	) {
		return null;
	}

	const delimiterColumns = parseGfmTableSeparatorColumns(
		delimiterStripped.rest,
	);
	if (delimiterColumns === 0 || !peeled.rest.includes("|")) {
		return null;
	}
	if (countTableRowCells(peeled.rest) !== delimiterColumns) {
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

export function sumListContainerIndent(
	containers: ReadonlyArray<ContainerStep>,
): number {
	let total = 0;
	for (const step of containers) {
		if (step.kind === "list") {
			total += step.indent;
		}
	}
	return total;
}

export type TableEmitCallbacks = Readonly<{
	addProtectedBlock: (kind: ProtectedBlockKind, rawMarkdown: string) => string;
	pushOutputLine: (
		text: string,
		range: Readonly<{ end: number; start: number }> | null,
	) => void;
}>;

/**
 * Emits one active table body row (joining physical lines bridged by multiline
 * `\(...\)` and normalizing lazy container prefixes so `markdown-it` keeps the
 * row inside the table matching PHP `League\CommonMark`). Returns the next
 * physical line index to visit.
 */
export function emitActiveTableRow(
	lineIndex: number,
	activeTable: GfmTableMatch,
	mathIndex: PhpDocumentMathIndex,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	pushOutputLine: TableEmitCallbacks["pushOutputLine"],
): number {
	const logicalEnd = findLogicalLineEnd(mathIndex, lineIndex);
	const rowStartOffset = mathIndex.lineStarts[lineIndex] ?? 0;
	const rowEndOffset = mathIndex.lineEnds[logicalEnd] ?? rowStartOffset;
	const rawRow = mathIndex.normalized.slice(rowStartOffset, rowEndOffset);
	if (activeTable.lazyRowStartLines.has(lineIndex)) {
		const partial = stripPartialContainers(rawRow, activeTable.containers);
		const rowMathRanges = collectRelativeInlineMathRanges(
			mathIndex,
			rowStartOffset + partial.consumedLength,
			rowEndOffset,
		);
		const extracted = extractInlineProtectedSyntax(
			partial.remainder,
			sentinel,
			protectedInlines,
			true,
			false,
			-1,
			rowMathRanges,
		);
		pushOutputLine(
			`${formatContainerPrefix(activeTable.containers)}${extracted}`,
			{ end: logicalEnd + 1, start: lineIndex },
		);
	} else {
		const rowMathRanges = collectRelativeInlineMathRanges(
			mathIndex,
			rowStartOffset,
			rowEndOffset,
		);
		pushOutputLine(
			extractInlineProtectedSyntax(
				rawRow,
				sentinel,
				protectedInlines,
				true,
				false,
				-1,
				rowMathRanges,
			),
			{ end: logicalEnd + 1, start: lineIndex },
		);
	}
	return logicalEnd;
}

/**
 * Splits a display-math-bearing line (`$$...$$` / `\[...\]`) that breaks an
 * active GFM table, mirroring PHP `MarkdownRenderer::extract_math()` replacing
 * display math with `"\n\n" . $token . "\n\n"`.
 */
export function emitDisplayMathTableBreak(
	lineIndex: number,
	tableContainers: ReadonlyArray<ContainerStep>,
	mathIndex: PhpDocumentMathIndex,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	callbacks: TableEmitCallbacks,
): Readonly<{ emittedTableBeforeRow: boolean; spanEndLine: number }> {
	const { addProtectedBlock, pushOutputLine } = callbacks;
	let cursorOffset = mathIndex.lineStarts[lineIndex] ?? 0;
	let spanEndLine = findLogicalLineEnd(mathIndex, lineIndex);
	let spanEndOffset = mathIndex.lineEnds[spanEndLine] ?? cursorOffset;
	let emittedTableBeforeRow = false;
	let isFirstDisplayMath = true;

	while (cursorOffset <= spanEndOffset) {
		const displayRanges = findMathRangesInOffsetSlice(
			mathIndex.ranges,
			cursorOffset,
			spanEndOffset,
		).filter((range) => range.block && range.from >= cursorOffset);
		const nextDisplay = displayRanges[0];
		if (!nextDisplay) {
			break;
		}
		const beforeText = mathIndex.normalized.slice(
			cursorOffset,
			nextDisplay.from,
		);
		if (isFirstDisplayMath) {
			const fullMatch =
				tableContainers.length > 0
					? stripContainersWithColumn(beforeText, tableContainers)
					: null;
			const partial =
				tableContainers.length > 0 && fullMatch === null
					? stripPartialContainers(beforeText, tableContainers)
					: null;
			const effectiveBefore = fullMatch
				? fullMatch.rest
				: partial
					? partial.remainder
					: beforeText;
			if (!isCommonMarkBlankLine(effectiveBefore)) {
				emittedTableBeforeRow = true;
				if (partial !== null) {
					const beforeMathRanges = collectRelativeInlineMathRanges(
						mathIndex,
						cursorOffset + partial.consumedLength,
						nextDisplay.from,
					);
					const extractedBefore = extractInlineProtectedSyntax(
						partial.remainder,
						sentinel,
						protectedInlines,
						true,
						false,
						-1,
						beforeMathRanges,
					);
					pushOutputLine(
						`${formatContainerPrefix(tableContainers)}${extractedBefore}`,
						null,
					);
				} else {
					const beforeMathRanges = collectRelativeInlineMathRanges(
						mathIndex,
						cursorOffset,
						nextDisplay.from,
					);
					pushOutputLine(
						extractInlineProtectedSyntax(
							beforeText,
							sentinel,
							protectedInlines,
							true,
							false,
							-1,
							beforeMathRanges,
						),
						null,
					);
				}
			}
			isFirstDisplayMath = false;
		} else if (!isCommonMarkBlankLine(beforeText)) {
			pushOutputLine("", null);
			const midMathRanges = collectRelativeInlineMathRanges(
				mathIndex,
				cursorOffset,
				nextDisplay.from,
			);
			pushOutputLine(
				extractInlineProtectedSyntax(
					beforeText,
					sentinel,
					protectedInlines,
					false,
					false,
					-1,
					midMathRanges,
				),
				null,
			);
		}

		pushOutputLine("", null);
		const mathToken = addProtectedBlock(
			"math",
			mathIndex.normalized.slice(nextDisplay.from, nextDisplay.to),
		);
		pushOutputLine(mathToken, null);
		cursorOffset = nextDisplay.to;
		const rangeEndLine = findLineIndexForOffset(
			mathIndex,
			Math.max(nextDisplay.from, nextDisplay.to - 1),
		);
		const extendedEndLine = findLogicalLineEnd(mathIndex, rangeEndLine);
		if (extendedEndLine > spanEndLine) {
			spanEndLine = extendedEndLine;
			spanEndOffset = mathIndex.lineEnds[spanEndLine] ?? spanEndOffset;
		}
	}

	pushOutputLine("", null);
	if (cursorOffset < spanEndOffset) {
		const afterText = mathIndex.normalized.slice(cursorOffset, spanEndOffset);
		if (!isCommonMarkBlankLine(afterText)) {
			const afterMathRanges = collectRelativeInlineMathRanges(
				mathIndex,
				cursorOffset,
				spanEndOffset,
			);
			pushOutputLine(
				extractInlineProtectedSyntax(
					afterText,
					sentinel,
					protectedInlines,
					false,
					false,
					-1,
					afterMathRanges,
				),
				null,
			);
		}
	}

	return { emittedTableBeforeRow, spanEndLine };
}
