import type { PhpCommonMarkBlockState } from "../../shared/markdown/php-commonmark-block-engine";
import {
	COMMONMARK_ATX_HEADING_OPEN,
	COMMONMARK_SETEXT_UNDERLINE,
	COMMONMARK_THEMATIC_BREAK_LINE,
	consumeBlockquoteMarker,
	consumeWhitespaceColumns,
	cursorRemainder,
	isCursorBlank,
	matchHtmlBlockOpen,
	measureLeadingColumns,
	nextNonSpaceIndex,
} from "../../shared/markdown/php-commonmark-block-helpers";
import {
	type ContainerStep,
	canListMarkerInterruptParagraph,
	consumeContainerSteps,
	createLineCursor,
	cursorPrefix,
	hasListBeforeQuote,
	isCommonMarkBlankLine,
	type ListMarkerMatch,
	matchListMarker,
	measureIndentColumns,
	peelNestedContainers,
	readBlockquotePrefix,
	stripContainersWithColumn,
} from "./markdown-prescanner-containers";

export {
	type ContainerStep,
	canListMarkerInterruptParagraph,
	formatContainerPrefix,
	hasListBeforeQuote,
	isCommonMarkBlankLine,
	matchListMarker,
	measureIndentColumns,
	type PeeledLineContainers,
	peelContainerStepsForLine,
	readBlockquotePrefix,
	stripBlockContainerPrefix,
	stripBlockquoteDepth,
	stripContainers,
	stripContainersWithColumn,
	stripPartialContainers,
	sumListContainerIndent,
} from "./markdown-prescanner-containers";

/**
 * Feature-private block-structure detection helpers for `markdown-prescanner.ts`:
 * CommonMark §4.6 Types 1–7 HTML block matching, container-aware fenced code
 * detection, footnote-block scanning, line-container resolution, paragraph
 * classification, and standalone block math scanning.
 */

