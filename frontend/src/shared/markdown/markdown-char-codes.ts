/**
 * Worker-safe canonical ASCII and Unicode whitespace/character-code predicates
 * shared across Markdown block, inline, HTML, delimiter, and reference
 * scanners. Zero runtime dependencies.
 */

/**
 * Matches CommonMark ASCII whitespace (`" \t\n\r\x0B\x0C"`), which also
 * matches PHP `trim()` after League's `\0 -> \uFFFD` line normalization.
 */
export function isCommonMarkWhitespaceCode(code: number): boolean {
	return 32 === code || (code >= 9 && code <= 13);
}

/** Matches `@lezer/markdown`'s `space(ch)` predicate (`" \t\n\r"`). */
export function isLezerSpaceCode(code: number): boolean {
	return 32 === code || 9 === code || 10 === code || 13 === code;
}

/**
 * Exact PHP 8.3 PCRE2 `/^\pZ|\s/u` and `/^\s/u` whitespace code points (26 BMP
 * code points): ASCII `\t\n\x0b\f\r ` (9..13, 32), `U+0085` (NEL),
 * `U+00A0` (NBSP), `U+1680`, `U+180E` (MVS), `U+2000..U+200A`, `U+2028`,
 * `U+2029`, `U+202F`, `U+205F`, and `U+3000` (notably excluding `U+FEFF`).
 */
export function isLeagueUnicodeWhitespaceCode(code: number): boolean {
	if (code <= 32) return 32 === code || (code >= 9 && code <= 13);
	if (code < 0x85) return false;
	return (
		0x85 === code ||
		0xa0 === code ||
		0x1680 === code ||
		0x180e === code ||
		(code >= 0x2000 && code <= 0x200a) ||
		0x2028 === code ||
		0x2029 === code ||
		0x202f === code ||
		0x205f === code ||
		0x3000 === code
	);
}

/** Matches JavaScript's `/\s/` character class across all UTF-16 code units. */
export function isJsWhitespaceCode(code: number): boolean {
	if (code <= 32) return 32 === code || (code >= 9 && code <= 13);
	if (code < 0xa0) return false;
	return (
		0xa0 === code ||
		0x1680 === code ||
		(code >= 0x2000 && code <= 0x200a) ||
		0x2028 === code ||
		0x2029 === code ||
		0x202f === code ||
		0x205f === code ||
		0x3000 === code ||
		0xfeff === code
	);
}

export function isAsciiLowerCode(code: number): boolean {
	return code >= 97 && code <= 122;
}

export function isAsciiLetterCode(code: number): boolean {
	return (code >= 65 && code <= 90) || isAsciiLowerCode(code);
}

export function isAsciiDigitCode(code: number): boolean {
	return code >= 48 && code <= 57;
}

export function isAsciiLowerAlnumOrHyphenCode(code: number): boolean {
	return isAsciiLowerCode(code) || isAsciiDigitCode(code) || 45 /* - */ === code;
}

export function isAsciiAlnumCode(code: number): boolean {
	return isAsciiLetterCode(code) || isAsciiDigitCode(code);
}

/** Matches ASCII word characters (`[A-Za-z0-9_]`). */
export function isAsciiWordCode(code: number): boolean {
	return isAsciiAlnumCode(code) || 95 /* _ */ === code;
}

export function hasMultibyteCodeUnit(text: string): boolean {
	for (let i = 0; i < text.length; i += 1) {
		if (text.charCodeAt(i) >= 128) return true;
	}
	return false;
}

/**
 * Advances a 0-based Markdown column position across `text`, expanding tabs
 * to CommonMark 4-column tab stops.
 */
export function advanceMarkdownColumns(text: string, startCol = 0): number {
	let col = startCol;
	for (let i = 0; i < text.length; i += 1) {
		col = 9 === text.charCodeAt(i) ? col + (4 - (col % 4)) : col + 1;
	}
	return col;
}

/**
 * Whether `text.slice(from, to)` contains at most one Unicode code point
 * (handling UTF-16 surrogate pairs for astral characters). Matches League
 * CommonMark 2.8.2 `Cursor::peek() === null` in `calculateListMarkerPadding`.
 */
export function isAtMostOneCodePointLeft(
	text: string,
	from: number,
	to: number,
): boolean {
	if (from >= to) return true;
	const cp = text.codePointAt(from);
	const charLen = undefined !== cp && cp > 0xffff ? 2 : 1;
	return from + charLen >= to;
}
