import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
	alignContainerChildren,
	checkRawPreservationRisks,
	createTightSharedGroupChecker,
	endsWithBlankBlockquoteLine,
	isListSwallowingFollowingBlock,
	serializeListPreservingItems,
	sharedGroupHasInvalidatedRef,
	stripAtDepth,
	tryStripAllLinesAtDepth,
	wouldBeLazilyAbsorbedByPrevious,
} from "./markdown-container-preservation";
import {
	type BlockSerializer,
	createMathNewlineSentinelForNode,
	isNestedList,
	isTightPartialTitleFollower,
	joinSerializedBlocks,
	LEADING_FOUR_COLUMN_INDENT,
	nodeCanLazilyContinue,
	refDefContinuationMode,
	restoreMathNewlineSentinel,
} from "./markdown-list-serialization";
import { nodesSemanticallyEqual } from "./markdown-node-alignment";
import {
	type BuiltVisualBlockSources,
	inspectReferenceDefinitionBlock,
	type ParsedVisualBlockSource,
	type ParsedVisualDocument,
	parseMarkdownWithBlockSources,
	type ReferenceImageOrigin,
	type ReferenceLinkOrigin,
	wouldReferenceDefinitionAbsorbFollowingBlock,
} from "./markdown-parser";
import {
	buildReferencePreserveResolver,
	computeIntactRefDefLabels,
	createInvalidatedRefChecker,
	type PreservationPlan,
	type ReferencePreserveResolver,
} from "./markdown-refdef-liveness";
import { dedentBlockToLineZero } from "./markdown-reference-preservation";

export {
	type BlockSerializer,
	createMathNewlineSentinelForNode,
	joinSerializedBlocks,
	refDefContinuationMode,
	restoreMathNewlineSentinel,
	serializeList,
} from "./markdown-list-serialization";
export type { ReferencePreserveResolver } from "./markdown-refdef-liveness";

/**
 * Unified untouched-source preservation for the immersive visual editor.
 *
 * The visual editor is an in-memory projection of canonical Markdown. When a
 * legitimate edit is synchronized back, one parameterized container loop
 * (`depth = 0` for `doc`, `depth >= 1` for nested `blockquote`s, delegating
 * lists to `serializeListPreservingItems` at every depth) preserves every
 * untouched block, list item, and separator verbatim — except blocks/items
 * whose referenced link/image definition was deleted or shadowed, which
 * re-serialize canonically so PHP never loses links or titles.
 *
 * Block/inline serialization is injected by `markdown-serializer.ts`, keeping
 * the dependency direction one-way (serializer -> preservation).
 */

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

type RenderedChild = Readonly<{
	emitted: string;
	inner: string;
}>;

type PreservationContext = Readonly<{
	activeSerializeBlock: BlockSerializer;
	hasInvalidatedRefDefs: boolean;
	nodeHasInvalidatedRef: (node: ProseMirrorNode) => boolean;
	parsed: ParsedVisualDocument;
	plan: PreservationPlan;
	resolveReferences: ReferencePreserveResolver | null;
}>;

function isEmptyDoc(doc: ProseMirrorNode): boolean {
	return (
		doc.childCount === 1 &&
		doc.firstChild?.type.name === "paragraph" &&
		doc.firstChild.childCount === 0
	);
}

// ---------------------------------------------------------------------------
// Depth-aware blockquote line helpers (depth = 0 is top-level doc)
// ---------------------------------------------------------------------------

function prefixAtDepth(text: string, depth: number): string {
	if (depth <= 0) return text;
	const quotePrefix = "> ".repeat(depth);
	const blankLine = `${"> ".repeat(depth - 1)}>`;
	return text
		.split("\n")
		.map((line) => (line.length > 0 ? `${quotePrefix}${line}` : blankLine))
		.join("\n");
}

function serializeChildAtDepth(
	child: ProseMirrorNode,
	depth: number,
	serializeBlock: BlockSerializer,
): RenderedChild {
	if (depth <= 0) {
		const emitted = serializeBlock(child);
		return { emitted, inner: emitted };
	}
	const token = createMathNewlineSentinelForNode(child);
	const innerMasked = serializeBlock(child, token ?? undefined);
	const prefixed = prefixAtDepth(innerMasked, depth);
	return {
		emitted:
			token !== null ? restoreMathNewlineSentinel(prefixed, token) : prefixed,
		inner:
			token !== null
				? restoreMathNewlineSentinel(innerMasked, token)
				: innerMasked,
	};
}

