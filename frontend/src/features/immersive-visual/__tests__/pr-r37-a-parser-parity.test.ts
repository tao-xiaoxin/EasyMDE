import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { normalizeReferenceLabel } from "../markdown-escape";
import { parseMarkdownToVisualDoc } from "../markdown-parser";
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

function deleteLastListItem(doc: ProseMirrorNode): ProseMirrorNode {
	const list = doc.child(0);
	const items: ProseMirrorNode[] = [];
	for (let i = 0; i < list.childCount - 1; i += 1) {
		items.push(list.child(i));
	}
	const nextList = list.type.create(list.attrs, items);
	const rest: ProseMirrorNode[] = [];
	for (let i = 1; i < doc.childCount; i += 1) {
		rest.push(doc.child(i));
	}
	return doc.type.create(null, [nextList, ...rest]);
}

function updateFirstImageAttrs(
	doc: ProseMirrorNode,
	patch: Readonly<Record<string, unknown>>,
): ProseMirrorNode {
	let targetPos = -1;
	let targetNode: ProseMirrorNode | null = null;
	doc.descendants((node, pos) => {
		if (targetPos >= 0) return false;
		if (node.type.name === "image") {
			targetPos = pos;
			targetNode = node;
			return false;
		}
		return true;
	});
	expect(targetPos, "Could not find image node in doc").toBeGreaterThanOrEqual(
		0,
	);
	const state = EditorState.create({ doc });
	const node = targetNode as unknown as ProseMirrorNode;
	return state.apply(
		state.tr.setNodeMarkup(targetPos, undefined, { ...node.attrs, ...patch }),
	).doc;
}

