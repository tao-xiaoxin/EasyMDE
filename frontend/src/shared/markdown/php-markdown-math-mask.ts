import {
	type ScannedCodeRange,
	scanPhpCommonMarkBlockCodeRanges,
} from "./php-commonmark-block-engine";

/**
 * Canonical PHP `MarkdownRenderer::extract_math()` +
 * `MarkdownCodeRegionScanner` length-preserving masker for GFM table and block
 * scanning.
 *
 * PHP extracts both display math (`$$...$$`, `\[...\]`) and inline math
 * (`$...$`, `\(...\)`) outside CommonMark code regions BEFORE `League\CommonMark`
 * parses blocks and GFM tables:
 * - Display math becomes `"\n\n" . $token . "\n\n"`, isolating adjacent blocks
 *   and tables in O(1) lines (`"\n\n" + "M".repeat(len - 4) + "\n\n"`).
 * - Inline math becomes single-line `$token` with zero `|` or newline
 *   delimiters (`M${"_".repeat(len - 2)}M`, mirroring PHP
 *   `EASYMDE_MATH_0_TOKEN` whose `_` is illegal in CommonMark HTML tag names
 *   while legal in HTML attribute names and starting with an ASCII letter for
 *   Type 4 declarations), preserving exact UTF-16 offsets (including surrogate
 *   pairs) so pipes or line breaks inside `$a|b$` / `\(x\ny\)` never split
 *   table cells, close tables, or distort `headerColumnCount`.
 */

export type PhpMarkdownMathRange = Readonly<{
	block: boolean;
	from: number;
	to: number;
	tokenIndex?: number;
}>;

type BacktickRun = Readonly<{
	escaped: boolean;
	from: number;
	length: number;
	segment: number;
	to: number;
}>;

type DelimiterScanFlags = Readonly<{
	hasBracketPair: boolean;
	hasDollar: boolean;
	hasDollarPair: boolean;
	hasDoubleDollar: boolean;
	hasParenPair: boolean;
}>;

export function maskDisplayMathLength(length: number): string {
	return length >= 4
		? `\n\n${"M".repeat(length - 4)}\n\n`
		: "\n".repeat(length);
}

export function maskInlineMathLength(length: number): string {
	return length >= 3 ? `M${"_".repeat(length - 2)}M` : "M".repeat(length);
}

function collectBacktickRuns(
	source: string,
	protectedRanges: ReadonlyArray<ScannedCodeRange>,
): BacktickRun[] {
	const runs: BacktickRun[] = [];
	let index = 0;
	let protectedIndex = 0;
	let backslashRun = 0;
	let segment = 0;

	while (index < source.length) {
		while (
			protectedIndex < protectedRanges.length &&
			(protectedRanges[protectedIndex]?.end ?? 0) <= index
		) {
			protectedIndex += 1;
		}
		const protectedRange = protectedRanges[protectedIndex];
		if (protectedRange && index >= protectedRange.start) {
			index = protectedRange.end;
			protectedIndex += 1;
			backslashRun = 0;
			segment += 1;
			continue;
		}

		if ("`" !== source[index]) {
			backslashRun = "\\" === source[index] ? backslashRun + 1 : 0;
			index += 1;
			continue;
		}

		const from = index;
		const escaped = 1 === backslashRun % 2;
		const boundary = protectedRanges[protectedIndex]?.start ?? source.length;
		while (index < boundary && "`" === source[index]) index += 1;
		runs.push({
			escaped,
			from,
			length: index - from,
			segment,
			to: index,
		});
		backslashRun = 0;
	}

	return runs;
}

