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
			index > 0 || (options.atLineStart ?? false),
			inTableCell,
			inLinkLabel,
		),
	);
	return escapedLines.join(separator);
}

/**
 * Escape only pipes that are not already backslash-escaped. Used for raw
 * protected inline Markdown and link/image titles that live inside a table.
 */
export function escapeTablePipes(raw: string): string {
	let escaped = "";
	let backslashRun = 0;
	for (const ch of raw) {
		if (ch === "\\") {
			escaped += ch;
			backslashRun += 1;
			continue;
		}
		if (ch === "|") {
			escaped += backslashRun % 2 === 0 ? "\\|" : "|";
			backslashRun = 0;
			continue;
		}
		escaped += ch;
		backslashRun = 0;
	}
	return escaped;
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
