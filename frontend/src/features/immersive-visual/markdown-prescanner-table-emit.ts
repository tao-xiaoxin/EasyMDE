import {
	COMMONMARK_SETEXT_UNDERLINE,
	parseGfmTableSeparatorColumns,
} from "../../shared/markdown/php-commonmark-block-helpers";
import type { PhpMarkdownMathRange } from "../../shared/markdown/php-markdown-math-mask";
import {
	type ContainerStep,
	formatContainerPrefix,
	isCommonMarkBlankLine,
	measureIndentColumns,
	peelContainerStepsForLine,
	stripContainersWithColumn,
	stripPartialContainers,
} from "./markdown-prescanner-blocks";
import {
	type BeforeHtmlContext,
	buildInlineMaskedDisplayMathLine,
	continuesInlineMaskedRefDefAtLine,
	continuesValidReferenceDefinition,
	type DisplayMathEmitEnv,
	emitUnclosedIntermediateHtmlBlock,
	extendLogicalSpanForDisplayMath,
	matchStandaloneBeforeHtmlBlock,
	matchUnclosedHtmlBlockTypes1To5,
	POST_MATH_BEFORE_HTML_CONTEXT,
	shiftInlineMathRanges,
	startsValidReferenceDefinition,
	type TrailingParagraphState,
} from "./markdown-prescanner-display-math";
import { extractInlineProtectedSyntax } from "./markdown-prescanner-inline";
import { emitPostDisplayMathSegment } from "./markdown-prescanner-post-math";
import {
	collectRelativeInlineMathRanges,
	findFirstDisplayMathInLines,
	findLogicalLineEnd,
	firstMathRangeEndingAfter,
	type GfmTableMatch,
	isTableSeparatorInterruptedByHigherPriorityBlock,
	maskedSliceForLines,
	matchTableAlignmentMarkerLine,
	opensNonParagraphBlock,
	type PhpDocumentMathIndex,
} from "./markdown-prescanner-tables";

export type {
	BeforeHtmlContext,
	DisplayMathEmitEnv,
} from "./markdown-prescanner-display-math";

/**
 * Feature-private GFM table row and display-math line/header/break emitters
 * for `markdown-prescanner.ts`, delegating HTML/block splitting and post-math
 * block resolution to `markdown-prescanner-display-math.ts`.
 */

export type DisplayMathSplitResult = Readonly<{
	activeTable: GfmTableMatch | null;
	activeTableOutputStart: number;
	afterStartOffset: number;
	emittedTableBeforeRow: boolean;
	openedContainers: ReadonlyArray<ContainerStep> | null;
	spanEndLine: number;
	trailingParagraphState: TrailingParagraphState | null;
}>;

/**
 * Emits a matched GFM table header row (joining lines bridged by multiline
 * `\(...\)` while passing relative inline math ranges and masked slices to the
 * inline scanner).
 */
export function emitTableHeaderRow(
	env: DisplayMathEmitEnv,
	headerStartLine: number,
	headerEndLine: number,
): void {
	const { callbacks, mathIndex, protectedInlines, sentinel } = env;
	const headerStartOffset = mathIndex.lineStarts[headerStartLine] ?? 0;
	const headerEndOffset =
		mathIndex.lineEnds[headerEndLine] ?? headerStartOffset;
	const rawHeader = mathIndex.normalized.slice(
		headerStartOffset,
		headerEndOffset,
	);
	const maskedHeader = mathIndex.maskedDoc.slice(
		headerStartOffset,
		headerEndOffset,
	);
	const headerMathRanges = collectRelativeInlineMathRanges(
		mathIndex,
		headerStartOffset,
		headerEndOffset,
	);
	callbacks.pushOutputLine(
		extractInlineProtectedSyntax(
			rawHeader,
			sentinel,
			protectedInlines,
			true,
			false,
			-1,
			headerMathRanges,
			maskedHeader,
		),
		maskedHeader.includes("|")
			? { end: headerEndLine + 1, start: headerStartLine }
			: null,
	);
}

/**
 * Emits one active table body row (joining physical lines bridged by multiline
 * `\(...\)` and normalizing lazy container prefixes so `markdown-it` keeps the
 * row inside the table matching PHP `League\CommonMark`). Returns the last
 * physical line index consumed.
 */
