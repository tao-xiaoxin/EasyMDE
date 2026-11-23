import { history, undo, undoDepth } from "prosemirror-history";
import type { Transaction } from "prosemirror-state";
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
	PREVIEW_RUNTIME_READY_EVENT,
	PROTECTED_CARD_COMMIT_META,
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
		onTransaction?: (transaction: Transaction) => void;
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
	const viewRef: { current: EditorView | null } = { current: null };
	const view = new EditorView(host, {
		state,
		editable: () => isEditable,
		nodeViews: createVisualNodeViews(options.nodeViewsOptions),
		dispatchTransaction(transaction) {
			options.onTransaction?.(transaction);
			const activeView = viewRef.current;
			if (!activeView) return;
			activeView.updateState(activeView.state.apply(transaction));
		},
	});
	viewRef.current = view;
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
		const highlight = vi.fn(
			(code: string, opts: Readonly<{ language: string }>) => {
				if (opts.language === "ts") {
					const html = code
						.replace(/</g, "&lt;")
						.replace(/>/g, "&gt;")
						.replace(/\bconst\b/g, '<span class="hljs-keyword">const</span>')
						.replace(/\b42\b/g, '<span class="hljs-number">42</span>');
					return { value: html };
				}
				return { value: code };
			},
		);
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
		expect(view.state.doc.firstChild?.textContent).toBe(
			"const x = 42 < 100; // ok",
		);
		expect(code?.textContent).toBe("const x = 42 < 100; // ok");
	});

	it("recomputes decorations incrementally only for touched code blocks and language updates", () => {
		const highlight = vi.fn(
			(
				code: string,
				_opts: Readonly<{ ignoreIllegals?: boolean; language: string }>,
			) => ({
				value: code.replace(
					/\blet\b/g,
					'<span class="hljs-keyword">let</span>',
				),
			}),
		);
		const win = window as TestEnhancementWindow;
		win.hljs = {
			getLanguage: (lang) => (lang === "ts" || lang === "js" ? {} : undefined),
			highlight,
		};

		const view = mountVisualEditor(
			"```ts\nlet a = 1;\n```\n\n```js\nlet b = 2;\n```",
		);
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
		expect(pre?.querySelector("code")?.classList.contains("language-js")).toBe(
			true,
		);
		expect(
			pre?.querySelector("span.easymde-visual-code-lang")?.textContent,
		).toBe("js");

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
			highlight: vi.fn(() => ({
				value: '<span class="hljs-keyword">x</span>',
			})),
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
		expect(safeImg.getAttribute("data-easymde-visual-image")).toBe("1");
		expect(safeImg.getAttribute("data-easymde-image-scale")).toBe("50");
		expect(safeImg.style.width).toBe("50%");
		expect(safeImg.style.height).toBe("auto");

		const evilImg = images[1] as HTMLImageElement;
		expect(evilImg.getAttribute("src")).toBeNull();

		// Clicking the image selects it as a ProseMirror NodeSelection and toggles blue ring.
		safeImg.dispatchEvent(
			new MouseEvent("click", { bubbles: true, button: 0 }),
		);
		expect(view.state.selection).toBeInstanceOf(NodeSelection);
		expect(safeImg.classList.contains("easymde-visual-image-selected")).toBe(
			true,
		);
		expect(safeImg.getAttribute("data-easymde-visual-image-selected")).toBe(
			"1",
		);
		expect(safeImg.style.boxShadow).toContain("rgba(34, 113, 177, 0.28)");

		// Updating scale via setNodeAttribute while selected preserves NodeSelection and blue ring.
		const selectedPos = view.state.selection.from;
		view.dispatch(view.state.tr.setNodeAttribute(selectedPos, "scale", 100));
		expect(safeImg.getAttribute("data-easymde-image-scale")).toBe("100");
		expect(safeImg.style.width).toBe("100%");
		expect(safeImg.classList.contains("easymde-visual-image-selected")).toBe(
			true,
		);

		// Moving selection away calls deselectNode() and removes selection feedback.
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)),
		);
		expect(safeImg.classList.contains("easymde-visual-image-selected")).toBe(
			false,
		);
		expect(
			safeImg.getAttribute("data-easymde-visual-image-selected"),
		).toBeNull();
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

		const view = mountVisualEditor(
			"$$\nE = mc^2\n$$\n\nInline $a^2 + b^2 = c^2$ text.",
		);
		const mathBlock = view.dom.querySelector(
			'div[data-easymde-protected-block][data-easymde-protected-kind="math"]',
		);
		const mathInline = view.dom.querySelector(
			'span[data-easymde-protected-inline][data-easymde-protected-kind="math-inline"]',
		);
		const mathBlockPreview = mathBlock?.querySelector(".easymde-math");
		const mathInlinePreview = mathInline?.querySelector(".easymde-math");

		expect(mathBlock?.getAttribute("contenteditable")).toBe("false");
		expect(mathBlock?.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"$$\nE = mc^2\n$$",
		);
		expect(mathBlock?.querySelector(".katex")?.textContent).toBe("E = mc^2");
		expect(mathInline?.querySelector(".katex")?.textContent).toBe(
			"a^2 + b^2 = c^2",
		);
		expect(
			mathBlockPreview?.getAttribute("data-easymde-visual-markdown-source"),
		).toBe("$$\nE = mc^2\n$$");
		expect(mathBlockPreview?.querySelector(":scope > .katex")).not.toBeNull();
		expect(mathInlinePreview?.querySelector(":scope > .katex")).not.toBeNull();

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
		const fallbackBlock = fallbackView.dom.querySelector(
			"div.easymde-math-block",
		);
		expect(
			fallbackBlock?.querySelector("code.easymde-protected-fallback")
				?.textContent,
		).toBe("\\[\nx + y\n\\]");
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
		expect(svg?.querySelector("foreignObject span")?.textContent).toBe(
			"Safe Label",
		);
		expect(svg?.textContent).toContain("Current Diagram");

		// Now resolve stale firstRender: it must NOT overwrite the current diagram!
		firstRender.resolve({
			svg: "<svg><text>Stale Diagram</text></svg>",
		});
		await flushMicrotasks();
		expect(mermaidEl?.querySelector("svg")?.textContent).toContain(
			"Current Diagram",
		);
		expect(mermaidEl?.querySelector("svg")?.textContent).not.toContain(
			"Stale Diagram",
		);

		// Verify destroy cancellation guard prevents late async mutation.
		const destroyDeferred = createDeferred<MermaidRenderResult>();
		win.mermaid = { render: vi.fn(() => destroyDeferred.promise) };
		const doomedView = mountVisualEditor(
			"```mermaid\ngraph TD\n  P --> Q\n```",
		);
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
		expect(
			anchor?.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
		).toBeNull();
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
		const footnotes = view.dom.querySelector(
			'[data-easymde-protected-kind="footnotes"]',
		);
		const rawBlock = view.dom.querySelector(
			'[data-easymde-protected-kind="raw"]',
		);
		const footnoteRef = view.dom.querySelector(
			'[data-easymde-protected-kind="footnote-ref"]',
		);
		const rawInline = view.dom.querySelector(
			'[data-easymde-protected-kind="raw-inline"]',
		);

		expect(toc?.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"[TOC]",
		);
		expect(footnotes?.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"[^1]: Footnote body",
		);
		expect(rawBlock?.querySelector("script")).toBeNull();
		expect(rawBlock?.textContent).toContain("<script>alert(1)</script>");
		expect(
			footnoteRef?.getAttribute("data-easymde-visual-markdown-source"),
		).toBe("[^1]");
		expect(rawInline?.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"<!-- note -->",
		);
	});

	it("supports double-click raw-source editing with Enter/Save commit, Undo, and Escape zero-mutation cancel", () => {
		const view = mountVisualEditor("$$\nE = mc^2\n$$\n\nInline $x + 1$ end.");

		// Block protected card: double-click -> Escape cancels with zero doc change.
		const mathBlock = view.dom.querySelector(
			'div[data-easymde-protected-block][data-easymde-protected-kind="math"]',
		) as HTMLElement;
		mathBlock.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		const textarea = mathBlock.querySelector(
			"textarea.easymde-protected-source-input",
		) as HTMLTextAreaElement;
		expect(textarea).not.toBeNull();
		expect(textarea.value).toBe("$$\nE = mc^2\n$$");

		textarea.value = "$$\na^2 + b^2 = c^2\n$$";
		textarea.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(mathBlock.querySelector("textarea")).toBeNull();
		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe(
			"$$\nE = mc^2\n$$",
		);

		// Double-click again -> modify -> Ctrl+Enter commits real ProseMirror transaction.
		mathBlock.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		const textarea2 = mathBlock.querySelector(
			"textarea.easymde-protected-source-input",
		) as HTMLTextAreaElement;
		textarea2.value = "$$\na^2 + b^2 = c^2\n$$";
		textarea2.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);

		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe(
			"$$\na^2 + b^2 = c^2\n$$",
		);
		expect(mathBlock.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"$$\na^2 + b^2 = c^2\n$$",
		);

		// Undo restores the previous rawMarkdown seamlessly.
		expect(undo(view.state, view.dispatch)).toBe(true);
		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe(
			"$$\nE = mc^2\n$$",
		);
		expect(mathBlock.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"$$\nE = mc^2\n$$",
		);

		// Inline protected card: double-click -> edit -> Save button commits.
		const mathInline = view.dom.querySelector(
			'span[data-easymde-protected-inline][data-easymde-protected-kind="math-inline"]',
		) as HTMLElement;
		mathInline.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		const input = mathInline.querySelector(
			"input.easymde-protected-source-input",
		) as HTMLInputElement;
		expect(input).not.toBeNull();
		input.value = "$y = 2x$";
		const saveButton = mathInline.querySelector(
			"button.easymde-protected-save-btn",
		) as HTMLButtonElement;
		saveButton.click();
		expect(serializeVisualDocToMarkdown(view.state.doc)).toContain(
			"Inline $y = 2x$ end.",
		);
	});

	it("does not open raw-source editor when editor is read-only", () => {
		const view = mountVisualEditor("$$\nE = mc^2\n$$", { editable: false });
		const mathBlock = view.dom.querySelector(
			'div[data-easymde-protected-block][data-easymde-protected-kind="math"]',
		) as HTMLElement;
		mathBlock.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		expect(mathBlock.querySelector("textarea")).toBeNull();

		const editButton = mathBlock.querySelector(
			"button.easymde-protected-edit-btn",
		) as HTMLButtonElement | null;
		expect(editButton).not.toBeNull();
		expect(editButton?.disabled).toBe(true);
		editButton?.click();
		expect(mathBlock.querySelector("textarea")).toBeNull();
	});

	it("provides Edit/Copy quick actions on block protected cards with Mod+Enter save and non-propagating Escape", async () => {
		const writeText = vi.fn(async (_text: string) => undefined);
		const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
			navigator,
			"clipboard",
		);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});

		try {
			const view = mountVisualEditor("$$\nE = mc^2\n$$\n\nInline $x + 1$ end.");
			const mathBlock = view.dom.querySelector(
				'div[data-easymde-protected-block][data-easymde-protected-kind="math"]',
			) as HTMLElement;
			const mathInline = view.dom.querySelector(
				'span[data-easymde-protected-inline][data-easymde-protected-kind="math-inline"]',
			) as HTMLElement;

			// Block cards have non-editable actions; inline atoms do not.
			const actionsBar = mathBlock.querySelector(
				"div.easymde-protected-card-actions",
			) as HTMLElement | null;
			expect(actionsBar).not.toBeNull();
			expect(actionsBar?.getAttribute("contenteditable")).toBe("false");
			expect(
				mathInline.querySelector(".easymde-protected-card-actions"),
			).toBeNull();

			// ProseMirror serialization stays untouched by card action chrome.
			expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
				"$$\nE = mc^2\n$$\n\nInline $x + 1$ end.",
			);

			// Copy-raw button copies currentNode.attrs.rawMarkdown and shows visual copied state.
			const copyButton = actionsBar?.querySelector(
				"button.easymde-protected-copy-btn",
			) as HTMLButtonElement;
			expect(copyButton).not.toBeNull();
			copyButton.click();
			await flushMicrotasks();
			expect(writeText).toHaveBeenCalledTimes(1);
			expect(writeText).toHaveBeenCalledWith("$$\nE = mc^2\n$$");
			expect(copyButton.classList.contains("is-copied")).toBe(true);
			expect(copyButton.getAttribute("data-easymde-copied")).toBe("1");

			// Edit button opens raw-source editor and hides action chrome while editing.
			const editButton = actionsBar?.querySelector(
				"button.easymde-protected-edit-btn",
			) as HTMLButtonElement;
			editButton.click();
			expect(actionsBar?.hidden).toBe(true);
			const textarea = mathBlock.querySelector(
				"textarea.easymde-protected-source-input",
			) as HTMLTextAreaElement;
			expect(textarea).not.toBeNull();

			// Escape cancels without propagating to outer view/document listeners.
			const outerEscapeSpy = vi.fn();
			document.addEventListener("keydown", outerEscapeSpy);
			try {
				textarea.value = "$$\nunsaved\n$$";
				const escapeEvent = new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				});
				textarea.dispatchEvent(escapeEvent);
				expect(escapeEvent.defaultPrevented).toBe(true);
				expect(outerEscapeSpy).not.toHaveBeenCalled();
				expect(mathBlock.querySelector("textarea")).toBeNull();
				expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe(
					"$$\nE = mc^2\n$$",
				);

				// Ctrl+Enter saves immediately; Shift+Enter stays in editor.
				editButton.click();
				const textarea2 = mathBlock.querySelector(
					"textarea.easymde-protected-source-input",
				) as HTMLTextAreaElement;
				const shiftEnterEvent = new KeyboardEvent("keydown", {
					key: "Enter",
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				});
				textarea2.dispatchEvent(shiftEnterEvent);
				expect(shiftEnterEvent.defaultPrevented).toBe(false);
				expect(mathBlock.querySelector("textarea")).not.toBeNull();

				textarea2.value = "$$\na^2 + b^2 = c^2\n$$";
				const ctrlEnterEvent = new KeyboardEvent("keydown", {
					key: "Enter",
					ctrlKey: true,
					bubbles: true,
					cancelable: true,
				});
				textarea2.dispatchEvent(ctrlEnterEvent);
				expect(ctrlEnterEvent.defaultPrevented).toBe(true);
				expect(outerEscapeSpy).not.toHaveBeenCalled();
				expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe(
					"$$\na^2 + b^2 = c^2\n$$",
				);

				// Cmd+Enter (metaKey) also saves immediately.
				editButton.click();
				const textarea3 = mathBlock.querySelector(
					"textarea.easymde-protected-source-input",
				) as HTMLTextAreaElement;
				textarea3.value = "$$\nF = ma\n$$";
				textarea3.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: "Enter",
						metaKey: true,
						bubbles: true,
						cancelable: true,
					}),
				);
				expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe(
					"$$\nF = ma\n$$",
				);
			} finally {
				document.removeEventListener("keydown", outerEscapeSpy);
			}

			// Copy after edit copies the updated rawMarkdown.
			writeText.mockClear();
			copyButton.click();
			await flushMicrotasks();
			expect(writeText).toHaveBeenCalledWith("$$\nF = ma\n$$");

			// Graceful no-throw behavior when clipboard is unavailable.
			Object.defineProperty(navigator, "clipboard", {
				configurable: true,
				value: undefined,
			});
			const viewWithoutClipboard = mountVisualEditor("[TOC]");
			const tocCopyBtn = viewWithoutClipboard.dom.querySelector(
				"button.easymde-protected-copy-btn",
			) as HTMLButtonElement;
			expect(() => tocCopyBtn.click()).not.toThrow();
			await flushMicrotasks();
			expect(tocCopyBtn.classList.contains("is-copied")).toBe(false);
		} finally {
			if (originalClipboardDescriptor) {
				Object.defineProperty(
					navigator,
					"clipboard",
					originalClipboardDescriptor,
				);
			} else {
				delete (navigator as unknown as Record<string, unknown>).clipboard;
			}
		}
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
		const firstContent = firstItem.querySelector(
			"div.easymde-task-item-content",
		);

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
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
			"- [ ] Locked task",
		);
	});
});

