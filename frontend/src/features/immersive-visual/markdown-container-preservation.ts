import type { Node as ProseMirrorNode } from "prosemirror-model";
import { scanPhpMarkdownMathRanges } from "../../shared/markdown/php-markdown-math-mask";
import {
	createMathNewlineSentinelForNode,
	isNestedList,
	nodePreventsFollowingIndentedCode,
	PARAGRAPH_INTERRUPTING_LIST_FIRST_LINE,
	restoreMathNewlineSentinel,
} from "./markdown-list-serialization";
import {
	alignNodes,
	childrenOf,
	pairUnmatched,
	structurallyEqual,
} from "./markdown-node-alignment";
import type {
	BuiltVisualBlockSources,
	ParsedVisualBlockSource,
	ParsedVisualSharedGroup,
} from "./markdown-parser";
import {
	firstLine,
	isCommonMarkBlankLine,
	type ListMarkerMatch,
	matchListMarker,
	measureIndentColumns,
	stripBlockquoteDepth,
	stripBlockquoteDepthWithColumn,
} from "./markdown-prescanner-containers";
import { wouldRawHtmlInterruptParagraph } from "./markdown-prescanner-inline";
import { sanitizeBulletMarker } from "./visual-schema";

/**
 * Shared depth-stripping, container alignment, join, lazy-absorption,
 * list-swallow, and tight shared-group guards used by the unified container
 * preservation engine and refdef liveness analyzer.
 */

const BLANK_BLOCKQUOTE_LINE = /^[ \t]*(?:>[ \t]*)+$/;
const ATX_HEADING_FIRST_LINE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const BLOCKQUOTE_FIRST_LINE = /^ {0,3}>/;

// ---------------------------------------------------------------------------
// Shared depth-aware, join, lazy-absorption, and list-swallow guards
// ---------------------------------------------------------------------------

/**
 * Whether CommonMark would lazily absorb `node` (serialized depth-stripped as
 * `serialized`, whose exact column-aware leading indent at its container
 * depth is `leadIndent`, see `leadingIndentAtDepth`) into a preceding open
 * paragraph across a tight join.
 */
export function wouldBeLazilyAbsorbedByPrevious(
	node: ProseMirrorNode,
	serialized: string,
	leadIndent: number,
): boolean {
	const name = node.type.name;
	if (name === "paragraph") {
		return true;
	}
	if (name === "heading") {
		return !ATX_HEADING_FIRST_LINE.test(firstLine(serialized));
	}
	if (name === "code_block") {
		return leadIndent >= 4;
	}
	if (name === "table") {
		return !serialized.startsWith("<!-- ");
	}
	if (
		name === "ordered_list" ||
		name === "bullet_list" ||
		name === "task_list"
	) {
		return !PARAGRAPH_INTERRUPTING_LIST_FIRST_LINE.test(firstLine(serialized));
	}
	if (name === "protected_block") {
		if (node.attrs.kind === "mermaid") {
			return false;
		}
		// Display math whose source line keeps its blockquote marker (it
		// closed an enclosing quoted list item, see PHP `extract_math()`'s
		// `"\n\nTOKEN\n\n"`) must stay tight: a blank line before it would
		// open an extra empty blockquote, and the token never joins a
		// preceding paragraph.
		if (
			node.attrs.kind === "math" &&
			BLOCKQUOTE_FIRST_LINE.test(firstLine(serialized))
		) {
			return false;
		}
		if (
			node.attrs.kind === "raw" &&
			typeof node.attrs.rawMarkdown === "string"
		) {
			const rawHead = firstLine(node.attrs.rawMarkdown).replace(
				/^[ \t]{0,3}/,
				"",
			);
			return !wouldRawHtmlInterruptParagraph(rawHead);
		}
		return true;
	}
	return false;
}

export function endsWithBlankBlockquoteLine(text: string): boolean {
	const lastNewline = text.lastIndexOf("\n");
	const lastLine = lastNewline === -1 ? text : text.slice(lastNewline + 1);
	return BLANK_BLOCKQUOTE_LINE.test(lastLine);
}

export function stripAtDepth(text: string, depth: number): string {
	if (depth <= 0) return text;
	return text
		.split("\n")
		.map((line) => stripBlockquoteDepth(line, depth) ?? line)
		.join("\n");
}

