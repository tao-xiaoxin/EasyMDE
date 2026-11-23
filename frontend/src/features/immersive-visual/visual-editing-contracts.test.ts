import { history } from "prosemirror-history";
import {
	Fragment,
	type Node as ProseMirrorNode,
	Slice,
} from "prosemirror-model";
import {
	EditorState,
	NodeSelection,
	type Plugin,
	TextSelection,
} from "prosemirror-state";
import { CellSelection, isInTable, TableMap } from "prosemirror-tables";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	VisualEditorImageTargetIndex,
	VisualEditorMarkdownImageScaleMatch,
} from "../../contracts/visual-editor";
import type { EditorDocumentSession } from "../document-source/editor-document-session";
import { parseMarkdownToVisualDoc } from "./markdown-parser";
import { serializeVisualDocToMarkdown } from "./markdown-serializer";
import {
	parseTableAlignComment,
	reconcileTableAlignComment,
	type TableAlignEntry,
	validateTableAlignEntries,
} from "./table-alignment-codec";
import type { VisualCanonicalSync } from "./visual-canonical-sync";
import {
	createVisualClipboardPlugin,
	type VisualClipboardPluginOptions,
} from "./visual-clipboard-and-paste";
import { createVisualKeymapPlugins } from "./visual-commands";
import { createProseMirrorVisualRuntime } from "./visual-context-menu-adapter";
import { createVisualInputRulesPlugin } from "./visual-input-rules";
import { type TableTextAlign, visualEditorSchema } from "./visual-schema";
import {
	backspaceAtTableCellBoundary,
	createVisualTablePlugin,
	deleteAtTableCellBoundary,
} from "./visual-table-operations";

const mountedViews: EditorView[] = [];

afterEach(() => {
	while (mountedViews.length > 0) {
		const view = mountedViews.pop();
		if (view) {
			view.destroy();
			view.dom.parentElement?.remove();
		}
	}
});

function createView(
	markdown: string,
	clipboardOptions?: VisualClipboardPluginOptions,
): EditorView {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const plugins: Plugin[] = [
		history(),
		createVisualInputRulesPlugin(),
		createVisualClipboardPlugin(clipboardOptions ?? {}),
		createVisualTablePlugin(),
		...createVisualKeymapPlugins(),
	];
	const view = new EditorView(host, {
		state: EditorState.create({
			doc: parseMarkdownToVisualDoc(markdown),
			plugins,
			schema: visualEditorSchema,
		}),
	});
	mountedViews.push(view);
	return view;
}

function dispatchKey(view: EditorView, key: string): boolean {
	const event = new KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		key,
	});
	let handled = false;
	view.someProp("handleKeyDown", (handler) => {
		if (handler(view, event)) {
			handled = true;
			return true;
		}
		return false;
	});
	return handled;
}

function typeText(view: EditorView, text: string): void {
	for (const character of text) {
		const { from, to } = view.state.selection;
		let handled = false;
		view.someProp("handleTextInput", (handler) => {
			if (
				handler(view, from, to, character, () =>
					view.state.tr.insertText(character, from, to),
				)
			) {
				handled = true;
				return true;
			}
			return false;
		});
		if (!handled) {
			view.dispatch(view.state.tr.insertText(character, from, to));
		}
	}
}

function placeCaret(view: EditorView, position: number): void {
	view.dispatch(
		view.state.tr.setSelection(TextSelection.create(view.state.doc, position)),
	);
}

type TableLayout = Readonly<{
	height: number;
	tableNode: ProseMirrorNode;
	tablePos: number;
	tableStart: number;
	width: number;
}>;

function readFirstTable(doc: ProseMirrorNode): TableLayout {
	const found: { node: ProseMirrorNode | null; pos: number } = {
		node: null,
		pos: -1,
	};
	doc.descendants((node, pos) => {
		if (found.node !== null) return false;
		if (node.type.name !== "table") return true;
		found.node = node;
		found.pos = pos;
		return false;
	});
	const tableNode = found.node;
	if (tableNode === null) throw new Error("Expected a table in the document");
	const map = TableMap.get(tableNode);
	return {
		height: map.height,
		tableNode,
		tablePos: found.pos,
		tableStart: found.pos + 1,
		width: map.width,
	};
}

function cellOffsets(layout: TableLayout): ReadonlyArray<number> {
	const map = TableMap.get(layout.tableNode);
	const offsets: number[] = [];
	for (let row = 0; row < map.height; row += 1) {
		for (let col = 0; col < map.width; col += 1) {
			offsets.push(map.positionAt(row, col, layout.tableNode));
		}
	}
	return offsets;
}

function cellTextRange(
	layout: TableLayout,
	row: number,
	col: number,
): Readonly<{ from: number; to: number }> {
	const map = TableMap.get(layout.tableNode);
	const offset = map.positionAt(row, col, layout.tableNode);
	const cellPos = layout.tableStart + offset;
	const cellNode = layout.tableNode.nodeAt(offset);
	if (!cellNode) throw new Error("Expected the requested cell");
	return { from: cellPos + 2, to: cellPos + 2 + cellNode.textContent.length };
}

/**
 * GFM has exactly one header row: row 0 uses `table_header` and every body row
 * uses `table_cell`.
 */
function expectSingleHeaderRow(layout: TableLayout): void {
	for (let row = 0; row < layout.tableNode.childCount; row += 1) {
		const rowNode = layout.tableNode.child(row);
		const expected = row === 0 ? "table_header" : "table_cell";
		for (let col = 0; col < rowNode.childCount; col += 1) {
			expect(rowNode.child(col).type.name).toBe(expected);
		}
	}
}

function createFakeTransfer(
	text: string,
	html: string,
	files: ReadonlyArray<File> = [],
): DataTransfer {
	return {
		files,
		getData: (mime: string) =>
			mime === "text/plain" ? text : mime === "text/html" ? html : "",
		items: files.map((file) => ({
			getAsFile: () => file,
			kind: "file",
			type: file.type,
		})),
	} as unknown as DataTransfer;
}

