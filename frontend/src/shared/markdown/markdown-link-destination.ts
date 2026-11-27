import { isCommonMarkWhitespaceCode } from "./markdown-char-codes";
import type { SourceRange } from "./markdown-source-projection";

/**
 * Worker-safe canonical CommonMark §4.7 / §6.3 / League CommonMark 2.8.2 link
 * destination scanner and ASCII punctuation predicate. Zero DOM or third-party
 * dependencies.
 */

const MAX_INLINE_DEST_PAREN_DEPTH = 32;

export function isAsciiPunctCode(code: number): boolean {
	return (
		(code >= 33 && code <= 47) ||
		(code >= 58 && code <= 64) ||
		(code >= 91 && code <= 96) ||
		(code >= 123 && code <= 126)
	);
}

/**
 * Advances `pos` by one Unicode code point (2 UTF-16 code units for a valid
 * surrogate pair, otherwise 1).
 */
export function advanceCodePoint(
	text: string,
	pos: number,
	limit: number,
): number {
	const code = text.charCodeAt(pos);
	if (code >= 0xd800 && code <= 0xdbff && pos + 1 < limit) {
		const low = text.charCodeAt(pos + 1);
		if (low >= 0xdc00 && low <= 0xdfff) {
			return pos + 2;
		}
	}
	return pos + 1;
}

/**
 * Scans a CommonMark / League CommonMark 2.8.2 link destination starting at
 * `start` within `[start, limit)`:
 * - Angle-bracketed `<...>`: `\` escapes any non-newline char; rejects
 *   unescaped `<`, `\n`, `\r` (League normalizes `\0` to `\uFFFD` before
 *   parsing, so `\0` does not invalidate destinations).
 * - Bare destination: `\` escapes ASCII punctuation; enforces balanced
 *   parentheses up to `MAX_INLINE_DEST_PAREN_DEPTH` (32) and `parenDepth === 0`
 *   (matching `LinkParserHelper::manuallyParseLinkDestination`).
 */
export function scanLinkDestinationRange(
	text: string,
	start: number,
	limit: number,
): SourceRange | null {
	if (start >= limit) return null;
	const first = text.charCodeAt(start);
	if (60 /* < */ === first) {
		let pos = start + 1;
		while (pos < limit) {
			const ch = text.charCodeAt(pos);
			if (92 /* \ */ === ch) {
				if (pos + 1 >= limit) return null;
				const escaped = text.charCodeAt(pos + 1);
				if (10 === escaped || 13 === escaped) return null;
				pos = advanceCodePoint(text, pos + 1, limit);
				continue;
			}
			if (62 /* > */ === ch) {
				return { from: start, to: pos + 1 };
			}
			if (60 === ch || 10 === ch || 13 === ch) {
				return null;
			}
			pos += 1;
		}
		return null;
	}

	let pos = start;
	let parenDepth = 0;
	while (pos < limit) {
		const ch = text.charCodeAt(pos);
		if (
			92 /* \ */ === ch &&
			pos + 1 < limit &&
			isAsciiPunctCode(text.charCodeAt(pos + 1))
		) {
			pos += 2;
			continue;
		}
		if (40 /* ( */ === ch) {
			parenDepth += 1;
			if (parenDepth > MAX_INLINE_DEST_PAREN_DEPTH) return null;
			pos += 1;
			continue;
		}
		if (41 /* ) */ === ch) {
			if (0 === parenDepth) break;
			parenDepth -= 1;
			pos += 1;
			continue;
		}
		if (ch <= 32 && isCommonMarkWhitespaceCode(ch)) break;
		pos += 1;
	}
	if (0 !== parenDepth || pos === start) return null;
	return { from: start, to: pos };
}

/**
 * Scans a link-title body segment `[start, limit)` for its closing delimiter
 * matching League's `PARTIAL_LINK_TITLE` (after `\0 -> \uFFFD` normalization):
 * `\` escapes ASCII punctuation, and unescaped `(` is rejected inside `(...)`
 * titles. Returns the closing delimiter index (`>= start`), `-1` if still open,
 * or `-2` on an invalid unescaped `(` inside a `(...)` title.
 */
export function findLinkTitleCloseIndex(
	text: string,
	start: number,
	limit: number,
	quoteCode: number,
): number {
	const closeCode = 40 === quoteCode ? 41 : quoteCode;
	let pos = start;
	while (pos < limit) {
		const ch = text.charCodeAt(pos);
		if (
			92 /* \ */ === ch &&
			pos + 1 < limit &&
			isAsciiPunctCode(text.charCodeAt(pos + 1))
		) {
			pos += 2;
			continue;
		}
		if (40 === quoteCode && 40 === ch) return -2;
		if (ch === closeCode) return pos;
		pos += 1;
	}
	return -1;
}

/**
 * Scans an inline or reference link title (`"..."`, `'...'`, or `(...)`)
 * starting at `start` within `[start, limit)`, matching League's
 * `PARTIAL_LINK_TITLE`.
 */
export function scanInlineLinkTitleRange(
	text: string,
	start: number,
	limit: number,
): SourceRange | null {
	if (start >= limit) return null;
	const quoteCode = text.charCodeAt(start);
	if (
		34 /* " */ !== quoteCode &&
		39 /* ' */ !== quoteCode &&
		40 /* ( */ !== quoteCode
	) {
		return null;
	}
	const closeIndex = findLinkTitleCloseIndex(text, start + 1, limit, quoteCode);
	return closeIndex >= 0 ? { from: start, to: closeIndex + 1 } : null;
}
