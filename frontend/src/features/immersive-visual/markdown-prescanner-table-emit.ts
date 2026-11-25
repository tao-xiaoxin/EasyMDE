import {
	COMMONMARK_FENCE_OPEN_WITH_INFO,
	htmlBlockLineCloses,
	matchHtmlBlockOpen,
	parseGfmTableSeparatorColumns,
} from "../../shared/markdown/php-commonmark-block-helpers";
import type { PhpMarkdownMathRange } from "../../shared/markdown/php-markdown-math-mask";
import {
	type ContainerStep,
	computeTrailingParagraphState,
	type DetectableFence,
	findCommonMarkHtmlBlockEnd,
	findContainerBoundedFenceEnd,
	isCommonMarkBlankLine,
	measureIndentColumns,
	stripContainers,
	stripContainersWithColumn,
	type TrailingParagraphState,
} from "./markdown-prescanner-blocks";
import {
	extractInlineProtectedSyntax,
	type ProtectedInlineEntry,
} from "./markdown-prescanner-inline";
import {
	type BeforeHtmlContext,
	collectRelativeInlineMathRanges,
	findFirstDisplayMathInLines,
	findGfmTableEnd,
	findLineIndexForOffset,
	findLogicalLineEnd,
	firstMathRangeEndingAfter,
	formatContainerPrefix,
	type GfmTableMatch,
	maskedSliceForLines,
	matchPeeledGfmTableHeader,
	matchStandaloneBeforeHtmlBlock,
	matchUnclosedHtmlBlockTypes1To5,
	POST_MATH_BEFORE_HTML_CONTEXT,
	type PhpDocumentMathIndex,
	peelContainerStepsForLine,
	stripPartialContainers,
} from "./markdown-prescanner-tables";
import type { ProtectedBlockKind } from "./visual-schema";

/**
 * Feature-private GFM table row and display-math table break/header emitters
 * for `markdown-prescanner.ts`, mirroring PHP `MarkdownRenderer::extract_math()`
 * (`"\n\n" . $token . "\n\n"` for display math) in strictly O(N) time with one
 * monotonic math-range cursor (zero per-gap binary searches).
 */

export type TableEmitCallbacks = Readonly<{
	addProtectedBlock: (kind: ProtectedBlockKind, rawMarkdown: string) => string;
	pushOutputLine: (
		text: string,
		range: Readonly<{ end: number; start: number }> | null,
	) => void;
}>;

export type DisplayMathEmitEnv = Readonly<{
	callbacks: TableEmitCallbacks;
	getOutputLength: () => number;
	lines: ReadonlyArray<string>;
	mathIndex: PhpDocumentMathIndex;
	protectedInlines: Map<string, ProtectedInlineEntry>;
	sentinel: string;
}>;

export type DisplayMathSplitResult = Readonly<{
	activeTable: GfmTableMatch | null;
	activeTableOutputStart: number;
	afterStartOffset: number;
	emittedTableBeforeRow: boolean;
	spanEndLine: number;
	trailingParagraphState: TrailingParagraphState | null;
}>;

const EMPTY_MATH_RANGES: ReadonlyArray<PhpMarkdownMathRange> = [];

function shiftInlineMathRanges(
	rawRanges: ReadonlyArray<PhpMarkdownMathRange> | null,
	baseOffset: number,
	endOffset: number,
	offsetShift = 0,
): ReadonlyArray<PhpMarkdownMathRange> {
	if (rawRanges === null || rawRanges.length === 0) {
		return EMPTY_MATH_RANGES;
	}
	const relative: PhpMarkdownMathRange[] = [];
	for (let idx = 0; idx < rawRanges.length; idx += 1) {
		const range = rawRanges[idx];
		if (range && range.from >= baseOffset && range.to <= endOffset) {
			relative.push({
				block: false,
				from: range.from - baseOffset + offsetShift,
				to: range.to - baseOffset + offsetShift,
			});
		}
	}
	return relative;
}

