import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import type { ContainerAlignmentPlan } from "./markdown-container-preservation";
import { normalizeReferenceLabel } from "./markdown-escape";
import type { PreparedListPreservation } from "./markdown-list-preservation";
import {
	type BlockSerializer,
	isDeferredTaskParagraph,
} from "./markdown-list-serialization";
import {
	extractReferenceDefinitionLabels,
	inspectReferenceDefinitionBlock,
	type ParsedVisualDocument,
	type ReferenceImageOrigin,
	type ReferenceLinkOrigin,
	wouldReferenceDefinitionAbsorbFollowingBlock,
} from "./markdown-parser";
import { firstLine } from "./markdown-prescanner-containers";
import { extractPhpPartialReferenceTitle } from "./markdown-reference-preservation";

/**
 * Shared mutable worklist state, reverse-dependency graph, and subtree
 * candidate traversal for the O(N + E) reference-definition liveness analyzer
 * (`markdown-refdef-liveness.ts`). Container/list planning lives in
 * `markdown-refdef-liveness-containers.ts`.
 */

export type ReferencePreserveResolver = Readonly<{
	isPartialTitleRefDef: (node: ProseMirrorNode) => boolean;
	resolveImage: (node: ProseMirrorNode) => ReferenceImageOrigin | null;
	resolveLink: (mark: Mark) => ReferenceLinkOrigin | null;
}>;

export type BlockWithRefsSerializer = (
	node: ProseMirrorNode,
	resolveReferences: ReferencePreserveResolver | null,
	mathNewlineToken?: string,
) => string;

export type PreservationPlan = Readonly<{
	containers: Map<ProseMirrorNode, ContainerAlignmentPlan>;
	/**
	 * Live per-item liveness reuse mask of each planned list; the serializer
	 * never re-preserves an item liveness transitioned to canonical.
	 */
	listItemReusable: Map<ProseMirrorNode, ReadonlyArray<boolean>>;
	lists: Map<ProseMirrorNode, PreparedListPreservation>;
}>;

export type InvalidationTask = {
	fired: boolean;
	run: () => void;
};

export type CandidatePartialRefDef = Readonly<{
	label: string;
	parent: ProseMirrorNode;
	refIdx: number;
	refNode: ProseMirrorNode;
}>;

/**
 * One preservable list. When `tracksValidation` (a reused first ordered item
 * needing whole-list marker validation, or indented trailing items that may
 * need left-shifting), item tasks only mark it dirty in O(1); the coordinator
 * drains each dirty list in topological upstream-count order after the
 * invalidation queue empties, re-running the single authoritative
 * `resolveAuthoritativeListPreservation` once per drain.
 */
export type PendingListCheck = {
	/** Transitions reused item `itemIdx` to canonical (never re-dirties the list). */
	readonly downgradeItem: (itemIdx: number) => void;
	/** Winning raw slice emitted for reused item 0, or `null` when canonical. */
	firstEmittedSlice: string | null;
	/** Index inside `st.pendingListHeap`, or `-1` when not currently queued. */
	heapIndex: number;
	/** Cached sink status while queued in `st.pendingListHeap`. */
	isSink: boolean;
	readonly itemReusable: boolean[];
	readonly itemTasks: Array<InvalidationTask | undefined>;
	readonly listNode: ProseMirrorNode;
	/**
	 * Count of distinct still-alive external partial-title candidate labels
	 * referenced by tracked items of this list. Lists with `0` remaining
	 * upstream candidate dependencies always pop first (Kahn topological order).
	 */
	liveUpstreamCount: number;
	/** Notifies the parent container slot that the list's emitted tail may have changed. */
	readonly notifyTailChange: () => void;
	/** Partial-title candidate labels declared inside this list's items. */
	readonly ownLabels: ReadonlyArray<string>;
	/**
	 * Count of distinct still-alive upstream labels whose producer list is
	 * currently queued in `st.pendingListHeap`; kept in sync in O(deg) on
	 * every enqueue, dequeue, upstream add/drop, and label invalidation.
	 */
	pendingUpstreamCount: number;
	readonly prepared: PreparedListPreservation;
	readonly refCountByUpstreamLabel: Map<string, number>;
	readonly tracksValidation: boolean;
};

