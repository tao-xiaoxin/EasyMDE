import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	type BlockSerializer,
	isLooseList,
	isNestedList,
	LEADING_FOUR_COLUMN_INDENT,
	nodePreventsFollowingIndentedCode,
	PARAGRAPH_INTERRUPTING_LIST_FIRST_LINE,
	type PartialTitleRefDefPredicate,
	restoreMathNewlineSentinel,
	serializeListItemAt,
} from "./markdown-list-serialization";
import {
	alignNodes,
	childrenOf,
	nodesSemanticallyEqual,
	pairUnmatched,
	structurallyEqual,
} from "./markdown-node-alignment";
import {
	type BuiltVisualBlockSources,
	type ParsedEnvReferences,
	type ParsedVisualBlockSource,
	type ParsedVisualSharedGroup,
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
	prevWasMatchedAdjacent: boolean,
): boolean {
	if (leadIndent <= 0 || prevNode === null) return false;
	return (
		(leadIndent >= 4 &&
			child.type.name !== "code_block" &&
			sep === "\n" &&
			nodePreventsFollowingIndentedCode(prevNode)) ||
		(!prevWasMatchedAdjacent && isNestedList(prevNode))
	);
}

/**
 * Single authoritative check for 4-column indented-code risk and preceding-list
 * swallow risk shared by liveness analysis and container serialization.
 */
export function checkRawPreservationRisks(
	child: ProseMirrorNode,
	depth: number,
	rawEmitted: string,
	rawInner: string,
	sep: string,
	prevNode: ProseMirrorNode | null,
	prevInner: string,
	prevWasMatchedAdjacent: boolean,
): Readonly<{ indentedRisk: boolean; swallowRisk: boolean }> {
	const leadIndent = leadingIndentAtDepth(rawEmitted, depth);
	const indentedRisk =
		child.type.name !== "code_block" &&
		leadIndent >= 4 &&
		(sep !== "\n" ||
			!prevNode ||
			!nodePreventsFollowingIndentedCode(prevNode) ||
			endsWithBlankBlockquoteLine(prevInner));
	const swallowRisk =
		leadIndent > 0 &&
		isListSwallowingFollowingBlock(
			prevNode,
			prevInner,
			rawInner,
			prevWasMatchedAdjacent,
		);
	return { indentedRisk, swallowRisk };
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
		nodesSemanticallyEqual(list.child(0), listNode.child(index))
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

/** Whether `markdown` re-parses to semantically the single edited list node. */
function listMarkdownParsesTo(
	markdown: string,
	listNode: ProseMirrorNode,
	envReferences?: ParsedEnvReferences,
): boolean {
	const doc = parseMarkdownWithBlockSources(markdown, envReferences).doc;
	return (
		doc.childCount === 1 &&
		doc.firstChild !== null &&
		nodesSemanticallyEqual(doc.firstChild, listNode)
	);
}

export type PreparedListPreservation = Readonly<{
	innerRaw: string;
	matched: ReadonlyArray<number>;
	orig: ProseMirrorNode;
	paired: ReadonlyArray<number>;
	slices: ListItemSlices;
}>;

type AuthoritativeListResolution = Readonly<{
	itemReusable: boolean[];
	needsFirstOrderedValidation: boolean;
	output: string | null;
}>;

/**
 * Verifies raw baseline slices and aligns list items once so both liveness
 * analysis and final list serialization reuse one prepared plan.
 */
export function prepareListPreservation(
	listNode: ProseMirrorNode,
	origBlock: ParsedVisualBlockSource,
	depth: number,
	envReferences?: ParsedEnvReferences,
	rawOverride?: string,
): PreparedListPreservation | null {
	const orig = origBlock.node;
	if (!listAttrsCompatible(listNode, orig)) return null;
	const innerRaw =
		rawOverride !== undefined
			? rawOverride
			: origBlock.raw !== null
				? tryStripAllLinesAtDepth(origBlock.raw, depth)
				: null;
	if (innerRaw === null) return null;
	const slices = verifiedListItemSlices(origBlock, envReferences, innerRaw);
	if (!slices) return null;
	const matched = alignNodes(
		childrenOf(listNode),
		childrenOf(orig),
		structurallyEqual,
	);
	const paired = pairUnmatched(matched, orig.childCount);
	return { innerRaw, matched, orig, paired, slices };
}

/**
 * Single authoritative whole-list preservation and first-ordered-marker
 * validation shared by `computeIntactRefDefLabels` and
 * `serializeListPreservingItems`.
 */
export function resolveAuthoritativeListPreservation(
	listNode: ProseMirrorNode,
	prepared: PreparedListPreservation,
	serializeBlock: BlockSerializer,
	envReferences: ParsedEnvReferences | undefined,
	isReusableOrigItem: (origIdx: number) => boolean,
	isPartialTitleRefDef?: PartialTitleRefDefPredicate | null,
	mathNewlineToken?: string,
	buildOutput = true,
): AuthoritativeListResolution {
	const { matched, orig, paired, slices } = prepared;
	const newLen = listNode.childCount;
	const origLen = orig.childCount;
	const loose = isLooseList(listNode);
	const defaultSeparator = slices.separators[1] ?? (loose ? "\n\n" : "\n");
	const itemReusable = new Array<boolean>(newLen);
	for (let idx = 0; idx < newLen; idx += 1) {
		const matchedIdx = matched[idx] ?? -1;
		itemReusable[idx] = matchedIdx >= 0 && isReusableOrigItem(matchedIdx);
	}

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
					: itemReusable[idx]
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
	const firstReused =
		itemReusable[0] === true && firstMatched >= 0
			? slices.items[firstMatched]
			: undefined;
	if (firstReused === undefined) {
		if (newLen > 0) itemReusable[0] = false;
		return {
			itemReusable,
			needsFirstOrderedValidation: false,
			output: buildOutput ? assemble(null) : null,
		};
	}
	const candidates = alignFirstOrderedMarker(listNode, firstReused);
	if (candidates.length === 1 && candidates[0] === firstReused) {
		return {
			itemReusable,
			needsFirstOrderedValidation: false,
			output: buildOutput ? assemble(firstReused) : null,
		};
	}
	for (const candidate of candidates) {
		const output = assemble(candidate);
		const unmasked =
			mathNewlineToken !== undefined
				? restoreMathNewlineSentinel(output, mathNewlineToken)
				: output;
		if (listMarkdownParsesTo(unmasked, listNode, envReferences)) {
			return {
				itemReusable,
				needsFirstOrderedValidation: true,
				output,
			};
		}
	}
	itemReusable[0] = false;
	return {
		itemReusable,
		needsFirstOrderedValidation: false,
		output: buildOutput ? assemble(null) : null,
	};
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
	preparedOverride?: PreparedListPreservation,
): string | null {
	const prepared =
		preparedOverride ??
		prepareListPreservation(listNode, origBlock, 0, envReferences, rawOverride);
	if (!prepared) return null;
	const isReusableOrigItem = (origIdx: number): boolean =>
		origIdx >= 0 && (!canReuseItem || canReuseItem(prepared.orig.child(origIdx)));
	return resolveAuthoritativeListPreservation(
		listNode,
		prepared,
		serializeBlock,
		envReferences,
		isReusableOrigItem,
		isPartialTitleRefDef,
		mathNewlineToken,
		true,
	).output;
}
