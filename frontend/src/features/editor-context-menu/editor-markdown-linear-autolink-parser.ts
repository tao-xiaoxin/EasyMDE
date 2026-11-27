import type { InlineContext } from "@lezer/markdown";

import {
	isAsciiWordCode,
	isJsWhitespaceCode,
} from "../../shared/markdown/markdown-char-codes";
import { hasOpenLinearLink } from "./editor-markdown-linear-link-parser";

/**
 * Strictly O(N) worker-safe replacement for `@lezer/markdown`'s GFM `Autolink`
 * inline parser (`www.`, `http://`, `https://`, emails, `mailto:`, `xmpp:`),
 * eliminating upstream `cx.hasOpenLink` O(N) backward scans and failed domain
 * rescans while matching upstream AST nodes 1:1.
 */

const LEZER_AUTOLINK_RE =
	/(www\.)|(https?:\/\/)|([\w.+-]{1,100}@)|(mailto:|xmpp:)/gy;
const LEZER_XMPP_RESOURCE_RE = /\/[a-zA-Z\d@.]+/gy;

type AutolinkContextMeta = {
	failedEmailAtPos: number;
	failedUrlDomainEnd: number;
	hasAt: boolean;
	lastCloseBracket: number;
	noCloseBracketUntil: number;
};

const AUTOLINK_META_SYMBOL = Symbol("easymdeAutolinkMeta");

type InlineContextWithAutolinkMeta = InlineContext & {
	[AUTOLINK_META_SYMBOL]?: AutolinkContextMeta;
};

function isDomainWordCharCode(code: number): boolean {
	return isAsciiWordCode(code) || 45 /* - */ === code;
}

function isAutolinkEmailStartCharCode(code: number): boolean {
	return isAsciiWordCode(code) || 46 === code || 43 === code || 45 === code;
}

function isTrailingUrlPunctCode(code: number): boolean {
	return (
		63 /* ? */ === code ||
		33 /* ! */ === code ||
		46 /* . */ === code ||
		44 /* , */ === code ||
		58 /* : */ === code ||
		42 /* * */ === code ||
		95 /* _ */ === code ||
		126 /* ~ */ === code
	);
}

/** Matches upstream `/^&(?:#\d+|#x[a-f\d]+|\w+);$/` on `[start, end)`. */
function isLezerEntitySuffix(text: string, start: number, end: number): boolean {
	const bodyStart = start + 1;
	const bodyEnd = end - 1;
	if (bodyStart >= bodyEnd) return false;
	if (35 /* # */ === text.charCodeAt(bodyStart)) {
		if (bodyStart + 1 >= bodyEnd) return false;
		if (120 /* x */ === text.charCodeAt(bodyStart + 1)) {
			if (bodyStart + 2 >= bodyEnd) return false;
			for (let i = bodyStart + 2; i < bodyEnd; i += 1) {
				const code = text.charCodeAt(i);
				if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) {
					return false;
				}
			}
			return true;
		}
		for (let i = bodyStart + 1; i < bodyEnd; i += 1) {
			const code = text.charCodeAt(i);
			if (code < 48 || code > 57) return false;
		}
		return true;
	}
	for (let i = bodyStart; i < bodyEnd; i += 1) {
		if (!isAsciiWordCode(text.charCodeAt(i))) return false;
	}
	return true;
}

function getAutolinkContextMeta(cx: InlineContext): AutolinkContextMeta {
	const target = cx as InlineContextWithAutolinkMeta;
	let meta = target[AUTOLINK_META_SYMBOL];
	if (!meta) {
		meta = {
			failedEmailAtPos: -1,
			failedUrlDomainEnd: -1,
			hasAt: cx.text.includes("@"),
			lastCloseBracket: -2,
			noCloseBracketUntil: -1,
		};
		target[AUTOLINK_META_SYMBOL] = meta;
	}
	return meta;
}

function getLastCloseBracket(text: string, meta: AutolinkContextMeta): number {
	if (-2 === meta.lastCloseBracket) meta.lastCloseBracket = text.lastIndexOf("]");
	return meta.lastCloseBracket;
}

