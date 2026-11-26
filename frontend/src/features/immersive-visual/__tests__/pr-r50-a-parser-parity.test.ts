import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
	dedentParagraphFirstLineAtDepth,
	isListSwallowingFollowingBlock,
} from "../markdown-container-preservation";
import * as parser from "../markdown-parser";
import {
	matchListMarker,
	phpListMarkerContentIndent,
	stripBlockContainerPrefix,
} from "../markdown-prescanner-containers";
import { computeIntactRefDefLabels } from "../markdown-refdef-liveness";
import {
	createMarkdownRoundTripGuard,
	MARKDOWN_SERIALIZERS,
} from "../markdown-serializer";
import { visualEditorSchema } from "../visual-schema";

// Every original document and expected serialization below was rendered with
// real PHP `EasyMDE\Content\MarkdownRenderer::render()` (pinned
// `league/commonmark@2.8.2`): each serialized output renders exactly the
// original HTML minus the intended edit (the deleted paragraph, the deleted
// list item, or the replaced word), and every link keeps its PHP `href` /
// `title` (inlined only when its reference definition is no longer preserved
// verbatim).

type Edit = (doc: ProseMirrorNode) => ProseMirrorNode;

function deleteNodeWithText(typeName: string, text: string): Edit {
	return (doc) => {
		let from = -1;
		let to = -1;
		doc.descendants((node, pos) => {
			if (from >= 0) return false;
			if (node.type.name === typeName && node.textContent === text) {
				from = pos;
				to = pos + node.nodeSize;
				return false;
			}
			return true;
		});
		expect(from, `Could not find ${typeName} "${text}"`).toBeGreaterThanOrEqual(
			0,
		);
		const state = EditorState.create({ doc, schema: visualEditorSchema });
		return state.apply(state.tr.delete(from, to)).doc;
	};
}

function deleteParagraph(text: string): Edit {
	return deleteNodeWithText("paragraph", text);
}

function deleteRefDef(label: string): Edit {
	return (doc) => {
		let from = -1;
		let to = -1;
		doc.descendants((node, pos) => {
			if (from >= 0) return false;
			if (
				node.type.name === "protected_block" &&
				String(node.attrs.rawMarkdown ?? "").startsWith(`[${label}]:`)
			) {
				from = pos;
				to = pos + node.nodeSize;
				return false;
			}
			return true;
		});
		expect(from, `Could not find refdef [${label}]`).toBeGreaterThanOrEqual(0);
		const state = EditorState.create({ doc, schema: visualEditorSchema });
		return state.apply(state.tr.delete(from, to)).doc;
	};
}

function chain(...edits: ReadonlyArray<Edit>): Edit {
	return (doc) => edits.reduce((acc, edit) => edit(acc), doc);
}

function deleteListItem(text: string): Edit {
	return deleteNodeWithText("list_item", text);
}

function replaceText(needle: string, replacement: string): Edit {
	return (doc) => {
		let found = -1;
		doc.descendants((node, pos) => {
			if (found >= 0 || !node.isText || !node.text) return found < 0;
			const idx = node.text.indexOf(needle);
			if (idx >= 0) found = pos + idx;
			return found < 0;
		});
		expect(found, `Could not find "${needle}"`).toBeGreaterThanOrEqual(0);
		const state = EditorState.create({ doc, schema: visualEditorSchema });
		return state.apply(
			state.tr.insertText(replacement, found, found + needle.length),
		).doc;
	};
}

type Case = readonly [string, string, Edit, string, ReadonlyArray<string>];

/**
 * Serializes `edit(md)` and asserts the refdef liveness analyzer (driven by
 * the production serializers) agrees with `guard.serialize()`: when the
 * baseline defines `[p]`, `[link][p]` survives exactly when liveness keeps
 * `P` alive.
 */
