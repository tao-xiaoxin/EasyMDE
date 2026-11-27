import type { SyntaxNode } from "@lezer/common";

import type { SourceRange } from "../../shared/markdown/markdown-source-projection";
import {
	isCommonMarkWhitespaceCode,
	isLezerSpaceCode,
} from "../../shared/markdown/markdown-char-codes";
import {
	advanceCodePoint,
	scanInlineLinkTitleRange,
	scanLinkDestinationRange,
} from "../../shared/markdown/markdown-link-destination";
import {
	normalizeMarkdownReferenceLabel,
	type ReferenceLabelCaseFoldProfile,
} from "./reference-label-normalization";

export type SourceShorthandReferenceLink = Readonly<{
	closeBracketOffset: number;
	collapsedEmptyCloseOffset: number | null;
	from: number;
	labelFrom: number;
	labelTo: number;
	normalizedLabel: string;
	rawLabel: string;
	to: number;
}>;

export const DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE: ReferenceLabelCaseFoldProfile = 14;

/**
 * CommonMark §4.7 / League CommonMark 2.8.2 link label maximum length in
 * Unicode code points (matching `mb_strlen($label, 'UTF-8') <= 999`).
 */
export const MAX_LINK_LABEL_CODE_POINTS = 999;

/**
 * League CommonMark 2.8.2 `LinkParserHelper::parseLinkLabel` PCRE token cap
 * (`/^\[(?:[^\\\[\]]|\\.){0,1000}\]/`, running without `/u` over UTF-8 bytes).
 */
const MAX_LINK_LABEL_UTF8_REGEX_TOKENS = 1000;

type InlineLinkTailRange = Readonly<{
	dest: SourceRange | null;
	endPos: number;
	parenClosePos: number;
	title: SourceRange | null;
}>;

type BracketLabelScan = Readonly<{
	closeBracket: number;
	hasNonWs: boolean;
	isEmpty: boolean;
}>;

type LinkLabelInnerScan = Readonly<{
	endPos: number;
	hasNonWs: boolean;
}>;

function isSpaceOrTabCode(code: number): boolean {
	return 32 === code || 9 === code;
}

function skipCommonMarkWhitespace(
	text: string,
	pos: number,
	limit: number,
): number {
	let cursor = pos;
	while (cursor < limit && isCommonMarkWhitespaceCode(text.charCodeAt(cursor))) {
		cursor += 1;
	}
	return cursor;
}

export function skipSpaceOrTab(
	text: string,
	pos: number,
	limit: number,
): number {
	let cursor = pos;
	while (cursor < limit && isSpaceOrTabCode(text.charCodeAt(cursor))) {
		cursor += 1;
	}
	return cursor;
}

function utf8ByteLengthAt(text: string, pos: number, limit: number): number {
	const code = text.charCodeAt(pos);
	if (code <= 0x7f) return 1;
	if (code <= 0x7ff) return 2;
	if (code >= 0xd800 && code <= 0xdbff && pos + 1 < limit) {
		const low = text.charCodeAt(pos + 1);
		if (low >= 0xdc00 && low <= 0xdfff) return 4;
	}
	return 3;
}

/**
 * Scans a CommonMark inline link tail `(...)` starting at `parenPos` (`(`)
 * within `[parenPos, limit)`. Returns `null` if no valid closing `)` exists
 * or destination/title syntax is invalid.
 */
export function scanInlineLinkTail(
	text: string,
	parenPos: number,
	limit: number,
	lastCloseParen: number,
): InlineLinkTailRange | null {
	if (parenPos >= limit || parenPos >= lastCloseParen || 40 /* ( */ !== text.charCodeAt(parenPos)) {
		return null;
	}
	let pos = skipCommonMarkWhitespace(text, parenPos + 1, limit);
	if (pos >= limit) return null;
	if (41 /* ) */ === text.charCodeAt(pos)) {
		return { dest: null, endPos: pos + 1, parenClosePos: pos, title: null };
	}

	const dest = scanLinkDestinationRange(text, pos, limit);
	if (!dest) return null;

	const wsStart = dest.to;
	pos = skipCommonMarkWhitespace(text, dest.to, limit);
	const hadWsAfterDest = pos > wsStart;

	let title: SourceRange | null = null;
	if (pos < limit && 41 /* ) */ !== text.charCodeAt(pos)) {
		if (!hadWsAfterDest) return null;
		title = scanInlineLinkTitleRange(text, pos, limit);
		if (!title) return null;
		pos = skipCommonMarkWhitespace(text, title.to, limit);
	}

	return pos < limit && 41 /* ) */ === text.charCodeAt(pos)
		? { dest, endPos: pos + 1, parenClosePos: pos, title }
		: null;
}