/**
 * Emits a matched GFM table header row (joining lines bridged by multiline
 * `\(...\)` while passing relative inline math ranges to the inline scanner).
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
		),
		{ end: headerEndLine + 1, start: headerStartLine },
	);
}

/**
 * Emits one active table body row (joining physical lines bridged by multiline
 * `\(...\)` and normalizing lazy container prefixes so `markdown-it` keeps the
 * row inside the table matching PHP `League\CommonMark`). Returns the next
 * physical line index to visit.
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
		const extracted = extractInlineProtectedSyntax(
			partial.remainder,
			sentinel,
			protectedInlines,
			true,
			false,
			-1,
			rowMathRanges,
		);
		pushOutputLine(
			`${formatContainerPrefix(activeTable.containers)}${extracted}`,
			{ end: logicalEnd + 1, start: lineIndex },
		);
	} else {
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
			),
			{ end: logicalEnd + 1, start: lineIndex },
		);
	}
	return logicalEnd;
}

/**
 * Evaluates and emits the trailing segment after the final display-math block
 * on `spanEndLine`:
 * 1. CommonMark HTML block (Types 1–7), consuming continuation lines;
 * 2. CommonMark fenced code block (including Mermaid), consuming through close;
 * 3. GFM table header validated by `matchPeeledGfmTableHeader`, handing off
 *    `activeTable` / `activeTableOutputStart` to `markdown-prescanner.ts`;
 * 4. Normal inline line fallback (restoring live paragraph/container state).
 */
