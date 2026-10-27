import type { EditorMarkdownLinkCandidate } from "../../contracts/ports/editor-block-index-port";
import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";

export type EditorSourceLinkSelection = Readonly<{
	end: number;
	start: number;
}>;

export type EditorSourceLinkCandidate = EditorMarkdownLinkCandidate &
	Readonly<{ source: string }>;

export type EditorSourceLinkUnavailableCode =
	| "editor-source-link-block-index-stale"
	| "editor-source-link-block-index-unavailable"
	| "editor-source-link-index-incomplete"
	| "editor-source-link-selection-invalid";

export type EditorSourceLinkResolution =
	| Readonly<{ status: "candidate"; candidate: EditorSourceLinkCandidate }>
	| Readonly<{ status: "none" }>
	| Readonly<{
			code: EditorSourceLinkUnavailableCode;
			status: "unavailable";
	  }>;

export type FindEditorSourceLinkInput = Readonly<{
	blockIndex?: EditorMarkdownBlockIndex | null | undefined;
	selection: EditorSourceLinkSelection;
	source: string;
}>;

function selectionIsValid(
	selection: EditorSourceLinkSelection,
	source: string,
): boolean {
	return (
		Number.isSafeInteger(selection.start) &&
		Number.isSafeInteger(selection.end) &&
		selection.start >= 0 &&
		selection.end >= selection.start &&
		selection.end <= source.length
	);
}

function containsSelection(
	candidate: Readonly<{ from: number; to: number }>,
	selection: EditorSourceLinkSelection,
): boolean {
	if (selection.start === selection.end) {
		return selection.start > candidate.from && selection.start < candidate.to;
	}
	return candidate.from <= selection.start && selection.end <= candidate.to;
}

/**
 * Range query over the prepared candidate ranges. The block index owns the
 * exact syntax, so this stays a bounded binary search instead of reparsing or
 * re-lexing Markdown on the menu path.
 */
function candidateContainingSelection(
	candidates: ReadonlyArray<EditorMarkdownLinkCandidate>,
	selection: EditorSourceLinkSelection,
): EditorMarkdownLinkCandidate | null {
	let low = 0;
	let high = candidates.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const candidate = candidates[middle];
		if (!candidate) return null;
		if (candidate.to <= selection.start) {
			low = middle + 1;
			continue;
		}
		if (candidate.from > selection.start) {
			high = middle - 1;
			continue;
		}
		return containsSelection(candidate, selection) ? candidate : null;
	}
	return null;
}

export function findEditorSourceLink({
	blockIndex,
	selection,
	source,
}: FindEditorSourceLinkInput): EditorSourceLinkResolution {
	if (!selectionIsValid(selection, source)) {
		return {
			code: "editor-source-link-selection-invalid",
			status: "unavailable",
		};
	}
	if (!blockIndex) {
		return {
			code: "editor-source-link-block-index-unavailable",
			status: "unavailable",
		};
	}
	if (blockIndex.source !== source || blockIndex.length !== source.length) {
		return {
			code: "editor-source-link-block-index-stale",
			status: "unavailable",
		};
	}
	const candidates = blockIndex.linkCandidates;
	if (!candidates) {
		// Fail fast instead of re-deriving link syntax on the menu path. Every
		// current producer prepares candidates; only incomplete fixtures do not.
		return {
			code: "editor-source-link-index-incomplete",
			status: "unavailable",
		};
	}
	const candidate = candidateContainingSelection(candidates, selection);
	if (!candidate) return { status: "none" };
	return {
		candidate: {
			...candidate,
			source: source.slice(candidate.from, candidate.to),
		},
		status: "candidate",
	};
}
