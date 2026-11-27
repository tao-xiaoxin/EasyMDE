import { matchLeagueHtmlInlineAt } from "../../../shared/markdown/markdown-html-scanners";
import { hasOddPrecedingBackslashes } from "../../../shared/markdown/markdown-source-projection";
import { createContainerCodeLineStepper } from "../markdown-prescanner-blocks";
import {
	type ClassifiedLineContainers,
	type ContainerFrame,
	isMarkdownBlankLine,
	matchContainerFrames,
	retainFramesAcrossBlankLine,
	stripTrailingAsciiSpaceTab,
} from "../markdown-prescanner-containers";
import {
	createInlineScanCache,
	scanInlineMathOrDoubleDollar,
	skipInlineCodeSpan,
} from "../markdown-prescanner-inline";

/**
 * DOM-free, strictly linear O(N) CommonMark `html_input: 'strip'` Markdown
 * preprocessor for protected `raw` HTML preview cards, preserving surrounding
 * container boundaries, nested list structure, ordered-list numbering, and
 * paragraph breaks to match PHP `EasyMDE\Content\MarkdownRenderer`
 * (`league/commonmark` 2.8.2).
 */

export function isHtmlComment(raw: string): boolean {
	const trimmed = raw.trim();
	return (
		trimmed === "<!-->" ||
		trimmed === "<!--->" ||
		(trimmed.startsWith("<!--") && trimmed.endsWith("-->"))
	);
}

/**
 * Strip League CommonMark 2.8.2 inline HTML tokens outside backtick code spans
 * and recognized math spans using the canonical linear O(L)
 * `matchLeagueHtmlInlineAt()` scanner, honoring CommonMark backslash escapes.
 */
export function stripInlineHtmlOutsideCode(line: string): string {
	let out = "";
	let i = 0;
	const len = line.length;
	const cache = createInlineScanCache(line);
	while (i < len) {
		const ch = line[i] ?? "";
		if (ch === "`" && !hasOddPrecedingBackslashes(line, i)) {
			const codeEnd = skipInlineCodeSpan(line, i, cache);
			out += line.slice(i, codeEnd);
			i = codeEnd;
			continue;
		}
		const mathScan = scanInlineMathOrDoubleDollar(line, i, false, cache);
		if (mathScan) {
			out += line.slice(i, mathScan.end);
			i = mathScan.end;
			continue;
		}
		if (ch === "<" && !hasOddPrecedingBackslashes(line, i)) {
			const leagueEnd = matchLeagueHtmlInlineAt(
				line,
				i + 1,
				len,
				cache.angleCache,
				cache.htmlDialect,
			);
			if (leagueEnd > i) {
				i = leagueEnd;
				continue;
			}
		}
		out += ch;
		i += 1;
	}
	return out;
}

function isSameListFrame(
	left: ContainerFrame | undefined,
	right: ContainerFrame | undefined,
): boolean {
	return (
		left?.kind === "list" &&
		right?.kind === "list" &&
		left.marker === right.marker
	);
}

function isSiblingListClassification(
	frames: ReadonlyArray<ContainerFrame>,
	matchedCount: number,
	classified: ClassifiedLineContainers | null,
): boolean {
	return (
		classified !== null &&
		matchedCount < frames.length &&
		classified.matchedCount === matchedCount &&
		isSameListFrame(frames[matchedCount], classified.blockFrames[matchedCount])
	);
}

function shrinkBreakFramesForHtmlLine(
	baseFrames: ReadonlyArray<ContainerFrame>,
	rawLine: string,
	classified: ClassifiedLineContainers,
): ReadonlyArray<ContainerFrame> {
	const count = matchContainerFrames(rawLine, baseFrames).matchedCount;
	if (isSiblingListClassification(baseFrames, count, classified)) {
		return baseFrames.slice(0, count + 1);
	}
	return baseFrames.slice(0, count);
}

function hasNewlyOpenedListFrame(classified: ClassifiedLineContainers): boolean {
	for (let k = classified.matchedCount; k < classified.blockFrames.length; k += 1) {
		if (classified.blockFrames[k]?.kind === "list") return true;
	}
	return false;
}

/**
 * Strip raw HTML blocks and inline tags from a protected `raw` Markdown block
 * using CommonMark `html_input: 'strip'` semantics (matching EasyMDE's `main`
 * PHP `MarkdownRenderer`), keeping inner blank-line-separated Markdown intact.
 */
