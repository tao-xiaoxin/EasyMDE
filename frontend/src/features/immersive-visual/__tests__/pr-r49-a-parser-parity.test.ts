import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
	emitWithMathSentinelAtDepth,
	isListSwallowingFollowingBlock,
} from "../markdown-container-preservation";
import * as parser from "../markdown-parser";
import {
	type ContainerStep,
	stripBlockquoteDepth,
	stripBlockquoteDepthWithColumn,
	stripContainersWithColumn,
} from "../markdown-prescanner-containers";
import { computeIntactRefDefLabels } from "../markdown-refdef-liveness";
import {
	type ContainerState,
	evaluateSlotJoin,
} from "../markdown-refdef-liveness-slot-risk";
import type { LivenessState } from "../markdown-refdef-liveness-state";
import {
	createMarkdownRoundTripGuard,
	MARKDOWN_SERIALIZERS,
	serializeVisualDocToMarkdown,
} from "../markdown-serializer";
import { visualEditorSchema } from "../visual-schema";

// Every original document and expected serialization below was rendered with
// real PHP `EasyMDE\Content\MarkdownRenderer::render()` (pinned
// `league/commonmark@2.8.2`): each serialized output produces exactly the
// original HTML minus the intended edit (the deleted paragraph or replaced
// word), every link keeps its PHP `href` / `title` (inlined only when its
// reference definition is no longer preserved verbatim), and the baseline
// (pre-PR-R49-A) serializer failed 21 of these PHP differentials.

/** Production block serializer, forwarding the math-newline sentinel. */
function serializeOne(
	node: ProseMirrorNode,
	mathNewlineToken?: string,
): string {
	return MARKDOWN_SERIALIZERS.serializeBlock(node, mathNewlineToken);
}

type Edit = (doc: ProseMirrorNode) => ProseMirrorNode;

