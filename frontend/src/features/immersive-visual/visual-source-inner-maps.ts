import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	lineEndAt,
	mapInlineTextblock,
	skipContainerPrefix,
	type VisualSourceMapResult,
} from "./visual-source-inline-map";

/**
 * Inner block position maps for the visual source index. Each top-level
 * block is mapped lazily into exact inline, code, table-cell, and atom
 * segments over LF-normalized UTF-16 Markdown offsets. This module owns the
 * shared segment/block types so `visual-source-index.ts` can depend on it
 * without an import cycle.
 */

export type VisualSourceUnit = Readonly<{
	atom: ProseMirrorNode | null;
	mdEnd: number;
	mdStart: number;
	pmPos: number;
	pmSize: number;
}>;

export type VisualSourceTextSegment = Readonly<{
	contentEnd: number;
	contentStart: number;
	emptyMd: number;
	kind: "text";
	mdEnd: number;
	mdStart: number;
	units: ReadonlyArray<VisualSourceUnit>;
}>;

export type VisualSourceAtomSegment = Readonly<{
	kind: "atom";
	mdEnd: number;
	mdStart: number;
	node: ProseMirrorNode;
	pmEnd: number;
	pmPos: number;
}>;

export type VisualSourceSegment =
	| VisualSourceTextSegment
	| VisualSourceAtomSegment;

export type VisualSourceBlock = Readonly<{
	index: number;
	mdEnd: number;
	mdStart: number;
	node: ProseMirrorNode;
	pmEnd: number;
	pmPos: number;
}>;

type Range = { end: number; start: number };

export const ATOM_BLOCK_NAMES: ReadonlySet<string> = new Set([
	"horizontal_rule",
	"protected_block",
]);

const FENCE_LINE_PATTERN =
	/^[ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?[ \t]*(?:`{3,}|~{3,})/;

function mapCodeTextblock(
	node: ProseMirrorNode,
	contentStart: number,
	text: string,
	from: number,
	limit: number,
): VisualSourceMapResult {
	const segmentStart = from;
	let lineStart = from;
	let bodyStart = from;
	for (let attempt = 0; attempt < 3 && lineStart < limit; attempt += 1) {
		const lineEnd = lineEndAt(text, lineStart, limit);
		const line = text.slice(lineStart, lineEnd);
		if (FENCE_LINE_PATTERN.test(line)) {
			bodyStart = Math.min(limit, lineEnd + 1);
			break;
		}
		if (
			line.replace(/^[\s>]*(?:(?:[-+*]|\d{1,9}[.)])\s+)?/, "").length === 0 &&
			lineEnd < limit
		) {
			lineStart = lineEnd + 1;
			bodyStart = lineStart;
			continue;
		}
		bodyStart = lineStart;
		break;
	}
	const lines = node.textContent.split("\n");
	const units: VisualSourceUnit[] = [];
	let mdLineStart = bodyStart;
	let pmOffset = 0;
	for (let k = 0; k < lines.length; k += 1) {
		const pmLine = lines[k] as string;
		const mdLineEnd = lineEndAt(text, Math.min(mdLineStart, limit), limit);
		const mdLine = text.slice(mdLineStart, mdLineEnd);
		const base =
			pmLine.length === 0
				? FENCE_LINE_PATTERN.test(mdLine)
					? mdLineStart
					: mdLineEnd
				: mdLine.endsWith(pmLine)
					? mdLineEnd - pmLine.length
					: mdLineStart;
		for (let j = 0; j < pmLine.length; j += 1) {
			const md = Math.min(base + j, limit);
			units.push({ atom: null, mdEnd: Math.min(md + 1, limit), mdStart: md, pmPos: contentStart + pmOffset + j, pmSize: 1 });
		}
		pmOffset += pmLine.length;
		if (k < lines.length - 1) {
			units.push({ atom: null, mdEnd: Math.min(mdLineEnd + 1, limit), mdStart: mdLineEnd, pmPos: contentStart + pmOffset, pmSize: 1 });
			pmOffset += 1;
			mdLineStart = Math.min(mdLineEnd + 1, limit);
		}
	}
	let cursor = Math.min(lineEndAt(text, mdLineStart, limit) + 1, limit);
	const closerEnd = lineEndAt(text, cursor, limit);
	if (cursor < limit && FENCE_LINE_PATTERN.test(text.slice(cursor, closerEnd))) {
		cursor = closerEnd;
	}
	return {
		cursor,
		segment: {
			contentEnd: contentStart + node.content.size,
			contentStart,
			emptyMd: bodyStart,
			kind: "text",
			mdEnd: Math.max(cursor, bodyStart),
			mdStart: segmentStart,
			units,
		},
	};
}

/**
 * Splits one GFM table row into exact trimmed cell content ranges. Escaped
 * `\|` never splits, and neither does a pipe inside an inline code span.
 */
export function splitTableRowCells(
	text: string,
	lineStart: number,
	lineEnd: number,
): ReadonlyArray<Readonly<{ end: number; start: number }>> {
	const boundaries: number[] = [];
	let codeRun = 0;
	for (let i = lineStart; i < lineEnd; ) {
		const ch = text[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === "`") {
			let run = 0;
			while (i + run < lineEnd && text[i + run] === "`") run += 1;
			if (codeRun === 0) codeRun = run;
			else if (run === codeRun) codeRun = 0;
			i += run;
			continue;
		}
		if (ch === "|" && codeRun === 0) boundaries.push(i);
		i += 1;
	}
	let first = lineStart;
	while (first < lineEnd && /[ \t]/.test(text[first] ?? "")) first += 1;
	let last = lineEnd;
	while (last > first && /[ \t]/.test(text[last - 1] ?? "")) last -= 1;
	const pieces: Range[] = [];
	let previous = first;
	for (const boundary of boundaries) {
		pieces.push({ end: boundary, start: previous });
		previous = boundary + 1;
	}
	pieces.push({ end: last, start: previous });
	if (boundaries.length > 0 && boundaries[0] === first) pieces.shift();
	if (boundaries.length > 0 && boundaries[boundaries.length - 1] === last - 1) pieces.pop();
	const cells: Range[] = [];
	for (const piece of pieces) {
		let start = piece.start;
		let end = piece.end;
		while (start < end && /[ \t]/.test(text[start] ?? "")) start += 1;
		while (end > start && /[ \t]/.test(text[end - 1] ?? "")) end -= 1;
		cells.push({ end, start });
	}
	return cells;
}

