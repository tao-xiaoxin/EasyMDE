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
	extractReferenceDefinitionLabels,
	parseImageScaleTitle,
	parseMarkdownToVisualDoc,
	parseMarkdownWithBlockSources,
	prescanMarkdown,
	wouldReferenceDefinitionAbsorbFollowingBlock,
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
		expect(parseImageScaleTitle("Syntax {width=50%} example")).toEqual({
			title: "Syntax {width=50%} example",
			scale: null,
		});
		expect(
			parseImageScaleTitle("Syntax {width=50%} example {width=67%}"),
		).toEqual({
			title: "Syntax {width=50%} example",
			scale: 67,
		});
		expect(parseImageScaleTitle("Title{width=50%}")).toEqual({
			title: "Title{width=50%}",
			scale: null,
		});
		expect(parseImageScaleTitle("{width=50%}{width=67%}")).toEqual({
			title: "{width=50%}{width=67%}",
			scale: null,
		});
		expect(parseImageScaleTitle("Title {width=50%} {width=67%}")).toEqual({
			title: "Title {width=50%} {width=67%}",
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

		// PHP `MarkdownRenderer::extract_math()` runs before CommonMark GFM table
		// parsing, so `$10 | $` across cells is extracted as inline math (`\(10 |\)20`).
		const tableDoc = parseMarkdownToVisualDoc(
			"| Item | A | B |\n| --- | --- | --- |\n| x | $10 | $20 |",
		);
		const tableNode = tableDoc.firstChild;
		expect(tableNode?.type.name).toBe("table");
		expect(tableNode?.child(0).childCount).toBe(3);
		expect(tableNode?.child(1).childCount).toBe(3);
		expect(collectProtectedInlineRaws(tableDoc)).toEqual(["$10 | $"]);
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

		const unspacedScale = parseMarkdownToVisualDoc(
			'![img](https://example.com/a.png "Title{width=50%}")',
		);
		expect(serializeVisualDocToMarkdown(unspacedScale)).toBe(
			'![img](https://example.com/a.png "Title")',
		);

		const repeatedScale = parseMarkdownToVisualDoc(
			'![img](https://example.com/a.png "Photo {width=50%} {width=67%}")',
		);
		expect(serializeVisualDocToMarkdown(repeatedScale)).toBe(
			'![img](https://example.com/a.png "Photo")',
		);

		const nonterminalLiteral =
			'![img](https://example.com/a.png "Syntax {width=50%} example")';
		const nonterminalDoc = parseMarkdownToVisualDoc(nonterminalLiteral);
		expect(nonterminalDoc.firstChild?.firstChild?.attrs).toMatchObject({
			title: "Syntax {width=50%} example",
			scale: null,
		});
		expect(serializeVisualDocToMarkdown(nonterminalDoc)).toBe(
			nonterminalLiteral,
		);

		const nonterminalWithValidScale =
			'![img](https://example.com/a.png "Syntax {width=50%} example {width=67%}")';
		const nonterminalScaledDoc = parseMarkdownToVisualDoc(
			nonterminalWithValidScale,
		);
		expect(nonterminalScaledDoc.firstChild?.firstChild?.attrs).toMatchObject({
			title: "Syntax {width=50%} example",
			scale: 67,
		});
		expect(serializeVisualDocToMarkdown(nonterminalScaledDoc)).toBe(
			nonterminalWithValidScale,
		);

		const nonterminalWithInvalidScale = parseMarkdownToVisualDoc(
			'![img](https://example.com/a.png "Syntax {width=50%} example {width=42%}")',
		);
		expect(serializeVisualDocToMarkdown(nonterminalWithInvalidScale)).toBe(
			nonterminalLiteral,
		);

		// Track A #2 / Track B #2: trailing whitespace or newlines after a literal
		// `{width=...}` fragment keep the title verbatim when `scale === null`,
		// including during round-trip edits to sibling text in the same paragraph.
		const paddedLiteralMd = '![A](/image.png "Caption {width=33%} ") text';
		const paddedGuard = createMarkdownRoundTripGuard(paddedLiteralMd);
		const paddedView = createEditorView(paddedLiteralMd);
		paddedView.dispatch(
			paddedView.state.tr.insertText(
				"!",
				paddedView.state.doc.content.size - 1,
			),
		);
		expect(paddedGuard.serialize(paddedView.state.doc)).toBe(
			'![A](/image.png "Caption {width=33%} ") text!',
		);

		const newlineLiteralDoc = parseMarkdownToVisualDoc(
			'![A](/image.png "Caption {width=33%}\n")',
		);
		expect(newlineLiteralDoc.firstChild?.firstChild?.attrs).toMatchObject({
			title: "Caption {width=33%}\n",
			scale: null,
		});
		expect(serializeVisualDocToMarkdown(newlineLiteralDoc)).toBe(
			'![A](/image.png "Caption {width=33%}&#10;")',
		);
		expect(
			parseMarkdownToVisualDoc(
				serializeVisualDocToMarkdown(newlineLiteralDoc),
			).eq(newlineLiteralDoc),
		).toBe(true);

		const trailingSpacesUnscaledDoc = parseMarkdownToVisualDoc(
			'![A](/image.png "Caption   ")',
		);
		expect(serializeVisualDocToMarkdown(trailingSpacesUnscaledDoc)).toBe(
			'![A](/image.png "Caption   ")',
		);

		const trailingSpacesScaledDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.paragraph.create(null, [
				visualEditorSchema.nodes.image.create({
					src: "/image.png",
					alt: "A",
					title: "Caption   ",
					scale: 50,
				}),
			]),
		]);
		const trailingSpacesScaledMd = serializeVisualDocToMarkdown(
			trailingSpacesScaledDoc,
		);
		expect(trailingSpacesScaledMd).toBe(
			'![A](/image.png "Caption    {width=50%}")',
		);
		expect(
			parseMarkdownToVisualDoc(trailingSpacesScaledMd).firstChild?.firstChild
				?.attrs,
		).toMatchObject({
			title: "Caption   ",
			scale: 50,
		});

		const paddedMarkerScaledDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.paragraph.create(null, [
				visualEditorSchema.nodes.image.create({
					src: "/image.png",
					alt: "A",
					title: "Caption {width=33%} ",
					scale: 50,
				}),
			]),
		]);
		expect(serializeVisualDocToMarkdown(paddedMarkerScaledDoc)).toBe(
			'![A](/image.png "Caption {width=50%}")',
		);

		const newlineMarkerScaledDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.paragraph.create(null, [
				visualEditorSchema.nodes.image.create({
					src: "/image.png",
					alt: "A",
					title: "Caption {width=33%}\n",
					scale: 50,
				}),
			]),
		]);
		expect(serializeVisualDocToMarkdown(newlineMarkerScaledDoc)).toBe(
			'![A](/image.png "Caption {width=50%}")',
		);

		// WordPress `wp_kses_normalize_entities()` turns `&amp;#32;` back into
		// `&#032;`, which `DOMDocument::loadHTML()` decodes to a space after
		// `{width=33%}`, causing `MarkdownRenderer::render()` to throw
		// `easymde_image_scale_syntax_invalid`. Stripping the conflicting marker
		// guarantees WP-safe serialization.
		const entityPaddedMarkerScaledDoc = visualEditorSchema.nodes.doc.create(
			null,
			[
				visualEditorSchema.nodes.paragraph.create(null, [
					visualEditorSchema.nodes.image.create({
						src: "/image.png",
						alt: "A",
						title: "Caption {width=33%}&#32;",
						scale: 50,
					}),
				]),
			],
		);
		const entityPaddedSerialized = serializeVisualDocToMarkdown(
			entityPaddedMarkerScaledDoc,
		);
		expect(entityPaddedSerialized).toBe(
			'![A](/image.png "Caption {width=50%}")',
		);
		expect(
			parseMarkdownToVisualDoc(entityPaddedSerialized).firstChild?.firstChild
				?.attrs,
		).toMatchObject({
			scale: 50,
			title: "Caption",
		});

		// Round 14 Track B #1 / #4: preserve verbatim newlines in entity-newline
		// titles, reject newline-separated or continuation-indented markers from
		// false scaling, and strip entity/escaped markers from unscaled titles.
		for (const unscaledInput of [
			'![A](/image.png "Caption&#10;{width=50%}")',
			'![A](/image.png "Caption&NewLine;{width=50%}")',
			'![A](/image.png "Caption&#13;{width=50%}")',
			'![A](/image.png "Caption\n {width=50%}")',
			'![A](/image.png "Caption\r\n {width=50%}")',
		]) {
			const parsedUnscaled = parseMarkdownToVisualDoc(unscaledInput);
			expect(
				parsedUnscaled.firstChild?.firstChild?.attrs.scale,
				unscaledInput,
			).toBeNull();
		}

		const entityNewlineScaledDoc = parseMarkdownToVisualDoc(
			'![A](/image.png "Caption&#10; {width=50%}")',
		);
		expect(entityNewlineScaledDoc.firstChild?.firstChild?.attrs).toMatchObject({
			scale: 50,
			title: "Caption\n",
		});
		const entityNewlineSerialized = serializeVisualDocToMarkdown(
			entityNewlineScaledDoc,
		);
		expect(entityNewlineSerialized).toBe(
			'![A](/image.png "Caption&#10; {width=50%}")',
		);
		expect(
			parseMarkdownToVisualDoc(entityNewlineSerialized).firstChild?.firstChild
				?.attrs,
		).toMatchObject({
			scale: 50,
			title: "Caption\n",
		});

		const multilineContinuedDoc = parseMarkdownToVisualDoc(
			'![A](/image.png "Caption\n  Line2 {width=50%}")',
		);
		expect(multilineContinuedDoc.firstChild?.firstChild?.attrs).toMatchObject({
			scale: 50,
			title: "Caption\nLine2",
		});

		const entityNewlineRepeatedDoc = parseMarkdownToVisualDoc(
			'![A](/image.png "Caption {width=33%}&NewLine; {width=67%}")',
		);
		expect(
			entityNewlineRepeatedDoc.firstChild?.firstChild?.attrs,
		).toMatchObject({
			scale: 67,
			title: "Caption {width=33%}\n",
		});

		// WordPress `wp_kses_normalize_entities()` un-escapes `&amp;#123;`/`&amp;#125;`
		// back into `&#123;`/`&#125;`, so unscaled titles whose WP-KSES-rendered
		// value ends in a `{width=...}` marker strip the conflicting marker instead
		// of emitting Markdown that breaks `MarkdownRenderer::render()`.
		for (const [title, expected] of [
			["Caption &#123;width=51%&#125;", '![A](/image.png "Caption")'],
			["Caption &#123;width=50%&#125;", '![A](/image.png "Caption")'],
			["&#123;width=51%&#125;", "![A](/image.png)"],
			[String.raw`Caption \{width=51%\}`, '![A](/image.png "Caption")'],
			["Caption {width=33%} ", '![A](/image.png "Caption {width=33%} ")'],
		] as const) {
			const unscaledEntityDoc = visualEditorSchema.nodes.doc.create(null, [
				visualEditorSchema.nodes.paragraph.create(null, [
					visualEditorSchema.nodes.image.create({
						src: "/image.png",
						alt: "A",
						title,
						scale: null,
					}),
				]),
			]);
			expect(serializeVisualDocToMarkdown(unscaledEntityDoc), title).toBe(
				expected,
			);
		}
		expect(
			serializeVisualDocToMarkdown(
				parseMarkdownToVisualDoc(
					String.raw`![A](/image.png "Caption \{width=51%\}")`,
				),
			),
		).toBe('![A](/image.png "Caption")');
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

describe("PR-R15-A title line breaks and PHP two-pass image title decoding", () => {
	it("never emits raw CR/LF in scaled or unscaled image titles inside table cells or ATX headings", () => {
		const tableScaledMd = [
			"| Col1 | Col2 |",
			"| --- | --- |",
			'| ![image](pic.png "Caption&#10; second line {width=50%}") | B |',
		].join("\n");
		const tableScaledGuard = createMarkdownRoundTripGuard(tableScaledMd);
		const tableScaledView = createEditorView(tableScaledMd);
		let col1Pos = -1;
		tableScaledView.state.doc.descendants((node, pos) => {
			if (col1Pos < 0 && node.isText && node.text === "Col1") {
				col1Pos = pos;
				return false;
			}
			return true;
		});
		expect(col1Pos).toBeGreaterThan(0);
		tableScaledView.dispatch(
			tableScaledView.state.tr.insertText("x", col1Pos + 4),
		);
		const serializedScaledTable = tableScaledGuard.serialize(
			tableScaledView.state.doc,
		);
		expect(serializedScaledTable.split("\n")).toHaveLength(3);
		expect(serializedScaledTable).toBe(
			[
				"| Col1x | Col2 |",
				"| --- | --- |",
				'| ![image](pic.png "Caption&#10; second line {width=50%}") | B |',
			].join("\n"),
		);
		const reparsedScaledTable = parseMarkdownToVisualDoc(serializedScaledTable);
		const reparsedTableImg =
			reparsedScaledTable.firstChild?.child(1).child(0).firstChild?.firstChild;
		expect(reparsedTableImg?.attrs).toMatchObject({
			scale: 50,
			title: "Caption\n second line",
		});

		const tableUnscaledMd = [
			"| Col1 | Col2 |",
			"| --- | --- |",
			'| ![A](/x.png "Line1&#10;Line2") | B |',
		].join("\n");
		const tableUnscaledView = createEditorView(tableUnscaledMd);
		let unscaledColPos = -1;
		tableUnscaledView.state.doc.descendants((node, pos) => {
			if (unscaledColPos < 0 && node.isText && node.text === "Col1") {
				unscaledColPos = pos;
				return false;
			}
			return true;
		});
		tableUnscaledView.dispatch(
			tableUnscaledView.state.tr.insertText("x", unscaledColPos + 4),
		);
		const serializedUnscaledTable = serializeVisualDocToMarkdown(
			tableUnscaledView.state.doc,
		);
		expect(serializedUnscaledTable.split("\n")).toHaveLength(3);
		expect(serializedUnscaledTable).toBe(
			[
				"| Col1x | Col2 |",
				"| --- | --- |",
				'| ![A](/x.png "Line1&#10;Line2") | B |',
			].join("\n"),
		);

		const headingScaled = '# ![A](/x.png "Line1&#10;Line2 {width=50%}")';
		const headingScaledDoc = parseMarkdownToVisualDoc(headingScaled);
		expect(headingScaledDoc.firstChild?.firstChild?.attrs).toMatchObject({
			scale: 50,
			title: "Line1\nLine2",
		});
		expect(serializeVisualDocToMarkdown(headingScaledDoc)).toBe(headingScaled);

		const headingUnscaled = '# ![A](/x.png "Line1&#10;Line2")';
		const headingUnscaledDoc = parseMarkdownToVisualDoc(headingUnscaled);
		expect(headingUnscaledDoc.firstChild?.firstChild?.attrs).toMatchObject({
			scale: null,
			title: "Line1\nLine2",
		});
		expect(serializeVisualDocToMarkdown(headingUnscaledDoc)).toBe(
			headingUnscaled,
		);
	});

	it("encodes CR/LF in link titles inside table cells, ATX headings, and blank-line link titles", () => {
		const tableLinkMd = [
			'| [link](/x "Line1&#10;Line2") |',
			"| --- |",
			"| ok |",
		].join("\n");
		const tableLinkDoc = parseMarkdownToVisualDoc(tableLinkMd);
		expect(serializeVisualDocToMarkdown(tableLinkDoc)).toBe(tableLinkMd);

		const tablePipeLinkMd = [
			'| [link](/x "a\\|b&#10;c") |',
			"| --- |",
			"| ok |",
		].join("\n");
		const tablePipeLinkDoc = parseMarkdownToVisualDoc(tablePipeLinkMd);
		expect(serializeVisualDocToMarkdown(tablePipeLinkDoc)).toBe(tablePipeLinkMd);

		const headingLinkMd = '# [link](/x "Line1&#10;Line2")';
		const headingLinkDoc = parseMarkdownToVisualDoc(headingLinkMd);
		expect(serializeVisualDocToMarkdown(headingLinkDoc)).toBe(headingLinkMd);

		const blankLineLinkMd = '[link](/x "Line1&#10;&#10;Line2")';
		const blankLineLinkDoc = parseMarkdownToVisualDoc(blankLineLinkMd);
		expect(serializeVisualDocToMarkdown(blankLineLinkDoc)).toBe(blankLineLinkMd);
	});

	it("decodes raw inline and reference image titles with PHP-equivalent two-pass decoding without double-decoding", () => {
		const escSpaceMd = String.raw`Example ![image](pic.png "Caption\&#32;{width=50%}")`;
		const escSpaceGuard = createMarkdownRoundTripGuard(escSpaceMd);
		const escSpaceImg = escSpaceGuard.initialDoc.firstChild?.child(1);
		expect(escSpaceImg?.attrs).toMatchObject({
			scale: 50,
			title: "Caption",
		});
		const escSpaceView = createEditorView(escSpaceMd);
		escSpaceView.dispatch(escSpaceView.state.tr.insertText("!", 8));
		expect(escSpaceGuard.serialize(escSpaceView.state.doc)).toBe(
			'Example! ![image](pic.png "Caption {width=50%}")',
		);

		const escBraceMd = String.raw`![A](/x.png "Caption \&#123;width=50%&#125;")`;
		const escBraceDoc = parseMarkdownToVisualDoc(escBraceMd);
		expect(escBraceDoc.firstChild?.firstChild?.attrs).toMatchObject({
			scale: 50,
			title: "Caption",
		});
		expect(serializeVisualDocToMarkdown(escBraceDoc)).toBe(
			'![A](/x.png "Caption {width=50%}")',
		);

		// WordPress wp_kses_normalize_entities() decodes `&amp;#123;` -> `&#123;` -> `{`,
		// matching PHP MarkdownRenderer::render() with real wp_kses(); double-escaped
		// `&amp;amp;#123;` stays unscaled.
		const ampBraceMd = '![A](/x.png "Caption &amp;#123;width=50%&#125;")';
		const ampBraceGuard = createMarkdownRoundTripGuard(ampBraceMd);
		expect(ampBraceGuard.initialDoc.firstChild?.firstChild?.attrs).toMatchObject(
			{
				scale: 50,
				title: "Caption",
			},
		);
		expect(ampBraceGuard.serialize(ampBraceGuard.initialDoc)).toBe(ampBraceMd);

		const doubleAmpBraceMd =
			'![A](/x.png "Caption &amp;amp;#123;width=50%&#125;")';
		const doubleAmpGuard = createMarkdownRoundTripGuard(doubleAmpBraceMd);
		expect(doubleAmpGuard.initialDoc.firstChild?.firstChild?.attrs).toMatchObject(
			{
				scale: null,
				title: "Caption &amp;#123;width=50%}",
			},
		);
		expect(doubleAmpGuard.serialize(doubleAmpGuard.initialDoc)).toBe(
			doubleAmpBraceMd,
		);

		const escNewlineMd = String.raw`![A](/x.png "Caption {width=33%}\&NewLine; {width=67%}")`;
		const escNewlineDoc = parseMarkdownToVisualDoc(escNewlineMd);
		expect(escNewlineDoc.firstChild?.firstChild?.attrs).toMatchObject({
			scale: 67,
			title: "Caption {width=33%}\n",
		});

		const nullEntityDoc = parseMarkdownToVisualDoc(
			'![A](/x.png "Caption &#0; {width=50%}")',
		);
		expect(nullEntityDoc.firstChild?.firstChild?.attrs).toMatchObject({
			scale: 50,
			title: "Caption \uFFFD",
		});

		// Reference images decode via two-pass without double-decoding.
		const refEscMd = [
			"Example ![image][pic]",
			"",
			String.raw`[pic]: pic.png "Caption\&#32;{width=50%}"`,
		].join("\n");
		expect(
			parseMarkdownToVisualDoc(refEscMd).firstChild?.child(1)?.attrs,
		).toMatchObject({
			scale: 50,
			title: "Caption",
		});

		const refAmpMd = [
			"![A][pic]",
			"",
			'[pic]: /x.png "Caption &amp;#123;width=50%&#125;"',
		].join("\n");
		expect(
			parseMarkdownToVisualDoc(refAmpMd).firstChild?.firstChild?.attrs,
		).toMatchObject({
			scale: 50,
			title: "Caption",
		});

		const refDoubleAmpMd = [
			"![A][pic]",
			"",
			'[pic]: /x.png "Caption &amp;amp;#123;width=50%&#125;"',
		].join("\n");
		expect(
			parseMarkdownToVisualDoc(refDoubleAmpMd).firstChild?.firstChild?.attrs,
		).toMatchObject({
			scale: null,
			title: "Caption &amp;#123;width=50%}",
		});
	});
});

describe("PR-R16-A title entity protection, CR/LF encoding, reference precedence, and O(N) scaling", () => {
	it("protects literal entity-shaped tokens and encodes CR/LF unconditionally in image and link titles", () => {
		// Editing sibling text beside an entity-newline `# second` title must never
		// emit a raw newline that interrupts the paragraph as an ATX heading.
		const hashTitleMd =
			String.raw`![demo](/img "Caption\&#10;# second {width=50%}") previous`;
		const hashGuard = createMarkdownRoundTripGuard(hashTitleMd);
		const hashView = createEditorView(hashTitleMd);
		hashView.dispatch(
			hashView.state.tr.insertText("!", hashView.state.doc.content.size - 1),
		);
		const hashSerialized = hashGuard.serialize(hashView.state.doc);
		expect(hashSerialized).toBe(
			'![demo](/img "Caption&#10;# second {width=50%}") previous!',
		);
		expect(parseMarkdownToVisualDoc(hashSerialized).eq(hashView.state.doc)).toBe(
			true,
		);

		// Literal entity-shaped `&` tokens survive round-trip verbatim while plain
		// `&` (e.g. `"Tom & Jerry"`) stays unescaped.
		const literalEntityCases = [
			{
				expectedSerialized: '![A](/x.png "Caption&amp;#123;note}")',
				expectedTitle: "Caption&#123;note}",
				input: String.raw`![A](/x.png "Caption\&amp;#123;note}")`,
				scale: null,
			},
			{
				expectedSerialized: '![A](/x.png "Caption&amp;#10;# second")',
				expectedTitle: "Caption&#10;# second",
				input: '![A](/x.png "Caption&amp;#10;# second")',
				scale: null,
			},
			{
				expectedSerialized: '![A](/x.png "Tom & Jerry {width=50%}")',
				expectedTitle: "Tom & Jerry",
				input: '![A](/x.png "Tom & Jerry {width=50%}")',
				scale: 50,
			},
			{
				expectedSerialized:
					'![alt](https://example.com/a.png "Line 1&#10;> Foo {width=50%}")',
				expectedTitle: "Line 1\n> Foo",
				input: '![alt](https://example.com/a.png "Line 1&#10;> Foo {width=50%}")',
				scale: 50,
			},
			{
				expectedSerialized:
					'![alt](https://example.com/a.png "Line 1&#13;Line 2 {width=50%}")',
				expectedTitle: "Line 1\rLine 2",
				input:
					'![alt](https://example.com/a.png "Line 1&#13;Line 2 {width=50%}")',
				scale: 50,
			},
		] as const;

		for (const testCase of literalEntityCases) {
			const doc = parseMarkdownToVisualDoc(testCase.input);
			expect(doc.firstChild?.firstChild?.attrs, testCase.input).toMatchObject({
				scale: testCase.scale,
				title: testCase.expectedTitle,
			});
			const serialized = serializeVisualDocToMarkdown(doc);
			expect(serialized, testCase.input).toBe(testCase.expectedSerialized);
			expect(
				parseMarkdownToVisualDoc(serialized).eq(doc),
				testCase.input,
			).toBe(true);
		}

		// Link titles also protect entity-shaped `&` and encode all CR/LF.
		for (const linkInput of [
			'[text](https://example.com "Line 1&#10;> Foo")',
			'[text](https://example.com "Line 1&#13;Line 2")',
			'[text](https://example.com "Caption&amp;#10;# second")',
			'[text](https://example.com "Tom & Jerry")',
		]) {
			const doc = parseMarkdownToVisualDoc(linkInput);
			const serialized = serializeVisualDocToMarkdown(doc);
			expect(serialized, linkInput).toBe(linkInput);
			expect(parseMarkdownToVisualDoc(serialized).eq(doc), linkInput).toBe(
				true,
			);
		}
	});

	it("decodes numeric entities in inline and reference image titles with PHP Html5EntityDecoder parity", () => {
		const inlineDoc = parseMarkdownToVisualDoc(
			'![a](/x.png "&#128; &#159; &#x2FFFF; &#x30000; &#xD800; {width=50%}")',
		);
		expect(inlineDoc.firstChild?.firstChild?.attrs).toMatchObject({
			scale: 50,
			title: `\u0080 \u009F ${String.fromCodePoint(0x2ffff)} \uFFFD \uFFFD`,
		});

		const refDoc = parseMarkdownToVisualDoc(
			[
				"![a][r]",
				"",
				'[r]: /x.png "&#128; &#x30000; {width=67%}"',
			].join("\n"),
		);
		expect(refDoc.firstChild?.firstChild?.attrs).toMatchObject({
			scale: 67,
			title: "\u0080 \uFFFD",
		});
	});

	it("handles 0-3 space next-line reference titles and CommonMark first-wins precedence across multiline fallthrough", () => {
		// Next-line title starting at column 0 (0 leading spaces) with PHP two-pass unescaping.
		const nextLineRef = [
			"![alt][r]",
			"",
			"[r]: https://example.com/a.png",
			String.raw`"\&amp; {width=50%}"`,
		].join("\n");
		const nextLineDoc = parseMarkdownToVisualDoc(nextLineRef);
		expect(nextLineDoc.childCount).toBe(2);
		expect(nextLineDoc.child(0).firstChild?.attrs).toMatchObject({
			scale: 50,
			src: "https://example.com/a.png",
			title: "&",
		});
		expect(nextLineDoc.child(1).type.name).toBe("protected_block");

		// A deeper blockquote line after a reference definition is never stolen as its title.
		const bqAfterRef = [
			"![alt][r]",
			"",
			"[r]: https://example.com/a.png",
			'> "quoted paragraph"',
		].join("\n");
		const bqAfterRefDoc = parseMarkdownToVisualDoc(bqAfterRef);
		expect(bqAfterRefDoc.child(0).firstChild?.attrs).toMatchObject({
			scale: null,
			src: "https://example.com/a.png",
			title: null,
		});
		const lastBlock = bqAfterRefDoc.child(bqAfterRefDoc.childCount - 1);
		expect(lastBlock.type.name).toBe("blockquote");
		expect(lastBlock.textContent).toBe('"quoted paragraph"');

		// First-wins precedence when an earlier multiline reference definition falls
		// through to markdown-it and a later definition with the same label matches
		// the prescanner.
		const firstWinsMultiline = [
			"![alt][r]",
			"",
			'[r]: https://example.com/first.png "line 1',
			'line 2"',
			"",
			'[r]: https://example.com/second.png "other"',
		].join("\n");
		const firstWinsDoc = parseMarkdownToVisualDoc(firstWinsMultiline);
		expect(firstWinsDoc.firstChild?.firstChild?.attrs).toMatchObject({
			scale: null,
			src: "https://example.com/first.png",
			title: "line 1\nline 2",
		});

		// Same first-wins precedence when the earlier multiline title starts on the next line.
		const firstWinsNextLineMultiline = [
			"![alt][r]",
			"",
			"[r]: https://example.com/first.png",
			String.raw`"\&amp; line 1`,
			'line 2 {width=50%}"',
			"",
			'[r]: https://example.com/second.png "other"',
		].join("\n");
		const firstWinsNextLineDoc = parseMarkdownToVisualDoc(
			firstWinsNextLineMultiline,
		);
		expect(firstWinsNextLineDoc.firstChild?.firstChild?.attrs).toMatchObject({
			scale: 50,
			src: "https://example.com/first.png",
			title: "& line 1\nline 2",
		});

		// When an earlier `[r]:` line is not actually a valid reference definition,
		// the later definition still resolves cleanly through markdown-it.
		const invalidThenValid = [
			"![alt][r]",
			"",
			"[r]: <bad",
			"",
			'[r]: https://example.com/second.png "other"',
		].join("\n");
		const invalidThenValidDoc = parseMarkdownToVisualDoc(invalidThenValid);
		expect(invalidThenValidDoc.firstChild?.firstChild?.attrs).toMatchObject({
			scale: null,
			src: "https://example.com/second.png",
			title: "other",
		});
	});

	it("parses 4,000 reference definitions and 4,000 paragraphs in linear time without O(N^2) overhead", () => {
		const count = 4000;
		const defs: string[] = [];
		const paragraphs: string[] = [];
		for (let i = 0; i < count; i += 1) {
			defs.push(`[r${i}]: https://example.com/${i}.png "t${i}"`);
			paragraphs.push(`Paragraph ${i} with [r${i}][r${i}]`);
		}
		const markdown = `${defs.join("\n")}\n\n${paragraphs.join("\n\n")}`;
		expect(markdown.length).toBeGreaterThan(150_000);

		const started = performance.now();
		const parsed = parseMarkdownWithBlockSources(markdown);
		const elapsedMs = performance.now() - started;

		expect(elapsedMs).toBeLessThan(2000);
		expect(parsed.doc.childCount).toBe(count + 1);
		expect(firstLinkHref(parsed.doc)).toBe("https://example.com/0.png");
	});
});

