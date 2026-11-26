import {
	type BacktickRunBucket,
	findNextBacktickCloser,
	indexBacktickRunsByLength,
} from "../../shared/markdown/markdown-backtick-scanners";
import {
	hasMultibyteCodeUnit,
	isAsciiLowerAlnumOrHyphenCode,
	isAsciiLowerCode,
} from "../../shared/markdown/markdown-char-codes";
import {
	type AngleScanCache,
	createAngleScanCache,
	type HtmlTagDialect,
	LEAGUE_HTML_ASCII_DIALECT,
	LEAGUE_HTML_MULTIBYTE_DIALECT,
	matchLeagueHtmlInlineAt,
} from "../../shared/markdown/markdown-html-scanners";
import { hasOddPrecedingBackslashes } from "../../shared/markdown/markdown-source-projection";
import type { ProtectedInlineKind } from "./visual-schema";

export type ProtectedInlineEntry = Readonly<{
	containerSignature?: string;
	continuationPrefixes?: ReadonlyArray<string>;
	kind: ProtectedInlineKind;
	rawMarkdown: string;
}>;

type InlineContainerContext = Readonly<{
	linePrefixes: ReadonlyArray<string>;
	signature: string;
	standardPrefix: string;
}>;

type PrescannedInlineLine = Readonly<{
	endOffset: number;
	startOffset: number;
	text: string;
}>;

type InlineMathScanResult = Readonly<{
	end: number;
	kind: "literal-double-dollar" | "math";
}>;

type SingleDollarNoCloserRange = Readonly<{
	isTableRow: boolean;
	minIndex: number;
	until: number;
}>;

export type InlineScanCache = {
	angleCache: AngleScanCache;
	backtickBucketsBySize: Map<number, BacktickRunBucket> | null;
	htmlDialect: HtmlTagDialect;
	lastCloseBracketMath: number;
	lastCloseDoubleDollar: number;
	lastCloseParen: number;
	lastCloseParenMath: number;
	lastUnescapedDollar: number;
	noSingleDollarCloser: SingleDollarNoCloserRange | null;
	unclosedTagStarts: Set<number>;
	unmatchedLinkParenOpens: Set<number> | null;
};

export function createInlineScanCache(text: string): InlineScanCache {
	return {
		angleCache: createAngleScanCache(),
		backtickBucketsBySize: null,
		htmlDialect: hasMultibyteCodeUnit(text)
			? LEAGUE_HTML_MULTIBYTE_DIALECT
			: LEAGUE_HTML_ASCII_DIALECT,
		lastCloseBracketMath: -2,
		lastCloseDoubleDollar: -2,
		lastCloseParen: -2,
		lastCloseParenMath: -2,
		lastUnescapedDollar: -2,
		noSingleDollarCloser: null,
		unclosedTagStarts: new Set<number>(),
		unmatchedLinkParenOpens: null,
	};
}

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

const TABLE_BR_STICKY = /<br[ \t]*\/?>/iy;
const FOOTNOTE_REF_STICKY = /\[\^([^\s\]]+)\]/y;

function getLastUnescapedToken(text: string, token: string): number {
	let pos = text.lastIndexOf(token);
	while (pos >= 0 && hasOddPrecedingBackslashes(text, pos)) {
		pos = pos > 0 ? text.lastIndexOf(token, pos - 1) : -1;
	}
	return pos;
}

function getLastCloseParenMath(text: string, cache: InlineScanCache): number {
	if (-2 === cache.lastCloseParenMath) {
		cache.lastCloseParenMath = getLastUnescapedToken(text, "\\)");
	}
	return cache.lastCloseParenMath;
}

function getLastCloseBracketMath(text: string, cache: InlineScanCache): number {
	if (-2 === cache.lastCloseBracketMath) {
		cache.lastCloseBracketMath = getLastUnescapedToken(text, "\\]");
	}
	return cache.lastCloseBracketMath;
}

