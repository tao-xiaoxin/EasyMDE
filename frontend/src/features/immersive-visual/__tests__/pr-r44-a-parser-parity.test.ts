import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it, vi } from "vitest";
import * as listPreservation from "../markdown-list-preservation";
import {
	parseMarkdownToVisualDoc,
	parseMarkdownWithBlockSources,
} from "../markdown-parser";
import { computeIntactRefDefLabels } from "../markdown-refdef-liveness";
import {
	addListUpstreamLabel,
	dropListUpstreamLabel,
	type LivenessState,
	type PendingListCheck,
	pendingListHeapPop,
	pendingListHeapPush,
} from "../markdown-refdef-liveness-state";
import {
	createMarkdownRoundTripGuard,
	serializeVisualDocToMarkdown,
} from "../markdown-serializer";
import { visualEditorSchema } from "../visual-schema";

// Every expected Markdown serialization and link title below was
// cross-verified against real PHP `EasyMDE\Content\MarkdownRenderer::render()`:
// each original and serialized document renders the same `<a title>` set.

function serializeOne(node: ProseMirrorNode): string {
	return serializeVisualDocToMarkdown(
		visualEditorSchema.nodes.doc.create(null, [node]),
	);
}

function collectLinkTitles(markdown: string): unknown[] {
	const titles: unknown[] = [];
	parseMarkdownToVisualDoc(markdown).descendants((node) => {
		const link = node.marks.find((m) => m.type.name === "link");
		if (link && node.isText) titles.push(link.attrs.title);
	});
	return titles;
}

function withChild(
	parent: ProseMirrorNode,
	idx: number,
	replacement: ProseMirrorNode | null,
): ProseMirrorNode {
	const children: ProseMirrorNode[] = [];
	for (let i = 0; i < parent.childCount; i += 1) {
		if (i !== idx) children.push(parent.child(i));
		else if (replacement) children.push(replacement);
	}
	return parent.type.create(parent.attrs, children);
}

function dropListItem(
	doc: ProseMirrorNode,
	listIdx: number,
	itemIdx: number,
): ProseMirrorNode {
	return withChild(doc, listIdx, withChild(doc.child(listIdx), itemIdx, null));
}

function replaceText(
	doc: ProseMirrorNode,
	needle: string,
	replacement: string,
): ProseMirrorNode {
	let found = -1;
	doc.descendants((node, pos) => {
		if (found >= 0 || !node.isText || !node.text) return found < 0;
		const idx = node.text.indexOf(needle);
		if (idx >= 0) {
			found = pos + idx;
			return false;
		}
		return true;
	});
	expect(found, `Could not find "${needle}" in doc`).toBeGreaterThanOrEqual(0);
	const state = EditorState.create({ doc, schema: visualEditorSchema });
	return state.apply(
		state.tr.insertText(replacement, found, found + needle.length),
	).doc;
}

function roundTrip(
	md: string,
	edit: (doc: ProseMirrorNode) => ProseMirrorNode,
): Readonly<{ partialTitleIntact: string[]; serialized: string }> {
	const parsed = parseMarkdownWithBlockSources(md);
	const guard = createMarkdownRoundTripGuard(md, parsed);
	const edited = edit(guard.initialDoc);
	const live = computeIntactRefDefLabels(edited, parsed, serializeOne);
	return {
		partialTitleIntact: [...live.partialTitleIntact],
		serialized: guard.serialize(edited),
	};
}

const CASCADE_DEAD_LIST = [
	"9. remove",
	"10. [dead]: /d",
	'    "td',
	"    ===",
	"11. [dead2]",
	"    p",
	"    ---",
].join("\n");
const CASCADE_DEAD_OUTPUT =
	'9. [dead]: /d\n   # "td\n10.\n    ## [dead2](/d2) p';