describe("PR-R17-A reference definition preservation, inline link title parity, WP KSES image-title protection, and tight-list HR separation", () => {
	const editAt = (
		doc: ProseMirrorNode,
		pos: number,
		text: string,
	): ProseMirrorNode =>
		EditorState.create({ doc, schema: visualEditorSchema }).tr.insertText(
			text,
			pos,
		).doc;

	const firstImageAttrs = (doc: ProseMirrorNode) => {
		let found: Record<string, unknown> | null = null;
		doc.descendants((node) => {
			if (found === null && node.type.name === "image") {
				found = node.attrs as Record<string, unknown>;
			}
			return found === null;
		});
		return found;
	};

	const firstLinkAttrs = (doc: ProseMirrorNode) => {
		let found: Record<string, unknown> | null = null;
		doc.descendants((node) => {
			if (found === null && node.isText) {
				const mark = node.marks.find((m) => m.type.name === "link");
				if (mark) {
					found = mark.attrs as Record<string, unknown>;
				}
			}
			return found === null;
		});
		return found;
	};

	it("preserves all CommonMark §4.7 reference definitions across adjacent edits without silent deletion (Track A #1, #5 & Track B #1, #4)", () => {
		// 1. Bare destination containing `<` (`[r]: /a<b`) stays protected on adjacent edit.
		const angleDestMd = "Intro\n\n[r]: /a<b\n\n![x][r]";
		const angleGuard = createMarkdownRoundTripGuard(angleDestMd);
		expect(firstImageAttrs(angleGuard.initialDoc)).toMatchObject({
			alt: "x",
			src: "/a%3Cb",
		});
		const angleEdited = angleGuard.serialize(
			editAt(angleGuard.initialDoc, 6, "!"),
		);
		expect(angleEdited).toBe("Intro!\n\n[r]: /a<b\n\n![x][r]");
		expect(firstImageAttrs(parseMarkdownToVisualDoc(angleEdited))).toMatchObject(
			{ src: "/a%3Cb" },
		);

		// 2. Multi-line title on the next line stays protected and resolves verbatim.
		const multilineTitleMd =
			'Intro\n\n[img]: https://example.com/a.png\n"line 1\nline 2"\n\n![x][img]';
		const multilineGuard = createMarkdownRoundTripGuard(multilineTitleMd);
		expect(firstImageAttrs(multilineGuard.initialDoc)).toMatchObject({
			src: "https://example.com/a.png",
			title: "line 1\nline 2",
		});
		const multilineEdited = multilineGuard.serialize(
			editAt(multilineGuard.initialDoc, 6, "!"),
		);
		expect(multilineEdited).toBe(
			'Intro!\n\n[img]: https://example.com/a.png\n"line 1\nline 2"\n\n![x][img]',
		);
		expect(
			extractReferenceDefinitionLabels(
				'[img]: https://example.com/a.png\n"line 1\nline 2"',
			),
		).toEqual(["img"]);

		// 3. Unindented next-line destination with title stays protected.
		const unindentedDestMd =
			'Intro\n\n[img]:\nhttps://example.com/a.png "cap"\n\n![x][img]';
		const unindentedGuard = createMarkdownRoundTripGuard(unindentedDestMd);
		expect(firstImageAttrs(unindentedGuard.initialDoc)).toMatchObject({
			src: "https://example.com/a.png",
			title: "cap",
		});
		const unindentedEdited = unindentedGuard.serialize(
			editAt(unindentedGuard.initialDoc, 6, "!"),
		);
		expect(unindentedEdited).toBe(
			'Intro!\n\n[img]:\nhttps://example.com/a.png "cap"\n\n![x][img]',
		);
		expect(
			extractReferenceDefinitionLabels(
				'[img]:\nhttps://example.com/a.png "cap"',
			),
		).toEqual(["img"]);

		// 4. Destination-only definition followed by `"Quote" said Alice.` keeps both blocks.
		const quoteAfterDestMd = '[r]: /a\n"Quote" said Alice.\n\n![x][r]';
		const quoteGuard = createMarkdownRoundTripGuard(quoteAfterDestMd);
		expect(quoteGuard.initialDoc.childCount).toBe(3);
		expect(quoteGuard.initialDoc.child(0).type.name).toBe("protected_block");
		expect(quoteGuard.initialDoc.child(1).type.name).toBe("paragraph");
		expect(quoteGuard.initialDoc.child(1).textContent).toBe(
			'"Quote" said Alice.',
		);
		expect(firstImageAttrs(quoteGuard.initialDoc)).toMatchObject({
			src: "/a",
			title: null,
		});
		const quoteParaEnd =
			quoteGuard.initialDoc.child(0).nodeSize +
			quoteGuard.initialDoc.child(1).nodeSize -
			1;
		const quoteEdited = quoteGuard.serialize(
			editAt(quoteGuard.initialDoc, quoteParaEnd, "!"),
		);
		expect(quoteEdited).toBe('[r]: /a\n\n"Quote" said Alice.!\n\n![x][r]');
		expect(
			firstImageAttrs(parseMarkdownToVisualDoc(quoteEdited)),
		).toMatchObject({ src: "/a", title: null });

		// 5. First-wins precedence when earlier definition is nested in a list item or blockquote.
		const listFirstMd = "- [r]: /first\n\n[r]: /second\n\n![x][r]";
		const listFirstGuard = createMarkdownRoundTripGuard(listFirstMd);
		expect(firstImageAttrs(listFirstGuard.initialDoc)).toMatchObject({
			src: "/first",
		});
		const listFirstEdited = listFirstGuard.serialize(
			editAt(
				listFirstGuard.initialDoc,
				listFirstGuard.initialDoc.content.size - 1,
				"!",
			),
		);
		expect(listFirstEdited).toBe("- [r]: /first\n\n[r]: /second\n\n![x](/first)!");
		// Structural serialization of a list item with a ref def never doubles `- `.
		const listStructural = serializeVisualDocToMarkdown(
			listFirstGuard.initialDoc,
		);
		expect(listStructural).not.toContain("- -");
		expect(listStructural).not.toContain("  - [r]:");
		expect(
			firstImageAttrs(parseMarkdownToVisualDoc(listStructural)),
		).toMatchObject({ src: "/first" });

		// Multi-item list with ref def in item 1: editing item 2 preserves item 1 verbatim.
		const multiItemListMd = "- [r]: /first\n- Second item\n\n![x][r]";
		const multiItemGuard = createMarkdownRoundTripGuard(multiItemListMd);
		let secondItemPos = -1;
		multiItemGuard.initialDoc.descendants((node, pos) => {
			if (secondItemPos < 0 && node.isText && node.text === "Second item") {
				secondItemPos = pos + node.text.length;
			}
			return secondItemPos < 0;
		});
		const multiItemEdited = multiItemGuard.serialize(
			editAt(multiItemGuard.initialDoc, secondItemPos, "!"),
		);
		expect(multiItemEdited).toBe("- [r]: /first\n- Second item!\n\n![x][r]");

		// 6. Invalid earlier line (`[r]: /bad(unclosed`) does not poison later valid `[r]: /good`.
		const invalidFirstMd = "[r]: /bad(unclosed\n\n[r]: /good\n\n![x][r]";
		const invalidFirstDoc = parseMarkdownToVisualDoc(invalidFirstMd);
		expect(firstImageAttrs(invalidFirstDoc)).toMatchObject({ src: "/good" });
		expect(invalidFirstDoc.child(0).type.name).toBe("paragraph");
		expect(invalidFirstDoc.child(1).type.name).toBe("protected_block");
		expect(firstLinkHref(invalidFirstDoc)).toBe("/good");

		// 7. Unicode case-folding (`[ẞ]` vs `SS` and `[ß]` vs `SS`) matches PHP CommonMark.
		for (const sharpMd of [
			"Intro\n\n[ẞ]: /sharp\n\n![x][SS]",
			"Intro\n\n[ß]: /sharp\n\n![x][SS]",
		]) {
			const sharpGuard = createMarkdownRoundTripGuard(sharpMd);
			expect(firstImageAttrs(sharpGuard.initialDoc), sharpMd).toMatchObject({
				src: "/sharp",
			});
			const sharpEdited = sharpGuard.serialize(
				editAt(sharpGuard.initialDoc, 6, "!"),
			);
			expect(sharpEdited).toBe(sharpMd.replace("Intro", "Intro!"));
		}

		// 8. Zero-whitespace `<dest>"title"` is rejected (matching PHP CommonMark).
		const zeroWsMd = '[r]: </dest>"title"\n\n![x][r]';
		const zeroWsDoc = parseMarkdownToVisualDoc(zeroWsMd);
		expect(firstImageAttrs(zeroWsDoc)).toBeNull();
		expect(zeroWsDoc.child(0).type.name).toBe("paragraph");

		// 9. Unescaped punctuation, HTML entities, and balanced parens in href match PHP.
		expect(
			firstLinkHref(parseMarkdownToVisualDoc("[r]: /a\\)b\n\n[x][r]")),
		).toBe("/a)b");
		expect(
			firstLinkHref(parseMarkdownToVisualDoc("[r]: /a&amp;b\n\n[x][r]")),
		).toBe("/a&b");
		expect(
			firstLinkHref(parseMarkdownToVisualDoc("[r]: /a(b)c\n\n[x][r]")),
		).toBe("/a(b)c");

		// 10. Cross-blockquote grouping keeps `> [a]: /a` inside blockquote and `[b]: /b` outside.
		const crossBqMd = "> [a]: /a\n[b]: /b\n\n[a] [b]";
		const crossBqGuard = createMarkdownRoundTripGuard(crossBqMd);
		expect(crossBqGuard.initialDoc.childCount).toBe(3);
		expect(crossBqGuard.initialDoc.child(0).type.name).toBe("blockquote");
		expect(crossBqGuard.initialDoc.child(0).firstChild?.type.name).toBe(
			"protected_block",
		);
		expect(crossBqGuard.initialDoc.child(0).firstChild?.attrs.rawMarkdown).toBe(
			"[a]: /a",
		);
		expect(crossBqGuard.initialDoc.child(1).type.name).toBe("protected_block");
		expect(crossBqGuard.initialDoc.child(1).attrs.rawMarkdown).toBe("[b]: /b");
		const crossBqEdited = crossBqGuard.serialize(
			editAt(
				crossBqGuard.initialDoc,
				crossBqGuard.initialDoc.content.size - 1,
				"!",
			),
		);
		expect(crossBqEdited).toBe("> [a]: /a\n[b]: /b\n\n[a](/a) [b](/b)!");
		const crossBqStructural = serializeVisualDocToMarkdown(
			crossBqGuard.initialDoc,
		);
		expect(crossBqStructural).toContain("> [a]: /a");
		expect(crossBqStructural).not.toContain("> >");
		expect(crossBqStructural).toContain("\n\n[b]: /b");

		// Multi-line reference definition inside blockquote strips `> ` cleanly on edit.
		const bqMultilineRef =
			'> # Title\n>\n> [r]: /first\n> "line 1\n> line 2"\n\n![x][r]';
		const bqMultiGuard = createMarkdownRoundTripGuard(bqMultilineRef);
		expect(firstImageAttrs(bqMultiGuard.initialDoc)).toMatchObject({
			src: "/first",
			title: "line 1\nline 2",
		});
		const bqMultiEdited = bqMultiGuard.serialize(
			editAt(bqMultiGuard.initialDoc, 3, "Z"),
		);
		expect(bqMultiEdited).toContain('> [r]: /first\n> "line 1\n> line 2"');
		expect(bqMultiEdited).not.toContain("> >");

		// 11. Inline sentinel restoration runs BEFORE CommonMark entity decoding (Track B #4.5).
		const sentinelTitleMd = '[r]: /dest\n"$a &amp; b$"\n\n![x][r]';
		const sentinelTitleDoc = parseMarkdownToVisualDoc(sentinelTitleMd);
		expect(firstImageAttrs(sentinelTitleDoc)).toMatchObject({
			src: "/dest",
			title: "$a & b$",
		});
		expect(sentinelTitleDoc.child(0).attrs.rawMarkdown).toBe(
			'[r]: /dest\n"$a &amp; b$"',
		);

		const sentinelHrefMd = "[r]: /dest?x=$a+b$\n\n[x][r]";
		const sentinelHrefDoc = parseMarkdownToVisualDoc(sentinelHrefMd);
		expect(firstLinkHref(sentinelHrefDoc)).toBe("/dest?x=$a+b$");
		expect(sentinelHrefDoc.child(0).attrs.rawMarkdown).toBe(
			"[r]: /dest?x=$a+b$",
		);

		const sentinelHrefEntityMd = "[r]: /dest?x=$a&amp;b$\n\n[x][r]";
		expect(firstLinkHref(parseMarkdownToVisualDoc(sentinelHrefEntityMd))).toBe(
			"/dest?x=$a&b$",
		);
	});

	it("decodes raw inline link titles with PHP Html5EntityDecoder parity without Windows-1252 remapping (Track A #6)", () => {
		const inlineLinkMd = '[x](/d "&#128;")';
		const guard = createMarkdownRoundTripGuard(inlineLinkMd);
		expect(firstLinkAttrs(guard.initialDoc)).toEqual({
			href: "/d",
			title: "\u0080",
		});

		// Editing link text `"x"` -> `"y"` preserves U+0080 (NOT `€` and NOT `&amp;#128;`).
		const linkMarks = guard.initialDoc.firstChild?.firstChild?.marks ?? [];
		const editedDoc = EditorState.create({
			doc: guard.initialDoc,
			schema: visualEditorSchema,
		}).tr.replaceWith(1, 2, visualEditorSchema.text("y", linkMarks)).doc;
		const serialized = guard.serialize(editedDoc);
		expect(serialized).toBe('[y](/d "\u0080")');
		expect(serialized).not.toContain("€");
		expect(serialized).not.toContain("&amp;#128;");
		expect(firstLinkAttrs(parseMarkdownToVisualDoc(serialized))).toEqual({
			href: "/d",
			title: "\u0080",
		});

		// Single-quoted, parenthesized, out-of-range, two-pass, literal entity, and nested image+link.
		expect(firstLinkAttrs(parseMarkdownToVisualDoc("[x](/d '&#128;')"))).toEqual(
			{ href: "/d", title: "\u0080" },
		);
		expect(firstLinkAttrs(parseMarkdownToVisualDoc("[x](/d (&#128;))"))).toEqual(
			{ href: "/d", title: "\u0080" },
		);
		expect(
			firstLinkAttrs(
				parseMarkdownToVisualDoc(
					'[x](/d "&#128; &#159; &#x2FFFF; &#x30000; &#xD800; &#0;")',
				),
			),
		).toEqual({
			href: "/d",
			title: `\u0080 \u009F ${String.fromCodePoint(0x2ffff)} \uFFFD \uFFFD \uFFFD`,
		});
		expect(
			firstLinkAttrs(parseMarkdownToVisualDoc(String.raw`[x](/d "\&amp;")`)),
		).toEqual({ href: "/d", title: "&" });
		expect(
			firstLinkAttrs(parseMarkdownToVisualDoc('[x](/d "&amp;#128;")')),
		).toEqual({ href: "/d", title: "&#128;" });

		const nestedDoc = parseMarkdownToVisualDoc(
			'[![img](/i.png "&#129;")](/d "&#128;")',
		);
		expect(firstImageAttrs(nestedDoc)).toMatchObject({
			src: "/i.png",
			title: "\u0081",
		});
		let imageLinkTitle: unknown = null;
		nestedDoc.descendants((node) => {
			if (node.type.name === "image") {
				imageLinkTitle =
					node.marks.find((m) => m.type.name === "link")?.attrs.title ?? null;
			}
		});
		expect(imageLinkTitle).toBe("\u0080");

		// Reference links and broken inline links falling back to reference definitions.
		expect(
			firstLinkAttrs(
				parseMarkdownToVisualDoc('[x][r]\n\n[r]: /d "&#128;"'),
			),
		).toEqual({ href: "/d", title: "\u0080" });
		expect(
			firstLinkAttrs(
				parseMarkdownToVisualDoc(
					'[foo](bar "&#128;"\n\n[foo]: /ref "ref &#129;"',
				),
			),
		).toEqual({ href: "/ref", title: "ref \u0081" });
	});

	it("protects serialized scaled and unscaled image titles against WP Core wp_kses_normalize_entities() double-decoding conflicts (Track A #2)", () => {
		const serializeImg = (title: string | null, scale: number | null): string =>
			serializeVisualDocToMarkdown(
				visualEditorSchema.nodes.doc.create(null, [
					visualEditorSchema.nodes.paragraph.create(null, [
						visualEditorSchema.nodes.image.create({
							src: "/x.png",
							alt: "A",
							title,
							scale,
						}),
					]),
				]),
			);

		// Scaled images: decimal, hex, leading-zero, tab-padded, C0-control, and marker-only entity conflicts.
		expect(serializeImg("Caption &#123;width=51%&#125;", 50)).toBe(
			'![A](/x.png "Caption {width=50%}")',
		);
		expect(serializeImg("Caption &#x7b;width=51%&#x7d;", 50)).toBe(
			'![A](/x.png "Caption {width=50%}")',
		);
		expect(serializeImg("Caption &#00000000123;width=51%&#00000000125;", 50)).toBe(
			'![A](/x.png "Caption {width=50%}")',
		);
		expect(serializeImg("&#123;width=51%&#125;", 50)).toBe(
			'![A](/x.png "{width=50%}")',
		);
		expect(serializeImg("Caption {width=51%}\x01", 50)).toBe(
			'![A](/x.png "Caption {width=50%}")',
		);
		expect(serializeImg("Caption {width=51%}&#9;", 50)).toBe(
			'![A](/x.png "Caption {width=50%}")',
		);

		// Unscaled images: numeric-entity or C0-control markers that WP KSES would decode into `{width=...}`.
		expect(serializeImg("Caption &#123;width=51%&#125;", null)).toBe(
			'![A](/x.png "Caption")',
		);
		expect(serializeImg("Caption &#123;width=50%&#125;", null)).toBe(
			'![A](/x.png "Caption")',
		);
		expect(serializeImg("Caption&#123;width=50%}", null)).toBe(
			'![A](/x.png "Caption")',
		);
		expect(serializeImg("&#123;width=51%&#125;", null)).toBe("![A](/x.png)");
		expect(serializeImg("Caption {width=51%}\x01", null)).toBe(
			'![A](/x.png "Caption")',
		);

		// Safe double-encoded `&amp;#123;...` and non-marker `&#123;note&#125;` still preserve verbatim.
		expect(serializeImg("Caption &amp;#123;width=51%&amp;#125;", 50)).toBe(
			'![A](/x.png "Caption &amp;amp;#123;width=51%&amp;amp;#125; {width=50%}")',
		);
		expect(serializeImg("Caption &#123;note&#125;", 50)).toBe(
			'![A](/x.png "Caption &amp;#123;note&amp;#125; {width=50%}")',
		);
	});

	it("emits *** for horizontal_rule after paragraph inside a tight list to prevent Setext H2 corruption while preserving tightness", () => {
		const tightListDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.bullet_list.create({ marker: "-", tight: true }, [
				visualEditorSchema.nodes.list_item.create(null, [
					visualEditorSchema.nodes.paragraph.create(null, [
						visualEditorSchema.text("Hello"),
					]),
					visualEditorSchema.nodes.horizontal_rule.create(),
				]),
			]),
		]);

		const serialized = serializeVisualDocToMarkdown(tightListDoc);
		expect(serialized).toBe("- Hello\n  ***");

		const reparsed = parseMarkdownToVisualDoc(serialized);
		expect(reparsed.firstChild?.attrs.tight).toBe(true);
		const item = reparsed.firstChild?.firstChild;
		expect(item?.childCount).toBe(2);
		expect(item?.child(0).type.name).toBe("paragraph");
		expect(item?.child(0).textContent).toBe("Hello");
		expect(item?.child(1).type.name).toBe("horizontal_rule");

		// A horizontal_rule after a non-paragraph block (e.g. heading) still keeps tight separation.
		const tightAfterHeadingDoc = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.bullet_list.create({ marker: "-", tight: true }, [
				visualEditorSchema.nodes.list_item.create(null, [
					visualEditorSchema.nodes.paragraph.create(),
					visualEditorSchema.nodes.heading.create({ level: 2 }, [
						visualEditorSchema.text("Title"),
					]),
					visualEditorSchema.nodes.horizontal_rule.create(),
				]),
			]),
		]);
		const headingHrSerialized =
			serializeVisualDocToMarkdown(tightAfterHeadingDoc);
		expect(headingHrSerialized).toBe("-\n  ## Title\n  ---");
		const headingHrReparsed = parseMarkdownToVisualDoc(headingHrSerialized);
		expect(headingHrReparsed.firstChild?.attrs.tight).toBe(true);
		const headingItem = headingHrReparsed.firstChild?.firstChild;
		expect(headingItem?.child(1).type.name).toBe("heading");
		expect(headingItem?.child(2).type.name).toBe("horizontal_rule");
	});
});

