import {
	createPhpInlineStream,
	isPhpTrimChar,
	parsePhpInlineLinkTail,
	parsePhpLinkLabel,
} from "../../shared/markdown/php-commonmark-block-helpers";
import {
	collectBlockBacktickRuns,
	findLineIndexAtOffset,
	findNextBacktickRun,
	findTableRowCellInCells,
	getCachedPhpTableRowCells,
	getInlineBlockBounds,
	type ScannedMarkdownBlocks,
	type ScannedMarkdownLine,
	type TableRowCellRange,
} from "../../shared/markdown/php-commonmark-block-scan";
import {
	collectGfmAutolinkStops,
	createInlineHtmlScanGuard,
	type GfmAutolinkStops,
	gfmEmailAutolinkEnd,
	isGfmUrlAutolinkAllowedAfter,
	matchBlockInlineHtmlOrAutolink,
	matchCommonMarkAutolinkOnLine,
	matchGfmUrlAutolink,
} from "../../shared/markdown/php-commonmark-inline-html";
import type { ParserLinkNode } from "./editor-markdown-link-preparation";
import type { SourceRange } from "./editor-markdown-source-projection";

type BracketOpener = {
	active: boolean;
	hasNext: boolean;
	image: boolean;
	labelFrom: number;
	pos: number;
};

type PhpOwnedInlineScope =
	| Readonly<{
			from: number;
			groupEnd: number;
			groupStart: number;
			isTableCell: false;
			to: number;
	  }>
	| Readonly<{
			from: number;
			isTableCell: true;
			line: ScannedMarkdownLine;
			to: number;
	  }>;

export type PhpOwnedBlockLinks = Readonly<{
	links: ReadonlyArray<ParserLinkNode>;
	ownedRanges: ReadonlyArray<SourceRange>;
}>;

/**
 * Replays PHP `League\CommonMark\Parser\InlineParserEngine` over one inline
 * block for the parsers that create or mask links: stop positions from
 * `matchParsers()`, code spans, escapes, §6.5 autolinks, inline HTML, GFM
 * URL/email autolinks, and bracket links (nested links restored to text,
 * earlier link openers deactivated). Returns each rendered link's exact
 * consumed source range.
 */
