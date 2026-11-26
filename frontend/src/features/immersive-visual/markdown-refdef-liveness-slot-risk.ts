import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	canPreserveContainerHeadStructurally,
	checkRawPreservationRisks,
	leadingIndentAtDepth,
	needsPrevInnerForRiskCheck,
	stripAtDepth,
} from "./markdown-container-preservation";
import { resolveContainerSlotJoin } from "./markdown-container-slot-separator";
import type {
	BuiltVisualBlockSources,
	ParsedVisualBlockSource,
	ParsedVisualSharedGroup,
} from "./markdown-parser";
import type { TailSource } from "./markdown-refdef-liveness-lists";
import type {
	CandidatePartialRefDef,
	InvalidationTask,
	LivenessState,
} from "./markdown-refdef-liveness-state";

/**
 * Per-container slot state and serializer-parity join / raw-preservation risk
 * prediction for the refdef liveness container planner
 * (`markdown-refdef-liveness-containers.ts`), including the monotonic
 * unedited-head risk-dominance rule shared with
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
	readonly defaultBlankSep: string;
	readonly deferInvalidation: boolean;
	readonly depth: number;
	readonly discover: boolean;
	readonly effectiveOrigIndex: number[];
	readonly groupReverseLinks: Map<number, InvalidationTask[]>;
	readonly groupStartAt: number[];
	readonly groupTasks: Map<number, InvalidationTask>;
	/**
	 * Lazily computes line 0 at `cs.depth` for verbatim or preserved-container
	 * slots (used for `swallowRisk` / `indentedRisk` re-checks); `null` = canonical.
	 */
	readonly headAt: Array<(() => string) | null>;
	/**
	 * Lazily computes the depth-stripped text the serializer emits for each
	 * slot when it is verbatim or a preserved nested container (its tail
	 * decides list-swallow / lazy-continuation joins); `null` = canonical.
	 */
	readonly innerAt: Array<(() => string) | null>;
	readonly keepsTrailingSuffix: boolean;
	readonly matchedOrigIndex: ReadonlyArray<number>;
	readonly pairedOrigIndex: ReadonlyArray<number>;
	/**
	 * Baseline block of a preserved-container slot whose `child 0` is
	 * unedited: its own raw leading line decides `swallowRisk` /
	 * `indentedRisk` monotonically (see `baselineHeadRisk`); `null` otherwise.
	 */
	readonly riskBaseAt: Array<ParsedVisualBlockSource | null>;
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
	const rawInner = stripAtDepth(rawCandidate, cs.depth);
	const { separator } = resolveContainerSlotJoin({
		baselineBlocks: cs.source.blocks,
		child,
		defaultBlankSep: cs.defaultBlankSep,
		effIdx,
		groupSep,
		innerText: rawInner,
		// A tight partial-title join depends on final liveness, which a later
		// invalidation may withdraw; predicting the blank join is conservative.
		isPartialTitleRefDef: null,
		prevEffIdx: idx > 0 ? (cs.effectiveOrigIndex[idx - 1] ?? -1) : -1,
		prevInnerText: readPrevInner,
		prevNode,
		prevWasVerbatimAdjacent,
		serializedIsNull: false,
	});
	const leadIndent = leadingIndentAtDepth(rawCandidate, cs.depth);
	if (leadIndent <= 0) {
		return { indentedRisk: false, separator, swallowRisk: false };
	}
	const prevInnerForRisk = needsPrevInnerForRiskCheck(
		child,
		leadIndent,
		separator,
		prevNode,
		prevWasVerbatimAdjacent,
	)
		? readPrevInner()
		: "";
	const { indentedRisk, swallowRisk } = checkRawPreservationRisks(
		child,
		cs.depth,
		rawCandidate,
		rawInner,
		separator,
		prevNode,
		prevInnerForRisk,
		prevWasVerbatimAdjacent,
	);
	return { indentedRisk, separator, swallowRisk };
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
 * a matched-invalidated or paired container whose `child 0` is unedited
 * (`riskBase`, from `uneditedHeadBase`) goes straight to canonical whenever
 * its baseline raw leading line triggers `swallowRisk || indentedRisk`,
 * independent of the wave in which `child 0` is invalidated.
 */
export function baselineHeadRisk(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
	riskBase: ParsedVisualBlockSource | null,
	effIdx: number,
): boolean {
	if (riskBase === null || riskBase.raw === null) return false;
	const { indentedRisk, swallowRisk } = evaluateSlotJoin(
		st,
		cs,
		idx,
		riskBase.raw,
		effIdx,
		undefined,
	);
	return indentedRisk || swallowRisk;
}

/**
 * Risk check for a `"preserved-container"` slot: its unedited baseline head
 * (monotonic dominance) or, when `child 0` was edited, its emitted head.
 */
export function preservedSlotHasRisk(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
): boolean {
	const effIdx = cs.effectiveOrigIndex[idx] ?? -1;
	const riskBase = cs.riskBaseAt[idx];
	if (riskBase) return baselineHeadRisk(st, cs, idx, riskBase, effIdx);
	const headReader = cs.headAt[idx];
	if (!headReader) return false;
	const { indentedRisk, swallowRisk } = evaluateSlotJoin(
		st,
		cs,
		idx,
		headReader(),
		effIdx,
		undefined,
	);
	return indentedRisk || swallowRisk;
}

/** `base` when `child` keeps its baseline container head (`child 0`). */
export function uneditedHeadBase(
	st: LivenessState,
	child: ProseMirrorNode,
	base: ParsedVisualBlockSource | undefined,
): ParsedVisualBlockSource | null {
	return base !== undefined &&
		base.raw !== null &&
		canPreserveContainerHeadStructurally(
			child,
			base,
			st.parsed.blockquoteSources,
		)
		? base
		: null;
}
