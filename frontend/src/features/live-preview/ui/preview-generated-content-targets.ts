import type { EditorMarkdownMathSpan } from "../../../contracts/ports/editor-block-index-port";
import {
	associateGeneratedContentTarget,
	createGeneratedContentTarget,
	type GeneratedContentKind,
	type GeneratedContentOriginal,
	type GeneratedContentTarget,
	mathElementMatchesSource,
} from "../../generated-content-export/generated-content-target";
import {
	pairMathDomIndexToSpanIndex,
	pairMathSpanIndexToDomIndex,
} from "../../generated-content-export/generated-math-pairing";
import {
	generatedTargetMatchesSourceSelection,
	lowerBoundByFrom,
	mermaidOriginalForCodeBlock,
	previewImageSelectionBlockIndices,
	sourceSelectionMatchesGeneratedRanges,
} from "./preview-selection-block-map";
import { isCurrentAcceptedGeneratedPreview } from "./preview-surface-runtime-helpers";
import type {
	AcceptedGeneratedPreview,
	PreviewGeneratedContentTargetForSelectionRequest,
	PreviewGeneratedContentTargetIndex,
	PreviewGeneratedContentTargetLease,
	PreviewGeneratedContentTargetRequest,
	PreviewSurfaceRefs,
} from "./preview-surface-types";

type MintedGeneratedContentTarget = Readonly<{
	expectedDomMathCount?: number;
	target: GeneratedContentTarget;
}>;

function mintMathTargetForIndices(
	acceptedPreview: Readonly<{ revision: number; signature: string }>,
	blockId: string,
	source: string,
	sourceRevision: number,
	spans: ReadonlyArray<EditorMarkdownMathSpan>,
	spanIndex: number,
	domIndex: number,
): GeneratedContentTarget | null {
	const associated = associateGeneratedContentTarget({
		acceptedPreview,
		blockId,
		kind: "math",
		mathSpans: spans,
		ordinal: spanIndex,
		source,
		sourceRevision,
	});
	if ("associated" !== associated.status) return null;
	if (domIndex === spanIndex) return associated.target;
	const remapped = createGeneratedContentTarget({
		acceptedPreview,
		blockId,
		kind: "math",
		ordinal: domIndex,
		original: associated.target.original,
		source,
		sourceRevision,
	});
	return "associated" === remapped.status ? remapped.target : null;
}

function visualBlockElementForId(
	accepted: AcceptedGeneratedPreview,
	surface: HTMLElement,
	blockId: string,
): HTMLElement | null {
	const blockRange = accepted.blockRanges.get(blockId);
	if (!blockRange) return null;
	const block = surface.children[blockRange.index];
	if (
		!(block instanceof HTMLElement) ||
		block.getAttribute("data-easymde-visual-block-id") !== blockId
	) {
		return null;
	}
	return block;
}

