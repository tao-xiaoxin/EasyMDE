import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	type PreparedListPreservation,
	prepareListPreservation,
	resolveAuthoritativeListPreservation,
} from "./markdown-list-preservation";
import {
	type BlockSerializer,
	isLooseList,
	serializeListItemAt,
} from "./markdown-list-serialization";
import type { ParsedVisualBlockSource } from "./markdown-parser";
import {
	addListUpstreamLabel,
	type CandidatePartialRefDef,
	discoverSubtree,
	dropListUpstreamLabel,
	firstLineOf,
	type InvalidationTask,
	isBlockContainerForRefDefs,
	isLivePartialLabel,
	type LivenessState,
	nodeHasCurrentInvalidatedRef,
	type PendingListCheck,
	pendingListHeapPop,
	pendingListHeapPush,
	registerNodeDependency,
	visitReferencedLabels,
	walkSubtree,
} from "./markdown-refdef-liveness-state";

/**
 * List planning for the refdef liveness analyzer. Each preservable list
 * registers every refdef inside its items and synchronously evaluates already-
 * non-reusable items BEFORE resolving reuse, so `st.partialTitleRefNodes`
 * matches what the final serializer sees. All Pass-2 list re-validation
 * (first ordered marker, indented-item left-shifts, and the whole-list
 * `allowShift = false` fallback) goes through ONE authoritative
 * `resolveAuthoritativeListPreservation` call per dirty-list drain; dirty
 * lists drain one at a time in true topological order (`liveUpstreamCount`,
 * non-sink before sink, smallest `listNode.nodeSize` first) so multi-wave
 * cascades never re-validate a heavy downstream list per wave.
 */

/**
 * Lazily computed text a preserved nested container emits (its tail decides
 * the following container slot's join); `onChange` is bound by the parent
 * slot and fires when that tail flips from preserved to canonical.
 */
export type TailSource = {
	onChange: (() => void) | null;
	readonly read: () => string;
};

export type DescendResult = Readonly<{
	hasAny: boolean;
	/** Lazily computes line 0 of the preserved container at parent depth. */
	head: (() => string) | null;
	preserved: boolean;
	tail: TailSource | null;
}>;

export type InvalidCheck = ((node: ProseMirrorNode) => boolean) | null;

function createLiveBlockSerializer(st: LivenessState): BlockSerializer {
	const withRefs = st.serializeBlockWithRefs;
	const resolver = st.liveResolver;
	if (!withRefs || !resolver) return st.serializeBlock;
	return (node, mathNewlineToken) => {
		const needsLiveRefs =
			st.subtreeHasCandidates.has(node) ||
			visitReferencedLabels(
				node,
				st.parsed,
				(label) => isLivePartialLabel(st, label),
				true,
			);
		return needsLiveRefs
			? withRefs(node, resolver, mathNewlineToken)
			: st.serializeBlock(node, mathNewlineToken);
	};
}

function resolveListReuse(
	st: LivenessState,
	listNode: ProseMirrorNode,
	prepared: PreparedListPreservation,
	buildOutput: boolean,
): ReturnType<typeof resolveAuthoritativeListPreservation> {
	return resolveAuthoritativeListPreservation(
		listNode,
		prepared,
		createLiveBlockSerializer(st),
		st.parsed.envReferences,
		(origIdx) =>
			!nodeHasCurrentInvalidatedRef(st, prepared.orig.child(origIdx)),
		(node) => st.partialTitleRefNodes.has(node),
		undefined,
		buildOutput,
	);
}

function forEachCandidateIn(
	st: LivenessState,
	parent: ProseMirrorNode,
	visit: (cand: CandidatePartialRefDef) => void,
): void {
	if (!st.subtreeHasCandidates.has(parent)) return;
	const direct = st.candidatesByParent.get(parent);
	if (direct) {
		for (const cand of direct) visit(cand);
	}
	for (let i = 0; i < parent.childCount; i += 1) {
		const child = parent.child(i);
		if (child.childCount > 0 && isBlockContainerForRefDefs(child)) {
			forEachCandidateIn(st, child, visit);
		}
	}
}

function isSinkList(st: LivenessState, check: PendingListCheck): boolean {
	for (const label of check.ownLabels) {
		if ((st.dependentsByLabel.get(label)?.size ?? 0) > 0) return false;
	}
	return true;
}

function markListDirty(st: LivenessState, check: PendingListCheck): void {
	if (!check.tracksValidation || check.heapIndex >= 0) return;
	check.isSink = isSinkList(st, check);
	pendingListHeapPush(st.pendingListHeap, check);
}

/**
 * Attaches an independent per-candidate dirty-list hook for every surviving
 * partial-title candidate inside a canonical item, so distinct candidates
 * invalidated in different waves each re-dirty the enclosing list.
 */
