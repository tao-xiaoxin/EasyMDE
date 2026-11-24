import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	EditorState,
	NodeSelection,
	type Selection,
	TextSelection,
	type Transaction,
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { describe, expect, it } from "vitest";
import { parseMarkdownToVisualDoc } from "./markdown-parser";
import { serializeVisualDocToMarkdown } from "./markdown-serializer";
import {
	ATOMIC_SELECTION_ANCHOR_ATTRIBUTE,
	createAtomicSelectionAnchorPlugin,
	createBoundaryKeyBindings,
} from "./visual-boundary-commands";
import { visualEditorSchema } from "./visual-schema";
import { createVisualSourceIndex } from "./visual-source-index";
import {
	computeVisualSelectionToMarkdownSelection,
	findAtomSourceRange,
	mapPmPosToMarkdown,
} from "./visual-source-mapping";

const NODES = visualEditorSchema.nodes;
const MATH_BLOCK = "$$\nE = mc^2\n$$";

/** Position of the first top-level child of `typeName`. */
function topLevelPos(doc: ProseMirrorNode, typeName: string): number {
	let found = -1;
	doc.forEach((child, offset) => {
		if (found < 0 && child.type.name === typeName) found = offset;
	});
	if (found < 0) throw new Error(`No top-level ${typeName}`);
	return found;
}

function topLevelTypes(doc: ProseMirrorNode): string[] {
	const types: string[] = [];
	doc.forEach((child) => {
		types.push(child.type.name);
	});
	return types;
}

function stateFor(doc: ProseMirrorNode, selection?: Selection): EditorState {
	return EditorState.create(
		selection
			? { doc, schema: visualEditorSchema, selection }
			: { doc, schema: visualEditorSchema },
	);
}

function runKey(state: EditorState, key: "Backspace" | "Delete"): EditorState {
	const command = createBoundaryKeyBindings()[key];
	if (!command) throw new Error(`Missing ${key} binding`);
	let next = state;
	command(state, (tr: Transaction) => {
		next = state.apply(tr);
	});
	return next;
}

/** Native in-text Backspace deletes one character; boundaries use the keymap. */
function pressBackspace(state: EditorState): EditorState {
	const { selection } = state;
	if (
		selection instanceof TextSelection &&
		selection.empty &&
		selection.$from.parent.isTextblock &&
		selection.$from.parentOffset > 0
	) {
		return state.apply(state.tr.delete(selection.from - 1, selection.from));
	}
	return runKey(state, "Backspace");
}

function expectAtomRange(markdown: string, typeName: string, raw: string) {
	const doc = parseMarkdownToVisualDoc(markdown);
	const index = createVisualSourceIndex(doc, markdown);
	const pos = topLevelPos(doc, typeName);
	const block = index.blocks.find((entry) => entry.pmPos === pos);
	if (!block) throw new Error("Missing source block");
	expect(block.pmEnd).toBe(pos + 1);
	const selection = computeVisualSelectionToMarkdownSelection(
		doc,
		NodeSelection.create(doc, pos),
		markdown,
		index,
	);
	expect(selection).toEqual({
		direction: "none",
		end: block.mdEnd,
		start: block.mdStart,
	});
	expect(markdown.slice(selection.start, selection.end)).toBe(raw);
	expect(mapPmPosToMarkdown(index, pos + 1, "after-prev")).toBe(block.mdEnd);
	expect(mapPmPosToMarkdown(index, pos + 1, "before-next")).toBeGreaterThan(
		block.mdEnd,
	);
}

describe("visual atom source mapping (Bug P1)", () => {
	it("maps a horizontal_rule NodeSelection to its exact line", () => {
		expectAtomRange("before\n\n---\n\nafter", "horizontal_rule", "---");
	});

	it("maps an indented, padded horizontal_rule to its exact raw line", () => {
		const markdown = "before\n\n  ---  \nafter";
		expectAtomRange(markdown, "horizontal_rule", "  ---  ");
		const doc = parseMarkdownToVisualDoc(markdown);
		const range = findAtomSourceRange(
			createVisualSourceIndex(doc, markdown),
			topLevelPos(doc, "horizontal_rule"),
		);
		expect(range).toEqual({ end: 15, start: 8 });
	});

	it("maps a protected_block NodeSelection to its exact source", () => {
		expectAtomRange(
			`before\n\n${MATH_BLOCK}\n\nafter`,
			"protected_block",
			MATH_BLOCK,
		);
	});

	it("still maps inline image atoms inside their containing block", () => {
		const markdown = "lead ![alt](https://example.com/a.png) tail";
		const doc = parseMarkdownToVisualDoc(markdown);
		let imagePos = -1;
		doc.descendants((node, pos) => {
			if (imagePos < 0 && node.type === NODES.image) imagePos = pos;
		});
		expect(imagePos).toBeGreaterThan(0);
		const range = findAtomSourceRange(
			createVisualSourceIndex(doc, markdown),
			imagePos,
		);
		expect(range).not.toBeNull();
		if (!range) return;
		expect(markdown.slice(range.start, range.end)).toBe(
			"![alt](https://example.com/a.png)",
		);
	});
});

