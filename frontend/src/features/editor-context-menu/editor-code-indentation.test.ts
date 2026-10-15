import { describe, expect, it } from "vitest";

import {
	canIndentEditorCode,
	type EditorCodeIndentationResult,
	indentEditorCode,
} from "./editor-code-indentation";

function contentOf(result: EditorCodeIndentationResult): string {
	if ("changed" !== result.status && "unchanged" !== result.status) {
		throw new Error(`expected content, received ${result.status}`);
	}
	return result.content;
}

describe("indentEditorCode", () => {
	it("fully parses a long JavaScript tail before indenting", async () => {
		const prefix = Array.from(
			{ length: 220 },
			(_, index) => `const value${index} = ${index};`,
		).join("\n");
		const source = `${prefix}\nfunction tail(value) {\nreturn value + 1;\n}\n`;

		const result = await indentEditorCode({
			content: source,
			info: "js",
			language: "javascript",
		});

		expect(["changed", "unchanged"]).toContain(result.status);
		expect(contentOf(result)).toContain("  return value + 1;");
		expect(contentOf(result)).toContain("const value219 = 219;");
	});

	it("repairs invalid Python indentation without changing its tokens", async () => {
		const source = "def run():\nif True:\nprint('ok')\n";
		const result = await indentEditorCode({
			content: source,
			language: "python",
		});

		expect(contentOf(result)).toBe("def run():\n  if True:\n    print('ok')\n");
	});

	it("does not reindent YAML block literal payload", async () => {
		const source = "key: |\n  literal one\n    literal two\nnext:\nvalue\n";
		const result = await indentEditorCode({
			content: source,
			language: "yaml",
		});

		const output = contentOf(result);
		expect(output.split("\n").slice(1, 3)).toEqual([
			"  literal one",
			"    literal two",
		]);
	});

	it("does not reindent SQL multiline string payload", async () => {
		const source = "SELECT 'one\n    payload',\ncol\nFROM table\n";
		const result = await indentEditorCode({
			content: source,
			language: "sql",
		});

		const output = contentOf(result);
		expect(output.split("\n").slice(0, 2)).toEqual([
			"SELECT 'one",
			"    payload',",
		]);
	});

	it("does not reindent SQL block comment payload", async () => {
		const source =
			"SELECT /* first\n    payload\n      last */\ncol\nFROM t;\n";
		const result = await indentEditorCode({
			content: source,
			language: "sql",
		});

		const output = contentOf(result);
		expect(output.split("\n").slice(1, 3)).toEqual([
			"    payload",
			"      last */",
		]);
	});

	it("treats the selected line range as 0-based half-open", async () => {
		const source = "if (true) {\nfoo();\nbar();\n}\n";
		const result = await indentEditorCode({
			content: source,
			language: "javascript",
			lineRange: { endLine: 2, startLine: 1 },
		});

		expect(contentOf(result).split("\n")).toEqual([
			"if (true) {",
			"  foo();",
			"bar();",
			"}",
			"",
		]);
	});

	it("preserves mixed physical line endings", async () => {
		const source = "if (true) {\r\nfoo();\rbar();\n}\r\n";
		const result = await indentEditorCode({
			content: source,
			language: "javascript",
		});

		const output = contentOf(result);
		expect(output.match(/\r\n|\r|\n/gu)).toEqual(source.match(/\r\n|\r|\n/gu));
	});

	it("preserves ASCII whitespace-only rows and mixed EOF endings", async () => {
		const source = "if (x) {\r\n \t  \rvalue();\n}\r\n";
		const result = await indentEditorCode({
			content: source,
			language: "javascript",
		});

		const output = contentOf(result);
		expect(output.split(/\r\n|\r|\n/u)).toEqual([
			"if (x) {",
			" \t  ",
			"  value();",
			"}",
			"",
		]);
		expect(output.match(/\r\n|\r|\n/gu)).toEqual(source.match(/\r\n|\r|\n/gu));
	});

	it("returns stable unavailable for unsupported language families", async () => {
		for (const language of ["bash", "diff", "stex", "mermaid", "math"]) {
			await expect(
				indentEditorCode({
					content: "echo value",
					language,
				}),
			).resolves.toEqual({
				code: "editor-code-indentation-language-unsupported",
				status: "unavailable",
			});
		}
	});

	it("exposes the same cheap alias capability used by the menu", () => {
		expect(canIndentEditorCode("js")).toBe(true);
		expect(canIndentEditorCode("python")).toBe(true);
		expect(canIndentEditorCode("", "yaml options")).toBe(true);
		expect(canIndentEditorCode("bash")).toBe(false);
		expect(canIndentEditorCode("stex")).toBe(false);
		expect(canIndentEditorCode("constructor")).toBe(false);
		expect(canIndentEditorCode("__proto__")).toBe(false);
	});

	it("rejects prototype keys as unsupported formatter languages", async () => {
		for (const language of ["constructor", "__proto__"]) {
			await expect(
				indentEditorCode({
					content: "value",
					language,
				}),
			).resolves.toEqual({
				code: "editor-code-indentation-language-unsupported",
				status: "unavailable",
			});
		}
	});

	it("reports cancellation before starting detached parsing", async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(
			indentEditorCode({
				content: "if (true) {\nvalue();\n}",
				language: "javascript",
				signal: controller.signal,
			}),
		).resolves.toEqual({
			code: "editor-code-indentation-cancelled",
			status: "unavailable",
		});
	});

	it("preserves an unchanged result without inventing a mutation", async () => {
		const source = "const value = 1;\n";
		const result = await indentEditorCode({
			content: source,
			language: "javascript",
		});

		expect(result).toEqual({ content: source, status: "unchanged" });
	});
});
