import type MarkdownIt from "markdown-it";
import {
	collectTableRowCells,
	type GfmTableColumnAlignment,
	parseGfmTableSeparatorAlignments,
	unescapeTableCellPipes,
} from "../../shared/markdown/php-commonmark-block-helpers";
import {
	advanceParagraphReferenceParser,
	createParagraphReferenceParser,
	type ParagraphReferenceParser,
} from "../../shared/markdown/php-commonmark-reference-def";
import { readRawMetaString } from "./markdown-parser-inline";
import { isCommonMarkBlankLine } from "./markdown-prescanner-containers";
import {
	isTableSeparatorInterruptedByHigherPriorityBlock,
	opensNonParagraphBlock,
	startsParagraphInterruptingBlock,
} from "./markdown-prescanner-tables";
import {
	applyPendingPartialReferenceTitle,
	type EasyMdeBlockEnv,
	getLazyListRelativeIndent,
} from "./markdown-reference-preservation";

type BlockRuleFn = Parameters<
	InstanceType<typeof MarkdownIt>["block"]["ruler"]["at"]
>[1];
type BlockRuleState = Parameters<BlockRuleFn>[0];

type ParagraphPipeCacheEntry = {
	blkIndent: number;
	hasPipe: boolean;
	level: number;
	paraStart: number;
	scannedThrough: number;
};

type ReferenceTableProbeCacheEntry = {
	blkIndent: number;
	hasContent: boolean;
	hasPipe: boolean;
	level: number;
	refParser: ParagraphReferenceParser;
	refStart: number;
	scannedThrough: number;
};

export type EasyMdeTableRuleDeps = Readonly<{
	rawReferenceSourceMetaKey: string;
	wouldReferenceDefinitionAbsorbFollowingBlock: (
		lastRaw: string,
		followingMarkdown: string,
	) => boolean;
}>;

/**
 * Reports whether `line` is a lazy list continuation (`0 <= sCount < blkIndent`)
 * whose indentation relative to the deepest matching ancestor list container
 * is 4+ columns. PHP `League\CommonMark` treats such a line as indented code
 * for block-start purposes, so it can only continue the open paragraph (or
 * split a GFM table header) and must never start a blockquote, heading,
 * thematic break, or fence (`  2. x\n    > y`, `  10. > a\n    > b`).
 */
function isIndentedLazyListLine(state: BlockRuleState, line: number): boolean {
	const s = state.sCount[line] ?? 0;
	return (
		s >= 0 && s < state.blkIndent && getLazyListRelativeIndent(state, line) >= 4
	);
}

const MAX_AUTOCOMPLETED_CELLS = 10_000;