/** Prefixes every line of `text` with `depth` blockquote markers. */
export function prefixAtDepth(text: string, depth: number): string {
	if (depth <= 0) return text;
	const quotePrefix = "> ".repeat(depth);
	const blankLine = `${"> ".repeat(depth - 1)}>`;
	return text
		.split("\n")
		.map((line) => (line.length > 0 ? `${quotePrefix}${line}` : blankLine))
		.join("\n");
}

export function tryStripAllLinesAtDepth(
	text: string,
	depth: number,
): string | null {
	if (depth <= 0) return text;
	const lines = text.split("\n");
	const stripped: string[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const rest = stripBlockquoteDepth(lines[i] ?? "", depth);
		if (rest === null) return null;
		stripped.push(rest);
	}
	return stripped.join("\n");
}

/**
 * Single authoritative emission of `node` at blockquote `depth` shared by the
 * serializer (`serializeChildAtDepth`, `tryPreserveListAtDepth`) and refdef
 * liveness (canonical slots and preserved list tails): every line gets
 * `depth` quote markers except physical newlines inside multiline math /
 * protected inline spans, which `renderWithToken` masks with a
 * collision-free sentinel and stay unprefixed.
 */
export function emitWithMathSentinelAtDepth(
	node: ProseMirrorNode,
	depth: number,
	renderWithToken: (mathNewlineToken: string | undefined) => string,
): string {
	if (depth <= 0) return renderWithToken(undefined);
	const token = createMathNewlineSentinelForNode(node);
	const prefixed = prefixAtDepth(renderWithToken(token ?? undefined), depth);
	return token !== null
		? restoreMathNewlineSentinel(prefixed, token)
		: prefixed;
}

/**
 * Exact CommonMark indentation (in columns) of the first line of
 * `emittedText` once `depth` blockquote levels are stripped, measured from
 * the real content column so tabs after `>` expand to their true tab stop.
 */
export function leadingIndentAtDepth(
	emittedText: string,
	depth: number,
): number {
	const head = firstLine(emittedText);
	if (depth <= 0) return measureIndentColumns(head);
	const stripped = stripBlockquoteDepthWithColumn(head, depth);
	return stripped.matched === depth
		? measureIndentColumns(stripped.rest, stripped.column)
		: measureIndentColumns(head);
}

/**
 * Single node-type-agnostic swallow-risk fallback, shared by the serializer
 * and refdef liveness, for a clean untouched block or intact shared group
 * whose raw source fails verbatim reuse ONLY because a preceding list would
 * swallow it (never for 4-column indented-code risk, a broken tight join, or
 * an invalidated reference). Instead of canonical re-serialization (whose
 * inline escaping, e.g. ``a `` -> `a \`\``, can unbalance PHP code-span /
 * math scanning across blocks), the baseline raw keeps its inline bytes:
 * line 0's 1-3 column leading indent after `depth` quote markers is removed
 * and re-prefixed with exactly `depth` clean markers. A `paragraph` (or a
 * shared group led by a paragraph / protected block, or `nodeTypeName ===
 * null`) keeps every continuation line byte-for-byte, so math continuation
 * bytes never change. Every other block (headings, blockquotes, tables,
 * lists, fenced code, ...) strips up to the same columns from each
 * continuation line carrying all `depth` markers, keeping its internal
 * column structure; blank and lazy lines stay untouched. Returns `null`
 * when line 0 lacks a marker or its indent is outside 1-3.
 */