describe("atomic DOM span to NodeSelection (Bug P2)", () => {
	const plugin = createAtomicSelectionAnchorPlugin();
	const between = plugin.props.createSelectionBetween;
	function select(doc: ProseMirrorNode, anchor: number, head: number) {
		if (!between) throw new Error("Missing createSelectionBetween");
		const view = { state: stateFor(doc) } as unknown as EditorView;
		return between.call(plugin, view, doc.resolve(anchor), doc.resolve(head));
	}

	for (const [label, markdown, typeName] of [
		["horizontal_rule", "a\n\n---\n\nb", "horizontal_rule"],
		["protected_block", `a\n\n${MATH_BLOCK}\n\nb`, "protected_block"],
	] as const) {
		it(`converts a forward and backward span over a ${label}`, () => {
			const doc = parseMarkdownToVisualDoc(markdown);
			const pos = topLevelPos(doc, typeName);
			for (const [anchor, head] of [
				[pos, pos + 1],
				[pos + 1, pos],
			]) {
				const selection = select(doc, anchor as number, head as number);
				expect(selection).toBeInstanceOf(NodeSelection);
				expect(selection?.from).toBe(pos);
				expect(selection?.to).toBe(pos + 1);
			}
		});
	}

	it("ignores paragraphs, multi-block spans, and collapsed positions", () => {
		const doc = parseMarkdownToVisualDoc("a\n\n---\n\nb");
		const hr = topLevelPos(doc, "horizontal_rule");
		const paragraphEnd = (doc.firstChild as ProseMirrorNode).nodeSize;
		expect(select(doc, 0, paragraphEnd)).toBeNull();
		expect(select(doc, 0, hr + 1)).toBeNull();
		expect(select(doc, hr, hr + 2 + 1)).toBeNull();
		expect(select(doc, hr, hr)).toBeNull();
		expect(select(doc, 1, 2)).toBeNull();
	});
});