function expectRoundTrip(
	md: string,
	edit: Edit,
	expected: string,
	partial: ReadonlyArray<string>,
): void {
	const parsed = parser.parseMarkdownWithBlockSources(md);
	const guard = createMarkdownRoundTripGuard(md, parsed);
	const edited = edit(guard.initialDoc);
	const live = computeIntactRefDefLabels(
		edited,
		parsed,
		MARKDOWN_SERIALIZERS.serializeBlock,
		MARKDOWN_SERIALIZERS.serializeBlockWithRefs,
	);
	const serialized = guard.serialize(edited);
	expect(serialized).toBe(expected);
	expect([...live.partialTitleIntact].sort()).toEqual([...partial]);
	if (parsed.firstRefDefNodeByLabel?.has("P")) {
		expect(live.allIntact.has("P")).toBe(serialized.includes("[link][p]"));
	}
}

function runCases(cases: ReadonlyArray<Case>): void {
	for (const [title, md, edit, expected, partial] of cases) {
		it(title, () => {
			expectRoundTrip(md, edit, expected, partial);
		});
	}
}

function topList(md: string, depth = 0): ProseMirrorNode {
	let node = parser.parseMarkdownToVisualDoc(md).child(0);
	for (let d = 0; d < depth; d += 1) node = node.child(0);
	expect(node.type.name).toMatch(/_list$/);
	return node;
}

function docShape(md: string): string {
	return parser.parseMarkdownToVisualDoc(md).toString();
}

