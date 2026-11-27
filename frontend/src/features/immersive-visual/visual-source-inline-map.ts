import { markdownLanguage } from "@codemirror/lang-markdown";
import { decodeHTMLStrict } from "entities";
import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
	type BoundedBacktickIndex,
	findNextBacktickCloser,
	indexBoundedBacktickRuns,
} from "../../shared/markdown/markdown-backtick-scanners";
import { advanceMarkdownColumns } from "../../shared/markdown/markdown-char-codes";
import { isAsciiPunctCode } from "../../shared/markdown/markdown-link-destination";
import { hasOddPrecedingBackslashes } from "../../shared/markdown/markdown-source-projection";
import type {
	VisualSourceSegment,
	VisualSourceUnit,
} from "./visual-source-inner-maps";

/**
 * Inline lexical scanner, mark-transition delimiter consumer, code-span
 * mapper, and autolink-aware textblock mapper for the visual source index.
 */

type Range = { end: number; start: number };
type LexicalLinkSpan = Readonly<{ closePos: number; from: number; kind: "autolink" | "link"; to: number }>;
type InlineCtx = Readonly<{
	balancedCloseCache: Map<number, number>;
	getBacktickIndex: () => BoundedBacktickIndex | null;
	inCell: boolean;
	limit: number;
	linkSpans: ReadonlyMap<number, LexicalLinkSpan> | null;
	protectedRanges: readonly Range[];
	text: string;
}>;
type LinkRef = Readonly<{ isAutolink: boolean; openPos: number }>;
type LinkState = Readonly<{ cursor: number; link: LinkRef }>;
type NonCodeMarkName = "em" | "link" | "strike" | "strong";
type EmphasisMarkName = "em" | "strike" | "strong";
type MatchedInlineUnit = Readonly<{ link: LinkRef; mdEnd: number; mdStart: number; nextCursor: number; pmSize: number }>;
type NonCodeMatch =
	| Readonly<{ matched: true; mdEnd: number; mdStart: number; pmSize: number }>
	| Readonly<{ matched: false; nextScan: number }>;

export type VisualSourceMapResult = Readonly<{ cursor: number; segment: VisualSourceSegment }>;

const NO_LINK: LinkRef = { isAutolink: false, openPos: -1 };

const LIST_MARKER_PATTERN =
	/(?:[-+*]|\d{1,9}[.)])(?=[ \t]|\n|$)[ \t]*(?:\[[ xX]\][ \t]+)?/y;