export function emitActiveTableRow(
	env: DisplayMathEmitEnv,
	lineIndex: number,
	activeTable: GfmTableMatch,
): number {
	const { callbacks, mathIndex, protectedInlines, sentinel } = env;
	const { pushOutputLine } = callbacks;
	const logicalEnd = findLogicalLineEnd(mathIndex, lineIndex);
	const rowStartOffset = mathIndex.lineStarts[lineIndex] ?? 0;
	const rowEndOffset = mathIndex.lineEnds[logicalEnd] ?? rowStartOffset;
	const rawRow = mathIndex.normalized.slice(rowStartOffset, rowEndOffset);
	if (activeTable.lazyRowStartLines.has(lineIndex)) {
		const partial = stripPartialContainers(rawRow, activeTable.containers);
		const rowMathRanges = collectRelativeInlineMathRanges(
			mathIndex,
			rowStartOffset + partial.consumedLength,
			rowEndOffset,
			partial.virtualSpaces,
		);
		const maskedPartial = `${" ".repeat(partial.virtualSpaces)}${mathIndex.maskedDoc.slice(
			rowStartOffset + partial.consumedLength,
			rowEndOffset,
		)}`;
		const extracted = extractInlineProtectedSyntax(
			partial.remainder,
			sentinel,
			protectedInlines,
			true,
			false,
			-1,
			rowMathRanges,
			maskedPartial,
		);
		pushOutputLine(
			`${formatContainerPrefix(activeTable.containers)}${extracted}`,
			{ end: logicalEnd + 1, start: lineIndex },
		);
	} else {
		const maskedRow = mathIndex.maskedDoc.slice(rowStartOffset, rowEndOffset);
		const rowMathRanges = collectRelativeInlineMathRanges(
			mathIndex,
			rowStartOffset,
			rowEndOffset,
		);
		pushOutputLine(
			extractInlineProtectedSyntax(
				rawRow,
				sentinel,
				protectedInlines,
				true,
				false,
				-1,
				rowMathRanges,
				maskedRow,
			),
			{ end: logicalEnd + 1, start: lineIndex },
		);
	}
	return logicalEnd;
}

/**
 * Shared strictly-O(N) display-math line splitter used by table breaks,
 * pre-delimiter header lines, container-closing display math, and multiline
 * `\(...\)` logical lines. Uses ONE monotonic cursor over `mathIndex.ranges`
 * and an iterative continuation loop when post-math HTML blocks break before a
 * later display-math block.
 */
