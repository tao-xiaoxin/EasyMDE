/**
 * Low-level CommonMark / GFM line-cursor, HTML-block, list-marker, and
 * GFM table-row helpers mirroring PHP `League\CommonMark` for
 * `php-commonmark-block-scan.ts`.
 */

export const COMMONMARK_ATX_HEADING_OPEN = /^#{1,6}(?:[ \t]+|$)/u;
export const COMMONMARK_SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/u;
export const COMMONMARK_FENCED_CODE_OPEN = /^(?:`{3,}[^`]*$|~{3,})/u;
export const COMMONMARK_FENCED_CODE_CLOSE = /^(`{3,}|~{3,})[ \t]*$/u;
export const COMMONMARK_THEMATIC_BREAK_LINE =
	/^(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/u;
export const COMMONMARK_FENCE_OPEN_WITH_INFO = /^(`{3,}|~{3,})(.*)$/u;
const ORDERED_LIST_MARKER = /^(\d{1,9})([.)])/u;

// Exact League\CommonMark\Util\RegexHelper::getHtmlBlockOpenRegex() Types 1–6.
// Tested against `asciiLowerCase(...)` without `/i` so Unicode case-folding
// (e.g. U+017F `ſ` -> `s` in `<ſtyle>`) cannot match ASCII HTML tags.
export const COMMONMARK_HTML_BLOCK_TYPE_1_OPEN =
	/^<(?:script|pre|textarea|style)(?:[ \t\f\v]|>|$)/u;
export const COMMONMARK_HTML_BLOCK_TYPE_6_OPEN =
	/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t\f\v]|\/?>|$)/u;

const HTML_OPEN_RE: ReadonlyArray<readonly [1 | 2 | 3 | 4 | 5 | 6, RegExp]> = [
	[1, COMMONMARK_HTML_BLOCK_TYPE_1_OPEN],
	[2, /^<!--/u],
	[3, /^<\?/u],
	[4, /^<![a-z]/u],
	[5, /^<!\[cdata\[/u],
	[6, COMMONMARK_HTML_BLOCK_TYPE_6_OPEN],
];
const HTML_CLOSE_RE: Readonly<Record<1 | 2 | 3 | 4 | 5, RegExp>> = {
	1: /<\/(?:script|pre|textarea|style)>/u,
	2: /-->/u,
	3: /\?>/u,
	4: />/u,
	5: /\]\]>/u,
};
const HTML_TYPE_7_CLOSE_TAG =
	/^<\/[A-Za-z][A-Za-z0-9-]*[ \t\v\f]*>[ \t\v\f]*$/u;

export type LineColumnCursor = {
	column: number;
	index: number;
	line: string;
	virtualSpaces: number;
};

