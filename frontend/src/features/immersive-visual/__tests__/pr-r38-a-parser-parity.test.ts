import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { parseMarkdownToVisualDoc } from "../markdown-parser";
import { createMarkdownRoundTripGuard } from "../markdown-serializer";
import { visualEditorSchema } from "../visual-schema";

// Every expected serialization / structure below was verified against real PHP
// `EasyMDE\Content\MarkdownRenderer::render()` and `render_preview()`.

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

function insertTextAtOffsetInMatch(
	doc: ProseMirrorNode,
	needle: string,
	offset: number,
	insertion: string,
): ProseMirrorNode {
	const { from } = findTextRange(doc, needle);
	const state = EditorState.create({ doc, schema: visualEditorSchema });
	return state.apply(state.tr.insertText(insertion, from + offset)).doc;
}

function deleteFirstTextMatch(
	doc: ProseMirrorNode,
	needle: string,
): ProseMirrorNode {
	const { from, to } = findTextRange(doc, needle);
	const state = EditorState.create({ doc, schema: visualEditorSchema });
	return state.apply(state.tr.delete(from, to)).doc;
}

function addStrongToFirstTextMatch(
	doc: ProseMirrorNode,
	needle: string,
): ProseMirrorNode {
	const { from, to } = findTextRange(doc, needle);
	const strongMark = visualEditorSchema.marks.strong.create();
	const state = EditorState.create({ doc, schema: visualEditorSchema });
	return state.apply(state.tr.addMark(from, to, strongMark)).doc;
}

function updateFirstImageAttrs(
	doc: ProseMirrorNode,
	patch: Record<string, unknown>,
): ProseMirrorNode {
	let imagePos = -1;
	let imageNode: ProseMirrorNode | null = null;
	doc.descendants((node, pos) => {
		if (imagePos >= 0) return false;
		if (node.type.name === "image") {
			imagePos = pos;
			imageNode = node;
			return false;
		}
		return true;
	});
	expect(imagePos, "Could not find image node in doc").toBeGreaterThanOrEqual(
		0,
	);
	const state = EditorState.create({ doc, schema: visualEditorSchema });
	return state.apply(
		state.tr.setNodeMarkup(imagePos, undefined, {
			...(imageNode as unknown as ProseMirrorNode).attrs,
			...patch,
		}),
	).doc;
}

function collectLinkSegments(
	doc: ProseMirrorNode,
): Array<Readonly<{ attrs: Mark["attrs"]; strong: boolean; text: string }>> {
	const out: Array<
		Readonly<{ attrs: Mark["attrs"]; strong: boolean; text: string }>
	> = [];
	doc.descendants((node) => {
		if (!node.isText || !node.text) return;
		const link = node.marks.find((m) => m.type.name === "link");
		if (link) {
			out.push({
				attrs: link.attrs,
				strong: node.marks.some((m) => m.type.name === "strong"),
				text: node.text,
			});
		}
	});
	return out;
}

function firstImageAttrs(doc: ProseMirrorNode): Record<string, unknown> | null {
	let attrs: Record<string, unknown> | null = null;
	doc.descendants((node) => {
		if (attrs !== null) return false;
		if (node.type.name === "image") {
			attrs = node.attrs;
			return false;
		}
		return true;
	});
	return attrs;
}