function getLastCloseDoubleDollar(
	text: string,
	cache: InlineScanCache,
): number {
	if (-2 === cache.lastCloseDoubleDollar) {
		cache.lastCloseDoubleDollar = text.lastIndexOf("$$");
	}
	return cache.lastCloseDoubleDollar;
}

function getLastUnescapedDollar(text: string, cache: InlineScanCache): number {
	if (-2 === cache.lastUnescapedDollar) {
		cache.lastUnescapedDollar = getLastUnescapedToken(text, "$");
	}
	return cache.lastUnescapedDollar;
}

function getLastCloseParen(text: string, cache: InlineScanCache): number {
	if (-2 === cache.lastCloseParen) {
		cache.lastCloseParen = text.lastIndexOf(")");
	}
	return cache.lastCloseParen;
}

/**
 * Classifies a valid League CommonMark 2.8.2 inline HTML token `[start, end)`
 * (already matched by `matchLeagueHtmlInlineAt()` with lowercase tag names).
 */
function classifyLeagueHtmlToken(
	line: string,
	start: number,
	end: number,
): Readonly<{ kind: "close" | "open" | "other"; tagName: string }> {
	const first = line.charCodeAt(start + 1);
	if (47 /* / */ === first) {
		let p = start + 2;
		while (p < end && isAsciiLowerAlnumOrHyphenCode(line.charCodeAt(p))) p += 1;
		return { kind: "close", tagName: line.slice(start + 2, p) };
	}
	if (isAsciiLowerCode(first)) {
		if (47 /* / */ === line.charCodeAt(end - 2)) {
			return { kind: "other", tagName: "" };
		}
		let p = start + 2;
		while (p < end && isAsciiLowerAlnumOrHyphenCode(line.charCodeAt(p))) p += 1;
		return { kind: "open", tagName: line.slice(start + 1, p) };
	}
	return { kind: "other", tagName: "" };
}

function hasUnescapedPipe(text: string): boolean {
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === "|" && !hasOddPrecedingBackslashes(text, i)) {
			return true;
		}
	}
	return false;
}

function countNewlines(text: string): number {
	let count = 0;
	for (let i = 0; i < text.length; i += 1) {
		if (10 /* \n */ === text.charCodeAt(i)) count += 1;
	}
	return count;
}

export function skipInlineCodeSpan(
	line: string,
	start: number,
	cache?: InlineScanCache,
): number {
	const length = line.length;
	let tickEnd = start;
	while (tickEnd < length && 96 /* ` */ === line.charCodeAt(tickEnd)) {
		tickEnd += 1;
	}
	const tickLen = tickEnd - start;
	if (cache) {
		let buckets = cache.backtickBucketsBySize;
		if (!buckets) {
			buckets = indexBacktickRunsByLength(line);
			cache.backtickBucketsBySize = buckets;
		}
		const closeStart = findNextBacktickCloser(buckets, tickLen, tickEnd, true);
		return closeStart >= 0 ? closeStart + tickLen : tickEnd;
	}
	const delimiter = "`".repeat(tickLen);
	let searchFrom = tickEnd;
	while (searchFrom < length) {
		const found = line.indexOf(delimiter, searchFrom);
		if (found < 0) return tickEnd;
		const beforeIsTick = found > 0 && 96 === line.charCodeAt(found - 1);
		const afterIsTick =
			found + tickLen < length && 96 === line.charCodeAt(found + tickLen);
		if (!beforeIsTick && !afterIsTick) return found + tickLen;
		searchFrom = found + 1;
	}
	return tickEnd;
}

/**
 * Matches a recognized inline math span starting at `index` (`\(...\)`,
 * `\[...\]`, `$$...$$`, or single-line `$...$`) with exact odd-backslash
 * guards, returning its exclusive end offset or `-1`. Uses `cache` to guarantee
 * strict O(N) performance on unclosed delimiters.
 */
