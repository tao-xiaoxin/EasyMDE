import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	type BlockSerializer,
	isLooseList,
	isNestedList,
	needsTightRefDefContinuation,
	serializeListItemAt,
} from "./markdown-list-serialization";
import {
	type ParsedVisualBlockSource,
	type ParsedVisualDocument,
	parseMarkdownWithBlockSources,
} from "./markdown-parser";

export {
	type BlockSerializer,
	needsTightRefDefContinuation,
	serializeList,
} from "./markdown-list-serialization";

/**
 * Untouched-source preservation for the immersive visual editor.
 *
 * The visual editor is an in-memory projection of canonical Markdown. When a
 * legitimate edit is synchronized back, every block (and every list item of an
 * edited top-level list) that the user did not touch keeps its exact original
 * bytes, including blank-line separators. Only edited nodes are regenerated.
 *
 * Block/inline serialization is injected by `markdown-serializer.ts`, keeping
 * the dependency direction one-way (serializer -> preservation).
 */

export type MarkdownRoundTripGuard = Readonly<{
	initialDoc: ProseMirrorNode;
	initialMarkdown: string;
	isUnmodified: (doc: ProseMirrorNode) => boolean;
	serialize: (doc: ProseMirrorNode) => string;
}>;

export type MarkdownSerializers = Readonly<{
	serializeBlock: BlockSerializer;
	serializeDoc: (doc: ProseMirrorNode) => string;
}>;

// ---------------------------------------------------------------------------
// Sequence alignment
// ---------------------------------------------------------------------------

type NodeMatcher = (next: ProseMirrorNode, orig: ProseMirrorNode) => boolean;

/** Exact LCS is used for gaps up to this many DP cells. */
const DP_CELL_BUDGET = 40000;

function childrenOf(node: ProseMirrorNode): ProseMirrorNode[] {
	const children: ProseMirrorNode[] = [];
	node.forEach((child) => {
		children.push(child);
	});
	return children;
}

/**
 * Anchor surviving nodes by immutable object identity first: the longest
 * monotonic chain of `next === orig` pairs (Hunt–Szymanski, O(P log N) over
 * identity pairs P). A node ProseMirror kept untouched is the same object, so
 * two visually identical blocks can never swap their raw spellings.
 */
function anchorIdentities(
	newNodes: readonly ProseMirrorNode[],
	origNodes: readonly ProseMirrorNode[],
	matched: number[],
): void {
	const positions = new Map<ProseMirrorNode, number[]>();
	origNodes.forEach((node, idx) => {
		const list = positions.get(node);
		if (list) list.push(idx);
		else positions.set(node, [idx]);
	});
	type Link = Readonly<{ n: number; o: number; prev: Link | null }>;
	const tails: Link[] = [];
	// Shared node objects are rare; bound pathological duplicate pairs.
	let pairBudget = 4 * (newNodes.length + origNodes.length) + 64;
	newNodes.forEach((node, n) => {
		const list = positions.get(node);
		if (!list || list.length > pairBudget) return;
		pairBudget -= list.length;
		for (let k = list.length - 1; k >= 0; k -= 1) {
			const o = list[k] ?? 0;
			let lo = 0;
			let hi = tails.length;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if ((tails[mid]?.o ?? 0) < o) lo = mid + 1;
				else hi = mid;
			}
			tails[lo] = { n, o, prev: lo > 0 ? (tails[lo - 1] ?? null) : null };
		}
	});
	for (let link = tails[tails.length - 1] ?? null; link; link = link.prev) {
		matched[link.n] = link.o;
	}
}

/** Deterministic JSON with sorted object keys (attrs are JSON-compatible). */
function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

const canonicalKeyCache = new WeakMap<ProseMirrorNode, string>();

/**
 * Equality-compatible canonical key: node type, all attrs (sorted), marks
 * (ProseMirror keeps mark sets in canonical order) with sorted attrs, text,
 * and child keys. Nodes with equal keys are `eq()`; memoized per immutable
 * node, so every node's key is computed at most once.
 */
