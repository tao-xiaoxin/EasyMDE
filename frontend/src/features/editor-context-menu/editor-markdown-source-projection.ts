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
