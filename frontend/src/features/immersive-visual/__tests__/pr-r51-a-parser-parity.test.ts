import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { scanPhpMarkdownMathRanges } from "../../../shared/markdown/php-markdown-math-mask";
import {
	dedentSwallowedBlockAtDepth,
	wouldMergeWithPreviousList,
} from "../markdown-container-preservation";
import * as parser from "../markdown-parser";
import {
	matchListMarker,
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
// original HTML minus the intended edit (the deleted paragraph, list item,
// or top-level block, or the replaced word), and refdef liveness agrees with
// `guard.serialize()`.

type Edit = (doc: ProseMirrorNode) => ProseMirrorNode;

function applyDelete(doc: ProseMirrorNode, from: number, to: number) {
	const state = EditorState.create({ doc, schema: visualEditorSchema });
	return state.apply(state.tr.delete(from, to)).doc;
}

function deleteNodeWhere(
	label: string,
	predicate: (node: ProseMirrorNode) => boolean,
): Edit {
	return (doc) => {
		let from = -1;
		let to = -1;
		doc.descendants((node, pos) => {
			if (from >= 0) return false;
			if (predicate(node)) {
				from = pos;
				to = pos + node.nodeSize;
				return false;
			}
			return true;
		});
		expect(from, `Could not find ${label}`).toBeGreaterThanOrEqual(0);
		return applyDelete(doc, from, to);
	};
}

function deleteParagraph(text: string): Edit {
	return deleteNodeWhere(
		`paragraph "${text}"`,
		(node) => node.type.name === "paragraph" && node.textContent === text,
	);
}

function deleteListItem(text: string): Edit {
	return deleteNodeWhere(
		`list_item "${text}"`,
		(node) => node.type.name === "list_item" && node.textContent === text,
	);
}

function deleteRefDef(label: string): Edit {
	return deleteNodeWhere(
		`refdef [${label}]`,
		(node) =>
			node.type.name === "protected_block" &&
			String(node.attrs.rawMarkdown ?? "").startsWith(`[${label}]:`),
	);
}

function deleteTopLevel(index: number): Edit {
	return (doc) => {
		let from = 0;
		for (let k = 0; k < index; k += 1) from += doc.child(k).nodeSize;
		return applyDelete(doc, from, from + doc.child(index).nodeSize);
	};
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

function chain(...edits: ReadonlyArray<Edit>): Edit {
	return (doc) => edits.reduce((acc, edit) => edit(acc), doc);
}

type Case = readonly [string, string, Edit, string, ReadonlyArray<string>];

/**
 * Serializes `edit(md)` and asserts the refdef liveness analyzer (driven by
 * the production serializers) agrees with `guard.serialize()`: when the
 * baseline defines `[p]`, the raw reference survives exactly when liveness
 * keeps `P` alive. Zero-edit serialization stays byte-identical.
 */
function expectRoundTrip(
	md: string,
	edit: Edit,
	expected: string,
	partial: ReadonlyArray<string>,
): void {
	const parsed = parser.parseMarkdownWithBlockSources(md);
	const guard = createMarkdownRoundTripGuard(md, parsed);
	expect(guard.serialize(guard.initialDoc)).toBe(md);
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
		const rawReference = md.includes("[link][p]")
			? serialized.includes("[link][p]")
			: /\[p\](?![(:])/.test(serialized);
		expect(live.allIntact.has("P")).toBe(rawReference);
	}
}

function runCases(cases: ReadonlyArray<Case>): void {
	for (const [title, md, edit, expected, partial] of cases) {
		it(title, () => {
			expectRoundTrip(md, edit, expected, partial);
		});
	}
}

function topList(md: string): ProseMirrorNode {
	const node = parser.parseMarkdownToVisualDoc(md).child(0);
	expect(node.type.name).toMatch(/_list$/);
	return node;
}

function docShape(md: string): string {
	return parser.parseMarkdownToVisualDoc(md).toString();
}

describe("PR-R51-A list-marker padding, trailing-item scan, depth-aware list validation, general swallow dedent, prescanner Step 4", () => {
	describe("1. One `computePhpListMarkerContentIndent` primitive for the engine, prescanner, and preservation (Track A #2, Track B #2 / #6b)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"f1.1",
				"-   x\n\n      $$y$$\n\nzz",
				replaceText("zz", "yy"),
				"-   x\n\n      $$y$$\n\nyy",
				[],
			],
			[
				"f1.2",
				"1.   x\n\n       $$y$$\n\nzz",
				replaceText("zz", "yy"),
				"1.   x\n\n       $$y$$\n\nyy",
				[],
			],
			[
				"f1.3",
				"  -   x\n\n        $$y$$\n\nzz",
				replaceText("zz", "yy"),
				"  -   x\n\n        $$y$$\n\nyy",
				[],
			],
			[
				"f1.4",
				"-    x\n\n      $$x$$\n\nold",
				replaceText("old", "new"),
				"-    x\n\n      $$x$$\n\nnew",
				[],
			],
			[
				"f1.5",
				"-   x\n\n      $a$\n\nzz",
				replaceText("zz", "yy"),
				"-   x\n\n      $a$\n\nyy",
				[],
			],
			[
				"f1.6",
				"> -   x\n>\n>       $$y$$\n>\n> zz",
				replaceText("zz", "yy"),
				"> -   x\n>\n>       $$y$$\n> yy",
				[],
			],
		];
		runCases(cases);

		it("assigns the single-code-point PHP padding through `matchListMarker().contentIndent`", () => {
			const indent = (line: string, column = 0): number =>
				matchListMarker(line, column)?.contentIndent ?? -1;
			expect(indent("-   x")).toBe(2);
			expect(indent("1.   x")).toBe(3);
			expect(indent("  -   x")).toBe(4);
			expect(indent("-    x")).toBe(2);
			expect(indent("-   \u{1F600}")).toBe(2);
			expect(indent("-   xy")).toBe(4);
			expect(indent("-   x ")).toBe(4);
			expect(indent("10.\tab", 2)).toBe(6);
			expect(indent("1.\tab", 2)).toBe(6);
		});

		it("never parses a 4-column-deeper line after a single-code-point item as display math", () => {
			expect(docShape("-   x\n\n      $$y$$\n\nzz")).not.toContain(
				"protected_block",
			);
		});
	});

	describe("2. Trailing-item scan trusts only the parsed list: leading shared-group display math and parsed multiline inline math (Track B #1, P0)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"f2.a1",
				"intro `\n\n- first $$x$$\n\ndrop\n\n  para `",
				deleteParagraph("drop"),
				"intro `\n\n- first $$x$$\n\npara `",
				[],
			],
			[
				"f2.a2",
				"- first `\n- second $$x$$\n\ndrop\n\n  para `",
				deleteParagraph("drop"),
				"- first `\n- second $$x$$\n\npara `",
				[],
			],
			[
				"f2.a3",
				"intro `\n\n- first $$x$$\n\ndrop\n\n  > [p]: /u\n  > \"t\n  > ===\n\n[link][p] `",
				deleteParagraph("drop"),
				"intro `\n\n- first $$x$$\n\n> [p]: /u\n> \"t\n> ===\n\n[link][p] `",
				["P"],
			],
			[
				"f2.a4",
				"intro `\n\n-    first $$a$$- bogus\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  para `",
				deleteParagraph("drop"),
				"intro `\n\n-    first $$a$$- bogus\n-    second \\(x\n- fake\ny\\)\n\npara `",
				[],
			],
			[
				"f2.b5",
				"> - aa\n>\n>       $$x$$\n>\n> drop\n>\n>   para\n\n    code",
				deleteParagraph("drop"),
				"> - aa\n>\n>       $$x$$\n>\n> para\n\n    code",
				[],
			],
			[
				"f2.b6",
				"> - aa\n>\n>       $$x$$\n>\n> drop\n>\n>   para\n\n`",
				deleteParagraph("drop"),
				"> - aa\n>\n>       $$x$$\n>\n> para\n\n`",
				[],
			],
			[
				"f2.b7",
				"> - aa\n>\n>       $$x$$\n>\n> drop\n>\n>   para\n\n~~~",
				deleteParagraph("drop"),
				"> - aa\n>\n>       $$x$$\n>\n> para\n\n~~~",
				[],
			],
			[
				"f2.b8",
				"> - aa\n>\n>       $$x$$\n>\n> drop\n>\n>   para `\n\n    code `",
				deleteParagraph("drop"),
				"> - aa\n>\n>       $$x$$\n>\n> para `\n\n    code `",
				[],
			],
			[
				"sg.r49",
				"- a\n\ndrop\n\n  $$a$$- item",
				deleteParagraph("drop"),
				"- a\n\n$$a$$- item",
				[],
			],
			[
				"sg.r49b",
				"- a\n\ndrop\n\n  \\[a\\]- item",
				deleteParagraph("drop"),
				"- a\n\n\\[a\\]- item",
				[],
			],
			[
				"sg.r49c",
				"- a\n\ndrop\n\n  foo$$a$$- item",
				deleteParagraph("drop"),
				"- a\n\nfoo$$a$$- item",
				[],
			],
		];
		runCases(cases);
	});

	describe("3. Depth-aware first ordered marker alignment and list validation (Track B #3, P0)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"f3.1",
				"> 1. drop\n> 10.\tab\n>       - nested",
				deleteListItem("drop"),
				"> 1.\tab\n>       - nested",
				[],
			],
			[
				"f3.2",
				"> 1. drop\n> 10.\tab\n>\n>       subpara",
				deleteListItem("drop"),
				"> 1.\tab\n>\n>       subpara",
				[],
			],
			[
				"f3.3",
				"> > 1. drop\n> > 10.\tab\n> >       - nested",
				deleteListItem("drop"),
				"> > 1.\tab\n> >       - nested",
				[],
			],
			[
				"f3.4",
				"> 1. drop\n> 100.\tab\n>        - nested",
				deleteListItem("drop"),
				"> 1.\tab\n>        - nested",
				[],
			],
			[
				"f3.5",
				"> 1. drop\n> 9.\tab\n>      - nested",
				deleteListItem("drop"),
				"> 1.\tab\n>      - nested",
				[],
			],
			[
				"f3.6",
				"1. drop\n10.\tab\n      - nested",
				deleteListItem("drop"),
				"1.\tab\n      - nested",
				[],
			],
		];
		runCases(cases);
	});

	describe("4. One node-type-agnostic swallow-risk dedent for clean blocks and intact shared groups (Track B #4, P0)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"f4.0",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  para `` $$y\nz$$",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\npara `` $$y\nz$$",
				[],
			],
			[
				"f4.q0",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   para `` $$y\n> z$$",
				deleteParagraph("drop"),
				"> - first \\`\\`\n> - second (x\n> - fake\n>   y)\n>\n> para \\`\\`\n\n$$y\n> z$$",
				[],
			],
			[
				"f4.1",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  # head ``",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n# head ``",
				[],
			],
			[
				"f4.q1",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   # head ``",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> # head ``",
				[],
			],
			[
				"f4.2",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  head ``\n  ===",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\nhead ``\n===",
				[],
			],
			[
				"f4.q2",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   head ``\n>   ===",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> head ``\n> ===",
				[],
			],
			[
				"f4.3",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  > quote ``",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n> quote ``",
				[],
			],
			[
				"f4.q3",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   > quote ``",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> > quote ``",
				[],
			],
			[
				"f4.4",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  > quote ``\n  > line2",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n> quote ``\n> line2",
				[],
			],
			[
				"f4.q4",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   > quote ``\n>   > line2",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> > quote ``\n> > line2",
				[],
			],
			[
				"f4.5",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  | a `` |\n  | --- |",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n| a `` |\n| --- |",
				[],
			],
			[
				"f4.q5",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   | a `` |\n>   | --- |",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> | a `` |\n> | --- |",
				[],
			],
			[
				"f4.6",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  * item ``",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n* item ``",
				[],
			],
			[
				"f4.q6",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   * item ``",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> * item ``",
				[],
			],
			[
				"f4.7",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  * item ``\n    sub",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n* item ``\n  sub",
				[],
			],
			[
				"f4.q7",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   * item ``\n>     sub",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> * item ``\n>   sub",
				[],
			],
			[
				"f4.8",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  1. item ``",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n1. item ``",
				[],
			],
			[
				"f4.q8",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   1. item ``",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> 1. item ``",
				[],
			],
			[
				"f4.9",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  1. item ``\n     sub",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n1. item ``\n   sub",
				[],
			],
			[
				"f4.q9",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   1. item ``\n>      sub",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> 1. item ``\n>    sub",
				[],
			],
			[
				"f4.10",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  ~~~txt\n  x\n  ~~~",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n  ~~~txt\n  x\n  ~~~",
				[],
			],
			[
				"f4.q10",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   ~~~txt\n>   x\n>   ~~~",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n>   ~~~txt\n>   x\n>   ~~~",
				[],
			],
			[
				"f4.11",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  [r]: /u\n\n[l][r]",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n  [r]: /u\n\n[l][r]",
				[],
			],
			[
				"f4.q11",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   [r]: /u\n>\n> [l][r]",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n>   [r]: /u\n>\n> [l][r]",
				[],
			],
			[
				"f4.12",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  para `` $$\n  y\n  $$",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\npara `` $$\n  y\n  $$",
				[],
			],
			[
				"f4.q12",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   para `` $$\n>   y\n>   $$",
				deleteParagraph("drop"),
				"> - first \\`\\`\n> - second (x\n> - fake\n>   y)\n>\n> para \\`\\`\n\n$$\n>   y\n>   $$",
				[],
			],
			[
				"f4.13",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  $$a$$- item",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n  $$a$$- item",
				[],
			],
			[
				"f4.q13",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   $$a$$- item",
				deleteParagraph("drop"),
				"> - first \\`\\`\n> - second \\(x\n> - fake\n> y\\)\n\n$$a$$\n\n- item",
				[],
			],
			[
				"f4.r48b",
				"> -\titem\n>\n> drop\n>\n>   > [p]: /u\n>   > \"t\n>   > ===\n\n[link][p]",
				deleteParagraph("drop"),
				"> -\titem\n>\n> > [p]: /u\n> > \"t\n> > ===\n\n[link][p]",
				["P"],
			],
			[
				"inv.qbq",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   > quote [p] ``\n\n[p]: /u",
				chain(deleteParagraph("drop"), deleteRefDef("p")),
				"> - first \\`\\`\n> - second (x\n> - fake\n>   y)\n>\n> > quote [p](/u) \\`\\`",
				[],
			],
			[
				"keep.bq",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  > quote [p] ``\n\n[p]: /u",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n> quote [p] ``\n\n[p]: /u",
				[],
			],
			[
				"keep.list",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  * item [p] ``\n\n[p]: /u",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n* item [p] ``\n\n[p]: /u",
				[],
			],
			[
				"pt.bq",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  > [p]: /u\n  > \"t\n  > ===\n\n[link][p]",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n  > [p]: /u\n  > \"t\n  > ===\n\n[link][p]",
				["P"],
			],
			[
				"pt.qbq",
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n> drop\n>\n>   > [p]: /u\n>   > \"t\n>   > ===\n\n[link][p]",
				deleteParagraph("drop"),
				"> -   first ``\n> -    second \\(x\n> - fake\n> y\\)\n>\n>   > [p]: /u\n>   > \"t\n>   > ===\n\n[link][p]",
				["P"],
			],
			[
				"pt.list",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  * [p]: /u\n    \"t\n    ===\n\n[link][p]",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n  * [p]: /u\n    \"t\n    ===\n\n[link][p]",
				["P"],
			],
			[
				"grp.after",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  $$a$$- item\n\n      code",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n  $$a$$- item\n\n      code",
				[],
			],
			[
				"multi.tab",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  * item ``\n  \tcode",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n* item ``\n  code",
				[],
			],
			[
				"multi.lazy",
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\ndrop\n\n  > quote ``\nlazy",
				deleteParagraph("drop"),
				"-   first ``\n-    second \\(x\n- fake\ny\\)\n\n> quote ``\nlazy",
				[],
			],
		];
		runCases(cases);

		it("dedents line 0 and, outside paragraphs and protected blocks, every carried line", () => {
			expect(dedentSwallowedBlockAtDepth("  # head ``", 0, "heading")).toBe(
				"# head ``",
			);
			expect(
				dedentSwallowedBlockAtDepth("  head ``\n  ===", 0, "heading"),
			).toBe("head ``\n===");
			expect(
				dedentSwallowedBlockAtDepth("  * item ``\n    sub", 0, "bullet_list"),
			).toBe("* item ``\n  sub");
			expect(
				dedentSwallowedBlockAtDepth("  * a\n\n    b", 0, "bullet_list"),
			).toBe("* a\n\n  b");
			expect(
				dedentSwallowedBlockAtDepth("  > quote ``\nlazy", 0, "blockquote"),
			).toBe("> quote ``\nlazy");
			expect(
				dedentSwallowedBlockAtDepth(
					">   > quote ``\n>   > line2",
					1,
					"blockquote",
				),
			).toBe("> > quote ``\n> > line2");
			expect(
				dedentSwallowedBlockAtDepth("  para ``\n  more", 0, "paragraph"),
			).toBe("para ``\n  more");
			expect(
				dedentSwallowedBlockAtDepth(
					"  $$\n  y\n  $$- item",
					0,
					"protected_block",
				),
			).toBe("$$\n  y\n  $$- item");
			expect(dedentSwallowedBlockAtDepth("    # x", 0, "heading")).toBeNull();
			expect(dedentSwallowedBlockAtDepth("# x", 0, "heading")).toBeNull();
			expect(dedentSwallowedBlockAtDepth("  x", 1, "paragraph")).toBeNull();
		});

		it("never dedents a list into the preceding list it would continue", () => {
			expect(wouldMergeWithPreviousList(topList("- a"), topList("- b"))).toBe(
				true,
			);
			expect(wouldMergeWithPreviousList(topList("- a"), topList("* b"))).toBe(
				false,
			);
			expect(
				wouldMergeWithPreviousList(topList("1. a"), topList("2. b")),
			).toBe(true);
			expect(
				wouldMergeWithPreviousList(topList("1. a"), topList("1) b")),
			).toBe(false);
			expect(wouldMergeWithPreviousList(null, topList("- b"))).toBe(false);
		});
	});

	describe("5. Prescanner Step 4: authoritative math index, empty-item blank sync, detached quote prefix, interleaved containers (Track A #1, Track B #5)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"f5.1",
				"-\n\n    $$x$$\n\nold",
				replaceText("old", "new"),
				"-\n\n    $$x$$\n\nnew",
				[],
			],
			[
				"f5.2",
				"- aa `\n  $$x$$\n\n  para `",
				replaceText("aa", "ab"),
				"- ab \\`\n  \\$\\$x\\$\\$\n\n  para \\`",
				[],
			],
			[
				"f5.3",
				"- aa `\n  \\[x\\]\n\n  para `",
				replaceText("aa", "ab"),
				"- ab \\`\n  [x]\n\n  para \\`",
				[],
			],
			[
				"f5.4",
				"- aa `\n  $$\n  x\n  $$\n\n  para `",
				replaceText("aa", "ab"),
				"- ab \\`\n  \\$\\$\n  x\n  \\$\\$\n\n  para \\`",
				[],
			],
			[
				"f5.5",
				"hello\n\n> - aa\n>   $$x$$\n>\n>     para",
				deleteTopLevel(1),
				"hello\n\n$$x$$\n>\n>     para",
				[],
			],
			[
				"f5.6",
				"hello\n\n> - aa\n>   $$x$$\n>\n>     para",
				replaceText("hello", "hallo"),
				"hallo\n\n> - aa\n>   $$x$$\n>\n>     para",
				[],
			],
			[
				"f5.7",
				"- > aa\n  > $$x$$\n  > bb",
				replaceText("aa", "ab"),
				"-\n  > ab\n\n$$x$$\n  > bb",
				[],
			],
			[
				"f5.8",
				"- > aa\n  > $$x$$\n  > bb",
				deleteTopLevel(0),
				"$$x$$\n  > bb",
				[],
			],
			[
				"f5.9",
				"- > aa\n  > $$x$$\n  > bb",
				replaceText("bb", "bc"),
				"- > aa\n  > $$x$$\n> bc",
				[],
			],
			[
				"f5.10",
				"> - aa\n>   $$x$$\n>\n>     para",
				replaceText("para", "pb"),
				"> - aa\n>   $$x$$\n> ```\n> pb\n> ```",
				[],
			],
			[
				"f5.11",
				"- > aa\n  > \\[x\\]\n  > bb",
				replaceText("aa", "ab"),
				"-\n  > ab\n\n\\[x\\]\n  > bb",
				[],
			],
			[
				"f5.12",
				"- > aa\n  > $$\n  > x\n  > $$\n  > bb",
				replaceText("aa", "ab"),
				"-\n  > ab\n\n$$\n  > x\n  > $$\n  > bb",
				[],
			],
			[
				"f5.13",
				"1.\n\n    $$x$$\n\nold",
				replaceText("old", "new"),
				"1.\n\n    $$x$$\n\nnew",
				[],
			],
			[
				"f5.14",
				"> -\n>\n>     $$x$$\n>\n> old",
				replaceText("old", "new"),
				"> -\n>\n> $$x$$\n>\n> new",
				[],
			],
		];
		runCases(cases);

		it("parses Step 4 display math exactly where PHP sees it", () => {
			expect(docShape("-\n\n    $$x$$\n\nold")).not.toContain(
				"protected_block",
			);
			expect(docShape("- aa `\n  $$x$$\n\n  para `")).not.toContain(
				"protected_block",
			);
			expect(docShape("- > aa\n  > $$x$$\n  > bb")).toBe(
				'doc(bullet_list(list_item(paragraph, blockquote(paragraph("aa")))), protected_block, blockquote(paragraph("bb")))',
			);
			const multilineInterleaved = parser.parseMarkdownWithBlockSources(
				"- > aa\n  > $$\nx\n$$\n  > bb",
			);
			expect(multilineInterleaved.doc.child(1).attrs.rawMarkdown).toBe(
				"$$\nx\n$$",
			);
		});

		it("rejects unsafe multi-line swallow dedents while preserving 4-column lazy continuations on blockquotes and headings", () => {
			expect(
				dedentSwallowedBlockAtDepth("   ```\n    ```\n   ```", 0, "code_block"),
			).toBeNull();
			expect(
				dedentSwallowedBlockAtDepth("   > a\n    > b", 0, "blockquote"),
			).toBe("> a\n    > b");
			expect(
				dedentSwallowedBlockAtDepth("   > a\n    # h1", 0, "blockquote"),
			).toBe("> a\n    # h1");
			expect(
				dedentSwallowedBlockAtDepth("   head\n    ---\n   ===", 0, "heading"),
			).toBe("head\n    ---\n===");
			expect(
				dedentSwallowedBlockAtDepth(
					"   * item1\n* item2\n\n   sub",
					0,
					"bullet_list",
				),
			).toBeNull();
			expect(
				dedentSwallowedBlockAtDepth(
					"  * [x] item1\n* [ ] item2\n\n  sub",
					0,
					"task_list",
				),
			).toBeNull();
			expect(
				dedentSwallowedBlockAtDepth(
					"  * a\n   *   b\n    > c",
					0,
					"bullet_list",
				),
			).toBeNull();
			expect(
				dedentSwallowedBlockAtDepth(
					"  9. a\n  10. b\n     > c",
					0,
					"ordered_list",
				),
			).toBeNull();
			expect(
				dedentSwallowedBlockAtDepth("  * first\n  *\tsecond", 0, "bullet_list"),
			).toBeNull();
			expect(
				dedentSwallowedBlockAtDepth("  > a\n  >\n  >\t  code", 0, "blockquote"),
			).toBeNull();
			expect(
				dedentSwallowedBlockAtDepth("  +\tab\n    - tail", 0, "bullet_list"),
			).toBeNull();
			expect(
				dedentSwallowedBlockAtDepth("  * \\(a\n    b\\)", 0, "bullet_list"),
			).toBeNull();
			expect(
				dedentSwallowedBlockAtDepth(
					"  * item\n\n  \t  para",
					0,
					"bullet_list",
				),
			).toBe("* item\n\n    para");
		});
	});

	describe("6. One-cursor container prefix stripping (Track B #6a, P2)", () => {
		it("strips the carried quote markers, then up to `indent` columns", () => {
			expect(stripBlockContainerPrefix(" > \t> foo", "> ", 1)).toBe("> foo");
			expect(stripBlockContainerPrefix("  > >   x", "> > ", 2)).toBe("x");
			expect(stripBlockContainerPrefix("> x", "> > ", 0)).toBe("x");
			expect(stripBlockContainerPrefix(">", "> ", 2)).toBe("");
			expect(stripBlockContainerPrefix("    > x", "> ", 0)).toBe("    > x");
		});
	});

	describe("7. Wave-54 parser/serializer hardening (cursor padding, multi-math/raw-block swallow, monotonic dedent, Step-1 inline-prefixed display math)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"w54.cursor-ul-math",
				"-    -\n      $$x$$\n\nzz",
				replaceText("zz", "yy"),
				"-    -\n      $$x$$\n\nyy",
				[],
			],
			[
				"w54.cursor-ol-math",
				"1.    -\n       $$x$$\n\nzz",
				replaceText("zz", "yy"),
				"1.    -\n       $$x$$\n\nyy",
				[],
			],
			[
				"w54.cursor-ul-inline-math",
				"-    -\n      $x$\n\nzz",
				replaceText("zz", "yy"),
				"-    -\n      $x$\n\nyy",
				[],
			],
			[
				"w54.mid-math-shared-group",
				"-   item1 $$b$$- item2\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"-   item1 $$b$$- item2\n\npara",
				[],
			],
			[
				"w54.multi-math-shared-group",
				"$$a$$-   item1 $$b$$- item2\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"$$a$$-   item1 $$b$$- item2\n\npara",
				[],
			],
			[
				"w54.multiline-mid-math-shared-group",
				"-   item1\n  x $$b$$- item2\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"-   item1\n  x $$b$$- item2\n\npara",
				[],
			],
			[
				"w54.ol-mid-math-shared-group",
				"1.   item1 $$b$$1. item2\n\ndrop\n\n   para",
				deleteParagraph("drop"),
				"1.   item1 $$b$$1. item2\n\npara",
				[],
			],
			[
				"w54.raw-html-multiline-math",
				"- <div>\\(a\n-   bb\nc\\)</div>\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"- <div>\\(a\n-   bb\nc\\)</div>\n\npara",
				[],
			],
			[
				"w54.raw-html-multiline-math-quoted",
				"> - <div>\\(a\n> -   bb\n> c\\)</div>\n>\n> drop\n>\n>   para",
				deleteParagraph("drop"),
				"> - <div>\\(a\n> -   bb\n> c\\)</div>\n>\n> para",
				[],
			],
			[
				"w54.raw-refdef-multiline-math",
				'- [r]: /u "\\(a\n-   bb\nc\\)"\n\ndrop\n\n  para',
				deleteParagraph("drop"),
				'- [r]: /u "\\(a\n-   bb\nc\\)"\n\npara',
				[],
			],
			[
				"w54.step1-indented-prefixed-math",
				">     foo $$x$$\n\nzz",
				replaceText("foo", "bar"),
				"> ```\n> bar \n> ```\n\n$$x$$\n\nzz",
				[],
			],
			[
				"w55.lazy-blockquote-backtick-math-shield",
				"- abc\n\ndrop\n\n  > head ``\n    continuation\n\n$$x$$ ``",
				deleteParagraph("drop"),
				"- abc\n\n> head ``\n    continuation\n\n$$x$$ ``",
				[],
			],
			[
				"w55.continuation-tab-rejected-list",
				"- abc\n\ndrop\n\n  * first\n  *\tsecond\n\n        code",
				deleteParagraph("drop"),
				"- abc\n\n* first\n\n* second\n\n  ```\n  code\n  ```",
				[],
			],
			[
				"w55.task-list-heterogeneous-indent-rejected",
				"- prev\n\ndrop\n\n  * [x] item1\n* [ ] item2\n\n  sub",
				deleteParagraph("drop"),
				"- prev\n\n* [x] item1\n\n* [ ] item2\n\n  sub",
				[],
			],
			[
				"w55.list-wider-item-lazy-rejected",
				"- prev\n\ndrop\n\n  9. a\n  10. b\n     > c",
				deleteParagraph("drop"),
				"- prev\n\n9. a\n10. b\n    \\> c",
				[],
			],
			[
				"w55.cross-block-backtick-duplicate-last-math-1",
				"pre ``\n\na `` $$b$$- item1\n- x ``$$b$$-   fake``\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"pre ``\n\na `` $$b$$- item1\n- x ``$$b$$-   fake``\n\npara",
				[],
			],
			[
				"w55.cross-block-backtick-duplicate-last-math-2",
				"pre ``\n\na `` $$b$$- item1\n- x `` $$b$$-   fake\n\ndrop\n\n  para\n\npost ``",
				deleteParagraph("drop"),
				"pre ``\n\na `` $$b$$- item1\n- x `` $$b$$-   fake\n\npara\n\npost ``",
				[],
			],
			[
				"w55.indented-code-cont-display-math",
				">     foo\n>     $$x$$\n\nzz",
				replaceText("foo", "baz"),
				"> ```\n> baz\n> ```\n>\n> $$x$$\n\nzz",
				[],
			],
			[
				"w55.indented-code-cont-prefixed-display-math",
				">     foo\n>     bar $$x$$\n\nzz",
				replaceText("foo", "baz"),
				"> ```\n> baz\n> bar \n> ```\n\n$$x$$\n\nzz",
				[],
			],
			[
				"w55.indented-code-multiline-inline-math-plus-display",
				">     foo \\(a\nb\\) $$x$$\n\nzz",
				replaceText("zz", "yy"),
				">     foo \\(a\nb\\) $$x$$\n\nyy",
				[],
			],
			[
				"w55.indented-code-multiline-inline-math-only",
				">     foo \\(a\nb\\)\n\nzz",
				replaceText("zz", "yy"),
				">     foo \\(a\nb\\)\n\nyy",
				[],
			],
		];
		runCases(cases);

		it("keeps liveness and serializer monotonically aligned on matched-invalidated and paired containers across Wave-2 list indent growth", () => {
			// Path A: matched-invalidated blockquote downgraded by headLineHasRisk
			const pathA = [
				"1. item1",
				"2. item2",
				"3. item3",
				"4. item4",
				"5. item5",
				"6. item6",
				"7. item7",
				"8. item8",
				"9. item9",
				"1. [q]",
				"",
				"drop",
				"",
				"   > [p]: /u",
				'   > "t',
				"   > ===",
				"   >",
				"   > [s]",
				"",
				"prefix `` [link][p]",
				"",
				"$$x$$ ``",
				"",
				"- [r]",
				"",
				"  [q]: /q",
				'  "qt',
				"  ===",
				"",
				"[s]: /s",
				"",
				"[r]: /r",
			].join("\n");
			const parsedA = parser.parseMarkdownWithBlockSources(pathA);
			const guardA = createMarkdownRoundTripGuard(pathA, parsedA);
			const editedA = chain(
				deleteParagraph("drop"),
				deleteRefDef("s"),
				deleteRefDef("r"),
			)(guardA.initialDoc);
			const liveA = computeIntactRefDefLabels(
				editedA,
				parsedA,
				MARKDOWN_SERIALIZERS.serializeBlock,
				MARKDOWN_SERIALIZERS.serializeBlockWithRefs,
			);
			const serializedA = guardA.serialize(editedA);
			expect(liveA.partialTitleIntact.has("P")).toBe(false);
			expect(serializedA).not.toContain('   > "t\n   > ===');

			// Path B: paired edited blockquote downgraded by headLineHasRisk
			const pathB = [
				"1. item1",
				"2. item2",
				"3. item3",
				"4. item4",
				"5. item5",
				"6. item6",
				"7. item7",
				"8. item8",
				"9. item9",
				"1. [q]",
				"11. dropli",
				"",
				"   > [p]: /u",
				'   > "t',
				"   > ===",
				"   >",
				"   > editme",
				"",
				"prefix `` [link][p]",
				"",
				"$$x$$ ``",
				"",
				"- [r]",
				"",
				"  [q]: /q",
				'  "qt',
				"  ===",
				"",
				"[r]: /r",
			].join("\n");
			const parsedB = parser.parseMarkdownWithBlockSources(pathB);
			const guardB = createMarkdownRoundTripGuard(pathB, parsedB);
			const editedB = chain(
				deleteListItem("dropli"),
				replaceText("editme", "edited"),
				deleteRefDef("r"),
			)(guardB.initialDoc);
			const liveB = computeIntactRefDefLabels(
				editedB,
				parsedB,
				MARKDOWN_SERIALIZERS.serializeBlock,
				MARKDOWN_SERIALIZERS.serializeBlockWithRefs,
			);
			const serializedB = guardB.serialize(editedB);
			expect(liveB.partialTitleIntact.has("P")).toBe(false);
			expect(serializedB).not.toContain('   > "t\n   > ===');
		});

		it("keeps liveness and serializer monotonically aligned when a Wave-2 list indent grows past an already-dedented follower", () => {
			const md = [
				"1. item1",
				"2. item2",
				"3. item3",
				"4. item4",
				"5. item5",
				"6. item6",
				"7. item7",
				"8. item8",
				"9. item9",
				"1. [q]",
				"",
				"drop",
				"",
				"   * b",
				"",
				"  > [p]: /u",
				'  > "t',
				"  > ===",
				"  >",
				"  > editme",
				"",
				"prefix `` [link][p]",
				"",
				"$$x$$ ``",
				"",
				"- [r]",
				"",
				"  [q]: /q",
				'  "qt',
				"  ===",
				"",
				"[r]: /r",
			].join("\n");
			const parsed = parser.parseMarkdownWithBlockSources(md);
			const guard = createMarkdownRoundTripGuard(md, parsed);
			const edited = chain(
				deleteParagraph("drop"),
				replaceText("editme", "edited"),
				deleteRefDef("r"),
			)(guard.initialDoc);
			const live = computeIntactRefDefLabels(
				edited,
				parsed,
				MARKDOWN_SERIALIZERS.serializeBlock,
				MARKDOWN_SERIALIZERS.serializeBlockWithRefs,
			);
			const serialized = guard.serialize(edited);
			expect(live.partialTitleIntact.has("P")).toBe(false);
			// Serializer honors the monotonic dedent of `* b` instead of leaving
			// `   * b` and a dangling live `[p]: /u` behind while liveness killed P.
			expect(serialized).toContain("\n\n* b\n\n");
			expect(serialized).not.toContain('  > "t\n  > ===');
		});

		it("keeps PHP math scanning clean on single-codepoint nested list markers", () => {
			expect(scanPhpMarkdownMathRanges("-    -\n      $$x$$\n\nzz")).toEqual(
				[],
			);
			expect(scanPhpMarkdownMathRanges("-    -\n      $x$\n\nzz")).toEqual([]);
			expect(
				docShape(">     foo $$x$$\n\nzz"),
			).toContain("protected_block");
		});

		it("detects swallow risk on a 1-item list whose inline code repeats the preceding display math", () => {
			const md = [
				"pre ``",
				"",
				"a `` $$b$$- x ``$$b$$-   fake``",
				"",
				"drop",
				"",
				"  para",
			].join("\n");
			const parsed = parser.parseMarkdownWithBlockSources(md);
			const guard = createMarkdownRoundTripGuard(md, parsed);
			const edited = deleteParagraph("drop")(guard.initialDoc);
			const serialized = guard.serialize(edited);
			// `para` must be dedented to column 0 so it is not swallowed into `- x ...`.
			expect(serialized).toContain("\n\npara");
			expect(serialized).not.toContain("\n\n  para");
		});

		it("preserves depth>=1 blockquote lazy continuations during swallow-risk dedent", () => {
			const md = [
				"> - abc",
				">",
				"> drop",
				">",
				">   > head ``",
				"    continuation",
				">",
				"> $$x$$ ``",
			].join("\n");
			const parsed = parser.parseMarkdownWithBlockSources(md);
			const guard = createMarkdownRoundTripGuard(md, parsed);
			const edited = deleteParagraph("drop")(guard.initialDoc);
			const serialized = guard.serialize(edited);
			expect(serialized).toBe(
				[
					"> - abc",
					">",
					"> > head ``",
					"    continuation",
					">",
					"> $$x$$ ``",
				].join("\n"),
			);
		});

		it("keeps liveness and serializer monotonically locked across Pass-1 canonical downgrades when Wave-2 list indent grows", () => {
			const md = [
				"1. item1",
				"2. item2",
				"3. item3",
				"4. item4",
				"5. item5",
				"6. item6",
				"7. item7",
				"8. item8",
				"9. item9",
				"1. [q]",
				"",
				"drop",
				"",
				"   > [p]: /u",
				'   > "t',
				"   > ===",
				"  > second",
				"",
				"[link][p]",
				"",
				"- [r]",
				"",
				"  [q]: /q",
				'  "qt',
				"  ===",
				"",
				"[r]: /r",
			].join("\n");
			const parsed = parser.parseMarkdownWithBlockSources(md);
			const guard = createMarkdownRoundTripGuard(md, parsed);
			const edited = chain(
				deleteParagraph("drop"),
				deleteRefDef("r"),
			)(guard.initialDoc);
			const live = computeIntactRefDefLabels(
				edited,
				parsed,
				MARKDOWN_SERIALIZERS.serializeBlock,
				MARKDOWN_SERIALIZERS.serializeBlockWithRefs,
			);
			const serialized = guard.serialize(edited);
			expect(live.partialTitleIntact.has("P")).toBe(false);
			// Serializer honors Pass-1 canonical downgrade instead of resurrecting raw
			// `   > [p]: /u` after Wave-2 grows `1.` -> `10.`.
			expect(serialized).not.toContain('   > "t\n   > ===');
			expect(serialized).toContain('[link](/u "t&#10;")');
		});
	});
});
