import {
	htmlBlockLineCloses,
	matchHtmlBlockOpen,
} from "../../shared/markdown/php-commonmark-block-helpers";
import {
	advanceParagraphReferenceParser,
	createParagraphReferenceParser,
	type ParagraphReferenceParser,
} from "../../shared/markdown/php-commonmark-reference-def";
import type { PhpMarkdownMathRange } from "../../shared/markdown/php-markdown-math-mask";
import {
	analyzeLine,
	type ContainerStep,
	classifyParagraphLine,
	isCommonMarkBlankLine,
	measureIndentColumns,
	peelContainerStepsForLine,
	stripContainers,
} from "./markdown-prescanner-blocks";
import type { ProtectedInlineEntry } from "./markdown-prescanner-inline";
import {
	findFirstDisplayMathInLines,
	findLineIndexForOffset,
	findLogicalLineEnd,
	type GfmTableMatch,
	type PhpDocumentMathIndex,
} from "./markdown-prescanner-tables";
import type { ProtectedBlockKind } from "./visual-schema";

/**
 * Feature-private display-math HTML/block matching, intermediate Type 1–5
 * unclosed HTML-block splitting, Type 6/7 display-math break detection, and
 * trailing paragraph/container state restoration for the prescanner.
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
	hasPrecedingContent: () => boolean;
	lines: ReadonlyArray<string>;
	mathIndex: PhpDocumentMathIndex;
	protectedInlines: Map<string, ProtectedInlineEntry>;
	sentinel: string;
}>;

export type BeforeHtmlContext = Readonly<{
	allowLeadingListMarker: boolean;
	baseContainers: ReadonlyArray<ContainerStep>;
	inParagraph: boolean;
	preMarkerListIndent: number;
}>;

export const POST_MATH_BEFORE_HTML_CONTEXT: BeforeHtmlContext = {
	allowLeadingListMarker: true,
	baseContainers: [],
	inParagraph: false,
	preMarkerListIndent: 0,
};

export type TrailingParagraphState = Readonly<{
	inIndentedCode: boolean;
	indentedCodeContainer: number;
	listContentIndent: number | null;
	paragraphHasContent: boolean;
	paragraphOpen: boolean;
	paragraphQuoteDepth: number;
	paragraphRefParser: ParagraphReferenceParser | null;
}>;

export type UnclosedHtmlBlockEmitResult =
	| Readonly<{
			kind: "resume";
			cursorOffset: number;
			rangeIdx: number;
			spanEndLine: number;
			spanEndOffset: number;
	  }>
	| Readonly<{
			kind: "done";
			afterStartOffset: number;
			spanEndLine: number;
	  }>;

export type PostDisplayMathResult =
	| Readonly<{ kind: "resume"; resumeLine: number; resumeOffset: number }>
	| Readonly<{
			kind: "done";
			activeTable: GfmTableMatch | null;
			activeTableOutputStart: number;
			spanEndLine: number;
			trailingParagraphState: TrailingParagraphState | null;
	  }>;

export type Type6Or7DisplayMathBreak = Readonly<{
	rawHtml: string;
	resumeLine: number;
	resumeOffset: number;
}>;

const EMPTY_MATH_RANGES: ReadonlyArray<PhpMarkdownMathRange> = [];

export function shiftInlineMathRanges(
	rawRanges: ReadonlyArray<PhpMarkdownMathRange> | null,
	baseOffset: number,
	endOffset: number,
	offsetShift = 0,
): ReadonlyArray<PhpMarkdownMathRange> {
	if (rawRanges === null || rawRanges.length === 0) return EMPTY_MATH_RANGES;
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
 * Computes the live paragraph / list / indented-code / reference-parser state
 * left open after emitting a post-display-math trailing line (`maskedAfter`).
 */