function mintGeneratedContentTargetForBlock(
	request: Readonly<{
		element: Element;
		index: PreviewGeneratedContentTargetIndex;
		kind: GeneratedContentKind;
		ordinal: number;
	}>,
	accepted: AcceptedGeneratedPreview,
	visualBlock: HTMLElement | null,
	blockId: string | null,
): MintedGeneratedContentTarget | null {
	const sourceIndex = request.index;
	if (
		sourceIndex.revision !== accepted.sourceRevision ||
		sourceIndex.source !== accepted.markdown ||
		sourceIndex.length !== sourceIndex.source.length ||
		!Number.isSafeInteger(request.ordinal) ||
		request.ordinal < 0 ||
		!blockId ||
		!accepted.editMap ||
		accepted.editMap.signature !== accepted.signature
	) {
		return null;
	}
	const blockIndex = accepted.editMap.blocks.findIndex(
		(block) => block.id === blockId,
	);
	const block = accepted.editMap.blocks[blockIndex];
	if (!block?.editable || blockIndex < 0) return null;
	const blockRange = accepted.blockRanges.get(block.id);
	if (!blockRange) return null;
	const { end: blockEnd, start: blockStart } = blockRange;
	const acceptedPreview = {
		revision: accepted.generation,
		signature: accepted.signature,
	};
	if ("math" === request.kind) {
		if (!visualBlock) return null;
		const renderedRoots = generatedRootsForBlock(visualBlock, "math");
		if (renderedRoots[request.ordinal] !== request.element) return null;
		const spans = sourceIndex.mathSpans.filter(
			(span) => span.from >= blockStart && span.to <= blockEnd,
		);
		const spanIndex = pairMathDomIndexToSpanIndex(
			sourceIndex.source,
			renderedRoots,
			spans,
			request.ordinal,
		);
		if (null === spanIndex) return null;
		const target = mintMathTargetForIndices(
			acceptedPreview,
			block.id,
			sourceIndex.source,
			accepted.sourceRevision,
			spans,
			spanIndex,
			request.ordinal,
		);
		if (!target) return null;
		return { expectedDomMathCount: renderedRoots.length, target };
	}
	const mermaidOriginals = sourceIndex.blocks
		.filter(
			(sourceBlock) =>
				"code" === sourceBlock.kind &&
				sourceBlock.from >= blockStart &&
				sourceBlock.to <= blockEnd,
		)
		.map((sourceBlock) =>
			mermaidOriginalForCodeBlock(sourceIndex.source, sourceBlock),
		)
		.filter(
			(original): original is GeneratedContentOriginal => null !== original,
		);
	const original = mermaidOriginals[request.ordinal];
	if (!original) return null;
	const associated = associateGeneratedContentTarget({
		acceptedPreview,
		blockId: block.id,
		kind: request.kind,
		ordinal: request.ordinal,
		original,
		source: sourceIndex.source,
		sourceRevision: accepted.sourceRevision,
	});
	return "associated" === associated.status
		? { target: associated.target }
		: null;
}

function mintGeneratedContentTarget(
	request: PreviewGeneratedContentTargetRequest,
	accepted: AcceptedGeneratedPreview,
): MintedGeneratedContentTarget | null {
	const visualBlockNode = request.element.closest(
		"[data-easymde-visual-block-id]",
	);
	const visualBlock =
		visualBlockNode instanceof HTMLElement ? visualBlockNode : null;
	return mintGeneratedContentTargetForBlock(
		request,
		accepted,
		visualBlock,
		visualBlock?.getAttribute("data-easymde-visual-block-id") ?? null,
	);
}

function generatedRootsForBlock(
	block: HTMLElement,
	kind: GeneratedContentTarget["kind"],
): ReadonlyArray<HTMLElement> {
	const selector = "math" === kind ? ".easymde-math" : ".easymde-mermaid";
	const roots = block.matches(selector)
		? [block, ...Array.from(block.querySelectorAll<HTMLElement>(selector))]
		: Array.from(block.querySelectorAll<HTMLElement>(selector));
	return roots.filter(
		(root) =>
			root.closest("[data-easymde-visual-block-id]") === block &&
			(root === block || root.parentElement?.closest(selector) === null),
	);
}

function currentGeneratedContentTarget(
	refs: PreviewSurfaceRefs,
	request: Readonly<{ element: Element; target: GeneratedContentTarget }>,
	accepted: AcceptedGeneratedPreview,
	surface: HTMLElement,
	verifySourceValue = false,
	expectedDomMathCount?: number,
): boolean {
	const target = request.target;
	if (
		!isCurrentAcceptedGeneratedPreview(
			refs,
			accepted,
			surface,
			verifySourceValue,
		) ||
		target.sourceRevision !== accepted.sourceRevision ||
		target.acceptedPreview.revision !== accepted.generation ||
		target.acceptedPreview.signature !== accepted.signature ||
		request.element.ownerDocument !== surface.ownerDocument ||
		!surface.contains(request.element) ||
		!request.element.isConnected
	) {
		return false;
	}
	if (!accepted.editMap || accepted.editMap.signature !== accepted.signature) {
		return false;
	}
	const blockRange = accepted.blockRanges.get(target.blockId);
	const blockIndex = blockRange?.index ?? -1;
	const block = accepted.editMap.blocks[blockIndex];
	if (!blockRange || !block?.editable || blockIndex < 0) return false;
	const { end: blockEnd, start: blockStart } = blockRange;
	if (
		target.original.fullRange.from < blockStart ||
		target.original.fullRange.to > blockEnd ||
		accepted.markdown.slice(
			target.original.fullRange.from,
			target.original.fullRange.to,
		) !== target.original.full ||
		accepted.markdown.slice(
			target.original.bodyRange.from,
			target.original.bodyRange.to,
		) !== target.original.body
	) {
		return false;
	}
	const visualBlock = request.element.closest("[data-easymde-visual-block-id]");
	if (
		!(visualBlock instanceof HTMLElement) ||
		visualBlock.getAttribute("data-easymde-visual-block-id") !== target.blockId
	) {
		return false;
	}
	if ("math" === target.kind) {
		const roots = generatedRootsForBlock(visualBlock, "math");
		if (
			(undefined !== expectedDomMathCount &&
				roots.length !== expectedDomMathCount) ||
			roots[target.ordinal] !== request.element
		) {
			return false;
		}
		const displayMode =
			target.original.full.startsWith("$$") ||
			target.original.full.startsWith("\\[");
		return (
			request.element.matches(".easymde-math") &&
			1 === request.element.querySelectorAll(".katex-mathml > math").length &&
			mathElementMatchesSource(request.element, {
				body: target.original.body,
				displayMode,
				full: target.original.full,
			})
		);
	}
	return (
		request.element.matches(".easymde-mermaid") &&
		1 === request.element.querySelectorAll("svg").length
	);
}