const ATX_MARKER_PATTERN = /#{1,6}(?:[ \t]+|(?=\n)|$)/y;
const CLOSING_MARKUP_PATTERN = /^[*_~`\]\s]*$/;
const HTML_ENTITY_STICKY =
	/&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});/iy;
const CELL_HARD_BREAK_PATTERN = /<br[ \t]*\/?>/gi;
const NON_CODE_MARK_NAMES: readonly NonCodeMarkName[] = ["strong", "strike", "em", "link"];
const EMPHASIS_MARK_NAMES: readonly EmphasisMarkName[] = ["strong", "strike", "em"];

function matchHtmlEntity(text: string, pos: number, limit: number): Readonly<{ decoded: string; end: number }> | null {
	if (text[pos] !== "&") return null;
	HTML_ENTITY_STICKY.lastIndex = pos;
	const match = HTML_ENTITY_STICKY.exec(text);
	if (!match || pos + match[0].length > limit) return null;
	const raw = match[0];
	const decoded = decodeHTMLStrict(raw);
	return decoded !== raw && decoded.length > 0 ? { decoded, end: pos + raw.length } : null;
}

function skipLineContinuationPrefix(text: string, from: number, limit: number): number {
	let cursor = from;
	while (cursor < limit && (text[cursor] === " " || text[cursor] === "\t" || text[cursor] === ">")) cursor += 1;
	return cursor;
}

export function lineEndAt(text: string, from: number, limit: number): number {
	const nl = text.indexOf("\n", from);
	return nl < 0 || nl > limit ? limit : nl;
}

export function skipContainerPrefix(text: string, from: number, limit: number): number {
	let cursor = from;
	while (cursor < limit) {
		const ch = text[cursor];
		if (ch === " " || ch === "\t" || ch === "\n" || ch === ">") {
			cursor += 1;
			continue;
		}
		LIST_MARKER_PATTERN.lastIndex = cursor;
		const marker = LIST_MARKER_PATTERN.exec(text);
		if (marker && marker[0].length > 0 && cursor + marker[0].length <= limit) {
			cursor += marker[0].length;
			continue;
		}
		break;
	}
	return cursor;
}

function skipQuoted(text: string, from: number, limit: number, quote: string): number {
	for (let i = from + 1; i < limit; ) {
		if (text[i] === "\\") i += 2;
		else if (text[i] === quote) return i + 1;
		else i += 1;
	}
	return limit;
}

/** Given the position of a closing `]`, returns the end of its link tail. */
function scanLinkTail(text: string, closeBracket: number, limit: number): number {
	const next = closeBracket + 1;
	if (text[next] === "(") {
		let depth = 1;
		for (let i = next + 1; i < limit; ) {
			const ch = text[i];
			if (ch === "\\") i += 2;
			else if (ch === "<") {
				const close = text.indexOf(">", i);
				i = close >= 0 && close < limit ? close + 1 : i + 1;
			} else if (ch === '"' || ch === "'") {
				i = skipQuoted(text, i, limit, ch);
			} else {
				if (ch === "(") depth += 1;
				else if (ch === ")" && --depth === 0) return i + 1;
				i += 1;
			}
		}
		return limit;
	}
	if (text[next] === "[") {
		for (let i = next + 1; i < limit; ) {
			if (text[i] === "\\") i += 2;
			else if (text[i] === "]") return i + 1;
			else i += 1;
		}
	}
	return next;
}

function skipLinkTail(text: string, cursor: number, limit: number): number {
	const close = text.indexOf("]", cursor);
	if (close < 0 || close >= limit || !CLOSING_MARKUP_PATTERN.test(text.slice(cursor, close))) {
		return cursor;
	}
	return scanLinkTail(text, close, limit);
}

function skipEmptyLink(text: string, pos: number, limit: number): number {
	if (text[pos] !== "[" || pos + 1 >= limit || text[pos + 1] !== "]") return pos;
	const afterEmpty = scanLinkTail(text, pos + 1, limit);
	return afterEmpty > pos + 2 ? afterEmpty : pos;
}

/** Lazily extracts Lezer lexical `Autolink` and `Link` spans. */
function extractLexicalLinkSpans(text: string, from: number, limit: number): Map<number, LexicalLinkSpan> {
	const spans = new Map<number, LexicalLinkSpan>();
	if (from >= limit) return spans;
	const slice = text.slice(from, limit);
	markdownLanguage.parser.parse(slice).iterate({
		enter(nodeRef) {
			const absFrom = from + nodeRef.from;
			const absTo = from + nodeRef.to;
			if (nodeRef.name === "Autolink") {
				spans.set(absFrom, { closePos: absTo - 1, from: absFrom, kind: "autolink", to: absTo });
				return false;
			}
			if (nodeRef.name === "Link") {
				for (let child = nodeRef.node.firstChild; child !== null; child = child.nextSibling) {
					if (child.name === "LinkMark" && slice[child.from] === "]") {
						spans.set(absFrom, { closePos: from + child.from, from: absFrom, kind: "link", to: absTo });
						break;
					}
				}
				return false;
			}
			if (nodeRef.name === "Image") return false;
			return undefined;
		},
	});
	return spans;
}

/** Finds the matching closing `]` for a `[` link opener, honoring escapes, code spans, images, and protected atoms. */
function findBalancedLinkClose(ctx: InlineCtx, openPos: number): number {
	const cached = ctx.balancedCloseCache.get(openPos);
	if (cached !== undefined) return cached;
	const { limit, protectedRanges, text } = ctx;
	let result = -1;
	if (openPos >= 0 && openPos < limit && text[openPos] === "[") {
		const stack: boolean[] = [false];
		let protIdx = 0;
		while (protIdx < protectedRanges.length && (protectedRanges[protIdx] as Range).end <= openPos) protIdx += 1;
		for (let i = openPos + 1; i < limit; ) {
			const prot = protectedRanges[protIdx];
			if (prot && i >= prot.start && i < prot.end) {
				i = prot.end;
				protIdx += 1;
				continue;
			}
			const ch = text[i];
			if (ch === "\\") i += i + 1 < limit && isAsciiPunctCode(text.charCodeAt(i + 1)) ? 2 : 1;
			else if (ch === "`") {
				let tickLen = 0;
				while (i + tickLen < limit && text[i + tickLen] === "`") tickLen += 1;
				const bounds = findCodeSpanBounds(text, i, limit);
				i = bounds ? bounds.closeEnd : i + tickLen;
			} else if (ch === "!" && i + 1 < limit && text[i + 1] === "[") {
				stack.push(true);
				i += 2;
			} else if (ch === "[") {
				stack.push(false);
				i += 1;
			} else if (ch === "]") {
				const wasImage = stack.pop();
				if (stack.length === 0) {
					result = i;
					break;
				}
				const tailEnd = wasImage && text[i + 1] === "(" ? scanLinkTail(text, i, limit) : -1;
				i = tailEnd > i + 2 && text[tailEnd - 1] === ")" ? tailEnd : i + 1;
			} else i += 1;
		}
	}
	ctx.balancedCloseCache.set(openPos, result);
	return result;
}

function getTrustedLinkSpan(ctx: InlineCtx, openPos: number, kind: "autolink" | "link"): LexicalLinkSpan | undefined {
	if (openPos < 0 || (kind === "link" && ctx.protectedRanges.length > 0)) return undefined;
	const span = ctx.linkSpans?.get(openPos);
	return span?.kind === kind ? span : undefined;
}

function resolveExpectedLinkClose(ctx: InlineCtx, openPos: number): number {
	return openPos < 0 ? -1 : (getTrustedLinkSpan(ctx, openPos, "link")?.closePos ?? findBalancedLinkClose(ctx, openPos));
}

function resolveAutolinkClose(ctx: InlineCtx, openPos: number, cursor: number): number {
	const span = getTrustedLinkSpan(ctx, openPos, "autolink");
	if (span && span.closePos >= cursor && span.closePos < ctx.limit) return span.closePos;
	const closeGt = ctx.text.indexOf(">", cursor);
	return closeGt >= 0 && closeGt < ctx.limit ? closeGt : -1;
}