function emitPhpParityTable(
	state: BlockRuleState,
	startLine: number,
	endLine: number,
	headerLine: string,
	headerCells: ReadonlyArray<Readonly<{ end: number; start: number }>>,
	aligns: ReadonlyArray<GfmTableColumnAlignment>,
): boolean {
	const columnCount = headerCells.length;
	const oldParentType = state.parentType;
	state.parentType = "table";
	const terminatorRules = state.md.block.ruler.getRules("blockquote");
	const tableLines: [number, number] = [startLine, 0];
	const tokenTo = state.push("table_open", "table", 1);
	tokenTo.map = tableLines;
	const tokenTho = state.push("thead_open", "thead", 1);
	tokenTho.map = [startLine, startLine + 1];
	const tokenHtro = state.push("tr_open", "tr", 1);
	tokenHtro.map = [startLine, startLine + 1];
	for (let col = 0; col < columnCount; col += 1) {
		const tokenHo = state.push("th_open", "th", 1);
		const align = aligns[col] ?? null;
		if (align) tokenHo.attrs = [["style", `text-align:${align}`]];
		const cell = headerCells[col];
		const tokenIl = state.push("inline", "", 0);
		tokenIl.content = cell
			? unescapeTableCellPipes(headerLine.slice(cell.start, cell.end)).trim()
			: "";
		tokenIl.children = [];
		state.push("th_close", "th", -1);
	}
	state.push("tr_close", "tr", -1);
	state.push("thead_close", "thead", -1);

	let tbodyLines: [number, number] | null = null;
	let autocompletedCells = 0;
	let nextLine = startLine + 2;
	for (; nextLine < endLine; nextLine += 1) {
		const s = state.sCount[nextLine] ?? 0;
		if (s < state.blkIndent) break;
		const rPos = (state.bMarks[nextLine] ?? 0) + (state.tShift[nextLine] ?? 0);
		const rMax = state.eMarks[nextLine] ?? rPos;
		const rowText = state.src.slice(rPos, rMax);
		if (isCommonMarkBlankLine(rowText)) break;
		// Mirror PHP TableParser::tryContinue() + MarkdownParser::parseLine():
		// when all enclosing containers matched and the non-blank line contains
		// `|`, the table continues unconditionally (`$tryBlockStarts = false`).
		// When the line has no `|`, block starts run (4-space code + terminators)
		// and otherwise `canHaveLazyContinuationLines()` absorbs it as a row.
		if (!rowText.includes("|")) {
			if (s - state.blkIndent >= 4) break;
			let terminate = false;
			for (let r = 0; r < terminatorRules.length; r += 1) {
				if (terminatorRules[r]?.(state, nextLine, endLine, true)) {
					terminate = true;
					break;
				}
			}
			if (terminate) break;
		}
		const rowCells = collectTableRowCells(
			rowText,
			0,
			rowText.length,
			columnCount,
		);
		autocompletedCells += Math.max(0, columnCount - rowCells.length);
		if (autocompletedCells > MAX_AUTOCOMPLETED_CELLS) break;
		if (tbodyLines === null) {
			const tokenTbo = state.push("tbody_open", "tbody", 1);
			tbodyLines = [nextLine, 0];
			tokenTbo.map = tbodyLines;
		}
		const tokenTro = state.push("tr_open", "tr", 1);
		tokenTro.map = [nextLine, nextLine + 1];
		for (let col = 0; col < columnCount; col += 1) {
			const tokenTdo = state.push("td_open", "td", 1);
			const align = aligns[col] ?? null;
			if (align) tokenTdo.attrs = [["style", `text-align:${align}`]];
			const cell = rowCells[col];
			const tokenIl = state.push("inline", "", 0);
			tokenIl.content = cell
				? unescapeTableCellPipes(rowText.slice(cell.start, cell.end)).trim()
				: "";
			tokenIl.children = [];
			state.push("td_close", "td", -1);
		}
		state.push("tr_close", "tr", -1);
	}
	if (tbodyLines !== null) {
		state.push("tbody_close", "tbody", -1);
		tbodyLines[1] = nextLine;
	}
	state.push("table_close", "table", -1);
	tableLines[1] = nextLine;
	state.parentType = oldParentType;
	state.line = nextLine;
	return true;
}

/**
 * Creates the `easymde_table` block rule aligning `markdown-it` with PHP
 * `League\CommonMark\Extension\Table\TableStartParser` + `TableParser`:
 * - allows a header line without `|` when an earlier line in the same open
 *   paragraph contains `|` (`a |\nb\n| - |`), splitting off earlier lines;
 * - accepts `1 <= headerCells <= delimiterCols` (`| a |\n| - | - |`) and
 *   truncates body rows to `headerCells` columns;
 * - continues every GFM table uniformly through `emitPhpParityTable` using PHP
 *   `TableParser::tryContinue()` + `canHaveLazyContinuationLines()` rules; and
 * - rejects non-paragraph CommonMark block openers and §4.7 refdefs/titles.
 */
