import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { isListSwallowingFollowingBlock } from "../markdown-container-preservation";
import * as parser from "../markdown-parser";
import { computeIntactRefDefLabels } from "../markdown-refdef-liveness";
import {
	createMarkdownRoundTripGuard,
	serializeVisualDocToMarkdown,
} from "../markdown-serializer";
import { visualEditorSchema } from "../visual-schema";

// Every original document and expected serialization below was rendered with
// real PHP `EasyMDE\Content\MarkdownRenderer::render()`: each pair produces
// the same HTML except for the intended edit (the deleted paragraph), and
// every link keeps its PHP `href` / `title` (inlined only when its reference
// definition is no longer preserved verbatim).

function serializeOne(node: ProseMirrorNode): string {
	return serializeVisualDocToMarkdown(
		visualEditorSchema.nodes.doc.create(null, [node]),
	);
}

function collectLinkTitles(markdown: string): unknown[] {
	const titles: unknown[] = [];
	parser.parseMarkdownToVisualDoc(markdown).descendants((node) => {
		const link = node.marks.find((m) => m.type.name === "link");
		if (link && node.isText) titles.push([link.attrs.href, link.attrs.title]);
	});
	return titles;
}

function deleteParagraph(text: string) {
	return (doc: ProseMirrorNode): ProseMirrorNode => {
		let from = -1;
		let to = -1;
		doc.descendants((node, pos) => {
			if (from >= 0) return false;
			if (node.type.name === "paragraph" && node.textContent === text) {
				from = pos;
				to = pos + node.nodeSize;
				return false;
			}
			return true;
		});
		expect(from, `Could not find paragraph "${text}"`).toBeGreaterThanOrEqual(
			0,
		);
		const state = EditorState.create({ doc, schema: visualEditorSchema });
		return state.apply(state.tr.delete(from, to)).doc;
	};
}

