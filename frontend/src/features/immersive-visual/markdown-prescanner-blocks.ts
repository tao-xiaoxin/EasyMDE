import {
	LEAGUE_HTML_BLOCK_CLOSE_BY_TYPE,
	matchLeagueHtmlBlockType,
} from "../../shared/markdown/markdown-html-scanners";
import { hasOddPrecedingBackslashes } from "../../shared/markdown/markdown-source-projection";
import {
	ATX_HEADING,
	type ClassifiedLineContainers,
	type ContainerFrame,
	classifyLineContainers,
	formatContainerSignature,
	isInterruptingListMarker,
	isMarkdownBlankLine,
	leadingColumnsFrom,
	matchContainerFrames,
	peelContainerFrames,
	retainFramesAcrossBlankLine,
	SETEXT_UNDERLINE,
	startsContainerQuote,
	stepContainerBlockLine,
	stripLeadingAsciiSpaceTab,
	stripTrailingAsciiSpaceTab,
	THEMATIC_BREAK,
	trimAsciiSpaceTab,
} from "./markdown-prescanner-containers";
import {
	TABLE_ALIGN_PREFIX,
	TABLE_ALIGN_SUFFIX,
} from "./table-alignment-codec";

/**
 * Shared block-boundary predicates, fence/HTML/math block scanners, and
 * paragraph prose-run lookahead for the Immersive Visual prescanner.
 */

export const FOOTNOTE_DEF_LINE = /^ {0,3}\[\^([^\s\]]+)\]:(?:[ \t]|$)/;

const PAIRED_HTML_BLOCK_TAGS: ReadonlySet<string> = new Set(
	"article aside audio blockquote center details div dl fieldset figure footer form header iframe main nav ol p section summary table ul video".split(
		" ",
	),
);

export type DetectableFence = Readonly<{
	containerFrames: ReadonlyArray<ContainerFrame>;
	fenceChar: "`" | "~";
	fenceLength: number;
	info: string;
}>;

type ProseRunLine = Readonly<{
	body: string;
	prefix: string;
}>;

type ParagraphProseRun = Readonly<{
	end: number;
	lines: ReadonlyArray<ProseRunLine>;
}>;

type BlockScanCache = {
	failedBracketBySignature: Map<string, number>;
	failedDollarBySignature: Map<string, number>;
	lastCloseBracketLine: number;
	lastCloseDollarLine: number;
	unclosedHtmlBlockLines: Map<string, Set<number>>;
};

export function createBlockScanCache(): BlockScanCache {
	return {
		failedBracketBySignature: new Map<string, number>(),
		failedDollarBySignature: new Map<string, number>(),
		lastCloseBracketLine: -2,
		lastCloseDollarLine: -2,
		unclosedHtmlBlockLines: new Map<string, Set<number>>(),
	};
}

const htmlBlockTagPatterns = new Map<
	string,
	Readonly<{ close: RegExp; open: RegExp }>
>();

function getHtmlBlockTagPatterns(
	tagName: string,
): Readonly<{ close: RegExp; open: RegExp }> {
	let patterns = htmlBlockTagPatterns.get(tagName);
	if (!patterns) {
		patterns = {
			close: new RegExp(`</${tagName}\\s*>`, "gi"),
			open: new RegExp(`<${tagName}(?=[\\s>/])[^>]*>`, "gi"),
		};
		htmlBlockTagPatterns.set(tagName, patterns);
	}
	return patterns;
}