function matchInlineMathEnd(
	text: string,
	index: number,
	isTableRow = false,
	cache?: InlineScanCache,
): number {
	const length = text.length;
	const ch = text[index] ?? "";

	if (
		ch === "\\" &&
		text[index + 1] === "(" &&
		!hasOddPrecedingBackslashes(text, index)
	) {
		if (cache && getLastCloseParenMath(text, cache) <= index + 2) {
			return -1;
		}
		for (let j = index + 2; j < length - 1; j += 1) {
			if (
				text[j] === "\\" &&
				text[j + 1] === ")" &&
				!hasOddPrecedingBackslashes(text, j)
			) {
				return j > index + 2 ? j + 2 : -1;
			}
		}
		return -1;
	}

	if (
		ch === "\\" &&
		text[index + 1] === "[" &&
		!hasOddPrecedingBackslashes(text, index)
	) {
		if (cache && getLastCloseBracketMath(text, cache) <= index + 2) {
			return -1;
		}
		for (let j = index + 2; j < length - 1; j += 1) {
			if (
				text[j] === "\\" &&
				text[j + 1] === "]" &&
				!hasOddPrecedingBackslashes(text, j)
			) {
				return j > index + 2 ? j + 2 : -1;
			}
		}
		return -1;
	}

	if (ch === "$" && !hasOddPrecedingBackslashes(text, index)) {
		if (text[index + 1] === "$") {
			if (cache && getLastCloseDoubleDollar(text, cache) <= index + 2) {
				return -1;
			}
			const closeDisplay = text.indexOf("$$", index + 2);
			return closeDisplay > index + 2 ? closeDisplay + 2 : -1;
		}
		const openFollow = text[index + 1] ?? "";
		if (openFollow.length > 0 && !/\s/.test(openFollow)) {
			if (cache) {
				if (index >= getLastUnescapedDollar(text, cache)) {
					return -1;
				}
				const noCloser = cache.noSingleDollarCloser;
				if (
					noCloser !== null &&
					noCloser.isTableRow === isTableRow &&
					index >= noCloser.minIndex &&
					index < noCloser.until
				) {
					return -1;
				}
			}
			for (let j = index + 1; j < length; j += 1) {
				const cur = text[j] ?? "";
				if (cur === "\n") {
					if (cache) {
						cache.noSingleDollarCloser = {
							isTableRow,
							minIndex: index,
							until: j,
						};
					}
					return -1;
				}
				if (
					isTableRow &&
					cur === "|" &&
					!hasOddPrecedingBackslashes(text, j)
				) {
					if (cache) {
						cache.noSingleDollarCloser = {
							isTableRow,
							minIndex: index,
							until: j,
						};
					}
					return -1;
				}
				if (cur !== "$" || hasOddPrecedingBackslashes(text, j)) {
					continue;
				}
				if (text[j + 1] === "$") {
					return -1;
				}
				const before = text[j - 1] ?? "";
				const after = text[j + 1] ?? "";
				if (/\s/.test(before) || /[0-9]/.test(after)) {
					return -1;
				}
				return j > index + 1 ? j + 1 : -1;
			}
			if (cache) {
				cache.noSingleDollarCloser = {
					isTableRow,
					minIndex: index,
					until: length,
				};
			}
		}
	}

	return -1;
}

/**
 * Canonical single-dispatch inline math / literal `$$` scanner shared by
 * `matchLeagueInlineHtml`, `extractInlineProtectedSyntaxChunk`, and
 * `stripInlineHtmlOutsideCode`.
 */
export function scanInlineMathOrDoubleDollar(
	text: string,
	index: number,
	isTableRow: boolean,
	cache?: InlineScanCache,
): InlineMathScanResult | null {
	const ch = text[index] ?? "";
	if (
		ch !== "$" &&
		!(ch === "\\" && (text[index + 1] === "(" || text[index + 1] === "["))
	) {
		return null;
	}
	const mathEnd = matchInlineMathEnd(text, index, isTableRow, cache);
	if (mathEnd > index) {
		return { end: mathEnd, kind: "math" };
	}
	// Empty `$$$$` or unclosed `$$` never starts a single-dollar scan.
	if (
		ch === "$" &&
		text[index + 1] === "$" &&
		!hasOddPrecedingBackslashes(text, index)
	) {
		return { end: index + 2, kind: "literal-double-dollar" };
	}
	return null;
}

