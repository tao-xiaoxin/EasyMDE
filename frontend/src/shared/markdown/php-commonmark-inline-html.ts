/**
 * Linear-time CommonMark §6.5 autolink and §6.6 inline raw HTML scanner
 * mirroring PHP `League\CommonMark\Extension\CommonMark\Parser\Inline\AutolinkParser`
 * and `HtmlInlineParser` (case-sensitive `RegexHelper::PARTIAL_HTMLTAG`).
 */

export type InlineHtmlSegment = Readonly<{
	contentOffset: number;
	lineEnd: number;
}>;

export type InlineHtmlScanGuard = {
	noCdataCloseAfter: number;
	noCommentCloseAfter: number;
	noDoubleQuoteAfter: number;
	noGtAfter: number;
	noPiCloseAfter: number;
	noSingleQuoteAfter: number;
};

export type SingleLineInlineAngleResult =
	| Readonly<{ status: "none" }>
	| Readonly<{ end: number; status: "ok" }>
	| Readonly<{ status: "needs-multiline" }>;

export type BlockInlineAngleMatch = Readonly<{
	pos: number;
	segIdx: number;
}>;

export function createInlineHtmlScanGuard(): InlineHtmlScanGuard {
	return {
		noCdataCloseAfter: Number.POSITIVE_INFINITY,
		noCommentCloseAfter: Number.POSITIVE_INFINITY,
		noDoubleQuoteAfter: Number.POSITIVE_INFINITY,
		noGtAfter: Number.POSITIVE_INFINITY,
		noPiCloseAfter: Number.POSITIVE_INFINITY,
		noSingleQuoteAfter: Number.POSITIVE_INFINITY,
	};
}

function isAsciiUpper(code: number): boolean {
	return code >= 0x41 && code <= 0x5a;
}

function isAsciiLower(code: number): boolean {
	return code >= 0x61 && code <= 0x7a;
}

function isAsciiLetter(code: number): boolean {
	return isAsciiUpper(code) || isAsciiLower(code);
}

function isAsciiDigit(code: number): boolean {
	return code >= 0x30 && code <= 0x39;
}

function isAsciiAlphaNum(code: number): boolean {
	return isAsciiLetter(code) || isAsciiDigit(code);
}

function isHorizontalHtmlWhitespace(ch: string | undefined): boolean {
	return " " === ch || "\t" === ch || "\v" === ch || "\f" === ch;
}

function isSchemeChar(code: number): boolean {
	return isAsciiAlphaNum(code) || 0x2e === code || 0x2b === code || 0x2d === code;
}

function isEmailLocalChar(code: number): boolean {
	if (isAsciiAlphaNum(code)) return true;
	return (
		0x21 === code || // !
		(code >= 0x23 && code <= 0x27) || // # $ % & '
		0x2a === code || // *
		0x2b === code || // +
		0x2d === code || // -
		0x2e === code || // .
		0x2f === code || // /
		0x3d === code || // =
		0x3f === code || // ?
		(code >= 0x5e && code <= 0x60) || // ^ _ `
		(code >= 0x7b && code <= 0x7e) // { | } ~
	);
}

function isLowerTagNameChar(code: number): boolean {
	return isAsciiLower(code) || isAsciiDigit(code) || 0x2d === code;
}

function isLowerAttrStart(code: number): boolean {
	return isAsciiLower(code) || 0x5f === code || 0x3a === code;
}

function isLowerAttrChar(code: number): boolean {
	return (
		isAsciiLower(code) ||
		isAsciiDigit(code) ||
		0x3a === code ||
		0x2e === code ||
		0x5f === code ||
		0x2d === code
	);
}

function isUnquotedAttrChar(ch: string, code: number): boolean {
	return (
		code > 0x20 &&
		'"' !== ch &&
		"'" !== ch &&
		"=" !== ch &&
		"<" !== ch &&
		">" !== ch &&
		"`" !== ch
	);
}

/**
 * Matches the CommonMark §6.5 URI or email autolink (PHP `AutolinkParser`)
 * opening at `source[start] === "<"` strictly within `[start, lineEnd)`,
 * returning its exclusive end or `-1`.
 */
