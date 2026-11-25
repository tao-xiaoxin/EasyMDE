import { matchHtmlBlockOpen } from "../../shared/markdown/php-commonmark-block-helpers";
import type { PhpMarkdownMathRange } from "../../shared/markdown/php-markdown-math-mask";
import type { ProtectedInlineKind } from "./visual-schema";

export type ProtectedInlineEntry = Readonly<{
	continuationIndent?: boolean;
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
	/<([a-z][a-z0-9-]*)(?:[ \t]+[a-z_:][a-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^\s"'=<>`]+|'[^'\n]*'|"[^"\n]*"))?)*[ \t]*(\/?)>/y;
const INLINE_HTML_CLOSE_TAG_STICKY = /<\/([a-z][a-z0-9-]*)[ \t]*>/y;
const INLINE_HTML_DECLARATION_NAME_STICKY = /<![A-Za-z]+/y;
const FOOTNOTE_REF_STICKY = /\[\^([^\s\]]+)\]/y;

export type InlineHtmlScanState = {
	noAngleClose: boolean;
	noCdataClose: boolean;
	noCommentClose: boolean;
	noPiClose: boolean;
};

export function createInlineHtmlScanState(): InlineHtmlScanState {
	return {
		noAngleClose: false,
		noCdataClose: false,
		noCommentClose: false,
		noPiClose: false,
	};
}

/**
 * CommonMark §4.6 Types 1–6 HTML blocks that would interrupt an open paragraph
 * if serialized at 0–3 spaces on a continuation line instead of staying inline.
 */
export function wouldRawHtmlInterruptParagraph(raw: string): boolean {
	return matchHtmlBlockOpen(raw, false) !== null;
}

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

/**
 * Matches one CommonMark §6.6 inline raw HTML token at `index` (comment,
 * CDATA, declaration, processing instruction, open tag, or closing tag)
 * matching PHP `League\CommonMark\Util\RegexHelper::PARTIAL_HTMLTAG`. Never
 * matches `<https://...>` or `<user@example.com>` autolinks.
 */