export type LivenessState = Readonly<{
	allIntact: Set<string>;
	candidatesByParent: Map<ProseMirrorNode, CandidatePartialRefDef[]>;
	deferredInvalidatedSet: Set<string>;
	deferredInvalidations: string[];
	dependentsByLabel: Map<string, Set<InvalidationTask>>;
	firstByLabel: ReadonlyMap<string, ProseMirrorNode>;
	invalidatedLabels: Set<string>;
	invalidQueue: string[];
	labelsByNode: ReadonlyMap<ProseMirrorNode, ReadonlyArray<string>>;
	liveResolver: ReferencePreserveResolver | null;
	parsed: ParsedVisualDocument;
	partialLabels: ReadonlySet<string> | undefined;
	partialTitleIntact: Set<string>;
	/** Tasks of slots whose join relied on a lost partial-title refdef. */
	partialTitleLostQueue: InvalidationTask[];
	/**
	 * Re-evaluation tasks of slots whose join / raw-risk prediction relied on
	 * a refdef node still being in `partialTitleRefNodes`; queued by
	 * `removePartialTitleRefNode` and drained with the invalidation queue.
	 */
	partialTitleNodeWaiters: Map<ProseMirrorNode, InvalidationTask[]>;
	partialTitleRefNodes: Set<ProseMirrorNode>;
	pendingListHeap: PendingListCheck[];
	plan: PreservationPlan;
	/** Tracked list whose items declare each partial-title candidate label. */
	producerListByLabel: Map<string, PendingListCheck>;
	seenLabels: Set<string>;
	serializeBlock: BlockSerializer;
	serializeBlockWithRefs: BlockWithRefsSerializer | undefined;
	subtreeHasCandidates: WeakSet<ProseMirrorNode>;
	upstreamListsByLabel: Map<string, Set<PendingListCheck>>;
	watchedCanonicalCandidates: WeakSet<CandidatePartialRefDef>;
}>;

/**
 * Min-heap priority order for dirty lists (exact active-producer topological
 * order):
 * 1. Fewest still-queued upstream producer lists (`pendingUpstreamCount`).
 * 2. Smallest `liveUpstreamCount` first.
 * 3. Non-sink lists before sink lists.
 * 4. Smallest `listNode.nodeSize` (real parse cost) first.
 */
function pendingListBefore(a: PendingListCheck, b: PendingListCheck): boolean {
	if (a.pendingUpstreamCount !== b.pendingUpstreamCount) {
		return a.pendingUpstreamCount < b.pendingUpstreamCount;
	}
	if (a.liveUpstreamCount !== b.liveUpstreamCount) {
		return a.liveUpstreamCount < b.liveUpstreamCount;
	}
	if (a.isSink !== b.isSink) return !a.isSink;
	return a.listNode.nodeSize < b.listNode.nodeSize;
}

function pendingListHeapSiftUp(
	heap: PendingListCheck[],
	startIndex: number,
): void {
	let i = startIndex;
	const item = heap[i];
	if (item === undefined) return;
	while (i > 0) {
		const parent = (i - 1) >> 1;
		const up = heap[parent];
		if (up === undefined || !pendingListBefore(item, up)) break;
		heap[i] = up;
		up.heapIndex = i;
		i = parent;
	}
	heap[i] = item;
	item.heapIndex = i;
}

export function pendingListHeapPush(
	st: LivenessState,
	check: PendingListCheck,
): void {
	const heap = st.pendingListHeap;
	check.heapIndex = heap.length;
	heap.push(check);
	pendingListHeapSiftUp(heap, check.heapIndex);
	adjustDownstreamPendingCounts(st, check, 1);
}