function emitPostDisplayMathSegment(
	env: DisplayMathEmitEnv,
	spanEndLine: number,
	afterStartOffset: number,
	spanEndOffset: number,
	afterInlineRanges: ReadonlyArray<PhpMarkdownMathRange> | null,
): Readonly<{
	activeTable: GfmTableMatch | null;
	activeTableOutputStart: number;
	spanEndLine: number;
	trailingParagraphState: TrailingParagraphState | null;
}> {
	const {
		callbacks,
		getOutputLength,
		lines,
		mathIndex,
		protectedInlines,
		sentinel,
	} = env;
	if (afterStartOffset >= spanEndOffset) {
		return {
			activeTable: null,
			activeTableOutputStart: -1,
			spanEndLine,
			trailingParagraphState: null,
		};
	}
	const rawAfter = mathIndex.normalized.slice(afterStartOffset, spanEndOffset);
	if (isCommonMarkBlankLine(rawAfter)) {
		return {
			activeTable: null,
			activeTableOutputStart: -1,
			spanEndLine,
			trailingParagraphState: null,
		};
	}
	const maskedAfter = mathIndex.maskedDoc.slice(
		afterStartOffset,
		spanEndOffset,
	);
	const afterPeeled = peelContainerStepsForLine(
		maskedAfter,
		[],
		0,
		true,
		true,
	);

	if (afterPeeled !== null) {
		const afterIndent = measureIndentColumns(
			afterPeeled.rest,
			afterPeeled.column,
		);
		const afterTrimmed = afterPeeled.rest.replace(/^[ \t]+/, "");

		// 1. CommonMark §4.6 Types 1-7 HTML block opening after display math.
		if (afterIndent <= 3 && afterTrimmed.startsWith("<")) {
			const htmlType = matchHtmlBlockOpen(afterTrimmed, true);
			if (htmlType !== null) {
				const rawPeeled = peelContainerStepsForLine(rawAfter, [], 0, true, true);
				const rawFirstContent = (rawPeeled?.rest ?? afterPeeled.rest).replace(
					/^[ \t]+/,
					"",
				);
				const htmlPrefix = rawPeeled?.linePrefix ?? afterPeeled.linePrefix;
				let htmlEndLine = findCommonMarkHtmlBlockEnd(
					lines,
					spanEndLine,
					htmlType,
					afterPeeled.containers,
					rawFirstContent,
				);
				if (htmlType === 6 || htmlType === 7) {
					for (let k = spanEndLine + 1; k <= htmlEndLine; k += 1) {
						const disp = findFirstDisplayMathInLines(mathIndex, k, k);
						if (disp === null) {
							continue;
						}
						const kStart = mathIndex.lineStarts[k] ?? 0;
						const prefixBefore = mathIndex.normalized.slice(kStart, disp.from);
						const strippedBefore = stripContainers(
							prefixBefore,
							afterPeeled.containers,
						);
						if (
							strippedBefore !== null &&
							isCommonMarkBlankLine(strippedBefore)
						) {
							htmlEndLine = k - 1;
							break;
						}
					}
				}
				const rawHtmlLines: string[] = [rawFirstContent];
				for (let k = spanEndLine + 1; k <= htmlEndLine; k += 1) {
					rawHtmlLines.push(
						stripContainers(lines[k] ?? "", afterPeeled.containers) ?? "",
					);
				}
				const htmlToken = callbacks.addProtectedBlock(
					"raw",
					rawHtmlLines.join("\n"),
				);
				callbacks.pushOutputLine(`${htmlPrefix}${htmlToken}`, null);
				return {
					activeTable: null,
					activeTableOutputStart: -1,
					spanEndLine: htmlEndLine,
					trailingParagraphState: null,
				};
			}
		}

		// 2. CommonMark fenced code block opening after display math.
		if (
			afterIndent <= 3 &&
			(afterTrimmed.startsWith("`") || afterTrimmed.startsWith("~"))
		) {
			const fenceMatch = COMMONMARK_FENCE_OPEN_WITH_INFO.exec(afterTrimmed);
			const fenceOpening = fenceMatch?.[1];
			if (
				fenceOpening &&
				!(fenceOpening[0] === "`" && (fenceMatch[2] ?? "").includes("`"))
			) {
				const rawPeeled = peelContainerStepsForLine(rawAfter, [], 0, true, true);
				const rawFirstContent = (rawPeeled?.rest ?? afterPeeled.rest).replace(
					/^[ \t]+/,
					"",
				);
				const rawFenceMatch =
					COMMONMARK_FENCE_OPEN_WITH_INFO.exec(rawFirstContent);
				const info = rawFenceMatch?.[2] ?? fenceMatch[2] ?? "";
				let quoteDepth = 0;
				for (const step of afterPeeled.containers) {
					if (step.kind === "blockquote") {
						quoteDepth += 1;
					}
				}
				const fence: DetectableFence = {
					containerIndent: 0,
					containers: afterPeeled.containers,
					fenceChar: fenceOpening[0] === "~" ? "~" : "`",
					fenceLength: fenceOpening.length,
					info,
					quoteDepth,
				};
				const fenceEndLine = findContainerBoundedFenceEnd(
					lines,
					spanEndLine,
					fence,
				);
				const lang = (info.trim().split(/\s+/)[0] ?? "").toLowerCase();
				if (lang === "mermaid" && afterPeeled.containers.length === 0) {
					const rawMermaidLines: string[] = [
						rawFirstContent,
						...lines.slice(spanEndLine + 1, fenceEndLine + 1),
					];
					callbacks.pushOutputLine(
						callbacks.addProtectedBlock("mermaid", rawMermaidLines.join("\n")),
						null,
					);
				} else {
					callbacks.pushOutputLine(rawAfter, null);
					for (let k = spanEndLine + 1; k <= fenceEndLine; k += 1) {
						callbacks.pushOutputLine(lines[k] ?? "", null);
					}
				}
				return {
					activeTable: null,
					activeTableOutputStart: -1,
					spanEndLine: fenceEndLine,
					trailingParagraphState: null,
				};
			}
		}

		// 3. Valid GFM table opening after display math.
		const delimiterLine = spanEndLine + 1;
		if (
			delimiterLine < lines.length &&
			(lines[delimiterLine] ?? "").includes("-") &&
			findLogicalLineEnd(mathIndex, delimiterLine) === delimiterLine &&
			findFirstDisplayMathInLines(mathIndex, delimiterLine, delimiterLine) ===
				null
		) {
			const maskedDelimiter = maskedSliceForLines(
				mathIndex,
				lines,
				delimiterLine,
				delimiterLine,
			);
			if (matchPeeledGfmTableHeader(afterPeeled, maskedDelimiter, false)) {
				const tableEnd = findGfmTableEnd(
					lines,
					delimiterLine,
					afterPeeled.containers,
					mathIndex,
				);
				const nextActiveTable: GfmTableMatch = {
					brokenByDisplayMathLine: tableEnd.brokenByDisplayMathLine,
					containers: afterPeeled.containers,
					delimiterLine,
					endLine: tableEnd.endLine,
					headerEndLine: spanEndLine,
					lazyRowStartLines: tableEnd.lazyRowStartLines,
				};
				const activeTableOutputStart = getOutputLength();
				const afterMathRanges = shiftInlineMathRanges(
					afterInlineRanges,
					afterStartOffset,
					spanEndOffset,
				);
				callbacks.pushOutputLine(
					extractInlineProtectedSyntax(
						rawAfter,
						sentinel,
						protectedInlines,
						true,
						false,
						-1,
						afterMathRanges,
					),
					null,
				);
				return {
					activeTable: nextActiveTable,
					activeTableOutputStart,
					spanEndLine,
					trailingParagraphState: null,
				};
			}
		}
	}

	// 4. Plain non-table trailing segment: restore live paragraph/container state.
	const afterMathRanges = shiftInlineMathRanges(
		afterInlineRanges,
		afterStartOffset,
		spanEndOffset,
	);
	callbacks.pushOutputLine(
		extractInlineProtectedSyntax(
			rawAfter,
			sentinel,
			protectedInlines,
			false,
			true,
			-1,
			afterMathRanges,
		),
		null,
	);
	return {
		activeTable: null,
		activeTableOutputStart: -1,
		spanEndLine,
		trailingParagraphState: computeTrailingParagraphState(maskedAfter),
	};
}

