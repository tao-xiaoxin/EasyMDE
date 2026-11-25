import { describe, expect, it } from "vitest";
import { markdownLanguage } from "@codemirror/lang-markdown";

import {
	createEditorMarkdownBlockIndex as createProfiledMarkdownBlockIndex,
	type EditorMarkdownBlockKind,
	findEditorMarkdownBlock,
} from "./editor-markdown-block-index";
import {
	type EditorCodeBodyMap,
	findEditorCodeContentTarget,
	readEditorCodeContent,
} from "./editor-code-content-target";
import {
	markdownReferenceLabels,
	type MarkdownSyntaxNode,
} from "./editor-markdown-link-preparation";
import { collectPhpDisplayMathBrokenBlockLinks } from "./editor-markdown-php-inline-links";
import { scanPhpCommonMarkBlocks } from "../../shared/markdown/php-commonmark-block-scan";
import { scanPhpMarkdownMathRanges } from "../../shared/markdown/php-markdown-math-mask";
import { prepareMarkdownTable } from "./editor-markdown-table";

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

	it("preserves inline image ranges whose alt text contains backtick code spans, autolinks, HTML tags/comments, or balanced brackets while rejecting reference-image traps", () => {
		for (const source of [
			"![A `]` next](/image.png)",
			"![A `](` next](/image.png)",
			"![Alt <https://example.test/a[b>](/image.png)",
			"![Alt <!-- [ -->](/image.png)",
			"![Alt <!-- ] -->](/image.png)",
			'![<span title="](">](https://example.com/a.png "{width=50%}")',
			'![<https://example.com/?a=]>](https://example.com/a.png "{width=50%}")',
			"![a [b] c](/image.png)",
		]) {
			const index = createEditorMarkdownBlockIndex(source);
			expect(index.imageBlocks?.[0]?.status, source).toBe("ready");
			expect(index.imageRanges, source).toEqual([{ from: 0, to: source.length }]);
		}

		// Inline HTML comments and tag attributes must not produce false-positive image ranges.
		for (const nonImage of [
			"hi <!-- ![a](https://example.com/a.png) -->",
			'<span title="![a](https://example.com/a.png) ">hi</span>',
			'<span title="![a](<https://example.com/a.png>)">hi</span>',
			`<span title="![a](https://example.com/a.png 't')">hi</span>`,
		]) {
			const index = createEditorMarkdownBlockIndex(nonImage);
			expect(index.imageRanges, nonImage).toEqual([]);
		}

		// A reference image whose alt contains `` `](` `` must still stay unavailable.
		const refTrap = "![A `](` next][ref]\n\n[ref]: /image.png";
		const refIndex = createEditorMarkdownBlockIndex(refTrap);
		expect(refIndex.imageRanges).toEqual([]);
		expect(refIndex.imageBlocks?.[0]?.status).toBe("unavailable");
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

	it("computes exact non-overlapping lineStart and lineEnd when splitting blocks around adjacent display math", () => {
		const tableBeforeMath = "| A | B |\n| --- | --- |\n| 1 | 2 |\n$$x$$";
		expect(createEditorMarkdownBlockIndex(tableBeforeMath).blocks).toEqual([
			{
				editable: true,
				from: 0,
				kind: "table",
				lineEnd: 2,
				lineStart: 0,
				to: tableBeforeMath.indexOf("\n$$x$$"),
			},
			{
				editable: true,
				from: tableBeforeMath.indexOf("$$x$$"),
				kind: "math",
				lineEnd: 3,
				lineStart: 3,
				to: tableBeforeMath.length,
			},
		]);

		for (const newline of ["\n", "\r\n"] as const) {
			const surrounded = `Line 0${newline}$$x$$${newline}Line 2`;
			const blocks = createEditorMarkdownBlockIndex(surrounded).blocks;
			expect(blocks, JSON.stringify(newline)).toEqual([
				{
					editable: true,
					from: 0,
					kind: "paragraph",
					lineEnd: 0,
					lineStart: 0,
					to: "Line 0".length,
				},
				{
					editable: true,
					from: surrounded.indexOf("$$x$$"),
					kind: "math",
					lineEnd: 1,
					lineStart: 1,
					to: surrounded.indexOf("$$x$$") + "$$x$$".length,
				},
				{
					editable: true,
					from: surrounded.indexOf("Line 2"),
					kind: "paragraph",
					lineEnd: 2,
					lineStart: 2,
					to: surrounded.length,
				},
			]);
		}

		const multipleMath = "Line 0\n$$a$$\nLine 2\n\\[b\\]\nLine 4";
		expect(createEditorMarkdownBlockIndex(multipleMath).blocks).toEqual([
			{
				editable: true,
				from: 0,
				kind: "paragraph",
				lineEnd: 0,
				lineStart: 0,
				to: "Line 0".length,
			},
			{
				editable: true,
				from: multipleMath.indexOf("$$a$$"),
				kind: "math",
				lineEnd: 1,
				lineStart: 1,
				to: multipleMath.indexOf("$$a$$") + "$$a$$".length,
			},
			{
				editable: true,
				from: multipleMath.indexOf("Line 2"),
				kind: "paragraph",
				lineEnd: 2,
				lineStart: 2,
				to: multipleMath.indexOf("Line 2") + "Line 2".length,
			},
			{
				editable: true,
				from: multipleMath.indexOf("\\[b\\]"),
				kind: "math",
				lineEnd: 3,
				lineStart: 3,
				to: multipleMath.indexOf("\\[b\\]") + "\\[b\\]".length,
			},
			{
				editable: true,
				from: multipleMath.indexOf("Line 4"),
				kind: "paragraph",
				lineEnd: 4,
				lineStart: 4,
				to: multipleMath.length,
			},
		]);
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

	it("excludes PHP-dropped extra GFM table body cell images and links while keeping valid cells", () => {
		const twoColExtraImg =
			"| H | B |\n| --- | --- |\n| a | b | ![extra](https://example.org/i.png) |";
		const twoColIndex = createEditorMarkdownBlockIndex(twoColExtraImg);
		expect(twoColIndex.imageBlocks).toEqual([
			{ count: 0, firstImageIndex: 0, status: "ready" },
		]);
		expect(twoColIndex.imageRanges).toEqual([]);

		const oneColMixed =
			"| A |\n| --- |\n| 1 | ![dropped](https://example.com/dropped.png) |\n| ![real](https://example.com/real.png) |";
		const oneColIndex = createEditorMarkdownBlockIndex(oneColMixed);
		expect(oneColIndex.imageBlocks).toEqual([
			{ count: 1, firstImageIndex: 0, status: "ready" },
		]);
		expect(oneColIndex.imageRanges).toHaveLength(1);
		expect(
			oneColMixed.slice(
				oneColIndex.imageRanges?.[0]?.from ?? -1,
				oneColIndex.imageRanges?.[0]?.to ?? -1,
			),
		).toBe("![real](https://example.com/real.png)");

		const asymmetric =
			"| A |\n| --- | --- |\n| 1 | ![dropped](https://example.com/dropped.png) |";
		expect(createEditorMarkdownBlockIndex(asymmetric).imageRanges).toEqual([]);

		const zeroCol =
			"|\n| --- |\n| ![dropped](https://example.com/dropped.png) |";
		expect(createEditorMarkdownBlockIndex(zeroCol).imageRanges).toEqual([]);

		// Dropped reference image must not poison a valid image in the same table.
		const droppedRef =
			"| A |\n| --- |\n| 1 | ![ref][id] |\n| ![real](https://example.com/real.png) |\n\n[id]: https://example.com/ref.png";
		const droppedRefIndex = createEditorMarkdownBlockIndex(droppedRef);
		expect(droppedRefIndex.imageBlocks?.[0]).toEqual({
			count: 1,
			firstImageIndex: 0,
			status: "ready",
		});
		expect(droppedRefIndex.imageRanges).toHaveLength(1);

		// Extra body-cell links (inline, autolink, bare URL) are excluded; valid cell 0 link is kept.
		const tableWithLinks =
			"| A |\n| --- |\n| [kept](https://kept.example) | [dropped](https://dropped.example) |\n| 1 | <https://auto.example> |\n| 2 | https://bare.example |";
		const linksIndex = createEditorMarkdownBlockIndex(tableWithLinks);
		expect(linksIndex.linkCandidates).toHaveLength(1);
		expect(
			tableWithLinks.slice(
				linksIndex.linkCandidates?.[0]?.from ?? -1,
				linksIndex.linkCandidates?.[0]?.to ?? -1,
			),
		).toBe("[kept](https://kept.example)");

		// Display math terminates a preceding table just like PHP MarkdownRenderer::extract_math().
		const afterDisplayMath =
			"| A |\n| --- |\n$$\nx = 1\n$$\n| 1 | ![ok](https://example.com/ok.png) |";
		const mathTermIndex = createEditorMarkdownBlockIndex(afterDisplayMath);
		expect(mathTermIndex.imageRanges).toHaveLength(1);
		expect(
			afterDisplayMath.slice(
				mathTermIndex.imageRanges?.[0]?.from ?? -1,
				mathTermIndex.imageRanges?.[0]?.to ?? -1,
			),
		).toBe("![ok](https://example.com/ok.png)");
	});

	it("preserves GFM table images and links alongside inline math pipes and drops phantom table-image URL links", () => {
		const sameCell = "| A |\n| - |\n| $a|b$ ![x](/i) [y](/y) |";
		const sameCellIndex = createEditorMarkdownBlockIndex(sameCell);
		expect(
			(sameCellIndex.imageRanges ?? []).map((r) => sameCell.slice(r.from, r.to)),
		).toEqual(["![x](/i)"]);
		expect(
			(sameCellIndex.linkCandidates ?? []).map((r) =>
				sameCell.slice(r.from, r.to),
			),
		).toEqual(["[y](/y)"]);

		const prevCellImg =
			"| A | B |\n| --- | --- |\n| $a|b$ | ![img](https://example.com/a.png) |";
		const prevCellImgIndex = createEditorMarkdownBlockIndex(prevCellImg);
		expect(
			(prevCellImgIndex.imageRanges ?? []).map((r) =>
				prevCellImg.slice(r.from, r.to),
			),
		).toEqual(["![img](https://example.com/a.png)"]);

		const prevCellLink =
			"| A | B |\n| --- | --- |\n| $a|b$ | [link](https://example.com) |";
		const prevCellLinkIndex = createEditorMarkdownBlockIndex(prevCellLink);
		expect(
			(prevCellLinkIndex.linkCandidates ?? []).map((r) =>
				prevCellLink.slice(r.from, r.to),
			),
		).toEqual(["[link](https://example.com)"]);

		const prevCellParen =
			"| A | B |\n| --- | --- |\n| \\(a|b\\) | ![img](https://example.com/a.png) |";
		const prevCellParenIndex = createEditorMarkdownBlockIndex(prevCellParen);
		expect(
			(prevCellParenIndex.imageRanges ?? []).map((r) =>
				prevCellParen.slice(r.from, r.to),
			),
		).toEqual(["![img](https://example.com/a.png)"]);

		const mathHeader =
			"| $a|b$ |\n| --- |\n| 1 | ![extra](https://example.com/x.png) |";
		expect(createEditorMarkdownBlockIndex(mathHeader).imageRanges).toEqual([]);

		// Code-wrapped `$a|b$` is not extracted by PHP, so its pipe splits cells and drops ![img].
		const codeWrapped =
			"| A | B |\n| --- | --- |\n| `$a|b$` | ![img](https://example.com/a.png) |";
		expect(createEditorMarkdownBlockIndex(codeWrapped).imageRanges).toEqual([]);

		// Track B #3: double-backslash pipe inside table image destination must not produce a phantom URL link.
		const escapedPipeImg =
			"| A |\n| --- |\n| ![a](https://example.com/a\\\\|b.png) |";
		expect(createEditorMarkdownBlockIndex(escapedPipeImg).linkCandidates).toEqual(
			[],
		);

		const escapedPipeImgWithRealLink =
			"| A |\n| --- |\n| ![a](https://example.com/a\\\\|b.png) https://real.example.com |";
		const mixedLinkIndex = createEditorMarkdownBlockIndex(
			escapedPipeImgWithRealLink,
		);
		expect(
			(mixedLinkIndex.linkCandidates ?? []).map((r) =>
				escapedPipeImgWithRealLink.slice(r.from, r.to),
			),
		).toEqual(["https://real.example.com"]);
	});

	it("matches PHP extract_math for multiline \\(...\\), surrogate offsets, table-image phantom URLs, and pipe-free display math indented code", () => {
		// Track A #3 + Track B #4: multiline \(...\) and surrogate pair offsets.
		const multiHeader =
			"| A | \\(x\ny\\) | B |\n| --- | --- | --- |\n| 1 | 2 | ![kept](https://example.com/a.png) |";
		expect(
			(createEditorMarkdownBlockIndex(multiHeader).imageRanges ?? []).map((r) =>
				multiHeader.slice(r.from, r.to),
			),
		).toEqual(["![kept](https://example.com/a.png)"]);

		const multiBody =
			"| A | B |\n| --- | --- |\n| 1 | \\(x\ny\\) | ![dropped](https://example.com/b.png) |";
		expect(createEditorMarkdownBlockIndex(multiBody).imageRanges).toEqual([]);

		const blankInMath =
			"| A | B |\n| --- | --- |\n| \\(x\n\ny\\) | ![kept](https://example.com/a.png) | ![dropped](https://example.com/b.png) |";
		expect(
			(createEditorMarkdownBlockIndex(blankInMath).imageRanges ?? []).map((r) =>
				blankInMath.slice(r.from, r.to),
			),
		).toEqual(["![kept](https://example.com/a.png)"]);

		const surrogateSource =
			"\\(😀\nx|y\\)\n\n| A |\n| --- |\n| ![kept](https://example.com/a.png) |";
		expect(
			(createEditorMarkdownBlockIndex(surrogateSource).imageRanges ?? []).map(
				(r) => surrogateSource.slice(r.from, r.to),
			),
		).toEqual(["![kept](https://example.com/a.png)"]);

		// Track B #5: suppress phantom URL fragments inside linked `\\|` or inline-math-pipe table images.
		for (const [label, source] of [
			[
				"linked image with double-backslash pipe in alt",
				"| A |\n| --- |\n| [![a\\\\|b](https://example.com/a.png)](https://example.com/x) |",
			],
			[
				"image with inline dollar math pipe in title",
				'| A |\n| --- |\n| ![alt](https://example.com/a.png "a $x|y$ b") |',
			],
			[
				"image with inline dollar math pipe in alt",
				"| A |\n| --- |\n| ![a $x|y$ b](https://example.com/a.png) |",
			],
			[
				"image with inline paren math pipe in title",
				'| A |\n| --- |\n| ![alt](https://example.com/a.png "a \\(x|y\\) b") |',
			],
		] as const) {
			expect(
				createEditorMarkdownBlockIndex(source).linkCandidates,
				label,
			).toEqual([]);
		}

		// Positive controls: real link after image on a table row remains exposed.
		for (const positive of [
			"| A |\n| --- |\n| ![a](https://example.com/a.png) https://example.com/ok |",
			'| A |\n| --- |\n| ![alt](https://example.com/a.png "a $x|y$ b") https://example.com/ok |',
		]) {
			const idx = createEditorMarkdownBlockIndex(positive);
			expect(
				(idx.linkCandidates ?? []).map((r) => positive.slice(r.from, r.to)),
				positive,
			).toEqual(["https://example.com/ok"]);
		}

		// Track B #7: display math followed by 4 spaces creates indented code even without `|`.
		for (const indented of [
			"$$x$$    ![alt](https://example.com/a.png)",
			"\\[x\\]    ![alt](https://example.com/a.png)",
		]) {
			expect(createEditorMarkdownBlockIndex(indented).imageRanges, indented).toEqual(
				[],
			);
		}
		expect(
			createEditorMarkdownBlockIndex("$$x$$    [link](https://example.com)")
				.linkCandidates,
		).toEqual([]);
		for (const singleSpace of [
			"$$x$$ ![alt](https://example.com/a.png)",
			"\\[x\\] ![alt](https://example.com/a.png)",
		]) {
			const idx = createEditorMarkdownBlockIndex(singleSpace);
			expect(
				(idx.imageRanges ?? []).map((r) => singleSpace.slice(r.from, r.to)),
				singleSpace,
			).toEqual(["![alt](https://example.com/a.png)"]);
		}
	});

	it("preserves bare-CR inline math offsets, recovers PHP-valid \\\\| table-cell images, and scales linearly on 6,000 links in a math table cell (Track A #4, #5a, #5b)", () => {
		// Track A #5a: bare `\r` inside inline math keeps column 2 link/image intact.
		const bareCrTable = "| A | B |\n| --- | --- |\n| $a\rb|c$ | [x](/x) |";
		const bareCrIndex = createEditorMarkdownBlockIndex(bareCrTable);
		expect(bareCrIndex.mathSpans).toEqual([
			{
				bodyFrom: bareCrTable.indexOf("$a") + 1,
				bodyTo: bareCrTable.indexOf("$ |") ,
				displayMode: false,
				from: bareCrTable.indexOf("$a"),
				to: bareCrTable.indexOf("$ |") + 1,
			},
		]);
		expect(
			(bareCrIndex.linkCandidates ?? []).map((r) =>
				bareCrTable.slice(r.from, r.to),
			),
		).toEqual(["[x](/x)"]);

		const bareCrTableImg = "| A | B |\n| --- | --- |\n| $a\rb|c$ | ![x](/i) |";
		const bareCrImgIndex = createEditorMarkdownBlockIndex(bareCrTableImg);
		expect(
			(bareCrImgIndex.imageRanges ?? []).map((r) =>
				bareCrTableImg.slice(r.from, r.to),
			),
		).toEqual(["![x](/i)"]);

		// Track A #5b: recover PHP-valid `\\|` table-cell images missed by Lezer.
		const dblBackslashAlt = "| H |\n| --- |\n| ![x\\\\|y](/i) |";
		const dblBackslashAltIdx = createEditorMarkdownBlockIndex(dblBackslashAlt);
		expect(dblBackslashAltIdx.imageBlocks).toEqual([
			{ count: 1, firstImageIndex: 0, status: "ready" },
		]);
		expect(
			(dblBackslashAltIdx.imageRanges ?? []).map((r) =>
				dblBackslashAlt.slice(r.from, r.to),
			),
		).toEqual(["![x\\\\|y](/i)"]);

		// Mixed Lezer-discovered and Lezer-missed `\\|` images stay sorted and deduplicated; dropped extra column stays excluded.
		const mixedRecovered =
			"| H |\n| --- |\n| ![a](/a) ![x\\\\|y](/i) ![b](/b) | ![dropped](/d) |";
		const mixedRecoveredIdx = createEditorMarkdownBlockIndex(mixedRecovered);
		expect(
			(mixedRecoveredIdx.imageRanges ?? []).map((r) =>
				mixedRecovered.slice(r.from, r.to),
			),
		).toEqual(["![a](/a)", "![x\\\\|y](/i)", "![b](/b)"]);

		// Math-wrapped `\\|` image must not be recovered as a live image.
		const mathWrappedDblPipe = "| H |\n| --- |\n| $![x\\\\|y](/i)$ |";
		expect(
			createEditorMarkdownBlockIndex(mathWrappedDblPipe).imageRanges,
		).toEqual([]);

		// Track A #4: 6,000 links after `![img](/i) $5 ` in one table cell finish well under 2s with all 6,000 links preserved.
		const links6000 = Array.from({ length: 6_000 }, (_, i) => `[a${i}](/x)`).join(
			" ",
		);
		const heavyTable = `| A | B |\n| --- | --- |\n| ![img](/i) $5 ${links6000} | B |`;
		const started = performance.now();
		const heavyIdx = createEditorMarkdownBlockIndex(heavyTable);
		const elapsedMs = performance.now() - started;
		expect(heavyIdx.linkCandidates).toHaveLength(6_000);
		expect(heavyIdx.imageRanges).toHaveLength(1);
		expect(elapsedMs).toBeLessThan(2_000);
	});

	it("matches PHP for inline-math-unclosed HTML blocks and recovers \\\\| table images in strictly O(N) time without poisoning sibling rows (Round 25 Track B #3, #4, #5a & Track A #4)", () => {
		// Track B #3: inline math without pipes masks HTML block closers before table/block parsing.
		const preTable = "<pre>\n$x</pre>$\n| A |\n| --- |";
		expect(prepareMarkdownTable(preTable, preTable.indexOf("| A"))).toBeNull();

		const commentTable = "<!-- $-->$\n| A |\n| --- |";
		expect(
			prepareMarkdownTable(commentTable, commentTable.indexOf("| A")),
		).toBeNull();

		// Blank line after unclosed Type 1/2 HTML block still keeps HTML block open in PHP.
		const preBlankTable = "<pre>\n$x</pre>$\n\n| A |\n| --- |";
		expect(
			prepareMarkdownTable(preBlankTable, preBlankTable.indexOf("| A")),
		).toBeNull();
		const commentBlankTable = "<!-- $-->$\n\n| A |\n| --- |";
		expect(
			prepareMarkdownTable(commentBlankTable, commentBlankTable.indexOf("| A")),
		).toBeNull();

		// Positive control: a properly closed HTML comment containing inline math allows a following table.
		const closedCommentTable = "<!-- a $x$ b -->\n\n| A |\n| --- |";
		expect(
			prepareMarkdownTable(
				closedCommentTable,
				closedCommentTable.indexOf("| A"),
			),
		).not.toBeNull();

		// Images and links inside inline-math-unclosed HTML blocks are excluded.
		const commentImg = "<!-- $-->$\n![alt](/img.png)";
		expect(createEditorMarkdownBlockIndex(commentImg).imageRanges).toEqual([]);
		const preImg = "<pre>\n$x</pre>$\n![alt](/img.png)";
		expect(createEditorMarkdownBlockIndex(preImg).imageRanges).toEqual([]);
		const commentLink = "<!-- $-->$\n[link](https://example.com)";
		expect(createEditorMarkdownBlockIndex(commentLink).linkCandidates).toEqual(
			[],
		);

		// Track B #4: `\\|` inside bare dest, angle dest, or title recovers BOTH images without poisoning the table.
		for (const [label, source, expectedSlices] of [
			[
				"bare destination with double-backslash pipe",
				"| A |\n| --- |\n| ![alt](/a\\\\|b.png) |\n| ![ok](/ok.png) |",
				["![alt](/a\\\\|b.png)", "![ok](/ok.png)"],
			],
			[
				"angle destination with double-backslash pipe",
				"| A |\n| --- |\n| ![alt](</a\\\\|b.png>) |\n| ![ok](/ok.png) |",
				["![alt](</a\\\\|b.png>)", "![ok](/ok.png)"],
			],
			[
				"title with double-backslash pipe",
				'| A |\n| --- |\n| ![alt](/i.png "a\\\\|b") |\n| ![ok](/ok.png) |',
				['![alt](/i.png "a\\\\|b")', "![ok](/ok.png)"],
			],
		] as const) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(idx.imageBlocks?.[0], label).toEqual({
				count: 2,
				firstImageIndex: 0,
				status: "ready",
			});
			expect(
				(idx.imageRanges ?? []).map((r) => source.slice(r.from, r.to)),
				label,
			).toEqual(expectedSlices);
		}

		// Real reference image in a table still marks the table unavailable.
		const refInTable =
			"| A |\n| --- |\n| ![ref][id] |\n| ![ok](/ok.png) |\n\n[id]: /ref.png";
		expect(createEditorMarkdownBlockIndex(refInTable).imageBlocks?.[0]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "unavailable",
		});

		// Track A #4 + Track B #5a: linear O(N) table image recovery on 4,000 `\\|` images and 4,000 unclosed `![a`.
		const heavyEscaped = `| A |\n| --- |\n| ${"![x\\\\|y](/i) ".repeat(4_000)}|`;
		const tEscaped = performance.now();
		const escapedIdx = createEditorMarkdownBlockIndex(heavyEscaped);
		const elapsedEscaped = performance.now() - tEscaped;
		expect(escapedIdx.imageBlocks?.[0]?.status).toBe("ready");
		expect(escapedIdx.imageRanges).toHaveLength(4_000);
		expect(elapsedEscaped).toBeLessThan(1_000);

		const heavyUnclosed = `| A |\n| --- |\n| ${"![a".repeat(4_000)}|`;
		const tUnclosed = performance.now();
		const unclosedIdx = createEditorMarkdownBlockIndex(heavyUnclosed);
		const elapsedUnclosed = performance.now() - tUnclosed;
		expect(unclosedIdx.imageRanges).toEqual([]);
		expect(elapsedUnclosed).toBeLessThan(500);
	});

	it("matches PHP on inline-math HTML tag masks, cross-cell Lezer table images, unresolved reference images, and escaped leading backtick runs (Round 26)", () => {
		// 1. Track B F2: `<div$a$>` and `</div$a$>` retain both image and link; `<span $a$="1">` is a Type 7 HTML block.
		for (const [label, source] of [
			["open tag with inline math", "<div$a$>\n![a](/x.png)\n[link](https://example.com)"],
			["close tag with inline math", "</div$a$>\n![a](/x.png)\n[link](https://example.com)"],
		] as const) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(
				(idx.imageRanges ?? []).map((r) => source.slice(r.from, r.to)),
				`img:${label}`,
			).toEqual(["![a](/x.png)"]);
			expect(
				(idx.linkCandidates ?? []).map((r) => source.slice(r.from, r.to)),
				`link:${label}`,
			).toEqual(["[link](https://example.com)"]);
		}
		const spanAttr = '<span $a$="1">\n![a](/x.png)';
		expect(createEditorMarkdownBlockIndex(spanAttr).imageRanges).toEqual([]);
		const declMath = "<!$a$>\n![a](/x.png)";
		expect(
			(createEditorMarkdownBlockIndex(declMath).imageRanges ?? []).map((r) =>
				declMath.slice(r.from, r.to),
			),
		).toEqual(["![a](/x.png)"]);

		// 2. Track B F3: cross-cell Lezer images filtered before `coveredRanges` so `/y.png` is recovered.
		for (const [label, source] of [
			["title pipe cross-cell", '| h1 | h2 |\n| --- | --- | --- |\n| ![a](/x.png " | ![b](/y.png) ") |'],
			["code-span pipe cross-cell", "| h1 | h2 |\n| --- | --- | --- |\n| ![a `| ![b](/y.png) `](/x.png) |"],
			["HTML-attr pipe cross-cell", '| h1 | h2 |\n| --- | --- | --- |\n| ![a <span title="| ![b](/y.png) ">](/x.png) |'],
		] as const) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(idx.imageBlocks?.[0]?.status, `status:${label}`).toBe("ready");
			expect(
				(idx.imageRanges ?? []).map((r) => source.slice(r.from, r.to)),
				`img:${label}`,
			).toEqual(["![b](/y.png)"]);
		}

		// 3. Track A #3: unresolved reference-image syntax stays literal text (`status: "ready"`), while real PHP reference definitions stay `status: "unavailable"`.
		for (const [label, source] of [
			["unresolved shortcut ref in table", "| A |\n| --- |\n| ![x] ![ok](/i) |"],
			["unresolved collapsed ref in table", "| A |\n| --- |\n| ![x][] ![ok](/i) |"],
			["unresolved full ref in table", "| A |\n| --- |\n| ![alt][x] ![ok](/i) |"],
			["fenced code refdef does not resolve ![x]", "| A |\n| --- |\n| ![x] ![ok](/i) |\n\n```\n[x]: /x\n```"],
			["HTML block refdef does not resolve ![x]", "| A |\n| --- |\n| ![x] ![ok](/i) |\n\n<div>\n[x]: /x\n</div>"],
			["math-mask literal M_M does not collide with [$a$]: /x", "![M_M] ![ok](/i)\n\n[$a$]: /x"],
			["failed same-line title refdef does not resolve ![x]", '![x] ![ok](/i)\n\n[x]: /x "bad" extra'],
			["space-only second bracket does not fall back to shortcut [x]", "![x][ ] ![ok](/i)\n\n[x]: /x"],
		] as const) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(idx.imageBlocks?.[0], `ready:${label}`).toEqual({
				count: 1,
				firstImageIndex: 0,
				status: "ready",
			});
			expect(
				(idx.imageRanges ?? []).map((r) => source.slice(r.from, r.to)),
				`slice:${label}`,
			).toEqual(["![ok](/i)"]);
		}

		for (const [label, source] of [
			["defined shortcut ref in table", "| A |\n| --- |\n| ![x] ![ok](/i) |\n\n[x]: /x"],
			["defined collapsed ref with whitespace/case fold", "| A |\n| --- |\n| ![x][] ![ok](/i) |\n\n[  X  ]: /x"],
			["defined full ref with whitespace/case fold", "| A |\n| --- |\n| ![alt][x] ![ok](/i) |\n\n[  X  ]: /x"],
			["multiline refdef resolves shortcut", "![foo bar] ![ok](/i)\n\n[foo\nbar]: /x"],
			["blockquote multiline ref resolves", "> ![foo\n> bar] ![ok](/i)\n\n[foo bar]: /x"],
			["table escaped pipe ref resolves against unescaped def", "| A |\n| --- |\n| ![a\\|b] ![ok](/i) |\n\n[a|b]: /x"],
			["2-line title failure still keeps valid line-1 refdef", '![x] ![ok](/i)\n\n[x]: /x\n"bad" extra'],
			["Unicode case-fold refdef resolves shortcut", "![Stra\u00dfe] ![ok](/i)\n\n[STRASSE]: /x"],
		] as const) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(idx.imageBlocks?.[0], `unavailable:${label}`).toEqual({
				count: 0,
				firstImageIndex: 0,
				status: "unavailable",
			});
			expect(idx.imageRanges, `empty:${label}`).toEqual([]);
		}

		// Unsupported Unicode case-fold profile: no refdefs stays ready; with refdefs + non-ASCII fails closed without throwing.
		const unsupportedOpts = { referenceLabelCaseFoldProfile: "unsupported" as const };
		expect(
			createEditorMarkdownBlockIndex("![Stra\u00dfe] ![ok](/i)", unsupportedOpts)
				.imageBlocks?.[0]?.status,
		).toBe("ready");
		expect(
			createEditorMarkdownBlockIndex(
				"![Stra\u00dfe] ![ok](/i)\n\n[STRASSE]: /x",
				unsupportedOpts,
			).imageBlocks?.[0]?.status,
		).toBe("unavailable");

		// 4. Track B F6b: escaped leading backtick runs preserve full image range in block index.
		const escapedTickSrc = "![x \\`` `](y.png)`](/z.png)";
		const escapedTickIdx = createEditorMarkdownBlockIndex(escapedTickSrc);
		expect(escapedTickIdx.imageBlocks?.[0]?.status).toBe("ready");
		expect(
			(escapedTickIdx.imageRanges ?? []).map((r) => escapedTickSrc.slice(r.from, r.to)),
		).toEqual([escapedTickSrc]);
	});

	it("matches PHP 4-pass math token numbering for reference labels and preserves live links inside unresolved reference images (Round 27)", () => {
		// 1. Track A #6 + Track B F6: PHP per-segment 4-pass token numbering ($$ -> \[ -> \( -> $).
		const repro1 = "![EASYMDE_MATH_1_TOKEN] ![ok](/i)\n\n[$a$]: /x\n\n$$b$$";
		expect(createEditorMarkdownBlockIndex(repro1).imageBlocks?.[0]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "unavailable",
		});

		const repro2 = "![a][EASYMDE_MATH_1_TOKEN]\n\n[$a$]: /x.png\n$$b$$";
		expect(createEditorMarkdownBlockIndex(repro2).imageBlocks?.[0]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "unavailable",
		});

		const repro3 = "![a][EASYMDE_MATH_0_TOKEN]\n\n[$a$]: /x.png\n$$b$$";
		expect(createEditorMarkdownBlockIndex(repro3).imageBlocks?.[0]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "ready",
		});

		// Multi-segment case separated by inline code: segment 0 `$a$` -> TOKEN_0, segment 1 `$$b$$` -> TOKEN_1.
		const multiSegMatch =
			"![a][EASYMDE_MATH_0_TOKEN]\n\n[$a$]: /x.png\n\n`code`\n\n$$b$$";
		expect(createEditorMarkdownBlockIndex(multiSegMatch).imageBlocks?.[0]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "unavailable",
		});

		const multiSegMiss =
			"![a][EASYMDE_MATH_1_TOKEN]\n\n[$a$]: /x.png\n\n`code`\n\n$$b$$";
		expect(createEditorMarkdownBlockIndex(multiSegMiss).imageBlocks?.[0]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "ready",
		});

		// Nested math increments PHP counter for both inner $$b$$ (0) and outer \[...\] (1), so $d$ gets TOKEN_2.
		const nestedMathRef =
			"![a][EASYMDE_MATH_2_TOKEN]\n\n\\[a $$b$$ c\\]\n\n[$d$]: /x.png";
		expect(createEditorMarkdownBlockIndex(nestedMathRef).imageBlocks?.[0]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "unavailable",
		});

		// 2. Track B F7: live PHP links nested inside unresolved reference-image syntax stay exposed.
		for (const [label, source, expectedLinks, expectedImages] of [
			[
				"full unresolved ref image with inline link",
				"![[link](https://example.com)][missing]",
				["[link](https://example.com)"],
				[],
			],
			[
				"collapsed unresolved ref image with inline link",
				"![[link](https://example.com)][]",
				["[link](https://example.com)"],
				[],
			],
			[
				"shortcut unresolved ref image with inline link",
				"![[link](https://example.com)]",
				["[link](https://example.com)"],
				[],
			],
			[
				"unresolved ref image with defined reference link",
				"![[link][ref]][missing]\n\n[ref]: https://example.com",
				["[link][ref]"],
				[],
			],
			[
				"unresolved ref image with autolink",
				"![<https://example.com>][missing]",
				["<https://example.com>"],
				[],
			],
			[
				"unresolved ref image with bare URL after space",
				"![see https://example.com][missing]",
				["https://example.com"],
				[],
			],
			[
				"unresolved ref image in GFM table cell",
				"| A |\n| --- |\n| ![[link](https://example.com)][missing] |",
				["[link](https://example.com)"],
				[],
			],
			[
				"CRLF document with unresolved ref image containing link",
				"intro\r\n\r\n![[link](https://example.com)][missing]",
				["[link](https://example.com)"],
				[],
			],
			[
				"unresolved ref image containing both link and real inline image",
				"![[link](https://example.com) ![ok](/i)][missing]",
				["[link](https://example.com)"],
				["![ok](/i)"],
			],
		] as const) {
			const idx = createEditorMarkdownBlockIndex(source);
			const targetBlockIdx = source.startsWith("intro\r\n") ? 1 : 0;
			expect(idx.imageBlocks?.[targetBlockIdx], `block:${label}`).toEqual({
				count: expectedImages.length,
				firstImageIndex: 0,
				status: "ready",
			});
			expect(
				(idx.imageRanges ?? []).map((r) => source.slice(r.from, r.to)),
				`images:${label}`,
			).toEqual([...expectedImages]);
			expect(
				(idx.linkCandidates ?? []).map((r) => source.slice(r.from, r.to)),
				`links:${label}`,
			).toEqual([...expectedLinks]);
		}

		// Positive controls: real defined reference image and real inline image still block nested links.
		const definedRefImg =
			"![[link](https://example.com)][defined]\n\n[defined]: /img.png";
		const definedRefIdx = createEditorMarkdownBlockIndex(definedRefImg);
		expect(definedRefIdx.imageBlocks?.[0]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "unavailable",
		});
		expect(definedRefIdx.linkCandidates).toEqual([]);

		const inlineImgWithLink = "![[link](https://example.com)](/img.png)";
		const inlineImgIdx = createEditorMarkdownBlockIndex(inlineImgWithLink);
		expect(inlineImgIdx.imageBlocks?.[0]).toEqual({
			count: 1,
			firstImageIndex: 0,
			status: "ready",
		});
		expect(inlineImgIdx.linkCandidates).toEqual([]);

		// Nested real inline image inside unresolved ref image still blocks link inside the real image.
		const realInsideUnresolved =
			"![![[link](https://example.com)](/img.png)][missing]";
		const realInsideIdx = createEditorMarkdownBlockIndex(realInsideUnresolved);
		expect(realInsideIdx.imageBlocks?.[0]).toEqual({
			count: 1,
			firstImageIndex: 0,
			status: "ready",
		});
		expect(realInsideIdx.linkCandidates).toEqual([]);

		// Unresolved ref image nested inside a real defined ref image stays blocked.
		const unresolvedInsideDefined =
			"![![[link](https://example.com)][missing]][defined]\n\n[defined]: /img.png";
		const unresolvedInsideDefIdx = createEditorMarkdownBlockIndex(
			unresolvedInsideDefined,
		);
		expect(unresolvedInsideDefIdx.imageBlocks?.[0]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "unavailable",
		});
		expect(unresolvedInsideDefIdx.linkCandidates).toEqual([]);
	});

	it("substitutes PHP math tokens in reference-image use labels and treats display-math-broken Lezer images as unresolved (Round 28 Track A #2 + Track B F6)", () => {
		// 1. Track A #2 + Track B F6a/F6b: reference-image USE labels substitute exact document-level PHP math tokens.
		const reproFullBottom = "![[x](/u)][$m$]\n\n[EASYMDE_MATH_0_TOKEN]: /i";
		const reproFullBottomIdx = createEditorMarkdownBlockIndex(reproFullBottom);
		expect(reproFullBottomIdx.imageBlocks?.[0]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "unavailable",
		});
		expect(reproFullBottomIdx.linkCandidates).toEqual([]);

		const reproFullTop =
			"[EASYMDE_MATH_0_TOKEN]: https://example.com/img.png\n\n![[link](https://example.com)][$a$]";
		const reproFullTopIdx = createEditorMarkdownBlockIndex(reproFullTop);
		expect(reproFullTopIdx.imageBlocks?.[1]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "unavailable",
		});
		expect(reproFullTopIdx.linkCandidates).toEqual([]);

		const reproShortcut =
			"[EASYMDE_MATH_0_TOKEN]: https://example.com/img.png\n\n![$a$]";
		const reproShortcutIdx = createEditorMarkdownBlockIndex(reproShortcut);
		expect(reproShortcutIdx.imageBlocks?.[1]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "unavailable",
		});
		expect(reproShortcutIdx.linkCandidates).toEqual([]);

		// Positive control: unresolved math-containing reference label keeps block ready and exposes nested link.
		const ctrlUnresolved = "![[x](/u)][$m$]\n\n[other]: /i";
		const ctrlUnresolvedIdx = createEditorMarkdownBlockIndex(ctrlUnresolved);
		expect(ctrlUnresolvedIdx.imageBlocks?.[0]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "ready",
		});
		expect(
			(ctrlUnresolvedIdx.linkCandidates ?? []).map((r) =>
				ctrlUnresolved.slice(r.from, r.to),
			),
		).toEqual(["[x](/u)"]);

		// Positive control: multi-math 4-pass numbering ($$b$$ -> TOKEN_0, $a$ -> TOKEN_1).
		const ctrlMultiMath =
			"[EASYMDE_MATH_1_TOKEN]: /i\n\n$$b$$\n\n![[x](/u)][$a$]";
		const ctrlMultiMathIdx = createEditorMarkdownBlockIndex(ctrlMultiMath);
		expect(ctrlMultiMathIdx.imageBlocks?.[2]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "unavailable",
		});
		expect(ctrlMultiMathIdx.linkCandidates).toEqual([]);

		// Additional PHP parity controls for math in reference-image USE labels:
		// collapsed ref, table `\|` + math, table math containing `\|`, blockquote multiline + math,
		// multiline `\(...\)` label, 4-pass multiple math spans in one label, code-separated segments, and case folding.
		for (const [label, source, expectedBlockIndex] of [
			[
				"collapsed reference image with math label",
				"[EASYMDE_MATH_0_TOKEN]: /i\n\n![$a$][]",
				1,
			],
			[
				"table cell with escaped pipe and math in label",
				"| A |\n| --- |\n| ![[x](/u)][a\\|$m$] |\n\n[a|EASYMDE_MATH_0_TOKEN]: /i",
				0,
			],
			[
				"table cell with escaped pipe inside math label",
				"| A |\n| --- |\n| ![[x](/u)][$a\\|b$] |\n\n[EASYMDE_MATH_0_TOKEN]: /i",
				0,
			],
			[
				"blockquote multiline reference label with math on line 2",
				"> ![[x](/u)][foo\n> $m$]\n\n[foo EASYMDE_MATH_0_TOKEN]: /i",
				0,
			],
			[
				"multiline paren math reference label with trailing text",
				"![[x](/u)][\\(a\nb\\)] tail\n\n[EASYMDE_MATH_0_TOKEN]: /i",
				0,
			],
			[
				"blockquote multiline paren math reference label",
				"> ![[x](/u)][\\(a\n> b\\)]\n\n[EASYMDE_MATH_0_TOKEN]: /i",
				0,
			],
			[
				"4-pass paren before dollar numbering in same reference label",
				"![[x](/u)][$a$ \\(b\\)]\n\n[EASYMDE_MATH_1_TOKEN EASYMDE_MATH_0_TOKEN]: /i",
				0,
			],
			[
				"code-separated segment numbering keeps $a$ as TOKEN_0",
				"![[x](/u)][$a$]\n\n`code`\n\n$$b$$\n\n[EASYMDE_MATH_0_TOKEN]: /i",
				0,
			],
			[
				"case-folded math token reference definition",
				"![[x](/u)][$a$]\n\n[easymde_math_0_token]: /i",
				0,
			],
		] as const) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(idx.imageBlocks?.[expectedBlockIndex], `status:${label}`).toEqual({
				count: 0,
				firstImageIndex: 0,
				status: "unavailable",
			});
			expect(idx.linkCandidates, `links:${label}`).toEqual([]);
		}

		// Math in both use and def produces distinct token indices (TOKEN_0 vs TOKEN_1), so it stays unresolved.
		const distinctTokens = "![[x](/u)][$m$]\n\n[$m$]: /i";
		const distinctTokensIdx = createEditorMarkdownBlockIndex(distinctTokens);
		expect(distinctTokensIdx.imageBlocks?.[0]?.status).toBe("ready");
		expect(
			(distinctTokensIdx.linkCandidates ?? []).map((r) =>
				distinctTokens.slice(r.from, r.to),
			),
		).toEqual(["[x](/u)"]);

		// Math crossing the opening or closing bracket of a reference label swallows the delimiter in PHP -> unresolved.
		const crossClose = "![a][b $c] d$\n\n[b EASYMDE_MATH_0_TOKEN]: /i";
		expect(createEditorMarkdownBlockIndex(crossClose).imageBlocks?.[0]?.status).toBe(
			"ready",
		);
		const crossOpen = "![[x](/u) $a][b$]\n\n[EASYMDE_MATH_0_TOKEN]: /i";
		const crossOpenIdx = createEditorMarkdownBlockIndex(crossOpen);
		expect(crossOpenIdx.imageBlocks?.[0]?.status).toBe("ready");
		expect(
			(crossOpenIdx.linkCandidates ?? []).map((r) => crossOpen.slice(r.from, r.to)),
		).toEqual(["[x](/u)"]);

		// 2. Track B F6c: display-math-broken Lezer Image nodes (inline and defined reference) do not block live links or mark blocks unavailable.
		const inlineDisplayBroken =
			"![[a](https://example.com) $$x$$](https://example.com/img.png)";
		const inlineDisplayIdx = createEditorMarkdownBlockIndex(inlineDisplayBroken);
		expect(inlineDisplayIdx.imageBlocks?.[0]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "ready",
		});
		expect(inlineDisplayIdx.imageRanges).toEqual([]);
		expect(
			(inlineDisplayIdx.linkCandidates ?? []).map((r) =>
				inlineDisplayBroken.slice(r.from, r.to),
			),
		).toEqual(["[a](https://example.com)", "https://example.com/img.png"]);

		const refDisplayBroken =
			"[defined]: https://example.com/img.png\n\n![[a](https://example.com) $$x$$][defined]";
		const refDisplayIdx = createEditorMarkdownBlockIndex(refDisplayBroken);
		expect(refDisplayIdx.imageBlocks?.[1]).toEqual({
			count: 0,
			firstImageIndex: 0,
			status: "ready",
		});
		expect(refDisplayIdx.imageRanges).toEqual([]);
		expect(
			(refDisplayIdx.linkCandidates ?? []).map((r) =>
				refDisplayBroken.slice(r.from, r.to),
			),
		).toEqual(["[a](https://example.com)", "[defined]"]);

		// Bracket display math, inline math before display math, blockquote, table cell, and relative-URL destination without phantom link.
		for (const [label, source, expectedBlockIndex, expectedLinks, expectedImages] of [
			[
				"bracket display math inside inline image",
				"![[a](https://example.com) \\[x\\]](https://example.com/img.png)",
				0,
				["[a](https://example.com)", "https://example.com/img.png"],
				[],
			],
			[
				"inline math preceding display math inside inline image",
				"![$m$ [a](https://example.com) $$x$$](https://example.com/img.png)",
				0,
				["[a](https://example.com)", "https://example.com/img.png"],
				[],
			],
			[
				"display math inside reference image label",
				"[defined]: https://example.com/img.png\n\n![[a](https://example.com)][$$x$$]",
				1,
				["[a](https://example.com)"],
				[],
			],
			[
				"blockquote display-math-broken inline image",
				"> ![[a](https://example.com) $$x$$](https://example.com/img.png)",
				0,
				["[a](https://example.com)", "https://example.com/img.png"],
				[],
			],
			[
				"display-math-broken inline image with relative destination omits non-autolink destination",
				"![[a](https://example.com) $$x$$](/img.png)",
				0,
				["[a](https://example.com)"],
				[],
			],
			[
				"table cell display-math-broken inline image exposes live links",
				"| A |\n| --- |\n| ![[a](https://example.com) $$x$$](https://example.com/img.png) |",
				0,
				["[a](https://example.com)", "https://example.com/img.png"],
				[],
			],
			[
				"sibling real inline image before display-math-broken image stays ready",
				"![ok](/ok.png) ![[a](https://example.com) $$x$$](https://example.com/img.png)",
				0,
				["[a](https://example.com)", "https://example.com/img.png"],
				["![ok](/ok.png)"],
			],
			[
				"nested real inline image before display math keeps inner link blocked and outer URL live",
				"![![[a](https://example.com)](https://example.com/inner.png) $$x$$](https://example.com/outer.png)",
				0,
				["https://example.com/outer.png"],
				["![[a](https://example.com)](https://example.com/inner.png)"],
			],
		] as const) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(idx.imageBlocks?.[expectedBlockIndex]?.status, `status:${label}`).toBe(
				"ready",
			);
			expect(
				(idx.imageRanges ?? []).map((r) => source.slice(r.from, r.to)),
				`images:${label}`,
			).toEqual([...expectedImages]);
			expect(
				(idx.linkCandidates ?? []).map((r) => source.slice(r.from, r.to)),
				`links:${label}`,
			).toEqual([...expectedLinks]);
		}

		// Positive control: inline math ($x$) does NOT break a defined reference image.
		const refInlineMath =
			"[defined]: https://example.com/img.png\n\n![[a](https://example.com) $x$][defined]";
		const refInlineMathIdx = createEditorMarkdownBlockIndex(refInlineMath);
		expect(refInlineMathIdx.imageBlocks?.[1]?.status).toBe("unavailable");
		expect(refInlineMathIdx.linkCandidates).toEqual([]);
	});

	it("matches PHP CommonMark §6.5, UrlAutolinkParser, and EmailAutolinkParser for display-math-broken inline image destinations (Round 29 Track B F5)", () => {
		const nonAutolinkCases: ReadonlyArray<readonly [string, string]> = [
			["invalid §6.5 angle email with bang", "![[x](https://a.com) $$m$$](<a@b!c>)"],
			["bare email ending in underscore", "![[x](https://a.com) $$m$$](a@b.c_)"],
			["bare email ending in hyphen", "![[x](https://a.com) $$m$$](a@b.c-)"],
			["root-relative path destination", "![[x](https://a.com) $$m$$](/img.png)"],
			["relative path destination", "![[x](https://a.com) $$m$$](relative/path.png)"],
			["fragment anchor destination", "![[x](https://a.com) $$m$$](#anchor)"],
			["angle email ending in underscore", "![[x](https://a.com) $$m$$](<a@b.c_>)"],
			["angle email ending in hyphen", "![[x](https://a.com) $$m$$](<a@b.c->)"],
			["mailto email ending in underscore", "![[x](https://a.com) $$m$$](mailto:a@b.c_)"],
			["mailto email ending in hyphen", "![[x](https://a.com) $$m$$](mailto:a@b.c-)"],
			["single-label email without dot", "![[x](https://a.com) $$m$$](a@b)"],
			["email with trailing dot after single label", "![[x](https://a.com) $$m$$](a@b.)"],
			["chained email blocked by first trailing underscore", "![[x](https://a.com) $$m$$](a@b.c_@d.e)"],
			["angle-wrapped bare www rejected by ALLOWED_AFTER", "![[x](https://a.com) $$m$$](<www.example.com>)"],
			["prefixed URL rejected by ALLOWED_AFTER", "![[x](https://a.com) $$m$$](foohttps://a.com)"],
			["single-label non-ASCII URL host", "![[x](https://a.com) $$m$$](https://例子)"],
			["invalid IPv6 URL host", "![[x](https://a.com) $$m$$](http://[invalid]/a)"],
			["unsupported ftps bare protocol", "![[x](https://a.com) $$m$$](ftps://example.com)"],
			["bare javascript protocol", "![[x](https://a.com) $$m$$](javascript:alert(1))"],
			["inline HTML open tag stripped by PHP", '![[x](https://a.com) $$m$$](<span title="user@example.com">)'],
			["inline HTML comment stripped by PHP", "![[x](https://a.com) $$m$$](<!-- user@example.com -->)"],
			["inline HTML declaration rejected as autolink", "![[x](https://a.com) $$m$$](<!a@b!c>)"],
			["inline HTML PI rejected as autolink", "![[x](https://a.com) $$m$$](<?a@b!c?>)"],
			["backtick code span wrapping URL", "![[x](https://a.com) $$m$$](`https://a.com`)"],
			["backtick code span wrapping email", "![[x](https://a.com) $$m$$](`user@example.com`)"],
			["escaped @ in email", "![[x](https://a.com) $$m$$](a\\@b.c)"],
			["bracket display math with invalid angle destination", "![[x](https://a.com) \\[m\\]](<a@b!c>)"],
			["table cell display-math-broken invalid angle destination", "| A |\n| --- |\n| ![[x](https://a.com) $$m$$](<a@b!c>) |"],
		];
		for (const [label, source] of nonAutolinkCases) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(idx.imageRanges, `images:${label}`).toEqual([]);
			expect(
				(idx.linkCandidates ?? []).map((r) => source.slice(r.from, r.to)),
				`links:${label}`,
			).toEqual(["[x](https://a.com)"]);
		}

		// Third column: the exact source range PHP wraps in `<a>` (Round 30 Track A #3).
		const autolinkCases: ReadonlyArray<readonly [string, string, string]> = [
			["single-label localhost URL", "![[x](https://a.com) $$m$$](https://localhost/img)", "https://localhost/img"],
			["ftp URL", "![[x](https://a.com) $$m$$](ftp://example.com/a.png)", "ftp://example.com/a.png"],
			["trailing-dot host URL", "![[x](https://a.com) $$m$$](https://example.)", "https://example"],
			["bare email", "![[x](https://a.com) $$m$$](user@example.com)", "user@example.com"],
			["angle-bracket URI autolink", "![[x](https://a.com) $$m$$](<https://a.com/b>)", "<https://a.com/b>"],
			["angle-bracket mailto autolink", "![[x](https://a.com) $$m$$](<mailto:user@example.com>)", "<mailto:user@example.com>"],
			["angle-bracket email autolink", "![[x](https://a.com) $$m$$](<user@example.com>)", "<user@example.com>"],
			["angle-bracket bang-local email autolink", "![[x](https://a.com) $$m$$](<!@example.com>)", "<!@example.com>"],
			["bare mailto with valid email", "![[x](https://a.com) $$m$$](mailto:user@example.com)", "user@example.com"],
			["bare www single-label host", "![[x](https://a.com) $$m$$](www.localhost)", "www.localhost"],
			["uppercase FTP protocol", "![[x](https://a.com) $$m$$](FTP://EXAMPLE.COM/A)", "FTP://EXAMPLE.COM/A"],
			["IPv6 bracket host", "![[x](https://a.com) $$m$$](http://[::1]/a)", "http://[::1]/a"],
			["Unicode multi-label domain", "![[x](https://a.com) $$m$$](https://例子.测试/路径)", "https://例子.测试/路径"],
			["URL with basic auth and port", "![[x](https://a.com) $$m$$](https://user:pass@localhost:8080/p)", "https://user:pass@localhost:8080/p"],
			["URL after ALLOWED_AFTER delimiter", "![[x](https://a.com) $$m$$](*https://a.com)", "https://a.com"],
			["email with trailing dot stripped by PHP", "![[x](https://a.com) $$m$$](a@b.c.)", "a@b.c"],
			["email with underscore before stripped dot", "![[x](https://a.com) $$m$$](a@b.c_.)", "a@b.c_"],
			["angle-wrapped email with trailing bang fallback", "![[x](https://a.com) $$m$$](<a@b.c!>)", "a@b.c"],
			["second email after rejected trailing-underscore email", "![[x](https://a.com) $$m$$](a@b.c_/d@e.f)", "d@e.f"],
			["email after escaped backslash", "![[x](https://a.com) $$m$$](a\\\\b@c.d)", "b@c.d"],
			["HTML comment swallowing backtick before email", "![[x](https://a.com) $$m$$](x<!--`-->user@b.c`)", "user@b.c"],
			["escaped first tick of double-tick run does not open code span", "![[x](https://a.com) $$m$$](\\``user@b.c`)", "user@b.c"],
			["bracket display math with localhost destination", "![[x](https://a.com) \\[m\\]](https://localhost/img)", "https://localhost/img"],
			["titled trailing-dot URL destination", '![[x](https://a.com) $$m$$](https://example. "title")', "https://example"],
			["blockquote ftp destination", "> ![[x](https://a.com) $$m$$](ftp://example.com/a.png)", "ftp://example.com/a.png"],
			["table cell localhost destination", "| A |\n| --- |\n| ![[x](https://a.com) $$m$$](https://localhost/img) |", "https://localhost/img"],
			["CRLF document localhost destination", "intro\r\n\r\n![[x](https://a.com) $$m$$](https://localhost/img)", "https://localhost/img"],
		];
		for (const [label, source, expectedDest] of autolinkCases) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(idx.imageRanges, `images:${label}`).toEqual([]);
			expect(
				(idx.linkCandidates ?? []).map((r) => source.slice(r.from, r.to)),
				`links:${label}`,
			).toEqual(["[x](https://a.com)", expectedDest]);
		}
	});

	it("keeps only PHP-consumed autolink ranges and evaluates destinations in their post-math inline block (Round 30 Track A #3, Track B F6)", () => {
		const links = (source: string) =>
			(createEditorMarkdownBlockIndex(source).linkCandidates ?? []).map((r) => ({
				kind: r.kind,
				reference: r.reference,
				text: source.slice(r.from, r.to),
			}));
		// Track A #3: trailing punctuation PHP leaves outside `<a>` is excluded.
		for (const [source, expected] of [
			["![[x](/u) $$m$$](https://example.)", "https://example"],
			["![[x](/u) $$m$$](a@b.c.)", "a@b.c"],
			// PHP's regex also consumes `)`, so the paren chop runs after punctuation trimming.
			["![[x](/u) $$m$$](https://a.com/b,)", "https://a.com/b,"],
			["![[x](/u) $$m$$](https://a.com/b:)", "https://a.com/b:"],
			["![[x](/u) $$m$$](https://a.com/(x)))", "https://a.com/(x)"],
			["![[x](/u) $$m$$](https://a.com/a&amp;)", "https://a.com/a&amp;"],
			["![[x](/u) $$m$$](https://localhost/img)", "https://localhost/img"],
			["![[x](/u) $$m$$](ftp://example.com/a.png)", "ftp://example.com/a.png"],
		] as const) {
			expect(links(source), source).toEqual([
				{ kind: "link", reference: false, text: "[x](/u)" },
				{ kind: "link", reference: false, text: expected },
			]);
		}
		// Track B F6: code spans and HTML comments closing after `)` (same or
		// next line of the same inline block) swallow the destination in PHP.
		for (const source of [
			"![$$x$$](`a@b.c) `",
			"![$$x$$](``a@b.c) ``",
			"![$$x$$](<` https://example.com>) `",
			"![$$x$$](x<!--a@b.c) -->",
			"![$$x$$](`a@b.c)\n`",
			"![$$x$$](x<!--a@b.c)\n-->",
			"- ![$$x$$](x<!--a@b.c)\n  -->",
			'![$$x$$](<a title="a@b.c) ">',
			"![$$x$$](\\_a@b.c)",
		]) {
			expect(links(source), JSON.stringify(source)).toEqual([]);
		}
		// The math split ends the blockquote, so a closer in the next `>` block
		// is a different inline block and PHP still links the email.
		expect(links("> ![$$x$$](`a@b.c)\n> `").map((l) => l.text)).toEqual(["a@b.c"]);
		// Track B F6: real inline and defined reference links inside the
		// destination render in PHP and stay live; plain relative paths do not.
		expect(links("![$$x$$]([text](/relative))")).toEqual([
			{ kind: "link", reference: false, text: "[text](/relative)" },
		]);
		expect(links("![$$x$$]([ref])\n\n[ref]: /target")).toEqual([
			{ kind: "link", reference: true, text: "[ref]" },
		]);
		expect(links("![$$x$$]([t][r])\n\n[r]: /target")).toEqual([
			{ kind: "link", reference: true, text: "[t][r]" },
		]);
		expect(links('![$$x$$]([t](/u "ti"))')).toEqual([
			{ kind: "link", reference: false, text: '[t](/u "ti")' },
		]);
		expect(links("![$$x$$](<https://a.com/b>)")).toEqual([
			{ kind: "autolink", reference: false, text: "<https://a.com/b>" },
		]);
		for (const source of [
			"![$$x$$]([nope])",
			"![$$x$$](/img.png)",
			"![$$x$$](relative/path.png)",
			"![$$x$$](#anchor)",
			"![$$x$$](![a@b.c](/i.png))",
		]) {
			expect(links(source), source).toEqual([]);
		}
		// A link PHP closes after the destination restores the inner email to text.
		expect(links("![$$x$$]([a@b.c)](/c)").map((l) => l.text)).not.toContain("a@b.c");
	});

	it("gives PHP sole link ownership over display-math-broken inline blocks and GFM table cells, preserves CRLF offsets, handles continuation tabs, and scales linearly (Round 31 Track A #3, Track B F4/F5/F6/F7b/F7c/F9)", () => {
		const links = (source: string) =>
			(createEditorMarkdownBlockIndex(source).linkCandidates ?? []).map((r) => ({
				from: r.from,
				kind: r.kind,
				reference: r.reference,
				text: source.slice(r.from, r.to),
				to: r.to,
			}));

		// Track A #3 & Track B F4c: code spans and HTML comments closing after `)` suppress later links in the same post-math block.
		for (const source of [
			"![$$x$$](`) a@b.c`",
			"![$$x$$](x<!--)a@b.c -->",
			"![$$x$$](`a) [bar](https://bar.com) `",
			"![$$x$$](``a) [bar](https://bar.com) ``",
			"![$$x$$](<!--a) [bar](https://bar.com) -->",
			"![$$x$$](`a) [bar](https://bar.com) ` | b\n| - | - |",
		]) {
			expect(links(source), JSON.stringify(source)).toEqual([]);
		}

		// Track B F4a: links starting inside a broken destination and closing after `)` stay owned as full PHP links without phantom Lezer leftovers.
		expect(links("![$$x$$]([a) b](https://a.com) tail")).toEqual([
			{
				from: 9,
				kind: "link",
				reference: false,
				text: "[a) b](https://a.com)",
				to: 30,
			},
		]);
		const f4aRef = "[a]: https://example.com\n\n![$$x$$]([b)\n][a]\nnext";
		expect(links(f4aRef)).toEqual([
			{
				from: 35,
				kind: "link",
				reference: true,
				text: "[b)\n][a]",
				to: 43,
			},
		]);

		// Track B F4b: links inside titles, multiple links in one destination/title, no-URL broken images, and pre-math/post-math title splits.
		for (const [label, source, expected] of [
			[
				"two URL autolinks across destination and title",
				'![$$x$$](https://a.com "see https://b.com")',
				["https://a.com", "https://b.com"],
			],
			[
				"markdown link inside broken image title",
				'![$$x$$](foo "see [click](https://b.com)")',
				["[click](https://b.com)"],
			],
			[
				"angle autolink inside broken image title",
				'![$$x$$](foo "see <https://b.com>")',
				["<https://b.com>"],
			],
			[
				"empty angle destination with link in title",
				'![$$x$$](<> "see [click](https://b.com)")',
				["[click](https://b.com)"],
			],
			[
				"empty parens broken image followed by single-label URL without Lezer URL node",
				"![$$x$$]() https://x?",
				["https://x"],
			],
			[
				"empty parens broken image followed by www.localhost without Lezer URL node",
				"![$$x$$]() www.localhost",
				["www.localhost"],
			],
			[
				"display math splitting inside image title exposes both pre-math and post-math links",
				'![a](https://a.com "see [b](https://b.com) $$x$$ [c](https://c.com)")',
				["https://a.com", "[b](https://b.com)", "[c](https://c.com)"],
			],
			[
				"display math splitting inside image URL exposes pre-math URL",
				"![a](https://a.com/$$x$$/b)",
				["https://a.com/"],
			],
			[
				"nested inner link deactivates outer link and exposes tail URL",
				"![$$x$$]([a) [b](https://b.com)](https://a.com)",
				["[b](https://b.com)", "https://a.com"],
			],
			[
				"display-math-broken destination ending with query mark inside parens",
				"![$$x$$](https://x?)",
				["https://x?"],
			],
		] as const) {
			expect(
				links(source).map((item) => item.text),
				label,
			).toEqual([...expected]);
		}

		// Track B F5: CRLF multiline links preserve exact [from, to) offsets without +1 overshoot or clipping.
		const crlfTitle = '![$$x$$]([a](https://example.com\r\n"title"))\r\nnext';
		expect(links(crlfTitle)).toEqual([
			{
				from: 9,
				kind: "link",
				reference: false,
				text: '[a](https://example.com\r\n"title")',
				to: 42,
			},
		]);
		const crlfAdjacent = "![$$x$$]([a)\r\nb](/rel)[c](/c)";
		expect(links(crlfAdjacent)).toEqual([
			{
				from: 9,
				kind: "link",
				reference: false,
				text: "[a)\r\nb](/rel)",
				to: 22,
			},
			{
				from: 22,
				kind: "link",
				reference: false,
				text: "[c](/c)",
				to: 29,
			},
		]);
		const crlfRef = "[a]: https://example.com\r\n\r\n![$$x$$]([b)\r\n][a]\r\nnext";
		expect(links(crlfRef).map((item) => item.text)).toEqual(["[b)\r\n][a]"]);

		// Track B F6: post-math GFM table header/body cells own their exact links and handle `\|` unescaping and cell isolation.
		for (const [label, source, expected] of [
			[
				"table header row broken image URL",
				"![$$x$$](https://example.com) | b\n| - | - |",
				["https://example.com"],
			],
			[
				"table header row broken image plus sibling cell link",
				"![$$x$$](https://a.com) | https://b.com\n| - | - |",
				["https://a.com", "https://b.com"],
			],
			[
				"table header row code span masks same cell while keeping next cell link",
				"![$$x$$](`a) [bar](https://bar.com) ` | [ok](https://ok.com)\n| - | - |",
				["[ok](https://ok.com)"],
			],
			[
				"table header row escaped pipe in link text",
				"![$$x$$]([a\\|b](/rel)) | b\n| - | - |",
				["[a\\|b](/rel)"],
			],
			[
				"table header row escaped pipe in URL path stops before pipe",
				"![$$x$$](https://example.com/a\\|b) | b\n| - | - |",
				["https://example.com/a"],
			],
			[
				"table header row unescaped pipe splits cells without crossing into cell 2",
				"![$$x$$](https://a|b.com)\n| - | - |",
				["https://a"],
			],
			[
				"table header row escaped pipe in domain matches PHP TableParser unescaping",
				"![$$x$$](https://a\\|b.com) | c\n| - | - |",
				["https://a\\|b.com"],
			],
			[
				"table header row double-backslash pipe exposes email",
				"![$$x$$](a\\\\|b@c.d) | b\n| - | - |",
				["b@c.d"],
			],
			[
				"table header row escaped pipe reference link resolves unescaped def",
				"[a|b]: /target\n\n![$$x$$]([a\\|b]) | c\n| - | - |",
				["[a\\|b]"],
			],
			[
				"table body row display-math-broken image exposes post-math paragraph link",
				"| a | b |\n| - | - |\n| ![$$x$$](https://example.com) | b |",
				["https://example.com"],
			],
			[
				"table header row broken image URL with query mark",
				"![$$x$$](https://x?) | b\n| - | - |",
				["https://x?"],
			],
		] as const) {
			expect(
				links(source).map((item) => item.text),
				label,
			).toEqual([...expected]);
		}

		// Track B F9: leading tab on paragraph continuation line inside inline link tail.
		for (const [label, source, expected] of [
			[
				"leading tab before title on continuation line",
				'![$$x$$]([a](/rel\n\t"title"))',
				['[a](/rel\n\t"title")'],
			],
			[
				"multiline label with leading tab before title",
				'![$$x$$]([a)\n](/rel\n\t"title")',
				['[a)\n](/rel\n\t"title")'],
			],
			[
				"leading tab before destination on continuation line",
				"![$$x$$]([a](\n\t/rel))",
				["[a](\n\t/rel)"],
			],
			[
				"leading tab before closing paren on continuation line",
				"![$$x$$]([a](/rel\n\t))",
				["[a](/rel\n\t)"],
			],
			[
				"CRLF with leading tab before multiline title",
				'intro\r\n\r\n![$$x$$]([a)\r\nb](/rel\r\n\t"ti\r\ntle"))\r\n[c](/c)',
				['[a)\r\nb](/rel\r\n\t"ti\r\ntle")', "[c](/c)"],
			],
			[
				"same-line tab before title stays rejected",
				'![$$x$$]([a](/rel\t"title"))',
				[],
			],
			[
				"trailing tab before newline stays rejected",
				'![$$x$$]([a](/rel\t\n"title"))',
				[],
			],
		] as const) {
			expect(
				links(source).map((item) => item.text),
				label,
			).toEqual([...expected]);
		}

		// Track B F7b/F7c: O(N) opener deactivation and zero O(K^2) post-math scanning.
		// Measure `collectPhpDisplayMathBrokenBlockLinks` directly on 12,000 stacked
		// `[` and `![` openers (isolating PHP inline replay from `@lezer/markdown`'s
		// own bracket parser), plus end-to-end block-index probes.
		for (const openerToken of ["[", "!["] as const) {
			const manyOpeners = `![$$x$$](foo) ${openerToken.repeat(12_000)}${"[a](/x)".repeat(12_000)}`;
			const mathRanges = scanPhpMarkdownMathRanges(manyOpeners).filter(
				(range) => range.block,
			);
			const blockScan = scanPhpCommonMarkBlocks(manyOpeners, mathRanges);
			const tOpeners = performance.now();
			const owned = collectPhpDisplayMathBrokenBlockLinks(
				manyOpeners,
				blockScan,
				mathRanges,
				[{ from: 0, to: 13 }],
				() => false,
			);
			const elapsedOpeners = performance.now() - tOpeners;
			expect(owned.links, openerToken).toHaveLength(12_000);
			expect(elapsedOpeners, openerToken).toBeLessThan(1_500);
		}

		const endToEndOpeners = `![$$x$$](foo) ${"[".repeat(3_000)}${"[a](/x)".repeat(3_000)}`;
		const tEndToEnd = performance.now();
		const endToEndIdx = createEditorMarkdownBlockIndex(endToEndOpeners);
		expect(endToEndIdx.linkCandidates).toHaveLength(3_000);
		expect(performance.now() - tEndToEnd).toBeLessThan(1_500);

		const manyBrokenDestinations = `${"![$$x$$](https://a.com) ".repeat(1_000)}`;
		const tManyBroken = performance.now();
		const manyBrokenIdx = createEditorMarkdownBlockIndex(manyBrokenDestinations);
		expect(manyBrokenIdx.linkCandidates).toHaveLength(1_000);
		expect(performance.now() - tManyBroken).toBeLessThan(1_500);
	});

	it("keeps multi-line display-math-broken scanning strictly linear at 128k lines and indexes escaped-pipe GFM table links (Round 32 Track A #2/#5)", () => {
		const largeDoc = `![$$x$$](z)\n${"abcdef\n".repeat(128_000)}`;
		const mathRanges = scanPhpMarkdownMathRanges(largeDoc).filter(
			(range) => range.block,
		);
		const scan = scanPhpCommonMarkBlocks(largeDoc, mathRanges);
		const tDirect = performance.now();
		const owned = collectPhpDisplayMathBrokenBlockLinks(
			largeDoc,
			scan,
			mathRanges,
			[{ from: 0, to: 11 }],
			() => false,
		);
		expect(owned.links).toEqual([]);
		expect(performance.now() - tDirect).toBeLessThan(1_500);

		const tFull = performance.now();
		const idx = createEditorMarkdownBlockIndex(largeDoc);
		expect(idx.linkCandidates).toEqual([]);
		expect(performance.now() - tFull).toBeLessThan(1_500);

		const links = (source: string) =>
			(createEditorMarkdownBlockIndex(source).linkCandidates ?? []).map(
				(candidate) => ({
					kind: candidate.kind,
					reference: candidate.reference,
					text: source.slice(candidate.from, candidate.to),
				}),
			);

		expect(links("| <https://a\\|b.com> |\n| - |")).toEqual([
			{ kind: "autolink", reference: false, text: "<https://a\\|b.com>" },
		]);
		expect(links("| <https://a\\\\|b.com> |\n| - |")).toEqual([
			{ kind: "autolink", reference: false, text: "<https://a\\\\|b.com>" },
		]);
		expect(links("| https://example.com/a\\|b |\n| - |")).toEqual([
			{ kind: "link", reference: false, text: "https://example.com/a" },
		]);
		expect(links("| https://a\\|b.com |\n| - |")).toEqual([
			{ kind: "link", reference: false, text: "https://a\\|b.com" },
		]);
		expect(links("| https://a\\\\|b.com |\n| - |")).toEqual([
			{ kind: "link", reference: false, text: "https://a" },
		]);
		expect(
			links("| [foo\\|bar] |\n| - |\n\n[foo|bar]: https://pipe-ref.example"),
		).toEqual([{ kind: "link", reference: true, text: "[foo\\|bar]" }]);
		expect(
			links(
				"| [lbl][foo\\|bar] |\n| - |\n\n[foo|bar]: https://pipe-ref.example",
			),
		).toEqual([{ kind: "link", reference: true, text: "[lbl][foo\\|bar]" }]);
		expect(
			links(
				"| [foo\\\\|bar] |\n| - |\n\n[foo\\|bar]: https://dbl-pipe-ref.example",
			),
		).toEqual([{ kind: "link", reference: true, text: "[foo\\\\|bar]" }]);
		expect(
			links("| [foo\\|bar] |\n| - |\n\n[foo\\|bar]: https://wrong.example"),
		).toEqual([]);
	});

	it("aligns bare GFM autolink boundaries in ordinary paragraphs and unescaped tables with PHP AutolinkExtension and tags table-cell metadata (Round 33 Track A #2/#3/#4)", () => {
		const links = (source: string) =>
			(createEditorMarkdownBlockIndex(source).linkCandidates ?? []).map(
				(candidate) => ({
					from: candidate.from,
					kind: candidate.kind,
					reference: candidate.reference,
					text: source.slice(candidate.from, candidate.to),
					to: candidate.to,
				}),
			);

		// Ordinary paragraphs (without display math)
		for (const [source, expectedTexts] of [
			["www.a@b.c_.", ["www.a@b.c_"]],
			["www.a@b.c-.", ["www.a@b.c-"]],
			["www.a@b.c..", ["www.a@b.c."]],
			["www.a@b.c_", ["www.a"]],
			["(https://a.com/b,)", ["https://a.com/b,"]],
			["(https://x?)", ["https://x?"]],
			["(www.example.com?)", ["www.example.com?"]],
			["https://example.com?&amp;", ["https://example.com?"]],
			["https://x/))))&lt;)", ["https://x/))))"]],
			["https://example.com?a)))*x*)))))))", ["https://example.com?a)))"]],
			["(https://x/a)é)", ["https://x/a)é"]],
			["(https://x/a)中)", ["https://x/a)中"]],
			["(https://x/a)𐐀)", ["https://x/a)𐐀"]],
			["https://a.com/b,", ["https://a.com/b"]],
			["https://localhost/img", ["https://localhost/img"]],
			["ftp://example.com/a.png", ["ftp://example.com/a.png"]],
			["www.localhost", ["www.localhost"]],
			["http://[::1]/a", ["http://[::1]/a"]],
			["https://例子.测试/路径", ["https://例子.测试/路径"]],
			["[label](https://a.com/b,)", ["[label](https://a.com/b,)"]],
			["<https://a.com/b,>", ["<https://a.com/b,>"]],
			["## www.a@b.c_. ##", ["www.a@b.c_"]],
			["> (https://a.com/b,)", ["https://a.com/b,"]],
			["- (https://x?)", ["https://x?"]],
			[
				"www.a@b.c_.\r\n\r\n(https://a.com/b,)\r\n\r\n(https://x/a)é)",
				["www.a@b.c_", "https://a.com/b,", "https://x/a)é"],
			],
		] as const) {
			expect(
				links(source).map((item) => item.text),
				source,
			).toEqual([...expectedTexts]);
		}

		// Exact span check for `www.a@b.c_.`: `[0, 10)` covers `www.` and `a@b.c_` as one link.
		expect(links("www.a@b.c_.")).toEqual([
			{ from: 0, kind: "link", reference: false, text: "www.a@b.c_", to: 10 },
		]);

		// Ordinary unescaped tables (without display math or `\|`)
		for (const [source, expectedTexts] of [
			["| www.a@b.c_. |\n| - |", ["www.a@b.c_"]],
			["| (https://a.com/b,) |\n| - |", ["https://a.com/b,"]],
			["| (https://x?) |\n| - |", ["https://x?"]],
			["| (https://x/a)é) |\n| - |", ["https://x/a)é"]],
			[
				"| h1 | h2 |\n| - | - |\n| (https://a.com/b,) | www.a@b.c_. |",
				["https://a.com/b,", "www.a@b.c_"],
			],
		] as const) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(
				(idx.linkCandidates ?? []).map((c) => source.slice(c.from, c.to)),
				source,
			).toEqual([...expectedTexts]);
			expect(idx.linkTableCells?.size, `tableCells:${source}`).toBe(
				expectedTexts.length,
			);
		}

		// Plain paragraph containing `|` has empty `linkTableCells` metadata (O(1) non-table proof).
		const plainPipeIdx = createEditorMarkdownBlockIndex(
			"https://example.com | note",
		);
		expect(plainPipeIdx.linkCandidates?.map((c) => plainPipeIdx.source.slice(c.from, c.to))).toEqual([
			"https://example.com",
		]);
		expect(plainPipeIdx.linkTableCells?.size).toBe(0);

		// Negative controls stay unlinked.
		for (const source of [
			"`www.a@b.c_.`",
			"`(https://a.com/b,)`",
			"<!-- www.a@b.c_. -->",
			"a <!-- www.a@b.c_. --> b",
			"<www.example.com>",
			"![alt](https://a.com/b,)",
			"$$www.a@b.c_.$$",
			"$www.a@b.c_.$",
			"| h1 |\n| - |\n| 1 | www.a@b.c_. |",
		]) {
			expect(links(source), source).toEqual([]);
		}
	});
});