function lezerAutolinkUrlEnd(
	cx: InlineContext,
	from: number,
	meta: AutolinkContextMeta,
): number {
	if (from < meta.failedUrlDomainEnd) return -1;
	const text = cx.text;
	const len = text.length;
	let pos = from;
	let prevLabelHasUnderscore = false;
	let curLabelHasUnderscore = false;
	while (pos < len) {
		const code = text.charCodeAt(pos);
		if (!isDomainWordCharCode(code)) break;
		if (95 /* _ */ === code) curLabelHasUnderscore = true;
		pos += 1;
	}
	if (pos === from) return -1;
	let dotCount = 0;
	while (pos + 1 < len && 46 /* . */ === text.charCodeAt(pos)) {
		const nextCode = text.charCodeAt(pos + 1);
		if (!isDomainWordCharCode(nextCode)) break;
		dotCount += 1;
		prevLabelHasUnderscore = curLabelHasUnderscore;
		curLabelHasUnderscore = 95 /* _ */ === nextCode;
		pos += 2;
		while (pos < len) {
			const code = text.charCodeAt(pos);
			if (!isDomainWordCharCode(code)) break;
			if (95 /* _ */ === code) curLabelHasUnderscore = true;
			pos += 1;
		}
	}
	if (0 === dotCount || prevLabelHasUnderscore || curLabelHasUnderscore) {
		if (pos > meta.failedUrlDomainEnd) meta.failedUrlDomainEnd = pos;
		return -1;
	}

	if (pos + 1 < len && 58 /* : */ === text.charCodeAt(pos)) {
		const digit = text.charCodeAt(pos + 1);
		if (digit >= 48 && digit <= 57) {
			pos += 2;
			while (pos < len) {
				const code = text.charCodeAt(pos);
				if (code < 48 || code > 57) break;
				pos += 1;
			}
		}
	}

	let stoppedAtBracket = false;
	if (pos < len && 47 /* / */ === text.charCodeAt(pos)) {
		pos += 1;
		let openLinkChecked = false;
		let enforceBrackets = false;
		while (pos < len) {
			const code = text.charCodeAt(pos);
			if (60 /* < */ === code || isJsWhitespaceCode(code)) break;
			if (91 /* [ */ === code || 93 /* ] */ === code) {
				if (!openLinkChecked) {
					openLinkChecked = true;
					enforceBrackets = hasOpenLinearLink(cx);
				}
				if (enforceBrackets) {
					if (93 /* ] */ === code) {
						stoppedAtBracket = true;
						break;
					}
					if (
						pos >= getLastCloseBracket(text, meta) ||
						pos < meta.noCloseBracketUntil
					) {
						stoppedAtBracket = true;
						break;
					}
					let close = pos + 1;
					while (close < len) {
						const c = text.charCodeAt(close);
						if (93 /* ] */ === c) break;
						if (60 /* < */ === c || isJsWhitespaceCode(c)) {
							meta.noCloseBracketUntil = close;
							close = len;
							break;
						}
						close += 1;
					}
					if (close >= len) {
						stoppedAtBracket = true;
						break;
					}
					pos = close + 1;
					continue;
				}
			}
			pos += 1;
		}
	}

	if (stoppedAtBracket) return pos;

	let end = pos;
	let openParens = -1;
	let closeParens = -1;
	for (;;) {
		if (end <= from) break;
		const lastCode = text.charCodeAt(end - 1);
		if (isTrailingUrlPunctCode(lastCode)) {
			end -= 1;
		} else if (41 /* ) */ === lastCode) {
			if (openParens < 0) {
				openParens = 0;
				closeParens = 0;
				for (let i = from; i < end; i += 1) {
					const ch = text.charCodeAt(i);
					if (40 /* ( */ === ch) openParens += 1;
					else if (41 /* ) */ === ch) closeParens += 1;
				}
			}
			if (closeParens <= openParens) break;
			end -= 1;
			closeParens -= 1;
		} else if (59 /* ; */ === lastCode) {
			let scan = end - 1;
			while (scan > from) {
				const code = text.charCodeAt(scan - 1);
				if (isAsciiWordCode(code) || 35 === code) scan -= 1;
				else break;
			}
			if (
				scan > from &&
				38 /* & */ === text.charCodeAt(scan - 1) &&
				isLezerEntitySuffix(text, scan - 1, end)
			) {
				end = scan - 1;
			} else {
				break;
			}
		} else {
			break;
		}
	}
	return end;
}

function lezerAutolinkEmailEnd(
	text: string,
	from: number,
	meta: AutolinkContextMeta,
): number {
	const len = text.length;
	let pos = from;
	while (pos < len && isAutolinkEmailStartCharCode(text.charCodeAt(pos))) {
		pos += 1;
	}
	if (pos === from || pos >= len || 64 /* @ */ !== text.charCodeAt(pos)) {
		return -1;
	}
	const atPos = pos;
	if (atPos === meta.failedEmailAtPos) return -1;
	pos += 1;
	const domainStart = pos;
	while (pos < len && isDomainWordCharCode(text.charCodeAt(pos))) {
		pos += 1;
	}
	if (pos === domainStart || pos >= len || 46 /* . */ !== text.charCodeAt(pos)) {
		meta.failedEmailAtPos = atPos;
		return -1;
	}
	pos += 1;
	const tldStart = pos;
	while (pos < len) {
		const code = text.charCodeAt(pos);
		if (isDomainWordCharCode(code) || 46 /* . */ === code) pos += 1;
		else break;
	}
	if (pos === tldStart) {
		meta.failedEmailAtPos = atPos;
		return -1;
	}
	const last = text.charCodeAt(pos - 1);
	if (95 /* _ */ === last || 45 /* - */ === last) {
		meta.failedEmailAtPos = atPos;
		return -1;
	}
	return 46 /* . */ === last ? pos - 1 : pos;
}

export function parseLinearGfmAutolink(
	cx: InlineContext,
	next: number,
	absPos: number,
): number {
	if (!isAutolinkEmailStartCharCode(next)) return -1;
	const meta = getAutolinkContextMeta(cx);
	if (!meta.hasAt && 104 !== next && 119 !== next) return -1;
	const pos = absPos - cx.offset;
	if (pos > 0 && isAsciiWordCode(cx.text.charCodeAt(pos - 1))) {
		return -1;
	}
	LEZER_AUTOLINK_RE.lastIndex = pos;
	const match = LEZER_AUTOLINK_RE.exec(cx.text);
	if (!match) return -1;
	let end = -1;
	if (match[1] || match[2]) {
		end = lezerAutolinkUrlEnd(cx, pos + match[0].length, meta);
	} else if (match[3]) {
		end = lezerAutolinkEmailEnd(cx.text, pos, meta);
	} else {
		end = lezerAutolinkEmailEnd(cx.text, pos + match[0].length, meta);
		if (end > -1 && "xmpp:" === match[0]) {
			LEZER_XMPP_RESOURCE_RE.lastIndex = end;
			const resource = LEZER_XMPP_RESOURCE_RE.exec(cx.text);
			if (resource) end = resource.index + resource[0].length;
		}
	}
	if (end < 0) return -1;
	cx.addElement(cx.elt("URL", absPos, end + cx.offset));
	return end + cx.offset;
}
