import type { ProtectedBlockKind, ProtectedInlineKind } from "./visual-schema";

export type ProtectedBlockEntry = Readonly<{
	kind: ProtectedBlockKind;
	rawMarkdown: string;
}>;

export type ProtectedInlineEntry = Readonly<{
	kind: ProtectedInlineKind;
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
	markdown: string;
	outputLineRanges: ReadonlyArray<PrescannedLineRange | null>;
	protectedBlocks: ReadonlyMap<string, ProtectedBlockEntry>;
	protectedInlines: ReadonlyMap<string, ProtectedInlineEntry>;
	rawLines: ReadonlyArray<string>;
	references: Record<string, ReferenceDefinition>;
	sentinel: string;
	tableAlignMarkers: ReadonlyMap<string, string>;
}>;

export const TABLE_ALIGN_PREFIX = "<!-- easymde-table-align:v1 ";
export const TABLE_ALIGN_SUFFIX = " -->";

const HTML_BLOCK_TAGS = new Set([
	"article",
	"aside",
	"audio",
	"blockquote",
	"center",
	"details",
	"div",
	"dl",
	"fieldset",
	"figure",
	"footer",
	"form",
	"header",
	"hr",
	"iframe",
	"main",
	"nav",
	"ol",
	"p",
	"pre",
	"script",
	"section",
	"style",
	"summary",
	"table",
	"ul",
	"video",
]);

function createCollisionFreeSentinel(source: string): string {
	let sentinel = "EASYMDEPH";
	while (source.includes(sentinel)) {
		sentinel = `${sentinel}X`;
	}
	return sentinel;
}

function matchFenceOpener(line: string): Readonly<{
	fenceChar: "`" | "~";
	fenceLength: number;
	info: string;
}> | null {
	const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
	if (!match?.[1]) {
		return null;
	}
	const info = match[2] ?? "";
	const fenceChar = match[1][0] === "~" ? "~" : "`";
	if (fenceChar === "`" && info.includes("`")) {
		return null;
	}
	return { fenceChar, fenceLength: match[1].length, info };
}

function isFenceCloser(
	line: string,
	fenceChar: "`" | "~",
	fenceLength: number,
): boolean {
	const match =
		fenceChar === "`"
			? /^ {0,3}(`{3,})[ \t]*$/.exec(line)
			: /^ {0,3}(~{3,})[ \t]*$/.exec(line);
	return Boolean(match?.[1] && match[1].length >= fenceLength);
}

function isGfmTableStart(lines: ReadonlyArray<string>, index: number): boolean {
	const headerLine = lines[index];
	const delimiterLine = lines[index + 1];
	if (
		headerLine === undefined ||
		delimiterLine === undefined ||
		!headerLine.includes("|")
	) {
		return false;
	}
	const trimmedDelim = delimiterLine.trim();
	return (
		trimmedDelim.includes("-") &&
		(/^\|?[ \t]*:?-{1,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)+\|?$/.test(
			trimmedDelim,
		) ||
			/^\|[ \t]*:?-{1,}:?[ \t]*\|$/.test(trimmedDelim))
	);
}

function parseReferenceDefLine(
	line: string,
): Readonly<{ href: string; key: string; title: string }> | null {
	const match =
		/^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(\S+)(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/.exec(
			line,
		);
	if (!match?.[1] || !match[2]) {
		return null;
	}
	const key = match[1].trim().replace(/\s+/g, " ").toUpperCase();
	if (key.length === 0) {
		return null;
	}
	const rawHref = match[2];
	const href =
		rawHref.startsWith("<") && rawHref.endsWith(">") && rawHref.length >= 2
			? rawHref.slice(1, -1)
			: rawHref;
	return { key, href, title: match[3] ?? match[4] ?? match[5] ?? "" };
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
	let activeFence: Readonly<{
		fenceChar: "`" | "~";
		fenceLength: number;
	}> | null = null;

	for (let i = startIndex; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		if (activeFence) {
			if (isFenceCloser(line, activeFence.fenceChar, activeFence.fenceLength)) {
				activeFence = null;
			}
			continue;
		}
		if (i > startIndex) {
			const fence = matchFenceOpener(line);
			if (fence) {
				activeFence = {
					fenceChar: fence.fenceChar,
					fenceLength: fence.fenceLength,
				};
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
			return i;
		}
	}
	return -1;
}

function isEscapedAt(text: string, index: number): boolean {
	let slashes = 0;
	for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
		slashes += 1;
	}
	return slashes % 2 === 1;
}

