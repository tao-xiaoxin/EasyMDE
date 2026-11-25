import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
	collectIntactRefDefLabelsInBlockquote,
	serializeBlockquotePreservingChildren,
} from "./markdown-blockquote-preservation";
import {
	collectIntactRefDefLabelsInList,
	collectNodeRefDefLabels,
	endsWithBlankBlockquoteLine,
	isListSwallowingFollowingBlock,
	recordMatchedNodeRefDefs,
	serializeListPreservingItems,
	wouldBeLazilyAbsorbedByPrevious,
} from "./markdown-container-preservation";
import {
	type BlockSerializer,
	isNestedList,
	joinSerializedBlocks,
	LEADING_FOUR_COLUMN_INDENT,
	nodeCanLazilyContinue,
	nodePreventsFollowingIndentedCode,
	refDefContinuationMode,
} from "./markdown-list-serialization";
import {
	alignNodes,
	childrenOf,
	pairUnmatched,
	structurallyEqual,
} from "./markdown-node-alignment";
import {
	type BuiltVisualBlockSources,
	type MergedReferenceLinkRun,
	type ParsedVisualDocument,
	type ParsedVisualSharedGroup,
	parseMarkdownWithBlockSources,
	type ReferenceImageOrigin,
	type ReferenceLinkOrigin,
} from "./markdown-parser";

export {
	type BlockSerializer,
	createMathNewlineSentinelForNode,
	joinSerializedBlocks,
	needsTightRefDefContinuation,
	refDefContinuationMode,
	restoreMathNewlineSentinel,
	serializeList,
} from "./markdown-list-serialization";

/**
 * Untouched-source preservation for the immersive visual editor.
 *
 * The visual editor is an in-memory projection of canonical Markdown. When a
 * legitimate edit is synchronized back, every block (and every untouched item
 * of an edited top-level list or untouched child of an edited top-level
 * blockquote) keeps its exact original bytes, including blank-line separators.
 * Only edited nodes are regenerated.
 *
 * Block/inline serialization is injected by `markdown-serializer.ts`, keeping
 * the dependency direction one-way (serializer -> preservation).
 */

export type ReferencePreserveResolver = Readonly<{
	isPartialTitleRefDef: (node: ProseMirrorNode) => boolean;
	resolveImage: (node: ProseMirrorNode) => ReferenceImageOrigin | null;
	resolveLink: (mark: Mark) => ReferenceLinkOrigin | null;
	resolveMergedLinkRuns: (
		node: ProseMirrorNode,
	) => ReadonlyArray<MergedReferenceLinkRun> | null;
}>;

export type MarkdownRoundTripGuard = Readonly<{
	initialDoc: ProseMirrorNode;
	initialMarkdown: string;
	isUnmodified: (doc: ProseMirrorNode) => boolean;
	serialize: (doc: ProseMirrorNode) => string;
}>;

export type MarkdownSerializers = Readonly<{
	serializeBlock: BlockSerializer;
	serializeBlockWithRefs?: (
		node: ProseMirrorNode,
		resolveReferences: ReferencePreserveResolver | null,
		mathNewlineToken?: string,
	) => string;
	serializeDoc: (doc: ProseMirrorNode) => string;
}>;

function isEmptyDoc(doc: ProseMirrorNode): boolean {
	return (
		doc.childCount === 1 &&
		doc.firstChild?.type.name === "paragraph" &&
		doc.firstChild.childCount === 0
	);
}

