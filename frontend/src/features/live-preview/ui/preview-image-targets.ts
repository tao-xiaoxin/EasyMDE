import {
	associateGeneratedImageTargetBySelection,
	type GeneratedImageTarget,
	generatedImageTargetCount,
} from "../../generated-content-export/generated-image-target";
import { previewImageSelectionBlockIndices } from "./preview-selection-block-map";
import { isCurrentAcceptedGeneratedPreview } from "./preview-surface-runtime-helpers";
import type {
	AcceptedGeneratedPreview,
	PreviewImageTargetLease,
	PreviewImageTargetRequest,
	PreviewImageTargetSelectionRequest,
	PreviewSurfaceRefs,
} from "./preview-surface-types";

function prepareImageTargetLease(
	refs: PreviewSurfaceRefs,
	request: PreviewImageTargetRequest,
	accepted: AcceptedGeneratedPreview,
	surface: HTMLElement,
	parentIsCurrent?: () => boolean,
): PreviewImageTargetLease | null {
	const element = request.element;
	if (!element.isConnected || !surface.contains(element)) return null;
	const visualBlock = element.closest("[data-easymde-visual-block-id]");
	if (!(visualBlock instanceof HTMLElement)) return null;
	const blockId = visualBlock.getAttribute("data-easymde-visual-block-id");
	const blockRange = blockId ? accepted.blockRanges.get(blockId) : null;
	const block = blockRange ? accepted.editMap?.blocks[blockRange.index] : null;
	if (!blockId || !blockRange || !block?.editable) return null;
	const domImages = Array.from(visualBlock.querySelectorAll("img")).filter(
		(image) => image.closest("[data-easymde-visual-block-id]") === visualBlock,
	);
	const ordinal = domImages.indexOf(element);
	if (ordinal < 0) return null;
	const sourceBlocks = request.index.blocks.filter(
		(sourceBlock) =>
			sourceBlock.from >= blockRange.start &&
			sourceBlock.to <= blockRange.end &&
			sourceBlock.from < sourceBlock.to &&
			sourceBlock.kind !== "code" &&
			sourceBlock.kind !== "unavailable" &&
			request.selection.start >= sourceBlock.from &&
			request.selection.end <= sourceBlock.to &&
			request.index.images.some(
				(image) =>
					image.start >= sourceBlock.from && image.end <= sourceBlock.to,
			),
	);
	if (1 !== sourceBlocks.length) return null;
	const sourceBlock = sourceBlocks[0];
	if (!sourceBlock) return null;
	const targetBlock = {
		editable: sourceBlock.editable,
		end: sourceBlock.to,
		id: blockId,
		kind: sourceBlock.kind,
		start: sourceBlock.from,
	};
	const sourceCount = generatedImageTargetCount({
		block: targetBlock,
		index: request.index,
	});
	if (null === sourceCount || sourceCount !== domImages.length) return null;
	const associated = associateGeneratedImageTargetBySelection({
		acceptedPreview: {
			revision: accepted.generation,
			signature: accepted.signature,
		},
		block: targetBlock,
		index: request.index,
		selection: request.selection,
		sourceRevision: accepted.sourceRevision,
	});
	if ("failed" === associated.status) return null;
	if (associated.target.ordinal !== ordinal) return null;
	const stagedImages = refs.stagedPreviewImageElementsRef.current;
	if (
		!stagedImages ||
		stagedImages.generation !== accepted.generation ||
		stagedImages.byBlock.get(blockId)?.[ordinal] !== element
	) {
		return null;
	}
	const capturedAttributes = {
		alt: element.getAttribute("alt"),
		currentSrc: element.currentSrc,
		naturalHeight: element.naturalHeight,
		naturalWidth: element.naturalWidth,
		sizes: element.getAttribute("sizes"),
		src: element.getAttribute("src"),
		srcset: element.getAttribute("srcset"),
		title: element.getAttribute("title"),
	};
	const target = associated.target;
	const isCurrent = (): boolean =>
		Boolean(
			refs.acceptedGeneratedPreviewRef.current &&
				isCurrentAcceptedGeneratedPreview(refs, accepted, surface) &&
				element.isConnected &&
				surface.contains(element) &&
				element.closest("[data-easymde-visual-block-id]") === visualBlock &&
				Array.from(
					visualBlock.querySelectorAll<HTMLImageElement>("img"),
				).filter(
					(image) =>
						image.closest("[data-easymde-visual-block-id]") === visualBlock,
				)[target.ordinal] === element &&
				element.getAttribute("src") === capturedAttributes.src &&
				element.currentSrc === capturedAttributes.currentSrc &&
				element.naturalHeight === capturedAttributes.naturalHeight &&
				element.naturalWidth === capturedAttributes.naturalWidth &&
				element.getAttribute("srcset") === capturedAttributes.srcset &&
				element.getAttribute("sizes") === capturedAttributes.sizes &&
				element.getAttribute("alt") === capturedAttributes.alt &&
				element.getAttribute("title") === capturedAttributes.title &&
				target.sourceRevision === accepted.sourceRevision &&
				target.acceptedPreview.revision === accepted.generation &&
				target.acceptedPreview.signature === accepted.signature &&
				accepted.markdown.slice(target.original.start, target.original.end) ===
					target.original.raw,
		);
	if (!isCurrent()) return null;
	let released = false;
	return {
		isCurrent: () => !released && (parentIsCurrent?.() ?? true) && isCurrent(),
		release: () => {
			if (released) return;
			released = true;
		},
		root: element,
		target,
	};
}