function dedentLineZeroAtDepth(
	emitted: string,
	inner: string,
	depth: number,
): RenderedChild {
	const dedentedInner = inner.replace(/^[ \t]+/, "");
	if (depth <= 0) {
		return { emitted: dedentedInner, inner: dedentedInner };
	}
	const quotePrefix = "> ".repeat(depth);
	const nl = emitted.indexOf("\n");
	const innerNl = dedentedInner.indexOf("\n");
	const firstLine = `${quotePrefix}${innerNl === -1 ? dedentedInner : dedentedInner.slice(0, innerNl)}`;
	return {
		emitted: nl === -1 ? firstLine : `${firstLine}${emitted.slice(nl)}`,
		inner: dedentedInner,
	};
}

/**
 * Dedents a canonical `protected_block` to column 0 at any depth (`depth >= 0`)
 * while protecting physical newlines inside multiline math spans (`$$...$$`,
 * `\[...\]`, `\(...\)`) for both `raw` and `math` blocks with a collision-free
 * sentinel generated on demand.
 */
function dedentAllToLineZeroAtDepth(
	child: ProseMirrorNode,
	depth: number,
	serializeBlock: BlockSerializer,
): RenderedChild {
	const token = createMathNewlineSentinelForNode(child, true);
	const innerMasked = serializeBlock(child, token ?? undefined);
	const dedentedMasked = dedentBlockToLineZero(innerMasked);
	const prefixed = prefixAtDepth(dedentedMasked, depth);
	return {
		emitted:
			token !== null ? restoreMathNewlineSentinel(prefixed, token) : prefixed,
		inner:
			token !== null
				? restoreMathNewlineSentinel(dedentedMasked, token)
				: dedentedMasked,
	};
}

function indentFirstLineAtDepth(
	emitted: string,
	inner: string,
	depth: number,
): RenderedChild {
	if (depth <= 0) {
		const indented = `    ${emitted}`;
		return { emitted: indented, inner: indented };
	}
	const quotePrefix = "> ".repeat(depth);
	const nl = emitted.indexOf("\n");
	const innerNl = inner.indexOf("\n");
	const firstLine = `${quotePrefix}    ${innerNl === -1 ? inner : inner.slice(0, innerNl)}`;
	return {
		emitted: nl === -1 ? firstLine : `${firstLine}${emitted.slice(nl)}`,
		inner: `    ${inner}`,
	};
}

function tryPreserveListAtDepth(
	listNode: ProseMirrorNode,
	origBlock: ParsedVisualBlockSource,
	depth: number,
	ctx: PreservationContext,
): string | null {
	if (origBlock.raw === null) return null;
	const canReuseItem = ctx.hasInvalidatedRefDefs
		? (origItem: ProseMirrorNode) => !ctx.nodeHasInvalidatedRef(origItem)
		: null;
	const cachedPrepared = ctx.plan.lists.get(listNode);
	if (depth <= 0) {
		return serializeListPreservingItems(
			listNode,
			origBlock,
			ctx.activeSerializeBlock,
			ctx.parsed.envReferences,
			ctx.resolveReferences?.isPartialTitleRefDef ?? null,
			canReuseItem,
			undefined,
			undefined,
			cachedPrepared,
		);
	}
	const innerRaw =
		cachedPrepared?.innerRaw ?? tryStripAllLinesAtDepth(origBlock.raw, depth);
	if (innerRaw === null) return null;
	const token = createMathNewlineSentinelForNode(listNode);
	const innerSerialized = serializeListPreservingItems(
		listNode,
		origBlock,
		ctx.activeSerializeBlock,
		ctx.parsed.envReferences,
		ctx.resolveReferences?.isPartialTitleRefDef ?? null,
		canReuseItem,
		innerRaw,
		token ?? undefined,
		cachedPrepared,
	);
	if (innerSerialized === null) return null;
	const prefixed = prefixAtDepth(innerSerialized, depth);
	return token !== null
		? restoreMathNewlineSentinel(prefixed, token)
		: prefixed;
}

// ---------------------------------------------------------------------------
// Unified parameterized container-preservation loop (doc + nested blockquotes)
// ---------------------------------------------------------------------------

