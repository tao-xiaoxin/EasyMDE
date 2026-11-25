import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
	parseMarkdownToVisualDoc,
	prescanMarkdown,
} from "../markdown-parser";
import { createPhpDocumentMathIndex } from "../markdown-prescanner-tables";
import { createMarkdownRoundTripGuard } from "../markdown-serializer";
import { visualEditorSchema } from "../visual-schema";

// Every expected serialization / structure below was verified against real PHP
// `EasyMDE\Content\MarkdownRenderer::render()` and `render_preview()`.

function topLevelTypes(doc: ProseMirrorNode): string[] {
	return Array.from({ length: doc.childCount }, (_, idx) => {
		return doc.child(idx).type.name;
	});
}

function insertTextAfterFirstMatch(
	doc: ProseMirrorNode,
	needle: string,
	insertion: string,
): ProseMirrorNode {
	let targetPos = -1;
	doc.descendants((node, pos) => {
		if (targetPos >= 0 || !node.isText || !node.text) {
			return targetPos < 0;
		}
		const idx = node.text.indexOf(needle);
		if (idx >= 0) {
			targetPos = pos + idx + needle.length;
			return false;
		}
		return true;
	});
	expect(targetPos, `Could not find "${needle}" in doc`).toBeGreaterThanOrEqual(
		0,
	);
	const state = EditorState.create({ doc });
	return state.apply(state.tr.insertText(insertion, targetPos)).doc;
}

function replaceTextMatch(
	doc: ProseMirrorNode,
	needle: string,
	replacement: string,
): ProseMirrorNode {
	let targetFrom = -1;
	let targetTo = -1;
	doc.descendants((node, pos) => {
		if (targetFrom >= 0 || !node.isText || !node.text) {
			return targetFrom < 0;
		}
		const idx = node.text.indexOf(needle);
		if (idx >= 0) {
			targetFrom = pos + idx;
			targetTo = targetFrom + needle.length;
			return false;
		}
		return true;
	});
	expect(targetFrom, `Could not find "${needle}" in doc`).toBeGreaterThanOrEqual(
		0,
	);
	const state = EditorState.create({ doc });
	return state.apply(state.tr.insertText(replacement, targetFrom, targetTo))
		.doc;
}

function replaceLastListItemBody(
	doc: ProseMirrorNode,
	replacement: ProseMirrorNode[],
): ProseMirrorNode {
	const list = doc.child(0);
	const items: ProseMirrorNode[] = [];
	for (let i = 0; i < list.childCount; i += 1) {
		if (i === list.childCount - 1) {
			items.push(list.child(i).type.create(list.child(i).attrs, replacement));
		} else {
			items.push(list.child(i));
		}
	}
	const nextList = list.type.create(list.attrs, items);
	const rest: ProseMirrorNode[] = [];
	for (let i = 1; i < doc.childCount; i += 1) {
		rest.push(doc.child(i));
	}
	return doc.type.create(null, [nextList, ...rest]);
}

function findFirstLinkAttrs(
	doc: ProseMirrorNode,
): Readonly<{ href: string; title: string | null }> | null {
	let found: Readonly<{ href: string; title: string | null }> | null = null;
	doc.descendants((node) => {
		if (found !== null) return false;
		if (node.isText) {
			const link = node.marks.find((m) => m.type.name === "link");
			if (link) {
				found = {
					href: String(link.attrs.href ?? ""),
					title:
						typeof link.attrs.title === "string" ? link.attrs.title : null,
				};
				return false;
			}
		}
		return true;
	});
	return found;
}

function updateFirstLinkMark(
	doc: ProseMirrorNode,
	attrs: Readonly<{ href: string; title: string | null }>,
): ProseMirrorNode {
	let from = -1;
	let to = -1;
	doc.descendants((node, pos) => {
		if (from >= 0) return false;
		if (node.isText && node.marks.some((m) => m.type.name === "link")) {
			from = pos;
			to = pos + node.nodeSize;
			return false;
		}
		return true;
	});
	expect(from, "Could not find link text in doc").toBeGreaterThanOrEqual(0);
	const state = EditorState.create({ doc });
	const tr = state.tr
		.removeMark(from, to, visualEditorSchema.marks.link)
		.addMark(from, to, visualEditorSchema.marks.link.create(attrs));
	return state.apply(tr).doc;
}

