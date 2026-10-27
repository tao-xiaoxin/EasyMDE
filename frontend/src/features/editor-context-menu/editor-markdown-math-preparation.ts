import type {
	EditorMarkdownMathSpan,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";
import { lineIndexAtOffsets } from "./editor-markdown-lines";
import {
	mergeRanges,
	type SourceRange,
} from "./editor-markdown-source-projection";

export type MathRange = SourceRange &
	Readonly<{
		block: boolean;
	}>;

type MathScanResult = Readonly<{
	conflicts: ReadonlyArray<SourceRange>;
	ranges: ReadonlyArray<MathRange>;
}>;

type ActiveMathRange = SourceRange &
	Readonly<{
		accepted: MathRange | null;
	}>;

type OverlayRange = SourceRange &
	Readonly<{
		kind: "math" | "unavailable";
	}>;

export function mathSpanFromRange(
	source: string,
	range: MathRange,
): EditorMarkdownMathSpan {
	const startsWith = source.slice(range.from, range.from + 2);
	const endsWith = source.slice(Math.max(range.from, range.to - 2), range.to);
	if (
		("$$" === startsWith && "$$" === endsWith) ||
		("\\[" === startsWith && "\\]" === endsWith)
	) {
		return {
			bodyFrom: range.from + 2,
			bodyTo: range.to - 2,
			displayMode: true,
			from: range.from,
			to: range.to,
		};
	}
	if ("\\(" === startsWith && "\\)" === endsWith) {
		return {
			bodyFrom: range.from + 2,
			bodyTo: range.to - 2,
			displayMode: false,
			from: range.from,
			to: range.to,
		};
	}
	if ("$" === source[range.from] && "$" === source[range.to - 1]) {
		return {
			bodyFrom: range.from + 1,
			bodyTo: range.to - 1,
			displayMode: false,
			from: range.from,
			to: range.to,
		};
	}
	throw new Error("editor-context-menu-math-range-invalid");
}

export function normalizeMathRanges(
	ranges: ReadonlyArray<MathRange>,
): MathScanResult {
	const sorted = ranges
		.filter((range) => range.to > range.from)
		.sort((left, right) => left.from - right.from || right.to - left.to);
	const accepted: MathRange[] = [];
	const conflicts: SourceRange[] = [];
	const active: ActiveMathRange[] = [];

	for (const range of sorted) {
		while (
			active.length &&
			range.from >= (active[active.length - 1]?.to ?? 0)
		) {
			active.pop();
		}
		const owner = active[active.length - 1];
		if (!owner) {
			accepted.push(range);
			active.push({ ...range, accepted: range });
			continue;
		}
		if (range.to <= owner.to) continue;

		const conflict = { from: owner.from, to: range.to };
		conflicts.push(conflict);
		if (owner.accepted) {
			const ownerIndex = accepted.lastIndexOf(owner.accepted);
			if (ownerIndex >= 0) accepted.splice(ownerIndex, 1);
		}
		active.pop();
		active.push({ ...conflict, accepted: null });
	}

	return {
		conflicts: mergeRanges(conflicts),
		ranges: accepted.sort(
			(left, right) => left.from - right.from || left.to - right.to,
		),
	};
}

function outsideSegments(
	length: number,
	protectedRanges: ReadonlyArray<SourceRange>,
): SourceRange[] {
	const segments: SourceRange[] = [];
	let cursor = 0;
	for (const range of protectedRanges) {
		if (cursor < range.from) segments.push({ from: cursor, to: range.from });
		cursor = Math.max(cursor, range.to);
	}
	if (cursor < length) segments.push({ from: cursor, to: length });
	return segments;
}

export function mathRanges(
	source: string,
	protectedRanges: ReadonlyArray<SourceRange>,
): MathRange[] {
	const segments = outsideSegments(source.length, protectedRanges);
	const patterns: ReadonlyArray<
		Readonly<{
			block: boolean;
			expression: RegExp;
		}>
	> = [
		{ block: true, expression: /\$\$[\s\S]+?\$\$/gu },
		{ block: true, expression: /\\\[[\s\S]+?\\\]/gu },
		{ block: false, expression: /\\\([\s\S]+?\\\)/gu },
		{ block: false, expression: /(?<!\\)\$[^\n$]+?(?<!\\)\$/gu },
	];
	const ranges: MathRange[] = [];
	for (const segment of segments) {
		const masked = source.slice(segment.from, segment.to).split("");
		for (const pattern of patterns) {
			pattern.expression.lastIndex = 0;
			const text = masked.join("");
			for (const match of text.matchAll(pattern.expression)) {
				const from = segment.from + match.index;
				const to = from + match[0].length;
				ranges.push({ block: pattern.block, from, to });
				for (
					let index = match.index;
					index < match.index + match[0].length;
					index += 1
				) {
					masked[index] =
						pattern.block && index === match.index ? "\n" : "\u0000";
				}
			}
		}
	}
	return ranges;
}

function mathBlock(
	starts: ReadonlyArray<number>,
	range: SourceRange,
): EditorMarkdownSourceBlock {
	return {
		editable: true,
		from: range.from,
		kind: "math",
		lineEnd: lineIndexAtOffsets(starts, Math.max(range.from, range.to - 1)),
		lineStart: lineIndexAtOffsets(starts, range.from),
		to: range.to,
	};
}

export function overlayMath(
	source: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	ranges: ReadonlyArray<MathRange>,
	starts: ReadonlyArray<number>,
	unavailableRanges: ReadonlyArray<SourceRange>,
): EditorMarkdownSourceBlock[] {
	const sortedCandidates = ranges
		.filter((range) => range.block)
		.sort((left, right) => left.from - right.from);
	const sortedRanges: MathRange[] = [];
	let ownerIndex = 0;
	for (const range of sortedCandidates) {
		while (
			ownerIndex < blocks.length &&
			(blocks[ownerIndex]?.to ?? 0) <= range.from
		) {
			ownerIndex += 1;
		}
		const owner = blocks[ownerIndex];
		if (
			owner &&
			("quote" === owner.kind ||
				"list" === owner.kind ||
				"unavailable" === owner.kind) &&
			range.from >= owner.from &&
			range.to <= owner.to
		)
			continue;
		sortedRanges.push(range);
	}
	const overlayRanges: OverlayRange[] = [
		...sortedRanges.map((range) => ({ ...range, kind: "math" as const })),
		...unavailableRanges.map((range) => ({
			...range,
			kind: "unavailable" as const,
		})),
	].sort((left, right) => left.from - right.from || left.to - right.to);
	const result: EditorMarkdownSourceBlock[] = [];
	let rangeIndex = 0;
	for (const block of blocks) {
		while (
			rangeIndex < overlayRanges.length &&
			(overlayRanges[rangeIndex]?.to ?? 0) <= block.from
		) {
			rangeIndex += 1;
		}
		let cursor = block.from;
		let candidateIndex = rangeIndex;
		while (candidateIndex < overlayRanges.length) {
			const range = overlayRanges[candidateIndex];
			if (!range || range.from >= block.to) break;
			const rangeFrom = Math.max(cursor, block.from, range.from);
			const rangeTo = Math.min(block.to, range.to);
			if (cursor < rangeFrom && source.slice(cursor, rangeFrom).trim()) {
				result.push({
					...block,
					from: cursor,
					lineStart: lineIndexAtOffsets(starts, cursor),
					to: rangeFrom,
				});
			}
			if (rangeFrom < rangeTo && "unavailable" === range.kind) {
				result.push({
					...block,
					editable: false,
					from: rangeFrom,
					kind: "unavailable",
					lineStart: lineIndexAtOffsets(starts, rangeFrom),
					to: rangeTo,
				});
			}
			cursor = Math.max(cursor, rangeTo);
			if (range.to <= block.to) candidateIndex += 1;
			else break;
		}
		if (cursor < block.to && source.slice(cursor, block.to).trim()) {
			result.push({
				...block,
				from: cursor,
				lineStart: lineIndexAtOffsets(starts, cursor),
				to: block.to,
			});
		}
		if (candidateIndex > rangeIndex) rangeIndex = candidateIndex;
	}
	for (const range of sortedRanges) result.push(mathBlock(starts, range));
	return result.sort(
		(left, right) => left.from - right.from || left.to - right.to,
	);
}