export function matchCommonMarkAutolinkOnLine(
	source: string,
	start: number,
	lineEnd: number,
): number {
	const firstPos = start + 1;
	if (firstPos >= lineEnd) return -1;
	const firstCode = source.charCodeAt(firstPos);

	// 1. URI autolink: <[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>
	if (isAsciiLetter(firstCode)) {
		let pos = firstPos + 1;
		const schemeLimit = Math.min(lineEnd, firstPos + 32);
		while (pos < schemeLimit && isSchemeChar(source.charCodeAt(pos))) {
			pos += 1;
		}
		if (pos - firstPos >= 2 && pos < lineEnd && ":" === source[pos]) {
			pos += 1;
			while (pos < lineEnd) {
				const ch = source[pos];
				if (">" === ch) return pos + 1;
				if ("<" === ch || source.charCodeAt(pos) <= 0x20) break;
				pos += 1;
			}
		}
	}

	// 2. Email autolink
	if (!isEmailLocalChar(firstCode)) return -1;
	let pos = firstPos + 1;
	while (pos < lineEnd && isEmailLocalChar(source.charCodeAt(pos))) pos += 1;
	if (pos >= lineEnd || "@" !== source[pos]) return -1;
	pos += 1;

	let labels = 0;
	while (pos < lineEnd) {
		const labelStart = pos;
		if (!isAsciiAlphaNum(source.charCodeAt(pos))) return -1;
		pos += 1;
		let lastCharCode = source.charCodeAt(labelStart);
		while (pos < lineEnd) {
			const code = source.charCodeAt(pos);
			if (isAsciiAlphaNum(code) || 0x2d === code) {
				lastCharCode = code;
				pos += 1;
				continue;
			}
			break;
		}
		const labelLen = pos - labelStart;
		if (labelLen > 63 || 0x2d === lastCharCode) return -1;
		labels += 1;
		if (">" === source[pos]) return labels > 0 ? pos + 1 : -1;
		if ("." === source[pos]) {
			pos += 1;
			continue;
		}
		return -1;
	}
	return -1;
}

const GFM_URL_AUTOLINK_PREFIX_RE = /www\.|http:\/\/|https:\/\/|ftp:\/\//gi;
const GFM_URL_TRAILING_PUNCTUATION = "?!.,:*_~";
const GFM_URL_START_PREFIX_RE = /^(?:https?:\/\/|ftp:\/\/|www\.)/iu;
const GFM_URL_AUTOLINK_RE = (() => {
	const h = "[0-9a-f]{1,4}";
	const v4 = "(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9])";
	const l = `(?:${h}:${h}|(?:${v4}\\.){3}${v4})`;
	const ipv6 = `\\[(?:(?:${h}:){6}${l}|::(?:${h}:){5}${l}|(?:${h})?::(?:${h}:){4}${l}|(?:(?:${h}:){0,1}${h})?::(?:${h}:){3}${l}|(?:(?:${h}:){0,2}${h})?::(?:${h}:){2}${l}|(?:(?:${h}:){0,3}${h})?::${h}:${l}|(?:(?:${h}:){0,4}${h})?::${l}|(?:(?:${h}:){0,5}${h})?::${h}|(?:(?:${h}:){0,6}${h})?::)\\]`;
	const enc = "%[0-9A-Fa-f]{2}";
	const auth = `(?:[_.\\p{L}\\p{N}-]|${enc})+`;
	const d = "\\p{Nd}{1,3}";
	// `(?=(X*))\1` emulates PCRE's possessive punycode `(?:xn--…\.)*+`.
	return new RegExp(
		`(?:(?:https?|ftp)://(?:(?:${auth}:)?${auth}@)?|www\\.)(?:(?:(?=((?:xn--[a-z0-9-]+\\.)*))\\1xn--[a-z0-9-]+|(?:[\\p{L}\\p{N}\\p{S}\\p{M}_-]+\\.){1,127}[\\p{L}\\p{N}\\p{M}]+|[a-z0-9_-]+)\\.?|${d}\\.${d}\\.${d}\\.${d}|${ipv6})(?::[0-9]+)?(?:/(?:[\\p{L}\\p{N}._~!$&'()*+,;=:@-]|${enc})*)*(?:\\?(?:[\\p{L}\\p{N}._~!$&'\\[\\]()*+,;=:@/?-]|${enc})*)?(?:#(?:[\\p{L}\\p{N}._~!$&'()*+,;=:@/?-]|${enc})*)?`,
		"iuy",
	);
})();

