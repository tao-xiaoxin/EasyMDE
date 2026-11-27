import {
	isAsciiAlnumCode,
	isAsciiDigitCode,
	isAsciiLetterCode,
	isAsciiLowerAlnumOrHyphenCode,
	isAsciiLowerCode,
	isAsciiWordCode,
	isCommonMarkWhitespaceCode,
	isJsWhitespaceCode,
	isLeagueUnicodeWhitespaceCode,
} from "./markdown-char-codes";

/**
 * Worker-safe linear O(N) HTML inline/block-7 and angle-bracket autolink
 * scanners shared by League pre-scans, League block rules, Lezer inline
 * adapters, and the Immersive Visual prescanner. Zero DOM globals.
 */

export type AngleScanCache = {
	failedTagAttrStarts: Set<number> | null;
	lastAt: number;
	lastCdataEnd: number;
	lastCloseAngle: number;
	lastCommentEnd: number;
	lastDoubleQuote: number;
	lastProcInstEnd: number;
	lastSingleQuote: number;
};

export type HtmlTagDialect = Readonly<{
	allowLeadingWs: boolean;
	allowSpaceBeforeSelfClose: boolean;
	isAttrNameRest: (code: number) => boolean;
	isAttrNameStart: (code: number) => boolean;
	isDeclarationStart: (code: number) => boolean;
	isTagNameRest: (code: number) => boolean;
	isTagNameStart: (code: number) => boolean;
	isUnquotedAttrValue: (code: number) => boolean;
	isWhitespace: (code: number) => boolean;
}>;

type HtmlInlineTokenMatch = Readonly<{
	end: number;
	nodeName: "Comment" | "HTMLTag" | "ProcessingInstruction";
}>;

export function createAngleScanCache(): AngleScanCache {
	return {
		failedTagAttrStarts: null,
		lastAt: -2,
		lastCdataEnd: -2,
		lastCloseAngle: -2,
		lastCommentEnd: -2,
		lastDoubleQuote: -2,
		lastProcInstEnd: -2,
		lastSingleQuote: -2,
	};
}

export function getLastCloseAngle(text: string, cache: AngleScanCache): number {
	if (-2 === cache.lastCloseAngle) cache.lastCloseAngle = text.lastIndexOf(">");
	return cache.lastCloseAngle;
}

export function getLastAt(text: string, cache: AngleScanCache): number {
	if (-2 === cache.lastAt) cache.lastAt = text.lastIndexOf("@");
	return cache.lastAt;
}

function getLastCommentEnd(text: string, cache: AngleScanCache): number {
	if (-2 === cache.lastCommentEnd) {
		cache.lastCommentEnd = text.lastIndexOf("-->");
	}
	return cache.lastCommentEnd;
}

function getLastProcInstEnd(text: string, cache: AngleScanCache): number {
	if (-2 === cache.lastProcInstEnd) {
		cache.lastProcInstEnd = text.lastIndexOf("?>");
	}
	return cache.lastProcInstEnd;
}

function getLastCdataEnd(text: string, cache: AngleScanCache): number {
	if (-2 === cache.lastCdataEnd) cache.lastCdataEnd = text.lastIndexOf("]]>");
	return cache.lastCdataEnd;
}

function getLastSingleQuote(text: string, cache: AngleScanCache): number {
	if (-2 === cache.lastSingleQuote) {
		cache.lastSingleQuote = text.lastIndexOf("'");
	}
	return cache.lastSingleQuote;
}

function getLastDoubleQuote(text: string, cache: AngleScanCache): number {
	if (-2 === cache.lastDoubleQuote) {
		cache.lastDoubleQuote = text.lastIndexOf('"');
	}
	return cache.lastDoubleQuote;
}

/** Matches `/[a-z\d.!#$%&'*+/=?^_`{|}~-]/i`. */
function isEmailLocalCharCode(code: number): boolean {
	if (isAsciiAlnumCode(code)) return true;
	switch (code) {
		case 33: // !
		case 35: // #
		case 36: // $
		case 37: // %
		case 38: // &
		case 39: // '
		case 42: // *
		case 43: // +
		case 45: // -
		case 46: // .
		case 47: // /
		case 61: // =
		case 63: // ?
		case 94: // ^
		case 95: // _
		case 96: // `
		case 123: // {
		case 124: // |
		case 125: // }
		case 126: // ~
			return true;
		default:
			return false;
	}
}

