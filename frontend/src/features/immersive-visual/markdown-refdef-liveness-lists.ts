import type { Node as ProseMirrorNode } from "prosemirror-model";
import { emitWithMathSentinelAtDepth } from "./markdown-container-preservation";
import {
	type PreparedListPreservation,
	prepareListPreservation,
	resolveAuthoritativeListPreservation,
} from "./markdown-list-preservation";
import type { BlockSerializer } from "./markdown-list-serialization";
import type { ParsedVisualBlockSource } from "./markdown-parser";
import {
	addListUpstreamLabel,
	type CandidatePartialRefDef,
	discoverSubtree,
	dropListUpstreamLabel,
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
 * `allowShift = false` fallback) goes through the authoritative
 * `resolveAuthoritativeListPreservation`, stabilizing intrinsically
 * non-reusable items, then trailing `allowShift = false` fallback items (and
 * their partial-title refdefs), BEFORE committing a non-reusable item 0;
 * dirty lists drain one at a time in exact active-producer topological order
 * (`pendingUpstreamCount`, `liveUpstreamCount`, non-sink before sink, smallest
 * `listNode.nodeSize` first) so multi-wave cascades never re-validate a heavy
 * downstream list per wave.
 */

/**
 * Lazily computed exact text a preserved nested container emits at its parent
 * container's depth (all quote markers included, multiline math newlines
 * unprefixed; its tail decides the following container slot's join);
 * `onChange` is bound by the parent slot and fires when that tail flips from
 * preserved to canonical.
 */
export type TailSource = {
	onChange: (() => void) | null;
	readonly read: () => string;
};

export type DescendResult = Readonly<{
	hasAny: boolean;
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
	isDowngraded: (itemIdx: number) => boolean,
	mathNewlineToken?: string,
): ReturnType<typeof resolveAuthoritativeListPreservation> {
	return resolveAuthoritativeListPreservation(
		listNode,
		prepared,
		createLiveBlockSerializer(st),
		st.parsed.envReferences,
		// Monotonic: an item liveness already transitioned to canonical never
		// resurrects, whatever later re-validation would allow.
		(origIdx, itemIdx) =>
			!isDowngraded(itemIdx) &&
			!nodeHasCurrentInvalidatedRef(st, prepared.orig.child(origIdx)),
		(node) => st.partialTitleRefNodes.has(node),
		mathNewlineToken,
		buildOutput,
	);
}

/** Lazily built list-local inverted index: referenced label -> item indices. */
function buildItemRefIndex(
	st: LivenessState,
	prepared: PreparedListPreservation,
): Map<string, number[]> {
	const index = new Map<string, number[]>();
	for (let idx = 0; idx < prepared.matched.length; idx += 1) {
		const origIdx = prepared.matched[idx] ?? -1;
		if (origIdx < 0) continue;
		visitReferencedLabels(prepared.orig.child(origIdx), st.parsed, (label) => {
			const items = index.get(label);
			if (items === undefined) index.set(label, [idx]);
			else if (items[items.length - 1] !== idx) items.push(idx);
			return false;
		});
	}
	return index;
}

/**
 * Resolves list reuse to a monotonic fixed point. Each round runs ONE
 * authoritative resolution and commits the first non-empty stage:
 *
 * 1. every INTRINSICALLY non-reusable item (any index; item 0 only when no
 *    first-marker candidate re-parses to it in isolation);
 * 2. trailing items (`idx >= 1`) failing the whole-list `allowShift = false`
 *    fallback, which may be what still blocks a locally valid item 0;
 * 3. only then a non-reusable item 0.
 *
 * Any committed downgrade re-runs the resolution (it may shrink
 * `st.partialTitleRefNodes` or change canonical emission). With immediate
 * invalidation, each batch first closes same-list label invalidations in
 * O(K) through a list-local inverted index (an item referencing a freshly
 * invalidated label is non-reusable for good), so a same-list refdef chain
 * costs O(1) resolutions instead of one whole-list parse per hop. Each item
 * downgrades at most once and never resurrects (`isDowngraded`).
 */