function canonicalKey(node: ProseMirrorNode): string {
	const cached = canonicalKeyCache.get(node);
	if (cached !== undefined) return cached;
	const marks = node.marks
		.map((mark) => `${mark.type.name}${stableStringify(mark.attrs)}`)
		.join(";");
	let key: string;
	if (node.isText) {
		key = `t${JSON.stringify(node.text ?? "")}<${marks}>`;
	} else {
		const children: string[] = [];
		node.forEach((child) => {
			children.push(canonicalKey(child));
		});
		key = `n${node.type.name}${stableStringify(node.attrs)}<${marks}>[${children.join(",")}]`;
	}
	canonicalKeyCache.set(node, key);
	return key;
}

/** Exact LCS over a small gap (offsets are absolute indices). */
function matchGapExact(
	newNodes: readonly ProseMirrorNode[],
	origNodes: readonly ProseMirrorNode[],
	nodesMatch: NodeMatcher,
	matched: number[],
	newStart: number,
	newLength: number,
	origStart: number,
	origLength: number,
): void {
	const same = (m: number, n: number): boolean => {
		const next = newNodes[newStart + m];
		const orig = origNodes[origStart + n];
		return next !== undefined && orig !== undefined && nodesMatch(next, orig);
	};
	const width = origLength + 1;
	const table = new Uint16Array((newLength + 1) * width);
	for (let m = newLength - 1; m >= 0; m -= 1) {
		for (let n = origLength - 1; n >= 0; n -= 1) {
			table[m * width + n] = same(m, n)
				? (table[(m + 1) * width + n + 1] ?? 0) + 1
				: Math.max(
						table[(m + 1) * width + n] ?? 0,
						table[m * width + n + 1] ?? 0,
					);
		}
	}
	let m = 0;
	let n = 0;
	while (m < newLength && n < origLength) {
		if (same(m, n)) {
			matched[newStart + m] = origStart + n;
			m += 1;
			n += 1;
		} else if (
			(table[(m + 1) * width + n] ?? 0) >= (table[m * width + n + 1] ?? 0)
		) {
			m += 1;
		} else {
			n += 1;
		}
	}
}

/**
 * Indexed monotonic matching for large gaps: originals are bucketed by an
 * equality-compatible canonical key, so every bucket member is structurally
 * equal to any new node with that key. Each bucket pointer only moves
 * forward to the first original at or after the cursor: O(N + M) bucket
 * operations, no candidate cutoff, and at most one verifying comparison per
 * matched new node (zero for unmatched ones).
 */
function matchGapIndexed(
	newNodes: readonly ProseMirrorNode[],
	origNodes: readonly ProseMirrorNode[],
	nodesMatch: NodeMatcher,
	matched: number[],
	newStart: number,
	newEnd: number,
	origStart: number,
	origEnd: number,
): void {
	const buckets = new Map<string, { indices: number[]; next: number }>();
	for (let o = origStart; o < origEnd; o += 1) {
		const node = origNodes[o];
		if (!node) continue;
		const key = canonicalKey(node);
		const bucket = buckets.get(key);
		if (bucket) bucket.indices.push(o);
		else buckets.set(key, { indices: [o], next: 0 });
	}
	let origCursor = origStart;
	for (let n = newStart; n < newEnd; n += 1) {
		const next = newNodes[n];
		const bucket = next ? buckets.get(canonicalKey(next)) : undefined;
		if (!next || !bucket) continue;
		const { indices } = bucket;
		while (
			bucket.next < indices.length &&
			(indices[bucket.next] ?? 0) < origCursor
		) {
			bucket.next += 1;
		}
		const o = indices[bucket.next] ?? -1;
		const orig = origNodes[o];
		// Defensive verification; equal keys already imply equality.
		if (orig && nodesMatch(next, orig)) {
			matched[n] = o;
			origCursor = o + 1;
			bucket.next += 1;
		}
	}
}