function extractInlineProtectedSyntax(
	line: string,
	sentinel: string,
	protectedInlines: Map<string, ProtectedInlineEntry>,
	isTableRow: boolean,
): string {
	let result = "";
	let index = 0;
	const length = line.length;

	const allocateToken = (
		kind: ProtectedInlineKind,
		rawMarkdown: string,
	): string => {
		const token = `${sentinel}INL${protectedInlines.size}END`;
		protectedInlines.set(token, { kind, rawMarkdown });
		return token;
	};

	while (index < length) {
		const ch = line[index] ?? "";

		// Preserve inline code spans verbatim so math/footnotes inside backticks stay literal.
		if (ch === "`" && !isEscapedAt(line, index)) {
			let tickEnd = index;
			while (tickEnd < length && line[tickEnd] === "`") {
				tickEnd += 1;
			}
			const tickLen = tickEnd - index;
			const delimiter = "`".repeat(tickLen);
			let searchFrom = tickEnd;
			let closePos = -1;
			while (searchFrom < length) {
				const found = line.indexOf(delimiter, searchFrom);
				if (found < 0) {
					break;
				}
				const beforeIsTick = found > 0 && line[found - 1] === "`";
				const afterIsTick =
					found + tickLen < length && line[found + tickLen] === "`";
				if (!beforeIsTick && !afterIsTick) {
					closePos = found;
					break;
				}
				searchFrom = found + 1;
			}
			if (closePos >= 0) {
				result += line.slice(index, closePos + tickLen);
				index = closePos + tickLen;
				continue;
			}
			result += delimiter;
			index = tickEnd;
			continue;
		}

		// Inline LaTeX math: \(...\)
		if (ch === "\\" && line[index + 1] === "(" && !isEscapedAt(line, index)) {
			let closePos = -1;
			for (let j = index + 2; j < length - 1; j += 1) {
				if (line[j] === "\\" && line[j + 1] === ")" && !isEscapedAt(line, j)) {
					closePos = j;
					break;
				}
			}
			if (closePos > index + 2) {
				result += allocateToken("math-inline", line.slice(index, closePos + 2));
				index = closePos + 2;
				continue;
			}
		}

		// Inline dollar math: $...$ (single non-escaped dollar, never crossing table cell pipes).
		if (ch === "$" && line[index + 1] !== "$" && !isEscapedAt(line, index)) {
			let closePos = -1;
			for (let j = index + 1; j < length; j += 1) {
				const cur = line[j] ?? "";
				if (isTableRow && cur === "|" && !isEscapedAt(line, j)) {
					break;
				}
				if (cur === "$" && !isEscapedAt(line, j)) {
					if (line[j + 1] === "$") {
						break;
					}
					closePos = j;
					break;
				}
			}
			if (closePos > index + 1) {
				result += allocateToken("math-inline", line.slice(index, closePos + 1));
				index = closePos + 1;
				continue;
			}
		}

		// Footnote reference: [^label]
		if (ch === "[" && line[index + 1] === "^" && !isEscapedAt(line, index)) {
			const rest = line.slice(index);
			const match = /^\[\^([^\s\]]+)\]/.exec(rest);
			if (match) {
				const afterChar = rest[match[0].length];
				if (afterChar !== ":" && afterChar !== "(" && afterChar !== "[") {
					result += allocateToken("footnote-ref", match[0]);
					index += match[0].length;
					continue;
				}
			}
		}

		// Inline HTML comment: <!-- ... -->
		if (ch === "<" && line.startsWith("<!--", index)) {
			const closeComment = line.indexOf("-->", index + 4);
			if (closeComment >= 0) {
				result += allocateToken(
					"raw-inline",
					line.slice(index, closeComment + 3),
				);
				index = closeComment + 3;
				continue;
			}
		}

		result += ch;
		index += 1;
	}

	return result;
}

