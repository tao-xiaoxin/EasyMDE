import { COMMONMARK_ESCAPABLE_PUNCTUATION } from "../../../shared/image-scale-title";
import {
	advancePhpCommonMarkBlockLine,
	createPhpCommonMarkBlockState,
	type PhpCommonMarkBlockState,
} from "../../../shared/markdown/php-commonmark-block-engine";
import {
	consumeBlockquoteMarker,
	consumeWhitespaceColumns,
	cursorRemainder,
	type LineColumnCursor,
	matchListMarkerLength,
	measureLeadingColumns,
	nextNonSpaceIndex,
} from "../../../shared/markdown/php-commonmark-block-helpers";
import {
	createInlineHtmlScanGuard,
	type InlineHtmlSegment,
	matchBlockInlineHtmlOrAutolink,
	matchSingleLineInlineHtmlOrAutolink,
} from "../../../shared/markdown/php-commonmark-inline-html";
import {
	maskPhpMarkdownMathForTableScan,
	type PhpMarkdownMathRange,
	scanPhpMarkdownMathRanges,
} from "../../../shared/markdown/php-markdown-math-mask";
import { isCommonMarkBlankLine } from "../markdown-prescanner";

type BlockContainer = PhpCommonMarkBlockState["containers"][number];
type ListMeta = { emittedIndent: number | null; leadCols: number; markerText: string; origIndent: number; padding: number };
type PreviewLineKind = "blank" | "content" | "display-math" | "fenced-code" | "html-block" | "indented-code";
type PreviewLine = {
	containers: BlockContainer[]; contentRel: number; kind: PreviewLineKind;
	maskedLine: string; openedHereStart: number; rawLine: string;
	scanned: PhpCommonMarkBlockState["lines"][number]; strippedRest: string; syntheticBlank: boolean;
};
type InlineHtmlSegmentTable = Readonly<{ groupEnds: number[]; segments: InlineHtmlSegment[] }>;

const COMMONMARK_URI_AUTOLINK_PREFIX = /^<[A-Za-z][A-Za-z0-9.+-]{1,31}:/;
const COMMONMARK_EMAIL_AUTOLINK =
	/^<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*>$/;

function indexBacktickRuns(text: string): Map<number, number[]> | null {
	let i = text.indexOf("`");
	if (i < 0) return null;
	const first = i;
	while (i < text.length && text[i] === "`") i += 1;
	let s = text.indexOf("`", i);
	if (s < 0) return null;
	const runs = new Map<number, number[]>([[i - first, [first]]]);
	for (; s >= 0; s = text.indexOf("`", i)) {
		i = s + 1;
		while (i < text.length && text[i] === "`") i += 1;
		const b = runs.get(i - s);
		if (b) b.push(s); else runs.set(i - s, [s]);
	}
	return runs;
}

function isCommonMarkAutolink(token: string): boolean {
	if (token.length < 4 || token[0] !== "<" || token[token.length - 1] !== ">") return false;
	if (COMMONMARK_URI_AUTOLINK_PREFIX.test(token)) {
		for (let k = token.indexOf(":") + 1; k < token.length - 1; k += 1) {
			const ch = token[k];
			if (ch === "<" || ch === ">" || token.charCodeAt(k) <= 0x20) return false;
		}
		return true;
	}
	return COMMONMARK_EMAIL_AUTOLINK.test(token);
}

/**
 * Splits `text` into single-line segments and precomputes the inclusive end
 * index of each contiguous non-blank paragraph run so multiline CommonMark
 * §6.6 inline HTML tags never cross blank lines or display-math breaks.
 */
