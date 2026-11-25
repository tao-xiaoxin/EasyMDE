import {
	consumeBlockquoteMarker,
	consumeWhitespaceColumns,
	countTableRowCells,
	cursorRemainder,
	htmlBlockLineCloses,
	isCursorBlank,
	type LineColumnCursor,
	matchHtmlBlockOpen,
	measureLeadingColumns,
	nextNonSpaceIndex,
	parseGfmTableSeparatorColumns,
} from "../../shared/markdown/php-commonmark-block-helpers";

/**
 * Feature-private block-structure helpers for `markdown-prescanner.ts`:
 * CommonMark §2.2 ASCII blank-line checks, column-aware container / blockquote
 * stripping, GFM table boundary scanning, and CommonMark §4.6 Types 1-7 HTML
 * block matching (including interleaved list-marker and blockquote prefixes).
 */

/**
 * CommonMark §2.2 blank line: contains only ASCII spaces (U+0020) and tabs
 * (U+0009). Unlike JS `.trim()`, U+00A0 (NBSP) is NOT a blank line.
 */
export function isCommonMarkBlankLine(text: string): boolean {
	return /^[ \t]*$/.test(text);
}

export function createLineCursor(
	line: string,
	startColumn = 0,
): LineColumnCursor {
	return { column: startColumn, index: 0, line, virtualSpaces: 0 };
}

export type ContainerStep =
	| Readonly<{ kind: "blockquote" }>
	| Readonly<{ indent: number; kind: "list" }>;

export type BlockquotePrefixResult = Readonly<{
	column: number;
	depth: number;
	prefix: string;
	rest: string;
}>;

/**
 * Peels leading CommonMark ` {0,3}>[ \t]?` blockquote markers while preserving
 * exact CommonMark §2.2 column coordinates. When a trailing tab after `>` was
 * partially consumed, normalizes that tab in `prefix` to `" "` so
 * `${prefix}${rest}` keeps exact column alignment without duplicating spaces.
 */
export function readBlockquotePrefix(line: string): BlockquotePrefixResult {
	const cursor = createLineCursor(line);
	let depth = 0;
	while (consumeBlockquoteMarker(cursor)) {
		depth += 1;
	}
	const prefix =
		cursor.virtualSpaces > 0
			? `${line.slice(0, cursor.index - 1)} `
			: line.slice(0, cursor.index);
	return {
		column: cursor.column,
		depth,
		prefix,
		rest: cursorRemainder(cursor),
	};
}

export function blockquoteDepth(prefix: string): number {
	return (prefix.match(/>/g) ?? []).length;
}

export function stripBlockquoteDepth(
	line: string,
	depth: number,
): string | null {
	const cursor = createLineCursor(line);
	for (let d = 0; d < depth; d += 1) {
		if (!consumeBlockquoteMarker(cursor)) {
			return null;
		}
	}
	return cursorRemainder(cursor);
}

export function stripContainers(
	line: string,
	containers: ReadonlyArray<ContainerStep>,
): string | null {
	const cursor = createLineCursor(line);
	for (const step of containers) {
		if (step.kind === "blockquote") {
			if (!consumeBlockquoteMarker(cursor)) {
				return null;
			}
			continue;
		}
		if (isCursorBlank(cursor)) {
			cursor.index = line.length;
			cursor.virtualSpaces = 0;
			continue;
		}
		if (measureLeadingColumns(cursor) < step.indent) {
			return null;
		}
		consumeWhitespaceColumns(cursor, step.indent);
	}
	return cursorRemainder(cursor);
}

export function measureIndentColumns(text: string, startColumn = 0): number {
	return measureLeadingColumns(createLineCursor(text, startColumn));
}

export function stripContainerIndent(
	rest: string,
	containerIndent: number,
	startColumn = 0,
): string | null {
	if (containerIndent <= 0) {
		return rest;
	}
	const cursor = createLineCursor(rest, startColumn);
	if (measureLeadingColumns(cursor) < containerIndent) {
		return null;
	}
	consumeWhitespaceColumns(cursor, containerIndent);
	return cursorRemainder(cursor);
}

export function stripUpToIndentColumns(
	rest: string,
	maxColumns: number,
	startColumn = 0,
): string {
	if (maxColumns <= 0) {
		return rest;
	}
	const cursor = createLineCursor(rest, startColumn);
	const available = measureLeadingColumns(cursor);
	consumeWhitespaceColumns(cursor, Math.min(maxColumns, available));
	return cursorRemainder(cursor);
}

export type ListMarkerMatch = Readonly<{
	afterContent: string;
	contentIndent: number;
	isBlank: boolean;
	leadCols: number;
	orderedDigits: string | null;
}>;

