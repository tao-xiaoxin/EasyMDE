import type { ProtectedInlineKind } from "./visual-schema";

export type ProtectedInlineEntry = Readonly<{
	kind: ProtectedInlineKind;
	rawMarkdown: string;
}>;

const PAIRED_INLINE_HTML_TAGS: ReadonlySet<string> = new Set([
	"abbr",
	"b",
	"cite",
	"code",
	"del",
	"em",
	"font",
	"i",
	"ins",
	"kbd",
	"mark",
	"q",
	"s",
	"small",
	"span",
	"strong",
	"sub",
	"sup",
	"u",
]);

const INLINE_HTML_OPEN_TAG_STICKY =
	/<([a-zA-Z][a-zA-Z0-9-]*)(?:[ \t]+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^\s"'=<>`]+|'[^'\n]*'|"[^"\n]*"))?)*[ \t]*(\/?)>/y;
const INLINE_HTML_CLOSE_TAG_STICKY = /<\/([a-zA-Z][a-zA-Z0-9-]*)[ \t]*>/y;
const TABLE_BR_STICKY = /<br[ \t]*\/?>/iy;
const FOOTNOTE_REF_STICKY = /\[\^([^\s\]]+)\]/y;

export function execInlineHtmlOpenTag(
	line: string,
	index: number,
): RegExpExecArray | null {
	INLINE_HTML_OPEN_TAG_STICKY.lastIndex = index;
	return INLINE_HTML_OPEN_TAG_STICKY.exec(line);
}

export function execInlineHtmlCloseTag(
	line: string,
	index: number,
): RegExpExecArray | null {
	INLINE_HTML_CLOSE_TAG_STICKY.lastIndex = index;
	return INLINE_HTML_CLOSE_TAG_STICKY.exec(line);
}

function hasUnescapedPipe(text: string): boolean {
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === "|" && !isEscapedAt(text, i)) {
			return true;
		}
	}
	return false;
}

export function skipInlineCodeSpan(line: string, start: number): number {
	const length = line.length;
	let tickEnd = start;
	while (tickEnd < length && line[tickEnd] === "`") tickEnd += 1;
	const tickLen = tickEnd - start;
	const delimiter = "`".repeat(tickLen);
	let searchFrom = tickEnd;
	while (searchFrom < length) {
		const found = line.indexOf(delimiter, searchFrom);
		if (found < 0) return tickEnd;
		const beforeIsTick = found > 0 && line[found - 1] === "`";
		const afterIsTick =
			found + tickLen < length && line[found + tickLen] === "`";
		if (!beforeIsTick && !afterIsTick) return found + tickLen;
		searchFrom = found + 1;
	}
	return tickEnd;
}

/**
 * Match a balanced allowed inline HTML span (supporting nested inline tags and
 * inline Markdown without crossing unescaped GFM table cell pipes), or an
 * unmatched standalone allowed open/close tag so it strips cleanly in preview
 * and round-trips verbatim without backslash escaping.
 */
