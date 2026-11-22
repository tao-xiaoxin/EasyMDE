import { act, render } from "@testing-library/react";
import { createElement } from "@wordpress/element";
import { history } from "prosemirror-history";
import { EditorState, NodeSelection, Plugin, TextSelection } from "prosemirror-state";
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
import type { EditorDocumentSession } from "../document-source/editor-document-session";
import { parseMarkdownToVisualDoc } from "./markdown-parser";
import { serializeVisualDocToMarkdown } from "./markdown-serializer";
import { ProseMirrorVisualEditor } from "./ProseMirrorVisualEditor";
import { createVisualKeymapPlugins } from "./visual-commands";
import { visualEditorSchema } from "./visual-schema";
import {
	assertCanonicalChangePrecondition,
	computeVisualSelectionToMarkdownSelection,
	resolveMarkdownSelectionToVisualSelection,
} from "./visual-source-mapping";
import {
	createVisualTablePlugin,
	deleteCurrentTable,
	deleteCurrentTableColumn,
	deleteCurrentTableRow,
	getCurrentTableCellInfo,
	insertTableColumnAfter,
	insertTableColumnBefore,
	insertTableRowAfter,
	insertTableRowBefore,
	isSelectionInTable,
	setTableCellAlignment,
} from "./visual-table-operations";

type MockDocumentHarness = Readonly<{
	applyTextChangeSpy: ReturnType<typeof vi.fn>;
	emitExternalChange: (nextValue: string, nextSelection?: VisualEditorSelection) => void;
	session: EditorDocumentSession;
	setEditable: (editable: boolean) => void;
}>;

function createMockDocumentSession(initialMarkdown: string): MockDocumentHarness {
	let value = initialMarkdown;
	let revision = 0;
	let editable = true;
	let selection: VisualEditorSelection = { direction: "none", end: 0, start: 0 };
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
		return changed ? (change.changes ?? { from: 0, insert: value, to: value.length }) : null;
	});

	const documentMock: CodeMirrorDocumentSession = {
		applyTextChange: applyTextChangeSpy as CodeMirrorDocumentSession["applyTextChange"],
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
		emitExternalChange(nextValue: string, nextSelection?: VisualEditorSelection) {
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
	return { group: "format", icon: "editor-code", label: overrides.id, surface: "main", ...overrides };
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
	payload: Readonly<{ files?: ReadonlyArray<File>; html?: string; text?: string }>,
): Event {
	const files = payload.files ?? [];
	const dataTransfer = {
		files,
		getData: (mime: string) =>
			mime === "text/plain" ? (payload.text ?? "") : mime === "text/html" ? (payload.html ?? "") : "",
		items: files.map((file) => ({ getAsFile: () => file, kind: "file", type: file.type })),
	};
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", {
		value: dataTransfer,
	});
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
		plugins: [history(), createVisualTablePlugin(), ...createVisualKeymapPlugins()],
		schema: visualEditorSchema,
	});
	const view = new EditorView(host, { state });
	standaloneViews.push(view);
	return view;
}

