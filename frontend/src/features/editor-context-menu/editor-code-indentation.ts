import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import {
	ensureSyntaxTree,
	indentRange,
	indentUnit,
	type LanguageSupport,
	syntaxTree,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";

export const MAX_EDITOR_CODE_INDENTATION_BYTES = 1_048_576;
export const EDITOR_CODE_INDENTATION_PARSE_TIMEOUT_MS = 50;

export type EditorCodeIndentationLineRange = Readonly<{
	endLine: number;
	startLine: number;
}>;

export type EditorCodeIndentationInput = Readonly<{
	content: string;
	info?: string;
	language: string;
	lineRange?: EditorCodeIndentationLineRange;
	signal?: AbortSignal;
}>;

export type EditorCodeIndentationUnavailableCode =
	| "editor-code-indentation-cancelled"
	| "editor-code-indentation-input-invalid"
	| "editor-code-indentation-language-unsupported"
	| "editor-code-indentation-parse-failed"
	| "editor-code-indentation-parse-timeout"
	| "editor-code-indentation-query-too-large"
	| "editor-code-indentation-range-invalid"
	| "editor-code-indentation-structure-changed";

export type EditorCodeIndentationResult =
	| Readonly<{ content: string; status: "changed" }>
	| Readonly<{ content: string; status: "unchanged" }>
	| Readonly<{
			code: EditorCodeIndentationUnavailableCode;
			status: "unavailable";
	  }>;

type SupportedLanguage =
	| "css"
	| "html"
	| "javascript"
	| "json"
	| "python"
	| "sql"
	| "yaml";

type LanguageAlias = Readonly<{
	family: SupportedLanguage;
	variant?: "default" | "jsx" | "tsx" | "typescript";
}>;

type ResolvedLanguage = Readonly<{ support: LanguageSupport }>;

type PhysicalLines = Readonly<{
	endings: ReadonlyArray<string>;
	lines: ReadonlyArray<string>;
}>;

const MULTILINE_PAYLOAD_NODES = new Set([
	"BlockLiteralContent",
	"BlockComment",
	"Comment",
	"String",
	"TemplateString",
]);

const LANGUAGE_ALIASES: Readonly<Record<string, LanguageAlias>> = {
	css: { family: "css" },
	html: { family: "html" },
	js: { family: "javascript" },
	javascript: { family: "javascript" },
	json: { family: "json" },
	cjs: { family: "javascript" },
	mjs: { family: "javascript" },
	py: { family: "python" },
	python: { family: "python" },
	sql: { family: "sql" },
	ts: { family: "javascript", variant: "typescript" },
	tsx: { family: "javascript", variant: "tsx" },
	typescript: { family: "javascript", variant: "typescript" },
	xhtml: { family: "html" },
	xml: { family: "html" },
	yaml: { family: "yaml" },
	yml: { family: "yaml" },
	jsx: { family: "javascript", variant: "jsx" },
};

function unavailable(
	code: EditorCodeIndentationUnavailableCode,
): EditorCodeIndentationResult {
	return { code, status: "unavailable" };
}

function utf8ByteLength(value: string): number {
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const codePoint = value.codePointAt(index) ?? 0;
		if (codePoint > 0xffff) index += 1;
		bytes +=
			codePoint <= 0x7f
				? 1
				: codePoint <= 0x7ff
					? 2
					: codePoint <= 0xffff
						? 3
						: 4;
	}
	return bytes;
}

function firstInfoToken(info: string | undefined): string {
	if ("string" !== typeof info) return "";
	return info.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
}

function languageToken(language: string, info: string | undefined): string {
	const explicit =
		"string" === typeof language ? language.trim().toLowerCase() : "";
	return explicit || firstInfoToken(info);
}

function languageAlias(token: string): LanguageAlias | null {
	// biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is outside the supported browser baseline.
	return Object.prototype.hasOwnProperty.call(LANGUAGE_ALIASES, token)
		? (LANGUAGE_ALIASES[token] ?? null)
		: null;
}

function resolveLanguage(
	language: string,
	info: string | undefined,
): ResolvedLanguage | null {
	const token = languageToken(language, info);
	const alias = languageAlias(token);
	if (!alias) return null;
	switch (alias.family) {
		case "css":
			return { support: css() };
		case "html":
			return { support: html() };
		case "javascript":
			switch (alias.variant) {
				case "jsx":
					return { support: javascript({ jsx: true }) };
				case "typescript":
					return { support: javascript({ typescript: true }) };
				case "tsx":
					return {
						support: javascript({ jsx: true, typescript: true }),
					};
				default:
					return { support: javascript() };
			}
		case "json":
			return { support: json() };
		case "python":
			return { support: python() };
		case "sql":
			return { support: sql() };
		case "yaml":
			return { support: yaml() };
	}
}

export function canIndentEditorCode(language: string, info?: string): boolean {
	return null !== languageAlias(languageToken(language, info));
}

function splitPhysicalLines(value: string): PhysicalLines {
	const lines: string[] = [];
	const endings: string[] = [];
	let start = 0;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if ("\r" !== character && "\n" !== character) continue;
		const ending =
			"\r" === character && "\n" === value[index + 1] ? "\r\n" : character;
		lines.push(value.slice(start, index));
		endings.push(ending);
		index += "\r\n" === ending ? 1 : 0;
		start = index + 1;
	}
	lines.push(value.slice(start));
	return { endings, lines };
}

function lineStarts(lines: ReadonlyArray<string>): ReadonlyArray<number> {
	const starts = [0];
	for (let index = 0; index < lines.length - 1; index += 1) {
		starts.push((starts[index] ?? 0) + (lines[index]?.length ?? 0) + 1);
	}
	return starts;
}