function isGfmEmailLocalChar(code: number): boolean {
	return (
		isAsciiAlphaNum(code) ||
		0x2e === code || // .
		0x2d === code || // -
		0x5f === code || // _
		0x2b === code // +
	);
}

function isGfmEmailDomainFirstChar(code: number): boolean {
	return (
		isAsciiAlphaNum(code) ||
		0x2d === code || // -
		0x5f === code // _
	);
}

function isGfmEmailDomainTailChar(code: number): boolean {
	return isGfmEmailDomainFirstChar(code) || 0x2e === code; // .
}

export type GfmAutolinkStops = Readonly<{
	/** Non-overlapping `EmailAutolinkParser` match starts mapped to match ends. */
	emails: ReadonlyMap<number, number>;
	/** Non-overlapping `UrlAutolinkParser` prefix (`www.`, `http://`, …) starts. */
	urls: ReadonlySet<number>;
}>;

/**
 * Collects the PHP `InlineParserEngine::matchParsers()` stop positions of the
 * GFM `EmailAutolinkParser` and `UrlAutolinkParser` within one inline line
 * `[from, to)` (neither parser can cross a line break) in strictly O(N) time.
 */
export function collectGfmAutolinkStops(
	source: string,
	from: number,
	to: number,
): GfmAutolinkStops {
	const emails = new Map<number, number>();
	const urls = new Set<number>();

	let floor = from;
	let searchPos = from;
	while (searchPos < to) {
		const at = source.indexOf("@", searchPos);
		if (at < 0 || at >= to) break;
		let start = at;
		while (start > floor && isGfmEmailLocalChar(source.charCodeAt(start - 1))) {
			start -= 1;
		}
		if (start < at) {
			let pos = at + 1;
			while (pos < to && isGfmEmailDomainFirstChar(source.charCodeAt(pos))) {
				pos += 1;
			}
			if (pos > at + 1 && pos < to && 0x2e === source.charCodeAt(pos)) {
				pos += 1;
				const tailStart = pos;
				while (pos < to && isGfmEmailDomainTailChar(source.charCodeAt(pos))) {
					pos += 1;
				}
				if (pos > tailStart) {
					emails.set(start, pos);
					floor = pos;
					searchPos = pos;
					continue;
				}
			}
		}
		searchPos = at + 1;
	}

	const line = source.slice(from, to);
	for (const match of line.matchAll(GFM_URL_AUTOLINK_PREFIX_RE)) {
		urls.add(from + (match.index ?? 0));
	}
	return { emails, urls };
}

/**
 * Mirrors PHP `EmailAutolinkParser::parse()` for a stop match `[start, end)`:
 * returns the exclusive end of the consumed email, or `-1` when rejected.
 */
export function gfmEmailAutolinkEnd(source: string, end: number): number {
	const last = source[end - 1];
	if ("-" === last || "_" === last) return -1;
	return "." === last ? end - 1 : end;
}

/** PHP `UrlAutolinkParser::ALLOWED_AFTER` (`null` is a line or block start). */
export function isGfmUrlAutolinkAllowedAfter(previous: string | null): boolean {
	return null === previous || " \t\n\v\f\r*_~(".includes(previous);
}

function utf8ByteLength(codePoint: number): number {
	if (codePoint < 0x80) return 1;
	if (codePoint < 0x800) return 2;
	return codePoint < 0x10000 ? 3 : 4;
}

function matchGfmUrlAutolinkDetail(
	source: string,
	start: number,
): Readonly<{ end: number; rawEnd: number }> | null {
	GFM_URL_AUTOLINK_RE.lastIndex = start;
	const match = GFM_URL_AUTOLINK_RE.exec(source);
	if (!match) return null;
	const url = match[0];
	const rawEnd = start + url.length;
	let end = url.length;
	while (end > 1 && GFM_URL_TRAILING_PUNCTUATION.includes(url[end - 1] ?? "")) {
		end -= 1;
	}
	if (end > 3 && ";" === url[end - 1]) {
		let amp = end - 2;
		while (amp > 0 && isAsciiAlphaNum(url.charCodeAt(amp))) amp -= 1;
		if (amp > 0 && amp < end - 2 && "&" === url[amp]) end = amp;
	}
	if (")" === url[end - 1]) {
		let parens = 0;
		for (let i = 0; i < end; i += 1) {
			if (")" === url[i]) parens += 1;
			else if ("(" === url[i]) parens -= 1;
		}
		// PHP chops `diff` bytes; a partially chopped character still advances.
		while (parens > 0 && end > 0) {
			const low = url.charCodeAt(end - 1);
			const pair = low >= 0xdc00 && low <= 0xdfff && end > 1 ? 2 : 1;
			const bytes = utf8ByteLength(url.codePointAt(end - pair) ?? low);
			if (parens < bytes) break;
			parens -= bytes;
			end -= pair;
		}
	}
	return end > 0 ? { end: start + end, rawEnd } : null;
}

