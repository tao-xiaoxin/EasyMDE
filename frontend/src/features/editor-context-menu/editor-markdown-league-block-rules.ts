import type { SyntaxNode } from "@lezer/common";
import type {
	BlockContext,
	Element,
	LeafBlock,
	LeafBlockParser,
	Line,
	MarkdownParser,
} from "@lezer/markdown";

import { lineStartBefore } from "../../shared/markdown/markdown-source-projection";
import {
	isAtMostOneCodePointLeft,
	isLezerSpaceCode,
} from "../../shared/markdown/markdown-char-codes";
import {
	LEAGUE_HTML_BLOCK_CLOSE_BY_TYPE,
	matchLeagueHtmlBlockType,
} from "../../shared/markdown/markdown-html-scanners";

/**
 * Worker-safe League CommonMark 2.8.2 block-parser rules shared by EVERY
 * private `@lezer/markdown` parser instance (context-menu Bold verification
 * and the block-index worker), so both agree with PHP on list padding, list
 * paragraph interruption, and HTML block Types 1–7. Never mutates the shared
 * `markdownLanguage.parser`; never imports inline/bold planning modules.
 */

type InternalCompositeBlock = {
	children: ReadonlyArray<{ length: number; type?: { id: number } }>;
	from: number;
	positions: ReadonlyArray<number>;
	type: number;
	value: number;
};

type InternalBlockContext = BlockContext & {
	block: InternalCompositeBlock;
	input: { read: (from: number, to: number) => string };
};

type InternalLine = Line & {
	depth: number;
};

type SkipContextHandler = (
	bl: InternalCompositeBlock,
	cx: InternalBlockContext,
	line: Line,
) => boolean;

type BlockParserFn = (cx: BlockContext, line: Line) => boolean | null;

type EndLeafFn = (cx: BlockContext, line: Line, leaf: LeafBlock) => boolean;

type LeafBlockParserFactory = (
	cx: BlockContext,
	leaf: LeafBlock,
) => LeafBlockParser | null;

type InternalMarkdownParser = MarkdownParser & {
	blockNames: ReadonlyArray<string>;
	blockParsers: Array<BlockParserFn | undefined>;
	endLeafBlock: EndLeafFn[];
	leafBlockParsers: Array<LeafBlockParserFactory | undefined>;
	skipContextMarkup: Record<number, SkipContextHandler>;
};

/** `@lezer/markdown` `DefaultEndLeaf` slots replaced/wrapped by League rules. */
const END_LEAF_BULLET_LIST = 3;
const END_LEAF_ORDERED_LIST = 4;
const END_LEAF_HORIZONTAL_RULE = 5;
const END_LEAF_HTML_BLOCK = 6;

function isDashSetextUnderline(line: Line): boolean {
	if (45 /* - */ !== line.next) return false;
	const text = line.text;
	const len = text.length;
	let pos = line.pos + 1;
	while (pos < len && 45 /* - */ === text.charCodeAt(pos)) pos += 1;
	while (pos < len) {
		if (!isLezerSpaceCode(text.charCodeAt(pos))) return false;
		pos += 1;
	}
	return true;
}

const EMPTY_MARKER_LINE_RE = /^[ \t]*\r?\n$/;

/** Number of composite contexts the current line continued (Lezer internal). */
export function getLineDepth(line: Line): number {
	return (line as InternalLine).depth;
}

/**
 * League CommonMark 2.8.2 depth of the last matched block before trying to
 * interrupt an active leaf (`Paragraph` / `LinkReference`):
 * - `lineDepth === cx.depth`: the active leaf itself matched (`Document` is
 *   Lezer depth 1 = League depth 0, so the leaf's League depth is `cx.depth`).
 * - `lineDepth < cx.depth`: the line exited an inner container to an ancestor
 *   composite container at Lezer depth `lineDepth` (League depth `lineDepth - 1`).
 */
function matchedLeagueDepthForLeafLine(
	cx: BlockContext,
	line: Line,
): number {
	const lineDepth = getLineDepth(line);
	return lineDepth === cx.depth ? cx.depth : lineDepth - 1;
}