/** Verifies `closePos` ends `link` and returns its tail end, or -1. */
function resolveVerifiedLinkEnd(ctx: InlineCtx, link: LinkRef, closePos: number): number {
	const { limit, text } = ctx;
	if (closePos >= limit) return -1;
	if (link.isAutolink) {
		if (text[closePos] !== ">") return -1;
		if (link.openPos < 0) return closePos + 1;
		const span = getTrustedLinkSpan(ctx, link.openPos, "autolink");
		return span ? (closePos === span.closePos ? span.to : -1) : text.indexOf(">", link.openPos + 1) === closePos ? closePos + 1 : -1;
	}
	if (text[closePos] !== "]") return -1;
	if (link.openPos < 0) return scanLinkTail(text, closePos, limit);
	const span = getTrustedLinkSpan(ctx, link.openPos, "link");
	if (span) return closePos === span.closePos ? span.to : -1;
	return findBalancedLinkClose(ctx, link.openPos) === closePos ? scanLinkTail(text, closePos, limit) : -1;
}

function isVerifiedLinkOpener(ctx: InlineCtx, pos: number): boolean {
	const { limit, linkSpans, text } = ctx;
	if (pos >= limit) return false;
	const ch = text[pos];
	if (ch === "<") {
		if (linkSpans) return linkSpans.get(pos)?.kind === "autolink";
		const closeGt = text.indexOf(">", pos + 1);
		return closeGt > pos + 1 && closeGt < limit;
	}
	return ch === "[" && (getTrustedLinkSpan(ctx, pos, "link") !== undefined || findBalancedLinkClose(ctx, pos) > pos);
}

function findImage(ctx: InlineCtx, cursor: number): Range | null {
	const { limit, text } = ctx;
	let start = -1;
	for (let search = cursor; search < limit; ) {
		const idx = text.indexOf("![", search);
		if (idx < 0 || idx >= limit) return null;
		if (!hasOddPrecedingBackslashes(text, idx, cursor)) {
			start = idx;
			break;
		}
		search = idx + 2;
	}
	if (start < 0) return null;
	let depth = 1;
	let i = start + 2;
	while (i < limit) {
		if (text[i] === "\\") i += 2;
		else if (text[i] === "[") { depth += 1; i += 1; }
		else if (text[i] === "]" && --depth === 0) break;
		else i += 1;
	}
	return i < limit ? { end: scanLinkTail(text, i, limit), start } : null;
}

function findHardBreak(ctx: InlineCtx, cursor: number): Range | null {
	const { inCell, limit, text } = ctx;
	if (inCell) {
		CELL_HARD_BREAK_PATTERN.lastIndex = cursor;
		let match = CELL_HARD_BREAK_PATTERN.exec(text);
		while (match !== null && match.index < limit) {
			if (!hasOddPrecedingBackslashes(text, match.index, cursor)) {
				return { end: Math.min(match.index + match[0].length, limit), start: match.index };
			}
			match = CELL_HARD_BREAK_PATTERN.exec(text);
		}
		return null;
	}
	const nl = text.indexOf("\n", cursor);
	if (nl < 0 || nl >= limit) {
		return text[cursor] === " " ? { end: cursor + 1, start: cursor } : null;
	}
	let start = nl;
	if (text[nl - 1] === "\\") start = nl - 1;
	else while (start > cursor && text[start - 1] === " ") start -= 1;
	return { end: nl + 1, start };
}

function findNonCodeMark(marks: readonly Mark[], name: NonCodeMarkName): Mark | null {
	return marks.find((mark) => mark.type.name === name) ?? null;
}

function matchEmphasisDelimiter(text: string, cursor: number, limit: number, mark: EmphasisMarkName): number {
	const ch = text[cursor];
	if (mark === "strong") {
		return cursor + 2 <= limit && (ch === "*" || ch === "_") && text[cursor + 1] === ch ? 2 : 0;
	}
	if (mark === "strike") {
		return cursor + 2 <= limit && ch === "~" && text[cursor + 1] === "~" ? 2 : 0;
	}
	return cursor < limit && (ch === "*" || ch === "_") ? 1 : 0;
}

function matchNextEmphasis(
	text: string,
	cursor: number,
	limit: number,
	candidates: readonly NonCodeMarkName[],
	consumed: ReadonlySet<NonCodeMarkName>,
): Readonly<{ len: number; mark: EmphasisMarkName }> | null {
	for (const name of EMPHASIS_MARK_NAMES) {
		if (consumed.has(name) || !candidates.includes(name)) continue;
		const len = matchEmphasisDelimiter(text, cursor, limit, name);
		if (len > 0) return { len, mark: name };
	}
	return null;
}

function matchActiveEmphasis(text: string, scan: number, limit: number, active: readonly EmphasisMarkName[]): number {
	for (const name of active) {
		const len = matchEmphasisDelimiter(text, scan, limit, name);
		if (len > 0) return len;
	}
	return 0;
}

