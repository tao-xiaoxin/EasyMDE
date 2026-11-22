import { history, undo } from "prosemirror-history";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import {
	addColumnAfter,
	addRowAfter,
	columnResizing,
	tableEditing,
} from "prosemirror-tables";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseMarkdownToVisualDoc } from "../markdown-parser";
import { serializeVisualDocToMarkdown } from "../markdown-serializer";
import { visualEditorSchema } from "../visual-schema";
import {
	codeHighlightPluginKey,
	createCodeHighlightPlugin,
	createVisualNodeViews,
	type HighlightJsRuntime,
	type KatexRuntime,
	type MermaidRenderResult,
	type MermaidRuntime,
	sanitizeMermaidSvg,
	TableContainerNodeView,
	type VisualNodeViewsOptions,
} from "./index";

type TestEnhancementWindow = Window & {
	hljs?: HighlightJsRuntime;
	katex?: KatexRuntime;
	mermaid?: MermaidRuntime;
};

type Deferred<T> = Readonly<{
	promise: Promise<T>;
	reject: (reason?: unknown) => void;
	resolve: (value: T) => void;
}>;

const mountedViews: EditorView[] = [];

function createDeferred<T>(): Deferred<T> {
	let resolveRef: ((value: T) => void) | null = null;
	let rejectRef: ((reason?: unknown) => void) | null = null;
	const promise = new Promise<T>((resolve, reject) => {
		resolveRef = resolve;
		rejectRef = reject;
	});
	return {
		promise,
		resolve(value: T) {
			resolveRef?.(value);
		},
		reject(reason?: unknown) {
			rejectRef?.(reason);
		},
	};
}

function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

function mountVisualEditor(
	markdown: string,
	options: Readonly<{
		editable?: boolean;
		nodeViewsOptions?: VisualNodeViewsOptions;
		withColumnResizing?: boolean;
		withHighlightPlugin?: boolean;
	}> = {},
): EditorView {
	const host = document.createElement("div");
	host.className = "easymde-rendered-content easymde-code-mac";
	document.body.appendChild(host);

	const plugins = [history()];
	if (options.withHighlightPlugin !== false) {
		plugins.push(createCodeHighlightPlugin());
	}
	if (options.withColumnResizing) {
		plugins.push(columnResizing({ View: TableContainerNodeView }));
	}
	plugins.push(tableEditing());

	const state = EditorState.create({
		doc: parseMarkdownToVisualDoc(markdown),
		schema: visualEditorSchema,
		plugins,
	});

	const isEditable = options.editable ?? true;
	const view = new EditorView(host, {
		state,
		editable: () => isEditable,
		nodeViews: createVisualNodeViews(options.nodeViewsOptions),
	});
	mountedViews.push(view);
	return view;
}

afterEach(() => {
	while (mountedViews.length > 0) {
		const view = mountedViews.pop();
		if (view) {
			view.destroy();
			view.dom.parentElement?.remove();
		}
	}
	const win = window as TestEnhancementWindow;
	delete win.hljs;
	delete win.katex;
	delete win.mermaid;
	vi.restoreAllMocks();
});

