import {
	advancePhpCommonMarkBlockLine,
	createPhpCommonMarkBlockState,
	scanLinesIntoPhpCommonMarkBlockState,
} from "../../shared/markdown/php-commonmark-block-engine";
import { matchHtmlBlockOpen } from "../../shared/markdown/php-commonmark-block-helpers";
import {
	advanceParagraphReferenceParser,
	createParagraphReferenceParser,
	type ParagraphReferenceParser,
} from "../../shared/markdown/php-commonmark-reference-def";
import {
	analyzeLine,
	type BlockMathScanState,
	type ContainerStep,
	classifyParagraphLine,
	detectFence,
	findBlockMathEnd,
	findCommonMarkHtmlBlockEnd,
	findContainerBoundedFenceEnd,
	findFootnoteDefinitionEnd,
	hasListBeforeQuote,
	isCommonMarkBlankLine,
	type LineAnalysis,
	matchListPrefixedHtmlBlock,
	resolveLineContainerContext,
	stripBlockContainerPrefix,
	stripContainers,
	sumListContainerIndent,
} from "./markdown-prescanner-blocks";
import { findType6Or7DisplayMathBreak } from "./markdown-prescanner-display-math";
import {
	extractInlineProtectedSyntax,
	type ProtectedInlineEntry,
} from "./markdown-prescanner-inline";
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
	createPhpDocumentMathIndex,
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
import type { ProtectedBlockKind } from "./visual-schema";

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
export type { ProtectedInlineEntry };
export { TABLE_ALIGN_PREFIX, TABLE_ALIGN_SUFFIX };

export type ProtectedBlockEntry = Readonly<{
	kind: ProtectedBlockKind;
	rawMarkdown: string;
}>;

export type PrescannedLineRange = Readonly<{
	end: number;
	start: number;
}>;

export type PreScanResult = Readonly<{
	lineEnding: "\n" | "\r\n";
	markdown: string;
	outputLineRanges: ReadonlyArray<PrescannedLineRange | null>;
	outputLines: ReadonlyArray<string>;
	protectedBlocks: ReadonlyMap<string, ProtectedBlockEntry>;
	protectedInlines: ReadonlyMap<string, ProtectedInlineEntry>;
	rawLines: ReadonlyArray<string>;
	sentinel: string;
	tableAlignMarkers: ReadonlyMap<string, string>;
}>;

const INTERNAL_TOKEN_PATTERN = /EASYMDEPH[A-Z]*(?:INL|BLK|TBLALIGN|BR)\d*END/g;
const EMPTY_CONTAINERS: ReadonlyArray<ContainerStep> = [];

function createCollisionFreeSentinel(source: string): string {
	let sentinel = "EASYMDEPH";
	while (source.includes(sentinel)) {
		sentinel = `${sentinel}X`;
	}
	return sentinel;
}

/**
 * Undo every accidental internal sentinel that could otherwise reach a
 * ProseMirror node attribute or code block text.
 */
export function restoreProtectedInlineSentinels(
	text: string,
	preScan: Pick<
		PreScanResult,
		"protectedBlocks" | "protectedInlines" | "tableAlignMarkers"
	>,
): string {
	if (text.length === 0 || !text.includes("EASYMDEPH")) {
		return text;
	}
	return text.replace(INTERNAL_TOKEN_PATTERN, (token) => {
		const inline = preScan.protectedInlines.get(token);
		if (inline) return inline.rawMarkdown;
		const block = preScan.protectedBlocks.get(token);
		if (block) return block.rawMarkdown;
		const marker = preScan.tableAlignMarkers.get(token);
		if (marker !== undefined) return marker;
		return token.endsWith("BREND") ? "<br>" : token;
	});
}

export const FOOTNOTE_DEF_LINE = /^ {0,3}\[\^([^\s\]]+)\]:(?:[ \t]|$)/;

