import type { Node as ProseMirrorNode } from "prosemirror-model";

/**
 * Monotonic ProseMirror node sequence alignment for untouched-source
 * preservation: Hunt–Szymanski identity anchoring first, then exact LCS over
 * small gaps or indexed canonical-key matching over large gaps, plus
 * positional pairing of equal-length unmatched gaps (in-place edits).
 */

export type NodeMatcher = (
	next: ProseMirrorNode,
	orig: ProseMirrorNode,
) => boolean;

/** Exact LCS is used for gaps up to this many DP cells. */
const DP_CELL_BUDGET = 40000;

export function childrenOf(node: ProseMirrorNode): ProseMirrorNode[] {
	const children: ProseMirrorNode[] = [];
	node.forEach((child) => {
		children.push(child);
	});
	return children;
}

export const structurallyEqual: NodeMatcher = (next, orig) =>
	next === orig ||
	(next.type === orig.type && next.nodeSize === orig.nodeSize && next.eq(orig));

/**
 * Anchor surviving nodes by immutable object identity first: the longest
 * monotonic chain of `next === orig` pairs (Hunt–Szymanski, O(P log N) over
 * identity pairs P). A node ProseMirror kept untouched is the same object, so
 * two visually identical blocks can never swap their raw spellings.
 */
function anchorIdentities(
	newNodes: readonly ProseMirrorNode[],
	origNodes: readonly ProseMirrorNode[],
	matched: number[],
): void {
	const positions = new Map<ProseMirrorNode, number[]>();
	origNodes.forEach((node, idx) => {
		const list = positions.get(node);
		if (list) list.push(idx);
		else positions.set(node, [idx]);
	});
	type Link = Readonly<{ n: number; o: number; prev: Link | null }>;
	const tails: Link[] = [];
	// Shared node objects are rare; bound pathological duplicate pairs.
	let pairBudget = 4 * (newNodes.length + origNodes.length) + 64;
	newNodes.forEach((node, n) => {
		const list = positions.get(node);
		if (!list || list.length > pairBudget) return;
		pairBudget -= list.length;
		for (let k = list.length - 1; k >= 0; k -= 1) {
			const o = list[k] ?? 0;
			let lo = 0;
			let hi = tails.length;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if ((tails[mid]?.o ?? 0) < o) lo = mid + 1;
				else hi = mid;
			}
			tails[lo] = { n, o, prev: lo > 0 ? (tails[lo - 1] ?? null) : null };
		}
	});
	for (let link = tails[tails.length - 1] ?? null; link; link = link.prev) {
		matched[link.n] = link.o;
	}
}

/** Deterministic JSON with sorted object keys (attrs are JSON-compatible). */
function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

const canonicalKeyCache = new WeakMap<ProseMirrorNode, string>();

/**
 * Equality-compatible canonical key: node type, all attrs (sorted), marks
 * (ProseMirror keeps mark sets in canonical order) with sorted attrs, text,
 * and child keys. Nodes with equal keys are `eq()`; memoized per immutable
 * node, so every node's key is computed at most once.
 */
function canonicalKey(node: ProseMirrorNode): string {
	const cached = canonicalKeyCache.get(node);
	if (cached !== undefined) return cached;
	const marks = node.marks
		.map((mark) => `${mark.type.name}${stableStringify(mark.attrs)}`)
		.join(";");
	let key: string;
	if (node.isText) {
		key = `t${JSON.stringify(node.text ?? "")}<${marks}>`;
	} else {
		const children: string[] = [];
		node.forEach((child) => {
			children.push(canonicalKey(child));
		});
		key = `n${node.type.name}${stableStringify(node.attrs)}<${marks}>[${children.join(",")}]`;
	}
	canonicalKeyCache.set(node, key);
	return key;
}

/** Exact LCS over a small gap (offsets are absolute indices). */
function matchGapExact(
	newNodes: readonly ProseMirrorNode[],
	origNodes: readonly ProseMirrorNode[],
	nodesMatch: NodeMatcher,
	matched: number[],
	newStart: number,
	newLength: number,
	origStart: number,
	origLength: number,
): void {
	const same = (m: number, n: number): boolean => {
		const next = newNodes[newStart + m];
		const orig = origNodes[origStart + n];
		return next !== undefined && orig !== undefined && nodesMatch(next, orig);
	};
	const width = origLength + 1;
	const table = new Uint16Array((newLength + 1) * width);
	for (let m = newLength - 1; m >= 0; m -= 1) {
		for (let n = origLength - 1; n >= 0; n -= 1) {
			table[m * width + n] = same(m, n)
				? (table[(m + 1) * width + n + 1] ?? 0) + 1
				: Math.max(
						table[(m + 1) * width + n] ?? 0,
						table[m * width + n + 1] ?? 0,
					);
		}
	}
	let m = 0;
	let n = 0;
	while (m < newLength && n < origLength) {
		if (same(m, n)) {
			matched[newStart + m] = origStart + n;
			m += 1;
			n += 1;
		} else if (
			(table[(m + 1) * width + n] ?? 0) >= (table[m * width + n + 1] ?? 0)
		) {
			m += 1;
		} else {
			n += 1;
		}
	}
}

