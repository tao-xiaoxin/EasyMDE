import {
	advancePhpCommonMarkBlockLine,
	createPhpCommonMarkBlockState,
	scanLinesIntoPhpCommonMarkBlockState,
} from "../../shared/markdown/php-commonmark-block-engine";
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
	hasListBeforeQuote,
	isCommonMarkBlankLine,
	measureIndentColumns,
	peelContainerStepsForLine,
	stripContainers,
	sumListContainerIndent,
} from "./markdown-prescanner-blocks";
import type { ProtectedInlineEntry } from "./markdown-prescanner-inline";
import {
	createPhpDocumentMathIndex,
	findFirstDisplayMathInOffsetSlice,
	findLineIndexForOffset,
	findLogicalLineEnd,
	firstMathRangeEndingAfter,
	type GfmTableMatch,
	maskedSliceForLines,
	type PhpDocumentMathIndex,
} from "./markdown-prescanner-tables";
import type { ProtectedBlockKind } from "./visual-schema";

export {
	buildInlineMaskedDisplayMathLine,
	continuesInlineMaskedRefDefAtLine,
	continuesValidReferenceDefinition,
	startsValidReferenceDefinition,
} from "./markdown-prescanner-refdef";

/**
 * Feature-private display-math HTML/block matching, intermediate Type 1–5
 * unclosed HTML-block splitting, Type 6/7 display-math break detection, and
 * trailing paragraph/container state restoration for the prescanner.
 */

type TableEmitCallbacks = Readonly<{
	addProtectedBlock: (kind: ProtectedBlockKind, rawMarkdown: string) => string;
	addTableAlignMarker: (markerText: string) => string;
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
	activeRefParser: ParagraphReferenceParser | null;
	allowLeadingListMarker: boolean;
	baseContainers: ReadonlyArray<ContainerStep>;
	inParagraph: boolean;
	paragraphHasPipe?: boolean;
	preMarkerListIndent: number;
}>;

export const POST_MATH_BEFORE_HTML_CONTEXT: BeforeHtmlContext = {
	activeRefParser: null,
	allowLeadingListMarker: true,
	baseContainers: [],
	inParagraph: false,
	paragraphHasPipe: false,
	preMarkerListIndent: 0,
};

export type TrailingParagraphState = Readonly<{
	inIndentedCode: boolean;
	indentedCodeContainer: number;
	listContentIndent: number | null;
	paragraphHasContent: boolean;
	paragraphHasPipe: boolean;
	paragraphOpen: boolean;
	paragraphQuoteDepth: number;
	paragraphRefParser: ParagraphReferenceParser | null;
}>;

type UnclosedHtmlBlockEmitResult =
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
			openedContainers: ReadonlyArray<ContainerStep> | null;
			spanEndLine: number;
			trailingParagraphState: TrailingParagraphState | null;
	  }>;