function selectedRange(
	lineRange: EditorCodeIndentationLineRange | undefined,
	lineCount: number,
): Readonly<{ endLine: number; startLine: number }> | null {
	const range = lineRange ?? { endLine: lineCount, startLine: 0 };
	if (
		!Number.isSafeInteger(range.startLine) ||
		!Number.isSafeInteger(range.endLine) ||
		range.startLine < 0 ||
		range.endLine <= range.startLine ||
		range.endLine > lineCount
	) {
		return null;
	}
	return range;
}

function protectedPayloadLines(
	state: EditorState,
	blankLines: ReadonlySet<number>,
): ReadonlySet<number> {
	const protectedLines = new Set(blankLines);
	const tree = syntaxTree(state);
	tree.iterate({
		enter(node) {
			if (!MULTILINE_PAYLOAD_NODES.has(node.name)) return;
			const text = state.doc.sliceString(node.from, node.to);
			const multiline = text.includes("\n");
			if (!multiline && "BlockLiteralContent" !== node.name) return;
			const firstLine = state.doc.lineAt(node.from).number - 1;
			const lastLine =
				state.doc.lineAt(Math.max(node.from, node.to - 1)).number - 1;
			const startLine =
				"BlockLiteralContent" === node.name ? firstLine : firstLine + 1;
			for (let line = startLine; line <= lastLine; line += 1) {
				protectedLines.add(line);
			}
		},
	});
	return protectedLines;
}

function restorePhysicalLineEndings(
	lines: ReadonlyArray<string>,
	endings: ReadonlyArray<string>,
): string {
	return lines.map((line, index) => `${line}${endings[index] ?? ""}`).join("");
}

function onlyLeadingWhitespaceChanged(before: string, after: string): boolean {
	return before.replace(/^[ \t]*/u, "") === after.replace(/^[ \t]*/u, "");
}

async function yieldForCancellation(
	signal: AbortSignal | undefined,
): Promise<boolean> {
	if (signal?.aborted) return false;
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	return !signal?.aborted;
}

export async function indentEditorCode({
	content,
	info,
	language,
	lineRange,
	signal,
}: EditorCodeIndentationInput): Promise<EditorCodeIndentationResult> {
	if ("string" !== typeof content || "string" !== typeof language) {
		return unavailable("editor-code-indentation-input-invalid");
	}
	if (!(await yieldForCancellation(signal))) {
		return unavailable("editor-code-indentation-cancelled");
	}
	if (utf8ByteLength(content) > MAX_EDITOR_CODE_INDENTATION_BYTES) {
		return unavailable("editor-code-indentation-query-too-large");
	}
	const resolved = resolveLanguage(language, info);
	if (!resolved) {
		return unavailable("editor-code-indentation-language-unsupported");
	}
	const physical = splitPhysicalLines(content);
	const blankLines = new Set(
		physical.lines.flatMap((line, index) =>
			/^[ \t]*$/u.test(line) ? [index] : [],
		),
	);
	const range = selectedRange(lineRange, physical.lines.length);
	if (!range) return unavailable("editor-code-indentation-range-invalid");
	const normalized = physical.lines.join("\n");
	const starts = lineStarts(physical.lines);
	const from = starts[range.startLine] ?? 0;
	const to =
		range.endLine >= physical.lines.length
			? normalized.length
			: Math.max(from, (starts[range.endLine] ?? from) - 1);
	let state: EditorState;
	try {
		state = EditorState.create({
			doc: normalized,
			extensions: [resolved.support, indentUnit.of("  ")],
		});
		const ensured = ensureSyntaxTree(
			state,
			state.doc.length,
			EDITOR_CODE_INDENTATION_PARSE_TIMEOUT_MS,
		);
		if (!ensured || ensured.length < state.doc.length) {
			return unavailable("editor-code-indentation-parse-timeout");
		}
		// ensureSyntaxTree returns a tree without updating state.syntaxTree. Rebuild
		// the same detached state before asking indentRange for its tree context.
		state = state.update({}).state;
		if (syntaxTree(state).length < state.doc.length) {
			return unavailable("editor-code-indentation-parse-timeout");
		}
		if (!(await yieldForCancellation(signal))) {
			return unavailable("editor-code-indentation-cancelled");
		}
		const protectedLines = protectedPayloadLines(state, blankLines);
		const changes = indentRange(state, from, to);
		const filteredChanges: Array<{
			from: number;
			insert: string;
			to: number;
		}> = [];
		changes.iterChanges((_from, _to, _fromB, _toB, inserted) => {
			const line = state.doc.lineAt(_from).number - 1;
			if (protectedLines.has(line)) return;
			filteredChanges.push({
				from: _from,
				insert: inserted.toString(),
				to: _to,
			});
		});
		const outputState = filteredChanges.length
			? state.update({ changes: filteredChanges }).state
			: state;
		const outputLines = outputState.doc.toString().split("\n");
		if (outputLines.length !== physical.lines.length) {
			return unavailable("editor-code-indentation-structure-changed");
		}
		for (let index = 0; index < outputLines.length; index += 1) {
			const before = physical.lines[index] ?? "";
			const after = outputLines[index] ?? "";
			const selected = index >= range.startLine && index < range.endLine;
			if ((!selected || protectedLines.has(index)) && after !== before) {
				return unavailable("editor-code-indentation-structure-changed");
			}
			if (selected && !onlyLeadingWhitespaceChanged(before, after)) {
				return unavailable("editor-code-indentation-structure-changed");
			}
		}
		const output = restorePhysicalLineEndings(outputLines, physical.endings);
		return output === content
			? { content, status: "unchanged" }
			: { content: output, status: "changed" };
	} catch {
		return unavailable("editor-code-indentation-parse-failed");
	}
}