describe("TableContainerNodeView", () => {
	it("wraps table in .easymde-table-container and supports prosemirror-tables operations and colgroup widths", () => {
		const markdown = [
			'<!-- easymde-table-align:v1 [[1,"center"]] -->',
			"| Left | Right |",
			"| :--- | ---: |",
			"| A | B |",
		].join("\n");

		const view = mountVisualEditor(markdown, { withColumnResizing: true });
		const section = view.dom.querySelector(
			"section.table-container.easymde-table-container",
		);
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
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)),
		);
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
		const firstCol = colgroup?.querySelector(
			"col",
		) as HTMLTableColElement | null;
		expect(firstCol?.style.width).toBe("180px");
	});
});

function openProtectedBlockCard(
	view: EditorView,
	kind: string,
): Readonly<{ root: HTMLElement; textarea: HTMLTextAreaElement }> {
	const root = view.dom.querySelector(
		`div[data-easymde-protected-block][data-easymde-protected-kind="${kind}"]`,
	) as HTMLElement | null;
	expect(root).not.toBeNull();
	const element = root as HTMLElement;
	element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
	const textarea = element.querySelector(
		"textarea.easymde-protected-source-input",
	) as HTMLTextAreaElement | null;
	expect(textarea).not.toBeNull();
	return { root: element, textarea: textarea as HTMLTextAreaElement };
}

