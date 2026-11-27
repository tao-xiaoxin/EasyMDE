import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "@wordpress/element";
import type { Node as ProseMirrorNode } from "prosemirror-model";
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
import { createEditorMarkdownBlockIndex } from "../editor-context-menu/editor-markdown-block-index";
import { pairMathSpanIndexToDomIndex } from "../generated-content-export/generated-math-pairing";
import { MountedProseMirrorVisualEditor } from "./MountedProseMirrorVisualEditor";
import {
	parseMarkdownToVisualDoc,
	parseMarkdownWithBlockSources,
} from "./markdown-parser";
import {
	createMarkdownRoundTripGuard,
	serializeVisualDocToMarkdown,
} from "./markdown-serializer";
import {
	createProtectedBlockNodeView,
	extractInlineMathTex,
	isDisplayMathMarkdown,
} from "./node-views/protected-atom-node-view";
import { ProseMirrorVisualEditor } from "./ProseMirrorVisualEditor";
import {
	ATOMIC_SELECTION_ANCHOR_ATTRIBUTE,
	createAtomicSelectionAnchorPlugin,
} from "./visual-boundary-commands";
import { createVisualKeymapPlugins } from "./visual-commands";
import { findGeneratedContentOriginal } from "./visual-context-menu-target-resolution";
import {
	captureVisualEmptyParagraphLayout,
	inferVisualEmptyParagraphLayoutFromCanonical,
	restoreVisualEmptyParagraphLayout,
} from "./visual-empty-paragraph-layout";
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

	it("rebinds the round-trip guard to the live reconciled doc after Undo so surviving identical blocks keep their spelling", () => {
		const original = "*same*\n\n_same_\n\nEnd";
		const { field, session } = createRealSession(original);
		const { rt, view } = mountVisual(session);

		view.dispatch(view.state.tr.insertText("!", textEndOfBlock(view, 2)));
		expect(session.document.getValue()).toBe("*same*\n\n_same_\n\nEnd!");
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(original);

		// The reconcile kept the surviving paragraph instances alive.
		const survivor = view.state.doc.child(1);
		view.dispatch(view.state.tr.delete(0, view.state.doc.child(0).nodeSize));
		expect(view.state.doc.child(0)).toBe(survivor);
		expect(session.document.getValue()).toBe("_same_\n\nEnd");
		expect(field.value).toBe("_same_\n\nEnd");

		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(original);
		expect(rt.executeCommand(redoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe("_same_\n\nEnd");
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

	it("inserts standalone paragraphs above and below all 9 block kinds in Visual with typing and byte-exact Undo (D4)", () => {
		const blockCases = [
			{
				label: "paragraph",
				markdown: "普通段落，包含 **加粗** 结束。",
			},
			{
				label: "heading",
				markdown: "## 二级标题",
			},
			{
				label: "bullet-list",
				markdown: "- item 1\n- item 2",
			},
			{
				label: "blockquote",
				markdown: "> quote line",
			},
			{
				label: "code-block",
				markdown: "```js\nconst a = 1;\n```",
			},
			{
				label: "table",
				markdown: "| c1 | c2 |\n| --- | --- |\n| c3 | c4 |",
			},
			{
				label: "block-math",
				markdown: "$$\nE = mc^2\n$$",
			},
			{
				label: "mermaid",
				markdown: "```mermaid\ngraph TD;\n  A-->B;\n```",
			},
			{
				label: "thematic-break",
				markdown: "---",
			},
		] as const;

		const fullDoc = [
			"Lead paragraph",
			...blockCases.map((entry) => entry.markdown),
			"Tail paragraph",
		].join("\n\n");

		for (const entry of blockCases) {
			const from =
				entry.label === "thematic-break"
					? fullDoc.lastIndexOf(entry.markdown)
					: fullDoc.indexOf(entry.markdown);
			const to = from + entry.markdown.length;
			for (const relative of ["before", "after"] as const) {
				const { session } = createRealSession(fullDoc);
				const { rt, unmount, view } = mountVisual(session);
				const initialCount = view.state.doc.childCount;
				const result = rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					relative,
					targetRange: { from, to },
				});
				expect(result, `${entry.label}:${relative}`).toBe("handled");
				expect(view.state.doc.childCount).toBe(initialCount + 1);
				expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
				expect(view.state.selection.$from.parent.textContent).toBe("");

				// 1-step Undo directly after inserting the empty paragraph restores exact bytes.
				expect(rt.executeCommand(undoCommand)).toBe("handled");
				expect(session.document.getValue()).toBe(fullDoc);

				// Insert again and immediately type NEWPARA char-by-char.
				const secondResult = rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					relative,
					targetRange: { from, to },
				});
				expect(secondResult).toBe("handled");
				for (const ch of "NEWPARA") {
					view.dispatch(view.state.tr.insertText(ch));
				}

				expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
				expect(view.state.selection.$from.parent.textContent).toBe("NEWPARA");
				const paragraphs = Array.from(rt.surface.querySelectorAll("p")).map(
					(p) => p.textContent,
				);
				expect(paragraphs).toContain("NEWPARA");

				const expectedMarkdown =
					relative === "before"
						? `${fullDoc.slice(0, from)}NEWPARA\n\n${fullDoc.slice(from)}`
						: `${fullDoc.slice(0, to)}\n\nNEWPARA${fullDoc.slice(to)}`;
				expect(
					session.document.getValue(),
					`${entry.label}:${relative}:markdown`,
				).toBe(expectedMarkdown);

				// Undo typing, then undo paragraph insertion -> byte-exact original.
				expect(rt.executeCommand(undoCommand)).toBe("handled");
				expect(rt.executeCommand(undoCommand)).toBe("handled");
				expect(session.document.getValue()).toBe(fullDoc);
				unmount();
			}
		}
	});

	it("inserts standalone paragraphs at Visual document start and end with typing and Undo", () => {
		const original = "# Heading\n\nFinal block";
		for (const scenario of [
			{
				expectedAfterType: `NEWPARA\n\n${original}`,
				relative: "before" as const,
				targetRange: { from: 0, to: "# Heading".length },
			},
			{
				expectedAfterType: `${original}\n\nNEWPARA`,
				relative: "after" as const,
				targetRange: {
					from: original.indexOf("Final block"),
					to: original.length,
				},
			},
		]) {
			const { session } = createRealSession(original);
			const { rt, unmount, view } = mountVisual(session);
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					relative: scenario.relative,
					targetRange: scenario.targetRange,
				}),
			).toBe("handled");

			for (const ch of "NEWPARA") {
				view.dispatch(view.state.tr.insertText(ch));
			}
			expect(session.document.getValue()).toBe(scenario.expectedAfterType);
			expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
			expect(view.state.selection.$from.parent.textContent).toBe("NEWPARA");

			expect(rt.executeCommand(undoCommand)).toBe("handled");
			expect(rt.executeCommand(undoCommand)).toBe("handled");
			expect(session.document.getValue()).toBe(original);
			unmount();
		}
	});

	it("blocks stale insertParagraphRelative preconditions and preserves nested code containers", () => {
		const quoteSource = ["> ```js", "> code", "> ```", "> tail"].join("\n");
		const { session } = createRealSession(quoteSource);
		const { rt, unmount, view } = mountVisual(session);

		// Stale revision blocks without writing.
		expect(
			rt.insertParagraphRelative?.({
				expected: {
					revision: session.document.getRevision() + 1,
					selection: session.document.getSelection(),
					value: quoteSource,
				},
				relative: "before",
				targetRange: { from: 0, to: quoteSource.length },
			}),
		).toBe("blocked");
		expect(session.document.getValue()).toBe(quoteSource);

		// Place caret inside the nested code block inside blockquote.
		let codeContentPos = -1;
		view.state.doc.descendants((node, pos) => {
			if (node.type.name === "code_block" && codeContentPos < 0) {
				codeContentPos = pos + 1;
				return false;
			}
			return true;
		});
		expect(codeContentPos).toBeGreaterThan(0);
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, codeContentPos),
			),
		);
		rt.prepareToolbarFallback();

		expect(
			rt.insertParagraphRelative?.({
				expected: {
					revision: session.document.getRevision(),
					selection: session.document.getSelection(),
					value: session.document.getValue(),
				},
				nestedCode: true,
				relative: "before",
				targetRange: { from: 0, to: quoteSource.indexOf("> tail") - 1 },
			}),
		).toBe("handled");
		for (const ch of "NEWPARA") {
			view.dispatch(view.state.tr.insertText(ch));
		}
		expect(view.state.doc.child(0).type.name).toBe("blockquote");
		expect(session.document.getValue()).toContain("> NEWPARA");
		expect(session.document.getValue()).toContain("> ```js");
		unmount();
	});

	it("preserves exact bytes of untouched blockquote/list content and fence spelling when inserting a paragraph around nested code", () => {
		const quoteSource = [
			"> _keep_",
			">",
			"> ~~~   js",
			"> x",
			"> ~~~~~",
		].join("\n");
		const fenceFrom = quoteSource.indexOf("> ~~~   js");
		const fenceTo = quoteSource.length;

		for (const relative of ["before", "after"] as const) {
			const { session } = createRealSession(quoteSource);
			const { rt, unmount, view } = mountVisual(session);
			let codeContentPos = -1;
			view.state.doc.descendants((node, pos) => {
				if (node.type.name === "code_block" && codeContentPos < 0) {
					codeContentPos = pos + 1;
					return false;
				}
				return true;
			});
			expect(codeContentPos).toBeGreaterThan(0);
			view.dispatch(
				view.state.tr.setSelection(
					TextSelection.create(view.state.doc, codeContentPos),
				),
			);
			rt.prepareToolbarFallback();

			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative,
					targetRange: { from: fenceFrom, to: fenceTo },
				}),
			).toBe("handled");

			const expectedAfterInsert =
				relative === "before"
					? ["> _keep_", ">", "> ", "> ~~~   js", "> x", "> ~~~~~"].join("\n")
					: ["> _keep_", ">", "> ~~~   js", "> x", "> ~~~~~", "> "].join("\n");
			expect(session.document.getValue()).toBe(expectedAfterInsert);
			expect(session.document.getValue()).toContain("> _keep_");
			expect(session.document.getValue()).toContain("> ~~~   js");
			expect(session.document.getValue()).toContain("> ~~~~~");
			expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
			expect(view.state.selection.$from.parent.textContent).toBe("");
			expect(view.state.doc.child(0).type.name).toBe("blockquote");
			expect(view.state.doc.child(0).childCount).toBe(3);

			// 1-step Undo restores exact original Markdown and ProseMirror state.
			expect(rt.executeCommand(undoCommand)).toBe("handled");
			expect(session.document.getValue()).toBe(quoteSource);
			expect(view.state.doc.child(0).childCount).toBe(2);
			unmount();
		}

		// Nested fenced code inside a list item preserves untouched list content and fence spelling.
		const listSource = ["- _keep_", "", "  ~~~   js", "  x", "  ~~~~~"].join(
			"\n",
		);
		const { session: listSession } = createRealSession(listSource);
		const { rt: listRt, unmount: unmountList, view: listView } =
			mountVisual(listSession);
		let listCodePos = -1;
		listView.state.doc.descendants((node, pos) => {
			if (node.type.name === "code_block" && listCodePos < 0) {
				listCodePos = pos + 1;
				return false;
			}
			return true;
		});
		listView.dispatch(
			listView.state.tr.setSelection(
				TextSelection.create(listView.state.doc, listCodePos),
			),
		);
		listRt.prepareToolbarFallback();
		expect(
			listRt.insertParagraphRelative?.({
				expected: {
					revision: listSession.document.getRevision(),
					selection: listSession.document.getSelection(),
					value: listSession.document.getValue(),
				},
				nestedCode: true,
				relative: "before",
				targetRange: {
					from: listSource.indexOf("  ~~~   js"),
					to: listSource.length,
				},
			}),
		).toBe("handled");
		expect(listSession.document.getValue()).toBe(
			["- _keep_", "", "  ", "  ~~~   js", "  x", "  ~~~~~"].join("\n"),
		);
		expect(listRt.executeCommand(undoCommand)).toBe("handled");
		expect(listSession.document.getValue()).toBe(listSource);
		unmountList();
	});

	it("updates roundTripGuard atomically after nested-code paragraph insertion so subsequent sibling-block and sibling-list-item edits preserve untouched bytes", () => {
		const quoteWithTail = [
			"> _keep_",
			">",
			"> ~~~   js",
			"> x",
			"> ~~~~~",
			"",
			"Tail",
		].join("\n");
		const { session: quoteSession } = createRealSession(quoteWithTail);
		const { rt: quoteRt, unmount: unmountQuote, view: quoteView } =
			mountVisual(quoteSession);
		let quoteCodePos = -1;
		quoteView.state.doc.descendants((node, pos) => {
			if (node.type.name === "code_block" && quoteCodePos < 0) {
				quoteCodePos = pos + 1;
				return false;
			}
			return true;
		});
		quoteView.dispatch(
			quoteView.state.tr.setSelection(
				TextSelection.create(quoteView.state.doc, quoteCodePos),
			),
		);
		quoteRt.prepareToolbarFallback();
		expect(
			quoteRt.insertParagraphRelative?.({
				expected: {
					revision: quoteSession.document.getRevision(),
					selection: quoteSession.document.getSelection(),
					value: quoteSession.document.getValue(),
				},
				nestedCode: true,
				relative: "before",
				targetRange: {
					from: quoteWithTail.indexOf("> ~~~   js"),
					to: quoteWithTail.indexOf("> ~~~~~") + "> ~~~~~".length,
				},
			}),
		).toBe("handled");
		expect(quoteSession.document.getValue()).toBe(
			["> _keep_", ">", "> ", "> ~~~   js", "> x", "> ~~~~~", "", "Tail"].join(
				"\n",
			),
		);

		// Edit the unrelated sibling paragraph `Tail` -> `Tail edited`.
		setCaret(quoteView, textEndOfBlock(quoteView, 1));
		quoteView.dispatch(quoteView.state.tr.insertText(" edited"));
		expect(quoteSession.document.getValue()).toBe(
			[
				"> _keep_",
				">",
				"> ",
				"> ~~~   js",
				"> x",
				"> ~~~~~",
				"",
				"Tail edited",
			].join("\n"),
		);
		unmountQuote();

		// Multi-item list: insert paragraph above nested code in item 0, then edit item 1.
		const multiItemList = [
			"- _keep_",
			"",
			"  ~~~   js",
			"  x",
			"  ~~~~~",
			"- Second item",
		].join("\n");
		const { session: listSession } = createRealSession(multiItemList);
		const { rt: listRt, unmount: unmountList, view: listView } =
			mountVisual(listSession);
		let listCodePos = -1;
		listView.state.doc.descendants((node, pos) => {
			if (node.type.name === "code_block" && listCodePos < 0) {
				listCodePos = pos + 1;
				return false;
			}
			return true;
		});
		listView.dispatch(
			listView.state.tr.setSelection(
				TextSelection.create(listView.state.doc, listCodePos),
			),
		);
		listRt.prepareToolbarFallback();
		expect(
			listRt.insertParagraphRelative?.({
				expected: {
					revision: listSession.document.getRevision(),
					selection: listSession.document.getSelection(),
					value: listSession.document.getValue(),
				},
				nestedCode: true,
				relative: "before",
				targetRange: {
					from: multiItemList.indexOf("  ~~~   js"),
					to: multiItemList.indexOf("  ~~~~~") + "  ~~~~~".length,
				},
			}),
		).toBe("handled");
		expect(listSession.document.getValue()).toBe(
			[
				"- _keep_",
				"",
				"  ",
				"  ~~~   js",
				"  x",
				"  ~~~~~",
				"- Second item",
			].join("\n"),
		);

		// Edit `Second item` -> `Second item edited` and verify item 0 stays byte-identical.
		let secondItemEndPos = -1;
		listView.state.doc.descendants((node, pos) => {
			if (node.isText && node.text === "Second item") {
				secondItemEndPos = pos + node.text.length;
				return false;
			}
			return true;
		});
		expect(secondItemEndPos).toBeGreaterThan(0);
		setCaret(listView, secondItemEndPos);
		listView.dispatch(listView.state.tr.insertText(" edited"));
		expect(listSession.document.getValue()).toBe(
			[
				"- _keep_",
				"",
				"  ",
				"  ~~~   js",
				"  x",
				"  ~~~~~",
				"- Second item edited",
			].join("\n"),
		);
		unmountList();
	});

	it("handles quoted indented code with ~~~, list-wrapped quote fences, list-marker indented code, and rejects unrepresentable nested code without outer fall-through", () => {
		const mountAndFocusFirstCode = (markdown: string) => {
			const { session } = createRealSession(markdown);
			const mounted = mountVisual(session);
			let codePos = -1;
			mounted.view.state.doc.descendants((node, pos) => {
				if (node.type.name === "code_block" && codePos < 0) {
					codePos = pos + 1;
					return false;
				}
				return true;
			});
			expect(codePos).toBeGreaterThan(0);
			mounted.view.dispatch(
				mounted.view.state.tr.setSelection(
					TextSelection.create(mounted.view.state.doc, codePos),
				),
			);
			mounted.rt.prepareToolbarFallback();
			return { ...mounted, session };
		};

		// 1. Quoted indented code containing literal `~~~` (both `before` and `after`).
		const quotedIndented = ">     literally ~~~";
		{
			const { rt, session, unmount, view } =
				mountAndFocusFirstCode(quotedIndented);
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative: "before",
					targetRange: { from: 0, to: quotedIndented.length },
				}),
			).toBe("handled");
			expect(session.document.getValue()).toBe("> \n>\n>     literally ~~~");
			expect(view.state.doc.child(0).type.name).toBe("blockquote");
			expect(view.state.doc.child(0).child(1).textContent).toBe(
				"literally ~~~",
			);
			const caret = session.document.getSelection().start;
			const typedBefore =
				session.document.getValue().slice(0, caret) +
				"NEWPARA" +
				session.document.getValue().slice(caret);
			expect(typedBefore).toBe("> NEWPARA\n>\n>     literally ~~~");
			const reparsedBefore = parseMarkdownToVisualDoc(typedBefore);
			expect(reparsedBefore.child(0).type.name).toBe("blockquote");
			expect(reparsedBefore.child(0).child(0).type.name).toBe("paragraph");
			expect(reparsedBefore.child(0).child(0).textContent).toBe("NEWPARA");
			expect(reparsedBefore.child(0).child(1).type.name).toBe("code_block");
			expect(reparsedBefore.child(0).child(1).textContent).toBe(
				"literally ~~~",
			);
			unmount();
		}
		{
			const { rt, session, unmount, view } =
				mountAndFocusFirstCode(quotedIndented);
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative: "after",
					targetRange: { from: 0, to: quotedIndented.length },
				}),
			).toBe("handled");
			expect(session.document.getValue()).toBe(">     literally ~~~\n>\n> ");
			expect(view.state.doc.child(0).type.name).toBe("blockquote");
			expect(view.state.doc.child(0).child(0).textContent).toBe(
				"literally ~~~",
			);
			const caret = session.document.getSelection().start;
			const typedAfter =
				session.document.getValue().slice(0, caret) +
				"NEWPARA" +
				session.document.getValue().slice(caret);
			expect(typedAfter).toBe(">     literally ~~~\n>\n> NEWPARA");
			const reparsedAfter = parseMarkdownToVisualDoc(typedAfter);
			expect(reparsedAfter.child(0).child(0).type.name).toBe("code_block");
			expect(reparsedAfter.child(0).child(0).textContent).toBe("literally ~~~");
			expect(reparsedAfter.child(0).child(1).type.name).toBe("paragraph");
			expect(reparsedAfter.child(0).child(1).textContent).toBe("NEWPARA");
			unmount();
		}

		// 2. List item with leading intro + indented code (`- intro\n\n      code`).
		const listIntroIndented = "- intro\n\n      code";
		for (const relative of ["before", "after"] as const) {
			const { rt, session, unmount } =
				mountAndFocusFirstCode(listIntroIndented);
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative,
					targetRange: {
						from: listIntroIndented.indexOf("      code"),
						to: listIntroIndented.length,
					},
				}),
			).toBe("handled");
			const expected =
				relative === "before"
					? "- intro\n\n  \n\n      code"
					: "- intro\n\n      code\n\n  ";
			expect(session.document.getValue()).toBe(expected);
			const caret = session.document.getSelection().start;
			const typed =
				session.document.getValue().slice(0, caret) +
				"NEWPARA" +
				session.document.getValue().slice(caret);
			const reparsed = parseMarkdownToVisualDoc(typed);
			const item = reparsed.child(0).child(0);
			expect(item.childCount).toBe(3);
			const codeIdx = relative === "before" ? 2 : 1;
			const paraIdx = relative === "before" ? 1 : 2;
			expect(item.child(codeIdx).type.name).toBe("code_block");
			expect(item.child(codeIdx).textContent).toBe("code");
			expect(item.child(paraIdx).type.name).toBe("paragraph");
			expect(item.child(paraIdx).textContent).toBe("NEWPARA");
			unmount();
		}

		// 3. List-wrapped quote indented code (`- >     literally ~~~`).
		const listQuoteIndented = "- >     literally ~~~";
		for (const relative of ["before", "after"] as const) {
			const { rt, session, unmount } =
				mountAndFocusFirstCode(listQuoteIndented);
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative,
					targetRange: { from: 0, to: listQuoteIndented.length },
				}),
			).toBe("handled");
			const expected =
				relative === "before"
					? "- > \n  >\n  >     literally ~~~"
					: "- >     literally ~~~\n  >\n  > ";
			expect(session.document.getValue()).toBe(expected);
			const caret = session.document.getSelection().start;
			const typed =
				session.document.getValue().slice(0, caret) +
				"NEWPARA" +
				session.document.getValue().slice(caret);
			const reparsed = parseMarkdownToVisualDoc(typed);
			const listItem = reparsed.child(0).child(0);
			// Visual schema `list_item` starts with a phantom empty paragraph when
			// its first Markdown block is a blockquote.
			const quote = listItem.child(listItem.childCount - 1);
			expect(quote.type.name).toBe("blockquote");
			const codeIdx = relative === "before" ? 1 : 0;
			const paraIdx = relative === "before" ? 0 : 1;
			expect(quote.child(codeIdx).type.name).toBe("code_block");
			expect(quote.child(codeIdx).textContent).toBe("literally ~~~");
			expect(quote.child(paraIdx).type.name).toBe("paragraph");
			expect(quote.child(paraIdx).textContent).toBe("NEWPARA");
			unmount();
		}

		// 4. List-wrapped quote fence uses `  > ` continuation and never spawns a second list item.
		const listQuoteFence = ["- > ~~~", "  > x", "  > ~~~"].join("\n");
		{
			const { rt, session, unmount, view } =
				mountAndFocusFirstCode(listQuoteFence);
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative: "before",
					targetRange: { from: 0, to: listQuoteFence.length },
				}),
			).toBe("handled");
			expect(session.document.getValue()).toBe(
				["- > ", "  > ~~~", "  > x", "  > ~~~"].join("\n"),
			);
			expect(view.state.doc.child(0).type.name).toBe("bullet_list");
			expect(view.state.doc.child(0).childCount).toBe(1);
			unmount();
		}

		// 5. List-marker indented code `-     code` and `1.     code`: `before` safely
		// returns "unsupported" (CommonMark §5.2/§4.4) while `after` succeeds cleanly.
		for (const listMarkerCase of [
			{
				after: "-     code\n\n  ",
				listType: "bullet_list",
				source: "-     code",
			},
			{
				after: "1.     code\n\n   ",
				listType: "ordered_list",
				source: "1.     code",
			},
		]) {
			{
				const { rt, session, unmount, view } = mountAndFocusFirstCode(
					listMarkerCase.source,
				);
				expect(
					rt.insertParagraphRelative?.({
						expected: {
							revision: session.document.getRevision(),
							selection: session.document.getSelection(),
							value: session.document.getValue(),
						},
						nestedCode: true,
						relative: "before",
						targetRange: { from: 0, to: listMarkerCase.source.length },
					}),
				).toBe("unsupported");
				expect(session.document.getValue()).toBe(listMarkerCase.source);
				expect(view.state.doc.child(0).type.name).toBe(listMarkerCase.listType);
				expect(view.state.doc.child(0).childCount).toBe(1);
				unmount();
			}
			{
				const { rt, session, unmount, view } = mountAndFocusFirstCode(
					listMarkerCase.source,
				);
				expect(
					rt.insertParagraphRelative?.({
						expected: {
							revision: session.document.getRevision(),
							selection: session.document.getSelection(),
							value: session.document.getValue(),
						},
						nestedCode: true,
						relative: "after",
						targetRange: { from: 0, to: listMarkerCase.source.length },
					}),
				).toBe("handled");
				expect(session.document.getValue()).toBe(listMarkerCase.after);
				expect(view.state.doc.child(0).type.name).toBe(listMarkerCase.listType);
				expect(view.state.doc.child(0).childCount).toBe(1);
				const caret = session.document.getSelection().start;
				const typed =
					session.document.getValue().slice(0, caret) +
					"NEWPARA" +
					session.document.getValue().slice(caret);
				const reparsed = parseMarkdownToVisualDoc(typed);
				const listItem = reparsed.child(0).child(0);
				// Visual schema `list_item` starts with a phantom empty paragraph when
				// its first Markdown block is a code block.
				expect(listItem.child(listItem.childCount - 2).type.name).toBe(
					"code_block",
				);
				expect(listItem.child(listItem.childCount - 2).textContent).toBe(
					"code",
				);
				expect(listItem.child(listItem.childCount - 1).type.name).toBe(
					"paragraph",
				);
				expect(listItem.child(listItem.childCount - 1).textContent).toBe(
					"NEWPARA",
				);
				unmount();
			}
		}

		// 6. Unclosed quoted fence below fails canonical verification and returns "unsupported"
		// without falling through to outer-container insertion.
		const unclosedQuoteFence = ["> ```js", "> code"].join("\n");
		{
			const { rt, session, unmount, view } =
				mountAndFocusFirstCode(unclosedQuoteFence);
			const initialDocCount = view.state.doc.childCount;
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative: "after",
					targetRange: { from: 0, to: unclosedQuoteFence.length },
				}),
			).toBe("unsupported");
			expect(session.document.getValue()).toBe(unclosedQuoteFence);
			expect(view.state.doc.childCount).toBe(initialDocCount);
			unmount();
		}
	});

	it("preserves untouched list items across consecutive nested-code insertions in one list and across two separate lists, including Undo/Redo", () => {
		const findCodeContentPositions = (doc: ProseMirrorNode): number[] => {
			const positions: number[] = [];
			doc.descendants((node, pos) => {
				if (node.type.name === "code_block") {
					positions.push(pos + 1);
					return false;
				}
				return true;
			});
			return positions;
		};

		// 1. Two consecutive insertions in Item 1 and Item 2 of the same list, then edit Item 3.
		const singleListSource = [
			"- _keep_",
			"",
			"  ~~~   js",
			"  first",
			"  ~~~~~",
			"- _keep_two_",
			"",
			"  ~~~   ts",
			"  second",
			"  ~~~~~",
			"- Third item",
		].join("\n");
		{
			const { session } = createRealSession(singleListSource);
			const { rt, unmount, view } = mountVisual(session);

			// Insert above nested code in Item 1.
			const [firstCodePos] = findCodeContentPositions(view.state.doc);
			expect(firstCodePos).toBeDefined();
			if (firstCodePos === undefined) throw new Error("expected-first-code");
			view.dispatch(
				view.state.tr.setSelection(
					TextSelection.create(view.state.doc, firstCodePos),
				),
			);
			rt.prepareToolbarFallback();
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative: "before",
					targetRange: {
						from: singleListSource.indexOf("  ~~~   js"),
						to: singleListSource.indexOf("  ~~~~~") + "  ~~~~~".length,
					},
				}),
			).toBe("handled");
			const afterFirstInsert = session.document.getValue();
			expect(afterFirstInsert).toBe(
				[
					"- _keep_",
					"",
					"  ",
					"  ~~~   js",
					"  first",
					"  ~~~~~",
					"- _keep_two_",
					"",
					"  ~~~   ts",
					"  second",
					"  ~~~~~",
					"- Third item",
				].join("\n"),
			);

			// Consecutively insert above nested code in Item 2.
			const [, secondCodePos] = findCodeContentPositions(view.state.doc);
			expect(secondCodePos).toBeDefined();
			if (secondCodePos === undefined) throw new Error("expected-second-code");
			view.dispatch(
				view.state.tr.setSelection(
					TextSelection.create(view.state.doc, secondCodePos),
				),
			);
			rt.prepareToolbarFallback();
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative: "before",
					targetRange: {
						from: afterFirstInsert.indexOf("  ~~~   ts"),
						to: afterFirstInsert.lastIndexOf("  ~~~~~") + "  ~~~~~".length,
					},
				}),
			).toBe("handled");
			const afterSecondInsert = session.document.getValue();
			expect(afterSecondInsert).toBe(
				[
					"- _keep_",
					"",
					"  ",
					"  ~~~   js",
					"  first",
					"  ~~~~~",
					"- _keep_two_",
					"",
					"  ",
					"  ~~~   ts",
					"  second",
					"  ~~~~~",
					"- Third item",
				].join("\n"),
			);

			// Edit Item 3 and verify BOTH Item 1 and Item 2 keep exact original bytes.
			let thirdItemEndPos = -1;
			view.state.doc.descendants((node, pos) => {
				if (node.isText && node.text === "Third item") {
					thirdItemEndPos = pos + node.text.length;
					return false;
				}
				return true;
			});
			expect(thirdItemEndPos).toBeGreaterThan(0);
			setCaret(view, thirdItemEndPos);
			view.dispatch(view.state.tr.insertText(" edited"));
			const afterThirdEdit = session.document.getValue();
			expect(afterThirdEdit).toBe(
				[
					"- _keep_",
					"",
					"  ",
					"  ~~~   js",
					"  first",
					"  ~~~~~",
					"- _keep_two_",
					"",
					"  ",
					"  ~~~   ts",
					"  second",
					"  ~~~~~",
					"- Third item edited",
				].join("\n"),
			);

			// Undo/Redo walks back through edit -> second insert -> first insert -> original cleanly.
			expect(rt.executeCommand(undoCommand)).toBe("handled");
			expect(session.document.getValue()).toBe(afterSecondInsert);
			expect(rt.executeCommand(undoCommand)).toBe("handled");
			expect(session.document.getValue()).toBe(afterFirstInsert);
			expect(rt.executeCommand(undoCommand)).toBe("handled");
			expect(session.document.getValue()).toBe(singleListSource);
			expect(rt.executeCommand(redoCommand)).toBe("handled");
			expect(session.document.getValue()).toBe(afterFirstInsert);
			expect(rt.executeCommand(redoCommand)).toBe("handled");
			expect(session.document.getValue()).toBe(afterSecondInsert);
			expect(rt.executeCommand(redoCommand)).toBe("handled");
			expect(session.document.getValue()).toBe(afterThirdEdit);
			unmount();
		}

		// 2. Two consecutive insertions across two separate lists, then edit sibling item in List 1.
		const twoListsSource = [
			"- _list1_keep_",
			"",
			"  ~~~   js",
			"  one",
			"  ~~~~~",
			"- List 1 sibling",
			"",
			"Separator paragraph",
			"",
			"- _list2_keep_",
			"",
			"  ~~~   py",
			"  two",
			"  ~~~~~",
			"- List 2 sibling",
		].join("\n");
		{
			const { session } = createRealSession(twoListsSource);
			const { rt, unmount, view } = mountVisual(session);

			const [list1CodePos] = findCodeContentPositions(view.state.doc);
			expect(list1CodePos).toBeDefined();
			if (list1CodePos === undefined) throw new Error("expected-list1-code");
			view.dispatch(
				view.state.tr.setSelection(
					TextSelection.create(view.state.doc, list1CodePos),
				),
			);
			rt.prepareToolbarFallback();
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative: "before",
					targetRange: {
						from: twoListsSource.indexOf("  ~~~   js"),
						to: twoListsSource.indexOf("  ~~~~~") + "  ~~~~~".length,
					},
				}),
			).toBe("handled");
			const afterList1Insert = session.document.getValue();

			const [, list2CodePos] = findCodeContentPositions(view.state.doc);
			expect(list2CodePos).toBeDefined();
			if (list2CodePos === undefined) throw new Error("expected-list2-code");
			view.dispatch(
				view.state.tr.setSelection(
					TextSelection.create(view.state.doc, list2CodePos),
				),
			);
			rt.prepareToolbarFallback();
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative: "before",
					targetRange: {
						from: afterList1Insert.indexOf("  ~~~   py"),
						to: afterList1Insert.lastIndexOf("  ~~~~~") + "  ~~~~~".length,
					},
				}),
			).toBe("handled");

			// Edit sibling item in List 1; untouched items in BOTH List 1 and List 2 stay byte-identical.
			let siblingEndPos = -1;
			view.state.doc.descendants((node, pos) => {
				if (node.isText && node.text === "List 1 sibling") {
					siblingEndPos = pos + node.text.length;
					return false;
				}
				return true;
			});
			expect(siblingEndPos).toBeGreaterThan(0);
			setCaret(view, siblingEndPos);
			view.dispatch(view.state.tr.insertText(" edited"));
			expect(session.document.getValue()).toBe(
				[
					"- _list1_keep_",
					"",
					"  ",
					"  ~~~   js",
					"  one",
					"  ~~~~~",
					"- List 1 sibling edited",
					"",
					"Separator paragraph",
					"",
					"- _list2_keep_",
					"",
					"  ",
					"  ~~~   py",
					"  two",
					"  ~~~~~",
					"- List 2 sibling",
				].join("\n"),
			);
			unmount();
		}
	});

	it("restores Visual empty-paragraph target and caret on Redo after Insert Paragraph Above on quoted indented code", () => {
		const quotedIndented = ">     literally ~~~";
		const { session } = createRealSession(quotedIndented);
		const { rt, unmount, view } = mountVisual(session);
		let codePos = -1;
		view.state.doc.descendants((node, pos) => {
			if (node.type.name === "code_block" && codePos < 0) {
				codePos = pos + 1;
				return false;
			}
			return true;
		});
		expect(codePos).toBeGreaterThan(0);
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, codePos)),
		);
		rt.prepareToolbarFallback();

		expect(
			rt.insertParagraphRelative?.({
				expected: {
					revision: session.document.getRevision(),
					selection: session.document.getSelection(),
					value: session.document.getValue(),
				},
				nestedCode: true,
				relative: "before",
				targetRange: { from: 0, to: quotedIndented.length },
			}),
		).toBe("handled");
		expect(session.document.getValue()).toBe("> \n>\n>     literally ~~~");
		expect(view.state.selection.$from.parent.type.name).toBe("paragraph");

		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(quotedIndented);

		expect(rt.executeCommand(redoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe("> \n>\n>     literally ~~~");
		expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
		expect(view.state.selection.$from.parent.textContent).toBe("");
		expect(view.state.doc.child(0).type.name).toBe("blockquote");
		expect(view.state.doc.child(0).childCount).toBe(2);
		expect(view.state.doc.child(0).child(1).type.name).toBe("code_block");
		expect(view.state.doc.child(0).child(1).textContent).toBe("literally ~~~");

		// Typing immediately after Redo inserts prose into the restored paragraph,
		// NOT into the code block.
		view.dispatch(view.state.tr.insertText("After redo"));
		expect(view.state.doc.child(0).type.name).toBe("blockquote");
		expect(view.state.doc.child(0).child(0).type.name).toBe("paragraph");
		expect(view.state.doc.child(0).child(0).textContent).toBe("After redo");
		expect(view.state.doc.child(0).child(1).type.name).toBe("code_block");
		expect(view.state.doc.child(0).child(1).textContent).toBe("literally ~~~");
		expect(session.document.getValue()).toContain("> After redo");
		expect(session.document.getValue()).toContain("literally ~~~");
		unmount();
	});

	it("preserves Visual empty-paragraph target and caret on Redo across 35 consecutive quoted-code insertions beyond the old 32-entry cache", () => {
		const blockCount = 35;
		const initial = Array.from(
			{ length: blockCount },
			(_, idx) => `>     line_${idx}_code`,
		).join("\n\n");
		const { session } = createRealSession(initial);
		const { rt, unmount, view } = mountVisual(session);

		const findNthCodeContentPos = (
			doc: ProseMirrorNode,
			index: number,
		): number => {
			let seen = 0;
			let found = -1;
			doc.descendants((node, pos) => {
				if (found >= 0) return false;
				if (node.type.name === "code_block") {
					if (seen === index) {
						found = pos + 1;
						return false;
					}
					seen += 1;
				}
				return true;
			});
			return found;
		};

		// Insert an empty paragraph above every one of the 35 quoted code blocks.
		for (let idx = 0; idx < blockCount; idx += 1) {
			const codePos = findNthCodeContentPos(view.state.doc, idx);
			expect(codePos).toBeGreaterThan(0);
			view.dispatch(
				view.state.tr.setSelection(
					TextSelection.create(view.state.doc, codePos),
				),
			);
			rt.prepareToolbarFallback();
			const currentValue = session.document.getValue();
			const marker = `>     line_${idx}_code`;
			const from = currentValue.indexOf(marker);
			expect(from).toBeGreaterThanOrEqual(0);
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: currentValue,
					},
					nestedCode: true,
					relative: "before",
					targetRange: { from, to: from + marker.length },
				}),
			).toBe("handled");
		}

		// Undo all 35 insertions back to the exact initial document.
		for (let idx = 0; idx < blockCount; idx += 1) {
			expect(rt.executeCommand(undoCommand)).toBe("handled");
		}
		expect(session.document.getValue()).toBe(initial);

		// Redo steps #1..#5 (step #1 would have been evicted by a 32-entry cap).
		for (let step = 0; step < 5; step += 1) {
			expect(rt.executeCommand(redoCommand)).toBe("handled");
			const quote = view.state.doc.child(step);
			expect(quote.type.name).toBe("blockquote");
			expect(quote.childCount).toBe(2);
			expect(quote.child(0).type.name).toBe("paragraph");
			expect(quote.child(0).textContent).toBe("");
			expect(quote.child(1).type.name).toBe("code_block");
			expect(quote.child(1).textContent).toBe(`line_${step}_code`);
			expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
			expect(view.state.selection.$from.parent.textContent).toBe("");
			expect(view.state.selection.$from.index(0)).toBe(step);
		}

		// Undo back to initial, then Redo #1 and type `NEWPARA` to prove prose
		// enters the restored empty paragraph while `line_0_code` stays untouched.
		for (let step = 0; step < 5; step += 1) {
			expect(rt.executeCommand(undoCommand)).toBe("handled");
		}
		expect(session.document.getValue()).toBe(initial);
		expect(rt.executeCommand(redoCommand)).toBe("handled");
		expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
		expect(view.state.selection.$from.index(0)).toBe(0);
		view.dispatch(view.state.tr.insertText("NEWPARA"));
		expect(view.state.doc.child(0).child(0).type.name).toBe("paragraph");
		expect(view.state.doc.child(0).child(0).textContent).toBe("NEWPARA");
		expect(view.state.doc.child(0).child(1).type.name).toBe("code_block");
		expect(view.state.doc.child(0).child(1).textContent).toBe("line_0_code");
		expect(session.document.getValue()).toContain("> NEWPARA");
		expect(session.document.getValue()).toContain("line_0_code");
		expect(session.document.getValue()).not.toContain("NEWPARAline_0_code");
		expect(session.document.getValue()).toContain(">     line_1_code");
		unmount();
	});

	it("reconstructs empty container paragraphs and caret via structural fallback even on a cold cache miss", () => {
		// 1. Direct unit coverage for `inferVisualEmptyParagraphLayoutFromCanonical`
		// and `restoreVisualEmptyParagraphLayout` across before/after container shapes.
		const cases: ReadonlyArray<
			Readonly<{
				caret: number;
				expectedCodeText: string;
				expectedParentName: string;
				value: string;
			}>
		> = [
			{
				caret: 2,
				expectedCodeText: "line_0_code",
				expectedParentName: "blockquote",
				value: "> \n>\n>     line_0_code",
			},
			{
				caret: 22,
				expectedCodeText: "line_0_code",
				expectedParentName: "blockquote",
				value: ">     line_0_code\n>\n> ",
			},
			{
				caret: 2,
				expectedCodeText: "x",
				expectedParentName: "blockquote",
				value: "> \n> ~~~   js\n> x\n> ~~~~~",
			},
			{
				caret: 25,
				expectedCodeText: "x",
				expectedParentName: "blockquote",
				value: "> ~~~   js\n> x\n> ~~~~~\n> ",
			},
			{
				caret: 12,
				expectedCodeText: "first",
				expectedParentName: "list_item",
				value: ["- _keep_", "", "  ", "  ~~~   js", "  first", "  ~~~~~"].join(
					"\n",
				),
			},
			{
				caret: 39,
				expectedCodeText: "first",
				expectedParentName: "list_item",
				value: ["- _keep_", "", "  ~~~   js", "  first", "  ~~~~~", "  "].join(
					"\n",
				),
			},
			{
				caret: 4,
				expectedCodeText: "literally ~~~",
				expectedParentName: "blockquote",
				value: "- > \n  >\n  >     literally ~~~",
			},
		];

		for (const testCase of cases) {
			const selection: VisualEditorSelection = {
				direction: "none",
				end: testCase.caret,
				start: testCase.caret,
			};
			const layout = inferVisualEmptyParagraphLayoutFromCanonical(
				testCase.value,
				selection,
			);
			expect(layout).not.toBeNull();
			if (!layout) throw new Error("expected-inferred-layout");

			const restored = restoreVisualEmptyParagraphLayout(
				testCase.value,
				selection,
				layout,
			);
			expect(restored).not.toBeNull();
			if (!restored) throw new Error("expected-restored-doc");

			const $pos = restored.doc.resolve(restored.selectionPos);
			expect($pos.parent.type.name).toBe("paragraph");
			expect($pos.parent.textContent).toBe("");
			expect($pos.node($pos.depth - 1).type.name).toBe(
				testCase.expectedParentName,
			);
			const roundTripped = captureVisualEmptyParagraphLayout(
				restored.doc,
				restored.selectionPos,
			);
			expect(roundTripped).not.toBeNull();
			let foundCode = "";
			restored.doc.descendants((node) => {
				if (node.type.name === "code_block") {
					foundCode = node.textContent;
					return false;
				}
				return true;
			});
			expect(foundCode).toBe(testCase.expectedCodeText);
		}

		// Negative cases must not synthesize false-positive layouts.
		expect(
			inferVisualEmptyParagraphLayoutFromCanonical(">     line_0_code", {
				direction: "none",
				end: 6,
				start: 6,
			}),
		).toBeNull();
		expect(
			inferVisualEmptyParagraphLayoutFromCanonical("\n>     line_0_code", {
				direction: "none",
				end: 0,
				start: 0,
			}),
		).toBeNull();
		expect(
			inferVisualEmptyParagraphLayoutFromCanonical("> \n>\n>     line_0_code", {
				direction: "forward",
				end: 2,
				start: 0,
			}),
		).toBeNull();

		// 2. End-to-end cold-cache Redo: insert in one Visual instance, Undo, unmount
		// (clearing the record cache), mount a fresh Visual instance over the same
		// CodeMirror session, Redo, and type `NEWPARA`.
		const source = ">     line_0_code";
		const { session } = createRealSession(source);
		{
			const { rt, unmount, view } = mountVisual(session);
			let codePos = -1;
			view.state.doc.descendants((node, pos) => {
				if (node.type.name === "code_block" && codePos < 0) {
					codePos = pos + 1;
					return false;
				}
				return true;
			});
			view.dispatch(
				view.state.tr.setSelection(
					TextSelection.create(view.state.doc, codePos),
				),
			);
			rt.prepareToolbarFallback();
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative: "before",
					targetRange: { from: 0, to: source.length },
				}),
			).toBe("handled");
			expect(rt.executeCommand(undoCommand)).toBe("handled");
			expect(session.document.getValue()).toBe(source);
			unmount();
		}

		// Fresh Visual mount has an empty record map; Redo must still restore
		// the empty paragraph via `inferVisualEmptyParagraphLayoutFromCanonical`.
		{
			const { rt, unmount, view } = mountVisual(session);
			expect(rt.executeCommand(redoCommand)).toBe("handled");
			expect(session.document.getValue()).toBe("> \n>\n>     line_0_code");
			expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
			expect(view.state.selection.$from.parent.textContent).toBe("");
			view.dispatch(view.state.tr.insertText("NEWPARA"));
			expect(view.state.doc.child(0).child(0).textContent).toBe("NEWPARA");
			expect(view.state.doc.child(0).child(1).textContent).toBe("line_0_code");
			expect(session.document.getValue()).not.toContain("NEWPARAline_0_code");
			unmount();
		}
	});

	it("preserves untouched sibling list items byte-identically when editing Item 3 after Redo of Item 1 and Item 2 insertions", () => {
		const listSource = [
			"- _keep_",
			"",
			"  ~~~   js",
			"  first",
			"  ~~~~~",
			"- _keep_two_",
			"",
			"  ~~~   ts",
			"  second",
			"  ~~~~~",
			"- Third item",
		].join("\n");
		const { session } = createRealSession(listSource);
		const { rt, unmount, view } = mountVisual(session);

		const findCodeContentPositions = (doc: ProseMirrorNode): number[] => {
			const positions: number[] = [];
			doc.descendants((node, pos) => {
				if (node.type.name === "code_block") {
					positions.push(pos + 1);
					return false;
				}
				return true;
			});
			return positions;
		};

		// Insert above code in Item 1.
		const [firstCodePos] = findCodeContentPositions(view.state.doc);
		if (firstCodePos === undefined) throw new Error("expected-first-code");
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, firstCodePos),
			),
		);
		rt.prepareToolbarFallback();
		expect(
			rt.insertParagraphRelative?.({
				expected: {
					revision: session.document.getRevision(),
					selection: session.document.getSelection(),
					value: session.document.getValue(),
				},
				nestedCode: true,
				relative: "before",
				targetRange: {
					from: listSource.indexOf("  ~~~   js"),
					to: listSource.indexOf("  ~~~~~") + "  ~~~~~".length,
				},
			}),
		).toBe("handled");
		const afterItem1 = session.document.getValue();

		// Insert above code in Item 2.
		const [, secondCodePos] = findCodeContentPositions(view.state.doc);
		if (secondCodePos === undefined) throw new Error("expected-second-code");
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, secondCodePos),
			),
		);
		rt.prepareToolbarFallback();
		expect(
			rt.insertParagraphRelative?.({
				expected: {
					revision: session.document.getRevision(),
					selection: session.document.getSelection(),
					value: session.document.getValue(),
				},
				nestedCode: true,
				relative: "before",
				targetRange: {
					from: afterItem1.indexOf("  ~~~   ts"),
					to: afterItem1.lastIndexOf("  ~~~~~") + "  ~~~~~".length,
				},
			}),
		).toBe("handled");
		const afterItem2 = session.document.getValue();

		// Undo both insertions, then Redo both insertions.
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(listSource);
		expect(rt.executeCommand(redoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(afterItem1);
		expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
		expect(rt.executeCommand(redoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(afterItem2);
		expect(view.state.selection.$from.parent.type.name).toBe("paragraph");

		// Edit Item 3 after Redo and verify Item 1 & Item 2 stay byte-identical.
		let thirdItemEndPos = -1;
		view.state.doc.descendants((node, pos) => {
			if (node.isText && node.text === "Third item") {
				thirdItemEndPos = pos + node.text.length;
				return false;
			}
			return true;
		});
		expect(thirdItemEndPos).toBeGreaterThan(0);
		setCaret(view, thirdItemEndPos);
		view.dispatch(view.state.tr.insertText(" edited"));
		expect(session.document.getValue()).toBe(
			[
				"- _keep_",
				"",
				"  ",
				"  ~~~   js",
				"  first",
				"  ~~~~~",
				"- _keep_two_",
				"",
				"  ",
				"  ~~~   ts",
				"  second",
				"  ~~~~~",
				"- Third item edited",
			].join("\n"),
		);
		unmount();
	});

	it("restores outer list-item caret depth (not inner sublist) on cold-cache Redo above outer code block B", () => {
		const variants = [
			[
				"- - ```js",
				"    A",
				"    ```",
				"",
				"  ```js",
				"  B",
				"  ```",
			].join("\n"),
			[
				"- - ```js",
				"    A",
				"    ```",
				"  ```js",
				"  B",
				"  ```",
			].join("\n"),
		];

		for (const source of variants) {
			const { session } = createRealSession(source);
			let originalDepth = -1;
			{
				const { rt, unmount, view } = mountVisual(session);
				let codeBPos = -1;
				view.state.doc.descendants((node, pos) => {
					if (node.type.name === "code_block" && node.textContent === "B") {
						codeBPos = pos + 1;
						return false;
					}
					return true;
				});
				expect(codeBPos).toBeGreaterThan(0);
				view.dispatch(
					view.state.tr.setSelection(
						TextSelection.create(view.state.doc, codeBPos),
					),
				);
				rt.prepareToolbarFallback();
				const codeBFrom = source.indexOf("  ```js");
				const codeBTo = source.lastIndexOf("  ```") + "  ```".length;
				expect(
					rt.insertParagraphRelative?.({
						expected: {
							revision: session.document.getRevision(),
							selection: session.document.getSelection(),
							value: session.document.getValue(),
						},
						nestedCode: true,
						relative: "before",
						targetRange: { from: codeBFrom, to: codeBTo },
					}),
				).toBe("handled");
				originalDepth = view.state.selection.$from.depth;
				expect(originalDepth).toBe(3);
				expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
				expect(rt.executeCommand(undoCommand)).toBe("handled");
				expect(session.document.getValue()).toBe(source);
				unmount();
			}

			// Fresh mount with cold visualInsertionRecords cache: Redo must land in
			// outer list item (depth 3, 2 spaces), NOT inside the inner sublist (depth 5).
			{
				const { rt, unmount, view } = mountVisual(session);
				expect(rt.executeCommand(redoCommand)).toBe("handled");
				expect(view.state.selection.$from.depth).toBe(originalDepth);
				expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
				expect(view.state.selection.$from.parent.textContent).toBe("");
				view.dispatch(view.state.tr.insertText("NEWPARA"));
				const finalValue = session.document.getValue();
				expect(finalValue).toContain("\n  NEWPARA\n  ```js");
				expect(finalValue).not.toContain("    NEWPARA");
				unmount();
			}
		}
	});

	it("restores inner sublist caret depth (4 spaces) on cold-cache Redo below inner code block A", () => {
		const source = [
			"- - ```js",
			"    A",
			"    ```",
			"",
			"  ```js",
			"  B",
			"  ```",
		].join("\n");
		const { session } = createRealSession(source);
		let originalDepth = -1;
		{
			const { rt, unmount, view } = mountVisual(session);
			let codeAPos = -1;
			view.state.doc.descendants((node, pos) => {
				if (node.type.name === "code_block" && node.textContent === "A") {
					codeAPos = pos + 1;
					return false;
				}
				return true;
			});
			expect(codeAPos).toBeGreaterThan(0);
			view.dispatch(
				view.state.tr.setSelection(
					TextSelection.create(view.state.doc, codeAPos),
				),
			);
			rt.prepareToolbarFallback();
			const codeAFrom = source.indexOf("```js");
			const codeATo = source.indexOf("    ```") + "    ```".length;
			expect(
				rt.insertParagraphRelative?.({
					expected: {
						revision: session.document.getRevision(),
						selection: session.document.getSelection(),
						value: session.document.getValue(),
					},
					nestedCode: true,
					relative: "after",
					targetRange: { from: codeAFrom, to: codeATo },
				}),
			).toBe("handled");
			originalDepth = view.state.selection.$from.depth;
			expect(originalDepth).toBe(5);
			expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
			expect(rt.executeCommand(undoCommand)).toBe("handled");
			expect(session.document.getValue()).toBe(source);
			unmount();
		}

		// Cold-cache Redo must restore depth 5 inside the inner sublist (4 spaces).
		{
			const { rt, unmount, view } = mountVisual(session);
			expect(rt.executeCommand(redoCommand)).toBe("handled");
			expect(view.state.selection.$from.depth).toBe(originalDepth);
			expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
			expect(view.state.selection.$from.parent.textContent).toBe("");
			view.dispatch(view.state.tr.insertText("NEWPARA"));
			const finalValue = session.document.getValue();
			expect(finalValue).toContain("    NEWPARA");
			expect(finalValue).not.toContain("\n  NEWPARA");
			expect(finalValue.indexOf("    NEWPARA")).toBeGreaterThan(
				finalValue.indexOf("    A"),
			);
			expect(finalValue.indexOf("    NEWPARA")).toBeLessThan(
				finalValue.indexOf("\n  ```js"),
			);
			unmount();
		}
	});

	it("restores outer blockquote caret depth (not inner blockquote) on cold-cache Redo above outer code block B", () => {
		const variants = [
			[
				"> > ```js",
				"> > A",
				"> > ```",
				">",
				"> ```js",
				"> B",
				"> ```",
			].join("\n"),
			[
				"> > ```js",
				"> > A",
				"> > ```",
				"> ```js",
				"> B",
				"> ```",
			].join("\n"),
		];

		for (const source of variants) {
			const { session } = createRealSession(source);
			let originalDepth = -1;
			{
				const { rt, unmount, view } = mountVisual(session);
				let codeBPos = -1;
				view.state.doc.descendants((node, pos) => {
					if (node.type.name === "code_block" && node.textContent === "B") {
						codeBPos = pos + 1;
						return false;
					}
					return true;
				});
				expect(codeBPos).toBeGreaterThan(0);
				view.dispatch(
					view.state.tr.setSelection(
						TextSelection.create(view.state.doc, codeBPos),
					),
				);
				rt.prepareToolbarFallback();
				const codeBFrom = source.indexOf("\n> ```js") + 1;
				const codeBTo = source.lastIndexOf("> ```") + "> ```".length;
				expect(
					rt.insertParagraphRelative?.({
						expected: {
							revision: session.document.getRevision(),
							selection: session.document.getSelection(),
							value: session.document.getValue(),
						},
						nestedCode: true,
						relative: "before",
						targetRange: { from: codeBFrom, to: codeBTo },
					}),
				).toBe("handled");
				originalDepth = view.state.selection.$from.depth;
				expect(originalDepth).toBe(2);
				expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
				expect(rt.executeCommand(undoCommand)).toBe("handled");
				expect(session.document.getValue()).toBe(source);
				unmount();
			}

			// Cold-cache Redo must place caret in outer blockquote before B (depth 2).
			{
				const { rt, unmount, view } = mountVisual(session);
				expect(rt.executeCommand(redoCommand)).toBe("handled");
				expect(view.state.selection.$from.depth).toBe(originalDepth);
				expect(view.state.selection.$from.parent.type.name).toBe("paragraph");
				expect(view.state.selection.$from.parent.textContent).toBe("");
				view.dispatch(view.state.tr.insertText("NEWPARA"));
				const finalValue = session.document.getValue();
				expect(finalValue).toContain("\n> NEWPARA\n");
				expect(finalValue).not.toContain("> > NEWPARA");
				expect(finalValue.indexOf("\n> NEWPARA\n")).toBeLessThan(
					finalValue.indexOf("\n> ```js"),
				);
				unmount();
			}
		}
	});

	it("fast-exits inferVisualEmptyParagraphLayoutFromCanonical in O(line) on normal lines even on large documents", () => {
		const block = "Normal paragraph content without blank container prefix.\n";
		const largeDoc = `${block.repeat(4000)}\n> \`\`\`js\n> A\n> \`\`\`\n${block.repeat(1000)}`;
		const midLineOffset = 20;
		const endOfLineOffset = block.length - 1;
		const emptyBlankLineOffset = block.length * 4000;

		const started = performance.now();
		for (let i = 0; i < 100; i += 1) {
			expect(
				inferVisualEmptyParagraphLayoutFromCanonical(largeDoc, {
					direction: "none",
					end: midLineOffset,
					start: midLineOffset,
				}),
			).toBeNull();
			expect(
				inferVisualEmptyParagraphLayoutFromCanonical(largeDoc, {
					direction: "none",
					end: endOfLineOffset,
					start: endOfLineOffset,
				}),
			).toBeNull();
			expect(
				inferVisualEmptyParagraphLayoutFromCanonical(largeDoc, {
					direction: "none",
					end: emptyBlankLineOffset,
					start: emptyBlankLineOffset,
				}),
			).toBeNull();
		}
		// 300 calls over a ~285KB document must stay fast (no full-doc projection/parsing).
		expect(performance.now() - started).toBeLessThan(150);
	});
});