/**
 * Scans a balanced link/image destination `]( ... )` starting at `index` (`]`),
 * returning the exclusive end offset or `-1`. Caches unmatched open paren
 * positions so repeated unclosed `](` runs stay strictly O(N).
 */
function scanBalancedLinkDestinationEnd(
	chunk: string,
	index: number,
	cache: InlineScanCache,
): number {
	const openPos = index + 1;
	if (
		openPos + 1 > getLastCloseParen(chunk, cache) ||
		cache.unmatchedLinkParenOpens?.has(openPos)
	) {
		return -1;
	}
	const length = chunk.length;
	const openPositions = [openPos];
	let cursor = openPos + 1;
	while (cursor < length && openPositions.length > 0) {
		const cur = chunk[cursor] ?? "";
		if (cur === "\\") {
			cursor += 2;
			continue;
		}
		if (cur === "(") {
			openPositions.push(cursor);
		} else if (cur === ")") {
			openPositions.pop();
		}
		cursor += 1;
	}
	if (openPositions.length === 0) {
		return cursor;
	}
	let unmatched = cache.unmatchedLinkParenOpens;
	if (!unmatched) {
		unmatched = new Set<number>();
		cache.unmatchedLinkParenOpens = unmatched;
	}
	for (let k = 0; k < openPositions.length; k += 1) {
		const pos = openPositions[k];
		if (pos !== undefined) unmatched.add(pos);
	}
	return -1;
}

/**
 * Matches a valid League CommonMark 2.8.2 inline HTML token at `start` (via
 * `matchLeagueHtmlInlineAt()`, preserving exact case-sensitive tag/attribute
 * rules) without crossing unescaped GFM table cell pipes. For non-self-closing
 * open tags in `PAIRED_INLINE_HTML_TAGS`, scans forward with a strict O(N)
 * unmatched-start set to capture the balanced paired span (supporting nested
 * inline tags, math spans, and inline Markdown); otherwise returns the single
 * matched HTML token.
 */
function matchLeagueInlineHtml(
	line: string,
	start: number,
	isTableRow: boolean,
	cache: InlineScanCache,
): string | null {
	const length = line.length;
	const tokenEnd = matchLeagueHtmlInlineAt(
		line,
		start + 1,
		length,
		cache.angleCache,
		cache.htmlDialect,
	);
	if (tokenEnd <= start) return null;
	const initialToken = line.slice(start, tokenEnd);
	if (isTableRow && hasUnescapedPipe(initialToken)) return null;

	const classified = classifyLeagueHtmlToken(line, start, tokenEnd);
	if (
		classified.kind !== "open" ||
		!PAIRED_INLINE_HTML_TAGS.has(classified.tagName)
	) {
		return initialToken;
	}
	const targetTag = classified.tagName;
	if (cache.unclosedTagStarts.has(start)) {
		return initialToken;
	}

	const openPositions = [start];
	let cursor = tokenEnd;
	while (cursor < length) {
		const ch = line[cursor] ?? "";
		if (ch === "`" && !hasOddPrecedingBackslashes(line, cursor)) {
			const codeEnd = skipInlineCodeSpan(line, cursor, cache);
			if (isTableRow && hasUnescapedPipe(line.slice(cursor, codeEnd))) {
				break;
			}
			cursor = codeEnd;
			continue;
		}
		if (isTableRow && ch === "|" && !hasOddPrecedingBackslashes(line, cursor)) {
			break;
		}
		const mathScan = scanInlineMathOrDoubleDollar(
			line,
			cursor,
			isTableRow,
			cache,
		);
		if (mathScan) {
			if (
				mathScan.kind === "math" &&
				isTableRow &&
				hasUnescapedPipe(line.slice(cursor, mathScan.end))
			) {
				break;
			}
			cursor = mathScan.end;
			continue;
		}
		if (ch === "<" && !hasOddPrecedingBackslashes(line, cursor)) {
			const nestedEnd = matchLeagueHtmlInlineAt(
				line,
				cursor + 1,
				length,
				cache.angleCache,
				cache.htmlDialect,
			);
			if (nestedEnd > cursor) {
				if (isTableRow && hasUnescapedPipe(line.slice(cursor, nestedEnd))) {
					break;
				}
				const nested = classifyLeagueHtmlToken(line, cursor, nestedEnd);
				if (nested.kind === "close" && nested.tagName === targetTag) {
					openPositions.pop();
					cursor = nestedEnd;
					if (openPositions.length === 0) {
						return line.slice(start, cursor);
					}
					continue;
				}
				if (nested.kind === "open" && nested.tagName === targetTag) {
					openPositions.push(cursor);
				}
				cursor = nestedEnd;
				continue;
			}
		}
		cursor += 1;
	}
	for (let k = 0; k < openPositions.length; k += 1) {
		const pos = openPositions[k];
		if (pos !== undefined) cache.unclosedTagStarts.add(pos);
	}
	// Unmatched tag (or split across table cell pipes): protect only the tag
	// itself so neighboring cells and inline text remain ordinary Markdown.
	return initialToken;
}

