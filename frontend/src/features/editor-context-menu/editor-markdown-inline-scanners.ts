import type { InlineContext } from "@lezer/markdown";

import {
	type BacktickRunBucket,
	findNextBacktickCloser,
	indexBacktickRunsByLength,
} from "../../shared/markdown/markdown-backtick-scanners";
import {
	hasMultibyteCodeUnit,
	isAsciiLetterCode,
	isAsciiWordCode,
	isJsWhitespaceCode,
} from "../../shared/markdown/markdown-char-codes";
import {
	type AngleScanCache,
	createAngleScanCache,
	getLastAt,
	getLastCloseAngle,
	LEAGUE_HTML_ASCII_DIALECT,
	LEAGUE_HTML_MULTIBYTE_DIALECT,
	LEZER_HTML_DIALECT,
	matchAngleEmailAutolinkAt,
	matchHtmlInlineTokenAt,
	matchLeagueAngleUriAt,
} from "../../shared/markdown/markdown-html-scanners";

/**
 * Worker-safe linear Lezer `InlineContext` adapters (`InlineCode`, `HTMLTag`,
 * `HardBreak`).
 */

type InlineScanCache = AngleScanCache & {
	backtickBucketsBySize: Map<number, BacktickRunBucket> | null;
	failedSpaceRunEnd: number;
	failedUrlFrom: number;
	failedUrlTo: number;
	hasMultibyte: boolean | null;
};

const INLINE_SCAN_CACHE = new WeakMap<InlineContext, InlineScanCache>();

function getInlineScanCache(cx: InlineContext): InlineScanCache {
	let cache = INLINE_SCAN_CACHE.get(cx);
	if (!cache) {
		cache = {
			...createAngleScanCache(),
			backtickBucketsBySize: null,
			failedSpaceRunEnd: -1,
			failedUrlFrom: -1,
			failedUrlTo: -1,
			hasMultibyte: null,
		};
		INLINE_SCAN_CACHE.set(cx, cache);
	}
	return cache;
}

function getHasMultibyte(text: string, cache: InlineScanCache): boolean {
	if (null === cache.hasMultibyte) {
		cache.hasMultibyte = hasMultibyteCodeUnit(text);
	}
	return cache.hasMultibyte;
}

function isUriSchemeRestCode(code: number): boolean {
	return (
		isAsciiWordCode(code) ||
		45 /* - */ === code ||
		43 /* + */ === code ||
		46 /* . */ === code
	);
}

function matchAngleUriAutolink(
	text: string,
	afterStart: number,
	len: number,
	cache: InlineScanCache,
): number {
	if (afterStart >= cache.failedUrlFrom && afterStart < cache.failedUrlTo) {
		return -1;
	}
	if (!isAsciiLetterCode(text.charCodeAt(afterStart))) return -1;
	let p = afterStart + 1;
	while (p < len && isUriSchemeRestCode(text.charCodeAt(p))) p += 1;
	if (p === afterStart + 1 || p >= len || 58 /* : */ !== text.charCodeAt(p)) {
		return -1;
	}
	const bodyStart = p + 1;
	let q = bodyStart;
	while (q < len) {
		const ch = text.charCodeAt(q);
		if (62 /* > */ === ch) {
			return q > bodyStart ? q + 1 : -1;
		}
		if (isJsWhitespaceCode(ch)) break;
		q += 1;
	}
	if (q > bodyStart && q > cache.failedUrlTo) {
		cache.failedUrlFrom = bodyStart;
		cache.failedUrlTo = q;
	}
	return -1;
}

function parseLinearHtmlTagWithMode(
	cx: InlineContext,
	next: number,
	start: number,
	leagueMode: boolean,
): number {
	if (60 /* < */ !== next || start === cx.end - 1) return -1;
	const text = cx.text;
	const len = text.length;
	const afterStart = start - cx.offset + 1;
	const cache = getInlineScanCache(cx);
	if (getLastCloseAngle(text, cache) <= afterStart) return -1;

	let autolinkLocalEnd: number;
	if (leagueMode) {
		const emailLocalEnd = matchAngleEmailAutolinkAt(
			text,
			afterStart,
			len,
			getLastAt(text, cache),
		);
		autolinkLocalEnd =
			emailLocalEnd >= 0
				? emailLocalEnd
				: matchLeagueAngleUriAt(text, afterStart, len);
	} else {
		const uriLocalEnd = matchAngleUriAutolink(text, afterStart, len, cache);
		autolinkLocalEnd =
			uriLocalEnd >= 0
				? uriLocalEnd
				: matchAngleEmailAutolinkAt(
						text,
						afterStart,
						len,
						getLastAt(text, cache),
					);
	}
	if (autolinkLocalEnd >= 0) {
		const absEnd = autolinkLocalEnd + cx.offset;
		return cx.addElement(
			cx.elt("Autolink", start, absEnd, [
				cx.elt("LinkMark", start, start + 1),
				cx.elt("URL", start + 1, absEnd - 1),
				cx.elt("LinkMark", absEnd - 1, absEnd),
			]),
		);
	}

	const dialect = leagueMode
		? getHasMultibyte(text, cache)
			? LEAGUE_HTML_MULTIBYTE_DIALECT
			: LEAGUE_HTML_ASCII_DIALECT
		: LEZER_HTML_DIALECT;
	const matched = matchHtmlInlineTokenAt(
		text,
		afterStart,
		len,
		cache,
		dialect,
		leagueMode,
	);
	return matched
		? cx.addElement(cx.elt(matched.nodeName, start, matched.end + cx.offset))
		: -1;
}