describe("PR-R44-A monotonic container risk dominance, unified list drain, heap siftDown, and helper dedup", () => {
	describe("1. Monotonic risk dominance on indented containers (Track B #1)", () => {
		it("1.1 P1A-AFTER: a matched indented list invalidated in Wave 2 stays canonical, keeping [p]'s PHP title", () => {
			const md = [
				"[dead2]: /d2",
				"",
				"-   [dead2]",
				"",
				"   9. [dead]",
				"   1. x",
				"",
				"   $$y$$ [p]: /u",
				'"t',
				"===",
				"",
				"sep",
				"",
				CASCADE_DEAD_LIST,
				"",
				"[link][p]",
			].join("\n");
			const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
				withChild(dropListItem(doc, 7, 0), 0, null),
			);
			expect(serialized).toBe(
				[
					"- [dead2](/d2)",
					"",
					'9. [dead](/d "td&#10;")',
					"10. x",
					"",
					"   $$y$$ [p]: /u",
					'"t',
					"===",
					"",
					"sep",
					"",
					CASCADE_DEAD_OUTPUT,
					"",
					"[link][p]",
				].join("\n"),
			);
			// Liveness keeps P alive exactly when the serializer keeps its
			// partial-title refdef verbatim (real PHP: title="t\n").
			expect(partialTitleIntact).toEqual(["P"]);
		});

		it("1.2 P1B-AFTER: a matched indented blockquote goes canonical and inlines [p]'s title", () => {
			const md = [
				"[dead2]: /d2",
				"",
				"-   [dead2]",
				"",
				"   > [dead]",
				"   >",
				"   > [p]: /u",
				'   > "t',
				"   > ===",
				"",
				"sep",
				"",
				CASCADE_DEAD_LIST,
				"",
				"[link][p]",
			].join("\n");
			const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
				withChild(dropListItem(doc, 4, 0), 0, null),
			);
			expect(serialized).toBe(
				[
					"- [dead2](/d2)",
					"",
					'> [dead](/d "td&#10;")',
					">",
					"> [p]: /u",
					">",
					'> # "t',
					"",
					"sep",
					"",
					CASCADE_DEAD_OUTPUT,
					"",
					'[link](/u "t&#10;")',
				].join("\n"),
			);
			expect(partialTitleIntact).toEqual([]);
			expect(collectLinkTitles(serialized)).toContain("t\n");
		});

		it("1.3 PROBE 1-PAIRED-BQ: a paired indented blockquote with an unedited head goes canonical", () => {
			const md = [
				"[dead2]: /d2",
				"",
				"sep0",
				"",
				"-   [dead2]",
				"",
				"   > [dead]",
				"   >",
				"   > [p]: /u",
				'   > "t',
				"   > ===",
				"   >",
				"   > gamma",
				"",
				"sep1",
				"",
				CASCADE_DEAD_LIST,
				"",
				"[link][p]",
			].join("\n");
			const { partialTitleIntact, serialized } = roundTrip(md, (doc0) => {
				const doc = replaceText(doc0, "gamma", "delta");
				return withChild(dropListItem(doc, doc.childCount - 2, 0), 0, null);
			});
			expect(serialized).toBe(
				[
					"sep0",
					"",
					"- [dead2](/d2)",
					"",
					'> [dead](/d "td&#10;")',
					">",
					"> [p]: /u",
					">",
					'> # "t',
					">",
					"> delta",
					"",
					"sep1",
					"",
					CASCADE_DEAD_OUTPUT,
					"",
					'[link](/u "t&#10;")',
				].join("\n"),
			);
			expect(partialTitleIntact).toEqual([]);
			expect(collectLinkTitles(serialized)).toContain("t\n");
		});
	});

	describe("2. Unified Pass-2 list re-validation via resolveAuthoritativeListPreservation (Track A #1-#2, Track B #2-#3)", () => {
		it("2.1 Track A #1: an unordered list's allowShift=false fallback canonicalizes [p] and inlines its title", () => {
			const md =
				'[d]: /d\n\n-   [d]\n  - [p]: /p\n    "t\n    ===\n  - [c]\n    p\n    ---\n\n[c]: /c\n"[d]" x\n\n[p]';
			const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
				withChild(doc, 0, null),
			);
			expect(serialized).toBe(
				'- [d](/d)\n- [p]: /p\n  # "t\n-\n  ## [c](/c "[d]") p\n\n[c]: /c\n"[d](/d)" x\n\n[p](/p "t&#10;")',
			);
			expect(partialTitleIntact).toEqual([]);
			expect(collectLinkTitles(serialized)).toContain("t\n");
		});

		it("2.2 Track B #2 PROBE 4D-SEP: a paired list's whole-list fallback canonicalizes the shifted [p] item", () => {
			const md =
				'[d]: /d\n\nsep\n\n1. a\n2.   [d]\n   3. [p]: /p\n      "t\n      ===\n10. [d]\n    p\n    ---\n11. alpha\n\n[link][p]';
			const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
				replaceText(withChild(doc, 0, null), "alpha", "beta"),
			);
			expect(serialized).toBe(
				'sep\n\n1. a\n2. [d](/d)\n3. [p]: /p\n   # "t\n4.\n   ## [d](/d) p\n5. beta\n\n[link](/p "t&#10;")',
			);
			expect(partialTitleIntact).toEqual([]);
			expect(collectLinkTitles(serialized)).toContain("t\n");
		});

		it("2.3 Track B #3 PROBE 2 WAVE 2: a first item without candidates still tracks the indented [p] item", () => {
			const md = [
				"[d0]: /d0",
				"",
				"9. remove",
				"10. [d]: /d",
				'    "td',
				"    ===",
				"11. [d0]",
				"    p",
				"    ---",
				"",
				"sep",
				"",
				"9. remove",
				"10.   a",
				"   11. [p]: /p",
				'       "t',
				"       ===",
				"       q",
				"lazy",
				"12. [d]",
				"    p",
				"    ---",
				"13. end",
				"",
				"[link][p]",
			].join("\n");
			const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
				withChild(dropListItem(dropListItem(doc, 3, 0), 1, 0), 0, null),
			);
			expect(serialized).toBe(
				[
					'9. [d]: /d\n   # "td\n10.\n    ## [d0](/d0) p',
					"sep",
					'9. a\n10. [p]: /p\n    # "t\n    q\n    lazy\n11.\n    ## [d](/d "td&#10;") p\n13. end',
					'[link](/p "t&#10;")',
				].join("\n\n"),
			);
			expect(partialTitleIntact).toEqual([]);
			expect(collectLinkTitles(serialized)).toContain("t\n");
		});

		it("2.4 Track A #2: K invalidated indented siblings re-validate the list O(1) times with linear time (K = 80, 160, 320)", () => {
			const timings: number[] = [];
			for (const k of [80, 160, 320] as const) {
				const lines = ["-   [d]: /d", '    "t', "    ==="];
				for (let i = 0; i < k; i += 1) lines.push("  - [d]");
				const md = `${lines.join("\n")}\n\n[link][d]`;
				const guard = createMarkdownRoundTripGuard(
					md,
					parseMarkdownWithBlockSources(md),
				);
				const list = guard.initialDoc.child(0);
				const item0 = list.child(0);
				let refDefIdx = 0;
				while (item0.child(refDefIdx).type.name !== "protected_block") {
					refDefIdx += 1;
				}
				const edited = withChild(
					guard.initialDoc,
					0,
					withChild(list, 0, withChild(item0, refDefIdx, null)),
				);
				const editedList = edited.child(0);
				const spy = vi.spyOn(
					listPreservation,
					"resolveAuthoritativeListPreservation",
				);
				try {
					const startedAt = performance.now();
					const serialized = guard.serialize(edited);
					timings.push(performance.now() - startedAt);
					let livenessCalls = 0;
					for (const call of spy.mock.calls) {
						if (call[0] === editedList && call[7] === false) {
							livenessCalls += 1;
						}
					}
					// Pass-1 resolution + ONE drain re-validation, independent of K.
					expect(livenessCalls).toBeLessThanOrEqual(2);
					expect(serialized).toBe(
						`-\n  # "t\n${'- [d](/d "t&#10;")\n'.repeat(k)}\n[link](/d "t&#10;")`,
					);
					expect(collectLinkTitles(serialized)).toEqual(
						new Array<string>(k + 1).fill("t\n"),
					);
				} finally {
					spy.mockRestore();
				}
			}
			expect(timings[2] ?? 0).toBeLessThan(1000);
		});
	});

	describe("3. Pending-list min-heap invariant and topological drain order (Track B #4)", () => {
		function fakeCheck(nodeSize: number): PendingListCheck {
			return {
				downgradeItem: () => undefined,
				firstEmittedSlice: null,
				heapIndex: -1,
				isSink: false,
				itemReusable: [],
				itemTasks: [],
				listNode: visualEditorSchema.nodes.paragraph.create(
					null,
					visualEditorSchema.text("x".repeat(nodeSize)),
				),
				liveUpstreamCount: 0,
				notifyTailChange: () => undefined,
				ownLabels: [],
				pendingUpstreamCount: 0,
				// Heap ordering never reads the list preservation plan.
				prepared: undefined as unknown as PendingListCheck["prepared"],
				refCountByUpstreamLabel: new Map<string, number>(),
				tracksValidation: true,
			};
		}

		it("3.1 drop + add of a queued list's upstream label sifts it back down (U0 pops before BIG)", () => {
			const st = {
				invalidatedLabels: new Set<string>(),
				pendingListHeap: [] as PendingListCheck[],
				producerListByLabel: new Map<string, PendingListCheck>(),
				upstreamListsByLabel: new Map<string, Set<PendingListCheck>>(),
			} as unknown as LivenessState;
			const u0 = fakeCheck(800);
			const big = fakeCheck(50);
			addListUpstreamLabel(st, big, "u1");
			pendingListHeapPush(st, u0);
			pendingListHeapPush(st, big);
			dropListUpstreamLabel(st, big, "u1");
			expect(st.pendingListHeap[0]).toBe(big);
			addListUpstreamLabel(st, big, "u1");
			expect(st.pendingListHeap[0]).toBe(u0);
			expect(st.pendingListHeap.map((c) => c.heapIndex)).toEqual([0, 1]);
			expect(pendingListHeapPop(st)).toBe(u0);
			expect(pendingListHeapPop(st)).toBe(big);
			expect(pendingListHeapPop(st)).toBeUndefined();
		});

		function drainOrder(md: string): Readonly<{
			order: number[];
			serialized: string;
		}> {
			const guard = createMarkdownRoundTripGuard(
				md,
				parseMarkdownWithBlockSources(md),
			);
			const doc = guard.initialDoc;
			const children: ProseMirrorNode[] = [];
			const lists: ProseMirrorNode[] = [];
			for (let i = 1; i < doc.childCount; i += 1) {
				const child = doc.child(i);
				if (child.type.name !== "ordered_list") {
					children.push(child);
					continue;
				}
				const nextList = withChild(child, 0, null);
				children.push(nextList);
				lists.push(nextList);
			}
			const spy = vi.spyOn(
				listPreservation,
				"resolveAuthoritativeListPreservation",
			);
			try {
				const serialized = guard.serialize(doc.type.create(null, children));
				const order: number[] = [];
				for (const call of spy.mock.calls) {
					if (call[7] === false) order.push(lists.indexOf(call[0]));
				}
				return { order, serialized };
			} finally {
				spy.mockRestore();
			}
		}

		const bigPad: string[] = [];
		for (let p = 0; p < 60; p += 1) {
			bigPad.push(`${14 + p}. bigpad_${p}_extra_text_for_large_nodesize`);
		}
		const upstreamLists = [
			"sepU1",
			'9. remove\n10. [u1]: /u1\n    "tu1\n    ===\n11. [u2]\n    p\n    ---',
			"sepU2",
			'9. remove\n10. [u2]: /u2\n    "tu2\n    ===\n11. [u1]\n    p\n    ---',
		];
		const bigList = [
			"9. remove",
			'10. [big]: /big\n    "tbig\n    ===',
			"11. [c0]",
			'12. [c0]\n\n    > [b1]: /b1\n    > "Tb1 [u1]" x\n\n    - [b2]: /b2\n      "Tb2 [u2]" y',
			...bigPad,
		].join("\n");

		it("3.2 PROBE 3A: M (liveUpstream=1) drains before BIG (liveUpstream=2), each exactly once", () => {
			const md = [
				"[c0]: /c0",
				...upstreamLists,
				"sepM",
				'9. remove\n10. [m]: /m\n    "tm\n    ===\n11. [c0]\n12. [u1]',
				"sepBig",
				bigList,
				"[u1] [u2] [m] [big] [b1] [b2]",
			].join("\n\n");
			const { order, serialized } = drainOrder(md);
			// Pass 1 opens L0..L3 in document order; the drain then pops M (L2)
			// strictly before BIG (L3).
			expect(order).toEqual([0, 1, 2, 3, 2, 3]);
			expect(collectLinkTitles(serialized)).toEqual(collectLinkTitles(md));
		});

		it("3.3 PROBE 3B: ZERO (liveUpstream=0, sink) drains before BIG (liveUpstream=2)", () => {
			const md = [
				"[c0]: /c0",
				...upstreamLists,
				"sepZero",
				'9. remove\n10. [z]: /z\n    "tz\n    ===\n11. [c0]',
				"sepBig",
				bigList,
				"[u1] [u2] [big] [b1] [b2]",
			].join("\n\n");
			const { order, serialized } = drainOrder(md);
			expect(order).toEqual([0, 1, 2, 3, 2, 3]);
			expect(collectLinkTitles(serialized)).toEqual(collectLinkTitles(md));
		});

		it("3.4 PROBE 3C: U0 (liveUpstream=0) drains before BIG, which re-validates exactly once", () => {
			const padU0: string[] = [];
			for (let p = 0; p < 20; p += 1) {
				padU0.push(`${12 + p}. pad${p}makingu0biggerthanbig`);
			}
			const md = [
				"[c0]: /c0",
				"sepU0",
				[
					"9. remove",
					'10. [u1]: /u1\n    "tu1\n    ===',
					"11. [c0] MARKERU0\n    p\n    ---",
					...padU0,
				].join("\n"),
				"sepBig",
				[
					"9. remove",
					'10. [big]: /big\n    "tbig\n    ===',
					"11. [c0] MARKERBIG",
					'12. [c0]\n    > [b1]: /b1\n    > "Tb1 [u1]" x',
				].join("\n"),
				"[u1] [big] [b1]",
			].join("\n\n");
			const { order, serialized } = drainOrder(md);
			expect(order).toEqual([0, 1, 0, 1]);
			expect(collectLinkTitles(serialized)).toEqual(collectLinkTitles(md));
		});
	});
});
