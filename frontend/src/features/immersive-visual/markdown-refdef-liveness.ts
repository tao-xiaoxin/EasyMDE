import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { ContainerAlignmentPlan } from "./markdown-container-preservation";
import type { PreparedListPreservation } from "./markdown-list-preservation";
import type { BlockSerializer } from "./markdown-list-serialization";
import type { ParsedVisualDocument } from "./markdown-parser";
import { openContainer } from "./markdown-refdef-liveness-containers";
import { drainNextPendingList } from "./markdown-refdef-liveness-lists";
import {
	type BlockWithRefsSerializer,
	type CandidatePartialRefDef,
	fireTask,
	type InvalidationTask,
	isBlockContainerForRefDefs,
	isLivePartialLabel,
	isRawProtectedBlock,
	type LivenessState,
	type PendingListCheck,
	type PreservationPlan,
	type ReferencePreserveResolver,
	registerRefDefNode,
	scheduleInvalidation,
	visitReferencedLabels,
} from "./markdown-refdef-liveness-state";

export type { ReferencePreserveResolver } from "./markdown-refdef-liveness-state";

/**
 * O(N + E) reference-definition liveness and partial-title follower validation
 * for untouched-source preservation (`markdown-block-preservation.ts`).
 *
 * Walks the document once to build a cached per-container alignment and list
 * preservation plan, wires a reverse-dependency graph keyed by referenced
 * label, and drains a FIFO invalidation worklist so every block, sharedGroup,
 * container, and list item transitions monotonically from verbatim toward
 * canonical. Shared worklist state lives in `markdown-refdef-liveness-state.ts`;
 * container and list planning live in `markdown-refdef-liveness-containers.ts`
 * and `markdown-refdef-liveness-lists.ts`.
 */

/**
 * Single O(N + E) pass + reverse-dependency worklist over `doc` determining
 * which baseline reference definitions remain alive and unshadowed at every
 * nesting depth, while caching container alignment and list-preservation plans
 * for reuse by `serializeContainerPreservingChildren`.
 */
export function computeIntactRefDefLabels(
	doc: ProseMirrorNode,
	parsed: ParsedVisualDocument,
	serializeBlock: BlockSerializer,
	serializeBlockWithRefs?: BlockWithRefsSerializer,
): Readonly<{
	allIntact: Set<string>;
	partialTitleIntact: Set<string>;
	plan: PreservationPlan;
}> {
	const plan: PreservationPlan = {
		containers: new Map<ProseMirrorNode, ContainerAlignmentPlan>(),
		listItemReusable: new Map<ProseMirrorNode, ReadonlyArray<boolean>>(),
		lists: new Map<ProseMirrorNode, PreparedListPreservation>(),
	};
	const firstByLabel = parsed.firstRefDefNodeByLabel;
	const labelsByNode = parsed.refDefLabelsByNode;
	if (
		!hasReferenceUses(parsed) ||
		!firstByLabel ||
		firstByLabel.size === 0 ||
		!labelsByNode ||
		labelsByNode.size === 0
	) {
		return {
			allIntact: new Set<string>(),
			partialTitleIntact: new Set<string>(),
			plan,
		};
	}

	const partialLabels = parsed.phpPartialTitleRefLabels;
	const deferredInvalidatedSet = new Set<string>();
	const invalidatedLabels = new Set<string>();
	const partialTitleRefNodes = new Set<ProseMirrorNode>();
	const liveResolver: ReferencePreserveResolver | null =
		serializeBlockWithRefs !== undefined &&
		partialLabels !== undefined &&
		partialLabels.size > 0
			? {
					isPartialTitleRefDef: (node) => partialTitleRefNodes.has(node),
					resolveImage: (node) => {
						const origin = parsed.referenceImages?.get(node);
						return origin && isLivePartialLabel(st, origin.normalizedLabel)
							? origin
							: null;
					},
					resolveLink: (mark) => {
						const origin = parsed.referenceLinks?.get(mark);
						return origin && isLivePartialLabel(st, origin.normalizedLabel)
							? origin
							: null;
					},
				}
			: null;

	const st: LivenessState = {
		allIntact: new Set<string>(),
		candidatesByParent: new Map<ProseMirrorNode, CandidatePartialRefDef[]>(),
		deferredInvalidatedSet,
		deferredInvalidations: [],
		dependentsByLabel: new Map<string, Set<InvalidationTask>>(),
		firstByLabel,
		invalidatedLabels,
		invalidQueue: [],
		labelsByNode,
		liveResolver,
		parsed,
		partialLabels,
		partialTitleIntact: new Set<string>(),
		partialTitleLabelsByNode: new Map<ProseMirrorNode, Set<string>>(),
		partialTitleLostQueue: [],
		partialTitleNodeWaiters: new Map<ProseMirrorNode, InvalidationTask[]>(),
		partialTitleRefNodes,
		pendingListHeap: [],
		plan,
		producerListByLabel: new Map<string, PendingListCheck>(),
		seenLabels: new Set<string>(),
		serializeBlock,
		serializeBlockWithRefs,
		subtreeHasCandidates: new WeakSet<ProseMirrorNode>(),
		upstreamListsByLabel: new Map<string, Set<PendingListCheck>>(),
		watchedCanonicalCandidates: new WeakSet<CandidatePartialRefDef>(),
	};
	const result = {
		allIntact: st.allIntact,
		partialTitleIntact: st.partialTitleIntact,
		plan,
	};

	// Fast O(N) path when no PHP partial-title refdefs exist.
	if (partialLabels === undefined || partialLabels.size === 0) {
		const walkPlain = (parent: ProseMirrorNode): void => {
			for (let i = 0; i < parent.childCount; i += 1) {
				const child = parent.child(i);
				if (isRawProtectedBlock(child)) {
					registerRefDefNode(st, parent, i, child);
				} else if (child.childCount > 0 && isBlockContainerForRefDefs(child)) {
					walkPlain(child);
				}
			}
		};
		walkPlain(doc);
		return result;
	}

	// Pass 1: single tree walk (purely structural, zero mid-walk invalidation).
	openContainer(st, doc, parsed, 0, true, true);

	// Seed FIFO queue with missing/shadowed baseline labels and initially-broken
	// partial-title refdefs.
	for (const label of firstByLabel.keys()) {
		if (!st.allIntact.has(label)) scheduleInvalidation(st, label, false);
	}
	for (let i = 0; i < st.deferredInvalidations.length; i += 1) {
		const label = st.deferredInvalidations[i];
		if (label !== undefined) scheduleInvalidation(st, label, false);
	}

	// Pass 2: O(N + E) worklist propagation. Every task fires at most once.
	// After the FIFO queue empties, exactly ONE dirty list pops in topological
	// priority order (`pendingUpstreamCount`, `liveUpstreamCount`, non-sink
	// before sink, smallest `listNode.nodeSize` first), draining any newly invalidated labels before
	// another list pops so downstream lists re-validate at most once.
	// Slots whose tight join relied on a since-lost partial-title refdef
	// (`removePartialTitleRefNode`) re-evaluate in the same worklist.
	let queueHead = 0;
	let lostHead = 0;
	while (true) {
		while (
			queueHead < st.invalidQueue.length ||
			lostHead < st.partialTitleLostQueue.length
		) {
			if (queueHead < st.invalidQueue.length) {
				const label = st.invalidQueue[queueHead];
				queueHead += 1;
				if (label === undefined) continue;
				const deps = st.dependentsByLabel.get(label);
				if (!deps) continue;
				st.dependentsByLabel.delete(label);
				for (const task of deps) fireTask(task);
				continue;
			}
			const lost = st.partialTitleLostQueue[lostHead];
			lostHead += 1;
			if (lost) lost.run();
		}
		if (!drainNextPendingList(st)) break;
	}

	return result;
}