describe("PR-R18-A WP KSES visual title parity, refdef task items, tight-list preservation, and 4-space continuation guards", () => {
	const findTextEndPos = (doc: ProseMirrorNode, needle: string): number => {
		let found = -1;
		doc.descendants((node, pos) => {
			if (found < 0 && node.isText && node.text === needle) {
				found = pos + node.text.length;
			}
			return found < 0;
		});
		return found;
	};

	const insertAt = (
		doc: ProseMirrorNode,
		pos: number,
		text: string,
	): ProseMirrorNode =>
		EditorState.create({ doc, schema: visualEditorSchema }).tr.insertText(
			text,
			pos,
		).doc;

	it("parses WP KSES C0-control and numeric-entity image scale titles identically to PHP MarkdownRenderer (Track B #2)", () => {
		for (const input of [
			'![A](/x.png "Caption {width=50%}&#1;")',
			'![A](/x.png "Caption {width=50&#1;%}")',
			'![A](/x.png "Caption {width=50%}\x07")',
			'![A](/x.png "Caption &amp;#123;width=50%&amp;#125;")',
			'![A](/x.png "Caption &#00000123;width=50%&#00000125;")',
			'![A](/x.png "Caption {width=50%}&amp;#0;")',
			'![A](/x.png "Caption {width=50%}&amp;#x0;")',
		]) {
			const doc = parseMarkdownToVisualDoc(input);
			expect(doc.firstChild?.firstChild?.attrs, input).toMatchObject({
				scale: 50,
				title: "Caption",
			});
		}

		// Invalid scale markers hidden behind C0 controls or WP KSES entities stay unscaled
		// and strip their conflicting marker on serialization.
		for (const invalidInput of [
			'![A](/x.png "Caption {width=51%}&#1;")',
			'![A](/x.png "Caption &amp;#123;width=51%&amp;#125;")',
		]) {
			const doc = parseMarkdownToVisualDoc(invalidInput);
			expect(doc.firstChild?.firstChild?.attrs.scale, invalidInput).toBeNull();
			expect(serializeVisualDocToMarkdown(doc), invalidInput).toBe(
				'![A](/x.png "Caption")',
			);
		}
	});

	it("keeps leading reference-definition task items in one task_list across edits and checkbox toggles (Track A #1)", () => {
		const markdown = "- [r]: /x\n  [x] One\n- [ ] Two";
		const guard = createMarkdownRoundTripGuard(markdown);
		const doc = guard.initialDoc;

		expect(doc.childCount).toBe(1);
		const taskList = doc.child(0);
		expect(taskList.type.name).toBe("task_list");
		expect(taskList.attrs.tight).toBe(true);
		expect(taskList.childCount).toBe(2);

		const item0 = taskList.child(0);
		expect(item0.type.name).toBe("task_item");
		expect(item0.attrs.checked).toBe(true);
		expect(item0.child(1).type.name).toBe("protected_block");
		expect(item0.child(1).attrs.rawMarkdown).toBe("[r]: /x");
		expect(item0.child(2).type.name).toBe("paragraph");
		expect(item0.child(2).textContent).toBe("One");

		const item1 = taskList.child(1);
		expect(item1.type.name).toBe("task_item");
		expect(item1.attrs.checked).toBe(false);
		expect(item1.textContent).toBe("Two");

		// Unmodified round-trip returns exact original Markdown.
		expect(guard.serialize(doc)).toBe(markdown);

		// Editing "One" -> "One!" preserves [r]: /x, checkbox placement, and tight list.
		const oneEnd = findTextEndPos(doc, "One");
		expect(oneEnd).toBeGreaterThan(0);
		const editedDoc = insertAt(doc, oneEnd, "!");
		const editedMarkdown = guard.serialize(editedDoc);
		expect(editedMarkdown).toBe("- [r]: /x\n  [x] One!\n- [ ] Two");
		expect(parseMarkdownToVisualDoc(editedMarkdown).eq(editedDoc)).toBe(true);

		// Toggling checkbox on item 0 preserves [r]: /x and tight list.
		let item0Pos = -1;
		doc.descendants((node, pos) => {
			if (item0Pos < 0 && node.type.name === "task_item") {
				item0Pos = pos;
			}
			return item0Pos < 0;
		});
		const toggledDoc = EditorState.create({
			doc,
			schema: visualEditorSchema,
		}).tr.setNodeMarkup(item0Pos, undefined, { checked: false }).doc;
		const toggledMarkdown = guard.serialize(toggledDoc);
		expect(toggledMarkdown).toBe("- [r]: /x\n  [ ] One\n- [ ] Two");
		expect(parseMarkdownToVisualDoc(toggledMarkdown).eq(toggledDoc)).toBe(true);

		// Arbitrary HTML or math protected blocks are NOT skipped as task prefixes.
		for (const nonRefTask of [
			"- <div>html</div>\n\n  [x] One\n- [ ] Two",
			"- $$x$$\n\n  [x] One\n- [ ] Two",
		]) {
			const nonRefDoc = parseMarkdownToVisualDoc(nonRefTask);
			expect(nonRefDoc.childCount, nonRefTask).toBe(2);
			expect(nonRefDoc.child(0).type.name, nonRefTask).toBe("bullet_list");
			expect(nonRefDoc.child(1).type.name, nonRefTask).toBe("task_list");
		}
	});

	it("preserves tight-list semantics on paragraph+HR and refdef+paragraph edits while keeping title clashes safe (Track A #2)", () => {
		// 1. Tight list with paragraph + horizontal_rule: editing One -> One! stays tight and HR.
		const hrListMd = "- One\n  ***\n- Two";
		const hrGuard = createMarkdownRoundTripGuard(hrListMd);
		expect(hrGuard.initialDoc.firstChild?.attrs.tight).toBe(true);
		const hrEditedDoc = insertAt(
			hrGuard.initialDoc,
			findTextEndPos(hrGuard.initialDoc, "One"),
			"!",
		);
		const hrEditedMd = hrGuard.serialize(hrEditedDoc);
		expect(hrEditedMd).toBe("- One!\n  ***\n- Two");
		const hrReparsed = parseMarkdownToVisualDoc(hrEditedMd);
		expect(hrReparsed.firstChild?.attrs.tight).toBe(true);
		expect(hrReparsed.firstChild?.child(0).child(0).type.name).toBe("paragraph");
		expect(hrReparsed.firstChild?.child(0).child(0).textContent).toBe("One!");
		expect(hrReparsed.firstChild?.child(0).child(1).type.name).toBe(
			"horizontal_rule",
		);

		// 2. Tight list with refdef + paragraph: editing One -> One! stays tight and preserves [r]: /x.
		const refListMd = "- [r]: /x\n  One\n- Two";
		const refGuard = createMarkdownRoundTripGuard(refListMd);
		expect(refGuard.initialDoc.firstChild?.attrs.tight).toBe(true);
		const refEditedDoc = insertAt(
			refGuard.initialDoc,
			findTextEndPos(refGuard.initialDoc, "One"),
			"!",
		);
		const refEditedMd = refGuard.serialize(refEditedDoc);
		expect(refEditedMd).toBe("- [r]: /x\n  One!\n- Two");
		const refReparsed = parseMarkdownToVisualDoc(refEditedMd);
		expect(refReparsed.firstChild?.attrs.tight).toBe(true);
		expect(refReparsed.firstChild?.child(0).child(1).attrs.rawMarkdown).toBe(
			"[r]: /x",
		);
		expect(refReparsed.firstChild?.child(0).child(2).textContent).toBe("One!");

		// 3. Title-less refdef followed by a title-like paragraph ("Title") keeps a blank line so
		// CommonMark never absorbs "Title" as the reference's title.
		const looseSafeMd = '- [r]: /x\n\n  "Title"\n- Two';
		const looseGuard = createMarkdownRoundTripGuard(looseSafeMd);
		const looseEditedDoc = insertAt(
			looseGuard.initialDoc,
			findTextEndPos(looseGuard.initialDoc, '"Title"'),
			"!",
		);
		const looseEditedMd = looseGuard.serialize(looseEditedDoc);
		expect(looseEditedMd).toBe('- [r]: /x\n\n  "Title"!\n- Two');
		expect(
			parseMarkdownToVisualDoc(looseEditedMd)
				.firstChild?.child(0)
				.child(2).textContent,
		).toBe('"Title"!');

		// Editing a tight refdef item's paragraph text into `"Title"` inserts a blank line for safety.
		const oneStart = findTextEndPos(refGuard.initialDoc, "One") - 3;
		const clashEditedDoc = EditorState.create({
			doc: refGuard.initialDoc,
			schema: visualEditorSchema,
		}).tr.replaceWith(
			oneStart,
			oneStart + 3,
			visualEditorSchema.text('"Title"'),
		).doc;
		const clashMd = refGuard.serialize(clashEditedDoc);
		expect(clashMd).toBe('- [r]: /x\n\n  "Title"\n- Two');
		expect(
			parseMarkdownToVisualDoc(clashMd).firstChild?.child(0).child(2).textContent,
		).toBe('"Title"');

		// 4. A refdef that ALREADY has a title stays tight even when followed by `"Quote"`.
		const titledRefMd = '- [r]: /x "Keep"\n  "Quote"\n- Two';
		const titledGuard = createMarkdownRoundTripGuard(titledRefMd);
		const titledEditedDoc = insertAt(
			titledGuard.initialDoc,
			findTextEndPos(titledGuard.initialDoc, '"Quote"'),
			"!",
		);
		const titledEditedMd = titledGuard.serialize(titledEditedDoc);
		expect(titledEditedMd).toBe('- [r]: /x "Keep"\n  "Quote"!\n- Two');
		expect(parseMarkdownToVisualDoc(titledEditedMd).firstChild?.attrs.tight).toBe(
			true,
		);
	});

	it("guards 4-space-indented paragraph continuations against sentinel code_block corruption (Track B #5)", () => {
		// 1. 4-space-indented block math after open paragraph parses as protected math block, NOT code_block.
		for (const mathMd of [
			"Para\n    $$x$$",
			"Para\n    \\[x\\]",
			"Para\n    $$\n    x\n    $$",
		]) {
			const doc = parseMarkdownToVisualDoc(mathMd);
			expect(doc.childCount, mathMd).toBe(2);
			expect(doc.child(0).type.name, mathMd).toBe("paragraph");
			expect(doc.child(0).textContent, mathMd).toBe("Para");
			expect(doc.child(1).type.name, mathMd).toBe("protected_block");
			expect(doc.child(1).attrs.kind, mathMd).toBe("math");
		}

		// 2. 4-space-indented footnote after open paragraph stays a paragraph continuation.
		const fnDoc = parseMarkdownToVisualDoc("Para\n    [^1]: note");
		expect(fnDoc.childCount).toBe(1);
		expect(fnDoc.child(0).type.name).toBe("paragraph");
		expect(fnDoc.child(0).textContent).toBe("Para\n[^1]: note");

		// 3. 4-space-indented HTML comment after open paragraph stays in paragraph (not code_block).
		const commentDoc = parseMarkdownToVisualDoc("Para\n    <!-- hi -->");
		expect(commentDoc.childCount).toBe(1);
		expect(commentDoc.child(0).type.name).toBe("paragraph");
		expect(commentDoc.child(0).childCount).toBeGreaterThanOrEqual(2);
		const commentLastChild = commentDoc.child(0).lastChild;
		expect(
			commentLastChild?.type.name === "protected_inline" &&
				commentLastChild.attrs.rawMarkdown === "<!-- hi -->",
		).toBe(true);

		// 4. 4-space-indented HTML block opener after open paragraph stays in paragraph
		//    with its raw HTML tags protected as `raw-inline` atoms (matching PHP strip).
		const htmlDoc = parseMarkdownToVisualDoc(
			"Para\n    <div>\n    hello\n    </div>",
		);
		expect(htmlDoc.childCount).toBe(1);
		expect(htmlDoc.child(0).type.name).toBe("paragraph");
		expect(htmlDoc.child(0).textContent).toBe("Para\n\nhello\n");
		expect(collectProtectedInlineRaws(htmlDoc)).toEqual(["<div>", "</div>"]);

		// 5. Reference definition followed by 4-space-indented HTML stays a paragraph
		//    continuation (matching PHP ParagraphParser), while a blank line before
		//    4-space-indented HTML produces a real indented code_block.
		const refContinuationMd =
			"[ref]: https://example.com\n    <div>\n    hello\n    </div>\n    more code";
		const refContinuationDoc = parseMarkdownToVisualDoc(refContinuationMd);
		expect(refContinuationDoc.childCount).toBe(2);
		expect(refContinuationDoc.child(0).type.name).toBe("protected_block");
		expect(refContinuationDoc.child(0).attrs.rawMarkdown).toBe(
			"[ref]: https://example.com",
		);
		expect(refContinuationDoc.child(1).type.name).toBe("paragraph");
		expect(refContinuationDoc.child(1).textContent).toBe(
			"\nhello\n\nmore code",
		);
		expect(collectProtectedInlineRaws(refContinuationDoc)).toEqual([
			"<div>",
			"</div>",
		]);

		const refBlankCodeMd =
			"[ref]: https://example.com\n\n    <div>\n    hello\n    </div>\n    more code";
		const refBlankCodeScan = prescanMarkdown(refBlankCodeMd);
		expect(refBlankCodeScan.protectedBlocks.size).toBe(0);
		expect(refBlankCodeScan.markdown).toBe(refBlankCodeMd);
		const refBlankCodeDoc = parseMarkdownToVisualDoc(refBlankCodeMd);
		expect(refBlankCodeDoc.childCount).toBe(2);
		expect(refBlankCodeDoc.child(0).type.name).toBe("protected_block");
		expect(refBlankCodeDoc.child(1).type.name).toBe("code_block");
		expect(refBlankCodeDoc.child(1).textContent).toBe(
			"<div>\nhello\n</div>\nmore code",
		);
	});
});

describe("PR-R19-A raw NUL image titles, PHP task-list parity, tight-list preservation, and 4-space inline HTML round-trips", () => {
	const findTextEndPos = (doc: ProseMirrorNode, needle: string): number => {
		let found = -1;
		doc.descendants((node, pos) => {
			if (found < 0 && node.isText && node.text === needle) {
				found = pos + node.text.length;
			}
			return found < 0;
		});
		return found;
	};

	const insertAt = (
		doc: ProseMirrorNode,
		pos: number,
		text: string,
	): ProseMirrorNode =>
		EditorState.create({ doc, schema: visualEditorSchema }).tr.insertText(
			text,
			pos,
		).doc;

	it("normalizes raw U+0000 in visual image titles to U+FFFD while keeping &#000; NUL stripping (Track A #7)", () => {
		const rawBefore = parseMarkdownToVisualDoc('![A](/i "\u0000{width=50%}")');
		expect(rawBefore.firstChild?.firstChild?.attrs).toMatchObject({
			scale: null,
			title: "\uFFFD{width=50%}",
		});

		const rawAfter = parseMarkdownToVisualDoc('![A](/i "{width=50%}\u0000")');
		expect(rawAfter.firstChild?.firstChild?.attrs).toMatchObject({
			scale: null,
			title: "{width=50%}\uFFFD",
		});

		const rawCaption = parseMarkdownToVisualDoc(
			'![A](/i "Caption \u0000{width=50%}")',
		);
		expect(rawCaption.firstChild?.firstChild?.attrs).toMatchObject({
			scale: null,
			title: "Caption \uFFFD{width=50%}",
		});

		const rawSpaced = parseMarkdownToVisualDoc('![A](/i "\u0000 {width=50%}")');
		expect(rawSpaced.firstChild?.firstChild?.attrs).toMatchObject({
			scale: 50,
			title: "\uFFFD",
		});

		const entityZeroPadded = parseMarkdownToVisualDoc(
			'![A](/i "&#000;{width=50%}")',
		);
		expect(entityZeroPadded.firstChild?.firstChild?.attrs).toMatchObject({
			scale: 50,
			title: null,
		});

		const refRawBefore = parseMarkdownToVisualDoc(
			'[r]: /i "\u0000{width=50%}"\n\n![A][r]',
		);
		expect(refRawBefore.child(1).firstChild?.attrs).toMatchObject({
			scale: null,
			title: "\uFFFD{width=50%}",
		});
	});

	it("matches PHP TaskListItemMarkerParser exactly and escapes literal \\[x] on non-task edits (Track A #4)", () => {
		// 1. Escaped `\[x]` after a leading refdef stays a plain bullet item and
		//    re-escapes `\[x]` when edited so PHP never renders a checkbox.
		const escapedRefMd = "- [r]: /r\n  \\[x] literal";
		const escapedRefGuard = createMarkdownRoundTripGuard(escapedRefMd);
		expect(escapedRefGuard.initialDoc.childCount).toBe(1);
		expect(escapedRefGuard.initialDoc.firstChild?.type.name).toBe(
			"bullet_list",
		);
		expect(escapedRefGuard.initialDoc.firstChild?.attrs.tight).toBe(true);
		expect(
			escapedRefGuard.initialDoc.firstChild?.firstChild?.child(2).textContent,
		).toBe("[x] literal");
		expect(escapedRefGuard.serialize(escapedRefGuard.initialDoc)).toBe(
			escapedRefMd,
		);
		const escapedRefEditedDoc = insertAt(
			escapedRefGuard.initialDoc,
			findTextEndPos(escapedRefGuard.initialDoc, "[x] literal"),
			"!",
		);
		const escapedRefEditedMd = escapedRefGuard.serialize(escapedRefEditedDoc);
		expect(escapedRefEditedMd).toBe("- [r]: /r\n  \\[x] literal!");
		expect(parseMarkdownToVisualDoc(escapedRefEditedMd).eq(escapedRefEditedDoc)).toBe(
			true,
		);

		// Plain escaped `\[x]` without a refdef also stays a plain bullet item.
		const plainEscapedGuard = createMarkdownRoundTripGuard("- \\[x] literal");
		expect(plainEscapedGuard.initialDoc.firstChild?.type.name).toBe(
			"bullet_list",
		);
		const plainEscapedEditedDoc = insertAt(
			plainEscapedGuard.initialDoc,
			findTextEndPos(plainEscapedGuard.initialDoc, "[x] literal"),
			"!",
		);
		expect(plainEscapedGuard.serialize(plainEscapedEditedDoc)).toBe(
			"- \\[x] literal!",
		);

		// 2. PHP-valid no-space, uppercase, newline, bold, code, and link-like task markers.
		for (const taskCase of [
			{ checked: true, md: "- [x]Task", text: "Task" },
			{ checked: true, md: "- [X]Task", text: "Task" },
			{ checked: false, md: "- [ ]Task", text: "Task" },
			{ checked: true, md: "- [x]\n  Task", text: "Task" },
			{ checked: true, md: "- [x] **bold**", text: "bold" },
			{ checked: true, md: "- [x]**bold**", text: "bold" },
			{ checked: true, md: "- [x]`code`", text: "code" },
		]) {
			const guard = createMarkdownRoundTripGuard(taskCase.md);
			const list = guard.initialDoc.firstChild;
			expect(list?.type.name, taskCase.md).toBe("task_list");
			expect(list?.firstChild?.type.name, taskCase.md).toBe("task_item");
			expect(list?.firstChild?.attrs.checked, taskCase.md).toBe(
				taskCase.checked,
			);
			expect(list?.firstChild?.textContent, taskCase.md).toBe(taskCase.text);
			expect(guard.serialize(guard.initialDoc), taskCase.md).toBe(taskCase.md);
			const editedDoc = insertAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, taskCase.text),
				"!",
			);
			const editedMd = guard.serialize(editedDoc);
			expect(parseMarkdownToVisualDoc(editedMd).eq(editedDoc), taskCase.md).toBe(
				true,
			);
		}

		// Hard break after `[x]` preserves the hard_break node (matching PHP `<br>`).
		const hardBreakTask = parseMarkdownToVisualDoc("- [x]  \n  Task");
		expect(hardBreakTask.firstChild?.type.name).toBe("task_list");
		const hbParagraph = hardBreakTask.firstChild?.firstChild?.firstChild;
		expect(hbParagraph?.child(0).type.name).toBe("hard_break");
		expect(hbParagraph?.child(1).textContent).toBe("Task");

		// 3. Bare `[x]` / `[x]   ` with no non-space character after the marker is NOT a task item.
		for (const nonTask of ["- [x]", "- [x]   ", "- [ ]", "- &#91;x] literal"]) {
			const doc = parseMarkdownToVisualDoc(nonTask);
			expect(doc.firstChild?.type.name, nonTask).toBe("bullet_list");
			expect(doc.firstChild?.firstChild?.type.name, nonTask).toBe("list_item");
		}
	});

	it("preserves tight lists across non-title refdef followers, leaf blocks, and nested loose lists (Track A #5 + Track B #4)", () => {
		// 1. Track A #5: title-less refdef followed by `(phrase) continues` stays tight on edit.
		const parenRefMd = "- [r]: /r\n  (phrase) continues\n- Next";
		const parenGuard = createMarkdownRoundTripGuard(parenRefMd);
		expect(parenGuard.initialDoc.firstChild?.attrs.tight).toBe(true);
		const parenEditedDoc = insertAt(
			parenGuard.initialDoc,
			findTextEndPos(parenGuard.initialDoc, "(phrase) continues"),
			"!",
		);
		const parenEditedMd = parenGuard.serialize(parenEditedDoc);
		expect(parenEditedMd).toBe("- [r]: /r\n  (phrase) continues!\n- Next");
		const parenReparsed = parseMarkdownToVisualDoc(parenEditedMd);
		expect(parenReparsed.firstChild?.attrs.tight).toBe(true);
		expect(parenReparsed.eq(parenEditedDoc)).toBe(true);

		// Multi-line quote continuation that is NOT a valid title also stays tight.
		const quoteRefMd = '- [r]: /r\n  "Quote" continues\n- Next';
		const quoteGuard = createMarkdownRoundTripGuard(quoteRefMd);
		const quoteEditedDoc = insertAt(
			quoteGuard.initialDoc,
			findTextEndPos(quoteGuard.initialDoc, '"Quote" continues'),
			"!",
		);
		expect(quoteGuard.serialize(quoteEditedDoc)).toBe(
			'- [r]: /r\n  "Quote" continues!\n- Next',
		);

		// Real standalone title paragraph still inserts a blank line so `[r]` cannot absorb it.
		const realTitleMd = '- [r]: /r\n\n  "Real title"\n- Next';
		const realTitleGuard = createMarkdownRoundTripGuard(realTitleMd);
		const realTitleEditedDoc = insertAt(
			realTitleGuard.initialDoc,
			findTextEndPos(realTitleGuard.initialDoc, '"Real title"'),
			"!",
		);
		expect(realTitleGuard.serialize(realTitleEditedDoc)).toBe(
			'- [r]: /r\n\n  "Real title"!\n- Next',
		);

		// Replacing tight text with a real `(Real title)` inserts a blank line for safety.
		const parenStart =
			findTextEndPos(parenGuard.initialDoc, "(phrase) continues") -
			"(phrase) continues".length;
		const absorbClashDoc = EditorState.create({
			doc: parenGuard.initialDoc,
			schema: visualEditorSchema,
		}).tr.replaceWith(
			parenStart,
			parenStart + "(phrase) continues".length,
			visualEditorSchema.text("(Real title)"),
		).doc;
		const absorbClashMd = parenGuard.serialize(absorbClashDoc);
		expect(absorbClashMd).toBe("- [r]: /r\n\n  (Real title)\n- Next");
		expect(
			parseMarkdownToVisualDoc(absorbClashMd).firstChild?.child(0).child(2)
				.textContent,
		).toBe("(Real title)");

		// 2. Track B #4.1: heading, code_block, and horizontal_rule followed by paragraph stay tight.
		for (const leafMd of [
			"- # Title\n  Body\n- Next",
			"- ```js\n  x\n  ```\n  Body\n- Next",
			"-\n  ---\n  Body\n- Next",
		]) {
			const guard = createMarkdownRoundTripGuard(leafMd);
			expect(guard.initialDoc.firstChild?.attrs.tight, leafMd).toBe(true);
			const editedDoc = insertAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "Body"),
				"!",
			);
			const editedMd = guard.serialize(editedDoc);
			expect(editedMd, leafMd).not.toContain("\n\n  Body!");
			const reparsed = parseMarkdownToVisualDoc(editedMd);
			expect(reparsed.firstChild?.attrs.tight, leafMd).toBe(true);
			expect(reparsed.eq(editedDoc), leafMd).toBe(true);
		}

		// 3. Track B #4.2: nested loose list does NOT force outer tight list to `tight: false`.
		const nestedLooseMd = "- outer 1\n  - inner 1\n\n  - inner 2\n- outer 2";
		const nestedGuard = createMarkdownRoundTripGuard(nestedLooseMd);
		const outerList = nestedGuard.initialDoc.firstChild;
		expect(outerList?.type.name).toBe("bullet_list");
		expect(outerList?.attrs.tight).toBe(true);
		const innerList = outerList?.child(0).child(1);
		expect(innerList?.type.name).toBe("bullet_list");
		expect(innerList?.attrs.tight).toBe(false);
		const nestedEditedDoc = insertAt(
			nestedGuard.initialDoc,
			findTextEndPos(nestedGuard.initialDoc, "outer 2"),
			"!",
		);
		const nestedEditedMd = nestedGuard.serialize(nestedEditedDoc);
		expect(nestedEditedMd).toBe(
			"- outer 1\n  - inner 1\n\n  - inner 2\n- outer 2!",
		);
		const nestedReparsed = parseMarkdownToVisualDoc(nestedEditedMd);
		expect(nestedReparsed.firstChild?.attrs.tight).toBe(true);
		expect(nestedReparsed.firstChild?.child(0).child(1).attrs.tight).toBe(
			false,
		);

		const orderedOuterMd = "1. outer 1\n   - inner 1\n\n   - inner 2\n2. outer 2";
		const orderedOuterDoc = parseMarkdownToVisualDoc(orderedOuterMd);
		expect(orderedOuterDoc.firstChild?.type.name).toBe("ordered_list");
		expect(orderedOuterDoc.firstChild?.attrs.tight).toBe(true);
		expect(orderedOuterDoc.firstChild?.child(0).child(1).attrs.tight).toBe(
			false,
		);
	});

	it("preserves raw inline HTML in 4-space paragraph continuations across same-paragraph edits without escaping or block splitting (Track A #6)", () => {
		// 1. `Para\n    <div>text</div>`: editing `Para` -> `P!ara` keeps unescaped `<div>` / `</div>`
		//    with 4-space continuation indentation so PHP renders `<p>P!ara\ntext</p>` (not literal tags
		//    and not a stripped HTML block).
		const divMd = "Para\n    <div>text</div>";
		const divGuard = createMarkdownRoundTripGuard(divMd);
		expect(divGuard.initialDoc.childCount).toBe(1);
		expect(divGuard.initialDoc.firstChild?.type.name).toBe("paragraph");
		expect(divGuard.initialDoc.firstChild?.textContent).toBe("Para\ntext");
		expect(collectProtectedInlineRaws(divGuard.initialDoc)).toEqual([
			"<div>",
			"</div>",
		]);
		expect(divGuard.serialize(divGuard.initialDoc)).toBe(divMd);

		const divEditedDoc = insertAt(divGuard.initialDoc, 2, "!");
		const divEditedMd = divGuard.serialize(divEditedDoc);
		expect(divEditedMd).toBe("P!ara\n    <div>text</div>");
		expect(divEditedMd).not.toContain("\\<div");
		expect(divEditedMd).not.toContain("\\</div");
		expect(parseMarkdownToVisualDoc(divEditedMd).eq(divEditedDoc)).toBe(true);

		// 2. HTML comments, declarations, processing instructions, CDATA, and multi-line 4-space tags.
		for (const htmlCase of [
			{
				expectedMd: "P!ara\n    <!-- hidden -->text",
				md: "Para\n    <!-- hidden -->text",
				raws: ["<!-- hidden -->"],
				visibleText: "Para\ntext",
			},
			{
				expectedMd: "P!ara\n    <!DOCTYPE html>text",
				md: "Para\n    <!DOCTYPE html>text",
				raws: ["<!DOCTYPE html>"],
				visibleText: "Para\ntext",
			},
			{
				expectedMd: 'P!ara\n    <?xml version="1.0"?>text',
				md: 'Para\n    <?xml version="1.0"?>text',
				raws: ['<?xml version="1.0"?>'],
				visibleText: "Para\ntext",
			},
			{
				expectedMd: "P!ara\n    <![CDATA[x]]>text",
				md: "Para\n    <![CDATA[x]]>text",
				raws: ["<![CDATA[x]]>"],
				visibleText: "Para\ntext",
			},
			{
				expectedMd: "P!ara\n    <div>\nhello\n    </div>",
				md: "Para\n    <div>\n    hello\n    </div>",
				raws: ["<div>", "</div>"],
				visibleText: "Para\n\nhello\n",
			},
		]) {
			const guard = createMarkdownRoundTripGuard(htmlCase.md);
			expect(guard.initialDoc.childCount, htmlCase.md).toBe(1);
			expect(guard.initialDoc.firstChild?.textContent, htmlCase.md).toBe(
				htmlCase.visibleText,
			);
			expect(collectProtectedInlineRaws(guard.initialDoc), htmlCase.md).toEqual(
				htmlCase.raws,
			);
			const editedDoc = insertAt(guard.initialDoc, 2, "!");
			const editedMd = guard.serialize(editedDoc);
			expect(editedMd, htmlCase.md).toBe(htmlCase.expectedMd);
			expect(parseMarkdownToVisualDoc(editedMd).eq(editedDoc), htmlCase.md).toBe(
				true,
			);
		}

		// 3. Negative controls: `<` comparisons, inline code spans, autolinks, and escaped tags stay intact.
		const cmpGuard = createMarkdownRoundTripGuard("Para\n    1 < 2 and 3 > 1");
		expect(collectProtectedInlineRaws(cmpGuard.initialDoc)).toEqual([]);
		expect(cmpGuard.initialDoc.firstChild?.textContent).toBe(
			"Para\n1 < 2 and 3 > 1",
		);
		expect(cmpGuard.serialize(insertAt(cmpGuard.initialDoc, 2, "!"))).toBe(
			"P!ara\n1 < 2 and 3 > 1",
		);

		const codeGuard = createMarkdownRoundTripGuard("Para\n    `<div>`");
		expect(collectProtectedInlineRaws(codeGuard.initialDoc)).toEqual([]);
		expect(codeGuard.serialize(insertAt(codeGuard.initialDoc, 2, "!"))).toBe(
			"P!ara\n`<div>`",
		);

		const autolinkGuard = createMarkdownRoundTripGuard(
			"Para\n    <https://example.com>",
		);
		expect(collectProtectedInlineRaws(autolinkGuard.initialDoc)).toEqual([]);
		let foundAutolinkHref: string | null = null;
		autolinkGuard.initialDoc.descendants((node) => {
			if (node.isText) {
				const link = node.marks.find((m) => m.type.name === "link");
				if (link) foundAutolinkHref = String(link.attrs.href ?? "");
			}
			return true;
		});
		expect(foundAutolinkHref).toBe("https://example.com");

		const escapedGuard = createMarkdownRoundTripGuard(
			"Para\n    \\<div>text\\</div>",
		);
		expect(collectProtectedInlineRaws(escapedGuard.initialDoc)).toEqual([]);
		expect(escapedGuard.initialDoc.firstChild?.textContent).toBe(
			"Para\n<div>text</div>",
		);
		expect(escapedGuard.serialize(insertAt(escapedGuard.initialDoc, 2, "!"))).toBe(
			"P!ara\n\\<div>text\\</div>",
		);
	});
});