/**
 * Mirrors PHP `UrlAutolinkParser::parse()` (regex, trailing punctuation,
 * entity, and unmatched-paren trimming) at a prefix stop `start`, returning
 * the exclusive end of the consumed URL or `-1`. `ALLOWED_AFTER` is checked
 * by the caller.
 */
export function matchGfmUrlAutolink(source: string, start: number): number {
	return matchGfmUrlAutolinkDetail(source, start)?.end ?? -1;
}

/**
 * Returns the minimal trailing context right after `[from, to)` needed for
 * isolated PHP Preview ownership verification when a bare GFM URL or email
 * autolink retained trailing punctuation/suffix characters solely because
 * surrounding characters in `source` (such as `)` in `(https://x?)` or `.` in
 * `a@b.c_.`) were trimmed after punctuation/suffix checks. Returns `""` when
 * the isolated candidate already parses identically on its own.
 */
export function gfmAutolinkTrailingContext(
	source: string,
	from: number,
	to: number,
): string {
	if (from < 0 || to <= from || to >= source.length) return "";
	const candidate = source.slice(from, to);
	if (candidate.includes("\n") || candidate.includes("\r")) return "";
	if (GFM_URL_START_PREFIX_RE.test(candidate)) {
		if (matchGfmUrlAutolink(candidate, 0) === candidate.length) return "";
		const detail = matchGfmUrlAutolinkDetail(source, from);
		if (!detail || detail.end !== to || detail.rawEnd <= to) return "";
		return matchGfmUrlAutolink(source.slice(from, detail.rawEnd), 0) ===
			candidate.length
			? source.slice(to, detail.rawEnd)
			: "";
	}
	const last = candidate[candidate.length - 1];
	if (
		candidate.includes("@") &&
		("." === last || "-" === last || "_" === last) &&
		"." === source[to] &&
		(to + 1 >= source.length ||
			!isGfmEmailDomainTailChar(source.charCodeAt(to + 1)))
	) {
		return ".";
	}
	return "";
}

function findLineBreakEnd(source: string, start: number): number {
	let pos = start;
	while (pos < source.length) {
		const ch = source[pos];
		if ("\n" === ch || "\r" === ch) return pos;
		pos += 1;
	}
	return source.length;
}

/**
 * Single-line CommonMark §6.5 autolink and §6.6 inline raw HTML matcher.
 * Returns `needs-multiline` when an inline HTML construct legitimately crosses
 * a line break so the caller can fall back to the block-aware matcher.
 */
