import {
	countTableRowCells,
	parseGfmTableSeparatorColumns,
} from "../../shared/markdown/php-commonmark-block-helpers";
import {
	type ContainerStep,
	isCommonMarkBlankLine,
	matchListMarker,
	measureIndentColumns,
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
	type PhpDocumentMathIndex,
	peelContainerStepsForLine,
	stripPartialContainers,
} from "./markdown-prescanner-tables";
import type { ProtectedBlockKind } from "./visual-schema";

/**
 * Feature-private GFM table row and display-math table break/header emitters
 * for `markdown-prescanner.ts`, mirroring PHP `MarkdownRenderer::extract_math()`
 * (`"\n\n" . $token . "\n\n"` for display math) in strictly O(N) time.
 */

export type TableEmitCallbacks = Readonly<{
	addProtectedBlock: (kind: ProtectedBlockKind, rawMarkdown: string) => string;
	pushOutputLine: (
		text: string,
		range: Readonly<{ end: number; start: number }> | null,
	) => void;
}>;

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
 * Splits a display-math-bearing line (`$$...$$` / `\[...\]`) that breaks an
 * active GFM table, mirroring PHP `MarkdownRenderer::extract_math()` replacing
 * display math with `"\n\n" . $token . "\n\n"`.
 */
export function emitDisplayMathTableBreak(
	lineIndex: number,
	tableContainers: ReadonlyArray<ContainerStep>,
	mathIndex: PhpDocumentMathIndex,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	callbacks: TableEmitCallbacks,
): Readonly<{ emittedTableBeforeRow: boolean; spanEndLine: number }> {
	const { addProtectedBlock, pushOutputLine } = callbacks;
	const ranges = mathIndex.ranges;
	let cursorOffset = mathIndex.lineStarts[lineIndex] ?? 0;
	let spanEndLine = findLogicalLineEnd(mathIndex, lineIndex);
	let spanEndOffset = mathIndex.lineEnds[spanEndLine] ?? cursorOffset;
	let rangeIdx = firstMathRangeEndingAfter(ranges, cursorOffset);
	let emittedTableBeforeRow = false;
	let isFirstDisplayMath = true;

	while (cursorOffset <= spanEndOffset) {
		while (rangeIdx < ranges.length) {
			const candidate = ranges[rangeIdx];
			if (!candidate || candidate.from >= spanEndOffset) {
				break;
			}
			if (candidate.block && candidate.from >= cursorOffset) {
				break;
			}
			rangeIdx += 1;
		}
		const nextDisplay = ranges[rangeIdx];
		if (
			!nextDisplay ||
			nextDisplay.from >= spanEndOffset ||
			!nextDisplay.block ||
			nextDisplay.from < cursorOffset
		) {
			break;
		}
		rangeIdx += 1;

		const beforeText = mathIndex.normalized.slice(
			cursorOffset,
			nextDisplay.from,
		);
		if (isFirstDisplayMath) {
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
					const beforeMathRanges = collectRelativeInlineMathRanges(
						mathIndex,
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
					const beforeMathRanges = collectRelativeInlineMathRanges(
						mathIndex,
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
			isFirstDisplayMath = false;
		} else if (!isCommonMarkBlankLine(beforeText)) {
			pushOutputLine("", null);
			const midMathRanges = collectRelativeInlineMathRanges(
				mathIndex,
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
					midMathRanges,
				),
				null,
			);
		}

		pushOutputLine("", null);
		const mathToken = addProtectedBlock(
			"math",
			mathIndex.normalized.slice(nextDisplay.from, nextDisplay.to),
		);
		pushOutputLine(mathToken, null);
		cursorOffset = nextDisplay.to;
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

	pushOutputLine("", null);
	if (cursorOffset < spanEndOffset) {
		const afterText = mathIndex.normalized.slice(cursorOffset, spanEndOffset);
		if (!isCommonMarkBlankLine(afterText)) {
			const afterMathRanges = collectRelativeInlineMathRanges(
				mathIndex,
				cursorOffset,
				spanEndOffset,
			);
			pushOutputLine(
				extractInlineProtectedSyntax(
					afterText,
					sentinel,
					protectedInlines,
					false,
					false,
					-1,
					afterMathRanges,
				),
				null,
			);
		}
	}

	return { emittedTableBeforeRow, spanEndLine };
}

export type DisplayMathHeaderBreakResult = Readonly<{
	activeTable: GfmTableMatch | null;
	activeTableOutputStart: number;
	spanEndLine: number;
}>;

/**
 * Splits a display-math-bearing line (`$$...$$` / `\[...\]`) that immediately
 * precedes a GFM table delimiter line, mirroring PHP `MarkdownRenderer::extract_math()`
 * (`\n\n<token>\n\n`) and evaluating table matching cleanly on the post-math
 * segment. Returns `null` for lines without display math, standalone single
 * display-math blocks (handled with exact source ranges by `findBlockMathEnd`),
 * or lines not followed by a valid GFM delimiter line.
 */
export function emitDisplayMathHeaderLine(
	lines: ReadonlyArray<string>,
	lineIndex: number,
	mathIndex: PhpDocumentMathIndex,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	callbacks: TableEmitCallbacks,
	getOutputLength: () => number,
): DisplayMathHeaderBreakResult | null {
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

	const ranges = mathIndex.ranges;
	let spanEndOffset = mathIndex.lineEnds[spanEndLine] ?? lineStartOffset;
	let scanIdx = firstMathRangeEndingAfter(ranges, lineStartOffset);
	let displayCount = 0;
	let firstDisplayFrom = -1;
	let lastDisplayTo = -1;

	while (scanIdx < ranges.length) {
		const range = ranges[scanIdx];
		if (!range || range.from >= spanEndOffset) {
			break;
		}
		if (range.block && range.from >= lineStartOffset) {
			if (firstDisplayFrom < 0) {
				firstDisplayFrom = range.from;
			}
			lastDisplayTo = range.to;
			displayCount += 1;
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
		isCommonMarkBlankLine(
			mathIndex.normalized.slice(lineStartOffset, firstDisplayFrom),
		) &&
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

	const { addProtectedBlock, pushOutputLine } = callbacks;
	let cursorOffset = lineStartOffset;
	let rangeIdx = firstMathRangeEndingAfter(ranges, cursorOffset);
	let emittedAny = false;

	while (cursorOffset <= spanEndOffset) {
		while (rangeIdx < ranges.length) {
			const candidate = ranges[rangeIdx];
			if (!candidate || candidate.from >= spanEndOffset) {
				break;
			}
			if (candidate.block && candidate.from >= cursorOffset) {
				break;
			}
			rangeIdx += 1;
		}
		const nextDisplay = ranges[rangeIdx];
		if (
			!nextDisplay ||
			nextDisplay.from >= spanEndOffset ||
			!nextDisplay.block ||
			nextDisplay.from < cursorOffset
		) {
			break;
		}
		rangeIdx += 1;

		const beforeText = mathIndex.normalized.slice(
			cursorOffset,
			nextDisplay.from,
		);
		if (!isCommonMarkBlankLine(beforeText)) {
			if (emittedAny) {
				pushOutputLine("", null);
			}
			const beforeMathRanges = collectRelativeInlineMathRanges(
				mathIndex,
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
					beforeMathRanges,
				),
				null,
			);
			emittedAny = true;
		}

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
	}

	pushOutputLine("", null);

	let nextActiveTable: GfmTableMatch | null = null;
	let activeTableOutputStart = -1;

	if (cursorOffset < spanEndOffset) {
		const afterText = mathIndex.normalized.slice(cursorOffset, spanEndOffset);
		if (!isCommonMarkBlankLine(afterText)) {
			const maskedAfter = mathIndex.maskedDoc.slice(
				cursorOffset,
				spanEndOffset,
			);
			const afterPeeled = peelContainerStepsForLine(
				maskedAfter,
				[],
				0,
				true,
				true,
			);
			if (
				afterPeeled !== null &&
				measureIndentColumns(afterPeeled.rest, afterPeeled.column) < 4 &&
				afterPeeled.rest.includes("|")
			) {
				const delimiterStripped = stripContainersWithColumn(
					maskedDelimiter,
					afterPeeled.containers,
				);
				if (
					delimiterStripped !== null &&
					measureIndentColumns(
						delimiterStripped.rest,
						delimiterStripped.column,
					) < 4 &&
					matchListMarker(delimiterStripped.rest, delimiterStripped.column) ===
						null
				) {
					const delimiterColumns = parseGfmTableSeparatorColumns(
						delimiterStripped.rest,
					);
					if (
						delimiterColumns > 0 &&
						countTableRowCells(afterPeeled.rest) === delimiterColumns
					) {
						const tableEnd = findGfmTableEnd(
							lines,
							delimiterLine,
							afterPeeled.containers,
							mathIndex,
						);
						nextActiveTable = {
							brokenByDisplayMathLine: tableEnd.brokenByDisplayMathLine,
							containers: afterPeeled.containers,
							delimiterLine,
							endLine: tableEnd.endLine,
							headerEndLine: spanEndLine,
							lazyRowStartLines: tableEnd.lazyRowStartLines,
						};
						activeTableOutputStart = getOutputLength();
					}
				}
			}

			const afterMathRanges = collectRelativeInlineMathRanges(
				mathIndex,
				cursorOffset,
				spanEndOffset,
			);
			pushOutputLine(
				extractInlineProtectedSyntax(
					afterText,
					sentinel,
					protectedInlines,
					nextActiveTable !== null,
					false,
					-1,
					afterMathRanges,
				),
				null,
			);
		}
	}

	return {
		activeTable: nextActiveTable,
		activeTableOutputStart,
		spanEndLine,
	};
}
