import {
	countTableRowCells,
	parseGfmTableSeparatorColumns,
} from "../../shared/markdown/php-commonmark-block-helpers";
import {
	maskPhpMarkdownMathForTableScan,
	scanPhpMarkdownMathRanges,
} from "../../shared/markdown/php-markdown-math-mask";

/**
 * Markdown escaping helpers owned by the visual-editor serializer.
 *
 * The serializer writes canonical Markdown from ProseMirror nodes. Plain text
 * must never mutate into block or inline syntax on re-parse, while untouched
 * raw blocks bypass this module entirely (zero-write round-trip guard).
 */

export type EscapeInlineTextOptions = Readonly<{
	/** Escape the first line as a block-start line (default false). */
	atLineStart?: boolean;
	/** Heading content: newlines collapse to spaces and closing `#` is escaped. */
	inHeading?: boolean;
	/** Table cell content: pipes are escaped and soft line breaks use `<br>`. */
	inTableCell?: boolean;
	/** Link label text: `]` must be escaped so the label cannot close early. */
	inLinkLabel?: boolean;
}>;

const HTML_ENTITY_STICKY = /&#?[A-Za-z0-9]+;/y;
const HTML_TAG_SECOND_CHAR = /[A-Za-z/!?]/;

function isTocSyntaxAt(
	line: string,
	index: number,
	lastNonWsIndex: number,
): boolean {
	if (index + 5 > line.length || index + 5 <= lastNonWsIndex) {
		return false;
	}
	const c1 = line[index + 1];
	const c2 = line[index + 2];
	const c3 = line[index + 3];
	return (
		(c1 === "T" || c1 === "t") &&
		(c2 === "O" || c2 === "o") &&
		(c3 === "C" || c3 === "c") &&
		line[index + 4] === "]"
	);
}

function escapeLineStartPrefix(line: string): Readonly<{
	escaped: string;
	consumed: number;
}> {
	const ordered = /^(\d{1,9})([.)])(?=[ \t]|$)/.exec(line);
	if (ordered?.[1] && ordered[2]) {
		return {
			escaped: `${ordered[1]}\\${ordered[2]}`,
			consumed: ordered[0].length,
		};
	}
	if (/^#{1,6}(?:[ \t]|$)/.test(line)) {
		return { escaped: "\\#", consumed: 1 };
	}
	if (/^>(?:[ \t]|$)/.test(line)) {
		return { escaped: "\\>", consumed: 1 };
	}
	if (/^[-+](?:[ \t]|$)/.test(line)) {
		return { escaped: `\\${line[0]}`, consumed: 1 };
	}
	if (/^=+[ \t]*$/.test(line)) {
		return { escaped: "\\=", consumed: 1 };
	}
	if (/^-+[ \t]*$/.test(line)) {
		return { escaped: "\\-", consumed: 1 };
	}
	return { escaped: "", consumed: 0 };
}

type LineEscapePlan = Readonly<{
	line: string;
	offset: number;
	prefixEscaped: string;
	refDefBracketIndex: number;
	start: number;
}>;

function isBlankEscapeLine(line: string): boolean {
	for (let i = 0; i < line.length; i += 1) {
		const code = line.charCodeAt(i);
		if (code !== 0x20 && code !== 0x09) {
			return false;
		}
	}
	return true;
}

