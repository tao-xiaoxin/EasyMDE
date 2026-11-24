import { readFileSync } from "node:fs";
import path from "node:path";
import { history, redo, undo } from "prosemirror-history";
import { DOMSerializer, Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { addColumnAfter, addRowAfter, tableEditing } from "prosemirror-tables";
import { EditorView } from "prosemirror-view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolbarCommand } from "../../contracts/bootstrap/toolbar-bootstrap";
import { createPreservingRoundTripGuard } from "./markdown-block-preservation";
import {
	parseImageScaleTitle,
	parseMarkdownToVisualDoc,
} from "./markdown-parser";
import {
	createMarkdownRoundTripGuard,
	serializeVisualDocToMarkdown,
} from "./markdown-serializer";
import {
	parseTableAlignComment,
	validateTableAlignEntries,
} from "./table-alignment-codec";
import {
	createVisualKeymapPlugins,
	executeVisualToolbarCommand,
} from "./visual-commands";
import { createVisualInputRulesPlugin } from "./visual-input-rules";
import {
	isValidVisualImageScale,
	sanitizeBulletMarker,
	sanitizeDomUrl,
	visualEditorSchema,
} from "./visual-schema";

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
			'<!-- easymde-table-align:v1 [[0,"center"],[1,"right"],[1,2,"left"]] -->',
			"| Col A | Col B | Col C |",
			"| :--- | :---: | ---: |",
			"| Line 1<br>Line 2 | Pipe \\| value | `npm run dev` |",
		].join("\n");

		const doc = parseMarkdownToVisualDoc(markdown);
		const tableNode = doc.firstChild;
		expect(tableNode?.type.name).toBe("table");
		expect(tableNode?.attrs.alignAnnotation).toBe(
			'<!-- easymde-table-align:v1 [[0,"center"],[1,"right"],[1,2,"left"]] -->',
		);
		// Row 0 overridden to center; row 1 overridden to right, cell 2 back to left.
		expect(tableNode?.child(0).child(0).attrs.textAlign).toBe("center");
		expect(tableNode?.child(1).child(0).attrs.textAlign).toBe("right");
		expect(tableNode?.child(1).child(2).attrs.textAlign).toBe("left");

		const serialized = serializeVisualDocToMarkdown(doc);
		expect(serialized).toContain(
			'<!-- easymde-table-align:v1 [[0,"center"],[1,"right"],[1,2,"left"]] -->',
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
		expect(serialized).toContain("[github-link]: https://github.com \"GitHub\"");
		expect(serialized).toContain("<summary>点击展开查看隐藏内容</summary>");
	});

	it("preserves paired inline HTML tags and numbered headings verbatim on round-trip", () => {
		const markdown = [
			"## 1. 标题层级",
			"## 2. 文本样式",
			"~~删除线~~、`行内代码`、<u>下划线文本</u>、<mark>高亮文本</mark>。",
			"H<sub>2</sub>O、x<sup>2</sup>、<kbd>⌘</kbd> + <kbd>K</kbd>。",
		].join("\n\n");

		const doc = parseMarkdownToVisualDoc(markdown);
		const serialized = serializeVisualDocToMarkdown(doc);
		expect(serialized).toBe(markdown);
		expect(serialized).not.toContain("1\\.");
		expect(serialized).not.toContain("\\<u>");
		expect(parseMarkdownToVisualDoc(serialized).eq(doc)).toBe(true);
	});

	it("preserves table cells across split inline HTML tags and nested inline HTML tags during edits", () => {
		const tableMd = [
			"| A | B | C |",
			"| --- | --- | --- |",
			"| <u>one | two</u> | end |",
		].join("\n");
		const tableGuard = createMarkdownRoundTripGuard(tableMd);
		const tableNode = tableGuard.initialDoc.firstChild;
		expect(tableNode?.type.name).toBe("table");
		const bodyRow = tableNode?.child(1);
		expect(bodyRow?.childCount).toBe(3);
		expect(bodyRow?.child(0).textContent).toBe("one");
		expect(bodyRow?.child(1).textContent).toBe("two");
		expect(bodyRow?.child(2).textContent).toBe("end");

		const tableView = createEditorView(tableMd);
		let endPos = -1;
		tableView.state.doc.descendants((node, pos) => {
			if (node.isText && node.text === "end") {
				endPos = pos;
				return false;
			}
			return true;
		});
		expect(endPos).toBeGreaterThan(0);
		tableView.dispatch(
			tableView.state.tr.insertText("ed", endPos + "end".length),
		);
		const editedTableMd = tableGuard.serialize(tableView.state.doc);
		expect(editedTableMd).toBe(
			["| A | B | C |", "| --- | --- | --- |", "| <u>one | two</u> | ended |"].join(
				"\n",
			),
		);

		// Nested inline HTML tags stay protected verbatim when editing the same paragraph.
		const nestedMd = "<u>nested <mark>inner</mark></u> tail";
		const nestedGuard = createMarkdownRoundTripGuard(nestedMd);
		const nestedView = createEditorView(nestedMd);
		nestedView.dispatch(
			nestedView.state.tr.insertText(
				"!",
				nestedView.state.doc.content.size - 1,
			),
		);
		expect(nestedGuard.serialize(nestedView.state.doc)).toBe(
			"<u>nested <mark>inner</mark></u> tail!",
		);

		// Pipes inside inline code spans or quoted HTML tag attributes inside a GFM
		// table row still split table cells (matching PHP GFM) and keep edits lossless.
		const codePipeTableMd = [
			"| A | B | C |",
			"| --- | --- | --- |",
			"| <u>`one | two`</u> | end |",
		].join("\n");
		const codePipeGuard = createMarkdownRoundTripGuard(codePipeTableMd);
		const codePipeRow = codePipeGuard.initialDoc.firstChild?.child(1);
		expect(codePipeRow?.childCount).toBe(3);
		expect(codePipeRow?.child(2).textContent).toBe("end");
		const codePipeView = createEditorView(codePipeTableMd);
		let codePipeEndPos = -1;
		codePipeView.state.doc.descendants((node, pos) => {
			if (node.isText && node.text === "end") {
				codePipeEndPos = pos;
				return false;
			}
			return true;
		});
		expect(codePipeEndPos).toBeGreaterThan(0);
		codePipeView.dispatch(
			codePipeView.state.tr.insertText("ed", codePipeEndPos + "end".length),
		);
		const serializedCodePipe = codePipeGuard.serialize(codePipeView.state.doc);
		expect(serializedCodePipe).toBe(
			[
				"| A | B | C |",
				"| --- | --- | --- |",
				"| <u>\\`one | two\\`</u> | ended |",
			].join("\n"),
		);
		expect(serializedCodePipe).not.toContain("\\|");
		expect(parseMarkdownToVisualDoc(serializedCodePipe).eq(codePipeView.state.doc)).toBe(
			true,
		);

		const attrPipeTableMd = [
			"| A | B | C |",
			"| --- | --- | --- |",
			'| <span title="a | b">text</span> | end |',
		].join("\n");
		const attrPipeGuard = createMarkdownRoundTripGuard(attrPipeTableMd);
		const attrPipeRow = attrPipeGuard.initialDoc.firstChild?.child(1);
		expect(attrPipeRow?.childCount).toBe(3);
		expect(attrPipeRow?.child(2).textContent).toBe("end");
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

		// Once edited, serializer emits updated Markdown and keeps the original
		// CRLF line-ending style and trailing newline while a block survives.
		const partlyEdited = parseMarkdownToVisualDoc(
			"# Edited heading\n\n*  Item 1\n*  Item 2",
		);
		expect(guard.isUnmodified(partlyEdited)).toBe(false);
		expect(guard.serialize(partlyEdited)).toBe(
			"# Edited heading\r\n\r\n*  Item 1\r\n*  Item 2\r\n",
		);
		// R4: replacing every block of a multi-block document drops the stale
		// trailing suffix instead of re-attaching it to brand-new content.
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
		// The input rule preserves the typed tilde fence character.
		expect(tildeFenceView.state.doc.firstChild?.attrs.fenceChar).toBe("~");
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
		// `code` composes with the wrapping strong/em/strike marks (P0-05).
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
			"~~***`Hello`***~~ world",
		);

		// Undo restores previous state, Redo reapplies it.
		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "undo", action: "undo" }),
			),
		).toBe("handled");
		expect(serializeVisualDocToMarkdown(view.state.doc)).not.toBe(
			"~~***`Hello`***~~ world",
		);
		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "redo", action: "redo" }),
			),
		).toBe("handled");
		expect(serializeVisualDocToMarkdown(view.state.doc)).toBe(
			"~~***`Hello`***~~ world",
		);

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

		// 3. Typing ~~~js + Enter preserves the typed tilde fenceChar
		view.dispatch(view.state.tr.insertText("~~~js", 1));
		setCursorAtEndOfFirstTextblock(view);
		expect(dispatchKey(view, "Enter")).toBe(true);
		expect(view.state.doc.firstChild?.type.name).toBe("code_block");
		expect(view.state.doc.firstChild?.attrs.language).toBe("js");
		expect(view.state.doc.firstChild?.attrs.fenceChar).toBe("~");

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

	it("preserves original *, +, and - markers on bullet lists and task lists when edited", () => {
		expect(sanitizeBulletMarker("*")).toBe("*");
		expect(sanitizeBulletMarker("+")).toBe("+");
		expect(sanitizeBulletMarker("-")).toBe("-");
		expect(sanitizeBulletMarker("•")).toBe("-");
		expect(sanitizeBulletMarker(null)).toBe("-");

		// 1. Toggling a task checkbox inside a `* [ ]` task list preserves `* [x]`.
		const taskSource = [
			"* [x] Done task",
			"* [ ] Pending task",
			"* [ ] Third task",
		].join("\n");
		const taskGuard = createMarkdownRoundTripGuard(taskSource);
		const taskState = EditorState.create({
			doc: taskGuard.initialDoc,
			schema: visualEditorSchema,
		});
		const taskListNode = taskState.doc.firstChild;
		expect(taskListNode?.type.name).toBe("task_list");
		expect(taskListNode?.attrs.marker).toBe("*");

		// Second task item position: task_list (+1) + first task_item nodeSize.
		const secondTaskItemPos = 1 + (taskListNode?.child(0).nodeSize ?? 0);
		const toggledDoc = taskState.tr.setNodeMarkup(
			secondTaskItemPos,
			undefined,
			{ checked: true },
		).doc;
		expect(taskGuard.serialize(toggledDoc)).toBe(
			["* [x] Done task", "* [x] Pending task", "* [ ] Third task"].join("\n"),
		);

		// 2. Editing a `* ` or `+ ` bullet list preserves its original marker,
		//    while toolbar-created lists default to `-` and DOM HTML stays clean.
		const starView = createEditorView("* Alpha\n* Beta");
		expect(starView.state.doc.firstChild?.attrs.marker).toBe("*");
		// bullet_list (+1) -> list_item (+1) -> paragraph (+1) + "Alpha" (5) = 8
		starView.dispatch(starView.state.tr.insertText("!", 8));
		expect(serializeVisualDocToMarkdown(starView.state.doc)).toBe(
			"* Alpha!\n* Beta",
		);
		expect(serializeDomHtml(starView.state.doc).innerHTML).toBe(
			"<ul><li><p>Alpha!</p></li><li><p>Beta</p></li></ul>",
		);

		// Converting `* ` bullet list to task list via toolbar keeps `*`.
		starView.dispatch(
			starView.state.tr.setSelection(
				TextSelection.create(starView.state.doc, 3),
			),
		);
		expect(
			executeVisualToolbarCommand(
				starView,
				makeToolbarCommand({ id: "tasklist", action: "taskList" }),
			),
		).toBe("handled");
		expect(serializeVisualDocToMarkdown(starView.state.doc)).toBe(
			"* [ ] Alpha!\n* [ ] Beta",
		);

		const plusView = createEditorView("+ First\n+ Second");
		expect(plusView.state.doc.firstChild?.attrs.marker).toBe("+");
		plusView.dispatch(plusView.state.tr.insertText(" edited", 8));
		expect(serializeVisualDocToMarkdown(plusView.state.doc)).toBe(
			"+ First edited\n+ Second",
		);

		const toolbarListView = createEditorView("Fresh item");
		toolbarListView.dispatch(
			toolbarListView.state.tr.setSelection(
				TextSelection.create(toolbarListView.state.doc, 1),
			),
		);
		expect(
			executeVisualToolbarCommand(
				toolbarListView,
				makeToolbarCommand({ id: "unorderedlist", action: "unorderedList" }),
			),
		).toBe("handled");
		expect(toolbarListView.state.doc.firstChild?.attrs.marker).toBe("-");
		expect(serializeVisualDocToMarkdown(toolbarListView.state.doc)).toBe(
			"- Fresh item",
		);
	});

	it("captures exact typed *, +, and - list markers in input rules", () => {
		const starInputView = createEditorView("");
		typeText(starInputView, "* item");
		expect(starInputView.state.doc.firstChild?.type.name).toBe("bullet_list");
		expect(starInputView.state.doc.firstChild?.attrs.marker).toBe("*");
		expect(serializeVisualDocToMarkdown(starInputView.state.doc)).toBe(
			"* item",
		);

		const plusInputView = createEditorView("");
		typeText(plusInputView, "+ item");
		expect(plusInputView.state.doc.firstChild?.type.name).toBe("bullet_list");
		expect(plusInputView.state.doc.firstChild?.attrs.marker).toBe("+");
		expect(serializeVisualDocToMarkdown(plusInputView.state.doc)).toBe(
			"+ item",
		);

		// Typing `* ` then `[x] ` upgrades to a `*` task list preserving `*`.
		const starTaskInputView = createEditorView("");
		typeText(starTaskInputView, "* [x] Shipped");
		expect(starTaskInputView.state.doc.firstChild?.type.name).toBe("task_list");
		expect(starTaskInputView.state.doc.firstChild?.attrs.marker).toBe("*");
		expect(serializeVisualDocToMarkdown(starTaskInputView.state.doc)).toBe(
			"* [x] Shipped",
		);
	});
});

