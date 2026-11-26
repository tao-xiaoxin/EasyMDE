import type { Node as ProseMirrorNode } from "prosemirror-model";
import { resolveMatchedContainerHeadLine } from "./markdown-container-head-line";
import {
	alignContainerChildren,
	canPreserveContainerHeadStructurally,
	createTightSharedGroupChecker,
	prefixAtDepth,
	sharedGroupHasInvalidatedRef,
	stripAtDepth,
} from "./markdown-container-preservation";
import { blankSeparatorAtDepth } from "./markdown-container-slot-separator";
import { isNestedList } from "./markdown-list-serialization";
import type {
	BuiltVisualBlockSources,
	ParsedVisualBlockSource,
	ParsedVisualSharedGroup,
} from "./markdown-parser";
import {
	type DescendResult,
	type InvalidCheck,
	openList,
	type TailSource,
} from "./markdown-refdef-liveness-lists";
import {
	type ContainerState,
	evaluateSlotJoin,
	headLineHasRisk,
	isBrokenTightLeft,
	preservedSlotHasRisk,
	type SlotState,
} from "./markdown-refdef-liveness-slot-risk";
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
 * nested lists delegate to `markdown-refdef-liveness-lists.ts`. Every slot has
 * one explicit authoritative state (`verbatim` | `preserved-container` |
 * `canonical`) matching `serializeContainerPreservingChildren` exactly —
 * risk fallbacks transition directly to `canonical` for both verbatim and
 * preserved-container slots so predicted verbatim spans never diverge from
 * final serialized output.
 */

type SharedGroupChecker = ReturnType<typeof createTightSharedGroupChecker>;

