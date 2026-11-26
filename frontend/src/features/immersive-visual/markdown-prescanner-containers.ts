import {
	consumeBlockquoteMarker,
	consumeWhitespaceColumns,
	cursorRemainder,
	isCursorBlank,
	type LineColumnCursor,
	measureLeadingColumns,
	nextNonSpaceIndex,
} from "../../shared/markdown/php-commonmark-block-helpers";

/**
 * Canonical CommonMark §2.2 column-aware container stripping, list-marker
 * parsing, and nested blockquote/list peeling helpers shared across
 * `markdown-prescanner-blocks.ts`, `markdown-prescanner-tables.ts`,
 * `markdown-prescanner-display-math.ts`, `markdown-prescanner-table-emit.ts`,
 * and `markdown-prescanner.ts`.
 */

/**
 * CommonMark §2.2 blank line: contains only ASCII spaces (U+0020) and tabs
 * (U+0009). Unlike JS `.trim()`, U+00A0 (NBSP) is NOT a blank line.
 */
export function isCommonMarkBlankLine(text: string): boolean {
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		if (code !== 0x20 && code !== 0x09) {
			return false;
		}
	}
	return true;
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

export type PeeledLineContainers = Readonly<{
	column: number;
	containers: ReadonlyArray<ContainerStep>;
	linePrefix: string;
	rest: string;
}>;

type BlockquotePrefixResult = Readonly<{
	column: number;
	depth: number;
	prefix: string;
	rest: string;
}>;

type StrippedContainerResult = Readonly<{
	column: number;
	prefix: string;
	rest: string;
}>;

export type ListMarkerMatch = Readonly<{
	afterContent: string;
	contentIndent: number;
	isBlank: boolean;
	leadCols: number;
	markerPrefix: string;
	orderedDigits: string | null;
}>;

const LIST_MARKER_REGEX = /^([-*+]|(\d{1,9})[.)])(?=[ \t]|$)/;

function advanceColumnOfText(text: string): number {
	let col = 0;
	for (let i = 0; i < text.length; i += 1) {
		col = text[i] === "\t" ? col + 4 - (col % 4) : col + 1;
	}
	return col;
}

export function cursorPrefix(cursor: LineColumnCursor): string {
	if (cursor.virtualSpaces <= 0) {
		return cursor.line.slice(0, cursor.index);
	}
	const beforeTab = cursor.line.slice(0, Math.max(0, cursor.index - 1));
	const consumedTabCols = Math.max(
		1,
		cursor.column - advanceColumnOfText(beforeTab),
	);
	return `${beforeTab}${" ".repeat(consumedTabCols)}`;
}

/**
 * Peels leading CommonMark ` {0,3}>[ \t]?` blockquote markers while preserving
 * exact CommonMark §2.2 column coordinates.
 */
