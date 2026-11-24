import { markdownLineStarts } from "../../shared/markdown/markdown-line-model";

/**
 * One physical Markdown line, projected onto its canonical source offsets.
 *
 * `end` stops before the line terminator, `fullEnd` includes it, and
 * `separator` keeps the document's exact `\n`, `\r\n`, or `\r` bytes. Both the
 * generic insertion rules and the table syntax owners read lines through this
 * one projection, so a table cell and a paragraph block never disagree about
 * where a line ends.
 */
export type MarkdownLine = Readonly<{
	end: number;
	fullEnd: number;
	separator: string;
	start: number;
	text: string;
}>;

export function linesOf(value: string): ReadonlyArray<MarkdownLine> {
	const starts = markdownLineStarts(value);
	return starts.map((start, index) => {
		const nextStart = starts[index + 1] ?? value.length;
		const separatorLength =
			nextStart > start && "\n" === value[nextStart - 1]
				? "\r" === value[nextStart - 2]
					? 2
					: 1
				: nextStart > start && "\r" === value[nextStart - 1]
					? 1
					: 0;
		const end = nextStart - separatorLength;

		return {
			end,
			fullEnd: nextStart,
			separator: value.slice(end, nextStart),
			start,
			text: value.slice(start, end),
		};
	});
}

export function lineIndexAt(
	lines: ReadonlyArray<MarkdownLine>,
	position: number,
): number {
	let low = 0;
	let high = lines.length - 1;
	let result = Math.max(0, lines.length - 1);
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const line = lines[middle];
		if (!line) break;
		if (position <= line.end || position < line.fullEnd) {
			result = middle;
			high = middle - 1;
			continue;
		}
		low = middle + 1;
	}
	return result;
}

/**
 * Line index for a precomputed `markdownLineStarts` snapshot. Owners that also
 * need textual lines still use `lineIndexAt` over `linesOf`.
 */
export function lineIndexAtOffsets(
	starts: ReadonlyArray<number>,
	position: number,
): number {
	let low = 0;
	let high = starts.length - 1;
	let result = 0;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const start = starts[middle];
		if (undefined === start || start > position) {
			high = middle - 1;
		} else {
			result = middle;
			low = middle + 1;
		}
	}
	return result;
}

/** The first newline convention the document actually uses. */
export function newlineFor(
	value: string,
	lines: ReadonlyArray<MarkdownLine>,
): string {
	const line = lines.find((candidate) => "" !== candidate.separator);
	if (line) return line.separator;
	return value.includes("\r\n") ? "\r\n" : "\n";
}
