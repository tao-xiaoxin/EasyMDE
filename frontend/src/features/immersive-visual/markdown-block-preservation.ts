import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	type ParsedVisualBlockSource,
	type ParsedVisualDocument,
	parseMarkdownWithBlockSources,
} from "./markdown-parser";
import { sanitizeBulletMarker } from "./visual-schema";

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

export type BlockSerializer = (node: ProseMirrorNode) => string;

export type MarkdownSerializers = Readonly<{
	serializeBlock: BlockSerializer;
	serializeDoc: (doc: ProseMirrorNode) => string;
}>;

// ---------------------------------------------------------------------------
// List serialization
// ---------------------------------------------------------------------------

function prefixMultiline(
	text: string,
	firstLinePrefix: string,
	continuationPrefix: string,
): string {
	const lines = text.split("\n");
	return lines
		.map((line, index) => {
			if (index === 0) {
				return line.length > 0
					? `${firstLinePrefix}${line}`
					: firstLinePrefix.trimEnd();
			}
			return line.length > 0 ? `${continuationPrefix}${line}` : "";
		})
		.join("\n");
}

function isNestedList(node: ProseMirrorNode): boolean {
	return (
		node.type.name === "bullet_list" ||
		node.type.name === "ordered_list" ||
		node.type.name === "task_list"
	);
}

function isLooseList(listNode: ProseMirrorNode): boolean {
	if (listNode.attrs.tight === false) {
		return true;
	}
	if (listNode.attrs.tight === true) {
		return false;
	}
	for (let i = 0; i < listNode.childCount; i += 1) {
		const item = listNode.child(i);
		let nonListBlocks = 0;
		for (let j = 0; j < item.childCount; j += 1) {
			if (!isNestedList(item.child(j))) {
				nonListBlocks += 1;
			}
		}
		if (nonListBlocks > 1) {
			return true;
		}
	}
	return false;
}

function canInterruptParagraphInTightList(node: ProseMirrorNode): boolean {
	const name = node.type.name;
	return (
		name === "code_block" ||
		name === "blockquote" ||
		name === "heading" ||
		name === "horizontal_rule"
	);
}

function serializeListItemBody(
	itemNode: ProseMirrorNode,
	loose: boolean,
	serializeBlock: BlockSerializer,
	blankBeforeNestedList: boolean,
): string {
	const firstChild = itemNode.child(0);
	const hasPhantomParagraph =
		itemNode.childCount > 1 &&
		firstChild.type.name === "paragraph" &&
		firstChild.childCount === 0;
	const startIndex = hasPhantomParagraph ? 1 : 0;
	const parts: string[] = [];
	for (let i = startIndex; i < itemNode.childCount; i += 1) {
		const child = itemNode.child(i);
		const serialized = serializeBlock(child);
		if (i === startIndex) {
			// A leading non-paragraph block starts on the line after the marker
			// (`-\n  ```js`), which keeps it inside the list item.
			parts.push(hasPhantomParagraph ? `\n${serialized}` : serialized);
		} else if (
			isNestedList(child) &&
			itemNode.child(i - 1).type.name === "paragraph"
		) {
			// Keep an original blank line before a nested sublist when the
			// baseline item had one; otherwise the sublist follows directly.
			parts.push(
				blankBeforeNestedList ? `\n\n${serialized}` : `\n${serialized}`,
			);
		} else if (!loose && canInterruptParagraphInTightList(child)) {
			// Keep a parsed tight list tight: fences, quotes, headings and rules
			// may interrupt a paragraph, so no blank line is needed.
			parts.push(`\n${serialized}`);
		} else {
			parts.push(`\n\n${serialized}`);
		}
	}
	return parts.join("");
}

function serializeListItemAt(
	listNode: ProseMirrorNode,
	index: number,
	loose: boolean,
	serializeBlock: BlockSerializer,
	blankBeforeNestedList: boolean,
): string {
	const item = listNode.child(index);
	const body = serializeListItemBody(
		item,
		loose,
		serializeBlock,
		blankBeforeNestedList,
	);
	const bulletMarker = sanitizeBulletMarker(listNode.attrs.marker);
	let prefix = `${bulletMarker} `;
	let indent = "  ";
	if (listNode.type.name === "ordered_list") {
		const delimiter = listNode.attrs.delimiter === ")" ? ")" : ".";
		const order = listNode.attrs.order;
		const startOrder =
			typeof order === "number" && Number.isInteger(order) && order >= 0
				? order
				: 1;
		prefix = `${startOrder + index}${delimiter} `;
		indent = " ".repeat(prefix.length);
	} else if (listNode.type.name === "task_list") {
		prefix = item.attrs.checked
			? `${bulletMarker} [x] `
			: `${bulletMarker} [ ] `;
	}
	return prefixMultiline(body, prefix, indent);
}

