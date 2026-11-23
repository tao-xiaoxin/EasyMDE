import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "@wordpress/element";
import { GapCursor, gapCursor } from "prosemirror-gapcursor";
import { history } from "prosemirror-history";
import {
	EditorState,
	NodeSelection,
	Plugin,
	TextSelection,
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolbarCommand } from "../../contracts/bootstrap/toolbar-bootstrap";
import type {
	ImmersiveVisualEditorRuntime,
	VisualEditorGeneratedContentTargetIndex,
	VisualEditorImageTargetIndex,
	VisualEditorSelection,
} from "../../contracts/visual-editor";
import type {
	CodeMirrorDocumentSession,
	DocumentTextChange,
} from "../document-source/adapters/code-mirror-document-session";
import { createCodeMirrorDocumentSession } from "../document-source/adapters/code-mirror-document-session";
import type { EditorDocumentSession } from "../document-source/editor-document-session";
import { parseMarkdownToVisualDoc } from "./markdown-parser";
import { serializeVisualDocToMarkdown } from "./markdown-serializer";
import { createProtectedBlockNodeView } from "./node-views/protected-atom-node-view";
import { ProseMirrorVisualEditor } from "./ProseMirrorVisualEditor";
import {
	ATOMIC_SELECTION_ANCHOR_ATTRIBUTE,
	createAtomicSelectionAnchorPlugin,
} from "./visual-boundary-commands";
import { createVisualKeymapPlugins } from "./visual-commands";
import { visualEditorSchema } from "./visual-schema";
import {
	assertCanonicalChangePrecondition,
	computeVisualSelectionToMarkdownSelection,
	resolveMarkdownSelectionToVisualSelection,
} from "./visual-source-mapping";
import { createVisualTablePlugin } from "./visual-table-operations";

type MockDocumentHarness = Readonly<{
	applyTextChangeSpy: ReturnType<typeof vi.fn>;
	emitExternalChange: (
		nextValue: string,
		nextSelection?: VisualEditorSelection,
	) => void;
	session: EditorDocumentSession;
	setEditable: (editable: boolean) => void;
}>;

function createMockDocumentSession(
	initialMarkdown: string,
): MockDocumentHarness {
	let value = initialMarkdown;
	let revision = 0;
	let editable = true;
	let selection: VisualEditorSelection = {
		direction: "none",
		end: 0,
		start: 0,
	};
	const listeners = new Set<() => void>();
	const selectionListeners = new Set<() => void>();

	const applyTextChangeSpy = vi.fn((change: DocumentTextChange) => {
		const changed = change.value !== value;
		value = change.value;
		selection = change.selection;
		if (changed) {
			revision += 1;
			for (const listener of Array.from(listeners)) listener();
		}
		for (const listener of Array.from(selectionListeners)) listener();
		return changed
			? (change.changes ?? { from: 0, insert: value, to: value.length })
			: null;
	});

	const documentMock: CodeMirrorDocumentSession = {
		applyTextChange:
			applyTextChangeSpy as CodeMirrorDocumentSession["applyTextChange"],
		canRedo: () => false,
		canUndo: () => false,
		captureLayoutScrollRestore: () => null,
		destroy: () => {
			listeners.clear();
			selectionListeners.clear();
		},
		flush: () => undefined,
		focus: () => undefined,
		getCursorPosition: () => ({ column: 1, line: 1 }),
		getHistoryState: () => ({ redoDepth: 0, undoDepth: 0 }),
		getInputElement: () => document.createElement("div"),
		getRevision: () => revision,
		getScrollElement: () => document.createElement("div"),
		getSelection: () => selection,
		getSnapshot: () => ({ savedValue: initialMarkdown, value }),
		getValue: () => value,
		isEditable: () => editable,
		prepareContextMenuPointer: () => true,
		redo: () => false,
		replaceSavedValue: () => undefined,
		revealPosition: () => undefined,
		setVisualEditingActive: () => undefined,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		subscribeSelection: (listener) => {
			selectionListeners.add(listener);
			return () => {
				selectionListeners.delete(listener);
			};
		},
		syncFromSubmissionField: () => undefined,
		undo: () => false,
	};

	const session: EditorDocumentSession = {
		destroy: () => undefined,
		document: documentMock,
		getSnapshot: () => ({ dirty: value !== initialMarkdown }),
		reconcileSavedBaseline: () => undefined,
		registerSubmissionState: () => undefined,
		replaceSubmissionState: () => undefined,
		subscribe: () => () => undefined,
		title: {
			destroy: () => undefined,
			getSnapshot: () => ({ savedValue: "", value: "" }),
			replaceSavedValue: () => undefined,
			setValue: () => undefined,
			subscribe: () => () => undefined,
		},
	};

	return {
		applyTextChangeSpy,
		emitExternalChange(
			nextValue: string,
			nextSelection?: VisualEditorSelection,
		) {
			value = nextValue;
			revision += 1;
			selection = nextSelection ?? { direction: "none", end: 0, start: 0 };
			for (const listener of Array.from(listeners)) listener();
		},
		session,
		setEditable(nextEditable: boolean) {
			editable = nextEditable;
		},
	};
}

function createViewCapturePlugin(): Readonly<{
	getView: () => EditorView;
	plugin: Plugin;
}> {
	let capturedView: EditorView | null = null;
	const plugin = new Plugin({
		view(editorView) {
			capturedView = editorView;
			return {
				destroy() {
					if (capturedView === editorView) capturedView = null;
				},
			};
		},
	});
	return {
		getView: () => {
			if (!capturedView) throw new Error("Expected EditorView to be mounted");
			return capturedView;
		},
		plugin,
	};
}

function makeToolbarCommand(
	overrides: Partial<ToolbarCommand> & Pick<ToolbarCommand, "id" | "action">,
): ToolbarCommand {
	return {
		group: "format",
		icon: "editor-code",
		label: overrides.id,
		surface: "main",
		...overrides,
	};
}

