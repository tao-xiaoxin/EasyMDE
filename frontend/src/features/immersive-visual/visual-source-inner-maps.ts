import type { Node as ProseMirrorNode } from "prosemirror-model";

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
const LIST_MARKER_PATTERN =
	/(?:[-+*]|\d{1,9}[.)])(?=[ \t]|\n|$)[ \t]*(?:\[[ xX]\][ \t]+)?/y;
const ATX_MARKER_PATTERN = /#{1,6}(?:[ \t]+|(?=\n)|$)/y;
const FENCE_LINE_PATTERN =
	/^[ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?[ \t]*(?:`{3,}|~{3,})/;
const CLOSING_MARKUP_PATTERN = /^[*_~`\]\s]*$/;

function lineEndAt(text: string, from: number, limit: number): number {
	const nl = text.indexOf("\n", from);
	return nl < 0 || nl > limit ? limit : nl;
}

function skipContainerPrefix(
	text: string,
	from: number,
	limit: number,
): number {
	let cursor = from;
	while (cursor < limit) {
		const ch = text[cursor];
		if (ch === " " || ch === "\t" || ch === "\n" || ch === ">") {
			cursor += 1;
			continue;
		}
		LIST_MARKER_PATTERN.lastIndex = cursor;
		const marker = LIST_MARKER_PATTERN.exec(text);
		if (marker && marker[0].length > 0 && cursor + marker[0].length <= limit) {
			cursor += marker[0].length;
			continue;
		}
		break;
	}
	return cursor;
}

function findChar(
	text: string,
	ch: string,
	cursor: number,
	limit: number,
): number {
	if (cursor >= limit) return -1;
	const current = text[cursor];
	if (current === ch) return cursor;
	if (
		(ch === " " || ch === "\t" || ch === "\n") &&
		current !== undefined &&
		/\s/.test(current)
	) {
		return cursor;
	}
	const found = text.indexOf(ch, cursor);
	return found >= 0 && found < limit ? found : -1;
}

function skipQuoted(
	text: string,
	from: number,
	limit: number,
	quote: string,
): number {
	let i = from + 1;
	while (i < limit) {
		const ch = text[i];
		if (ch === "\\") i += 2;
		else if (ch === quote) return i + 1;
		else i += 1;
	}
	return limit;
}

/** Given the position of a closing `]`, returns the end of its link tail. */
function scanLinkTail(
	text: string,
	closeBracket: number,
	limit: number,
): number {
	const next = closeBracket + 1;
	if (text[next] === "(") {
		let depth = 1;
		let i = next + 1;
		while (i < limit) {
			const ch = text[i];
			if (ch === "\\") {
				i += 2;
				continue;
			}
			if (ch === "<") {
				const close = text.indexOf(">", i);
				i = close >= 0 && close < limit ? close + 1 : i + 1;
				continue;
			}
			if (ch === '"' || ch === "'") {
				i = skipQuoted(text, i, limit, ch);
				continue;
			}
			if (ch === "(") depth += 1;
			if (ch === ")") {
				depth -= 1;
				if (depth === 0) return i + 1;
			}
			i += 1;
		}
		return limit;
	}
	if (text[next] === "[") {
		const close = text.indexOf("]", next);
		return close >= 0 && close < limit ? close + 1 : next;
	}
	return next;
}

function skipLinkTail(text: string, cursor: number, limit: number): number {
	const close = text.indexOf("]", cursor);
	if (close < 0 || close >= limit) return cursor;
	if (!CLOSING_MARKUP_PATTERN.test(text.slice(cursor, close))) return cursor;
	return scanLinkTail(text, close, limit);
}

function findImage(text: string, cursor: number, limit: number): Range | null {
	const start = text.indexOf("![", cursor);
	if (start < 0 || start >= limit) return null;
	let depth = 1;
	let i = start + 2;
	while (i < limit) {
		const ch = text[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === "[") depth += 1;
		if (ch === "]") {
			depth -= 1;
			if (depth === 0) break;
		}
		i += 1;
	}
	if (i >= limit) return null;
	return { end: scanLinkTail(text, i, limit), start };
}

function findHardBreak(
	text: string,
	cursor: number,
	limit: number,
	inCell: boolean,
): Range | null {
	if (inCell) {
		const start = text.indexOf("<br>", cursor);
		if (start < 0 || start + 4 > limit) return null;
		return { end: start + 4, start };
	}
	const nl = text.indexOf("\n", cursor);
	if (nl < 0 || nl >= limit) {
		return text[cursor] === " " ? { end: cursor + 1, start: cursor } : null;
	}
	let start = nl;
	if (text[nl - 1] === "\\") start = nl - 1;
	else while (start > cursor && text[start - 1] === " ") start -= 1;
	return { end: nl + 1, start };
}

type MapResult = Readonly<{ cursor: number; segment: VisualSourceSegment }>;

function hasLinkMark(node: ProseMirrorNode): boolean {
	return node.marks.some((mark) => mark.type.name === "link");
}

