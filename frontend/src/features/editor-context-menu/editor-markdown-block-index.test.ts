import { describe, expect, it } from "vitest";
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownParser } from "@lezer/markdown";

import {
	createEditorMarkdownBlockIndex as createProfiledMarkdownBlockIndex,
	type EditorMarkdownBlockKind,
	findEditorMarkdownBlock,
} from "./editor-markdown-block-index";
import { installLinearInlineResolver } from "./editor-markdown-inline-markers";
import {
	createLinearLinkEndParser,
	parseLinearImage,
	parseLinearLink,
} from "./editor-markdown-linear-link-parser";
import { runGeneratedContextMenuAction } from "./editor-context-menu-generated-actions";
import type { EditorContextMenuActionSession } from "./editor-context-menu-action-coordinator";
import {
	type EditorCodeBodyMap,
	findEditorCodeContentTarget,
	readEditorCodeContent,
} from "./editor-code-content-target";
import { associateGeneratedContentTarget } from "../generated-content-export/generated-content-target";
import { markdownReferenceLabels, type MarkdownSyntaxNode } from "./editor-markdown-link-preparation";
import { mathRanges } from "./editor-markdown-math-preparation";

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
	it("uses the explicit renderer profile to project Unicode reference links", () => {
		const source = "[STRASSE]: /target\n\n[Stra\u00dfe]";
		const index = createEditorMarkdownBlockIndex(source, { referenceLabelCaseFoldProfile: 14 });
		expect(index.linkCandidates?.map((link) => source.slice(link.from, link.to))).toEqual(["[Stra\u00dfe]"]);
	});

	it("rejects an unsupported Unicode reference proof without rejecting ordinary Unicode prose", () => {
		const options = { referenceLabelCaseFoldProfile: "unsupported" as const };
		expect(() => createEditorMarkdownBlockIndex("Ordinary \u00df prose", options)).not.toThrow();
		expect(() => createEditorMarkdownBlockIndex("[STRASSE]: /x\n\n[Stra\u00dfe]", options))
			.toThrow("visual-editor-reference-label-fold-profile-unavailable");
		expect(createEditorMarkdownBlockIndex("[a]: /x\n\n[a]", options).linkCandidates).toHaveLength(1);
	});

	it("projects only parser-owned reference definitions using the existing label normalization", () => {
		const source = "[ Some   Label ]: https://example.test/a\n\n```\n[hidden]: https://example.test/b\n```";
		const nodes: MarkdownSyntaxNode[] = [];
		markdownLanguage.parser.parse(source).iterate({ enter(node) { nodes.push({ from: node.from, name: node.name, to: node.to }); } });
		const labels = markdownReferenceLabels(source, nodes, 14);
		expect(labels.has("some label")).toBe(true);
		expect(labels.has("hidden")).toBe(false);
		expect(labels.has("missing")).toBe(false);
	});
	it("prepares the exact link candidates with their block ranges", () => {
		const source =
			'Before [caption](https://example.test "a)b") and <https://auto.test/x>\n\n[标题][引用]\n\n[引用]: https://example.test/ref';
		const index = createEditorMarkdownBlockIndex(source);

		expect(
			(index.linkCandidates ?? []).map((candidate) => ({
				blockKind: index.blocks.find(
					(block) =>
						block.from === candidate.blockFrom &&
						block.to === candidate.blockTo,
				)?.kind,
				from: source.slice(candidate.from, candidate.to),
				kind: candidate.kind,
				reference: candidate.reference,
			})),
		).toEqual([
			{
				blockKind: "paragraph",
				from: '[caption](https://example.test "a)b")',
				kind: "link",
				reference: false,
			},
			{
				blockKind: "paragraph",
				from: "<https://auto.test/x>",
				kind: "autolink",
				reference: false,
			},
			{
				blockKind: "paragraph",
				from: "[标题][引用]",
				kind: "link",
				reference: true,
			},
		]);
	});

	it("keeps rendered link ownership unique and non-overlapping for nested syntax", () => {
		const source =
			"[<https://inner.test>](https://outer.test) [tail](https://tail.test)";
		const index = createEditorMarkdownBlockIndex(source);
		const candidates = index.linkCandidates ?? [];

		expect(
			candidates.map((candidate) => source.slice(candidate.from, candidate.to)),
		).toEqual([
			"[<https://inner.test>](https://outer.test)",
			"[tail](https://tail.test)",
		]);
		for (const [position, candidate] of candidates.entries()) {
			const previous = candidates[position - 1];
			if (previous) expect(candidate.from).toBeGreaterThanOrEqual(previous.to);
		}
	});

	it("keeps images and code spans out of the prepared candidates", () => {
		const index = createEditorMarkdownBlockIndex(
			"![image](https://image.test)\n\n`[caption](https://example.test)`",
		);

		expect(index.linkCandidates).toEqual([]);
	});

	it("never prepares a partially typed inline link as a link candidate", () => {
		const source = "[caption](https://example.test";
		const index = createEditorMarkdownBlockIndex(source);

		expect(
			(index.linkCandidates ?? []).map((candidate) =>
				source.slice(candidate.from, candidate.to),
			),
		).toEqual(["https://example.test"]);
	});

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

	it("scans all four math delimiter forms linearly with exact masking and escape parity", () => {
		expect(mathRanges("$$a$$ \\[b\\] \\(c\\) $d$", [])).toEqual([
			{ block: true, from: 0, to: 5 },
			{ block: true, from: 6, to: 11 },
			{ block: false, from: 12, to: 17 },
			{ block: false, from: 18, to: 21 },
		]);

		// Empty bodies are rejected while 5-dollar `$$$$$` matches `[0, 5)` like `/\$\$[\s\S]+?\$\$/gu`.
		expect(mathRanges("$$$$ \\[\\] \\(\\)", [])).toEqual([]);
		expect(mathRanges("$$$$$", [])).toEqual([{ block: true, from: 0, to: 5 }]);

		// Block math masks its span with a leading newline so outer `$...$` cannot pair across it.
		expect(mathRanges("$a $$b$$ c$", [])).toEqual([
			{ block: true, from: 3, to: 8 },
		]);
		expect(mathRanges("\\[ $inner$ \\] \\( $inner2$ \\)", [])).toEqual([
			{ block: true, from: 0, to: 13 },
			{ block: false, from: 14, to: 28 },
		]);

		// Escaped dollar signs and adjacent `$$a$` follow exact inline `$...$` semantics.
		expect(mathRanges("$$a$", [])).toEqual([{ block: false, from: 1, to: 4 }]);
		expect(mathRanges("$a\\$b$c$", [])).toEqual([
			{ block: false, from: 5, to: 8 },
		]);
		expect(mathRanges("\\$not-math\n$ok$\n$also\\$", [])).toEqual([
			{ block: false, from: 11, to: 15 },
		]);
		expect(mathRanges("\\$a$ $b$", [])).toEqual([
			{ block: false, from: 3, to: 6 },
		]);
		expect(mathRanges("$$😀$$", [])).toEqual([
			{ block: true, from: 0, to: 6 },
		]);

		// Linear scaling on 20k unmatched delimiters (no O(N^2) backtracking).
		const unmatchedBrackets = `${"\\[ ".repeat(20_000)}word`;
		const unmatchedDollars = `${"$\\$ ".repeat(20_000)}$x$`;
		const startedAt = performance.now();
		expect(mathRanges(unmatchedBrackets, [])).toEqual([]);
		const dollarMatches = mathRanges(unmatchedDollars, []);
		const elapsedMs = performance.now() - startedAt;

		expect(dollarMatches).toEqual([
			{
				block: false,
				from: unmatchedDollars.length - 3,
				to: unmatchedDollars.length,
			},
		]);
		expect(elapsedMs).toBeLessThan(100);
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

describe("createEditorMarkdownBlockIndex canonical raw-backtick protection", () => {
	// Parser-free PHP `inline_code_ranges()` parity (verified against PHP 8.3.37).
	const mathTexts = (source: string): string[] =>
		createEditorMarkdownBlockIndex(source).mathSpans.map((span) => source.slice(span.from, span.to));

	it("pairs raw backticks across blank lines before extracting math", () => {
		expect(mathTexts("Para 1 `\n\nPara 2 $x$\n\nPara 3 `")).toEqual([]);
		expect(mathTexts("``a` $x$ ``")).toEqual([]);
	});

	it("skips escaped openers and never pairs across fenced code", () => {
		expect(mathTexts("\\`$x$`")).toEqual(["$x$"]);
		expect(mathTexts("` $x$\n\n```\n`\n```")).toEqual(["$x$"]);
	});

	it("aligns cross-paragraph inline math and quoted indented math with live PHP two-stage parsing (R23-2a, R23-2b, R24A #1, R30B #1)", () => {
		for (const crossParagraph of ["\\(a\n\n**word!** \\)", "\\(a\n\nword \\)"]) {
			const index = createEditorMarkdownBlockIndex(crossParagraph);
			expect(index.mathSpans).toEqual([
				{
					bodyFrom: 2,
					bodyTo: crossParagraph.length - 2,
					displayMode: false,
					from: 0,
					to: crossParagraph.length,
				},
			]);
			expect(index.blocks).toEqual([
				{
					editable: true,
					from: 0,
					kind: "paragraph",
					lineEnd: 2,
					lineStart: 0,
					to: crossParagraph.length,
				},
			]);
		}

		const quotedIndented = ">     $$x\n**word**$$";
		const quotedIndex = createEditorMarkdownBlockIndex(quotedIndented);
		expect(quotedIndex.mathSpans.map((span) => quotedIndented.slice(span.from, span.to))).toEqual([
			"$$x\n**word**$$",
		]);
		expect(quotedIndex.blocks.some((block) => "math" === block.kind)).toBe(true);
	});

	it("aligns empty ListItem blank-line termination and League 2.8.2 single-char-remainder padding with PHP (R25A #1, R26B #1, R26A #2)", () => {
		for (const source of [
			"-\n\n    **word** $x$",
			"-\r\n\r\n    **word** $x$",
			"1.\n\n    **word** $x$",
			"- a\n-\n\n    **word** $x$",
			"-\n\n\t**word** $x$",
			"-\n\n  para\n\n    **word** $x$",
		]) {
			const index = createEditorMarkdownBlockIndex(source);
			expect(index.mathSpans, `expected zero mathSpans for ${JSON.stringify(source)}`).toEqual([]);
			const block = findEditorMarkdownBlock(index, source.indexOf("word"));
			expect(block?.kind, `expected code block for ${JSON.stringify(source)}`).toBe("code");
		}
		for (const source of [
			"- -\n\n      **word** $x$",
			"-  -\n\n      **word** $x$",
			"-  -\r\n\r\n      **word** $x$",
		]) {
			const index = createEditorMarkdownBlockIndex(source);
			expect(index.mathSpans, `expected zero mathSpans for ${JSON.stringify(source)}`).toEqual([]);
			expect(findEditorMarkdownBlock(index, source.indexOf("word"))?.kind).toBe("list");
		}
		// Without a backtick/tilde/top-level 4-space line, PHP skips code-block
		// scanning so `$$` opens block math spanning `hello **word** $$`.
		const quotedMath = "> -\n>\n>     $$\n\nhello **word** $$";
		const quotedMathIndex = createEditorMarkdownBlockIndex(quotedMath);
		expect(quotedMathIndex.mathSpans.map((span) => quotedMath.slice(span.from, span.to))).toEqual([
			"$$\n\nhello **word** $$",
		]);
		expect(findEditorMarkdownBlock(quotedMathIndex, quotedMath.indexOf("word"))?.kind).toBe("math");

		// Quoted inline math without top-level 4-space/tab line matches live PHP 8.3.37.
		const quotedInline = "> -\n> \n>     **word** $x$";
		const quotedInlineIndex = createEditorMarkdownBlockIndex(quotedInline);
		expect(quotedInlineIndex.mathSpans.map((span) => quotedInline.slice(span.from, span.to))).toEqual([
			"$x$",
		]);
		expect(findEditorMarkdownBlock(quotedInlineIndex, quotedInline.indexOf("word"))?.kind).toBe("quote");

		// Non-code variants keep their PHP-accurate host block and inline math span.
		const trailingPara = "-\n\n  **word** $x$";
		const trailingParaIndex = createEditorMarkdownBlockIndex(trailingPara);
		expect(trailingParaIndex.mathSpans.map((span) => trailingPara.slice(span.from, span.to))).toEqual(["$x$"]);
		expect(findEditorMarkdownBlock(trailingParaIndex, trailingPara.indexOf("word"))?.kind).toBe("paragraph");
		for (const source of [
			"-\n    **word** $x$",
			"- -\n\n    **word** $x$",
		]) {
			const index = createEditorMarkdownBlockIndex(source);
			expect(index.mathSpans.map((span) => source.slice(span.from, span.to))).toEqual(["$x$"]);
			expect(findEditorMarkdownBlock(index, source.indexOf("word"))?.kind).toBe("list");
		}
	});
});

function createEditorMarkdownBlockIndex(source: string, options: Parameters<typeof createProfiledMarkdownBlockIndex>[1] = { referenceLabelCaseFoldProfile: 14 }) {
  return createProfiledMarkdownBlockIndex(source, options);
}

describe("editor-markdown-block-index Stage 4 Round 27 unified League block rules (PHP 8.3.37 / League 2.8.2)", () => {
	it("never lets same-container nested list markers interrupt a paragraph (R27B #2a)", () => {
		for (const source of [
			"1. ab\n   2. c\n\n       **word** $x$",
			"1. ab\r\n   2. c\r\n\r\n       **word** $x$",
			"1. ab\n   2) c\n\n       **word** $x$",
			"+ a\n  +\n\n      **word** $x$",
		]) {
			const index = createEditorMarkdownBlockIndex(source);
			expect(index.mathSpans, `expected zero mathSpans for ${JSON.stringify(source)}`).toEqual([]);
		}
		for (const source of [
			"1. ab\n2. c\n\n   **word** $x$",
			"> para\n2. c\n\n   **word** $x$",
			"1. ab\n   1. c\n\n      **word** $x$",
			"- a\n  - b\n\n    **word** $x$",
		]) {
			const index = createEditorMarkdownBlockIndex(source);
			expect(index.mathSpans.map((span) => source.slice(span.from, span.to)), JSON.stringify(source)).toEqual(["$x$"]);
		}
	});

	it("applies League HTML block Types 1-7 in the block-index parser (R27B #2b)", () => {
		for (const source of [
			"para\n<textarea>\n$x$\n</textarea>",
			"para\r\n<textarea>\r\n$x$\r\n</textarea>",
			"<!doctype html\n$x$\n>",
			"<![cdata[\n$x$\n]]>",
			"<pre/>\n$x$",
		]) {
			const index = createEditorMarkdownBlockIndex(source);
			expect(index.mathSpans, `expected zero mathSpans for ${JSON.stringify(source)}`).toEqual([]);
		}
		const imageSource = "<pre>\n</textarea>\n![alt](https://example.com/a.png)\n</pre>";
		const imageIndex = createEditorMarkdownBlockIndex(imageSource);
		expect(imageIndex.imageRanges.map((range) => imageSource.slice(range.from, range.to))).toEqual([
			"![alt](https://example.com/a.png)",
		]);
		// Shared `markdownLanguage.parser` stays on upstream rules.
		expect(markdownLanguage.parser.parse("<pre/>\n$x$").topNode.firstChild?.name).not.toBe("HTMLBlock");
	});
});

describe("editor-markdown-block-index Stage 4 Round 28 HTML block math visibility (PHP 8.3.37 / League 2.8.2)", () => {
	it("lets block math terminate blank-line HTML blocks (Types 6/7) while inline math stays shielded (R28A #3)", () => {
		const cases: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
			["<pre/>\n$$x$$", ["$$x$$"]],
			["<pre/>\n$x$", []],
			["<div>\n$$x$$", ["$$x$$"]],
			["<div>\n$x$", []],
			["<textarea>\n$$x$$\n</textarea>", []],
			["<!doctype html\n$$x$$\n>", []],
			["<![cdata[\n$$x$$\n]]>", []],
			["<!--\n$$x$$\n-->", []],
			["<pre/>$$x$$", ["$$x$$"]],
			['<div class="$$x$$">', ["$$x$$"]],
			["<pre/>\n$$x$$\n**word**", ["$$x$$"]],
		];
		for (const [lfSource, expected] of cases) {
			for (const source of [lfSource, lfSource.replace(/\n/g, "\r\n")]) {
				const index = createEditorMarkdownBlockIndex(source);
				expect(index.mathSpans.map((span) => source.slice(span.from, span.to)), JSON.stringify(source)).toEqual(expected);
				for (const span of index.mathSpans) {
					expect(index.blocks.some((block) => "math" === block.kind && block.editable && block.from === span.from && block.to === span.to)).toBe(true);
				}
			}
		}
		expect(createEditorMarkdownBlockIndex("<pre/>\n$$x$$").mathSpans.map((span) => [span.from, span.to])).toEqual([[7, 12]]);
		expect(createEditorMarkdownBlockIndex("<div>\n$$x$$").mathSpans.map((span) => [span.from, span.to])).toEqual([[6, 11]]);
		// Remaining HTML pieces stay non-editable.
		expect(createEditorMarkdownBlockIndex("<pre/>\n$$x$$").blocks.map((block) => [block.kind, block.from, block.to, block.editable])).toEqual([
			["unavailable", 0, 6, false],
			["math", 7, 12, true],
		]);
	});
});

describe("editor-markdown-block-index Stage 4 Round 29 blockquote indent & PHP two-stage HTML+math parity (PHP 8.3.37 / League 2.8.2)", () => {
	it("closes blockquotes on >=4-column indented `>` lines so code-block math/backticks never drift ordinals (R29B #1)", () => {
		for (const lfSource of [
			"> a\n>\n    > $x$\n\n$z$",
			"> a\n>\n\t> $x$\n\n$z$",
			"> a\n>\n    > `code\n\n$z$\n\n`",
			"> a\n>\n    > $$\n\n$z$\n\n$$",
		]) {
			for (const source of [lfSource, lfSource.replace(/\n/g, "\r\n")]) {
				const index = createEditorMarkdownBlockIndex(source);
				expect(
					index.mathSpans.map((span) => [source.slice(span.from, span.to), span.displayMode]),
					JSON.stringify(source),
				).toEqual([["$z$", false]]);
			}
		}
	});

	it("mirrors PHP extract_math() -> parse order when math overlaps HTML/comment/PI blocks (R29A #1, R29A #2, R29B #3)", () => {
		const cases: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, boolean]>]> = [
			["<div>\n$$x$$\n<!-- $$y$$ -->", [["$$x$$", true]]],
			["<pre/>\n$$x$$\n$y$", [["$$x$$", true], ["$y$", false]]],
			["<div>\n$$x$$\n$y$\n\n$z$", [["$$x$$", true], ["$y$", false], ["$z$", false]]],
			["<pre/>\n$$x$$\n$y$\n\n$z$", [["$$x$$", true], ["$y$", false], ["$z$", false]]],
			["<div> $$x$$ $y$", [["$$x$$", true], ["$y$", false]]],
			["<div>\n$$x$$\nhello", [["$$x$$", true]]],
			["<pre>foo</pre> $$x$$\n\n$z$", [["$$x$$", true], ["$z$", false]]],
			["<!-- c --> $$x$$\n\n$z$", [["$$x$$", true], ["$z$", false]]],
			["<!DOCTYPE html> $$x$$\n\n$z$", [["$$x$$", true], ["$z$", false]]],
			["<?php ?> $$x$$\n\n$z$", [["$$x$$", true], ["$z$", false]]],
			["<![CDATA[x]]> $$x$$\n\n$z$", [["$$x$$", true], ["$z$", false]]],
			["<pre>foo</pre> $x$", []],
			["<!--\n$$x\n-->\n$$\n\n$z$", []],
			["<div>\n$x$\n</div>", []],
			["<pre/>\n$$x$$", [["$$x$$", true]]],
			["<pre/>\n$x$", []],
			["<textarea>\n$$x$$\n</textarea>", []],
			["<!doctype html\n$$x$$\n>", []],
			["<![cdata[\n$$x$$\n]]>", []],
			["<!--\n$$x$$\n-->", []],
			["> <div>\n> $$x$$\n> $y$", [["$$x$$", true], ["$y$", false]]],
			["> <!--\n> $x$\n> -->", []],
		];
		for (const [lfSource, expected] of cases) {
			for (const source of [lfSource, lfSource.replace(/\n/g, "\r\n")]) {
				const index = createEditorMarkdownBlockIndex(source);
				expect(
					index.mathSpans.map((span) => [source.slice(span.from, span.to), span.displayMode]),
					JSON.stringify(source),
				).toEqual(expected);
			}
		}

		// Exact span & block invariants called out by R29A #1, R29A #2, R29B #3.
		const commentAfterBlock = createEditorMarkdownBlockIndex("<div>\n$$x$$\n<!-- $$y$$ -->");
		expect(commentAfterBlock.mathSpans.map((span) => [span.from, span.to])).toEqual([[6, 11]]);
		expect(commentAfterBlock.blocks.map((block) => [block.kind, block.from, block.to, block.editable])).toEqual([
			["unavailable", 0, 5, false],
			["math", 6, 11, true],
			["unavailable", 12, 26, false],
		]);

		const preBlockInline = createEditorMarkdownBlockIndex("<pre/>\n$$x$$\n$y$");
		expect(preBlockInline.mathSpans.map((span) => [span.from, span.to])).toEqual([[7, 12], [13, 16]]);

		const divProse = createEditorMarkdownBlockIndex("<div>\n$$x$$\nhello");
		expect(findEditorMarkdownBlock(divProse, "<div>\n$$x$$\nhello".indexOf("hello"))).toMatchObject({
			editable: true,
			kind: "paragraph",
		});

		const unfragmentedDiv = createEditorMarkdownBlockIndex("<div>\n$x$\n</div>");
		expect(unfragmentedDiv.mathSpans).toEqual([]);
		expect(unfragmentedDiv.blocks).toEqual([
			{ editable: false, from: 0, kind: "unavailable", lineEnd: 2, lineStart: 0, to: 16 },
		]);

		const unfragmentedDivCrlf = createEditorMarkdownBlockIndex("<div>\r\n$x$\r\n</div>");
		expect(unfragmentedDivCrlf.mathSpans).toEqual([]);
		expect(unfragmentedDivCrlf.blocks).toEqual([
			{ editable: false, from: 0, kind: "unavailable", lineEnd: 2, lineStart: 0, to: 18 },
		]);

		// Images and links after a block-math-terminated HTML block stay indexed cleanly.
		const imgDoc = "<div>\n$$x$$\n![alt](https://example.com/a.png)";
		const imgIndex = createEditorMarkdownBlockIndex(imgDoc);
		expect(imgIndex.imageRanges.map((range) => imgDoc.slice(range.from, range.to))).toEqual([
			"![alt](https://example.com/a.png)",
		]);
		const linkDoc = "<div>\n$$x$$\n[label](https://example.com)";
		const linkIndex = createEditorMarkdownBlockIndex(linkDoc);
		expect(linkIndex.linkCandidates?.map((candidate) => linkDoc.slice(candidate.from, candidate.to))).toEqual([
			"[label](https://example.com)",
		]);
	});
});