export function computeTrailingParagraphState(
	maskedAfter: string,
): TrailingParagraphState {
	const analysis = analyzeLine(maskedAfter, 0);
	const acceptedListMarker = analysis.listMarker;
	const listContentIndent =
		acceptedListMarker !== null ? acceptedListMarker.contentIndent : null;
	const effectiveContainer = listContentIndent ?? 0;
	const relativeIndent = analysis.indent - effectiveContainer;
	if (relativeIndent >= 4) {
		return {
			inIndentedCode: true,
			indentedCodeContainer: effectiveContainer,
			listContentIndent,
			paragraphHasContent: false,
			paragraphOpen: false,
			paragraphQuoteDepth: 0,
			paragraphRefParser: null,
		};
	}
	const lineState = classifyParagraphLine(
		analysis.content,
		relativeIndent,
		false,
		false,
	);
	if (!lineState.open) {
		return {
			inIndentedCode: false,
			indentedCodeContainer: 0,
			listContentIndent,
			paragraphHasContent: false,
			paragraphOpen: false,
			paragraphQuoteDepth: 0,
			paragraphRefParser: null,
		};
	}
	const refParser = createParagraphReferenceParser();
	const refLine = acceptedListMarker
		? acceptedListMarker.afterContent
		: analysis.content;
	const completedRefDef = advanceParagraphReferenceParser(refParser, refLine);
	return {
		inIndentedCode: false,
		indentedCodeContainer: 0,
		listContentIndent,
		paragraphHasContent: !completedRefDef,
		paragraphOpen: true,
		paragraphQuoteDepth: analysis.quoteDepth + lineState.nestedQuotes,
		paragraphRefParser: refParser,
	};
}

/**
 * Reports whether `maskedText` opens an unclosed CommonMark §4.6 Type 1–5 HTML
 * block (`<!--`, `<pre>`, `<script>`, `<style>`, `<textarea>`, `<?`, `<!`,
 * `<![CDATA[`). When `requireTopLevel` is true, container-wrapped openings are
 * excluded because `\n\n` closes outer blockquote/list containers.
 */
export function matchUnclosedHtmlBlockTypes1To5(
	maskedText: string,
	context: BeforeHtmlContext,
	requireTopLevel: boolean,
): 1 | 2 | 3 | 4 | 5 | null {
	if (!maskedText.includes("<")) return null;
	const peeled = peelContainerStepsForLine(
		maskedText,
		context.baseContainers,
		context.preMarkerListIndent,
		context.allowLeadingListMarker,
		true,
	);
	if (
		peeled === null ||
		(requireTopLevel && peeled.containers.length > 0) ||
		measureIndentColumns(peeled.rest, peeled.column) >= 4
	) {
		return null;
	}
	const trimmed = peeled.rest.replace(/^[ \t]+/, "");
	const htmlType = matchHtmlBlockOpen(trimmed, false);
	return htmlType !== null &&
		htmlType <= 5 &&
		!htmlBlockLineCloses(htmlType as 1 | 2 | 3 | 4 | 5, trimmed)
		? (htmlType as 1 | 2 | 3 | 4 | 5)
		: null;
}

/**
 * Matches a self-contained HTML block segment immediately before `\n\n<MATH>\n\n`
 * (Type 6/7 closed by `\n\n`, closed Type 1–5, or container-scoped Type 1–5).
 */
export function matchStandaloneBeforeHtmlBlock(
	rawBeforeText: string,
	maskedBeforeText: string,
	context: BeforeHtmlContext,
): Readonly<{ linePrefix: string; rawHtml: string }> | null {
	if (!maskedBeforeText.includes("<")) return null;
	const peeled = peelContainerStepsForLine(
		maskedBeforeText,
		context.baseContainers,
		context.preMarkerListIndent,
		context.allowLeadingListMarker,
		true,
	);
	if (
		peeled === null ||
		measureIndentColumns(peeled.rest, peeled.column) >= 4
	) {
		return null;
	}
	const trimmed = peeled.rest.replace(/^[ \t]+/, "");
	if (!trimmed.startsWith("<")) return null;
	const baseContainerCount =
		context.baseContainers.length + (context.preMarkerListIndent > 0 ? 1 : 0);
	const effectiveInParagraph =
		context.inParagraph && peeled.containers.length === baseContainerCount;
	if (matchHtmlBlockOpen(trimmed, !effectiveInParagraph) === null) return null;
	const rawPeeled = peelContainerStepsForLine(
		rawBeforeText,
		context.baseContainers,
		context.preMarkerListIndent,
		context.allowLeadingListMarker,
		true,
	);
	return {
		linePrefix: rawPeeled?.linePrefix ?? peeled.linePrefix,
		rawHtml: (rawPeeled?.rest ?? peeled.rest).replace(/^[ \t]+/, ""),
	};
}

