import { decodeCommonMarkTitle } from "../../shared/image-scale-title";
import { parseReservedTableAlignmentMarkerLine } from "../../shared/table-alignment-marker";
import {
	extractInlineProtectedSyntax,
	type ProtectedInlineEntry,
} from "./markdown-prescanner-inline";
import type { ProtectedBlockKind } from "./visual-schema";

export type { ProtectedInlineEntry };

export type ProtectedBlockEntry = Readonly<{
	kind: ProtectedBlockKind;
	rawMarkdown: string;
}>;

export type ReferenceDefinition = Readonly<{
	href: string;
	title: string;
}>;

export type PrescannedLineRange = Readonly<{
	end: number;
	start: number;
}>;

export type PreScanResult = Readonly<{
	deferredReferences: Record<string, ReferenceDefinition>;
	lineEnding: "\n" | "\r\n";
	markdown: string;
	outputLineRanges: ReadonlyArray<PrescannedLineRange | null>;
	protectedBlocks: ReadonlyMap<string, ProtectedBlockEntry>;
	protectedInlines: ReadonlyMap<string, ProtectedInlineEntry>;
	rawLines: ReadonlyArray<string>;
	references: Record<string, ReferenceDefinition>;
	sentinel: string;
	tableAlignMarkers: ReadonlyMap<string, string>;
}>;

import {
	TABLE_ALIGN_PREFIX,
	TABLE_ALIGN_SUFFIX,
} from "./table-alignment-codec";

export { TABLE_ALIGN_PREFIX, TABLE_ALIGN_SUFFIX };

const HTML_BLOCK_TAGS: ReadonlySet<string> = new Set(
	"article aside audio blockquote center details div dl fieldset figure footer form header hr iframe main nav ol p pre script section style summary table ul video".split(
		" ",
	),
);

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

function readBlockquotePrefix(
	line: string,
): Readonly<{ prefix: string; rest: string }> {
	const prefix = /^(?: {0,3}>[ \t]?)*/.exec(line)?.[0] ?? "";
	return { prefix, rest: line.slice(prefix.length) };
}

function measureIndent(text: string): number {
	return text.split("\t").join("    ").length;
}

type ListMarkerMatch = Readonly<{ contentIndent: number }>;