export function matchListMarker(
	rest: string,
	startColumn = 0,
): ListMarkerMatch | null {
	const cursor = createLineCursor(rest, startColumn);
	const leadCols = measureLeadingColumns(cursor);
	const nonSpaceIdx = nextNonSpaceIndex(cursor);
	if (nonSpaceIdx >= rest.length) {
		return null;
	}
	const afterLead = rest.slice(nonSpaceIdx);
	const markerMatch = /^([-*+]|(\d{1,9})[.)])(?=[ \t]|$)/.exec(afterLead);
	if (!markerMatch?.[1]) {
		return null;
	}
	const markerText = markerMatch[1];
	const orderedDigits = markerMatch[2] ?? null;
	consumeWhitespaceColumns(cursor, leadCols);
	cursor.index += markerText.length;
	cursor.column += markerText.length;
	const spacingCols = measureLeadingColumns(cursor);
	const isBlank = isCursorBlank(cursor);
	const padding =
		isBlank || spacingCols < 1 || spacingCols >= 5 ? 1 : spacingCols;
	consumeWhitespaceColumns(cursor, Math.min(padding, spacingCols));
	return {
		afterContent: cursorRemainder(cursor),
		contentIndent: leadCols + markerText.length + padding,
		isBlank,
		leadCols,
		orderedDigits,
	};
}

/**
 * Mirrors PHP `League\CommonMark`'s `ListBlockStartParser`: a list marker can
 * interrupt an open paragraph only when its first line is non-blank and, if
 * ordered, its exact digit string is `"1"` (rejecting `2.` and `01.`).
 */
export function canListMarkerInterruptParagraph(
	marker: ListMarkerMatch,
): boolean {
	if (marker.isBlank) {
		return false;
	}
	return marker.orderedDigits === null || marker.orderedDigits === "1";
}

export function isGfmTableStartAt(
	headerLine: string,
	delimiterLine: string,
	containerIndent: number,
	expectedQuoteDepth: number | null,
	allowLeadingListMarker: boolean,
): boolean {
	const headerBq = readBlockquotePrefix(headerLine);
	const delimiterBq = readBlockquotePrefix(delimiterLine);
	if (headerBq.depth !== delimiterBq.depth) {
		return false;
	}
	if (expectedQuoteDepth !== null && headerBq.depth !== expectedQuoteDepth) {
		return false;
	}

	let effContainer = containerIndent;
	let headerCandidate = stripContainerIndent(
		headerBq.rest,
		effContainer,
		headerBq.column,
	);
	if (headerCandidate === null) {
		return false;
	}
	let headerColumn = headerBq.column + effContainer;
	const headerRelIndent = measureIndentColumns(headerCandidate, headerColumn);
	if (headerRelIndent >= 4) {
		return false;
	}
	const headerListMarker = matchListMarker(headerCandidate, headerColumn);
	if (headerListMarker !== null) {
		if (!allowLeadingListMarker) {
			return false;
		}
		effContainer += headerListMarker.contentIndent;
		headerColumn += headerListMarker.contentIndent;
		headerCandidate = headerListMarker.afterContent;
	}

	const delimiterCandidate = stripContainerIndent(
		delimiterBq.rest,
		effContainer,
		delimiterBq.column,
	);
	if (delimiterCandidate === null) {
		return false;
	}
	const delimiterColumn = delimiterBq.column + effContainer;
	if (
		measureIndentColumns(delimiterCandidate, delimiterColumn) >= 4 ||
		matchListMarker(delimiterCandidate, delimiterColumn) !== null
	) {
		return false;
	}

	const delimiterColumns = parseGfmTableSeparatorColumns(delimiterCandidate);
	if (delimiterColumns === 0 || !headerCandidate.includes("|")) {
		return false;
	}
	return countTableRowCells(headerCandidate) === delimiterColumns;
}

export function findGfmTableEnd(
	lines: ReadonlyArray<string>,
	headerIndex: number,
): number {
	let end = headerIndex + 1;
	for (let index = headerIndex + 2; index < lines.length; index += 1) {
		const { rest } = readBlockquotePrefix(lines[index] ?? "");
		if (isCommonMarkBlankLine(rest) || !rest.includes("|")) {
			break;
		}
		if (/^ {0,3}(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|>)/.test(rest)) {
			break;
		}
		end = index;
	}
	return end;
}

