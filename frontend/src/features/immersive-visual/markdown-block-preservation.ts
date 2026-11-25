import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
	buildReferencePreserveResolver,
	computeIntactRefDefLabels,
	createInvalidatedRefChecker,
	endsWithBlankBlockquoteLine,
	isListSwallowingFollowingBlock,
	listAttrsCompatible,
	type ReferencePreserveResolver,
	serializeListPreservingItems,
	sharedGroupHasInvalidatedRef,
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
	nodePreventsFollowingIndentedCode,
	refDefContinuationMode,
	restoreMathNewlineSentinel,
} from "./markdown-list-serialization";
import {
	alignNodes,
	childrenOf,
	pairUnmatched,
	structurallyEqual,
} from "./markdown-node-alignment";
import {
	type BuiltVisualBlockSources,
	type ParsedVisualBlockSource,
	type ParsedVisualDocument,
	type ParsedVisualSharedGroup,
	parseMarkdownWithBlockSources,
	type ReferenceImageOrigin,
	type ReferenceLinkOrigin,
} from "./markdown-parser";
import {
	measureIndentColumns,
	readBlockquotePrefix,
	stripBlockquoteDepth,
} from "./markdown-prescanner-containers";
import { dedentBlockToLineZero } from "./markdown-reference-preservation";

export type { ReferencePreserveResolver } from "./markdown-container-preservation";
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

function stripAtDepth(text: string, depth: number): string {
	if (depth <= 0) return text;
	return text
		.split("\n")
		.map((line) => stripBlockquoteDepth(line, depth) ?? line)
		.join("\n");
}

function tryStripAllLinesAtDepth(text: string, depth: number): string | null {
	if (depth <= 0) return text;
	const lines = text.split("\n");
	const stripped: string[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const rest = stripBlockquoteDepth(lines[i] ?? "", depth);
		if (rest === null) return null;
		stripped.push(rest);
	}
	return stripped.join("\n");
}

function leadingIndentAtDepth(emittedText: string, depth: number): number {
	const nl = emittedText.indexOf("\n");
	const firstLine = nl === -1 ? emittedText : emittedText.slice(0, nl);
	if (depth <= 0) {
		return measureIndentColumns(firstLine);
	}
	const bq = readBlockquotePrefix(firstLine);
	if (bq.depth === depth) {
		return measureIndentColumns(bq.rest, bq.column);
	}
	const stripped = stripBlockquoteDepth(firstLine, depth);
	return measureIndentColumns(stripped ?? firstLine);
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
	const innerRaw = serializeBlock(child, token ?? undefined);
	const prefixed = prefixAtDepth(innerRaw, depth);
	return {
		emitted:
			token !== null ? restoreMathNewlineSentinel(prefixed, token) : prefixed,
		inner:
			token !== null ? restoreMathNewlineSentinel(innerRaw, token) : innerRaw,
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

function dedentAllToLineZeroAtDepth(
	inner: string,
	depth: number,
): RenderedChild {
	const dedentedInner = dedentBlockToLineZero(inner);
	return {
		emitted: prefixAtDepth(dedentedInner, depth),
		inner: dedentedInner,
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
	if (depth <= 0) {
		return serializeListPreservingItems(
			listNode,
			origBlock,
			ctx.activeSerializeBlock,
			ctx.parsed.envReferences,
			ctx.resolveReferences?.isPartialTitleRefDef ?? null,
			canReuseItem,
		);
	}
	const innerRaw = tryStripAllLinesAtDepth(origBlock.raw, depth);
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
	const matchedOrigIndex = alignNodes(
		childrenOf(container),
		baselineBlocks.map((block) => block.node),
		structurallyEqual,
	);
	const pairedOrigIndex = pairUnmatched(matchedOrigIndex, origLen);
	const effectiveOrigIndex = new Array<number>(newLen).fill(-1);
	const defaultBlankSep =
		depth <= 0 ? "\n\n" : `\n${"> ".repeat(depth - 1)}>\n`;

	const parts: string[] = [];
	if (matchedOrigIndex[0] === 0 && source.leadingPrefix.length > 0) {
		parts.push(source.leadingPrefix);
	}

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

	const isTightRightNeighborIntact = (() => {
		const memo = new Map<number, boolean>();
		return (startIdx: number, startGroup: ParsedVisualSharedGroup): boolean => {
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
				if (matchedOrigIndex[afterIdx] !== curGroup.endIndex) {
					// A non-shared paired container (blockquote or compatible list)
					// whose first child is untouched and not ref-invalidated keeps the
					// exact same leading boundary line (e.g. editing `z -> z!` inside
					// `> [r]: /u\n> "a $$x$$\n> b"\n>\n> [r]\n> z`).
					const nextChild = container.child(afterIdx);
					const canPreserveContainerHead =
						!nextGroup &&
						pairedOrigIndex[afterIdx] === curGroup.endIndex &&
						nextChild.childCount > 0 &&
						nextOrig.node.childCount > 0 &&
						structurallyEqual(nextChild.child(0), nextOrig.node.child(0)) &&
						(!ctx.hasInvalidatedRefDefs ||
							!ctx.nodeHasInvalidatedRef(nextOrig.node.child(0))) &&
						((nextChild.type.name === "blockquote" &&
							nextOrig.node.type.name === "blockquote" &&
							Boolean(ctx.parsed.blockquoteSources?.has(nextOrig.node))) ||
							(isNestedList(nextChild) &&
								listAttrsCompatible(nextChild, nextOrig.node) &&
								nextOrig.raw !== null));
					if (!canPreserveContainerHead) {
						intact = false;
					}
					break;
				}
				if (!nextGroup) break;
				if (!isIntactSharedGroupAt(afterIdx, nextGroup)) {
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
	})();

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
				if (
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
		const isIndentedRisk = (emittedText: string, sep: string): boolean =>
			child.type.name !== "code_block" &&
			leadingIndentAtDepth(emittedText, depth) >= 4 &&
			(sep !== "\n" ||
				!prevNode ||
				!nodePreventsFollowingIndentedCode(prevNode) ||
				endsWithBlankBlockquoteLine(prevInnerText));
		const isSwallowRisk = (innerText: string): boolean =>
			isListSwallowingFollowingBlock(
				prevNode,
				prevInnerText,
				innerText,
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
				isSwallowRisk(candidateInner))
		) {
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
		}

		if (prevNode) parts.push(separator);

		let blockEmitted = candidateEmitted;
		let blockInner = candidateInner;
		const swallowRisk = isSwallowRisk(candidateInner);
		const indentedRisk = isIndentedRisk(candidateEmitted, separator);
		if (!intactGroup && serialized !== null && (swallowRisk || indentedRisk)) {
			if (child.type.name === "protected_block") {
				if (swallowRisk) {
					const canonical = ensureGenerated();
					if (isSwallowRisk(canonical.inner)) {
						({ emitted: blockEmitted, inner: blockInner } =
							dedentAllToLineZeroAtDepth(canonical.inner, depth));
					} else {
						blockEmitted = canonical.emitted;
						blockInner = canonical.inner;
					}
				} else {
					// Pure 4-column indented-code risk on protected_block (e.g.
					// `p\n    $$\n    x\n    y\n    $$`): dedent only line 0 so
					// PHP preserves continuation-line formula indentation.
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
				dedentAllToLineZeroAtDepth(candidateInner, depth));
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
	const { allIntact, partialTitleIntact } = computeIntactRefDefLabels(
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
	if (parsed.blocks.length !== doc.childCount || !doc.eq(parsed.doc)) {
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