function imageElementForTarget(
	refs: PreviewSurfaceRefs,
	target: GeneratedImageTarget,
	surface: HTMLElement,
): HTMLImageElement | null {
	const stagedImages = refs.stagedPreviewImageElementsRef.current;
	if (!stagedImages) return null;
	const element = stagedImages.byBlock.get(target.blockId)?.[target.ordinal];
	return element && surface.contains(element) ? element : null;
}

function imageTargetDomIdentityCurrent(
	refs: PreviewSurfaceRefs,
	target: GeneratedImageTarget,
	surface: HTMLElement,
): boolean {
	const expected = refs.stagedPreviewImageElementsRef.current?.byBlock.get(
		target.blockId,
	)?.[target.ordinal];
	if (!expected?.isConnected) return false;
	const visualBlock = expected.closest("[data-easymde-visual-block-id]");
	if (!(visualBlock instanceof HTMLElement) || !surface.contains(visualBlock)) {
		return false;
	}
	const images = Array.from(
		visualBlock.querySelectorAll<HTMLImageElement>("img"),
	).filter(
		(image) => image.closest("[data-easymde-visual-block-id]") === visualBlock,
	);
	return images[target.ordinal] === expected;
}

function imageTargetForSelection(
	request: PreviewImageTargetSelectionRequest,
	accepted: AcceptedGeneratedPreview,
	blockRange: Readonly<{ end: number; start: number }>,
	blockId: string,
): GeneratedImageTarget | null {
	const candidates: GeneratedImageTarget[] = [];
	for (const sourceBlock of request.index.blocks) {
		if (
			sourceBlock.from < blockRange.start ||
			sourceBlock.to > blockRange.end ||
			sourceBlock.from >= sourceBlock.to ||
			!sourceBlock.editable ||
			"code" === sourceBlock.kind ||
			"unavailable" === sourceBlock.kind
		) {
			continue;
		}
		const associated = associateGeneratedImageTargetBySelection({
			acceptedPreview: {
				revision: accepted.generation,
				signature: accepted.signature,
			},
			block: {
				editable: sourceBlock.editable,
				end: sourceBlock.to,
				id: blockId,
				kind: sourceBlock.kind,
				start: sourceBlock.from,
			},
			index: request.index,
			selection: request.selection,
			sourceRevision: accepted.sourceRevision,
		});
		if ("associated" === associated.status) candidates.push(associated.target);
	}
	return 1 === candidates.length ? (candidates[0] ?? null) : null;
}

export function assignImageTargetHandlers(refs: PreviewSurfaceRefs): void {
	refs.prepareImageTargetRef.current = (request) => {
		const accepted = refs.acceptedGeneratedPreviewRef.current;
		const surface = refs.surfaceRef.current;
		if (!accepted || !surface) return null;
		if (
			!request.index.complete ||
			request.index.source !== accepted.markdown ||
			request.index.revision !== accepted.sourceRevision ||
			request.index.length !== request.index.source.length
		) {
			return null;
		}
		return prepareImageTargetLease(refs, request, accepted, surface);
	};

	refs.prepareImageTargetBySelectionRef.current = (request) => {
		const accepted = refs.acceptedGeneratedPreviewRef.current;
		const surface = refs.surfaceRef.current;
		if (
			!accepted ||
			!surface ||
			!accepted.editMap ||
			!request.index.complete ||
			request.index.source !== accepted.markdown ||
			request.index.revision !== accepted.sourceRevision ||
			request.index.length !== request.index.source.length ||
			!isCurrentAcceptedGeneratedPreview(refs, accepted, surface, true) ||
			!Number.isSafeInteger(request.selection.start) ||
			!Number.isSafeInteger(request.selection.end) ||
			request.selection.start < 0 ||
			request.selection.end < request.selection.start ||
			request.selection.end > request.index.source.length
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
		const blockRange = block ? accepted.blockRanges.get(block.id) : null;
		if (!block?.editable || !blockRange) return null;
		const target = imageTargetForSelection(
			request,
			accepted,
			blockRange,
			block.id,
		);
		if (!target) return null;
		const getMountedLease = (
			parentIsCurrent?: () => boolean,
		): PreviewImageTargetLease | null => {
			const element = imageElementForTarget(refs, target, surface);
			if (!element) return null;
			const lease = prepareImageTargetLease(
				refs,
				{ element, index: request.index, selection: request.selection },
				accepted,
				surface,
				parentIsCurrent,
			);
			if (
				!lease ||
				lease.target.blockId !== target.blockId ||
				lease.target.ordinal !== target.ordinal ||
				lease.target.original.start !== target.original.start ||
				lease.target.original.end !== target.original.end
			) {
				lease?.release();
				return null;
			}
			return lease;
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
				isCurrentAcceptedGeneratedPreview(refs, accepted, surface, true) &&
				imageTargetDomIdentityCurrent(refs, target, surface),
			release: () => {
				released = true;
			},
			target,
		};
	};
}
