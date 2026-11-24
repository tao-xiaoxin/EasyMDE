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
import type {
	VisualGeneratedRuntimePort,
	VisualRuntimeFeature,
	VisualRuntimeState,
} from "../../../contracts/visual-editor";
import {
	parseMarkdownToVisualDoc,
	prescanMarkdown,
} from "../markdown-parser";
import { serializeVisualDocToMarkdown } from "../markdown-serializer";
import { visualEditorSchema } from "../visual-schema";
import { stripCommonMarkHtmlForPreview } from "./protected-atom-preview-renderer";
import {
	codeHighlightPluginKey,
	createCodeHighlightPlugin,
	createVisualNodeViews,
	type HighlightJsRuntime,
	type KatexRuntime,
	type MermaidRenderResult,
	type MermaidRuntime,
	PROTECTED_CARD_COMMIT_META,
	sanitizeMermaidSvg,
	TableContainerNodeView,
	type VisualNodeViewsOptions,
} from "./index";

type TestEnhancementWindow = Window & {
	EasyMDEMermaidRenderer?: Readonly<{
		readCachedSvg?: (source: string, renderId: string) => string | null;
	}>;
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
		const runtimePort = options.nodeViewsOptions?.protectedAtom?.runtimePort;
		plugins.push(
			createCodeHighlightPlugin(
				runtimePort !== undefined ? { runtimePort } : {},
			),
		);
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
	document.documentElement.removeAttribute("data-easymde-visual-math-ready");
	document.documentElement.removeAttribute(
		"data-easymde-visual-math-unavailable",
	);
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
		document.documentElement.setAttribute(
			"data-easymde-visual-math-ready",
			"1",
		);

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

	it("renders toc, footnotes, raw, footnote-ref, and raw-inline cards safely in preview style without HTML injection", () => {
		const markdown = [
			"## Section Alpha",
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
		expect(
			toc?.querySelector(".easymde-toc ul li.easymde-toc-level-2 a")
				?.textContent,
		).toBe("Section Alpha");
		expect(footnotes?.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"[^1]: Footnote body",
		);
		expect(
			footnotes?.querySelector(".easymde-protected-meta-chip")?.textContent,
		).toContain("^1");
		expect(rawBlock?.querySelector("script")).toBeNull();
		expect(rawBlock?.getAttribute("data-easymde-visual-markdown-source")).toBe(
			'<div class="custom"><script>alert(1)</script></div>',
		);
		expect(
			rawBlock?.querySelector(".easymde-protected-meta-chip")?.textContent,
		).toBe("Raw <div>");
		expect(
			footnoteRef?.getAttribute("data-easymde-visual-markdown-source"),
		).toBe("[^1]");
		expect(
			footnoteRef?.querySelector(".easymde-footnote-ref-link")?.textContent,
		).toBe("^1");
		expect(rawInline?.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"<!-- note -->",
		);
		expect(
			rawInline?.querySelector(".easymde-protected-inline-hidden"),
		).not.toBeNull();
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

	it("provides only an Edit quick action on block protected cards with Mod+Enter save and non-propagating Escape", () => {
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

		// Only the Edit action is rendered; there is no Copy action.
		expect(
			actionsBar?.querySelector("button.easymde-protected-copy-btn"),
		).toBeNull();
		expect(actionsBar?.querySelectorAll("button")).toHaveLength(1);

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

		// Action bar is visible again after saving.
		expect(actionsBar?.hidden).toBe(false);
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
			"$$\nF = ma\n$$\n\nInline $x + 1$ end.",
		);
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
						edit: "Bearbeiten",
						math: "Formel",
						save: "Speichern",
					},
					labelTemplates: {
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
		document.documentElement.setAttribute(
			"data-easymde-visual-math-ready",
			"1",
		);

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

	it("re-renders mounted atoms when the visual runtime port announces readiness", () => {
		let mathState: VisualRuntimeState = "idle";
		const listeners = new Set<() => void>();
		const runtimePort: VisualGeneratedRuntimePort = {
			getState: (feature) => (feature === "math" ? mathState : "ready"),
			request: (feature) => (feature === "math" ? mathState : "ready"),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
		const view = mountVisualEditor("$$\ny = 1\n$$", {
			nodeViewsOptions: { protectedAtom: { runtimePort } },
		});
		expect(view.dom.querySelector(".easymde-math .katex")).toBeNull();
		const render = vi.fn((tex: string, target: HTMLElement) => {
			const span = target.ownerDocument.createElement("span");
			span.className = "katex";
			span.textContent = tex;
			target.replaceChildren(span);
		});
		const win = window as TestEnhancementWindow;
		win.katex = { render };
		mathState = "ready";
		for (const listener of Array.from(listeners)) listener();
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
		const lateStates: Record<VisualRuntimeFeature, VisualRuntimeState> = {
			math: "loading",
			mermaid: "loading",
			toc: "ready",
		};
		const lateListeners = new Set<() => void>();
		const latePort: VisualGeneratedRuntimePort = {
			getState: (feature) => lateStates[feature],
			request: (feature) => lateStates[feature],
			subscribe: (listener) => {
				lateListeners.add(listener);
				return () => lateListeners.delete(listener);
			},
		};
		const lateView = mountVisualEditor(
			"$$\nE = mc^2\n$$\n\n```mermaid\ngraph TD\n  P --> Q\n```",
			{ nodeViewsOptions: { protectedAtom: { runtimePort: latePort } } },
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
		lateStates.math = "ready";
		lateStates.mermaid = "ready";
		for (const listener of Array.from(lateListeners)) listener();
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

	it("refreshes mounted code blocks once when the highlight runtime becomes ready via runtimePort", () => {
		const listeners = new Set<() => void>();
		const runtimePort: VisualGeneratedRuntimePort = {
			getState: () => "ready",
			request: () => "ready",
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
		const view = mountVisualEditor("```ts\nconst x = 1;\n```", {
			nodeViewsOptions: { protectedAtom: { runtimePort } },
		});
		expect(
			codeHighlightPluginKey.getState(view.state)?.decorations.find().length,
		).toBe(0);

		const highlight = vi.fn(() => ({
			value: '<span class="hljs-keyword">const</span> x = 1;',
		}));
		const win = window as TestEnhancementWindow;
		win.hljs = { getLanguage: () => ({}), highlight };
		for (const listener of Array.from(listeners)) listener();
		expect(highlight).toHaveBeenCalledTimes(1);
		expect(
			codeHighlightPluginKey.getState(view.state)?.decorations.find().length,
		).toBeGreaterThan(0);
		expect(view.dom.querySelector("code.hljs .hljs-keyword")?.textContent).toBe(
			"const",
		);
	});
});

describe("Visual NodeView rendering fidelity regressions", () => {
	it("scopes descendant Mermaid SVG IDs and their references while keeping root id and hex colors", () => {
		const svgMarkup = [
			'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" id="root-svg" aria-labelledby="chart-title">',
			'<title id="chart-title">Diagram</title>',
			"<style>#root-svg .line{stroke:#333333;fill:url(#grad1);}</style>",
			'<defs><marker id="arrowhead"><path d="M0,0" fill="#ffffff"/></marker>',
			'<marker id="ONLY_ONE_START"><path d="M0,0"/></marker>',
			'<marker id="ZERO_OR_MORE_END"><path d="M0,0"/></marker>',
			'<linearGradient id="grad1"><stop offset="0" stop-color="#333333"/></linearGradient>',
			'<clipPath id="clip1"><rect width="1" height="1"/></clipPath>',
			'<marker id="scope-1_flowchart-pointEnd"><path d="M0,0"/></marker></defs>',
			'<line marker-end="url(#arrowhead)" stroke="#333333"/>',
			'<path marker-start="url(\'#ONLY_ONE_START\')" marker-end=\'url("#ZERO_OR_MORE_END")\' clip-path="url(#clip1)" fill="url(#grad1)"/>',
			'<path marker-end="url(#scope-1_flowchart-pointEnd)" style="fill:url(#grad1);stroke:#ffffff"/>',
			'<use xlink:href="#arrowhead"/><use href="#clip1"/>',
			"</svg>",
		].join("");
		const sanitized = sanitizeMermaidSvg(svgMarkup, document, "scope-1");
		expect(sanitized).not.toBeNull();
		if (!sanitized) return;
		expect(sanitized.getAttribute("id")).toBe("root-svg");
		expect(sanitized.getAttribute("aria-labelledby")).toBe(
			"scope-1__chart-title",
		);
		for (const id of [
			"arrowhead",
			"ONLY_ONE_START",
			"ZERO_OR_MORE_END",
			"grad1",
			"clip1",
		]) {
			expect(sanitized.querySelector(`[id="${id}"]`)).toBeNull();
			expect(sanitized.querySelector(`[id="scope-1__${id}"]`)).not.toBeNull();
		}
		// Already-prefixed IDs are left alone.
		expect(
			sanitized.querySelector('[id="scope-1_flowchart-pointEnd"]'),
		).not.toBeNull();

		const line = sanitized.querySelector("line");
		expect(line?.getAttribute("marker-end")).toBe("url(#scope-1__arrowhead)");
		expect(line?.getAttribute("stroke")).toBe("#333333");
		const paths = sanitized.querySelectorAll(":scope > path");
		expect(paths[0]?.getAttribute("marker-start")).toBe(
			"url('#scope-1__ONLY_ONE_START')",
		);
		expect(paths[0]?.getAttribute("marker-end")).toBe(
			'url("#scope-1__ZERO_OR_MORE_END")',
		);
		expect(paths[0]?.getAttribute("clip-path")).toBe("url(#scope-1__clip1)");
		expect(paths[0]?.getAttribute("fill")).toBe("url(#scope-1__grad1)");
		expect(paths[1]?.getAttribute("marker-end")).toBe(
			"url(#scope-1_flowchart-pointEnd)",
		);
		expect(paths[1]?.getAttribute("style")).toBe(
			"fill:url(#scope-1__grad1);stroke:#ffffff",
		);
		const uses = sanitized.querySelectorAll("use");
		expect(
			uses[0]?.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
		).toBe("#scope-1__arrowhead");
		expect(uses[1]?.getAttribute("href")).toBe("#scope-1__clip1");
		const style = sanitized.querySelector("style")?.textContent ?? "";
		expect(style).toContain("#root-svg .line");
		expect(style).toContain("stroke:#333333");
		expect(style).toContain("url(#scope-1__grad1)");
		expect(sanitized.querySelector("marker path")?.getAttribute("fill")).toBe(
			"#ffffff",
		);

		// Without an explicit prefix the root <svg id> becomes the scope.
		const fallback = sanitizeMermaidSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" id="m1"><defs><marker id="arrowhead"/></defs><line marker-end="url(#arrowhead)"/></svg>',
			document,
		);
		expect(fallback?.getAttribute("id")).toBe("m1");
		expect(fallback?.querySelector("marker")?.getAttribute("id")).toBe(
			"m1__arrowhead",
		);
		expect(fallback?.querySelector("line")?.getAttribute("marker-end")).toBe(
			"url(#m1__arrowhead)",
		);
	});

	it("rewrites Mermaid #id CSS selectors in selector context only, keeping hex colors and strings", () => {
		const svgMarkup = [
			'<svg xmlns="http://www.w3.org/2000/svg" id="m-root">',
			"<style>",
			"#m-root #arrowhead path { fill: #333333; stroke: #333; }",
			"@media (min-width: 1px) { #arrowhead path { fill: #abcdef; } }",
			'#arrowheadx, [data-x="#arrowhead"] { color: #arrowhead; }',
			"/* #arrowhead */ .c { content: '#arrowhead'; }",
			"</style>",
			'<defs><marker id="arrowhead"><path d="M0,0"/></marker>',
			'<marker id="arrowheadx"><path d="M0,0"/></marker></defs>',
			"</svg>",
		].join("");
		const sanitized = sanitizeMermaidSvg(svgMarkup, document, "scope");
		expect(sanitized).not.toBeNull();
		if (!sanitized) return;
		const css = sanitized.querySelector("style")?.textContent ?? "";
		const firstSelector = css.split("{")[0]?.trim() ?? "";
		expect(firstSelector).toBe("#m-root #scope__arrowhead path");
		const marker = sanitized.querySelector('[id="scope__arrowhead"]');
		document.body.appendChild(sanitized);
		try {
			expect(document.querySelector(firstSelector)).toBe(
				marker?.querySelector("path"),
			);
		} finally {
			sanitized.remove();
		}
		expect(css).toContain("fill: #333333; stroke: #333;");
		expect(css).toContain(
			"@media (min-width: 1px) { #scope__arrowhead path { fill: #abcdef; } }",
		);
		// Whole identifiers only; strings, comments, and values stay untouched.
		expect(css).toContain(
			'#scope__arrowheadx, [data-x="#arrowhead"] { color: #arrowhead; }',
		);
		expect(css).toContain("/* #arrowhead */ .c { content: '#arrowhead'; }");
	});

	it("keeps and scopes quoted or uppercase local url() references while stripping external ones", () => {
		const svgMarkup = [
			'<svg xmlns="http://www.w3.org/2000/svg" id="m-root">',
			"<style>",
			".a { fill: URL(#grad1); }",
			".b { fill: url(https://evil.example/x.svg#a); stroke: #333333; }",
			".c { marker-end: Url( '#arrowhead' ); }",
			"</style>",
			'<defs><marker id="arrowhead"><path d="M0,0"/></marker>',
			'<linearGradient id="grad1"><stop offset="0"/></linearGradient></defs>',
			"<path id=\"p1\" style=\"marker-end: url('#arrowhead'); fill: url(&quot;#grad1&quot;)\"/>",
			'<path id="p2" fill="URL(#grad1)" stroke="url(https://evil.example/x.svg#a)"/>',
			'<path id="p3" style="fill: url(https://evil.example/x.svg#a); stroke: #ffffff"/>',
			'<path id="p4" style="fill: url(//evil.example/a#b); stroke: url(data:image/svg+xml;base64,AA==)"/>',
			"</svg>",
		].join("");
		const sanitized = sanitizeMermaidSvg(svgMarkup, document, "scope");
		expect(sanitized).not.toBeNull();
		if (!sanitized) return;
		const byId = (id: string) => sanitized.querySelector(`[id="scope__${id}"]`);
		expect(byId("p1")?.getAttribute("style")).toBe(
			"marker-end: url('#scope__arrowhead'); fill: url(\"#scope__grad1\")",
		);
		expect(byId("p2")?.getAttribute("fill")).toBe("url(#scope__grad1)");
		expect(byId("p2")?.hasAttribute("stroke")).toBe(false);
		expect(byId("p3")?.getAttribute("style")).toBe("fill: ; stroke: #ffffff");
		expect(byId("p4")?.getAttribute("style")).toBe("fill: ; stroke: ");
		const css = sanitized.querySelector("style")?.textContent ?? "";
		expect(css).toContain(".a { fill: url(#scope__grad1); }");
		expect(css).toContain(".c { marker-end: url('#scope__arrowhead'); }");
		expect(css).toContain("stroke: #333333;");
		expect(css).not.toMatch(/evil|https:|data:/i);
	});

	it("still blocks javascript: and escaped url() payloads in <style> and inline style", () => {
		const sanitized = sanitizeMermaidSvg(
			[
				'<svg xmlns="http://www.w3.org/2000/svg" id="m-root">',
				"<style>.x { fill: url(javascript:alert(1)); }</style>",
				'<path id="a" style="fill: url(javascript:alert(1))"/>',
				'<path id="b" style="fill: \\75rl(https://evil.example/a); stroke: red"/>',
				'<path id="c" style="background: image-set(&quot;https://evil.example/a&quot; 1x)"/>',
				"</svg>",
			].join(""),
			document,
			"scope",
		);
		expect(sanitized).not.toBeNull();
		if (!sanitized) return;
		expect(sanitized.querySelector("style")?.textContent).toBe("");
		expect(
			sanitized.querySelector('[id="scope__a"]')?.hasAttribute("style"),
		).toBe(false);
		expect(sanitized.querySelector('[id="scope__b"]')?.getAttribute("style")).toBe(
			"; stroke: red",
		);
		expect(
			sanitized.querySelector('[id="scope__c"]')?.hasAttribute("style"),
		).toBe(false);
	});

	it("passes the Mermaid render id as the SVG ID scope", async () => {
		const win = window as TestEnhancementWindow;
		win.mermaid = {
			render: vi.fn(async (id: string) => ({
				svg: `<svg xmlns="http://www.w3.org/2000/svg" id="${id}"><defs><marker id="arrowhead"/></defs><line marker-end="url(#arrowhead)"/></svg>`,
			})),
		};
		const view = mountVisualEditor(
			"```mermaid\nsequenceDiagram\n  A->>B: hi\n```",
		);
		await flushMicrotasks();
		await flushMicrotasks();
		const svg = view.dom.querySelector("div.easymde-mermaid svg");
		const renderId = svg?.getAttribute("id") ?? "";
		expect(renderId).toMatch(/^easymde-visual-mermaid-\d+$/);
		expect(svg?.querySelector("marker")?.getAttribute("id")).toBe(
			`${renderId}__arrowhead`,
		);
		expect(svg?.querySelector("line")?.getAttribute("marker-end")).toBe(
			`url(#${renderId}__arrowhead)`,
		);
	});

	it("renders collapsed raw, footnotes, toc chips and monospace fallbacks without <pre>", () => {
		const markdown = [
			"[TOC]",
			"[^1]: Footnote body",
			'<div class="custom">raw</div>',
			"$$\nx + y\n$$",
			"```mermaid\ngraph TD\n  A --> B\n```",
		].join("\n\n");
		const view = mountVisualEditor(markdown);
		for (const kind of ["toc", "footnotes", "raw"]) {
			const card = view.dom.querySelector(
				`[data-easymde-protected-kind="${kind}"]`,
			);
			expect(card).not.toBeNull();
			expect(card?.querySelector("pre")).toBeNull();
			const chip = card?.querySelector(".easymde-protected-meta-chip");
			expect(chip?.tagName).toBe("DIV");
			expect(chip?.getAttribute("data-easymde-protected-collapsed")).toBe("1");
		}
		for (const kind of ["math", "mermaid"]) {
			const block = view.dom.querySelector(
				`[data-easymde-protected-kind="${kind}"]`,
			);
			expect(block?.querySelector("pre")).toBeNull();
			const fallback = block?.querySelector(".easymde-protected-fallback-pre");
			expect(fallback?.tagName).toBe("DIV");
			expect(
				fallback?.querySelector("code.easymde-protected-fallback"),
			).not.toBeNull();
		}
		// The only <pre> elements left are real fenced code blocks.
		expect(view.dom.querySelectorAll("pre").length).toBe(0);
	});

	it("syncs the code language badge color from the code element computed color", () => {
		const callbacks: FrameRequestCallback[] = [];
		const rafSpy = vi.fn((callback: FrameRequestCallback) => {
			callbacks.push(callback);
			return callbacks.length;
		});
		const originalRaf = window.requestAnimationFrame;
		const originalCancel = window.cancelAnimationFrame;
		window.requestAnimationFrame = rafSpy;
		window.cancelAnimationFrame = vi.fn();
		const originalGetComputedStyle = window.getComputedStyle.bind(window);
		vi.spyOn(window, "getComputedStyle").mockImplementation(
			(element: Element, pseudo?: string | null) => {
				const real = originalGetComputedStyle(element, pseudo);
				if (element.tagName !== "CODE") return real;
				return {
					...real,
					backgroundColor: "rgb(40, 44, 52)",
					color: "rgb(171, 178, 191)",
				} as CSSStyleDeclaration;
			},
		);
		try {
			const view = mountVisualEditor("```ts\nconst x = 1;\n```");
			while (callbacks.length > 0) callbacks.shift()?.(0);
			const pre = view.dom.querySelector(
				"pre.easymde-code-block",
			) as HTMLElement | null;
			const badge = pre?.querySelector(
				"span.easymde-visual-code-lang",
			) as HTMLElement | null;
			expect(rafSpy).toHaveBeenCalled();
			expect(
				pre?.style.getPropertyValue("--easymde-code-frame-background"),
			).toBe("rgb(40, 44, 52)");
			expect(badge?.style.color).toBe("rgb(171, 178, 191)");
		} finally {
			window.requestAnimationFrame = originalRaf;
			window.cancelAnimationFrame = originalCancel;
		}
	});

	it("shows non-source loading placeholders during active warmup or async Mermaid render and transitions to rendered preview", async () => {
		const states: Record<VisualRuntimeFeature, VisualRuntimeState> = {
			math: "loading",
			mermaid: "loading",
			toc: "ready",
		};
		const listeners = new Set<() => void>();
		const runtimePort: VisualGeneratedRuntimePort = {
			getState: (feature) => states[feature],
			request: (feature) => states[feature],
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
		const notify = () => {
			for (const listener of Array.from(listeners)) listener();
		};
		const win = window as TestEnhancementWindow;
		try {
			const view = mountVisualEditor(
				[
					"Inline $E = mc^2$.",
					"$$\n\\begin{bmatrix}\n1 & 2 \\\n3 & 4\n\\end{bmatrix}\n$$",
					"$$\n\\begin{cases}\nx = 1 \\\ny = 2\n\\end{cases}\n$$",
					"```mermaid\nflowchart TD\n  A --> B\n```",
				].join("\n\n"),
				{ nodeViewsOptions: { protectedAtom: { runtimePort } } },
			);
			expect(
				view.dom.querySelectorAll(".easymde-protected-loading"),
			).toHaveLength(4);
			expect(view.dom.querySelector(".easymde-protected-fallback")).toBeNull();

			// Complete math warmup with KaTeX ready; Mermaid stays in loading state.
			const katexRender = vi.fn((tex: string, target: HTMLElement) => {
				const span = target.ownerDocument.createElement("span");
				span.className = "katex";
				span.textContent = tex;
				target.replaceChildren(span);
			});
			win.katex = { render: katexRender };
			states.math = "ready";
			notify();

			expect(view.dom.querySelectorAll(".easymde-math .katex")).toHaveLength(3);
			// Single trailing backslash inside \begin{bmatrix} is normalized to \\
			// while \begin{cases} stays untouched — matching formal Preview identically.
			expect(katexRender).toHaveBeenCalledWith(
				"\\begin{bmatrix}\n1 & 2 \\\\\n3 & 4\n\\end{bmatrix}",
				expect.any(HTMLElement),
				{ displayMode: true, throwOnError: false, strict: "ignore" },
			);
			expect(katexRender).toHaveBeenCalledWith(
				"\\begin{cases}\nx = 1 \\\ny = 2\n\\end{cases}",
				expect.any(HTMLElement),
				{ displayMode: true, throwOnError: false, strict: "ignore" },
			);
			expect(
				view.dom.querySelectorAll(
					'[data-easymde-protected-kind="mermaid"] .easymde-protected-loading',
				),
			).toHaveLength(1);
			expect(view.dom.querySelector(".easymde-protected-fallback")).toBeNull();

			// Complete Mermaid warmup; pending mermaid.render() keeps loading placeholder (never raw source).
			const pendingMermaid = createDeferred<MermaidRenderResult>();
			win.mermaid = {
				initialize: vi.fn(),
				render: vi.fn(() => pendingMermaid.promise),
			};
			states.mermaid = "ready";
			notify();
			await flushMicrotasks();

			expect(
				view.dom.querySelector(
					'[data-easymde-protected-kind="mermaid"] .easymde-protected-loading',
				),
			).not.toBeNull();
			expect(view.dom.querySelector(".easymde-protected-fallback")).toBeNull();

			pendingMermaid.resolve({
				svg: '<svg id="easymde-visual-mermaid-test"><g><text>Rendered Flow</text></g></svg>',
			});
			await flushMicrotasks();
			expect(
				view.dom.querySelector(".easymde-mermaid svg")?.textContent,
			).toContain("Rendered Flow");
			expect(view.dom.querySelector(".easymde-protected-loading")).toBeNull();
		} finally {
			delete win.katex;
			delete win.mermaid;
		}
	});

	it("renders cached formal-Preview Mermaid SVGs synchronously without redundant mermaid.render calls", () => {
		const win = window as TestEnhancementWindow;
		const renderSpy = vi.fn(async () => ({
			svg: "<svg><text>Should Not Run</text></svg>",
		}));
		win.mermaid = { initialize: vi.fn(), render: renderSpy };
		win.EasyMDEMermaidRenderer = {
			readCachedSvg: vi.fn((source: string, renderId: string) =>
				source === "flowchart TD\n  A --> B"
					? `<svg id="${renderId}"><defs><marker id="arrowhead"><path d="M0,0"/></marker></defs><line marker-end="url(#arrowhead)"/><text>Cached Sync</text></svg>`
					: null,
			),
		};
		try {
			const view = mountVisualEditor(
				"```mermaid\nflowchart TD\n  A --> B\n```",
			);
			const svg = view.dom.querySelector(".easymde-mermaid svg");
			expect(svg).not.toBeNull();
			expect(svg?.textContent).toContain("Cached Sync");
			expect(renderSpy).not.toHaveBeenCalled();
			const renderId = svg?.getAttribute("id") ?? "";
			expect(svg?.querySelector("marker")?.getAttribute("id")).toBe(
				`${renderId}__arrowhead`,
			);
		} finally {
			delete win.EasyMDEMermaidRenderer;
			delete win.mermaid;
		}
	});

	it("renders HTML container blocks, inline HTML tags, reference links, and TOC in main-baseline WYSIWYG style while keeping source editable", () => {
		const markdown = [
			"## 1. Overview",
			"[TOC]",
			"Text <u>underlined</u>, <mark>marked</mark>, H<sub>2</sub>O, x<sup>2</sup>, <kbd>⌘</kbd> + <kbd>K</kbd>.",
			[
				"<details>",
				"<summary>Expand details</summary>",
				"",
				"Inside details paragraph.",
				"",
				"* Bullet one",
				"",
				"```bash",
				'echo "hi"',
				"```",
				"",
				"</details>",
			].join("\n"),
			[
				'<div align="center">',
				"",
				"### Centered Heading",
				"",
				"<kbd>Ctrl</kbd> + <kbd>S</kbd> and [Safe](https://example.com) and [Evil](javascript:alert(1)).",
				"",
				"</div>",
			].join("\n"),
			'[ref-a]: https://example.com "Example"',
		].join("\n\n");

		const view = mountVisualEditor(markdown);

		// Paired inline HTML tags render their visible text without showing raw tags.
		const inlineRendered = Array.from(
			view.dom.querySelectorAll(".easymde-protected-inline-rendered"),
		).map((el) => el.textContent);
		expect(inlineRendered).toEqual(["underlined", "marked", "2", "2", "⌘", "K"]);
		expect(view.dom.textContent).not.toContain("<u>");
		expect(view.dom.textContent).not.toContain("<kbd>");

		// <details> renders its inner Markdown blocks cleanly (p, ul, Mac pre>code).
		const rawBlocks = view.dom.querySelectorAll(
			'[data-easymde-protected-kind="raw"]',
		);
		expect(rawBlocks).toHaveLength(3);
		const detailsPreview = rawBlocks[0]?.querySelector(
			".easymde-protected-preview",
		);
		expect(detailsPreview?.querySelector("p")?.textContent).toBe(
			"Inside details paragraph.",
		);
		expect(detailsPreview?.querySelector("ul li")?.textContent).toBe(
			"Bullet one",
		);
		// Tight list items inside raw blocks match CommonMark (`<li>text</li>`, no extra `<p>`).
		expect(detailsPreview?.querySelector("ul li p")).toBeNull();
		expect(
			detailsPreview?.querySelector("pre.easymde-code-block code.language-bash")
				?.textContent,
		).toContain('echo "hi"');

		// <div align="center"> renders inner heading, strips inline <kbd> tags even at line start, and neutralizes javascript: links.
		const divPreview = rawBlocks[1]?.querySelector(".easymde-protected-preview");
		expect(divPreview?.querySelector("h3")?.textContent).toBe(
			"Centered Heading",
		);
		expect(divPreview?.querySelector("p")?.textContent).toContain("Ctrl + S");
		const safeAnchor = divPreview?.querySelector("a");
		expect(safeAnchor?.getAttribute("href")).toBe("https://example.com");
		expect(divPreview?.querySelectorAll("a")).toHaveLength(1);
		expect(divPreview?.querySelector('a[href^="javascript:"]')).toBeNull();
		// Clicking a rendered anchor inside non-editing preview must not navigate.
		const anchorClick = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
		});
		safeAnchor?.dispatchEvent(anchorClick);
		expect(anchorClick.defaultPrevented).toBe(true);

		// Reference link definitions collapse into a quiet chip.
		expect(
			rawBlocks[2]?.querySelector(".easymde-protected-meta-chip")?.textContent,
		).toContain("[ref-a]");

		// Clicking Edit on <details> still opens the untouched raw Markdown source.
		const editBtn = rawBlocks[0]?.querySelector(
			"button.easymde-protected-edit-btn",
		) as HTMLButtonElement;
		editBtn.click();
		const textarea = rawBlocks[0]?.querySelector(
			"textarea.easymde-protected-source-input",
		) as HTMLTextAreaElement;
		expect(textarea.value).toContain("<summary>Expand details</summary>");

		// Canonical Markdown remains lossless.
		expect(serializeVisualDocToMarkdown(view.state.doc)).toContain(
			"<u>underlined</u>",
		);
		expect(serializeVisualDocToMarkdown(view.state.doc)).toContain(
			"## 1. Overview",
		);
	});

	it("preserves paragraph text across Type-7 tags, closes paragraph after Setext headings, keeps leading indented code in raw blocks, renders inline emphasis inside tags, and updates live TOC with slug hrefs, inline-atom headings, and raw-card headings", () => {
		const markdown = [
			"[TOC]",
			"## Before",
			"## Heading with <u>underlined text</u>",
			"Inline <u>*italic*</u> and <u>nested <mark>inner</mark></u>.",
			["<div>", "", "Text stays", "<kbd>", "Next line stays", "", "</div>"].join(
				"\n",
			),
			["<div>", "", "Title", "===", "<kbd>", "Stripped after setext", "", "</div>"].join(
				"\n",
			),
			["<div>", "", "    indented code", "", "</div>"].join("\n"),
			[
				'<div align="center">',
				"",
				"### Centered Raw",
				"",
				"</div>",
			].join("\n"),
		].join("\n\n");

		const view = mountVisualEditor(markdown);

		// Inline Markdown inside paired HTML tags renders as real emphasis.
		expect(
			view.dom.querySelector(".easymde-protected-inline-rendered em")
				?.textContent,
		).toBe("italic");
		expect(view.dom.textContent).not.toContain("*italic*");
		expect(view.dom.textContent).toContain("nested inner");

		// Type-7 standalone <kbd> inside a paragraph does NOT hide "Next line stays".
		const rawBlocks = view.dom.querySelectorAll(
			'[data-easymde-protected-kind="raw"]',
		);
		expect(rawBlocks).toHaveLength(4);
		const type7Text =
			rawBlocks[0]?.querySelector(".easymde-protected-preview p")
				?.textContent ?? "";
		expect(type7Text).toContain("Text stays");
		expect(type7Text).toContain("Next line stays");

		// After a Setext heading (`===`), standalone `<kbd>` starts a Type-7 HTML block and strips `Stripped after setext`.
		const setextPreview = rawBlocks[1]?.querySelector(
			".easymde-protected-preview",
		);
		expect(setextPreview?.querySelector("h1")?.textContent).toBe("Title");
		expect(setextPreview?.textContent).not.toContain("Stripped after setext");

		// Leading 4-space indented code block inside a raw block preserves its indentation.
		expect(
			rawBlocks[2]?.querySelector(
				".easymde-protected-preview pre.easymde-code-block code",
			)?.textContent,
		).toContain("indented code");

		// TOC includes normal headings, inline-atom heading text/slugs, and raw-card headings.
		const readTocLinks = () =>
			Array.from(
				view.dom.querySelectorAll(
					'[data-easymde-protected-kind="toc"] .easymde-toc ul li a',
				),
			).map((a) => ({
				href: a.getAttribute("href"),
				text: a.textContent,
			}));
		expect(readTocLinks()).toEqual([
			{ href: "#before", text: "Before" },
			{
				href: "#heading-with-underlined-text",
				text: "Heading with underlined text",
			},
			{ href: "#centered-raw", text: "Centered Raw" },
		]);

		// Renaming the heading updates the mounted TOC live.
		let headingTextPos = -1;
		view.state.doc.descendants((node, pos) => {
			if (node.isText && node.text === "Before") {
				headingTextPos = pos;
				return false;
			}
			return true;
		});
		expect(headingTextPos).toBeGreaterThan(0);
		view.dispatch(
			view.state.tr.insertText(
				"After",
				headingTextPos,
				headingTextPos + "Before".length,
			),
		);
		expect(readTocLinks()).toEqual([
			{ href: "#after", text: "After" },
			{
				href: "#heading-with-underlined-text",
				text: "Heading with underlined text",
			},
			{ href: "#centered-raw", text: "Centered Raw" },
		]);
	});

	it("requires positive runtimePort math readiness before calling katex.render and falls back when idle or unavailable", () => {
		let mathState: VisualRuntimeState = "idle";
		const listeners = new Set<() => void>();
		const runtimePort: VisualGeneratedRuntimePort = {
			getState: (feature) => (feature === "math" ? mathState : "ready"),
			request: (feature) => (feature === "math" ? mathState : "ready"),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
		const notify = () => {
			for (const listener of Array.from(listeners)) listener();
		};
		const katexRender = vi.fn((tex: string, target: HTMLElement) => {
			const span = target.ownerDocument.createElement("span");
			span.className = "katex";
			span.textContent = tex;
			target.replaceChildren(span);
		});
		const view = mountVisualEditor("$$\nE = mc^2\n$$", {
			nodeViewsOptions: {
				protectedAtom: {
					runtimePort,
					runtimeProvider: { getKatex: () => ({ render: katexRender }) },
				},
			},
		});
		// Without positive runtimePort `ready`, katex.render must NOT be called.
		expect(katexRender).not.toHaveBeenCalled();
		expect(view.dom.querySelector(".easymde-math .katex")).toBeNull();
		expect(
			view.dom.querySelector("code.easymde-protected-fallback")?.textContent,
		).toBe("$$\nE = mc^2\n$$");

		// Unavailable state also blocks rendering.
		mathState = "unavailable";
		notify();
		expect(katexRender).not.toHaveBeenCalled();

		// Once CSS+JS readiness completes (`ready`), KaTeX renders cleanly.
		mathState = "ready";
		notify();
		expect(katexRender).toHaveBeenCalledTimes(1);
		expect(view.dom.querySelector(".easymde-math .katex")?.textContent).toBe(
			"E = mc^2",
		);
	});

	it("strips quoted > attributes cleanly in inline and raw HTML previews, renders nested math in details, and stays linear on tag-dense lines", () => {
		const katexRender = vi.fn((tex: string, target: HTMLElement) => {
			const span = target.ownerDocument.createElement("span");
			span.className = "katex";
			span.textContent = tex;
			target.replaceChildren(span);
		});
		const markdown = [
			'Inline <span title="a > b">clean text</span> and <span title=\'x > y\'>single</span>.',
			[
				"<details>",
				"<summary>Math & HTML</summary>",
				"",
				'<span title="a > b">inside raw</span> with $E = mc^2$.',
				"",
				"## Dup",
				"",
				"## Dup",
				"",
				"</details>",
			].join("\n"),
			"[TOC]",
		].join("\n\n");

		const view = mountVisualEditor(markdown, {
			nodeViewsOptions: {
				protectedAtom: {
					runtimeProvider: { getKatex: () => ({ render: katexRender }) },
				},
			},
		});

		const inlineRendered = Array.from(
			view.dom.querySelectorAll(".easymde-protected-inline-rendered"),
		).map((el) => el.textContent);
		expect(inlineRendered).toEqual(["clean text", "single"]);
		expect(view.dom.textContent).not.toContain('b">');
		expect(view.dom.textContent).not.toContain("y'>");

		const rawPreview = view.dom.querySelector(
			'[data-easymde-protected-kind="raw"] .easymde-protected-preview',
		);
		expect(rawPreview?.textContent).toContain("inside raw");
		expect(rawPreview?.querySelector(".easymde-math .katex")?.textContent).toBe(
			"E = mc^2",
		);

		// Duplicate headings inside raw blocks mirror TocGenerator::unique_heading_id (`-2`).
		const tocHrefs = Array.from(
			view.dom.querySelectorAll(
				'[data-easymde-protected-kind="toc"] .easymde-toc ul li a',
			),
		).map((a) => a.getAttribute("href"));
		expect(tocHrefs).toEqual(["#dup", "#dup-2"]);

		// Tag-dense line with 5,000 quoted `>` attributes stays strictly linear in both scanners.
		const dense = '<span title="a > b">x</span>'.repeat(5000);
		const scanStart = performance.now();
		const strippedDense = stripCommonMarkHtmlForPreview(dense);
		const prescannedDense = prescanMarkdown(dense);
		expect(performance.now() - scanStart).toBeLessThan(150);
		expect(strippedDense).toBe("x".repeat(5000));
		expect(prescannedDense.protectedInlines.size).toBe(5000);

		// Thousands of unmatched open tags stay linear while nested balanced tags still match.
		const unmatchedStart = performance.now();
		const unmatchedPrescan = prescanMarkdown("<span>".repeat(3000));
		expect(performance.now() - unmatchedStart).toBeLessThan(150);
		expect(unmatchedPrescan.protectedInlines.size).toBe(3000);
		const nestedBalanced = prescanMarkdown("<span> <span> ok </span>");
		expect(Array.from(nestedBalanced.protectedInlines.values())).toEqual([
			{ kind: "raw-inline", rawMarkdown: "<span>" },
			{ kind: "raw-inline", rawMarkdown: "<span> ok </span>" },
		]);
	});

	it("blocks external URL-bearing SVG attributes and SMIL animation tags in Mermaid previews, propagates localized nested labels, and unsubscribes raw blocks after nested math renders", () => {
		// External href/xlink:href/src/srcset and SMIL <animate>/<set> must be stripped, while #fragment stays intact.
		const sanitized = sanitizeMermaidSvg(
			[
				'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" id="m-sec">',
				'<defs><marker id="arrow"><path d="M0,0"/></marker></defs>',
				'<image href="https://tracker.example/x.png" xlink:href="https://tracker.example/y.png" width="10" height="10"/>',
				'<feImage href="https://tracker.example/filter.png"/>',
				'<use href="https://tracker.example/defs.svg#a"/>',
				'<use xlink:href="#arrow"/>',
				'<foreignObject><img src="https://tracker.example/z.png" srcset="https://tracker.example/2x.png 2x"/><table background="https://tracker.example/bg.png"></table></foreignObject>',
				'<a href="https://tracker.example/nav"><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="href" values="javascript:alert(1)"/></a>',
				"</svg>",
			].join(""),
			document,
			"sec",
		);
		expect(sanitized).not.toBeNull();
		expect(sanitized?.querySelector("image")?.getAttribute("href")).toBeNull();
		expect(
			sanitized
				?.querySelector("image")
				?.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
		).toBeNull();
		expect(sanitized?.querySelector("feImage")?.getAttribute("href")).toBeNull();
		expect(sanitized?.querySelector("img")?.getAttribute("src")).toBeNull();
		expect(sanitized?.querySelector("img")?.getAttribute("srcset")).toBeNull();
		expect(
			sanitized?.querySelector("table")?.getAttribute("background"),
		).toBeNull();
		expect(sanitized?.querySelector("a")?.getAttribute("href")).toBeNull();
		expect(sanitized?.querySelectorAll("set, animate")).toHaveLength(0);
		const uses = Array.from(sanitized?.querySelectorAll("use") ?? []);
		expect(uses[0]?.getAttribute("href")).toBeNull();
		expect(
			uses[1]?.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
		).toBe("#sec__arrow");

		// Localized labels flow into nested footnotes/raw chips, inline comments use aria-hidden (no hard-coded English),
		// and raw blocks unsubscribe from runtimePort once nested math finishes rendering.
		let mathState: VisualRuntimeState = "loading";
		const listeners = new Set<() => void>();
		const runtimePort: VisualGeneratedRuntimePort = {
			getState: (feature) => (feature === "math" ? mathState : "ready"),
			request: (feature) => (feature === "math" ? mathState : "ready"),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
		const katexRender = vi.fn((tex: string, target: HTMLElement) => {
			const span = target.ownerDocument.createElement("span");
			span.className = "katex";
			span.textContent = tex;
			target.replaceChildren(span);
		});
		const view = mountVisualEditor(
			[
				"Inline<!-- secret -->note.",
				"<details>\n<summary>Nested</summary>\n\n$a + b$\n\n[^1]: Note body\n\n</details>",
			].join("\n\n"),
			{
				nodeViewsOptions: {
					protectedAtom: {
						labels: { footnotes: "本地脚注", raw: "本地原始块" },
						runtimePort,
						runtimeProvider: { getKatex: () => ({ render: katexRender }) },
					},
				},
			},
		);
		const hiddenComment = view.dom.querySelector(
			".easymde-protected-inline-hidden",
		);
		expect(hiddenComment?.getAttribute("aria-hidden")).toBe("true");
		expect(hiddenComment?.getAttribute("aria-label")).toBeNull();
		expect(
			view.dom.querySelector(".easymde-protected-meta-chip")?.textContent,
		).toContain("本地脚注");
		// Highlight plugin + raw block subscribed while nested math is loading.
		expect(listeners.size).toBe(2);

		mathState = "ready";
		for (const listener of Array.from(listeners)) listener();
		expect(katexRender).toHaveBeenCalledTimes(1);
		// Raw block unsubscribed after nested math rendered (only highlight plugin remains).
		expect(listeners.size).toBe(1);
		for (const listener of Array.from(listeners)) listener();
		expect(katexRender).toHaveBeenCalledTimes(1);
	});

	it("blocks XSS, event handlers, dangerous tags, style injection, and unsafe URLs across HTML blocks and inline HTML tags", () => {
		const malicious = [
			'Inline <u onclick="alert(1)" onmouseover="alert(2)">Safe</u> and <span style="background:url(javascript:alert(1))">Plain</span> and <img src=x onerror=alert(1)> and <svg/onload=alert(1)>.',
			'<iframe src="javascript:alert(1)"></iframe>',
			"<style>body { display: none !important; }</style>",
			[
				'<div onclick="alert(1)">',
				"",
				'<img src=x onerror=alert(1)> <svg/onload=alert(1)> <script>alert(1)</script>',
				"",
				"[BadLink](javascript:alert(1)) [BadVb](vbscript:msgbox(1)) ![BadImg](javascript:alert(1)) ![DataImg](data:text/html,<script>alert(1)</script>)",
				"",
				"</div>",
			].join("\n"),
		].join("\n\n");

		const view = mountVisualEditor(malicious);
		const root = view.dom;

		// Zero dangerous elements can ever be instantiated in the live DOM.
		expect(
			root.querySelectorAll(
				"script, iframe, object, embed, svg, style, form, base, meta, link",
			),
		).toHaveLength(0);
		expect(root.querySelectorAll("img")).toHaveLength(0);
		expect(root.querySelectorAll("a")).toHaveLength(0);

		// Zero event-handler attributes (`on*`) or inline `style` injection on any element.
		for (const el of Array.from(root.querySelectorAll("*"))) {
			for (const attr of Array.from(el.attributes)) {
				const name = attr.name.toLowerCase();
				expect(name.startsWith("on")).toBe(false);
				if (name === "href" || name === "src") {
					expect(attr.value).not.toMatch(/^\s*(?:javascript|vbscript|data):/i);
				}
			}
		}

		// Safe visible text from allowed inline tags still renders cleanly.
		expect(root.textContent).toContain("Safe");
		expect(root.textContent).toContain("Plain");
	});

	it("renders multi-line and unindented next-line reference definitions as collapsed meta chips", () => {
		const markdown = [
			"![x][img-title] and ![y][img-dest]",
			'[img-title]: https://example.com/a.png\n"line 1\nline 2"',
			'[img-dest]:\nhttps://example.com/b.png "cap"',
		].join("\n\n");

		const view = mountVisualEditor(markdown);
		const chips = Array.from(
			view.dom.querySelectorAll(".easymde-protected-meta-chip"),
		).map((el) => el.textContent);
		expect(chips).toHaveLength(2);
		expect(chips[0]).toContain("[img-title]");
		expect(chips[1]).toContain("[img-dest]");
	});

	it("aligns stripCommonMarkHtmlForPreview Type 1 cross-tag closing and Type 6 tag list with PHP (Track B #11)", () => {
		// Type 1 closes on any of </pre>, </script>, </style>, </textarea> (without space before >).
		expect(stripCommonMarkHtmlForPreview("<pre>\n</script>\npara")).toBe("para");
		expect(stripCommonMarkHtmlForPreview("<style>\n</pre>\npara")).toBe("para");
		expect(stripCommonMarkHtmlForPreview("<textarea>\n</style>\npara")).toBe(
			"para",
		);
		expect(stripCommonMarkHtmlForPreview("<pre>\n</script >\npara")).toBe("");

		// `<search>` is NOT a PHP CommonMark Type 6 block tag and does not interrupt a paragraph.
		expect(stripCommonMarkHtmlForPreview("para\n<search>\nfoo")).toBe(
			"para\nfoo",
		);
		// Standalone `<search>` outside a paragraph is still a Type 7 HTML block.
		expect(stripCommonMarkHtmlForPreview("<search>\nfoo")).toBe("");
	});
});