function isTagNameRestCode(code: number): boolean {
	return isAsciiWordCode(code) || 45 /* - */ === code;
}

function isAttrNameStartCode(code: number): boolean {
	return isAsciiLetterCode(code) || 58 /* : */ === code || 95 /* _ */ === code;
}

/** Matches `/[\w-.:]/` (non-Unicode JS regex: `\w`, `-`, `.`, `:`). */
function isAttrNameRestCode(code: number): boolean {
	return (
		isAsciiWordCode(code) ||
		45 /* - */ === code ||
		46 /* . */ === code ||
		58 /* : */ === code
	);
}

/** Matches `/[^\s"'=<>`]/`. */
function isUnquotedAttrValueCode(code: number): boolean {
	if (isJsWhitespaceCode(code)) return false;
	return (
		34 /* " */ !== code &&
		39 /* ' */ !== code &&
		60 /* < */ !== code &&
		61 /* = */ !== code &&
		62 /* > */ !== code &&
		96 /* ` */ !== code
	);
}

function isCommonMarkTagNameRestCode(code: number): boolean {
	return isAsciiAlnumCode(code) || 45 /* - */ === code;
}

/**
 * Matches CommonMark / League `RegexHelper::PARTIAL_UNQUOTEDVALUE =
 * '[^"\'=<>`\x00-\x20]+'`.
 */
function isCommonMarkUnquotedAttrValueCode(code: number): boolean {
	return (
		code > 32 &&
		34 /* " */ !== code &&
		39 /* ' */ !== code &&
		60 /* < */ !== code &&
		61 /* = */ !== code &&
		62 /* > */ !== code &&
		96 /* ` */ !== code
	);
}

function isLeagueAttrNameStartCode(code: number): boolean {
	return isAsciiLowerCode(code) || 95 /* _ */ === code || 58 /* : */ === code;
}

function isLeagueAttrNameRestCode(code: number): boolean {
	return (
		isAsciiLowerCode(code) ||
		isAsciiDigitCode(code) ||
		58 /* : */ === code ||
		46 /* . */ === code ||
		95 /* _ */ === code ||
		45 /* - */ === code
	);
}

function isLeagueUriSchemeRestCode(code: number): boolean {
	return (
		isAsciiAlnumCode(code) ||
		46 /* . */ === code ||
		43 /* + */ === code ||
		45 /* - */ === code
	);
}

const COMMONMARK_SINGLE_LINE_HTML_DIALECT: HtmlTagDialect = {
	allowLeadingWs: false,
	allowSpaceBeforeSelfClose: false,
	isAttrNameRest: isAttrNameRestCode,
	isAttrNameStart: isAttrNameStartCode,
	isDeclarationStart: isAsciiLetterCode,
	isTagNameRest: isCommonMarkTagNameRestCode,
	isTagNameStart: isAsciiLetterCode,
	isUnquotedAttrValue: isCommonMarkUnquotedAttrValueCode,
	isWhitespace: (code) => 10 !== code && isCommonMarkWhitespaceCode(code),
};

export const LEZER_HTML_DIALECT: HtmlTagDialect = {
	allowLeadingWs: true,
	allowSpaceBeforeSelfClose: true,
	isAttrNameRest: isAttrNameRestCode,
	isAttrNameStart: isAttrNameStartCode,
	isDeclarationStart: (code) => code >= 65 && code <= 90,
	isTagNameRest: isTagNameRestCode,
	isTagNameStart: isAsciiLetterCode,
	isUnquotedAttrValue: isUnquotedAttrValueCode,
	isWhitespace: isJsWhitespaceCode,
};

export const LEAGUE_HTML_ASCII_DIALECT: HtmlTagDialect = {
	allowLeadingWs: false,
	allowSpaceBeforeSelfClose: false,
	isAttrNameRest: isLeagueAttrNameRestCode,
	isAttrNameStart: isLeagueAttrNameStartCode,
	isDeclarationStart: isAsciiLetterCode,
	isTagNameRest: isAsciiLowerAlnumOrHyphenCode,
	isTagNameStart: isAsciiLowerCode,
	isUnquotedAttrValue: isCommonMarkUnquotedAttrValueCode,
	isWhitespace: isCommonMarkWhitespaceCode,
};