/**
 * League 2.8.2 `ListBlockStartParser::calculateListMarkerPadding()` absolute
 * content column for a list marker ending at `markTo` (column
 * `colAfterMark`) on a line ending at `lineEnd`.
 */
export function computeLeagueListContentColumn(
	text: string,
	markTo: number,
	lineEnd: number,
	colAfterMark: number,
): number {
	let col = colAfterMark;
	let skipped = markTo;
	while (skipped < lineEnd) {
		const ch = text.charCodeAt(skipped);
		if (32 === ch) {
			col += 1;
		} else if (9 === ch) {
			col += 4 - (col % 4);
		} else {
			break;
		}
		skipped += 1;
	}
	const spacesAfterMarker = col - colAfterMark;
	return spacesAfterMarker >= 5 ||
		spacesAfterMarker < 1 ||
		isAtMostOneCodePointLeft(text, skipped, lineEnd)
		? colAfterMark + 1
		: col;
}

/** Opener-line geometry of a parsed `ListItem` (absolute tab-expanded columns). */
type LeagueListItemGeometry = Readonly<{
	/** Column immediately after the list marker. */
	colAfterMark: number;
	/** Absolute League content column. */
	contentCol: number;
	/** Opener line end (excluding any `\r`). */
	lineEnd: number;
	lineStart: number;
	/** Offset immediately after the list marker. */
	markTo: number;
}>;

/** Computes League 2.8.2 opener-line geometry for a parsed `ListItem`. */
export function computeLeagueListItemGeometry(
	text: string,
	item: SyntaxNode,
): LeagueListItemGeometry | null {
	const listMark = item.firstChild;
	if ("ListMark" !== listMark?.name) return null;
	const lineStart = lineStartBefore(text, item.from);
	const newline = text.indexOf("\n", listMark.to);
	let lineEnd = newline < 0 ? text.length : newline;
	if (lineEnd > listMark.to && 13 === text.charCodeAt(lineEnd - 1)) lineEnd -= 1;
	let col = 0;
	for (let p = lineStart; p < listMark.to; p += 1) {
		col = 9 === text.charCodeAt(p) ? col + (4 - (col % 4)) : col + 1;
	}
	return {
		colAfterMark: col,
		contentCol: computeLeagueListContentColumn(text, listMark.to, lineEnd, col),
		lineEnd,
		lineStart,
		markTo: listMark.to,
	};
}

/**
 * Aligns `@lezer/markdown` `ListItem` parsing with CommonMark §5.2 and League
 * CommonMark 2.8.2:
 *
 * 1. Terminates an empty `ListItem` immediately on a following blank line
 *    (`ListItemParser::tryContinue()`).
 * 2. Applies League 2.8.2 `ListBlockStartParser::calculateListMarkerPadding()`
 *    single-codepoint-remainder padding (`$cursor->peek() === null` collapses
 *    `2..4` spaces/tabs before a 1-character remainder to `markerLength + 1`).
 */
