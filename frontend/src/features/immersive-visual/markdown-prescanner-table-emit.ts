import {
	COMMONMARK_FENCE_OPEN_WITH_INFO,
	htmlBlockLineCloses,
	matchHtmlBlockOpen,
	parseGfmTableSeparatorColumns,
} from "../../shared/markdown/php-commonmark-block-helpers";
import type { PhpMarkdownMathRange } from "../../shared/markdown/php-markdown-math-mask";
import {
	type ContainerStep,
	type DetectableFence,
	findCommonMarkHtmlBlockEnd,
	findContainerBoundedFenceEnd,
	isCommonMarkBlankLine,
	measureIndentColumns,
	stripContainers,
	stripContainersWithColumn,
} from "./markdown-prescanner-blocks";
import {
	extractInlineProtectedSyntax,
	type ProtectedInlineEntry,
} from "./markdown-prescanner-inline";
import {
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

export type DisplayMathSplitResult = Readonly<{
	activeTable: GfmTableMatch | null;
	activeTableOutputStart: number;
	afterStartOffset: number;
	emittedTableBeforeRow: boolean;
	spanEndLine: number;
}>;

type BeforeHtmlContext = Readonly<{
	allowLeadingListMarker: boolean;
	baseContainers: ReadonlyArray<ContainerStep>;
	inParagraph: boolean;
	preMarkerListIndent: number;
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
 * Emits one active table body row (joining physical lines bridged by multiline
 * `\(...\)` and normalizing lazy container prefixes so `markdown-it` keeps the
 * row inside the table matching PHP `League\CommonMark`). Returns the next
 * physical line index to visit.
 */
export function emitActiveTableRow(
	lineIndex: number,
	activeTable: GfmTableMatch,
	mathIndex: PhpDocumentMathIndex,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	pushOutputLine: TableEmitCallbacks["pushOutputLine"],
): number {
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
 * Reports whether `beforeText` opens an unclosed CommonMark §4.6 Type 1–5 HTML
 * block (`<!--`, `<pre>`, `<script>`, `<style>`, `<textarea>`, `<?`, `<!`,
 * `<![CDATA[`), which in PHP does NOT close on `\n\n` and therefore swallows
 * following display math instead of splitting.
 */
function opensUnclosedHtmlBlockTypes1To5(
	beforeText: string,
	context: BeforeHtmlContext,
): boolean {
	const peeled = peelContainerStepsForLine(
		beforeText,
		context.baseContainers,
		context.preMarkerListIndent,
		context.allowLeadingListMarker,
		true,
	);
	if (
		peeled === null ||
		measureIndentColumns(peeled.rest, peeled.column) >= 4
	) {
		return false;
	}
	const trimmed = peeled.rest.replace(/^[ \t]+/, "");
	const htmlType = matchHtmlBlockOpen(trimmed, false);
	return (
		htmlType !== null &&
		htmlType <= 5 &&
		!htmlBlockLineCloses(htmlType as 1 | 2 | 3 | 4 | 5, trimmed)
	);
}

/**
 * If a non-table segment immediately preceding `\n\n<MATH>\n\n` opens a
 * self-contained HTML block (Type 6/7 closed by `\n\n` or single-line closed
 * Type 1–5), emits it as a `protected_block("raw")` and returns `true`.
 */
function tryEmitStandaloneBeforeHtmlBlock(
	beforeText: string,
	context: BeforeHtmlContext,
	callbacks: TableEmitCallbacks,
): boolean {
	if (!beforeText.includes("<")) {
		return false;
	}
	const peeled = peelContainerStepsForLine(
		beforeText,
		context.baseContainers,
		context.preMarkerListIndent,
		context.allowLeadingListMarker,
		true,
	);
	if (
		peeled === null ||
		measureIndentColumns(peeled.rest, peeled.column) >= 4
	) {
		return false;
	}
	const trimmed = peeled.rest.replace(/^[ \t]+/, "");
	if (!trimmed.startsWith("<")) {
		return false;
	}
	const baseContainerCount =
		context.baseContainers.length + (context.preMarkerListIndent > 0 ? 1 : 0);
	const effectiveInParagraph =
		context.inParagraph && peeled.containers.length === baseContainerCount;
	const htmlType = matchHtmlBlockOpen(trimmed, !effectiveInParagraph);
	if (htmlType === null) {
		return false;
	}
	const token = callbacks.addProtectedBlock("raw", trimmed);
	callbacks.pushOutputLine(`${peeled.linePrefix}${token}`, null);
	return true;
}

/**
 * Evaluates and emits the trailing segment after the final display-math block
 * on `spanEndLine`:
 * 1. CommonMark HTML block (Types 1–7), consuming continuation lines;
 * 2. CommonMark fenced code block (including Mermaid), consuming through close;
 * 3. GFM table header validated by `matchPeeledGfmTableHeader`, handing off
 *    `activeTable` / `activeTableOutputStart` to `markdown-prescanner.ts`;
 * 4. Normal inline line fallback.
 */
function emitPostDisplayMathSegment(
	lines: ReadonlyArray<string>,
	spanEndLine: number,
	afterStartOffset: number,
	spanEndOffset: number,
	afterInlineRanges: ReadonlyArray<PhpMarkdownMathRange> | null,
	mathIndex: PhpDocumentMathIndex,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	callbacks: TableEmitCallbacks,
	getOutputLength: () => number,
): Readonly<{
	activeTable: GfmTableMatch | null;
	activeTableOutputStart: number;
	spanEndLine: number;
}> {
	if (afterStartOffset >= spanEndOffset) {
		return {
			activeTable: null,
			activeTableOutputStart: -1,
			spanEndLine,
		};
	}
	const rawAfter = mathIndex.normalized.slice(afterStartOffset, spanEndOffset);
	if (isCommonMarkBlankLine(rawAfter)) {
		return {
			activeTable: null,
			activeTableOutputStart: -1,
			spanEndLine,
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
				};
			}
		}
	}

	// 4. Plain non-table trailing segment.
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
			false,
			-1,
			afterMathRanges,
		),
		null,
	);
	return {
		activeTable: null,
		activeTableOutputStart: -1,
		spanEndLine,
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
	lines: ReadonlyArray<string>,
	lineIndex: number,
	initialSpanEndLine: number,
	tableContainers: ReadonlyArray<ContainerStep> | null,
	beforeHtmlContext: BeforeHtmlContext | null,
	mathIndex: PhpDocumentMathIndex,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	callbacks: TableEmitCallbacks,
	getOutputLength: () => number,
): DisplayMathSplitResult {
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
			if (emittedAny) {
				pushOutputLine("", null);
			}
			const emittedAsHtmlBlock =
				isFirstDisplayMath &&
				beforeHtmlContext !== null &&
				tryEmitStandaloneBeforeHtmlBlock(
					beforeText,
					beforeHtmlContext,
					callbacks,
				);
			if (!emittedAsHtmlBlock) {
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

		if (nextDisplay.to > spanEndOffset) {
			const rangeEndLine = findLineIndexForOffset(
				mathIndex,
				Math.max(nextDisplay.from, nextDisplay.to - 1),
			);
			const extendedEndLine = findLogicalLineEnd(mathIndex, rangeEndLine);
			if (extendedEndLine > spanEndLine) {
				spanEndLine = extendedEndLine;
				spanEndOffset = mathIndex.lineEnds[spanEndLine] ?? spanEndOffset;
			}
		}
	}

	pushOutputLine("", null);
	const afterStartOffset = cursorOffset;
	const postResult = emitPostDisplayMathSegment(
		lines,
		spanEndLine,
		afterStartOffset,
		spanEndOffset,
		afterInlineRanges,
		mathIndex,
		sentinel,
		protectedInlines,
		callbacks,
		getOutputLength,
	);

	return {
		activeTable: postResult.activeTable,
		activeTableOutputStart: postResult.activeTableOutputStart,
		afterStartOffset,
		emittedTableBeforeRow,
		spanEndLine: postResult.spanEndLine,
	};
}

