import {
	mathSpanAcceptedDomSources,
	normalizeLineEndingsToLf,
	VISUAL_MARKDOWN_SOURCE_ATTRIBUTE,
} from "../../shared/markdown/normalize-math-tex";
import { mathElementMatchesSource } from "./generated-content-target";

/**
 * Canonical strictly O(D + S) bidirectional math pairing between rendered
 * `.easymde-math` DOM roots and Markdown math spans, shared by both Live
 * Preview and Immersive Visual surfaces.
 */

export type MathPairingSpan = Readonly<{
	bodyFrom: number;
	bodyTo: number;
	displayMode: boolean;
	from: number;
	to: number;
}>;

export type MathPairingContext = Readonly<{
	domCount: number;
	pairDomIndexToSpanIndex: (domIndex: number) => number | null;
	pairSpanIndexToDomIndex: (spanIndex: number) => number | null;
	spanCount: number;
}>;

type MathSpanView = Readonly<{
	body: string;
	displayMode: boolean;
	full: string;
}>;

function isValidMathSpanBounds(
	sourceLength: number,
	span: MathPairingSpan,
): boolean {
	return (
		span.from >= 0 &&
		span.from < span.to &&
		span.bodyFrom >= span.from &&
		span.bodyTo <= span.to &&
		span.bodyFrom <= span.bodyTo &&
		span.to <= sourceLength
	);
}

function buildMathSpanView(source: string, span: MathPairingSpan): MathSpanView {
	return {
		body: source.slice(span.bodyFrom, span.bodyTo),
		displayMode: span.displayMode,
		full: source.slice(span.from, span.to),
	};
}

function pairingKey(displayMode: boolean, normalizedSource: string): string {
	return `${displayMode ? "1" : "0"}\0${normalizedSource}`;
}

function rootPairingKeys(root: Element): ReadonlyArray<string> | null {
	const raw = root.getAttribute(VISUAL_MARKDOWN_SOURCE_ATTRIBUTE);
	if (null === raw) return null;
	const domNorm = normalizeLineEndingsToLf(raw);
	const isBlock = root.classList.contains("easymde-math-block");
	const isInline = root.classList.contains("easymde-math-inline");
	if (isBlock && isInline) return [];
	if (isBlock) return [pairingKey(true, domNorm)];
	if (isInline) return [pairingKey(false, domNorm)];
	return [pairingKey(true, domNorm), pairingKey(false, domNorm)];
}

