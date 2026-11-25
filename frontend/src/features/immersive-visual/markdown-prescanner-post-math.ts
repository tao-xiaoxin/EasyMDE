import {
	COMMONMARK_FENCE_OPEN_WITH_INFO,
	matchHtmlBlockOpen,
} from "../../shared/markdown/php-commonmark-block-helpers";
import type { PhpMarkdownMathRange } from "../../shared/markdown/php-markdown-math-mask";
import {
	type ContainerStep,
	type DetectableFence,
	findContainerBoundedFenceEnd,
	isCommonMarkBlankLine,
	measureIndentColumns,
	peelContainerStepsForLine,
} from "./markdown-prescanner-blocks";
import {
	computeTrailingParagraphState,
	type DisplayMathEmitEnv,
	type PostDisplayMathResult,
	scanHtmlBlockWithDisplayMath,
	shiftInlineMathRanges,
} from "./markdown-prescanner-display-math";
import { extractInlineProtectedSyntax } from "./markdown-prescanner-inline";
import {
	findFirstDisplayMathInLines,
	findGfmTableEnd,
	findLogicalLineEnd,
	maskedSliceForLines,
	matchPeeledGfmTableHeader,
	matchTableAlignmentMarkerLine,
} from "./markdown-prescanner-tables";

/**
 * Post-display-math segment emitters (reserved table-alignment markers,
 * HTML blocks Types 1–7, fenced code / Mermaid blocks, GFM table handoff,
 * and trailing paragraph state restoration).
 */

function tryEmitPostMathTableAlignMarker(
	env: DisplayMathEmitEnv,
	rawAfter: string,
	spanEndLine: number,
): PostDisplayMathResult | null {
	const match = matchTableAlignmentMarkerLine(
		env.lines,
		spanEndLine,
		[],
		0,
		true,
		env.mathIndex,
		rawAfter,
	);
	if (match === null) return null;
	const markerToken = env.callbacks.addTableAlignMarker(match.text);
	env.callbacks.pushOutputLine(`${match.markerPrefix}${markerToken}`, null);
	return {
		activeTable: null,
		activeTableOutputStart: -1,
		kind: "done",
		openedContainers: match.containers.length > 0 ? match.containers : null,
		spanEndLine,
		trailingParagraphState: null,
	};
}

function tryEmitPostMathHtmlBlock(
	env: DisplayMathEmitEnv,
	rawAfter: string,
	afterPeeled: Readonly<{
		containers: ReadonlyArray<ContainerStep>;
		linePrefix: string;
		rest: string;
	}>,
	afterTrimmed: string,
	spanEndLine: number,
	spanEndOffset: number,
): PostDisplayMathResult | null {
	const htmlType = matchHtmlBlockOpen(afterTrimmed, true);
	if (htmlType === null) return null;
	const { callbacks, lines, mathIndex } = env;
	const rawPeeled = peelContainerStepsForLine(rawAfter, [], 0, true, true);
	const rawFirstContent = (rawPeeled?.rest ?? afterPeeled.rest).replace(
		/^[ \t]+/,
		"",
	);
	const htmlPrefix = rawPeeled?.linePrefix ?? afterPeeled.linePrefix;
	const startContentOffset = spanEndOffset - rawFirstContent.length;
	const firstLineMasked = mathIndex.maskedDoc.slice(
		startContentOffset,
		spanEndOffset,
	);
	const htmlScan = scanHtmlBlockWithDisplayMath(
		mathIndex,
		lines,
		htmlType,
		afterPeeled.containers,
		spanEndLine,
		startContentOffset,
		rawFirstContent,
		firstLineMasked,
	);
	callbacks.pushOutputLine(
		`${htmlPrefix}${callbacks.addProtectedBlock("raw", htmlScan.rawHtml)}`,
		null,
	);
	if (htmlScan.kind === "break") {
		return {
			kind: "resume",
			resumeLine: htmlScan.resumeLine,
			resumeOffset: htmlScan.resumeOffset,
		};
	}
	return {
		activeTable: null,
		activeTableOutputStart: -1,
		kind: "done",
		openedContainers:
			afterPeeled.containers.length > 0 ? afterPeeled.containers : null,
		spanEndLine: htmlScan.endLine,
		trailingParagraphState: null,
	};
}