describe("PR-R38-A partial-title link/image attrs, refdef invalidation, dedent, and unified container preservation", () => {
	describe("1. Real PHP partial titles & image scale on visual marks/nodes (Track A #1, Track A #3, Track B F1)", () => {
		it("keeps adjacent partial-title and inline links distinct when typing inside the first link (Track A #1)", () => {
			const md = '[r]: /u\n"a\n\n[rr][r][ss](/u)\nz';
			const guard = createMarkdownRoundTripGuard(md);

			expect(collectLinkSegments(guard.initialDoc)).toEqual([
				{ attrs: { href: "/u", title: "a\n" }, strong: false, text: "rr" },
				{ attrs: { href: "/u", title: null }, strong: false, text: "ss" },
			]);

			const edited = insertTextAtOffsetInMatch(guard.initialDoc, "rr", 1, "X");
			const serialized = guard.serialize(edited);
			expect(serialized).toBe('[r]: /u\n"a\n\n[rXr][r][ss](/u)\nz');

			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(reparsed.eq(edited)).toBe(true);
			expect(collectLinkSegments(reparsed)).toEqual([
				{ attrs: { href: "/u", title: "a\n" }, strong: false, text: "rXr" },
				{ attrs: { href: "/u", title: null }, strong: false, text: "ss" },
			]);
		});

		it("preserves exact titles when deleting or bolding either half of adjacent same-href links (Track B F1a/1b/1c)", () => {
			// F1a: `[s](/u)[r][]` — delete `r` must not leak `title="a\n"` onto `s`;
			// bolding `r` must keep `[s](/u)` separate from `[**r**][r]`.
			{
				const md = '[r]: /u\n"a\n\n[s](/u)[r][]';
				const guard = createMarkdownRoundTripGuard(md);

				const deletedR = deleteFirstTextMatch(guard.initialDoc, "r");
				const deletedMd = guard.serialize(deletedR);
				expect(deletedMd).toBe('[r]: /u\n"a\n\n[s](/u)');
				expect(parseMarkdownToVisualDoc(deletedMd).eq(deletedR)).toBe(true);
				expect(
					collectLinkSegments(parseMarkdownToVisualDoc(deletedMd)),
				).toEqual([
					{ attrs: { href: "/u", title: null }, strong: false, text: "s" },
				]);

				const boldedR = addStrongToFirstTextMatch(guard.initialDoc, "r");
				const boldedMd = guard.serialize(boldedR);
				expect(boldedMd).toBe('[r]: /u\n"a\n\n[s](/u)[**r**][r]');
				expect(parseMarkdownToVisualDoc(boldedMd).eq(boldedR)).toBe(true);
				expect(collectLinkSegments(parseMarkdownToVisualDoc(boldedMd))).toEqual(
					[
						{ attrs: { href: "/u", title: null }, strong: false, text: "s" },
						{ attrs: { href: "/u", title: "a\n" }, strong: true, text: "r" },
					],
				);
			}

			// F1b: `[r][][s][]` with distinct partial titles `"a\n"` vs `"b\n"` —
			// deleting `s` must keep `[r]` with `title="a\n"` (not swap to `[r][s]`).
			{
				const md = '[r]: /u\n"a\n\n[s]: /u\n"b\n\n[r][][s][]';
				const guard = createMarkdownRoundTripGuard(md);
				const deletedS = deleteFirstTextMatch(guard.initialDoc, "s");
				const deletedMd = guard.serialize(deletedS);
				expect(deletedMd).toBe('[r]: /u\n"a\n\n[s]: /u\n"b\n\n[r][]');
				expect(parseMarkdownToVisualDoc(deletedMd).eq(deletedS)).toBe(true);
				expect(
					collectLinkSegments(parseMarkdownToVisualDoc(deletedMd)),
				).toEqual([
					{ attrs: { href: "/u", title: "a\n" }, strong: false, text: "r" },
				]);
			}

			// F1c: `[r][][s](/u)` — deleting or bolding `s` keeps `[r]` with `title="a\n"`.
			{
				const md = '[r]: /u\n"a\n\n[r][][s](/u)';
				const guard = createMarkdownRoundTripGuard(md);

				const deletedS = deleteFirstTextMatch(guard.initialDoc, "s");
				const deletedMd = guard.serialize(deletedS);
				expect(deletedMd).toBe('[r]: /u\n"a\n\n[r][]');
				expect(parseMarkdownToVisualDoc(deletedMd).eq(deletedS)).toBe(true);
				expect(
					collectLinkSegments(parseMarkdownToVisualDoc(deletedMd)),
				).toEqual([
					{ attrs: { href: "/u", title: "a\n" }, strong: false, text: "r" },
				]);

				const boldedS = addStrongToFirstTextMatch(guard.initialDoc, "s");
				const boldedMd = guard.serialize(boldedS);
				expect(boldedMd).toBe('[r]: /u\n"a\n\n[r][][**s**](/u)');
				expect(parseMarkdownToVisualDoc(boldedMd).eq(boldedS)).toBe(true);
				expect(collectLinkSegments(parseMarkdownToVisualDoc(boldedMd))).toEqual(
					[
						{ attrs: { href: "/u", title: "a\n" }, strong: false, text: "r" },
						{ attrs: { href: "/u", title: null }, strong: true, text: "s" },
					],
				);
			}
		});

		it("populates real PHP title and width scale on partial-title reference images and preserves untouched attrs on edit (Track A #3)", () => {
			const md = '[r]: /i.png\n"c {width=50%}" x\n\n![r]';
			const guard = createMarkdownRoundTripGuard(md);

			expect(firstImageAttrs(guard.initialDoc)).toMatchObject({
				alt: "r",
				scale: 50,
				src: "/i.png",
				title: "c",
			});

			// Edit ONLY src -> preserves title="c" AND width=50%
			{
				const edited = updateFirstImageAttrs(guard.initialDoc, {
					src: "/j.png",
				});
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'[r]: /i.png\n"c {width=50%}" x\n\n![r](/j.png "c {width=50%}")',
				);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(reparsed.eq(edited)).toBe(true);
				expect(firstImageAttrs(reparsed)).toMatchObject({
					scale: 50,
					src: "/j.png",
					title: "c",
				});
			}

			// Edit ONLY title -> preserves width=50%
			{
				const edited = updateFirstImageAttrs(guard.initialDoc, {
					title: "new",
				});
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'[r]: /i.png\n"c {width=50%}" x\n\n![r](/i.png "new {width=50%}")',
				);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(reparsed.eq(edited)).toBe(true);
				expect(firstImageAttrs(reparsed)).toMatchObject({
					scale: 50,
					src: "/i.png",
					title: "new",
				});
			}

			// Edit ONLY scale -> preserves title="c"
			{
				const edited = updateFirstImageAttrs(guard.initialDoc, { scale: 67 });
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'[r]: /i.png\n"c {width=50%}" x\n\n![r](/i.png "c {width=67%}")',
				);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(reparsed.eq(edited)).toBe(true);
				expect(firstImageAttrs(reparsed)).toMatchObject({
					scale: 67,
					src: "/i.png",
					title: "c",
				});
			}
		});
	});

	describe("2. Re-serialize untouched blocks and list items when referenced definitions are deleted or shadowed (Track A #2)", () => {
		it("re-serializes untouched list item inline when defining item is deleted", () => {
			const md = '- [r]: /u\n  "a\n- [r]\n  z';
			const guard = createMarkdownRoundTripGuard(md);
			const list = guard.initialDoc.child(0);
			const deletedFirstItem = guard.initialDoc.type.create(null, [
				list.type.create(list.attrs, [list.child(1)]),
			]);
			const serialized = guard.serialize(deletedFirstItem);
			expect(serialized).toBe('- [r](/u "a&#10;")\n  z');
			expect(parseMarkdownToVisualDoc(serialized).eq(deletedFirstItem)).toBe(
				true,
			);
		});

		it("re-serializes untouched top-level partial-title links, images, and ordinary refdefs on deletion", () => {
			// Partial-title link
			{
				const md = '[r]: /u\n"a\n\n[r]\n\nz';
				const guard = createMarkdownRoundTripGuard(md);
				const deleted = guard.initialDoc.type.create(null, [
					guard.initialDoc.child(2),
					guard.initialDoc.child(3),
				]);
				const serialized = guard.serialize(deleted);
				expect(serialized).toBe('[r](/u "a&#10;")\n\nz');
				expect(parseMarkdownToVisualDoc(serialized).eq(deleted)).toBe(true);
			}

			// Partial-title image with width scale
			{
				const md = '[r]: /i.png\n"c {width=50%}" x\n\n![r]\n\nz';
				const guard = createMarkdownRoundTripGuard(md);
				const deleted = guard.initialDoc.type.create(null, [
					guard.initialDoc.child(1),
					guard.initialDoc.child(2),
					guard.initialDoc.child(3),
				]);
				const serialized = guard.serialize(deleted);
				expect(serialized).toBe(
					'"c {width=50%}" x\n\n![r](/i.png "c {width=50%}")\n\nz',
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(deleted)).toBe(true);
			}

			// Ordinary refdef
			{
				const md = "[r]: /u\n\n[r]\n\nz";
				const guard = createMarkdownRoundTripGuard(md);
				const deleted = guard.initialDoc.type.create(null, [
					guard.initialDoc.child(1),
					guard.initialDoc.child(2),
				]);
				const serialized = guard.serialize(deleted);
				expect(serialized).toBe("[r](/u)\n\nz");
				expect(parseMarkdownToVisualDoc(serialized).eq(deleted)).toBe(true);
			}
		});

		it("re-serializes untouched blocks when an earlier refdef shadows, when follower quote closes, or when same-title sibling refdef is deleted", () => {
			// Shadowing an ordinary refdef
			{
				const md = "[r]: /u\n\n[r]\n\nz";
				const guard = createMarkdownRoundTripGuard(md);
				const shadowDef = visualEditorSchema.nodes.protected_block.create({
					kind: "raw",
					rawMarkdown: "[r]: /other",
				});
				const shadowed = guard.initialDoc.type.create(null, [
					shadowDef,
					guard.initialDoc.child(0),
					guard.initialDoc.child(1),
					guard.initialDoc.child(2),
				]);
				const serialized = guard.serialize(shadowed);
				expect(serialized).toBe("[r]: /other\n\n[r]: /u\n\n[r](/u)\n\nz");
				expect(parseMarkdownToVisualDoc(serialized).eq(shadowed)).toBe(true);
			}

			// Closing `"a` -> `"a"` forces blank line so `[r]: /u` does not absorb `"a"` and preserves `[r]`'s `"a\n"` title
			{
				const md = '[r]: /u\n"a\n\n[r]';
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, '"a', '"');
				const serialized = guard.serialize(edited);
				expect(serialized).toBe('[r]: /u\n\n"a"\n\n[r](/u "a&#10;")');
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			// Adjacent same-href AND same-title distinct refdefs: deleting `[r]: /u` still invalidates untouched `[r][][s][]`
			for (const useLiveDoc of [false, true]) {
				const md = '[r]: /u\n"a\n\n[s]: /u\n"a\n\n[r][][s][]\nz';
				const liveDoc = useLiveDoc ? parseMarkdownToVisualDoc(md) : undefined;
				const guard = createMarkdownRoundTripGuard(md, undefined, liveDoc);
				const base = guard.initialDoc;
				const withoutFirstDef = base.type.create(null, [
					base.child(1),
					base.child(2),
					base.child(3),
					base.child(4),
				]);
				const serialized = guard.serialize(withoutFirstDef);
				expect(serialized).toBe('"a\n\n[s]: /u\n"a\n\n[rs][s]\nz');
				expect(parseMarkdownToVisualDoc(serialized).eq(withoutFirstDef)).toBe(
					true,
				);
			}

			// Broken math-split sharedGroup in blockquote (`b"` -> `b"!`) preserves trailing space `"a \n"`
			{
				const md = '> [r]: /u\n> "a $$x$$\n> b"\n>\n> [r]\n>\n> z';
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, 'b"', "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'> [r]: /u\n>\n> "a\n\n$$x$$\n\n> b"!\n>\n> [r](/u "a &#10;")\n>\n> z',
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			// Untouched ATX heading and GFM table cell encode `\n` as `&#10;` when refdef is deleted
			for (const md of [
				'[r]: /u\n"a\n\n# [r]',
				'[r]: /u\n"a\n\n| [r] |\n| --- |',
			]) {
				const guard = createMarkdownRoundTripGuard(md);
				const deleted = guard.initialDoc.type.create(null, [
					guard.initialDoc.child(1),
					guard.initialDoc.child(2),
				]);
				const serialized = guard.serialize(deleted);
				expect(serialized, md).toContain('[r](/u "a&#10;")');
				expect(parseMarkdownToVisualDoc(serialized).eq(deleted), md).toBe(true);
			}
		});
	});

	describe("3. Fix isSwallowRisk dedenting of protected_block (Track B F4)", () => {
		it("dedents mermaid, math, toc, and multiline raw blocks cleanly when list shrinks", () => {
			const cases: ReadonlyArray<Readonly<{ expected: string; md: string }>> = [
				{
					expected: "- a\n-\n  # h!\n\n```mermaid\ngraph TD\nA-->B\n```",
					md: "- a\n-   # h\n  ```mermaid\n  graph TD\n  A-->B\n  ```",
				},
				{
					expected: "- a\n-\n  # h!\n\n$$\nx\n$$",
					md: "- a\n-   # h\n  $$\n  x\n  $$",
				},
				{
					expected:
						'> [r]: /u\n> "a\n>\n> - a\n> -\n>   # h!\n>\n> $$\n> x\n> $$\n>\n> [r]',
					md: '> [r]: /u\n> "a\n>\n> - a\n> -   # h\n>   $$\n>   x\n>   $$\n>\n> [r]',
				},
				{
					expected: "- a\n-\n  # h!\n\n[TOC]",
					md: "- a\n-   # h\n  [TOC]",
				},
				{
					expected: "- a\n-\n  # h!\n\n[k]:\n  /url",
					md: "- a\n-   # h\n  [k]:\n    /url",
				},
				{
					expected: "- a\n-\n  # h!\n\n[a]: /u\n[b]: /v",
					md: "- a\n-   # h\n  [a]: /u\n  [b]: /v",
				},
			];

			for (const { md, expected } of cases) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "h", "!");
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(expected);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
			}
		});

		it("preserves continuation-line indentation on pure 4-column isIndentedRisk display math", () => {
			const md = "p\n    $$\n    x\n    y\n    $$";
			const guard = createMarkdownRoundTripGuard(md);
			const edited = insertTextAfterFirstMatch(guard.initialDoc, "p", "!");
			const serialized = guard.serialize(edited);
			expect(serialized).toBe("p!\n\n$$\n    x\n    y\n    $$");
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(reparsed.child(0).textContent).toBe("p!");
			expect(reparsed.child(1).type.name).toBe("protected_block");
			expect(reparsed.child(1).attrs.kind).toBe("math");
			expect(reparsed.child(1).attrs.rawMarkdown).toBe(
				"$$\n    x\n    y\n    $$",
			);
		});
	});

	describe("4. Unified container preservation and tight partial-title joins across all depths (Track B F5 + F6)", () => {
		it("preserves list-in-blockquote, same-list-item, and blockquote-in-list partial-title references", () => {
			const cases: ReadonlyArray<Readonly<{ expected: string; md: string }>> = [
				{
					expected: '> - [r]: /u\n>   "a\n> - [r]\n>   z!',
					md: '> - [r]: /u\n>   "a\n> - [r]\n>   z',
				},
				{
					expected: '- [r]: /u\n  "a\n\n  [r]\n  z!',
					md: '- [r]: /u\n  "a\n\n  [r]\n  z',
				},
				{
					expected: '-\n  > [r]: /u\n  > "a\n  >\n  > [r]\n  > z!',
					md: '- > [r]: /u\n  > "a\n  >\n  > [r]\n  > z',
				},
			];
			for (const { md, expected } of cases) {
				for (const useLiveDoc of [false, true]) {
					const liveDoc = useLiveDoc ? parseMarkdownToVisualDoc(md) : undefined;
					const guard = createMarkdownRoundTripGuard(md, undefined, liveDoc);
					const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
					const serialized = guard.serialize(edited);
					expect(serialized, `${md} (liveDoc=${String(useLiveDoc)})`).toBe(
						expected,
					);
					expect(
						parseMarkdownToVisualDoc(serialized).eq(edited),
						`${md} (liveDoc=${String(useLiveDoc)})`,
					).toBe(true);
				}
			}
		});

		it("keeps tight newline between partial-title refdef and edited follower at top level and inside blockquotes", () => {
			for (const [md, expected] of [
				['[r]: /u\n"a\n\n[r]', '[r]: /u\n"a!\n\n[r]'],
				['> [r]: /u\n> "a\n>\n> [r]', '> [r]: /u\n> "a!\n>\n> [r]'],
			] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, '"a', "!");
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(expected);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(collectLinkSegments(reparsed), md).toEqual([
					{ attrs: { href: "/u", title: "a!\n" }, strong: false, text: "r" },
				]);
			}
		});

		it("re-serializes untouched list-in-blockquote item inline when defining item is deleted", () => {
			const md = '> - [r]: /u\n>   "a\n> - [r]\n>   z';
			const guard = createMarkdownRoundTripGuard(md);
			const bq = guard.initialDoc.child(0);
			const list = bq.child(0);
			const deletedFirstItem = guard.initialDoc.type.create(null, [
				bq.type.create(null, [list.type.create(list.attrs, [list.child(1)])]),
			]);
			const serialized = guard.serialize(deletedFirstItem);
			expect(serialized).toBe('> - [r](/u "a&#10;")\n>   z');
			expect(parseMarkdownToVisualDoc(serialized).eq(deletedFirstItem)).toBe(
				true,
			);
		});
	});
});