export function serializeList(
	listNode: ProseMirrorNode,
	serializeBlock: BlockSerializer,
): string {
	const loose = isLooseList(listNode);
	const items: string[] = [];
	for (let i = 0; i < listNode.childCount; i += 1) {
		items.push(serializeListItemAt(listNode, i, loose, serializeBlock, false));
	}
	return items.join(loose ? "\n\n" : "\n");
}

// ---------------------------------------------------------------------------
// Sequence alignment
// ---------------------------------------------------------------------------

function matchInterior(
	isSame: (newIdx: number, origIdx: number) => boolean,
	matchedOrigIndex: number[],
	newMiddleEnd: number,
	origMiddleEnd: number,
	startOffset: number,
): void {
	const newLength = newMiddleEnd - startOffset;
	const origLength = origMiddleEnd - startOffset;
	if (newLength <= 0 || origLength <= 0) {
		return;
	}

	if (newLength * origLength <= 40000) {
		const width = origLength + 1;
		const table = new Uint16Array((newLength + 1) * width);
		for (let m = newLength - 1; m >= 0; m -= 1) {
			for (let n = origLength - 1; n >= 0; n -= 1) {
				table[m * width + n] = isSame(startOffset + m, startOffset + n)
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
			if (isSame(startOffset + m, startOffset + n)) {
				matchedOrigIndex[startOffset + m] = startOffset + n;
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
		return;
	}

	// Bounded fallback: forward greedy match, still monotonic.
	let origCursor = startOffset;
	for (let newIdx = startOffset; newIdx < newMiddleEnd; newIdx += 1) {
		for (let origIdx = origCursor; origIdx < origMiddleEnd; origIdx += 1) {
			if (isSame(newIdx, origIdx)) {
				matchedOrigIndex[newIdx] = origIdx;
				origCursor = origIdx + 1;
				break;
			}
		}
	}
}

/** Monotonic new→original index alignment (-1 = no identical original). */
function alignSequences(
	newLen: number,
	origLen: number,
	isSame: (newIdx: number, origIdx: number) => boolean,
): number[] {
	const matchedOrigIndex = new Array<number>(newLen).fill(-1);
	let prefix = 0;
	while (prefix < newLen && prefix < origLen && isSame(prefix, prefix)) {
		matchedOrigIndex[prefix] = prefix;
		prefix += 1;
	}
	let suffix = 0;
	while (
		suffix < newLen - prefix &&
		suffix < origLen - prefix &&
		isSame(newLen - 1 - suffix, origLen - 1 - suffix)
	) {
		matchedOrigIndex[newLen - 1 - suffix] = origLen - 1 - suffix;
		suffix += 1;
	}
	matchInterior(
		isSame,
		matchedOrigIndex,
		newLen - suffix,
		origLen - suffix,
		prefix,
	);
	return matchedOrigIndex;
}

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
	const matched = alignSequences(newLen, origLen, (n, o) =>
		listNode.child(n).eq(orig.child(o)),
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
	const matchedOrigIndex = alignSequences(newLen, origLen, (n, o) => {
		const origBlock = baselineBlocks[o];
		if (!origBlock) return false;
		const child = doc.child(n);
		return (
			child === origBlock.node ||
			(child.type === origBlock.node.type &&
				child.nodeSize === origBlock.node.nodeSize &&
				child.eq(origBlock.node))
		);
	});
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
		if (idx > 0) {
			const effIdx = effectiveOrigIndex[idx] ?? -1;
			const prevEffIdx = effectiveOrigIndex[idx - 1] ?? -1;
			const effBlock =
				effIdx >= 0 && prevEffIdx >= 0 && effIdx === prevEffIdx + 1
					? baselineBlocks[effIdx]
					: undefined;
			parts.push(effBlock ? effBlock.separatorBefore : "\n\n");
		}
		parts.push(serialized ?? serializers.serializeBlock(child));
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

export function createPreservingRoundTripGuard(
	initialMarkdown: string,
	initialDocOrParsed: ProseMirrorNode | ParsedVisualDocument | undefined,
	serializers: MarkdownSerializers,
): MarkdownRoundTripGuard {
	let parsed: ParsedVisualDocument | null = null;
	let baselineDoc: ProseMirrorNode;

	if (initialDocOrParsed && "blocks" in initialDocOrParsed) {
		parsed = initialDocOrParsed;
		baselineDoc = initialDocOrParsed.doc;
	} else {
		const computed = parseMarkdownWithBlockSources(initialMarkdown);
		baselineDoc = initialDocOrParsed ?? computed.doc;
		if (baselineDoc === computed.doc || baselineDoc.eq(computed.doc)) {
			parsed = computed;
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