function deleteParagraph(text: string): Edit {
	return (doc) => {
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

function findText(doc: ProseMirrorNode, needle: string): number {
	let found = -1;
	doc.descendants((node, pos) => {
		if (found >= 0 || !node.isText || !node.text) return found < 0;
		const idx = node.text.indexOf(needle);
		if (idx >= 0) found = pos + idx;
		return found < 0;
	});
	expect(found, `Could not find "${needle}"`).toBeGreaterThanOrEqual(0);
	return found;
}

function replaceText(needle: string, replacement: string): Edit {
	return (doc) => {
		const found = findText(doc, needle);
		const state = EditorState.create({ doc, schema: visualEditorSchema });
		return state.apply(
			state.tr.insertText(replacement, found, found + needle.length),
		).doc;
	};
}

/** Appends a multiline `protected_inline` atom right after `after`. */
function appendInlineMath(
	after: string,
	rawMarkdown: string,
	kind: "math-inline" | "raw-inline" = "math-inline",
): Edit {
	return (doc) => {
		const at = findText(doc, after) + after.length;
		const atom = visualEditorSchema.nodes.protected_inline.create({
			kind,
			rawMarkdown,
		});
		const state = EditorState.create({ doc, schema: visualEditorSchema });
		return state.apply(state.tr.insert(at, atom)).doc;
	};
}

type Case = readonly [string, string, Edit, string, ReadonlyArray<string>];

/**
 * Serializes `edit(md)` and asserts the refdef liveness analyzer agrees with
 * the serializer: when the baseline defines `[p]`, `[link][p]` survives
 * exactly when liveness keeps `P` alive.
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
		serializeOne,
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

describe("PR-R49-A math-sentinel emission parity, PHP extract_math list scan, blank-item padding", () => {
	describe("1. One `emitWithMathSentinelAtDepth` for liveness tails and serializer (Track B #1, P0)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"F1 trackB#1 depth1",
				'> -   alpha\n> -   beta\n>\n>   > [p]: /u\n>   > "t\n>   > ===\n\n[link][p]',
				appendInlineMath("beta", "\\(x\n-    fake\ny\\)"),
				'> -   alpha\n> - beta\\(x\n-    fake\ny\\)\n>\n> > [p]: /u\n> > "t\n> > ===\n\n[link][p]',
				["P"],
			],
			[
				"F1 depth2",
				'> > -   alpha\n> > -   beta\n> >\n> >   > [p]: /u\n> >   > "t\n> >   > ===\n\n[link][p]',
				appendInlineMath("beta", "\\(x\n-    fake\ny\\)"),
				'> > -   alpha\n> > - beta\\(x\n-    fake\ny\\)\n> >\n> > > [p]: /u\n> > > "t\n> > > ===\n\n[link][p]',
				["P"],
			],
			[
				"F1 depth0",
				'-   alpha\n-   beta\n\n  > [p]: /u\n  > "t\n  > ===\n\n[link][p]',
				appendInlineMath("beta", "\\(x\n-    fake\ny\\)"),
				'-   alpha\n- beta\\(x\n-    fake\ny\\)\n\n> [p]: /u\n> "t\n> ===\n\n[link][p]',
				["P"],
			],
			[
				"F1 nested bq depth1 containing list depth2",
				"> > -   alpha\n> > -   beta\n>\n> after\n\n[link][p]\n\n[p]: /u",
				appendInlineMath("beta", "\\(x\n-    fake\ny\\)"),
				"> > -   alpha\n> > - beta\\(x\n-    fake\ny\\)\n>\n> after\n\n[link][p]\n\n[p]: /u",
				[],
			],
		];
		runCases(cases);

		it("leaves multiline math newlines unprefixed at depth >= 1 and is a pass-through at depth 0", () => {
			const para = parser
				.parseMarkdownToVisualDoc("a \\(x\n-    fake\ny\\)")
				.child(0);
			const render = (token: string | undefined): string =>
				serializeVisualDocToMarkdown(
					visualEditorSchema.nodes.doc.create(null, [para]),
				).replace(/\n/g, token ?? "\n");
			expect(emitWithMathSentinelAtDepth(para, 0, render)).toBe(
				render(undefined),
			);
			const tokens: Array<string | undefined> = [];
			const emitted = emitWithMathSentinelAtDepth(para, 2, (token) => {
				tokens.push(token);
				return render(token);
			});
			expect(tokens).toHaveLength(1);
			expect(typeof tokens[0]).toBe("string");
			expect(emitted).toBe(`> > ${render(undefined)}`);
		});
	});

	describe("2. PHP `extract_math()` collapses multiline math before the list scan (Track B #2, P1)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"F2 depth0 bullet",
				"- first\n- second \\(\n-    fake\n  \\)\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"- first\n- second \\(\n-    fake\n  \\)\n\npara",
				[],
			],
			[
				"F2 depth1 bullet",
				"> - first\n> - second \\(\n> -    fake\n>   \\)\n>\n> drop\n>\n>   para",
				deleteParagraph("drop"),
				"> - first\n> - second \\(\n> -    fake\n>   \\)\n>\n> para",
				[],
			],
			[
				"F2 ordered",
				"1. first\n2. second \\(\n2.    fake\n   \\)\n\ndrop\n\n   para",
				deleteParagraph("drop"),
				"1. first\n2. second \\(\n2.    fake\n   \\)\n\npara",
				[],
			],
			[
				"F2 depth1 refdef edit",
				'> -   alpha\n> -   beta \\(x\n> -    fake\n> y\\)\n>\n>   > [p]: /u\n>   > "t\n>   > ===\n\n[link][p]',
				replaceText("beta", "edited"),
				'> - alpha\n> - edited \\(x\n> -    fake\n> y\\)\n>\n> > [p]: /u\n> > "t\n> > ===\n\n[link][p]',
				["P"],
			],
		];
		runCases(cases);
	});

	describe("3. Full-line scan of an intact shared group ending with a list (Track B #3, P1)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"F3 1",
				"$$a$$- item\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"$$a$$- item\n\npara",
				[],
			],
			[
				"F3 2",
				"$$a$$-\titem\n\ndrop\n\n    para",
				deleteParagraph("drop"),
				"$$a$$-\titem\n\n```\npara\n```",
				[],
			],
			[
				"F3 3",
				"$$a$$- item\n  - nested\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"$$a$$- item\n  - nested\n\npara",
				[],
			],
			[
				"F3 4",
				'$$a$$- item\n\ndrop\n\n  [p]: /u\n  "t\n  ===\n\n[link][p]',
				deleteParagraph("drop"),
				'$$a$$- item\n\n[p]: /u\n  "t\n  ===\n\n[link][p]',
				["P"],
			],
			[
				"F3 5",
				"$$a$$1. item\n\ndrop\n\n   para",
				deleteParagraph("drop"),
				"$$a$$1. item\n\npara",
				[],
			],
			[
				"F3 6",
				"\\[a\\]- item\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"\\[a\\]- item\n\npara",
				[],
			],
			[
				"F3 7",
				"$$\na\n$$- item\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"$$\na\n$$- item\n\npara",
				[],
			],
			[
				"F3 8",
				"foo$$a$$- item\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"foo$$a$$- item\n\npara",
				[],
			],
			[
				"F3 bq",
				"> $$a$$- item\n>\n> drop\n>\n>   para",
				deleteParagraph("drop"),
				">\n\n$$a$$\n\n- item\n\n>   para",
				[],
			],
		];
		runCases(cases);
	});

	describe("4. `league/commonmark@2.8.2` single-code-point blank-item padding (Track A #1, Track B #4)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"F4 trackA d1",
				">\t-\ta\n>\n> drop\n>\n>\t  [p]: /u\n\n[link][p]",
				deleteParagraph("drop"),
				">\t-\ta\n>\n> ```\n> [p]: /u\n> ```\n\n[link][p]",
				[],
			],
			[
				"F4 trackA d2",
				"> >\t-\ta\n> >\n> > drop\n> >\n> >\t  [p]: /u\n\n[link][p]",
				deleteParagraph("drop"),
				"> >\t-\ta\n> >\n> > [p]: /u\n\n[link][p]",
				[],
			],
			[
				"F4 trackA d3",
				"> > >\t-\ta\n> > >\n> > > drop\n> > >\n> > >\t  [p]: /u\n\n[link][p]",
				deleteParagraph("drop"),
				"> > >\t-\ta\n> > >\n> > > ```\n> > > [p]: /u\n> > > ```\n\n[link][p]",
				[],
			],
			[
				"F4 x",
				"-   x\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"-   x\n\npara",
				[],
			],
			[
				"F4 cjk",
				"-   中\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"-   中\n\npara",
				[],
			],
			[
				"F4 emoji",
				"-   😀\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"-   😀\n\npara",
				[],
			],
			[
				"F4 bq x",
				"> -   x\n>\n> drop\n>\n>   para",
				deleteParagraph("drop"),
				"> -   x\n>\n> para",
				[],
			],
			[
				"F4 bq 1.tab",
				"> 1.\tx\n>\n> drop\n>\n>    para",
				deleteParagraph("drop"),
				"> 1.\tx\n>\n> para",
				[],
			],
			[
				"F4 bq refdef",
				'> -   x\n>\n> drop\n>\n>   > [p]: /u\n>   > "t\n>   > ===\n\n[link][p]',
				deleteParagraph("drop"),
				'> -   x\n>\n> > [p]: /u\n> > "t\n> > ===\n\n[link][p]',
				["P"],
			],
			[
				"F4 x trailing space",
				"-   x \n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"-   x \n\n  para",
				[],
			],
			[
				"F4 xy control",
				"-   xy\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"-   xy\n\n  para",
				[],
			],
		];
		runCases(cases);

		it("applies `markerOffset + markerLength + 1` only to an exactly single-code-point first line", () => {
			const swallows = (listMd: string, next: string, depth = 0): boolean => {
				let list = parser.parseMarkdownToVisualDoc(listMd).child(0);
				for (let d = 0; d < depth; d += 1) list = list.child(0);
				expect(list.type.name).toMatch(/_list$/);
				return isListSwallowingFollowingBlock(
					list,
					() => listMd,
					next,
					depth,
					false,
					false,
				);
			};
			expect(swallows("-   x", "  para")).toBe(true);
			expect(swallows("-   😀", "  para")).toBe(true);
			expect(swallows("-   x ", "  para")).toBe(false);
			expect(swallows("-   xy", "  para")).toBe(false);
			expect(swallows("> 1.\tx", ">    para", 1)).toBe(true);
			expect(swallows(">\t-\ta", ">\t  [p]: /u", 1)).toBe(true);
		});
	});

	describe("5. Local structural redundancies (Track B #5, P2)", () => {
		it("evaluateSlotJoin reads a preserved slot's emitted source at most once", () => {
			const doc = parser.parseMarkdownToVisualDoc("- x\n\npara");
			expect(doc.child(0).type.name).toBe("bullet_list");
			let reads = 0;
			const st = {
				partialTitleRefNodes: new Set<ProseMirrorNode>(),
				serializeBlock: serializeOne,
			} as unknown as LivenessState;
			const cs = {
				container: doc,
				defaultBlankSep: "\n\n",
				depth: 0,
				effectiveOrigIndex: [0, 1],
				emittedAt: [
					() => {
						reads += 1;
						return "- x";
					},
					null,
				],
				matchedOrigIndex: [0, 1],
				partialTitleRechecks: [],
				recheckSlot: () => undefined,
				slotState: ["preserved-container", "verbatim"],
				source: {
					blocks: [
						{ node: doc.child(0), raw: "- x", separatorBefore: "" },
						{ node: doc.child(1), raw: "  para", separatorBefore: "\n" },
					],
					leadingPrefix: "",
					trailingSuffix: "",
				},
			} as unknown as ContainerState;
			const risks = evaluateSlotJoin(st, cs, 1, "  para", 1, undefined);
			// Both the list-swallow escalation and the swallow risk (which also
			// needs the depth-stripped previous text) were evaluated.
			expect(risks.separator).toBe("\n\n");
			expect(risks.swallowRisk).toBe(true);
			expect(reads).toBe(1);
		});

		it("stripBlockquoteDepthWithColumn matches the container-step cursor across tabs and depths", () => {
			const lines = [
				"> a",
				">a",
				">\ta",
				"  >\t\ta",
				"> >\t-\ta",
				">\t>\t  b",
				"   > > > c",
				"    > d",
				"plain",
				"",
				">",
				"> > ",
			];
			const blockquote: ContainerStep = { kind: "blockquote" };
			for (const line of lines) {
				for (let depth = 0; depth <= 3; depth += 1) {
					const steps = new Array<ContainerStep>(depth).fill(blockquote);
					const expected = stripContainersWithColumn(line, steps);
					const actual = stripBlockquoteDepthWithColumn(line, depth);
					if (expected === null) {
						expect(actual.matched, `${line} @${depth}`).toBeLessThan(depth);
						expect(stripBlockquoteDepth(line, depth)).toBeNull();
					} else {
						expect(actual.matched).toBe(depth);
						expect({ column: actual.column, rest: actual.rest }).toEqual({
							column: expected.column,
							rest: expected.rest,
						});
						expect(stripBlockquoteDepth(line, depth)).toBe(expected.rest);
					}
				}
			}
		});
	});

	describe("6. Additional real-PHP differentials (nested depths, block math, code spans)", () => {
		const cases: ReadonlyArray<Case> = [
			[
				"multi item after non-list",
				"para0\n\n- a\n- b\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"para0\n\n- a\n- b\n\npara",
				[],
			],
			[
				"bq block math in list",
				"> - a\n> $$\n> -    fake\n> $$\n>\n> drop\n>\n>   para",
				deleteParagraph("drop"),
				"> - a\n> $$\n> -    fake\n> $$\n>\n>   para",
				[],
			],
			[
				"d0 block math in list",
				"- a $$\n-    fake\n$$\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"- a $$\n-    fake\n$$\n\n  para",
				[],
			],
			[
				"d2 inline multiline",
				"> > - first\n> > - second \\(\n> > -    fake\n> >   \\)\n> >\n> > drop\n> >\n> >   para",
				deleteParagraph("drop"),
				"> > - first\n> > - second \\(\n> > -    fake\n> >   \\)\n> >\n> > para",
				[],
			],
			[
				"d1 shared group list",
				"> $$a$$- item\n> - two\n>\n> drop\n>\n>   para",
				deleteParagraph("drop"),
				"> $$a$$- item\n> - two\n>\n> para",
				[],
			],
			[
				"nested bq tail list",
				"> > - a\n> > - b\n>\n> drop\n>\n>   para",
				deleteParagraph("drop"),
				"> > - a\n> > - b\n>\n>   para",
				[],
			],
			[
				"d0 x then para 2col",
				"-   x\n\ndrop\n\n para",
				deleteParagraph("drop"),
				"-   x\n\n para",
				[],
			],
			[
				"ordered 10. single",
				"10.  x\n\ndrop\n\n    para",
				deleteParagraph("drop"),
				"10.  x\n\n```\npara\n```",
				[],
			],
			[
				"emoji + text",
				"-   😀a\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"-   😀a\n\n  para",
				[],
			],
			[
				"code span math",
				"- `$$` a\n-    b\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"- `$$` a\n-    b\n\npara",
				[],
			],
			[
				"plus marker single",
				"+   y\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"+   y\n\npara",
				[],
			],
			[
				"raw-inline d1",
				'> -   alpha\n> -   beta\n>\n>   > [p]: /u\n>   > "t\n>   > ===\n\n[link][p]',
				appendInlineMath("beta", "\\(a\nb\\)"),
				'> -   alpha\n> - beta\\(a\nb\\)\n>\n> > [p]: /u\n> > "t\n> > ===\n\n[link][p]',
				["P"],
			],
			[
				"canonical list in bq",
				"> - alpha\n> - beta\n>\n> drop\n\n[link][p]\n\n[p]: /u",
				replaceText("beta", "gamma"),
				"> - alpha\n> - gamma\n>\n> drop\n\n[link][p]\n\n[p]: /u",
				[],
			],
			[
				"ordered paren single",
				"1)   z\n\ndrop\n\n  para",
				deleteParagraph("drop"),
				"1)   z\n\n  para",
				[],
			],
			// Multiline `raw-inline` atoms: liveness (driven by the production
			// `serializeBlock` + `serializeBlockWithRefs`, forwarding the
			// math-newline sentinel) and `guard.serialize()` agree 100%.
			[
				"raw-inline multiline d1",
				'> -   alpha\n> -   beta\n>\n>   > [p]: /u\n>   > "t\n>   > ===\n\n[link][p]',
				appendInlineMath("beta", "<span\n-    fake\n>", "raw-inline"),
				'> -   alpha\n> - beta<span\n-    fake\n>\n>\n> > [p]: /u\n> > "t\n> > ===\n\n[link][p]',
				["P"],
			],
			[
				"raw-inline multiline d0",
				'-   alpha\n-   beta\n\n  > [p]: /u\n  > "t\n  > ===\n\n[link][p]',
				appendInlineMath("beta", "<span\n-    fake\n>", "raw-inline"),
				'-   alpha\n- beta<span\n-    fake\n>\n\n  > [p]: /u\n  > "t\n  > ===\n\n[link][p]',
				["P"],
			],
		];
		runCases(cases);
	});
});
