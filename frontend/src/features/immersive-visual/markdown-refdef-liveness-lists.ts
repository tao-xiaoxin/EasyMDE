import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	type PreparedListPreservation,
	prepareListPreservation,
	resolveAuthoritativeListPreservation,
} from "./markdown-container-preservation";
import type { ParsedVisualBlockSource } from "./markdown-parser";
import {
	type CandidatePartialRefDef,
	discoverSubtree,
	fireTask,
	type InvalidationTask,
	isBlockContainerForRefDefs,
	type LivenessState,
	nodeHasCurrentInvalidatedRef,
	type PendingListCheck,
	type PendingListEntry,
	registerNodeDependency,
	walkSubtree,
} from "./markdown-refdef-liveness-state";

/**
 * List planning for the refdef liveness analyzer. Each preservable list
 * registers every refdef inside its items first, then runs the shared
 * authoritative list resolution with exactly the partial-title set the final
 * serializer sees. Trailing items re-validate a reused first ordered item
 * only when item 0 holds partial-title candidates, by marking the list dirty
 * in O(1); dirty lists drain one at a time (smallest non-sink first) so
 * cascading waves never re-validate a large list per wave.
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
	preserved: boolean;
	tail: TailSource | null;
}>;

export type InvalidCheck = ((node: ProseMirrorNode) => boolean) | null;

function resolveListReuse(
	st: LivenessState,
	listNode: ProseMirrorNode,
	prepared: PreparedListPreservation,
	buildOutput: boolean,
): ReturnType<typeof resolveAuthoritativeListPreservation> {
	return resolveAuthoritativeListPreservation(
		listNode,
		prepared,
		st.serializeBlock,
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

// ---------------------------------------------------------------------------
// Dirty-list priority queue: (non-sink before sink, then smallest childCount)
// ---------------------------------------------------------------------------

function isSinkList(st: LivenessState, check: PendingListCheck): boolean {
	for (const label of check.firstLabels) {
		if ((st.dependentsByLabel.get(label)?.size ?? 0) > 0) return false;
	}
	return true;
}

function entryBefore(a: PendingListEntry, b: PendingListEntry): boolean {
	if (a.sink !== b.sink) return !a.sink;
	return a.check.listNode.childCount < b.check.listNode.childCount;
}

function heapPush(heap: PendingListEntry[], entry: PendingListEntry): void {
	heap.push(entry);
	let i = heap.length - 1;
	while (i > 0) {
		const parent = (i - 1) >> 1;
		const up = heap[parent];
		if (up === undefined || !entryBefore(entry, up)) break;
		heap[i] = up;
		i = parent;
	}
	heap[i] = entry;
}

function heapPop(heap: PendingListEntry[]): PendingListEntry | undefined {
	const top = heap[0];
	const last = heap.pop();
	if (top === undefined || last === undefined || heap.length === 0) return top;
	let i = 0;
	while (true) {
		const left = 2 * i + 1;
		if (left >= heap.length) break;
		const right = left + 1;
		const leftEntry = heap[left];
		const rightEntry = heap[right];
		let child = left;
		let childEntry = leftEntry;
		if (
			rightEntry !== undefined &&
			leftEntry !== undefined &&
			entryBefore(rightEntry, leftEntry)
		) {
			child = right;
			childEntry = rightEntry;
		}
		if (childEntry === undefined || !entryBefore(childEntry, last)) break;
		heap[i] = childEntry;
		i = child;
	}
	heap[i] = last;
	return top;
}

function markListDirty(st: LivenessState, check: PendingListCheck): void {
	if (
		check.firstTask === undefined ||
		!check.needsFirstValidation ||
		check.itemReusable[0] !== true ||
		st.pendingListChecks.has(check)
	) {
		return;
	}
	st.pendingListChecks.add(check);
	heapPush(st.pendingListHeap, { check, sink: isSinkList(st, check) });
}

/**
 * A partial-title refdef inside a canonically emitted item changes that
 * item's serialization once invalidated, so it re-dirties the list's
 * first-marker validation exactly like the final serializer would see it.
 */
function watchPartialTitleDefs(
	st: LivenessState,
	check: PendingListCheck,
	itemNode: ProseMirrorNode,
): void {
	if (check.firstTask === undefined || !check.needsFirstValidation) return;
	const task: InvalidationTask = {
		fired: false,
		run: () => markListDirty(st, check),
	};
	forEachCandidateIn(st, itemNode, (cand) => {
		if (st.invalidatedLabels.has(cand.label)) return;
		let set = st.dependentsByLabel.get(cand.label);
		if (!set) {
			set = new Set<InvalidationTask>();
			st.dependentsByLabel.set(cand.label, set);
		}
		set.add(task);
	});
}