/**
 * Shared strictly-O(N) display-math line splitter used by both
 * `emitDisplayMathTableBreak` (table body row) and `emitDisplayMathHeaderLine`
 * (pre-delimiter header line). Uses ONE monotonic cursor over `mathIndex.ranges`
 * so repeated display-math blocks and non-empty gaps perform zero per-gap
 * binary searches.
 */
function emitDisplayMathLineSegments(
	env: DisplayMathEmitEnv,
	lineIndex: number,
	initialSpanEndLine: number,
	tableContainers: ReadonlyArray<ContainerStep> | null,
	beforeHtmlContext: BeforeHtmlContext | null,
): DisplayMathSplitResult {
	const { callbacks, lines, mathIndex, protectedInlines, sentinel } = env;
	const { addProtectedBlock, pushOutputLine } = callbacks;
	const ranges = mathIndex.ranges;
	let cursorOffset = mathIndex.lineStarts[lineIndex] ?? 0;
	let spanEndLine = initialSpanEndLine;
	let spanEndOffset = mathIndex.lineEnds[spanEndLine] ?? cursorOffset;
	let rangeIdx = firstMathRangeEndingAfter(ranges, cursorOffset);
	let emittedTableBeforeRow = false;
	let emittedAny = tableContainers !== null;
	let isFirstDisplayMath = true;
	let afterInlineRanges: PhpMarkdownMathRange[] | null = null;
	const extendSpanForDisplayMath = (range: PhpMarkdownMathRange): void => {
		if (range.to <= spanEndOffset) {
			return;
		}
		const rangeEndLine = findLineIndexForOffset(
			mathIndex,
			Math.max(range.from, range.to - 1),
		);
		const extendedEndLine = findLogicalLineEnd(mathIndex, rangeEndLine);
		if (extendedEndLine > spanEndLine) {
			spanEndLine = extendedEndLine;
			spanEndOffset = mathIndex.lineEnds[spanEndLine] ?? spanEndOffset;
		}
	};

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
					const extractedBefore = extractInlineProtectedSyntax(
						partial.remainder,
						sentinel,
						protectedInlines,
						true,
						false,
						-1,
						beforeMathRanges,
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
			const maskedBeforeText = mathIndex.maskedDoc.slice(
				cursorOffset,
				nextDisplay.from,
			);
			const unclosedType = matchUnclosedHtmlBlockTypes1To5(
				maskedBeforeText,
				gapContext,
				true,
			);
			if (unclosedType !== null) {
				const rawTrimStart =
					cursorOffset +
					(beforeText.length - beforeText.replace(/^[ \t]+/, "").length);
				extendSpanForDisplayMath(nextDisplay);
				let htmlCursor = nextDisplay.to;
				let closedOnLine = false;
				let resumeAtOffset = -1;
				while (true) {
					let laterDisplay: PhpMarkdownMathRange | null = null;
					while (rangeIdx < ranges.length) {
						const candidate = ranges[rangeIdx];
						if (!candidate || candidate.from >= spanEndOffset) {
							break;
						}
						if (candidate.from < htmlCursor) {
							rangeIdx += 1;
							continue;
						}
						if (candidate.block) {
							laterDisplay = candidate;
							break;
						}
						rangeIdx += 1;
					}
					const segEnd = laterDisplay ? laterDisplay.from : spanEndOffset;
					if (
						htmlBlockLineCloses(
							unclosedType,
							mathIndex.maskedDoc.slice(htmlCursor, segEnd),
						)
					) {
						if (emittedAny) {
							pushOutputLine("", null);
						}
						pushOutputLine(
							addProtectedBlock(
								"raw",
								mathIndex.normalized.slice(rawTrimStart, segEnd),
							),
							null,
						);
						emittedAny = true;
						closedOnLine = true;
						if (laterDisplay !== null) {
							resumeAtOffset = laterDisplay.from;
						}
						break;
					}
					if (laterDisplay === null) {
						break;
					}
					rangeIdx += 1;
					extendSpanForDisplayMath(laterDisplay);
					htmlCursor = laterDisplay.to;
				}
				if (closedOnLine) {
					if (resumeAtOffset >= 0) {
						isFirstDisplayMath = false;
						cursorOffset = resumeAtOffset;
						continue;
					}
					return {
						activeTable: null,
						activeTableOutputStart: -1,
						afterStartOffset: spanEndOffset,
						emittedTableBeforeRow,
						spanEndLine,
						trailingParagraphState: null,
					};
				}
				let htmlEndLine = spanEndLine;
				for (let k = spanEndLine + 1; k < lines.length; k += 1) {
					htmlEndLine = k;
					if (
						htmlBlockLineCloses(
							unclosedType,
							maskedSliceForLines(mathIndex, lines, k, k),
						)
					) {
						break;
					}
				}
				const htmlEndOffset = mathIndex.lineEnds[htmlEndLine] ?? spanEndOffset;
				if (emittedAny) {
					pushOutputLine("", null);
				}
				pushOutputLine(
					addProtectedBlock(
						"raw",
						mathIndex.normalized.slice(rawTrimStart, htmlEndOffset),
					),
					null,
				);
				return {
					activeTable: null,
					activeTableOutputStart: -1,
					afterStartOffset: htmlEndOffset,
					emittedTableBeforeRow,
					spanEndLine: htmlEndLine,
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
						false,
						-1,
						gapMathRanges,
					),
					null,
				);
			}
			emittedAny = true;
		}
		isFirstDisplayMath = false;

		if (emittedAny) {
			pushOutputLine("", null);
		}
		const mathToken = addProtectedBlock(
			"math",
			mathIndex.normalized.slice(nextDisplay.from, nextDisplay.to),
		);
		pushOutputLine(mathToken, null);
		emittedAny = true;
		cursorOffset = nextDisplay.to;
		extendSpanForDisplayMath(nextDisplay);
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

	return {
		activeTable: postResult.activeTable,
		activeTableOutputStart: postResult.activeTableOutputStart,
		afterStartOffset,
		emittedTableBeforeRow,
		spanEndLine: postResult.spanEndLine,
		trailingParagraphState: postResult.trailingParagraphState,
	};
}