/** Structural matching inside one gap between identity anchors. */
function matchGap(
	newNodes: readonly ProseMirrorNode[],
	origNodes: readonly ProseMirrorNode[],
	nodesMatch: NodeMatcher,
	matched: number[],
	newStartIn: number,
	newEndIn: number,
	origStartIn: number,
	origEndIn: number,
): void {
	let newStart = newStartIn;
	let newEnd = newEndIn;
	let origStart = origStartIn;
	let origEnd = origEndIn;
	const same = (n: number, o: number): boolean => {
		const next = newNodes[n];
		const orig = origNodes[o];
		return next !== undefined && orig !== undefined && nodesMatch(next, orig);
	};
	while (
		newStart < newEnd &&
		origStart < origEnd &&
		same(newStart, origStart)
	) {
		matched[newStart] = origStart;
		newStart += 1;
		origStart += 1;
	}
	while (
		newStart < newEnd &&
		origStart < origEnd &&
		same(newEnd - 1, origEnd - 1)
	) {
		newEnd -= 1;
		origEnd -= 1;
		matched[newEnd] = origEnd;
	}
	const newLength = newEnd - newStart;
	const origLength = origEnd - origStart;
	if (newLength <= 0 || origLength <= 0) return;
	if (newLength * origLength <= DP_CELL_BUDGET) {
		matchGapExact(
			newNodes,
			origNodes,
			nodesMatch,
			matched,
			newStart,
			newLength,
			origStart,
			origLength,
		);
		return;
	}
	matchGapIndexed(
		newNodes,
		origNodes,
		nodesMatch,
		matched,
		newStart,
		newEnd,
		origStart,
		origEnd,
	);
}

/**
 * Monotonic new→original index alignment (-1 = no identical original).
 * Identity anchors are fixed first; structural equality only fills the
 * unanchored gaps (nodes recreated by real edits or Undo/Redo).
 */
function alignNodes(
	newNodes: readonly ProseMirrorNode[],
	origNodes: readonly ProseMirrorNode[],
	nodesMatch: NodeMatcher,
): number[] {
	const newLen = newNodes.length;
	const matched = new Array<number>(newLen).fill(-1);
	anchorIdentities(newNodes, origNodes, matched);
	let prevNew = -1;
	let prevOrig = -1;
	for (let n = 0; n <= newLen; n += 1) {
		const o = n < newLen ? (matched[n] ?? -1) : origNodes.length;
		if (o < 0) continue;
		matchGap(
			newNodes,
			origNodes,
			nodesMatch,
			matched,
			prevNew + 1,
			n,
			prevOrig + 1,
			o,
		);
		prevNew = n;
		prevOrig = o;
	}
	return matched;
}

const structurallyEqual: NodeMatcher = (next, orig) =>
	next === orig ||
	(next.type === orig.type && next.nodeSize === orig.nodeSize && next.eq(orig));

/**
 * Pair unmatched new entries with unmatched originals positionally when a gap
 * between two matched anchors has the same length on both sides (an in-place
 * edit). Matched entries keep their index; unpaired entries stay -1.
 */
function pairUnmatched(matched: readonly number[], origLen: number): number[] {
	const paired = matched.slice();
	let idx = 0;
	while (idx < matched.length) {
		if ((matched[idx] ?? -1) >= 0) {
			idx += 1;
			continue;
		}
		const gapStart = idx;
		while (idx < matched.length && (matched[idx] ?? -1) < 0) {
			idx += 1;
		}
		const prevOrig = gapStart > 0 ? (matched[gapStart - 1] ?? -1) : -1;
		const nextOrig = idx < matched.length ? (matched[idx] ?? origLen) : origLen;
		if (nextOrig - prevOrig - 1 === idx - gapStart) {
			for (let k = gapStart; k < idx; k += 1) {
				paired[k] = prevOrig + 1 + (k - gapStart);
			}
		}
	}
	return paired;
}