export function prescanMarkdown(rawMarkdown: string): PreScanResult {
	const normalized = rawMarkdown.replace(/\r\n?/g, "\n");
	const sentinel = createCollisionFreeSentinel(normalized);
	const lines = normalized.split("\n");
	const outputLines: string[] = [];
	const outputLineRanges: Array<PrescannedLineRange | null> = [];
	const protectedBlocks = new Map<string, ProtectedBlockEntry>();
	const protectedInlines = new Map<string, ProtectedInlineEntry>();
	const tableAlignMarkers = new Map<string, string>();
	const references: Record<string, ReferenceDefinition> = {};

	const pushOutputLine = (
		text: string,
		range: PrescannedLineRange | null,
	): void => {
		outputLines.push(text);
		outputLineRanges.push(range);
	};

	const pushProtectedBlock = (
		kind: ProtectedBlockKind,
		blockRaw: string,
		origStart: number,
		origEnd: number,
	): void => {
		const token = `${sentinel}BLK${protectedBlocks.size}END`;
		protectedBlocks.set(token, { kind, rawMarkdown: blockRaw });
		const prevLine = outputLines[outputLines.length - 1];
		if (prevLine !== undefined && prevLine.trim().length > 0) {
			pushOutputLine("", null);
		}
		pushOutputLine(token, { start: origStart, end: origEnd });
		pushOutputLine("", null);
	};

	let i = 0;
	let inIndentedCode = false;

	while (i < lines.length) {
		const line = lines[i] ?? "";
		const trimmed = line.trim();
		const prevOut = outputLines[outputLines.length - 1];
		const prevWasBlank = prevOut === undefined || prevOut.trim().length === 0;

		if ((prevWasBlank || inIndentedCode) && /^(?: {4}|\t)/.test(line)) {
			inIndentedCode = true;
			pushOutputLine(line, { start: i, end: i + 1 });
			i += 1;
			continue;
		}
		if (trimmed.length > 0) {
			inIndentedCode = false;
		}

		// 1. Fenced code blocks (Mermaid becomes protected_block; all other fences pass untouched).
		const fence = matchFenceOpener(line);
		if (fence) {
			let end = i + 1;
			while (
				end < lines.length &&
				!isFenceCloser(lines[end] ?? "", fence.fenceChar, fence.fenceLength)
			) {
				end += 1;
			}
			const blockEnd = end < lines.length ? end : lines.length - 1;
			const lang = (fence.info.trim().split(/\s+/)[0] ?? "").toLowerCase();
			if (lang === "mermaid") {
				pushProtectedBlock(
					"mermaid",
					lines.slice(i, blockEnd + 1).join("\n"),
					i,
					blockEnd + 1,
				);
			} else {
				for (let k = i; k <= blockEnd; k += 1) {
					pushOutputLine(lines[k] ?? "", { start: k, end: k + 1 });
				}
			}
			i = blockEnd + 1;
			continue;
		}

		// 2. EasyMDE table alignment annotation directly preceding a GFM table.
		if (
			/^ {0,3}<!-- easymde-table-align:v1\s+/.test(line) &&
			trimmed.endsWith(TABLE_ALIGN_SUFFIX) &&
			isGfmTableStart(lines, i + 1)
		) {
			const markerToken = `${sentinel}TBLALIGN${tableAlignMarkers.size}END`;
			tableAlignMarkers.set(markerToken, trimmed);
			pushOutputLine(markerToken, { start: i, end: i + 1 });
			i += 1;
			continue;
		}

		// 3. Block math: $$...$$ and \[...\] (single-line or multi-line).
		if (/^ {0,3}\$\$/.test(line)) {
			if (/^ {0,3}\$\$[^\n]+?\$\$[ \t]*$/.test(line)) {
				pushProtectedBlock("math", line, i, i + 1);
				i += 1;
				continue;
			}
			let end = i + 1;
			while (end < lines.length && !/\$\$[ \t]*$/.test(lines[end] ?? "")) {
				end += 1;
			}
			if (end < lines.length) {
				pushProtectedBlock(
					"math",
					lines.slice(i, end + 1).join("\n"),
					i,
					end + 1,
				);
				i = end + 1;
				continue;
			}
		}

		if (!/^ {0,3}\\\\\[/.test(line) && /^ {0,3}\\\[/.test(line)) {
			if (/^ {0,3}\\\[[^\n]+?\\\][ \t]*$/.test(line)) {
				pushProtectedBlock("math", line, i, i + 1);
				i += 1;
				continue;
			}
			let end = i + 1;
			while (end < lines.length && !/\\\][ \t]*$/.test(lines[end] ?? "")) {
				end += 1;
			}
			if (end < lines.length) {
				pushProtectedBlock(
					"math",
					lines.slice(i, end + 1).join("\n"),
					i,
					end + 1,
				);
				i = end + 1;
				continue;
			}
		}

		// 4. Standalone [TOC] line.
		if (/^ {0,3}\[TOC\][ \t]*$/i.test(line)) {
			const prevRaw = i === 0 ? "" : (lines[i - 1] ?? "");
			const nextRaw = i + 1 >= lines.length ? "" : (lines[i + 1] ?? "");
			if (prevRaw.trim().length === 0 && nextRaw.trim().length === 0) {
				pushProtectedBlock("toc", line, i, i + 1);
				i += 1;
				continue;
			}
		}

		// 5. Footnote definitions: [^label]: ... (including indented continuations).
		if (/^ {0,3}\[\^([^\s\]]+)\]:(?:[ \t]|$)/.test(line)) {
			let end = i;
			while (end + 1 < lines.length) {
				const next = lines[end + 1] ?? "";
				if (
					/^(?: {2,}|\t)/.test(next) ||
					/^ {0,3}\[\^([^\s\]]+)\]:(?:[ \t]|$)/.test(next)
				) {
					end += 1;
					continue;
				}
				if (
					next.trim().length === 0 &&
					end + 2 < lines.length &&
					/^(?: {2,}|\t)/.test(lines[end + 2] ?? "")
				) {
					end += 2;
					continue;
				}
				break;
			}
			pushProtectedBlock(
				"footnotes",
				lines.slice(i, end + 1).join("\n"),
				i,
				end + 1,
			);
			i = end + 1;
			continue;
		}

		// 6. Reference link definitions: [label]: url "title"
		const refDef = parseReferenceDefLine(line);
		if (refDef) {
			let end = i;
			references[refDef.key] = { href: refDef.href, title: refDef.title };
			while (end + 1 < lines.length) {
				const nextRef = parseReferenceDefLine(lines[end + 1] ?? "");
				if (!nextRef) {
					break;
				}
				references[nextRef.key] = { href: nextRef.href, title: nextRef.title };
				end += 1;
			}
			pushProtectedBlock("raw", lines.slice(i, end + 1).join("\n"), i, end + 1);
			i = end + 1;
			continue;
		}

		// 7. Raw HTML comments and paired HTML block containers.
		if (/^ {0,3}<!--/.test(line)) {
			let end = i;
			while (end < lines.length && !(lines[end] ?? "").includes("-->")) {
				end += 1;
			}
			if (end < lines.length) {
				pushProtectedBlock(
					"raw",
					lines.slice(i, end + 1).join("\n"),
					i,
					end + 1,
				);
				i = end + 1;
				continue;
			}
		}

		const htmlOpener = matchHtmlBlockOpener(line);
		if (htmlOpener) {
			const end = htmlOpener.selfClosing
				? i
				: findHtmlBlockEnd(lines, i, htmlOpener.tagName);
			if (end >= i) {
				pushProtectedBlock(
					"raw",
					lines.slice(i, end + 1).join("\n"),
					i,
					end + 1,
				);
				i = end + 1;
				continue;
			}
		}

		pushOutputLine(
			extractInlineProtectedSyntax(
				line,
				sentinel,
				protectedInlines,
				trimmed.includes("|"),
			),
			{ start: i, end: i + 1 },
		);
		i += 1;
	}

	return {
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
