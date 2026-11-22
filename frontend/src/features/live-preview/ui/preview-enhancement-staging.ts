import type {
	PreviewEditMap,
	SafePreviewHtml,
} from "../../../contracts/ports/preview-request";
import {
	PREVIEW_STAGING_DOM_APPEND_MAX_NODES,
	PREVIEW_STAGING_SLICE_BUDGET_MS,
	PREVIEW_WINDOW_GEOMETRY_SLICE_BUDGET_MS,
	type PreviewEnhancementCandidate,
	type PreviewSurfaceStagingScheduler,
	previewScrollCanvas,
	VISUAL_MARKDOWN_SOURCE_ATTRIBUTE,
	type VisualBlockMarker,
	type VisualMarkdownSourceMarker,
} from "./preview-surface-types";
import {
	measurePreviewWindowBlockGeometry,
	type PreviewWindowNodeRepository,
	publishPreviewWindowMeasuredBlock,
	VISUAL_BLOCK_ATTRIBUTE,
	validatePreviewWindowMarkup,
} from "./preview-window-dom";

export function createEnhancementCandidate(
	activeSurface: HTMLElement,
	html: SafePreviewHtml,
	layoutParticipating: boolean,
	preparedSourceNodes?: ReadonlyArray<Node>,
): Readonly<{ sourceNodes: ReadonlyArray<Node>; surface: HTMLElement }> {
	const documentRef = activeSurface.ownerDocument;
	let parsedSourceNodes: ReadonlyArray<Node>;
	if (preparedSourceNodes) {
		parsedSourceNodes = preparedSourceNodes;
	} else {
		const template = documentRef.createElement("template");
		template.innerHTML = html;
		parsedSourceNodes = Array.from(template.content.childNodes);
	}
	const candidate = documentRef.createElement("div");
	candidate.className = activeSurface.className;
	candidate.style.cssText = activeSurface.style.cssText;
	candidate.setAttribute("aria-hidden", "true");
	candidate.setAttribute("inert", "");
	candidate.dataset.easymdePreviewStaging = "1";
	candidate.style.position = "fixed";
	candidate.style.insetInlineStart = "-100000px";
	candidate.style.top = "0";
	candidate.style.width = `${Math.max(
		1,
		activeSurface.getBoundingClientRect().width,
	)}px`;
	candidate.style.maxWidth = "none";
	candidate.style.visibility = "hidden";
	candidate.style.pointerEvents = "none";
	if (layoutParticipating) {
		previewScrollCanvas(activeSurface).append(candidate);
	} else {
		candidate.style.display = "none";
	}
	return {
		sourceNodes: parsedSourceNodes,
		surface: candidate,
	};
}

export async function measurePreviewWindowCandidateGeometry(
	repository: PreviewWindowNodeRepository,
	surface: HTMLElement,
	scheduler: PreviewSurfaceStagingScheduler,
	isCurrent: () => boolean,
	signal: AbortSignal,
): Promise<boolean> {
	let sliceStartedAt = stagingTime(scheduler, surface.ownerDocument);
	for (let index = 0; index < repository.nodes.length; index += 1) {
		if (signal.aborted || !isCurrent()) return false;
		const node = repository.nodes[index];
		if (!node?.isConnected || node.parentNode !== surface) continue;
		const rect = node.getBoundingClientRect();
		if (!Number.isFinite(rect.height) || rect.height <= 0) continue;
		const previousGeometry = repository.flowGeometry[index];
		if (!previousGeometry) continue;
		const measurement = measurePreviewWindowBlockGeometry(
			node,
			repository.nodes[index + 1] ?? null,
			previousGeometry,
			repository.ownedGap?.node,
			rect,
		);
		if (!measurement) continue;
		publishPreviewWindowMeasuredBlock(
			repository,
			surface,
			index,
			measurement,
			0,
			rect,
		);
		if (
			stagingTime(scheduler, surface.ownerDocument) - sliceStartedAt >=
			PREVIEW_WINDOW_GEOMETRY_SLICE_BUDGET_MS
		) {
			await scheduler.yield();
			if (signal.aborted || !isCurrent()) return false;
			sliceStartedAt = stagingTime(scheduler, surface.ownerDocument);
		}
	}
	return true;
}

