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

function startsLinkLikeSyntax(rest: string): boolean {
	return (
		/^\[[^\]\n]*\](?:\(|\[)/.test(rest) ||
		/^\[\^/.test(rest) ||
		/^\[TOC\][ \t]*$/i.test(rest)
	);
}

function escapeInlineChar(
	ch: string,
	rest: string,
	inTableCell: boolean,
	inLinkLabel: boolean,
): string {
	switch (ch) {
		case "\\":
			return "\\\\";
		case "`":
			return "\\`";
		case "*":
			return "\\*";
		case "_":
			return "\\_";
		case "~":
			return "\\~";
		// `\[...\]` is KaTeX block math for EasyMDE (and PHP), so only escape a
		// bracket that could actually open link/image/footnote syntax. Plain
		// prose such as `[edited]` stays readable and byte-stable.
		case "[":
			return inLinkLabel || startsLinkLikeSyntax(rest) ? "\\[" : "[";
		case "]":
			return inLinkLabel ? "\\]" : "]";
		case "$":
			return "\\$";
		case "<":
			return rest.length > 1 && /[A-Za-z/!?]/.test(rest[1] ?? "") ? "\\<" : "<";
		case "&":
			return /^&#?[A-Za-z0-9]+;/.test(rest) ? "\\&" : "&";
		case "|":
			return inTableCell ? "\\|" : "|";
		default:
			return ch;
	}
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

function escapeInlineLine(
	line: string,
	atLineStart: boolean,
	inTableCell: boolean,
	inLinkLabel: boolean,
): string {
	let escaped = "";
	let start = 0;
	if (atLineStart) {
		const prefix = escapeLineStartPrefix(line);
		escaped = prefix.escaped;
		start = prefix.consumed;
	}
	for (let i = start; i < line.length; i += 1) {
		const ch = line[i] ?? "";
		escaped += escapeInlineChar(ch, line.slice(i), inTableCell, inLinkLabel);
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
	const lines = text.split("\n");
	const separator = inHeading ? " " : inTableCell ? "<br>" : "\n";
	const escapedLines = lines.map((line, index) =>
		escapeInlineLine(
			line,
			!inHeading && (index > 0 || (options.atLineStart ?? false)),
			inTableCell,
			inLinkLabel,
		),
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

function formatQuotedTitleSegment(
	segment: string,
	inTableCell: boolean,
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
	const escaped = encoded.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	return inTableCell ? escapeTablePipes(escaped) : escaped;
}

/**
 * Formats a CommonMark double-quoted link/image title while emitting preserved
 * inline PHP math spans (`\(...\)`, `$...$`) verbatim (no backslash escaping,
 * entity mangling, `&#10;` line-break encoding, or pipe escaping inside math).
 */
export function formatQuotedTitle(
	titleValue: string,
	inTableCell: boolean,
	mathNewlineToken: string | null = null,
): string {
	const mathRanges = scanPhpMarkdownMathRanges(titleValue);
	if (mathRanges.length === 0) {
		return formatQuotedTitleSegment(titleValue, inTableCell);
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
		result += formatQuotedTitleSegment(titleValue.slice(cursor), inTableCell);
	}
	return result;
}
