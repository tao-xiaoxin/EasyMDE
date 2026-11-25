import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
	alignContainerChildren,
	type ContainerAlignmentPlan,
	canPreserveContainerHeadStructurally,
	checkRawPreservationRisks,
	createTightSharedGroupChecker,
	leadingIndentAtDepth,
	listAttrsCompatible,
	needsPrevInnerForRiskCheck,
	type PreparedListPreservation,
	prepareListPreservation,
	resolveAuthoritativeListPreservation,
	sharedGroupHasInvalidatedRef,
	stripAtDepth,
} from "./markdown-container-preservation";
import { normalizeReferenceLabel } from "./markdown-escape";
import {
	type BlockSerializer,
	isDeferredTaskParagraph,
	isNestedList,
} from "./markdown-list-serialization";
import {
	type BuiltVisualBlockSources,
	extractReferenceDefinitionLabels,
	inspectReferenceDefinitionBlock,
	type ParsedVisualBlockSource,
	type ParsedVisualDocument,
	type ReferenceImageOrigin,
	type ReferenceLinkOrigin,
	wouldReferenceDefinitionAbsorbFollowingBlock,
} from "./markdown-parser";
import { extractPhpPartialReferenceTitle } from "./markdown-reference-preservation";

/**
 * O(N + E) reference-definition liveness and partial-title follower validation
 * for untouched-source preservation (`markdown-block-preservation.ts`).
 *
 * Walks the document once to build a cached per-container alignment and list
 * preservation plan, wires a reverse-dependency graph keyed by referenced
 * label, and drains a FIFO invalidation worklist so every block, sharedGroup,
 * container, and list item transitions from verbatim to canonical at most once.
 */

export type ReferencePreserveResolver = Readonly<{
	isPartialTitleRefDef: (node: ProseMirrorNode) => boolean;
	resolveImage: (node: ProseMirrorNode) => ReferenceImageOrigin | null;
	resolveLink: (mark: Mark) => ReferenceLinkOrigin | null;
}>;

export type PreservationPlan = Readonly<{
	containers: Map<ProseMirrorNode, ContainerAlignmentPlan>;
	lists: Map<ProseMirrorNode, PreparedListPreservation>;
}>;

