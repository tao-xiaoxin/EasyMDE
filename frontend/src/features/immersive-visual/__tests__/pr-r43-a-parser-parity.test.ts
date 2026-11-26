import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it, vi } from "vitest";
import * as listPreservation from "../markdown-list-preservation";
import {
	parseMarkdownToVisualDoc,
	parseMarkdownWithBlockSources,
} from "../markdown-parser";
import { createMarkdownRoundTripGuard } from "../markdown-serializer";
import { visualEditorSchema } from "../visual-schema";

// Every expected Markdown serialization, link title, and list/blockquote shape
// below was cross-verified against real PHP
// `EasyMDE\Content\MarkdownRenderer::render()`.

function findTextPos(doc: ProseMirrorNode, needle: string): number {
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
	return found;
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

function replaceText(
	doc: ProseMirrorNode,
	needle: string,
	replacement: string,
): ProseMirrorNode {
	const at = findTextPos(doc, needle);
	const state = EditorState.create({ doc, schema: visualEditorSchema });
	return state.apply(state.tr.insertText(replacement, at, at + needle.length))
		.doc;
}

describe("PR-R43-A container risk transitions, lazy separator, list sibling swallow, topological list drain, and canonical-item pre-evaluation", () => {
	describe("1. Risk-fallback container transitions unify verbatim -> preserved-container -> canonical (Track B #1)", () => {
		it("1.1 Pass 1 matched blockquote: risk fallback emits canonical and inlines [p]'s partial title", () => {
			const md = '1.   alpha\n\n   > [p]: /u\n   > "t\n   > ===\n\n[link][p]';
			const guard = createMarkdownRoundTripGuard(md);
			const edited = replaceText(guard.initialDoc, "alpha", "beta");
			const serialized = guard.serialize(edited);
			expect(serialized).toBe(
				'1. beta\n\n> [p]: /u\n>\n> # "t\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serialized)).toEqual(["t\n"]);
		});

		it("1.2 Pass 2 matched blockquote: risk break after preceding list invalidation goes straight to canonical", () => {
			const md =
				'[dead]: /d\n\n1.   [dead]\n\n   > [p]: /u\n   > "t\n   > ===\n\n[link][p]';
			const guard = createMarkdownRoundTripGuard(md);
			const edited = withChild(guard.initialDoc, 0, null);
			const serialized = guard.serialize(edited);
			expect(serialized).toBe(
				'1. [dead](/d)\n\n> [p]: /u\n>\n> # "t\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serialized)).toEqual([null, "t\n"]);
		});

		it("1.3 Pass 1 matched list: risk fallback emits canonical and inlines [p]'s partial title", () => {
			const md = '1.   alpha\n\n   - [p]: /u\n     "t\n     ===\n\n[link][p]';
			const guard = createMarkdownRoundTripGuard(md);
			const edited = replaceText(guard.initialDoc, "alpha", "beta");
			const serialized = guard.serialize(edited);
			expect(serialized).toBe(
				'1. beta\n\n- [p]: /u\n  # "t\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serialized)).toEqual(["t\n"]);
		});

		it("1.4 Paired blockquote (Pass 1 & Pass 2): 3-space indented first child downgrades preserved-container to canonical", () => {
			// Pass 1 variant: preceding list shrinks during Pass 1.
			const mdPass1 =
				'1.   alpha\n\n   > [p]: /u\n   > "t\n   > ===\n   >\n   > gamma\n\n[link][p]';
			const guard1 = createMarkdownRoundTripGuard(mdPass1);
			let doc1 = replaceText(guard1.initialDoc, "alpha", "beta");
			doc1 = replaceText(doc1, "gamma", "delta");
			const serialized1 = guard1.serialize(doc1);
			expect(serialized1).toBe(
				'1. beta\n\n> [p]: /u\n>\n> # "t\n>\n> delta\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serialized1)).toEqual(["t\n"]);

			// Pass 2 variant: preceding list shrinks only during Pass 2 after
			// [dead] invalidation, re-checking the Pass-1 preserved-container slot.
			const mdPass2 =
				'[dead]: /d\n\n1.   [dead]\n\n   > [p]: /u\n   > "t\n   > ===\n   >\n   > gamma\n\n[link][p]';
			const guard2 = createMarkdownRoundTripGuard(mdPass2);
			let doc2 = replaceText(guard2.initialDoc, "gamma", "delta");
			doc2 = withChild(doc2, 0, null);
			const serialized2 = guard2.serialize(doc2);
			expect(serialized2).toBe(
				'1. [dead](/d)\n\n> [p]: /u\n>\n> # "t\n>\n> delta\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serialized2)).toEqual([null, "t\n"]);
		});

		it("1.5 Paired list (Pass 1 & Pass 2): 3-space indented first item downgrades preserved-container to canonical", () => {
			// Pass 1 variant.
			const mdPass1 =
				'1.   alpha\n\n   - [p]: /u\n     "t\n     ===\n   - gamma\n\n[link][p]';
			const guard1 = createMarkdownRoundTripGuard(mdPass1);
			let doc1 = replaceText(guard1.initialDoc, "alpha", "beta");
			doc1 = replaceText(doc1, "gamma", "delta");
			const serialized1 = guard1.serialize(doc1);
			expect(serialized1).toBe(
				'1. beta\n\n- [p]: /u\n  # "t\n- delta\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serialized1)).toEqual(["t\n"]);

			// Pass 2 variant: preceding list shrinks in Pass 2 while paired list
			// is already in preserved-container state.
			const mdPass2 =
				'[dead]: /d\n\n1.   [dead]\n\n   - [p]: /u\n     "t\n     ===\n   - gamma\n\n[link][p]';
			const guard2 = createMarkdownRoundTripGuard(mdPass2);
			let doc2 = replaceText(guard2.initialDoc, "gamma", "delta");
			doc2 = withChild(doc2, 0, null);
			const serialized2 = guard2.serialize(doc2);
			expect(serialized2).toBe(
				'1. [dead](/d)\n\n- [p]: /u\n  # "t\n- delta\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serialized2)).toEqual([null, "t\n"]);
		});

		it("1.6 Pass 2 invalidated list & blockquote: 3-space indented first item/child downgrades to canonical", () => {
			const mdList =
				'[dead]: /d\n\n1.   [dead]\n\n   - [p]: /u\n     "t\n     ===\n   - [dead]\n\n[link][p]';
			const guardList = createMarkdownRoundTripGuard(mdList);
			const serializedList = guardList.serialize(
				withChild(guardList.initialDoc, 0, null),
			);
			expect(serializedList).toBe(
				'1. [dead](/d)\n\n- [p]: /u\n  # "t\n- [dead](/d)\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serializedList)).toEqual([null, null, "t\n"]);

			const mdBq =
				'[dead]: /d\n\n1.   [dead]\n\n   > [p]: /u\n   > "t\n   > ===\n   >\n   > [dead]\n\n[link][p]';
			const guardBq = createMarkdownRoundTripGuard(mdBq);
			const serializedBq = guardBq.serialize(
				withChild(guardBq.initialDoc, 0, null),
			);
			expect(serializedBq).toBe(
				'1. [dead](/d)\n\n> [p]: /u\n>\n> # "t\n>\n> [dead](/d)\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serializedBq)).toEqual([null, null, "t\n"]);
		});
	});

	describe("2. shouldEscalateLazyContinuation checks !prevWasVerbatimAdjacent (Track B #2)", () => {
		it("2.1 escalates tight separator after a risk-canonicalized blockquote so following paragraph is not swallowed", () => {
			const md = "1.   alpha\n\n   > p\n   >\nparagraph";
			const guard = createMarkdownRoundTripGuard(md);
			const edited = replaceText(guard.initialDoc, "alpha", "beta");
			const serialized = guard.serialize(edited);
			expect(serialized).toBe("1. beta\n\n> p\n\nparagraph");
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(reparsed.childCount).toBe(3);
			expect(reparsed.child(1).type.name).toBe("blockquote");
			expect(reparsed.child(2).type.name).toBe("paragraph");
		});

		it("2.2 escalates tight separator after Pass-2 risk-canonicalized blockquote so [p] stays top-level with its partial title", () => {
			const md =
				'[dead]: /d\n\n1.   [dead]\n\n   > p\n   >\n[p]: /u\n"t\n===\n\n[link][p]';
			const guard = createMarkdownRoundTripGuard(md);
			const serialized = guard.serialize(withChild(guard.initialDoc, 0, null));
			expect(serialized).toBe(
				'1. [dead](/d)\n\n> p\n\n[p]: /u\n"t\n===\n\n[link][p]',
			);
			expect(collectLinkTitles(serialized)).toEqual([null, "t\n"]);
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(reparsed.child(1).type.name).toBe("blockquote");
			expect(reparsed.child(1).childCount).toBe(1);
			expect(reparsed.child(3).type.name).toBe("heading");
		});
	});

	describe("3. Canonicalized list item never swallows the next reused sibling item (Track A #1)", () => {
		it("3.1 exact Track A #1 repro: safely left-shifts indented sibling item 3 to preserve 3 sibling items and [p]'s Setext title", () => {
			const md = [
				"[d]: /d",
				"",
				"1. a",
				"2.   [d]",
				"   3. [p]: /p",
				'      "t',
				"      ===",
				"",
				"[link][p]",
			].join("\n");
			const guard = createMarkdownRoundTripGuard(md);
			const serialized = guard.serialize(withChild(guard.initialDoc, 0, null));
			expect(serialized).toBe(
				'1. a\n2. [d](/d)\n3. [p]: /p\n   "t\n   ===\n\n[link][p]',
			);
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(reparsed.child(0).type.name).toBe("ordered_list");
			expect(reparsed.child(0).childCount).toBe(3);
			expect(collectLinkTitles(serialized)).toEqual([null, "t\n"]);
		});

		it("3.2 un-shiftable lazy-line sibling item falls back to canonical in BOTH serializer and liveness, preserving 3 sibling items and title", () => {
			const md = [
				"[d]: /d",
				"",
				"1. a",
				"2.   [d]",
				"   3. [p]: /p",
				'      "t',
				"      ===",
				"",
				"      p",
				"lazy",
				"",
				"[link][p]",
			].join("\n");
			const guard = createMarkdownRoundTripGuard(md);
			const serialized = guard.serialize(withChild(guard.initialDoc, 0, null));
			expect(serialized).toBe(
				'1. a\n2. [d](/d)\n3. [p]: /p\n\n   # "t\n\n   p\n   lazy\n\n[link](/p "t&#10;")',
			);
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(reparsed.child(0).type.name).toBe("ordered_list");
			expect(reparsed.child(0).childCount).toBe(3);
			expect(collectLinkTitles(serialized)).toEqual([null, "t\n"]);
		});

		it("3.3 un-shiftable multiline-math sibling item does not strip math continuation bytes and stays a sibling", () => {
			const md = [
				"[d]: /d",
				"",
				"1. a",
				"2.   [d]",
				"   3. \\(a",
				"      b\\)",
			].join("\n");
			const guard = createMarkdownRoundTripGuard(md);
			const serialized = guard.serialize(withChild(guard.initialDoc, 0, null));
			expect(serialized).toBe("1. a\n2. [d](/d)\n3. \\(a\n      b\\)");
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(reparsed.child(0).type.name).toBe("ordered_list");
			expect(reparsed.child(0).childCount).toBe(3);
		});

		it("3.4 Pass-1 item deletion and 2-step sibling shift chain both stay siblings without swallowing", () => {
			const mdDelete = [
				"1. a",
				"2.   b",
				"   3. [p]: /p",
				'      "t',
				"      ===",
				"",
				"[link][p]",
			].join("\n");
			const guardDelete = createMarkdownRoundTripGuard(mdDelete);
			const list = guardDelete.initialDoc.child(0);
			const editedDelete = withChild(
				guardDelete.initialDoc,
				0,
				withChild(list, 1, null),
			);
			const serializedDelete = guardDelete.serialize(editedDelete);
			expect(serializedDelete).toBe(
				'1. a\n3. [p]: /p\n   "t\n   ===\n\n[link][p]',
			);
			expect(parseMarkdownToVisualDoc(serializedDelete).child(0).childCount).toBe(
				2,
			);
			expect(collectLinkTitles(serializedDelete)).toEqual(["t\n"]);

			// 2-step chain: item 1 shrinks 5->3, forcing item 2 (`   2. b`) to shift
			// left 6->3, which in turn forces item 3 (`   3. [p]...`) to shift left.
			const mdChain = [
				"[d]: /d",
				"",
				"1.   [d]",
				"   2. b",
				"   3. [p]: /p",
				'      "t',
				"      ===",
				"",
				"[link][p]",
			].join("\n");
			const guardChain = createMarkdownRoundTripGuard(mdChain);
			const serializedChain = guardChain.serialize(
				withChild(guardChain.initialDoc, 0, null),
			);
			expect(serializedChain).toBe(
				'1. [d](/d)\n2. b\n3. [p]: /p\n   "t\n   ===\n\n[link][p]',
			);
			expect(parseMarkdownToVisualDoc(serializedChain).child(0).childCount).toBe(
				3,
			);
			expect(collectLinkTitles(serializedChain)).toEqual([null, "t\n"]);
		});
	});

	describe("4. True topological liveUpstreamCount + (isSink, nodeSize) heap ordering (Track A #2 + Track B #3)", () => {
		function runCascadeAndCount(
			md: string,
			bigListIndexFromEnd = 1,
		): Readonly<{
			bigListLivenessCalls: number;
			bigListNodeSize: number;
			elapsedMs: number;
			serialized: string;
			smallListNodeSize: number;
			totalLivenessCalls: number;
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
				const items: ProseMirrorNode[] = [];
				for (let x = 1; x < child.childCount; x += 1) items.push(child.child(x));
				const nextList = child.type.create(child.attrs, items);
				children.push(nextList);
				lists.push(nextList);
			}
			const bigListNode = lists[lists.length - bigListIndexFromEnd] ?? null;
			const smallListNode = lists[0] ?? null;
			const edited = doc.type.create(null, children);
			const spy = vi.spyOn(
				listPreservation,
				"resolveAuthoritativeListPreservation",
			);
			try {
				const startedAt = performance.now();
				const serialized = guard.serialize(edited);
				const elapsedMs = performance.now() - startedAt;
				let bigListLivenessCalls = 0;
				for (const call of spy.mock.calls) {
					if (call[0] === bigListNode) bigListLivenessCalls += 1;
				}
				return {
					bigListLivenessCalls,
					bigListNodeSize: bigListNode?.nodeSize ?? 0,
					elapsedMs,
					serialized,
					smallListNodeSize: smallListNode?.nodeSize ?? 0,
					totalLivenessCalls: spy.mock.calls.length,
				};
			} finally {
				spy.mockRestore();
			}
		}

		it("4.1 Track A #2: non-sink L_big with equal/smaller nodeSize than cascade lists reparses EXACTLY ONCE for M=K=40 and M=K=80", () => {
			for (const m of [40, 80] as const) {
				const parts = ["[c0]: /u0"];
				for (let i = 0; i < m; i += 1) {
					parts.push(`sep${i}`);
					// Give each cascade list slightly MORE items than L_big so
					// nodeSize alone would pop L_big ahead of L_i on every wave;
					// only `liveUpstreamCount` prevents O(M*K) re-validation.
					const cascadeList = [
						"9. remove",
						`10. [c${i + 1}]: /u${i + 1}\n    "t${i + 1}\n    ===`,
						`11. [c${i}]\n    p\n    ---`,
					];
					for (let pad = 0; pad < m; pad += 1) {
						cascadeList.push(`${12 + pad}. pad${pad}`);
					}
					parts.push(cascadeList.join("\n"));
				}
				parts.push("sepbig");
				const big = ["9. remove", '10. [big]: /b\n    "tb\n    ==='];
				for (let j = 0; j < m; j += 1) {
					big.push(`${11 + j}. [c${j + 1}]`);
				}
				parts.push(big.join("\n"));
				const refs: string[] = [];
				for (let i = 1; i <= m; i += 1) refs.push(`[c${i}]`);
				refs.push("[big]");
				parts.push(refs.join(" "));

				const res = runCascadeAndCount(parts.join("\n\n"));
				expect(res.bigListNodeSize).toBeLessThan(res.smallListNodeSize);
				for (let i = 1; i <= m; i += 1) {
					expect(res.serialized).toContain(`[c${i}](/u${i} "t${i}&#10;")`);
				}
				expect(res.serialized.endsWith("[big]")).toBe(true);
				// Pass 1 (1) + Pass 2 drain (1) = 2 total (EXACTLY 1 Pass-2 reparse!).
				expect(res.bigListLivenessCalls).toBe(2);
				expect(res.totalLivenessCalls).toBe(2 * (m + 1));
				expect(res.elapsedMs).toBeLessThan(6000);
			}
		});

		it("4.2 Track B #3: heavy nested L_big (smaller childCount, much larger nodeSize) pops AFTER small flat lists and reparses EXACTLY ONCE", () => {
			const m = 60;
			const parts = ["[c0]: /u0"];
			for (let i = 0; i < m; i += 1) {
				parts.push(`sep${i}`);
				// 62 items after deleting `9. remove` (childCount = 62, small nodeSize).
				const small = [
					"9. remove",
					`10. [c${i + 1}]: /u${i + 1}\n    "t${i + 1}\n    ===`,
					`11. [c${i}]\n    p\n    ---`,
				];
				for (let pad = 0; pad < 60; pad += 1) {
					small.push(`${12 + pad}. x`);
				}
				parts.push(small.join("\n"));
			}
			parts.push("sepbig");
			// 61 items after deleting `9. remove` (childCount = 61 < 62, but heavy
			// nested bullet lists give nodeSize >> smallListNodeSize while staying
			// tight so `[big]` remains intact).
			const big = ["9. remove", '10. [big]: /b\n    "tb\n    ==='];
			for (let j = 0; j < m; j += 1) {
				const nested = [
					`${11 + j}. [c${j + 1}]`,
					"    - nested bullet 1",
					"      - sub-bullet a",
					"      - sub-bullet b",
					"    - nested bullet 2",
					"      - sub-bullet c",
					"      - sub-bullet d",
				].join("\n");
				big.push(nested);
			}
			parts.push(big.join("\n"));
			const refs: string[] = [];
			for (let i = 1; i <= m; i += 1) refs.push(`[c${i}]`);
			refs.push("[big]");
			parts.push(refs.join(" "));

			const res = runCascadeAndCount(parts.join("\n\n"));
			expect(res.bigListNodeSize).toBeGreaterThan(res.smallListNodeSize * 4);
			for (let i = 1; i <= m; i += 1) {
				expect(res.serialized).toContain(`[c${i}](/u${i} "t${i}&#10;")`);
			}
			expect(res.serialized.endsWith("[big]")).toBe(true);
			// Pass 1 (1) + Pass 2 drain (1) = 2 total (EXACTLY 1 Pass-2 reparse!).
			expect(res.bigListLivenessCalls).toBe(2);
			expect(res.totalLivenessCalls).toBe(2 * (m + 1));
			expect(res.elapsedMs).toBeLessThan(6000);
		});

		it("4.3 Track B #3 tiebreaker: equal liveUpstreamCount=0 pops smaller nodeSize ahead of smaller childCount", () => {
			// Both lists are triggered simultaneously by `[c0]` (liveUpstreamCount=0,
			// both non-sink). Heavy nested list has FEWER items (childCount=6) than
			// flat list (childCount=10), but MUCH larger nodeSize.
			const heavy = ["9. remove", '10. [h]: /h\n    "th\n    ==='];
			for (let j = 0; j < 5; j += 1) {
				heavy.push(
					[
						`${11 + j}. [c0]`,
						"    - nested bullet 1",
						"      - sub a",
						"      - sub b",
						"    - nested bullet 2",
						"      - sub c",
						"      - sub d",
					].join("\n"),
				);
			}
			const flat = ["9. remove", '10. [f]: /f\n    "tf\n    ==='];
			for (let j = 0; j < 9; j += 1) flat.push(`${11 + j}. [c0]`);
			const md = [
				"[c0]: /u0",
				"sepH",
				heavy.join("\n"),
				"sepF",
				flat.join("\n"),
				"[h] [f]",
			].join("\n\n");
			const guard = createMarkdownRoundTripGuard(
				md,
				parseMarkdownWithBlockSources(md),
			);
			const doc = guard.initialDoc;
			const children: ProseMirrorNode[] = [];
			let heavyList: ProseMirrorNode | null = null;
			let flatList: ProseMirrorNode | null = null;
			for (let i = 1; i < doc.childCount; i += 1) {
				const child = doc.child(i);
				if (child.type.name !== "ordered_list") {
					children.push(child);
					continue;
				}
				const items: ProseMirrorNode[] = [];
				for (let x = 1; x < child.childCount; x += 1) items.push(child.child(x));
				const next = child.type.create(child.attrs, items);
				if (heavyList === null) heavyList = next;
				else flatList = next;
				children.push(next);
			}
			expect(heavyList?.childCount).toBeLessThan(flatList?.childCount ?? 0);
			expect(heavyList?.nodeSize).toBeGreaterThan(flatList?.nodeSize ?? 0);
			const spy = vi.spyOn(
				listPreservation,
				"resolveAuthoritativeListPreservation",
			);
			try {
				guard.serialize(doc.type.create(null, children));
				// Calls 0 & 1 are Pass 1 openList (heavy, flat). Calls 2 & 3 are Pass 2
				// drain: flat (smaller nodeSize) MUST pop BEFORE heavy!
				expect(spy.mock.calls.length).toBe(4);
				expect(spy.mock.calls[2]?.[0]).toBe(flatList);
				expect(spy.mock.calls[3]?.[0]).toBe(heavyList);
			} finally {
				spy.mockRestore();
			}
		});
	});

	describe("5. Pre-evaluate canonical non-reusable list items & per-candidate Pass-2 dirty hooks (Track B #4)", () => {
		it("5.1 exact Track B #4 repro: breaking [b] in canonical item 2 before resolveListReuse keeps [a] and [linkA][a] verbatim", () => {
			const md =
				'1. remove\n\n2. [a]: /a\n   "TitleA\n   ===\n3. [b]: /b\n   "TitleB" x\n\n[linkA][a] [linkB][b]';
			const guard = createMarkdownRoundTripGuard(md);
			let doc = replaceText(guard.initialDoc, '"TitleB" x', '"TitleB2" x');
			doc = withChild(doc, 0, withChild(doc.child(0), 0, null));
			const serialized = guard.serialize(doc);
			expect(serialized).toBe(
				'1. [a]: /a\n   "TitleA\n   ===\n2. [b]: /b\n\n   "TitleB2" x\n\n[linkA][a] [linkB](/b "TitleB")',
			);
			expect(collectLinkTitles(serialized)).toEqual(["TitleA\n", "TitleB"]);
		});

		it("5.2 multi-candidate canonical item: two surviving candidates invalidated in different waves BOTH dirty the list independently", () => {
			// Build a 2-wave scenario where canonical item 2 of tight list `L` holds
			// two surviving partial-title candidates `[b1]` (in a blockquote,
			// referencing `[c1]`) and `[b2]` (in a nested bullet list, referencing
			// `[c2]`):
			// - Wave 1 (`L_c1` breaks `[c1]`): `[b1]` breaks and dirties `L`. `L`
			//   drains FIRST (`liveUpstreamCount = 1`, smaller `nodeSize` than
			//   `L_c2`), staying tight (`itemReusable[0] === true`). A shared
			//   `{ fired: false }` task would now be permanently spent!
			// - Wave 2 (`L_c2` breaks `[c2]`): `[b2]` breaks and its INDEPENDENT
			//   per-candidate hook re-dirties `L`, triggering a SECOND Pass-2 drain
			//   (total liveness calls on `L` = 3: Pass 1 + Wave 1 + Wave 2).
			const lc2Padding: string[] = [];
			for (let p = 0; p < 25; p += 1) lc2Padding.push(`${13 + p}. pad${p}`);
			const md = [
				"[c0]: /u0",
				"sep1",
				'9. remove\n10. [c1]: /u1\n    "t1\n    ===\n11. [c0]\n    p\n    ---',
				"sepL",
				[
					"9. remove",
					'10. [a]: /a\n    "TitleA\n    ===',
					'11. - [b2]: /b2\n      "T2 [c2]" y\n    > [b1]: /b1\n    > "T1 [c1]" x',
				].join("\n"),
				"sep2",
				[
					"9. remove",
					'10. [c2]: /u2\n    "t2\n    ===',
					"11. [c1]\n    p\n    ---",
					"12. [b2]",
					...lc2Padding,
				].join("\n"),
				"[linkA][a] [linkB1][b1] [linkB2][b2] [c1] [c2]",
			].join("\n\n");

			const guard = createMarkdownRoundTripGuard(
				md,
				parseMarkdownWithBlockSources(md),
			);
			// Edit: delete `[c0]: /u0`, remove `9. remove` from all 3 lists, and edit
			// `" x` -> `" x2` so item 2 of `L` is canonical while BOTH `[b1]` and
			// `[b2]` survive Pass 1.
			let doc = replaceText(guard.initialDoc, '" x', '" x2');
			const children: ProseMirrorNode[] = [];
			let targetList: ProseMirrorNode | null = null;
			for (let i = 1; i < doc.childCount; i += 1) {
				const child = doc.child(i);
				if (child.type.name !== "ordered_list") {
					children.push(child);
					continue;
				}
				const items: ProseMirrorNode[] = [];
				for (let x = 1; x < child.childCount; x += 1) {
					items.push(child.child(x));
				}
				const nextList = child.type.create(child.attrs, items);
				if (i === 4) targetList = nextList;
				children.push(nextList);
			}
			doc = doc.type.create(null, children);

			const spy = vi.spyOn(
				listPreservation,
				"resolveAuthoritativeListPreservation",
			);
			let serialized = "";
			let targetListLivenessCalls = 0;
			try {
				serialized = guard.serialize(doc);
				for (const call of spy.mock.calls) {
					if (call[0] === targetList) targetListLivenessCalls += 1;
				}
			} finally {
				spy.mockRestore();
			}

			// Pass 1 openList (1) + Wave 1 drain after [b1] (1) + Wave 2 drain
			// after [b2] (1) = 3 calls!
			expect(targetListLivenessCalls).toBe(3);
			expect(serialized).toContain("[linkA][a]");
			expect(serialized).toContain('[linkB1](/b1 "T1 [c1]")');
			expect(serialized).toContain('[linkB2](/b2 "T2 [c2]")');
			const reparsed = parseMarkdownToVisualDoc(serialized);
			let linkATitle: unknown = null;
			reparsed.descendants((node) => {
				if (node.isText && node.text === "linkA") {
					const link = node.marks.find((m) => m.type.name === "link");
					if (link) linkATitle = link.attrs.title;
				}
			});
			expect(linkATitle).toBe("TitleA\n");
		});
	});
});
