import type { SourceRange } from "../../shared/markdown/markdown-source-projection";
import {
	createCommonMarkBracketResolver,
	stripQuoteMarksWithMap,
	type CommonMarkResolvedBinding,
} from "./editor-markdown-commonmark-links";
import {
	createDelimiterStack,
	type DelimiterNode,
	determineCanOpenOrClose,
	MAX_LEAGUE_DELIMITERS_PER_INLINE_BLOCK,
	nextCodePointChar,
	prevCodePointChar,
	processDelimiterListFrom,
	pushDelimiterRun,
	removeDelimitersAbove,
} from "./editor-markdown-delimiters";
import { createAngleScanCache } from "../../shared/markdown/markdown-html-scanners";
import { findNextBacktickCloser } from "../../shared/markdown/markdown-backtick-scanners";
import { parseBoldMarkdown } from "./editor-markdown-bold-parser";
import {
	hasMathBlockSkeletonMismatch,
	mapSegmentBindingToOriginal,
	mapTokenOffsetToClean,
	tokenizeMathSegments,
	type TokenizedLeagueSegment,
} from "./editor-markdown-league-math-tokens";
import {
	advanceRangeCursor,
	MAX_LEAGUE_BACKTICKS,
	preScanLeagueAngleAutolinks,
	preScanLeagueBackticks,
	preScanLeagueHtmlInline,
} from "./editor-markdown-league-prescans";
import { isAsciiPunctCode } from "../../shared/markdown/markdown-link-destination";
import { DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE } from "./editor-markdown-link-primitives";
import {
	createUrlAutolinkScanState,
	matchLeagueUrlAutolinkAt,
	preScanLeagueUrlAutolinkPrefixes,
	scanLeagueEmailAutolinkMatches,
} from "./editor-markdown-url-autolink";
import type {
	ReferenceLabelCaseFoldProfile,
	UnsupportedNonAsciiReferenceInfo,
} from "./reference-label-normalization";

const EMPTY_REFERENCE_LABELS: ReadonlySet<string> = new Set();

export type LeagueMathSpanSnapshot = Readonly<{
	block: boolean;
	raw: string;
}>;

const EMPTY_MATH_SPANS: ReadonlyArray<LeagueMathSpanSnapshot> = [];
const EMPTY_STRING_ARRAY: ReadonlyArray<string> = [];

export type LeagueCodeSpanRange = Readonly<{
	from: number;
	markLen: number;
	to: number;
}>;

export type LeagueGfmAutolinkMatch = Readonly<{
	from: number;
	kind: "email" | "url";
	to: number;
}>;

/** One resolved League delimiter pair whose four bounds all map to source offsets. */
export type LeagueDelimitedSpan = Readonly<{
	from: number;
	innerFrom: number;
	innerTo: number;
	to: number;
}>;

export type LeagueStrongSpan = LeagueDelimitedSpan &
	Readonly<{
		closeMark: string;
		openMark: string;
	}>;

export type LeagueInlineAnalysisOptions = Readonly<{
	definedReferenceLabels?: ReadonlySet<string>;
	isNonParagraphHost?: boolean;
	limit?: number;
	quoteMarks?: ReadonlyArray<SourceRange>;
	rangeFrom?: number;
	rangeTo?: number;
	referenceLabelCaseFoldProfile?: ReferenceLabelCaseFoldProfile;
	/** Caller already verified block-skeleton math parity on the intact tree. */
	skipBlockMathReclassificationCheck?: boolean;
	taskMarkerLength?: number;
	unsupportedNonAscii?: UnsupportedNonAsciiReferenceInfo;
}>;

export type LeagueInlineBlockAnalysis = Readonly<{
	angleAutolinks: ReadonlyArray<SourceRange>;
	bindings: ReadonlyArray<CommonMarkResolvedBinding>;
	codeSpans: ReadonlyArray<LeagueCodeSpanRange>;
	consumedDelimiterRanges: ReadonlyArray<SourceRange>;
	delimiterCount: number;
	emphRanges: ReadonlyArray<SourceRange>;
	emphSpans: ReadonlyArray<LeagueDelimitedSpan>;
	gfmAutolinks: ReadonlyArray<LeagueGfmAutolinkMatch>;
	hasMathTokens: boolean;
	hasUnverifiableReferences: boolean;
	/** League `HtmlInline` ranges, stripped by PHP `html_input => 'strip'`. */
	htmlInlineRanges: ReadonlyArray<SourceRange>;
	htmlTags: ReadonlyArray<string>;
	mathSpans: ReadonlyArray<LeagueMathSpanSnapshot>;
	strikeRanges: ReadonlyArray<SourceRange>;
	strikeSpans: ReadonlyArray<LeagueDelimitedSpan>;
	strongRanges: ReadonlyArray<SourceRange>;
	strongSpans: ReadonlyArray<LeagueStrongSpan>;
}>;