export const LEAGUE_HTML_MULTIBYTE_DIALECT: HtmlTagDialect = {
	...LEAGUE_HTML_ASCII_DIALECT,
	isWhitespace: isLeagueUnicodeWhitespaceCode,
};

/**
 * Matches CommonMark / League 2.8.2 `AutolinkParser::OTHER_LINK_REGEX`
 * (`<([A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*)>`) starting at `afterStart`
 * (immediately after `<`). Strictly O(N) because `<` terminates every scan.
 */
export function matchLeagueAngleUriAt(
	text: string,
	afterStart: number,
	len: number,
): number {
	if (afterStart >= len || !isAsciiLetterCode(text.charCodeAt(afterStart))) {
		return -1;
	}
	const schemeMaxEnd = Math.min(len, afterStart + 32);
	let p = afterStart + 1;
	while (p < schemeMaxEnd && isLeagueUriSchemeRestCode(text.charCodeAt(p))) {
		p += 1;
	}
	if (p === afterStart + 1 || p >= len || 58 /* : */ !== text.charCodeAt(p)) {
		return -1;
	}
	let q = p + 1;
	while (q < len) {
		const ch = text.charCodeAt(q);
		if (62 /* > */ === ch) return q + 1;
		if (ch <= 32 || 60 /* < */ === ch) return -1;
		q += 1;
	}
	return -1;
}

/**
 * Matches CommonMark/League angle-bracket email autolink interior starting at
 * `afterStart` (the offset immediately after `<`) through the closing `>`.
 */
export function matchAngleEmailAutolinkAt(
	text: string,
	afterStart: number,
	len: number,
	lastAt: number,
): number {
	if (afterStart >= lastAt) return -1;
	let p = afterStart;
	while (p < len && isEmailLocalCharCode(text.charCodeAt(p))) p += 1;
	if (p === afterStart || p >= len || 64 /* @ */ !== text.charCodeAt(p)) {
		return -1;
	}
	p += 1;
	for (;;) {
		const labelStart = p;
		if (p >= len || !isAsciiAlnumCode(text.charCodeAt(p))) return -1;
		p += 1;
		while (p < len) {
			const ch = text.charCodeAt(p);
			if (isAsciiAlnumCode(ch) || 45 /* - */ === ch) p += 1;
			else break;
		}
		const labelLen = p - labelStart;
		if (labelLen > 63 || 45 /* - */ === text.charCodeAt(p - 1)) return -1;
		if (p < len && 46 /* . */ === text.charCodeAt(p)) {
			p += 1;
			continue;
		}
		break;
	}
	return p < len && 62 /* > */ === text.charCodeAt(p) ? p + 1 : -1;
}

/**
 * Matches CommonMark 0.30 / League 2.8.2 `RegexHelper::PARTIAL_HTMLCOMMENT`
 * (`<!-->`, `<!--->`, or `<!--[\s\S]*?-->`) starting at `afterStart` (`!`).
 */
function matchLeagueHtmlCommentAt(
	text: string,
	afterStart: number,
	len: number,
	cache: AngleScanCache,
): number {
	if (
		afterStart + 3 >= len ||
		45 /* - */ !== text.charCodeAt(afterStart + 1) ||
		45 /* - */ !== text.charCodeAt(afterStart + 2)
	) {
		return -1;
	}
	const afterOpen = afterStart + 3;
	if (62 /* > */ === text.charCodeAt(afterOpen)) return afterOpen + 1;
	if (
		afterOpen + 1 < len &&
		45 /* - */ === text.charCodeAt(afterOpen) &&
		62 /* > */ === text.charCodeAt(afterOpen + 1)
	) {
		return afterOpen + 2;
	}
	if (getLastCommentEnd(text, cache) >= afterOpen) {
		const closeIdx = text.indexOf("-->", afterOpen);
		if (closeIdx >= 0) return closeIdx + 3;
	}
	return -1;
}

