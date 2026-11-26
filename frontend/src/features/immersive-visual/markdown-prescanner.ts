import { matchHtmlBlockOpen } from "../../shared/markdown/php-commonmark-block-helpers";
import {
	advanceParagraphReferenceParser,
	createParagraphReferenceParser,
	type ParagraphReferenceParser,
} from "../../shared/markdown/php-commonmark-reference-def";
import {
	analyzeLine,
	type ContainerStep,
	classifyParagraphLine,
	detectFence,
	findContainerBoundedFenceEnd,
	findFootnoteDefinitionEnd,
	hasListBeforeQuote,
	isCommonMarkBlankLine,
	matchListPrefixedHtmlBlock,
	resolveLineContainerContext,
	sumListContainerIndent,
} from "./markdown-prescanner-blocks";
import {
	createPrescanPhpTracker,
	type HtmlBlockScanResult,
	scanHtmlBlockWithDisplayMath,
} from "./markdown-prescanner-display-math";
import {
	extractInlineProtectedSyntax,
	type ProtectedInlineEntry,
} from "./markdown-prescanner-inline";
import {
	createCollisionFreeSentinel,
	createPrescanOutput,
	type PrescannedLineRange,
	type ProtectedBlockEntry,
} from "./markdown-prescanner-output";
import {
	type DisplayMathEmitEnv,
	type DisplayMathSplitResult,
	emitActiveTableRow,
	emitDisplayMathHeaderLine,
	emitDisplayMathLineSegments,
	emitDisplayMathLogicalLine,
	emitDisplayMathTableBreak,
	emitTableHeaderRow,
} from "./markdown-prescanner-table-emit";
import {
	collectRelativeInlineMathRanges,
	findFirstDisplayMathInLines,
	findLogicalLineEnd,
	type GfmTableMatch,
	maskedSliceForLines,
	matchTableAlignmentMarkerLine,
	resolveGfmTableMatch,
} from "./markdown-prescanner-tables";
import {
	TABLE_ALIGN_PREFIX,
	TABLE_ALIGN_SUFFIX,
} from "./table-alignment-codec";

export {
	ATX_HEADING,
	analyzeLine,
	type DetectableFence,
	detectFence,
	isCommonMarkBlankLine,
	isFenceCloser,
	type LineAnalysis,
	readBlockquotePrefix,
	SETEXT_UNDERLINE,
	stripBlockquoteDepth,
	THEMATIC_BREAK,
} from "./markdown-prescanner-blocks";
export { restoreProtectedInlineSentinels } from "./markdown-prescanner-output";
export type { ProtectedInlineEntry };
export { TABLE_ALIGN_PREFIX, TABLE_ALIGN_SUFFIX };

export type PreScanResult = Readonly<{
	lineEnding: "\n" | "\r\n";
	markdown: string;
	outputLineRanges: ReadonlyArray<PrescannedLineRange | null>;
	outputLineSharedRanges: ReadonlyArray<PrescannedLineRange | null>;
	outputLines: ReadonlyArray<string>;
	protectedBlocks: ReadonlyMap<string, ProtectedBlockEntry>;
	protectedInlines: ReadonlyMap<string, ProtectedInlineEntry>;
	rawLines: ReadonlyArray<string>;
	sentinel: string;
	tableAlignMarkers: ReadonlyMap<string, string>;
}>;

const EMPTY_CONTAINERS: ReadonlyArray<ContainerStep> = [];

export const FOOTNOTE_DEF_LINE = /^ {0,3}\[\^([^\s\]]+)\]:(?:[ \t]|$)/;