function collectProtectedInlineRaws(doc: ProseMirrorNode): string[] {
	const raws: string[] = [];
	doc.descendants((node) => {
		if (node.type.name === "protected_inline") {
			raws.push(String(node.attrs.rawMarkdown));
		}
		return true;
	});
	return raws;
}

function collectMarkNames(doc: ProseMirrorNode, textToFind: string): string[] {
	let found: string[] = [];
	doc.descendants((node) => {
		if (found.length === 0 && node.isText && node.text === textToFind) {
			found = node.marks.map((mark) => mark.type.name);
		}
		return true;
	});
	return found;
}

function firstLinkHref(doc: ProseMirrorNode): string | null {
	let href: string | null = null;
	doc.descendants((node) => {
		if (href !== null || !node.isText) return true;
		const link = node.marks.find((mark) => mark.type.name === "link");
		if (link) href = String(link.attrs.href);
		return true;
	});
	return href;
}

function countOccurrences(text: string, needle: string): number {
	let count = 0;
	let index = text.indexOf(needle);
	while (index >= 0) {
		count += 1;
		index = text.indexOf(needle, index + needle.length);
	}
	return count;
}

describe("visual editor codec regressions", () => {
	it("P0-01 sanitizes unsafe DOM URLs and pasted protected attributes", () => {
		expect(
			sanitizeDomUrl("data:text/html,<script>alert(1)</script>"),
		).toBeNull();
		expect(
			sanitizeDomUrl(
				"data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
			),
		).toBeNull();
		expect(
			sanitizeDomUrl("data:image/svg+xml,<svg onload=alert(1)>"),
		).toBeNull();
		expect(sanitizeDomUrl("java\tscript:alert(1)")).toBeNull();
		expect(sanitizeDomUrl("java\nscript:alert(1)")).toBeNull();
		expect(sanitizeDomUrl("\u0001javascript:alert(1)")).toBeNull();
		expect(sanitizeDomUrl("vb\tscript:msgbox(1)")).toBeNull();

		expect(sanitizeDomUrl("https://example.com/a?b=1")).toBe(
			"https://example.com/a?b=1",
		);
		expect(sanitizeDomUrl("#fragment")).toBe("#fragment");
		expect(sanitizeDomUrl("./images/a.png")).toBe("./images/a.png");
		expect(sanitizeDomUrl("mailto:someone@example.com")).toBe(
			"mailto:someone@example.com",
		);
		expect(sanitizeDomUrl("tel:+1234567890")).toBe("tel:+1234567890");
		expect(sanitizeDomUrl("/relative/path")).toBe("/relative/path");

		const rasterDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
		expect(sanitizeDomUrl(rasterDataUrl)).toBeNull();
		expect(sanitizeDomUrl(rasterDataUrl, { allowImageDataUrl: true })).toBe(
			rasterDataUrl,
		);

		const unsafeDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.paragraph.create(null, [
				visualEditorSchema.text("click", [
					visualEditorSchema.marks.link.create({
						href: "data:text/html,<script>alert(1)</script>",
						title: null,
					}),
				]),
				visualEditorSchema.nodes.image.create({
					src: "data:image/svg+xml,<svg onload=alert(1)>",
					alt: "x",
					title: null,
					scale: null,
				}),
			]),
		]);
		const dom = serializeDomHtml(unsafeDoc);
		expect(dom.querySelector("a")?.getAttribute("href")).toBeNull();
		expect(dom.querySelector("img")?.getAttribute("src")).toBe("");
	});

	it("P0-02 never leaks EASYMDEPH sentinels into nodes, attributes or code", () => {
		const vectors = [
			'> ```js\n> const price = "$10 and $20";\n> const note = "[^1]";\n> // <!-- c -->\n> ```',
			'- Outer\n  - Inner\n    ```js\n    const p = "$10 and $20";\n    const r = "[^1]";\n    ```',
			'# Title\n    const price = "$10 and $20";',
			"```\nfoo\n```\n    indented $a$ and $b$",
			'![$E=mc^2$](https://example.com/$a/$b.png "Cost $10 and $20")',
			'[Click](https://example.com/$a/$b "Note [^1]")',
		];
		for (const markdown of vectors) {
			const doc = parseMarkdownToVisualDoc(markdown);
			expect(JSON.stringify(doc.toJSON())).not.toContain("EASYMDEPH");
			const serialized = serializeVisualDocToMarkdown(doc);
			expect(serialized).not.toContain("EASYMDEPH");
			expect(parseMarkdownToVisualDoc(serialized).eq(doc)).toBe(true);
		}

		const quotedCode = parseMarkdownToVisualDoc(
			'> ```js\n> const price = "$10 and $20";\n> ```',
		);
		let quotedCodeText = "";
		quotedCode.descendants((node) => {
			if (node.type.name === "code_block") quotedCodeText = node.textContent;
			return true;
		});
		expect(quotedCodeText).toBe('const price = "$10 and $20";');

		const image = parseMarkdownToVisualDoc(
			'![$E=mc^2$](https://example.com/$a/$b.png "Cost $10 and $20")',
		).firstChild?.firstChild;
		expect(image?.attrs.src).toBe("https://example.com/$a/$b.png");
		expect(image?.attrs.alt).toBe("$E=mc^2$");
		expect(image?.attrs.title).toBe("Cost $10 and $20");

		const linkHref = firstLinkHref(
			parseMarkdownToVisualDoc(
				'[Click](https://example.com/$a/$b "Note [^1]")',
			),
		);
		expect(linkHref).toBe("https://example.com/$a/$b");
	});

	it("P0-03 never duplicates a mixed task/bullet list on an unrelated edit", () => {
		const original = "# Heading\n\n- [x] Task\n- Regular\n\nNext paragraph\n";
		const guard = createMarkdownRoundTripGuard(original);
		const state = EditorState.create({
			doc: guard.initialDoc,
			schema: visualEditorSchema,
		});
		// Heading text "Heading" spans 1..8; append "!" at its end.
		const editedDoc = state.tr.insertText("!", 8).doc;
		const serialized = guard.serialize(editedDoc);

		expect(serialized).toContain("# Heading!");
		expect(serialized).toContain("- [x] Task");
		expect(serialized).toContain("Next paragraph");
		expect(countOccurrences(serialized, "- Regular")).toBe(1);
		expect(countOccurrences(serialized, "- [x] Task")).toBe(1);
		expect(parseMarkdownToVisualDoc(serialized).textContent).toContain("Task");
	});

	it("P0-04 accepts only PHP-valid easymde-table-align annotations", () => {
		const valid =
			'<!-- easymde-table-align:v1 [[0,"center"],[1,"right"],[1,2,"left"]] -->\n' +
			"| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |";
		const validDoc = parseMarkdownToVisualDoc(valid);
		const validTable = validDoc.firstChild;
		expect(validTable?.attrs.alignAnnotation).toBe(
			'<!-- easymde-table-align:v1 [[0,"center"],[1,"right"],[1,2,"left"]] -->',
		);
		expect(validTable?.child(0).child(0).attrs.textAlign).toBe("center");
		expect(validTable?.child(1).child(0).attrs.textAlign).toBe("right");
		expect(validTable?.child(1).child(2).attrs.textAlign).toBe("left");
		expect(serializeVisualDocToMarkdown(validDoc)).toBe(valid);

		const invalidCases = [
			// Cell override without a row override (PHP: entry-redundant).
			'<!-- easymde-table-align:v1 [[1,1,"center"]] -->\n| A | B |\n| :--- | :---: |\n| 1 | 2 |',
			// Out-of-bounds row (PHP: entry-invalid).
			'<!-- easymde-table-align:v1 [[5,"center"]] -->\n| A | B |\n| :--- | :---: |\n| 1 | 2 |',
			// Redundant row override equal to the base alignment.
			'<!-- easymde-table-align:v1 [[0,"left"]] -->\n| A | B |\n| :--- | :--- |\n| 1 | 2 |',
			// Entries out of order (PHP: entry-order-invalid).
			'<!-- easymde-table-align:v1 [[1,"right"],[0,"center"]] -->\n| A | B |\n| :--- | ---: |\n| 1 | 2 |',
		];
		for (const markdown of invalidCases) {
			const doc = parseMarkdownToVisualDoc(markdown);
			const table = doc.firstChild;
			expect(table?.attrs.alignAnnotation).toBeNull();
			expect(serializeVisualDocToMarkdown(doc)).not.toContain(
				"easymde-table-align",
			);
		}

		const derivedDoc = parseMarkdownToVisualDoc(
			"| A | B |\n| :--- | :--- |\n| 1 | 2 |",
		);
		const table = derivedDoc.firstChild;
		if (!table) throw new Error("missing table");
		const centerCell = table.child(1).child(1);
		const centered = table.type.create(table.attrs, [
			table.child(0),
			table
				.child(1)
				.type.create(table.child(1).attrs, [
					table.child(1).child(0),
					centerCell.type.create(
						{ ...centerCell.attrs, textAlign: "center" },
						centerCell.content,
					),
				]),
		]);
		const serialized = serializeVisualDocToMarkdown(
			visualEditorSchema.nodes.doc.create(null, [centered]),
		);
		const annotationLine = serialized.split("\n")[0] ?? "";
		expect(annotationLine).toContain("easymde-table-align");
		const entries = parseTableAlignComment(annotationLine);
		expect(entries).not.toBeNull();
		expect(
			validateTableAlignEntries(entries ?? [], {
				baseAlignments: ["left", "left"],
				cellAlignments: [
					["left", "left"],
					["left", "center"],
				],
				columnCount: 2,
				rowCount: 2,
			}),
		).toBe(true);
	});

	it("P0-05 composes the code mark with link, strong, em, and strike", () => {
		const cases = [
			"[`Array.map()`](https://developer.mozilla.org/)",
			"[See `foo()` docs](https://example.com)",
			"**`npm install`** *`foo`* ~~`bar`~~",
			"**bold `code` bold**",
			"*italic `code` italic*",
		];
		for (const markdown of cases) {
			const doc = parseMarkdownToVisualDoc(markdown);
			const serialized = serializeVisualDocToMarkdown(doc);
			expect(parseMarkdownToVisualDoc(serialized).eq(doc)).toBe(true);
			expect(serialized).toContain("`");
		}

		const linkedCode = parseMarkdownToVisualDoc(
			"[`Array.map()`](https://developer.mozilla.org/)",
		);
		expect(collectMarkNames(linkedCode, "Array.map()")).toEqual([
			"link",
			"code",
		]);
		expect(serializeVisualDocToMarkdown(linkedCode)).toBe(
			"[`Array.map()`](https://developer.mozilla.org/)",
		);
	});

	it("P0-06 detects GFM table rows structurally and protects inline math", () => {
		const mathDoc = parseMarkdownToVisualDoc(
			"Compute $|x| = 1$ and $P(A | B)$",
		);
		expect(collectProtectedInlineRaws(mathDoc)).toEqual([
			"$|x| = 1$",
			"$P(A | B)$",
		]);
		expect(serializeVisualDocToMarkdown(mathDoc)).toBe(
			"Compute $|x| = 1$ and $P(A | B)$",
		);

		const currencyDoc = parseMarkdownToVisualDoc("Price is $10 and $20.");
		expect(collectProtectedInlineRaws(currencyDoc)).toEqual([]);
		const currencySerialized = serializeVisualDocToMarkdown(currencyDoc);
		expect(currencySerialized).toContain("\\$10");
		expect(parseMarkdownToVisualDoc(currencySerialized).eq(currencyDoc)).toBe(
			true,
		);

		const displayDoc = parseMarkdownToVisualDoc("Formula: $$a$$ and $b$");
		expect(collectProtectedInlineRaws(displayDoc)).toEqual(["$$a$$", "$b$"]);

		const emptyDisplay = parseMarkdownToVisualDoc(
			"$$$$\n\nImportant paragraph\n\n$$\nE = mc^2\n$$",
		);
		expect(emptyDisplay.textContent).toContain("Important paragraph");
		let emptyDisplayMathBlocks = 0;
		emptyDisplay.descendants((node) => {
			if (node.type.name === "protected_block" && node.attrs.kind === "math") {
				emptyDisplayMathBlocks += 1;
			}
			return true;
		});
		expect(emptyDisplayMathBlocks).toBe(1);
		expect(
			parseMarkdownToVisualDoc(serializeVisualDocToMarkdown(emptyDisplay)).eq(
				emptyDisplay,
			),
		).toBe(true);

		const unclosed = parseMarkdownToVisualDoc("$$\nx = 1\n\n```tex\n$$\n```");
		let unclosedCodeBlocks = 0;
		let unclosedMathBlocks = 0;
		unclosed.descendants((node) => {
			if (node.type.name === "code_block") unclosedCodeBlocks += 1;
			if (node.type.name === "protected_block" && node.attrs.kind === "math") {
				unclosedMathBlocks += 1;
			}
			return true;
		});
		expect(unclosedMathBlocks).toBe(0);
		expect(unclosedCodeBlocks).toBe(1);
		expect(unclosed.textContent).toContain("$$\nx = 1");

		const tableDoc = parseMarkdownToVisualDoc(
			"| Item | A | B |\n| --- | --- | --- |\n| x | $10 | $20 |",
		);
		const tableNode = tableDoc.firstChild;
		expect(tableNode?.type.name).toBe("table");
		expect(tableNode?.child(0).childCount).toBe(3);
		expect(tableNode?.child(1).childCount).toBe(3);
		expect(collectProtectedInlineRaws(tableDoc)).toEqual([]);
	});

	it("P0-07 escapes literal Markdown punctuation without corrupting prose", () => {
		const escapedInputs = [
			"\\# Not heading",
			"\\- Not list",
			"1\\. Not ordered",
			"\\> Not quote",
			"\\*not em\\* and \\`not code\\` and \\~\\~not s\\~\\~",
			"\\\\slash",
			"\\<div\\> and &lt;tag&gt;",
			"Cost is \\$10 and \\$20.",
			"[a\\]b](https://example.com)",
			"## C \\#",
		];
		for (const markdown of escapedInputs) {
			const doc = parseMarkdownToVisualDoc(markdown);
			const serialized = serializeVisualDocToMarkdown(doc);
			expect(parseMarkdownToVisualDoc(serialized).eq(doc)).toBe(true);
		}

		expect(
			serializeVisualDocToMarkdown(parseMarkdownToVisualDoc("\\# Not heading")),
		).toBe("\\# Not heading");
		expect(
			serializeVisualDocToMarkdown(
				parseMarkdownToVisualDoc("1\\. Not ordered"),
			),
		).toBe("1\\. Not ordered");
		expect(
			serializeVisualDocToMarkdown(parseMarkdownToVisualDoc("\\> Not quote")),
		).toBe("\\> Not quote");
		expect(
			serializeVisualDocToMarkdown(
				parseMarkdownToVisualDoc("\\*not em\\* \\`not code\\`"),
			),
		).toBe("\\*not em\\* \\`not code\\`");
		expect(
			serializeVisualDocToMarkdown(
				parseMarkdownToVisualDoc("Cost is \\$10 and \\$20."),
			),
		).toBe("Cost is \\$10 and \\$20.");
		expect(
			serializeVisualDocToMarkdown(parseMarkdownToVisualDoc("## C \\#")),
		).toBe("## C \\#");
		expect(
			serializeVisualDocToMarkdown(
				parseMarkdownToVisualDoc("[a\\]b](https://example.com)"),
			),
		).toBe("[a\\]b](https://example.com)");

		const prose = "你好，世界！Hello (world). 100% — “quotes”";
		expect(serializeVisualDocToMarkdown(parseMarkdownToVisualDoc(prose))).toBe(
			prose,
		);
	});

	it("P1-01 keeps link and emphasis marks across protected_inline atoms", () => {
		const markdown =
			"**Formula $E = mc^2$ here** and [click $x^2$ now](https://example.com)";
		const doc = parseMarkdownToVisualDoc(markdown);
		const markSets: string[][] = [];
		doc.descendants((node) => {
			if (node.type.name === "protected_inline") {
				markSets.push(node.marks.map((mark) => mark.type.name));
			}
			return true;
		});
		expect(markSets).toEqual([["strong"], ["link"]]);
		const serialized = serializeVisualDocToMarkdown(doc);
		expect(serialized).toBe(markdown);
		expect(parseMarkdownToVisualDoc(serialized).eq(doc)).toBe(true);
	});

	it("P1-02 round-trips table-cell pipes, math, titles, and escaped <br>", () => {
		const cases = [
			"| Formula | Val |\n| --- | --- |\n| $a \\| b$ | 1 |",
			'| [x](https://a.com/a "T\\|1") | B |\n| --- | --- |\n| 1 | 2 |',
			"| a\\\\\\|b | c |\n| --- | --- |\n| 1 | 2 |",
			"| A \\<br\\> B | C |\n| --- | --- |\n| 1 | 2 |",
		];
		for (const markdown of cases) {
			const doc = parseMarkdownToVisualDoc(markdown);
			const serialized = serializeVisualDocToMarkdown(doc);
			expect(parseMarkdownToVisualDoc(serialized).eq(doc)).toBe(true);
			expect(parseMarkdownToVisualDoc(serialized).firstChild?.type.name).toBe(
				"table",
			);
		}

		expect(
			serializeVisualDocToMarkdown(
				parseMarkdownToVisualDoc(cases[0] as string),
			),
		).toContain("$a \\| b$");
		expect(
			serializeVisualDocToMarkdown(
				parseMarkdownToVisualDoc(cases[1] as string),
			),
		).toContain('"T\\|1"');

		const escapedBreak = parseMarkdownToVisualDoc(cases[3] as string);
		let hardBreaks = 0;
		escapedBreak.descendants((node) => {
			if (node.type.name === "hard_break") hardBreaks += 1;
			return true;
		});
		expect(hardBreaks).toBe(0);
		expect(escapedBreak.textContent).toContain("<br>");
		expect(serializeVisualDocToMarkdown(escapedBreak)).toContain("\\<br>");
	});

	it("P1-03 nests marks by span and trims boundary whitespace", () => {
		const cases = [
			"*hello **world***",
			"**hello [link](https://a.com)**",
			"*italic **bold** italic*",
			"**bold [link](https://example.com) bold**",
		];
		for (const markdown of cases) {
			const doc = parseMarkdownToVisualDoc(markdown);
			const serialized = serializeVisualDocToMarkdown(doc);
			expect(parseMarkdownToVisualDoc(serialized).eq(doc)).toBe(true);
			expect(serialized).not.toContain("****");
		}

		const spaceDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.paragraph.create(null, [
				visualEditorSchema.text("hello "),
				visualEditorSchema.text("bold ", [
					visualEditorSchema.marks.strong.create(),
				]),
				visualEditorSchema.text("world"),
			]),
		]);
		const serialized = serializeVisualDocToMarkdown(spaceDoc);
		expect(serialized).toBe("hello **bold** world");
		const reparsed = parseMarkdownToVisualDoc(serialized).firstChild;
		expect(reparsed?.textContent).toBe("hello bold world");
		expect(
			collectMarkNames(parseMarkdownToVisualDoc(serialized), "bold"),
		).toEqual(["strong"]);
	});

	it("P1-04 keeps list items that start with code, quote, or heading blocks", () => {
		const cases = [
			"- ```js\n  const x = 1;\n  ```",
			"- > Quoted inside list",
			"- # Heading in list",
		];
		for (const markdown of cases) {
			const doc = parseMarkdownToVisualDoc(markdown);
			const serialized = serializeVisualDocToMarkdown(doc);
			expect(serialized).not.toContain("-\n\n");
			expect(parseMarkdownToVisualDoc(serialized).eq(doc)).toBe(true);
		}
		expect(
			serializeVisualDocToMarkdown(
				parseMarkdownToVisualDoc(cases[0] as string),
			),
		).toBe("-\n  ```js\n  const x = 1;\n  ```");
	});

	it("P1-05 protects blocks inside lists and blockquotes", () => {
		const mathInList = "- Item\n\n  $$\n  E = mc^2\n  $$";
		const listDoc = parseMarkdownToVisualDoc(mathInList);
		let mathBlocksInList = 0;
		listDoc.firstChild?.child(0).forEach((node) => {
			if (node.type.name === "protected_block" && node.attrs.kind === "math") {
				mathBlocksInList += 1;
			}
		});
		expect(mathBlocksInList).toBe(1);
		expect(
			parseMarkdownToVisualDoc(serializeVisualDocToMarkdown(listDoc)).eq(
				listDoc,
			),
		).toBe(true);

		const orderedContinuation =
			"10. First para\n\n    Second para with $E = mc^2$ and [^1]";
		const orderedDoc = parseMarkdownToVisualDoc(orderedContinuation);
		expect(collectProtectedInlineRaws(orderedDoc)).toEqual([
			"$E = mc^2$",
			"[^1]",
		]);
		expect(
			parseMarkdownToVisualDoc(serializeVisualDocToMarkdown(orderedDoc)).eq(
				orderedDoc,
			),
		).toBe(true);

		const quotedMath = "> $$\n> E = mc^2\n> $$";
		const quotedDoc = parseMarkdownToVisualDoc(quotedMath);
		const quotedBlock = quotedDoc.firstChild?.firstChild;
		expect(quotedBlock?.type.name).toBe("protected_block");
		expect(quotedBlock?.attrs.kind).toBe("math");
		expect(serializeVisualDocToMarkdown(quotedDoc)).toBe(quotedMath);
		expect(
			parseMarkdownToVisualDoc(serializeVisualDocToMarkdown(quotedDoc)).eq(
				quotedDoc,
			),
		).toBe(true);

		const quotedTable =
			'> <!-- easymde-table-align:v1 [[0,"center"]] -->\n' +
			"> | A | B |\n> | :--- | ---: |\n> | 1 | 2 |";
		const quotedTableDoc = parseMarkdownToVisualDoc(quotedTable);
		const quotedTableNode = quotedTableDoc.firstChild?.firstChild;
		expect(quotedTableNode?.type.name).toBe("table");
		expect(quotedTableNode?.attrs.alignAnnotation).toBe(
			'<!-- easymde-table-align:v1 [[0,"center"]] -->',
		);
		expect(
			parseMarkdownToVisualDoc(serializeVisualDocToMarkdown(quotedTableDoc)).eq(
				quotedTableDoc,
			),
		).toBe(true);
	});

	it("P1-08 handles hard breaks in headings, links, runs, and at block end", () => {
		const headingDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.heading.create({ level: 2 }, [
				visualEditorSchema.text("Title"),
				visualEditorSchema.nodes.hard_break.create(),
				visualEditorSchema.text("Sub"),
			]),
		]);
		const headingSerialized = serializeVisualDocToMarkdown(headingDoc);
		expect(headingSerialized).toBe("## Title Sub");
		expect(
			parseMarkdownToVisualDoc(headingSerialized).firstChild?.type.name,
		).toBe("heading");

		const runsDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.paragraph.create(null, [
				visualEditorSchema.text("A"),
				visualEditorSchema.nodes.hard_break.create(),
				visualEditorSchema.nodes.hard_break.create(),
				visualEditorSchema.text("B"),
			]),
		]);
		const runsSerialized = serializeVisualDocToMarkdown(runsDoc);
		expect(runsSerialized).toBe("A\\\n\\\nB");
		expect(parseMarkdownToVisualDoc(runsSerialized).eq(runsDoc)).toBe(true);

		const linkedBreak = "[Line 1\\\nLine 2](https://example.com)";
		const linkedDoc = parseMarkdownToVisualDoc(linkedBreak);
		const linkedSerialized = serializeVisualDocToMarkdown(linkedDoc);
		expect(linkedSerialized).toBe(linkedBreak);
		expect(countOccurrences(linkedSerialized, "@@")).toBe(0);
		expect(firstLinkHref(linkedDoc)).toBe("https://example.com");

		const trailingDoc = parseMarkdownToVisualDoc("Hello  \n");
		expect(trailingDoc.firstChild?.lastChild?.text).toBe("Hello");
		const trailingBuilt = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.paragraph.create(null, [
				visualEditorSchema.text("Hello"),
				visualEditorSchema.nodes.hard_break.create(),
			]),
		]);
		expect(serializeVisualDocToMarkdown(trailingBuilt)).toBe("Hello");
	});

	it("P1-09 uses CommonMark first-wins reference definitions", () => {
		const duplicate =
			"See [foo][foo].\n\n[foo]: https://first.example\n[foo]: https://second.example";
		const duplicateDoc = parseMarkdownToVisualDoc(duplicate);
		expect(firstLinkHref(duplicateDoc)).toBe("https://first.example");
		const duplicateSerialized = serializeVisualDocToMarkdown(duplicateDoc);
		expect(duplicateSerialized).toContain("[foo]: https://first.example");
		expect(duplicateSerialized).toContain("[foo]: https://second.example");

		const interrupt =
			"Paragraph line\n[foo]: https://example.com\n\nUse [foo].";
		const interruptDoc = parseMarkdownToVisualDoc(interrupt);
		expect(firstLinkHref(interruptDoc)).toBeNull();
		expect(interruptDoc.textContent).toContain("[foo]: https://example.com");

		const multiLine =
			'See [foo][foo].\n\n[foo]:\n  https://example.com\n  "Title"';
		const multiLineDoc = parseMarkdownToVisualDoc(multiLine);
		expect(firstLinkHref(multiLineDoc)).toBe("https://example.com");
		const multiLineSerialized = serializeVisualDocToMarkdown(multiLineDoc);
		expect(multiLineSerialized).toContain(
			'[foo]:\n  https://example.com\n  "Title"',
		);
	});

	it("P1-10 formats angle-bracket destinations and a single image scale marker", () => {
		const destinationDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.paragraph.create(null, [
				visualEditorSchema.text("click", [
					visualEditorSchema.marks.link.create({
						href: "https://example.com/?a=<1>&b=(2)",
						title: null,
					}),
				]),
			]),
		]);
		const destinationSerialized = serializeVisualDocToMarkdown(destinationDoc);
		expect(destinationSerialized).toContain("%3C");
		expect(destinationSerialized).toContain("%3E");
		const reparsedDestination = parseMarkdownToVisualDoc(destinationSerialized);
		expect(firstLinkHref(reparsedDestination)).toBe(
			"https://example.com/?a=%3C1%3E&b=(2)",
		);

		const imageDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.paragraph.create(null, [
				visualEditorSchema.nodes.image.create({
					src: "https://example.com/a.png",
					alt: "img",
					title: "See {width=foo}",
					scale: 50,
				}),
			]),
		]);
		const imageSerialized = serializeVisualDocToMarkdown(imageDoc);
		expect(countOccurrences(imageSerialized, "{width=")).toBe(1);
		expect(imageSerialized).toContain("{width=50%}");
		const reparsedImage =
			parseMarkdownToVisualDoc(imageSerialized).firstChild?.firstChild;
		expect(reparsedImage?.attrs.scale).toBe(50);
		expect(reparsedImage?.attrs.title).toBe("See");

		const invalidScale = parseMarkdownToVisualDoc(
			'![img](https://example.com/a.png "Photo {width=42%}")',
		);
		const invalidSerialized = serializeVisualDocToMarkdown(invalidScale);
		expect(invalidSerialized).not.toContain("{width=42%}");
		expect(invalidSerialized).toContain('"Photo"');
	});

	it("P2-01 preserves CRLF, trailing newlines, and reordered untouched blocks", () => {
		const crlf = "# Title\r\n\r\nUntouched body\r\n\r\nFooter\r\n";
		const crlfGuard = createMarkdownRoundTripGuard(crlf);
		const crlfState = EditorState.create({
			doc: crlfGuard.initialDoc,
			schema: visualEditorSchema,
		});
		const crlfEdited = crlfState.tr.insertText(
			"!",
			crlfState.doc.content.size - 1,
		).doc;
		const crlfSerialized = crlfGuard.serialize(crlfEdited);
		expect(crlfSerialized).toBe(
			"# Title\r\n\r\nUntouched body\r\n\r\nFooter!\r\n",
		);
		expect(crlfSerialized.replace(/\r\n/g, "")).not.toContain("\n");

		const singleGuard = createMarkdownRoundTripGuard("Hello world\n");
		const singleState = EditorState.create({
			doc: singleGuard.initialDoc,
			schema: visualEditorSchema,
		});
		const singleEdited = singleState.tr.insertText(
			"!",
			singleState.doc.content.size - 1,
		).doc;
		expect(singleGuard.serialize(singleEdited)).toBe("Hello world!\n");

		const reorderSource =
			"* A\n\n| X    | Y |\n| :--- | - |\n| 1    | 2 |\n\nTitle\n-----\n\nFooter";
		const reorderGuard = createMarkdownRoundTripGuard(reorderSource);
		const baseline = reorderGuard.initialDoc;
		const moved = baseline.type.create(baseline.attrs, [
			baseline.child(3),
			baseline.child(0),
			baseline.child(1),
			baseline.child(2),
		]);
		const movedSerialized = reorderGuard.serialize(moved);
		expect(movedSerialized.startsWith("Footer")).toBe(true);
		expect(movedSerialized).toContain("* A");
		expect(movedSerialized).toContain("| X    | Y |");
		expect(movedSerialized).toContain("| 1    | 2 |");
		expect(movedSerialized).toContain("Title\n-----");
	});

	it("P2-02 preserves ordered delimiters, start 0, loose lists, and blank code lines", () => {
		const twoLists = parseMarkdownToVisualDoc("1. First\n1) Second");
		expect(twoLists.childCount).toBe(2);
		expect(twoLists.child(0).attrs.delimiter).toBe(".");
		expect(twoLists.child(1).attrs.delimiter).toBe(")");
		const twoListsSerialized = serializeVisualDocToMarkdown(twoLists);
		expect(twoListsSerialized).toBe("1. First\n\n1) Second");
		expect(parseMarkdownToVisualDoc(twoListsSerialized).childCount).toBe(2);

		const zeroBased = parseMarkdownToVisualDoc("0. Zero\n1. One");
		expect(zeroBased.firstChild?.attrs.order).toBe(0);
		expect(serializeVisualDocToMarkdown(zeroBased)).toBe("0. Zero\n1. One");

		const loose = parseMarkdownToVisualDoc("- Item 1\n\n- Item 2\n\n- Item 3");
		expect(loose.firstChild?.attrs.tight).toBe(false);
		expect(serializeVisualDocToMarkdown(loose)).toBe(
			"- Item 1\n\n- Item 2\n\n- Item 3",
		);

		const blankCode = "```js\n\n```";
		const blankCodeDoc = parseMarkdownToVisualDoc(blankCode);
		expect(blankCodeDoc.firstChild?.textContent).toBe("\n");
		expect(serializeVisualDocToMarkdown(blankCodeDoc)).toBe(blankCode);
		expect(parseMarkdownToVisualDoc(blankCode).eq(blankCodeDoc)).toBe(true);
	});
});