function collectEscapedOpenBracketsAcrossLines(
	text: string,
	plans: ReadonlyArray<LineEscapePlan>,
	resetOnBlankLines: boolean,
): Uint8Array | null {
	if (!text.includes("[") || !text.includes("]")) {
		return null;
	}
	let escaped: Uint8Array | null = null;
	const openStack: number[] = [];
	const activeRefDefStack: number[] = [];
	for (let p = 0; p < plans.length; p += 1) {
		const plan = plans[p];
		if (!plan) continue;
		const { line, offset, refDefBracketIndex, start } = plan;
		if (resetOnBlankLines && isBlankEscapeLine(line)) {
			openStack.length = 0;
			activeRefDefStack.length = 0;
			continue;
		}
		for (let i = start; i < line.length; i += 1) {
			const ch = line[i];
			if (ch === "[") {
				const globalIdx = offset + i;
				openStack.push(globalIdx);
				if (i === refDefBracketIndex) {
					activeRefDefStack.push(globalIdx);
				}
			} else if (ch === "]" && openStack.length > 0) {
				const openIdx = openStack.pop();
				if (openIdx === undefined) continue;
				const wasRefDef =
					activeRefDefStack.length > 0 &&
					activeRefDefStack[activeRefDefStack.length - 1] === openIdx;
				if (wasRefDef) {
					activeRefDefStack.pop();
				}
				const after = line[i + 1];
				if (after === "(" || after === "[") {
					if (escaped === null) escaped = new Uint8Array(text.length);
					escaped[openIdx] = 1;
					while (openStack.length > 0) {
						const enclosing = openStack.pop();
						if (enclosing !== undefined) {
							escaped[enclosing] = 1;
						}
					}
					activeRefDefStack.length = 0;
				} else if (after === ":" && (wasRefDef || activeRefDefStack.length > 0)) {
					if (escaped === null) escaped = new Uint8Array(text.length);
					if (wasRefDef) {
						escaped[openIdx] = 1;
					}
					// Escaping an inner `[` turns it into `\[`, which no longer blocks
					// an enclosing line-start `[` from closing at `]:`, so escape every
					// enclosing active line-start refdef bracket in O(1) amortized time.
					while (activeRefDefStack.length > 0) {
						const enclosingRefDef = activeRefDefStack.pop();
						if (enclosingRefDef !== undefined) {
							escaped[enclosingRefDef] = 1;
						}
					}
				}
			}
		}
	}
	return escaped;
}

function escapeInlineLine(
	plan: LineEscapePlan,
	escapedOpenBrackets: Uint8Array | null,
	inTableCell: boolean,
	inLinkLabel: boolean,
): string {
	const { line, offset, prefixEscaped, start } = plan;
	let escaped = prefixEscaped;
	let lastNonWsIndex = line.length - 1;
	while (
		lastNonWsIndex >= start &&
		(line[lastNonWsIndex] === " " || line[lastNonWsIndex] === "\t")
	) {
		lastNonWsIndex -= 1;
	}
	for (let i = start; i < line.length; i += 1) {
		const ch = line[i] ?? "";
		switch (ch) {
			case "\\":
				escaped += "\\\\";
				break;
			case "`":
				escaped += "\\`";
				break;
			case "*":
				escaped += "\\*";
				break;
			case "_":
				escaped += "\\_";
				break;
			case "~":
				escaped += "\\~";
				break;
			// `\[...\]` is KaTeX block math for EasyMDE (and PHP), so only escape a
			// bracket that could actually open link/image/footnote/refdef syntax.
			// Plain prose such as `[edited]` stays readable and byte-stable.
			case "[": {
				const needsEscape =
					inLinkLabel ||
					line[i + 1] === "^" ||
					isTocSyntaxAt(line, i, lastNonWsIndex) ||
					escapedOpenBrackets?.[offset + i] === 1;
				escaped += needsEscape ? "\\[" : "[";
				break;
			}
			case "]":
				escaped += inLinkLabel ? "\\]" : "]";
				break;
			case "$":
				escaped += "\\$";
				break;
			case "<":
				escaped +=
					i + 1 < line.length && HTML_TAG_SECOND_CHAR.test(line[i + 1] ?? "")
						? "\\<"
						: "<";
				break;
			case "&":
				HTML_ENTITY_STICKY.lastIndex = i;
				escaped += HTML_ENTITY_STICKY.test(line) ? "\\&" : "&";
				break;
			case "|":
				escaped += inTableCell ? "\\|" : "|";
				break;
			default:
				escaped += ch;
				break;
		}
	}
	return escaped;
}