// ---------------------------------------------------------------------------
// List-item granular preservation
// ---------------------------------------------------------------------------

type ListItemSlices = Readonly<{
	items: ReadonlyArray<string>;
	/** `separators[i]` precedes item `i`; `separators[0]` is always empty. */
	separators: ReadonlyArray<string>;
	tail: string;
}>;

const LIST_ITEM_START = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)/;
const BLANK_LINE = /^[ \t]*$/;
const BLANK_BEFORE_NESTED_LIST =
	/\n[ \t]*\n[ \t]+(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

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
): boolean {
	const doc = parseMarkdownWithBlockSources(slice).doc;
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
): ListItemSlices | null {
	const cached = verifiedSliceCache.get(block);
	if (cached !== undefined) return cached;
	let result: ListItemSlices | null = null;
	if (block.raw !== null && isNestedList(block.node)) {
		const slices = splitListItemSlices(block.raw);
		if (
			slices &&
			slices.items.length === block.node.childCount &&
			slices.items.every((slice, i) => sliceParsesToItem(slice, block.node, i))
		) {
			result = slices;
		}
	}
	verifiedSliceCache.set(block, result);
	return result;
}

function listAttrsCompatible(
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

const ORDERED_FIRST_LINE = /^([ \t]*)(\d{1,9})([.)])([ \t]*)(.*)$/;

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

	// Original content column, in Markdown columns (4-column tab stops).
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

	// 1. Shift structural continuation lines (indented to at least the old
	// content column) by the width change. Lazy continuation lines indented
	// less than the content column keep their exact bytes.
	const shifted = lines.slice(1).map((line) => {
		if (line.trim().length === 0) return line;
		const leading = /^[ \t]*/.exec(line)?.[0] ?? "";
		const width = advanceColumns(leading, 0);
		if (width < oldContentColumn) return line;
		return `${" ".repeat(Math.max(0, width + delta))}${line.slice(leading.length)}`;
	});
	candidates.push([firstLine, ...shifted].join("\n"));

	// 2. Keep every continuation byte and absorb the width change in the
	// marker spacing, so the content column itself does not move.
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
): boolean {
	const doc = parseMarkdownWithBlockSources(markdown).doc;
	return (
		doc.childCount === 1 &&
		doc.firstChild !== null &&
		doc.firstChild.eq(listNode)
	);
}

/**
 * Serialize an edited top-level list, reusing every untouched item's exact
 * raw slice and original inter-item separators. Returns `null` when the
 * baseline list cannot be sliced safely (caller regenerates the whole list).
 */
function serializeListPreservingItems(
	listNode: ProseMirrorNode,
	origBlock: ParsedVisualBlockSource,
	serializeBlock: BlockSerializer,
): string | null {
	const orig = origBlock.node;
	if (!listAttrsCompatible(listNode, orig)) return null;
	const slices = verifiedListItemSlices(origBlock);
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

	/** `firstRaw === null` serializes item 0 through the structural path. */
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
					: matchedIdx >= 0
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
			);
		}
		if (newLen > 0 && (paired[newLen - 1] ?? -1) === origLen - 1) {
			output += slices.tail;
		}
		return output;
	};

	const firstMatched = newLen > 0 ? (matched[0] ?? -1) : -1;
	const firstReused =
		firstMatched >= 0 ? slices.items[firstMatched] : undefined;
	if (firstReused === undefined) return assemble(null);
	const candidates = alignFirstOrderedMarker(listNode, firstReused);
	if (candidates.length === 1 && candidates[0] === firstReused) {
		return assemble(firstReused);
	}
	// A rewritten first item is accepted only when the whole list re-parses
	// to the edited node; otherwise that item is regenerated structurally.
	for (const candidate of candidates) {
		const output = assemble(candidate);
		if (listMarkdownParsesTo(output, listNode)) return output;
	}
	return assemble(null);
}

