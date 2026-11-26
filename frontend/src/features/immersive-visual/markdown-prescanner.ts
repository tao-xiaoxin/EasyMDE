import { isCommonMarkWhitespaceCode } from "../../shared/markdown/markdown-char-codes";
import { matchLeagueHtmlBlockType } from "../../shared/markdown/markdown-html-scanners";
import {
	advanceCodePoint,
	findLinkTitleCloseIndex,
	scanLinkDestinationRange,
} from "../../shared/markdown/markdown-link-destination";
import {
	checkFenceLineStatus,
	createBlockScanCache,
	createContainerCodeLineStepper,
	detectFenceInBody,
	FOOTNOTE_DEF_LINE,
	findBlockMathEnd,
	findGfmTableEnd,
	findLeagueHtmlBlockEnd,
	findParagraphProseRunEnd,
	hasMultilineInlineOpener,
	isCommonMarkParagraphInterrupter,
	isGfmTableStartAt,
	isGfmTableStartAtLine,
} from "./markdown-prescanner-blocks";
import {
	type ClassifiedLineContainers,
	type ContainerFrame,
	formatContainerSignature,
	isMarkdownBlankLine,
	leadingColumnsFrom,
	type StripContainerBlockOptions,
	standardContainerPrefix,
	stepContainerBlockLine,
	stripContainerBlockLines,
	stripLeadingAsciiSpaceTab,
	stripTrailingAsciiSpaceTab,
} from "./markdown-prescanner-containers";
import {
	extractInlineProtectedSyntax,
	extractInlineProtectedSyntaxChunk,
	type ProtectedInlineEntry,
} from "./markdown-prescanner-inline";
import {
	TABLE_ALIGN_PREFIX,
	TABLE_ALIGN_SUFFIX,
} from "./table-alignment-codec";
import type { ProtectedBlockKind } from "./visual-schema";

type ProtectedBlockEntry = Readonly<{
	kind: ProtectedBlockKind;
	rawMarkdown: string;
}>;

type ReferenceDefinition = Readonly<{
	href: string;
	title: string;
}>;

type PrescannedLineRange = Readonly<{
	end: number;
	start: number;
}>;

type FencedBlockOrigin = Readonly<{
	closed: boolean;
	col: number;
	firstLineBody: string;
	frames: ReadonlyArray<ContainerFrame>;
}>;