function createTransferEvent(
	type: "paste" | "drop",
	data: DataTransfer,
	coordinates: Readonly<{ x: number; y: number }> = { x: 0, y: 0 },
): Event {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(
		event,
		type === "paste" ? "clipboardData" : "dataTransfer",
		{ value: data },
	);
	Object.defineProperty(event, "clientX", { value: coordinates.x });
	Object.defineProperty(event, "clientY", { value: coordinates.y });
	return event;
}

function callDomPaste(view: EditorView, event: Event): boolean {
	let handled = false;
	view.someProp("handleDOMEvents", (handlers) => {
		const handler = handlers?.paste;
		if (!handler) return false;
		if (handler(view, event as ClipboardEvent)) {
			handled = true;
			return true;
		}
		return false;
	});
	return handled;
}

function callHandlePaste(view: EditorView, event: Event): boolean {
	let handled = false;
	const emptySlice = new Slice(Fragment.empty, 0, 0);
	view.someProp("handlePaste", (handler) => {
		if (handler(view, event as ClipboardEvent, emptySlice)) {
			handled = true;
			return true;
		}
		return false;
	});
	return handled;
}

function callHandleDrop(view: EditorView, event: Event): boolean {
	let handled = false;
	const emptySlice = new Slice(Fragment.empty, 0, 0);
	view.someProp("handleDrop", (handler) => {
		if (handler(view, event as DragEvent, emptySlice, false)) {
			handled = true;
			return true;
		}
		return false;
	});
	return handled;
}

function readClipboardText(view: EditorView, slice: Slice): string {
	let text = "";
	view.someProp("clipboardTextSerializer", (serializer) => {
		text = serializer(slice, view);
		return true;
	});
	return text;
}

function delimiterAlignments(markdown: string): ReadonlyArray<TableTextAlign> {
	for (const line of markdown.split("\n")) {
		if (!/^\|[\s:|-]+\|$/.test(line) || !line.includes("-")) continue;
		return line
			.replace(/^\||\|$/g, "")
			.split("|")
			.map((cell) => {
				const text = cell.trim();
				const left = text.startsWith(":");
				const right = text.endsWith(":");
				if (left && right) return "center";
				if (left) return "left";
				if (right) return "right";
				return null;
			});
	}
	return [];
}

function annotationEntries(
	markdown: string,
): ReadonlyArray<TableAlignEntry> | null {
	const lines = markdown.split("\n");
	const headerIndex = lines.findIndex((line) => line.startsWith("|"));
	if (headerIndex < 1) return null;
	return parseTableAlignComment(lines[headerIndex - 1]);
}

const TABLE_MARKDOWN = "| A | B |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |";