export function asciiLowerCase(value: string): string {
	return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

function isSpaceOrTab(character: string | undefined): boolean {
	return " " === character || "\t" === character;
}

function isHorizontalHtmlWhitespace(ch: string | undefined): boolean {
	return " " === ch || "\t" === ch || "\v" === ch || "\f" === ch;
}

function isAsciiLetter(code: number): boolean {
	return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isPhpTrimChar(ch: string | undefined): boolean {
	if (!ch) return false;
	const code = ch.charCodeAt(0);
	return (
		32 === code ||
		9 === code ||
		10 === code ||
		11 === code ||
		13 === code ||
		0 === code
	);
}

export function measureLeadingColumns(cursor: LineColumnCursor): number {
	let cols = cursor.virtualSpaces;
	let col = cursor.column + cols;
	for (let idx = cursor.index; idx < cursor.line.length; idx += 1) {
		const ch = cursor.line[idx];
		if (" " === ch) {
			cols += 1;
			col += 1;
		} else if ("\t" === ch) {
			const width = 4 - (col % 4);
			cols += width;
			col += width;
		} else {
			break;
		}
	}
	return cols;
}

export function nextNonSpaceIndex(cursor: LineColumnCursor): number {
	let idx = cursor.index;
	while (idx < cursor.line.length && isSpaceOrTab(cursor.line[idx])) idx += 1;
	return idx;
}

export function isCursorBlank(cursor: LineColumnCursor): boolean {
	return nextNonSpaceIndex(cursor) >= cursor.line.length;
}

export function consumeWhitespaceColumns(
	cursor: LineColumnCursor,
	targetColumns: number,
): void {
	let remaining = targetColumns;
	if (cursor.virtualSpaces > 0) {
		const take = Math.min(cursor.virtualSpaces, remaining);
		cursor.virtualSpaces -= take;
		cursor.column += take;
		remaining -= take;
	}
	while (remaining > 0 && cursor.index < cursor.line.length) {
		const ch = cursor.line[cursor.index];
		if (" " === ch) {
			cursor.index += 1;
			cursor.column += 1;
			remaining -= 1;
		} else if ("\t" === ch) {
			const width = 4 - (cursor.column % 4);
			cursor.index += 1;
			if (width <= remaining) {
				cursor.column += width;
				remaining -= width;
			} else {
				cursor.column += remaining;
				cursor.virtualSpaces = width - remaining;
				remaining = 0;
			}
		} else {
			break;
		}
	}
}

export function consumeBlockquoteMarker(cursor: LineColumnCursor): boolean {
	const leadCols = measureLeadingColumns(cursor);
	if (leadCols >= 4 || ">" !== cursor.line[nextNonSpaceIndex(cursor)]) {
		return false;
	}
	consumeWhitespaceColumns(cursor, leadCols);
	cursor.index += 1;
	cursor.column += 1;
	if (
		cursor.index < cursor.line.length &&
		isSpaceOrTab(cursor.line[cursor.index])
	) {
		consumeWhitespaceColumns(cursor, 1);
	}
	return true;
}

export function cursorRemainder(cursor: LineColumnCursor): string {
	const tail = cursor.line.slice(cursor.index);
	return cursor.virtualSpaces > 0
		? `${" ".repeat(cursor.virtualSpaces)}${tail}`
		: tail;
}

/**
 * Linear O(L) matcher for CommonMark §4.6 HTML block Type 7 (single complete
 * open or closing tag followed only by optional horizontal whitespace).
 */
function isHtmlBlockType7(remainder: string): boolean {
	if (!remainder.startsWith("<")) return false;
	if ("/" === remainder[1]) return HTML_TYPE_7_CLOSE_TAG.test(remainder);
	const length = remainder.length;
	let pos = 1;
	if (pos >= length || !isAsciiLetter(remainder.charCodeAt(pos))) return false;
	while (++pos < length) {
		const c = remainder.charCodeAt(pos);
		if (!isAsciiLetter(c) && (c < 0x30 || c > 0x39) && 0x2d !== c) break;
	}
	while (pos < length) {
		const wsStart = pos;
		while (pos < length && isHorizontalHtmlWhitespace(remainder[pos])) pos += 1;
		if (">" === remainder[pos]) {
			pos += 1;
			break;
		}
		if ("/" === remainder[pos] && ">" === remainder[pos + 1]) {
			pos += 2;
			break;
		}
		const sc = remainder.charCodeAt(pos);
		if (
			pos === wsStart ||
			pos >= length ||
			(!isAsciiLetter(sc) && 0x5f !== sc && 0x3a !== sc)
		) {
			return false;
		}
		while (++pos < length) {
			const c = remainder.charCodeAt(pos);
			if (
				!isAsciiLetter(c) &&
				(c < 0x30 || c > 0x39) &&
				0x5f !== c &&
				0x3a !== c &&
				0x2e !== c &&
				0x2d !== c
			) {
				break;
			}
		}
		let eqPos = pos;
		while (eqPos < length && isHorizontalHtmlWhitespace(remainder[eqPos])) {
			eqPos += 1;
		}
		if ("=" !== remainder[eqPos]) continue;
		pos = eqPos + 1;
		while (pos < length && isHorizontalHtmlWhitespace(remainder[pos])) pos += 1;
		if (pos >= length) return false;
		const valStart = remainder[pos];
		if ('"' === valStart || "'" === valStart) {
			const closeIdx = remainder.indexOf(valStart, pos + 1);
			if (closeIdx < 0) return false;
			pos = closeIdx + 1;
		} else {
			const start = pos;
			while (
				pos < length &&
				remainder.charCodeAt(pos) > 0x20 &&
				!"\"'=<>`".includes(remainder[pos] ?? "")
			) {
				pos += 1;
			}
			if (pos === start) return false;
		}
	}
	if (">" !== remainder[pos - 1]) return false;
	while (pos < length && isHorizontalHtmlWhitespace(remainder[pos])) pos += 1;
	return pos === length;
}

export function matchHtmlBlockOpen(
	remainder: string,
	allowType7: boolean,
): 1 | 2 | 3 | 4 | 5 | 6 | 7 | null {
	if ("<" !== remainder[0]) return null;
	const lowered = asciiLowerCase(remainder);
	for (const [htmlType, pattern] of HTML_OPEN_RE) {
		if (pattern.test(lowered)) return htmlType;
	}
	return allowType7 && isHtmlBlockType7(remainder) ? 7 : null;
}

export function htmlBlockLineCloses(
	htmlType: 1 | 2 | 3 | 4 | 5,
	text: string,
): boolean {
	return HTML_CLOSE_RE[htmlType].test(
		1 === htmlType ? asciiLowerCase(text) : text,
	);
}

export type TableRowCellRange = Readonly<{
	end: number;
	start: number;
}>;

/**
 * Exact cell-count port of PHP `League\CommonMark`'s `TableParser::split()`.
 */
export function countTableRowCells(line: string): number {
	let start = 0;
	let end = line.length;
	while (start < end && isPhpTrimChar(line[start])) start += 1;
	while (end > start && isPhpTrimChar(line[end - 1])) end -= 1;
	const trimmed = line.slice(start, end);
	let cells = 0;
	let hasContent = false;
	for (
		let pos = trimmed.startsWith("|") ? 1 : 0;
		pos < trimmed.length;
		pos += 1
	) {
		if ("\\" === trimmed[pos] && "|" === trimmed[pos + 1]) {
			hasContent = true;
			pos += 1;
		} else if ("|" === trimmed[pos]) {
			cells += 1;
			hasContent = false;
		} else {
			hasContent = true;
		}
	}
	return hasContent ? cells + 1 : cells;
}

/**
 * Locates the GFM table cell `[start, end)` containing `offset` within one
 * container-stripped table row `[contentOffset, lineEnd)`, matching PHP
 * `League\CommonMark\Extension\Table\TableParser::split()` (trims PHP trim
 * whitespace, drops optional single leading/trailing unescaped `|`, and treats
 * `\|` as an escaped literal pipe inside the cell rather than a delimiter).
 */
export function findTableRowCellAt(
	source: string,
	contentOffset: number,
	lineEnd: number,
	offset: number,
): TableRowCellRange | null {
	let trimStart = contentOffset;
	let trimEnd = lineEnd;
	while (trimStart < trimEnd && isPhpTrimChar(source[trimStart])) {
		trimStart += 1;
	}
	while (trimEnd > trimStart && isPhpTrimChar(source[trimEnd - 1])) {
		trimEnd -= 1;
	}
	if (trimStart >= trimEnd) return null;
	let cellStart = "|" === source[trimStart] ? trimStart + 1 : trimStart;
	if (offset < cellStart || offset >= trimEnd) return null;

	let pos = cellStart;
	while (pos < trimEnd) {
		if ("\\" === source[pos] && pos + 1 < trimEnd && "|" === source[pos + 1]) {
			pos += 2;
			continue;
		}
		if ("|" === source[pos]) {
			if (offset <= pos) {
				return offset < pos ? { end: pos, start: cellStart } : null;
			}
			cellStart = pos + 1;
			pos += 1;
			continue;
		}
		pos += 1;
	}
	return cellStart < trimEnd && offset >= cellStart && offset < trimEnd
		? { end: trimEnd, start: cellStart }
		: null;
}

/**
 * Exact column-count port of PHP `League\CommonMark`'s
 * `TableStartParser::parseSeparator()`.
 */
export function parseGfmTableSeparatorColumns(remainder: string): number {
	let pos = 0;
	let columns = 0;
	let pipes = 0;
	let valid = false;
	while (pos < remainder.length) {
		const ch = remainder[pos];
		if ("|" === ch) {
			pos += 1;
			pipes += 1;
			if (pipes > 1) return 0;
			valid = true;
		} else if ("-" === ch || ":" === ch) {
			if (0 === pipes && columns > 0) return 0;
			if (":" === ch) pos += 1;
			const dashStart = pos;
			while ("-" === remainder[pos]) pos += 1;
			if (pos === dashStart) return 0;
			if (":" === remainder[pos]) pos += 1;
			columns += 1;
			pipes = 0;
		} else if (isSpaceOrTab(ch)) {
			pos += 1;
		} else {
			return 0;
		}
	}
	return valid ? columns : 0;
}

export function matchListMarkerLength(
	nonSpaceRest: string,
	inParagraph: boolean,
): number {
	const firstChar = nonSpaceRest[0];
	let markerLength = 0;
	if ("-" === firstChar || "+" === firstChar || "*" === firstChar) {
		markerLength = 1;
	} else {
		const ordMatch = ORDERED_LIST_MARKER.exec(nonSpaceRest);
		if (ordMatch?.[1] && ordMatch[2] && (!inParagraph || "1" === ordMatch[1])) {
			markerLength = ordMatch[0].length;
		}
	}
	if (0 === markerLength) return 0;
	const afterChar = nonSpaceRest[markerLength];
	if (undefined !== afterChar && !isSpaceOrTab(afterChar)) return 0;
	let rest = markerLength;
	while (rest < nonSpaceRest.length && isSpaceOrTab(nonSpaceRest[rest])) {
		rest += 1;
	}
	return inParagraph && rest >= nonSpaceRest.length ? 0 : markerLength;
}
