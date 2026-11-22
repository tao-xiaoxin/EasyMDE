import type { EditorMarkdownSourceBlock } from "../../../contracts/ports/editor-block-index-port";
import type { PreviewEditMap } from "../../../contracts/ports/preview-request";
import {
	isMarkdownTerminalWhitespaceSuffix,
	markdownLineStarts,
} from "../../../shared/markdown/markdown-line-model";
import type {
	GeneratedContentOriginal,
	GeneratedContentTarget,
} from "../../generated-content-export/generated-content-target";
import { DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED } from "../model/preview-window-model";
import type {
	AcceptedEditableBlockRange,
	AcceptedGeneratedPreview,
	PreviewEnhancementCandidate,
	PreviewSourceSelection,
	StagedPreviewImageElements,
} from "./preview-surface-types";
import { PreviewWindowDomError } from "./preview-window-dom";

export function previewDocumentEndBlockIndex(
	markdown: string,
	editMap: PreviewEditMap,
	signature: string,
): number {
	if (
		editMap.signature !== signature ||
		1 !== editMap.version ||
		"line" !== editMap.coordinate
	) {
		throw new PreviewWindowDomError("preview-window-document-end-map-invalid");
	}

	const lineStarts = markdownLineStarts(markdown);

	let lastEditableBlockIndex = -1;
	editMap.blocks.forEach((block, index) => {
		if (block.editable) lastEditableBlockIndex = index;
	});

	const eofBlocks = editMap.blocks.flatMap((block, index) => {
		const zeroWidthGeneratedBlock =
			!block.editable && block.startLine === block.endLine;
		if (
			!Number.isInteger(block.startLine) ||
			!Number.isInteger(block.endLine) ||
			block.startLine < 0 ||
			block.startLine > lineStarts.length ||
			block.endLine < block.startLine ||
			(block.endLine === block.startLine && !zeroWidthGeneratedBlock) ||
			block.endLine > lineStarts.length
		) {
			throw new PreviewWindowDomError(
				"preview-window-document-end-range-invalid",
			);
		}
		const start =
			block.startLine === lineStarts.length
				? markdown.length
				: lineStarts[block.startLine];
		const end =
			block.endLine === lineStarts.length
				? markdown.length
				: lineStarts[block.endLine];
		if (undefined === start || undefined === end) {
			throw new PreviewWindowDomError(
				"preview-window-document-end-range-invalid",
			);
		}
		const reachesDocumentEnd =
			end === markdown.length ||
			isMarkdownTerminalWhitespaceSuffix(markdown.slice(end));
		return block.editable && start < markdown.length && reachesDocumentEnd
			? [index]
			: [];
	});

	if (
		1 !== eofBlocks.length ||
		eofBlocks[0] !== lastEditableBlockIndex ||
		editMap.blocks.length <= DEFAULT_PREVIEW_WINDOW_MAX_MOUNTED
	) {
		throw new PreviewWindowDomError(
			"preview-window-document-end-block-unavailable",
		);
	}
	return eofBlocks[0];
}

export function previewSourceSelectionBlockIndices(
	markdown: string,
	editMap: PreviewEditMap,
	signature: string,
	sourceSelection: Readonly<{ end: number; start: number }>,
): number[] {
	if (
		editMap.signature !== signature ||
		1 !== editMap.version ||
		"line" !== editMap.coordinate
	) {
		throw new PreviewWindowDomError("preview-window-selection-map-invalid");
	}
	const range = sourceSelection.start !== sourceSelection.end;
	const offsets = [sourceSelection.start, sourceSelection.end];
	if (
		offsets.some(
			(offset) =>
				!Number.isSafeInteger(offset) || offset < 0 || offset > markdown.length,
		)
	) {
		throw new PreviewWindowDomError("preview-window-selection-range-invalid");
	}
	const lineStarts = markdownLineStarts(markdown);
	const collapsed = sourceSelection.start === sourceSelection.end;
	const indices = [
		previewSourceSelectionBlockIndex(
			markdown,
			editMap,
			signature,
			lineStarts,
			sourceSelection.start,
			false,
			collapsed,
		),
		...(range
			? [
					previewSourceSelectionBlockIndex(
						markdown,
						editMap,
						signature,
						lineStarts,
						sourceSelection.end,
						true,
						false,
					),
				]
			: []),
	];
	// A selection pins its owning endpoint roots, not every block between
	// them. The canonical range stays complete and ordered; materializing
	// every interior block would exceed the window cap on a large document
	// and make a legal whole-document selection unrepresentable. This is the
	// same endpoint identity contract the image-selection mapper uses.
	return [...new Set(indices)];
}