describe("PR-R20-A PHP-aligned reference title absorption, list task preservation, link encoding, refdef continuations, blockquote HTML blocks, and shortcut task hard breaks", () => {
	const findTextEndPos = (doc: ProseMirrorNode, needle: string): number => {
		let found = -1;
		doc.descendants((node, pos) => {
			if (found < 0 && node.isText && node.text === needle) {
				found = pos + node.text.length;
			}
			return found < 0;
		});
		return found;
	};

	const insertAt = (
		doc: ProseMirrorNode,
		pos: number,
		text: string,
	): ProseMirrorNode =>
		EditorState.create({ doc, schema: visualEditorSchema }).tr.insertText(
			text,
			pos,
		).doc;

	it("uses PHP-aligned ParagraphReferenceParser in wouldReferenceDefinitionAbsorbFollowingBlock (Track A #1)", () => {
		// PHP accepts nested unescaped `(` inside parenthesized reference titles,
		// unlike markdown-it; editing body to `(nested (title)` must insert a blank line.
		const initialMd = "- [r]: /r\n  (old) prose\n- Next";
		const guard = createMarkdownRoundTripGuard(initialMd);
		const bodyText = "(old) prose";
		const bodyStart = findTextEndPos(guard.initialDoc, bodyText) - bodyText.length;
		const nestedTitleDoc = EditorState.create({
			doc: guard.initialDoc,
			schema: visualEditorSchema,
		}).tr.replaceWith(
			bodyStart,
			bodyStart + bodyText.length,
			visualEditorSchema.text("(nested (title)"),
		).doc;
		const nestedTitleMd = guard.serialize(nestedTitleDoc);
		expect(nestedTitleMd).toBe("- [r]: /r\n\n  (nested (title)\n- Next");
		expect(
			parseMarkdownToVisualDoc(nestedTitleMd).firstChild?.child(0).child(2)
				.textContent,
		).toBe("(nested (title)");

		// Multi-line nested paren title is also absorbed by PHP, so a blank line is inserted.
		const multiLineDoc = EditorState.create({
			doc: guard.initialDoc,
			schema: visualEditorSchema,
		}).tr.replaceWith(
			bodyStart,
			bodyStart + bodyText.length,
			visualEditorSchema.text("(line 1\n(line 2)"),
		).doc;
		expect(guard.serialize(multiLineDoc)).toBe(
			"- [r]: /r\n\n  (line 1\n  (line 2)\n- Next",
		);

		// Non-title `(phrase) continues` still preserves tight single-line separation.
		const tightDoc = EditorState.create({
			doc: guard.initialDoc,
			schema: visualEditorSchema,
		}).tr.replaceWith(
			bodyStart,
			bodyStart + bodyText.length,
			visualEditorSchema.text("(phrase) continues"),
		).doc;
		expect(guard.serialize(tightDoc)).toBe(
			"- [r]: /r\n  (phrase) continues\n- Next",
		);
	});

	it("preserves active PHP task checkboxes in ordered lists and subsequent list-item paragraphs while keeping escaped literals escaped (Track A #2 + Track B #10)", () => {
		// 1. Ordered list task items preserve unescaped `[x]` / `[ ]` on edit.
		const orderedMd = "1. [x] done\n2. [ ] todo";
		const orderedGuard = createMarkdownRoundTripGuard(orderedMd);
		expect(orderedGuard.serialize(orderedGuard.initialDoc)).toBe(orderedMd);
		const orderedEdited = insertAt(
			orderedGuard.initialDoc,
			findTextEndPos(orderedGuard.initialDoc, "[ ] todo"),
			"!",
		);
		const orderedEditedMd = orderedGuard.serialize(orderedEdited);
		expect(orderedEditedMd).toBe("1. [x] done\n2. [ ] todo!");
		expect(parseMarkdownToVisualDoc(orderedEditedMd).eq(orderedEdited)).toBe(
			true,
		);

		// Deleting the `[x] ` marker leaves clean prose without stray markers.
		const markerStart =
			findTextEndPos(orderedGuard.initialDoc, "[x] done") - "[x] done".length;
		const markerDeleted = EditorState.create({
			doc: orderedGuard.initialDoc,
			schema: visualEditorSchema,
		}).tr.delete(markerStart, markerStart + 4).doc;
		expect(orderedGuard.serialize(markerDeleted)).toBe("1. done\n2. [ ] todo");

		// 2. Second-paragraph task in a bullet item preserves `[x]` across edits to either paragraph.
		const secondParaMd = "- para1\n\n  [x] second para";
		const secondParaGuard = createMarkdownRoundTripGuard(secondParaMd);
		expect(secondParaGuard.serialize(secondParaGuard.initialDoc)).toBe(
			secondParaMd,
		);
		const editFirstPara = insertAt(
			secondParaGuard.initialDoc,
			findTextEndPos(secondParaGuard.initialDoc, "para1"),
			"!",
		);
		const editFirstParaMd = secondParaGuard.serialize(editFirstPara);
		expect(editFirstParaMd).toBe("- para1!\n\n  [x] second para");
		expect(parseMarkdownToVisualDoc(editFirstParaMd).eq(editFirstPara)).toBe(
			true,
		);

		const editSecondPara = insertAt(
			secondParaGuard.initialDoc,
			findTextEndPos(secondParaGuard.initialDoc, "[x] second para"),
			"!",
		);
		const editSecondParaMd = secondParaGuard.serialize(editSecondPara);
		expect(editSecondParaMd).toBe("- para1\n\n  [x] second para!");
		expect(parseMarkdownToVisualDoc(editSecondParaMd).eq(editSecondPara)).toBe(
			true,
		);

		// 3. Second-paragraph task inside a task_item also preserves its checkbox.
		const nestedTaskParaMd = "- [x] first\n\n  [ ] second";
		const nestedTaskGuard = createMarkdownRoundTripGuard(nestedTaskParaMd);
		const editedNestedTask = insertAt(
			nestedTaskGuard.initialDoc,
			findTextEndPos(nestedTaskGuard.initialDoc, "[ ] second"),
			"!",
		);
		expect(nestedTaskGuard.serialize(editedNestedTask)).toBe(
			"- [x] first\n\n  [ ] second!",
		);

		// 4. Escaped literal `\[x]` stays escaped on edit in both refdef bullet and ordered lists.
		const escapedRefMd = "- [r]: /r\n  \\[x] literal";
		const escapedRefGuard = createMarkdownRoundTripGuard(escapedRefMd);
		const editedEscapedRef = insertAt(
			escapedRefGuard.initialDoc,
			findTextEndPos(escapedRefGuard.initialDoc, "[x] literal"),
			"!",
		);
		expect(escapedRefGuard.serialize(editedEscapedRef)).toBe(
			"- [r]: /r\n  \\[x] literal!",
		);

		const escapedOrdMd = "1. \\[x] literal";
		const escapedOrdGuard = createMarkdownRoundTripGuard(escapedOrdMd);
		const editedEscapedOrd = insertAt(
			escapedOrdGuard.initialDoc,
			findTextEndPos(escapedOrdGuard.initialDoc, "[x] literal"),
			"!",
		);
		expect(escapedOrdGuard.serialize(editedEscapedOrd)).toBe(
			"1. \\[x] literal!",
		);

		// 5. Newly typed literal `[x] foo` inside an ordinary list item is escaped.
		const ordinaryGuard = createMarkdownRoundTripGuard("- bar");
		const barEnd = findTextEndPos(ordinaryGuard.initialDoc, "bar");
		const typedLiteralDoc = EditorState.create({
			doc: ordinaryGuard.initialDoc,
			schema: visualEditorSchema,
		}).tr.replaceWith(
			barEnd - 3,
			barEnd,
			visualEditorSchema.text("[x] foo"),
		).doc;
		expect(ordinaryGuard.serialize(typedLiteralDoc)).toBe("- \\[x] foo");
	});

	it("encodes [x](url), [X](url), and [ ](url) links at start of list items as numeric entities (Track B #4)", () => {
		const linkMark = visualEditorSchema.marks.link.create({
			href: "https://example.com",
		});
		for (const linkCase of [
			{ expected: "- [&#120;](https://example.com)", label: "x" },
			{ expected: "- [&#88;](https://example.com)", label: "X" },
			{ expected: "- [&#32;](https://example.com)", label: " " },
		]) {
			const doc = visualEditorSchema.nodes.doc.create(null, [
				visualEditorSchema.nodes.bullet_list.create(null, [
					visualEditorSchema.nodes.list_item.create(null, [
						visualEditorSchema.nodes.paragraph.create(null, [
							visualEditorSchema.text(linkCase.label, [linkMark]),
						]),
					]),
				]),
			]);
			const serialized = serializeVisualDocToMarkdown(doc);
			expect(serialized, linkCase.label).toBe(linkCase.expected);

			const reparsed = parseMarkdownToVisualDoc(serialized);
			expect(reparsed.firstChild?.type.name, linkCase.label).toBe("bullet_list");
			expect(reparsed.firstChild?.firstChild?.type.name, linkCase.label).toBe(
				"list_item",
			);
			expect(reparsed.eq(doc), linkCase.label).toBe(true);
		}

		// Also covers ordered lists and subsequent list-item paragraphs.
		const orderedLinkMd = "1. [&#120;](https://example.com) tail";
		const orderedLinkGuard = createMarkdownRoundTripGuard(orderedLinkMd);
		const editedOrderedLink = insertAt(
			orderedLinkGuard.initialDoc,
			findTextEndPos(orderedLinkGuard.initialDoc, " tail"),
			"!",
		);
		expect(orderedLinkGuard.serialize(editedOrderedLink)).toBe(
			"1. [&#120;](https://example.com) tail!",
		);
	});

	it("keeps paragraphOpen across refdefs so 4-space math/HTML continuations match PHP (Track A #3 + Track B #5)", () => {
		// 1. `[ref]: /target\n    $$x$$` (no blank line) -> protected math block, NOT code_block.
		const refMathMd = "[ref]: /target\n    $$x$$";
		const refMathGuard = createMarkdownRoundTripGuard(refMathMd);
		expect(refMathGuard.initialDoc.childCount).toBe(2);
		expect(refMathGuard.initialDoc.child(0).type.name).toBe("protected_block");
		expect(refMathGuard.initialDoc.child(0).attrs.rawMarkdown).toBe(
			"[ref]: /target",
		);
		expect(refMathGuard.initialDoc.child(1).type.name).toBe("protected_block");
		expect(refMathGuard.initialDoc.child(1).attrs.kind).toBe("math");
		expect(refMathGuard.initialDoc.child(1).attrs.rawMarkdown).toBe("$$x$$");
		expect(refMathGuard.serialize(refMathGuard.initialDoc)).toBe(refMathMd);

		const mathPos = refMathGuard.initialDoc.child(0).nodeSize;
		const editedMathDoc = EditorState.create({
			doc: refMathGuard.initialDoc,
			schema: visualEditorSchema,
		}).tr.setNodeMarkup(mathPos, undefined, {
			kind: "math",
			rawMarkdown: "$$x + 1$$",
		}).doc;
		expect(refMathGuard.serialize(editedMathDoc)).toBe(
			"[ref]: /target\n\n$$x + 1$$",
		);

		// 2. `[ref]: /target\n\n    $$x$$` (with blank line) -> real indented code_block.
		const refBlankMathDoc = parseMarkdownToVisualDoc(
			"[ref]: /target\n\n    $$x$$",
		);
		expect(refBlankMathDoc.childCount).toBe(2);
		expect(refBlankMathDoc.child(0).type.name).toBe("protected_block");
		expect(refBlankMathDoc.child(1).type.name).toBe("code_block");
		expect(refBlankMathDoc.child(1).textContent).toBe("$$x$$");

		// 3. `[ref]: https://example.com\n    <div>\n    hello\n    </div>\n    more code`
		//    stays a paragraph continuation and round-trips safely on edit.
		const refDivMd =
			"[ref]: https://example.com\n    <div>\n    hello\n    </div>\n    more code";
		const refDivGuard = createMarkdownRoundTripGuard(refDivMd);
		expect(refDivGuard.initialDoc.childCount).toBe(2);
		expect(refDivGuard.initialDoc.child(1).type.name).toBe("paragraph");
		expect(refDivGuard.serialize(refDivGuard.initialDoc)).toBe(refDivMd);

		const editedRefDiv = insertAt(
			refDivGuard.initialDoc,
			findTextEndPos(refDivGuard.initialDoc, "\nmore code"),
			"!",
		);
		const editedRefDivMd = refDivGuard.serialize(editedRefDiv);
		expect(editedRefDivMd).toBe(
			"[ref]: https://example.com\n    <div>\nhello\n    </div>\nmore code!",
		);
		expect(parseMarkdownToVisualDoc(editedRefDivMd).eq(editedRefDiv)).toBe(
			true,
		);
	});

	it("protects blockquote-prefixed CommonMark HTML blocks and avoids leaking hidden content on edit (Track B #8)", () => {
		// 1. Blockquote Type 6 `<div>` block stays protected so `world` never leaks on edit.
		const bqDivMd = "> Hello\n> <div>\n> world\n> </div>";
		const bqDivGuard = createMarkdownRoundTripGuard(bqDivMd);
		expect(bqDivGuard.initialDoc.childCount).toBe(1);
		const bqNode = bqDivGuard.initialDoc.firstChild;
		expect(bqNode?.type.name).toBe("blockquote");
		expect(bqNode?.childCount).toBe(2);
		expect(bqNode?.child(0).type.name).toBe("paragraph");
		expect(bqNode?.child(0).textContent).toBe("Hello");
		expect(bqNode?.child(1).type.name).toBe("protected_block");
		expect(bqNode?.child(1).attrs.kind).toBe("raw");
		expect(bqNode?.child(1).attrs.rawMarkdown).toBe("<div>\nworld\n</div>");
		expect(bqDivGuard.serialize(bqDivGuard.initialDoc)).toBe(bqDivMd);

		const bqDivEdited = insertAt(
			bqDivGuard.initialDoc,
			findTextEndPos(bqDivGuard.initialDoc, "Hello"),
			"!",
		);
		const bqDivEditedMd = bqDivGuard.serialize(bqDivEdited);
		expect(bqDivEditedMd).toBe("> Hello!\n>\n> <div>\n> world\n> </div>");
		expect(bqDivEditedMd).not.toContain(">     <div>");
		expect(parseMarkdownToVisualDoc(bqDivEditedMd).eq(bqDivEdited)).toBe(true);

		// 2. Blockquote Type 1 cross-tag close, Type 2 comment, and Type 7 standalone vs interrupting.
		const bqCommentDoc = parseMarkdownToVisualDoc(
			"> Hello\n> <!-- hidden\n> secret -->\n> visible",
		);
		expect(bqCommentDoc.firstChild?.childCount).toBe(3);
		expect(bqCommentDoc.firstChild?.child(1).type.name).toBe("protected_block");
		expect(bqCommentDoc.firstChild?.child(2).textContent).toBe("visible");

		const bqType1Doc = parseMarkdownToVisualDoc(
			"> Hello\n> <pre>\n> code\n> </script>\n> after",
		);
		expect(bqType1Doc.firstChild?.childCount).toBe(3);
		expect(bqType1Doc.firstChild?.child(1).attrs.rawMarkdown).toBe(
			"<pre>\ncode\n</script>",
		);
		expect(bqType1Doc.firstChild?.child(2).textContent).toBe("after");

		// `<search>` is NOT a PHP Type 6 block tag and does not interrupt a paragraph.
		const bqSearchGuard = createMarkdownRoundTripGuard(
			"> Hello\n> <search>\n> world\n> </search>",
		);
		expect(bqSearchGuard.initialDoc.firstChild?.childCount).toBe(1);
		const bqSearchEdited = insertAt(
			bqSearchGuard.initialDoc,
			findTextEndPos(bqSearchGuard.initialDoc, "Hello\n") - 1,
			"!",
		);
		expect(bqSearchGuard.serialize(bqSearchEdited)).toBe(
			"> Hello!\n> <search>\n> world\n> </search>",
		);

		// 3. Genuine 4-space continuation `Para\n    <div>text</div>` still pads 4 spaces on edit.
		const paraContGuard = createMarkdownRoundTripGuard(
			"Para\n    <div>text</div>",
		);
		const paraContEdited = insertAt(paraContGuard.initialDoc, 2, "!");
		expect(paraContGuard.serialize(paraContEdited)).toBe(
			"P!ara\n    <div>text</div>",
		);

		// Genuine 4-space continuation inside a blockquote also keeps its 4-space pad.
		const bqContGuard = createMarkdownRoundTripGuard(
			"> Hello\n>     <div>text</div>",
		);
		const bqContEdited = insertAt(
			bqContGuard.initialDoc,
			findTextEndPos(bqContGuard.initialDoc, "Hello\n") - 1,
			"!",
		);
		expect(bqContGuard.serialize(bqContEdited)).toBe(
			"> Hello!\n>     <div>text</div>",
		);
	});

	it("preserves 2-space hard breaks and strips non-hardbreak whitespace before newline in shortcut-refdef [x] task items (Track B #9)", () => {
		// 1. Two trailing spaces before `\n` become a `hard_break` matching PHP `<br>`.
		const hardBreakMd = "[x]: https://example.com\n\n- [x]  \n  text";
		const hardBreakGuard = createMarkdownRoundTripGuard(hardBreakMd);
		expect(hardBreakGuard.initialDoc.childCount).toBe(2);
		const hbList = hardBreakGuard.initialDoc.child(1);
		expect(hbList.type.name).toBe("task_list");
		const hbPara = hbList.firstChild?.firstChild;
		expect(hbPara?.childCount).toBe(2);
		expect(hbPara?.child(0).type.name).toBe("hard_break");
		expect(hbPara?.child(1).textContent).toBe("text");
		expect(hardBreakGuard.serialize(hardBreakGuard.initialDoc)).toBe(
			hardBreakMd,
		);

		const editedHb = insertAt(
			hardBreakGuard.initialDoc,
			findTextEndPos(hardBreakGuard.initialDoc, "text"),
			"!",
		);
		expect(hardBreakGuard.serialize(editedHb)).toBe(
			"[x]: https://example.com\n\n- [x] \\\n  text!",
		);

		// Tab + 2 spaces before `\n` also emits a clean `[hard_break, text("text")]`.
		const tabHardBreakDoc = parseMarkdownToVisualDoc(
			"[x]: https://example.com\n\n- [x]\t  \n  text",
		);
		const tabHbPara = tabHardBreakDoc.child(1).firstChild?.firstChild;
		expect(tabHbPara?.childCount).toBe(2);
		expect(tabHbPara?.child(0).type.name).toBe("hard_break");
		expect(tabHbPara?.child(1).textContent).toBe("text");

		// 2. Space + tab before `\n` is NOT a hard break and leaves clean `text("text")`.
		const softBreakMd = "[x]: https://example.com\n\n- [x] \t\n  text";
		const softBreakGuard = createMarkdownRoundTripGuard(softBreakMd);
		const sbPara = softBreakGuard.initialDoc.child(1).firstChild?.firstChild;
		expect(sbPara?.childCount).toBe(1);
		expect(sbPara?.child(0).isText).toBe(true);
		expect(sbPara?.child(0).textContent).toBe("text");

		const editedSb = insertAt(
			softBreakGuard.initialDoc,
			findTextEndPos(softBreakGuard.initialDoc, "text"),
			"!",
		);
		expect(softBreakGuard.serialize(editedSb)).toBe(
			"[x]: https://example.com\n\n- [x] text!",
		);
	});
});