function applyLeagueListItemRules(internal: InternalMarkdownParser): void {
	const listItemId = internal.nodeSet.types.find(
		(type) => "ListItem" === type.name,
	)?.id;
	if (undefined === listItemId) return;

	const clonedSkip: Record<number, SkipContextHandler> = {
		...internal.skipContextMarkup,
	};
	const origSkipListItem = clonedSkip[listItemId];
	if (origSkipListItem) {
		clonedSkip[listItemId] = (bl, cx, line) => {
			if (line.next < 0 && 1 === bl.children.length) {
				const firstChild = bl.children[0];
				const firstPos = bl.positions[0];
				if (firstChild && undefined !== firstPos) {
					const markEnd = bl.from + firstPos + firstChild.length;
					if (
						markEnd <= cx.lineStart &&
						EMPTY_MARKER_LINE_RE.test(cx.input.read(markEnd, cx.lineStart))
					) {
						return false;
					}
				}
			}
			return origSkipListItem(bl, cx, line);
		};
	}
	internal.skipContextMarkup = clonedSkip;

	const clonedBlockParsers = internal.blockParsers.slice();
	for (const listName of ["BulletList", "OrderedList"] as const) {
		const idx = internal.blockNames.indexOf(listName);
		const origParse = idx >= 0 ? clonedBlockParsers[idx] : undefined;
		if (!origParse) continue;
		clonedBlockParsers[idx] = (cx, line) => {
			const prevBaseIndent = line.baseIndent;
			const prevPos = line.pos;
			const prevIndent = line.indent;
			const result = origParse(cx, line);
			if (false === result) return false;
			const item = (cx as InternalBlockContext).block;
			const firstChild = item.children[0];
			const firstPos = item.positions[0];
			if (item.type === listItemId && firstChild && undefined !== firstPos) {
				const markEnd =
					item.from + firstPos + firstChild.length - cx.lineStart;
				const indentAfter = line.countIndent(markEnd, prevPos, prevIndent);
				const skipped = line.skipSpace(markEnd);
				const indented = line.countIndent(skipped, markEnd, indentAfter);
				if (
					skipped < line.text.length &&
					indented < indentAfter + 5 &&
					isAtMostOneCodePointLeft(line.text, skipped, line.text.length)
				) {
					const leagueBase = indentAfter + 1;
					const leagueValue = leagueBase - prevBaseIndent;
					if (item.value !== leagueValue) {
						item.value = leagueValue;
						line.moveBaseColumn(leagueBase);
					}
				}
			}
			return result;
		};
	}
	internal.blockParsers = clonedBlockParsers;
}

/**
 * CommonMark §2.2 / League 2.8.2 `BlockQuoteStartParser` +
 * `BlockQuoteParser::tryContinue()`: the optional space after `>` consumes
 * ONLY one column of a following tab (`advanceBySpaceOrTab()`), leaving the
 * remaining virtual columns as indentation for nested lists, indented code,
 * and Setext underlines. Upstream `@lezer/markdown` consumes no column of the
 * tab on start and the whole tab on continuation.
 */
function applyLeagueBlockquoteRules(internal: InternalMarkdownParser): void {
	const blockquoteId = internal.nodeSet.types.find(
		(type) => "Blockquote" === type.name,
	)?.id;
	const idx = internal.blockNames.indexOf("Blockquote");
	const origParse = idx >= 0 ? internal.blockParsers[idx] : undefined;
	const origSkip =
		undefined === blockquoteId ? undefined : internal.skipContextMarkup[blockquoteId];
	if (undefined === blockquoteId || !origParse || !origSkip) {
		throw new Error("easymde-lezer-markdown-blockquote-layout-changed");
	}
	// `line.indent` is the `>` column here; the tab keeps all but one column.
	const isQuoteTab = (line: Line): boolean =>
		62 === line.next && 9 === line.text.charCodeAt(line.pos + 1);
	const clonedBlockParsers = internal.blockParsers.slice();
	clonedBlockParsers[idx] = (cx, line) => {
		if (line.indent >= line.baseIndent + 4) return false;
		const quoteTab = isQuoteTab(line);
		const gtCol = line.indent;
		const result = origParse(cx, line);
		if (false !== result && quoteTab) line.moveBaseColumn(gtCol + 2);
		return result;
	};
	internal.blockParsers = clonedBlockParsers;
	internal.skipContextMarkup = {
		...internal.skipContextMarkup,
		[blockquoteId]: (bl, cx, line) => {
			if (line.indent >= line.baseIndent + 4) return false;
			const quoteTab = isQuoteTab(line);
			const gtCol = line.indent;
			const result = origSkip(bl, cx, line);
			if (result && quoteTab) line.moveBaseColumn(gtCol + 2);
			return result;
		},
	};
}

/**
 * Breaking (paragraph-interrupting) bullet-list start. Unlike upstream
 * `inList(cx, BulletList)`, an empty `+`/`-`/`*` may only interrupt when the
 * line fails to continue an enclosing container (`getLineDepth < cx.depth`),
 * matching League: `+ a\n  +` keeps the paragraph.
 */
function isBreakingLeagueBulletListStart(cx: BlockContext, line: Line): boolean {
	const next = line.next;
	if (45 !== next && 43 !== next && 42 !== next) return false;
	const len = line.text.length;
	if (line.pos !== len - 1 && !isLezerSpaceCode(line.text.charCodeAt(line.pos + 1))) {
		return false;
	}
	return getLineDepth(line) < cx.depth || line.skipSpace(line.pos + 2) < len;
}

