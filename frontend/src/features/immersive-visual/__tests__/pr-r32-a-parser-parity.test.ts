import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it, vi } from "vitest";
import {
	advanceParagraphReferenceParser,
	cloneParagraphReferenceParser,
	createParagraphReferenceParser,
} from "../../../shared/markdown/php-commonmark-reference-def";
import {
	parseMarkdownToVisualDoc,
	prescanMarkdown,
} from "../markdown-parser";
import {
	createPhpDocumentMathIndex,
	matchTableAlignmentMarkerLine,
	startsParagraphInterruptingBlock,
} from "../markdown-prescanner-tables";
import { createMarkdownRoundTripGuard } from "../markdown-serializer";

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

function findFirstNodeByType(
	doc: ProseMirrorNode,
	typeName: string,
): ProseMirrorNode | null {
	let found: ProseMirrorNode | null = null;
	doc.descendants((node) => {
		if (found === null && node.type.name === typeName) {
			found = node;
			return false;
		}
		return found === null;
	});
	return found;
}

function collectProtectedInlineRaws(doc: ProseMirrorNode): string[] {
	const raws: string[] = [];
	doc.descendants((node) => {
		if (
			node.type.name === "protected_inline" &&
			typeof node.attrs.rawMarkdown === "string"
		) {
			raws.push(node.attrs.rawMarkdown);
		}
		return true;
	});
	return raws;
}

