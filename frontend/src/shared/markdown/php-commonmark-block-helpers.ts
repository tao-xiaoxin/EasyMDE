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

export function isPhpTrimChar(ch: string | undefined): boolean {
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
	cellIndex: number;
	end: number;
	start: number;
}>;

/**
 * Mirrors PHP `League\CommonMark\Extension\Table\TableParser::split()`'s
 * pre-inline `\|` -> `|` unescaping on a table cell string.
 */
export function unescapeTableCellPipes(value: string): string {
	return value.includes("\\|") ? value.replace(/\\\|/gu, "|") : value;
}

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
 * Splits one container-stripped GFM table row `[contentOffset, lineEnd)` into
 * all valid cell ranges `[start, end)` (up to `maxColumns` when set), matching
 * PHP `League\CommonMark\Extension\Table\TableParser::split()` so callers can
 * binary-search many offsets in the same row in O(log C) time.
 */
export function collectTableRowCells(
	source: string,
	contentOffset: number,
	lineEnd: number,
	maxColumns?: number | null,
): TableRowCellRange[] {
	const hasColumnLimit = null !== maxColumns && undefined !== maxColumns;
	if (hasColumnLimit && maxColumns <= 0) return [];
	let trimStart = contentOffset;
	let trimEnd = lineEnd;
	while (trimStart < trimEnd && isPhpTrimChar(source[trimStart])) {
		trimStart += 1;
	}
	while (trimEnd > trimStart && isPhpTrimChar(source[trimEnd - 1])) {
		trimEnd -= 1;
	}
	if (trimStart >= trimEnd) return [];
	let cellStart = "|" === source[trimStart] ? trimStart + 1 : trimStart;
	if (cellStart >= trimEnd) return [];

	const cells: TableRowCellRange[] = [];
	let cellIndex = 0;
	let pos = cellStart;
	while (pos < trimEnd) {
		if ("\\" === source[pos] && pos + 1 < trimEnd && "|" === source[pos + 1]) {
			pos += 2;
			continue;
		}
		if ("|" === source[pos]) {
			cells.push({ cellIndex, end: pos, start: cellStart });
			cellIndex += 1;
			if (hasColumnLimit && cellIndex >= maxColumns) return cells;
			cellStart = pos + 1;
			pos += 1;
			continue;
		}
		pos += 1;
	}
	if (cellStart < trimEnd && (!hasColumnLimit || cellIndex < maxColumns)) {
		cells.push({ cellIndex, end: trimEnd, start: cellStart });
	}
	return cells;
}

export type GfmTableColumnAlignment = "left" | "center" | "right" | null;

/**
 * Exact port of PHP `League\CommonMark`'s `TableStartParser::parseSeparator()`
 * and `getAlignment()`: one alignment per column, or `null` when the line is
 * not a valid GFM delimiter row (PHP's empty-array rejection).
 */
export function parseGfmTableSeparatorAlignments(
	line: string,
): GfmTableColumnAlignment[] | null {
	let pos = 0;
	let pipes = 0;
	let valid = false;
	const columns: GfmTableColumnAlignment[] = [];
	while (pos < line.length) {
		const ch = line[pos];
		if ("|" === ch) {
			pos += 1;
			pipes += 1;
			if (pipes > 1) return null;
			valid = true;
		} else if ("-" === ch || ":" === ch) {
			if (0 === pipes && columns.length > 0) return null;
			const left = ":" === ch;
			if (left) pos += 1;
			const dashStart = pos;
			while ("-" === line[pos]) pos += 1;
			if (pos === dashStart) return null;
			const right = ":" === line[pos];
			if (right) pos += 1;
			columns.push(left && right ? "center" : left ? "left" : right ? "right" : null);
			pipes = 0;
		} else if (isSpaceOrTab(ch)) {
			pos += 1;
		} else {
			return null;
		}
	}
	return valid ? columns : null;
}

/**
 * Exact column-count port of PHP `League\CommonMark`'s
 * `TableStartParser::parseSeparator()` (`0` when the row is invalid).
 */