function dispatchKeyDown(view: EditorView, key: string): boolean {
	const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
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
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = { current: null };
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
		expect(rt.surface.querySelector('p[data-custom-node-view="1"]')?.textContent).toBe(
			"Paragraph text.",
		);
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
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = { current: null };

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
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 10)));
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
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = { current: null };

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

		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 12)));
		expect(rt.executeCommand(makeToolbarCommand({ action: "bold", id: "bold" }))).toBe("handled");
		expect(harness.session.document.getValue()).toBe("Hello **world**");
		expect(onMarkdownChange).toHaveBeenCalledWith("Hello **world**");

		view.dispatch(view.state.tr.insertText("!", view.state.doc.content.size - 1));
		expect(harness.session.document.getValue()).toBe("Hello **world!**");

		expect(rt.executeCommand(makeToolbarCommand({ action: "copyWechat", id: "wechat" }))).toBe(
			"unsupported",
		);
		harness.setEditable(false);
		expect(rt.executeCommand(makeToolbarCommand({ action: "italic", id: "italic" }))).toBe(
			"blocked",
		);
	});

	it("updates ProseMirror DOM on external documentSession changes without echo loops", () => {
		const harness = createMockDocumentSession("Initial text");
		const onMarkdownChange = vi.fn();
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = { current: null };

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
		expect(rt.surface.querySelector("p")?.textContent).toBe("New body paragraph");
		expect(harness.applyTextChangeSpy).toHaveBeenCalledTimes(callsBefore);
		expect(onMarkdownChange).not.toHaveBeenCalled();
	});

	it("defers Markdown writes during IME composition and commits once on compositionend", () => {
		const harness = createMockDocumentSession("Hello");
		const onMarkdownChange = vi.fn();
		const capture = createViewCapturePlugin();
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = { current: null };

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
		view.dispatch(view.state.tr.replaceWith(endPos, endPos + 3, visualEditorSchema.text(" 你好")));

		expect(harness.applyTextChangeSpy).not.toHaveBeenCalled();
		expect(onMarkdownChange).not.toHaveBeenCalled();

		rt.surface.dispatchEvent(new Event("compositionend", { bubbles: true }));
		expect(harness.applyTextChangeSpy).toHaveBeenCalledTimes(1);
		expect(harness.session.document.getValue()).toBe("Hello 你好");
		expect(onMarkdownChange).toHaveBeenCalledTimes(1);
	});

	it("handles a 220-block large document in one unified ProseMirror editor without window splitting", () => {
		const blocks: string[] = [];
		for (let i = 1; i <= 220; i += 1) {
			blocks.push(i % 20 === 1 ? `## Section ${i}` : `Paragraph block number ${i}.`);
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
		for (let i = 0; i < 199; i += 1) blockPos += view.state.doc.child(i).nodeSize;
		const targetBlock = view.state.doc.child(199);
		expect(targetBlock.textContent).toBe("Paragraph block number 200.");

		view.dispatch(view.state.tr.insertText(" [edited]", blockPos + targetBlock.nodeSize - 1));
		const updatedBlocks = harness.session.document.getValue().split("\n\n");
		expect(updatedBlocks.length).toBe(220);
		expect(updatedBlocks[0]).toBe("## Section 1");
		expect(updatedBlocks[199]).toBe("Paragraph block number 200. [edited]");
		expect(updatedBlocks[219]).toBe("Paragraph block number 220.");
	});
});

describe("visual-table-operations", () => {
	it("supports cell info, row/column mutations, alignment scopes, and cell Backspace/Enter guards", () => {
		const view = createStandaloneTableView("| Name | Score |\n| :--- | ---: |\n| Alice | 95 |");
		const row0Size = view.state.doc.firstChild?.child(0).nodeSize ?? 0;
		const bodyFirstCellPos = 1 + row0Size + 1 + 1 + 1;
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyFirstCellPos)));

		expect(isSelectionInTable(view.state)).toBe(true);
		expect(getCurrentTableCellInfo(view.state)).toEqual({
			alignment: "left",
			colCount: 2,
			colIndex: 0,
			isHeader: false,
			rowCount: 2,
			rowIndex: 1,
		});

		expect(dispatchKeyDown(view, "Backspace")).toBe(true);
		expect(view.state.doc.firstChild?.type.name).toBe("table");
		expect(dispatchKeyDown(view, "Enter")).toBe(true);
		expect(serializeVisualDocToMarkdown(view.state.doc)).toContain("<br>Alice");

		expect(insertTableRowAfter(view.state, view.dispatch)).toBe(true);
		expect(insertTableRowBefore(view.state, view.dispatch)).toBe(true);
		expect(view.state.doc.firstChild?.childCount).toBe(4);
		expect(deleteCurrentTableRow(view.state, view.dispatch)).toBe(true);
		expect(view.state.doc.firstChild?.childCount).toBe(3);

		expect(insertTableColumnAfter(view.state, view.dispatch)).toBe(true);
		expect(insertTableColumnBefore(view.state, view.dispatch)).toBe(true);
		expect(view.state.doc.firstChild?.child(0).childCount).toBe(4);
		expect(deleteCurrentTableColumn(view.state, view.dispatch)).toBe(true);
		expect(view.state.doc.firstChild?.child(0).childCount).toBe(3);

		expect(setTableCellAlignment(view.state, view.dispatch, "center", "column")).toBe(true);
		expect(getCurrentTableCellInfo(view.state)?.alignment).toBe("center");

		expect(setTableCellAlignment(view.state, view.dispatch, "right", "cell")).toBe(true);
		expect(serializeVisualDocToMarkdown(view.state.doc)).toContain("<!-- easymde-table-align:v1 ");

		expect(setTableCellAlignment(view.state, view.dispatch, "right", "row")).toBe(true);
		expect(serializeVisualDocToMarkdown(view.state.doc)).toContain("<!-- easymde-table-align:v1 ");

		expect(setTableCellAlignment(view.state, view.dispatch, "left", "table")).toBe(true);
		const tableAlignedMd = serializeVisualDocToMarkdown(view.state.doc);
		expect(tableAlignedMd).not.toContain("<!-- easymde-table-align:v1 ");
		expect(tableAlignedMd).toContain("| :--- | :--- | :--- |");

		expect(deleteCurrentTable(view.state, view.dispatch)).toBe(true);
		expect(isSelectionInTable(view.state)).toBe(false);
	});
});