function consumeClosingMarks(
	ctx: InlineCtx,
	from: number,
	closedMarks: readonly NonCodeMarkName[],
	continuingEmphasis: readonly EmphasisMarkName[],
	activeLink: LinkRef,
): Readonly<{ cursor: number; link: LinkRef; reopenedMarks: NonCodeMarkName[] }> {
	const { limit, text } = ctx;
	let cursor = from;
	const consumed = new Set<NonCodeMarkName>();
	const reopenedMarks: NonCodeMarkName[] = [];
	let link = activeLink;
	const closesLink = closedMarks.includes("link");

	while (consumed.size < closedMarks.length && cursor < limit) {
		const emph = matchNextEmphasis(text, cursor, limit, closedMarks, consumed);
		if (emph) {
			cursor += emph.len;
			consumed.add(emph.mark);
			continue;
		}
		if (!closesLink || consumed.has("link")) break;
		const directLinkEnd = resolveVerifiedLinkEnd(ctx, link, cursor);
		if (directLinkEnd > cursor) {
			cursor = directLinkEnd;
			link = NO_LINK;
			consumed.add("link");
			continue;
		}
		if (!link.isAutolink && continuingEmphasis.length > 0) {
			const close = link.openPos >= 0 ? resolveExpectedLinkClose(ctx, link.openPos) : text.indexOf("]", cursor);
			if (close > cursor && close < limit && CLOSING_MARKUP_PATTERN.test(text.slice(cursor, close))) {
				let scan = cursor;
				const closedInside = new Set<EmphasisMarkName>();
				while (scan < close) {
					const inner = matchNextEmphasis(text, scan, close, continuingEmphasis, closedInside);
					if (!inner) break;
					scan += inner.len;
					closedInside.add(inner.mark);
				}
				const linkEnd = scan === close && closedInside.size > 0 ? resolveVerifiedLinkEnd(ctx, link, close) : -1;
				if (linkEnd > close) {
					cursor = linkEnd;
					link = NO_LINK;
					consumed.add("link");
					reopenedMarks.push(...closedInside);
					continue;
				}
			}
		}
		break;
	}

	if (closesLink && !consumed.has("link")) {
		if (link.isAutolink) {
			const closeGt = resolveAutolinkClose(ctx, link.openPos, cursor);
			if (closeGt >= 0) cursor = closeGt + 1;
		} else {
			const expected = resolveExpectedLinkClose(ctx, link.openPos);
			const verified =
				expected >= cursor && expected < limit && CLOSING_MARKUP_PATTERN.test(text.slice(cursor, expected))
					? resolveVerifiedLinkEnd(ctx, link, expected)
					: -1;
			cursor = verified > cursor ? verified : skipLinkTail(text, cursor, limit);
		}
	}
	return { cursor, link: closesLink ? NO_LINK : link, reopenedMarks };
}

function consumeOpeningMarks(
	ctx: InlineCtx,
	from: number,
	openedMarks: readonly NonCodeMarkName[],
	activeLink: LinkRef,
	verifyLinkOpener = false,
): Readonly<{ consumed: number; cursor: number; link: LinkRef }> {
	const { limit, text } = ctx;
	let cursor = from;
	const consumed = new Set<NonCodeMarkName>();
	let link = activeLink;
	const opensLink = openedMarks.includes("link");

	while (consumed.size < openedMarks.length && cursor < limit) {
		if (opensLink && !consumed.has("link")) {
			const afterEmpty = skipEmptyLink(text, cursor, limit);
			if (afterEmpty > cursor) {
				cursor = afterEmpty;
				continue;
			}
			if ((text[cursor] === "[" || text[cursor] === "<") && (!verifyLinkOpener || isVerifiedLinkOpener(ctx, cursor))) {
				link = { isAutolink: text[cursor] === "<", openPos: cursor };
				cursor += 1;
				consumed.add("link");
				if (link.isAutolink) break;
				continue;
			}
		}
		const emph = matchNextEmphasis(text, cursor, limit, openedMarks, consumed);
		if (!emph) break;
		cursor += emph.len;
		consumed.add(emph.mark);
	}
	return { consumed: consumed.size, cursor, link };
}

/**
 * Consumes a lexical link close + intervening emphasis delimiters + next link
 * open when two separate Markdown links share an equal ProseMirror `link` mark.
 */