function scanInlineCodeRangesInternal(
	source: string,
	blockCodeRanges: ReadonlyArray<ScannedCodeRange>,
): Readonly<{
	hasTrailingUnmatchedBacktick: boolean;
	ranges: ScannedCodeRange[];
}> {
	if (!source.includes("`")) {
		return { hasTrailingUnmatchedBacktick: false, ranges: [] };
	}
	const runs = collectBacktickRuns(source, blockCodeRanges);
	if (0 === runs.length) {
		return { hasTrailingUnmatchedBacktick: false, ranges: [] };
	}
	const lastBlockEnd =
		blockCodeRanges.length > 0
			? (blockCodeRanges[blockCodeRanges.length - 1]?.end ?? 0)
			: 0;

	const nextMatch = new Int32Array(runs.length);
	const nextByLength = new Map<number, number>();
	let currentSegment = -1;
	for (let index = runs.length - 1; index >= 0; index -= 1) {
		const run = runs[index];
		if (!run) continue;
		if (run.segment !== currentSegment) {
			nextByLength.clear();
			currentSegment = run.segment;
		}
		const openLength = run.escaped ? run.length - 1 : run.length;
		nextMatch[index] =
			openLength > 0 ? (nextByLength.get(openLength) ?? -1) : -1;
		nextByLength.set(run.length, index);
	}

	const ranges: ScannedCodeRange[] = [];
	let hasTrailingUnmatchedBacktick = false;
	let runIndex = 0;
	while (runIndex < runs.length) {
		const run = runs[runIndex];
		if (!run) break;
		const closeIndex = nextMatch[runIndex] ?? -1;
		if (closeIndex < 0) {
			const openLength = run.escaped ? run.length - 1 : run.length;
			if (openLength > 0 && run.from >= lastBlockEnd) {
				hasTrailingUnmatchedBacktick = true;
			}
			runIndex += 1;
			continue;
		}
		const close = runs[closeIndex];
		if (!close) break;
		const firstLength = run.escaped ? run.length - 1 : run.length;
		const start = run.escaped ? run.to - firstLength : run.from;
		ranges.push({ end: close.to, start });
		runIndex = closeIndex + 1;
	}
	return { hasTrailingUnmatchedBacktick, ranges };
}

/**
 * Scans inline backtick code spans outside `blockCodeRanges` in strictly O(N)
 * time, mirroring PHP `MarkdownCodeRegionScanner::inline_code_ranges()`
 * (including escaped leading backticks and segment boundaries at block code).
 */
export function scanPhpInlineCodeRanges(
	source: string,
	blockCodeRanges?: ReadonlyArray<ScannedCodeRange>,
): ScannedCodeRange[] {
	if (!source.includes("`")) return [];
	const protectedRanges =
		blockCodeRanges ?? scanPhpCommonMarkBlockCodeRanges(source);
	return scanInlineCodeRangesInternal(source, protectedRanges).ranges;
}

function mergeCodeRanges(
	blockRanges: ReadonlyArray<ScannedCodeRange>,
	inlineRanges: ReadonlyArray<ScannedCodeRange>,
): ScannedCodeRange[] {
	if (0 === inlineRanges.length) return [...blockRanges];
	if (0 === blockRanges.length) return [...inlineRanges];
	const combined = [...blockRanges, ...inlineRanges].sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
	const merged: Array<{ end: number; start: number }> = [];
	for (const range of combined) {
		if (range.end <= range.start) continue;
		const previous = merged[merged.length - 1];
		if (previous && range.start <= previous.end) {
			if (range.end > previous.end) previous.end = range.end;
		} else {
			merged.push({ end: range.end, start: range.start });
		}
	}
	return merged;
}

type DelimitedMathPassResult = Readonly<{
	text: string;
	unclosedPos: number;
}>;