describe("PR-R32-A immersive visual parser PHP parity & deduplication", () => {
	describe("1. Lazy-container vs indented-continuation table bug & shared guard (Track A #1 + Track B F1/F6)", () => {
		it("enforces exact PHP lazy-continuation vs indented-code interruption rules in startsParagraphInterruptingBlock", () => {
			// Lazy ParagraphParser continuation (`allowIndentedCode: false`):
			// 4+ spaces never interrupt, Setext `===` and Type 7 HTML never interrupt,
			// while ATX headings, blockquotes, fences, HRs, HTML Types 1–6, and ANY list marker interrupt.
			expect(startsParagraphInterruptingBlock("    # h", 0)).toBe(false);
			expect(startsParagraphInterruptingBlock("    - foo", 0)).toBe(false);
			expect(startsParagraphInterruptingBlock("    plain", 0)).toBe(false);
			expect(startsParagraphInterruptingBlock("===", 0)).toBe(false);
			expect(startsParagraphInterruptingBlock("<span>", 0)).toBe(false);
			expect(startsParagraphInterruptingBlock("plain", 0)).toBe(false);
			expect(
				startsParagraphInterruptingBlock("# h", 4, {
					allowIndentedCode: false,
					relativeIndentColumns: 4,
				}),
			).toBe(false);

			for (const interrupting of [
				"# h",
				"> q",
				"```",
				"---",
				"- foo",
				"* foo",
				"- ",
				"2. foo",
				"01. foo",
				"<div>",
				"<!-- comment -->",
			]) {
				expect(
					startsParagraphInterruptingBlock(interrupting, 0, {
						allowIndentedCode: false,
					}),
					interrupting,
				).toBe(true);
			}

			// Active TableParser continuation (`allowIndentedCode: true`):
			// 4+ spaces opens an indented code block and interrupts.
			expect(
				startsParagraphInterruptingBlock("    foo", 0, {
					allowIndentedCode: true,
				}),
			).toBe(true);
			expect(
				startsParagraphInterruptingBlock("\tfoo", 0, {
					allowIndentedCode: true,
				}),
			).toBe(true);
			expect(
				startsParagraphInterruptingBlock("===", 0, {
					allowIndentedCode: true,
				}),
			).toBe(false);
			expect(
				startsParagraphInterruptingBlock("<span>", 0, {
					allowIndentedCode: true,
				}),
			).toBe(false);
		});

		it("never swallows container-interrupting blocks into spurious tables on lazy continuations", () => {
			// All 14 empirically confirmed PHP-negative reproducers: 0 tables.
			const negativeCases: ReadonlyArray<
				Readonly<{ expectedTop: string[]; md: string }>
			> = [
				{
					expectedTop: ["bullet_list", "heading", "paragraph"],
					md: "- x\n# a | b\n  | - | - |",
				},
				{
					expectedTop: ["bullet_list", "heading", "paragraph"],
					md: "- a | b\n# h\n  | - |",
				},
				{
					expectedTop: ["bullet_list", "blockquote"],
					md: "- a | b\n> q\n  | - |",
				},
				{
					expectedTop: ["bullet_list", "code_block"],
					md: "- a | b\n```\n  | - |",
				},
				{
					expectedTop: ["bullet_list", "horizontal_rule", "paragraph"],
					md: "- a | b\n---\n  | - |",
				},
				{
					expectedTop: ["bullet_list"],
					md: "- a | b\n- foo\n  | - |",
				},
				{
					expectedTop: ["bullet_list", "bullet_list"],
					md: "- a | b\n* foo\n  | - |",
				},
				{
					expectedTop: ["bullet_list"],
					md: "- a | b\n- \n  | - |",
				},
				{
					expectedTop: ["bullet_list", "ordered_list"],
					md: "- a | b\n2. foo\n  | - |",
				},
				{
					expectedTop: ["bullet_list", "ordered_list"],
					md: "- a | b\n01. foo\n  | - |",
				},
				{
					expectedTop: ["bullet_list", "heading", "paragraph"],
					md: "- a\n# b | c\n  | - | - |",
				},
				{
					expectedTop: ["bullet_list"],
					md: "- - a | b\n  # h\n    | - |",
				},
				{
					expectedTop: ["bullet_list"],
					md: "- - a | b\n  2. foo\n    | - |",
				},
				{
					expectedTop: ["blockquote"],
					md: "> - a | b\n> # h\n>   | - |",
				},
				// Blockquote outer lazy interruptions verified against real PHP:
				// `$parserState->getParagraphContent()` is `null` on lazy lines, so `2. foo`, `01. foo`, `- `, `# h`, `---` end the blockquote.
				{
					expectedTop: ["blockquote", "ordered_list", "blockquote"],
					md: "> a | b\n2. foo\n> | - |",
				},
				{
					expectedTop: ["blockquote", "ordered_list", "blockquote"],
					md: "> a | b\n01. foo\n> | - |",
				},
				{
					expectedTop: ["blockquote", "bullet_list", "blockquote"],
					md: "> a | b\n- \n> | - |",
				},
				{
					expectedTop: ["blockquote", "heading", "blockquote"],
					md: "> a | b\n# h\n> | - |",
				},
				{
					expectedTop: ["blockquote", "horizontal_rule", "blockquote"],
					md: "> a | b\n---\n> | - |",
				},
				// Deeply nested list where 4 spaces match two outer lists, leaving 0 < 4 before `# h`.
				{
					expectedTop: ["bullet_list"],
					md: "- - - a | b\n    # h\n      | - |",
				},
				// Prescanned protected block sentinels (e.g. mermaid) must never be swallowed as a table header.
				{
					expectedTop: ["paragraph", "protected_block", "paragraph"],
					md: "a | b\n```mermaid\ngraph TD\n```\n| - |",
				},
				{
					expectedTop: ["bullet_list", "protected_block", "paragraph"],
					md: "- a | b\n```mermaid\ngraph TD\n```\n  | - |",
				},
			];

			for (const { expectedTop, md } of negativeCases) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual(expectedTop);
				expect(findFirstNodeByType(doc, "table"), md).toBeNull();
			}

			// Verify nested structure details on key negative cases.
			const nestedH1 = parseMarkdownToVisualDoc("- - a | b\n  # h\n    | - |");
			const outerItemH1 = nestedH1.child(0).child(0);
			expect(topLevelTypes(outerItemH1)).toEqual([
				"paragraph",
				"bullet_list",
				"heading",
				"paragraph",
			]);
			expect(outerItemH1.child(2).attrs.level).toBe(1);
			expect(outerItemH1.child(2).textContent).toBe("h");

			const nestedOrdered = parseMarkdownToVisualDoc(
				"- - a | b\n  2. foo\n    | - |",
			);
			const outerItemOrd = nestedOrdered.child(0).child(0);
			expect(topLevelTypes(outerItemOrd)).toEqual([
				"paragraph",
				"bullet_list",
				"ordered_list",
			]);
			expect(outerItemOrd.child(2).attrs.order).toBe(2);

			const bqListH1 = parseMarkdownToVisualDoc("> - a | b\n> # h\n>   | - |");
			expect(topLevelTypes(bqListH1.child(0))).toEqual([
				"bullet_list",
				"heading",
				"paragraph",
			]);

			// Edit round-trip on `- x\n# a | b\n  | - | - |`: editing `x` -> `xZ` preserves H1 `# a | b` and 0 tables.
			const guard = createMarkdownRoundTripGuard("- x\n# a | b\n  | - | - |");
			expect(topLevelTypes(guard.initialDoc)).toEqual([
				"bullet_list",
				"heading",
				"paragraph",
			]);
			expect(guard.initialDoc.child(1).attrs.level).toBe(1);
			expect(guard.initialDoc.child(1).textContent).toBe("a | b");
			expect(guard.serialize(guard.initialDoc)).toBe(
				"- x\n# a | b\n  | - | - |",
			);

			const edited = insertTextAfterFirstMatch(guard.initialDoc, "x", "Z");
			const serialized = guard.serialize(edited);
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(topLevelTypes(reparsed)).toEqual([
				"bullet_list",
				"heading",
				"paragraph",
			]);
			expect(reparsed.child(1).attrs.level).toBe(1);
			expect(reparsed.child(1).textContent).toBe("a | b");
			expect(findFirstNodeByType(reparsed, "table")).toBeNull();
			expect(reparsed.eq(edited)).toBe(true);
		});

		it("preserves all valid PHP lazy-container and 4-space indented-continuation tables", () => {
			// Setext `===` does NOT interrupt lazy continuations -> stays a table.
			const bqListSetext = parseMarkdownToVisualDoc(
				"> - a | b\n> ===\n>   | - |",
			);
			expect(topLevelTypes(bqListSetext)).toEqual(["blockquote"]);
			const bqListItem = bqListSetext.child(0).child(0).child(0);
			expect(topLevelTypes(bqListItem)).toEqual(["paragraph", "table"]);
			expect(bqListItem.child(1).child(0).child(0).textContent).toBe("===");

			const bqSetext = parseMarkdownToVisualDoc("> a | b\n===\n> | - |");
			expect(topLevelTypes(bqSetext.child(0))).toEqual(["paragraph", "table"]);
			expect(bqSetext.child(0).child(1).child(0).child(0).textContent).toBe(
				"===",
			);

			const listSetext = parseMarkdownToVisualDoc("- a | b\n===\n  | - |");
			expect(topLevelTypes(listSetext.child(0).child(0))).toEqual([
				"paragraph",
				"table",
			]);

			// Plain lazy continuation headers inside blockquote and list.
			const bqLazy = parseMarkdownToVisualDoc("> a | b\nc\n> | - |");
			expect(topLevelTypes(bqLazy.child(0))).toEqual(["paragraph", "table"]);
			expect(bqLazy.child(0).child(1).child(0).child(0).textContent).toBe("c");

			const listLazy = parseMarkdownToVisualDoc("- a | b\nc\n  | - |");
			expect(topLevelTypes(listLazy.child(0).child(0))).toEqual([
				"paragraph",
				"table",
			]);
			expect(
				listLazy.child(0).child(0).child(1).child(0).child(0).textContent,
			).toBe("c");

			// 4-space indented lazy continuations (indent >= 4 at outer container cannot open ATX heading).
			const bq4SpH1 = parseMarkdownToVisualDoc("> a | b\n    # h\n> | - |");
			expect(topLevelTypes(bq4SpH1.child(0))).toEqual(["paragraph", "table"]);
			expect(bq4SpH1.child(0).child(1).child(0).child(0).textContent).toBe(
				"# h",
			);

			const list10004SpH1 = parseMarkdownToVisualDoc(
				"1000. a | b\n    # h\n      | - |",
			);
			expect(topLevelTypes(list10004SpH1.child(0).child(0))).toEqual([
				"paragraph",
				"table",
			]);
			expect(
				list10004SpH1.child(0).child(0).child(1).child(0).child(0).textContent,
			).toBe("# h");

			// 4-space indented non-lazy continuations inside top-level paragraph and list.
			const topIndented = parseMarkdownToVisualDoc("a\n    b | c\n| - | - |");
			expect(topLevelTypes(topIndented)).toEqual(["paragraph", "table"]);
			expect(topIndented.child(1).child(0).child(0).textContent).toBe("b");
			expect(topIndented.child(1).child(0).child(1).textContent).toBe("c");

			const listIndented = parseMarkdownToVisualDoc(
				"- p\n      h1 | h2\n  | - | - |",
			);
			const listIndentedItem = listIndented.child(0).child(0);
			expect(topLevelTypes(listIndentedItem)).toEqual(["paragraph", "table"]);
			expect(listIndentedItem.child(1).child(0).child(0).textContent).toBe(
				"h1",
			);
			expect(listIndentedItem.child(1).child(0).child(1).textContent).toBe(
				"h2",
			);
		});
	});

	describe("2. Indented Setext heading & paragraph after valid reference definition (Track A #3)", () => {
		it("parses indented Setext headings immediately after display-math and standalone refdefs matching PHP", () => {
			// Primary reproducer: `$$x$$ [r]: /u\n    a\n===` -> math + refdef + H1 `a`.
			const mathGuard = createMarkdownRoundTripGuard("$$x$$ [r]: /u\n    a\n===");
			expect(topLevelTypes(mathGuard.initialDoc)).toEqual([
				"protected_block",
				"protected_block",
				"heading",
			]);
			expect(mathGuard.initialDoc.child(0).attrs.kind).toBe("math");
			expect(mathGuard.initialDoc.child(1).attrs.rawMarkdown).toBe("[r]: /u");
			expect(mathGuard.initialDoc.child(2).attrs.level).toBe(1);
			expect(mathGuard.initialDoc.child(2).textContent).toBe("a");
			expect(mathGuard.serialize(mathGuard.initialDoc)).toBe(
				"$$x$$ [r]: /u\n    a\n===",
			);

			// Editing `a` -> `aZ` preserves H1 instead of corrupting into `<p>aZ\n===</p>`.
			const editedMath = insertTextAfterFirstMatch(
				mathGuard.initialDoc,
				"a",
				"Z",
			);
			const serializedMath = mathGuard.serialize(editedMath);
			const reparsedMath = parseMarkdownToVisualDoc(serializedMath);
			expect(topLevelTypes(reparsedMath)).toEqual([
				"protected_block",
				"protected_block",
				"heading",
			]);
			expect(reparsedMath.child(2).attrs.level).toBe(1);
			expect(reparsedMath.child(2).textContent).toBe("aZ");
			expect(reparsedMath.eq(editedMath)).toBe(true);

			// Top-level Setext H1/H2, multiline indented lines, tabs, titled refdef, chained refdefs, and `- item` / `> quote`.
			for (const [md, expectedLevel, expectedText] of [
				["[r]: /u\n    a\n===", 1, "a"],
				["[r]: /u\n    a\n---", 2, "a"],
				["[r]: /u\n    a\n    b\n===", 1, "a\nb"],
				["[r]: /u\n    a\n    b\n---", 2, "a\nb"],
				["[r]: /u\n\t\ta\n===", 1, "a"],
				['[r]: /u\n"t"\n    a\n===', 1, "a"],
				["[r]: /u\n    [r2]: /v\n    a\n===", 1, "a"],
				["[r]: /u\n    - item\n===", 1, "- item"],
				["[r]: /u\n    > quote\n===", 1, "> quote"],
			] as const) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual(["protected_block", "heading"]);
				expect(doc.child(1).attrs.level, md).toBe(expectedLevel);
				expect(doc.child(1).textContent, md).toBe(expectedText);
			}

			// Inside blockquote and list containers.
			const bqDoc = parseMarkdownToVisualDoc("> [r]: /u\n>     a\n> ===");
			expect(topLevelTypes(bqDoc)).toEqual(["blockquote"]);
			expect(topLevelTypes(bqDoc.child(0))).toEqual([
				"protected_block",
				"heading",
			]);
			expect(bqDoc.child(0).child(1).attrs.level).toBe(1);
			expect(bqDoc.child(0).child(1).textContent).toBe("a");

			const listDoc = parseMarkdownToVisualDoc("- [r]: /u\n      a\n  ===");
			expect(topLevelTypes(listDoc)).toEqual(["bullet_list"]);
			const listItem = listDoc.child(0).child(0);
			const listHeading = findFirstNodeByType(listItem, "heading");
			expect(listHeading).not.toBeNull();
			expect(listHeading?.attrs.level).toBe(1);
			expect(listHeading?.textContent).toBe("a");

			// Blank line separates refdef -> `    a` IS an indented code block, NOT a Setext heading.
			const blankSeparated = parseMarkdownToVisualDoc("[r]: /u\n\n    a\n===");
			expect(topLevelTypes(blankSeparated)).toEqual([
				"protected_block",
				"code_block",
				"paragraph",
			]);
			expect(blankSeparated.child(1).textContent).toBe("a");
			expect(blankSeparated.child(2).textContent).toBe("===");

			// Indented lines after refdef without a valid Setext underline stay paragraphs (NOT code blocks).
			const paraAfterRef = parseMarkdownToVisualDoc("[r]: /u\n    a");
			expect(topLevelTypes(paraAfterRef)).toEqual([
				"protected_block",
				"paragraph",
			]);
			expect(paraAfterRef.child(1).textContent).toBe("a");

			const multiParaAfterRef = parseMarkdownToVisualDoc(
				"[r]: /u\n    a\n    b",
			);
			expect(topLevelTypes(multiParaAfterRef)).toEqual([
				"protected_block",
				"paragraph",
			]);
			expect(multiParaAfterRef.child(1).textContent).toBe("a\nb");

			// 4-space indented `===` is NOT a Setext underline.
			const indentedUnderline = parseMarkdownToVisualDoc(
				"[r]: /u\n    a\n    ===",
			);
			expect(topLevelTypes(indentedUnderline)).toEqual([
				"protected_block",
				"paragraph",
			]);
			expect(indentedUnderline.child(1).textContent).toBe("a\n===");

			// Indented table after refdef stays a table.
			const tableAfterRef = parseMarkdownToVisualDoc(
				"[r]: /u\n    a | b\n| - | - |",
			);
			expect(topLevelTypes(tableAfterRef)).toEqual([
				"protected_block",
				"table",
			]);

			// Deleting the preceding refdef must regenerate `# a` rather than emitting `    a\n===` after a blank line.
			const deleteGuard = createMarkdownRoundTripGuard(
				"p\n\n[r]: /u\n    a\n===",
			);
			const deletedRefDoc = deleteGuard.initialDoc.type.create(null, [
				deleteGuard.initialDoc.child(0),
				deleteGuard.initialDoc.child(2),
			]);
			const deletedRefSerialized = deleteGuard.serialize(deletedRefDoc);
			const deletedRefReparsed = parseMarkdownToVisualDoc(deletedRefSerialized);
			expect(topLevelTypes(deletedRefReparsed)).toEqual([
				"paragraph",
				"heading",
			]);
			expect(deletedRefReparsed.child(1).textContent).toBe("a");
		});
	});

	describe("3. emitDisplayMathLogicalLine onlyOnBlockBoundary paragraph & pipe isolation (Track B F5)", () => {
		it("splits single-line display math on all 7 confirmed PHP boundary reproducers plus containers, footnotes, and table-align", () => {
			// 1. `a | b $$x$$\nc\n| - | - |` -> 0 tables (`paragraphHasPipe` must NOT bleed across `$$x$$`).
			const pipeBleedGuard = createMarkdownRoundTripGuard(
				"a | b $$x$$\nc\n| - | - |",
			);
			expect(topLevelTypes(pipeBleedGuard.initialDoc)).toEqual([
				"paragraph",
				"protected_block",
				"paragraph",
			]);
			expect(findFirstNodeByType(pipeBleedGuard.initialDoc, "table")).toBeNull();
			expect(pipeBleedGuard.initialDoc.child(0).textContent).toBe("a | b");
			expect(pipeBleedGuard.initialDoc.child(2).textContent).toBe(
				"c\n| - | - |",
			);
			const editedPipeBleed = insertTextAfterFirstMatch(
				pipeBleedGuard.initialDoc,
				"c",
				"Z",
			);
			const reparsedPipeBleed = parseMarkdownToVisualDoc(
				pipeBleedGuard.serialize(editedPipeBleed),
			);
			expect(findFirstNodeByType(reparsedPipeBleed, "table")).toBeNull();
			expect(reparsedPipeBleed.eq(editedPipeBleed)).toBe(true);

			// Prior-line and mid-line pipe bleed variants -> 0 tables.
			for (const md of [
				"a | b\nHello $$x$$\nc\n| - | - |",
				"a | b $$x$$ c\nd\n| - | - |",
			]) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual([
					"paragraph",
					"protected_block",
					"paragraph",
				]);
				expect(findFirstNodeByType(doc, "table"), md).toBeNull();
			}

			// 2. `Hello $$x$$ a | b\nc\n| - | - |` -> paragraph("Hello"), math, paragraph("a | b"), table("c").
			const afterPipeTable = parseMarkdownToVisualDoc(
				"Hello $$x$$ a | b\nc\n| - | - |",
			);
			expect(topLevelTypes(afterPipeTable)).toEqual([
				"paragraph",
				"protected_block",
				"paragraph",
				"table",
			]);
			expect(afterPipeTable.child(0).textContent).toBe("Hello");
			expect(afterPipeTable.child(2).textContent).toBe("a | b");
			expect(afterPipeTable.child(3).child(0).child(0).textContent).toBe("c");

			// 3. `Hello $$x$$\n    indented` -> paragraph, math, indented code_block.
			const indentedCode = parseMarkdownToVisualDoc(
				"Hello $$x$$\n    indented",
			);
			expect(topLevelTypes(indentedCode)).toEqual([
				"paragraph",
				"protected_block",
				"code_block",
			]);
			expect(indentedCode.child(2).textContent).toBe("indented");

			// 4. `Hello $$x$$\n[r]: https://example.com\n\n[r]` -> refdef resolves `[r]` link.
			for (const md of [
				"Hello $$x$$\n[r]: https://example.com\n\n[r]",
				"Hello $$x$$\n[r]:\nhttps://example.com\n\n[r]",
				"Hello $$x$$\n[foo\nbar]: https://example.com\n\n[foo bar]",
			]) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual([
					"paragraph",
					"protected_block",
					"protected_block",
					"paragraph",
				]);
				const linkMark = doc
					.child(3)
					.firstChild?.marks.find((mark) => mark.type.name === "link");
				expect(linkMark?.attrs.href, md).toBe("https://example.com");
			}

			// 5. `Hello $$x$$\n2. item` (plus `01. item` and `- \nworld`) -> list starts cleanly.
			const orderedTwo = parseMarkdownToVisualDoc("Hello $$x$$\n2. item");
			expect(topLevelTypes(orderedTwo)).toEqual([
				"paragraph",
				"protected_block",
				"ordered_list",
			]);
			expect(orderedTwo.child(2).attrs.order).toBe(2);

			const orderedZeroOne = parseMarkdownToVisualDoc("Hello $$x$$\n01. item");
			expect(topLevelTypes(orderedZeroOne)).toEqual([
				"paragraph",
				"protected_block",
				"ordered_list",
			]);
			expect(orderedZeroOne.child(2).attrs.order).toBe(1);

			const emptyBullet = parseMarkdownToVisualDoc("Hello $$x$$\n- \nworld");
			expect(topLevelTypes(emptyBullet)).toEqual([
				"paragraph",
				"protected_block",
				"bullet_list",
				"paragraph",
			]);

			// 6. `Hello $$x$$\n<span>\nworld` -> Type 7 HTML block (`protected_block(raw)`), NOT inline raw-html.
			const htmlType7 = parseMarkdownToVisualDoc("Hello $$x$$\n<span>\nworld");
			expect(topLevelTypes(htmlType7)).toEqual([
				"paragraph",
				"protected_block",
				"protected_block",
			]);
			expect(htmlType7.child(2).attrs.kind).toBe("raw");
			expect(htmlType7.child(2).attrs.rawMarkdown).toBe("<span>\nworld");

			// 7. `# H1\n\nHello $$x$$\n[TOC]` (and same-line `[TOC]` around math) -> `protected_block(toc)`.
			const tocAfterMath = parseMarkdownToVisualDoc(
				"# H1\n\nHello $$x$$\n[TOC]",
			);
			expect(topLevelTypes(tocAfterMath)).toEqual([
				"heading",
				"paragraph",
				"protected_block",
				"protected_block",
			]);
			expect(tocAfterMath.child(3).attrs.kind).toBe("toc");
			expect(tocAfterMath.child(3).attrs.rawMarkdown).toBe("[TOC]");

			const tocSameLineAfter = parseMarkdownToVisualDoc(
				"## H2\n\nHello $$x$$ [TOC]",
			);
			expect(topLevelTypes(tocSameLineAfter)).toEqual([
				"heading",
				"paragraph",
				"protected_block",
				"protected_block",
			]);
			expect(tocSameLineAfter.child(3).attrs.kind).toBe("toc");

			// Footnote definition following single-line display math.
			const footnoteAfterMath = parseMarkdownToVisualDoc(
				"Hello $$x$$\n[^1]: note",
			);
			expect(topLevelTypes(footnoteAfterMath)).toEqual([
				"paragraph",
				"protected_block",
				"protected_block",
			]);
			expect(footnoteAfterMath.child(2).attrs.kind).toBe("footnotes");

			// Reserved EasyMDE table-align marker following single-line display math.
			const tableAlignAfterMath = parseMarkdownToVisualDoc(
				'Hello $$x$$\n<!-- easymde-table-align:v1 [[0,"right"]] -->\n| a |\n| - |',
			);
			expect(topLevelTypes(tableAlignAfterMath)).toEqual([
				"paragraph",
				"protected_block",
				"table",
			]);
			expect(tableAlignAfterMath.child(2).attrs.alignAnnotation).toBe(
				'<!-- easymde-table-align:v1 [[0,"right"]] -->',
			);
			expect(
				tableAlignAfterMath.child(2).child(0).child(0).attrs.textAlign,
			).toBe("right");

			// Container-nested equivalents.
			const bqOrderedTwo = parseMarkdownToVisualDoc("> Hello $$x$$\n> 2. item");
			expect(topLevelTypes(bqOrderedTwo)).toEqual([
				"blockquote",
				"protected_block",
				"blockquote",
			]);
			expect(topLevelTypes(bqOrderedTwo.child(2))).toEqual(["ordered_list"]);
			expect(bqOrderedTwo.child(2).child(0).attrs.order).toBe(2);

			const bqPipeBleed = parseMarkdownToVisualDoc(
				"> a | b $$x$$\n> c\n> | - | - |",
			);
			expect(topLevelTypes(bqPipeBleed)).toEqual([
				"blockquote",
				"protected_block",
				"blockquote",
			]);
			expect(findFirstNodeByType(bqPipeBleed, "table")).toBeNull();

			// Plain inline display math paragraphs do NOT regress.
			for (const md of ["Hello $$x$$ world", "Hello $$x$$\nnext line"]) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual(["paragraph"]);
				expect(collectProtectedInlineRaws(doc), md).toEqual(["$$x$$"]);
			}
		});

		it("maintains strict O(N) performance on long documents with repeated display math and pipes", () => {
			const samples: ReadonlyArray<readonly [string, string]> = [
				[
					"repeated_pipe_math_and_plain",
					`${"a | b $$x$$\nc\n".repeat(4_000)}| - | - |`,
				],
				[
					"repeated_after_pipe_math",
					`${"Hello $$x$$ a | b\nc\n".repeat(4_000)}`,
				],
				[
					"repeated_plain_inline_math",
					`${"Hello $$x$$\nnext line\n".repeat(4_000)}`,
				],
				[
					"single_pipe_math_long_para",
					`a | b $$x$$\n${"c\n".repeat(4_000)}| - | - |`,
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

	describe("4. Deduplicated cloneParagraphReferenceParser & matchTableAlignmentMarkerLine (Track B F6 items 2 & 3)", () => {
		it("clones ParagraphReferenceParser cleanly without leaking callbacks or mutating the source", () => {
			const onLabel = vi.fn();
			const original = createParagraphReferenceParser(onLabel);
			expect(advanceParagraphReferenceParser(original, "[foo")).toBe(false);
			expect(original.state).toBe("label");
			expect(original.labelBuffer).toBe("foo\n");

			// Default clone omits callback so speculative probes never fire side effects.
			const probe = cloneParagraphReferenceParser(original);
			expect(probe.onReferenceLabel).toBeUndefined();
			expect(
				advanceParagraphReferenceParser(probe, "bar]: https://example.com"),
			).toBe(true);
			expect(onLabel).not.toHaveBeenCalled();
			// Original parser state is untouched.
			expect(original.state).toBe("label");
			expect(original.labelBuffer).toBe("foo\n");
			expect(original.referenceValid).toBe(false);

			// Explicit `includeCallback = true` preserves callback invocation.
			const withCallback = cloneParagraphReferenceParser(original, true);
			expect(
				advanceParagraphReferenceParser(
					withCallback,
					"bar]: https://example.com",
				),
			).toBe(true);
			expect(onLabel).toHaveBeenCalledTimes(1);
			expect(onLabel).toHaveBeenCalledWith("foo\nbar");
		});

		it("matches both full lines and post-math candidate slices via matchTableAlignmentMarkerLine", () => {
			const md =
				'a $$x$$ <!-- easymde-table-align:v1 [[0,"right"]] -->\n| a |\n| - |';
			const lines = md.split("\n");
			const mathIndex = createPhpDocumentMathIndex(md, lines);

			// Full line 0 does not match as a marker directly.
			expect(
				matchTableAlignmentMarkerLine(lines, 0, [], 0, true, mathIndex),
			).toBeNull();

			// Explicit post-math slice (`rawAfter`) matches cleanly against following line 1.
			const rawAfter = ' <!-- easymde-table-align:v1 [[0,"right"]] -->';
			const match = matchTableAlignmentMarkerLine(
				lines,
				0,
				[],
				0,
				true,
				mathIndex,
				rawAfter,
			);
			expect(match).toEqual({
				containers: [],
				markerPrefix: " ",
				text: '<!-- easymde-table-align:v1 [[0,"right"]] -->',
			});
		});
	});
});