export function prescanMarkdown(rawMarkdown: string): PreScanResult {
	const lineEnding: "\n" | "\r\n" = rawMarkdown.includes("\r\n")
		? "\r\n"
		: "\n";
	const normalized = rawMarkdown.replace(/\r\n?/g, "\n");
	const sentinel = createCollisionFreeSentinel(normalized);
	const lines = normalized.split("\n");
	const outputLines: string[] = [];
	const outputLineRanges: Array<PrescannedLineRange | null> = [];
	const protectedBlocks = new Map<string, ProtectedBlockEntry>();
	const protectedInlines = new Map<string, ProtectedInlineEntry>();
	const tableAlignMarkers = new Map<string, string>();

	const pushOutputLine = (
		text: string,
		range: PrescannedLineRange | null,
	): void => {
		outputLines.push(text);
		outputLineRanges.push(range);
	};

	const addProtectedBlock = (
		kind: ProtectedBlockKind,
		rawBlock: string,
	): string => {
		const token = `${sentinel}BLK${protectedBlocks.size}END`;
		protectedBlocks.set(token, { kind, rawMarkdown: rawBlock });
		return token;
	};

	const pushProtectedBlock = (
		kind: ProtectedBlockKind,
		{ indent, prefix }: Pick<LineAnalysis, "indent" | "prefix">,
		origStart: number,
		lastLine: number,
		sentinelIndent = indent,
	): void => {
		const origEnd = lastLine + 1;
		const rawBlock = lines
			.slice(origStart, origEnd)
			.map((blockLine) => stripBlockContainerPrefix(blockLine, prefix, indent))
			.join("\n");
		const token = addProtectedBlock(kind, rawBlock);
		pushOutputLine(`${prefix}${" ".repeat(sentinelIndent)}${token}`, {
			end: origEnd,
			start: origStart,
		});
	};

	const pushListPrefixedProtectedBlock = (
		kind: ProtectedBlockKind,
		linePrefix: string,
		firstLineContent: string,
		containers: ReadonlyArray<ContainerStep>,
		origStart: number,
		lastLine: number,
	): void => {
		const origEnd = lastLine + 1;
		const rawBlockLines: string[] = [firstLineContent];
		for (let k = origStart + 1; k <= lastLine; k += 1) {
			rawBlockLines.push(stripContainers(lines[k] ?? "", containers) ?? "");
		}
		pushOutputLine(
			`${linePrefix}${addProtectedBlock(kind, rawBlockLines.join("\n"))}`,
			{ end: origEnd, start: origStart },
		);
	};

	const phpBlockState = createPhpCommonMarkBlockState(false, false);
	const mathIndex = createPhpDocumentMathIndex(normalized, lines);
	const getMaskedLine = (lineIdx: number): string =>
		maskedSliceForLines(mathIndex, lines, lineIdx, lineIdx);
	const blockMathScanState: BlockMathScanState = {
		noBracketCloseBefore: -1,
		noBracketCloseContainer: -1,
		noDollarCloseBefore: -1,
		noDollarCloseContainer: -1,
	};
	const advancePhpStateRange = (from: number, toInclusive: number): void => {
		for (let k = from; k <= toInclusive; k += 1) {
			advancePhpCommonMarkBlockLine(phpBlockState, lines[k] ?? "");
		}
	};
	const advancePhpStateMaskedLines = (fromLine: number, toLine: number): void => {
		const masked = maskedSliceForLines(mathIndex, lines, fromLine, toLine);
		if (masked.includes("\n")) scanLinesIntoPhpCommonMarkBlockState(phpBlockState, masked);
		else advancePhpCommonMarkBlockLine(phpBlockState, masked);
	};
	const advancePhpStateAfterDisplayMath = (
		afterStartOffset: number,
		toLineInclusive: number,
	): void => {
		const endOffset = mathIndex.lineEnds[toLineInclusive] ?? afterStartOffset;
		const postMathMasked =
			endOffset >= afterStartOffset
				? mathIndex.maskedDoc.slice(afterStartOffset, endOffset)
				: "";
		scanLinesIntoPhpCommonMarkBlockState(phpBlockState, `\n\nM\n\n${postMathMasked}`);
	};
	const advancePhpStateClosedBlock = (prefix: string, indent: number): void => {
		advancePhpCommonMarkBlockLine(
			phpBlockState,
			`${prefix}${" ".repeat(Math.max(0, indent))}<!-- -->`,
		);
	};

	let i = 0;
	let inIndentedCode = false;
	let indentedCodeContainer = 0;
	let listContentIndent: number | null = null;
	let inRestoredDisplayMathContainer = false;
	let paragraphOpen = false;
	let paragraphHasContent = false;
	let paragraphQuoteDepth = 0;
	let paragraphRefParser: ParagraphReferenceParser | null = null;
	let activeTable: GfmTableMatch | null = null;
	let activeTableOutputStart = -1;
	let pendingTableAlignOutputIndex = -1;

	const closeParagraph = (): void => {
		paragraphOpen = false;
		paragraphHasContent = false;
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
		callbacks: { addProtectedBlock, pushOutputLine },
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
			paragraphQuoteDepth = trailing.paragraphQuoteDepth;
			paragraphRefParser = trailing.paragraphRefParser;
			inRestoredDisplayMathContainer =
				trailing.listContentIndent !== null || trailing.paragraphQuoteDepth > 0;
		} else {
			closeParagraph();
			inIndentedCode = false;
			inRestoredDisplayMathContainer = false;
			if (activeTable !== null && !hasListBeforeQuote(activeTable.containers)) {
				const nestedListIndent = sumListContainerIndent(activeTable.containers);
				listContentIndent = nestedListIndent > 0 ? nestedListIndent : null;
			} else {
				listContentIndent = null;
			}
		}
		advancePhpStateAfterDisplayMath(
			result.afterStartOffset,
			result.spanEndLine,
		);
		i = result.spanEndLine + 1;
	};

	const tryEmitHtmlWithDisplayMathBreak = (
		linePrefix: string,
		firstLineContent: string,
		containers: ReadonlyArray<ContainerStep>,
		origStart: number,
		htmlEnd: number,
	): boolean => {
		const broken = findType6Or7DisplayMathBreak(
			mathIndex,
			lines,
			firstLineContent,
			containers,
			origStart,
			htmlEnd,
		);
		if (broken === null) return false;
		pushOutputLine(
			`${linePrefix}${addProtectedBlock("raw", broken.rawHtml)}`,
			null,
		);
		applyDisplayMathSplitState(
			emitDisplayMathLineSegments(
				displayMathEnv,
				broken.resumeLine,
				findLogicalLineEnd(mathIndex, broken.resumeLine),
				null,
				null,
				broken.resumeOffset,
				true,
			),
		);
		return true;
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
				for (let idx = activeTableOutputStart; idx < invalidateEnd; idx += 1) {
					outputLineRanges[idx] = null;
				}
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
			if (listContentIndent === null) inRestoredDisplayMathContainer = false;
			advancePhpStateRange(i, i);
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
		if (!paragraphOpen && relativeIndent >= 4) {
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
			const markerToken = `${sentinel}TBLALIGN${tableAlignMarkers.size}END`;
			tableAlignMarkers.set(markerToken, tableAlignMatch.text);
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
			tableInParagraph ? paragraphRefParser : null,
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
		const beforeHtmlContext = {
			allowLeadingListMarker: !listInterruptionInParagraph,
			baseContainers: tableBaseContainers,
			inParagraph: tableInParagraph,
			preMarkerListIndent: tablePreListIndent,
		};
		const headerMathBreak = emitDisplayMathHeaderLine(
			displayMathEnv,
			i,
			beforeHtmlContext,
		);
		if (headerMathBreak !== null) {
			applyDisplayMathSplitState(headerMathBreak);
			continue;
		}

		const logicalEnd = findLogicalLineEnd(mathIndex, i);

		// 3d. Subsequent display math after a display-math-restored container
		//     MUST clear/update active `listContentIndent` and container state.
		if (inRestoredDisplayMathContainer) {
			const restoredMathSplit = emitDisplayMathLogicalLine(
				displayMathEnv,
				i,
				logicalEnd,
				beforeHtmlContext,
				false,
			);
			if (restoredMathSplit !== null) {
				applyDisplayMathSplitState(restoredMathSplit);
				continue;
			}
		}

		// 4. Standalone block math: $$...$$ and \[...\].
		const blockMathEnd = findBlockMathEnd(
			lines,
			i,
			analysis.content,
			effectiveContainer,
			blockMathScanState,
		);
		if (blockMathEnd >= i) {
			if (activeInterleavedContainers !== null) {
				pushListPrefixedProtectedBlock(
					"math",
					analysis.prefix,
					analysis.content,
					activeInterleavedContainers,
					i,
					blockMathEnd,
				);
				advancePhpStateClosedBlock(analysis.prefix, 0);
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

		// 7. CommonMark §4.6 Types 1-7 HTML blocks using math-masked line checks.
		const maskedLine = getMaskedLine(i);
		const listHtml = matchListPrefixedHtmlBlock(
			maskedLine,
			listInterruptionInParagraph,
			prevContainerIndent,
			activeInterleavedContainers ?? undefined,
		);
		if (listHtml !== null) {
			const rawListContent = line.slice(line.length - listHtml.content.length);
			const rawListPrefix = line.slice(0, listHtml.linePrefix.length);
			const end = findCommonMarkHtmlBlockEnd(
				lines,
				i,
				listHtml.htmlType,
				listHtml.containers,
				listHtml.content,
				getMaskedLine,
			);
			if (
				(listHtml.htmlType === 6 || listHtml.htmlType === 7) &&
				tryEmitHtmlWithDisplayMathBreak(
					rawListPrefix,
					rawListContent,
					listHtml.containers,
					i,
					end,
				)
			) {
				continue;
			}
			pushListPrefixedProtectedBlock(
				"raw",
				rawListPrefix,
				rawListContent,
				listHtml.containers,
				i,
				end,
			);
			if (activeInterleavedContainers === null) {
				listContentIndent = listHtml.contentIndent;
			}
			closeParagraph();
			advancePhpStateMaskedLines(i, end);
			i = end + 1;
			continue;
		}

		if (
			relativeIndent >= 0 &&
			relativeIndent <= 3 &&
			analysis.content.startsWith("<")
		) {
			const maskedContent = maskedLine.slice(
				line.length - analysis.content.length,
			);
			const htmlType = matchHtmlBlockOpen(maskedContent, !paragraphOpen);
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
				const end = findCommonMarkHtmlBlockEnd(
					lines,
					i,
					htmlType,
					htmlContainers,
					maskedContent,
					getMaskedLine,
				);
				if (
					(htmlType === 6 || htmlType === 7) &&
					tryEmitHtmlWithDisplayMathBreak(
						`${analysis.prefix}${" ".repeat(analysis.indent)}`,
						analysis.content,
						htmlContainers,
						i,
						end,
					)
				) {
					continue;
				}
				if (activeInterleavedContainers !== null) {
					pushListPrefixedProtectedBlock(
						"raw",
						analysis.prefix,
						analysis.content,
						htmlContainers,
						i,
						end,
					);
				} else {
					pushProtectedBlock("raw", analysis, i, end);
				}
				clearDroppedList(droppedOutOfList);
				closeParagraph();
				advancePhpStateMaskedLines(i, end);
				i = end + 1;
				continue;
			}
		}

		// 8. Split display math breaking an active list/quote container or
		//    opening a block on a multiline `\(...\)` line; otherwise unify
		//    inline scanning onto canonical `mathIndex.ranges` + `maskedDoc`.
		const hasMultilineInlineMath = logicalEnd > i;
		const hasPriorContainer =
			prevListIndent !== null ||
			paragraphQuoteDepth > 0 ||
			phpBlockState.containers.length > 0;
		if (hasPriorContainer || hasMultilineInlineMath) {
			const logicalMathSplit = emitDisplayMathLogicalLine(
				displayMathEnv,
				i,
				logicalEnd,
				beforeHtmlContext,
				!hasPriorContainer,
			);
			if (logicalMathSplit !== null) {
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
		const lineStartOffset = mathIndex.lineStarts[i] ?? 0;
		const lineEndOffset = mathIndex.lineEnds[logicalEnd] ?? lineStartOffset;
		const rawLogicalLine = hasMultilineInlineMath
			? normalized.slice(lineStartOffset, lineEndOffset)
			: line;
		const maskedLogicalLine = hasMultilineInlineMath
			? maskedSliceForLines(mathIndex, lines, i, logicalEnd)
			: maskedLine;
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
			paragraphRefParser = activeRefParser;
		} else {
			paragraphHasContent = false;
			paragraphRefParser = null;
		}
		advancePhpStateMaskedLines(i, logicalEnd);
		i = logicalEnd + 1;
	}

	return {
		lineEnding,
		markdown: outputLines.join("\n"),
		outputLineRanges,
		outputLines,
		protectedBlocks,
		protectedInlines,
		rawLines: lines,
		sentinel,
		tableAlignMarkers,
	};
}