function scanDelimitedMathPass(
	text: string,
	segmentOffset: number,
	openDelim: string,
	closeDelim: string,
	isDisplay: boolean,
	ranges: PhpMarkdownMathRange[],
	buildMasked: boolean,
	tokenCounter: { value: number },
): DelimitedMathPassResult {
	let pos = text.indexOf(openDelim);
	if (pos < 0) return { text, unclosedPos: -1 };

	const openLen = openDelim.length;
	const closeLen = closeDelim.length;
	let cursor = 0;
	let parts: string[] | null = null;

	while (pos >= 0) {
		const close = text.indexOf(closeDelim, pos + openLen + 1);
		if (close < 0) break;
		const to = close + closeLen;
		const tokenIndex = tokenCounter.value;
		tokenCounter.value += 1;
		ranges.push({
			block: isDisplay,
			from: segmentOffset + pos,
			to: segmentOffset + to,
			tokenIndex,
		});
		if (buildMasked) {
			if (!parts) parts = [];
			if (pos > cursor) parts.push(text.slice(cursor, pos));
			parts.push(
				isDisplay
					? maskDisplayMathLength(to - pos)
					: maskInlineMathLength(to - pos),
			);
		}
		cursor = to;
		pos = text.indexOf(openDelim, cursor);
	}
	const resultText = parts
		? cursor < text.length
			? `${parts.join("")}${text.slice(cursor)}`
			: parts.join("")
		: text;
	return { text: resultText, unclosedPos: pos };
}

function scanInlineDollarMathPass(
	text: string,
	segmentOffset: number,
	ranges: PhpMarkdownMathRange[],
	tokenCounter: { value: number },
): void {
	let search = 0;
	let lineEnd = -1;

	while (search < text.length) {
		const open = text.indexOf("$", search);
		if (open < 0) break;
		if (open > 0 && "\\" === text[open - 1]) {
			search = open + 1;
			continue;
		}
		const nextDollar = text.indexOf("$", open + 1);
		if (nextDollar < 0) break;
		if (open >= lineEnd) {
			const nl = text.indexOf("\n", open + 1);
			lineEnd = nl < 0 ? text.length : nl;
		}
		if (nextDollar >= lineEnd) {
			search = nextDollar;
			continue;
		}
		if (nextDollar === open + 1) {
			search = nextDollar;
			continue;
		}
		if ("\\" === text[nextDollar - 1]) {
			search = nextDollar + 1;
			continue;
		}
		const to = nextDollar + 1;
		const tokenIndex = tokenCounter.value;
		tokenCounter.value += 1;
		ranges.push({
			block: false,
			from: segmentOffset + open,
			to: segmentOffset + to,
			tokenIndex,
		});
		search = to;
	}
}

function scanSegmentMathRanges(
	segment: string,
	segmentOffset: number,
	flags: DelimiterScanFlags,
	ranges: PhpMarkdownMathRange[],
	tokenCounter: { value: number },
): void {
	let current = segment;

	if (flags.hasDoubleDollar && current.includes("$$")) {
		current = scanDelimitedMathPass(
			current,
			segmentOffset,
			"$$",
			"$$",
			true,
			ranges,
			flags.hasBracketPair || flags.hasParenPair || flags.hasDollarPair,
			tokenCounter,
		).text;
	}
	if (flags.hasBracketPair && current.includes("\\[")) {
		current = scanDelimitedMathPass(
			current,
			segmentOffset,
			"\\[",
			"\\]",
			true,
			ranges,
			flags.hasParenPair || flags.hasDollarPair,
			tokenCounter,
		).text;
	}
	if (flags.hasParenPair && current.includes("\\(")) {
		current = scanDelimitedMathPass(
			current,
			segmentOffset,
			"\\(",
			"\\)",
			false,
			ranges,
			flags.hasDollarPair,
			tokenCounter,
		).text;
	}
	if (flags.hasDollarPair && current.includes("$")) {
		scanInlineDollarMathPass(current, segmentOffset, ranges, tokenCounter);
	}
}

function lineEndAtLf(source: string, offset: number): number {
	let pos = Math.max(0, Math.min(source.length, offset));
	while (pos < source.length && "\n" !== source[pos]) pos += 1;
	return pos;
}