describe("Wave 5-Fix-B2 untouched list-item and trailing-suffix preservation", () => {
	const addStrongTo = (
		guard: ReturnType<typeof createMarkdownRoundTripGuard>,
		text: string,
	): ProseMirrorNode => {
		let from = -1;
		guard.initialDoc.descendants((node, pos) => {
			if (from < 0 && node.isText && node.text === text) from = pos;
			return from < 0;
		});
		expect(from).toBeGreaterThanOrEqual(0);
		const state = EditorState.create({
			doc: guard.initialDoc,
			schema: visualEditorSchema,
		});
		return state.tr.addMark(
			from,
			from + text.length,
			visualEditorSchema.marks.strong.create(),
		).doc;
	};

	// Audit G #21/#27: tight siblings, blank lines before nested sublists.
	const looseNested =
		"### Lists\n\n* Frontend\n* Backend\n\n  * Python\n  * Node.js\n  * Go\n* Ops\n\n  * Docker\n  * Nginx\n  * Kubernetes\n\n### Next\n";

	it("B2 edits one top-level item without touching sibling items or sublist blank lines", () => {
		const guard = createMarkdownRoundTripGuard(looseNested);
		expect(guard.initialDoc.child(1).attrs.tight).toBe(false);
		expect(guard.serialize(addStrongTo(guard, "Frontend"))).toBe(
			looseNested.replace("Frontend", "**Frontend**"),
		);
		expect(guard.serialize(addStrongTo(guard, "Ops"))).toBe(
			looseNested.replace("* Ops", "* **Ops**"),
		);
	});

	it("B2 edits a nested item and keeps the parent's blank line before its sublist", () => {
		const guard = createMarkdownRoundTripGuard(looseNested);
		expect(guard.serialize(addStrongTo(guard, "Python"))).toBe(
			looseNested.replace("Python", "**Python**"),
		);
		expect(guard.serialize(addStrongTo(guard, "Kubernetes"))).toBe(
			looseNested.replace("Kubernetes", "**Kubernetes**"),
		);
	});

	it("B2 preserves ordered, task, and mixed loose/tight separators byte-identically", () => {
		const ordered = "1. one\n2. two\n\n   1. nested\n3. three";
		const orderedGuard = createMarkdownRoundTripGuard(ordered);
		expect(orderedGuard.serialize(addStrongTo(orderedGuard, "three"))).toBe(
			ordered.replace("three", "**three**"),
		);

		const task = "- [ ] a\n- [x] b\n\n  - [ ] b1\n- [ ] c\n";
		const taskGuard = createMarkdownRoundTripGuard(task);
		expect(taskGuard.serialize(addStrongTo(taskGuard, "c"))).toBe(
			task.replace("[ ] c", "[ ] **c**"),
		);

		const mixed = "Intro\n\n- a\n\n- b\n- c   \n- d\n\nOutro";
		const mixedGuard = createMarkdownRoundTripGuard(mixed);
		expect(mixedGuard.serialize(addStrongTo(mixedGuard, "b"))).toBe(
			mixed.replace("- b", "- **b**"),
		);
	});

	it("R4 drops a stale multi-block trailing suffix but keeps a single-block one", () => {
		const okDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.paragraph.create(
				null,
				visualEditorSchema.text("ok"),
			),
		]);
		expect(createMarkdownRoundTripGuard("# A\n\nB\n\n").serialize(okDoc)).toBe(
			"ok",
		);
		expect(
			createMarkdownRoundTripGuard("# A\r\n\r\nB\r\n").serialize(okDoc),
		).toBe("ok");

		const singleGuard = createMarkdownRoundTripGuard("Hello\n");
		const state = EditorState.create({
			doc: singleGuard.initialDoc,
			schema: visualEditorSchema,
		});
		const edited = state.tr.insertText("!", state.doc.content.size - 1).doc;
		expect(singleGuard.serialize(edited)).toBe("Hello!\n");
	});
});