function scanPhpInlineBlockLinks(
	text: string,
	lines: ReadonlyArray<ScannedMarkdownLine>,
	groupStart: number,
	groupEnd: number,
	isReferenceDefined: (from: number, to: number) => boolean,
): ParserLinkNode[] {
	const stream = createPhpInlineStream(text, lines, groupEnd);
	const runs = collectBlockBacktickRuns(text, lines, groupStart, groupEnd);
	const guard = createInlineHtmlScanGuard();
	const emitted: ParserLinkNode[] = [];
	const openers: BracketOpener[] = [];
	let stops: GfmAutolinkStops | null = null;
	let stopsSegment = -1;
	let s = groupStart;
	let p = lines[groupStart]?.contentOffset ?? 0;
	for (;;) {
		const seg = lines[s];
		if (!seg) break;
		if (p >= seg.lineEnd) {
			if (s >= groupEnd) break;
			s += 1;
			p = Math.max(p, lines[s]?.contentOffset ?? p);
			continue;
		}
		if (stopsSegment !== s) {
			stops = collectGfmAutolinkStops(text, seg.contentOffset, seg.lineEnd);
			stopsSegment = s;
		}
		const ch = text[p];
		if ("`" === ch) {
			let end = p + 1;
			while (end < seg.lineEnd && "`" === text[end]) end += 1;
			// Only a run start is a `BacktickParser` stop (an escape may land mid-run).
			const isStop = p === seg.contentOffset || "`" !== text[p - 1];
			const close = isStop ? findNextBacktickRun(runs, end - p, end) : -1;
			p = close >= 0 ? close + end - p : end;
			continue;
		}
		if ("\\" === ch) {
			if (stream.isEscape({ p, s })) p += 2;
			else if (p + 1 >= seg.lineEnd && s < groupEnd) p = seg.lineEnd;
			else p += 1;
			continue;
		}
		if ("<" === ch) {
			const autolinkEnd = matchCommonMarkAutolinkOnLine(text, p, seg.lineEnd);
			if (autolinkEnd >= 0) {
				emitted.push({
					from: p,
					kind: "autolink",
					reference: false,
					to: autolinkEnd,
				});
				p = autolinkEnd;
				continue;
			}
			const html = matchBlockInlineHtmlOrAutolink(
				text,
				lines,
				s,
				p,
				groupEnd,
				guard,
			);
			if (html) {
				s = html.segIdx;
				p = html.pos;
			} else p += 1;
			continue;
		}
		if (
			"[" === ch ||
			("!" === ch && "[" === text[p + 1] && p + 1 < seg.lineEnd)
		) {
			const top = openers[openers.length - 1];
			if (top) top.hasNext = true;
			const image = "!" === ch;
			openers.push({
				active: true,
				hasNext: false,
				image,
				labelFrom: p + (image ? 2 : 1),
				pos: p,
			});
			p += image ? 2 : 1;
			continue;
		}
		if ("]" === ch) {
			const opener = openers[openers.length - 1];
			if (!opener || (!opener.image && !opener.active)) {
				openers.pop();
				p += 1;
				continue;
			}
			const after = { p: p + 1, s };
			let end = parsePhpInlineLinkTail(text, stream, after);
			let reference = false;
			if (!end) {
				const label = parsePhpLinkLabel(stream, after);
				const from =
					label && label.length > 2
						? p + 2
						: opener.hasNext
							? -1
							: opener.labelFrom;
				const to = label && label.length > 2 ? label.end.p - 1 : p;
				if (from >= 0 && isReferenceDefined(from, to)) {
					end = label ? label.end : after;
					reference = true;
				}
			}
			openers.pop();
			if (!end) {
				p += 1;
				continue;
			}
			while ((emitted[emitted.length - 1]?.from ?? -1) >= opener.pos)
				emitted.pop();
			if (!opener.image) {
				emitted.push({ from: opener.pos, kind: "link", reference, to: end.p });
				// Mirror PHP `DelimiterStack::deactivateLinkOpeners()` in O(1) amortized time.
				for (let idx = openers.length - 1; idx >= 0; idx -= 1) {
					const earlier = openers[idx];
					if (!earlier?.active) break;
					earlier.active = false;
				}
			}
			s = end.s;
			p = end.p;
			continue;
		}
		const emailEnd = stops?.emails.get(p);
		const emailTo =
			undefined === emailEnd ? -1 : gfmEmailAutolinkEnd(text, emailEnd);
		if (emailTo > p) {
			emitted.push({ from: p, kind: "link", reference: false, to: emailTo });
			p = emailTo;
			continue;
		}
		if (
			stops?.urls.has(p) &&
			isGfmUrlAutolinkAllowedAfter(
				p === seg.contentOffset ? null : (text[p - 1] ?? null),
			)
		) {
			const urlEnd = matchGfmUrlAutolink(text, p);
			if (urlEnd > p) {
				emitted.push({ from: p, kind: "link", reference: false, to: urlEnd });
				p = urlEnd;
				continue;
			}
		}
		p += 1;
	}
	return emitted;
}

/**
 * Replays PHP `TableParser::parseCell()` (`trim($cell)` + `\|` -> `|`) over
 * one table cell `[cellFrom, cellTo)`, isolating `InlineParserEngine` strictly
 * to the cell text and mapping emitted links back to exact original offsets.
 */