function replaceText(needle: string, replacement: string) {
	return (doc: ProseMirrorNode): ProseMirrorNode => {
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

type RoundTrip = Readonly<{
	allIntact: string[];
	partialTitleIntact: string[];
	serialized: string;
}>;

function roundTrip(
	md: string,
	edit: (doc: ProseMirrorNode) => ProseMirrorNode,
): RoundTrip {
	const parsed = parser.parseMarkdownWithBlockSources(md);
	const guard = createMarkdownRoundTripGuard(md, parsed);
	const edited = edit(guard.initialDoc);
	const live = computeIntactRefDefLabels(edited, parsed, serializeOne);
	return {
		allIntact: [...live.allIntact].sort(),
		partialTitleIntact: [...live.partialTitleIntact].sort(),
		serialized: guard.serialize(edited),
	};
}

const MULTI_DEF_DOC = [
	"placeholder",
	"",
	"[a]: /a",
	"[b]: /b",
	'    "tb',
	"",
	"mid",
	"",
	"[x]: /x",
	'    "tb',
	"$$y$$ [q]: /q",
	'"tq',
	"===",
	"",
	"[la][a] [lb][b] [lx][x] [lq][q]",
].join("\n");

/**
 * Replaces `placeholder` with the refdef block `refDefSource` and deletes the
 * first `"tb`, `mid`, and `[x]: /x` blocks, so the multi-definition node
 * `[a]: /a\n[b]: /b` lands right before the second `    "tb`.
 */
function shadowAndCollapse(refDefSource: string) {
	return (doc: ProseMirrorNode): ProseMirrorNode => {
		const kids: ProseMirrorNode[] = [];
		doc.forEach((child) => {
			kids.push(child);
		});
		expect(kids[1]?.attrs.rawMarkdown).toBe("[a]: /a\n[b]: /b");
		expect(kids[4]?.attrs.rawMarkdown).toBe("[x]: /x");
		const replacement = parser
			.parseMarkdownToVisualDoc(`${refDefSource}\n\n[z][a]`)
			.child(0);
		expect(replacement.attrs.rawMarkdown).toBe(refDefSource);
		return doc.type.create(doc.attrs, [
			replacement,
			kids[1] as ProseMirrorNode,
			...kids.slice(5),
		]);
	};
}

describe("PR-R48-A column-aware list swallowing at every depth and multi-definition partial-title liveness", () => {
	describe("1. List-swallow checks measure columns at the container depth (Track A #1, Track B #1)", () => {
		const cases: ReadonlyArray<readonly [string, string, string, string]> = [
			[
				"Track A: `> \\t---` after `> -\\ta` would join the item",
				"> -\ta\n>\n> b\n>\n> \t---",
				"b",
				"> -\ta\n>\n> ---",
			],
			[
				"Case A: `>   para` after `> -\\titem`",
				"> -\titem\n>\n> drop\n>\n>   para\n",
				"drop",
				"> -\titem\n>\n> para\n",
			],
			[
				"Case C: `> 100.\\titem` (padding 6) keeps a sibling code block",
				"> 100.\titem\n>\n> drop\n>\n>       para\n",
				"drop",
				"> 100.\titem\n>\n> ```\n>   para\n> ```\n",
			],
			[
				"Case D: `> \\tpara`",
				"> -\titem\n>\n> drop\n>\n> \tpara\n",
				"drop",
				"> -\titem\n>\n> para\n",
			],
			[
				"Case D: leading spaces before `>`",
				"   > -\titem\n   >\n   > drop\n   >\n   >    para\n",
				"drop",
				"   > -\titem\n>\n> para\n",
			],
			[
				"Case D: trailing item of a multi-item list",
				"> - first\n> -\titem\n>\n> drop\n>\n>   para\n",
				"drop",
				"> - first\n> -\titem\n>\n> para\n",
			],
			[
				"a tab right after `>` (partially consumed optional space) does not swallow",
				">\t-\titem\n>\n> drop\n>\n>   para\n",
				"drop",
				">\t-\titem\n>\n>   para\n",
			],
			[
				"a tab right after an indented `>` does not swallow",
				"  >\t-\titem\n  >\n  > drop\n  >\n  >   para\n",
				"drop",
				"  >\t-\titem\n>\n  >   para\n",
			],
			[
				"depth 2 keeps `> >   para` a sibling",
				"> > -\titem\n> >\n> > drop\n> >\n> >   para\n",
				"drop",
				"> > -\titem\n> >\n> >   para\n",
			],
			[
				"an indented-code first line (§5.2 padding = marker + 1) still swallows",
				"> -\t\tcode\n>\n> drop\n>\n>   para\n",
				"drop",
				"> -\t\tcode\n>\n> para\n",
			],
		];
		for (const [title, md, drop, expected] of cases) {
			it(`1.x ${title}`, () => {
				expect(roundTrip(md, deleteParagraph(drop)).serialized).toBe(expected);
			});
		}

		it("1.11 Case B: a nested blockquote refdef stays a sibling and [p] keeps its PHP title", () => {
			const md =
				'> -\titem\n>\n> drop\n>\n>   > [p]: /u\n>   > "t\n>   > ===\n\n[link][p]';
			const { serialized } = roundTrip(md, deleteParagraph("drop"));
			expect(serialized).toBe(
				'> -\titem\n>\n> > [p]: /u\n> >\n> > # "t\n\n[link](/u "t&#10;")',
			);
			expect(collectLinkTitles(serialized)).toEqual(collectLinkTitles(md));
			expect(collectLinkTitles(serialized)).toEqual([["/u", "t\n"]]);
		});

		it("1.12 reverse: `> \\t>` (depth-1 indent 2) after `> -   keep` gets no extra blank line", () => {
			const md =
				'> - alpha\n> -   keep\n> \t> [p]: /u\n> \t> "t\n> \t> ===\n\n[link][p]';
			const { allIntact, partialTitleIntact, serialized } = roundTrip(
				md,
				replaceText("alpha", "edited"),
			);
			expect(serialized).toBe(md.replace("alpha", "edited"));
			expect(allIntact).toEqual(["P"]);
			expect(partialTitleIntact).toEqual(["P"]);
		});

		it("1.13 reverse at depth 2 keeps the lazy nested quote verbatim", () => {
			const md = "> > - alpha\n> > -   keep\n> > \t> b\n";
			expect(roundTrip(md, replaceText("alpha", "edited")).serialized).toBe(
				md.replace("alpha", "edited"),
			);
		});

		it("1.14 the shared check reads emitted text with its quote markers", () => {
			const listNode = parser
				.parseMarkdownToVisualDoc("> -\ta")
				.child(0)
				.child(0);
			expect(listNode.type.name).toBe("bullet_list");
			expect(
				isListSwallowingFollowingBlock(
					listNode,
					() => "> -\ta",
					"> \t---",
					1,
					false,
				),
			).toBe(true);
			expect(
				isListSwallowingFollowingBlock(
					listNode,
					() => ">\t-\ta",
					">   ---",
					1,
					false,
				),
			).toBe(false);
			expect(
				isListSwallowingFollowingBlock(
					listNode,
					() => "> -\ta",
					"> \t---",
					1,
					true,
				),
			).toBe(false);
		});
	});

	describe("2. A multi-definition refdef stays a partial-title node while one of its partial labels is live (Track B #2)", () => {
		it("2.1 shadowing only [a] keeps [b] and [q] intact in liveness AND output", () => {
			const { allIntact, partialTitleIntact, serialized } = roundTrip(
				MULTI_DEF_DOC,
				shadowAndCollapse("[a]: /new"),
			);
			expect(allIntact).toEqual(["B", "Q"]);
			expect(partialTitleIntact).toEqual(["B", "Q"]);
			expect(serialized).toBe(
				'[a]: /new\n\n[a]: /a\n[b]: /b\n    "tb\n$$y$$ [q]: /q\n"tq\n===\n\n[la](/a) [lb][b] [lx](/x "tb&#10;") [lq][q]',
			);
			expect(collectLinkTitles(serialized)).toEqual(
				collectLinkTitles(MULTI_DEF_DOC),
			);
		});

		it("2.2 shadowing [b] releases the node: the title slot downgrades and [q] inlines everywhere", () => {
			const { allIntact, partialTitleIntact, serialized } = roundTrip(
				MULTI_DEF_DOC,
				shadowAndCollapse("[b]: /new"),
			);
			expect(allIntact).toEqual(["A"]);
			expect(partialTitleIntact).toEqual([]);
			expect(serialized).toBe(
				'[b]: /new\n\n[a]: /a\n[b]: /b\n\n"tb\n\n$$y$$\n\n[q]: /q\n\n"tq\n===\n\n[la](/a) [lb](/b "tb&#10;") [lx](/x "tb&#10;") [lq](/q "tq&#10;")',
			);
			expect(collectLinkTitles(serialized)).toEqual(
				collectLinkTitles(MULTI_DEF_DOC),
			);
		});

		it("2.3 shadowing both [a] and [b] invalidates [q] in liveness AND output", () => {
			const { allIntact, partialTitleIntact, serialized } = roundTrip(
				MULTI_DEF_DOC,
				shadowAndCollapse("[a]: /new\n[b]: /new"),
			);
			expect(allIntact).toEqual([]);
			expect(partialTitleIntact).toEqual([]);
			expect(serialized).toBe(
				'[a]: /new\n[b]: /new\n\n[a]: /a\n[b]: /b\n\n"tb\n\n$$y$$\n\n[q]: /q\n\n"tq\n===\n\n[la](/a) [lb](/b "tb&#10;") [lx](/x "tb&#10;") [lq](/q "tq&#10;")',
			);
			expect(collectLinkTitles(serialized)).toEqual(
				collectLinkTitles(MULTI_DEF_DOC),
			);
		});
	});
});
