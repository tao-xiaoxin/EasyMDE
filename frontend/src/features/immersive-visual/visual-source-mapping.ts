import type { Node as ProseMirrorNode } from "prosemirror-model";
import { NodeSelection, Selection, TextSelection } from "prosemirror-state";
import type {
	VisualCanonicalChangeRequest,
	VisualEditorSelection,
	VisualEditorSelectionDirection,
	VisualEditorSourceRange,
} from "../../contracts/visual-editor";
import { serializeVisualDocToMarkdown } from "./markdown-serializer";
import { visualEditorSchema } from "./visual-schema";

export type TopLevelBlockSourceSpan = Readonly<{
	index: number;
	mdEnd: number;
	mdStart: number;
	node: ProseMirrorNode;
	pmEnd: number;
	pmPos: number;
}>;

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

const HORIZONTAL_RULE_LINE_PATTERN = /^[ \t]*(?:---+|\*\*\*+|___+)[ \t]*$/gm;
const MARKDOWN_IMAGE_SYNTAX_PATTERN = /!\[(?:\\\]|[^\]])*\]\((?:\\.|[^)])*\)/g;
const LEADING_BLOCK_SYNTAX_PATTERN =
	/^(?:[ \t]*>[ \t]?|[ \t]*#{1,6}[ \t]+|[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|[ \t]*\|[ \t]*)/;

function clampNumber(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function serializeSingleBlock(node: ProseMirrorNode): string {
	if (node.type.name === "protected_block") {
		return typeof node.attrs.rawMarkdown === "string" ? node.attrs.rawMarkdown : "";
	}
	if (node.type.name === "paragraph" && node.childCount === 0) return "";
	return serializeVisualDocToMarkdown(visualEditorSchema.nodes.doc.create(null, [node]));
}

function findBlockEndFromAnchor(
	markdown: string,
	startPos: number,
	node: ProseMirrorNode,
): number {
	if (node.type.name === "code_block") {
		const firstLineEnd = markdown.indexOf("\n", startPos);
		if (firstLineEnd >= 0) {
			const afterBody = Math.min(markdown.length, firstLineEnd + 1 + node.textContent.length);
			const closeStart = markdown.indexOf("\n", afterBody);
			if (closeStart >= 0) {
				const closeEnd = markdown.indexOf("\n", closeStart + 1);
				return closeEnd >= 0 ? closeEnd : markdown.length;
			}
		}
		return markdown.length;
	}
	const nextBlank = markdown.indexOf("\n\n", startPos);
	return nextBlank >= 0 ? nextBlank : markdown.length;
}

function findTopLevelBlockSpan(
	markdown: string,
	node: ProseMirrorNode,
	serialized: string,
	searchFrom: number,
): VisualEditorSourceRange {
	const safeFrom = clampNumber(searchFrom, 0, markdown.length);
	if (serialized.length > 0) {
		const exactIndex = markdown.indexOf(serialized, safeFrom);
		if (exactIndex >= 0) {
			return { start: exactIndex, end: exactIndex + serialized.length };
		}
	}

	if (node.type.name === "horizontal_rule") {
		HORIZONTAL_RULE_LINE_PATTERN.lastIndex = safeFrom;
		const hrMatch = HORIZONTAL_RULE_LINE_PATTERN.exec(markdown);
		if (hrMatch) {
			return { start: hrMatch.index, end: hrMatch.index + hrMatch[0].length };
		}
	}

	const textAnchor = node.textContent.trim().slice(0, 32);
	if (textAnchor.length > 0) {
		const anchorIdx = markdown.indexOf(textAnchor, safeFrom);
		if (anchorIdx >= 0) {
			let lineStart = anchorIdx;
			while (
				lineStart > safeFrom &&
				markdown[lineStart - 1] !== "\n" &&
				markdown[lineStart - 1] !== "\r"
			) {
				lineStart -= 1;
			}
			const blockEnd = findBlockEndFromAnchor(markdown, lineStart, node);
			return { start: lineStart, end: Math.max(anchorIdx + textAnchor.length, blockEnd) };
		}
	}

	let fallbackStart = safeFrom;
	while (fallbackStart < markdown.length && /[\s\r\n]/.test(markdown[fallbackStart] ?? "")) {
		fallbackStart += 1;
	}
	if (fallbackStart >= markdown.length) {
		return { start: markdown.length, end: markdown.length };
	}
	return { start: fallbackStart, end: findBlockEndFromAnchor(markdown, fallbackStart, node) };
}

export function buildTopLevelBlockSourceMap(
	doc: ProseMirrorNode,
	markdown: string,
): ReadonlyArray<TopLevelBlockSourceSpan> {
	const entries: TopLevelBlockSourceSpan[] = [];
	let pmPos = 0;
	let searchCursor = 0;

	for (let i = 0; i < doc.childCount; i += 1) {
		const child = doc.child(i);
		const pmEnd = pmPos + child.nodeSize;
		const range = findTopLevelBlockSpan(markdown, child, serializeSingleBlock(child), searchCursor);
		entries.push({
			index: i,
			mdEnd: range.end,
			mdStart: range.start,
			node: child,
			pmEnd,
			pmPos,
		});
		searchCursor = Math.max(searchCursor, range.end);
		pmPos = pmEnd;
	}
	return entries;
}

function findBlockEntryForPmPos(
	blocks: ReadonlyArray<TopLevelBlockSourceSpan>,
	pmPos: number,
): TopLevelBlockSourceSpan | null {
	for (const entry of blocks) {
		if (pmPos >= entry.pmPos && pmPos <= entry.pmEnd) return entry;
	}
	return blocks.length === 0
		? null
		: pmPos <= 0
			? (blocks[0] ?? null)
			: (blocks[blocks.length - 1] ?? null);
}

function findBlockEntryForMdOffset(
	blocks: ReadonlyArray<TopLevelBlockSourceSpan>,
	mdOffset: number,
): TopLevelBlockSourceSpan | null {
	let preceding: TopLevelBlockSourceSpan | null = null;
	for (const entry of blocks) {
		if (mdOffset >= entry.mdStart && mdOffset <= entry.mdEnd) return entry;
		if (entry.mdEnd < mdOffset) {
			preceding = entry;
		} else if (entry.mdStart > mdOffset) {
			return preceding ?? entry;
		}
	}
	return preceding ?? blocks[blocks.length - 1] ?? null;
}

function advanceThroughSourceForText(sourceSlice: string, plainText: string): number {
	if (plainText.length === 0) {
		const leadingMatch = LEADING_BLOCK_SYNTAX_PATTERN.exec(sourceSlice);
		return leadingMatch ? leadingMatch[0].length : 0;
	}
	let srcCursor = 0;
	for (let i = 0; i < plainText.length; i += 1) {
		const ch = plainText[i];
		if (ch === undefined || ch === "\uFFFC") continue;
		if (ch === "\n") {
			const nlIdx = sourceSlice.indexOf("\n", srcCursor);
			if (nlIdx >= 0) srcCursor = nlIdx + 1;
			continue;
		}
		const foundIdx = sourceSlice.indexOf(ch, srcCursor);
		if (foundIdx >= 0) srcCursor = foundIdx + 1;
	}
	return srcCursor;
}

function mapCodeBlockPmPosToMdOffset(
	entry: TopLevelBlockSourceSpan,
	markdown: string,
	pmPos: number,
): number {
	const slice = markdown.slice(entry.mdStart, entry.mdEnd);
	const firstNewline = slice.indexOf("\n");
	if (firstNewline < 0) {
		return clampNumber(entry.mdStart + Math.max(0, pmPos - entry.pmPos - 1), entry.mdStart, entry.mdEnd);
	}
	const bodyStart = entry.mdStart + firstNewline + 1;
	const codeOffset = clampNumber(pmPos - (entry.pmPos + 1), 0, entry.node.textContent.length);
	return clampNumber(bodyStart + codeOffset, entry.mdStart, entry.mdEnd);
}

function mapInlineAtomRangeInBlock(
	entry: TopLevelBlockSourceSpan,
	targetNode: ProseMirrorNode,
	targetPos: number,
	markdown: string,
): VisualEditorSourceRange {
	const slice = markdown.slice(entry.mdStart, entry.mdEnd);

	if (targetNode.type.name === "protected_inline") {
		const raw = typeof targetNode.attrs.rawMarkdown === "string" ? targetNode.attrs.rawMarkdown : "";
		if (raw.length > 0) {
			let ordinal = 0;
			entry.node.descendants((child, relPos) => {
				if (
					entry.pmPos + 1 + relPos < targetPos &&
					child.type.name === "protected_inline" &&
					child.attrs.rawMarkdown === raw
				) {
					ordinal += 1;
				}
			});
			let searchFrom = 0;
			let matchIdx = -1;
			for (let seen = 0; seen <= ordinal; seen += 1) {
				matchIdx = slice.indexOf(raw, searchFrom);
				if (matchIdx < 0) break;
				searchFrom = matchIdx + raw.length;
			}
			if (matchIdx >= 0) {
				return { start: entry.mdStart + matchIdx, end: entry.mdStart + matchIdx + raw.length };
			}
		}
	}

	if (targetNode.type.name === "image") {
		let imageOrdinal = 0;
		entry.node.descendants((child, relPos) => {
			if (entry.pmPos + 1 + relPos < targetPos && child.type.name === "image") {
				imageOrdinal += 1;
			}
		});
		MARKDOWN_IMAGE_SYNTAX_PATTERN.lastIndex = 0;
		let seen = 0;
		let match = MARKDOWN_IMAGE_SYNTAX_PATTERN.exec(slice);
		while (match !== null) {
			if (seen === imageOrdinal) {
				return { start: entry.mdStart + match.index, end: entry.mdStart + match.index + match[0].length };
			}
			seen += 1;
			match = MARKDOWN_IMAGE_SYNTAX_PATTERN.exec(slice);
		}
	}

	return { start: entry.mdStart, end: entry.mdEnd };
}

function mapPmPosToMdOffset(
	doc: ProseMirrorNode,
	blocks: ReadonlyArray<TopLevelBlockSourceSpan>,
	markdown: string,
	pmPos: number,
): number {
	const clampedPos = clampNumber(pmPos, 0, doc.content.size);
	const entry = findBlockEntryForPmPos(blocks, clampedPos);
	if (!entry) return 0;
	if (entry.node.type.name === "protected_block" || entry.node.type.name === "horizontal_rule") {
		return clampedPos <= entry.pmPos ? entry.mdStart : entry.mdEnd;
	}
	if (entry.node.type.name === "code_block") {
		return mapCodeBlockPmPosToMdOffset(entry, markdown, clampedPos);
	}
	const slice = markdown.slice(entry.mdStart, entry.mdEnd);
	const textBefore = doc.textBetween(entry.pmPos, clampedPos, "\n", "\uFFFC");
	const relativeOffset = advanceThroughSourceForText(slice, textBefore);
	return clampNumber(entry.mdStart + relativeOffset, entry.mdStart, entry.mdEnd);
}

export function computeVisualSelectionToMarkdownSelection(
	doc: ProseMirrorNode,
	selection: Selection,
	markdown: string,
): VisualEditorSelection {
	if (markdown.length === 0) {
		return { direction: "none", end: 0, start: 0 };
	}
	const blocks = buildTopLevelBlockSourceMap(doc, markdown);

	if (selection instanceof NodeSelection) {
		const entry = findBlockEntryForPmPos(blocks, selection.from);
		if (!entry) return { direction: "none", end: 0, start: 0 };
		if (selection.node.type.name === "image" || selection.node.type.name === "protected_inline") {
			const range = mapInlineAtomRangeInBlock(entry, selection.node, selection.from, markdown);
			return { direction: "none", end: range.end, start: range.start };
		}
		return { direction: "none", end: entry.mdEnd, start: entry.mdStart };
	}

	const fromOffset = mapPmPosToMdOffset(doc, blocks, markdown, selection.from);
	if (selection.empty) {
		return { direction: "none", end: fromOffset, start: fromOffset };
	}
	const toOffset = mapPmPosToMdOffset(doc, blocks, markdown, selection.to);
	const start = Math.min(fromOffset, toOffset);
	const end = Math.max(fromOffset, toOffset);
	const direction: VisualEditorSelectionDirection =
		start === end ? "none" : selection.anchor > selection.head ? "backward" : "forward";
	return { direction, end, start };
}

function mapMdOffsetToPmPosInBlock(
	entry: TopLevelBlockSourceSpan,
	markdown: string,
	mdOffset: number,
): number {
	const boundedOffset = clampNumber(mdOffset, entry.mdStart, entry.mdEnd);
	if (entry.node.type.name === "protected_block" || entry.node.type.name === "horizontal_rule") {
		return entry.pmPos;
	}
	const slice = markdown.slice(entry.mdStart, entry.mdEnd);
	const targetRelOffset = boundedOffset - entry.mdStart;

	if (entry.node.type.name === "code_block") {
		const firstNewline = slice.indexOf("\n");
		const bodyRelStart = firstNewline >= 0 ? firstNewline + 1 : 0;
		const codeRel = clampNumber(targetRelOffset - bodyRelStart, 0, entry.node.textContent.length);
		return entry.pmPos + 1 + codeRel;
	}

	let srcCursor = 0;
	let resolvedPos: number | null = null;
	let lastTextPos = entry.pmPos + 1;

	entry.node.descendants((child, relPos) => {
		if (resolvedPos !== null) return false;
		const absPos = entry.pmPos + 1 + relPos;
		if (child.isTextblock) lastTextPos = absPos + 1 + child.content.size;
		if (child.isText && child.text) {
			for (let i = 0; i < child.text.length; i += 1) {
				const ch = child.text[i];
				if (ch === undefined) break;
				const found = slice.indexOf(ch, srcCursor);
				if (found >= 0) {
					if (targetRelOffset <= found) {
						resolvedPos = absPos + i;
						return false;
					}
					srcCursor = found + 1;
				}
				if (targetRelOffset <= srcCursor) {
					resolvedPos = absPos + i + 1;
					return false;
				}
			}
			lastTextPos = absPos + child.text.length;
		}
		return true;
	});

	return resolvedPos !== null ? resolvedPos : lastTextPos;
}

export function resolveMarkdownSelectionToVisualSelection(
	doc: ProseMirrorNode,
	markdown: string,
	targetSelection: VisualEditorSelection,
): Selection {
	if (doc.content.size === 0) return Selection.atStart(doc);
	const blocks = buildTopLevelBlockSourceMap(doc, markdown);
	if (blocks.length === 0) return Selection.atStart(doc);

	const rawStart = clampNumber(targetSelection.start, 0, markdown.length);
	const rawEnd = clampNumber(targetSelection.end, 0, markdown.length);
	const start = Math.min(rawStart, rawEnd);
	const end = Math.max(rawStart, rawEnd);

	const startEntry = findBlockEntryForMdOffset(blocks, start);
	const endEntry = findBlockEntryForMdOffset(blocks, end);
	if (!startEntry || !endEntry) return Selection.atStart(doc);

	if (
		startEntry === endEntry &&
		(startEntry.node.type.name === "protected_block" ||
			startEntry.node.type.name === "horizontal_rule")
	) {
		try {
			return NodeSelection.create(doc, startEntry.pmPos);
		} catch {
			return Selection.near(doc.resolve(clampNumber(startEntry.pmPos, 0, doc.content.size)));
		}
	}

	const fromPos = clampNumber(mapMdOffsetToPmPosInBlock(startEntry, markdown, start), 0, doc.content.size);
	const toPos = clampNumber(mapMdOffsetToPmPosInBlock(endEntry, markdown, end), 0, doc.content.size);
	const $from = doc.resolve(fromPos);
	const $to = doc.resolve(toPos);

	if (start === end) return Selection.near($from, 1);
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
	if (!Number.isSafeInteger(expected.revision) || expected.revision !== currentRevision) {
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
	if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > currentValue.length) {
		return { code: "canonical-change-range-invalid", ok: false };
	}
	if (currentValue.slice(0, from) + insert + currentValue.slice(to) !== change.value) {
		return { code: "canonical-change-value-result-mismatch", ok: false };
	}
	const { end: nextEnd, start: nextStart } = change.selection;
	if (!Number.isSafeInteger(nextStart) || !Number.isSafeInteger(nextEnd) || nextStart < 0 || nextEnd < nextStart || nextEnd > change.value.length) {
		return { code: "canonical-change-selection-invalid", ok: false };
	}
	return { ok: true };
}