export function findCommonMarkHtmlBlockEnd(
	lines: ReadonlyArray<string>,
	startIndex: number,
	htmlType: 1 | 2 | 3 | 4 | 5 | 6 | 7,
	containers: ReadonlyArray<ContainerStep>,
	startContent: string,
): number {
	if (
		htmlType !== 6 &&
		htmlType !== 7 &&
		htmlBlockLineCloses(htmlType, startContent)
	) {
		return startIndex;
	}
	let end = startIndex;
	for (let k = startIndex + 1; k < lines.length; k += 1) {
		const afterContainers = stripContainers(lines[k] ?? "", containers);
		if (afterContainers === null) {
			break;
		}
		if (htmlType === 6 || htmlType === 7) {
			if (isCommonMarkBlankLine(afterContainers)) {
				break;
			}
			end = k;
			continue;
		}
		end = k;
		if (htmlBlockLineCloses(htmlType, afterContainers)) {
			return end;
		}
	}
	return end;
}

export type ListPrefixedHtmlMatch = Readonly<{
	containers: ReadonlyArray<ContainerStep>;
	content: string;
	contentIndent: number;
	htmlType: 1 | 2 | 3 | 4 | 5 | 6 | 7;
	linePrefix: string;
}>;

export function matchListPrefixedHtmlBlock(
	line: string,
	inParagraph: boolean,
	prevContainerIndent: number,
): ListPrefixedHtmlMatch | null {
	const cursor = createLineCursor(line);
	const containers: ContainerStep[] = [];
	while (consumeBlockquoteMarker(cursor)) {
		containers.push({ kind: "blockquote" });
	}
	const outerQuoteCount = containers.length;

	let matchedList = false;
	let firstStep = true;
	let activeListIndent = prevContainerIndent;

	while (!isCursorBlank(cursor)) {
		const leadCols = measureLeadingColumns(cursor);
		if (firstStep && activeListIndent > 0 && leadCols >= activeListIndent) {
			const rel = leadCols - activeListIndent;
			if (rel > 3) {
				break;
			}
			consumeWhitespaceColumns(cursor, activeListIndent);
			containers.push({ indent: activeListIndent, kind: "list" });
			activeListIndent = 0;
			continue;
		}
		if (leadCols > 3) {
			break;
		}
		const nonSpaceIdx = nextNonSpaceIndex(cursor);
		if (matchedList && line[nonSpaceIdx] === ">") {
			if (!consumeBlockquoteMarker(cursor)) {
				break;
			}
			containers.push({ kind: "blockquote" });
			firstStep = false;
			continue;
		}
		const afterLead = line.slice(nonSpaceIdx);
		const markerMatch = /^([-*+]|(\d{1,9})[.)])(?=[ \t]|$)/.exec(afterLead);
		if (!markerMatch?.[1]) {
			break;
		}
		const markerText = markerMatch[1];
		const orderedDigits = markerMatch[2];
		const afterMarker = afterLead.slice(markerText.length);
		if (
			firstStep &&
			inParagraph &&
			(isCommonMarkBlankLine(afterMarker) ||
				(orderedDigits !== undefined && orderedDigits !== "1"))
		) {
			break;
		}
		consumeWhitespaceColumns(cursor, leadCols);
		cursor.index += markerText.length;
		cursor.column += markerText.length;
		const spacingCols = measureLeadingColumns(cursor);
		if (spacingCols > 4) {
			return null;
		}
		if (spacingCols > 0) {
			consumeWhitespaceColumns(cursor, spacingCols);
		}
		containers.push({
			indent: leadCols + markerText.length + Math.max(spacingCols, 1),
			kind: "list",
		});
		matchedList = true;
		firstStep = false;
	}

	if (!matchedList) {
		return null;
	}
	const finalLeadCols = measureLeadingColumns(cursor);
	if (finalLeadCols > 3) {
		return null;
	}
	const nonSpaceIdx = nextNonSpaceIndex(cursor);
	const htmlCandidate = line.slice(nonSpaceIdx);
	if (!htmlCandidate.startsWith("<")) {
		return null;
	}
	// A fresh list item or nested blockquote always starts outside any paragraph.
	const htmlType = matchHtmlBlockOpen(htmlCandidate, true);
	if (htmlType === null) {
		return null;
	}

	let contentIndent = 0;
	for (let idx = outerQuoteCount; idx < containers.length; idx += 1) {
		const step = containers[idx];
		if (step?.kind !== "list") {
			break;
		}
		contentIndent += step.indent;
	}
	const linePrefix =
		cursor.virtualSpaces > 0
			? `${line.slice(0, cursor.index - 1)} `
			: line.slice(0, cursor.index);

	return {
		containers,
		content: cursorRemainder(cursor),
		contentIndent,
		htmlType,
		linePrefix,
	};
}
