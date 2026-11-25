import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { describe, expect, it } from "vitest";
import { nodesSemanticallyEqual } from "../markdown-node-alignment";
import {
	parseMarkdownToVisualDoc,
	parseMarkdownWithBlockSources,
} from "../markdown-parser";
import {
	createMarkdownRoundTripGuard,
	serializeVisualDocToMarkdown,
} from "../markdown-serializer";
import { visualEditorSchema } from "../visual-schema";

// Every expected Markdown serialization, link title, anchor count, and math
// body below was verified against real PHP `EasyMDE\Content\MarkdownRenderer::render()`.

function findTextRange(
	doc: ProseMirrorNode,
	needle: string,
): Readonly<{ from: number; to: number }> {
	let from = -1;
	let to = -1;
	doc.descendants((node, pos) => {
		if (from >= 0 || !node.isText || !node.text) {
			return from < 0;
		}
		const idx = node.text.indexOf(needle);
		if (idx >= 0) {
			from = pos + idx;
			to = from + needle.length;
			return false;
		}
		return true;
	});
	expect(from, `Could not find "${needle}" in doc`).toBeGreaterThanOrEqual(0);
	return { from, to };
}

function insertTextAfterFirstMatch(
	doc: ProseMirrorNode,
	needle: string,
	insertion: string,
): ProseMirrorNode {
	const { to } = findTextRange(doc, needle);
	const state = EditorState.create({ doc, schema: visualEditorSchema });
	return state.apply(state.tr.insertText(insertion, to)).doc;
}

function deleteFirstChild(doc: ProseMirrorNode): ProseMirrorNode {
	const remaining: ProseMirrorNode[] = [];
	for (let i = 1; i < doc.childCount; i += 1) {
		remaining.push(doc.child(i));
	}
	return doc.type.create(null, remaining);
}

