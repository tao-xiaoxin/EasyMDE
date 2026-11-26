import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	isNestedList,
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
	type ContainerStep,
	firstLine,
	matchListMarker,
	measureIndentColumns,
	stripBlockquoteDepth,
	stripContainersWithColumn,
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

const BLOCKQUOTE_STEP: ContainerStep = { kind: "blockquote" };

/**
 * Strips exactly `depth` blockquote markers from `line`, returning the
 * remainder and the CommonMark §2.2 / §5.1 virtual column at which it starts.
 * A tab following `>` is expanded to its 4-column stop, one column of which is
 * the marker's optional space (its leftover columns stay in `rest` as virtual
 * spaces), and every later tab expands from the tracked absolute column.
 * `null` when `line` carries fewer than `depth` markers (lazy continuation).
 */
function stripBlockquoteDepthWithColumn(
	line: string,
	depth: number,
): Readonly<{ column: number; rest: string }> | null {
	const steps = new Array<ContainerStep>(depth).fill(BLOCKQUOTE_STEP);
	return stripContainersWithColumn(line, steps);
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
	return stripped !== null
		? measureIndentColumns(stripped.rest, stripped.column)
		: measureIndentColumns(head);
}

/**
 * Computes the CommonMark §5.2 content indentation (relative to the content
 * column at `depth`) of the trailing top-level item in `listEmitted`, the
 * exact emitted text of `listNode` including its `depth` blockquote markers.
 * Every candidate line strips exactly `depth` markers and measures its
 * indent and list marker from the real CommonMark column at which its
 * remainder starts, so tabs before and after the marker expand to their true
 * tab stops. Lazy continuation lines (fewer than `depth` markers) can never
 * open a top-level item at `depth` and are skipped.
 */
function trailingListItemContentIndent(
	listEmitted: string,
	listNode: ProseMirrorNode,
	depth: number,
): number {
	const lines = listEmitted.split("\n");
	if (lines.length === 0) return 0;
	const isOrdered = listNode.type.name === "ordered_list";
	const expectedDelimiter =
		isOrdered && listNode.attrs.delimiter === ")" ? ")" : ".";
	const expectedBullet = isOrdered
		? null
		: sanitizeBulletMarker(listNode.attrs.marker);
	const matchTopItem = (rest: string, column: number): number | null => {
		const marker = matchListMarker(rest, column);
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
		const head = stripBlockquoteDepthWithColumn(lines[0] ?? "", depth);
		return head === null ? 0 : (matchTopItem(head.rest, head.column) ?? 0);
	}
	let currentIndent = -1;
	for (let i = 0; i < lines.length; i += 1) {
		const stripped = stripBlockquoteDepthWithColumn(lines[i] ?? "", depth);
		if (stripped === null) continue;
		const leadCols = measureIndentColumns(stripped.rest, stripped.column);
		if (leadCols > 3 || (currentIndent >= 0 && leadCols >= currentIndent)) {
			continue;
		}
		const matchedIndent = matchTopItem(stripped.rest, stripped.column);
		if (matchedIndent !== null) {
			currentIndent = matchedIndent;
		}
	}
	return currentIndent > 0 ? currentIndent : 0;
}

/**
 * Reports whether the block emitted as `nextEmitted` would be swallowed into
 * the trailing item of an edited or newly adjacent preceding list
 * (`prevNode`, emitted as `prevEmitted()`), even across a blank line
 * (CommonMark §5.2). Both texts are the exact emitted Markdown INCLUDING
 * their `depth` blockquote markers: depth-stripped text loses the column at
 * which its remainder starts, so the list's content indent and the next
 * block's leading indent are both measured column-aware at `depth`.
 */
export function isListSwallowingFollowingBlock(
	prevNode: ProseMirrorNode | null,
	prevEmitted: () => string,
	nextEmitted: string,
	depth: number,
	prevWasVerbatimAdjacent: boolean,
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
			prevEmitted,
			rawEmitted,
			depth,
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