type SegmentAccumulators = {
	angleAutolinks: SourceRange[];
	bindings: CommonMarkResolvedBinding[];
	codeSpans: LeagueCodeSpanRange[];
	consumedDelimiterRanges: SourceRange[];
	emphRanges: SourceRange[];
	emphSpans: LeagueDelimitedSpan[];
	gfmAutolinks: LeagueGfmAutolinkMatch[];
	hasUnverifiableReferences: boolean;
	htmlInlineRanges: SourceRange[];
	htmlTags: string[];
	maxDelimiterCount: number;
	strikeRanges: SourceRange[];
	strikeSpans: LeagueDelimitedSpan[];
	strongRanges: SourceRange[];
	strongSpans: LeagueStrongSpan[];
};

/**
 * Stages 2 & 3 for one paragraph segment: non-overlapping per-parser O(N)
 * pre-scans followed by one monotonic left-to-right cursor walk in exact League
 * priority order with integrated token-space delimiter stack resolution.
 */
function analyzeLeagueParagraphSegment(
	seg: TokenizedLeagueSegment,
	cleanText: string,
	initialCursorOffset: number,
	definedReferenceLabels: ReadonlySet<string>,
	profile: ReferenceLabelCaseFoldProfile,
	unsupportedNonAscii: UnsupportedNonAsciiReferenceInfo | undefined,
	limit: number,
	mapCleanInclusive: (pos: number) => number,
	mapCleanExclusive: (end: number) => number,
	acc: SegmentAccumulators,
): void {
	const segText = seg.text;
	const segLen = segText.length;
	const subs = seg.substitutions;
	const origBase = seg.origFrom;

	const mapTokRange = (tokFrom: number, tokTo: number): SourceRange | null => {
		const cleanFrom = mapTokenOffsetToClean(tokFrom, origBase, subs);
		const cleanTo = mapTokenOffsetToClean(tokTo, origBase, subs);
		if (cleanFrom < 0 || cleanTo < 0) {
			acc.hasUnverifiableReferences = true;
			return null;
		}
		return { from: mapCleanInclusive(cleanFrom), to: mapCleanExclusive(cleanTo) };
	};

	// Stage 2: Non-overlapping per-parser O(N) pre-scans on `segText`.
	const angleCache = createAngleScanCache();
	const { closerBucketsBySize, openers: backtickOpeners } = preScanLeagueBackticks(segText);
	const autolinkMatches = preScanLeagueAngleAutolinks(segText, angleCache);
	const htmlInlineMatches = preScanLeagueHtmlInline(segText, angleCache);
	const emailMatches = scanLeagueEmailAutolinkMatches(segText, 0, segLen);
	const urlPrefixes = preScanLeagueUrlAutolinkPrefixes(segText, 0, segLen);
	const urlScanState = createUrlAutolinkScanState();
	const delimiterStack = createDelimiterStack();
	const bracketResolver = createCommonMarkBracketResolver<DelimiterNode | null>(
		segText,
		0,
		segLen,
		definedReferenceLabels,
		profile,
		{
			onUnverifiableReference: () => {
				acc.hasUnverifiableReferences = true;
			},
			...(unsupportedNonAscii ? { unsupportedNonAscii } : {}),
		},
	);

	const resolveDelimitersFrom = (stackBottom: DelimiterNode | null): void => {
		processDelimiterListFrom(
			delimiterStack,
			stackBottom,
			(kind, openDelimFrom, openDelimTo, spanFrom, spanTo, closeDelimFrom, closeDelimTo) => {
				const openRange = mapTokRange(openDelimFrom, openDelimTo);
				const closeRange = mapTokRange(closeDelimFrom, closeDelimTo);
				const spanRange = mapTokRange(spanFrom, spanTo);
				if (openRange) acc.consumedDelimiterRanges.push(openRange);
				if (closeRange) acc.consumedDelimiterRanges.push(closeRange);
				if (spanRange && spanRange.from < spanRange.to) {
					if ("strong" === kind) acc.strongRanges.push(spanRange);
					else if ("emph" === kind) acc.emphRanges.push(spanRange);
					else acc.strikeRanges.push(spanRange);
				}
				if (!openRange || !closeRange || !spanRange) return;
				const span: LeagueDelimitedSpan = {
					from: openRange.from,
					innerFrom: openRange.to,
					innerTo: closeRange.from,
					to: closeRange.to,
				};
				if ("emph" === kind) acc.emphSpans.push(span);
				else if ("strike" === kind) acc.strikeSpans.push(span);
				else {
					acc.strongSpans.push({
						...span,
						closeMark: segText.slice(closeDelimFrom, closeDelimTo),
						openMark: segText.slice(openDelimFrom, openDelimTo),
					});
				}
			},
		);
	};

	// Stage 3: Single-pass O(N) left-to-right cursor walk in exact League priority order.
	let btIdx = 0;
	let autoIdx = 0;
	let htmlIdx = 0;
	let emailIdx = 0;
	let urlIdx = 0;
	let nextEmailFrom = emailMatches[0]?.from ?? segLen;
	let nextUrlFrom = urlPrefixes[0]?.from ?? segLen;
	let segDelimiterCount = 0;
	let pos = Math.min(segLen, initialCursorOffset);

	while (pos < segLen) {
		while (nextEmailFrom < pos) {
			emailIdx += 1;
			nextEmailFrom = emailMatches[emailIdx]?.from ?? segLen;
		}
		while (nextUrlFrom < pos) {
			urlIdx += 1;
			nextUrlFrom = urlPrefixes[urlIdx]?.from ?? segLen;
		}

		const code = segText.charCodeAt(pos);

		// Priority 150: BacktickParser
		if (96 /* ` */ === code) {
			btIdx = advanceRangeCursor(backtickOpeners, btIdx, pos);
			const opener = backtickOpeners[btIdx];
			if (opener && opener.from === pos) {
				btIdx += 1;
				const openLen = opener.to - opener.from;
				if (openLen <= MAX_LEAGUE_BACKTICKS) {
					const closeStart = findNextBacktickCloser(closerBucketsBySize, openLen, opener.to);
					if (closeStart >= 0) {
						const closeEnd = closeStart + openLen;
						const mapped = mapTokRange(pos, closeEnd);
						if (mapped) {
							acc.codeSpans.push({ from: mapped.from, markLen: openLen, to: mapped.to });
						}
						pos = closeEnd;
						continue;
					}
				}
				pos = opener.to;
				continue;
			}
		}

		// Priority 80: EscapableParser
		if (92 /* \ */ === code) {
			pos += pos + 1 < segLen && isAsciiPunctCode(segText.charCodeAt(pos + 1)) ? 2 : 1;
			continue;
		}

		// Priority 50 (AutolinkParser) & Priority 40 (HtmlInlineParser)
		if (60 /* < */ === code) {
			autoIdx = advanceRangeCursor(autolinkMatches, autoIdx, pos);
			const autoMatch = autolinkMatches[autoIdx];
			if (autoMatch && autoMatch.from === pos) {
				autoIdx += 1;
				const mapped = mapTokRange(pos, autoMatch.to);
				if (mapped) acc.angleAutolinks.push(mapped);
				pos = autoMatch.to;
				continue;
			}
			htmlIdx = advanceRangeCursor(htmlInlineMatches, htmlIdx, pos);
			const htmlMatch = htmlInlineMatches[htmlIdx];
			if (htmlMatch && htmlMatch.from === pos) {
				htmlIdx += 1;
				acc.htmlTags.push(segText.slice(pos, htmlMatch.to));
				const mappedHtml = mapTokRange(pos, htmlMatch.to);
				if (mappedHtml) acc.htmlInlineRanges.push(mappedHtml);
				pos = htmlMatch.to;
				continue;
			}
			pos += 1;
			continue;
		}

		// Priority 30: CloseBracketParser
		if (93 /* ] */ === code) {
			const outcome = bracketResolver.resolveCloseBracket(pos);
			if ("matched" === outcome.kind) {
				const b = outcome.binding;
				if ("image" === b.kind) {
					removeDelimitersAbove(delimiterStack, outcome.openerDelimiter);
				} else {
					resolveDelimitersFrom(outcome.openerDelimiter);
				}
				pos = outcome.nextPos;
				continue;
			}
			pos += 1;
			continue;
		}

		// Priority 20: OpenBracketParser
		if (91 /* [ */ === code) {
			bracketResolver.pushLinkOpener(pos, delimiterStack.tail);
			pos += 1;
			continue;
		}

		// Priority 10: BangParser (`![`)
		if (33 /* ! */ === code && pos + 1 < segLen && 91 /* [ */ === segText.charCodeAt(pos + 1)) {
			bracketResolver.pushImageOpener(pos, delimiterStack.tail);
			pos += 2;
			continue;
		}

		// Priority 0a: EmailAutolinkParser
		if (pos === nextEmailFrom) {
			const emailMatch = emailMatches[emailIdx];
			emailIdx += 1;
			nextEmailFrom = emailMatches[emailIdx]?.from ?? segLen;
			if (emailMatch) {
				const mapped = mapTokRange(pos, emailMatch.to);
				if (mapped) acc.gfmAutolinks.push({ from: mapped.from, kind: "email", to: mapped.to });
				pos = emailMatch.to;
				continue;
			}
		}

		// Priority 0b: UrlAutolinkParser (on-demand match at pre-scanned prefix)
		if (pos === nextUrlFrom) {
			const urlPrefix = urlPrefixes[urlIdx];
			urlIdx += 1;
			nextUrlFrom = urlPrefixes[urlIdx]?.from ?? segLen;
			const urlEnd = urlPrefix
				? matchLeagueUrlAutolinkAt(segText, urlPrefix, segLen, 0, urlScanState)
				: -1;
			if (urlEnd > pos) {
				const mapped = mapTokRange(pos, urlEnd);
				if (mapped) acc.gfmAutolinks.push({ from: mapped.from, kind: "url", to: mapped.to });
				pos = urlEnd;
				continue;
			}
		}

		// Priority -1000: DelimiterParser (`*`, `_`, `~`)
		if (42 /* * */ === code || 95 /* _ */ === code || 126 /* ~ */ === code) {
			const runStart = pos;
			pos += 1;
			while (pos < segLen && segText.charCodeAt(pos) === code) pos += 1;
			if (segDelimiterCount <= limit) {
				const ch = 42 === code ? "*" : 95 === code ? "_" : "~";
				const { canClose, canOpen } = determineCanOpenOrClose(
					prevCodePointChar(segText, runStart),
					nextCodePointChar(segText, pos),
					ch,
				);
				if (canOpen || canClose) {
					segDelimiterCount += 1;
					if (segDelimiterCount <= limit) {
						pushDelimiterRun(
							delimiterStack,
							ch,
							runStart,
							pos - runStart,
							canOpen,
							canClose,
						);
					}
				}
			}
			continue;
		}

		pos += 1;
	}

	resolveDelimitersFrom(null);
	if (segDelimiterCount > acc.maxDelimiterCount) {
		acc.maxDelimiterCount = segDelimiterCount;
	}

	for (const b of bracketResolver.getBindings()) {
		const mapped = mapSegmentBindingToOriginal(
			b,
			cleanText,
			origBase,
			subs,
			mapCleanInclusive,
			mapCleanExclusive,
		);
		if (!mapped) acc.hasUnverifiableReferences = true;
		else acc.bindings.push(mapped);
	}
}