describe("CodeBlockNodeView and createCodeHighlightPlugin", () => {
	it("renders Mac 3-dot code frame DOM with language badge and hljs decorations without mutating text nodes", () => {
		const highlightElement = vi.fn();
		const highlight = vi.fn((code: string, opts: Readonly<{ language: string }>) => {
			if (opts.language === "ts") {
				const html = code
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/\bconst\b/g, '<span class="hljs-keyword">const</span>')
					.replace(/\b42\b/g, '<span class="hljs-number">42</span>');
				return { value: html };
			}
			return { value: code };
		});
		const win = window as TestEnhancementWindow;
		win.hljs = {
			getLanguage: (lang) => (lang === "ts" || lang === "js" ? {} : undefined),
			highlight,
		};
		(win.hljs as Record<string, unknown>).highlightElement = highlightElement;

		const view = mountVisualEditor("```ts\nconst x = 42 < 100;\n```");
		const pre = view.dom.querySelector("pre.easymde-code-block");
		const code = pre?.querySelector("code");
		const badge = pre?.querySelector("span.easymde-visual-code-lang");

		expect(pre?.getAttribute("data-easymde-code-block")).toBe("1");
		expect(pre?.getAttribute("data-language")).toBe("ts");
		expect(code?.classList.contains("hljs")).toBe(true);
		expect(code?.classList.contains("language-ts")).toBe(true);
		expect(badge?.textContent).toBe("ts");
		expect(badge?.getAttribute("contenteditable")).toBe("false");
		expect(highlightElement).not.toHaveBeenCalled();

		expect(code?.textContent).toBe("const x = 42 < 100;");
		const keywordSpan = code?.querySelector("span.hljs-keyword");
		const numberSpan = code?.querySelector("span.hljs-number");
		expect(keywordSpan?.textContent).toBe("const");
		expect(numberSpan?.textContent).toBe("42");

		// Typing inside the code block preserves ProseMirror document text and updates decorations.
		const codeBlockEnd = 1 + "const x = 42 < 100;".length;
		view.dispatch(view.state.tr.insertText(" // ok", codeBlockEnd));
		expect(view.state.doc.firstChild?.textContent).toBe("const x = 42 < 100; // ok");
		expect(code?.textContent).toBe("const x = 42 < 100; // ok");
	});

	it("recomputes decorations incrementally only for touched code blocks and language updates", () => {
		const highlight = vi.fn(
			(code: string, _opts: Readonly<{ ignoreIllegals?: boolean; language: string }>) => ({
				value: code.replace(/\blet\b/g, '<span class="hljs-keyword">let</span>'),
			}),
		);
		const win = window as TestEnhancementWindow;
		win.hljs = {
			getLanguage: (lang) => (lang === "ts" || lang === "js" ? {} : undefined),
			highlight,
		};

		const view = mountVisualEditor("```ts\nlet a = 1;\n```\n\n```js\nlet b = 2;\n```");
		expect(highlight).toHaveBeenCalledTimes(2);
		highlight.mockClear();

		// Edit only the first code block; the second code block must NOT be re-highlighted.
		view.dispatch(view.state.tr.insertText("0", 10));
		expect(highlight).toHaveBeenCalledTimes(1);
		expect(highlight.mock.calls[0]?.[1]?.language).toBe("ts");

		// Selection-only transaction performs zero highlight work.
		highlight.mockClear();
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)),
		);
		expect(highlight).not.toHaveBeenCalled();

		// Language attribute update via setNodeMarkup updates DOM badge and triggers highlight.
		highlight.mockClear();
		const firstBlock = view.state.doc.firstChild;
		expect(firstBlock).not.toBeNull();
		view.dispatch(
			view.state.tr.setNodeMarkup(0, undefined, {
				...firstBlock?.attrs,
				language: "js",
			}),
		);
		expect(highlight).toHaveBeenCalledTimes(1);
		expect(highlight.mock.calls[0]?.[1]?.language).toBe("js");

		const pre = view.dom.querySelector("pre.easymde-code-block");
		expect(pre?.getAttribute("data-language")).toBe("js");
		expect(pre?.querySelector("code")?.classList.contains("language-js")).toBe(true);
		expect(pre?.querySelector("span.easymde-visual-code-lang")?.textContent).toBe("js");

		// Clearing language removes badge and data-language cleanly.
		view.dispatch(
			view.state.tr.setNodeMarkup(0, undefined, {
				...view.state.doc.firstChild?.attrs,
				language: "",
			}),
		);
		expect(pre?.getAttribute("data-language")).toBeNull();
		expect(pre?.querySelector("span.easymde-visual-code-lang")).toBeNull();
	});

	it("gracefully produces empty decorations when window.hljs is absent or language is unknown", () => {
		const viewWithoutHljs = mountVisualEditor("```ts\nconst x = 1;\n```");
		const stateWithout = codeHighlightPluginKey.getState(viewWithoutHljs.state);
		expect(stateWithout?.decorations.find().length).toBe(0);

		const win = window as TestEnhancementWindow;
		win.hljs = {
			getLanguage: () => undefined,
			highlight: vi.fn(() => ({ value: '<span class="hljs-keyword">x</span>' })),
		};
		const viewUnknownLang = mountVisualEditor("```unknownlang\nfoo bar\n```");
		const stateUnknown = codeHighlightPluginKey.getState(viewUnknownLang.state);
		expect(stateUnknown?.decorations.find().length).toBe(0);
	});
});

