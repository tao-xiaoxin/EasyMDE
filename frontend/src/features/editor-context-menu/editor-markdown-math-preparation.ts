import type { EditorMarkdownMathSpan } from "../../contracts/ports/editor-block-index-port";
import {
	findNextBacktickCloser,
	indexBacktickRunsByLength,
} from "../../shared/markdown/markdown-backtick-scanners";
import {
	hasOddPrecedingBackslashes,
	mergeRanges,
	type SourceRange,
} from "../../shared/markdown/markdown-source-projection";

export type MathRange = SourceRange &
	Readonly<{
		block: boolean;
	}>;

type MathScanResult = Readonly<{
	conflicts: ReadonlyArray<SourceRange>;
	ranges: ReadonlyArray<MathRange>;
}>;

type ActiveMathRange = SourceRange &
	Readonly<{
		accepted: MathRange | null;
	}>;

const EMPTY_RANGES: ReadonlyArray<SourceRange> = [];
const PHP_INDENTED_CODE_LINE_RE = /(?:^|\r\n|\n|\r)(?: {4}|\t)/;

/**
 * Mirrors PHP `MarkdownCodeRegionScanner::block_ranges()` early-return
 * precondition: PHP skips CommonMark code-block scanning altogether when the
 * document contains no backtick, no tilde, and no top-level 4-space/tab line.
 */
export function phpScansCodeBlocks(text: string): boolean {
	return (
		text.includes("`") ||
		text.includes("~") ||
		PHP_INDENTED_CODE_LINE_RE.test(text)
	);
}

/**
 * Canonical, parser-free (worker-safe) owner of PHP raw-backtick inline-code
 * scanning, mirroring `src/Content/MarkdownCodeRegionScanner.php`
 * (`inline_code_ranges()`): strictly O(N), HTML-blind, unescaped-opener
 * backtick runs paired with the next equal-length run anywhere in the
 * document (across blank lines). Indices inside sorted `excludedBlockRanges`
 * (fenced and indented code blocks) are skipped, and a closer never crosses
 * one, so math extraction matches PHP `MarkdownRenderer::extract_math()`.
 */
export function scanRawMarkdownInlineCodeRanges(
	text: string,
	excludedBlockRanges: ReadonlyArray<SourceRange> = EMPTY_RANGES,
): SourceRange[] {
	if (!text.includes("`")) return [];
	const len = text.length;
	const closerBuckets = indexBacktickRunsByLength(text);
	const ranges: SourceRange[] = [];
	let blockIdx = 0;
	let i = 0;
	while (i < len) {
		while (blockIdx < excludedBlockRanges.length && (excludedBlockRanges[blockIdx]?.to ?? 0) <= i) {
			blockIdx += 1;
		}
		const block = excludedBlockRanges[blockIdx];
		if (block && block.from <= i) {
			i = block.to;
			continue;
		}
		if (96 /* ` */ !== text.charCodeAt(i) || hasOddPrecedingBackslashes(text, i)) {
			i += 1;
			continue;
		}
		let runEnd = i + 1;
		while (runEnd < len && 96 === text.charCodeAt(runEnd)) runEnd += 1;
		const runLen = runEnd - i;
		const closeStart = findNextBacktickCloser(closerBuckets, runLen, runEnd);
		if (closeStart < 0 || (block !== undefined && block.from <= closeStart)) {
			i = runEnd;
			continue;
		}
		const closeEnd = closeStart + runLen;
		ranges.push({ from: i, to: closeEnd });
		i = closeEnd;
	}
	return ranges;
}

export function mathSpanFromRange(
	source: string,
	range: MathRange,
): EditorMarkdownMathSpan {
	const startsWith = source.slice(range.from, range.from + 2);
	const endsWith = source.slice(Math.max(range.from, range.to - 2), range.to);
	if (
		("$$" === startsWith && "$$" === endsWith) ||
		("\\[" === startsWith && "\\]" === endsWith)
	) {
		return {
			bodyFrom: range.from + 2,
			bodyTo: range.to - 2,
			displayMode: true,
			from: range.from,
			to: range.to,
		};
	}
	if ("\\(" === startsWith && "\\)" === endsWith) {
		return {
			bodyFrom: range.from + 2,
			bodyTo: range.to - 2,
			displayMode: false,
			from: range.from,
			to: range.to,
		};
	}
	if ("$" === source[range.from] && "$" === source[range.to - 1]) {
		return {
			bodyFrom: range.from + 1,
			bodyTo: range.to - 1,
			displayMode: false,
			from: range.from,
			to: range.to,
		};
	}
	throw new Error("editor-context-menu-math-range-invalid");
}

