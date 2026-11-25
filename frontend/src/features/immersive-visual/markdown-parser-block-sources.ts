import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	isCommonMarkBlankLine,
	type PreScanResult,
} from "./markdown-prescanner";

/**
 * Resolves original raw-line spans for mapped top-level visual blocks and
 * groups contiguous overlapping shared-line split blocks into preservable
 * source slices.
 */

export type ResolvedBlockRange = Readonly<{
	end: number;
	shared: boolean;
	start: number;
}>;

export type MappedBlockEntry = Readonly<{
	node: ProseMirrorNode;
	origRange: ResolvedBlockRange | null;
}>;

export type ParsedVisualSharedGroup = Readonly<{
	endIndex: number;
	raw: string;
	separatorBefore: string;
	startIndex: number;
}>;

export type ParsedVisualBlockSource = Readonly<{
	node: ProseMirrorNode;
	raw: string | null;
	separatorBefore: string;
	sharedGroup?: ParsedVisualSharedGroup;
}>;

export type BuiltVisualBlockSources = Readonly<{
	blocks: ReadonlyArray<ParsedVisualBlockSource>;
	leadingPrefix: string;
	trailingSuffix: string;
}>;

export function resolveOriginalRangeFromTokenMap(
	map: [number, number] | null | undefined,
	preScan: PreScanResult,
): ResolvedBlockRange | null {
	if (!map || map.length < 2) return null;
	const startLine = map[0];
	const endLine = map[1];
	if (
		!Number.isInteger(startLine) ||
		!Number.isInteger(endLine) ||
		startLine < 0 ||
		endLine <= startLine
	) {
		return null;
	}
	let origStart = Number.POSITIVE_INFINITY;
	let origEnd = -1;
	let shared = false;
	for (let lineIdx = startLine; lineIdx < endLine; lineIdx += 1) {
		const exclusive = preScan.outputLineRanges[lineIdx];
		const range = exclusive ?? preScan.outputLineSharedRanges[lineIdx];
		if (!range) {
			if (!isCommonMarkBlankLine(preScan.outputLines[lineIdx] ?? "")) {
				return null;
			}
			continue;
		}
		if (!exclusive) shared = true;
		if (range.start < origStart) origStart = range.start;
		if (range.end > origEnd) origEnd = range.end;
	}
	if (!Number.isFinite(origStart) || origEnd <= origStart) return null;
	// markdown-it can include trailing blank lines in list/blockquote token maps;
	// trim trailing blank lines so the exact inter-block separator stays outside the block.
	while (
		origEnd > origStart &&
		isCommonMarkBlankLine(preScan.rawLines[origEnd - 1] ?? "")
	) {
		origEnd -= 1;
	}
	return origEnd > origStart
		? { end: origEnd, shared, start: origStart }
		: null;
}

export function buildVisualBlockSources(
	mapped: ReadonlyArray<MappedBlockEntry>,
	rawLines: ReadonlyArray<string>,
): BuiltVisualBlockSources {
	let lastKnownEnd = 0;
	let previousHadRange = false;
	let hasMonotonicRanges = mapped.length > 0;
	let firstUnitStart: number | null = null;
	const blocks: ParsedVisualBlockSource[] = [];

	const computeSeparator = (start: number): string =>
		blocks.length === 0
			? ""
			: !previousHadRange
				? "\n\n"
				: start > lastKnownEnd
					? `\n${rawLines.slice(lastKnownEnd, start).join("\n")}\n`
					: "\n";

	let idx = 0;
	while (idx < mapped.length) {
		const entry = mapped[idx];
		if (!entry) {
			idx += 1;
			continue;
		}
		const range = entry.origRange;
		if (
			range &&
			!range.shared &&
			range.start >= lastKnownEnd &&
			range.end <= rawLines.length
		) {
			if (blocks.length === 0) firstUnitStart = range.start;
			blocks.push({
				node: entry.node,
				raw: rawLines.slice(range.start, range.end).join("\n"),
				separatorBefore: computeSeparator(range.start),
			});
			lastKnownEnd = range.end;
			previousHadRange = true;
			idx += 1;
			continue;
		}
		if (
			range?.shared &&
			range.start >= lastKnownEnd &&
			range.end <= rawLines.length
		) {
			const groupStartIndex = blocks.length;
			const groupRawStart = range.start;
			let groupRawEnd = range.end;
			let endIdx = idx + 1;
			while (endIdx < mapped.length) {
				const nextRange = mapped[endIdx]?.origRange;
				if (
					!nextRange ||
					nextRange.start < groupRawStart ||
					nextRange.start >= groupRawEnd ||
					nextRange.end > rawLines.length
				) {
					break;
				}
				if (nextRange.end > groupRawEnd) groupRawEnd = nextRange.end;
				endIdx += 1;
			}
			while (
				groupRawEnd > groupRawStart &&
				isCommonMarkBlankLine(rawLines[groupRawEnd - 1] ?? "")
			) {
				groupRawEnd -= 1;
			}
			if (groupStartIndex === 0) firstUnitStart = groupRawStart;
			const sharedGroup: ParsedVisualSharedGroup = {
				endIndex: groupStartIndex + (endIdx - idx),
				raw: rawLines.slice(groupRawStart, groupRawEnd).join("\n"),
				separatorBefore: computeSeparator(groupRawStart),
				startIndex: groupStartIndex,
			};
			for (let k = idx; k < endIdx; k += 1) {
				const member = mapped[k];
				if (!member) continue;
				blocks.push({
					node: member.node,
					raw: null,
					separatorBefore: blocks.length === 0 ? "" : "\n\n",
					sharedGroup,
				});
			}
			lastKnownEnd = groupRawEnd;
			previousHadRange = true;
			idx = endIdx;
			continue;
		}
		hasMonotonicRanges = false;
		previousHadRange = false;
		blocks.push({
			node: entry.node,
			raw: null,
			separatorBefore: blocks.length === 0 ? "" : "\n\n",
		});
		idx += 1;
	}

	const leadingPrefix =
		hasMonotonicRanges && firstUnitStart !== null && firstUnitStart > 0
			? `${rawLines.slice(0, firstUnitStart).join("\n")}\n`
			: "";
	const trailingSuffix =
		hasMonotonicRanges && lastKnownEnd > 0 && lastKnownEnd < rawLines.length
			? `\n${rawLines.slice(lastKnownEnd).join("\n")}`
			: "";

	return { blocks, leadingPrefix, trailingSuffix };
}
