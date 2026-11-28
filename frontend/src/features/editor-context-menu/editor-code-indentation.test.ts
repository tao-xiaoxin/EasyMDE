import type * as CodeMirrorLanguage from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	canIndentEditorCode,
	EDITOR_CODE_INDENTATION_MAX_PARSE_SLICES,
	EDITOR_CODE_INDENTATION_PARSE_TIMEOUT_MS,
	type EditorCodeIndentationResult,
	indentEditorCode,
} from "./editor-code-indentation";

type CpuSnapshot = Readonly<{
	scope: "process" | "thread";
	system: number;
	user: number;
}>;

type EnsureSyntaxTreeOverride = (
	call: number,
	state: EditorState,
	upto: number,
	timeout: number | undefined,
	actualEnsure: typeof CodeMirrorLanguage.ensureSyntaxTree,
) => Tree | null;

const indentationProbe = vi.hoisted(() => ({
	active: false,
	calls: 0,
	ensureOverride: null as EnsureSyntaxTreeOverride | null,
}));

vi.mock("@codemirror/language", async (importOriginal) => {
	const actual = await importOriginal<typeof CodeMirrorLanguage>();
	const cpuSnapshot = (): CpuSnapshot | null => {
		// Node 22 exposes threadCpuUsage at runtime; bundled types may omit it.
		const processWithThreadCpu = process as unknown as {
			threadCpuUsage?: () => { system: number; user: number };
		};
		const threadCpuUsage = processWithThreadCpu.threadCpuUsage;
		if ("function" === typeof threadCpuUsage) {
			try {
				const usage = threadCpuUsage.call(process);
				return {
					scope: "thread",
					system: usage.system / 1000,
					user: usage.user / 1000,
				};
			} catch {
				// Fall through to the process-wide counter.
			}
		}
		try {
			const usage = process.cpuUsage();
			return {
				scope: "process",
				system: usage.system / 1000,
				user: usage.user / 1000,
			};
		} catch {
			return null;
		}
	};
	const cpuDelta = (
		before: CpuSnapshot | null,
		after: CpuSnapshot | null,
	): Readonly<{ system: number; user: number }> | null =>
		before && after
			? {
					system: after.system - before.system,
					user: after.user - before.user,
				}
			: null;
	return {
		...actual,
		ensureSyntaxTree: ((
			state: EditorState,
			upto: number,
			timeout: number | undefined,
		) => {
			const started = performance.now();
			const cpuBefore = cpuSnapshot();
			let result: Tree | null = null;
			let errorName: string | null = null;
			const callIndex = indentationProbe.calls + 1;
			const override = indentationProbe.ensureOverride;
			try {
				result = override
					? override(
							callIndex,
							state,
							upto,
							timeout,
							actual.ensureSyntaxTree,
						)
					: actual.ensureSyntaxTree(state, upto, timeout);
				return result;
			} catch (error) {
				errorName = error instanceof Error ? error.name : typeof error;
				throw error;
			} finally {
				if (indentationProbe.active || override) {
					indentationProbe.calls = callIndex;
				}
				if (indentationProbe.active) {
					const cpuAfter = cpuSnapshot();
					let initialTreeLength: number | null = null;
					let initialHasLanguage: boolean | null = null;
					try {
						initialTreeLength = actual.syntaxTree(state).length;
						// `language` is the public facet for the current document language.
						initialHasLanguage = state.facet(actual.language) !== null;
					} catch {
						// The public facet/tree is unavailable; report unobservable, not false.
						initialTreeLength = null;
						initialHasLanguage = null;
					}
					try {
						process.stdout.write(
							`editor-code-indentation-ensure-syntax-tree-receipt ${JSON.stringify(
								{
									call: indentationProbe.calls,
									docLength: state.doc.length,
									errorName,
									hasLanguage: initialHasLanguage,
									initialTreeLength,
									returnHasLanguage: result !== null,
									returnTreeLength: result?.length ?? null,
									returned: result !== null,
									timeout: timeout ?? null,
									upto,
									wallMs: performance.now() - started,
									workerProcessCPU: {
										after: cpuAfter,
										before: cpuBefore,
										delta: cpuDelta(cpuBefore, cpuAfter),
									},
								},
							)}\n`,
						);
					} catch {
						// Observation must not replace the original result.
					}
				}
			}
		}) as typeof actual.ensureSyntaxTree,
	};
});

function contentOf(result: EditorCodeIndentationResult): string {
	if ("changed" !== result.status && "unchanged" !== result.status) {
		throw new Error(`expected content, received ${result.status}`);
	}
	return result.content;
}

function longJavaScriptTailSource(): string {
	const prefix = Array.from(
		{ length: 220 },
		(_, index) => `const value${index} = ${index};`,
	).join("\n");
	return `${prefix}\nfunction tail(value) {\nreturn value + 1;\n}\n`;
}

async function withEnsureSyntaxTreeOverride<T>(
	override: EnsureSyntaxTreeOverride,
	run: () => Promise<T>,
): Promise<T> {
	indentationProbe.calls = 0;
	indentationProbe.ensureOverride = override;
	try {
		return await run();
	} finally {
		indentationProbe.ensureOverride = null;
		indentationProbe.calls = 0;
	}
}