describe("Wave 6B-1 §16.1 P1 codec fixes", () => {
	const roundTripTwice = (markdown: string): string => {
		const once = serializeVisualDocToMarkdown(
			parseMarkdownToVisualDoc(markdown),
		);
		const twice = serializeVisualDocToMarkdown(parseMarkdownToVisualDoc(once));
		expect(twice).toBe(once);
		return once;
	};

	const firstCodeText = (doc: ProseMirrorNode): string | null => {
		let found: string | null = null;
		doc.descendants((node) => {
			if (found === null && node.type.name === "code") {
				found = node.textContent;
			}
			if (found === null && node.isText) {
				if (node.marks.some((mark) => mark.type.name === "code")) {
					found = node.text ?? "";
				}
			}
			return true;
		});
		return found;
	};

	it("P1-1 keeps table-cell code span backslashes without doubling", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["| A |\n| --- |\n| `C:\\path` |", "C:\\path"],
			["| A |\n| --- |\n| `a\\|b` |", "a|b"],
			["| A |\n| --- |\n| `a\\\\|b` |", "a\\|b"],
		];
		for (const [markdown, codeText] of cases) {
			const doc = parseMarkdownToVisualDoc(markdown);
			expect(firstCodeText(doc)).toBe(codeText);
			const once = roundTripTwice(markdown);
			expect(once).toBe(markdown);
			expect(firstCodeText(parseMarkdownToVisualDoc(once))).toBe(codeText);
		}
		// Hand-built `a\|b` (one backslash + pipe) serializes as `a\\|b`.
		const literal = serializeVisualDocToMarkdown(
			parseMarkdownToVisualDoc("| A |\n| --- |\n| `a\\\\|b` |"),
		);
		expect(literal).toContain("`a\\\\|b`");
		expect(literal).not.toContain("`a\\\\\\|b`");
	});

	it("P1-2 maps fenced code bodies bijectively, including trailing blank lines", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["```js\n```", ""],
			["```js\n\n```", "\n"],
			["```js\n\n\n```", "\n\n"],
			["```js\nfoo\n```", "foo"],
			["```js\nfoo\n\n```", "foo\n"],
			["```js\nfoo\n\n\n```", "foo\n\n"],
			["```js\n\nfoo\n```", "\nfoo"],
		];
		for (const [markdown, pmText] of cases) {
			const doc = parseMarkdownToVisualDoc(markdown);
			expect(doc.firstChild?.type.name).toBe("code_block");
			expect(doc.firstChild?.textContent).toBe(pmText);
			expect(roundTripTwice(markdown)).toBe(markdown);
		}
		// Indented code shares mapCodeToken and canonicalizes to a fence.
		const indented = parseMarkdownToVisualDoc("    foo\n\n    bar");
		expect(indented.firstChild?.textContent).toBe("foo\n\nbar");
		expect(roundTripTwice("    foo\n\n    bar")).toBe("```\nfoo\n\nbar\n```");
	});

	it("P1-2 Enter at the end of a code block reaches canonical Markdown", () => {
		const view = createEditorView("```js\nfoo\n```");
		setCursorAtEndOfFirstTextblock(view);
		expect(dispatchKey(view, "Enter")).toBe(true);
		expect(view.state.doc.firstChild?.textContent).toBe("foo\n");
		const serialized = serializeVisualDocToMarkdown(view.state.doc);
		expect(serialized).toBe("```js\nfoo\n\n```");
		expect(parseMarkdownToVisualDoc(serialized).firstChild?.textContent).toBe(
			"foo\n",
		);
	});

	it("P1-3 never splits a continuing outer link or emphasis around spaces", () => {
		const { link, strong, em } = visualEditorSchema.marks;
		const href = { href: "https://example.com", title: null };
		const para = (...nodes: ProseMirrorNode[]) =>
			visualEditorSchema.nodes.doc.create(null, [
				visualEditorSchema.nodes.paragraph.create(null, nodes),
			]);
		const text = visualEditorSchema.text.bind(visualEditorSchema);

		const boldInLink = para(
			text("hello", [link.create(href)]),
			text(" world", [link.create(href), strong.create()]),
		);
		expect(serializeVisualDocToMarkdown(boldInLink)).toBe(
			"[hello **world**](https://example.com)",
		);

		const emInStrong = para(
			text("hello", [strong.create()]),
			text(" world", [strong.create(), em.create()]),
		);
		expect(serializeVisualDocToMarkdown(emInStrong)).toBe("**hello *world***");

		const spaceInLink = para(
			text("a", [link.create(href)]),
			text(" ", [link.create(href), em.create()]),
			text("b", [link.create(href)]),
		);
		expect(serializeVisualDocToMarkdown(spaceInLink)).toBe(
			"[a b](https://example.com)",
		);

		const spaceInStrong = para(
			text("a", [strong.create()]),
			text(" ", [strong.create(), em.create()]),
			text("b", [strong.create()]),
		);
		expect(serializeVisualDocToMarkdown(spaceInStrong)).toBe("**a b**");

		for (const markdown of [
			"[hello **world**](https://example.com)",
			"**hello *world***",
			"[a b](https://example.com)",
			"[ foo](https://example.com)",
		]) {
			const doc = parseMarkdownToVisualDoc(markdown);
			expect(roundTripTwice(markdown)).toBe(markdown);
			expect(
				parseMarkdownToVisualDoc(serializeVisualDocToMarkdown(doc)).eq(doc),
			).toBe(true);
		}
	});
});

