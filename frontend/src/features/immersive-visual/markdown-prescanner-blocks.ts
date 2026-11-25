import {
	htmlBlockLineCloses,
	matchHtmlBlockOpen,
} from "../../shared/markdown/php-commonmark-block-helpers";

/**
 * Feature-private block-structure helpers for `markdown-prescanner.ts`:
 * CommonMark §2.2 ASCII blank-line checks, container-indent / blockquote
 * stripping, GFM table boundary scanning, and CommonMark §4.6 Types 1-7 HTML
 * block matching (including list-marker-prefixed HTML blocks).
 */

/**
 * CommonMark §2.2 blank line: contains only ASCII spaces (U+0020) and tabs
 * (U+0009). Unlike JS `.trim()`, U+00A0 (NBSP) is NOT a blank line.
 */
export function isCommonMarkBlankLine(text: string): boolean {
	return /^[ \t]*$/.test(text);
}

export function readBlockquotePrefix(
	line: string,
): Readonly<{ prefix: string; rest: string }> {
	const prefix = /^(?: {0,3}>[ \t]?)*/.exec(line)?.[0] ?? "";
	return { prefix, rest: line.slice(prefix.length) };
}

export function blockquoteDepth(prefix: string): number {
	return (prefix.match(/>/g) ?? []).length;
}

export function stripBlockquoteDepth(
	line: string,
	depth: number,
): string | null {
	let rest = line;
	for (let d = 0; d < depth; d += 1) {
		const match = /^ {0,3}>[ \t]?/.exec(rest);
		if (!match) {
			return null;
		}
		rest = rest.slice(match[0].length);
	}
	return rest;
}

export function advanceColumns(text: string, startColumn = 0): number {
	let column = startColumn;
	for (const ch of text) {
		column = ch === "\t" ? column + 4 - (column % 4) : column + 1;
	}
	return column;
}

export function stripContainerIndent(
	rest: string,
	containerIndent: number,
): string | null {
	if (containerIndent <= 0) {
		return rest;
	}
	let column = 0;
	let index = 0;
	while (index < rest.length && column < containerIndent) {
		const ch = rest[index];
		if (ch === " ") {
			column += 1;
			index += 1;
		} else if (ch === "\t") {
			column += 4 - (column % 4);
			index += 1;
		} else {
			break;
		}
	}
	if (column < containerIndent) {
		return null;
	}
	return `${" ".repeat(column - containerIndent)}${rest.slice(index)}`;
}

export type ListMarkerMatch = Readonly<{ contentIndent: number }>;

export function matchListMarker(rest: string): ListMarkerMatch | null {
	const match = /^( *)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(rest);
	if (!match?.[2]) {
		return null;
	}
	const indent = match[1]?.length ?? 0;
	const spaces = match[3] ?? "";
	const content = match[4] ?? "";
	const padding = content.length > 0 && spaces.length > 4 ? 1 : spaces.length;
	return { contentIndent: indent + match[2].length + Math.max(padding, 1) };
}

function countGfmTableDelimiterColumns(text: string): number {
	const trimmed = text.trim();
	if (
		!trimmed.includes("-") ||
		!trimmed.includes("|") ||
		/^-[ \t]/u.test(trimmed) ||
		!/^[|\-: \t]+$/u.test(trimmed)
	) {
		return 0;
	}
	const parts = trimmed.split("|");
	if (parts[0] === "") {
		parts.shift();
	}
	if (parts.length > 0 && parts[parts.length - 1] === "") {
		parts.pop();
	}
	if (parts.length === 0) {
		return 0;
	}
	for (const part of parts) {
		if (!/^:?-+:?$/u.test(part.trim())) {
			return 0;
		}
	}
	return parts.length;
}