function previewSourceSelectionBlockIndex(
	markdown: string,
	editMap: PreviewEditMap,
	signature: string,
	lineStarts: ReadonlyArray<number>,
	offset: number,
	preferPrevious: boolean,
	collapsed: boolean,
): number {
	if (offset === markdown.length) {
		return previewDocumentEndBlockIndex(markdown, editMap, signature);
	}
	const lineIndex = markdownLineIndexAtOffset(lineStarts, offset);
	const exactLineStart = lineStarts[lineIndex] === offset;
	const candidateLines =
		preferPrevious && exactLineStart
			? Array.from({ length: lineIndex + 1 }, (_, index) => lineIndex - index)
			: [lineIndex];
	for (const candidateLine of candidateLines) {
		const blockIndex = editMap.blocks.findIndex(
			(block) =>
				block.editable &&
				block.startLine <= candidateLine &&
				candidateLine < block.endLine,
		);
		if (blockIndex >= 0) return blockIndex;
	}
	// A canonical removal can leave a *collapsed* caret on the line terminators
	// the removed block kept, and that position has no editable owner. The
	// following editable block owns the pin then, otherwise the preceding one,
	// but only while the source between the caret and that block is blank:
	// nothing else is recoverable whitespace, and a non-collapsed endpoint
	// keeps its explicit failure.
	const nearest = collapsed
		? blankLineEditableBlockIndex(
				markdown,
				editMap,
				lineStarts,
				lineIndex,
				offset,
			)
		: -1;
	if (nearest >= 0) return nearest;
	throw new PreviewWindowDomError("preview-window-selection-block-unavailable");
}

/**
 * The editable block a collapsed caret with no editable owner on its own line
 * can still pin, or `-1` when no block is reachable through blank source. The
 * following block wins when every skipped line is blank, otherwise the
 * preceding block when the source between its range end and the caret is blank.
 */
function blankLineEditableBlockIndex(
	markdown: string,
	editMap: PreviewEditMap,
	lineStarts: ReadonlyArray<number>,
	lineIndex: number,
	offset: number,
): number {
	let previous = -1;
	let previousStart = -1;
	let next = -1;
	let nextStart = -1;
	editMap.blocks.forEach((block, index) => {
		if (!block.editable || block.endLine <= block.startLine) return;
		if (block.endLine <= lineIndex) {
			previous = index;
			previousStart = lineStarts[block.endLine] ?? -1;
		} else if (-1 === next && block.startLine > lineIndex) {
			next = index;
			nextStart = lineStarts[block.startLine] ?? -1;
		}
	});
	if (
		-1 !== next &&
		nextStart >= 0 &&
		isMarkdownTerminalWhitespaceSuffix(markdown.slice(offset, nextStart))
	) {
		return next;
	}
	if (
		-1 !== previous &&
		previousStart >= 0 &&
		isMarkdownTerminalWhitespaceSuffix(markdown.slice(previousStart, offset))
	) {
		return previous;
	}
	return -1;
}

export function previewImageSelectionBlockIndices(
	markdown: string,
	editMap: PreviewEditMap,
	signature: string,
	sourceSelection: Readonly<{ end: number; start: number }>,
	cached?: Readonly<{
		editableBlockRanges: ReadonlyArray<AcceptedEditableBlockRange>;
		lineStarts: ReadonlyArray<number>;
	}>,
): number[] {
	if (
		editMap.signature !== signature ||
		1 !== editMap.version ||
		"line" !== editMap.coordinate
	)
		throw new PreviewWindowDomError("preview-window-selection-map-invalid");
	const range = sourceSelection.start !== sourceSelection.end;
	const offsets = [sourceSelection.start, sourceSelection.end];
	if (
		offsets.some(
			(offset) =>
				!Number.isSafeInteger(offset) || offset < 0 || offset > markdown.length,
		)
	)
		throw new PreviewWindowDomError("preview-window-selection-range-invalid");
	const lineStarts = cached?.lineStarts ?? markdownLineStarts(markdown);
	const indices = [
		previewImageSelectionBlockIndex(
			editMap,
			lineStarts,
			sourceSelection.start,
			cached,
			false,
		),
		...(range
			? [
					previewImageSelectionBlockIndex(
						editMap,
						lineStarts,
						sourceSelection.end,
						cached,
						true,
					),
				]
			: []),
	];
	return [...new Set(indices)];
}

