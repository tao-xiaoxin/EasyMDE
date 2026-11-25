import { matchHtmlBlockOpen } from "../../shared/markdown/php-commonmark-block-helpers";
import {
	type PhpMarkdownMathRange,
	scanPhpMarkdownMathRanges,
} from "../../shared/markdown/php-markdown-math-mask";
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

type InlineHtmlScanState = {
	noAngleClose: boolean;
	noCdataClose: boolean;
	noCommentClose: boolean;
	noPiClose: boolean;
};

type LinkTailScanState = {
	noAngleClose: boolean;
	noDoubleQuoteClose: boolean;
	noParenTitleClose: boolean;
	noSingleQuoteClose: boolean;
};

/**
 * CommonMark §4.6 Types 1–6 HTML blocks that would interrupt an open paragraph
 * if serialized at 0–3 spaces on a continuation line instead of staying inline.
 */
export function wouldRawHtmlInterruptParagraph(raw: string): boolean {
	return matchHtmlBlockOpen(raw, false) !== null;
}

function execInlineHtmlOpenTag(
	line: string,
	index: number,
): RegExpExecArray | null {
	INLINE_HTML_OPEN_TAG_STICKY.lastIndex = index;
	return INLINE_HTML_OPEN_TAG_STICKY.exec(line);
}

function execInlineHtmlCloseTag(
	line: string,
	index: number,
): RegExpExecArray | null {
	INLINE_HTML_CLOSE_TAG_STICKY.lastIndex = index;
	return INLINE_HTML_CLOSE_TAG_STICKY.exec(line);
}

function isTableCellPipeAt(text: string, index: number): boolean {
	return text[index] === "|" && (index === 0 || text[index - 1] !== "\\");
}

function hasUnescapedTablePipeInSlice(
	scanLine: string,
	start: number,
	end: number,
): boolean {
	for (let i = start; i < end; i += 1) {
		if (isTableCellPipeAt(scanLine, i)) return true;
	}
	return false;
}

function isEscapedAt(text: string, index: number): boolean {
	let slashes = 0;
	for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
		slashes += 1;
	}
	return slashes % 2 === 1;
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

function matchCommonMarkInlineHtmlLength(
	scanLine: string,
	index: number,
	scanState: InlineHtmlScanState,
): number {
	if (scanLine[index] !== "<") return 0;
	const next = scanLine[index + 1];
	if (next === "!") {
		if (scanLine.startsWith("<!--", index)) {
			if (scanLine.startsWith("<!-->", index)) return 5;
			if (scanLine.startsWith("<!--->", index)) return 6;
			if (!scanState.noCommentClose) {
				const closePos = scanLine.indexOf("-->", index + 4);
				if (closePos >= 0) return closePos + 3 - index;
				scanState.noCommentClose = true;
			}
			return 0;
		}
		if (scanLine.startsWith("<![CDATA[", index)) {
			if (!scanState.noCdataClose) {
				const closePos = scanLine.indexOf("]]>", index + 9);
				if (closePos >= 0) return closePos + 3 - index;
				scanState.noCdataClose = true;
			}
			return 0;
		}
		INLINE_HTML_DECLARATION_NAME_STICKY.lastIndex = index;
		const declName = INLINE_HTML_DECLARATION_NAME_STICKY.exec(scanLine);
		if (declName && !scanState.noAngleClose) {
			const closePos = scanLine.indexOf(">", index + declName[0].length);
			if (closePos >= 0) return closePos + 1 - index;
			scanState.noAngleClose = true;
		}
		return 0;
	}
	if (next === "?") {
		if (!scanState.noPiClose) {
			const closePos = scanLine.indexOf("?>", index + 2);
			if (closePos >= 0) return closePos + 2 - index;
			scanState.noPiClose = true;
		}
		return 0;
	}
	if (next === "/") {
		return execInlineHtmlCloseTag(scanLine, index)?.[0].length ?? 0;
	}
	return execInlineHtmlOpenTag(scanLine, index)?.[0].length ?? 0;
}