export function escapeInlineMarkdownText(
	text: string,
	options: EscapeInlineTextOptions = {},
): string {
	if (text.length === 0) {
		return "";
	}
	const inTableCell = options.inTableCell ?? false;
	const inHeading = options.inHeading ?? false;
	const inLinkLabel = options.inLinkLabel ?? false;
	const firstAtLineStart = options.atLineStart ?? false;
	const lines = text.split("\n");
	const plans: LineEscapePlan[] = new Array(lines.length);
	let offset = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const atLineStart = !inHeading && (index > 0 || firstAtLineStart);
		const prefix = atLineStart
			? escapeLineStartPrefix(line)
			: { consumed: 0, escaped: "" };
		let refDefBracketIndex = -1;
		if (atLineStart && prefix.consumed === 0) {
			let lead = 0;
			while (lead < 3 && lead < line.length && line[lead] === " ") {
				lead += 1;
			}
			if (line[lead] === "[") {
				refDefBracketIndex = lead;
			}
		}
		plans[index] = {
			line,
			offset,
			prefixEscaped: prefix.escaped,
			refDefBracketIndex,
			start: prefix.consumed,
		};
		offset += line.length + 1;
	}
	const escapedOpenBrackets = inLinkLabel
		? null
		: collectEscapedOpenBracketsAcrossLines(
				text,
				plans,
				!inHeading && !inTableCell,
			);
	const separator = inHeading ? " " : inTableCell ? "<br>" : "\n";
	const escapedLines = plans.map((plan) =>
		escapeInlineLine(plan, escapedOpenBrackets, inTableCell, inLinkLabel),
	);
	return escapedLines.join(separator);
}

/**
 * Shared table-pipe escaper that skips PHP math ranges (`$...$`, `\(...\)`,
 * `$$...$$`, `\[...\]`), since PHP `MarkdownRenderer::extract_math()` extracts
 * math BEFORE `TableParser::split()`. When `useBackslashParity` is true, pipes
 * preceded by an even run of backslashes are escaped; when false, matches PHP's
 * single-backslash `(?<!\\)\|`.
 */
function escapeTablePipesOutsideMath(
	raw: string,
	useBackslashParity: boolean,
): string {
	if (!raw.includes("|")) {
		return raw;
	}
	const mathRanges = scanPhpMarkdownMathRanges(raw);
	let mathIdx = 0;
	let backslashRun = 0;
	let escaped = "";
	for (let i = 0; i < raw.length; i += 1) {
		while (
			mathIdx < mathRanges.length &&
			(mathRanges[mathIdx]?.to ?? 0) <= i
		) {
			mathIdx += 1;
		}
		const activeMath = mathRanges[mathIdx];
		if (activeMath && activeMath.from <= i && activeMath.to > i) {
			escaped += raw.slice(i, activeMath.to);
			i = activeMath.to - 1;
			backslashRun = 0;
			mathIdx += 1;
			continue;
		}
		const ch = raw[i] ?? "";
		if (ch === "\\") {
			escaped += ch;
			backslashRun += 1;
			continue;
		}
		if (ch === "|") {
			const needsEscape = useBackslashParity
				? backslashRun % 2 === 0
				: i === 0 || raw[i - 1] !== "\\";
			escaped += needsEscape ? "\\|" : "|";
			backslashRun = 0;
			continue;
		}
		escaped += ch;
		backslashRun = 0;
	}
	return escaped;
}

/**
 * Escape only pipes that are not already backslash-escaped (and outside PHP
 * math ranges). Used for link/image destinations and titles inside a table.
 */
export function escapeTablePipes(raw: string): string {
	return escapeTablePipesOutsideMath(raw, true);
}

/**
 * Escape only table-cell pipes not immediately preceded by a backslash and
 * outside PHP math ranges, matching PHP `MarkdownRenderer::extract_math()` ->
 * `TableParser::split()` (`(?<!\\)\|`) for raw `protected_inline` atoms in cells.
 */
export function escapeRawTablePipes(raw: string): string {
	return escapeTablePipesOutsideMath(raw, false);
}

/**
 * Prevents a multi-line serialized paragraph (top-level, inside a blockquote,
 * or inside a list) from parsing as a GFM table when any earlier masked line
 * of the paragraph contains `|` and a line with `countTableRowCells <= sepCols`
 * is followed by a GFM table separator line (exact PHP `TableStartParser`
 * parity, including math-masked pipes and `mathNewlineToken`).
 */
