import { describe, expect, it } from "vitest";

import {
	captureEditorContext,
	createTextEdit,
	editMarkdownTable,
	deleteThematicBreak,
	editorContextSelectionFitsRange,
	findMarkdownBlock,
	findMarkdownTable,
	formatMarkdownTableSource,
	insertParagraphRelative,
	isEditorContextCurrent,
	setMarkdownTableAlignment,
	tableSelectionAt,
} from "./editor-context-menu-rules";
import {
	createEditorMarkdownBlockIndex,
	findEditorCodeContentTarget,
} from "./editor-markdown-block-index";

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
			to: source.indexOf(" |\nafter") + 2,
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
		expect(edit?.value.endsWith(`${newline}after`)).toBe(true);
		expect(edit?.value).toContain("  value\\  | [x](https://e.test/a) |");
		expect(edit?.value.match(/\r\n/gu)).toHaveLength(5);
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
		const source = "| A | B |\n| --- | --- |\n| 1 | 2 |\nTail";
		const tableEnd = source.indexOf("\nTail");

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
			'before\n<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A | B |\n| ---: | :---: |\n| 1 | 2 |\nafter';
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
			'prefix\n<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\nsuffix';
		const result = setMarkdownTableAlignment(source, source.lastIndexOf("B"), {
			alignment: "right",
			selection: { column: 1, kind: "column" },
		});
		expect(result).toMatchObject({
			value:
				'prefix\n<!-- easymde-table-align:v1 [[1,"center"],[1,1,"right"]] -->\n| A | B |\n| --- | ---: |\n| 1 | 2 |\nsuffix',
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
		expect(result.value.slice(result.value.indexOf("2 |") + 4)).toBe("suffix");
	});

	it("removes a consumed annotation while changing the whole-table GFM base atomically", () => {
		const source =
			'prefix\n<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A | B |\n| --- | --- |\n| 1 | 2 |\nsuffix';
		const result = setMarkdownTableAlignment(source, source.lastIndexOf("B"), {
			alignment: "right",
			selection: { columnCount: 2, kind: "whole-table" },
		});
		expect(result).toMatchObject({
			value: "prefix\n| A | B |\n| ---: | ---: |\n| 1 | 2 |\nsuffix",
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
			'before\n<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A |\n| --- |\n| 1 |\nafter';
		const position = source.lastIndexOf("1");
		expect(
			editMarkdownTable(source, position, { type: "copy-table" })?.copiedText,
		).toBe(
			'<!-- easymde-table-align:v1 [[1,"center"]] -->\n| A |\n| --- |\n| 1 |',
		);
		expect(
			editMarkdownTable(source, position, { type: "delete-table" })?.value,
		).toBe("before\n\nafter");
	});

	it("keeps a valid marker attached when inserting adjacent paragraphs with every newline style", () => {
		for (const newline of ["\n", "\r\n", "\r"]) {
			const source = `before${newline}<!-- easymde-table-align:v1 [[1,"center"]] -->${newline}| A |${newline}| --- |${newline}| 1 |${newline}after`;
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
				`before${newline}${newline}<!-- easymde-table-align:v1 [[1,"center"]] -->${newline}| A |${newline}| --- |${newline}| 1 |${newline}after`,
			);
			expect(after?.value).toBe(
				`before${newline}<!-- easymde-table-align:v1 [[1,"center"]] -->${newline}| A |${newline}| --- |${newline}| 1 |${newline}${newline}after`,
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
});