function matchListMarker(rest: string): ListMarkerMatch | null {
	const match = /^( *)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(rest);
	if (!match?.[2]) {
		return null;
	}
	const indent = match[1]?.length ?? 0;
	const spaces = match[3] ?? "";
	const content = match[4] ?? "";
	const padding = content.length > 0 && spaces.length > 4 ? 1 : spaces.length;
	return { contentIndent: indent + match[2].length + Math.max(padding, 1) };
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
function blockquoteDepth(prefix: string): number {
	return (prefix.match(/>/g) ?? []).length;
}

function advanceColumns(text: string, startColumn = 0): number {
	let column = startColumn;
	for (const ch of text) {
		column = ch === "\t" ? column + 4 - (column % 4) : column + 1;
	}
	return column;
}

function stripContainerIndent(
	rest: string,
	containerIndent: number,
): string | null {
	if (containerIndent <= 0) {
		return rest;
	}
	let column = 0;
	let index = 0;
	while (index < rest.length && column < containerIndent) {
		const ch = rest[index];
		if (ch === " ") {
			column += 1;
			index += 1;
		} else if (ch === "\t") {
			column += 4 - (column % 4);
			index += 1;
		} else {
			break;
		}
	}
	if (column < containerIndent) {
		return null;
	}
	return `${" ".repeat(column - containerIndent)}${rest.slice(index)}`;
}

function countGfmTableDelimiterColumns(text: string): number {
	const trimmed = text.trim();
	if (
		!trimmed.includes("-") ||
		!trimmed.includes("|") ||
		/^-[ \t]/u.test(trimmed) ||
		!/^[|\-: \t]+$/u.test(trimmed)
	) {
		return 0;
	}
	const parts = trimmed.split("|");
	if (parts[0] === "") {
		parts.shift();
	}
	if (parts.length > 0 && parts[parts.length - 1] === "") {
		parts.pop();
	}
	if (parts.length === 0) {
		return 0;
	}
	for (const part of parts) {
		if (!/^:?-+:?$/u.test(part.trim())) {
			return 0;
		}
	}
	return parts.length;
}

function countGfmTableHeaderColumns(text: string): number {
	const trimmed = text.trim();
	if (!trimmed.includes("|")) {
		return 0;
	}
	const cells: string[] = [];
	let current = "";
	let index = trimmed[0] === "|" ? 1 : 0;
	while (index < trimmed.length) {
		const ch = trimmed[index] ?? "";
		if (ch === "\\" && trimmed[index + 1] === "|") {
			current += "|";
			index += 2;
			continue;
		}
		if (ch === "|") {
			cells.push(current);
			current = "";
			index += 1;
			continue;
		}
		current += ch;
		index += 1;
	}
	if (current.length > 0) {
		cells.push(current);
	}
	return cells.length;
}

function isGfmTableStartAt(
	headerLine: string,
	delimiterLine: string,
	containerIndent: number,
	expectedQuoteDepth: number | null,
	allowLeadingListMarker: boolean,
): boolean {
	const headerBq = readBlockquotePrefix(headerLine);
	const delimiterBq = readBlockquotePrefix(delimiterLine);
	const headerDepth = blockquoteDepth(headerBq.prefix);
	const delimiterDepth = blockquoteDepth(delimiterBq.prefix);
	if (headerDepth !== delimiterDepth) {
		return false;
	}
	if (expectedQuoteDepth !== null && headerDepth !== expectedQuoteDepth) {
		return false;
	}

	let effContainer = containerIndent;
	let headerCandidate = stripContainerIndent(headerBq.rest, effContainer);
	if (headerCandidate === null) {
		return false;
	}
	const headerLeadMatch = /^[ \t]*/.exec(headerCandidate)?.[0] ?? "";
	const headerRelIndent =
		advanceColumns(headerLeadMatch, effContainer) - effContainer;
	if (headerRelIndent >= 4) {
		return false;
	}
	const headerListMarker = matchListMarker(headerCandidate);
	if (headerListMarker !== null) {
		if (!allowLeadingListMarker) {
			return false;
		}
		effContainer += headerListMarker.contentIndent;
		headerCandidate = headerCandidate.slice(headerListMarker.contentIndent);
	}

	const delimiterCandidate = stripContainerIndent(
		delimiterBq.rest,
		effContainer,
	);
	if (delimiterCandidate === null) {
		return false;
	}
	const delimiterLeadMatch = /^[ \t]*/.exec(delimiterCandidate)?.[0] ?? "";
	const delimiterRelIndent =
		advanceColumns(delimiterLeadMatch, effContainer) - effContainer;
	if (delimiterRelIndent >= 4) {
		return false;
	}

	const headerColumns = countGfmTableHeaderColumns(headerCandidate);
	if (headerColumns === 0) {
		return false;
	}
	return headerColumns === countGfmTableDelimiterColumns(delimiterCandidate);
}

function findGfmTableEnd(
	lines: ReadonlyArray<string>,
	headerIndex: number,
): number {
	let end = headerIndex + 1;
	for (let index = headerIndex + 2; index < lines.length; index += 1) {
		const { rest } = readBlockquotePrefix(lines[index] ?? "");
		if (rest.trim().length === 0 || !rest.includes("|")) {
			break;
		}
		if (/^ {0,3}(?:#{1,6}(?:[ \t]|$)|`{3,}|~{3,}|>)/.test(rest)) {
			break;
		}
		end = index;
	}
	return end;
}
function normalizeReferenceKey(label: string): string {
	return label.trim().replace(/\s+/g, " ").toUpperCase();
}
function parseReferenceTitle(raw: string): string | null {
	const trimmed = raw.trim();
	const quote = trimmed[0];
	if (quote !== '"' && quote !== "'" && quote !== "(") {
		return null;
	}
	const closing = quote === "(" ? ")" : quote;
	if (trimmed.length < 2 || !trimmed.endsWith(closing)) {
		return null;
	}
	const inner = trimmed.slice(1, -1);
	let escaped = false;
	for (let index = 0; index < inner.length; index += 1) {
		const ch = inner[index] ?? "";
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			continue;
		}
		if (ch === closing || (quote === "(" && ch === "(")) {
			return null;
		}
	}
	if (escaped) {
		return null;
	}
	return decodeCommonMarkTitle(inner);
}

type ReferenceDefinitionMatch = Readonly<{
	end: number;
	href: string;
	key: string;
	title: string;
}>;

export const REFERENCE_DEF_LINE = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(.*)$/;
export const FOOTNOTE_DEF_LINE = /^ {0,3}\[\^([^\s\]]+)\]:(?:[ \t]|$)/;