/**
 * Strictly O(N) linear replacement for `@lezer/markdown`'s `HTMLTag` inline
 * parser (angle-bracket `Autolink`, `Comment`, `ProcessingInstruction`, and
 * `HTMLTag`), matching upstream AST nodes and offsets 1:1 without allocating
 * full-suffix `cx.slice(start + 1, cx.end)` substrings.
 */
export function parseLinearHtmlTag(
	cx: InlineContext,
	next: number,
	start: number,
): number {
	return parseLinearHtmlTagWithMode(cx, next, start, false);
}

/**
 * Strictly O(N) League CommonMark 2.8.2 `HtmlInlineParser` + angle
 * `AutolinkParser` inline parser emitting `Autolink`, `Comment`,
 * `ProcessingInstruction`, and `HTMLTag` nodes with exact PHP 8.3 / League
 * 2.8.2 parity.
 */
export function parseLinearLeagueHtmlTag(
	cx: InlineContext,
	next: number,
	start: number,
): number {
	return parseLinearHtmlTagWithMode(cx, next, start, true);
}

/**
 * Strictly O(N) linear replacement for `@lezer/markdown`'s `HardBreak` inline
 * parser, caching failed space runs so long runs of trailing spaces never
 * rescan quadratically.
 */
export function parseLinearHardBreak(
	cx: InlineContext,
	next: number,
	start: number,
): number {
	if (92 /* \ */ === next && 10 /* \n */ === cx.char(start + 1)) {
		return cx.addElement(cx.elt("HardBreak", start, start + 2));
	}
	if (32 /* space */ === next) {
		const text = cx.text;
		const localStart = start - cx.offset;
		if (
			localStart + 1 >= text.length ||
			32 !== text.charCodeAt(localStart + 1)
		) {
			return -1;
		}
		const cache = getInlineScanCache(cx);
		if (localStart < cache.failedSpaceRunEnd) return -1;
		let pos = localStart + 2;
		while (pos < text.length && 32 === text.charCodeAt(pos)) pos += 1;
		if (pos < text.length && 10 /* \n */ === text.charCodeAt(pos)) {
			return cx.addElement(cx.elt("HardBreak", start, pos + 1 + cx.offset));
		}
		if (pos > cache.failedSpaceRunEnd) cache.failedSpaceRunEnd = pos;
	}
	return -1;
}

/**
 * Strictly O(N) linear replacement for `@lezer/markdown`'s `InlineCode` inline
 * parser, lazily indexing maximal backtick run starts by run length with a
 * monotonically advancing per-length cursor.
 */
export function parseLinearInlineCode(
	cx: InlineContext,
	next: number,
	start: number,
): number {
	if (96 /* ` */ !== next) return -1;
	const text = cx.text;
	const localStart = start - cx.offset;
	if (localStart > 0 && 96 === text.charCodeAt(localStart - 1)) return -1;

	let runEnd = localStart + 1;
	while (runEnd < text.length && 96 === text.charCodeAt(runEnd)) runEnd += 1;
	const size = runEnd - localStart;

	const cache = getInlineScanCache(cx);
	let bucketsBySize = cache.backtickBucketsBySize;
	if (!bucketsBySize) {
		bucketsBySize = indexBacktickRunsByLength(text);
		cache.backtickBucketsBySize = bucketsBySize;
	}

	const closeLocalStart = findNextBacktickCloser(
		bucketsBySize,
		size,
		localStart + 1,
		true,
	);
	if (closeLocalStart < 0) return -1;
	const closeStart = closeLocalStart + cx.offset;
	const closeEnd = closeStart + size;
	return cx.addElement(
		cx.elt("InlineCode", start, closeEnd, [
			cx.elt("CodeMark", start, start + size),
			cx.elt("CodeMark", closeStart, closeEnd),
		]),
	);
}
