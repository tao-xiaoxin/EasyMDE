export const COMMONMARK_ATX_HEADING_OPEN = /^#{1,6}(?:[ \t]+|$)/u;
const COMMONMARK_SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/u;
export const COMMONMARK_FENCED_CODE_OPEN = /^(?:`{3,}[^`]*$|~{3,})/u;
const COMMONMARK_FENCED_CODE_CLOSE = /^(?:`{3,}|~{3,})[ \t]*$/u;
export const COMMONMARK_THEMATIC_BREAK_LINE =
	/^(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/u;
export const COMMONMARK_HTML_BLOCK_TYPE_1_OPEN =
	/^<(?:script|pre|textarea|style)(?:[ \t\v\f]|>|$)/u;
const COMMONMARK_HTML_BLOCK_TYPE_1_CLOSE =
	/<\/(?:script|pre|textarea|style)>/iu;
// Exact Type 6 block tag list from installed `league/commonmark`
// `RegexHelper::getHtmlBlockOpenRegex(HtmlBlock::TYPE_6_BLOCK_ELEMENT)`.
export const COMMONMARK_HTML_BLOCK_TYPE_6_OPEN =
	/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t\v\f]|\/?>|$)/u;
const COMMONMARK_HTML_BLOCK_TYPE_7_CLOSE_TAG =
	/^<\/[A-Za-z][A-Za-z0-9-]*[ \t\v\f]*>[ \t\v\f]*$/u;

type LineCursor = {
	column: number;
	line: string;
	partiallyConsumedTab: boolean;
	position: number;
};

export type PhpOpenBlock =
	| { kind: "document" }
	| { kind: "quote" }
	| {
			bulletChar: string | null;
			delimiter: "." | ")" | null;
			kind: "list";
			listType: "bullet" | "ordered";
	  }
	| {
			contentIndent: number;
			hasChild: boolean;
			kind: "list-item";
	  }
	| {
			hasNonRefContent: boolean;
			hasPipe: boolean;
			kind: "paragraph";
			lastLine: string;
	  }
	| { kind: "table" }
	| { kind: "heading" }
	| { kind: "thematic-break" }
	| {
			fenceChar: "`" | "~";
			fenceLength: number;
			kind: "fenced-code";
	  }
	| { kind: "indented-code" }
	| {
			finished: boolean;
			htmlType: 1 | 2 | 3 | 4 | 5 | 6 | 7;
			kind: "html-block";
	  };

type PhpBlockStart = Readonly<{
	blocks: ReadonlyArray<PhpOpenBlock>;
	cursor: LineCursor;
	replaceActive: boolean;
}>;