describe("ProtectedAtomNodeView commit boundaries and IME isolation", () => {
	it("keeps plain Enter as a newline in block cards and commits on Mod+Enter with discrete undo boundaries", () => {
		const transactions: Transaction[] = [];
		const view = mountVisualEditor("$$\nE = mc^2\n$$", {
			onTransaction: (transaction) => transactions.push(transaction),
		});
		const { textarea } = openProtectedBlockCard(view, "math");

		textarea.value = "$$\nline 1\nline 2\n$$";
		const plainEnter = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		textarea.dispatchEvent(plainEnter);
		expect(plainEnter.defaultPrevented).toBe(false);
		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe(
			"$$\nE = mc^2\n$$",
		);
		expect(textarea.isConnected).toBe(true);

		const depthBefore = undoDepth(view.state);
		const ctrlEnter = new KeyboardEvent("keydown", {
			key: "Enter",
			ctrlKey: true,
			bubbles: true,
			cancelable: true,
		});
		textarea.dispatchEvent(ctrlEnter);
		expect(ctrlEnter.defaultPrevented).toBe(true);
		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe(
			"$$\nline 1\nline 2\n$$",
		);
		expect(
			transactions.some(
				(transaction) =>
					transaction.getMeta(PROTECTED_CARD_COMMIT_META) === true,
			),
		).toBe(true);
		const depthAfterFirst = undoDepth(view.state);
		expect(depthAfterFirst).toBeGreaterThan(depthBefore);

		// A second rapid commit must remain its own undo step (closeHistory).
		const editButton = view.dom.querySelector(
			"button.easymde-protected-edit-btn",
		) as HTMLButtonElement;
		editButton.click();
		const textarea2 = view.dom.querySelector(
			"textarea.easymde-protected-source-input",
		) as HTMLTextAreaElement;
		textarea2.value = "$$\nthird line\n$$";
		textarea2.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				metaKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe(
			"$$\nthird line\n$$",
		);
		expect(undoDepth(view.state)).toBeGreaterThan(depthAfterFirst);
		expect(undo(view.state, view.dispatch)).toBe(true);
		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe(
			"$$\nline 1\nline 2\n$$",
		);
	});

	it("deletes block and inline atoms on an empty commit instead of leaving ghost cards", () => {
		const blockTransactions: Transaction[] = [];
		const blockView = mountVisualEditor("$$\nE = mc^2\n$$", {
			onTransaction: (transaction) => blockTransactions.push(transaction),
		});
		const { textarea } = openProtectedBlockCard(blockView, "math");
		textarea.value = "   \n  ";
		textarea.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(
			blockTransactions.some(
				(transaction) =>
					transaction.getMeta(PROTECTED_CARD_COMMIT_META) === true,
			),
		).toBe(true);
		expect(
			blockView.dom.querySelector('[data-easymde-protected-kind="math"]'),
		).toBeNull();
		expect(blockView.state.doc.childCount).toBe(1);
		expect(blockView.state.doc.firstChild?.type.name).toBe("paragraph");

		const inlineView = mountVisualEditor("Text $x$ end.");
		const inlineRoot = inlineView.dom.querySelector(
			'span[data-easymde-protected-inline][data-easymde-protected-kind="math-inline"]',
		) as HTMLElement;
		inlineRoot.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		const input = inlineRoot.querySelector(
			"input.easymde-protected-source-input",
		) as HTMLInputElement;
		input.value = " ";
		input.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Enter",
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(
			inlineView.dom.querySelector("[data-easymde-protected-inline]"),
		).toBeNull();
		expect(serializeVisualDocToMarkdown(inlineView.state.doc)).toBe(
			"Text  end.",
		);
	});

	it("stops card composition events at the card boundary and defers Save until compositionend", () => {
		const view = mountVisualEditor("$$\nE = mc^2\n$$");
		const outerCompositionStart = vi.fn();
		const outerCompositionEnd = vi.fn();
		view.dom.addEventListener(
			"compositionstart",
			outerCompositionStart as EventListener,
		);
		view.dom.addEventListener(
			"compositionend",
			outerCompositionEnd as EventListener,
		);
		const { root, textarea } = openProtectedBlockCard(view, "math");

		textarea.dispatchEvent(
			new CompositionEvent("compositionstart", { bubbles: true }),
		);
		expect(outerCompositionStart).not.toHaveBeenCalled();

		textarea.value = "$$\n中文\n$$";
		const saveButton = root.querySelector(
			"button.easymde-protected-save-btn",
		) as HTMLButtonElement;
		saveButton.click();
		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe(
			"$$\nE = mc^2\n$$",
		);
		expect(textarea.isConnected).toBe(true);

		textarea.dispatchEvent(
			new CompositionEvent("compositionend", { bubbles: true }),
		);
		expect(outerCompositionEnd).not.toHaveBeenCalled();
		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe("$$\n中文\n$$");

		view.dom.removeEventListener(
			"compositionstart",
			outerCompositionStart as EventListener,
		);
		view.dom.removeEventListener(
			"compositionend",
			outerCompositionEnd as EventListener,
		);

		// Cancel discards the local draft without mutating the document.
		const editButton = view.dom.querySelector(
			"button.easymde-protected-edit-btn",
		) as HTMLButtonElement;
		editButton.click();
		const textarea2 = view.dom.querySelector(
			"textarea.easymde-protected-source-input",
		) as HTMLTextAreaElement;
		textarea2.value = "$$\ndiscarded\n$$";
		(
			view.dom.querySelector(
				"button.easymde-protected-cancel-btn",
			) as HTMLButtonElement
		).click();
		expect(view.state.doc.firstChild?.attrs.rawMarkdown).toBe("$$\n中文\n$$");
	});

	it("uses injected localized labels and aria templates", () => {
		const view = mountVisualEditor("$$\nE = mc^2\n$$", {
			nodeViewsOptions: {
				protectedAtom: {
					labels: {
						cancel: "Abbrechen",
						copy: "Kopieren",
						edit: "Bearbeiten",
						math: "Formel",
						save: "Speichern",
					},
					labelTemplates: {
						copy: "{kind} kopieren",
						edit: "{kind} bearbeiten",
						source: "{kind}-Quelltext",
					},
				},
			},
		});
		const editButton = view.dom.querySelector(
			"button.easymde-protected-edit-btn",
		) as HTMLButtonElement;
		expect(editButton.getAttribute("aria-label")).toBe("Formel bearbeiten");
		expect(editButton.textContent).toBe("Bearbeiten");
		editButton.click();
		const textarea = view.dom.querySelector(
			"textarea.easymde-protected-source-input",
		) as HTMLTextAreaElement;
		expect(textarea.getAttribute("aria-label")).toBe("Formel-Quelltext");
		expect(
			(
				view.dom.querySelector(
					"button.easymde-protected-save-btn",
				) as HTMLButtonElement
			).textContent,
		).toBe("Speichern");
	});
});

