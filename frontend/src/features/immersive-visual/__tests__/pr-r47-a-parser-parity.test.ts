import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateMatchedContainerHeadRisk } from "../markdown-container-head-line";
import { leadingIndentAtDepth } from "../markdown-container-preservation";
import * as listPreservation from "../markdown-list-preservation";
import * as parser from "../markdown-parser";
import { computeIntactRefDefLabels } from "../markdown-refdef-liveness";
import {
	createMarkdownRoundTripGuard,
	serializeVisualDocToMarkdown,
} from "../markdown-serializer";
import { createVisualInputRulesPlugin } from "../visual-input-rules";
import { visualEditorSchema } from "../visual-schema";

// Every original document and expected serialization below was rendered with
// real PHP `EasyMDE\Content\MarkdownRenderer::render()`: each pair produces
// the same HTML except for the intended edit, and every link keeps its PHP
// `href` / `title` (inlined only when its reference definition is no longer
// preserved verbatim).

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

function withChild(
	parent: ProseMirrorNode,
	idx: number,
	replacement: ProseMirrorNode | null,
): ProseMirrorNode {
	const children: ProseMirrorNode[] = [];
	for (let i = 0; i < parent.childCount; i += 1) {
		if (i !== idx) children.push(parent.child(i));
		else if (replacement) children.push(replacement);
	}
	return parent.type.create(parent.attrs, children);
}

function dropFirstOrderedItem(doc: ProseMirrorNode): ProseMirrorNode {
	let listIdx = -1;
	for (let i = 0; i < doc.childCount && listIdx < 0; i += 1) {
		if (doc.child(i).type.name === "ordered_list") listIdx = i;
	}
	expect(listIdx).toBeGreaterThanOrEqual(0);
	return withChild(doc, listIdx, withChild(doc.child(listIdx), 0, null));
}

function replaceText(
	doc: ProseMirrorNode,
	needle: string,
	replacement: string,
): ProseMirrorNode {
	let found = -1;
	doc.descendants((node, pos) => {
		if (found >= 0 || !node.isText || !node.text) return found < 0;
		const idx = node.text.indexOf(needle);
		if (idx >= 0) {
			found = pos + idx;
			return false;
		}
		return true;
	});
	expect(found, `Could not find "${needle}" in doc`).toBeGreaterThanOrEqual(0);
	const state = EditorState.create({ doc, schema: visualEditorSchema });
	return state.apply(
		state.tr.insertText(replacement, found, found + needle.length),
	).doc;
}

type RoundTrip = Readonly<{
	allIntact: string[];
	edited: ProseMirrorNode;
	partialTitleIntact: string[];
	plan: ReturnType<typeof computeIntactRefDefLabels>["plan"];
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
		edited,
		partialTitleIntact: [...live.partialTitleIntact].sort(),
		plan: live.plan,
		serialized: guard.serialize(edited),
	};
}

const REPRO_A = [
	"[ok]: /ok",
	"",
	"1. remove",
	"",
	"   extra",
	"10000. > [p0]: /p0",
	'       > "t0',
	"       > ===",
	"   2. [p1]: /p1",
	'      "[ok]" x',
	"",
	"-   [p0]",
	"",
	"   > [q]: /q",
	'   > "tq',
	"   > ===",
	"",
	"[link0][p0] [link1][p1] [linkq][q]",
].join("\n");
const REPRO_B = REPRO_A.replace(
	"       > ===",
	"       > ===\n       > [self][p0]",
);
const REPRO_A_TAIL = [
	"2. [p1]: /p1",
	"",
	'   "[ok](/ok)" x',
	"",
	"-   [p0]",
	"",
	"   > [q]: /q",
	'   > "tq',
	"   > ===",
	"",
	'[link0][p0] [link1](/p1 "[ok]") [linkq][q]',
].join("\n");

const SLOT_DOC =
	'$$x$$ [p]: /u\n    "t\n$$y$$ [q]: /q\n"tq\n===\n\n[link][p] [linkq][q]';
const dropFirstBlock = (doc: ProseMirrorNode): ProseMirrorNode =>
	withChild(doc, 0, null);

function chainDoc(k: number): string {
	const items = [
		"-   [dead]",
		"   - keep",
		"-   [dead]",
		"  -\t[p1]: /p1",
		'    "t1',
		"    ===",
	];
	const uses = ["[l1][p1]"];
	for (let i = 2; i <= k; i += 1) {
		items.push(`- [p${i}]: /p${i}`, `  "t${i}`, "  ===", `  [r][p${i - 1}]`);
		uses.push(`[l${i}][p${i}]`);
	}
	return ["[dead]: /d", items.join("\n"), uses.join(" ")].join("\n\n");
}