export function dedentSwallowedBlockAtDepth(
	rawEmitted: string,
	depth: number,
	nodeTypeName: string | null,
): string | null {
	const quoteDepth = Math.max(depth, 0);
	const nl = rawEmitted.indexOf("\n");
	const line0 = nl === -1 ? rawEmitted : rawEmitted.slice(0, nl);
	const head = stripBlockquoteDepthWithColumn(line0, quoteDepth);
	if (head.matched !== quoteDepth || isCommonMarkBlankLine(head.rest)) {
		return null;
	}
	const leadCols = measureIndentColumns(head.rest, head.column);
	if (leadCols < 1 || leadCols > 3) return null;
	const quotePrefix = "> ".repeat(quoteDepth);
	const out = `${quotePrefix}${head.rest.replace(/^[ \t]+/, "")}`;
	if (nl === -1) return out;
	if (
		nodeTypeName === null ||
		nodeTypeName === "paragraph" ||
		nodeTypeName === "protected_block"
	) {
		return `${out}${rawEmitted.slice(nl)}`;
	}
	// Never blindly dedent multi-line fenced code blocks, line-0 tabs,
	// multiline math spans, heterogeneous indents, or 4-column lazy/indented
	// lines (which would cross CommonMark's 4-space boundary); expand leading
	// tabs to exact columns on shifted continuation lines so tab stops never
	// jump. Fall back to canonical serialization for rejected cases.
	if (
		nodeTypeName === "code_block" ||
		head.rest.includes("\t") ||
		rawEmitted.includes("\\(") ||
		rawEmitted.includes("\\[") ||
		rawEmitted.includes("$$")
	) {
		return null;
	}
	const isListBlock =
		nodeTypeName === "bullet_list" ||
		nodeTypeName === "ordered_list" ||
		nodeTypeName === "task_list";
	let listItemIndent = isListBlock
		? (matchListMarker(head.rest, head.column)?.contentIndent ?? 0)
		: 0;
	const lines = rawEmitted.slice(nl + 1).split("\n");
	let sawBlank = false;
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		const stripped = stripBlockquoteDepthWithColumn(line, quoteDepth);
		if (stripped.matched !== quoteDepth) {
			return null;
		}
		if (isCommonMarkBlankLine(stripped.rest)) {
			sawBlank = true;
			continue;
		}
		const lineIndent = measureIndentColumns(stripped.rest, stripped.column);
		if (isListBlock) {
			if (lineIndent < leadCols) return null;
			if (lineIndent >= 4 && lineIndent < listItemIndent) return null;
			const nextMarker = matchListMarker(stripped.rest, stripped.column);
			if (nextMarker !== null) {
				listItemIndent = nextMarker.contentIndent;
			}
		} else {
			if (lineIndent >= 4) {
				// A 4+-column continuation line on a blockquote or setext
				// heading cannot carry a container marker and is a lazy
				// continuation: leaving it verbatim preserves CommonMark's
				// 4-space boundary and any inline backticks on line 0.
				if (
					!sawBlank &&
					(nodeTypeName === "blockquote" || nodeTypeName === "heading")
				) {
					continue;
				}
				return null;
			}
			if (lineIndent === 0) {
				sawBlank = false;
				continue;
			}
			if (lineIndent < leadCols) return null;
		}
		const content = stripped.rest.replace(/^[ \t]+/, "");
		// Shifting an interior tab (e.g. `*\tsecond`, `>\t  code`) changes its
		// tab stop width and can flip prose vs. indented code blocks.
		if (content.includes("\t")) return null;
		lines[i] = `${quotePrefix}${" ".repeat(lineIndent - leadCols)}${content}`;
		sawBlank = false;
	}
	return `${out}\n${lines.join("\n")}`;
}

function listMergeKey(node: ProseMirrorNode): string | null {
	if (node.type.name === "ordered_list") {
		return node.attrs.delimiter === ")" ? "ordered)" : "ordered.";
	}
	return isNestedList(node)
		? `bullet${sanitizeBulletMarker(node.attrs.marker)}`
		: null;
}

/**
 * Whether `child`, dedented to column 0 right after the list `prevNode`
 * (across a blank line), would continue that list instead of starting a new
 * one (same bullet character / ordered delimiter): the swallow-risk dedent
 * must then fall back to canonical text.
 */
export function wouldMergeWithPreviousList(
	prevNode: ProseMirrorNode | null,
	child: ProseMirrorNode,
): boolean {
	if (prevNode === null) return false;
	const key = listMergeKey(child);
	return key !== null && key === listMergeKey(prevNode);
}

const PHP_INLINE_MATH_PLACEHOLDER = "EASYMDEMATHINLINE";
const QUOTE_CONTINUATION_PREFIX = /^(?:[ \t]{0,3}>[ \t]?)*/;

type TopItemMatcher = (rest: string, column: number) => ListMarkerMatch | null;

/** Matches a top-level item marker of `listNode`'s kind (bullet / delimiter). */
function createTopItemMatcher(listNode: ProseMirrorNode): TopItemMatcher {
	const isOrdered = listNode.type.name === "ordered_list";
	const expectedDelimiter =
		isOrdered && listNode.attrs.delimiter === ")" ? ")" : ".";
	const expectedBullet = isOrdered
		? null
		: sanitizeBulletMarker(listNode.attrs.marker);
	return (rest, column) => {
		const marker = matchListMarker(rest, column);
		if (!marker || marker.leadCols > 3) return null;
		if (isOrdered) {
			if (marker.orderedDigits === null) return null;
			const digitIdx = marker.markerPrefix.indexOf(marker.orderedDigits);
			const delimChar =
				marker.markerPrefix[digitIdx + marker.orderedDigits.length];
			return delimChar === expectedDelimiter ? marker : null;
		}
		if (marker.orderedDigits !== null) return null;
		return marker.markerPrefix.trimStart()[0] === expectedBullet
			? marker
			: null;
	};
}

