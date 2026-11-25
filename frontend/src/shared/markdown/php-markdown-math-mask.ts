import {
	type ScannedCodeRange,
	scanPhpCommonMarkBlockCodeRanges,
} from "./php-commonmark-block-engine";

/**
 * Canonical PHP `MarkdownRenderer::extract_math()` +
 * `MarkdownCodeRegionScanner` length-preserving masker for GFM table scanning.
 *
 * PHP extracts both display math (`$$...$$`, `\[...\]`) and inline math
 * (`$...$`, `\(...\)`) outside CommonMark code regions BEFORE `League\CommonMark`
 * parses GFM tables:
 * - Display math becomes `"\n\n" . $token . "\n\n"`, isolating adjacent tables
 *   in O(1) lines (`"\n\n" + "M".repeat(len - 4) + "\n\n"`).
 * - Inline math becomes `$token` with zero `|` delimiters, so pipes inside
 *   `$a|b$` / `\(a|b\)` never split table cells or inflate `headerColumnCount`.
 */

export type PhpMarkdownMathRange = Readonly<{
	block: boolean;
	from: number;
	to: number;
}>;

type BacktickRun = Readonly<{
	escaped: boolean;
	from: number;
	length: number;
	segment: number;
	to: number;
}>;

const DISPLAY_DOLLAR_MATH = /\$\$[\s\S]+?\$\$/gu;
const DISPLAY_BRACKET_MATH = /\\\[[\s\S]+?\\\]/gu;
const INLINE_PAREN_MATH = /\\\([\s\S]+?\\\)/gu;
const INLINE_DOLLAR_MATH = /(?<!\\)\$[^\n$]+?(?<!\\)\$/gu;

function maskDisplayMathLength(length: number): string {
	return length >= 4
		? `\n\n${"M".repeat(length - 4)}\n\n`
		: "\n".repeat(length);
}

function maskInlineMathText(match: string): string {
	if (!match.includes("\n") && !match.includes("\r")) {
		return "M".repeat(match.length);
	}
	return match.replace(/[^\r\n]/gu, "M");
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

function firstRunAfter(
	runs: ReadonlyArray<number>,
	currentRun: number,
): number | null {
	let low = 0;
	let high = runs.length - 1;
	let result: number | null = null;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate = runs[middle];
		if (undefined === candidate || candidate <= currentRun) {
			low = middle + 1;
		} else {
			result = candidate;
			high = middle - 1;
		}
	}
	return result;
}