type ListPrefixedHtmlMatch = Readonly<{
	containers: ReadonlyArray<ContainerStep>;
	content: string;
	contentIndent: number;
	contentOffset: number;
	htmlType: 1 | 2 | 3 | 4 | 5 | 6 | 7;
	linePrefix: string;
	virtualSpaces: number;
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
		if (consumeContainerSteps(cursor, activeContainers, false)) {
			containers.push(...activeContainers);
			seededInterleaved = true;
		} else {
			cursor.column = 0;
			cursor.index = 0;
			cursor.virtualSpaces = 0;
		}
	}
	if (!seededInterleaved) {
		while (consumeBlockquoteMarker(cursor)) {
			containers.push({ kind: "blockquote" });
		}
	}
	const outerQuoteCount = seededInterleaved ? 0 : containers.length;
	let consumedPrevList = false;
	if (!seededInterleaved && prevContainerIndent > 0 && !isCursorBlank(cursor)) {
		const leadCols = measureLeadingColumns(cursor);
		if (leadCols >= prevContainerIndent) {
			if (leadCols - prevContainerIndent > 3) {
				return null;
			}
			consumeWhitespaceColumns(cursor, prevContainerIndent);
			containers.push({ indent: prevContainerIndent, kind: "list" });
			consumedPrevList = true;
		}
	}

	const { matchedList, quotesAdded } = peelNestedContainers(
		cursor,
		containers,
		!inParagraph,
		seededInterleaved || consumedPrevList,
	);
	if (
		(!matchedList &&
			!((seededInterleaved || consumedPrevList) && quotesAdded > 0)) ||
		measureLeadingColumns(cursor) > 3
	) {
		return null;
	}
	const htmlCandidate = line.slice(nextNonSpaceIndex(cursor));
	if (!htmlCandidate.startsWith("<")) {
		return null;
	}
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
	return {
		containers,
		content: cursorRemainder(cursor),
		contentIndent,
		contentOffset: cursor.index,
		htmlType,
		linePrefix: cursorPrefix(cursor),
		virtualSpaces: cursor.virtualSpaces,
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

type FenceLineSummary = Readonly<{
	column: number;
	containerIndent: number;
	content: string;
	indent: number;
	listMarker: ListMarkerMatch | null;
	quoteDepth: number;
}>;

function fenceContainersOf(
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
	const innerCursor = createLineCursor(
		analysis.listMarker ? analysis.listMarker.afterContent : analysis.content,
		analysis.listMarker
			? analysis.column + analysis.listMarker.contentIndent
			: analysis.column + analysis.indent,
	);
	const { quotesAdded } = peelNestedContainers(
		innerCursor,
		containers,
		true,
		true,
	);
	const quoteDepth = analysis.quoteDepth + quotesAdded;
	const matched = matchFenceAt(
		cursorRemainder(innerCursor).replace(/^[ \t]+/, ""),
		measureLeadingColumns(innerCursor),
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
	const firstCode = rest.length > 0 ? rest.charCodeAt(0) : -1;
	if (firstCode !== 0x20 && firstCode !== 0x09) {
		const couldBeList =
			firstCode === 0x2d ||
			firstCode === 0x2a ||
			firstCode === 0x2b ||
			(firstCode >= 0x30 && firstCode <= 0x39);
		const rawMarker = couldBeList ? matchListMarker(rest, column) : null;
		const listMarker =
			rawMarker !== null &&
			rawMarker.leadCols <=
				(rawMarker.leadCols >= containerIndent ? containerIndent : 0) + 3
				? rawMarker
				: null;
		return {
			column,
			containerIndent,
			content: rest,
			indent: 0,
			listMarker,
			prefix,
			quoteDepth: depth,
			rest,
		};
	}
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

type ResolvedLineContainerContext = Readonly<{
	acceptedListMarker: ListMarkerMatch | null;
	activeInterleavedContainers: ReadonlyArray<ContainerStep> | null;
	analysis: LineAnalysis;
	clearParagraph: boolean;
	continuesListItem: boolean;
	droppedOutOfList: boolean;
	effectiveContainer: number;
	hasInterleavedContainers: boolean;
	lineQuoteDepth: number;
	listInterruptionInParagraph: boolean;
	nextListContentIndent: number | null;
	nextParagraphHasContent: boolean;
	nextParagraphOpen: boolean;
	preMarkerContainerIndent: number;
	prevContainerIndent: number;
	prevListIndent: number | null;
}>;

/**
 * Resolves active list / blockquote / interleaved `list -> quote` container
 * state for one non-blank line in `prescanMarkdown`.
 */
export function resolveLineContainerContext(
	line: string,
	baseAnalysis: LineAnalysis,
	phpBlockState: PhpCommonMarkBlockState,
	listContentIndent: number | null,
	paragraphOpen: boolean,
	paragraphHasContent: boolean,
	paragraphQuoteDepth: number,
): ResolvedLineContainerContext {
	const hasInterleavedContainers =
		phpBlockState.containers.length > 1 &&
		hasListBeforeQuote(phpBlockState.containers);
	const phpContainers: ContainerStep[] = hasInterleavedContainers
		? phpBlockState.containers.map((container) =>
				container.kind === "blockquote"
					? { kind: "blockquote" }
					: { indent: container.indent, kind: "list" },
			)
		: [];
	const matchedInterleaved = hasInterleavedContainers
		? stripContainersWithColumn(line, phpContainers)
		: null;

	if (matchedInterleaved !== null) {
		const interRest = matchedInterleaved.rest;
		const interColumn = matchedInterleaved.column;
		const interIndent = measureIndentColumns(interRest, interColumn);
		const interContent = interRest.replace(/^[ \t]+/, "");
		const opensDeeperQuote = interIndent < 4 && interContent.startsWith(">");
		let interQuoteDepth = 0;
		for (const step of phpContainers) {
			if (step.kind === "blockquote") interQuoteDepth += 1;
		}
		const phpLeaf = phpBlockState.leaf;
		const nextParagraphOpen = !opensDeeperQuote && phpLeaf?.kind === "paragraph";
		const nextParagraphHasContent =
			nextParagraphOpen && (phpLeaf?.paragraphLineCount ?? 0) > 0;
		const rawInterMarker = matchListMarker(interRest, interColumn);
		const boundedInterMarker =
			rawInterMarker !== null && rawInterMarker.leadCols <= 3
				? rawInterMarker
				: null;
		const listInterruptionInParagraph =
			nextParagraphOpen && nextParagraphHasContent && !opensDeeperQuote;
		const acceptedListMarker =
			boundedInterMarker !== null &&
			(!listInterruptionInParagraph ||
				canListMarkerInterruptParagraph(boundedInterMarker))
				? boundedInterMarker
				: null;
		const effectiveContainer =
			acceptedListMarker !== null ? acceptedListMarker.contentIndent : 0;
		return {
			acceptedListMarker,
			activeInterleavedContainers: phpContainers,
			analysis: {
				column: interColumn,
				containerIndent: effectiveContainer,
				content: interContent,
				indent: interIndent,
				listMarker: acceptedListMarker,
				prefix: matchedInterleaved.prefix,
				quoteDepth: interQuoteDepth,
				rest: interRest,
			},
			clearParagraph: opensDeeperQuote,
			continuesListItem: true,
			droppedOutOfList: false,
			effectiveContainer,
			hasInterleavedContainers,
			lineQuoteDepth: interQuoteDepth,
			listInterruptionInParagraph,
			nextListContentIndent: listContentIndent,
			nextParagraphHasContent,
			nextParagraphOpen,
			preMarkerContainerIndent: 0,
			prevContainerIndent: 0,
			prevListIndent: listContentIndent,
		};
	}

	const lineQuoteDepth = baseAnalysis.quoteDepth;
	const clearParagraph = paragraphOpen && lineQuoteDepth > paragraphQuoteDepth;
	const nextParagraphOpen = clearParagraph ? false : paragraphOpen;
	const nextParagraphHasContent = clearParagraph ? false : paragraphHasContent;
	const prevContainerIndent = listContentIndent ?? 0;
	let quotedBlankListIndent = 0;
	if (
		listContentIndent !== null &&
		lineQuoteDepth > 0 &&
		isCommonMarkBlankLine(baseAnalysis.rest)
	) {
		let phpQuotes = 0;
		for (const container of phpBlockState.containers) {
			if (container.kind === "blockquote") {
				phpQuotes += 1;
				if (phpQuotes > lineQuoteDepth) {
					quotedBlankListIndent = 0;
					break;
				}
			} else if (container.hasContent) {
				quotedBlankListIndent += container.indent;
			} else {
				break;
			}
		}
		if (phpQuotes === 0) {
			quotedBlankListIndent = 0;
		}
	}
	const continuesListItem =
		listContentIndent === null ||
		baseAnalysis.indent >= listContentIndent ||
		quotedBlankListIndent > 0;
	const listInterruptionInParagraph =
		!hasInterleavedContainers &&
		nextParagraphOpen &&
		nextParagraphHasContent &&
		lineQuoteDepth === paragraphQuoteDepth &&
		continuesListItem;
	const rawListMarker = baseAnalysis.listMarker;
	const acceptedListMarker =
		rawListMarker !== null &&
		(!listInterruptionInParagraph ||
			canListMarkerInterruptParagraph(rawListMarker))
			? rawListMarker
			: null;

	let nextListContentIndent = listContentIndent;
	let droppedOutOfList = false;
	if (acceptedListMarker !== null) {
		nextListContentIndent = acceptedListMarker.contentIndent;
	} else if (quotedBlankListIndent > 0) {
		nextListContentIndent = quotedBlankListIndent;
	} else if (!continuesListItem) {
		droppedOutOfList = true;
		if (!nextParagraphOpen) {
			nextListContentIndent = null;
		}
	}

	const effectiveContainer =
		acceptedListMarker !== null
			? acceptedListMarker.contentIndent
			: droppedOutOfList
				? 0
				: (nextListContentIndent ?? 0);
	const preMarkerContainerIndent =
		acceptedListMarker !== null
			? acceptedListMarker.leadCols >= prevContainerIndent
				? prevContainerIndent
				: 0
			: effectiveContainer;
	const analysis =
		baseAnalysis.containerIndent !== effectiveContainer ||
		baseAnalysis.listMarker !== acceptedListMarker
			? {
					...baseAnalysis,
					containerIndent: effectiveContainer,
					listMarker: acceptedListMarker,
				}
			: baseAnalysis;

	return {
		acceptedListMarker,
		activeInterleavedContainers: null,
		analysis,
		clearParagraph,
		continuesListItem,
		droppedOutOfList,
		effectiveContainer,
		hasInterleavedContainers,
		lineQuoteDepth,
		listInterruptionInParagraph,
		nextListContentIndent,
		nextParagraphHasContent,
		nextParagraphOpen,
		preMarkerContainerIndent,
		prevContainerIndent,
		prevListIndent: listContentIndent,
	};
}

export {
	COMMONMARK_ATX_HEADING_OPEN as ATX_HEADING,
	COMMONMARK_SETEXT_UNDERLINE as SETEXT_UNDERLINE,
	COMMONMARK_THEMATIC_BREAK_LINE as THEMATIC_BREAK,
} from "../../shared/markdown/php-commonmark-block-helpers";
const CONTAINER_QUOTE = /^ {0,3}>[ \t]?/;
const CONTAINER_LIST_MARKER = /^ {0,3}(?:[-+*]|(\d{1,9})[.)])(?=[ \t]|$)/;
const leadingColumns = (text: string): number => measureIndentColumns(text, 0);

/**
 * Whether a line emitted as text leaves a paragraph open (so the next line
 * cannot start a reference definition), classified on the content inside any
 * nested quote/list containers, plus the quote depth those containers add.
 */
const PLAIN_PARAGRAPH_STATE = { nestedQuotes: 0, open: true } as const;

export function classifyParagraphLine(
	content: string,
	relativeIndent: number,
	paragraphOpen: boolean,
	listInterruptionInParagraph: boolean,
): Readonly<{ nestedQuotes: number; open: boolean }> {
	if (relativeIndent > 3) return PLAIN_PARAGRAPH_STATE;
	if (content.length > 0) {
		const c0 = content.charCodeAt(0);
		if (
			c0 !== 0x20 &&
			c0 !== 0x09 &&
			c0 !== 0x23 && // #
			c0 !== 0x2a && // *
			c0 !== 0x2b && // +
			c0 !== 0x2d && // -
			c0 !== 0x3d && // =
			c0 !== 0x3e && // >
			c0 !== 0x5f && // _
			(c0 < 0x30 || c0 > 0x39)
		) {
			return PLAIN_PARAGRAPH_STATE;
		}
	}
	let inner = content;
	let nestedQuotes = 0;
	for (let depth = 0; depth < 32; depth += 1) {
		const nested = depth > 0;
		const trimmed = inner.replace(/^[ \t]+|[ \t]+$/g, "");
		if (
			trimmed === "" ||
			(nested && leadingColumns(inner) >= 4) ||
			COMMONMARK_ATX_HEADING_OPEN.test(trimmed) ||
			COMMONMARK_THEMATIC_BREAK_LINE.test(trimmed) ||
			(!nested &&
				listInterruptionInParagraph &&
				COMMONMARK_SETEXT_UNDERLINE.test(trimmed))
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
		const ordered = marker[1];
		if (
			!nested &&
			listInterruptionInParagraph &&
			(blank || (ordered !== undefined && ordered !== "1"))
		) {
			return { nestedQuotes, open: true };
		}
		if (blank || leadingColumns(after) >= 5) {
			return { nestedQuotes, open: false };
		}
		inner = after.replace(/^[ \t]/, "");
	}
	return { nestedQuotes, open: paragraphOpen || true };
}

export function findFootnoteDefinitionEnd(
	lines: ReadonlyArray<string>,
	start: number,
	effectiveContainer: number,
): number {
	let end = start;
	while (end + 1 < lines.length) {
		const next = analyzeLine(lines[end + 1] ?? "", effectiveContainer);
		if (
			/^(?: {2,}|\t)/.test(next.rest) ||
			/^\[\^([^\s\]]+)\]:(?:[ \t]|$)/.test(next.content)
		) {
			end += 1;
			continue;
		}
		if (isCommonMarkBlankLine(next.content)) {
			let lookahead = end + 1;
			while (
				lookahead < lines.length &&
				isCommonMarkBlankLine(lines[lookahead] ?? "")
			) {
				lookahead += 1;
			}
			const after = analyzeLine(lines[lookahead] ?? "", effectiveContainer);
			if (lookahead < lines.length && after.indent >= 2) {
				end = lookahead;
				continue;
			}
		}
		break;
	}
	return end;
}