describe("PR-R21-A PHP CommonMark HTML blocks, NBSP blank lines, list-marker HTML, shortcut task links, Type-7 refdef continuations, and list conversion", () => {
	const findTextEndPos = (doc: ProseMirrorNode, needle: string): number => {
		let found = -1;
		doc.descendants((node, pos) => {
			if (found < 0 && node.isText && node.text === needle) {
				found = pos + node.text.length;
			}
			return found < 0;
		});
		return found;
	};

	const insertAt = (
		doc: ProseMirrorNode,
		pos: number,
		text: string,
	): ProseMirrorNode =>
		EditorState.create({ doc, schema: visualEditorSchema }).tr.insertText(
			text,
			pos,
		).doc;

	it("uses CommonMark space-and-tab blank-line rules for NBSP in HTML blocks and refdef title probes (Track A #1 + Track A #3)", () => {
		// Track A #1: U+00A0 (NBSP) is NOT a CommonMark blank line and must NOT split Type 6 HTML blocks.
		const nbspBqMd = "> <div>\n> \u00a0\n> Hidden\n>\n> Visible";
		const nbspBqGuard = createMarkdownRoundTripGuard(nbspBqMd);
		expect(nbspBqGuard.initialDoc.childCount).toBe(1);
		const bq = nbspBqGuard.initialDoc.firstChild;
		expect(bq?.type.name).toBe("blockquote");
		expect(bq?.childCount).toBe(2);
		expect(bq?.child(0).type.name).toBe("protected_block");
		expect(bq?.child(0).attrs.rawMarkdown).toBe("<div>\n\u00a0\nHidden");
		expect(bq?.child(1).type.name).toBe("paragraph");
		expect(bq?.child(1).textContent).toBe("Visible");

		const editedNbspBq = insertAt(
			nbspBqGuard.initialDoc,
			findTextEndPos(nbspBqGuard.initialDoc, "Visible"),
			"!",
		);
		const editedNbspBqMd = nbspBqGuard.serialize(editedNbspBq);
		expect(editedNbspBqMd).toBe("> <div>\n> \u00a0\n> Hidden\n>\n> Visible!");
		expect(parseMarkdownToVisualDoc(editedNbspBqMd).eq(editedNbspBq)).toBe(
			true,
		);

		// Tight `>\u00a0` (without space after `>`) must also preserve `\u00a0` in rawMarkdown.
		const tightNbspDoc = parseMarkdownToVisualDoc(
			"> <div>\n>\u00a0\n> Hidden\n>\n> Visible",
		);
		expect(tightNbspDoc.firstChild?.child(0).attrs.rawMarkdown).toBe(
			"<div>\n\u00a0\nHidden",
		);

		// Track A #3: NBSP does NOT stop `wouldReferenceDefinitionAbsorbFollowingBlock()`.
		expect(
			wouldReferenceDefinitionAbsorbFollowingBlock(
				"[r]: /r",
				"(first\n\u00a0\n(last)",
			),
		).toBe(true);
		expect(
			wouldReferenceDefinitionAbsorbFollowingBlock(
				"[r]: /r",
				"(first\n\n(last)",
			),
		).toBe(false);

		const refNbspMd =
			"- [r]: /r\n  (first\n  \u00a0\n  (last) prose\n- Next\n\n[r]";
		const refNbspGuard = createMarkdownRoundTripGuard(refNbspMd);
		const proseEnd = findTextEndPos(
			refNbspGuard.initialDoc,
			"(first\n\u00a0\n(last) prose",
		);
		const deletedProseDoc = EditorState.create({
			doc: refNbspGuard.initialDoc,
			schema: visualEditorSchema,
		}).tr.delete(proseEnd - " prose".length, proseEnd).doc;
		const deletedProseMd = refNbspGuard.serialize(deletedProseDoc);
		expect(deletedProseMd).toBe(
			"- [r]: /r\n\n  (first\n  \u00a0\n  (last)\n- Next\n\n[r]",
		);
		const reparsedDeleted = parseMarkdownToVisualDoc(deletedProseMd);
		expect(reparsedDeleted.firstChild?.child(0).child(2).textContent).toBe(
			"(first\n\u00a0\n(last)",
		);
		expect(
			reparsedDeleted
				.child(1)
				.firstChild?.marks.find((mark) => mark.type.name === "link")?.attrs.href,
		).toBe("/r");
	});

	it("routes CommonMark Types 1-7 HTML blocks directly without legacy HTML-pair corruption (Track B #1)", () => {
		// 1. Blank line closes Type 6 `<div>`, leaving `visible paragraph` directly editable.
		const divParaMd = "<div>\n\nvisible paragraph\n</div>";
		const divParaGuard = createMarkdownRoundTripGuard(divParaMd);
		expect(divParaGuard.initialDoc.childCount).toBe(3);
		expect(divParaGuard.initialDoc.child(0).type.name).toBe("protected_block");
		expect(divParaGuard.initialDoc.child(0).attrs.rawMarkdown).toBe("<div>");
		expect(divParaGuard.initialDoc.child(1).type.name).toBe("paragraph");
		expect(divParaGuard.initialDoc.child(1).textContent).toBe(
			"visible paragraph",
		);
		expect(divParaGuard.initialDoc.child(2).type.name).toBe("protected_block");
		expect(divParaGuard.initialDoc.child(2).attrs.rawMarkdown).toBe("</div>");
		const editedDivPara = insertAt(
			divParaGuard.initialDoc,
			findTextEndPos(divParaGuard.initialDoc, "visible paragraph"),
			"!",
		);
		expect(divParaGuard.serialize(editedDivPara)).toBe(
			"<div>\n\nvisible paragraph!\n\n</div>",
		);

		// 2. Type 6 closes ONLY at blank line or EOF, never early at `</div>` / `</table>` / `/>`.
		for (const sample of [
			"<div>foo</div>\nbar",
			"<div>\nfoo\n</div>\nbar",
			"<table><tr><td>hi</td></tr></table>\nbar",
			"<div/>bar\nbaz",
		]) {
			const doc = parseMarkdownToVisualDoc(sample);
			expect(doc.childCount, sample).toBe(1);
			expect(doc.firstChild?.type.name, sample).toBe("protected_block");
			expect(doc.firstChild?.attrs.kind, sample).toBe("raw");
			expect(doc.firstChild?.attrs.rawMarkdown, sample).toBe(sample);
		}
	});

	it("protects CommonMark HTML blocks immediately after list and quote+list markers (Track A #2 + Track B #6)", () => {
		const singleBlockCases: ReadonlyArray<
			Readonly<{
				expectedListType: "bullet_list" | "ordered_list";
				expectedRaw: string;
				inBlockquote?: boolean;
				markdown: string;
			}>
		> = [
			{
				expectedListType: "bullet_list",
				expectedRaw: "<div>\nhello",
				markdown: "- <div>\n  hello",
			},
			{
				expectedListType: "bullet_list",
				expectedRaw: "<script>\nalert(1)\n</script>",
				markdown: "- <script>\n  alert(1)\n  </script>",
			},
			{
				expectedListType: "bullet_list",
				expectedRaw: "<!--\nsecret\n-->",
				markdown: "- <!--\n  secret\n  -->",
			},
			{
				expectedListType: "ordered_list",
				expectedRaw: "<div>\nhello",
				markdown: "1. <div>\n   hello",
			},
			{
				expectedListType: "bullet_list",
				expectedRaw: "<div>\nhello",
				inBlockquote: true,
				markdown: "> - <div>\n>   hello",
			},
		];

		for (const testCase of singleBlockCases) {
			const guard = createMarkdownRoundTripGuard(testCase.markdown);
			const container = testCase.inBlockquote
				? guard.initialDoc.firstChild?.firstChild
				: guard.initialDoc.firstChild;
			expect(container?.type.name, testCase.markdown).toBe(
				testCase.expectedListType,
			);
			const item = container?.firstChild;
			expect(item?.childCount, testCase.markdown).toBe(2);
			expect(item?.child(0).type.name, testCase.markdown).toBe("paragraph");
			expect(item?.child(0).textContent, testCase.markdown).toBe("");
			expect(item?.child(1).type.name, testCase.markdown).toBe(
				"protected_block",
			);
			expect(item?.child(1).attrs.rawMarkdown, testCase.markdown).toBe(
				testCase.expectedRaw,
			);
			expect(guard.serialize(guard.initialDoc)).toBe(testCase.markdown);
		}

		// Quote + list comment followed by editable text stays protected and tight on edit.
		const bqListCommentMd = "> - <!--\n>   Hidden\n>   -->\n>   Visible";
		const bqListGuard = createMarkdownRoundTripGuard(bqListCommentMd);
		const bqList = bqListGuard.initialDoc.firstChild?.firstChild;
		expect(bqList?.type.name).toBe("bullet_list");
		expect(bqList?.attrs.tight).toBe(true);
		const bqItem = bqList?.firstChild;
		expect(bqItem?.childCount).toBe(3);
		expect(bqItem?.child(1).type.name).toBe("protected_block");
		expect(bqItem?.child(1).attrs.rawMarkdown).toBe("<!--\nHidden\n-->");
		expect(bqItem?.child(2).type.name).toBe("paragraph");
		expect(bqItem?.child(2).textContent).toBe("Visible");

		const editedBqList = insertAt(
			bqListGuard.initialDoc,
			findTextEndPos(bqListGuard.initialDoc, "Visible"),
			"!",
		);
		const editedBqListMd = bqListGuard.serialize(editedBqList);
		expect(editedBqListMd).toBe("> - <!--\n>   Hidden\n>   -->\n>   Visible!");
		expect(editedBqListMd).not.toContain("\\<!--");
		expect(parseMarkdownToVisualDoc(editedBqListMd).eq(editedBqList)).toBe(
			true,
		);

		// Negative controls: non-1 ordered list cannot interrupt a paragraph; 5 spaces after `-` is indented code.
		const nonInterruptDoc = parseMarkdownToVisualDoc("Para\n2. <div>\n   hello");
		expect(nonInterruptDoc.childCount).toBe(1);
		expect(nonInterruptDoc.firstChild?.type.name).toBe("paragraph");

		const fiveSpaceListDoc = parseMarkdownToVisualDoc("-     <div>\n  hello");
		expect(fiveSpaceListDoc.firstChild?.firstChild?.child(1).type.name).toBe(
			"code_block",
		);
	});

	it("consumes PHP task markers before shortcut-refdef link parsing on ordered-list and subsequent-paragraph items (Track A #4)", () => {
		const hasAnyLinkMark = (node: ProseMirrorNode): boolean => {
			let found = false;
			node.descendants((child) => {
				if (child.marks.some((mark) => mark.type.name === "link")) {
					found = true;
					return false;
				}
				return true;
			});
			return found;
		};

		// 1. Ordered-list `[x]` with shortcut refdef `[x]: /ref` must NOT attach a link mark.
		const orderedRefTaskMd = "1. [x] done\n\n[x]: /ref";
		const orderedGuard = createMarkdownRoundTripGuard(orderedRefTaskMd);
		const orderedPara = orderedGuard.initialDoc.child(0).firstChild?.firstChild;
		expect(orderedPara?.attrs.preserveRawTaskPrefix).toBe(true);
		expect(orderedPara?.textContent).toBe("[x] done");
		expect(orderedPara ? hasAnyLinkMark(orderedPara) : true).toBe(false);

		const editedOrdered = insertAt(
			orderedGuard.initialDoc,
			findTextEndPos(orderedGuard.initialDoc, "[x] done"),
			"!",
		);
		expect(orderedGuard.serialize(editedOrdered)).toBe(
			"1. [x] done!\n\n[x]: /ref",
		);

		// 2. Subsequent paragraph `[x]` in a bullet item with shortcut refdef `[x]: /ref`.
		const subParaRefTaskMd = "- Intro\n\n  [x] done\n\n[x]: /ref";
		const subGuard = createMarkdownRoundTripGuard(subParaRefTaskMd);
		const subPara = subGuard.initialDoc.child(0).firstChild?.child(1);
		expect(subPara?.attrs.preserveRawTaskPrefix).toBe(true);
		expect(subPara?.textContent).toBe("[x] done");
		expect(subPara ? hasAnyLinkMark(subPara) : true).toBe(false);

		const editedSub = insertAt(
			subGuard.initialDoc,
			findTextEndPos(subGuard.initialDoc, "[x] done"),
			"!",
		);
		expect(subGuard.serialize(editedSub)).toBe(
			"- Intro\n\n  [x] done!\n\n[x]: /ref",
		);

		// 3. Hard break after `[x]` stays preserved without a bogus shortcut link mark.
		const orderedHbDoc = parseMarkdownToVisualDoc(
			"1. [x]  \n   done\n\n[x]: /ref",
		);
		const orderedHbPara = orderedHbDoc.child(0).firstChild?.firstChild;
		expect(orderedHbPara ? hasAnyLinkMark(orderedHbPara) : true).toBe(false);
		expect(orderedHbPara?.child(1).type.name).toBe("hard_break");

		// 4. Negative controls: PHP priority-35 task parser consumes `[x]` even before `(/ref)`,
		// while ordinary non-task links (`1. [a](/b)`) keep their link and escaped `1. \[x] done` stays literal.
		const taskParenDoc = parseMarkdownToVisualDoc("1. [x](/ref) done");
		const taskParenPara = taskParenDoc.firstChild?.firstChild?.firstChild;
		expect(taskParenPara ? hasAnyLinkMark(taskParenPara) : true).toBe(false);
		expect(taskParenPara?.textContent).toBe("[x](/ref) done");

		const ordinaryLinkDoc = parseMarkdownToVisualDoc("1. [a](/b) done");
		const ordinaryLinkPara = ordinaryLinkDoc.firstChild?.firstChild?.firstChild;
		expect(ordinaryLinkPara ? hasAnyLinkMark(ordinaryLinkPara) : false).toBe(
			true,
		);

		const escapedTaskMd = "1. \\[x] done\n\n[x]: /ref";
		const escapedGuard = createMarkdownRoundTripGuard(escapedTaskMd);
		const escapedPara = escapedGuard.initialDoc.child(0).firstChild?.firstChild;
		expect(escapedPara?.attrs.preserveRawTaskPrefix).toBe(false);
		expect(escapedPara ? hasAnyLinkMark(escapedPara) : true).toBe(false);
		const editedEscaped = insertAt(
			escapedGuard.initialDoc,
			findTextEndPos(escapedGuard.initialDoc, "[x] done"),
			"!",
		);
		expect(escapedGuard.serialize(editedEscaped)).toBe(
			"1. \\[x] done!\n\n[x]: /ref",
		);
	});

	it("keeps Type-7 HTML lines tight after refdefs, matches empty-baseline serializeDoc, and strips space+tab 4-column indents (Track B #2 + Track B #3)", () => {
		// Track B #2 part 1: Type-7 HTML lines right after refdef stay joined by `\n` (and preserve indent when present).
		for (const [md, expectedEdited] of [
			["[r]: /u\n<span>\nhello", "[r]: /u\n<span>\nhello!"],
			["[r]: /u\n    <span>\n    hello", "[r]: /u\n    <span>\nhello!"],
			["[r]: /u\n</span>\nhello", "[r]: /u\n</span>\nhello!"],
			["[r]: /u\n<foo>\nhello", "[r]: /u\n<foo>\nhello!"],
		] as const) {
			const guard = createMarkdownRoundTripGuard(md);
			expect(guard.initialDoc.childCount, md).toBe(2);
			expect(guard.initialDoc.child(1).type.name, md).toBe("paragraph");
			const edited = insertAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "\nhello"),
				"!",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, md).toBe(expectedEdited);
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
		}

		// Track B #2 part 2: Empty-baseline `cachedSerializers.serializeDoc` applies the exact same refdef join rules.
		const emptyGuard = createMarkdownRoundTripGuard("");
		expect(
			emptyGuard.serialize(parseMarkdownToVisualDoc("[r]: /u\n<span>\nhello")),
		).toBe("[r]: /u\n<span>\nhello");
		expect(
			emptyGuard.serialize(
				parseMarkdownToVisualDoc("[r]: /u\n    <div>\n    hello\n    </div>"),
			),
		).toBe("[r]: /u\n    <div>\nhello\n    </div>");

		// Track B #3: Space+tab 4-column leading indent (` \t`, `  \t`, `   \t`) never becomes `<pre><code>` when `[r]: /u` is deleted or edited.
		for (const lead of [" \t", "  \t", "   \t"]) {
			const md = `[r]: /u\n${lead}hello`;
			const guard = createMarkdownRoundTripGuard(md);
			expect(guard.initialDoc.childCount, md).toBe(2);
			expect(guard.initialDoc.child(1).type.name, md).toBe("paragraph");

			// Delete `[r]: /u` -> untouched paragraph must serialize as `"hello"`, not `" \thello"`.
			const withoutRef = EditorState.create({
				doc: guard.initialDoc,
				schema: visualEditorSchema,
			}).tr.delete(0, guard.initialDoc.child(0).nodeSize).doc;
			expect(guard.serialize(withoutRef), md).toBe("hello");

			// Edit `[r]: /u` -> `[r]: /v` -> untouched paragraph after blank line must serialize as `"hello"`.
			const editedRef = EditorState.create({
				doc: guard.initialDoc,
				schema: visualEditorSchema,
			}).tr.setNodeMarkup(0, undefined, {
				kind: "raw",
				rawMarkdown: "[r]: /v",
			}).doc;
			expect(guard.serialize(editedRef), md).toBe("[r]: /v\n\nhello");
		}
	});

	it("keeps uppercase inline HTML literal, parses 4-space/tab consecutive refdefs, and clears preserveRawTaskPrefix on ordered->bullet conversion (Track B #7 + #9 + #11)", () => {
		// Track B #7: PHP HtmlInlineParser is strict lowercase `[a-z]` for tag/attr names.
		for (const literalMd of [
			"a <SPAN>b</SPAN> c",
			'a <A href="/x">b</A> c',
		]) {
			const doc = parseMarkdownToVisualDoc(literalMd);
			expect(collectProtectedInlineRaws(doc), literalMd).toEqual([]);
			expect(doc.firstChild?.textContent, literalMd).toBe(literalMd);
		}
		const upperAttrDoc = parseMarkdownToVisualDoc(
			'a <span CLASS="a">b</span> c',
		);
		expect(collectProtectedInlineRaws(upperAttrDoc)).toEqual(["</span>"]);
		expect(upperAttrDoc.firstChild?.textContent).toBe('a <span CLASS="a">b c');

		// Track B #9: 4-space and tab-indented consecutive link reference definitions resolve and stay protected.
		for (const md of [
			"[r]: /u\n    [s]: /v\n\n[s]",
			"[r]: /u\n\t[s]: /v\n\n[s]",
		]) {
			const guard = createMarkdownRoundTripGuard(md);
			expect(guard.initialDoc.childCount, md).toBe(2);
			expect(guard.initialDoc.child(0).type.name, md).toBe("protected_block");
			const linkChild = guard.initialDoc.child(1).firstChild;
			expect(
				linkChild?.marks.find((mark) => mark.type.name === "link")?.attrs.href,
				md,
			).toBe("/v");
			expect(guard.serialize(guard.initialDoc)).toBe(md);
		}
		expect(extractReferenceDefinitionLabels("[r]: /u\n    [S]: /v")).toEqual([
			"r",
			"S",
		]);
		// Negative control: intervening blank line makes 4-space `[s]: /v` an indented code block.
		const blankRefCodeDoc = parseMarkdownToVisualDoc(
			"[r]: /u\n\n    [s]: /v\n\n[s]",
		);
		expect(blankRefCodeDoc.childCount).toBe(3);
		expect(blankRefCodeDoc.child(1).type.name).toBe("code_block");
		expect(
			blankRefCodeDoc
				.child(2)
				.firstChild?.marks.some((mark) => mark.type.name === "link"),
		).toBe(false);

		// Track B #11 + PR-R22-A Track B #8: Bullet-list serializer always escapes its first
		// content paragraph's task prefix regardless of `preserveRawTaskPrefix` (while keeping
		// subsequent paragraphs' `preserveRawTaskPrefix` intact), so converting `ordered_list`
		// to `bullet_list` never mutates into a `task_list`.
		const view = createEditorView("1. [x] item");
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
		);
		expect(
			executeVisualToolbarCommand(
				view,
				makeToolbarCommand({ id: "unorderedlist", action: "unorderedList" }),
			),
		).toBe("handled");
		expect(view.state.doc.firstChild?.type.name).toBe("bullet_list");
		const convertedMd = serializeVisualDocToMarkdown(view.state.doc);
		expect(convertedMd).toBe("- \\[x] item");
		const reparsedConverted = parseMarkdownToVisualDoc(convertedMd);
		expect(reparsedConverted.firstChild?.type.name).toBe("bullet_list");
		expect(reparsedConverted.firstChild?.textContent).toBe("[x] item");

		// Multi-paragraph ordered item conversion escapes the 1st content paragraph and keeps the 2nd raw task prefix.
		const multiView = createEditorView("1. [x] first\n\n   [ ] second");
		multiView.dispatch(
			multiView.state.tr.setSelection(
				TextSelection.create(multiView.state.doc, 3),
			),
		);
		expect(
			executeVisualToolbarCommand(
				multiView,
				makeToolbarCommand({ id: "unorderedlist", action: "unorderedList" }),
			),
		).toBe("handled");
		const convertedMultiMd = serializeVisualDocToMarkdown(multiView.state.doc);
		expect(convertedMultiMd).toBe("- \\[x] first\n\n  [ ] second");
		expect(parseMarkdownToVisualDoc(convertedMultiMd).firstChild?.type.name).toBe(
			"bullet_list",
		);
	});
});

