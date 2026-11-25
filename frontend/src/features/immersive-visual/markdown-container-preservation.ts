import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import { normalizeReferenceLabel } from "./markdown-escape";
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
	type BuiltVisualBlockSources,
	extractReferenceDefinitionLabels,
	inspectReferenceDefinitionBlock,
	type ParsedEnvReferences,
	type ParsedVisualBlockSource,
	type ParsedVisualDocument,
	type ParsedVisualSharedGroup,
	parseMarkdownWithBlockSources,
	type ReferenceImageOrigin,
	type ReferenceLinkOrigin,
	wouldReferenceDefinitionAbsorbFollowingBlock,
} from "./markdown-parser";
import {
	matchListMarker,
	measureIndentColumns,
} from "./markdown-prescanner-containers";
import { wouldRawHtmlInterruptParagraph } from "./markdown-prescanner-inline";
import { extractPhpPartialReferenceTitle } from "./markdown-reference-preservation";
import { sanitizeBulletMarker } from "./visual-schema";

export type ReferencePreserveResolver = Readonly<{
	isPartialTitleRefDef: (node: ProseMirrorNode) => boolean;
	resolveImage: (node: ProseMirrorNode) => ReferenceImageOrigin | null;
	resolveLink: (mark: Mark) => ReferenceLinkOrigin | null;
}>;

/**
 * Container-level untouched-source preservation for lists (at top level and
 * inside blockquotes), plus shared join, lazy-absorption, and list-swallow
 * guards used by the unified container preservation engine.
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
// Shared join, lazy-absorption, and list-swallow guards
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

/**
 * Computes the CommonMark §5.2 content indentation column of the trailing
 * top-level item in `listText` for `listNode`.
 */
