import type { Node as ProseMirrorNode } from "prosemirror-model";
import { nodesSemanticallyEqual } from "./markdown-node-alignment";
import {
	type ParsedVisualDocument,
	parseMarkdownWithBlockSources,
} from "./markdown-parser";
import { serializeVisualDocToMarkdown } from "./markdown-serializer";
import {
	buildBlockSegments,
	type VisualSourceBlock,
	type VisualSourceSegment,
} from "./visual-source-inner-maps";

export type {
	VisualSourceAtomSegment,
	VisualSourceBlock,
	VisualSourceSegment,
	VisualSourceTextSegment,
	VisualSourceUnit,
} from "./visual-source-inner-maps";
export {
	ATOM_BLOCK_NAMES,
	splitTableRowCells,
} from "./visual-source-inner-maps";

/**
 * Exact, parser-backed bidirectional index between a ProseMirror visual
 * document and the canonical Markdown bytes it was accepted against.
 *
 * Top-level block ranges come from `parseMarkdownWithBlockSources` raw ranges
 * (or are derived incrementally from the previous accepted index and the exact
 * bounded canonical change), never from per-keystroke re-serialization. Inner
 * position maps are built lazily per block and cached, so selection-only moves
 * perform zero serialization or reparsing. All offsets inside the index are
 * LF-normalized UTF-16 offsets; `toOriginal`/`toNormalized` convert CRLF.
 */

export type VisualSourceTextChange = Readonly<{
	from: number;
	insert: string;
	to: number;
}>;
export type VisualSourceIndex = Readonly<{
	blocks: ReadonlyArray<VisualSourceBlock>;
	doc: ProseMirrorNode;
	markdown: string;
	segmentsFor: (block: VisualSourceBlock) => ReadonlyArray<VisualSourceSegment>;
	text: string;
	toNormalized: (offset: number) => number;
	toOriginal: (offset: number) => number;
}>;

type Range = { end: number; start: number };

const indexCache = new WeakMap<ProseMirrorNode, VisualSourceIndex>();

function createNormalization(markdown: string): Readonly<{
	text: string;
	toNormalized: (offset: number) => number;
	toOriginal: (offset: number) => number;
}> {
	if (markdown.indexOf("\r") < 0) {
		const identity = (offset: number) => offset;
		return { text: markdown, toNormalized: identity, toOriginal: identity };
	}
	const removedOriginal: number[] = [];
	const removedNormalized: number[] = [];
	let text = "";
	for (let i = 0; i < markdown.length; i += 1) {
		const ch = markdown[i];
		if (ch === "\r") {
			if (markdown[i + 1] === "\n") {
				removedOriginal.push(i);
				removedNormalized.push(text.length);
				continue;
			}
			text += "\n";
			continue;
		}
		text += ch;
	}
	const before = (values: ReadonlyArray<number>, target: number): number => {
		let low = 0;
		let high = values.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if ((values[mid] ?? 0) < target) low = mid + 1;
			else high = mid;
		}
		return low;
	};
	return {
		text,
		toNormalized: (offset) => offset - before(removedOriginal, offset),
		toOriginal: (offset) => offset + before(removedNormalized, offset),
	};
}

function isEmptyParagraph(node: ProseMirrorNode): boolean {
	return node.type.name === "paragraph" && node.childCount === 0;
}

function rangesFromParsed(
	doc: ProseMirrorNode,
	text: string,
	parsed: ParsedVisualDocument,
): Range[] | null {
	if (parsed.blocks.length === 0) {
		return doc.childCount === 1 &&
			doc.firstChild &&
			isEmptyParagraph(doc.firstChild)
			? [{ end: text.length, start: text.length }]
			: null;
	}
	if (parsed.blocks.length !== doc.childCount) return null;
	const ranges: Range[] = [];
	let offset = parsed.leadingPrefix.length;
	for (let i = 0; i < parsed.blocks.length; i += 1) {
		const block = parsed.blocks[i];
		if (!block || block.raw === null) return null;
		if (block.node.type !== doc.child(i).type) return null;
		offset += block.separatorBefore.length;
		const start = offset;
		offset += block.raw.length;
		if (text.slice(start, offset) !== block.raw) return null;
		ranges.push({ end: offset, start });
	}
	return ranges;
}

function skipLineBreaks(text: string, from: number, max: number): number {
	let cursor = from;
	let count = 0;
	while (cursor < text.length && text[cursor] === "\n" && count < max) {
		cursor += 1;
		count += 1;
	}
	return cursor;
}

function rangesBySerialization(doc: ProseMirrorNode, text: string): Range[] {
	const ranges: Range[] = [];
	let cursor = 0;
	for (let i = 0; i < doc.childCount; i += 1) {
		const child = doc.child(i);
		const serialized =
			child.type.name === "protected_block"
				? String(child.attrs.rawMarkdown ?? "")
				: isEmptyParagraph(child)
					? ""
					: serializeVisualDocToMarkdown(doc.type.create(null, [child]));
		if (serialized.length === 0) {
			const pos = Math.min(text.length, skipLineBreaks(text, cursor, 2));
			ranges.push({ end: pos, start: pos });
			cursor = pos;
			continue;
		}
		const found = text.indexOf(serialized, cursor);
		if (found >= 0) {
			ranges.push({ end: found + serialized.length, start: found });
			cursor = found + serialized.length;
			continue;
		}
		const start = Math.min(
			text.length,
			skipLineBreaks(text, cursor, Number.MAX_SAFE_INTEGER),
		);
		const blank = text.indexOf("\n\n", start);
		const end = blank >= 0 ? blank : text.length;
		ranges.push({ end, start });
		cursor = end;
	}
	return ranges;
}