function computeIntactRefDefLabels(
	doc: ProseMirrorNode,
	parsed: ParsedVisualDocument,
	matchedOrigIndex: ReadonlyArray<number>,
	pairedOrigIndex: ReadonlyArray<number>,
	serializers: MarkdownSerializers,
): Set<string> {
	const intactRefDefLabels = new Set<string>();
	const hasRefs =
		(parsed.referenceLinks && parsed.referenceLinks.size > 0) ||
		(parsed.referenceImages && parsed.referenceImages.size > 0) ||
		(parsed.mergedReferenceLinkRuns &&
			parsed.mergedReferenceLinkRuns.size > 0);
	if (
		!hasRefs ||
		!parsed.phpPartialTitleRefLabels ||
		parsed.phpPartialTitleRefLabels.size === 0 ||
		!parsed.refDefLabelsByBlock ||
		parsed.refDefLabelsByBlock.size === 0 ||
		!serializers.serializeBlockWithRefs
	) {
		return intactRefDefLabels;
	}
	const baselineBlocks = parsed.blocks;
	const seenLabels = new Set<string>();
	for (let idx = 0; idx < doc.childCount; idx += 1) {
		const child = doc.child(idx);
		const origIdx = matchedOrigIndex[idx] ?? -1;
		if (origIdx >= 0) {
			const origNode = baselineBlocks[origIdx]?.node;
			if (origNode) {
				recordMatchedNodeRefDefs(
					origNode,
					origIdx,
					parsed,
					seenLabels,
					intactRefDefLabels,
				);
			}
			continue;
		}
		const pairedIdx = pairedOrigIndex[idx] ?? -1;
		const pairedBlock =
			pairedIdx >= 0 ? baselineBlocks[pairedIdx] : undefined;
		if (isNestedList(child) && pairedBlock && pairedBlock.raw !== null) {
			collectIntactRefDefLabelsInList(
				child,
				pairedBlock,
				pairedIdx,
				parsed,
				seenLabels,
				intactRefDefLabels,
			);
			continue;
		}
		if (
			child.type.name === "blockquote" &&
			pairedBlock &&
			pairedBlock.node.type.name === "blockquote" &&
			parsed.blockquoteSources?.has(pairedBlock.node)
		) {
			collectIntactRefDefLabelsInBlockquote(
				child,
				pairedBlock.node,
				pairedIdx,
				parsed,
				seenLabels,
				intactRefDefLabels,
			);
			continue;
		}
		collectNodeRefDefLabels(child, seenLabels);
	}
	return intactRefDefLabels;
}

function buildReferencePreserveResolver(
	parsed: ParsedVisualDocument,
	intactRefDefLabels: ReadonlySet<string>,
	serializers: MarkdownSerializers,
): ReferencePreserveResolver | null {
	if (intactRefDefLabels.size === 0 || !serializers.serializeBlockWithRefs) {
		return null;
	}
	const partialTitleRefNodes = new Set<ProseMirrorNode>();
	if (parsed.firstRefDefNodeByLabel) {
		for (const label of intactRefDefLabels) {
			const refNode = parsed.firstRefDefNodeByLabel.get(label);
			if (refNode) partialTitleRefNodes.add(refNode);
		}
	}
	return {
		isPartialTitleRefDef: (node) => partialTitleRefNodes.has(node),
		resolveImage: (node) => {
			const origin = parsed.referenceImages?.get(node);
			return origin && intactRefDefLabels.has(origin.normalizedLabel)
				? origin
				: null;
		},
		resolveLink: (mark) => {
			const origin = parsed.referenceLinks?.get(mark);
			return origin && intactRefDefLabels.has(origin.normalizedLabel)
				? origin
				: null;
		},
		resolveMergedLinkRuns: (node) => {
			const runs = parsed.mergedReferenceLinkRuns?.get(node);
			if (!runs || runs.length < 2) {
				return null;
			}
			let hasActive = false;
			const filtered = runs.map((run) => {
				const active =
					run.origin !== null &&
					intactRefDefLabels.has(run.origin.normalizedLabel)
						? run.origin
						: null;
				if (active !== null) hasActive = true;
				return active === run.origin ? run : { ...run, origin: active };
			});
			return hasActive ? filtered : null;
		},
	};
}