function attachCanonicalCandidateDirtyHooks(
	st: LivenessState,
	check: PendingListCheck,
	itemNode: ProseMirrorNode,
	selfLabels: ReadonlySet<string>,
): void {
	if (!check.tracksValidation) return;
	forEachCandidateIn(st, itemNode, (cand) => {
		if (
			!isLivePartialLabel(st, cand.label) ||
			!st.partialTitleRefNodes.has(cand.refNode)
		) {
			return;
		}
		let set = st.dependentsByLabel.get(cand.label);
		if (!set) {
			set = new Set<InvalidationTask>();
			st.dependentsByLabel.set(cand.label, set);
		}
		set.add({
			fired: false,
			run: () => markListDirty(st, check),
		});
		const nextIdx = cand.refIdx + 1;
		if (nextIdx < cand.parent.childCount) {
			const follower = cand.parent.child(nextIdx);
			const seen = new Set<string>();
			visitReferencedLabels(
				follower,
				st.parsed,
				(label) => {
					if (
						!seen.has(label) &&
						!selfLabels.has(label) &&
						isLivePartialLabel(st, label)
					) {
						seen.add(label);
						addListUpstreamLabel(st, check, label);
					}
					return false;
				},
				true,
			);
		}
	});
}

/**
 * Transitions reused item `itemIdx` to canonical. Canonical evaluation and
 * new dirty hooks run BEFORE the item's verbatim upstream labels are dropped,
 * so `liveUpstreamCount` never falsely dips to `0` and bounces back.
 */
function downgradeListItem(
	st: LivenessState,
	check: PendingListCheck,
	itemIdx: number,
	itemUpstreamLabels: ReadonlyArray<string>,
	selfLabels: ReadonlySet<string>,
): void {
	check.itemReusable[itemIdx] = false;
	if (itemIdx === 0) check.firstEmittedSlice = null;
	const itemNode = check.listNode.child(itemIdx);
	if (st.subtreeHasCandidates.has(itemNode)) {
		walkSubtree(st, itemNode, "canonical", false, false);
		attachCanonicalCandidateDirtyHooks(st, check, itemNode, selfLabels);
	}
	for (let i = 0; i < itemUpstreamLabels.length; i += 1) {
		const label = itemUpstreamLabels[i];
		if (label !== undefined) dropListUpstreamLabel(st, check, label);
	}
	if (itemIdx === check.listNode.childCount - 1) check.notifyTailChange();
}