function scanTrailingBoundedSegmentMathRanges(
	source: string,
	segment: string,
	segmentOffset: number,
	ranges: PhpMarkdownMathRange[],
	tokenCounter: { value: number },
): number {
	let current = segment;
	const hasDollar = current.includes("$");
	const hasBracket = current.includes("\\[");
	const hasParen = current.includes("\\(");
	if (!hasDollar && !hasBracket && !hasParen) return -1;

	const passes: ReadonlyArray<
		readonly [boolean, string, string, boolean, boolean]
	> = [
		[hasDollar && current.includes("$$"), "$$", "$$", true, true],
		[hasBracket, "\\[", "\\]", true, true],
		[hasParen, "\\(", "\\)", false, hasDollar],
	];
	const segmentEnd = segmentOffset + segment.length;
	for (let i = 0; i < passes.length; i += 1) {
		const entry = passes[i];
		if (!entry?.[0]) continue;
		const [, openDelim, closeDelim, isDisplay, buildMasked] = entry;
		const pass = scanDelimitedMathPass(
			current,
			segmentOffset,
			openDelim,
			closeDelim,
			isDisplay,
			ranges,
			buildMasked,
			tokenCounter,
		);
		if (pass.unclosedPos >= 0) {
			const searchFrom = Math.max(
				segmentOffset + pass.unclosedPos + openDelim.length + 1,
				segmentEnd,
			);
			const closeGlobal = source.indexOf(closeDelim, searchFrom);
			if (closeGlobal >= 0) return closeGlobal + closeDelim.length;
		}
		current = pass.text;
	}
	if (hasDollar) {
		const firstDollar = current.indexOf("$");
		if (firstDollar >= 0 && current.indexOf("$", firstDollar + 1) >= 0) {
			scanInlineDollarMathPass(current, segmentOffset, ranges, tokenCounter);
		}
	}
	return -1;
}

function collectBoundedExtraProtectedRanges(
	extraProtectedRanges: ReadonlyArray<ScannedCodeRange> | undefined,
	bound: number,
): ScannedCodeRange[] {
	if (!extraProtectedRanges || 0 === extraProtectedRanges.length) return [];
	const bounded: ScannedCodeRange[] = [];
	for (let i = 0; i < extraProtectedRanges.length; i += 1) {
		const range = extraProtectedRanges[i];
		if (!range || range.start >= bound) continue;
		const end = Math.min(bound, range.end);
		if (end > range.start) bounded.push({ end, start: range.start });
	}
	return bounded;
}

