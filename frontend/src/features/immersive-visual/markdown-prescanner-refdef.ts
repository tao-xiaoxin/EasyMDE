import {
	advanceParagraphReferenceParser,
	cloneParagraphReferenceParser,
	createParagraphReferenceParser,
	type ParagraphReferenceParser,
} from "../../shared/markdown/php-commonmark-reference-def";
import {
	isCommonMarkBlankLine,
	measureIndentColumns,
} from "./markdown-prescanner-blocks";
import {
	findFirstDisplayMathInLines,
	findLogicalLineEnd,
	firstMathRangeEndingAfter,
	maskedSliceForLines,
	opensNonParagraphBlock,
	type PhpDocumentMathIndex,
} from "./markdown-prescanner-tables";

/**
 * CommonMark §4.7 link reference definition lookahead & continuation scanner
 * for display-math splitting, with per-document typed-array memoization for
 * both `"title"` and `"label"` states (amortized O(N)).
 */

const LABEL_UNREACHABLE = 1000;

type RefDefContinuationMemo = Readonly<{
	/** `-1` = uncached, `0..999` = min remaining cp to close, `1000` = unreachable. */
	label: Int16Array;
	/** `0` = uncached, `1` = false, `2` = true. */
	title: Uint8Array;
}>;

const refDefContinuationMemo = new WeakMap<
	PhpDocumentMathIndex,
	WeakMap<ReadonlyArray<string>, RefDefContinuationMemo>
>();

function getRefDefContinuationMemo(
	mathIndex: PhpDocumentMathIndex,
	lines: ReadonlyArray<string>,
): RefDefContinuationMemo {
	let byLines = refDefContinuationMemo.get(mathIndex);
	if (!byLines) {
		byLines = new WeakMap();
		refDefContinuationMemo.set(mathIndex, byLines);
	}
	let memo = byLines.get(lines);
	if (!memo) {
		const label = new Int16Array(lines.length * 4);
		label.fill(-1);
		memo = { label, title: new Uint8Array(lines.length * 6) };
		byLines.set(lines, memo);
	}
	return memo;
}

function readRefParserState(
	parser: ParagraphReferenceParser,
): ParagraphReferenceParser["state"] {
	return parser.state;
}

function titleDelimIndex(delim: ParagraphReferenceParser["titleDelimiter"]): number {
	return delim === '"' ? 0 : delim === "'" ? 1 : 2;
}

/**
 * Replaces contained single-line display-math spans (`range.block`) in
 * `[lineStartOffset, lineEndOffset)` with non-whitespace `"M"` on top of
 * `mathIndex.maskedDoc`, mirroring what `extractInlineProtectedSyntax` emits
 * if a single-line display-math line is left unsplit.
 */
export function buildInlineMaskedDisplayMathLine(
	mathIndex: PhpDocumentMathIndex,
	lineStartOffset: number,
	lineEndOffset: number,
): string {
	let result = "";
	let cursor = lineStartOffset;
	for (
		let idx = firstMathRangeEndingAfter(mathIndex.ranges, lineStartOffset);
		idx < mathIndex.ranges.length;
		idx += 1
	) {
		const range = mathIndex.ranges[idx];
		if (!range || range.from >= lineEndOffset) break;
		if (!range.block || range.from < cursor || range.to > lineEndOffset) {
			continue;
		}
		if (range.from > cursor) {
			result += mathIndex.maskedDoc.slice(cursor, range.from);
		}
		result += "M";
		cursor = range.to;
	}
	if (cursor < lineEndOffset) {
		result += mathIndex.maskedDoc.slice(cursor, lineEndOffset);
	}
	return result;
}

type LabelLineScan =
	| Readonly<{ codePoints: number; hasNonWs: boolean; kind: "continue" }>
	| Readonly<{ codePoints: number; hasNonWs: boolean; kind: "close" }>
	| Readonly<{ kind: "invalid" }>;