function previewImageSelectionBlockIndex(
	editMap: PreviewEditMap,
	lineStarts: ReadonlyArray<number>,
	offset: number,
	cached:
		| Readonly<{
				editableBlockRanges: ReadonlyArray<AcceptedEditableBlockRange>;
				lineStarts: ReadonlyArray<number>;
		  }>
		| undefined,
	preferPrevious: boolean,
): number {
	const lineIndex = markdownLineIndexAtOffset(lineStarts, offset);
	const exactLineStart = lineStarts[lineIndex] === offset;
	const candidateLines =
		preferPrevious && exactLineStart
			? Array.from({ length: lineIndex + 1 }, (_, index) => lineIndex - index)
			: [lineIndex];
	for (const candidateLine of candidateLines) {
		const blockIndex = cached
			? cachedEditableBlockIndexForLine(
					cached.editableBlockRanges,
					candidateLine,
				)
			: editMap.blocks.findIndex(
					(block) =>
						block.editable &&
						block.startLine <= candidateLine &&
						candidateLine < block.endLine,
				);
		if (blockIndex >= 0) return blockIndex;
	}
	throw new PreviewWindowDomError("preview-window-selection-block-unavailable");
}

function markdownLineIndexAtOffset(
	lineStarts: ReadonlyArray<number>,
	offset: number,
): number {
	let low = 0;
	let high = lineStarts.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const lineStart = lineStarts[middle];
		if (undefined !== lineStart && lineStart <= offset) low = middle + 1;
		else high = middle;
	}
	return Math.max(0, low - 1);
}

function cachedEditableBlockIndexForLine(
	ranges: ReadonlyArray<AcceptedEditableBlockRange>,
	lineIndex: number,
): number {
	let low = 0;
	let high = ranges.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const range = ranges[middle];
		if (range && range.startLine <= lineIndex) low = middle + 1;
		else high = middle;
	}
	const range = ranges[low - 1];
	return range && lineIndex < range.endLine ? range.index : -1;
}

export function acceptedGeneratedPreviewFromCandidate(
	candidate: PreviewEnhancementCandidate,
	sourceRevision: number,
): AcceptedGeneratedPreview | null {
	const lineStarts = markdownLineStarts(candidate.markdown);
	const blockRanges = new Map<
		string,
		{
			end: number;
			index: number;
			start: number;
		}
	>();
	for (const [index, block] of (candidate.editMap?.blocks ?? []).entries()) {
		const start = lineStarts[block.startLine];
		const end =
			block.endLine === lineStarts.length
				? candidate.markdown.length
				: lineStarts[block.endLine];
		if (undefined === start || undefined === end || blockRanges.has(block.id)) {
			return null;
		}
		blockRanges.set(block.id, { end, index, start });
	}
	const editableBlockRanges = (candidate.editMap?.blocks ?? [])
		.map((block, index) => ({
			endLine: block.endLine,
			index,
			startLine: block.startLine,
		}))
		.filter((range, index) => {
			const block = candidate.editMap?.blocks[index];
			return Boolean(block?.editable && range.startLine < range.endLine);
		});
	return {
		blockRanges,
		editableBlockRanges,
		editMap: candidate.editMap,
		generation: candidate.generation,
		lineStarts,
		markdown: candidate.markdown,
		requestRevision: candidate.requestRevision,
		signature: candidate.signature,
		sourceRevision,
	};
}