describe("PR-R50-A PHP list content indent primitive, cross-block code spans, empty items, block_ranges fast path, display-math list closing", () => {
	describe("1. One `phpListMarkerContentIndent` primitive measured at the emitted item column (Track B #1, P0)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"F1 1 del",
				"-   x\n-    drop\n  -   y",
				deleteParagraph("drop"),
				"-   x\n-\n-   y",
				[],
			],
			[
				"F1 2 del",
				"-   中\n-    drop\n  -   y",
				deleteParagraph("drop"),
				"-   中\n-\n-   y",
				[],
			],
			[
				"F1 3 del",
				"-   😀\n-    drop\n  -   y",
				deleteParagraph("drop"),
				"-   😀\n-\n-   y",
				[],
			],
			[
				"F1 4 del",
				"-\tx\n-    drop\n  -   y",
				deleteParagraph("drop"),
				"-\tx\n-\n-   y",
				[],
			],
			[
				"F1 5 del",
				"> -   x\n> -    drop\n>   -   y",
				deleteParagraph("drop"),
				"> -   x\n> -\n> -   y",
				[],
			],
			[
				"F1 6 del",
				"> -\tab\n> -    drop\n>   -   y",
				deleteParagraph("drop"),
				"> -\tab\n> -\n> -   y",
				[],
			],
			[
				"F1 7 del",
				"   > -\tab\n   > -    drop\n   >   -   y",
				deleteParagraph("drop"),
				"> -\tab\n> -\n> -   y",
				[],
			],
			[
				"F1 8 del",
				"> > -\tab\n> > -    drop\n> >   -   y",
				deleteParagraph("drop"),
				"> > -\tab\n> > -\n> > -   y",
				[],
			],
			[
				"F1 9 del",
				">\t-\tab\n>\t-    drop\n>   -   y",
				deleteParagraph("drop"),
				">   -\tab\n> -\n> -   y",
				[],
			],
			[
				"F1 10 delitem",
				"-   x\n-    drop\n  -   y",
				deleteListItem("drop"),
				"-   x\n-   y",
				[],
			],
			[
				"F1 11 delitem",
				"-   中\n-    drop\n  -   y",
				deleteListItem("drop"),
				"-   中\n-   y",
				[],
			],
			[
				"F1 12 delitem",
				"-\tx\n-    drop\n  -   y",
				deleteListItem("drop"),
				"-\tx\n-   y",
				[],
			],
			[
				"F1 13 delitem",
				"> -   x\n> -    drop\n>   -   y",
				deleteListItem("drop"),
				"> -   x\n> -   y",
				[],
			],
			[
				"F1 14 delitem",
				"> -\tab\n> -    drop\n>   -   y",
				deleteListItem("drop"),
				"> -\tab\n> -   y",
				[],
			],
			[
				"F1 15 delitem",
				"   > -\tab\n   > -    drop\n   >   -   y",
				deleteListItem("drop"),
				"> -\tab\n> -   y",
				[],
			],
			[
				"F1 16 delitem",
				"> > -\tab\n> > -    drop\n> >   -   y",
				deleteListItem("drop"),
				"> > -\tab\n> >   -   y",
				[],
			],
			[
				"F1 17 delitem",
				">\t-\tab\n>\t-    drop\n>   -   y",
				deleteListItem("drop"),
				">   -\tab\n>   -   y",
				[],
			],
			[
				"F1 18 delitem",
				"-   x\n-    drop\n  -   y\n  -   z",
				deleteListItem("drop"),
				"-   x\n-   y\n-   z",
				[],
			],
			[
				"F1 19 delitem",
				"> -   ab\n> -    drop\n>   -   y",
				deleteListItem("drop"),
				"> -   ab\n>   -   y",
				[],
			],
			[
				"F1 20 delitem",
				"- a\n-    drop\n  - y",
				deleteListItem("drop"),
				"- a\n- y",
				[],
			],
		];
		runCases(cases);

		it("applies the `league/commonmark@2.8.2` single-code-point padding through one primitive", () => {
			const indent = (line: string, column = 0): number => {
				const marker = matchListMarker(line, column);
				expect(marker).not.toBeNull();
				return marker ? phpListMarkerContentIndent(marker) : -1;
			};
			expect(indent("-   x")).toBe(2);
			expect(indent("-   中")).toBe(2);
			expect(indent("-   😀")).toBe(2);
			expect(indent("-\tx")).toBe(2);
			expect(indent("1.   x")).toBe(3);
			expect(indent("10.  x")).toBe(4);
			expect(indent("-   x ")).toBe(4);
			expect(indent("-   xy")).toBe(4);
			// A tab after the marker expands from the real emitted column.
			expect(indent("-\tab", 0)).toBe(4);
			expect(indent("-\tab", 2)).toBe(2);
			expect(indent("-\tab", 4)).toBe(4);
		});
	});

	describe("2. Cross-block backtick code spans: the parsed list item count decides the math-folded scan (Track B #2, P0)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"F2 1 del",
				"-   first `\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  para `",
				deleteParagraph("drop"),
				"-   first `\n-    second \\(x\n- fake\ny\\)\n\npara `",
				[],
			],
			[
				"F2 2 del",
				"-   first `\n-    second $$x\n- fake\ny$$\n\ndrop\n\n  para `",
				deleteParagraph("drop"),
				"-   first `\n-    second $$x\n- fake\ny$$\n\npara `",
				[],
			],
			[
				"F2 3 del",
				"-   first `\n-    second \\[x\n- fake\ny\\]\n\ndrop\n\n  para `",
				deleteParagraph("drop"),
				"-   first `\n-    second \\[x\n- fake\ny\\]\n\npara `",
				[],
			],
			[
				"F2 4 del",
				"> -   first `\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   para `",
				deleteParagraph("drop"),
				"> -   first `\n> -    second \\(x\n> - fake\n> y\\)\n>\n> para `",
				[],
			],
			[
				"F2 5 del",
				"> > -   first `\n> > -    second \\(x\n> > - fake\n> > y\\)\n> >\n> > drop\n> >\n> >   para `",
				deleteParagraph("drop"),
				"> > -   first `\n> > -    second \\(x\n> > - fake\n> > y\\)\n> >\n> > para `",
				[],
			],
			[
				"F2 6 del",
				"intro `\n\n-    first \\(x\n- fake\ny\\)\n\ndrop\n\n  para `",
				deleteParagraph("drop"),
				"intro `\n\n-    first \\(x\n- fake\ny\\)\n\npara `",
				[],
			],
			[
				"F2 7 del",
				"intro `\n\n-    first $$x\n- fake\ny$$\n\ndrop\n\n  para `",
				deleteParagraph("drop"),
				"intro `\n\n-    first $$x\n- fake\ny$$\n\npara `",
				[],
			],
			[
				"F2 8 del",
				"intro `\n\n-    first \\(x\n- fake\ny\\)\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"intro `\n\n-    first \\(x\n- fake\ny\\)\n\n  para",
				[],
			],
			[
				"F2 9 del",
				"- first\n- second \\(\n-    fake\n  \\)\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"- first\n- second \\(\n-    fake\n  \\)\n\npara",
				[],
			],
			[
				"F2 10 del",
				'-    first \\(\n- fake\n  \\)\n\ndrop\n\n  > [p]: /u\n  > "t\n  > ===\n\n[link][p]',
				deleteParagraph("drop"),
				'-    first \\(\n- fake\n  \\)\n\n  > [p]: /u\n  > "t\n  > ===\n\n[link][p]',
				["P"],
			],
			[
				"F2 11 del",
				'intro `\n\n-    first \\(x\n- fake\ny\\)\n\ndrop\n\n  > [p]: /u\n  > "t\n  > ===\n\n[link][p] `',
				deleteParagraph("drop"),
				'intro `\n\n-    first \\(x\n- fake\ny\\)\n\n> [p]: /u\n>\n> # "t\n\n[link](/u "t&#10;") \\`',
				[],
			],
		];
		runCases(cases);
	});

	describe("3. CommonMark \u00a75.2 empty list items close on a blank line (Track B #3, P1)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"F3 1 del",
				"1.   x\n2.    drop\n   3.   y",
				deleteParagraph("drop"),
				"1.   x\n2.\n3.   y",
				[],
			],
			[
				"F3 2 del",
				"1. alpha\n2.   x\n3.    drop\n   4.   y",
				deleteParagraph("drop"),
				"1. alpha\n2.   x\n3.\n4.   y",
				[],
			],
			[
				"F3 3 delitem",
				"1.   x\n2.    drop\n   3.   y",
				deleteListItem("drop"),
				"1.   x\n3.   y",
				[],
			],
			[
				"F3 4 delitem",
				"1. alpha\n2.   x\n3.    drop\n   4.   y",
				deleteListItem("drop"),
				"1. alpha\n2.   x\n4.   y",
				[],
			],
			[
				"F3 5 del",
				"-   a \\(x\n-    big\ny\\)\n-    b `\\(x\n- fake\ny\\)\n\ndrop\n\n  para `",
				deleteParagraph("drop"),
				"-   a \\(x\n-    big\ny\\)\n-    b `\\(x\n- fake\ny\\)\n\npara `",
				[],
			],
			[
				"F3 6 del",
				"-    b `\\(x\n- fake\ny\\)\n-   a \\(x\n-    big\ny\\)\n\ndrop\n\n  para `",
				deleteParagraph("drop"),
				"-    b `\\(x\n- fake\ny\\)\n-   a \\(x\n-    big\ny\\)\n\n  para `",
				[],
			],
			[
				"F3 7 del",
				'- a\n-\n\ndrop\n\n  > [p]: /u\n  > "t\n  > ===\n\n[link][p]',
				deleteParagraph("drop"),
				'- a\n-\n\n  > [p]: /u\n  > "t\n  > ===\n\n[link][p]',
				["P"],
			],
			[
				"F3 8 del",
				'$$a$$-\n\ndrop\n\n  > [p]: /u\n  > "t\n  > ===\n\n[link][p]',
				deleteParagraph("drop"),
				'$$a$$-\n\n  > [p]: /u\n  > "t\n  > ===\n\n[link][p]',
				["P"],
			],
			[
				"F3 9 del",
				"-   \n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"-   \n\n  para",
				[],
			],
			[
				"F3 10 del",
				"-\t\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"-\t\n\n  para",
				[],
			],
			[
				"F3 11 del",
				"1.\n\ndrop\n\n   para",
				deleteParagraph("drop"),
				"1.\n\n   para",
				[],
			],
			[
				"F3 12 del",
				"> - a\n> -\n>\n> drop\n>\n>   para",
				deleteParagraph("drop"),
				"> - a\n> -\n>\n>   para",
				[],
			],
			[
				"F3 13 del",
				"- a\n-\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"- a\n-\n\n  para",
				[],
			],
			[
				"F3 14 rep",
				"- a\n-\n  para\n\nzz",
				replaceText("zz", "yy"),
				"- a\n-\n  para\n\nyy",
				[],
			],
			[
				"F3 15 rep",
				"1.\n   para\n\nzz",
				replaceText("zz", "yy"),
				"1.\n   para\n\nyy",
				[],
			],
			[
				"F3 16 del",
				"- a\n- b\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"- a\n- b\n\npara",
				[],
			],
		];
		runCases(cases);

		it("closes an empty trailing item only when a blank line separates the next block", () => {
			const swallows = (
				listMd: string,
				next: string,
				blankLineBetween: boolean,
				depth = 0,
			): boolean =>
				isListSwallowingFollowingBlock(
					topList(listMd, depth),
					() => listMd,
					next,
					depth,
					false,
					blankLineBetween,
				);
			expect(swallows("- a\n-", "  para", true)).toBe(false);
			expect(swallows("- a\n-", "  para", false)).toBe(true);
			expect(swallows("1.", "   para", true)).toBe(false);
			expect(swallows("1.", "   para", false)).toBe(true);
			expect(swallows("-   ", "  para", true)).toBe(false);
			expect(swallows("> - a\n> -", ">   para", true, 1)).toBe(false);
			expect(swallows("> - a\n> -", ">   para", false, 1)).toBe(true);
			// Items with content keep swallowing across the blank line.
			expect(swallows("- a\n- b", "  para", true)).toBe(true);
		});
	});

	describe("4. Column-aware container stripping (Track B #4, P2)", () => {
		it("strips exactly `depth` quote markers on one column cursor", () => {
			expect(stripBlockContainerPrefix(" > \t> foo", "> ", 1)).toBe("> foo");
			expect(stripBlockContainerPrefix(">\t\tfoo", "> ", 2)).toBe("\tfoo");
			expect(stripBlockContainerPrefix("> > foo", "> > ", 0)).toBe("foo");
			expect(stripBlockContainerPrefix(">", "> ", 2)).toBe("");
		});
	});

	describe("5. Exact PHP `block_ranges()` fast path (Track A #1, P2)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"F5 1 rep",
				"> - aa\n>\n>       $$x$$\n\nzz",
				replaceText("zz", "yy"),
				"> - aa\n>\n>       $$x$$\n\nyy",
				[],
			],
			[
				"F5 2 rep",
				"    $$x$$\n\naa",
				replaceText("aa", "ab"),
				"    $$x$$\n\nab",
				[],
			],
			[
				"F5 3 rep",
				">     $$x$$\n\naa",
				replaceText("aa", "ab"),
				">     $$x$$\n\nab",
				[],
			],
			[
				"F5 4 rep",
				">     $$x$$\n>\n> aa",
				replaceText("aa", "ab"),
				"> $$x$$\n>\n> ab",
				[],
			],
			[
				"F5 5 rep",
				"> - aa\n>\n>       $$x$$",
				replaceText("aa", "ab"),
				"> - ab\n>\n>       $$x$$",
				[],
			],
		];
		runCases(cases);
	});

	describe("6. Standalone display math closes enclosing list items like PHP `extract_math()` (Track A #2, P2)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"F6 1 rep",
				"- aa\n  $$x$$\n\n    para",
				replaceText("aa", "ab"),
				"- ab\n\n$$x$$\n\n    para",
				[],
			],
			[
				"F6 2 rep",
				"- aa\n  $$x$$\n  para",
				replaceText("aa", "ab"),
				"- ab\n\n$$x$$\n\n  para",
				[],
			],
			[
				"F6 3 rep",
				"- aa\n  \\[x\\]\n\n    para",
				replaceText("aa", "ab"),
				"- ab\n\n\\[x\\]\n\n    para",
				[],
			],
			[
				"F6 4 rep",
				"1. aa\n   $$x$$\n\n    para",
				replaceText("aa", "ab"),
				"1. ab\n\n$$x$$\n\n    para",
				[],
			],
			[
				"F6 5 rep",
				"- aa\n  $$\n  x\n  $$\n\n    para",
				replaceText("aa", "ab"),
				"- ab\n\n$$\n  x\n  $$\n\n    para",
				[],
			],
			[
				"F6 6 rep",
				"> - aa\n>   $$x$$\n>\n>     para",
				replaceText("aa", "ab"),
				"> - ab\n>   $$x$$\n>\n>     para",
				[],
			],
			[
				"F6 7 rep",
				"> $$x$$\n>\n> aa",
				replaceText("aa", "ab"),
				"> $$x$$\n>\n> ab",
				[],
			],
			[
				"F6 8 rep",
				"- $$x$$\n\n    para\n\naa",
				replaceText("aa", "ab"),
				"- $$x$$\n\n    para\n\nab",
				[],
			],
			[
				"F6 9 rep",
				"- Item\n\n  $$\n  E = mc^2\n  $$\n\naa",
				replaceText("aa", "ab"),
				"- Item\n\n  $$\n  E = mc^2\n  $$\n\nab",
				[],
			],
			[
				"F6 10 rep",
				"- aa\n  $$x$$\n\n    para",
				replaceText("para", "pb"),
				"- aa\n  $$x$$\n\n```\npb\n```",
				[],
			],
		];
		runCases(cases);

		it("parses standalone display math inside list items as a top-level block like PHP", () => {
			expect(docShape("- aa\n  $$x$$\n\n    para")).toBe(
				'doc(bullet_list(list_item(paragraph("aa"))), protected_block, code_block("para"))',
			);
			expect(docShape("- aa\n  $$x$$\n  para")).toBe(
				'doc(bullet_list(list_item(paragraph("aa"))), protected_block, paragraph("para"))',
			);
			expect(docShape("1. aa\n   $$x$$\n\n    para")).toBe(
				'doc(ordered_list(list_item(paragraph("aa"))), protected_block, code_block("para"))',
			);
			expect(docShape("> - aa\n>   $$x$$\n>\n>     para")).toBe(
				'doc(blockquote(bullet_list(list_item(paragraph("aa")))), protected_block, blockquote(code_block("para")))',
			);
			expect(docShape("> - aa\n>\n>       $$x$$")).toBe(
				'doc(blockquote(bullet_list(list_item(paragraph("aa")))), protected_block)',
			);
			// Top-level 4-column math stays indented code (PHP `block_ranges()`
			// sees the line-leading indent).
			expect(docShape("    $$x$$")).toBe('doc(code_block("$$x$$"))');
		});
	});

	describe("PR-R50-B: a clean paragraph downgraded solely for swallowRisk keeps its raw inline bytes", () => {
		// Canonical fallback would escape ``para ````` to ``para \`\```, which
		// fails to close the open `````` span in PHP
		// `MarkdownCodeRegionScanner::find_closing_backticks()` and exposes
		// `\(x ... y\)` to PHP inline math.
		const cases: ReadonlyArray<Case> = [
			[
				"B1 depth 0 double backticks",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  para ``",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\npara ``",
				[],
			],
			[
				"B2 depth 1 double backticks",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   para ``",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> para ``",
				[],
			],
			[
				"B3 depth 1 tab indent",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n> \tpara ``",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> para ``",
				[],
			],
			[
				"B4 depth 2 double backticks",
				"> > -   first ``\n> > -    second \\(x\n> > - fake\n> > y\\)\n> >\n> > drop\n> >\n> >   para ``",
				deleteParagraph("drop"),
				"> > -   first ``\n> > -    second \\(x\n> > - fake\n> > y\\)\n> >\n> > para ``",
				[],
			],
			[
				"B5 depth 0 triple backticks",
				"-   first ```\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  para ```",
				deleteParagraph("drop"),
				"-   first ```\n-    second \\(x\n- fake\ny\\)\n\npara ```",
				[],
			],
			[
				"B6 continuation lines stay byte-for-byte",
				"- a\n\ndrop\n\n  para ``\n  more `` x",
				deleteParagraph("drop"),
				"- a\n\npara ``\n  more `` x",
				[],
			],
			[
				"B7 live reference stays a raw reference",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  [dead] ``\n\n[dead]: /d",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n[dead] ``\n\n[dead]: /d",
				[],
			],
			[
				"B8 control: invalidated reference still canonicalizes (depth 0)",
				"- a\n\ndrop\n\n  [dead] tail\n\n[dead]: /d",
				chain(deleteParagraph("drop"), deleteRefDef("dead")),
				"- a\n\n[dead](/d) tail",
				[],
			],
			[
				"B9 control: invalidated reference still canonicalizes (depth 1)",
				"> - a\n>\n> drop\n>\n>   [dead] tail\n\n[dead]: /d",
				chain(deleteParagraph("drop"), deleteRefDef("dead")),
				"> - a\n>\n> [dead](/d) tail",
				[],
			],
			[
				"B10 control: swallowed paragraph before a tight math / partial-title refdef run",
				'-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  para ``\n$$y$$ [q]: /q\n"tq\n===\n\n[link][q]',
				deleteParagraph("drop"),
				'-   first ``\n-    second \\(x\n- fake\ny\\)\n\npara ``\n\n$$y$$\n\n[q]: /q\n\n"tq\n===\n\n[link](/q "tq&#10;")',
				[],
			],
		];
		runCases(cases);

		it("keeps an invalidated-reference paragraph canonical, never raw-dedented", () => {
			const md =
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  [dead] ``\n\n[dead]: /d";
			const parsed = parser.parseMarkdownWithBlockSources(md);
			const guard = createMarkdownRoundTripGuard(md, parsed);
			const edited = chain(
				deleteParagraph("drop"),
				deleteRefDef("dead"),
			)(guard.initialDoc);
			const serialized = guard.serialize(edited);
			expect(serialized).toContain("\n\n[dead](/d) ");
			expect(serialized).not.toContain("[dead] ``");
		});

		it("dedents only a 1-3 column line 0 carrying every quote marker", () => {
			expect(dedentParagraphFirstLineAtDepth("  para ``\n  more", 0)).toBe(
				"para ``\n  more",
			);
			expect(dedentParagraphFirstLineAtDepth("   >   para ``", 1)).toBe(
				"> para ``",
			);
			expect(dedentParagraphFirstLineAtDepth("> \tpara ``\n> y", 1)).toBe(
				"> para ``\n> y",
			);
			expect(dedentParagraphFirstLineAtDepth(">\tpara", 1)).toBe("> para");
			expect(dedentParagraphFirstLineAtDepth("> >   para", 2)).toBe("> > para");
			expect(dedentParagraphFirstLineAtDepth("para", 0)).toBeNull();
			expect(dedentParagraphFirstLineAtDepth("    para", 0)).toBeNull();
			expect(dedentParagraphFirstLineAtDepth(">     para", 1)).toBeNull();
			expect(dedentParagraphFirstLineAtDepth("  para", 1)).toBeNull();
			expect(dedentParagraphFirstLineAtDepth(">   para", 2)).toBeNull();
		});
	});
});
