import { readFileSync } from "node:fs";
import path from "node:path";
import { history } from "prosemirror-history";
import { DOMSerializer, type Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { addColumnAfter, addRowAfter, tableEditing } from "prosemirror-tables";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolbarCommand } from "../../contracts/bootstrap/toolbar-bootstrap";
import {
	parseImageScaleTitle,
	parseMarkdownToVisualDoc,
} from "./markdown-parser";
import {
	createMarkdownRoundTripGuard,
	serializeVisualDocToMarkdown,
} from "./markdown-serializer";
import {
	createVisualKeymapPlugins,
	executeVisualToolbarCommand,
} from "./visual-commands";
import { createVisualInputRulesPlugin } from "./visual-input-rules";
import { isValidVisualImageScale, visualEditorSchema } from "./visual-schema";

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

function createEditorView(markdown: string): EditorView {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const doc = parseMarkdownToVisualDoc(markdown);
	const state = EditorState.create({
		doc,
		schema: visualEditorSchema,
		plugins: [
			history(),
			createVisualInputRulesPlugin(),
			...createVisualKeymapPlugins(),
			tableEditing(),
		],
	});
	const view = new EditorView(host, { state });
	mountedViews.push(view);
	return view;
}

function makeToolbarCommand(
	overrides: Partial<ToolbarCommand> & Pick<ToolbarCommand, "id" | "action">,
): ToolbarCommand {
	return {
		label: overrides.id,
		icon: "editor-code",
		surface: "main",
		group: "format",
		...overrides,
	};
}

function serializeDomHtml(doc: ProseMirrorNode): HTMLElement {
	const serializer = DOMSerializer.fromSchema(visualEditorSchema);
	const container = document.createElement("div");
	container.appendChild(serializer.serializeFragment(doc.content));
	return container;
}

function dispatchKey(
	view: EditorView,
	key: string,
	modifiers: Readonly<{
		ctrlKey?: boolean;
		metaKey?: boolean;
		shiftKey?: boolean;
	}> = {},
): boolean {
	let handled = false;
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		ctrlKey: Boolean(modifiers.ctrlKey),
		metaKey: Boolean(modifiers.metaKey),
		shiftKey: Boolean(modifiers.shiftKey),
	});
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
	for (const ch of text) {
		const { from, to } = view.state.selection;
		let handledByInputRule = false;
		view.someProp("handleTextInput", (handler) => {
			if (
				handler(view, from, to, ch, () =>
					view.state.tr.insertText(ch, from, to),
				)
			) {
				handledByInputRule = true;
				return true;
			}
			return false;
		});
		if (!handledByInputRule) {
			view.dispatch(view.state.tr.insertText(ch, from, to));
		}
	}
}

function setCursorAtEndOfFirstTextblock(view: EditorView): void {
	const firstBlock = view.state.doc.firstChild;
	const endPos = firstBlock ? firstBlock.nodeSize - 1 : 1;
	view.dispatch(
		view.state.tr.setSelection(TextSelection.create(view.state.doc, endPos)),
	);
}

