import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	isNestedList,
	LEADING_FOUR_COLUMN_INDENT,
	nodePreventsFollowingIndentedCode,
	PARAGRAPH_INTERRUPTING_LIST_FIRST_LINE,
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
	matchListMarker,
	measureIndentColumns,
	readBlockquotePrefix,
	stripBlockquoteDepth,
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
	prevWasVerbatimAdjacent: boolean,
): boolean {
	if (!prevNode || prevWasVerbatimAdjacent || !isNestedList(prevNode)) {
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
 */
export function checkRawPreservationRisks(
	child: ProseMirrorNode,
	depth: number,
	rawEmitted: string,
	rawInner: string,
	sep: string,
	prevNode: ProseMirrorNode | null,
	prevInner: string,
	prevWasVerbatimAdjacent: boolean,
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
			prevWasVerbatimAdjacent,
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