function scanLabelLine(line: string): LabelLineScan {
	const len = line.length;
	let pos = 0;
	while (pos < len && (line[pos] === " " || line[pos] === "\t")) pos += 1;
	let codePoints = 0;
	let hasNonWs = false;
	while (pos < len) {
		const ch = line[pos];
		if (ch === "[" || ch === "]") break;
		if (ch === "\\") {
			hasNonWs = true;
			codePoints += 1;
			pos += 1;
			if (pos < len) {
				const next = line.charCodeAt(pos);
				pos += next >= 0xd800 && next <= 0xdbff && pos + 1 < len ? 2 : 1;
				codePoints += 1;
			}
			continue;
		}
		const code = line.charCodeAt(pos);
		if (
			code !== 0x20 &&
			code !== 0x09 &&
			code !== 0x0a &&
			code !== 0x0d &&
			code !== 0x00 &&
			code !== 0x0b
		) {
			hasNonWs = true;
		}
		pos += code >= 0xd800 && code <= 0xdbff && pos + 1 < len ? 2 : 1;
		codePoints += 1;
	}
	if (pos >= len) {
		return { codePoints: codePoints + 1, hasNonWs, kind: "continue" };
	}
	if (line[pos] !== "]" || line[pos + 1] !== ":") return { kind: "invalid" };
	return { codePoints, hasNonWs, kind: "close" };
}

function scanLabelContinuation(
	initialCp: number,
	initialHasNonWs: boolean,
	lines: ReadonlyArray<string>,
	mathIndex: PhpDocumentMathIndex,
	nextLineIndex: number,
	maskInlineDisplayMath: boolean,
	memo: RefDefContinuationMemo,
): boolean {
	if (initialCp > 999) return false;
	const modeBit = maskInlineDisplayMath ? 2 : 0;
	const labelMemo = memo.label;
	if (nextLineIndex < lines.length) {
		const firstCached =
			labelMemo[(nextLineIndex << 2) | modeBit | (initialHasNonWs ? 1 : 0)] ??
			-1;
		if (firstCached >= 0) {
			return initialCp + firstCached <= 999;
		}
	}
	const visitedSlots: number[] = [];
	const visitedDeltas: number[] = [];
	let curHasNonWs = initialHasNonWs;
	let tailMinCp = LABEL_UNREACHABLE;
	let k = nextLineIndex;

	while (k < lines.length) {
		const slot = (k << 2) | modeBit | (curHasNonWs ? 1 : 0);
		const cached = labelMemo[slot] ?? -1;
		if (cached >= 0) {
			tailMinCp = cached;
			break;
		}
		const kEnd = findLogicalLineEnd(mathIndex, k);
		const firstDisp = findFirstDisplayMathInLines(mathIndex, k, kEnd);
		let lineText: string;
		let cutoff = false;
		if (firstDisp !== null) {
			const kStart = mathIndex.lineStarts[k] ?? 0;
			const kEndOffset = mathIndex.lineEnds[kEnd] ?? kStart;
			if (maskInlineDisplayMath && firstDisp.to <= kEndOffset) {
				lineText = buildInlineMaskedDisplayMathLine(mathIndex, kStart, kEndOffset);
			} else if (firstDisp.from <= kStart) {
				visitedSlots.push(slot);
				visitedDeltas.push(0);
				break;
			} else {
				lineText = mathIndex.maskedDoc.slice(kStart, firstDisp.from);
				cutoff = true;
			}
		} else {
			lineText = maskedSliceForLines(mathIndex, lines, k, kEnd);
		}
		if (
			isCommonMarkBlankLine(lineText) ||
			opensNonParagraphBlock(lineText, 0, true)
		) {
			visitedSlots.push(slot);
			visitedDeltas.push(0);
			break;
		}
		const scan = scanLabelLine(lineText);
		if (scan.kind === "invalid") {
			visitedSlots.push(slot);
			visitedDeltas.push(0);
			break;
		}
		if (scan.kind === "continue") {
			visitedSlots.push(slot);
			visitedDeltas.push(scan.codePoints);
			if (cutoff) break;
			if (scan.hasNonWs) curHasNonWs = true;
			k = kEnd + 1;
			continue;
		}
		visitedSlots.push(slot);
		visitedDeltas.push(0);
		if (scan.codePoints <= 999 && (curHasNonWs || scan.hasNonWs)) {
			const probe = createParagraphReferenceParser();
			probe.state = "label";
			probe.labelHasNonWhitespace = curHasNonWs;
			if (advanceParagraphReferenceParser(probe, lineText)) {
				tailMinCp = scan.codePoints;
			} else if (
				!cutoff &&
				readRefParserState(probe) !== "paragraph" &&
				scanRefDefContinuation(
					probe,
					lines,
					mathIndex,
					kEnd + 1,
					maskInlineDisplayMath,
				)
			) {
				tailMinCp = scan.codePoints;
			}
		}
		break;
	}

	let running = tailMinCp;
	for (let i = visitedSlots.length - 1; i >= 0; i -= 1) {
		const slot = visitedSlots[i] ?? 0;
		const delta = visitedDeltas[i] ?? 0;
		running = running >= LABEL_UNREACHABLE ? LABEL_UNREACHABLE : running + delta;
		if (running > 999) running = LABEL_UNREACHABLE;
		labelMemo[slot] = running;
	}
	return initialCp + running <= 999;
}