describe("ImmersiveVisualEditorRuntime context-menu, selection mapping, and paste/drop", () => {
	it("maps selections bidirectionally and enforces strict canonical change preconditions", () => {
		const markdown = "# Heading\n\nParagraph with ![Alt](https://example.com/a.png)\n\n```ts\nconst x = 1;\n```\n\n$$\nx^2\n$$";
		const doc = parseMarkdownToVisualDoc(markdown);

		const mdSel = computeVisualSelectionToMarkdownSelection(doc, TextSelection.create(doc, 8, 1), markdown);
		expect(mdSel.direction).toBe("backward");
		expect(markdown.slice(mdSel.start, mdSel.end)).toBe("Heading");
		const restored = resolveMarkdownSelectionToVisualSelection(doc, markdown, mdSel);
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
		expect(markdown.slice(imgMdSel.start, imgMdSel.end)).toBe("![Alt](https://example.com/a.png)");

		const mathIdx = markdown.indexOf("$$");
		const mathSel = resolveMarkdownSelectionToVisualSelection(doc, markdown, {
			direction: "none",
			end: markdown.length,
			start: mathIdx,
		});
		expect(mathSel).toBeInstanceOf(NodeSelection);

		const zeroSel: VisualEditorSelection = { direction: "none", end: 0, start: 0 };
		const baseChange = {
			changes: { from: 0, insert: "## ", to: 2 },
			selection: { direction: "none" as const, end: 3, start: 3 },
			value: `## ${markdown.slice(2)}`,
		};
		expect(
			assertCanonicalChangePrecondition(
				{ change: baseChange, expected: { revision: 1, selection: zeroSel, value: markdown } },
				2,
				markdown,
				zeroSel,
			),
		).toEqual({ code: "canonical-change-revision-mismatch", ok: false });
		expect(
			assertCanonicalChangePrecondition(
				{ change: baseChange, expected: { revision: 2, selection: zeroSel, value: "stale" } },
				2,
				markdown,
				zeroSel,
			),
		).toEqual({ code: "canonical-change-value-mismatch", ok: false });
		expect(
			assertCanonicalChangePrecondition(
				{
					change: baseChange,
					expected: { revision: 2, selection: { direction: "none", end: 1, start: 1 }, value: markdown },
				},
				2,
				markdown,
				zeroSel,
			),
		).toEqual({ code: "canonical-change-selection-mismatch", ok: false });
	});

	it("implements context menu leases, selection prep, applyCanonicalChange, and target leases", () => {
		const initialMd = "Intro\n\n![Photo](https://example.com/p.png)\n\n$$\na + b\n$$\n\n```mermaid\ngraph TD\nA-->B\n```";
		const harness = createMockDocumentSession(initialMd);
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = { current: null };
		const previewIdentity = { editMap: null, revision: 5, signature: "sig-5", sourceRevision: 0 };

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

		const imgEl = rt.surface.querySelector("img") as HTMLImageElement;
		expect(rt.prepareContextMenuSelection?.(imgEl, undefined, "pointer")).toBe(true);
		const imgSel = harness.session.document.getSelection();
		expect(initialMd.slice(imgSel.start, imgSel.end)).toBe("![Photo](https://example.com/p.png)");
		expect(harness.session.document.getRevision()).toBe(0);

		const imageIndex = buildSingleImageIndex(initialMd, "Photo", "https://example.com/p.png");
		const imgRange = {
			end: imageIndex.images[0]?.end ?? 0,
			start: imageIndex.images[0]?.start ?? 0,
		};
		const imgLease = rt.prepareImageTarget({ element: imgEl, index: imageIndex, selection: imgRange });
		expect(imgLease?.isCurrent()).toBe(true);
		expect(imgLease?.target.original.destination).toBe("https://example.com/p.png");
		imgLease?.release();
		expect(imgLease?.isCurrent()).toBe(false);

		const imgPin = rt.prepareImageTargetBySelection({ index: imageIndex, selection: imgRange });
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
				{ editable: false, from: mermaidStart, kind: "code", lineEnd: 10, lineStart: 8, to: initialMd.length },
			],
			length: initialMd.length,
			mathSpans: [
				{ bodyFrom: mathStart + 3, bodyTo: mathEnd - 3, displayMode: true, from: mathStart, to: mathEnd },
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
		expect(rt.prepareSourceNavigation({ revision: 999, value: "stale" })).toBe(false);
		unmount();
	});

	it("parses pasted plain Markdown, pastes verbatim inside code blocks, and delegates image paste/drop", () => {
		const harness = createMockDocumentSession("");
		const onImagePaste = vi.fn();
		const onImageDrop = vi.fn();
		const capture = createViewCapturePlugin();
		const runtimeRef: { current: ImmersiveVisualEditorRuntime | null } = { current: null };

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

		expect(triggerPaste(createFakeTransferEvent("paste", { text: "# Pasted Title\n\n- Alpha\n- Beta" }))).toBe(true);
		expect(rt.surface.querySelector("h1")?.textContent).toBe("Pasted Title");
		expect(rt.surface.querySelectorAll("ul li").length).toBe(2);
		expect(harness.session.document.getValue()).toBe("# Pasted Title\n\n- Alpha\n- Beta");

		const pngFile = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
		expect(triggerPaste(createFakeTransferEvent("paste", { files: [pngFile] }))).toBe(true);
		expect(onImagePaste).toHaveBeenCalledTimes(1);
		expect(onImagePaste.mock.calls[0]?.[0]).toEqual([pngFile]);

		const dropFile = new File([new Uint8Array([4, 5, 6])], "drop.jpg", { type: "image/jpeg" });
		const dropEvent = createFakeTransferEvent("drop", { files: [dropFile] });
		let dropHandled = false;
		view.someProp("handleDrop", (fn) => {
			if (fn(view, dropEvent as DragEvent, view.state.selection.content(), false)) {
				dropHandled = true;
				return true;
			}
			return false;
		});
		expect(dropHandled).toBe(true);
		expect(onImageDrop).toHaveBeenCalledTimes(1);
		expect(onImageDrop.mock.calls[0]?.[0]).toEqual([dropFile]);

		act(() => {
			harness.emitExternalChange("```ts\nconst a = 1;\n```", { direction: "none", end: 18, start: 18 });
		});
		expect(triggerPaste(createFakeTransferEvent("paste", { text: "\n# Not a heading" }))).toBe(true);
		expect(rt.surface.querySelector("h1")).toBeNull();
		expect(rt.surface.querySelector("pre code")?.textContent).toContain("# Not a heading");
	});
});
