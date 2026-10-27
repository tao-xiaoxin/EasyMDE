import { describe, expect, it, vi } from "vitest";

import { markdownLanguage } from "@codemirror/lang-markdown";

import { createEditorMarkdownBlockIndex } from "./editor-markdown-block-index";
import {
	type EditorSourceLinkCandidate,
	type EditorSourceLinkResolution,
	findEditorSourceLink,
} from "./editor-source-link";

function selection(
	start: number,
	end = start,
): Readonly<{ start: number; end: number }> {
	return { end, start };
}

function candidateOf(
	result: EditorSourceLinkResolution,
): EditorSourceLinkCandidate {
	if ("candidate" !== result.status) {
		throw new Error(`expected candidate, received ${result.status}`);
	}
	return result.candidate;
}

describe("findEditorSourceLink", () => {
	it("finds an inline link when only part of its caption is selected", () => {
		const source = "Before [caption](https://example.test/inline) after";
		const captionStart = source.indexOf("caption");
		const result = findEditorSourceLink({
			blockIndex: createEditorMarkdownBlockIndex(source),
			selection: selection(captionStart + 1, captionStart + 4),
			source,
		});

		expect(candidateOf(result)).toMatchObject({
			kind: "link",
			source: "[caption](https://example.test/inline)",
		});
	});

	it("finds an inline link for a caret inside its caption", () => {
		const source = "[caption](https://example.test/caret)";
		const result = findEditorSourceLink({
			blockIndex: createEditorMarkdownBlockIndex(source),
			selection: selection(source.indexOf("caption") + 2),
			source,
		});

		expect(candidateOf(result).kind).toBe("link");
	});

	it.each(["<https://example.test/autolink>", "<person@example.test>"])(
		"finds an %s autolink without inferring its URL",
		(source) => {
			const result = findEditorSourceLink({
				blockIndex: createEditorMarkdownBlockIndex(source),
				selection: selection(source.indexOf("example") + 2),
				source,
			});

			expect(candidateOf(result)).toMatchObject({
				kind: "autolink",
				source,
			});
		},
	);

	it.each([
		"https://example.test/bare",
		"person@example.test",
		"mailto:person@example.test",
	])("finds a bare GFM URL node for %s", (source) => {
		const offset = source.indexOf("example") + 2;
		const result = findEditorSourceLink({
			blockIndex: createEditorMarkdownBlockIndex(source),
			selection: selection(offset),
			source,
		});

		expect(candidateOf(result)).toMatchObject({
			kind: "link",
			reference: false,
			source,
		});
	});

	it("finds a reference use-site with a Unicode label", () => {
		const source = "[标题][引用]\n\n[引用]: https://example.test/reference";
		const result = findEditorSourceLink({
			blockIndex: createEditorMarkdownBlockIndex(source),
			selection: selection(
				source.indexOf("标题") + 1,
				source.indexOf("标题") + 2,
			),
			source,
		});

		expect(candidateOf(result)).toMatchObject({
			kind: "link",
			source: "[标题][引用]",
		});
	});

	it.each([
		"![image](https://image.test)",
		"`[caption](https://example.test)`",
		"$$ [caption](https://example.test) $$",
		"$[caption](https://example.test)$",
		"[^1]",
	])("rejects %s as a source link", (source) => {
		const index = createEditorMarkdownBlockIndex(source);
		const result = findEditorSourceLink({
			blockIndex: index,
			selection: selection(Math.max(1, source.indexOf("caption"))),
			source,
		});

		expect(result.status).toBe("none");
	});

	it("rejects a URL node inside an image or a reference definition", () => {
		const image = "![image](https://image.test)";
		expect(
			findEditorSourceLink({
				blockIndex: createEditorMarkdownBlockIndex(image),
				selection: selection(image.indexOf("image.test") + 2),
				source: image,
			}),
		).toEqual({ status: "none" });

		const definition = "[id]: https://defined.test";
		expect(
			findEditorSourceLink({
				blockIndex: createEditorMarkdownBlockIndex(definition),
				selection: selection(definition.indexOf("defined") + 2),
				source: definition,
			}),
		).toEqual({ status: "none" });
	});

	it("rejects a selection that crosses two link nodes", () => {
		const source = "[one](https://one.test) and [two](https://two.test)";
		const result = findEditorSourceLink({
			blockIndex: createEditorMarkdownBlockIndex(source),
			selection: selection(source.indexOf("one"), source.indexOf("two") + 3),
			source,
		});

		expect(result.status).toBe("none");
	});

	it("treats an incomplete parser node as plain text rather than a menu failure", () => {
		const source = "[caption](https://example.test";
		const result = findEditorSourceLink({
			blockIndex: createEditorMarkdownBlockIndex(source),
			selection: selection(source.indexOf("caption") + 1),
			source,
		});

		expect(result).toEqual({ status: "none" });
	});

	it("distinguishes the ordinary no-anchor path from an unavailable index", () => {
		const source = "plain text";
		expect(
			findEditorSourceLink({
				blockIndex: createEditorMarkdownBlockIndex(source),
				selection: selection(2),
				source,
			}),
		).toEqual({ status: "none" });
		expect(
			findEditorSourceLink({
				selection: selection(2),
				source,
			}),
		).toEqual({
			code: "editor-source-link-block-index-unavailable",
			status: "unavailable",
		});
	});

	it("rejects a stale block index instead of guessing the containing block", () => {
		const source = "[caption](https://example.test)";
		const result = findEditorSourceLink({
			blockIndex: createEditorMarkdownBlockIndex("different"),
			selection: selection(source.indexOf("caption") + 1),
			source,
		});

		expect(result).toEqual({
			code: "editor-source-link-block-index-stale",
			status: "unavailable",
		});
	});

	it.each([
		[10_000, 380_000],
		[25_000, 950_000],
	])(
		"answers a %s-link %s-byte paragraph from the prepared index without parsing",
		(linkCount, expectedBytes) => {
			const source = "ordinary [link](https://example.test) ".repeat(linkCount);
			expect(source.length).toBe(expectedBytes);
			const blockIndex = createEditorMarkdownBlockIndex(source);
			const parse = vi.spyOn(markdownLanguage.parser, "parse");
			const started = performance.now();
			const results = [1, 2, 3, 4, 5].map((position) =>
				findEditorSourceLink({
					blockIndex,
					selection: selection(position),
					source,
				}),
			);
			const elapsed = performance.now() - started;
			const parsedInputs = parse.mock.calls.map(([input]) => input);
			parse.mockRestore();

			expect(results).toEqual([
				{ status: "none" },
				{ status: "none" },
				{ status: "none" },
				{ status: "none" },
				{ status: "none" },
			]);
			expect(parsedInputs).toEqual([]);
			expect(elapsed).toBeLessThan(250);
		},
	);

	it("answers the cold query for a long paragraph from the prepared index", () => {
		const snippet = '[caption](https://example.test "a)b")';
		const source = `${"ordinary ".repeat(100_000)}${snippet}`;
		expect(source.length).toBeGreaterThan(900_000);
		const blockIndex = createEditorMarkdownBlockIndex(source);
		const parse = vi.spyOn(markdownLanguage.parser, "parse");
		const caret = source.indexOf("example") + 2;
		const started = performance.now();
		const result = findEditorSourceLink({
			blockIndex,
			selection: selection(caret),
			source,
		});
		const elapsed = performance.now() - started;
		const parsedInputs = parse.mock.calls.map(([input]) => input);
		parse.mockRestore();

		expect(parsedInputs).toEqual([]);
		expect(candidateOf(result).source).toBe(snippet);
		expect(elapsed).toBeLessThan(250);
	});

	it("keeps rendered outer link ownership for nested syntax and the following link", () => {
		const source =
			"[<https://inner.test>](https://outer.test) [tail](https://tail.test)";
		const blockIndex = createEditorMarkdownBlockIndex(source);
		const outer = "[<https://inner.test>](https://outer.test)";
		const tail = "[tail](https://tail.test)";

		for (const [caret, expected] of [
			[source.indexOf("inner") + 2, outer],
			[source.indexOf("outer") + 2, outer],
			[source.indexOf("tail") + 1, tail],
			[source.indexOf("tail.test") + 2, tail],
		] as const) {
			expect(
				candidateOf(
					findEditorSourceLink({
						blockIndex,
						selection: selection(caret),
						source,
					}),
				).source,
			).toBe(expected);
		}
	});

	it.each([
		"[<https://inner.test>][missing]",
		"[<https://inner.test>]",
		"[<https://inner.test>][]",
	] as const)(
		"keeps only the rendered inner autolink for the undefined reference %s",
		(snippet) => {
			const source = `${"ordinary ".repeat(4_000)}${snippet}`;
			const blockIndex = createEditorMarkdownBlockIndex(source);

			expect(
				candidateOf(
					findEditorSourceLink({
						blockIndex,
						selection: selection(source.indexOf("inner") + 2),
						source,
					}),
				),
			).toMatchObject({
				kind: "autolink",
				source: "<https://inner.test>",
			});
			expect(
				findEditorSourceLink({
					blockIndex,
					selection: selection(source.length - 1),
					source,
				}),
			).toEqual({ status: "none" });
		},
	);

	it("prefers the resolved outer reference over its inner autolink", () => {
		const snippet = "[<https://inner.test>][ref]\n\n[ref]: https://outer.test";
		const source = `${"ordinary ".repeat(4_000)}${snippet}`;
		const blockIndex = createEditorMarkdownBlockIndex(source);

		expect(
			candidateOf(
				findEditorSourceLink({
					blockIndex,
					selection: selection(source.indexOf("inner") + 2),
					source,
				}),
			),
		).toMatchObject({
			kind: "link",
			reference: true,
			source: "[<https://inner.test>][ref]",
		});
	});

	it("keeps the innermost created link for nested inline syntax", () => {
		const source = "[foo [bar](/url)](/url2)";
		const blockIndex = createEditorMarkdownBlockIndex(source);

		expect(
			candidateOf(
				findEditorSourceLink({
					blockIndex,
					selection: selection(source.indexOf("bar") + 1),
					source,
				}),
			).source,
		).toBe("[bar](/url)");
		expect(
			findEditorSourceLink({
				blockIndex,
				selection: selection(2),
				source,
			}),
		).toEqual({ status: "none" });
	});

	it("keeps alternating block selections on their own prepared candidates", () => {
		const source =
			"[first](https://first.test)\n\nplain\n\n[second](https://second.test)";
		const blockIndex = createEditorMarkdownBlockIndex(source);
		const firstCaret = source.indexOf("first") + 1;
		const secondCaret = source.indexOf("second") + 1;
		for (const [caret, expected] of [
			[firstCaret, "[first](https://first.test)"],
			[secondCaret, "[second](https://second.test)"],
			[firstCaret, "[first](https://first.test)"],
		] as const) {
			expect(
				candidateOf(
					findEditorSourceLink({
						blockIndex,
						selection: selection(caret),
						source,
					}),
				).source,
			).toBe(expected);
		}
	});

	it("fails a stale prepared index instead of reusing another source's candidates", () => {
		const first = "[one](https://one.test)";
		const second = "[two](https://two.test)";
		const secondIndex = createEditorMarkdownBlockIndex(second);

		expect(
			findEditorSourceLink({
				blockIndex: secondIndex,
				selection: selection(2),
				source: first,
			}),
		).toEqual({
			code: "editor-source-link-block-index-stale",
			status: "unavailable",
		});
	});

	it("fails explicitly when the prepared index does not own link candidates", () => {
		const source = "[caption](https://example.test)";
		const blockIndex = createEditorMarkdownBlockIndex(source);
		const incomplete = {
			blocks: blockIndex.blocks,
			imageBlocks: blockIndex.imageBlocks,
			imageRanges: blockIndex.imageRanges,
			length: blockIndex.length,
			mathSpans: blockIndex.mathSpans,
			source,
		};

		expect(
			findEditorSourceLink({
				blockIndex: incomplete,
				selection: selection(source.indexOf("caption") + 1),
				source,
			}),
		).toEqual({
			code: "editor-source-link-index-incomplete",
			status: "unavailable",
		});
	});

	it("keeps a marker-free large paragraph lookup parser-free and responsive", () => {
		const source = "ordinary prose without link markers ".repeat(15_000);
		expect(source.length).toBeGreaterThan(500_000);
		const blockIndex = createEditorMarkdownBlockIndex(source);
		const parse = vi.spyOn(markdownLanguage.parser, "parse");
		const started = performance.now();
		const result = findEditorSourceLink({
			blockIndex,
			selection: selection(2),
			source,
		});
		const elapsed = performance.now() - started;
		const parsedInputs = parse.mock.calls.map(([input]) => input);
		parse.mockRestore();

		expect(result).toEqual({ status: "none" });
		expect(parsedInputs).toEqual([]);
		expect(elapsed).toBeLessThan(250);
	});

	it.each([
		["[caption](https://example.test)", "candidate"],
		["<https://example.test>", "candidate"],
		["<person@example.test>", "candidate"],
		["https://example.test/bare", "candidate"],
		["person@example.test", "candidate"],
		["person@example.test/path", "candidate"],
		["mailto:person@example.test", "candidate"],
		["[标题][引用]", "none"],
		["[标题][引用]\n\n[引用]: https://example.test", "candidate"],
		["![image](https://image.test)", "none"],
		["`[caption](https://example.test)`", "none"],
		["[caption](https://example.test", "none"],
	] as const)(
		"resolves large-block %s through the shared candidate owner",
		(snippet, expected) => {
			const source = `${"ordinary ".repeat(4_000)} ${snippet}`;
			const blockIndex = createEditorMarkdownBlockIndex(source);
			const position = source.indexOf(snippet) + 2;
			const result = findEditorSourceLink({
				blockIndex,
				selection: selection(position),
				source,
			});

			expect(result.status).toBe(expected);
		},
	);

	it.each([
		["last", (length: number) => length - 2],
		["middle", (length: number) => Math.floor(length / 2)],
	] as const)(
		"keeps a repeated-bracket %s-caret paragraph lookup bounded",
		(_label, caret) => {
			const source = "[".repeat(65_536);
			const blockIndex = createEditorMarkdownBlockIndex(source);
			const started = performance.now();
			const result = findEditorSourceLink({
				blockIndex,
				selection: selection(caret(source.length)),
				source,
			});
			const elapsed = performance.now() - started;

			expect(result).toEqual({ status: "none" });
			expect(elapsed).toBeLessThan(250);
		},
	);

	// Astra review blocker: the previous length branch scanned forward from every
	// preceding "[" (quadratic) and derived link extents with a second scanner,
	// so long and short paragraphs disagreed about legal titles and destinations.
	it.each([
		'[caption](https://example.test "a)b")',
		"[caption](https://example.test 'a)b')",
		"[caption](<https://example.test/a)b>)",
	] as const)(
		"keeps the complete link extent for %s in short and long paragraphs",
		(snippet) => {
			const longPrefix = "ordinary ".repeat(4_000);
			const carets = [
				snippet.indexOf("caption") + 1,
				snippet.indexOf("example") + 2,
				snippet.indexOf("a)b") + 1,
			];
			for (const caret of carets) {
				const short = candidateOf(
					findEditorSourceLink({
						blockIndex: createEditorMarkdownBlockIndex(snippet),
						selection: selection(caret),
						source: snippet,
					}),
				);
				const longSource = `${longPrefix}${snippet}`;
				const long = candidateOf(
					findEditorSourceLink({
						blockIndex: createEditorMarkdownBlockIndex(longSource),
						selection: selection(longPrefix.length + caret),
						source: longSource,
					}),
				);

				expect({
					kind: long.kind,
					reference: long.reference,
					source: long.source,
				}).toEqual({
					kind: short.kind,
					reference: short.reference,
					source: snippet,
				});
			}
		},
	);

	it.each([
		["\\`[caption](https://example.test)", "candidate"],
		["`[caption](https://example.test)", "candidate"],
		["`[caption](https://example.test)`", "none"],
	] as const)(
		"keeps backtick semantics identical in short and long paragraphs for %s",
		(snippet, expected) => {
			const longSource = `${"ordinary ".repeat(4_000)}${snippet}`;
			const shortResult = findEditorSourceLink({
				blockIndex: createEditorMarkdownBlockIndex(snippet),
				selection: selection(snippet.indexOf("caption") + 1),
				source: snippet,
			});
			const longResult = findEditorSourceLink({
				blockIndex: createEditorMarkdownBlockIndex(longSource),
				selection: selection(longSource.indexOf("caption") + 1),
				source: longSource,
			});

			expect(shortResult.status).toBe(expected);
			expect(longResult.status).toBe(expected);
		},
	);
});