export function capturePreviewImageElements(
	surface: HTMLElement,
	editMap: PreviewEditMap | null,
	generation: number,
): StagedPreviewImageElements {
	const byBlock = new Map<string, ReadonlyArray<HTMLImageElement>>();
	if (editMap) {
		editMap.blocks.forEach((block, index) => {
			const root = surface.children[index];
			if (!(root instanceof HTMLElement)) return;
			const images =
				root instanceof HTMLImageElement
					? [root]
					: Array.from(root.querySelectorAll<HTMLImageElement>("img"));
			byBlock.set(
				block.id,
				images.filter(
					(image) => image.closest("[data-easymde-visual-block-id]") === root,
				),
			);
		});
	}
	return { byBlock, generation };
}

type SourceLine = Readonly<{
	contentEnd: number;
	end: number;
}>;

function sourceLine(source: string, from: number, limit: number): SourceLine {
	let contentEnd = from;
	while (
		contentEnd < limit &&
		source[contentEnd] !== "\r" &&
		source[contentEnd] !== "\n"
	)
		contentEnd += 1;
	let end = contentEnd;
	if (end < limit && "\r" === source[end]) {
		end += 1;
		if (end < limit && "\n" === source[end]) end += 1;
	} else if (end < limit && "\n" === source[end]) {
		end += 1;
	}
	return { contentEnd, end };
}

export function mermaidOriginalForCodeBlock(
	source: string,
	block: EditorMarkdownSourceBlock,
): GeneratedContentOriginal | null {
	if (
		"code" !== block.kind ||
		block.from < 0 ||
		block.to <= block.from ||
		block.to > source.length
	)
		return null;
	const opening = sourceLine(source, block.from, block.to);
	const openingText = source.slice(block.from, opening.contentEnd);
	const openingMatch = openingText.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/u);
	if (!openingMatch || opening.end <= opening.contentEnd) return null;
	const info = openingMatch[2]
		?.trim()
		.split(/[ \t]+/u)[0]
		?.toLowerCase();
	if ("mermaid" !== info) return null;
	const fence = openingMatch[1];
	if (!fence) return null;
	const bodyFrom = opening.end;
	let cursor = bodyFrom;
	while (cursor < block.to) {
		const line = sourceLine(source, cursor, block.to);
		const lineText = source.slice(cursor, line.contentEnd);
		const closingMatch = lineText.match(/^ {0,3}(`+|~+)[ \t]*$/u);
		const closingFence = closingMatch?.[1];
		if (
			closingFence &&
			closingFence[0] === fence[0] &&
			closingFence.length >= fence.length
		) {
			if (source.slice(line.end, block.to).trim()) return null;
			return {
				body: source.slice(bodyFrom, cursor),
				bodyRange: { from: bodyFrom, to: cursor },
				full: source.slice(block.from, block.to),
				fullRange: { from: block.from, to: block.to },
			};
		}
		if (line.end <= cursor) break;
		cursor = line.end;
	}
	return null;
}

export function generatedTargetMatchesSourceSelection(
	target: GeneratedContentTarget,
	selection: PreviewSourceSelection,
): boolean {
	return sourceSelectionMatchesGeneratedRanges(
		selection,
		target.original.fullRange,
		target.original.bodyRange,
	);
}

export function sourceSelectionMatchesGeneratedRanges(
	selection: PreviewSourceSelection,
	fullRange: Readonly<{ from: number; to: number }>,
	bodyRange: Readonly<{ from: number; to: number }>,
): boolean {
	if (
		!Number.isSafeInteger(selection.start) ||
		!Number.isSafeInteger(selection.end) ||
		selection.start < 0 ||
		selection.end < selection.start
	)
		return false;
	return (
		selection.start >= fullRange.from &&
		selection.end <= fullRange.to &&
		selection.end >= bodyRange.from &&
		selection.start <= bodyRange.to
	);
}

export function lowerBoundByFrom<T extends Readonly<{ from: number }>>(
	items: ReadonlyArray<T>,
	from: number,
): number {
	let low = 0;
	let high = items.length;
	while (low < high) {
		const middle = low + Math.floor((high - low) / 2);
		const item = items[middle];
		if (item && item.from < from) low = middle + 1;
		else high = middle;
	}
	return low;
}