export function defaultPreviewSurfaceStagingScheduler(
	documentRef: Document,
): PreviewSurfaceStagingScheduler {
	const windowRef = documentRef.defaultView;
	return {
		now: () => windowRef?.performance?.now() ?? Date.now(),
		yield: () =>
			new Promise<void>((resolve) => {
				if (windowRef?.requestAnimationFrame) {
					windowRef.requestAnimationFrame(() => resolve());
					return;
				}
				if (windowRef) {
					windowRef.setTimeout(resolve, 0);
					return;
				}
				setTimeout(resolve, 0);
			}),
	};
}

export function stagingTime(
	scheduler: PreviewSurfaceStagingScheduler,
	documentRef: Document,
): number {
	return (
		scheduler.now?.() ??
		documentRef.defaultView?.performance?.now() ??
		Date.now()
	);
}

export async function populateEnhancementCandidate(
	candidate: PreviewEnhancementCandidate,
	scheduler: PreviewSurfaceStagingScheduler,
	isCurrent: () => boolean,
	signal: AbortSignal,
): Promise<boolean> {
	const documentRef = candidate.surface.ownerDocument;
	let sliceStartedAt = stagingTime(scheduler, documentRef);
	let index = 0;
	while (index < candidate.sourceNodes.length) {
		const batch = documentRef.createDocumentFragment();
		let batchSize = 0;
		do {
			if (signal.aborted || !isCurrent()) return false;
			const node = candidate.sourceNodes[index];
			if (!node) throw new Error("preview-staging-node-missing");
			batch.append(node);
			index += 1;
			batchSize += 1;
		} while (
			index < candidate.sourceNodes.length &&
			batchSize < PREVIEW_STAGING_DOM_APPEND_MAX_NODES &&
			stagingTime(scheduler, documentRef) - sliceStartedAt <
				PREVIEW_STAGING_SLICE_BUDGET_MS
		);
		candidate.surface.append(batch);
		if (
			index < candidate.sourceNodes.length &&
			stagingTime(scheduler, documentRef) - sliceStartedAt >=
				PREVIEW_STAGING_SLICE_BUDGET_MS
		) {
			await scheduler.yield();
			if (signal.aborted || !isCurrent()) return false;
			sliceStartedAt = stagingTime(scheduler, documentRef);
		}
	}
	return !signal.aborted && isCurrent();
}

export function discardEnhancementCandidate(
	candidate: PreviewEnhancementCandidate | null,
): void {
	candidate?.surface.remove();
}

export function capturePreviewBlockMarkers(
	surface: HTMLElement,
	editMap: PreviewEditMap,
	scheduler: PreviewSurfaceStagingScheduler,
	isCurrent: () => boolean,
	signal: AbortSignal,
):
	| ReadonlyArray<VisualBlockMarker>
	| null
	| Promise<ReadonlyArray<VisualBlockMarker> | null> {
	validatePreviewWindowMarkup(surface, editMap);
	const markers: VisualBlockMarker[] = [];
	const documentRef = surface.ownerDocument;
	const stale = (): null => {
		removePreviewBlockMarkers(markers);
		return null;
	};
	const capture =
		async (): Promise<ReadonlyArray<VisualBlockMarker> | null> => {
			let sliceStartedAt = stagingTime(scheduler, documentRef);
			try {
				for (
					let blockIndex = 0;
					blockIndex < editMap.blocks.length;
					blockIndex += 1
				) {
					if (signal.aborted || !isCurrent()) return stale();
					const block = editMap.blocks[blockIndex];
					const root = surface.children[blockIndex];
					if (!block || !(root instanceof HTMLElement)) {
						throw new Error("preview-window-block-map-marker-mismatch");
					}
					const marker = documentRef.createComment(
						`easymde-visual-block:${block.id}`,
					);
					root.before(marker);
					markers.push({ id: block.id, marker });
					if (
						blockIndex + 1 < editMap.blocks.length &&
						stagingTime(scheduler, documentRef) - sliceStartedAt >=
							PREVIEW_STAGING_SLICE_BUDGET_MS
					) {
						await scheduler.yield();
						if (signal.aborted || !isCurrent()) return stale();
						sliceStartedAt = stagingTime(scheduler, documentRef);
					}
				}
				return markers;
			} catch (error) {
				removePreviewBlockMarkers(markers);
				throw error;
			}
		};
	return capture();
}