/**
 * Feature-private inline protected-syntax scanner for single-line or
 * soft-wrapped prose chunks. Preserves exact per-output-line original line
 * spans (`[startOffset, endOffset)`) when multiline inline HTML or math tokens
 * span soft line breaks.
 */
export function extractInlineProtectedSyntaxChunk(
	chunk: string,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	isTableRow: boolean,
	containerContext?: InlineContainerContext,
): PrescannedInlineLine[] {
	const emitted: PrescannedInlineLine[] = [];
	let currentOut = "";
	let currentStartLine = 0;
	let origLine = 0;
	let index = 0;
	const length = chunk.length;
	const cache = createInlineScanCache(chunk);

	const appendVerbatim = (slice: string): void => {
		if (!slice.includes("\n")) {
			currentOut += slice;
			return;
		}
		const parts = slice.split("\n");
		currentOut += parts[0] ?? "";
		emitted.push({
			endOffset: origLine + 1,
			startOffset: currentStartLine,
			text: currentOut,
		});
		for (let p = 1; p < parts.length - 1; p += 1) {
			origLine += 1;
			emitted.push({
				endOffset: origLine + 1,
				startOffset: origLine,
				text: parts[p] ?? "",
			});
		}
		origLine += 1;
		currentOut = parts[parts.length - 1] ?? "";
		currentStartLine = origLine;
	};

	const allocateToken = (
		kind: ProtectedInlineKind,
		rawMarkdown: string,
	): void => {
		const token = `${sentinel}INL${protectedInlines.size}END`;
		const newlineCount = countNewlines(rawMarkdown);
		let entry: ProtectedInlineEntry = { kind, rawMarkdown };
		if (
			kind === "raw-inline" &&
			newlineCount > 0 &&
			containerContext !== undefined
		) {
			const continuationPrefixes: string[] = [];
			let hasNonStandardPrefix = false;
			for (let offset = 1; offset <= newlineCount; offset += 1) {
				const linePrefix =
					containerContext.linePrefixes[origLine + offset] ?? "";
				continuationPrefixes.push(linePrefix);
				if (linePrefix !== containerContext.standardPrefix) {
					hasNonStandardPrefix = true;
				}
			}
			if (hasNonStandardPrefix) {
				entry = {
					containerSignature: containerContext.signature,
					continuationPrefixes,
					kind,
					rawMarkdown,
				};
			}
		}
		protectedInlines.set(token, entry);
		currentOut += token;
		origLine += newlineCount;
	};

	while (index < length) {
		const ch = chunk[index] ?? "";

		// Preserve inline code spans verbatim so math/footnotes inside backticks
		// stay literal and never allocate sentinels.
		if (ch === "`" && !hasOddPrecedingBackslashes(chunk, index)) {
			const codeEnd = skipInlineCodeSpan(chunk, index, cache);
			appendVerbatim(chunk.slice(index, codeEnd));
			index = codeEnd;
			continue;
		}

		// Link/image destinations and titles are never inline-protected here;
		// sentinels inside `(...)` would leak into ProseMirror attributes.
		if (
			ch === "]" &&
			chunk[index + 1] === "(" &&
			!hasOddPrecedingBackslashes(chunk, index)
		) {
			const destEnd = scanBalancedLinkDestinationEnd(chunk, index, cache);
			if (destEnd > index) {
				appendVerbatim(chunk.slice(index, destEnd));
				index = destEnd;
				continue;
			}
		}

		// GFM table cells: a literal `<br>` is a visual hard break, while an
		// escaped `\<br\>` stays literal text (matching TableCellBreakParser).
		if (isTableRow && ch === "<" && !hasOddPrecedingBackslashes(chunk, index)) {
			TABLE_BR_STICKY.lastIndex = index;
			const brMatch = TABLE_BR_STICKY.exec(chunk);
			if (brMatch) {
				currentOut += `${sentinel}BREND`;
				index += brMatch[0].length;
				continue;
			}
		}

		// Inline LaTeX math: \(...\), \[...\], $$...$$, and single-line $...$
		const mathScan = scanInlineMathOrDoubleDollar(
			chunk,
			index,
			isTableRow,
			cache,
		);
		if (mathScan) {
			if (mathScan.kind === "math") {
				allocateToken("math-inline", chunk.slice(index, mathScan.end));
			} else {
				currentOut += "$$";
			}
			index = mathScan.end;
			continue;
		}

		// Footnote reference: [^label]
		if (
			ch === "[" &&
			chunk[index + 1] === "^" &&
			!hasOddPrecedingBackslashes(chunk, index)
		) {
			FOOTNOTE_REF_STICKY.lastIndex = index;
			const match = FOOTNOTE_REF_STICKY.exec(chunk);
			if (match) {
				const afterChar = chunk[index + match[0].length];
				if (afterChar !== ":" && afterChar !== "(" && afterChar !== "[") {
					allocateToken("footnote-ref", match[0]);
					index += match[0].length;
					continue;
				}
			}
		}

		// Valid League CommonMark 2.8.2 inline HTML tokens (balanced paired tags
		// like `<u>text</u>`, `<u>*italic*</u>`, `<sub>2</sub>`, `<kbd>⌘</kbd>`,
		// plus any single open/close tag, HTML comment including `<!-->`/`<!--->`,
		// processing instruction, declaration, or `<![CDATA[...]]>`): preserve
		// verbatim as a protected inline atom without crossing table cell pipes or
		// projecting fake math atoms inside raw HTML attributes.
		if (ch === "<" && !hasOddPrecedingBackslashes(chunk, index)) {
			const matchedHtml = matchLeagueInlineHtml(
				chunk,
				index,
				isTableRow,
				cache,
			);
			if (matchedHtml !== null) {
				allocateToken("raw-inline", matchedHtml);
				index += matchedHtml.length;
				continue;
			}
		}

		if (ch === "\n") {
			emitted.push({
				endOffset: origLine + 1,
				startOffset: currentStartLine,
				text: currentOut,
			});
			origLine += 1;
			currentOut = "";
			currentStartLine = origLine;
		} else {
			currentOut += ch;
		}
		index += 1;
	}

	emitted.push({
		endOffset: origLine + 1,
		startOffset: currentStartLine,
		text: currentOut,
	});
	return emitted;
}

const INLINE_PROTECTED_TRIGGER = /[$\\<[]/;

/** Feature-private single-line inline protected-syntax scanner for the prescanner. */
export function extractInlineProtectedSyntax(
	line: string,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	isTableRow: boolean,
): string {
	if (!INLINE_PROTECTED_TRIGGER.test(line)) {
		return line;
	}
	return extractInlineProtectedSyntaxChunk(
		line,
		sentinel,
		protectedInlines,
		isTableRow,
	)
		.map((entry) => entry.text)
		.join("\n");
}