function consumeSameLinkBoundary(
	ctx: InlineCtx,
	from: number,
	closedEmphasis: readonly EmphasisMarkName[],
	openedEmphasis: readonly EmphasisMarkName[],
	continuingEmphasis: readonly EmphasisMarkName[],
	link: LinkRef,
): LinkState | null {
	const { limit, text } = ctx;
	let cursor = from;
	const baseClosed = new Set<EmphasisMarkName>();
	const baseReopened = new Set<EmphasisMarkName>();

	if (!link.isAutolink) {
		const closableInside: readonly EmphasisMarkName[] = [...closedEmphasis, ...continuingEmphasis];
		while (cursor < limit && text[cursor] !== "]") {
			const emph = matchNextEmphasis(text, cursor, limit, closableInside, baseClosed);
			if (!emph) break;
			cursor += emph.len;
			baseClosed.add(emph.mark);
			if (!closedEmphasis.includes(emph.mark)) baseReopened.add(emph.mark);
		}
	}
	const linkEnd = resolveVerifiedLinkEnd(ctx, link, cursor);
	if (linkEnd < 0) return null;
	cursor = linkEnd;

	const tryOpenNext = (
		pos: number,
		closed: ReadonlySet<EmphasisMarkName>,
		reopened: ReadonlySet<EmphasisMarkName>,
	): LinkState | null => {
		if (closedEmphasis.some((mark) => !closed.has(mark))) return null;
		const required: NonCodeMarkName[] = [...openedEmphasis];
		for (const mark of reopened) {
			if (!required.includes(mark)) required.push(mark);
		}
		required.push("link");
		const opened = consumeOpeningMarks(ctx, pos, required, NO_LINK, true);
		return opened.consumed === required.length ? { cursor: opened.cursor, link: opened.link } : null;
	};

	const runOutsideClose = (allowContinuing: boolean): LinkState | null => {
		let scan = cursor;
		const closed = new Set(baseClosed);
		const reopened = new Set(baseReopened);
		const candidates: readonly EmphasisMarkName[] = allowContinuing
			? [...closedEmphasis, ...continuingEmphasis]
			: closedEmphasis;

		while (scan < limit) {
			const afterEmpty = skipEmptyLink(text, scan, limit);
			if (afterEmpty > scan) {
				scan = afterEmpty;
			} else {
				const emph = matchNextEmphasis(text, scan, limit, candidates, closed);
				if (!emph) break;
				scan += emph.len;
				closed.add(emph.mark);
				if (!closedEmphasis.includes(emph.mark)) reopened.add(emph.mark);
			}
			if (allowContinuing) {
				const hit = tryOpenNext(scan, closed, reopened);
				if (hit) return hit;
			}
		}
		return allowContinuing ? null : tryOpenNext(scan, closed, reopened);
	};

	return runOutsideClose(false) ?? (continuingEmphasis.length > 0 ? runOutsideClose(true) : null);
}

function findCodeSpanBounds(
	text: string,
	from: number,
	limit: number,
): Readonly<{ closeEnd: number; innerEnd: number; innerStart: number }> | null {
	let tickStart = -1;
	for (let scan = from; scan < limit; ) {
		if (text[scan] === "\\" && scan + 1 < limit && isAsciiPunctCode(text.charCodeAt(scan + 1))) scan += 2;
		else if (text[scan] === "`") {
			tickStart = scan;
			break;
		} else scan += 1;
	}
	if (tickStart < 0) return null;

	let tickLen = 0;
	while (tickStart + tickLen < limit && text[tickStart + tickLen] === "`") tickLen += 1;
	const rawStart = tickStart + tickLen;
	let closeStart = -1;
	for (let scan = rawStart; scan < limit; ) {
		if (text[scan] === "`") {
			let run = 0;
			while (scan + run < limit && text[scan + run] === "`") run += 1;
			if (run === tickLen) {
				closeStart = scan;
				break;
			}
			scan += run;
		} else scan += 1;
	}
	if (closeStart < 0) return null;

	let innerStart = rawStart;
	let innerEnd = closeStart;
	// CommonMark §6.1: line endings convert to spaces, and if the code span
	// begins and ends with a space and is not all spaces, strip one from each end.
	if (
		innerEnd - innerStart >= 2 &&
		(text[innerStart] === " " || text[innerStart] === "\n") &&
		(text[innerEnd - 1] === " " || text[innerEnd - 1] === "\n")
	) {
		for (let k = innerStart; k < innerEnd; k += 1) {
			if (text[k] !== " " && text[k] !== "\n") {
				innerStart += 1;
				innerEnd -= 1;
				break;
			}
		}
	}
	return { closeEnd: closeStart + tickLen, innerEnd, innerStart };
}

function matchLiteralCharAt(
	text: string,
	ch: string,
	pos: number,
	limit: number,
	inCell: boolean,
	mapNewlineToSpace: boolean,
): Range | null {
	if (pos >= limit) return null;
	if (inCell && ch === "|" && text[pos] === "\\" && pos + 1 < limit && text[pos + 1] === "|") {
		return { end: pos + 2, start: pos };
	}
	return text[pos] === ch || (mapNewlineToSpace && ch === " " && text[pos] === "\n")
		? { end: pos + 1, start: pos }
		: null;
}

function mapCodeSpanChild(
	ctx: InlineCtx,
	value: string,
	pmPos: number,
	from: number,
	units: VisualSourceUnit[],
): number {
	const bounds = findCodeSpanBounds(ctx.text, from, ctx.limit);
	const innerEnd = bounds ? bounds.innerEnd : ctx.limit;
	let codeCursor = bounds ? bounds.innerStart : from;

	for (let i = 0; i < value.length; i += 1) {
		const ch = value[i] as string;
		let matched: Range | null = null;
		for (let scan = codeCursor; !matched && scan < innerEnd; scan += 1) {
			matched = matchLiteralCharAt(ctx.text, ch, scan, innerEnd, ctx.inCell, true);
		}
		const resolved = matched ?? { end: codeCursor, start: codeCursor };
		units.push({ atom: null, mdEnd: resolved.end, mdStart: resolved.start, pmPos: pmPos + i, pmSize: 1 });
		if (matched) codeCursor = matched.end;
	}
	return bounds ? bounds.closeEnd : codeCursor;
}