function resolveStableListReuse(
	st: LivenessState,
	listNode: ProseMirrorNode,
	prepared: PreparedListPreservation,
	isDowngraded: (itemIdx: number) => boolean,
	downgrade: (itemIdx: number) => void,
	deferInvalidation: boolean,
): ReturnType<typeof resolveListReuse> {
	const itemCount = listNode.childCount;
	let refIndex: Map<string, number[]> | null = null;
	const closeSameListInvalidations = (queueFrom: number): void => {
		for (let head = queueFrom; head < st.invalidQueue.length; head += 1) {
			const label = st.invalidQueue[head];
			if (label === undefined) continue;
			refIndex ??= buildItemRefIndex(st, prepared);
			const items = refIndex.get(label);
			if (items === undefined) continue;
			for (const idx of items) {
				if (!isDowngraded(idx)) downgrade(idx);
			}
		}
	};
	const commit = (idx: number): boolean => {
		if (isDowngraded(idx)) return false;
		const queueFrom = st.invalidQueue.length;
		downgrade(idx);
		if (!deferInvalidation) closeSameListInvalidations(queueFrom);
		return true;
	};
	while (true) {
		const resolution = resolveListReuse(
			st,
			listNode,
			prepared,
			false,
			isDowngraded,
		);
		// Downgrading items the resolution already emits canonically leaves it
		// valid; only a change to partial-title or invalidated-label state
		// forces a fresh resolution. Once item 0 is committed, only indented
		// trailing items (left-shifts and their fallback) depend on its text.
		const partialSize = st.partialTitleRefNodes.size;
		const invalidCount = st.invalidQueue.length;
		const deferredCount = st.deferredInvalidations.length;
		const stateChanged = (): boolean =>
			st.partialTitleRefNodes.size !== partialSize ||
			st.invalidQueue.length !== invalidCount ||
			st.deferredInvalidations.length !== deferredCount;
		for (let idx = 0; idx < itemCount; idx += 1) {
			if (resolution.intrinsicItemReusable[idx] !== true) commit(idx);
		}
		if (stateChanged()) continue;
		for (let idx = 1; idx < itemCount; idx += 1) {
			if (resolution.itemReusable[idx] !== true) commit(idx);
		}
		if (stateChanged()) continue;
		if (
			itemCount > 0 &&
			resolution.itemReusable[0] !== true &&
			commit(0) &&
			prepared.hasIndentedTrailingItem &&
			(stateChanged() || resolution.intrinsicItemReusable[0] === true)
		) {
			continue;
		}
		return resolution;
	}
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
	pendingListHeapPush(st, check);
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
	// Marked BEFORE collecting `selfLabels`, which `forEachCandidateIn` reads.
	if (hasAny) st.subtreeHasCandidates.add(listNode);
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

	// 3. Stabilize intrinsically non-reusable items, then trailing
	//    `allowShift = false` fallback items (and their partial-title
	//    refdefs), then item 0; every downgraded item is evaluated
	//    canonically once and never resurrects.
	const resolution = resolveStableListReuse(
		st,
		listNode,
		prepared,
		(itemIdx) => preEvaluatedCanonical[itemIdx] === true,
		(itemIdx) => {
			preEvaluatedCanonical[itemIdx] = true;
			walkSubtree(
				st,
				listNode.child(itemIdx),
				"canonical",
				false,
				deferInvalidation,
			);
		},
		deferInvalidation,
	);
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
		// Same `emitWithMathSentinelAtDepth` emission as the serializer's
		// `tryPreserveListAtDepth`, so `emittedAt` equals `prevEmittedText`.
		read: () =>
			emitWithMathSentinelAtDepth(
				listNode,
				depth,
				(token) =>
					resolveListReuse(
						st,
						listNode,
						prepared,
						true,
						(idx) => check.itemReusable[idx] !== true,
						token,
					).output ?? "",
			),
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
		firstEmittedSlice:
			resolution.itemReusable[0] === true ? resolution.firstEmittedSlice : null,
		heapIndex: -1,
		isSink: false,
		itemReusable: resolution.itemReusable,
		itemTasks: new Array<InvalidationTask | undefined>(itemCount),
		listNode,
		liveUpstreamCount: 0,
		notifyTailChange: () => tail.onChange?.(),
		ownLabels: [...selfLabels],
		pendingUpstreamCount: 0,
		prepared,
		refCountByUpstreamLabel: new Map<string, number>(),
		tracksValidation,
	};
	for (const label of selfLabels) st.producerListByLabel.set(label, check);
	// The serializer never re-preserves an item liveness emitted canonically.
	st.plan.listItemReusable.set(listNode, check.itemReusable);

	const lastIdx = itemCount - 1;
	for (let itemIdx = 0; itemIdx < itemCount; itemIdx += 1) {
		const itemNode = listNode.child(itemIdx);
		if (check.itemReusable[itemIdx] !== true) {
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
	return { hasAny, preserved: true, tail };
}

/**
 * Pops ONE dirty list in topological priority order (`pendingUpstreamCount`,
 * `liveUpstreamCount`, non-sink before sink, smallest `listNode.nodeSize`)
 * and re-runs the authoritative `resolveAuthoritativeListPreservation`
 * (first ordered marker, indented-item left-shifts, and the whole-list
 * `allowShift = false` fallback) through the same staged fixed point as
 * `openList`. Returns `false` once no list is dirty.
 */
export function drainNextPendingList(st: LivenessState): boolean {
	while (st.pendingListHeap.length > 0) {
		const check = pendingListHeapPop(st);
		if (check === undefined) break;
		if (!check.isSink && isSinkList(st, check)) {
			check.isSink = true;
			pendingListHeapPush(st, check);
			continue;
		}
		const prevFirst = check.firstEmittedSlice;
		let changed = false;
		const recheck = resolveStableListReuse(
			st,
			check.listNode,
			check.prepared,
			(idx) => check.itemReusable[idx] !== true,
			(idx) => {
				changed = true;
				// Drain-driven downgrades reuse the item transition WITHOUT
				// re-dirtying this list: the stabilized `recheck` reflects them.
				const task = check.itemTasks[idx];
				if (task) task.fired = true;
				check.downgradeItem(idx);
			},
			false,
		);
		check.firstEmittedSlice =
			check.itemReusable[0] === true ? recheck.firstEmittedSlice : null;
		if (prevFirst !== check.firstEmittedSlice) changed = true;
		if (changed || check.prepared.hasIndentedTrailingItem) {
			check.notifyTailChange();
		}
		return true;
	}
	return false;
}