function buildInlineHtmlSegments(text: string): InlineHtmlSegmentTable {
	const segments: InlineHtmlSegment[] = [];
	const isBlank: boolean[] = [];
	let start = 0;
	for (let pos = 0; pos <= text.length; pos += 1) {
		if (pos === text.length || text[pos] === "\n") {
			segments.push({ contentOffset: start, lineEnd: pos });
			isBlank.push(isCommonMarkBlankLine(text.slice(start, pos)));
			start = pos + 1;
		}
	}
	const groupEnds = new Array<number>(segments.length);
	let runEnd = segments.length - 1;
	for (let idx = segments.length - 1; idx >= 0; idx -= 1) {
		if (isBlank[idx]) {
			groupEnds[idx] = idx;
			runEnd = idx - 1;
		} else {
			if (runEnd < idx) runEnd = idx;
			groupEnds[idx] = runEnd;
		}
	}
	return { groupEnds, segments };
}

/**
 * Core linear-time scanner that strips CommonMark §6.6 inline raw HTML tokens
 * (including multiline open/close tags, quoted attributes, comments, CDATA,
 * PIs, and declarations) outside §6.1 backtick code spans (including multiline
 * spans and PHP `InlineParserEngine` escaped leading backtick runs) and §6.5
 * autolinks. Never crosses blank-line / display-math breaks and never emits
 * stripped tokens' internal `\n` into visible text; when `linesOut` and
 * `entryEnds` are provided, tracks source entries by exact separator offsets so
 * internal `\n` inside multiline `\(...\)` math stays aligned.
 */
function stripInlineHtmlCore(
	text: string,
	linesOut: string[] | null,
	precomputedScanText: string | null,
	entryEnds: ReadonlyArray<number> | null,
): string {
	const scanText = precomputedScanText ?? maskPhpMarkdownMathForTableScan(text);
	const runs = indexBacktickRuns(scanText);
	const cursors = runs ? new Map<number, number>() : null;
	let guard = createInlineHtmlScanGuard();
	let activeGuardEnd = Number.POSITIVE_INFINITY;
	let segmentTable: InlineHtmlSegmentTable | null = null;
	let segIdx = 0;
	let srcLine = 0;
	let outLine = 0;
	let lineEnd = scanText.indexOf("\n");
	if (lineEnd < 0) lineEnd = scanText.length;
	let out = "";

	const advanceSkippedLines = (end: number): void => {
		if (linesOut === null || entryEnds === null) return;
		while (srcLine < entryEnds.length && (entryEnds[srcLine] ?? Number.POSITIVE_INFINITY) < end) {
			srcLine += 1;
		}
	};

	const emitSlice = (start: number, end: number): void => {
		if (linesOut === null || entryEnds === null) {
			out += text.slice(start, end);
			return;
		}
		let cursor = start;
		while (srcLine < entryEnds.length && (entryEnds[srcLine] ?? Number.POSITIVE_INFINITY) < end) {
			const sep = entryEnds[srcLine] ?? end;
			if (sep > cursor) linesOut[outLine] = `${linesOut[outLine] ?? ""}${text.slice(cursor, sep)}`;
			srcLine += 1;
			outLine = srcLine;
			cursor = sep + 1;
		}
		if (end > cursor) linesOut[outLine] = `${linesOut[outLine] ?? ""}${text.slice(cursor, end)}`;
	};

	for (let i = 0; i < text.length; ) {
		const ch = scanText[i] ?? "";
		if (ch === "\\" && COMMONMARK_ESCAPABLE_PUNCTUATION.test(scanText[i + 1] ?? "")) {
			let end = i + 2;
			// Match PHP `League\CommonMark\Parser\InlineParserEngine`: after
			// escaping the leading backtick of a contiguous run, escape every
			// backtick in that run so secondary `markdown-it` keeps them literal.
			if (scanText[i + 1] === "`") {
				while (end < scanText.length && scanText[end] === "`") end += 1;
				const escaped = "\\`".repeat(end - i - 1);
				if (linesOut === null) out += escaped;
				else linesOut[outLine] = `${linesOut[outLine] ?? ""}${escaped}`;
			} else {
				emitSlice(i, end);
			}
			i = end;
		} else if (ch === "`") {
			let end = i + 1;
			while (end < scanText.length && scanText[end] === "`") end += 1;
			const bucket = runs?.get(end - i);
			if (bucket && cursors) {
				let pos = cursors.get(end - i) ?? 0;
				while (pos < bucket.length && (bucket[pos] ?? -1) < end) pos += 1;
				cursors.set(end - i, pos);
				if (bucket[pos] !== undefined) end = (bucket[pos] ?? 0) + (end - i);
			}
			emitSlice(i, end);
			i = end;
		} else if (ch === "<") {
			if (i > activeGuardEnd) {
				guard = createInlineHtmlScanGuard();
				activeGuardEnd = Number.POSITIVE_INFINITY;
			}
			if (i > lineEnd) {
				const nextNl = scanText.indexOf("\n", i);
				lineEnd = nextNl < 0 ? scanText.length : nextNl;
			}
			const single = matchSingleLineInlineHtmlOrAutolink(scanText, i, guard, lineEnd);
			if (single.status === "ok") {
				if (isCommonMarkAutolink(scanText.slice(i, single.end))) emitSlice(i, single.end);
				else advanceSkippedLines(single.end);
				i = single.end;
			} else if (single.status === "needs-multiline") {
				if (segmentTable === null) segmentTable = buildInlineHtmlSegments(scanText);
				const { groupEnds, segments } = segmentTable;
				while (segIdx + 1 < segments.length && (segments[segIdx]?.lineEnd ?? 0) < i) segIdx += 1;
				const groupEnd = groupEnds[segIdx] ?? segIdx;
				const runEndOffset = segments[groupEnd]?.lineEnd ?? scanText.length;
				const blockMatch = matchBlockInlineHtmlOrAutolink(scanText, segments, segIdx, i, groupEnd, guard);
				if (blockMatch !== null) {
					if (blockMatch.segIdx === segIdx && isCommonMarkAutolink(scanText.slice(i, blockMatch.pos))) {
						emitSlice(i, blockMatch.pos);
					} else {
						advanceSkippedLines(blockMatch.pos);
					}
					segIdx = blockMatch.segIdx;
					i = blockMatch.pos;
				} else {
					activeGuardEnd = Math.min(activeGuardEnd, runEndOffset);
					emitSlice(i, i + 1);
					i += 1;
				}
			} else {
				emitSlice(i, i + 1);
				i += 1;
			}
		} else {
			emitSlice(i, i + 1);
			i += 1;
		}
	}
	return out;
}