/**
 * Collects the parsed `protected_block(math)` raws that precede `prevEffIdx`
 * inside its baseline `sharedGroup` (empty when `prevEffIdx` is not preceded
 * by display math in a shared group).
 */
export function precedingSharedGroupMathRaws(
	baselineBlocks: ReadonlyArray<ParsedVisualBlockSource>,
	prevEffIdx: number,
): ReadonlyArray<string> {
	if (prevEffIdx < 0) return [];
	const group = baselineBlocks[prevEffIdx]?.sharedGroup;
	if (!group || prevEffIdx <= group.startIndex) return [];
	const raws: string[] = [];
	for (let k = group.startIndex; k < prevEffIdx; k += 1) {
		const member = baselineBlocks[k]?.node;
		if (
			member?.type.name === "protected_block" &&
			member.attrs.kind === "math" &&
			typeof member.attrs.rawMarkdown === "string" &&
			member.attrs.rawMarkdown.length > 0
		) {
			raws.push(member.attrs.rawMarkdown);
		}
	}
	return raws;
}

/**
 * PHP `extract_math()` turns any unshielded display math into
 * `"\n\nTOKEN\n\n"`, which closes an open list, so display math never sits
 * inside `listNode`'s body. It can only precede `listNode` inside its
 * enclosing shared group (`$$a$$- item`, `-   item1 $$b$$- item2`,
 * `$$a$$-   item1 $$b$$- item2`, `$$\na\n$$- item`). When `precedingMathRaws`
 * is provided by the caller's baseline alignment, only those parsed display
 * math spans are trusted (empty = never run an isolated math scan); otherwise
 * direct callers fall back to slicing after the last display-math range whose
 * tail opens a top-level item of `listNode`.
 */
function stripLeadingDisplayMathPrefix(
	text: string,
	depth: number,
	matchTopItem: TopItemMatcher,
	expectedItems: number,
	blankLineFollows: boolean,
	precedingMathRaws?: ReadonlyArray<string>,
): string {
	const quotePrefix = "> ".repeat(Math.max(depth, 0));
	let fallback: string | null = null;
	const accept = (tail: string): string | null => {
		if (!matchTopItem(firstLine(tail), 0)) return null;
		const candidate = `${quotePrefix}${tail}`;
		if (
			scanTrailingListItem(candidate, matchTopItem, depth, blankLineFollows)
				.items === expectedItems
		) {
			return candidate;
		}
		if (fallback === null) fallback = candidate;
		return null;
	};
	if (precedingMathRaws !== undefined) {
		if (precedingMathRaws.length === 0) return text;
		const lastMath = precedingMathRaws[precedingMathRaws.length - 1] ?? "";
		if (lastMath.length === 0) return text;
		const ranges = scanPhpMarkdownMathRanges(text);
		for (let i = ranges.length - 1; i >= 0; i -= 1) {
			const range = ranges[i];
			if (!range?.block) continue;
			if (text.slice(range.from, range.to) === lastMath) {
				const matched = accept(text.slice(range.to));
				if (matched !== null) return matched;
			}
		}
		// Fallback when cross-block backticks outside `text` make an isolated
		// math scan skip the real parsed `lastMath` inside the shared group.
		let searchFrom = text.length;
		while (searchFrom >= lastMath.length) {
			const pos = text.lastIndexOf(lastMath, searchFrom - 1);
			if (pos < 0) break;
			const matched = accept(text.slice(pos + lastMath.length));
			if (matched !== null) return matched;
			searchFrom = pos;
		}
		return fallback ?? text;
	}
	if (!text.includes("$$") && !text.includes("\\[")) return text;
	const ranges = scanPhpMarkdownMathRanges(text);
	for (let i = ranges.length - 1; i >= 0; i -= 1) {
		const range = ranges[i];
		if (!range?.block) continue;
		const matched = accept(text.slice(range.to));
		if (matched !== null) return matched;
	}
	return fallback ?? text;
}

/**
 * Raw Markdown of every multiline inline math span parsed inside `listNode`,
 * including `\(...\)` spans preserved inside `protected_block(raw)` HTML
 * blocks or reference definitions (which PHP `extract_math()` folds before
 * CommonMark parses containers).
 */