/**
 * Checks whether any continuation line `startLine + 1 .. htmlEndLine` of a
 * Type 6/7 HTML block contains display math (`$$...$$` / `\[...\]`). If so,
 * returns the raw HTML ending right before that display math (including any
 * non-blank prefix on the breaking line) and the resume coordinates.
 */
export function findType6Or7DisplayMathBreak(
	mathIndex: PhpDocumentMathIndex,
	lines: ReadonlyArray<string>,
	firstLineContent: string,
	containers: ReadonlyArray<ContainerStep>,
	startLine: number,
	htmlEndLine: number,
): Type6Or7DisplayMathBreak | null {
	for (let k = startLine + 1; k <= htmlEndLine; k += 1) {
		const disp = findFirstDisplayMathInLines(mathIndex, k, k);
		if (disp === null) continue;
		const kStart = mathIndex.lineStarts[k] ?? 0;
		const strippedBefore = stripContainers(
			mathIndex.normalized.slice(kStart, disp.from),
			containers,
		);
		const rawHtmlLines: string[] = [firstLineContent];
		for (let j = startLine + 1; j < k; j += 1) {
			rawHtmlLines.push(stripContainers(lines[j] ?? "", containers) ?? "");
		}
		if (strippedBefore !== null && !isCommonMarkBlankLine(strippedBefore)) {
			rawHtmlLines.push(strippedBefore);
		}
		return {
			rawHtml: rawHtmlLines.join("\n"),
			resumeLine: k,
			resumeOffset: disp.from,
		};
	}
	return null;
}

type LineHtmlCloseScanResult = Readonly<{
	closed: boolean;
	htmlEndOffset: number;
	rangeIdx: number;
	resumeAtOffset: number;
	spanEndLine: number;
	spanEndOffset: number;
}>;

function extendLogicalSpanForDisplayMath(
	mathIndex: PhpDocumentMathIndex,
	range: PhpMarkdownMathRange,
	spanEndLine: number,
	spanEndOffset: number,
): Readonly<{ spanEndLine: number; spanEndOffset: number }> {
	if (range.to <= spanEndOffset) return { spanEndLine, spanEndOffset };
	const rangeEndLine = findLineIndexForOffset(
		mathIndex,
		Math.max(range.from, range.to - 1),
	);
	const extendedEndLine = findLogicalLineEnd(mathIndex, rangeEndLine);
	return extendedEndLine > spanEndLine
		? {
				spanEndLine: extendedEndLine,
				spanEndOffset: mathIndex.lineEnds[extendedEndLine] ?? spanEndOffset,
			}
		: { spanEndLine, spanEndOffset };
}

/**
 * Scans segments of one logical line `[startOffset, initialSpanEndOffset)`
 * partitioned by display-math blocks, checking `htmlBlockLineCloses` on
 * `mathIndex.maskedDoc` so closers inside `$-->$` / `$$ --> $$` never trigger
 * while any real closer stops right BEFORE a trailing display-math block.
 */