function matchNonCodeAt(text: string, value: string, valueIndex: number, pos: number, limit: number): NonCodeMatch {
	const ch = value[valueIndex] as string;
	const current = text[pos];
	if (current === "\\") {
		if (pos + 1 < limit && isAsciiPunctCode(text.charCodeAt(pos + 1))) {
			return text[pos + 1] === ch
				? { matched: true, mdEnd: pos + 2, mdStart: pos, pmSize: 1 }
				: { matched: false, nextScan: pos + 2 };
		}
		return ch === "\\"
			? { matched: true, mdEnd: pos + 1, mdStart: pos, pmSize: 1 }
			: { matched: false, nextScan: pos + 1 };
	}
	if (current === "&") {
		const entity = matchHtmlEntity(text, pos, limit);
		if (entity !== null) {
			return value.startsWith(entity.decoded, valueIndex)
				? { matched: true, mdEnd: entity.end, mdStart: pos, pmSize: entity.decoded.length }
				: { matched: false, nextScan: entity.end };
		}
		return ch === "&"
			? { matched: true, mdEnd: pos + 1, mdStart: pos, pmSize: 1 }
			: { matched: false, nextScan: pos + 1 };
	}
	return current === ch
		? { matched: true, mdEnd: pos + 1, mdStart: pos, pmSize: 1 }
		: { matched: false, nextScan: pos + 1 };
}

/**
 * CommonMark §6.5 autolinks keep HTML entities and backslash escapes literal
 * and end strictly at the first closing `>`.
 */
function findAutolinkUnit(
	ctx: InlineCtx,
	value: string,
	valueIndex: number,
	cursor: number,
	activeMarks: readonly Mark[],
	link: LinkRef,
): MatchedInlineUnit | null {
	const { inCell, limit, text } = ctx;
	if (cursor >= limit) return null;
	const closeGt = resolveAutolinkClose(ctx, link.openPos, cursor);
	const autolinkEnd = closeGt >= 0 ? closeGt : limit;
	if (cursor === autolinkEnd && text[cursor] === ">") {
		const activeEmphasis = EMPHASIS_MARK_NAMES.filter((name) => findNonCodeMark(activeMarks, name) !== null);
		const boundary = consumeSameLinkBoundary(ctx, cursor, [], [], activeEmphasis, link);
		return boundary ? findNonCodeUnit(ctx, value, valueIndex, boundary.cursor, activeMarks, boundary.link) : null;
	}
	const ch = value[valueIndex] as string;
	for (let scan = cursor; scan < autolinkEnd; scan += 1) {
		const matched = matchLiteralCharAt(text, ch, scan, autolinkEnd, inCell, false);
		if (matched) return { link, mdEnd: matched.end, mdStart: matched.start, nextCursor: matched.end, pmSize: 1 };
	}
	return null;
}

function findNonCodeUnit(
	ctx: InlineCtx,
	value: string,
	valueIndex: number,
	cursor: number,
	activeMarks: readonly Mark[],
	link: LinkRef,
): MatchedInlineUnit | null {
	const { inCell, limit, text } = ctx;
	if (cursor >= limit) return null;
	if (link.isAutolink) return findAutolinkUnit(ctx, value, valueIndex, cursor, activeMarks, link);
	const ch = value[valueIndex] as string;
	if (ch === "\n") {
		const nl = text.indexOf("\n", cursor);
		if (nl < 0 || nl >= limit) return null;
		const nextCursor = inCell ? nl + 1 : skipLineContinuationPrefix(text, nl + 1, limit);
		return { link, mdEnd: nl + 1, mdStart: nl, nextCursor, pmSize: 1 };
	}

	const activeEmphasis = EMPHASIS_MARK_NAMES.filter((name) => findNonCodeMark(activeMarks, name) !== null);
	const hasLink = findNonCodeMark(activeMarks, "link") !== null;

	for (let scan = cursor; scan < limit; ) {
		if (hasLink) {
			const boundary = consumeSameLinkBoundary(ctx, scan, [], [], activeEmphasis, link);
			if (boundary) return findNonCodeUnit(ctx, value, valueIndex, boundary.cursor, activeMarks, boundary.link);
		}
		const afterEmpty = skipEmptyLink(text, scan, limit);
		if (afterEmpty > scan) { scan = afterEmpty; continue; }
		if (scan > cursor) {
			const skippedDelim = matchActiveEmphasis(text, scan, limit, activeEmphasis);
			if (skippedDelim > 0) { scan += skippedDelim; continue; }
		}
		const probe = matchNonCodeAt(text, value, valueIndex, scan, limit);
		if (probe.matched) {
			return { link, mdEnd: probe.mdEnd, mdStart: probe.mdStart, nextCursor: probe.mdEnd, pmSize: probe.pmSize };
		}
		if (scan === cursor) {
			const skippedDelim = matchActiveEmphasis(text, scan, limit, activeEmphasis);
			if (skippedDelim > 0) { scan += skippedDelim; continue; }
		}
		scan = probe.nextScan;
	}

	if ((ch === " " || ch === "\t") && text[cursor] !== undefined && /\s/.test(text[cursor] as string)) {
		return { link, mdEnd: cursor + 1, mdStart: cursor, nextCursor: cursor + 1, pmSize: 1 };
	}
	return null;
}

/**
 * Locates a protected inline atom's `rawMarkdown` inside `[from, limit)`,
 * matching across soft line breaks whose continuation lines in canonical source
 * may carry container prefixes (list indentation and/or blockquote `>` markers)
 * with exact 4-column CommonMark tab expansion.
 */