function matchFenceAt(
	content: string,
	relIndent: number,
	containerFrames: ReadonlyArray<ContainerFrame>,
): DetectableFence | null {
	const first = content.charCodeAt(0);
	if (96 /* ` */ !== first && 126 /* ~ */ !== first) {
		return null;
	}
	if (relIndent < 0 || relIndent > 3) {
		return null;
	}
	const match = /^(`{3,}|~{3,})(.*)$/.exec(content);
	if (!match?.[1]) {
		return null;
	}
	const info = match[2] ?? "";
	const fenceChar = match[1][0] === "~" ? "~" : "`";
	if (fenceChar === "`" && info.includes("`")) {
		return null;
	}
	return {
		containerFrames,
		fenceChar,
		fenceLength: match[1].length,
		info,
	};
}

export function detectFenceInBody(
	body: string,
	col: number,
	containerFrames: ReadonlyArray<ContainerFrame>,
): DetectableFence | null {
	const relIndent = leadingColumnsFrom(body, col);
	return matchFenceAt(
		stripLeadingAsciiSpaceTab(body),
		relIndent,
		containerFrames,
	);
}

export function checkFenceLineStatus(
	line: string,
	fence: DetectableFence,
): "closed" | "continue" | "exited" {
	const step = stepContainerBlockLine(line, fence.containerFrames);
	if (!step.continues) return "exited";
	if (step.isBlank) return "continue";
	const relIndent = leadingColumnsFrom(step.body, step.col);
	if (relIndent > 3) return "continue";
	const content = stripLeadingAsciiSpaceTab(step.body);
	const match =
		fence.fenceChar === "`"
			? /^(`{3,})[ \t]*$/.exec(content)
			: /^(~{3,})[ \t]*$/.exec(content);
	return match?.[1] && match[1].length >= fence.fenceLength
		? "closed"
		: "continue";
}

function isGfmTableDelimiter(text: string): boolean {
	const trimmed = trimAsciiSpaceTab(text);
	return (
		trimmed.includes("-") &&
		(/^\|?[ \t]*:?-{1,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)+\|?$/.test(
			trimmed,
		) ||
			/^\|[ \t]*:?-{1,}:?[ \t]*\|$/.test(trimmed))
	);
}

export function isGfmTableStartAt(
	headerBody: string,
	delimiterLine: string,
	frames: ReadonlyArray<ContainerFrame>,
): boolean {
	if (!headerBody.includes("|") || !delimiterLine.includes("-")) {
		return false;
	}
	const delimStep = stepContainerBlockLine(delimiterLine, frames);
	if (
		!delimStep.continues ||
		delimStep.isBlank ||
		leadingColumnsFrom(delimStep.body, delimStep.col) > 3
	) {
		return false;
	}
	return isGfmTableDelimiter(delimStep.body);
}

export function isGfmTableStartAtLine(
	lines: ReadonlyArray<string>,
	headerIndex: number,
	frames: ReadonlyArray<ContainerFrame>,
): boolean {
	const headerLine = lines[headerIndex] ?? "";
	if (!headerLine.includes("|")) {
		return false;
	}
	const headerStep = stepContainerBlockLine(headerLine, frames);
	if (
		!headerStep.continues ||
		headerStep.isBlank ||
		leadingColumnsFrom(headerStep.body, headerStep.col) > 3
	) {
		return false;
	}
	return isGfmTableStartAt(headerStep.body, lines[headerIndex + 1] ?? "", frames);
}

export function findGfmTableEnd(
	lines: ReadonlyArray<string>,
	headerIndex: number,
	frames: ReadonlyArray<ContainerFrame>,
): number {
	let end = headerIndex + 1;
	for (let index = headerIndex + 2; index < lines.length; index += 1) {
		const step = stepContainerBlockLine(lines[index] ?? "", frames);
		if (!step.continues || step.isBlank || !step.body.includes("|")) {
			break;
		}
		if (
			leadingColumnsFrom(step.body, step.col) <= 3 &&
			/^(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|>)/.test(
				stripLeadingAsciiSpaceTab(step.body),
			)
		) {
			break;
		}
		end = index;
	}
	return end;
}

function matchHtmlBlockOpener(
	line: string,
): Readonly<{ tagName: string; selfClosing: boolean }> | null {
	const match = /^ {0,3}<([a-zA-Z][a-zA-Z0-9-]*)(?=[\s>/])[^>]*>/.exec(line);
	if (!match?.[1]) {
		return null;
	}
	const tagName = match[1].toLowerCase();
	if (!PAIRED_HTML_BLOCK_TAGS.has(tagName)) {
		return null;
	}
	return { tagName, selfClosing: match[0].endsWith("/>") };
}

type HtmlBlockEndState =
	| Readonly<{ frames: ReadonlyArray<ContainerFrame>; type: "blank" }>
	| Readonly<{
			closePattern: RegExp;
			frames: ReadonlyArray<ContainerFrame>;
			type: "close";
	  }>;

type ContainerCodeLineStepperOptions = Readonly<{
	detectFences?: boolean;
	detectHtmlBlocks?: boolean;
	initialHtmlBlockEnd?: HtmlBlockEndState | null;
}>;

type ContainerCodeLineStep =
	| "blank"
	| "fence"
	| "html-block-blank"
	| "html-block-close"
	| "indented-code"
	| Readonly<{
			classified: ClassifiedLineContainers;
			kind: "html-block-open";
			mode: "blank" | "close";
	  }>
	| Readonly<{ classified: ClassifiedLineContainers; kind: "content" }>;

type ContainerCodeLineStepper = Readonly<{
	getLastClassified: () => ClassifiedLineContainers | null;
	getOpenFrames: () => ReadonlyArray<ContainerFrame>;
	setState: (
		frames: ReadonlyArray<ContainerFrame>,
		nextParagraphOpen: boolean,
	) => void;
	step: (line: string) => ContainerCodeLineStep;
}>;

/**
 * Stateful CommonMark container + fenced/indented code-block + HTML-block line
 * stepper shared by `prescanMarkdown`, `findHtmlBlockEnd`, and
 * `stripCommonMarkHtmlForPreview`.
 */
export function createContainerCodeLineStepper(
	options?: ContainerCodeLineStepperOptions,
): ContainerCodeLineStepper {
	const detectFences = options?.detectFences ?? true;
	const detectHtmlBlocks = options?.detectHtmlBlocks ?? false;
	let activeFence: DetectableFence | null = null;
	let htmlBlockEnd: HtmlBlockEndState | null =
		options?.initialHtmlBlockEnd ?? null;
	let inIndentedCode = false;
	let indentedCodeFrames: ReadonlyArray<ContainerFrame> = [];
	let lastClassified: ClassifiedLineContainers | null = null;
	let openContainerFrames: ReadonlyArray<ContainerFrame> = [];
	let paragraphOpen = false;

	return {
		getLastClassified(): ClassifiedLineContainers | null {
			return lastClassified;
		},
		getOpenFrames(): ReadonlyArray<ContainerFrame> {
			return openContainerFrames;
		},
		setState(
			frames: ReadonlyArray<ContainerFrame>,
			nextParagraphOpen: boolean,
		): void {
			activeFence = null;
			htmlBlockEnd = null;
			inIndentedCode = false;
			lastClassified = null;
			openContainerFrames = frames;
			paragraphOpen = nextParagraphOpen;
		},
		step(line: string): ContainerCodeLineStep {
			lastClassified = null;
			if (htmlBlockEnd) {
				const step = stepContainerBlockLine(line, htmlBlockEnd.frames);
				if (!step.continues) {
					htmlBlockEnd = null;
					inIndentedCode = false;
					paragraphOpen = false;
				} else if (htmlBlockEnd.type === "blank") {
					if (step.isBlank) {
						openContainerFrames = htmlBlockEnd.frames;
						htmlBlockEnd = null;
						inIndentedCode = false;
						paragraphOpen = false;
						return "blank";
					}
					return "html-block-blank";
				} else {
					if (htmlBlockEnd.closePattern.test(step.body)) {
						htmlBlockEnd = null;
					}
					return "html-block-close";
				}
			}
			if (activeFence) {
				const status = checkFenceLineStatus(line, activeFence);
				if (status === "closed") {
					activeFence = null;
					paragraphOpen = false;
					return "fence";
				}
				if (status === "continue") {
					return "fence";
				}
				activeFence = null;
				paragraphOpen = false;
			}
			if (inIndentedCode) {
				if (isMarkdownBlankLine(line)) {
					openContainerFrames = retainFramesAcrossBlankLine(
						openContainerFrames,
						0,
					);
					if (openContainerFrames.length < indentedCodeFrames.length) {
						inIndentedCode = false;
					}
					paragraphOpen = false;
					return "blank";
				}
				const matchedCode = matchContainerFrames(line, indentedCodeFrames);
				if (isMarkdownBlankLine(matchedCode.body)) {
					openContainerFrames = retainFramesAcrossBlankLine(
						openContainerFrames,
						matchedCode.matchedCount,
					);
					if (openContainerFrames.length < indentedCodeFrames.length) {
						inIndentedCode = false;
					}
					paragraphOpen = false;
					return "blank";
				}
				if (
					!matchedCode.exitedContainer &&
					leadingColumnsFrom(matchedCode.body, matchedCode.col) >= 4
				) {
					return "indented-code";
				}
				inIndentedCode = false;
			}
			if (isMarkdownBlankLine(line)) {
				openContainerFrames = retainFramesAcrossBlankLine(
					openContainerFrames,
					0,
				);
				paragraphOpen = false;
				return "blank";
			}
			const classified = classifyLineContainers(
				line,
				openContainerFrames,
				paragraphOpen,
			);
			lastClassified = classified;
			if (classified.isBlankInContainer) {
				openContainerFrames = classified.blockFrames;
				paragraphOpen = false;
				return "blank";
			}
			if (
				!classified.inParagraph &&
				classified.bodyContent.length > 0 &&
				classified.relIndent >= 4
			) {
				inIndentedCode = true;
				indentedCodeFrames = classified.blockFrames;
				openContainerFrames = classified.blockFrames;
				paragraphOpen = false;
				return "indented-code";
			}
			if (detectFences) {
				const fence = detectFenceInBody(
					classified.body,
					classified.col,
					classified.blockFrames,
				);
				if (fence) {
					activeFence = fence;
					openContainerFrames = classified.blockFrames;
					paragraphOpen = false;
					return "fence";
				}
			}
			if (detectHtmlBlocks && classified.relIndent <= 3) {
				const htmlBlockType = matchLeagueHtmlBlockType(
					classified.bodyContent,
					0,
					classified.inParagraph,
				);
				if (htmlBlockType > 0) {
					const closePattern = LEAGUE_HTML_BLOCK_CLOSE_BY_TYPE[htmlBlockType];
					if (closePattern) {
						if (!closePattern.test(classified.bodyContent)) {
							htmlBlockEnd = {
								closePattern,
								frames: classified.blockFrames,
								type: "close",
							};
						}
					} else {
						htmlBlockEnd = {
							frames: classified.blockFrames,
							type: "blank",
						};
					}
					openContainerFrames = classified.blockFrames;
					inIndentedCode = false;
					paragraphOpen = false;
					return {
						classified,
						kind: "html-block-open",
						mode: closePattern ? "close" : "blank",
					};
				}
			}
			openContainerFrames = classified.proseFrames;
			paragraphOpen = classified.paragraphContinues;
			return { classified, kind: "content" };
		},
	};
}

function findHtmlBlockEnd(
	lines: ReadonlyArray<string>,
	startIndex: number,
	tagName: string,
	cache?: BlockScanCache,
): number {
	if (cache?.unclosedHtmlBlockLines.get(tagName)?.has(startIndex)) {
		return -1;
	}
	const { close: closePattern, open: openPattern } =
		getHtmlBlockTagPatterns(tagName);
	const openLineStack: number[] = [];
	const stepper = createContainerCodeLineStepper({
		detectHtmlBlocks: true,
		initialHtmlBlockEnd: { frames: [], type: "blank" },
	});

	for (let index = startIndex; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		let inBlankHtmlBlock = index === startIndex;
		if (index > startIndex) {
			const stepped = stepper.step(line);
			if (typeof stepped === "string") {
				if (stepped !== "html-block-blank") continue;
				inBlankHtmlBlock = true;
			} else if (stepped.kind === "html-block-open") {
				if (stepped.mode === "close") continue;
				inBlankHtmlBlock = true;
			}
		}
		for (const tag of line.match(openPattern) ?? []) {
			if (!tag.endsWith("/>")) {
				openLineStack.push(index);
			}
		}
		const closeCount = (line.match(closePattern) ?? []).length;
		for (let c = 0; c < closeCount; c += 1) {
			openLineStack.pop();
		}
		if (
			openLineStack.length === 0 &&
			(!inBlankHtmlBlock ||
				index + 1 >= lines.length ||
				isMarkdownBlankLine(lines[index + 1] ?? ""))
		) {
			return index;
		}
	}
	if (cache && openLineStack.length > 0) {
		let unclosed = cache.unclosedHtmlBlockLines.get(tagName);
		if (!unclosed) {
			unclosed = new Set<number>();
			cache.unclosedHtmlBlockLines.set(tagName, unclosed);
		}
		for (let k = 0; k < openLineStack.length; k += 1) {
			const lineIdx = openLineStack[k];
			if (lineIdx !== undefined) unclosed.add(lineIdx);
		}
	}
	return -1;
}

/**
 * Last line (inclusive) of a CommonMark §4.6 / League 2.8.2 HTML block (Types
 * 1–7) starting at `startIndex` inside `containerFrames`, using `cache` to
 * guarantee strict O(N) runtime. Preserves paired multi-blank-line container
 * tags (such as `<div>\n\n...\n\n</div>` and `<details>...</details>`) as one
 * card at top level while matching CommonMark/League close & blank-line rules.
 */
export function findLeagueHtmlBlockEnd(
	lines: ReadonlyArray<string>,
	startIndex: number,
	htmlType: number,
	firstLineBody: string,
	containerFrames: ReadonlyArray<ContainerFrame>,
	cache: BlockScanCache,
): number {
	const closeRe = LEAGUE_HTML_BLOCK_CLOSE_BY_TYPE[htmlType];
	if (closeRe) {
		if (closeRe.test(firstLineBody)) return startIndex;
		for (let k = startIndex + 1; k < lines.length; k += 1) {
			const step = stepContainerBlockLine(lines[k] ?? "", containerFrames);
			if (!step.continues) return k - 1;
			if (closeRe.test(step.body)) return k;
		}
		return lines.length - 1;
	}

	if (containerFrames.length === 0) {
		const pairedOpener = matchHtmlBlockOpener(lines[startIndex] ?? "");
		if (pairedOpener && !pairedOpener.selfClosing) {
			const pairedEnd = findHtmlBlockEnd(
				lines,
				startIndex,
				pairedOpener.tagName,
				cache,
			);
			if (pairedEnd >= startIndex) return pairedEnd;
		}
	}

	for (let k = startIndex + 1; k < lines.length; k += 1) {
		const step = stepContainerBlockLine(lines[k] ?? "", containerFrames);
		if (!step.continues || step.isBlank) return k - 1;
	}
	return lines.length - 1;
}

/**
 * Whether a `protected_block` payload terminates itself without requiring a
 * trailing blank line (fenced mermaid, display math, or closed HTML Blocks
 * Types 1–5; excludes Types 6–7, `[TOC]`, footnotes, and reference definitions).
 */
export function isSelfTerminatingProtectedBlock(
	kind: string,
	raw: string,
): boolean {
	if (kind === "mermaid" || kind === "math") return true;
	if (kind !== "raw") return false;
	const firstNl = raw.indexOf("\n");
	const firstLine = firstNl >= 0 ? raw.slice(0, firstNl) : raw;
	const htmlType = matchLeagueHtmlBlockType(
		stripLeadingAsciiSpaceTab(firstLine),
		0,
		false,
	);
	const closeRe = LEAGUE_HTML_BLOCK_CLOSE_BY_TYPE[htmlType];
	if (!closeRe) return false;
	const lastNl = raw.lastIndexOf("\n");
	const lastLine = lastNl >= 0 ? raw.slice(lastNl + 1) : raw;
	return closeRe.test(lastLine);
}

function getLastBlockMathCloseLine(
	lines: ReadonlyArray<string>,
	dollar: boolean,
	cache: BlockScanCache,
): number {
	if (dollar) {
		if (cache.lastCloseDollarLine === -2) {
			let last = -1;
			for (let k = lines.length - 1; k >= 0; k -= 1) {
				if (stripTrailingAsciiSpaceTab(lines[k] ?? "").endsWith("$$")) {
					last = k;
					break;
				}
			}
			cache.lastCloseDollarLine = last;
		}
		return cache.lastCloseDollarLine;
	}
	if (cache.lastCloseBracketLine === -2) {
		let last = -1;
		for (let k = lines.length - 1; k >= 0; k -= 1) {
			if (stripTrailingAsciiSpaceTab(lines[k] ?? "").endsWith("\\]")) {
				last = k;
				break;
			}
		}
		cache.lastCloseBracketLine = last;
	}
	return cache.lastCloseBracketLine;
}

function recordBlockMathFailure(
	map: Map<string, number>,
	signature: string,
	until: number,
): void {
	const prev = map.get(signature) ?? -1;
	if (until > prev) {
		map.set(signature, until);
	}
}

/**
 * Last line of a `$$...$$` or `\[...\]` block starting at `start` inside
 * `containerFrames`, or -1. A mid-line display formula that is neither a
 * one-line block nor a canonical fence line is left to the inline scanner.
 * Uses `cache` keyed by container signature to stay strictly O(N).
 */
export function findBlockMathEnd(
	lines: ReadonlyArray<string>,
	start: number,
	content: string,
	containerFrames: ReadonlyArray<ContainerFrame>,
	cache?: BlockScanCache,
): number {
	const dollar = content.startsWith("$$") && !content.startsWith("$$$$");
	if (!dollar && !content.startsWith("\\[")) return -1;
	const single = dollar
		? /^\$\$([\s\S]+?)\$\$[ \t]*$/.exec(content)
		: /^\\\[([\s\S]+?)\\\][ \t]*$/.exec(content);
	const inner = single?.[1] ?? "";
	if (single && (dollar ? !inner.includes("$$") : !isMarkdownBlankLine(inner))) {
		return start;
	}
	if (!(dollar ? /^\$\$[ \t]*$/ : /^\\\[[ \t]*$/).test(content)) return -1;
	const failedBySignature = cache
		? dollar
			? cache.failedDollarBySignature
			: cache.failedBracketBySignature
		: null;
	const signature = failedBySignature
		? formatContainerSignature(containerFrames)
		: "";
	if (cache && failedBySignature) {
		if (start >= getLastBlockMathCloseLine(lines, dollar, cache)) {
			return -1;
		}
		if ((failedBySignature.get(signature) ?? -1) > start) {
			return -1;
		}
	}
	const close = dollar ? "$$" : "\\]";
	const inContainer = containerFrames.length > 0;
	for (let k = start + 1; k < lines.length; k += 1) {
		const rawLine = lines[k] ?? "";
		if (
			!inContainer &&
			!rawLine.includes("```") &&
			!rawLine.includes("~~~") &&
			!rawLine.includes(close)
		) {
			continue;
		}
		const step = stepContainerBlockLine(rawLine, containerFrames);
		if (!step.continues) {
			if (failedBySignature) {
				recordBlockMathFailure(failedBySignature, signature, k);
			}
			return -1;
		}
		if (step.isBlank) continue;
		if (
			!step.body.includes("```") &&
			!step.body.includes("~~~") &&
			!step.body.includes(close)
		) {
			continue;
		}
		if (step.body.includes("```") || step.body.includes("~~~")) {
			const peeled = peelContainerFrames(rawLine, containerFrames);
			if (detectFenceInBody(peeled.body, peeled.col, peeled.frames)) {
				if (failedBySignature) {
					recordBlockMathFailure(failedBySignature, signature, k);
				}
				return -1;
			}
		}
		if (stripTrailingAsciiSpaceTab(step.body).endsWith(close)) return k;
	}
	if (failedBySignature) {
		recordBlockMathFailure(failedBySignature, signature, lines.length);
	}
	return -1;
}