export function stripInlineHtmlOutsideCode(text: string): string {
	const normalized = text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
	return stripInlineHtmlCore(normalized, null, null, null);
}

function stripInlineHtmlLinesOutsideCode(
	rawLines: ReadonlyArray<string>,
	maskedLines: ReadonlyArray<string>,
): string[] {
	const linesOut = new Array<string>(rawLines.length).fill("");
	const entryEnds: number[] = [];
	let offset = 0;
	for (let idx = 0; idx < rawLines.length - 1; idx += 1) {
		offset += rawLines[idx]?.length ?? 0;
		entryEnds.push(offset);
		offset += 1;
	}
	stripInlineHtmlCore(rawLines.join("\n"), linesOut, maskedLines.join("\n"), entryEnds);
	return linesOut;
}

function consumeListMarker(cursor: LineColumnCursor, origIndent: number): ListMeta {
	const leadCols = measureLeadingColumns(cursor);
	consumeWhitespaceColumns(cursor, leadCols);
	const len = matchListMarkerLength(cursor.line.slice(cursor.index), false);
	const markerText = cursor.line.slice(cursor.index, cursor.index + len);
	cursor.index += len; cursor.column += len;
	const padding = Math.max(1, origIndent - leadCols - len);
	consumeWhitespaceColumns(cursor, Math.min(padding, measureLeadingColumns(cursor)));
	return { emittedIndent: null, leadCols, markerText, origIndent, padding };
}