export function trailingListItemContentIndent(
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
export function verifiedListItemSlices(
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

// ---------------------------------------------------------------------------
// Unified tree-order reference-definition liveness & invalidation checks
// ---------------------------------------------------------------------------

type SharedGroupLookupEntry = Readonly<{
	blocks: ReadonlyArray<ParsedVisualBlockSource>;
	group: ParsedVisualSharedGroup;
}>;

function isSharedGroupIntactInParent(
	parent: ProseMirrorNode,
	startChildIdx: number,
	blocks: ReadonlyArray<ParsedVisualBlockSource>,
	startGroup: ParsedVisualSharedGroup,
	blockquoteSources:
		| ReadonlyMap<ProseMirrorNode, BuiltVisualBlockSources>
		| undefined,
): boolean {
	let curIdx = startChildIdx;
	let curGroup = startGroup;
	while (true) {
		const len = curGroup.endIndex - curGroup.startIndex;
		if (curIdx + len > parent.childCount) return false;
		for (let offset = 0; offset < len; offset += 1) {
			const origMember = blocks[curGroup.startIndex + offset];
			if (
				!origMember ||
				!structurallyEqual(parent.child(curIdx + offset), origMember.node)
			) {
				return false;
			}
		}
		const nextOrig = blocks[curGroup.endIndex];
		if (!nextOrig) return true;
		const nextGroup =
			nextOrig.sharedGroup?.startIndex === curGroup.endIndex
				? nextOrig.sharedGroup
				: undefined;
		const nextSep = nextGroup
			? nextGroup.separatorBefore
			: nextOrig.separatorBefore;
		if (nextSep !== "\n") return true;
		const afterIdx = curIdx + len;
		if (afterIdx >= parent.childCount) return false;
		if (nextGroup) {
			curIdx = afterIdx;
			curGroup = nextGroup;
			continue;
		}
		const nextChild = parent.child(afterIdx);
		if (structurallyEqual(nextChild, nextOrig.node)) return true;
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
}

function buildSharedGroupByFirstNode(
	parsed: ParsedVisualDocument,
): ReadonlyMap<ProseMirrorNode, SharedGroupLookupEntry> {
	const map = new Map<ProseMirrorNode, SharedGroupLookupEntry>();
	const record = (blocks: ReadonlyArray<ParsedVisualBlockSource>): void => {
		for (let i = 0; i < blocks.length; i += 1) {
			const block = blocks[i];
			if (block?.sharedGroup && block.sharedGroup.startIndex === i) {
				map.set(block.node, { blocks, group: block.sharedGroup });
			}
		}
	};
	record(parsed.blocks);
	if (parsed.blockquoteSources) {
		for (const bqSource of parsed.blockquoteSources.values()) {
			record(bqSource.blocks);
		}
	}
	return map;
}

function hasPartialTitleFollowerSibling(
	parent: ProseMirrorNode,
	refIdx: number,
	refNode: ProseMirrorNode,
	label: string,
	parsed: ParsedVisualDocument,
	sharedGroupByFirstNode: ReadonlyMap<ProseMirrorNode, SharedGroupLookupEntry>,
	parentInBrokenSharedGroup: boolean,
	serializeBlock: BlockSerializer,
): boolean {
	if (refIdx + 1 >= parent.childCount) {
		return false;
	}
	const nextSibling = parent.child(refIdx + 1);
	if (
		nextSibling.type.name !== "paragraph" &&
		nextSibling.type.name !== "heading" &&
		nextSibling.type.name !== "table"
	) {
		return false;
	}
	if (!/^[ \t]*["'(]/.test(nextSibling.textContent)) {
		return false;
	}
	let serializedNext: string | null = null;
	if (nextSibling.type.name === "paragraph") {
		const refRaw =
			typeof refNode.attrs.rawMarkdown === "string"
				? refNode.attrs.rawMarkdown
				: "";
		const refInfo = inspectReferenceDefinitionBlock(refRaw);
		serializedNext = serializeBlock(nextSibling);
		if (
			!refInfo.isRefDef ||
			refInfo.lastHasTitle ||
			wouldReferenceDefinitionAbsorbFollowingBlock(
				refInfo.lastRaw,
				serializedNext,
			)
		) {
			return false;
		}
	}
	// If the untouched follower (or an enclosing blockquote containing it) belongs
	// to a baseline sharedGroup (e.g. `"a $$x$$` or `> "a $$x$$`) whose group broke
	// because a sibling changed, canonical serialization drops the trailing space
	// before `$$x$$` (`"a \n"` -> `"a\n"`). Mark the refdef non-intact so untouched
	// references re-serialize inline with the exact baseline title.
	const sharedEntry = sharedGroupByFirstNode.get(nextSibling);
	const brokenSharedFollower =
		parentInBrokenSharedGroup ||
		(sharedEntry !== undefined &&
			!isSharedGroupIntactInParent(
				parent,
				refIdx + 1,
				sharedEntry.blocks,
				sharedEntry.group,
				parsed.blockquoteSources,
			));
	if (brokenSharedFollower) {
		const nextText = serializedNext ?? serializeBlock(nextSibling);
		const lines = nextText.split("\n");
		const canonicalTitle = extractPhpPartialReferenceTitle(
			nextSibling.type.name === "table" ? lines.slice(0, 1) : lines,
		);
		const expectedTitle = parsed.envReferences?.[label]?.title ?? "";
		if ((canonicalTitle ?? "") !== expectedTitle) {
			return false;
		}
	}
	return true;
}

/**
 * Single recursive tree-order walker over `doc` determining which baseline
 * reference definitions remain alive and unshadowed at every nesting depth
 * (top-level, lists, list items, and nested blockquotes).
 */
export function computeIntactRefDefLabels(
	doc: ProseMirrorNode,
	parsed: ParsedVisualDocument,
	serializeBlock: BlockSerializer,
): Readonly<{
	allIntact: Set<string>;
	partialTitleIntact: Set<string>;
}> {
	const allIntact = new Set<string>();
	const partialTitleIntact = new Set<string>();
	const firstByLabel = parsed.firstRefDefNodeByLabel;
	const labelsByNode = parsed.refDefLabelsByNode;
	const hasRefs =
		(parsed.referenceLinks && parsed.referenceLinks.size > 0) ||
		(parsed.referenceImages && parsed.referenceImages.size > 0) ||
		(parsed.referencedLabelsByNode && parsed.referencedLabelsByNode.size > 0);
	if (
		!hasRefs ||
		!firstByLabel ||
		firstByLabel.size === 0 ||
		!labelsByNode ||
		labelsByNode.size === 0
	) {
		return { allIntact, partialTitleIntact };
	}
	const partialLabels = parsed.phpPartialTitleRefLabels;
	const sharedGroupByFirstNode =
		partialLabels && partialLabels.size > 0
			? buildSharedGroupByFirstNode(parsed)
			: new Map<ProseMirrorNode, SharedGroupLookupEntry>();
	const seenLabels = new Set<string>();

	const walk = (
		parent: ProseMirrorNode,
		parentInBrokenSharedGroup: boolean,
	): void => {
		for (let i = 0; i < parent.childCount; i += 1) {
			const child = parent.child(i);
			if (
				child.type.name === "protected_block" &&
				child.attrs.kind === "raw" &&
				typeof child.attrs.rawMarkdown === "string"
			) {
				const origLabels = labelsByNode.get(child);
				if (origLabels) {
					for (const label of origLabels) {
						if (seenLabels.has(label)) continue;
						seenLabels.add(label);
						if (firstByLabel.get(label) !== child) continue;
						if (partialLabels?.has(label)) {
							if (
								hasPartialTitleFollowerSibling(
									parent,
									i,
									child,
									label,
									parsed,
									sharedGroupByFirstNode,
									parentInBrokenSharedGroup,
									serializeBlock,
								)
							) {
								allIntact.add(label);
								partialTitleIntact.add(label);
							}
						} else {
							allIntact.add(label);
						}
					}
				} else {
					const newLabels = extractReferenceDefinitionLabels(
						child.attrs.rawMarkdown,
					);
					if (newLabels) {
						for (const rawLabel of newLabels) {
							seenLabels.add(normalizeReferenceLabel(rawLabel));
						}
					}
				}
				continue;
			}
			if (child.childCount > 0) {
				const sharedEntry = sharedGroupByFirstNode.get(child);
				const childInBrokenSharedGroup =
					parentInBrokenSharedGroup ||
					(sharedEntry !== undefined &&
						!isSharedGroupIntactInParent(
							parent,
							i,
							sharedEntry.blocks,
							sharedEntry.group,
							parsed.blockquoteSources,
						));
				walk(child, childInBrokenSharedGroup);
			}
		}
	};
	walk(doc, false);
	return { allIntact, partialTitleIntact };
}

export function buildReferencePreserveResolver(
	parsed: ParsedVisualDocument,
	partialTitleIntact: ReadonlySet<string>,
	hasRefSerializer: boolean,
): ReferencePreserveResolver | null {
	if (partialTitleIntact.size === 0 || !hasRefSerializer) {
		return null;
	}
	const partialTitleRefNodes = new Set<ProseMirrorNode>();
	if (parsed.firstRefDefNodeByLabel) {
		for (const label of partialTitleIntact) {
			const refNode = parsed.firstRefDefNodeByLabel.get(label);
			if (refNode) partialTitleRefNodes.add(refNode);
		}
	}
	return {
		isPartialTitleRefDef: (node) => partialTitleRefNodes.has(node),
		resolveImage: (node) => {
			const origin = parsed.referenceImages?.get(node);
			return origin && partialTitleIntact.has(origin.normalizedLabel)
				? origin
				: null;
		},
		resolveLink: (mark) => {
			const origin = parsed.referenceLinks?.get(mark);
			return origin && partialTitleIntact.has(origin.normalizedLabel)
				? origin
				: null;
		},
	};
}

export function createInvalidatedRefChecker(
	parsed: ParsedVisualDocument,
	allIntact: ReadonlySet<string>,
): Readonly<{
	hasInvalidatedRefDefs: boolean;
	nodeHasInvalidatedRef: (node: ProseMirrorNode) => boolean;
}> {
	const totalRefDefs = parsed.firstRefDefNodeByLabel?.size ?? 0;
	const hasRefs =
		(parsed.referenceLinks && parsed.referenceLinks.size > 0) ||
		(parsed.referenceImages && parsed.referenceImages.size > 0) ||
		(parsed.referencedLabelsByNode && parsed.referencedLabelsByNode.size > 0);
	if (!hasRefs || totalRefDefs === 0 || allIntact.size >= totalRefDefs) {
		return {
			hasInvalidatedRefDefs: false,
			nodeHasInvalidatedRef: () => false,
		};
	}
	const cache = new WeakMap<ProseMirrorNode, boolean>();
	const check = (node: ProseMirrorNode): boolean => {
		const cached = cache.get(node);
		if (cached !== undefined) return cached;
		let invalidated = false;
		const blockLabels = parsed.referencedLabelsByNode?.get(node);
		if (blockLabels) {
			for (const label of blockLabels) {
				if (!allIntact.has(label)) {
					invalidated = true;
					break;
				}
			}
		}
		if (!invalidated && node.type.name === "image") {
			const origin = parsed.referenceImages?.get(node);
			if (origin && !allIntact.has(origin.normalizedLabel)) {
				invalidated = true;
			}
		}
		if (!invalidated && node.marks.length > 0 && parsed.referenceLinks) {
			for (let m = 0; m < node.marks.length; m += 1) {
				const mark = node.marks[m];
				if (mark && mark.type.name === "link") {
					const origin = parsed.referenceLinks.get(mark);
					if (origin && !allIntact.has(origin.normalizedLabel)) {
						invalidated = true;
						break;
					}
				}
			}
		}
		if (!invalidated && node.childCount > 0) {
			for (let i = 0; i < node.childCount; i += 1) {
				if (check(node.child(i))) {
					invalidated = true;
					break;
				}
			}
		}
		cache.set(node, invalidated);
		return invalidated;
	};
	return { hasInvalidatedRefDefs: true, nodeHasInvalidatedRef: check };
}

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