function scanPhpTableCellLinks(
	text: string,
	line: ScannedMarkdownLine,
	cellFrom: number,
	cellTo: number,
	isReferenceDefined: (from: number, to: number) => boolean,
): ParserLinkNode[] {
	let trimStart = cellFrom;
	let trimEnd = cellTo;
	while (trimStart < trimEnd && isPhpTrimChar(text[trimStart])) trimStart += 1;
	while (trimEnd > trimStart && isPhpTrimChar(text[trimEnd - 1])) trimEnd -= 1;
	if (trimStart >= trimEnd) return [];

	const rawSlice = text.slice(trimStart, trimEnd);
	if (!rawSlice.includes("\\|")) {
		const cellLine: ScannedMarkdownLine = {
			...line,
			contentOffset: 0,
			lineEnd: rawSlice.length,
			lineStart: 0,
			nextLineStart: rawSlice.length,
			virtualSpaces: 0,
		};
		const cellLinks = scanPhpInlineBlockLinks(
			rawSlice,
			[cellLine],
			0,
			0,
			(cFrom, cTo) => isReferenceDefined(trimStart + cFrom, trimStart + cTo),
		);
		return cellLinks.map((link) => ({
			from: trimStart + link.from,
			kind: link.kind,
			reference: link.reference,
			to: trimStart + link.to,
		}));
	}

	const parts: string[] = [];
	const origPos: number[] = [];
	for (let i = trimStart; i < trimEnd; i += 1) {
		origPos.push(i);
		if ("\\" === text[i] && i + 1 < trimEnd && "|" === text[i + 1]) {
			parts.push("|");
			i += 1;
		} else {
			parts.push(text[i] ?? "");
		}
	}
	origPos.push(trimEnd);
	const unescaped = parts.join("");

	const cellLine: ScannedMarkdownLine = {
		...line,
		contentOffset: 0,
		lineEnd: unescaped.length,
		lineStart: 0,
		nextLineStart: unescaped.length,
		virtualSpaces: 0,
	};
	const cellLinks = scanPhpInlineBlockLinks(
		unescaped,
		[cellLine],
		0,
		0,
		(uFrom, uTo) =>
			isReferenceDefined(
				origPos[uFrom] ?? trimStart,
				origPos[uTo] ?? trimEnd,
			),
	);
	return cellLinks.map((link) => ({
		from: origPos[link.from] ?? trimStart,
		kind: link.kind,
		reference: link.reference,
		to: origPos[link.to] ?? trimEnd,
	}));
}

