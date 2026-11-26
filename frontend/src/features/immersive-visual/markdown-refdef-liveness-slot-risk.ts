import type { Node as ProseMirrorNode } from "prosemirror-model";
import { evaluateMatchedContainerHeadRisk } from "./markdown-container-head-line";
import type {
	BuiltVisualBlockSources,
	ParsedVisualSharedGroup,
} from "./markdown-parser";
import type { TailSource } from "./markdown-refdef-liveness-lists";
import {
	type CandidatePartialRefDef,
	type InvalidationTask,
	type LivenessState,
	watchPartialTitleRefNode,
} from "./markdown-refdef-liveness-state";

/**
 * Per-container slot state and serializer-parity join / raw-preservation risk
 * prediction for the refdef liveness container planner
 * (`markdown-refdef-liveness-containers.ts`), including the monotonic
 * matched-head-line risk-dominance rule shared with
 * `serializeContainerPreservingChildren`.
 */

export type SlotState = "verbatim" | "preserved-container" | "canonical";

type SlotRisks = Readonly<{
	indentedRisk: boolean;
	separator: string;
	swallowRisk: boolean;
}>;

export type ContainerState = {
	readonly container: ProseMirrorNode;
	/**
	 * Per-slot re-evaluation task run when the previous slot's refdef leaves
	 * `st.partialTitleRefNodes` (its tight partial-title join may vanish).
	 */
	readonly partialTitleRechecks: Array<InvalidationTask | undefined>;
	/** Re-checks slot `idx`'s join / raw risks against the current state. */
	readonly recheckSlot: (idx: number) => void;
	readonly defaultBlankSep: string;
	readonly deferInvalidation: boolean;
	readonly depth: number;
	readonly discover: boolean;
	readonly effectiveOrigIndex: number[];
	readonly groupReverseLinks: Map<number, InvalidationTask[]>;
	readonly groupStartAt: number[];
	readonly groupTasks: Map<number, InvalidationTask>;
	/**
	 * Immutable Pass-1 matched head line of each preserved-container slot
	 * (`resolveMatchedContainerHeadLine`) deciding its `swallowRisk` /
	 * `indentedRisk` re-checks; `null` when `child 0` is emitted canonically.
	 */
	readonly headLineAt: Array<string | null>;
	/**
	 * Lazily computes the depth-stripped text the serializer emits for each
	 * slot when it is verbatim or a preserved nested container (its tail
	 * decides list-swallow / lazy-continuation joins); `null` = canonical.
	 */
	readonly innerAt: Array<(() => string) | null>;
	readonly keepsTrailingSuffix: boolean;
	readonly matchedOrigIndex: ReadonlyArray<number>;
	readonly pairedOrigIndex: ReadonlyArray<number>;
	readonly slotCandidates: Map<number, CandidatePartialRefDef[]>;
	readonly slotState: SlotState[];
	readonly slotTasks: Map<number, InvalidationTask>;
	readonly source: BuiltVisualBlockSources;
	/** This container's own tail as seen by its parent container slot. */
	readonly tail: TailSource;
	readonly tailAt: Array<TailSource | null>;
	hasAny: boolean;
};

/**
 * Predicts the serializer's separator and raw-preservation risks for emitting
 * `rawCandidate` at slot `idx`.
 */
export function evaluateSlotJoin(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
	rawCandidate: string,
	effIdx: number,
	groupSep: string | undefined,
): SlotRisks {
	const child = cs.container.child(idx);
	const prevNode = idx > 0 ? cs.container.child(idx - 1) : null;
	const origIdx = cs.matchedOrigIndex[idx] ?? -1;
	const prevMatched = idx > 0 ? (cs.matchedOrigIndex[idx - 1] ?? -1) : -1;
	// Mirrors the serializer: only a previous slot actually emitted verbatim
	// from its own baseline raw proves the original adjacency still parses.
	const prevWasVerbatimAdjacent =
		idx > 0 &&
		cs.slotState[idx - 1] === "verbatim" &&
		prevMatched >= 0 &&
		origIdx >= 0 &&
		origIdx === prevMatched + 1;
	if (prevNode !== null && st.partialTitleRefNodes.has(prevNode)) {
		// The join may be tight ONLY because `prevNode` is still a partial-title
		// refdef: re-check this slot if it later stops being one.
		let recheck = cs.partialTitleRechecks[idx];
		if (recheck === undefined) {
			recheck = { fired: false, run: () => cs.recheckSlot(idx) };
			cs.partialTitleRechecks[idx] = recheck;
		}
		watchPartialTitleRefNode(st, prevNode, recheck);
	}
	const prevInnerSource = idx > 0 ? (cs.innerAt[idx - 1] ?? null) : null;
	let prevInner: string | null = null;
	const readPrevInner = (): string => {
		if (prevInner === null) {
			prevInner =
				prevInnerSource !== null
					? prevInnerSource()
					: prevNode !== null
						? st.serializeBlock(prevNode)
						: "";
		}
		return prevInner;
	};
	return evaluateMatchedContainerHeadRisk({
		baselineBlocks: cs.source.blocks,
		child,
		defaultBlankSep: cs.defaultBlankSep,
		depth: cs.depth,
		effIdx,
		groupSep,
		headLine: rawCandidate,
		isPartialTitleRefDef: (node) => st.partialTitleRefNodes.has(node),
		prevEffIdx: idx > 0 ? (cs.effectiveOrigIndex[idx - 1] ?? -1) : -1,
		prevInnerText: readPrevInner,
		prevNode,
		prevWasVerbatimAdjacent,
	});
}

export function isBrokenTightLeft(
	cs: ContainerState,
	idx: number,
	group: ParsedVisualSharedGroup,
	separator: string,
): boolean {
	const prevEffIdx = idx > 0 ? (cs.effectiveOrigIndex[idx - 1] ?? -1) : -1;
	return (
		group.separatorBefore === "\n" &&
		(separator !== "\n" || prevEffIdx !== group.startIndex - 1)
	);
}

/**
 * Monotonic risk dominance shared with `serializeContainerPreservingChildren`:
 * a matched-invalidated or paired container goes straight to canonical
 * whenever its immutable Pass-1 matched head line (`headLine`, from
 * `resolveMatchedContainerHeadLine`) triggers `swallowRisk || indentedRisk`,
 * independent of the wave in which any of its references is invalidated.
 */
export function headLineHasRisk(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
	headLine: string | null,
	effIdx: number,
): boolean {
	if (headLine === null) return false;
	const { indentedRisk, swallowRisk } = evaluateSlotJoin(
		st,
		cs,
		idx,
		headLine,
		effIdx,
		undefined,
	);
	return indentedRisk || swallowRisk;
}

/** Re-check for a `"preserved-container"` slot against its matched head line. */
export function preservedSlotHasRisk(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
): boolean {
	return headLineHasRisk(
		st,
		cs,
		idx,
		cs.headLineAt[idx] ?? null,
		cs.effectiveOrigIndex[idx] ?? -1,
	);
}