describe("table cell boundary keys never stall (§0.0.1)", () => {
	it("moves the caret to the end of the previous cell on Backspace at a cell start", () => {
		const view = createView(TABLE_MARKDOWN);
		const layout = readFirstTable(view.state.doc);
		placeCaret(view, cellTextRange(layout, 0, 1).from);

		expect(dispatchKey(view, "Backspace")).toBe(true);
		const selection = view.state.selection;
		expect(selection.empty).toBe(true);
		expect(selection.$from.parent.textContent).toBe("A");
		expect(selection.$from.parentOffset).toBe(1);
		expect(readFirstTable(view.state.doc).height).toBe(3);
		expect(readFirstTable(view.state.doc).width).toBe(2);
	});

	it("moves the caret to the start of the next cell on Delete at a cell end", () => {
		const view = createView(TABLE_MARKDOWN);
		const layout = readFirstTable(view.state.doc);
		placeCaret(view, cellTextRange(layout, 0, 1).to);

		expect(dispatchKey(view, "Delete")).toBe(true);
		const selection = view.state.selection;
		expect(selection.$from.parent.textContent).toBe("1");
		expect(selection.$from.parentOffset).toBe(0);
		expect(readFirstTable(view.state.doc).height).toBe(3);
	});

	it("moves the caret before the table on Backspace in the first cell of a later block", () => {
		const view = createView(
			"Intro paragraph\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
		);
		const layout = readFirstTable(view.state.doc);
		placeCaret(view, cellTextRange(layout, 0, 0).from);

		expect(dispatchKey(view, "Backspace")).toBe(true);
		const selection = view.state.selection;
		expect(selection.$from.parent.textContent).toBe("Intro paragraph");
		expect(selection.$from.parentOffset).toBe("Intro paragraph".length);
		expect(readFirstTable(view.state.doc).height).toBe(2);
	});

	it("keeps the document-start no-op but still moves from other first cells", () => {
		const view = createView(TABLE_MARKDOWN);
		const layout = readFirstTable(view.state.doc);
		placeCaret(view, cellTextRange(layout, 0, 0).from);
		const before = view.state.doc;

		expect(dispatchKey(view, "Backspace")).toBe(true);
		expect(view.state.doc.eq(before)).toBe(true);

		placeCaret(view, cellTextRange(layout, 0, 1).from);
		const startPosition = view.state.selection.from;
		expect(dispatchKey(view, "Backspace")).toBe(true);
		expect(view.state.selection.from).not.toBe(startPosition);
	});

	it("moves the caret after the table on Delete in the last cell", () => {
		const view = createView(
			"| A | B |\n| --- | --- |\n| 1 | 2 |\n\nTrailing paragraph",
		);
		const layout = readFirstTable(view.state.doc);
		placeCaret(view, cellTextRange(layout, 1, 1).to);
		const tableEnd = layout.tablePos + layout.tableNode.nodeSize;

		expect(dispatchKey(view, "Delete")).toBe(true);
		expect(view.state.selection.from).toBe(tableEnd + 1);
		expect(view.state.selection.$from.parent.textContent).toBe(
			"Trailing paragraph",
		);
		expect(isInTable(view.state)).toBe(false);
	});

	it("keeps the document-end no-op for Delete in the last cell", () => {
		const view = createView(TABLE_MARKDOWN);
		const layout = readFirstTable(view.state.doc);
		placeCaret(view, cellTextRange(layout, 2, 1).to);
		const before = view.state.doc;

		expect(dispatchKey(view, "Delete")).toBe(true);
		expect(view.state.doc.eq(before)).toBe(true);
	});

	it("leaves the table from an empty CellSelection instead of stalling", () => {
		const view = createView("Intro\n\n| A | B |\n| --- | --- |\n|  |  |");
		const layout = readFirstTable(view.state.doc);
		const offsets = cellOffsets(layout);
		view.dispatch(
			view.state.tr.setSelection(
				new CellSelection(
					view.state.doc.resolve(layout.tableStart + (offsets[2] ?? 0)),
					view.state.doc.resolve(layout.tableStart + (offsets[3] ?? 0)),
				),
			),
		);

		expect(dispatchKey(view, "Backspace")).toBe(true);
		expect(isInTable(view.state)).toBe(false);
		expect(readFirstTable(view.state.doc).height).toBe(2);
	});

	it("empties a non-empty CellSelection without deleting the table", () => {
		const view = createView(TABLE_MARKDOWN);
		const layout = readFirstTable(view.state.doc);
		const offsets = cellOffsets(layout);
		view.dispatch(
			view.state.tr.setSelection(
				new CellSelection(
					view.state.doc.resolve(layout.tableStart + (offsets[0] ?? 0)),
					view.state.doc.resolve(layout.tableStart + (offsets[3] ?? 0)),
				),
			),
		);

		expect(dispatchKey(view, "Backspace")).toBe(true);
		const next = readFirstTable(view.state.doc);
		expect(next.height).toBe(3);
		expect(next.width).toBe(2);
		expect(next.tableNode.textContent).toBe("34");
	});

	it("appends a body row instead of letting Tab escape the last cell", () => {
		const view = createView(TABLE_MARKDOWN);
		const layout = readFirstTable(view.state.doc);
		placeCaret(view, cellTextRange(layout, 2, 1).from);

		expect(dispatchKey(view, "Tab")).toBe(true);
		const next = readFirstTable(view.state.doc);
		expect(next.height).toBe(4);
		expect(next.width).toBe(2);
		const lastRow = next.tableNode.child(next.tableNode.childCount - 1);
		for (let col = 0; col < lastRow.childCount; col += 1) {
			expect(lastRow.child(col).type.name).toBe("table_cell");
		}
		expect(view.state.selection.$from.parent.textContent).toBe("");
		expect(isInTable(view.state)).toBe(true);

		// Tab in a middle cell keeps the native next-cell behavior.
		const middle = createView(TABLE_MARKDOWN);
		const middleLayout = readFirstTable(middle.state.doc);
		placeCaret(middle, cellTextRange(middleLayout, 1, 0).from);
		expect(dispatchKey(middle, "Tab")).toBe(true);
		expect(middle.state.selection.$from.parent.textContent).toBe("2");
		expect(readFirstTable(middle.state.doc).height).toBe(3);
	});

	it("collapses an empty CellSelection when no block exists outside the table", () => {
		const view = createView("| A | B |\n| --- | --- |\n|  |  |");
		const layout = readFirstTable(view.state.doc);
		const offsets = cellOffsets(layout);
		view.dispatch(
			view.state.tr.setSelection(
				new CellSelection(
					view.state.doc.resolve(layout.tableStart + (offsets[2] ?? 0)),
					view.state.doc.resolve(layout.tableStart + (offsets[3] ?? 0)),
				),
			),
		);

		expect(dispatchKey(view, "Backspace")).toBe(true);
		expect(view.state.selection).not.toBeInstanceOf(CellSelection);
		expect(view.state.selection.empty).toBe(true);
		expect(readFirstTable(view.state.doc).height).toBe(2);
	});

	it("exposes the boundary moves as commands for non-view callers", () => {
		const state = EditorState.create({
			doc: parseMarkdownToVisualDoc(TABLE_MARKDOWN),
			schema: visualEditorSchema,
		});
		const layout = readFirstTable(state.doc);
		const bodyCell = cellTextRange(layout, 1, 0);
		const atBodyCellStart = state.apply(
			state.tr.setSelection(TextSelection.create(state.doc, bodyCell.from)),
		);
		let dispatched = 0;
		expect(
			backspaceAtTableCellBoundary(atBodyCellStart, () => {
				dispatched += 1;
			}),
		).toBe(true);
		expect(dispatched).toBe(1);

		const lastCell = cellTextRange(layout, 2, 1).to;
		const atLastCellEnd = state.apply(
			state.tr.setSelection(TextSelection.create(state.doc, lastCell)),
		);
		expect(deleteAtTableCellBoundary(atLastCellEnd)).toBe(true);
	});
});