export function escapeParagraphTableDelimiters(
	text: string,
	mathNewlineToken?: string | null,
): string {
	if (!text.includes("\n") || !text.includes("|")) {
		return text;
	}
	const masked = maskPhpMarkdownMathForTableScan(text);
	const lines = text.split("\n");
	const lineStarts = new Array<number>(lines.length);
	const lineEnds = new Array<number>(lines.length);
	let offset = 0;
	for (let idx = 0; idx < lines.length; idx += 1) {
		const len = lines[idx]?.length ?? 0;
		lineStarts[idx] = offset;
		lineEnds[idx] = offset + len;
		offset += len + 1;
	}

	let changed = false;
	let paragraphHasPipe = false;
	let prevWasEscaped = false;
	for (let j = 0; j < lines.length - 1; j += 1) {
		const rawCur = lines[j] ?? "";
		const rawMasked = prevWasEscaped
			? rawCur
			: masked.slice(lineStarts[j] ?? 0, lineEnds[j] ?? 0);
		prevWasEscaped = false;
		const normalizedCur =
			mathNewlineToken && rawMasked.includes(mathNewlineToken)
				? rawMasked.split(mathNewlineToken).join(" ")
				: rawMasked;
		let effectivePrev: string;
		if (normalizedCur.includes("\n\n")) {
			const tail = normalizedCur.slice(normalizedCur.lastIndexOf("\n\n") + 2);
			paragraphHasPipe = tail.includes("|");
			effectivePrev = tail;
		} else {
			paragraphHasPipe = paragraphHasPipe || normalizedCur.includes("|");
			effectivePrev = normalizedCur;
		}

		const next = lines[j + 1] ?? "";
		const maskedNext = masked.slice(lineStarts[j + 1] ?? 0, lineEnds[j + 1] ?? 0);
		const sepCols = parseGfmTableSeparatorColumns(maskedNext);
		if (
			sepCols > 0 &&
			paragraphHasPipe &&
			effectivePrev.length > 0 &&
			countTableRowCells(effectivePrev) <= sepCols
		) {
			const pipeIdx = next.indexOf("|");
			if (pipeIdx >= 0) {
				lines[j + 1] = `${next.slice(0, pipeIdx)}\\|${next.slice(pipeIdx + 1)}`;
				changed = true;
				prevWasEscaped = true;
			}
		}
	}
	return changed ? lines.join("\n") : text;
}

/**
 * Code span content inside a table cell escapes only `|`. Code spans never
 * unescape backslashes; GFM table splitting removes exactly one backslash in
 * front of each escaped `|` and leaves every other backslash untouched, so
 * `C:\path` stays `C:\path` and a literal `a\|b` becomes `a\\|b`.
 */
export function escapeCodeSpanTableContent(content: string): string {
	return content.replace(/\|/g, "\\|");
}

const TITLE_ENTITY_TOKEN =
	/(&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});)/giu;

