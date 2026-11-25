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
	canListMarkerInterruptParagraph,
	classifyParagraphLine,
	detectFence,
	findBlockMathEnd,
	findCommonMarkHtmlBlockEnd,
	findContainerBoundedFenceEnd,
	hasListBeforeQuote,
	isCommonMarkBlankLine,
	type LineAnalysis,
	type ListMarkerMatch,
	matchListMarker,
	matchListPrefixedHtmlBlock,
	measureIndentColumns,
	stripBlockContainerPrefix,
	stripContainers,
	stripContainersWithColumn,
} from "./markdown-prescanner-blocks";
import {
	extractInlineProtectedSyntax,
	type ProtectedInlineEntry,
} from "./markdown-prescanner-inline";
import {
	emitActiveTableRow,
	emitDisplayMathHeaderLine,
	emitDisplayMathTableBreak,
} from "./markdown-prescanner-table-emit";
import {
	collectRelativeInlineMathRanges,
	createPhpDocumentMathIndex,
	type GfmTableMatch,
	maskedSliceForLines,
	matchTableAlignmentMarkerLine,
	resolveGfmTableMatch,
	sumListContainerIndent,
} from "./markdown-prescanner-tables";
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

import {
	TABLE_ALIGN_PREFIX,
	TABLE_ALIGN_SUFFIX,
} from "./table-alignment-codec";

export { TABLE_ALIGN_PREFIX, TABLE_ALIGN_SUFFIX };