/**
 * Whether `text` contains an unescaped inline opener that can legally span
 * soft line breaks inside a paragraph (`<` for inline HTML, `\(` / `\[` / `$$`
 * for multiline inline/display math).
 */
export function hasMultilineInlineOpener(text: string): boolean {
	for (let i = 0; i < text.length; i += 1) {
		const ch = text.charCodeAt(i);
		if (60 /* < */ === ch && !hasOddPrecedingBackslashes(text, i)) {
			return true;
		}
		if (92 /* \ */ === ch && i + 1 < text.length) {
			const next = text.charCodeAt(i + 1);
			if (
				(40 /* ( */ === next || 91 /* [ */ === next) &&
				!hasOddPrecedingBackslashes(text, i)
			) {
				return true;
			}
		}
		if (
			36 /* $ */ === ch &&
			i + 1 < text.length &&
			36 === text.charCodeAt(i + 1) &&
			!hasOddPrecedingBackslashes(text, i)
		) {
			return true;
		}
	}
	return false;
}

/**
 * Whether a non-blank continuation line `body` at column `col` interrupts an
 * open CommonMark paragraph (and therefore also terminates a pending link
 * reference definition per CommonMark §4.7). Excludes lines with `relIndent > 3`
 * and HTML Block Type 7 (`<span>`, `<audio>`, etc.).
 */
