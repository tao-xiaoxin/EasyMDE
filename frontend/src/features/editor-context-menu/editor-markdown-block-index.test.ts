import { describe, expect, it } from "vitest";

import {
	createEditorMarkdownBlockIndex,
	type EditorCodeBodyMap,
	type EditorMarkdownBlockKind,
	findEditorCodeContentTarget,
	findEditorMarkdownBlock,
	readEditorCodeContent,
} from "./editor-markdown-block-index";

function editorCodeBodyMap(
	source: string,
	entries: ReadonlyArray<{
		content?: string;
		endLine: number;
		kind: "fenced" | "indented";
		startLine: number;
		status?: "available" | "unavailable";
	}>,
	signature = "test-signature",
): EditorCodeBodyMap {
	return {
		codeMap: {
			coordinate: "line",
			entries: entries.map((entry) =>
				"unavailable" === entry.status
					? {
							code: "preview-code-body-source-unavailable" as const,
							endLine: entry.endLine,
							kind: entry.kind,
							startLine: entry.startLine,
							status: "unavailable" as const,
						}
					: {
							content: entry.content ?? "",
							endLine: entry.endLine,
							kind: entry.kind,
							startLine: entry.startLine,
							status: "available" as const,
						},
			),
			signature,
			status: "available",
			version: 1,
		},
		signature,
		source,
	};
}

function blockAt(
	source: string,
	position: number,
): Readonly<{
	from: number;
	kind: EditorMarkdownBlockKind;
	to: number;
}> {
	const block = findEditorMarkdownBlock(
		createEditorMarkdownBlockIndex(source),
		position,
	);
	if (!block) throw new Error("editor-markdown-block-missing");
	return { from: block.from, kind: block.kind, to: block.to };
}