describe("ProtectedAtomNodeView generated-content DOM and runtime parity", () => {
	it("exposes direct .katex children for MathML parity while keeping PNG clones free of card chrome", () => {
		const katexRender = vi.fn(
			(
				tex: string,
				target: HTMLElement,
				options: Readonly<{ displayMode: boolean }>,
			) => {
				const doc = target.ownerDocument;
				const katex = doc.createElement("span");
				katex.className = "katex";
				const mathml = doc.createElement("span");
				mathml.className = "katex-mathml";
				const math = doc.createElementNS(
					"http://www.w3.org/1998/Math/MathML",
					"math",
				);
				math.textContent = tex;
				mathml.appendChild(math);
				katex.appendChild(mathml);
				if (options.displayMode) {
					const display = doc.createElement("span");
					display.className = "katex-display";
					display.appendChild(katex);
					target.replaceChildren(display);
					return;
				}
				target.replaceChildren(katex);
			},
		);
		const win = window as TestEnhancementWindow;
		win.katex = { render: katexRender };

		const view = mountVisualEditor("$$\nE = mc^2\n$$\n\nInline $a + b$ end.");
		expect(view.dom.querySelectorAll(".easymde-math")).toHaveLength(2);

		const blockMath = view.dom.querySelector(
			'div[data-easymde-protected-block][data-easymde-protected-kind="math"] .easymde-math',
		) as HTMLElement;
		expect(blockMath).not.toBeNull();
		expect(
			blockMath.querySelector(
				":scope > .katex, :scope > .katex-display > .katex",
			),
		).not.toBeNull();
		const mathMl = blockMath.querySelector(
			":scope > .katex, :scope > .katex-display > .katex",
		);
		expect(
			mathMl?.querySelector(":scope > .katex-mathml > math"),
		).not.toBeNull();
		expect(blockMath.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"$$\nE = mc^2\n$$",
		);

		const inlineMath = view.dom.querySelector(
			'span[data-easymde-protected-inline][data-easymde-protected-kind="math-inline"] .easymde-math',
		) as HTMLElement;
		expect(inlineMath.querySelector(":scope > .katex")).not.toBeNull();

		for (const root of [blockMath, inlineMath]) {
			expect(
				root.querySelectorAll(".easymde-protected-card-actions"),
			).toHaveLength(0);
			const clone = root.cloneNode(true) as HTMLElement;
			expect(
				clone.querySelectorAll(
					".easymde-protected-card-actions, .easymde-protected-edit-btn, .easymde-protected-copy-btn",
				),
			).toHaveLength(0);
			expect(clone.querySelectorAll("button")).toHaveLength(0);
			expect(clone.querySelectorAll(".katex").length).toBeGreaterThan(0);
		}

		const actions = view.dom.querySelector(
			"div.easymde-protected-card-actions",
		) as HTMLElement;
		expect(actions.getAttribute("data-easymde-protected-ui")).toBe("1");
		expect(actions.getAttribute("aria-hidden")).toBe("false");
		expect(blockMath.contains(actions)).toBe(false);
	});

	it("re-renders mounted atoms when readiness is announced on the window", () => {
		const view = mountVisualEditor("$$\ny = 1\n$$");
		expect(view.dom.querySelector(".easymde-math .katex")).toBeNull();
		const render = vi.fn((tex: string, target: HTMLElement) => {
			const span = target.ownerDocument.createElement("span");
			span.className = "katex";
			span.textContent = tex;
			target.replaceChildren(span);
		});
		const win = window as TestEnhancementWindow;
		win.katex = { render };
		window.dispatchEvent(new Event(PREVIEW_RUNTIME_READY_EVENT));
		expect(render).toHaveBeenCalledTimes(1);
		expect(view.dom.querySelector(".easymde-math .katex")?.textContent).toBe(
			"y = 1",
		);
	});

	it("mirrors the shared Mermaid initialization and re-renders atoms when the runtime becomes ready", async () => {
		const initialize = vi.fn();
		const render = vi.fn(async () => ({
			svg: '<svg viewBox="0 0 10 10"><text>Diagram</text></svg>',
		}));
		const win = window as TestEnhancementWindow;
		win.mermaid = { initialize, render };

		const view = mountVisualEditor(
			"```mermaid\ngraph TD\n  A --> B\n```\n\n```mermaid\ngraph LR\n  X --> Y\n```",
		);
		await flushMicrotasks();
		expect(initialize).toHaveBeenCalledTimes(1);
		const config = initialize.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(config.startOnLoad).toBe(false);
		expect(config.securityLevel).toBe("strict");
		expect(config.flowchart).toEqual({ diagramPadding: 12 });
		expect(String(config.themeCSS)).toContain(
			'font-family: "trebuchet ms", verdana, arial, sans-serif !important',
		);
		expect(render).toHaveBeenCalledTimes(2);
		expect(
			view.dom.querySelector(".easymde-mermaid svg")?.textContent,
		).toContain("Diagram");

		// Late runtime availability re-renders already mounted atoms without reload.
		delete win.mermaid;
		const lateView = mountVisualEditor(
			"$$\nE = mc^2\n$$\n\n```mermaid\ngraph TD\n  P --> Q\n```",
		);
		expect(lateView.dom.querySelector(".easymde-math .katex")).toBeNull();
		const lateKatex = vi.fn((tex: string, target: HTMLElement) => {
			const span = target.ownerDocument.createElement("span");
			span.className = "katex";
			span.textContent = tex;
			target.replaceChildren(span);
		});
		const lateRender = vi.fn(async () => ({
			svg: '<svg viewBox="0 0 10 10"><text>Late</text></svg>',
		}));
		win.katex = { render: lateKatex };
		win.mermaid = { initialize: vi.fn(), render: lateRender };
		// Bubbling document events also reach the window listener: render once.
		document.dispatchEvent(
			new Event(PREVIEW_RUNTIME_READY_EVENT, { bubbles: true }),
		);
		await flushMicrotasks();
		expect(lateKatex).toHaveBeenCalledTimes(1);
		expect(
			lateView.dom.querySelector(".easymde-math .katex")?.textContent,
		).toBe("E = mc^2");
		expect(lateRender).toHaveBeenCalledTimes(1);
		expect(
			lateView.dom.querySelector(".easymde-mermaid svg")?.textContent,
		).toContain("Late");
	});
});