function scanRefDefContinuation(
	refParser: ParagraphReferenceParser,
	lines: ReadonlyArray<string>,
	mathIndex: PhpDocumentMathIndex,
	nextLineIndex: number,
	maskInlineDisplayMath: boolean,
): boolean {
	const memo = getRefDefContinuationMemo(mathIndex, lines);
	const visitedTitleSlots: number[] = [];
	const result = scanRefDefContinuationLines(
		refParser,
		lines,
		mathIndex,
		nextLineIndex,
		maskInlineDisplayMath,
		memo,
		visitedTitleSlots,
	);
	const encoded = result ? 2 : 1;
	for (let i = 0; i < visitedTitleSlots.length; i += 1) {
		const slot = visitedTitleSlots[i];
		if (slot !== undefined) memo.title[slot] = encoded;
	}
	return result;
}

function scanRefDefContinuationLines(
	refParser: ParagraphReferenceParser,
	lines: ReadonlyArray<string>,
	mathIndex: PhpDocumentMathIndex,
	nextLineIndex: number,
	maskInlineDisplayMath: boolean,
	memo: RefDefContinuationMemo,
	visitedTitleSlots: number[],
): boolean {
	const titleModeOffset = maskInlineDisplayMath ? 3 : 0;
	let k = nextLineIndex;
	while (k < lines.length && readRefParserState(refParser) !== "paragraph") {
		if (readRefParserState(refParser) === "label") {
			return scanLabelContinuation(
				refParser.labelCodePoints,
				refParser.labelHasNonWhitespace,
				lines,
				mathIndex,
				k,
				maskInlineDisplayMath,
				memo,
			);
		}
		if (readRefParserState(refParser) === "title") {
			const slot =
				k * 6 + titleModeOffset + titleDelimIndex(refParser.titleDelimiter);
			const cached = memo.title[slot] ?? 0;
			if (cached !== 0) {
				return cached === 2;
			}
			visitedTitleSlots.push(slot);
		}
		const kEnd = findLogicalLineEnd(mathIndex, k);
		const firstDisp = findFirstDisplayMathInLines(mathIndex, k, kEnd);
		if (firstDisp !== null) {
			const kStart = mathIndex.lineStarts[k] ?? 0;
			const kEndOffset = mathIndex.lineEnds[kEnd] ?? kStart;
			if (maskInlineDisplayMath && firstDisp.to <= kEndOffset) {
				const inlineMasked = buildInlineMaskedDisplayMathLine(
					mathIndex,
					kStart,
					kEndOffset,
				);
				if (
					isCommonMarkBlankLine(inlineMasked) ||
					opensNonParagraphBlock(inlineMasked, 0, true)
				) {
					return false;
				}
				if (advanceParagraphReferenceParser(refParser, inlineMasked)) {
					return true;
				}
				k = kEnd + 1;
				continue;
			}
			if (firstDisp.from <= kStart) {
				return false;
			}
			const maskedBefore = mathIndex.maskedDoc.slice(kStart, firstDisp.from);
			if (
				isCommonMarkBlankLine(maskedBefore) ||
				opensNonParagraphBlock(maskedBefore, 0, true)
			) {
				return false;
			}
			return advanceParagraphReferenceParser(refParser, maskedBefore);
		}
		const maskedContinuation = maskedSliceForLines(mathIndex, lines, k, kEnd);
		if (
			isCommonMarkBlankLine(maskedContinuation) ||
			opensNonParagraphBlock(maskedContinuation, 0, true)
		) {
			return false;
		}
		if (advanceParagraphReferenceParser(refParser, maskedContinuation)) {
			return true;
		}
		k = kEnd + 1;
	}
	return false;
}

