import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	type BlockSerializer,
	isLooseList,
	isNestedList,
	LEADING_FOUR_COLUMN_INDENT,
	PARAGRAPH_INTERRUPTING_LIST_FIRST_LINE,
	type PartialTitleRefDefPredicate,
	serializeListItemAt,
} from "./markdown-list-serialization";
import {
	alignNodes,
	childrenOf,
	pairUnmatched,
	structurallyEqual,
} from "./markdown-node-alignment";
import {
	type ParsedEnvReferences,
	type ParsedVisualBlockSource,
	parseMarkdownWithBlockSources,
} from "./markdown-parser";
import {
	matchListMarker,
	measureIndentColumns,
	readBlockquotePrefix,
	stripBlockquoteDepth,
} from "./markdown-prescanner-containers";
import { wouldRawHtmlInterruptParagraph } from "./markdown-prescanner-inline";
import { sanitizeBulletMarker } from "./visual-schema";

/**
 * Container-level untouched-source preservation for lists (at top level and
 * inside blockquotes), plus shared depth-stripping, join, lazy-absorption, and
 * list-swallow guards used by the unified container preservation engine.
 */

const LIST_ITEM_START = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const BLANK_LINE = /^[ \t]*$/;
const BLANK_BEFORE_NESTED_LIST =
	/\n[ \t]*\n[ \t]+(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const ORDERED_FIRST_LINE = /^([ \t]*)(\d{1,9})([.)])([ \t]*)(.*)$/;
const BLANK_BLOCKQUOTE_LINE = /^[ \t]*(?:>[ \t]*)+$/;
const ATX_HEADING_FIRST_LINE = /^ {0,3}#{1,6}(?:[ \t]|$)/;

type ListItemSlices = Readonly<{
	items: ReadonlyArray<string>;
	/** `separators[i]` precedes item `i`; `separators[0]` is always empty. */
	separators: ReadonlyArray<string>;
	tail: string;
}>;

// ---------------------------------------------------------------------------
// Shared depth-aware, join, lazy-absorption, and list-swallow guards
// ---------------------------------------------------------------------------