function matchAllowedInlineHtml(
	line: string,
	start: number,
	isTableRow: boolean,
	unclosedTagBoundary: Map<string, number>,
): string | null {
	const closeOnly = execInlineHtmlCloseTag(line, start);
	if (
		closeOnly?.[1] &&
		PAIRED_INLINE_HTML_TAGS.has(closeOnly[1].toLowerCase())
	) {
		return closeOnly[0];
	}
	const openMatch = execInlineHtmlOpenTag(line, start);
	if (
		!openMatch?.[1] ||
		!PAIRED_INLINE_HTML_TAGS.has(openMatch[1].toLowerCase()) ||
		(isTableRow && hasUnescapedPipe(openMatch[0]))
	) {
		return null;
	}
	if (openMatch[2] === "/") {
		return openMatch[0];
	}
	const targetTag = openMatch[1].toLowerCase();
	const knownUnclosedEnd = unclosedTagBoundary.get(targetTag);
	if (knownUnclosedEnd !== undefined && start < knownUnclosedEnd) {
		return openMatch[0];
	}
	let depth = 1;
	let sawClose = false;
	let cursor = start + openMatch[0].length;
	const length = line.length;
	while (cursor < length) {
		const ch = line[cursor] ?? "";
		if (ch === "`" && !isEscapedAt(line, cursor)) {
			const codeEnd = skipInlineCodeSpan(line, cursor);
			if (isTableRow && hasUnescapedPipe(line.slice(cursor, codeEnd))) {
				break;
			}
			cursor = codeEnd;
			continue;
		}
		if (isTableRow && ch === "|" && !isEscapedAt(line, cursor)) {
			break;
		}
		if (ch === "<" && !isEscapedAt(line, cursor)) {
			const nestedClose = execInlineHtmlCloseTag(line, cursor);
			if (nestedClose?.[1]?.toLowerCase() === targetTag) {
				sawClose = true;
				depth -= 1;
				cursor += nestedClose[0].length;
				if (depth === 0) {
					return line.slice(start, cursor);
				}
				continue;
			}
			const nestedOpen = execInlineHtmlOpenTag(line, cursor);
			if (
				nestedOpen?.[1]?.toLowerCase() === targetTag &&
				nestedOpen[2] !== "/"
			) {
				if (isTableRow && hasUnescapedPipe(nestedOpen[0])) {
					break;
				}
				depth += 1;
				cursor += nestedOpen[0].length;
				continue;
			}
		}
		cursor += 1;
	}
	// Only when zero closing tags existed up to `cursor` is every later
	// opening tag before `cursor` guaranteed unmatched too.
	if (!sawClose) {
		unclosedTagBoundary.set(targetTag, cursor);
	}
	// Unmatched tag (or split across table cell pipes): protect only the tag
	// itself so neighboring cells and inline text remain ordinary Markdown.
	return openMatch[0];
}

/** Feature-private inline protected-syntax scanner for the prescanner. */
function isEscapedAt(text: string, index: number): boolean {
	let slashes = 0;
	for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
		slashes += 1;
	}
	return slashes % 2 === 1;
}