function hasReferenceUses(parsed: ParsedVisualDocument): boolean {
	return Boolean(
		(parsed.referenceLinks && parsed.referenceLinks.size > 0) ||
			(parsed.referenceImages && parsed.referenceImages.size > 0) ||
			(parsed.referencedLabelsByNode && parsed.referencedLabelsByNode.size > 0),
	);
}

export function buildReferencePreserveResolver(
	parsed: ParsedVisualDocument,
	partialTitleIntact: ReadonlySet<string>,
	hasRefSerializer: boolean,
): ReferencePreserveResolver | null {
	if (partialTitleIntact.size === 0 || !hasRefSerializer) return null;
	const partialTitleRefNodes = new Set<ProseMirrorNode>();
	if (parsed.firstRefDefNodeByLabel) {
		for (const label of partialTitleIntact) {
			const refNode = parsed.firstRefDefNodeByLabel.get(label);
			if (refNode) partialTitleRefNodes.add(refNode);
		}
	}
	return {
		isPartialTitleRefDef: (node) => partialTitleRefNodes.has(node),
		resolveImage: (node) => {
			const origin = parsed.referenceImages?.get(node);
			return origin && partialTitleIntact.has(origin.normalizedLabel)
				? origin
				: null;
		},
		resolveLink: (mark) => {
			const origin = parsed.referenceLinks?.get(mark);
			return origin && partialTitleIntact.has(origin.normalizedLabel)
				? origin
				: null;
		},
	};
}

export function createInvalidatedRefChecker(
	parsed: ParsedVisualDocument,
	allIntact: ReadonlySet<string>,
): Readonly<{
	hasInvalidatedRefDefs: boolean;
	nodeHasInvalidatedRef: (node: ProseMirrorNode) => boolean;
}> {
	const totalRefDefs = parsed.firstRefDefNodeByLabel?.size ?? 0;
	if (
		!hasReferenceUses(parsed) ||
		totalRefDefs === 0 ||
		allIntact.size >= totalRefDefs
	) {
		return {
			hasInvalidatedRefDefs: false,
			nodeHasInvalidatedRef: () => false,
		};
	}
	const cache = new WeakMap<ProseMirrorNode, boolean>();
	const check = (node: ProseMirrorNode): boolean => {
		const cached = cache.get(node);
		if (cached !== undefined) return cached;
		const invalidated = visitReferencedLabels(
			node,
			parsed,
			(label) => !allIntact.has(label),
		);
		cache.set(node, invalidated);
		return invalidated;
	};
	return { hasInvalidatedRefDefs: true, nodeHasInvalidatedRef: check };
}