function buildSingleImageIndex(
	source: string,
	alt: string,
	destination: string,
	revision = 0,
): VisualEditorImageTargetIndex {
	const raw = `![${alt}](${destination})`;
	const start = source.indexOf(raw);
	const end = start + raw.length;
	const match = {
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
	return {
		blockImages: [{ end, images: [match], start, status: "ready" }],
		blocks: [],
		complete: true,
		images: [match],
		length: source.length,
		revision,
		source,
		sourceBytes: source.length,
	};
}

function createFakeTransferEvent(
	type: "paste" | "drop",
	payload: Readonly<{
		files?: ReadonlyArray<File>;
		html?: string;
		text?: string;
	}>,
): Event {
	const files = payload.files ?? [];
	const dataTransfer = {
		files,
		getData: (mime: string) =>
			mime === "text/plain"
				? (payload.text ?? "")
				: mime === "text/html"
					? (payload.html ?? "")
					: "",
		items: files.map((file) => ({
			getAsFile: () => file,
			kind: "file",
			type: file.type,
		})),
	};
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(
		event,
		type === "paste" ? "clipboardData" : "dataTransfer",
		{
			value: dataTransfer,
		},
	);
	return event;
}

const standaloneViews: EditorView[] = [];

afterEach(() => {
	while (standaloneViews.length > 0) {
		const view = standaloneViews.pop();
		if (view) {
			view.destroy();
			view.dom.parentElement?.remove();
		}
	}
});

function createStandaloneTableView(markdown: string): EditorView {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const state = EditorState.create({
		doc: parseMarkdownToVisualDoc(markdown),
		plugins: [
			history(),
			createVisualTablePlugin(),
			...createVisualKeymapPlugins(),
		],
		schema: visualEditorSchema,
	});
	const view = new EditorView(host, { state });
	standaloneViews.push(view);
	return view;
}

async function flushSettlement(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function dispatchKeyDown(
	view: EditorView,
	key: string,
	modifiers: Readonly<{ ctrlKey?: boolean; shiftKey?: boolean }> = {},
): boolean {
	const event = new KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		key,
		...modifiers,
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

describe("ProseMirrorVisualEditor host component", () => {
	it("mounts inside EasyMDE themed classes, accepts nodeViews/extraPlugins, and toggles editable", () => {
		const harness = createMockDocumentSession("# Welcome\n\nParagraph text.");
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const onDispose = vi.fn();
		const extraPluginInit = vi.fn();
		const extraPlugins = [
			new Plugin({
				state: {
					apply: (_tr, prev) => prev,
					init: () => {
						extraPluginInit();
						return true;
					},
				},
			}),
		];
		const nodeViews = {
			paragraph: () => {
				const dom = document.createElement("p");
				dom.setAttribute("data-custom-node-view", "1");
				return { contentDOM: dom, dom };
			},
		};

		const { container, rerender, unmount } = render(
			<ProseMirrorVisualEditor
				articleThemeClass="easymde-theme-notion"
				className="custom-host-class"
				documentSession={harness.session}
				editable={true}
				extraPlugins={extraPlugins}
				nodeViews={nodeViews}
				onDispose={onDispose}
				onReady={(runtime) => {
					runtimeRef.current = runtime;
				}}
			/>,
		);

		const host = container.querySelector('[data-easymde-prosemirror-host="1"]');
		expect(host?.classList.contains("easymde-rendered-content")).toBe(true);
		expect(host?.classList.contains("easymde-theme-notion")).toBe(true);
		expect(host?.classList.contains("easymde-code-mac")).toBe(true);
		expect(host?.classList.contains("easymde-prosemirror-surface")).toBe(true);
		expect(host?.classList.contains("custom-host-class")).toBe(true);

		const rt = runtimeRef.current as ImmersiveVisualEditorRuntime;
		expect(rt.isEditable()).toBe(true);
		expect(rt.surface.querySelector("h1")?.textContent).toBe("Welcome");
		expect(
			rt.surface.querySelector('p[data-custom-node-view="1"]')?.textContent,
		).toBe("Paragraph text.");
		expect(extraPluginInit).toHaveBeenCalledTimes(1);

		rerender(
			<ProseMirrorVisualEditor
				articleThemeClass="easymde-theme-notion"
				documentSession={harness.session}
				editable={false}
				extraPlugins={extraPlugins}
				nodeViews={nodeViews}
				onDispose={onDispose}
			/>,
		);
		expect(rt.isEditable()).toBe(false);

		unmount();
		expect(onDispose).toHaveBeenCalledTimes(1);
	});

	it("enforces zero-write-on-read across mount, focus, click, selection, and unmount", () => {
		const initialMarkdown = [
			"# Original Title",
			"Text with _underscore emphasis_ and **bold**.",
			"$$\nE = mc^2\n$$",
			"| A | B |\n| :--- | ---: |\n| 1 | 2 |",
		].join("\n\n");
		const harness = createMockDocumentSession(initialMarkdown);
		const onMarkdownChange = vi.fn();
		const onCanonicalDocumentChange = vi.fn();
		const capture = createViewCapturePlugin();
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};

		const { unmount } = render(
			<ProseMirrorVisualEditor
				documentSession={harness.session}
				extraPlugins={[capture.plugin]}
				onCanonicalDocumentChange={onCanonicalDocumentChange}
				onMarkdownChange={onMarkdownChange}
				onReady={(rt) => {
					runtimeRef.current = rt;
				}}
			/>,
		);

		const rt = runtimeRef.current as ImmersiveVisualEditorRuntime;
		const view = capture.getView();
		rt.surface.focus();
		rt.surface.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 10)),
		);
		expect(rt.prepareContextMenuDemand()).toBe(true);
		unmount();

		expect(harness.applyTextChangeSpy).not.toHaveBeenCalled();
		expect(onMarkdownChange).not.toHaveBeenCalled();
		expect(onCanonicalDocumentChange).not.toHaveBeenCalled();
		expect(harness.session.document.getValue()).toBe(initialMarkdown);
		expect(harness.session.document.getRevision()).toBe(0);
	});

	it("synchronizes live typing and toolbar executeCommand to canonical Markdown", () => {
		const harness = createMockDocumentSession("Hello world");
		const onMarkdownChange = vi.fn();
		const capture = createViewCapturePlugin();
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};

		render(
			<ProseMirrorVisualEditor
				documentSession={harness.session}
				extraPlugins={[capture.plugin]}
				onMarkdownChange={onMarkdownChange}
				onReady={(rt) => {
					runtimeRef.current = rt;
				}}
			/>,
		);

		const rt = runtimeRef.current as ImmersiveVisualEditorRuntime;
		const view = capture.getView();

		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 12)),
		);
		expect(
			rt.executeCommand(makeToolbarCommand({ action: "bold", id: "bold" })),
		).toBe("handled");
		expect(harness.session.document.getValue()).toBe("Hello **world**");
		expect(onMarkdownChange).toHaveBeenCalledWith("Hello **world**");

		view.dispatch(
			view.state.tr.insertText("!", view.state.doc.content.size - 1),
		);
		expect(harness.session.document.getValue()).toBe("Hello **world!**");

		expect(
			rt.executeCommand(
				makeToolbarCommand({ action: "copyWechat", id: "wechat" }),
			),
		).toBe("unsupported");
		harness.setEditable(false);
		expect(
			rt.executeCommand(makeToolbarCommand({ action: "italic", id: "italic" })),
		).toBe("blocked");
	});

	it("updates ProseMirror DOM on external documentSession changes without echo loops", () => {
		const harness = createMockDocumentSession("Initial text");
		const onMarkdownChange = vi.fn();
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};

		render(
			<ProseMirrorVisualEditor
				documentSession={harness.session}
				onMarkdownChange={onMarkdownChange}
				onReady={(rt) => {
					runtimeRef.current = rt;
				}}
			/>,
		);

		const rt = runtimeRef.current as ImmersiveVisualEditorRuntime;
		const callsBefore = harness.applyTextChangeSpy.mock.calls.length;

		act(() => {
			harness.emitExternalChange("## Updated Heading\n\nNew body paragraph", {
				direction: "none",
				end: 20,
				start: 20,
			});
		});

		expect(rt.surface.querySelector("h2")?.textContent).toBe("Updated Heading");
		expect(rt.surface.querySelector("p")?.textContent).toBe(
			"New body paragraph",
		);
		expect(harness.applyTextChangeSpy).toHaveBeenCalledTimes(callsBefore);
		expect(onMarkdownChange).not.toHaveBeenCalled();
	});

	it("defers Markdown writes during IME composition and commits once after bounded settlement", async () => {
		const harness = createMockDocumentSession("Hello");
		const onMarkdownChange = vi.fn();
		const capture = createViewCapturePlugin();
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};

		render(
			<ProseMirrorVisualEditor
				documentSession={harness.session}
				extraPlugins={[capture.plugin]}
				onMarkdownChange={onMarkdownChange}
				onReady={(rt) => {
					runtimeRef.current = rt;
				}}
			/>,
		);

		const rt = runtimeRef.current as ImmersiveVisualEditorRuntime;
		const view = capture.getView();
		const endPos = view.state.doc.content.size - 1;

		rt.surface.dispatchEvent(new Event("compositionstart", { bubbles: true }));
		view.dispatch(view.state.tr.insertText(" ni", endPos));
		view.dispatch(
			view.state.tr.replaceWith(
				endPos,
				endPos + 3,
				visualEditorSchema.text(" 你好"),
			),
		);

		expect(harness.applyTextChangeSpy).not.toHaveBeenCalled();
		expect(onMarkdownChange).not.toHaveBeenCalled();

		rt.surface.dispatchEvent(new Event("compositionend", { bubbles: true }));
		// compositionend never commits the stale pre-flush state synchronously.
		expect(harness.applyTextChangeSpy).not.toHaveBeenCalled();
		await flushSettlement();
		expect(harness.applyTextChangeSpy).toHaveBeenCalledTimes(1);
		expect(harness.session.document.getValue()).toBe("Hello 你好");
		expect(onMarkdownChange).toHaveBeenCalledTimes(1);
		await expect(rt.settlePendingEdits?.()).resolves.toBe(true);
		expect(harness.applyTextChangeSpy).toHaveBeenCalledTimes(1);
	});

	it("isolates protected-card IME and commits a late composition flush exactly once", async () => {
		const harness = createMockDocumentSession("Hello\n\n$$\nx\n$$");
		const capture = createViewCapturePlugin();
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		render(
			<ProseMirrorVisualEditor
				documentSession={harness.session}
				extraPlugins={[capture.plugin]}
				onReady={(rt) => {
					runtimeRef.current = rt;
				}}
			/>,
		);
		const rt = runtimeRef.current as ImmersiveVisualEditorRuntime;
		const view = capture.getView();
		const card = view.dom.querySelector(
			"[data-easymde-protected-block]",
		) as HTMLElement;
		expect(card).not.toBeNull();

		card.dispatchEvent(new Event("compositionstart", { bubbles: true }));
		card.dispatchEvent(new Event("compositionend", { bubbles: true }));
		// Card IME never enters the outer composition state machine.
		expect(rt.prepareContextMenuDemand()).toBe(true);
		view.dispatch(view.state.tr.insertText("!", textEndOfBlock(view, 0)));
		expect(harness.session.document.getValue()).toBe("Hello!\n\n$$\nx\n$$");

		rt.surface.dispatchEvent(new Event("compositionstart", { bubbles: true }));
		view.dispatch(view.state.tr.insertText("?", textEndOfBlock(view, 0)));
		expect(harness.applyTextChangeSpy).toHaveBeenCalledTimes(1);
		expect(rt.prepareContextMenuDemand()).toBe(false);
		expect(
			rt.executeCommand(makeToolbarCommand({ action: "undo", id: "undo" })),
		).toBe("failed");
		rt.surface.dispatchEvent(new Event("compositionend", { bubbles: true }));
		// The late DOM flush lands while settling: it commits once, cleanly.
		view.dispatch(view.state.tr.insertText("x", textEndOfBlock(view, 0)));
		expect(harness.applyTextChangeSpy).toHaveBeenCalledTimes(2);
		expect(harness.session.document.getValue()).toBe("Hello!?x\n\n$$\nx\n$$");
		await flushSettlement();
		expect(harness.applyTextChangeSpy).toHaveBeenCalledTimes(2);
		expect(rt.prepareContextMenuDemand()).toBe(true);
	});

	it("handles a 220-block large document in one unified ProseMirror editor without window splitting", () => {
		const blocks: string[] = [];
		for (let i = 1; i <= 220; i += 1) {
			blocks.push(
				i % 20 === 1 ? `## Section ${i}` : `Paragraph block number ${i}.`,
			);
		}
		const harness = createMockDocumentSession(blocks.join("\n\n"));
		const capture = createViewCapturePlugin();

		render(
			<ProseMirrorVisualEditor
				documentSession={harness.session}
				extraPlugins={[capture.plugin]}
			/>,
		);

		const view = capture.getView();
		expect(view.state.doc.childCount).toBe(220);

		let blockPos = 0;
		for (let i = 0; i < 199; i += 1)
			blockPos += view.state.doc.child(i).nodeSize;
		const targetBlock = view.state.doc.child(199);
		expect(targetBlock.textContent).toBe("Paragraph block number 200.");

		view.dispatch(
			view.state.tr.insertText(
				" [edited]",
				blockPos + targetBlock.nodeSize - 1,
			),
		);
		const updatedBlocks = harness.session.document.getValue().split("\n\n");
		expect(updatedBlocks.length).toBe(220);
		expect(updatedBlocks[0]).toBe("## Section 1");
		expect(updatedBlocks[199]).toBe("Paragraph block number 200. [edited]");
		expect(updatedBlocks[219]).toBe("Paragraph block number 220.");
	});
});

