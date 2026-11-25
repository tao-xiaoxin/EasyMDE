import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { PARAGRAPH_INTERRUPTING_LIST_FIRST_LINE } from "../markdown-list-serialization";
import {
	parseMarkdownToVisualDoc,
	parseMarkdownWithBlockSources,
	prescanMarkdown,
} from "../markdown-parser";
import {
	continuesValidReferenceDefinition,
	startsValidReferenceDefinition,
} from "../markdown-prescanner-display-math";
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

describe("PR-R35-A immersive visual preservation & refdef scanning parity", () => {
	describe("1. Contiguous untouched shared-line projected segments preserve exact source slices (Track A #2)", () => {
		it("preserves multiline refdef title with single/dual display math verbatim when editing an unrelated trailing paragraph", () => {
			for (const md of [
				'[r]: /u\n"a $$x$$\nb"\n\n[r]\n\nz',
				'[r]: /u\n"a $$x$$\nb $$y$$\nc"\n\n[r]\n\nz',
				'\n[r]: /u\n"a $$x$$\nb"\n\n[r]\n\nz\n',
			]) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(md.replace(/\nz(\n?)$/, "\nz!$1"));
				expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
			}
		});

		it("preserves untouched single-line split blocks and container-split lines when editing unrelated blocks", () => {
			for (const [md, expected] of [
				["a $$x$$ b\n\nz", "a $$x$$ b\n\nz!"],
				["a $$x$$ # H\n\nz", "a $$x$$ # H\n\nz!"],
				["> a $$x$$ b\n\nz", "> a $$x$$ b\n\nz!"],
				["a $$x$$ # H1\n\nb $$y$$ # H2\n\nz", "a $$x$$ # H1\n\nb $$y$$ # H2\n\nz!"],
				["a $$x$$ # H1\nb $$y$$ # H2\n\nz", "a $$x$$ # H1\nb $$y$$ # H2\n\nz!"],
			] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(expected);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
			}
		});

		it("re-serializes canonically when a block inside a shared-line group is actually edited", () => {
			{
				const guard = createMarkdownRoundTripGuard("a $$x$$ # H\n\nz");
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "H", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe("a\n\n$$x$$\n\n# H!\n\nz");
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			{
				const guard = createMarkdownRoundTripGuard(
					"a $$x$$ # H1\n\nb $$y$$ # H2\n\nz",
				);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "H2", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe("a $$x$$ # H1\n\nb\n\n$$y$$\n\n# H2!\n\nz");
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			{
				const guard = createMarkdownRoundTripGuard(
					'[r]: /u\n"a $$x$$\nb"\n\n[r]\n\nz',
				);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, '"a', "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'[r]: /u\n\n"a!\n\n$$x$$\n\nb"\n\n[r](/u "a &#10;")\n\nz',
				);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(reparsed.eq(edited)).toBe(true);
				expect(reparsed.child(1).textContent).toBe('"a!');
				expect(
					reparsed
						.child(4)
						.firstChild?.marks.find((m) => m.type.name === "link")?.attrs,
				).toMatchObject({ href: "/u", title: "a \n" });
			}

			{
				const guard = createMarkdownRoundTripGuard(
					'[r]: /u\n"a $$x$$\nb"\n\n[r]\n\nz',
				);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, 'b"', "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'[r]: /u\n\n"a\n\n$$x$$\n\nb"!\n\n[r](/u "a &#10;")\n\nz',
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}
		});

		it("records sharedGroup metadata with exact monotonic leading/trailing preservation", () => {
			const parsed = parseMarkdownWithBlockSources(
				'[r]: /u\n"a $$x$$\nb"\n\n[r]\n\nz\n',
			);
			expect(parsed.blocks[1]?.sharedGroup).toBeDefined();
			expect(parsed.blocks[1]?.sharedGroup).toBe(parsed.blocks[2]?.sharedGroup);
			expect(parsed.blocks[1]?.sharedGroup?.raw).toBe('"a $$x$$');
			expect(parsed.blocks[1]?.sharedGroup?.separatorBefore).toBe("\n");
			expect(parsed.blocks[3]?.separatorBefore).toBe("\n");
			expect(parsed.trailingSuffix).toBe("\n");
		});
	});

	describe("2. Guard reusedIndentedBlockAfterBlank when in-place-edited list ends in a non-lazy block (Track B Finding 3)", () => {
		it("dedents opening line of untouched 4-column math after editing a list item to heading, code block, HR, table, or empty", () => {
			const headingBody = [
				visualEditorSchema.nodes.paragraph.create(),
				visualEditorSchema.nodes.heading.create(
					{ level: 1 },
					visualEditorSchema.text("a"),
				),
			];

			// 1. `"100. a\n    $$x$$"` -> edit `"a"` to `# a`
			{
				const guard = createMarkdownRoundTripGuard("100. a\n    $$x$$");
				expect(topLevelTypes(guard.initialDoc)).toEqual([
					"ordered_list",
					"protected_block",
				]);
				const edited = replaceLastListItemBody(guard.initialDoc, headingBody);
				const serialized = guard.serialize(edited);
				expect(serialized).toBe("100.\n     # a\n$$x$$");
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(topLevelTypes(reparsed)).toEqual([
					"ordered_list",
					"protected_block",
				]);
				expect(reparsed.child(1).attrs.kind).toBe("math");
				expect(findFirstNodeByType(reparsed, "code_block")).toBeNull();
			}

			// 2. `"100. first\n101. second\n    $$x$$"` -> edit `"second"` to heading / code_block / hr / table / empty
			const multiItemCases: ReadonlyArray<readonly [string, ProseMirrorNode[]]> =
				[
					[
						"heading",
						[
							visualEditorSchema.nodes.paragraph.create(),
							visualEditorSchema.nodes.heading.create(
								{ level: 1 },
								visualEditorSchema.text("second"),
							),
						],
					],
					[
						"code_block",
						[
							visualEditorSchema.nodes.paragraph.create(),
							visualEditorSchema.nodes.code_block.create(
								{ fenceChar: "`", fenceLength: 3, info: "", language: "" },
								visualEditorSchema.text("code"),
							),
						],
					],
					[
						"horizontal_rule",
						[
							visualEditorSchema.nodes.paragraph.create(),
							visualEditorSchema.nodes.horizontal_rule.create(),
						],
					],
					[
						"table",
						[
							visualEditorSchema.nodes.paragraph.create(),
							visualEditorSchema.nodes.table.create(
								{ alignAnnotation: null, columnAlignments: [null, null] },
								[
									visualEditorSchema.nodes.table_row.create(null, [
										visualEditorSchema.nodes.table_header.create(
											null,
											visualEditorSchema.nodes.paragraph.create(
												null,
												visualEditorSchema.text("h1"),
											),
										),
										visualEditorSchema.nodes.table_header.create(
											null,
											visualEditorSchema.nodes.paragraph.create(
												null,
												visualEditorSchema.text("h2"),
											),
										),
									]),
								],
							),
						],
					],
					["empty_paragraph", [visualEditorSchema.nodes.paragraph.create()]],
				];

			for (const [label, replacement] of multiItemCases) {
				const guard = createMarkdownRoundTripGuard(
					"100. first\n101. second\n    $$x$$",
				);
				const edited = replaceLastListItemBody(guard.initialDoc, replacement);
				const serialized = guard.serialize(edited);
				expect(serialized, label).toMatch(/^100\. first\n/);
				expect(serialized, label).toMatch(/\n\$\$x\$\$$/);
				expect(serialized, label).not.toContain("\n    $$x$$");
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(topLevelTypes(reparsed), label).toEqual([
					"ordered_list",
					"protected_block",
				]);
				expect(reparsed.child(1).attrs.kind, label).toBe("math");
			}
		});

		it("dedents only the opening line of multi-line 4-column/tab display math after an edited non-lazy list item", () => {
			const headingBody = [
				visualEditorSchema.nodes.paragraph.create(),
				visualEditorSchema.nodes.heading.create(
					{ level: 1 },
					visualEditorSchema.text("a"),
				),
			];
			for (const [md, expectedTail] of [
				["100. a\n    $$\n    x\n    y\n    $$", "\n$$\n    x\n    y\n    $$"],
				["100. a\n\t$$\n\tx\n\t  y\n\t$$", "\n$$\n\tx\n\t  y\n\t$$"],
			] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = replaceLastListItemBody(guard.initialDoc, headingBody);
				const serialized = guard.serialize(edited);
				expect(serialized.endsWith(expectedTail), md).toBe(true);
				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(topLevelTypes(reparsed), md).toEqual([
					"ordered_list",
					"protected_block",
				]);
				expect(reparsed.child(1).attrs.kind, md).toBe("math");
				expect(findFirstNodeByType(reparsed, "code_block"), md).toBeNull();
			}
		});

		it("keeps untouched list + 4-column math verbatim when editing an unrelated block, and keeps lazy list table lines PHP-exact", () => {
			const untouchedGuard = createMarkdownRoundTripGuard(
				"100. a\n    $$x$$\n\nz",
			);
			const editedZ = insertTextAfterFirstMatch(
				untouchedGuard.initialDoc,
				"z",
				"!",
			);
			expect(untouchedGuard.serialize(editedZ)).toBe("100. a\n    $$x$$\n\nz!");

			// Per real PHP `MarkdownRenderer::render()`, `"100. a\n    | h1 | h2 |\n| - | - |"`
			// is a single ordered-list item paragraph (lazy continuation inside `100.`).
			const tableLazyGuard = createMarkdownRoundTripGuard(
				"100. a\n    | h1 | h2 |\n| - | - |",
			);
			expect(topLevelTypes(tableLazyGuard.initialDoc)).toEqual(["ordered_list"]);
			expect(findFirstNodeByType(tableLazyGuard.initialDoc, "table")).toBeNull();
			const editedLazy = insertTextAfterFirstMatch(
				tableLazyGuard.initialDoc,
				"a",
				"!",
			);
			const serializedLazy = tableLazyGuard.serialize(editedLazy);
			expect(parseMarkdownToVisualDoc(serializedLazy).eq(editedLazy)).toBe(true);
		});
	});

	describe("3. Memoize label state in scanRefDefContinuation (Track B Finding 4)", () => {
		it("eliminates quadratic blowup on 464 KB repeated multiline label display-math input", () => {
			const blowup = `[a $$x$$\n${"a$$y$$\n".repeat(330)}\n`.repeat(200);
			expect(blowup.length).toBe(464_000);
			// Warm up once on a tiny sample so JIT compilation noise does not skew measurement.
			prescanMarkdown("[a $$x$$\na$$y$$\n");
			const start = performance.now();
			const result = prescanMarkdown(blowup);
			const elapsed = performance.now() - start;
			expect(result.protectedBlocks.size).toBe(0);
			expect(result.protectedInlines.size).toBe(66_200);
			expect(elapsed).toBeLessThanOrEqual(2_500);
		});

		it("preserves exact label continuation semantics across whitespace-only, non-whitespace, and 999-code-point boundaries", () => {
			// `[a $$x$$\nb]: /u` and `[   \n$$x$$\n]: /u` split `$$x$$` so markdown-it
			// never fabricates a bogus refdef from the inline-masked token.
			for (const md of [
				"[a $$x$$\nb]: /u\n\n[a $$x$$\nb]",
				"[   \n$$x$$\n]: /u",
				"[a\n$$x$$\n]: /u",
			]) {
				const doc = parseMarkdownToVisualDoc(md);
				const mathBlock = findFirstNodeByType(doc, "protected_block");
				expect(mathBlock?.attrs.kind, md).toBe("math");
			}

			// Exact 999 vs 1000 code-point boundary on inline-masked display math:
			// `498 + 1 ("M") + 1 ("\n") + 499 = 999` splits; `499 + 1 + 1 + 499 = 1000` stays inline.
			const at999 = `[${"a".repeat(498)}$$x$$\n${"b".repeat(499)}]: /u`;
			const doc999 = parseMarkdownToVisualDoc(at999);
			expect(findFirstNodeByType(doc999, "protected_block")?.attrs.kind).toBe(
				"math",
			);

			const at1000 = `[${"a".repeat(499)}$$x$$\n${"b".repeat(499)}]: /u`;
			const doc1000 = parseMarkdownToVisualDoc(at1000);
			expect(topLevelTypes(doc1000)).toEqual(["paragraph"]);
			expect(findFirstNodeByType(doc1000, "protected_block")).toBeNull();

			// Direct memo-key isolation check on the same `(mathIndex, lines)`:
			// whitespace-only fails (`hasNonWhitespace=false`) while non-whitespace
			// succeeds (`hasNonWhitespace=true`) on the exact same continuation line.
			const wsDoc = "   ]: /u";
			const wsLines = wsDoc.split("\n");
			const wsIndex = createPhpDocumentMathIndex(wsDoc, wsLines);
			expect(
				startsValidReferenceDefinition("[   ", wsLines, wsIndex, 0, 0, false),
			).toBe(false);
			expect(
				startsValidReferenceDefinition("[a", wsLines, wsIndex, 0, 0, false),
			).toBe(true);

			// Budget isolation on the same `(mathIndex, lines)`: a probe entering
			// line 0 that exceeds 999 total cp must NOT poison memo for a later probe
			// entering line 1 with a smaller initial code-point count.
			const longDoc = `${"a".repeat(400)}\n${"b".repeat(400)}\nend]: /u`;
			const longLines = longDoc.split("\n");
			const longIndex = createPhpDocumentMathIndex(longDoc, longLines);
			expect(
				continuesValidReferenceDefinition(
					{
						labelBuffer: "",
						labelCodePoints: 300,
						labelHasNonWhitespace: true,
						referenceValid: false,
						state: "label",
						titleDelimiter: null,
					},
					"x",
					longLines,
					longIndex,
					0,
					false,
				),
			).toBe(false);
			expect(
				continuesValidReferenceDefinition(
					{
						labelBuffer: "",
						labelCodePoints: 10,
						labelHasNonWhitespace: true,
						referenceValid: false,
						state: "label",
						titleDelimiter: null,
					},
					"x",
					longLines,
					longIndex,
					1,
					false,
				),
			).toBe(true);
		});
	});

	describe("4. Deduplicated PARAGRAPH_INTERRUPTING_LIST_FIRST_LINE export (Track B Finding 6b)", () => {
		it("exports the shared CommonMark §5.3 interrupting-list first-line regex", () => {
			for (const line of ["- item", "* item", "+ item", "1. item", "1) item"]) {
				expect(PARAGRAPH_INTERRUPTING_LIST_FIRST_LINE.test(line), line).toBe(
					true,
				);
			}
			for (const line of ["2. item", "01. item", "- ", "1. ", "plain"]) {
				expect(PARAGRAPH_INTERRUPTING_LIST_FIRST_LINE.test(line), line).toBe(
					false,
				);
			}
		});
	});
});