function serializeContainerPreservingChildren(
	container: ProseMirrorNode,
	source: BuiltVisualBlockSources,
	depth: number,
	ctx: PreservationContext,
): string {
	const baselineBlocks = source.blocks;
	const newLen = container.childCount;
	const origLen = baselineBlocks.length;
	const { matchedOrigIndex, pairedOrigIndex } =
		ctx.plan.containers.get(container) ??
		alignContainerChildren(container, baselineBlocks);
	const effectiveOrigIndex = new Array<number>(newLen).fill(-1);
	const defaultBlankSep =
		depth <= 0 ? "\n\n" : `\n${"> ".repeat(depth - 1)}>\n`;

	const parts: string[] = [];
	if (matchedOrigIndex[0] === 0 && source.leadingPrefix.length > 0) {
		parts.push(source.leadingPrefix);
	}

	const { isIntactSharedGroupAt, isTightRightNeighborIntact } =
		createTightSharedGroupChecker(
			container,
			baselineBlocks,
			matchedOrigIndex,
			pairedOrigIndex,
			ctx.parsed.blockquoteSources,
			ctx.hasInvalidatedRefDefs ? ctx.nodeHasInvalidatedRef : null,
		);

	const tryPreserveContainerChild = (
		child: ProseMirrorNode,
		baseBlock: ParsedVisualBlockSource | undefined,
	): string | null => {
		if (!baseBlock) return null;
		if (isNestedList(child) && baseBlock.raw !== null) {
			return tryPreserveListAtDepth(child, baseBlock, depth, ctx);
		}
		if (
			child.type.name === "blockquote" &&
			baseBlock.node.type.name === "blockquote"
		) {
			const bqSource = ctx.parsed.blockquoteSources?.get(baseBlock.node);
			if (bqSource && bqSource.blocks.length === baseBlock.node.childCount) {
				return serializeContainerPreservingChildren(
					child,
					bqSource,
					depth + 1,
					ctx,
				);
			}
		}
		return null;
	};

	let prevInnerText = "";
	for (let idx = 0; idx < newLen; idx += 1) {
		const child = container.child(idx);
		const origIdx = matchedOrigIndex[idx] ?? -1;
		const origBlock = origIdx >= 0 ? baselineBlocks[origIdx] : undefined;
		const sharedGroup = origBlock?.sharedGroup;
		let intactGroup =
			sharedGroup &&
			origIdx === sharedGroup.startIndex &&
			isIntactSharedGroupAt(idx, sharedGroup) &&
			isTightRightNeighborIntact(idx, sharedGroup) &&
			(!ctx.hasInvalidatedRefDefs ||
				!sharedGroupHasInvalidatedRef(
					baselineBlocks,
					sharedGroup,
					ctx.nodeHasInvalidatedRef,
				))
				? sharedGroup
				: undefined;
		const origInvalidated =
			origBlock !== undefined &&
			ctx.hasInvalidatedRefDefs &&
			ctx.nodeHasInvalidatedRef(origBlock.node);
		let serialized: string | null = intactGroup
			? intactGroup.raw
			: origBlock && origBlock.raw !== null && !origInvalidated
				? origBlock.raw
				: null;

		if (intactGroup || (origBlock && !sharedGroup && !origInvalidated)) {
			effectiveOrigIndex[idx] = origIdx;
		} else if (origBlock && origInvalidated) {
			const nested = tryPreserveContainerChild(child, origBlock);
			if (nested !== null) {
				serialized = nested;
				effectiveOrigIndex[idx] = origIdx;
			} else if (!sharedGroup) {
				effectiveOrigIndex[idx] = origIdx;
			}
		} else if (!origBlock) {
			const pairedIdx = pairedOrigIndex[idx] ?? -1;
			const pairedBlock =
				pairedIdx >= 0 ? baselineBlocks[pairedIdx] : undefined;
			const nested = tryPreserveContainerChild(child, pairedBlock);
			if (nested !== null) {
				serialized = nested;
				effectiveOrigIndex[idx] = pairedIdx;
			}
		}

		const prevNode = idx > 0 ? container.child(idx - 1) : null;
		const prevMatched = idx > 0 ? (matchedOrigIndex[idx - 1] ?? -1) : -1;
		const prevWasMatchedAdjacent =
			prevMatched >= 0 && origIdx >= 0 && origIdx === prevMatched + 1;

		let generated: RenderedChild | null = null;
		const ensureGenerated = (): RenderedChild => {
			if (generated === null) {
				generated = serializeChildAtDepth(
					child,
					depth,
					ctx.activeSerializeBlock,
				);
			}
			return generated;
		};

		const resolveJoin = (
			innerText: string,
			effIdx: number,
			groupSep?: string,
		): Readonly<{
			refDefMode: ReturnType<typeof refDefContinuationMode>;
			separator: string;
		}> => {
			const mode = prevNode
				? refDefContinuationMode(prevNode, child, innerText)
				: "none";
			if (!prevNode) return { refDefMode: mode, separator: "" };
			const tightPartialTitle =
				mode === "none" &&
				isTightPartialTitleFollower(
					prevNode,
					child,
					innerText,
					ctx.resolveReferences?.isPartialTitleRefDef ?? null,
				);
			const prevEffIdx = effectiveOrigIndex[idx - 1] ?? -1;
			const inheritedSep =
				effIdx >= 0 && prevEffIdx >= 0 && effIdx === prevEffIdx + 1
					? (groupSep ?? baselineBlocks[effIdx]?.separatorBefore)
					: undefined;
			let sep =
				mode !== "none" || tightPartialTitle
					? "\n"
					: (inheritedSep ?? defaultBlankSep);
			if (mode === "none" && !tightPartialTitle && sep === "\n") {
				const refDefAbsorbRisk =
					serialized === null &&
					prevNode.type.name === "protected_block" &&
					prevNode.attrs.kind === "raw" &&
					typeof prevNode.attrs.rawMarkdown === "string" &&
					(() => {
						const info = inspectReferenceDefinitionBlock(
							prevNode.attrs.rawMarkdown,
						);
						return (
							info.isRefDef &&
							!info.lastHasTitle &&
							wouldReferenceDefinitionAbsorbFollowingBlock(
								info.lastRaw,
								innerText,
							)
						);
					})();
				if (
					refDefAbsorbRisk ||
					isListSwallowingFollowingBlock(
						prevNode,
						prevInnerText,
						innerText,
						prevWasMatchedAdjacent,
					) ||
					((matchedOrigIndex[idx - 1] ?? -1) < 0 &&
						nodeCanLazilyContinue(prevNode) &&
						!endsWithBlankBlockquoteLine(prevInnerText) &&
						wouldBeLazilyAbsorbedByPrevious(child, innerText))
				) {
					sep = defaultBlankSep;
				}
			}
			return { refDefMode: mode, separator: sep };
		};

		let candidateEmitted =
			serialized !== null ? serialized : ensureGenerated().emitted;
		let candidateInner =
			serialized !== null
				? stripAtDepth(serialized, depth)
				: ensureGenerated().inner;
		let { refDefMode, separator } = resolveJoin(
			candidateInner,
			effectiveOrigIndex[idx] ?? -1,
			intactGroup?.separatorBefore,
		);
		const isSwallowRisk = (innerText: string): boolean =>
			isListSwallowingFollowingBlock(
				prevNode,
				prevInnerText,
				innerText,
				prevWasMatchedAdjacent,
			);
		let { indentedRisk, swallowRisk } = checkRawPreservationRisks(
			child,
			depth,
			candidateEmitted,
			candidateInner,
			separator,
			prevNode,
			prevInnerText,
			prevWasMatchedAdjacent,
		);
		const brokenTightLeft =
			intactGroup !== undefined &&
			intactGroup.separatorBefore === "\n" &&
			(separator !== "\n" ||
				(effectiveOrigIndex[idx - 1] ?? -1) !== intactGroup.startIndex - 1);
		if (intactGroup && (brokenTightLeft || indentedRisk || swallowRisk)) {
			// A shared group whose tight left neighbor changed, whose 4-column
			// indent would now form indented code, or whose indent would be
			// swallowed into a preceding list falls back to canonical blocks.
			intactGroup = undefined;
			serialized = null;
			effectiveOrigIndex[idx] = -1;
			const canonical = ensureGenerated();
			candidateEmitted = canonical.emitted;
			candidateInner = canonical.inner;
			({ refDefMode, separator } = resolveJoin(candidateInner, -1));
			({ indentedRisk, swallowRisk } = checkRawPreservationRisks(
				child,
				depth,
				candidateEmitted,
				candidateInner,
				separator,
				prevNode,
				prevInnerText,
				prevWasMatchedAdjacent,
			));
		}

		if (prevNode) parts.push(separator);

		let blockEmitted = candidateEmitted;
		let blockInner = candidateInner;
		if (!intactGroup && serialized !== null && (swallowRisk || indentedRisk)) {
			if (child.type.name === "protected_block") {
				if (swallowRisk && child.attrs.kind !== "math") {
					const canonical = ensureGenerated();
					if (isSwallowRisk(canonical.inner)) {
						({ emitted: blockEmitted, inner: blockInner } =
							dedentAllToLineZeroAtDepth(
								child,
								depth,
								ctx.activeSerializeBlock,
							));
					} else {
						blockEmitted = canonical.emitted;
						blockInner = canonical.inner;
					}
				} else {
					// Pure 4-column indented-code risk on protected_block (e.g.
					// `p\n    $$\n    x\n    y\n    $$`), or swallowRisk on a
					// preserved `math` block (`>   $$a\n>     b$$`): dedent
					// only line 0 so PHP preserves every continuation line byte
					// inside the math span verbatim.
					({ emitted: blockEmitted, inner: blockInner } = dedentLineZeroAtDepth(
						candidateEmitted,
						candidateInner,
						depth,
					));
				}
			} else {
				const canonical = ensureGenerated();
				blockEmitted = canonical.emitted;
				blockInner = canonical.inner;
			}
		} else if (
			!intactGroup &&
			serialized === null &&
			child.type.name === "protected_block" &&
			swallowRisk
		) {
			({ emitted: blockEmitted, inner: blockInner } =
				dedentAllToLineZeroAtDepth(child, depth, ctx.activeSerializeBlock));
		}

		if (
			refDefMode === "indented" &&
			!LEADING_FOUR_COLUMN_INDENT.test(blockInner)
		) {
			({ emitted: blockEmitted, inner: blockInner } = indentFirstLineAtDepth(
				blockEmitted,
				blockInner,
				depth,
			));
		}

		parts.push(blockEmitted);
		prevInnerText = blockInner;
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
		output += source.trailingSuffix;
	}
	return output;
}