describe("PR-R37-A reference preservation, list-swallow guards, and dedup", () => {
	describe("1. Table-cell partial-title reference links with escaped-pipe labels (Track B Finding 1)", () => {
		it("preserves escaped-pipe ref labels and avoids false shortcut collapse in table cells", () => {
			// Full ref link `[click][a\\|b]` keeps double-escaped pipe for PHP TableParser::split()
			{
				const md =
					'[a\\|b]: /u\n"t $$x$$\ne"\n\n| [click][a\\\\|b] | z |\n| --- | --- |';
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'[a\\|b]: /u\n"t $$x$$\ne"\n\n| [click][a\\\\|b] | z! |\n| --- | --- |',
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			// Shortcut `[a\\|b]` referencing `[a\|b]: /u` upgrades to `[a\|b][a\\|b]`
			{
				const md =
					'[a\\|b]: /u\n"t $$x$$\ne"\n\n| [a\\\\|b] | z |\n| --- | --- |';
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'[a\\|b]: /u\n"t $$x$$\ne"\n\n| [a\\|b][a\\\\|b] | z! |\n| --- | --- |',
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			// Positive control: `[a|b]: /u` stays clean shortcut `[a\|b]` (not bloated `[a\|b][a\|b]`)
			{
				const md =
					'[a|b]: /u\n"t $$x$$\ne"\n\n| [a\\|b] | z |\n| --- | --- |';
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'[a|b]: /u\n"t $$x$$\ne"\n\n| [a\\|b] | z! |\n| --- | --- |',
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			// Table-cell reference image with escaped-pipe label
			{
				const md =
					'[a\\|b]: /img.png\n"t $$x$$\ne"\n\n| ![a\\\\|b] | z |\n| --- | --- |';
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'[a\\|b]: /img.png\n"t $$x$$\ne"\n\n| ![a\\|b][a\\\\|b] | z! |\n| --- | --- |',
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}
		});
	});

	describe("2. Multiline reference labels containing literal '\\(' across containers and Setext headings (Track B Finding 2)", () => {
		it("normalizes multiline ref labels unconditionally without breaking blockquotes, lists, or headings", () => {
			// Blockquote
			{
				const md =
					'> \\(m\nn\\)\n>\n> [click][a \\(x\n> 2. b]\n> q\n\n[a \\(x 2. b]: /u\n"t $$z$$\ne"';
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "q", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'> \\(m\nn\\)\n>\n> [click][a \\(x 2. b]\n> q!\n\n[a \\(x 2. b]: /u\n"t $$z$$\ne"',
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			// List
			{
				const md =
					'- \\(m\nn\\)\n\n  [click][a \\(x\n  2. b]\n  q\n\n[a \\(x 2. b]: /u\n"t $$z$$\ne"';
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "q", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'- \\(m\nn\\)\n\n  [click][a \\(x 2. b]\n  q!\n\n[a \\(x 2. b]: /u\n"t $$z$$\ne"',
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			// Setext heading
			{
				const md =
					'[click][a \\(x\nb] q\n===\n\n[a \\(x b]: /u\n"t $$z$$\ne"';
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "q", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'# [click][a \\(x b] q!\n\n[a \\(x b]: /u\n"t $$z$$\ne"',
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}
		});
	});

	describe("3. Prevent adjacent same-href reference and inline links from merging (Track A #1)", () => {
		it("preserves boundary between adjacent reference and inline or sibling reference links sharing /u", () => {
			for (const md of [
				'[r]: /u\n"a\n\n[r][][s](/u)\nz',
				'[r]: /u\n"a\n\n[s](/u)[r][]\nz',
				'[r]: /u\n"a\n\n[r][][r][]\nz',
				'[r]: /u\n"a\n\n[s]: /u\n"b\n\n[r][][s][]\nz',
				'[r]: /u\n"a\n\n[**r**][][s](/u)\nz',
				'[r]: /u\n"a\n\n[**a** b][r][s](/u)\nz',
				'[r]: /u\n"a\n\n**[r][][s](/u)**\nz',
			]) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(`${md}!`);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
			}
		});

		it("preserves adjacent link boundary on rebound liveDoc and falls back cleanly when refdef is deleted", () => {
			const md = '[r]: /u\n"a\n\n[r][][s](/u)\nz';

			// Rebound liveDoc preserves `[r][][s](/u)`
			{
				const liveDoc = parseMarkdownToVisualDoc(md);
				const guard = createMarkdownRoundTripGuard(md, undefined, liveDoc);
				const edited = insertTextAfterFirstMatch(liveDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(`${md}!`);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			// Deleting `[r]: /u` falls back cleanly to inline syntax with `eq === true`
			{
				const guard = createMarkdownRoundTripGuard(md);
				const editedZ = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const withoutRefDef = editedZ.type.create(null, [
					editedZ.child(1),
					editedZ.child(2),
				]);
				const serialized = guard.serialize(withoutRefDef);
				expect(serialized).toContain("[rs](/u)\nz!");
				expect(parseMarkdownToVisualDoc(serialized).eq(withoutRefDef)).toBe(
					true,
				);
			}
		});
	});

	describe("4. Preserve partial-title reference syntax in blockquotes, reference images, and same-list items (Track A #2 + Track B Finding 5)", () => {
		it("preserves blockquote-nested and nested-blockquote refdefs without inserting blank '>' lines", () => {
			for (const md of [
				'> [r]: /u\n> "a\n>\n> [r]\n> z',
				'> > [r]: /u\n> > "a\n> >\n> > [r]\n> > z',
			]) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(`${md}!`);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);

				// Rebound liveDoc also preserves blockquote-nested refdef
				const liveDoc = parseMarkdownToVisualDoc(md);
				const reboundGuard = createMarkdownRoundTripGuard(
					md,
					undefined,
					liveDoc,
				);
				const reboundEdited = insertTextAfterFirstMatch(liveDoc, "z", "!");
				expect(reboundGuard.serialize(reboundEdited), md).toBe(`${md}!`);
			}

			// Math-split blockquote partial title keeps `> [r]: /u\n> "a` tight (no blank `>`) and preserves `[r]`
			{
				const md = '> [r]: /u\n> "a $$x$$\n> b"\n>\n> [r]\n> z';
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized).toBe(
					'> [r]: /u\n> "a\n\n$$x$$\n\n> b"\n>\n> [r]\n> z!',
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			// Negative control: deleting `> [r]: /u` inside blockquote falls back to `[r](/u)`
			{
				const md = '> [r]: /u\n> "a\n>\n> [r]\n> z';
				const guard = createMarkdownRoundTripGuard(md);
				const editedZ = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const bq = editedZ.child(0);
				const withoutRefDef = editedZ.type.create(null, [
					bq.type.create(null, [bq.child(1), bq.child(2)]),
				]);
				const serialized = guard.serialize(withoutRefDef);
				expect(serialized).toContain("> [r](/u)\n> z!");
				expect(parseMarkdownToVisualDoc(serialized).eq(withoutRefDef)).toBe(
					true,
				);
			}
		});

		it("preserves partial-title reference images and falls back cleanly on image edits or hijack risks", () => {
			for (const md of [
				'[r]: /img.png\n"caption {width=50%}" bar\n\n![r]\nz',
				'[r]: /img.png\n"a $$x$$\nb"\n\n![r]\nz',
				'[r]: /img.png\n"a $$x$$\nb"\n\n![r][] and ![custom alt][r]\nz',
			]) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(`${md}!`);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);

				// Rebound liveDoc preserves reference image syntax
				const liveDoc = parseMarkdownToVisualDoc(md);
				const reboundGuard = createMarkdownRoundTripGuard(
					md,
					undefined,
					liveDoc,
				);
				const reboundEdited = insertTextAfterFirstMatch(liveDoc, "z", "!");
				expect(reboundGuard.serialize(reboundEdited), md).toBe(`${md}!`);
			}

			// Shortcut hijack protection on reference images
			const imgBase = '[r]: /img.png\n"a $$x$$\nb"\n\n![r]\nz';
			for (const tail of ["(foo)", "[bar]", ": /other"]) {
				const guard = createMarkdownRoundTripGuard(imgBase);
				const edited = replaceTextMatch(guard.initialDoc, "\nz", tail);
				const serialized = guard.serialize(edited);
				expect(serialized, tail).toContain(`![r][]${tail}`);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited), tail).toBe(
					true,
				);
			}

			// Editing src, title, or scale falls back cleanly to inline image syntax
			for (const patch of [
				{ src: "/other.png" },
				{ title: "updated caption" },
				{ scale: 50 },
			]) {
				const guard = createMarkdownRoundTripGuard(imgBase);
				const edited = updateFirstImageAttrs(guard.initialDoc, patch);
				const serialized = guard.serialize(edited);
				expect(serialized, JSON.stringify(patch)).toContain("![r](");
				expect(
					parseMarkdownToVisualDoc(serialized).eq(edited),
					JSON.stringify(patch),
				).toBe(true);
			}
		});

		it("preserves partial-title refdef in an untouched item of the same top-level list and guards shadowing", () => {
			const md = '- [r]: /u\n  "a\n- [r]\n  z';
			const guard = createMarkdownRoundTripGuard(md);
			const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "!");
			const serialized = guard.serialize(edited);
			expect(serialized).toBe('- [r]: /u\n  "a\n- [r]\n  z!');
			expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);

			// Rebound liveDoc also preserves same-list refdef
			const liveDoc = parseMarkdownToVisualDoc(md);
			const reboundGuard = createMarkdownRoundTripGuard(md, undefined, liveDoc);
			const reboundEdited = insertTextAfterFirstMatch(liveDoc, "z", "!");
			expect(reboundGuard.serialize(reboundEdited)).toBe(
				'- [r]: /u\n  "a\n- [r]\n  z!',
			);

			// Deleting the item that defined `[r]: /u` falls back to inline `[r](/u)`
			{
				const list = edited.child(0);
				const withoutFirstItem = edited.type.create(null, [
					list.type.create(list.attrs, [list.child(1)]),
				]);
				const withoutRefSerialized = guard.serialize(withoutFirstItem);
				expect(withoutRefSerialized).toBe("- [r](/u)\n  z!");
				expect(
					parseMarkdownToVisualDoc(withoutRefSerialized).eq(withoutFirstItem),
				).toBe(true);
			}

			// Inserting an earlier item redefining `[r]: /other` shadows original `[r]` -> falls back to `[r](/u)`
			{
				const list = edited.child(0);
				const shadowItem = visualEditorSchema.nodes.list_item.create(null, [
					visualEditorSchema.nodes.paragraph.create(),
					visualEditorSchema.nodes.protected_block.create({
						kind: "raw",
						rawMarkdown: "[r]: /other",
					}),
				]);
				const shadowed = edited.type.create(null, [
					list.type.create(list.attrs, [
						shadowItem,
						list.child(0),
						list.child(1),
					]),
				]);
				const shadowedSerialized = guard.serialize(shadowed);
				expect(shadowedSerialized).toContain("- [r](/u)\n  z!");
				expect(
					parseMarkdownToVisualDoc(shadowedSerialized).eq(shadowed),
				).toBe(true);
			}
		});
	});

	describe("5. Guard resolveJoin and list-swallow risk when editing or shrinking a top-level list (Track B Finding 3)", () => {
		const helloParagraph = [
			visualEditorSchema.nodes.paragraph.create(
				null,
				visualEditorSchema.text("hello"),
			),
		];
		const h2Heading = [
			visualEditorSchema.nodes.paragraph.create(),
			visualEditorSchema.nodes.heading.create(
				{ level: 1 },
				visualEditorSchema.text("h2"),
			),
		];

		it("prevents following indented top-level blocks from being swallowed after editing or deleting item 2", () => {
			const suffixes = [
				["  # ATX", "heading"],
				["  > quote", "blockquote"],
				["  ---", "horizontal_rule"],
				["  ```\n  code\n  ```", "code_block"],
				["  <div>hi</div>", "protected_block"],
				["  + sub", "bullet_list"],
			] as const;

			for (const [suffix, expectedType] of suffixes) {
				const md = `- a\n-   # h\n${suffix}`;
				const guard = createMarkdownRoundTripGuard(md);
				expect(topLevelTypes(guard.initialDoc), md).toEqual([
					"bullet_list",
					expectedType,
				]);

				for (const edited of [
					replaceLastListItemBody(guard.initialDoc, helloParagraph),
					replaceLastListItemBody(guard.initialDoc, h2Heading),
					deleteLastListItem(guard.initialDoc),
				]) {
					const serialized = guard.serialize(edited);
					expect(serialized, md).toContain("\n\n");
					const reparsed = parseMarkdownToVisualDoc(serialized);
					expect(reparsed.childCount, `${md} => ${serialized}`).toBe(2);
					expect(topLevelTypes(reparsed), `${md} => ${serialized}`).toEqual([
						"bullet_list",
						expectedType,
					]);
					expect(reparsed.eq(edited), `${md} => ${serialized}`).toBe(true);
				}
			}
		});

		it("prevents following 3-space indented block from being swallowed when ordered list shrinks from 10. to 9.", () => {
			const md =
				"1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. # h\n   # ATX";
			const guard = createMarkdownRoundTripGuard(md);
			expect(topLevelTypes(guard.initialDoc)).toEqual([
				"ordered_list",
				"heading",
			]);
			const edited = deleteLastListItem(guard.initialDoc);
			const serialized = guard.serialize(edited);
			expect(serialized).toBe(
				"1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n\n# ATX",
			);
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(reparsed.childCount).toBe(2);
			expect(topLevelTypes(reparsed)).toEqual(["ordered_list", "heading"]);
			expect(reparsed.eq(edited)).toBe(true);
		});
	});

	describe("6. Deduplicated normalizeReferenceLabel export (Track B Finding 6)", () => {
		it("normalizes whitespace and Unicode case folding consistently", () => {
			expect(normalizeReferenceLabel("  Foo \n\t Bar  ")).toBe("FOO BAR");
			expect(normalizeReferenceLabel("a\\|b")).toBe("A\\|B");
		});
	});
});
