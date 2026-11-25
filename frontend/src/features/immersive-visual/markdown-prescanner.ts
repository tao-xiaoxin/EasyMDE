import { matchHtmlBlockOpen } from "../../shared/markdown/php-commonmark-block-helpers";
import {
	advanceParagraphReferenceParser,
	createParagraphReferenceParser,
	type ParagraphReferenceParser,
} from "../../shared/markdown/php-commonmark-reference-def";
import { parseReservedTableAlignmentMarkerLine } from "../../shared/table-alignment-marker";
import {
	blockquoteDepth,
	findCommonMarkHtmlBlockEnd,
	findGfmTableEnd,
	isCommonMarkBlankLine,
	isGfmTableStartAt,
	type ListMarkerMatch,
	matchListMarker,
	matchListPrefixedHtmlBlock,
	readBlockquotePrefix,
	stripBlockquoteDepth,
	stripContainerIndent,
} from "./markdown-prescanner-blocks";
import {
	extractInlineProtectedSyntax,
	type ProtectedInlineEntry,
} from "./markdown-prescanner-inline";
import type { ProtectedBlockKind } from "./visual-schema";

export {
	isCommonMarkBlankLine,
	stripBlockquoteDepth,
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

function measureIndent(text: string): number {
	return text.split("\t").join("    ").length;
}

export type LineAnalysis = Readonly<{
	containerIndent: number;
	content: string;
	indent: number;
	listMarker: ListMarkerMatch | null;
	prefix: string;
	rest: string;
}>;

export function analyzeLine(line: string, containerIndent: number): LineAnalysis {
	const { prefix, rest } = readBlockquotePrefix(line);
	const indentText = /^[ \t]*/.exec(rest)?.[0] ?? "";
	return {
		containerIndent,
		content: rest.slice(indentText.length),
		indent: measureIndent(indentText),
		listMarker: matchListMarker(rest),
		prefix,
		rest,
	};
}

export type DetectableFence = Readonly<{
	containerIndent: number;
	fenceChar: "`" | "~";
	fenceLength: number;
	info: string;
}>;

function matchFenceAt(
	content: string,
	indent: number,
	containerIndent: number,
): DetectableFence | null {
	const relative = indent - containerIndent;
	if (relative < 0 || relative > 3) {
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
		containerIndent,
		fenceChar,
		fenceLength: match[1].length,
		info,
	};
}

export function detectFence(analysis: LineAnalysis): DetectableFence | null {
	const direct = matchFenceAt(
		analysis.content,
		analysis.indent,
		analysis.containerIndent,
	);
	if (direct || !analysis.listMarker) {
		return direct;
	}
	const markerIndent = analysis.listMarker.contentIndent;
	return matchFenceAt(
		analysis.rest.slice(markerIndent),
		markerIndent,
		markerIndent,
	);
}

export function isFenceCloser(line: string, fence: DetectableFence): boolean {
	const { rest } = readBlockquotePrefix(line);
	const indentText = /^[ \t]*/.exec(rest)?.[0] ?? "";
	const indent = measureIndent(indentText);
	const relative = indent - fence.containerIndent;
	if (relative < 0 || relative > 3) {
		return false;
	}
	const content = rest.slice(indentText.length);
	const match =
		fence.fenceChar === "`"
			? /^(`{3,})[ \t]*$/.exec(content)
			: /^(~{3,})[ \t]*$/.exec(content);
	return Boolean(match?.[1] && match[1].length >= fence.fenceLength);
}

export const FOOTNOTE_DEF_LINE = /^ {0,3}\[\^([^\s\]]+)\]:(?:[ \t]|$)/;

export const ATX_HEADING = /^#{1,6}(?:[ \t]+.*|[ \t]*)$/;
export const THEMATIC_BREAK =
	/^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
export const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const CONTAINER_QUOTE = /^ {0,3}>[ \t]?/;
const CONTAINER_LIST_MARKER = /^ {0,3}(?:[-+*]|(\d{1,9})[.)])(?=[ \t]|$)/;
const leadingColumns = (text: string): number =>
	measureIndent(/^[ \t]*/.exec(text)?.[0] ?? "");

/**
 * Whether a line emitted as text leaves a paragraph open (so the next line
 * cannot start a reference definition), classified on the content inside any
 * nested quote/list containers, plus the quote depth those containers add.
 */
function classifyParagraphLine(
	content: string,
	relativeIndent: number,
	paragraphOpen: boolean,
): Readonly<{ nestedQuotes: number; open: boolean }> {
	let inner = content;
	let nestedQuotes = 0;
	if (relativeIndent > 3) return { nestedQuotes, open: true };
	for (let depth = 0; depth < 32; depth += 1) {
		const nested = depth > 0;
		const trimmed = inner.replace(/^[ \t]+|[ \t]+$/g, "");
		if (
			trimmed === "" ||
			(nested && leadingColumns(inner) >= 4) ||
			ATX_HEADING.test(trimmed) ||
			THEMATIC_BREAK.test(trimmed) ||
			(!nested && paragraphOpen && SETEXT_UNDERLINE.test(trimmed))
		) {
			return { nestedQuotes, open: false };
		}
		const quote = CONTAINER_QUOTE.exec(inner);
		const marker = quote ? null : CONTAINER_LIST_MARKER.exec(inner);
		if (quote) {
			inner = inner.slice(quote[0].length);
			nestedQuotes += 1;
			continue;
		}
		if (!marker) return { nestedQuotes, open: true };
		const after = inner.slice(marker[0].length);
		const blank = isCommonMarkBlankLine(after);
		// An empty or non-1 ordered item cannot interrupt a paragraph.
		const ordered = marker[1];
		if (!nested && paragraphOpen && (blank || (ordered && +ordered !== 1))) {
			return { nestedQuotes, open: true };
		}
		// Marker spacing of 5+ columns starts indented code in the item.
		if (blank || leadingColumns(after) >= 5) {
			return { nestedQuotes, open: false };
		}
		inner = after.replace(/^[ \t]/, "");
	}
	return { nestedQuotes, open: true };
}

/**
 * Last line of a `$$...$$` or `\[...\]` block starting at `start`, or -1. A
 * mid-line display formula that is neither a one-line block nor a canonical
 * fence line is left to the inline scanner.
 */
function findBlockMathEnd(
	lines: ReadonlyArray<string>,
	start: number,
	content: string,
	containerIndent: number,
): number {
	const dollar = content.startsWith("$$") && !content.startsWith("$$$$");
	if (!dollar && !content.startsWith("\\[")) return -1;
	const single = dollar
		? /^\$\$([\s\S]+?)\$\$[ \t]*$/.exec(content)
		: /^\\\[([\s\S]+?)\\\][ \t]*$/.exec(content);
	const inner = single?.[1] ?? "";
	if (single && (dollar ? !inner.includes("$$") : inner.trim().length > 0)) {
		return start;
	}
	if (!(dollar ? /^\$\$[ \t]*$/ : /^\\\[[ \t]*$/).test(content)) return -1;
	const close = dollar ? "$$" : "\\]";
	for (let k = start + 1; k < lines.length; k += 1) {
		const next = analyzeLine(lines[k] ?? "", containerIndent);
		if (detectFence(next)) return -1;
		if (next.content.trimEnd().endsWith(close)) return k;
	}
	return -1;
}

function stripBlockContainerPrefix(
	line: string,
	prefix: string,
	indent: number,
): string {
	let result = line;
	if (prefix.length > 0) {
		if (result.startsWith(prefix)) {
			result = result.slice(prefix.length);
		} else if (
			result.replace(/[ \t]+$/, "") === prefix.replace(/[ \t]+$/, "")
		) {
			return "";
		} else {
			result =
				stripBlockquoteDepth(result, blockquoteDepth(prefix)) ??
				readBlockquotePrefix(result).rest;
		}
	}
	const leading = /^[ \t]*/.exec(result)?.[0] ?? "";
	return result.slice(Math.min(indent, leading.length));
}

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
		prefix: string,
		markerPrefix: string,
		firstLineContent: string,
		quoteDepth: number,
		contentIndent: number,
		origStart: number,
		lastLine: number,
	): void => {
		const origEnd = lastLine + 1;
		const token = `${sentinel}BLK${protectedBlocks.size}END`;
		const rawBlockLines: string[] = [firstLineContent];
		for (let k = origStart + 1; k <= lastLine; k += 1) {
			const rawLine = lines[k] ?? "";
			const afterQuote =
				quoteDepth > 0
					? (stripBlockquoteDepth(rawLine, quoteDepth) ??
						readBlockquotePrefix(rawLine).rest)
					: rawLine;
			rawBlockLines.push(
				isCommonMarkBlankLine(afterQuote)
					? ""
					: (stripContainerIndent(afterQuote, contentIndent) ?? afterQuote),
			);
		}
		protectedBlocks.set(token, { kind, rawMarkdown: rawBlockLines.join("\n") });
		pushOutputLine(`${prefix}${markerPrefix}${token}`, {
			end: origEnd,
			start: origStart,
		});
	};

	let i = 0;
	let inIndentedCode = false;
	let indentedCodeContainer = 0;
	let listContentIndent: number | null = null;
	let paragraphOpen = false;
	let paragraphQuoteDepth = 0;
	let paragraphRefParser: ParagraphReferenceParser | null = null;
	let tableRowStart = -1;
	let tableRowEnd = -1;

	const closeParagraph = (): void => {
		paragraphOpen = false;
		paragraphRefParser = null;
	};

	while (i < lines.length) {
		const line = lines[i] ?? "";
		let analysis = analyzeLine(line, listContentIndent ?? 0);
		const isBlank = isCommonMarkBlankLine(line);

		if (inIndentedCode) {
			if (isBlank) {
				pushOutputLine(line, { end: i + 1, start: i });
				i += 1;
				continue;
			}
			if (analysis.indent - indentedCodeContainer >= 4) {
				pushOutputLine(line, { end: i + 1, start: i });
				i += 1;
				continue;
			}
			inIndentedCode = false;
		}

		if (isBlank) {
			pushOutputLine(line, { end: i + 1, start: i });
			closeParagraph();
			inIndentedCode = false;
			i += 1;
			continue;
		}

		// A deeper blockquote marker opens a quote that interrupts a paragraph.
		const lineQuoteDepth = (analysis.prefix.match(/>/g) ?? []).length;
		if (paragraphOpen && lineQuoteDepth > paragraphQuoteDepth) {
			closeParagraph();
		}

		const prevContainerIndent = listContentIndent ?? 0;
		if (analysis.listMarker) {
			listContentIndent = analysis.listMarker.contentIndent;
		} else if (
			listContentIndent !== null &&
			analysis.indent < listContentIndent
		) {
			listContentIndent = null;
			analysis = analyzeLine(line, 0);
		}

		const effectiveContainer = listContentIndent ?? 0;
		const relativeIndent = analysis.indent - effectiveContainer;

		// 1. Indented code blocks can only start when no paragraph is open.
		if (!paragraphOpen && relativeIndent >= 4) {
			inIndentedCode = true;
			indentedCodeContainer = effectiveContainer;
			pushOutputLine(line, { end: i + 1, start: i });
			i += 1;
			continue;
		}

		// 2. Fenced code blocks (container aware: blockquotes and list items).
		const fence = detectFence(analysis);
		if (fence) {
			let end = i + 1;
			while (end < lines.length && !isFenceCloser(lines[end] ?? "", fence)) {
				end += 1;
			}
			const blockEnd = end < lines.length ? end : lines.length - 1;
			const lang = (fence.info.trim().split(/\s+/)[0] ?? "").toLowerCase();
			if (lang === "mermaid" && analysis.listMarker === null) {
				pushProtectedBlock("mermaid", analysis, i, blockEnd);
			} else {
				for (let k = i; k <= blockEnd; k += 1) {
					pushOutputLine(lines[k] ?? "", { end: k + 1, start: k });
				}
			}
			closeParagraph();
			i = blockEnd + 1;
			continue;
		}

		// 3. EasyMDE table alignment annotation directly preceding a GFM table.
		const tableAlignCandidate =
			relativeIndent >= 0 && relativeIndent <= 3
				? stripContainerIndent(analysis.rest, effectiveContainer)
				: null;
		const parsedTableAlign =
			tableAlignCandidate !== null &&
			isGfmTableStartAt(
				lines[i + 1] ?? "",
				lines[i + 2] ?? "",
				effectiveContainer,
				lineQuoteDepth,
				false,
			)
				? parseReservedTableAlignmentMarkerLine(tableAlignCandidate)
				: null;
		if (null !== parsedTableAlign && !("code" in parsedTableAlign)) {
			const markerToken = `${sentinel}TBLALIGN${tableAlignMarkers.size}END`;
			tableAlignMarkers.set(markerToken, parsedTableAlign.text);
			pushOutputLine(
				`${analysis.prefix}${" ".repeat(analysis.indent)}${markerToken}`,
				{ end: i + 1, start: i },
			);
			closeParagraph();
			i += 1;
			continue;
		}

		if (
			i > tableRowEnd &&
			isGfmTableStartAt(
				lines[i] ?? "",
				lines[i + 1] ?? "",
				effectiveContainer,
				lineQuoteDepth,
				true,
			)
		) {
			tableRowStart = i;
			tableRowEnd = findGfmTableEnd(lines, i);
		}
		const isTableRow = i >= tableRowStart && i <= tableRowEnd;

		// 4. Block math: $$...$$ and \[...\] (single-line or multi-line).
		const blockMathEnd = findBlockMathEnd(
			lines,
			i,
			analysis.content,
			effectiveContainer,
		);
		if (blockMathEnd >= i) {
			const mathSentinelIndent =
				relativeIndent >= 4 ? effectiveContainer : analysis.indent;
			pushProtectedBlock("math", analysis, i, blockMathEnd, mathSentinelIndent);
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
			closeParagraph();
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
			closeParagraph();
			i = end + 1;
			continue;
		}

		// 7. CommonMark §4.6 Types 1-7 HTML blocks (including list-marker and
		//    blockquote-prefixed blocks).
		const listHtml = matchListPrefixedHtmlBlock(
			analysis.rest,
			paragraphOpen,
			prevContainerIndent,
		);
		if (listHtml !== null) {
			const end = findCommonMarkHtmlBlockEnd(
				lines,
				i,
				listHtml.htmlType,
				lineQuoteDepth,
				listHtml.contentIndent,
				listHtml.content,
			);
			pushListPrefixedProtectedBlock(
				"raw",
				analysis.prefix,
				listHtml.markerPrefix,
				listHtml.content,
				lineQuoteDepth,
				listHtml.contentIndent,
				i,
				end,
			);
			listContentIndent = listHtml.contentIndent;
			closeParagraph();
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
				const end = findCommonMarkHtmlBlockEnd(
					lines,
					i,
					htmlType,
					lineQuoteDepth,
					effectiveContainer,
					analysis.content,
				);
				pushProtectedBlock("raw", analysis, i, end);
				closeParagraph();
				i = end + 1;
				continue;
			}
		}

		// Keep `paragraphOpen = true` across link reference definitions (matching
		// PHP ParagraphParser), while tracking ReferenceParser state so consecutive
		// angle-bracketed destinations keep their `<...>` intact.
		const startsNewParagraph = !paragraphOpen || analysis.listMarker !== null;
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
				isTableRow,
				allowRefDefDest,
				indentedContinuationStart,
			),
			{ end: i + 1, start: i },
		);
		const lineState = classifyParagraphLine(
			analysis.content,
			relativeIndent,
			paragraphOpen,
		);
		if (!(paragraphOpen && lineState.open)) {
			// A continued (possibly lazy) paragraph keeps its original depth.
			paragraphQuoteDepth = lineQuoteDepth + lineState.nestedQuotes;
		}
		paragraphOpen = lineState.open;
		if (paragraphOpen) {
			const refLine = analysis.listMarker
				? analysis.rest.slice(analysis.listMarker.contentIndent)
				: analysis.content;
			advanceParagraphReferenceParser(activeRefParser, refLine);
			paragraphRefParser = activeRefParser;
		} else {
			paragraphRefParser = null;
		}
		i += 1;
	}

	return {
		lineEnding,
		markdown: outputLines.join("\n"),
		outputLineRanges,
		protectedBlocks,
		protectedInlines,
		rawLines: lines,
		sentinel,
		tableAlignMarkers,
	};
}
