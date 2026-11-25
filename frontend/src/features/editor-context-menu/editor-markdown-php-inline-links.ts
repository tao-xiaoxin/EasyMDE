import type {
	EditorMarkdownImageRange,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";
import {
	createPhpInlineStream,
	isPhpTrimChar,
	parsePhpInlineLinkTail,
	parsePhpLinkLabel,
} from "../../shared/markdown/php-commonmark-block-helpers";
import {
	asciiLowerCase,
	collectBlockBacktickRuns,
	findLineIndexAtOffset,
	findNextBacktickRun,
	findTableRowCellInCells,
	getCachedPhpTableRowCells,
	getInlineBlockBounds,
	type ScannedMarkdownBlocks,
	type ScannedMarkdownLine,
	scanPhpCommonMarkBlocks,
	type TableRowCellRange,
} from "../../shared/markdown/php-commonmark-block-scan";
import {
	collectGfmAutolinkStops,
	createInlineHtmlScanGuard,
	type GfmAutolinkStops,
	gfmEmailAutolinkEnd,
	isGfmEmailDomainFirstChar,
	isGfmEmailLocalChar,
	isGfmUrlAutolinkAllowedAfter,
	matchBlockInlineHtmlOrAutolink,
	matchCommonMarkAutolinkOnLine,
	matchGfmUrlAutolinkDetail,
} from "../../shared/markdown/php-commonmark-inline-html";
import type {
	MarkdownSyntaxNode,
	ParserLinkNode,
} from "./editor-markdown-link-preparation";
import {
	mergeRanges,
	type NewlineProjection,
	originalRange,
	type SourceRange,
} from "./editor-markdown-source-projection";

const GFM_WWW_GLOBAL_RE = /www\./gi;

/** Whether original-source `[from, to)` overlaps a PHP-extracted math span. */
type MathCrossingQuery = (from: number, to: number) => boolean;

const NO_MATH_CROSSING: MathCrossingQuery = () => false;

function createMathCrossingQuery(
	mathRanges: ReadonlyArray<SourceRange>,
): MathCrossingQuery {
	if (0 === mathRanges.length) return NO_MATH_CROSSING;
	return (from, to) => {
		let low = 0;
		let high = mathRanges.length - 1;
		while (low <= high) {
			const middle = (low + high) >> 1;
			const range = mathRanges[middle];
			if (!range) return false;
			if (range.to <= from) low = middle + 1;
			else if (range.from >= to) high = middle - 1;
			else return true;
		}
		return false;
	};
}

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
	crossesMath: MathCrossingQuery = NO_MATH_CROSSING,
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
			// PHP matches against `EASYMDE_MATH_n_TOKEN`, not the same-length
			// mask, so a match touching math never renders this source link.
			if (!crossesMath(p, emailEnd ?? emailTo)) {
				emitted.push({ from: p, kind: "link", reference: false, to: emailTo });
			}
			p = emailTo;
			continue;
		}
		if (
			stops?.urls.has(p) &&
			isGfmUrlAutolinkAllowedAfter(
				p === seg.contentOffset ? null : (text[p - 1] ?? null),
			)
		) {
			const detail = matchGfmUrlAutolinkDetail(text, p);
			if (detail && detail.end > p) {
				// The raw (pre-trim) match decides: trimming the masked tail can
				// land before a math span PHP's tokenized URL still consumes.
				if (!crossesMath(p, detail.rawEnd)) {
					emitted.push({ from: p, kind: "link", reference: false, to: detail.end });
				}
				p = detail.end;
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
	crossesMath: MathCrossingQuery,
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
			(cFrom, cTo) => crossesMath(trimStart + cFrom, trimStart + cTo),
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
		(uFrom, uTo) =>
			crossesMath(origPos[uFrom] ?? trimStart, origPos[uTo] ?? trimEnd),
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

function pushTableCellScope(
	scopes: PhpOwnedInlineScope[],
	seenCells: Set<string>,
	line: ScannedMarkdownLine,
	cell: TableRowCellRange,
): void {
	if (cell.end <= cell.start) return;
	const cellKey = `${cell.start}:${cell.end}`;
	if (seenCells.has(cellKey)) return;
	seenCells.add(cellKey);
	scopes.push({ from: cell.start, isTableCell: true, line, to: cell.end });
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
				pushTableCellScope(scopes, seenCells, line, cell);
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

function collectReconciledTableCellScopes(
	source: string,
	scan: ScannedMarkdownBlocks,
	reconciledTableBlocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	scopes: PhpOwnedInlineScope[],
	seenCells: Set<string>,
): void {
	for (let i = 0; i < reconciledTableBlocks.length; i += 1) {
		const block = reconciledTableBlocks[i];
		if (!block || block.to <= block.from) continue;
		const startLineIdx = findLineIndexAtOffset(scan.lines, block.from);
		const endLineIdx = findLineIndexAtOffset(
			scan.lines,
			Math.max(block.from, block.to - 1),
		);
		if (startLineIdx < 0 || endLineIdx < startLineIdx) continue;
		for (let lineIdx = startLineIdx; lineIdx <= endLineIdx; lineIdx += 1) {
			const line = scan.lines[lineIdx];
			if (!line?.isTableRow || line.inlineBlockId < 0) continue;
			const cells = getCachedPhpTableRowCells(source, scan, line);
			for (let cellIdx = 0; cellIdx < cells.length; cellIdx += 1) {
				const cell = cells[cellIdx];
				if (cell) pushTableCellScope(scopes, seenCells, line, cell);
			}
		}
	}
}

function collectBareAutolinkScopesInScan(
	source: string,
	scan: ScannedMarkdownBlocks,
	bareAutolinkOffsets: ReadonlyArray<number>,
	scopes: PhpOwnedInlineScope[],
	seenBlockIds: Set<number>,
	seenCells: Set<string>,
): void {
	for (let i = 0; i < bareAutolinkOffsets.length; i += 1) {
		const offset = bareAutolinkOffsets[i];
		if (undefined === offset || offset < 0 || offset >= source.length) continue;
		const lineIdx = findLineIndexAtOffset(scan.lines, offset);
		if (lineIdx < 0) continue;
		const line = scan.lines[lineIdx];
		if (
			!line ||
			line.inlineBlockId < 0 ||
			offset < line.contentOffset ||
			offset >= line.lineEnd
		) {
			continue;
		}
		if (!line.isTableRow) {
			if (seenBlockIds.has(line.inlineBlockId)) continue;
			seenBlockIds.add(line.inlineBlockId);
			const bounds = getInlineBlockBounds(scan, lineIdx, line.inlineBlockId);
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
		const cells = getCachedPhpTableRowCells(source, scan, line);
		const cell = findTableRowCellInCells(cells, offset);
		if (cell) pushTableCellScope(scopes, seenCells, line, cell);
	}
}

/**
 * Takes sole link ownership for every PHP inline block and GFM table cell
 * touched by a display-math-broken Lezer image (both pre-math and post-math
 * fragments), optionally for every GFM table cell containing an escaped pipe
 * `\|` outside math spans, optionally for ordinary inline blocks and table
 * cells containing uncovered bare GFM autolink triggers, and optionally for
 * every cell of reconciled PHP tables. Returns disjoint sorted original-source
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
	bareAutolinkOffsets?: ReadonlyArray<number>,
	mathRanges: ReadonlyArray<SourceRange> = [],
	reconciledTableBlocks?: ReadonlyArray<EditorMarkdownSourceBlock>,
): PhpOwnedBlockLinks {
	const crossesMath = createMathCrossingQuery(mathRanges);
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
				pushTableCellScope(scopes, seenCells, line, cell);
			}
		}
	}

	if (includeEscapedPipeTableCells) {
		collectEscapedPipeTableCells(source, scan, scopes, seenCells);
	}

	if (reconciledTableBlocks && reconciledTableBlocks.length > 0) {
		collectReconciledTableCellScopes(
			source,
			scan,
			reconciledTableBlocks,
			scopes,
			seenCells,
		);
	}

	if (bareAutolinkOffsets && bareAutolinkOffsets.length > 0) {
		collectBareAutolinkScopesInScan(
			source,
			scan,
			bareAutolinkOffsets,
			scopes,
			seenBlockIds,
			seenCells,
		);
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
					crossesMath,
				)
			: scanPhpInlineBlockLinks(
					text,
					scan.lines,
					scope.groupStart,
					scope.groupEnd,
					isReferenceDefined,
					crossesMath,
				);
		for (let j = 0; j < found.length; j += 1) {
			const link = found[j];
			if (link) links.push(link);
		}
	}
	return { links, ownedRanges };
}

function isGfmUrlSchemeBefore(source: string, schemeEnd: number): boolean {
	const tail = asciiLowerCase(
		source.slice(Math.max(0, schemeEnd - 5), schemeEnd),
	);
	return (
		tail.endsWith("http") || tail.endsWith("https") || tail.endsWith("ftp")
	);
}

/**
 * Collects sorted original-source offsets of potential bare GFM autolinks
 * (`@`, `http(s)|ftp://`, `www.`, or bare Lezer `URL` nodes) that fall outside
 * already-owned non-bare constructs (`Link`, `Autolink`, valid `Image`, math,
 * non-editable blocks, non-table `InlineCode`, and `LinkReference`) in strictly
 * O(N) time so ordinary prose and dense inline-link documents do zero PHP
 * autolink work.
 */
export function collectUncoveredBareAutolinkOffsets(
	source: string,
	projection: NewlineProjection,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	rawLinkNodes: ReadonlyArray<ParserLinkNode>,
	syntaxNodes: ReadonlyArray<MarkdownSyntaxNode>,
	imageRanges: ReadonlyArray<EditorMarkdownImageRange>,
	mathRanges: ReadonlyArray<SourceRange>,
): number[] {
	const covered: SourceRange[] = [];
	for (let i = 0; i < blocks.length; i += 1) {
		const block = blocks[i];
		if (
			block &&
			("code" === block.kind ||
				"math" === block.kind ||
				"unavailable" === block.kind)
		) {
			covered.push({ from: block.from, to: block.to });
		}
	}
	for (let i = 0; i < mathRanges.length; i += 1) {
		const range = mathRanges[i];
		if (range) covered.push({ from: range.from, to: range.to });
	}
	for (let i = 0; i < imageRanges.length; i += 1) {
		const range = imageRanges[i];
		if (range) covered.push({ from: range.from, to: range.to });
	}
	const bareLezerOffsets: number[] = [];
	for (let i = 0; i < rawLinkNodes.length; i += 1) {
		const node = rawLinkNodes[i];
		if (!node) continue;
		const orig = originalRange(projection, node);
		if (
			"autolink" === node.kind ||
			node.reference ||
			"[" === projection.text[node.from]
		) {
			// PHP GFM tables split cells on `|` before inline parsing, so a
			// Lezer construct spanning a pipe may not exist in PHP's output.
			if (!projection.text.slice(node.from, node.to).includes("|")) {
				covered.push(orig);
			}
		} else {
			bareLezerOffsets.push(orig.from);
		}
	}
	for (let i = 0; i < syntaxNodes.length; i += 1) {
		const node = syntaxNodes[i];
		if (!node) continue;
		if ("InlineCode" === node.name) {
			if (!projection.text.slice(node.from, node.to).includes("|")) {
				covered.push(originalRange(projection, node));
			}
		} else if (
			"LinkReference" === node.name &&
			0 === mathRanges.length &&
			!projection.text.slice(node.from, node.to).includes("|")
		) {
			covered.push(originalRange(projection, node));
		}
	}
	const coveredRanges = mergeRanges(covered);
	const triggers: number[] = [];

	// Always include bare Lezer URL nodes outside covered ranges so false
	// positives (e.g. `<www.example.com>`) and wrong boundaries are reconciled.
	let covIdx = 0;
	for (let i = 0; i < bareLezerOffsets.length; i += 1) {
		const offset = bareLezerOffsets[i];
		if (undefined === offset) continue;
		while (
			covIdx < coveredRanges.length &&
			(coveredRanges[covIdx]?.to ?? 0) <= offset
		) {
			covIdx += 1;
		}
		const cov = coveredRanges[covIdx];
		if (!cov || offset < cov.from) triggers.push(offset);
	}

	covIdx = 0;
	let atPos = source.indexOf("@", 0);
	while (atPos >= 0) {
		while (
			covIdx < coveredRanges.length &&
			(coveredRanges[covIdx]?.to ?? 0) <= atPos
		) {
			covIdx += 1;
		}
		const cov = coveredRanges[covIdx];
		if (cov && cov.from <= atPos) {
			atPos = source.indexOf("@", cov.to);
			continue;
		}
		if (
			atPos > 0 &&
			atPos + 3 < source.length &&
			isGfmEmailLocalChar(source.charCodeAt(atPos - 1)) &&
			isGfmEmailDomainFirstChar(source.charCodeAt(atPos + 1))
		) {
			triggers.push(atPos);
		}
		atPos = source.indexOf("@", atPos + 1);
	}

	covIdx = 0;
	let schemePos = source.indexOf("://", 0);
	while (schemePos >= 0) {
		while (
			covIdx < coveredRanges.length &&
			(coveredRanges[covIdx]?.to ?? 0) <= schemePos
		) {
			covIdx += 1;
		}
		const cov = coveredRanges[covIdx];
		if (cov && cov.from <= schemePos) {
			schemePos = source.indexOf("://", cov.to);
			continue;
		}
		if (
			schemePos + 3 < source.length &&
			isGfmUrlSchemeBefore(source, schemePos)
		) {
			triggers.push(schemePos);
		}
		schemePos = source.indexOf("://", schemePos + 3);
	}

	if (source.includes(".")) {
		GFM_WWW_GLOBAL_RE.lastIndex = 0;
		covIdx = 0;
		let match = GFM_WWW_GLOBAL_RE.exec(source);
		while (null !== match) {
			const pos = match.index;
			while (
				covIdx < coveredRanges.length &&
				(coveredRanges[covIdx]?.to ?? 0) <= pos
			) {
				covIdx += 1;
			}
			const cov = coveredRanges[covIdx];
			if (cov && cov.from <= pos) {
				GFM_WWW_GLOBAL_RE.lastIndex = cov.to;
				match = GFM_WWW_GLOBAL_RE.exec(source);
				continue;
			}
			if (pos + 4 < source.length) triggers.push(pos);
			match = GFM_WWW_GLOBAL_RE.exec(source);
		}
	}

	if (triggers.length <= 1) return triggers;
	triggers.sort((left, right) => left - right);
	const deduped: number[] = [];
	for (let i = 0; i < triggers.length; i += 1) {
		const value = triggers[i];
		if (undefined !== value && value !== deduped[deduped.length - 1]) {
			deduped.push(value);
		}
	}
	return deduped;
}

/**
 * Reconciles bare GFM autolinks against PHP `AutolinkExtension` on pipe-free,
 * math-free documents by scanning ONLY the specific editable top-level blocks
 * touched by `bareAutolinkOffsets` instead of scanning the full document.
 */
export function collectLocalPhpBareAutolinkBlockLinks(
	source: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	bareAutolinkOffsets: ReadonlyArray<number>,
	isReferenceDefined: (from: number, to: number) => boolean,
): PhpOwnedBlockLinks {
	const ownedRanges: SourceRange[] = [];
	const links: ParserLinkNode[] = [];
	let blockIdx = 0;
	let offsetIdx = 0;

	while (offsetIdx < bareAutolinkOffsets.length) {
		const firstOffset = bareAutolinkOffsets[offsetIdx];
		if (undefined === firstOffset) break;
		while (
			blockIdx < blocks.length &&
			(blocks[blockIdx]?.to ?? 0) <= firstOffset
		) {
			blockIdx += 1;
		}
		const block = blocks[blockIdx];
		if (!block) break;
		if (firstOffset < block.from) {
			offsetIdx += 1;
			continue;
		}
		// Collect all trigger offsets belonging to this single top-level block.
		const blockStartOffsetIdx = offsetIdx;
		while (
			offsetIdx < bareAutolinkOffsets.length &&
			(bareAutolinkOffsets[offsetIdx] ?? source.length) < block.to
		) {
			offsetIdx += 1;
		}
		if (
			!block.editable ||
			"code" === block.kind ||
			"math" === block.kind ||
			"unavailable" === block.kind
		) {
			continue;
		}
		const blockSlice = source.slice(block.from, block.to);
		const blockScan = scanPhpCommonMarkBlocks(blockSlice);
		const seenBlockIds = new Set<number>();
		const seenExcludedLines = new Set<number>();
		const localScopes: Array<
			| Readonly<{
					from: number;
					groupEnd: number;
					groupStart: number;
					hasLinks: true;
					to: number;
			  }>
			| Readonly<{
					from: number;
					hasLinks: false;
					to: number;
			  }>
		> = [];
		for (let i = blockStartOffsetIdx; i < offsetIdx; i += 1) {
			const globalOffset = bareAutolinkOffsets[i];
			if (undefined === globalOffset) continue;
			const localOffset = globalOffset - block.from;
			const lineIdx = findLineIndexAtOffset(blockScan.lines, localOffset);
			if (lineIdx < 0) continue;
			const line = blockScan.lines[lineIdx];
			if (!line) continue;
			if (line.inlineBlockId < 0) {
				if (!seenExcludedLines.has(lineIdx) && line.lineEnd > line.lineStart) {
					seenExcludedLines.add(lineIdx);
					localScopes.push({
						from: line.lineStart,
						hasLinks: false,
						to: line.lineEnd,
					});
				}
				continue;
			}
			if (
				localOffset < line.contentOffset ||
				localOffset >= line.lineEnd ||
				seenBlockIds.has(line.inlineBlockId)
			) {
				continue;
			}
			seenBlockIds.add(line.inlineBlockId);
			const bounds = getInlineBlockBounds(
				blockScan,
				lineIdx,
				line.inlineBlockId,
			);
			const from = blockScan.lines[bounds.groupStart]?.contentOffset ?? 0;
			const to = blockScan.lines[bounds.groupEnd]?.lineEnd ?? blockSlice.length;
			if (to > from) {
				localScopes.push({
					from,
					groupEnd: bounds.groupEnd,
					groupStart: bounds.groupStart,
					hasLinks: true,
					to,
				});
			}
		}
		localScopes.sort(
			(left, right) => left.from - right.from || left.to - right.to,
		);
		for (let i = 0; i < localScopes.length; i += 1) {
			const scope = localScopes[i];
			if (!scope) continue;
			ownedRanges.push({
				from: block.from + scope.from,
				to: block.from + scope.to,
			});
			if (!scope.hasLinks) continue;
			const found = scanPhpInlineBlockLinks(
				blockSlice,
				blockScan.lines,
				scope.groupStart,
				scope.groupEnd,
				(cFrom, cTo) =>
					isReferenceDefined(block.from + cFrom, block.from + cTo),
			);
			for (let j = 0; j < found.length; j += 1) {
				const link = found[j];
				if (link) {
					links.push({
						from: block.from + link.from,
						kind: link.kind,
						reference: link.reference,
						to: block.from + link.to,
					});
				}
			}
		}
	}

	return { links, ownedRanges };
}