/**
 * Scans `scanLine` from `fromIndex` for paired `<targetTag>...</targetTag>`
 * tokens (respecting backticks and GFM table pipes). When `stopAtFirstClose`
 * is true, resolves only the opening tag at `fromIndex` without allocating a
 * map; otherwise builds the full O(L) open → close map on the first mismatch.
 */
function scanPairedTagMatches(
	scanLine: string,
	fromIndex: number,
	targetTag: string,
	isTableRow: boolean,
	firstOpenEnd: number,
): number | Map<number, number> {
	const length = scanLine.length;
	const singlePass = firstOpenEnd >= 0;
	let depth = 1;
	const openStack: number[] = [];
	const closeByOpen = singlePass ? null : new Map<number, number>();
	let scan = singlePass ? firstOpenEnd : fromIndex;

	while (scan < length) {
		const ch = scanLine[scan] ?? "";
		if (ch === "`" && !isEscapedAt(scanLine, scan)) {
			const codeEnd = skipInlineCodeSpan(scanLine, scan);
			if (isTableRow && hasUnescapedTablePipeInSlice(scanLine, scan, codeEnd)) {
				if (singlePass) return -1;
				openStack.length = 0;
			}
			scan = codeEnd;
			continue;
		}
		if (isTableRow && isTableCellPipeAt(scanLine, scan)) {
			if (singlePass) return -1;
			openStack.length = 0;
			scan += 1;
			continue;
		}
		if (ch === "<" && !isEscapedAt(scanLine, scan)) {
			const nestedClose = execInlineHtmlCloseTag(scanLine, scan);
			if (nestedClose?.[1]?.toLowerCase() === targetTag) {
				const closeEnd = scan + nestedClose[0].length;
				if (singlePass) {
					depth -= 1;
					if (depth === 0) return closeEnd;
				} else if (openStack.length > 0) {
					const openPos = openStack.pop();
					if (openPos !== undefined) closeByOpen?.set(openPos, closeEnd);
				}
				scan = closeEnd;
				continue;
			}
			const nestedOpen = execInlineHtmlOpenTag(scanLine, scan);
			if (
				nestedOpen?.[1]?.toLowerCase() === targetTag &&
				nestedOpen[2] !== "/"
			) {
				const openLen = nestedOpen[0].length;
				if (
					isTableRow &&
					hasUnescapedTablePipeInSlice(scanLine, scan, scan + openLen)
				) {
					if (singlePass) return -1;
					openStack.length = 0;
					scan += 1;
					continue;
				}
				if (singlePass) depth += 1;
				else openStack.push(scan);
				scan += openLen;
				continue;
			}
		}
		scan += 1;
	}
	return singlePass ? -1 : (closeByOpen ?? new Map<number, number>());
}

function matchAllowedInlineHtmlEnd(
	scanLine: string,
	start: number,
	isTableRow: boolean,
	pairedTagCloseMaps: Map<string, Map<number, number>>,
): number {
	const closeOnly = execInlineHtmlCloseTag(scanLine, start);
	if (
		closeOnly?.[1] &&
		PAIRED_INLINE_HTML_TAGS.has(closeOnly[1].toLowerCase())
	) {
		return start + closeOnly[0].length;
	}
	const openMatch = execInlineHtmlOpenTag(scanLine, start);
	if (
		!openMatch?.[1] ||
		!PAIRED_INLINE_HTML_TAGS.has(openMatch[1].toLowerCase()) ||
		(isTableRow &&
			hasUnescapedTablePipeInSlice(
				scanLine,
				start,
				start + openMatch[0].length,
			))
	) {
		return -1;
	}
	const openEnd = start + openMatch[0].length;
	if (openMatch[2] === "/") return openEnd;
	const targetTag = openMatch[1].toLowerCase();
	const cachedMap = pairedTagCloseMaps.get(targetTag);
	if (cachedMap !== undefined) return cachedMap.get(start) ?? openEnd;

	const matchedEnd = scanPairedTagMatches(
		scanLine,
		start,
		targetTag,
		isTableRow,
		openEnd,
	);
	if (typeof matchedEnd === "number" && matchedEnd > start) {
		return matchedEnd;
	}
	const builtMap = scanPairedTagMatches(
		scanLine,
		start,
		targetTag,
		isTableRow,
		-1,
	);
	if (builtMap instanceof Map) {
		pairedTagCloseMaps.set(targetTag, builtMap);
	}
	return openEnd;
}

