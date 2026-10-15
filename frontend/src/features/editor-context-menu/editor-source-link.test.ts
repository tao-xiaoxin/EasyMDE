import { describe, expect, it } from "vitest";

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
});