function collectMultilineInlineMath(
	listNode: ProseMirrorNode,
): ReadonlyArray<string> {
	const spans: string[] = [];
	listNode.descendants((node) => {
		if (
			node.type.name === "protected_inline" &&
			node.attrs.kind === "math-inline" &&
			typeof node.attrs.rawMarkdown === "string" &&
			node.attrs.rawMarkdown.includes("\n")
		) {
			spans.push(node.attrs.rawMarkdown);
		} else if (
			node.type.name === "protected_block" &&
			node.attrs.kind === "raw" &&
			typeof node.attrs.rawMarkdown === "string" &&
			node.attrs.rawMarkdown.includes("\n") &&
			(node.attrs.rawMarkdown.includes("\\(") ||
				node.attrs.rawMarkdown.includes("$"))
		) {
			const raw = node.attrs.rawMarkdown;
			for (const range of scanPhpMarkdownMathRanges(raw)) {
				if (range.block) continue;
				const slice = raw.slice(range.from, range.to);
				if (slice.includes("\n")) spans.push(slice);
			}
		}
		return !node.isInline;
	});
	return spans;
}

/**
 * Folds, in order, exactly the multiline inline math spans parsed inside the
 * list into a single-line placeholder, so list-marker-like continuation
 * lines inside them never open items. Continuation lines may carry quote
 * markers in verbatim raw but not in canonically emitted text, so every
 * physical newline matches any run of quote markers.
 */
function foldMultilineInlineMath(
	text: string,
	spans: ReadonlyArray<string>,
): string {
	let out = "";
	let cursor = 0;
	for (const span of spans) {
		const pattern = span
			.split("\n")
			.map((part, k) =>
				(k === 0 ? part : part.replace(QUOTE_CONTINUATION_PREFIX, "")).replace(
					/[.*+?^${}()|[\]\\]/g,
					"\\$&",
				),
			)
			.join("\\n(?:[ \\t]{0,3}>[ \\t]?)*");
		const re = new RegExp(pattern, "g");
		re.lastIndex = cursor;
		const match = re.exec(text);
		if (match === null) continue;
		out += text.slice(cursor, match.index) + PHP_INLINE_MATH_PLACEHOLDER;
		cursor = match.index + match[0].length;
	}
	return out + text.slice(cursor);
}

type TrailingItemScan = Readonly<{
	/** Content indent of the trailing open item, `-1` when none is open. */
	indent: number;
	/** Number of top-level items of `listNode`'s kind that were opened. */
	items: number;
}>;

/**
 * One column-aware CommonMark §5.2 scan of `text` (see
 * `trailingListItemContentIndent`). An empty item (blank marker line, no
 * content yet) closes at the first blank line, and so does the trailing one
 * when `blankLineFollows` (`ListItemParser::tryContinue()`:
 * `firstChild() === null` on a blank line returns `BlockContinue::none()`).
 */
function scanTrailingListItem(
	text: string,
	matchTopItem: TopItemMatcher,
	depth: number,
	blankLineFollows: boolean,
): TrailingItemScan {
	const lines = text.split("\n");
	let currentIndent = -1;
	let itemHasContent = false;
	let items = 0;
	let afterBlank = false;
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		const stripped = stripBlockquoteDepthWithColumn(line, depth);
		if (stripped.matched < depth) {
			const blank = isCommonMarkBlankLine(line);
			if (blank || afterBlank) currentIndent = -1;
			afterBlank = blank;
			continue;
		}
		if (isCommonMarkBlankLine(stripped.rest)) {
			if (!itemHasContent) currentIndent = -1;
			afterBlank = true;
			continue;
		}
		const leadCols = measureIndentColumns(stripped.rest, stripped.column);
		if (currentIndent < 0 || leadCols < currentIndent) {
			const marker =
				leadCols <= 3 ? matchTopItem(stripped.rest, stripped.column) : null;
			if (marker !== null) {
				currentIndent = marker.contentIndent;
				itemHasContent = !marker.isBlank;
				items += 1;
				afterBlank = false;
				continue;
			}
			if (afterBlank) currentIndent = -1;
		}
		itemHasContent = true;
		afterBlank = false;
	}
	if (blankLineFollows && !itemHasContent) currentIndent = -1;
	return { indent: currentIndent, items };
}

