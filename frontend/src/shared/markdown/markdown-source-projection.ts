export type SourceRange = Readonly<{
	from: number;
	to: number;
}>;

export type NewlineProjection = Readonly<{
	originalOffsets: ReadonlyArray<number>;
	text: string;
}>;

/**
 * Projects every `\r\n` and `\r` to one `\n` for the formal Markdown parser,
 * while retaining the offset of every projected byte in the canonical source.
 */
export function projectNewlines(source: string): NewlineProjection {
	const projected: string[] = [];
	const originalOffsets = [0];
	let original = 0;

	while (original < source.length) {
		const character = source[original];
		if ("\r" === character) {
			original += "\n" === source[original + 1] ? 2 : 1;
			projected.push("\n");
		} else {
			original += 1;
			projected.push(character ?? "");
		}
		originalOffsets.push(original);
	}

	return { originalOffsets, text: projected.join("") };
}

export function projectedOffsetAt(
	projection: NewlineProjection,
	originalOffset: number,
): number {
	const offsets = projection.originalOffsets;
	let low = 0;
	let high = offsets.length - 1;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if ((offsets[mid] ?? 0) < originalOffset) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}
	return low;
}

export function originalOffsetAt(
	projection: NewlineProjection,
	projectedOffset: number,
): number {
	const originalOffset = projection.originalOffsets[projectedOffset];
	if (undefined === originalOffset)
		throw new Error("editor-context-menu-offset-map-invalid");
	return originalOffset;
}

export function originalRange(
	projection: NewlineProjection,
	range: SourceRange,
): SourceRange {
	return {
		from: originalOffsetAt(projection, range.from),
		to: originalOffsetAt(projection, range.to),
	};
}

export function mergeRanges(
	ranges: ReadonlyArray<SourceRange>,
): SourceRange[] {
	const sorted = [...ranges]
		.filter((range) => range.to > range.from)
		.sort((left, right) => left.from - right.from || left.to - right.to);
	const merged: SourceRange[] = [];
	for (const range of sorted) {
		const previous = merged[merged.length - 1];
		if (previous && range.from <= previous.to) {
			merged[merged.length - 1] = {
				from: previous.from,
				to: Math.max(previous.to, range.to),
			};
		} else {
			merged.push(range);
		}
	}
	return merged;
}

/** Binary-searches the first range in a sorted list whose `to > offset`. */
export function firstRangeEndingAfter(
	ranges: ReadonlyArray<SourceRange>,
	offset: number,
): number {
	let low = 0;
	let high = ranges.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if ((ranges[mid]?.to ?? 0) <= offset) low = mid + 1;
		else high = mid;
	}
	return low;
}

/** Returns whether `[from, to)` overlaps any range in a sorted range list. */
export function hasRangeOverlap(
	ranges: ReadonlyArray<SourceRange>,
	from: number,
	to: number,
): boolean {
	if (0 === ranges.length || from >= to) return false;
	const first = ranges[firstRangeEndingAfter(ranges, from)];
	return undefined !== first && first.from < to;
}

/** Returns whether `[from, to)` lies completely inside one merged sorted range. */
export function isContainedInSortedRanges(
	from: number,
	to: number,
	sortedMerged: ReadonlyArray<SourceRange>,
): boolean {
	if (0 === sortedMerged.length) return false;
	const match = sortedMerged[firstRangeEndingAfter(sortedMerged, from)];
	return undefined !== match && match.from <= from && to <= match.to;
}

/** Subtracts sorted `excluded` holes from `[from, to)` in linear time. */
export function subtractSortedRanges(
	from: number,
	to: number,
	excluded: ReadonlyArray<SourceRange>,
): SourceRange[] {
	if (from >= to) return [];
	if (0 === excluded.length) return [{ from, to }];
	const runs: SourceRange[] = [];
	let cursor = from;
	for (
		let index = firstRangeEndingAfter(excluded, cursor);
		index < excluded.length;
		index += 1
	) {
		const hole = excluded[index];
		if (!hole || hole.from >= to) break;
		if (hole.to <= cursor) continue;
		if (hole.from > cursor) runs.push({ from: cursor, to: hole.from });
		cursor = Math.max(cursor, hole.to);
		if (cursor >= to) break;
	}
	if (cursor < to) runs.push({ from: cursor, to });
	return runs;
}

/** Clamps `range` endpoints outward from any partially overlapped indivisible range. */
export function clampOutsideIndivisible(
	range: SourceRange,
	indivisibleRanges: ReadonlyArray<SourceRange>,
): SourceRange | null {
	if (0 === indivisibleRanges.length) return range;
	let { from, to } = range;
	const startMatch =
		indivisibleRanges[firstRangeEndingAfter(indivisibleRanges, from)];
	if (startMatch && from > startMatch.from && from < startMatch.to) {
		from = startMatch.to;
	}
	if (from >= to) return null;
	const endMatch =
		indivisibleRanges[firstRangeEndingAfter(indivisibleRanges, to - 1)];
	if (endMatch && to > endMatch.from && to < endMatch.to) {
		to = endMatch.from;
	}
	return from < to ? { from, to } : null;
}