function hasUnescapedQuote(text: string, quoteChar: '"' | "'"): boolean {
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === quoteChar) {
			let slashes = 0;
			for (let j = i - 1; j >= 0 && text[j] === "\\"; j -= 1) {
				slashes += 1;
			}
			if (slashes % 2 === 0) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Selects `"'"` when an inline PHP math span in `titleValue` contains a raw
 * unescaped `"` (and no raw unescaped `'`) so CommonMark title delimiters stay
 * collision-free while preserving PHP math spans byte-identically.
 */
export function chooseTitleQuoteDelimiter(titleValue: string): '"' | "'" {
	if (!titleValue.includes('"')) {
		return '"';
	}
	const mathRanges = scanPhpMarkdownMathRanges(titleValue);
	let mathHasUnescapedDouble = false;
	let mathHasUnescapedSingle = false;
	for (const range of mathRanges) {
		if (range.block) continue;
		const raw = titleValue.slice(range.from, range.to);
		if (hasUnescapedQuote(raw, '"')) mathHasUnescapedDouble = true;
		if (hasUnescapedQuote(raw, "'")) mathHasUnescapedSingle = true;
	}
	return mathHasUnescapedDouble && !mathHasUnescapedSingle ? "'" : '"';
}

function formatQuotedTitleSegment(
	segment: string,
	inTableCell: boolean,
	quoteChar: '"' | "'",
): string {
	const protectedEntities = segment.includes("&")
		? segment.replace(
				TITLE_ENTITY_TOKEN,
				(_, token: string) => `&amp;${token.slice(1)}`,
			)
		: segment;
	const encoded = protectedEntities
		.replace(/\r/gu, "&#13;")
		.replace(/\n/gu, "&#10;");
	const escapedSlashes = encoded.replace(/\\/g, "\\\\");
	const escaped =
		quoteChar === "'"
			? escapedSlashes.replace(/'/g, "\\'")
			: escapedSlashes.replace(/"/g, '\\"');
	return inTableCell ? escapeTablePipes(escaped) : escaped;
}

/**
 * Formats a CommonMark quoted link/image title while emitting preserved
 * inline PHP math spans (`\(...\)`, `$...$`) verbatim (no backslash escaping,
 * entity mangling, `&#10;` line-break encoding, or pipe escaping inside math).
 */
export function formatQuotedTitle(
	titleValue: string,
	inTableCell: boolean,
	mathNewlineToken: string | null = null,
	quoteChar: '"' | "'" = '"',
): string {
	const mathRanges = scanPhpMarkdownMathRanges(titleValue);
	if (mathRanges.length === 0) {
		return formatQuotedTitleSegment(titleValue, inTableCell, quoteChar);
	}
	let result = "";
	let cursor = 0;
	for (const range of mathRanges) {
		if (range.block || range.from < cursor) {
			continue;
		}
		if (range.from > cursor) {
			result += formatQuotedTitleSegment(
				titleValue.slice(cursor, range.from),
				inTableCell,
				quoteChar,
			);
		}
		const rawMath = titleValue.slice(range.from, range.to);
		result +=
			mathNewlineToken !== null && rawMath.includes("\n")
				? rawMath.split("\n").join(mathNewlineToken)
				: rawMath;
		cursor = range.to;
	}
	if (cursor < titleValue.length) {
		result += formatQuotedTitleSegment(
			titleValue.slice(cursor),
			inTableCell,
			quoteChar,
		);
	}
	return result;
}

export type ReferenceLinkCloseTarget = Readonly<{
	href: string;
	kind: "shortcut" | "collapsed" | "full";
	normalizedLabel: string;
	rawRefLabel: string;
	title: string | null;
}>;

export function isShortcutLinkHijackChar(ch: string | undefined): boolean {
	return ch === "(" || ch === "[" || ch === ":";
}

function normalizeReferenceLabel(label: string): string {
	return label.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
}

function hasUnescapedSquareBracket(text: string): boolean {
	let escaped = false;
	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			continue;
		}
		if (ch === "[" || ch === "]") {
			return true;
		}
	}
	return false;
}

/**
 * Formats the closing syntax of a preserved reference link (`]`, `][]`, or
 * `][ref]`) when its mark attributes still match `origin`, upgrading shortcut
 * links to `][]` before `(`, `[`, or `:` or to `][ref]` when label text changed.
 */
export function formatReferenceLinkClose(
	href: string,
	title: string | null,
	origin: ReferenceLinkCloseTarget,
	serializedLabel: string,
	inTableCell: boolean,
	inHeading: boolean,
	mathNewlineToken: string | null,
	nextCharMayHijackShortcut: boolean,
): string | null {
	if (href !== origin.href || title !== origin.title) {
		return null;
	}
	let refLabel = origin.rawRefLabel;
	if (refLabel.includes("\n")) {
		if (refLabel.includes("\\(")) {
			if (inHeading || inTableCell) return null;
			if (mathNewlineToken !== null) {
				refLabel = refLabel.split("\n").join(mathNewlineToken);
			}
		} else {
			refLabel = refLabel.replace(/[ \t\r\n]+/g, " ").trim();
		}
	}
	if (inTableCell) {
		refLabel = escapeTablePipes(refLabel);
	}
	if (refLabel.length === 0 || hasUnescapedSquareBracket(refLabel)) {
		return null;
	}
	const canUseLabelAsRef =
		!/\n[ \t]*\n/.test(serializedLabel) &&
		!hasUnescapedSquareBracket(serializedLabel) &&
		normalizeReferenceLabel(serializedLabel) === origin.normalizedLabel;
	if (origin.kind === "shortcut") {
		return canUseLabelAsRef
			? nextCharMayHijackShortcut
				? "][]"
				: "]"
			: `][${refLabel}]`;
	}
	if (origin.kind === "collapsed") {
		return canUseLabelAsRef ? "][]" : `][${refLabel}]`;
	}
	return `][${refLabel}]`;
}