/**
 * Computes the CommonMark §5.2 content indentation (relative to the content
 * column at `depth`) of the trailing top-level item in `listEmitted`, the
 * exact emitted text of `listNode` (possibly preceded by the other members of
 * its shared group) including its `depth` blockquote markers. Every line
 * strips `depth` markers and measures its indent and list marker from the
 * real CommonMark column, so tabs before and after the marker expand to their
 * true tab stops. A line lacking the markers is a lazy continuation unless it
 * is blank or follows a blank line (the container closed); a non-item line
 * below the current content indent after a blank line closes the list. Item
 * padding comes from the single `computePhpListMarkerContentIndent`
 * primitive (via `matchListMarker().contentIndent`).
 *
 * PHP masks math across the whole document (a backtick code span opened or
 * closed OUTSIDE `listEmitted`, or the document-wide `block_ranges()`
 * trigger, can shield a span), so no isolated math scan of the list body is
 * trusted. The parsed `listNode` is the ground truth: display math only ever
 * precedes the list (`stripLeadingDisplayMathPrefix`), and only the
 * multiline inline math spans actually parsed inside `listNode` are folded.
 * When the folded scan does not reproduce `listNode`'s item count, the
 * unfolded scan decides (or, when neither does, the smaller positive indent).
 */
function trailingListItemContentIndent(
	listEmitted: string,
	listNode: ProseMirrorNode,
	depth: number,
	blankLineFollows: boolean,
	precedingMathRaws?: ReadonlyArray<string>,
): number {
	const matchTopItem = createTopItemMatcher(listNode);
	const text = stripLeadingDisplayMathPrefix(
		listEmitted,
		depth,
		matchTopItem,
		listNode.childCount,
		blankLineFollows,
		precedingMathRaws,
	);
	const raw = scanTrailingListItem(text, matchTopItem, depth, blankLineFollows);
	let indent = raw.indent;
	const spans = collectMultilineInlineMath(listNode);
	const folded = spans.length > 0 ? foldMultilineInlineMath(text, spans) : text;
	if (folded !== text) {
		const scan = scanTrailingListItem(
			folded,
			matchTopItem,
			depth,
			blankLineFollows,
		);
		if (scan.items === listNode.childCount) {
			indent = scan.indent;
		} else if (raw.items !== listNode.childCount && scan.indent > 0) {
			indent = indent > 0 ? Math.min(indent, scan.indent) : scan.indent;
		}
	}
	return indent > 0 ? indent : 0;
}

/**
 * Reports whether the block emitted as `nextEmitted` would be swallowed into
 * the trailing item of an edited or newly adjacent preceding list
 * (`prevNode`, emitted as `prevEmitted()`), even across a blank line
 * (CommonMark §5.2). Both texts are the exact emitted Markdown INCLUDING
 * their `depth` blockquote markers: depth-stripped text loses the column at
 * which its remainder starts, so the list's content indent and the next
 * block's leading indent are both measured column-aware at `depth`.
 * `blankLineBetween` is whether the join separator contains a blank line
 * (any separator other than a tight `"\n"`, at every depth): an empty
 * trailing item then closes before `nextEmitted`.
 */
export function isListSwallowingFollowingBlock(
	prevNode: ProseMirrorNode | null,
	prevEmitted: () => string,
	nextEmitted: string,
	depth: number,
	prevWasVerbatimAdjacent: boolean,
	blankLineBetween: boolean,
	prevPrecedingMathRaws?: ReadonlyArray<string>,
): boolean {
	if (!prevNode || prevWasVerbatimAdjacent || !isNestedList(prevNode)) {
		return false;
	}
	const childIndent = leadingIndentAtDepth(nextEmitted, depth);
	if (childIndent <= 0) {
		return false;
	}
	const trailingIndent = trailingListItemContentIndent(
		prevEmitted(),
		prevNode,
		depth,
		blankLineBetween,
		prevPrecedingMathRaws,
	);
	return trailingIndent > 0 && childIndent >= trailingIndent;
}

export type ContainerAlignmentPlan = Readonly<{
	matchedOrigIndex: ReadonlyArray<number>;
	pairedOrigIndex: ReadonlyArray<number>;
}>;

/**
 * Single per-container alignment (`alignNodes` + `pairUnmatched`) shared
 * between refdef liveness analysis and container serialization.
 */
export function alignContainerChildren(
	container: ProseMirrorNode,
	baselineBlocks: ReadonlyArray<ParsedVisualBlockSource>,
): ContainerAlignmentPlan {
	const matchedOrigIndex = alignNodes(
		childrenOf(container),
		baselineBlocks.map((block) => block.node),
		structurallyEqual,
	);
	const pairedOrigIndex = pairUnmatched(
		matchedOrigIndex,
		baselineBlocks.length,
	);
	return { matchedOrigIndex, pairedOrigIndex };
}

