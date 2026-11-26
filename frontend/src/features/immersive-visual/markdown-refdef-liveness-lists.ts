import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	listItemContentIndent,
	type PreparedListPreservation,
	prepareListPreservation,
	resolveAuthoritativeListPreservation,
	tryLeftShiftReusableItem,
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
	fireTask,
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
 * matches what the final serializer sees. Dirty lists drain one at a time in
 * true topological order (`liveUpstreamCount`, non-sink before sink, smallest
 * `listNode.nodeSize` first) so multi-wave cascades never re-validate a heavy
 * downstream list per wave.
 */

const BLANK_BEFORE_NESTED_LIST =
	/\n[ \t]*\n[ \t]+(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

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

function firstLineOf(text: string): string {
	const nl = text.indexOf("\n");
	return nl === -1 ? text : text.slice(0, nl);
}

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
	for (const label of check.firstLabels) {
		if ((st.dependentsByLabel.get(label)?.size ?? 0) > 0) return false;
	}
	return true;
}

function markListDirty(st: LivenessState, check: PendingListCheck): void {
	if (
		check.firstTask === undefined ||
		!check.needsFirstValidation ||
		check.itemReusable[0] !== true ||
		check.heapIndex >= 0
	) {
		return;
	}
	check.isSink = isSinkList(st, check);
	pendingListHeapPush(st.pendingListHeap, check);
}

/**
 * Attaches an independent per-candidate dirty-list hook for every surviving
 * partial-title candidate inside a canonical trailing item, so distinct
 * candidates invalidated in different waves each re-dirty the enclosing list.
 */