export function removePreviewBlockMarkers(
	markers: ReadonlyArray<VisualBlockMarker>,
): void {
	for (const { marker } of markers) marker.remove();
}

export function annotateEnhancedPreviewBlocks(
	markers: ReadonlyArray<VisualBlockMarker>,
	scheduler: PreviewSurfaceStagingScheduler,
	isCurrent: () => boolean,
	signal: AbortSignal,
): boolean | Promise<boolean> {
	const documentRef = markers[0]?.marker.ownerDocument;
	if (!documentRef) {
		removePreviewBlockMarkers(markers);
		return !signal.aborted && isCurrent();
	}
	const annotate = async (): Promise<boolean> => {
		let sliceStartedAt = stagingTime(scheduler, documentRef);
		try {
			for (let index = 0; index < markers.length; index += 1) {
				if (signal.aborted || !isCurrent()) return false;
				const entry = markers[index];
				const target = entry?.marker.nextElementSibling;
				if (!entry || !(target instanceof HTMLElement)) {
					throw new Error("preview-window-block-map-marker-mismatch");
				}
				target.setAttribute(VISUAL_BLOCK_ATTRIBUTE, entry.id);
				if (
					index + 1 < markers.length &&
					stagingTime(scheduler, documentRef) - sliceStartedAt >=
						PREVIEW_STAGING_SLICE_BUDGET_MS
				) {
					await scheduler.yield();
					if (signal.aborted || !isCurrent()) return false;
					sliceStartedAt = stagingTime(scheduler, documentRef);
				}
			}
			return !signal.aborted && isCurrent();
		} finally {
			removePreviewBlockMarkers(markers);
		}
	};
	return annotate();
}

export function captureVisualMarkdownSources(
	surface: HTMLElement,
): ReadonlyArray<VisualMarkdownSourceMarker> {
	const sources: VisualMarkdownSourceMarker[] = [];
	for (const node of surface.querySelectorAll<HTMLElement>(".easymde-math")) {
		if (node.closest("pre > code")) continue;
		const marker = surface.ownerDocument.createComment(
			"easymde-visual-markdown-source",
		);
		node.before(marker);
		sources.push({ kind: "math", marker, source: node.textContent ?? "" });
	}
	for (const node of surface.querySelectorAll<HTMLElement>(
		"pre > code.language-mermaid",
	)) {
		const block = node.parentElement;
		if (!block) throw new Error("preview-enhancement-visual-source-missing");
		const marker = surface.ownerDocument.createComment(
			"easymde-visual-markdown-source",
		);
		block.before(marker);
		sources.push({ kind: "mermaid", marker, source: node.textContent ?? "" });
	}
	return sources;
}

export function removeVisualMarkdownSourceMarkers(
	sources: ReadonlyArray<VisualMarkdownSourceMarker>,
): void {
	for (const { marker } of sources) marker.remove();
}

export function annotateEnhancedVisualSources(
	sources: ReadonlyArray<VisualMarkdownSourceMarker>,
): void {
	try {
		for (const { kind, marker, source } of sources) {
			const output = marker.nextElementSibling;
			const target =
				"math" === kind
					? output?.matches(".easymde-math")
						? output
						: null
					: output?.matches(".easymde-mermaid")
						? output
						: output?.matches("pre")
							? output.querySelector(":scope > code.language-mermaid")
							: null;
			if (!target) {
				throw new Error("preview-enhancement-visual-source-missing");
			}
			target.setAttribute(VISUAL_MARKDOWN_SOURCE_ATTRIBUTE, source);
		}
	} finally {
		removeVisualMarkdownSourceMarkers(sources);
	}
}