describe("Wave 6E-1 Codex findings #1 and #3", () => {
	const linkHrefOf = (doc: ProseMirrorNode, text: string): string | null => {
		let href: string | null = null;
		doc.descendants((node) => {
			if (href === null && node.isText && node.text === text) {
				const mark = node.marks.find((m) => m.type.name === "link");
				href = mark ? String(mark.attrs.href) : null;
			}
			return href === null;
		});
		return href;
	};

	const editAt = (doc: ProseMirrorNode, pos: number, text: string) => {
		const state = EditorState.create({ doc, schema: visualEditorSchema });
		return state.tr.insertText(text, pos).doc;
	};

	it("#1 keeps a reference definition directly below an edited ATX heading", () => {
		const markdown = "# Heading\n[site]: https://example.com\n\nA [link][site]";
		const guard = createMarkdownRoundTripGuard(markdown);
		expect(guard.initialDoc.firstChild?.type.name).toBe("heading");
		expect(linkHrefOf(guard.initialDoc, "link")).toBe("https://example.com");
		const serialized = guard.serialize(editAt(guard.initialDoc, 2, "Z"));
		expect(serialized).toContain("# HZeading");
		expect(serialized).toContain("[site]: https://example.com");
		expect(serialized).toContain("A [link][site]");
		const reparsed = parseMarkdownToVisualDoc(serialized);
		expect(linkHrefOf(reparsed, "link")).toBe("https://example.com");
		expect(reparsed.firstChild?.textContent).toBe("HZeading");
	});

	it("#1 keeps a reference definition after a thematic break or setext heading", () => {
		for (const opener of ["---", "***", "___", "Title\n==="]) {
			const markdown = `${opener}\n[site]: https://example.com\n\nA [link][site]`;
			const guard = createMarkdownRoundTripGuard(markdown);
			expect(linkHrefOf(guard.initialDoc, "link")).toBe("https://example.com");
			const end = guard.initialDoc.content.size - 1;
			const serialized = guard.serialize(editAt(guard.initialDoc, end, "!"));
			// The edited paragraph is regenerated; the definition stays verbatim.
			expect(
				serialized.startsWith(`${opener}\n[site]: https://example.com\n\n`),
			).toBe(true);
			expect(serialized.endsWith("!")).toBe(true);
			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(linkHrefOf(reparsed, "link")).toBe("https://example.com");
		}
	});

	it("#1 never protects definition-like text that continues a paragraph", () => {
		const markdown = "Paragraph line\n[not-def]: https://example.com";
		const doc = parseMarkdownToVisualDoc(markdown);
		expect(doc.childCount).toBe(1);
		expect(doc.firstChild?.type.name).toBe("paragraph");
		expect(doc.firstChild?.textContent).toContain(
			"[not-def]: https://example.com",
		);
		const guard = createMarkdownRoundTripGuard(markdown);
		const serialized = guard.serialize(editAt(guard.initialDoc, 1, "X"));
		const reparsed = parseMarkdownToVisualDoc(serialized);
		expect(reparsed.childCount).toBe(1);
		expect(reparsed.firstChild?.textContent).toContain("[not-def]:");
	});

	const deleteFirstItem = (
		guard: ReturnType<typeof createMarkdownRoundTripGuard>,
	): string => {
		const list = guard.initialDoc.firstChild;
		expect(list?.type.name).toBe("ordered_list");
		const first = list?.firstChild;
		if (!list || !first) throw new Error("missing ordered list");
		const state = EditorState.create({
			doc: guard.initialDoc,
			schema: visualEditorSchema,
		});
		const edited = state.tr.delete(1, 1 + first.nodeSize).doc;
		expect(edited.firstChild?.attrs.order).toBe(list.attrs.order);
		return guard.serialize(edited);
	};

	it("#3 keeps the ordered-list start when the first item is deleted", () => {
		const paren = deleteFirstItem(
			createMarkdownRoundTripGuard("1) First\n2) Second\n3) Third"),
		);
		expect(paren).toBe("1) Second\n3) Third");
		expect(parseMarkdownToVisualDoc(paren).firstChild?.attrs.order).toBe(1);

		const fifth = deleteFirstItem(
			createMarkdownRoundTripGuard("5. Fifth\n6. Sixth\n7. Seventh"),
		);
		expect(fifth).toBe("5. Sixth\n7. Seventh");
		expect(parseMarkdownToVisualDoc(fifth).firstChild?.attrs.order).toBe(5);
	});

	it("#3 realigns continuation lines when the start marker width changes", () => {
		const markdown = "9. Nine\n10. Ten\n    - sub\n11. Eleven";
		const serialized = deleteFirstItem(createMarkdownRoundTripGuard(markdown));
		expect(serialized).toBe("9. Ten\n   - sub\n11. Eleven");
		const list = parseMarkdownToVisualDoc(serialized).firstChild;
		expect(list?.attrs.order).toBe(9);
		expect(list?.childCount).toBe(2);
		expect(list?.firstChild?.lastChild?.type.name).toBe("bullet_list");
	});
});

