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
import { maskPhpMarkdownMathForTableScan } from "../../shared/markdown/php-markdown-math-mask";

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

function advanceColumnOfText(text: string): number {
	let col = 0;
	for (let i = 0; i < text.length; i += 1) {
		col = text[i] === "\t" ? col + 4 - (col % 4) : col + 1;
	}
	return col;
}

function cursorPrefix(cursor: LineColumnCursor): string {
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

export type StrippedContainerResult = Readonly<{
	column: number;
	prefix: string;
	rest: string;
}>;

export function stripContainersWithColumn(
	line: string,
	containers: ReadonlyArray<ContainerStep>,
): StrippedContainerResult | null {
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
	markerPrefix: string;
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
		markerPrefix: cursorPrefix(cursor),
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

export function resolveGfmTableContainerIndent(
	headerLine: string,
	delimiterLine: string,
	containerIndent: number,
	expectedQuoteDepth: number | null,
	allowLeadingListMarker: boolean,
): number | null {
	const headerBq = readBlockquotePrefix(headerLine);
	const delimiterBq = readBlockquotePrefix(delimiterLine);
	if (headerBq.depth !== delimiterBq.depth) {
		return null;
	}
	if (expectedQuoteDepth !== null && headerBq.depth !== expectedQuoteDepth) {
		return null;
	}

	let effContainer = containerIndent;
	let headerCandidate = stripContainerIndent(
		headerBq.rest,
		effContainer,
		headerBq.column,
	);
	if (headerCandidate === null) {
		return null;
	}
	let headerColumn = headerBq.column + effContainer;
	let headerRelIndent = measureIndentColumns(headerCandidate, headerColumn);
	if (headerRelIndent >= 4) {
		return null;
	}
	while (headerRelIndent < 4) {
		const headerListMarker = matchListMarker(headerCandidate, headerColumn);
		if (headerListMarker === null) {
			break;
		}
		if (!allowLeadingListMarker) {
			return null;
		}
		effContainer += headerListMarker.contentIndent;
		headerColumn += headerListMarker.contentIndent;
		headerCandidate = headerListMarker.afterContent;
		headerRelIndent = measureIndentColumns(headerCandidate, headerColumn);
	}
	if (headerRelIndent >= 4) {
		return null;
	}

	const delimiterCandidate = stripContainerIndent(
		delimiterBq.rest,
		effContainer,
		delimiterBq.column,
	);
	if (delimiterCandidate === null) {
		return null;
	}
	const delimiterColumn = delimiterBq.column + effContainer;
	if (
		measureIndentColumns(delimiterCandidate, delimiterColumn) >= 4 ||
		matchListMarker(delimiterCandidate, delimiterColumn) !== null
	) {
		return null;
	}

	const delimiterColumns = parseGfmTableSeparatorColumns(delimiterCandidate);
	const maskedHeader = maskPhpMarkdownMathForTableScan(headerCandidate);
	if (delimiterColumns === 0 || !maskedHeader.includes("|")) {
		return null;
	}
	return countTableRowCells(maskedHeader) === delimiterColumns
		? effContainer
		: null;
}

export function isGfmTableStartAt(
	headerLine: string,
	delimiterLine: string,
	containerIndent: number,
	expectedQuoteDepth: number | null,
	allowLeadingListMarker: boolean,
): boolean {
	return (
		resolveGfmTableContainerIndent(
			headerLine,
			delimiterLine,
			containerIndent,
			expectedQuoteDepth,
			allowLeadingListMarker,
		) !== null
	);
}

export function findGfmTableEnd(
	lines: ReadonlyArray<string>,
	headerIndex: number,
	containerIndent = 0,
	expectedQuoteDepth = 0,
): number {
	let end = headerIndex + 1;
	for (let index = headerIndex + 2; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const cursor = createLineCursor(line);
		let matchedQuote = true;
		for (let d = 0; d < expectedQuoteDepth; d += 1) {
			if (!consumeBlockquoteMarker(cursor)) {
				matchedQuote = false;
				break;
			}
		}
		if (!matchedQuote) {
			break;
		}
		const afterQuote = cursorRemainder(cursor);
		const afterQuoteColumn = cursor.column;
		const candidate = stripContainerIndent(
			afterQuote,
			containerIndent,
			afterQuoteColumn,
		);
		if (candidate === null || isCommonMarkBlankLine(candidate)) {
			break;
		}
		const candidateColumn = afterQuoteColumn + containerIndent;
		if (measureIndentColumns(candidate, candidateColumn) >= 4) {
			break;
		}
		if (matchListMarker(candidate, candidateColumn) !== null) {
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
	activeContainers?: ReadonlyArray<ContainerStep>,
): ListPrefixedHtmlMatch | null {
	const cursor = createLineCursor(line);
	const containers: ContainerStep[] = [];
	let seededInterleaved = false;
	if (activeContainers && hasListBeforeQuote(activeContainers)) {
		let matchedAll = true;
		for (const step of activeContainers) {
			if (step.kind === "blockquote") {
				if (!consumeBlockquoteMarker(cursor)) {
					matchedAll = false;
					break;
				}
				containers.push(step);
			} else if (isCursorBlank(cursor)) {
				matchedAll = false;
				break;
			} else if (measureLeadingColumns(cursor) >= step.indent) {
				consumeWhitespaceColumns(cursor, step.indent);
				containers.push(step);
			} else {
				matchedAll = false;
				break;
			}
		}
		if (matchedAll) {
			seededInterleaved = true;
		} else {
			cursor.column = 0;
			cursor.index = 0;
			cursor.virtualSpaces = 0;
			containers.length = 0;
		}
	}
	if (!seededInterleaved) {
		while (consumeBlockquoteMarker(cursor)) {
			containers.push({ kind: "blockquote" });
		}
	}
	const outerQuoteCount = seededInterleaved ? 0 : containers.length;

	let matchedList = false;
	let firstStep = true;
	let activeListIndent = seededInterleaved ? 0 : prevContainerIndent;

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
		if ((matchedList || seededInterleaved) && line[nonSpaceIdx] === ">") {
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
	const linePrefix = cursorPrefix(cursor);

	return {
		containers,
		content: cursorRemainder(cursor),
		contentIndent,
		htmlType,
		linePrefix,
	};
}

export type DetectableFence = Readonly<{
	containerIndent: number;
	containers?: ReadonlyArray<ContainerStep>;
	fenceChar: "`" | "~";
	fenceLength: number;
	info: string;
	quoteDepth: number;
}>;

export type FenceLineSummary = Readonly<{
	column: number;
	containerIndent: number;
	content: string;
	indent: number;
	listMarker: ListMarkerMatch | null;
	quoteDepth: number;
}>;

export function fenceContainersOf(
	fence: DetectableFence,
): ReadonlyArray<ContainerStep> {
	if (fence.containers !== undefined) {
		return fence.containers;
	}
	const steps: ContainerStep[] = [];
	for (let d = 0; d < fence.quoteDepth; d += 1) {
		steps.push({ kind: "blockquote" });
	}
	if (fence.containerIndent > 0) {
		steps.push({ indent: fence.containerIndent, kind: "list" });
	}
	return steps;
}

function matchFenceAt(
	content: string,
	indent: number,
	containerIndent: number,
	quoteDepth: number,
	containers?: ReadonlyArray<ContainerStep>,
): DetectableFence | null {
	const relative = indent - containerIndent;
	if (relative < 0 || relative > 3) {
		return null;
	}
	const match = /^(`{3,}|~{3,})(.*)$/.exec(content);
	if (!match?.[1]) {
		return null;
	}
	const info = match[2] ?? "";
	const fenceChar = match[1][0] === "~" ? "~" : "`";
	if (fenceChar === "`" && info.includes("`")) {
		return null;
	}
	return containers !== undefined
		? {
				containerIndent,
				containers,
				fenceChar,
				fenceLength: match[1].length,
				info,
				quoteDepth,
			}
		: {
				containerIndent,
				fenceChar,
				fenceLength: match[1].length,
				info,
				quoteDepth,
			};
}

export function detectFence(
	analysis: FenceLineSummary,
	baseContainers?: ReadonlyArray<ContainerStep>,
): DetectableFence | null {
	const baseSteps: ContainerStep[] = baseContainers
		? [...baseContainers]
		: Array.from({ length: analysis.quoteDepth }, () => ({
				kind: "blockquote" as const,
			}));
	const directSteps: ContainerStep[] =
		analysis.containerIndent > 0
			? [...baseSteps, { indent: analysis.containerIndent, kind: "list" }]
			: baseSteps;
	const direct = matchFenceAt(
		analysis.content,
		analysis.indent,
		analysis.containerIndent,
		analysis.quoteDepth,
		directSteps,
	);
	if (direct || !analysis.listMarker) {
		return direct;
	}

	const containers: ContainerStep[] = [
		...baseSteps,
		{ indent: analysis.listMarker.contentIndent, kind: "list" },
	];
	let quoteDepth = analysis.quoteDepth;
	let innerColumn = analysis.column + analysis.listMarker.contentIndent;
	let innerRest = analysis.listMarker.afterContent;
	for (let depth = 0; depth < 32; depth += 1) {
		const leadCols = measureIndentColumns(innerRest, innerColumn);
		if (leadCols >= 4) {
			return null;
		}
		const trimmedStart = innerRest.replace(/^[ \t]+/, "");
		if (trimmedStart.startsWith(">")) {
			const cursor = createLineCursor(innerRest, innerColumn);
			if (!consumeBlockquoteMarker(cursor)) {
				break;
			}
			containers.push({ kind: "blockquote" });
			quoteDepth += 1;
			innerColumn = cursor.column;
			innerRest = cursorRemainder(cursor);
			continue;
		}
		const nestedMarker = matchListMarker(innerRest, innerColumn);
		if (nestedMarker !== null && nestedMarker.leadCols <= 3) {
			containers.push({ indent: nestedMarker.contentIndent, kind: "list" });
			innerColumn += nestedMarker.contentIndent;
			innerRest = nestedMarker.afterContent;
			continue;
		}
		break;
	}
	const finalIndent = measureIndentColumns(innerRest, innerColumn);
	const finalContent = innerRest.replace(/^[ \t]+/, "");
	const matched = matchFenceAt(
		finalContent,
		finalIndent,
		0,
		quoteDepth,
		containers,
	);
	if (!matched) {
		return null;
	}
	const trailingListIndent =
		quoteDepth === analysis.quoteDepth ? analysis.listMarker.contentIndent : 0;
	return { ...matched, containerIndent: trailingListIndent };
}

function isFenceCloserStripped(
	stripped: Readonly<{ column: number; rest: string }>,
	fence: DetectableFence,
): boolean {
	const indent = measureIndentColumns(stripped.rest, stripped.column);
	if (indent < 0 || indent > 3) {
		return false;
	}
	const content = stripped.rest.replace(/^[ \t]+/, "");
	const match =
		fence.fenceChar === "`"
			? /^(`{3,})[ \t]*$/.exec(content)
			: /^(~{3,})[ \t]*$/.exec(content);
	return Boolean(match?.[1] && match[1].length >= fence.fenceLength);
}

export function isFenceCloser(line: string, fence: DetectableFence): boolean {
	const stripped = stripContainersWithColumn(line, fenceContainersOf(fence));
	return stripped !== null && isFenceCloserStripped(stripped, fence);
}

export function findContainerBoundedFenceEnd(
	lines: ReadonlyArray<string>,
	startIndex: number,
	fence: DetectableFence,
): number {
	const fenceContainers = fenceContainersOf(fence);
	let end = startIndex + 1;
	while (end < lines.length) {
		const stripped = stripContainersWithColumn(
			lines[end] ?? "",
			fenceContainers,
		);
		if (stripped === null) {
			return end - 1;
		}
		if (isFenceCloserStripped(stripped, fence)) {
			return end;
		}
		end += 1;
	}
	return lines.length - 1;
}