export function isCommonMarkParagraphInterrupter(
	body: string,
	col: number,
	exitedContainer: boolean,
): boolean {
	const relIndent = leadingColumnsFrom(body, col);
	if (relIndent > 3) return false;
	if (startsContainerQuote(body, col)) return true;
	const content = stripLeadingAsciiSpaceTab(body);
	if (matchFenceAt(content, relIndent, [])) return true;
	if (matchLeagueHtmlBlockType(content, 0, true) > 0) return true;
	const trimmed = stripTrailingAsciiSpaceTab(content);
	return (
		ATX_HEADING.test(trimmed) ||
		THEMATIC_BREAK.test(trimmed) ||
		(!exitedContainer && SETEXT_UNDERLINE.test(trimmed)) ||
		isInterruptingListMarker(body, exitedContainer, col)
	);
}

/**
 * Finds the contiguous paragraph continuation run starting at `start`
 * (inclusive) with exact per-line container prefixes stripped for clean
 * multiline protected-inline projection. Retains the active container stack
 * through lazy continuation lines, excludes HTML Block Type 7 from interrupting
 * paragraphs, and treats container-exiting list markers as paragraph breakers.
 */
export function findParagraphProseRunEnd(
	lines: ReadonlyArray<string>,
	start: number,
	startLine: ProseRunLine,
	activeFrames: ReadonlyArray<ContainerFrame>,
	blockScanCache: BlockScanCache,
): ParagraphProseRun {
	const runLines: ProseRunLine[] = [startLine];
	let end = start;

	for (let k = start + 1; k < lines.length; k += 1) {
		const nextLine = lines[k] ?? "";
		if (isMarkdownBlankLine(nextLine)) break;

		const matched = matchContainerFrames(nextLine, activeFrames);
		if (isMarkdownBlankLine(matched.body)) break;

		if (
			isCommonMarkParagraphInterrupter(
				matched.body,
				matched.col,
				matched.exitedContainer,
			)
		) {
			break;
		}

		const relIndent = leadingColumnsFrom(matched.body, matched.col);
		const content = stripLeadingAsciiSpaceTab(matched.body);
		const lineFrames = matched.exitedContainer
			? activeFrames.slice(0, matched.matchedCount)
			: activeFrames;

		if (
			relIndent <= 3 &&
			content.startsWith(TABLE_ALIGN_PREFIX) &&
			stripTrailingAsciiSpaceTab(content).endsWith(TABLE_ALIGN_SUFFIX) &&
			isGfmTableStartAtLine(lines, k + 1, lineFrames)
		) {
			break;
		}
		if (
			relIndent <= 3 &&
			isGfmTableStartAt(matched.body, lines[k + 1] ?? "", lineFrames)
		) {
			break;
		}

		if (
			relIndent <= 3 &&
			findBlockMathEnd(lines, k, content, lineFrames, blockScanCache) >= k
		) {
			break;
		}
		if (FOOTNOTE_DEF_LINE.test(content)) break;

		runLines.push({ body: matched.body, prefix: matched.prefix });
		end = k;
	}

	return { end, lines: runLines };
}
