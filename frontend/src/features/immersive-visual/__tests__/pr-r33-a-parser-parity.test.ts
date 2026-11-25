import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
	parseMarkdownToVisualDoc,
	prescanMarkdown,
} from "../markdown-parser";
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

function collectLinkHrefs(doc: ProseMirrorNode): string[] {
	const hrefs: string[] = [];
	doc.descendants((node) => {
		if (node.isText) {
			for (const mark of node.marks) {
				if (mark.type.name === "link" && typeof mark.attrs.href === "string") {
					hrefs.push(mark.attrs.href);
				}
			}
		}
		return true;
	});
	return hrefs;
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

describe("PR-R33-A immersive visual parser & preservation PHP parity", () => {
	describe("1. Blockquote 4-column `>` prefix validation & lazy refdef continuations (Track A #1)", () => {
		it("keeps 4-column/tab-indented `>` markers after refdefs as literal paragraph text and preserves them across edits", () => {
			// Primary reproducer: `>[r]: u\n\t>     c\n\t> =` -> paragraph keeping `>` and `=`.
			const md = ">[r]: u\n\t>     c\n\t> =";
			const guard = createMarkdownRoundTripGuard(md);
			expect(topLevelTypes(guard.initialDoc)).toEqual(["blockquote"]);
			expect(topLevelTypes(guard.initialDoc.child(0))).toEqual([
				"protected_block",
				"paragraph",
			]);
			expect(guard.initialDoc.child(0).child(1).textContent).toBe(
				">     c\n> =",
			);
			expect(findFirstNodeByType(guard.initialDoc, "heading")).toBeNull();
			expect(guard.serialize(guard.initialDoc)).toBe(md);

			// Editing `c` -> `cZ` preserves paragraph with `>` and `=` (NO heading).
			const edited = insertTextAfterFirstMatch(guard.initialDoc, "c", "Z");
			const serialized = guard.serialize(edited);
			expect(serialized).not.toContain("# ");
			expect(serialized).toContain("\\>     cZ");
			expect(serialized).toContain("\\> =");
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(findFirstNodeByType(reparsed, "heading")).toBeNull();
			expect(reparsed.child(0).child(1).textContent).toBe(">     cZ\n> =");
			expect(reparsed.eq(edited)).toBe(true);

			// 4-space `>`, nested tab-indented `>`, lazy `=`, and non-refdef 4-space `>` all stay paragraphs.
			for (const [sample, expectedText] of [
				[">[r]: u\n    >     c\n    > =", ">     c\n> ="],
				["> [r]: u\n    c\n=", "c\n="],
				[">[r]: u\n>     c\n\t> =", "c\n> ="],
				["> a\n    > b", "a\n> b"],
				["> a\n\t> c\n\t> =", "a\n> c\n> ="],
			] as const) {
				const doc = parseMarkdownToVisualDoc(sample);
				expect(topLevelTypes(doc), sample).toEqual(["blockquote"]);
				expect(findFirstNodeByType(doc, "heading"), sample).toBeNull();
				const para = findFirstNodeByType(doc, "paragraph");
				expect(para?.textContent, sample).toBe(expectedText);
			}

			// Nested double blockquote where both markers are tab-indented stays paragraph inside inner blockquote.
			const nestedTab = parseMarkdownToVisualDoc(">>[r]: u\n\t>     c\n\t> =");
			expect(topLevelTypes(nestedTab)).toEqual(["blockquote"]);
			expect(topLevelTypes(nestedTab.child(0))).toEqual(["blockquote"]);
			expect(topLevelTypes(nestedTab.child(0).child(0))).toEqual([
				"protected_block",
				"paragraph",
			]);
			expect(nestedTab.child(0).child(0).child(1).textContent).toBe(
				">     c\n> =",
			);

			// List lazy continuation after refdef (`10. [r]: u\n  c\n===`) stays paragraph, NOT Setext.
			const listLazy = parseMarkdownToVisualDoc("10. [r]: u\n  c\n===");
			expect(topLevelTypes(listLazy)).toEqual(["ordered_list"]);
			expect(findFirstNodeByType(listLazy, "heading")).toBeNull();
			expect(listLazy.child(0).child(0).child(2).textContent).toBe("c\n===");

			// Cross-blockquote refdef followed by lazy paragraph text keeps `c` inside blockquote.
			const crossBqWithText = parseMarkdownToVisualDoc(
				"> [a]: /a\n[b]: /b\nc\n\n[a] [b]",
			);
			expect(topLevelTypes(crossBqWithText)).toEqual([
				"blockquote",
				"paragraph",
			]);
			expect(crossBqWithText.child(0).lastChild?.textContent).toBe("c");
			expect(collectLinkHrefs(crossBqWithText)).toEqual(["/a", "/b"]);
		});

		it("preserves valid 0–3-space blockquote, nested tab-stop, math, and list refdef-indented Setext headings", () => {
			// Valid blockquote markers (`>`, `   >`, `>\t>`, `- >` + `  \t>`), plus lazy text + valid `> =`.
			for (const [sample, expectedText] of [
				[">[r]: u\n>     c\n> =", "c"],
				[">[r]: u\n   >     c\n   > =", "c"],
				[">[r]: u\n\t>     c\n> =", ">     c"],
				[">[r]: u\n    c\n> =", "c"],
				[">>[r]: u\n>\t>     c\n>\t> =", "c"],
				["- >[r]: u\n  \t>     c\n  \t> =", "c"],
				["$$x$$ [r]: /u\n    a\n===", "a"],
				["- [r]: /u\n      a\n  ===", "a"],
			] as const) {
				const doc = parseMarkdownToVisualDoc(sample);
				const heading = findFirstNodeByType(doc, "heading");
				expect(heading, sample).not.toBeNull();
				expect(heading?.attrs.level, sample).toBe(1);
				expect(heading?.textContent, sample).toBe(expectedText);
			}
		});
	});

	describe("2. Ancestor list indent stack for 3+-level nested list lazy continuations (Track B Finding 1)", () => {
		it("rejects spurious tables when a 3+-level nested list lazy line opens an interrupting block at an outer ancestor indent", () => {
			const negativeCases: ReadonlyArray<string> = [
				"10. - - a | b\n    # h\n        | - |",
				"> 10. - - a | b\n>     # h\n>         | - |",
				"10. - - a | b\n\t# h\n        | - |",
				"10. - - a | b\n    2. c\n        | - |",
				"10. - - a | b\n    01. c\n        | - |",
				"10. - - a | b\n    -\n        | - |",
				"10. - - a | b\n    > q\n        | - |",
				"10. - - a | b\n    ```\n        | - |",
				"10. - - a | b\n    ***\n        | - |",
				"10. - - a | b\n     # h\n        | - |",
				"10. - - a | b\n      # h\n        | - |",
				"10. 10. - a | b\n    # h\n          | - |",
				"10. 10. - a | b\n        # h\n          | - |",
				"1000. - - a | b\n      # h\n          | - |",
				"- > - a | b\n  > # h\n  >   | - |",
				"10. > 10. - - a | b\n    >     # h\n    >         | - |",
			];

			for (const md of negativeCases) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(findFirstNodeByType(doc, "table"), md).toBeNull();
			}

			// Verify exact nested heading + code block structure on primary reproducer.
			const primary = parseMarkdownToVisualDoc(
				"10. - - a | b\n    # h\n        | - |",
			);
			expect(topLevelTypes(primary)).toEqual(["ordered_list"]);
			const outerItem = primary.child(0).child(0);
			expect(topLevelTypes(outerItem)).toEqual([
				"paragraph",
				"bullet_list",
				"heading",
				"code_block",
			]);
			expect(outerItem.child(2).attrs.level).toBe(1);
			expect(outerItem.child(2).textContent).toBe("h");
			expect(outerItem.child(3).textContent).toBe("| - |");

			// Edit round-trip preserves H1 `# h` and 0 tables.
			const guard = createMarkdownRoundTripGuard(
				"10. - - a | b\n    # h\n        | - |",
			);
			const edited = insertTextAfterFirstMatch(guard.initialDoc, "h", "Z");
			const reparsed = parseMarkdownToVisualDoc(guard.serialize(edited));
			expect(findFirstNodeByType(reparsed, "table")).toBeNull();
			expect(findFirstNodeByType(reparsed, "heading")?.textContent).toBe("hZ");
			expect(reparsed.eq(edited)).toBe(true);
		});

		it("preserves valid lazy-continuation tables inside 3+-level and outer-indented lists", () => {
			const positiveCases: ReadonlyArray<readonly [string, string]> = [
				["10. - - a | b\n    plain\n        | - |", "plain"],
				["1000. - - a | b\n    # h\n          | - |", "# h"],
				["1000. - - a | b\n    2. c\n          | - |", "2. c"],
				["> - a | b\n> ===\n>   | - |", "==="],
				["- a | b\nc\n  | - |", "c"],
			];

			for (const [md, expectedHeader] of positiveCases) {
				const doc = parseMarkdownToVisualDoc(md);
				const table = findFirstNodeByType(doc, "table");
				expect(table, md).not.toBeNull();
				expect(table?.child(0).child(0).textContent, md).toBe(expectedHeader);
			}
		});
	});

	describe("3. TableStartParser vs ReferenceParser precedence on incomplete refdef headers (Track B Finding 2)", () => {
		it("parses incomplete refdef lines followed by matching GFM delimiters as tables matching PHP", () => {
			// Single-line incomplete refdef headers -> 2-col and 1-col tables.
			for (const [md, expectedHeaders] of [
				["[a | b]:\n|-|--|", ["[a", "b]:"]],
				["[a | b]:\n---|---", ["[a", "b]:"]],
				["[a\\|b]:\n|-|", ["[a|b]:"]],
			] as const) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual(["table"]);
				const headerRow = doc.child(0).child(0);
				const headers = Array.from(
					{ length: headerRow.childCount },
					(_, c) => headerRow.child(c).textContent,
				);
				expect(headers, md).toEqual([...expectedHeaders]);
			}

			// Multiline incomplete label split before GFM table delimiter (both 0-space and 4-space indented sep).
			for (const [md, expectedPara, expectedHeaders] of [
				["[a |\nb]:\n|-|", "[a |", ["b]:"]],
				["[a |\nb]:\n    |-|", "[a |", ["b]:"]],
				["[a\nb | c]:\n|-|--|", "[a", ["b", "c]:"]],
			] as const) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual(["paragraph", "table"]);
				expect(doc.child(0).textContent, md).toBe(expectedPara);
				const headerRow = doc.child(1).child(0);
				const headers = Array.from(
					{ length: headerRow.childCount },
					(_, c) => headerRow.child(c).textContent,
				);
				expect(headers, md).toEqual([...expectedHeaders]);
			}

			// Incomplete multiline title interrupted by a matching GFM delimiter steals lines 1..3 as table.
			const titleSteal = parseMarkdownToVisualDoc(
				'[a]: /u\n"t | u\n| - | - |\n"',
			);
			expect(topLevelTypes(titleSteal)).toEqual(["protected_block", "table"]);
			expect(titleSteal.child(1).childCount).toBe(2);
			expect(titleSteal.child(1).child(0).child(0).textContent).toBe('"t');
			expect(titleSteal.child(1).child(0).child(1).textContent).toBe("u");
			expect(titleSteal.child(1).child(1).child(0).textContent).toBe('"');

			// Controls: valid refdefs stay refdefs (0 tables).
			const ref1 = parseMarkdownToVisualDoc("[a | b]:\n|-|\n\n[a | b]");
			expect(findFirstNodeByType(ref1, "table")).toBeNull();
			expect(collectLinkHrefs(ref1)).toEqual(["%7C-%7C"]);

			for (const md of [
				"[a | b]: /u\n| - | - |",
				'[a]: /u\n"t | u"\n| - | - |',
				"[a\nb | c]: /u\n| - | - |",
			]) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual([
					"protected_block",
					"paragraph",
				]);
				expect(findFirstNodeByType(doc, "table"), md).toBeNull();
			}

			const noPipeRef = parseMarkdownToVisualDoc("[a\nb]:\n|-|\n\n[a b]");
			expect(findFirstNodeByType(noPipeRef, "table")).toBeNull();
			expect(collectLinkHrefs(noPipeRef)).toEqual(["%7C-%7C"]);

			// Edit round-trip on `[a | b]:\n|-|--|`: editing `[a` -> `[aZ` preserves 2-col table.
			const guard = createMarkdownRoundTripGuard("[a | b]:\n|-|--|");
			const edited = insertTextAfterFirstMatch(guard.initialDoc, "[a", "Z");
			const reparsed = parseMarkdownToVisualDoc(guard.serialize(edited));
			expect(topLevelTypes(reparsed)).toEqual(["table"]);
			expect(reparsed.eq(edited)).toBe(true);
		});

		it("maintains strict O(N) performance on long multiline reference titles with repeated table delimiters", () => {
			// Each `|-|` (1 col) follows a 3-cell line (`a | b | c`) so the probe
			// checks every delimiter without breaking, plus a 4,000-line plain title
			// ending with `|-|` to stress incremental ref-parser scanning.
			const samples: ReadonlyArray<readonly [string, string]> = [
				[
					"wide_header_before_1col_delims",
					`[a]: /u\n"title\n${"a | b | c\n|-|\n".repeat(2_000)}"`,
				],
				[
					"long_plain_title_then_delim",
					`[a]: /u\n"title\n${"plain\n".repeat(4_000)}|-|\n"`,
				],
			];
			for (const [label, md] of samples) {
				const start = performance.now();
				const doc = parseMarkdownToVisualDoc(md);
				const elapsed = performance.now() - start;
				expect(elapsed, label).toBeLessThan(1_000);
				expect(findFirstNodeByType(doc, "table"), label).toBeNull();
			}
		});
	});

	describe("4. Generalize reusedIndentedBlockAfterBlank for untouched 4-space tables and protected blocks (Track B Finding 3)", () => {
		it("re-serializes untouched 4-space/tab-indented tables and display math cleanly when preceded by a blank line or moved to doc start", () => {
			// 1. `"hello\n    | a | b |\n| --- | --- |"` -> edit `"hello"` to `"hello!"`
			{
				const guard = createMarkdownRoundTripGuard(
					"hello\n    | a | b |\n| --- | --- |",
				);
				expect(topLevelTypes(guard.initialDoc)).toEqual(["paragraph", "table"]);
				const edited = insertTextAfterFirstMatch(
					guard.initialDoc,
					"hello",
					"!",
				);
				const serialized = guard.serialize(edited);
				expect(serialized).toBe("hello!\n\n| a | b |\n| --- | --- |");
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(topLevelTypes(reparsed)).toEqual(["paragraph", "table"]);
				expect(findFirstNodeByType(reparsed, "code_block")).toBeNull();
				expect(reparsed.eq(edited)).toBe(true);
			}

			// 2. `"[r]: /u\n    | a | b |\n| --- | --- |"` -> delete `[r]: /u`
			{
				const guard = createMarkdownRoundTripGuard(
					"[r]: /u\n    | a | b |\n| --- | --- |",
				);
				expect(topLevelTypes(guard.initialDoc)).toEqual([
					"protected_block",
					"table",
				]);
				const deleted = guard.initialDoc.type.create(null, [
					guard.initialDoc.child(1),
				]);
				const serialized = guard.serialize(deleted);
				expect(serialized).toBe("| a | b |\n| --- | --- |");
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(topLevelTypes(reparsed)).toEqual(["table"]);
				expect(findFirstNodeByType(reparsed, "code_block")).toBeNull();
				expect(reparsed.eq(deleted)).toBe(true);
			}

			// 3. `"hello\n    $$x$$"` (plus tab indent, `\[x\]`, and multiline `$$\nx\n$$`) -> edit `"hello"` to `"hello!"`
			for (const [md, expectedMath] of [
				["hello\n    $$x$$", "$$x$$"],
				["hello\n\t$$x$$", "$$x$$"],
				["hello\n    \\[x\\]", "\\[x\\]"],
				["hello\n    $$\n    x\n    $$", "$$\nx\n$$"],
			] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				expect(topLevelTypes(guard.initialDoc), md).toEqual([
					"paragraph",
					"protected_block",
				]);
				const edited = insertTextAfterFirstMatch(
					guard.initialDoc,
					"hello",
					"!",
				);
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(`hello!\n\n${expectedMath}`);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(topLevelTypes(reparsed), md).toEqual([
					"paragraph",
					"protected_block",
				]);
				expect(reparsed.child(1).attrs.kind, md).toBe("math");
				expect(findFirstNodeByType(reparsed, "code_block"), md).toBeNull();
				expect(reparsed.eq(edited), md).toBe(true);
			}

			// 4. `"[r]: /u\n    $$x$$"` -> delete `[r]: /u`
			{
				const guard = createMarkdownRoundTripGuard("[r]: /u\n    $$x$$");
				expect(topLevelTypes(guard.initialDoc)).toEqual([
					"protected_block",
					"protected_block",
				]);
				const deleted = guard.initialDoc.type.create(null, [
					guard.initialDoc.child(1),
				]);
				const serialized = guard.serialize(deleted);
				expect(serialized).toBe("$$x$$");
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(topLevelTypes(reparsed)).toEqual(["protected_block"]);
				expect(reparsed.child(0).attrs.kind).toBe("math");
				expect(reparsed.eq(deleted)).toBe(true);
			}

			// Control: editing a later unrelated block preserves untouched `"hello\n    | a | b |\n| --- | --- |"` bytes.
			{
				const guard = createMarkdownRoundTripGuard(
					"hello\n    | a | b |\n| --- | --- |\n\nfooter",
				);
				const edited = insertTextAfterFirstMatch(
					guard.initialDoc,
					"footer",
					"!",
				);
				expect(guard.serialize(edited)).toBe(
					"hello\n    | a | b |\n| --- | --- |\n\nfooter!",
				);
			}
		});
	});

	describe("5. Split single-line display math that would fabricate a bogus §4.7 refdef if left inline-masked (Track B Finding 4)", () => {
		it("splits display-math lines that would otherwise form bogus refdefs in markdown-it", () => {
			// None of these are refdefs in PHP -> 0 links, visible display-math protected_block(math).
			const noLinkCases: ReadonlyArray<string> = [
				"[r]: $$x$$\n\n[r]",
				"[r]: \\[x\\]\n\n[r]",
				'[r]: /u "$$x$$"\n\n[r]',
				"[r]: /u '$$x$$'\n\n[r]",
				"[r]: /u ($$x$$)\n\n[r]",
				"[$$x$$]: /u\n\n[$$x$$]",
				"[foo\n$$x$$]: /u\n\n[foo]",
				"> [r]: $$x$$\n>\n> [r]",
				"[$$x$$]:\n/u\n\n[$$x$$]",
				"[foo\na $$x$$\nbar]: /u\n\n[foo]",
			];

			for (const md of noLinkCases) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(collectLinkHrefs(doc), md).toEqual([]);
				const mathBlock = findFirstNodeByType(doc, "protected_block");
				expect(mathBlock?.attrs.kind, md).toBe("math");
			}

			// `[r]: /u\n"$$x$$"\n\n[r]` (plus multiline and 4-space indented title variants):
			// `[r]: /u` stays a valid refdef, while `"$$x$$"` splits into visible math + quotes (not absorbed into title).
			for (const md of [
				'[r]: /u\n"$$x$$"\n\n[r]',
				'[r]: /u\n    "$$x$$"\n\n[r]',
				'[r]: /u\n"$$x$$\nend"\n\n[r]',
			]) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual([
					"protected_block",
					"paragraph",
					"protected_block",
					"paragraph",
					"paragraph",
				]);
				expect(doc.child(2).attrs.kind, md).toBe("math");
				expect(collectLinkHrefs(doc), md).toEqual(["/u"]);
			}

			// Edit round-trip on `[r]: $$x$$\n\n[r]` preserves non-link `[r]` and display math.
			const guard = createMarkdownRoundTripGuard("[r]: $$x$$\n\n[r]");
			const edited = insertTextAfterFirstMatch(guard.initialDoc, "[r]", "Z");
			const reparsed = parseMarkdownToVisualDoc(guard.serialize(edited));
			expect(collectLinkHrefs(reparsed)).toEqual([]);
			expect(reparsed.eq(edited)).toBe(true);

			// Positive controls: plain inline display math stays inline; real refdefs before display math still resolve.
			for (const md of ["Hello $$x$$ world", "Hello $$x$$\nnext line"]) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual(["paragraph"]);
				expect(collectProtectedInlineRaws(doc), md).toEqual(["$$x$$"]);
			}

			const realBeforeMath = parseMarkdownToVisualDoc(
				'[r]: /u\n"title" $$x$$\n\n[r]',
			);
			expect(collectLinkHrefs(realBeforeMath)).toEqual(["/u"]);
			expect(
				realBeforeMath.child(0).type.name === "protected_block" &&
					realBeforeMath.child(1).attrs.kind === "math",
			).toBe(true);
		});

		it("maintains strict O(N) performance on long documents with repeated refdef-like display-math lines", () => {
			const samples: ReadonlyArray<readonly [string, string]> = [
				[
					"repeated_unclosed_label_display_math",
					`${"[a $$x$$\n".repeat(4_000)}`,
				],
				[
					"repeated_unclosed_title_display_math",
					`[r]: /u\n"${"a $$x$$\n".repeat(4_000)}`,
				],
				[
					"long_plain_title_between_display_math",
					`[r]: /u\n"a $$x$$\n${"plain\n".repeat(4_000)}b $$y$$\n${"plain\n".repeat(4_000)}`,
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
