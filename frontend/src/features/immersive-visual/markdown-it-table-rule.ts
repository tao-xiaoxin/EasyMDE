import type MarkdownIt from "markdown-it";
import {
	collectTableRowCells,
	type GfmTableColumnAlignment,
	parseGfmTableSeparatorAlignments,
	unescapeTableCellPipes,
} from "../../shared/markdown/php-commonmark-block-helpers";
import { readRawMetaString } from "./markdown-parser-inline";
import { isCommonMarkBlankLine } from "./markdown-prescanner-containers";
import { opensNonParagraphBlock } from "./markdown-prescanner-tables";

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

export type EasyMdeTableRuleDeps = Readonly<{
	originalReferenceRule: BlockRuleFn | null;
	rawReferenceSourceMetaKey: string;
	wouldReferenceDefinitionAbsorbFollowingBlock: (
		lastRaw: string,
		followingMarkdown: string,
	) => boolean;
}>;

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
		originalReferenceRule,
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
		const s0 = state.sCount[startLine] ?? 0;
		if (s0 < state.blkIndent || s0 - state.blkIndent >= 4) {
			return false;
		}
		const sepLine = startLine + 1;
		const s1 = state.sCount[sepLine] ?? 0;
		if (s1 < state.blkIndent || s1 - state.blkIndent >= 4) {
			return false;
		}
		const pos1 = (state.bMarks[sepLine] ?? 0) + (state.tShift[sepLine] ?? 0);
		const max1 = state.eMarks[sepLine] ?? pos1;
		const aligns = parseGfmTableSeparatorAlignments(
			state.src.slice(pos1, max1),
		);
		if (aligns === null || aligns.length === 0) {
			return false;
		}
		const pos0 = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
		const max0 = state.eMarks[startLine] ?? pos0;
		const trimmedStart = state.src.slice(pos0, max0);
		const prevClose = state.tokens[state.tokens.length - 1];
		const prevOpen = state.tokens[state.tokens.length - 3];
		const followsParagraph =
			(silent && state.parentType === "paragraph") ||
			(prevClose?.type === "paragraph_close" &&
				prevOpen?.type === "paragraph_open" &&
				prevOpen.level === state.level &&
				prevOpen.map?.[1] === startLine);
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
		const startColumn = (state.bsCount[startLine] ?? 0) + s0;
		// Reject non-paragraph CommonMark block openers and §4.7 link
		// reference definitions / titles via the canonical shared guard.
		if (opensNonParagraphBlock(trimmedStart, startColumn, followsParagraph)) {
			return false;
		}
		if (
			!followsParagraph &&
			originalReferenceRule !== null &&
			originalReferenceRule(state, startLine, endLine, true)
		) {
			return false;
		}
		if (
			prevClose?.type === "reference_definition" &&
			prevClose.level === state.level &&
			prevClose.map?.[1] === startLine
		) {
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
