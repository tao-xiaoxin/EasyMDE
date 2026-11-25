/**
 * Linear-time GFM autolink scanner and trailing-context helper mirroring PHP
 * `League\CommonMark\Extension\Autolink\EmailAutolinkParser` and
 * `UrlAutolinkParser` (including UTF-8 byte-based unmatched-paren trimming).
 */

const GFM_URL_AUTOLINK_PREFIX_RE = /www\.|http:\/\/|https:\/\/|ftp:\/\//gi;
const GFM_WWW_PREFIX_RE = /www\./iu;
const GFM_URL_TRAILING_PUNCTUATION = "?!.,:*_~";
const GFM_URL_START_PREFIX_RE = /^(?:https?:\/\/|ftp:\/\/|www\.)/iu;
const GFM_EMAIL_AUTOLINK_FULL_RE =
	/^[A-Za-z0-9.\-_+]+@[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.]+$/;
const GFM_URL_INERT_ENTITY_SUFFIX = "&easymde;";

export type GfmAutolinkStops = Readonly<{
	/** Non-overlapping `EmailAutolinkParser` match starts mapped to match ends. */
	emails: ReadonlyMap<number, number>;
	/** Non-overlapping `UrlAutolinkParser` prefix (`www.`, `http://`, …) starts. */
	urls: ReadonlySet<number>;
}>;

export type GfmUrlAutolinkMatch = Readonly<{
	/** Exclusive UTF-16 offset where PHP `Cursor::advanceBy(mb_strlen($url, 'UTF-8'))` stops. */
	end: number;
	/**
	 * Trailing UTF-8 bytes sliced off the final code point in
	 * `source.slice(start, end)` by PHP `substr($url, 0, -$diff)` (`0` when cut
	 * on a code-point boundary, otherwise `1..3`).
	 */
	missingTrailingBytes: number;
	/** Exclusive UTF-16 offset of the raw regex match prior to trimming. */
	rawEnd: number;
}>;

const EMPTY_GFM_AUTOLINK_STOPS: GfmAutolinkStops = {
	emails: new Map<number, number>(),
	urls: new Set<number>(),
};

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

function isAsciiAlphaNum(code: number): boolean {
	return (
		(code >= 0x41 && code <= 0x5a) ||
		(code >= 0x61 && code <= 0x7a) ||
		(code >= 0x30 && code <= 0x39)
	);
}

export function isGfmEmailLocalChar(code: number): boolean {
	return (
		isAsciiAlphaNum(code) ||
		0x2e === code || // .
		0x2d === code || // -
		0x5f === code || // _
		0x2b === code // +
	);
}

export function isGfmEmailDomainFirstChar(code: number): boolean {
	return (
		isAsciiAlphaNum(code) ||
		0x2d === code || // -
		0x5f === code // _
	);
}

function isGfmEmailDomainTailChar(code: number): boolean {
	return isGfmEmailDomainFirstChar(code) || 0x2e === code; // .
}

/**
 * Fast O(N) check for whether `source` could contain any PHP `AutolinkExtension`
 * email (`@`) or URL (`http://`, `https://`, `ftp://`, `www.`) autolink.
 */
export function hasPotentialGfmAutolinkTrigger(source: string): boolean {
	if (source.includes("@") || source.includes("://")) return true;
	return source.includes(".") && GFM_WWW_PREFIX_RE.test(source);
}

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
	const boundedFrom = Math.max(0, from);
	const boundedTo = Math.min(source.length, to);
	if (boundedFrom >= boundedTo) return EMPTY_GFM_AUTOLINK_STOPS;

	// Slice the line once so every `indexOf` and regex search is strictly
	// bounded to `[from, to)` and can never walk across subsequent lines.
	const line =
		0 === boundedFrom && boundedTo === source.length
			? source
			: source.slice(boundedFrom, boundedTo);

	let emails: Map<number, number> | null = null;
	let floor = 0;
	let searchPos = line.indexOf("@", 0);
	while (searchPos >= 0) {
		const at = searchPos;
		let start = at;
		while (start > floor && isGfmEmailLocalChar(line.charCodeAt(start - 1))) {
			start -= 1;
		}
		if (start < at) {
			let pos = at + 1;
			while (
				pos < line.length &&
				isGfmEmailDomainFirstChar(line.charCodeAt(pos))
			) {
				pos += 1;
			}
			if (
				pos > at + 1 &&
				pos < line.length &&
				0x2e === line.charCodeAt(pos)
			) {
				pos += 1;
				const tailStart = pos;
				while (
					pos < line.length &&
					isGfmEmailDomainTailChar(line.charCodeAt(pos))
				) {
					pos += 1;
				}
				if (pos > tailStart) {
					if (!emails) emails = new Map<number, number>();
					emails.set(boundedFrom + start, boundedFrom + pos);
					floor = pos;
					searchPos = line.indexOf("@", pos);
					continue;
				}
			}
		}
		searchPos = line.indexOf("@", at + 1);
	}

	let urls: Set<number> | null = null;
	if (line.includes(".") || line.includes(":")) {
		GFM_URL_AUTOLINK_PREFIX_RE.lastIndex = 0;
		let match = GFM_URL_AUTOLINK_PREFIX_RE.exec(line);
		while (null !== match) {
			if (!urls) urls = new Set<number>();
			urls.add(boundedFrom + match.index);
			match = GFM_URL_AUTOLINK_PREFIX_RE.exec(line);
		}
	}

	if (!emails && !urls) return EMPTY_GFM_AUTOLINK_STOPS;
	return {
		emails: emails ?? EMPTY_GFM_AUTOLINK_STOPS.emails,
		urls: urls ?? EMPTY_GFM_AUTOLINK_STOPS.urls,
	};
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