describe("createEditorMarkdownBlockIndex", () => {
	it.each(["---", "***", "___"])(
		"classifies a standalone %s as a thematic break",
		(marker) => {
			expect(blockAt(marker, 1)).toEqual({
				from: 0,
				kind: "thematic-break",
				to: marker.length,
			});
			expect(createEditorMarkdownBlockIndex(marker).blocks).toEqual([
				{
					editable: true,
					from: 0,
					kind: "thematic-break",
					lineEnd: 0,
					lineStart: 0,
					to: marker.length,
				},
			]);
		},
	);

	it("preserves thematic-break indentation and trailing whitespace without widening its source", () => {
		for (const marker of ["---", "***", "___"]) {
			const source = `  ${marker}  `;
			expect(blockAt(source, source.indexOf(marker) + 1)).toEqual({
				from: 0,
				kind: "thematic-break",
				to: source.length,
			});
		}

		expect(blockAt("\t---", 2).kind).toBe("code");
	});

	it("does not confuse Setext headings or nested rules with a top-level thematic break", () => {
		const heading = "title\n---";
		expect(blockAt(heading, heading.indexOf("title"))).toEqual({
			from: 0,
			kind: "heading",
			to: heading.length,
		});
		for (const marker of ["***", "___"]) {
			const source = `title\n${marker}`;
			expect(blockAt(source, source.indexOf(marker) + 1)).toEqual({
				from: source.indexOf(marker),
				kind: "thematic-break",
				to: source.length,
			});
		}

		const nested = ["> ---", "- item", "  ---", "```md", "---", "```"].join(
			"\n",
		);
		expect(blockAt(nested, nested.indexOf("> ---"))).toMatchObject({
			kind: "quote",
		});
		expect(blockAt(nested, nested.indexOf("item"))).toMatchObject({
			kind: "list",
		});
		expect(
			blockAt(nested, nested.indexOf("---", nested.indexOf("```md"))),
		).toMatchObject({ kind: "code" });
	});

	it("keeps a separated rule distinct from a preceding paragraph", () => {
		const source = "title\n\n---";
		expect(blockAt(source, source.lastIndexOf("---") + 1)).toEqual({
			from: source.indexOf("---"),
			kind: "thematic-break",
			to: source.length,
		});
	});

	it("keeps a heading independent from the following paragraph", () => {
		const source = "# H\nbody";
		expect(blockAt(source, source.indexOf("H"))).toEqual({
			from: 0,
			kind: "heading",
			to: 3,
		});
		expect(blockAt(source, source.indexOf("body"))).toEqual({
			from: 4,
			kind: "paragraph",
			to: source.length,
		});
	});

	it("keeps nested and continued list items under one top-level list block", () => {
		const source = "- a\n  - b\n- c";
		expect(blockAt(source, source.indexOf("b"))).toEqual({
			from: 0,
			kind: "list",
			to: source.length,
		});
		expect(blockAt(source, source.indexOf("c"))).toEqual({
			from: 0,
			kind: "list",
			to: source.length,
		});
	});

	it("keeps quote, fenced code, indented code, and table ranges parser-owned", () => {
		const source =
			"> quote\n> next\n\n```js\ncode\n```\n\n    indented\n\n| A | B |\n| - | - |\n| 1 | 2 |";
		expect(blockAt(source, source.indexOf("quote")).kind).toBe("quote");
		expect(blockAt(source, source.indexOf("code")).kind).toBe("code");
		expect(blockAt(source, source.indexOf("indented")).kind).toBe("code");
		expect(blockAt(source, source.indexOf("| A")).kind).toBe("table");
	});

	it.each(["\n", "\r\n", "\r"])(
		"keeps parser block ownership equivalent for %j line endings",
		(newline) => {
			const source = [
				"# heading",
				"- list",
				"> quote",
				"```md",
				"code",
				"```",
			].join(newline);
			const expected = ["heading", "list", "quote", "code"].map((text) => ({
				kind: blockAt(source, source.indexOf(text)).kind,
				text,
			}));

			expect(expected).toEqual([
				{ kind: "heading", text: "heading" },
				{ kind: "list", text: "list" },
				{ kind: "quote", text: "quote" },
				{ kind: "code", text: "code" },
			]);
		},
	);

	it("maps a prefix and a CRLF table to separate source blocks", () => {
		const source = [
			"prefix",
			"| H | V |",
			"| --- | --- |",
			"| a | b |",
			"",
			"after",
		].join("\r\n");

		expect(blockAt(source, source.indexOf("prefix") + 2)).toEqual({
			from: 0,
			kind: "paragraph",
			to: "prefix".length,
		});
		expect(blockAt(source, source.indexOf("| H")).kind).toBe("table");
	});

	it("indexes PHP-compatible inline and block math outside code ranges", () => {
		const source = "before $x$ after\n\n$$\ny\n$$\n\n```md\n$literal$\n```";
		expect(blockAt(source, source.indexOf("$x$") + 1).kind).toBe("paragraph");
		expect(blockAt(source, source.indexOf("$$\ny") + 2).kind).toBe("math");
		expect(blockAt(source, source.indexOf("$literal$") + 1).kind).toBe("code");
	});

	it("keeps math-looking HTML comments as one unavailable parser-owned block", () => {
		const source =
			"<!-- easymde-table-align:v1 [[1, $$x$$]] -->\n| A |\n| --- |\n| 1 |";
		const index = createEditorMarkdownBlockIndex(source);
		expect(index.mathSpans).toEqual([]);
		expect(index.blocks.slice(0, 2)).toEqual([
			{
				editable: false,
				from: 0,
				kind: "unavailable",
				lineEnd: 0,
				lineStart: 0,
				to: source.indexOf("\n"),
			},
			{
				editable: true,
				from: source.indexOf("| A |"),
				kind: "table",
				lineEnd: 3,
				lineStart: 1,
				to: source.length,
			},
		]);
	});

	it("keeps inline math inside paragraph, quote, and list containers", () => {
		const paragraph = "before $x$ after";
		expect(blockAt(paragraph, paragraph.indexOf("$x$") + 1).kind).toBe(
			"paragraph",
		);
		const quote = "> before $x$ after";
		expect(blockAt(quote, quote.indexOf("$x$") + 1)).toEqual({
			from: 0,
			kind: "quote",
			to: quote.length,
		});
		const list = "- before \\(x\\) after";
		expect(blockAt(list, list.indexOf("x")).kind).toBe("list");
	});

	it("honors PHP math precedence and resumes after nested tilde code", () => {
		const precedence = "$a $$b$$ c$";
		expect(blockAt(precedence, precedence.indexOf("a")).kind).toBe("paragraph");
		expect(blockAt(precedence, precedence.indexOf("b")).kind).toBe("math");
		const nestedCode = "~~~md\n$literal$\n~~~\n$$\nreal\n$$";
		expect(blockAt(nestedCode, nestedCode.indexOf("$literal$") + 1).kind).toBe(
			"code",
		);
		expect(blockAt(nestedCode, nestedCode.indexOf("real")).kind).toBe("math");
	});

	it("keeps UTF-16 math spans exact after astral text and CRLF math lines", () => {
		const source = [
			"😀 before $inline$ after",
			"",
			"$$\r\nfirst\r\n$$",
			"",
			"$$\r\nsecond\r\n$$",
		].join("\r\n");
		const firstStart = source.indexOf("$$");
		const firstEnd = source.indexOf("$$", firstStart + 2) + 2;
		const secondStart = source.indexOf("$$", firstEnd);
		const secondEnd = source.indexOf("$$", secondStart + 2) + 2;
		const inlineStart = source.indexOf("$inline$");
		const index = createEditorMarkdownBlockIndex(source);

		expect(index.mathSpans).toEqual([
			{
				bodyFrom: inlineStart + 1,
				bodyTo: inlineStart + "$inline$".length - 1,
				displayMode: false,
				from: inlineStart,
				to: inlineStart + "$inline$".length,
			},
			{
				bodyFrom: firstStart + 2,
				bodyTo: firstEnd - 2,
				displayMode: true,
				from: firstStart,
				to: firstEnd,
			},
			{
				bodyFrom: secondStart + 2,
				bodyTo: secondEnd - 2,
				displayMode: true,
				from: secondStart,
				to: secondEnd,
			},
		]);
		expect(blockAt(source, source.indexOf("first"))).toEqual({
			from: firstStart,
			kind: "math",
			to: firstEnd,
		});
		expect(blockAt(source, source.indexOf("second"))).toEqual({
			from: secondStart,
			kind: "math",
			to: secondEnd,
		});
		expect(blockAt(source, source.indexOf("inline"))).toEqual({
			from: 0,
			kind: "paragraph",
			to: source.indexOf("\r\n"),
		});
	});

	it("lets caret boundaries resolve to the preceding block", () => {
		const heading = "# H\nbody";
		expect(blockAt(heading, 3).kind).toBe("heading");
		const crlf = "paragraph\r\n";
		expect(blockAt(crlf, 9).kind).toBe("paragraph");
	});

	it("keeps a block math range whole when the parser sees inner Markdown blocks", () => {
		const source = "$$\n# x\n$$";
		expect(blockAt(source, source.indexOf("# x"))).toEqual({
			from: 0,
			kind: "math",
			to: source.length,
		});
	});

	it("keeps only the outer block math owner when block delimiters nest", () => {
		const source = "\\[ a $$b$$ c \\]";
		const index = createEditorMarkdownBlockIndex(source);
		const mathBlocks = index.blocks
			.filter((block) => "math" === block.kind)
			.map(({ from, to }) => ({ from, to }));

		expect(mathBlocks).toEqual([{ from: 0, to: source.length }]);
		expect(blockAt(source, source.indexOf("b"))).toEqual({
			from: 0,
			kind: "math",
			to: source.length,
		});
		expect(blockAt(source, source.length)).toEqual({
			from: 0,
			kind: "math",
			to: source.length,
		});
	});

	it("lets an inline outer owner swallow an inner block delimiter without splitting the paragraph", () => {
		const source = "before \\(a $$b$$ c\\) after";
		const index = createEditorMarkdownBlockIndex(source);

		expect(index.blocks.some((block) => "math" === block.kind)).toBe(false);
		expect(blockAt(source, source.indexOf("b"))).toEqual({
			from: 0,
			kind: "paragraph",
			to: source.length,
		});
	});

	it("always advances past an unclosed backtick run before scanning another run", () => {
		const source = "`unclosed\n``closed``\n$$math$$";
		const index = createEditorMarkdownBlockIndex(source);
		expect(index.length).toBe(source.length);
		expect(blockAt(source, source.indexOf("math")).kind).toBe("math");
	});

	it("populates numeric image provenance from the same Markdown tree", () => {
		const source = [
			"😀 ![one](https://img.test/one.png)",
			"",
			"![ref][image]",
			"",
			"[image]: https://img.test/ref.png",
			"",
			"```md",
			"![code](https://img.test/code.png)",
			"```",
			"",
			"![two](https://img.test/two.png)",
		].join("\r\n");
		const index = createEditorMarkdownBlockIndex(source);
		const oneStart = source.indexOf("![one]");
		const twoStart = source.lastIndexOf("![two]");

		expect(index.imageRanges).toEqual([
			{
				from: oneStart,
				to: oneStart + "![one](https://img.test/one.png)".length,
			},
			{
				from: twoStart,
				to: twoStart + "![two](https://img.test/two.png)".length,
			},
		]);
		expect(
			index.imageBlocks?.some((block) => "unavailable" === block.status),
		).toBe(true);
		expect(
			index.imageBlocks?.some(
				(block) => block.count === 0 && "ready" === block.status,
			),
		).toBe(true);
		expect(
			index.imageBlocks?.reduce((total, block) => total + block.count, 0),
		).toBe(2);
	});

	it("keeps a linked inline image range and rejects nested image provenance for its block", () => {
		const linked =
			"[![Alt](https://img.test/image.png)](https://site.test/page)";
		const linkedIndex = createEditorMarkdownBlockIndex(linked);
		expect(linkedIndex.imageRanges).toEqual([
			{ from: 1, to: linked.indexOf(")") + 1 },
		]);

		const nested =
			"![outer [![inner](https://img.test/inner.png)](https://img.test/outer.png)](https://img.test/final.png)";
		const nestedIndex = createEditorMarkdownBlockIndex(nested);
		expect(nestedIndex.imageRanges).toEqual([]);
		expect(nestedIndex.imageBlocks?.[0]?.status).toBe("unavailable");
	});

	it("excludes image-looking syntax inside accepted math while preserving the adjacent image", () => {
		const source =
			"$![math](https://img.test/math.png)$ ![real](https://img.test/real.png)";
		const index = createEditorMarkdownBlockIndex(source);
		const realStart = source.lastIndexOf("![real]");
		expect(index.mathSpans).toEqual([
			{
				bodyFrom: 1,
				bodyTo: source.indexOf("$ !"),
				displayMode: false,
				from: 0,
				to: source.indexOf("$ !") + 1,
			},
		]);
		expect(index.imageRanges).toEqual([{ from: realStart, to: source.length }]);
	});

	it("protects PHP-style inline code across blank lines when Lezer has no InlineCode node", () => {
		const source = "`x\n\nparagraph $$literal$$\n\nclose`";
		const index = createEditorMarkdownBlockIndex(source);

		expect(index.blocks.some((block) => "math" === block.kind)).toBe(false);
		expect(blockAt(source, source.indexOf("literal"))).toEqual({
			from: source.indexOf("paragraph"),
			kind: "paragraph",
			to: source.indexOf("\n\nclose`"),
		});
	});

	it("preserves exact-length runs, unclosed runs, and protected block interruptions", () => {
		const multipleRuns = "`one` and ``two``\n\n$$real$$";
		expect(blockAt(multipleRuns, multipleRuns.indexOf("one")).kind).toBe(
			"paragraph",
		);
		expect(blockAt(multipleRuns, multipleRuns.indexOf("two")).kind).toBe(
			"paragraph",
		);
		expect(blockAt(multipleRuns, multipleRuns.indexOf("real")).kind).toBe(
			"math",
		);

		const unclosed = "`open\n\n$$real$$";
		expect(blockAt(unclosed, unclosed.indexOf("real")).kind).toBe("math");

		const escaped = "\\`not-code`\n\n$$real$$";
		expect(blockAt(escaped, escaped.indexOf("not-code")).kind).toBe(
			"paragraph",
		);
		expect(blockAt(escaped, escaped.indexOf("real")).kind).toBe("math");

		const interrupted = ["`open", "```md", "$literal$", "```", "$$real$$"].join(
			"\n",
		);
		expect(blockAt(interrupted, interrupted.indexOf("literal")).kind).toBe(
			"code",
		);
		expect(blockAt(interrupted, interrupted.indexOf("real")).kind).toBe("math");
	});

	it("matches PHP escaped-opening run semantics for every run length and slash parity", () => {
		for (let openingLength = 1; openingLength <= 6; openingLength += 1) {
			for (let closingLength = 1; closingLength <= 6; closingLength += 1) {
				for (const backslashCount of [1, 2]) {
					const source = [
						"before",
						`${"\\".repeat(backslashCount)}${"`".repeat(openingLength)}`,
						"$$real$$",
						`${"`".repeat(closingLength)} after`,
					].join(" ");
					const index = createEditorMarkdownBlockIndex(source);
					const realStart = source.indexOf("$$real$$");
					const matchingLength =
						backslashCount % 2 === 1 ? openingLength - 1 : openingLength;
					const shouldProtectMath =
						matchingLength > 0 && closingLength === matchingLength;

					expect(
						index.mathSpans.some(
							(span) =>
								span.from <= realStart &&
								span.to >= realStart + "$$real$$".length,
						),
					).toBe(!shouldProtectMath);
				}
			}
		}
	});

	it("returns an explicit unavailable result for an unclassified parser range", () => {
		const source = "<custom-component>\ntext";
		const block = findEditorMarkdownBlock(
			createEditorMarkdownBlockIndex(source),
			1,
		);
		expect(block?.kind).toBe("unavailable");
	});
});