/**
 * Splits a display-math-bearing line (`$$...$$` / `\[...\]`) that breaks an
 * active GFM table, mirroring PHP `MarkdownRenderer::extract_math()` replacing
 * display math with `"\n\n" . $token . "\n\n"`, and evaluates post-math HTML
 * blocks, fenced code blocks, and follow-up GFM tables cleanly.
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
 * precedes a GFM table delimiter line, mirroring PHP `MarkdownRenderer::extract_math()`
 * (`\n\n<token>\n\n`) and evaluating post-math HTML blocks, fenced code blocks,
 * and GFM table matching cleanly. Returns `null` for lines without display math,
 * lines whose leading segment opens an unclosed Type 1–5 HTML block, standalone
 * single display-math blocks, or lines not followed by a valid GFM delimiter.
 */
export function emitDisplayMathHeaderLine(
	env: DisplayMathEmitEnv,
	lineIndex: number,
	beforeHtmlContext: BeforeHtmlContext,
): DisplayMathSplitResult | null {
	const { lines, mathIndex } = env;
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
	const maskedFirstBefore = mathIndex.maskedDoc.slice(
		lineStartOffset,
		firstDisplay.from,
	);
	if (
		matchUnclosedHtmlBlockTypes1To5(
			maskedFirstBefore,
			beforeHtmlContext,
			false,
		) !== null
	) {
		return null;
	}

	const ranges = mathIndex.ranges;
	let spanEndOffset = mathIndex.lineEnds[spanEndLine] ?? lineStartOffset;
	let scanIdx = firstMathRangeEndingAfter(ranges, lineStartOffset);
	let displayCount = 0;
	let lastDisplayTo = -1;

	while (scanIdx < ranges.length) {
		const range = ranges[scanIdx];
		if (!range || range.from >= spanEndOffset) {
			break;
		}
		if (range.block && range.from >= lineStartOffset) {
			lastDisplayTo = range.to;
			displayCount += 1;
			if (range.to > spanEndOffset) {
				const rangeEndLine = findLineIndexForOffset(
					mathIndex,
					Math.max(range.from, range.to - 1),
				);
				const extended = findLogicalLineEnd(mathIndex, rangeEndLine);
				if (extended > spanEndLine) {
					spanEndLine = extended;
					spanEndOffset = mathIndex.lineEnds[spanEndLine] ?? spanEndOffset;
				}
			}
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
			null
	) {
		return null;
	}

	// Leave a standalone single display-math block (nothing non-blank before or
	// after) to `findBlockMathEnd` so it keeps its exact source line range.
	if (
		displayCount === 1 &&
		isCommonMarkBlankLine(firstBefore) &&
		isCommonMarkBlankLine(
			mathIndex.normalized.slice(lastDisplayTo, spanEndOffset),
		)
	) {
		return null;
	}

	const maskedDelimiter = maskedSliceForLines(
		mathIndex,
		lines,
		delimiterLine,
		delimiterLine,
	);
	const delimiterPeeled = peelContainerStepsForLine(
		maskedDelimiter,
		[],
		0,
		true,
		true,
	);
	if (
		delimiterPeeled === null ||
		measureIndentColumns(delimiterPeeled.rest, delimiterPeeled.column) >= 4 ||
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

/**
 * Splits a multiline-`\(...\)` logical line (`lineIndex..logicalEnd`) that also
 * contains a multiline display-math block (`$$...$$` / `\[...\]` extending past
 * `lineEndOffset`), keeping single-line mid-line `$$...$$` inline as before.
 */
export function emitDisplayMathLogicalLine(
	env: DisplayMathEmitEnv,
	lineIndex: number,
	logicalEnd: number,
	beforeHtmlContext: BeforeHtmlContext,
): DisplayMathSplitResult | null {
	const { mathIndex } = env;
	const lineStartOffset = mathIndex.lineStarts[lineIndex] ?? 0;
	const lineEndOffset = mathIndex.lineEnds[logicalEnd] ?? lineStartOffset;
	let hasMultilineDisplay = false;
	for (
		let idx = firstMathRangeEndingAfter(mathIndex.ranges, lineStartOffset);
		idx < mathIndex.ranges.length;
		idx += 1
	) {
		const range = mathIndex.ranges[idx];
		if (!range || range.from >= lineEndOffset) {
			break;
		}
		if (
			range.block &&
			range.from >= lineStartOffset &&
			range.to > lineEndOffset
		) {
			hasMultilineDisplay = true;
			break;
		}
	}
	if (!hasMultilineDisplay) {
		return null;
	}
	return emitDisplayMathLineSegments(
		env,
		lineIndex,
		logicalEnd,
		null,
		beforeHtmlContext,
	);
}