describe("Round 34 PHP table and math link parity", () => {
	const links = (source: string) =>
		(createEditorMarkdownBlockIndex(source).linkCandidates ?? []).map(
			(candidate) => source.slice(candidate.from, candidate.to),
		);

	it("reconciles PHP-owned bare autolinks behind cross-pipe Link/LinkReference nodes (Track B #3)", () => {
		// Verbatim real `MarkdownRenderer::render_preview()` anchor sets.
		for (const [source, expected] of [
			['| [text](https://a.com "x | y") |\n| --- | --- | --- |', ["https://a.com"]],
			[
				'| [text](mailto:a@b.c "user@example.com | y") |\n| --- | --- |',
				["a@b.c", "user@example.com"],
			],
			['a | b\n[x](https://a.com "p | q")\n| --- | --- |', ["https://a.com"]],
			["[a | https://example.com\n--- | ---\n]: /u", ["https://example.com"]],
			[
				"[a | https://example.com\n--- | ---\n]: /u\n\nafter https://b.example",
				["https://example.com", "https://b.example"],
			],
			// Controls: pipe-free links stay covered; a non-table refdef stays unavailable.
			['[text](https://a.com "x y") www.b.c', ["[text](https://a.com \"x y\")", "www.b.c"]],
			["[a | b\n--- | ---\n]: /u", []],
			["[a]: https://example.com", []],
		] as const) {
			expect(links(source), source).toEqual(expected);
		}
		const refdefTable = createEditorMarkdownBlockIndex(
			"[a | https://example.com\n--- | ---\n]: /u",
		);
		expect(refdefTable.blocks).toEqual([
			expect.objectContaining({ editable: true, kind: "table" }),
		]);
		// Math keeps the conservative Lezer refdef classification (no candidate).
		for (const source of ["[a | $x$ https://example.com\n--- | ---\n]: /u"]) {
			expect(
				createEditorMarkdownBlockIndex(source).blocks.map((block) => block.kind),
				source,
			).toEqual(["unavailable"]);
		}
	});

	it("never fabricates a bare URL whose raw match crosses inline math (Track B #5)", () => {
		for (const source of [
			"https://example.com/a))))$x$)",
			"| a | b |\n| - | - |\n| https://example.com/a))))$x$) | c |",
			"https://example.com/a$x$",
			"x a@b.c$x$ y",
		]) {
			expect(links(source), source).toEqual([]);
		}
		for (const [source, expected] of [
			["https://example.com $x$", ["https://example.com"]],
			["$x$ https://example.com", ["https://example.com"]],
			["https://example.com/a) $x$)", ["https://example.com/a"]],
			["| a | b |\n| - | - |\n| https://example.com/a) $x$ | c |", ["https://example.com/a"]],
		] as const) {
			expect(links(source), source).toEqual(expected);
		}
	});
});