export function normalizeMathRanges(
	ranges: ReadonlyArray<MathRange>,
): MathScanResult {
	const sorted = ranges
		.filter((range) => range.to > range.from)
		.sort((left, right) => left.from - right.from || right.to - left.to);
	const accepted: MathRange[] = [];
	const conflicts: SourceRange[] = [];
	const active: ActiveMathRange[] = [];

	for (const range of sorted) {
		while (
			active.length &&
			range.from >= (active[active.length - 1]?.to ?? 0)
		) {
			active.pop();
		}
		const owner = active[active.length - 1];
		if (!owner) {
			accepted.push(range);
			active.push({ ...range, accepted: range });
			continue;
		}
		if (range.to <= owner.to) continue;

		const conflict = { from: owner.from, to: range.to };
		conflicts.push(conflict);
		if (owner.accepted) {
			const ownerIndex = accepted.lastIndexOf(owner.accepted);
			if (ownerIndex >= 0) accepted.splice(ownerIndex, 1);
		}
		active.pop();
		active.push({ ...conflict, accepted: null });
	}

	return {
		conflicts: mergeRanges(conflicts),
		ranges: accepted.sort(
			(left, right) => left.from - right.from || left.to - right.to,
		),
	};
}

function outsideSegments(
	length: number,
	protectedRanges: ReadonlyArray<SourceRange>,
): SourceRange[] {
	const segments: SourceRange[] = [];
	let cursor = 0;
	for (const range of protectedRanges) {
		if (cursor < range.from) segments.push({ from: cursor, to: range.from });
		cursor = Math.max(cursor, range.to);
	}
	if (cursor < length) segments.push({ from: cursor, to: length });
	return segments;
}

function scanDelimitedMath(
	text: string,
	openDelim: string,
	closeDelim: string,
): SourceRange[] {
	const matches: SourceRange[] = [];
	const openLength = openDelim.length;
	const closeLength = closeDelim.length;
	let pos = 0;
	while (pos < text.length) {
		const open = text.indexOf(openDelim, pos);
		if (open < 0) break;
		const close = text.indexOf(closeDelim, open + openLength + 1);
		if (close < 0) break;
		const end = close + closeLength;
		matches.push({ from: open, to: end });
		pos = end;
	}
	return matches;
}

function scanInlineDollarMath(text: string): SourceRange[] {
	const matches: SourceRange[] = [];
	const length = text.length;
	let pos = 0;
	let lineEnd = -1;
	while (pos < length) {
		const open = text.indexOf("$", pos);
		if (open < 0) break;
		if (open > 0 && "\\" === text[open - 1]) {
			pos = open + 1;
			continue;
		}
		if (lineEnd < open) {
			const newline = text.indexOf("\n", open + 1);
			lineEnd = newline < 0 ? length : newline;
		}
		const close = text.indexOf("$", open + 1);
		if (close < 0) break;
		if (close > lineEnd) {
			pos = close;
			continue;
		}
		if (close > open + 1 && "\\" !== text[close - 1]) {
			matches.push({ from: open, to: close + 1 });
			pos = close + 1;
		} else {
			pos = close;
		}
	}
	return matches;
}

function maskMatchedRanges(
	text: string,
	matches: ReadonlyArray<SourceRange>,
	block: boolean,
): string {
	if (0 === matches.length) return text;
	const chunks: string[] = [];
	let cursor = 0;
	for (const match of matches) {
		if (match.from > cursor) {
			chunks.push(text.slice(cursor, match.from));
		}
		const length = match.to - match.from;
		chunks.push(
			block
				? `\n${"\u0000".repeat(Math.max(0, length - 1))}`
				: "\u0000".repeat(length),
		);
		cursor = match.to;
	}
	if (cursor < text.length) {
		chunks.push(text.slice(cursor));
	}
	return chunks.join("");
}

const MATH_SCAN_PASSES: ReadonlyArray<
	Readonly<{
		block: boolean;
		scan: (input: string) => SourceRange[];
	}>
> = [
	{ block: true, scan: (input) => scanDelimitedMath(input, "$$", "$$") },
	{ block: true, scan: (input) => scanDelimitedMath(input, "\\[", "\\]") },
	{ block: false, scan: (input) => scanDelimitedMath(input, "\\(", "\\)") },
	{ block: false, scan: scanInlineDollarMath },
];