describe("visual-table-operations", () => {
	it("supports cell Backspace/Enter guards and Tab row append while preserving GFM header and alignment metadata", () => {
		const view = createStandaloneTableView(
			"| Name | Score |\n| :--- | ---: |\n| Alice | 95 |",
		);
		const row0Size = view.state.doc.firstChild?.child(0).nodeSize ?? 0;
		const bodyFirstCellPos = 1 + row0Size + 1 + 1 + 1;
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, bodyFirstCellPos),
			),
		);

		// Backspace at the start of cell (1,0) moves to the end of cell (0,1).
		expect(dispatchKeyDown(view, "Backspace")).toBe(true);
		expect(view.state.doc.firstChild?.type.name).toBe("table");
		expect(view.state.selection.$from.parent.textContent).toBe("Score");
		expect(view.state.selection.$from.parentOffset).toBe(
			view.state.selection.$from.parent.content.size,
		);

		// Enter inside a cell inserts a hard break without splitting the table.
		expect(dispatchKeyDown(view, "Enter")).toBe(true);
		expect(serializeVisualDocToMarkdown(view.state.doc)).toContain("Score<br>");
		expect(serializeVisualDocToMarkdown(view.state.doc)).toContain("| Alice |");

		// Tab from the last cell appends a body row and keeps GFM column alignment.
		const tableNode = view.state.doc.firstChild;
		expect(tableNode?.type.name).toBe("table");
		const lastRow = tableNode?.child((tableNode?.childCount ?? 1) - 1);
		const lastCellEnd = (tableNode?.nodeSize ?? 4) - 4;
		expect(lastRow?.childCount).toBe(2);
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, lastCellEnd),
			),
		);
		expect(dispatchKeyDown(view, "Tab")).toBe(true);
		expect(view.state.doc.firstChild?.childCount).toBe(3);
		const afterTabMd = serializeVisualDocToMarkdown(view.state.doc);
		expect(afterTabMd).toContain("| :--- | ---: |");
	});
});