export function matchSingleLineInlineHtmlOrAutolink(
	source: string,
	start: number,
	guard: InlineHtmlScanGuard,
	knownLineEnd?: number,
): SingleLineInlineAngleResult {
	if ("<" !== source[start]) return { status: "none" };
	const lineEnd =
		undefined !== knownLineEnd ? knownLineEnd : findLineBreakEnd(source, start);
	const hasLineBreakAfter =
		lineEnd < source.length &&
		("\n" === source[lineEnd] || "\r" === source[lineEnd]);
	const next = source[start + 1];
	if (!next || start + 1 >= lineEnd) return { status: "none" };

	if (start < guard.noGtAfter) {
		const autolinkEnd = matchCommonMarkAutolinkOnLine(source, start, lineEnd);
		if (autolinkEnd >= 0) return { end: autolinkEnd, status: "ok" };
	}

	// HTML comments, CDATA, and declarations
	if ("!" === next) {
		if (source.startsWith("<!--", start) && start + 4 <= lineEnd) {
			if (start + 5 <= lineEnd && ">" === source[start + 4]) {
				return { end: start + 5, status: "ok" };
			}
			if (
				start + 6 <= lineEnd &&
				"-" === source[start + 4] &&
				">" === source[start + 5]
			) {
				return { end: start + 6, status: "ok" };
			}
			if (start + 4 >= guard.noCommentCloseAfter) return { status: "none" };
			const closeIdx = source.indexOf("-->", start + 4);
			if (closeIdx >= 0 && closeIdx + 3 <= lineEnd) {
				return { end: closeIdx + 3, status: "ok" };
			}
			if (hasLineBreakAfter) return { status: "needs-multiline" };
			guard.noCommentCloseAfter = Math.min(
				guard.noCommentCloseAfter,
				start + 4,
			);
			return { status: "none" };
		}
		if (source.startsWith("<![CDATA[", start) && start + 9 <= lineEnd) {
			if (start + 9 >= guard.noCdataCloseAfter) return { status: "none" };
			const closeIdx = source.indexOf("]]>", start + 9);
			if (closeIdx >= 0 && closeIdx + 3 <= lineEnd) {
				return { end: closeIdx + 3, status: "ok" };
			}
			if (hasLineBreakAfter) return { status: "needs-multiline" };
			guard.noCdataCloseAfter = Math.min(guard.noCdataCloseAfter, start + 9);
			return { status: "none" };
		}
		if (start + 2 < lineEnd && isAsciiLetter(source.charCodeAt(start + 2))) {
			let pos = start + 3;
			while (pos < lineEnd && isAsciiLetter(source.charCodeAt(pos))) pos += 1;
			if (pos >= guard.noGtAfter) return { status: "none" };
			const gtIdx = source.indexOf(">", pos);
			if (gtIdx >= 0 && gtIdx < lineEnd) {
				return { end: gtIdx + 1, status: "ok" };
			}
			if (hasLineBreakAfter) return { status: "needs-multiline" };
			guard.noGtAfter = Math.min(guard.noGtAfter, pos);
			return { status: "none" };
		}
		return { status: "none" };
	}

	// Processing instructions: <? ... ?>
	if ("?" === next) {
		if (start + 2 >= guard.noPiCloseAfter) return { status: "none" };
		const closeIdx = source.indexOf("?>", start + 2);
		if (closeIdx >= 0 && closeIdx + 2 <= lineEnd) {
			return { end: closeIdx + 2, status: "ok" };
		}
		if (hasLineBreakAfter) return { status: "needs-multiline" };
		guard.noPiCloseAfter = Math.min(guard.noPiCloseAfter, start + 2);
		return { status: "none" };
	}

	// Closing tag: </[a-z][a-z0-9-]*\s*>
	if ("/" === next) {
		if (start + 2 >= lineEnd || !isAsciiLower(source.charCodeAt(start + 2))) {
			return { status: "none" };
		}
		if (start >= guard.noGtAfter) return { status: "none" };
		let pos = start + 3;
		while (pos < lineEnd && isLowerTagNameChar(source.charCodeAt(pos))) {
			pos += 1;
		}
		while (pos < lineEnd && isHorizontalHtmlWhitespace(source[pos])) pos += 1;
		if (pos < lineEnd && ">" === source[pos]) {
			return { end: pos + 1, status: "ok" };
		}
		if (pos === lineEnd && hasLineBreakAfter) {
			return { status: "needs-multiline" };
		}
		return { status: "none" };
	}

	// Open tag (PHP HtmlInlineParser uses case-sensitive lowercase tag/attr names)
	if (!isAsciiLower(source.charCodeAt(start + 1))) return { status: "none" };
	if (start >= guard.noGtAfter) return { status: "none" };
	let pos = start + 2;
	while (pos < lineEnd && isLowerTagNameChar(source.charCodeAt(pos))) pos += 1;
	let hadLeadingWs = false;
	// Advance past every skipped quoted attribute value so `noGtAfter` only
	// covers characters literally scanned and proved free of `>`.
	let noGtFloor = start;
	while (pos < lineEnd) {
		const wsStart = pos;
		while (pos < lineEnd && isHorizontalHtmlWhitespace(source[pos])) pos += 1;
		if (pos > wsStart) hadLeadingWs = true;
		if (pos >= lineEnd) break;
		if (">" === source[pos]) return { end: pos + 1, status: "ok" };
		if ("/" === source[pos] && pos + 1 < lineEnd && ">" === source[pos + 1]) {
			return { end: pos + 2, status: "ok" };
		}
		if (!hadLeadingWs) return { status: "none" };
		if (!isLowerAttrStart(source.charCodeAt(pos))) return { status: "none" };
		pos += 1;
		while (pos < lineEnd && isLowerAttrChar(source.charCodeAt(pos))) pos += 1;
		const wsAfterStart = pos;
		while (pos < lineEnd && isHorizontalHtmlWhitespace(source[pos])) pos += 1;
		if (pos >= lineEnd) break;
		if ("=" !== source[pos]) {
			hadLeadingWs = pos > wsAfterStart;
			continue;
		}
		pos += 1;
		while (pos < lineEnd && isHorizontalHtmlWhitespace(source[pos])) pos += 1;
		if (pos >= lineEnd) break;
		const valCh = source[pos];
		if ('"' === valCh || "'" === valCh) {
			const noQuoteAfter =
				'"' === valCh ? guard.noDoubleQuoteAfter : guard.noSingleQuoteAfter;
			if (pos + 1 >= noQuoteAfter) return { status: "none" };
			const closeIdx = source.indexOf(valCh, pos + 1);
			if (closeIdx >= 0 && closeIdx < lineEnd) {
				pos = closeIdx + 1;
				noGtFloor = pos;
				hadLeadingWs = false;
				continue;
			}
			if (hasLineBreakAfter) return { status: "needs-multiline" };
			if ('"' === valCh) {
				guard.noDoubleQuoteAfter = Math.min(guard.noDoubleQuoteAfter, pos + 1);
			} else {
				guard.noSingleQuoteAfter = Math.min(guard.noSingleQuoteAfter, pos + 1);
			}
			return { status: "none" };
		}
		const valStart = pos;
		while (pos < lineEnd) {
			const ch = source[pos];
			if (!ch || !isUnquotedAttrChar(ch, source.charCodeAt(pos))) break;
			pos += 1;
		}
		if (pos === valStart) return { status: "none" };
		hadLeadingWs = false;
	}
	if (pos >= lineEnd && hasLineBreakAfter) return { status: "needs-multiline" };
	if (pos >= lineEnd && !hasLineBreakAfter && noGtFloor < lineEnd) {
		guard.noGtAfter = Math.min(guard.noGtAfter, noGtFloor);
	}
	return { status: "none" };
}