/** Restores the min-heap invariant after `heap[startIndex]` lost priority. */
function pendingListHeapSiftDown(
	heap: PendingListCheck[],
	startIndex: number,
): void {
	let i = startIndex;
	const item = heap[i];
	if (item === undefined) return;
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
			pendingListBefore(rightEntry, leftEntry)
		) {
			child = right;
			childEntry = rightEntry;
		}
		if (childEntry === undefined || !pendingListBefore(childEntry, item)) break;
		heap[i] = childEntry;
		childEntry.heapIndex = i;
		i = child;
	}
	heap[i] = item;
	item.heapIndex = i;
}

export function pendingListHeapPop(
	st: LivenessState,
): PendingListCheck | undefined {
	const heap = st.pendingListHeap;
	const top = heap[0];
	const last = heap.pop();
	if (top === undefined) return undefined;
	top.heapIndex = -1;
	if (last !== undefined && heap.length > 0) {
		heap[0] = last;
		last.heapIndex = 0;
		pendingListHeapSiftDown(heap, 0);
	}
	adjustDownstreamPendingCounts(st, top, -1);
	return top;
}

/** Re-sifts a queued list after its priority counts changed by `delta`. */
function resiftPendingList(
	st: LivenessState,
	check: PendingListCheck,
	delta: number,
): void {
	if (check.heapIndex < 0) return;
	if (delta > 0) pendingListHeapSiftDown(st.pendingListHeap, check.heapIndex);
	else pendingListHeapSiftUp(st.pendingListHeap, check.heapIndex);
}

/**
 * O(deg): `producer` entered (`delta = 1`) or left (`delta = -1`) the heap, so
 * every downstream list watching one of its still-alive own labels gains or
 * loses one queued upstream producer.
 */
function adjustDownstreamPendingCounts(
	st: LivenessState,
	producer: PendingListCheck,
	delta: number,
): void {
	for (const label of producer.ownLabels) {
		if (
			st.invalidatedLabels.has(label) ||
			st.producerListByLabel.get(label) !== producer
		) {
			continue;
		}
		const watchers = st.upstreamListsByLabel.get(label);
		if (!watchers) continue;
		for (const downstream of watchers) {
			if (downstream === producer) continue;
			downstream.pendingUpstreamCount += delta;
			resiftPendingList(st, downstream, delta);
		}
	}
}

/** Whether `label`'s producer list (other than `check`) is currently queued. */
function hasQueuedProducer(
	st: LivenessState,
	check: PendingListCheck,
	label: string,
): boolean {
	const producer = st.producerListByLabel.get(label);
	return (
		producer !== undefined && producer !== check && producer.heapIndex >= 0
	);
}

export function isLivePartialLabel(st: LivenessState, label: string): boolean {
	return (
		Boolean(st.partialLabels?.has(label)) &&
		!st.invalidatedLabels.has(label) &&
		!st.deferredInvalidatedSet.has(label)
	);
}

export function addListUpstreamLabel(
	st: LivenessState,
	check: PendingListCheck,
	label: string,
): void {
	const prev = check.refCountByUpstreamLabel.get(label) ?? 0;
	check.refCountByUpstreamLabel.set(label, prev + 1);
	if (prev === 0) {
		check.liveUpstreamCount += 1;
		let watchers = st.upstreamListsByLabel.get(label);
		if (!watchers) {
			watchers = new Set<PendingListCheck>();
			st.upstreamListsByLabel.set(label, watchers);
		}
		watchers.add(check);
		if (hasQueuedProducer(st, check, label)) check.pendingUpstreamCount += 1;
		resiftPendingList(st, check, 1);
	}
}

export function dropListUpstreamLabel(
	st: LivenessState,
	check: PendingListCheck,
	label: string,
): void {
	const count = check.refCountByUpstreamLabel.get(label);
	if (count === undefined) return;
	if (count > 1) {
		check.refCountByUpstreamLabel.set(label, count - 1);
		return;
	}
	check.refCountByUpstreamLabel.delete(label);
	st.upstreamListsByLabel.get(label)?.delete(check);
	check.liveUpstreamCount -= 1;
	if (hasQueuedProducer(st, check, label)) check.pendingUpstreamCount -= 1;
	resiftPendingList(st, check, -1);
}