export function needsPrevInnerForRiskCheck(
	child: ProseMirrorNode,
	leadIndent: number,
	sep: string,
	prevNode: ProseMirrorNode | null,
	prevWasVerbatimAdjacent: boolean,
): boolean {
	if (leadIndent <= 0 || prevNode === null) return false;
	return (
		(leadIndent >= 4 &&
			child.type.name !== "code_block" &&
			sep === "\n" &&
			nodePreventsFollowingIndentedCode(prevNode)) ||
		(!prevWasVerbatimAdjacent && isNestedList(prevNode))
	);
}

/**
 * Single authoritative check for 4-column indented-code risk and preceding-list
 * swallow risk shared by liveness analysis and container serialization.
 * `rawEmitted` / `prevEmitted()` are the exact emitted texts (with their
 * `depth` quote markers); `prevInner` is the depth-stripped previous text.
 */
export function checkRawPreservationRisks(
	child: ProseMirrorNode,
	depth: number,
	rawEmitted: string,
	sep: string,
	prevNode: ProseMirrorNode | null,
	prevInner: string,
	prevEmitted: () => string,
	prevWasVerbatimAdjacent: boolean,
	prevPrecedingMathRaws?: ReadonlyArray<string>,
): Readonly<{ indentedRisk: boolean; swallowRisk: boolean }> {
	const leadIndent = leadingIndentAtDepth(rawEmitted, depth);
	const indentedRisk =
		(child.type.name !== "code_block" &&
			leadIndent >= 4 &&
			(sep !== "\n" ||
				!prevNode ||
				!nodePreventsFollowingIndentedCode(prevNode) ||
				endsWithBlankBlockquoteLine(prevInner))) ||
		hasDetachedContainerMathRisk(
			child,
			rawEmitted,
			depth,
			prevWasVerbatimAdjacent,
		);
	const swallowRisk =
		leadIndent > 0 &&
		isListSwallowingFollowingBlock(
			prevNode,
			prevEmitted,
			rawEmitted,
			depth,
			prevWasVerbatimAdjacent,
			sep !== "\n",
			prevPrecedingMathRaws,
		);
	return { indentedRisk, swallowRisk };
}

/**
 * Display math whose raw source line still carries the blockquote marker of
 * the container it closed (PHP `extract_math()` moves its token to column 0,
 * see `wouldBeLazilyAbsorbedByPrevious`) only re-parses right after that
 * container emitted verbatim; anywhere else the stale marker opens a stray
 * empty blockquote, so the raw is unusable (reported as `indentedRisk`).
 */
export function hasDetachedContainerMathRisk(
	child: ProseMirrorNode,
	rawEmitted: string,
	depth: number,
	prevWasVerbatimAdjacent: boolean,
): boolean {
	if (
		prevWasVerbatimAdjacent ||
		child.type.name !== "protected_block" ||
		child.attrs.kind !== "math"
	) {
		return false;
	}
	const head = stripBlockquoteDepthWithColumn(firstLine(rawEmitted), depth);
	return head.matched === Math.max(depth, 0) && /^[ \t]*>/.test(head.rest);
}

type TightSharedGroupChecker = Readonly<{
	isIntactSharedGroupAt: (
		childIdx: number,
		group: ParsedVisualSharedGroup,
	) => boolean;
	isTightRightNeighborIntact: (
		startIdx: number,
		startGroup: ParsedVisualSharedGroup,
	) => boolean;
}>;

export function sharedGroupHasInvalidatedRef(
	baselineBlocks: ReadonlyArray<ParsedVisualBlockSource>,
	group: ParsedVisualSharedGroup,
	nodeHasInvalidatedRef: (node: ProseMirrorNode) => boolean,
): boolean {
	for (let k = group.startIndex; k < group.endIndex; k += 1) {
		const member = baselineBlocks[k];
		if (member && nodeHasInvalidatedRef(member.node)) {
			return true;
		}
	}
	return false;
}

export function canPreserveContainerHeadStructurally(
	nextChild: ProseMirrorNode,
	nextOrig: ParsedVisualBlockSource,
	blockquoteSources:
		| ReadonlyMap<ProseMirrorNode, BuiltVisualBlockSources>
		| undefined,
): boolean {
	return (
		nextChild.childCount > 0 &&
		nextOrig.node.childCount > 0 &&
		structurallyEqual(nextChild.child(0), nextOrig.node.child(0)) &&
		((nextChild.type.name === "blockquote" &&
			nextOrig.node.type.name === "blockquote" &&
			Boolean(blockquoteSources?.has(nextOrig.node))) ||
			(isNestedList(nextChild) &&
				listAttrsCompatible(nextChild, nextOrig.node) &&
				nextOrig.raw !== null))
	);
}