function findTokenInBlock(
	source: string,
	lines: ReadonlyArray<InlineHtmlSegment>,
	startSegIdx: number,
	startPos: number,
	groupEnd: number,
	token: string,
): BlockInlineAngleMatch | null {
	const blockEnd = lines[groupEnd]?.lineEnd ?? source.length;
	let segIdx = startSegIdx;
	let searchPos = startPos;
	while (segIdx <= groupEnd) {
		const found = source.indexOf(token, searchPos);
		if (found < 0 || found + token.length > blockEnd) return null;
		while (segIdx < groupEnd && (lines[segIdx]?.lineEnd ?? 0) <= found) {
			segIdx += 1;
		}
		const seg = lines[segIdx];
		if (!seg) return null;
		if (found >= seg.contentOffset && found + token.length <= seg.lineEnd) {
			return { pos: found + token.length, segIdx };
		}
		if (found < seg.contentOffset) {
			searchPos = seg.contentOffset;
		} else {
			segIdx += 1;
			searchPos = lines[segIdx]?.contentOffset ?? blockEnd;
		}
	}
	return null;
}

function skipBlockHtmlWhitespace(
	source: string,
	lines: ReadonlyArray<InlineHtmlSegment>,
	startSegIdx: number,
	startPos: number,
	groupEnd: number,
): Readonly<{ consumed: boolean; pos: number; segIdx: number }> {
	let segIdx = startSegIdx;
	let pos = startPos;
	let consumed = false;
	while (segIdx <= groupEnd) {
		const seg = lines[segIdx];
		if (!seg) break;
		while (pos < seg.lineEnd && isHorizontalHtmlWhitespace(source[pos])) {
			pos += 1;
			consumed = true;
		}
		if (pos < seg.lineEnd) break;
		if (segIdx >= groupEnd) break;
		// Crossing segment boundary acts as a virtual `\n` (HTML whitespace).
		segIdx += 1;
		pos = lines[segIdx]?.contentOffset ?? 0;
		consumed = true;
	}
	return { consumed, pos, segIdx };
}

