import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
	endsWithBlankBlockquoteLine,
	isListSwallowingFollowingBlock,
	leadingIndentAtDepth,
	listAttrsCompatible,
	resolvePreservedListItemReusability,
	stripAtDepth,
} from "./markdown-container-preservation";
import { normalizeReferenceLabel } from "./markdown-escape";
import {
	type BlockSerializer,
	isNestedList,
	nodePreventsFollowingIndentedCode,
} from "./markdown-list-serialization";
import {
	alignNodes,
	childrenOf,
	pairUnmatched,
	structurallyEqual,
} from "./markdown-node-alignment";
import {
	type BuiltVisualBlockSources,
	extractReferenceDefinitionLabels,
	inspectReferenceDefinitionBlock,
	type ParsedVisualBlockSource,
	type ParsedVisualDocument,
	type ParsedVisualSharedGroup,
	type ReferenceImageOrigin,
	type ReferenceLinkOrigin,
	wouldReferenceDefinitionAbsorbFollowingBlock,
} from "./markdown-parser";
import { extractPhpPartialReferenceTitle } from "./markdown-reference-preservation";

/**
 * Reference-definition liveness, partial-title follower validation, and unified
 * memoized tight shared-group integrity checking for untouched-source
 * preservation (`markdown-block-preservation.ts`).
 */

export type ReferencePreserveResolver = Readonly<{
	isPartialTitleRefDef: (node: ProseMirrorNode) => boolean;
	resolveImage: (node: ProseMirrorNode) => ReferenceImageOrigin | null;
	resolveLink: (mark: Mark) => ReferenceLinkOrigin | null;
}>;

export type TightSharedGroupChecker = Readonly<{
	isIntactSharedGroupAt: (
		childIdx: number,
		group: ParsedVisualSharedGroup,
	) => boolean;
	isTightRightNeighborIntact: (
		startIdx: number,
		startGroup: ParsedVisualSharedGroup,
	) => boolean;
}>;

export function sharedGroupHasInvalidatedRef(
	baselineBlocks: ReadonlyArray<ParsedVisualBlockSource>,
	group: ParsedVisualSharedGroup,
	nodeHasInvalidatedRef: (node: ProseMirrorNode) => boolean,
): boolean {
	for (let k = group.startIndex; k < group.endIndex; k += 1) {
		const member = baselineBlocks[k];
		if (member && nodeHasInvalidatedRef(member.node)) {
			return true;
		}
	}
	return false;
}

/**
 * Single memoized O(N) checker for tight shared-group chains shared by both
 * `computeIntactRefDefLabels` and `serializeContainerPreservingChildren`.
 */
