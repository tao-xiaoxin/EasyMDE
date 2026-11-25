import {
	consumeBlockquoteMarker,
	consumeWhitespaceColumns,
	cursorRemainder,
	htmlBlockLineCloses,
	isCursorBlank,
	type LineColumnCursor,
	matchHtmlBlockOpen,
	measureLeadingColumns,
	nextNonSpaceIndex,
} from "../../shared/markdown/php-commonmark-block-helpers";

/**
 * Feature-private block-structure helpers for `markdown-prescanner.ts`:
 * CommonMark §2.2 ASCII blank-line checks, column-aware container / blockquote
 * stripping, fenced-code detection, and CommonMark §4.6 Types 1-7 HTML block
 * matching (including interleaved list-marker and blockquote prefixes).
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
	const nonSpaceIdx = nextNonSpaceIndex(cursor);
	if (nonSpaceIdx >= rest.length) {
		return null;
	}
	const firstCode = rest.charCodeAt(nonSpaceIdx);
	if (
		firstCode !== 0x2d && // -
		firstCode !== 0x2a && // *
		firstCode !== 0x2b && // +
		(firstCode < 0x30 || firstCode > 0x39) // 0-9
	) {
		return null;
	}
	const leadCols = measureLeadingColumns(cursor);
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
	if (!line.includes("<")) {
		return null;
	}
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
	if (!analysis.content.includes("`") && !analysis.content.includes("~")) {
		return null;
	}
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
	const relativeIndent = analysis.indent - analysis.containerIndent;
	const canPeelNestedQuote =
		relativeIndent >= 0 &&
		relativeIndent < 4 &&
		analysis.content.startsWith(">");
	if (direct || (!analysis.listMarker && !canPeelNestedQuote)) {
		return direct;
	}

	const containers: ContainerStep[] = analysis.listMarker
		? [
				...baseSteps,
				{ indent: analysis.listMarker.contentIndent, kind: "list" },
			]
		: [...directSteps];
	let quoteDepth = analysis.quoteDepth;
	let innerColumn = analysis.listMarker
		? analysis.column + analysis.listMarker.contentIndent
		: analysis.column + analysis.indent;
	let innerRest = analysis.listMarker
		? analysis.listMarker.afterContent
		: analysis.content;
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
		quoteDepth === analysis.quoteDepth
			? (analysis.listMarker?.contentIndent ?? analysis.containerIndent)
			: 0;
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

export type LineAnalysis = Readonly<{
	column: number;
	containerIndent: number;
	content: string;
	indent: number;
	listMarker: ListMarkerMatch | null;
	prefix: string;
	quoteDepth: number;
	rest: string;
}>;

export function analyzeLine(line: string, containerIndent: number): LineAnalysis {
	const { column, depth, prefix, rest } = readBlockquotePrefix(line);
	const indentText = /^[ \t]*/.exec(rest)?.[0] ?? "";
	const rawMarker = matchListMarker(rest, column);
	const listMarker =
		rawMarker !== null &&
		rawMarker.leadCols <=
			(rawMarker.leadCols >= containerIndent ? containerIndent : 0) + 3
			? rawMarker
			: null;
	return {
		column,
		containerIndent,
		content: rest.slice(indentText.length),
		indent: measureIndentColumns(rest, column),
		listMarker,
		prefix,
		quoteDepth: depth,
		rest,
	};
}

export const ATX_HEADING = /^#{1,6}(?:[ \t]+.*|[ \t]*)$/;
export const THEMATIC_BREAK =
	/^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
export const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const CONTAINER_QUOTE = /^ {0,3}>[ \t]?/;
const CONTAINER_LIST_MARKER = /^ {0,3}(?:[-+*]|(\d{1,9})[.)])(?=[ \t]|$)/;
const leadingColumns = (text: string): number => measureIndentColumns(text, 0);

/**
 * Whether a line emitted as text leaves a paragraph open (so the next line
 * cannot start a reference definition), classified on the content inside any
 * nested quote/list containers, plus the quote depth those containers add.
 */