describe("visualEditorSchema DOM contract", () => {
	it("renders EasyMDE semantic HTML selectors across all core nodes and marks", () => {
		const markdown = [
			"# Heading 1",
			"###### Heading 6",
			'Paragraph with **bold**, *italic*, ~~strike~~, `code`, and [link](https://example.com "Example").',
			"> Quoted text",
			"- Bullet item",
			"3. Ordered item",
			"- [x] Done task\n- [ ] Open task",
			"```ts\nconst answer = 42;\n```",
			"---",
			"| Left | Center | Right |\n| :--- | :---: | ---: |\n| A | B | C |",
			'![Logo](https://example.com/logo.png "Caption {width=50%}")',
			"$$\nE = mc^2\n$$",
			"Inline $a^2 + b^2 = c^2$ and ref[^1].",
		].join("\n\n");

		const doc = parseMarkdownToVisualDoc(markdown);
		const dom = serializeDomHtml(doc);

		expect(dom.querySelector("h1")?.textContent).toBe("Heading 1");
		expect(dom.querySelector("h6")?.textContent).toBe("Heading 6");
		expect(dom.querySelector("p strong")?.textContent).toBe("bold");
		expect(dom.querySelector("p em")?.textContent).toBe("italic");
		expect(dom.querySelector("p del")?.textContent).toBe("strike");
		expect(dom.querySelector("p code")?.textContent).toBe("code");
		const anchor = dom.querySelector("p a");
		expect(anchor?.getAttribute("href")).toBe("https://example.com");
		expect(anchor?.getAttribute("title")).toBe("Example");

		expect(dom.querySelector("blockquote p")?.textContent).toBe("Quoted text");
		expect(
			dom.querySelector("ul:not(.contains-task-list) li")?.textContent,
		).toBe("Bullet item");
		expect(dom.querySelector("ol")?.getAttribute("start")).toBe("3");

		const taskList = dom.querySelector("ul.contains-task-list");
		expect(taskList).not.toBeNull();
		const taskItems = taskList?.querySelectorAll("li.task-list-item");
		expect(taskItems?.length).toBe(2);
		expect(taskItems?.[0]?.getAttribute("data-checked")).toBe("true");
		expect(taskItems?.[1]?.getAttribute("data-checked")).toBe("false");

		const pre = dom.querySelector("pre.easymde-code-block");
		expect(pre?.getAttribute("data-language")).toBe("ts");
		expect(pre?.querySelector("code.language-ts")?.textContent).toBe(
			"const answer = 42;",
		);

		expect(dom.querySelector("hr")).not.toBeNull();

		const tableSection = dom.querySelector("section.easymde-table-container");
		expect(tableSection).not.toBeNull();
		const headers = tableSection?.querySelectorAll("table tbody tr th");
		expect(headers?.length).toBe(3);
		expect(headers?.[0]?.getAttribute("align")).toBe("left");
		expect(headers?.[0]?.getAttribute("style")).toMatch(/text-align:\s*left/);
		expect(headers?.[1]?.getAttribute("align")).toBe("center");
		expect(headers?.[2]?.getAttribute("align")).toBe("right");

		const img = dom.querySelector("img");
		expect(img?.getAttribute("alt")).toBe("Logo");
		expect(img?.getAttribute("title")).toBe("Caption");
		expect(img?.getAttribute("data-easymde-image-scale")).toBe("50");
		expect(img?.getAttribute("style")).toBe("width: 50%; height: auto;");

		const mathBlock = dom.querySelector(
			'div[data-easymde-protected-block="1"][data-easymde-protected-kind="math"]',
		);
		expect(mathBlock?.getAttribute("contenteditable")).toBe("false");
		expect(mathBlock?.getAttribute("data-easymde-visual-markdown-source")).toBe(
			"$$\nE = mc^2\n$$",
		);

		const mathInline = dom.querySelector(
			'span[data-easymde-protected-inline="1"][data-easymde-protected-kind="math-inline"]',
		);
		expect(mathInline?.getAttribute("contenteditable")).toBe("false");
		expect(
			mathInline?.getAttribute("data-easymde-visual-markdown-source"),
		).toBe("$a^2 + b^2 = c^2$");

		const footnoteRef = dom.querySelector(
			'span[data-easymde-protected-inline="1"][data-easymde-protected-kind="footnote-ref"]',
		);
		expect(
			footnoteRef?.getAttribute("data-easymde-visual-markdown-source"),
		).toBe("[^1]");
	});

	it("validates EasyMDE image scale percentages and neutralizes javascript URLs in DOM", () => {
		expect(isValidVisualImageScale(50)).toBe(true);
		expect(isValidVisualImageScale(200)).toBe(true);
		expect(isValidVisualImageScale(42)).toBe(false);
		expect(isValidVisualImageScale("50")).toBe(false);

		expect(parseImageScaleTitle("Photo {width=67%}")).toEqual({
			title: "Photo",
			scale: 67,
		});
		expect(parseImageScaleTitle("{width=33%}")).toEqual({
			title: null,
			scale: 33,
		});
		expect(parseImageScaleTitle("Photo {width=99%}")).toEqual({
			title: "Photo {width=99%}",
			scale: null,
		});

		const unsafeDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.paragraph.create(null, [
				visualEditorSchema.text("Click", [
					visualEditorSchema.marks.link.create({
						href: "javascript:alert(1)",
						title: null,
					}),
				]),
			]),
		]);
		const dom = serializeDomHtml(unsafeDoc);
		expect(dom.querySelector("a")?.getAttribute("href")).toBeNull();
	});

	it("integrates cleanly with prosemirror-tables editing commands in jsdom", () => {
		const view = createEditorView("| A | B |\n| :--- | ---: |\n| 1 | 2 |");
		// Place cursor inside first header cell paragraph (table +1, row +1, th +1, p +1 = 4)
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)),
		);

		expect(addRowAfter(view.state, view.dispatch)).toBe(true);
		expect(addColumnAfter(view.state, view.dispatch)).toBe(true);

		const tableNode = view.state.doc.firstChild;
		expect(tableNode?.type.name).toBe("table");
		expect(tableNode?.childCount).toBe(3);
		expect(tableNode?.child(0).childCount).toBe(3);
		expect(
			view.dom.querySelector("section.easymde-table-container table tbody"),
		).not.toBeNull();
	});
});