function buildIndex(
	doc: ProseMirrorNode,
	markdown: string,
	normalization: ReturnType<typeof createNormalization>,
	ranges: ReadonlyArray<Range>,
): VisualSourceIndex {
	const blocks: VisualSourceBlock[] = [];
	let pmPos = 0;
	for (let i = 0; i < doc.childCount; i += 1) {
		const node = doc.child(i);
		const range = ranges[i] ?? {
			end: normalization.text.length,
			start: normalization.text.length,
		};
		blocks.push({
			index: i,
			mdEnd: range.end,
			mdStart: range.start,
			node,
			pmEnd: pmPos + node.nodeSize,
			pmPos,
		});
		pmPos += node.nodeSize;
	}
	const segmentCache = new Map<number, ReadonlyArray<VisualSourceSegment>>();
	const index: VisualSourceIndex = {
		blocks,
		doc,
		markdown,
		segmentsFor(block) {
			const cached = segmentCache.get(block.index);
			if (cached) return cached;
			const built = buildBlockSegments(block, normalization.text);
			segmentCache.set(block.index, built);
			return built;
		},
		text: normalization.text,
		toNormalized: normalization.toNormalized,
		toOriginal: normalization.toOriginal,
	};
	indexCache.set(doc, index);
	return index;
}

/** Builds a fresh index, reusing an already parsed document when supplied. */
export function createVisualSourceIndex(
	doc: ProseMirrorNode,
	markdown: string,
	parsed?: ParsedVisualDocument,
): VisualSourceIndex {
	const normalization = createNormalization(markdown);
	const ranges =
		rangesFromParsed(
			doc,
			normalization.text,
			parsed ?? parseMarkdownWithBlockSources(markdown),
		) ?? rangesBySerialization(doc, normalization.text);
	return buildIndex(doc, markdown, normalization, ranges);
}

/** Returns the cached index for `(doc, markdown)`, building it once. */
export function getCachedVisualSourceIndex(
	doc: ProseMirrorNode,
	markdown: string,
): VisualSourceIndex {
	const cached = indexCache.get(doc);
	if (cached && cached.markdown === markdown) return cached;
	return createVisualSourceIndex(doc, markdown);
}

/**
 * Derives the next accepted index from the previous one and the exact bounded
 * canonical change. Untouched prefix/suffix blocks keep (or shift) their exact
 * ranges; a single changed block takes the bounded middle region. Any other
 * shape falls back to one parser-backed rebuild.
 */
export function deriveVisualSourceIndex(
	previous: VisualSourceIndex,
	nextDoc: ProseMirrorNode,
	nextMarkdown: string,
	change: VisualSourceTextChange,
): VisualSourceIndex {
	if (previous.markdown.indexOf("\r") >= 0 || nextMarkdown.indexOf("\r") >= 0) {
		return createVisualSourceIndex(nextDoc, nextMarkdown);
	}
	const oldBlocks = previous.blocks;
	const oldCount = oldBlocks.length;
	const newCount = nextDoc.childCount;
	const delta = nextMarkdown.length - previous.markdown.length;
	let prefix = 0;
	while (
		prefix < oldCount &&
		prefix < newCount &&
		nodesSemanticallyEqual(
			nextDoc.child(prefix),
			(oldBlocks[prefix] as VisualSourceBlock).node,
		)
	) {
		prefix += 1;
	}
	let suffix = 0;
	while (
		suffix < oldCount - prefix &&
		suffix < newCount - prefix &&
		nodesSemanticallyEqual(
			nextDoc.child(newCount - 1 - suffix),
			(oldBlocks[oldCount - 1 - suffix] as VisualSourceBlock).node,
		)
	) {
		suffix += 1;
	}
	const middle = newCount - prefix - suffix;
	const lastPrefix = prefix > 0 ? oldBlocks[prefix - 1] : undefined;
	const firstSuffix = suffix > 0 ? oldBlocks[oldCount - suffix] : undefined;
	const leadingEnd = oldBlocks[0]?.mdStart ?? 0;
	const trailingStart =
		oldBlocks[oldCount - 1]?.mdEnd ?? previous.markdown.length;
	if (
		middle > 1 ||
		(lastPrefix && lastPrefix.mdEnd > change.from) ||
		(firstSuffix && firstSuffix.mdStart < change.to)
	) {
		return createVisualSourceIndex(nextDoc, nextMarkdown);
	}
	const regionStart = lastPrefix
		? lastPrefix.mdEnd
		: leadingEnd <= change.from
			? leadingEnd
			: 0;
	const regionEnd = firstSuffix
		? firstSuffix.mdStart + delta
		: trailingStart >= change.to
			? trailingStart + delta
			: nextMarkdown.length;
	if (regionStart > regionEnd) {
		return createVisualSourceIndex(nextDoc, nextMarkdown);
	}
	const ranges: Range[] = [];
	for (let i = 0; i < prefix; i += 1) {
		const block = oldBlocks[i] as VisualSourceBlock;
		ranges.push({ end: block.mdEnd, start: block.mdStart });
	}
	if (middle === 1) {
		let start = regionStart;
		let end = regionEnd;
		while (start < end && nextMarkdown[start] === "\n") start += 1;
		while (end > start && nextMarkdown[end - 1] === "\n") end -= 1;
		if (start === end) {
			const pos = Math.min(regionStart + 2, regionEnd);
			ranges.push({ end: pos, start: pos });
		} else {
			ranges.push({ end, start });
		}
	}
	for (let i = oldCount - suffix; i < oldCount; i += 1) {
		const block = oldBlocks[i] as VisualSourceBlock;
		ranges.push({ end: block.mdEnd + delta, start: block.mdStart + delta });
	}
	return buildIndex(
		nextDoc,
		nextMarkdown,
		createNormalization(nextMarkdown),
		ranges,
	);
}