describe("ImageNodeView", () => {
	it("sanitizes unsafe URLs, applies 7-value scale styling, and toggles selection ring", () => {
		const view = mountVisualEditor(
			'![Banner](https://example.com/banner.png "Hero {width=50%}")',
		);

		// Insert an explicit unsafe-protocol image node directly into the doc to
		// verify ImageNodeView's defense-in-depth URL sanitization independently of markdown-it.
		const unsafeImageNode = visualEditorSchema.nodes.image.create({
			src: "javascript:alert(1)",
			alt: "Evil",
			title: null,
			scale: null,
		});
		view.dispatch(
			view.state.tr.insert(
				view.state.doc.content.size,
				visualEditorSchema.nodes.paragraph.create(null, [unsafeImageNode]),
			),
		);

		const images = view.dom.querySelectorAll("img.easymde-visual-image");
		expect(images.length).toBe(2);

		const safeImg = images[0] as HTMLImageElement;
		expect(safeImg.getAttribute("src")).toBe("https://example.com/banner.png");
		expect(safeImg.getAttribute("alt")).toBe("Banner");
		expect(safeImg.getAttribute("title")).toBe("Hero");
		expect(safeImg.getAttribute("data-easymde-image-scale")).toBe("50");
		expect(safeImg.style.width).toBe("50%");
		expect(safeImg.style.height).toBe("auto");

		const evilImg = images[1] as HTMLImageElement;
		expect(evilImg.getAttribute("src")).toBeNull();

		// Clicking the image selects it as a ProseMirror NodeSelection and toggles blue ring.
		safeImg.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
		expect(view.state.selection).toBeInstanceOf(NodeSelection);
		expect(safeImg.classList.contains("easymde-visual-image-selected")).toBe(true);
		expect(safeImg.getAttribute("data-easymde-visual-image-selected")).toBe("1");
		expect(safeImg.style.boxShadow).toContain("rgba(34, 113, 177, 0.28)");

		// Updating scale via setNodeAttribute while selected preserves NodeSelection and blue ring.
		const selectedPos = view.state.selection.from;
		view.dispatch(view.state.tr.setNodeAttribute(selectedPos, "scale", 100));
		expect(safeImg.getAttribute("data-easymde-image-scale")).toBe("100");
		expect(safeImg.style.width).toBe("100%");
		expect(safeImg.classList.contains("easymde-visual-image-selected")).toBe(true);

		// Moving selection away calls deselectNode() and removes selection feedback.
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
		);
		expect(safeImg.classList.contains("easymde-visual-image-selected")).toBe(false);
		expect(safeImg.getAttribute("data-easymde-visual-image-selected")).toBeNull();
		expect(safeImg.style.boxShadow).toBe("");
	});
});

