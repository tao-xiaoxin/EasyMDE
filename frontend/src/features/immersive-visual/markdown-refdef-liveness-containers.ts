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

type SlotState = "verbatim" | "preserved-container" | "canonical";

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
	readonly slotCandidates: Map<number, CandidatePartialRefDef[]>;
	readonly slotState: SlotState[];
	readonly slotTasks: Map<number, InvalidationTask>;
	readonly source: BuiltVisualBlockSources;
	/** This container's own tail as seen by its parent container slot. */
	readonly tail: TailSource;
	readonly tailAt: Array<TailSource | null>;
	hasAny: boolean;
};

function firstLineOf(text: string): string {
	const nl = text.indexOf("\n");
	return nl === -1 ? text : text.slice(0, nl);
}

function prefixOneLevel(text: string): string {
	return text
		.split("\n")
		.map((line) => (line.length > 0 ? `> ${line}` : ">"))
		.join("\n");
}

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
		const headReader = cs.headAt[nextIdx];
		if (!headReader) return;
		const effIdx = cs.effectiveOrigIndex[nextIdx] ?? -1;
		const { indentedRisk, swallowRisk } = evaluateSlotJoin(
			st,
			cs,
			nextIdx,
			headReader(),
			effIdx,
			undefined,
		);
		if (indentedRisk || swallowRisk) fireTask(cs.slotTasks.get(nextIdx));
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
	cs.innerAt[idx] = tail ? tail.read : null;
	cs.tailAt[idx] = tail;
	if (tail) tail.onChange = () => onSlotInnerChanged(st, cs, idx);
}

function verbatimInner(raw: string, depth: number): () => string {
	return () => stripAtDepth(raw, depth);
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
		return { hasAny: false, head: null, preserved: false, tail: null };
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
		head: null,
		preserved: false,
		tail: null,
	};
}

/**
 * Transitions a slot whose nested `blockquote`/`list` returned `preserved: true`
 * into either `"preserved-container"` (with a Pass-2 risk-downgrade task) or
 * immediately into `"canonical"` when `swallowRisk || indentedRisk` already
 * triggers — matching `markdown-block-preservation.ts:468-499`.
 */
function installPreservedContainerSlot(
	st: LivenessState,
	cs: ContainerState,
	idx: number,
	effIdx: number,
	result: DescendResult,
	deferInvalidation: boolean,
): void {
	const child = cs.container.child(idx);
	if (result.head !== null) {
		const { indentedRisk, swallowRisk } = evaluateSlotJoin(
			st,
			cs,
			idx,
			result.head(),
			effIdx,
			undefined,
		);
		if (indentedRisk || swallowRisk) {
			cs.slotState[idx] = "canonical";
			cs.innerAt[idx] = null;
			cs.headAt[idx] = null;
			cs.tailAt[idx] = null;
			if (result.tail) result.tail.onChange = null;
			if (st.subtreeHasCandidates.has(child)) {
				walkSubtree(st, child, "canonical", false, deferInvalidation);
			}
			return;
		}
	}
	cs.slotState[idx] = "preserved-container";
	cs.headAt[idx] = result.head;
	bindNestedTail(st, cs, idx, result.tail);
	const downgradeTask: InvalidationTask = {
		fired: false,
		run: () => {
			if (cs.slotState[idx] !== "preserved-container") return;
			const oldTail = cs.tailAt[idx];
			if (oldTail) oldTail.onChange = null;
			cs.slotState[idx] = "canonical";
			cs.innerAt[idx] = null;
			cs.headAt[idx] = null;
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
	cs.headAt[groupStart] = () => firstLineOf(group.raw);
	cs.innerAt[lastSlot] = verbatimInner(group.raw, cs.depth);

	const breakGroupTask: InvalidationTask = {
		fired: false,
		run: () => {
			for (let offset = 0; offset < groupLen; offset += 1) {
				const slot = groupStart + offset;
				cs.slotState[slot] = "canonical";
				cs.effectiveOrigIndex[slot] = -1;
				cs.innerAt[slot] = null;
				cs.headAt[slot] = null;
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
		cs.innerAt[idx] = null;
		cs.headAt[idx] = null;
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
	cs.innerAt[idx] = verbatimInner(origRaw, cs.depth);
	cs.headAt[idx] = () => firstLineOf(origRaw);
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
			cs.innerAt[idx] = null;
			cs.headAt[idx] = null;
			// An invalidated match is re-preserved as a nested container by the
			// serializer unless swallow/indent risks force canonical fallback; a
			// risk break ALWAYS emits canonically.
			const invalidated = nodeHasCurrentInvalidatedRef(st, origBlock.node);
			if (child.childCount > 0 && isBlockContainerForRefDefs(child)) {
				if (!invalidated) {
					if (st.subtreeHasCandidates.has(child)) {
						walkSubtree(st, child, "canonical", false, false);
					}
				} else {
					const result = descendNonVerbatimChild(
						st,
						child,
						origBlock,
						cs.depth,
						false,
						false,
					);
					if (result.preserved) {
						installPreservedContainerSlot(st, cs, idx, origIdx, result, false);
					}
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
		cs.effectiveOrigIndex[idx] = baseIdx;
		installPreservedContainerSlot(
			st,
			cs,
			idx,
			baseIdx,
			result,
			cs.deferInvalidation,
		);
		return;
	}
	if (
		origBlock !== undefined &&
		origInvalidated &&
		origBlock.sharedGroup === undefined
	) {
		cs.effectiveOrigIndex[idx] = baseIdx;
	}
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
	const headAt = new Array<(() => string) | null>(newLen).fill(null);
	const innerAt = new Array<(() => string) | null>(newLen).fill(null);
	const tailAt = new Array<TailSource | null>(newLen).fill(null);
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
		headAt,
		innerAt,
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
				const lastInner = innerAt[last];
				return prefixOneLevel(
					lastInner ? lastInner() : st.serializeBlock(container.child(last)),
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
	const readHead: (() => string) | null =
		depth > 0
			? () => {
					if (matchedOrigIndex[0] === 0 && source.leadingPrefix.length > 0) {
						return firstLineOf(source.leadingPrefix);
					}
					if (newLen === 0) return "";
					const head0 = headAt[0];
					if (head0) return head0();
					const firstCanonical = firstLineOf(
						st.serializeBlock(container.child(0)),
					);
					return firstCanonical.length > 0
						? `${"> ".repeat(depth)}${firstCanonical}`
						: `${"> ".repeat(depth - 1)}>`;
				}
			: null;
	return { hasAny: cs.hasAny, head: readHead, preserved: true, tail: cs.tail };
}