export function emitDisplayMathLineSegments(
	env: DisplayMathEmitEnv,
	lineIndex: number,
	initialSpanEndLine: number,
	tableContainers: ReadonlyArray<ContainerStep> | null,
	beforeHtmlContext: BeforeHtmlContext | null,
	initialStartOffset?: number,
	initialEmittedAny = false,
): DisplayMathSplitResult {
	const { callbacks, mathIndex, protectedInlines, sentinel } = env;
	const { addProtectedBlock, pushOutputLine } = callbacks;
	const ranges = mathIndex.ranges;
	let cursorOffset = initialStartOffset ?? mathIndex.lineStarts[lineIndex] ?? 0;
	let spanEndLine = initialSpanEndLine;
	let spanEndOffset = mathIndex.lineEnds[spanEndLine] ?? cursorOffset;
	let rangeIdx = firstMathRangeEndingAfter(ranges, cursorOffset);
	let emittedTableBeforeRow = false;
	let emittedAny = initialEmittedAny || tableContainers !== null;
	let isFirstDisplayMath = !initialEmittedAny;

	while (true) {
		let afterInlineRanges: PhpMarkdownMathRange[] | null = null;

		while (cursorOffset <= spanEndOffset) {
			let gapInlineRanges: PhpMarkdownMathRange[] | null = null;
			let nextDisplay: PhpMarkdownMathRange | null = null;
			while (rangeIdx < ranges.length) {
				const candidate = ranges[rangeIdx];
				if (!candidate || candidate.from >= spanEndOffset) {
					break;
				}
				if (candidate.from < cursorOffset) {
					rangeIdx += 1;
					continue;
				}
				if (candidate.block) {
					nextDisplay = candidate;
					rangeIdx += 1;
					break;
				}
				if (candidate.to <= spanEndOffset) {
					if (gapInlineRanges === null) {
						gapInlineRanges = [];
					}
					gapInlineRanges.push(candidate);
				}
				rangeIdx += 1;
			}
			if (nextDisplay === null) {
				afterInlineRanges = gapInlineRanges;
				break;
			}

			const beforeText = mathIndex.normalized.slice(
				cursorOffset,
				nextDisplay.from,
			);
			const maskedBeforeText = mathIndex.maskedDoc.slice(
				cursorOffset,
				nextDisplay.from,
			);
			if (isFirstDisplayMath && tableContainers !== null) {
				const fullMatch =
					tableContainers.length > 0
						? stripContainersWithColumn(beforeText, tableContainers)
						: null;
				const partial =
					tableContainers.length > 0 && fullMatch === null
						? stripPartialContainers(beforeText, tableContainers)
						: null;
				const effectiveBefore = fullMatch
					? fullMatch.rest
					: partial
						? partial.remainder
						: beforeText;
				if (!isCommonMarkBlankLine(effectiveBefore)) {
					emittedTableBeforeRow = true;
					if (partial !== null) {
						const beforeMathRanges = shiftInlineMathRanges(
							gapInlineRanges,
							cursorOffset + partial.consumedLength,
							nextDisplay.from,
							partial.virtualSpaces,
						);
						const maskedPartialBefore = `${" ".repeat(partial.virtualSpaces)}${mathIndex.maskedDoc.slice(
							cursorOffset + partial.consumedLength,
							nextDisplay.from,
						)}`;
						const extractedBefore = extractInlineProtectedSyntax(
							partial.remainder,
							sentinel,
							protectedInlines,
							true,
							false,
							-1,
							beforeMathRanges,
							maskedPartialBefore,
						);
						pushOutputLine(
							`${formatContainerPrefix(tableContainers)}${extractedBefore}`,
							null,
						);
					} else {
						const beforeMathRanges = shiftInlineMathRanges(
							gapInlineRanges,
							cursorOffset,
							nextDisplay.from,
						);
						pushOutputLine(
							extractInlineProtectedSyntax(
								beforeText,
								sentinel,
								protectedInlines,
								true,
								false,
								-1,
								beforeMathRanges,
								maskedBeforeText,
							),
							null,
						);
					}
				}
			} else if (!isCommonMarkBlankLine(beforeText)) {
				const gapContext =
					isFirstDisplayMath && beforeHtmlContext !== null
						? beforeHtmlContext
						: POST_MATH_BEFORE_HTML_CONTEXT;
				const unclosedType = matchUnclosedHtmlBlockTypes1To5(
					maskedBeforeText,
					gapContext,
					true,
				);
				if (unclosedType !== null) {
					const rawTrimStart =
						cursorOffset +
						(beforeText.length - beforeText.replace(/^[ \t]+/, "").length);
					const htmlResult = emitUnclosedIntermediateHtmlBlock(
						env,
						unclosedType,
						rawTrimStart,
						nextDisplay,
						spanEndLine,
						spanEndOffset,
						rangeIdx,
						emittedAny,
					);
					emittedAny = true;
					isFirstDisplayMath = false;
					if (htmlResult.kind === "resume") {
						cursorOffset = htmlResult.cursorOffset;
						rangeIdx = htmlResult.rangeIdx;
						spanEndLine = htmlResult.spanEndLine;
						spanEndOffset = htmlResult.spanEndOffset;
						continue;
					}
					return {
						activeTable: null,
						activeTableOutputStart: -1,
						afterStartOffset: htmlResult.afterStartOffset,
						emittedTableBeforeRow,
						openedContainers: null,
						spanEndLine: htmlResult.spanEndLine,
						trailingParagraphState: null,
					};
				}
				if (emittedAny) {
					pushOutputLine("", null);
				}
				const standaloneHtml = matchStandaloneBeforeHtmlBlock(
					beforeText,
					maskedBeforeText,
					gapContext,
				);
				if (standaloneHtml !== null) {
					pushOutputLine(
						`${standaloneHtml.linePrefix}${addProtectedBlock("raw", standaloneHtml.rawHtml)}`,
						null,
					);
				} else {
					const gapMathRanges = shiftInlineMathRanges(
						gapInlineRanges,
						cursorOffset,
						nextDisplay.from,
					);
					pushOutputLine(
						extractInlineProtectedSyntax(
							beforeText,
							sentinel,
							protectedInlines,
							false,
							!isFirstDisplayMath ||
								!beforeHtmlContext?.inParagraph ||
								(beforeHtmlContext.activeRefParser !== null &&
									beforeHtmlContext.activeRefParser.state !== "paragraph"),
							-1,
							gapMathRanges,
							maskedBeforeText,
						),
						null,
					);
				}
				emittedAny = true;
			}
			isFirstDisplayMath = false;

			if (emittedAny || env.hasPrecedingContent()) {
				pushOutputLine("", null);
			}
			const mathToken = addProtectedBlock(
				"math",
				mathIndex.normalized.slice(nextDisplay.from, nextDisplay.to),
			);
			pushOutputLine(mathToken, null);
			emittedAny = true;
			cursorOffset = nextDisplay.to;
			const extended = extendLogicalSpanForDisplayMath(
				mathIndex,
				nextDisplay,
				spanEndLine,
				spanEndOffset,
			);
			spanEndLine = extended.spanEndLine;
			spanEndOffset = extended.spanEndOffset;
		}

		pushOutputLine("", null);
		const afterStartOffset = cursorOffset;
		const postResult = emitPostDisplayMathSegment(
			env,
			spanEndLine,
			afterStartOffset,
			spanEndOffset,
			afterInlineRanges,
		);
		if (postResult.kind === "resume") {
			spanEndLine = findLogicalLineEnd(mathIndex, postResult.resumeLine);
			spanEndOffset = mathIndex.lineEnds[spanEndLine] ?? postResult.resumeOffset;
			cursorOffset = postResult.resumeOffset;
			rangeIdx = firstMathRangeEndingAfter(ranges, cursorOffset);
			emittedAny = true;
			isFirstDisplayMath = false;
			continue;
		}
		return {
			activeTable: postResult.activeTable,
			activeTableOutputStart: postResult.activeTableOutputStart,
			afterStartOffset,
			emittedTableBeforeRow,
			openedContainers: postResult.openedContainers,
			spanEndLine: postResult.spanEndLine,
			trailingParagraphState: postResult.trailingParagraphState,
		};
	}
}