export type PreScanResult = Readonly<{
	fencedBlocks: ReadonlyMap<number, FencedBlockOrigin>;
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

function normalizeReferenceKey(label: string): string {
	return label.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase();
}

const MAX_REF_LABEL_CODE_POINTS = 999;

type ReferenceDefinitionMatch = Readonly<{
	end: number;
	href: string;
	key: string;
	label: string;
	title: string;
}>;

function scanMultilineReferenceTitle(
	lines: ReadonlyArray<string>,
	startLineIdx: number,
	initialText: string,
	frames: ReadonlyArray<ContainerFrame>,
): Readonly<{ end: number; title: string }> | null {
	if (initialText.length === 0) return null;
	const quoteCode = initialText.charCodeAt(0);
	if (
		34 /* " */ !== quoteCode &&
		39 /* ' */ !== quoteCode &&
		40 /* ( */ !== quoteCode
	) {
		return null;
	}
	const parts: string[] = [];
	let curLineIdx = startLineIdx;
	let lineText = initialText;
	let pos = 1;

	for (;;) {
		const foundClose = findLinkTitleCloseIndex(
			lineText,
			pos,
			lineText.length,
			quoteCode,
		);
		if (foundClose === -2) return null;
		if (foundClose >= 0) {
			if (!isMarkdownBlankLine(lineText.slice(foundClose + 1))) {
				return null;
			}
			parts.push(lineText.slice(0, foundClose + 1));
			return { end: curLineIdx, title: parts.join("\n").slice(1, -1) };
		}
		parts.push(lineText);
		curLineIdx += 1;
		if (curLineIdx >= lines.length) return null;
		const nextStep = stepContainerBlockLine(lines[curLineIdx] ?? "", frames);
		if (
			!nextStep.continues ||
			nextStep.isBlank ||
			isCommonMarkParagraphInterrupter(nextStep.body, nextStep.col, false)
		) {
			return null;
		}
		lineText = stripLeadingAsciiSpaceTab(nextStep.body);
		pos = 0;
	}
}

export function matchReferenceDefinition(
	lines: ReadonlyArray<string>,
	start: number,
	firstLineContent: string | null,
	frames: ReadonlyArray<ContainerFrame>,
): ReferenceDefinitionMatch | null {
	let content: string;
	if (firstLineContent !== null) {
		content = firstLineContent;
	} else {
		if (start >= lines.length) return null;
		const step = stepContainerBlockLine(lines[start] ?? "", frames);
		if (!step.continues || step.isBlank) return null;
		if (leadingColumnsFrom(step.body, step.col) > 3) return null;
		content = stripLeadingAsciiSpaceTab(step.body);
	}
	if (
		content.length === 0 ||
		91 /* [ */ !== content.charCodeAt(0) ||
		FOOTNOTE_DEF_LINE.test(content)
	) {
		return null;
	}
	const labelParts: string[] = [];
	let labelLineIdx = start;
	let lineText = content;
	let segStart = 1;
	let pos = 1;
	let codePoints = 0;
	let hasNonWs = false;
	let closeBracketPos = -1;

	for (;;) {
		const len = lineText.length;
		while (pos < len) {
			const ch = lineText.charCodeAt(pos);
			if (92 /* \ */ === ch) {
				if (pos + 1 < len) {
					codePoints += 2;
					if (codePoints > MAX_REF_LABEL_CODE_POINTS) return null;
					hasNonWs = true;
					pos = advanceCodePoint(lineText, pos + 1, len);
					continue;
				}
				codePoints += 1;
				if (codePoints > MAX_REF_LABEL_CODE_POINTS) return null;
				hasNonWs = true;
				pos += 1;
				break;
			}
			if (91 /* [ */ === ch) return null;
			if (93 /* ] */ === ch) {
				closeBracketPos = pos;
				break;
			}
			codePoints += 1;
			if (codePoints > MAX_REF_LABEL_CODE_POINTS) return null;
			if (!isCommonMarkWhitespaceCode(ch)) hasNonWs = true;
			pos = advanceCodePoint(lineText, pos, len);
		}
		if (closeBracketPos >= 0) {
			if (
				!hasNonWs ||
				closeBracketPos + 1 >= len ||
				58 /* : */ !== lineText.charCodeAt(closeBracketPos + 1)
			) {
				return null;
			}
			labelParts.push(lineText.slice(segStart, closeBracketPos));
			break;
		}
		labelParts.push(lineText.slice(segStart));
		codePoints += 1;
		if (codePoints > MAX_REF_LABEL_CODE_POINTS) return null;
		labelLineIdx += 1;
		if (labelLineIdx >= lines.length) return null;
		const nextStep = stepContainerBlockLine(lines[labelLineIdx] ?? "", frames);
		if (
			!nextStep.continues ||
			nextStep.isBlank ||
			isCommonMarkParagraphInterrupter(nextStep.body, nextStep.col, false)
		) {
			return null;
		}
		lineText = stripLeadingAsciiSpaceTab(nextStep.body);
		segStart = 0;
		pos = 0;
	}

	const label = labelParts.join(" ").trim().replace(/\s+/g, " ");
	const key = normalizeReferenceKey(label);
	if (key.length === 0) {
		return null;
	}
	let remainder = stripLeadingAsciiSpaceTab(
		lineText.slice(closeBracketPos + 2),
	);
	let end = labelLineIdx;
	if (isMarkdownBlankLine(remainder)) {
		const next = lines[end + 1];
		if (next === undefined) {
			return null;
		}
		const nextStep = stepContainerBlockLine(next, frames);
		if (
			!nextStep.continues ||
			nextStep.isBlank ||
			isCommonMarkParagraphInterrupter(nextStep.body, nextStep.col, false)
		) {
			return null;
		}
		remainder = stripLeadingAsciiSpaceTab(nextStep.body);
		end += 1;
	}
	const destRange = scanLinkDestinationRange(remainder, 0, remainder.length);
	if (!destRange) {
		return null;
	}
	const rest = remainder.slice(destRange.to);
	if (
		rest.length > 0 &&
		32 !== rest.charCodeAt(0) &&
		9 !== rest.charCodeAt(0)
	) {
		return null;
	}
	const isAngle = 60 /* < */ === remainder.charCodeAt(destRange.from);
	const href = isAngle
		? remainder.slice(destRange.from + 1, destRange.to - 1)
		: remainder.slice(destRange.from, destRange.to);
	if (!isAngle) {
		for (let idx = 0; idx < href.length; idx += 1) {
			const code = href.charCodeAt(idx);
			if (code <= 31 || 127 === code) return null;
		}
	}
	let title = "";
	if (!isMarkdownBlankLine(rest)) {
		const parsedTitle = scanMultilineReferenceTitle(
			lines,
			end,
			stripLeadingAsciiSpaceTab(rest),
			frames,
		);
		if (!parsedTitle) {
			return null;
		}
		title = parsedTitle.title;
		end = parsedTitle.end;
	} else {
		const nextLine = lines[end + 1];
		if (nextLine !== undefined) {
			const nextStep = stepContainerBlockLine(nextLine, frames);
			if (
				nextStep.continues &&
				!nextStep.isBlank &&
				!isCommonMarkParagraphInterrupter(nextStep.body, nextStep.col, false)
			) {
				const parsedTitle = scanMultilineReferenceTitle(
					lines,
					end + 1,
					stripLeadingAsciiSpaceTab(nextStep.body),
					frames,
				);
				if (parsedTitle) {
					title = parsedTitle.title;
					end = parsedTitle.end;
				}
			}
		}
	}
	return { end, href, key, label, title };
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
	const fencedBlocks = new Map<number, FencedBlockOrigin>();
	const protectedBlocks = new Map<string, ProtectedBlockEntry>();
	const protectedInlines = new Map<string, ProtectedInlineEntry>();
	const tableAlignMarkers = new Map<string, string>();
	const references: Record<string, ReferenceDefinition> = {};
	const blockScanCache = createBlockScanCache();

	const pushOutputLine = (
		text: string,
		range: PrescannedLineRange | null,
	): void => {
		outputLines.push(text);
		outputLineRanges.push(range);
	};

	/**
	 * Protect original lines `origStart..lastLine` (inclusive), peeling ONLY the
	 * active container frames via `stripContainerBlockLines` and emitting a
	 * single-line self-terminating ATX heading sentinel for `markdown-it`.
	 */
	const pushProtectedBlock = (
		kind: ProtectedBlockKind,
		classified: ClassifiedLineContainers,
		origStart: number,
		lastLine: number,
		stripOptions?: StripContainerBlockOptions,
	): void => {
		const origEnd = lastLine + 1;
		const token = `${sentinel}BLK${protectedBlocks.size}END`;
		const relIndent = Math.min(classified.relIndent, 3);
		const rawMarkdown = stripContainerBlockLines(
			lines,
			classified.blockFrames,
			origStart,
			origEnd,
			classified.body,
			classified.col,
			stripOptions,
		).join("\n");
		protectedBlocks.set(token, { kind, rawMarkdown });

		// Emit as a single-line ATX heading sentinel so markdown-it treats the
		// placeholder as a closed block (never merging a following `2. Text`).
		pushOutputLine(`${classified.prefix}${" ".repeat(relIndent)}# ${token}`, {
			end: origEnd,
			start: origStart,
		});
	};

	const stepper = createContainerCodeLineStepper({ detectFences: false });
	let i = 0;
	let tableRowStart = -1;
	let tableRowEnd = -1;

	while (i < lines.length) {
		const line = lines[i] ?? "";
		const stepped = stepper.step(line);
		if (typeof stepped === "string" || stepped.kind !== "content") {
			pushOutputLine(line, { end: i + 1, start: i });
			i += 1;
			continue;
		}
		const { classified } = stepped;
		const bodyFrames = classified.blockFrames;

		// 1. Fenced code blocks (container aware: blockquotes and list items).
		const fence = detectFenceInBody(classified.body, classified.col, bodyFrames);
		if (fence) {
			let end = i + 1;
			let closed = false;
			while (end < lines.length) {
				const status = checkFenceLineStatus(lines[end] ?? "", fence);
				if (status === "closed") {
					closed = true;
					break;
				}
				if (status === "exited") {
					end -= 1;
					break;
				}
				end += 1;
			}
			const blockEnd = Math.min(end, lines.length - 1);
			fencedBlocks.set(i, {
				closed,
				col: classified.col,
				firstLineBody: classified.body,
				frames: bodyFrames,
			});
			for (let k = i; k <= blockEnd; k += 1) {
				pushOutputLine(lines[k] ?? "", { end: k + 1, start: k });
			}
			stepper.setState(bodyFrames, false);
			i = blockEnd + 1;
			continue;
		}

		// 2. EasyMDE table alignment annotation directly preceding a GFM table.
		if (
			classified.relIndent <= 3 &&
			classified.bodyContent.startsWith(TABLE_ALIGN_PREFIX) &&
			stripTrailingAsciiSpaceTab(classified.bodyContent).endsWith(
				TABLE_ALIGN_SUFFIX,
			) &&
			isGfmTableStartAtLine(lines, i + 1, bodyFrames)
		) {
			const markerToken = `${sentinel}TBLALIGN${tableAlignMarkers.size}END`;
			tableAlignMarkers.set(
				markerToken,
				stripTrailingAsciiSpaceTab(classified.bodyContent),
			);
			pushOutputLine(
				`${classified.prefix}${" ".repeat(classified.relIndent)}${markerToken}`,
				{ end: i + 1, start: i },
			);
			stepper.setState(bodyFrames, false);
			i += 1;
			continue;
		}

		if (
			i > tableRowEnd &&
			classified.relIndent <= 3 &&
			isGfmTableStartAt(classified.body, lines[i + 1] ?? "", bodyFrames)
		) {
			tableRowStart = i;
			tableRowEnd = findGfmTableEnd(lines, i, bodyFrames);
		}
		const isTableRow = i >= tableRowStart && i <= tableRowEnd;

		// 3. Block math: $$...$$ and \[...\] (single-line or multi-line).
		const blockMathEnd =
			classified.relIndent <= 3
				? findBlockMathEnd(
						lines,
						i,
						classified.bodyContent,
						bodyFrames,
						blockScanCache,
					)
				: -1;
		if (blockMathEnd >= i) {
			pushProtectedBlock("math", classified, i, blockMathEnd);
			stepper.setState(bodyFrames, false);
			i = blockMathEnd + 1;
			continue;
		}

		// 4. Standalone [TOC] line.
		if (
			classified.relIndent <= 3 &&
			91 /* [ */ === classified.bodyContent.charCodeAt(0) &&
			/^\[TOC\][ \t]*$/i.test(classified.bodyContent) &&
			(i === 0 || isMarkdownBlankLine(lines[i - 1] ?? "")) &&
			(i + 1 >= lines.length || isMarkdownBlankLine(lines[i + 1] ?? ""))
		) {
			pushProtectedBlock("toc", classified, i, i);
			stepper.setState(bodyFrames, false);
			i += 1;
			continue;
		}

		// 5. Footnote definitions (including blank-line separated continuations).
		if (
			classified.relIndent <= 3 &&
			91 /* [ */ === classified.bodyContent.charCodeAt(0) &&
			FOOTNOTE_DEF_LINE.test(classified.bodyContent)
		) {
			let end = i;
			while (end + 1 < lines.length) {
				const next = stepContainerBlockLine(lines[end + 1] ?? "", bodyFrames);
				if (!next.continues) break;
				if (!next.isBlank) {
					const nextIndent = leadingColumnsFrom(next.body, next.col);
					if (
						nextIndent >= 2 ||
						FOOTNOTE_DEF_LINE.test(stripLeadingAsciiSpaceTab(next.body))
					) {
						end += 1;
						continue;
					}
					break;
				}
				let lookahead = end + 1;
				let afterStep: ReturnType<typeof stepContainerBlockLine> | null = null;
				while (lookahead < lines.length) {
					const step = stepContainerBlockLine(
						lines[lookahead] ?? "",
						bodyFrames,
					);
					if (!step.continues) {
						afterStep = null;
						break;
					}
					if (!step.isBlank) {
						afterStep = step;
						break;
					}
					lookahead += 1;
				}
				if (
					afterStep &&
					leadingColumnsFrom(afterStep.body, afterStep.col) >= 2
				) {
					end = lookahead;
					continue;
				}
				break;
			}
			pushProtectedBlock("footnotes", classified, i, end, {
				expandContinuationTabs: "all",
			});
			stepper.setState(bodyFrames, false);
			i = end + 1;
			continue;
		}

		// 6. Reference link definitions. CommonMark forbids them from
		// interrupting a paragraph and resolves duplicates first-wins.
		let reference =
			classified.inParagraph || classified.relIndent > 3
				? null
				: matchReferenceDefinition(
						lines,
						i,
						classified.bodyContent,
						bodyFrames,
					);
		if (reference) {
			let end = i;
			while (reference) {
				if (references[reference.key] === undefined) {
					references[reference.key] = {
						href: reference.href,
						title: reference.title,
					};
				}
				end = reference.end;
				reference = matchReferenceDefinition(lines, end + 1, null, bodyFrames);
			}
			pushProtectedBlock("raw", classified, i, end, {
				expandContinuationTabs: "all",
			});
			stepper.setState(bodyFrames, false);
			i = end + 1;
			continue;
		}

		// 7. CommonMark §4.6 / League 2.8.2 HTML Blocks (Types 1–7).
		if (classified.relIndent <= 3) {
			const htmlBlockType = matchLeagueHtmlBlockType(
				classified.bodyContent,
				0,
				classified.inParagraph,
			);
			if (htmlBlockType > 0) {
				const end = findLeagueHtmlBlockEnd(
					lines,
					i,
					htmlBlockType,
					classified.bodyContent,
					bodyFrames,
					blockScanCache,
				);
				if (end >= i) {
					pushProtectedBlock("raw", classified, i, end);
					stepper.setState(bodyFrames, false);
					i = end + 1;
					continue;
				}
			}
		}

		if (
			!isTableRow &&
			classified.paragraphContinues &&
			i + 1 < lines.length &&
			hasMultilineInlineOpener(classified.body)
		) {
			const run = findParagraphProseRunEnd(
				lines,
				i,
				{ body: classified.body, prefix: classified.prefix },
				classified.proseFrames,
				blockScanCache,
			);
			if (run.end > i) {
				const containerContext =
					classified.proseFrames.length > 0
						? {
								linePrefixes: run.lines.map((entry) => entry.prefix),
								signature: formatContainerSignature(classified.proseFrames),
								standardPrefix: standardContainerPrefix(classified.proseFrames),
							}
						: undefined;
				const emittedLines = extractInlineProtectedSyntaxChunk(
					run.lines.map((entry) => entry.body).join("\n"),
					sentinel,
					protectedInlines,
					false,
					containerContext,
				);
				for (const entry of emittedLines) {
					const prefix =
						entry.startOffset === 0
							? classified.normalizedPrefix
							: (run.lines[entry.startOffset]?.prefix ?? "");
					pushOutputLine(`${prefix}${entry.text}`, {
						end: i + entry.endOffset,
						start: i + entry.startOffset,
					});
				}
				stepper.setState(classified.proseFrames, true);
				i = run.end + 1;
				continue;
			}
		}

		const renderedLine =
			classified.normalizedPrefix !== classified.prefix
				? `${classified.normalizedPrefix}${extractInlineProtectedSyntax(
						classified.body,
						sentinel,
						protectedInlines,
						isTableRow,
					)}`
				: extractInlineProtectedSyntax(
						line,
						sentinel,
						protectedInlines,
						isTableRow,
					);
		pushOutputLine(renderedLine, { end: i + 1, start: i });
		i += 1;
	}

	return {
		fencedBlocks,
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

/**
 * Prescan an inline Markdown fragment (such as the HTML-stripped body of a
 * `raw-inline` atom) without running block-level rules (`$$...$$` / `\[...\]`
 * display math stays a `math-inline` atom instead of becoming an unmapped
 * block sentinel).
 */
export function prescanInlineMarkdown(rawMarkdown: string): PreScanResult {
	const lineEnding: "\n" | "\r\n" = rawMarkdown.includes("\r\n")
		? "\r\n"
		: "\n";
	const normalized = rawMarkdown.replace(/\r\n?/g, "\n");
	const sentinel = createCollisionFreeSentinel(normalized);
	const protectedInlines = new Map<string, ProtectedInlineEntry>();
	const emitted = extractInlineProtectedSyntaxChunk(
		normalized,
		sentinel,
		protectedInlines,
		false,
	);
	return {
		fencedBlocks: new Map(),
		lineEnding,
		markdown: emitted.map((entry) => entry.text).join("\n"),
		outputLineRanges: emitted.map((entry) => ({
			end: entry.endOffset,
			start: entry.startOffset,
		})),
		protectedBlocks: new Map(),
		protectedInlines,
		rawLines: normalized.split("\n"),
		references: {},
		sentinel,
		tableAlignMarkers: new Map(),
	};
}