/**
 * Block-aware CommonMark §6.5 autolink and §6.6 inline raw HTML matcher.
 * Respects inline-block segment boundaries and container prefixes without
 * crossing blank lines or polynomial backtracking.
 */
export function matchBlockInlineHtmlOrAutolink(
	source: string,
	lines: ReadonlyArray<InlineHtmlSegment>,
	startSegIdx: number,
	startPos: number,
	groupEnd: number,
	guard: InlineHtmlScanGuard,
): BlockInlineAngleMatch | null {
	const startSeg = lines[startSegIdx];
	if (!startSeg || startPos >= startSeg.lineEnd || "<" !== source[startPos]) {
		return null;
	}
	const lineEnd = startSeg.lineEnd;
	if (startPos + 1 >= lineEnd) return null;
	const next = source[startPos + 1];

	if (startPos < guard.noGtAfter) {
		const autolinkEnd = matchCommonMarkAutolinkOnLine(source, startPos, lineEnd);
		if (autolinkEnd >= 0) return { pos: autolinkEnd, segIdx: startSegIdx };
	}

	// HTML comments, CDATA, and declarations
	if ("!" === next) {
		if (source.startsWith("<!--", startPos) && startPos + 4 <= lineEnd) {
			if (startPos + 5 <= lineEnd && ">" === source[startPos + 4]) {
				return { pos: startPos + 5, segIdx: startSegIdx };
			}
			if (
				startPos + 6 <= lineEnd &&
				"-" === source[startPos + 4] &&
				">" === source[startPos + 5]
			) {
				return { pos: startPos + 6, segIdx: startSegIdx };
			}
			if (startPos + 4 >= guard.noCommentCloseAfter) return null;
			const match = findTokenInBlock(
				source,
				lines,
				startSegIdx,
				startPos + 4,
				groupEnd,
				"-->",
			);
			if (match) return match;
			guard.noCommentCloseAfter = Math.min(
				guard.noCommentCloseAfter,
				startPos + 4,
			);
			return null;
		}
		if (source.startsWith("<![CDATA[", startPos) && startPos + 9 <= lineEnd) {
			if (startPos + 9 >= guard.noCdataCloseAfter) return null;
			const match = findTokenInBlock(
				source,
				lines,
				startSegIdx,
				startPos + 9,
				groupEnd,
				"]]>",
			);
			if (match) return match;
			guard.noCdataCloseAfter = Math.min(guard.noCdataCloseAfter, startPos + 9);
			return null;
		}
		if (
			startPos + 2 < lineEnd &&
			isAsciiLetter(source.charCodeAt(startPos + 2))
		) {
			let pos = startPos + 3;
			while (pos < lineEnd && isAsciiLetter(source.charCodeAt(pos))) pos += 1;
			if (pos >= guard.noGtAfter) return null;
			const match = findTokenInBlock(
				source,
				lines,
				startSegIdx,
				pos,
				groupEnd,
				">",
			);
			if (match) return match;
			guard.noGtAfter = Math.min(guard.noGtAfter, pos);
			return null;
		}
		return null;
	}

	// Processing instructions: <? ... ?>
	if ("?" === next) {
		if (startPos + 2 >= guard.noPiCloseAfter) return null;
		const match = findTokenInBlock(
			source,
			lines,
			startSegIdx,
			startPos + 2,
			groupEnd,
			"?>",
		);
		if (match) return match;
		guard.noPiCloseAfter = Math.min(guard.noPiCloseAfter, startPos + 2);
		return null;
	}

	// Closing tag: </[a-z][a-z0-9-]*\s*>
	if ("/" === next) {
		if (
			startPos + 2 >= lineEnd ||
			!isAsciiLower(source.charCodeAt(startPos + 2))
		) {
			return null;
		}
		if (startPos >= guard.noGtAfter) return null;
		let pos = startPos + 3;
		while (pos < lineEnd && isLowerTagNameChar(source.charCodeAt(pos))) {
			pos += 1;
		}
		const afterWs = skipBlockHtmlWhitespace(
			source,
			lines,
			startSegIdx,
			pos,
			groupEnd,
		);
		const seg = lines[afterWs.segIdx];
		if (seg && afterWs.pos < seg.lineEnd && ">" === source[afterWs.pos]) {
			return { pos: afterWs.pos + 1, segIdx: afterWs.segIdx };
		}
		return null;
	}

	// Open tag (PHP HtmlInlineParser uses case-sensitive lowercase tag/attr names)
	if (!isAsciiLower(source.charCodeAt(startPos + 1))) return null;
	if (startPos >= guard.noGtAfter) return null;
	const blockEnd = lines[groupEnd]?.lineEnd ?? source.length;
	let segIdx = startSegIdx;
	let pos = startPos + 2;
	while (pos < lineEnd && isLowerTagNameChar(source.charCodeAt(pos))) pos += 1;
	let hadLeadingWs = false;
	// Advance past every skipped quoted attribute value so `noGtAfter` only
	// covers characters literally scanned and proved free of `>`.
	let noGtFloor = startPos;

	while (segIdx <= groupEnd) {
		const ws = skipBlockHtmlWhitespace(source, lines, segIdx, pos, groupEnd);
		segIdx = ws.segIdx;
		pos = ws.pos;
		if (ws.consumed) hadLeadingWs = true;
		const seg = lines[segIdx];
		if (!seg || pos >= seg.lineEnd) {
			if (noGtFloor < blockEnd) {
				guard.noGtAfter = Math.min(guard.noGtAfter, noGtFloor);
			}
			return null;
		}
		if (">" === source[pos]) return { pos: pos + 1, segIdx };
		if ("/" === source[pos] && pos + 1 < seg.lineEnd && ">" === source[pos + 1]) {
			return { pos: pos + 2, segIdx };
		}
		if (!hadLeadingWs) return null;
		if (!isLowerAttrStart(source.charCodeAt(pos))) return null;
		pos += 1;
		while (pos < seg.lineEnd && isLowerAttrChar(source.charCodeAt(pos))) {
			pos += 1;
		}
		const afterNameWs = skipBlockHtmlWhitespace(
			source,
			lines,
			segIdx,
			pos,
			groupEnd,
		);
		segIdx = afterNameWs.segIdx;
		pos = afterNameWs.pos;
		const eqSeg = lines[segIdx];
		if (!eqSeg || pos >= eqSeg.lineEnd) {
			if (noGtFloor < blockEnd) {
				guard.noGtAfter = Math.min(guard.noGtAfter, noGtFloor);
			}
			return null;
		}
		if ("=" !== source[pos]) {
			hadLeadingWs = afterNameWs.consumed;
			continue;
		}
		const afterEqWs = skipBlockHtmlWhitespace(
			source,
			lines,
			segIdx,
			pos + 1,
			groupEnd,
		);
		segIdx = afterEqWs.segIdx;
		pos = afterEqWs.pos;
		const valSeg = lines[segIdx];
		if (!valSeg || pos >= valSeg.lineEnd) {
			if (noGtFloor < blockEnd) {
				guard.noGtAfter = Math.min(guard.noGtAfter, noGtFloor);
			}
			return null;
		}
		const valCh = source[pos];
		if ('"' === valCh || "'" === valCh) {
			const noQuoteAfter =
				'"' === valCh ? guard.noDoubleQuoteAfter : guard.noSingleQuoteAfter;
			if (pos + 1 >= noQuoteAfter) return null;
			const closeQuote = findTokenInBlock(
				source,
				lines,
				segIdx,
				pos + 1,
				groupEnd,
				valCh,
			);
			if (!closeQuote) {
				if ('"' === valCh) {
					guard.noDoubleQuoteAfter = Math.min(
						guard.noDoubleQuoteAfter,
						pos + 1,
					);
				} else {
					guard.noSingleQuoteAfter = Math.min(
						guard.noSingleQuoteAfter,
						pos + 1,
					);
				}
				return null;
			}
			segIdx = closeQuote.segIdx;
			pos = closeQuote.pos;
			noGtFloor = pos;
			hadLeadingWs = false;
			continue;
		}
		const valStart = pos;
		while (pos < valSeg.lineEnd) {
			const ch = source[pos];
			if (!ch || !isUnquotedAttrChar(ch, source.charCodeAt(pos))) break;
			pos += 1;
		}
		if (pos === valStart) return null;
		hadLeadingWs = false;
	}
	return null;
}