function serializeDocPreservingUntouchedBlocks(
	doc: ProseMirrorNode,
	parsed: ParsedVisualDocument,
	serializers: MarkdownSerializers,
): string {
	if (isEmptyDoc(doc)) {
		return "";
	}
	const baselineBlocks = parsed.blocks;
	if (baselineBlocks.length === 0) {
		return serializers.serializeDoc(doc);
	}

	const newLen = doc.childCount;
	const origLen = baselineBlocks.length;
	const matchedOrigIndex = alignNodes(
		childrenOf(doc),
		baselineBlocks.map((block) => block.node),
		structurallyEqual,
	);
	const pairedOrigIndex = pairUnmatched(matchedOrigIndex, origLen);
	const effectiveOrigIndex = new Array<number>(newLen).fill(-1);

	const keepLeadingPrefix = matchedOrigIndex[0] === 0;
	const parts: string[] = [];
	if (keepLeadingPrefix && parsed.leadingPrefix.length > 0) {
		parts.push(parsed.leadingPrefix);
	}
	const isIntactSharedGroupAt = (
		docIdx: number,
		group: ParsedVisualSharedGroup,
	): boolean => {
		const len = group.endIndex - group.startIndex;
		if (docIdx + len > newLen) return false;
		for (let offset = 0; offset < len; offset += 1) {
			if (matchedOrigIndex[docIdx + offset] !== group.startIndex + offset) {
				return false;
			}
		}
		return true;
	};
	const isTightRightNeighborIntact = (() => {
		const memo = new Map<number, boolean>();
		return (
			startDocIdx: number,
			startGroup: ParsedVisualSharedGroup,
		): boolean => {
			const cachedStart = memo.get(startGroup.startIndex);
			if (cachedStart !== undefined) {
				return cachedStart;
			}
			const chain: number[] = [];
			let curDocIdx = startDocIdx;
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
				if (!nextOrig) {
					break;
				}
				const nextGroup =
					nextOrig.sharedGroup?.startIndex === curGroup.endIndex
						? nextOrig.sharedGroup
						: undefined;
				const nextSep = nextGroup
					? nextGroup.separatorBefore
					: nextOrig.separatorBefore;
				if (nextSep !== "\n") {
					break;
				}
				const afterDocIdx =
					curDocIdx + (curGroup.endIndex - curGroup.startIndex);
				if (
					afterDocIdx >= newLen ||
					matchedOrigIndex[afterDocIdx] !== curGroup.endIndex
				) {
					intact = false;
					break;
				}
				if (!nextGroup) {
					break;
				}
				if (!isIntactSharedGroupAt(afterDocIdx, nextGroup)) {
					intact = false;
					break;
				}
				curDocIdx = afterDocIdx;
				curGroup = nextGroup;
			}
			for (let k = 0; k < chain.length; k += 1) {
				const key = chain[k];
				if (key !== undefined) {
					memo.set(key, intact);
				}
			}
			return intact;
		};
	})();
	const intactRefDefLabels = computeIntactRefDefLabels(
		doc,
		parsed,
		matchedOrigIndex,
		pairedOrigIndex,
		serializers,
	);
	const intactRefDefBlocks = new Set<number>();
	if (intactRefDefLabels.size > 0 && parsed.firstRefDefBlockByLabel) {
		for (const label of intactRefDefLabels) {
			const blockIdx = parsed.firstRefDefBlockByLabel.get(label);
			if (blockIdx !== undefined) {
				intactRefDefBlocks.add(blockIdx);
			}
		}
	}
	const resolveReferences = buildReferencePreserveResolver(
		parsed,
		intactRefDefLabels,
		serializers,
	);
	const activeSerializeBlock: BlockSerializer =
		resolveReferences !== null && serializers.serializeBlockWithRefs
			? (node, mathNewlineToken) =>
					serializers.serializeBlockWithRefs?.(
						node,
						resolveReferences,
						mathNewlineToken,
					) ?? serializers.serializeBlock(node, mathNewlineToken)
			: serializers.serializeBlock;
	let prevBlockText = "";
	for (let idx = 0; idx < newLen; idx += 1) {
		const child = doc.child(idx);
		const origIdx = matchedOrigIndex[idx] ?? -1;
		const origBlock = origIdx >= 0 ? baselineBlocks[origIdx] : undefined;
		const sharedGroup = origBlock?.sharedGroup;
		let intactGroup =
			sharedGroup &&
			origIdx === sharedGroup.startIndex &&
			isIntactSharedGroupAt(idx, sharedGroup) &&
			isTightRightNeighborIntact(idx, sharedGroup)
				? sharedGroup
				: undefined;
		let serialized: string | null = intactGroup
			? intactGroup.raw
			: origBlock && origBlock.raw !== null
				? origBlock.raw
				: null;
		if (intactGroup || (origBlock && !sharedGroup)) {
			effectiveOrigIndex[idx] = origIdx;
		} else if (!origBlock && isNestedList(child)) {
			const pairedIdx = pairedOrigIndex[idx] ?? -1;
			const pairedBlock =
				pairedIdx >= 0 ? baselineBlocks[pairedIdx] : undefined;
			if (pairedBlock && pairedBlock.raw !== null) {
				serialized = serializeListPreservingItems(
					child,
					pairedBlock,
					activeSerializeBlock,
					parsed.envReferences,
					resolveReferences?.isPartialTitleRefDef ?? null,
				);
				if (serialized !== null) effectiveOrigIndex[idx] = pairedIdx;
			}
		} else if (
			!origBlock &&
			child.type.name === "blockquote" &&
			parsed.blockquoteSources
		) {
			const pairedIdx = pairedOrigIndex[idx] ?? -1;
			const pairedBlock =
				pairedIdx >= 0 && intactRefDefBlocks.has(pairedIdx)
					? baselineBlocks[pairedIdx]
					: undefined;
			if (pairedBlock && pairedBlock.node.type.name === "blockquote") {
				serialized = serializeBlockquotePreservingChildren(
					child,
					pairedBlock.node,
					1,
					parsed.blockquoteSources,
					activeSerializeBlock,
				);
				if (serialized !== null) effectiveOrigIndex[idx] = pairedIdx;
			}
		}
		const prevNode = idx > 0 ? doc.child(idx - 1) : null;
		const prevMatched = idx > 0 ? (matchedOrigIndex[idx - 1] ?? -1) : -1;
		const prevWasMatchedAdjacent =
			prevMatched >= 0 && origIdx >= 0 && origIdx === prevMatched + 1;
		const resolveJoin = (
			text: string,
			effIdx: number,
			groupSep?: string,
		): Readonly<{
			refDefMode: ReturnType<typeof refDefContinuationMode>;
			separator: string;
		}> => {
			const mode = prevNode
				? refDefContinuationMode(prevNode, child, text)
				: "none";
			if (!prevNode) return { refDefMode: mode, separator: "" };
			const prevEffIdx = effectiveOrigIndex[idx - 1] ?? -1;
			const inheritedSep =
				effIdx >= 0 && prevEffIdx >= 0 && effIdx === prevEffIdx + 1
					? (groupSep ?? baselineBlocks[effIdx]?.separatorBefore)
					: undefined;
			let sep = mode !== "none" ? "\n" : (inheritedSep ?? "\n\n");
			if (mode === "none" && !/\n[ \t]*\n/.test(sep)) {
				if (
					isListSwallowingFollowingBlock(
						prevNode,
						prevBlockText,
						text,
						prevWasMatchedAdjacent,
					) ||
					((matchedOrigIndex[idx - 1] ?? -1) < 0 &&
						nodeCanLazilyContinue(prevNode) &&
						!endsWithBlankBlockquoteLine(prevBlockText) &&
						wouldBeLazilyAbsorbedByPrevious(child, text))
				) {
					sep = "\n\n";
				}
			}
			return { refDefMode: mode, separator: sep };
		};
		let candidateText =
			serialized !== null ? serialized : activeSerializeBlock(child);
		let { refDefMode, separator } = resolveJoin(
			candidateText,
			effectiveOrigIndex[idx] ?? -1,
			intactGroup?.separatorBefore,
		);
		const isIndentedRisk = (text: string, sep: string): boolean =>
			child.type.name !== "code_block" &&
			LEADING_FOUR_COLUMN_INDENT.test(text) &&
			(sep !== "\n" ||
				!prevNode ||
				!nodePreventsFollowingIndentedCode(prevNode) ||
				endsWithBlankBlockquoteLine(prevBlockText));
		const isSwallowRisk = (text: string): boolean =>
			isListSwallowingFollowingBlock(
				prevNode,
				prevBlockText,
				text,
				prevWasMatchedAdjacent,
			);
		const brokenTightLeft =
			intactGroup !== undefined &&
			intactGroup.separatorBefore === "\n" &&
			(separator !== "\n" ||
				(effectiveOrigIndex[idx - 1] ?? -1) !== intactGroup.startIndex - 1);
		if (
			intactGroup &&
			(brokenTightLeft ||
				isIndentedRisk(intactGroup.raw, separator) ||
				isSwallowRisk(intactGroup.raw))
		) {
			// A shared group whose tight left neighbor changed, whose 4-column
			// indent would now form indented code, or whose indent would be
			// swallowed into a preceding list falls back to canonical blocks.
			intactGroup = undefined;
			serialized = null;
			effectiveOrigIndex[idx] = -1;
			candidateText = activeSerializeBlock(child);
			({ refDefMode, separator } = resolveJoin(candidateText, -1));
		}
		if (prevNode) parts.push(separator);
		let blockText = candidateText;
		if (
			!intactGroup &&
			serialized !== null &&
			(isIndentedRisk(serialized, separator) || isSwallowRisk(serialized))
		) {
			// A blank-line separator, non-lazy predecessor, or shrunk preceding
			// list item would turn the reused indented slice into indented code
			// or swallow it into the list item. Protected blocks dedent only
			// line 0 so PHP preserves continuation-line formula indentation.
			blockText =
				child.type.name === "protected_block"
					? serialized.replace(/^[ \t]+/, "")
					: activeSerializeBlock(child);
		} else if (
			!intactGroup &&
			serialized === null &&
			child.type.name === "protected_block" &&
			isSwallowRisk(blockText)
		) {
			blockText = blockText.replace(/^[ \t]+/, "");
		}
		const emittedBlockText =
			refDefMode === "indented" && !LEADING_FOUR_COLUMN_INDENT.test(blockText)
				? `    ${blockText}`
				: blockText;
		parts.push(emittedBlockText);
		prevBlockText = emittedBlockText;
		if (intactGroup) {
			const groupLen = intactGroup.endIndex - intactGroup.startIndex;
			for (let offset = 1; offset < groupLen; offset += 1) {
				effectiveOrigIndex[idx + offset] = intactGroup.startIndex + offset;
			}
			idx += groupLen - 1;
		}
	}
	let output = parts.join("");
	const keepTrailingSuffix =
		origLen === 1 || matchedOrigIndex.some((origIdx) => origIdx >= 0);
	if (output.length > 0 && keepTrailingSuffix) {
		output += parsed.trailingSuffix;
	}
	if (parsed.lineEnding === "\r\n") {
		output = output.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
	}
	return output;
}