describe("PR-R36-A immersive visual preservation, ref-link parity, and linear math scan", () => {
	describe("1. Linear monotonic lineEnds scan in createPhpDocumentMathIndex (Track A #2)", () => {
		it("scans 1 MiB single-line and two-line dense inline math in linear time without O(N^2) indexOf", () => {
			const denseSingleLine = "$x$ ".repeat(262_144);
			expect(denseSingleLine.length).toBe(1_048_576);
			// Warm up once on a small sample to avoid JIT noise.
			prescanMarkdown("$x$ ".repeat(64));

			const startSingle = performance.now();
			const singleResult = prescanMarkdown(denseSingleLine);
			const elapsedSingle = performance.now() - startSingle;
			expect(singleResult.protectedBlocks.size).toBe(0);
			expect(singleResult.protectedInlines.size).toBe(262_144);
			expect(elapsedSingle).toBeLessThanOrEqual(2_500);

			// Exercise the monotonic `lineCursor` loop directly across 262,144 spans on line 0.
			const denseTwoLine = `${denseSingleLine}\nend`;
			const twoLineLines = denseTwoLine.split("\n");
			const startTwoLine = performance.now();
			const mathIndex = createPhpDocumentMathIndex(denseTwoLine, twoLineLines);
			const elapsedTwoLine = performance.now() - startTwoLine;
			expect(mathIndex.ranges.length).toBe(262_144);
			expect(mathIndex.hasMultilineInlineMath).toBe(false);
			expect(mathIndex.hasMultilineDisplayMath).toBe(false);
			expect(elapsedTwoLine).toBeLessThanOrEqual(2_500);
		});

		it("detects multiline inline and display math accurately across line boundaries", () => {
			const cases: ReadonlyArray<
				readonly [string, boolean, boolean]
			> = [
				["$a$ $b$\n$c$", false, false],
				["\\(a\nb\\)\n$c$", true, false],
				["$a$\n$$\nx\n$$", false, true],
				["$a$ \\(x\ny\\)\n$$\nz\n$$", true, true],
				["$$x$$", false, false],
				["\\(x\\)", false, false],
			];
			for (const [md, expectInline, expectDisplay] of cases) {
				const idx = createPhpDocumentMathIndex(md, md.split("\n"));
				expect(idx.hasMultilineInlineMath, md).toBe(expectInline);
				expect(idx.hasMultilineDisplayMath, md).toBe(expectDisplay);
			}
		});
	});

	describe("2. Preserve reference link syntax/title on same-paragraph unrelated edits (Track A #3)", () => {
		it("preserves reference syntax on untouched math-split and unclosed multiline refdef titles when editing z -> z!", () => {
			for (const md of [
				'[r]: /u\n"a $$x$$\nb"\n\n[r]\nz',
				'[r]: /u\n"a $$x$$\nb $$y$$\nc"\n\n[r]\nz',
				'[r]: /u\n"$$x$$\nb"\n\n[r]\nz',
				"[r]: /u\n'a $$x$$\nb'\n\n[r]\nz",
				"[r]: /u\n(a $$x$$\nb)\n\n[r]\nz",
				'[r]: /u\n"a\n\n[r]\nz',
				'> [r]: /u\n> "a $$x$$\n> b"\n\n[r]\nz',
				'[r]: /u\n"a $$x$$\nb"\n\nhello [r]\nz',
				'[r]: /u\n"a $$x$$\nb"\n\n[click][r] and [r][] and [r]\nz',
			]) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(`${md}!`);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
			}
		});

		it("preserves href and title for normal titled refdefs when editing z -> z!", () => {
			const md = '[r]: /u "my title"\n\n[r]\nz';
			const guard = createMarkdownRoundTripGuard(md);
			const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
			const serialized = guard.serialize(edited);
			expect(serialized).toBe('[r]: /u "my title"\n\n[r](/u "my title")\nz!');
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(reparsed.eq(edited)).toBe(true);
			expect(findFirstLinkAttrs(reparsed)).toEqual({
				href: "/u",
				title: "my title",
			});
		});

		it("updates link cleanly when editing href or title via visual link editing", () => {
			for (const md of [
				'[r]: /u\n"a $$x$$\nb"\n\n[r]\nz',
				'[r]: /u "my title"\n\n[r]\nz',
			]) {
				const guard = createMarkdownRoundTripGuard(md);
				const editedHref = updateFirstLinkMark(guard.initialDoc, {
					href: "/updated",
					title: "new title",
				});
				const serialized = guard.serialize(editedHref);
				expect(serialized, md).toContain('[r](/updated "new title")\nz');
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(reparsed.eq(editedHref), md).toBe(true);
				expect(findFirstLinkAttrs(reparsed), md).toEqual({
					href: "/updated",
					title: "new title",
				});
			}
		});

		it("guards against shortcut hijacking, deleted refdefs, and rebound liveDocs", () => {
			const baseMd = '[r]: /u\n"a $$x$$\nb"\n\n[r]\nz';

			// 1. Replacing `\nz` immediately after `[r]` with `(foo)`, `[bar]`, or `: /other`
			//    upgrades shortcut `[r]` to collapsed `[r][]` so it cannot be hijacked.
			for (const tail of ["(foo)", "[bar]", ": /other"]) {
				const guard = createMarkdownRoundTripGuard(baseMd);
				const edited = replaceTextMatch(guard.initialDoc, "\nz", tail);
				const serialized = guard.serialize(edited);
				expect(serialized, tail).toContain(`[r][]${tail}`);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited), tail).toBe(
					true,
				);
			}

			// 2. Deleting block 0 (`[r]: /u`) while editing `z -> z!` falls back to inline `[r](/u)`.
			{
				const guard = createMarkdownRoundTripGuard(baseMd);
				const editedZ = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const remaining = Array.from(
					{ length: editedZ.childCount - 1 },
					(_, idx) => editedZ.child(idx + 1),
				);
				const withoutRefDef = editedZ.type.create(null, remaining);
				const serialized = guard.serialize(withoutRefDef);
				expect(serialized).toContain('[r](/u "a &#10;")\nz!');
				expect(parseMarkdownToVisualDoc(serialized).eq(withoutRefDef)).toBe(
					true,
				);
			}

			// 3. Rebound `liveDoc` (structurally equal separate doc instance) still preserves `[r]`.
			{
				const liveDoc = parseMarkdownToVisualDoc(baseMd);
				const guard = createMarkdownRoundTripGuard(baseMd, undefined, liveDoc);
				const edited = insertTextAfterFirstMatch(liveDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(`${baseMd}!`);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}
		});
	});

	describe("3. Transitive memoized O(N) isTightRightNeighborIntact (Track B Finding 1)", () => {
		it("cascades broken tight right neighbors across 2-deep and 3-deep sharedGroup chains", () => {
			// Minimal 2-deep reproducer: deleting `    baz` must break both tight shared groups.
			{
				const md = "foo $$x$$\n[r]: /u $$y$$\n    baz";
				const guard = createMarkdownRoundTripGuard(md);
				expect(topLevelTypes(guard.initialDoc)).toEqual([
					"paragraph",
					"protected_block",
					"protected_block",
					"protected_block",
					"code_block",
				]);
				const edited = guard.initialDoc.type.create(null, [
					guard.initialDoc.child(0),
					guard.initialDoc.child(1),
					guard.initialDoc.child(2),
					guard.initialDoc.child(3),
				]);
				const serialized = guard.serialize(edited);
				expect(serialized).toBe("foo\n\n$$x$$\n\n[r]: /u \n\n$$y$$");
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			// 3-deep tight chain: deleting final `    baz` must break all 3 shared groups.
			{
				const md = "foo $$x$$\n[r1]: /u1 $$y$$\n[r2]: /u2 $$z$$\n    baz";
				const guard = createMarkdownRoundTripGuard(md);
				const remaining = Array.from(
					{ length: guard.initialDoc.childCount - 1 },
					(_, idx) => guard.initialDoc.child(idx),
				);
				const edited = guard.initialDoc.type.create(null, remaining);
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					"foo\n\n$$x$$\n\n[r1]: /u1 \n\n$$y$$\n\n[r2]: /u2 \n\n$$z$$",
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			// Positive control: untouched tight chain stays verbatim when editing an unrelated tail block.
			{
				const md = "foo $$x$$\n[r]: /u $$y$$\n    baz\n\ntail";
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "tail", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe("foo $$x$$\n[r]: /u $$y$$\n    baz\n\ntail!");
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}
		});

		it("handles deep tight sharedGroup chains iteratively without stack overflow or quadratic slowdown", () => {
			const chainLines = Array.from(
				{ length: 2_000 },
				(_, i) => `[r${i}]: /u${i} $$x${i}$$`,
			);
			const md = `foo $$a$$\n${chainLines.join("\n")}\n    baz`;
			const guard = createMarkdownRoundTripGuard(md);
			const remaining = Array.from(
				{ length: guard.initialDoc.childCount - 1 },
				(_, idx) => guard.initialDoc.child(idx),
			);
			const edited = guard.initialDoc.type.create(null, remaining);
			const start = performance.now();
			const serialized = guard.serialize(edited);
			const elapsed = performance.now() - start;
			expect(serialized.startsWith("foo\n\n$$a$$\n\n[r0]: /u0 ")).toBe(true);
			expect(elapsed).toBeLessThanOrEqual(2_500);
		});
	});

	describe("4. Separate Setext headings and 4-column indented code blocks after edited lazy predecessors (Track B Finding 2)", () => {
		const helloParagraph = [
			visualEditorSchema.nodes.paragraph.create(
				null,
				visualEditorSchema.text("hello"),
			),
		];

		it("emits a blank line before untouched 4-column or tab-indented code blocks after editing a preceding list item to a paragraph", () => {
			for (const [md, expected] of [
				["100. first\n101. # h\n    code", "100. first\n101. hello\n\n    code"],
				[
					"100. first\n101. ***\n    $$x$$",
					"100. first\n101. hello\n\n    $$x$$",
				],
				[
					"100. first\n101. # h\n    code $$x$$",
					"100. first\n101. hello\n\n    code $$x$$",
				],
				["100. first\n101. # h\n\tcode", "100. first\n101. hello\n\n\tcode"],
			] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				expect(topLevelTypes(guard.initialDoc), md).toEqual([
					"ordered_list",
					"code_block",
				]);
				const edited = replaceLastListItemBody(guard.initialDoc, helloParagraph);
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(expected);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(reparsed.eq(edited), md).toBe(true);
				expect(topLevelTypes(reparsed), md).toEqual([
					"ordered_list",
					"code_block",
				]);
			}
		});

		it("emits a blank line before untouched Setext headings after editing a preceding list item to a paragraph", () => {
			for (const [md, expected, expectedLevel] of [
				[
					"- item 1\n- # h\nHeading\n===",
					"- item 1\n- hello\n\nHeading\n===",
					1,
				],
				[
					"- item 1\n- # h\nHeading\n---",
					"- item 1\n- hello\n\nHeading\n---",
					2,
				],
			] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				expect(topLevelTypes(guard.initialDoc), md).toEqual([
					"bullet_list",
					"heading",
				]);
				const edited = replaceLastListItemBody(guard.initialDoc, helloParagraph);
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(expected);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(reparsed.eq(edited), md).toBe(true);
				expect(topLevelTypes(reparsed), md).toEqual(["bullet_list", "heading"]);
				expect(reparsed.child(1).attrs.level, md).toBe(expectedLevel);
			}
		});

		it("keeps ATX headings and fenced code blocks tight when tight separation was preserved", () => {
			for (const [md, expected, secondType] of [
				["- item 1\n- # h\n# ATX", "- item 1\n- hello\n# ATX", "heading"],
				[
					"- item 1\n- # h\n```\ncode\n```",
					"- item 1\n- hello\n```\ncode\n```",
					"code_block",
				],
			] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = replaceLastListItemBody(guard.initialDoc, helloParagraph);
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(expected);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(reparsed.eq(edited), md).toBe(true);
				expect(topLevelTypes(reparsed), md).toEqual(["bullet_list", secondType]);
			}
		});
	});
});