function firstCellIndexEndingAfter(
	cells: ReadonlyArray<TableRowCellRange>,
	offset: number,
): number {
	let low = 0;
	let high = cells.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if ((cells[middle]?.end ?? 0) <= offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

function collectNonDisplayMathSlices(
	brokenImageRanges: ReadonlyArray<SourceRange>,
	displayMathRanges: ReadonlyArray<SourceRange>,
): SourceRange[] {
	const sortedImages = [...brokenImageRanges].sort(
		(left, right) => left.from - right.from || left.to - right.to,
	);
	const slices: SourceRange[] = [];
	let mathIdx = 0;
	for (let i = 0; i < sortedImages.length; i += 1) {
		const image = sortedImages[i];
		if (!image || image.to <= image.from) continue;
		while (
			mathIdx < displayMathRanges.length &&
			(displayMathRanges[mathIdx]?.to ?? 0) <= image.from
		) {
			mathIdx += 1;
		}
		let cursor = image.from;
		let probe = mathIdx;
		while (probe < displayMathRanges.length) {
			const math = displayMathRanges[probe];
			if (!math || math.from >= image.to) break;
			if (math.from > cursor) slices.push({ from: cursor, to: math.from });
			cursor = Math.max(cursor, math.to);
			probe += 1;
		}
		if (cursor < image.to) slices.push({ from: cursor, to: image.to });
	}
	return slices;
}

function collectEscapedPipeTableCells(
	source: string,
	scan: ScannedMarkdownBlocks,
	scopes: PhpOwnedInlineScope[],
	seenCells: Set<string>,
): void {
	const text = scan.tableCellSource ?? source;
	let searchPos = text.indexOf("\\|", 0);
	while (searchPos >= 0) {
		const lineIdx = findLineIndexAtOffset(scan.lines, searchPos);
		if (lineIdx < 0) break;
		const line = scan.lines[lineIdx];
		if (!line) break;
		if (
			line.isTableRow &&
			line.inlineBlockId >= 0 &&
			searchPos >= line.contentOffset &&
			searchPos < line.lineEnd
		) {
			const cells = getCachedPhpTableRowCells(source, scan, line);
			const cell = findTableRowCellInCells(cells, searchPos);
			if (cell && cell.end > cell.start) {
				const cellKey = `${cell.start}:${cell.end}`;
				if (!seenCells.has(cellKey)) {
					seenCells.add(cellKey);
					scopes.push({
						from: cell.start,
						isTableCell: true,
						line,
						to: cell.end,
					});
				}
				searchPos = text.indexOf("\\|", cell.end);
				continue;
			}
		}
		searchPos = text.indexOf(
			"\\|",
			Math.max(searchPos + 2, line.nextLineStart),
		);
	}
}

/**
 * Takes sole link ownership for every PHP inline block and GFM table cell
 * touched by a display-math-broken Lezer image (both pre-math and post-math
 * fragments), and optionally for every GFM table cell containing an escaped
 * pipe `\|` outside math spans. Returns disjoint sorted original-source
 * `ownedRanges` and every exact PHP-rendered link inside them so callers can
 * exclude stale Lezer link nodes over those scopes and emit PHP's results
 * directly.
 */
export function collectPhpDisplayMathBrokenBlockLinks(
	source: string,
	scan: ScannedMarkdownBlocks,
	displayMathRanges: ReadonlyArray<SourceRange>,
	brokenImageRanges: ReadonlyArray<SourceRange>,
	isReferenceDefined: (from: number, to: number) => boolean,
	includeEscapedPipeTableCells = false,
): PhpOwnedBlockLinks {
	const slices = collectNonDisplayMathSlices(
		brokenImageRanges,
		displayMathRanges,
	);
	const scopes: PhpOwnedInlineScope[] = [];
	const seenBlockIds = new Set<number>();
	const seenCells = new Set<string>();

	for (let i = 0; i < slices.length; i += 1) {
		const slice = slices[i];
		if (!slice || slice.to <= slice.from) continue;
		const startLineIdx = findLineIndexAtOffset(scan.lines, slice.from);
		const endLineIdx = findLineIndexAtOffset(scan.lines, slice.to - 1);
		if (startLineIdx < 0 || endLineIdx < startLineIdx) continue;
		for (let lineIdx = startLineIdx; lineIdx <= endLineIdx; lineIdx += 1) {
			const line = scan.lines[lineIdx];
			if (!line || line.inlineBlockId < 0) continue;
			if (!line.isTableRow) {
				const bounds = getInlineBlockBounds(scan, lineIdx, line.inlineBlockId);
				lineIdx = bounds.groupEnd;
				if (seenBlockIds.has(line.inlineBlockId)) continue;
				seenBlockIds.add(line.inlineBlockId);
				const from = scan.lines[bounds.groupStart]?.contentOffset ?? 0;
				const to = scan.lines[bounds.groupEnd]?.lineEnd ?? source.length;
				if (to > from) {
					scopes.push({
						from,
						groupEnd: bounds.groupEnd,
						groupStart: bounds.groupStart,
						isTableCell: false,
						to,
					});
				}
				continue;
			}
			const segFrom = Math.max(slice.from, line.contentOffset);
			const segTo = Math.min(slice.to, line.lineEnd);
			if (segTo <= segFrom) continue;
			const cells = getCachedPhpTableRowCells(source, scan, line);
			if (0 === cells.length) continue;
			for (
				let cellIdx = firstCellIndexEndingAfter(cells, segFrom);
				cellIdx < cells.length;
				cellIdx += 1
			) {
				const cell = cells[cellIdx];
				if (!cell || cell.start >= segTo) break;
				const cellKey = `${cell.start}:${cell.end}`;
				if (seenCells.has(cellKey)) continue;
				seenCells.add(cellKey);
				if (cell.end > cell.start) {
					scopes.push({
						from: cell.start,
						isTableCell: true,
						line,
						to: cell.end,
					});
				}
			}
		}
	}

	if (includeEscapedPipeTableCells) {
		collectEscapedPipeTableCells(source, scan, scopes, seenCells);
	}

	scopes.sort((left, right) => left.from - right.from || left.to - right.to);
	const text = scan.tableCellSource ?? source;
	const ownedRanges: SourceRange[] = [];
	const links: ParserLinkNode[] = [];
	for (let i = 0; i < scopes.length; i += 1) {
		const scope = scopes[i];
		if (!scope) continue;
		ownedRanges.push({ from: scope.from, to: scope.to });
		const found = scope.isTableCell
			? scanPhpTableCellLinks(
					text,
					scope.line,
					scope.from,
					scope.to,
					isReferenceDefined,
				)
			: scanPhpInlineBlockLinks(
					text,
					scan.lines,
					scope.groupStart,
					scope.groupEnd,
					isReferenceDefined,
				);
		for (let j = 0; j < found.length; j += 1) {
			const link = found[j];
			if (link) links.push(link);
		}
	}
	return { links, ownedRanges };
}