function rewritePreviewLine(
	entry: PreviewLine,
	listMeta: Map<BlockContainer, ListMeta>,
	emittedQuotes: Set<BlockContainer>,
): string {
	const { containers, contentRel, kind, openedHereStart, rawLine, strippedRest } = entry;
	const needsRewrite = (limit: number): boolean =>
		containers.slice(0, limit).some((c) =>
			c.kind === "list"
				? listMeta.get(c)?.emittedIndent !== c.indent
				: !emittedQuotes.has(c),
		);
	const hasPendingContainer = (from: number): boolean =>
		containers.slice(from).some((c) =>
			c.kind === "list"
				? listMeta.get(c)?.emittedIndent === null
				: !emittedQuotes.has(c),
		);
	const cursor: LineColumnCursor = { column: 0, index: 0, line: rawLine, virtualSpaces: 0 };
	if (kind === "blank") {
		if (!needsRewrite(containers.length)) return rawLine.slice(0, contentRel).replace(/[ \t]+$/, "");
		let out = ""; let hasQuote = false;
		for (const c of containers) {
			if (c.kind === "blockquote") {
				const lead = measureLeadingColumns(cursor);
				if (!consumeBlockquoteMarker(cursor)) break;
				out += `${" ".repeat(lead)}> `; hasQuote = true;
				emittedQuotes.add(c);
			} else {
				const m = listMeta.get(c);
				if (!m || m.emittedIndent === null || measureLeadingColumns(cursor) < c.indent) break;
				consumeWhitespaceColumns(cursor, c.indent);
				out += " ".repeat(m.emittedIndent);
			}
		}
		return hasQuote ? out.replace(/[ \t]+$/, "") : "";
	}
	const isCode = kind === "fenced-code" || kind === "indented-code";
	if (!needsRewrite(openedHereStart)) {
		for (const c of containers.slice(openedHereStart)) {
			if (c.kind === "blockquote") {
				emittedQuotes.add(c);
			} else {
				const m = listMeta.get(c);
				if (m) m.emittedIndent = m.origIndent;
			}
		}
		return isCode ? rawLine : `${rawLine.slice(0, contentRel)}${strippedRest}`;
	}
	let out = ""; let prev: ListMeta | null = null; let lazyStopped = false; let materializedLazy = false;
	const flush = (nextCols: number): number => {
		if (!prev) return nextCols;
		const total = (nextCols >= 4 ? 1 : Math.max(1, Math.min(prev.padding, 4 - nextCols))) + nextCols;
		prev.emittedIndent = prev.leadCols + prev.markerText.length + (total >= 5 ? 1 : total);
		prev = null;
		return total;
	};
	for (let k = 0; k < containers.length; k += 1) {
		const c = containers[k];
		if (!c) break;
		if (c.kind === "blockquote") {
			const lead = measureLeadingColumns(cursor);
			const colAfter = cursor.column + lead;
			if (!lazyStopped && consumeBlockquoteMarker(cursor)) {
				out += " ".repeat(flush(lead)) + (cursor.column - colAfter - 1 > 0 ? "> " : ">");
				emittedQuotes.add(c);
			} else {
				lazyStopped = true;
				if (!hasPendingContainer(k)) break;
				out += `${" ".repeat(flush(0))}> `;
				emittedQuotes.add(c);
				materializedLazy = true;
			}
		} else {
			const m = listMeta.get(c);
			if (!m) break;
			if (k < openedHereStart) {
				const lazy = lazyStopped || measureLeadingColumns(cursor) < c.indent;
				if (!lazy) consumeWhitespaceColumns(cursor, c.indent);
				if (m.emittedIndent === null) {
					const hadPrev = prev !== null;
					out += `${" ".repeat(flush(m.leadCols))}${m.markerText}`;
					if (hadPrev) m.leadCols = 0;
					prev = m;
					if (lazy) {
						lazyStopped = true;
						materializedLazy = true;
						if (!hasPendingContainer(k + 1)) break;
					}
				} else if (!lazy) {
					out += " ".repeat(m.emittedIndent);
				} else {
					lazyStopped = true;
					if (!hasPendingContainer(k + 1)) break;
					out += " ".repeat(flush(m.emittedIndent));
					materializedLazy = true;
				}
			} else {
				const hadPrev = prev !== null;
				consumeListMarker(cursor, c.indent);
				out += `${" ".repeat(flush(m.leadCols))}${m.markerText}${" ".repeat(m.padding)}`;
				m.emittedIndent = hadPrev ? m.origIndent - m.leadCols : m.origIndent;
			}
		}
	}
	if (lazyStopped && !prev && !materializedLazy) return `${rawLine.slice(0, contentRel)}${strippedRest}`;
	if (prev) {
		const rawExtra = isCode ? measureLeadingColumns(cursor)
			: lazyStopped ? 0
			: measureLeadingColumns({ column: cursor.column, index: 0, line: strippedRest, virtualSpaces: cursor.virtualSpaces });
		const extra = !isCode && rawExtra >= 4 ? 0 : rawExtra;
		return `${out}${" ".repeat(flush(extra))}${isCode ? rawLine.slice(nextNonSpaceIndex(cursor)) : strippedRest.replace(/^[ \t]+/, "")}`;
	}
	return isCode
		? kind === "indented-code"
			? `${out}${" ".repeat(measureLeadingColumns(cursor))}${rawLine.slice(nextNonSpaceIndex(cursor))}`
			: `${out}${cursorRemainder(cursor)}`
		: lazyStopped
			? `${out}${strippedRest.replace(/^[ \t]+/, "")}`
			: `${out}${cursor.virtualSpaces > 0 ? " ".repeat(cursor.virtualSpaces) : ""}${strippedRest}`;
}