function scanLinkLabelInner(
	text: string,
	from: number,
	limit: number,
	stopAtCloseBracket: boolean,
	maxUtf8RegexTokens: number,
): LinkLabelInnerScan | null {
	const enforceUtf8Tokens = Number.isFinite(maxUtf8RegexTokens);
	let pos = from;
	let codePoints = 0;
	let utf8Tokens = 0;
	let hasNonWs = false;
	while (pos < limit) {
		const ch = text.charCodeAt(pos);
		if (92 /* \ */ === ch) {
			if (enforceUtf8Tokens) {
				if (pos + 1 >= limit) return null;
				const next = text.charCodeAt(pos + 1);
				// PCRE `/^\[(?:[^\\\[\]]|\\.){0,1000}\]/` without `/s` cannot match `\\\n`.
				if (10 === next) return null;
				codePoints += 2;
				if (codePoints > MAX_LINK_LABEL_CODE_POINTS) return null;
				// `\\.` consumes `\` + 1st UTF-8 byte (1 token); remaining B-1 bytes consume B-1 tokens.
				utf8Tokens += utf8ByteLengthAt(text, pos + 1, limit);
				if (utf8Tokens > maxUtf8RegexTokens) return null;
				hasNonWs = true;
				pos = advanceCodePoint(text, pos + 1, limit);
				continue;
			}
			if (pos + 1 < limit) {
				const next = text.charCodeAt(pos + 1);
				if (10 !== next && 13 !== next) {
					codePoints += 2;
					if (codePoints > MAX_LINK_LABEL_CODE_POINTS) return null;
					hasNonWs = true;
					pos = advanceCodePoint(text, pos + 1, limit);
					continue;
				}
			}
			codePoints += 1;
			if (codePoints > MAX_LINK_LABEL_CODE_POINTS) return null;
			hasNonWs = true;
			pos += 1;
			continue;
		}
		if (91 /* [ */ === ch) return null;
		if (93 /* ] */ === ch) {
			return stopAtCloseBracket ? { endPos: pos, hasNonWs } : null;
		}
		codePoints += 1;
		if (codePoints > MAX_LINK_LABEL_CODE_POINTS) return null;
		if (enforceUtf8Tokens) {
			utf8Tokens += utf8ByteLengthAt(text, pos, limit);
			if (utf8Tokens > maxUtf8RegexTokens) return null;
		}
		if (!isCommonMarkWhitespaceCode(ch)) hasNonWs = true;
		pos = advanceCodePoint(text, pos, limit);
	}
	return stopAtCloseBracket ? null : { endPos: pos, hasNonWs };
}

/**
 * Scans a bracketed full-reference link label `[...]` starting at
 * `openBracketPos` (`[`) within `[openBracketPos, limit)`, matching League
 * 2.8.2 `LinkParserHelper::parseLinkLabel`: both `<= 999` Unicode code points
 * (`mb_strlen($match, 'UTF-8') <= 1001`) and `<= 1,000` UTF-8 PCRE tokens
 * (`/^\[(?:[^\\\[\]]|\\.){0,1000}\]/`).
 */
export function scanBracketLabelRange(
	text: string,
	openBracketPos: number,
	limit: number,
): BracketLabelScan | null {
	if (openBracketPos >= limit || 91 /* [ */ !== text.charCodeAt(openBracketPos)) {
		return null;
	}
	const scan = scanLinkLabelInner(
		text,
		openBracketPos + 1,
		limit,
		true,
		MAX_LINK_LABEL_UTF8_REGEX_TOKENS,
	);
	if (!scan) return null;
	return {
		closeBracket: scan.endPos,
		hasNonWs: scan.hasNonWs,
		isEmpty: scan.endPos === openBracketPos + 1,
	};
}

