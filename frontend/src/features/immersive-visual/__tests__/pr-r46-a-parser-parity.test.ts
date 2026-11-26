import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { evaluateMatchedContainerHeadRisk } from "../markdown-container-head-line";
import {
	parseMarkdownToVisualDoc,
	parseMarkdownWithBlockSources,
} from "../markdown-parser";
import { computeIntactRefDefLabels } from "../markdown-refdef-liveness";
import {
	createMarkdownRoundTripGuard,
	serializeVisualDocToMarkdown,
} from "../markdown-serializer";
import { visualEditorSchema } from "../visual-schema";

// Every original document and expected serialization below was rendered with
// real PHP `EasyMDE\Content\MarkdownRenderer::render()`: each pair produces
// the same HTML except for the intended edit (and the inlined link of a
// deleted reference definition).

function serializeOne(node: ProseMirrorNode): string {
	return serializeVisualDocToMarkdown(
		visualEditorSchema.nodes.doc.create(null, [node]),
	);
}

function collectLinkTitles(markdown: string): unknown[] {
	const titles: unknown[] = [];
	parseMarkdownToVisualDoc(markdown).descendants((node) => {
		const link = node.marks.find((m) => m.type.name === "link");
		if (link && node.isText) titles.push(link.attrs.title);
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

function roundTrip(
	md: string,
	edit: (doc: ProseMirrorNode) => ProseMirrorNode,
): Readonly<{ partialTitleIntact: string[]; serialized: string }> {
	const parsed = parseMarkdownWithBlockSources(md);
	const guard = createMarkdownRoundTripGuard(md, parsed);
	const edited = edit(guard.initialDoc);
	const live = computeIntactRefDefLabels(edited, parsed, serializeOne);
	return {
		partialTitleIntact: [...live.partialTitleIntact],
		serialized: guard.serialize(edited),
	};
}

const PAIRED_BLOCKQUOTE_DOC =
	'[dead]: /d\n\n-   [dead]\n\n   > keep\n   >\n   > # gamma\n$$y$$ [p]: /u\n"t\n===\n\n[link][p]';
const PAIRED_TAIL = '\n\n$$y$$\n\n[p]: /u\n\n"t\n===\n\n[link](/u "t&#10;")';

const editGammaAndDropDead = (doc: ProseMirrorNode): ProseMirrorNode =>
	withChild(replaceText(doc, "gamma", "delta"), 0, null);

describe("PR-R46-A canonical effective index, staged list reuse, shared head risk, and 9-digit ordered markers", () => {
	describe("1. A risk-downgraded preserved container drops its paired effective index (Track B #1)", () => {
		it("1.1 paired blockquote: the following shared group breaks and [link][p] inlines its PHP title", () => {
			const { partialTitleIntact, serialized } = roundTrip(
				PAIRED_BLOCKQUOTE_DOC,
				editGammaAndDropDead,
			);
			expect(serialized).toBe(
				`- [dead](/d)\n\n> keep\n>\n> # delta${PAIRED_TAIL}`,
			);
			// PHP: `<a href="/u" title="t\n">link</a>` on both sides.
			expect(partialTitleIntact).toEqual([]);
			expect(collectLinkTitles(serialized)).toContain("t\n");
		});

		it("1.2 paired list: the identical edit inlines [link][p]'s PHP title", () => {
			const md = PAIRED_BLOCKQUOTE_DOC.replace(
				"   > keep\n   >\n   > # gamma",
				"   1. keep\n   2. # gamma",
			);
			const { partialTitleIntact, serialized } = roundTrip(
				md,
				editGammaAndDropDead,
			);
			expect(serialized).toBe(
				`- [dead](/d)\n\n1. keep\n2.\n   # delta${PAIRED_TAIL}`,
			);
			expect(partialTitleIntact).toEqual([]);
			expect(collectLinkTitles(serialized)).toContain("t\n");
		});
	});

	describe("2. `allowShift = false` fallback items downgrade only after item 0 (Track B #2)", () => {
		it("2.1 a fallback-only [p2] item survives once [p0]'s item 0 is committed canonically", () => {
			const md = [
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
				"",
				"   > untouched [link2][p2]",
			].join("\n");
			const { partialTitleIntact, serialized } = roundTrip(
				md,
				dropFirstOrderedItem,
			);
			expect(serialized).toBe(
				[
					"[ok]: /ok",
					"",
					"1. [p0]: /p0",
					"",
					'   "[ok](/ok)" x',
					"   \\- sub",
					"2. [p2]: /p2",
					'   "t2',
					"   ===",
					"",
					"-   [p2]",
					"",
					"   > untouched [link2][p2]",
				].join("\n"),
			);
			// PHP keeps `title="t2\n"` on both untouched [p2] uses.
			expect(partialTitleIntact).toEqual(["P2"]);
		});
	});

	describe("3. One authoritative matched-head risk evaluation (Track B #3)", () => {
		it("3.1 an unindented head line never carries indented or swallow risk", () => {
			const doc = parseMarkdownToVisualDoc("- a\n\n> b");
			const risks = evaluateMatchedContainerHeadRisk({
				baselineBlocks: [],
				child: doc.child(1),
				defaultBlankSep: "\n\n",
				depth: 0,
				effIdx: -1,
				groupSep: undefined,
				headLine: "> b",
				isPartialTitleRefDef: null,
				prevEffIdx: -1,
				prevInnerText: () => "- a",
				prevNode: doc.child(0),
				prevWasVerbatimAdjacent: false,
			});
			expect(risks).toEqual({
				indentedRisk: false,
				separator: "\n\n",
				swallowRisk: false,
			});
		});

		it("3.2 an indented head line after a canonical list is swallow-risky", () => {
			const doc = parseMarkdownToVisualDoc("- a\n\n> b");
			const risks = evaluateMatchedContainerHeadRisk({
				baselineBlocks: [],
				child: doc.child(1),
				defaultBlankSep: "\n\n",
				depth: 0,
				effIdx: -1,
				groupSep: undefined,
				headLine: "   > b",
				isPartialTitleRefDef: null,
				prevEffIdx: -1,
				prevInnerText: () => "- a",
				prevNode: doc.child(0),
				prevWasVerbatimAdjacent: false,
			});
			expect(risks.swallowRisk).toBe(true);
		});
	});

	describe("4. Canonical ordered markers respect the 9-digit CommonMark maximum (Track A #1)", () => {
		it("4.1 an item past 999999999 restarts at `1.` so PHP keeps 2 <li> items", () => {
			const { serialized } = roundTrip(
				"- a\n\n999999999. [d]: /d\n  2. [d]\n3. x",
				dropFirstOrderedItem,
			);
			// PHP: `<ol start="999999999">` with `<li>[d]</li>` and `<li>x</li>`.
			expect(serialized).toBe("- a\n\n999999999. [d](/d)\n1. x");
		});

		it("4.2 continuation lines indent to the emitted `1. ` marker width (3 columns)", () => {
			const { serialized } = roundTrip(
				"- a\n\n999999999. [d]: /d\n  2. [d]\n3. x\n\n   more",
				dropFirstOrderedItem,
			);
			expect(serialized).toBe("- a\n\n999999999. [d](/d)\n\n1. x\n\n   more");
		});

		it("4.3 every overflowing item uses `1.`", () => {
			const { serialized } = roundTrip(
				"- a\n\n999999999. [d]: /d\n  2. [d]\n3. x\n4. y",
				dropFirstOrderedItem,
			);
			expect(serialized).toBe("- a\n\n999999999. [d](/d)\n1. x\n1. y");
		});
	});
});