function scanInlineCodeRanges(
	source: string,
	protectedRanges: ReadonlyArray<ScannedCodeRange>,
): ScannedCodeRange[] {
	if (!source.includes("`")) return [];
	const runs = collectBacktickRuns(source, protectedRanges);
	if (runs.length < 2) return [];
	const bySegmentAndLength = new Map<number, Map<number, number[]>>();
	for (let index = 0; index < runs.length; index += 1) {
		const run = runs[index];
		if (!run) continue;
		let byLength = bySegmentAndLength.get(run.segment);
		if (!byLength) {
			byLength = new Map<number, number[]>();
			bySegmentAndLength.set(run.segment, byLength);
		}
		let sameLength = byLength.get(run.length);
		if (!sameLength) {
			sameLength = [];
			byLength.set(run.length, sameLength);
		}
		sameLength.push(index);
	}

	const ranges: ScannedCodeRange[] = [];
	let runIndex = 0;
	while (runIndex < runs.length) {
		const run = runs[runIndex];
		if (!run) break;
		const firstLength = run.escaped ? run.length - 1 : run.length;
		const sameLength =
			firstLength > 0
				? bySegmentAndLength.get(run.segment)?.get(firstLength)
				: undefined;
		const closeIndex = sameLength ? firstRunAfter(sameLength, runIndex) : null;
		if (null === closeIndex) {
			runIndex += 1;
			continue;
		}
		const close = runs[closeIndex];
		if (!close) break;
		const start = run.escaped ? run.to - firstLength : run.from;
		ranges.push({ end: close.to, start });
		runIndex = closeIndex + 1;
	}
	return ranges;
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

function replacePatternMatches(
	text: string,
	pattern: RegExp,
	isDisplay: boolean,
): Readonly<{ matched: boolean; matchedPipe: boolean; text: string }> {
	pattern.lastIndex = 0;
	let matched = false;
	let matchedPipe = false;
	let cursor = 0;
	let parts: string[] | null = null;
	let match = pattern.exec(text);
	while (null !== match) {
		const full = match[0];
		const from = match.index;
		const to = from + full.length;
		if (!parts) parts = [];
		if (from > cursor) parts.push(text.slice(cursor, from));
		if (isDisplay) {
			parts.push(maskDisplayMathLength(full.length));
		} else {
			if (!matchedPipe && full.includes("|")) matchedPipe = true;
			parts.push(maskInlineMathText(full));
		}
		matched = true;
		cursor = to;
		match = pattern.exec(text);
	}
	if (!parts) return { matched: false, matchedPipe: false, text };
	if (cursor < text.length) parts.push(text.slice(cursor));
	return { matched, matchedPipe, text: parts.join("") };
}

function maskSegmentOutsideCode(
	segment: string,
	hasDollar: boolean,
	hasBracket: boolean,
	hasParen: boolean,
	hasPipe: boolean,
): Readonly<{ affectedTable: boolean; text: string }> {
	let current = segment;
	let affectedTable = false;

	if (hasDollar && current.includes("$$")) {
		const res = replacePatternMatches(current, DISPLAY_DOLLAR_MATH, true);
		if (res.matched) {
			current = res.text;
			affectedTable = true;
		}
	}
	if (hasBracket && current.includes("\\[")) {
		const res = replacePatternMatches(current, DISPLAY_BRACKET_MATH, true);
		if (res.matched) {
			current = res.text;
			affectedTable = true;
		}
	}
	if (!hasPipe) {
		return { affectedTable, text: affectedTable ? current : segment };
	}
	if (hasParen && current.includes("\\(")) {
		const res = replacePatternMatches(current, INLINE_PAREN_MATH, false);
		if (res.matched) {
			current = res.text;
			if (res.matchedPipe) affectedTable = true;
		}
	}
	if (hasDollar && current.includes("$")) {
		const res = replacePatternMatches(current, INLINE_DOLLAR_MATH, false);
		if (res.matched) {
			current = res.text;
			if (res.matchedPipe) affectedTable = true;
		}
	}
	return { affectedTable, text: affectedTable ? current : segment };
}

function maskKnownMathRanges(
	source: string,
	knownRanges: ReadonlyArray<PhpMarkdownMathRange>,
): string {
	if (0 === knownRanges.length) return source;
	const hasPipe = source.includes("|");
	let needsMask = false;
	for (let i = 0; i < knownRanges.length; i += 1) {
		const range = knownRanges[i];
		if (!range || range.to <= range.from) continue;
		if (range.block) {
			needsMask = true;
			break;
		}
		if (
			hasPipe &&
			source
				.slice(Math.max(0, range.from), Math.min(source.length, range.to))
				.includes("|")
		) {
			needsMask = true;
			break;
		}
	}
	if (!needsMask) return source;

	const parts: string[] = [];
	let cursor = 0;
	for (let i = 0; i < knownRanges.length; i += 1) {
		const range = knownRanges[i];
		if (!range) continue;
		const from = Math.max(cursor, range.from);
		const to = Math.min(source.length, range.to);
		if (to <= from) continue;
		if (from > cursor) parts.push(source.slice(cursor, from));
		parts.push(
			range.block
				? maskDisplayMathLength(to - from)
				: maskInlineMathText(source.slice(from, to)),
		);
		cursor = to;
	}
	if (cursor < source.length) parts.push(source.slice(cursor));
	return parts.join("");
}

/**
 * Returns a byte-length-preserving copy of `source` with PHP-extracted display
 * math and inline math masked so GFM table scanning matches PHP
 * `MarkdownRenderer::extract_math()` + `League\CommonMark` `TableParser`.
 *
 * Fast-paths to return `source` untouched whenever no math delimiter exists, or
 * when no display math exists and no inline math contains `|`.
 */
export function maskPhpMarkdownMathForTableScan(
	source: string,
	knownRanges?: ReadonlyArray<PhpMarkdownMathRange>,
): string {
	if (undefined !== knownRanges) {
		return maskKnownMathRanges(source, knownRanges);
	}
	const hasDollar = source.includes("$");
	const hasBracket = source.includes("\\[");
	const hasParen = source.includes("\\(");
	if (!hasDollar && !hasBracket && !hasParen) return source;

	const hasPipe = source.includes("|");
	if (!hasPipe && !hasBracket && !(hasDollar && source.includes("$$"))) {
		return source;
	}

	const blockCodeRanges = scanPhpCommonMarkBlockCodeRanges(source);
	const inlineCodeRanges = scanInlineCodeRanges(source, blockCodeRanges);
	const codeRanges = mergeCodeRanges(blockCodeRanges, inlineCodeRanges);

	if (0 === codeRanges.length) {
		const masked = maskSegmentOutsideCode(
			source,
			hasDollar,
			hasBracket,
			hasParen,
			hasPipe,
		);
		return masked.affectedTable ? masked.text : source;
	}

	const parts: string[] = [];
	let cursor = 0;
	let anyAffected = false;
	for (let i = 0; i < codeRanges.length; i += 1) {
		const codeRange = codeRanges[i];
		if (!codeRange) continue;
		if (codeRange.start > cursor) {
			const segment = source.slice(cursor, codeRange.start);
			const masked = maskSegmentOutsideCode(
				segment,
				hasDollar,
				hasBracket,
				hasParen,
				hasPipe,
			);
			if (masked.affectedTable) anyAffected = true;
			parts.push(masked.text);
		}
		if (codeRange.end > cursor) {
			const codeStart = Math.max(cursor, codeRange.start);
			parts.push(source.slice(codeStart, codeRange.end));
			cursor = codeRange.end;
		}
	}
	if (cursor < source.length) {
		const segment = source.slice(cursor);
		const masked = maskSegmentOutsideCode(
			segment,
			hasDollar,
			hasBracket,
			hasParen,
			hasPipe,
		);
		if (masked.affectedTable) anyAffected = true;
		parts.push(masked.text);
	}
	return anyAffected ? parts.join("") : source;
}