/**
 * Unified single-pass O(N) model of PHP `MarkdownRenderer::render()` + League
 * CommonMark 2.8.2 `InlineParserEngine::matchParsers()` + `parse()`:
 *
 * 1. Raw lexical backticks + PHP `extract_math()` real token substitution
 *    (`EASYMDE_MATH_n_TOKEN`, splitting paragraphs at block-math `\n\n` and
 *    verifying block-boundary reclassification).
 * 2. Non-overlapping per-parser O(N) pre-scans per paragraph segment
 *    (`Backtick`, `Autolink`, `HtmlInline`, `EmailAutolink`, prefix-only `UrlAutolink`).
 * 3. One monotonic left-to-right cursor walk in exact League priority order:
 *    `Backtick` (150) -> `Escapable` (80) -> `Autolink` (50) ->
 *    `HtmlInline` (40) -> `CloseBracket` (30) -> `OpenBracket` (20) ->
 *    `Bang` (10) -> `EmailAutolink` (0) -> `UrlAutolink` (0, on-demand) ->
 *    `Delimiter` (-1000) with integrated token-space delimiter stack resolution.
 */
export function analyzeLeagueInlineBlock(
	inlineText: string,
	options: LeagueInlineAnalysisOptions = {},
): LeagueInlineBlockAnalysis {
	const rangeFrom = Math.max(0, options.rangeFrom ?? 0);
	const rangeTo = Math.min(inlineText.length, options.rangeTo ?? inlineText.length);
	if (rangeFrom >= rangeTo) {
		return {
			angleAutolinks: [],
			bindings: [],
			codeSpans: [],
			consumedDelimiterRanges: [],
			delimiterCount: 0,
			emphRanges: [],
			emphSpans: [],
			gfmAutolinks: [],
			hasMathTokens: false,
			hasUnverifiableReferences: false,
			htmlInlineRanges: [],
			htmlTags: EMPTY_STRING_ARRAY,
			mathSpans: EMPTY_MATH_SPANS,
			strikeRanges: [],
			strikeSpans: [],
			strongRanges: [],
			strongSpans: [],
		};
	}

	const stripped = stripQuoteMarksWithMap(inlineText, rangeFrom, rangeTo, options.quoteMarks);
	const cleanToOrig = stripped.cleanToOrig;
	const cleanText = cleanToOrig
		? stripped.cleanText
		: 0 === rangeFrom && rangeTo === inlineText.length
			? inlineText
			: inlineText.slice(rangeFrom, rangeTo);
	const cleanBaseOffset = cleanToOrig ? 0 : rangeFrom;

	const mapCleanInclusive = (pos: number): number =>
		cleanToOrig ? (cleanToOrig[pos] ?? rangeTo) : cleanBaseOffset + pos;
	const mapCleanExclusive = (end: number): number => {
		if (!cleanToOrig) return cleanBaseOffset + end;
		return end <= 0 ? rangeFrom : (cleanToOrig[end - 1] ?? rangeTo - 1) + 1;
	};

	const definedReferenceLabels = options.definedReferenceLabels ?? EMPTY_REFERENCE_LABELS;
	const profile =
		options.referenceLabelCaseFoldProfile ?? DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE;
	const limit = options.limit ?? MAX_LEAGUE_DELIMITERS_PER_INLINE_BLOCK;
	const taskMarkerLength = Math.max(0, options.taskMarkerLength ?? 0);

	// Stage 1: Real PHP math token substitution + block-math reclassification check.
	const tokenized = tokenizeMathSegments(cleanText);
	const hasNonMathProse =
		tokenized.hasBlockMath &&
		tokenized.segments.some((seg) => /\S/u.test(seg.text));
	const blockMathReclassified =
		hasNonMathProse &&
		(Boolean(options.isNonParagraphHost) ||
			taskMarkerLength > 0 ||
			(!options.skipBlockMathReclassificationCheck &&
				hasMathBlockSkeletonMismatch(
					cleanText,
					parseBoldMarkdown(cleanText),
					tokenized.extractedRanges,
					true,
				)));

	const acc: SegmentAccumulators = {
		angleAutolinks: [],
		bindings: [],
		codeSpans: [],
		consumedDelimiterRanges: [],
		emphRanges: [],
		emphSpans: [],
		gfmAutolinks: [],
		hasUnverifiableReferences: blockMathReclassified,
		htmlInlineRanges: [],
		htmlTags: [],
		maxDelimiterCount: 0,
		strikeRanges: [],
		strikeSpans: [],
		strongRanges: [],
		strongSpans: [],
	};

	for (let segIdx = 0; segIdx < tokenized.segments.length; segIdx += 1) {
		const seg = tokenized.segments[segIdx];
		if (!seg) continue;
		analyzeLeagueParagraphSegment(
			seg,
			cleanText,
			0 === segIdx ? taskMarkerLength : 0,
			definedReferenceLabels,
			profile,
			options.unsupportedNonAscii,
			limit,
			mapCleanInclusive,
			mapCleanExclusive,
			acc,
		);
	}

	if (acc.bindings.length > 1) {
		acc.bindings.sort((left, right) => left.from - right.from || right.to - left.to);
	}

	const mathSpans: ReadonlyArray<LeagueMathSpanSnapshot> = tokenized.hasMathTokens
		? tokenized.extractedRanges.map((range) => ({
				block: range.block,
				raw: cleanText.slice(range.from, range.to),
			}))
		: EMPTY_MATH_SPANS;

	return {
		angleAutolinks: acc.angleAutolinks,
		bindings: acc.bindings,
		codeSpans: acc.codeSpans,
		consumedDelimiterRanges: acc.consumedDelimiterRanges,
		delimiterCount: acc.maxDelimiterCount,
		emphRanges: acc.emphRanges,
		emphSpans: acc.emphSpans,
		gfmAutolinks: acc.gfmAutolinks,
		hasMathTokens: tokenized.hasMathTokens,
		hasUnverifiableReferences: acc.hasUnverifiableReferences,
		htmlInlineRanges: acc.htmlInlineRanges,
		htmlTags: acc.htmlTags.length > 0 ? acc.htmlTags : EMPTY_STRING_ARRAY,
		mathSpans,
		strikeRanges: acc.strikeRanges,
		strikeSpans: acc.strikeSpans,
		strongRanges: acc.strongRanges,
		strongSpans: acc.strongSpans,
	};
}