export function openList(
	st: LivenessState,
	listNode: ProseMirrorNode,
	origBlock: ParsedVisualBlockSource,
	depth: number,
	discover: boolean,
	deferInvalidation: boolean,
): DescendResult {
	const prepared =
		st.plan.lists.get(listNode) ??
		prepareListPreservation(
			listNode,
			origBlock,
			depth,
			st.parsed.envReferences,
		);
	if (!prepared) {
		return {
			hasAny: walkSubtree(
				st,
				listNode,
				"canonical",
				discover,
				deferInvalidation,
			),
			head: null,
			preserved: false,
			tail: null,
		};
	}
	st.plan.lists.set(listNode, prepared);
	const itemCount = listNode.childCount;
	// 1. Discover every refdef across all items in document order BEFORE
	//    resolving reuse.
	const itemHasCands = new Array<boolean>(itemCount);
	let hasAny = false;
	for (let itemIdx = 0; itemIdx < itemCount; itemIdx += 1) {
		const itemNode = listNode.child(itemIdx);
		const has = discover
			? discoverSubtree(st, itemNode)
			: st.subtreeHasCandidates.has(itemNode);
		itemHasCands[itemIdx] = has;
		if (has) hasAny = true;
	}
	// 2. Synchronously evaluate every already-non-reusable item in canonical
	//    mode BEFORE `resolveListReuse`, so broken partial-title refdefs are
	//    already removed from `st.partialTitleRefNodes`.
	const preEvaluatedCanonical = new Array<boolean>(itemCount).fill(false);
	for (let itemIdx = 0; itemIdx < itemCount; itemIdx += 1) {
		const matchedIdx = prepared.matched[itemIdx] ?? -1;
		const preReusable =
			matchedIdx >= 0 &&
			!nodeHasCurrentInvalidatedRef(st, prepared.orig.child(matchedIdx));
		if (!preReusable) {
			walkSubtree(
				st,
				listNode.child(itemIdx),
				"canonical",
				false,
				deferInvalidation,
			);
			preEvaluatedCanonical[itemIdx] = true;
		}
	}

	const resolution = resolveListReuse(st, listNode, prepared, false);
	// One unified Pass-2 re-validation trigger: a reused first ordered item
	// with candidates needing whole-list marker validation, or ANY indented
	// trailing item whose left-shift (and the whole-list `allowShift = false`
	// fallback) depends on every preceding item's emitted form.
	const tracksValidation =
		prepared.hasIndentedTrailingItem ||
		(resolution.needsFirstOrderedValidation &&
			resolution.itemReusable[0] === true &&
			itemHasCands[0] === true);
	const selfLabels = new Set<string>();
	if (tracksValidation) {
		forEachCandidateIn(st, listNode, (cand) => {
			selfLabels.add(cand.label);
		});
	}
	const tail: TailSource = {
		onChange: null,
		read: () => resolveListReuse(st, listNode, prepared, true).output ?? "",
	};
	const itemUpstream = new Array<ReadonlyArray<string>>(itemCount);
	const check: PendingListCheck = {
		downgradeItem: (itemIdx) =>
			downgradeListItem(
				st,
				check,
				itemIdx,
				itemUpstream[itemIdx] ?? [],
				selfLabels,
			),
		firstEmittedSlice: resolution.firstEmittedSlice,
		heapIndex: -1,
		isSink: false,
		itemReusable: resolution.itemReusable,
		itemTasks: new Array<InvalidationTask | undefined>(itemCount),
		listNode,
		liveUpstreamCount: 0,
		notifyTailChange: () => tail.onChange?.(),
		ownLabels: [...selfLabels],
		prepared,
		refCountByUpstreamLabel: new Map<string, number>(),
		tracksValidation,
	};
	const head = (): string => {
		const innerFirst =
			check.itemReusable[0] === true && check.firstEmittedSlice !== null
				? firstLineOf(check.firstEmittedSlice)
				: itemCount > 0
					? firstLineOf(
							serializeListItemAt(
								listNode,
								0,
								isLooseList(listNode),
								createLiveBlockSerializer(st),
								false,
								undefined,
								(node) => st.partialTitleRefNodes.has(node),
							),
						)
					: "";
		if (depth <= 0) return innerFirst;
		return innerFirst.length > 0
			? `${"> ".repeat(depth)}${innerFirst}`
			: `${"> ".repeat(depth - 1)}>`;
	};

	const lastIdx = itemCount - 1;
	for (let itemIdx = 0; itemIdx < itemCount; itemIdx += 1) {
		const itemNode = listNode.child(itemIdx);
		if (check.itemReusable[itemIdx] !== true) {
			if (!preEvaluatedCanonical[itemIdx]) {
				walkSubtree(st, itemNode, "canonical", false, deferInvalidation);
			}
			if (itemHasCands[itemIdx] === true) {
				attachCanonicalCandidateDirtyHooks(st, check, itemNode, selfLabels);
			}
			continue;
		}
		if (discover) {
			walkSubtree(st, itemNode, "verbatim", false, deferInvalidation);
		}
		const origIdx = prepared.matched[itemIdx] ?? -1;
		if (
			origIdx < 0 ||
			!(tracksValidation || itemHasCands[itemIdx] || itemIdx === lastIdx)
		) {
			continue;
		}
		const itemUpstreamLabels: string[] = [];
		if (tracksValidation) {
			const seen = new Set<string>();
			visitReferencedLabels(
				prepared.orig.child(origIdx),
				st.parsed,
				(label) => {
					if (
						!seen.has(label) &&
						!selfLabels.has(label) &&
						isLivePartialLabel(st, label)
					) {
						seen.add(label);
						itemUpstreamLabels.push(label);
						addListUpstreamLabel(st, check, label);
					}
					return false;
				},
			);
		}
		itemUpstream[itemIdx] = itemUpstreamLabels;
		const task: InvalidationTask = {
			fired: false,
			run: () => {
				check.downgradeItem(itemIdx);
				// O(1): defer whole-list re-validation (first ordered marker and
				// indented-item left-shifts) to the prioritized topological drain.
				markListDirty(st, check);
			},
		};
		check.itemTasks[itemIdx] = task;
		registerNodeDependency(st, prepared.orig.child(origIdx), task);
	}
	if (hasAny) st.subtreeHasCandidates.add(listNode);
	return { hasAny, head, preserved: true, tail };
}

/**
 * Pops ONE dirty list in topological priority order (`liveUpstreamCount` first,
 * non-sink before sink, smallest `listNode.nodeSize` first) and re-runs the
 * single authoritative `resolveAuthoritativeListPreservation` (first ordered
 * marker, indented-item left-shifts, and the whole-list `allowShift = false`
 * fallback) ONCE, downgrading every newly non-reusable item. Returns `false`
 * once no list is dirty.
 */
export function drainNextPendingList(st: LivenessState): boolean {
	const heap = st.pendingListHeap;
	while (heap.length > 0) {
		const check = pendingListHeapPop(heap);
		if (check === undefined) break;
		if (!check.isSink && isSinkList(st, check)) {
			check.isSink = true;
			pendingListHeapPush(heap, check);
			continue;
		}
		const prevFirst = check.firstEmittedSlice;
		const recheck = resolveListReuse(st, check.listNode, check.prepared, false);
		check.firstEmittedSlice =
			check.itemReusable[0] === true ? recheck.firstEmittedSlice : null;
		let changed = prevFirst !== check.firstEmittedSlice;
		for (let idx = 0; idx < check.listNode.childCount; idx += 1) {
			if (check.itemReusable[idx] !== true || recheck.itemReusable[idx]) {
				continue;
			}
			changed = true;
			// Drain-driven downgrades reuse the item transition WITHOUT
			// re-dirtying this list: `recheck` already reflects them.
			const task = check.itemTasks[idx];
			if (task) task.fired = true;
			check.downgradeItem(idx);
		}
		if (changed || check.prepared.hasIndentedTrailingItem) {
			check.notifyTailChange();
		}
		return true;
	}
	return false;
}