function notifyUpstreamLabelInvalidated(
	st: LivenessState,
	label: string,
): void {
	const watchers = st.upstreamListsByLabel.get(label);
	if (!watchers) return;
	st.upstreamListsByLabel.delete(label);
	for (const check of watchers) {
		if (check.refCountByUpstreamLabel.delete(label)) {
			check.liveUpstreamCount -= 1;
			if (hasQueuedProducer(st, check, label)) check.pendingUpstreamCount -= 1;
			resiftPendingList(st, check, -1);
		}
	}
}

export function isBlockContainerForRefDefs(node: ProseMirrorNode): boolean {
	switch (node.type.name) {
		case "blockquote":
		case "bullet_list":
		case "ordered_list":
		case "task_list":
		case "list_item":
		case "task_item":
			return true;
		default:
			return false;
	}
}

export function isRawProtectedBlock(node: ProseMirrorNode): boolean {
	return (
		node.type.name === "protected_block" &&
		node.attrs.kind === "raw" &&
		typeof node.attrs.rawMarkdown === "string"
	);
}

export function isPartialTitleFollowerType(node: ProseMirrorNode): boolean {
	return (
		node.type.name === "paragraph" ||
		node.type.name === "heading" ||
		node.type.name === "table"
	);
}

function canonicalParagraphPreservesPartialTitle(
	st: LivenessState,
	cand: CandidatePartialRefDef,
	nextSibling: ProseMirrorNode,
): boolean {
	if (isDeferredTaskParagraph(cand.parent, cand.refIdx + 1)) return false;
	const refRaw =
		typeof cand.refNode.attrs.rawMarkdown === "string"
			? cand.refNode.attrs.rawMarkdown
			: "";
	const refInfo = inspectReferenceDefinitionBlock(refRaw);
	if (!refInfo.isRefDef || refInfo.lastHasTitle) return false;
	const hasLivePartialRef =
		st.liveResolver !== null &&
		st.serializeBlockWithRefs !== undefined &&
		visitReferencedLabels(
			nextSibling,
			st.parsed,
			(label) => isLivePartialLabel(st, label),
			true,
		);
	const serializedNext =
		hasLivePartialRef && st.serializeBlockWithRefs
			? st.serializeBlockWithRefs(nextSibling, st.liveResolver)
			: st.serializeBlock(nextSibling);
	if (!/^[ \t]*["'(]/.test(firstLine(serializedNext))) return false;
	if (
		wouldReferenceDefinitionAbsorbFollowingBlock(
			refInfo.lastRaw,
			serializedNext,
		)
	) {
		return false;
	}
	const canonicalTitle = extractPhpPartialReferenceTitle(
		serializedNext.split("\n"),
	);
	const expectedTitle = st.parsed.envReferences?.[cand.label]?.title ?? "";
	return (canonicalTitle ?? "") === expectedTitle;
}

/**
 * Visits every baseline reference label used inside `node`. Returning `true`
 * from `visit` stops traversal immediately (used for O(1) short-circuit checks
 * as well as full reverse-edge registration).
 */
export function visitReferencedLabels(
	node: ProseMirrorNode,
	parsed: ParsedVisualDocument,
	visit: (label: string) => boolean,
	isLiveNode = false,
): boolean {
	const blockLabels = parsed.referencedLabelsByNode?.get(node);
	if (blockLabels) {
		for (const label of blockLabels) {
			if (visit(label)) return true;
		}
		if (node.isTextblock) return false;
	}
	if (!isLiveNode && node.isTextblock && parsed.referencedLabelsByNode) {
		return false;
	}
	if (node.type.name === "image") {
		const origin = parsed.referenceImages?.get(node);
		if (origin && visit(origin.normalizedLabel)) return true;
	}
	if (node.marks.length > 0 && parsed.referenceLinks) {
		for (let m = 0; m < node.marks.length; m += 1) {
			const mark = node.marks[m];
			if (mark && mark.type.name === "link") {
				const origin = parsed.referenceLinks.get(mark);
				if (origin && visit(origin.normalizedLabel)) return true;
			}
		}
	}
	if (node.isLeaf) return false;
	for (let i = 0; i < node.childCount; i += 1) {
		if (visitReferencedLabels(node.child(i), parsed, visit, isLiveNode)) {
			return true;
		}
	}
	return false;
}

/**
 * Registers the reference definitions declared by a raw protected block.
 * Returns whether it added a PHP partial-title candidate.
 */
export function registerRefDefNode(
	st: LivenessState,
	parent: ProseMirrorNode,
	childIdx: number,
	child: ProseMirrorNode,
): boolean {
	const origLabels = st.labelsByNode.get(child);
	let addedCandidate = false;
	if (origLabels) {
		for (const label of origLabels) {
			if (st.seenLabels.has(label)) continue;
			st.seenLabels.add(label);
			if (st.firstByLabel.get(label) !== child) continue;
			st.allIntact.add(label);
			if (st.partialLabels?.has(label)) {
				st.partialTitleIntact.add(label);
				st.partialTitleRefNodes.add(child);
				let list = st.candidatesByParent.get(parent);
				if (!list) {
					list = [];
					st.candidatesByParent.set(parent, list);
				}
				list.push({ label, parent, refIdx: childIdx, refNode: child });
				addedCandidate = true;
			}
		}
	} else if (typeof child.attrs.rawMarkdown === "string") {
		const newLabels = extractReferenceDefinitionLabels(child.attrs.rawMarkdown);
		if (newLabels) {
			for (const rawLabel of newLabels) {
				st.seenLabels.add(normalizeReferenceLabel(rawLabel));
			}
		}
	}
	return addedCandidate;
}

/**
 * The ONLY way a refdef leaves `st.partialTitleRefNodes`: every slot whose
 * tight join relied on it being a partial-title refdef is queued for
 * re-evaluation (drained in Pass 2 alongside the invalidation queue).
 */
function removePartialTitleRefNode(
	st: LivenessState,
	node: ProseMirrorNode,
): void {
	if (!st.partialTitleRefNodes.delete(node)) return;
	const waiters = st.partialTitleNodeWaiters.get(node);
	if (waiters === undefined) return;
	st.partialTitleNodeWaiters.delete(node);
	for (const task of waiters) st.partialTitleLostQueue.push(task);
}

/**
 * Registers `task` to re-run once `node` leaves `st.partialTitleRefNodes`.
 * No-op when `node` is not currently a partial-title refdef.
 */
export function watchPartialTitleRefNode(
	st: LivenessState,
	node: ProseMirrorNode,
	task: InvalidationTask,
): void {
	if (!st.partialTitleRefNodes.has(node)) return;
	const waiters = st.partialTitleNodeWaiters.get(node);
	if (waiters === undefined) st.partialTitleNodeWaiters.set(node, [task]);
	else if (!waiters.includes(task)) waiters.push(task);
}

export function scheduleInvalidation(
	st: LivenessState,
	label: string,
	defer: boolean,
): void {
	const refNode = st.firstByLabel.get(label);
	if (refNode) removePartialTitleRefNode(st, refNode);
	if (defer) {
		if (!st.deferredInvalidatedSet.has(label)) {
			st.deferredInvalidatedSet.add(label);
			st.deferredInvalidations.push(label);
		}
		return;
	}
	if (st.invalidatedLabels.has(label)) return;
	st.invalidatedLabels.add(label);
	st.allIntact.delete(label);
	st.partialTitleIntact.delete(label);
	st.invalidQueue.push(label);
	notifyUpstreamLabelInvalidated(st, label);
}

export function fireTask(task: InvalidationTask | undefined): void {
	if (!task || task.fired) return;
	task.fired = true;
	task.run();
}

export function registerNodeDependency(
	st: LivenessState,
	origNode: ProseMirrorNode,
	task: InvalidationTask,
): void {
	visitReferencedLabels(origNode, st.parsed, (label) => {
		let set = st.dependentsByLabel.get(label);
		if (!set) {
			set = new Set<InvalidationTask>();
			st.dependentsByLabel.set(label, set);
		}
		set.add(task);
		return false;
	});
}

export function nodeHasCurrentInvalidatedRef(
	st: LivenessState,
	node: ProseMirrorNode,
): boolean {
	return (
		st.invalidatedLabels.size > 0 &&
		visitReferencedLabels(node, st.parsed, (label) =>
			st.invalidatedLabels.has(label),
		)
	);
}

export function evaluateCandidateCanonical(
	st: LivenessState,
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
		nextIdx < cand.parent.childCount ? cand.parent.child(nextIdx) : null;
	if (
		nextSibling === null ||
		nextSibling.type.name !== "paragraph" ||
		!canonicalParagraphPreservesPartialTitle(st, cand, nextSibling)
	) {
		scheduleInvalidation(st, cand.label, deferInvalidation);
		return;
	}
	if (
		st.liveResolver !== null &&
		st.serializeBlockWithRefs !== undefined &&
		!st.watchedCanonicalCandidates.has(cand)
	) {
		st.watchedCanonicalCandidates.add(cand);
		const seen = new Set<string>();
		visitReferencedLabels(
			nextSibling,
			st.parsed,
			(label) => {
				if (
					label !== cand.label &&
					!seen.has(label) &&
					isLivePartialLabel(st, label)
				) {
					seen.add(label);
					let set = st.dependentsByLabel.get(label);
					if (!set) {
						set = new Set<InvalidationTask>();
						st.dependentsByLabel.set(label, set);
					}
					set.add({
						fired: false,
						run: () => evaluateCandidateCanonical(st, cand, false),
					});
				}
				return false;
			},
			true,
		);
	}
}

/**
 * Registers every refdef inside `parent` in document order (first pass only)
 * and marks subtrees holding partial-title candidates. Returns whether any
 * candidate was added.
 */
export function discoverSubtree(
	st: LivenessState,
	parent: ProseMirrorNode,
): boolean {
	let hasAny = false;
	for (let i = 0; i < parent.childCount; i += 1) {
		const child = parent.child(i);
		if (isRawProtectedBlock(child)) {
			if (registerRefDefNode(st, parent, i, child)) hasAny = true;
		} else if (
			child.childCount > 0 &&
			isBlockContainerForRefDefs(child) &&
			discoverSubtree(st, child)
		) {
			hasAny = true;
		}
	}
	if (hasAny) st.subtreeHasCandidates.add(parent);
	return hasAny;
}

/**
 * Walks a subtree that is emitted entirely verbatim or entirely canonically.
 * `discover` registers refdefs first (first pass); candidate evaluation only
 * revisits subtrees known to hold candidates, keeping every revisit
 * O(subtree).
 */
export function walkSubtree(
	st: LivenessState,
	parent: ProseMirrorNode,
	mode: "verbatim" | "canonical",
	discover: boolean,
	deferInvalidation: boolean,
): boolean {
	const hasAny = discover ? discoverSubtree(st, parent) : false;
	evaluateSubtree(st, parent, mode, deferInvalidation);
	return hasAny;
}

function evaluateSubtree(
	st: LivenessState,
	parent: ProseMirrorNode,
	mode: "verbatim" | "canonical",
	deferInvalidation: boolean,
): void {
	if (!st.subtreeHasCandidates.has(parent)) return;
	for (let i = 0; i < parent.childCount; i += 1) {
		const child = parent.child(i);
		if (child.childCount > 0 && isBlockContainerForRefDefs(child)) {
			evaluateSubtree(st, child, mode, deferInvalidation);
		}
	}
	const directCandidates = st.candidatesByParent.get(parent);
	if (directCandidates) {
		for (const cand of directCandidates) {
			if (mode === "verbatim") {
				const nextIdx = cand.refIdx + 1;
				if (
					nextIdx >= parent.childCount ||
					!isPartialTitleFollowerType(parent.child(nextIdx))
				) {
					scheduleInvalidation(st, cand.label, deferInvalidation);
				}
			} else {
				evaluateCandidateCanonical(st, cand, deferInvalidation);
			}
		}
	}
}