function tryEmitPostMathFence(
	env: DisplayMathEmitEnv,
	rawAfter: string,
	afterPeeled: Readonly<{
		containers: ReadonlyArray<ContainerStep>;
		rest: string;
	}>,
	afterTrimmed: string,
	spanEndLine: number,
): PostDisplayMathResult | null {
	const fenceMatch = COMMONMARK_FENCE_OPEN_WITH_INFO.exec(afterTrimmed);
	const fenceOpening = fenceMatch?.[1];
	if (
		!fenceOpening ||
		(fenceOpening[0] === "`" && (fenceMatch[2] ?? "").includes("`"))
	) {
		return null;
	}
	const { callbacks, lines } = env;
	const rawPeeled = peelContainerStepsForLine(rawAfter, [], 0, true, true);
	const rawFirstContent = (rawPeeled?.rest ?? afterPeeled.rest).replace(
		/^[ \t]+/,
		"",
	);
	const info =
		COMMONMARK_FENCE_OPEN_WITH_INFO.exec(rawFirstContent)?.[2] ??
		fenceMatch[2] ??
		"";
	let quoteDepth = 0;
	for (const step of afterPeeled.containers) {
		if (step.kind === "blockquote") quoteDepth += 1;
	}
	const fence: DetectableFence = {
		containerIndent: 0,
		containers: afterPeeled.containers,
		fenceChar: fenceOpening[0] === "~" ? "~" : "`",
		fenceLength: fenceOpening.length,
		info,
		quoteDepth,
	};
	const fenceEndLine = findContainerBoundedFenceEnd(lines, spanEndLine, fence);
	const lang = (info.trim().split(/\s+/)[0] ?? "").toLowerCase();
	if (lang === "mermaid" && afterPeeled.containers.length === 0) {
		const rawMermaid = [
			rawFirstContent,
			...lines.slice(spanEndLine + 1, fenceEndLine + 1),
		].join("\n");
		callbacks.pushOutputLine(
			callbacks.addProtectedBlock("mermaid", rawMermaid),
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
		kind: "done",
		openedContainers:
			afterPeeled.containers.length > 0 ? afterPeeled.containers : null,
		spanEndLine: fenceEndLine,
		trailingParagraphState: null,
	};
}

/**
 * Evaluates and emits the trailing segment after the final display-math block
 * on `spanEndLine`: HTML block (Types 1–7), fenced code block (including
 * Mermaid), GFM table handoff, or plain trailing line restoring live state.
 */
export function emitPostDisplayMathSegment(
	env: DisplayMathEmitEnv,
	spanEndLine: number,
	afterStartOffset: number,
	spanEndOffset: number,
	afterInlineRanges: ReadonlyArray<PhpMarkdownMathRange> | null,
): PostDisplayMathResult {
	const {
		callbacks,
		getOutputLength,
		lines,
		mathIndex,
		protectedInlines,
		sentinel,
	} = env;
	const emptyDone: PostDisplayMathResult = {
		activeTable: null,
		activeTableOutputStart: -1,
		kind: "done",
		openedContainers: null,
		spanEndLine,
		trailingParagraphState: null,
	};
	if (afterStartOffset >= spanEndOffset) return emptyDone;
	const rawAfter = mathIndex.normalized.slice(afterStartOffset, spanEndOffset);
	if (isCommonMarkBlankLine(rawAfter)) return emptyDone;

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
		if (afterIndent <= 3 && afterTrimmed.startsWith("<")) {
			const tableAlignResult = tryEmitPostMathTableAlignMarker(
				env,
				rawAfter,
				spanEndLine,
			);
			if (tableAlignResult !== null) return tableAlignResult;
			const htmlResult = tryEmitPostMathHtmlBlock(
				env,
				rawAfter,
				afterPeeled,
				afterTrimmed,
				spanEndLine,
				spanEndOffset,
			);
			if (htmlResult !== null) return htmlResult;
		}
		if (
			afterIndent <= 3 &&
			(afterTrimmed.startsWith("`") || afterTrimmed.startsWith("~"))
		) {
			const fenceResult = tryEmitPostMathFence(
				env,
				rawAfter,
				afterPeeled,
				afterTrimmed,
				spanEndLine,
			);
			if (fenceResult !== null) return fenceResult;
		}
		const delimiterLine = spanEndLine + 1;
		if (
			delimiterLine < lines.length &&
			(lines[delimiterLine] ?? "").includes("-") &&
			findLogicalLineEnd(mathIndex, delimiterLine) === delimiterLine &&
			findFirstDisplayMathInLines(mathIndex, delimiterLine, delimiterLine) ===
				null &&
			matchPeeledGfmTableHeader(
				afterPeeled,
				maskedSliceForLines(mathIndex, lines, delimiterLine, delimiterLine),
				false,
			)
		) {
			const tableEnd = findGfmTableEnd(
				lines,
				delimiterLine,
				afterPeeled.containers,
				mathIndex,
			);
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
					maskedAfter,
				),
				null,
			);
			return {
				activeTable: {
					brokenByDisplayMathLine: tableEnd.brokenByDisplayMathLine,
					containers: afterPeeled.containers,
					delimiterLine,
					endLine: tableEnd.endLine,
					headerEndLine: spanEndLine,
					lazyRowStartLines: tableEnd.lazyRowStartLines,
				},
				activeTableOutputStart,
				kind: "done",
				openedContainers: null,
				spanEndLine,
				trailingParagraphState: null,
			};
		}
	}

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
			maskedAfter,
		),
		null,
	);
	return {
		activeTable: null,
		activeTableOutputStart: -1,
		kind: "done",
		openedContainers: null,
		spanEndLine,
		trailingParagraphState: computeTrailingParagraphState(maskedAfter),
	};
}