/**
 * Single memoized O(N) checker for tight shared-group chains shared by both
 * `computeIntactRefDefLabels` and `serializeContainerPreservingChildren`.
 */
export function createTightSharedGroupChecker(
	container: ProseMirrorNode,
	baselineBlocks: ReadonlyArray<ParsedVisualBlockSource>,
	matchedOrigIndex: ReadonlyArray<number>,
	pairedOrigIndex: ReadonlyArray<number>,
	blockquoteSources:
		| ReadonlyMap<ProseMirrorNode, BuiltVisualBlockSources>
		| undefined,
	nodeHasInvalidatedRef: ((node: ProseMirrorNode) => boolean) | null,
): TightSharedGroupChecker {
	const newLen = container.childCount;
	const isIntactSharedGroupAt = (
		childIdx: number,
		group: ParsedVisualSharedGroup,
	): boolean => {
		const len = group.endIndex - group.startIndex;
		if (childIdx + len > newLen) return false;
		for (let offset = 0; offset < len; offset += 1) {
			if (matchedOrigIndex[childIdx + offset] !== group.startIndex + offset) {
				return false;
			}
		}
		return true;
	};

	const memo = new Map<number, boolean>();
	const isTightRightNeighborIntact = (
		startIdx: number,
		startGroup: ParsedVisualSharedGroup,
	): boolean => {
		const cachedStart = memo.get(startGroup.startIndex);
		if (cachedStart !== undefined) return cachedStart;
		const chain: number[] = [];
		let curIdx = startIdx;
		let curGroup = startGroup;
		let intact = true;
		while (true) {
			const cached = memo.get(curGroup.startIndex);
			if (cached !== undefined) {
				intact = cached;
				break;
			}
			chain.push(curGroup.startIndex);
			const nextOrig = baselineBlocks[curGroup.endIndex];
			if (!nextOrig) break;
			const nextGroup =
				nextOrig.sharedGroup?.startIndex === curGroup.endIndex
					? nextOrig.sharedGroup
					: undefined;
			const nextSep = nextGroup
				? nextGroup.separatorBefore
				: nextOrig.separatorBefore;
			if (nextSep !== "\n") break;
			const afterIdx = curIdx + (curGroup.endIndex - curGroup.startIndex);
			if (afterIdx >= newLen) {
				intact = false;
				break;
			}
			const nextChild = container.child(afterIdx);
			const nextMatchedDirect =
				matchedOrigIndex[afterIdx] === curGroup.endIndex &&
				(!nodeHasInvalidatedRef ||
					nextGroup !== undefined ||
					!nodeHasInvalidatedRef(nextOrig.node));
			if (!nextMatchedDirect) {
				const canPreserveContainerHead =
					!nextGroup &&
					(matchedOrigIndex[afterIdx] === curGroup.endIndex ||
						pairedOrigIndex[afterIdx] === curGroup.endIndex) &&
					canPreserveContainerHeadStructurally(
						nextChild,
						nextOrig,
						blockquoteSources,
					) &&
					!nodeHasInvalidatedRef?.(nextOrig.node.child(0));
				if (!canPreserveContainerHead) {
					intact = false;
				}
				break;
			}
			if (!nextGroup) break;
			if (
				!isIntactSharedGroupAt(afterIdx, nextGroup) ||
				(nodeHasInvalidatedRef !== null &&
					sharedGroupHasInvalidatedRef(
						baselineBlocks,
						nextGroup,
						nodeHasInvalidatedRef,
					))
			) {
				intact = false;
				break;
			}
			curIdx = afterIdx;
			curGroup = nextGroup;
		}
		for (let k = 0; k < chain.length; k += 1) {
			const key = chain[k];
			if (key !== undefined) memo.set(key, intact);
		}
		return intact;
	};

	return { isIntactSharedGroupAt, isTightRightNeighborIntact };
}

export function listAttrsCompatible(
	next: ProseMirrorNode,
	orig: ProseMirrorNode,
): boolean {
	if (next.type !== orig.type) return false;
	for (const key of Object.keys(orig.attrs)) {
		if (key !== "tight" && next.attrs[key] !== orig.attrs[key]) return false;
	}
	return true;
}