describe("ImmersiveVisualEditorRuntime context-menu, selection mapping, and paste/drop", () => {
	it("maps selections bidirectionally and enforces strict canonical change preconditions", () => {
		const markdown =
			"# Heading\n\nParagraph with ![Alt](https://example.com/a.png)\n\n```ts\nconst x = 1;\n```\n\n$$\nx^2\n$$";
		const doc = parseMarkdownToVisualDoc(markdown);

		const mdSel = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(doc, 8, 1),
			markdown,
		);
		expect(mdSel.direction).toBe("backward");
		expect(markdown.slice(mdSel.start, mdSel.end)).toBe("Heading");
		const restored = resolveMarkdownSelectionToVisualSelection(
			doc,
			markdown,
			mdSel,
		);
		expect(doc.textBetween(restored.from, restored.to)).toBe("Heading");
		expect(restored.anchor).toBeGreaterThan(restored.head);

		let imagePos = -1;
		doc.descendants((node, pos) => {
			if (node.type.name === "image") {
				imagePos = pos;
				return false;
			}
			return true;
		});
		const imgMdSel = computeVisualSelectionToMarkdownSelection(
			doc,
			NodeSelection.create(doc, imagePos),
			markdown,
		);
		expect(markdown.slice(imgMdSel.start, imgMdSel.end)).toBe(
			"![Alt](https://example.com/a.png)",
		);

		const mathIdx = markdown.indexOf("$$");
		const mathSel = resolveMarkdownSelectionToVisualSelection(doc, markdown, {
			direction: "none",
			end: markdown.length,
			start: mathIdx,
		});
		expect(mathSel).toBeInstanceOf(NodeSelection);

		const zeroSel: VisualEditorSelection = {
			direction: "none",
			end: 0,
			start: 0,
		};
		const baseChange = {
			changes: { from: 0, insert: "## ", to: 2 },
			selection: { direction: "none" as const, end: 3, start: 3 },
			value: `## ${markdown.slice(2)}`,
		};
		expect(
			assertCanonicalChangePrecondition(
				{
					change: baseChange,
					expected: { revision: 1, selection: zeroSel, value: markdown },
				},
				2,
				markdown,
				zeroSel,
			),
		).toEqual({ code: "canonical-change-revision-mismatch", ok: false });
		expect(
			assertCanonicalChangePrecondition(
				{
					change: baseChange,
					expected: { revision: 2, selection: zeroSel, value: "stale" },
				},
				2,
				markdown,
				zeroSel,
			),
		).toEqual({ code: "canonical-change-value-mismatch", ok: false });
		expect(
			assertCanonicalChangePrecondition(
				{
					change: baseChange,
					expected: {
						revision: 2,
						selection: { direction: "none", end: 1, start: 1 },
						value: markdown,
					},
				},
				2,
				markdown,
				zeroSel,
			),
		).toEqual({ code: "canonical-change-selection-mismatch", ok: false });
	});

	it("implements context menu leases, selection prep, applyCanonicalChange, and target leases", () => {
		const initialMd =
			"Intro\n\n![Photo](https://example.com/p.png)\n\n$$\na + b\n$$\n\n```mermaid\ngraph TD\nA-->B\n```";
		const harness = createMockDocumentSession(initialMd);
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};
		const previewIdentity = {
			editMap: null,
			revision: 5,
			signature: "sig-5",
			sourceRevision: 0,
		};

		const { unmount } = render(
			<ProseMirrorVisualEditor
				documentSession={harness.session}
				getGeneratedPreviewIdentity={() => previewIdentity}
				onReady={(rt) => {
					runtimeRef.current = rt;
				}}
			/>,
		);

		const rt = runtimeRef.current as ImmersiveVisualEditorRuntime;
		expect(rt.isTransferPending()).toBe(false);
		expect(rt.needsAcceptedPreviewRefresh?.()).toBe(false);
		expect(rt.refreshAcceptedPreview?.()).toBe(true);
		expect(rt.getGeneratedPreviewIdentity()).toEqual(previewIdentity);

		const paragraphEl = rt.surface.querySelector("p");
		const lease = rt.captureContextMenuTarget(paragraphEl);
		const leaseUntilDispose = rt.captureContextMenuTarget(paragraphEl);
		expect(lease?.resolve()).toBe(paragraphEl);
		lease?.release();
		expect(lease?.resolve()).toBeNull();
		expect(leaseUntilDispose?.resolve()).toBe(paragraphEl);

		const imgEl = rt.surface.querySelector(
			"img:not(.ProseMirror-separator)",
		) as HTMLImageElement;
		expect(rt.prepareContextMenuSelection?.(imgEl, undefined, "pointer")).toBe(
			true,
		);
		const imgSel = harness.session.document.getSelection();
		expect(initialMd.slice(imgSel.start, imgSel.end)).toBe(
			"![Photo](https://example.com/p.png)",
		);
		expect(harness.session.document.getRevision()).toBe(0);

		const imageIndex = buildSingleImageIndex(
			initialMd,
			"Photo",
			"https://example.com/p.png",
		);
		const imgRange = {
			end: imageIndex.images[0]?.end ?? 0,
			start: imageIndex.images[0]?.start ?? 0,
		};
		const imgLease = rt.prepareImageTarget({
			element: imgEl,
			index: imageIndex,
			selection: imgRange,
		});
		expect(imgLease?.isCurrent()).toBe(true);
		expect(imgLease?.target.original.destination).toBe(
			"https://example.com/p.png",
		);
		imgLease?.release();
		expect(imgLease?.isCurrent()).toBe(false);

		const imgPin = rt.prepareImageTargetBySelection({
			index: imageIndex,
			selection: imgRange,
		});
		expect(imgPin?.isCurrent()).toBe(true);
		expect(imgPin?.getLease()?.root).toBe(imgEl);
		imgPin?.release();

		const mathEl = rt.surface.querySelector(".easymde-math") as Element;
		const mermaidEl = rt.surface.querySelector(".easymde-mermaid") as Element;
		const mathStart = initialMd.indexOf("$$");
		const mathEnd = initialMd.indexOf("$$", mathStart + 2) + 2;
		const mermaidStart = initialMd.indexOf("```mermaid");
		const generatedIndex: VisualEditorGeneratedContentTargetIndex = {
			blocks: [
				{
					editable: false,
					from: mermaidStart,
					kind: "code",
					lineEnd: 10,
					lineStart: 8,
					to: initialMd.length,
				},
			],
			length: initialMd.length,
			mathSpans: [
				{
					bodyFrom: mathStart + 3,
					bodyTo: mathEnd - 3,
					displayMode: true,
					from: mathStart,
					to: mathEnd,
				},
			],
			revision: 0,
			source: initialMd,
		};
		const mathLease = rt.prepareGeneratedContentTarget({
			element: mathEl,
			index: generatedIndex,
			kind: "math",
			ordinal: 0,
		});
		expect(mathLease?.isCurrent()).toBe(true);
		expect(mathLease?.target.original.body).toBe("a + b");
		mathLease?.release();

		const mermaidPin = rt.prepareGeneratedContentTargetForSelection({
			index: generatedIndex,
			selection: { end: initialMd.length, start: mermaidStart },
		});
		expect(mermaidPin?.isCurrent()).toBe(true);
		expect(mermaidPin?.getLease()?.root).toBe(mermaidEl);
		expect(mermaidPin?.target.original.body).toBe("graph TD\nA-->B");

		const currentSel = harness.session.document.getSelection();
		expect(
			rt.applyCanonicalChange({
				change: {
					changes: { from: 0, insert: "Updated", to: 5 },
					selection: { direction: "none", end: 7, start: 7 },
					value: `Updated${initialMd.slice(5)}`,
				},
				expected: { revision: 99, selection: currentSel, value: initialMd },
			}),
		).toBe("blocked");

		expect(
			rt.applyCanonicalChange({
				change: {
					changes: { from: 0, insert: "Updated", to: 5 },
					selection: { direction: "none", end: 7, start: 7 },
					value: `Updated${initialMd.slice(5)}`,
				},
				expected: { revision: 0, selection: currentSel, value: initialMd },
			}),
		).toBe("handled");
		expect(rt.surface.querySelector("p")?.textContent).toBe("Updated");
		expect(mermaidPin?.isCurrent()).toBe(false);
		expect(leaseUntilDispose?.resolve()).toBeNull();

		expect(rt.prepareMediaSelection()).toBe(true);
		expect(rt.prepareToolbarFallback()).toBe(true);
		expect(
			rt.prepareSourceNavigation({
				revision: harness.session.document.getRevision(),
				value: harness.session.document.getValue(),
			}),
		).toBe(true);
		expect(rt.prepareSourceNavigation({ revision: 999, value: "stale" })).toBe(
			false,
		);
		unmount();
	});

	it("parses pasted plain Markdown, pastes verbatim inside code blocks, and delegates image paste/drop", () => {
		const harness = createMockDocumentSession("");
		const onImagePaste = vi.fn();
		const onImageDrop = vi.fn();
		const capture = createViewCapturePlugin();
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = {
			current: null,
		};

		render(
			<ProseMirrorVisualEditor
				documentSession={harness.session}
				extraPlugins={[capture.plugin]}
				imagePasteUploadEnabled={true}
				imageUploadEnabled={true}
				onImageDrop={onImageDrop}
				onImagePaste={onImagePaste}
				onReady={(rt) => {
					runtimeRef.current = rt;
				}}
			/>,
		);

		const rt = runtimeRef.current as ImmersiveVisualEditorRuntime;
		const view = capture.getView();

		const triggerPaste = (event: Event): boolean => {
			let handled = false;
			view.someProp("handlePaste", (fn) => {
				if (fn(view, event as ClipboardEvent, view.state.selection.content())) {
					handled = true;
					return true;
				}
				return false;
			});
			return handled;
		};

		expect(
			triggerPaste(
				createFakeTransferEvent("paste", {
					text: "# Pasted Title\n\n- Alpha\n- Beta",
				}),
			),
		).toBe(true);
		expect(rt.surface.querySelector("h1")?.textContent).toBe("Pasted Title");
		expect(rt.surface.querySelectorAll("ul li").length).toBe(2);
		expect(harness.session.document.getValue()).toBe(
			"# Pasted Title\n\n- Alpha\n- Beta",
		);

		const pngFile = new File([new Uint8Array([1, 2, 3])], "shot.png", {
			type: "image/png",
		});
		expect(
			triggerPaste(createFakeTransferEvent("paste", { files: [pngFile] })),
		).toBe(true);
		expect(onImagePaste).toHaveBeenCalledTimes(1);
		expect(onImagePaste.mock.calls[0]?.[0]).toEqual([pngFile]);

		const dropFile = new File([new Uint8Array([4, 5, 6])], "drop.jpg", {
			type: "image/jpeg",
		});
		const dropEvent = createFakeTransferEvent("drop", { files: [dropFile] });
		let dropHandled = false;
		view.someProp("handleDrop", (fn) => {
			if (
				fn(view, dropEvent as DragEvent, view.state.selection.content(), false)
			) {
				dropHandled = true;
				return true;
			}
			return false;
		});
		expect(dropHandled).toBe(true);
		expect(onImageDrop).toHaveBeenCalledTimes(1);
		expect(onImageDrop.mock.calls[0]?.[0]).toEqual([dropFile]);

		act(() => {
			harness.emitExternalChange("```ts\nconst a = 1;\n```", {
				direction: "none",
				end: 18,
				start: 18,
			});
		});
		expect(
			triggerPaste(
				createFakeTransferEvent("paste", { text: "\n# Not a heading" }),
			),
		).toBe(true);
		expect(rt.surface.querySelector("h1")).toBeNull();
		expect(rt.surface.querySelector("pre code")?.textContent).toContain(
			"# Not a heading",
		);
	});
});

type RealSessionHarness = Readonly<{
	destroy: () => void;
	field: HTMLTextAreaElement;
	session: EditorDocumentSession;
}>;

const realSessions: RealSessionHarness[] = [];

afterEach(() => {
	cleanup();
	while (realSessions.length > 0) realSessions.pop()?.destroy();
});

function createRealSession(markdown: string): RealSessionHarness {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const field = document.createElement("textarea");
	field.id = "easymde-source";
	field.defaultValue = markdown;
	field.value = markdown;
	host.appendChild(field);
	const container = document.createElement("div");
	host.appendChild(container);
	const cm = createCodeMirrorDocumentSession({
		container,
		label: "Markdown source",
		submissionField: field,
	});
	const session: EditorDocumentSession = {
		destroy: () => cm.destroy(),
		document: cm,
		getSnapshot: () => ({ dirty: cm.getValue() !== markdown }),
		reconcileSavedBaseline: () => undefined,
		registerSubmissionState: () => undefined,
		replaceSubmissionState: () => undefined,
		subscribe: () => () => undefined,
		title: {
			destroy: () => undefined,
			getSnapshot: () => ({ savedValue: "", value: "" }),
			replaceSavedValue: () => undefined,
			setValue: () => undefined,
			subscribe: () => () => undefined,
		},
	};
	const harness: RealSessionHarness = {
		destroy: () => {
			cm.destroy();
			host.remove();
		},
		field,
		session,
	};
	realSessions.push(harness);
	return harness;
}