describe("PR-R22-A PHP CommonMark column/tab parity, priority-35 task markers, ordered-list rules, exact <br>, list tightness, and interleaved containers", () => {
	const findTextEndPos = (doc: ProseMirrorNode, needle: string): number => {
		let found = -1;
		doc.descendants((node, pos) => {
			if (found < 0 && node.isText && node.text) {
				const idx = node.text.indexOf(needle);
				if (idx >= 0) {
					found = pos + idx + needle.length;
				}
			}
			return found < 0;
		});
		return found;
	};

	const insertAt = (
		doc: ProseMirrorNode,
		pos: number,
		text: string,
	): ProseMirrorNode =>
		EditorState.create({ doc, schema: visualEditorSchema }).tr.insertText(
			text,
			pos,
		).doc;

	it("preserves exact CommonMark column coordinates for tabs after blockquote and list prefixes (Track A #1)", () => {
		// `> ` lands at col 2, so `\t` advances only 2 virtual columns (< `1. ` contentIndent 3);
		// `![x](/i)` MUST remain a visible image outside the list's Type-6 HTML block.
		const md = "> Intro\n>\n> 1. <div>\n> \t![x](/i)";
		const guard = createMarkdownRoundTripGuard(md);
		const bq = guard.initialDoc.child(0);
		expect(bq.type.name).toBe("blockquote");
		expect(bq.childCount).toBe(3);
		expect(bq.child(0).textContent).toBe("Intro");
		expect(bq.child(1).type.name).toBe("ordered_list");
		expect(bq.child(1).firstChild?.child(1).type.name).toBe("protected_block");
		expect(bq.child(1).firstChild?.child(1).attrs.rawMarkdown).toBe("<div>");
		expect(bq.child(2).type.name).toBe("paragraph");
		expect(bq.child(2).firstChild?.type.name).toBe("image");
		expect(bq.child(2).firstChild?.attrs.src).toBe("/i");

		const edited = insertAt(
			guard.initialDoc,
			findTextEndPos(guard.initialDoc, "Intro"),
			"!",
		);
		const serialized = guard.serialize(edited);
		expect(serialized).toBe("> Intro!\n>\n> 1. <div>\n>\n> ![x](/i)");
		const reparsed = parseMarkdownToVisualDoc(serialized);
		expect(reparsed.child(0).child(2).firstChild?.type.name).toBe("image");

		// Tab directly after `>` (`>\t1. <div>` -> virtual col 2 + 2 virtual spaces + `1. ` = indent 5):
		// single `\t` on line 2 only gives 2 columns (< 5), so `![x](/i)` stays a visible image.
		const tabAfterBqOut = parseMarkdownToVisualDoc(">\t1. <div>\n>\t![x](/i)");
		expect(tabAfterBqOut.child(0).childCount).toBe(2);
		expect(tabAfterBqOut.child(0).child(1).firstChild?.type.name).toBe("image");

		// Double `\t\t` after `>` gives 6 columns (>= 5), so `![x](/i)` IS absorbed into the HTML block.
		const tabAfterBqIn = parseMarkdownToVisualDoc(">\t1. <div>\n>\t\t![x](/i)");
		expect(tabAfterBqIn.child(0).childCount).toBe(1);
		expect(tabAfterBqIn.child(0).child(0).firstChild?.child(1).attrs.rawMarkdown).toContain(
			"![x](/i)",
		);

		// Two spaces + tab after `> ` reaches col 8 (6 cols >= 3), so `![x](/i)` IS absorbed.
		const spacesTabIn = parseMarkdownToVisualDoc("> 1. <div>\n>   \t![x](/i)");
		expect(spacesTabIn.child(0).childCount).toBe(1);
		expect(spacesTabIn.child(0).child(0).firstChild?.child(1).attrs.rawMarkdown).toContain(
			"![x](/i)",
		);

		// Non-list-prefixed HTML block inside blockquote + list also preserves column coordinates.
		const nonListTabOut = parseMarkdownToVisualDoc(
			"> 1. para\n>    <div>\n> \t![x](/i)",
		);
		expect(nonListTabOut.child(0).childCount).toBe(2);
		expect(nonListTabOut.child(0).child(1).firstChild?.type.name).toBe("image");
	});

	it("consumes PHP priority-35 task markers on ordered-list and 2nd-paragraph items even before '(' or '[' (Track A #2 + Track B #5)", () => {
		const collectLinks = (
			node: ProseMirrorNode,
		): ReadonlyArray<{ href: string; text: string }> => {
			const links: Array<{ href: string; text: string }> = [];
			node.descendants((child) => {
				if (child.isText) {
					const link = child.marks.find((m) => m.type.name === "link");
					if (link) {
						links.push({
							href: String(link.attrs.href ?? ""),
							text: child.text ?? "",
						});
					}
				}
				return true;
			});
			return links;
		};

		// 1. `1. [x][r] Tail\n\n[r]: /real` -> `[x]` unmarked, `[r]` resolves to `/real`.
		const ordRefMd = "1. [x][r] Tail\n\n[r]: /real";
		const ordRefGuard = createMarkdownRoundTripGuard(ordRefMd);
		const ordRefPara = ordRefGuard.initialDoc.child(0).firstChild?.firstChild;
		expect(ordRefPara?.attrs.preserveRawTaskPrefix).toBe(true);
		expect(ordRefPara ? collectLinks(ordRefPara) : []).toEqual([
			{ href: "/real", text: "r" },
		]);
		expect(ordRefPara?.textContent).toBe("[x]r Tail");
		const editedOrdRef = insertAt(
			ordRefGuard.initialDoc,
			findTextEndPos(ordRefGuard.initialDoc, "Tail"),
			"!",
		);
		const serializedOrdRef = ordRefGuard.serialize(editedOrdRef);
		expect(serializedOrdRef).toBe("1. [x][r](/real) Tail!\n\n[r]: /real");
		expect(parseMarkdownToVisualDoc(serializedOrdRef).eq(editedOrdRef)).toBe(
			true,
		);

		// 2. `1. [x](not a link\n\n[x]: /ref` -> no bogus link mark, preserves raw `[x](...`.
		const brokenParenMd = "1. [x](not a link\n\n[x]: /ref";
		const brokenParenGuard = createMarkdownRoundTripGuard(brokenParenMd);
		const brokenParenPara =
			brokenParenGuard.initialDoc.child(0).firstChild?.firstChild;
		expect(brokenParenPara ? collectLinks(brokenParenPara) : []).toEqual([]);
		expect(brokenParenPara?.textContent).toBe("[x](not a link");
		const editedBrokenParen = insertAt(
			brokenParenGuard.initialDoc,
			findTextEndPos(brokenParenGuard.initialDoc, "link"),
			"!",
		);
		const serializedBrokenParen = brokenParenGuard.serialize(editedBrokenParen);
		expect(serializedBrokenParen).toBe("1. [x](not a link!\n\n[x]: /ref");
		expect(
			parseMarkdownToVisualDoc(serializedBrokenParen).eq(editedBrokenParen),
		).toBe(true);

		// 3. `1. [x][not a ref\n\n[x]: /ref` -> no bogus link mark, preserves raw `[x][...`.
		const brokenBracketMd = "1. [x][not a ref\n\n[x]: /ref";
		const brokenBracketGuard = createMarkdownRoundTripGuard(brokenBracketMd);
		const brokenBracketPara =
			brokenBracketGuard.initialDoc.child(0).firstChild?.firstChild;
		expect(brokenBracketPara ? collectLinks(brokenBracketPara) : []).toEqual(
			[],
		);
		expect(brokenBracketPara?.textContent).toBe("[x][not a ref");
		const editedBrokenBracket = insertAt(
			brokenBracketGuard.initialDoc,
			findTextEndPos(brokenBracketGuard.initialDoc, "ref"),
			"!",
		);
		const serializedBrokenBracket =
			brokenBracketGuard.serialize(editedBrokenBracket);
		expect(serializedBrokenBracket).toBe("1. [x][not a ref!\n\n[x]: /ref");
		expect(
			parseMarkdownToVisualDoc(serializedBrokenBracket).eq(editedBrokenBracket),
		).toBe(true);

		// 4. `1. [x](https://example.com)` -> `[x]` is NOT a link to example.com.
		const urlTaskMd = "1. [x](https://example.com)";
		const urlTaskGuard = createMarkdownRoundTripGuard(urlTaskMd);
		const urlTaskPara = urlTaskGuard.initialDoc.child(0).firstChild?.firstChild;
		expect(urlTaskPara ? collectLinks(urlTaskPara) : []).toEqual([]);
		expect(urlTaskPara?.textContent).toBe("[x](https://example.com)");
		const editedUrlTask = insertAt(
			urlTaskGuard.initialDoc,
			findTextEndPos(urlTaskGuard.initialDoc, "example.com)"),
			"!",
		);
		const serializedUrlTask = urlTaskGuard.serialize(editedUrlTask);
		expect(serializedUrlTask).toBe("1. [x](https://example.com)!");
		expect(parseMarkdownToVisualDoc(serializedUrlTask).eq(editedUrlTask)).toBe(
			true,
		);

		// 5. 2nd paragraph of a bullet item: `- Intro\n\n  [x][r] Tail\n\n[r]: /real`.
		const p2RefMd = "- Intro\n\n  [x][r] Tail\n\n[r]: /real";
		const p2RefGuard = createMarkdownRoundTripGuard(p2RefMd);
		const p2RefPara = p2RefGuard.initialDoc.child(0).firstChild?.child(1);
		expect(p2RefPara?.attrs.preserveRawTaskPrefix).toBe(true);
		expect(p2RefPara ? collectLinks(p2RefPara) : []).toEqual([
			{ href: "/real", text: "r" },
		]);
		const editedP2Ref = insertAt(
			p2RefGuard.initialDoc,
			findTextEndPos(p2RefGuard.initialDoc, "Tail"),
			"!",
		);
		const serializedP2Ref = p2RefGuard.serialize(editedP2Ref);
		expect(serializedP2Ref).toBe("- Intro\n\n  [x][r](/real) Tail!\n\n[r]: /real");
		expect(parseMarkdownToVisualDoc(serializedP2Ref).eq(editedP2Ref)).toBe(true);
	});

	it("matches PHP ordered-list marker rules for 2. / 01. paragraph interruption and sibling list items (Track A #4 + Track B #4)", () => {
		// 1. Sibling `2. <kbd>` / `02. <kbd>` after `1. First` (and after `- First` or lazy continuation)
		// closes the previous list item (`$inParagraph === false`), so `<kbd>\nTail` is a protected Type-7 HTML block.
		for (const md of [
			"1. First\n2. <kbd>\n   Tail",
			"1. First\n02. <kbd>\n    Tail",
			"1. First\nLazy\n2. <kbd>\n   Tail",
		]) {
			const guard = createMarkdownRoundTripGuard(md);
			expect(guard.initialDoc.childCount, md).toBe(1);
			const list = guard.initialDoc.child(0);
			expect(list.type.name, md).toBe("ordered_list");
			expect(list.childCount, md).toBe(2);
			expect(list.child(1).child(1).type.name, md).toBe("protected_block");
			expect(list.child(1).child(1).attrs.rawMarkdown, md).toBe("<kbd>\nTail");
			const edited = insertAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "First"),
				"!",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, md).toContain("First!");
			expect(serialized, md).toContain("<kbd>\n");
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
		}

		// `- First\n2. <kbd>\n   Tail` -> bullet_list + ordered_list(start=2) with protected `<kbd>\nTail`.
		const bulletThen2 = parseMarkdownToVisualDoc("- First\n2. <kbd>\n   Tail");
		expect(bulletThen2.childCount).toBe(2);
		expect(bulletThen2.child(0).type.name).toBe("bullet_list");
		expect(bulletThen2.child(1).type.name).toBe("ordered_list");
		expect(bulletThen2.child(1).attrs.order).toBe(2);
		expect(bulletThen2.child(1).firstChild?.child(1).attrs.rawMarkdown).toBe(
			"<kbd>\nTail",
		);

		// 2. `para\n2. text\n    <div>\n    keep`: `2.` does NOT interrupt `para`, so `    <div>` stays
		// an indented continuation raw-inline (never corrupted into `\<div>`).
		const para2Md = "para\n2. text\n    <div>\n    keep";
		const para2Guard = createMarkdownRoundTripGuard(para2Md);
		expect(para2Guard.initialDoc.childCount).toBe(1);
		expect(para2Guard.initialDoc.child(0).type.name).toBe("paragraph");
		expect(collectProtectedInlineRaws(para2Guard.initialDoc)).toEqual([
			"<div>",
		]);
		const editedPara2 = insertAt(
			para2Guard.initialDoc,
			findTextEndPos(para2Guard.initialDoc, "keep"),
			"!",
		);
		const serializedPara2 = para2Guard.serialize(editedPara2);
		expect(serializedPara2).toBe("para\n2\\. text\n    <div>\nkeep!");
		expect(serializedPara2).not.toContain("\\<div>");
		expect(parseMarkdownToVisualDoc(serializedPara2).eq(editedPara2)).toBe(
			true,
		);

		// 3. `paragraph\n01. <div>\n    hello`: PHP checks exact `$matches[1] === '1'`,
		// so `01.` does NOT interrupt `paragraph` in prescanner OR markdown-it.
		const para01Md = "paragraph\n01. <div>\n    hello";
		const para01Guard = createMarkdownRoundTripGuard(para01Md);
		expect(para01Guard.initialDoc.childCount).toBe(1);
		expect(para01Guard.initialDoc.child(0).type.name).toBe("paragraph");
		expect(collectProtectedInlineRaws(para01Guard.initialDoc)).toEqual([
			"<div>",
		]);
		const editedPara01 = insertAt(
			para01Guard.initialDoc,
			findTextEndPos(para01Guard.initialDoc, "hello"),
			"!",
		);
		expect(para01Guard.serialize(editedPara01)).toBe(
			"paragraph\n01\\. <div>\nhello!",
		);

		// 4. Indented nested `2.` / `01.` inside `1. First` cannot interrupt the item's open paragraph,
		// while exact `1.` CAN interrupt and start a nested ordered list.
		for (const nestedNonInterrupt of [
			"1. First\n   2. <kbd>\n      Tail",
			"1. First\n   01. <kbd>\n       Tail",
		]) {
			const doc = parseMarkdownToVisualDoc(nestedNonInterrupt);
			expect(doc.childCount, nestedNonInterrupt).toBe(1);
			expect(doc.child(0).childCount, nestedNonInterrupt).toBe(1);
			expect(doc.child(0).firstChild?.childCount, nestedNonInterrupt).toBe(1);
			expect(
				doc.child(0).firstChild?.firstChild?.type.name,
				nestedNonInterrupt,
			).toBe("paragraph");
		}
		const nestedOne = parseMarkdownToVisualDoc(
			"1. First\n   1. <kbd>\n      Tail",
		);
		expect(nestedOne.child(0).firstChild?.childCount).toBe(2);
		expect(nestedOne.child(0).firstChild?.child(1).type.name).toBe(
			"ordered_list",
		);
		expect(
			nestedOne.child(0).firstChild?.child(1).firstChild?.child(1).attrs
				.rawMarkdown,
		).toBe("<kbd>\nTail");

		// 5. Non-interrupting `2. ```js` / `01. ```js` after open paragraph do not open a code fence.
		for (const nonFence of [
			"para\n2. ```js\n   code\n   ```",
			"para\n01. ```js\n    code\n    ```",
		]) {
			const doc = parseMarkdownToVisualDoc(nonFence);
			expect(doc.firstChild?.type.name, nonFence).toBe("paragraph");
		}
	});

	it("matches exact case-sensitive <br> for GFM table cell breaks (Track A #5 + Track B #6)", () => {
		const md = "| A |\n| --- |\n| a<br>b<br/>c<br />d<BR>e<Br>f |";
		const guard = createMarkdownRoundTripGuard(md);
		const table = guard.initialDoc.child(0);
		expect(table.type.name).toBe("table");
		const cellPara = table.child(1).firstChild?.firstChild;
		expect(cellPara?.type.name).toBe("paragraph");

		let hardBreakCount = 0;
		const inlineRaws: string[] = [];
		cellPara?.forEach((node) => {
			if (node.type.name === "hard_break") hardBreakCount += 1;
			if (node.type.name === "protected_inline") {
				inlineRaws.push(String(node.attrs.rawMarkdown ?? ""));
			}
		});
		expect(hardBreakCount).toBe(1);
		expect(inlineRaws).toEqual(["<br/>", "<br />"]);
		expect(cellPara?.textContent).toBe("abcd<BR>e<Br>f");

		const edited = insertAt(
			guard.initialDoc,
			findTextEndPos(guard.initialDoc, "a"),
			"!",
		);
		const serialized = guard.serialize(edited);
		expect(serialized).toBe(
			"| A |\n| --- |\n| a!<br>b<br/>c<br />d\\<BR>e\\<Br>f |",
		);
	});

	it("preserves loose adjacent blockquotes and tight paragraph+HTML lists (Track B #7)", () => {
		// 1. Loose list without direct paragraphs (`- > a\n\n  > b`) keeps `tight: false` and never merges blockquotes.
		const twoBqMd = "- > a\n\n  > b";
		const twoBqGuard = createMarkdownRoundTripGuard(twoBqMd);
		expect(twoBqGuard.initialDoc.child(0).type.name).toBe("bullet_list");
		expect(twoBqGuard.initialDoc.child(0).attrs.tight).toBe(false);
		expect(twoBqGuard.initialDoc.child(0).firstChild?.childCount).toBe(3); // phantom para + 2 blockquotes
		const editedBq = insertAt(
			twoBqGuard.initialDoc,
			findTextEndPos(twoBqGuard.initialDoc, "a"),
			"!",
		);
		const serializedTwoBq = twoBqGuard.serialize(editedBq);
		expect(serializedTwoBq).toBe("-\n  > a!\n\n  > b");
		expect(parseMarkdownToVisualDoc(serializedTwoBq).eq(editedBq)).toBe(true);

		// Even if a list node is explicitly `tight: true`, two adjacent blockquotes never merge.
		const forcedTightTwoBq = visualEditorSchema.nodes.doc.create(null, [
			visualEditorSchema.nodes.bullet_list.create({ marker: "-", tight: true }, [
				visualEditorSchema.nodes.list_item.create(null, [
					visualEditorSchema.nodes.paragraph.create(),
					visualEditorSchema.nodes.blockquote.create(null, [
						visualEditorSchema.nodes.paragraph.create(null, [
							visualEditorSchema.text("a"),
						]),
					]),
					visualEditorSchema.nodes.blockquote.create(null, [
						visualEditorSchema.nodes.paragraph.create(null, [
							visualEditorSchema.text("b"),
						]),
					]),
				]),
			]),
		]);
		expect(serializeVisualDocToMarkdown(forcedTightTwoBq)).toBe(
			"-\n  > a\n\n  > b",
		);

		// Inter-item blank line without direct paragraphs also stays loose.
		expect(parseMarkdownToVisualDoc("- > a\n\n- > b").child(0).attrs.tight).toBe(
			false,
		);
		// Blank line strictly INSIDE a blockquote does NOT make the outer list loose.
		expect(
			parseMarkdownToVisualDoc("- > a\n  >\n  > b\n- c").child(0).attrs.tight,
		).toBe(true);
		expect(
			parseMarkdownToVisualDoc("- > a\n  >\n- b").child(0).attrs.tight,
		).toBe(true);

		// 2. Tight `paragraph + Types 1–6 HTML block` list stays tight after edits (space or tab after `-`).
		for (const tightHtmlMd of [
			"- para\n  <div>\n  hidden",
			"-\tpara\n\t<div>\n\thidden",
		]) {
			const guard = createMarkdownRoundTripGuard(tightHtmlMd);
			expect(guard.initialDoc.child(0).attrs.tight, tightHtmlMd).toBe(true);
			const edited = insertAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "para"),
				"!",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, tightHtmlMd).toBe("- para!\n  <div>\n  hidden");
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), tightHtmlMd).toBe(
				true,
			);
		}
	});

	it("enforces bullet-list first-paragraph task escaping across all structural mutation paths (Track B #8)", () => {
		// Path 1: Toggle `orderedList` off -> `unorderedList` on.
		const view1 = createEditorView("1. [x] item");
		view1.dispatch(
			view1.state.tr.setSelection(TextSelection.create(view1.state.doc, 3)),
		);
		expect(
			executeVisualToolbarCommand(
				view1,
				makeToolbarCommand({ id: "orderedlist", action: "orderedList" }),
			),
		).toBe("handled");
		expect(view1.state.doc.firstChild?.type.name).toBe("paragraph");
		expect(
			executeVisualToolbarCommand(
				view1,
				makeToolbarCommand({ id: "unorderedlist", action: "unorderedList" }),
			),
		).toBe("handled");
		const md1 = serializeVisualDocToMarkdown(view1.state.doc);
		expect(md1).toBe("- \\[x] item");
		expect(parseMarkdownToVisualDoc(md1).firstChild?.type.name).toBe(
			"bullet_list",
		);

		// Path 2: Lift nested `1. [x] nested` into parent `bullet_list`.
		const view2 = createEditorView("- parent\n  1. [x] nested");
		const nestedPos = findTextEndPos(view2.state.doc, "nested");
		view2.dispatch(
			view2.state.tr.setSelection(
				TextSelection.create(view2.state.doc, nestedPos),
			),
		);
		expect(
			executeVisualToolbarCommand(
				view2,
				makeToolbarCommand({ id: "orderedlist", action: "orderedList" }),
			),
		).toBe("handled");
		const md2 = serializeVisualDocToMarkdown(view2.state.doc);
		expect(md2).toBe("- parent\n- \\[x] nested");
		const reparsed2 = parseMarkdownToVisualDoc(md2);
		expect(reparsed2.childCount).toBe(1);
		expect(reparsed2.firstChild?.type.name).toBe("bullet_list");

		// Path 3: Delete 1st paragraph of `- first\n\n  [x] second` so 2nd paragraph becomes 1st.
		const multiDoc = parseMarkdownToVisualDoc("- first\n\n  [x] second");
		const firstPara = multiDoc.firstChild?.firstChild?.firstChild;
		expect(firstPara).toBeDefined();
		const deletedFirstState = EditorState.create({
			doc: multiDoc,
			schema: visualEditorSchema,
		});
		// doc -> bullet_list (0) -> list_item (1) -> first paragraph starts at 2.
		const afterDelete = deletedFirstState.tr.delete(
			2,
			2 + (firstPara?.nodeSize ?? 0),
		).doc;
		const md3 = serializeVisualDocToMarkdown(afterDelete);
		expect(md3).toBe("- \\[x] second");
		expect(parseMarkdownToVisualDoc(md3).firstChild?.type.name).toBe(
			"bullet_list",
		);

		// Path 4: Leading reference definition before `[x]` paragraph in converted `ordered_list` -> `bullet_list`.
		const refView = createEditorView("1. [r]: /u\n   [x] item");
		const refItemPos = findTextEndPos(refView.state.doc, "item");
		refView.dispatch(
			refView.state.tr.setSelection(
				TextSelection.create(refView.state.doc, refItemPos),
			),
		);
		expect(
			executeVisualToolbarCommand(
				refView,
				makeToolbarCommand({ id: "unorderedlist", action: "unorderedList" }),
			),
		).toBe("handled");
		const md4 = serializeVisualDocToMarkdown(refView.state.doc);
		expect(md4).toBe("- [r]: /u\n  \\[x] item");
		expect(parseMarkdownToVisualDoc(md4).firstChild?.type.name).toBe(
			"bullet_list",
		);
	});

	it("uses ASCII-only GFM table separator parsing (rejecting trailing NBSP) and peels interleaved list/blockquote HTML blocks (Track B #9)", () => {
		// 1. Trailing NBSP `\u00A0` on delimiter line disqualifies the GFM table, so `<br>` is inline HTML (not hard_break).
		const nbspTableMd = "| A |\n| --- |\u00A0\n| a<br>b |";
		const nbspDoc = parseMarkdownToVisualDoc(nbspTableMd);
		expect(nbspDoc.childCount).toBe(1);
		expect(nbspDoc.child(0).type.name).toBe("paragraph");
		let nbspHardBreaks = 0;
		nbspDoc.descendants((node) => {
			if (node.type.name === "hard_break") nbspHardBreaks += 1;
			return true;
		});
		expect(nbspHardBreaks).toBe(0);
		expect(collectProtectedInlineRaws(nbspDoc)).toEqual(["<br>"]);

		// 2. Interleaved list + blockquote HTML block (`- > <div>\n  > hidden\n\n  > visible`).
		const interleavedMd = "- > <div>\n  > hidden\n\n  > visible";
		const guard = createMarkdownRoundTripGuard(interleavedMd);
		const list = guard.initialDoc.child(0);
		expect(list.type.name).toBe("bullet_list");
		expect(list.attrs.tight).toBe(false);
		const item = list.firstChild;
		expect(item?.child(1).type.name).toBe("blockquote");
		expect(item?.child(1).firstChild?.type.name).toBe("protected_block");
		expect(item?.child(1).firstChild?.attrs.rawMarkdown).toBe("<div>\nhidden");
		expect(item?.child(2).type.name).toBe("blockquote");
		expect(item?.child(2).textContent).toBe("visible");

		const edited = insertAt(
			guard.initialDoc,
			findTextEndPos(guard.initialDoc, "visible"),
			"!",
		);
		const serialized = guard.serialize(edited);
		expect(serialized).toBe("-\n  > <div>\n  > hidden\n\n  > visible!");
		expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);

		// Deeper nesting: `> - > <div>\n>   > hidden\n>\n>   > visible` and `- > 1. <div>\n  >    hidden\n\n  >    visible`.
		const bqListBq = parseMarkdownToVisualDoc(
			"> - > <div>\n>   > hidden\n>\n>   > visible",
		);
		const innerItem = bqListBq.child(0).child(0).firstChild;
		expect(innerItem?.child(1).firstChild?.attrs.rawMarkdown).toBe(
			"<div>\nhidden",
		);
		expect(innerItem?.child(2).textContent).toBe("visible");

		const listBqList = parseMarkdownToVisualDoc(
			"- > 1. <div>\n  >    hidden\n\n  >    visible",
		);
		const outerItem = listBqList.child(0).firstChild;
		expect(
			outerItem?.child(1).firstChild?.firstChild?.child(1).attrs.rawMarkdown,
		).toBe("<div>\nhidden");
		expect(outerItem?.child(2).textContent).toBe("visible");
	});
});

describe("PR-R23-A pipe math in tables, list-prefixed tables, container-bounded fences, list->quote order, and tight blockquote lists", () => {
	function collectProtectedInlines(doc: ProseMirrorNode): Array<{
		kind: string;
		rawMarkdown: string;
	}> {
		const entries: Array<{ kind: string; rawMarkdown: string }> = [];
		doc.descendants((node) => {
			if (node.type.name === "protected_inline") {
				entries.push({
					kind: String(node.attrs.kind ?? ""),
					rawMarkdown: String(node.attrs.rawMarkdown ?? ""),
				});
			}
			return true;
		});
		return entries;
	}

	function findTextEndPos(doc: ProseMirrorNode, needle: string): number {
		let found = -1;
		doc.descendants((node, pos) => {
			if (found !== -1) return false;
			if (node.isText && node.text) {
				const idx = node.text.indexOf(needle);
				if (idx !== -1) {
					found = pos + idx + needle.length;
					return false;
				}
			}
			return true;
		});
		if (found === -1) {
			throw new Error(`Needle not found in visual doc: ${needle}`);
		}
		return found;
	}

	function insertTextAt(
		doc: ProseMirrorNode,
		pos: number,
		text: string,
	): ProseMirrorNode {
		const state = EditorState.create({ doc, schema: visualEditorSchema });
		return state.tr.insertText(text, pos).doc;
	}

	it("preserves pipe-containing inline math ($a|b$, \\(x|y\\), $$a|b$$) in GFM table bodies and headers (Track A #1/#2 + Track B #1)", () => {
		// 1. `$a|b$` in table body: editing header `A` -> `AZ` preserves both `$a|b$` verbatim and `![x](x.png)`.
		const dollarBodyMd = "| A | B |\n|---|---|\n| $a|b$ | ![x](x.png) |";
		const dollarGuard = createMarkdownRoundTripGuard(dollarBodyMd);
		expect(collectProtectedInlines(dollarGuard.initialDoc)).toEqual([
			{ kind: "math-inline", rawMarkdown: "$a|b$" },
		]);
		const editedDollar = insertTextAt(
			dollarGuard.initialDoc,
			findTextEndPos(dollarGuard.initialDoc, "A"),
			"Z",
		);
		const serializedDollar = dollarGuard.serialize(editedDollar);
		expect(serializedDollar).toBe(
			"| AZ | B |\n| --- | --- |\n| $a|b$ | ![x](x.png) |",
		);
		expect(parseMarkdownToVisualDoc(serializedDollar).eq(editedDollar)).toBe(
			true,
		);

		// 2. `\(x|y\)` in table body: editing header `A` -> `AZ` keeps `|` unescaped (`\(x|y\)`, not `\(x\|y\)`).
		const parenBodyMd = "| A | B |\n|---|---|\n| \\(x|y\\) | ![x](x.png) |";
		const parenGuard = createMarkdownRoundTripGuard(parenBodyMd);
		expect(collectProtectedInlines(parenGuard.initialDoc)).toEqual([
			{ kind: "math-inline", rawMarkdown: "\\(x|y\\)" },
		]);
		const editedParen = insertTextAt(
			parenGuard.initialDoc,
			findTextEndPos(parenGuard.initialDoc, "A"),
			"Z",
		);
		const serializedParen = parenGuard.serialize(editedParen);
		expect(serializedParen).toBe(
			"| AZ | B |\n| --- | --- |\n| \\(x|y\\) | ![x](x.png) |",
		);
		expect(parseMarkdownToVisualDoc(serializedParen).eq(editedParen)).toBe(true);

		// 3. `$$a|b$$` and `\[a|b\]` break the table into `\n\n<token>\n\n` in PHP,
		// moving the display math and trailing `| ![x](x.png) |` outside the table.
		for (const expr of ["$$a|b$$", "\\[a|b\\]"]) {
			const md = `| A | B |\n|---|---|\n| ${expr} | ![x](x.png) |`;
			const guard = createMarkdownRoundTripGuard(md);
			expect(guard.initialDoc.childCount).toBe(3);
			expect(guard.initialDoc.child(0).type.name).toBe("table");
			expect(guard.initialDoc.child(1).type.name).toBe("protected_block");
			expect(guard.initialDoc.child(1).attrs.kind).toBe("math");
			expect(guard.initialDoc.child(1).attrs.rawMarkdown).toBe(expr);
			expect(guard.initialDoc.child(2).type.name).toBe("paragraph");
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "A"),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized).toBe(
				`| AZ | B |\n| --- | --- |\n|  |  |\n\n${expr}\n\n| ![x](x.png) |`,
			);
			expect(parseMarkdownToVisualDoc(serialized).eq(edited)).toBe(true);
		}

		// 4. Pipe-containing math in table HEADER still detects the GFM table so `<br>` becomes `hard_break`.
		for (const headerMath of ["$a|b$", "\\(a|b\\)", "$|x| = 1$"]) {
			const headerMd = `| ${headerMath} | C |\n| --- | --- |\n| a<br>b | 2 |`;
			const guard = createMarkdownRoundTripGuard(headerMd);
			expect(guard.initialDoc.firstChild?.type.name).toBe("table");
			let hardBreaks = 0;
			guard.initialDoc.descendants((node) => {
				if (node.type.name === "hard_break") hardBreaks += 1;
				return true;
			});
			expect(hardBreaks, headerMath).toBe(1);
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "C"),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, headerMath).toBe(
				`| ${headerMath} | CZ |\n| --- | --- |\n| a<br>b | 2 |`,
			);
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), headerMath).toBe(
				true,
			);
		}
	});

	it("handles list-prefixed GFM tables, list-prefixed table-align comments, and container-bounded findGfmTableEnd (Track B #2)", () => {
		// 1. List-prefixed GFM tables (`- | A | B |`, tab-indented, and nested lists) convert `<br>` to `hard_break`.
		for (const listTableMd of [
			"- | A | B |\n  | --- | --- |\n  | a<br>b | c |",
			"-\t| A | B |\n\t| --- | --- |\n\t| a<br>b | c |",
			"- outer\n  - | A | B |\n    | --- | --- |\n    | a<br>b | c |",
			"- - | A | B |\n    | --- | --- |\n    | a<br>b | c |",
		]) {
			const guard = createMarkdownRoundTripGuard(listTableMd);
			let hardBreaks = 0;
			let tables = 0;
			guard.initialDoc.descendants((node) => {
				if (node.type.name === "table") tables += 1;
				if (node.type.name === "hard_break") hardBreaks += 1;
				return true;
			});
			expect(tables, listTableMd).toBe(1);
			expect(hardBreaks, listTableMd).toBe(1);
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "A"),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, listTableMd).toContain("a<br>b");
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), listTableMd).toBe(
				true,
			);
		}

		// 2. List-prefixed table alignment annotation keeps the list wrapper and applies cell alignment.
		const listAlignMd =
			'- <!-- easymde-table-align:v1 [[1,"center"]] -->\n  | A | B |\n  | --- | --- |\n  | 1 | 2 |';
		const preAlign = prescanMarkdown(listAlignMd);
		expect(preAlign.tableAlignMarkers.size).toBe(1);
		expect(preAlign.markdown.startsWith("- EASYMDEPH")).toBe(true);
		const listAlignGuard = createMarkdownRoundTripGuard(listAlignMd);
		const listNode = listAlignGuard.initialDoc.firstChild;
		expect(listNode?.type.name).toBe("bullet_list");
		const tableNode = listNode?.firstChild?.child(1);
		expect(tableNode?.type.name).toBe("table");
		expect(tableNode?.attrs.alignAnnotation).toBe(
			'<!-- easymde-table-align:v1 [[1,"center"]] -->',
		);
		expect(tableNode?.child(1).child(0).attrs.textAlign).toBe("center");
		expect(tableNode?.child(1).child(1).attrs.textAlign).toBe("center");
		const editedAlign = insertTextAt(
			listAlignGuard.initialDoc,
			findTextEndPos(listAlignGuard.initialDoc, "A"),
			"Z",
		);
		const serializedAlign = listAlignGuard.serialize(editedAlign);
		expect(serializedAlign).toContain(
			'<!-- easymde-table-align:v1 [[1,"center"]] -->',
		);
		expect(
			parseMarkdownToVisualDoc(serializedAlign).eq(editedAlign),
		).toBe(true);

		// Blockquote + list-prefixed table alignment annotation also works cleanly.
		const bqListAlignMd =
			'> - <!-- easymde-table-align:v1 [[1,"center"]] -->\n>   | A | B |\n>   | --- | --- |\n>   | 1 | 2 |';
		const bqListAlignDoc = parseMarkdownToVisualDoc(bqListAlignMd);
		let centeredCells = 0;
		bqListAlignDoc.descendants((node) => {
			if (node.type.name === "table_cell" && node.attrs.textAlign === "center") {
				centeredCells += 1;
			}
			return true;
		});
		expect(centeredCells).toBe(2);

		// 3. Container-bounded `findGfmTableEnd()` never leaks `isTableRow = true` past blockquote/list/indent boundaries.
		const nonTableTrailingCases = [
			"> | A | B |\n> | --- | --- |\n> | 1 | 2 |\n- not a table | a<br>b",
			"-\n  | A | B |\n  | --- | --- |\n  | 1 | 2 |\n- not a table | a<br>b",
			"-\n  | A | B |\n  | --- | --- |\n  | 1 | 2 |\n  - not a table | a<br>b",
			"| A | B |\n| --- | --- |\n| 1 | 2 |\n    | indented | a<br>b |",
			"> | A | B |\n> | --- | --- |\n> | 1 | 2 |\n> > | deeper | a<br>b |",
		];
		for (const md of nonTableTrailingCases) {
			const doc = parseMarkdownToVisualDoc(md);
			let hardBreaks = 0;
			doc.descendants((node) => {
				if (node.type.name === "hard_break") hardBreaks += 1;
				return true;
			});
			expect(hardBreaks, md).toBe(0);
			// The non-table line `<br>` stays raw HTML (or literal code block text), never `hard_break`.
			if (!md.includes("    | indented")) {
				expect(collectProtectedInlines(doc), md).toContainEqual({
					kind: "raw-inline",
					rawMarkdown: "<br>",
				});
			}
		}
	});

	it("keeps fenced code scanning container-aware and matches exact quoteDepth in isFenceCloser (Track B #3)", () => {
		// 1. `> ``` ` inside a top-level fence must NOT prematurely close the fence.
		const gtInsideTopFence = "```js\n> ```\n```\n\n$$real math$$";
		const topFenceGuard = createMarkdownRoundTripGuard(gtInsideTopFence);
		expect(topFenceGuard.initialDoc.childCount).toBe(2);
		expect(topFenceGuard.initialDoc.child(0).type.name).toBe("code_block");
		expect(topFenceGuard.initialDoc.child(0).textContent).toBe("> ```");
		expect(topFenceGuard.initialDoc.child(1).type.name).toBe("protected_block");
		expect(topFenceGuard.initialDoc.child(1).attrs.kind).toBe("math");
		expect(topFenceGuard.initialDoc.child(1).attrs.rawMarkdown).toBe(
			"$$real math$$",
		);

		// Extra `>` inside a blockquote-nested fence also must NOT close it.
		const extraGtInBqFence = "> ```js\n> > ```\n> ```\n>\n> $$real math$$";
		const bqFenceDoc = parseMarkdownToVisualDoc(extraGtInBqFence);
		expect(bqFenceDoc.childCount).toBe(1);
		expect(bqFenceDoc.child(0).child(0).type.name).toBe("code_block");
		expect(bqFenceDoc.child(0).child(0).textContent).toBe("> ```");
		expect(bqFenceDoc.child(0).child(1).type.name).toBe("protected_block");
		expect(bqFenceDoc.child(0).child(1).attrs.kind).toBe("math");

		// 2. Unclosed fence inside blockquote, list, or list->quote ends when its container closes.
		for (const unclosedMd of [
			"> ```js\n> code\n$$x$$",
			"- ```js\n  code\n$$x$$",
			"- ```js\n  code\n\n$$x$$",
			"- > ```js\n  > code\n  $$x$$",
		]) {
			const doc = parseMarkdownToVisualDoc(unclosedMd);
			let codeBlocks = 0;
			let mathBlocks = 0;
			doc.descendants((node) => {
				if (node.type.name === "code_block") codeBlocks += 1;
				if (node.type.name === "protected_block" && node.attrs.kind === "math") {
					mathBlocks += 1;
				}
				return true;
			});
			expect(codeBlocks, unclosedMd).toBe(1);
			expect(mathBlocks, unclosedMd).toBe(1);
		}
	});

	it("preserves list -> quote container order so 2. <kbd> stays inside an open paragraph without escaping <kbd> (Track A #5)", () => {
		// 1. `- > Alpha\n  > 2. <kbd>\n  > Tail` (and 4-space `10. > ...`, `01.`, `<kbd>`) stays one open paragraph.
		for (const md of [
			"- > Alpha\n  > 2. <kbd>\n  > Tail",
			"10. > Alpha\n    > 2. <kbd>\n    > Tail",
			"- > Alpha\n  > 01. <kbd>\n  > Tail",
			"- > Alpha\n  > <kbd>\n  > Tail",
		]) {
			const guard = createMarkdownRoundTripGuard(md);
			expect(collectProtectedInlines(guard.initialDoc), md).toEqual([
				{ kind: "raw-inline", rawMarkdown: "<kbd>" },
			]);
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "Alpha"),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, md).toContain("<kbd>");
			expect(serialized, md).not.toContain("\\<kbd>");
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
		}

		// 2. Contrast cases matching PHP CommonMark:
		// `1.` interrupts the open paragraph, starting an ordered list whose `<kbd>` is a Type 7 HTML block.
		const interruptOne = parseMarkdownToVisualDoc(
			"- > Alpha\n  > 1. <kbd>\n  > Tail",
		);
		const bqOne = interruptOne.child(0).firstChild?.child(1);
		expect(bqOne?.childCount).toBe(3);
		expect(bqOne?.child(1).type.name).toBe("ordered_list");
		expect(bqOne?.child(1).firstChild?.child(1).type.name).toBe(
			"protected_block",
		);

		// Refdef-only paragraph allows `2.` to start an ordered list inside `list -> quote`.
		const refDefTwo = parseMarkdownToVisualDoc(
			"- > [r]: /u\n  > 2. <kbd>\n  > Tail",
		);
		const bqRef = refDefTwo.child(0).firstChild?.child(1);
		expect(bqRef?.child(1).type.name).toBe("ordered_list");
		expect(bqRef?.child(1).attrs.order).toBe(2);

		// Dropping out of the inner `>` closes the blockquote so `2.` starts an ordered list in the outer list item.
		const droppedBq = parseMarkdownToVisualDoc("- > Alpha\n  2. <kbd>\n  Tail");
		const outerListItem = droppedBq.child(0).firstChild;
		expect(outerListItem?.child(1).type.name).toBe("blockquote");
		expect(outerListItem?.child(2).type.name).toBe("ordered_list");
		expect(outerListItem?.child(2).attrs.order).toBe(2);

		// Type 6 HTML block (`<div>`) still interrupts the open paragraph inside `list -> quote`.
		const type6InListQuote = parseMarkdownToVisualDoc(
			"- > Alpha\n  > <div>\n  > hidden",
		);
		const bqDiv = type6InListQuote.child(0).firstChild?.child(1);
		expect(bqDiv?.child(0).type.name).toBe("paragraph");
		expect(bqDiv?.child(1).type.name).toBe("protected_block");
		expect(bqDiv?.child(1).attrs.rawMarkdown).toBe("<div>\nhidden");
	});

	it("keeps tight blockquote + paragraph lists tight only when the blockquote cannot lazily absorb the paragraph (Track A #6)", () => {
		// 1. `- > <section>\n  Alpha\n  Tail` edited (`Alpha` -> `Alpha!`) stays tight without blank line before `Alpha!`.
		const tightHtmlBqMd = "- > <section>\n  Alpha\n  Tail";
		const guard = createMarkdownRoundTripGuard(tightHtmlBqMd);
		expect(guard.initialDoc.child(0).attrs.tight).toBe(true);
		const edited = insertTextAt(
			guard.initialDoc,
			findTextEndPos(guard.initialDoc, "Alpha"),
			"!",
		);
		const serialized = guard.serialize(edited);
		expect(serialized).toBe("-\n  > <section>\n  Alpha!\n  Tail");
		const reparsed = parseMarkdownToVisualDoc(serialized);
		expect(reparsed.child(0).attrs.tight).toBe(true);
		expect(reparsed.eq(edited)).toBe(true);

		// Closed leaf blocks inside a tight blockquote (`heading`, `code_block`, `hr`, nested `> > <section>`) stay tight too.
		for (const tightCase of [
			"- > # Head\n  Alpha",
			"- > ```\n  > code\n  > ```\n  Alpha",
			"- > ---\n  Alpha",
			"- > > <section>\n  Alpha",
		]) {
			const g = createMarkdownRoundTripGuard(tightCase);
			expect(g.initialDoc.child(0).attrs.tight, tightCase).toBe(true);
			const ed = insertTextAt(
				g.initialDoc,
				findTextEndPos(g.initialDoc, "Alpha"),
				"!",
			);
			const ser = g.serialize(ed);
			expect(ser, tightCase).not.toContain("\n\n  Alpha!");
			expect(parseMarkdownToVisualDoc(ser).child(0).attrs.tight, tightCase).toBe(
				true,
			);
			expect(parseMarkdownToVisualDoc(ser).eq(ed), tightCase).toBe(true);
		}

		// 2. Blockquotes that CAN lazily absorb a following paragraph (paragraph, table, list->paragraph, refdef) keep `\n\n`.
		const looseQuoteAfter = createMarkdownRoundTripGuard("- > Quote\n\n  After");
		const editedAfter = insertTextAt(
			looseQuoteAfter.initialDoc,
			findTextEndPos(looseQuoteAfter.initialDoc, "After"),
			"!",
		);
		const serializedAfter = looseQuoteAfter.serialize(editedAfter);
		expect(serializedAfter).toBe("-\n  > Quote\n\n  After!");
		expect(parseMarkdownToVisualDoc(serializedAfter).eq(editedAfter)).toBe(true);

		// Even with forced `tight: true`, lazy-continuable blockquotes and adjacent blockquotes MUST emit `\n\n`.
		const buildForcedTightItem = (
			first: ProseMirrorNode,
			second: ProseMirrorNode,
		): ProseMirrorNode =>
			visualEditorSchema.nodes.doc.create(null, [
				visualEditorSchema.nodes.bullet_list.create(
					{ marker: "-", tight: true },
					[
						visualEditorSchema.nodes.list_item.create(null, [
							visualEditorSchema.nodes.paragraph.create(),
							first,
							second,
						]),
					],
				),
			]);

		const afterPara = visualEditorSchema.nodes.paragraph.create(null, [
			visualEditorSchema.text("After"),
		]);

		// Blockquote ending in paragraph -> `\n\n`
		expect(
			serializeVisualDocToMarkdown(
				buildForcedTightItem(
					visualEditorSchema.nodes.blockquote.create(null, [
						visualEditorSchema.nodes.paragraph.create(null, [
							visualEditorSchema.text("Quote"),
						]),
					]),
					afterPara,
				),
			),
		).toBe("-\n  > Quote\n\n  After");

		// Blockquote ending in HTML followed by another blockquote -> `\n\n` (never merge blockquotes!)
		expect(
			serializeVisualDocToMarkdown(
				buildForcedTightItem(
					visualEditorSchema.nodes.blockquote.create(null, [
						visualEditorSchema.nodes.protected_block.create({
							kind: "raw",
							rawMarkdown: "<section>",
						}),
					]),
					visualEditorSchema.nodes.blockquote.create(null, [
						visualEditorSchema.nodes.paragraph.create(null, [
							visualEditorSchema.text("b"),
						]),
					]),
				),
			),
		).toBe("-\n  > <section>\n\n  > b");

		// Blockquote ending in table -> `\n\n`
		const parsedTable = parseMarkdownToVisualDoc(
			"| A | B |\n| --- | --- |\n| 1 | 2 |",
		).firstChild;
		expect(parsedTable).not.toBeNull();
		if (parsedTable) {
			expect(
				serializeVisualDocToMarkdown(
					buildForcedTightItem(
						visualEditorSchema.nodes.blockquote.create(null, [parsedTable]),
						afterPara,
					),
				),
			).toContain("\n\n  After");
		}

		// Blockquote ending in list->paragraph -> `\n\n`
		const parsedList = parseMarkdownToVisualDoc("- item").firstChild;
		expect(parsedList).not.toBeNull();
		if (parsedList) {
			expect(
				serializeVisualDocToMarkdown(
					buildForcedTightItem(
						visualEditorSchema.nodes.blockquote.create(null, [parsedList]),
						afterPara,
					),
				),
			).toBe("-\n  > - item\n\n  After");
		}

		// Blockquote ending in refdef -> `\n\n` (PHP ParagraphParser stays open across refdefs)
		expect(
			serializeVisualDocToMarkdown(
				buildForcedTightItem(
					visualEditorSchema.nodes.blockquote.create(null, [
						visualEditorSchema.nodes.protected_block.create({
							kind: "raw",
							rawMarkdown: "[r]: /u",
						}),
					]),
					afterPara,
				),
			),
		).toBe("-\n  > [r]: /u\n\n  After");
	});
});

