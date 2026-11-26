/**
 * Worker-safe, DOM-free backtick run bucketing for strictly O(N) CommonMark
 * inline code-span matching across the block-index worker, context-menu
 * scanners, Immersive Visual prescanner, and visual source inline mapper.
 */

export type BacktickRunBucket = {
	cursor: number;
	runs: number[];
};

export function addBacktickRunToBuckets(
	buckets: Map<number, BacktickRunBucket>,
	runLen: number,
	runStart: number,
): void {
	let bucket = buckets.get(runLen);
	if (!bucket) {
		bucket = { cursor: 0, runs: [] };
		buckets.set(runLen, bucket);
	}
	bucket.runs.push(runStart);
}

/**
 * Indexes every maximal backtick run start in `text` by exact run length for
 * strictly O(N) monotonic closer lookups.
 */
export function indexBacktickRunsByLength(
	text: string,
): Map<number, BacktickRunBucket> {
	const bucketsBySize = new Map<number, BacktickRunBucket>();
	const limit = text.length;
	let i = text.indexOf("`");
	while (i >= 0 && i < limit) {
		const runStart = i;
		i += 1;
		while (i < limit && 96 /* ` */ === text.charCodeAt(i)) i += 1;
		addBacktickRunToBuckets(bucketsBySize, i - runStart, runStart);
		i = i < limit ? text.indexOf("`", i) : -1;
	}
	return bucketsBySize;
}

export type BoundedBacktickIndex = Readonly<{
	buckets: Map<number, BacktickRunBucket>;
	runEnds: number[];
	runStarts: number[];
}>;

/**
 * Indexes every maximal backtick run strictly within `text[start..end)` without
 * scanning past `end`, returning `null` when the slice contains zero backticks.
 */
export function indexBoundedBacktickRuns(
	text: string,
	start: number,
	end: number,
): BoundedBacktickIndex | null {
	const limit = Math.min(text.length, end);
	let buckets: Map<number, BacktickRunBucket> | null = null;
	let runStarts: number[] | null = null;
	let runEnds: number[] | null = null;
	for (let i = start; i < limit; i += 1) {
		if (96 /* ` */ !== text.charCodeAt(i)) continue;
		const runStart = i;
		i += 1;
		while (i < limit && 96 === text.charCodeAt(i)) i += 1;
		if (!buckets || !runStarts || !runEnds) {
			buckets = new Map<number, BacktickRunBucket>();
			runStarts = [];
			runEnds = [];
		}
		addBacktickRunToBuckets(buckets, i - runStart, runStart);
		runStarts.push(runStart);
		runEnds.push(i);
	}
	return buckets && runStarts && runEnds
		? { buckets, runEnds, runStarts }
		: null;
}

export function findNextBacktickCloser(
	buckets: Map<number, BacktickRunBucket>,
	size: number,
	minCloserStart: number,
	resetIfBacktracked = false,
): number {
	const bucket = buckets.get(size);
	if (!bucket || 0 === bucket.runs.length) return -1;
	const { runs } = bucket;
	let idx = bucket.cursor;
	if (resetIfBacktracked && idx > 0 && (runs[idx - 1] ?? -1) >= minCloserStart) {
		let lo = 0;
		let hi = idx;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if ((runs[mid] ?? -1) < minCloserStart) lo = mid + 1;
			else hi = mid;
		}
		idx = lo;
	}
	while (idx < runs.length && (runs[idx] ?? -1) < minCloserStart) idx += 1;
	bucket.cursor = idx;
	return runs[idx] ?? -1;
}
