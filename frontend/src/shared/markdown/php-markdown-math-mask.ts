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
 *   delimiters (`"M".repeat(len)`), preserving exact UTF-16 offsets (including
 *   surrogate pairs) so pipes or line breaks inside `$a|b$` / `\(x\ny\)` never
 *   split table cells, close tables, or distort `headerColumnCount`.
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

type MaskPassResult = Readonly<{
	affectedTable: boolean;
	matched: boolean;
	text: string;
}>;

function maskDisplayMathLength(length: number): string {
	return length >= 4
		? `\n\n${"M".repeat(length - 4)}\n\n`
		: "\n".repeat(length);
}

function maskInlineMathLength(length: number): string {
	return "M".repeat(length);
}

function hasTableOrLineBreakChar(
	text: string,
	start: number,
	end: number,
): boolean {
	for (let index = start; index < end; index += 1) {
		const ch = text[index];
		if ("|" === ch || "\n" === ch || "\r" === ch) return true;
	}
	return false;
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

function maskDelimitedMath(
	text: string,
	openDelim: string,
	closeDelim: string,
	isDisplay: boolean,
): MaskPassResult {
	let pos = text.indexOf(openDelim);
	if (pos < 0) return { affectedTable: false, matched: false, text };

	const openLen = openDelim.length;
	const closeLen = closeDelim.length;
	let matched = false;
	let affectedTable = false;
	let cursor = 0;
	let parts: string[] | null = null;

	while (pos >= 0) {
		const close = text.indexOf(closeDelim, pos + openLen + 1);
		if (close < 0) break;
		const to = close + closeLen;
		if (!parts) parts = [];
		if (pos > cursor) parts.push(text.slice(cursor, pos));
		if (isDisplay) {
			parts.push(maskDisplayMathLength(to - pos));
			affectedTable = true;
		} else {
			if (
				!affectedTable &&
				hasTableOrLineBreakChar(text, pos + openLen, close)
			) {
				affectedTable = true;
			}
			parts.push(maskInlineMathLength(to - pos));
		}
		matched = true;
		cursor = to;
		pos = text.indexOf(openDelim, cursor);
	}
	if (!parts) return { affectedTable: false, matched: false, text };
	if (cursor < text.length) parts.push(text.slice(cursor));
	return { affectedTable, matched, text: parts.join("") };
}

function maskInlineDollarMath(text: string): MaskPassResult {
	let search = 0;
	let lineEnd = -1;
	let cursor = 0;
	let matched = false;
	let affectedTable = false;
	let parts: string[] | null = null;

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
		if (!parts) parts = [];
		if (open > cursor) parts.push(text.slice(cursor, open));
		if (
			!affectedTable &&
			hasTableOrLineBreakChar(text, open + 1, nextDollar)
		) {
			affectedTable = true;
		}
		parts.push(maskInlineMathLength(to - open));
		matched = true;
		cursor = to;
		search = to;
	}
	if (!parts) return { affectedTable: false, matched: false, text };
	if (cursor < text.length) parts.push(text.slice(cursor));
	return { affectedTable, matched, text: parts.join("") };
}

function maskSegmentOutsideCode(
	segment: string,
	hasDoubleDollar: boolean,
	hasDollar: boolean,
	hasBracketPair: boolean,
	hasParenPair: boolean,
	hasPipe: boolean,
	hasLineBreak: boolean,
	hasCr: boolean,
): Readonly<{ affectedTable: boolean; text: string }> {
	let current = segment;
	let affectedTable = false;

	if (hasDoubleDollar && current.includes("$$")) {
		const res = maskDelimitedMath(current, "$$", "$$", true);
		if (res.matched) {
			current = res.text;
			affectedTable = true;
		}
	}
	if (hasBracketPair && current.includes("\\[")) {
		const res = maskDelimitedMath(current, "\\[", "\\]", true);
		if (res.matched) {
			current = res.text;
			affectedTable = true;
		}
	}
	if (!hasPipe && !hasLineBreak) {
		return { affectedTable, text: affectedTable ? current : segment };
	}
	if (hasParenPair && current.includes("\\(")) {
		const res = maskDelimitedMath(current, "\\(", "\\)", false);
		if (res.matched) {
			current = res.text;
			if (res.affectedTable) affectedTable = true;
		}
	}
	if (hasDollar && (hasPipe || hasCr) && current.includes("$")) {
		const res = maskInlineDollarMath(current);
		if (res.matched) {
			current = res.text;
			if (res.affectedTable) affectedTable = true;
		}
	}
	return { affectedTable, text: affectedTable ? current : segment };
}

function maskKnownMathRanges(
	source: string,
	knownRanges: ReadonlyArray<PhpMarkdownMathRange>,
): string {
	if (0 === knownRanges.length) return source;
	let needsMask = false;
	for (let i = 0; i < knownRanges.length; i += 1) {
		const range = knownRanges[i];
		if (!range || range.to <= range.from) continue;
		if (range.block) {
			needsMask = true;
			break;
		}
		if (
			hasTableOrLineBreakChar(
				source,
				Math.max(0, range.from),
				Math.min(source.length, range.to),
			)
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
				: maskInlineMathLength(to - from),
		);
		cursor = to;
	}
	if (cursor < source.length) parts.push(source.slice(cursor));
	return parts.join("");
}

/**
 * Returns a UTF-16-length-preserving copy of `source` with PHP-extracted
 * display math and inline math masked so CommonMark block and GFM table
 * scanning matches PHP `MarkdownRenderer::extract_math()` +
 * `League\CommonMark` `TableParser`.
 *
 * Fast-paths to return `source` untouched whenever no math delimiter can alter
 * block or table structure (no display math pair and no inline math containing
 * `|`, `\n`, or `\r`).
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

	const hasDoubleDollar = hasDollar && source.includes("$$");
	const hasBracketPair = hasBracket && source.includes("\\]");
	const hasParenPair = hasParen && source.includes("\\)");
	const hasPipe = source.includes("|");
	const hasCr = source.includes("\r");
	const hasLineBreak = hasCr || source.includes("\n");
	if (
		!hasDoubleDollar &&
		!hasBracketPair &&
		!(hasParenPair && (hasPipe || hasLineBreak)) &&
		!(hasDollar && (hasPipe || hasCr))
	) {
		return source;
	}

	const blockCodeRanges = scanPhpCommonMarkBlockCodeRanges(source);
	const inlineCodeRanges = scanInlineCodeRanges(source, blockCodeRanges);
	const codeRanges = mergeCodeRanges(blockCodeRanges, inlineCodeRanges);

	if (0 === codeRanges.length) {
		const masked = maskSegmentOutsideCode(
			source,
			hasDoubleDollar,
			hasDollar,
			hasBracketPair,
			hasParenPair,
			hasPipe,
			hasLineBreak,
			hasCr,
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
				hasDoubleDollar,
				hasDollar,
				hasBracketPair,
				hasParenPair,
				hasPipe,
				hasLineBreak,
				hasCr,
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
			hasDoubleDollar,
			hasDollar,
			hasBracketPair,
			hasParenPair,
			hasPipe,
			hasLineBreak,
			hasCr,
		);
		if (masked.affectedTable) anyAffected = true;
		parts.push(masked.text);
	}
	return anyAffected ? parts.join("") : source;
}