describe("table alignment metadata stays PHP-valid across Tab row append and codec reconciliation", () => {
	it("preserves base column alignments and stored PHP-valid annotations when Tab appends a body row", () => {
		const view = createView(
			[
				'<!-- easymde-table-align:v1 [[0,"center"]] -->',
				"| A | B |",
				"| :--- | ---: |",
				"| 1 | 2 |",
			].join("\n"),
		);
		const layout = readFirstTable(view.state.doc);
		expect(layout.tableNode.attrs.alignAnnotation).toContain('[[0,"center"]]');
		placeCaret(view, cellTextRange(layout, 1, 1).to);
		expect(dispatchKey(view, "Tab")).toBe(true);

		const current = readFirstTable(view.state.doc);
		expect(current.height).toBe(3);
		expectSingleHeaderRow(current);
		const markdown = serializeVisualDocToMarkdown(view.state.doc);
		expect(delimiterAlignments(markdown)).toEqual(["left", "right"]);
		const serialized = annotationEntries(markdown);
		const stored =
			typeof current.tableNode.attrs.alignAnnotation === "string"
				? parseTableAlignComment(current.tableNode.attrs.alignAnnotation)
				: null;
		expect(stored).toEqual(serialized);
		expect(serialized).toEqual([[0, "center"]]);
		if (serialized !== null) {
			expect(
				validateTableAlignEntries(serialized, {
					baseAlignments: delimiterAlignments(markdown),
					cellAlignments: [],
					columnCount: current.width,
					rowCount: current.height,
				}),
			).toBe(true);
		}
	});

	it("reconciles per-row and per-cell overrides into PHP-valid annotations and drops redundant or null-mixed comments", () => {
		const rowOverride = reconcileTableAlignComment(null, {
			baseAlignments: ["left", "right"],
			cellAlignments: [
				["center", "center"],
				["left", "right"],
			],
			columnCount: 2,
			rowCount: 2,
		});
		expect(parseTableAlignComment(rowOverride)).toEqual([[0, "center"]]);

		const cellOverride = reconcileTableAlignComment(null, {
			baseAlignments: ["left", "right"],
			cellAlignments: [
				["left", "right"],
				["center", "right"],
			],
			columnCount: 2,
			rowCount: 2,
		});
		const cellEntries = parseTableAlignComment(cellOverride);
		expect(cellEntries).toEqual([
			[1, "center"],
			[1, 1, "right"],
		]);
		expect(
			validateTableAlignEntries(cellEntries ?? [], {
				baseAlignments: ["left", "right"],
				cellAlignments: [],
				columnCount: 2,
				rowCount: 2,
			}),
		).toBe(true);

		// Matching column bases emits no redundant comment.
		expect(
			reconcileTableAlignComment('<!-- easymde-table-align:v1 [[0,"left"]] -->', {
				baseAlignments: ["left", "right"],
				cellAlignments: [
					["left", "right"],
					["left", "right"],
				],
				columnCount: 2,
				rowCount: 2,
			}),
		).toBeNull();

		// A row mixing aligned cells with an explicit null cell cannot be
		// represented in PHP's grammar, so the codec omits the comment safely.
		expect(
			reconcileTableAlignComment(null, {
				baseAlignments: [null, "right"],
				cellAlignments: [
					[null, "center"],
					[null, "right"],
				],
				columnCount: 2,
				rowCount: 2,
			}),
		).toBeNull();
	});
});

describe("input rules keep tables, trailing text, fences, and atoms intact", () => {
	it("does not fire block shortcuts inside a table cell", () => {
		const view = createView(TABLE_MARKDOWN);
		const layout = readFirstTable(view.state.doc);
		const cell = cellTextRange(layout, 1, 0);
		view.dispatch(view.state.tr.delete(cell.from, cell.to));
		placeCaret(view, cell.from);

		typeText(view, "```js ");
		expect(readFirstTable(view.state.doc).height).toBe(3);
		expect(readFirstTable(view.state.doc).width).toBe(2);
		expect(view.state.doc.textContent).toContain("```js");

		const next = readFirstTable(view.state.doc);
		placeCaret(view, cellTextRange(next, 2, 0).from);
		typeText(view, "--- ");
		expect(view.state.doc.child(0).type.name).toBe("table");
		expect(view.state.doc.childCount).toBe(1);

		const taskLayout = readFirstTable(view.state.doc);
		const secondCell = cellTextRange(taskLayout, 2, 1);
		view.dispatch(view.state.tr.delete(secondCell.from, secondCell.to));
		placeCaret(view, secondCell.from);
		typeText(view, "- [ ] keep me");
		expect(readFirstTable(view.state.doc).height).toBe(3);
		expect(readFirstTable(view.state.doc).width).toBe(2);
		expect(view.state.doc.textContent).toContain("- [ ] keep me");
	});

	it("preserves trailing paragraph text for fence and hr triggers", () => {
		const fenceView = createView("hello world");
		placeCaret(fenceView, 1);
		typeText(fenceView, "```js ");
		expect(fenceView.state.doc.firstChild?.type.name).toBe("paragraph");
		expect(fenceView.state.doc.textContent).toBe("```js hello world");

		const ruleView = createView("keep me");
		placeCaret(ruleView, 1);
		typeText(ruleView, "--- ");
		expect(ruleView.state.doc.childCount).toBe(1);
		expect(ruleView.state.doc.firstChild?.type.name).toBe("paragraph");
		expect(ruleView.state.doc.textContent).toBe("--- keep me");
	});

	it("preserves the typed fence character for tilde fences", () => {
		const view = createView("");
		typeText(view, "~~~python ");
		const block = view.state.doc.firstChild;
		expect(block?.type.name).toBe("code_block");
		expect(block?.attrs.language).toBe("python");
		expect(block?.attrs.fenceChar).toBe("~");
		expect(serializeVisualDocToMarkdown(view.state.doc)).toContain("~~~python");

		const backtickView = createView("");
		typeText(backtickView, "```ts ");
		expect(backtickView.state.doc.firstChild?.attrs.fenceChar).toBe("`");
	});

	it("does not swallow characters when typing a task list inside a list item", () => {
		const view = createView("");
		typeText(view, "- a");
		expect(dispatchKey(view, "Enter")).toBe(true);
		typeText(view, "- [ ] todo");
		expect(view.state.doc.textContent).toContain("- [ ] todo");
	});

	it("still upgrades an empty bullet item to a task list", () => {
		const view = createView("");
		typeText(view, "- ");
		typeText(view, "[x] ");
		expect(view.state.doc.firstChild?.type.name).toBe("task_list");
		expect(view.state.doc.firstChild?.firstChild?.attrs.checked).toBe(true);
	});

	it("preserves a link inside the strong input rule", () => {
		const view = createView("**click [here](https://a.com)");
		placeCaret(view, view.state.doc.content.size - 1);
		typeText(view, "*");
		typeText(view, "*");
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
			"**click [here](https://a.com)**",
		);
	});

	it("preserves a protected inline atom inside the emphasis input rule", () => {
		const view = createView("*foo $x$");
		placeCaret(view, view.state.doc.content.size - 1);
		typeText(view, "*");
		const markdown = serializeVisualDocToMarkdown(view.state.doc);
		expect(markdown).toBe("*foo $x$*");
		expect(markdown).not.toContain("\uFFFC");
	});

	it("closes emphasis on a single typed delimiter", () => {
		const view = createView("*abc");
		placeCaret(view, view.state.doc.content.size - 1);
		typeText(view, "*");
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe("*abc*");
		expect(view.state.doc.textContent).toBe("abc");
		expect(view.state.selection.from).toBe(4);
	});

	it("keeps every character of a multi-character text input", () => {
		const view = createView("*bar");
		const caret = view.state.doc.content.size - 1;
		placeCaret(view, caret);
		let handled = false;
		view.someProp("handleTextInput", (handler) => {
			handled =
				true ===
				handler(view, caret, caret, "foo*", () =>
					view.state.tr.insertText("foo*", caret, caret),
				);
			return handled;
		});
		expect(handled).toBe(true);
		expect(view.state.doc.textContent).toBe("barfoo");
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe("*barfoo*");
		expect(view.state.selection.empty).toBe(true);
		expect(view.state.selection.from).toBe(7);
	});

	it("replaces the selected text when closing a delimiter over it", () => {
		const view = createView("*abcX");
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 5, 6)),
		);
		typeText(view, "*");
		expect(view.state.doc.textContent).toBe("abc");
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe("*abc*");
	});

	it("marks cleanly after a composition commits the closing delimiter", () => {
		vi.useFakeTimers();
		try {
			const view = createView("*abc*");
			placeCaret(view, view.state.doc.content.size - 1);
			view.someProp("handleDOMEvents", (handlers) => {
				handlers?.compositionend?.(
					view,
					new CompositionEvent("compositionend"),
				);
				return false;
			});
			vi.runAllTimers();
			expect(view.state.doc.textContent).toBe("abc");
			expect(serializeVisualDocToMarkdown(view.state.doc)).toBe("*abc*");
			expect(view.state.selection.from).toBe(4);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not fire block rules inside an inline code mark", () => {
		const view = createView("`#`");
		placeCaret(view, view.state.doc.content.size - 1);
		typeText(view, " ");
		expect(view.state.doc.firstChild?.type.name).toBe("paragraph");
		expect(view.state.doc.firstChild?.textContent).toBe("# ");
	});
});