function resolveInlineScanLine(
	line: string,
	mathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	maskedLine?: string,
): string {
	if (mathRanges.length === 0) return line;
	if (
		maskedLine !== undefined &&
		maskedLine.length === line.length &&
		!maskedLine.includes("\n")
	) {
		return maskedLine;
	}
	const parts: string[] = [];
	let cursor = 0;
	for (let i = 0; i < mathRanges.length; i += 1) {
		const range = mathRanges[i];
		if (!range) continue;
		const from = Math.max(cursor, range.from);
		const to = Math.min(line.length, range.to);
		if (to <= from) continue;
		if (from > cursor) parts.push(line.slice(cursor, from));
		const len = to - from;
		parts.push(len >= 3 ? `M${"_".repeat(len - 2)}M` : "M".repeat(len));
		cursor = to;
	}
	if (cursor < line.length) parts.push(line.slice(cursor));
	return parts.join("");
}

function skipLinkWs(text: string, pos: number): number {
	let p = pos;
	while (p < text.length) {
		const ch = text[p];
		if (ch === " " || ch === "\t" || ch === "\n") p += 1;
		else break;
	}
	return p;
}

/**
 * Parses a CommonMark §6.3 inline link tail `(...)` starting at `openParenIndex`
 * on math-masked `scanLine`: optional `<...>` or balanced bare destination (up
 * to depth 32, no whitespace/controls) + optional quoted title (`"..."`,
 * `'...'`, or `(...)`), never crossing unescaped GFM table cell pipes outside
 * math. Returns the end offset after `)`, or -1 if invalid.
 */
function parseInlineLinkTail(
	scanLine: string,
	openParenIndex: number,
	isTableRow: boolean,
	scanState: LinkTailScanState,
): number {
	const length = scanLine.length;
	let pos = skipLinkWs(scanLine, openParenIndex + 1);
	if (pos >= length) return -1;
	if (scanLine[pos] === ")") return pos + 1;

	let hasDest = false;
	if (scanLine[pos] === "<") {
		if (scanState.noAngleClose) return -1;
		pos += 1;
		let closedAngle = false;
		while (pos < length) {
			if (isTableRow && isTableCellPipeAt(scanLine, pos)) return -1;
			const ch = scanLine[pos];
			if (ch === "\\") {
				if (pos + 1 < length && scanLine[pos + 1] !== "\n") {
					pos += 2;
					continue;
				}
				return -1;
			}
			if (ch === "<" || ch === "\n") return -1;
			if (ch === ">") {
				pos += 1;
				closedAngle = true;
				break;
			}
			pos += 1;
		}
		if (!closedAngle) {
			if (!isTableRow) scanState.noAngleClose = true;
			return -1;
		}
		hasDest = true;
	} else {
		const destStart = pos;
		let parenDepth = 0;
		while (pos < length) {
			if (isTableRow && isTableCellPipeAt(scanLine, pos)) return -1;
			const code = scanLine.charCodeAt(pos);
			if (code <= 0x20 || code === 0x7f) break;
			if (code === 0x5c) {
				pos +=
					pos + 1 < length &&
					scanLine.charCodeAt(pos + 1) > 0x20 &&
					scanLine.charCodeAt(pos + 1) !== 0x7f
						? 2
						: 1;
				continue;
			}
			if (code === 0x28) {
				parenDepth += 1;
				if (parenDepth > 32) return -1;
			} else if (code === 0x29) {
				if (parenDepth === 0) break;
				parenDepth -= 1;
			}
			pos += 1;
		}
		if (parenDepth !== 0) return -1;
		hasDest = pos > destStart;
	}

	const afterDest = pos;
	pos = skipLinkWs(scanLine, pos);
	if (pos >= length) return -1;
	if (scanLine[pos] === ")") return pos + 1;
	if (!hasDest || pos === afterDest) return -1;

	const quote = scanLine[pos];
	if (quote !== '"' && quote !== "'" && quote !== "(") return -1;
	if (
		(quote === '"' && scanState.noDoubleQuoteClose) ||
		(quote === "'" && scanState.noSingleQuoteClose) ||
		(quote === "(" && scanState.noParenTitleClose)
	) {
		return -1;
	}
	const closeQuote = quote === "(" ? ")" : quote;
	pos += 1;
	let closedTitle = false;
	while (pos < length) {
		if (isTableRow && isTableCellPipeAt(scanLine, pos)) return -1;
		const ch = scanLine[pos];
		if (ch === "\\") {
			pos += 2;
			continue;
		}
		if (ch === closeQuote) {
			pos += 1;
			closedTitle = true;
			break;
		}
		if (quote === "(" && ch === "(") return -1;
		pos += 1;
	}
	if (!closedTitle) {
		if (!isTableRow) {
			if (quote === '"') scanState.noDoubleQuoteClose = true;
			else if (quote === "'") scanState.noSingleQuoteClose = true;
			else scanState.noParenTitleClose = true;
		}
		return -1;
	}
	pos = skipLinkWs(scanLine, pos);
	return pos < length && scanLine[pos] === ")" ? pos + 1 : -1;
}