/**
 * Splits a display-math-bearing line (`$$...$$` / `\[...\]`) that breaks an
 * active GFM table, mirroring PHP `MarkdownRenderer::extract_math()` replacing
 * display math with `"\n\n" . $token . "\n\n"`, and evaluates post-math HTML
 * blocks, fenced code blocks, and follow-up GFM tables cleanly.
 */
export function emitDisplayMathTableBreak(
	lines: ReadonlyArray<string>,
	lineIndex: number,
	tableContainers: ReadonlyArray<ContainerStep>,
	mathIndex: PhpDocumentMathIndex,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	callbacks: TableEmitCallbacks,
	getOutputLength: () => number,
): DisplayMathSplitResult {
	const initialSpanEndLine = findLogicalLineEnd(mathIndex, lineIndex);
	return emitDisplayMathLineSegments(
		lines,
		lineIndex,
		initialSpanEndLine,
		tableContainers,
		null,
		mathIndex,
		sentinel,
		protectedInlines,
		callbacks,
		getOutputLength,
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
	lines: ReadonlyArray<string>,
	lineIndex: number,
	baseContainers: ReadonlyArray<ContainerStep>,
	preMarkerListIndent: number,
	allowLeadingListMarker: boolean,
	inParagraph: boolean,
	mathIndex: PhpDocumentMathIndex,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	callbacks: TableEmitCallbacks,
	getOutputLength: () => number,
): DisplayMathSplitResult | null {
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

	const beforeHtmlContext: BeforeHtmlContext = {
		allowLeadingListMarker,
		baseContainers,
		inParagraph,
		preMarkerListIndent,
	};
	const firstBefore = mathIndex.normalized.slice(
		lineStartOffset,
		firstDisplay.from,
	);
	if (opensUnclosedHtmlBlockTypes1To5(firstBefore, beforeHtmlContext)) {
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
		lines,
		lineIndex,
		spanEndLine,
		null,
		beforeHtmlContext,
		mathIndex,
		sentinel,
		protectedInlines,
		callbacks,
		getOutputLength,
	);
}