function mapInlineTextblock(
	node: ProseMirrorNode,
	contentStart: number,
	text: string,
	from: number,
	limit: number,
	inCell: boolean,
	atBlockStart: boolean,
): MapResult {
	let cursor = from;
	if (!atBlockStart && !inCell) {
		const lineEnd = lineEndAt(text, cursor, limit);
		if (
			lineEnd < limit &&
			CLOSING_MARKUP_PATTERN.test(text.slice(cursor, lineEnd))
		) {
			cursor = lineEnd + 1;
		}
	}
	const segmentStart = cursor;
	if (!inCell) cursor = skipContainerPrefix(text, cursor, limit);
	if (node.type.name === "heading") {
		ATX_MARKER_PATTERN.lastIndex = cursor;
		const marker = ATX_MARKER_PATTERN.exec(text);
		if (marker && cursor + marker[0].length <= limit)
			cursor += marker[0].length;
	}
	const emptyMd = cursor;
	const units: VisualSourceUnit[] = [];
	let linkOpen = false;
	node.forEach((child, offset) => {
		const pmPos = contentStart + offset;
		const linked = hasLinkMark(child);
		if (linkOpen && !linked) cursor = skipLinkTail(text, cursor, limit);
		linkOpen = linked;
		if (child.isText) {
			const value = child.text ?? "";
			for (let i = 0; i < value.length; i += 1) {
				const found = findChar(text, value[i] as string, cursor, limit);
				if (found < 0) {
					units.push({
						atom: null,
						mdEnd: cursor,
						mdStart: cursor,
						pmPos: pmPos + i,
						pmSize: 1,
					});
					continue;
				}
				units.push({
					atom: null,
					mdEnd: found + 1,
					mdStart: found,
					pmPos: pmPos + i,
					pmSize: 1,
				});
				cursor = found + 1;
			}
			return;
		}
		let range: Range | null = null;
		if (child.type.name === "image") {
			range = findImage(text, cursor, limit);
		} else if (child.type.name === "protected_inline") {
			const raw = String(child.attrs.rawMarkdown ?? "");
			const found = raw.length > 0 ? text.indexOf(raw, cursor) : -1;
			range =
				found >= 0 && found + raw.length <= limit
					? { end: found + raw.length, start: found }
					: null;
		} else if (child.type.name === "hard_break") {
			range = findHardBreak(text, cursor, limit, inCell);
		}
		const resolved = range ?? { end: cursor, start: cursor };
		units.push({
			atom: child,
			mdEnd: resolved.end,
			mdStart: resolved.start,
			pmPos,
			pmSize: child.nodeSize,
		});
		cursor = resolved.end;
	});
	if (linkOpen) cursor = skipLinkTail(text, cursor, limit);
	const lastUnit = units[units.length - 1];
	return {
		cursor,
		segment: {
			contentEnd: contentStart + node.content.size,
			contentStart,
			emptyMd,
			kind: "text",
			mdEnd: Math.max(lastUnit ? lastUnit.mdEnd : emptyMd, emptyMd),
			mdStart: segmentStart,
			units,
		},
	};
}

function mapCodeTextblock(
	node: ProseMirrorNode,
	contentStart: number,
	text: string,
	from: number,
	limit: number,
): MapResult {
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
		let base: number;
		if (pmLine.length === 0) {
			base = FENCE_LINE_PATTERN.test(mdLine) ? mdLineStart : mdLineEnd;
		} else {
			base = mdLine.endsWith(pmLine) ? mdLineEnd - pmLine.length : mdLineStart;
		}
		for (let j = 0; j < pmLine.length; j += 1) {
			const md = Math.min(base + j, limit);
			units.push({
				atom: null,
				mdEnd: Math.min(md + 1, limit),
				mdStart: md,
				pmPos: contentStart + pmOffset + j,
				pmSize: 1,
			});
		}
		pmOffset += pmLine.length;
		if (k < lines.length - 1) {
			units.push({
				atom: null,
				mdEnd: Math.min(mdLineEnd + 1, limit),
				mdStart: mdLineEnd,
				pmPos: contentStart + pmOffset,
				pmSize: 1,
			});
			pmOffset += 1;
			mdLineStart = Math.min(mdLineEnd + 1, limit);
		}
	}
	let cursor = Math.min(lineEndAt(text, mdLineStart, limit) + 1, limit);
	const closerStart = cursor;
	const closerEnd = lineEndAt(text, closerStart, limit);
	if (
		closerStart < limit &&
		FENCE_LINE_PATTERN.test(text.slice(closerStart, closerEnd))
	) {
		cursor = closerEnd;
	} else {
		cursor = Math.min(cursor, limit);
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
	let i = lineStart;
	while (i < lineEnd) {
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
	if (boundaries.length > 0 && boundaries[boundaries.length - 1] === last - 1)
		pieces.pop();
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

function buildTableSegments(
	block: VisualSourceBlock,
	text: string,
): VisualSourceSegment[] {
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
			const cellRange = cells[colIndex] ?? {
				end: block.mdEnd,
				start: block.mdEnd,
			};
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

export function buildBlockSegments(
	block: VisualSourceBlock,
	text: string,
): VisualSourceSegment[] {
	const { node } = block;
	if (ATOM_BLOCK_NAMES.has(node.type.name)) {
		return [
			{
				kind: "atom",
				mdEnd: block.mdEnd,
				mdStart: block.mdStart,
				node,
				pmEnd: block.pmEnd,
				pmPos: block.pmPos,
			},
		];
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
					: mapInlineTextblock(
							current,
							pos + 1,
							text,
							cursor,
							limit,
							false,
							cursor === block.mdStart,
						);
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
			segments.push({
				kind: "atom",
				mdEnd: end,
				mdStart: start,
				node: current,
				pmEnd: pos + current.nodeSize,
				pmPos: pos,
			});
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