function pushToMapArray(
	map: Map<string, number[]>,
	key: string,
	value: number,
): void {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

/**
 * Builds a reusable O(D + S) bidirectional math pairing context for a block
 * (or visual document):
 * - `renderedRoots.length > spans.length`: fails closed (`null`) because the
 *   source index missed a rendered formula.
 * - `renderedRoots.length === spans.length`: O(1) direct 1:1 ordinal pairing
 *   verified by `mathElementMatchesSource()`.
 * - `renderedRoots.length < spans.length` (e.g. WordPress 6.7 `wp_kses`
 *   stripping an attribute-embedded formula): requires `renderedRoots.length > 0`,
 *   explicit `VISUAL_MARKDOWN_SOURCE_ATTRIBUTE` on every root, and indexes
 *   spans and roots by `(displayMode, acceptedSource)` in O(D + S). Each
 *   queried index resolves its connected equivalence class via BFS and checks
 *   complete-bipartite closure (`edgeCount === |R| * |S|`) plus equal
 *   cardinality (`|R| === |S|`) in linear time without O(D * S) scans.
 */
export function createMathPairingContext(
	source: string,
	renderedRoots: ReadonlyArray<Element>,
	spans: ReadonlyArray<MathPairingSpan>,
): MathPairingContext | null {
	const domCount = renderedRoots.length;
	const spanCount = spans.length;
	if (domCount > spanCount) return null;
	for (let i = 0; i < spanCount; i += 1) {
		const span = spans[i];
		if (!span || !isValidMathSpanBounds(source.length, span)) return null;
	}

	if (domCount === spanCount) {
		const matchAtOrdinal = (index: number): number | null => {
			if (!Number.isSafeInteger(index) || index < 0 || index >= domCount) {
				return null;
			}
			const root = renderedRoots[index];
			const span = spans[index];
			if (!root || !span) return null;
			return mathElementMatchesSource(root, buildMathSpanView(source, span))
				? index
				: null;
		};
		return {
			domCount,
			pairDomIndexToSpanIndex: matchAtOrdinal,
			pairSpanIndexToDomIndex: matchAtOrdinal,
			spanCount,
		};
	}

	if (0 === domCount) return null;

	const rootKeys: Array<ReadonlyArray<string>> = new Array(domCount);
	const rootsByKey = new Map<string, number[]>();
	for (let dIdx = 0; dIdx < domCount; dIdx += 1) {
		const root = renderedRoots[dIdx];
		if (!root) return null;
		const keys = rootPairingKeys(root);
		if (null === keys) return null;
		rootKeys[dIdx] = keys;
		for (let k = 0; k < keys.length; k += 1) {
			const key = keys[k];
			if (undefined !== key) pushToMapArray(rootsByKey, key, dIdx);
		}
	}

	const spanKeys: Array<ReadonlyArray<string>> = new Array(spanCount);
	const spansByKey = new Map<string, number[]>();
	const keysBySpanSignature = new Map<string, ReadonlyArray<string>>();
	for (let sIdx = 0; sIdx < spanCount; sIdx += 1) {
		const span = spans[sIdx];
		if (!span) return null;
		const view = buildMathSpanView(source, span);
		const signature = `${view.displayMode ? "1" : "0"}\0${view.full}\0${view.body}`;
		let keys = keysBySpanSignature.get(signature);
		if (!keys) {
			const accepted = mathSpanAcceptedDomSources(
				view.full,
				view.body,
				view.displayMode,
			);
			const computed: string[] = new Array(accepted.length);
			for (let a = 0; a < accepted.length; a += 1) {
				computed[a] = pairingKey(view.displayMode, accepted[a] ?? "");
			}
			keys = computed;
			keysBySpanSignature.set(signature, keys);
		}
		for (let k = 0; k < keys.length; k += 1) {
			const key = keys[k];
			if (undefined !== key) pushToMapArray(spansByKey, key, sIdx);
		}
		spanKeys[sIdx] = keys;
	}

	const domToSpan = new Map<number, number | null>();
	const spanToDom = new Map<number, number | null>();

	const resolveComponent = (
		seedKind: "dom" | "span",
		seedIndex: number,
	): number | null => {
		if ("dom" === seedKind) {
			if (!Number.isSafeInteger(seedIndex) || seedIndex < 0 || seedIndex >= domCount) {
				return null;
			}
			if (domToSpan.has(seedIndex)) return domToSpan.get(seedIndex) ?? null;
		} else {
			if (!Number.isSafeInteger(seedIndex) || seedIndex < 0 || seedIndex >= spanCount) {
				return null;
			}
			if (spanToDom.has(seedIndex)) return spanToDom.get(seedIndex) ?? null;
		}

		const domQueue: number[] = [];
		const spanQueue: number[] = [];
		const visitedDoms = new Set<number>();
		const visitedSpans = new Set<number>();
		const componentKeys = new Set<string>();
		const expandedSpansForKey = new Set<string>();
		const expandedDomsForKey = new Set<string>();

		if ("dom" === seedKind) {
			visitedDoms.add(seedIndex);
			domQueue.push(seedIndex);
		} else {
			visitedSpans.add(seedIndex);
			spanQueue.push(seedIndex);
		}

		let domHead = 0;
		let spanHead = 0;
		while (domHead < domQueue.length || spanHead < spanQueue.length) {
			while (domHead < domQueue.length) {
				const dIdx = domQueue[domHead];
				domHead += 1;
				if (undefined === dIdx) continue;
				const keys = rootKeys[dIdx] ?? [];
				for (let k = 0; k < keys.length; k += 1) {
					const key = keys[k];
					if (undefined === key) continue;
					const adjSpans = spansByKey.get(key);
					if (!adjSpans || 0 === adjSpans.length) continue;
					componentKeys.add(key);
					if (expandedSpansForKey.has(key)) continue;
					expandedSpansForKey.add(key);
					for (let i = 0; i < adjSpans.length; i += 1) {
						const sIdx = adjSpans[i];
						if (undefined !== sIdx && !visitedSpans.has(sIdx)) {
							visitedSpans.add(sIdx);
							spanQueue.push(sIdx);
						}
					}
				}
			}
			while (spanHead < spanQueue.length) {
				const sIdx = spanQueue[spanHead];
				spanHead += 1;
				if (undefined === sIdx) continue;
				const keys = spanKeys[sIdx] ?? [];
				for (let k = 0; k < keys.length; k += 1) {
					const key = keys[k];
					if (undefined === key) continue;
					const adjDoms = rootsByKey.get(key);
					if (!adjDoms || 0 === adjDoms.length) continue;
					componentKeys.add(key);
					if (expandedDomsForKey.has(key)) continue;
					expandedDomsForKey.add(key);
					for (let i = 0; i < adjDoms.length; i += 1) {
						const dIdx = adjDoms[i];
						if (undefined !== dIdx && !visitedDoms.has(dIdx)) {
							visitedDoms.add(dIdx);
							domQueue.push(dIdx);
						}
					}
				}
			}
		}

		// Every edge (d, s) shares exactly one (displayMode, domNorm) key, so
		// summing |rootsByKey[k]| * |spansByKey[k]| over component keys gives
		// the exact component edge count. Complete bipartiteness holds iff
		// edgeCount === |R| * |S|.
		let edgeCount = 0;
		for (const key of componentKeys) {
			const rLen = rootsByKey.get(key)?.length ?? 0;
			const sLen = spansByKey.get(key)?.length ?? 0;
			edgeCount += rLen * sLen;
		}

		const isCompleteEqualClass =
			domQueue.length > 0 &&
			domQueue.length === spanQueue.length &&
			edgeCount === domQueue.length * spanQueue.length;

		if (!isCompleteEqualClass) {
			for (let i = 0; i < domQueue.length; i += 1) {
				const dIdx = domQueue[i];
				if (undefined !== dIdx) domToSpan.set(dIdx, null);
			}
			for (let i = 0; i < spanQueue.length; i += 1) {
				const sIdx = spanQueue[i];
				if (undefined !== sIdx) spanToDom.set(sIdx, null);
			}
			return null;
		}

		let orderedDoms: ReadonlyArray<number>;
		let orderedSpans: ReadonlyArray<number>;
		if (1 === componentKeys.size) {
			const onlyKey = componentKeys.values().next().value;
			orderedDoms =
				undefined !== onlyKey ? (rootsByKey.get(onlyKey) ?? domQueue) : domQueue;
			orderedSpans =
				undefined !== onlyKey
					? (spansByKey.get(onlyKey) ?? spanQueue)
					: spanQueue;
		} else {
			domQueue.sort((a, b) => a - b);
			spanQueue.sort((a, b) => a - b);
			orderedDoms = domQueue;
			orderedSpans = spanQueue;
		}

		for (let i = 0; i < orderedDoms.length; i += 1) {
			const dIdx = orderedDoms[i];
			const sIdx = orderedSpans[i];
			if (undefined !== dIdx && undefined !== sIdx) {
				domToSpan.set(dIdx, sIdx);
				spanToDom.set(sIdx, dIdx);
			}
		}

		return "dom" === seedKind
			? (domToSpan.get(seedIndex) ?? null)
			: (spanToDom.get(seedIndex) ?? null);
	};

	return {
		domCount,
		pairDomIndexToSpanIndex: (domIndex) => resolveComponent("dom", domIndex),
		pairSpanIndexToDomIndex: (spanIndex) => resolveComponent("span", spanIndex),
		spanCount,
	};
}

/**
 * Pairs a rendered `.easymde-math` DOM root (`domIndex`) to its canonical
 * Markdown math span index in strictly O(D + S) time.
 */
export function pairMathDomIndexToSpanIndex(
	source: string,
	renderedRoots: ReadonlyArray<Element>,
	spans: ReadonlyArray<MathPairingSpan>,
	domIndex: number,
): number | null {
	return (
		createMathPairingContext(source, renderedRoots, spans)?.pairDomIndexToSpanIndex(
			domIndex,
		) ?? null
	);
}

/**
 * Symmetric inverse of `pairMathDomIndexToSpanIndex`: maps a selected Markdown
 * math `spanIndex` to its rendered `.easymde-math` DOM root index in strictly
 * O(D + S) time.
 */
export function pairMathSpanIndexToDomIndex(
	source: string,
	renderedRoots: ReadonlyArray<Element>,
	spans: ReadonlyArray<MathPairingSpan>,
	spanIndex: number,
): number | null {
	return (
		createMathPairingContext(source, renderedRoots, spans)?.pairSpanIndexToDomIndex(
			spanIndex,
		) ?? null
	);
}