function matchContinuationLine(text: string, pos: number, limit: number, expected: string): number {
	if (pos + expected.length <= limit && text.startsWith(expected, pos)) return pos + expected.length;
	let leadLen = 0;
	while (leadLen < expected.length && (expected[leadLen] === " " || expected[leadLen] === "\t")) leadLen += 1;
	const expectedLead = expected.slice(0, leadLen);
	const core = expected.slice(leadLen);
	const coreStartsWithQuote = core.length > 0 && core[0] === ">";
	let p = pos;
	let col = 0;
	let hasQuoteBefore = false;
	let wsStart = pos;
	let colAtWsStart = 0;
	const leadFitsAt = (atPos: number, colAtPos: number): boolean =>
		advanceMarkdownColumns(expectedLead, hasQuoteBefore && wsStart < atPos ? colAtWsStart + 1 : colAtWsStart) <= colAtPos;

	while (p < limit) {
		const ch = text[p];
		if (coreStartsWithQuote && ch === ">" && p + core.length <= limit && text.startsWith(core, p) && leadFitsAt(p, col)) {
			return p + core.length;
		}
		if (ch === " ") { col += 1; p += 1; }
		else if (ch === "\t") { col += 4 - (col % 4); p += 1; }
		else if (ch === ">") { col += 1; p += 1; hasQuoteBefore = true; wsStart = p; colAtWsStart = col; }
		else break;
	}
	if (core.length === 0) return leadFitsAt(p, col) ? p : -1;
	if (coreStartsWithQuote) return -1;
	return p + core.length <= limit && text.startsWith(core, p) && leadFitsAt(p, col) ? p + core.length : -1;
}

function findProtectedInlineRange(
	text: string, raw: string, from: number, limit: number, inCell: boolean,
	getBacktickIndex: () => BoundedBacktickIndex | null,
): Range | null {
	if (raw.length === 0 || from >= limit) return null;
	if (inCell || !raw.includes("\n")) {
		const found = text.indexOf(raw, from);
		return found >= 0 && found + raw.length <= limit ? { end: found + raw.length, start: found } : null;
	}
	const lines = raw.split("\n");
	const firstLine = lines[0] ?? "";
	const backticks = getBacktickIndex();
	let runIdx = 0;
	if (backticks) {
		let lo = 0;
		let hi = backticks.runStarts.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if ((backticks.runStarts[mid] ?? limit) < from) lo = mid + 1;
			else hi = mid;
		}
		runIdx = lo;
	}

	for (let searchFrom = from; searchFrom < limit; ) {
		const start = firstLine.length > 0 ? text.indexOf(firstLine, searchFrom) : searchFrom;
		if (start < 0 || start + firstLine.length > limit) return null;
		let skippedIntoCodeSpan = false;
		if (backticks) {
			const { buckets, runEnds, runStarts } = backticks;
			while (runIdx < runStarts.length && (runStarts[runIdx] ?? limit) < start) {
				const runStart = runStarts[runIdx] as number;
				const runEnd = runEnds[runIdx] as number;
				runIdx += 1;
				if (hasOddPrecedingBackslashes(text, runStart)) continue;
				const runLen = runEnd - runStart;
				const closeStart = findNextBacktickCloser(buckets, runLen, runEnd, true);
				if (closeStart >= 0 && closeStart + runLen <= limit) {
					const codeEnd = closeStart + runLen;
					while (runIdx < runStarts.length && (runStarts[runIdx] ?? limit) < codeEnd) runIdx += 1;
					if (codeEnd > start) { searchFrom = codeEnd; skippedIntoCodeSpan = true; break; }
				}
			}
		}
		if (skippedIntoCodeSpan) continue;
		let pos = start + firstLine.length;
		let matched = true;
		for (let k = 1; k < lines.length; k += 1) {
			if (pos < limit && text[pos] === "\r") pos += 1;
			if (pos >= limit || text[pos] !== "\n") { matched = false; break; }
			const nextEnd = matchContinuationLine(text, pos + 1, limit, lines[k] ?? "");
			if (nextEnd < 0) { matched = false; break; }
			pos = nextEnd;
		}
		if (matched) return { end: pos, start };
		searchFrom = start + 1;
	}
	return null;
}

function buildInlineContext(node: ProseMirrorNode, text: string, emptyMd: number, limit: number, inCell: boolean): InlineCtx {
	let hasAnyLink = false;
	const protectedRanges: Range[] = [];
	let protScan = emptyMd;
	let backtickIndex: BoundedBacktickIndex | null | undefined;
	const getBacktickIndex = (): BoundedBacktickIndex | null => {
		if (backtickIndex === undefined) backtickIndex = indexBoundedBacktickRuns(text, emptyMd, limit);
		return backtickIndex;
	};
	node.forEach((child) => {
		if (findNonCodeMark(child.marks, "link") === null) return;
		hasAnyLink = true;
		if (child.type.name !== "protected_inline") return;
		const range = findProtectedInlineRange(text, String(child.attrs.rawMarkdown ?? ""), protScan, limit, inCell, getBacktickIndex);
		if (range) { protectedRanges.push(range); protScan = range.end; }
	});
	return {
		balancedCloseCache: new Map<number, number>(),
		getBacktickIndex,
		inCell,
		limit,
		linkSpans: hasAnyLink ? extractLexicalLinkSpans(text, emptyMd, limit) : null,
		protectedRanges,
		text,
	};
}