function matchLezerHtmlCommentEnd(
	text: string,
	afterStart: number,
	len: number,
	cache: AngleScanCache,
): number {
	if (
		afterStart + 6 >= len ||
		45 /* - */ !== text.charCodeAt(afterStart + 1) ||
		45 /* - */ !== text.charCodeAt(afterStart + 2) ||
		62 /* > */ === text.charCodeAt(afterStart + 3)
	) {
		return -1;
	}
	const bodyStart = afterStart + 4;
	if (getLastCommentEnd(text, cache) < bodyStart) {
		return -1;
	}
	let p = bodyStart;
	while (p < len) {
		if (45 /* - */ !== text.charCodeAt(p)) {
			p += 1;
			continue;
		}
		if (
			p + 2 < len &&
			45 /* - */ === text.charCodeAt(p + 1) &&
			62 /* > */ === text.charCodeAt(p + 2)
		) {
			return p + 3;
		}
		if (p + 1 < len && 45 /* - */ !== text.charCodeAt(p + 1)) {
			p += 2;
			continue;
		}
		return -1;
	}
	return -1;
}

function matchProcInstAt(
	text: string,
	afterStart: number,
	cache: AngleScanCache,
): number {
	if (getLastProcInstEnd(text, cache) < afterStart + 1) return -1;
	const closeIdx = text.indexOf("?>", afterStart + 1);
	return closeIdx >= 0 ? closeIdx + 2 : -1;
}

function matchCdataAt(
	text: string,
	afterStart: number,
	cache: AngleScanCache,
): number {
	if (!text.startsWith("![CDATA[", afterStart)) return -1;
	const bodyStart = afterStart + 8;
	if (getLastCdataEnd(text, cache) < bodyStart) return -1;
	const closeIdx = text.indexOf("]]>", bodyStart);
	return closeIdx >= 0 ? closeIdx + 3 : -1;
}

function matchDeclarationAt(
	text: string,
	afterStart: number,
	len: number,
	dialect: HtmlTagDialect,
): number {
	const second = afterStart + 1 < len ? text.charCodeAt(afterStart + 1) : -1;
	if (!dialect.isDeclarationStart(second)) return -1;
	const closeIdx = text.indexOf(">", afterStart + 2);
	return closeIdx >= 0 ? closeIdx + 1 : -1;
}

function matchCloseHtmlTagAt(
	text: string,
	afterStart: number,
	len: number,
	dialect: HtmlTagDialect,
): number {
	let p = afterStart + 1;
	if (dialect.allowLeadingWs) {
		while (p < len && dialect.isWhitespace(text.charCodeAt(p))) p += 1;
	}
	if (p >= len || !dialect.isTagNameStart(text.charCodeAt(p))) return -1;
	p += 1;
	while (p < len && dialect.isTagNameRest(text.charCodeAt(p))) p += 1;
	while (p < len && dialect.isWhitespace(text.charCodeAt(p))) p += 1;
	return p < len && 62 /* > */ === text.charCodeAt(p) ? p + 1 : -1;
}