function isSyntheticDisplayMathBlank(
	range: PhpMarkdownMathRange | undefined,
	lineStart: number,
	lineEnd: number,
): boolean {
	if (!range || lineStart !== lineEnd) return false;
	return (
		lineStart === range.from || lineStart === range.from + 1 ||
		lineStart === range.to - 1 || lineStart === range.to
	);
}

/**
 * Strip raw HTML blocks and inline tags from a protected `raw` Markdown block
 * using CommonMark `html_input: 'strip'` semantics (matching EasyMDE's `main`
 * PHP `MarkdownRenderer`), masking PHP-extracted math before block scanning so
 * inline math never closes HTML comments/blocks and display math terminates
 * Type 6/7 HTML blocks cleanly, while preserving list containers across
 * stripped HTML blocks and multiline CommonMark §6.1 backtick code spans.
 */
export function stripCommonMarkHtmlForPreview(rawMarkdown: string): string {
	const normalized = rawMarkdown.replace(/\r\n?/g, "\n");
	const mathRanges = scanPhpMarkdownMathRanges(normalized);
	const maskedDoc = mathRanges.length > 0 ? maskPhpMarkdownMathForTableScan(normalized, mathRanges) : normalized;
	const displayMathRanges = mathRanges.filter((range) => range.block);

	const state = createPhpCommonMarkBlockState(true, true);
	const listMeta = new Map<BlockContainer, ListMeta>();
	const emittedQuotes = new Set<BlockContainer>();
	const entries: PreviewLine[] = [];
	let offset = 0;
	let displayIdx = 0;

	for (const maskedLine of maskedDoc.split("\n")) {
		const lineStart = offset;
		const lineEnd = lineStart + maskedLine.length;
		const nextLineStart = lineEnd + 1;
		offset = nextLineStart;

		while (displayIdx < displayMathRanges.length && (displayMathRanges[displayIdx]?.to ?? 0) < lineStart) {
			displayIdx += 1;
		}
		const activeDisplay = displayMathRanges[displayIdx];
		const matchedDisplay =
			activeDisplay && lineStart === activeDisplay.from + 2 && lineEnd === activeDisplay.to - 2
				? activeDisplay
				: null;
		const syntheticBlank = isSyntheticDisplayMathBlank(activeDisplay, lineStart, lineEnd);

		const prevContainers = state.containers.slice();
		advancePhpCommonMarkBlockLine(state, maskedLine, lineStart, lineEnd, nextLineStart);
		const scanned = state.lines[state.lines.length - 1];
		if (!scanned) continue;

		let openedHereStart = 0;
		while (openedHereStart < prevContainers.length && state.containers[openedHereStart] === prevContainers[openedHereStart]) {
			openedHereStart += 1;
		}
		const containers = state.containers.slice();
		if (containers.slice(openedHereStart).some((c) => c.kind === "list")) {
			const cursor: LineColumnCursor = { column: 0, index: 0, line: maskedLine, virtualSpaces: 0 };
			for (let k = 0; k < containers.length; k += 1) {
				const c = containers[k];
				if (!c) break;
				if (c.kind === "blockquote") consumeBlockquoteMarker(cursor);
				else if (k < openedHereStart) consumeWhitespaceColumns(cursor, c.indent);
				else listMeta.set(c, consumeListMarker(cursor, c.indent));
			}
		}

		const contentRel = Math.max(0, scanned.contentOffset - lineStart);
		const kind: PreviewLineKind =
			state.leaf?.kind === "html-block" ? "html-block"
			: state.blockCodeRanges[state.blockCodeRanges.length - 1]?.end === nextLineStart
				? (state.leaf?.kind === "indented-code" ? "indented-code" : "fenced-code")
				: matchedDisplay !== null ? "display-math"
				: isCommonMarkBlankLine(maskedLine.slice(contentRel)) ? "blank" : "content";
		const rawLine = matchedDisplay !== null
			? normalized.slice(matchedDisplay.from, matchedDisplay.to)
			: normalized.slice(lineStart, lineEnd);

		entries.push({ containers, contentRel, kind, maskedLine, openedHereStart, rawLine, scanned, strippedRest: "", syntheticBlank });
	}

	for (let idx = 0; idx < entries.length; ) {
		const entry = entries[idx];
		if (entry?.kind !== "content") { idx += 1; continue; }
		const blockId = entry.scanned.inlineBlockId;
		let end = idx + 1;
		while (blockId >= 0 && entries[end]?.kind === "content" && entries[end]?.scanned.inlineBlockId === blockId) end += 1;
		const slice = entries.slice(idx, end);
		const stripped = stripInlineHtmlLinesOutsideCode(
			slice.map((e) => e.rawLine.slice(e.contentRel)),
			slice.map((e) => e.maskedLine.slice(e.contentRel)),
		);
		for (let j = idx; j < end; j += 1) {
			const target = entries[j];
			if (target) target.strippedRest = stripped[j - idx] ?? "";
		}
		idx = end;
	}

	const kept: string[] = [];
	let lastKeptWasSyntheticBlank = false;
	for (const e of entries) {
		if (e.kind === "html-block" || (e.kind === "blank" && kept.length === 0)) continue;
		if (e.kind === "content" && isCommonMarkBlankLine(e.strippedRest)) continue;
		if (e.kind === "display-math") {
			kept.push(e.rawLine);
			lastKeptWasSyntheticBlank = false;
			continue;
		}
		if (e.kind === "blank" && !e.scanned.consumedBlockquote) {
			if (e.syntheticBlank) {
				if (kept[kept.length - 1] === "") continue;
				kept.push("");
				lastKeptWasSyntheticBlank = true;
				continue;
			}
			if (lastKeptWasSyntheticBlank) {
				lastKeptWasSyntheticBlank = false;
				continue;
			}
			kept.push("");
			continue;
		}
		kept.push(rewritePreviewLine(e, listMeta, emittedQuotes));
		lastKeptWasSyntheticBlank = false;
	}
	return kept.join("\n").replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "");
}