describe("Markdown parser and serializer round-trip", () => {
	it("produces a valid empty paragraph doc for empty or whitespace-only input", () => {
		const emptyDoc = parseMarkdownToVisualDoc("");
		expect(emptyDoc.childCount).toBe(1);
		expect(emptyDoc.firstChild?.type.name).toBe("paragraph");
		expect(serializeVisualDocToMarkdown(emptyDoc)).toBe("");

		const whitespaceDoc = parseMarkdownToVisualDoc("   \n\t\n  ");
		expect(whitespaceDoc.childCount).toBe(1);
		expect(serializeVisualDocToMarkdown(whitespaceDoc)).toBe("");
	});

	it("preserves headings, nested lists, task lists, blockquotes, and code fences", () => {
		const markdown = [
			"## Section Title",
			"> Outer quote\n>\n> > Nested quote",
			"- Parent\n  - Child A\n  - Child B\n- Sibling",
			"1. First\n2. Second",
			"- [x] Completed\n- [ ] Pending",
			'~~~~markdown title="nested"\n```ts\nconst x = 1;\n```\n~~~~',
			'````md\n```js\nconsole.log("hi");\n```\n````',
		].join("\n\n");

		const doc = parseMarkdownToVisualDoc(markdown);
		const serialized = serializeVisualDocToMarkdown(doc);
		const reparsed = parseMarkdownToVisualDoc(serialized);

		expect(reparsed.eq(doc)).toBe(true);
		expect(serialized).toContain('~~~~markdown title="nested"');
		expect(serialized).toContain("````md");
		expect(serialized).toContain("- [x] Completed");
		expect(serialized).toContain("- [ ] Pending");
	});

	it("preserves GFM tables, alignments, <br> cell breaks, and easymde-table-align annotations", () => {
		const markdown = [
			'<!-- easymde-table-align:v1 [[0,"center"],[1,1,"left"]] -->',
			"| Col A | Col B | Col C |",
			"| :--- | :---: | ---: |",
			"| Line 1<br>Line 2 | Pipe \\| value | `npm run dev` |",
		].join("\n");

		const doc = parseMarkdownToVisualDoc(markdown);
		const tableNode = doc.firstChild;
		expect(tableNode?.type.name).toBe("table");
		expect(tableNode?.attrs.alignAnnotation).toBe(
			'<!-- easymde-table-align:v1 [[0,"center"],[1,1,"left"]] -->',
		);
		// Row 0 overridden to center by annotation; row 1 col 1 overridden to left.
		expect(tableNode?.child(0).child(0).attrs.textAlign).toBe("center");
		expect(tableNode?.child(1).child(1).attrs.textAlign).toBe("left");

		const serialized = serializeVisualDocToMarkdown(doc);
		expect(serialized).toContain(
			'<!-- easymde-table-align:v1 [[0,"center"],[1,1,"left"]] -->',
		);
		expect(serialized).toContain("| :--- | :---: | ---: |");
		expect(serialized).toContain("Line 1<br>Line 2");
		expect(serialized).toContain("Pipe \\| value");
		expect(parseMarkdownToVisualDoc(serialized).eq(doc)).toBe(true);
	});

	it("preserves image width scales with and without title", () => {
		const markdown = [
			'![With Title](https://example.com/a.png "Hero {width=50%}")',
			'![Scale Only](https://example.com/b.png "{width=150%}")',
			"![Plain](https://example.com/c.png)",
		].join("\n\n");

		const doc = parseMarkdownToVisualDoc(markdown);
		const serialized = serializeVisualDocToMarkdown(doc);

		expect(serialized).toBe(markdown);
		expect(parseMarkdownToVisualDoc(serialized).eq(doc)).toBe(true);
	});

	it("protects KaTeX math, Mermaid, [TOC], footnotes, reference links, and raw HTML verbatim", () => {
		const markdown = [
			"[TOC]",
			"Inline $E = mc^2$ and \\(x_1 + x_2\\) with ref[^note] and [Site][site-ref].",
			"$$\n\\begin{cases}\nx + y = 10 \\\\\\\n2x - y = 5\n\\end{cases}\n$$",
			"\\[\\int_0^1 x^2\\,dx = \\frac{1}{3}\\]",
			"```mermaid\nflowchart TD\n    A[Start] --> B[End]\n```",
			"<!-- raw editorial comment -->",
			"<details>\n<summary>Expand</summary>\n\nHidden body\n\n</details>",
			"[^note]: Footnote line one.\n    Continuation line.",
			'[site-ref]: https://example.com "Example Site"',
		].join("\n\n");

		const doc = parseMarkdownToVisualDoc(markdown);
		const protectedKinds: string[] = [];
		doc.descendants((node) => {
			if (node.type.name === "protected_block") {
				protectedKinds.push(`block:${String(node.attrs.kind)}`);
			} else if (node.type.name === "protected_inline") {
				protectedKinds.push(`inline:${String(node.attrs.kind)}`);
			}
		});

		expect(protectedKinds).toContain("block:toc");
		expect(protectedKinds).toContain("inline:math-inline");
		expect(protectedKinds).toContain("inline:footnote-ref");
		expect(protectedKinds).toContain("block:math");
		expect(protectedKinds).toContain("block:mermaid");
		expect(protectedKinds).toContain("block:footnotes");
		expect(protectedKinds).toContain("block:raw");

		const serialized = serializeVisualDocToMarkdown(doc);
		expect(serialized).toContain("[TOC]");
		expect(serialized).toContain("$E = mc^2$");
		expect(serialized).toContain("\\(x_1 + x_2\\)");
		expect(serialized).toContain("[^note]");
		expect(serialized).toContain(
			"$$\n\\begin{cases}\nx + y = 10 \\\\\\\n2x - y = 5\n\\end{cases}\n$$",
		);
		expect(serialized).toContain("\\[\\int_0^1 x^2\\,dx = \\frac{1}{3}\\]");
		expect(serialized).toContain(
			"```mermaid\nflowchart TD\n    A[Start] --> B[End]\n```",
		);
		expect(serialized).toContain("<!-- raw editorial comment -->");
		expect(serialized).toContain(
			"<details>\n<summary>Expand</summary>\n\nHidden body\n\n</details>",
		);
		expect(serialized).toContain(
			"[^note]: Footnote line one.\n    Continuation line.",
		);
		expect(serialized).toContain(
			'[site-ref]: https://example.com "Example Site"',
		);
		expect(parseMarkdownToVisualDoc(serialized).eq(doc)).toBe(true);
	});

	it("round-trips docs/examples/markdown-full-capability-test.md losslessly and idempotently", () => {
		const fixturePath = path.resolve(
			process.cwd(),
			"docs/examples/markdown-full-capability-test.md",
		);
		const fixtureMarkdown = readFileSync(fixturePath, "utf8");

		const firstDoc = parseMarkdownToVisualDoc(fixtureMarkdown);
		const serialized = serializeVisualDocToMarkdown(firstDoc);
		const secondDoc = parseMarkdownToVisualDoc(serialized);

		expect(secondDoc.eq(firstDoc)).toBe(true);
		expect(serialized).toContain("# Markdown 全量能力测试文档");
		expect(serialized).toContain("$E = mc^2$");
		expect(serialized).toContain("$\\sum_{i=1}^{n} p_i = 1$");
		expect(serialized).toContain("启动本地服务<br>支持热更新");
		expect(serialized).toContain("```mermaid\nflowchart TD");
		expect(serialized).toContain("```mermaid\nxychart-beta");
		expect(serialized).toContain("[^1]: 这是一个简单脚注。");
		expect(serialized).toContain('[github-link]: https://github.com "GitHub"');
		expect(serialized).toContain("<summary>点击展开查看隐藏内容</summary>");
	});

	it("enforces zero-write-on-read via createMarkdownRoundTripGuard", () => {
		const quirkyOriginal =
			"  # Heading with extra spacing   \r\n\r\n*  Item 1\r\n*  Item 2\r\n";
		const guard = createMarkdownRoundTripGuard(quirkyOriginal);

		expect(guard.isUnmodified(guard.initialDoc)).toBe(true);
		expect(guard.serialize(guard.initialDoc)).toBe(quirkyOriginal);

		// A fresh clone with identical structure still returns the untouched original.
		const identicalDoc = parseMarkdownToVisualDoc(quirkyOriginal);
		expect(guard.isUnmodified(identicalDoc)).toBe(true);
		expect(guard.serialize(identicalDoc)).toBe(quirkyOriginal);

		// Once edited, serializer emits updated Markdown.
		const editedDoc = parseMarkdownToVisualDoc("# Edited heading");
		expect(guard.isUnmodified(editedDoc)).toBe(false);
		expect(guard.serialize(editedDoc)).toBe("# Edited heading");
	});
});