// ---------------------------------------------------------------------------
// Document-level preservation
// ---------------------------------------------------------------------------

function isEmptyDoc(doc: ProseMirrorNode): boolean {
	return (
		doc.childCount === 1 &&
		doc.firstChild?.type.name === "paragraph" &&
		doc.firstChild.childCount === 0
	);
}

function serializeDocPreservingUntouchedBlocks(
	doc: ProseMirrorNode,
	parsed: ParsedVisualDocument,
	serializers: MarkdownSerializers,
): string {
	if (isEmptyDoc(doc)) {
		return "";
	}
	const baselineBlocks = parsed.blocks;
	if (baselineBlocks.length === 0) {
		return serializers.serializeDoc(doc);
	}

	const newLen = doc.childCount;
	const origLen = baselineBlocks.length;
	const matchedOrigIndex = alignNodes(
		childrenOf(doc),
		baselineBlocks.map((block) => block.node),
		structurallyEqual,
	);
	const pairedOrigIndex = pairUnmatched(matchedOrigIndex, origLen);
	// Original index whose separator semantics this output block inherits.
	const effectiveOrigIndex = new Array<number>(newLen).fill(-1);

	const keepLeadingPrefix = matchedOrigIndex[0] === 0;
	const parts: string[] = [];
	if (keepLeadingPrefix && parsed.leadingPrefix.length > 0) {
		parts.push(parsed.leadingPrefix);
	}
	for (let idx = 0; idx < newLen; idx += 1) {
		const child = doc.child(idx);
		const origIdx = matchedOrigIndex[idx] ?? -1;
		const origBlock = origIdx >= 0 ? baselineBlocks[origIdx] : undefined;
		let serialized: string | null =
			origBlock && origBlock.raw !== null ? origBlock.raw : null;
		if (origBlock) {
			effectiveOrigIndex[idx] = origIdx;
		} else if (isNestedList(child)) {
			const pairedIdx = pairedOrigIndex[idx] ?? -1;
			const pairedBlock =
				pairedIdx >= 0 ? baselineBlocks[pairedIdx] : undefined;
			if (pairedBlock && pairedBlock.raw !== null) {
				serialized = serializeListPreservingItems(
					child,
					pairedBlock,
					serializers.serializeBlock,
				);
				if (serialized !== null) effectiveOrigIndex[idx] = pairedIdx;
			}
		}
		const tightRefDefContinuation =
			idx > 0 && needsTightRefDefContinuation(doc.child(idx - 1), child);
		let separator = "";
		if (idx > 0) {
			const effIdx = effectiveOrigIndex[idx] ?? -1;
			const prevEffIdx = effectiveOrigIndex[idx - 1] ?? -1;
			const effBlock =
				effIdx >= 0 && prevEffIdx >= 0 && effIdx === prevEffIdx + 1
					? baselineBlocks[effIdx]
					: undefined;
			separator = tightRefDefContinuation
				? "\n"
				: effBlock
					? effBlock.separatorBefore
					: "\n\n";
			parts.push(separator);
		}
		const reusedIndentedParagraphAfterBlank =
			serialized !== null &&
			child.type.name === "paragraph" &&
			separator !== "\n" &&
			/^(?: {4}|\t)/.test(serialized);
		const blockText =
			serialized !== null && !reusedIndentedParagraphAfterBlank
				? serialized
				: serializers.serializeBlock(child);
		parts.push(
			tightRefDefContinuation && !/^ {4}/.test(blockText)
				? `    ${blockText}`
				: blockText,
		);
	}
	let output = parts.join("");
	// A multi-block document replaced without any surviving baseline block must
	// not re-attach the stale trailing newlines; an in-place single-block edit
	// (`"Hello\n"` -> `"Hello!\n"`) still keeps its suffix.
	const keepTrailingSuffix =
		origLen === 1 || matchedOrigIndex.some((origIdx) => origIdx >= 0);
	if (output.length > 0 && keepTrailingSuffix) {
		output += parsed.trailingSuffix;
	}
	if (parsed.lineEnding === "\r\n") {
		output = output.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
	}
	return output;
}