function generatedRootForTarget(
	refs: PreviewSurfaceRefs,
	target: GeneratedContentTarget,
	surface: HTMLElement,
	expectedDomMathCount?: number,
): HTMLElement | null {
	const accepted = refs.acceptedGeneratedPreviewRef.current;
	if (!accepted) return null;
	const block = visualBlockElementForId(accepted, surface, target.blockId);
	if (!block) return null;
	const roots = generatedRootsForBlock(block, target.kind);
	if (
		"math" === target.kind &&
		undefined !== expectedDomMathCount &&
		roots.length !== expectedDomMathCount
	) {
		return null;
	}
	return roots[target.ordinal] ?? null;
}

function createGeneratedContentTargetLease(
	refs: PreviewSurfaceRefs,
	target: GeneratedContentTarget,
	element: Element,
	accepted: AcceptedGeneratedPreview,
	surface: HTMLElement,
	onRelease?: () => void,
	parentIsCurrent?: () => boolean,
	expectedDomMathCount?: number,
): PreviewGeneratedContentTargetLease | null {
	const targetRequest = { element, target };
	if (
		generatedRootForTarget(refs, target, surface, expectedDomMathCount) !==
			element ||
		!currentGeneratedContentTarget(
			refs,
			targetRequest,
			accepted,
			surface,
			true,
			expectedDomMathCount,
		)
	) {
		return null;
	}
	let released = false;
	return {
		isCurrent: () =>
			!released &&
			(parentIsCurrent?.() ?? true) &&
			Boolean(refs.acceptedGeneratedPreviewRef.current) &&
			currentGeneratedContentTarget(
				refs,
				targetRequest,
				accepted,
				surface,
				false,
				expectedDomMathCount,
			),
		release: () => {
			if (released) return;
			released = true;
			onRelease?.();
		},
		root: element,
		target,
	};
}

