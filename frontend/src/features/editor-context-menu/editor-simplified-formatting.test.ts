import { describe, expect, it } from "vitest";

import type { SafePreviewHtml } from "../../contracts/ports/preview-request";
import {
	createSimplifiedFormattingPayload,
	type SimplifiedFormattingDomParser,
} from "./editor-simplified-formatting";

function parser(): SimplifiedFormattingDomParser {
	const native = new DOMParser();
	return {
		parseFromString: (source, mimeType) =>
			native.parseFromString(source, mimeType),
	};
}

function safeHtml(value: string): SafePreviewHtml {
	return value as SafePreviewHtml;
}

describe("createSimplifiedFormattingPayload", () => {
	it("preserves block, list, table, pre, and linebreak semantics without theme metadata", () => {
		const source = safeHtml(
			[
				'<h1 id="heading" class="easymde-markdown-theme-newsprint">Heading</h1>',
				"<p>First<br>Second</p>",
				'<ul class="theme-list"><li>One</li><li>Two</li></ul>',
				'<table class="easymde-table" style="border: 1px"><tr><th align="center">Name</th><td>Value</td></tr></table>',
				'<pre class="easymde-code-mac"><code class="hljs language-js">const value = 1;\n</code></pre>',
			].join(""),
		);
		const before = source;
		const result = createSimplifiedFormattingPayload(source, {
			parser: parser(),
		});

		expect(result.status).toBe("converted");
		if (result.status !== "converted") return;
		expect(result.payload.html).toContain("<h1>Heading</h1>");
		expect(result.payload.html).toContain('<th align="center">Name</th>');
		expect(result.payload.html).toContain(
			"<pre><code>const value = 1;\n</code></pre>",
		);
		expect(result.payload.html).not.toContain("class=");
		expect(result.payload.html).not.toContain("style=");
		expect(result.payload.html).not.toContain('id="heading"');
		expect(result.payload.text).toContain("Heading\n\nFirst\nSecond");
		expect(result.payload.text).toContain("One\nTwo");
		expect(result.payload.text).toContain("Name\tValue");
		expect(result.payload.text).toContain("const value = 1;");
		expect(source).toBe(before);
	});

	it("retains semantic link and image attributes while stripping provenance", () => {
		const result = createSimplifiedFormattingPayload(
			safeHtml(
				'<p data-easymde-visual-block-id="b1"><a id="link" href="https://example.test" title="Link" target="_blank">Visit</a> ' +
					'<img id="image" data-easymde-image-scale="50" src="https://example.test/a.png" alt="A" title="Image" align="right"></p>',
			),
			{ parser: parser() },
		);

		expect(result.status).toBe("converted");
		if (result.status !== "converted") return;
		expect(result.payload.html).toContain('href="https://example.test"');
		expect(result.payload.html).toContain('title="Link"');
		expect(result.payload.html).toContain('target="_blank"');
		expect(result.payload.html).toContain('src="https://example.test/a.png"');
		expect(result.payload.html).toContain('alt="A"');
		expect(result.payload.html).toContain('title="Image"');
		expect(result.payload.html).toContain('align="right"');
		expect(result.payload.html).not.toContain("data-easymde-");
		expect(result.payload.html).not.toContain("id=");
		expect(result.payload.text).toContain("Visit A");
	});

	it("removes current code-frame decorations without removing code text", () => {
		const result = createSimplifiedFormattingPayload(
			safeHtml(
				'<pre><span class="easymde-code-line-number-gutter" aria-hidden="true">1</span>' +
					'<code><span class="hljs-keyword">const</span> value = 1;</code></pre>' +
					'<button class="easymde-code-copy__button">Copy</button>',
			),
			{ parser: parser() },
		);

		expect(result.status).toBe("converted");
		if (result.status !== "converted") return;
		expect(result.payload.html).toContain(
			"<pre><code><span>const</span> value = 1;</code></pre>",
		);
		expect(result.payload.html).not.toContain("line-number-gutter");
		expect(result.payload.html).not.toContain("code-copy");
		expect(result.payload.text).toBe("const value = 1;");
	});

	it("preserves literal preformatted whitespace and block boundaries", () => {
		const result = createSimplifiedFormattingPayload(
			safeHtml("<pre><code>  alpha\n\n\nbeta  </code></pre>"),
			{ parser: parser() },
		);

		expect(result.status).toBe("converted");
		if (result.status !== "converted") return;
		expect(result.payload.text).toBe("  alpha\n\n\nbeta  ");
	});

	it("ignores formal-renderer layout whitespace between block elements", () => {
		const result = createSimplifiedFormattingPayload(
			safeHtml("<p>First</p>\n<p>Second</p>\n"),
			{ parser: parser() },
		);

		expect(result.status).toBe("converted");
		if (result.status !== "converted") return;
		expect(result.payload.text).toBe("First\n\nSecond");
	});

	it("does not append formal-renderer layout whitespace after a preformatted block", () => {
		const result = createSimplifiedFormattingPayload(
			safeHtml("<pre><code>  alpha\n\n\nbeta  </code></pre>\n"),
			{ parser: parser() },
		);

		expect(result.status).toBe("converted");
		if (result.status !== "converted") return;
		expect(result.payload.text).toBe("  alpha\n\n\nbeta  ");
	});

	it("uses an image source as meaningful plaintext when alt text is empty", () => {
		const result = createSimplifiedFormattingPayload(
			safeHtml('<p><img src="https://example.test/image.png" alt=""></p>'),
			{ parser: parser() },
		);

		expect(result.status).toBe("converted");
		if (result.status !== "converted") return;
		expect(result.payload.html).toContain(
			'<img src="https://example.test/image.png" alt="">',
		);
		expect(result.payload.text).toBe("https://example.test/image.png");
	});

	it("preserves readonly task checkbox semantics and a checked plaintext fallback", () => {
		const result = createSimplifiedFormattingPayload(
			safeHtml(
				'<ul><li><input type="checkbox" checked disabled>Complete</li>' +
					'<li><input type="checkbox" disabled>Todo</li></ul>',
			),
			{ parser: parser() },
		);

		expect(result.status).toBe("converted");
		if (result.status !== "converted") return;
		const output = new DOMParser().parseFromString(
			result.payload.html,
			"text/html",
		);
		const checkboxes = Array.from(
			output.querySelectorAll('input[type="checkbox"]'),
		);
		expect(checkboxes).toHaveLength(2);
		expect(checkboxes[0]?.hasAttribute("checked")).toBe(true);
		expect(checkboxes[0]?.hasAttribute("disabled")).toBe(true);
		expect(checkboxes[1]?.hasAttribute("checked")).toBe(false);
		expect(checkboxes[1]?.hasAttribute("disabled")).toBe(true);
		expect(result.payload.text).toBe("[x] Complete\n[ ] Todo");
	});

	it("converts table text-align metadata into preserved align semantics", () => {
		const result = createSimplifiedFormattingPayload(
			safeHtml(
				'<table><tr><td style="text-align: center; color: red">Centered</td><td align="right">Right</td></tr></table>',
			),
			{ parser: parser() },
		);

		expect(result.status).toBe("converted");
		if (result.status !== "converted") return;
		expect(result.payload.html).toContain('<td align="center">Centered</td>');
		expect(result.payload.html).toContain('<td align="right">Right</td>');
		expect(result.payload.html).not.toContain("style=");
		expect(result.payload.text).toContain("Centered\tRight");
	});

	it("decodes escaped text for plain fallback while preserving escaped HTML output", () => {
		const result = createSimplifiedFormattingPayload(
			safeHtml("<p>&lt;tag&gt; &amp; text</p>"),
			{
				parser: parser(),
			},
		);

		expect(result.status).toBe("converted");
		if (result.status !== "converted") return;
		expect(result.payload.html).toContain("&lt;tag&gt; &amp; text");
		expect(result.payload.text).toBe("<tag> & text");
	});

	it("fails explicitly for parser, node, input-size, and output-size bounds", () => {
		const throwingParser: SimplifiedFormattingDomParser = {
			parseFromString: () => {
				throw new Error("parse failed");
			},
		};
		expect(
			createSimplifiedFormattingPayload(safeHtml("<p>x</p>"), {
				parser: throwingParser,
			}),
		).toEqual({
			code: "editor-simplified-formatting-parse-failed",
			status: "failed",
		});
		expect(
			createSimplifiedFormattingPayload(safeHtml("<p>long</p>"), {
				maxBytes: 2,
				parser: parser(),
			}),
		).toEqual({
			code: "editor-simplified-formatting-input-too-large",
			status: "failed",
		});
		expect(
			createSimplifiedFormattingPayload(safeHtml("<p><strong>x</strong></p>"), {
				maxNodes: 2,
				parser: parser(),
			}),
		).toEqual({
			code: "editor-simplified-formatting-node-limit",
			status: "failed",
		});
		const expandingParser: SimplifiedFormattingDomParser = {
			parseFromString: () =>
				new DOMParser().parseFromString(
					`<p>${"x".repeat(32)}</p>`,
					"text/html",
				),
		};
		expect(
			createSimplifiedFormattingPayload(safeHtml("<p>x</p>"), {
				maxBytes: 10,
				parser: expandingParser,
			}),
		).toEqual({
			code: "editor-simplified-formatting-output-too-large",
			status: "failed",
		});
	});

	it("never attaches the parsed document to the live document", () => {
		const before = document.body.childElementCount;
		const result = createSimplifiedFormattingPayload(
			safeHtml("<p>Detached</p>"),
			{
				parser: parser(),
			},
		);

		expect(result.status).toBe("converted");
		expect(document.body.childElementCount).toBe(before);
	});
});