export function extractInlineProtectedSyntax(
	line: string,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	isTableRow: boolean,
): string {
	let result = "";
	let index = 0;
	const length = line.length;
	const unclosedTagBoundary = new Map<string, number>();

	const allocateToken = (
		kind: ProtectedInlineKind,
		rawMarkdown: string,
	): string => {
		const token = `${sentinel}INL${protectedInlines.size}END`;
		protectedInlines.set(token, { kind, rawMarkdown });
		return token;
	};

	while (index < length) {
		const ch = line[index] ?? "";

		// Preserve inline code spans verbatim so math/footnotes inside backticks
		// stay literal and never allocate sentinels.
		if (ch === "`" && !isEscapedAt(line, index)) {
			const codeEnd = skipInlineCodeSpan(line, index);
			result += line.slice(index, codeEnd);
			index = codeEnd;
			continue;
		}

		// Link/image destinations and titles are never inline-protected here;
		// sentinels inside `(...)` would leak into ProseMirror attributes.
		if (ch === "]" && line[index + 1] === "(" && !isEscapedAt(line, index)) {
			let depth = 1;
			let cursor = index + 2;
			while (cursor < length && depth > 0) {
				const cur = line[cursor] ?? "";
				if (cur === "\\") {
					cursor += 2;
					continue;
				}
				if (cur === "(") {
					depth += 1;
				} else if (cur === ")") {
					depth -= 1;
				}
				cursor += 1;
			}
			if (depth === 0) {
				result += line.slice(index, cursor);
				index = cursor;
				continue;
			}
		}

		// GFM table cells: a literal `<br>` is a visual hard break, while an
		// escaped `\<br\>` stays literal text (matching TableCellBreakParser).
		if (isTableRow && ch === "<" && !isEscapedAt(line, index)) {
			TABLE_BR_STICKY.lastIndex = index;
			const brMatch = TABLE_BR_STICKY.exec(line);
			if (brMatch) {
				result += `${sentinel}BREND`;
				index += brMatch[0].length;
				continue;
			}
		}

		// Inline LaTeX math: \(...\)
		if (ch === "\\" && line[index + 1] === "(" && !isEscapedAt(line, index)) {
			let closePos = -1;
			for (let j = index + 2; j < length - 1; j += 1) {
				if (line[j] === "\\" && line[j + 1] === ")" && !isEscapedAt(line, j)) {
					closePos = j;
					break;
				}
			}
			if (closePos > index + 2) {
				result += allocateToken("math-inline", line.slice(index, closePos + 2));
				index = closePos + 2;
				continue;
			}
		}

		// Inline LaTeX math: \[...\]
		if (ch === "\\" && line[index + 1] === "[" && !isEscapedAt(line, index)) {
			let closePos = -1;
			for (let j = index + 2; j < length - 1; j += 1) {
				if (line[j] === "\\" && line[j + 1] === "]" && !isEscapedAt(line, j)) {
					closePos = j;
					break;
				}
			}
			if (closePos > index + 2) {
				result += allocateToken("math-inline", line.slice(index, closePos + 2));
				index = closePos + 2;
				continue;
			}
		}

		if (ch === "$" && !isEscapedAt(line, index)) {
			// Mid-line display math `$$...$$` stays one protected atom, while an
			// empty `$$$$` and an unclosed `$$` never start a single-dollar scan.
			if (line[index + 1] === "$") {
				const closeDisplay = line.indexOf("$$", index + 2);
				if (closeDisplay > index + 2) {
					result += allocateToken(
						"math-inline",
						line.slice(index, closeDisplay + 2),
					);
					index = closeDisplay + 2;
					continue;
				}
				result += "$$";
				index += 2;
				continue;
			}
			const openFollow = line[index + 1] ?? "";
			if (openFollow.length > 0 && !/\s/.test(openFollow)) {
				let closePos = -1;
				for (let j = index + 1; j < length; j += 1) {
					const cur = line[j] ?? "";
					if (isTableRow && cur === "|" && !isEscapedAt(line, j)) {
						break;
					}
					if (cur !== "$" || isEscapedAt(line, j)) {
						continue;
					}
					if (line[j + 1] === "$") {
						break;
					}
					const before = line[j - 1] ?? "";
					const after = line[j + 1] ?? "";
					if (/\s/.test(before) || /[0-9]/.test(after)) {
						break;
					}
					closePos = j;
					break;
				}
				if (closePos > index + 1) {
					result += allocateToken(
						"math-inline",
						line.slice(index, closePos + 1),
					);
					index = closePos + 1;
					continue;
				}
			}
		}

		// Footnote reference: [^label]
		if (ch === "[" && line[index + 1] === "^" && !isEscapedAt(line, index)) {
			FOOTNOTE_REF_STICKY.lastIndex = index;
			const match = FOOTNOTE_REF_STICKY.exec(line);
			if (match) {
				const afterChar = line[index + match[0].length];
				if (afterChar !== ":" && afterChar !== "(" && afterChar !== "[") {
					result += allocateToken("footnote-ref", match[0]);
					index += match[0].length;
					continue;
				}
			}
		}

		// Inline HTML comment: <!-- ... -->
		if (ch === "<" && line.startsWith("<!--", index)) {
			const closeComment = line.indexOf("-->", index + 4);
			if (closeComment >= 0) {
				result += allocateToken(
					"raw-inline",
					line.slice(index, closeComment + 3),
				);
				index = closeComment + 3;
				continue;
			}
		}

		// Allowed inline HTML spans/tags (e.g. <u>text</u>, <u>*italic*</u>,
		// <u>nested <mark>inner</mark></u>, <sub>2</sub>, <kbd>⌘</kbd>, or
		// cell-split tags in GFM tables): preserve verbatim as a protected
		// inline atom without crossing table cell pipes or escaping `<`.
		if (ch === "<" && !isEscapedAt(line, index)) {
			const matchedHtml = matchAllowedInlineHtml(
				line,
				index,
				isTableRow,
				unclosedTagBoundary,
			);
			if (matchedHtml !== null) {
				result += allocateToken("raw-inline", matchedHtml);
				index += matchedHtml.length;
				continue;
			}
		}

		result += ch;
		index += 1;
	}

	return result;
}