function scanBoundedPhpMarkdownMathRanges(
	source: string,
	extraProtectedRanges: ReadonlyArray<ScannedCodeRange> | undefined,
	stopAfterOffset: number,
): PhpMarkdownMathRange[] | null {
	const MAX_BOUNDED_EXPANSIONS = 4;
	let bound = lineEndAtLf(source, stopAfterOffset);

	for (let attempt = 0; attempt < MAX_BOUNDED_EXPANSIONS; attempt += 1) {
		if (bound >= source.length) return null;
		const prefix = source.slice(0, bound);
		if (
			!prefix.includes("$") &&
			!prefix.includes("\\[") &&
			!prefix.includes("\\(")
		) {
			return [];
		}

		const blockCodeRanges = scanPhpCommonMarkBlockCodeRanges(prefix);
		const inlineScan = scanInlineCodeRangesInternal(prefix, blockCodeRanges);
		if (
			inlineScan.hasTrailingUnmatchedBacktick &&
			source.indexOf("`", bound) >= 0
		) {
			return null;
		}
		const baseCodeRanges = mergeCodeRanges(blockCodeRanges, inlineScan.ranges);
		const boundedExtra = collectBoundedExtraProtectedRanges(
			extraProtectedRanges,
			bound,
		);
		const codeRanges =
			boundedExtra.length > 0
				? mergeCodeRanges(baseCodeRanges, boundedExtra)
				: baseCodeRanges;

		const ranges: PhpMarkdownMathRange[] = [];
		const tokenCounter = { value: 0 };
		const prefixFlags: DelimiterScanFlags = {
			hasBracketPair: prefix.includes("\\[") && prefix.includes("\\]"),
			hasDollar: prefix.includes("$"),
			hasDollarPair:
				prefix.includes("$") &&
				prefix.indexOf("$", prefix.indexOf("$") + 1) >= 0,
			hasDoubleDollar: prefix.includes("$$"),
			hasParenPair: prefix.includes("\\(") && prefix.includes("\\)"),
		};

		let cursor = 0;
		for (let i = 0; i < codeRanges.length; i += 1) {
			const codeRange = codeRanges[i];
			if (!codeRange) continue;
			if (codeRange.start > cursor) {
				scanSegmentMathRanges(
					prefix.slice(cursor, codeRange.start),
					cursor,
					prefixFlags,
					ranges,
					tokenCounter,
				);
			}
			if (codeRange.end > cursor) cursor = codeRange.end;
		}

		if (cursor < bound) {
			const neededEnd = scanTrailingBoundedSegmentMathRanges(
				source,
				prefix.slice(cursor),
				cursor,
				ranges,
				tokenCounter,
			);
			if (neededEnd >= 0) {
				const nextBound = lineEndAtLf(source, neededEnd);
				if (nextBound <= bound) return null;
				bound = nextBound;
				continue;
			}
		}

		const collapsed = collapseNestedMathRanges(ranges);
		return collapsed.map(({ block, from, to }) => ({ block, from, to }));
	}

	return null;
}

function collapseNestedMathRanges(
	ranges: PhpMarkdownMathRange[],
): PhpMarkdownMathRange[] {
	if (ranges.length <= 1) return ranges;
	ranges.sort((left, right) => left.from - right.from || right.to - left.to);
	const collapsed: PhpMarkdownMathRange[] = [];
	for (let i = 0; i < ranges.length; i += 1) {
		const range = ranges[i];
		if (!range) continue;
		const previous = collapsed[collapsed.length - 1];
		if (!previous || range.from >= previous.to) {
			collapsed.push(range);
		}
	}
	return collapsed;
}

/**
 * Scans `source` for all math ranges matching PHP
 * `EasyMDE\Content\MarkdownRenderer::extract_math()` 1:1 in strictly O(N) time
 * across all 4 sequential passes (`$$...$$`, `\[...\]`, `\(...\)`,
 * `(?<!\\)\$([^\n$]+?)(?<!\\)\$`) outside CommonMark block and inline code
 * regions. Returns sorted, non-overlapping UTF-16 ranges.
 *
 * When `stopAfterOffset` is provided, scanning stops once `stopAfterOffset` is
 * passed and every math or inline-code delimiter opened at `<= stopAfterOffset`
 * is closed (or proven unclosed), returning exact `{ block, from, to }` ranges
 * overlapping `[0, stopAfterOffset]` without scanning trailing document math.
 */
