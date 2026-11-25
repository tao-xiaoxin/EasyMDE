import {
	DOMParser,
	DOMSerializer,
	type Node as ProseMirrorNode,
} from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
	parseMarkdownToVisualDoc,
	parseMarkdownWithBlockSources,
} from "../markdown-parser";
import { dedentBlockToLineZero } from "../markdown-reference-preservation";
import { createMarkdownRoundTripGuard } from "../markdown-serializer";
import { visualEditorSchema } from "../visual-schema";

// Every expected serialization / link title below was verified against real PHP
// `EasyMDE\Content\MarkdownRenderer::render()`.

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

function replaceFirstTextMatch(
	doc: ProseMirrorNode,
	needle: string,
	replacement: string,
): ProseMirrorNode {
	const { from, to } = findTextRange(doc, needle);
	const state = EditorState.create({ doc, schema: visualEditorSchema });
	return state.apply(state.tr.insertText(replacement, from, to)).doc;
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

function collectLinkSegments(doc: ProseMirrorNode): Array<
	Readonly<{
		boundaryKey: unknown;
		href: unknown;
		strong: boolean;
		text: string;
		title: unknown;
	}>
> {
	const out: Array<
		Readonly<{
			boundaryKey: unknown;
			href: unknown;
			strong: boolean;
			text: string;
			title: unknown;
		}>
	> = [];
	doc.descendants((node) => {
		if (!node.isText || !node.text) return;
		const link = node.marks.find((m) => m.type.name === "link");
		if (link) {
			out.push({
				boundaryKey: link.attrs.boundaryKey,
				href: link.attrs.href,
				strong: node.marks.some((m) => m.type.name === "strong"),
				text: node.text,
				title: link.attrs.title,
			});
		}
	});
	return out;
}

describe("PR-R39-A link boundaries, strict partial-title follower preservation, mathNewlineToken dedent, and O(N) sharedGroup unification", () => {
	describe("1. Prevent ProseMirror from merging distinct adjacent links with identical (href, title) (Track A #1)", () => {
		it('preserves both link boundary and reference syntax when typing inside [rr][r][ss](/u "a&#10;")', () => {
			const md = '[r]: /u\n"a\n\n[rr][r][ss](/u "a&#10;")';
			for (const useLiveDoc of [false, true]) {
				const liveDoc = useLiveDoc ? parseMarkdownToVisualDoc(md) : undefined;
				const guard = createMarkdownRoundTripGuard(md, undefined, liveDoc);

				expect(collectLinkSegments(guard.initialDoc)).toEqual([
					{
						boundaryKey: null,
						href: "/u",
						strong: false,
						text: "rr",
						title: "a\n",
					},
					{
						boundaryKey: "1",
						href: "/u",
						strong: false,
						text: "ss",
						title: "a\n",
					},
				]);

				const edited = insertTextAtOffsetInMatch(
					guard.initialDoc,
					"rr",
					1,
					"X",
				);
				const serialized = guard.serialize(edited);
				expect(serialized, `liveDoc=${String(useLiveDoc)}`).toBe(
					'[r]: /u\n"a\n\n[rXr][r][ss](/u "a&#10;")',
				);

				const reparsed = parseMarkdownToVisualDoc(serialized);
				expect(reparsed.eq(edited), `liveDoc=${String(useLiveDoc)}`).toBe(true);
				expect(collectLinkSegments(reparsed)).toEqual([
					{
						boundaryKey: null,
						href: "/u",
						strong: false,
						text: "rXr",
						title: "a\n",
					},
					{
						boundaryKey: "1",
						href: "/u",
						strong: false,
						text: "ss",
						title: "a\n",
					},
				]);
			}
		});

		it("keeps adjacent inline links with identical (href, title) distinct across typing, bolding, and deleting intervening spaces", () => {
			// Adjacent inline links `[aa](/u)[bb](/u)` — typing inside `aa` keeps two links
			{
				const md = "[aa](/u)[bb](/u)";
				const guard = createMarkdownRoundTripGuard(md);
				const typed = insertTextAtOffsetInMatch(guard.initialDoc, "aa", 1, "X");
				const typedMd = guard.serialize(typed);
				expect(typedMd).toBe("[aXa](/u)[bb](/u)");
				expect(parseMarkdownToVisualDoc(typedMd).eq(typed)).toBe(true);

				// Inserting at the exclusive boundary after `aa` inserts plain text between them
				const between = insertTextAfterFirstMatch(guard.initialDoc, "aa", "X");
				const betweenMd = guard.serialize(between);
				expect(betweenMd).toBe("[aa](/u)X[bb](/u)");
				expect(parseMarkdownToVisualDoc(betweenMd).eq(between)).toBe(true);

				const bolded = addStrongToFirstTextMatch(guard.initialDoc, "bb");
				const boldedMd = guard.serialize(bolded);
				expect(boldedMd).toBe("[aa](/u)[**bb**](/u)");
				expect(parseMarkdownToVisualDoc(boldedMd).eq(bolded)).toBe(true);
			}

			// Deleting the space between `[a](/u "t") [b](/u "t")` must not merge them
			{
				const md = '[a](/u "t") [b](/u "t")';
				const guard = createMarkdownRoundTripGuard(md);
				const joined = deleteFirstTextMatch(guard.initialDoc, " ");
				const joinedMd = guard.serialize(joined);
				expect(joinedMd).toBe('[a](/u "t")[b](/u "t")');
				expect(parseMarkdownToVisualDoc(joinedMd).eq(joined)).toBe(true);
			}
		});

		it("never emits boundaryKey in DOM output and ignores untrusted DOM attributes on parseDOM", () => {
			const doc = parseMarkdownToVisualDoc('[a](/u "t")[b](/u "t")');
			const serializer = DOMSerializer.fromSchema(visualEditorSchema);
			const fragment = serializer.serializeFragment(doc.content);
			const host = document.createElement("div");
			host.appendChild(fragment);
			const anchors = Array.from(host.querySelectorAll("a"));
			expect(anchors).toHaveLength(2);
			for (const anchor of anchors) {
				expect(anchor.getAttributeNames().sort()).toEqual(["href", "title"]);
				expect(anchor.outerHTML).not.toContain("boundaryKey");
			}

			// Untrusted HTML with custom attributes always parses with boundaryKey: null
			const pasted = document.createElement("div");
			pasted.innerHTML =
				'<p><a href="/u" title="t" boundarykey="evil" data-boundary-key="evil">pasted</a></p>';
			const parsedDomDoc =
				DOMParser.fromSchema(visualEditorSchema).parse(pasted);
			expect(collectLinkSegments(parsedDomDoc)).toEqual([
				{
					boundaryKey: null,
					href: "/u",
					strong: false,
					text: "pasted",
					title: "t",
				},
			]);

			// Removing link mark by MarkType still unlinks marks carrying boundaryKey !== null
			const { from, to } = findTextRange(doc, "b");
			const state = EditorState.create({ doc, schema: visualEditorSchema });
			const unlinked = state.apply(
				state.tr.removeMark(from, to, visualEditorSchema.marks.link),
			).doc;
			expect(collectLinkSegments(unlinked)).toEqual([
				{
					boundaryKey: null,
					href: "/u",
					strong: false,
					text: "a",
					title: "t",
				},
			]);
		});
	});

	describe("2. Strict partial-title follower preservation across Setext headings, tables, lists, and paragraphs (Track A #2 + Track B #2)", () => {
		it("fixes all 5 confirmed reproductions without dropping or mutating untouched reference link titles", () => {
			const cases: ReadonlyArray<
				Readonly<{
					edit: (doc: ProseMirrorNode) => ProseMirrorNode;
					expected: string;
					expectedTitle: string;
					md: string;
					name: string;
				}>
			> = [
				{
					edit: (doc) =>
						replaceFirstTextMatch(doc, '"Setext title', '"Edited title'),
					expected:
						'[a]: /url\n\n# "Edited title\n\n[a](/url "Setext title&#10;")',
					expectedTitle: "Setext title\n",
					md: '[a]: /url\n"Setext title\n===\n\n[a]',
					name: "1. edited top-level Setext heading",
				},
				{
					edit: (doc) => insertTextAfterFirstMatch(doc, '"a', "X"),
					expected: '[r]: /u\n\n# "aX\n\n[r](/u "a&#10;")',
					expectedTitle: "a\n",
					md: '[r]: /u\n"a\n=\n\n[r]',
					name: "2. edited short Setext heading",
				},
				{
					edit: (doc) => replaceFirstTextMatch(doc, "c1", "c1 edited"),
					expected:
						'[a]: /url\n\n| "h1 | h2 |\n| --- | --- |\n| c1 edited | c2 |\n\n[a](/url "h1 | h2&#10;")',
					expectedTitle: "h1 | h2\n",
					md: '[a]: /url\n"h1 | h2\n--- | ---\nc1 | c2\n\n[a]',
					name: "3. edited GFM table body cell",
				},
				{
					edit: (doc) => replaceFirstTextMatch(doc, "keep", "edited"),
					expected:
						'- [a]: /url\n\n  # "Setext title\n\n  edited\n\n[a](/url "Setext title&#10;")',
					expectedTitle: "Setext title\n",
					md: '- [a]: /url\n  "Setext title\n  ===\n\n  keep\n\n[a]',
					name: "4. untouched Setext heading inside edited list item",
				},
				{
					edit: (doc) => replaceFirstTextMatch(doc, '"old title', '"new title'),
					expected: '[a]: /url\n\n"new title\n\n[a](/url "old title&#10;")',
					expectedTitle: "old title\n",
					md: '[a]: /url\n"old title\n\n[a]',
					name: "5. edited paragraph follower",
				},
			];

			for (const testCase of cases) {
				for (const useLiveDoc of [false, true]) {
					const liveDoc = useLiveDoc
						? parseMarkdownToVisualDoc(testCase.md)
						: undefined;
					const guard = createMarkdownRoundTripGuard(
						testCase.md,
						undefined,
						liveDoc,
					);
					const edited = testCase.edit(guard.initialDoc);
					const serialized = guard.serialize(edited);
					expect(
						serialized,
						`${testCase.name} (liveDoc=${String(useLiveDoc)})`,
					).toBe(testCase.expected);
					const reparsed = parseMarkdownToVisualDoc(serialized);
					expect(
						reparsed.eq(edited),
						`${testCase.name} eq (liveDoc=${String(useLiveDoc)})`,
					).toBe(true);
					const links = collectLinkSegments(reparsed);
					expect(links).toHaveLength(1);
					expect(links[0]?.title).toBe(testCase.expectedTitle);
				}
			}
		});

		it("preserves raw reference links cleanly when partial-title followers stay untouched verbatim", () => {
			for (const [md, expected] of [
				['[a]: /url\n"old title\n\n[a]\nz', '[a]: /url\n"old title\n\n[a]\nz2'],
				[
					'[a]: /url\n"Setext title\n===\n\n[a]\n\nz',
					'[a]: /url\n"Setext title\n===\n\n[a]\n\nz2',
				],
				[
					'[a]: /url\n"h1 | h2\n--- | ---\nc1 | c2\n\n[a]\n\nz',
					'[a]: /url\n"h1 | h2\n--- | ---\nc1 | c2\n\n[a]\n\nz2',
				],
				[
					'- [a]: /url\n  "Setext title\n  ===\n- z\n\n[a]',
					'- [a]: /url\n  "Setext title\n  ===\n- z2\n\n[a]',
				],
			] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "z", "2");
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(expected);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
			}
		});

		it("re-serializes untouched references across blockquotes, lists, tables, linked images, and transitive ref cascades", () => {
			// Table inside an edited list item + references in blockquote, list, table, and [![img]][a]
			{
				const md =
					'- [a]: /url\n  "h1 | h2\n  --- | ---\n  c1 | c2\n\n  keep\n\n' +
					"[img]: /pic.png\n\n" +
					"> [a]\n\n" +
					"- [a]\n\n" +
					"| [a] |\n| --- |\n\n" +
					"[![img]][a]";
				const guard = createMarkdownRoundTripGuard(md);
				const edited = replaceFirstTextMatch(guard.initialDoc, "keep", "edit");
				const serialized = guard.serialize(edited);
				expect(serialized).toContain('> [a](/url "h1 | h2&#10;")');
				expect(serialized).toContain('- [a](/url "h1 | h2&#10;")');
				expect(serialized).toContain('| [a](/url "h1 \\| h2&#10;") |');
				expect(serialized).toContain('[![img](/pic.png)](/url "h1 | h2&#10;")');
				expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
			}

			// Transitive cascade: deleting `[b]: /b` invalidates Setext heading `"Setext [b]\n===`,
			// forcing ATX serialization `# "Setext [b](/b)`, which must also invalidate `[a]`.
			{
				const md = '[b]: /b\n\n[a]: /url\n"Setext [b]\n===\n\n[a]';
				const guard = createMarkdownRoundTripGuard(md);
				const withoutB = guard.initialDoc.type.create(null, [
					guard.initialDoc.child(1),
					guard.initialDoc.child(2),
					guard.initialDoc.child(3),
				]);
				const serialized = guard.serialize(withoutB);
				expect(serialized).toBe(
					'[a]: /url\n# "Setext [b](/b)\n\n[a](/url "Setext [b]&#10;")',
				);
				expect(parseMarkdownToVisualDoc(serialized).eq(withoutB)).toBe(true);
			}
		});
	});

	describe("3. Preserve mathNewlineToken during dedentAllToLineZeroAtDepth at depth >= 1 (Track B #3)", () => {
		it("never injects '>' into multiline \\(...\\) inside raw HTML blocks at depth 1 and depth 2", () => {
			for (const [md, expected] of [
				[
					"> - item1\n>\n> middle\n>\n>   <div>\\(a\nb\\)</div>",
					"> - item1\n>\n> <div>\\(a\nb\\)</div>",
				],
				[
					"> > - item1\n> >\n> > middle\n> >\n> >   <div>\\(a\nb\\)</div>",
					"> > - item1\n> >\n> > <div>\\(a\nb\\)</div>",
				],
			] as const) {
				const guard = createMarkdownRoundTripGuard(md);
				const deleteMiddle = (doc: ProseMirrorNode): ProseMirrorNode => {
					const bq = doc.child(0);
					if (bq.child(0).type.name === "blockquote") {
						const innerBq = bq.child(0);
						return doc.type.create(null, [
							bq.type.create(null, [
								innerBq.type.create(null, [innerBq.child(0), innerBq.child(2)]),
							]),
						]);
					}
					return doc.type.create(null, [
						bq.type.create(null, [bq.child(0), bq.child(2)]),
					]);
				};
				const edited = deleteMiddle(guard.initialDoc);
				const serialized = guard.serialize(edited);
				expect(serialized, md).toBe(expected);
				expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
			}
		});

		it("protects multiline \\(...\\), \\[...\\], and $$...$$ when dedentAllToLineZeroAtDepth dedents indented raw blocks at depth 1 and depth 2", () => {
			const mathPayloads = [
				"  <div>\\(a\nb\\)</div>",
				"  <div>\\[a\nb\\]</div>",
				"  <div>$$\na\nb\n$$</div>",
				"  <!--\n  $$\n  a\n  b\n  $$\n  -->",
			];
			const expectedBodies = [
				"<div>\\(a\nb\\)</div>",
				"<div>\\[a\nb\\]</div>",
				"<div>$$\na\nb\n$$</div>",
				"<!--\n$$\n  a\n  b\n  $$\n-->",
			];

			for (const depth of [1, 2] as const) {
				const prefix = "> ".repeat(depth);
				const blank = `${"> ".repeat(depth - 1)}>`;
				const baseMd = `${prefix}- item1\n${blank}\n${prefix}middle`;
				for (let idx = 0; idx < mathPayloads.length; idx += 1) {
					const rawMarkdown = mathPayloads[idx] ?? "";
					const expectedBody = expectedBodies[idx] ?? "";
					const guard = createMarkdownRoundTripGuard(baseMd);
					const rawBlock = visualEditorSchema.nodes.protected_block.create({
						kind: "raw",
						rawMarkdown,
					});
					const bq = guard.initialDoc.child(0);
					const edited =
						depth === 1
							? guard.initialDoc.type.create(null, [
									bq.type.create(null, [bq.child(0), rawBlock]),
								])
							: guard.initialDoc.type.create(null, [
									bq.type.create(null, [
										bq
											.child(0)
											.type.create(null, [bq.child(0).child(0), rawBlock]),
									]),
								]);
					const serialized = guard.serialize(edited);
					const expectedPrefixed =
						idx === 3
							? `${prefix}<!--\n${prefix}$$\n  a\n  b\n  $$\n${prefix}-->`
							: `${prefix}${expectedBody}`;
					expect(serialized, `depth=${depth} idx=${idx}`).toBe(
						`${prefix}- item1\n${blank}\n${expectedPrefixed}`,
					);
				}
			}

			// Also verify `math`, `mermaid`, and `toc` protected blocks dedent cleanly at depth 2
			const nestedMd =
				"> > - a\n> > -   # h\n> >   ```mermaid\n> >   graph TD\n> >   A-->B\n> >   ```\n> >\n> >   [TOC]\n> >\n> >   $$\n> >   x\n> >   $$";
			const nestedGuard = createMarkdownRoundTripGuard(nestedMd);
			const nestedEdited = insertTextAfterFirstMatch(
				nestedGuard.initialDoc,
				"h",
				"!",
			);
			const nestedSerialized = nestedGuard.serialize(nestedEdited);
			expect(nestedSerialized).toBe(
				"> > - a\n> > -\n> >   # h!\n> >\n> > ```mermaid\n> > graph TD\n> > A-->B\n> > ```\n> >\n> >   [TOC]\n> >\n> >   $$\n> >   x\n> >   $$",
			);
			expect(parseMarkdownToVisualDoc(nestedSerialized).eq(nestedEdited)).toBe(
				true,
			);
		});
	});

	describe("4. Unified O(N) tight sharedGroup checker and canPreserveContainerHead consistency (Track B #4)", () => {
		it("scales linearly on N=400/800/1600 tight sharedGroup chains with partial-title refdefs", () => {
			for (const count of [400, 800, 1600] as const) {
				const chainLines: string[] = [];
				for (let i = 0; i < count; i += 1) {
					chainLines.push(`a${i} $$x${i}$$ # H${i}`);
				}
				const md = `[r]: /u\n"a\n\n${chainLines.join("\n")}\n\n[r]\n\ntail`;
				const parsed = parseMarkdownWithBlockSources(md);
				const groupStarts = parsed.blocks.filter(
					(block, idx) => block.sharedGroup?.startIndex === idx,
				);
				expect(groupStarts).toHaveLength(count);

				const guard = createMarkdownRoundTripGuard(md, parsed);
				const edited = insertTextAfterFirstMatch(guard.initialDoc, "tail", "!");

				const startedAt = performance.now();
				const serialized = guard.serialize(edited);
				const elapsedMs = performance.now() - startedAt;

				expect(serialized).toBe(`${md}!`);
				expect(elapsedMs, `N=${count}`).toBeLessThan(1500);
			}
		});

		it("invalidates tight sharedGroup consistently when paired right-neighbor blockquote head has an invalidated ref", () => {
			const md = '[b]: /b\n\n[a]: /u\n"x $$m$$ # H\n> [b]\n>\n> tail\n\n[a]';
			const parsed = parseMarkdownWithBlockSources(md);
			expect(parsed.blocks[2]?.sharedGroup).toBeDefined();
			expect(parsed.blocks[5]?.node.type.name).toBe("blockquote");
			expect(parsed.blocks[5]?.separatorBefore).toBe("\n");

			const guard = createMarkdownRoundTripGuard(md, parsed);
			// Delete `[b]: /b` and edit `tail` -> `tail!` inside the paired blockquote
			const editedTail = insertTextAfterFirstMatch(
				guard.initialDoc,
				"tail",
				"!",
			);
			const children: ProseMirrorNode[] = [];
			for (let i = 1; i < editedTail.childCount; i += 1) {
				children.push(editedTail.child(i));
			}
			const withoutB = editedTail.type.create(null, children);
			const serialized = guard.serialize(withoutB);
			expect(serialized).toBe(
				'[a]: /u\n\n"x\n\n$$m$$\n\n# H\n\n> [b](/b)\n>\n> tail!\n\n[a](/u "x &#10;")',
			);
			expect(parseMarkdownToVisualDoc(serialized).eq(withoutB)).toBe(true);
		});
	});

	describe("5. Reused stripUpToIndentColumns in dedentBlockToLineZero (Track B #7)", () => {
		it("strips mixed tab and space column prefixes identically to CommonMark §2.2", () => {
			expect(dedentBlockToLineZero("  [a]: /u\n\t/v")).toBe("[a]: /u\n  /v");
			expect(dedentBlockToLineZero("   x\n  y\n    z")).toBe("x\ny\n z");
		});
	});
});