/**
 * Splits a display-math-bearing line (`$$...$$` / `\[...\]`) that breaks an
 * active GFM table, mirroring PHP `MarkdownRenderer::extract_math()` replacing
 * display math with `"\n\n" . $token . "\n\n"`.
 */
export function emitDisplayMathTableBreak(
	env: DisplayMathEmitEnv,
	lineIndex: number,
	tableContainers: ReadonlyArray<ContainerStep>,
): DisplayMathSplitResult {
	const initialSpanEndLine = findLogicalLineEnd(env.mathIndex, lineIndex);
	return emitDisplayMathLineSegments(
		env,
		lineIndex,
		initialSpanEndLine,
		tableContainers,
		null,
	);
}

/**
 * Splits a display-math-bearing line (`$$...$$` / `\[...\]`) that immediately
 * precedes a GFM table delimiter line, routing all leading HTML segments
 * through `emitDisplayMathLineSegments` with `requireTopLevel = true` so
 * container-scoped comments (`> <!-- $$a$$ | b |`) and closed leading comments
 * (`<!-- $$a$$ --> $$b$$ | c |`) split identically to PHP.
 */
export function emitDisplayMathHeaderLine(
	env: DisplayMathEmitEnv,
	lineIndex: number,
	beforeHtmlContext: BeforeHtmlContext,
): DisplayMathSplitResult | null {
	const { lines, mathIndex } = env;
	if (
		!mathIndex.hasMultilineInlineMath &&
		!mathIndex.hasMultilineDisplayMath &&
		!(lines[lineIndex + 1] ?? "").includes("-")
	) {
		return null;
	}
	const lineStartOffset = mathIndex.lineStarts[lineIndex] ?? 0;
	let spanEndLine = findLogicalLineEnd(mathIndex, lineIndex);
	const firstDisplay = findFirstDisplayMathInLines(
		mathIndex,
		lineIndex,
		spanEndLine,
	);
	if (firstDisplay === null || firstDisplay.from < lineStartOffset) {
		return null;
	}

	const firstBefore = mathIndex.normalized.slice(
		lineStartOffset,
		firstDisplay.from,
	);
	const ranges = mathIndex.ranges;
	let spanEndOffset = mathIndex.lineEnds[spanEndLine] ?? lineStartOffset;
	let scanIdx = firstMathRangeEndingAfter(ranges, lineStartOffset);
	let displayCount = 0;
	let lastDisplayTo = -1;

	while (scanIdx < ranges.length) {
		const range = ranges[scanIdx];
		if (!range || range.from >= spanEndOffset) break;
		if (range.block && range.from >= lineStartOffset) {
			lastDisplayTo = range.to;
			displayCount += 1;
			const extended = extendLogicalSpanForDisplayMath(
				mathIndex,
				range,
				spanEndLine,
				spanEndOffset,
			);
			spanEndLine = extended.spanEndLine;
			spanEndOffset = extended.spanEndOffset;
		}
		scanIdx += 1;
	}

	const delimiterLine = spanEndLine + 1;
	if (
		displayCount === 0 ||
		delimiterLine >= lines.length ||
		!(lines[delimiterLine] ?? "").includes("-") ||
		findLogicalLineEnd(mathIndex, delimiterLine) !== delimiterLine ||
		findFirstDisplayMathInLines(mathIndex, delimiterLine, delimiterLine) !==
			null ||
		(displayCount === 1 &&
			isCommonMarkBlankLine(firstBefore) &&
			isCommonMarkBlankLine(
				mathIndex.normalized.slice(lastDisplayTo, spanEndOffset),
			))
	) {
		return null;
	}

	const delimiterPeeled = peelContainerStepsForLine(
		maskedSliceForLines(mathIndex, lines, delimiterLine, delimiterLine),
		[],
		0,
		true,
		true,
	);
	if (
		delimiterPeeled === null ||
		isTableSeparatorInterruptedByHigherPriorityBlock(
			delimiterPeeled.rest,
			delimiterPeeled.column,
		) ||
		parseGfmTableSeparatorColumns(delimiterPeeled.rest) === 0
	) {
		return null;
	}

	return emitDisplayMathLineSegments(
		env,
		lineIndex,
		spanEndLine,
		null,
		beforeHtmlContext,
	);
}