export function wouldBeLazilyAbsorbedByPrevious(
	node: ProseMirrorNode,
	serialized: string,
): boolean {
	const name = node.type.name;
	if (name === "paragraph") {
		return true;
	}
	if (name === "heading") {
		const nl = serialized.indexOf("\n");
		const firstLine = nl === -1 ? serialized : serialized.slice(0, nl);
		return !ATX_HEADING_FIRST_LINE.test(firstLine);
	}
	if (name === "code_block") {
		const nl = serialized.indexOf("\n");
		const firstLine = nl === -1 ? serialized : serialized.slice(0, nl);
		return LEADING_FOUR_COLUMN_INDENT.test(firstLine);
	}
	if (name === "table") {
		return !serialized.startsWith("<!-- ");
	}
	if (
		name === "ordered_list" ||
		name === "bullet_list" ||
		name === "task_list"
	) {
		const nl = serialized.indexOf("\n");
		const firstLine = nl === -1 ? serialized : serialized.slice(0, nl);
		return !PARAGRAPH_INTERRUPTING_LIST_FIRST_LINE.test(firstLine);
	}
	if (name === "protected_block") {
		if (node.attrs.kind === "mermaid") {
			return false;
		}
		if (
			node.attrs.kind === "raw" &&
			typeof node.attrs.rawMarkdown === "string"
		) {
			const raw = node.attrs.rawMarkdown;
			const nl = raw.indexOf("\n");
			const firstLine = (nl === -1 ? raw : raw.slice(0, nl)).replace(
				/^[ \t]{0,3}/,
				"",
			);
			return !wouldRawHtmlInterruptParagraph(firstLine);
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

export function leadingIndentAtDepth(
	emittedText: string,
	depth: number,
): number {
	const nl = emittedText.indexOf("\n");
	const firstLine = nl === -1 ? emittedText : emittedText.slice(0, nl);
	if (depth <= 0) {
		return measureIndentColumns(firstLine);
	}
	const bq = readBlockquotePrefix(firstLine);
	if (bq.depth === depth) {
		return measureIndentColumns(bq.rest, bq.column);
	}
	const stripped = stripBlockquoteDepth(firstLine, depth);
	return measureIndentColumns(stripped ?? firstLine);
}

/**
 * Computes the CommonMark §5.2 content indentation column of the trailing
 * top-level item in `listText` for `listNode`.
 */
function trailingListItemContentIndent(
	listText: string,
	listNode: ProseMirrorNode,
): number {
	const lines = listText.split("\n");
	if (lines.length === 0) return 0;
	const isOrdered = listNode.type.name === "ordered_list";
	const expectedDelimiter =
		isOrdered && listNode.attrs.delimiter === ")" ? ")" : ".";
	const expectedBullet = isOrdered
		? null
		: sanitizeBulletMarker(listNode.attrs.marker);
	const matchTopItem = (line: string): number | null => {
		const marker = matchListMarker(line);
		if (!marker || marker.leadCols > 3) return null;
		if (isOrdered) {
			if (marker.orderedDigits === null) return null;
			const digitIdx = marker.markerPrefix.indexOf(marker.orderedDigits);
			const delimChar =
				marker.markerPrefix[digitIdx + marker.orderedDigits.length];
			if (delimChar !== expectedDelimiter) return null;
		} else {
			if (marker.orderedDigits !== null) return null;
			if (marker.markerPrefix.trimStart()[0] !== expectedBullet) {
				return null;
			}
		}
		return marker.contentIndent;
	};
	if (listNode.childCount <= 1) {
		return matchTopItem(lines[0] ?? "") ?? 0;
	}
	let currentIndent = -1;
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i] ?? "";
		const leadCols = measureIndentColumns(line);
		if (leadCols > 3 || (currentIndent >= 0 && leadCols >= currentIndent)) {
			continue;
		}
		const matchedIndent = matchTopItem(line);
		if (matchedIndent !== null) {
			currentIndent = matchedIndent;
		}
	}
	return currentIndent > 0 ? currentIndent : 0;
}

/**
 * Reports whether `nextText`'s leading indent would be swallowed into the
 * trailing item of an edited or newly adjacent preceding list (`prevNode`),
 * even across a blank line (CommonMark §5.2).
 */
export function isListSwallowingFollowingBlock(
	prevNode: ProseMirrorNode | null,
	prevBlockText: string,
	nextText: string,
	prevWasMatchedAdjacent: boolean,
): boolean {
	if (!prevNode || prevWasMatchedAdjacent || !isNestedList(prevNode)) {
		return false;
	}
	const nl = nextText.indexOf("\n");
	const firstLine = nl === -1 ? nextText : nextText.slice(0, nl);
	const childIndent = measureIndentColumns(firstLine);
	if (childIndent <= 0) {
		return false;
	}
	const trailingIndent = trailingListItemContentIndent(prevBlockText, prevNode);
	return trailingIndent > 0 && childIndent >= trailingIndent;
}

// ---------------------------------------------------------------------------
// List-item granular preservation
// ---------------------------------------------------------------------------

function contentIndentOf(match: RegExpExecArray): number {
	const spacing = match[3] ?? "";
	const width =
		spacing.length === 0 || spacing.length > 4 || spacing.includes("\t")
			? 1
			: spacing.length;
	return (match[1]?.length ?? 0) + (match[2]?.length ?? 0) + width;
}

function splitListItemSlices(raw: string): ListItemSlices | null {
	const lines = raw.split("\n");
	const starts: number[] = [];
	let contentIndent = -1;
	for (let i = 0; i < lines.length; i += 1) {
		const match = LIST_ITEM_START.exec(lines[i] ?? "");
		if (
			match &&
			(contentIndent < 0 || (match[1]?.length ?? 0) < contentIndent)
		) {
			starts.push(i);
			contentIndent = contentIndentOf(match);
		} else if (i === 0) {
			return null;
		}
	}
	const items: string[] = [];
	const separators: string[] = [""];
	let tail = "";
	for (let k = 0; k < starts.length; k += 1) {
		const start = starts[k] ?? 0;
		const end = starts[k + 1] ?? lines.length;
		let last = end - 1;
		while (last > start && BLANK_LINE.test(lines[last] ?? "")) {
			last -= 1;
		}
		items.push(lines.slice(start, last + 1).join("\n"));
		const gap = lines.slice(last + 1, end);
		if (k + 1 < starts.length) {
			separators.push(`\n${gap.map((line) => `${line}\n`).join("")}`);
		} else if (gap.length > 0) {
			tail = `\n${gap.join("\n")}`;
		}
	}
	return { items, separators, tail };
}

function sliceParsesToItem(
	slice: string,
	listNode: ProseMirrorNode,
	index: number,
	envReferences?: ParsedEnvReferences,
): boolean {
	const doc = parseMarkdownWithBlockSources(slice, envReferences).doc;
	const list = doc.childCount === 1 ? doc.firstChild : null;
	return (
		list !== null &&
		list.type === listNode.type &&
		list.childCount === 1 &&
		list.child(0).eq(listNode.child(index))
	);
}

const verifiedSliceCache = new WeakMap<
	ParsedVisualBlockSource,
	ListItemSlices | null
>();

/** Item slices proven to re-parse to exactly the baseline item nodes. */
function verifiedListItemSlices(
	block: ParsedVisualBlockSource,
	envReferences?: ParsedEnvReferences,
	rawOverride?: string,
): ListItemSlices | null {
	const cached = verifiedSliceCache.get(block);
	if (cached !== undefined) return cached;
	let result: ListItemSlices | null = null;
	const raw = rawOverride ?? block.raw;
	if (raw !== null && isNestedList(block.node)) {
		const slices = splitListItemSlices(raw);
		if (
			slices &&
			slices.items.length === block.node.childCount &&
			slices.items.every((slice, i) =>
				sliceParsesToItem(slice, block.node, i, envReferences),
			)
		) {
			result = slices;
		}
	}
	verifiedSliceCache.set(block, result);
	return result;
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

/** Column reached after `text`, expanding tabs to 4-column stops. */
function advanceColumns(text: string, startColumn: number): number {
	let column = startColumn;
	for (const ch of text) {
		column = ch === "\t" ? column + 4 - (column % 4) : column + 1;
	}
	return column;
}

/**
 * A reused raw item that becomes the first item of an ordered list defines
 * the CommonMark start number. When its digits differ from the projected
 * `order`, return candidate rewrites (keeping indent, delimiter, and body
 * bytes as far as possible) in preference order. Each candidate must still be
 * validated in list context; an empty result means "serialize the item".
 */
function alignFirstOrderedMarker(
	listNode: ProseMirrorNode,
	raw: string,
): ReadonlyArray<string> {
	if (listNode.type.name !== "ordered_list") return [raw];
	const order: unknown = listNode.attrs.order;
	const expected =
		typeof order === "number" && Number.isInteger(order) && order >= 0
			? order
			: 1;
	const lines = raw.split("\n");
	const match = ORDERED_FIRST_LINE.exec(lines[0] ?? "");
	if (!match?.[2]) return [];
	if (Number(match[2]) === expected) return [raw];
	const indent = match[1] ?? "";
	const delimiter = match[3] ?? ".";
	const spacing = match[4] ?? "";
	const content = match[5] ?? "";
	const digits = String(expected);
	const delta = digits.length - match[2].length;
	const head = `${indent}${digits}${delimiter}`;
	const firstLine = `${head}${spacing}${content}`;
	if (delta === 0) return [[firstLine, ...lines.slice(1)].join("\n")];

	const markerEnd = advanceColumns(
		`${match[2]}${delimiter}`,
		advanceColumns(indent, 0),
	);
	const spacingWidth = advanceColumns(spacing, markerEnd) - markerEnd;
	const oldContentColumn =
		content.length > 0 && spacingWidth >= 1 && spacingWidth <= 4
			? markerEnd + spacingWidth
			: markerEnd + 1;
	const candidates: string[] = [];

	const shifted = lines.slice(1).map((line) => {
		if (line.trim().length === 0) return line;
		const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
		const width = advanceColumns(leading, 0);
		if (width < oldContentColumn) return line;
		return `${" ".repeat(Math.max(0, width + delta))}${line.slice(leading.length)}`;
	});
	candidates.push([firstLine, ...shifted].join("\n"));

	const paddedWidth = spacingWidth - delta;
	if (
		content.length > 0 &&
		!spacing.includes("\t") &&
		spacingWidth <= 4 &&
		paddedWidth >= 1 &&
		paddedWidth <= 4
	) {
		candidates.push(
			[`${head}${" ".repeat(paddedWidth)}${content}`, ...lines.slice(1)].join(
				"\n",
			),
		);
	}
	return candidates;
}

/** Whether `markdown` re-parses to exactly the single edited list node. */
function listMarkdownParsesTo(
	markdown: string,
	listNode: ProseMirrorNode,
	envReferences?: ParsedEnvReferences,
): boolean {
	const doc = parseMarkdownWithBlockSources(markdown, envReferences).doc;
	return (
		doc.childCount === 1 &&
		doc.firstChild !== null &&
		doc.firstChild.eq(listNode)
	);
}

/**
 * Predicts per-item raw-slice reusability for `serializeListPreservingItems`
 * without duplicating slice verification or ordered-marker alignment logic.
 * Returns `null` when the list falls back to full canonical serialization.
 */
export function resolvePreservedListItemReusability(
	listNode: ProseMirrorNode,
	origBlock: ParsedVisualBlockSource,
	depth: number,
	envReferences: ParsedEnvReferences | undefined,
	nodeHasInvalidatedRef: ((node: ProseMirrorNode) => boolean) | null,
): ReadonlyArray<boolean> | null {
	if (origBlock.raw === null || !listAttrsCompatible(listNode, origBlock.node)) {
		return null;
	}
	const innerRaw = tryStripAllLinesAtDepth(origBlock.raw, depth);
	if (innerRaw === null) return null;
	const slices = verifiedListItemSlices(origBlock, envReferences, innerRaw);
	if (!slices) return null;
	const orig = origBlock.node;
	const matched = alignNodes(
		childrenOf(listNode),
		childrenOf(orig),
		structurallyEqual,
	);
	const reusable = new Array<boolean>(listNode.childCount).fill(false);
	for (let idx = 0; idx < listNode.childCount; idx += 1) {
		const matchedIdx = matched[idx] ?? -1;
		let canReuse =
			matchedIdx >= 0 && !nodeHasInvalidatedRef?.(orig.child(matchedIdx));
		if (canReuse && idx === 0 && listNode.type.name === "ordered_list") {
			const firstSlice = slices.items[matchedIdx];
			if (firstSlice === undefined) {
				canReuse = false;
			} else {
				const candidates = alignFirstOrderedMarker(listNode, firstSlice);
				if (
					candidates.length === 0 ||
					(candidates[0] !== firstSlice &&
						!candidates.some((candidate) =>
							listMarkdownParsesTo(
								candidate,
								listNode.type.create(listNode.attrs, [listNode.child(0)]),
								envReferences,
							),
						))
				) {
					canReuse = false;
				}
			}
		}
		reusable[idx] = canReuse;
	}
	return reusable;
}

/**
 * Serialize an edited list (top-level or blockquote-nested), reusing every
 * untouched item's exact raw slice (unless invalidated by a deleted/shadowed
 * reference definition) and original inter-item separators. Returns `null`
 * when the baseline list cannot be sliced safely.
 */
export function serializeListPreservingItems(
	listNode: ProseMirrorNode,
	origBlock: ParsedVisualBlockSource,
	serializeBlock: BlockSerializer,
	envReferences?: ParsedEnvReferences,
	isPartialTitleRefDef?: PartialTitleRefDefPredicate | null,
	canReuseItem?: ((origItem: ProseMirrorNode) => boolean) | null,
	rawOverride?: string,
	mathNewlineToken?: string,
): string | null {
	const orig = origBlock.node;
	if (!listAttrsCompatible(listNode, orig)) return null;
	const slices = verifiedListItemSlices(origBlock, envReferences, rawOverride);
	if (!slices) return null;
	const newLen = listNode.childCount;
	const origLen = orig.childCount;
	const matched = alignNodes(
		childrenOf(listNode),
		childrenOf(orig),
		structurallyEqual,
	);
	const paired = pairUnmatched(matched, origLen);
	const loose = isLooseList(listNode);
	const defaultSeparator = slices.separators[1] ?? (loose ? "\n\n" : "\n");

	const isReusableOrigItem = (origIdx: number): boolean =>
		origIdx >= 0 && (!canReuseItem || canReuseItem(orig.child(origIdx)));

	const assemble = (firstRaw: string | null): string => {
		let output = "";
		for (let idx = 0; idx < newLen; idx += 1) {
			const matchedIdx = matched[idx] ?? -1;
			const pairedIdx = paired[idx] ?? -1;
			if (idx > 0) {
				const prevPaired = paired[idx - 1] ?? -1;
				output +=
					pairedIdx >= 0 && prevPaired >= 0 && pairedIdx === prevPaired + 1
						? (slices.separators[pairedIdx] ?? defaultSeparator)
						: defaultSeparator;
			}
			const reused =
				idx === 0
					? (firstRaw ?? undefined)
					: isReusableOrigItem(matchedIdx)
						? slices.items[matchedIdx]
						: undefined;
			if (reused !== undefined) {
				output += reused;
				continue;
			}
			const pairedSlice = pairedIdx >= 0 ? slices.items[pairedIdx] : undefined;
			output += serializeListItemAt(
				listNode,
				idx,
				loose,
				serializeBlock,
				pairedSlice !== undefined && BLANK_BEFORE_NESTED_LIST.test(pairedSlice),
				mathNewlineToken,
				isPartialTitleRefDef,
			);
		}
		if (newLen > 0 && (paired[newLen - 1] ?? -1) === origLen - 1) {
			output += slices.tail;
		}
		return output;
	};

	const firstMatched = newLen > 0 ? (matched[0] ?? -1) : -1;
	const firstReused = isReusableOrigItem(firstMatched)
		? slices.items[firstMatched]
		: undefined;
	if (firstReused === undefined) return assemble(null);
	const candidates = alignFirstOrderedMarker(listNode, firstReused);
	if (candidates.length === 1 && candidates[0] === firstReused) {
		return assemble(firstReused);
	}
	for (const candidate of candidates) {
		const output = assemble(candidate);
		if (listMarkdownParsesTo(output, listNode, envReferences)) return output;
	}
	return assemble(null);
}
