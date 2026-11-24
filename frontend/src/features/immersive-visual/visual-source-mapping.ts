import type { Node as ProseMirrorNode } from "prosemirror-model";
import { NodeSelection, Selection, TextSelection } from "prosemirror-state";
import type {
	VisualCanonicalChangeRequest,
	VisualEditorSelection,
	VisualEditorSelectionDirection,
} from "../../contracts/visual-editor";
import {
	ATOM_BLOCK_NAMES,
	getCachedVisualSourceIndex,
	type VisualSourceBlock,
	type VisualSourceIndex,
	type VisualSourceSegment,
	type VisualSourceUnit,
} from "./visual-source-index";

export type CanonicalChangePreconditionFailureCode =
	| "canonical-change-range-invalid"
	| "canonical-change-revision-mismatch"
	| "canonical-change-selection-invalid"
	| "canonical-change-selection-mismatch"
	| "canonical-change-value-mismatch"
	| "canonical-change-value-result-mismatch";

export type CanonicalChangePreconditionResult =
	| Readonly<{ ok: true }>
	| Readonly<{ code: CanonicalChangePreconditionFailureCode; ok: false }>;

const NODE_SELECTABLE_ATOMS: ReadonlySet<string> = new Set([
	"horizontal_rule",
	"image",
	"protected_block",
	"protected_inline",
]);

function upperBound(values: ReadonlyArray<number>, target: number): number {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if ((values[mid] ?? 0) <= target) low = mid + 1;
		else high = mid;
	}
	return low;
}

// Exact index lookups (pm position <-> LF-normalized Markdown offset).

export type PmToMarkdownBias = "after-prev" | "before-next";

function findBlockForPmPos(
	index: VisualSourceIndex,
	pos: number,
): VisualSourceBlock | null {
	const { blocks } = index;
	if (blocks.length === 0) return null;
	let low = 0;
	let high = blocks.length - 1;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if ((blocks[mid] as VisualSourceBlock).pmEnd <= pos) low = mid + 1;
		else high = mid;
	}
	return blocks[low] ?? null;
}

function findBlockForMdOffset(
	index: VisualSourceIndex,
	offset: number,
): VisualSourceBlock | null {
	const { blocks } = index;
	if (blocks.length === 0) return null;
	const starts = blocks.map((block) => block.mdStart);
	const candidate = Math.max(0, upperBound(starts, offset) - 1);
	const block = blocks[candidate] as VisualSourceBlock;
	if (offset <= block.mdEnd || candidate === blocks.length - 1) return block;
	return blocks[candidate + 1] ?? block;
}

function unitIndexAtPm(
	units: ReadonlyArray<VisualSourceUnit>,
	pos: number,
): number {
	let low = 0;
	let high = units.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if ((units[mid] as VisualSourceUnit).pmPos < pos) low = mid + 1;
		else high = mid;
	}
	return low;
}

/** Maps a ProseMirror position to an LF-normalized Markdown offset. */
export function mapPmPosToMarkdown(
	index: VisualSourceIndex,
	pos: number,
	bias: PmToMarkdownBias,
): number {
	const block = findBlockForPmPos(index, pos);
	if (!block) return 0;
	if (
		bias === "after-prev" &&
		pos > 0 &&
		block.pmPos === pos &&
		block.index > 0
	) {
		// Exact inter-block boundary: stay at the end of the preceding block.
		const prevBlock = index.blocks[block.index - 1];
		if (prevBlock && prevBlock.pmEnd === pos) return prevBlock.mdEnd;
	}
	if (pos <= block.pmPos) return block.mdStart;
	if (pos >= block.pmEnd) return block.mdEnd;
	const segments = index.segmentsFor(block);
	let previous: VisualSourceSegment | null = null;
	for (const segment of segments) {
		if (segment.kind === "atom") {
			if (pos <= segment.pmPos)
				return bias === "before-next" || !previous
					? segment.mdStart
					: segmentEnd(previous);
			if (pos < segment.pmEnd) return segment.mdStart;
			previous = segment;
			continue;
		}
		if (pos < segment.contentStart) {
			return bias === "before-next" || !previous
				? segment.emptyMd
				: segmentEnd(previous);
		}
		if (pos <= segment.contentEnd) {
			const units = segment.units;
			const at = unitIndexAtPm(units, pos);
			const next = units[at];
			const prev = units[at - 1];
			if (bias === "before-next" && next && next.pmPos === pos)
				return next.mdStart;
			if (prev && prev.pmPos + prev.pmSize <= pos) return prev.mdEnd;
			return next && next.pmPos === pos ? next.mdStart : segment.emptyMd;
		}
		previous = segment;
	}
	return previous ? segmentEnd(previous) : block.mdStart;
}