/**
 * Indexed monotonic matching for large gaps: originals are bucketed by an
 * equality-compatible canonical key, so every bucket member is structurally
 * equal to any new node with that key. Each bucket pointer only moves
 * forward to the first original at or after the cursor: O(N + M) bucket
 * operations, no candidate cutoff, and at most one verifying comparison per
 * matched new node (zero for unmatched ones).
 */
function matchGapIndexed(
	newNodes: readonly ProseMirrorNode[],
	origNodes: readonly ProseMirrorNode[],
	nodesMatch: NodeMatcher,
	matched: number[],
	newStart: number,
	newEnd: number,
	origStart: number,
	origEnd: number,
): void {
	const buckets = new Map<string, { indices: number[]; next: number }>();
	for (let o = origStart; o < origEnd; o += 1) {
		const node = origNodes[o];
		if (!node) continue;
		const key = canonicalKey(node);
		const bucket = buckets.get(key);
		if (bucket) bucket.indices.push(o);
		else buckets.set(key, { indices: [o], next: 0 });
	}
	let origCursor = origStart;
	for (let n = newStart; n < newEnd; n += 1) {
		const next = newNodes[n];
		const bucket = next ? buckets.get(canonicalKey(next)) : undefined;
		if (!next || !bucket) continue;
		const { indices } = bucket;
		while (
			bucket.next < indices.length &&
			(indices[bucket.next] ?? 0) < origCursor
		) {
			bucket.next += 1;
		}
		const o = indices[bucket.next] ?? -1;
		const orig = origNodes[o];
		// Defensive verification; equal keys already imply equality.
		if (orig && nodesMatch(next, orig)) {
			matched[n] = o;
			origCursor = o + 1;
			bucket.next += 1;
		}
	}
}

/** Structural matching inside one gap between identity anchors. */
function matchGap(
	newNodes: readonly ProseMirrorNode[],
	origNodes: readonly ProseMirrorNode[],
	nodesMatch: NodeMatcher,
	matched: number[],
	newStartIn: number,
	newEndIn: number,
	origStartIn: number,
	origEndIn: number,
): void {
	let newStart = newStartIn;
	let newEnd = newEndIn;
	let origStart = origStartIn;
	let origEnd = origEndIn;
	const same = (n: number, o: number): boolean => {
		const next = newNodes[n];
		const orig = origNodes[o];
		return next !== undefined && orig !== undefined && nodesMatch(next, orig);
	};
	while (
		newStart < newEnd &&
		origStart < origEnd &&
		same(newStart, origStart)
	) {
		matched[newStart] = origStart;
		newStart += 1;
		origStart += 1;
	}
	while (
		newStart < newEnd &&
		origStart < origEnd &&
		same(newEnd - 1, origEnd - 1)
	) {
		newEnd -= 1;
		origEnd -= 1;
		matched[newEnd] = origEnd;
	}
	const newLength = newEnd - newStart;
	const origLength = origEnd - origStart;
	if (newLength <= 0 || origLength <= 0) return;
	if (newLength * origLength <= DP_CELL_BUDGET) {
		matchGapExact(
			newNodes,
			origNodes,
			nodesMatch,
			matched,
			newStart,
			newLength,
			origStart,
			origLength,
		);
		return;
	}
	matchGapIndexed(
		newNodes,
		origNodes,
		nodesMatch,
		matched,
		newStart,
		newEnd,
		origStart,
		origEnd,
	);
}

/**
 * Monotonic new→original index alignment (-1 = no identical original).
 * Identity anchors are fixed first; structural equality only fills the
 * unanchored gaps (nodes recreated by real edits or Undo/Redo).
 */
export function alignNodes(
	newNodes: readonly ProseMirrorNode[],
	origNodes: readonly ProseMirrorNode[],
	nodesMatch: NodeMatcher,
): number[] {
	const newLen = newNodes.length;
	const matched = new Array<number>(newLen).fill(-1);
	anchorIdentities(newNodes, origNodes, matched);
	let prevNew = -1;
	let prevOrig = -1;
	for (let n = 0; n <= newLen; n += 1) {
		const o = n < newLen ? (matched[n] ?? -1) : origNodes.length;
		if (o < 0) continue;
		matchGap(
			newNodes,
			origNodes,
			nodesMatch,
			matched,
			prevNew + 1,
			n,
			prevOrig + 1,
			o,
		);
		prevNew = n;
		prevOrig = o;
	}
	return matched;
}

/**
 * Pair unmatched new entries with unmatched originals positionally when a gap
 * between two matched anchors has the same length on both sides (an in-place
 * edit). Matched entries keep their index; unpaired entries stay -1.
 */
export function pairUnmatched(
	matched: readonly number[],
	origLen: number,
): number[] {
	const paired = matched.slice();
	let idx = 0;
	while (idx < matched.length) {
		if ((matched[idx] ?? -1) >= 0) {
			idx += 1;
			continue;
		}
		const gapStart = idx;
		while (idx < matched.length && (matched[idx] ?? -1) < 0) {
			idx += 1;
		}
		const prevOrig = gapStart > 0 ? (matched[gapStart - 1] ?? -1) : -1;
		const nextOrig = idx < matched.length ? (matched[idx] ?? origLen) : origLen;
		if (nextOrig - prevOrig - 1 === idx - gapStart) {
			for (let k = gapStart; k < idx; k += 1) {
				paired[k] = prevOrig + 1 + (k - gapStart);
			}
		}
	}
	return paired;
}