export function mathRanges(
	source: string,
	protectedRanges: ReadonlyArray<SourceRange>,
): MathRange[] {
	const segments = outsideSegments(source.length, protectedRanges);
	const ranges: MathRange[] = [];
	for (const segment of segments) {
		const segmentText = source.slice(segment.from, segment.to);
		if (!segmentText.includes("$") && !segmentText.includes("\\")) {
			continue;
		}
		let text = segmentText;
		for (let passIndex = 0; passIndex < MATH_SCAN_PASSES.length; passIndex += 1) {
			const pass = MATH_SCAN_PASSES[passIndex];
			if (!pass) continue;
			const matches = pass.scan(text);
			if (0 === matches.length) continue;
			for (const match of matches) {
				ranges.push({
					block: pass.block,
					from: segment.from + match.from,
					to: segment.from + match.to,
				});
			}
			if (passIndex < MATH_SCAN_PASSES.length - 1) {
				text = maskMatchedRanges(text, matches, pass.block);
			}
		}
	}
	return ranges;
}

export type PhpMathSubstitution = Readonly<{
	block: boolean;
	origFrom: number;
	origTo: number;
	subFrom: number;
	subTo: number;
	tokenFrom: number;
	tokenTo: number;
}>;

type PhpMathSubstitutionResult = Readonly<{
	substituted: string;
	substitutions: ReadonlyArray<PhpMathSubstitution>;
}>;

/**
 * Mirrors PHP `MarkdownRenderer::extract_math()` substitution on sorted,
 * disjoint math ranges (`\n\nEASYMDE_MATH_i_TOKEN\n\n` for block math,
 * `EASYMDE_MATH_i_TOKEN` for inline math) with an exact monotonic offset map.
 */
export function substitutePhpMathRanges(
	text: string,
	sortedRanges: ReadonlyArray<MathRange>,
): PhpMathSubstitutionResult {
	const chunks: string[] = [];
	const substitutions: PhpMathSubstitution[] = [];
	let origCursor = 0;
	let subLen = 0;
	for (let idx = 0; idx < sortedRanges.length; idx += 1) {
		const range = sortedRanges[idx];
		if (!range) continue;
		const origFrom = Math.max(origCursor, range.from);
		const origTo = Math.min(text.length, range.to);
		if (origFrom >= origTo) continue;
		if (origFrom > origCursor) {
			chunks.push(text.slice(origCursor, origFrom));
			subLen += origFrom - origCursor;
		}
		const token = `EASYMDE_MATH_${idx}_TOKEN`;
		const subFrom = subLen;
		const tokenFrom = range.block ? subFrom + 2 : subFrom;
		const tokenTo = tokenFrom + token.length;
		const subTo = range.block ? tokenTo + 2 : tokenTo;
		chunks.push(range.block ? `\n\n${token}\n\n` : token);
		substitutions.push({
			block: range.block,
			origFrom,
			origTo,
			subFrom,
			subTo,
			tokenFrom,
			tokenTo,
		});
		subLen = subTo;
		origCursor = origTo;
	}
	if (origCursor < text.length) chunks.push(text.slice(origCursor));
	return { substituted: chunks.join(""), substitutions };
}

/**
 * Maps a start offset in PHP-math-substituted text back to the original text.
 * When `strict` is `true`, interior token offsets return `-1` instead of
 * clamping so block-skeleton checks fail closed on partial-token boundaries.
 */
export function mapSubstitutedStartToOriginal(
	subPos: number,
	substitutions: ReadonlyArray<PhpMathSubstitution>,
	strict = false,
): number {
	if (0 === substitutions.length) return subPos;
	let lo = 0;
	let hi = substitutions.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if ((substitutions[mid]?.subFrom ?? 0) <= subPos) lo = mid + 1;
		else hi = mid;
	}
	const sub = substitutions[lo - 1];
	if (!sub) return subPos;
	if (subPos >= sub.subTo) return sub.origTo + (subPos - sub.subTo);
	if (strict) {
		return subPos === sub.subFrom || (sub.block && subPos === sub.tokenFrom)
			? sub.origFrom
			: -1;
	}
	return sub.block && subPos >= sub.tokenTo ? sub.origTo : sub.origFrom;
}

/**
 * Maps an exclusive end offset in PHP-math-substituted text back to the
 * original text. When `strict` is `true`, interior token offsets return `-1`
 * instead of clamping so block-skeleton checks fail closed on partial-token
 * boundaries.
 */
export function mapSubstitutedEndToOriginal(
	subPos: number,
	substitutions: ReadonlyArray<PhpMathSubstitution>,
	strict = false,
): number {
	if (0 === substitutions.length) return subPos;
	let lo = 0;
	let hi = substitutions.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if ((substitutions[mid]?.subFrom ?? 0) < subPos) lo = mid + 1;
		else hi = mid;
	}
	const sub = substitutions[lo - 1];
	if (!sub) return subPos;
	if (subPos >= sub.subTo) return sub.origTo + (subPos - sub.subTo);
	if (strict) {
		return sub.block && subPos === sub.tokenTo ? sub.origTo : -1;
	}
	return sub.block && subPos <= sub.tokenFrom ? sub.origFrom : sub.origTo;
}