function measureChain(k: number): Readonly<{
	allIntact: number;
	resolutions: number;
	serializeCalls: number;
	serialized: string;
}> {
	const md = chainDoc(k);
	const parsed = parser.parseMarkdownWithBlockSources(md);
	const guard = createMarkdownRoundTripGuard(md, parsed);
	const edited = dropFirstBlock(guard.initialDoc);
	let serializeCalls = 0;
	const countingSerializer = (node: ProseMirrorNode): string => {
		serializeCalls += 1;
		return serializeOne(node);
	};
	const spy = vi.spyOn(
		listPreservation,
		"resolveAuthoritativeListPreservation",
	);
	try {
		const live = computeIntactRefDefLabels(edited, parsed, countingSerializer);
		return {
			allIntact: live.allIntact.size,
			resolutions: spy.mock.calls.length,
			serializeCalls,
			serialized: guard.serialize(edited),
		};
	} finally {
		spy.mockRestore();
	}
}

const mountedViews: EditorView[] = [];
afterEach(() => {
	for (const view of mountedViews.splice(0)) view.destroy();
});

function typeIntoEmptyEditor(text: string): ProseMirrorNode {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const view = new EditorView(host, {
		state: EditorState.create({
			doc: parser.parseMarkdownToVisualDoc(""),
			plugins: [createVisualInputRulesPlugin()],
			schema: visualEditorSchema,
		}),
	});
	mountedViews.push(view);
	for (const ch of text) {
		const { from, to } = view.state.selection;
		let handled = false;
		view.someProp("handleTextInput", (handler) => {
			if (
				handler(view, from, to, ch, () =>
					view.state.tr.insertText(ch, from, to),
				)
			) {
				handled = true;
			}
			return handled;
		});
		if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
	}
	return view.state.doc;
}