describe("PR-R24-A1 PHP-exact table math, nested/interleaved table-align, lazy table & quote boundaries, nested-quote fences, and O(N) DoS guards", () => {
	function findTextEndPos(doc: ProseMirrorNode, needle: string): number {
		let found = -1;
		doc.descendants((node, pos) => {
			if (found !== -1) return false;
			if (node.isText && node.text) {
				const idx = node.text.indexOf(needle);
				if (idx !== -1) {
					found = pos + idx + needle.length;
					return false;
				}
			}
			return true;
		});
		if (found === -1) {
			throw new Error(`Needle not found in visual doc: ${needle}`);
		}
		return found;
	}

	function insertTextAt(
		doc: ProseMirrorNode,
		pos: number,
		text: string,
	): ProseMirrorNode {
		const state = EditorState.create({ doc, schema: visualEditorSchema });
		return state.tr.insertText(text, pos).doc;
	}

	function collectProtectedInlines(doc: ProseMirrorNode): Array<{
		kind: string;
		rawMarkdown: string;
	}> {
		const entries: Array<{ kind: string; rawMarkdown: string }> = [];
		doc.descendants((node) => {
			if (node.type.name === "protected_inline") {
				entries.push({
					kind: String(node.attrs.kind ?? ""),
					rawMarkdown: String(node.attrs.rawMarkdown ?? ""),
				});
			}
			return true;
		});
		return entries;
	}

	it("matches PHP 4-pass math and inline code-span precedence inside GFM tables (Track A #1 + Track B #4)", () => {
		// 1. `$a` must NOT cross into inline code span `` `x$` ``.
		const codeDollarMd = "| A | B |\n| --- | --- |\n| $a | `x$` |";
		const codeDollarGuard = createMarkdownRoundTripGuard(codeDollarMd);
		expect(collectProtectedInlines(codeDollarGuard.initialDoc)).toEqual([]);
		const editedCodeDollar = insertTextAt(
			codeDollarGuard.initialDoc,
			findTextEndPos(codeDollarGuard.initialDoc, "A"),
			"Z",
		);
		const serializedCodeDollar = codeDollarGuard.serialize(editedCodeDollar);
		expect(serializedCodeDollar).toBe(
			"| AZ | B |\n| --- | --- |\n| \\$a | `x$` |",
		);
		expect(parseMarkdownToVisualDoc(serializedCodeDollar).eq(editedCodeDollar)).toBe(
			true,
		);

		// 2. `$10 | $20 | ![x](x)`: PHP extracts `$10 | $` first, preserving `![x](x)` in column 2.
		const currencyPipeMd = "| A | B |\n| --- | --- |\n| $10 | $20 | ![x](x) |";
		const currencyPipeGuard = createMarkdownRoundTripGuard(currencyPipeMd);
		expect(collectProtectedInlines(currencyPipeGuard.initialDoc)).toEqual([
			{ kind: "math-inline", rawMarkdown: "$10 | $" },
		]);
		const editedCurrencyPipe = insertTextAt(
			currencyPipeGuard.initialDoc,
			findTextEndPos(currencyPipeGuard.initialDoc, "A"),
			"Z",
		);
		const serializedCurrencyPipe =
			currencyPipeGuard.serialize(editedCurrencyPipe);
		expect(serializedCurrencyPipe).toBe(
			"| AZ | B |\n| --- | --- |\n| $10 | $20 | ![x](x) |",
		);
		expect(
			parseMarkdownToVisualDoc(serializedCurrencyPipe).eq(editedCurrencyPipe),
		).toBe(true);

		// 3. Multiline `\(...\)` inside table body rows (and header rows) stays 1 logical row with raw newline preserved.
		for (const [md, needle, expected] of [
			[
				"| A | B |\n| --- | --- |\n| \\(x\ny|z\\) | ![x](x) |",
				"A",
				"| AZ | B |\n| --- | --- |\n| \\(x\ny|z\\) | ![x](x) |",
			],
			[
				"| A | B |\n| --- | --- |\n| \\(a\nb\\) | ok |",
				"A",
				"| AZ | B |\n| --- | --- |\n| \\(a\nb\\) | ok |",
			],
			[
				"| A | B |\n| --- | --- |\n| \\(a\n\nb\\) | ok |",
				"A",
				"| AZ | B |\n| --- | --- |\n| \\(a\n\nb\\) | ok |",
			],
			[
				"| \\(a\nb\\) | c |\n| --- | --- |\n| 1 | 2 |",
				"c",
				"| \\(a\nb\\) | cZ |\n| --- | --- |\n| 1 | 2 |",
			],
		] as const) {
			const guard = createMarkdownRoundTripGuard(md);
			const table = guard.initialDoc.firstChild;
			expect(table?.type.name, md).toBe("table");
			expect(table?.childCount, md).toBe(2);
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, needle),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, md).toBe(expected);
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
		}

		// 4. Display math (`$$a|b$$`, `\[a|b\]`, multiline `$$\na|b\n$$`) breaks out of the table just like PHP `\n\n<token>\n\n`.
		for (const expr of ["$$a|b$$", "\\[a|b\\]", "$$\na|b\n$$"]) {
			const md = `| A | B |\n| --- | --- |\n| ${expr} | ![x](x) |\n\nFooter`;
			const guard = createMarkdownRoundTripGuard(md);
			expect(guard.initialDoc.childCount, expr).toBe(4);
			expect(guard.initialDoc.child(0).type.name, expr).toBe("table");
			expect(guard.initialDoc.child(1).type.name, expr).toBe("protected_block");
			expect(guard.initialDoc.child(1).attrs.kind, expr).toBe("math");
			expect(guard.initialDoc.child(1).attrs.rawMarkdown, expr).toBe(expr);
			expect(guard.initialDoc.child(2).type.name, expr).toBe("paragraph");
			expect(guard.initialDoc.child(3).textContent, expr).toBe("Footer");

			const editedHeader = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "A"),
				"Z",
			);
			const serializedHeader = guard.serialize(editedHeader);
			expect(serializedHeader, expr).toBe(
				`| AZ | B |\n| --- | --- |\n|  |  |\n\n${expr}\n\n| ![x](x) |\n\nFooter`,
			);
			expect(
				parseMarkdownToVisualDoc(serializedHeader).eq(editedHeader),
				expr,
			).toBe(true);

			// Editing an unrelated block below must not duplicate the display math or trailing text.
			const editedFooter = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "Footer"),
				"!",
			);
			const serializedFooter = guard.serialize(editedFooter);
			expect(serializedFooter, expr).toBe(
				`| A | B |\n| --- | --- |\n|  |  |\n\n${expr}\n\n| ![x](x) |\n\nFooter!`,
			);
		}

		// 5. Space-padded and digit-followed inline `$...$` in table headers stay valid 2-column tables.
		for (const headerExpr of ["$ a|b $", "$a|b $", "$a|b$2"]) {
			const md = `| ${headerExpr} | c |\n| --- | --- |\n| 1 | 2 |`;
			const guard = createMarkdownRoundTripGuard(md);
			expect(guard.initialDoc.firstChild?.type.name, headerExpr).toBe("table");
			expect(guard.initialDoc.firstChild?.child(0).childCount, headerExpr).toBe(
				2,
			);
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "c"),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, headerExpr).toBe(
				`| ${headerExpr} | cZ |\n| --- | --- |\n| 1 | 2 |`,
			);
			expect(
				parseMarkdownToVisualDoc(serialized).eq(edited),
				headerExpr,
			).toBe(true);
		}

		// 6. Unclosed `$$` falls through to PHP pass 4 (`$a|b$`), preserving column 2 (`c`).
		const unclosedDoubleMd = "| A | B |\n| --- | --- |\n| $$a|b$ | c |";
		const unclosedDoubleGuard = createMarkdownRoundTripGuard(unclosedDoubleMd);
		expect(collectProtectedInlines(unclosedDoubleGuard.initialDoc)).toEqual([
			{ kind: "math-inline", rawMarkdown: "$a|b$" },
		]);
		const editedUnclosedDouble = insertTextAt(
			unclosedDoubleGuard.initialDoc,
			findTextEndPos(unclosedDoubleGuard.initialDoc, "A"),
			"Z",
		);
		const serializedUnclosedDouble =
			unclosedDoubleGuard.serialize(editedUnclosedDouble);
		expect(serializedUnclosedDouble).toBe(
			"| AZ | B |\n| --- | --- |\n| \\$$a|b$ | c |",
		);
		expect(
			parseMarkdownToVisualDoc(serializedUnclosedDouble).eq(
				editedUnclosedDouble,
			),
		).toBe(true);
	});

	it("preserves table alignment annotations across lazy list continuations, list->quote, and nested lists (Track A #2 + Track B #6)", () => {
		// 1. Lazy continuation row `| x |` in a list table keeps `M` valid and centered after editing `A` -> `AZ`.
		const lazyListAlignMd =
			'- <!-- easymde-table-align:v1 [[1,"center"]] -->\n  | A |\n  | --- |\n| x |';
		const lazyGuard = createMarkdownRoundTripGuard(lazyListAlignMd);
		const lazyTable = lazyGuard.initialDoc.firstChild?.firstChild?.child(1);
		expect(lazyTable?.type.name).toBe("table");
		expect(lazyTable?.childCount).toBe(2);
		expect(lazyTable?.attrs.alignAnnotation).toBe(
			'<!-- easymde-table-align:v1 [[1,"center"]] -->',
		);
		expect(lazyTable?.child(1).child(0).attrs.textAlign).toBe("center");
		const editedLazy = insertTextAt(
			lazyGuard.initialDoc,
			findTextEndPos(lazyGuard.initialDoc, "A"),
			"Z",
		);
		const serializedLazy = lazyGuard.serialize(editedLazy);
		expect(serializedLazy).toBe(
			'- <!-- easymde-table-align:v1 [[1,"center"]] -->\n  | AZ |\n  | --- |\n  | x |',
		);
		expect(parseMarkdownToVisualDoc(serializedLazy).eq(editedLazy)).toBe(true);

		// 2. Interleaved `list -> quote` table alignment attaches directly to table without blank `  >` separator.
		const listQuoteAlignMd =
			'- > <!-- easymde-table-align:v1 [[1,"center"]] -->\n  > | A |\n  > | --- |\n  > | x |';
		const listQuoteGuard = createMarkdownRoundTripGuard(listQuoteAlignMd);
		const listQuoteBq =
			listQuoteGuard.initialDoc.firstChild?.firstChild?.child(1);
		expect(listQuoteBq?.type.name).toBe("blockquote");
		expect(listQuoteBq?.childCount).toBe(1);
		expect(listQuoteBq?.firstChild?.type.name).toBe("table");
		expect(listQuoteBq?.firstChild?.attrs.alignAnnotation).toBe(
			'<!-- easymde-table-align:v1 [[1,"center"]] -->',
		);
		const editedListQuote = insertTextAt(
			listQuoteGuard.initialDoc,
			findTextEndPos(listQuoteGuard.initialDoc, "A"),
			"Z",
		);
		const serializedListQuote = listQuoteGuard.serialize(editedListQuote);
		expect(serializedListQuote).toBe(
			'-\n  > <!-- easymde-table-align:v1 [[1,"center"]] -->\n  > | AZ |\n  > | --- |\n  > | x |',
		);
		expect(serializedListQuote).not.toContain("  >\n  > | AZ |");
		expect(
			parseMarkdownToVisualDoc(serializedListQuote).eq(editedListQuote),
		).toBe(true);

		// 3. Nested list (`- - M` and `10. 10. M`) attaches `M` as alignAnnotation (never an orphan protected_block)
		// and updating row alignment emits exactly one updated comment with zero duplicates.
		const nestedListAlignMd =
			'- - <!-- easymde-table-align:v1 [[0,"center"]] -->\n    | A | B |\n    | --- | --- |\n    | 1 | 2 |';
		const nestedGuard = createMarkdownRoundTripGuard(nestedListAlignMd);
		let nestedProtectedBlocks = 0;
		let nestedTablePos = -1;
		nestedGuard.initialDoc.descendants((node, pos) => {
			if (node.type.name === "protected_block") nestedProtectedBlocks += 1;
			if (node.type.name === "table") nestedTablePos = pos;
			return true;
		});
		expect(nestedProtectedBlocks).toBe(0);
		expect(nestedTablePos).toBeGreaterThanOrEqual(0);
		const editedNested = insertTextAt(
			nestedGuard.initialDoc,
			findTextEndPos(nestedGuard.initialDoc, "A"),
			"Z",
		);
		const serializedNested = nestedGuard.serialize(editedNested);
		expect(serializedNested).toBe(
			'-\n  - <!-- easymde-table-align:v1 [[0,"center"]] -->\n    | AZ | B |\n    | --- | --- |\n    | 1 | 2 |',
		);
		expect(parseMarkdownToVisualDoc(serializedNested).eq(editedNested)).toBe(
			true,
		);

		// Mutating row 0 cells from `center` to `right` must replace the single annotation (never stack 2 comments).
		const alignState = EditorState.create({
			doc: nestedGuard.initialDoc,
			schema: visualEditorSchema,
		});
		let alignTr = alignState.tr;
		nestedGuard.initialDoc.descendants((node, pos) => {
			if (node.type.name === "table_header") {
				alignTr = alignTr.setNodeMarkup(pos, undefined, {
					...node.attrs,
					textAlign: "right",
				});
			}
			return true;
		});
		const serializedRealigned = nestedGuard.serialize(alignTr.doc);
		expect(
			serializedRealigned.match(/<!-- easymde-table-align:v1/g)?.length,
		).toBe(1);
		expect(serializedRealigned).toContain(
			'<!-- easymde-table-align:v1 [[0,"right"]] -->',
		);

		// Wide nested ordered list (`10. 10. M`) also attaches cleanly without triggering indented code.
		const wideOrderedAlignMd =
			'10. 10. <!-- easymde-table-align:v1 [[0,"center"]] -->\n        | A | B |\n        | --- | --- |\n        | 1 | 2 |';
		const wideDoc = parseMarkdownToVisualDoc(wideOrderedAlignMd);
		let wideTableAlign: unknown = null;
		wideDoc.descendants((node) => {
			if (node.type.name === "table") {
				wideTableAlign = node.attrs.alignAnnotation;
			}
			return true;
		});
		expect(wideTableAlign).toBe('<!-- easymde-table-align:v1 [[0,"center"]] -->');
	});

	it("handles interleaved list->quote tables, lazy blockquote table rows, and blockquote boundary preservation (Track A #3 + Track B #10)", () => {
		// Track B #10: `- > | A | B |` detects the GFM table and parses `<br>` as `hard_break`.
		for (const md of [
			"- > | A | B |\n  > | --- | --- |\n  > | 1<br>2 | 3 |",
			"- item\n  > | A | B |\n  > | --- | --- |\n  > | 1<br>2 | 3 |",
		]) {
			const guard = createMarkdownRoundTripGuard(md);
			let hardBreaks = 0;
			guard.initialDoc.descendants((node) => {
				if (node.type.name === "hard_break") hardBreaks += 1;
				return true;
			});
			expect(hardBreaks, md).toBe(1);
			expect(collectProtectedInlines(guard.initialDoc), md).toEqual([]);
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "A"),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, md).toContain("1<br>2");
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
		}

		// Track A #3a: `> | A |\n> | --- |\n| x |` keeps lazy row `| x |` inside the blockquote table.
		const lazyBqMd = "> | A |\n> | --- |\n| x |";
		const lazyBqGuard = createMarkdownRoundTripGuard(lazyBqMd);
		expect(lazyBqGuard.initialDoc.childCount).toBe(1);
		expect(lazyBqGuard.initialDoc.firstChild?.type.name).toBe("blockquote");
		expect(lazyBqGuard.initialDoc.firstChild?.firstChild?.childCount).toBe(2);
		const editedLazyBq = insertTextAt(
			lazyBqGuard.initialDoc,
			findTextEndPos(lazyBqGuard.initialDoc, "A"),
			"Z",
		);
		const serializedLazyBq = lazyBqGuard.serialize(editedLazyBq);
		expect(serializedLazyBq).toBe("> | AZ |\n> | --- |\n> | x |");
		expect(parseMarkdownToVisualDoc(serializedLazyBq).eq(editedLazyBq)).toBe(
			true,
		);

		// Track A #3b: `- > A\n  >\nQ` preserves the outside paragraph `Q` after editing `A` -> `AZ`.
		const listQuoteBoundaryMd = "- > A\n  >\nQ";
		const boundaryGuard = createMarkdownRoundTripGuard(listQuoteBoundaryMd);
		expect(boundaryGuard.initialDoc.childCount).toBe(2);
		expect(boundaryGuard.initialDoc.child(1).textContent).toBe("Q");
		const editedBoundary = insertTextAt(
			boundaryGuard.initialDoc,
			findTextEndPos(boundaryGuard.initialDoc, "A"),
			"Z",
		);
		const serializedBoundary = boundaryGuard.serialize(editedBoundary);
		expect(serializedBoundary).toBe("-\n  > AZ\n\nQ");
		expect(
			parseMarkdownToVisualDoc(serializedBoundary).eq(editedBoundary),
		).toBe(true);
	});

	it("peels nested blockquotes inside lists in detectFence without swallowing closers or protecting code contents (Track B #3)", () => {
		const cases = [
			[
				"- > hello\n  > > ```js\n  > > $$x$$\n  > > <div>raw</div>\n  > > ```",
				"hello",
				"-\n  > helloZ\n  >\n  > > ```js\n  > > $$x$$\n  > > <div>raw</div>\n  > > ```",
			],
			[
				"  - item\n    > ```js\n    > $$x$$\n    > <div>raw</div>\n    > ```",
				"item",
				"- itemZ\n  > ```js\n  > $$x$$\n  > <div>raw</div>\n  > ```",
			],
		] as const;

		for (const [md, needle, expected] of cases) {
			const guard = createMarkdownRoundTripGuard(md);
			let protectedBlocks = 0;
			const codeContents: string[] = [];
			guard.initialDoc.descendants((node) => {
				if (node.type.name === "protected_block") protectedBlocks += 1;
				if (node.type.name === "code_block") codeContents.push(node.textContent);
				return true;
			});
			expect(protectedBlocks, md).toBe(0);
			expect(codeContents, md).toEqual(["$$x$$\n<div>raw</div>"]);
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, needle),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, md).toBe(expected);
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
		}

		// Mermaid fence inside a nested blockquote in a list still maps cleanly to a protected mermaid block.
		const mermaidInListBq =
			"  - item\n    > ```mermaid\n    > graph TD\n    > A-->B\n    > ```";
		const mermaidDoc = parseMarkdownToVisualDoc(mermaidInListBq);
		let mermaidKind = "";
		mermaidDoc.descendants((node) => {
			if (node.type.name === "protected_block") {
				mermaidKind = String(node.attrs.kind ?? "");
			}
			return true;
		});
		expect(mermaidKind).toBe("mermaid");
	});

	it("prescans adversarial unclosed math and link-paren inputs in linear time (Track B #5)", () => {
		const adversarialInputs: ReadonlyArray<readonly [string, string]> = [
			["unclosed_block_bracket_10k", "\\[\n".repeat(10_000)],
			["unclosed_inline_paren_25k", "\\(".repeat(25_000)],
			["unclosed_inline_bracket_25k", "\\[".repeat(25_000)],
			["unclosed_link_paren_20k", "](".repeat(20_000)],
			["unclosed_link_paren_20k_trailing_close", `${"](".repeat(20_000)})`],
		];

		for (const [label, input] of adversarialInputs) {
			const started = performance.now();
			const result = prescanMarkdown(input);
			const elapsedMs = performance.now() - started;
			expect(result.markdown.length, label).toBeGreaterThan(0);
			expect(elapsedMs, `${label} took ${elapsedMs.toFixed(1)}ms`).toBeLessThan(
				250,
			);
		}
	});

	it("preserves synthetic post-display-math table-break lines without truncating block.raw on unrelated edits (PR-R25-A #1)", () => {
		const cases = [
			{
				append: "Z",
				expected: "| AZ |\n| --- |\n|  |\n\n$$x$$\n\n| y |\n| z |",
				md: "| A |\n| --- |\n| $$x$$ | y |\n| z |",
				needle: "A",
			},
			{
				append: "Z",
				expected: "| AZ |\n| --- |\n|  |\n\n\\[x\\]\n\n| y |\n| z |",
				md: "| A |\n| --- |\n| \\[x\\] | y |\n| z |",
				needle: "A",
			},
			{
				append: "2",
				expected: "| A2 | B |\n| --- | --- |\n| 1 |  |\n\n$$x$$\n\ntail\nAfter",
				md: "| A | B |\n| --- | --- |\n| 1 | $$x$$ tail\nAfter",
				needle: "A",
			},
			{
				append: "Z",
				expected:
					"| AZ | B |\n| --- | --- |\n| 1 |  |\n\n$$x$$\n\n| C | D |\n| --- | --- |\n| 2 | 3 |",
				md: "| A | B |\n| --- | --- |\n| 1 | $$x$$ | C | D |\n| --- | --- |\n| 2 | 3 |",
				needle: "A",
			},
		] as const;

		for (const testCase of cases) {
			const parsed = parseMarkdownWithBlockSources(testCase.md);
			expect(parsed.blocks.length, testCase.md).toBe(3);
			// Merged synthetic+real trailing block must never keep a truncated raw slice.
			expect(parsed.blocks[2]?.raw, testCase.md).toBeNull();
			const guard = createMarkdownRoundTripGuard(testCase.md, parsed);
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, testCase.needle),
				testCase.append,
			);
			const serialized = guard.serialize(edited);
			expect(serialized, testCase.md).toBe(testCase.expected);
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), testCase.md).toBe(
				true,
			);
		}
	});

	it("shifts relative inline-math offsets by virtualSpaces on tab-indented lazy table rows and display-math breaks (PR-R25-A #2)", () => {
		const lazyTabRow = ">  - | A | B |\n>    | --- | --- |\n>\t| $a|b$ | 2 |";
		const preScanRow = prescanMarkdown(lazyTabRow);
		expect(preScanRow.protectedInlines.get("EASYMDEPHINL0END")).toEqual({
			kind: "math-inline",
			rawMarkdown: "$a|b$",
		});
		const rowGuard = createMarkdownRoundTripGuard(lazyTabRow);
		const editedRow = insertTextAt(
			rowGuard.initialDoc,
			findTextEndPos(rowGuard.initialDoc, "A"),
			"Z",
		);
		const serializedRow = rowGuard.serialize(editedRow);
		expect(serializedRow).toBe(
			"> - | AZ | B |\n>   | --- | --- |\n>   | $a|b$ | 2 |",
		);
		expect(parseMarkdownToVisualDoc(serializedRow).eq(editedRow)).toBe(true);

		const lazyTabDisplayBreak =
			">  - | A | B |\n>    | --- | --- |\n>\t| $a|b$ | $$x$$";
		const preScanBreak = prescanMarkdown(lazyTabDisplayBreak);
		expect(preScanBreak.protectedInlines.get("EASYMDEPHINL0END")).toEqual({
			kind: "math-inline",
			rawMarkdown: "$a|b$",
		});
		const breakGuard = createMarkdownRoundTripGuard(lazyTabDisplayBreak);
		const editedBreak = insertTextAt(
			breakGuard.initialDoc,
			findTextEndPos(breakGuard.initialDoc, "A"),
			"Z",
		);
		const serializedBreak = breakGuard.serialize(editedBreak);
		expect(serializedBreak).toBe(
			"> - | AZ | B |\n>   | --- | --- |\n>   | $a|b$ |  |\n\n$$x$$",
		);
		expect(parseMarkdownToVisualDoc(serializedBreak).eq(editedBreak)).toBe(
			true,
		);

		// Ordered-list tab partial consumption (`1. ` eats 3 columns of `\t`, leaving 1 virtual space).
		const orderedTabLazy =
			"1. - | A | B |\n     | --- | --- |\n\t| $a|b$ | 2 |";
		expect(
			prescanMarkdown(orderedTabLazy).protectedInlines.get("EASYMDEPHINL0END"),
		).toEqual({
			kind: "math-inline",
			rawMarkdown: "$a|b$",
		});
	});

	it("never injects blockquote or list prefixes into internal newlines of multiline inline math (PR-R25-A #3)", () => {
		const cases = [
			[
				"> | A |\n> | --- |\n> | \\(a\nb\\) |",
				"> | AZ |\n> | --- |\n> | \\(a\nb\\) |",
			],
			[
				"- | A |\n  | --- |\n  | \\(a\n  b\\) |",
				"- | AZ |\n  | --- |\n  | \\(a\n  b\\) |",
			],
			[
				"- > | A |\n  > | --- |\n  > | \\(a\nb\\) |",
				"-\n  > | AZ |\n  > | --- |\n  > | \\(a\nb\\) |",
			],
			[
				"> | A | B |\n> | --- | --- |\n> | \\(a\nb\\) | \\(c\nd\\) |",
				"> | AZ | B |\n> | --- | --- |\n> | \\(a\nb\\) | \\(c\nd\\) |",
			],
			[
				"- | A |\n  | --- |\n  | \\(a\n  b\\) |\n- untouched",
				"- | AZ |\n  | --- |\n  | \\(a\n  b\\) |\n- untouched",
			],
			[
				"> - | A |\n>   | --- |\n>   | \\(a\nb\\) |",
				"> - | AZ |\n>   | --- |\n>   | \\(a\nb\\) |",
			],
		] as const;

		for (const [md, expected] of cases) {
			const guard = createMarkdownRoundTripGuard(md);
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "A"),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, md).toBe(expected);
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
		}
	});

	it("prescans adversarial repeated display-math table breaks and unmatched paired inline HTML in linear time (PR-R25-A #4)", () => {
		// Warm up JIT once with a tiny representative input.
		prescanMarkdown("| A |\n| --- |\n| $$x$$ |\n<span></span>");

		const adversarialInputs: ReadonlyArray<readonly [string, string]> = [
			["table_break_8k_display_math", `| A |\n| --- |\n| ${"$$x$$ ".repeat(8_000)}|`],
			["table_break_4k_adjacent_math", `| A | B |\n| --- | --- |\n| 1 | ${"$$x$$".repeat(4_000)}`],
			["unclosed_4k_spans_trailing_close", `${"<span>".repeat(4_000)}</span>`],
		];

		for (const [label, input] of adversarialInputs) {
			const started = performance.now();
			const result = prescanMarkdown(input);
			const elapsedMs = performance.now() - started;
			expect(result.markdown.length, label).toBeGreaterThan(0);
			expect(elapsedMs, `${label} took ${elapsedMs.toFixed(1)}ms`).toBeLessThan(
				100,
			);
		}

		// Verify exact stack-matching semantics on the last balanced pair.
		const smallSpanResult = prescanMarkdown("<span><span></span><span>");
		const inlineRaws = [...smallSpanResult.protectedInlines.values()].map(
			(entry) => entry.rawMarkdown,
		);
		expect(inlineRaws).toEqual(["<span>", "<span></span>", "<span>"]);
	});

	it("splits display math on table header lines like PHP extract_math without degrading to math-inline (PR-R25-A #6)", () => {
		// 1. Display math before table header splits into math block + 2-column table.
		const leadingHeaderCases = [
			[
				"$$x$$ | A | B |\n| --- | --- |\n| 1 | 2 |",
				"$$x$$",
				"$$x$$\n\n| AZ | B |\n| --- | --- |\n| 1 | 2 |",
			],
			[
				"\\[x\\] | A | B |\n| --- | --- |\n| 1 | 2 |",
				"\\[x\\]",
				"\\[x\\]\n\n| AZ | B |\n| --- | --- |\n| 1 | 2 |",
			],
			[
				"$$\nx\n$$ | A | B |\n| --- | --- |\n| 1 | 2 |",
				"$$\nx\n$$",
				"$$\nx\n$$\n\n| AZ | B |\n| --- | --- |\n| 1 | 2 |",
			],
		] as const;

		for (const [md, mathRaw, expected] of leadingHeaderCases) {
			const parsed = parseMarkdownWithBlockSources(md);
			expect(parsed.blocks.map((b) => b.node.type.name), md).toEqual([
				"protected_block",
				"table",
			]);
			expect(parsed.blocks[0]?.node.attrs.kind, md).toBe("math");
			expect(parsed.blocks[0]?.node.attrs.rawMarkdown, md).toBe(mathRaw);
			expect(parsed.blocks[1]?.node.childCount, md).toBe(2);
			expect(parsed.blocks[1]?.node.child(0).childCount, md).toBe(2);
			expect(parsed.blocks[1]?.raw, md).toBeNull();
			const guard = createMarkdownRoundTripGuard(md, parsed);
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "A"),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, md).toBe(expected);
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
		}

		// 2. Display math inside table header line splits into paragraph + math block + trailing block (NOT a 2-col table with math-inline).
		const midHeaderMd = "| A | $$x$$ |\n| --- | --- |\n| 1 | 2 |";
		const midParsed = parseMarkdownWithBlockSources(midHeaderMd);
		expect(midParsed.blocks.map((b) => b.node.type.name)).toEqual([
			"paragraph",
			"protected_block",
			"paragraph",
		]);
		expect(midParsed.blocks[0]?.node.textContent).toBe("| A |");
		expect(midParsed.blocks[1]?.node.attrs.kind).toBe("math");
		expect(midParsed.blocks[1]?.node.attrs.rawMarkdown).toBe("$$x$$");
		expect(collectProtectedInlines(midParsed.doc)).toEqual([]);
		const midGuard = createMarkdownRoundTripGuard(midHeaderMd, midParsed);
		const editedMid = insertTextAt(
			midGuard.initialDoc,
			findTextEndPos(midGuard.initialDoc, "A"),
			"Z",
		);
		const serializedMid = midGuard.serialize(editedMid);
		expect(serializedMid).toBe("| AZ |\n\n$$x$$\n\n|\n| --- | --- |\n| 1 | 2 |");
		expect(parseMarkdownToVisualDoc(serializedMid).eq(editedMid)).toBe(true);
	});

	it("preserves multiline \\(...\\) in regular paragraphs and inside raw-inline atoms across blockquote/list edits (PR-R26-A #1)", () => {
		const cases = [
			["> A \\(x\ny\\)", "> AZ \\(x\ny\\)", "math-inline", "\\(x\ny\\)"],
			[
				"> | A |\n> | --- |\n> | <span>\\(x\ny\\)</span> |",
				"> | AZ |\n> | --- |\n> | <span>\\(x\ny\\)</span> |",
				"raw-inline",
				"<span>\\(x\ny\\)</span>",
			],
			["- A \\(x\n  y\\)", "- AZ \\(x\n  y\\)", "math-inline", "\\(x\n  y\\)"],
			[
				"- | A |\n  | --- |\n  | <span>\\(x\n  y\\)</span> |",
				"- | AZ |\n  | --- |\n  | <span>\\(x\n  y\\)</span> |",
				"raw-inline",
				"<span>\\(x\n  y\\)</span>",
			],
			[
				"> A <span>\\(x\ny\\)</span>",
				"> AZ <span>\\(x\ny\\)</span>",
				"raw-inline",
				"<span>\\(x\ny\\)</span>",
			],
			[
				"- A <span>\\(x\n  y\\)</span>",
				"- AZ <span>\\(x\n  y\\)</span>",
				"raw-inline",
				"<span>\\(x\n  y\\)</span>",
			],
			["> A \\(x\n\ny\\)", "> AZ \\(x\n\ny\\)", "math-inline", "\\(x\n\ny\\)"],
		] as const;

		for (const [md, expected, kind, rawMarkdown] of cases) {
			const guard = createMarkdownRoundTripGuard(md);
			expect(collectProtectedInlines(guard.initialDoc), md).toEqual([
				{ kind, rawMarkdown },
			]);
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "A"),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, md).toBe(expected);
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
		}

		// Multiline `\(...\)` sharing a logical line with single-line `$$z$$` keeps both protected.
		const mixedMd = "A \\(x\ny\\) $$z$$";
		const mixedGuard = createMarkdownRoundTripGuard(mixedMd);
		expect(collectProtectedInlines(mixedGuard.initialDoc)).toEqual([
			{ kind: "math-inline", rawMarkdown: "\\(x\ny\\)" },
			{ kind: "math-inline", rawMarkdown: "$$z$$" },
		]);
		const editedMixed = insertTextAt(
			mixedGuard.initialDoc,
			findTextEndPos(mixedGuard.initialDoc, "A"),
			"Z",
		);
		expect(mixedGuard.serialize(editedMixed)).toBe("AZ \\(x\ny\\) $$z$$");
	});

	it("rejects non-paragraph GFM table headers, handles post-math HTML blocks and second tables, and scales O(N) on display-math gaps (PR-R26-A #2)", () => {
		// 1. Post-math HTML block consumes continuation lines (no exposed `> | --- |` blockquote).
		const postMathHtmlMd = "> A $$x$$ <div>\n> | --- |";
		const postMathHtmlParsed = parseMarkdownWithBlockSources(postMathHtmlMd);
		expect(postMathHtmlParsed.blocks.map((b) => b.node.type.name)).toEqual([
			"blockquote",
			"protected_block",
			"protected_block",
		]);
		expect(postMathHtmlParsed.blocks[1]?.node.attrs).toEqual({
			kind: "math",
			rawMarkdown: "$$x$$",
		});
		expect(postMathHtmlParsed.blocks[2]?.node.attrs).toEqual({
			kind: "raw",
			rawMarkdown: "<div>\n> | --- |",
		});
		const postMathHtmlGuard = createMarkdownRoundTripGuard(
			postMathHtmlMd,
			postMathHtmlParsed,
		);
		const editedPostMathHtml = insertTextAt(
			postMathHtmlGuard.initialDoc,
			findTextEndPos(postMathHtmlGuard.initialDoc, "A"),
			"Z",
		);
		const serializedPostMathHtml =
			postMathHtmlGuard.serialize(editedPostMathHtml);
		expect(serializedPostMathHtml).toBe("> AZ\n\n$$x$$\n\n<div>\n> | --- |");
		expect(
			parseMarkdownToVisualDoc(serializedPostMathHtml).eq(editedPostMathHtml),
		).toBe(true);

		// 2. ATX heading followed by `--- | ---` is heading + paragraph, NOT a table.
		const atxMd = "# a | b <br> c\n--- | ---\n1 | 2 <br> 3";
		const atxParsed = parseMarkdownWithBlockSources(atxMd);
		expect(atxParsed.blocks.map((b) => b.node.type.name)).toEqual([
			"heading",
			"paragraph",
		]);
		expect(collectProtectedInlines(atxParsed.doc)).toEqual([
			{ kind: "raw-inline", rawMarkdown: "<br>" },
			{ kind: "raw-inline", rawMarkdown: "<br>" },
		]);

		// 3. HTML blocks (`<div>`, `<!--`) followed by `--- | ---` stay HTML blocks, NOT tables.
		for (const htmlMd of [
			"<div> a | b\n--- | ---\n1 | 2",
			"<!-- a | b\n--- | ---\n-->",
		]) {
			const htmlParsed = parseMarkdownWithBlockSources(htmlMd);
			expect(htmlParsed.blocks.map((b) => b.node.type.name), htmlMd).toEqual([
				"protected_block",
			]);
			expect(htmlParsed.blocks[0]?.node.attrs, htmlMd).toEqual({
				kind: "raw",
				rawMarkdown: htmlMd,
			});
		}

		// 4. Display math followed by fenced code opening is display math + code block, NOT a table.
		const postMathFenceMd = "$$x$$ ``` a | b\n--- | ---\n1 | 2\n```";
		const postMathFenceParsed = parseMarkdownWithBlockSources(postMathFenceMd);
		expect(postMathFenceParsed.blocks.map((b) => b.node.type.name)).toEqual([
			"protected_block",
			"code_block",
		]);
		expect(postMathFenceParsed.blocks[0]?.node.attrs).toEqual({
			kind: "math",
			rawMarkdown: "$$x$$",
		});
		expect(postMathFenceParsed.blocks[1]?.node.attrs.language).toBe("a");
		expect(postMathFenceParsed.blocks[1]?.node.textContent).toBe(
			"--- | ---\n1 | 2",
		);

		// 5. Unclosed Type 1-5 HTML block (`<!--`) before display math swallows math + `--> a | b` (NOT split).
		const commentSwallowMd = "<!-- $$x$$ --> a | b\n--- | ---\n1 | 2";
		const commentSwallowParsed =
			parseMarkdownWithBlockSources(commentSwallowMd);
		expect(commentSwallowParsed.blocks.map((b) => b.node.type.name)).toEqual([
			"protected_block",
			"paragraph",
		]);
		expect(commentSwallowParsed.blocks[0]?.node.attrs).toEqual({
			kind: "raw",
			rawMarkdown: "<!-- $$x$$ --> a | b",
		});
		expect(commentSwallowParsed.blocks[1]?.node.textContent).toBe(
			"--- | ---\n1 | 2",
		);

		// 6. Second GFM table immediately after display-math table break keeps `<br>` hard_break and `$x|y$`.
		const secondTableMd =
			"a | b\n--- | ---\n1 | 2 $$z$$ c <br> d | $x|y$\n--- | ---\n3 | 4 <br> 5";
		const secondTableParsed = parseMarkdownWithBlockSources(secondTableMd);
		expect(secondTableParsed.blocks.map((b) => b.node.type.name)).toEqual([
			"table",
			"protected_block",
			"table",
		]);
		const secondTable = secondTableParsed.blocks[2]?.node;
		expect(secondTable?.childCount).toBe(2);
		const secondHeaderCell0 = secondTable?.child(0).child(0).child(0);
		expect(secondHeaderCell0?.childCount).toBe(3);
		expect(secondHeaderCell0?.child(1).type.name).toBe("hard_break");
		const secondHeaderCell1 = secondTable?.child(0).child(1).child(0);
		expect(secondHeaderCell1?.child(0).type.name).toBe("protected_inline");
		expect(secondHeaderCell1?.child(0).attrs).toMatchObject({
			kind: "math-inline",
			rawMarkdown: "$x|y$",
		});
		const secondBodyCell1 = secondTable?.child(1).child(1).child(0);
		expect(secondBodyCell1?.child(1).type.name).toBe("hard_break");
		const secondTableGuard = createMarkdownRoundTripGuard(
			secondTableMd,
			secondTableParsed,
		);
		const editedSecondTable = insertTextAt(
			secondTableGuard.initialDoc,
			findTextEndPos(secondTableGuard.initialDoc, "c"),
			"Z",
		);
		const serializedSecondTable =
			secondTableGuard.serialize(editedSecondTable);
		expect(serializedSecondTable).toBe(
			"| a | b |\n| --- | --- |\n| 1 | 2 |\n\n$$z$$\n\n| cZ <br> d | $x|y$ |\n| --- | --- |\n| 3 | 4 <br> 5 |",
		);
		expect(
			parseMarkdownToVisualDoc(serializedSecondTable).eq(editedSecondTable),
		).toBe(true);

		// 7. Second GFM table after display-math break joins multiline `\(...\)` body row cleanly.
		const secondMultilineMd =
			"a | b\n--- | ---\n1 | 2 $$z$$ c | d\n--- | ---\n\\(x\ny\\) | 4";
		const secondMultilineParsed =
			parseMarkdownWithBlockSources(secondMultilineMd);
		expect(secondMultilineParsed.blocks.map((b) => b.node.type.name)).toEqual([
			"table",
			"protected_block",
			"table",
		]);
		const secondMultilineTable = secondMultilineParsed.blocks[2]?.node;
		expect(secondMultilineTable?.childCount).toBe(2);
		expect(
			secondMultilineTable?.child(1).child(0).child(0).child(0).attrs,
		).toMatchObject({
			kind: "math-inline",
			rawMarkdown: "\\(x\ny\\)",
		});
		expect(secondMultilineTable?.child(1).child(1).textContent).toBe("4");

		// 8. Strictly O(N) scaling across 8k / 16k / 32k non-empty display-math gaps (zero per-gap binary searches).
		prescanMarkdown(`| A |\n| --- |\n${"$$x$$ | ".repeat(500)}`);
		const input32k = `| A |\n| --- |\n${"$$x$$ | ".repeat(32_000)}`;
		const started32k = performance.now();
		const res32k = prescanMarkdown(input32k);
		const elapsed32k = performance.now() - started32k;
		expect(res32k.outputLines.length).toBeGreaterThan(64_000);
		expect(elapsed32k, `32k display-math gaps took ${elapsed32k.toFixed(1)}ms`).toBeLessThan(250);
	});

	it("parses list-nested GFM tables without leading pipes inside lists and blockquotes instead of stealing them at top level (PR-R26-A #3)", () => {
		const cases = [
			[
				"- a | b\n  --- | ---\n  1 | 2",
				"bullet_list",
				"- | aZ | b |\n  | --- | --- |\n  | 1 | 2 |",
			],
			[
				"1. a | b\n   --- | ---\n   1 | 2",
				"ordered_list",
				"1. | aZ | b |\n   | --- | --- |\n   | 1 | 2 |",
			],
			[
				"> - a | b\n>   --- | ---\n>   1 | 2",
				"blockquote",
				"> - | aZ | b |\n>   | --- | --- |\n>   | 1 | 2 |",
			],
			[
				"- a | b\n  --- | ---\n\t$x|y$ | 2",
				"bullet_list",
				"- | aZ | b |\n  | --- | --- |\n  | $x|y$ | 2 |",
			],
		] as const;

		for (const [md, topBlockName, expectedEdited] of cases) {
			const guard = createMarkdownRoundTripGuard(md);
			expect(guard.initialDoc.childCount, md).toBe(1);
			expect(guard.initialDoc.firstChild?.type.name, md).toBe(topBlockName);
			let foundTable = false;
			let foundCodeBlock = false;
			guard.initialDoc.descendants((node) => {
				if (node.type.name === "table") foundTable = true;
				if (node.type.name === "code_block") foundCodeBlock = true;
				return true;
			});
			expect(foundTable, md).toBe(true);
			expect(foundCodeBlock, md).toBe(false);
			expect(guard.serialize(guard.initialDoc), md).toBe(md);

			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "a"),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, md).toBe(expectedEdited);
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
		}
	});

	it("applies PHP single-backslash pipe rule to table inline HTML barriers without escaping on edit (PR-R26-A #4)", () => {
		const cases = [
			[
				'| h1 | h2 |\n| - | - |\n| <span title="a\\\\|b">x</span> | c |',
				'| h1Z | h2 |\n| --- | --- |\n| <span title="a\\\\|b">x</span> | c |',
				'<span title="a\\\\|b">x</span>',
			],
			[
				'| h1 | h2 |\n| - | - |\n| <div title="a\\\\|b">x | c |',
				'| h1Z | h2 |\n| --- | --- |\n| <div title="a\\\\|b">x | c |',
				'<div title="a\\\\|b">',
			],
		] as const;

		for (const [md, expectedEdited, rawHtml] of cases) {
			const guard = createMarkdownRoundTripGuard(md);
			expect(collectProtectedInlines(guard.initialDoc), md).toEqual([
				{ kind: "raw-inline", rawMarkdown: rawHtml },
			]);
			const edited = insertTextAt(
				guard.initialDoc,
				findTextEndPos(guard.initialDoc, "h1"),
				"Z",
			);
			const serialized = guard.serialize(edited);
			expect(serialized, md).toBe(expectedEdited);
			expect(serialized, md).not.toContain("\\<");
			expect(parseMarkdownToVisualDoc(serialized).eq(edited), md).toBe(true);
		}
	});
});