export function classifyParagraphLine(
	content: string,
	relativeIndent: number,
	paragraphOpen: boolean,
	listInterruptionInParagraph: boolean,
): Readonly<{ nestedQuotes: number; open: boolean }> {
	let inner = content;
	let nestedQuotes = 0;
	if (relativeIndent > 3) return { nestedQuotes, open: true };
	for (let depth = 0; depth < 32; depth += 1) {
		const nested = depth > 0;
		const trimmed = inner.replace(/^[ \t]+|[ \t]+$/g, "");
		if (
			trimmed === "" ||
			(nested && leadingColumns(inner) >= 4) ||
			ATX_HEADING.test(trimmed) ||
			THEMATIC_BREAK.test(trimmed) ||
			(!nested && listInterruptionInParagraph && SETEXT_UNDERLINE.test(trimmed))
		) {
			return { nestedQuotes, open: false };
		}
		const quote = CONTAINER_QUOTE.exec(inner);
		const marker = quote ? null : CONTAINER_LIST_MARKER.exec(inner);
		if (quote) {
			inner = inner.slice(quote[0].length);
			nestedQuotes += 1;
			continue;
		}
		if (!marker) return { nestedQuotes, open: true };
		const after = inner.slice(marker[0].length);
		const blank = isCommonMarkBlankLine(after);
		// An empty or non-"1" ordered item cannot interrupt an open paragraph.
		const ordered = marker[1];
		if (
			!nested &&
			listInterruptionInParagraph &&
			(blank || (ordered !== undefined && ordered !== "1"))
		) {
			return { nestedQuotes, open: true };
		}
		// Marker spacing of 5+ columns starts indented code in the item.
		if (blank || leadingColumns(after) >= 5) {
			return { nestedQuotes, open: false };
		}
		inner = after.replace(/^[ \t]/, "");
	}
	return { nestedQuotes, open: paragraphOpen || true };
}

export type BlockMathScanState = {
	noBracketCloseBefore: number;
	noBracketCloseContainer: number;
	noDollarCloseBefore: number;
	noDollarCloseContainer: number;
};

/**
 * Last line of a `$$...$$` or `\[...\]` block starting at `start`, or -1. A
 * mid-line display formula that is neither a one-line block nor a canonical
 * fence line is left to the inline scanner. Uses monotonic unclosed boundaries
 * so repeated unclosed `\[` / `$$` lines stay strictly O(N).
 */
export function findBlockMathEnd(
	lines: ReadonlyArray<string>,
	start: number,
	content: string,
	containerIndent: number,
	scanState: BlockMathScanState,
): number {
	const dollar = content.startsWith("$$") && !content.startsWith("$$$$");
	if (!dollar && !content.startsWith("\\[")) return -1;
	const single = dollar
		? /^\$\$([\s\S]+?)\$\$[ \t]*$/.exec(content)
		: /^\\\[([\s\S]+?)\\\][ \t]*$/.exec(content);
	const inner = single?.[1] ?? "";
	if (single && (dollar ? !inner.includes("$$") : inner.trim().length > 0)) {
		return start;
	}
	if (!(dollar ? /^\$\$[ \t]*$/ : /^\\\[[ \t]*$/).test(content)) return -1;
	const noCloseBefore = dollar
		? scanState.noDollarCloseBefore
		: scanState.noBracketCloseBefore;
	const noCloseContainer = dollar
		? scanState.noDollarCloseContainer
		: scanState.noBracketCloseContainer;
	if (
		start < noCloseBefore &&
		(noCloseContainer === -1 || noCloseContainer === containerIndent)
	) {
		return -1;
	}
	const close = dollar ? "$$" : "\\]";
	for (let k = start + 1; k < lines.length; k += 1) {
		const candidate = lines[k] ?? "";
		if (
			!candidate.includes(close) &&
			!candidate.includes("`") &&
			!candidate.includes("~")
		) {
			continue;
		}
		const next = analyzeLine(candidate, containerIndent);
		if (detectFence(next)) {
			if (dollar) {
				scanState.noDollarCloseBefore = k;
				scanState.noDollarCloseContainer = containerIndent;
			} else {
				scanState.noBracketCloseBefore = k;
				scanState.noBracketCloseContainer = containerIndent;
			}
			return -1;
		}
		if (next.content.trimEnd().endsWith(close)) return k;
	}
	if (dollar) {
		scanState.noDollarCloseBefore = lines.length;
		scanState.noDollarCloseContainer = -1;
	} else {
		scanState.noBracketCloseBefore = lines.length;
		scanState.noBracketCloseContainer = -1;
	}
	return -1;
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
		const stripped = stripBlockquoteDepth(line, depth);
		if (stripped !== null) {
			result = stripped;
			startColumn = readBlockquotePrefix(line).column;
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
