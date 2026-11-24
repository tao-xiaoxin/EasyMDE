import { describe, expect, it } from "vitest";
import {
	MAX_MARKDOWN_PREVIEW_BYTES,
	utf8ByteLength,
} from "../../shared/utf8-byte-length";
import {
	findEditorCodeContentTarget,
} from "./editor-code-content-target";
import {
	captureEditorContext,
	deleteThematicBreak,
	findMarkdownBlock,
	insertMarkdownBlockRelative,
	insertParagraphRelative,
	isEditorContextCurrent,
	markdownHeadingLevel,
} from "./editor-context-menu-rules";
import {
	createTextEdit,
	editorContextSelectionFitsRange,
} from "./editor-context-menu-text-edit";
import {
	createEditorMarkdownBlockIndex as createProfiledMarkdownBlockIndex,
} from "./editor-markdown-block-index";
import {
	findMarkdownTable,
	lineInterruptsCommonMarkTable,
	pipePositions,
	prepareMarkdownTable,
	tableSelectionAt,
} from "./editor-markdown-table";
import {
	formatMarkdownTableSource,
} from "./editor-markdown-table-format";
import {
	editMarkdownTable,
	setMarkdownTableAlignment,
} from "./editor-markdown-table-mutation";

describe("editor context menu rules", () => {
	it("rejects a stale block index for a changed same-length source", () => {
		const source = "# H\nbody";
		const changed = "# X\nbody";
		const index = createEditorMarkdownBlockIndex(source);

		expect(() =>
			findMarkdownBlock(changed, changed.indexOf("X"), index),
		).toThrowError("editor-context-menu-block-index-source-mismatch");
	});

	it("propagates one supplied block index through table selection, edit, and alignment", () => {
		const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
		const position = source.indexOf("1");
		const index = createEditorMarkdownBlockIndex(source);
		const selection = {
			direction: "none" as const,
			end: position,
			start: position,
		};

		expect(tableSelectionAt(source, selection, index)?.kind).toBe("column");
		expect(
			editMarkdownTable(source, position, { type: "copy-table" }, index)
				?.copiedText,
		).toBe(source);
		expect(
			setMarkdownTableAlignment(
				source,
				position,
				{ alignment: "center", selection: { column: 0, kind: "column" } },
				selection,
				index,
			),
		).toMatchObject({ value: "| A | B |\n| :---: | --- |\n| 1 | 2 |" });
	});

	it("keeps a prepared-index lookup bounded after delimiter-looking table rows", () => {
		const source = `${("| --- |\n").repeat(12000)}ordinary ending`;
		const blockIndex = createEditorMarkdownBlockIndex(source);
		const position = source.indexOf("ordinary ending");
		const startedAt = performance.now();
		const block = findMarkdownBlock(source, position, blockIndex);

		expect(performance.now() - startedAt).toBeLessThan(400);
		expect(block?.kind).toBe("table");
	}, 1000);

	it("returns an editable paragraph for an empty document and whitespace-only line", () => {
		expect(
			findMarkdownBlock("", 0, createEditorMarkdownBlockIndex("")),
		).toEqual({
			end: 0,
			kind: "paragraph",
			lineEnd: 0,
			lineStart: 0,
			start: 0,
		});
		expect(
			insertParagraphRelative(
				"",
				{
					direction: "none",
					end: 0,
					start: 0,
				},
				"before",
				createEditorMarkdownBlockIndex(""),
			)?.value,
		).toBe("\n");
		expect(
			insertParagraphRelative(
				"",
				{
					direction: "none",
					end: 0,
					start: 0,
				},
				"after",
				createEditorMarkdownBlockIndex(""),
			)?.value,
		).toBe("\n");

		const whitespace = "  \t";
		expect(
			findMarkdownBlock(
				whitespace,
				whitespace.length,
				createEditorMarkdownBlockIndex(whitespace),
			),
		).toEqual({
			end: whitespace.length,
			kind: "paragraph",
			lineEnd: 0,
			lineStart: 0,
			start: 0,
		});
	});

	it("returns a zero-width paragraph in a blank gap and after a trailing newline", () => {
		const gap = "# H\n\nbody";
		const gapIndex = createEditorMarkdownBlockIndex(gap);
		expect(findMarkdownBlock(gap, 4, gapIndex)).toEqual({
			end: 4,
			kind: "paragraph",
			lineEnd: 1,
			lineStart: 1,
			start: 4,
		});
		expect(
			insertParagraphRelative(
				gap,
				{
					direction: "none",
					end: 4,
					start: 4,
				},
				"after",
				gapIndex,
			)?.value,
		).toBe("# H\n\n\nbody");

		for (const newline of ["\n", "\r\n", "\r"]) {
			const whitespaceLine = `  ${newline}body`;
			const index = createEditorMarkdownBlockIndex(whitespaceLine);
			expect(findMarkdownBlock(whitespaceLine, 1, index)?.kind).toBe(
				"paragraph",
			);
			expect(
				insertParagraphRelative(
					whitespaceLine,
					{
						direction: "none",
						end: 1,
						start: 1,
					},
					"after",
					index,
				)?.value,
			).toBe(`  ${newline}${newline}body`);
		}

		for (const newline of ["\n", "\r\n", "\r"]) {
			const trailing = `body${newline}`;
			const index = createEditorMarkdownBlockIndex(trailing);
			if ("\r\n" === newline) {
				expect(
					findMarkdownBlock(trailing, trailing.length - 1, index)?.kind,
				).toBe("paragraph");
			}
			expect(findMarkdownBlock(trailing, trailing.length, index)).toEqual({
				end: trailing.length,
				kind: "paragraph",
				lineEnd: 1,
				lineStart: 1,
				start: trailing.length,
			});
			expect(
				insertParagraphRelative(
					trailing,
					{
						direction: "none",
						end: trailing.length,
						start: trailing.length,
					},
					"after",
					index,
				)?.value,
			).toBe(`body${newline}${newline}`);
		}
	});

	it.each(["\n", "\r\n", "\r"])(
		"keeps relative block insertions separated with the source newline %j",
		(newline) => {
			const source = [
				"before",
				"```python",
				"print('hello')",
				"```",
				"after",
			].join(newline);
			const block = findMarkdownBlock(
				source,
				source.indexOf("print"),
				createEditorMarkdownBlockIndex(source),
			);
			expect(block?.kind).toBe("code");
			if (!block) return;

			const imageAbove = insertMarkdownBlockRelative(
				source,
				block,
				"above",
				"![above](above.png)",
			);
			const tableBelow = insertMarkdownBlockRelative(
				source,
				block,
				"below",
				"| A |\n| --- |\n| B |",
			);

			expect(imageAbove.value).toBe(
				[
					"before",
					"![above](above.png)",
					"",
					"```python",
					"print('hello')",
					"```",
					"after",
				].join(newline),
			);
			expect(tableBelow.value).toBe(
				[
					"before",
					"```python",
					"print('hello')",
					"```",
					"",
					"| A |",
					"| --- |",
					"| B |",
					"",
					"after",
				].join(newline),
			);
		},
	);

	it("does not merge a table inserted beside an existing table", () => {
		const source = "| A |\n| --- |\n| 1 |\n\nnext";
		const block = findMarkdownBlock(
			source,
			source.indexOf("1"),
			createEditorMarkdownBlockIndex(source),
		);
		expect(block?.kind).toBe("table");
		if (!block) return;

		const inserted = insertMarkdownBlockRelative(
			source,
			block,
			"below",
			"| B |\n| --- |\n| 2 |",
		);
		expect(inserted.value).toBe(
			"| A |\n| --- |\n| 1 |\n\n| B |\n| --- |\n| 2 |\n\nnext",
		);
	});

	it("preserves a block insertion at the document boundaries", () => {
		const source = "body";
		const block = findMarkdownBlock(
			source,
			0,
			createEditorMarkdownBlockIndex(source),
		);
		expect(block).not.toBeNull();
		if (!block) return;

		expect(
			insertMarkdownBlockRelative(source, block, "above", "# heading").value,
		).toBe("# heading\n\nbody");
		expect(
			insertMarkdownBlockRelative(source, block, "below", "# heading").value,
		).toBe("body\n\n# heading\n\n");
	});

	it("captures direction and rejects a changed document or range", () => {
		const captured = captureEditorContext({
			direction: "rtl",
			position: { x: 40, y: 80 },
			selection: { direction: "backward", end: 8, start: 2 },
			surface: "source",
			value: "alpha beta",
		});

		expect(captured.selection).toEqual({
			direction: "backward",
			end: 8,
			start: 2,
		});
		expect(captured.direction).toBe("rtl");
		expect(
			isEditorContextCurrent(captured, {
				selection: captured.selection,
				surface: "source",
				value: "alpha beta",
			}),
		).toBe(true);
		expect(
			isEditorContextCurrent(captured, {
				selection: { direction: "none", end: 8, start: 8 },
				surface: "source",
				value: "alpha beta",
			}),
		).toBe(false);
		expect(
			isEditorContextCurrent(captured, {
				selection: captured.selection,
				surface: "source",
				value: "changed",
			}),
		).toBe(false);
	});

	it("rejects an ABA document context after the canonical revision changes", () => {
		const captured = captureEditorContext({
			direction: "ltr",
			position: { x: 0, y: 0 },
			revision: 0,
			selection: { direction: "forward", end: 5, start: 0 },
			surface: "source",
			value: "alpha",
		});

		expect(
			isEditorContextCurrent(captured, {
				revision: 0,
				selection: captured.selection,
				surface: "source",
				value: "alpha",
			}),
		).toBe(true);
		expect(
			isEditorContextCurrent(captured, {
				revision: 2,
				selection: captured.selection,
				surface: "source",
				value: "alpha",
			}),
		).toBe(false);
	});

	it("rejects a replaced editor surface even when the kind and range are unchanged", () => {
		const firstSurface = {};
		const secondSurface = {};
		const captured = captureEditorContext({
			direction: "ltr",
			position: { x: 0, y: 0 },
			selection: { direction: "none", end: 0, start: 0 },
			surface: "visual",
			surfaceIdentity: firstSurface,
			value: "alpha",
		});

		expect(
			isEditorContextCurrent(captured, {
				selection: captured.selection,
				surface: "visual",
				surfaceIdentity: firstSurface,
				value: "alpha",
			}),
		).toBe(true);
		expect(
			isEditorContextCurrent(captured, {
				selection: captured.selection,
				surface: "visual",
				surfaceIdentity: secondSurface,
				value: "alpha",
			}),
		).toBe(false);
	});

	it("identifies paragraphs, lists, quotes, fences, and tables by line boundaries", () => {
		const source = [
			"first paragraph",
			"- list item",
			"> quoted item",
			"```js",
			"code | literal",
			"```",
			"| Name | Value |",
			"| :--- | ---: |",
			"| A\\|B | `code\\|x` |",
		].join("\r\n");

		expect(findMarkdownBlock(source, source.indexOf("list"))?.kind).toBe(
			"list",
		);
		expect(findMarkdownBlock(source, source.indexOf("quoted"))?.kind).toBe(
			"quote",
		);
		expect(findMarkdownBlock(source, source.indexOf("literal"))?.kind).toBe(
			"code",
		);
		expect(findMarkdownBlock(source, source.lastIndexOf("A\\|B"))?.kind).toBe(
			"table",
		);
		expect(findMarkdownBlock(source, 2)?.kind).toBe("paragraph");
	});

	it("does not treat a one-character LF line as CRLF", () => {
		const block = findMarkdownBlock("a\n\nb", 0);
		expect(block).toMatchObject({ end: 1, start: 0 });
	});

	it("inserts a paragraph around a CRLF code block without entering the fence", () => {
		const source = "before\r\n\r\n```js\r\ncode\r\n```\r\n\r\nafter";
		const position = source.indexOf("code");
		const edit = insertParagraphRelative(
			source,
			{
				direction: "none",
				end: position,
				start: position,
			},
			"after",
		);

		expect(edit).not.toBeNull();
		expect(edit?.value).toBe(
			"before\r\n\r\n```js\r\ncode\r\n```\r\n\r\n\r\nafter",
		);
		expect(edit?.value).not.toContain("code\r\n\r\n```");
	});

	it.each([
		{
			kind: "quote",
			source: ["> ```js", "> code", "> ```", "> tail"].join("\n"),
			before: ["> ", "> ```js", "> code", "> ```", "> tail"].join("\n"),
			after: ["> ```js", "> code", "> ```", "> ", "> tail"].join("\n"),
		},
		{
			kind: "list",
			source: ["- ```js", "  code", "  ```", "- tail"].join("\n"),
			before: ["- ", "- ```js", "  code", "  ```", "- tail"].join("\n"),
			after: ["- ```js", "  code", "  ```", "  ", "- tail"].join("\n"),
		},
	] as const)(
		"keeps code-relative paragraph insertion inside a nested $kind container",
		({ source, before, after }) => {
			const position = source.indexOf("code");
			const index = createEditorMarkdownBlockIndex(source);
			const targetResult = findEditorCodeContentTarget(
				source,
				{ end: position, start: position },
				index,
			);
			if ("unavailable" === targetResult.status) {
				throw new Error(targetResult.code);
			}

			const selection = {
				direction: "none" as const,
				end: position,
				start: position,
			};
			expect(
				insertParagraphRelative(
					source,
					selection,
					"before",
					index,
					targetResult.target,
				)?.value,
			).toBe(before);
			expect(
				insertParagraphRelative(
					source,
					selection,
					"after",
					index,
					targetResult.target,
				)?.value,
			).toBe(after);
		},
	);

	it("rejects a code-relative insertion with a target outside its verified container", () => {
		const source = ["> ```js", "> code", "> ```", "> tail"].join("\n");
		const position = source.indexOf("code");
		const index = createEditorMarkdownBlockIndex(source);
		const targetResult = findEditorCodeContentTarget(
			source,
			{ end: position, start: position },
			index,
		);
		if ("unavailable" === targetResult.status) {
			throw new Error(targetResult.code);
		}
		expect(
			insertParagraphRelative(
				source,
				{ direction: "none", end: position, start: position },
				"after",
				index,
				{
					...targetResult.target,
					ownerEnd: targetResult.target.to - 1,
				},
			),
		).toBeNull();
	});

	it.each(["---", "***", "___"])(
		"inserts two %s newlines before a thematic break and preserves the exact source boundary",
		(marker) => {
			for (const newline of ["\n", "\r\n", "\r"]) {
				const source = `# prefix${newline}  ${marker}  ${newline}suffix`;
				const blockStart = source.indexOf(`  ${marker}`);
				const index = createEditorMarkdownBlockIndex(source);
				const edit = insertParagraphRelative(
					source,
					{
						direction: "none",
						end: source.indexOf(marker) + 1,
						start: source.indexOf(marker) + 1,
					},
					"before",
					index,
				);

				expect(edit).toEqual({
					changes: {
						from: blockStart,
						insert: `${newline}${newline}`,
						to: blockStart,
					},
					selection: {
						direction: "none",
						end: blockStart,
						start: blockStart,
					},
					value: `# prefix${newline}${newline}${newline}  ${marker}  ${newline}suffix`,
				});

				const typed = `${edit?.value.slice(0, blockStart)}text${edit?.value.slice(blockStart)}`;
				expect(findMarkdownBlock(typed, blockStart + 2)?.kind).toBe(
					"paragraph",
				);
				expect(findMarkdownBlock(typed, typed.indexOf(marker))?.kind).toBe(
					"thematic-break",
				);
			}
		},
	);

	it("keeps thematic-break insertion below on the existing one-newline path", () => {
		const source = "# prefix\n  ---  \nsuffix";
		const blockStart = source.indexOf("  ---");
		const blockEnd = source.indexOf("\n", blockStart);
		const index = createEditorMarkdownBlockIndex(source);
		expect(findMarkdownBlock(source, source.indexOf("---") + 1, index)?.kind).toBe(
			"thematic-break",
		);
		const edit = insertParagraphRelative(
			source,
			{
				direction: "none",
				end: source.indexOf("---") + 1,
				start: source.indexOf("---") + 1,
			},
			"after",
			index,
		);

		expect(edit?.changes).toEqual({
			from: blockEnd,
			insert: "\n",
			to: blockEnd,
		});
		expect(edit?.value).toBe("# prefix\n  ---  \n\nsuffix");
		expect(edit?.value.slice(0, blockEnd)).toBe(source.slice(0, blockEnd));
		expect(edit?.value.slice(blockEnd + 1)).toBe(source.slice(blockEnd));
	});

	it.each(["\n", "\r\n", "\r"])(
		"keeps %j structural insertion edits range-local",
		(newline) => {
			const cases = [
				{
					kind: "heading",
					source: ["# heading", "body"].join(newline),
					token: "heading",
				},
				{
					kind: "list",
					source: ["- item", "  - nested", "", "tail"].join(newline),
					token: "nested",
				},
				{
					kind: "quote",
					source: ["> quote", "> next", "", "tail"].join(newline),
					token: "next",
				},
				{
					kind: "code",
					source: ["```md", "code", "```", "", "tail"].join(newline),
					token: "code",
				},
			] as const;

			for (const item of cases) {
				const position = item.source.indexOf(item.token);
				expect(findMarkdownBlock(item.source, position)?.kind).toBe(item.kind);
				const edit = insertParagraphRelative(
					item.source,
					{
						direction: "none",
						end: position,
						start: position,
					},
					"after",
				);
				expect(edit).not.toBeNull();
				const change = edit?.changes;
				if (!change || !edit)
					throw new Error("editor-context-menu-structural-edit-missing");
				expect(edit.value.slice(0, change.from)).toBe(
					item.source.slice(0, change.from),
				);
				expect(edit.value.slice(change.from + change.insert.length)).toBe(
					item.source.slice(change.to),
				);
			}
		},
	);

	it("inserts after a CRLF prefix without moving or rewriting the following table", () => {
		const lines = [
			"prefix",
			"| H | V |",
			"| --- | --- |",
			"| a | b |",
			"",
			"after",
		];
		const source = lines.join("\r\n");
		const prefixPosition = source.indexOf("prefix") + 2;
		const edit = insertParagraphRelative(
			source,
			{
				direction: "none",
				end: prefixPosition,
				start: prefixPosition,
			},
			"after",
		);

		expect(edit?.value).toBe(
			[
				"prefix",
				"",
				"| H | V |",
				"| --- | --- |",
				"| a | b |",
				"",
				"after",
			].join("\r\n"),
		);
		const insertedLength = edit?.changes?.insert.length ?? 0;
		expect(edit?.value.slice((edit?.changes?.from ?? 0) + insertedLength)).toBe(
			source.slice(edit?.changes?.to ?? 0),
		);
	});

	it("does not split an outer math owner when inserting at its body or EOF", () => {
		const source = "\\[ a $$b$$ c \\]";
		const position = source.indexOf("b");
		const edit = insertParagraphRelative(
			source,
			{
				direction: "none",
				end: position,
				start: position,
			},
			"after",
		);

		expect(edit?.value).toBe(`${source}\n`);
		expect(edit?.changes).toEqual({
			from: source.length,
			insert: "\n",
			to: source.length,
		});
		expect(
			insertParagraphRelative(
				source,
				{
					direction: "none",
					end: source.length,
					start: source.length,
				},
				"after",
			)?.value,
		).toBe(`${source}\n`);
	});

	it("inserts an empty paragraph boundary without copying the source line", () => {
		const source = "a\nb";
		const selection = { direction: "none" as const, end: 0, start: 0 };
		const above = insertParagraphRelative(source, selection, "before");
		const below = insertParagraphRelative(source, selection, "after");

		expect(above?.value).toBe("\na\nb");
		expect(below?.value).toBe("a\nb\n");
		expect(above?.value.match(/a/gu)).toHaveLength(1);
		expect(below?.value.match(/a/gu)).toHaveLength(1);
	});

	it("uses parser block ranges for heading, nested-list, and indented-code insertion", () => {
		const heading = "# H\nbody";
		expect(
			insertParagraphRelative(
				heading,
				{
					direction: "none",
					end: heading.indexOf("H"),
					start: heading.indexOf("H"),
				},
				"after",
			)?.value,
		).toBe("# H\n\nbody");

		const list = "- a\n  - b\n- c\n\nbody";
		expect(
			insertParagraphRelative(
				list,
				{
					direction: "none",
					end: list.indexOf("b"),
					start: list.indexOf("b"),
				},
				"after",
			)?.value,
		).toBe("- a\n  - b\n- c\n\n\nbody");

		const indented = "    code\n\nbody";
		expect(
			insertParagraphRelative(
				indented,
				{
					direction: "none",
					end: indented.indexOf("code"),
					start: indented.indexOf("code"),
				},
				"after",
			)?.value,
		).toBe("    code\n\n\nbody");
	});

	it("inserts and deletes table rows and columns while preserving escaped/code pipes", () => {
		const source =
			"| Name | Value |\r\n| :--- | ---: |\r\n| A\\|B | `code\\|x` |";
		const cellPosition = source.lastIndexOf("A\\|B") + 1;
		const valuePosition = source.indexOf("Value");

		const insertedRow = editMarkdownTable(source, cellPosition, {
			type: "insert-row-below",
		});
		expect(insertedRow?.value).toBe(
			"| Name | Value |\r\n| :--- | ---: |\r\n| A\\|B | `code\\|x` |\r\n|  |  |",
		);

		const insertedColumn = editMarkdownTable(source, valuePosition, {
			type: "insert-column-right",
		});
		expect(insertedColumn?.value).toBe(
			"| Name | Value |  |\r\n| :--- | ---: | --- |\r\n| A\\|B | `code\\|x` |  |",
		);

		const deletedColumn = editMarkdownTable(source, valuePosition, {
			type: "delete-column",
		});
		expect(deletedColumn?.value).toBe("| Name |\r\n| :--- |\r\n| A\\|B |");
	});

	it("formats only outer-cell padding while preserving Markdown cell cores", () => {
		const source = [
			"before",
			"  A | URL |",
			"  --- | :---: |",
			"  `x\\|y` | [x](u) |",
			"",
			"after",
		].join("\n");
		const position = source.indexOf("A");
		const edit = formatMarkdownTableSource(source, {
			direction: "none",
			end: position,
			start: position,
		});

		expect(edit?.value).toBe(
			[
				"before",
				"  A      | URL    |",
				"  ---    | :---:  |",
				"  `x\\|y` | [x](u) |",
				"",
				"after",
			].join("\n"),
		);
		expect(edit?.changes).toEqual({
			from: source.indexOf("  A"),
			insert: [
				"  A      | URL    |",
				"  ---    | :---:  |",
				"  `x\\|y` | [x](u) |",
			].join("\n"),
			to: source.indexOf(" |\n\nafter") + 2,
		});
	});

	it("preserves escaped trailing spaces, annotation bytes, and each row line ending", () => {
		const marker = '<!-- easymde-table-align:v1 [[1,"center"]] -->  ';
		const newline = "\r\n";
		const source = [
			"before",
			marker,
			"  code\t | link |",
			"  ---\t | --- |",
			"  value\\  | [x](https://e.test/a) |",
			"",
			"after",
		].join(newline);
		const tableStart = source.indexOf("  code");
		const position = source.indexOf("code");
		const edit = formatMarkdownTableSource(source, {
			direction: "none",
			end: position,
			start: position,
		});

		expect(edit?.value.startsWith(`before${newline}${marker}${newline}`)).toBe(
			true,
		);
		expect(edit?.value.endsWith(`${newline}${newline}after`)).toBe(true);
		expect(edit?.value).toContain("  value\\  | [x](https://e.test/a) |");
		expect(edit?.value.match(/\r\n/gu)).toHaveLength(6);
		expect(edit?.value).not.toContain("\n|");
		expect(edit?.changes?.from).toBe(tableStart);
	});

	it("maps a non-collapsed backward selection to the same source core", () => {
		const source = "| A | Longer |\n| --- | --- |\n| x | y |";
		const start = source.indexOf("A");
		const end = start + 1;
		const edit = formatMarkdownTableSource(source, {
			direction: "backward",
			end,
			start,
		});

		expect(edit?.selection.direction).toBe("backward");
		expect(
			edit?.value.slice(edit?.selection.start ?? 0, edit?.selection.end ?? 0),
		).toBe("A");
	});

	it("aligns GFM table pipe escaping with league/commonmark TableParser::split()", () => {
		expect(pipePositions("|x|\\\\|z|")).toEqual([0, 2, 7]);
		expect(pipePositions("|x|\\\\|z|w|")).toEqual([0, 2, 7, 9]);
		expect(pipePositions("|x|\\|z|w|")).toEqual([0, 2, 6, 8]);
		expect(pipePositions("|x|\\\\ |z|")).toEqual([0, 2, 6, 8]);
		expect(pipePositions("|x|\\\\\\\\|z|w|")).toEqual([0, 2, 9, 11]);
		expect(pipePositions("\\|a|b|")).toEqual([3, 5]);

		// Case 1: Under GFM Section 4.10 / TableParser::split(), `\\|` is an
		// escaped pipe inside cell 1, leaving only 2 body cells for 3 header
		// columns (`["x", "|z", ""]`). Refusing to format preserves the exact
		// rendered table instead of turning `\\|` into a column split.
		const shortDoubleBackslash = "|A|B|C|\n|-|-|-|\n|x|\\\\|z|";
		for (const probe of ["A", "x", "z"]) {
			const pos = shortDoubleBackslash.indexOf(probe);
			expect(findMarkdownTable(shortDoubleBackslash, pos)).toBeNull();
			expect(
				formatMarkdownTableSource(shortDoubleBackslash, {
					direction: "none",
					end: pos,
					start: pos,
				}),
			).toBeNull();
		}

		// Case 2: Full 3-cell row containing `\\|` keeps `\\|z` in column 1 and
		// maps both caret and non-collapsed selection through formatting.
		const fullDoubleBackslash = "|A|B|C|\n|-|-|-|\n|x|\\\\|z|w|";
		const zPos = fullDoubleBackslash.indexOf("z");
		const wPos = fullDoubleBackslash.indexOf("w");
		const escapedTokenStart = fullDoubleBackslash.indexOf("\\\\|z");
		const escapedTokenEnd = escapedTokenStart + "\\\\|z".length;
		expect(findMarkdownTable(fullDoubleBackslash, zPos)).toMatchObject({
			columnCount: 3,
			rowCount: 2,
		});
		expect(
			tableSelectionAt(fullDoubleBackslash, {
				direction: "none",
				end: zPos,
				start: zPos,
			}),
		).toMatchObject({ column: 1, kind: "column", rowIndex: 2 });
		expect(
			tableSelectionAt(fullDoubleBackslash, {
				direction: "none",
				end: wPos,
				start: wPos,
			}),
		).toMatchObject({ column: 2, kind: "column", rowIndex: 2 });
		const fullDoubleEdit = formatMarkdownTableSource(fullDoubleBackslash, {
			direction: "forward",
			end: escapedTokenEnd,
			start: escapedTokenStart,
		});
		const expectedFullDouble =
			"| A | B    | C |\n| - | -    | - |\n| x | \\\\|z | w |";
		expect(fullDoubleEdit?.value).toBe(expectedFullDouble);
		expect(
			fullDoubleEdit?.value.slice(
				fullDoubleEdit.selection.start,
				fullDoubleEdit.selection.end,
			),
		).toBe("\\\\|z");
		const fullDoubleCaretEdit = formatMarkdownTableSource(fullDoubleBackslash, {
			direction: "none",
			end: zPos,
			start: zPos,
		});
		expect(fullDoubleCaretEdit?.value).toBe(expectedFullDouble);
		expect(
			fullDoubleCaretEdit?.value[fullDoubleCaretEdit.selection.start],
		).toBe("z");
		if (fullDoubleEdit) {
			expect(
				formatMarkdownTableSource(fullDoubleEdit.value, fullDoubleEdit.selection),
			).toEqual({
				selection: fullDoubleEdit.selection,
				value: expectedFullDouble,
			});
		}

		// Case 3: Single-backslash control (`\|z`) formats cleanly and preserves
		// column identity and selection mapping.
		const singleBackslash = "|A|B|C|\n|-|-|-|\n|x|\\|z|w|";
		const singleStart = singleBackslash.indexOf("\\|z");
		const singleEnd = singleStart + "\\|z".length;
		expect(findMarkdownTable(singleBackslash, singleStart)).toMatchObject({
			columnCount: 3,
			rowCount: 2,
		});
		const singleEdit = formatMarkdownTableSource(singleBackslash, {
			direction: "forward",
			end: singleEnd,
			start: singleStart,
		});
		expect(singleEdit?.value).toBe(
			"| A | B   | C |\n| - | -   | - |\n| x | \\|z | w |",
		);
		expect(
			singleEdit?.value.slice(
				singleEdit.selection.start,
				singleEdit.selection.end,
			),
		).toBe("\\|z");

		// Case 4: Spaced double-backslash (`\\ |`) has an unescaped delimiter
		// pipe and formats to `| x | \\ | z |` with space before `|` preserved.
		const spacedDoubleBackslash = "|A|B|C|\n|-|-|-|\n|x|\\\\ |z|";
		const spacedStart = spacedDoubleBackslash.indexOf("\\\\");
		const spacedEnd = spacedStart + 2;
		expect(findMarkdownTable(spacedDoubleBackslash, spacedStart)).toMatchObject({
			columnCount: 3,
			rowCount: 2,
		});
		expect(
			tableSelectionAt(spacedDoubleBackslash, {
				direction: "none",
				end: spacedDoubleBackslash.indexOf("z"),
				start: spacedDoubleBackslash.indexOf("z"),
			}),
		).toMatchObject({ column: 2, kind: "column", rowIndex: 2 });
		const spacedEdit = formatMarkdownTableSource(spacedDoubleBackslash, {
			direction: "forward",
			end: spacedEnd,
			start: spacedStart,
		});
		expect(spacedEdit?.value).toBe(
			"| A | B  | C |\n| - | -  | - |\n| x | \\\\ | z |",
		);
		expect(
			spacedEdit?.value.slice(
				spacedEdit.selection.start,
				spacedEdit.selection.end,
			),
		).toBe("\\\\");

		// Trailing `\\|` without a closing delimiter stays cell content rather than
		// becoming a trailing delimiter pipe.
		const trailingEscapedPipe = "|A|Header|\n|-|-|\n|x|\\\\|";
		const trailingPos = trailingEscapedPipe.indexOf("\\\\|");
		expect(findMarkdownTable(trailingEscapedPipe, trailingPos)).toMatchObject({
			columnCount: 2,
			rowCount: 2,
		});
		const trailingPipeEdit = formatMarkdownTableSource(trailingEscapedPipe, {
			direction: "none",
			end: trailingPos,
			start: trailingPos,
		});
		expect(trailingPipeEdit?.value).toBe(
			"| A | Header |\n| - | -      |\n| x | \\\\|   ",
		);
	});

	it("suppresses right padding on outerless first cells that would become CommonMark block openers", () => {
		const headerOpeners = [
			"-",
			"+",
			"*",
			"#",
			"######",
			"1.",
			"999999999.",
			"1)",
			"999999999)",
		];
		for (const opener of headerOpeners) {
			const source = `${opener}|\\\\|z\n|---|---|\n|xx|yy|`;
			const caret = source.indexOf("z");
			const edit = formatMarkdownTableSource(source, {
				direction: "none",
				end: caret,
				start: caret,
			});
			expect(edit, opener).not.toBeNull();
			const firstLine = (edit?.value ?? "").split("\n")[0];
			expect(firstLine, opener).toBe(`${opener}| \\\\|z`);
			expect(edit?.value[edit.selection.start], opener).toBe("z");
			expect(
				findMarkdownTable(edit?.value ?? "", edit?.selection.start ?? 0),
				opener,
			).toMatchObject({ columnCount: 2, rowCount: 2 });
			if (edit) {
				expect(
					formatMarkdownTableSource(edit.value, edit.selection),
					opener,
				).toEqual({
					selection: edit.selection,
					value: edit.value,
				});
			}
		}

		// Indented outerless opener header and exact selection mapping on cell 0.
		const indented = "  -|\\\\|z\n  |---|---|\n  |xx|yy|";
		const dashPos = indented.indexOf("-");
		const indentedEdit = formatMarkdownTableSource(indented, {
			direction: "forward",
			end: dashPos + 1,
			start: dashPos,
		});
		expect(indentedEdit?.value).toBe(
			"  -| \\\\|z\n  | --- | ---  |\n  | xx  | yy   |",
		);
		expect(
			indentedEdit?.value.slice(
				indentedEdit.selection.start,
				indentedEdit.selection.end,
			),
		).toBe("-");

		// Body rows without a leading pipe also suppress right padding, including
		// when removing existing trailing spaces before the pipe (rawEnd > coreEnd)
		// on a non-interrupting ordered-list token like `2.  |yy`.
		for (const bodyCell of ["-", "+", "*", "#", "1.", "1)"]) {
			const source = `|A|B|\n|---|---|\n${bodyCell}|yy`;
			const edit = formatMarkdownTableSource(source, {
				direction: "none",
				end: source.indexOf("yy"),
				start: source.indexOf("yy"),
			});
			expect(edit?.value, bodyCell).toBe(
				`| A   | B   |\n| --- | --- |\n${bodyCell}| yy `,
			);
			expect(
				findMarkdownTable(edit?.value ?? "", edit?.selection.start ?? 0),
				bodyCell,
			).toMatchObject({ columnCount: 2, rowCount: 2 });
		}
		const spacedBody = "|A|B|\n|---|---|\n2.  |yy";
		const spacedBodyPos = spacedBody.lastIndexOf("2.");
		const spacedBodyEdit = formatMarkdownTableSource(spacedBody, {
			direction: "forward",
			end: spacedBodyPos + 2,
			start: spacedBodyPos,
		});
		expect(spacedBodyEdit?.value).toBe("| A   | B   |\n| --- | --- |\n2.| yy ");
		expect(
			spacedBodyEdit?.value.slice(
				spacedBodyEdit.selection.start,
				spacedBodyEdit.selection.end,
			),
		).toBe("2.");

		// Non-opener tokens and leading-pipe rows keep normal column-aligned padding.
		const nonOpeners = [
			"--|b\n|---|---|\n|xxxx|yy|",
			"#######|b\n|---|---|\n|xxxxxxxx|yy|",
			"1000000000.|b\n|---|---|\n|xxxxxxxxxxxx|yy|",
			"|-|\\\\|z|\n|---|---|\n|xx|yy|",
		];
		expect(
			formatMarkdownTableSource(nonOpeners[0] ?? "", {
				direction: "none",
				end: 0,
				start: 0,
			})?.value.split("\n")[0],
		).toBe("--   | b  ");
		expect(
			formatMarkdownTableSource(nonOpeners[1] ?? "", {
				direction: "none",
				end: 0,
				start: 0,
			})?.value.split("\n")[0],
		).toBe("#######  | b  ");
		expect(
			formatMarkdownTableSource(nonOpeners[2] ?? "", {
				direction: "none",
				end: 0,
				start: 0,
			})?.value.split("\n")[0],
		).toBe("1000000000.  | b  ");
		expect(
			formatMarkdownTableSource(nonOpeners[3] ?? "", {
				direction: "none",
				end: 1,
				start: 1,
			})?.value.split("\n")[0],
		).toBe("| -   | \\\\|z |");

		// Byte projection agrees to the exact byte with emitted bytes at the 1 MiB ceiling
		// in both aligned and compact fallback modes.
		const openerTable = "-|\\\\|z\n|---|---|\n|xx|yy|";
		const expectedAligned = "-| \\\\|z\n| --- | ---  |\n| xx  | yy   |";
		const expectedCompact = "-| \\\\|z\n| --- | --- |\n| xx | yy |";
		const alignedBytes = utf8ByteLength(expectedAligned);
		const exactAlignedSource = `${"p".repeat(MAX_MARKDOWN_PREVIEW_BYTES - alignedBytes - 2)}\n\n${openerTable}`;
		const exactAlignedEdit = formatMarkdownTableSource(exactAlignedSource, {
			direction: "none",
			end: exactAlignedSource.lastIndexOf("xx"),
			start: exactAlignedSource.lastIndexOf("xx"),
		});
		expect(exactAlignedEdit).not.toBeNull();
		expect(utf8ByteLength(exactAlignedEdit?.value ?? "")).toBe(
			MAX_MARKDOWN_PREVIEW_BYTES,
		);
		expect(exactAlignedEdit?.value.endsWith(expectedAligned)).toBe(true);

		const compactBytes = utf8ByteLength(expectedCompact);
		const exactCompactSource = `${"p".repeat(MAX_MARKDOWN_PREVIEW_BYTES - compactBytes - 2)}\n\n${openerTable}`;
		const exactCompactEdit = formatMarkdownTableSource(exactCompactSource, {
			direction: "none",
			end: exactCompactSource.lastIndexOf("xx"),
			start: exactCompactSource.lastIndexOf("xx"),
		});
		expect(exactCompactEdit).not.toBeNull();
		expect(utf8ByteLength(exactCompactEdit?.value ?? "")).toBe(
			MAX_MARKDOWN_PREVIEW_BYTES,
		);
		expect(exactCompactEdit?.value.endsWith(expectedCompact)).toBe(true);

		const oneByteOverSource = `${"p".repeat(MAX_MARKDOWN_PREVIEW_BYTES - compactBytes - 1)}\n\n${openerTable}`;
		expect(
			formatMarkdownTableSource(oneByteOverSource, {
				direction: "none",
				end: oneByteOverSource.lastIndexOf("xx"),
				start: oneByteOverSource.lastIndexOf("xx"),
			}),
		).toBeNull();
	});

	it("suppresses right padding on outerless HTML Type 1 and Type 6 block openers and keeps byte projection exact", () => {
		const styleWithParagraph = "<style|Header\n---|---\n1|2\n\nAfter";
		const styleEdit = formatMarkdownTableSource(styleWithParagraph, {
			direction: "none",
			end: styleWithParagraph.indexOf("Header"),
			start: styleWithParagraph.indexOf("Header"),
		});
		expect(styleEdit?.value).toBe(
			"<style| Header\n---    | ---   \n1      | 2     \n\nAfter",
		);
		expect(
			findMarkdownTable(styleEdit?.value ?? "", styleEdit?.selection.start ?? 0),
		).toMatchObject({ columnCount: 2, rowCount: 2 });
		if (styleEdit) {
			expect(
				formatMarkdownTableSource(styleEdit.value, styleEdit.selection),
			).toEqual({
				selection: styleEdit.selection,
				value: styleEdit.value,
			});
		}

		const htmlOpeners = [
			"<style",
			"<pre",
			"<script",
			"<textarea",
			"<div",
			"</div",
			"<SOURCE",
			"<search",
			"<p",
			"<table",
			"<hr",
		];
		for (const opener of htmlOpeners) {
			const source = `${opener}|Header\n---|---\n1|2`;
			const caret = source.indexOf("Header");
			const edit = formatMarkdownTableSource(source, {
				direction: "none",
				end: caret,
				start: caret,
			});
			expect(edit, opener).not.toBeNull();
			expect((edit?.value ?? "").split("\n")[0], opener).toBe(
				`${opener}| Header`,
			);
			expect(
				edit?.value.slice(edit.selection.start, edit.selection.start + 6),
				opener,
			).toBe("Header");
			expect(
				findMarkdownTable(edit?.value ?? "", edit?.selection.start ?? 0),
				opener,
			).toMatchObject({ columnCount: 2, rowCount: 2 });
			if (edit) {
				expect(
					formatMarkdownTableSource(edit.value, edit.selection),
					opener,
				).toEqual({
					selection: edit.selection,
					value: edit.value,
				});
			}
		}

		// Indented outerless header and body row also suppress right padding.
		const indentedStyle = "  <style|Header\n  ---|---\n  <div|2";
		const indentedEdit = formatMarkdownTableSource(indentedStyle, {
			direction: "none",
			end: indentedStyle.indexOf("Header"),
			start: indentedStyle.indexOf("Header"),
		});
		expect(indentedEdit?.value).toBe(
			"  <style| Header\n  ---    | ---   \n  <div| 2     ",
		);

		// Leading-pipe control and non-opener HTML tokens retain normal column padding.
		const leadingPipeControl = "| <style | Header |\n| --- | --- |\n| 12345678 | 2 |";
		expect(
			formatMarkdownTableSource(leadingPipeControl, {
				direction: "none",
				end: leadingPipeControl.indexOf("Header"),
				start: leadingPipeControl.indexOf("Header"),
			})?.value.split("\n")[0],
		).toBe("| <style   | Header |");

		for (const nonOpener of ["<span", "</style", "<stylex"]) {
			const source = `${nonOpener}|b\n---|---\n123456789|2`;
			const formattedFirstLine = formatMarkdownTableSource(source, {
				direction: "none",
				end: source.indexOf("b"),
				start: source.indexOf("b"),
			})?.value.split("\n")[0];
			expect(formattedFirstLine, nonOpener).toBe(
				`${nonOpener}${" ".repeat(9 - nonOpener.length)} | b  `,
			);
		}

		// Byte projection stays exact at the 1 MiB ceiling in aligned and compact modes.
		const htmlTable = "<style|Header\n---|---\n1|2";
		const expectedAligned = "<style| Header\n---    | ---   \n1      | 2     ";
		const expectedCompact = "<style| Header\n--- | ---\n1 | 2";
		const alignedBytes = utf8ByteLength(expectedAligned);
		const exactAligned = `${"p".repeat(MAX_MARKDOWN_PREVIEW_BYTES - alignedBytes - 2)}\n\n${htmlTable}`;
		const exactAlignedEdit = formatMarkdownTableSource(exactAligned, {
			direction: "none",
			end: exactAligned.lastIndexOf("Header"),
			start: exactAligned.lastIndexOf("Header"),
		});
		expect(exactAlignedEdit).not.toBeNull();
		expect(utf8ByteLength(exactAlignedEdit?.value ?? "")).toBe(
			MAX_MARKDOWN_PREVIEW_BYTES,
		);
		expect(exactAlignedEdit?.value.endsWith(expectedAligned)).toBe(true);

		const compactBytes = utf8ByteLength(expectedCompact);
		const exactCompact = `${"p".repeat(MAX_MARKDOWN_PREVIEW_BYTES - compactBytes - 2)}\n\n${htmlTable}`;
		const exactCompactEdit = formatMarkdownTableSource(exactCompact, {
			direction: "none",
			end: exactCompact.lastIndexOf("Header"),
			start: exactCompact.lastIndexOf("Header"),
		});
		expect(exactCompactEdit).not.toBeNull();
		expect(utf8ByteLength(exactCompactEdit?.value ?? "")).toBe(
			MAX_MARKDOWN_PREVIEW_BYTES,
		);
		expect(exactCompactEdit?.value.endsWith(expectedCompact)).toBe(true);

		const oneByteOver = `${"p".repeat(MAX_MARKDOWN_PREVIEW_BYTES - compactBytes - 1)}\n\n${htmlTable}`;
		expect(
			formatMarkdownTableSource(oneByteOver, {
				direction: "none",
				end: oneByteOver.lastIndexOf("Header"),
				start: oneByteOver.lastIndexOf("Header"),
			}),
		).toBeNull();
	});

	it("preserves table structure when inserting columns right across escaped pipes and trailing spaces", () => {
		const withNextRow = "|A|Header|\n|-|-|\n|x|\\\\|\n|y|z|";
		const insertedWithNextRow = editMarkdownTable(
			withNextRow,
			withNextRow.indexOf("Header"),
			{ type: "insert-column-right" },
		);
		expect(insertedWithNextRow?.value).toBe(
			"|A|Header|  |\n|-|-| --- |\n|x|\\\\| |  |\n|y|z|  |",
		);
		expect(
			findMarkdownTable(
				insertedWithNextRow?.value ?? "",
				insertedWithNextRow?.selection.start ?? 0,
			),
		).toMatchObject({ columnCount: 3, rowCount: 3 });

		const atEof = "|A|Header|\n|-|-|\n|x|\\\\|";
		const insertedAtEof = editMarkdownTable(atEof, atEof.indexOf("\\\\|"), {
			type: "insert-column-right",
		});
		expect(insertedAtEof?.value).toBe(
			"|A|Header|  |\n|-|-| --- |\n|x|\\\\| |  |",
		);
		expect(
			tableSelectionAt(
				insertedAtEof?.value ?? "",
				insertedAtEof?.selection ?? { direction: "none", end: 0, start: 0 },
			),
		).toMatchObject({ column: 2, columnCount: 3, kind: "column", rowIndex: 2 });

		const trailingSpaces = "| A | B |  \n| - | - |  \n| 1 | 2 |  ";
		const insertedTrailingSpaces = editMarkdownTable(
			trailingSpaces,
			trailingSpaces.indexOf("B"),
			{ type: "insert-column-right" },
		);
		expect(insertedTrailingSpaces?.value).toBe(
			"| A | B |  |  \n| - | - | --- |  \n| 1 | 2 |  |  ",
		);
		expect(
			findMarkdownTable(
				insertedTrailingSpaces?.value ?? "",
				insertedTrailingSpaces?.selection.start ?? 0,
			),
		).toMatchObject({ columnCount: 3, rowCount: 2 });

		const trailingBackslash = "|A|B\n|-|-\n|x|foo\\";
		const insertedTrailingBackslash = editMarkdownTable(
			trailingBackslash,
			trailingBackslash.indexOf("foo\\"),
			{ type: "insert-column-right" },
		);
		expect(insertedTrailingBackslash?.value).toBe(
			"|A|B |  |\n|-|- | --- |\n|x|foo\\ |  |",
		);
		expect(
			findMarkdownTable(
				insertedTrailingBackslash?.value ?? "",
				insertedTrailingBackslash?.selection.start ?? 0,
			),
		).toMatchObject({ columnCount: 3, rowCount: 2 });
	});

	it("inserts column 0 left on pipe-less outer-border tables with explicit leading pipes and exact caret placement", () => {
		const unindented = "A | B\n--- | ---\n1 | 2";
		const unindentedHeaderEdit = editMarkdownTable(
			unindented,
			unindented.indexOf("A"),
			{ type: "insert-column-left" },
		);
		expect(unindentedHeaderEdit?.value).toBe(
			"|  |A | B\n| --- |--- | ---\n|  |1 | 2",
		);
		expect(
			tableSelectionAt(
				unindentedHeaderEdit?.value ?? "",
				unindentedHeaderEdit?.selection ?? {
					direction: "none",
					end: 0,
					start: 0,
				},
			),
		).toMatchObject({ column: 0, columnCount: 3, kind: "column", rowIndex: 0 });
		expect(unindentedHeaderEdit?.selection.start).toBe(2);

		const indented = "  A | B\n  --- | ---\n  1 | 2";
		const indentedBodyEdit = editMarkdownTable(
			indented,
			indented.indexOf("1"),
			{ type: "insert-column-left" },
		);
		expect(indentedBodyEdit?.value).toBe(
			"  |  |A | B\n  | --- |--- | ---\n  |  |1 | 2",
		);
		expect(
			tableSelectionAt(
				indentedBodyEdit?.value ?? "",
				indentedBodyEdit?.selection ?? { direction: "none", end: 0, start: 0 },
			),
		).toMatchObject({ column: 0, columnCount: 3, kind: "column", rowIndex: 2 });
		const bodyLineStart = (indentedBodyEdit?.value ?? "").lastIndexOf("  |  |1");
		expect(indentedBodyEdit?.selection.start).toBe(bodyLineStart + 4);
	});

	it("preserves a separator pipe when deleting a column from a 2-column pipe-less outer-border table", () => {
		const unindented = "A | B\n--- | ---\n1 | 2";
		const deleteCol0 = editMarkdownTable(unindented, unindented.indexOf("1"), {
			type: "delete-column",
		});
		expect(deleteCol0?.value).toBe("| B\n| ---\n| 2");
		expect(
			tableSelectionAt(
				deleteCol0?.value ?? "",
				deleteCol0?.selection ?? { direction: "none", end: 0, start: 0 },
			),
		).toMatchObject({ column: 0, columnCount: 1, kind: "column", rowIndex: 2 });

		const deleteCol1 = editMarkdownTable(unindented, unindented.indexOf("2"), {
			type: "delete-column",
		});
		expect(deleteCol1?.value).toBe("A |\n--- |\n1 |");
		expect(
			tableSelectionAt(
				deleteCol1?.value ?? "",
				deleteCol1?.selection ?? { direction: "none", end: 0, start: 0 },
			),
		).toMatchObject({ column: 0, columnCount: 1, kind: "column", rowIndex: 2 });

		const indented = "  A | B\n  --- | ---\n  1 | 2";
		const deleteIndentedCol0 = editMarkdownTable(
			indented,
			indented.indexOf("A"),
			{ type: "delete-column" },
		);
		expect(deleteIndentedCol0?.value).toBe("  | B\n  | ---\n  | 2");
		expect(
			tableSelectionAt(
				deleteIndentedCol0?.value ?? "",
				deleteIndentedCol0?.selection ?? {
					direction: "none",
					end: 0,
					start: 0,
				},
			),
		).toMatchObject({ column: 0, columnCount: 1, kind: "column", rowIndex: 0 });

		const deleteIndentedCol1 = editMarkdownTable(
			indented,
			indented.indexOf("B"),
			{ type: "delete-column" },
		);
		expect(deleteIndentedCol1?.value).toBe("  A |\n  --- |\n  1 |");
		expect(
			tableSelectionAt(
				deleteIndentedCol1?.value ?? "",
				deleteIndentedCol1?.selection ?? {
					direction: "none",
					end: 0,
					start: 0,
				},
			),
		).toMatchObject({ column: 0, columnCount: 1, kind: "column", rowIndex: 0 });

		const mixed = "| A | B |\n| --- | --- |\n1 | 2";
		expect(
			editMarkdownTable(mixed, mixed.indexOf("A"), { type: "delete-column" })
				?.value,
		).toBe("| B |\n| --- |\n| 2");
		expect(
			editMarkdownTable(mixed, mixed.indexOf("B"), { type: "delete-column" })
				?.value,
		).toBe("| A |\n| --- |\n1 |");
	});

	it("preserves a leading pipe when deleting column 0 on 3+-column outerless and 2-column trailing-pipe tables", () => {
		const threeColCases = [
			{
				expected: "| b | c\n| - | ---\n| 2 | 3",
				name: "delimiter single dash in col 1",
				source: "a | b | c\n--- | - | ---\n1 | 2 | 3",
			},
			{
				expected: "| # | c\n| --- | ---\n| - | 3",
				name: "heading and list openers in col 1",
				source: "a | # | c\n--- | --- | ---\n1 | - | 3",
			},
			{
				expected: "| > x | c\n| --- | ---\n| <style | 3",
				name: "blockquote and html opener in col 1",
				source: "a | > x | c\n--- | --- | ---\n1 | <style | 3",
			},
			{
				expected: "|     x | c\n| --- | ---\n|     y | 3",
				name: "four-plus spaces in col 1",
				source: "a |     x | c\n--- | --- | ---\n1 |     y | 3",
			},
			{
				expected: "|\tx | c\n| --- | ---\n|\ty | 3",
				name: "leading tab in col 1",
				source: "a |\tx | c\n--- | --- | ---\n1 |\ty | 3",
			},
			{
				expected: "  | # | c\n  | --- | ---\n  | 2 | 3",
				name: "indented outerless 3-column table",
				source: "  a | # | c\n  --- | --- | ---\n  1 | 2 | 3",
			},
		];

		for (const testCase of threeColCases) {
			const edit = editMarkdownTable(
				testCase.source,
				testCase.source.indexOf("a"),
				{ type: "delete-column" },
			);
			expect(edit?.value, testCase.name).toBe(testCase.expected);
			expect(
				tableSelectionAt(
					edit?.value ?? "",
					edit?.selection ?? { direction: "none", end: 0, start: 0 },
				),
				testCase.name,
			).toMatchObject({
				column: 0,
				columnCount: 2,
				kind: "column",
				rowIndex: 0,
			});
		}

		const trailingPipeTwoCol = "a | # |\n--- | --- |\n1 | 2 |";
		const deleteTrailingCol0 = editMarkdownTable(
			trailingPipeTwoCol,
			trailingPipeTwoCol.indexOf("a"),
			{ type: "delete-column" },
		);
		expect(deleteTrailingCol0?.value).toBe("| # |\n| --- |\n| 2 |");
		expect(
			tableSelectionAt(
				deleteTrailingCol0?.value ?? "",
				deleteTrailingCol0?.selection ?? { direction: "none", end: 0, start: 0 },
			),
		).toMatchObject({ column: 0, columnCount: 1, kind: "column", rowIndex: 0 });

		const deleteTrailingCol1 = editMarkdownTable(
			trailingPipeTwoCol,
			trailingPipeTwoCol.indexOf("#"),
			{ type: "delete-column" },
		);
		expect(deleteTrailingCol1?.value).toBe("a |\n--- |\n1 |");
		expect(
			tableSelectionAt(
				deleteTrailingCol1?.value ?? "",
				deleteTrailingCol1?.selection ?? { direction: "none", end: 0, start: 0 },
			),
		).toMatchObject({ column: 0, columnCount: 1, kind: "column", rowIndex: 0 });

		// Leading-pipe controls stay single-piped when deleting column 0.
		const leadingPipeThreeCol = "| a | # | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |";
		expect(
			editMarkdownTable(
				leadingPipeThreeCol,
				leadingPipeThreeCol.indexOf("a"),
				{ type: "delete-column" },
			)?.value,
		).toBe("| # | c |\n| --- | --- |\n| 2 | 3 |");

		const leadingPipeTwoCol = "| a | # |\n| --- | --- |\n| 1 | 2 |";
		expect(
			editMarkdownTable(leadingPipeTwoCol, leadingPipeTwoCol.indexOf("a"), {
				type: "delete-column",
			})?.value,
		).toBe("| # |\n| --- |\n| 2 |");
	});

	it("removes leading indentation when clearing an indented table alignment annotation", () => {
		const source =
			'  <!-- easymde-table-align:v1 [[1,"center"]] -->\n  | A | B |\n  | --- | --- |\n  | 1 | 2 |';
		const result = setMarkdownTableAlignment(source, source.indexOf("A"), {
			alignment: "left",
			selection: { columnCount: 2, kind: "whole-table" },
		});
		expect(result).toMatchObject({
			value: "  | A | B |\n  | :--- | :--- |\n  | 1 | 2 |",
		});
		if ("status" in result) {
			throw new Error("table-alignment-unexpectedly-unsupported");
		}
		expect(findMarkdownTable(result.value, result.value.indexOf("A"))).toMatchObject({
			baseAlignments: ["left", "left"],
			columnCount: 2,
			rowCount: 2,
		});

		const withPrefixCrlf =
			'before\r\n  <!-- easymde-table-align:v1 [[1,"center"]] -->  \r\n  | A | B |\r\n  | --- | --- |\r\n  | 1 | 2 |';
		const crlfResult = setMarkdownTableAlignment(
			withPrefixCrlf,
			withPrefixCrlf.indexOf("A"),
			{
				alignment: "left",
				selection: { columnCount: 2, kind: "whole-table" },
			},
		);
		expect(crlfResult).toMatchObject({
			value: "before\r\n  | A | B |\r\n  | :--- | :--- |\r\n  | 1 | 2 |",
		});
	});

	it("counts UTF-8 byte lengths consistently with TextEncoder across slices and surrogates", () => {
		expect(MAX_MARKDOWN_PREVIEW_BYTES).toBe(1_048_576);
		const encoder = new TextEncoder();
		const samples = [
			"",
			"ascii-123",
			"café",
			"中文测试",
			"😀🎉",
			"aé中😀",
			"\ud800",
			"\udfff",
			"x\ud800y\udfffz",
		];
		for (const sample of samples) {
			expect(utf8ByteLength(sample)).toBe(encoder.encode(sample).byteLength);
		}
		const mixed = "aé中😀b";
		// Slice bounds including splitting the surrogate pair at index 3..5.
		for (let start = -2; start <= mixed.length + 2; start += 1) {
			for (let end = -2; end <= mixed.length + 2; end += 1) {
				const from = Math.max(0, Math.min(mixed.length, start));
				const to = Math.max(from, Math.min(mixed.length, end));
				expect(utf8ByteLength(mixed, start, end)).toBe(
					encoder.encode(mixed.slice(from, to)).byteLength,
				);
			}
		}
	});

	it("treats only a 0-3 space indent as table syntax and rejects code-indented rows", () => {
		// A real 0-3 space indented table keeps its own bytes and gains only
		// outer padding.
		for (const spaces of ["", " ", "  ", "   "]) {
			const source = [
				"before",
				"",
				`${spaces}| A | B |`,
				`${spaces}| --- | --- |`,
				`${spaces}| x | y |`,
				"",
				"after",
			].join("\n");
			const position = source.indexOf("x | y");
			const edit = formatMarkdownTableSource(source, {
				direction: "none",
				end: position,
				start: position,
			});
			expect(edit?.value).toBe(
				[
					"before",
					"",
					`${spaces}| A   | B   |`,
					`${spaces}| --- | --- |`,
					`${spaces}| x   | y   |`,
					"",
					"after",
				].join("\n"),
			);
			expect(edit?.changes?.from).toBe(source.indexOf(`${spaces}| A`));
		}

		// Four spaces or a tab is indented code, with or without a leading
		// pipe, including where the paragraph-to-table promotion is reached.
		const codeShapes = [
			"    | A | B |\n    | --- | --- |\n    | x | y |",
			"    A | B\n    --- | ---\n    x | y",
			"\t| A | B |\n\t| --- | --- |\n\t| x | y |",
			"\tA | B\n\t--- | ---\n\tx | y",
			// The paragraph-fallback promotion path, which the parser reports
			// as a paragraph rather than a code block.
			"p\n    | A | B |\n    | --- | --- |\n    | x | y |",
			"p\n    A | B\n    --- | ---\n    x | y",
			"p\n\tA | B\n\t--- | ---\n\tx | y",
		];
		for (const shape of codeShapes) {
			const probe = shape.includes("x | y") ? "x | y" : "y";
			const position = shape.indexOf(probe);
			expect(findMarkdownBlock(shape, position)?.kind).not.toBe("table");
			expect(findMarkdownTable(shape, position)).toBeNull();
			expect(
				formatMarkdownTableSource(shape, {
					direction: "none",
					end: position,
					start: position,
				}),
			).toBeNull();
		}
	});

	it("keeps a 0-3 space indented table without a leading pipe in place", () => {
		const source = [
			"before",
			"",
			"  A | B",
			"  --- | ---",
			"  x | y",
			"",
			"after",
		].join("\n");
		const position = source.indexOf("x | y");
		const edit = formatMarkdownTableSource(source, {
			direction: "none",
			end: position,
			start: position,
		});
		expect(edit?.value).toBe(
			[
				"before",
				"",
				"  A   | B  ",
				"  --- | ---",
				"  x   | y  ",
				"",
				"after",
			].join("\n"),
		);
		expect(edit?.value.startsWith("before\n\n  A")).toBe(true);
		expect(edit?.value.endsWith("\n  x   | y  \n\nafter")).toBe(true);
	});

	it("returns an unchanged edit for an aligned table and null for unsupported context", () => {
		const aligned =
			"| A      | URL    |\n| ---    | :---:  |\n| `x\\|y` | [x](u) |";
		const selection = { direction: "none" as const, end: 2, start: 2 };
		expect(formatMarkdownTableSource(aligned, selection)).toEqual({
			selection,
			value: aligned,
		});

		const trailingPipeWhitespace =
			"| A | Longer |   \n| --- | --- |  \n| x | y |  ";
		const trailingEdit = formatMarkdownTableSource(trailingPipeWhitespace, {
			direction: "none",
			end: trailingPipeWhitespace.indexOf("A"),
			start: trailingPipeWhitespace.indexOf("A"),
		});
		expect(trailingEdit?.value).toBe(
			"| A   | Longer |   \n| --- | ---    |  \n| x   | y      |  ",
		);
		expect(trailingEdit?.changes).toEqual({
			from: 0,
			insert: trailingEdit?.value,
			to: trailingPipeWhitespace.length,
		});

		const invalidAnnotation =
			"<!-- easymde-table-align:v1 {bad} -->\n| A | B |\n| --- | --- |\n| 1 | 2 |";
		expect(
			formatMarkdownTableSource(invalidAnnotation, {
				direction: "none",
				end: invalidAnnotation.lastIndexOf("1"),
				start: invalidAnnotation.lastIndexOf("1"),
			}),
		).toBeNull();

		const ambiguous = "| A | B |\n| --- | --- |\n| 1 | 2 |";
		expect(
			formatMarkdownTableSource(ambiguous, {
				direction: "forward",
				end: ambiguous.indexOf("2") + 1,
				start: ambiguous.indexOf("1"),
			}),
		).toBeNull();
	});

	it("matches CommonMark indented leading-pipe body and separator parsing without phantom cells", () => {
		// CommonMark `TableParser::split(\trim($line))` strips the leading `|`
		// after 4+ spaces, leaving only 2 explicit cells for a 3-column header;
		// source table actions must decline instead of inventing a phantom cell 0.
		const shortIndentedBody = "a | b | c\n--- | --- | ---\n    | x\\|z | y";
		const shortPos = shortIndentedBody.indexOf("x\\|z");
		expect(findMarkdownTable(shortIndentedBody, shortPos)).toBeNull();
		expect(
			editMarkdownTable(shortIndentedBody, shortPos, {
				type: "delete-column",
			}),
		).toBeNull();
		expect(
			formatMarkdownTableSource(shortIndentedBody, {
				direction: "none",
				end: shortPos,
				start: shortPos,
			}),
		).toBeNull();

		// Valid 3-cell indented body rows (4 spaces or tab before leading `|`)
		// preserve their leading indentation/pipe across column deletion,
		// left-column insertion, and table formatting.
		const fourSpaceBody = "a | b | c\n--- | --- | ---\n    | x\\|z | y | w";
		const fourSpacePos = fourSpaceBody.indexOf("x\\|z");
		expect(
			editMarkdownTable(fourSpaceBody, fourSpacePos, {
				type: "delete-column",
			})?.value,
		).toBe("| b | c\n| --- | ---\n    | y | w");
		expect(
			editMarkdownTable(fourSpaceBody, fourSpacePos, {
				type: "insert-column-left",
			})?.value,
		).toBe("|  |a | b | c\n| --- |--- | --- | ---\n    |  | x\\|z | y | w");
		const fourSpaceFormatted = formatMarkdownTableSource(fourSpaceBody, {
			direction: "forward",
			end: fourSpacePos + 4,
			start: fourSpacePos,
		});
		expect(fourSpaceFormatted?.value).toBe(
			"a    | b   | c  \n---  | --- | ---\n    | x\\|z | y   | w  ",
		);
		expect(
			fourSpaceFormatted?.value.slice(
				fourSpaceFormatted.selection.start,
				fourSpaceFormatted.selection.end,
			),
		).toBe("x\\|z");

		const tabBody = "a | b | c\n--- | --- | ---\n\t| x | y | z";
		const tabPos = tabBody.indexOf("x");
		expect(
			editMarkdownTable(tabBody, tabPos, { type: "delete-column" })?.value,
		).toBe("| b | c\n| --- | ---\n\t| y | z");
		expect(
			formatMarkdownTableSource(tabBody, {
				direction: "none",
				end: tabPos,
				start: tabPos,
			})?.value,
		).toBe("a   | b   | c  \n--- | --- | ---\n\t| x   | y   | z  ");

		// PHP `League\CommonMark` `TableStartParser::parseSeparator()` admits
		// 4-space/tab-indented separator rows once a 0-3 space header opens a
		// paragraph, while rejecting code-indented headers and NBSP delimiters.
		const indentedOuterlessSep = "a | b\n    --- | ---\n    1 | 2";
		expect(findMarkdownTable(indentedOuterlessSep, 0)).toMatchObject({
			columnCount: 2,
			rowCount: 2,
		});
		expect(
			editMarkdownTable(indentedOuterlessSep, 0, {
				type: "delete-column",
			})?.value,
		).toBe("| b\n    | ---\n    | 2");

		const indentedPipedSep = "| a | b |\n    | --- | --- |\n    | 1 | 2 |";
		expect(findMarkdownTable(indentedPipedSep, 2)).toMatchObject({
			columnCount: 2,
			rowCount: 2,
		});
		expect(
			editMarkdownTable(indentedPipedSep, 2, {
				type: "delete-column",
			})?.value,
		).toBe("| b |\n    | --- |\n    | 2 |");
		expect(
			formatMarkdownTableSource(indentedPipedSep, {
				direction: "none",
				end: 2,
				start: 2,
			})?.value,
		).toBe("| a   | b   |\n    | --- | --- |\n    | 1   | 2   |");

		const tabPipedSep = "| a | b |\n\t| --- | --- |\n\t| 1 | 2 |";
		expect(findMarkdownTable(tabPipedSep, 2)).toMatchObject({
			columnCount: 2,
			rowCount: 2,
		});

		for (const nonTable of [
			"    a | b\n--- | ---",
			"\ta | b\n--- | ---",
			"a | b\n\u00a0--- | ---",
		]) {
			expect(findMarkdownTable(nonTable, 0), nonTable).toBeNull();
		}
	});

	it("declines unsafe CommonMark pipe continuation rows instead of truncating the table", () => {
		const unsafeCases = [
			{
				name: "indented separator/body followed by standalone pipe",
				probes: ["A", "1", "3"],
				source: "| A | B |\n    | --- | --- |\n    | 1 | 2 |\n|\n| 3 | 4 |",
			},
			{
				name: "non-indented table followed by standalone pipe",
				probes: ["A", "1", "3"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\n|\n| 3 | 4 |",
			},
			{
				name: "table followed by whitespace-padded standalone pipe",
				probes: ["A", "1", "3"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\n   |   \n| 3 | 4 |",
			},
			{
				name: "table followed by escaped pipe only",
				probes: ["A", "1", "3"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\n\\|\n| 3 | 4 |",
			},
			{
				name: "table followed by text with escaped pipe only",
				probes: ["A", "1", "3"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\nfoo\\|bar\n| 3 | 4 |",
			},
			{
				name: "bodyless table followed immediately by standalone pipe",
				probes: ["A", "---"],
				source: "| A | B |\n| --- | --- |\n|",
			},
			{
				name: "single-column table followed by escaped pipe continuation",
				probes: ["A", "1"],
				source: "| A |\n| --- |\n| 1 |\nfoo\\|bar",
			},
		] as const;

		for (const testCase of unsafeCases) {
			for (const probe of testCase.probes) {
				const position = testCase.source.indexOf(probe);
				expect(position, `${testCase.name} (${probe})`).toBeGreaterThanOrEqual(
					0,
				);
				expect(
					prepareMarkdownTable(testCase.source, position),
					`${testCase.name} prepareMarkdownTable (${probe})`,
				).toBeNull();
				expect(
					editMarkdownTable(testCase.source, position, {
						type: "delete-table",
					}),
					`${testCase.name} delete-table (${probe})`,
				).toBeNull();
				expect(
					editMarkdownTable(testCase.source, position, {
						type: "copy-table",
					}),
					`${testCase.name} copy-table (${probe})`,
				).toBeNull();
				expect(
					editMarkdownTable(testCase.source, position, {
						type: "insert-column-left",
					}),
					`${testCase.name} insert-column-left (${probe})`,
				).toBeNull();
				expect(
					formatMarkdownTableSource(testCase.source, {
						direction: "none",
						end: position,
						start: position,
					}),
					`${testCase.name} formatMarkdownTableSource (${probe})`,
				).toBeNull();
			}
		}

		// Control: a blank line terminates the table cleanly in CommonMark even
		// when the next block contains pipes.
		const blankSeparated = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| 3 | 4 |";
		const controlPos = blankSeparated.indexOf("1");
		expect(prepareMarkdownTable(blankSeparated, controlPos)).not.toBeNull();
		expect(
			editMarkdownTable(blankSeparated, controlPos, { type: "copy-table" })
				?.copiedText,
		).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
		expect(
			editMarkdownTable(blankSeparated, controlPos, { type: "delete-table" })
				?.value,
		).toBe("\n\n| 3 | 4 |");
		expect(
			editMarkdownTable(blankSeparated, controlPos, {
				type: "insert-column-left",
			})?.value,
		).toBe("|  | A | B |\n| --- | --- | --- |\n|  | 1 | 2 |\n\n| 3 | 4 |");
		expect(
			formatMarkdownTableSource(blankSeparated, {
				direction: "none",
				end: controlPos,
				start: controlPos,
			})?.value,
		).toBe("| A   | B   |\n| --- | --- |\n| 1   | 2   |\n\n| 3 | 4 |");
	});

	it("matches installed League\\CommonMark table-interruption rules across block constructs", () => {
		const interruptingLines = [
			"# Heading",
			"### Heading",
			"###### Heading",
			"#",
			"# ",
			"#\tHeading",
			"   # Heading",
			"> quote",
			">",
			"   >quote",
			"```",
			"```js",
			"~~~",
			"~~~js~foo",
			"   ```js",
			"---",
			"***",
			"___",
			" - - - ",
			"-\t-\t-",
			"   ---",
			"- item",
			"* item",
			"+ item",
			"- ",
			"-",
			"*",
			"+",
			"-\titem",
			"1. item",
			"2. item",
			"0. item",
			"1) item",
			"2) item",
			"1.",
			"2.",
			"999999999. item",
			"1.\titem",
			"<style>",
			"<style ",
			"<style\t",
			"<style\v",
			"<style\f",
			"<style",
			"<STYLE>",
			"<pre>code</pre>",
			"<script>",
			"<textarea>",
			"<!-- comment -->",
			"<!--",
			"<?php ?>",
			"<?",
			"<!DOCTYPE html>",
			"<!doctype html>",
			"<!a",
			"<![CDATA[x]]>",
			"<![cdata[",
			"<div>",
			"<div",
			"<div ",
			"<div/>",
			"</div>",
			"</div",
			"</div/>",
			"<source>",
			"<p>hi</p>",
			"<h1>",
			"<h6>",
			"    indented",
			"\tindented",
			" \tindented",
			"   \tindented",
			"    \v",
		];
		for (const line of interruptingLines) {
			expect(lineInterruptsCommonMarkTable(line), JSON.stringify(line)).toBe(
				true,
			);
		}

		const nonInterruptingLines = [
			"",
			"   ",
			"\t",
			"\u00a0",
			"\v",
			"\f",
			"plain",
			"   plain",
			"[foo]: /bar",
			"===",
			"=",
			"####### Heading",
			"#Heading",
			"#\vHeading",
			"#\u00a0Heading",
			"```js`foo",
			"``` `",
			"``",
			"--",
			"-*-",
			"--- a",
			"---\v",
			"---\f",
			"-item",
			"-\f",
			"1.item",
			"1.\f",
			"1000000000. item",
			"<span>hi</span>",
			"<span>",
			"</span>",
			"<custom-el>",
			"<search>",
			"<h7>",
			"</style>",
			"<style/>",
			"<style/",
			"<div/",
			"<div\u00a0>",
			"<\u017ftyle>",
			"<trac\u212a>",
			"<!\u212a>",
			"<!1",
			"# Heading | Pipe",
			"> quote | pipe",
			"```js | pipe",
			"- item | pipe",
			"1. item | pipe",
			"<div>a|b</div>",
			"    indented | pipe",
			"--- | ---",
		];
		for (const line of nonInterruptingLines) {
			expect(lineInterruptsCommonMarkTable(line), JSON.stringify(line)).toBe(
				false,
			);
		}
	});

	it("declines non-pipe lazy table continuations and Lezer/PHP boundary disagreements while preserving valid interrupting blocks", () => {
		const declinedCases = [
			{
				name: "table continued by plain line and subsequent pipe row",
				probes: ["A", "1", "3"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\nplain\n| 3 | 4 |",
			},
			{
				name: "table continued by plain line and table-shaped rows stays one declined table",
				probes: ["A", "1", "C", "3"],
				source:
					"| A | B |\n| --- | --- |\n| 1 | 2 |\nplain\n| C | D |\n| --- | --- |\n| 3 | 4 |",
			},
			{
				name: "table followed immediately by plain text",
				probes: ["A", "1"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\nplain text",
			},
			{
				name: "bodyless table followed immediately by plain text",
				probes: ["A", "---"],
				source: "| A | B |\n| --- | --- |\nplain text",
			},
			{
				name: "table followed immediately by HTML Type 7 span",
				probes: ["A", "1"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\n<span>hi</span>",
			},
			{
				name: "table followed immediately by link reference definition",
				probes: ["A", "1"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\n[foo]: /bar",
			},
			{
				name: "table followed immediately by 4-space indented line (Lezer absorbs into Table)",
				probes: ["A", "1"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\n    indented",
			},
			{
				name: "table followed immediately by tab indented line (Lezer absorbs into Table)",
				probes: ["A", "1"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\n\tindented",
			},
			{
				name: "table followed immediately by ordered list starting at 2 (Lezer absorbs into Table)",
				probes: ["A", "1"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\n2. ordered",
			},
			{
				name: "table followed immediately by <search> (absorbed by installed league/commonmark)",
				probes: ["A", "1"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\n<search>",
			},
			{
				name: "table followed immediately by setext underline",
				probes: ["A", "1"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\n===",
			},
			{
				name: "table followed immediately by ATX heading containing raw pipe",
				probes: ["A", "1"],
				source: "| A | B |\n| --- | --- |\n| 1 | 2 |\n# Heading | Pipe",
			},
		] as const;

		for (const testCase of declinedCases) {
			for (const probe of testCase.probes) {
				const position = testCase.source.indexOf(probe);
				expect(position, `${testCase.name} (${probe})`).toBeGreaterThanOrEqual(
					0,
				);
				expect(
					prepareMarkdownTable(testCase.source, position),
					`${testCase.name} prepareMarkdownTable (${probe})`,
				).toBeNull();
				expect(
					editMarkdownTable(testCase.source, position, {
						type: "delete-table",
					}),
					`${testCase.name} delete-table (${probe})`,
				).toBeNull();
				expect(
					editMarkdownTable(testCase.source, position, {
						type: "copy-table",
					}),
					`${testCase.name} copy-table (${probe})`,
				).toBeNull();
				expect(
					editMarkdownTable(testCase.source, position, {
						type: "delete-column",
					}),
					`${testCase.name} delete-column (${probe})`,
				).toBeNull();
				expect(
					formatMarkdownTableSource(testCase.source, {
						direction: "none",
						end: position,
						start: position,
					}),
					`${testCase.name} formatMarkdownTableSource (${probe})`,
				).toBeNull();
			}
		}

		// Positive controls: genuine PHP & Lezer table-interrupting blocks with
		// zero blank line leave the table cleanly editable without touching the
		// following block. (Note: bare `---` directly after a table interrupts
		// PHP `TableParser` as a thematic break, verified above via
		// `lineInterruptsCommonMarkTable("---")`, while Lezer parses `| 1 | 2 |\n---`
		// as `SetextHeading2`; `***`, `___`, and `- - -` remain `HorizontalRule`.)
		const positiveInterruptors = [
			"# Heading",
			"### Heading",
			"> quote",
			"```js",
			"~~~",
			"- item",
			"* item",
			"+ item",
			"1. item",
			"***",
			"___",
			"- - -",
			"<div>",
			"<style>",
			"<!-- comment -->",
			"<?php ?>",
			"<!DOCTYPE html>",
			"<![CDATA[x]]>",
		];
		const baseTable = "| A | B |\n| --- | --- |\n| 1 | 2 |";
		for (const followingLine of positiveInterruptors) {
			const source = `${baseTable}\n${followingLine}`;
			const position = source.indexOf("1");
			const prepared = prepareMarkdownTable(source, position);
			expect(prepared, followingLine).not.toBeNull();
			expect(prepared?.table.endLine, followingLine).toBe(2);
			expect(
				editMarkdownTable(source, position, { type: "copy-table" })?.copiedText,
				`${followingLine} copy-table`,
			).toBe(baseTable);
			expect(
				editMarkdownTable(source, position, { type: "delete-table" })?.value,
				`${followingLine} delete-table`,
			).toBe(`\n${followingLine}`);
			expect(
				editMarkdownTable(source, position, { type: "delete-column" })?.value,
				`${followingLine} delete-column`,
			).toBe(`| B |\n| --- |\n| 2 |\n${followingLine}`);
			expect(
				formatMarkdownTableSource(source, {
					direction: "none",
					end: position,
					start: position,
				})?.value,
				`${followingLine} formatMarkdownTableSource`,
			).toBe(`| A   | B   |\n| --- | --- |\n| 1   | 2   |\n${followingLine}`);
		}

		// Blank lines (empty, spaces-only, tab-only) and bodyless tables followed
		// by interrupting blocks also stay cleanly editable.
		for (const blankLine of ["", "   ", "\t"]) {
			const source = `${baseTable}\n${blankLine}\nplain`;
			expect(
				prepareMarkdownTable(source, source.indexOf("1"))?.table.endLine,
				JSON.stringify(blankLine),
			).toBe(2);
		}
		const bodylessInterrupted = "| A | B |\n| --- | --- |\n# Heading";
		expect(
			prepareMarkdownTable(bodylessInterrupted, bodylessInterrupted.indexOf("A"))
				?.table.endLine,
		).toBe(1);
	});

	it("keeps NBSP-prefixed comments absent and flags whitespace-blank-separated markers as orphan", () => {
		const nbspBefore =
			'\u00a0<!-- easymde-table-align:v1 [[0,"center"]] -->\n| A | B |\n| - | - |';
		const nbspPrepared = prepareMarkdownTable(
			nbspBefore,
			nbspBefore.indexOf("| A"),
		);
		expect(nbspPrepared?.context.annotationRead).toEqual({
			annotation: null,
			status: "absent",
		});
		expect(nbspPrepared?.context.annotation.ownedPrefixRange).toBeUndefined();

		for (const blankLine of ["    ", "\t", "  \t  "]) {
			const orphan = `<!-- easymde-table-align:v1 [[0,"center"]] -->\n${blankLine}\n| A | B |\n| - | - |`;
			const tablePos = orphan.indexOf("| A");
			expect(
				prepareMarkdownTable(orphan, tablePos)?.context.annotationRead,
				JSON.stringify(blankLine),
			).toEqual({
				code: "table-alignment-annotation-marker-orphan",
				status: "invalid",
			});
			expect(
				setMarkdownTableAlignment(orphan, tablePos, {
					alignment: "right",
					selection: { column: 0, kind: "column" },
				}),
				JSON.stringify(blankLine),
			).toEqual({
				code: "table-alignment-annotation-marker-orphan",
				status: "unsupported",
			});
		}
	});

	it("falls back to compact formatting when aligned padding would exceed the 1 MiB preview UTF-8 budget", () => {
		const previewMaxBytes = 1_048_576;
		const encoder = new TextEncoder();
		const wideHeader = "h".repeat(2048);
		const bodyRows = Array.from({ length: 600 }, (_, index) =>
			index === 299 ? "|  target  |  y  |" : "|x|y|",
		);
		const source = [`|${wideHeader}|B|`, "|---|---|", ...bodyRows].join("\n");
		expect(encoder.encode(source).byteLength).toBeLessThan(10_000);

		const selectionStart = source.indexOf("target");
		const selectionEnd = selectionStart + "target".length;
		const edit = formatMarkdownTableSource(source, {
			direction: "backward",
			end: selectionEnd,
			start: selectionStart,
		});

		expect(edit).not.toBeNull();
		const formatted = edit?.value ?? "";
		expect(encoder.encode(formatted).byteLength).toBeLessThanOrEqual(
			previewMaxBytes,
		);
		expect(encoder.encode(formatted).byteLength).toBeLessThan(10_000);

		const formattedLines = formatted.split("\n");
		expect(formattedLines).toHaveLength(602);
		expect(formattedLines[0]).toBe(`| ${wideHeader} | B |`);
		expect(formattedLines[1]).toBe("| --- | --- |");
		expect(formattedLines[2]).toBe("| x | y |");
		expect(formattedLines[301]).toBe("| target | y |");
		expect(edit?.selection.direction).toBe("backward");
		expect(
			formatted.slice(edit?.selection.start ?? 0, edit?.selection.end ?? 0),
		).toBe("target");
		expect(findMarkdownTable(formatted, edit?.selection.start ?? 0)).toMatchObject({
			columnCount: 2,
			rowCount: 601,
		});
		if (edit) {
			expect(formatMarkdownTableSource(formatted, edit.selection)).toEqual({
				selection: edit.selection,
				value: formatted,
			});
		}

		// Compact mode also preserves escaped trailing spaces and omitted outer pipes.
		const outerlessRows = Array.from({ length: 600 }, (_, index) =>
			index === 0 ? "  value\\  |  y" : "  x  |  y",
		);
		const outerlessSource = [
			`  ${wideHeader} | B`,
			"  --- | ---",
			...outerlessRows,
		].join("\n");
		const valuePos = outerlessSource.indexOf("value\\");
		const outerlessEdit = formatMarkdownTableSource(outerlessSource, {
			direction: "none",
			end: valuePos + "value\\".length,
			start: valuePos,
		});
		expect(outerlessEdit).not.toBeNull();
		const outerlessFormatted = outerlessEdit?.value ?? "";
		expect(encoder.encode(outerlessFormatted).byteLength).toBeLessThan(12_000);
		const outerlessLines = outerlessFormatted.split("\n");
		expect(outerlessLines[0]).toBe(`  ${wideHeader} | B`);
		expect(outerlessLines[2]).toBe("  value\\  | y");
		expect(outerlessLines[3]).toBe("  x | y");
		expect(
			outerlessFormatted.slice(
				outerlessEdit?.selection.start ?? 0,
				outerlessEdit?.selection.end ?? 0,
			),
		).toBe("value\\");
	});

	it("keeps full column-aligned padding for wide-header or long tables within the 1 MiB UTF-8 budget", () => {
		const previewMaxBytes = 1_048_576;
		const encoder = new TextEncoder();

		// Control 1: 2,048-character header with 5 body rows fits easily within 1 MiB.
		const wideHeader = "h".repeat(2048);
		const shortWideSource = [
			`| ${wideHeader} | B |`,
			"| --- | --- |",
			...Array.from({ length: 5 }, () => "| x | y |"),
		].join("\n");
		const shortWidePosition = shortWideSource.lastIndexOf("x");
		const shortWideEdit = formatMarkdownTableSource(shortWideSource, {
			direction: "none",
			end: shortWidePosition,
			start: shortWidePosition,
		});
		expect(shortWideEdit).not.toBeNull();
		const shortWideLines = (shortWideEdit?.value ?? "").split("\n");
		expect(
			encoder.encode(shortWideEdit?.value ?? "").byteLength,
		).toBeLessThanOrEqual(previewMaxBytes);
		expect(shortWideLines[2]).toBe(`| x${" ".repeat(2047)} | y   |`);

		// Control 2: 600 body rows with a 32-character header fits easily within 1 MiB.
		const moderateHeader = "h".repeat(32);
		const tallModerateSource = [
			`| ${moderateHeader} | B |`,
			"| --- | --- |",
			...Array.from({ length: 600 }, () => "| x | y |"),
		].join("\n");
		const tallModeratePosition = tallModerateSource.lastIndexOf("x");
		const tallModerateEdit = formatMarkdownTableSource(tallModerateSource, {
			direction: "none",
			end: tallModeratePosition,
			start: tallModeratePosition,
		});
		expect(tallModerateEdit).not.toBeNull();
		const tallModerateLines = (tallModerateEdit?.value ?? "").split("\n");
		expect(
			encoder.encode(tallModerateEdit?.value ?? "").byteLength,
		).toBeLessThanOrEqual(previewMaxBytes);
		expect(tallModerateLines[2]).toBe(`| x${" ".repeat(31)} | y   |`);
	});

	it("counts multi-byte UTF-8 surrounding CJK and emoji text accurately against the 1 MiB budget", () => {
		const previewMaxBytes = 1_048_576;
		const encoder = new TextEncoder();
		// 348,000 CJK chars (3 UTF-8 bytes each) + 1,000 emoji (4 UTF-8 bytes, 2 UTF-16 units each)
		// = 1,048,000 UTF-8 bytes while staying at only 350,000 UTF-16 code units.
		const multibytePrefix = `${"中".repeat(348_000)}${"😀".repeat(1_000)}\n\n`;
		const wideHeader = "w".repeat(120);
		const table = [
			`|${wideHeader}|B|`,
			"|---|---|",
			...Array.from({ length: 10 }, () => "|x|y|"),
		].join("\n");
		const source = `${multibytePrefix}${table}`;

		const prefixBytes = encoder.encode(multibytePrefix).byteLength;
		expect(prefixBytes).toBe(1_048_002);
		// Aligned table alone would be 12 * (120 + 10) + 11 = 1,571 bytes -> 1,049,573 UTF-8 bytes (> 1 MiB),
		// even though UTF-16 .length stays well below 400,000!
		const position = source.lastIndexOf("x");
		const edit = formatMarkdownTableSource(source, {
			direction: "none",
			end: position + 1,
			start: position,
		});

		expect(edit).not.toBeNull();
		const formatted = edit?.value ?? "";
		expect(formatted.length).toBeLessThan(previewMaxBytes);
		expect(encoder.encode(formatted).byteLength).toBeLessThanOrEqual(
			previewMaxBytes,
		);
		const formattedTable = formatted.slice(multibytePrefix.length);
		const formattedLines = formattedTable.split("\n");
		expect(formattedLines[0]).toBe(`| ${wideHeader} | B |`);
		expect(formattedLines[2]).toBe("| x | y |");
		expect(
			formatted.slice(edit?.selection.start ?? 0, edit?.selection.end ?? 0),
		).toBe("x");
	});

	it("returns null without mutating Markdown when even compact formatting exceeds the 1 MiB UTF-8 budget", () => {
		const previewMaxBytes = 1_048_576;
		const encoder = new TextEncoder();
		const denseTable = "|a|b|\n|-|-|\n|1|2|";
		const compactTable = "| a | b |\n| - | - |\n| 1 | 2 |";
		const denseBytes = encoder.encode(denseTable).byteLength;
		const compactBytes = encoder.encode(compactTable).byteLength;

		// Input fits within 1 MiB (1,048,576 bytes), but compact normalization adds 12 bytes -> 1,048,588 (> 1 MiB).
		const overBudgetPrefix = `${"p".repeat(previewMaxBytes - denseBytes - 2)}\n\n`;
		const overBudgetSource = `${overBudgetPrefix}${denseTable}`;
		expect(encoder.encode(overBudgetSource).byteLength).toBe(previewMaxBytes);
		const overBudgetPosition = overBudgetSource.lastIndexOf("1");
		expect(
			formatMarkdownTableSource(overBudgetSource, {
				direction: "none",
				end: overBudgetPosition,
				start: overBudgetPosition,
			}),
		).toBeNull();

		// Exact 1 MiB boundary succeeds when compact output lands at 1,048,576 UTF-8 bytes.
		const exactBudgetPrefix = `${"p".repeat(previewMaxBytes - compactBytes - 2)}\n\n`;
		const exactBudgetSource = `${exactBudgetPrefix}${denseTable}`;
		const exactPosition = exactBudgetSource.lastIndexOf("1");
		const exactEdit = formatMarkdownTableSource(exactBudgetSource, {
			direction: "none",
			end: exactPosition,
			start: exactPosition,
		});
		expect(exactEdit).not.toBeNull();
		expect(encoder.encode(exactEdit?.value ?? "").byteLength).toBe(
			previewMaxBytes,
		);
		expect(exactEdit?.value.endsWith(compactTable)).toBe(true);

		// Already over-budget surrounding content also returns null without mutation.
		const alreadyOverPrefix = `${"中".repeat(349_526)}\n\n`;
		expect(encoder.encode(alreadyOverPrefix).byteLength).toBeGreaterThan(
			previewMaxBytes,
		);
		const alreadyOverSource = `${alreadyOverPrefix}${denseTable}`;
		const alreadyOverPosition = alreadyOverSource.lastIndexOf("1");
		expect(
			formatMarkdownTableSource(alreadyOverSource, {
				direction: "none",
				end: alreadyOverPosition,
				start: alreadyOverPosition,
			}),
		).toBeNull();
	});

	it("keeps the table delimiter directly after the header for every row insertion context", () => {
		const source = "| H |\n| --- |\n| D |";
		const headerBelow = editMarkdownTable(source, source.indexOf("H"), {
			type: "insert-row-below",
		});
		const separatorBelow = editMarkdownTable(source, source.indexOf("---"), {
			type: "insert-row-below",
		});
		const dataAbove = editMarkdownTable(source, source.indexOf("D"), {
			type: "insert-row-above",
		});
		const dataBelow = editMarkdownTable(source, source.indexOf("D"), {
			type: "insert-row-below",
		});

		expect(headerBelow?.value).toBe("| H |\n| --- |\n|  |\n| D |");
		expect(separatorBelow?.value).toBe("| H |\n| --- |\n|  |\n| D |");
		expect(dataAbove?.value).toBe("| H |\n| --- |\n|  |\n| D |");
		expect(dataBelow?.value).toBe("| H |\n| --- |\n| D |\n|  |");
	});

	it("keeps an EOF delimiter on its own line when inserting into a bodyless table", () => {
		const source = "| A | B |\n| - | - |";
		const headerAbove = editMarkdownTable(source, source.indexOf("A"), {
			type: "insert-row-above",
		});
		const headerBelow = editMarkdownTable(source, source.indexOf("A"), {
			type: "insert-row-below",
		});
		const delimiterAbove = editMarkdownTable(source, source.indexOf("-"), {
			type: "insert-row-above",
		});
		const delimiterBelow = editMarkdownTable(source, source.lastIndexOf("-"), {
			type: "insert-row-below",
		});

		expect(headerAbove?.value).toBe("| A | B |\n| - | - |\n|  |  |");
		expect(headerBelow?.value).toBe("| A | B |\n| - | - |\n|  |  |");
		expect(delimiterAbove?.value).toBe("| A | B |\n| - | - |\n|  |  |");
		expect(delimiterBelow?.value).toBe("| A | B |\n| - | - |\n|  |  |");
	});

	it("deletes only the selected middle table column separator", () => {
		const source = "| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |";
		const edit = editMarkdownTable(source, source.indexOf("B"), {
			type: "delete-column",
		});

		expect(edit?.value).toBe("| A | C |\n| --- | --- |\n| 1 | 3 |");
	});

	it("does not treat table-shaped code-fence content as an editable table", () => {
		const source = "```md\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```";
		const position = source.indexOf("A | B");

		expect(
			editMarkdownTable(source, position, { type: "copy-table" }),
		).toBeNull();
		expect(
			editMarkdownTable(source, position, { type: "delete-column" }),
		).toBeNull();
	});

	it("copies a table using parsed cells rather than pipe matching", () => {
		const source = "| Name|Value |\n|---|:---:|\n| A\\|B | `code\\|x` |";
		const position = source.indexOf("Value");
		const copied = editMarkdownTable(source, position, { type: "copy-table" });

		expect(copied?.copiedText).toBe(
			"| Name|Value |\n|---|:---:|\n| A\\|B | `code\\|x` |",
		);
	});

	it("follows the formal GFM delimiter and row-shape boundary conservatively", () => {
		const oneDash = "| A | B |\n| - | -- |\n| 1 | 2 |";
		const edgeWhitespace = "  A | B  \n  --- | ---  \n  1 | 2  ";
		const shortBody = "| A | B |\n| - | - |\n| 1 |";
		const longBody = "| A | B |\n| - | - |\n| 1 | 2 | 3 |";

		expect(
			editMarkdownTable(oneDash, oneDash.indexOf("A"), { type: "copy-table" })
				?.copiedText,
		).toBe(oneDash);
		expect(
			editMarkdownTable(edgeWhitespace, edgeWhitespace.indexOf("A"), {
				type: "copy-table",
			})?.copiedText,
		).toBe(edgeWhitespace);
		expect(
			editMarkdownTable(shortBody, shortBody.indexOf("1"), {
				type: "delete-row",
			}),
		).toBeNull();
		expect(
			editMarkdownTable(shortBody, shortBody.indexOf("A"), {
				type: "copy-table",
			}),
		).toBeNull();
		expect(
			editMarkdownTable(longBody, longBody.indexOf("2"), {
				type: "delete-row",
			}),
		).toBeNull();
		expect(
			editMarkdownTable(longBody, longBody.indexOf("A"), {
				type: "copy-table",
			}),
		).toBeNull();
	});

	it("rejects an unescaped pipe inside inline code instead of mis-targeting a table", () => {
		const source = "| A | B |\n| - | - |\n| `x|y` | 2 |";
		expect(
			editMarkdownTable(source, source.indexOf("x|y"), { type: "copy-table" }),
		).toBeNull();
	});

	it("applies GFM alignment to a whole table or selected columns and annotates rows", () => {
		const source = "| Name | Value |\n| --- | --- |\n| A | B |";
		const wholeTable = setMarkdownTableAlignment(
			source,
			source.indexOf("Name"),
			{
				alignment: "center",
				selection: { columnCount: 2, kind: "whole-table" },
			},
		);
		expect(wholeTable).toMatchObject({
			value: "| Name | Value |\n| :---: | :---: |\n| A | B |",
		});

		const selectedColumn = setMarkdownTableAlignment(
			source,
			source.indexOf("Value"),
			{
				alignment: "right",
				selection: { column: 1, kind: "column" },
			},
		);
		expect(selectedColumn).toMatchObject({
			value: "| Name | Value |\n| --- | ---: |\n| A | B |",
		});

		const row = setMarkdownTableAlignment(source, source.indexOf("A"), {
			alignment: "center",
			selection: { columnCount: 2, kind: "row", row: 2 },
		});
		expect(row).toMatchObject({
			value:
				'<!-- easymde-table-align:v1 [[1,"center"]] -->\n| Name | Value |\n| --- | --- |\n| A | B |',
		});
	});

	it("keeps bare GFM alignment implicit until an explicit alignment action", () => {
		const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
		const table = findMarkdownTable(source, source.indexOf("1"));
		expect(table?.baseAlignments).toEqual([null, null]);

		const rowLeft = setMarkdownTableAlignment(source, source.indexOf("A"), {
			alignment: "left",
			selection: { columnCount: 2, kind: "row", row: 0 },
		});
		expect(rowLeft).toMatchObject({
			value:
				'<!-- easymde-table-align:v1 [[0,"left"]] -->\n| A | B |\n| --- | --- |\n| 1 | 2 |',
		});
		if ("status" in rowLeft)
			throw new Error("table-alignment-unexpectedly-unsupported");
		const rowAgain = setMarkdownTableAlignment(
			rowLeft.value,
			rowLeft.selection.start,
			{
				alignment: "left",
				selection: { columnCount: 2, kind: "row", row: 0 },
			},
		);
		expect(rowAgain).toMatchObject({ value: rowLeft.value });
		if ("status" in rowAgain)
			throw new Error("table-alignment-unexpectedly-unsupported");
		expect(rowAgain.changes).toBeUndefined();

		const inserted = editMarkdownTable(source, source.indexOf("B"), {
			type: "insert-column-left",
		});
		expect(inserted?.value).toBe(
			"| A |  | B |\n| --- | --- | --- |\n| 1 |  | 2 |",
		);

		const explicitColumn = setMarkdownTableAlignment(
			source,
			source.indexOf("A"),
			{
				alignment: "left",
				selection: { column: 0, kind: "column" },
			},
		);
		expect(explicitColumn).toMatchObject({
			value: "| A | B |\n| :--- | --- |\n| 1 | 2 |",
		});

		const explicitWhole = setMarkdownTableAlignment(
			source,
			source.indexOf("A"),
			{
				alignment: "left",
				selection: { columnCount: 2, kind: "whole-table" },
			},
		);
		expect(explicitWhole).toMatchObject({
			value: "| A | B |\n| :--- | :--- |\n| 1 | 2 |",
		});
	});

	it("preserves a cell exception when column one is the last alignment action", () => {
		const source =
			'<!-- easymde-table-align:v1 [[1,"left"],[1,0,"center"]] -->\n| A | B |\n| :--- | ---: |\n| 1 | 2 |';
		const result = setMarkdownTableAlignment(source, source.lastIndexOf("2"), {
			alignment: "left",
			selection: { column: 1, kind: "column" },
		});
		expect(result).toMatchObject({
			value:
				'<!-- easymde-table-align:v1 [[1,"left"],[1,0,"center"]] -->\n| A | B |\n| :--- | :--- |\n| 1 | 2 |',
		});
	});

	it("does not inherit a marker from an earlier table across a blank line", () => {
		const source =
			'<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| C | D |\n| --- | --- |\n| 3 | 4 |';
		const secondTable = findMarkdownTable(source, source.lastIndexOf("4"));
		expect(secondTable?.annotationRead).toEqual({
			annotation: null,
			status: "absent",
		});
		const result = setMarkdownTableAlignment(source, source.lastIndexOf("4"), {
			alignment: "right",
			selection: { column: 1, kind: "column" },
		});
		expect(result).toMatchObject({
			value:
				'<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| C | D |\n| --- | ---: |\n| 3 | 4 |',
		});
	});

	it("ignores marker-looking comments inside fenced code before a real table", () => {
		const source =
			'```md\n<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```\n\n| C | D |\n| --- | --- |\n| 3 | 4 |';
		const result = setMarkdownTableAlignment(source, source.lastIndexOf("4"), {
			alignment: "right",
			selection: { column: 1, kind: "column" },
		});
		expect(result).toMatchObject({
			value:
				'```md\n<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```\n\n| C | D |\n| --- | ---: |\n| 3 | 4 |',
		});
	});

	it("derives column, whole-table, and row selection identity from source ranges", () => {
		const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
		expect(
			tableSelectionAt(source, {
				direction: "none",
				start: source.indexOf("1"),
				end: source.indexOf("1"),
			}),
		).toEqual({
			canDeleteColumn: true,
			canDeleteRow: true,
			column: 0,
			columnCount: 2,
			kind: "column",
			rowIndex: 2,
		});
		const rowStart = source.lastIndexOf("| 1");
		expect(
			tableSelectionAt(source, {
				direction: "forward",
				start: rowStart,
				end: source.length,
			}),
		).toEqual({
			canDeleteColumn: false,
			canDeleteRow: true,
			columnCount: 2,
			kind: "row",
			row: 2,
			rowIndex: 2,
		});
		expect(
			tableSelectionAt(source, {
				direction: "forward",
				start: 0,
				end: source.length,
			}),
		).toEqual({
			canDeleteColumn: false,
			canDeleteRow: false,
			columnCount: 2,
			kind: "whole-table",
		});
		expect(
			setMarkdownTableAlignment(source, rowStart, {
				alignment: "center",
				selection: { columnCount: 2, kind: "row", row: 2 },
			}),
		).toMatchObject({
			value:
				'<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A | B |\n| --- | --- |\n| 1 | 2 |',
		});
	});

	it("rejects table selections that cross into a following owner while allowing the table end", () => {
		const source = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\nTail";
		const tableEnd = source.indexOf("\n\nTail");

		expect(
			tableSelectionAt(source, {
				direction: "forward",
				end: source.length,
				start: 0,
			}),
		).toBeUndefined();
		expect(
			tableSelectionAt(source, {
				direction: "backward",
				end: source.length,
				start: 0,
			}),
		).toBeUndefined();
		expect(
			tableSelectionAt(source, {
				direction: "forward",
				end: tableEnd,
				start: 0,
			}),
		).toMatchObject({ kind: "whole-table" });
	});

	it("uses context-owner selection containment with a valid half-open range", () => {
		expect(
			editorContextSelectionFitsRange(
				{ direction: "none", end: 90, start: 90 },
				{ from: 10, to: 20 },
			),
		).toBe(true);
		expect(
			editorContextSelectionFitsRange(
				{ direction: "forward", end: 20, start: 10 },
				{ from: 10, to: 20 },
			),
		).toBe(true);
		expect(
			editorContextSelectionFitsRange(
				{ direction: "backward", end: 21, start: 10 },
				{ from: 10, to: 20 },
			),
		).toBe(false);
		expect(
			editorContextSelectionFitsRange(
				{ direction: "none", end: 90, start: 90 },
				{ from: 20, to: 10 },
			),
		).toBe(false);
	});

	it("retains column identity inside nested inline-code table content", () => {
		const source = "| Name | Value |\n| --- | --- |\n| A\\|B | `code\\|x` |";
		const position = source.indexOf("code");

		expect(
			tableSelectionAt(source, {
				direction: "none",
				end: position,
				start: position,
			}),
		).toMatchObject({
			column: 1,
			kind: "column",
		});
	});

	it("treats a fully selected header row as row identity for alignment but not deletion", () => {
		const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
		const headerEnd = source.indexOf("\n");
		const headerSelection = {
			direction: "forward" as const,
			end: headerEnd,
			start: 0,
		};
		expect(tableSelectionAt(source, headerSelection)).toEqual({
			canDeleteColumn: false,
			canDeleteRow: false,
			columnCount: 2,
			kind: "row",
			row: 0,
			rowIndex: 0,
		});
		expect(
			setMarkdownTableAlignment(source, 1, {
				alignment: "center",
				selection: { columnCount: 2, kind: "row", row: 0 },
			}),
		).toMatchObject({
			value:
				'<!-- easymde-table-align:v1 [[0,"center"]] -->\n| A | B |\n| --- | --- |\n| 1 | 2 |',
		});
	});

	it("marks malformed adjacent annotations unavailable without creating a second marker", () => {
		const source =
			"<!-- easymde-table-align:v1 {bad} -->\n| A |\n| --- |\n| 1 |";
		const position = source.lastIndexOf("1");
		expect(
			tableSelectionAt(source, {
				direction: "none",
				end: position,
				start: position,
			}),
		).toMatchObject({ tableAlignmentAvailable: false });
		expect(
			setMarkdownTableAlignment(source, position, {
				alignment: "center",
				selection: { column: 0, kind: "column" },
			}),
		).toEqual({
			code: "table-alignment-annotation-marker-invalid",
			status: "unsupported",
		});
		expect(
			editMarkdownTable(source, position, { type: "insert-row-below" }),
		).toBeNull();
	});

	it("rejects a multiline reserved marker through the cached parser-owned prefix range", () => {
		const source =
			'<!-- easymde-table-align:v1 [[1,\n"center"]] -->\n| A |\n| --- |\n| 1 |';
		const position = source.lastIndexOf("1");
		expect(
			tableSelectionAt(source, {
				direction: "none",
				end: position,
				start: position,
			}),
		).toMatchObject({ tableAlignmentAvailable: false });
		expect(
			setMarkdownTableAlignment(source, position, {
				alignment: "center",
				selection: { column: 0, kind: "column" },
			}),
		).toEqual({
			code: "table-alignment-annotation-marker-invalid",
			status: "unsupported",
		});
		expect(
			insertParagraphRelative(
				source,
				{ direction: "none", end: position, start: position },
				"before",
			),
		).toBeNull();
	});

	it("rejects a math-looking multiline marker and an orphan after an uncapped whitespace gap", () => {
		const marker = '<!-- easymde-table-align:v1 [[1,\n"center" $$x$$]] -->';
		const table = "| A |\n| --- |\n| 1 |";
		const adjacent = `${marker}\n${table}`;
		const adjacentPosition = adjacent.lastIndexOf("1");
		expect(
			setMarkdownTableAlignment(adjacent, adjacentPosition, {
				alignment: "center",
				selection: { column: 0, kind: "column" },
			}),
		).toEqual({
			code: "table-alignment-annotation-marker-invalid",
			status: "unsupported",
		});

		const orphan = `${marker}${"\n".repeat(35)}${table}`;
		const orphanPosition = orphan.lastIndexOf("1");
		expect(
			setMarkdownTableAlignment(orphan, orphanPosition, {
				alignment: "center",
				selection: { column: 0, kind: "column" },
			}),
		).toEqual({
			code: "table-alignment-annotation-marker-orphan",
			status: "unsupported",
		});

		const trailingTabSource = `<!-- easymde-table-align:v1 [[1,"center"]] -->\t\n${table}`;
		expect(
			setMarkdownTableAlignment(
				trailingTabSource,
				trailingTabSource.lastIndexOf("1"),
				{
					alignment: "right",
					selection: { column: 0, kind: "column" },
				},
			),
		).toEqual({
			code: "table-alignment-annotation-marker-invalid",
			status: "unsupported",
		});

		const oversizedRows: Array<readonly [number, "center" | "left" | "right"]> =
			Array.from({ length: 280 }, (_, index) => [index, "center"] as const);
		while (
			`<!-- easymde-table-align:v1 ${JSON.stringify(oversizedRows)} -->`
				.length > 4096
		) {
			oversizedRows.pop();
		}
		oversizedRows.push([oversizedRows.length, "left"]);
		for (let index = 0; index < oversizedRows.length; index += 1) {
			const currentLength =
				`<!-- easymde-table-align:v1 ${JSON.stringify(oversizedRows)} -->`
					.length;
			if (currentLength <= 4096) break;
			const excess = currentLength - 4096;
			oversizedRows[index] = [index, excess >= 2 ? "left" : "right"];
		}
		expect(
			`<!-- easymde-table-align:v1 ${JSON.stringify(oversizedRows)} -->`.length,
		).toBe(4096);
		const tallTableLines = [
			"| A | B |",
			"| --- | ---: |",
			...Array.from({ length: 285 }, (_, index) => `| r${index} | v${index} |`),
		];
		const nearLimitSource = `<!-- easymde-table-align:v1 ${JSON.stringify(oversizedRows)} -->\n${tallTableLines.join("\n")}`;
		const nextRowPos = nearLimitSource.indexOf(`| r${oversizedRows.length} |`);
		expect(
			setMarkdownTableAlignment(nearLimitSource, nextRowPos, {
				alignment: "center",
				selection: { kind: "row", row: oversizedRows.length + 1 },
			}),
		).toEqual({
			code: "table-alignment-annotation-marker-too-large",
			status: "unsupported",
		});
		expect(
			editMarkdownTable(
				nearLimitSource,
				nearLimitSource.indexOf("| A |"),
				{ type: "insert-row-above" },
			),
		).toBeNull();
	});

	it("recognizes a table-only whole selection even when its annotation prefix is outside the selection", () => {
		const source =
			'<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A |\n| --- |\n| 1 |';
		const tableStart = source.indexOf("| A");
		expect(
			tableSelectionAt(source, {
				direction: "forward",
				end: source.length,
				start: tableStart,
			}),
		).toMatchObject({
			kind: "whole-table",
		});
	});

	it("keeps foreign tables and fenced code from owning a later table across all newline styles", () => {
		for (const newline of ["\n", "\r\n", "\r"]) {
			const tableSource = [
				'<!-- easymde-table-align:v1 [[1,"center"]] -->',
				"| A | B |",
				"| --- | --- |",
				"| 1 | 2 |",
				"",
				"| C | D |",
				"| --- | --- |",
				"| 3 | 4 |",
			].join(newline);
			const tableResult = setMarkdownTableAlignment(
				tableSource,
				tableSource.lastIndexOf("4"),
				{
					alignment: "right",
					selection: { column: 1, kind: "column" },
				},
			);
			expect(tableResult).toMatchObject({
				value: tableSource.replace(
					`| --- | --- |${newline}| 3 | 4 |`,
					`| --- | ---: |${newline}| 3 | 4 |`,
				),
			});

			const fencedSource = [
				"```md",
				'<!-- easymde-table-align:v1 [[1,"center"]] -->',
				"| A | B |",
				"| --- | --- |",
				"| 1 | 2 |",
				"```",
				"",
				"| C | D |",
				"| --- | --- |",
				"| 3 | 4 |",
			].join(newline);
			const fencedResult = setMarkdownTableAlignment(
				fencedSource,
				fencedSource.lastIndexOf("4"),
				{
					alignment: "right",
					selection: { column: 1, kind: "column" },
				},
			);
			expect(fencedResult).toMatchObject({
				value: fencedSource.replace(
					`| --- | --- |${newline}| 3 | 4 |`,
					`| --- | ---: |${newline}| 3 | 4 |`,
				),
			});
		}
	});

	it("exposes raw GFM alignment metadata and owns an adjacent annotation prefix", () => {
		const source =
			'before\n<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A | B |\n| ---: | :---: |\n| 1 | 2 |\n\nafter';
		const table = findMarkdownTable(source, source.lastIndexOf("1"));
		expect(table).toMatchObject({
			baseAlignments: ["right", "center"],
			columnCount: 2,
			rowCount: 2,
			tableStart: source.indexOf("| A"),
			tableEnd: source.indexOf("| 1") + "| 1 | 2 |".length,
		});
		expect(table?.annotation.ownedPrefixRange).toMatchObject({
			from: source.indexOf("<!--"),
			to: source.indexOf("\n| A"),
		});
	});

	it("atomically combines delimiter and annotation edits without rewriting surrounding bytes", () => {
		const source =
			'prefix\n<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nsuffix';
		const result = setMarkdownTableAlignment(source, source.lastIndexOf("B"), {
			alignment: "right",
			selection: { column: 1, kind: "column" },
		});
		expect(result).toMatchObject({
			value:
				'prefix\n<!-- easymde-table-align:v1 [[1,"center"],[1,1,"right"]] -->\n| A | B |\n| --- | ---: |\n| 1 | 2 |\n\nsuffix',
		});
		expect(result && "changes" in result && result.changes).toEqual({
			from: source.indexOf("<!--"),
			insert:
				'<!-- easymde-table-align:v1 [[1,"center"],[1,1,"right"]] -->\n| A | B |\n| --- | ---: |',
			to: source.indexOf("| --- | --- |") + "| --- | --- |".length,
		});
		if ("status" in result)
			throw new Error("table-alignment-unexpectedly-unsupported");
		expect(result.value.slice(0, source.indexOf("<!--"))).toBe(
			source.slice(0, source.indexOf("<!--")),
		);
		expect(result.value.slice(result.value.indexOf("2 |") + 5)).toBe("suffix");
	});

	it("removes a consumed annotation while changing the whole-table GFM base atomically", () => {
		const source =
			'prefix\n<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nsuffix';
		const result = setMarkdownTableAlignment(source, source.lastIndexOf("B"), {
			alignment: "right",
			selection: { columnCount: 2, kind: "whole-table" },
		});
		expect(result).toMatchObject({
			value: "prefix\n| A | B |\n| ---: | ---: |\n| 1 | 2 |\n\nsuffix",
		});
		if ("status" in result)
			throw new Error("table-alignment-unexpectedly-unsupported");
		expect(result.value.slice(0, source.indexOf("<!--"))).toBe("prefix\n");
		expect(result.value.slice(-6)).toBe("suffix");
	});

	it("shifts annotation rows and columns with table insertions and deletions", () => {
		const source =
			'<!-- easymde-table-align:v1 [[1,"center"],[2,"center"],[2,1,"right"]] -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
		const insertedRow = editMarkdownTable(source, source.lastIndexOf("1"), {
			type: "insert-row-above",
		});
		expect(
			insertedRow?.value.startsWith(
				'<!-- easymde-table-align:v1 [[2,"center"],[3,"center"],[3,1,"right"]] -->',
			),
		).toBe(true);
		const insertedColumn = editMarkdownTable(source, source.indexOf("B"), {
			type: "insert-column-left",
		});
		expect(
			insertedColumn?.value.startsWith(
				'<!-- easymde-table-align:v1 [[1,"center"],[2,"center"],[2,2,"right"]] -->',
			),
		).toBe(true);
		const deletedRow = editMarkdownTable(source, source.lastIndexOf("1"), {
			type: "delete-row",
		});
		expect(
			deletedRow?.value.startsWith(
				'<!-- easymde-table-align:v1 [[1,"center"],[1,1,"right"]] -->',
			),
		).toBe(true);
		const deletedColumn = editMarkdownTable(source, source.indexOf("B"), {
			type: "delete-column",
		});
		expect(
			deletedColumn?.value.startsWith(
				'<!-- easymde-table-align:v1 [[1,"center"],[2,"center"]] -->',
			),
		).toBe(true);
	});

	it("copies and deletes the annotation together with its table", () => {
		const source =
			'before\n<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A |\n| --- |\n| 1 |\n\nafter';
		const position = source.lastIndexOf("1");
		expect(
			editMarkdownTable(source, position, { type: "copy-table" })?.copiedText,
		).toBe(
			'<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A |\n| --- |\n| 1 |',
		);
		expect(
			editMarkdownTable(source, position, { type: "delete-table" })?.value,
		).toBe("before\n\n\nafter");
	});

	it("keeps a valid marker attached when inserting adjacent paragraphs with every newline style", () => {
		for (const newline of ["\n", "\r\n", "\r"]) {
			const source = `before${newline}<!-- easymde-table-align:v1 [[1,"center"]] -->${newline}| A |${newline}| --- |${newline}| 1 |${newline}${newline}after`;
			const position = source.lastIndexOf("1");
			const before = insertParagraphRelative(
				source,
				{ direction: "none", end: position, start: position },
				"before",
			);
			const after = insertParagraphRelative(
				source,
				{ direction: "none", end: position, start: position },
				"after",
			);
			expect(before?.value).toBe(
				`before${newline}${newline}<!-- easymde-table-align:v1 [[1,"center"]] -->${newline}| A |${newline}| --- |${newline}| 1 |${newline}${newline}after`,
			);
			expect(after?.value).toBe(
				`before${newline}<!-- easymde-table-align:v1 [[1,"center"]] -->${newline}| A |${newline}| --- |${newline}| 1 |${newline}${newline}${newline}after`,
			);
		}
	});

	it("retains marker ownership when the marker line has trailing spaces", () => {
		const source =
			'<!-- easymde-table-align:v1 [[1,"center"]] -->  \n| A |\n| --- |\n| 1 |';
		const result = setMarkdownTableAlignment(source, source.lastIndexOf("1"), {
			alignment: "right",
			selection: { column: 0, kind: "column" },
		});
		expect(result).toMatchObject({
			value:
				'<!-- easymde-table-align:v1 [[1,"center"],[1,0,"right"]] -->  \n| A |\n| ---: |\n| 1 |',
		});
	});

	it("derives header, unique-column, and ambiguous deletion boundaries", () => {
		const twoColumn = "| A | B |\n| --- | --- |\n| 1 | 2 |";
		expect(
			tableSelectionAt(twoColumn, {
				direction: "none",
				end: twoColumn.indexOf("A"),
				start: twoColumn.indexOf("A"),
			}),
		).toMatchObject({
			canDeleteColumn: true,
			canDeleteRow: false,
			kind: "column",
			rowIndex: 0,
		});
		const uniqueColumn = "| A |\n| --- |\n| 1 |";
		expect(
			tableSelectionAt(uniqueColumn, {
				direction: "none",
				end: uniqueColumn.indexOf("1"),
				start: uniqueColumn.indexOf("1"),
			}),
		).toMatchObject({
			canDeleteColumn: false,
			canDeleteRow: true,
			kind: "column",
			rowIndex: 2,
		});
		expect(
			tableSelectionAt(twoColumn, {
				direction: "forward",
				end: twoColumn.indexOf("2") + 1,
				start: twoColumn.indexOf("1"),
			}),
		).toEqual({
			canDeleteColumn: false,
			canDeleteRow: false,
			columnCount: 2,
			kind: "ambiguous",
		});
	});

	it("marks a complete body row plus the next row's partial content ambiguous", () => {
		for (const newline of ["\n", "\r\n"]) {
			const source = [
				"| A | B |",
				"| --- | --- |",
				"| 1 | 2 |",
				"| 3 | 4 |",
			].join(newline);
			const firstBodyRow = source.indexOf("| 1");
			const nextRow = source.indexOf("| 3");
			for (const direction of ["forward", "backward"] as const) {
				const selection = {
					direction,
					end: nextRow + 3,
					start: firstBodyRow,
				};
				expect(tableSelectionAt(source, selection)).toMatchObject({
					canDeleteColumn: false,
					canDeleteRow: false,
					columnCount: 2,
					kind: "ambiguous",
				});
			}
		}
	});

	it("recognizes real-browser whole-table and column drag boundaries", () => {
		const source = [
			"| A | B |",
			"| --- | --- |",
			"| 1 | 2 |",
			"| 3 | 4 |",
		].join("\n");
		// The pointer drag anchors on the header line and releases inside the
		// final row, so the table end is covered row-wise rather than exactly.
		const wholeTableSelection = {
			direction: "forward" as const,
			end: source.indexOf("3") + 1,
			start: 0,
		};
		const wholeTable = tableSelectionAt(source, wholeTableSelection);
		expect(wholeTable).toEqual({
			canDeleteColumn: false,
			canDeleteRow: false,
			columnCount: 2,
			kind: "whole-table",
		});
		if (!wholeTable) throw new Error("table-whole-selection-missing");
		expect(
			setMarkdownTableAlignment(
				source,
				wholeTableSelection.start,
				{ alignment: "center", selection: wholeTable },
				wholeTableSelection,
			),
		).toMatchObject({
			value: "| A | B |\n| :---: | :---: |\n| 1 | 2 |\n| 3 | 4 |",
		});
		// A header-anchored drag that releases in the last row covers every
		// table row even when it anchors inside a header cell.
		expect(
			tableSelectionAt(source, {
				direction: "forward",
				end: source.indexOf("4") + 1,
				start: source.indexOf("A") + 1,
			}),
		).toMatchObject({ kind: "whole-table" });

		const cases = [
			{
				cell: "1",
				column: 0,
				last: "3",
				value: "| A | B |\n| ---: | --- |\n| 1 | 2 |\n| 3 | 4 |",
			},
			{
				cell: "2",
				column: 1,
				last: "4",
				value: "| A | B |\n| --- | ---: |\n| 1 | 2 |\n| 3 | 4 |",
			},
		];
		for (const testCase of cases) {
			const columnSelection = {
				direction: "forward" as const,
				end: source.indexOf(testCase.last) + 1,
				start: source.indexOf(testCase.cell),
			};
			const derived = tableSelectionAt(source, columnSelection);
			expect(derived).toEqual({
				canDeleteColumn: true,
				canDeleteRow: false,
				column: testCase.column,
				columnCount: 2,
				kind: "column",
				rowIndex: 2,
			});
			if (!derived) throw new Error("table-column-selection-missing");
			expect(
				setMarkdownTableAlignment(
					source,
					columnSelection.start,
					{ alignment: "right", selection: derived },
					columnSelection,
				),
			).toMatchObject({ value: testCase.value });
		}
	});

	it("keeps cross-column multi-row drags ambiguous", () => {
		const source = "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
		expect(
			tableSelectionAt(source, {
				direction: "forward",
				end: source.indexOf("4") + 1,
				start: source.indexOf("1"),
			}),
		).toEqual({
			canDeleteColumn: false,
			canDeleteRow: false,
			columnCount: 2,
			kind: "ambiguous",
		});
	});

	it("keeps domain edits aligned with body-cell identity", () => {
		const source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
		const bodyCell = source.indexOf("1");
		expect(
			editMarkdownTable(source, bodyCell, { type: "delete-row" }),
		).not.toBeNull();
		expect(
			editMarkdownTable(source, bodyCell, { type: "delete-column" }),
		).not.toBeNull();
		expect(
			editMarkdownTable("| A |\n| --- |\n| 1 |", 18, { type: "delete-row" }),
		).not.toBeNull();
		expect(
			editMarkdownTable("| A |\n| --- |\n| 1 |", 18, { type: "delete-column" }),
		).toBeNull();
		expect(
			editMarkdownTable(source, source.indexOf("A"), { type: "delete-row" }),
		).toBeNull();
	});

	it.each(["\n", "\r\n", "\r"])(
		"deletes only a parser-owned thematic-break source range for %j",
		(newline) => {
			const source = `prefix${newline}${newline}  ---  ${newline}${newline}suffix`;
			const marker = source.indexOf("---");
			const index = createEditorMarkdownBlockIndex(source);
			const edit = deleteThematicBreak(
				source,
				{ direction: "none", end: marker + 1, start: marker + 1 },
				index,
			);

			expect(edit).toEqual({
			changes: {
				from: source.indexOf("  ---"),
				insert: "",
				to: source.indexOf("  ---") + "  ---  ".length,
			},
			selection: {
				direction: "none",
				end: source.indexOf("  ---"),
				start: source.indexOf("  ---"),
			},
			value: `prefix${newline}${newline}${newline}${newline}suffix`,
		});
		},
	);

	it("rejects setext headings, nested rules, fenced markers, mixed selections, and stale indexes", () => {
		const thematic = "prefix\n\n---\n\nsuffix";
		const thematicIndex = createEditorMarkdownBlockIndex(thematic);
		const thematicStart = thematic.indexOf("---");
		expect(
			deleteThematicBreak(
				thematic,
				{
					direction: "forward",
					end: thematicStart + 3,
					start: thematicStart,
				},
				thematicIndex,
			),
		).toEqual({
			changes: { from: thematicStart, insert: "", to: thematicStart + 3 },
			selection: { direction: "none", end: thematicStart, start: thematicStart },
			value: "prefix\n\n\n\nsuffix",
		});

		for (const source of [
			"title\n---\nbody",
			"> ---\nbody",
			"- item\n  ---\nbody",
			"```md\n---\n```\nbody",
		]) {
			const position = source.indexOf("---");
			expect(
				deleteThematicBreak(source, {
					direction: "none",
					end: position + 1,
					start: position + 1,
				}),
			).toBeNull();
		}

		const mixedStart = thematicStart;
		expect(
			deleteThematicBreak(thematic, {
				direction: "forward",
				end: thematicStart + 4,
				start: mixedStart,
			}),
		).toBeNull();

		const changed = thematic.replace("---", "***");
		expect(() =>
			deleteThematicBreak(
				changed,
				{ direction: "none", end: thematicStart + 1, start: thematicStart + 1 },
				thematicIndex,
		),
		).toThrowError("editor-context-menu-block-index-source-mismatch");
	});

	it("exposes a reusable canonical edit shape for callers", () => {
		expect(
			createTextEdit("a", "b", { direction: "none", end: 1, start: 1 }, 0, 1),
		).toEqual({
			changes: { from: 0, insert: "b", to: 1 },
			selection: { direction: "none", end: 1, start: 1 },
			value: "b",
		});
	});

	it("resolves one CommonMark heading level from a parser-owned heading block", () => {
		for (let level = 1; level <= 6; level += 1) {
			const source = `${"#".repeat(level)} Heading ${level}`;
			const index = createEditorMarkdownBlockIndex(source);
			expect(
				markdownHeadingLevel(source, findMarkdownBlock(source, 0, index)),
			).toBe(level);
		}

		for (const [source, expected] of [
			["#", 1],
			["  ### Indented heading", 3],
			["## Closed heading ##", 2],
			["# Carriage\r\nbody", 1],
		] as ReadonlyArray<readonly [string, number]>) {
			const index = createEditorMarkdownBlockIndex(source);
			expect(
				markdownHeadingLevel(source, findMarkdownBlock(source, 0, index)),
			).toBe(expected);
		}

		for (const [source, expected] of [
			["Title\n=====\nbody", 1],
			["Title\n---\nbody", 2],
			["Two line title\nstill the title\n===\nbody", 1],
			["CRLF title\r\n===\r\nbody", 1],
			["CR title\r===\rbody", 1],
		] as ReadonlyArray<readonly [string, number]>) {
			const index = createEditorMarkdownBlockIndex(source);
			expect(
				markdownHeadingLevel(source, findMarkdownBlock(source, 0, index)),
			).toBe(expected);
		}
	});

	it("keeps non-heading and unresolved lexical forms explicitly level-free", () => {
		for (const source of [
			"plain paragraph",
			"####### Seven hashes",
			"#\tTabbed heading",
			"    # indented code",
			"> # quoted heading",
			"- # list heading",
			"",
		]) {
			const index = createEditorMarkdownBlockIndex(source);
			expect(
				markdownHeadingLevel(source, findMarkdownBlock(source, 0, index)),
			).toBe(null);
		}

		const value = "Escaped \\# not a heading";
		expect(markdownHeadingLevel(value, null)).toBe(null);
		expect(
			markdownHeadingLevel(value, {
				end: value.length,
				kind: "paragraph",
				lineEnd: 0,
				lineStart: 0,
				start: 0,
			}),
		).toBe(null);
		expect(
			markdownHeadingLevel(value, {
				end: value.length,
				kind: "heading",
				lineEnd: 0,
				lineStart: 0,
				start: 0,
			}),
		).toBe(null);
		expect(
			markdownHeadingLevel(value, {
				end: value.length,
				kind: "heading",
				lineEnd: 1,
				lineStart: 0,
				start: 0,
			}),
		).toBe(null);
	});
});

function createEditorMarkdownBlockIndex(source: string, options: Parameters<typeof createProfiledMarkdownBlockIndex>[1] = { referenceLabelCaseFoldProfile: 14 }) {
  return createProfiledMarkdownBlockIndex(source, options);
}