export function lineStartBefore(text: string, offset: number): number {
	let cursor = offset;
	while (cursor > 0 && "\n" !== text[cursor - 1]) cursor -= 1;
	return cursor;
}

/**
 * Returns `true` when `offset` in `text` is immediately preceded by an odd
 * number of consecutive `\` characters within `[min, offset)`.
 */
export function hasOddPrecedingBackslashes(
	text: string,
	offset: number,
	min: number = 0,
): boolean {
	let count = 0;
	for (
		let i = offset - 1;
		i >= min && 92 /* \ */ === text.charCodeAt(i);
		i -= 1
	) {
		count += 1;
	}
	return 1 === (count & 1);
}

function findQuoteMark(
	quoteMarks: ReadonlyArray<SourceRange>,
	offset: number,
	edge: "end" | "start",
): SourceRange | null {
	if (0 === quoteMarks.length) return null;
	if ("start" === edge) {
		const mark = quoteMarks[firstRangeEndingAfter(quoteMarks, offset)];
		return mark && mark.from <= offset ? mark : null;
	}
	if (offset <= 0) return null;
	const mark = quoteMarks[firstRangeEndingAfter(quoteMarks, offset - 1)];
	return mark && mark.from < offset ? mark : null;
}

export function hasQuoteMarkBeforeOnLine(
	text: string,
	offset: number,
	quoteMarks: ReadonlyArray<SourceRange>,
): boolean {
	if (0 === quoteMarks.length) return false;
	const mark =
		quoteMarks[firstRangeEndingAfter(quoteMarks, lineStartBefore(text, offset))];
	return undefined !== mark && mark.from < offset;
}

export function trimProjectedBounds(
	text: string,
	rawFrom: number,
	rawTo: number,
	quoteMarks: ReadonlyArray<SourceRange>,
): SourceRange | null {
	let from = rawFrom;
	let to = rawTo;
	while (from < to) {
		const ch = text[from];
		if (" " === ch || "\t" === ch || "\n" === ch) {
			from += 1;
			continue;
		}
		const mark = findQuoteMark(quoteMarks, from, "start");
		if (!mark) break;
		from = mark.to;
	}
	while (to > from) {
		const ch = text[to - 1];
		if (" " === ch || "\t" === ch || "\n" === ch) {
			to -= 1;
			continue;
		}
		const mark = findQuoteMark(quoteMarks, to, "end");
		if (!mark) break;
		to = mark.from;
	}
	if (
		to > from &&
		"\\" === text[to - 1] &&
		(to === text.length || "\n" === text[to]) &&
		hasOddPrecedingBackslashes(text, to, from)
	) {
		to -= 1;
		while (to > from && (" " === text[to - 1] || "\t" === text[to - 1])) to -= 1;
	}
	return from < to ? { from, to } : null;
}

/**
 * Appends every item of `source` to `target` iteratively so document-scaled
 * arrays never overflow the call stack (unlike `target.push(...source)`).
 */
export function appendAll<T>(target: T[], source: ReadonlyArray<T>): void {
	for (const item of source) target.push(item);
}

/**
 * Removes every `stripMask[i] !== 0` code unit from `text`, returning the
 * compacted text and `indexMap[compactIdx] = originalIdx`.
 */
export function compactUnmaskedSliceWithMap(
	text: string,
	stripMask: Uint8Array,
): Readonly<{ indexMap: Int32Array; text: string }> {
	const length = text.length;
	let keptCount = 0;
	for (let i = 0; i < length; i += 1) {
		if (0 === (stripMask[i] ?? 0)) keptCount += 1;
	}
	const indexMap = new Int32Array(keptCount);
	const chunks: string[] = [];
	let out = 0;
	let chunkStart = -1;
	for (let i = 0; i < length; i += 1) {
		if (stripMask[i]) {
			if (chunkStart >= 0) {
				chunks.push(text.slice(chunkStart, i));
				chunkStart = -1;
			}
			continue;
		}
		if (chunkStart < 0) chunkStart = i;
		indexMap[out] = i;
		out += 1;
	}
	if (chunkStart >= 0) chunks.push(text.slice(chunkStart, length));
	return { indexMap, text: chunks.join("") };
}

export function extractUnmaskedSlice(
	text: string,
	from: number,
	to: number,
	hidden: Uint8Array,
): string {
	const chunks: string[] = [];
	let chunkStart = -1;
	for (let i = from; i < to; i += 1) {
		if (hidden[i]) {
			if (chunkStart >= 0) {
				chunks.push(text.slice(chunkStart, i));
				chunkStart = -1;
			}
			continue;
		}
		if (chunkStart < 0) chunkStart = i;
	}
	if (chunkStart >= 0) chunks.push(text.slice(chunkStart, to));
	return chunks.join("");
}