function rebindParsedToDoc(
	parsed: ParsedVisualDocument,
	doc: ProseMirrorNode,
): ParsedVisualDocument | null {
	if (doc === parsed.doc) return parsed;
	if (parsed.blocks.length !== doc.childCount || !doc.eq(parsed.doc)) {
		return null;
	}
	const reboundLinks = parsed.referenceLinks
		? new Map<Mark, ReferenceLinkOrigin>()
		: undefined;
	const reboundImages = parsed.referenceImages
		? new Map<ProseMirrorNode, ReferenceImageOrigin>()
		: undefined;
	const reboundMergedRuns = parsed.mergedReferenceLinkRuns
		? new Map<ProseMirrorNode, ReadonlyArray<MergedReferenceLinkRun>>()
		: undefined;
	const reboundRefDefLabelsByNode = parsed.refDefLabelsByNode
		? new Map<ProseMirrorNode, ReadonlyArray<string>>()
		: undefined;
	const reboundBlockquoteSources = parsed.blockquoteSources
		? new Map<ProseMirrorNode, BuiltVisualBlockSources>()
		: undefined;
	const srcToDst = parsed.firstRefDefNodeByLabel
		? new Map<ProseMirrorNode, ProseMirrorNode>()
		: undefined;

	const walk = (src: ProseMirrorNode, dst: ProseMirrorNode): void => {
		if (srcToDst) {
			srcToDst.set(src, dst);
		}
		if (reboundLinks && parsed.referenceLinks && src.marks.length > 0) {
			const count = Math.min(src.marks.length, dst.marks.length);
			for (let m = 0; m < count; m += 1) {
				const srcMark = src.marks[m];
				const dstMark = dst.marks[m];
				if (srcMark && dstMark) {
					const origin = parsed.referenceLinks.get(srcMark);
					if (origin) reboundLinks.set(dstMark, origin);
				}
			}
		}
		if (reboundImages && parsed.referenceImages) {
			const imgOrigin = parsed.referenceImages.get(src);
			if (imgOrigin) reboundImages.set(dst, imgOrigin);
		}
		if (reboundMergedRuns && parsed.mergedReferenceLinkRuns) {
			const runs = parsed.mergedReferenceLinkRuns.get(src);
			if (runs) reboundMergedRuns.set(dst, runs);
		}
		if (reboundRefDefLabelsByNode && parsed.refDefLabelsByNode) {
			const labels = parsed.refDefLabelsByNode.get(src);
			if (labels) reboundRefDefLabelsByNode.set(dst, labels);
		}
		if (reboundBlockquoteSources && parsed.blockquoteSources) {
			const bqSource = parsed.blockquoteSources.get(src);
			if (bqSource && bqSource.blocks.length === dst.childCount) {
				reboundBlockquoteSources.set(dst, {
					...bqSource,
					blocks: bqSource.blocks.map((block, i) => ({
						...block,
						node: dst.child(i),
					})),
				});
			}
		}
		const count = Math.min(src.childCount, dst.childCount);
		for (let i = 0; i < count; i += 1) {
			walk(src.child(i), dst.child(i));
		}
	};
	if (
		reboundLinks ||
		reboundImages ||
		reboundMergedRuns ||
		reboundRefDefLabelsByNode ||
		reboundBlockquoteSources ||
		srcToDst
	) {
		walk(parsed.doc, doc);
	}
	let reboundFirstRefDefNodeByLabel: Map<string, ProseMirrorNode> | undefined;
	if (parsed.firstRefDefNodeByLabel && srcToDst) {
		reboundFirstRefDefNodeByLabel = new Map<string, ProseMirrorNode>();
		for (const [label, srcNode] of parsed.firstRefDefNodeByLabel) {
			const dstNode = srcToDst.get(srcNode);
			if (dstNode) reboundFirstRefDefNodeByLabel.set(label, dstNode);
		}
	}
	return {
		...parsed,
		...(reboundBlockquoteSources
			? { blockquoteSources: reboundBlockquoteSources }
			: {}),
		blocks: parsed.blocks.map((block, i) => ({ ...block, node: doc.child(i) })),
		doc,
		...(reboundFirstRefDefNodeByLabel
			? { firstRefDefNodeByLabel: reboundFirstRefDefNodeByLabel }
			: {}),
		...(reboundMergedRuns
			? { mergedReferenceLinkRuns: reboundMergedRuns }
			: {}),
		...(reboundRefDefLabelsByNode
			? { refDefLabelsByNode: reboundRefDefLabelsByNode }
			: {}),
		...(reboundImages ? { referenceImages: reboundImages } : {}),
		...(reboundLinks ? { referenceLinks: reboundLinks } : {}),
	};
}