export function startsValidReferenceDefinition(
	maskedLine: string,
	lines?: ReadonlyArray<string>,
	mathIndex?: PhpDocumentMathIndex,
	nextLineIndex = -1,
	startColumn = 0,
	maskInlineDisplayMath = false,
): boolean {
	if (
		!maskedLine.includes("[") ||
		measureIndentColumns(maskedLine, startColumn) >= 4
	) {
		return false;
	}
	const refParser = createParagraphReferenceParser();
	if (advanceParagraphReferenceParser(refParser, maskedLine)) {
		return true;
	}
	if (
		lines === undefined ||
		mathIndex === undefined ||
		nextLineIndex < 0 ||
		readRefParserState(refParser) === "paragraph"
	) {
		return false;
	}
	return scanRefDefContinuation(
		refParser,
		lines,
		mathIndex,
		nextLineIndex,
		maskInlineDisplayMath,
	);
}

export function continuesValidReferenceDefinition(
	activeRefParser: ParagraphReferenceParser | null,
	maskedLine: string,
	lines?: ReadonlyArray<string>,
	mathIndex?: PhpDocumentMathIndex,
	nextLineIndex = -1,
	maskInlineDisplayMath = false,
): boolean {
	if (activeRefParser === null || activeRefParser.state === "paragraph") {
		return false;
	}
	if (lines === undefined) {
		if (activeRefParser.state === "label" && !maskedLine.includes("]")) {
			return false;
		}
		if (
			activeRefParser.state === "title" &&
			activeRefParser.titleDelimiter !== null &&
			!maskedLine.includes(activeRefParser.titleDelimiter) &&
			!maskedLine.includes(";")
		) {
			return false;
		}
	}
	if (opensNonParagraphBlock(maskedLine, 0, true)) {
		return false;
	}
	const probe = cloneParagraphReferenceParser(activeRefParser);
	if (advanceParagraphReferenceParser(probe, maskedLine)) {
		return true;
	}
	if (
		lines === undefined ||
		mathIndex === undefined ||
		nextLineIndex < 0 ||
		readRefParserState(probe) === "paragraph"
	) {
		return false;
	}
	return scanRefDefContinuation(
		probe,
		lines,
		mathIndex,
		nextLineIndex,
		maskInlineDisplayMath,
	);
}

/**
 * Memoized entry point for probing whether an active §4.7 refdef parser
 * completes starting at `lineIndex` under inline-masked display-math mode.
 * Hits the per-document label/title memo directly at `lineIndex` in O(1)
 * without rebuilding `buildInlineMaskedDisplayMathLine` or cloning the parser.
 */
export function continuesInlineMaskedRefDefAtLine(
	activeRefParser: ParagraphReferenceParser | null,
	lines: ReadonlyArray<string>,
	mathIndex: PhpDocumentMathIndex,
	lineIndex: number,
): boolean {
	if (activeRefParser === null || activeRefParser.state === "paragraph") {
		return false;
	}
	if (activeRefParser.state === "label") {
		return scanLabelContinuation(
			activeRefParser.labelCodePoints,
			activeRefParser.labelHasNonWhitespace,
			lines,
			mathIndex,
			lineIndex,
			true,
			getRefDefContinuationMemo(mathIndex, lines),
		);
	}
	return scanRefDefContinuation(
		cloneParagraphReferenceParser(activeRefParser),
		lines,
		mathIndex,
		lineIndex,
		true,
	);
}