describe("Round 35 exact PHP table reconciliation and PHP-owned reconciled links", () => {
	it("marks only real table delimiter rows with isTableDelimiter and keeps multi-table HTML/comment and partial refdef spans unavailable (Track B Finding 1)", () => {
		const multiTableHtml =
			"| a | b |\n| - | - |\n<pre> | https://a.example\n\nhttps://b.example | </pre>\n| - | - |";
		const multiTableComment =
			"| a | b |\n| - | - |\n<!-- | https://a.example\n---\nhttps://b.example | -->\n| - | - |";
		const partialRefdef = "[a | b]: /ref \"\n| - | - |\n| c | d\"\n| e | f |";

		const htmlScan = scanPhpCommonMarkBlocks(multiTableHtml);
		expect(htmlScan.lines.map((line) => Boolean(line.isTableDelimiter))).toEqual([
			false,
			true,
			false,
			false,
			false,
			true,
		]);
		const commentScan = scanPhpCommonMarkBlocks(multiTableComment);
		expect(commentScan.lines.map((line) => Boolean(line.isTableDelimiter))).toEqual([
			false,
			true,
			false,
			false,
			false,
			true,
		]);

		const htmlIdx = createEditorMarkdownBlockIndex(multiTableHtml);
		expect(
			htmlIdx.blocks.find((block) => block.lineStart === 2 && block.lineEnd === 4),
		).toMatchObject({ editable: false, kind: "unavailable" });

		const commentIdx = createEditorMarkdownBlockIndex(multiTableComment);
		expect(
			commentIdx.blocks.find(
				(block) => block.lineStart === 2 && block.lineEnd === 4,
			),
		).toMatchObject({ editable: false, kind: "unavailable" });

		const partialIdx = createEditorMarkdownBlockIndex(partialRefdef);
		expect(partialIdx.blocks[0]).toMatchObject({
			editable: false,
			kind: "unavailable",
			lineEnd: 2,
			lineStart: 0,
		});
	});

	it("reconciles 2-line and 3-line PHP refdef tables and extracts all PHP-owned cell links (Track B Finding 2)", () => {
		const cases: ReadonlyArray<
			Readonly<{
				expectedLinks: ReadonlyArray<{
					kind: "autolink" | "link";
					reference: boolean;
					text: string;
				}>;
				source: string;
			}>
		> = [
			{
				expectedLinks: [
					{ kind: "link", reference: false, text: "https://example.com" },
				],
				source: "[a|https://example.com]:\n|-|-|",
			},
			{
				expectedLinks: [{ kind: "link", reference: false, text: "[c](/bar)" }],
				source: '[a | b]: /ref "\n| - | - |\n| [c](/bar) | d"',
			},
			{
				expectedLinks: [
					{ kind: "link", reference: false, text: "[c](/bar)" },
					{ kind: "link", reference: false, text: "https://c.example" },
				],
				source: '[a | b]: /ref "\n| - | - |\n| [c](/bar) | https://c.example"',
			},
			{
				expectedLinks: [{ kind: "link", reference: true, text: "[c][k]" }],
				source: '[a | b]: /ref "\n| - | - |\n| [c][k] | d"\n\n[k]: https://k.example',
			},
			{
				expectedLinks: [
					{ kind: "autolink", reference: false, text: "<tel:12345>" },
				],
				source: '[a | b]: /ref "\n| - | - |\n| <tel:12345> | d"',
			},
		];

		for (const { expectedLinks, source } of cases) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(idx.blocks[0], source).toMatchObject({
				editable: true,
				kind: "table",
			});
			expect(
				(idx.linkCandidates ?? []).map((candidate) => ({
					kind: candidate.kind,
					reference: candidate.reference,
					text: source.slice(candidate.from, candidate.to),
				})),
				source,
			).toEqual(expectedLinks);
			expect(idx.linkTableCells?.size, source).toBe(expectedLinks.length);
		}
	});

	it("retains exact PHP table-cell metadata when multiline paren math crosses Lezer block boundaries (Round 36 Track B Finding 3)", () => {
		const cases: ReadonlyArray<
			Readonly<{
				expectedUnescaped: string;
				needle: string;
				source: string;
			}>
		> = [
			{
				expectedUnescaped: "[x][a|b]",
				needle: "[x][a\\|b]",
				source: '[r]: /u "\\(a"\nb\\) [x][a\\|b] | c |\n| --- | --- |\n\n[a|b]: https://example.com/ok',
			},
			{
				expectedUnescaped: "[x][a|b]",
				needle: "[x][a\\|b]",
				source: "| [x][a\\|b] \\(m\n\nn\\) | c |\n| --- | --- |\n\n[a|b]: https://example.com/ok",
			},
			{
				expectedUnescaped: "[x](https://example.com/1\\|2)",
				needle: "[x](https://example.com/1\\\\|2)",
				source: "| [x](https://example.com/1\\\\|2) \\(m\n\nn\\) | c |\n| --- | --- |",
			},
			{
				expectedUnescaped: "[x](https://example.com/1\\|2)",
				needle: "[x](https://example.com/1\\\\|2)",
				source: "| [x](https://example.com/1\\\\|2) \\(m\n# h\nn\\) | c |\n| --- | --- |",
			},
			{
				expectedUnescaped: "[x](https://example.com/1\\|2)",
				needle: "[x](https://example.com/1\\\\|2)",
				source: '[r]: /u "\\(a"\nb\\) [x](https://example.com/1\\\\|2) | c |\n| --- | --- |',
			},
			{
				expectedUnescaped: "[x](https://example.com/1\\|2)",
				needle: "[x](https://example.com/1\\\\|2)",
				source: "| [x](https://example.com/1\\\\|2) \\(m\n<div>\nn\\) | c |\n| --- | --- |",
			},
		];

		for (const { expectedUnescaped, needle, source } of cases) {
			const idx = createEditorMarkdownBlockIndex(source);
			const candidateFrom = source.indexOf(needle);
			expect(
				(idx.linkCandidates ?? []).map((candidate) =>
					source.slice(candidate.from, candidate.to),
				),
				source,
			).toEqual([needle]);
			expect(idx.linkTableCells?.size, source).toBe(1);
			const cell = idx.linkTableCells?.get(candidateFrom);
			expect(cell?.unescapedSource, source).toBe(expectedUnescaped);
			expect(cell?.maskedCellText, source).toBeDefined();
			expect(cell?.maskedCellText, source).not.toContain("\n");
		}
	});

	it("reconciles post-refdef 4-space/tab indented inline math to paragraph while preserving genuine indented code blocks (Round 37 Track B Finding 4)", () => {
		for (const source of [
			"[r]: /u\n    $x$\n\n| [a](https://example.com) | b |\n| - | - |",
			"[r]: /u\n    $x$",
			"[r]: /u\n\t$x$",
			"[r]: /u\n    \\(x\\)",
			"[r]: /u\n    \\(x\n\ny\\)",
		]) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(
				idx.blocks.some((block) => "code" === block.kind),
				source,
			).toBe(false);
			expect(idx.blocks[1], source).toMatchObject({
				editable: true,
				kind: "paragraph",
			});
			expect(idx.mathSpans, source).toHaveLength(1);
		}

		// Split case: post-refdef indented inline math followed by blank line + genuine indented code.
		const splitSource = "[r]: /u\n    $x$\n\n    $y$";
		const splitIdx = createEditorMarkdownBlockIndex(splitSource);
		expect(splitIdx.blocks.map((block) => block.kind)).toEqual([
			"unavailable",
			"paragraph",
			"code",
		]);
		expect(
			splitIdx.mathSpans.map((span) => splitSource.slice(span.from, span.to)),
		).toEqual(["$x$"]);

		// Post-refdef 4-space display math reconciles to paragraph before overlayMath -> math block.
		const displayPostRefdef = "[r]: /u\n    $$x$$";
		const displayIdx = createEditorMarkdownBlockIndex(displayPostRefdef);
		expect(displayIdx.blocks.map((block) => block.kind)).toEqual([
			"unavailable",
			"math",
		]);
		expect(displayIdx.mathSpans).toHaveLength(1);

		// Negative controls: genuine indented code blocks keep kind="code" and 0 math spans.
		for (const genuineCode of ["\n\n    $x$", "[r]: /u\n\n    $x$"]) {
			const idx = createEditorMarkdownBlockIndex(genuineCode);
			expect(
				idx.blocks.some((block) => "code" === block.kind),
				genuineCode,
			).toBe(true);
			expect(idx.mathSpans, genuineCode).toEqual([]);
		}
	});

	it("recovers live PHP table links after multiline paren math containing an HTML block tag while keeping plain HTML blocks unavailable (Round 37 Track A #3)", () => {
		const cases: ReadonlyArray<
			Readonly<{
				expectedLinks: ReadonlyArray<{
					kind: "autolink" | "link";
					reference: boolean;
					text: string;
				}>;
				expectedUnescaped?: string;
				source: string;
			}>
		> = [
			{
				expectedLinks: [{ kind: "link", reference: false, text: "[x](/u)" }],
				source: "\\(a\n<div>\nb\\) | [x](/u)\n-|-",
			},
			{
				expectedLinks: [
					{ kind: "link", reference: false, text: "[x](/a\\\\|b)" },
				],
				expectedUnescaped: "[x](/a\\|b)",
				source: "\\(a\n<div>\nb\\) | [x](/a\\\\|b)\n-|-",
			},
			{
				expectedLinks: [{ kind: "link", reference: true, text: "[x][k]" }],
				source: "\\(a\n<div>\nb\\) | [x][k]\n-|-\n\n[k]: https://k.example",
			},
			{
				expectedLinks: [
					{ kind: "link", reference: false, text: "https://a.example" },
				],
				source: "\\(a\n<div>\nb\\) | https://a.example\n-|-",
			},
			{
				expectedLinks: [{ kind: "link", reference: false, text: "[x](/u)" }],
				source: "\\(a\n<div>\nb\\) | c\n-|-\n| [x](/u) | d |",
			},
			{
				expectedLinks: [{ kind: "link", reference: false, text: "[z](/u)" }],
				source: "| a | b |\n| - | - |\n| \\(x\n<div>\ny\\) | [z](/u) |",
			},
			{
				expectedLinks: [
					{ kind: "link", reference: false, text: "[x](/a\\\\|b)" },
				],
				expectedUnescaped: "[x](/a\\|b)",
				source: "\\(a\r\n<div>\r\nb\\) | [x](/a\\\\|b)\r\n-|-",
			},
			{
				expectedLinks: [{ kind: "link", reference: false, text: "[z](/u)" }],
				source: "[r]: /u\n    \\(x\n<div>\ny\\) | [z](/u)\n-|-",
			},
		];

		for (const { expectedLinks, expectedUnescaped, source } of cases) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(
				idx.blocks.some((block) => "table" === block.kind && block.editable),
				source,
			).toBe(true);
			expect(idx.mathSpans.length, source).toBeGreaterThanOrEqual(1);
			expect(
				(idx.linkCandidates ?? []).map((candidate) => ({
					kind: candidate.kind,
					reference: candidate.reference,
					text: source.slice(candidate.from, candidate.to),
				})),
				source,
			).toEqual(expectedLinks);
			expect(idx.linkTableCells?.size, source).toBe(expectedLinks.length);
			if (expectedUnescaped) {
				const first = idx.linkCandidates?.[0];
				const cell = first ? idx.linkTableCells?.get(first.from) : undefined;
				expect(cell?.unescapedSource, source).toBe(expectedUnescaped);
			}
		}

		// Trailing real HTML block after the reconciled table remains unavailable and excluded.
		const trailingHtml =
			"\\(a\n<div>\nb\\) | [x](/u)\n-|-\n<div>\n[bad](/no)\n</div>";
		const trailingIdx = createEditorMarkdownBlockIndex(trailingHtml);
		expect(trailingIdx.blocks.map((block) => block.kind)).toEqual([
			"table",
			"unavailable",
		]);
		expect(
			(trailingIdx.linkCandidates ?? []).map((c) =>
				trailingHtml.slice(c.from, c.to),
			),
		).toEqual(["[x](/u)"]);

		// Negative control: plain HTML block without math stays unavailable with 0 links.
		const plainHtml = "<div>\n[x](/u)\n</div>";
		const plainHtmlIdx = createEditorMarkdownBlockIndex(plainHtml);
		expect(plainHtmlIdx.blocks).toEqual([
			expect.objectContaining({ editable: false, kind: "unavailable" }),
		]);
		expect(plainHtmlIdx.linkCandidates).toEqual([]);
	});

	it("reconciles post-refdef 4-space/tab indented CodeBlocks against post-math phpBlockScan with full link, table, image, display-math, and nested-refdef parity (Round 38 Track A #4, Track B Finding 2)", () => {
		const linkTexts = (source: string) =>
			(createEditorMarkdownBlockIndex(source).linkCandidates ?? []).map((c) =>
				source.slice(c.from, c.to),
			);

		// Reproducers 1, 3, 4: post-refdef indented inline paragraphs extract PHP-owned links & bare autolinks.
		expect(linkTexts("[r]: /u\n    $a$ [x](/v)")).toEqual(["[x](/v)"]);
		expect(linkTexts("[r]: /u\n    [link](https://example.com)")).toEqual([
			"[link](https://example.com)",
		]);
		expect(linkTexts("[r]: /u\n    https://example.com")).toEqual([
			"https://example.com",
		]);

		// Reproducers 2 & 6: post-refdef indented PHP GFM tables become editable `table` blocks with PHP-owned links and table-cell metadata.
		for (const [source, expectedLink] of [
			["[r]: /u\n    c | [x](/v)\n-|-", "[x](/v)"],
			[
				"[r]: /u\n    | a | b |\n    | --- | --- |\n    | [link](/local) | 2 |",
				"[link](/local)",
			],
			["[r]: /u\n    a | b\n--- | ---\n    [x](/v) | 2", "[x](/v)"],
			["[r]: /u\n    | [a](/x\\|y) | b |\n    | --- | --- |", "[a](/x\\|y)"],
		] as const) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(idx.blocks[1], source).toMatchObject({
				editable: true,
				kind: "table",
			});
			expect(
				(idx.linkCandidates ?? []).map((c) => source.slice(c.from, c.to)),
				source,
			).toEqual([expectedLink]);
			expect(idx.linkTableCells?.size, source).toBe(1);
		}

		// Reproducer 5 & image variants: never falsely report `{ count: 0, status: "ready" }` for reconciled PHP images.
		const inlineImgSrc = "[r]: /u\n    ![alt](https://example.com/a.png)";
		const inlineImgIdx = createEditorMarkdownBlockIndex(inlineImgSrc);
		expect(inlineImgIdx.blocks[1]).toMatchObject({
			editable: true,
			kind: "paragraph",
		});
		expect(inlineImgIdx.imageBlocks[1]).toEqual({
			count: 1,
			firstImageIndex: 0,
			status: "ready",
		});
		expect(
			inlineImgIdx.imageRanges.map((r) => inlineImgSrc.slice(r.from, r.to)),
		).toEqual(["![alt](https://example.com/a.png)"]);

		const refImgIdx = createEditorMarkdownBlockIndex("[r]: /u\n    ![alt][r]");
		expect(refImgIdx.imageBlocks[1]).toMatchObject({
			count: 0,
			status: "unavailable",
		});
		expect(refImgIdx.linkCandidates).toEqual([]);

		// Inline image wrapping a link emits the image and 0 links; unresolved ref image emits the inner link.
		const imgWrappingLink = createEditorMarkdownBlockIndex(
			"[r]: /u\n    ![[x](/v)](https://example.com/a.png)",
		);
		expect(imgWrappingLink.imageRanges).toHaveLength(1);
		expect(imgWrappingLink.linkCandidates).toEqual([]);
		expect(linkTexts("[r]: /u\n    ![[x](/v)][missing]")).toEqual(["[x](/v)"]);

		// Reproducer 7: post-display-math indented code line stays `kind: "code"` with 0 links (and post-display-math indented `$y$` stays code without invalid worker math spans).
		const postDisplayCode =
			"[r]: /u\n    $$x$$\n    [link](https://example.com)";
		const postDisplayIdx = createEditorMarkdownBlockIndex(postDisplayCode);
		expect(postDisplayIdx.blocks.map((b) => b.kind)).toEqual([
			"unavailable",
			"math",
			"code",
		]);
		expect(postDisplayIdx.linkCandidates).toEqual([]);
		expect(postDisplayIdx.mathSpans).toHaveLength(1);

		const postDisplaySameLine = createEditorMarkdownBlockIndex(
			"[r]: /u\n    $$x$$ [b](/b)",
		);
		expect(postDisplaySameLine.blocks.map((b) => b.kind)).toEqual([
			"unavailable",
			"math",
			"paragraph",
		]);
		expect(
			(postDisplaySameLine.linkCandidates ?? []).map((c) =>
				postDisplaySameLine.source.slice(c.from, c.to),
			),
		).toEqual(["[b](/b)"]);

		const postDisplaySameLineCode = createEditorMarkdownBlockIndex(
			"[r]: /u\n    $$x$$    [b](/b)",
		);
		expect(postDisplaySameLineCode.blocks.map((b) => b.kind)).toEqual([
			"unavailable",
			"math",
			"code",
		]);
		expect(postDisplaySameLineCode.linkCandidates).toEqual([]);

		const postDisplayMathInCode = createEditorMarkdownBlockIndex(
			"[r]: /u\n    $$x$$\n    $y$",
		);
		expect(postDisplayMathInCode.blocks.map((b) => b.kind)).toEqual([
			"unavailable",
			"math",
			"code",
		]);
		expect(postDisplayMathInCode.mathSpans).toHaveLength(1);

		// Reproducer 8: nested refdef becomes `unavailable` (not editable paragraph), followed by genuine `code`.
		const nestedRefdef = createEditorMarkdownBlockIndex(
			"[r]: /u\n    [r2]: /v\n\n    real code",
		);
		expect(
			nestedRefdef.blocks.map((b) => ({ editable: b.editable, kind: b.kind })),
		).toEqual([
			{ editable: false, kind: "unavailable" },
			{ editable: false, kind: "unavailable" },
			{ editable: true, kind: "code" },
		]);
		expect(linkTexts("[r]: /u\n    [r2]: /v\n    [x][r2]")).toEqual([
			"[x][r2]",
		]);

		// Cross-line post-refdef link and paren-math hiding `# h` before 4-space link.
		expect(linkTexts("[r]: /u\n    [a\nb](/u)")).toEqual(["[a\nb](/u)"]);
		expect(linkTexts("\\(a\n# h\\)\n    [link](https://example.com)")).toEqual([
			"[link](https://example.com)",
		]);

		// Genuine indented code controls stay `code` with 0 math spans and 0 links.
		for (const genuineCode of [
			"\n\n    $x$",
			"[r]: /u\n\n    $x$",
			"[r]: /u\n\n    [x](/v)",
		]) {
			const idx = createEditorMarkdownBlockIndex(genuineCode);
			expect(
				idx.blocks.some((b) => "code" === b.kind),
				genuineCode,
			).toBe(true);
			expect(idx.mathSpans, genuineCode).toEqual([]);
			expect(idx.linkCandidates, genuineCode).toEqual([]);
		}
	});

	it("allows quote/list lines inside multiline paren math in PHP tables and keeps table reconciliation strictly O(N) at n=8,000 (Round 38 Track B Finding 3)", () => {
		for (const source of [
			"| A | B |\n| --- | --- |\n| \\(x\n> quote\n<div>\ny\\) | [link](https://example.com) |",
			"| A | B |\n| --- | --- |\n| \\(x\n- list\n<div>\ny\\) | [link](https://example.com) |",
			"| A | B |\n| --- | --- |\n| \\(x\n> quote\n- list\n<div>\ny\\) | [link](https://example.com) |",
			"| A | B |\n| --- | --- |\n| \\(x\n1. item\n<div>\ny\\) | [link](https://example.com) |",
		]) {
			const idx = createEditorMarkdownBlockIndex(source);
			expect(idx.blocks, source).toEqual([
				expect.objectContaining({ editable: true, kind: "table" }),
			]);
			expect(
				(idx.linkCandidates ?? []).map((c) => source.slice(c.from, c.to)),
				source,
			).toEqual(["[link](https://example.com)"]);
			expect(idx.linkTableCells?.size, source).toBe(1);
		}

		// O(N) regression guard across both accepted (`> quote` tail, `$$z$$` tail) and rejected (`unavailable`-start) 8,000-row tables.
		const rows8k = "| \\(x\n<!-- c -->\ny\\) | 2 |\n".repeat(8_000);
		for (const [label, payload, expectedBlocks] of [
			[
				"accepted 8k + > quote tail",
				`| A | B |\n| --- | --- |\n${rows8k}| \\(x\n> quote\ny\\) | 1 |\n`,
				1,
			],
			[
				"accepted 8k + $$z$$ tail",
				`| A | B |\n| --- | --- |\n${rows8k}| \\(x\n$$z$$\ny\\) | 1 |\n`,
				1,
			],
			[
				"rejected 8k refdef-start table",
				`[a | b]: /x "\n| - | - |\n| c | d"\n${rows8k}`,
				16_002,
			],
		] as const) {
			const started = performance.now();
			const idx = createEditorMarkdownBlockIndex(payload);
			const elapsedMs = performance.now() - started;
			expect(idx.blocks.length, label).toBe(expectedBlocks);
			expect(elapsedMs, label).toBeLessThanOrEqual(1_500);
		}
	}, 60_000);
});

function createEditorMarkdownBlockIndex(source: string, options: Parameters<typeof createProfiledMarkdownBlockIndex>[1] = { referenceLabelCaseFoldProfile: 14 }) {
  return createProfiledMarkdownBlockIndex(source, options);
}