/**
 * Breaking ordered-list start. Inside the SAME container stack, only a
 * non-empty `1.`/`1)` may interrupt a paragraph (CommonMark §5.3), so
 * `1. ab\n   2. c` stays one paragraph exactly as League renders it.
 */
function isBreakingLeagueOrderedListStart(cx: BlockContext, line: Line): boolean {
	const text = line.text;
	const len = text.length;
	let pos = line.pos;
	let next = line.next;
	while (next >= 48 && next <= 57) {
		pos += 1;
		if (pos === len) return false;
		next = text.charCodeAt(pos);
	}
	if (pos === line.pos || pos > line.pos + 9 || (46 !== next && 41 !== next)) {
		return false;
	}
	if (pos < len - 1 && !isLezerSpaceCode(text.charCodeAt(pos + 1))) return false;
	if (getLineDepth(line) < cx.depth) return true;
	return line.skipSpace(pos + 1) !== len && pos === line.pos + 1 && 49 === line.next;
}

function parseLeagueHtmlBlock(cx: BlockContext, line: Line): boolean {
	const type = matchLeagueHtmlBlockType(line.text, line.pos, false);
	if (0 === type) return false;
	const from = cx.lineStart + line.pos;
	const blockDepth = cx.depth;
	const marks: Element[] = [];
	const closeRe = LEAGUE_HTML_BLOCK_CLOSE_BY_TYPE[type];
	if (closeRe) {
		let trailing = true;
		while (!closeRe.test(line.text.slice(line.basePos)) && cx.nextLine()) {
			if (getLineDepth(line) < blockDepth) {
				trailing = false;
				break;
			}
			for (const mark of line.markers) marks.push(mark);
		}
		if (trailing) cx.nextLine();
	} else {
		while (cx.nextLine()) {
			if (getLineDepth(line) < blockDepth || line.pos === line.text.length) break;
			for (const mark of line.markers) marks.push(mark);
		}
	}
	const nodeName =
		2 === type
			? "CommentBlock"
			: 3 === type
				? "ProcessingInstructionBlock"
				: "HTMLBlock";
	cx.addElement(cx.elt(nodeName, from, cx.prevLineEnd(), marks));
	return true;
}

/**
 * Returns a private reconfigured copy of `parser` (never mutating `parser`
 * or the shared `markdownLanguage.parser`) carrying ALL League CommonMark
 * 2.8.2 block rules:
 *
 * - League HTML block Types 1–7 (`HTMLBlock` parser + `endLeaf` predicate);
 * - `Blockquote` `>` + tab single-column optional-space consumption;
 * - `ListItem` empty-item blank-line termination and single-codepoint
 *   remainder padding;
 * - same-container nested list paragraph interruption (`getLineDepth`
 *   instead of upstream `inList(...)`);
 * - optional League `max_nesting_level` container depth cap (`maxContainerDepth`),
 *   stopping further block starts and leaf interruptions once the active
 *   container depth exceeds `maxContainerDepth` (`Document` is depth 1, so
 *   `maxContainerDepth = 100` matches PHP `max_nesting_level = 100`).
 */