function matchOpenHtmlTagAt(
	text: string,
	afterStart: number,
	len: number,
	cache: AngleScanCache,
	dialect: HtmlTagDialect,
): number {
	let p = afterStart;
	if (dialect.allowLeadingWs) {
		while (p < len && dialect.isWhitespace(text.charCodeAt(p))) p += 1;
	}
	if (p >= len || !dialect.isTagNameStart(text.charCodeAt(p))) return -1;
	p += 1;
	while (p < len && dialect.isTagNameRest(text.charCodeAt(p))) p += 1;

	let visitedAttrStarts: number[] | null = null;
	const failedStarts = cache.failedTagAttrStarts;
	for (;;) {
		const wsStart = p;
		while (p < len && dialect.isWhitespace(text.charCodeAt(p))) p += 1;
		if (p >= len) break;
		const ch = text.charCodeAt(p);
		if (62 /* > */ === ch) return p + 1;
		if (47 /* / */ === ch) {
			p += 1;
			if (dialect.allowSpaceBeforeSelfClose) {
				while (p < len && dialect.isWhitespace(text.charCodeAt(p))) p += 1;
			}
			if (p < len && 62 /* > */ === text.charCodeAt(p)) return p + 1;
			break;
		}
		if (p === wsStart || !dialect.isAttrNameStart(ch)) break;
		if (failedStarts?.has(p)) break;
		if (!visitedAttrStarts) visitedAttrStarts = [p];
		else visitedAttrStarts.push(p);

		p += 1;
		while (p < len && dialect.isAttrNameRest(text.charCodeAt(p))) p += 1;

		let eqPos = p;
		while (eqPos < len && dialect.isWhitespace(text.charCodeAt(eqPos))) {
			eqPos += 1;
		}
		if (eqPos < len && 61 /* = */ === text.charCodeAt(eqPos)) {
			p = eqPos + 1;
			while (p < len && dialect.isWhitespace(text.charCodeAt(p))) p += 1;
			if (p >= len) break;
			const valCh = text.charCodeAt(p);
			if (39 /* ' */ === valCh) {
				if (p >= getLastSingleQuote(text, cache)) break;
				const closeQ = text.indexOf("'", p + 1);
				if (closeQ < 0) break;
				p = closeQ + 1;
			} else if (34 /* " */ === valCh) {
				if (p >= getLastDoubleQuote(text, cache)) break;
				const closeQ = text.indexOf('"', p + 1);
				if (closeQ < 0) break;
				p = closeQ + 1;
			} else {
				const valStart = p;
				while (p < len && dialect.isUnquotedAttrValue(text.charCodeAt(p))) {
					p += 1;
				}
				if (p === valStart) break;
			}
		}
	}

	if (visitedAttrStarts) {
		let set = cache.failedTagAttrStarts;
		if (!set) {
			set = new Set<number>();
			cache.failedTagAttrStarts = set;
		}
		for (let i = 0; i < visitedAttrStarts.length; i += 1) {
			const attrStart = visitedAttrStarts[i];
			if (undefined !== attrStart) set.add(attrStart);
		}
	}
	return -1;
}

/**
 * Shared single-dispatch inline HTML token matcher (`<!--...-->`,
 * `<![CDATA[...]]>`, `<!...>`, `<?...?>`, `</...>`, `<...>`) used by both
 * League pre-scans, Lezer `HTMLTag` inline adapters, and the Visual prescanner.
 */
export function matchHtmlInlineTokenAt(
	text: string,
	afterStart: number,
	len: number,
	cache: AngleScanCache,
	dialect: HtmlTagDialect,
	leagueMode: boolean,
): HtmlInlineTokenMatch | null {
	const first = text.charCodeAt(afterStart);
	if (33 /* ! */ === first) {
		const second = afterStart + 1 < len ? text.charCodeAt(afterStart + 1) : -1;
		if (45 /* - */ === second) {
			const commentEnd = leagueMode
				? matchLeagueHtmlCommentAt(text, afterStart, len, cache)
				: matchLezerHtmlCommentEnd(text, afterStart, len, cache);
			return commentEnd >= 0
				? { end: commentEnd, nodeName: "Comment" }
				: null;
		}
		if (91 /* [ */ === second) {
			const cdataEnd = matchCdataAt(text, afterStart, cache);
			return cdataEnd >= 0 ? { end: cdataEnd, nodeName: "HTMLTag" } : null;
		}
		const declEnd = matchDeclarationAt(text, afterStart, len, dialect);
		return declEnd >= 0 ? { end: declEnd, nodeName: "HTMLTag" } : null;
	}
	if (63 /* ? */ === first) {
		const piEnd = matchProcInstAt(text, afterStart, cache);
		return piEnd >= 0
			? { end: piEnd, nodeName: "ProcessingInstruction" }
			: null;
	}
	if (47 /* / */ === first) {
		const closeEnd = matchCloseHtmlTagAt(text, afterStart, len, dialect);
		return closeEnd >= 0 ? { end: closeEnd, nodeName: "HTMLTag" } : null;
	}
	const openEnd = matchOpenHtmlTagAt(text, afterStart, len, cache, dialect);
	return openEnd >= 0 ? { end: openEnd, nodeName: "HTMLTag" } : null;
}