function matchReferenceDefinition(
	lines: ReadonlyArray<string>,
	start: number,
): ReferenceDefinitionMatch | null {
	const startBq = readBlockquotePrefix(lines[start] ?? "");
	const startDepth = blockquoteDepth(startBq.prefix);
	const match = REFERENCE_DEF_LINE.exec(startBq.rest);
	if (!match?.[1]) {
		return null;
	}
	const key = normalizeReferenceKey(match[1]);
	if (key.length === 0) {
		return null;
	}
	let remainder = (match[2] ?? "").trim();
	let end = start;
	if (remainder.length === 0) {
		const next = lines[start + 1];
		if (next === undefined) {
			return null;
		}
		const nextBq = readBlockquotePrefix(next);
		if (
			blockquoteDepth(nextBq.prefix) > startDepth ||
			!/^[ \t]+/.test(nextBq.rest)
		) {
			return null;
		}
		remainder = nextBq.rest.trim();
		end = start + 1;
	}
	const destinationMatch = /^(<[^<>\n]*>|[^\s<>]+)(.*)$/.exec(remainder);
	if (!destinationMatch?.[1]) {
		return null;
	}
	let href = destinationMatch[1];
	if (href.startsWith("<") && href.endsWith(">") && href.length >= 2) {
		href = href.slice(1, -1);
	}
	let titleSource = (destinationMatch[2] ?? "").trim();
	if (titleSource.length === 0) {
		const nextLine = lines[end + 1];
		if (nextLine !== undefined) {
			const nextBq = readBlockquotePrefix(nextLine);
			if (
				blockquoteDepth(nextBq.prefix) <= startDepth &&
				/^[ \t]*["'(]/.test(nextBq.rest)
			) {
				titleSource = nextBq.rest.trim();
				end += 1;
			}
		}
	}
	let title = "";
	if (titleSource.length > 0) {
		const parsedTitle = parseReferenceTitle(titleSource);
		if (parsedTitle === null) {
			return null;
		}
		title = parsedTitle;
	}
	return { end, href, key, title };
}
function matchHtmlBlockOpener(
	line: string,
): Readonly<{ tagName: string; selfClosing: boolean }> | null {
	const match = /^ {0,3}<([a-zA-Z][a-zA-Z0-9-]*)(?=[\s>/])[^>]*>/.exec(line);
	if (!match?.[1]) {
		return null;
	}
	const tagName = match[1].toLowerCase();
	if (!HTML_BLOCK_TAGS.has(tagName)) {
		return null;
	}
	return { tagName, selfClosing: match[0].endsWith("/>") || tagName === "hr" };
}
function findHtmlBlockEnd(
	lines: ReadonlyArray<string>,
	startIndex: number,
	tagName: string,
): number {
	const openPattern = new RegExp(`<${tagName}(?=[\\s>/])[^>]*>`, "gi");
	const closePattern = new RegExp(`</${tagName}\\s*>`, "gi");
	let depth = 0;
	let activeFence: DetectableFence | null = null;

	for (let index = startIndex; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (activeFence) {
			if (isFenceCloser(line, activeFence)) {
				activeFence = null;
			}
			continue;
		}
		if (index > startIndex) {
			const fence = detectFence(analyzeLine(line, 0));
			if (fence) {
				activeFence = fence;
				continue;
			}
		}
		for (const tag of line.match(openPattern) ?? []) {
			if (!tag.endsWith("/>")) {
				depth += 1;
			}
		}
		depth -= (line.match(closePattern) ?? []).length;
		if (depth <= 0) {
			return index;
		}
	}
	return -1;
}

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
		const trimmed = inner.trim();
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
		const blank = after.trim() === "";
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
		} else if (result.trimEnd() === prefix.trimEnd()) {
			return "";
		} else {
			result = readBlockquotePrefix(result).rest;
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
	const references: Record<string, ReferenceDefinition> = Object.create(null);
	const deferredReferences: Record<string, ReferenceDefinition> =
		Object.create(null);
	const seenReferenceLabels = new Set<string>();

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
	): void => {
		const origEnd = lastLine + 1;
		const token = `${sentinel}BLK${protectedBlocks.size}END`;
		const rawMarkdown = lines
			.slice(origStart, origEnd)
			.map((blockLine) => stripBlockContainerPrefix(blockLine, prefix, indent))
			.join("\n");
		protectedBlocks.set(token, { kind, rawMarkdown });
		const blankLine = prefix.length === 0 ? "" : prefix.replace(/[ \t]+$/, "");
		const prevLine = outputLines[outputLines.length - 1];
		if (prevLine !== undefined && prevLine.trim().length > 0) {
			pushOutputLine(blankLine, null);
		}
		pushOutputLine(`${prefix}${" ".repeat(indent)}${token}`, {
			end: origEnd,
			start: origStart,
		});
		pushOutputLine(blankLine, null);
	};

	let i = 0;
	let inIndentedCode = false;
	let indentedCodeContainer = 0;
	let listContentIndent: number | null = null;
	let paragraphOpen = false;
	let paragraphQuoteDepth = 0;
	let tableRowStart = -1;
	let tableRowEnd = -1;

	while (i < lines.length) {
		const line = lines[i] ?? "";
		let analysis = analyzeLine(line, listContentIndent ?? 0);
		const isBlank = line.trim().length === 0;

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
			paragraphOpen = false;
			inIndentedCode = false;
			i += 1;
			continue;
		}

		// A deeper blockquote marker opens a quote that interrupts a paragraph.
		const lineQuoteDepth = (analysis.prefix.match(/>/g) ?? []).length;
		if (paragraphOpen && lineQuoteDepth > paragraphQuoteDepth) {
			paragraphOpen = false;
		}

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
			paragraphOpen = false;
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
			paragraphOpen = false;
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
			pushProtectedBlock("math", analysis, i, blockMathEnd);
			paragraphOpen = false;
			i = blockMathEnd + 1;
			continue;
		}

		// 5. Standalone [TOC] line.
		if (
			/^\[TOC\][ \t]*$/i.test(analysis.content) &&
			(i === 0 || (lines[i - 1] ?? "").trim().length === 0) &&
			(i + 1 >= lines.length || (lines[i + 1] ?? "").trim().length === 0)
		) {
			pushProtectedBlock("toc", analysis, i, i);
			paragraphOpen = false;
			i += 1;
			continue;
		}

		// 6. Footnote definitions (including blank-line separated continuations).
		if (/^\[\^([^\s\]]+)\]:(?:[ \t]|$)/.test(analysis.content)) {
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
				if (next.content.trim().length === 0) {
					let lookahead = end + 1;
					while (
						lookahead < lines.length &&
						(lines[lookahead] ?? "").trim().length === 0
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
			paragraphOpen = false;
			i = end + 1;
			continue;
		}

		// 7. Reference link definitions. CommonMark forbids them from
		// interrupting a paragraph and resolves duplicates first-wins.
		let reference = paragraphOpen ? null : matchReferenceDefinition(lines, i);
		if (reference) {
			let end = i;
			while (reference) {
				if (!seenReferenceLabels.has(reference.key)) {
					seenReferenceLabels.add(reference.key);
					references[reference.key] = {
						href: reference.href,
						title: reference.title,
					};
				} else if (
					references[reference.key] === undefined &&
					deferredReferences[reference.key] === undefined
				) {
					deferredReferences[reference.key] = {
						href: reference.href,
						title: reference.title,
					};
				}
				end = reference.end;
				reference = matchReferenceDefinition(lines, end + 1);
			}
			pushProtectedBlock("raw", analysis, i, end);
			paragraphOpen = false;
			i = end + 1;
			continue;
		}
		if (!paragraphOpen) {
			const unmatchedRef = REFERENCE_DEF_LINE.exec(analysis.rest);
			if (unmatchedRef?.[1]) {
				const key = normalizeReferenceKey(unmatchedRef[1]);
				if (key.length > 0) {
					seenReferenceLabels.add(key);
				}
			}
		}

		// 8. Raw HTML comments and paired HTML block containers.
		if (analysis.prefix.length === 0 && analysis.content.startsWith("<!--")) {
			let end = i;
			while (end < lines.length && !(lines[end] ?? "").includes("-->")) {
				end += 1;
			}
			if (end < lines.length) {
				pushProtectedBlock("raw", analysis, i, end);
				paragraphOpen = false;
				i = end + 1;
				continue;
			}
		}

		if (analysis.prefix.length === 0) {
			const htmlOpener = matchHtmlBlockOpener(analysis.content);
			if (htmlOpener) {
				const end = htmlOpener.selfClosing
					? i
					: findHtmlBlockEnd(lines, i, htmlOpener.tagName);
				if (end >= i) {
					pushProtectedBlock("raw", analysis, i, end);
					paragraphOpen = false;
					i = end + 1;
					continue;
				}
			}
		}

		pushOutputLine(
			extractInlineProtectedSyntax(
				line,
				sentinel,
				protectedInlines,
				isTableRow,
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
		i += 1;
	}

	return {
		deferredReferences,
		lineEnding,
		markdown: outputLines.join("\n"),
		outputLineRanges,
		protectedBlocks,
		protectedInlines,
		rawLines: lines,
		references,
		sentinel,
		tableAlignMarkers,
	};
}