const STANDALONE_TOC_PATTERN = /^\[TOC\][ \t]*$/i;
const FOOTNOTE_DEF_START_PATTERN = /^\[\^([^\s\]]+)\]:(?:[ \t]|$)/;

function isSetextUnderlineSegment(maskedLine: string): boolean {
	if (maskedLine.length === 0 || measureIndentColumns(maskedLine, 0) >= 4) {
		return false;
	}
	return COMMONMARK_SETEXT_UNDERLINE.test(maskedLine.replace(/^[ \t]+/, ""));
}

function isStandaloneTocSegment(maskedLine: string, column = 0): boolean {
	if (
		maskedLine.length < 5 ||
		measureIndentColumns(maskedLine, column) >= 4
	) {
		return false;
	}
	return STANDALONE_TOC_PATTERN.test(maskedLine.replace(/^[ \t]+/, ""));
}

function isFootnoteDefSegment(maskedLine: string, column = 0): boolean {
	if (
		!maskedLine.includes("[^") ||
		measureIndentColumns(maskedLine, column) >= 4
	) {
		return false;
	}
	return FOOTNOTE_DEF_START_PATTERN.test(maskedLine.replace(/^[ \t]+/, ""));
}

function isGfmTableDelimiterSegment(maskedLine: string, column = 0): boolean {
	return (
		maskedLine.includes("-") &&
		!isTableSeparatorInterruptedByHigherPriorityBlock(maskedLine, column) &&
		parseGfmTableSeparatorColumns(maskedLine) > 0
	);
}