describe("Typora-style input rules", () => {
	it("converts block markdown shortcuts as typed", () => {
		const view = createEditorView("");

		typeText(view, "## ");
		expect(view.state.doc.firstChild?.type.name).toBe("heading");
		expect(view.state.doc.firstChild?.attrs.level).toBe(2);

		const quoteView = createEditorView("");
		typeText(quoteView, "> ");
		expect(quoteView.state.doc.firstChild?.type.name).toBe("blockquote");

		const bulletView = createEditorView("");
		typeText(bulletView, "- ");
		expect(bulletView.state.doc.firstChild?.type.name).toBe("bullet_list");
		// Continuing `- ` with `[x] ` upgrades the bullet item to a checked task list.
		typeText(bulletView, "[x] ");
		expect(bulletView.state.doc.firstChild?.type.name).toBe("task_list");
		expect(bulletView.state.doc.firstChild?.firstChild?.attrs.checked).toBe(
			true,
		);

		const orderedView = createEditorView("");
		typeText(orderedView, "1. ");
		expect(orderedView.state.doc.firstChild?.type.name).toBe("ordered_list");

		const hrView = createEditorView("");
		typeText(hrView, "--- ");
		expect(hrView.state.doc.child(0).type.name).toBe("horizontal_rule");
		expect(hrView.state.doc.child(1).type.name).toBe("paragraph");

		const tildeFenceView = createEditorView("");
		typeText(tildeFenceView, "~~~py ");
		expect(tildeFenceView.state.doc.firstChild?.type.name).toBe("code_block");
		expect(tildeFenceView.state.doc.firstChild?.attrs.language).toBe("py");
		// Typed ~~~ normalizes to backtick fence matching EasyMDE's rule.
		expect(tildeFenceView.state.doc.firstChild?.attrs.fenceChar).toBe("`");
	});

	it("applies inline mark input rules for bold, italic, strike, and inline code", () => {
		const view = createEditorView("");
		typeText(view, "**bold** *ital* ~~del~~ `code`");

		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
			"**bold** *ital* ~~del~~ `code`",
		);
	});
});

