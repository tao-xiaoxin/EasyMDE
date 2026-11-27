import type { Tree } from "@lezer/common";
import type { BlockContext } from "@lezer/markdown";

import {
	mergeRanges,
	type SourceRange,
} from "../../shared/markdown/markdown-source-projection";
import { MAX_LEZER_INLINE_DEPTH } from "./editor-markdown-inline-markers";
import { createLinearLeagueMarkdownParser } from "./editor-markdown-league-parser-factory";

// Linear-time replacements for @lezer/markdown's InlineCode, HTMLTag,
// HardBreak, Autolink, Link, Image, LinkEnd, LinkReference, unified
// block-nesting guard, and InlineContext.resolveMarkers on our private parser
// instance only (never mutating @lezer/markdown prototypes).
// `BlockContext.depth` counts `Document` at stack slot 0, so a container stack
// at League depth `99` (`99` blockquotes, `49` lists + `1` blockquote, or `97`
// blockquotes + `1` list) has Lezer `cx.depth === 100`. Inside such a
// container, League CommonMark 2.8.2 (`max_nesting_level = 100`,
// `MarkdownParser.php`) pushes a child `Paragraph` at League depth `100`
// (`getDepth() >= 100`) and refuses all interrupting block starts
// (`FencedCode`, `HTMLBlock`, `SetextHeading`, `Table`, `ATXHeading`,
// `HorizontalRule`, `Blockquote`, `List`). Setting
// `MAX_LEZER_BLOCK_DEPTH = MAX_LEZER_INLINE_DEPTH - 1` (99) triggers
// `cx.depth > MAX_LEZER_BLOCK_DEPTH` at `cx.depth >= 100` (League container
// depth >= 99) while preserving exact parity at <= 98 blockquotes and <= 49
// nested lists (`cx.depth <= 99`), where child `Paragraph`s remain at League
// depth <= 99 < 100.
const MAX_LEZER_BLOCK_DEPTH = MAX_LEZER_INLINE_DEPTH - 1;
const EMPTY_RANGES: ReadonlyArray<SourceRange> = [];
const UNVERIFIABLE_RANGES_BY_TREE = new WeakMap<Tree, ReadonlyArray<SourceRange>>();

let activeText = "";
let activeUnverifiableRanges: SourceRange[] | null = null;
let activeOverNestedGlobalHazard = false;

function recordUnverifiableRange(from: number, to: number): void {
	if (activeUnverifiableRanges && from < to) {
		activeUnverifiableRanges.push({ from, to });
	}
}

function hasBackwardGlobalHazard(text: string, from: number): boolean {
	return (
		text.indexOf("]:", from) >= 0 ||
		text.indexOf("$$", from) >= 0 ||
		text.indexOf("\\[", from) >= 0 ||
		text.indexOf("\\]", from) >= 0 ||
		text.indexOf("\\(", from) >= 0 ||
		text.indexOf("\\)", from) >= 0
	);
}

function consumeOverNestedToEof(cx: BlockContext): boolean {
	const from = cx.lineStart;
	while (cx.nextLine()) {
		// Consume through EOF so no post-overflow blocks can be misparsed.
	}
	if (hasBackwardGlobalHazard(activeText, from)) {
		activeOverNestedGlobalHazard = true;
	} else {
		recordUnverifiableRange(from, activeText.length);
	}
	return true;
}

const boldMarkdownParser = createLinearLeagueMarkdownParser({
	blockNesting: {
		maxDepth: MAX_LEZER_BLOCK_DEPTH,
		mode: "fail-closed",
		onOverNested: consumeOverNestedToEof,
	},
	htmlTagDialect: "lezer",
	onExceededInlineDepth: recordUnverifiableRange,
	onLinkReferenceUnverifiableRange: recordUnverifiableRange,
	rejectUnescapedOpenParenInTitle: true,
});

/**
 * Parses Markdown with GFM extensions using strictly O(N) linear,
 * depth-bounded inline code, HTML tag, hard-break, inline delimiter,
 * link/image, autolink, block-nesting, and League-exact CommonMark §4.7
 * `LinkReference` parsers.
 */
export function parseBoldMarkdown(text: string): Tree {
	const previousText = activeText;
	const previousRanges = activeUnverifiableRanges;
	const previousGlobalHazard = activeOverNestedGlobalHazard;
	const ranges: SourceRange[] = [];
	activeText = text;
	activeUnverifiableRanges = ranges;
	activeOverNestedGlobalHazard = false;
	try {
		const tree = boldMarkdownParser.parse(text);
		if (activeOverNestedGlobalHazard && text.length > 0) {
			UNVERIFIABLE_RANGES_BY_TREE.set(tree, [{ from: 0, to: text.length }]);
		} else if (ranges.length > 0) {
			UNVERIFIABLE_RANGES_BY_TREE.set(tree, mergeRanges(ranges));
		}
		return tree;
	} finally {
		activeText = previousText;
		activeUnverifiableRanges = previousRanges;
		activeOverNestedGlobalHazard = previousGlobalHazard;
	}
}

/**
 * Returns sorted merged document ranges that could not be verified safely
 * during `parseBoldMarkdown(text)` (inline depth `> 100`, block container
 * depth `>= 99` / Lezer `cx.depth >= 100`, or League failed next-line
 * reference title continuations).
 */
export function getBoldMarkdownUnverifiableRanges(
	tree: Tree,
): ReadonlyArray<SourceRange> {
	return UNVERIFIABLE_RANGES_BY_TREE.get(tree) ?? EMPTY_RANGES;
}