function segmentEnd(segment: VisualSourceSegment): number {
	if (segment.kind === "atom") return segment.mdEnd;
	const last = segment.units[segment.units.length - 1];
	return last ? last.mdEnd : segment.emptyMd;
}

type MarkdownToPmResult = Readonly<{
	atomPos: number | null;
	pos: number;
}>;

/** Maps an LF-normalized Markdown offset to a ProseMirror position. */
function mapMarkdownToPm(
	index: VisualSourceIndex,
	offset: number,
): MarkdownToPmResult {
	const block = findBlockForMdOffset(index, offset);
	if (!block) return { atomPos: null, pos: 0 };
	const segments = index.segmentsFor(block);
	if (segments.length === 0) return { atomPos: null, pos: block.pmPos };
	let chosen: VisualSourceSegment | null = null;
	for (const segment of segments) {
		if (offset < segment.mdStart) {
			chosen = chosen ?? segment;
			break;
		}
		chosen = segment;
		if (offset <= segment.mdEnd) break;
	}
	const segment = chosen as VisualSourceSegment;
	if (segment.kind === "atom") {
		const inside = offset > segment.mdStart && offset < segment.mdEnd;
		if (offset <= segment.mdStart || inside) {
			return {
				atomPos: inside || offset === segment.mdStart ? segment.pmPos : null,
				pos: segment.pmPos,
			};
		}
		return { atomPos: null, pos: segment.pmEnd };
	}
	const units = segment.units;
	const first = units[0];
	if (!first || offset <= first.mdStart)
		return { atomPos: null, pos: segment.contentStart };
	let low = 0;
	let high = units.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if ((units[mid] as VisualSourceUnit).mdStart < offset) low = mid + 1;
		else high = mid;
	}
	const unit = units[low - 1] as VisualSourceUnit;
	if (unit.atom && offset < unit.mdEnd)
		return { atomPos: unit.pmPos, pos: unit.pmPos };
	return {
		atomPos: null,
		pos: Math.min(unit.pmPos + unit.pmSize, segment.contentEnd),
	};
}

/** Exact Markdown source range of the atom node starting at `pmPos`. */
export function findAtomSourceRange(
	index: VisualSourceIndex,
	pmPos: number,
): Readonly<{ end: number; start: number }> | null {
	// Top-level block atoms have nodeSize 1 (`pmEnd === pmPos + 1`), so the
	// lookup must use `pmPos` itself; `pmPos + 1` would skip to the next block.
	const block = findBlockForPmPos(index, pmPos);
	if (!block) return null;
	if (block.pmPos === pmPos) return { end: block.mdEnd, start: block.mdStart };
	for (const segment of index.segmentsFor(block)) {
		if (segment.kind === "atom") {
			if (segment.pmPos === pmPos)
				return { end: segment.mdEnd, start: segment.mdStart };
			continue;
		}
		if (pmPos < segment.contentStart || pmPos > segment.contentEnd) continue;
		const unit = segment.units[unitIndexAtPm(segment.units, pmPos)];
		if (unit && unit.pmPos === pmPos && unit.atom)
			return { end: unit.mdEnd, start: unit.mdStart };
	}
	return null;
}