export function readBlockquotePrefix(line: string): BlockquotePrefixResult {
	const first = line[0];
	if (first !== ">" && first !== " " && first !== "\t") {
		return { column: 0, depth: 0, prefix: "", rest: line };
	}
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

function blockquoteDepth(prefix: string): number {
	return (prefix.match(/>/g) ?? []).length;
}

/**
 * Strips up to `depth` blockquote markers from `line` on one column cursor,
 * returning the remainder, the CommonMark §2.2 / §5.1 virtual column at which
 * it starts (a tab after `>` expands to its tab stop, one column of which is
 * the marker's optional space; leftover columns stay in `rest` as virtual
 * spaces), and the number of markers actually `matched` (`< depth` means a
 * lazy continuation line).
 */
export function stripBlockquoteDepthWithColumn(
	line: string,
	depth: number,
): Readonly<{ column: number; matched: number; rest: string }> {
	const cursor = createLineCursor(line);
	let matched = 0;
	while (matched < depth && consumeBlockquoteMarker(cursor)) {
		matched += 1;
	}
	return { column: cursor.column, matched, rest: cursorRemainder(cursor) };
}

export function stripBlockquoteDepth(
	line: string,
	depth: number,
): string | null {
	const stripped = stripBlockquoteDepthWithColumn(line, depth);
	return stripped.matched < depth ? null : stripped.rest;
}

export function hasListBeforeQuote(
	containers: ReadonlyArray<{ kind: "blockquote" | "list" }>,
): boolean {
	let sawList = false;
	for (const step of containers) {
		if (step.kind === "list") {
			sawList = true;
		} else if (sawList) {
			return true;
		}
	}
	return false;
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

export function consumeContainerSteps(
	cursor: LineColumnCursor,
	containers: ReadonlyArray<ContainerStep>,
	allowBlankListLine: boolean,
): boolean {
	for (const step of containers) {
		if (step.kind === "blockquote") {
			if (!consumeBlockquoteMarker(cursor)) {
				return false;
			}
			continue;
		}
		if (isCursorBlank(cursor)) {
			if (!allowBlankListLine) {
				return false;
			}
			cursor.index = cursor.line.length;
			cursor.virtualSpaces = 0;
			continue;
		}
		if (measureLeadingColumns(cursor) < step.indent) {
			return false;
		}
		consumeWhitespaceColumns(cursor, step.indent);
	}
	return true;
}

export function stripContainersWithColumn(
	line: string,
	containers: ReadonlyArray<ContainerStep>,
): StrippedContainerResult | null {
	const cursor = createLineCursor(line);
	if (!consumeContainerSteps(cursor, containers, true)) {
		return null;
	}
	return {
		column: cursor.column,
		prefix: cursorPrefix(cursor),
		rest: cursorRemainder(cursor),
	};
}

export function stripContainers(
	line: string,
	containers: ReadonlyArray<ContainerStep>,
): string | null {
	return stripContainersWithColumn(line, containers)?.rest ?? null;
}

/**
 * Peels as many leading steps of `containers` as match `line`, returning the
 * byte count consumed from `line` and the unconsumed remainder (preserving
 * virtual spaces from partially consumed tabs).
 */
export function stripPartialContainers(
	line: string,
	containers: ReadonlyArray<ContainerStep>,
): Readonly<{
	column: number;
	consumedLength: number;
	remainder: string;
	virtualSpaces: number;
}> {
	const cursor = createLineCursor(line);
	for (const step of containers) {
		if (step.kind === "blockquote") {
			if (!consumeBlockquoteMarker(cursor)) {
				break;
			}
			continue;
		}
		if (isCursorBlank(cursor) || measureLeadingColumns(cursor) < step.indent) {
			break;
		}
		consumeWhitespaceColumns(cursor, step.indent);
	}
	return {
		column: cursor.column,
		consumedLength: cursor.index,
		remainder: cursorRemainder(cursor),
		virtualSpaces: cursor.virtualSpaces,
	};
}

export function measureIndentColumns(text: string, startColumn = 0): number {
	return measureLeadingColumns(createLineCursor(text, startColumn));
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

export function stripBlockContainerPrefix(
	line: string,
	prefix: string,
	indent: number,
): string {
	const depth = blockquoteDepth(prefix);
	let result = line;
	let startColumn = 0;
	if (depth > 0) {
		const stripped = stripBlockquoteDepthWithColumn(line, depth);
		if (stripped.matched === depth) {
			result = stripped.rest;
			startColumn = stripped.column;
		} else if (
			line.replace(/[ \t]+$/, "") === prefix.replace(/[ \t]+$/, "")
		) {
			return "";
		} else {
			const bq = readBlockquotePrefix(line);
			result = bq.rest;
			startColumn = bq.column;
		}
	}
	return stripUpToIndentColumns(result, indent, startColumn);
}

function isListMarkerStartCode(code: number): boolean {
	return (
		code === 0x2d ||
		code === 0x2a ||
		code === 0x2b ||
		(code >= 0x30 && code <= 0x39)
	);
}

function consumeListMarkerOnCursor(
	cursor: LineColumnCursor,
	maxLeadCols: number,
	allowNonInterrupting: boolean,
): Readonly<{
	contentIndent: number;
	isBlank: boolean;
	leadCols: number;
	orderedDigits: string | null;
}> | null {
	const nonSpaceIdx = nextNonSpaceIndex(cursor);
	if (
		nonSpaceIdx >= cursor.line.length ||
		!isListMarkerStartCode(cursor.line.charCodeAt(nonSpaceIdx))
	) {
		return null;
	}
	const leadCols = measureLeadingColumns(cursor);
	if (leadCols > maxLeadCols) {
		return null;
	}
	const afterLead = cursor.line.slice(nonSpaceIdx);
	const markerMatch = LIST_MARKER_REGEX.exec(afterLead);
	if (!markerMatch?.[1]) {
		return null;
	}
	const markerText = markerMatch[1];
	const orderedDigits = markerMatch[2] ?? null;
	const isBlank = isCommonMarkBlankLine(afterLead.slice(markerText.length));
	if (
		!allowNonInterrupting &&
		(isBlank || (orderedDigits !== null && orderedDigits !== "1"))
	) {
		return null;
	}
	consumeWhitespaceColumns(cursor, leadCols);
	cursor.index += markerText.length;
	cursor.column += markerText.length;
	const spacingCols = measureLeadingColumns(cursor);
	const padding =
		isBlank || spacingCols < 1 || spacingCols >= 5 ? 1 : spacingCols;
	consumeWhitespaceColumns(cursor, Math.min(padding, spacingCols));
	return {
		contentIndent: leadCols + markerText.length + padding,
		isBlank,
		leadCols,
		orderedDigits,
	};
}

export function matchListMarker(
	rest: string,
	startColumn = 0,
): ListMarkerMatch | null {
	const cursor = createLineCursor(rest, startColumn);
	const consumed = consumeListMarkerOnCursor(
		cursor,
		Number.POSITIVE_INFINITY,
		true,
	);
	if (consumed === null) {
		return null;
	}
	return {
		afterContent: cursorRemainder(cursor),
		contentIndent: consumed.contentIndent,
		isBlank: consumed.isBlank,
		leadCols: consumed.leadCols,
		markerPrefix: cursorPrefix(cursor),
		orderedDigits: consumed.orderedDigits,
	};
}

/**
 * Single authoritative CommonMark §5.2 content indent (relative to the column
 * at which `marker` was matched) that pinned PHP `league/commonmark@2.8.2`
 * assigns: `ListBlockStartParser::calculateListMarkerPadding()` treats an
 * item as blank when `$cursor->peek() === null` right after the spaces
 * following the marker, i.e. when the untrimmed remainder is exactly one
 * code point, so the padding falls back to `markerLength + 1`.
 */
export function phpListMarkerContentIndent(marker: ListMarkerMatch): number {
	if (Array.from(marker.afterContent).length !== 1) {
		return marker.contentIndent;
	}
	const markerLength =
		marker.orderedDigits !== null ? marker.orderedDigits.length + 1 : 1;
	return Math.min(marker.contentIndent, marker.leadCols + markerLength + 1);
}

/**
 * Mirrors PHP `League\CommonMark`'s `ListBlockStartParser`: a list marker can
 * interrupt an open paragraph only when its first line is non-blank and, if
 * ordered, its exact digit string is `"1"` (rejecting `2.` and `01.`).
 */
export function canListMarkerInterruptParagraph(
	marker: ListMarkerMatch,
): boolean {
	return (
		!marker.isBlank &&
		(marker.orderedDigits === null || marker.orderedDigits === "1")
	);
}

export function peelNestedContainers(
	cursor: LineColumnCursor,
	containers: ContainerStep[],
	allowLeadingListMarker: boolean,
	allowQuoteBeforeList: boolean,
	maxDepth = 32,
): Readonly<{ matchedList: boolean; quotesAdded: number }> {
	let firstPeeled = true;
	let matchedList = false;
	let quotesAdded = 0;
	for (let depth = 0; depth < maxDepth; depth += 1) {
		if (isCursorBlank(cursor) || measureLeadingColumns(cursor) >= 4) {
			break;
		}
		if (
			(allowQuoteBeforeList || matchedList) &&
			cursor.line[nextNonSpaceIndex(cursor)] === ">"
		) {
			if (!consumeBlockquoteMarker(cursor)) {
				break;
			}
			containers.push({ kind: "blockquote" });
			quotesAdded += 1;
			firstPeeled = false;
			continue;
		}
		const consumed = consumeListMarkerOnCursor(
			cursor,
			3,
			!firstPeeled || allowLeadingListMarker,
		);
		if (consumed === null) {
			break;
		}
		containers.push({ indent: consumed.contentIndent, kind: "list" });
		matchedList = true;
		firstPeeled = false;
	}
	return { matchedList, quotesAdded };
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
	if (!consumeContainerSteps(cursor, baseContainers, false)) {
		return null;
	}
	containers.push(...baseContainers);
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
		peelNestedContainers(cursor, containers, allowLeadingListMarker, true);
	}
	return {
		column: cursor.column,
		containers,
		linePrefix: cursorPrefix(cursor),
		rest: cursorRemainder(cursor),
	};
}

/** The text before the first `\n` (the whole text when single-line). */
export function firstLine(text: string): string {
	const nl = text.indexOf("\n");
	return nl === -1 ? text : text.slice(0, nl);
}