/**
 * Scans consecutive top-level paragraph continuation lines starting at
 * `startLine` for either a Setext heading underline (`===` / `---`) or (when
 * `checkTableDelimiter` is true) a GFM table separator row, stopping on any
 * blank line, interrupting non-paragraph block, or subsequent display-math
 * line (since PHP `extract_math()` inserts `\n\n<MATH>\n\n` there). Strictly
 * O(N) amortized across the entire document because every non-display-math
 * line is visited at most once between consecutive display-math lines.
 */
function scanFollowingParagraphBoundary(
	lines: ReadonlyArray<string>,
	mathIndex: PhpDocumentMathIndex,
	startLine: number,
	checkTableDelimiter: boolean,
	initialHasPriorLine: boolean,
): boolean {
	let hasPriorLine = initialHasPriorLine;
	let k = startLine;
	while (k < lines.length) {
		const kEnd = findLogicalLineEnd(mathIndex, k);
		const firstDisp = findFirstDisplayMathInLines(mathIndex, k, kEnd);
		if (firstDisp !== null) {
			const kStart = mathIndex.lineStarts[k] ?? 0;
			if (firstDisp.from > kStart) {
				const maskedBefore = mathIndex.maskedDoc.slice(kStart, firstDisp.from);
				if (
					isSetextUnderlineSegment(maskedBefore) ||
					(checkTableDelimiter &&
						hasPriorLine &&
						isGfmTableDelimiterSegment(maskedBefore))
				) {
					return true;
				}
			}
			return false;
		}
		const maskedLine = maskedSliceForLines(mathIndex, lines, k, kEnd);
		if (isCommonMarkBlankLine(maskedLine)) {
			return false;
		}
		if (k === kEnd) {
			if (isSetextUnderlineSegment(maskedLine)) {
				return true;
			}
			if (
				checkTableDelimiter &&
				hasPriorLine &&
				isGfmTableDelimiterSegment(maskedLine)
			) {
				return true;
			}
		}
		if (opensNonParagraphBlock(maskedLine, 0, true)) {
			return false;
		}
		hasPriorLine = true;
		k = kEnd + 1;
	}
	return false;
}

/**
 * Checks whether `nextLineIndex` immediately following blank post-math text
 * starts a block that only opens when no paragraph is active (`!inParagraph`):
 * 4-space indented code, non-interrupting list markers (`2.`, `01.`, `- `),
 * HTML Block Type 7, CommonMark §4.7 reference definitions, standalone `[TOC]`,
 * footnote definitions, or reserved EasyMDE table alignment markers.
 */
function nextLineOpensBlockOnMathBoundary(
	lines: ReadonlyArray<string>,
	mathIndex: PhpDocumentMathIndex,
	nextLineIndex: number,
	beforeHtmlContext: BeforeHtmlContext,
): boolean {
	if (nextLineIndex >= lines.length) {
		return false;
	}
	const nextLogicalEnd = findLogicalLineEnd(mathIndex, nextLineIndex);
	const nextFirstDisp = findFirstDisplayMathInLines(
		mathIndex,
		nextLineIndex,
		nextLogicalEnd,
	);
	const nextStartOffset = mathIndex.lineStarts[nextLineIndex] ?? 0;
	const nextEndOffset =
		nextFirstDisp !== null
			? nextFirstDisp.from
			: (mathIndex.lineEnds[nextLogicalEnd] ?? nextStartOffset);
	if (nextEndOffset <= nextStartOffset) {
		return false;
	}
	const maskedNext = mathIndex.maskedDoc.slice(nextStartOffset, nextEndOffset);
	if (isCommonMarkBlankLine(maskedNext)) {
		return false;
	}
	const hasBaseContainers =
		beforeHtmlContext.baseContainers.length > 0 ||
		beforeHtmlContext.preMarkerListIndent > 0;
	const peeled = hasBaseContainers
		? peelContainerStepsForLine(
				maskedNext,
				beforeHtmlContext.baseContainers,
				beforeHtmlContext.preMarkerListIndent,
				false,
				false,
			)
		: { column: 0, containers: [], linePrefix: "", rest: maskedNext };
	if (peeled === null || isCommonMarkBlankLine(peeled.rest)) {
		return false;
	}
	const nextRest = peeled.rest;
	const nextCol = peeled.column;
	if (
		opensNonParagraphBlock(nextRest, nextCol, false) &&
		!opensNonParagraphBlock(nextRest, nextCol, true)
	) {
		return true;
	}
	if (
		startsValidReferenceDefinition(
			nextRest,
			nextFirstDisp === null ? lines : undefined,
			nextFirstDisp === null ? mathIndex : undefined,
			nextFirstDisp === null ? nextLogicalEnd + 1 : -1,
			nextCol,
		)
	) {
		return true;
	}
	if (
		isStandaloneTocSegment(nextRest, nextCol) ||
		isFootnoteDefSegment(nextRest, nextCol)
	) {
		return true;
	}
	const rawNext = mathIndex.normalized.slice(nextStartOffset, nextEndOffset);
	if (
		rawNext.includes("<!--") &&
		matchTableAlignmentMarkerLine(
			lines,
			nextLineIndex,
			beforeHtmlContext.baseContainers,
			beforeHtmlContext.preMarkerListIndent,
			true,
			mathIndex,
			rawNext,
		) !== null
	) {
		return true;
	}
	return false;
}