function serializeDocPreservingUntouchedBlocks(
	doc: ProseMirrorNode,
	parsed: ParsedVisualDocument,
	serializers: MarkdownSerializers,
): string {
	if (isEmptyDoc(doc)) {
		return "";
	}
	if (parsed.blocks.length === 0) {
		return serializers.serializeDoc(doc);
	}
	const { allIntact, partialTitleIntact, plan } = computeIntactRefDefLabels(
		doc,
		parsed,
		serializers.serializeBlock,
	);
	const resolveReferences = buildReferencePreserveResolver(
		parsed,
		partialTitleIntact,
		Boolean(serializers.serializeBlockWithRefs),
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
	const { hasInvalidatedRefDefs, nodeHasInvalidatedRef } =
		createInvalidatedRefChecker(parsed, allIntact);
	let output = serializeContainerPreservingChildren(doc, parsed, 0, {
		activeSerializeBlock,
		hasInvalidatedRefDefs,
		nodeHasInvalidatedRef,
		parsed,
		plan,
		resolveReferences,
	});
	if (parsed.lineEnding === "\r\n") {
		output = output.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
	}
	return output;
}

// ---------------------------------------------------------------------------
// Live-doc identity rebinding & round-trip guard factory
// ---------------------------------------------------------------------------

function rebindParsedToDoc(
	parsed: ParsedVisualDocument,
	doc: ProseMirrorNode,
): ParsedVisualDocument | null {
	if (doc === parsed.doc) return parsed;
	if (
		parsed.blocks.length !== doc.childCount ||
		!nodesSemanticallyEqual(doc, parsed.doc)
	) {
		return null;
	}
	const reboundLinks = parsed.referenceLinks
		? new Map<Mark, ReferenceLinkOrigin>()
		: undefined;
	const reboundImages = parsed.referenceImages
		? new Map<ProseMirrorNode, ReferenceImageOrigin>()
		: undefined;
	const reboundRefDefLabelsByNode = parsed.refDefLabelsByNode
		? new Map<ProseMirrorNode, ReadonlyArray<string>>()
		: undefined;
	const reboundReferencedLabelsByNode = parsed.referencedLabelsByNode
		? new Map<ProseMirrorNode, ReadonlySet<string>>()
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
		if (reboundRefDefLabelsByNode && parsed.refDefLabelsByNode) {
			const labels = parsed.refDefLabelsByNode.get(src);
			if (labels) reboundRefDefLabelsByNode.set(dst, labels);
		}
		if (reboundReferencedLabelsByNode && parsed.referencedLabelsByNode) {
			const labels = parsed.referencedLabelsByNode.get(src);
			if (labels) reboundReferencedLabelsByNode.set(dst, labels);
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
		reboundRefDefLabelsByNode ||
		reboundReferencedLabelsByNode ||
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
		...(reboundRefDefLabelsByNode
			? { refDefLabelsByNode: reboundRefDefLabelsByNode }
			: {}),
		...(reboundReferencedLabelsByNode
			? { referencedLabelsByNode: reboundReferencedLabelsByNode }
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
					(nodesSemanticallyEqual(baselineDoc, computed.doc)
						? computed
						: null));
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
		doc === baselineDoc || nodesSemanticallyEqual(doc, baselineDoc);

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