describe("MountedProseMirrorVisualEditor localized protected-card labels", () => {
	const zhLabels = () => ({
		cancel: "取消",
		edit: "编辑",
		footnotes: "脚注",
		math: "公式",
		mermaid: "Mermaid",
		raw: "原始块",
		save: "保存",
		toc: "目录",
	});
	const zhTemplates = () => ({ edit: "编辑 %s", source: "%s 源码" });

	it("renders PHP-owned zh_CN labels and %s templates without remounting on equal rerenders", () => {
		const harness = createMockDocumentSession("$$\nE = mc^2\n$$");
		const onDispose = vi.fn();
		const { container, rerender, unmount } = render(
			<MountedProseMirrorVisualEditor
				documentSession={harness.session}
				onDispose={onDispose}
				protectedAtomLabels={zhLabels()}
				protectedAtomLabelTemplates={zhTemplates()}
			/>,
		);
		const editButton = container.querySelector<HTMLButtonElement>(
			"button.easymde-protected-edit-btn",
		);
		if (!editButton) throw new Error("missing protected edit button");
		expect(editButton.textContent).toBe("编辑");
		expect(editButton.getAttribute("aria-label")).toBe("编辑 公式");

		// Fresh but equal label objects must keep the same ProseMirror view.
		rerender(
			<MountedProseMirrorVisualEditor
				documentSession={harness.session}
				onDispose={onDispose}
				protectedAtomLabels={zhLabels()}
				protectedAtomLabelTemplates={zhTemplates()}
			/>,
		);
		expect(onDispose).not.toHaveBeenCalled();
		expect(container.querySelector("button.easymde-protected-edit-btn")).toBe(
			editButton,
		);

		act(() => {
			editButton.click();
		});
		const textarea = container.querySelector(
			"textarea.easymde-protected-source-input",
		);
		expect(textarea?.getAttribute("aria-label")).toBe("公式 源码");
		expect(
			container.querySelector("button.easymde-protected-save-btn")?.textContent,
		).toBe("保存");
		expect(
			container.querySelector("button.easymde-protected-cancel-btn")
				?.textContent,
		).toBe("取消");
		unmount();
		expect(onDispose).toHaveBeenCalledTimes(1);
	});
});