describe("clipboard serialization, paste, and drop", () => {
	it("serializes atoms to Markdown in plain text output", () => {
		const view = createView(
			[
				"Text $a$ ![Logo](https://example.com/logo.png)",
				"```mermaid\ngraph TD;\n```",
				"---",
			].join("\n\n"),
		);
		const text = readClipboardText(
			view,
			view.state.doc.slice(0, view.state.doc.content.size),
		);
		expect(text).toContain("$a$");
		expect(text).toContain("![Logo](https://example.com/logo.png)");
		expect(text).toContain("```mermaid");
		expect(text).toContain("---");
		expect(text).not.toContain("\uFFFC");
	});

	it("serializes an inline slice to Markdown without placeholders", () => {
		const view = createView("Alpha $x^2$ ![Pic](https://example.com/p.png)");
		const paragraph = view.state.doc.firstChild;
		if (!paragraph) throw new Error("Expected a paragraph");
		const text = readClipboardText(
			view,
			view.state.doc.slice(1, 1 + paragraph.content.size),
		);
		expect(text).toContain("$x^2$");
		expect(text).toContain("![Pic](https://example.com/p.png)");
		expect(text).not.toContain("\uFFFC");
	});

	it("serializes table rows and header/body cell slices as GFM tables", () => {
		const view = createView(
			"| **Alice** | $x^2$ |\n| --- | --- |\n| Bob | 95 |",
		);
		const layout = readFirstTable(view.state.doc);
		const cellPos = (row: number, col: number): number =>
			cellTextRange(layout, row, col).from - 2;
		const doc = view.state.doc;

		const bodyRow = readClipboardText(
			view,
			CellSelection.create(doc, cellPos(1, 0), cellPos(1, 1)).content(),
		);
		expect(bodyRow).toMatch(/\|\s*Bob\s*\|\s*95\s*\|/);
		expect(bodyRow).not.toContain("Bob95");

		const mixed = readClipboardText(
			view,
			CellSelection.create(doc, cellPos(0, 0), cellPos(1, 1)).content(),
		);
		expect(mixed).toContain("**Alice**");
		expect(mixed).toContain("$x^2$");
		expect(mixed).toMatch(/\|\s*Bob\s*\|\s*95\s*\|/);
		expect(mixed).not.toContain("\uFFFC");

		const headerStart = cellPos(0, 0);
		const headerCell = doc.nodeAt(cellPos(0, 1));
		if (!headerCell) throw new Error("Expected a header cell");
		const headerCells = readClipboardText(
			view,
			doc.slice(headerStart, cellPos(0, 1) + headerCell.nodeSize),
		);
		expect(headerCells).toContain("**Alice**");
		expect(headerCells).toContain("$x^2$");
		expect(headerCells).toContain("|");
		expect(headerCells).not.toContain("\uFFFC");
	});

	it("keeps HTML-with-image paste and drop inside a code block as code", () => {
		const view = createView("```ts\nconst x = 1;\n```");
		placeCaret(view, 3);
		const transfer = createFakeTransfer(
			"# Title\n\n- item",
			'<p>Title</p><img src="https://example.com/a.png">',
		);
		const pasteEvent = createTransferEvent("paste", transfer);
		expect(callDomPaste(view, pasteEvent)).toBe(false);
		expect(pasteEvent.defaultPrevented).toBe(false);
		let dropHandled = false;
		const dropEvent = createTransferEvent("drop", transfer);
		view.someProp("handleDOMEvents", (handlers) => {
			dropHandled = handlers?.drop?.(view, dropEvent as DragEvent) === true;
			return dropHandled;
		});
		expect(dropHandled).toBe(false);
		expect(dropEvent.defaultPrevented).toBe(false);
		expect(view.state.doc.childCount).toBe(1);
		expect(view.state.doc.firstChild?.type.name).toBe("code_block");
	});

	it("skips image upload when pasting inside a code block", () => {
		const onImagePaste = vi.fn();
		const view = createView("```ts\nconst x = 1;\n```", {
			imagePasteUploadEnabled: true,
			imageUploadEnabled: true,
			onImageDrop: vi.fn(),
			onImagePaste,
		});
		placeCaret(view, 3);
		const file = new File(["x"], "shot.png", { type: "image/png" });
		const event = createTransferEvent(
			"paste",
			createFakeTransfer("", "", [file]),
		);
		expect(callHandlePaste(view, event)).toBe(false);
		expect(callDomPaste(view, event)).toBe(false);
		expect(onImagePaste).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
		expect(view.state.doc.firstChild?.type.name).toBe("code_block");
	});

	it("skips image upload when dropping inside a code block", () => {
		const onImageDrop = vi.fn();
		const view = createView("```ts\nconst x = 1;\n```", {
			imageUploadEnabled: true,
			onImageDrop,
		});
		placeCaret(view, 3);
		const file = new File(["x"], "shot.png", { type: "image/png" });
		const event = createTransferEvent(
			"drop",
			createFakeTransfer("", "", [file]),
			{ x: 3, y: 3 },
		);
		expect(callHandleDrop(view, event)).toBe(false);
		expect(onImageDrop).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
		expect(view.state.doc.firstChild?.type.name).toBe("code_block");
	});

	it("checks the drop target, not the old code-block caret, before uploading", () => {
		const onImageDrop = vi.fn();
		const view = createView("```ts\nconst x = 1;\n```\n\nParagraph", {
			imageUploadEnabled: true,
			onImageDrop,
		});
		const codeBlock = view.state.doc.child(0);
		expect(codeBlock.type.name).toBe("code_block");
		const paragraphTextPos = codeBlock.nodeSize + 3;
		placeCaret(view, 3);
		expect(view.state.selection.$from.parent.type.name).toBe("code_block");
		vi.spyOn(view, "posAtCoords").mockReturnValue({
			inside: -1,
			pos: paragraphTextPos,
		});
		vi.spyOn(view, "focus").mockImplementation(() => undefined);
		const file = new File(["x"], "shot.png", { type: "image/png" });
		const event = createTransferEvent(
			"drop",
			createFakeTransfer("", "", [file]),
			{ x: 8, y: 40 },
		);

		expect(callHandleDrop(view, event)).toBe(true);
		expect(onImageDrop).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
		expect(view.state.selection.from).toBe(paragraphTextPos);
		expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
	});

	it("rejects a drop onto a code block even when the caret is in a paragraph", () => {
		const onImageDrop = vi.fn();
		const view = createView("Paragraph\n\n```ts\nconst x = 1;\n```", {
			imageUploadEnabled: true,
			onImageDrop,
		});
		const paragraph = view.state.doc.child(0);
		expect(view.state.doc.child(1).type.name).toBe("code_block");
		const codeTextPos = paragraph.nodeSize + 3;
		placeCaret(view, 3);
		const caretBefore = view.state.selection.from;
		vi.spyOn(view, "posAtCoords").mockReturnValue({
			inside: -1,
			pos: codeTextPos,
		});
		const focus = vi.spyOn(view, "focus").mockImplementation(() => undefined);
		const file = new File(["x"], "shot.png", { type: "image/png" });
		const event = createTransferEvent(
			"drop",
			createFakeTransfer("", "", [file]),
			{ x: 8, y: 40 },
		);

		expect(callHandleDrop(view, event)).toBe(false);
		expect(onImageDrop).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
		expect(focus).not.toHaveBeenCalled();
		expect(view.state.selection.from).toBe(caretBefore);
		expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
		expect(view.state.doc.child(1).textContent).toBe("const x = 1;");
	});

	it("uploads pasted images outside code blocks when enabled", () => {
		const onImagePaste = vi.fn();
		const view = createView("Paragraph", {
			imagePasteUploadEnabled: true,
			imageUploadEnabled: true,
			onImageDrop: vi.fn(),
			onImagePaste,
		});
		placeCaret(view, 3);
		const file = new File(["x"], "shot.png", { type: "image/png" });
		const event = createTransferEvent(
			"paste",
			createFakeTransfer("", "", [file]),
		);
		expect(callHandlePaste(view, event)).toBe(true);
		expect(onImagePaste).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it("defaults image upload to disabled for both paste and drop", () => {
		const onImageDrop = vi.fn();
		const onImagePaste = vi.fn();
		const view = createView("Paragraph", { onImageDrop, onImagePaste });
		placeCaret(view, 3);
		const file = new File(["x"], "shot.png", { type: "image/png" });
		expect(
			callHandlePaste(
				view,
				createTransferEvent("paste", createFakeTransfer("", "", [file])),
			),
		).toBe(false);
		expect(
			callHandleDrop(
				view,
				createTransferEvent("drop", createFakeTransfer("", "", [file])),
			),
		).toBe(false);
		expect(onImagePaste).not.toHaveBeenCalled();
		expect(onImageDrop).not.toHaveBeenCalled();
	});

	it("focuses the view after the drop selection is applied", () => {
		const order: string[] = [];
		let selectionAtDrop = -1;
		let selectionAtFocus = -1;
		const view = createView("Paragraph text", {
			imageUploadEnabled: true,
			onImageDrop: () => {
				order.push("drop");
				selectionAtDrop = view.state.selection.from;
			},
		});
		vi.spyOn(view, "posAtCoords").mockReturnValue({ inside: -1, pos: 5 });
		vi.spyOn(view, "focus").mockImplementation(() => {
			order.push("focus");
			selectionAtFocus = view.state.selection.from;
		});
		const file = new File(["x"], "shot.png", { type: "image/png" });
		const event = createTransferEvent(
			"drop",
			createFakeTransfer("", "", [file]),
			{ x: 4, y: 4 },
		);

		expect(callHandleDrop(view, event)).toBe(true);
		expect(order).toEqual(["focus", "drop"]);
		expect(selectionAtFocus).toBe(5);
		expect(selectionAtDrop).toBe(5);
	});

	it("inserts a hard break for a newline-only plain text paste", () => {
		const view = createView("Selected text");
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 9)),
		);
		expect(
			callHandlePaste(
				view,
				createTransferEvent("paste", createFakeTransfer("\n", "")),
			),
		).toBe(true);
		const paragraph = view.state.doc.firstChild;
		expect(paragraph?.type.name).toBe("paragraph");
		expect(paragraph?.firstChild?.type.name).toBe("hard_break");
		expect(paragraph?.textContent).toBe(" text");
	});

	it("flattens multi-block plain text inside a table cell without breaking it", () => {
		const view = createView(TABLE_MARKDOWN);
		const layout = readFirstTable(view.state.doc);
		placeCaret(view, cellTextRange(layout, 1, 0).to);
		expect(
			callHandlePaste(
				view,
				createTransferEvent("paste", createFakeTransfer("alpha\n\nbeta", "")),
			),
		).toBe(true);

		const next = readFirstTable(view.state.doc);
		expect(next.height).toBe(3);
		expect(next.width).toBe(2);
		const offset = TableMap.get(next.tableNode).positionAt(
			1,
			0,
			next.tableNode,
		);
		const cellNode = next.tableNode.nodeAt(offset);
		expect(cellNode?.textContent).toBe("1alphabeta");
		let hardBreaks = 0;
		cellNode?.descendants((node) => {
			if (node.type.name === "hard_break") hardBreaks += 1;
			return true;
		});
		expect(hardBreaks).toBe(1);
	});

	it("does not intercept rich HTML pastes that carry styling", () => {
		const view = createView("Paragraph");
		placeCaret(view, 3);
		const event = createTransferEvent(
			"paste",
			createFakeTransfer(
				"**bold** text",
				'<div style="color:red"><strong>bold</strong> text</div>',
			),
		);
		expect(callHandlePaste(view, event)).toBe(false);
		expect(callDomPaste(view, event)).toBe(false);
		expect(event.defaultPrevented).toBe(false);
		expect(view.state.doc.textContent).toBe("Paragraph");
	});

	it("inserts plain Markdown text as an inline fragment", () => {
		const view = createView("Paragraph");
		placeCaret(view, 3);
		expect(
			callHandlePaste(
				view,
				createTransferEvent(
					"paste",
					createFakeTransfer("**bold** and `code`", ""),
				),
			),
		).toBe(true);
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
			"Pa**bold** and `code`ragraph",
		);
	});
});