describe("Toolbar commands and keyboard interactions", () => {
	it("executes formatting, heading, list, quote, code, math, table, hr, undo/redo, and unsupported commands", () => {
		const view = createEditorView("Hello world");
		// Select "Hello" (positions 1..6)
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)),
		);

		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({
					id: "bold",
					action: "wrap",
					prefix: "**",
					suffix: "**",
				}),
			),
		).toBe("handled");
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
			"**Hello** world",
		);

		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "italic", action: "italic" }),
			),
		).toBe("handled");
		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "strike", action: "strikethrough" }),
			),
		).toBe("handled");
		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "inlinecode", action: "inlineCode" }),
			),
		).toBe("handled");
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe("`Hello` world");

		// Undo restores previous state, Redo reapplies it.
		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "undo", action: "undo" }),
			),
		).toBe("handled");
		expect(serializeVisualDocToMarkdown(view.state.doc)).not.toBe(
			"`Hello` world",
		);
		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "redo", action: "redo" }),
			),
		).toBe("handled");
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe("`Hello` world");

		// Heading and paragraph conversion
		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "heading2", action: "heading", level: 2 }),
			),
		).toBe("handled");
		expect(view.state.doc.firstChild?.type.name).toBe("heading");
		expect(view.state.doc.firstChild?.attrs.level).toBe(2);

		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "paragraph", action: "paragraph" }),
			),
		).toBe("handled");
		expect(view.state.doc.firstChild?.type.name).toBe("paragraph");

		// Blockquote, unordered list, ordered list, task list
		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "quote", action: "quote" }),
			),
		).toBe("handled");
		expect(view.state.doc.firstChild?.type.name).toBe("blockquote");
		// Toggling quote again lifts it back out.
		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "quote", action: "quote" }),
			),
		).toBe("handled");
		expect(view.state.doc.firstChild?.type.name).toBe("paragraph");

		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "unorderedlist", action: "unorderedList" }),
			),
		).toBe("handled");
		expect(view.state.doc.firstChild?.type.name).toBe("bullet_list");

		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "orderedlist", action: "orderedList" }),
			),
		).toBe("handled");
		expect(view.state.doc.firstChild?.type.name).toBe("ordered_list");

		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "tasklist", action: "taskList" }),
			),
		).toBe("handled");
		expect(view.state.doc.firstChild?.type.name).toBe("task_list");

		// Code block, math block, table, horizontal rule on fresh views
		const insertView = createEditorView("");
		expect(
			executeVisualToolbarCommand(
				insertView,
				makeToolbarCommand({ id: "codefence", action: "codeBlock" }),
			),
		).toBe("handled");
		expect(insertView.state.doc.firstChild?.type.name).toBe("code_block");

		const mathView = createEditorView("");
		expect(
			executeVisualToolbarCommand(
				mathView,
				makeToolbarCommand({ id: "mathblock", action: "mathBlock" }),
			),
		).toBe("handled");
		expect(mathView.state.doc.firstChild?.type.name).toBe("protected_block");
		expect(mathView.state.doc.firstChild?.attrs.kind).toBe("math");

		const tableView = createEditorView("");
		expect(
			executeVisualToolbarCommand(
				tableView,
				makeToolbarCommand({ id: "table", action: "table" }),
			),
		).toBe("handled");
		expect(tableView.state.doc.firstChild?.type.name).toBe("table");

		const hrView = createEditorView("");
		expect(
			executeVisualToolbarCommand(
				hrView,
				makeToolbarCommand({ id: "hr", action: "horizontalRule" }),
			),
		).toBe("handled");
		expect(hrView.state.doc.firstChild?.type.name).toBe("horizontal_rule");

		// External / non-document actions return 'unsupported' cleanly.
		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "savepost", action: "savePost" }),
			),
		).toBe("unsupported");
		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "media", action: "media" }),
			),
		).toBe("unsupported");
	});

	it("handles Enter on fence opener, Backspace on empty code block, and Delete at end of code block", () => {
		// 1. Typing ```ts in a paragraph + Enter creates a code_block with language "ts"
		const view = createEditorView("");
		view.dispatch(view.state.tr.insertText("```ts", 1));
		setCursorAtEndOfFirstTextblock(view);
		expect(dispatchKey(view, "Enter")).toBe(true);
		expect(view.state.doc.firstChild?.type.name).toBe("code_block");
		expect(view.state.doc.firstChild?.attrs.language).toBe("ts");
		expect(view.state.doc.firstChild?.attrs.fenceChar).toBe("`");

		// 2. Backspace at start of empty code_block converts back to paragraph
		expect(dispatchKey(view, "Backspace")).toBe(true);
		expect(view.state.doc.firstChild?.type.name).toBe("paragraph");

		// 3. Typing ~~~js + Enter normalizes fenceChar to backtick
		view.dispatch(view.state.tr.insertText("~~~js", 1));
		setCursorAtEndOfFirstTextblock(view);
		expect(dispatchKey(view, "Enter")).toBe(true);
		expect(view.state.doc.firstChild?.type.name).toBe("code_block");
		expect(view.state.doc.firstChild?.attrs.language).toBe("js");
		expect(view.state.doc.firstChild?.attrs.fenceChar).toBe("`");

		// 4. Delete at end of code_block does NOT swallow the next block
		const codeAndNextView = createEditorView(
			"```ts\nconst x = 1;\n```\n\nNext paragraph",
		);
		const codeBlock = codeAndNextView.state.doc.child(0);
		const endOfCodePos = 1 + codeBlock.content.size;
		codeAndNextView.dispatch(
			codeAndNextView.state.tr.setSelection(
				TextSelection.create(codeAndNextView.state.doc, endOfCodePos),
			),
		);
		expect(dispatchKey(codeAndNextView, "Delete")).toBe(true);
		expect(codeAndNextView.state.doc.childCount).toBe(2);
		expect(codeAndNextView.state.doc.child(0).type.name).toBe("code_block");
		expect(codeAndNextView.state.doc.child(0).textContent).toBe("const x = 1;");
		expect(codeAndNextView.state.doc.child(1).type.name).toBe("paragraph");
		expect(codeAndNextView.state.doc.child(1).textContent).toBe(
			"Next paragraph",
		);
	});

	it("keeps inline code math/footnote syntax literal and handles task/list Enter and Backspace", () => {
		const literalCodeDoc = parseMarkdownToVisualDoc(
			"Code spans `$E = mc^2$`, `[^1]`, and `\\(a+b\\)` stay literal; escaped \\$5 is text.",
		);
		let protectedInlineCount = 0;
		literalCodeDoc.descendants((node) => {
			if (node.type.name === "protected_inline") {
				protectedInlineCount += 1;
			}
		});
		expect(protectedInlineCount).toBe(0);
		expect(serializeVisualDocToMarkdown(literalCodeDoc)).toContain(
			"`$E = mc^2$`",
		);
		expect(serializeVisualDocToMarkdown(literalCodeDoc)).toContain("`[^1]`");

		// Splitting a checked task item creates a new unchecked task item below it.
		const taskView = createEditorView("- [x] First task");
		// task_list (+1) -> task_item (+1) -> paragraph (+1) + "First task" (10) = 13
		taskView.dispatch(
			taskView.state.tr.setSelection(
				TextSelection.create(taskView.state.doc, 13),
			),
		);
		expect(dispatchKey(taskView, "Enter")).toBe(true);
		const taskList = taskView.state.doc.firstChild;
		expect(taskList?.type.name).toBe("task_list");
		expect(taskList?.childCount).toBe(2);
		expect(taskList?.child(0).attrs.checked).toBe(true);
		expect(taskList?.child(1).attrs.checked).toBe(false);

		// Backspace at start of a heading converts it back to a paragraph.
		const headingView = createEditorView("## Title");
		headingView.dispatch(
			headingView.state.tr.setSelection(
				TextSelection.create(headingView.state.doc, 1),
			),
		);
		expect(dispatchKey(headingView, "Backspace")).toBe(true);
		expect(headingView.state.doc.firstChild?.type.name).toBe("paragraph");

		// Direct heading1..heading6, link, image, and read-only blocked state.
		const cmdView = createEditorView("Text");
		cmdView.dispatch(
			cmdView.state.tr.setSelection(
				TextSelection.create(cmdView.state.doc, 1, 5),
			),
		);
		expect(
			executeVisualToolbarCommand(
				cmdView,
				makeToolbarCommand({ id: "h3", action: "heading3" }),
			),
		).toBe("handled");
		expect(cmdView.state.doc.firstChild?.attrs.level).toBe(3);

		expect(
			executeVisualToolbarCommand(
				cmdView,
				makeToolbarCommand({ id: "link", action: "link" }),
			),
		).toBe("handled");
		expect(serializeVisualDocToMarkdown(cmdView.state.doc)).toBe(
			"### [Text](https://)",
		);

		expect(
			executeVisualToolbarCommand(
				cmdView,
				makeToolbarCommand({
					id: "image",
					action: "image",
					prefix: "https://example.com/x.png",
				}),
			),
		).toBe("handled");
		expect(serializeVisualDocToMarkdown(cmdView.state.doc)).toContain(
			"![Text](https://example.com/x.png)",
		);

		cmdView.setProps({ editable: () => false });
		expect(
			executeVisualToolbarCommand(
				cmdView,
				makeToolbarCommand({ id: "bold", action: "bold" }),
			),
		).toBe("blocked");
	});

	it("handles atomic block Backspace selection/deletion, Tab in tables/code, and Shift-Enter", () => {
		const atomicView = createEditorView("$$\nE = mc^2\n$$\n\nAfter");
		// Cursor at start of "After" paragraph (protected_block size is 1, paragraph opens at 1, inside at 2)
		atomicView.dispatch(
			atomicView.state.tr.setSelection(
				TextSelection.create(atomicView.state.doc, 2),
			),
		);
		// First Backspace selects the protected_block atom cleanly.
		expect(dispatchKey(atomicView, "Backspace")).toBe(true);
		expect(atomicView.state.selection instanceof NodeSelection).toBe(true);
		// Second Backspace deletes the selected atomic block.
		expect(dispatchKey(atomicView, "Backspace")).toBe(true);
		expect(atomicView.state.doc.childCount).toBe(1);
		expect(atomicView.state.doc.firstChild?.textContent).toBe("After");

		// Tab inside table moves to next cell; Shift-Tab moves back.
		const tableView = createEditorView(
			"| One | Two |\n| --- | --- |\n| 1 | 2 |",
		);
		tableView.dispatch(
			tableView.state.tr.setSelection(
				TextSelection.create(tableView.state.doc, 4),
			),
		);
		expect(dispatchKey(tableView, "Tab")).toBe(true);
		const afterTabParentText =
			tableView.state.selection.$from.parent.textContent;
		expect(afterTabParentText).toBe("Two");
		expect(dispatchKey(tableView, "Tab", { shiftKey: true })).toBe(true);
		expect(tableView.state.selection.$from.parent.textContent).toBe("One");

		// Tab inside code_block inserts two spaces.
		const codeView = createEditorView("```js\nx\n```");
		codeView.dispatch(
			codeView.state.tr.setSelection(
				TextSelection.create(codeView.state.doc, 1),
			),
		);
		expect(dispatchKey(codeView, "Tab")).toBe(true);
		expect(codeView.state.doc.firstChild?.textContent).toBe("  x");

		// Shift-Enter inserts hard_break.
		const paraView = createEditorView("Hello");
		paraView.dispatch(
			paraView.state.tr.setSelection(
				TextSelection.create(paraView.state.doc, 6),
			),
		);
		expect(dispatchKey(paraView, "Enter", { shiftKey: true })).toBe(true);
		expect(paraView.state.doc.firstChild?.lastChild?.type.name).toBe(
			"hard_break",
		);
	});

	it("preserves untouched original blocks, tables, reference links, and trailing newlines on localized edits", () => {
		const original = [
			"# Heading",
			"",
			"* Bullet A",
			"* Bullet B",
			"",
			"| Name     | Score |",
			"| :------- | ----: |",
			"| Alice    |   100 |",
			"",
			"Reference [GitHub][gh] link.",
			"",
			'[gh]: https://github.com "GitHub"',
			"",
			"Final paragraph.",
			"",
		].join("\n");

		const guard = createMarkdownRoundTripGuard(original);
		const state = EditorState.create({
			doc: guard.initialDoc,
			schema: visualEditorSchema,
		});
		// Edit only the final paragraph ("Final paragraph." -> "Final paragraph!").
		const endOfLastParagraph = state.doc.content.size - 1;
		const editedDoc = state.tr.insertText("!", endOfLastParagraph).doc;
		const serialized = guard.serialize(editedDoc);

		expect(serialized).toContain("* Bullet A\n* Bullet B");
		expect(serialized).toContain("| Name     | Score |");
		expect(serialized).toContain("Reference [GitHub][gh] link.");
		expect(serialized).toContain("Final paragraph.!");
		expect(serialized.endsWith("\n")).toBe(true);
		// Restoring the baseline doc returns byte-identical original Markdown.
		expect(guard.serialize(guard.initialDoc)).toBe(original);
	});
});