describe("ProseMirrorVisualEditor cross-block and mixed-selection bold", () => {
	function findTextPos(
		doc: ProseMirrorNode,
		target: string,
	): { from: number; to: number } {
		let found: { from: number; to: number } | null = null;
		doc.descendants((node, pos) => {
			if (found || !node.isText || !node.text) return;
			const offset = node.text.indexOf(target);
			if (offset >= 0) {
				found = { from: pos + offset, to: pos + offset + target.length };
			}
		});
		if (!found) throw new Error(`text-not-found:${target}`);
		return found;
	}

	it("bolds cross-heading selections into valid per-heading CommonMark with rendered <strong> and 1-step Undo/Redo", () => {
		const initial = "# 一级标题 Heading 1\n\n## 二级标题 Heading 2";
		const { session } = createRealSession(initial);
		const { rt, unmount, view } = mountVisual(session);
		const start = findTextPos(view.state.doc, "一级标题 Heading 1");
		const end = findTextPos(view.state.doc, "二级标题 Heading 2");
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, start.from, end.to),
			),
		);

		expect(
			rt.executeCommand(makeToolbarCommand({ action: "bold", id: "bold" })),
		).toBe("handled");
		const expected = "# **一级标题 Heading 1**\n\n## **二级标题 Heading 2**";
		expect(session.document.getValue()).toBe(expected);
		expect(rt.surface.querySelector("h1 strong")?.textContent).toBe(
			"一级标题 Heading 1",
		);
		expect(rt.surface.querySelector("h2 strong")?.textContent).toBe(
			"二级标题 Heading 2",
		);
		expect(rt.surface.querySelector("h1")?.textContent).not.toContain("**");
		expect(rt.surface.querySelector("h2")?.textContent).not.toContain("**");

		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(initial);
		expect(rt.surface.querySelector("h1 strong")).toBeNull();
		expect(rt.surface.querySelector("h2 strong")).toBeNull();

		expect(rt.executeCommand(redoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(expected);
		expect(rt.surface.querySelector("h1 strong")?.textContent).toBe(
			"一级标题 Heading 1",
		);
		unmount();
	});

	it("bolds cross-paragraph, list, blockquote, and mixed paragraph+code/HR/math selections without corrupting non-boldable blocks", () => {
		const initial = [
			"Para one",
			"",
			"```js",
			"const x = 1;",
			"```",
			"",
			"---",
			"",
			"$$",
			"E = mc^2",
			"$$",
			"",
			"- List item",
			"",
			"> Quoted line",
			"",
			"Para two",
		].join("\n");
		const { session } = createRealSession(initial);
		const { rt, unmount, view } = mountVisual(session);
		const start = findTextPos(view.state.doc, "Para one");
		const end = findTextPos(view.state.doc, "Para two");
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, start.from, end.to),
			),
		);

		expect(
			rt.executeCommand(makeToolbarCommand({ action: "bold", id: "bold" })),
		).toBe("handled");
		const expected = [
			"**Para one**",
			"",
			"```js",
			"const x = 1;",
			"```",
			"",
			"---",
			"",
			"$$",
			"E = mc^2",
			"$$",
			"",
			"- **List item**",
			"",
			"> **Quoted line**",
			"",
			"**Para two**",
		].join("\n");
		expect(session.document.getValue()).toBe(expected);
		expect(rt.surface.querySelector("pre code strong")).toBeNull();
		expect(rt.surface.querySelector("li strong")?.textContent).toBe("List item");
		expect(rt.surface.querySelector("blockquote strong")?.textContent).toBe(
			"Quoted line",
		);

		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(initial);
		unmount();
	});

	it("allows mixed selection starting inside a code block and extending into a paragraph, while blocking pure non-boldable selections", () => {
		const initial = "```js\nconst a = 1;\n```\n\nAfter code\n\n---\n\n$$\nx^2\n$$";
		const { session } = createRealSession(initial);
		const { rt, unmount, view } = mountVisual(session);

		// Pure code-block selection is blocked without mutating Markdown
		const codePos = findTextPos(view.state.doc, "const a = 1;");
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, codePos.from, codePos.to),
			),
		);
		expect(
			rt.executeCommand(makeToolbarCommand({ action: "bold", id: "bold" })),
		).toBe("blocked");
		expect(session.document.getValue()).toBe(initial);

		// Pure HR NodeSelection is blocked
		let hrPos = -1;
		let mathPos = -1;
		view.state.doc.descendants((node, pos) => {
			if (node.type.name === "horizontal_rule") hrPos = pos;
			if (node.type.name === "protected_block") mathPos = pos;
		});
		view.dispatch(
			view.state.tr.setSelection(NodeSelection.create(view.state.doc, hrPos)),
		);
		expect(
			rt.executeCommand(makeToolbarCommand({ action: "bold", id: "bold" })),
		).toBe("blocked");
		expect(session.document.getValue()).toBe(initial);

		// Pure protected math NodeSelection is blocked
		view.dispatch(
			view.state.tr.setSelection(NodeSelection.create(view.state.doc, mathPos)),
		);
		expect(
			rt.executeCommand(makeToolbarCommand({ action: "bold", id: "bold" })),
		).toBe("blocked");
		expect(session.document.getValue()).toBe(initial);

		// Mixed selection starting in code block and ending in paragraph bolds ONLY the paragraph
		const afterPos = findTextPos(view.state.doc, "After code");
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, codePos.from, afterPos.to),
			),
		);
		expect(
			rt.executeCommand(makeToolbarCommand({ action: "bold", id: "bold" })),
		).toBe("handled");
		expect(session.document.getValue()).toBe(
			"```js\nconst a = 1;\n```\n\n**After code**\n\n---\n\n$$\nx^2\n$$",
		);
		unmount();
	});

	it("bolds across table cells into valid per-cell CommonMark without corrupting table delimiters", () => {
		const initial = "| Head A | Head B |\n| --- | --- |\n| Cell 1 | Cell 2 |";
		const { session } = createRealSession(initial);
		const { rt, unmount, view } = mountVisual(session);
		const start = findTextPos(view.state.doc, "Head A");
		const end = findTextPos(view.state.doc, "Cell 2");
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, start.from, end.to),
			),
		);

		expect(
			rt.executeCommand(makeToolbarCommand({ action: "bold", id: "bold" })),
		).toBe("handled");
		const expected =
			"| **Head A** | **Head B** |\n| --- | --- |\n| **Cell 1** | **Cell 2** |";
		expect(session.document.getValue()).toBe(expected);
		expect(rt.surface.querySelectorAll("table strong")).toHaveLength(4);
		expect(rt.surface.querySelector("table")?.textContent).not.toContain("**");

		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(initial);
		unmount();
	});

	it("adds missing bold on mixed bold+plain selections via toolbar and Ctrl+B instead of removing existing bold", () => {
		const initial = "First\n\n**Already**\n\nLast";
		const { session } = createRealSession(initial);
		const { rt, unmount, view } = mountVisual(session);
		const start = findTextPos(view.state.doc, "First");
		const end = findTextPos(view.state.doc, "Last");
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, start.from, end.to),
			),
		);

		// First Bold adds bold to First & Last while keeping Already bold.
		expect(
			rt.executeCommand(makeToolbarCommand({ action: "bold", id: "bold" })),
		).toBe("handled");
		expect(session.document.getValue()).toBe(
			"**First**\n\n**Already**\n\n**Last**",
		);
		expect(rt.surface.querySelectorAll("strong")).toHaveLength(3);

		// Second Bold (all marked) removes bold from all three.
		expect(
			rt.executeCommand(makeToolbarCommand({ action: "bold", id: "bold" })),
		).toBe("handled");
		expect(session.document.getValue()).toBe("First\n\nAlready\n\nLast");
		expect(rt.surface.querySelectorAll("strong")).toHaveLength(0);

		// Undo back to original and test Mod-b keybinding on mixed selection.
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(rt.executeCommand(undoCommand)).toBe("handled");
		expect(session.document.getValue()).toBe(initial);

		const modStart = findTextPos(view.state.doc, "First");
		const modEnd = findTextPos(view.state.doc, "Last");
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, modStart.from, modEnd.to),
			),
		);
		expect(dispatchKeyDown(view, "b", { ctrlKey: true })).toBe(true);
		expect(session.document.getValue()).toBe(
			"**First**\n\n**Already**\n\n**Last**",
		);
		unmount();
	});

	it("withholds visual generated-content targets when DOM source or count parity disagrees, while matching PHP-normalized TeX (R31A #1)", () => {
		const initial = "A $y$ and $frac{1}{2}$";
		const { session } = createRealSession(initial);
		const { rt, unmount } = mountVisual(session);
		const mathElements = Array.from(rt.surface.querySelectorAll(".easymde-math"));
		expect(mathElements).toHaveLength(2);
		const yStart = initial.indexOf("$y$");
		const fracStart = initial.indexOf("$frac{1}{2}$");
		const fullIndex: VisualEditorGeneratedContentTargetIndex = {
			blocks: [
				{
					editable: true,
					from: 0,
					kind: "paragraph",
					lineEnd: 0,
					lineStart: 0,
					to: initial.length,
				},
			],
			length: initial.length,
			mathSpans: [
				{
					bodyFrom: yStart + 1,
					bodyTo: yStart + 2,
					displayMode: false,
					from: yStart,
					to: yStart + 3,
				},
				{
					bodyFrom: fracStart + 1,
					bodyTo: fracStart + "$frac{1}{2}$".length - 1,
					displayMode: false,
					from: fracStart,
					to: fracStart + "$frac{1}{2}$".length,
				},
			],
			revision: session.document.getRevision(),
			source: initial,
		};

		// Valid matching DOM resolves cleanly.
		const yLease = rt.prepareGeneratedContentTarget({
			element: mathElements[0] as Element,
			index: fullIndex,
			kind: "math",
			ordinal: 0,
		});
		expect(yLease?.target.original.full).toBe("$y$");
		yLease?.release();

		// Simulated dropped span (DOM has 2 .easymde-math roots, index only has 1): must withhold!
		const droppedIndex: VisualEditorGeneratedContentTargetIndex = {
			...fullIndex,
			mathSpans: fullIndex.mathSpans.slice(1),
		};
		expect(
			rt.prepareGeneratedContentTarget({
				element: mathElements[0] as Element,
				index: droppedIndex,
				kind: "math",
				ordinal: 0,
			}),
		).toBeNull();
		expect(
			rt.prepareGeneratedContentTarget({
				element: mathElements[1] as Element,
				index: droppedIndex,
				kind: "math",
				ordinal: 0,
			}),
		).toBeNull();
		expect(
			rt.prepareGeneratedContentTargetForSelection({
				index: droppedIndex,
				selection: {
					end: fracStart + "$frac{1}{2}$".length,
					start: fracStart,
				},
			}),
		).toBeNull();

		// Direct unit checks: PHP-restored \(y\) and normalized \(\frac{1}{2}\) match, while disagreeing domRaw never falls back to ordinal.
		const pmRoot = document.createElement("div");
		pmRoot.className = "ProseMirror";
		const elY = document.createElement("span");
		elY.className = "easymde-math easymde-math-inline";
		elY.setAttribute("data-easymde-visual-markdown-source", "\\(y\\)");
		const elFrac = document.createElement("span");
		elFrac.className = "easymde-math easymde-math-inline";
		elFrac.setAttribute(
			"data-easymde-visual-markdown-source",
			"\\(\\frac{1}{2}\\)",
		);
		pmRoot.append(elY, elFrac);

		expect(
			findGeneratedContentOriginal(fullIndex, "math", 0, elY)?.original.full,
		).toBe("$y$");
		expect(
			findGeneratedContentOriginal(fullIndex, "math", 1, elFrac)?.original.full,
		).toBe("$frac{1}{2}$");

		// Disagreeing domRaw with no match in entries must return null, NEVER fall back to ordinal!
		elY.setAttribute("data-easymde-visual-markdown-source", "\\(missing\\)");
		expect(findGeneratedContentOriginal(fullIndex, "math", 0, elY)).toBeNull();
		expect(
			pairMathSpanIndexToDomIndex(
				fullIndex.source,
				[elY, elFrac],
				fullIndex.mathSpans,
				0,
			),
		).toBeNull();

		// Duplicate identical formulas with broken count parity (DOM has 2 $y$, index only has 1 $y$): must return null!
		const dupSource = "A < x $y$ > and $y$";
		const secondYStart = dupSource.lastIndexOf("$y$");
		const dupDroppedIndex: VisualEditorGeneratedContentTargetIndex = {
			blocks: [
				{
					editable: true,
					from: 0,
					kind: "paragraph",
					lineEnd: 0,
					lineStart: 0,
					to: dupSource.length,
				},
			],
			length: dupSource.length,
			mathSpans: [
				{
					bodyFrom: secondYStart + 1,
					bodyTo: secondYStart + 2,
					displayMode: false,
					from: secondYStart,
					to: secondYStart + 3,
				},
			],
			revision: 0,
			source: dupSource,
		};
		const dupRoot = document.createElement("div");
		dupRoot.className = "ProseMirror";
		const dup0 = document.createElement("span");
		dup0.className = "easymde-math easymde-math-inline";
		dup0.setAttribute("data-easymde-visual-markdown-source", "$y$");
		const dup1 = document.createElement("span");
		dup1.className = "easymde-math easymde-math-inline";
		dup1.setAttribute("data-easymde-visual-markdown-source", "$y$");
		dupRoot.append(dup0, dup1);
		expect(
			findGeneratedContentOriginal(dupDroppedIndex, "math", 0, dup0),
		).toBeNull();
		expect(
			findGeneratedContentOriginal(dupDroppedIndex, "math", 1, dup1),
		).toBeNull();

		// R32A #1 / R32B #1: Visual resolver accepts PHP 4-backslash matrices, NBSP, and HTML5-decoded entities while rejecting mismatches.
		const r32Source =
			"A $\\text{&alpha;}$ $\u00a0x\u00a0$\n\n$$\\begin{array}{cc}a \\ b \\\\ c \\| d\\end{array}$$";
		const alphaStart = r32Source.indexOf("$\\text{&alpha;}$");
		const nbspXStart = r32Source.indexOf("$\u00a0x\u00a0$");
		const arrayStart = r32Source.indexOf("$$\\begin{array}");
		const r32Index: VisualEditorGeneratedContentTargetIndex = {
			blocks: [
				{
					editable: true,
					from: 0,
					kind: "paragraph",
					lineEnd: 0,
					lineStart: 0,
					to: r32Source.indexOf("\n\n"),
				},
				{
					editable: true,
					from: arrayStart,
					kind: "math",
					lineEnd: 2,
					lineStart: 2,
					to: r32Source.length,
				},
			],
			length: r32Source.length,
			mathSpans: [
				{
					bodyFrom: alphaStart + 1,
					bodyTo: alphaStart + "$\\text{&alpha;}$".length - 1,
					displayMode: false,
					from: alphaStart,
					to: alphaStart + "$\\text{&alpha;}$".length,
				},
				{
					bodyFrom: nbspXStart + 1,
					bodyTo: nbspXStart + "$\u00a0x\u00a0$".length - 1,
					displayMode: false,
					from: nbspXStart,
					to: nbspXStart + "$\u00a0x\u00a0$".length,
				},
				{
					bodyFrom: arrayStart + 2,
					bodyTo: r32Source.length - 2,
					displayMode: true,
					from: arrayStart,
					to: r32Source.length,
				},
			],
			revision: 0,
			source: r32Source,
		};
		const r32Root = document.createElement("div");
		r32Root.className = "ProseMirror";
		const elAlpha = document.createElement("span");
		elAlpha.className = "easymde-math easymde-math-inline";
		elAlpha.setAttribute(
			"data-easymde-visual-markdown-source",
			"\\(\\text{\u03b1}\\)",
		);
		const elNbspX = document.createElement("span");
		elNbspX.className = "easymde-math easymde-math-inline";
		elNbspX.setAttribute(
			"data-easymde-visual-markdown-source",
			"\\(\u00a0x\u00a0\\)",
		);
		const elArray = document.createElement("div");
		elArray.className = "easymde-math easymde-math-block";
		elArray.setAttribute(
			"data-easymde-visual-markdown-source",
			"$$\\begin{array}{cc}a \\\\\\\\ b \\\\ c \\\\\\\\| d\\end{array}$$",
		);
		r32Root.append(elAlpha, elNbspX, elArray);

		expect(
			findGeneratedContentOriginal(r32Index, "math", 0, elAlpha)?.original.full,
		).toBe("$\\text{&alpha;}$");
		expect(
			findGeneratedContentOriginal(r32Index, "math", 1, elNbspX)?.original.full,
		).toBe("$\u00a0x\u00a0$");
		expect(
			findGeneratedContentOriginal(r32Index, "math", 2, elArray)?.original.full,
		).toBe("$$\\begin{array}{cc}a \\ b \\\\ c \\| d\\end{array}$$");
		expect(
			pairMathSpanIndexToDomIndex(
				r32Index.source,
				[elAlpha, elNbspX, elArray],
				r32Index.mathSpans,
				2,
			),
		).toBe(2);
		const mismatchedR32Source = r32Source.replace("$\\text{&alpha;}$", "$z$");
		const mismatchedZStart = mismatchedR32Source.indexOf("$z$");
		const mismatchedNbspStart = mismatchedR32Source.indexOf("$\u00a0x\u00a0$");
		const mismatchedArrayStart = mismatchedR32Source.indexOf("$$\\begin{array}");
		expect(
			pairMathSpanIndexToDomIndex(
				mismatchedR32Source,
				[elAlpha, elNbspX, elArray],
				[
					{
						bodyFrom: mismatchedZStart + 1,
						bodyTo: mismatchedZStart + 2,
						displayMode: false,
						from: mismatchedZStart,
						to: mismatchedZStart + 3,
					},
					{
						bodyFrom: mismatchedNbspStart + 1,
						bodyTo: mismatchedNbspStart + "$\u00a0x\u00a0$".length - 1,
						displayMode: false,
						from: mismatchedNbspStart,
						to: mismatchedNbspStart + "$\u00a0x\u00a0$".length,
					},
					{
						bodyFrom: mismatchedArrayStart + 2,
						bodyTo: mismatchedR32Source.length - 2,
						displayMode: true,
						from: mismatchedArrayStart,
						to: mismatchedR32Source.length,
					},
				],
				0,
			),
		).toBeNull();

		// R34A #1: WP 6.7 LinkTitle stripping in Visual mode resolves unique $x$ and rejects ambiguous duplicate $x$.
		const buildMathIndex = (src: string) => {
			const spans: Array<{
				bodyFrom: number;
				bodyTo: number;
				displayMode: boolean;
				from: number;
				to: number;
			}> = [];
			const re = /\$([^$]+)\$/g;
			let m: RegExpExecArray | null = re.exec(src);
			while (m !== null) {
				spans.push({
					bodyFrom: m.index + 1,
					bodyTo: m.index + m[0].length - 1,
					displayMode: false,
					from: m.index,
					to: m.index + m[0].length,
				});
				m = re.exec(src);
			}
			return {
				blocks: [
					{
						editable: true,
						from: 0,
						kind: "paragraph" as const,
						lineEnd: 0,
						lineStart: 0,
						to: src.length,
					},
				],
				length: src.length,
				mathSpans: spans,
				revision: 34,
				source: src,
			};
		};
		const wp67Root = document.createElement("div");
		wp67Root.className = "ProseMirror";
		const elX = document.createElement("span");
		elX.className = "easymde-math easymde-math-inline";
		elX.setAttribute("data-easymde-visual-markdown-source", "\\(x\\)");
		wp67Root.append(elX);

		const beforeIdx = buildMathIndex('Before $x$ and [note](/url "year $199$")');
		expect(findGeneratedContentOriginal(beforeIdx, "math", 0, elX)?.original.full).toBe("$x$");
		expect(
			pairMathSpanIndexToDomIndex(beforeIdx.source, [elX], beforeIdx.mathSpans, 0),
		).toBe(0);

		const afterIdx = buildMathIndex('[note](/url "year $199$") then $x$');
		expect(findGeneratedContentOriginal(afterIdx, "math", 0, elX)?.original.full).toBe("$x$");
		expect(
			pairMathSpanIndexToDomIndex(afterIdx.source, [elX], afterIdx.mathSpans, 1),
		).toBe(0);

		const ambigIdx = buildMathIndex('[note](/url "cost $x$") and same $x$');
		expect(findGeneratedContentOriginal(ambigIdx, "math", 0, elX)).toBeNull();
		expect(
			pairMathSpanIndexToDomIndex(ambigIdx.source, [elX], ambigIdx.mathSpans, 1),
		).toBeNull();

		// R35A #2 / R35B #1: Equal-cardinality duplicate $x$ classes resolve cleanly in Visual mode while ambiguous duplicates reject.
		const dupVisualRoot = document.createElement("div");
		dupVisualRoot.className = "ProseMirror";
		const elX0 = document.createElement("span");
		elX0.className = "easymde-math easymde-math-inline";
		elX0.setAttribute("data-easymde-visual-markdown-source", "$x$");
		const elX1 = document.createElement("span");
		elX1.className = "easymde-math easymde-math-inline";
		elX1.setAttribute("data-easymde-visual-markdown-source", "$x$");
		dupVisualRoot.append(elX0, elX1);

		const dupAfterIdx = buildMathIndex('[note](/url "year $199$") then $x$ and $x$');
		expect(
			findGeneratedContentOriginal(dupAfterIdx, "math", 0, elX0)?.ordinal,
		).toBe(1);
		expect(
			findGeneratedContentOriginal(dupAfterIdx, "math", 1, elX1)?.ordinal,
		).toBe(2);
		expect(
			pairMathSpanIndexToDomIndex(dupAfterIdx.source, [elX0, elX1], dupAfterIdx.mathSpans, 0),
		).toBeNull();
		expect(
			pairMathSpanIndexToDomIndex(dupAfterIdx.source, [elX0, elX1], dupAfterIdx.mathSpans, 1),
		).toBe(0);
		expect(
			pairMathSpanIndexToDomIndex(dupAfterIdx.source, [elX0, elX1], dupAfterIdx.mathSpans, 2),
		).toBe(1);

		const dupStraddleIdx = buildMathIndex('Before $x$ and [note](/url "year $199$") and $x$');
		expect(
			findGeneratedContentOriginal(dupStraddleIdx, "math", 0, elX0)?.ordinal,
		).toBe(0);
		expect(
			findGeneratedContentOriginal(dupStraddleIdx, "math", 1, elX1)?.ordinal,
		).toBe(2);
		expect(
			pairMathSpanIndexToDomIndex(dupStraddleIdx.source, [elX0, elX1], dupStraddleIdx.mathSpans, 0),
		).toBe(0);
		expect(
			pairMathSpanIndexToDomIndex(dupStraddleIdx.source, [elX0, elX1], dupStraddleIdx.mathSpans, 1),
		).toBeNull();
		expect(
			pairMathSpanIndexToDomIndex(dupStraddleIdx.source, [elX0, elX1], dupStraddleIdx.mathSpans, 2),
		).toBe(1);

		unmount();
	});

	it("preserves raw inline HTML attributes without fake math atoms, keeps invalid angle text as math, and renders/resolves mid-line display math in Visual mode (R35A #3, #4)", () => {
		const katexCalls: Array<{ displayMode: boolean; tex: string }> = [];
		const mockKatex = {
			render(
				tex: string,
				element: HTMLElement,
				options: { displayMode: boolean },
			) {
				katexCalls.push({ displayMode: options.displayMode, tex });
				const wrapper = element.ownerDocument.createElement("span");
				wrapper.className = options.displayMode ? "katex-display" : "katex";
				const mathml = element.ownerDocument.createElement("span");
				mathml.className = "katex-mathml";
				const math = element.ownerDocument.createElement("math");
				math.textContent = tex;
				mathml.appendChild(math);
				wrapper.appendChild(mathml);
				element.replaceChildren(wrapper);
			},
		};
		const prevKatex = (window as unknown as { katex?: unknown }).katex;
		(window as unknown as { katex?: unknown }).katex = mockKatex;

		try {
			// Unit extractor checks for mid-line display math.
			expect(isDisplayMathMarkdown("$$x$$")).toBe(true);
			expect(isDisplayMathMarkdown("\\[x\\]")).toBe(true);
			expect(isDisplayMathMarkdown("$x$")).toBe(false);
			expect(extractInlineMathTex("$$x$$")).toBe("x");
			expect(extractInlineMathTex("\\[x\\]")).toBe("x");

			const mountVisualWithRuntime = (source: string) => {
				const harness = createMockDocumentSession(source);
				let runtime: ImmersiveVisualEditorRuntime | null = null;
				const rendered = render(
					createElement(MountedProseMirrorVisualEditor, {
						documentSession: harness.session,
						editable: true,
						onReady: (rt) => {
							runtime = rt;
						},
					}),
				);
				if (!runtime) throw new Error("visual-runtime-missing");
				const parsed = createEditorMarkdownBlockIndex(source, {
					referenceLabelCaseFoldProfile: 14,
				});
				const index: VisualEditorGeneratedContentTargetIndex = {
					blocks: parsed.blocks,
					length: source.length,
					mathSpans: parsed.mathSpans,
					revision: harness.session.document.getRevision(),
					source,
				};
				return { index, runtime: runtime as ImmersiveVisualEditorRuntime, unmount: rendered.unmount };
			};

			// 1. R35A #3: `A <x a="$y$"> and $z$` projects ONLY `$z$` and round-trips `<x a="$y$">` verbatim.
			{
				const source = 'A <x a="$y$"> and $z$';
				const doc = parseMarkdownToVisualDoc(source);
				expect(serializeVisualDocToMarkdown(doc)).toBe(source);

				const { index, runtime, unmount } = mountVisualWithRuntime(source);
				try {
					expect(index.mathSpans).toHaveLength(1);
					const mathEls = Array.from(
						runtime.surface.querySelectorAll<HTMLElement>(".easymde-math"),
					);
					expect(mathEls).toHaveLength(1);
					expect(mathEls[0]?.getAttribute("data-easymde-visual-markdown-source")).toBe("$z$");
					expect(mathEls[0]?.querySelectorAll(".katex-mathml > math")).toHaveLength(1);

					const ptrLease = runtime.prepareGeneratedContentTarget({
						element: mathEls[0] as Element,
						index,
						kind: "math",
						ordinal: 0,
					});
					expect(ptrLease?.target.original.full).toBe("$z$");
					ptrLease?.release();

					const zSpan = index.mathSpans[0];
					if (!zSpan) throw new Error("z-span-missing");
					const selPin = runtime.prepareGeneratedContentTargetForSelection({
						index,
						selection: { end: zSpan.to, start: zSpan.from },
					});
					expect(selPin?.target.original.full).toBe("$z$");
					expect(selPin?.getLease()?.root).toBe(mathEls[0]);
					selPin?.release();
				} finally {
					unmount();
				}
			}

			// 2. R35A #3 positive control: `A < x $y$ > and $z$` STILL projects BOTH `$y$` and `$z$`.
			{
				const source = "A < x $y$ > and $z$";
				const { index, runtime, unmount } = mountVisualWithRuntime(source);
				try {
					expect(index.mathSpans).toHaveLength(2);
					const mathEls = Array.from(
						runtime.surface.querySelectorAll<HTMLElement>(".easymde-math"),
					);
					expect(mathEls).toHaveLength(2);
					expect(
						runtime.prepareGeneratedContentTarget({
							element: mathEls[0] as Element,
							index,
							kind: "math",
							ordinal: 0,
						})?.target.original.full,
					).toBe("$y$");
					expect(
						runtime.prepareGeneratedContentTarget({
							element: mathEls[1] as Element,
							index,
							kind: "math",
							ordinal: 1,
						})?.target.original.full,
					).toBe("$z$");
				} finally {
					unmount();
				}
			}

			// 3. R35A #4: Mid-line display math `Before $$x$$ and $y$` & `Before \[x\] and $y$` render display MathML and resolve pointer & selection targets.
			for (const [source, expectedFirst] of [
				["Before $$x$$ and $y$", "$$x$$"],
				["Before \\[x\\] and $y$", "\\[x\\]"],
			] as const) {
				katexCalls.length = 0;
				const doc = parseMarkdownToVisualDoc(source);
				expect(serializeVisualDocToMarkdown(doc)).toBe(source);

				const { index, runtime, unmount } = mountVisualWithRuntime(source);
				try {
					expect(index.mathSpans).toHaveLength(2);
					const mathEls = Array.from(
						runtime.surface.querySelectorAll<HTMLElement>(".easymde-math"),
					);
					expect(mathEls).toHaveLength(2);
					expect(mathEls[0]?.classList.contains("easymde-math-block")).toBe(true);
					expect(mathEls[0]?.classList.contains("easymde-math-inline")).toBe(false);
					expect(mathEls[1]?.classList.contains("easymde-math-inline")).toBe(true);
					expect(mathEls[0]?.querySelectorAll(".katex-mathml > math")).toHaveLength(1);
					expect(mathEls[1]?.querySelectorAll(".katex-mathml > math")).toHaveLength(1);
					expect(katexCalls).toContainEqual({ displayMode: true, tex: "x" });
					expect(katexCalls).toContainEqual({ displayMode: false, tex: "y" });

					for (let i = 0; i < 2; i += 1) {
						const expectedFull = i === 0 ? expectedFirst : "$y$";
						const ptrLease = runtime.prepareGeneratedContentTarget({
							element: mathEls[i] as Element,
							index,
							kind: "math",
							ordinal: i,
						});
						expect(ptrLease?.target.original.full).toBe(expectedFull);
						ptrLease?.release();

						const span = index.mathSpans[i];
						if (!span) throw new Error("display-math-span-missing");
						const selPin = runtime.prepareGeneratedContentTargetForSelection({
							index,
							selection: { end: span.to, start: span.from },
						});
						expect(selPin?.target.original.full).toBe(expectedFull);
						expect(selPin?.getLease()?.root).toBe(mathEls[i]);
						selPin?.release();
					}
				} finally {
					unmount();
				}
			}

			// 4. R35A #2 / R35B #1: Full mounted Visual runtime on `[note](/url "year $199$") then $x$ and $x$` & `Before $x$ and [note](/url "year $199$") and $x$`, plus rejection on `[note](/url "cost $x$") and same $x$`.
			for (const scenario of [
				{
					expectedSpanIndices: [1, 2],
					source: '[note](/url "year $199$") then $x$ and $x$',
					strippedSpanIndex: 0,
				},
				{
					expectedSpanIndices: [0, 2],
					source: 'Before $x$ and [note](/url "year $199$") and $x$',
					strippedSpanIndex: 1,
				},
			]) {
				const { index, runtime, unmount } = mountVisualWithRuntime(scenario.source);
				try {
					expect(index.mathSpans).toHaveLength(3);
					const mathEls = Array.from(
						runtime.surface.querySelectorAll<HTMLElement>(".easymde-math"),
					);
					expect(mathEls).toHaveLength(2);
					for (let domIdx = 0; domIdx < 2; domIdx += 1) {
						const spanIdx = scenario.expectedSpanIndices[domIdx] as number;
						const span = index.mathSpans[spanIdx];
						if (!span) throw new Error("dup-math-span-missing");
						const ptrLease = runtime.prepareGeneratedContentTarget({
							element: mathEls[domIdx] as Element,
							index,
							kind: "math",
							ordinal: domIdx,
						});
						expect(ptrLease?.target.original.fullRange).toEqual({
							from: span.from,
							to: span.to,
						});
						ptrLease?.release();

						const selPin = runtime.prepareGeneratedContentTargetForSelection({
							index,
							selection: { end: span.to, start: span.from },
						});
						expect(selPin?.target.original.fullRange).toEqual({
							from: span.from,
							to: span.to,
						});
						expect(selPin?.getLease()?.root).toBe(mathEls[domIdx]);
						selPin?.release();
					}
					const stripped = index.mathSpans[scenario.strippedSpanIndex];
					if (!stripped) throw new Error("stripped-math-span-missing");
					expect(
						runtime.prepareGeneratedContentTargetForSelection({
							index,
							selection: { end: stripped.to, start: stripped.from },
						}),
					).toBeNull();
				} finally {
					unmount();
				}
			}

			{
				const source = '[note](/url "cost $x$") and same $x$';
				const { index, runtime, unmount } = mountVisualWithRuntime(source);
				try {
					expect(index.mathSpans).toHaveLength(2);
					const mathEls = Array.from(
						runtime.surface.querySelectorAll<HTMLElement>(".easymde-math"),
					);
					expect(mathEls).toHaveLength(1);
					expect(
						runtime.prepareGeneratedContentTarget({
							element: mathEls[0] as Element,
							index,
							kind: "math",
							ordinal: 0,
						}),
					).toBeNull();
					for (const span of index.mathSpans) {
						expect(
							runtime.prepareGeneratedContentTargetForSelection({
								index,
								selection: { end: span.to, start: span.from },
							}),
						).toBeNull();
					}
				} finally {
					unmount();
				}
			}

			// 5. R36A #1 / R36B #1: Nested math inside inline HTML (`<u>$x$</u>`) and raw HTML blocks (`<div>\n\n$a$\n\n</div>`) carries `data-easymde-visual-markdown-source` so pairing with link-title formulas succeeds while ambiguous duplicates reject cleanly.
			for (const scenario of [
				{
					expectedDomSources: ["$z$", "$x$"],
					expectedSpanIndices: [1, 2],
					source: '[note](/url "year $199$") then $z$ and <u>$x$</u>',
					strippedSpanIndex: 0,
				},
				{
					expectedDomSources: ["$a$", "$b$"],
					expectedSpanIndices: [0, 2],
					source: 'A <u>$a$</u> and [note](/url "year $199$") and $b$',
					strippedSpanIndex: 1,
				},
				{
					expectedDomSources: ["$a$", "$b$"],
					expectedSpanIndices: [0, 2],
					source: '<div>\n\n$a$\n\n</div>\n\n[note](/url "year $199$") and $b$',
					strippedSpanIndex: 1,
				},
			]) {
				const { index, runtime, unmount } = mountVisualWithRuntime(
					scenario.source,
				);
				try {
					expect(index.mathSpans, scenario.source).toHaveLength(3);
					const mathEls = Array.from(
						runtime.surface.querySelectorAll<HTMLElement>(".easymde-math"),
					);
					expect(mathEls, scenario.source).toHaveLength(2);
					for (let domIdx = 0; domIdx < 2; domIdx += 1) {
						expect(
							mathEls[domIdx]?.getAttribute(
								"data-easymde-visual-markdown-source",
							),
						).toBe(scenario.expectedDomSources[domIdx]);
						const spanIdx = scenario.expectedSpanIndices[domIdx] as number;
						const span = index.mathSpans[spanIdx];
						if (!span) throw new Error("nested-math-span-missing");

						const ptrLease = runtime.prepareGeneratedContentTarget({
							element: mathEls[domIdx] as Element,
							index,
							kind: "math",
							ordinal: domIdx,
						});
						expect(ptrLease?.target.original.fullRange).toEqual({
							from: span.from,
							to: span.to,
						});
						ptrLease?.release();

						const selPin = runtime.prepareGeneratedContentTargetForSelection({
							index,
							selection: { end: span.to, start: span.from },
						});
						expect(selPin?.target.original.fullRange).toEqual({
							from: span.from,
							to: span.to,
						});
						expect(selPin?.getLease()?.root).toBe(mathEls[domIdx]);
						selPin?.release();
					}
					const stripped = index.mathSpans[scenario.strippedSpanIndex];
					if (!stripped) throw new Error("stripped-nested-span-missing");
					expect(
						runtime.prepareGeneratedContentTargetForSelection({
							index,
							selection: { end: stripped.to, start: stripped.from },
						}),
					).toBeNull();
				} finally {
					unmount();
				}
			}

			{
				const source = '[note](/url "year $x$") then <u>$x$</u>';
				const { index, runtime, unmount } = mountVisualWithRuntime(source);
				try {
					expect(index.mathSpans).toHaveLength(2);
					const mathEls = Array.from(
						runtime.surface.querySelectorAll<HTMLElement>(".easymde-math"),
					);
					expect(mathEls).toHaveLength(1);
					expect(
						mathEls[0]?.getAttribute("data-easymde-visual-markdown-source"),
					).toBe("$x$");
					expect(
						runtime.prepareGeneratedContentTarget({
							element: mathEls[0] as Element,
							index,
							kind: "math",
							ordinal: 0,
						}),
					).toBeNull();
					for (const span of index.mathSpans) {
						expect(
							runtime.prepareGeneratedContentTargetForSelection({
								index,
								selection: { end: span.to, start: span.from },
							}),
						).toBeNull();
					}
				} finally {
					unmount();
				}
			}

			// 6. R36B #2: Case-sensitive League 2.8.2 inline HTML parity in Visual mode (`<SPAN title="$x$">` and `<span TITLE="$x$">` keep 2 math spans while lowercase `<span title="$x$">` suppresses attribute `$x$`).
			for (const source of [
				'A <SPAN title="$x$">text</SPAN> and $x$',
				'A <span TITLE="$x$">text</span> and $x$',
			]) {
				const { index, runtime, unmount } = mountVisualWithRuntime(source);
				try {
					expect(index.mathSpans, source).toHaveLength(2);
					const mathEls = Array.from(
						runtime.surface.querySelectorAll<HTMLElement>(".easymde-math"),
					);
					expect(mathEls, source).toHaveLength(2);
					for (let i = 0; i < 2; i += 1) {
						const span = index.mathSpans[i];
						if (!span) throw new Error("upper-html-math-span-missing");
						const ptrLease = runtime.prepareGeneratedContentTarget({
							element: mathEls[i] as Element,
							index,
							kind: "math",
							ordinal: i,
						});
						expect(ptrLease?.target.original.fullRange).toEqual({
							from: span.from,
							to: span.to,
						});
						ptrLease?.release();

						const selPin = runtime.prepareGeneratedContentTargetForSelection({
							index,
							selection: { end: span.to, start: span.from },
						});
						expect(selPin?.target.original.fullRange).toEqual({
							from: span.from,
							to: span.to,
						});
						expect(selPin?.getLease()?.root).toBe(mathEls[i]);
						selPin?.release();
					}
				} finally {
					unmount();
				}
			}

			{
				const source = 'A <span title="$x$">text</span> and $x$';
				const { index, runtime, unmount } = mountVisualWithRuntime(source);
				try {
					expect(index.mathSpans).toHaveLength(1);
					const mathEls = Array.from(
						runtime.surface.querySelectorAll<HTMLElement>(".easymde-math"),
					);
					expect(mathEls).toHaveLength(1);
					const span = index.mathSpans[0];
					if (!span) throw new Error("lower-html-math-span-missing");
					const ptrLease = runtime.prepareGeneratedContentTarget({
						element: mathEls[0] as Element,
						index,
						kind: "math",
						ordinal: 0,
					});
					expect(ptrLease?.target.original.fullRange).toEqual({
						from: span.from,
						to: span.to,
					});
					ptrLease?.release();
				} finally {
					unmount();
				}
			}

			// 7. R37A #1: Multiline inline HTML tokens across soft line breaks in Visual
			// suppress math inside raw HTML attributes/comments/declarations/PI/CDATA,
			// resolve `$z$` cleanly in both pointer and selection paths, and round-trip verbatim.
			for (const source of [
				'A <span\n title="$x$">text</span> and $z$',
				'A <span\r\n title="$x$">text</span> and $z$',
				'A <x\n a="$y$"> and $z$',
				"A <!--\n$x$\n--> and $z$",
				"A <!doctype\n$x$> and $z$",
				"A <?\n$x$\n?> and $z$",
				"A <![CDATA[\n$x$\n]]> and $z$",
				'> A <span\n>  title="$x$">text</span> and $z$',
			]) {
				const parsed = parseMarkdownWithBlockSources(source);
				const guard = createMarkdownRoundTripGuard(source, parsed);
				expect(guard.serialize(parsed.doc), `${source} round-trip`).toBe(source);
				if (!source.includes("\r\n")) {
					expect(serializeVisualDocToMarkdown(parsed.doc), `${source} serialize`).toBe(
						source,
					);
				}

				const { index, runtime, unmount } = mountVisualWithRuntime(source);
				try {
					expect(index.mathSpans, source).toHaveLength(1);
					const mathEls = Array.from(
						runtime.surface.querySelectorAll<HTMLElement>(".easymde-math"),
					);
					expect(mathEls, source).toHaveLength(1);
					const span = index.mathSpans[0];
					if (!span) throw new Error("multiline-html-math-span-missing");
					expect(source.slice(span.from, span.to)).toBe("$z$");

					const ptrLease = runtime.prepareGeneratedContentTarget({
						element: mathEls[0] as Element,
						index,
						kind: "math",
						ordinal: 0,
					});
					expect(ptrLease?.target.original.fullRange).toEqual({
						from: span.from,
						to: span.to,
					});
					ptrLease?.release();

					const selPin = runtime.prepareGeneratedContentTargetForSelection({
						index,
						selection: { end: span.to, start: span.from },
					});
					expect(selPin?.target.original.fullRange).toEqual({
						from: span.from,
						to: span.to,
					});
					expect(selPin?.getLease()?.root).toBe(mathEls[0]);
					selPin?.release();
				} finally {
					unmount();
				}
			}

			// Invalid declaration (`<!\ndoctype $x$>` has `\n` after `<!`, matching League 2.8.2):
			// both `$x$` and `$z$` render and resolve cleanly.
			{
				const source = "A <!\ndoctype $x$> and $z$";
				const { index, runtime, unmount } = mountVisualWithRuntime(source);
				try {
					expect(index.mathSpans).toHaveLength(2);
					const mathEls = Array.from(
						runtime.surface.querySelectorAll<HTMLElement>(".easymde-math"),
					);
					expect(mathEls).toHaveLength(2);
					for (let i = 0; i < 2; i += 1) {
						const span = index.mathSpans[i];
						if (!span) throw new Error("invalid-decl-math-span-missing");
						const ptrLease = runtime.prepareGeneratedContentTarget({
							element: mathEls[i] as Element,
							index,
							kind: "math",
							ordinal: i,
						});
						expect(ptrLease?.target.original.fullRange).toEqual({
							from: span.from,
							to: span.to,
						});
						ptrLease?.release();
					}
				} finally {
					unmount();
				}
			}

			// 8. R37A #3 + R37B #1: `stripInlineHtmlOutsideCode()` preserves recognized math spans
			// (including `<b>` / `</span>` inside TeX) and honors CommonMark backslash escapes on `<` and `` ` ``.
			for (const scenario of [
				{
					expectedTex: ["\\text{<b>yes</b>}", "z"],
					source: "A <u>$\\text{<b>yes</b>}$</u> and $z$",
				},
				{
					expectedTex: ["\\text{<b>yes</b>}", "z"],
					source: "A <u>$$\\text{<b>yes</b>}$$</u> and $z$",
				},
				{
					expectedTex: ["\\text{<b>yes</b>}", "z"],
					source: "A <u>\\(\\text{<b>yes</b>}\\)</u> and $z$",
				},
				{
					expectedTex: ["\\text{</span>}", "z"],
					source: "A <span>$\\text{</span>}$</span> and $z$",
				},
				{
					expectedTex: ["x"],
					source: '<span>\\<em title="$x$"></span>',
				},
				{
					expectedTex: ["x"],
					source: "<span>a\\</span>$x$</span>",
				},
				{
					expectedTex: ["x", "x"],
					source: "<span>a\\</span>$x$</span> and $x$",
				},
				{
					expectedTex: ["x"],
					source: "<span>\\`<em>$x$</em>\\`</span>",
				},
			]) {
				katexCalls.length = 0;
				const { index, runtime, unmount } = mountVisualWithRuntime(
					scenario.source,
				);
				try {
					expect(index.mathSpans, scenario.source).toHaveLength(
						scenario.expectedTex.length,
					);
					const mathEls = Array.from(
						runtime.surface.querySelectorAll<HTMLElement>(".easymde-math"),
					);
					expect(mathEls, scenario.source).toHaveLength(
						scenario.expectedTex.length,
					);
					expect(
						katexCalls.map((call) => call.tex),
						scenario.source,
					).toEqual(scenario.expectedTex);

					for (let i = 0; i < scenario.expectedTex.length; i += 1) {
						const span = index.mathSpans[i];
						if (!span) throw new Error("strip-math-span-missing");
						const ptrLease = runtime.prepareGeneratedContentTarget({
							element: mathEls[i] as Element,
							index,
							kind: "math",
							ordinal: i,
						});
						expect(ptrLease?.target.original.fullRange, scenario.source).toEqual({
							from: span.from,
							to: span.to,
						});
						ptrLease?.release();

						const selPin = runtime.prepareGeneratedContentTargetForSelection({
							index,
							selection: { end: span.to, start: span.from },
						});
						expect(selPin?.target.original.fullRange, scenario.source).toEqual({
							from: span.from,
							to: span.to,
						});
						expect(selPin?.getLease()?.root).toBe(mathEls[i]);
						selPin?.release();
					}
				} finally {
					unmount();
				}
			}
		} finally {
			(window as unknown as { katex?: unknown }).katex = prevKatex;
		}
	});
});