export function createTightSharedGroupChecker(
	container: ProseMirrorNode,
	baselineBlocks: ReadonlyArray<ParsedVisualBlockSource>,
	matchedOrigIndex: ReadonlyArray<number>,
	pairedOrigIndex: ReadonlyArray<number>,
	blockquoteSources:
		| ReadonlyMap<ProseMirrorNode, BuiltVisualBlockSources>
		| undefined,
	nodeHasInvalidatedRef: ((node: ProseMirrorNode) => boolean) | null,
): TightSharedGroupChecker {
	const newLen = container.childCount;
	const isIntactSharedGroupAt = (
		childIdx: number,
		group: ParsedVisualSharedGroup,
	): boolean => {
		const len = group.endIndex - group.startIndex;
		if (childIdx + len > newLen) return false;
		for (let offset = 0; offset < len; offset += 1) {
			if (matchedOrigIndex[childIdx + offset] !== group.startIndex + offset) {
				return false;
			}
		}
		return true;
	};

	const memo = new Map<number, boolean>();
	const isTightRightNeighborIntact = (
		startIdx: number,
		startGroup: ParsedVisualSharedGroup,
	): boolean => {
		const cachedStart = memo.get(startGroup.startIndex);
		if (cachedStart !== undefined) return cachedStart;
		const chain: number[] = [];
		let curIdx = startIdx;
		let curGroup = startGroup;
		let intact = true;
		while (true) {
			const cached = memo.get(curGroup.startIndex);
			if (cached !== undefined) {
				intact = cached;
				break;
			}
			chain.push(curGroup.startIndex);
			const nextOrig = baselineBlocks[curGroup.endIndex];
			if (!nextOrig) break;
			const nextGroup =
				nextOrig.sharedGroup?.startIndex === curGroup.endIndex
					? nextOrig.sharedGroup
					: undefined;
			const nextSep = nextGroup
				? nextGroup.separatorBefore
				: nextOrig.separatorBefore;
			if (nextSep !== "\n") break;
			const afterIdx = curIdx + (curGroup.endIndex - curGroup.startIndex);
			if (afterIdx >= newLen) {
				intact = false;
				break;
			}
			const nextChild = container.child(afterIdx);
			const nextMatchedDirect =
				matchedOrigIndex[afterIdx] === curGroup.endIndex &&
				(!nodeHasInvalidatedRef ||
					nextGroup !== undefined ||
					!nodeHasInvalidatedRef(nextOrig.node));
			if (!nextMatchedDirect) {
				// A non-shared paired container (blockquote or compatible list)
				// whose first child is untouched and not ref-invalidated keeps the
				// exact same leading boundary line (e.g. editing `z -> z!` inside
				// `> [r]: /u\n> "a $$x$$\n> b"\n>\n> [r]\n> z`).
				const canPreserveContainerHead =
					!nextGroup &&
					(matchedOrigIndex[afterIdx] === curGroup.endIndex ||
						pairedOrigIndex[afterIdx] === curGroup.endIndex) &&
					nextChild.childCount > 0 &&
					nextOrig.node.childCount > 0 &&
					structurallyEqual(nextChild.child(0), nextOrig.node.child(0)) &&
					!nodeHasInvalidatedRef?.(nextOrig.node.child(0)) &&
					((nextChild.type.name === "blockquote" &&
						nextOrig.node.type.name === "blockquote" &&
						Boolean(blockquoteSources?.has(nextOrig.node))) ||
						(isNestedList(nextChild) &&
							listAttrsCompatible(nextChild, nextOrig.node) &&
							nextOrig.raw !== null));
				if (!canPreserveContainerHead) {
					intact = false;
				}
				break;
			}
			if (!nextGroup) break;
			if (
				!isIntactSharedGroupAt(afterIdx, nextGroup) ||
				(nodeHasInvalidatedRef !== null &&
					sharedGroupHasInvalidatedRef(
						baselineBlocks,
						nextGroup,
						nodeHasInvalidatedRef,
					))
			) {
				intact = false;
				break;
			}
			curIdx = afterIdx;
			curGroup = nextGroup;
		}
		for (let k = 0; k < chain.length; k += 1) {
			const key = chain[k];
			if (key !== undefined) memo.set(key, intact);
		}
		return intact;
	};

	return { isIntactSharedGroupAt, isTightRightNeighborIntact };
}

type ContainerAnalysis = Readonly<{
	effectiveOrigIndex: ReadonlyArray<number>;
	isChildVerbatim: ReadonlyArray<boolean>;
	matchedOrigIndex: ReadonlyArray<number>;
	pairedOrigIndex: ReadonlyArray<number>;
}>;

