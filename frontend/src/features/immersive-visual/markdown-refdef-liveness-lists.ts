import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	type PreparedListPreservation,
	prepareListPreservation,
	resolveAuthoritativeListPreservation,
} from "./markdown-container-preservation";
import type { ParsedVisualBlockSource } from "./markdown-parser";
import {
	fireTask,
	type InvalidationTask,
	type LivenessState,
	nodeHasCurrentInvalidatedRef,
	type PendingListCheck,
	registerNodeDependency,
	walkSubtree,
} from "./markdown-refdef-liveness-state";

/**
 * List planning for the refdef liveness analyzer. Each preservable list runs
 * the shared authoritative list resolution once; trailing items re-validate a
 * reused first ordered item only when item 0 holds partial-title candidates,
 * and do so by marking the list dirty in O(1) for one batched drain.
 */

export type DescendResult = Readonly<{ hasAny: boolean; preserved: boolean }>;

export type InvalidCheck = ((node: ProseMirrorNode) => boolean) | null;

function resolveListReuse(
	st: LivenessState,
	listNode: ProseMirrorNode,
	prepared: PreparedListPreservation,
	invalidCheck: InvalidCheck,
): ReturnType<typeof resolveAuthoritativeListPreservation> {
	return resolveAuthoritativeListPreservation(
		listNode,
		prepared,
		st.serializeBlock,
		st.parsed.envReferences,
		(origIdx) => !invalidCheck?.(prepared.orig.child(origIdx)),
		(node) => st.partialTitleRefNodes.has(node),
		undefined,
		false,
	);
}

function createListItemTask(
	st: LivenessState,
	check: PendingListCheck,
	itemIdx: number,
	itemNode: ProseMirrorNode,
): InvalidationTask {
	return {
		fired: false,
		run: () => {
			check.itemReusable[itemIdx] = false;
			if (st.subtreeHasCandidates.has(itemNode)) {
				walkSubtree(st, itemNode, "canonical", false, false);
			}
			// O(1): defer the whole-list first-marker re-validation to one
			// batched drain per dirty list instead of re-parsing per item.
			if (
				itemIdx > 0 &&
				check.firstTask !== undefined &&
				check.needsFirstValidation &&
				check.itemReusable[0] === true
			) {
				st.pendingListChecks.add(check);
			}
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
		};
	}
	st.plan.lists.set(listNode, prepared);
	const invalidCheck: InvalidCheck = discover
		? null
		: (node) => nodeHasCurrentInvalidatedRef(st, node);
	const resolution = resolveListReuse(st, listNode, prepared, invalidCheck);
	const check: PendingListCheck = {
		firstTask: undefined,
		itemReusable: resolution.itemReusable,
		listNode,
		needsFirstValidation: resolution.needsFirstOrderedValidation,
		prepared,
	};
	// Trailing items only matter for re-validating item 0 when item 0 itself
	// holds partial-title candidates whose verbatim/canonical form could flip.
	let tracksFirstItem = false;
	let hasAny = false;
	for (let itemIdx = 0; itemIdx < listNode.childCount; itemIdx += 1) {
		const itemNode = listNode.child(itemIdx);
		if (check.itemReusable[itemIdx] !== true) {
			if (walkSubtree(st, itemNode, "canonical", discover, deferInvalidation)) {
				hasAny = true;
			}
			continue;
		}
		const itemHasCands = discover
			? walkSubtree(st, itemNode, "verbatim", true, deferInvalidation)
			: st.subtreeHasCandidates.has(itemNode);
		if (itemHasCands) hasAny = true;
		if (itemIdx === 0) {
			tracksFirstItem = check.needsFirstValidation && itemHasCands;
		}
		const origIdx = prepared.matched[itemIdx] ?? -1;
		if (origIdx < 0 || !(itemHasCands || (itemIdx > 0 && tracksFirstItem))) {
			continue;
		}
		const task = createListItemTask(st, check, itemIdx, itemNode);
		if (itemIdx === 0) check.firstTask = task;
		registerNodeDependency(st, prepared.orig.child(origIdx), task);
	}
	if (hasAny) st.subtreeHasCandidates.add(listNode);
	return { hasAny, preserved: true };
}

/**
 * Re-validates every dirty list's reused first ordered item exactly once per
 * drain (O(list) each), firing item 0's task when it can no longer be reused.
 */
export function drainPendingListChecks(st: LivenessState): void {
	const pending = Array.from(st.pendingListChecks);
	st.pendingListChecks.clear();
	for (const check of pending) {
		if (!check.needsFirstValidation || check.itemReusable[0] !== true) {
			continue;
		}
		const recheck = resolveListReuse(
			st,
			check.listNode,
			check.prepared,
			(node) => nodeHasCurrentInvalidatedRef(st, node),
		);
		check.needsFirstValidation = recheck.needsFirstOrderedValidation;
		if (recheck.itemReusable[0] !== true) fireTask(check.firstTask);
	}
}