export function asciiLowerCase(value: string): string {
	return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

function createLineCursor(line: string): LineCursor {
	return { column: 0, line, partiallyConsumedTab: false, position: 0 };
}

function cloneLineCursor(cursor: LineCursor): LineCursor {
	return {
		column: cursor.column,
		line: cursor.line,
		partiallyConsumedTab: cursor.partiallyConsumedTab,
		position: cursor.position,
	};
}

function cursorNextNonSpace(
	cursor: LineCursor,
): Readonly<{ indent: number; position: number }> {
	let cols = cursor.column;
	let index = cursor.position;
	while (index < cursor.line.length) {
		const ch = cursor.line[index];
		if (" " === ch) cols += 1;
		else if ("\t" === ch) cols += 4 - (cols % 4);
		else break;
		index += 1;
	}
	return { indent: cols - cursor.column, position: index };
}

function cursorIsIndented(cursor: LineCursor): boolean {
	return cursorNextNonSpace(cursor).indent >= 4;
}

function cursorIsBlank(cursor: LineCursor): boolean {
	return cursorNextNonSpace(cursor).position >= cursor.line.length;
}

function cursorAdvanceBy(
	cursor: LineCursor,
	count: number,
	advanceByColumns: boolean,
): void {
	let remaining = count;
	while (remaining > 0 && cursor.position < cursor.line.length) {
		const ch = cursor.line[cursor.position];
		if ("\t" === ch) {
			const charsToTab = 4 - (cursor.column % 4);
			if (advanceByColumns) {
				cursor.partiallyConsumedTab = charsToTab > remaining;
				const advance = cursor.partiallyConsumedTab ? remaining : charsToTab;
				cursor.column += advance;
				if (!cursor.partiallyConsumedTab) cursor.position += 1;
				remaining -= advance;
			} else {
				cursor.partiallyConsumedTab = false;
				cursor.column += charsToTab;
				cursor.position += 1;
				remaining -= 1;
			}
		} else {
			cursor.partiallyConsumedTab = false;
			cursor.position += 1;
			cursor.column += 1;
			remaining -= 1;
		}
	}
}

function cursorAdvanceBySpaceOrTab(cursor: LineCursor): boolean {
	const ch = cursor.line[cursor.position];
	if (" " !== ch && "\t" !== ch) return false;
	cursorAdvanceBy(cursor, 1, true);
	return true;
}

function cursorAdvanceToNextNonSpace(cursor: LineCursor): void {
	const nextPos = cursorNextNonSpace(cursor).position;
	if (nextPos > cursor.position) {
		cursorAdvanceBy(cursor, nextPos - cursor.position, false);
		cursor.partiallyConsumedTab = false;
	}
}

function cursorAdvanceToEnd(cursor: LineCursor): void {
	cursor.position = cursor.line.length;
	cursor.partiallyConsumedTab = false;
}

function cursorRemainder(cursor: LineCursor): string {
	if (cursor.position >= cursor.line.length) return "";
	if (cursor.partiallyConsumedTab) {
		return (
			" ".repeat(4 - (cursor.column % 4)) +
			cursor.line.slice(cursor.position + 1)
		);
	}
	return cursor.line.slice(cursor.position);
}

function isHorizontalHtmlWhitespace(ch: string | undefined): boolean {
	return " " === ch || "\t" === ch || "\v" === ch || "\f" === ch;
}

function isAsciiLetter(ch: string | undefined): boolean {
	if (!ch) return false;
	const code = ch.charCodeAt(0);
	return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiDigit(ch: string | undefined): boolean {
	if (!ch) return false;
	const code = ch.charCodeAt(0);
	return code >= 48 && code <= 57;
}

/**
 * Linear-time matcher for CommonMark HTML block Type 7 (a single complete
 * opening or closing HTML tag on a line with optional trailing whitespace).
 */
function matchesHtmlBlockType7(rest: string): boolean {
	if (!rest.startsWith("<")) return false;
	if ("/" === rest[1]) {
		return COMMONMARK_HTML_BLOCK_TYPE_7_CLOSE_TAG.test(rest);
	}
	let index = 1;
	if (!isAsciiLetter(rest[index])) return false;
	index += 1;
	while (
		index < rest.length &&
		(isAsciiLetter(rest[index]) ||
			isAsciiDigit(rest[index]) ||
			"-" === rest[index])
	) {
		index += 1;
	}
	while (index < rest.length) {
		const spaceStart = index;
		while (index < rest.length && isHorizontalHtmlWhitespace(rest[index])) {
			index += 1;
		}
		if (index >= rest.length) return false;
		if (
			">" === rest[index] ||
			("/" === rest[index] && ">" === rest[index + 1])
		) {
			index += "/" === rest[index] ? 2 : 1;
			while (index < rest.length && isHorizontalHtmlWhitespace(rest[index])) {
				index += 1;
			}
			return index >= rest.length;
		}
		if (index === spaceStart) return false;
		const nameStart = rest[index];
		if (!isAsciiLetter(nameStart) && "_" !== nameStart && ":" !== nameStart) {
			return false;
		}
		index += 1;
		while (index < rest.length) {
			const ch = rest[index];
			if (
				isAsciiLetter(ch) ||
				isAsciiDigit(ch) ||
				":" === ch ||
				"." === ch ||
				"_" === ch ||
				"-" === ch
			) {
				index += 1;
				continue;
			}
			break;
		}
		const afterName = index;
		while (index < rest.length && isHorizontalHtmlWhitespace(rest[index])) {
			index += 1;
		}
		if ("=" !== rest[index]) {
			index = afterName;
			continue;
		}
		index += 1;
		while (index < rest.length && isHorizontalHtmlWhitespace(rest[index])) {
			index += 1;
		}
		const quote = rest[index];
		if ("'" === quote || '"' === quote) {
			index += 1;
			while (index < rest.length && quote !== rest[index]) index += 1;
			if (quote !== rest[index]) return false;
			index += 1;
			continue;
		}
		const valueStart = index;
		while (index < rest.length) {
			const ch = rest[index];
			if (
				!ch ||
				ch.charCodeAt(0) <= 32 ||
				'"' === ch ||
				"'" === ch ||
				"=" === ch ||
				"<" === ch ||
				">" === ch ||
				"`" === ch
			) {
				break;
			}
			index += 1;
		}
		if (index === valueStart) return false;
	}
	return false;
}

function htmlBlockTypeForLine(
	rest: string,
	allowType7: boolean,
): 1 | 2 | 3 | 4 | 5 | 6 | 7 | null {
	if (!rest.startsWith("<")) return null;
	const lowered = asciiLowerCase(rest);
	if (COMMONMARK_HTML_BLOCK_TYPE_1_OPEN.test(lowered)) return 1;
	if (rest.startsWith("<!--")) return 2;
	if (rest.startsWith("<?")) return 3;
	if (/^<![a-z]/u.test(lowered)) return 4;
	if (lowered.startsWith("<![cdata[")) return 5;
	if (COMMONMARK_HTML_BLOCK_TYPE_6_OPEN.test(lowered)) return 6;
	if (allowType7 && matchesHtmlBlockType7(rest)) return 7;
	return null;
}

function htmlBlockLineCloses(
	htmlType: 1 | 2 | 3 | 4 | 5 | 6 | 7,
	line: string,
): boolean {
	if (1 === htmlType) return COMMONMARK_HTML_BLOCK_TYPE_1_CLOSE.test(line);
	if (2 === htmlType) return line.includes("-->");
	if (3 === htmlType) return line.includes("?>");
	if (4 === htmlType) return line.includes(">");
	if (5 === htmlType) return line.includes("]]>");
	return false;
}

function skipSpacesAndTabs(text: string, start: number): number {
	let index = start;
	while (
		index < text.length &&
		(" " === text[index] || "\t" === text[index])
	) {
		index += 1;
	}
	return index;
}

function isSingleLineLinkRefDef(text: string): boolean {
	const trimmed = text.replace(/^ {0,3}/u, "");
	if (!trimmed.startsWith("[")) return false;
	let index = 1;
	let hasNonSpace = false;
	while (index < trimmed.length && index <= 1000) {
		const ch = trimmed[index];
		if ("\\" === ch) {
			if (index + 1 < trimmed.length) hasNonSpace = true;
			index += 2;
			continue;
		}
		if ("[" === ch) return false;
		if ("]" === ch) break;
		if (" " !== ch && "\t" !== ch) hasNonSpace = true;
		index += 1;
	}
	if (!hasNonSpace || "]" !== trimmed[index] || ":" !== trimmed[index + 1]) {
		return false;
	}
	index = skipSpacesAndTabs(trimmed, index + 2);
	if (index >= trimmed.length) return false;
	if ("<" === trimmed[index]) {
		index += 1;
		while (index < trimmed.length && ">" !== trimmed[index]) {
			if ("\\" === trimmed[index]) {
				index += 2;
				continue;
			}
			if ("<" === trimmed[index]) return false;
			index += 1;
		}
		if (">" !== trimmed[index]) return false;
		index += 1;
	} else {
		let depth = 0;
		const destStart = index;
		while (index < trimmed.length) {
			const ch = trimmed[index];
			if (!ch || ch <= " " || "\x7f" === ch) break;
			if ("\\" === ch) {
				index += 2;
				continue;
			}
			if ("(" === ch) depth += 1;
			else if (")" === ch) {
				depth -= 1;
				if (depth < 0) return false;
			}
			index += 1;
		}
		if (index === destStart || 0 !== depth) return false;
	}
	const afterDest = skipSpacesAndTabs(trimmed, index);
	if (afterDest >= trimmed.length) return true;
	if (afterDest === index) return false;
	const opener = trimmed[afterDest];
	const closer =
		'"' === opener
			? '"'
			: "'" === opener
				? "'"
				: "(" === opener
					? ")"
					: null;
	if (!closer) return false;
	index = afterDest + 1;
	while (index < trimmed.length && closer !== trimmed[index]) {
		if ("\\" === trimmed[index]) {
			index += 2;
			continue;
		}
		if ("(" === opener && "(" === trimmed[index]) return false;
		index += 1;
	}
	if (closer !== trimmed[index]) return false;
	return skipSpacesAndTabs(trimmed, index + 1) >= trimmed.length;
}

/**
 * Exact column-count port of PHP `League\CommonMark`'s
 * `TableStartParser::parseSeparator()`.
 */
function phpTableSeparatorColumnCount(text: string): number {
	let columns = 0;
	let pipes = 0;
	let valid = false;
	let index = 0;
	while (index < text.length) {
		const ch = text[index];
		if ("|" === ch) {
			index += 1;
			pipes += 1;
			if (pipes > 1) return 0;
			valid = true;
			continue;
		}
		if ("-" === ch || ":" === ch) {
			if (0 === pipes && columns > 0) return 0;
			if (":" === ch) index += 1;
			const dashStart = index;
			while (index < text.length && "-" === text[index]) index += 1;
			if (index === dashStart) return 0;
			if (":" === text[index]) index += 1;
			columns += 1;
			pipes = 0;
			continue;
		}
		if (" " === ch || "\t" === ch) {
			index += 1;
			continue;
		}
		return 0;
	}
	return valid ? columns : 0;
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

/**
 * Exact cell-count port of PHP `League\CommonMark`'s `TableParser::split()`.
 */
function phpSplitTableRowCellCount(line: string): number {
	let start = 0;
	let end = line.length;
	while (start < end && isPhpTrimChar(line[start])) start += 1;
	while (end > start && isPhpTrimChar(line[end - 1])) end -= 1;
	const trimmed = line.slice(start, end);
	let index = trimmed.startsWith("|") ? 1 : 0;
	let cells = 0;
	let hasCellContent = false;
	while (index < trimmed.length) {
		const ch = trimmed[index];
		if ("\\" === ch && "|" === trimmed[index + 1]) {
			hasCellContent = true;
			index += 2;
			continue;
		}
		if ("|" === ch) {
			cells += 1;
			hasCellContent = false;
			index += 1;
			continue;
		}
		hasCellContent = true;
		index += 1;
	}
	if (hasCellContent) cells += 1;
	return cells;
}

function blockIsContainer(block: PhpOpenBlock): boolean {
	return (
		"document" === block.kind ||
		"quote" === block.kind ||
		"list" === block.kind ||
		"list-item" === block.kind
	);
}

function blockCanContain(parent: PhpOpenBlock, child: PhpOpenBlock): boolean {
	if ("document" === parent.kind || "quote" === parent.kind) return true;
	if ("list" === parent.kind) return "list-item" === child.kind;
	if ("list-item" === parent.kind) return "list-item" !== child.kind;
	return false;
}

function blockCanHaveLazyContinuation(block: PhpOpenBlock): boolean {
	return "paragraph" === block.kind || "table" === block.kind;
}

function addLineToBlock(block: PhpOpenBlock, text: string): void {
	if ("paragraph" === block.kind) {
		if (!block.hasNonRefContent && isSingleLineLinkRefDef(text)) {
			block.lastLine = "";
			block.hasPipe = false;
			return;
		}
		block.hasNonRefContent = true;
		block.lastLine = text;
		if (text.includes("|")) block.hasPipe = true;
		return;
	}
	if (
		"html-block" === block.kind &&
		block.htmlType <= 5 &&
		htmlBlockLineCloses(block.htmlType, text)
	) {
		block.finished = true;
	}
}

function tryStartPhpList(
	cursor: LineCursor,
	lastMatched: PhpOpenBlock,
	paragraphContentAvailable: boolean,
): PhpBlockStart | null {
	if (cursorIsIndented(cursor)) return null;
	const next = cursorNextNonSpace(cursor);
	const rest = cursor.line.slice(next.position);
	let listType: "bullet" | "ordered";
	let bulletChar: string | null = null;
	let delimiter: "." | ")" | null = null;
	let markerLength = 0;

	const firstChar = rest[0];
	if ("*" === firstChar || "+" === firstChar || "-" === firstChar) {
		listType = "bullet";
		bulletChar = firstChar;
		markerLength = 1;
	} else {
		const orderedMatch = rest.match(/^(\d{1,9})([.)])/u);
		if (
			!orderedMatch ||
			(paragraphContentAvailable && "1" !== orderedMatch[1])
		) {
			return null;
		}
		listType = "ordered";
		delimiter = "." === orderedMatch[2] ? "." : ")";
		markerLength = orderedMatch[0].length;
	}

	const afterMarker = rest[markerLength];
	if (
		undefined !== afterMarker &&
		" " !== afterMarker &&
		"\t" !== afterMarker
	) {
		return null;
	}
	if (
		paragraphContentAvailable &&
		!/[^ \t\f\v\r\n]/u.test(rest.slice(markerLength))
	) {
		return null;
	}

	const nextCursor = cloneLineCursor(cursor);
	const markerOffset = next.indent;
	cursorAdvanceToNextNonSpace(nextCursor);
	cursorAdvanceBy(nextCursor, markerLength, true);

	const saved = cloneLineCursor(nextCursor);
	const spacesStartCol = nextCursor.column;
	while (nextCursor.column - spacesStartCol < 5) {
		if (!cursorAdvanceBySpaceOrTab(nextCursor)) break;
	}
	const blankItem = nextCursor.position >= nextCursor.line.length;
	const spacesAfterMarker = nextCursor.column - spacesStartCol;
	let padding: number;
	if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || blankItem) {
		nextCursor.column = saved.column;
		nextCursor.partiallyConsumedTab = saved.partiallyConsumedTab;
		nextCursor.position = saved.position;
		cursorAdvanceBySpaceOrTab(nextCursor);
		padding = markerLength + 1;
	} else {
		padding = markerLength + spacesAfterMarker;
	}

	const item: PhpOpenBlock = {
		contentIndent: markerOffset + padding,
		hasChild: false,
		kind: "list-item",
	};
	if (
		"list" === lastMatched.kind &&
		lastMatched.listType === listType &&
		lastMatched.bulletChar === bulletChar &&
		lastMatched.delimiter === delimiter
	) {
		return { blocks: [item], cursor: nextCursor, replaceActive: false };
	}
	return {
		blocks: [{ bulletChar, delimiter, kind: "list", listType }, item],
		cursor: nextCursor,
		replaceActive: false,
	};
}

function findPhpBlockStart(
	cursor: LineCursor,
	activeBlock: PhpOpenBlock,
	lastMatched: PhpOpenBlock,
): PhpBlockStart | null {
	const next = cursorNextNonSpace(cursor);
	const indented = next.indent >= 4;
	const firstChar = cursor.line[next.position];
	const rest = cursor.line.slice(next.position);
	const paragraphContentAvailable =
		"paragraph" === lastMatched.kind && lastMatched.hasNonRefContent;

	// 1. BlockQuoteStartParser (priority 70)
	if (!indented && ">" === firstChar) {
		const nextCursor = cloneLineCursor(cursor);
		cursorAdvanceToNextNonSpace(nextCursor);
		cursorAdvanceBy(nextCursor, 1, false);
		cursorAdvanceBySpaceOrTab(nextCursor);
		return {
			blocks: [{ kind: "quote" }],
			cursor: nextCursor,
			replaceActive: false,
		};
	}

	// 2. HeadingStartParser (priority 60: ATX then Setext)
	if (
		!indented &&
		("#" === firstChar || "-" === firstChar || "=" === firstChar)
	) {
		if ("#" === firstChar && COMMONMARK_ATX_HEADING_OPEN.test(rest)) {
			const nextCursor = cloneLineCursor(cursor);
			cursorAdvanceToEnd(nextCursor);
			return {
				blocks: [{ kind: "heading" }],
				cursor: nextCursor,
				replaceActive: false,
			};
		}
		if (paragraphContentAvailable && COMMONMARK_SETEXT_UNDERLINE.test(rest)) {
			const nextCursor = cloneLineCursor(cursor);
			cursorAdvanceToEnd(nextCursor);
			return {
				blocks: [{ kind: "heading" }],
				cursor: nextCursor,
				replaceActive: true,
			};
		}
	}

	// 3. FencedCodeStartParser (priority 50)
	if (!indented && ("`" === firstChar || "~" === firstChar)) {
		const fenceMatch = rest.match(/^(`{3,})(?!.*`)|^(~{3,})/u);
		if (fenceMatch) {
			const marker = fenceMatch[1] ?? fenceMatch[2] ?? "";
			const nextCursor = cloneLineCursor(cursor);
			cursorAdvanceToEnd(nextCursor);
			return {
				blocks: [
					{
						fenceChar: "`" === marker[0] ? "`" : "~",
						fenceLength: marker.length,
						kind: "fenced-code",
					},
				],
				cursor: nextCursor,
				replaceActive: false,
			};
		}
	}

	// 4. HtmlBlockStartParser (priority 40)
	if (!indented && "<" === firstChar) {
		const allowType7 =
			"paragraph" !== lastMatched.kind &&
			!blockCanHaveLazyContinuation(activeBlock);
		const htmlType = htmlBlockTypeForLine(rest, allowType7);
		if (null !== htmlType) {
			return {
				blocks: [{ finished: false, htmlType, kind: "html-block" }],
				cursor: cloneLineCursor(cursor),
				replaceActive: false,
			};
		}
	}

	// 5. ThematicBreakStartParser (priority 20)
	if (!indented && COMMONMARK_THEMATIC_BREAK_LINE.test(rest)) {
		const nextCursor = cloneLineCursor(cursor);
		cursorAdvanceToEnd(nextCursor);
		return {
			blocks: [{ kind: "thematic-break" }],
			cursor: nextCursor,
			replaceActive: false,
		};
	}

	// 6. ListBlockStartParser (priority 10)
	const listStart = tryStartPhpList(
		cursor,
		lastMatched,
		paragraphContentAvailable,
	);
	if (listStart) return listStart;

	// 7. TableStartParser (priority 0)
	if (
		"paragraph" === lastMatched.kind &&
		lastMatched.hasNonRefContent &&
		lastMatched.hasPipe
	) {
		const columns = phpTableSeparatorColumnCount(cursorRemainder(cursor));
		if (
			columns > 0 &&
			phpSplitTableRowCellCount(lastMatched.lastLine) <= columns
		) {
			const nextCursor = cloneLineCursor(cursor);
			cursorAdvanceToEnd(nextCursor);
			return {
				blocks: [{ kind: "table" }],
				cursor: nextCursor,
				replaceActive: true,
			};
		}
	}

	// 8. IndentedCodeStartParser (priority -100)
	if (indented && "paragraph" !== activeBlock.kind && !cursorIsBlank(cursor)) {
		const nextCursor = cloneLineCursor(cursor);
		cursorAdvanceBy(nextCursor, 4, true);
		return {
			blocks: [{ kind: "indented-code" }],
			cursor: nextCursor,
			replaceActive: false,
		};
	}

	return null;
}

function pushChildBlock(stack: PhpOpenBlock[], child: PhpOpenBlock): void {
	while (stack.length > 1) {
		const tip = stack[stack.length - 1];
		if (!tip || blockCanContain(tip, child)) break;
		stack.pop();
	}
	const parent = stack[stack.length - 1];
	if ("list-item" === parent?.kind) parent.hasChild = true;
	stack.push(child);
}

/**
 * Advances one line through PHP `League\CommonMark`'s GFM block-structure
 * state machine (`MarkdownParser::parseLine()`).
 */
export function advancePhpBlockStackLine(
	stack: PhpOpenBlock[],
	rawLine: string,
): void {
	const cursor = createLineCursor(rawLine);
	let matches = 1;
	for (let index = 1; index < stack.length; index += 1) {
		const block = stack[index];
		if (!block) break;
		if ("quote" === block.kind) {
			const next = cursorNextNonSpace(cursor);
			if (next.indent < 4 && ">" === cursor.line[next.position]) {
				cursorAdvanceToNextNonSpace(cursor);
				cursorAdvanceBy(cursor, 1, false);
				cursorAdvanceBySpaceOrTab(cursor);
				matches += 1;
				continue;
			}
			break;
		}
		if ("list" === block.kind) {
			matches += 1;
			continue;
		}
		if ("list-item" === block.kind) {
			if (cursorIsBlank(cursor)) {
				if (!block.hasChild) break;
				cursorAdvanceToNextNonSpace(cursor);
				matches += 1;
				continue;
			}
			if (cursorNextNonSpace(cursor).indent >= block.contentIndent) {
				cursorAdvanceBy(cursor, block.contentIndent, true);
				matches += 1;
				continue;
			}
			break;
		}
		if ("paragraph" === block.kind) {
			if (cursorIsBlank(cursor)) break;
			matches += 1;
			continue;
		}
		if ("table" === block.kind) {
			if (!cursor.line.includes("|")) break;
			matches += 1;
			continue;
		}
		if ("heading" === block.kind || "thematic-break" === block.kind) break;
		if ("fenced-code" === block.kind) {
			const next = cursorNextNonSpace(cursor);
			if (
				next.indent < 4 &&
				cursor.line[next.position] === block.fenceChar
			) {
				const closeRest = cursor.line.slice(next.position);
				if (COMMONMARK_FENCED_CODE_CLOSE.test(closeRest)) {
					let runLength = 0;
					while (closeRest[runLength] === block.fenceChar) runLength += 1;
					if (runLength >= block.fenceLength) {
						stack.length = index;
						return;
					}
				}
			}
			matches += 1;
			continue;
		}
		if ("indented-code" === block.kind) {
			if (cursorIsIndented(cursor)) {
				cursorAdvanceBy(cursor, 4, true);
				matches += 1;
				continue;
			}
			if (cursorIsBlank(cursor)) {
				cursorAdvanceToNextNonSpace(cursor);
				matches += 1;
				continue;
			}
			break;
		}
		if ("html-block" === block.kind) {
			if (block.finished) break;
			if (
				cursorIsBlank(cursor) &&
				(6 === block.htmlType || 7 === block.htmlType)
			) {
				break;
			}
			matches += 1;
		}
	}

	let unmatchedBlocks = stack.length - matches;
	let blockParser = stack[matches - 1] ?? stack[0];
	if (!blockParser) return;
	let startedNewBlock = false;
	let tryBlockStarts =
		"paragraph" === blockParser.kind || blockIsContainer(blockParser);

	while (tryBlockStarts) {
		if (cursorIsBlank(cursor)) {
			cursorAdvanceToEnd(cursor);
			break;
		}
		const activeBlock = stack[stack.length - 1] ?? blockParser;
		const blockStart = findPhpBlockStart(cursor, activeBlock, blockParser);
		if (!blockStart) {
			cursorAdvanceToNextNonSpace(cursor);
			break;
		}
		cursor.column = blockStart.cursor.column;
		cursor.partiallyConsumedTab = blockStart.cursor.partiallyConsumedTab;
		cursor.position = blockStart.cursor.position;
		startedNewBlock = true;
		if (unmatchedBlocks > 0) {
			stack.length -= unmatchedBlocks;
			unmatchedBlocks = 0;
		}
		if (blockStart.replaceActive && stack.length > 1) stack.pop();
		for (const nextBlock of blockStart.blocks) {
			pushChildBlock(stack, nextBlock);
			blockParser = nextBlock;
			tryBlockStarts = blockIsContainer(nextBlock);
		}
	}

	const active = stack[stack.length - 1];
	if (
		!startedNewBlock &&
		!cursorIsBlank(cursor) &&
		active &&
		blockCanHaveLazyContinuation(active)
	) {
		addLineToBlock(active, cursorRemainder(cursor));
		return;
	}
	if (unmatchedBlocks > 0) stack.length -= unmatchedBlocks;
	const tip = stack[stack.length - 1];
	if (!tip) return;
	if (!blockIsContainer(tip)) {
		addLineToBlock(tip, cursorRemainder(cursor));
		return;
	}
	if (!cursorIsBlank(cursor)) {
		const paragraph: PhpOpenBlock = {
			hasNonRefContent: false,
			hasPipe: false,
			kind: "paragraph",
			lastLine: "",
		};
		pushChildBlock(stack, paragraph);
		addLineToBlock(paragraph, cursorRemainder(cursor));
	}
}