export function findDisplayMathAwareHtmlBlockCloseOnLine(
	mathIndex: PhpDocumentMathIndex,
	htmlType: 1 | 2 | 3 | 4 | 5,
	startOffset: number,
	initialSpanEndLine: number,
	initialSpanEndOffset: number,
	initialRangeIdx: number,
): LineHtmlCloseScanResult {
	const ranges = mathIndex.ranges;
	let htmlCursor = startOffset;
	let rangeIdx = initialRangeIdx;
	let spanEndLine = initialSpanEndLine;
	let spanEndOffset = initialSpanEndOffset;

	while (true) {
		let laterDisplay: PhpMarkdownMathRange | null = null;
		while (rangeIdx < ranges.length) {
			const candidate = ranges[rangeIdx];
			if (!candidate || candidate.from >= spanEndOffset) break;
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
				htmlType,
				mathIndex.maskedDoc.slice(htmlCursor, segEnd),
			)
		) {
			return {
				closed: true,
				htmlEndOffset: segEnd,
				rangeIdx,
				resumeAtOffset: laterDisplay !== null ? laterDisplay.from : -1,
				spanEndLine,
				spanEndOffset,
			};
		}
		if (laterDisplay === null) {
			return {
				closed: false,
				htmlEndOffset: spanEndOffset,
				rangeIdx,
				resumeAtOffset: -1,
				spanEndLine,
				spanEndOffset,
			};
		}
		rangeIdx += 1;
		const extended = extendLogicalSpanForDisplayMath(
			mathIndex,
			laterDisplay,
			spanEndLine,
			spanEndOffset,
		);
		spanEndLine = extended.spanEndLine;
		spanEndOffset = extended.spanEndOffset;
		htmlCursor = laterDisplay.to;
	}
}

/**
 * Emits an unclosed top-level Type 1–5 HTML block opening in an intermediate
 * segment before display math, stopping right before any trailing display-math
 * block on the closing line so `emitDisplayMathLineSegments` continues cleanly.
 */
export function emitUnclosedIntermediateHtmlBlock(
	env: DisplayMathEmitEnv,
	unclosedType: 1 | 2 | 3 | 4 | 5,
	rawTrimStart: number,
	firstDisplay: PhpMarkdownMathRange,
	initialSpanEndLine: number,
	initialSpanEndOffset: number,
	initialRangeIdx: number,
	emittedAny: boolean,
): UnclosedHtmlBlockEmitResult {
	const { callbacks, lines, mathIndex } = env;
	const emitRawBlock = (endOffset: number): void => {
		if (emittedAny) callbacks.pushOutputLine("", null);
		callbacks.pushOutputLine(
			callbacks.addProtectedBlock(
				"raw",
				mathIndex.normalized.slice(rawTrimStart, endOffset),
			),
			null,
		);
	};

	const extendedFirst = extendLogicalSpanForDisplayMath(
		mathIndex,
		firstDisplay,
		initialSpanEndLine,
		initialSpanEndOffset,
	);
	let scanStart = firstDisplay.to;
	let curEndLine = extendedFirst.spanEndLine;
	let curEndOffset = extendedFirst.spanEndOffset;
	let rangeIdx = initialRangeIdx;
	let lastLine = curEndLine;

	while (true) {
		const lineScan = findDisplayMathAwareHtmlBlockCloseOnLine(
			mathIndex,
			unclosedType,
			scanStart,
			curEndLine,
			curEndOffset,
			rangeIdx,
		);
		rangeIdx = lineScan.rangeIdx;
		lastLine = lineScan.spanEndLine;
		if (lineScan.closed) {
			emitRawBlock(lineScan.htmlEndOffset);
			return lineScan.resumeAtOffset >= 0
				? {
						cursorOffset: lineScan.resumeAtOffset,
						kind: "resume",
						rangeIdx: lineScan.rangeIdx,
						spanEndLine: lineScan.spanEndLine,
						spanEndOffset: lineScan.spanEndOffset,
					}
				: {
						afterStartOffset: lineScan.htmlEndOffset,
						kind: "done",
						spanEndLine: lineScan.spanEndLine,
					};
		}
		const nextLine = lineScan.spanEndLine + 1;
		if (nextLine >= lines.length) break;
		scanStart = mathIndex.lineStarts[nextLine] ?? 0;
		curEndLine = findLogicalLineEnd(mathIndex, nextLine);
		curEndOffset = mathIndex.lineEnds[curEndLine] ?? scanStart;
	}

	const htmlEndOffset = mathIndex.lineEnds[lastLine] ?? curEndOffset;
	emitRawBlock(htmlEndOffset);
	return { afterStartOffset: htmlEndOffset, kind: "done", spanEndLine: lastLine };
}