export function prescanMarkdown(rawMarkdown: string): PreScanResult {
	const lineEnding: "\n" | "\r\n" = rawMarkdown.includes("\r\n")
		? "\r\n"
		: "\n";
	const normalized = rawMarkdown.replace(/\r\n?/g, "\n");
	const sentinel = createCollisionFreeSentinel(normalized);
	const lines = normalized.split("\n");
	const protectedInlines = new Map<string, ProtectedInlineEntry>();
	const output = createPrescanOutput(lines, sentinel);
	const {
		addProtectedBlock,
		addTableAlignMarker,
		markSharedOutputSpan,
		outputLineRanges,
		outputLineSharedRanges,
		outputLines,
		pushOutputLine,
		pushProtectedBlock,
	} = output;
	const php = createPrescanPhpTracker(normalized, lines);
	const { mathIndex, state: phpBlockState } = php;
	const getMaskedLine = (lineIdx: number): string =>
		maskedSliceForLines(mathIndex, lines, lineIdx, lineIdx);
	const advancePhpStateRange = php.advanceRange;
	const advancePhpStateMaskedLines = php.advanceMaskedLines;
	const advancePhpStateClosedBlock = php.advanceClosedBlock;

	let i = 0;
	let inIndentedCode = false;
	let indentedCodeContainer = 0;
	let listContentIndent: number | null = null;
	let inRestoredDisplayMathContainer = false;
	let paragraphOpen = false;
	let paragraphHasContent = false;
	let paragraphHasPipe = false;
	let paragraphQuoteDepth = 0;
	let paragraphRefParser: ParagraphReferenceParser | null = null;
	let activeTable: GfmTableMatch | null = null;
	let activeTableOutputStart = -1;
	let pendingTableAlignOutputIndex = -1;

	const closeParagraph = (): void => {
		paragraphOpen = false;
		paragraphHasContent = false;
		paragraphHasPipe = false;
		paragraphRefParser = null;
	};
	const clearDroppedList = (dropped: boolean): void => {
		if (!dropped) return;
		listContentIndent = null;
		inRestoredDisplayMathContainer = false;
	};
	const syncNestedListIndent = (
		containers: ReadonlyArray<ContainerStep>,
		dropped: boolean,
	): void => {
		if (hasListBeforeQuote(containers)) return;
		const nestedListIndent = sumListContainerIndent(containers);
		if (nestedListIndent > 0) listContentIndent = nestedListIndent;
		else clearDroppedList(dropped);
	};

	const displayMathEnv: DisplayMathEmitEnv = {
		callbacks: { addProtectedBlock, addTableAlignMarker, pushOutputLine },
		getOutputLength: () => outputLines.length,
		hasPrecedingContent: () =>
			outputLines.length > 0 &&
			!isCommonMarkBlankLine(outputLines[outputLines.length - 1] ?? ""),
		lines,
		mathIndex,
		protectedInlines,
		sentinel,
	};

	const applyDisplayMathSplitState = (result: DisplayMathSplitResult): void => {
		activeTable = result.activeTable;
		activeTableOutputStart = result.activeTableOutputStart;
		pendingTableAlignOutputIndex = -1;
		const trailing = result.trailingParagraphState;
		if (trailing !== null) {
			inIndentedCode = trailing.inIndentedCode;
			indentedCodeContainer = trailing.indentedCodeContainer;
			listContentIndent = trailing.listContentIndent;
			paragraphOpen = trailing.paragraphOpen;
			paragraphHasContent = trailing.paragraphHasContent;
			paragraphHasPipe = trailing.paragraphHasPipe;
			paragraphQuoteDepth = trailing.paragraphQuoteDepth;
			paragraphRefParser = trailing.paragraphRefParser;
			inRestoredDisplayMathContainer =
				trailing.listContentIndent !== null || trailing.paragraphQuoteDepth > 0;
		} else {
			closeParagraph();
			inIndentedCode = false;
			const containerSteps = activeTable?.containers ?? result.openedContainers;
			if (containerSteps !== null && !hasListBeforeQuote(containerSteps)) {
				const nestedListIndent = sumListContainerIndent(containerSteps);
				listContentIndent = nestedListIndent > 0 ? nestedListIndent : null;
			} else {
				listContentIndent = null;
			}
			inRestoredDisplayMathContainer = listContentIndent !== null;
		}
		php.advanceAfterDisplayMath(result.afterStartOffset, result.spanEndLine);
		i = result.spanEndLine + 1;
	};

	const emitHtmlScanResult = (
		linePrefix: string,
		htmlScan: HtmlBlockScanResult,
		origStart: number,
		onComplete: () => void,
	): void => {
		if (htmlScan.kind === "break") {
			const splitOutStart = outputLines.length;
			pushOutputLine(
				`${linePrefix}${addProtectedBlock("raw", htmlScan.rawHtml)}`,
				null,
			);
			const splitResult = emitDisplayMathLineSegments(
				displayMathEnv,
				htmlScan.resumeLine,
				findLogicalLineEnd(mathIndex, htmlScan.resumeLine),
				null,
				null,
				htmlScan.resumeOffset,
				true,
			);
			markSharedOutputSpan(splitOutStart, origStart, splitResult.spanEndLine + 1);
			applyDisplayMathSplitState(splitResult);
			return;
		}
		pushOutputLine(
			`${linePrefix}${addProtectedBlock("raw", htmlScan.rawHtml)}`,
			{ end: htmlScan.endLine + 1, start: origStart },
		);
		onComplete();
		closeParagraph();
		advancePhpStateMaskedLines(origStart, htmlScan.endLine);
		i = htmlScan.endLine + 1;
	};

	while (i < lines.length) {
		if (activeTable !== null && i <= activeTable.endLine) {
			if (i === activeTable.delimiterLine) {
				pushOutputLine(lines[i] ?? "", { end: i + 1, start: i });
				advancePhpStateMaskedLines(i, i);
				i += 1;
				continue;
			}
			const logicalEnd = emitActiveTableRow(displayMathEnv, i, activeTable);
			advancePhpStateMaskedLines(i, logicalEnd);
			i = logicalEnd + 1;
			continue;
		}

		if (activeTable !== null && i === activeTable.brokenByDisplayMathLine) {
			const splitOutStart = outputLines.length;
			const breakResult = emitDisplayMathTableBreak(
				displayMathEnv,
				i,
				activeTable.containers,
			);
			if (breakResult.emittedTableBeforeRow && activeTableOutputStart >= 0) {
				const invalidateEnd =
					breakResult.activeTableOutputStart >= 0
						? breakResult.activeTableOutputStart
						: outputLineRanges.length;
				const tableRawStart =
					outputLineRanges[activeTableOutputStart]?.start ??
					outputLineSharedRanges[activeTableOutputStart]?.start ??
					-1;
				for (let idx = activeTableOutputStart; idx < invalidateEnd; idx += 1) {
					outputLineRanges[idx] = null;
				}
				if (tableRawStart >= 0) {
					markSharedOutputSpan(
						activeTableOutputStart,
						tableRawStart,
						breakResult.spanEndLine + 1,
					);
				}
			} else {
				markSharedOutputSpan(splitOutStart, i, breakResult.spanEndLine + 1);
			}
			applyDisplayMathSplitState(breakResult);
			continue;
		}

		if (activeTable !== null) {
			activeTable = null;
			activeTableOutputStart = -1;
		}

		const line = lines[i] ?? "";
		const baseAnalysis = analyzeLine(line, listContentIndent ?? 0);
		const isBlank = isCommonMarkBlankLine(line);

		if (inIndentedCode) {
			if (isBlank || baseAnalysis.indent - indentedCodeContainer >= 4) {
				pushOutputLine(line, { end: i + 1, start: i });
				advancePhpStateRange(i, i);
				i += 1;
				continue;
			}
			inIndentedCode = false;
		}

		if (isBlank) {
			pushOutputLine(line, { end: i + 1, start: i });
			closeParagraph();
			inIndentedCode = false;
			advancePhpStateRange(i, i);
			listContentIndent = php.listIndentAfterBlank(listContentIndent);
			if (listContentIndent === null) inRestoredDisplayMathContainer = false;
			i += 1;
			continue;
		}

		const ctx = resolveLineContainerContext(
			line,
			baseAnalysis,
			phpBlockState,
			listContentIndent,
			paragraphOpen,
			paragraphHasContent,
			paragraphQuoteDepth,
		);
		if (ctx.clearParagraph) closeParagraph();
		else {
			paragraphOpen = ctx.nextParagraphOpen;
			paragraphHasContent = ctx.nextParagraphHasContent;
		}
		listContentIndent = ctx.nextListContentIndent;
		if (listContentIndent === null && ctx.droppedOutOfList && !paragraphOpen) {
			inRestoredDisplayMathContainer = false;
		}
		const {
			acceptedListMarker,
			activeInterleavedContainers,
			analysis,
			continuesListItem,
			droppedOutOfList,
			effectiveContainer,
			hasInterleavedContainers,
			lineQuoteDepth,
			listInterruptionInParagraph,
			preMarkerContainerIndent,
			prevContainerIndent,
			prevListIndent,
		} = ctx;
		const relativeIndent = analysis.indent - effectiveContainer;

		// 1. Indented code blocks can only start when no paragraph is open.
		//    PHP `extract_math()` runs first: a display-math span the
		//    authoritative math index found here (no PHP block code range
		//    covers it) is never indented code.
		if (
			!paragraphOpen &&
			relativeIndent >= 4 &&
			!php.startsDisplayMath(analysis.content, i)
		) {
			inIndentedCode = true;
			indentedCodeContainer = effectiveContainer;
			clearDroppedList(droppedOutOfList);
			pushOutputLine(line, { end: i + 1, start: i });
			advancePhpStateRange(i, i);
			i += 1;
			continue;
		}

		// 2. Fenced code blocks (container aware: blockquotes and list items).
		const fence = detectFence(
			analysis,
			activeInterleavedContainers ?? undefined,
		);
		if (fence) {
			const blockEnd = findContainerBoundedFenceEnd(lines, i, fence);
			const lang = (fence.info.trim().split(/\s+/)[0] ?? "").toLowerCase();
			if (
				lang === "mermaid" &&
				acceptedListMarker === null &&
				activeInterleavedContainers === null &&
				fence.quoteDepth === analysis.quoteDepth
			) {
				pushProtectedBlock("mermaid", analysis, i, blockEnd);
			} else {
				for (let k = i; k <= blockEnd; k += 1) {
					pushOutputLine(lines[k] ?? "", { end: k + 1, start: k });
				}
			}
			clearDroppedList(droppedOutOfList);
			closeParagraph();
			pendingTableAlignOutputIndex = -1;
			advancePhpStateRange(i, blockEnd);
			i = blockEnd + 1;
			continue;
		}

		const tableBaseContainers: ReadonlyArray<ContainerStep> =
			activeInterleavedContainers !== null
				? activeInterleavedContainers
				: lineQuoteDepth === 0
					? EMPTY_CONTAINERS
					: Array.from({ length: lineQuoteDepth }, () => ({
							kind: "blockquote" as const,
						}));
		const tablePreListIndent =
			activeInterleavedContainers !== null ? 0 : preMarkerContainerIndent;

		// 3. EasyMDE table alignment annotation directly preceding a GFM table.
		const tableAlignMatch = matchTableAlignmentMarkerLine(
			lines,
			i,
			tableBaseContainers,
			tablePreListIndent,
			!listInterruptionInParagraph,
			mathIndex,
		);
		if (tableAlignMatch !== null) {
			const markerToken = addTableAlignMarker(tableAlignMatch.text);
			pendingTableAlignOutputIndex = outputLines.length;
			pushOutputLine(`${tableAlignMatch.markerPrefix}${markerToken}`, {
				end: i + 1,
				start: i,
			});
			syncNestedListIndent(tableAlignMatch.containers, droppedOutOfList);
			closeParagraph();
			advancePhpStateRange(i, i);
			i += 1;
			continue;
		}

		const tableInParagraph =
			paragraphOpen &&
			(activeInterleavedContainers !== null
				? !(analysis.indent < 4 && analysis.content.startsWith(">"))
				: !hasInterleavedContainers &&
					lineQuoteDepth === paragraphQuoteDepth &&
					continuesListItem);
		const lazyParagraphContainers: ReadonlyArray<ContainerStep> | null =
			paragraphOpen &&
			!tableInParagraph &&
			phpBlockState.containers.length > 0 &&
			phpBlockState.leaf?.kind === "paragraph"
				? phpBlockState.containers.map((container) =>
						container.kind === "blockquote"
							? { kind: "blockquote" as const }
							: { indent: container.indent, kind: "list" as const },
					)
				: null;
		const effectiveTableInParagraph =
			tableInParagraph || lazyParagraphContainers !== null;

		// 3b. GFM tables (container-aware + multiline `\(...\)` + lazy rows).
		const tableMatch = resolveGfmTableMatch(
			lines,
			i,
			tableBaseContainers,
			tablePreListIndent,
			!listInterruptionInParagraph,
			true,
			mathIndex,
			tableInParagraph,
			effectiveTableInParagraph ? paragraphRefParser : null,
			effectiveTableInParagraph && paragraphHasPipe,
			lazyParagraphContainers,
		);
		if (tableMatch !== null) {
			activeTable = tableMatch;
			activeTableOutputStart =
				pendingTableAlignOutputIndex >= 0
					? pendingTableAlignOutputIndex
					: outputLines.length;
			pendingTableAlignOutputIndex = -1;
			emitTableHeaderRow(displayMathEnv, i, tableMatch.headerEndLine);
			syncNestedListIndent(tableMatch.containers, droppedOutOfList);
			closeParagraph();
			advancePhpStateMaskedLines(i, tableMatch.headerEndLine);
			i = tableMatch.headerEndLine + 1;
			continue;
		}
		pendingTableAlignOutputIndex = -1;

		// 3c. Display math on a line immediately preceding a GFM table delimiter.
		const beforeHtmlContext =
			mathIndex.ranges.length > 0
				? {
						activeRefParser: tableInParagraph ? paragraphRefParser : null,
						allowLeadingListMarker: !listInterruptionInParagraph,
						baseContainers: tableBaseContainers,
						inParagraph: tableInParagraph,
						paragraphHasPipe: tableInParagraph && paragraphHasPipe,
						preMarkerListIndent: tablePreListIndent,
					}
				: null;
		if (beforeHtmlContext !== null) {
			const splitOutStart = outputLines.length;
			const headerMathBreak = emitDisplayMathHeaderLine(
				displayMathEnv,
				i,
				beforeHtmlContext,
			);
			if (headerMathBreak !== null) {
				markSharedOutputSpan(splitOutStart, i, headerMathBreak.spanEndLine + 1);
				applyDisplayMathSplitState(headerMathBreak);
				continue;
			}
		}

		const logicalEnd = findLogicalLineEnd(mathIndex, i);

		// 3d. Subsequent display math after a display-math-restored container
		//     MUST clear/update active `listContentIndent` and container state.
		if (inRestoredDisplayMathContainer && beforeHtmlContext !== null) {
			const splitOutStart = outputLines.length;
			const restoredMathSplit = emitDisplayMathLogicalLine(
				displayMathEnv,
				i,
				logicalEnd,
				beforeHtmlContext,
				false,
			);
			if (restoredMathSplit !== null) {
				markSharedOutputSpan(
					splitOutStart,
					i,
					restoredMathSplit.spanEndLine + 1,
				);
				applyDisplayMathSplitState(restoredMathSplit);
				continue;
			}
		}

		// 4. Standalone block math ($$...$$ and \[...\]) exactly where the
		//    authoritative PHP math index sees it. PHP `extract_math()`
		//    replaces it with `"\n\nTOKEN\n\n"`: inside any list item or
		//    `list -> blockquote` container the token sits at column 0 behind
		//    a blank line, closing every enclosing container.
		const blockMathEnd = php.standaloneDisplayMathEnd(analysis.content, i);
		if (blockMathEnd >= i) {
			if (activeInterleavedContainers !== null || effectiveContainer > 0) {
				if (displayMathEnv.hasPrecedingContent()) pushOutputLine("", null);
				if (activeInterleavedContainers !== null) {
					output.pushContainerStrippedProtectedBlock(
						"math",
						"",
						analysis.content,
						activeInterleavedContainers,
						i,
						blockMathEnd,
					);
				} else {
					pushProtectedBlock("math", analysis, i, blockMathEnd, 0, "");
				}
				pushOutputLine("", null);
				php.closeContainersForDisplayMath(
					line.slice(0, line.length - analysis.content.length),
				);
				listContentIndent = null;
				inRestoredDisplayMathContainer = false;
			} else {
				const mathSentinelIndent =
					relativeIndent >= 4 ? effectiveContainer : analysis.indent;
				pushProtectedBlock("math", analysis, i, blockMathEnd, mathSentinelIndent);
				advancePhpStateClosedBlock(analysis.prefix, effectiveContainer);
			}
			clearDroppedList(droppedOutOfList);
			closeParagraph();
			i = blockMathEnd + 1;
			continue;
		}

		// 5. Standalone [TOC] line.
		if (
			/^\[TOC\][ \t]*$/i.test(analysis.content) &&
			(i === 0 || isCommonMarkBlankLine(lines[i - 1] ?? "")) &&
			(i + 1 >= lines.length || isCommonMarkBlankLine(lines[i + 1] ?? ""))
		) {
			pushProtectedBlock("toc", analysis, i, i);
			clearDroppedList(droppedOutOfList);
			closeParagraph();
			advancePhpStateClosedBlock(analysis.prefix, effectiveContainer);
			i += 1;
			continue;
		}

		// 6. Footnote definitions (including blank-line separated continuations).
		if (
			!paragraphOpen &&
			relativeIndent >= 0 &&
			relativeIndent <= 3 &&
			FOOTNOTE_DEF_LINE.test(analysis.content)
		) {
			const end = findFootnoteDefinitionEnd(lines, i, effectiveContainer);
			pushProtectedBlock("footnotes", analysis, i, end);
			clearDroppedList(droppedOutOfList);
			closeParagraph();
			advancePhpStateClosedBlock(analysis.prefix, effectiveContainer);
			i = end + 1;
			continue;
		}

		// 7. CommonMark §4.6 Types 1-7 HTML blocks using unified math-aware scan.
		const lineStartOffset = mathIndex.lineStarts[i] ?? 0;
		const lineEndOffset = mathIndex.lineEnds[logicalEnd] ?? lineStartOffset;
		const hasMultilineInlineMath = logicalEnd > i;
		const maskedLogicalLine = hasMultilineInlineMath
			? maskedSliceForLines(mathIndex, lines, i, logicalEnd)
			: getMaskedLine(i);
		const firstLineDisplay =
			mathIndex.ranges.length > 0
				? findFirstDisplayMathInLines(mathIndex, i, logicalEnd)
				: null;
		const maskedOpenLine =
			firstLineDisplay !== null
				? mathIndex.maskedDoc.slice(lineStartOffset, firstLineDisplay.from)
				: maskedLogicalLine;
		const listHtml = matchListPrefixedHtmlBlock(
			maskedOpenLine,
			listInterruptionInParagraph,
			prevContainerIndent,
			activeInterleavedContainers ?? undefined,
		);
		if (listHtml !== null) {
			const startContentOffset = lineStartOffset + listHtml.contentOffset;
			const rawListPrefix = `${listHtml.linePrefix}${" ".repeat(listHtml.virtualSpaces)}`;
			const firstLineRaw = hasMultilineInlineMath
				? normalized.slice(startContentOffset, lineEndOffset)
				: line.slice(listHtml.contentOffset);
			const firstLineMasked = mathIndex.maskedDoc.slice(
				startContentOffset,
				lineEndOffset,
			);
			const htmlScan = scanHtmlBlockWithDisplayMath(
				mathIndex,
				lines,
				listHtml.htmlType,
				listHtml.containers,
				logicalEnd,
				startContentOffset,
				firstLineRaw,
				firstLineMasked,
			);
			emitHtmlScanResult(rawListPrefix, htmlScan, i, () => {
				if (activeInterleavedContainers === null) {
					listContentIndent = listHtml.contentIndent;
				}
			});
			continue;
		}

		if (
			relativeIndent >= 0 &&
			relativeIndent <= 3 &&
			analysis.content.startsWith("<")
		) {
			const contentOffset = line.length - analysis.content.length;
			const startContentOffset = lineStartOffset + contentOffset;
			const maskedOpenContent =
				firstLineDisplay !== null && firstLineDisplay.from >= startContentOffset
					? mathIndex.maskedDoc.slice(startContentOffset, firstLineDisplay.from)
					: mathIndex.maskedDoc.slice(startContentOffset, lineEndOffset);
			const htmlType = matchHtmlBlockOpen(maskedOpenContent, !paragraphOpen);
			if (htmlType !== null) {
				const htmlContainers: ContainerStep[] =
					activeInterleavedContainers !== null
						? [...activeInterleavedContainers]
						: Array.from({ length: lineQuoteDepth }, () => ({
								kind: "blockquote" as const,
							}));
				if (effectiveContainer > 0) {
					htmlContainers.push({ indent: effectiveContainer, kind: "list" });
				}
				const firstLineRaw = hasMultilineInlineMath
					? normalized.slice(startContentOffset, lineEndOffset)
					: analysis.content;
				const firstLineMasked = mathIndex.maskedDoc.slice(
					startContentOffset,
					lineEndOffset,
				);
				const htmlScan = scanHtmlBlockWithDisplayMath(
					mathIndex,
					lines,
					htmlType,
					htmlContainers,
					logicalEnd,
					startContentOffset,
					firstLineRaw,
					firstLineMasked,
				);
				emitHtmlScanResult(
					`${analysis.prefix}${" ".repeat(analysis.indent)}`,
					htmlScan,
					i,
					() => {
						clearDroppedList(droppedOutOfList);
					},
				);
				continue;
			}
		}

		// 8. Split any display math on the logical line (multiline spans, block
		//    openers after display math, or container-closing display math); plain
		//    single-line `Hello $$x$$` stays inline when `onlyOnBlockBoundary` holds.
		const hasContainerContext =
			prevListIndent !== null ||
			paragraphQuoteDepth > 0 ||
			phpBlockState.containers.length > 0 ||
			lineQuoteDepth > 0 ||
			acceptedListMarker !== null;
		if (firstLineDisplay !== null && beforeHtmlContext !== null) {
			const splitOutStart = outputLines.length;
			const logicalMathSplit = emitDisplayMathLogicalLine(
				displayMathEnv,
				i,
				logicalEnd,
				beforeHtmlContext,
				!(hasContainerContext || inRestoredDisplayMathContainer),
			);
			if (logicalMathSplit !== null) {
				markSharedOutputSpan(
					splitOutStart,
					i,
					logicalMathSplit.spanEndLine + 1,
				);
				applyDisplayMathSplitState(logicalMathSplit);
				continue;
			}
		}

		const startsNewParagraph = !paragraphOpen || acceptedListMarker !== null;
		const activeRefParser: ParagraphReferenceParser = startsNewParagraph
			? createParagraphReferenceParser()
			: (paragraphRefParser ?? createParagraphReferenceParser());
		const allowRefDefDest = activeRefParser.state !== "paragraph";
		const indentedContinuationStart =
			paragraphOpen && relativeIndent >= 4
				? line.length - analysis.content.length
				: -1;
		const rawLogicalLine = hasMultilineInlineMath
			? normalized.slice(lineStartOffset, lineEndOffset)
			: line;
		pushOutputLine(
			extractInlineProtectedSyntax(
				rawLogicalLine,
				sentinel,
				protectedInlines,
				false,
				allowRefDefDest,
				indentedContinuationStart,
				collectRelativeInlineMathRanges(mathIndex, lineStartOffset, lineEndOffset, 0, true),
				maskedLogicalLine,
			),
			{ end: logicalEnd + 1, start: i },
		);

		const effectiveContent = maskedLogicalLine.slice(line.length - analysis.content.length);
		const lineState = classifyParagraphLine(
			effectiveContent,
			relativeIndent,
			paragraphOpen,
			listInterruptionInParagraph,
		);
		const isLazyContinuation =
			paragraphOpen && lineState.open && acceptedListMarker === null;
		if (!isLazyContinuation) {
			clearDroppedList(droppedOutOfList);
			paragraphQuoteDepth = lineQuoteDepth + lineState.nestedQuotes;
		}
		paragraphOpen = lineState.open;
		if (paragraphOpen) {
			const refLine = acceptedListMarker
				? maskedLogicalLine.slice(line.length - acceptedListMarker.afterContent.length)
				: effectiveContent;
			paragraphHasContent = !advanceParagraphReferenceParser(activeRefParser, refLine);
			paragraphHasPipe = paragraphHasContent
				? startsNewParagraph
					? refLine.includes("|")
					: paragraphHasPipe || refLine.includes("|")
				: false;
			paragraphRefParser = activeRefParser;
		} else {
			paragraphHasContent = false;
			paragraphHasPipe = false;
			paragraphRefParser = null;
		}
		advancePhpStateMaskedLines(i, logicalEnd);
		i = logicalEnd + 1;
	}

	return {
		lineEnding,
		markdown: outputLines.join("\n"),
		outputLineRanges,
		outputLineSharedRanges,
		outputLines,
		protectedBlocks: output.protectedBlocks,
		protectedInlines,
		rawLines: lines,
		sentinel,
		tableAlignMarkers: output.tableAlignMarkers,
	};
}
