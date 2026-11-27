import type { SourceRange } from "../../shared/markdown/markdown-source-projection";
import { isAsciiAlnumCode } from "../../shared/markdown/markdown-char-codes";

// League\CommonMark\Extension\Autolink\UrlAutolinkParser constants & sticky matchers
const GFM_TRAILING_PUNCT = new Set(["?", "!", ".", ",", ":", "*", "_", "~"]);
const GFM_ALLOWED_PREFIX = new Set([" ", "\t", "\n", "\x0b", "\x0c", "\x0d", "*", "_", "~", "("]);
const URL_AUTOLINK_FAST_CHECK = /(?:https?|ftp):\/\/|www\./iu;
const URL_PREFIX_PATTERN = /(?:(?:https?|ftp):\/\/|www\.)/giu;
const URL_USERINFO_PART_STICKY = /(?:[\p{L}\p{N}_.-]|%[0-9a-f]{2})+/giyu;
const URL_PUNYCODE_STICKY = /xn--[a-z0-9-]+/giyu;
const URL_HOST_LABEL_STICKY = /[\p{L}\p{N}\p{S}\p{M}_-]+/yu;
const URL_TLD_STICKY = /[\p{L}\p{N}\p{M}]+/yu;
const URL_SINGLE_HOST_STICKY = /[a-z0-9_-]+\.?/giyu;
const URL_PORT_STICKY = /:[0-9]+/yu;
const URL_PATH_STICKY = /(?:[\p{L}\p{N}\-._~!$&'()*+,;=:@/]|%[0-9a-f]{2})+/giyu;
const URL_QUERY_STICKY = /(?:[\p{L}\p{N}\-._~!$&'[\]()*+,;=:@/?]|%[0-9a-f]{2})+/giyu;
const URL_FRAGMENT_STICKY = /(?:[\p{L}\p{N}\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})+/giyu;
const URL_ENTITY_SUFFIX = /&[A-Za-z0-9]+;$/u;
const IPV4_OCTET_PATTERN = /^(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9])$/u;
const IPV6_HEXTET_PATTERN = /^[0-9a-f]{1,4}$/iu;
const MAX_IPV6_INTERIOR_LENGTH = 46;

export type UrlAutolinkPrefixMatch = Readonly<{
	from: number;
	isProtocol: boolean;
	prefixLength: number;
}>;

/**
 * Per-segment monotonic negative-match cache for `matchLeagueUrlAutolinkAt`
 * scoped to one fixed `(text, runTo)` segment so repeated failed multi-level
 * domain probes never rescan quadratically.
 */
export type UrlAutolinkScanState = {
	failedDomainEnd: number;
	failedDomainStart: number;
};

export function createUrlAutolinkScanState(): UrlAutolinkScanState {
	return {
		failedDomainEnd: -1,
		failedDomainStart: -1,
	};
}

function isIpv6InteriorCharCode(code: number): boolean {
	return (
		(code >= 48 && code <= 57) ||
		(code >= 65 && code <= 70) ||
		(code >= 97 && code <= 102) ||
		58 === code ||
		46 === code
	);
}

function stickyEnd(
	pattern: RegExp,
	text: string,
	pos: number,
	limit: number,
): number {
	if (pos >= limit) return -1;
	pattern.lastIndex = pos;
	const match = pattern.exec(text);
	return match ? Math.min(limit, pos + match[0].length) : -1;
}

function matchUrlUserinfoEnd(
	text: string,
	pos: number,
	limit: number,
): number {
	const firstEnd = stickyEnd(URL_USERINFO_PART_STICKY, text, pos, limit);
	if (firstEnd <= pos) return -1;
	let scan = firstEnd;
	if (scan < limit && ":" === text[scan]) {
		const secondEnd = stickyEnd(
			URL_USERINFO_PART_STICKY,
			text,
			scan + 1,
			limit,
		);
		if (secondEnd <= scan + 1) return -1;
		scan = secondEnd;
	}
	return scan < limit && "@" === text[scan] ? scan + 1 : -1;
}

function countIpv6Slots(
	parts: ReadonlyArray<string>,
	allowIpv4: boolean,
): number {
	let slots = 0;
	for (let i = 0; i < parts.length; i += 1) {
		const part = parts[i] ?? "";
		if (allowIpv4 && i === parts.length - 1 && part.includes(".")) {
			const octets = part.split(".");
			if (
				4 !== octets.length ||
				!octets.every((o) => IPV4_OCTET_PATTERN.test(o))
			) {
				return -1;
			}
			slots += 2;
		} else if (IPV6_HEXTET_PATTERN.test(part)) {
			slots += 1;
		} else {
			return -1;
		}
	}
	return slots;
}

function isValidIpv6Interior(inner: string): boolean {
	if (0 === inner.length || inner.length > MAX_IPV6_INTERIOR_LENGTH) {
		return false;
	}
	const dc = inner.indexOf("::");
	if (dc >= 0) {
		if (inner.indexOf("::", dc + 2) >= 0) return false;
		const left = inner.slice(0, dc);
		const right = inner.slice(dc + 2);
		const leftSlots = left ? countIpv6Slots(left.split(":"), false) : 0;
		const rightSlots = right ? countIpv6Slots(right.split(":"), true) : 0;
		return leftSlots >= 0 && rightSlots >= 0 && leftSlots + rightSlots <= 7;
	}
	return 8 === countIpv6Slots(inner.split(":"), true);
}

function matchUrlHost(
	text: string,
	pos: number,
	limit: number,
	state: UrlAutolinkScanState,
): number {
	if (pos >= limit) return -1;
	if ("[" === text[pos]) {
		const maxScan = Math.min(limit, pos + 1 + MAX_IPV6_INTERIOR_LENGTH);
		let scan = pos + 1;
		while (scan < maxScan && isIpv6InteriorCharCode(text.charCodeAt(scan))) {
			scan += 1;
		}
		return scan > pos + 1 &&
			scan < limit &&
			"]" === text[scan] &&
			isValidIpv6Interior(text.slice(pos + 1, scan))
			? scan + 1
			: -1;
	}
	// Alternative 1: Punycode `(?:xn--[a-z0-9-]++\.)*+xn--[a-z0-9-]++\.?`
	if (pos + 4 < limit && "xn--" === text.slice(pos, pos + 4).toLowerCase()) {
		let cursor = pos;
		while (cursor < limit) {
			const labelEnd = stickyEnd(URL_PUNYCODE_STICKY, text, cursor, limit);
			if (labelEnd < 0) break;
			if (labelEnd < limit && "." === text[labelEnd]) {
				cursor = labelEnd + 1;
				continue;
			}
			return labelEnd;
		}
	}
	// Alternative 2: Multi-level Unicode domain (also subsumes IPv4)
	if (pos < state.failedDomainStart || pos >= state.failedDomainEnd) {
		const labels: SourceRange[] = [];
		let scan = pos;
		while (scan < limit && labels.length < 128) {
			const labelEnd = stickyEnd(URL_HOST_LABEL_STICKY, text, scan, limit);
			if (labelEnd <= scan) break;
			labels.push({ from: scan, to: labelEnd });
			scan = labelEnd;
			if (scan < limit && "." === text[scan]) scan += 1;
			else break;
		}
		if (labels.length >= 2) {
			for (let idx = Math.min(127, labels.length - 1); idx >= 1; idx -= 1) {
				const last = labels[idx];
				if (!last) continue;
				const tldEnd = stickyEnd(URL_TLD_STICKY, text, last.from, last.to);
				if (tldEnd > last.from) {
					return tldEnd === last.to && tldEnd < limit && "." === text[tldEnd]
						? tldEnd + 1
						: tldEnd;
				}
			}
			const secondLabel = labels[1];
			if (secondLabel) {
				let failedEnd = scan;
				if (128 === labels.length && scan < limit && "." === text[scan - 1]) {
					// Continue scanning the dotted run to find either its end or the
					// first label with a valid TLD, caching every unreachable prefix.
					const extraStarts: number[] = [];
					let hitValidTld = false;
					while (scan < limit) {
						const labelEnd = stickyEnd(URL_HOST_LABEL_STICKY, text, scan, limit);
						if (labelEnd <= scan) break;
						if (stickyEnd(URL_TLD_STICKY, text, scan, labelEnd) > scan) {
							hitValidTld = true;
							break;
						}
						extraStarts.push(scan);
						scan = labelEnd;
						if (scan < limit && "." === text[scan]) scan += 1;
						else break;
					}
					if (hitValidTld) {
						const totalFailedCount = 128 + extraStarts.length;
						const firstReachableIdx = totalFailedCount - 127;
						failedEnd =
							firstReachableIdx < 128
								? (labels[firstReachableIdx]?.from ?? secondLabel.from)
								: (extraStarts[firstReachableIdx - 128] ?? secondLabel.from);
					} else {
						failedEnd = scan;
					}
				}
				if (failedEnd > state.failedDomainEnd) {
					state.failedDomainStart = secondLabel.from;
					state.failedDomainEnd = failedEnd;
				}
			}
		}
	}
	// Alternative 3: Single-level ASCII domain `[a-z0-9_-]++\.?`
	return stickyEnd(URL_SINGLE_HOST_STICKY, text, pos, limit);
}

function trimLeagueAutolinkEnd(
	text: string,
	start: number,
	rawEnd: number,
): number {
	let end = rawEnd;
	while (end > start + 1 && GFM_TRAILING_PUNCT.has(text[end - 1] ?? "")) {
		end -= 1;
	}
	if (end > start + 1 && ";" === text[end - 1]) {
		const entity = URL_ENTITY_SUFFIX.exec(text.slice(start, end));
		if (entity && entity.index > 0) end = start + entity.index;
	}
	if (end > start && ")" === text[end - 1]) {
		let balance = 0;
		for (let i = start; i < end; i += 1) {
			if ("(" === text[i]) balance -= 1;
			else if (")" === text[i]) balance += 1;
		}
		if (balance > 0) end = Math.max(start, end - balance);
	}
	return end;
}

/**
 * Pre-scans only `www.` / `http://` / `https://` / `ftp://` prefix start
 * offsets in `text[from, to)`, mirroring League 2.8.2
 * `UrlAutolinkParser::getMatchDefinition()` so earlier unconsumed prefixes
 * inside link tails never shadow later URLs.
 */
export function preScanLeagueUrlAutolinkPrefixes(
	text: string,
	from: number = 0,
	to: number = text.length,
): UrlAutolinkPrefixMatch[] {
	if (from >= to) return [];
	if (0 === from && to === text.length && !URL_AUTOLINK_FAST_CHECK.test(text)) {
		return [];
	}
	const matches: UrlAutolinkPrefixMatch[] = [];
	URL_PREFIX_PATTERN.lastIndex = from;
	for (;;) {
		const match = URL_PREFIX_PATTERN.exec(text);
		if (!match || match.index >= to) break;
		const prefixLength = match[0].length;
		if (match.index + prefixLength > to) break;
		matches.push({
			from: match.index,
			isProtocol: "www." !== match[0].toLowerCase(),
			prefixLength,
		});
	}
	return matches;
}

/**
 * On-demand O(N) matcher for `League\CommonMark\Extension\Autolink\UrlAutolinkParser`
 * at one pre-scanned `prefix` match within `[containerFrom, runTo)`.
 * Returns the trimmed autolink exclusive end offset, or `-1` on mismatch.
 */
export function matchLeagueUrlAutolinkAt(
	text: string,
	prefix: UrlAutolinkPrefixMatch,
	runTo: number,
	containerFrom: number,
	state: UrlAutolinkScanState,
): number {
	const prefixStart = prefix.from;
	if (prefixStart < containerFrom || prefixStart >= runTo) return -1;
	const allowedPrefix =
		prefixStart <= containerFrom ||
		GFM_ALLOWED_PREFIX.has(text[prefixStart - 1] ?? "");
	if (!allowedPrefix) return -1;

	const afterPrefix = prefixStart + prefix.prefixLength;
	if (afterPrefix > runTo) return -1;
	let hostEnd = -1;
	if (prefix.isProtocol) {
		const hostAfterUserinfo = matchUrlUserinfoEnd(text, afterPrefix, runTo);
		if (hostAfterUserinfo > afterPrefix) {
			hostEnd = matchUrlHost(text, hostAfterUserinfo, runTo, state);
		}
	}
	if (hostEnd < 0) hostEnd = matchUrlHost(text, afterPrefix, runTo, state);
	if (hostEnd < 0) return -1;

	let cursor = hostEnd;
	const portEnd = stickyEnd(URL_PORT_STICKY, text, cursor, runTo);
	if (portEnd > cursor) cursor = portEnd;
	if (cursor < runTo && "/" === text[cursor]) {
		cursor = Math.max(
			cursor + 1,
			stickyEnd(URL_PATH_STICKY, text, cursor + 1, runTo),
		);
	}
	if (cursor < runTo && "?" === text[cursor]) {
		cursor = Math.max(
			cursor + 1,
			stickyEnd(URL_QUERY_STICKY, text, cursor + 1, runTo),
		);
	}
	if (cursor < runTo && "#" === text[cursor]) {
		cursor = Math.max(
			cursor + 1,
			stickyEnd(URL_FRAGMENT_STICKY, text, cursor + 1, runTo),
		);
	}
	const trimmedEnd = trimLeagueAutolinkEnd(text, prefixStart, cursor);
	return trimmedEnd > prefixStart ? trimmedEnd : -1;
}

/** Matches `[A-Za-z0-9.\-_+]` from League `EmailAutolinkParser::REGEX`. */
function isBareEmailLocalCharCode(code: number): boolean {
	return (
		isAsciiAlnumCode(code) ||
		46 /* . */ === code ||
		45 /* - */ === code ||
		95 /* _ */ === code ||
		43 /* + */ === code
	);
}

/** Matches `[A-Za-z0-9\-_]` from League `EmailAutolinkParser::REGEX`. */
function isBareEmailFirstDomainCharCode(code: number): boolean {
	return isAsciiAlnumCode(code) || 45 /* - */ === code || 95 /* _ */ === code;
}

/** Matches `[A-Za-z0-9\-_.]` from League `EmailAutolinkParser::REGEX`. */
function isBareEmailRestDomainCharCode(code: number): boolean {
	return isBareEmailFirstDomainCharCode(code) || 46 /* . */ === code;
}

/**
 * Strictly O(N) single-pass pre-scan for League `EmailAutolinkParser`
 * (`[A-Za-z0-9.\-_+]+@[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.]+`) using one
 * monotonically advancing `@` cursor. Rejects raw matches ending in `-`/`_`
 * (still advancing past the full raw match as `preg_match_all` does) and trims
 * one trailing `.`.
 */
export function scanLeagueEmailAutolinkMatches(
	text: string,
	from: number = 0,
	to: number = text.length,
): SourceRange[] {
	const results: SourceRange[] = [];
	let cursor = from;
	let atPos = text.indexOf("@", from);
	while (atPos >= 0 && atPos < to) {
		let matchStart = atPos;
		while (
			matchStart > cursor &&
			isBareEmailLocalCharCode(text.charCodeAt(matchStart - 1))
		) {
			matchStart -= 1;
		}
		if (matchStart < atPos) {
			let p = atPos + 1;
			while (p < to && isBareEmailFirstDomainCharCode(text.charCodeAt(p))) {
				p += 1;
			}
			if (p > atPos + 1 && p < to && 46 /* . */ === text.charCodeAt(p)) {
				const restStart = p + 1;
				p = restStart;
				while (p < to && isBareEmailRestDomainCharCode(text.charCodeAt(p))) {
					p += 1;
				}
				if (p > restStart) {
					const lastCode = text.charCodeAt(p - 1);
					if (45 /* - */ !== lastCode && 95 /* _ */ !== lastCode) {
						results.push({
							from: matchStart,
							to: 46 /* . */ === lastCode ? p - 1 : p,
						});
					}
					cursor = p;
					atPos = text.indexOf("@", cursor);
					continue;
				}
			}
		}
		cursor = atPos + 1;
		atPos = text.indexOf("@", cursor);
	}
	return results;
}
