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

// Every original document and expected serialization below was rendered with
// real PHP `EasyMDE\Content\MarkdownRenderer::render()`: each pair produces
// the same `<a href title>` set (except where a test states otherwise).

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

function dropChildAt(
	doc: ProseMirrorNode,
	containerIdx: number,
	childIdx: number,
): ProseMirrorNode {
	return withChild(
		doc,
		containerIdx,
		withChild(doc.child(containerIdx), childIdx, null),
	);
}

function dropLeading(doc: ProseMirrorNode, count: number): ProseMirrorNode {
	let next = doc;
	for (let i = 0; i < count; i += 1) next = withChild(next, 0, null);
	return next;
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

const S4_HEAD = "[ok]: /ok\n\n[d]: /d\n\n-   [p0]\n\n";
const S4_LIST = (thirdItem: string): string =>
	[
		"1.  remove",
		"",
		"    extra",
		"  10. [p0]: /p0",
		'      "t0',
		"      ===",
		thirdItem,
		"   3. [p1]: /p1",
		'      "[ok]" x',
		"lazy",
		"4. [p2]: /p2",
		'   "t2',
		"   ===",
	].join("\n");
const S4_USES = "\n\n[link0][p0] [link1][p1] [link2][p2]";

describe("PR-R45-A immutable matched container head line, stabilized list reuse, and active-producer drain order", () => {
	describe("1. One immutable Pass-1 matched head line (Track B #1 + #2)", () => {
		it("1.1 PROBE S1: a deleted identical list child(0) anchors the new head to the indented item; both sides go canonical", () => {
			const md =
				'[dead]: /d\n\n+   [dead]\n\n-   x\n  - x\n  - [p]: /u\n    "t\n    ===\n\n[link][p]';
			const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
				withChild(dropChildAt(doc, 2, 0), 0, null),
			);
			expect(serialized).toBe(
				'+ [dead](/d)\n\n- x\n- [p]: /u\n  # "t\n\n[link](/u "t&#10;")',
			);
			expect(partialTitleIntact).toEqual([]);
			expect(collectLinkTitles(serialized)).toContain("t\n");
		});

		it("1.2 PROBE S2: the same deletion inside a blockquote goes canonical and inlines [p]'s title", () => {
			const md =
				'[dead]: /d\n\n-   [dead]\n\n> x\n>\n  > x\n  >\n  > [p]: /u\n  > "t\n  > ===\n\n[link][p]';
			const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
				withChild(dropChildAt(doc, 2, 0), 0, null),
			);
			expect(serialized).toBe(
				'- [dead](/d)\n\n> x\n>\n> [p]: /u\n>\n> # "t\n\n[link](/u "t&#10;")',
			);
			expect(partialTitleIntact).toEqual([]);
			expect(collectLinkTitles(serialized)).toContain("t\n");
		});

		it("1.3 PROBE S5-MASTERPIECE: a head matched to indented orig.child(1) is risky independent of the wave [dead2] dies in", () => {
			const md = [
				"[dead]: /d",
				"[dead2]: /d2",
				"[dead3]: /d3",
				"-   [dead]",
				[
					"1.  remove",
					"  2. [dead2]",
					"3. a\n4. b\n5. c\n6. d\n7. e\n8. f\n9. g",
					"9.    [dead3]",
					"   1. tail",
					"   > [p]: /u",
					'   > "t',
					"   > ===",
				].join("\n"),
				"[link][p]",
			].join("\n\n");
			const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
				dropLeading(dropChildAt(doc, 4, 0), 3),
			);
			expect(serialized).toBe(
				[
					"- [dead](/d)",
					"1. [dead2](/d2)\n2. a\n3. b\n4. c\n5. d\n6. e\n7. f\n8. g\n9. [dead3](/d3)\n10. tail",
					'   > [p]: /u\n   > "t\n   > ===',
					"[link][p]",
				].join("\n\n"),
			);
			// The verbatim partial-title refdef keeps [link][p]'s PHP title.
			expect(partialTitleIntact).toEqual(["P"]);
		});

		it("1.4 PROBE S12-SIMPLE: an indented `  - [dead2]` head with tracksValidation=false agrees with the serializer", () => {
			const md =
				'[dead2]: /d2\n\n+   [dead2]\n\n-   remove\n  - [dead2]\n- [p]: /u\n  "t\n  ===\n\n[link][p]';
			const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
				withChild(dropChildAt(doc, 2, 0), 0, null),
			);
			expect(serialized).toBe(
				'+ [dead2](/d2)\n\n- [dead2](/d2)\n- [p]: /u\n  # "t\n\n[link](/u "t&#10;")',
			);
			expect(partialTitleIntact).toEqual([]);
			expect(collectLinkTitles(serialized)).toContain("t\n");
		});
	});

	describe("2. Stabilize trailing items before committing item 0 (Track B #3)", () => {
		it("2.1 PROBE S4-MASTERPIECE (Pass 2): [p2]'s title survives after downgrading the [p1] item first", () => {
			const md = `${S4_HEAD}${S4_LIST("2.    [d]")}${S4_USES}`;
			const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
				withChild(dropChildAt(doc, 3, 0), 1, null),
			);
			expect(serialized).toBe(
				[
					"[ok]: /ok",
					'- [p0](/p0 "t0&#10;")',
					'1. [p0]: /p0\n\n   # "t0',
					"2. [d](/d)",
					'3. [p1]: /p1\n\n   "[ok](/ok)" x\n   lazy',
					'4. [p2]: /p2\n\n   # "t2',
					'[link0](/p0 "t0&#10;") [link1](/p1 "[ok]") [link2](/p2 "t2&#10;")',
				].join("\n\n"),
			);
			expect(partialTitleIntact).toEqual([]);
		});

		it("2.2 PROBE S4-PASS1-OPENLIST (Pass 1): the verbatim [p2] refdef keeps its PHP title", () => {
			const md = `${S4_HEAD}${S4_LIST("2.    a")}${S4_USES}`;
			const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
				replaceText(dropChildAt(doc, 3, 0), "a", "b"),
			);
			// PHP renders `<a href="/p2" title="t2&#10;">link2</a>` for both
			// documents. (`[p1]` follows the pre-existing visual-parser view.)
			expect(serialized).toBe(
				[
					"[ok]: /ok",
					"[d]: /d",
					"-   [p0]",
					'  1. [p0]: /p0\n     "t0\n     ===\n2. b\n3. [p1]: /p1\n\n   "[ok](/ok)" x\n   lazy\n4. [p2]: /p2\n   "t2\n   ===',
					'[link0][p0] [link1](/p1 "[ok]") [link2][p2]',
				].join("\n\n"),
			);
			expect(partialTitleIntact).toEqual(["P0", "P2"]);
		});
	});

	describe("3. Exact active-producer topological drain order (Track A #1 + #2)", () => {
		function fakeCheck(
			nodeSize: number,
			ownLabels: string[],
			liveUpstreamCount: number,
		): PendingListCheck {
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
				liveUpstreamCount,
				notifyTailChange: () => undefined,
				ownLabels,
				pendingUpstreamCount: 0,
				// Heap ordering never reads the list preservation plan.
				prepared: undefined as unknown as PendingListCheck["prepared"],
				refCountByUpstreamLabel: new Map<string, number>(),
				tracksValidation: true,
			};
		}

		it("3.1 a queued producer outranks its downstream list regardless of liveUpstreamCount", () => {
			const st = {
				invalidatedLabels: new Set<string>(),
				pendingListHeap: [] as PendingListCheck[],
				producerListByLabel: new Map<string, PendingListCheck>(),
				upstreamListsByLabel: new Map<string, Set<PendingListCheck>>(),
			} as unknown as LivenessState;
			const producer = fakeCheck(500, ["u"], 2);
			const downstream = fakeCheck(10, [], 0);
			st.producerListByLabel.set("u", producer);
			addListUpstreamLabel(st, downstream, "u");
			pendingListHeapPush(st, downstream);
			expect(downstream.pendingUpstreamCount).toBe(0);
			pendingListHeapPush(st, producer);
			expect(downstream.pendingUpstreamCount).toBe(1);
			expect(st.pendingListHeap[0]).toBe(producer);
			expect(pendingListHeapPop(st)).toBe(producer);
			expect(downstream.pendingUpstreamCount).toBe(0);
			expect(pendingListHeapPop(st)).toBe(downstream);
			expect(pendingListHeapPop(st)).toBeUndefined();
		});

		function producerScenario(count: number, refs: string): string {
			const parts = ["[c]: /c", '[s]: /s\n"ts\n===', '[y]: /y\n"ty\n==='];
			for (let i = 0; i < count; i += 1) {
				parts.push(
					`sepO${i}`,
					`9. remove\n10. [u${i}]: /u${i}\n    "tu${i}\n    ===\n11. [c]\n    p\n    ---\n12. ${refs}`,
				);
			}
			const items = ["- bee", "-   [c]"];
			const uses = ["[s] [y]"];
			for (let i = 0; i < count; i += 1) {
				items.push(`  - [u${i}]`);
				uses.push(`[u${i}]`);
			}
			parts.push("sepU", items.join("\n"), uses.join(" "));
			return parts.join("\n\n");
		}

		function drainProducers(md: string): Readonly<{
			downstreamCalls: number;
			elapsed: number;
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
				let next = child;
				if (child.type.name === "ordered_list") {
					next = withChild(child, 0, null);
				} else if (child.type.name === "bullet_list") {
					const item0 = child.child(0);
					const para = item0.child(0);
					next = withChild(
						child,
						0,
						item0.type.create(item0.attrs, [
							para.type.create(para.attrs, visualEditorSchema.text("bee2")),
						]),
					);
				}
				if (next !== child) lists.push(next);
				children.push(next);
			}
			const spy = vi.spyOn(
				listPreservation,
				"resolveAuthoritativeListPreservation",
			);
			try {
				const startedAt = performance.now();
				const serialized = guard.serialize(doc.type.create(null, children));
				const elapsed = performance.now() - startedAt;
				const order: number[] = [];
				for (const call of spy.mock.calls) {
					if (call[7] === false) order.push(lists.indexOf(call[0]));
				}
				const downstreamIdx = lists.length - 1;
				return {
					downstreamCalls: order.filter((i) => i === downstreamIdx).length,
					elapsed,
					order,
					serialized,
				};
			} finally {
				spy.mockRestore();
			}
		}

		it("3.2 Track A #1: `[s]` on the ordered list drains ordered -> unordered, each re-validated once", () => {
			const md = producerScenario(1, "[s]");
			const { order, serialized } = drainProducers(md);
			// Pass 1 opens [ordered, unordered]; the drain pops the producer first.
			expect(order).toEqual([0, 1, 0, 1]);
			expect(collectLinkTitles(serialized)).toEqual(collectLinkTitles(md));
		});

		it("3.3 Track A #2: static `[s], [y]` never outrank the queued producer of [u]", () => {
			const md = producerScenario(1, "[s], [y]");
			const { downstreamCalls, order, serialized } = drainProducers(md);
			expect(order).toEqual([0, 1, 0, 1]);
			expect(downstreamCalls).toBe(2);
			expect(collectLinkTitles(serialized)).toEqual(collectLinkTitles(md));
		});

		it("3.4 Track A #2 scaled: 80 upstream lists + 80-item downstream list -> downstream parses exactly twice", () => {
			const md = producerScenario(80, "[s], [y]");
			const { downstreamCalls, elapsed, order, serialized } =
				drainProducers(md);
			// 1 Pass-1 resolution + 1 Pass-2 drain for the downstream list.
			expect(downstreamCalls).toBe(2);
			expect(order).toHaveLength(162);
			expect(order[order.length - 1]).toBe(80);
			expect(collectLinkTitles(serialized)).toEqual(collectLinkTitles(md));
			expect(elapsed).toBeLessThan(5000);
		});
	});
});