function mountVisual(session: EditorDocumentSession): Readonly<{
	onFailure: ReturnType<typeof vi.fn>;
	rt: ImmersiveVisualEditorRuntime;
	unmount: () => void;
	view: EditorView;
}> {
	const capture = createViewCapturePlugin();
	const onFailure = vi.fn();
	const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = {
		current: null,
	};
	const { unmount } = render(
		<ProseMirrorVisualEditor
			documentSession={session}
			extraPlugins={[capture.plugin]}
			onFailure={onFailure}
			onReady={(rt) => {
				runtimeRef.current = rt;
			}}
		/>,
	);
	return {
		onFailure,
		rt: runtimeRef.current as unknown as ImmersiveVisualEditorRuntime,
		unmount,
		view: capture.getView(),
	};
}

const undoCommand = makeToolbarCommand({ action: "undo", id: "undo" });
const redoCommand = makeToolbarCommand({ action: "redo", id: "redo" });

function textEndOfBlock(view: EditorView, index: number): number {
	let pos = 0;
	for (let i = 0; i < index; i += 1) pos += view.state.doc.child(i).nodeSize;
	return pos + view.state.doc.child(index).nodeSize - 1;
}

function setCaret(view: EditorView, pos: number): void {
	view.dispatch(
		view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)),
	);
}