export function stripCommonMarkHtmlForPreview(rawMarkdown: string): string {
	const lines = rawMarkdown.replace(/\r\n?/g, "\n").split("\n");
	const kept: string[] = [];
	const stepper = createContainerCodeLineStepper({ detectHtmlBlocks: true });
	let hasVisibleContent = false;
	let lastKeptBlankDepth: number | null = null;
	let lastKeptFrames: ReadonlyArray<ContainerFrame> = [];
	let openParagraphFrames: ReadonlyArray<ContainerFrame> | null = null;
	let pendingBreakFrames: ReadonlyArray<ContainerFrame> | null = null;
	// CommonMark §5.2: an empty list item (e.g. `-` synthesized from `- <pre>`)
	// closes on its first blank line. Defer blank lines immediately after such a
	// synthesized opener until we see whether the next line continues inside it
	// (drop blank so the child stays in `<li>`) or exits it (flush blank so a
	// loose list like `10. A\n11. <!-- c -->\n\n12. B` stays loose).
	let emptyHtmlListFrames: ReadonlyArray<ContainerFrame> | null = null;
	let deferredBlankAfterEmptyList: string | null = null;

	const resolveDeferredBlankForLine = (rawLine: string): void => {
		if (!emptyHtmlListFrames) return;
		const matched = matchContainerFrames(rawLine, emptyHtmlListFrames);
		if (matched.exitedContainer && deferredBlankAfterEmptyList !== null) {
			kept.push(deferredBlankAfterEmptyList);
		}
		emptyHtmlListFrames = null;
		deferredBlankAfterEmptyList = null;
	};

	const flushPendingBreakForLine = (
		rawLine: string,
		lineClassified: ClassifiedLineContainers | null,
	): void => {
		if (pendingBreakFrames === null) return;
		const matched = matchContainerFrames(rawLine, pendingBreakFrames);
		if (
			!isSiblingListClassification(
				pendingBreakFrames,
				matched.matchedCount,
				lineClassified,
			)
		) {
			kept.push(stripTrailingAsciiSpaceTab(matched.prefix));
		}
		pendingBreakFrames = null;
	};

	for (const line of lines) {
		const stepped = stepper.step(line);
		if (stepped === "blank") {
			if (emptyHtmlListFrames) {
				const matchedCount = matchContainerFrames(
					line,
					emptyHtmlListFrames,
				).matchedCount;
				const retained = retainFramesAcrossBlankLine(
					emptyHtmlListFrames,
					matchedCount,
				);
				if (retained.length === emptyHtmlListFrames.length) {
					if (deferredBlankAfterEmptyList === null) {
						deferredBlankAfterEmptyList = isMarkdownBlankLine(line) ? "" : line;
					}
					openParagraphFrames = null;
					continue;
				}
				if (deferredBlankAfterEmptyList !== null) {
					kept.push(deferredBlankAfterEmptyList);
				}
				emptyHtmlListFrames = null;
				deferredBlankAfterEmptyList = null;
			}
			pendingBreakFrames = null;
			openParagraphFrames = null;
			const blankDepth = isMarkdownBlankLine(line)
				? 0
				: matchContainerFrames(line, lastKeptFrames).matchedCount;
			lastKeptBlankDepth =
				lastKeptBlankDepth === null
					? blankDepth
					: Math.min(lastKeptBlankDepth, blankDepth);
			lastKeptFrames = stepper.getOpenFrames();
			kept.push(isMarkdownBlankLine(line) ? "" : line);
			continue;
		}
		if (stepped === "fence" || stepped === "indented-code") {
			const lineClassified = stepper.getLastClassified();
			resolveDeferredBlankForLine(line);
			flushPendingBreakForLine(line, lineClassified);
			kept.push(line);
			hasVisibleContent = true;
			lastKeptBlankDepth = null;
			openParagraphFrames = null;
			lastKeptFrames = stepper.getOpenFrames();
			continue;
		}
		if (stepped === "html-block-blank" || stepped === "html-block-close") {
			continue;
		}
		if (stepped.kind === "html-block-open") {
			const { classified } = stepped;
			if (hasNewlyOpenedListFrame(classified)) {
				resolveDeferredBlankForLine(line);
				flushPendingBreakForLine(line, classified);
				// A bare list marker (`-`, `1.`, `> -`, `  -`) immediately after an
				// open paragraph at the same depth would parse as a Setext `<h2>`
				// underline or fail to interrupt under CommonMark §5.2; emit the
				// enclosing paragraph break first.
				if (
					openParagraphFrames !== null &&
					classified.matchedCount === openParagraphFrames.length
				) {
					const paraMatched = matchContainerFrames(line, openParagraphFrames);
					kept.push(stripTrailingAsciiSpaceTab(paraMatched.prefix));
				}
				kept.push(stripTrailingAsciiSpaceTab(classified.prefix));
				openParagraphFrames = null;
				lastKeptBlankDepth = null;
				lastKeptFrames = classified.blockFrames;
				const lastFrame =
					classified.blockFrames[classified.blockFrames.length - 1];
				emptyHtmlListFrames =
					lastFrame?.kind === "list" ? classified.blockFrames : null;
				deferredBlankAfterEmptyList = null;
				continue;
			}

			if (
				emptyHtmlListFrames &&
				!matchContainerFrames(line, emptyHtmlListFrames).exitedContainer
			) {
				// Subsequent HTML block inside an already-empty synthesized list item.
				openParagraphFrames = null;
				continue;
			}
			resolveDeferredBlankForLine(line);
			openParagraphFrames = null;
			if (kept.length > 0 && hasVisibleContent) {
				const shrunk = shrinkBreakFramesForHtmlLine(
					pendingBreakFrames ?? lastKeptFrames,
					line,
					classified,
				);
				if (lastKeptBlankDepth === null || shrunk.length < lastKeptBlankDepth) {
					pendingBreakFrames = shrunk;
					lastKeptBlankDepth = null;
				}
			}
			continue;
		}

		const { classified } = stepped;
		const strippedLine = stripInlineHtmlOutsideCode(line);
		if (classified.inParagraph && isMarkdownBlankLine(strippedLine)) {
			// A stripped inline-only HTML line (e.g. standalone `<kbd>`) inside
			// an open paragraph must not emit a blank line and split the `<p>`.
			continue;
		}
		resolveDeferredBlankForLine(line);
		flushPendingBreakForLine(line, classified);
		kept.push(strippedLine);
		hasVisibleContent = true;
		lastKeptBlankDepth = null;
		lastKeptFrames = stepper.getOpenFrames();
		openParagraphFrames = classified.paragraphContinues ? lastKeptFrames : null;
	}

	if (!hasVisibleContent) {
		return "";
	}
	return kept
		.join("\n")
		.replace(/^(?:[ \t]*\n)+/, "")
		.replace(/(?:\n[ \t]*)+$/, "");
}