describe("readEditorCodeContent", () => {
	it("requires a formal code body map instead of browser-side extraction", () => {
		const source = "```\nvalue\n```";
		const result = readEditorCodeContent(
			source,
			{ end: source.indexOf("value"), start: source.indexOf("value") },
			createEditorMarkdownBlockIndex(source),
		);

		expect(result).toEqual({
			code: "editor-code-content-map-unavailable",
			status: "unavailable",
		});
	});

	it("exposes the bounded leaf and owner line ranges before map consumption", () => {
		const source = "before\n\n```js\none\n```\nafter";
		const result = findEditorCodeContentTarget(
			source,
			{ end: source.indexOf("one"), start: source.indexOf("one") },
			createEditorMarkdownBlockIndex(source),
		);

		expect(result).toMatchObject({
			status: "available",
			target: {
				kind: "fenced",
				lineEnd: 5,
				lineStart: 2,
				ownerLineEnd: 5,
				ownerLineStart: 2,
			},
		});
	});

	it("recognizes a selection that contains an entire fenced code block", () => {
		const source = "before\n\n```js\none\n```\nafter";
		const start = source.indexOf("```js");
		const end = source.indexOf("```", start + 3) + 3;
		const result = findEditorCodeContentTarget(
			source,
			{ end, start },
			createEditorMarkdownBlockIndex(source),
		);

		expect(result).toMatchObject({
			status: "available",
			target: { kind: "fenced" },
		});
	});

	it("rejects stale map source/signature and unavailable formal maps", () => {
		const source = "```\nvalue\n```";
		const index = createEditorMarkdownBlockIndex(source);
		const selection = source.indexOf("value");
		const currentCodeMap = editorCodeBodyMap(source, [
			{ content: "value\n", endLine: 3, kind: "fenced", startLine: 0 },
		]);

		for (const staleMap of [
			{ ...currentCodeMap, signature: "other-signature" },
			{ ...currentCodeMap, source: `${source}!` },
		]) {
			expect(
				readEditorCodeContent(
					source,
					{ end: selection, start: selection },
					index,
					staleMap,
				),
			).toEqual({
				code: "editor-code-content-map-stale",
				status: "unavailable",
			});
		}
		expect(
			readEditorCodeContent(
				source,
				{ end: selection, start: selection },
				index,
				{
					...currentCodeMap,
					codeMap: {
						code: "preview-code-body-limit",
						coordinate: "line",
						signature: "test-signature",
						status: "unavailable",
						version: 1,
					},
				},
			),
		).toEqual({
			code: "editor-code-content-map-unavailable",
			status: "unavailable",
		});
	});

	it("rejects a formal map leaf with the wrong range or kind", () => {
		const source = "```\nvalue\n```";
		const index = createEditorMarkdownBlockIndex(source);
		const selection = source.indexOf("value");
		const wrongRange = editorCodeBodyMap(source, [
			{ content: "value\n", endLine: 2, kind: "fenced", startLine: 0 },
		]);
		const wrongKind = editorCodeBodyMap(source, [
			{ content: "value\n", endLine: 3, kind: "indented", startLine: 0 },
		]);

		for (const currentCodeMap of [wrongRange, wrongKind]) {
			expect(
				readEditorCodeContent(
					source,
					{ end: selection, start: selection },
					index,
					currentCodeMap,
				),
			).toEqual({
				code: "editor-code-content-body-unavailable",
				status: "unavailable",
			});
		}
	});

	it("returns formal top-level fenced body content with opening indent semantics", () => {
		const source = ["  ```", "  one", "    two", "  ```"].join("\n");
		const selection = source.indexOf("one");
		const currentCodeMap = editorCodeBodyMap(source, [
			{ content: "one\n  two\n", endLine: 4, kind: "fenced", startLine: 0 },
		]);
		const result = readEditorCodeContent(
			source,
			{
				end: selection,
				start: selection,
			},
			undefined,
			currentCodeMap,
		);
		const prepared = readEditorCodeContent(
			source,
			{ end: selection, start: selection },
			createEditorMarkdownBlockIndex(source),
			currentCodeMap,
		);

		expect(result.status).toBe("available");
		if ("available" !== result.status) return;
		expect(prepared).toEqual(result);
		expect(result.content).toBe("one\n  two\n");
	});

	it("returns formal mixed-indent content without losing semantic spaces", () => {
		const source = ["   ```", " a", "  b", "    c", "   ```"].join("\n");
		const selection = source.indexOf("a");
		const currentCodeMap = editorCodeBodyMap(source, [
			{ content: "a\nb\n c\n", endLine: 5, kind: "fenced", startLine: 0 },
		]);
		const result = readEditorCodeContent(
			source,
			{
				end: selection,
				start: selection,
			},
			undefined,
			currentCodeMap,
		);
		const prepared = readEditorCodeContent(
			source,
			{ end: selection, start: selection },
			createEditorMarkdownBlockIndex(source),
			currentCodeMap,
		);

		expect(result.status).toBe("available");
		if ("available" !== result.status) return;
		expect(prepared).toEqual(result);
		expect(result.content).toBe("a\nb\n c\n");
	});

	it("returns formal quote-container content while preserving CRLF", () => {
		const source = [">   ```", ">   one", ">     two", ">   ```"].join("\r\n");
		const selection = source.indexOf("one");
		const currentCodeMap = editorCodeBodyMap(source, [
			{ content: "one\r\n  two\r\n", endLine: 4, kind: "fenced", startLine: 0 },
		]);
		const result = readEditorCodeContent(
			source,
			{
				end: selection,
				start: selection,
			},
			undefined,
			currentCodeMap,
		);
		const prepared = readEditorCodeContent(
			source,
			{ end: selection, start: selection },
			createEditorMarkdownBlockIndex(source),
			currentCodeMap,
		);

		expect(result.status).toBe("available");
		if ("available" !== result.status) return;
		expect(prepared).toEqual(result);
		expect(result.content).toBe("one\r\n  two\r\n");
	});

	it.each([
		{
			expected: "one\n  two\n",
			endLine: 6,
			kind: "fenced" as const,
			name: "unordered list continuation",
			startLine: 2,
			source: ["- item", "", "    ```", "    one", "      two", "    ```"].join(
				"\n",
			),
		},
		{
			expected: "one\n  two\n",
			endLine: 6,
			kind: "fenced" as const,
			name: "ordered list continuation",
			startLine: 2,
			source: [
				"1. item",
				"",
				"     ```",
				"     one",
				"       two",
				"     ```",
			].join("\n"),
		},
		{
			expected: "one\n  two\n",
			endLine: 6,
			kind: "fenced" as const,
			name: "quoted list continuation",
			startLine: 2,
			source: [
				"> - item",
				">",
				">     ```",
				">     one",
				">       two",
				">     ```",
			].join("\n"),
		},
	])(
		"uses the formal code body for $name",
		({ endLine, expected, kind, source, startLine }) => {
			const selection = source.indexOf("one");
			const currentCodeMap = editorCodeBodyMap(source, [
				{ content: expected, endLine, kind, startLine },
			]);
			const unprepared = readEditorCodeContent(
				source,
				{
					end: selection,
					start: selection,
				},
				undefined,
				currentCodeMap,
			);
			const prepared = readEditorCodeContent(
				source,
				{ end: selection, start: selection },
				createEditorMarkdownBlockIndex(source),
				currentCodeMap,
			);

			expect(unprepared).toEqual(prepared);
			expect(prepared).toMatchObject({
				content: expected,
				status: "available",
			});
		},
	);

	it("returns formal fenced tab content without expansion", () => {
		const source = [" ```", "\ta", " ```"].join("\n");
		const selection = source.indexOf("a");
		const currentCodeMap = editorCodeBodyMap(source, [
			{ content: "\ta\n", endLine: 3, kind: "fenced", startLine: 0 },
		]);
		const result = readEditorCodeContent(
			source,
			{
				end: selection,
				start: selection,
			},
			undefined,
			currentCodeMap,
		);

		expect(result.status).toBe("available");
		if ("available" !== result.status) return;
		expect(result.content).toBe("\ta\n");
	});

	it("returns the formal fenced body without fence or info text", () => {
		const source = [
			"before",
			"```ts",
			"const value = 1;",
			"",
			"```",
			"after",
		].join("\r\n");
		const selection = source.indexOf("const value");
		const currentCodeMap = editorCodeBodyMap(source, [
			{
				content: "const value = 1;\r\n\r\n",
				endLine: 5,
				kind: "fenced",
				startLine: 1,
			},
		]);
		const result = readEditorCodeContent(
			source,
			{
				end: selection,
				start: selection,
			},
			undefined,
			currentCodeMap,
		);

		expect(result).toMatchObject({
			content: "const value = 1;\r\n\r\n",
			status: "available",
			target: {
				bodyFrom: source.indexOf("const value"),
				bodyTo: source.indexOf("```", selection),
				from: source.indexOf("```ts"),
				kind: "fenced",
				to: source.indexOf("```", selection) + 3,
			},
		});
	});

	it("keeps an unclosed tilde body available through EOF", () => {
		const source = "~~~python\r\nprint('value')\r\n";
		const selection = source.indexOf("print");
		const currentCodeMap = editorCodeBodyMap(source, [
			{
				content: "print('value')\r\n",
				endLine: 2,
				kind: "fenced",
				startLine: 0,
			},
		]);
		const result = readEditorCodeContent(
			source,
			{
				end: selection + 2,
				start: selection,
			},
			undefined,
			currentCodeMap,
		);

		expect(result).toMatchObject({
			content: "print('value')\r\n",
			status: "available",
			target: {
				bodyFrom: source.indexOf("print"),
				bodyTo: source.length,
				from: 0,
				kind: "fenced",
				to: source.length,
			},
		});
	});

	it("keeps bounded and unprepared EOF reads equivalent, including CRLF", () => {
		const source = ["intro", "", "~~~python", "print('value')", ""].join(
			"\r\n",
		);
		const selection = source.indexOf("print");
		const index = createEditorMarkdownBlockIndex(source);
		const currentCodeMap = editorCodeBodyMap(source, [
			{
				content: "print('value')\r\n",
				endLine: 4,
				kind: "fenced",
				startLine: 2,
			},
		]);
		const prepared = readEditorCodeContent(
			source,
			{ end: selection, start: selection },
			index,
			currentCodeMap,
		);
		const unprepared = readEditorCodeContent(
			source,
			{
				end: selection,
				start: selection,
			},
			undefined,
			currentCodeMap,
		);

		expect(prepared).toMatchObject({
			content: "print('value')\r\n",
			status: "available",
			target: {
				kind: "fenced",
				lineEnd: 4,
				lineStart: 2,
			},
		});
		expect(unprepared).toMatchObject({
			content: "print('value')\r\n",
			status: "available",
			target: {
				kind: "fenced",
				lineEnd: 4,
				lineStart: 2,
			},
		});
	});

	it("rejects ordinary and cross-block selections before bounded code parsing", () => {
		const source = "paragraph\n\n```\nvalue\n```\n\nafter";
		const index = createEditorMarkdownBlockIndex(source);
		const codeStart = source.indexOf("value");
		const currentCodeMap = editorCodeBodyMap(source, [
			{ content: "value\n", endLine: 5, kind: "fenced", startLine: 2 },
		]);

		expect(
			readEditorCodeContent(
				source,
				{ end: 2, start: 0 },
				index,
				currentCodeMap,
			),
		).toEqual({
			code: "editor-code-content-selection-not-code",
			status: "unavailable",
		});
		expect(
			readEditorCodeContent(
				source,
				{ end: source.length, start: codeStart },
				index,
				currentCodeMap,
			),
		).toEqual({
			code: "editor-code-content-selection-not-code",
			status: "unavailable",
		});
	});

	it("returns formal nested fenced content without client prefix parsing", () => {
		const source = [
			"- ```ts",
			"  const value = 1;",
			"  const next = value + 1;",
			"  ```",
		].join("\r\n");
		const selection = source.indexOf("const value");
		const currentCodeMap = editorCodeBodyMap(source, [
			{
				content: "const value = 1;\r\nconst next = value + 1;\r\n",
				endLine: 4,
				kind: "fenced",
				startLine: 0,
			},
		]);
		const result = readEditorCodeContent(
			source,
			{
				end: selection + 5,
				start: selection,
			},
			undefined,
			currentCodeMap,
		);
		const prepared = readEditorCodeContent(
			source,
			{ end: selection + 5, start: selection },
			createEditorMarkdownBlockIndex(source),
			currentCodeMap,
		);

		expect(result.status).toBe("available");
		if ("available" !== result.status) return;
		expect(prepared).toEqual(result);
		expect(result.content).toBe(
			"const value = 1;\r\nconst next = value + 1;\r\n",
		);
		expect(result.target).toMatchObject({ from: 0, kind: "fenced" });
	});

	it("returns formal quote content while preserving the code line ending", () => {
		const source = ["> ```", "> value", "> ```"].join("\r\n");
		const selection = source.indexOf("value");
		const currentCodeMap = editorCodeBodyMap(source, [
			{ content: "value\r\n", endLine: 3, kind: "fenced", startLine: 0 },
		]);
		const result = readEditorCodeContent(
			source,
			{
				end: selection,
				start: selection,
			},
			undefined,
			currentCodeMap,
		);

		expect(result.status).toBe("available");
		if ("available" !== result.status) return;
		expect(result.content).toBe("value\r\n");
		expect(result.target).toMatchObject({ from: 0, kind: "fenced" });
	});

	it("returns formal indented content with program indentation", () => {
		const source =
			"intro\n\n    const value = 1;\n      return value;\n\nafter";
		const selection = source.indexOf("const value");
		const currentCodeMap = editorCodeBodyMap(source, [
			{
				content: "const value = 1;\n  return value;",
				endLine: 4,
				kind: "indented",
				startLine: 2,
			},
		]);
		const result = readEditorCodeContent(
			source,
			{
				end: selection,
				start: selection,
			},
			undefined,
			currentCodeMap,
		);

		expect(result).toMatchObject({
			content: "const value = 1;\n  return value;",
			status: "available",
			target: {
				bodyFrom: source.indexOf("const value"),
				bodyTo: source.indexOf("\n\nafter"),
				from: source.indexOf("    const"),
				kind: "indented",
				to: source.indexOf("\n\nafter"),
			},
		});
	});

	it("allows an empty fenced body at its parser-proven body boundary", () => {
		const source = "```\n```";
		const currentCodeMap = editorCodeBodyMap(source, [
			{ content: "", endLine: 2, kind: "fenced", startLine: 0 },
		]);
		const result = readEditorCodeContent(
			source,
			{ end: 4, start: 4 },
			undefined,
			currentCodeMap,
		);

		expect(result).toMatchObject({
			content: "",
			status: "available",
			target: {
				bodyFrom: 4,
				bodyTo: 4,
				from: 0,
				kind: "fenced",
				to: source.length,
			},
		});
	});

	it("rejects mixed selections and a stale block index", () => {
		const source = "```\nvalue\n```\n\nparagraph";
		const codeStart = source.indexOf("value");
		const currentCodeMap = editorCodeBodyMap(source, [
			{ content: "value\n", endLine: 3, kind: "fenced", startLine: 0 },
		]);
		const mixed = readEditorCodeContent(
			source,
			{
				end: source.length,
				start: codeStart,
			},
			undefined,
			currentCodeMap,
		);
		expect(mixed).toEqual({
			code: "editor-code-content-selection-not-code",
			status: "unavailable",
		});

		const stale = readEditorCodeContent(
			`${source}!`,
			{ end: codeStart, start: codeStart },
			createEditorMarkdownBlockIndex(source),
			currentCodeMap,
		);
		expect(stale).toEqual({
			code: "editor-code-content-block-index-stale",
			status: "unavailable",
		});
	});
});
