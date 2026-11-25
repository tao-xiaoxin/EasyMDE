import {
	createPhpInlineStream,
	isPhpTrimChar,
	parsePhpInlineLinkTail,
	parsePhpLinkLabel,
} from "../../shared/markdown/php-commonmark-block-helpers";
import {
	collectBlockBacktickRuns,
	findNextBacktickRun,
	type ScannedMarkdownLine,
} from "../../shared/markdown/php-commonmark-block-scan";
import {
	collectGfmAutolinkStops,
	createInlineHtmlScanGuard,
	type GfmAutolinkStops,
	gfmEmailAutolinkEnd,
	hasPotentialGfmAutolinkTrigger,
	isGfmUrlAutolinkAllowedAfter,
	matchBlockInlineHtmlOrAutolink,
	matchCommonMarkAutolinkOnLine,
	matchGfmUrlAutolinkDetail,
} from "../../shared/markdown/php-commonmark-inline-html";
import type { ParserLinkNode } from "./editor-markdown-link-preparation";
import type { SourceRange } from "./editor-markdown-source-projection";

/** Whether original-source `[from, to)` overlaps a PHP-extracted math span. */
type MathCrossingQuery = (from: number, to: number) => boolean;

const NO_MATH_CROSSING: MathCrossingQuery = () => false;

export function createMathCrossingQuery(
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

export type PhpOwnedBlockLinks = Readonly<{
	links: ReadonlyArray<ParserLinkNode>;
	ownedRanges: ReadonlyArray<SourceRange>;
}>;

export type PhpReconciledBlockImage = Readonly<{
	available: boolean;
	from: number;
	to: number;
}>;

export type PhpReconciledBlocksContent = PhpOwnedBlockLinks &
	Readonly<{
		images: ReadonlyArray<PhpReconciledBlockImage>;
	}>;

/**
 * Replays PHP `League\CommonMark\Parser\InlineParserEngine` over one inline
 * block for the parsers that create or mask links: stop positions from
 * `matchParsers()`, code spans, escapes, §6.5 autolinks, inline HTML, GFM
 * URL/email autolinks, and bracket links/images (nested links restored to
 * text, earlier link openers deactivated). Returns each rendered link's exact
 * consumed source range and optionally collects rendered inline/reference
 * images into `imagesOut`.
 */
export function scanPhpInlineBlockLinks(
	text: string,
	lines: ReadonlyArray<ScannedMarkdownLine>,
	groupStart: number,
	groupEnd: number,
	isReferenceDefined: (from: number, to: number) => boolean,
	crossesMath: MathCrossingQuery = NO_MATH_CROSSING,
	imagesOut?: PhpReconciledBlockImage[],
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
			if (opener.image) {
				if (imagesOut) {
					while ((imagesOut[imagesOut.length - 1]?.from ?? -1) >= opener.pos) {
						imagesOut.pop();
					}
					imagesOut.push({
						available: !reference,
						from: opener.pos,
						to: end.p,
					});
				}
			} else {
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
					emitted.push({
						from: p,
						kind: "link",
						reference: false,
						to: detail.end,
					});
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
 * to the cell text and mapping emitted links and images back to exact original
 * offsets. Fast-paths to `[]` whenever the cell contains no link/image/autolink
 * syntax trigger.
 */
export function scanPhpTableCellLinks(
	text: string,
	line: ScannedMarkdownLine,
	cellFrom: number,
	cellTo: number,
	isReferenceDefined: (from: number, to: number) => boolean,
	crossesMath: MathCrossingQuery,
	imagesOut?: PhpReconciledBlockImage[],
): ParserLinkNode[] {
	let trimStart = cellFrom;
	let trimEnd = cellTo;
	while (trimStart < trimEnd && isPhpTrimChar(text[trimStart])) trimStart += 1;
	while (trimEnd > trimStart && isPhpTrimChar(text[trimEnd - 1])) trimEnd -= 1;
	if (trimStart >= trimEnd) return [];

	const rawSlice = text.slice(trimStart, trimEnd);
	if (
		!rawSlice.includes("[") &&
		!rawSlice.includes("<") &&
		!hasPotentialGfmAutolinkTrigger(rawSlice)
	) {
		return [];
	}
	let cellText = rawSlice;
	let origPos: number[] | null = null;
	if (rawSlice.includes("\\|")) {
		const parts: string[] = [];
		origPos = [];
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
		cellText = parts.join("");
	}

	const mapOffset = (offset: number, fallback: number): number =>
		origPos ? (origPos[offset] ?? fallback) : trimStart + offset;

	const cellImages: PhpReconciledBlockImage[] | undefined = imagesOut
		? []
		: undefined;
	const cellLine: ScannedMarkdownLine = {
		...line,
		contentOffset: 0,
		lineEnd: cellText.length,
		lineStart: 0,
		nextLineStart: cellText.length,
		virtualSpaces: 0,
	};
	const cellLinks = scanPhpInlineBlockLinks(
		cellText,
		[cellLine],
		0,
		0,
		(cFrom, cTo) =>
			isReferenceDefined(mapOffset(cFrom, trimStart), mapOffset(cTo, trimEnd)),
		(cFrom, cTo) =>
			crossesMath(mapOffset(cFrom, trimStart), mapOffset(cTo, trimEnd)),
		cellImages,
	);
	if (imagesOut && cellImages) {
		for (let i = 0; i < cellImages.length; i += 1) {
			const img = cellImages[i];
			if (img) {
				imagesOut.push({
					available: img.available,
					from: mapOffset(img.from, trimStart),
					to: mapOffset(img.to, trimEnd),
				});
			}
		}
	}
	return cellLinks.map((link) => ({
		from: mapOffset(link.from, trimStart),
		kind: link.kind,
		reference: link.reference,
		to: mapOffset(link.to, trimEnd),
	}));
}