describe("Reactive editable state and localized task labels", () => {
	it("keeps task checkboxes and card edit buttons disabled in sync with view.editable", () => {
		const view = mountVisualEditor("- [ ] Task\n\n$$\nE = mc^2\n$$");
		const checkbox = view.dom.querySelector(
			"input.task-list-item-checkbox",
		) as HTMLInputElement;
		const editButton = view.dom.querySelector(
			"button.easymde-protected-edit-btn",
		) as HTMLButtonElement;
		expect(checkbox.disabled).toBe(false);
		expect(editButton.disabled).toBe(false);

		view.setProps({ editable: () => false });
		expect(checkbox.disabled).toBe(true);
		expect(editButton.disabled).toBe(true);

		view.setProps({ editable: () => true });
		expect(checkbox.disabled).toBe(false);
		expect(editButton.disabled).toBe(false);
	});

	it("applies a localized task checkbox aria-label", () => {
		const view = mountVisualEditor("- [ ] Aufgabe", {
			nodeViewsOptions: {
				taskItem: { checkboxAriaLabel: "Aufgabe umschalten" },
			},
		});
		const checkbox = view.dom.querySelector(
			"input.task-list-item-checkbox",
		) as HTMLInputElement;
		expect(checkbox.getAttribute("aria-label")).toBe("Aufgabe umschalten");
	});
});