const INTERNAL_TOKEN_PATTERN = /EASYMDEPH[A-Z]*(?:INL|BLK|TBLALIGN|BR)\d*END/g;
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
		if (inline) {
			return inline.rawMarkdown;
		}
		const block = preScan.protectedBlocks.get(token);
		if (block) {
			return block.rawMarkdown;
		}
		const marker = preScan.tableAlignMarkers.get(token);
		if (marker !== undefined) {
			return marker;
		}
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

	/** Protect original lines `origStart..lastLine` (inclusive). */
	const pushProtectedBlock = (
		kind: ProtectedBlockKind,
		{ indent, prefix }: Pick<LineAnalysis, "indent" | "prefix">,
		origStart: number,
		lastLine: number,
		sentinelIndent = indent,
	): void => {
		const origEnd = lastLine + 1;
		const token = `${sentinel}BLK${protectedBlocks.size}END`;
		const rawMarkdown = lines
			.slice(origStart, origEnd)
			.map((blockLine) => stripBlockContainerPrefix(blockLine, prefix, indent))
			.join("\n");
		protectedBlocks.set(token, { kind, rawMarkdown });
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
		const token = `${sentinel}BLK${protectedBlocks.size}END`;
		const rawBlockLines: string[] = [firstLineContent];
		for (let k = origStart + 1; k <= lastLine; k += 1) {
			const afterContainers = stripContainers(lines[k] ?? "", containers);
			rawBlockLines.push(afterContainers ?? "");
		}
		protectedBlocks.set(token, { kind, rawMarkdown: rawBlockLines.join("\n") });
		pushOutputLine(`${linePrefix}${token}`, {
			end: origEnd,
			start: origStart,
		});
	};

	const phpBlockState = createPhpCommonMarkBlockState(false, false);
	const mathIndex = createPhpDocumentMathIndex(normalized, lines);
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
	const advancePhpStateMaskedLines = (
		fromLine: number,
		toLineInclusive: number,
	): void => {
		const masked = maskedSliceForLines(
			mathIndex,
			lines,
			fromLine,
			toLineInclusive,
		);
		if (masked.includes("\n")) {
			scanLinesIntoPhpCommonMarkBlockState(phpBlockState, masked);
		} else {
			advancePhpCommonMarkBlockLine(phpBlockState, masked);
		}
	};
	const advancePhpStateAfterDisplayMath = (
		fromLine: number,
		toLineInclusive: number,
	): void => {
		const masked = maskedSliceForLines(
			mathIndex,
			lines,
			fromLine,
			toLineInclusive,
		);
		const lastBreak = masked.lastIndexOf("\n\n");
		if (lastBreak >= 0) {
			scanLinesIntoPhpCommonMarkBlockState(
				phpBlockState,
				`\n\nM\n\n${masked.slice(lastBreak + 2)}`,
			);
			return;
		}
		advancePhpStateMaskedLines(fromLine, toLineInclusive);
	};
	const advancePhpStateClosedBlock = (
		prefix: string,
		indent: number,
	): void => {
		advancePhpCommonMarkBlockLine(
			phpBlockState,
			`${prefix}${" ".repeat(Math.max(0, indent))}<!-- -->`,
		);
	};

	let i = 0;
	let inIndentedCode = false;
	let indentedCodeContainer = 0;
	let listContentIndent: number | null = null;
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

	const EMPTY_CONTAINERS: ReadonlyArray<ContainerStep> = [];
	const addProtectedBlock = (
		kind: ProtectedBlockKind,
		rawMarkdown: string,
	): string => {
		const token = `${sentinel}BLK${protectedBlocks.size}END`;
		protectedBlocks.set(token, { kind, rawMarkdown });
		return token;
	};

	while (i < lines.length) {
		if (activeTable !== null && i <= activeTable.endLine) {
			if (i === activeTable.delimiterLine) {
				pushOutputLine(lines[i] ?? "", { end: i + 1, start: i });
				advancePhpStateMaskedLines(i, i);
				i += 1;
				continue;
			}
			const logicalEnd = emitActiveTableRow(
				i,
				activeTable,
				mathIndex,
				sentinel,
				protectedInlines,
				pushOutputLine,
			);
			advancePhpStateMaskedLines(i, logicalEnd);
			i = logicalEnd + 1;
			continue;
		}

		if (activeTable !== null && i === activeTable.brokenByDisplayMathLine) {
			const { emittedTableBeforeRow, spanEndLine } = emitDisplayMathTableBreak(
				i,
				activeTable.containers,
				mathIndex,
				sentinel,
				protectedInlines,
				{ addProtectedBlock, pushOutputLine },
			);
			if (emittedTableBeforeRow && activeTableOutputStart >= 0) {
				for (
					let rangeIdx = activeTableOutputStart;
					rangeIdx < outputLineRanges.length;
					rangeIdx += 1
				) {
					outputLineRanges[rangeIdx] = null;
				}
			}
			activeTable = null;
			activeTableOutputStart = -1;
			pendingTableAlignOutputIndex = -1;
			closeParagraph();
			listContentIndent = null;
			advancePhpStateAfterDisplayMath(i, spanEndLine);
			i = spanEndLine + 1;
			continue;
		}

		if (activeTable !== null) {
			activeTable = null;
			activeTableOutputStart = -1;
		}

		const line = lines[i] ?? "";
		const hasInterleavedContainers =
			phpBlockState.containers.length > 1 &&
			hasListBeforeQuote(phpBlockState.containers);
		const phpContainers: ContainerStep[] = hasInterleavedContainers
			? phpBlockState.containers.map((container) =>
					container.kind === "blockquote"
						? { kind: "blockquote" }
						: { indent: container.indent, kind: "list" },
				)
			: [];
		const matchedInterleaved = hasInterleavedContainers
			? stripContainersWithColumn(line, phpContainers)
			: null;
		let analysis: LineAnalysis = analyzeLine(line, listContentIndent ?? 0);
		const isBlank = isCommonMarkBlankLine(line);

		if (inIndentedCode) {
			if (isBlank) {
				pushOutputLine(line, { end: i + 1, start: i });
				advancePhpStateRange(i, i);
				i += 1;
				continue;
			}
			if (analysis.indent - indentedCodeContainer >= 4) {
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
			i += 1;
			continue;
		}

		let lineQuoteDepth = analysis.quoteDepth;
		let prevListIndent: number | null = listContentIndent;
		let prevContainerIndent = prevListIndent ?? 0;
		let continuesListItem: boolean =
			prevListIndent === null || analysis.indent >= prevListIndent;
		let listInterruptionInParagraph: boolean;
		let droppedOutOfList = false;
		let acceptedListMarker: ListMarkerMatch | null;
		let effectiveContainer: number;
		let preMarkerContainerIndent: number;
		let activeInterleavedContainers: ReadonlyArray<ContainerStep> | null = null;

		if (matchedInterleaved !== null) {
			activeInterleavedContainers = phpContainers;
			const interRest = matchedInterleaved.rest;
			const interColumn = matchedInterleaved.column;
			const interIndent = measureIndentColumns(interRest, interColumn);
			const interContent = interRest.replace(/^[ \t]+/, "");
			const opensDeeperQuote =
				interIndent < 4 && interContent.startsWith(">");
			let interQuoteDepth = 0;
			for (const step of phpContainers) {
				if (step.kind === "blockquote") {
					interQuoteDepth += 1;
				}
			}
			lineQuoteDepth = interQuoteDepth;
			if (opensDeeperQuote) {
				closeParagraph();
			} else {
				const phpLeaf = phpBlockState.leaf;
				paragraphOpen = phpLeaf?.kind === "paragraph";
				paragraphHasContent =
					phpLeaf?.kind === "paragraph" && phpLeaf.paragraphLineCount > 0;
			}
			const rawInterMarker = matchListMarker(interRest, interColumn);
			const boundedInterMarker =
				rawInterMarker !== null && rawInterMarker.leadCols <= 3
					? rawInterMarker
					: null;
			listInterruptionInParagraph =
				paragraphOpen && paragraphHasContent && !opensDeeperQuote;
			acceptedListMarker =
				boundedInterMarker !== null &&
				(!listInterruptionInParagraph ||
					canListMarkerInterruptParagraph(boundedInterMarker))
					? boundedInterMarker
					: null;
			effectiveContainer =
				acceptedListMarker !== null ? acceptedListMarker.contentIndent : 0;
			preMarkerContainerIndent = 0;
			continuesListItem = true;
			prevContainerIndent = 0;
			analysis = {
				column: interColumn,
				containerIndent: effectiveContainer,
				content: interContent,
				indent: interIndent,
				listMarker: acceptedListMarker,
				prefix: matchedInterleaved.prefix,
				quoteDepth: interQuoteDepth,
				rest: interRest,
			};
		} else {
			// A deeper blockquote marker opens a quote that interrupts a paragraph.
			if (paragraphOpen && lineQuoteDepth > paragraphQuoteDepth) {
				closeParagraph();
			}

			prevListIndent = listContentIndent;
			prevContainerIndent = prevListIndent ?? 0;
			continuesListItem =
				prevListIndent === null || analysis.indent >= prevListIndent;
			// Dropping out of an interleaved `list -> quote` container closes the
			// inner blockquote paragraph, so outer list markers (`2.`) may start.
			listInterruptionInParagraph =
				!hasInterleavedContainers &&
				paragraphOpen &&
				paragraphHasContent &&
				lineQuoteDepth === paragraphQuoteDepth &&
				continuesListItem;

			const rawListMarker = analysis.listMarker;
			acceptedListMarker =
				rawListMarker !== null &&
				(!listInterruptionInParagraph ||
					canListMarkerInterruptParagraph(rawListMarker))
					? rawListMarker
					: null;

			if (acceptedListMarker !== null) {
				listContentIndent = acceptedListMarker.contentIndent;
			} else if (!continuesListItem) {
				droppedOutOfList = true;
				if (!paragraphOpen) {
					listContentIndent = null;
				}
			}

			effectiveContainer =
				acceptedListMarker !== null
					? acceptedListMarker.contentIndent
					: droppedOutOfList
						? 0
						: (listContentIndent ?? 0);
			preMarkerContainerIndent =
				acceptedListMarker !== null
					? acceptedListMarker.leadCols >= prevContainerIndent
						? prevContainerIndent
						: 0
					: effectiveContainer;
			if (
				analysis.containerIndent !== effectiveContainer ||
				analysis.listMarker !== acceptedListMarker
			) {
				analysis = {
					...analysis,
					containerIndent: effectiveContainer,
					listMarker: acceptedListMarker,
				};
			}
		}
		const relativeIndent = analysis.indent - effectiveContainer;

		// 1. Indented code blocks can only start when no paragraph is open.
		if (!paragraphOpen && relativeIndent >= 4) {
			inIndentedCode = true;
			indentedCodeContainer = effectiveContainer;
			if (droppedOutOfList) {
				listContentIndent = null;
			}
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
			if (droppedOutOfList) {
				listContentIndent = null;
			}
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
			if (!hasListBeforeQuote(tableAlignMatch.containers)) {
				const nestedListIndent = sumListContainerIndent(
					tableAlignMatch.containers,
				);
				if (nestedListIndent > 0) {
					listContentIndent = nestedListIndent;
				} else if (droppedOutOfList) {
					listContentIndent = null;
				}
			}
			closeParagraph();
			advancePhpStateRange(i, i);
			i += 1;
			continue;
		}

		// 3b. GFM tables (container-aware: top-level, blockquotes, nested lists,
		//     interleaved `list -> quote`, multiline `\(...\)`, lazy continuations,
		//     and display-math table breaks).
		const tableMatch = resolveGfmTableMatch(
			lines,
			i,
			tableBaseContainers,
			tablePreListIndent,
			!listInterruptionInParagraph,
			true,
			mathIndex,
		);
		if (tableMatch !== null) {
			const headerStartOffset = mathIndex.lineStarts[i] ?? 0;
			const headerEndOffset =
				mathIndex.lineEnds[tableMatch.headerEndLine] ?? headerStartOffset;
			const rawHeader = normalized.slice(headerStartOffset, headerEndOffset);
			const headerMathRanges = collectRelativeInlineMathRanges(
				mathIndex,
				headerStartOffset,
				headerEndOffset,
			);
			activeTable = tableMatch;
			activeTableOutputStart =
				pendingTableAlignOutputIndex >= 0
					? pendingTableAlignOutputIndex
					: outputLines.length;
			pendingTableAlignOutputIndex = -1;
			pushOutputLine(
				extractInlineProtectedSyntax(
					rawHeader,
					sentinel,
					protectedInlines,
					true,
					false,
					-1,
					headerMathRanges,
				),
				{ end: tableMatch.headerEndLine + 1, start: i },
			);
			if (!hasListBeforeQuote(tableMatch.containers)) {
				const nestedListIndent = sumListContainerIndent(tableMatch.containers);
				if (nestedListIndent > 0) {
					listContentIndent = nestedListIndent;
				} else if (droppedOutOfList) {
					listContentIndent = null;
				}
			}
			closeParagraph();
			advancePhpStateMaskedLines(i, tableMatch.headerEndLine);
			i = tableMatch.headerEndLine + 1;
			continue;
		}
		pendingTableAlignOutputIndex = -1;

		// 3c. Display math on a line immediately preceding a GFM table delimiter
		//     line splits via `\n\n<BLK>\n\n` (matching PHP `extract_math()`),
		//     and evaluates GFM table matching cleanly on the post-math segment.
		const headerMathBreak = emitDisplayMathHeaderLine(
			lines,
			i,
			mathIndex,
			sentinel,
			protectedInlines,
			{ addProtectedBlock, pushOutputLine },
			() => outputLines.length,
		);
		if (headerMathBreak !== null) {
			activeTable = headerMathBreak.activeTable;
			activeTableOutputStart = headerMathBreak.activeTableOutputStart;
			if (
				activeTable !== null &&
				!hasListBeforeQuote(activeTable.containers)
			) {
				const nestedListIndent = sumListContainerIndent(activeTable.containers);
				listContentIndent = nestedListIndent > 0 ? nestedListIndent : null;
			} else {
				listContentIndent = null;
			}
			closeParagraph();
			advancePhpStateAfterDisplayMath(i, headerMathBreak.spanEndLine);
			i = headerMathBreak.spanEndLine + 1;
			continue;
		}

		// 4. Block math: $$...$$ and \[...\] (single-line or multi-line).
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
			if (droppedOutOfList) {
				listContentIndent = null;
			}
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
			if (droppedOutOfList) {
				listContentIndent = null;
			}
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
			/^\[\^([^\s\]]+)\]:(?:[ \t]|$)/.test(analysis.content)
		) {
			let end = i;
			while (end + 1 < lines.length) {
				const next = analyzeLine(lines[end + 1] ?? "", effectiveContainer);
				if (
					/^(?: {2,}|\t)/.test(next.rest) ||
					/^\[\^([^\s\]]+)\]:(?:[ \t]|$)/.test(next.content)
				) {
					end += 1;
					continue;
				}
				if (isCommonMarkBlankLine(next.content)) {
					let lookahead = end + 1;
					while (
						lookahead < lines.length &&
						isCommonMarkBlankLine(lines[lookahead] ?? "")
					) {
						lookahead += 1;
					}
					const after = analyzeLine(lines[lookahead] ?? "", effectiveContainer);
					if (lookahead < lines.length && after.indent >= 2) {
						end = lookahead;
						continue;
					}
				}
				break;
			}
			pushProtectedBlock("footnotes", analysis, i, end);
			if (droppedOutOfList) {
				listContentIndent = null;
			}
			closeParagraph();
			advancePhpStateClosedBlock(analysis.prefix, effectiveContainer);
			i = end + 1;
			continue;
		}

		// 7. CommonMark §4.6 Types 1-7 HTML blocks (including interleaved
		//    list-marker and blockquote-prefixed blocks).
		const listHtml = matchListPrefixedHtmlBlock(
			line,
			listInterruptionInParagraph,
			prevContainerIndent,
			activeInterleavedContainers ?? undefined,
		);
		if (listHtml !== null) {
			const end = findCommonMarkHtmlBlockEnd(
				lines,
				i,
				listHtml.htmlType,
				listHtml.containers,
				listHtml.content,
			);
			pushListPrefixedProtectedBlock(
				"raw",
				listHtml.linePrefix,
				listHtml.content,
				listHtml.containers,
				i,
				end,
			);
			if (activeInterleavedContainers === null) {
				listContentIndent = listHtml.contentIndent;
			}
			closeParagraph();
			advancePhpStateRange(i, end);
			i = end + 1;
			continue;
		}

		if (
			relativeIndent >= 0 &&
			relativeIndent <= 3 &&
			analysis.content.startsWith("<")
		) {
			const htmlType = matchHtmlBlockOpen(analysis.content, !paragraphOpen);
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
					analysis.content,
				);
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
				if (droppedOutOfList) {
					listContentIndent = null;
				}
				closeParagraph();
				advancePhpStateRange(i, end);
				i = end + 1;
				continue;
			}
		}

		// Keep `paragraphOpen = true` across link reference definitions (matching
		// PHP ParagraphParser), while tracking ReferenceParser state so consecutive
		// angle-bracketed destinations keep their `<...>` intact and empty
		// refdef-only paragraphs allow `2.` / `01.` list starts.
		const startsNewParagraph = !paragraphOpen || acceptedListMarker !== null;
		const activeRefParser: ParagraphReferenceParser = startsNewParagraph
			? createParagraphReferenceParser()
			: (paragraphRefParser ?? createParagraphReferenceParser());
		const allowRefDefDest = activeRefParser.state !== "paragraph";
		const indentedContinuationStart =
			paragraphOpen && relativeIndent >= 4
				? line.length - analysis.content.length
				: -1;

		pushOutputLine(
			extractInlineProtectedSyntax(
				line,
				sentinel,
				protectedInlines,
				false,
				allowRefDefDest,
				indentedContinuationStart,
			),
			{ end: i + 1, start: i },
		);
		const lineState = classifyParagraphLine(
			analysis.content,
			relativeIndent,
			paragraphOpen,
			listInterruptionInParagraph,
		);
		const isLazyContinuation =
			paragraphOpen && lineState.open && acceptedListMarker === null;
		if (droppedOutOfList && !isLazyContinuation) {
			listContentIndent = null;
		}
		if (!isLazyContinuation) {
			// A continued (possibly lazy) paragraph keeps its original depth.
			paragraphQuoteDepth = lineQuoteDepth + lineState.nestedQuotes;
		}
		paragraphOpen = lineState.open;
		if (paragraphOpen) {
			const refLine = acceptedListMarker
				? acceptedListMarker.afterContent
				: analysis.content;
			const completedRefDef = advanceParagraphReferenceParser(
				activeRefParser,
				refLine,
			);
			paragraphHasContent = !completedRefDef;
			paragraphRefParser = activeRefParser;
		} else {
			paragraphHasContent = false;
			paragraphRefParser = null;
		}
		advancePhpStateRange(i, i);
		i += 1;
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