/**
 * Rebind baseline blocks to the live (structurally equal) node objects so
 * identity anchoring recognizes untouched surviving blocks. List items are
 * covered transitively: list alignment reads children of the rebound list
 * node, which are the live item objects.
 */
function rebindParsedToDoc(
	parsed: ParsedVisualDocument,
	doc: ProseMirrorNode,
): ParsedVisualDocument | null {
	if (doc === parsed.doc) return parsed;
	if (parsed.blocks.length !== doc.childCount || !doc.eq(parsed.doc)) {
		return null;
	}
	return {
		...parsed,
		doc,
		blocks: parsed.blocks.map((block, i) => ({ ...block, node: doc.child(i) })),
	};
}

/**
 * `liveDoc` is the document actually kept alive in the editor view (for
 * example after an Undo/external reconcile that retained surviving child
 * nodes). When structurally equal to the baseline it becomes the identity
 * baseline, so later edits anchor surviving blocks by object identity.
 */
export function createPreservingRoundTripGuard(
	initialMarkdown: string,
	initialDocOrParsed: ProseMirrorNode | ParsedVisualDocument | undefined,
	serializers: MarkdownSerializers,
	liveDoc?: ProseMirrorNode,
): MarkdownRoundTripGuard {
	let parsed: ParsedVisualDocument | null = null;
	let baselineDoc: ProseMirrorNode;

	if (initialDocOrParsed && "blocks" in initialDocOrParsed) {
		parsed = initialDocOrParsed;
		baselineDoc = initialDocOrParsed.doc;
	} else {
		const computed = parseMarkdownWithBlockSources(initialMarkdown);
		baselineDoc = initialDocOrParsed ?? computed.doc;
		parsed =
			baselineDoc === computed.doc
				? computed
				: (rebindParsedToDoc(computed, baselineDoc) ??
					(baselineDoc.eq(computed.doc) ? computed : null));
	}
	if (liveDoc && liveDoc !== baselineDoc) {
		const rebound = parsed ? rebindParsedToDoc(parsed, liveDoc) : null;
		if (rebound) {
			parsed = rebound;
			baselineDoc = liveDoc;
		}
	}

	// ProseMirror nodes are immutable; caching serialized strings per node
	// avoids re-serializing untouched pasted or newly created blocks on every
	// subsequent keystroke without weakening baseline raw-slice preservation.
	const blockSerializationCache = new WeakMap<ProseMirrorNode, string>();
	const serializeBlockCached: BlockSerializer = (node) => {
		const cached = blockSerializationCache.get(node);
		if (cached !== undefined) {
			return cached;
		}
		const serialized = serializers.serializeBlock(node);
		blockSerializationCache.set(node, serialized);
		return serialized;
	};
	const cachedSerializers: MarkdownSerializers = {
		serializeBlock: serializeBlockCached,
		serializeDoc(doc) {
			if (isEmptyDoc(doc)) {
				return "";
			}
			const blocks: string[] = [];
			for (let i = 0; i < doc.childCount; i += 1) {
				blocks.push(serializeBlockCached(doc.child(i)));
			}
			return blocks.join("\n\n");
		},
	};

	const isUnmodified = (doc: ProseMirrorNode): boolean =>
		doc === baselineDoc || doc.eq(baselineDoc);

	return {
		initialDoc: baselineDoc,
		initialMarkdown,
		isUnmodified,
		serialize(doc: ProseMirrorNode): string {
			if (isUnmodified(doc)) {
				return initialMarkdown;
			}
			if (parsed) {
				return serializeDocPreservingUntouchedBlocks(
					doc,
					parsed,
					cachedSerializers,
				);
			}
			return cachedSerializers.serializeDoc(doc);
		},
	};
}