/** ProseMirror position of a selectable atom whose source is exactly `[start, end]`. */
function findAtomByMarkdownRange(
	index: VisualSourceIndex,
	start: number,
	end: number,
): number | null {
	const block = findBlockForMdOffset(index, start);
	if (!block) return null;
	if (ATOM_BLOCK_NAMES.has(block.node.type.name)) {
		return start >= block.mdStart && end <= block.mdEnd && end > start
			? block.pmPos
			: null;
	}
	for (const segment of index.segmentsFor(block)) {
		if (segment.kind === "atom") {
			if (segment.mdStart === start && segment.mdEnd === end)
				return segment.pmPos;
			continue;
		}
		if (end < segment.mdStart || start > segment.mdEnd) continue;
		for (const unit of segment.units) {
			if (
				unit.atom &&
				unit.atom.type.name !== "hard_break" &&
				unit.mdStart === start &&
				unit.mdEnd === end
			) {
				return unit.pmPos;
			}
		}
	}
	return null;
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function resolveIndex(
	doc: ProseMirrorNode,
	markdown: string,
	index: VisualSourceIndex | undefined,
): VisualSourceIndex {
	return index && index.doc === doc && index.markdown === markdown
		? index
		: getCachedVisualSourceIndex(doc, markdown);
}

/**
 * Maps a ProseMirror selection to the canonical Markdown selection using the
 * exact parser-backed source index for `(doc, markdown)`. Offsets returned are
 * UTF-16 offsets into the original (possibly CRLF) canonical bytes.
 */
export function computeVisualSelectionToMarkdownSelection(
	doc: ProseMirrorNode,
	selection: Selection,
	markdown: string,
	index?: VisualSourceIndex,
): VisualEditorSelection {
	if (markdown.length === 0) {
		return { direction: "none", end: 0, start: 0 };
	}
	const sourceIndex = resolveIndex(doc, markdown, index);
	const toOriginal = sourceIndex.toOriginal;

	if (selection instanceof NodeSelection) {
		const range = findAtomSourceRange(sourceIndex, selection.from);
		if (range) {
			return {
				direction: "none",
				end: toOriginal(range.end),
				start: toOriginal(range.start),
			};
		}
		const start = mapPmPosToMarkdown(
			sourceIndex,
			selection.from,
			"before-next",
		);
		const end = mapPmPosToMarkdown(sourceIndex, selection.to, "after-prev");
		return {
			direction: "none",
			end: toOriginal(Math.max(start, end)),
			start: toOriginal(Math.min(start, end)),
		};
	}

	if (selection.empty) {
		const offset = toOriginal(
			mapPmPosToMarkdown(sourceIndex, selection.head, "after-prev"),
		);
		return { direction: "none", end: offset, start: offset };
	}
	const fromOffset = mapPmPosToMarkdown(
		sourceIndex,
		selection.from,
		"before-next",
	);
	const toOffset = mapPmPosToMarkdown(sourceIndex, selection.to, "after-prev");
	const start = Math.min(fromOffset, toOffset);
	const end = Math.max(fromOffset, toOffset);
	const direction: VisualEditorSelectionDirection =
		start === end
			? "none"
			: selection.anchor > selection.head
				? "backward"
				: "forward";
	return { direction, end: toOriginal(end), start: toOriginal(start) };
}

function createNodeSelection(
	doc: ProseMirrorNode,
	pos: number,
): Selection | null {
	const node = doc.nodeAt(pos);
	if (!node || !NODE_SELECTABLE_ATOMS.has(node.type.name)) return null;
	try {
		return NodeSelection.create(doc, pos);
	} catch {
		return null;
	}
}

/**
 * Maps a canonical Markdown selection back to a ProseMirror selection,
 * restoring `NodeSelection` for images, protected atoms, and horizontal rules
 * whose exact source range is targeted, and preserving selection direction.
 */
export function resolveMarkdownSelectionToVisualSelection(
	doc: ProseMirrorNode,
	markdown: string,
	targetSelection: VisualEditorSelection,
	index?: VisualSourceIndex,
): Selection {
	if (doc.content.size === 0) return Selection.atStart(doc);
	const sourceIndex = resolveIndex(doc, markdown, index);
	if (sourceIndex.blocks.length === 0) return Selection.atStart(doc);

	const textLength = sourceIndex.text.length;
	const rawStart = clampNumber(
		sourceIndex.toNormalized(targetSelection.start),
		0,
		textLength,
	);
	const rawEnd = clampNumber(
		sourceIndex.toNormalized(targetSelection.end),
		0,
		textLength,
	);
	const start = Math.min(rawStart, rawEnd);
	const end = Math.max(rawStart, rawEnd);

	if (start !== end) {
		const atomPos = findAtomByMarkdownRange(sourceIndex, start, end);
		if (atomPos !== null) {
			const nodeSelection = createNodeSelection(doc, atomPos);
			if (nodeSelection) return nodeSelection;
		}
	}

	const startBlock = findBlockForMdOffset(sourceIndex, start);
	const endBlock = findBlockForMdOffset(sourceIndex, end);
	if (
		startBlock &&
		startBlock === endBlock &&
		(startBlock.node.type.name === "protected_block" ||
			startBlock.node.type.name === "horizontal_rule") &&
		start >= startBlock.mdStart &&
		end <= startBlock.mdEnd
	) {
		const nodeSelection = createNodeSelection(doc, startBlock.pmPos);
		if (nodeSelection) return nodeSelection;
	}

	const from = mapMarkdownToPm(sourceIndex, start);
	const to = start === end ? from : mapMarkdownToPm(sourceIndex, end);
	const fromPos = clampNumber(from.pos, 0, doc.content.size);
	const toPos = clampNumber(to.pos, 0, doc.content.size);
	const $from = doc.resolve(fromPos);
	if (start === end) return Selection.near($from, 1);
	const $to = doc.resolve(toPos);
	return targetSelection.direction === "backward"
		? TextSelection.between($to, $from)
		: TextSelection.between($from, $to);
}

export function assertCanonicalChangePrecondition(
	request: VisualCanonicalChangeRequest,
	currentRevision: number,
	currentValue: string,
	currentSelection: VisualEditorSelection,
): CanonicalChangePreconditionResult {
	const { change, expected } = request;
	if (
		!Number.isSafeInteger(expected.revision) ||
		expected.revision !== currentRevision
	) {
		return { code: "canonical-change-revision-mismatch", ok: false };
	}
	if (expected.value !== currentValue) {
		return { code: "canonical-change-value-mismatch", ok: false };
	}
	if (
		expected.selection.start !== currentSelection.start ||
		expected.selection.end !== currentSelection.end ||
		expected.selection.direction !== currentSelection.direction
	) {
		return { code: "canonical-change-selection-mismatch", ok: false };
	}
	const { from, insert, to } = change.changes;
	if (
		!Number.isSafeInteger(from) ||
		!Number.isSafeInteger(to) ||
		from < 0 ||
		to < from ||
		to > currentValue.length
	) {
		return { code: "canonical-change-range-invalid", ok: false };
	}
	if (
		currentValue.slice(0, from) + insert + currentValue.slice(to) !==
		change.value
	) {
		return { code: "canonical-change-value-result-mismatch", ok: false };
	}
	const { end: nextEnd, start: nextStart } = change.selection;
	if (
		!Number.isSafeInteger(nextStart) ||
		!Number.isSafeInteger(nextEnd) ||
		nextStart < 0 ||
		nextEnd < nextStart ||
		nextEnd > change.value.length
	) {
		return { code: "canonical-change-selection-invalid", ok: false };
	}
	return { ok: true };
}
