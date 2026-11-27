export type LineBounds = Readonly<{
	end: number;
	index: number;
	start: number;
}>;

export function markdownLineStarts(markdown: string): number[] {
	const starts = [0];
	for (let offset = 0; offset < markdown.length; offset += 1) {
		if ("\r" === markdown[offset]) {
			if ("\n" === markdown[offset + 1]) offset += 1;
			starts.push(offset + 1);
		} else if ("\n" === markdown[offset]) {
			starts.push(offset + 1);
		}
	}
	return starts;
}

export function lineIndexAtOffset(
	starts: ReadonlyArray<number>,
	offset: number,
): number {
	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >>> 1;
		if ((starts[mid] ?? 0) <= offset) {
			low = mid;
		} else {
			high = mid - 1;
		}
	}
	return low;
}

function lineEndBeforeNextStart(
	text: string,
	start: number,
	nextStart: number | undefined,
): number {
	if (nextStart === undefined) return text.length;
	let end = nextStart;
	if (end > start && text[end - 1] === "\n") end -= 1;
	if (end > start && text[end - 1] === "\r") end -= 1;
	return end;
}

export function lineBoundsByIndex(
	text: string,
	starts: ReadonlyArray<number>,
	index: number,
): LineBounds | null {
	const start = starts[index];
	if (start === undefined) return null;
	const end = lineEndBeforeNextStart(text, start, starts[index + 1]);
	return { end, index, start };
}

export function lineBoundsAt(
	text: string,
	starts: ReadonlyArray<number>,
	offset: number,
): LineBounds {
	const clamped = Math.max(0, Math.min(text.length, offset));
	const index = lineIndexAtOffset(starts, clamped);
	const start = starts[index] ?? 0;
	const end = lineEndBeforeNextStart(text, start, starts[index + 1]);
	return { end, index, start };
}