export type HtmlBlockScanResult =
	| Readonly<{
			kind: "break";
			rawHtml: string;
			resumeLine: number;
			resumeOffset: number;
	  }>
	| Readonly<{
			endLine: number;
			kind: "complete";
			rawHtml: string;
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
			paragraphHasPipe: false,
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
			paragraphHasPipe: false,
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
		paragraphHasPipe: !completedRefDef && refLine.includes("|"),
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
 * Unified single-pass O(N) scanner for CommonMark §4.6 Types 1–7 HTML blocks
 * (top-level or container-wrapped) with full PHP math-extraction parity:
 * - Advances every step by `findLogicalLineEnd(mathIndex, k)` so blank lines
 *   inside multiline `\(...\)` never split Type 6/7 HTML blocks.
 * - Terminates Type 6/7 and container-wrapped Type 1–5 blocks immediately at
 *   `disp.from` on `startLine` or any continuation line (eliminating O(N^2)
 *   re-scans over repeated `<div>\nfoo\n$$x$$` blocks).
 * - For top-level Type 1–5 blocks, closes before any display-math span on the
 *   opening or closing line whenever a real closer precedes `disp.from`, while
 *   keeping unclosed display math inside the HTML block.
 * - Defers blank lines in unclosed list-contained Type 1–5 blocks until a
 *   subsequent non-blank line remains inside `containers`.
 */
export function scanHtmlBlockWithDisplayMath(
	mathIndex: PhpDocumentMathIndex,
	lines: ReadonlyArray<string>,
	htmlType: 1 | 2 | 3 | 4 | 5 | 6 | 7,
	containers: ReadonlyArray<ContainerStep>,
	initialFirstLineEndLine: number,
	startContentOffset: number,
	initialFirstLineRaw: string,
	firstLineMasked: string,
): HtmlBlockScanResult {
	let firstLineEndLine = initialFirstLineEndLine;
	let firstLineRaw = initialFirstLineRaw;
	const firstLineEndOffset =
		mathIndex.lineEnds[firstLineEndLine] ?? startContentOffset;
	const hasContainers = containers.length > 0;
	const isType6Or7 = htmlType === 6 || htmlType === 7;
	const hasListContainer =
		hasContainers && containers.some((step) => step.kind === "list");

	if (isType6Or7 || hasContainers) {
		const firstDisp = findFirstDisplayMathInOffsetSlice(
			mathIndex,
			startContentOffset,
			firstLineEndOffset,
		);
		if (firstDisp !== null) {
			return {
				kind: "break",
				rawHtml: mathIndex.normalized.slice(startContentOffset, firstDisp.from),
				resumeLine: findLineIndexForOffset(mathIndex, firstDisp.from),
				resumeOffset: firstDisp.from,
			};
		}
		if (!isType6Or7 && htmlBlockLineCloses(htmlType, firstLineMasked)) {
			return {
				endLine: firstLineEndLine,
				kind: "complete",
				rawHtml: firstLineRaw,
			};
		}
	} else {
		const firstScan = findDisplayMathAwareHtmlBlockCloseOnLine(
			mathIndex,
			htmlType,
			startContentOffset,
			firstLineEndLine,
			firstLineEndOffset,
			firstMathRangeEndingAfter(mathIndex.ranges, startContentOffset),
		);
		if (firstScan.closed) {
			if (firstScan.resumeAtOffset >= 0) {
				return {
					kind: "break",
					rawHtml: mathIndex.normalized.slice(
						startContentOffset,
						firstScan.htmlEndOffset,
					),
					resumeLine: findLineIndexForOffset(
						mathIndex,
						firstScan.resumeAtOffset,
					),
					resumeOffset: firstScan.resumeAtOffset,
				};
			}
			return {
				endLine: firstScan.spanEndLine,
				kind: "complete",
				rawHtml: mathIndex.normalized.slice(
					startContentOffset,
					firstScan.htmlEndOffset,
				),
			};
		}
		firstLineEndLine = firstScan.spanEndLine;
		firstLineRaw = mathIndex.normalized.slice(
			startContentOffset,
			firstScan.spanEndOffset,
		);
	}

	const rawHtmlLines: string[] = [firstLineRaw];
	const pendingBlankRawLines: string[] = [];
	let endLine = firstLineEndLine;
	let k = firstLineEndLine + 1;

	while (k < lines.length) {
		const kEnd = findLogicalLineEnd(mathIndex, k);
		const kStartOffset = mathIndex.lineStarts[k] ?? 0;
		const kEndOffset = mathIndex.lineEnds[kEnd] ?? kStartOffset;

		if (isType6Or7 || hasContainers) {
			const maskedLogical = maskedSliceForLines(mathIndex, lines, k, kEnd);
			const afterContainers = hasContainers
				? stripContainers(maskedLogical, containers)
				: maskedLogical;
			if (afterContainers === null) {
				break;
			}
			if (isType6Or7 && isCommonMarkBlankLine(afterContainers)) {
				break;
			}
			const disp = findFirstDisplayMathInOffsetSlice(
				mathIndex,
				kStartOffset,
				kEndOffset,
			);
			if (disp !== null) {
				const rawBefore = mathIndex.normalized.slice(kStartOffset, disp.from);
				const strippedBefore = hasContainers
					? stripContainers(rawBefore, containers)
					: rawBefore;
				if (
					strippedBefore !== null &&
					!isCommonMarkBlankLine(strippedBefore)
				) {
					if (pendingBlankRawLines.length > 0) {
						rawHtmlLines.push(...pendingBlankRawLines);
						pendingBlankRawLines.length = 0;
					}
					rawHtmlLines.push(strippedBefore);
				}
				return {
					kind: "break",
					rawHtml: rawHtmlLines.join("\n"),
					resumeLine: findLineIndexForOffset(mathIndex, disp.from),
					resumeOffset: disp.from,
				};
			}

			const rawLogical =
				k === kEnd
					? (lines[k] ?? "")
					: mathIndex.normalized.slice(kStartOffset, kEndOffset);
			const strippedRaw = hasContainers
				? (stripContainers(rawLogical, containers) ?? "")
				: rawLogical;

			if (
				!isType6Or7 &&
				hasListContainer &&
				isCommonMarkBlankLine(afterContainers)
			) {
				pendingBlankRawLines.push(strippedRaw);
				k = kEnd + 1;
				continue;
			}

			if (pendingBlankRawLines.length > 0) {
				rawHtmlLines.push(...pendingBlankRawLines);
				pendingBlankRawLines.length = 0;
			}
			rawHtmlLines.push(strippedRaw);
			endLine = kEnd;
			if (!isType6Or7 && htmlBlockLineCloses(htmlType, afterContainers)) {
				return { endLine, kind: "complete", rawHtml: rawHtmlLines.join("\n") };
			}
			k = kEnd + 1;
			continue;
		}

		const lineScan = findDisplayMathAwareHtmlBlockCloseOnLine(
			mathIndex,
			htmlType,
			kStartOffset,
			kEnd,
			kEndOffset,
			firstMathRangeEndingAfter(mathIndex.ranges, kStartOffset),
		);
		if (lineScan.closed) {
			rawHtmlLines.push(
				mathIndex.normalized.slice(kStartOffset, lineScan.htmlEndOffset),
			);
			if (lineScan.resumeAtOffset >= 0) {
				return {
					kind: "break",
					rawHtml: rawHtmlLines.join("\n"),
					resumeLine: findLineIndexForOffset(mathIndex, lineScan.resumeAtOffset),
					resumeOffset: lineScan.resumeAtOffset,
				};
			}
			return {
				endLine: lineScan.spanEndLine,
				kind: "complete",
				rawHtml: rawHtmlLines.join("\n"),
			};
		}
		rawHtmlLines.push(
			mathIndex.normalized.slice(kStartOffset, lineScan.spanEndOffset),
		);
		endLine = lineScan.spanEndLine;
		k = lineScan.spanEndLine + 1;
	}

	return { endLine, kind: "complete", rawHtml: rawHtmlLines.join("\n") };
}

type LineHtmlCloseScanResult = Readonly<{
	closed: boolean;
	htmlEndOffset: number;
	rangeIdx: number;
	resumeAtOffset: number;
	spanEndLine: number;
	spanEndOffset: number;
}>;

export function extendLogicalSpanForDisplayMath(
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
function findDisplayMathAwareHtmlBlockCloseOnLine(
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

/**
 * Mirrors, for one `prescanMarkdown` pass, the PHP `MarkdownRenderer` state
 * the prescanner consults: the document-wide authoritative math index (PHP
 * `extract_math()` after code-region masking) and the CommonMark block
 * container state, advanced over raw, masked, closed-block, and
 * display-math-replaced lines.
 */
export function createPrescanPhpTracker(
	normalized: string,
	lines: ReadonlyArray<string>,
) {
	const state = createPhpCommonMarkBlockState(false, false);
	const mathIndex = createPhpDocumentMathIndex(normalized, lines);
	const advanceRange = (from: number, toInclusive: number): void => {
		for (let k = from; k <= toInclusive; k += 1) {
			advancePhpCommonMarkBlockLine(state, lines[k] ?? "");
		}
	};
	const advanceMaskedLines = (fromLine: number, toLine: number): void => {
		const masked = maskedSliceForLines(mathIndex, lines, fromLine, toLine);
		if (masked.includes("\n")) scanLinesIntoPhpCommonMarkBlockState(state, masked);
		else advancePhpCommonMarkBlockLine(state, masked);
	};
	const advanceAfterDisplayMath = (
		afterStartOffset: number,
		toLineInclusive: number,
	): void => {
		const endOffset = mathIndex.lineEnds[toLineInclusive] ?? afterStartOffset;
		const postMathMasked =
			endOffset > afterStartOffset
				? mathIndex.maskedDoc.slice(afterStartOffset, endOffset)
				: "";
		if (
			postMathMasked.length === 0 &&
			state.containers.length === 0 &&
			state.leaf === null
		) {
			return;
		}
		scanLinesIntoPhpCommonMarkBlockState(state, `\n\nM\n\n${postMathMasked}`);
	};
	const advanceClosedBlock = (prefix: string, indent: number): void => {
		advancePhpCommonMarkBlockLine(
			state,
			`${prefix}${" ".repeat(Math.max(0, indent))}<!-- -->`,
		);
	};
	/** The authoritative display-math span starting exactly at `content`. */
	const displayMathAt = (
		content: string,
		lineIdx: number,
	): PhpMarkdownMathRange | null => {
		if (
			mathIndex.ranges.length === 0 ||
			!(content.startsWith("$$") || content.startsWith("\\["))
		) {
			return null;
		}
		const lineEnd = mathIndex.lineEnds[lineIdx] ?? 0;
		const range = findFirstDisplayMathInOffsetSlice(
			mathIndex,
			mathIndex.lineStarts[lineIdx] ?? 0,
			lineEnd,
		);
		return range?.from === lineEnd - content.length ? range : null;
	};
	/**
	 * Last line and exact PHP-extracted raw slice of standalone display math
	 * (nothing but blanks after its closing delimiter) starting at `content`,
	 * as found by the authoritative math index; `null` when PHP does not see
	 * display math there.
	 */
	const standaloneDisplayMath = (
		content: string,
		lineIdx: number,
	): Readonly<{ end: number; raw: string }> | null => {
		const range = displayMathAt(content, lineIdx);
		if (range === null) return null;
		const end = findLineIndexForOffset(mathIndex, range.to - 1);
		const tail = normalized.slice(range.to, mathIndex.lineEnds[end] ?? range.to);
		return isCommonMarkBlankLine(tail)
			? { end, raw: normalized.slice(range.from, range.to) }
			: null;
	};
	/**
	 * PHP `extract_math()` replaces standalone display math with
	 * `"\n\nTOKEN\n\n"`: the token sits at column 0 behind a blank line,
	 * closing every enclosing list item and blockquote.
	 */
	const closeContainersForDisplayMath = (linePrefix: string): void => {
		scanLinesIntoPhpCommonMarkBlockState(state, `${linePrefix}\n\nM\n\n`);
	};
	/**
	 * The list content indent after a blank line, synchronized from the PHP
	 * container state (CommonMark §5.2: an empty item closes there).
	 */
	const listIndentAfterBlank = (
		listContentIndent: number | null,
	): number | null => {
		if (listContentIndent === null || hasListBeforeQuote(state.containers)) {
			return listContentIndent;
		}
		const phpIndent = sumListContainerIndent(state.containers);
		if (phpIndent >= listContentIndent) return listContentIndent;
		return phpIndent > 0 ? phpIndent : null;
	};
	return {
		advanceAfterDisplayMath,
		advanceClosedBlock,
		advanceMaskedLines,
		advanceRange,
		closeContainersForDisplayMath,
		listIndentAfterBlank,
		mathIndex,
		standaloneDisplayMath,
		state,
	};
}