describe("indentEditorCode", () => {
	afterEach(() => {
		indentationProbe.active = false;
		indentationProbe.calls = 0;
		indentationProbe.ensureOverride = null;
	});

	it("fully parses a long JavaScript tail before indenting", async () => {
		const source = longJavaScriptTailSource();

		const result = await (async () => {
			indentationProbe.active = true;
			indentationProbe.calls = 0;
			try {
				return await indentEditorCode({
					content: source,
					info: "js",
					language: "javascript",
				});
			} finally {
				indentationProbe.active = false;
			}
		})();
		try {
			process.stdout.write(
				`editor-code-indentation-result-receipt ${JSON.stringify({
					code: "code" in result ? result.code : null,
					ensureCalls: indentationProbe.calls,
					status: result.status,
				})}\n`,
			);
		} catch {
			// Observation must not replace the original result.
		}

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

	it("resumes incremental syntax parsing across bounded slices after a single-slice timeout", async () => {
		const source = longJavaScriptTailSource();
		const seenStates: EditorState[] = [];
		const seenTimeouts: Array<number | undefined> = [];
		let firstSliceResult: Tree | null | undefined;

		const result = await withEnsureSyntaxTreeOverride(
			(call, state, upto, timeout, actualEnsure) => {
				seenStates.push(state);
				seenTimeouts.push(timeout);
				if (1 === call) {
					// A -1ms budget lets ParseContext.work() execute one real advance()
					// step and naturally return null with an active mid-document parse.
					firstSliceResult = actualEnsure(state, upto, -1);
					return firstSliceResult;
				}
				return actualEnsure(state, upto, timeout);
			},
			() =>
				indentEditorCode({
					content: source,
					info: "js",
					language: "javascript",
				}),
		);

		expect(firstSliceResult).toBeNull();
		expect(seenStates.length).toBeGreaterThanOrEqual(2);
		expect(seenStates[1]).toBe(seenStates[0]);
		expect(seenTimeouts).toEqual(
			Array.from(
				{ length: seenStates.length },
				() => EDITOR_CODE_INDENTATION_PARSE_TIMEOUT_MS,
			),
		);
		expect(["changed", "unchanged"]).toContain(result.status);
		expect(contentOf(result)).toContain("  return value + 1;");
		expect(contentOf(result)).toContain("const value219 = 219;");
	});

	it("aborts between parse slices when cancellation arrives asynchronously after an incomplete slice", async () => {
		const controller = new AbortController();
		let callsObserved = 0;

		const result = await withEnsureSyntaxTreeOverride(
			(call, state, upto, _timeout, actualEnsure) => {
				callsObserved = call;
				if (1 === call) {
					setTimeout(() => {
						controller.abort();
					}, 0);
					return actualEnsure(state, upto, -1);
				}
				return null;
			},
			() =>
				indentEditorCode({
					content: longJavaScriptTailSource(),
					info: "js",
					language: "javascript",
					signal: controller.signal,
				}),
		);

		expect(result).toEqual({
			code: "editor-code-indentation-cancelled",
			status: "unavailable",
		});
		expect(callsObserved).toBe(1);
	});

	it("returns parse-timeout after exhausting bounded incremental parse slices", async () => {
		let callsObserved = 0;

		const result = await withEnsureSyntaxTreeOverride(
			(call) => {
				callsObserved = call;
				return null;
			},
			() =>
				indentEditorCode({
					content: longJavaScriptTailSource(),
					info: "js",
					language: "javascript",
				}),
		);

		expect(result).toEqual({
			code: "editor-code-indentation-parse-timeout",
			status: "unavailable",
		});
		expect(callsObserved).toBe(EDITOR_CODE_INDENTATION_MAX_PARSE_SLICES);
	});

	it("preserves an unchanged result without inventing a mutation", async () => {
		const source = "const value = 1;\n";
		const result = await indentEditorCode({
			content: source,
			language: "javascript",
		});

		expect(result).toEqual({ content: source, status: "unchanged" });
	});

	it("lazy-loads and indents CSS, HTML, and TypeScript/JSX/TSX fences", async () => {
		const cssResult = await indentEditorCode({
			content: ".card {\ncolor: red;\n}\n",
			language: "css",
		});
		expect(contentOf(cssResult)).toBe(".card {\n  color: red;\n}\n");

		const htmlResult = await indentEditorCode({
			content: "<div>\n<p>Hello</p>\n</div>\n",
			language: "html",
		});
		expect(contentOf(htmlResult)).toBe("<div>\n  <p>Hello</p>\n</div>\n");

		const tsResult = await indentEditorCode({
			content: "interface Item {\nid: number;\n}\n",
			language: "ts",
		});
		expect(contentOf(tsResult)).toBe("interface Item {\n  id: number;\n}\n");

		const jsxResult = await indentEditorCode({
			content: "function App() {\nreturn <div />;\n}\n",
			language: "jsx",
		});
		expect(contentOf(jsxResult)).toBe(
			"function App() {\n  return <div />;\n}\n",
		);

		const tsxResult = await indentEditorCode({
			content: "function App(props: { ok: boolean }) {\nreturn <div />;\n}\n",
			language: "tsx",
		});
		expect(contentOf(tsxResult)).toBe(
			"function App(props: { ok: boolean }) {\n  return <div />;\n}\n",
		);

		// Repeated call hits the cached lazy language support.
		const cachedCssResult = await indentEditorCode({
			content: "a {\ncolor: blue;\n}\n",
			language: "css",
		});
		expect(contentOf(cachedCssResult)).toBe("a {\n  color: blue;\n}\n");
	});
});