/**
 * Splits a logical line (`lineIndex..logicalEnd`) containing display math
 * (`range.block`). When `onlyOnBlockBoundary` is true (top-level line outside
 * containers), splits when any display-math range extends past `lineEndOffset`,
 * opens a leading/intermediate/trailing non-paragraph block, unclosed Type 1–5
 * HTML block, §4.7 refdef, `[TOC]`, or footnote definition, precedes a single-
 * or multi-line Setext underline, risks carrying `paragraphHasPipe` into a
 * following GFM table delimiter (or has `|` in `maskedAfter` before a table),
 * or has blank `maskedAfter` followed by any `!inParagraph`-only block,
 * keeping plain single-line `Hello $$x$$` inline.
 */
export function emitDisplayMathLogicalLine(
	env: DisplayMathEmitEnv,
	lineIndex: number,
	logicalEnd: number,
	beforeHtmlContext: BeforeHtmlContext,
	onlyOnBlockBoundary = false,
): DisplayMathSplitResult | null {
	const { lines, mathIndex } = env;
	const lineStartOffset = mathIndex.lineStarts[lineIndex] ?? 0;
	const lineEndOffset = mathIndex.lineEnds[logicalEnd] ?? lineStartOffset;
	let firstDisplayFrom = -1;
	let lastDisplayTo = -1;
	let extendsPastLine = false;
	let intermediateGapOpensBlock = false;
	for (
		let idx = firstMathRangeEndingAfter(mathIndex.ranges, lineStartOffset);
		idx < mathIndex.ranges.length;
		idx += 1
	) {
		const range = mathIndex.ranges[idx];
		if (!range || range.from >= lineEndOffset) break;
		if (range.block && range.from >= lineStartOffset) {
			if (firstDisplayFrom < 0) {
				firstDisplayFrom = range.from;
			} else if (onlyOnBlockBoundary && !intermediateGapOpensBlock) {
				const gap = mathIndex.maskedDoc.slice(lastDisplayTo, range.from);
				if (
					!isCommonMarkBlankLine(gap) &&
					(opensNonParagraphBlock(gap, 0, false) ||
						startsValidReferenceDefinition(gap) ||
						isStandaloneTocSegment(gap) ||
						isFootnoteDefSegment(gap))
				) {
					intermediateGapOpensBlock = true;
				}
			}
			lastDisplayTo = range.to;
			if (range.to > lineEndOffset) {
				extendsPastLine = true;
				break;
			}
		}
	}
	if (firstDisplayFrom < 0) return null;
	if (onlyOnBlockBoundary && !extendsPastLine && !intermediateGapOpensBlock) {
		const maskedAfter = mathIndex.maskedDoc.slice(lastDisplayTo, lineEndOffset);
		const trailingAfterBlank = isCommonMarkBlankLine(maskedAfter);
		const nextLineIndex = logicalEnd + 1;
		const trailingOpensBlock =
			!trailingAfterBlank &&
			(opensNonParagraphBlock(maskedAfter, 0, false) ||
				startsValidReferenceDefinition(
					maskedAfter,
					lines,
					mathIndex,
					nextLineIndex,
				) ||
				isStandaloneTocSegment(maskedAfter) ||
				isFootnoteDefSegment(maskedAfter));
		const nextOpensNonParagraphBlock =
			trailingAfterBlank &&
			nextLineOpensBlockOnMathBoundary(
				lines,
				mathIndex,
				nextLineIndex,
				beforeHtmlContext,
			);
		const hasPipeBeforeLastDisplay =
			Boolean(beforeHtmlContext.inParagraph && beforeHtmlContext.paragraphHasPipe) ||
			mathIndex.maskedDoc.slice(lineStartOffset, lastDisplayTo).includes("|");
		const checkTableDelimiter =
			hasPipeBeforeLastDisplay || maskedAfter.includes("|");
		const nextHitsParagraphBoundary =
			nextLineIndex < lines.length &&
			scanFollowingParagraphBoundary(
				lines,
				mathIndex,
				nextLineIndex,
				checkTableDelimiter,
				!trailingAfterBlank,
			);
		const maskedBefore = mathIndex.maskedDoc.slice(
			lineStartOffset,
			firstDisplayFrom,
		);
		const leadingBeforeBlank = isCommonMarkBlankLine(maskedBefore);
		const leadingOpensBlock =
			!leadingBeforeBlank &&
			(opensNonParagraphBlock(maskedBefore, 0, beforeHtmlContext.inParagraph) ||
				(!beforeHtmlContext.inParagraph &&
					isStandaloneTocSegment(maskedBefore)));
		const leadingUnclosedHtml =
			!leadingBeforeBlank &&
			matchUnclosedHtmlBlockTypes1To5(maskedBefore, beforeHtmlContext, true) !==
				null;
		const leadingRefDef =
			!leadingBeforeBlank &&
			(beforeHtmlContext.inParagraph
				? continuesValidReferenceDefinition(
						beforeHtmlContext.activeRefParser,
						maskedBefore,
					)
				: startsValidReferenceDefinition(maskedBefore));
		// If left unsplit, `extractInlineProtectedSyntax` masks contained display
		// math as non-whitespace tokens (`EASYMDEPHINL...`), which could cause
		// `easymde_reference` to fabricate a bogus §4.7 reference definition
		// (`[r]: $$x$$`, `[r]: /u "$$x$$"`, `[$$x$$]: /u`, `[r]: /u\n"$$x$$"`,
		// `[foo\n$$x$$]: /u`). Probe the inline-masked line and split if so.
		let inlineMaskedRefDef = false;
		if (!leadingRefDef) {
			if (beforeHtmlContext.inParagraph) {
				if (
					beforeHtmlContext.activeRefParser !== null &&
					beforeHtmlContext.activeRefParser.state !== "paragraph"
				) {
					inlineMaskedRefDef = continuesInlineMaskedRefDefAtLine(
						beforeHtmlContext.activeRefParser,
						lines,
						mathIndex,
						lineIndex,
					);
				}
			} else if (
				!leadingBeforeBlank &&
				measureIndentColumns(maskedBefore, 0) < 4 &&
				maskedBefore.replace(/^[ \t]+/, "").startsWith("[")
			) {
				const inlineMasked = buildInlineMaskedDisplayMathLine(
					mathIndex,
					lineStartOffset,
					lineEndOffset,
				);
				inlineMaskedRefDef = startsValidReferenceDefinition(
					inlineMasked,
					lines,
					mathIndex,
					nextLineIndex,
					0,
					true,
				);
			}
		}
		if (
			!trailingOpensBlock &&
			!nextOpensNonParagraphBlock &&
			!nextHitsParagraphBoundary &&
			!leadingOpensBlock &&
			!leadingUnclosedHtml &&
			!leadingRefDef &&
			!inlineMaskedRefDef
		) {
			return null;
		}
	}
	return emitDisplayMathLineSegments(
		env,
		lineIndex,
		logicalEnd,
		null,
		beforeHtmlContext,
	);
}