export function execCommonMarkInlineHtmlToken(
	line: string,
	index: number,
	scanState?: InlineHtmlScanState,
): string | null {
	if (line[index] !== "<") {
		return null;
	}
	const next = line[index + 1];
	if (next === "!") {
		if (line.startsWith("<!--", index)) {
			if (line.startsWith("<!-->", index)) {
				return "<!-->";
			}
			if (line.startsWith("<!--->", index)) {
				return "<!--->";
			}
			if (!scanState?.noCommentClose) {
				const closePos = line.indexOf("-->", index + 4);
				if (closePos >= 0) {
					return line.slice(index, closePos + 3);
				}
				if (scanState) {
					scanState.noCommentClose = true;
				}
			}
			return null;
		}
		if (line.startsWith("<![CDATA[", index)) {
			if (!scanState?.noCdataClose) {
				const closePos = line.indexOf("]]>", index + 9);
				if (closePos >= 0) {
					return line.slice(index, closePos + 3);
				}
				if (scanState) {
					scanState.noCdataClose = true;
				}
			}
			return null;
		}
		INLINE_HTML_DECLARATION_NAME_STICKY.lastIndex = index;
		const declName = INLINE_HTML_DECLARATION_NAME_STICKY.exec(line);
		if (declName && !scanState?.noAngleClose) {
			const closePos = line.indexOf(">", index + declName[0].length);
			if (closePos >= 0) {
				return line.slice(index, closePos + 1);
			}
			if (scanState) {
				scanState.noAngleClose = true;
			}
		}
		return null;
	}
	if (next === "?") {
		if (!scanState?.noPiClose) {
			const closePos = line.indexOf("?>", index + 2);
			if (closePos >= 0) {
				return line.slice(index, closePos + 2);
			}
			if (scanState) {
				scanState.noPiClose = true;
			}
		}
		return null;
	}
	if (next === "/") {
		return execInlineHtmlCloseTag(line, index)?.[0] ?? null;
	}
	return execInlineHtmlOpenTag(line, index)?.[0] ?? null;
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

function buildLinkParenCloseMap(
	line: string,
	fromIndex: number,
): Map<number, number> {
	const openStack: number[] = [];
	const closeByOpen = new Map<number, number>();
	let scan = fromIndex;
	const length = line.length;
	while (scan < length) {
		const cur = line[scan] ?? "";
		if (cur === "\\") {
			scan += 2;
			continue;
		}
		if (cur === "(") {
			openStack.push(scan);
		} else if (cur === ")" && openStack.length > 0) {
			const openPos = openStack.pop();
			if (openPos !== undefined) {
				closeByOpen.set(openPos, scan + 1);
			}
		}
		scan += 1;
	}
	return closeByOpen;
}

function findUnescapedDelimiterClose(
	line: string,
	delimiter: string,
	searchFrom: number,
): number {
	let pos = line.indexOf(delimiter, searchFrom);
	while (pos >= 0) {
		if (!isEscapedAt(line, pos)) {
			return pos;
		}
		pos = line.indexOf(delimiter, pos + delimiter.length);
	}
	return -1;
}

function spanCrossesTableMath(
	tableMathRanges: ReadonlyArray<PhpMarkdownMathRange> | undefined,
	cursor: number,
	spanStart: number,
	spanEnd: number,
): boolean {
	if (!tableMathRanges) {
		return false;
	}
	for (let i = cursor; i < tableMathRanges.length; i += 1) {
		const range = tableMathRanges[i];
		if (!range || range.from >= spanEnd) {
			break;
		}
		if (range.from >= spanStart && range.to > spanEnd) {
			return true;
		}
	}
	return false;
}

export function extractInlineProtectedSyntax(
	line: string,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	isTableRow: boolean,
	allowRefDefDest = false,
	indentedContinuationStart = -1,
	tableMathRanges?: ReadonlyArray<PhpMarkdownMathRange>,
): string {
	let result = "";
	let index = 0;
	const length = line.length;
	let unclosedTagBoundary: Map<string, number> | null = null;
	let htmlScanState: InlineHtmlScanState | null = null;
	let linkParenCloseByOpen: Map<number, number> | null = null;
	let noClosingParenMath = false;
	let noClosingBracketMath = false;
	let noClosingDoubleDollar = false;
	let noClosingSingleDollar = false;
	let noRefDestCloseAngle = false;
	let tableMathCursor = 0;

	const allocateToken = (
		kind: ProtectedInlineKind,
		rawMarkdown: string,
		continuationIndent = false,
	): string => {
		const token = `${sentinel}INL${protectedInlines.size}END`;
		protectedInlines.set(
			token,
			continuationIndent
				? { continuationIndent: true, kind, rawMarkdown }
				: { kind, rawMarkdown },
		);
		return token;
	};

	while (index < length) {
		if (tableMathRanges !== undefined) {
			while (
				tableMathCursor < tableMathRanges.length &&
				(tableMathRanges[tableMathCursor]?.to ?? 0) <= index
			) {
				tableMathCursor += 1;
			}
			const activeMath = tableMathRanges[tableMathCursor];
			if (activeMath && activeMath.from === index && activeMath.to > index) {
				result += allocateToken(
					"math-inline",
					line.slice(activeMath.from, activeMath.to),
				);
				index = activeMath.to;
				tableMathCursor += 1;
				continue;
			}
		}

		const ch = line[index] ?? "";

		// Preserve inline code spans verbatim so math/footnotes/HTML inside
		// backticks stay literal and never allocate sentinels.
		if (ch === "`" && !isEscapedAt(line, index)) {
			const codeEnd = skipInlineCodeSpan(line, index);
			result += line.slice(index, codeEnd);
			index = codeEnd;
			continue;
		}

		// Link/image destinations and titles are never inline-protected here;
		// sentinels inside `(...)` would leak into ProseMirror attributes.
		if (ch === "]" && line[index + 1] === "(" && !isEscapedAt(line, index)) {
			let endCursor = -1;
			if (linkParenCloseByOpen !== null) {
				endCursor = linkParenCloseByOpen.get(index + 1) ?? -1;
			} else {
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
					endCursor = cursor;
				} else {
					// Build one O(N) balanced-paren map on the first unclosed `](`
					// so repeated unclosed `](` sequences never rescan to EOL.
					linkParenCloseByOpen = buildLinkParenCloseMap(line, index);
				}
			}
			if (
				endCursor > index + 1 &&
				!spanCrossesTableMath(tableMathRanges, tableMathCursor, index, endCursor)
			) {
				result += line.slice(index, endCursor);
				index = endCursor;
				continue;
			}
		}

		// Angle-bracketed CommonMark §4.7 reference destinations (`[r]: <...>`)
		// must keep their raw `<` / `>` delimiters intact for markdown-it's
		// reference block rule (e.g. rejecting zero-whitespace `[r]: </dest>"t"`).
		if (
			allowRefDefDest &&
			!noRefDestCloseAngle &&
			ch === "]" &&
			line[index + 1] === ":" &&
			!isEscapedAt(line, index)
		) {
			let cursor = index + 2;
			while (
				cursor < length &&
				(line[cursor] === " " || line[cursor] === "\t")
			) {
				cursor += 1;
			}
			if (line[cursor] === "<") {
				let destEnd = cursor + 1;
				let sawAngleClose = false;
				while (destEnd < length) {
					const cur = line[destEnd] ?? "";
					if (cur === "\\") {
						destEnd += 2;
						continue;
					}
					if (cur === "<" || cur === "\n") {
						destEnd = -1;
						break;
					}
					if (cur === ">") {
						sawAngleClose = true;
						destEnd += 1;
						break;
					}
					destEnd += 1;
				}
				if (sawAngleClose && destEnd > cursor + 1) {
					result += line.slice(index, destEnd);
					index = destEnd;
					continue;
				}
				if (destEnd >= length) {
					noRefDestCloseAngle = true;
				}
			}
		}

		// GFM table cells: exact case-sensitive `<br>` is a visual hard break,
		// while `<br/>` / `<br />` fall through as raw inline HTML, `<BR>` /
		// `<Br>` stay literal text, and `\<br\>` stays literal (matching PHP
		// TableCellBreakParser::getMatchDefinition()).
		if (
			isTableRow &&
			ch === "<" &&
			!isEscapedAt(line, index) &&
			line.startsWith("<br>", index)
		) {
			result += `${sentinel}BREND`;
			index += 4;
			continue;
		}

		if (tableMathRanges === undefined) {
			// Inline LaTeX math: \(...\)
			if (
				!noClosingParenMath &&
				ch === "\\" &&
				line[index + 1] === "(" &&
				!isEscapedAt(line, index)
			) {
				const closePos = findUnescapedDelimiterClose(line, "\\)", index + 2);
				if (closePos > index + 2) {
					result += allocateToken(
						"math-inline",
						line.slice(index, closePos + 2),
					);
					index = closePos + 2;
					continue;
				}
				if (closePos < 0) {
					noClosingParenMath = true;
				}
			}

			// Inline LaTeX math: \[...\]
			if (
				!noClosingBracketMath &&
				ch === "\\" &&
				line[index + 1] === "[" &&
				!isEscapedAt(line, index)
			) {
				const closePos = findUnescapedDelimiterClose(line, "\\]", index + 2);
				if (closePos > index + 2) {
					result += allocateToken(
						"math-inline",
						line.slice(index, closePos + 2),
					);
					index = closePos + 2;
					continue;
				}
				if (closePos < 0) {
					noClosingBracketMath = true;
				}
			}

			if (ch === "$" && !isEscapedAt(line, index)) {
				// Mid-line display math `$$...$$` stays one protected atom, while an
				// empty `$$$$` and an unclosed `$$` never start a single-dollar scan.
				if (line[index + 1] === "$") {
					if (!noClosingDoubleDollar) {
						const closeDisplay = line.indexOf("$$", index + 2);
						if (closeDisplay > index + 2) {
							result += allocateToken(
								"math-inline",
								line.slice(index, closeDisplay + 2),
							);
							index = closeDisplay + 2;
							continue;
						}
						if (closeDisplay < 0) {
							noClosingDoubleDollar = true;
						}
					}
					result += "$$";
					index += 2;
					continue;
				}
				const openFollow = line[index + 1] ?? "";
				if (
					!noClosingSingleDollar &&
					openFollow.length > 0 &&
					!/\s/.test(openFollow)
				) {
					let closePos = -1;
					let sawUnescapedDollar = false;
					for (let j = index + 1; j < length; j += 1) {
						const cur = line[j] ?? "";
						if (cur !== "$" || isEscapedAt(line, j)) {
							continue;
						}
						sawUnescapedDollar = true;
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
					if (!sawUnescapedDollar) {
						noClosingSingleDollar = true;
					}
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

		// Allowed paired phrasing HTML spans/tags (e.g. <u>text</u>, <u>*italic*</u>,
		// <sub>2</sub>, <kbd>⌘</kbd>) and all other CommonMark §6.6 inline raw
		// HTML tokens (open/close tags such as <div>/</div>, comments, declarations,
		// PIs, CDATA): preserve verbatim as protected inline atoms without crossing
		// table cell pipes or escaping `<` on edits.
		if (ch === "<" && !isEscapedAt(line, index)) {
			const fromContinuationIndent =
				indentedContinuationStart >= 0 && index === indentedContinuationStart;
			if (unclosedTagBoundary === null) {
				unclosedTagBoundary = new Map<string, number>();
			}
			const matchedPairedHtml = matchAllowedInlineHtml(
				line,
				index,
				isTableRow,
				unclosedTagBoundary,
			);
			if (matchedPairedHtml !== null) {
				result += allocateToken(
					"raw-inline",
					matchedPairedHtml,
					fromContinuationIndent,
				);
				index += matchedPairedHtml.length;
				continue;
			}
			if (htmlScanState === null) {
				htmlScanState = createInlineHtmlScanState();
			}
			const matchedRawHtml = execCommonMarkInlineHtmlToken(
				line,
				index,
				htmlScanState,
			);
			if (
				matchedRawHtml !== null &&
				!(isTableRow && hasUnescapedPipe(matchedRawHtml))
			) {
				result += allocateToken(
					"raw-inline",
					matchedRawHtml,
					fromContinuationIndent,
				);
				index += matchedRawHtml.length;
				continue;
			}
		}

		result += ch;
		index += 1;
	}

	return result;
}