describe("ProtectedAtomNodeView (math, mermaid, cards, raw-source editor)", () => {
	it("renders block and inline math via window.katex and falls back cleanly when katex is absent", () => {
		const katexRender = vi.fn((tex: string, target: HTMLElement) => {
			const span = target.ownerDocument.createElement("span");
			span.className = "katex";
			span.textContent = tex;
			target.replaceChildren(span);
		});
		const win = window as TestEnhancementWindow;
		win.katex = { render: katexRender };

		const view = mountVisualEditor("$$\nE = mc^2\n$$\n\nInline $a^2 + b^2 = c^2$ text.");
		const mathBlock = view.dom.querySelector("div.easymde-math.easymde-math-block");
		const mathInline = view.dom.querySelector("span.easymde-math.easymde-math-inline");

		expect(mathBlock?.getAttribute("contenteditable")).toBe("false");
		expect(mathBlock?.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"$$\nE = mc^2\n$$",
		);
		expect(mathBlock?.querySelector(".katex")?.textContent).toBe("E = mc^2");
		expect(mathInline?.querySelector(".katex")?.textContent).toBe("a^2 + b^2 = c^2");

		expect(katexRender).toHaveBeenCalledWith(
			"E = mc^2",
			expect.any(HTMLElement),
			{ displayMode: true, throwOnError: false, strict: "ignore" },
		);
		expect(katexRender).toHaveBeenCalledWith(
			"a^2 + b^2 = c^2",
			expect.any(HTMLElement),
			{ displayMode: false, throwOnError: false, strict: "ignore" },
		);

		// Without katex, renders clean monospace fallback.
		delete win.katex;
		const fallbackView = mountVisualEditor("\\[\nx + y\n\\]");
		const fallbackBlock = fallbackView.dom.querySelector("div.easymde-math-block");
		expect(fallbackBlock?.querySelector("code.easymde-protected-fallback")?.textContent).toBe(
			"\\[\nx + y\n\\]",
		);
	});

	it("renders Mermaid asynchronously, sanitizes unsafe SVG, and guards against stale/destroyed resolutions", async () => {
		const firstRender = createDeferred<MermaidRenderResult>();
		const secondRender = createDeferred<MermaidRenderResult>();
		let callCount = 0;

		const renderMock = vi.fn((_id: string, _source: string) => {
			callCount += 1;
			return callCount === 1 ? firstRender.promise : secondRender.promise;
		});
		const win = window as TestEnhancementWindow;
		win.mermaid = {
			initialize: vi.fn(),
			render: renderMock,
		};

		const view = mountVisualEditor("```mermaid\ngraph TD\n  A --> B\n```");
		await flushMicrotasks();
		expect(renderMock).toHaveBeenCalledTimes(1);
		expect(renderMock.mock.calls[0]?.[1]).toBe("graph TD\n  A --> B");

		// Update the mermaid node before firstRender resolves to test stale cancellation.
		const node = view.state.doc.firstChild;
		view.dispatch(
			view.state.tr.setNodeMarkup(0, undefined, {
				...node?.attrs,
				rawMarkdown: "~~~mermaid\ngraph LR\n  X --> Y\n~~~",
			}),
		);
		await flushMicrotasks();
		expect(renderMock).toHaveBeenCalledTimes(2);
		expect(renderMock.mock.calls[1]?.[1]).toBe("graph LR\n  X --> Y");

		// Resolve second (current) render with unsafe script + event handlers + valid foreignObject.
		secondRender.resolve({
			svg: '<svg onload="alert(1)" viewBox="0 0 100 50"><script>evil()</script><g onclick="hack()"><a href="javascript:alert(2)"><text>Current Diagram</text></a><foreignObject><div><span>Safe Label</span></div></foreignObject></g></svg>',
		});
		await flushMicrotasks();

		const mermaidEl = view.dom.querySelector("div.easymde-mermaid");
		const svg = mermaidEl?.querySelector("svg");
		expect(svg).not.toBeNull();
		expect(svg?.getAttribute("onload")).toBeNull();
		expect(svg?.querySelector("script")).toBeNull();
		expect(svg?.querySelector("g")?.getAttribute("onclick")).toBeNull();
		expect(svg?.querySelector("a")?.getAttribute("href")).toBeNull();
		expect(svg?.querySelector("foreignObject span")?.textContent).toBe("Safe Label");
		expect(svg?.textContent).toContain("Current Diagram");

		// Now resolve stale firstRender: it must NOT overwrite the current diagram!
		firstRender.resolve({
			svg: "<svg><text>Stale Diagram</text></svg>",
		});
		await flushMicrotasks();
		expect(mermaidEl?.querySelector("svg")?.textContent).toContain("Current Diagram");
		expect(mermaidEl?.querySelector("svg")?.textContent).not.toContain("Stale Diagram");

		// Verify destroy cancellation guard prevents late async mutation.
		const destroyDeferred = createDeferred<MermaidRenderResult>();
		win.mermaid = { render: vi.fn(() => destroyDeferred.promise) };
		const doomedView = mountVisualEditor("```mermaid\ngraph TD\n  P --> Q\n```");
		await flushMicrotasks();
		const doomedCard = doomedView.dom.querySelector("div.easymde-mermaid");
		doomedView.destroy();
		destroyDeferred.resolve({ svg: "<svg><text>After Destroy</text></svg>" });
		await flushMicrotasks();
		expect(doomedCard?.querySelector("svg")).toBeNull();
	});

	it("sanitizes standalone SVG payloads with namespaced xlink:href and unsafe styles", () => {
		const sanitized = sanitizeMermaidSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)" style="background: expression(1)"><text>Safe</text></a><use xlink:href="#arrow-head" /></svg>',
			document,
		);
		expect(sanitized).not.toBeNull();
		const anchor = sanitized?.querySelector("a");
		expect(anchor?.getAttribute("xlink:href")).toBeNull();
		expect(anchor?.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBeNull();
		expect(anchor?.getAttribute("style")).toBeNull();
		const useEl = sanitized?.querySelector("use");
		expect(useEl?.getAttribute("xlink:href")).toBe("#arrow-head");
	});

	it("renders toc, footnotes, raw, footnote-ref, and raw-inline cards safely without HTML injection", () => {
		const markdown = [
			"[TOC]",
			"[^1]: Footnote body",
			'<div class="custom"><script>alert(1)</script></div>',
			"Reference[^1] and inline<!-- note -->.",
		].join("\n\n");
		const view = mountVisualEditor(markdown);

		const toc = view.dom.querySelector('[data-easymde-protected-kind="toc"]');
		const footnotes = view.dom.querySelector('[data-easymde-protected-kind="footnotes"]');
		const rawBlock = view.dom.querySelector('[data-easymde-protected-kind="raw"]');
		const footnoteRef = view.dom.querySelector('[data-easymde-protected-kind="footnote-ref"]');
		const rawInline = view.dom.querySelector('[data-easymde-protected-kind="raw-inline"]');

		expect(toc?.getAttribute("data-easymde-visual-markdown-source")).toBe("[TOC]");
		expect(footnotes?.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"[^1]: Footnote body",
		);
		expect(rawBlock?.querySelector("script")).toBeNull();
		expect(rawBlock?.textContent).toContain("<script>alert(1)</script>");
		expect(footnoteRef?.getAttribute("data-easymde-visual-markdown-source")).toBe("[^1]");
		expect(rawInline?.getAttribute("data-easymde-visual-markdown-source")).toBe("<!-- note -->");
	});

	it("supports double-click raw-source editing with Enter/Save commit, Undo, and Escape zero-mutation cancel", () => {
		const view = mountVisualEditor("$$\nE = mc^2\n$$\n\nInline $x + 1$ end.");

		// Block protected card: double-click -> Escape cancels with zero doc change.
		const mathBlock = view.dom.querySelector("div.easymde-math-block") as HTMLElement;
		mathBlock.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		const textarea = mathBlock.querySelector("textarea.easymde-protected-source-input") as HTMLTextAreaElement;
		expect(textarea).not.toBeNull();
		expect(textarea.value).toBe("$$\nE = mc^2\n$$");

		textarea.value = "$$\na^2 + b^2 = c^2\n$$";
		textarea.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
		);
		expect(mathBlock.querySelector("textarea")).toBeNull();
		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe("$$\nE = mc^2\n$$");

		// Double-click again -> modify -> Enter commits real ProseMirror transaction.
		mathBlock.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		const textarea2 = mathBlock.querySelector("textarea.easymde-protected-source-input") as HTMLTextAreaElement;
		textarea2.value = "$$\na^2 + b^2 = c^2\n$$";
		textarea2.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
		);

		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe("$$\na^2 + b^2 = c^2\n$$");
		expect(mathBlock.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"$$\na^2 + b^2 = c^2\n$$",
		);

		// Undo restores the previous rawMarkdown seamlessly.
		expect(undo(view.state, view.dispatch)).toBe(true);
		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe("$$\nE = mc^2\n$$");
		expect(mathBlock.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"$$\nE = mc^2\n$$",
		);

		// Inline protected card: double-click -> edit -> Save button commits.
		const mathInline = view.dom.querySelector("span.easymde-math-inline") as HTMLElement;
		mathInline.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		const input = mathInline.querySelector("input.easymde-protected-source-input") as HTMLInputElement;
		expect(input).not.toBeNull();
		input.value = "$y = 2x$";
		const saveButton = mathInline.querySelector("button.easymde-protected-save-btn") as HTMLButtonElement;
		saveButton.click();
		expect(serializeVisualDocToMarkdown(view.state.doc)).toContain("Inline $y = 2x$ end.");
	});

	it("does not open raw-source editor when editor is read-only", () => {
		const view = mountVisualEditor("$$\nE = mc^2\n$$", { editable: false });
		const mathBlock = view.dom.querySelector("div.easymde-math-block") as HTMLElement;
		mathBlock.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		expect(mathBlock.querySelector("textarea")).toBeNull();
	});
});

