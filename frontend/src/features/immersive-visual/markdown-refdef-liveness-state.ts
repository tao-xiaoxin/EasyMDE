import type { Node as ProseMirrorNode } from "prosemirror-model";
import type {
	ContainerAlignmentPlan,
	PreparedListPreservation,
} from "./markdown-container-preservation";
import { normalizeReferenceLabel } from "./markdown-escape";
import {
	type BlockSerializer,
	isDeferredTaskParagraph,
} from "./markdown-list-serialization";
import {
	extractReferenceDefinitionLabels,
	inspectReferenceDefinitionBlock,
	type ParsedVisualDocument,
	wouldReferenceDefinitionAbsorbFollowingBlock,
} from "./markdown-parser";
import { extractPhpPartialReferenceTitle } from "./markdown-reference-preservation";

/**
 * Shared mutable worklist state, reverse-dependency graph, and subtree
 * candidate traversal for the O(N + E) reference-definition liveness analyzer
 * (`markdown-refdef-liveness.ts`). Container/list planning lives in
 * `markdown-refdef-liveness-containers.ts`.
 */

export type PreservationPlan = Readonly<{
	containers: Map<ProseMirrorNode, ContainerAlignmentPlan>;
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
 * One preservable ordered list whose reused first item needs whole-list
 * marker re-validation. Item tasks only mark it dirty in O(1); the
 * coordinator drains each dirty list once after the invalidation queue empties.
 */
export type PendingListCheck = {
	firstTask: InvalidationTask | undefined;
	readonly itemReusable: boolean[];
	readonly listNode: ProseMirrorNode;
	needsFirstValidation: boolean;
	readonly prepared: PreparedListPreservation;
};

export type LivenessState = Readonly<{
	allIntact: Set<string>;
	candidatesByParent: Map<ProseMirrorNode, CandidatePartialRefDef[]>;
	deferredInvalidations: string[];
	dependentsByLabel: Map<string, Set<InvalidationTask>>;
	firstByLabel: ReadonlyMap<string, ProseMirrorNode>;
	invalidatedLabels: Set<string>;
	invalidQueue: string[];
	labelsByNode: ReadonlyMap<ProseMirrorNode, ReadonlyArray<string>>;
	parsed: ParsedVisualDocument;
	partialLabels: ReadonlySet<string> | undefined;
	partialTitleIntact: Set<string>;
	partialTitleRefNodes: Set<ProseMirrorNode>;
	pendingListChecks: Set<PendingListCheck>;
	plan: PreservationPlan;
	seenLabels: Set<string>;
	serializeBlock: BlockSerializer;
	subtreeHasCandidates: WeakSet<ProseMirrorNode>;
}>;

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
	const serializedNext = st.serializeBlock(nextSibling);
	const nl = serializedNext.indexOf("\n");
	const firstLine = nl === -1 ? serializedNext : serializedNext.slice(0, nl);
	if (!/^[ \t]*["'(]/.test(firstLine)) return false;
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
): boolean {
	const blockLabels = parsed.referencedLabelsByNode?.get(node);
	if (blockLabels) {
		for (const label of blockLabels) {
			if (visit(label)) return true;
		}
		if (node.isTextblock) return false;
	}
	if (node.isTextblock && parsed.referencedLabelsByNode) return false;
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
		if (visitReferencedLabels(node.child(i), parsed, visit)) return true;
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

export function scheduleInvalidation(
	st: LivenessState,
	label: string,
	defer: boolean,
): void {
	if (defer) {
		st.deferredInvalidations.push(label);
		return;
	}
	if (st.invalidatedLabels.has(label)) return;
	st.invalidatedLabels.add(label);
	st.allIntact.delete(label);
	st.partialTitleIntact.delete(label);
	const refNode = st.firstByLabel.get(label);
	if (refNode) st.partialTitleRefNodes.delete(refNode);
	st.invalidQueue.push(label);
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
	if (st.invalidatedLabels.has(cand.label)) return;
	const nextIdx = cand.refIdx + 1;
	const nextSibling =
		nextIdx < cand.parent.childCount ? cand.parent.child(nextIdx) : null;
	if (
		nextSibling === null ||
		nextSibling.type.name !== "paragraph" ||
		!canonicalParagraphPreservesPartialTitle(st, cand, nextSibling)
	) {
		scheduleInvalidation(st, cand.label, deferInvalidation);
	}
}

/**
 * Walks a subtree that is emitted entirely verbatim or entirely canonically.
 * `discover` registers refdefs (first pass); otherwise only subtrees already
 * known to hold candidates are revisited, keeping every revisit O(subtree).
 */
export function walkSubtree(
	st: LivenessState,
	parent: ProseMirrorNode,
	mode: "verbatim" | "canonical",
	discover: boolean,
	deferInvalidation: boolean,
): boolean {
	let hasAny = false;
	if (discover) {
		for (let i = 0; i < parent.childCount; i += 1) {
			const child = parent.child(i);
			if (isRawProtectedBlock(child)) {
				if (registerRefDefNode(st, parent, i, child)) hasAny = true;
			} else if (child.childCount > 0 && isBlockContainerForRefDefs(child)) {
				if (walkSubtree(st, child, mode, true, deferInvalidation)) {
					hasAny = true;
				}
			}
		}
		if (hasAny) st.subtreeHasCandidates.add(parent);
	} else {
		if (!st.subtreeHasCandidates.has(parent)) return false;
		for (let i = 0; i < parent.childCount; i += 1) {
			const child = parent.child(i);
			if (child.childCount > 0 && isBlockContainerForRefDefs(child)) {
				walkSubtree(st, child, mode, false, deferInvalidation);
			}
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
	return hasAny;
}
