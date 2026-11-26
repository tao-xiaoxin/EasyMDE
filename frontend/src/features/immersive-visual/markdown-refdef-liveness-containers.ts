import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	alignContainerChildren,
	canPreserveContainerHeadStructurally,
	checkRawPreservationRisks,
	createTightSharedGroupChecker,
	leadingIndentAtDepth,
	needsPrevInnerForRiskCheck,
	sharedGroupHasInvalidatedRef,
	stripAtDepth,
} from "./markdown-container-preservation";
import {
	blankSeparatorAtDepth,
	resolveContainerSlotJoin,
} from "./markdown-container-slot-separator";
import { isNestedList } from "./markdown-list-serialization";
import {
	type DescendResult,
	type InvalidCheck,
	openList,
} from "./markdown-refdef-liveness-lists";
import type {
	BuiltVisualBlockSources,
	ParsedVisualBlockSource,
	ParsedVisualSharedGroup,
} from "./markdown-parser";
import {
	type CandidatePartialRefDef,
	evaluateCandidateCanonical,
	fireTask,
	type InvalidationTask,
	isBlockContainerForRefDefs,
	isPartialTitleFollowerType,
	isRawProtectedBlock,
	type LivenessState,
	nodeHasCurrentInvalidatedRef,
	registerNodeDependency,
	registerRefDefNode,
	scheduleInvalidation,
	walkSubtree,
} from "./markdown-refdef-liveness-state";

/**
 * Container (doc / blockquote) planning for the refdef liveness analyzer;
 * nested lists delegate to `markdown-refdef-liveness-lists.ts`. Every slot decision mirrors `serializeContainerPreservingChildren`
 * exactly — separators come from the shared `resolveContainerSlotJoin`, and a
 * container slot inherits its baseline index only when the serializer would
 * actually preserve it — so predicted verbatim spans never diverge from output.
 */

type SlotRisks = Readonly<{
	indentedRisk: boolean;
	separator: string;
	swallowRisk: boolean;
}>;

type SharedGroupChecker = ReturnType<typeof createTightSharedGroupChecker>;

type ContainerState = {
	readonly container: ProseMirrorNode;
	readonly defaultBlankSep: string;
	readonly deferInvalidation: boolean;
	readonly depth: number;
	readonly discover: boolean;
	readonly effectiveOrigIndex: number[];
	readonly groupReverseLinks: Map<number, InvalidationTask[]>;
	readonly groupStartAt: number[];
	readonly groupTasks: Map<number, InvalidationTask>;
	readonly isChildVerbatim: boolean[];
	readonly matchedOrigIndex: ReadonlyArray<number>;
	readonly pairedOrigIndex: ReadonlyArray<number>;
	readonly rawEmitted: Array<string | null>;
	readonly slotCandidates: Map<number, CandidatePartialRefDef[]>;
	readonly slotTasks: Map<number, InvalidationTask>;
	readonly source: BuiltVisualBlockSources;
	hasAny: boolean;
	prevRawEmitted: string | null;
};

function isNextVerbatimTightInContainer(
	cs: ContainerState,
	refIdx: number,
): boolean {
	const nextIdx = refIdx + 1;
	if (cs.isChildVerbatim[nextIdx] !== true) return false;
	const refEffIdx = cs.effectiveOrigIndex[refIdx] ?? -1;
	const nextOrigIdx = cs.matchedOrigIndex[nextIdx] ?? -1;
	if (refEffIdx < 0 || nextOrigIdx !== refEffIdx + 1) return false;
	const refOrig = cs.source.blocks[refEffIdx];
	const nextOrig = cs.source.blocks[nextOrigIdx];
	const nextGroup =
		nextOrig?.sharedGroup?.startIndex === nextOrigIdx
			? nextOrig.sharedGroup
			: undefined;
	const nextSep = nextGroup
		? nextGroup.separatorBefore
		: nextOrig?.separatorBefore;
	return (
		nextSep === "\n" ||
		(refOrig?.sharedGroup !== undefined &&
			refOrig.sharedGroup === nextOrig?.sharedGroup)
	);
}

/**
 * Predicts the serializer's separator and raw-preservation risks for emitting
 * `rawCandidate` at slot `idx`.
 */