/**
 * Validates raw inner label text `[from, to)` (excluding surrounding `[` `]`)
 * against CommonMark §4.7 / League shortcut/collapsed rules: 1..999 Unicode
 * code points, at least one non-whitespace character, and no unescaped `[` or
 * `]`.
 */
export function isValidCommonMarkLinkLabel(
	text: string,
	from: number,
	to: number,
): boolean {
	if (from >= to) return false;
	const scan = scanLinkLabelInner(text, from, to, false, Number.POSITIVE_INFINITY);
	return Boolean(scan?.hasNonWs);
}

/**
 * Matches `League\CommonMark\Extension\TaskList\TaskListItemMarkerParser`:
 * leading `[ ]`, `[x]`, or `[X]` in a `Paragraph` directly inside a `ListItem`,
 * followed by at least one non-space character anywhere later in the paragraph.
 */
export function hasLeagueTaskMarkerPrefix(
	text: string,
	from: number,
	to: number,
): boolean {
	if (to - from <= 3) return false;
	if (91 /* [ */ !== text.charCodeAt(from) || 93 /* ] */ !== text.charCodeAt(from + 2)) {
		return false;
	}
	const mid = text.charCodeAt(from + 1);
	if (32 /* ' ' */ !== mid && 120 /* 'x' */ !== mid && 88 /* 'X' */ !== mid) {
		return false;
	}
	for (let i = from + 3; i < to; i += 1) {
		if (!isLezerSpaceCode(text.charCodeAt(i))) {
			return true;
		}
	}
	return false;
}

/**
 * Normalizes a CommonMark §4.7 link reference label using the explicitly
 * reported PHP Unicode case-fold profile (defaulting to Unicode 14 when
 * invoked standalone without WordPress bootstrap). Returns `null` for empty
 * labels or labels that cannot be folded safely under `"unsupported"`.
 */
export function normalizeBoldReferenceLabel(
	raw: string,
	profile: ReferenceLabelCaseFoldProfile = DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE,
): string | null {
	try {
		const normalized = normalizeMarkdownReferenceLabel(raw, profile);
		return normalized.length > 0 ? normalized : null;
	} catch {
		return null;
	}
}

/**
 * Extracts `text.slice(from, to)` with parsed blockquote continuation
 * `QuoteMark` markers (and one optional following space/tab) removed.
 */
export function stripQuoteMarksFromSlice(
	text: string,
	from: number,
	to: number,
	scopeNode: SyntaxNode,
): string {
	if (from >= to) return "";
	const raw = text.slice(from, to);
	if (!raw.includes(">")) return raw;
	const marks: SourceRange[] = [];
	const cursor = scopeNode.cursor();
	let depth = 0;
	if (cursor.firstChild()) {
		depth = 1;
		while (depth > 0) {
			if (cursor.from < to && cursor.to > from) {
				if ("QuoteMark" === cursor.name) {
					const markEnd =
						cursor.to < to &&
						(" " === text[cursor.to] || "\t" === text[cursor.to])
							? cursor.to + 1
							: cursor.to;
					marks.push({ from: Math.max(from, cursor.from), to: markEnd });
				} else if (cursor.firstChild()) {
					depth += 1;
					continue;
				}
			}
			while (depth > 0 && !cursor.nextSibling()) {
				cursor.parent();
				depth -= 1;
			}
		}
	}
	if (0 === marks.length) return raw;
	const chunks: string[] = [];
	let pos = from;
	for (const mark of marks) {
		if (mark.from > pos) chunks.push(text.slice(pos, mark.from));
		pos = Math.max(pos, mark.to);
	}
	if (pos < to) chunks.push(text.slice(pos, to));
	return chunks.join("");
}

export function formatShorthandRawLabel(stripped: string): string {
	return /[\r\n]/u.test(stripped)
		? stripped
				.replace(/^[ \t\r\n]+|[ \t\r\n]+$/gu, "")
				.replace(/[ \t\r\n]+/gu, " ")
		: stripped;
}