export function mapInlineTextblock(
	node: ProseMirrorNode,
	contentStart: number,
	text: string,
	from: number,
	limit: number,
	inCell: boolean,
	atBlockStart: boolean,
): VisualSourceMapResult {
	let cursor = from;
	if (!atBlockStart && !inCell) {
		const lineEnd = lineEndAt(text, cursor, limit);
		if (lineEnd < limit && CLOSING_MARKUP_PATTERN.test(text.slice(cursor, lineEnd))) cursor = lineEnd + 1;
	}
	const segmentStart = cursor;
	if (!inCell) cursor = skipContainerPrefix(text, cursor, limit);
	if (node.type.name === "heading") {
		ATX_MARKER_PATTERN.lastIndex = cursor;
		const marker = ATX_MARKER_PATTERN.exec(text);
		if (marker && cursor + marker[0].length <= limit) cursor += marker[0].length;
	}
	const emptyMd = cursor;
	const ctx = buildInlineContext(node, text, emptyMd, limit, inCell);
	const units: VisualSourceUnit[] = [];
	let prevMarks: readonly Mark[] = [];
	let link: LinkRef = NO_LINK;

	node.forEach((child, offset) => {
		const pmPos = contentStart + offset;
		const currMarks = child.marks;
		const closedEmphasis: EmphasisMarkName[] = [];
		const openedEmphasis: EmphasisMarkName[] = [];
		const continuingEmphasis: EmphasisMarkName[] = [];

		for (const name of EMPHASIS_MARK_NAMES) {
			const prev = findNonCodeMark(prevMarks, name);
			const curr = findNonCodeMark(currMarks, name);
			if (prev && !curr) closedEmphasis.push(name);
			else if (!prev && curr) openedEmphasis.push(name);
			else if (prev && curr) continuingEmphasis.push(name);
		}
		const prevLink = findNonCodeMark(prevMarks, "link");
		const currLink = findNonCodeMark(currMarks, "link");
		const linkContinues = prevLink !== null && currLink !== null && prevLink.eq(currLink);

		const sameLinkBoundary = linkContinues
			? consumeSameLinkBoundary(ctx, cursor, closedEmphasis, openedEmphasis, continuingEmphasis, link)
			: null;
		if (sameLinkBoundary) {
			cursor = sameLinkBoundary.cursor;
			link = sameLinkBoundary.link;
		} else {
			const closedMarks: NonCodeMarkName[] = prevLink && !linkContinues ? [...closedEmphasis, "link"] : closedEmphasis;
			const openedMarks: NonCodeMarkName[] = currLink && !linkContinues ? [...openedEmphasis, "link"] : [...openedEmphasis];
			if (closedMarks.length > 0) {
				const closed = consumeClosingMarks(ctx, cursor, closedMarks, continuingEmphasis, link);
				cursor = closed.cursor;
				link = closed.link;
				for (const markName of closed.reopenedMarks) {
					if (!openedMarks.includes(markName)) openedMarks.push(markName);
				}
			}
			if (openedMarks.length > 0) {
				const opened = consumeOpeningMarks(ctx, cursor, openedMarks, link);
				cursor = opened.cursor;
				link = opened.link;
			}
		}
		prevMarks = currMarks;

		if (child.isText) {
			const value = child.text ?? "";
			if (child.marks.some((mark) => mark.type.name === "code")) {
				cursor = mapCodeSpanChild(ctx, value, pmPos, cursor, units);
				return;
			}
			for (let i = 0; i < value.length; ) {
				const matched = findNonCodeUnit(ctx, value, i, cursor, currMarks, link);
				const pmSize = matched ? matched.pmSize : 1;
				units.push({ atom: null, mdEnd: matched ? matched.mdEnd : cursor, mdStart: matched ? matched.mdStart : cursor, pmPos: pmPos + i, pmSize });
				if (matched) {
					cursor = matched.nextCursor;
					link = matched.link;
				}
				i += pmSize;
			}
			return;
		}

		let range: Range | null = null;
		if (child.type.name === "image") range = findImage(ctx, cursor);
		else if (child.type.name === "protected_inline") {
			const raw = String(child.attrs.rawMarkdown ?? "");
			range = findProtectedInlineRange(text, raw, cursor, limit, inCell, ctx.getBacktickIndex);
		} else if (child.type.name === "hard_break") range = findHardBreak(ctx, cursor);
		const resolved = range ?? { end: cursor, start: cursor };
		units.push({ atom: child, mdEnd: resolved.end, mdStart: resolved.start, pmPos, pmSize: child.nodeSize });
		cursor =
			!inCell && child.type.name === "hard_break" && resolved.end > resolved.start && text[resolved.end - 1] === "\n"
				? skipLineContinuationPrefix(text, resolved.end, limit)
				: resolved.end;
	});

	const trailingClosed = NON_CODE_MARK_NAMES.filter((name) => findNonCodeMark(prevMarks, name) !== null);
	if (trailingClosed.length > 0) cursor = consumeClosingMarks(ctx, cursor, trailingClosed, [], link).cursor;

	const lastUnit = units[units.length - 1];
	return {
		cursor,
		segment: {
			contentEnd: contentStart + node.content.size,
			contentStart,
			emptyMd,
			kind: "text",
			mdEnd: Math.max(cursor, lastUnit ? lastUnit.mdEnd : emptyMd, emptyMd),
			mdStart: segmentStart,
			units,
		},
	};
}