function generatedContentTargetForSelection(
	request: PreviewGeneratedContentTargetForSelectionRequest,
	accepted: AcceptedGeneratedPreview,
	blockId: string,
	surface: HTMLElement,
): Readonly<{
	expectedDomMathCount?: number;
	kind: GeneratedContentKind;
	ordinal: number;
	target: GeneratedContentTarget;
}> | null {
	const blockRange = accepted.blockRanges.get(blockId);
	if (!blockRange) return null;
	const acceptedPreview = {
		revision: accepted.generation,
		signature: accepted.signature,
	};
	type PendingCandidate =
		| Readonly<{
				domOrdinal: number;
				expectedDomMathCount: number;
				kind: "math";
				mathSpans: ReadonlyArray<EditorMarkdownMathSpan>;
				spanOrdinal: number;
		  }>
		| Readonly<{
				kind: "mermaid";
				ordinal: number;
				original: GeneratedContentOriginal;
		  }>;
	const candidates: PendingCandidate[] = [];
	const mathSpans = request.index.mathSpans;
	const mathBlockStart = lowerBoundByFrom(mathSpans, blockRange.start);
	const mathBlockEnd = lowerBoundByFrom(mathSpans, blockRange.end);
	const mathSelectionPivot = lowerBoundByFrom(
		mathSpans,
		request.selection.start,
	);
	const mathCandidateIndices = [
		mathSelectionPivot - 1,
		mathSelectionPivot,
	].filter(
		(index, position, indices) =>
			index >= mathBlockStart &&
			index < mathBlockEnd &&
			indices.indexOf(index) === position,
	);
	const matchingMathIndices = mathCandidateIndices.filter((index) => {
		const span = mathSpans[index];
		return Boolean(
			span &&
				span.from >= blockRange.start &&
				span.to <= blockRange.end &&
				sourceSelectionMatchesGeneratedRanges(
					request.selection,
					{ from: span.from, to: span.to },
					{ from: span.bodyFrom, to: span.bodyTo },
				),
		);
	});
	if (1 === matchingMathIndices.length) {
		const mathIndex = matchingMathIndices[0];
		if (undefined !== mathIndex) {
			const visualBlock = visualBlockElementForId(accepted, surface, blockId);
			if (!visualBlock) return null;
			const renderedRoots = generatedRootsForBlock(visualBlock, "math");
			const blockSpans: EditorMarkdownMathSpan[] = [];
			let spanOrdinal = -1;
			for (let index = mathBlockStart; index < mathBlockEnd; index += 1) {
				const span = mathSpans[index];
				if (
					span &&
					span.from >= blockRange.start &&
					span.to <= blockRange.end
				) {
					if (index === mathIndex) spanOrdinal = blockSpans.length;
					blockSpans.push(span);
				}
			}
			if (spanOrdinal < 0) return null;
			const domOrdinal = pairMathSpanIndexToDomIndex(
				request.index.source,
				renderedRoots,
				blockSpans,
				spanOrdinal,
			);
			if (null === domOrdinal) return null;
			candidates.push({
				domOrdinal,
				expectedDomMathCount: renderedRoots.length,
				kind: "math",
				mathSpans: blockSpans,
				spanOrdinal,
			});
		}
	} else if (matchingMathIndices.length > 1) {
		return null;
	}

	const sourceBlocks = request.index.blocks;
	const sourceBlockStart = lowerBoundByFrom(sourceBlocks, blockRange.start);
	const sourceBlockEnd = lowerBoundByFrom(sourceBlocks, blockRange.end);
	const mermaidSelectionPivot = lowerBoundByFrom(
		sourceBlocks,
		request.selection.start,
	);
	const mermaidCandidateIndices = [
		mermaidSelectionPivot - 1,
		mermaidSelectionPivot,
	].filter(
		(index, position, indices) =>
			index >= sourceBlockStart &&
			index < sourceBlockEnd &&
			indices.indexOf(index) === position,
	);
	const matchingMermaidCandidates: Array<
		Readonly<{ index: number; original: GeneratedContentOriginal }>
	> = [];
	for (const index of mermaidCandidateIndices) {
		const sourceBlock = sourceBlocks[index];
		if (
			"code" !== sourceBlock?.kind ||
			(sourceBlock?.from ?? 0) < blockRange.start ||
			(sourceBlock?.to ?? 0) > blockRange.end
		) {
			continue;
		}
		const original = mermaidOriginalForCodeBlock(
			request.index.source,
			sourceBlock,
		);
		if (
			original &&
			sourceSelectionMatchesGeneratedRanges(
				request.selection,
				original.fullRange,
				original.bodyRange,
			)
		) {
			matchingMermaidCandidates.push({ index, original });
		}
	}
	if (matchingMermaidCandidates.length > 1) return null;
	const mermaidCandidate = matchingMermaidCandidates[0];
	if (mermaidCandidate) {
		let ordinal = 0;
		for (
			let index = sourceBlockStart;
			index < mermaidCandidate.index;
			index++
		) {
			const sourceBlock = sourceBlocks[index];
			if (
				sourceBlock &&
				"code" === sourceBlock.kind &&
				sourceBlock.from >= blockRange.start &&
				sourceBlock.to <= blockRange.end &&
				mermaidOriginalForCodeBlock(request.index.source, sourceBlock)
			) {
				ordinal += 1;
			}
		}
		candidates.push({
			kind: "mermaid",
			ordinal,
			original: mermaidCandidate.original,
		});
	}
	if (1 !== candidates.length) return null;
	const candidate = candidates[0];
	if (!candidate) return null;
	if ("math" === candidate.kind) {
		const target = mintMathTargetForIndices(
			acceptedPreview,
			blockId,
			request.index.source,
			accepted.sourceRevision,
			candidate.mathSpans,
			candidate.spanOrdinal,
			candidate.domOrdinal,
		);
		if (
			!target ||
			!generatedTargetMatchesSourceSelection(target, request.selection)
		) {
			return null;
		}
		return {
			expectedDomMathCount: candidate.expectedDomMathCount,
			kind: "math",
			ordinal: candidate.domOrdinal,
			target,
		};
	}
	const associated = associateGeneratedContentTarget({
		acceptedPreview,
		blockId,
		kind: candidate.kind,
		ordinal: candidate.ordinal,
		original: candidate.original,
		source: request.index.source,
		sourceRevision: accepted.sourceRevision,
	});
	if (
		"associated" !== associated.status ||
		!generatedTargetMatchesSourceSelection(associated.target, request.selection)
	) {
		return null;
	}
	return {
		kind: candidate.kind,
		ordinal: candidate.ordinal,
		target: associated.target,
	};
}