describe("code highlight caching and runtime-ready refresh", () => {
	it("caches token spans and skips hljs/DOMParser work for unrelated paragraph edits", () => {
		const highlight = vi.fn((code: string) => ({
			value: code.replace(
				/\bconst\b/g,
				'<span class="hljs-keyword">const</span>',
			),
		}));
		const win = window as TestEnhancementWindow;
		win.hljs = {
			getLanguage: () => ({}),
			highlight,
		};
		const parseSpy = vi.spyOn(DOMParser.prototype, "parseFromString");

		const view = mountVisualEditor(
			"Paragraph\n\n```ts\nconst a = 1;\n```\n\n```ts\nconst a = 1;\n```",
		);
		// Identical language + text hits the bounded token-range cache.
		expect(highlight).toHaveBeenCalledTimes(1);
		const parseCallsAfterMount = parseSpy.mock.calls.length;

		highlight.mockClear();
		parseSpy.mockClear();
		view.dispatch(view.state.tr.insertText("x", 1));
		expect(highlight).not.toHaveBeenCalled();
		expect(parseSpy).not.toHaveBeenCalled();

		// Editing one code block re-highlights only that block.
		let secondBlockPos = 0;
		view.state.doc.descendants((node, pos) => {
			if (node.type.name === "code_block" && pos > 0) {
				if (secondBlockPos === 0) secondBlockPos = pos;
			}
			return true;
		});
		expect(secondBlockPos).toBeGreaterThan(0);
		view.dispatch(view.state.tr.insertText(" ", secondBlockPos + 1));
		expect(highlight).toHaveBeenCalledTimes(1);
		expect(parseSpy.mock.calls.length).toBeGreaterThan(0);
		expect(parseCallsAfterMount).toBeGreaterThan(0);
	});

	it("auto-detects language-free code blocks and renders clean unhighlighted fallbacks", () => {
		const highlightAuto = vi.fn((code: string) => ({
			language: "javascript",
			value: `<span class="hljs-keyword">${code}</span>`,
		}));
		const win = window as TestEnhancementWindow;
		win.hljs = { highlightAuto };

		const view = mountVisualEditor("```\nconst x = 1;\n```");
		expect(highlightAuto).toHaveBeenCalledTimes(1);
		expect(view.dom.querySelector("code.hljs .hljs-keyword")).not.toBeNull();
		expect(
			view.dom.querySelector("pre")?.getAttribute("data-language"),
		).toBeNull();

		// Runtime without auto-detection degrades to clean, unhighlighted output.
		win.hljs = { highlight: vi.fn(() => ({ value: "" })) };
		const plainView = mountVisualEditor("```\nplain text\n```");
		expect(
			codeHighlightPluginKey.getState(plainView.state)?.decorations.find()
				.length,
		).toBe(0);
		expect(plainView.dom.querySelector("pre code")?.textContent).toBe(
			"plain text",
		);
	});

	it("refreshes mounted code blocks once when the highlight runtime becomes ready", () => {
		const view = mountVisualEditor("```ts\nconst x = 1;\n```");
		expect(
			codeHighlightPluginKey.getState(view.state)?.decorations.find().length,
		).toBe(0);

		const highlight = vi.fn(() => ({
			value: '<span class="hljs-keyword">const</span> x = 1;',
		}));
		const win = window as TestEnhancementWindow;
		win.hljs = { getLanguage: () => ({}), highlight };
		document.dispatchEvent(new Event(PREVIEW_RUNTIME_READY_EVENT));
		expect(highlight).toHaveBeenCalledTimes(1);
		expect(
			codeHighlightPluginKey.getState(view.state)?.decorations.find().length,
		).toBeGreaterThan(0);
		expect(view.dom.querySelector("code.hljs .hljs-keyword")?.textContent).toBe(
			"const",
		);
	});
});
