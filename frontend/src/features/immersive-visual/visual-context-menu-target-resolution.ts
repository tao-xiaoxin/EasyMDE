import { NodeSelection, Selection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type {
	VisualEditorGeneratedContentKind,
	VisualEditorGeneratedContentOriginal,
	VisualEditorGeneratedContentTargetIndex,
	VisualEditorImageTargetIndex,
	VisualEditorMarkdownImageScaleMatch,
	VisualEditorSourceRange,
} from "../../contracts/visual-editor";
import {
	normalizeLineEndingsToLf,
	VISUAL_MARKDOWN_SOURCE_ATTRIBUTE,
} from "../../shared/markdown/normalize-math-tex";
import { mathElementMatchesSource } from "../generated-content-export/generated-content-target";
import { pairMathDomIndexToSpanIndex } from "../generated-content-export/generated-math-pairing";

/**
 * Pure DOM and source-index target resolution for the ProseMirror visual
 * context-menu runtime: rendered image slots, pointer-target selections, and
 * image/math/Mermaid source originals. Nothing here dispatches or mutates.
 */

export type ImageMatchResolution = Readonly<{
	blockId: string;
	match: VisualEditorMarkdownImageScaleMatch;
	ordinal: number;
}>;

export type GeneratedContentResolution = Readonly<{
	blockId: string;
	ordinal: number;
	original: VisualEditorGeneratedContentOriginal;
}>;

const ATOMIC_NODE_NAMES = new Set([
	"horizontal_rule",
	"image",
	"protected_block",
	"protected_inline",
]);

const MERMAID_FENCE_HEADER_PATTERN =
	/^ {0,3}(?:`{3,}|~{3,})\s*mermaid(?:\s|$)/i;
const CONTENT_IMAGE_SELECTOR = "img:not(.ProseMirror-separator)";

const TRANSIENT_TOP_LEVEL_SELECTOR =
	".ProseMirror-gapcursor, .ProseMirror-widget";
export function contentImages(view: EditorView): HTMLImageElement[] {
	return Array.from(
		view.dom.querySelectorAll<HTMLImageElement>(CONTENT_IMAGE_SELECTOR),
	);
}

/**
 * Rendered image slot identity. MUST stay identical to
 * `visualImageSlotIdentity` in `app/editor/editor-context-menu-helpers.ts`:
 * an explicit `[data-easymde-visual-block-id]` block wins; otherwise the slot
 * is `pm-block-N` (N = top-level ProseMirror block index, ignoring transient
 * gap-cursor/widget DOM) plus the image ordinal inside that block, never
 * counting `img.ProseMirror-separator`.
 */
export function imageSlotIdentity(
	surface: Element,
	image: HTMLImageElement,
): Readonly<{ blockId: string; ordinal: number }> | null {
	if (!image.matches(CONTENT_IMAGE_SELECTOR) || !surface.contains(image))
		return null;
	const block = image.closest("[data-easymde-visual-block-id]");
	const blockId = block?.getAttribute("data-easymde-visual-block-id");
	if (block && blockId && surface.contains(block)) {
		const ordinal = Array.from(block.querySelectorAll(CONTENT_IMAGE_SELECTOR))
			.filter(
				(candidate) =>
					candidate.closest("[data-easymde-visual-block-id]") === block,
			)
			.indexOf(image);
		return ordinal < 0 ? null : { blockId, ordinal };
	}
	let topLevel: Element = image;
	while (topLevel.parentElement && topLevel.parentElement !== surface) {
		topLevel = topLevel.parentElement;
	}
	if (topLevel.parentElement !== surface) return null;
	const blockIndex = Array.from(surface.children)
		.filter((child) => !child.matches(TRANSIENT_TOP_LEVEL_SELECTOR))
		.indexOf(topLevel);
	const ordinal =
		topLevel === image
			? 0
			: Array.from(topLevel.querySelectorAll(CONTENT_IMAGE_SELECTOR)).indexOf(
					image,
				);
	return blockIndex < 0 || ordinal < 0
		? null
		: { blockId: `pm-block-${blockIndex}`, ordinal };
}

/** One block-id scheme: `pm-block-N`, N = index of the containing source block. */
function blockIdFor(
	blocks: ReadonlyArray<Readonly<{ from: number; to: number }>>,
	offset: number,
	fallback: number,
): string {
	for (let i = 0; i < blocks.length; i += 1) {
		const block = blocks[i];
		if (block && offset >= block.from && offset < block.to)
			return `pm-block-${i}`;
	}
	return `pm-block-${fallback}`;
}

function resolvePosForDomElement(
	view: EditorView,
	element: Element,
): number | null {
	try {
		const pos = view.posAtDOM(element, 0);
		return pos >= 0 && pos <= view.state.doc.content.size ? pos : null;
	} catch {
		return null;
	}
}

function resolveAtomicNodeSelection(
	view: EditorView,
	element: Element,
): NodeSelection | null {
	const pos = resolvePosForDomElement(view, element);
	if (pos === null) return null;
	for (const candidatePos of [pos, pos - 1]) {
		if (candidatePos < 0 || candidatePos >= view.state.doc.content.size)
			continue;
		const node = view.state.doc.nodeAt(candidatePos);
		if (node && ATOMIC_NODE_NAMES.has(node.type.name)) {
			try {
				return NodeSelection.create(view.state.doc, candidatePos);
			} catch {
				// Try next candidate position.
			}
		}
	}
	return null;
}

export function resolveSelectionForPointerTarget(
	view: EditorView,
	target: Element | null | undefined,
	point: Readonly<{ x: number; y: number }> | undefined,
	activation: "keyboard" | "pointer" | undefined,
): Selection {
	const currentSelection = view.state.selection;
	if (activation === "keyboard") return currentSelection;
	// A pointer on an atom (image, protected card, rule) re-targets a collapsed
	// caret or a previous atom's NodeSelection (Image A -> Image B), but never
	// replaces a deliberate non-empty text extent.
	const replaceable =
		currentSelection.empty || currentSelection instanceof NodeSelection;
	if (replaceable && target && view.dom.contains(target)) {
		const imageTarget =
			target instanceof HTMLImageElement ? target : target.closest("img");
		const atomicTarget =
			(imageTarget && !imageTarget.classList.contains("ProseMirror-separator")
				? imageTarget
				: null) ??
			target.closest(
				"[data-easymde-protected-block], [data-easymde-protected-inline]",
			) ??
			target.closest("hr");
		if (atomicTarget && view.dom.contains(atomicTarget)) {
			const atomicSel = resolveAtomicNodeSelection(view, atomicTarget);
			if (atomicSel) return atomicSel;
		}
	}
	// A deliberate non-empty selection is the user's own extent.
	if (!currentSelection.empty) return currentSelection;

	if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
		const coords = view.posAtCoords({ left: point.x, top: point.y });
		if (
			coords &&
			coords.pos >= 0 &&
			coords.pos <= view.state.doc.content.size
		) {
			if (coords.inside >= 0) {
				const insideNode = view.state.doc.nodeAt(coords.inside);
				if (insideNode && ATOMIC_NODE_NAMES.has(insideNode.type.name)) {
					try {
						return NodeSelection.create(view.state.doc, coords.inside);
					} catch {
						// Fall through to nearest selection.
					}
				}
			}
			return Selection.near(view.state.doc.resolve(coords.pos));
		}
	}

	if (target && view.dom.contains(target)) {
		const domPos = resolvePosForDomElement(view, target);
		if (domPos !== null) return Selection.near(view.state.doc.resolve(domPos));
	}
	return currentSelection;
}

export function selectionMatchesRange(
	selection: VisualEditorSourceRange,
	rangeStart: number,
	rangeEnd: number,
): boolean {
	return selection.start === selection.end
		? selection.start >= rangeStart && selection.start <= rangeEnd
		: selection.start >= rangeStart && selection.end <= rangeEnd;
}

export function findImageMatchInIndex(
	index: VisualEditorImageTargetIndex,
	selection: VisualEditorSourceRange,
	elementOrdinal?: number,
): ImageMatchResolution | null {
	let globalOrdinal = 0;
	for (let blockIdx = 0; blockIdx < index.blockImages.length; blockIdx += 1) {
		const blockEntry = index.blockImages[blockIdx];
		if (blockEntry?.status !== "ready") continue;
		for (let imgIdx = 0; imgIdx < blockEntry.images.length; imgIdx += 1) {
			const match = blockEntry.images[imgIdx];
			if (!match) continue;
			if (
				selectionMatchesRange(selection, match.start, match.end) &&
				(elementOrdinal === undefined || globalOrdinal === elementOrdinal)
			) {
				return {
					blockId: blockIdFor(index.blocks, match.start, blockIdx),
					match,
					ordinal: imgIdx,
				};
			}
			globalOrdinal += 1;
		}
	}
	for (let i = 0; i < index.images.length; i += 1) {
		const match = index.images[i];
		if (
			match &&
			selectionMatchesRange(selection, match.start, match.end) &&
			(elementOrdinal === undefined || i === elementOrdinal)
		) {
			return {
				blockId: blockIdFor(index.blocks, match.start, 0),
				match,
				ordinal: i,
			};
		}
	}
	return null;
}

export function collectMermaidBlocks(
	index: VisualEditorGeneratedContentTargetIndex,
): ReadonlyArray<Readonly<{ blockIdx: number; from: number; to: number }>> {
	const results: Array<
		Readonly<{ blockIdx: number; from: number; to: number }>
	> = [];
	for (let i = 0; i < index.blocks.length; i += 1) {
		const block = index.blocks[i];
		if (block?.kind !== "code") continue;
		if (
			MERMAID_FENCE_HEADER_PATTERN.test(
				index.source.slice(block.from, block.to),
			)
		) {
			results.push({ blockIdx: i, from: block.from, to: block.to });
		}
	}
	return results;
}

function extractMermaidOriginal(
	source: string,
	from: number,
	to: number,
): VisualEditorGeneratedContentOriginal | null {
	if (from < 0 || to > source.length || from >= to) return null;
	const full = source.slice(from, to);
	const firstNl = full.indexOf("\n");
	const lastNl = full.lastIndexOf("\n");
	if (firstNl < 0 || lastNl <= firstNl) {
		return {
			body: full,
			bodyRange: { from, to },
			full,
			fullRange: { from, to },
		};
	}
	const bodyFrom = from + firstNl + 1;
	const bodyTo = from + lastNl;
	return {
		body: source.slice(bodyFrom, bodyTo),
		bodyRange: { from: bodyFrom, to: bodyTo },
		full,
		fullRange: { from, to },
	};
}

function mermaidElementMatchesSource(element: Element, full: string): boolean {
	const domRaw = element.getAttribute(VISUAL_MARKDOWN_SOURCE_ATTRIBUTE);
	return (
		domRaw === null ||
		normalizeLineEndingsToLf(domRaw) === normalizeLineEndingsToLf(full)
	);
}

function resolveByCountParityOrUniqueMatch<T>(
	candidates: ReadonlyArray<T>,
	ordinal: number,
	options: Readonly<{
		allowFallback: boolean;
		hasCountParity: boolean;
		hasExcessDomElements: boolean;
		matchesAtOrdinal: (candidate: T) => boolean;
		matchesFallback: (candidate: T) => boolean;
	}>,
): number {
	if (options.hasExcessDomElements) return -1;
	const atOrdinal = candidates[ordinal];
	if (
		options.hasCountParity &&
		atOrdinal !== undefined &&
		options.matchesAtOrdinal(atOrdinal)
	) {
		return ordinal;
	}
	if (!options.allowFallback) return -1;
	let matchedIdx = -1;
	for (let i = 0; i < candidates.length; i += 1) {
		const candidate = candidates[i];
		if (candidate !== undefined && options.matchesFallback(candidate)) {
			if (matchedIdx >= 0) return -1;
			matchedIdx = i;
		}
	}
	return matchedIdx;
}

export function resolveMermaidBlockOriginal(
	source: string,
	entry: Readonly<{ blockIdx: number; from: number; to: number }>,
	ordinal: number,
): GeneratedContentResolution | null {
	const original = extractMermaidOriginal(source, entry.from, entry.to);
	return original
		? { blockId: `pm-block-${entry.blockIdx}`, ordinal, original }
		: null;
}

export function pickMermaidDomElement(
	elements: ReadonlyArray<Element>,
	expectedCount: number,
	ordinal: number,
	full: string,
): Element | null {
	const resolvedIdx = resolveByCountParityOrUniqueMatch(elements, ordinal, {
		allowFallback: true,
		hasCountParity: elements.length === expectedCount,
		hasExcessDomElements: elements.length > expectedCount,
		matchesAtOrdinal: (el) => mermaidElementMatchesSource(el, full),
		matchesFallback: (el) =>
			el.getAttribute(VISUAL_MARKDOWN_SOURCE_ATTRIBUTE) !== null &&
			mermaidElementMatchesSource(el, full),
	});
	return resolvedIdx < 0 ? null : (elements[resolvedIdx] ?? null);
}

function resolveMathSpanOriginal(
	index: VisualEditorGeneratedContentTargetIndex,
	spanIndex: number,
): GeneratedContentResolution | null {
	const span = index.mathSpans[spanIndex];
	if (!span) return null;
	const source = index.source;
	if (
		span.from < 0 ||
		span.from >= span.to ||
		span.bodyFrom < span.from ||
		span.bodyTo > span.to ||
		span.bodyFrom > span.bodyTo ||
		span.to > source.length
	) {
		return null;
	}
	return {
		blockId: blockIdFor(index.blocks, span.from, spanIndex),
		ordinal: spanIndex,
		original: {
			body: source.slice(span.bodyFrom, span.bodyTo),
			bodyRange: { from: span.bodyFrom, to: span.bodyTo },
			full: source.slice(span.from, span.to),
			fullRange: { from: span.from, to: span.to },
		},
	};
}

export function findGeneratedContentOriginal(
	index: VisualEditorGeneratedContentTargetIndex,
	kind: VisualEditorGeneratedContentKind,
	ordinal: number,
	element: Element | null,
): GeneratedContentResolution | null {
	if (!Number.isSafeInteger(ordinal) || ordinal < 0) return null;
	const source = index.source;
	const domRaw = element?.getAttribute(VISUAL_MARKDOWN_SOURCE_ATTRIBUTE) ?? null;
	const selector = kind === "math" ? ".easymde-math" : ".easymde-mermaid";
	const editorRoot = element?.closest(".ProseMirror") ?? null;

	if (kind === "math") {
		if (element === null) {
			return resolveMathSpanOriginal(index, ordinal);
		}
		if (editorRoot) {
			const renderedRoots = Array.from(editorRoot.querySelectorAll(selector));
			if (renderedRoots[ordinal] !== element) return null;
			const spanIdx = pairMathDomIndexToSpanIndex(
				source,
				renderedRoots,
				index.mathSpans,
				ordinal,
			);
			return spanIdx === null ? null : resolveMathSpanOriginal(index, spanIdx);
		}
		const span = index.mathSpans[ordinal];
		if (
			!span ||
			!mathElementMatchesSource(element, {
				body: source.slice(span.bodyFrom, span.bodyTo),
				displayMode: span.displayMode,
				full: source.slice(span.from, span.to),
			})
		) {
			return null;
		}
		return resolveMathSpanOriginal(index, ordinal);
	}

	const domCount = editorRoot
		? editorRoot.querySelectorAll(selector).length
		: null;
	const mermaidBlocks = collectMermaidBlocks(index);
	const resolvedIdx = resolveByCountParityOrUniqueMatch(
		mermaidBlocks,
		ordinal,
		{
			allowFallback: domRaw !== null,
			hasCountParity: domCount === null || domCount === mermaidBlocks.length,
			hasExcessDomElements:
				domCount !== null && domCount > mermaidBlocks.length,
			matchesAtOrdinal: (entry) =>
				element === null
					? true
					: mermaidElementMatchesSource(
							element,
							source.slice(entry.from, entry.to),
						),
			matchesFallback: (entry) =>
				element === null
					? true
					: mermaidElementMatchesSource(
							element,
							source.slice(entry.from, entry.to),
						),
		},
	);
	const entry = mermaidBlocks[resolvedIdx];
	return entry ? resolveMermaidBlockOriginal(source, entry, resolvedIdx) : null;
}