describe("Wave 5-Fix-B2 context-menu image re-targeting and selection direction", () => {
	const imageSource =
		"![A](https://example.com/a.png)\n\n![B](https://example.com/b.png)";

	const createRuntime = (view: EditorView, markdown: string) => {
		const syncSelection = vi.fn();
		const documentSession = {
			document: {
				getRevision: () => 0,
				getValue: () => markdown,
				isEditable: () => true,
			},
		} as unknown as EditorDocumentSession;
		const sync = {
			settleNow: () => true,
			syncSelection,
		} as unknown as VisualCanonicalSync;
		const runtime = createProseMirrorVisualRuntime({
			documentSession,
			isEditable: () => true,
			settlePendingEdits: () => Promise.resolve(true),
			sync,
			view,
		});
		return { runtime, syncSelection };
	};

	const imageMatch = (
		source: string,
		alt: string,
		destination: string,
	): VisualEditorMarkdownImageScaleMatch => {
		const raw = `![${alt}](${destination})`;
		const start = source.indexOf(raw);
		const end = start + raw.length;
		return {
			alt,
			destination,
			destinationAngle: false,
			destinationEnd: end - 1,
			destinationStart: start + alt.length + 4,
			end,
			imageEnd: end,
			raw,
			scale: null,
			start,
			title: null,
			titleEnd: null,
			titleMarkerEnd: null,
			titleMarkerStart: null,
			titleStart: null,
		};
	};

	const twoImageIndex = (source: string): VisualEditorImageTargetIndex => {
		const a = imageMatch(source, "A", "https://example.com/a.png");
		const b = imageMatch(source, "B", "https://example.com/b.png");
		return {
			blockImages: [
				{ end: a.end, images: [a], start: a.start, status: "ready" },
				{ end: b.end, images: [b], start: b.start, status: "ready" },
			],
			blocks: [],
			complete: true,
			images: [a, b],
			length: source.length,
			revision: 0,
			source,
			sourceBytes: source.length,
		};
	};

	const contentImages = (view: EditorView): HTMLImageElement[] =>
		Array.from(
			view.dom.querySelectorAll<HTMLImageElement>(
				"img:not(.ProseMirror-separator)",
			),
		);

	const imagePos = (view: EditorView, src: string): number => {
		let found = -1;
		view.state.doc.descendants((node, pos) => {
			if (found < 0 && node.type.name === "image" && node.attrs.src === src)
				found = pos;
			return found < 0;
		});
		return found;
	};

	it("B4 pointer on Image B replaces Image A's NodeSelection", () => {
		const view = createView(imageSource);
		const { runtime, syncSelection } = createRuntime(view, imageSource);
		const [, imageB] = contentImages(view);
		expect(imageB).toBeDefined();
		view.dispatch(
			view.state.tr.setSelection(
				NodeSelection.create(
					view.state.doc,
					imagePos(view, "https://example.com/a.png"),
				),
			),
		);
		expect(
			runtime.prepareContextMenuSelection?.(
				imageB ?? null,
				undefined,
				"pointer",
			),
		).toBe(true);
		const selection = view.state.selection;
		expect(selection).toBeInstanceOf(NodeSelection);
		expect((selection as NodeSelection).node.attrs.src).toBe(
			"https://example.com/b.png",
		);
		expect(syncSelection).toHaveBeenLastCalledWith(selection);
	});

	it("B4 keeps a deliberate non-empty text selection on atom pointer", () => {
		const markdown = "Hello world\n\n![B](https://example.com/b.png)";
		const view = createView(markdown);
		const { runtime } = createRuntime(view, markdown);
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)),
		);
		const [imageB] = contentImages(view);
		runtime.prepareContextMenuSelection?.(imageB ?? null, undefined, "pointer");
		expect(view.state.selection).toBeInstanceOf(TextSelection);
		expect(view.state.selection.from).toBe(1);
		expect(view.state.selection.to).toBe(6);
	});

	it("B4 prepareImageTarget binds strictly to the pointer image, never a sibling", () => {
		const view = createView(imageSource);
		const { runtime } = createRuntime(view, imageSource);
		const index = twoImageIndex(imageSource);
		const [imageA, imageB] = contentImages(view);
		const [matchA, matchB] = index.images;
		if (!imageA || !imageB || !matchA || !matchB) throw new Error("fixture");

		expect(
			runtime.prepareImageTarget({
				element: imageB,
				index,
				selection: { end: matchA.end, start: matchA.start },
			}),
		).toBeNull();

		const leaseB = runtime.prepareImageTarget({
			element: imageB,
			index,
			selection: { end: matchB.end, start: matchB.start },
		});
		expect(leaseB?.root).toBe(imageB);
		expect(leaseB?.target.original.destination).toBe(
			"https://example.com/b.png",
		);
		expect(leaseB?.target.blockId).toBe("pm-block-1");
		expect(leaseB?.target.ordinal).toBe(0);

		const pinB = runtime.prepareImageTargetBySelection({
			index,
			selection: { end: matchB.end, start: matchB.start },
		});
		const pinnedB = pinB?.getLease();
		expect(pinnedB?.root).toBe(imageB);
		expect(pinnedB?.target.blockId).toBe(leaseB?.target.blockId);
		expect(pinnedB?.target.ordinal).toBe(leaseB?.target.ordinal);

		const leaseA = runtime.prepareImageTarget({
			element: imageA,
			index,
			selection: { end: matchA.end, start: matchA.start },
		});
		expect(leaseA?.target.blockId).toBe("pm-block-0");
		expect(leaseA?.target.original.destination).toBe(
			"https://example.com/a.png",
		);
	});

	it("B5 DOM selection sync preserves a backward selection direction", () => {
		const markdown = "Hello world";
		const view = createView(markdown);
		const { runtime, syncSelection } = createRuntime(view, markdown);
		const textNode = view.dom.querySelector("p")?.firstChild;
		if (!textNode) throw new Error("fixture");
		const domSelection = document.getSelection();
		domSelection?.removeAllRanges();
		domSelection?.setBaseAndExtent(textNode, 4, textNode, 1);
		expect(domSelection?.anchorOffset).toBe(4);
		expect(domSelection?.focusOffset).toBe(1);

		expect(runtime.prepareMediaSelection?.()).toBe(true);
		const selection = view.state.selection;
		expect(selection.anchor).toBe(5);
		expect(selection.head).toBe(2);
		expect(selection.anchor > selection.head).toBe(true);
		expect(syncSelection).toHaveBeenLastCalledWith(selection);
		domSelection?.removeAllRanges();
	});
});