/**
 * Matches League 2.8.2 `HtmlInlineParser` (`RegexHelper::PARTIAL_HTMLTAG`)
 * starting at `afterStart` (immediately after `<`).
 */
export function matchLeagueHtmlInlineAt(
	text: string,
	afterStart: number,
	len: number,
	cache: AngleScanCache,
	dialect: HtmlTagDialect,
): number {
	return (
		matchHtmlInlineTokenAt(text, afterStart, len, cache, dialect, true)?.end ??
		-1
	);
}

/**
 * Strictly linear O(L) matcher for CommonMark §4.6 / League 2.8.2 Type-7
 * complete open or close HTML tags (`<tag ...>` / `<tag .../>` / `</tag>`
 * followed only by PHP PCRE2 ASCII whitespace `[ \t\f\v\r]*` to EOL).
 */
function isSingleLineHtmlBlock7(text: string, from: number): boolean {
	const len = text.length;
	if (from + 2 >= len || 60 /* < */ !== text.charCodeAt(from)) {
		return false;
	}
	const afterStart = from + 1;
	const end =
		47 /* / */ === text.charCodeAt(afterStart)
			? matchCloseHtmlTagAt(
					text,
					afterStart,
					len,
					COMMONMARK_SINGLE_LINE_HTML_DIALECT,
				)
			: matchOpenHtmlTagAt(
					text,
					afterStart,
					len,
					createAngleScanCache(),
					COMMONMARK_SINGLE_LINE_HTML_DIALECT,
				);
	if (end <= afterStart) return false;
	for (let pos = end; pos < len; pos += 1) {
		const code = text.charCodeAt(pos);
		if (10 === code || !isCommonMarkWhitespaceCode(code)) return false;
	}
	return true;
}

// Unified strictly linear O(N) League CommonMark 2.8.2 HTML block rules
// (Types 1–7, matching `RegexHelper::getHtmlBlockOpenRegex()` with PHP
// PCRE2 ASCII `\s` = `[ \t\f\v\r]`).
const LEAGUE_HTML_OPEN_TYPE_1 =
	/^<(?:script|pre|textarea|style)(?:[ \t\f\v\r>]|$)/i;
const LEAGUE_HTML_OPEN_TYPE_2 = /^<!--/;
const LEAGUE_HTML_OPEN_TYPE_3 = /^<\?/;
const LEAGUE_HTML_OPEN_TYPE_4 = /^<![A-Za-z]/;
const LEAGUE_HTML_OPEN_TYPE_5 = /^<!\[CDATA\[/i;
const LEAGUE_HTML_OPEN_TYPE_6 =
	/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t\f\v\r]|\/?>|$)/i;

/**
 * CommonMark §4.6 / League 2.8.2 closing-line patterns for HTML Block Types
 * 1–5 (Types 6 and 7 terminate on the next blank line).
 */
export const LEAGUE_HTML_BLOCK_CLOSE_BY_TYPE: Readonly<Record<number, RegExp>> =
	{
		1: /<\/(?:script|pre|textarea|style)>/i,
		2: /-->/,
		3: /\?>/,
		4: />/,
		5: /\]\]>/,
	};

/**
 * League 2.8.2 HTML block type (1–7, or `0`) of the line `text` starting at
 * `pos`; `breaking` excludes Type 7, which cannot interrupt a paragraph.
 */
export function matchLeagueHtmlBlockType(
	text: string,
	pos: number,
	breaking: boolean,
): number {
	if (60 /* < */ !== text.charCodeAt(pos)) return 0;
	const rest = text.slice(pos);
	if (LEAGUE_HTML_OPEN_TYPE_1.test(rest)) return 1;
	if (LEAGUE_HTML_OPEN_TYPE_2.test(rest)) return 2;
	if (LEAGUE_HTML_OPEN_TYPE_3.test(rest)) return 3;
	if (LEAGUE_HTML_OPEN_TYPE_4.test(rest)) return 4;
	if (LEAGUE_HTML_OPEN_TYPE_5.test(rest)) return 5;
	if (LEAGUE_HTML_OPEN_TYPE_6.test(rest)) return 6;
	if (!breaking && isSingleLineHtmlBlock7(text, pos)) return 7;
	return 0;
}
