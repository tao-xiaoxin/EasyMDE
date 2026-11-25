import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { escapeInlineMarkdownText } from "../markdown-escape";
import {
	parseMarkdownToVisualDoc,
	prescanMarkdown,
} from "../markdown-parser";
import { isTableSeparatorInterruptedByHigherPriorityBlock } from "../markdown-prescanner-tables";
import {
	createMarkdownRoundTripGuard,
	serializeVisualDocToMarkdown,
} from "../markdown-serializer";

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

describe("PR-R31-A immersive visual parser & escaper PHP parity", () => {
	describe("1. TableStartParser vs block-interruption priority (Track A #1 + Track B F2)", () => {
		it("lets higher-priority PHP block parsers (list, blockquote, heading, fence, HTML, HR) beat TableStartParser on separator lines (Track A #1)", () => {
			// List markers with < 4 leading columns interrupt the open paragraph before TableStartParser runs.
			for (const [md, listType] of [
				["x | y\n- | -", "bullet_list"],
				["x | y\n* | *", "bullet_list"],
				["x | y\n+ | +", "bullet_list"],
				["x | y\n   - | -", "bullet_list"],
				["x | y\n-\t| -", "bullet_list"],
				["x | y\n1. | -", "ordered_list"],
				["x | y\n1) | -", "ordered_list"],
			] as const) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual(["paragraph", listType]);
				expect(doc.child(0).textContent, md).toBe("x | y");
				expect(findFirstNodeByType(doc, "table"), md).toBeNull();
			}

			// Inside blockquote with tab leaving < 4 virtual columns (`>\t- | -` -> 2 cols < 4).
			const quotedTabList = parseMarkdownToVisualDoc("> x | y\n>\t- | -");
			expect(topLevelTypes(quotedTabList)).toEqual(["blockquote"]);
			expect(topLevelTypes(quotedTabList.child(0))).toEqual([
				"paragraph",
				"bullet_list",
			]);

			// Inside list with 3 relative spaces (`- x | y\n     - | -` -> 3 < 4).
			const nestedList = parseMarkdownToVisualDoc("- x | y\n     - | -");
			expect(topLevelTypes(nestedList)).toEqual(["bullet_list"]);
			expect(findFirstNodeByType(nestedList, "table")).toBeNull();

			// Edit round-trip on `x | y\n- | -`: editing `x` -> `xZ` must NEVER turn it into a GFM table.
			const guard = createMarkdownRoundTripGuard("x | y\n- | -");
			expect(guard.serialize(guard.initialDoc)).toBe("x | y\n- | -");
			const edited = insertTextAfterFirstMatch(guard.initialDoc, "x", "Z");
			const serialized = guard.serialize(edited);
			expect(serialized).not.toContain("| --- |");
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(topLevelTypes(reparsed)).toEqual(["paragraph", "bullet_list"]);
			expect(reparsed.child(0).textContent).toBe("xZ | y");
			expect(reparsed.eq(edited)).toBe(true);

			// Shared helper parity for non-list higher-priority interrupting blocks & non-interrupting ordered markers.
			expect(isTableSeparatorInterruptedByHigherPriorityBlock("- | -", 0)).toBe(
				true,
			);
			expect(
				isTableSeparatorInterruptedByHigherPriorityBlock("1. | -", 0),
			).toBe(true);
			expect(
				isTableSeparatorInterruptedByHigherPriorityBlock("2. | -", 0),
			).toBe(false);
			expect(
				isTableSeparatorInterruptedByHigherPriorityBlock("01. | -", 0),
			).toBe(false);
			expect(
				isTableSeparatorInterruptedByHigherPriorityBlock("    - | -", 0),
			).toBe(false);
			expect(isTableSeparatorInterruptedByHigherPriorityBlock("> | -", 0)).toBe(
				true,
			);
			expect(isTableSeparatorInterruptedByHigherPriorityBlock("# | -", 0)).toBe(
				true,
			);
			expect(
				isTableSeparatorInterruptedByHigherPriorityBlock("``` | -", 0),
			).toBe(true);
			expect(
				isTableSeparatorInterruptedByHigherPriorityBlock("<div> | -", 0),
			).toBe(true);
			expect(isTableSeparatorInterruptedByHigherPriorityBlock("===", 0)).toBe(
				true,
			);
			expect(isTableSeparatorInterruptedByHigherPriorityBlock("---", 0)).toBe(
				true,
			);

			// Ordered lists with start != 1 or zero-padded `01.` cannot interrupt a paragraph and are not tables.
			for (const md of ["x | y\n2. | -", "x | y\n01. | -"]) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual(["paragraph"]);
				expect(findFirstNodeByType(doc, "table"), md).toBeNull();
			}

			// Valid GFM table separators remain valid tables, including 4-space/tab `- | -`.
			for (const md of [
				"x | y\n--- | ---",
				"x | y\n-- | -",
				"x | y\n-|-",
				"x | y\n| - | - |",
				"x | y\n:- | -:",
				"x | y\n    - | -",
				"x | y\n\t- | -",
			]) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual(["table"]);
				const table = doc.child(0);
				expect(table.child(0).childCount, md).toBe(2);
				expect(table.child(0).child(0).textContent, md).toBe("x");
				expect(table.child(0).child(1).textContent, md).toBe("y");
			}

			// 4-space indented `- | -` inside blockquote and list also stays a table.
			const quoted4Sp = parseMarkdownToVisualDoc("> x | y\n>     - | -");
			expect(topLevelTypes(quoted4Sp.child(0))).toEqual(["table"]);
			const list4Sp = parseMarkdownToVisualDoc("- x | y\n      - | -");
			expect(findFirstNodeByType(list4Sp, "table")).not.toBeNull();
		});

		it("accepts 4-space and tab indented GFM table delimiter lines including annotated tables (Track B F2a)", () => {
			for (const md of [
				"| a |\n    | - |",
				"| a |\n\t| - |",
				"| a |\n     | - |",
			]) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual(["table"]);
				expect(doc.child(0).child(0).child(0).textContent, md).toBe("a");
			}

			const annotated =
				'<!-- easymde-table-align:v1 [[0,"right"]] -->\n| a |\n    | - |';
			const guard = createMarkdownRoundTripGuard(annotated);
			expect(topLevelTypes(guard.initialDoc)).toEqual(["table"]);
			const table = guard.initialDoc.child(0);
			expect(table.attrs.alignAnnotation).toBe(
				'<!-- easymde-table-align:v1 [[0,"right"]] -->',
			);
			expect(table.child(0).child(0).attrs.textAlign).toBe("right");
			expect(guard.serialize(guard.initialDoc)).toBe(annotated);

			const edited = insertTextAfterFirstMatch(guard.initialDoc, "a", "Z");
			const serialized = guard.serialize(edited);
			expect(serialized).toBe(
				'<!-- easymde-table-align:v1 [[0,"right"]] -->\n| aZ |\n| --- |',
			);
			expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);

			// Prescanner also emits TBLALIGN (never raw protected_block) for annotated 4-space/tab delimiter tables.
			const pre = prescanMarkdown(annotated);
			expect(pre.tableAlignMarkers.size).toBe(1);
			expect(pre.protectedBlocks.size).toBe(0);
		});

		it("accepts 4-space indented table header continuation lines inside open paragraphs (Track B F2b)", () => {
			const topLevel = parseMarkdownToVisualDoc("a\n    b | c\n| - | - |");
			expect(topLevelTypes(topLevel)).toEqual(["paragraph", "table"]);
			expect(topLevel.child(0).textContent).toBe("a");
			expect(topLevel.child(1).child(0).child(0).textContent).toBe("b");
			expect(topLevel.child(1).child(0).child(1).textContent).toBe("c");

			const noPipeHeader = parseMarkdownToVisualDoc("a | b\n    c\n| - |");
			expect(topLevelTypes(noPipeHeader)).toEqual(["paragraph", "table"]);
			expect(noPipeHeader.child(0).textContent).toBe("a | b");
			expect(noPipeHeader.child(1).child(0).child(0).textContent).toBe("c");

			const dashHeader = parseMarkdownToVisualDoc("a | b\n    - c\n| - |");
			expect(topLevelTypes(dashHeader)).toEqual(["paragraph", "table"]);
			expect(dashHeader.child(1).child(0).child(0).textContent).toBe("- c");

			const inList = parseMarkdownToVisualDoc(
				"- p\n      h1 | h2\n  | - | - |",
			);
			expect(topLevelTypes(inList)).toEqual(["bullet_list"]);
			const listItem = inList.child(0).child(0);
			expect(topLevelTypes(listItem)).toEqual(["paragraph", "table"]);
			expect(listItem.child(0).textContent).toBe("p");
			expect(listItem.child(1).child(0).child(0).textContent).toBe("h1");
			expect(listItem.child(1).child(0).child(1).textContent).toBe("h2");

			// Setext underline after 4-space header table stays a table body row, never hijacks lheading.
			const withSetextRow = parseMarkdownToVisualDoc(
				"a\n    b | c\n| - | - |\n===",
			);
			expect(topLevelTypes(withSetextRow)).toEqual(["paragraph", "table"]);
			expect(withSetextRow.child(1).childCount).toBe(2);
			expect(withSetextRow.child(1).child(1).child(0).textContent).toBe("===");

			// Setext underline on the header candidate itself beats TableStartParser.
			const setextBeatsTable = parseMarkdownToVisualDoc("a | b\n===\n| - |");
			expect(topLevelTypes(setextBeatsTable)).toEqual(["heading", "paragraph"]);
		});

		it("accepts lazy container continuation header lines before container-prefixed delimiters (Track B F2c)", () => {
			const bqLazy = parseMarkdownToVisualDoc("> a | b\nc\n> | - |");
			expect(topLevelTypes(bqLazy)).toEqual(["blockquote"]);
			expect(topLevelTypes(bqLazy.child(0))).toEqual(["paragraph", "table"]);
			expect(bqLazy.child(0).child(0).textContent).toBe("a | b");
			expect(bqLazy.child(0).child(1).child(0).child(0).textContent).toBe("c");

			const listLazy = parseMarkdownToVisualDoc("- a | b\nc\n  | - |");
			expect(topLevelTypes(listLazy)).toEqual(["bullet_list"]);
			const item = listLazy.child(0).child(0);
			expect(topLevelTypes(item)).toEqual(["paragraph", "table"]);
			expect(item.child(0).textContent).toBe("a | b");
			expect(item.child(1).child(0).child(0).textContent).toBe("c");

			// Lazy header with pipe and lazy body row inside list/blockquote.
			const bqLazyPipe = parseMarkdownToVisualDoc("> a\nb | c\n> | - | - |");
			expect(topLevelTypes(bqLazyPipe.child(0))).toEqual([
				"paragraph",
				"table",
			]);
			expect(bqLazyPipe.child(0).child(1).child(0).childCount).toBe(2);

			const listLazyBody = parseMarkdownToVisualDoc("- a | b\nc\n  | - |\nd");
			const itemWithBody = listLazyBody.child(0).child(0);
			expect(topLevelTypes(itemWithBody)).toEqual(["paragraph", "table"]);
			expect(itemWithBody.child(1).childCount).toBe(2);
			expect(itemWithBody.child(1).child(1).child(0).textContent).toBe("d");

			// Lazy 4-space continuation header starting with `-` inside blockquote.
			const bqLazy4SpDash = parseMarkdownToVisualDoc(
				"> a | b\n    - c\n> | - |",
			);
			expect(topLevelTypes(bqLazy4SpDash.child(0))).toEqual([
				"paragraph",
				"table",
			]);
			expect(bqLazy4SpDash.child(0).child(1).child(0).child(0).textContent).toBe(
				"- c",
			);

			// Lazy DELIMITER line (without container prefix) must NOT form a table.
			const bqLazySep = parseMarkdownToVisualDoc("> a | b\n> c\n| - |");
			expect(topLevelTypes(bqLazySep)).toEqual(["blockquote"]);
			expect(topLevelTypes(bqLazySep.child(0))).toEqual(["paragraph"]);

			const listLazySep = parseMarkdownToVisualDoc("- a | b\n  c\n| - |");
			expect(topLevelTypes(listLazySep.child(0).child(0))).toEqual([
				"paragraph",
			]);

			// Edit round-trip preserves structure cleanly.
			const guard = createMarkdownRoundTripGuard("> a | b\nc\n> | - |");
			expect(guard.serialize(guard.initialDoc)).toBe("> a | b\nc\n> | - |");
			const edited = insertTextAfterFirstMatch(guard.initialDoc, "b", "Z");
			const serialized = guard.serialize(edited);
			expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
		});
	});

	describe("2. Post-math reserved table-alignment marker TBLALIGN (Track B F1)", () => {
		it("emits canonical TBLALIGN for post-display-math markers at top-level and inside containers", () => {
			const topMd =
				'a $$x$$ <!-- easymde-table-align:v1 [[0,"right"]] -->\n| a |\n| - |';
			const topPre = prescanMarkdown(topMd);
			expect(topPre.tableAlignMarkers.size).toBe(1);
			const topGuard = createMarkdownRoundTripGuard(topMd);
			expect(topLevelTypes(topGuard.initialDoc)).toEqual([
				"paragraph",
				"protected_block",
				"table",
			]);
			const topTable = topGuard.initialDoc.child(2);
			expect(topTable.attrs.alignAnnotation).toBe(
				'<!-- easymde-table-align:v1 [[0,"right"]] -->',
			);
			expect(topTable.child(0).child(0).attrs.textAlign).toBe("right");
			expect(topGuard.serialize(topGuard.initialDoc)).toBe(topMd);

			// Editing the leading paragraph must keep the alignment annotation attached to the table.
			const editedPara = insertTextAfterFirstMatch(
				topGuard.initialDoc,
				"a",
				"Z",
			);
			const serPara = topGuard.serialize(editedPara);
			expect(serPara).toContain(
				'<!-- easymde-table-align:v1 [[0,"right"]] -->\n| a |\n| --- |',
			);
			expect(parseMarkdownToVisualDoc(serPara).eq(editedPara)).toBe(true);

			// Blockquote container variant.
			const bqMd =
				'a $$x$$ > <!-- easymde-table-align:v1 [[0,"right"]] -->\n> | a |\n> | - |';
			const bqDoc = parseMarkdownToVisualDoc(bqMd);
			expect(topLevelTypes(bqDoc)).toEqual([
				"paragraph",
				"protected_block",
				"blockquote",
			]);
			const bqTable = bqDoc.child(2).child(0);
			expect(bqTable.type.name).toBe("table");
			expect(bqTable.attrs.alignAnnotation).toBe(
				'<!-- easymde-table-align:v1 [[0,"right"]] -->',
			);
			expect(bqTable.child(0).child(0).attrs.textAlign).toBe("right");

			// List container variant (1 leading space before `-` -> 3-column list content indent).
			const listMd =
				'a $$x$$ - <!-- easymde-table-align:v1 [[0,"right"]] -->\n   | a |\n   | - |';
			const listDoc = parseMarkdownToVisualDoc(listMd);
			expect(topLevelTypes(listDoc)).toEqual([
				"paragraph",
				"protected_block",
				"bullet_list",
			]);
			const listTable = findFirstNodeByType(listDoc, "table");
			expect(listTable).not.toBeNull();
			expect(listTable?.attrs.alignAnnotation).toBe(
				'<!-- easymde-table-align:v1 [[0,"right"]] -->',
			);
			expect(listTable?.child(0).child(0).attrs.textAlign).toBe("right");

			// 4 spaces after display math opens an indented code block, NOT a table alignment marker.
			const indentedMd =
				'a $$x$$    <!-- easymde-table-align:v1 [[0,"right"]] -->\n| a |\n| - |';
			const indentedDoc = parseMarkdownToVisualDoc(indentedMd);
			expect(topLevelTypes(indentedDoc)).toEqual([
				"paragraph",
				"protected_block",
				"code_block",
				"table",
			]);
			expect(indentedDoc.child(3).attrs.alignAnnotation).toBeNull();
		});
	});

	describe("3. Setext vs incomplete refdef priority & Step 8 onlyOnBlockBoundary (Track A #2 + Track B F3)", () => {
		it("lets valid Setext underlines beat incomplete refdef multiline continuations (Track A #2)", () => {
			for (const [md, level, hasMath] of [
				["$$x$$ [r]:\n===\n\n[r]", 1, true],
				["$$x$$ [r]:\n---\n\n[r]", 2, true],
				["$$x$$ [r]:\n-\n\n[r]", 2, true],
				["[r]:\n===\n\n[r]", 1, false],
				["[r]:\n---\n\n[r]", 2, false],
				["[r]:\n-\n\n[r]", 2, false],
				["[r\ns]:\n===\n\n[r s]", 1, false],
			] as const) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual(
					hasMath
						? ["protected_block", "heading", "paragraph"]
						: ["heading", "paragraph"],
				);
				const heading = doc.child(hasMath ? 1 : 0);
				expect(heading.attrs.level, md).toBe(level);
				const refPara = doc.child(hasMath ? 2 : 1);
				expect(refPara.firstChild?.marks.length, md).toBe(0);
			}

			// Edit round-trip on `$$x$$ [r]:\n===\n\n[r]` must NOT emit `[r](===)Z`.
			const guard = createMarkdownRoundTripGuard("$$x$$ [r]:\n===\n\n[r]");
			expect(guard.serialize(guard.initialDoc)).toBe("$$x$$ [r]:\n===\n\n[r]");
			const edited = insertTextAfterFirstMatch(guard.initialDoc, "[r]", "Z");
			const serialized = guard.serialize(edited);
			expect(serialized).not.toContain("(===)");
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(reparsed.eq(edited)).toBe(true);

			// Real multiline refdefs, 4-space `===` destinations, and completed refdefs followed by `===`/`---` stay intact.
			const mathTarget = parseMarkdownToVisualDoc(
				"$$x$$ [r]:\n/target\n\n[r]",
			);
			expect(topLevelTypes(mathTarget)).toEqual([
				"protected_block",
				"protected_block",
				"paragraph",
			]);
			expect(
				mathTarget
					.child(2)
					.firstChild?.marks.find((m) => m.type.name === "link")?.attrs.href,
			).toBe("/target");

			const plainTarget = parseMarkdownToVisualDoc("[r]:\n/target\n\n[r]");
			expect(
				plainTarget
					.child(1)
					.firstChild?.marks.find((m) => m.type.name === "link")?.attrs.href,
			).toBe("/target");

			const indentedEqDest = parseMarkdownToVisualDoc("[r]:\n    ===\n\n[r]");
			expect(
				indentedEqDest
					.child(1)
					.firstChild?.marks.find((m) => m.type.name === "link")?.attrs.href,
			).toBe("===");

			const completedEq = parseMarkdownToVisualDoc("[r]: /target\n===\n\n[r]");
			expect(topLevelTypes(completedEq)).toEqual([
				"protected_block",
				"paragraph",
				"paragraph",
			]);
			expect(completedEq.child(1).textContent).toBe("===");
			expect(
				completedEq
					.child(2)
					.firstChild?.marks.find((m) => m.type.name === "link")?.attrs.href,
			).toBe("/target");

			const completedDash = parseMarkdownToVisualDoc("[r]: /target\n---\n\n[r]");
			expect(topLevelTypes(completedDash)).toEqual([
				"protected_block",
				"horizontal_rule",
				"paragraph",
			]);
			expect(
				completedDash
					.child(2)
					.firstChild?.marks.find((m) => m.type.name === "link")?.attrs.href,
			).toBe("/target");
		});

		it("handles Step 8 onlyOnBlockBoundary leading thematic breaks / Setext, multiline Setext, post-math split-label refdefs, and leading multiline refdefs (Track B F3a–F3d)", () => {
			// F3a: leading thematic breaks and Setext underlines before display math.
			for (const md of ["--- $$x$$", "*** $$x$$", "___ $$x$$"]) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual([
					"horizontal_rule",
					"protected_block",
				]);
			}
			const afterPDash = parseMarkdownToVisualDoc("a\n--- $$x$$");
			expect(topLevelTypes(afterPDash)).toEqual(["heading", "protected_block"]);
			expect(afterPDash.child(0).attrs.level).toBe(2);

			const afterPStar = parseMarkdownToVisualDoc("a\n*** $$x$$");
			expect(topLevelTypes(afterPStar)).toEqual([
				"paragraph",
				"horizontal_rule",
				"protected_block",
			]);

			const afterPEq = parseMarkdownToVisualDoc("a\n=== $$x$$");
			expect(topLevelTypes(afterPEq)).toEqual(["heading", "protected_block"]);
			expect(afterPEq.child(0).attrs.level).toBe(1);

			// 4-space `---` inside an open paragraph is NOT a thematic break or Setext underline.
			const afterPIndentedDash = parseMarkdownToVisualDoc("a\n    --- $$x$$");
			expect(topLevelTypes(afterPIndentedDash)).toEqual(["paragraph"]);

			// F3b: multi-line Setext heading after display math.
			const multiSetextEq = parseMarkdownToVisualDoc("a $$x$$ b\nc\n===");
			expect(topLevelTypes(multiSetextEq)).toEqual([
				"paragraph",
				"protected_block",
				"heading",
			]);
			expect(multiSetextEq.child(2).attrs.level).toBe(1);
			expect(multiSetextEq.child(2).textContent).toBe("b\nc");

			const multiSetextDash = parseMarkdownToVisualDoc("a $$x$$ b\nc\n---");
			expect(topLevelTypes(multiSetextDash)).toEqual([
				"paragraph",
				"protected_block",
				"heading",
			]);
			expect(multiSetextDash.child(2).attrs.level).toBe(2);
			expect(multiSetextDash.child(2).textContent).toBe("b\nc");

			const multiSetextIndentedCont = parseMarkdownToVisualDoc(
				"a $$x$$ b\n    c\n===",
			);
			expect(topLevelTypes(multiSetextIndentedCont)).toEqual([
				"paragraph",
				"protected_block",
				"heading",
			]);

			// Interrupting block stops Setext lookahead cleanly.
			const interruptedSetext = parseMarkdownToVisualDoc("a $$x$$ b\n***\n===");
			expect(topLevelTypes(interruptedSetext)).toEqual([
				"paragraph",
				"horizontal_rule",
				"paragraph",
			]);

			// F3c: post-math split-label refdefs.
			for (const md of [
				"$$x$$ [foo\nbar]: https://example.com\n\n[foo bar]",
				"$$x$$ [foo\nbar\nbaz]: https://example.com\n\n[foo bar baz]",
				"$$x$$ [foo\nbar]:\nhttps://example.com\n\n[foo bar]",
			]) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual([
					"protected_block",
					"protected_block",
					"paragraph",
				]);
				expect(
					doc
						.child(2)
						.firstChild?.marks.find((m) => m.type.name === "link")?.attrs.href,
					md,
				).toBe("https://example.com");
			}

			// Post-math split-label followed by Setext underline turns into heading, NOT refdef.
			const splitLabelSetext = parseMarkdownToVisualDoc(
				"$$x$$ [foo\nbar]:\n===\n\n[foo bar]",
			);
			expect(topLevelTypes(splitLabelSetext)).toEqual([
				"protected_block",
				"heading",
				"paragraph",
			]);
			expect(splitLabelSetext.child(2).firstChild?.marks.length).toBe(0);

			// F3d: leading multi-line refdef continuing from prior lines into maskedBefore.
			for (const [md, expectedHref, expectedTitle] of [
				["[a]:\nhttps://example.com $$x$$\n\n[a]", "https://example.com", null],
				[
					"[a]:\n    https://example.com $$x$$\n\n[a]",
					"https://example.com",
					null,
				],
				[
					"[a]:\n<https://example.com> $$x$$\n\n[a]",
					"https://example.com",
					null,
				],
				[
					"[foo\nbar]: https://example.com $$x$$\n\n[foo bar]",
					"https://example.com",
					null,
				],
				[
					'[a]: https://example.com\n"title" $$x$$\n\n[a]',
					"https://example.com",
					"title",
				],
			] as const) {
				const doc = parseMarkdownToVisualDoc(md);
				expect(topLevelTypes(doc), md).toEqual([
					"protected_block",
					"protected_block",
					"paragraph",
				]);
				const linkMark = doc
					.child(2)
					.firstChild?.marks.find((m) => m.type.name === "link");
				expect(linkMark?.attrs.href, md).toBe(expectedHref);
				if (expectedTitle !== null) {
					expect(linkMark?.attrs.title, md).toBe(expectedTitle);
				}
			}

			// Non-completing leading refdef stays a plain paragraph and does not create a link.
			const invalidLeadingRef = parseMarkdownToVisualDoc(
				"[a]:\nnot a valid url $$x$$\n\n[a]",
			);
			expect(topLevelTypes(invalidLeadingRef)).toEqual([
				"paragraph",
				"paragraph",
			]);
			expect(invalidLeadingRef.child(1).firstChild?.marks.length).toBe(0);

			// Leading refdef followed by `=== $$x$$` turns into Setext heading, NOT refdef.
			const leadingRefSetext = parseMarkdownToVisualDoc(
				"[a]:\n=== $$x$$\n\n[a]",
			);
			expect(topLevelTypes(leadingRefSetext)).toEqual([
				"heading",
				"protected_block",
				"paragraph",
			]);
			expect(leadingRefSetext.child(2).firstChild?.marks.length).toBe(0);

			// O(N) performance guard for repeated display-math lines with Setext/refdef lookaheads.
			const manyDisplayMath = `${"a $$x$$ b\n".repeat(4_000)}===\n`;
			const t0 = performance.now();
			prescanMarkdown(manyDisplayMath);
			expect(performance.now() - t0).toBeLessThan(1_000);

			const manyUnclosedRef = `${"$$x$$ [foo\n".repeat(4_000)}plain`;
			const t1 = performance.now();
			prescanMarkdown(manyUnclosedRef);
			expect(performance.now() - t1).toBeLessThan(1_000);
		});
	});

	describe("4. Cross-line bracket escaping in escapeInlineMarkdownText (Track B F8)", () => {
		it("escapes cross-line links, refdefs, headings, and table cells while keeping plain prose unescaped and O(N)", () => {
			// Multiline paragraph inline link and reference link.
			const linkEscaped = escapeInlineMarkdownText(
				"[click\nhere](https://example.com)",
			);
			expect(linkEscaped).toBe("\\[click\nhere](https://example.com)");
			const linkDoc = parseMarkdownToVisualDoc(linkEscaped);
			expect(topLevelTypes(linkDoc)).toEqual(["paragraph"]);
			expect(linkDoc.child(0).firstChild?.marks.length).toBe(0);
			expect(linkDoc.child(0).textContent).toBe(
				"[click\nhere](https://example.com)",
			);

			const refLinkEscaped = escapeInlineMarkdownText("[click\nhere][ref]");
			expect(refLinkEscaped).toBe("\\[click\nhere][ref]");
			const refLinkDoc = parseMarkdownToVisualDoc(
				`${refLinkEscaped}\n\n[ref]: https://example.com`,
			);
			expect(refLinkDoc.child(0).firstChild?.marks.length).toBe(0);

			// Multiline reference definition at line start (including nested `[` inside label).
			const refDefEscaped = escapeInlineMarkdownText(
				"[foo\nbar]: https://example.com",
				{ atLineStart: true },
			);
			expect(refDefEscaped).toBe("\\[foo\nbar]: https://example.com");
			const refDefDoc = parseMarkdownToVisualDoc(`${refDefEscaped}\n\n[foo bar]`);
			expect(topLevelTypes(refDefDoc)).toEqual(["paragraph", "paragraph"]);
			expect(refDefDoc.child(1).firstChild?.marks.length).toBe(0);

			const nestedRefDefEscaped = escapeInlineMarkdownText(
				"[foo\n[bar\nbaz]: https://example.com",
				{ atLineStart: true },
			);
			expect(nestedRefDefEscaped).toBe(
				"\\[foo\n\\[bar\nbaz]: https://example.com",
			);

			// Heading mode (`\n` -> `" "`) including blank lines collapsed to spaces.
			const headingEscaped = escapeInlineMarkdownText(
				"[click\nhere](https://example.com)",
				{ inHeading: true },
			);
			expect(headingEscaped).toBe("\\[click here](https://example.com)");
			const headingDoc = parseMarkdownToVisualDoc(`# ${headingEscaped}`);
			expect(topLevelTypes(headingDoc)).toEqual(["heading"]);
			expect(headingDoc.child(0).firstChild?.marks.length).toBe(0);

			const headingBlankEscaped = escapeInlineMarkdownText(
				"[click\n\nhere](https://example.com)",
				{ inHeading: true },
			);
			expect(headingBlankEscaped).toBe("\\[click  here](https://example.com)");

			// Table cell mode (`\n` -> `<br>`) including blank lines collapsed to `<br><br>`.
			const cellEscaped = escapeInlineMarkdownText(
				"[click\nhere](https://example.com)",
				{ inTableCell: true },
			);
			expect(cellEscaped).toBe("\\[click<br>here](https://example.com)");
			const cellDoc = parseMarkdownToVisualDoc(`| ${cellEscaped} |\n| --- |`);
			expect(topLevelTypes(cellDoc)).toEqual(["table"]);
			const cellPara = cellDoc.child(0).child(0).child(0).child(0);
			let hasLinkMark = false;
			cellPara.descendants((node) => {
				if (node.marks.some((mark) => mark.type.name === "link")) {
					hasLinkMark = true;
				}
			});
			expect(hasLinkMark).toBe(false);

			const cellBlankEscaped = escapeInlineMarkdownText(
				"[click\n\nhere](https://example.com)",
				{ inTableCell: true },
			);
			expect(cellBlankEscaped).toBe("\\[click<br><br>here](https://example.com)");

			// Blank line breaks paragraph cross-line link matching; plain `[text]` stays unescaped.
			expect(
				escapeInlineMarkdownText("[click\n\nhere](https://example.com)"),
			).toBe("[click\n\nhere](https://example.com)");
			expect(escapeInlineMarkdownText("[plain\ntext]")).toBe("[plain\ntext]");
			expect(escapeInlineMarkdownText("[text]")).toBe("[text]");
			expect(
				serializeVisualDocToMarkdown(
					parseMarkdownToVisualDoc("\\[click\nhere](https://example.com)"),
				),
			).toBe("\\[click\nhere](https://example.com)");

			// Strict O(N) performance on 40,000 `[` (both single-line and multiline).
			const t0 = performance.now();
			const singleBig = escapeInlineMarkdownText("[".repeat(40_000));
			const singleElapsed = performance.now() - t0;
			expect(singleBig.length).toBe(40_000);
			expect(singleElapsed).toBeLessThan(1_000);

			const t1 = performance.now();
			const multiBig = escapeInlineMarkdownText(`${"[\n".repeat(20_000)}](u)`);
			const multiElapsed = performance.now() - t1;
			expect(multiBig.startsWith("\\[\n")).toBe(true);
			expect(multiElapsed).toBeLessThan(1_000);
		});
	});
});