describe("PR-R40-A unified list/liveness O(N+E) engine, cross-container/pasteHTML link boundaries, and all-depth math dedent", () => {
	describe("1. Unified whole-list preservation and O(N+E) refdef liveness worklist (Track A #2 + Track B #1)", () => {
		it("matches whole-list listMarkdownParsesTo for both tight:true and tight:false ordered lists without silently losing Setext partial titles", () => {
			const md =
				'9. first\n10. [r]: /u\n    "Setext title\n    ===\n11. item\n\n[r]';
			for (const tight of [true, false] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				const origList = guard.initialDoc.child(0);
				const p1 = visualEditorSchema.nodes.paragraph.create(
					null,
					visualEditorSchema.text("p1"),
				);
				const p2 = visualEditorSchema.nodes.paragraph.create(
					null,
					visualEditorSchema.text("p2"),
				);
				const twoParaItem = visualEditorSchema.nodes.list_item.create(null, [
					p1,
					p2,
				]);
				const editedList = origList.type.create(
					{ ...origList.attrs, tight },
					[origList.child(1), twoParaItem],
				);
				const edited = guard.initialDoc.type.create(null, [
					editedList,
					guard.initialDoc.child(1),
				]);

				const serialized = guard.serialize(edited);
				if (tight) {
					// Whole-list re-parse produces tight:false !== tight:true -> falls
					// back to canonical item 0 (`# "Setext title`), so `[r]` MUST inline
					// its PHP partial title instead of losing it silently.
					expect(serialized).toBe(
						'9. [r]: /u\n   # "Setext title\n10. p1\n\n    p2\n\n[r](/u "Setext title&#10;")',
					);
				} else {
					// Whole-list re-parse matches tight:false -> item 0 stays raw
					// Setext heading, so `[r]` stays raw without needless inlining.
					expect(serialized).toBe(
						'9. [r]: /u\n   "Setext title\n   ===\n10. p1\n\n    p2\n\n[r]',
					);
				}

				const reparsed = parseMarkdownToVisualDoc(serialized);
				let linkTitle: unknown = null;
				reparsed.descendants((node) => {
					const link = node.marks.find((m) => m.type.name === "link");
					if (link) linkTitle = link.attrs.title;
				});
				expect(linkTitle, `tight=${String(tight)}`).toBe("Setext title\n");
			}
		});

		it("cascades Setext refdef dependency chains in linear O(N) time for N=400/800/1600", () => {
			for (const count of [400, 800, 1600] as const) {
				const blocks: string[] = ["[lost]: /lost"];
				for (let i = 1; i <= count; i += 1) {
					const prev = i === 1 ? "lost" : `r${i - 1}`;
					blocks.push(`[r${i}]: /u\n"[${prev}]\n===`);
				}
				blocks.push(`[r${count}]`);
				const md = blocks.join("\n\n");
				const parsed = parseMarkdownWithBlockSources(md);
				const guard = createMarkdownRoundTripGuard(md, parsed);
				const edited = deleteFirstChild(guard.initialDoc);

				const startedAt = performance.now();
				const serialized = guard.serialize(edited);
				const elapsedMs = performance.now() - startedAt;

				expect(serialized, `N=${count}`).toContain(
					`[r${count}](/u "[r${count - 1}]&#10;")`,
				);
				expect(serialized, `N=${count}`).toContain('# "[lost](/lost)');
				expect(elapsedMs, `N=${count}`).toBeLessThan(1500);
			}
		});

		it("cascades paragraph refdef dependency chains in linear O(K) time for K=100/200/400", () => {
			for (const count of [100, 200, 400] as const) {
				const blocks: string[] = ["[r0]: /u0"];
				for (let i = 1; i <= count; i += 1) {
					blocks.push(`[r${i}]: /u${i}\n"t${i} [r${i - 1}]`);
				}
				blocks.push(`[r${count}]`);
				const md = blocks.join("\n\n");
				const parsed = parseMarkdownWithBlockSources(md);
				const guard = createMarkdownRoundTripGuard(md, parsed);
				const edited = deleteFirstChild(guard.initialDoc);

				const startedAt = performance.now();
				const serialized = guard.serialize(edited);
				const elapsedMs = performance.now() - startedAt;

				expect(serialized, `K=${count}`).toContain(
					`[r${count}](/u${count} "t${count} [r${count - 1}]&#10;")`,
				);
				expect(serialized, `K=${count}`).toContain('"t1 [r0](/u0)');
				expect(elapsedMs, `K=${count}`).toBeLessThan(1500);
			}
		});
	});

	describe("2. Cross-container & pasteHTML link boundaryKey with semantic node equality (Track A #3 + Track B #2)", () => {
		it("preserves adjacent links on EditorView.pasteHTML and when pasting next to an existing link", () => {
			const host = document.createElement("div");
			document.body.appendChild(host);
			const view = new EditorView(host, {
				state: EditorState.create({
					doc: parseMarkdownToVisualDoc(""),
					schema: visualEditorSchema,
				}),
			});
			try {
				const pasteEvent = new Event("paste") as ClipboardEvent;
				view.pasteHTML(
					'<p><a href="/u">a</a><a href="/u">b</a></p>',
					pasteEvent,
				);
				const pastedMd = serializeVisualDocToMarkdown(view.state.doc);
				expect(pastedMd).toBe("[a](/u)[b](/u)");

				// Pasting `<a href="/u">b</a>` directly after an existing `[a](/u)` keeps both links distinct
				const existingDoc = parseMarkdownToVisualDoc("[a](/u)");
				const nextState = EditorState.create({
					doc: existingDoc,
					schema: visualEditorSchema,
					selection: TextSelection.create(
						existingDoc,
						existingDoc.child(0).nodeSize - 1,
					),
				});
				view.updateState(nextState);
				view.pasteHTML('<a href="/u">b</a>', pasteEvent);
				expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
					"[a](/u)[b](/u)",
				);
			} finally {
				view.destroy();
				host.remove();
			}
		});

		it("preserves distinct link boundaries when joining two paragraphs via ProseMirror transaction", () => {
			const md = "[a](/u)\n\n[b](/u)";
			const guard = createMarkdownRoundTripGuard(md);
			const doc = guard.initialDoc;
			const state = EditorState.create({ doc, schema: visualEditorSchema });
			const boundaryPos = doc.child(0).nodeSize;
			// Join paragraph 0 (`[a](/u)`) and paragraph 1 (`[b](/u)`) via tr.join
			const joinedDoc = state.apply(state.tr.join(boundaryPos)).doc;
			const serialized = guard.serialize(joinedDoc);
			expect(serialized).toBe("[a](/u)[b](/u)");
			expect(
				nodesSemanticallyEqual(parseMarkdownToVisualDoc(serialized), joinedDoc),
			).toBe(true);
		});

		it("preserves untouched list items and Setext partial titles when deleting an earlier link leaves a stale boundaryKey", () => {
			// Case 1: untouched item 10 raw emphasis & code backticks
			{
				const md =
					"9. first\n10.   _untouched_ *raw* `item`\n11. [a](/u) and [b](/u)";
				const guard = createMarkdownRoundTripGuard(md);
				const origList = guard.initialDoc.child(0);
				// Delete `[a](/u) and ` inside item 11, leaving `[b](/u)` with its stale boundaryKey
				const item11Para = origList.child(2).child(0);
				const bTextNode = item11Para.child(item11Para.childCount - 1);
				expect(bTextNode.text).toBe("b");
				expect(
					bTextNode.marks.find((m) => m.type.name === "link")?.attrs
						.boundaryKey,
				).toBe("1");
				const editedItem11 = visualEditorSchema.nodes.list_item.create(null, [
					visualEditorSchema.nodes.paragraph.create(null, [bTextNode]),
				]);
				const editedList = origList.type.create(origList.attrs, [
					origList.child(1),
					editedItem11,
				]);
				const edited = guard.initialDoc.type.create(null, [editedList]);
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					"9.   _untouched_ *raw* `item`\n10. [b](/u)",
				);
				expect(
					nodesSemanticallyEqual(parseMarkdownToVisualDoc(serialized), edited),
				).toBe(true);
			}

			// Case 2: untouched item 10 with Setext partial-title refdef
			{
				const md =
					'9. first\n10.   [r]: /u\n      "Setext title\n      ===\n11. [a](/x) and [b](/x)\n\n[r]';
				const guard = createMarkdownRoundTripGuard(md);
				const origList = guard.initialDoc.child(0);
				const item11Para = origList.child(2).child(0);
				const bTextNode = item11Para.child(item11Para.childCount - 1);
				const editedItem11 = visualEditorSchema.nodes.list_item.create(null, [
					visualEditorSchema.nodes.paragraph.create(null, [bTextNode]),
				]);
				const editedList = origList.type.create(origList.attrs, [
					origList.child(1),
					editedItem11,
				]);
				const edited = guard.initialDoc.type.create(null, [
					editedList,
					guard.initialDoc.child(1),
				]);
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'9.   [r]: /u\n     "Setext title\n     ===\n10. [b](/x)\n\n[r]',
				);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(nodesSemanticallyEqual(reparsed, edited)).toBe(true);
				let rTitle: unknown = null;
				reparsed.descendants((node) => {
					if (node.isText && node.text === "r") {
						rTitle = node.marks.find((m) => m.type.name === "link")?.attrs
							.title;
					}
				});
				expect(rTitle).toBe("Setext title\n");
			}
		});

		it("treats non-adjacent boundaryKey differences as semantically equal while distinguishing adjacent vs merged links", () => {
			const linkMark = (boundaryKey: string | null) =>
				visualEditorSchema.marks.link.create({
					boundaryKey,
					href: "/u",
					title: null,
				});
			const strong = visualEditorSchema.marks.strong.create();
			const p = (...children: ProseMirrorNode[]) =>
				visualEditorSchema.nodes.paragraph.create(null, children);

			const staleSingle = p(visualEditorSchema.text("b", [linkMark("dom:7")]));
			const freshSingle = p(visualEditorSchema.text("b", [linkMark(null)]));
			expect(nodesSemanticallyEqual(staleSingle, freshSingle)).toBe(true);

			const domAdjacent = p(
				visualEditorSchema.text("a", [linkMark("dom:1")]),
				visualEditorSchema.text("b", [linkMark("dom:2")]),
			);
			const parsedAdjacent = p(
				visualEditorSchema.text("a", [linkMark(null)]),
				visualEditorSchema.text("b", [linkMark("1")]),
			);
			const merged = p(visualEditorSchema.text("ab", [linkMark(null)]));
			expect(nodesSemanticallyEqual(domAdjacent, parsedAdjacent)).toBe(true);
			expect(nodesSemanticallyEqual(domAdjacent, merged)).toBe(false);

			const splitBoldAdjacent = p(
				visualEditorSchema.text("a", [linkMark("dom:1"), strong]),
				visualEditorSchema.text("b", [linkMark("dom:2")]),
			);
			const mergedBoldSingle = p(
				visualEditorSchema.text("a", [linkMark(null), strong]),
				visualEditorSchema.text("b", [linkMark(null)]),
			);
			expect(
				nodesSemanticallyEqual(splitBoldAdjacent, mergedBoldSingle),
			).toBe(false);
		});
	});

	describe("3. Protect multiline math continuation lines at ALL depths (depth >= 0) for both math and raw protected blocks (Track A #1 + Track B #3)", () => {
		it("preserves exact continuation bytes for $$...$$ and \\[...\\] math blocks at depth 1 and depth 2 when preceding list shrinks", () => {
			const cases: ReadonlyArray<Readonly<{ expected: string; md: string }>> = [
				{
					expected: "> - a\n> -\n>   # h!\n>\n> $$a\n>     b$$",
					md: "> - a\n> -   # h\n>   $$a\n>     b$$",
				},
				{
					expected: "> > - a\n> > -\n> >   # h!\n> >\n> > $$a\n> >     b$$",
					md: "> > - a\n> > -   # h\n> >   $$a\n> >     b$$",
				},
				{
					expected: "> - a\n> -\n>   # h!\n>\n> \\[a\n>     b\\]",
					md: "> - a\n> -   # h\n>   \\[a\n>     b\\]",
				},
				{
					expected: "> > - a\n> > -\n> >   # h!\n> >\n> > \\[a\n> >     b\\]",
					md: "> > - a\n> > -   # h\n> >   \\[a\n> >     b\\]",
				},
			];

			for (const { md, expected } of cases) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "h", "!");
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(expected);
			}
		});

		it("protects multiline math spans inside raw and math protected blocks during dedentAllToLineZeroAtDepth at depth 0", () => {
			// Parsed depth=0 cases: deleting `middle` leaves exact continuation indentation
			for (const [md, expected] of [
				[
					"- item1\n\nmiddle\n\n  <!--\n  $$\n  a\n  b\n  $$\n  -->",
					"- item1\n\n<!--\n  $$\n  a\n  b\n  $$\n  -->",
				],
				[
					'- item1\n\nmiddle\n\n  <div title="\\(a\n    b\\)">\n    hi\n  </div>',
					'- item1\n\n<div title="\\(a\n    b\\)">\n    hi\n  </div>',
				],
			] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = guard.initialDoc.type.create(null, [
					guard.initialDoc.child(0),
					guard.initialDoc.child(2),
				]);
				expect(guard.serialize(edited), md).toBe(expected);
			}

			// Canonical indented raw & math protected blocks at depth 0:
			// dedentAllToLineZeroAtDepth must protect continuation lines inside
			// `$$...$$`, `\[...\]`, and `\(...\)` identically to depth >= 1.
			const directCases: ReadonlyArray<
				Readonly<{
					expected: string;
					kind: "math" | "raw";
					rawMarkdown: string;
				}>
			> = [
				{
					expected: "- item1\n\n<!--\n$$\n  a\n  b\n  $$\n-->",
					kind: "raw",
					rawMarkdown: "  <!--\n  $$\n  a\n  b\n  $$\n  -->",
				},
				{
					expected: '- item1\n\n<div title="\\(a\n    b\\)">\n  hi\n</div>',
					kind: "raw",
					rawMarkdown: '  <div title="\\(a\n    b\\)">\n    hi\n  </div>',
				},
				{
					expected: "- item1\n\n<div>\n$$\n  a\n  b\n  $$\n</div>",
					kind: "raw",
					rawMarkdown: "  <div>\n  $$\n  a\n  b\n  $$\n  </div>",
				},
				{
					expected: "- item1\n\n$$a\n    b$$",
					kind: "math",
					rawMarkdown: "  $$a\n    b$$",
				},
				{
					expected: "- item1\n\n\\[a\n    b\\]",
					kind: "math",
					rawMarkdown: "  \\[a\n    b\\]",
				},
			];

			for (const { kind, rawMarkdown, expected } of directCases) {
				const guard = createMarkdownRoundTripGuard("- item1\n\nmiddle");
				const block = visualEditorSchema.nodes.protected_block.create({
					kind,
					rawMarkdown,
				});
				const edited = guard.initialDoc.type.create(null, [
					guard.initialDoc.child(0),
					block,
				]);
				expect(guard.serialize(edited), rawMarkdown).toBe(expected);
			}
		});
	});
});