function isNextVerbatimTightInContainer(
	cs: ContainerState,
	refIdx: number,
): boolean {
	const nextIdx = refIdx + 1;
	if (cs.slotState[nextIdx] !== "verbatim") return false;
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

function evaluateContainerCandidate(
	st: LivenessState,
	cs: ContainerState,
	cand: CandidatePartialRefDef,
	deferInvalidation: boolean,
): void {
	if (
		st.invalidatedLabels.has(cand.label) ||
		st.deferredInvalidatedSet.has(cand.label)
	) {
		return;
	}
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
	if (nextIdx >= cs.container.childCount) return;
	const nextState = cs.slotState[nextIdx];
	if (nextState === "canonical") return;
	if (nextState === "preserved-container") {
		if (preservedSlotHasRisk(st, cs, nextIdx)) {
			fireTask(cs.slotTasks.get(nextIdx));
		}
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

/**
 * Slot `idx`'s emitted text changed (verbatim -> preserved-container/canonical,
 * preserved-container -> canonical, or its preserved nested container's tail
 * flipped): re-evaluate the following slot and, when `idx` is this container's
 * tail, propagate to the parent container slot.
 */
function onSlotInnerChanged(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
): void {
	recheckFollowingIndentRisks(st, cs, idx);
	if (idx === cs.container.childCount - 1 && !cs.keepsTrailingSuffix) {
		cs.tail.onChange?.();
	}
}

/** Records a nested container's preserved tail for slot `idx`. */
function bindNestedTail(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
	tail: TailSource | null,
): void {
	cs.emittedAt[idx] = tail ? () => prefixAtDepth(tail.read(), cs.depth) : null;
	cs.tailAt[idx] = tail;
	if (tail) tail.onChange = () => onSlotInnerChanged(st, cs, idx);
}

function verbatimEmitted(raw: string): () => string {
	return () => raw;
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
		return { hasAny: false, preserved: false, tail: null };
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
		tail: null,
	};
}

/**
 * Effective baseline index the serializer keeps for a slot that falls back to
 * canonical after attempting nested preservation: only a matched block outside
 * any shared group inherits its baseline index (a paired or shared-group slot
 * inherits nothing), mirroring `serializeContainerPreservingChildren`.
 */
function canonicalEffectiveOrigIndex(cs: ContainerState, idx: number): number {
	const matchedIdx = cs.matchedOrigIndex[idx] ?? -1;
	return matchedIdx >= 0 &&
		cs.source.blocks[matchedIdx]?.sharedGroup === undefined
		? matchedIdx
		: -1;
}

/**
 * Transitions a slot whose nested `blockquote`/`list` returned `preserved: true`
 * into `"preserved-container"` with a Pass-2 risk-downgrade task, matching
 * `serializeContainerPreservingChildren`. Callers have already rejected a
 * risky immutable matched head line (`headLine`).
 */
function installPreservedContainerSlot(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
	effIdx: number,
	result: DescendResult,
	headLine: string | null,
): void {
	const child = cs.container.child(idx);
	cs.headLineAt[idx] = headLine;
	cs.effectiveOrigIndex[idx] = effIdx;
	cs.slotState[idx] = "preserved-container";
	bindNestedTail(st, cs, idx, result.tail);
	const downgradeTask: InvalidationTask = {
		fired: false,
		run: () => {
			if (cs.slotState[idx] !== "preserved-container") return;
			const oldTail = cs.tailAt[idx];
			if (oldTail) oldTail.onChange = null;
			cs.slotState[idx] = "canonical";
			// A paired (or shared-group) slot emitted canonically no longer
			// inherits its paired baseline index, so the following slot's
			// tight-left / inherited-separator checks see the real join.
			cs.effectiveOrigIndex[idx] = canonicalEffectiveOrigIndex(cs, idx);
			cs.emittedAt[idx] = null;
			cs.headLineAt[idx] = null;
			cs.tailAt[idx] = null;
			if (st.subtreeHasCandidates.has(child)) {
				walkSubtree(st, child, "canonical", false, false);
			}
			reevaluateAttachedCandidates(st, cs, idx);
			onSlotInnerChanged(st, cs, idx);
		},
	};
	cs.slotTasks.set(idx, downgradeTask);
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
		cs.slotState[slot] = "verbatim";
		cs.groupStartAt[slot] = groupStart;
		discoverVerbatimChild(st, cs, slot, cs.container.child(slot));
	}
	const lastSlot = groupStart + groupLen - 1;
	cs.emittedAt[lastSlot] = verbatimEmitted(group.raw);

	const breakGroupTask: InvalidationTask = {
		fired: false,
		run: () => {
			for (let offset = 0; offset < groupLen; offset += 1) {
				const slot = groupStart + offset;
				cs.slotState[slot] = "canonical";
				cs.effectiveOrigIndex[slot] = -1;
				cs.emittedAt[slot] = null;
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
			onSlotInnerChanged(st, cs, lastSlot);
		},
	};
	cs.groupTasks.set(groupStart, breakGroupTask);
	for (let k = group.startIndex; k < group.endIndex; k += 1) {
		const memberBlock = cs.source.blocks[k];
		if (memberBlock) {
			registerNodeDependency(st, memberBlock.node, breakGroupTask);
		}
	}
	return lastSlot;
}

function processMatchedSlot(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
	origBlock: ParsedVisualBlockSource,
	verbatim: boolean,
): void {
	const child = cs.container.child(idx);
	if (!verbatim || origBlock.raw === null) {
		// Risk fallback or null-raw plain match: serializer emits canonical
		// directly (`ensureGenerated()`), NEVER nested container preservation.
		cs.slotState[idx] = "canonical";
		cs.emittedAt[idx] = null;
		if (
			child.childCount > 0 &&
			isBlockContainerForRefDefs(child) &&
			walkSubtree(st, child, "canonical", cs.discover, cs.deferInvalidation)
		) {
			cs.hasAny = true;
		}
		return;
	}
	const origRaw = origBlock.raw;
	cs.slotState[idx] = "verbatim";
	cs.emittedAt[idx] = verbatimEmitted(origRaw);
	if (
		cs.discover &&
		child.childCount > 0 &&
		isBlockContainerForRefDefs(child) &&
		walkSubtree(st, child, "verbatim", true, cs.deferInvalidation)
	) {
		cs.hasAny = true;
	}
	const origIdx = cs.matchedOrigIndex[idx] ?? -1;
	const breakChildTask: InvalidationTask = {
		fired: false,
		run: () => {
			cs.slotState[idx] = "canonical";
			cs.emittedAt[idx] = null;
			// An invalidated match is re-preserved as a nested container by the
			// serializer unless its immutable matched head line is risky; a
			// risk break ALWAYS emits canonically (monotonic).
			if (child.childCount > 0 && isBlockContainerForRefDefs(child)) {
				const headLine = resolveMatchedContainerHeadLine(
					child,
					origBlock,
					cs.depth,
					st.plan,
					st.parsed,
				);
				if (
					nodeHasCurrentInvalidatedRef(st, origBlock.node) &&
					!headLineHasRisk(st, cs, idx, headLine, origIdx)
				) {
					const result = descendNonVerbatimChild(
						st,
						child,
						origBlock,
						cs.depth,
						false,
						false,
					);
					if (result.preserved) {
						installPreservedContainerSlot(
							st,
							cs,
							idx,
							origIdx,
							result,
							headLine,
						);
					}
				} else if (st.subtreeHasCandidates.has(child)) {
					walkSubtree(st, child, "canonical", false, false);
				}
			}
			reevaluateAttachedCandidates(st, cs, idx);
			onSlotInnerChanged(st, cs, idx);
		},
	};
	cs.slotTasks.set(idx, breakChildTask);
	registerNodeDependency(st, origBlock.node, breakChildTask);
}

/**
 * Mirrors `serializeContainerPreservingChildren`: only an invalidated match or
 * an unmatched (paired) slot attempts nested container/list preservation (and
 * even then falls back to canonical if swallow/indent risks trigger); a broken
 * non-invalidated shared-group member goes straight to canonical.
 */
function processUnmatchedSlot(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
	origBlock: ParsedVisualBlockSource | undefined,
	origInvalidated: boolean,
): void {
	const child = cs.container.child(idx);
	if (origBlock !== undefined && !origInvalidated) {
		cs.slotState[idx] = "canonical";
		if (
			child.childCount > 0 &&
			isBlockContainerForRefDefs(child) &&
			walkSubtree(st, child, "canonical", cs.discover, cs.deferInvalidation)
		) {
			cs.hasAny = true;
		}
		return;
	}
	const origIdx = cs.matchedOrigIndex[idx] ?? -1;
	const baseIdx =
		origBlock !== undefined ? origIdx : (cs.pairedOrigIndex[idx] ?? -1);
	const baseBlock = baseIdx >= 0 ? cs.source.blocks[baseIdx] : undefined;
	const headLine = resolveMatchedContainerHeadLine(
		child,
		baseBlock,
		cs.depth,
		st.plan,
		st.parsed,
	);
	if (headLineHasRisk(st, cs, idx, headLine, baseIdx)) {
		cs.effectiveOrigIndex[idx] = canonicalEffectiveOrigIndex(cs, idx);
		cs.slotState[idx] = "canonical";
		if (
			walkSubtree(st, child, "canonical", cs.discover, cs.deferInvalidation)
		) {
			cs.hasAny = true;
		}
		return;
	}
	const result = descendNonVerbatimChild(
		st,
		child,
		baseBlock,
		cs.depth,
		cs.discover,
		cs.deferInvalidation,
	);
	if (result.hasAny) cs.hasAny = true;
	if (result.preserved) {
		installPreservedContainerSlot(st, cs, idx, baseIdx, result, headLine);
		return;
	}
	cs.effectiveOrigIndex[idx] = canonicalEffectiveOrigIndex(cs, idx);
	cs.slotState[idx] = "canonical";
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
 * group, preserved nested container, and partial-title candidate into the
 * invalidation graph.
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
	const keepsTrailingSuffix =
		newLen > 0 &&
		source.trailingSuffix.length > 0 &&
		(baselineBlocks.length === 1 ||
			matchedOrigIndex.some((origIdx) => origIdx >= 0));
	const emittedAt = new Array<(() => string) | null>(newLen).fill(null);
	const tailAt = new Array<TailSource | null>(newLen).fill(null);
	const cs: ContainerState = {
		container,
		partialTitleRechecks: new Array<InvalidationTask | undefined>(newLen),
		recheckSlot: (idx) => {
			if (idx > 0) recheckFollowingIndentRisks(st, cs, idx - 1);
		},
		defaultBlankSep: blankSeparatorAtDepth(depth),
		deferInvalidation,
		depth,
		discover,
		effectiveOrigIndex: new Array<number>(newLen).fill(-1),
		groupReverseLinks: new Map<number, InvalidationTask[]>(),
		groupStartAt: new Array<number>(newLen).fill(-1),
		groupTasks: new Map<number, InvalidationTask>(),
		hasAny: false,
		headLineAt: new Array<string | null>(newLen).fill(null),
		emittedAt,
		keepsTrailingSuffix,
		matchedOrigIndex,
		pairedOrigIndex,
		slotCandidates: new Map<number, CandidatePartialRefDef[]>(),
		slotState: new Array<SlotState>(newLen).fill("canonical"),
		slotTasks: new Map<number, InvalidationTask>(),
		source,
		tail: {
			onChange: null,
			// Parent-depth view of this blockquote's emitted tail: a kept
			// trailing suffix (e.g. a blank `>` line) or its last slot.
			read: () => {
				if (keepsTrailingSuffix) {
					return stripAtDepth(source.trailingSuffix, depth - 1);
				}
				const last = newLen - 1;
				if (last < 0) return "";
				const lastEmitted = emittedAt[last];
				return prefixAtDepth(
					lastEmitted
						? stripAtDepth(lastEmitted(), depth)
						: st.serializeBlock(container.child(last)),
					1,
				);
			},
		},
		tailAt,
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
	return { hasAny: cs.hasAny, preserved: true, tail: cs.tail };
}