function utf8CodePointByteLength(codePoint: number): number {
	if (codePoint < 0x80) return 1;
	if (codePoint < 0x800) return 2;
	return codePoint < 0x10000 ? 3 : 4;
}

function countUnbalancedClosingParens(value: string, length: number): number {
	let parens = 0;
	for (let i = 0; i < length; i += 1) {
		const ch = value[i];
		if (")" === ch) parens += 1;
		else if ("(" === ch) parens -= 1;
	}
	return parens;
}

/**
 * Mirrors PHP `UrlAutolinkParser::parse()` (regex, trailing punctuation,
 * entity, and UTF-8 byte-based unmatched-paren trimming) at `start`.
 */
export function matchGfmUrlAutolinkDetail(
	source: string,
	start: number,
): GfmUrlAutolinkMatch | null {
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
	let missingTrailingBytes = 0;
	if (")" === url[end - 1]) {
		let parens = countUnbalancedClosingParens(url, end);
		// PHP chops `diff` UTF-8 bytes (`substr($url, 0, -$diff)`) and then
		// advances the cursor by `mb_strlen($url, 'UTF-8')`. A partially chopped
		// multi-byte UTF-8 sequence still counts as one character in `mb_strlen`,
		// while `missingTrailingBytes` records the bytes sliced off its tail.
		while (parens > 0 && end > 0) {
			const low = url.charCodeAt(end - 1);
			const isSurrogatePair =
				low >= 0xdc00 &&
				low <= 0xdfff &&
				end > 1 &&
				url.charCodeAt(end - 2) >= 0xd800 &&
				url.charCodeAt(end - 2) <= 0xdbff;
			const pair = isSurrogatePair ? 2 : 1;
			const bytes = utf8CodePointByteLength(url.codePointAt(end - pair) ?? low);
			if (parens < bytes) {
				missingTrailingBytes = parens;
				break;
			}
			parens -= bytes;
			end -= pair;
		}
	}
	return end > 0 ? { end: start + end, missingTrailingBytes, rawEnd } : null;
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
 * Returns the minimal inert ASCII trailing context right after `[from, to)`
 * needed for isolated PHP Preview ownership verification when a bare GFM URL
 * or email autolink retained trailing punctuation/suffix characters or had
 * partial UTF-8 bytes sliced off its final code point solely because
 * surrounding characters in `source` (such as `)` in `(https://x?)` or
 * `(https://x/a)é)`, `&amp;` in `https://example.com?&amp;`, `*x*)))))))` in
 * `https://example.com?a)))*x*)))))))`, or `.` in `www.a@b.c_.`) triggered
 * post-regex trimming. Synthesizes an inert ASCII suffix for URL autolinks so
 * HTML entities, non-ASCII text, or Markdown formatting in the stripped tail
 * never decode, mojibake, or emit extra nodes in Preview. Returns `""` when
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
	const last = candidate[candidate.length - 1];
	// Mirror PHP `AutolinkExtension`: `EmailAutolinkParser` runs before
	// `UrlAutolinkParser`, so `www.`-prefixed emails like `www.a@b.c_.` keep
	// email precedence instead of falling into URL prefix checks.
	if (
		("." === last || "-" === last || "_" === last) &&
		"." === source[to] &&
		(to + 1 >= source.length ||
			!isGfmEmailDomainTailChar(source.charCodeAt(to + 1))) &&
		GFM_EMAIL_AUTOLINK_FULL_RE.test(`${candidate}.`)
	) {
		return ".";
	}
	if (!GFM_URL_START_PREFIX_RE.test(candidate)) return "";
	const detail = matchGfmUrlAutolinkDetail(source, from);
	if (!detail || detail.end !== to || detail.rawEnd <= to) return "";
	if (0 === detail.missingTrailingBytes) {
		const isolated = matchGfmUrlAutolinkDetail(candidate, 0);
		if (
			isolated &&
			isolated.end === candidate.length &&
			0 === isolated.missingTrailingBytes
		) {
			return "";
		}
	}
	const diff = countUnbalancedClosingParens(candidate, candidate.length);
	const suffix =
		detail.missingTrailingBytes > 0
			? `${"a".repeat(Math.max(0, diff - detail.missingTrailingBytes))})`
			: ")" === last && diff > 0
				? `${"a".repeat(diff)})`
				: 0 === diff
					? ")"
					: GFM_URL_INERT_ENTITY_SUFFIX;
	const verified = matchGfmUrlAutolinkDetail(`${candidate}${suffix}`, 0);
	return verified &&
		verified.end === candidate.length &&
		verified.missingTrailingBytes === detail.missingTrailingBytes
		? suffix
		: "";
}