describe("editor-markdown-block-index Stage 4 Round 30 unified PHP two-stage pipeline, inline HTML stripping, and O(1) line end (PHP 8.3.37 / League 2.8.2)", () => {
	it("mirrors live PHP for math-created HTML blocks, reference definitions, and post-block-math Markdown blocks (R30B #1)", () => {
		const mathCases: ReadonlyArray<
			Readonly<{
				blockKinds?: ReadonlyArray<EditorMarkdownBlockKind>;
				expectedLinks?: ReadonlyArray<string>;
				expectedMath: ReadonlyArray<readonly [string, boolean]>;
				source: string;
			}>
		> = [
			{
				blockKinds: ["paragraph", "math", "unavailable"],
				expectedMath: [["$$x$$", true]],
				source: "para\n$$x$$\n<custom>\n$y$\n</custom>",
			},
			{
				blockKinds: ["paragraph", "math", "unavailable"],
				expectedMath: [["$$x$$", true]],
				source: "para $$x$$ <div>\n$y$",
			},
			{
				blockKinds: ["paragraph", "math", "unavailable"],
				expectedMath: [["$$x$$", true]],
				source: "para $$x$$ <!--\n$y$\n-->",
			},
			{
				blockKinds: ["paragraph", "math", "unavailable"],
				expectedMath: [["$$x$$", true]],
				source: "para $$x$$ <pre>\n$y$\n</pre>",
			},
			{
				expectedLinks: [],
				expectedMath: [["$$x$$", true]],
				source: '[a]: /url "$$x$$"\n\n[a]',
			},
			{
				expectedLinks: ["[a]"],
				expectedMath: [["$$x$$", true]],
				source: "[a]: /$$x$$\n\n[a]",
			},
			{
				expectedLinks: [],
				expectedMath: [
					["$$x$$", true],
					["$$x$$", true],
				],
				source: "[$$x$$]: /url\n\n[$$x$$]",
			},
			{
				expectedLinks: ["[ref]"],
				expectedMath: [["$$x$$", true]],
				source: "para $$x$$ [ref]: /url\n\n[ref]",
			},
			{
				blockKinds: ["paragraph", "math", "heading"],
				expectedMath: [["$$x$$", true]],
				source: "para $$x$$ # heading",
			},
			{
				blockKinds: ["paragraph", "math", "quote"],
				expectedMath: [["$$x$$", true]],
				source: "para $$x$$ > quote",
			},
			{
				blockKinds: ["paragraph", "math", "thematic-break"],
				expectedMath: [["$$x$$", true]],
				source: "para $$x$$ ---",
			},
			{
				blockKinds: ["heading", "math", "paragraph"],
				expectedMath: [["$$b$$", true]],
				source: "# h $$b$$ t",
			},
			{
				blockKinds: ["quote", "math"],
				expectedMath: [["$$x$$", true]],
				source: "> $$x$$",
			},
			{
				blockKinds: ["list", "math"],
				expectedMath: [["$$x$$", true]],
				source: "- $$x$$",
			},
		];

		for (const testCase of mathCases) {
			for (const source of [testCase.source, testCase.source.replace(/\n/g, "\r\n")]) {
				const index = createEditorMarkdownBlockIndex(source);
				expect(
					index.mathSpans.map((span) => [source.slice(span.from, span.to), span.displayMode]),
					JSON.stringify(source),
				).toEqual(testCase.expectedMath);
				if (testCase.blockKinds) {
					expect(
						index.blocks.map((block) => block.kind),
						JSON.stringify(source),
					).toEqual(testCase.blockKinds);
				}
				if (testCase.expectedLinks) {
					expect(
						(index.linkCandidates ?? []).map((candidate) =>
							source.slice(candidate.from, candidate.to),
						),
						JSON.stringify(source),
					).toEqual(testCase.expectedLinks);
				}
			}
		}
	});

	it("preserves non-local invariance when prepending an unrelated HTML+math prefix (R30B #1)", () => {
		const fixtures = [
			"para\n$$x$$\n<custom>\n$y$\n</custom>",
			"para $$x$$ <div>\n$y$",
			'[a]: /url "$$x$$"\n\n[a]',
			"[a]: /$$x$$\n\n[a]",
			"para $$x$$ [ref]: /url\n\n[ref]",
			"para $$x$$ # heading",
			"para $$x$$ > quote",
			"para $$x$$ ---",
			"# h $$b$$ t",
			'<span title="$y$">hi</span>',
			"<span>$y$</span>",
		];
		for (const lfBody of fixtures) {
			for (const newline of ["\n", "\r\n"] as const) {
				const body = lfBody.replace(/\n/g, newline);
				const prefix = `<div>${newline}$$a$$${newline}${newline}`;
				const combined = prefix + body;
				const standalone = createEditorMarkdownBlockIndex(body);
				const prefixed = createEditorMarkdownBlockIndex(combined);
				const offset = prefix.length;

				const downstreamBlocks = prefixed.blocks
					.filter((block) => block.from >= offset)
					.map((block) => ({
						editable: block.editable,
						from: block.from - offset,
						kind: block.kind,
						to: block.to - offset,
					}));
				const standaloneBlocks = standalone.blocks.map((block) => ({
					editable: block.editable,
					from: block.from,
					kind: block.kind,
					to: block.to,
				}));
				expect(downstreamBlocks, JSON.stringify(body)).toEqual(standaloneBlocks);

				const downstreamMath = prefixed.mathSpans
					.filter((span) => span.from >= offset)
					.map((span) => [combined.slice(span.from, span.to), span.displayMode]);
				const standaloneMath = standalone.mathSpans.map((span) => [
					body.slice(span.from, span.to),
					span.displayMode,
				]);
				expect(downstreamMath, JSON.stringify(body)).toEqual(standaloneMath);
			}
		}
	});

	it("excludes stripped inline HTML tags, comments, and processing instructions from math survival while keeping content between tags (R30A #1, R30B #2)", () => {
		const cases: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, boolean]>]> = [
			['<div>\n$$x$$\nA <i title="$y$">word</i> $z$', [["$$x$$", true], ["$z$", false]]],
			['<div>\n$$x$$\n<span title="$y$">hi</span>', [["$$x$$", true]]],
			["<div>\n$$x$$\na <!-- $y$ --> b", [["$$x$$", true]]],
			['<span title="$y$">hi</span>', []],
			["<span>$y$</span>", [["$y$", false]]],
			["a <!-- $y$ --> b", []],
			["a <?php $y$ ?> b", []],
		];
		for (const [lfSource, expected] of cases) {
			for (const source of [lfSource, lfSource.replace(/\n/g, "\r\n")]) {
				const index = createEditorMarkdownBlockIndex(source);
				expect(
					index.mathSpans.map((span) => [source.slice(span.from, span.to), span.displayMode]),
					JSON.stringify(source),
				).toEqual(expected);
			}
		}
	});

	it("targets and deletes rendered $z$ without mutating stripped <i title=\"$y$\"> across LF and CRLF (R30A #1, R30B #2)", async () => {
		for (const newline of ["\n", "\r\n"] as const) {
			const source = `<div>${newline}$$x$$${newline}A <i title="$y$">word</i> $z$`;
			const index = createEditorMarkdownBlockIndex(source);
			const paragraphBlock = index.blocks.find((block) => "paragraph" === block.kind);
			expect(paragraphBlock).toBeDefined();
			if (!paragraphBlock) continue;

			const blockMathSpans = index.mathSpans.filter(
				(span) => span.from >= paragraphBlock.from && span.to <= paragraphBlock.to,
			);
			expect(blockMathSpans.map((span) => source.slice(span.from, span.to))).toEqual(["$z$"]);

			const associated = associateGeneratedContentTarget({
				acceptedPreview: { revision: 1, signature: "r30-inline-html-strip" },
				blockId: "visual-block-1",
				kind: "math",
				mathSpans: blockMathSpans,
				ordinal: 0,
				source,
				sourceRevision: 1,
			});
			expect(associated.status).toBe("associated");
			if ("associated" !== associated.status) continue;
			expect(associated.target.original.full).toBe("$z$");
			expect(associated.target.original.body).toBe("z");

			let currentValue = source;
			const reported: string[] = [];
			const session = {
				actionContext: {
					generated: {
						canCopyImage: false,
						canCopyMathMl: false,
						canUseSource: true,
						identity: () => null,
						kind: "math" as const,
						lease: {
							isCurrent: () => true,
							release: () => {},
							root: {} as Element,
							target: associated.target,
						},
						mode: "split" as const,
						validateLease: () => true,
					},
				},
				applyEdit(edit: Readonly<{ value: string }>) {
					currentValue = edit.value;
				},
				capabilities: {
					contextMenuStrings: {},
					generated: {
						exportSession: null,
						prepareSourceNavigation: () => false,
					},
				},
				captured: {
					direction: "ltr" as const,
					position: { x: 0, y: 0 },
					revision: 1,
					selection: {
						direction: "none" as const,
						end: associated.target.original.fullRange.to,
						start: associated.target.original.fullRange.from,
					},
					surface: "preview" as const,
					value: source,
				},
				clipboard: {
					read: async () => ({ code: "unavailable", status: "unavailable" as const }),
					write: async () => ({ code: "unavailable", status: "unavailable" as const }),
				},
				currentBlockIndex: () => index,
				document: { revealPosition: () => {} },
				ensureCurrent: () => true,
				ensureSelectionFitsTarget: () => true,
				readValue: () => currentValue,
				report: (code: string) => {
					reported.push(code);
				},
			} as unknown as EditorContextMenuActionSession;

			await runGeneratedContextMenuAction("delete-generated-content", session);
			expect(reported).toEqual([]);
			expect(currentValue).toBe(`<div>${newline}$$x$$${newline}A <i title="$y$">word</i> `);
			expect(currentValue).toContain('title="$y$"');
			expect(currentValue).not.toContain("$z$");
		}
	});

	it("scales linearly on a 220 KB single-line HTML+math document with O(1) line-end lookups (R30A #2)", () => {
		const source = `<div> ${"$$x$$ word ".repeat(20_000).trimEnd()}`;
		expect(source.length).toBe(220_005);
		const startedAt = performance.now();
		const index = createEditorMarkdownBlockIndex(source);
		const elapsedMs = performance.now() - startedAt;

		expect(index.mathSpans).toHaveLength(20_000);
		expect(index.blocks).toHaveLength(40_001);
		expect(elapsedMs).toBeLessThan(1_500);
	});

	it("matches League CommonMark 2.8.2 on all 9 inline-HTML divergence classes and edge cases across LF and CRLF (R31A #1, R31B #1)", () => {
		const cases: ReadonlyArray<
			readonly [string, ReadonlyArray<readonly [string, boolean]>]
		> = [
			["A < x $y$ > and $z$", [["$y$", false], ["$z$", false]]],
			['a <SPAN title="$x$">hi</SPAN> b', [["$x$", false]]],
			['a <span TITLE="$x$">hi</span> b', [["$x$", false]]],
			["a <!---> $x$ --> b", [["$x$", false]]],
			["a <!--> $x$ --> b", [["$x$", false]]],
			["a <!-- -- $x$ --> b", []],
			["a <!-- $x$ ---> b", []],
			["a <!doctype $x$> b", []],
			["a <!DOCTYPE $x$> b", []],
			['a <br title="$x$"/ > b', [["$x$", false]]],
			['a <br title="$x$"/> b', []],
			['a <a_b title="$x$">hi</a_b>', [["$x$", false]]],
			["a <![CDATA[$x$]]> b", []],
			["a <? $x$ ?> b", []],
			["a <??> $x$ ?> b", [["$x$", false]]],
			["a <?> $x$ ?> b", []],
			["a <https://example.com/$x$> b", [["$x$", false]]],
			['a <a href="$x$">hi</a> b', []],
			['a <span\u00a0title="$x$">hi</span> b', []],
			['a <span\ufefftitle="$x$">hi</span> b', [["$x$", false]]],
			["a\n< x $y$ >\nand $z$", [["$y$", false], ["$z$", false]]],
			['a\n<SPAN title="$x$">\nhi</SPAN>', [["$x$", false]]],
		];
		for (const [lfSource, expected] of cases) {
			for (const source of [lfSource, lfSource.replace(/\n/g, "\r\n")]) {
				const index = createEditorMarkdownBlockIndex(source);
				expect(
					index.mathSpans.map((span) => [
						source.slice(span.from, span.to),
						span.displayMode,
					]),
					JSON.stringify(source),
				).toEqual(expected);
			}
		}
	});

	it("stays strictly O(N) on 30 KB and 100 KB space runs (with and without math) and repeated `<` tokens (R31B #2)", () => {
		const inputs = [
			{ expectedMath: 0, label: "30KB spaces", source: `a${" ".repeat(30_000)}b` },
			{ expectedMath: 1, label: "30KB spaces + math", source: `$x$ ${" ".repeat(30_000)}b` },
			{ expectedMath: 0, label: "100KB spaces", source: `a${" ".repeat(100_000)}b` },
			{ expectedMath: 1, label: "100KB spaces + math", source: `$x$ ${" ".repeat(100_000)}b` },
			{ expectedMath: 1, label: "50K angle brackets + math", source: `${"<".repeat(50_000)} $x$ >` },
		];
		for (const entry of inputs) {
			const startedAt = performance.now();
			const index = createEditorMarkdownBlockIndex(entry.source);
			const elapsedMs = performance.now() - startedAt;
			expect(index.mathSpans, entry.label).toHaveLength(entry.expectedMath);
			expect(elapsedMs, `${entry.label}: ${elapsedMs.toFixed(1)}ms`).toBeLessThan(200);
		}
	});

	it("matches upstream @lezer/markdown AST 1:1 across linear Link, Image, and LinkEnd edge cases (R32A #2)", () => {
		const upstreamParser = markdownLanguage.parser as MarkdownParser;
		const linearLinkParser = installLinearInlineResolver(
			upstreamParser.configure({
				parseInline: [
					{ name: "Link", parse: parseLinearLink },
					{ name: "Image", parse: parseLinearImage },
					{ name: "LinkEnd", parse: createLinearLinkEndParser() },
				],
			}),
		);
		const dumpTree = (tree: ReturnType<MarkdownParser["parse"]>): string[] => {
			const out: string[] = [];
			tree.iterate({
				enter(node) {
					out.push(`${node.name}:${node.from}-${node.to}`);
				},
			});
			return out;
		};
		const samples: ReadonlyArray<string> = [
			"[![alt](/img.png)](/link)",
			"![alt [inner](/a) text](/img.png)",
			"[outer [inner](/a) tail](/outer)",
			"[outer [ ]](/outer) [empty]() [ ] []",
			"[outer ![img [nested](/b)](/img)](/outer)",
			"[shortcut] [collapsed][] [full][ref]\n\n[shortcut]: /1\n[collapsed]: /2\n[ref]: /3",
			"[nested parens](/u(a(b))\\)c) [escaped](/u\\(x\\))",
			"[angled](<https://example.com/a b>) [unclosed](<https://example.com)",
			"[sq](/u 't\\'1') [dq](/u \"t\\\"2\") [pq](/u (t\\)3)) [unclosed](/u 't)",
			"unmatched ]]] and [[[ and [a] ] [b](/u) [",
			"[*em* **strong** ~~strike~~](/u \"title\")",
			`${"[a](x\\)".repeat(16)}`,
			`${"[a](x\\)".repeat(16)} ! )`,
			`${"[a](x()".repeat(16)} ! )`,
			`${"[a](x(a)(b\\))".repeat(12)} ! )`,
			`${"[a](x\\\\)".repeat(12)} [b](y())`,
		];
		for (const sample of samples) {
			expect(
				dumpTree(linearLinkParser.parse(sample)),
				JSON.stringify(sample),
			).toEqual(dumpTree(upstreamParser.parse(sample)));
		}
	});

	it("stays strictly O(N) on escaped-paren and balanced-paren bare-URL runs (R33A #2, R33B #1)", () => {
		const runs: ReadonlyArray<
			Readonly<{ label: string; maxMs: number; source: string }>
		> = [
			{
				label: "32k [a](x\\) (224 KB)",
				maxMs: 600,
				source: "[a](x\\)".repeat(32_000),
			},
			{
				label: "32k [a](x\\) + trailing close paren (224 KB)",
				maxMs: 600,
				source: `${"[a](x\\)".repeat(32_000)} ! )`,
			},
			{
				label: "16k [a](x() + trailing close paren (112 KB)",
				maxMs: 400,
				source: `${"[a](x()".repeat(16_000)} ! )`,
			},
		];
		for (const run of runs) {
			const startedAt = performance.now();
			const index = createEditorMarkdownBlockIndex(run.source);
			const elapsedMs = performance.now() - startedAt;
			expect(index.length, run.label).toBe(run.source.length);
			expect(elapsedMs, `${run.label}: ${elapsedMs.toFixed(1)}ms`).toBeLessThan(
				run.maxMs,
			);
		}
	});

	it("blocks leaf interruption at max container depth 99 while allowing exit-to-98 interruption (R34B #2)", () => {
		const depth99Blockquote =
			`${"> ".repeat(99)}a\n${"> ".repeat(99)}<div>\n${"> ".repeat(99)}$x$\n${"> ".repeat(99)}</div>`;
		const list49PlusBlockquote =
			`${"- ".repeat(49)}> a\n${"  ".repeat(49)}> <div>\n${"  ".repeat(49)}> $x$\n${"  ".repeat(49)}> </div>`;
		const exitTo98Control =
			`${"> ".repeat(99)}a\n${"> ".repeat(98)}<div>\n${"> ".repeat(98)}$x$\n${"> ".repeat(98)}</div>`;

		for (const [label, lfSource, expectedMath] of [
			["depth-99 blockquote", depth99Blockquote, 1],
			["49-list + 1-blockquote", list49PlusBlockquote, 1],
			["exit-to-98 control", exitTo98Control, 0],
		] as const) {
			for (const source of [lfSource, lfSource.replace(/\n/g, "\r\n")]) {
				const index = createEditorMarkdownBlockIndex(source);
				expect(index.mathSpans, `${label} (${source.includes("\r\n") ? "CRLF" : "LF"})`).toHaveLength(
					expectedMath,
				);
			}
		}
	});

	it("matches League 2.8.2 depth-99 leafBlockParsers for Setext, GFM Table, and LinkReference + HTML block on both LF and CRLF (R35B #3)", () => {
		const p99 = "> ".repeat(99);
		const p98 = "> ".repeat(98);
		const cases: ReadonlyArray<
			Readonly<{
				expectedLinks: number;
				expectedMath: number;
				label: string;
				lfSource: string;
			}>
		> = [
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "depth-99 Setext === followed by <div>$x$</div>",
				lfSource: `${p99}a\n${p99}===\n${p99}<div>\n${p99}$x$\n${p99}</div>`,
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "depth-99 Setext --- followed by <div>$x$</div>",
				lfSource: `${p99}a\n${p99}---\n${p99}<div>\n${p99}$x$\n${p99}</div>`,
			},
			{
				expectedLinks: 1,
				expectedMath: 0,
				label: "depth-99 GFM table suppressed so [a | b](/u) stays a link",
				lfSource: `${p99}| a | b |\n${p99}| --- | --- |\n${p99}| [a | b](/u) |`,
			},
			{
				expectedLinks: 2,
				expectedMath: 1,
				label: "depth-99 consecutive LinkReference + <div>$x$</div>",
				lfSource: `${p99}[a]: /1\n${p99}[b]: /2\n${p99}<div>\n${p99}$x$\n${p99}</div>\n${p99}\n${p99}[a] [b]`,
			},
			{
				expectedLinks: 1,
				expectedMath: 1,
				label: "depth-99 single-line titled LinkReference + <div>$x$</div>",
				lfSource: `${p99}[a]: /1 "t"\n${p99}<div>\n${p99}$x$\n${p99}</div>\n${p99}\n${p99}[a]`,
			},
			{
				expectedLinks: 1,
				expectedMath: 1,
				label: "depth-99 multi-line titled LinkReference + <div>$x$</div>",
				lfSource: `${p99}[a]: /1\n${p99}"t"\n${p99}<div>\n${p99}$x$\n${p99}</div>\n${p99}\n${p99}[a]`,
			},
			{
				expectedLinks: 1,
				expectedMath: 0,
				label: "depth-99 blank-line exit control [a]: /1\\n\\n<div>$x$</div>",
				lfSource: `${p99}[a]: /1\n${p99}\n${p99}<div>\n${p99}$x$\n${p99}</div>\n${p99}\n${p99}[a]`,
			},
			{
				expectedLinks: 0,
				expectedMath: 0,
				label: "depth-98 positive control: GFM table still active",
				lfSource: `${p98}| a | b |\n${p98}| --- | --- |\n${p98}| [a | b](/u) |`,
			},
			{
				expectedLinks: 0,
				expectedMath: 0,
				label: "depth-98 positive control: Setext === closes leaf so <div> starts HTMLBlock",
				lfSource: `${p98}a\n${p98}===\n${p98}<div>\n${p98}$x$\n${p98}</div>`,
			},
		];

		for (const item of cases) {
			for (const source of [
				item.lfSource,
				item.lfSource.replace(/\n/g, "\r\n"),
			]) {
				const eol = source.includes("\r\n") ? "CRLF" : "LF";
				const index = createEditorMarkdownBlockIndex(source);
				expect(index.mathSpans, `${item.label} [${eol}] math`).toHaveLength(
					item.expectedMath,
				);
				expect(index.linkCandidates ?? [], `${item.label} [${eol}] links`).toHaveLength(
					item.expectedLinks,
				);
			}
		}
	});

	it("matches League 2.8.2 depth-99/98/97 list continuation and post-paragraph close on both LF and CRLF (R36A #2)", () => {
		const p99 = "> ".repeat(99);
		const p98 = "> ".repeat(98);
		const p97 = "> ".repeat(97);
		const wrap = (prefix: string, lines: ReadonlyArray<string>): string =>
			lines.map((line) => `${prefix}${line}`).join("\n");

		const cases: ReadonlyArray<
			Readonly<{
				expectedLinks: number;
				expectedMath: number;
				label: string;
				lfSource: string;
			}>
		> = [
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "depth-99 empty bullet list + <div>$x$</div>",
				lfSource: wrap(p99, ["-", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "depth-99 empty bullet list + blank + <div>$x$</div>",
				lfSource: wrap(p99, ["-", "", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "depth-99 empty bullet list + <div>$x$</div> + blank + <div>$y$</div>",
				lfSource: wrap(p99, [
					"-",
					"<div>",
					"$x$",
					"</div>",
					"",
					"<div>",
					"$y$",
					"</div>",
				]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "depth-99 empty bullet list + blank + <div>$x$</div> + blank + <div>$y$</div>",
				lfSource: wrap(p99, [
					"-",
					"",
					"<div>",
					"$x$",
					"</div>",
					"",
					"<div>",
					"$y$",
					"</div>",
				]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "depth-99 empty ordered list + <div>$x$</div>",
				lfSource: wrap(p99, ["1.", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "depth-99 empty ordered list + blank + <div>$x$</div>",
				lfSource: wrap(p99, ["1.", "", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "depth-99 empty ordered list + <div>$x$</div> + blank + <div>$y$</div>",
				lfSource: wrap(p99, [
					"1.",
					"<div>",
					"$x$",
					"</div>",
					"",
					"<div>",
					"$y$",
					"</div>",
				]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "depth-99 empty bullet list + second item + <div>$x$</div>",
				lfSource: wrap(p99, ["-", "- b", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 0,
				label: "depth-99 empty bullet list + second item + blank + <div>$x$</div>",
				lfSource: wrap(p99, ["-", "- b", "", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 0,
				label: "depth-99 empty bullet list exiting to depth-98 <div>$x$</div>",
				lfSource: `${p99}-\n${wrap(p98, ["<div>", "$x$", "</div>"])}`,
			},
			{
				expectedLinks: 0,
				expectedMath: 0,
				label: "depth-99 empty bullet list + blank exiting to depth-98 <div>$x$</div>",
				lfSource: `${p99}-\n${p99}\n${wrap(p98, ["<div>", "$x$", "</div>"])}`,
			},
			{
				expectedLinks: 0,
				expectedMath: 0,
				label: "depth-98 control: empty bullet list + <div>$x$</div>",
				lfSource: wrap(p98, ["-", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 0,
				label: "depth-98 control: empty bullet list + blank + <div>$x$</div>",
				lfSource: wrap(p98, ["-", "", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 0,
				label: "depth-98 control: empty ordered list + <div>$x$</div>",
				lfSource: wrap(p98, ["1.", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 2,
				label: "depth-99 non-empty bullet lazy div + blank + div + blank + html-block div",
				lfSource: wrap(p99, [
					"- a",
					"<div>",
					"$x$",
					"</div>",
					"",
					"<div>",
					"$y$",
					"</div>",
					"",
					"<div>",
					"$z$",
					"</div>",
				]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "depth-97 nested list + <div>$x$</div> + blank + <div>$y$</div>",
				lfSource: wrap(p97, [
					"- -",
					"  <div>",
					"  $x$",
					"  </div>",
					"  ",
					"  <div>",
					"  $y$",
					"  </div>",
				]),
			},
			{
				expectedLinks: 1,
				expectedMath: 1,
				label: "depth-99 empty bullet + LinkReference + <div>$x$</div>",
				lfSource: wrap(p99, ["-", "[a]: /1", "<div>", "$x$", "</div>", "", "[a]"]),
			},
			{
				expectedLinks: 1,
				expectedMath: 0,
				label: "depth-99 empty bullet + LinkReference + blank + <div>$x$</div>",
				lfSource: wrap(p99, [
					"-",
					"[a]: /1",
					"",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a]",
				]),
			},
			{
				expectedLinks: 3,
				expectedMath: 1,
				label: "depth-99 empty bullet + 3 consecutive LinkReferences + <div>$x$</div>",
				lfSource: wrap(p99, [
					"-",
					"[a]: /1",
					"[b]: /2",
					"[c]: /3",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a] [b] [c]",
				]),
			},
		];

		for (const item of cases) {
			for (const source of [
				item.lfSource,
				item.lfSource.replace(/\n/g, "\r\n"),
			]) {
				const eol = source.includes("\r\n") ? "CRLF" : "LF";
				const index = createEditorMarkdownBlockIndex(source);
				expect(index.mathSpans, `${item.label} [${eol}] math`).toHaveLength(
					item.expectedMath,
				);
				expect(
					index.linkCandidates ?? [],
					`${item.label} [${eol}] links`,
				).toHaveLength(item.expectedLinks);
			}
		}
	});

	it("matches League 2.8.2 depth-100 -> depth-99 container-exit leaf interruption for Paragraph and LinkReference on LF and CRLF (R37A #2)", () => {
		const p99 = "> ".repeat(99);
		const p100 = "> ".repeat(100);
		const wrap = (prefix: string, lines: ReadonlyArray<string>): string =>
			lines.map((line) => `${prefix}${line}`).join("\n");

		const cases: ReadonlyArray<
			Readonly<{
				expectedLinks: number;
				expectedMath: number;
				label: string;
				lfSource: string;
			}>
		> = [
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "Paragraph depth-100 -> depth-99 exit allows <div> HTMLBlock; only final $x$ survives",
				lfSource: wrap(p99, ["> a", "<div>", "$x$", "</div>", "", "$x$"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 0,
				label: "Paragraph depth-100 -> depth-99 exit allows <div> HTMLBlock without trailing math",
				lfSource: wrap(p99, ["> a", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "Paragraph depth-101 -> depth-100 stays capped (matched BQ(100) >= 100)",
				lfSource: wrap(p100, ["> a", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "Paragraph staying at depth-99 suppresses <div> (matched Paragraph depth = 100)",
				lfSource: wrap(p99, ["a", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 0,
				label: "Paragraph depth-100 -> depth-99 exit allows --- thematic break before <div>",
				lfSource: wrap(p99, ["> a", "---", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "LinkReference depth-100 -> depth-99 exit allows <div> HTMLBlock; only final $x$ survives",
				lfSource: wrap(p99, ["> [a]: /1", "<div>", "$x$", "</div>", "", "$x$"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 0,
				label: "LinkReference depth-100 -> depth-99 exit without trailing math",
				lfSource: wrap(p99, ["> [a]: /1", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "LinkReference with same-line title depth-100 -> depth-99 exit allows <div>",
				lfSource: wrap(p99, ['> [a]: /1 "t"', "<div>", "$x$", "</div>", "", "$x$"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "LinkReference with multiline title depth-100 -> depth-99 exit allows <div>",
				lfSource: wrap(p99, [
					"> [a]: /1",
					'> "t"',
					"<div>",
					"$x$",
					"</div>",
					"",
					"$x$",
				]),
			},
			{
				expectedLinks: 1,
				expectedMath: 0,
				label: "LinkReference depth-100 -> depth-99 lazy title closes cleanly before <div> and preserves ref",
				lfSource: wrap(p99, [
					"> [a]: /1",
					'"t"',
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a]",
				]),
			},
			{
				expectedLinks: 0,
				expectedMath: 0,
				label: "LinkReference unclosed title depth-100 -> depth-99 exit allows <div>",
				lfSource: wrap(p99, ["> [a]: /1", '> "t', "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "LinkReference depth-101 -> depth-100 stays capped",
				lfSource: wrap(p100, ["> [a]: /1", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 0,
				expectedMath: 1,
				label: "LinkReference staying at depth-99 suppresses <div>",
				lfSource: wrap(p99, ["[a]: /1", "<div>", "$x$", "</div>"]),
			},
			{
				expectedLinks: 1,
				expectedMath: 0,
				label: "LinkReference depth-100 -> depth-99 lazy plain continuation before <div> (R38B #3)",
				lfSource: wrap(p99, [
					"> [a]: /1",
					"plain",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a]",
				]),
			},
			{
				expectedLinks: 1,
				expectedMath: 0,
				label: "LinkReference with same-line title depth-100 -> depth-99 lazy plain continuation before <div> (R38B #3)",
				lfSource: wrap(p99, [
					'> [a]: /1 "t"',
					"plain",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a]",
				]),
			},
			{
				expectedLinks: 1,
				expectedMath: 0,
				label: "LinkReference with lazy title depth-100 -> depth-99 lazy plain continuation before <div> (R38B #3)",
				lfSource: wrap(p99, [
					"> [a]: /1",
					'"t"',
					"plain",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a]",
				]),
			},
			{
				expectedLinks: 2,
				expectedMath: 0,
				label: "LinkReference depth-100 -> depth-99 lazy second ref before <div> (R39B #4)",
				lfSource: wrap(p99, [
					"> [a]: /1",
					"[b]: /2",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a] [b]",
				]),
			},
			{
				expectedLinks: 2,
				expectedMath: 0,
				label: "LinkReference with same-line title depth-100 -> depth-99 lazy second ref before <div> (R39B #4)",
				lfSource: wrap(p99, [
					'> [a]: /1 "t"',
					"[b]: /2",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a] [b]",
				]),
			},
			{
				expectedLinks: 3,
				expectedMath: 0,
				label: "LinkReference depth-100 -> depth-99 3 chained lazy refs before <div> (R39B #4)",
				lfSource: wrap(p99, [
					"> [a]: /1",
					"[b]: /2",
					"[c]: /3",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a] [b] [c]",
				]),
			},
			{
				expectedLinks: 3,
				expectedMath: 0,
				label: "LinkReference depth-100 -> depth-99 chained lazy refs with title on middle ref (R39B #4)",
				lfSource: wrap(p99, [
					"> [a]: /1",
					'[b]: /2 "t2"',
					"[c]: /3",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a] [b] [c]",
				]),
			},
			{
				expectedLinks: 2,
				expectedMath: 0,
				label: "LinkReference depth-100 -> depth-99 lazy second ref with next-line title before <div> (R39B #4)",
				lfSource: wrap(p99, [
					"> [a]: /1",
					"[b]: /2",
					'"title"',
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a] [b]",
				]),
			},
			{
				expectedLinks: 1,
				expectedMath: 0,
				label: "LinkReference depth-100 -> depth-99 lazy [not-a-ref] before <div> (R39B #4)",
				lfSource: wrap(p99, [
					"> [a]: /1",
					"[not-a-ref]",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a]",
				]),
			},
			{
				expectedLinks: 1,
				expectedMath: 0,
				label: "LinkReference with title depth-100 -> depth-99 lazy [not-a-ref] before <div> (R39B #4)",
				lfSource: wrap(p99, [
					'> [a]: /1 "t"',
					"[not-a-ref]",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a]",
				]),
			},
			{
				expectedLinks: 2,
				expectedMath: 0,
				label: "ListItem depth-98 lazy second ref before <div> (R40B #4)",
				lfSource: wrap("> ".repeat(98), [
					"- [a]: /1",
					"[b]: /2",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a] [b]",
				]),
			},
			{
				expectedLinks: 1,
				expectedMath: 0,
				label: "ListItem depth-98 lazy plain continuation before <div> (R40B #4)",
				lfSource: wrap("> ".repeat(98), [
					"- [a]: /1",
					"plain",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a]",
				]),
			},
			{
				expectedLinks: 2,
				expectedMath: 1,
				label: "ListItem depth-99 lazy second ref stays capped before <div> (R40B #4)",
				lfSource: wrap(p99, [
					"- [a]: /1",
					"[b]: /2",
					"<div>",
					"$x$",
					"</div>",
					"",
					"[a] [b]",
				]),
			},
		];

		for (const item of cases) {
			for (const source of [
				item.lfSource,
				item.lfSource.replace(/\n/g, "\r\n"),
			]) {
				const eol = source.includes("\r\n") ? "CRLF" : "LF";
				const index = createEditorMarkdownBlockIndex(source);
				expect(index.mathSpans, `${item.label} [${eol}] math`).toHaveLength(
					item.expectedMath,
				);
				expect(
					index.linkCandidates ?? [],
					`${item.label} [${eol}] links`,
				).toHaveLength(item.expectedLinks);
			}
		}
	});
});