describe("Wave 6F drop hit-testing on protected content", () => {
	const imageDropEvent = (target?: Element): Event => {
		const file = new File(["x"], "shot.png", { type: "image/png" });
		const event = createTransferEvent(
			"drop",
			createFakeTransfer("", "", [file]),
			{ x: 8, y: 40 },
		);
		if (target) Object.defineProperty(event, "target", { value: target });
		return event;
	};

	const callDomDrop = (view: EditorView, event: Event): boolean => {
		let handled = false;
		view.someProp("handleDOMEvents", (handlers) => {
			handled = handlers?.drop?.(view, event as DragEvent) === true;
			return handled;
		});
		return handled;
	};

	const expectBlockedDrop = (
		markdown: string,
		coords: Readonly<{ inside: number; pos: number }>,
		target?: (view: EditorView) => Element | null,
	): void => {
		const onImageDrop = vi.fn();
		const view = createView(markdown, {
			imageUploadEnabled: true,
			onImageDrop,
		});
		placeCaret(view, 1);
		const before = view.state.selection;
		const dispatch = vi.spyOn(view, "dispatch");
		const focus = vi.spyOn(view, "focus").mockImplementation(() => undefined);
		vi.spyOn(view, "posAtCoords").mockReturnValue(coords);
		const element = target ? (target(view) ?? undefined) : undefined;
		if (target) expect(element).toBeDefined();
		for (const call of [callHandleDrop, callDomDrop]) {
			const event = imageDropEvent(element);
			expect(call(view, event)).toBe(false);
			expect(event.defaultPrevented).toBe(false);
		}
		expect(onImageDrop).not.toHaveBeenCalled();
		expect(dispatch).not.toHaveBeenCalled();
		expect(focus).not.toHaveBeenCalled();
		expect(view.state.selection.eq(before)).toBe(true);
	};

	it("blocks both the near and far side of a protected block card", () => {
		const markdown = "Before\n\n$$x$$\n\nAfter";
		const doc = parseMarkdownToVisualDoc(markdown);
		const blockPos = doc.child(0).nodeSize;
		expect(doc.nodeAt(blockPos)?.type.name).toBe("protected_block");
		expectBlockedDrop(markdown, { inside: blockPos, pos: blockPos });
		expectBlockedDrop(markdown, { inside: blockPos, pos: blockPos + 1 });
	});

	it("blocks a direct hit on an inline math atom by node and by DOM target", () => {
		const markdown = "Text $x$ more";
		const doc = parseMarkdownToVisualDoc(markdown);
		let atomPos = -1;
		doc.descendants((node, pos) => {
			if (node.type.name === "protected_inline") atomPos = pos;
			return atomPos < 0;
		});
		expect(atomPos).toBeGreaterThan(0);
		expectBlockedDrop(markdown, { inside: atomPos, pos: atomPos + 1 });
		// The DOM target wins even when the coordinates map to plain text.
		expectBlockedDrop(markdown, { inside: 0, pos: 2 }, (view) =>
			view.dom.querySelector("[data-easymde-protected-inline]"),
		);
	});

	it("still accepts plain text right before an inline atom", () => {
		const onImageDrop = vi.fn();
		const view = createView("Text $x$ more", {
			imageUploadEnabled: true,
			onImageDrop,
		});
		vi.spyOn(view, "posAtCoords").mockReturnValue({ inside: 0, pos: 3 });
		vi.spyOn(view, "focus").mockImplementation(() => undefined);
		const event = imageDropEvent();
		expect(callHandleDrop(view, event)).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(onImageDrop).toHaveBeenCalledTimes(1);
		expect(view.state.selection.from).toBe(3);
	});
});