export function createEasyMdeTableRule(
	deps: EasyMdeTableRuleDeps,
): BlockRuleFn {
	const {
		rawReferenceSourceMetaKey,
		wouldReferenceDefinitionAbsorbFollowingBlock,
	} = deps;
	const paragraphPipeCache = new WeakMap<
		BlockRuleState,
		ParagraphPipeCacheEntry
	>();
	return (state, startLine, endLine, silent) => {
		if (startLine + 2 > endLine) {
			return false;
		}
		// Never interrupt an active CommonMark §4.7 reference definition
		// when probing continuation lines for a destination or title.
		if (silent && state.parentType === "reference") {
			return false;
		}
		const prevClose = state.tokens[state.tokens.length - 1];
		const prevOpen = state.tokens[state.tokens.length - 3];
		const followsRefDef =
			prevClose?.type === "reference_definition" &&
			prevClose.level === state.level &&
			prevClose.map?.[1] === startLine;
		const followsParagraph =
			(silent && state.parentType === "paragraph") ||
			(prevClose?.type === "paragraph_close" &&
				prevOpen?.type === "paragraph_open" &&
				prevOpen.level === state.level &&
				prevOpen.map?.[1] === startLine);
		const s0 = state.sCount[startLine] ?? 0;
		const relIndent0 = s0 - state.blkIndent;
		const isIndentedContinuation =
			(followsParagraph || followsRefDef) && relIndent0 >= 4;
		const isLazyContainerContinuation =
			(followsParagraph || followsRefDef) && s0 < state.blkIndent;
		if (
			!isIndentedContinuation &&
			!isLazyContainerContinuation &&
			(s0 < state.blkIndent || relIndent0 >= 4)
		) {
			return false;
		}
		const sepLine = startLine + 1;
		const s1 = state.sCount[sepLine] ?? 0;
		if (s1 < state.blkIndent) {
			return false;
		}
		const pos1 = (state.bMarks[sepLine] ?? 0) + (state.tShift[sepLine] ?? 0);
		const max1 = state.eMarks[sepLine] ?? pos1;
		const trimmedSep = state.src.slice(pos1, max1);
		const aligns = parseGfmTableSeparatorAlignments(trimmedSep);
		if (aligns === null || aligns.length === 0) {
			return false;
		}
		const sepColumn = (state.bsCount[sepLine] ?? 0) + s1;
		if (
			isTableSeparatorInterruptedByHigherPriorityBlock(
				trimmedSep,
				sepColumn,
				s1 - state.blkIndent,
			)
		) {
			return false;
		}
		const pos0 =
			(state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
		const max0 = state.eMarks[startLine] ?? pos0;
		const trimmedStart = state.src.slice(pos0, max0);
		const headerHasPipe = trimmedStart.includes("|");
		if (!headerHasPipe) {
			let priorParagraphHasPipe = false;
			if (silent && state.parentType === "paragraph") {
				const paraStart = state.line;
				let entry = paragraphPipeCache.get(state);
				if (
					!entry ||
					entry.paraStart !== paraStart ||
					entry.level !== state.level ||
					entry.blkIndent !== state.blkIndent ||
					entry.scannedThrough > startLine
				) {
					entry = {
						blkIndent: state.blkIndent,
						hasPipe: false,
						level: state.level,
						paraStart,
						scannedThrough: paraStart,
					};
					paragraphPipeCache.set(state, entry);
				}
				if (!entry.hasPipe) {
					for (let line = entry.scannedThrough; line < startLine; line += 1) {
						const lp = (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
						const lm = state.eMarks[line] ?? lp;
						if (state.src.slice(lp, lm).includes("|")) {
							entry.hasPipe = true;
							entry.scannedThrough = line + 1;
							break;
						}
					}
					if (!entry.hasPipe) {
						entry.scannedThrough = startLine;
					}
				}
				priorParagraphHasPipe = entry.hasPipe;
			} else if (followsParagraph) {
				const prevInline = state.tokens[state.tokens.length - 2];
				priorParagraphHasPipe =
					prevInline?.type === "inline" && prevInline.content.includes("|");
			}
			if (!priorParagraphHasPipe) {
				return false;
			}
		}
		const headerCells = collectTableRowCells(
			trimmedStart,
			0,
			trimmedStart.length,
		);
		if (headerCells.length === 0 || headerCells.length > aligns.length) {
			return false;
		}
		if (!isIndentedContinuation) {
			const trimmedSentinel = trimmedStart.replace(/^[ \t]+|[ \t]+$/g, "");
			const env = state.env as {
				preScan?: { protectedBlocks?: ReadonlyMap<string, unknown> };
				tableAlignMarkers?: ReadonlyMap<string, string>;
			};
			if (
				env.preScan?.protectedBlocks?.has(trimmedSentinel) ||
				env.tableAlignMarkers?.has(trimmedSentinel)
			) {
				return false;
			}
		}
		if (isLazyContainerContinuation) {
			// On a lazy container continuation (`sCount < blkIndent`), PHP
			// `MarkdownParser::parseLine()` runs block start parsers with
			// `$parserState->getParagraphContent() === null`: any `< 4`-indented
			// interrupting block (ATX heading, blockquote, fence, HR, HTML 1–6,
			// or ANY list marker including `- `, `2.`, `01.`) closes the
			// enclosing container instead of continuing as a table header.
			if (s0 < 0) {
				const rawLazyCandidate = state.src.slice(
					state.bMarks[startLine] ?? 0,
					max0,
				);
				if (
					startsParagraphInterruptingBlock(
						rawLazyCandidate,
						state.bsCount[startLine] ?? 0,
						{ allowIndentedCode: false },
					)
				) {
					return false;
				}
			} else {
				const lazyRelativeIndent = getLazyListRelativeIndent(state, startLine);
				const startColumn = (state.bsCount[startLine] ?? 0) + s0;
				if (
					startsParagraphInterruptingBlock(trimmedStart, startColumn, {
						allowIndentedCode: false,
						relativeIndentColumns: lazyRelativeIndent,
					})
				) {
					return false;
				}
			}
		} else if (!isIndentedContinuation) {
			const startColumn = (state.bsCount[startLine] ?? 0) + s0;
			// Reject non-paragraph CommonMark block openers and §4.7 link
			// reference definitions / titles via the canonical shared guard.
			if (opensNonParagraphBlock(trimmedStart, startColumn, followsParagraph)) {
				return false;
			}
		}
		if (
			!followsParagraph &&
			advanceParagraphReferenceParser(
				createParagraphReferenceParser(),
				trimmedStart,
			)
		) {
			return false;
		}
		if (followsRefDef && prevClose) {
			const prevRaw = readRawMetaString(prevClose, rawReferenceSourceMetaKey);
			if (
				prevRaw !== null &&
				wouldReferenceDefinitionAbsorbFollowingBlock(prevRaw, trimmedStart)
			) {
				return false;
			}
		}
		if (silent) {
			return true;
		}
		applyPendingPartialReferenceTitle(state, startLine, startLine + 1);
		return emitPhpParityTable(
			state,
			startLine,
			endLine,
			trimmedStart,
			headerCells,
			aligns,
		);
	};
}

function isAsciiTrimmable(code: number): boolean {
	return code === 32 || code === 9 || code === 10 || code === 13;
}

function asciiTrimBlock(value: string): string {
	let start = 0;
	while (start < value.length && isAsciiTrimmable(value.charCodeAt(start))) {
		start += 1;
	}
	let end = value.length - 1;
	while (end >= start && isAsciiTrimmable(value.charCodeAt(end))) {
		end -= 1;
	}
	return value.slice(start, end + 1);
}

/**
 * Wraps `markdown-it`'s Setext heading (`lheading`) rule so 4-space indented
 * (`sCount - blkIndent > 3`) and lazy (`sCount < 0`) paragraph continuation
 * lines still probe `easymde_table` before scanning further for `===`/`---`.
 */
export function createEasyMdeLheadingRule(tableRule: BlockRuleFn): BlockRuleFn {
	return (state, startLine, endLine) => {
		const terminatorRules = state.md.block.ruler.getRules("paragraph");
		const prevToken = state.tokens[state.tokens.length - 1];
		const followsRefDef =
			prevToken?.type === "reference_definition" &&
			prevToken.level === state.level &&
			prevToken.map?.[1] === startLine;
		if (
			!followsRefDef &&
			(state.sCount[startLine] ?? 0) - state.blkIndent >= 4
		) {
			return false;
		}
		const oldParentType = state.parentType;
		state.parentType = "paragraph";
		let level = 0;
		let marker = 0;
		let nextLine = startLine + 1;
		for (; nextLine < endLine && !state.isEmpty(nextLine); nextLine += 1) {
			const s = state.sCount[nextLine] ?? 0;
			if (s - state.blkIndent > 3) {
				if (tableRule(state, nextLine, endLine, true)) break;
				continue;
			}
			if (s >= state.blkIndent) {
				let pos = (state.bMarks[nextLine] ?? 0) + (state.tShift[nextLine] ?? 0);
				const max = state.eMarks[nextLine] ?? pos;
				if (pos < max) {
					marker = state.src.charCodeAt(pos);
					if (marker === 45 || marker === 61) {
						pos = state.skipChars(pos, marker);
						pos = state.skipSpaces(pos);
						if (pos >= max) {
							level = marker === 61 ? 1 : 2;
							break;
						}
					}
				}
			}
			if (s < 0 || isIndentedLazyListLine(state, nextLine)) {
				if (tableRule(state, nextLine, endLine, true)) break;
				continue;
			}
			let terminate = false;
			for (let i = 0; i < terminatorRules.length; i += 1) {
				if (terminatorRules[i]?.(state, nextLine, endLine, true)) {
					terminate = true;
					break;
				}
			}
			if (terminate) break;
		}
		if (!level) {
			state.parentType = oldParentType;
			return false;
		}
		applyPendingPartialReferenceTitle(state, startLine, nextLine);
		const content = asciiTrimBlock(
			state.getLines(startLine, nextLine, state.blkIndent, false),
		);
		state.line = nextLine + 1;
		const tokenO = state.push("heading_open", `h${level}`, 1);
		tokenO.markup = String.fromCharCode(marker);
		tokenO.map = [startLine, state.line];
		const tokenI = state.push("inline", "", 0);
		tokenI.content = content;
		tokenI.map = [startLine, state.line - 1];
		tokenI.children = [];
		const tokenC = state.push("heading_close", `h${level}`, -1);
		tokenC.markup = String.fromCharCode(marker);
		state.parentType = oldParentType;
		return true;
	};
}

/**
 * Wraps `markdown-it`'s `paragraph` rule so:
 * - 4-space indented (`sCount - blkIndent > 3`) and lazy (`sCount < 0`)
 *   continuation lines still probe `easymde_table` for PHP-parity header splits;
 * - when `easymde_table` splits a lazy container continuation line
 *   (`sCount[nextLine] < state.blkIndent`, e.g. `> a | b\nc\n> | - |` or
 *   `- a | b\nc\n  | - |`), the table is emitted immediately before returning
 *   so `ParserBlock.tokenize`'s `sCount[line] < blkIndent` guard does not
 *   prematurely exit the enclosing blockquote or list item.
 */
export function createEasyMdeParagraphRule(
	tableRule: BlockRuleFn,
): BlockRuleFn {
	return (state, startLine, endLine) => {
		const terminatorRules = state.md.block.ruler.getRules("paragraph");
		const oldParentType = state.parentType;
		let nextLine = startLine + 1;
		let terminatedByTable = false;
		state.parentType = "paragraph";
		for (; nextLine < endLine && !state.isEmpty(nextLine); nextLine += 1) {
			const s = state.sCount[nextLine] ?? 0;
			if (
				s - state.blkIndent > 3 ||
				s < 0 ||
				isIndentedLazyListLine(state, nextLine)
			) {
				if (tableRule(state, nextLine, endLine, true)) {
					terminatedByTable = true;
					break;
				}
				continue;
			}
			let terminate = false;
			for (let i = 0; i < terminatorRules.length; i += 1) {
				const rule = terminatorRules[i];
				if (rule?.(state, nextLine, endLine, true)) {
					terminate = true;
					if (rule === tableRule) {
						terminatedByTable = true;
					}
					break;
				}
			}
			if (terminate) break;
		}
		applyPendingPartialReferenceTitle(
			state,
			startLine,
			terminatedByTable ? nextLine + 1 : nextLine,
		);
		const content = asciiTrimBlock(
			state.getLines(startLine, nextLine, state.blkIndent, false),
		);
		state.line = nextLine;
		const tokenO = state.push("paragraph_open", "p", 1);
		tokenO.map = [startLine, state.line];
		const tokenI = state.push("inline", "", 0);
		tokenI.content = content;
		tokenI.map = [startLine, state.line];
		tokenI.children = [];
		state.push("paragraph_close", "p", -1);
		state.parentType = oldParentType;
		if (
			terminatedByTable &&
			nextLine < endLine &&
			(state.sCount[nextLine] ?? 0) < state.blkIndent
		) {
			tableRule(state, nextLine, endLine, false);
		}
		return true;
	};
}

function isAsciiSpace(code: number): boolean {
	return code === 0x20 || code === 0x09;
}

/**
 * Replaces `markdown-it`'s `blockquote` rule with PHP CommonMark §5.1 parity:
 * - rejects 4+-column-indented continuation `>` markers (`sCount - blkIndent >= 4`,
 *   such as `\t>` or `    >`) so they remain lazy paragraph text instead of
 *   stripping `>` and fabricating bogus nested headings/paragraphs;
 * - accumulates `bsCount` across nested blockquotes so tab stops remain exact;
 * - skips `terminatorRules` when `sCount < 0` (already validated lazy lines
 *   from an enclosing blockquote); and
 * - isolates `env.listIndentStack` inside each blockquote frame.
 */
export function createEasyMdeBlockquoteRule(): BlockRuleFn {
	return (state, startLine, endLine, silent) => {
		let pos = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
		let max = state.eMarks[startLine] ?? pos;
		const oldLineMax = state.lineMax;
		if (
			(state.sCount[startLine] ?? 0) - state.blkIndent >= 4 ||
			isIndentedLazyListLine(state, startLine)
		) {
			return false;
		}
		if (state.src.charCodeAt(pos) !== 0x3e) {
			return false;
		}
		if (silent) {
			return true;
		}
		const oldBMarks: number[] = [];
		const oldBSCount: number[] = [];
		const oldSCount: number[] = [];
		const oldTShift: number[] = [];
		const terminatorRules = state.md.block.ruler.getRules("blockquote");
		const oldParentType = state.parentType;
		state.parentType = "blockquote";
		let lastLineEmpty = false;
		let nextLine = startLine;
		for (; nextLine < endLine; nextLine += 1) {
			const sCount = state.sCount[nextLine] ?? 0;
			const isOutdented = sCount < state.blkIndent;
			const isIndented = sCount - state.blkIndent >= 4;
			pos = (state.bMarks[nextLine] ?? 0) + (state.tShift[nextLine] ?? 0);
			max = state.eMarks[nextLine] ?? pos;
			if (pos >= max) {
				break;
			}
			if (state.src.charCodeAt(pos) === 0x3e && !isOutdented && !isIndented) {
				pos += 1;
				let initial = sCount + 1;
				let spaceAfterMarker: boolean;
				let adjustTab = false;
				const oldBS = state.bsCount[nextLine] ?? 0;
				if (state.src.charCodeAt(pos) === 0x20) {
					pos += 1;
					initial += 1;
					spaceAfterMarker = true;
				} else if (state.src.charCodeAt(pos) === 0x09) {
					spaceAfterMarker = true;
					if ((oldBS + initial) % 4 === 3) {
						pos += 1;
						initial += 1;
					} else {
						adjustTab = true;
					}
				} else {
					spaceAfterMarker = false;
				}
				let offset = initial;
				oldBMarks.push(state.bMarks[nextLine] ?? 0);
				state.bMarks[nextLine] = pos;
				while (pos < max) {
					const ch = state.src.charCodeAt(pos);
					if (isAsciiSpace(ch)) {
						if (ch === 0x09) {
							offset += 4 - ((offset + oldBS + (adjustTab ? 1 : 0)) % 4);
						} else {
							offset += 1;
						}
					} else {
						break;
					}
					pos += 1;
				}
				lastLineEmpty = pos >= max;
				oldBSCount.push(oldBS);
				state.bsCount[nextLine] =
					oldBS + sCount + 1 + (spaceAfterMarker ? 1 : 0);
				oldSCount.push(sCount);
				state.sCount[nextLine] = offset - initial;
				oldTShift.push(state.tShift[nextLine] ?? 0);
				state.tShift[nextLine] = pos - (state.bMarks[nextLine] ?? 0);
				continue;
			}
			if (lastLineEmpty) {
				break;
			}
			let terminate = false;
			if (
				sCount >= 0 &&
				!(isOutdented && getLazyListRelativeIndent(state, nextLine) >= 4)
			) {
				for (let i = 0; i < terminatorRules.length; i += 1) {
					if (terminatorRules[i]?.(state, nextLine, endLine, true)) {
						terminate = true;
						break;
					}
				}
			}
			if (terminate) {
				state.lineMax = nextLine;
				if (state.blkIndent !== 0) {
					oldBMarks.push(state.bMarks[nextLine] ?? 0);
					oldBSCount.push(state.bsCount[nextLine] ?? 0);
					oldTShift.push(state.tShift[nextLine] ?? 0);
					oldSCount.push(sCount);
					state.sCount[nextLine] = sCount - state.blkIndent;
				}
				break;
			}
			oldBMarks.push(state.bMarks[nextLine] ?? 0);
			oldBSCount.push(state.bsCount[nextLine] ?? 0);
			oldTShift.push(state.tShift[nextLine] ?? 0);
			oldSCount.push(sCount);
			state.sCount[nextLine] = -1;
		}
		const oldIndent = state.blkIndent;
		state.blkIndent = 0;
		const env = state.env as EasyMdeBlockEnv;
		const prevListIndentStack = env.listIndentStack;
		env.listIndentStack = [];
		try {
			const tokenO = state.push("blockquote_open", "blockquote", 1);
			tokenO.markup = ">";
			const lines: [number, number] = [startLine, 0];
			tokenO.map = lines;
			state.md.block.tokenize(state, startLine, nextLine);
			const tokenC = state.push("blockquote_close", "blockquote", -1);
			tokenC.markup = ">";
			lines[1] = state.line;
		} finally {
			env.listIndentStack = prevListIndentStack;
			state.lineMax = oldLineMax;
			state.parentType = oldParentType;
			for (let i = 0; i < oldTShift.length; i += 1) {
				state.bMarks[i + startLine] = oldBMarks[i] ?? 0;
				state.tShift[i + startLine] = oldTShift[i] ?? 0;
				state.sCount[i + startLine] = oldSCount[i] ?? 0;
				state.bsCount[i + startLine] = oldBSCount[i] ?? 0;
			}
			state.blkIndent = oldIndent;
		}
		return true;
	};
}

/**
 * Creates a strictly O(N)-amortized PHP `TableStartParser` precedence probe
 * for incomplete multiline CommonMark §4.7 reference definitions: reports
 * whether `sepLine` starts a GFM table whose header is `sepLine - 1` before
 * `ReferenceParser` can consume `sepLine` as a destination or title line.
 */
export function createReferenceTableInterruptProbe(): (
	state: BlockRuleState,
	refStartLine: number,
	sepLine: number,
) => boolean {
	const cache = new WeakMap<BlockRuleState, ReferenceTableProbeCacheEntry>();
	return (state, refStartLine, sepLine) => {
		if (sepLine <= refStartLine) {
			return false;
		}
		const s1 = state.sCount[sepLine] ?? 0;
		if (s1 < state.blkIndent) {
			return false;
		}
		const pos1 = (state.bMarks[sepLine] ?? 0) + (state.tShift[sepLine] ?? 0);
		const max1 = state.eMarks[sepLine] ?? pos1;
		const trimmedSep = state.src.slice(pos1, max1);
		const aligns = parseGfmTableSeparatorAlignments(trimmedSep);
		if (aligns === null || aligns.length === 0) {
			return false;
		}
		const sepColumn = (state.bsCount[sepLine] ?? 0) + s1;
		if (
			isTableSeparatorInterruptedByHigherPriorityBlock(
				trimmedSep,
				sepColumn,
				s1 - state.blkIndent,
			)
		) {
			return false;
		}
		const headerLine = sepLine - 1;
		const pos0 =
			(state.bMarks[headerLine] ?? 0) + (state.tShift[headerLine] ?? 0);
		const max0 = state.eMarks[headerLine] ?? pos0;
		const trimmedHeader = state.src.slice(pos0, max0);
		const headerCells = collectTableRowCells(
			trimmedHeader,
			0,
			trimmedHeader.length,
		);
		if (headerCells.length === 0 || headerCells.length > aligns.length) {
			return false;
		}
		let entry = cache.get(state);
		if (
			!entry ||
			entry.refStart !== refStartLine ||
			entry.level !== state.level ||
			entry.blkIndent !== state.blkIndent ||
			entry.scannedThrough > headerLine + 1
		) {
			entry = {
				blkIndent: state.blkIndent,
				hasContent: false,
				hasPipe: false,
				level: state.level,
				refParser: createParagraphReferenceParser(),
				refStart: refStartLine,
				scannedThrough: refStartLine,
			};
			cache.set(state, entry);
		}
		for (let line = entry.scannedThrough; line <= headerLine; line += 1) {
			const lp = (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
			const lm = state.eMarks[line] ?? lp;
			const lineText = state.src.slice(lp, lm);
			if (advanceParagraphReferenceParser(entry.refParser, lineText)) {
				entry.hasContent = false;
				entry.hasPipe = false;
			} else {
				entry.hasContent = true;
				if (lineText.includes("|")) {
					entry.hasPipe = true;
				}
			}
		}
		entry.scannedThrough = headerLine + 1;
		return entry.hasContent && entry.hasPipe;
	};
}