type WalkPreservationMode =
	| Readonly<{ kind: "verbatim" }>
	| Readonly<{ kind: "canonical" }>
	| Readonly<{
			depth: number;
			kind: "container";
			source: BuiltVisualBlockSources;
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

function isDeferredTaskParagraph(
	parent: ProseMirrorNode,
	childIdx: number,
): boolean {
	if (parent.type.name !== "task_item" || parent.childCount <= 1) {
		return false;
	}
	const first = parent.child(0);
	if (first.type.name !== "paragraph" || first.childCount !== 0) {
		return false;
	}
	for (let i = 1; i < childIdx; i += 1) {
		const sibling = parent.child(i);
		const raw =
			sibling.type.name === "protected_block" &&
			sibling.attrs.kind === "raw" &&
			typeof sibling.attrs.rawMarkdown === "string"
				? sibling.attrs.rawMarkdown
				: "";
		if (!inspectReferenceDefinitionBlock(raw).isRefDef) {
			return false;
		}
	}
	return parent.child(childIdx).type.name === "paragraph";
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
	if (isDeferredTaskParagraph(parent, refIdx + 1)) {
		return false;
	}
	const refRaw =
		typeof refNode.attrs.rawMarkdown === "string"
			? refNode.attrs.rawMarkdown
			: "";
	const refInfo = inspectReferenceDefinitionBlock(refRaw);
	if (!refInfo.isRefDef || refInfo.lastHasTitle) {
		return false;
	}
	const serializedNext = serializeBlock(nextSibling);
	const nl = serializedNext.indexOf("\n");
	const firstLine = nl === -1 ? serializedNext : serializedNext.slice(0, nl);
	if (!/^[ \t]*["'(]/.test(firstLine)) {
		return false;
	}
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

function canPreserveChildContainer(
	child: ProseMirrorNode,
	baseBlock: ParsedVisualBlockSource | undefined,
	depth: number,
	parsed: ParsedVisualDocument,
): boolean {
	if (!baseBlock) return false;
	if (isNestedList(child) && baseBlock.raw !== null) {
		return (
			resolvePreservedListItemReusability(
				child,
				baseBlock,
				depth,
				parsed.envReferences,
				null,
			) !== null
		);
	}
	if (
		child.type.name === "blockquote" &&
		baseBlock.node.type.name === "blockquote"
	) {
		const bqSource = parsed.blockquoteSources?.get(baseBlock.node);
		return Boolean(
			bqSource && bqSource.blocks.length === baseBlock.node.childCount,
		);
	}
	return false;
}

function analyzeContainerChildren(
	container: ProseMirrorNode,
	source: BuiltVisualBlockSources,
	depth: number,
	parsed: ParsedVisualDocument,
	nodeHasInvalidatedRef: ((node: ProseMirrorNode) => boolean) | null,
	serializeBlock: BlockSerializer,
): ContainerAnalysis {
	const baselineBlocks = source.blocks;
	const newLen = container.childCount;
	const matchedOrigIndex = alignNodes(
		childrenOf(container),
		baselineBlocks.map((block) => block.node),
		structurallyEqual,
	);
	const pairedOrigIndex = pairUnmatched(
		matchedOrigIndex,
		baselineBlocks.length,
	);
	const effectiveOrigIndex = new Array<number>(newLen).fill(-1);
	const isChildVerbatim = new Array<boolean>(newLen).fill(false);
	const sharedChecker = createTightSharedGroupChecker(
		container,
		baselineBlocks,
		matchedOrigIndex,
		pairedOrigIndex,
		parsed.blockquoteSources,
		nodeHasInvalidatedRef,
	);

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
			(!nodeHasInvalidatedRef ||
				!sharedGroupHasInvalidatedRef(
					baselineBlocks,
					sharedGroup,
					nodeHasInvalidatedRef,
				))
				? sharedGroup
				: undefined;
		const origInvalidated = Boolean(
			origBlock && nodeHasInvalidatedRef?.(origBlock.node),
		);
		const rawCandidate = intactGroup
			? intactGroup.raw
			: origBlock && origBlock.raw !== null && !origInvalidated
				? origBlock.raw
				: null;

		const prevNode = idx > 0 ? container.child(idx - 1) : null;
		const prevMatched = idx > 0 ? (matchedOrigIndex[idx - 1] ?? -1) : -1;
		const prevEffIdx = idx > 0 ? (effectiveOrigIndex[idx - 1] ?? -1) : -1;
		const prevWasMatchedAdjacent =
			prevMatched >= 0 && origIdx >= 0 && origIdx === prevMatched + 1;
		const inheritedSep =
			prevNode !== null &&
			origIdx >= 0 &&
			prevEffIdx >= 0 &&
			origIdx === prevEffIdx + 1
				? (intactGroup?.separatorBefore ?? origBlock?.separatorBefore)
				: undefined;
		const sep = inheritedSep ?? "\n\n";

		let swallowRisk = false;
		let indentedRisk = false;
		if (rawCandidate !== null) {
			const leadIndent = leadingIndentAtDepth(rawCandidate, depth);
			if (leadIndent > 0 && prevNode !== null) {
				const needsPrevInner =
					(leadIndent >= 4 &&
						child.type.name !== "code_block" &&
						sep === "\n" &&
						nodePreventsFollowingIndentedCode(prevNode)) ||
					(!prevWasMatchedAdjacent && isNestedList(prevNode));
				const prevInner: string = needsPrevInner
					? prevRawEmitted !== null
						? stripAtDepth(prevRawEmitted, depth)
						: serializeBlock(prevNode)
					: "";
				if (child.type.name !== "code_block" && leadIndent >= 4) {
					indentedRisk =
						sep !== "\n" ||
						!nodePreventsFollowingIndentedCode(prevNode) ||
						endsWithBlankBlockquoteLine(prevInner);
				}
				if (!prevWasMatchedAdjacent && isNestedList(prevNode)) {
					swallowRisk = isListSwallowingFollowingBlock(
						prevNode,
						prevInner,
						stripAtDepth(rawCandidate, depth),
						false,
					);
				}
			} else if (child.type.name !== "code_block" && leadIndent >= 4) {
				indentedRisk = true;
			}
		}

		const brokenTightLeft =
			intactGroup !== undefined &&
			intactGroup.separatorBefore === "\n" &&
			(sep !== "\n" || prevEffIdx !== intactGroup.startIndex - 1);
		if (intactGroup && (brokenTightLeft || indentedRisk || swallowRisk)) {
			intactGroup = undefined;
		}

		if (intactGroup) {
			const groupLen = intactGroup.endIndex - intactGroup.startIndex;
			for (let offset = 0; offset < groupLen; offset += 1) {
				effectiveOrigIndex[idx + offset] = intactGroup.startIndex + offset;
				isChildVerbatim[idx + offset] = true;
			}
			prevRawEmitted = intactGroup.raw;
			idx += groupLen - 1;
			continue;
		}

		if (origBlock && !sharedGroup && !origInvalidated) {
			effectiveOrigIndex[idx] = origIdx;
			const verbatim: boolean =
				origBlock.raw !== null && !indentedRisk && !swallowRisk;
			isChildVerbatim[idx] = verbatim;
			prevRawEmitted = verbatim ? origBlock.raw : null;
		} else if (origBlock && origInvalidated) {
			if (
				canPreserveChildContainer(child, origBlock, depth, parsed) ||
				!sharedGroup
			) {
				effectiveOrigIndex[idx] = origIdx;
			}
			prevRawEmitted = null;
		} else if (!origBlock) {
			const pairedIdx = pairedOrigIndex[idx] ?? -1;
			const pairedBlock =
				pairedIdx >= 0 ? baselineBlocks[pairedIdx] : undefined;
			if (canPreserveChildContainer(child, pairedBlock, depth, parsed)) {
				effectiveOrigIndex[idx] = pairedIdx;
			}
			prevRawEmitted = null;
		} else {
			prevRawEmitted = null;
		}
	}

	return {
		effectiveOrigIndex,
		isChildVerbatim,
		matchedOrigIndex,
		pairedOrigIndex,
	};
}

function hasPartialTitleFollowerSibling(
	parent: ProseMirrorNode,
	refIdx: number,
	refNode: ProseMirrorNode,
	label: string,
	parsed: ParsedVisualDocument,
	mode: WalkPreservationMode,
	containerAnalysis: ContainerAnalysis | null,
	serializeBlock: BlockSerializer,
): boolean {
	if (refIdx + 1 >= parent.childCount) {
		return false;
	}
	const nextSibling = parent.child(refIdx + 1);
	if (
		nextSibling.type.name !== "paragraph" &&
		nextSibling.type.name !== "heading" &&
		nextSibling.type.name !== "table"
	) {
		return false;
	}
	if (mode.kind === "verbatim") {
		return true;
	}
	if (mode.kind === "container" && containerAnalysis !== null) {
		const refEffIdx = containerAnalysis.effectiveOrigIndex[refIdx] ?? -1;
		const nextOrigIdx = containerAnalysis.matchedOrigIndex[refIdx + 1] ?? -1;
		const refOrig = refEffIdx >= 0 ? mode.source.blocks[refEffIdx] : undefined;
		const nextOrig =
			nextOrigIdx >= 0 ? mode.source.blocks[nextOrigIdx] : undefined;
		const nextGroup =
			nextOrig?.sharedGroup?.startIndex === nextOrigIdx
				? nextOrig.sharedGroup
				: undefined;
		const nextSep = nextGroup
			? nextGroup.separatorBefore
			: nextOrig?.separatorBefore;
		const nextVerbatimTight =
			containerAnalysis.isChildVerbatim[refIdx + 1] === true &&
			refEffIdx >= 0 &&
			nextOrigIdx === refEffIdx + 1 &&
			(nextSep === "\n" ||
				(refOrig?.sharedGroup !== undefined &&
					refOrig.sharedGroup === nextOrig?.sharedGroup));
		if (nextVerbatimTight) {
			return true;
		}
	}
	// Canonical serialization always emits headings as ATX (`# ...`) and tables
	// as pipe rows (`| ... |` / alignment comment), neither of which can carry a
	// PHP partial reference title.
	if (nextSibling.type.name !== "paragraph") {
		return false;
	}
	return canonicalParagraphPreservesPartialTitle(
		parent,
		refIdx,
		refNode,
		nextSibling,
		label,
		parsed,
		serializeBlock,
	);
}

/**
 * Single recursive tree-order walker over `doc` determining which baseline
 * reference definitions remain alive and unshadowed at every nesting depth
 * (top-level, lists, list items, and nested blockquotes), converging to a
 * fixed point when an invalidated reference definition forces a partial-title
 * follower container or block to fall back to canonical serialization.
 */
export function computeIntactRefDefLabels(
	doc: ProseMirrorNode,
	parsed: ParsedVisualDocument,
	serializeBlock: BlockSerializer,
): Readonly<{
	allIntact: Set<string>;
	partialTitleIntact: Set<string>;
}> {
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
		};
	}
	const partialLabels = parsed.phpPartialTitleRefLabels;
	const hasPartialLabels =
		partialLabels !== undefined && partialLabels.size > 0;

	const runPass = (
		nodeHasInvalidatedRef: ((node: ProseMirrorNode) => boolean) | null,
	): Readonly<{
		allIntact: Set<string>;
		partialTitleIntact: Set<string>;
	}> => {
		const allIntact = new Set<string>();
		const partialTitleIntact = new Set<string>();
		const seenLabels = new Set<string>();

		const walk = (
			parent: ProseMirrorNode,
			mode: WalkPreservationMode,
		): void => {
			const analysis =
				hasPartialLabels && mode.kind === "container"
					? analyzeContainerChildren(
							parent,
							mode.source,
							mode.depth,
							parsed,
							nodeHasInvalidatedRef,
							serializeBlock,
						)
					: null;

			for (let i = 0; i < parent.childCount; i += 1) {
				const child = parent.child(i);
				if (
					child.type.name === "protected_block" &&
					child.attrs.kind === "raw" &&
					typeof child.attrs.rawMarkdown === "string"
				) {
					const origLabels = labelsByNode.get(child);
					if (origLabels) {
						for (const label of origLabels) {
							if (seenLabels.has(label)) continue;
							seenLabels.add(label);
							if (firstByLabel.get(label) !== child) continue;
							if (partialLabels?.has(label)) {
								if (
									hasPartialTitleFollowerSibling(
										parent,
										i,
										child,
										label,
										parsed,
										mode,
										analysis,
										serializeBlock,
									)
								) {
									allIntact.add(label);
									partialTitleIntact.add(label);
								}
							} else {
								allIntact.add(label);
							}
						}
					} else {
						const newLabels = extractReferenceDefinitionLabels(
							child.attrs.rawMarkdown,
						);
						if (newLabels) {
							for (const rawLabel of newLabels) {
								seenLabels.add(normalizeReferenceLabel(rawLabel));
							}
						}
					}
					continue;
				}
				if (child.childCount === 0 || !isBlockContainerForRefDefs(child)) {
					continue;
				}
				if (!hasPartialLabels) {
					walk(child, mode);
					continue;
				}
				if (mode.kind === "verbatim" || mode.kind === "canonical") {
					walk(child, mode);
					continue;
				}
				if (analysis?.isChildVerbatim[i] === true) {
					walk(child, { kind: "verbatim" });
					continue;
				}
				const origIdx = analysis?.matchedOrigIndex[i] ?? -1;
				const pairedIdx = analysis?.pairedOrigIndex[i] ?? -1;
				const baseIdx = origIdx >= 0 ? origIdx : pairedIdx;
				const baseBlock =
					baseIdx >= 0 ? mode.source.blocks[baseIdx] : undefined;
				if (
					child.type.name === "blockquote" &&
					baseBlock?.node.type.name === "blockquote"
				) {
					const bqSource = parsed.blockquoteSources?.get(baseBlock.node);
					if (
						bqSource &&
						bqSource.blocks.length === baseBlock.node.childCount
					) {
						walk(child, {
							depth: mode.depth + 1,
							kind: "container",
							source: bqSource,
						});
						continue;
					}
				}
				if (isNestedList(child) && baseBlock) {
					const itemReusability = resolvePreservedListItemReusability(
						child,
						baseBlock,
						mode.depth,
						parsed.envReferences,
						nodeHasInvalidatedRef,
					);
					if (itemReusability !== null) {
						for (let itemIdx = 0; itemIdx < child.childCount; itemIdx += 1) {
							walk(child.child(itemIdx), {
								kind: itemReusability[itemIdx] ? "verbatim" : "canonical",
							});
						}
						continue;
					}
				}
				walk(child, { kind: "canonical" });
			}
		};

		walk(doc, { depth: 0, kind: "container", source: parsed });
		return { allIntact, partialTitleIntact };
	};

	let result = runPass(null);
	while (
		hasPartialLabels &&
		result.partialTitleIntact.size > 0 &&
		result.allIntact.size < firstByLabel.size
	) {
		const { hasInvalidatedRefDefs, nodeHasInvalidatedRef } =
			createInvalidatedRefChecker(parsed, result.allIntact);
		if (!hasInvalidatedRefDefs) break;
		const next = runPass(nodeHasInvalidatedRef);
		if (next.allIntact.size >= result.allIntact.size) break;
		result = next;
	}
	return result;
}