describe("Wave 6F container reference definitions and ordered first-item deletion", () => {
	const linkHrefOf = (doc: ProseMirrorNode, text: string): string | null => {
		let href: string | null = null;
		doc.descendants((node) => {
			if (href === null && node.isText && node.text === text) {
				const mark = node.marks.find((m) => m.type.name === "link");
				href = mark ? String(mark.attrs.href) : null;
			}
			return href === null;
		});
		return href;
	};

	const textPos = (doc: ProseMirrorNode, text: string): number => {
		let found = -1;
		doc.descendants((node, pos) => {
			if (found < 0 && node.isText && node.text === text) found = pos;
			return found < 0;
		});
		if (found < 0) throw new Error(`missing text ${text}`);
		return found;
	};

	const editHeading = (markdown: string): string => {
		const guard = createMarkdownRoundTripGuard(markdown);
		expect(linkHrefOf(guard.initialDoc, "link")).toBe("https://example.com");
		const state = EditorState.create({
			doc: guard.initialDoc,
			schema: visualEditorSchema,
		});
		const pos = textPos(guard.initialDoc, "Heading") + 1;
		return guard.serialize(state.tr.insertText("Z", pos).doc);
	};

	const expectHeadingEdited = (serialized: string): void => {
		const reparsed = parseMarkdownToVisualDoc(serialized);
		expect(textPos(reparsed, "HZeading")).toBeGreaterThan(0);
		expect(linkHrefOf(reparsed, "link")).toBe("https://example.com");
	};

	it("keeps a definition after a heading inside a quoted list item", () => {
		const serialized = editHeading(
			"> - # Heading\n[site]: https://example.com\n\nA [link][site]",
		);
		expect(serialized).toContain("# HZeading");
		expect(serialized).toContain("\n[site]: https://example.com\n");
		expectHeadingEdited(serialized);
	});

	it("keeps a quoted definition after a quote-only blank line", () => {
		const serialized = editHeading(
			"> # Heading\n>\n> [site]: https://example.com\n\nA [link][site]",
		);
		expect(serialized).toContain("> # HZeading");
		expect(serialized).toContain("> [site]: https://example.com");
		expectHeadingEdited(serialized);
	});

	it("keeps a definition after a heading inside a plain list item", () => {
		const serialized = editHeading(
			"- # Heading\n[site]: https://example.com\n\nA [link][site]",
		);
		expect(serialized).toContain("[site]: https://example.com");
		expectHeadingEdited(serialized);
	});

	it("never protects definition-like paragraph continuations in containers", () => {
		const plain = parseMarkdownToVisualDoc(
			"Paragraph line\n[not-def]: https://example.com",
		);
		expect(plain.childCount).toBe(1);
		expect(plain.firstChild?.type.name).toBe("paragraph");
		expect(plain.firstChild?.textContent).toContain("[not-def]:");

		const quoted = parseMarkdownToVisualDoc(
			"> Paragraph line\n> [not-def]: https://example.com",
		);
		expect(quoted.childCount).toBe(1);
		const quote = quoted.firstChild;
		expect(quote?.type.name).toBe("blockquote");
		expect(quote?.childCount).toBe(1);
		expect(quote?.firstChild?.type.name).toBe("paragraph");
		expect(quote?.firstChild?.textContent).toContain("[not-def]:");

		const item = parseMarkdownToVisualDoc(
			"- Item text\n  [not-def]: https://example.com",
		);
		expect(item.firstChild?.firstChild?.childCount).toBe(1);
		expect(item.firstChild?.firstChild?.textContent).toContain("[not-def]:");
	});

	const deleteFirstItem = (markdown: string) => {
		const guard = createMarkdownRoundTripGuard(markdown);
		const list = guard.initialDoc.firstChild;
		expect(guard.initialDoc.childCount).toBe(1);
		expect(list?.type.name).toBe("ordered_list");
		const first = list?.firstChild;
		if (!list || !first) throw new Error("missing ordered list");
		const state = EditorState.create({
			doc: guard.initialDoc,
			schema: visualEditorSchema,
		});
		const edited = state.tr.delete(1, 1 + first.nodeSize).doc;
		const serialized = guard.serialize(edited);
		const reparsed = parseMarkdownToVisualDoc(serialized);
		expect(reparsed.childCount).toBe(1);
		expect(reparsed.firstChild?.type.name).toBe("ordered_list");
		expect(reparsed.firstChild?.attrs.order).toBe(list.attrs.order);
		expect(reparsed.firstChild?.childCount).toBe(list.childCount - 1);
		expect(reparsed.eq(edited)).toBe(true);
		return { reparsed, serialized };
	};

	it("never turns lazy continuation text into a root list", () => {
		const { reparsed, serialized } = deleteFirstItem(
			"0. First\n10.  Second\n    - nested\n2. Third",
		);
		expect(serialized.startsWith("0.")).toBe(true);
		const firstItem = reparsed.firstChild?.firstChild;
		expect(firstItem?.childCount).toBe(1);
		expect(firstItem?.firstChild?.type.name).toBe("paragraph");
		expect(firstItem?.textContent).toContain("- nested");
	});

	it("regenerates the first item when no raw rewrite keeps its structure", () => {
		// Spacing 4 cannot widen and a column shift would capture the lazy line.
		const { reparsed, serialized } = deleteFirstItem(
			"0. First\n10.    Second\n      - nested\n2. Third",
		);
		expect(serialized.endsWith("\n2. Third")).toBe(true);
		const firstItem = reparsed.firstChild?.firstChild;
		expect(firstItem?.childCount).toBe(1);
		expect(firstItem?.textContent).toContain("- nested");
	});

	it("keeps a tab-indented nested list when the marker narrows", () => {
		const { reparsed } = deleteFirstItem(
			"0. First\n10. Second\n\t   - nested\n2. Third",
		);
		const firstItem = reparsed.firstChild?.firstChild;
		expect(firstItem?.lastChild?.type.name).toBe("bullet_list");
		expect(firstItem?.lastChild?.textContent).toBe("nested");
	});

	it("keeps the existing start, delimiter, and width-shift results", () => {
		expect(deleteFirstItem("1) First\n2) Second\n3) Third").serialized).toBe(
			"1) Second\n3) Third",
		);
		expect(deleteFirstItem("5. Fifth\n6. Sixth\n7. Seventh").serialized).toBe(
			"5. Sixth\n7. Seventh",
		);
		expect(
			deleteFirstItem("9. Nine\n10. Ten\n    - sub\n11. Eleven").serialized,
		).toBe("9. Ten\n   - sub\n11. Eleven");
		const widened = deleteFirstItem("99. A\n100. B\n     - sub\n101. C");
		expect(widened.reparsed.firstChild?.firstChild?.lastChild?.type.name).toBe(
			"bullet_list",
		);
	});

	it("caches untouched pasted block serializations across subsequent edits", () => {
		const serializeBlock = vi.fn((node: ProseMirrorNode) =>
			serializeVisualDocToMarkdown(
				visualEditorSchema.nodes.doc.create(null, [node]),
			),
		);
		const guard = createPreservingRoundTripGuard("Before", undefined, {
			serializeBlock,
			serializeDoc: serializeVisualDocToMarkdown,
		});
		const pastedDoc = parseMarkdownToVisualDoc(
			"Before\n\nPasted one\n\nPasted two\n\nPasted three",
		);
		expect(guard.serialize(pastedDoc)).toBe(
			"Before\n\nPasted one\n\nPasted two\n\nPasted three",
		);
		// Block 0 matches baseline "Before"; the 3 pasted blocks are serialized once.
		expect(serializeBlock).toHaveBeenCalledTimes(3);

		serializeBlock.mockClear();
		const state = EditorState.create({
			doc: pastedDoc,
			schema: visualEditorSchema,
		});
		// Edit only block 1 ("Pasted one" -> "Pasted one!").
		const block1End =
			pastedDoc.child(0).nodeSize + pastedDoc.child(1).nodeSize - 1;
		const editedDoc = state.tr.insertText("!", block1End).doc;
		expect(guard.serialize(editedDoc)).toBe(
			"Before\n\nPasted one!\n\nPasted two\n\nPasted three",
		);
		// Only the newly edited block 1 is re-serialized; untouched blocks 2 & 3 hit cache.
		expect(serializeBlock).toHaveBeenCalledTimes(1);

		// Empty baseline also uses the per-node cache.
		serializeBlock.mockClear();
		const emptyGuard = createPreservingRoundTripGuard("", undefined, {
			serializeBlock,
			serializeDoc: serializeVisualDocToMarkdown,
		});
		expect(emptyGuard.serialize(pastedDoc)).toBe(
			"Before\n\nPasted one\n\nPasted two\n\nPasted three",
		);
		expect(serializeBlock).toHaveBeenCalledTimes(4);
		serializeBlock.mockClear();
		expect(emptyGuard.serialize(editedDoc)).toBe(
			"Before\n\nPasted one!\n\nPasted two\n\nPasted three",
		);
		expect(serializeBlock).toHaveBeenCalledTimes(1);
	});
});