function buildTableSegments(block: VisualSourceBlock, text: string): VisualSourceSegment[] {
	const lines: Range[] = [];
	let lineStart = block.mdStart;
	while (lineStart <= block.mdEnd) {
		const lineEnd = lineEndAt(text, lineStart, block.mdEnd);
		if (!text.slice(lineStart, lineEnd).trim().startsWith("<!--")) {
			lines.push({ end: lineEnd, start: lineStart });
		}
		if (lineEnd >= block.mdEnd) break;
		lineStart = lineEnd + 1;
	}
	const segments: VisualSourceSegment[] = [];
	block.node.forEach((row, rowOffset, rowIndex) => {
		const line = rowIndex === 0 ? lines[0] : lines[rowIndex + 1];
		const cells = line ? splitTableRowCells(text, line.start, line.end) : [];
		const rowPos = block.pmPos + 1 + rowOffset;
		row.forEach((cell, cellOffset, colIndex) => {
			const cellRange = cells[colIndex] ?? { end: block.mdEnd, start: block.mdEnd };
			let cursor = cellRange.start;
			const cellContentStart = rowPos + 1 + cellOffset + 1;
			cell.forEach((paragraph, paragraphOffset) => {
				if (!paragraph.isTextblock) return;
				const mapped = mapInlineTextblock(
					paragraph,
					cellContentStart + paragraphOffset + 1,
					text,
					cursor,
					cellRange.end,
					true,
					true,
				);
				segments.push(mapped.segment);
				cursor = mapped.cursor;
			});
		});
	});
	return segments;
}

export function buildBlockSegments(block: VisualSourceBlock, text: string): VisualSourceSegment[] {
	const { node } = block;
	if (ATOM_BLOCK_NAMES.has(node.type.name)) {
		return [{ kind: "atom", mdEnd: block.mdEnd, mdStart: block.mdStart, node, pmEnd: block.pmEnd, pmPos: block.pmPos }];
	}
	if (node.type.name === "table") return buildTableSegments(block, text);
	const segments: VisualSourceSegment[] = [];
	let cursor = block.mdStart;
	const limit = block.mdEnd;
	const visit = (current: ProseMirrorNode, pos: number): void => {
		if (current.isTextblock) {
			const mapped =
				current.type.name === "code_block"
					? mapCodeTextblock(current, pos + 1, text, cursor, limit)
					: mapInlineTextblock(current, pos + 1, text, cursor, limit, false, cursor === block.mdStart);
			segments.push(mapped.segment);
			cursor = mapped.cursor;
			return;
		}
		if (current.isAtom || current.isLeaf) {
			const start = skipContainerPrefix(text, cursor, limit);
			let end = lineEndAt(text, start, limit);
			if (current.type.name === "protected_block") {
				const raw = String(current.attrs.rawMarkdown ?? "");
				const found = raw.length > 0 ? text.indexOf(raw, start) : -1;
				if (found >= 0 && found + raw.length <= limit) end = found + raw.length;
			}
			segments.push({ kind: "atom", mdEnd: end, mdStart: start, node: current, pmEnd: pos + current.nodeSize, pmPos: pos });
			cursor = end;
			return;
		}
		current.forEach((child, offset) => {
			visit(child, pos + 1 + offset);
		});
	};
	if (node.isTextblock) visit(node, block.pmPos);
	else {
		node.forEach((child, offset) => {
			visit(child, block.pmPos + 1 + offset);
		});
	}
	return segments;
}