function countGfmTableHeaderColumns(text: string): number {
	const trimmed = text.trim();
	if (!trimmed.includes("|")) {
		return 0;
	}
	const cells: string[] = [];
	let current = "";
	let index = trimmed[0] === "|" ? 1 : 0;
	while (index < trimmed.length) {
		const ch = trimmed[index] ?? "";
		if (ch === "\\" && trimmed[index + 1] === "|") {
			current += "|";
			index += 2;
			continue;
		}
		if (ch === "|") {
			cells.push(current);
			current = "";
			index += 1;
			continue;
		}
		current += ch;
		index += 1;
	}
	if (current.length > 0) {
		cells.push(current);
	}
	return cells.length;
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
	const headerDepth = blockquoteDepth(headerBq.prefix);
	const delimiterDepth = blockquoteDepth(delimiterBq.prefix);
	if (headerDepth !== delimiterDepth) {
		return false;
	}
	if (expectedQuoteDepth !== null && headerDepth !== expectedQuoteDepth) {
		return false;
	}

	let effContainer = containerIndent;
	let headerCandidate = stripContainerIndent(headerBq.rest, effContainer);
	if (headerCandidate === null) {
		return false;
	}
	const headerLeadMatch = /^[ \t]*/.exec(headerCandidate)?.[0] ?? "";
	const headerRelIndent =
		advanceColumns(headerLeadMatch, effContainer) - effContainer;
	if (headerRelIndent >= 4) {
		return false;
	}
	const headerListMarker = matchListMarker(headerCandidate);
	if (headerListMarker !== null) {
		if (!allowLeadingListMarker) {
			return false;
		}
		effContainer += headerListMarker.contentIndent;
		headerCandidate = headerCandidate.slice(headerListMarker.contentIndent);
	}

	const delimiterCandidate = stripContainerIndent(
		delimiterBq.rest,
		effContainer,
	);
	if (delimiterCandidate === null) {
		return false;
	}
	const delimiterLeadMatch = /^[ \t]*/.exec(delimiterCandidate)?.[0] ?? "";
	const delimiterRelIndent =
		advanceColumns(delimiterLeadMatch, effContainer) - effContainer;
	if (delimiterRelIndent >= 4) {
		return false;
	}

	const headerColumns = countGfmTableHeaderColumns(headerCandidate);
	if (headerColumns === 0) {
		return false;
	}
	return headerColumns === countGfmTableDelimiterColumns(delimiterCandidate);
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
	quoteDepth: number,
	containerIndent: number,
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
		const rawLine = lines[k] ?? "";
		const afterQuote =
			quoteDepth > 0 ? stripBlockquoteDepth(rawLine, quoteDepth) : rawLine;
		if (afterQuote === null) {
			break;
		}
		const afterContainer =
			containerIndent > 0 && !isCommonMarkBlankLine(afterQuote)
				? stripContainerIndent(afterQuote, containerIndent)
				: afterQuote;
		if (afterContainer === null) {
			break;
		}
		if (htmlType === 6 || htmlType === 7) {
			if (isCommonMarkBlankLine(afterContainer)) {
				break;
			}
			end = k;
			continue;
		}
		end = k;
		if (htmlBlockLineCloses(htmlType, afterContainer)) {
			return end;
		}
	}
	return end;
}

export type ListPrefixedHtmlMatch = Readonly<{
	content: string;
	contentIndent: number;
	htmlType: 1 | 2 | 3 | 4 | 5 | 6 | 7;
	markerPrefix: string;
}>;

export function matchListPrefixedHtmlBlock(
	rest: string,
	paragraphOpen: boolean,
	prevContainerIndent: number,
): ListPrefixedHtmlMatch | null {
	let cursor = 0;
	let column = 0;
	let containerCol = prevContainerIndent;
	let matchedAny = false;
	let firstMarker = true;

	while (cursor < rest.length) {
		const slice = rest.slice(cursor);
		const leadMatch = /^[ \t]*/.exec(slice)?.[0] ?? "";
		const afterLeadCol = advanceColumns(leadMatch, column);
		if (firstMarker && afterLeadCol < containerCol) {
			containerCol = 0;
		}
		const relIndent = afterLeadCol - containerCol;
		if (relIndent < 0 || relIndent > 3) {
			break;
		}
		const afterLead = slice.slice(leadMatch.length);
		const markerMatch = /^([-*+]|(\d{1,9})[.)])([ \t]+)(.*)$/.exec(afterLead);
		if (!markerMatch?.[1]) {
			break;
		}
		const orderedDigits = markerMatch[2];
		const afterSpaces = markerMatch[4] ?? "";
		if (
			firstMarker &&
			paragraphOpen &&
			(isCommonMarkBlankLine(afterSpaces) ||
				(orderedDigits !== undefined && Number(orderedDigits) !== 1))
		) {
			break;
		}
		const markerEndCol = afterLeadCol + markerMatch[1].length;
		const spacesText = markerMatch[3] ?? "";
		const afterSpacesCol = advanceColumns(spacesText, markerEndCol);
		const spacingWidth = afterSpacesCol - markerEndCol;
		if (spacingWidth > 4) {
			return null;
		}
		cursor += leadMatch.length + markerMatch[1].length + spacesText.length;
		column = afterSpacesCol;
		containerCol = afterSpacesCol;
		matchedAny = true;
		firstMarker = false;
	}

	if (!matchedAny) {
		return null;
	}
	const content = rest.slice(cursor);
	if (!content.startsWith("<")) {
		return null;
	}
	// A fresh list item always starts outside any open paragraph.
	const htmlType = matchHtmlBlockOpen(content, true);
	if (htmlType === null) {
		return null;
	}
	return {
		content,
		contentIndent: containerCol,
		htmlType,
		markerPrefix: rest.slice(0, cursor),
	};
}