describe("Backspace/Delete around atom blocks (Fixes A & B)", () => {
	it("repeated Backspace from EOF clears every char and block", () => {
		const markdown = `# Title\n\npara\n\n---\n\n---\n\n---\n\n${MATH_BLOCK}\n\nabc`;
		const doc = parseMarkdownToVisualDoc(markdown);
		expect(topLevelTypes(doc)).toEqual([
			"heading",
			"paragraph",
			"horizontal_rule",
			"horizontal_rule",
			"horizontal_rule",
			"protected_block",
			"paragraph",
		]);
		let state = stateFor(doc, TextSelection.atEnd(doc));
		let previousCount = doc.childCount;
		let steps = 0;
		while (
			state.doc.textContent !== "" ||
			state.doc.childCount > 1 ||
			state.doc.firstChild?.type !== NODES.paragraph
		) {
			const next = pressBackspace(state);
			expect(next).not.toBe(state);
			state = next;
			steps += 1;
			expect(steps).toBeLessThan(60);
			const types = topLevelTypes(state.doc);
			expect(state.doc.childCount).toBeLessThanOrEqual(previousCount);
			previousCount = state.doc.childCount;
			let emptyParagraphs = 0;
			state.doc.forEach((child) => {
				if (child.type === NODES.paragraph && child.content.size === 0)
					emptyParagraphs += 1;
			});
			expect(emptyParagraphs, types.join(",")).toBeLessThanOrEqual(1);
		}
		expect(topLevelTypes(state.doc)).toEqual(["paragraph"]);
		expect(serializeVisualDocToMarkdown(state.doc).trim()).toBe("");
	});

	it("deleting a protected_block below an HR lands on the HR", () => {
		const doc = parseMarkdownToVisualDoc(
			`top\n\n---\n\n${MATH_BLOCK}\n\nbottom`,
		);
		const hr = topLevelPos(doc, "horizontal_rule");
		const block = topLevelPos(doc, "protected_block");
		let state = runKey(
			stateFor(doc, NodeSelection.create(doc, block)),
			"Backspace",
		);
		expect(topLevelTypes(state.doc)).toEqual([
			"paragraph",
			"horizontal_rule",
			"paragraph",
		]);
		expect(state.selection).toBeInstanceOf(NodeSelection);
		expect(state.selection.from).toBe(hr);
		state = runKey(state, "Backspace");
		expect(topLevelTypes(state.doc)).toEqual(["paragraph", "paragraph"]);
		expect(state.selection).toBeInstanceOf(TextSelection);
		expect(state.selection.$from.parent.textContent).toBe("top");
		expect(serializeVisualDocToMarkdown(state.doc).trim()).toBe(
			"top\n\nbottom",
		);
	});

	it("Backspace in an empty paragraph after an HR removes the paragraph", () => {
		const doc = NODES.doc.create(null, [
			NODES.paragraph.create(null, visualEditorSchema.text("top")),
			NODES.horizontal_rule.create(),
			NODES.paragraph.create(),
			NODES.paragraph.create(null, visualEditorSchema.text("bottom")),
		]);
		const hr = topLevelPos(doc, "horizontal_rule");
		const state = runKey(
			stateFor(doc, TextSelection.create(doc, hr + 2)),
			"Backspace",
		);
		expect(topLevelTypes(state.doc)).toEqual([
			"paragraph",
			"horizontal_rule",
			"paragraph",
		]);
		expect(state.selection).toBeInstanceOf(NodeSelection);
		expect(state.selection.from).toBe(hr);
	});

	it("Backspace at the start of a non-empty paragraph selects the HR", () => {
		const doc = parseMarkdownToVisualDoc("top\n\n---\n\nkeep");
		const hr = topLevelPos(doc, "horizontal_rule");
		const state = runKey(
			stateFor(doc, TextSelection.create(doc, hr + 2)),
			"Backspace",
		);
		expect(state.doc.eq(doc)).toBe(true);
		expect(state.selection).toBeInstanceOf(NodeSelection);
		expect(state.selection.from).toBe(hr);
	});

	it("Delete in an empty paragraph before an HR lands on the HR", () => {
		const doc = NODES.doc.create(null, [
			NODES.paragraph.create(null, visualEditorSchema.text("top")),
			NODES.paragraph.create(),
			NODES.horizontal_rule.create(),
			NODES.paragraph.create(null, visualEditorSchema.text("bottom")),
		]);
		const emptyStart = (doc.firstChild as ProseMirrorNode).nodeSize;
		const state = runKey(
			stateFor(doc, TextSelection.create(doc, emptyStart + 1)),
			"Delete",
		);
		expect(topLevelTypes(state.doc)).toEqual([
			"paragraph",
			"horizontal_rule",
			"paragraph",
		]);
		expect(state.selection).toBeInstanceOf(NodeSelection);
		expect(state.selection.from).toBe(emptyStart);
		expect(state.selection.to).toBe(emptyStart + 1);
	});
});

describe("editable anchor beside a textless textblock (Bug 2)", () => {
	function anchorCountFor(markdown: string, typeName: string): number {
		const doc = parseMarkdownToVisualDoc(markdown);
		const host = document.createElement("div");
		document.body.appendChild(host);
		const view = new EditorView(host, {
			state: EditorState.create({
				doc,
				plugins: [createAtomicSelectionAnchorPlugin()],
				schema: visualEditorSchema,
				selection: NodeSelection.create(doc, topLevelPos(doc, typeName)),
			}),
		});
		try {
			return view.dom.querySelectorAll(
				`[${ATOMIC_SELECTION_ANCHOR_ATTRIBUTE}="1"]`,
			).length;
		} finally {
			view.destroy();
			host.remove();
		}
	}

	it("anchors an EOF rule preceded by an image-only paragraph", () => {
		const markdown = "![alt](https://example.test/a.png)\n\n---";
		expect(topLevelTypes(parseMarkdownToVisualDoc(markdown))).toEqual([
			"paragraph",
			"horizontal_rule",
		]);
		expect(anchorCountFor(markdown, "horizontal_rule")).toBe(1);
	});

	it("anchors a rule between an image-only paragraph and another rule", () => {
		expect(
			anchorCountFor(
				"![alt](https://example.test/a.png)\n\n---\n\n---",
				"horizontal_rule",
			),
		).toBe(1);
	});

	it("keeps no anchor for a protected block after text and before a rule", () => {
		expect(anchorCountFor("Intro\n\n$$\nx\n$$\n\n---", "protected_block")).toBe(
			0,
		);
	});
});