describe("TaskItemNodeView", () => {
	it("renders interactive checkbox and toggles checked via undoable ProseMirror transaction", () => {
		const view = mountVisualEditor("- [ ] First task\n- [x] Second task");
		const items = view.dom.querySelectorAll("li.task-list-item");
		expect(items.length).toBe(2);

		const firstItem = items[0] as HTMLLIElement;
		const firstCheckbox = firstItem.querySelector(
			'input[type="checkbox"].task-list-item-checkbox',
		) as HTMLInputElement;
		const firstContent = firstItem.querySelector("div.easymde-task-item-content");

		expect(firstItem.getAttribute("data-checked")).toBe("false");
		expect(firstCheckbox.checked).toBe(false);
		expect(firstCheckbox.getAttribute("contenteditable")).toBe("false");
		expect(firstContent?.textContent).toBe("First task");

		// Clicking toggles false -> true via transaction.
		firstCheckbox.click();
		expect(firstItem.getAttribute("data-checked")).toBe("true");
		expect(firstCheckbox.checked).toBe(true);
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
			"- [x] First task\n- [x] Second task",
		);

		// Undo cleanly restores unchecked state.
		expect(undo(view.state, view.dispatch)).toBe(true);
		expect(firstItem.getAttribute("data-checked")).toBe("false");
		expect(firstCheckbox.checked).toBe(false);
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
			"- [ ] First task\n- [x] Second task",
		);
	});

	it("prevents checkbox toggling when editor is read-only", () => {
		const view = mountVisualEditor("- [ ] Locked task", { editable: false });
		const checkbox = view.dom.querySelector(
			"input.task-list-item-checkbox",
		) as HTMLInputElement;
		expect(checkbox.disabled).toBe(true);
		checkbox.click();
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe("- [ ] Locked task");
	});
});