function attachCanonicalCandidateDirtyHooks(
	st: LivenessState,
	check: PendingListCheck,
	itemNode: ProseMirrorNode,
	selfLabels: ReadonlySet<string>,
): void {
	if (check.firstTask === undefined || !check.needsFirstValidation) return;
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
 * Mirrors `resolveAuthoritativeListPreservation` during Pass 2: when item
 * `changedIdx` flips from verbatim to canonical, re-check any immediately
 * following reusable indented sibling items to verify whether each stays
 * reusable (safely left-shifted) or falls back to canonical serialization.
 */
function recheckFollowingIndentedItems(
	st: LivenessState,
	check: PendingListCheck,
	changedIdx: number,
	tail: TailSource,
): void {
	const { listNode, prepared } = check;
	if (!prepared.hasIndentedTrailingItem) return;
	const itemCount = listNode.childCount;
	const nextIdx = changedIdx + 1;
	if (
		nextIdx >= itemCount ||
		check.itemReusable[nextIdx] !== true ||
		(prepared.itemLeadCols[prepared.matched[nextIdx] ?? -1] ?? 0) <= 0
	) {
		return;
	}
	const loose = isLooseList(listNode);
	const changedPaired = prepared.paired[changedIdx] ?? -1;
	const changedPairedSlice =
		changedPaired >= 0 ? prepared.slices.items[changedPaired] : undefined;
	const canonicalChanged = serializeListItemAt(
		listNode,
		changedIdx,
		loose,
		createLiveBlockSerializer(st),
		changedPairedSlice !== undefined &&
			BLANK_BEFORE_NESTED_LIST.test(changedPairedSlice),
		undefined,
		(node) => st.partialTitleRefNodes.has(node),
	);
	let prevIndent = listItemContentIndent(canonicalChanged);
	const lastIdx = itemCount - 1;
	for (let k = nextIdx; k < itemCount; k += 1) {
		if (check.itemReusable[k] !== true) break;
		const matchedIdx = prepared.matched[k] ?? -1;
		const leadCols =
			matchedIdx >= 0 ? (prepared.itemLeadCols[matchedIdx] ?? 0) : 0;
		if (leadCols <= 0 || prevIndent <= 0 || leadCols < prevIndent) break;
		const rawSlice = prepared.slices.items[matchedIdx];
		const shifted =
			rawSlice !== undefined
				? tryLeftShiftReusableItem(
						rawSlice,
						leadCols,
						listNode,
						k,
						st.parsed.envReferences,
					)
				: null;
		if (shifted !== null) {
			prevIndent = listItemContentIndent(shifted);
			if (k === lastIdx) tail.onChange?.();
			continue;
		}
		fireTask(check.itemTasks[k]);
		break;
	}
}

function createListItemTask(
	st: LivenessState,
	check: PendingListCheck,
	itemIdx: number,
	itemNode: ProseMirrorNode,
	itemUpstreamLabels: ReadonlyArray<string>,
	selfLabels: ReadonlySet<string>,
	tail: TailSource,
): InvalidationTask {
	return {
		fired: false,
		run: () => {
			check.itemReusable[itemIdx] = false;
			if (itemIdx === 0) check.firstEmittedSlice = null;
			for (let i = 0; i < itemUpstreamLabels.length; i += 1) {
				const label = itemUpstreamLabels[i];
				if (label !== undefined) dropListUpstreamLabel(st, check, label);
			}
			if (st.subtreeHasCandidates.has(itemNode)) {
				walkSubtree(st, itemNode, "canonical", false, false);
				if (itemIdx > 0) {
					attachCanonicalCandidateDirtyHooks(st, check, itemNode, selfLabels);
				}
			}
			recheckFollowingIndentedItems(st, check, itemIdx, tail);
			// O(1): defer whole-list first-marker re-validation to prioritized
			// topological drain instead of re-parsing per item.
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
	const check: PendingListCheck = {
		firstEmittedSlice: resolution.firstEmittedSlice,
		firstLabels: [],
		firstTask: undefined,
		heapIndex: -1,
		isSink: false,
		itemReusable: resolution.itemReusable,
		itemTasks: new Array<InvalidationTask | undefined>(itemCount),
		listNode,
		liveUpstreamCount: 0,
		needsFirstValidation: resolution.needsFirstOrderedValidation,
		prepared,
		refCountByUpstreamLabel: new Map<string, number>(),
	};
	const tail: TailSource = {
		onChange: null,
		read: () => resolveListReuse(st, listNode, prepared, true).output ?? "",
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

	const tracksFirstItem =
		check.itemReusable[0] === true &&
		check.needsFirstValidation &&
		itemHasCands[0] === true;
	const selfLabels = new Set<string>();
	if (tracksFirstItem) {
		forEachCandidateIn(st, listNode, (cand) => {
			selfLabels.add(cand.label);
		});
	}

	const lastIdx = itemCount - 1;
	for (let itemIdx = 0; itemIdx < itemCount; itemIdx += 1) {
		const itemNode = listNode.child(itemIdx);
		const hasCands = itemHasCands[itemIdx] === true;
		const reusable = check.itemReusable[itemIdx] === true;
		if (!reusable) {
			if (!preEvaluatedCanonical[itemIdx]) {
				walkSubtree(st, itemNode, "canonical", false, deferInvalidation);
			}
			continue;
		}
		if (discover) {
			walkSubtree(st, itemNode, "verbatim", false, deferInvalidation);
		}
		if (itemIdx === 0 && hasCands) {
			forEachCandidateIn(st, itemNode, (cand) => {
				check.firstLabels.push(cand.label);
			});
		}
		const origIdx = prepared.matched[itemIdx] ?? -1;
		const nextIndented =
			prepared.hasIndentedTrailingItem &&
			itemIdx + 1 < itemCount &&
			check.itemReusable[itemIdx + 1] === true &&
			(prepared.itemLeadCols[prepared.matched[itemIdx + 1] ?? -1] ?? 0) > 0;
		const selfIndented =
			itemIdx > 0 && origIdx >= 0 && (prepared.itemLeadCols[origIdx] ?? 0) > 0;
		if (
			origIdx < 0 ||
			!(
				hasCands ||
				(itemIdx > 0 && tracksFirstItem) ||
				itemIdx === lastIdx ||
				nextIndented ||
				selfIndented
			)
		) {
			continue;
		}
		const itemUpstreamLabels: string[] = [];
		if (tracksFirstItem && itemIdx > 0) {
			const seen = new Set<string>();
			visitReferencedLabels(prepared.orig.child(origIdx), st.parsed, (label) => {
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
			});
		}
		const task = createListItemTask(
			st,
			check,
			itemIdx,
			itemNode,
			itemUpstreamLabels,
			selfLabels,
			tail,
		);
		check.itemTasks[itemIdx] = task;
		if (itemIdx === 0) check.firstTask = task;
		registerNodeDependency(st, prepared.orig.child(origIdx), task);
	}
	if (tracksFirstItem) {
		for (let itemIdx = 1; itemIdx < itemCount; itemIdx += 1) {
			if (check.itemReusable[itemIdx] !== true && itemHasCands[itemIdx]) {
				attachCanonicalCandidateDirtyHooks(
					st,
					check,
					listNode.child(itemIdx),
					selfLabels,
				);
			}
		}
	}
	if (hasAny) st.subtreeHasCandidates.add(listNode);
	return { hasAny, head, preserved: true, tail };
}

/**
 * Pops ONE dirty list in topological priority order (`liveUpstreamCount` first,
 * non-sink before sink, smallest `listNode.nodeSize` first) and re-validates
 * its reused first ordered item in O(list). Returns `false` once no list is
 * dirty.
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
		if (!check.needsFirstValidation || check.itemReusable[0] !== true) {
			return true;
		}
		const recheck = resolveListReuse(st, check.listNode, check.prepared, false);
		check.needsFirstValidation = recheck.needsFirstOrderedValidation;
		check.firstEmittedSlice = recheck.firstEmittedSlice;
		for (let idx = 1; idx < check.listNode.childCount; idx += 1) {
			if (
				check.itemReusable[idx] === true &&
				recheck.itemReusable[idx] !== true
			) {
				fireTask(check.itemTasks[idx]);
			}
		}
		if (recheck.itemReusable[0] !== true) fireTask(check.firstTask);
		return true;
	}
	return false;
}