function createListItemTask(
	st: LivenessState,
	check: PendingListCheck,
	itemIdx: number,
	itemNode: ProseMirrorNode,
	tail: TailSource,
): InvalidationTask {
	return {
		fired: false,
		run: () => {
			check.itemReusable[itemIdx] = false;
			if (st.subtreeHasCandidates.has(itemNode)) {
				walkSubtree(st, itemNode, "canonical", false, false);
				if (itemIdx > 0) watchPartialTitleDefs(st, check, itemNode);
			}
			// O(1): defer the whole-list first-marker re-validation to one
			// prioritized drain per dirty list instead of re-parsing per item.
			if (itemIdx > 0) markListDirty(st, check);
			if (itemIdx === check.listNode.childCount - 1) tail.onChange?.();
		},
	};
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
	// Register every refdef inside the items BEFORE resolving reuse, so the
	// partial-title set matches the one the final serializer resolves with.
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
	const resolution = resolveListReuse(st, listNode, prepared, false);
	const check: PendingListCheck = {
		firstLabels: [],
		firstTask: undefined,
		itemReusable: resolution.itemReusable,
		listNode,
		needsFirstValidation: resolution.needsFirstOrderedValidation,
		prepared,
	};
	const tail: TailSource = {
		onChange: null,
		read: () => resolveListReuse(st, listNode, prepared, true).output ?? "",
	};
	// Trailing items only matter for re-validating item 0 when item 0 itself
	// holds partial-title candidates whose verbatim/canonical form could flip;
	// the last item is always tracked because it decides the list's tail.
	let tracksFirstItem = false;
	const lastIdx = itemCount - 1;
	for (let itemIdx = 0; itemIdx < itemCount; itemIdx += 1) {
		const itemNode = listNode.child(itemIdx);
		const hasCands = itemHasCands[itemIdx] === true;
		const reusable = check.itemReusable[itemIdx] === true;
		if (!reusable) {
			walkSubtree(st, itemNode, "canonical", false, deferInvalidation);
			continue;
		}
		if (discover) {
			walkSubtree(st, itemNode, "verbatim", false, deferInvalidation);
		}
		if (itemIdx === 0) {
			tracksFirstItem = check.needsFirstValidation && hasCands;
			if (hasCands) {
				forEachCandidateIn(st, itemNode, (cand) => {
					check.firstLabels.push(cand.label);
				});
			}
		}
		const origIdx = prepared.matched[itemIdx] ?? -1;
		if (
			origIdx < 0 ||
			!(hasCands || (itemIdx > 0 && tracksFirstItem) || itemIdx === lastIdx)
		) {
			continue;
		}
		const task = createListItemTask(st, check, itemIdx, itemNode, tail);
		if (itemIdx === 0) check.firstTask = task;
		registerNodeDependency(st, prepared.orig.child(origIdx), task);
	}
	if (tracksFirstItem) {
		for (let itemIdx = 1; itemIdx < itemCount; itemIdx += 1) {
			if (check.itemReusable[itemIdx] !== true && itemHasCands[itemIdx]) {
				watchPartialTitleDefs(st, check, listNode.child(itemIdx));
			}
		}
	}
	if (hasAny) st.subtreeHasCandidates.add(listNode);
	return { hasAny, preserved: true, tail };
}

/**
 * Pops ONE dirty list (non-sink lists before sinks, smallest first) and
 * re-validates its reused first ordered item in O(list), firing item 0's task
 * when it can no longer be reused. Returns `false` once no list is dirty.
 */
export function drainNextPendingList(st: LivenessState): boolean {
	const heap = st.pendingListHeap;
	while (heap.length > 0) {
		const entry = heapPop(heap);
		if (entry === undefined) break;
		const { check } = entry;
		if (!entry.sink && isSinkList(st, check)) {
			heapPush(heap, { check, sink: true });
			continue;
		}
		st.pendingListChecks.delete(check);
		if (!check.needsFirstValidation || check.itemReusable[0] !== true) {
			return true;
		}
		const recheck = resolveListReuse(st, check.listNode, check.prepared, false);
		check.needsFirstValidation = recheck.needsFirstOrderedValidation;
		if (recheck.itemReusable[0] !== true) fireTask(check.firstTask);
		return true;
	}
	return false;
}