export function buildReferencePreserveResolver(
	parsed: ParsedVisualDocument,
	partialTitleIntact: ReadonlySet<string>,
	hasRefSerializer: boolean,
): ReferencePreserveResolver | null {
	if (partialTitleIntact.size === 0 || !hasRefSerializer) {
		return null;
	}
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
		let invalidated = false;
		const blockLabels = parsed.referencedLabelsByNode?.get(node);
		if (blockLabels) {
			for (const label of blockLabels) {
				if (!allIntact.has(label)) {
					invalidated = true;
					break;
				}
			}
		}
		if (!invalidated && node.type.name === "image") {
			const origin = parsed.referenceImages?.get(node);
			if (origin && !allIntact.has(origin.normalizedLabel)) {
				invalidated = true;
			}
		}
		if (!invalidated && node.marks.length > 0 && parsed.referenceLinks) {
			for (let m = 0; m < node.marks.length; m += 1) {
				const mark = node.marks[m];
				if (mark && mark.type.name === "link") {
					const origin = parsed.referenceLinks.get(mark);
					if (origin && !allIntact.has(origin.normalizedLabel)) {
						invalidated = true;
						break;
					}
				}
			}
		}
		if (!invalidated && node.childCount > 0) {
			for (let i = 0; i < node.childCount; i += 1) {
				if (check(node.child(i))) {
					invalidated = true;
					break;
				}
			}
		}
		cache.set(node, invalidated);
		return invalidated;
	};
	return { hasInvalidatedRefDefs: true, nodeHasInvalidatedRef: check };
}