function evaluateSlotJoin(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
	rawCandidate: string,
	effIdx: number,
	groupSep: string | undefined,
	prevRawEmitted: string | null,
): SlotRisks {
	const child = cs.container.child(idx);
	const prevNode = idx > 0 ? cs.container.child(idx - 1) : null;
	const origIdx = cs.matchedOrigIndex[idx] ?? -1;
	const prevMatched = idx > 0 ? (cs.matchedOrigIndex[idx - 1] ?? -1) : -1;
	const prevWasMatchedAdjacent =
		prevMatched >= 0 && origIdx >= 0 && origIdx === prevMatched + 1;
	let prevInner: string | null = null;
	const readPrevInner = (): string => {
		if (prevInner === null) {
			prevInner =
				prevRawEmitted !== null
					? stripAtDepth(prevRawEmitted, cs.depth)
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
		prevMatchedIdx: prevMatched,
		prevNode,
		prevWasMatchedAdjacent,
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
		prevWasMatchedAdjacent,
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
		prevWasMatchedAdjacent,
	);
	return { indentedRisk, separator, swallowRisk };
}

function isBrokenTightLeft(
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

function evaluateContainerCandidate(
	st: LivenessState,
	cs: ContainerState,
	cand: CandidatePartialRefDef,
	deferInvalidation: boolean,
): void {
	if (st.invalidatedLabels.has(cand.label)) return;
	const nextIdx = cand.refIdx + 1;
	const nextSibling =
		nextIdx < cs.container.childCount ? cs.container.child(nextIdx) : null;
	if (nextSibling === null || !isPartialTitleFollowerType(nextSibling)) {
		scheduleInvalidation(st, cand.label, deferInvalidation);
		return;
	}
	if (!isNextVerbatimTightInContainer(cs, cand.refIdx)) {
		evaluateCandidateCanonical(st, cand, deferInvalidation);
		return;
	}
	const attach = (slotKey: number): void => {
		let list = cs.slotCandidates.get(slotKey);
		if (!list) {
			list = [];
			cs.slotCandidates.set(slotKey, list);
		}
		list.push(cand);
	};
	const nextGroupStart = cs.groupStartAt[nextIdx] ?? -1;
	const targetSlot = nextGroupStart >= 0 ? nextGroupStart : nextIdx;
	attach(targetSlot);
	const refGroupStart = cs.groupStartAt[cand.refIdx] ?? -1;
	if (refGroupStart >= 0 && refGroupStart !== targetSlot) {
		attach(refGroupStart);
	}
}

function reevaluateAttachedCandidates(
	st: LivenessState,
	cs: ContainerState,
	slotKey: number,
): void {
	const attached = cs.slotCandidates.get(slotKey);
	if (!attached) return;
	for (const cand of attached) {
		evaluateContainerCandidate(st, cs, cand, false);
	}
}

function recheckFollowingIndentRisks(
	st: LivenessState,
	cs: ContainerState,
	changedIdx: number,
): void {
	const nextIdx = changedIdx + 1;
	if (
		nextIdx >= cs.container.childCount ||
		cs.isChildVerbatim[nextIdx] !== true
	) {
		return;
	}
	const nextGroupStart = cs.groupStartAt[nextIdx] ?? -1;
	const nextOrigIdx = cs.matchedOrigIndex[nextIdx] ?? -1;
	const nextOrig = nextOrigIdx >= 0 ? cs.source.blocks[nextOrigIdx] : undefined;
	const nextGroup =
		nextGroupStart === nextIdx ? nextOrig?.sharedGroup : undefined;
	const rawCandidate = nextGroup
		? nextGroup.raw
		: nextOrig && nextOrig.raw !== null
			? nextOrig.raw
			: null;
	if (rawCandidate === null) return;
	const { indentedRisk, separator, swallowRisk } = evaluateSlotJoin(
		st,
		cs,
		nextIdx,
		rawCandidate,
		nextOrigIdx,
		nextGroup?.separatorBefore,
		cs.rawEmitted[changedIdx] ?? null,
	);
	if (nextGroup) {
		if (
			isBrokenTightLeft(cs, nextIdx, nextGroup, separator) ||
			indentedRisk ||
			swallowRisk
		) {
			fireTask(cs.groupTasks.get(nextIdx));
		}
		return;
	}
	if (indentedRisk || swallowRisk) fireTask(cs.slotTasks.get(nextIdx));
}

function descendNonVerbatimChild(
	st: LivenessState,
	child: ProseMirrorNode,
	baseBlock: ParsedVisualBlockSource | undefined,
	depth: number,
	discover: boolean,
	deferInvalidation: boolean,
): DescendResult {
	if (child.childCount === 0 || !isBlockContainerForRefDefs(child)) {
		return { hasAny: false, preserved: false };
	}
	if (
		child.type.name === "blockquote" &&
		baseBlock?.node.type.name === "blockquote"
	) {
		const bqSource = st.parsed.blockquoteSources?.get(baseBlock.node);
		if (bqSource && bqSource.blocks.length === baseBlock.node.childCount) {
			return openContainer(
				st,
				child,
				bqSource,
				depth + 1,
				discover,
				deferInvalidation,
			);
		}
	}
	if (isNestedList(child) && baseBlock && baseBlock.raw !== null) {
		return openList(st, child, baseBlock, depth, discover, deferInvalidation);
	}
	return {
		hasAny: walkSubtree(st, child, "canonical", discover, deferInvalidation),
		preserved: false,
	};
}

function discoverVerbatimChild(
	st: LivenessState,
	cs: ContainerState,
	slot: number,
	child: ProseMirrorNode,
): void {
	if (!cs.discover) return;
	if (isRawProtectedBlock(child)) {
		if (registerRefDefNode(st, cs.container, slot, child)) cs.hasAny = true;
	} else if (
		child.childCount > 0 &&
		isBlockContainerForRefDefs(child) &&
		walkSubtree(st, child, "verbatim", true, cs.deferInvalidation)
	) {
		cs.hasAny = true;
	}
}

function processIntactGroup(
	st: LivenessState,
	cs: ContainerState,
	groupStart: number,
	group: ParsedVisualSharedGroup,
): number {
	const groupLen = group.endIndex - group.startIndex;
	for (let offset = 0; offset < groupLen; offset += 1) {
		const slot = groupStart + offset;
		cs.effectiveOrigIndex[slot] = group.startIndex + offset;
		cs.isChildVerbatim[slot] = true;
		cs.groupStartAt[slot] = groupStart;
		discoverVerbatimChild(st, cs, slot, cs.container.child(slot));
	}
	cs.rawEmitted[groupStart + groupLen - 1] = group.raw;
	cs.prevRawEmitted = group.raw;

	const breakGroupTask: InvalidationTask = {
		fired: false,
		run: () => {
			for (let offset = 0; offset < groupLen; offset += 1) {
				const slot = groupStart + offset;
				cs.isChildVerbatim[slot] = false;
				cs.effectiveOrigIndex[slot] = -1;
				cs.rawEmitted[slot] = null;
				const memberChild = cs.container.child(slot);
				if (
					memberChild.childCount > 0 &&
					isBlockContainerForRefDefs(memberChild) &&
					st.subtreeHasCandidates.has(memberChild)
				) {
					walkSubtree(st, memberChild, "canonical", false, false);
				}
			}
			reevaluateAttachedCandidates(st, cs, groupStart);
			const linked = cs.groupReverseLinks.get(groupStart);
			if (linked) {
				for (const dep of linked) fireTask(dep);
			}
			recheckFollowingIndentRisks(st, cs, groupStart + groupLen - 1);
		},
	};
	cs.groupTasks.set(groupStart, breakGroupTask);
	for (let k = group.startIndex; k < group.endIndex; k += 1) {
		const memberBlock = cs.source.blocks[k];
		if (memberBlock)
			registerNodeDependency(st, memberBlock.node, breakGroupTask);
	}
	return groupStart + groupLen - 1;
}

function processMatchedSlot(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
	origBlock: ParsedVisualBlockSource,
	verbatim: boolean,
): void {
	const child = cs.container.child(idx);
	cs.isChildVerbatim[idx] = verbatim;
	cs.rawEmitted[idx] = verbatim ? origBlock.raw : null;
	cs.prevRawEmitted = verbatim ? origBlock.raw : null;
	if (!verbatim) {
		const result = descendNonVerbatimChild(
			st,
			child,
			origBlock,
			cs.depth,
			cs.discover,
			cs.deferInvalidation,
		);
		if (result.hasAny) cs.hasAny = true;
		return;
	}
	if (
		cs.discover &&
		child.childCount > 0 &&
		isBlockContainerForRefDefs(child) &&
		walkSubtree(st, child, "verbatim", true, cs.deferInvalidation)
	) {
		cs.hasAny = true;
	}
	const breakChildTask: InvalidationTask = {
		fired: false,
		run: () => {
			cs.isChildVerbatim[idx] = false;
			cs.rawEmitted[idx] = null;
			if (
				child.childCount > 0 &&
				isBlockContainerForRefDefs(child) &&
				st.subtreeHasCandidates.has(child)
			) {
				descendNonVerbatimChild(st, child, origBlock, cs.depth, false, false);
			}
			reevaluateAttachedCandidates(st, cs, idx);
			recheckFollowingIndentRisks(st, cs, idx);
		},
	};
	cs.slotTasks.set(idx, breakChildTask);
	registerNodeDependency(st, origBlock.node, breakChildTask);
}

/**
 * Mirrors `serializeContainerPreservingChildren`: an invalidated match keeps
 * its baseline index unless it belongs to a shared group and could not be
 * preserved as a container; a paired slot inherits only when the nested
 * container or list is actually preserved.
 */
function processUnmatchedSlot(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
	origBlock: ParsedVisualBlockSource | undefined,
	origInvalidated: boolean,
): void {
	cs.prevRawEmitted = null;
	const origIdx = cs.matchedOrigIndex[idx] ?? -1;
	const baseIdx =
		origBlock !== undefined ? origIdx : (cs.pairedOrigIndex[idx] ?? -1);
	const baseBlock = baseIdx >= 0 ? cs.source.blocks[baseIdx] : undefined;
	const result = descendNonVerbatimChild(
		st,
		cs.container.child(idx),
		baseBlock,
		cs.depth,
		cs.discover,
		cs.deferInvalidation,
	);
	if (result.hasAny) cs.hasAny = true;
	if (
		(origBlock !== undefined &&
			origInvalidated &&
			(result.preserved || origBlock.sharedGroup === undefined)) ||
		(origBlock === undefined && result.preserved)
	) {
		cs.effectiveOrigIndex[idx] = baseIdx;
	}
}

function processSlot(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
	sharedChecker: SharedGroupChecker,
	invalidCheck: InvalidCheck,
): number {
	const child = cs.container.child(idx);
	const baselineBlocks = cs.source.blocks;
	const origIdx = cs.matchedOrigIndex[idx] ?? -1;
	const origBlock = origIdx >= 0 ? baselineBlocks[origIdx] : undefined;
	const sharedGroup = origBlock?.sharedGroup;
	let intactGroup =
		sharedGroup &&
		origIdx === sharedGroup.startIndex &&
		sharedChecker.isIntactSharedGroupAt(idx, sharedGroup) &&
		sharedChecker.isTightRightNeighborIntact(idx, sharedGroup) &&
		(!invalidCheck ||
			!sharedGroupHasInvalidatedRef(baselineBlocks, sharedGroup, invalidCheck))
			? sharedGroup
			: undefined;
	const origInvalidated = Boolean(origBlock && invalidCheck?.(origBlock.node));
	const plainMatch =
		origBlock !== undefined && !sharedGroup && !origInvalidated;
	let verbatimRisk = false;
	const rawCandidate = intactGroup
		? intactGroup.raw
		: plainMatch && origBlock.raw !== null
			? origBlock.raw
			: null;
	if (rawCandidate !== null) {
		const join = evaluateSlotJoin(
			st,
			cs,
			idx,
			rawCandidate,
			origIdx,
			intactGroup?.separatorBefore,
			cs.prevRawEmitted,
		);
		verbatimRisk = join.indentedRisk || join.swallowRisk;
		if (
			intactGroup &&
			(verbatimRisk || isBrokenTightLeft(cs, idx, intactGroup, join.separator))
		) {
			intactGroup = undefined;
		}
	}
	if (intactGroup) return processIntactGroup(st, cs, idx, intactGroup);

	if (cs.discover && isRawProtectedBlock(child)) {
		if (registerRefDefNode(st, cs.container, idx, child)) cs.hasAny = true;
	}
	if (plainMatch) {
		cs.effectiveOrigIndex[idx] = origIdx;
		processMatchedSlot(
			st,
			cs,
			idx,
			origBlock,
			origBlock.raw !== null && !verbatimRisk,
		);
		return idx;
	}
	processUnmatchedSlot(st, cs, idx, origBlock, origInvalidated);
	return idx;
}

/** Wires tight-left and tight-right inter-group dependencies in O(newLen). */
function wireGroupDependencies(st: LivenessState, cs: ContainerState): void {
	const baselineBlocks = cs.source.blocks;
	const newLen = cs.container.childCount;
	const linkGroupBreak = (
		triggerGroupStart: number,
		dependent: InvalidationTask,
	): void => {
		let list = cs.groupReverseLinks.get(triggerGroupStart);
		if (!list) {
			list = [];
			cs.groupReverseLinks.set(triggerGroupStart, list);
		}
		list.push(dependent);
	};
	for (const [groupStart, breakGroupTask] of cs.groupTasks) {
		const startOrigIdx = cs.matchedOrigIndex[groupStart] ?? -1;
		const group =
			startOrigIdx >= 0 ? baselineBlocks[startOrigIdx]?.sharedGroup : undefined;
		if (!group) continue;
		if (group.separatorBefore === "\n" && groupStart > 0) {
			const leftGroupStart = cs.groupStartAt[groupStart - 1] ?? -1;
			if (leftGroupStart >= 0) linkGroupBreak(leftGroupStart, breakGroupTask);
		}
		const nextOrig = baselineBlocks[group.endIndex];
		if (!nextOrig) continue;
		const nextGroup =
			nextOrig.sharedGroup?.startIndex === group.endIndex
				? nextOrig.sharedGroup
				: undefined;
		const nextSep = nextGroup
			? nextGroup.separatorBefore
			: nextOrig.separatorBefore;
		if (nextSep !== "\n") continue;
		const afterIdx = groupStart + (group.endIndex - group.startIndex);
		if (afterIdx >= newLen) continue;
		if (nextGroup) {
			if (cs.groupTasks.has(afterIdx)) linkGroupBreak(afterIdx, breakGroupTask);
			continue;
		}
		const nextChild = cs.container.child(afterIdx);
		registerNodeDependency(
			st,
			canPreserveContainerHeadStructurally(
				nextChild,
				nextOrig,
				st.parsed.blockquoteSources,
			)
				? nextOrig.node.child(0)
				: nextOrig.node,
			breakGroupTask,
		);
	}
}

/**
 * Plans one container (`doc` at depth 0 or a preservable blockquote), caching
 * its alignment for the serializer and wiring every verbatim slot, shared
 * group, and partial-title candidate into the invalidation graph.
 */
export function openContainer(
	st: LivenessState,
	container: ProseMirrorNode,
	source: BuiltVisualBlockSources,
	depth: number,
	discover: boolean,
	deferInvalidation: boolean,
): DescendResult {
	const baselineBlocks = source.blocks;
	const newLen = container.childCount;
	const alignment =
		st.plan.containers.get(container) ??
		alignContainerChildren(container, baselineBlocks);
	st.plan.containers.set(container, alignment);
	const { matchedOrigIndex, pairedOrigIndex } = alignment;
	const invalidCheck: InvalidCheck = discover
		? null
		: (node) => nodeHasCurrentInvalidatedRef(st, node);
	const sharedChecker = createTightSharedGroupChecker(
		container,
		baselineBlocks,
		matchedOrigIndex,
		pairedOrigIndex,
		st.parsed.blockquoteSources,
		invalidCheck,
	);
	const cs: ContainerState = {
		container,
		defaultBlankSep: blankSeparatorAtDepth(depth),
		deferInvalidation,
		depth,
		discover,
		effectiveOrigIndex: new Array<number>(newLen).fill(-1),
		groupReverseLinks: new Map<number, InvalidationTask[]>(),
		groupStartAt: new Array<number>(newLen).fill(-1),
		groupTasks: new Map<number, InvalidationTask>(),
		hasAny: false,
		isChildVerbatim: new Array<boolean>(newLen).fill(false),
		matchedOrigIndex,
		pairedOrigIndex,
		prevRawEmitted: null,
		rawEmitted: new Array<string | null>(newLen).fill(null),
		slotCandidates: new Map<number, CandidatePartialRefDef[]>(),
		slotTasks: new Map<number, InvalidationTask>(),
		source,
	};
	for (let idx = 0; idx < newLen; idx += 1) {
		idx = processSlot(st, cs, idx, sharedChecker, invalidCheck);
	}
	wireGroupDependencies(st, cs);
	const directCandidates = st.candidatesByParent.get(container);
	if (directCandidates) {
		for (const cand of directCandidates) {
			evaluateContainerCandidate(st, cs, cand, deferInvalidation);
		}
	}
	if (cs.hasAny) st.subtreeHasCandidates.add(container);
	return { hasAny: cs.hasAny, preserved: true };
}