/**
 * `liveDoc` is the document actually kept alive in the editor view (for
 * example after an Undo/external reconcile that retained surviving child
 * nodes). When structurally equal to the baseline it becomes the identity
 * baseline, so later edits anchor surviving blocks by object identity.
 */
export function createPreservingRoundTripGuard(
	initialMarkdown: string,
	initialDocOrParsed: ProseMirrorNode | ParsedVisualDocument | undefined,
	serializers: MarkdownSerializers,
	liveDoc?: ProseMirrorNode,
): MarkdownRoundTripGuard {
	let parsed: ParsedVisualDocument | null = null;
	let baselineDoc: ProseMirrorNode;

	if (initialDocOrParsed && "blocks" in initialDocOrParsed) {
		parsed = initialDocOrParsed;
		baselineDoc = initialDocOrParsed.doc;
	} else {
		const computed = parseMarkdownWithBlockSources(initialMarkdown);
		baselineDoc = initialDocOrParsed ?? computed.doc;
		parsed =
			baselineDoc === computed.doc
				? computed
				: (rebindParsedToDoc(computed, baselineDoc) ??
					(baselineDoc.eq(computed.doc) ? computed : null));
	}
	if (liveDoc && liveDoc !== baselineDoc) {
		const rebound = parsed ? rebindParsedToDoc(parsed, liveDoc) : null;
		if (rebound) {
			parsed = rebound;
			baselineDoc = liveDoc;
		}
	}

	const blockSerializationCache = new WeakMap<ProseMirrorNode, string>();
	const serializeBlockCached: BlockSerializer = (node, mathNewlineToken) => {
		if (mathNewlineToken !== undefined) {
			return serializers.serializeBlock(node, mathNewlineToken);
		}
		const cached = blockSerializationCache.get(node);
		if (cached !== undefined) {
			return cached;
		}
		const serialized = serializers.serializeBlock(node);
		blockSerializationCache.set(node, serialized);
		return serialized;
	};
	const cachedSerializers: MarkdownSerializers = {
		serializeBlock: serializeBlockCached,
		...(serializers.serializeBlockWithRefs
			? {
					serializeBlockWithRefs: (
						node,
						resolveReferences,
						mathNewlineToken,
					) => {
						if (resolveReferences === null) {
							return serializeBlockCached(node, mathNewlineToken);
						}
						return (
							serializers.serializeBlockWithRefs?.(
								node,
								resolveReferences,
								mathNewlineToken,
							) ?? serializeBlockCached(node, mathNewlineToken)
						);
					},
				}
			: {}),
		serializeDoc(doc) {
			if (isEmptyDoc(doc)) {
				return "";
			}
			return joinSerializedBlocks(doc, serializeBlockCached);
		},
	};

	const isUnmodified = (doc: ProseMirrorNode): boolean =>
		doc === baselineDoc || doc.eq(baselineDoc);

	return {
		initialDoc: baselineDoc,
		initialMarkdown,
		isUnmodified,
		serialize(doc: ProseMirrorNode): string {
			if (isUnmodified(doc)) {
				return initialMarkdown;
			}
			if (parsed) {
				return serializeDocPreservingUntouchedBlocks(
					doc,
					parsed,
					cachedSerializers,
				);
			}
			return cachedSerializers.serializeDoc(doc);
		},
	};
}