describe("identity-first block alignment and bounded large-span matching", () => {
	function historyState(
		guard: ReturnType<typeof createMarkdownRoundTripGuard>,
	) {
		return EditorState.create({
			doc: guard.initialDoc,
			schema: visualEditorSchema,
			plugins: [history()],
		});
	}

	function deleteChild(state: EditorState, index: number): EditorState {
		let from = 0;
		for (let i = 0; i < index; i += 1) from += state.doc.child(i).nodeSize;
		return state.apply(
			state.tr.delete(from, from + state.doc.child(index).nodeSize),
		);
	}

	function runHistory(state: EditorState, command: typeof undo): EditorState {
		let next = state;
		command(state, (tr) => {
			next = state.apply(tr);
		});
		return next;
	}

	it("keeps the surviving block's raw spelling when one of two identical paragraphs is deleted", () => {
		const original = "*same*\n\n_same_\n\nEnd";
		const guard = createMarkdownRoundTripGuard(original);
		expect(guard.initialDoc.child(0).eq(guard.initialDoc.child(1))).toBe(true);
		const base = historyState(guard);

		const firstDeleted = deleteChild(base, 0);
		expect(firstDeleted.doc.child(0)).toBe(base.doc.child(1));
		expect(guard.serialize(firstDeleted.doc)).toBe("_same_\n\nEnd");
		const undoneFirst = runHistory(firstDeleted, undo);
		expect(guard.serialize(undoneFirst.doc)).toBe(original);
		const redoneFirst = runHistory(undoneFirst, redo);
		expect(guard.serialize(redoneFirst.doc)).toBe("_same_\n\nEnd");

		const secondDeleted = deleteChild(base, 1);
		expect(guard.serialize(secondDeleted.doc)).toBe("*same*\n\nEnd");
		const undoneSecond = runHistory(secondDeleted, undo);
		expect(guard.serialize(undoneSecond.doc)).toBe(original);
		const redoneSecond = runHistory(undoneSecond, redo);
		expect(guard.serialize(redoneSecond.doc)).toBe("*same*\n\nEnd");
	});

	it("keeps the surviving list item's raw spelling when one of two identical items is deleted", () => {
		const original = "- *same*\n- _same_\n- End\n\nTail";
		const guard = createMarkdownRoundTripGuard(original);
		const list = guard.initialDoc.child(0);
		expect(list.child(0).eq(list.child(1))).toBe(true);
		const base = historyState(guard);
		const deleteItem = (index: number): EditorState => {
			let from = 1;
			for (let i = 0; i < index; i += 1) from += list.child(i).nodeSize;
			return base.apply(
				base.tr.delete(from, from + list.child(index).nodeSize),
			);
		};

		const firstDeleted = deleteItem(0);
		expect(firstDeleted.doc.child(0).child(0)).toBe(list.child(1));
		expect(guard.serialize(firstDeleted.doc)).toBe("- _same_\n- End\n\nTail");
		const undone = runHistory(firstDeleted, undo);
		expect(guard.serialize(undone.doc)).toBe(original);
		expect(guard.serialize(runHistory(undone, redo).doc)).toBe(
			"- _same_\n- End\n\nTail",
		);

		const secondDeleted = deleteItem(1);
		expect(guard.serialize(secondDeleted.doc)).toBe("- *same*\n- End\n\nTail");
		const undoneSecond = runHistory(secondDeleted, undo);
		expect(guard.serialize(undoneSecond.doc)).toBe(original);
		expect(guard.serialize(runHistory(undoneSecond, redo).doc)).toBe(
			"- *same*\n- End\n\nTail",
		);
	});

	it("aligns large disjoint spans with near-linear comparisons and preserves surviving raw slices", () => {
		const count = 4000;
		const span = (prefix: string, from: number, to: number): string[] => {
			const blocks: string[] = [];
			for (let i = from; i < to; i += 1) {
				blocks.push(`${prefix}${String(i).padStart(5, "0")}`);
			}
			return blocks;
		};
		const half = count / 2;
		const originalBlocks = [
			...span("a", 0, half),
			"*keep one*",
			"Keep two\n========",
			...span("a", half, count),
		];
		const nextBlocks = [
			...span("b", 0, half),
			"_keep one_",
			"# Keep two",
			...span("b", half, count),
		];
		const original = originalBlocks.join("\n\n");
		const guard = createMarkdownRoundTripGuard(original);
		// Freshly parsed: no object identity is shared with the baseline.
		const nextDoc = parseMarkdownToVisualDoc(nextBlocks.join("\n\n"));
		expect(nextDoc.childCount).toBe(count + 2);

		const eqSpy = vi.spyOn(ProseMirrorNode.prototype, "eq");
		const started = performance.now();
		let serialized = "";
		try {
			serialized = guard.serialize(nextDoc);
		} finally {
			expect(eqSpy.mock.calls.length).toBeLessThan(100000);
			eqSpy.mockRestore();
		}
		expect(performance.now() - started).toBeLessThan(5000);
		const lines = serialized.split("\n\n");
		expect(lines[half]).toBe("*keep one*");
		expect(lines[half + 1]).toBe("Keep two\n========");
		expect(lines[0]).toBe("b00000");
		expect(lines[lines.length - 1]).toBe(
			`b${String(count - 1).padStart(5, "0")}`,
		);
	});

	it("keeps exact link slices past same-text bucket collisions on large gaps", () => {
		const link = (i: number): string =>
			`[Open](https://x.test/${i} '${i === 105 ? "Keep me" : `t${i}`}')`;
		const originalBlocks = ["Start"];
		for (let i = 1; i <= 208; i += 1) originalBlocks.push(link(i));
		originalBlocks.push("Finish");
		expect(originalBlocks).toHaveLength(210);
		// Edited ends defeat prefix/suffix trimming; five deleted same-text
		// links right before the middle push it past any small probe window.
		const nextBlocks = ["Start edited"];
		for (let i = 1; i <= 208; i += 1) {
			if (i < 100 || i > 104) nextBlocks.push(link(i));
		}
		nextBlocks.push("Finish edited");
		expect(nextBlocks.length * originalBlocks.length).toBeGreaterThan(40000);

		const guard = createMarkdownRoundTripGuard(originalBlocks.join("\n\n"));
		const nextDoc = parseMarkdownToVisualDoc(nextBlocks.join("\n\n"));
		const middle = link(105);
		// Regeneration would not keep the single-quoted title spelling.
		expect(
			serializeVisualDocToMarkdown(parseMarkdownToVisualDoc(middle)),
		).not.toBe(middle);

		const eqSpy = vi.spyOn(ProseMirrorNode.prototype, "eq");
		let serialized = "";
		try {
			serialized = guard.serialize(nextDoc);
		} finally {
			expect(eqSpy.mock.calls.length).toBeLessThanOrEqual(
				4 * originalBlocks.length,
			);
			eqSpy.mockRestore();
		}
		expect(serialized).toBe(
			["Start edited", ...nextBlocks.slice(1, -1), "Finish edited"].join(
				"\n\n",
			),
		);
		expect(serialized.split("\n\n")).toContain(middle);
	});
});