export function extractInlineProtectedSyntax(
	line: string,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	isTableRow: boolean,
	allowRefDefDest = false,
	indentedContinuationStart = -1,
	mathRanges?: ReadonlyArray<PhpMarkdownMathRange>,
	maskedLine?: string,
): string {
	const resolvedMathRanges = mathRanges ?? scanPhpMarkdownMathRanges(line);
	if (
		resolvedMathRanges.length === 0 &&
		!line.includes("<") &&
		!line.includes("[^")
	) {
		return line;
	}
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
	if (
		resolvedMathRanges.length > 0 &&
		!line.includes("<") &&
		!line.includes("[^") &&
		!line.includes("`") &&
		!line.includes("]")
	) {
		let fastResult = "";
		let cursor = 0;
		for (let i = 0; i < resolvedMathRanges.length; i += 1) {
			const range = resolvedMathRanges[i];
			if (!range || range.to <= cursor || range.from < cursor) continue;
			if (range.from > cursor) fastResult += line.slice(cursor, range.from);
			fastResult += allocateToken("math-inline", line.slice(range.from, range.to));
			cursor = range.to;
		}
		return cursor < line.length ? fastResult + line.slice(cursor) : fastResult;
	}
	const scanLine = resolveInlineScanLine(line, resolvedMathRanges, maskedLine);
	let result = "";
	let index = 0;
	const length = line.length;
	let pairedTagCloseMaps: Map<string, Map<number, number>> | null = null;
	let htmlScanState: InlineHtmlScanState | null = null;
	let linkTailScanState: LinkTailScanState | null = null;
	let noRefDestCloseAngle = false;
	let mathCursor = 0;

	while (index < length) {
		if (resolvedMathRanges.length > 0) {
			while (
				mathCursor < resolvedMathRanges.length &&
				(resolvedMathRanges[mathCursor]?.to ?? 0) <= index
			) {
				mathCursor += 1;
			}
			const activeMath = resolvedMathRanges[mathCursor];
			if (activeMath && activeMath.from === index && activeMath.to > index) {
				result += allocateToken(
					"math-inline",
					line.slice(activeMath.from, activeMath.to),
				);
				index = activeMath.to;
				mathCursor += 1;
				continue;
			}
		}

		const ch = scanLine[index] ?? "";

		if (ch === "`" && !isEscapedAt(scanLine, index)) {
			const codeEnd = skipInlineCodeSpan(scanLine, index);
			result += line.slice(index, codeEnd);
			index = codeEnd;
			continue;
		}

		if (
			ch === "]" &&
			scanLine[index + 1] === "(" &&
			!isEscapedAt(scanLine, index)
		) {
			if (linkTailScanState === null) {
				linkTailScanState = {
					noAngleClose: false,
					noDoubleQuoteClose: false,
					noParenTitleClose: false,
					noSingleQuoteClose: false,
				};
			}
			const endCursor = parseInlineLinkTail(
				scanLine,
				index + 1,
				isTableRow,
				linkTailScanState,
			);
			if (endCursor > index + 1) {
				const firstOverlap = resolvedMathRanges[mathCursor];
				if (!firstOverlap || firstOverlap.from >= endCursor) {
					result += line.slice(index, endCursor);
					index = endCursor;
					continue;
				}
				let scanIdx = mathCursor;
				let canProtectTail = true;
				while (scanIdx < resolvedMathRanges.length) {
					const range = resolvedMathRanges[scanIdx];
					if (!range || range.from >= endCursor) break;
					if (range.block || range.from < index || range.to > endCursor) {
						canProtectTail = false;
						break;
					}
					scanIdx += 1;
				}
				if (canProtectTail) {
					let tailCursor = index;
					while (mathCursor < scanIdx) {
						const range = resolvedMathRanges[mathCursor];
						if (range) {
							if (range.from > tailCursor) {
								result += line.slice(tailCursor, range.from);
							}
							result += allocateToken(
								"math-inline",
								line.slice(range.from, range.to),
							);
							tailCursor = range.to;
						}
						mathCursor += 1;
					}
					if (tailCursor < endCursor) {
						result += line.slice(tailCursor, endCursor);
					}
					index = endCursor;
					continue;
				}
			}
		}

		if (
			allowRefDefDest &&
			!noRefDestCloseAngle &&
			ch === "]" &&
			scanLine[index + 1] === ":" &&
			!isEscapedAt(scanLine, index)
		) {
			let cursor = index + 2;
			while (
				cursor < length &&
				(scanLine[cursor] === " " || scanLine[cursor] === "\t")
			) {
				cursor += 1;
			}
			if (scanLine[cursor] === "<") {
				let destEnd = cursor + 1;
				let sawAngleClose = false;
				while (destEnd < length) {
					const cur = scanLine[destEnd] ?? "";
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
				if (destEnd >= length) noRefDestCloseAngle = true;
			}
		}

		if (
			isTableRow &&
			ch === "<" &&
			!isEscapedAt(scanLine, index) &&
			scanLine.startsWith("<br>", index)
		) {
			result += `${sentinel}BREND`;
			index += 4;
			continue;
		}

		if (
			ch === "[" &&
			scanLine[index + 1] === "^" &&
			!isEscapedAt(scanLine, index)
		) {
			FOOTNOTE_REF_STICKY.lastIndex = index;
			const match = FOOTNOTE_REF_STICKY.exec(scanLine);
			if (match) {
				const afterChar = scanLine[index + match[0].length];
				if (afterChar !== ":" && afterChar !== "(" && afterChar !== "[") {
					result += allocateToken(
						"footnote-ref",
						line.slice(index, index + match[0].length),
					);
					index += match[0].length;
					continue;
				}
			}
		}

		if (ch === "<" && !isEscapedAt(scanLine, index)) {
			const fromContinuationIndent =
				indentedContinuationStart >= 0 && index === indentedContinuationStart;
			if (pairedTagCloseMaps === null) {
				pairedTagCloseMaps = new Map<string, Map<number, number>>();
			}
			const pairedEnd = matchAllowedInlineHtmlEnd(
				scanLine,
				index,
				isTableRow,
				pairedTagCloseMaps,
			);
			if (pairedEnd > index) {
				result += allocateToken(
					"raw-inline",
					line.slice(index, pairedEnd),
					fromContinuationIndent,
				);
				index = pairedEnd;
				continue;
			}
			if (htmlScanState === null) {
				htmlScanState = {
					noAngleClose: false,
					noCdataClose: false,
					noCommentClose: false,
					noPiClose: false,
				};
			}
			const rawHtmlLen = matchCommonMarkInlineHtmlLength(
				scanLine,
				index,
				htmlScanState,
			);
			if (
				rawHtmlLen > 0 &&
				!(
					isTableRow &&
					hasUnescapedTablePipeInSlice(scanLine, index, index + rawHtmlLen)
				)
			) {
				result += allocateToken(
					"raw-inline",
					line.slice(index, index + rawHtmlLen),
					fromContinuationIndent,
				);
				index += rawHtmlLen;
				continue;
			}
		}

		result += line[index] ?? "";
		index += 1;
	}

	return result;
}
