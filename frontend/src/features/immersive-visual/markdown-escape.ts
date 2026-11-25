import {
	countTableRowCells,
	parseGfmTableSeparatorColumns,
} from "../../shared/markdown/php-commonmark-block-helpers";
import { scanPhpMarkdownMathRanges } from "../../shared/markdown/php-markdown-math-mask";

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
 * or inside a list) from parsing as a GFM table when a pipe-bearing line is
 * followed by a GFM table separator line (e.g. `Z |\n| - |`).
 */
export function escapeParagraphTableDelimiters(text: string): string {
	if (!text.includes("\n") || !text.includes("|")) {
		return text;
	}
	const lines = text.split("\n");
	let changed = false;
	for (let j = 0; j < lines.length - 1; j += 1) {
		const prev = lines[j] ?? "";
		const next = lines[j + 1] ?? "";
		const sepCols = parseGfmTableSeparatorColumns(next);
		if (
			sepCols > 0 &&
			prev.includes("|") &&
			countTableRowCells(prev) === sepCols
		) {
			const pipeIdx = next.indexOf("|");
			if (pipeIdx >= 0) {
				lines[j + 1] = `${next.slice(0, pipeIdx)}\\|${next.slice(pipeIdx + 1)}`;
				changed = true;
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