describe("single canonical history owner (real CodeMirror session)", () => {
	it("records one canonical undo step per visual edit and restores bytes exactly across rounds (S1-S6)", () => {
		const original =
			"# Title\n\nAlpha *beta* gamma.\n\n- one\n- two\n\n```js\nconst a = 1;\n```\n\nTail [link](https://x.test) end.\n";
		const { field, session } = createRealSession(original);
		const { rt, view } = mountVisual(session);
		const snapshots = [session.document.getValue()];
		const record = () => snapshots.push(session.document.getValue());

		view.dispatch(view.state.tr.insertText("!", textEndOfBlock(view, 0)));
		record();
		view.dispatch(view.state.tr.insertText(" delta", textEndOfBlock(view, 1)));
		record();
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 4)),
		);
		expect(
			rt.executeCommand(makeToolbarCommand({ action: "bold", id: "bold" })),
		).toBe("handled");
		record();
		setCaret(view, textEndOfBlock(view, 1));
		expect(dispatchKeyDown(view, "Enter")).toBe(true);
		record();
		view.dispatch(view.state.tr.insertText("new", view.state.selection.from));
		record();
		view.dispatch(view.state.tr.delete(2, 3));
		record();
		expect(field.value).toBe(session.document.getValue());
		// The untouched code block and tail stay byte-identical.
		expect(session.document.getValue()).toContain(
			"```js\nconst a = 1;\n```\n\nTail [link](https://x.test) end.\n",
		);

		for (let i = snapshots.length - 1; i > 0; i -= 1) {
			expect(session.document.getValue()).toBe(snapshots[i]);
			expect(rt.executeCommand(undoCommand)).toBe("handled");
		}
		expect(session.document.getValue()).toBe(original);
		expect(field.value).toBe(original);
		expect(view.state.doc.child(0).textContent).toBe("Title");
		expect(rt.executeCommand(undoCommand)).toBe("blocked");
		for (let i = 1; i < snapshots.length; i += 1) {
			expect(rt.executeCommand(redoCommand)).toBe("handled");
			expect(session.document.getValue()).toBe(snapshots[i]);
		}
	});

	it("undoes Ctrl+A + Delete (D3) and keyboard Mod-z through the canonical owner", () => {
		const original =
			"# Title\n\nPara one\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nLast";
		const { session } = createRealSession(original);
		const { rt, view } = mountVisual(session);
		expect(dispatchKeyDown(view, "a", { ctrlKey: true })).toBe(true);
		expect(dispatchKeyDown(view, "Delete")).toBe(true);
		expect(session.document.getValue()).toBe("");
		expect(dispatchKeyDown(view, "z", { ctrlKey: true })).toBe(true);
		expect(session.document.getValue()).toBe(original);
		expect(rt.surface.querySelector("h1")?.textContent).toBe("Title");
		expect(rt.surface.querySelector("table")).not.toBeNull();
		expect(dispatchKeyDown(view, "y", { ctrlKey: true })).toBe(true);
		expect(session.document.getValue()).toBe("");
	});

	it("undoes a context-menu applyCanonicalChange (D4) as its own isolated step", () => {
		const original = "Intro text\n\nSecond";
		const { session } = createRealSession(original);
		const { rt, view } = mountVisual(session);
		view.dispatch(view.state.tr.insertText("X", textEndOfBlock(view, 1)));
		const afterTyping = session.document.getValue();
		expect(rt.prepareContextMenuDemand()).toBe(true);
		const expected = {
			revision: session.document.getRevision(),
			selection: session.document.getSelection(),
			value: afterTyping,
		};
		expect(
			rt.applyCanonicalChange({
				change: {
					changes: { from: 0, insert: "Outro", to: 5 },
					selection: { direction: "none", end: 5, start: 5 },
					value: `Outro${afterTyping.slice(5)}`,
				},
				expected,
			}),
		).toBe("handled");
		expect(rt.surface.querySelector("p")?.textContent).toBe("Outro text");
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(afterTyping);
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(original);
	});

	it("keeps two rapid protected-card commits (D5) as two steps: one undo reverts only the last", () => {
		const original = "Intro\n\n$$\na + b\n$$\n\nEnd";
		const { session } = createRealSession(original);
		const { rt, view } = mountVisual(session);
		const mathPos = view.state.doc.child(0).nodeSize;
		expect(view.state.doc.nodeAt(mathPos)?.type.name).toBe("protected_block");
		const commitRaw = (raw: string) => {
			const node = view.state.doc.nodeAt(mathPos);
			view.dispatch(
				view.state.tr.setNodeMarkup(mathPos, undefined, {
					...node?.attrs,
					rawMarkdown: raw,
				}),
			);
		};
		commitRaw("$$\na + c\n$$");
		commitRaw("$$\na + d\n$$");
		expect(session.document.getValue()).toBe("Intro\n\n$$\na + d\n$$\n\nEnd");
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe("Intro\n\n$$\na + c\n$$\n\nEnd");
		expect(view.state.doc.nodeAt(mathPos)?.attrs.rawMarkdown).toBe(
			"$$\na + c\n$$",
		);
	});

	it("keeps one history across Visual/Source switches (3x cross-mode undo)", () => {
		const original = "First\n\nSecond";
		const { session } = createRealSession(original);
		let mounted = mountVisual(session);
		mounted.view.dispatch(
			mounted.view.state.tr.insertText("A", textEndOfBlock(mounted.view, 0)),
		);
		const step1 = session.document.getValue();
		mounted.unmount();

		// Source mode edit straight into the canonical document.
		session.document.applyTextChange({
			changes: { from: step1.length, insert: "B", to: step1.length },
			isolateHistoryBefore: true,
			selection: {
				direction: "none",
				end: step1.length + 1,
				start: step1.length + 1,
			},
			value: `${step1}B`,
		});
		const step2 = session.document.getValue();

		mounted = mountVisual(session);
		mounted.view.dispatch(
			mounted.view.state.tr.insertText("C", textEndOfBlock(mounted.view, 0)),
		);
		expect(session.document.getValue()).toBe("FirstAC\n\nSecondB");
		expect(mounted.rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(step2);
		mounted.unmount();
		mounted = mountVisual(session);
		expect(mounted.rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(step1);
		expect(mounted.rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(original);
		expect(mounted.view.state.doc.child(1).textContent).toBe("Second");
	});

	it("converts --- + Enter into a rule and an editable paragraph (D2) and undoes it", () => {
		const { session } = createRealSession("Intro\n\nx");
		const { rt, view } = mountVisual(session);
		const start = view.state.doc.child(0).nodeSize + 1;
		view.dispatch(view.state.tr.insertText("---", start, start + 1));
		const beforeEnter = session.document.getValue();
		setCaret(view, textEndOfBlock(view, 1));
		expect(dispatchKeyDown(view, "Enter")).toBe(true);
		expect(view.state.doc.child(1).type.name).toBe("horizontal_rule");
		expect(view.state.doc.child(2).type.name).toBe("paragraph");
		expect(view.state.selection.$from.parent).toBe(view.state.doc.child(2));
		expect(session.document.getValue().startsWith("Intro\n\n---")).toBe(true);
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(beforeEnter);
	});

	it("blocks history truthfully when the canonical owner rejects a write", () => {
		const harness = createMockDocumentSession("Hello");
		harness.applyTextChangeSpy.mockImplementation(() => {
			throw new Error("rejected");
		});
		const { onFailure, rt, view } = mountVisual(harness.session);
		view.dispatch(
			view.state.tr.insertText("!", view.state.doc.content.size - 1),
		);
		expect(onFailure).toHaveBeenCalledWith("visual-editor-sync-failed");
		expect(harness.session.document.getValue()).toBe("Hello");
		expect(view.state.doc.textContent).toBe("Hello");
		expect(rt.executeCommand(undoCommand)).toBe("blocked");
	});
});

describe("exact source index mapping", () => {
	it("maps every table cell independently in both directions", () => {
		const markdown =
			"Lead\n\n| Name | `a\\|b` | Score |\n| :--- | --- | ---: |\n| Alice | x \\| y | 95 |\n| Bob | **z** | 7 |";
		const doc = parseMarkdownToVisualDoc(markdown);
		const table = doc.child(1);
		const tablePos = doc.child(0).nodeSize;
		const lines = markdown.split("\n").slice(2);
		const lineStart = (row: number) =>
			markdown.indexOf(lines[row === 0 ? 0 : row + 1] as string);
		table.forEach((row, rowOffset, rowIndex) => {
			row.forEach((cell, cellOffset, colIndex) => {
				const contentStart = tablePos + 1 + rowOffset + 1 + cellOffset + 2;
				const contentEnd = contentStart + (cell.firstChild?.content.size ?? 0);
				const selection = computeVisualSelectionToMarkdownSelection(
					doc,
					TextSelection.create(doc, contentStart, contentEnd),
					markdown,
				);
				const slice = markdown.slice(selection.start, selection.end);
				expect(selection.start).toBeGreaterThan(lineStart(rowIndex) - 1);
				expect(slice.replace(/[*`]/g, "")).toContain(
					cell.textContent.replace("|", "").slice(0, 1),
				);
				expect(slice.indexOf("\n")).toBe(-1);
				expect(slice.startsWith("|")).toBe(false);
				const caret = computeVisualSelectionToMarkdownSelection(
					doc,
					TextSelection.create(doc, contentEnd),
					markdown,
				);
				const restored = resolveMarkdownSelectionToVisualSelection(
					doc,
					markdown,
					caret,
				);
				expect(restored.from).toBe(contentEnd);
				expect(colIndex).toBeLessThan(3);
			});
		});
	});

	it("maps code blocks by opener, body, and closer and restores NodeSelection for exact atoms", () => {
		const markdown =
			'~~~py\nx = 1\n  y = 2\n~~~\n\nSee ![a](<u v.png> "t {width=50%}") and ![b][ref]\n\n---\n\n[ref]: https://r.test/b.png';
		const doc = parseMarkdownToVisualDoc(markdown);
		const code = doc.child(0);
		const bodyStart = markdown.indexOf("x = 1");
		const caretInBody = computeVisualSelectionToMarkdownSelection(
			doc,
			TextSelection.create(doc, 1 + code.textContent.indexOf("y")),
			markdown,
		);
		expect(caretInBody.start).toBe(markdown.indexOf("y = 2"));
		const openerCaret = resolveMarkdownSelectionToVisualSelection(
			doc,
			markdown,
			{
				direction: "none",
				end: 2,
				start: 2,
			},
		);
		expect(openerCaret.from).toBe(1);
		expect(
			resolveMarkdownSelectionToVisualSelection(doc, markdown, {
				direction: "none",
				end: bodyStart + 2,
				start: bodyStart + 2,
			}).from,
		).toBe(3);
		const images: number[] = [];
		doc.descendants((node, pos) => {
			if (node.type.name === "image") images.push(pos);
			return true;
		});
		const rawA = '![a](<u v.png> "t {width=50%}")';
		const imageSel = computeVisualSelectionToMarkdownSelection(
			doc,
			NodeSelection.create(doc, images[0] as number),
			markdown,
		);
		expect(markdown.slice(imageSel.start, imageSel.end)).toBe(rawA);
		const restored = resolveMarkdownSelectionToVisualSelection(
			doc,
			markdown,
			imageSel,
		);
		expect(restored).toBeInstanceOf(NodeSelection);
		expect(restored.from).toBe(images[0]);
		if (images[1] !== undefined) {
			const refSel = computeVisualSelectionToMarkdownSelection(
				doc,
				NodeSelection.create(doc, images[1]),
				markdown,
			);
			expect(markdown.slice(refSel.start, refSel.end)).toBe("![b][ref]");
		}
		const hrStart = markdown.indexOf("---");
		const hrSel = resolveMarkdownSelectionToVisualSelection(doc, markdown, {
			direction: "none",
			end: hrStart + 3,
			start: hrStart,
		});
		expect(hrSel).toBeInstanceOf(NodeSelection);
	});
});

describe("keyboard anti-stall guards", () => {
	function createKeyView(
		doc: ReturnType<typeof parseMarkdownToVisualDoc>,
	): EditorView {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const view = new EditorView(host, {
			state: EditorState.create({
				doc,
				plugins: [
					history(),
					createVisualTablePlugin(),
					...createVisualKeymapPlugins(),
				],
				schema: visualEditorSchema,
			}),
		});
		standaloneViews.push(view);
		return view;
	}

	it("never deletes a table with Backspace/Delete from outside it", () => {
		const view = createKeyView(
			parseMarkdownToVisualDoc(
				"Para\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter",
			),
		);
		const afterStart = textEndOfBlock(view, 2) - "After".length;
		setCaret(view, afterStart);
		expect(dispatchKeyDown(view, "Backspace")).toBe(true);
		expect(view.state.doc.child(1).type.name).toBe("table");
		expect(view.state.doc.child(2).textContent).toBe("After");
		expect(view.state.selection.$from.parent.textContent).toBe("2");
		expect(view.state.selection.$from.parentOffset).toBe(1);

		setCaret(view, textEndOfBlock(view, 0));
		expect(dispatchKeyDown(view, "Delete")).toBe(true);
		expect(view.state.doc.child(1).type.name).toBe("table");
		expect(view.state.doc.child(0).textContent).toBe("Para");
		expect(view.state.selection.$from.parent.textContent).toBe("A");
		expect(view.state.selection.$from.parentOffset).toBe(0);

		const tablePos = view.state.doc.child(0).nodeSize;
		view.dispatch(
			view.state.tr.setSelection(
				NodeSelection.create(view.state.doc, tablePos),
			),
		);
		expect(dispatchKeyDown(view, "Backspace")).toBe(true);
		expect(view.state.doc.child(1).type.name).toBe("table");
	});

	it("deletes only the empty paragraph between text and a table", () => {
		const base = parseMarkdownToVisualDoc(
			"| A | B |\n| --- | --- |\n| 1 | 2 |",
		);
		const doc = visualEditorSchema.nodes.doc.create(null, [
			base.child(0),
			visualEditorSchema.nodes.paragraph.create(),
		]);
		const view = createKeyView(doc);
		setCaret(view, view.state.doc.content.size - 1);
		expect(dispatchKeyDown(view, "Backspace")).toBe(true);
		expect(view.state.doc.childCount).toBe(1);
		expect(view.state.doc.child(0).type.name).toBe("table");
		expect(view.state.selection.$from.parent.textContent).toBe("2");
	});

	it("moves out of a code block on Delete, outdents on Shift+Tab, and keeps ~~~ fences", () => {
		const view = createKeyView(
			parseMarkdownToVisualDoc("```js\n  a\n  b\n```\n\nNext"),
		);
		setCaret(view, textEndOfBlock(view, 0));
		expect(dispatchKeyDown(view, "Delete")).toBe(true);
		expect(view.state.doc.childCount).toBe(2);
		expect(view.state.selection.$from.parent.textContent).toBe("Next");
		expect(view.state.selection.$from.parentOffset).toBe(0);

		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, 1, textEndOfBlock(view, 0)),
			),
		);
		expect(dispatchKeyDown(view, "Tab", { shiftKey: true })).toBe(true);
		expect(view.state.doc.child(0).textContent).toBe("a\nb");
		expect(dispatchKeyDown(view, "Tab", { shiftKey: true })).toBe(true);
		expect(view.state.doc.child(0).textContent).toBe("a\nb");
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, 1, textEndOfBlock(view, 0)),
			),
		);
		expect(dispatchKeyDown(view, "Tab")).toBe(true);
		expect(view.state.doc.child(0).textContent).toBe("  a\n  b");

		const eofView = createKeyView(parseMarkdownToVisualDoc("```\ncode\n```"));
		setCaret(eofView, textEndOfBlock(eofView, 0));
		const before = eofView.state.doc;
		expect(dispatchKeyDown(eofView, "Delete")).toBe(true);
		expect(eofView.state.doc.eq(before)).toBe(true);

		const fenceView = createKeyView(parseMarkdownToVisualDoc("~~~py"));
		setCaret(fenceView, textEndOfBlock(fenceView, 0));
		expect(dispatchKeyDown(fenceView, "Enter")).toBe(true);
		expect(fenceView.state.doc.child(0).type.name).toBe("code_block");
		expect(fenceView.state.doc.child(0).attrs.fenceChar).toBe("~");
	});
});

describe("Wave 5 fixes: grouped typing history and empty-document reset (R1, R4)", () => {
	const typeText = (view: EditorView, text: string) => {
		for (const ch of text) view.dispatch(view.state.tr.insertText(ch));
	};
	const undoUntil = (
		rt: ImmersiveVisualEditorRuntime,
		session: EditorDocumentSession,
		target: string,
		maxSteps: number,
	): number => {
		let steps = 0;
		while (session.document.getValue() !== target && steps < maxSteps) {
			expect(rt.executeCommand(undoCommand)).toBe("handled");
			steps += 1;
		}
		return steps;
	};

	it("groups a fast 44-character typing burst into few undo steps and redoes it", () => {
		const original = "Intro\n\nLast";
		const { session } = createRealSession(original);
		const { rt, view } = mountVisual(session);
		setCaret(view, textEndOfBlock(view, 1));
		const burst = " const total = 1; return total + 1; done ok.";
		expect(burst.length).toBe(44);
		typeText(view, burst);
		expect(session.document.getValue()).toBe(`${original}${burst}`);
		const steps = undoUntil(rt, session, original, 10);
		expect(session.document.getValue()).toBe(original);
		expect(steps).toBeLessThanOrEqual(5);
		for (let i = 0; i < steps; i += 1) rt.executeCommand(redoCommand);
		expect(session.document.getValue()).toBe(`${original}${burst}`);
	});

	it("breaks the typing run on a caret move and keeps Ctrl+A + Delete (D3) discrete", () => {
		const original = "Intro\n\nLast";
		const { session } = createRealSession(original);
		const { rt, view } = mountVisual(session);
		setCaret(view, textEndOfBlock(view, 1));
		typeText(view, "ab");
		setCaret(view, textEndOfBlock(view, 0));
		typeText(view, "cd");
		const typed = "Introcd\n\nLastab";
		expect(session.document.getValue()).toBe(typed);
		expect(dispatchKeyDown(view, "a", { ctrlKey: true })).toBe(true);
		expect(dispatchKeyDown(view, "Delete")).toBe(true);
		expect(session.document.getValue()).toBe("");
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(typed);
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe("Intro\n\nLastab");
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(original);
	});

	it("keeps a deletion and a context-menu change (D4) as isolated steps after typing", () => {
		const original = "Intro text\n\nSecond";
		const { session } = createRealSession(original);
		const { rt, view } = mountVisual(session);
		setCaret(view, textEndOfBlock(view, 1));
		typeText(view, "XY");
		const afterTyping = session.document.getValue();
		const head = view.state.selection.head;
		view.dispatch(view.state.tr.delete(head - 1, head));
		const afterBackspace = session.document.getValue();
		expect(afterBackspace).toBe("Intro text\n\nSecondX");
		expect(rt.prepareContextMenuDemand()).toBe(true);
		expect(
			rt.applyCanonicalChange({
				change: {
					changes: { from: 0, insert: "Outro", to: 5 },
					selection: { direction: "none", end: 5, start: 5 },
					value: `Outro${afterBackspace.slice(5)}`,
				},
				expected: {
					revision: session.document.getRevision(),
					selection: session.document.getSelection(),
					value: afterBackspace,
				},
			}),
		).toBe("handled");
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(afterBackspace);
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(afterTyping);
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(original);
	});

	it("ends the typing run when Enter inside a code block leaves Markdown unchanged", () => {
		const original = "Intro\n\n```js\nconst a = 1;\n```";
		const { session } = createRealSession(original);
		const { rt, view } = mountVisual(session);
		setCaret(view, textEndOfBlock(view, 1));
		typeText(view, "x");
		const afterFirstLine = session.document.getValue();
		expect(dispatchKeyDown(view, "Enter")).toBe(true);
		typeText(view, "y");
		expect(session.document.getValue()).not.toBe(afterFirstLine);
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(
			session.document.getValue() === afterFirstLine ||
				session.document.getValue() === "Intro\n\n```js\nconst a = 1;x\n\n```",
		).toBe(true);
		undoUntil(rt, session, original, 4);
		expect(session.document.getValue()).toBe(original);
	});

	it("types exact content into a document emptied by Ctrl+A + Delete and undoes byte-exactly (R4)", () => {
		const original = "foo\n\n";
		const { session } = createRealSession(original);
		const { rt, view } = mountVisual(session);
		expect(dispatchKeyDown(view, "a", { ctrlKey: true })).toBe(true);
		expect(dispatchKeyDown(view, "Delete")).toBe(true);
		expect(session.document.getValue()).toBe("");
		typeText(view, "ok");
		expect(session.document.getValue()).toBe("ok");
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe("");
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(original);
	});

	it("types exact content after Backspacing a trailing-newline document to empty (R4)", () => {
		const original = "foo\n";
		const { session } = createRealSession(original);
		const { rt, view } = mountVisual(session);
		setCaret(view, textEndOfBlock(view, 0));
		for (let i = 0; i < 3; i += 1) {
			const head = view.state.selection.head;
			view.dispatch(view.state.tr.delete(head - 1, head));
		}
		expect(session.document.getValue()).toBe("");
		typeText(view, "ok");
		expect(session.document.getValue()).toBe("ok");
		undoUntil(rt, session, original, 6);
		expect(session.document.getValue()).toBe(original);
	});
});

describe("Wave 5 fixes: block-boundary keyboard and atom selection (R2, R3)", () => {
	const nodes = visualEditorSchema.nodes;
	function createBoundaryView(
		doc: ReturnType<typeof parseMarkdownToVisualDoc>,
		withNodeViews = false,
	): EditorView {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const view = new EditorView(host, {
			...(withNodeViews
				? { nodeViews: { protected_block: createProtectedBlockNodeView() } }
				: {}),
			state: EditorState.create({
				doc,
				plugins: [
					history(),
					gapCursor(),
					createAtomicSelectionAnchorPlugin(),
					createVisualTablePlugin(),
					...createVisualKeymapPlugins(),
				],
				schema: visualEditorSchema,
			}),
		});
		standaloneViews.push(view);
		return view;
	}
	const withTrailingEmptyParagraph = (markdown: string) => {
		const base = parseMarkdownToVisualDoc(markdown);
		const children: Array<ReturnType<typeof parseMarkdownToVisualDoc>> = [];
		base.forEach((child) => {
			children.push(child);
		});
		return nodes.doc.create(null, [...children, nodes.paragraph.create()]);
	};
	const anchorCount = (view: EditorView) =>
		view.dom.querySelectorAll(`[${ATOMIC_SELECTION_ANCHOR_ATTRIBUTE}]`).length;

	for (const markdown of ["- a", "1. a", "- [ ] a", "> a", "- x\n  - a"]) {
		it(`Backspace in an empty paragraph after ${JSON.stringify(markdown)} moves into the container without oscillating (R2)`, () => {
			const view = createBoundaryView(withTrailingEmptyParagraph(markdown));
			setCaret(view, view.state.doc.content.size - 1);
			expect(dispatchKeyDown(view, "Backspace")).toBe(true);
			expect(view.state.doc.childCount).toBe(1);
			expect(view.state.selection.$from.parent.textContent).toBe("a");
			expect(view.state.selection.$from.parentOffset).toBe(1);
			// Keyboard Backspace; plain character deletion is native in the
			// browser, so emulate it when no command claims the key.
			const seen = new Set<string>();
			for (let i = 0; i < 20 && view.state.doc.textContent !== ""; i += 1) {
				const key = `${JSON.stringify(view.state.doc.toJSON())}@${view.state.selection.head}`;
				expect(seen.has(key)).toBe(false);
				seen.add(key);
				if (!dispatchKeyDown(view, "Backspace")) {
					const head = view.state.selection.head;
					view.dispatch(view.state.tr.delete(head - 1, head));
				}
			}
			expect(view.state.doc.textContent).toBe("");
		});
	}

	it("keeps Backspace into a non-empty paragraph after a list unchanged (R2)", () => {
		const view = createBoundaryView(parseMarkdownToVisualDoc("- a\n\nb"));
		setCaret(view, view.state.doc.content.size - 2);
		expect(dispatchKeyDown(view, "Backspace")).toBe(true);
		expect(view.state.doc.textContent).toBe("ab");
	});

	it("Mod-End / Mod-Home land on edge gap cursors beside atoms and on text otherwise (R3)", () => {
		const trailing = createBoundaryView(
			parseMarkdownToVisualDoc("Intro\n\n$$\nx\n$$"),
		);
		expect(dispatchKeyDown(trailing, "End", { ctrlKey: true })).toBe(true);
		expect(trailing.state.selection).toBeInstanceOf(GapCursor);
		expect(trailing.state.selection.head).toBe(trailing.state.doc.content.size);
		expect(anchorCount(trailing)).toBe(1);
		expect(dispatchKeyDown(trailing, "ArrowDown")).toBe(true);
		expect(dispatchKeyDown(trailing, "ArrowRight")).toBe(true);
		expect(trailing.state.selection.head).toBe(trailing.state.doc.content.size);

		const leading = createBoundaryView(
			parseMarkdownToVisualDoc("---\n\nIntro"),
		);
		expect(dispatchKeyDown(leading, "Home", { ctrlKey: true })).toBe(true);
		expect(leading.state.selection).toBeInstanceOf(GapCursor);
		expect(leading.state.selection.head).toBe(0);
		expect(dispatchKeyDown(leading, "ArrowUp")).toBe(true);
		expect(leading.state.selection.head).toBe(0);

		const text = createBoundaryView(parseMarkdownToVisualDoc("Intro\n\nLast"));
		expect(dispatchKeyDown(text, "End", { ctrlKey: true })).toBe(true);
		expect(text.state.selection).toBeInstanceOf(TextSelection);
		expect(text.state.selection.head).toBe(text.state.doc.content.size - 1);
		expect(dispatchKeyDown(text, "Home", { ctrlKey: true })).toBe(true);
		expect(text.state.selection.head).toBe(1);
		expect(anchorCount(text)).toBe(0);
	});

	it("Backspace from a trailing gap cursor selects, then deletes, the atom without jumping to BOF (R3)", () => {
		const view = createBoundaryView(
			parseMarkdownToVisualDoc("Intro\n\n---\n\n$$\nx\n$$"),
		);
		dispatchKeyDown(view, "End", { ctrlKey: true });
		expect(dispatchKeyDown(view, "Backspace")).toBe(true);
		expect(view.state.selection).toBeInstanceOf(NodeSelection);
		expect((view.state.selection as NodeSelection).node.type.name).toBe(
			"protected_block",
		);
		// Uneditable-bounded NodeSelection (rule before, document end after).
		expect(anchorCount(view)).toBe(1);
		const serializedWithAnchor = serializeVisualDocToMarkdown(view.state.doc);
		expect(serializedWithAnchor).not.toContain("<br");
		expect(dispatchKeyDown(view, "Backspace")).toBe(true);
		expect(view.state.doc.childCount).toBe(2);
		expect(view.state.selection).toBeInstanceOf(GapCursor);
		expect(view.state.selection.head).toBe(view.state.doc.content.size);
		expect(dispatchKeyDown(view, "Backspace")).toBe(true);
		expect(dispatchKeyDown(view, "Backspace")).toBe(true);
		expect(view.state.doc.childCount).toBe(1);
		expect(view.state.selection.$from.parent.textContent).toBe("Intro");
		expect(view.state.selection.$from.parentOffset).toBe(5);
	});

	it("Delete from a leading gap cursor selects, then deletes, the atom (R3)", () => {
		const view = createBoundaryView(parseMarkdownToVisualDoc("---\n\nIntro"));
		dispatchKeyDown(view, "Home", { ctrlKey: true });
		expect(dispatchKeyDown(view, "Delete")).toBe(true);
		expect(view.state.selection).toBeInstanceOf(NodeSelection);
		expect(dispatchKeyDown(view, "Delete")).toBe(true);
		expect(view.state.doc.childCount).toBe(1);
		expect(view.state.selection.$from.parent.textContent).toBe("Intro");
		expect(view.state.selection.$from.parentOffset).toBe(0);
	});

	it("gap cursor Backspace/Delete beside a table moves into its cells and never deletes it (R3)", () => {
		const table = parseMarkdownToVisualDoc(
			"| A | B |\n| --- | --- |\n| 1 | 2 |",
		);
		const view = createBoundaryView(table);
		view.dispatch(
			view.state.tr.setSelection(
				new GapCursor(view.state.doc.resolve(view.state.doc.content.size)),
			),
		);
		expect(dispatchKeyDown(view, "Backspace")).toBe(true);
		expect(view.state.doc.child(0).type.name).toBe("table");
		expect(view.state.selection.$from.parent.textContent).toBe("2");
		expect(view.state.selection.$from.parentOffset).toBe(1);
		view.dispatch(
			view.state.tr.setSelection(new GapCursor(view.state.doc.resolve(0))),
		);
		expect(dispatchKeyDown(view, "Delete")).toBe(true);
		expect(view.state.doc.child(0).type.name).toBe("table");
		expect(view.state.selection.$from.parent.textContent).toBe("A");
		expect(view.state.selection.$from.parentOffset).toBe(0);

		const behind = createBoundaryView(
			parseMarkdownToVisualDoc("| A |\n| --- |\n| 1 |\n\n$$\nx\n$$"),
		);
		dispatchKeyDown(behind, "End", { ctrlKey: true });
		dispatchKeyDown(behind, "Backspace");
		dispatchKeyDown(behind, "Backspace");
		expect(behind.state.doc.childCount).toBe(1);
		expect(behind.state.doc.child(0).type.name).toBe("table");
		expect(behind.state.selection.$from.parent.textContent).toBe("1");
	});

	it("selects a protected card as a NodeSelection on left mousedown only (R3a)", () => {
		const view = createBoundaryView(
			parseMarkdownToVisualDoc("Intro\n\n$$\nx\n$$\n\n---"),
			true,
		);
		const card = view.dom.querySelector(
			"[data-easymde-protected-block]",
		) as HTMLElement;
		const preview = card.querySelector(
			".easymde-protected-preview",
		) as HTMLElement;
		const cardPos = view.state.doc.child(0).nodeSize;
		const actionButton = card.querySelector("button") as HTMLElement;
		actionButton.dispatchEvent(
			new MouseEvent("mousedown", {
				bubbles: true,
				button: 0,
				cancelable: true,
			}),
		);
		expect(view.state.selection).not.toBeInstanceOf(NodeSelection);
		const left = new MouseEvent("mousedown", {
			bubbles: true,
			button: 0,
			cancelable: true,
		});
		preview.dispatchEvent(left);
		expect(left.defaultPrevented).toBe(true);
		expect(view.state.selection).toBeInstanceOf(NodeSelection);
		expect(view.state.selection.from).toBe(cardPos);
		// Text before, rule after: Blink holds this selection, so no anchor.
		expect(anchorCount(view)).toBe(0);
	});

	it("parks and restores CodeMirror visual-editing mode across mount, unmount, and onReady failure", () => {
		const { session } = createRealSession("Alpha\n\nBeta");
		const setVisualEditingActive = vi.spyOn(
			session.document,
			"setVisualEditingActive",
		);
		const { unmount } = mountVisual(session);
		expect(setVisualEditingActive).toHaveBeenCalledTimes(1);
		expect(setVisualEditingActive).toHaveBeenLastCalledWith(true);
		unmount();
		expect(setVisualEditingActive).toHaveBeenCalledTimes(2);
		expect(setVisualEditingActive).toHaveBeenLastCalledWith(false);

		setVisualEditingActive.mockClear();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		try {
			expect(() =>
				render(
					<ProseMirrorVisualEditor
						documentSession={session}
						onReady={() => {
							throw new Error("ready-failed");
						}}
					/>,
				),
			).toThrow("ready-failed");
		} finally {
			consoleError.mockRestore();
		}
		expect(setVisualEditingActive).toHaveBeenNthCalledWith(1, true);
		expect(setVisualEditingActive).toHaveBeenNthCalledWith(2, false);
	});
});