export function applyLeagueBlockRules(
	parser: MarkdownParser,
	options?: Readonly<{ maxContainerDepth?: number }>,
): MarkdownParser {
	const configured = parser.configure({
		parseBlock: [{ name: "HTMLBlock", parse: parseLeagueHtmlBlock }],
	});
	const internal = configured as InternalMarkdownParser;
	applyLeagueListItemRules(internal);
	applyLeagueBlockquoteRules(internal);
	const endLeaf = internal.endLeafBlock.slice();
	if (endLeaf.length <= END_LEAF_HTML_BLOCK) {
		throw new Error("easymde-lezer-markdown-end-leaf-layout-changed");
	}
	endLeaf[END_LEAF_BULLET_LIST] = isBreakingLeagueBulletListStart;
	endLeaf[END_LEAF_ORDERED_LIST] = isBreakingLeagueOrderedListStart;
	endLeaf[END_LEAF_HTML_BLOCK] = (_cx, line) =>
		matchLeagueHtmlBlockType(line.text, line.pos, true) > 0;
	const maxContainerDepth = options?.maxContainerDepth;
	if (undefined !== maxContainerDepth) {
		const listItemId = internal.nodeSet.types.find(
			(type) => "ListItem" === type.name,
		)?.id;
		const quoteMarkId = internal.nodeSet.types.find(
			(type) => "QuoteMark" === type.name,
		)?.id;
		const listLeafState = new WeakMap<
			InternalCompositeBlock,
			{ checkedLen: number; hasLeaf: boolean }
		>();
		const clonedSkip: Record<number, SkipContextHandler> = {
			...internal.skipContextMarkup,
		};
		for (const listName of ["BulletList", "OrderedList"] as const) {
			const listId = internal.nodeSet.types.find(
				(type) => listName === type.name,
			)?.id;
			const origSkipList =
				undefined === listId ? undefined : clonedSkip[listId];
			if (undefined === listId || !origSkipList) continue;
			clonedSkip[listId] = (bl, cx, line) => {
				if (getLineDepth(line) >= maxContainerDepth) {
					// League `ListBlockParser::tryContinue()` always continues at
					// `depth >= max_nesting_level`, skipping `findBlockStart()` so the
					// next non-blank line becomes a `Paragraph` via `addChild()` (which
					// closes `ListBlock` because it only accepts `ListItem`). Ignore
					// `ListItem` and blank-line `QuoteMark` markers; once `bl` holds a
					// direct leaf child (e.g. `Paragraph` or `LinkReference`), close it
					// so blocks after a blank line parse at the parent container's depth.
					let state = listLeafState.get(bl);
					if (!state) {
						state = { checkedLen: 0, hasLeaf: false };
						listLeafState.set(bl, state);
					}
					if (state.hasLeaf) return false;
					const children = bl.children;
					for (let i = state.checkedLen; i < children.length; i += 1) {
						const childId = children[i]?.type?.id;
						if (childId !== listItemId && childId !== quoteMarkId) {
							state.hasLeaf = true;
							state.checkedLen = children.length;
							return false;
						}
					}
					state.checkedLen = children.length;
					return true;
				}
				return origSkipList(bl, cx, line);
			};
		}
		internal.skipContextMarkup = clonedSkip;
		internal.blockParsers = internal.blockParsers.map((parse) =>
			parse
				? (cx, line) => (cx.depth > maxContainerDepth ? false : parse(cx, line))
				: parse,
		);
		const clonedLeafParsers = internal.leafBlockParsers.slice();
		for (const leafName of ["SetextHeading", "Table"] as const) {
			const idx = internal.blockNames.indexOf(leafName);
			const origLeaf = idx >= 0 ? clonedLeafParsers[idx] : undefined;
			if (!origLeaf) continue;
			clonedLeafParsers[idx] = (cx, leaf) =>
				cx.depth >= maxContainerDepth ? null : origLeaf(cx, leaf);
		}
		internal.leafBlockParsers = clonedLeafParsers;
		// Upstream `isHorizontalRule(..., breaking=true)` checks identity of
		// `DefaultLeafBlocks.SetextHeading` inside `leafBlockParsers`; restore
		// Setext `-+` precedence below `maxContainerDepth` on the HR endLeaf slot.
		const origHrEndLeaf = endLeaf[END_LEAF_HORIZONTAL_RULE];
		if (origHrEndLeaf) {
			endLeaf[END_LEAF_HORIZONTAL_RULE] = (cx, line, leaf) =>
				45 /* - */ === line.next &&
				getLineDepth(line) === cx.depth &&
				cx.depth < maxContainerDepth &&
				isDashSetextUnderline(line)
					? false
					: origHrEndLeaf(cx, line, leaf);
		}
		internal.endLeafBlock = endLeaf.map((stop) => (cx, line, leaf) =>
			matchedLeagueDepthForLeafLine(cx, line) >= maxContainerDepth
				? false
				: stop(cx, line, leaf),
		);
	} else {
		internal.endLeafBlock = endLeaf;
	}
	return configured;
}