function isBlockContainerForRefDefs(node: ProseMirrorNode): boolean {
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

function isRawProtectedBlock(node: ProseMirrorNode): boolean {
	return (
		node.type.name === "protected_block" &&
		node.attrs.kind === "raw" &&
		typeof node.attrs.rawMarkdown === "string"
	);
}

function isPartialTitleFollowerType(node: ProseMirrorNode): boolean {
	return (
		node.type.name === "paragraph" ||
		node.type.name === "heading" ||
		node.type.name === "table"
	);
}

function canonicalParagraphPreservesPartialTitle(
	parent: ProseMirrorNode,
	refIdx: number,
	refNode: ProseMirrorNode,
	nextSibling: ProseMirrorNode,
	label: string,
	parsed: ParsedVisualDocument,
	serializeBlock: BlockSerializer,
): boolean {
	if (isDeferredTaskParagraph(parent, refIdx + 1)) return false;
	const refRaw =
		typeof refNode.attrs.rawMarkdown === "string"
			? refNode.attrs.rawMarkdown
			: "";
	const refInfo = inspectReferenceDefinitionBlock(refRaw);
	if (!refInfo.isRefDef || refInfo.lastHasTitle) return false;
	const serializedNext = serializeBlock(nextSibling);
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
	const expectedTitle = parsed.envReferences?.[label]?.title ?? "";
	return (canonicalTitle ?? "") === expectedTitle;
}

/**
 * Visits every baseline reference label used inside `node`. Returning `true`
 * from `visit` stops traversal immediately (used for O(1) short-circuit checks
 * as well as full reverse-edge registration).
 */
function visitReferencedLabels(
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

type InvalidationTask = {
	fired: boolean;
	run: () => void;
};

type CandidatePartialRefDef = Readonly<{
	label: string;
	parent: ProseMirrorNode;
	refIdx: number;
	refNode: ProseMirrorNode;
}>;

type ContainerState = Readonly<{
	container: ProseMirrorNode;
	depth: number;
	effectiveOrigIndex: number[];
	groupStartAt: number[];
	groupTasks: Map<number, InvalidationTask>;
	isChildVerbatim: boolean[];
	matchedOrigIndex: ReadonlyArray<number>;
	pairedOrigIndex: ReadonlyArray<number>;
	rawEmitted: Array<string | null>;
	slotCandidates: Map<number, CandidatePartialRefDef[]>;
	slotTasks: Map<number, InvalidationTask>;
	source: BuiltVisualBlockSources;
}>;

function isNextVerbatimTightInContainer(
	cs: ContainerState,
	refIdx: number,
): boolean {
	const nextIdx = refIdx + 1;
	if (cs.isChildVerbatim[nextIdx] !== true) return false;
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

function evaluateSlotRawRisks(
	child: ProseMirrorNode,
	depth: number,
	rawCandidate: string,
	sep: string,
	prevNode: ProseMirrorNode | null,
	prevRawEmitted: string | null,
	prevWasMatchedAdjacent: boolean,
	serializeBlock: BlockSerializer,
): Readonly<{ indentedRisk: boolean; swallowRisk: boolean }> {
	const leadIndent = leadingIndentAtDepth(rawCandidate, depth);
	if (leadIndent <= 0) return { indentedRisk: false, swallowRisk: false };
	const prevInner = needsPrevInnerForRiskCheck(
		child,
		leadIndent,
		sep,
		prevNode,
		prevWasMatchedAdjacent,
	)
		? prevRawEmitted !== null
			? stripAtDepth(prevRawEmitted, depth)
			: prevNode !== null
				? serializeBlock(prevNode)
				: ""
		: "";
	return checkRawPreservationRisks(
		child,
		depth,
		rawCandidate,
		stripAtDepth(rawCandidate, depth),
		sep,
		prevNode,
		prevInner,
		prevWasMatchedAdjacent,
	);
}

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
): Readonly<{
	allIntact: Set<string>;
	partialTitleIntact: Set<string>;
	plan: PreservationPlan;
}> {
	const plan: PreservationPlan = {
		containers: new Map<ProseMirrorNode, ContainerAlignmentPlan>(),
		lists: new Map<ProseMirrorNode, PreparedListPreservation>(),
	};
	const firstByLabel = parsed.firstRefDefNodeByLabel;
	const labelsByNode = parsed.refDefLabelsByNode;
	const hasRefs =
		(parsed.referenceLinks && parsed.referenceLinks.size > 0) ||
		(parsed.referenceImages && parsed.referenceImages.size > 0) ||
		(parsed.referencedLabelsByNode && parsed.referencedLabelsByNode.size > 0);
	if (
		!hasRefs ||
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
	const hasPartialLabels =
		partialLabels !== undefined && partialLabels.size > 0;
	const allIntact = new Set<string>();
	const partialTitleIntact = new Set<string>();
	const partialTitleRefNodes = new Set<ProseMirrorNode>();
	const seenLabels = new Set<string>();
	const candidatesByParent = new Map<
		ProseMirrorNode,
		CandidatePartialRefDef[]
	>();

	const registerRefDefNode = (
		parent: ProseMirrorNode,
		childIdx: number,
		child: ProseMirrorNode,
	): boolean => {
		const origLabels = labelsByNode.get(child);
		let addedCandidate = false;
		if (origLabels) {
			for (const label of origLabels) {
				if (seenLabels.has(label)) continue;
				seenLabels.add(label);
				if (firstByLabel.get(label) !== child) continue;
				allIntact.add(label);
				if (partialLabels?.has(label)) {
					partialTitleIntact.add(label);
					partialTitleRefNodes.add(child);
					let list = candidatesByParent.get(parent);
					if (!list) {
						list = [];
						candidatesByParent.set(parent, list);
					}
					list.push({ label, parent, refIdx: childIdx, refNode: child });
					addedCandidate = true;
				}
			}
		} else if (typeof child.attrs.rawMarkdown === "string") {
			const newLabels = extractReferenceDefinitionLabels(
				child.attrs.rawMarkdown,
			);
			if (newLabels) {
				for (const rawLabel of newLabels) {
					seenLabels.add(normalizeReferenceLabel(rawLabel));
				}
			}
		}
		return addedCandidate;
	};

	// Fast O(N) path when no PHP partial-title refdefs exist.
	if (!hasPartialLabels) {
		const walkPlain = (parent: ProseMirrorNode): void => {
			for (let i = 0; i < parent.childCount; i += 1) {
				const child = parent.child(i);
				if (isRawProtectedBlock(child)) {
					registerRefDefNode(parent, i, child);
				} else if (child.childCount > 0 && isBlockContainerForRefDefs(child)) {
					walkPlain(child);
				}
			}
		};
		walkPlain(doc);
		return { allIntact, partialTitleIntact, plan };
	}

	const invalidatedLabels = new Set<string>();
	const invalidQueue: string[] = [];
	const deferredInvalidations: string[] = [];
	const dependentsByLabel = new Map<string, Set<InvalidationTask>>();
	const subtreeHasCandidates = new WeakSet<ProseMirrorNode>();

	const scheduleInvalidation = (label: string, defer: boolean): void => {
		if (defer) {
			deferredInvalidations.push(label);
			return;
		}
		if (invalidatedLabels.has(label)) return;
		invalidatedLabels.add(label);
		allIntact.delete(label);
		partialTitleIntact.delete(label);
		const refNode = firstByLabel.get(label);
		if (refNode) partialTitleRefNodes.delete(refNode);
		invalidQueue.push(label);
	};

	const fireTask = (task: InvalidationTask | undefined): void => {
		if (!task || task.fired) return;
		task.fired = true;
		task.run();
	};

	const registerNodeDependency = (
		origNode: ProseMirrorNode,
		task: InvalidationTask,
	): void => {
		visitReferencedLabels(origNode, parsed, (label) => {
			let set = dependentsByLabel.get(label);
			if (!set) {
				set = new Set<InvalidationTask>();
				dependentsByLabel.set(label, set);
			}
			set.add(task);
			return false;
		});
	};

	const isCandidatePartialTitleRefNode = (node: ProseMirrorNode): boolean =>
		partialTitleRefNodes.has(node);

	const nodeHasCurrentInvalidatedRef = (node: ProseMirrorNode): boolean =>
		invalidatedLabels.size > 0 &&
		visitReferencedLabels(node, parsed, (label) =>
			invalidatedLabels.has(label),
		);

	const evaluateCandidateCanonical = (
		cand: CandidatePartialRefDef,
		deferInvalidation: boolean,
	): void => {
		if (invalidatedLabels.has(cand.label)) return;
		const nextIdx = cand.refIdx + 1;
		const nextSibling =
			nextIdx < cand.parent.childCount ? cand.parent.child(nextIdx) : null;
		if (
			nextSibling === null ||
			nextSibling.type.name !== "paragraph" ||
			!canonicalParagraphPreservesPartialTitle(
				cand.parent,
				cand.refIdx,
				cand.refNode,
				nextSibling,
				cand.label,
				parsed,
				serializeBlock,
			)
		) {
			scheduleInvalidation(cand.label, deferInvalidation);
		}
	};

	const walkSubtree = (
		parent: ProseMirrorNode,
		mode: "verbatim" | "canonical",
		discover: boolean,
		deferInvalidation: boolean,
	): boolean => {
		let hasAny = false;
		if (discover) {
			for (let i = 0; i < parent.childCount; i += 1) {
				const child = parent.child(i);
				if (isRawProtectedBlock(child)) {
					if (registerRefDefNode(parent, i, child)) hasAny = true;
				} else if (child.childCount > 0 && isBlockContainerForRefDefs(child)) {
					if (walkSubtree(child, mode, true, deferInvalidation)) hasAny = true;
				}
			}
			if (hasAny) subtreeHasCandidates.add(parent);
		} else {
			if (!subtreeHasCandidates.has(parent)) return false;
			for (let i = 0; i < parent.childCount; i += 1) {
				const child = parent.child(i);
				if (child.childCount > 0 && isBlockContainerForRefDefs(child)) {
					walkSubtree(child, mode, false, deferInvalidation);
				}
			}
		}
		const directCandidates = candidatesByParent.get(parent);
		if (directCandidates) {
			for (const cand of directCandidates) {
				if (mode === "verbatim") {
					const nextIdx = cand.refIdx + 1;
					if (
						nextIdx >= parent.childCount ||
						!isPartialTitleFollowerType(parent.child(nextIdx))
					) {
						scheduleInvalidation(cand.label, deferInvalidation);
					}
				} else {
					evaluateCandidateCanonical(cand, deferInvalidation);
				}
			}
		}
		return hasAny;
	};

	const openList = (
		listNode: ProseMirrorNode,
		origBlock: ParsedVisualBlockSource,
		depth: number,
		discover: boolean,
		deferInvalidation: boolean,
	): boolean => {
		const prepared =
			plan.lists.get(listNode) ??
			prepareListPreservation(listNode, origBlock, depth, parsed.envReferences);
		if (!prepared) {
			return walkSubtree(listNode, "canonical", discover, deferInvalidation);
		}
		plan.lists.set(listNode, prepared);
		const invalidCheck = discover ? null : nodeHasCurrentInvalidatedRef;
		const resolution = resolveAuthoritativeListPreservation(
			listNode,
			prepared,
			serializeBlock,
			parsed.envReferences,
			(origIdx) => !invalidCheck?.(prepared.orig.child(origIdx)),
			isCandidatePartialTitleRefNode,
			undefined,
			false,
		);
		const itemReusable = resolution.itemReusable;
		let needsFirstValidation = resolution.needsFirstOrderedValidation;
		const itemTasks = new Array<InvalidationTask | undefined>(
			listNode.childCount,
		);
		let hasAny = false;

		for (let itemIdx = 0; itemIdx < listNode.childCount; itemIdx += 1) {
			const itemNode = listNode.child(itemIdx);
			if (itemReusable[itemIdx] === true) {
				const itemHasCands = discover
					? walkSubtree(itemNode, "verbatim", true, deferInvalidation)
					: subtreeHasCandidates.has(itemNode);
				if (itemHasCands) hasAny = true;
				const origIdx = prepared.matched[itemIdx] ?? -1;
				if (origIdx >= 0 && (itemHasCands || needsFirstValidation)) {
					const capturedIdx = itemIdx;
					const task: InvalidationTask = {
						fired: false,
						run: () => {
							itemReusable[capturedIdx] = false;
							if (subtreeHasCandidates.has(itemNode)) {
								walkSubtree(itemNode, "canonical", false, false);
							}
							if (
								capturedIdx > 0 &&
								needsFirstValidation &&
								itemReusable[0] === true
							) {
								const recheck = resolveAuthoritativeListPreservation(
									listNode,
									prepared,
									serializeBlock,
									parsed.envReferences,
									(oIdx) => !nodeHasCurrentInvalidatedRef(prepared.orig.child(oIdx)),
									isCandidatePartialTitleRefNode,
									undefined,
									false,
								);
								needsFirstValidation = recheck.needsFirstOrderedValidation;
								if (recheck.itemReusable[0] !== true) {
									fireTask(itemTasks[0]);
								}
							}
						},
					};
					itemTasks[capturedIdx] = task;
					registerNodeDependency(prepared.orig.child(origIdx), task);
				}
			} else if (
				walkSubtree(itemNode, "canonical", discover, deferInvalidation)
			) {
				hasAny = true;
			}
		}
		if (hasAny) subtreeHasCandidates.add(listNode);
		return hasAny;
	};

	const descendNonVerbatimChild = (
		child: ProseMirrorNode,
		baseBlock: ParsedVisualBlockSource | undefined,
		depth: number,
		discover: boolean,
		deferInvalidation: boolean,
	): boolean => {
		if (child.childCount === 0 || !isBlockContainerForRefDefs(child)) {
			return false;
		}
		if (
			child.type.name === "blockquote" &&
			baseBlock?.node.type.name === "blockquote"
		) {
			const bqSource = parsed.blockquoteSources?.get(baseBlock.node);
			if (bqSource && bqSource.blocks.length === baseBlock.node.childCount) {
				return openContainer(
					child,
					bqSource,
					depth + 1,
					discover,
					deferInvalidation,
				);
			}
		}
		if (isNestedList(child) && baseBlock && baseBlock.raw !== null) {
			return openList(child, baseBlock, depth, discover, deferInvalidation);
		}
		return walkSubtree(child, "canonical", discover, deferInvalidation);
	};

	const evaluateContainerCandidate = (
		cs: ContainerState,
		cand: CandidatePartialRefDef,
		deferInvalidation: boolean,
	): void => {
		if (invalidatedLabels.has(cand.label)) return;
		const nextIdx = cand.refIdx + 1;
		const nextSibling =
			nextIdx < cs.container.childCount ? cs.container.child(nextIdx) : null;
		if (nextSibling === null || !isPartialTitleFollowerType(nextSibling)) {
			scheduleInvalidation(cand.label, deferInvalidation);
			return;
		}
		if (isNextVerbatimTightInContainer(cs, cand.refIdx)) {
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
			return;
		}
		evaluateCandidateCanonical(cand, deferInvalidation);
	};

	const recheckFollowingIndentRisks = (
		cs: ContainerState,
		changedIdx: number,
	): void => {
		const nextIdx = changedIdx + 1;
		if (
			nextIdx >= cs.container.childCount ||
			cs.isChildVerbatim[nextIdx] !== true
		) {
			return;
		}
		const nextGroupStart = cs.groupStartAt[nextIdx] ?? -1;
		const nextOrigIdx = cs.matchedOrigIndex[nextIdx] ?? -1;
		const nextOrig =
			nextOrigIdx >= 0 ? cs.source.blocks[nextOrigIdx] : undefined;
		const nextGroup =
			nextGroupStart === nextIdx ? nextOrig?.sharedGroup : undefined;
		const rawCandidate = nextGroup
			? nextGroup.raw
			: nextOrig && nextOrig.raw !== null
				? nextOrig.raw
				: null;
		if (rawCandidate === null) return;
		const prevEffIdx = cs.effectiveOrigIndex[changedIdx] ?? -1;
		const sep =
			nextOrigIdx >= 0 && prevEffIdx >= 0 && nextOrigIdx === prevEffIdx + 1
				? (nextGroup?.separatorBefore ?? nextOrig?.separatorBefore ?? "\n\n")
				: "\n\n";
		if (
			nextGroup !== undefined &&
			nextGroup.separatorBefore === "\n" &&
			(sep !== "\n" || prevEffIdx !== nextGroup.startIndex - 1)
		) {
			fireTask(cs.groupTasks.get(nextIdx));
			return;
		}
		const prevMatched = cs.matchedOrigIndex[changedIdx] ?? -1;
		const prevWasMatchedAdjacent =
			prevMatched >= 0 && nextOrigIdx >= 0 && nextOrigIdx === prevMatched + 1;
		const { indentedRisk, swallowRisk } = evaluateSlotRawRisks(
			cs.container.child(nextIdx),
			cs.depth,
			rawCandidate,
			sep,
			cs.container.child(changedIdx),
			cs.rawEmitted[changedIdx] ?? null,
			prevWasMatchedAdjacent,
			serializeBlock,
		);
		if (indentedRisk || swallowRisk) {
			fireTask(
				nextGroup ? cs.groupTasks.get(nextIdx) : cs.slotTasks.get(nextIdx),
			);
		}
	};

	const openContainer = (
		container: ProseMirrorNode,
		source: BuiltVisualBlockSources,
		depth: number,
		discover: boolean,
		deferInvalidation: boolean,
	): boolean => {
		const baselineBlocks = source.blocks;
		const newLen = container.childCount;
		const alignment =
			plan.containers.get(container) ??
			alignContainerChildren(container, baselineBlocks);
		plan.containers.set(container, alignment);
		const { matchedOrigIndex, pairedOrigIndex } = alignment;
		const invalidCheck = discover ? null : nodeHasCurrentInvalidatedRef;
		const sharedChecker = createTightSharedGroupChecker(
			container,
			baselineBlocks,
			matchedOrigIndex,
			pairedOrigIndex,
			parsed.blockquoteSources,
			invalidCheck,
		);

		const cs: ContainerState = {
			container,
			depth,
			effectiveOrigIndex: new Array<number>(newLen).fill(-1),
			groupStartAt: new Array<number>(newLen).fill(-1),
			groupTasks: new Map<number, InvalidationTask>(),
			isChildVerbatim: new Array<boolean>(newLen).fill(false),
			matchedOrigIndex,
			pairedOrigIndex,
			rawEmitted: new Array<string | null>(newLen).fill(null),
			slotCandidates: new Map<number, CandidatePartialRefDef[]>(),
			slotTasks: new Map<number, InvalidationTask>(),
			source,
		};
		const groupReverseLinks = new Map<number, InvalidationTask[]>();
		const linkGroupBreak = (
			triggerGroupStart: number,
			dependent: InvalidationTask,
		): void => {
			let list = groupReverseLinks.get(triggerGroupStart);
			if (!list) {
				list = [];
				groupReverseLinks.set(triggerGroupStart, list);
			}
			list.push(dependent);
		};

		let hasAny = false;
		let prevRawEmitted: string | null = null;
		for (let idx = 0; idx < newLen; idx += 1) {
			const child = container.child(idx);
			const origIdx = matchedOrigIndex[idx] ?? -1;
			const origBlock = origIdx >= 0 ? baselineBlocks[origIdx] : undefined;
			const sharedGroup = origBlock?.sharedGroup;
			let intactGroup =
				sharedGroup &&
				origIdx === sharedGroup.startIndex &&
				sharedChecker.isIntactSharedGroupAt(idx, sharedGroup) &&
				sharedChecker.isTightRightNeighborIntact(idx, sharedGroup) &&
				(!invalidCheck ||
					!sharedGroupHasInvalidatedRef(
						baselineBlocks,
						sharedGroup,
						invalidCheck,
					))
					? sharedGroup
					: undefined;
			const origInvalidated = Boolean(
				origBlock && invalidCheck?.(origBlock.node),
			);
			const rawCandidate = intactGroup
				? intactGroup.raw
				: origBlock && origBlock.raw !== null && !origInvalidated
					? origBlock.raw
					: null;

			const prevNode = idx > 0 ? container.child(idx - 1) : null;
			const prevMatched = idx > 0 ? (matchedOrigIndex[idx - 1] ?? -1) : -1;
			const prevEffIdx =
				idx > 0 ? (cs.effectiveOrigIndex[idx - 1] ?? -1) : -1;
			const prevWasMatchedAdjacent =
				prevMatched >= 0 && origIdx >= 0 && origIdx === prevMatched + 1;
			const sep =
				prevNode !== null &&
				origIdx >= 0 &&
				prevEffIdx >= 0 &&
				origIdx === prevEffIdx + 1
					? (intactGroup?.separatorBefore ?? origBlock?.separatorBefore ?? "\n\n")
					: "\n\n";
			const { indentedRisk, swallowRisk }: Readonly<{
				indentedRisk: boolean;
				swallowRisk: boolean;
			}> =
				rawCandidate !== null
					? evaluateSlotRawRisks(
							child,
							depth,
							rawCandidate,
							sep,
							prevNode,
							prevRawEmitted,
							prevWasMatchedAdjacent,
							serializeBlock,
						)
					: { indentedRisk: false, swallowRisk: false };
			const brokenTightLeft =
				intactGroup !== undefined &&
				intactGroup.separatorBefore === "\n" &&
				(sep !== "\n" || prevEffIdx !== intactGroup.startIndex - 1);
			if (intactGroup && (brokenTightLeft || indentedRisk || swallowRisk)) {
				intactGroup = undefined;
			}

			if (intactGroup) {
				const group = intactGroup;
				const groupStart = idx;
				const groupLen = group.endIndex - group.startIndex;
				for (let offset = 0; offset < groupLen; offset += 1) {
					const slot = groupStart + offset;
					cs.effectiveOrigIndex[slot] = group.startIndex + offset;
					cs.isChildVerbatim[slot] = true;
					cs.groupStartAt[slot] = groupStart;
					const memberChild = container.child(slot);
					if (discover) {
						if (isRawProtectedBlock(memberChild)) {
							if (registerRefDefNode(container, slot, memberChild)) hasAny = true;
						} else if (
							memberChild.childCount > 0 &&
							isBlockContainerForRefDefs(memberChild) &&
							walkSubtree(memberChild, "verbatim", true, deferInvalidation)
						) {
							hasAny = true;
						}
					}
				}
				cs.rawEmitted[groupStart + groupLen - 1] = group.raw;
				prevRawEmitted = group.raw;

				const breakGroupTask: InvalidationTask = {
					fired: false,
					run: () => {
						for (let offset = 0; offset < groupLen; offset += 1) {
							const slot = groupStart + offset;
							cs.isChildVerbatim[slot] = false;
							cs.effectiveOrigIndex[slot] = -1;
							cs.rawEmitted[slot] = null;
							const memberChild = container.child(slot);
							if (
								memberChild.childCount > 0 &&
								isBlockContainerForRefDefs(memberChild) &&
								subtreeHasCandidates.has(memberChild)
							) {
								walkSubtree(memberChild, "canonical", false, false);
							}
						}
						const attached = cs.slotCandidates.get(groupStart);
						if (attached) {
							for (const cand of attached) {
								evaluateContainerCandidate(cs, cand, false);
							}
						}
						const linked = groupReverseLinks.get(groupStart);
						if (linked) {
							for (const dep of linked) fireTask(dep);
						}
						recheckFollowingIndentRisks(cs, groupStart + groupLen - 1);
					},
				};
				cs.groupTasks.set(groupStart, breakGroupTask);
				for (let k = group.startIndex; k < group.endIndex; k += 1) {
					const memberBlock = baselineBlocks[k];
					if (memberBlock) registerNodeDependency(memberBlock.node, breakGroupTask);
				}
				idx += groupLen - 1;
				continue;
			}

			if (discover && isRawProtectedBlock(child)) {
				if (registerRefDefNode(container, idx, child)) hasAny = true;
			}

			if (origBlock && !sharedGroup && !origInvalidated) {
				cs.effectiveOrigIndex[idx] = origIdx;
				const verbatim: boolean =
					origBlock.raw !== null && !indentedRisk && !swallowRisk;
				cs.isChildVerbatim[idx] = verbatim;
				cs.rawEmitted[idx] = verbatim ? origBlock.raw : null;
				prevRawEmitted = verbatim ? origBlock.raw : null;
				if (verbatim) {
					if (
						discover &&
						child.childCount > 0 &&
						isBlockContainerForRefDefs(child) &&
						walkSubtree(child, "verbatim", true, deferInvalidation)
					) {
						hasAny = true;
					}
					const capturedIdx = idx;
					const capturedChild = child;
					const capturedOrig = origBlock;
					const breakChildTask: InvalidationTask = {
						fired: false,
						run: () => {
							cs.isChildVerbatim[capturedIdx] = false;
							cs.rawEmitted[capturedIdx] = null;
							if (
								capturedChild.childCount > 0 &&
								isBlockContainerForRefDefs(capturedChild) &&
								subtreeHasCandidates.has(capturedChild)
							) {
								descendNonVerbatimChild(
									capturedChild,
									capturedOrig,
									depth,
									false,
									false,
								);
							}
							const attached = cs.slotCandidates.get(capturedIdx);
							if (attached) {
								for (const cand of attached) {
									evaluateContainerCandidate(cs, cand, false);
								}
							}
							recheckFollowingIndentRisks(cs, capturedIdx);
						},
					};
					cs.slotTasks.set(capturedIdx, breakChildTask);
					registerNodeDependency(origBlock.node, breakChildTask);
				} else if (
					descendNonVerbatimChild(
						child,
						origBlock,
						depth,
						discover,
						deferInvalidation,
					)
				) {
					hasAny = true;
				}
				continue;
			}

			prevRawEmitted = null;
			const baseIdx =
				origBlock !== undefined ? origIdx : (pairedOrigIndex[idx] ?? -1);
			const baseBlock = baseIdx >= 0 ? baselineBlocks[baseIdx] : undefined;
			const canPreserveContainer =
				baseBlock !== undefined &&
				((isNestedList(child) &&
					baseBlock.raw !== null &&
					listAttrsCompatible(child, baseBlock.node)) ||
					(child.type.name === "blockquote" &&
						baseBlock.node.type.name === "blockquote" &&
						parsed.blockquoteSources?.get(baseBlock.node)?.blocks.length ===
							baseBlock.node.childCount));
			if (
				(origBlock && origInvalidated && (canPreserveContainer || !sharedGroup)) ||
				(!origBlock && canPreserveContainer)
			) {
				cs.effectiveOrigIndex[idx] = baseIdx;
			}
			if (
				descendNonVerbatimChild(
					child,
					baseBlock,
					depth,
					discover,
					deferInvalidation,
				)
			) {
				hasAny = true;
			}
		}

		// Wire tight-left and tight-right inter-group dependencies in O(newLen).
		for (const [groupStart, breakGroupTask] of cs.groupTasks) {
			const startOrigIdx = matchedOrigIndex[groupStart] ?? -1;
			const group =
				startOrigIdx >= 0
					? baselineBlocks[startOrigIdx]?.sharedGroup
					: undefined;
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
			const nextChild = container.child(afterIdx);
			registerNodeDependency(
				canPreserveContainerHeadStructurally(
					nextChild,
					nextOrig,
					parsed.blockquoteSources,
				)
					? nextOrig.node.child(0)
					: nextOrig.node,
				breakGroupTask,
			);
		}

		const directCandidates = candidatesByParent.get(container);
		if (directCandidates) {
			for (const cand of directCandidates) {
				evaluateContainerCandidate(cs, cand, deferInvalidation);
			}
		}

		if (hasAny) subtreeHasCandidates.add(container);
		return hasAny;
	};

	// Pass 1: single tree walk (purely structural, zero mid-walk invalidation).
	openContainer(doc, parsed, 0, true, true);

	// Seed FIFO queue with missing/shadowed baseline labels and initially-broken
	// partial-title refdefs.
	for (const label of firstByLabel.keys()) {
		if (!allIntact.has(label)) scheduleInvalidation(label, false);
	}
	for (let i = 0; i < deferredInvalidations.length; i += 1) {
		const label = deferredInvalidations[i];
		if (label !== undefined) scheduleInvalidation(label, false);
	}

	// Pass 2: O(N + E) worklist propagation (every task fires at most once).
	let queueHead = 0;
	while (queueHead < invalidQueue.length) {
		const label = invalidQueue[queueHead];
		queueHead += 1;
		if (label === undefined) continue;
		const deps = dependentsByLabel.get(label);
		if (!deps) continue;
		dependentsByLabel.delete(label);
		for (const task of deps) fireTask(task);
	}

	return { allIntact, partialTitleIntact, plan };
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
	const hasRefs =
		(parsed.referenceLinks && parsed.referenceLinks.size > 0) ||
		(parsed.referenceImages && parsed.referenceImages.size > 0) ||
		(parsed.referencedLabelsByNode && parsed.referencedLabelsByNode.size > 0);
	if (!hasRefs || totalRefDefs === 0 || allIntact.size >= totalRefDefs) {
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