export function assignGeneratedContentTargetHandlers(
	refs: PreviewSurfaceRefs,
): void {
	refs.getGeneratedPreviewIdentityRef.current = () => {
		const accepted = refs.acceptedGeneratedPreviewRef.current;
		const surface = refs.surfaceRef.current;
		if (
			!accepted ||
			!surface ||
			!isCurrentAcceptedGeneratedPreview(refs, accepted, surface, true)
		) {
			return null;
		}
		return {
			editMap: accepted.editMap,
			revision: accepted.generation,
			signature: accepted.signature,
			sourceRevision: accepted.sourceRevision,
		};
	};

	refs.prepareGeneratedContentTargetRef.current = (request) => {
		const accepted = refs.acceptedGeneratedPreviewRef.current;
		const surface = refs.surfaceRef.current;
		if (!accepted || !surface) return null;
		const minted = mintGeneratedContentTarget(request, accepted);
		if (!minted) return null;
		return createGeneratedContentTargetLease(
			refs,
			minted.target,
			request.element,
			accepted,
			surface,
			undefined,
			undefined,
			minted.expectedDomMathCount,
		);
	};

	refs.prepareGeneratedContentTargetForSelectionRef.current = (request) => {
		const accepted = refs.acceptedGeneratedPreviewRef.current;
		const surface = refs.surfaceRef.current;
		if (
			!accepted ||
			!surface ||
			!accepted.editMap ||
			request.index.source !== accepted.markdown ||
			request.index.revision !== accepted.sourceRevision ||
			request.index.length !== request.index.source.length ||
			!isCurrentAcceptedGeneratedPreview(refs, accepted, surface, true)
		) {
			return null;
		}
		const targetIndices = previewImageSelectionBlockIndices(
			accepted.markdown,
			accepted.editMap,
			accepted.signature,
			request.selection,
			{
				editableBlockRanges: accepted.editableBlockRanges,
				lineStarts: accepted.lineStarts,
			},
		);
		if (1 !== targetIndices.length) return null;
		const blockIndex = targetIndices[0];
		if (undefined === blockIndex) return null;
		const block = accepted.editMap.blocks[blockIndex];
		if (!block?.editable) return null;
		const candidate = generatedContentTargetForSelection(
			request,
			accepted,
			block.id,
			surface,
		);
		if (!candidate) return null;
		const getMountedLease = (
			parentIsCurrent?: () => boolean,
		): PreviewGeneratedContentTargetLease | null => {
			const element = generatedRootForTarget(
				refs,
				candidate.target,
				surface,
				candidate.expectedDomMathCount,
			);
			if (!element) return null;
			return createGeneratedContentTargetLease(
				refs,
				candidate.target,
				element,
				accepted,
				surface,
				undefined,
				parentIsCurrent,
				candidate.expectedDomMathCount,
			);
		};
		let released = false;
		return {
			getLease: () =>
				released ||
				!isCurrentAcceptedGeneratedPreview(refs, accepted, surface, true)
					? null
					: getMountedLease(() => !released),
			isCurrent: () =>
				!released &&
				isCurrentAcceptedGeneratedPreview(refs, accepted, surface, true),
			release: () => {
				released = true;
			},
			target: candidate.target,
		};
	};
}
