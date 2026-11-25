import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
	parseMarkdownToVisualDoc,
	prescanMarkdown,
} from "../markdown-parser";
import {
	createMarkdownRoundTripGuard,
	serializeVisualDocToMarkdown,
} from "../markdown-serializer";

// Every expected serialization / structure below was verified against real PHP
// `EasyMDE\Content\MarkdownRenderer::render()` (original vs. round-tripped
// Markdown render identically).

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

function collectMarkNames(doc: ProseMirrorNode): string[] {
	const names: string[] = [];
	doc.descendants((node) => {
		for (const mark of node.marks) {
			names.push(mark.type.name);
		}
		return true;
	});
	return names;
}

describe("PR-R34-A immersive visual parser & preservation PHP parity", () => {
	describe("1. Untouched 4-column protected blocks dedent only their opening line (Track A #3)", () => {
		it("keeps continuation-line indentation of multi-line display math after editing the preceding paragraph", () => {
			for (const [md, needle, expected] of [
				[
					"p\n    $$\n    x\n    y\n    $$",
					"p",
					"p!\n\n$$\n    x\n    y\n    $$",
				],
				[
					"p\n    \\[\n    x\n    y\n    \\]",
					"p",
					"p!\n\n\\[\n    x\n    y\n    \\]",
				],
				[
					"p\n\t$$\n\tx\n\t  y\n\t$$",
					"p",
					"p!\n\n$$\n\tx\n\t  y\n\t$$",
				],
				["p\n    $$x\n    y$$", "p", "p!\n\n$$x\n    y$$"],
				["hello\n    $$x$$", "hello", "hello!\n\n$$x$$"],
			] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				expect(topLevelTypes(guard.initialDoc), md).toEqual([
					"paragraph",
					"protected_block",
				]);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, needle, "!");
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(expected);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(topLevelTypes(reparsed), md).toEqual([
					"paragraph",
					"protected_block",
				]);
				expect(reparsed.child(1).attrs.kind, md).toBe("math");
			}
		});

		it("keeps continuation-line indentation when the preceding refdef or paragraph is deleted", () => {
			for (const [md, expected] of [
				["[r]: /u\n    $$\n    x\n    y\n    $$", "$$\n    x\n    y\n    $$"],
				["p\n    $$\n    x\n    y\n    $$", "$$\n    x\n    y\n    $$"],
				["[r]: /u\n    $$x$$", "$$x$$"],
			] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				expect(guard.initialDoc.childCount, md).toBe(2);
				const deleted = guard.initialDoc.type.create(null, [
					guard.initialDoc.child(1),
				]);
				const serialized = guard.serialize(deleted);
				expect(serialized, md).toBe(expected);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(topLevelTypes(reparsed), md).toEqual(["protected_block"]);
				expect(reparsed.child(0).attrs.kind, md).toBe("math");
			}
		});

		it("still re-serializes untouched 4-column tables cleanly", () => {
			const guard = createMarkdownRoundTripGuard(
				"hello\n    | a | b |\n| --- | --- |",
			);
			const edited = insertTextAfterFirstMatch(guard.initialDoc, "hello", "!");
			expect(guard.serialize(edited)).toBe("hello!\n\n| a | b |\n| --- | --- |");
		});
	});

	describe("2. 4+-column lazy list continuations never start blocks (Track B Finding 2)", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["  2. x\n\t> y", 'doc(ordered_list(list_item(paragraph("x\\n> y"))))'],
			["  2. x\n    > y", 'doc(ordered_list(list_item(paragraph("x\\n> y"))))'],
			["  2. x\n    # h", 'doc(ordered_list(list_item(paragraph("x\\n# h"))))'],
			["  2. x\n    ---", 'doc(ordered_list(list_item(paragraph("x\\n---"))))'],
			[
				"  2. x\n    ```js\n    a\n    ```",
				'doc(ordered_list(list_item(paragraph("x\\n", code("js a ")))))',
			],
			[
				"  2. > [r]: /u\n\t> =",
				'doc(ordered_list(list_item(paragraph, blockquote(protected_block, paragraph("> =")))))',
			],
			[
				"  2. > hi\n\t> =",
				'doc(ordered_list(list_item(paragraph, blockquote(paragraph("hi\\n> =")))))',
			],
			[
				"  10. > a\n    > b",
				'doc(ordered_list(list_item(paragraph, blockquote(paragraph("a\\n> b")))))',
			],
			[
				">   2. x\n>     > y",
				'doc(blockquote(ordered_list(list_item(paragraph("x\\n> y")))))',
			],
			[
				"- a\n\n    2. x\n      > y",
				'doc(bullet_list(list_item(paragraph("a"), ordered_list(list_item(paragraph("x\\n> y"))))))',
			],
		];

		it("keeps lazy `>`/`#`/`---`/fence lines as paragraph text matching PHP", () => {
			for (const [md, expectedDoc] of cases) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(doc.toString(), md).toBe(expectedDoc);
				expect(topLevelTypes(doc), md).not.toContain("code_block");
			}
		});

		it("round-trips every reproducer through fresh serialization to an equal document", () => {
			for (const [md] of cases) {
				const doc = parseMarkdownToVisualDoc(md);
				const serialized = serializeVisualDocToMarkdown(doc);
				expect(parseMarkdownToVisualDoc(serialized).eq(doc), md).toBe(true);
			}
			expect(
				serializeVisualDocToMarkdown(parseMarkdownToVisualDoc("  2. x\n    > y")),
			).toBe("2. x\n   \\> y");
			expect(
				serializeVisualDocToMarkdown(
					parseMarkdownToVisualDoc("- a\n\n    2. x\n      > y"),
				),
			).toBe("- a\n\n  2. x\n     \\> y");
		});

		it("preserves controls: display math, 0-3 column lazy blocks, and refdef-indented blockquote text", () => {
			expect(parseMarkdownToVisualDoc("  2. x\n    $$a$$").toString()).toBe(
				'doc(ordered_list(list_item(paragraph("x"))), protected_block)',
			);
			expect(parseMarkdownToVisualDoc(">[r]: u\n\t>     c\n\t> =").toString()).toBe(
				'doc(blockquote(protected_block, paragraph(">     c\\n> =")))',
			);
			expect(parseMarkdownToVisualDoc("  2. x\n   > y").toString()).toBe(
				'doc(ordered_list(list_item(paragraph("x"))), blockquote(paragraph("y")))',
			);
			expect(parseMarkdownToVisualDoc("- x\n    > y").toString()).toBe(
				'doc(bullet_list(list_item(paragraph("x"), blockquote(paragraph("y")))))',
			);
			expect(parseMarkdownToVisualDoc("  2. x\n    y\n    ===").toString()).toBe(
				'doc(ordered_list(list_item(paragraph("x\\ny\\n==="))))',
			);
		});

		it("serializes a nested non-interrupting ordered list after a paragraph with a blank line", () => {
			for (const md of ["- a\n\n  2. x", "- a\n\n    2. x\n    y"]) {
				const doc = parseMarkdownToVisualDoc(md);
				const serialized = serializeVisualDocToMarkdown(doc);
				expect(serialized, md).toMatch(/^- a\n\n {2}2\. x/);
				expect(parseMarkdownToVisualDoc(serialized).eq(doc), md).toBe(true);
			}
			expect(serializeVisualDocToMarkdown(parseMarkdownToVisualDoc("- a\n  1. x"))).toBe(
				"- a\n  1. x",
			);
		});
	});

	describe("3. Inline-masked refdef continuation keeps scanning past contained display math (Track B Finding 4)", () => {
		it("splits the opening display math and never fabricates emphasis or links", () => {
			for (const md of [
				"[a *em $$x$$\nb* $$y$$\nc]: /u",
				"[a $$x$$\nb $$y$$]:\n/u",
				'[r]: /u\n"a *em $$x$$\nb* $$y$$\nc"\n\n[r]',
			]) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(collectMarkNames(doc), md).not.toContain("em");
				const types = topLevelTypes(doc);
				const mathIdx = types.indexOf("protected_block", md.startsWith("[r]") ? 1 : 0);
				expect(mathIdx, md).toBeGreaterThan(0);
				expect(doc.child(mathIdx).attrs.kind, md).toBe("math");
				expect(doc.child(mathIdx).attrs.rawMarkdown, md).toBe("$$x$$");
			}
			expect(
				parseMarkdownToVisualDoc("[a *em $$x$$\nb* $$y$$\nc]: /u").toString(),
			).toBe(
				'doc(paragraph("[a *em"), protected_block, paragraph("b* ", protected_inline, "\\nc]: /u"))',
			);
		});

		it("keeps unterminated label/title continuations inline", () => {
			expect(topLevelTypes(parseMarkdownToVisualDoc("[a $$x$$\nb $$y$$\nc"))).toEqual(
				["paragraph"],
			);
		});

		it("stays amortized O(N) for long unclosed labels and titles full of display math", () => {
			const samples: ReadonlyArray<readonly [string, string]> = [
				["unclosed_double_quote_title", `[r]: /u\n"${"a $$x$$\n".repeat(4_000)}`],
				["unclosed_single_quote_title", `[r]: /u\n'${"a $$x$$\n".repeat(4_000)}`],
				["unclosed_paren_title", `[r]: /u\n(${"a $$x$$\n".repeat(4_000)}`],
				["unclosed_label", `[a $$x$$\n${"b $$y$$\n".repeat(4_000)}`],
				[
					"title_closed_at_end",
					`[r]: /u\n"${"a $$x$$\n".repeat(4_000)}z"\n\n[r]`,
				],
			];
			for (const [label, md] of samples) {
				const start = performance.now();
				prescanMarkdown(md);
				const elapsed = performance.now() - start;
				expect(elapsed, label).toBeLessThan(1_000);
			}
		});
	});
});