export function scanPhpMarkdownMathRanges(
	source: string,
	extraProtectedRanges?: ReadonlyArray<ScannedCodeRange>,
	stopAfterOffset?: number,
	precomputedBlockCodeRanges?: ReadonlyArray<ScannedCodeRange>,
): PhpMarkdownMathRange[] {
	if (
		undefined !== stopAfterOffset &&
		stopAfterOffset < source.length
	) {
		const bounded = scanBoundedPhpMarkdownMathRanges(
			source,
			extraProtectedRanges,
			stopAfterOffset,
		);
		if (null !== bounded) return bounded;
	}

	const hasDollar = source.includes("$");
	const hasBracket = source.includes("\\[");
	const hasParen = source.includes("\\(");
	if (!hasDollar && !hasBracket && !hasParen) return [];

	const hasDoubleDollar = hasDollar && source.includes("$$");
	const hasBracketPair = hasBracket && source.includes("\\]");
	const hasParenPair = hasParen && source.includes("\\)");
	const firstDollar = hasDollar ? source.indexOf("$") : -1;
	const hasDollarPair =
		firstDollar >= 0 && source.indexOf("$", firstDollar + 1) >= 0;
	if (
		!hasDoubleDollar &&
		!hasBracketPair &&
		!hasParenPair &&
		!hasDollarPair
	) {
		return [];
	}

	const flags: DelimiterScanFlags = {
		hasBracketPair,
		hasDollar,
		hasDollarPair,
		hasDoubleDollar,
		hasParenPair,
	};
	const blockCodeRanges =
		precomputedBlockCodeRanges ?? scanPhpCommonMarkBlockCodeRanges(source);
	const inlineCodeRanges = scanPhpInlineCodeRanges(source, blockCodeRanges);
	const baseCodeRanges = mergeCodeRanges(blockCodeRanges, inlineCodeRanges);
	const codeRanges =
		extraProtectedRanges && extraProtectedRanges.length > 0
			? mergeCodeRanges(baseCodeRanges, extraProtectedRanges)
			: baseCodeRanges;

	const ranges: PhpMarkdownMathRange[] = [];
	const tokenCounter = { value: 0 };
	if (0 === codeRanges.length) {
		scanSegmentMathRanges(source, 0, flags, ranges, tokenCounter);
		return collapseNestedMathRanges(ranges);
	}

	let cursor = 0;
	for (let i = 0; i < codeRanges.length; i += 1) {
		const codeRange = codeRanges[i];
		if (!codeRange) continue;
		if (codeRange.start > cursor) {
			scanSegmentMathRanges(
				source.slice(cursor, codeRange.start),
				cursor,
				flags,
				ranges,
				tokenCounter,
			);
		}
		if (codeRange.end > cursor) {
			cursor = codeRange.end;
		}
	}
	if (cursor < source.length) {
		scanSegmentMathRanges(
			source.slice(cursor),
			cursor,
			flags,
			ranges,
			tokenCounter,
		);
	}
	return collapseNestedMathRanges(ranges);
}

function maskKnownMathRanges(
	source: string,
	knownRanges: ReadonlyArray<PhpMarkdownMathRange>,
): string {
	if (0 === knownRanges.length) return source;
	let parts: string[] | null = null;
	let cursor = 0;
	for (let i = 0; i < knownRanges.length; i += 1) {
		const range = knownRanges[i];
		if (!range) continue;
		const from = Math.max(cursor, range.from);
		const to = Math.min(source.length, range.to);
		if (to <= from) continue;
		if (!parts) parts = [];
		if (from > cursor) parts.push(source.slice(cursor, from));
		parts.push(
			range.block
				? maskDisplayMathLength(to - from)
				: maskInlineMathLength(to - from),
		);
		cursor = to;
	}
	if (!parts) return source;
	if (cursor < source.length) parts.push(source.slice(cursor));
	return parts.join("");
}

/**
 * Returns a UTF-16-length-preserving copy of `source` with every PHP-extracted
 * display math and inline math range masked so CommonMark HTML blocks,
 * link reference definitions, and GFM table scanning match PHP
 * `MarkdownRenderer::extract_math()` + `League\CommonMark`.
 *
 * Fast-paths to return `source` untouched whenever no matched math delimiter
 * pair exists.
 */
export function maskPhpMarkdownMathForTableScan(
	source: string,
	knownRanges?: ReadonlyArray<PhpMarkdownMathRange>,
): string {
	if (undefined !== knownRanges) {
		return maskKnownMathRanges(source, knownRanges);
	}
	const ranges = scanPhpMarkdownMathRanges(source);
	return ranges.length > 0 ? maskKnownMathRanges(source, ranges) : source;
}