describe("TableContainerNodeView", () => {
	it("wraps table in .easymde-table-container and supports prosemirror-tables operations and colgroup widths", () => {
		const markdown = [
			"<!-- easymde-table-align:v1 [[1,\"center\"]] -->",
			"| Left | Right |",
			"| :--- | ---: |",
			"| A | B |",
		].join("\n");

		const view = mountVisualEditor(markdown, { withColumnResizing: true });
		const section = view.dom.querySelector("section.table-container.easymde-table-container");
		expect(section).not.toBeNull();
		expect(section?.getAttribute("data-easymde-table-align-annotation")).toBe(
			'<!-- easymde-table-align:v1 [[1,"center"]] -->',
		);

		const table = section?.querySelector("table");
		const colgroup = table?.firstElementChild;
		const tbody = table?.querySelector("tbody");
		expect(colgroup?.tagName).toBe("COLGROUP");
		expect(colgroup?.querySelectorAll("col").length).toBe(2);
		expect(tbody?.querySelectorAll("tr").length).toBe(2);

		// prosemirror-tables commands add rows and columns seamlessly inside our NodeView.
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
		expect(addRowAfter(view.state, view.dispatch)).toBe(true);
		expect(addColumnAfter(view.state, view.dispatch)).toBe(true);
		expect(tbody?.querySelectorAll("tr").length).toBe(3);
		expect(colgroup?.querySelectorAll("col").length).toBe(3);

		// Setting explicit colwidth on a header cell updates <col> style width.
		const firstCellPos = 2; // table(+1) -> row(+1) -> first th at 2
		const firstCell = view.state.doc.nodeAt(firstCellPos);
		view.dispatch(
			view.state.tr.setNodeMarkup(firstCellPos, undefined, {
				...firstCell?.attrs,
				colwidth: [180],
			}),
		);
		const firstCol = colgroup?.querySelector("col") as HTMLTableColElement | null;
		expect(firstCol?.style.width).toBe("180px");
	});
});