describe("PR-R47-A staged list reuse, linear same-list chains, live slot joins, tab columns, and 9-digit input rules", () => {
	describe("1. A locally valid item 0 is never committed before trailing fallback items (Track B #1)", () => {
		it("1.1 Repro A: item 0 stays verbatim and [p0] / [q] stay intact in liveness AND output", () => {
			const { allIntact, partialTitleIntact, serialized } = roundTrip(
				REPRO_A,
				dropFirstOrderedItem,
			);
			expect(serialized).toBe(
				`[ok]: /ok\n\n1. > [p0]: /p0\n   > "t0\n   > ===\n${REPRO_A_TAIL}`,
			);
			expect(partialTitleIntact).toEqual(["P0", "Q"]);
			expect(allIntact).toEqual(["OK", "P0", "Q"]);
			// PHP keeps `title="t0\n"` / `title="tq\n"` on every untouched use.
			expect(collectLinkTitles(serialized)).toEqual(collectLinkTitles(REPRO_A));
		});

		it("1.2 Repro B: a self-reference inside item 0 never resurrects a downgraded item", () => {
			const { partialTitleIntact, serialized } = roundTrip(
				REPRO_B,
				dropFirstOrderedItem,
			);
			expect(serialized).toBe(
				`[ok]: /ok\n\n1. > [p0]: /p0\n   > "t0\n   > ===\n   > [self][p0]\n${REPRO_A_TAIL}`,
			);
			expect(partialTitleIntact).toEqual(["P0", "Q"]);
		});

		it("1.3 the liveness reuse mask is exactly what the serializer emits verbatim", () => {
			const { edited, plan, serialized } = roundTrip(
				REPRO_A,
				dropFirstOrderedItem,
			);
			const list = edited.child(1);
			expect(plan.listItemReusable.get(list)).toEqual([true, false]);
			// Item 0 verbatim (realigned marker), item 1 canonical.
			expect(serialized).toContain('1. > [p0]: /p0\n   > "t0');
			expect(serialized).toContain('2. [p1]: /p1\n\n   "[ok](/ok)" x');
		});

		it("1.4 resolution distinguishes a locally valid item 0 (Repro A) from an intrinsically broken one (PR-R46-A 2.1)", () => {
			const resolveFor = (md: string) => {
				const parsed = parser.parseMarkdownWithBlockSources(md);
				const guard = createMarkdownRoundTripGuard(md, parsed);
				const edited = dropFirstOrderedItem(guard.initialDoc);
				let listIdx = 0;
				while (edited.child(listIdx).type.name !== "ordered_list") listIdx += 1;
				const list = edited.child(listIdx);
				const block = parsed.blocks.find(
					(b) => b.node.type.name === "ordered_list",
				);
				expect(block).toBeDefined();
				const prepared = listPreservation.prepareListPreservation(
					list,
					block as NonNullable<typeof block>,
					0,
					parsed.envReferences,
				);
				expect(prepared).not.toBeNull();
				const partials = new Set<ProseMirrorNode>();
				for (const label of parsed.phpPartialTitleRefLabels ?? []) {
					const node = parsed.firstRefDefNodeByLabel?.get(label);
					if (node) partials.add(node);
				}
				return listPreservation.resolveAuthoritativeListPreservation(
					list,
					prepared as NonNullable<typeof prepared>,
					serializeOne,
					parsed.envReferences,
					() => true,
					(node) => partials.has(node),
					undefined,
					false,
				);
			};
			const repro = resolveFor(REPRO_A);
			expect(repro.intrinsicItemReusable).toEqual([true, true]);
			expect(repro.itemReusable).toEqual([false, false]);
			const broken = resolveFor(
				[
					"[ok]: /ok",
					"",
					"1. remove",
					"",
					"   extra",
					"10.    [p0]: /p0",
					'       "[ok]" x',
					"      - sub",
					"   2. [p2]: /p2",
					'      "t2',
					"      ===",
					"",
					"-   [p2]",
				].join("\n"),
			);
			expect(broken.intrinsicItemReusable[0]).toBe(false);
		});
	});

	describe("2. Same-list chains close locally; shifted items are parsed once (Track B #2)", () => {
		it("2.1 a K-item same-list refdef chain costs O(1) list resolutions and O(K) serialization", () => {
			const k40 = measureChain(40);
			const k80 = measureChain(80);
			// Pass-1 resolution + one Pass-2 drain resolution, independent of K
			// (previously one whole-list resolution per chain hop: K + 1).
			expect(k40.resolutions).toBeLessThanOrEqual(4);
			expect(k80.resolutions).toBeLessThanOrEqual(4);
			// Linear: 2x items -> ~2x serializer calls (previously ~4x).
			expect(k80.serializeCalls).toBeLessThan(k40.serializeCalls * 2.2);
			expect(k80.serializeCalls).toBeLessThan(80 * 5);
			expect(k80.allIntact).toBe(0);
			expect(collectLinkTitles(k80.serialized)).toEqual(
				collectLinkTitles(chainDoc(80)),
			);
		});

		it("2.2 a mask-only resolution with shifted items parses each shifted item exactly once", () => {
			// PHP: three sibling `<li>` items on both sides.
			const md = "-   [a]\n   - b\n   - c";
			const parsed = parser.parseMarkdownWithBlockSources(md);
			const guard = createMarkdownRoundTripGuard(md, parsed);
			const edited = replaceText(guard.initialDoc, "[a]", "z");
			const list = edited.child(0);
			const block = parsed.blocks[0];
			expect(block).toBeDefined();
			const prepared = listPreservation.prepareListPreservation(
				list,
				block as NonNullable<typeof block>,
				0,
				parsed.envReferences,
			);
			expect(prepared?.hasIndentedTrailingItem).toBe(true);
			const spy = vi.spyOn(parser, "parseMarkdownWithBlockSources");
			try {
				const resolution =
					listPreservation.resolveAuthoritativeListPreservation(
						list,
						prepared as NonNullable<typeof prepared>,
						serializeOne,
						parsed.envReferences,
						() => true,
						null,
						undefined,
						false,
					);
				expect(resolution.itemReusable).toEqual([false, true, true]);
				// 2 shifted items + 1 whole-list validation (previously 2 + 2 + 1).
				expect(spy.mock.calls.length).toBe(3);
			} finally {
				spy.mockRestore();
			}
			expect(guard.serialize(edited)).toBe("- z\n- b\n- c");
		});
	});

	describe("3. Liveness and serializer share the live partial-title slot join (Track B #3)", () => {
		it("3.1 [p] alive: the 4-space title line and the tight $$y$$ [q] group stay verbatim", () => {
			const { allIntact, partialTitleIntact, serialized } = roundTrip(
				SLOT_DOC,
				dropFirstBlock,
			);
			expect(serialized).toBe(
				'[p]: /u\n    "t\n$$y$$ [q]: /q\n"tq\n===\n\n[link][p] [linkq][q]',
			);
			expect(allIntact).toEqual(["P", "Q"]);
			expect(partialTitleIntact).toEqual(["P", "Q"]);
		});

		it("3.2 the head risk evaluation honors the live partial-title predicate", () => {
			const doc = parser.parseMarkdownToVisualDoc(SLOT_DOC);
			const refNode = doc.child(1);
			const input = {
				baselineBlocks: [],
				child: doc.child(2),
				defaultBlankSep: "\n\n",
				depth: 0,
				effIdx: -1,
				groupSep: undefined,
				headLine: '    "t',
				prevEffIdx: -1,
				prevEmittedText: () => "[p]: /u",
				prevInnerText: () => "[p]: /u",
				prevNode: refNode,
				prevWasVerbatimAdjacent: false,
			};
			expect(
				evaluateMatchedContainerHeadRisk({
					...input,
					isPartialTitleRefDef: (node) => node === refNode,
				}),
			).toEqual({ indentedRisk: false, separator: "\n", swallowRisk: false });
			expect(
				evaluateMatchedContainerHeadRisk({
					...input,
					isPartialTitleRefDef: null,
				}),
			).toMatchObject({ indentedRisk: true, separator: "\n\n" });
		});

		it("3.3 [p] lost after its title slot was planned: the slot re-evaluates and [q] inlines its PHP title", () => {
			const { partialTitleIntact, serialized } = roundTrip(
				SLOT_DOC.replace('"t\n', '"t __x__\n'),
				dropFirstBlock,
			);
			expect(serialized).toBe(
				'[p]: /u\n\n"t **x**\n\n$$y$$\n\n[q]: /q\n\n"tq\n===\n\n[link](/u "t __x__&#10;") [linkq](/q "tq&#10;")',
			);
			expect(partialTitleIntact).toEqual([]);
		});

		it("3.4 [p]'s title references a deleted [dead]: liveness and output agree with zero title loss", () => {
			const md = `[dead]: /d\n\n${SLOT_DOC.replace('"t\n', '"t [r][dead]\n')}`;
			const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
				dropFirstBlock(dropFirstBlock(doc)),
			);
			expect(serialized).toBe(
				'[p]: /u\n\n"t [r](/d)\n\n$$y$$\n\n[q]: /q\n\n"tq\n===\n\n[link](/u "t [r][dead]&#10;") [linkq](/q "tq&#10;")',
			);
			expect(partialTitleIntact).toEqual([]);
		});
	});

	describe("4. Exact tab columns after blockquote markers (Track B #4)", () => {
		it.each([
			["> \t> b", 1, 2],
			[">\t> b", 1, 2],
			[">  \t> b", 1, 2],
			[">   \t> b", 1, 6],
			["> > \t> c", 2, 4],
			["> > \t> c", 1, 0],
			[">  b", 1, 1],
			["  b", 0, 2],
		])("4.1 leadingIndentAtDepth(%j, %i) === %i", (line, depth, expected) => {
			expect(leadingIndentAtDepth(line, depth)).toBe(expected);
		});

		it.each([
			[">\t", true],
			["> \t", true],
			[">  \t", true],
			[">   \t", false],
		])(
			"4.2 editing `a` keeps the untouched %j nested blockquote verbatim",
			(prefix, isRefDef) => {
				const md = `> a\n>\n${prefix}> [p]: /u\n${prefix}> "t\n${prefix}> ===\n\n[link][p]`;
				const { partialTitleIntact, serialized } = roundTrip(md, (doc) =>
					replaceText(doc, "a", "b"),
				);
				expect(serialized).toBe(md.replace("> a", "> b"));
				// `>   \t` indents 6 columns: PHP renders indented code, no refdef.
				expect(partialTitleIntact).toEqual(isRefDef ? ["P"] : []);
			},
		);

		it("4.3 a depth-2 `> > \\t` line is 4-column indented code and round-trips verbatim", () => {
			const md =
				'> > a\n> >\n> > \t> [p]: /u\n> > \t> "t\n> > \t> ===\n\n[link][p]';
			const { serialized } = roundTrip(md, (doc) => replaceText(doc, "a", "b"));
			expect(serialized).toBe(md.replace("> > a", "> > b"));
		});
	});

	describe("5. The ordered-list input rule accepts only 1-9 digit markers (Track A #1)", () => {
		it("5.1 `999999999. ` starts an ordered list at 999999999", () => {
			const doc = typeIntoEmptyEditor("999999999. A");
			expect(doc.firstChild?.type.name).toBe("ordered_list");
			expect(doc.firstChild?.attrs.order).toBe(999999999);
			// PHP: `<ol start="999999999"><li>A</li></ol>`.
			expect(serializeVisualDocToMarkdown(doc)).toBe("999999999. A");
		});

		it("5.2 `1000000000. ` stays a plain paragraph", () => {
			const doc = typeIntoEmptyEditor("1000000000. A");
			expect(doc.firstChild?.type.name).toBe("paragraph");
			expect(doc.firstChild?.textContent).toBe("1000000000. A");
			// PHP: `<p>1000000000. A</p>`.
			expect(
				parser.parseMarkdownToVisualDoc(serializeVisualDocToMarkdown(doc))
					.firstChild?.type.name,
			).toBe("paragraph");
		});
	});
});