export function parseGfmTableSeparatorColumns(remainder: string): number {
	return parseGfmTableSeparatorAlignments(remainder)?.length ?? 0;
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

/**
 * Single canonical CommonMark §5.2 list-marker padding consumer mirroring
 * pinned PHP `league/commonmark@2.8.2`
 * (`ListBlockStartParser::calculateListMarkerPadding()`): after advancing past
 * `leadCols` and `markerLength`, peeks the spacing columns and trailing
 * remainder without moving `cursor`. When the item is blank, has fewer than 1
 * or at least 5 spacing columns, or leaves only a single Unicode code point
 * (`$cursor->peek() === null` in League 2.8.2), consumes only 1 column (leaving
 * remaining spaces for nested blocks such as `-    -`) and returns
 * `leadCols + markerLength + 1`; otherwise consumes `spacingCols` and returns
 * `leadCols + markerLength + spacingCols`.
 */
export function consumePhpListMarkerPadding(
	cursor: LineColumnCursor,
	leadCols: number,
	markerLength: number,
): number {
	const spacingCols = measureLeadingColumns(cursor);
	const nonSpaceIdx = nextNonSpaceIndex(cursor);
	const remainingUnits = cursor.line.length - nonSpaceIdx;
	const isBlankOrSingleCodePoint =
		remainingUnits === 0 ||
		remainingUnits === 1 ||
		(remainingUnits === 2 &&
			(cursor.line.codePointAt(nonSpaceIdx) ?? 0) > 0xffff);
	const padding =
		isBlankOrSingleCodePoint || spacingCols < 1 || spacingCols >= 5
			? 1
			: spacingCols;
	consumeWhitespaceColumns(cursor, Math.min(padding, spacingCols));
	return leadCols + markerLength + padding;
}

const PHP_ESCAPABLE_RE = /^[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]$/;

/** A position `p` inside inline-block segment `s`. */
type PhpInlinePos = Readonly<{ p: number; s: number }>;

type PhpInlineSegment = Readonly<{ contentOffset: number; lineEnd: number }>;


/**
 * Character stream over one PHP inline block whose segment ends read as the
 * `\n` joining League's paragraph lines (container prefixes stripped).
 */
export function createPhpInlineStream(text: string, lines: ReadonlyArray<PhpInlineSegment>, groupEnd: number) {
	const lineEnd = (pos: PhpInlinePos): number => lines[pos.s]?.lineEnd ?? pos.p;
	const charAt = (pos: PhpInlinePos): string =>
		pos.p < lineEnd(pos) ? (text[pos.p] ?? "") : pos.s < groupEnd ? "\n" : "";
	const advance = (pos: PhpInlinePos): PhpInlinePos =>
		pos.p < lineEnd(pos)
			? { p: pos.p + 1, s: pos.s }
			: { p: lines[pos.s + 1]?.contentOffset ?? pos.p, s: pos.s + 1 };
	// League `Cursor::advanceToNextNonSpaceOrNewline()` (`/^(?: *(?:\n *)?)/`)
	// combined with `MarkdownParser::parseLine()` stripping leading spaces and
	// tabs (`advanceToNextNonSpaceOrTab()`) from every paragraph continuation line.
	const skipSpaces = (start: PhpInlinePos): PhpInlinePos => {
		let pos = start;
		while (" " === charAt(pos)) pos = advance(pos);
		if ("\n" !== charAt(pos)) return pos;
		pos = advance(pos);
		while (" " === charAt(pos) || "\t" === charAt(pos)) pos = advance(pos);
		return pos;
	};
	const isEscape = (pos: PhpInlinePos): boolean =>
		"\\" === charAt(pos) && pos.p + 1 < lineEnd(pos) && PHP_ESCAPABLE_RE.test(text[pos.p + 1] ?? "");
	return { advance, charAt, isEscape, lineEnd, skipSpaces };
}

type PhpInlineStream = ReturnType<typeof createPhpInlineStream>;

/** League `LinkParserHelper::parseLinkDestination()`; returns the end position. */
function parsePhpLinkDestination(text: string, stream: PhpInlineStream, start: PhpInlinePos): PhpInlinePos | null {
	const end = stream.lineEnd(start);
	if ("<" === stream.charAt(start)) {
		for (let p = start.p + 1; p < end; p += 1) {
			const ch = text[p];
			if (">" === ch) return { p: p + 1, s: start.s };
			if ("<" === ch || "\0" === ch) return null;
			if ("\\" === ch) {
				if (p + 1 >= end) return null;
				p += 1;
			}
		}
		return null;
	}
	let depth = 0;
	let p = start.p;
	for (; p < end; p += 1) {
		const ch = text[p] ?? "";
		if (stream.isEscape({ p, s: start.s })) p += 1;
		else if ("(" === ch) {
			depth += 1;
			if (depth > 32) return null;
		} else if (")" === ch) {
			if (depth < 1) break;
			depth -= 1;
		} else if (" \t\n\v\f\r".includes(ch)) break;
	}
	if (0 !== depth) return null;
	if (p === start.p && ")" !== stream.charAt({ p, s: start.s })) return null;
	return { p, s: start.s };
}

/** League `LinkParserHelper::parseLinkTitle()` (possessive, may span lines). */
function parsePhpLinkTitle(stream: PhpInlineStream, start: PhpInlinePos): PhpInlinePos | null {
	const open = stream.charAt(start);
	if ('"' !== open && "'" !== open && "(" !== open) return null;
	const close = "(" === open ? ")" : open;
	let pos = stream.advance(start);
	for (;;) {
		const ch = stream.charAt(pos);
		if ("" === ch || "\0" === ch || ("(" === open && "(" === ch)) return null;
		if (stream.isEscape(pos)) pos = stream.advance(stream.advance(pos));
		else if (close === ch) return stream.advance(pos);
		else pos = stream.advance(pos);
	}
}

/** League `CloseBracketParser::tryParseInlineLinkAndTitle()` after `]`. */
export function parsePhpInlineLinkTail(text: string, stream: PhpInlineStream, start: PhpInlinePos): PhpInlinePos | null {
	if (start.p >= stream.lineEnd(start) || "(" !== text[start.p]) return null;
	const afterDest = parsePhpLinkDestination(text, stream, stream.skipSpaces(stream.advance(start)));
	if (!afterDest) return null;
	let pos = stream.skipSpaces(afterDest);
	if (pos.s !== afterDest.s || pos.p !== afterDest.p) pos = parsePhpLinkTitle(stream, pos) ?? pos;
	pos = stream.skipSpaces(pos);
	return ")" === stream.charAt(pos) ? stream.advance(pos) : null;
}

/** League `LinkParserHelper::parseLinkLabel()`; returns the end after `]`. */
export function parsePhpLinkLabel(stream: PhpInlineStream, start: PhpInlinePos): Readonly<{ end: PhpInlinePos; length: number }> | null {
	if ("[" !== stream.charAt(start)) return null;
	let pos = stream.advance(start);
	for (let length = 2; length <= 1001; length += 1) {
		const ch = stream.charAt(pos);
		if ("]" === ch) return { end: stream.advance(pos), length };
		if ("" === ch || "[" === ch) return null;
		if ("\\" === ch) {
			if (pos.p + 1 >= stream.lineEnd(pos)) return null;
			length += 1;
			pos = { p: pos.p + 1, s: pos.s };
		}
		pos = stream.advance(pos);
	}
	return null;
}
