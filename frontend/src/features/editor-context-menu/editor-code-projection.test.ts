import { describe, expect, it } from "vitest";

import type {
	PreviewCodeBodyMap,
	PreviewCodeProjection,
	PreviewCodeProjectionRow,
} from "../../contracts/ports/preview-request";
import {
	type EditorCodeProjectionEncodeInput,
	encodeEditorCodeProjection,
} from "./editor-code-projection";

const signature = "projection-signature";

const codeMap = (
	content: string,
	startLine: number,
	endLine: number,
	kind: "fenced" | "indented" = "fenced",
	mapSignature = signature,
): PreviewCodeBodyMap => ({
	coordinate: "line",
	entries: [
		{
			content,
			endLine,
			kind,
			startLine,
			status: "available",
		},
	],
	signature: mapSignature,
	status: "available",
	version: 1,
});

const fencedProjection = (
	rows: ReadonlyArray<PreviewCodeProjectionRow>,
	startLine: number,
	endLine: number,
	fenceOffset = 0,
	projectionSignature = signature,
): PreviewCodeProjection => ({
	coordinate: "line",
	entries: [
		{
			endLine,
			fenceOffset,
			info: "",
			kind: "fenced",
			rows,
			startLine,
			status: "available",
		},
	],
	offsetUnit: "utf16",
	signature: projectionSignature,
	status: "available",
	version: 1,
});

const indentedProjection = (
	rows: ReadonlyArray<PreviewCodeProjectionRow>,
	startLine: number,
	endLine: number,
): PreviewCodeProjection => ({
	coordinate: "line",
	entries: [
		{
			endLine,
			kind: "indented",
			rows,
			startLine,
			status: "available",
		},
	],
	offsetUnit: "utf16",
	signature,
	status: "available",
	version: 1,
});

const row = (
	values: Partial<{
		contentLine: number;
		literalFrom: number;
		literalLeadingSpaces: number;
		prefixEnd: number;
		prefixTabColumns: number;
		sourceLine: number;
	}> = {},
) => ({
	contentLine: 0,
	literalFrom: 0,
	literalLeadingSpaces: 0,
	prefixEnd: 0,
	prefixTabColumns: 0,
	sourceLine: 1,
	...values,
});

const input = (
	values: Partial<EditorCodeProjectionEncodeInput> = {},
): EditorCodeProjectionEncodeInput => ({
	codeMap: codeMap("one\n", 0, 3),
	contentLineRange: { end: 1, start: 0 },
	desiredSemanticBody: "one\n",
	projection: fencedProjection([row()], 0, 3),
	selection: { direction: "none", end: 0, start: 0 },
	signature,
	source: "```\none\n```\n",
	target: { endLine: 3, kind: "fenced", startLine: 0 },
	...values,
});

describe("encodeEditorCodeProjection", () => {
	it("compensates a three-space fence offset before the desired two-space body indent", () => {
		const source = "```\n   two\n```\n";
		const result = encodeEditorCodeProjection(
			input({
				codeMap: codeMap("two\n", 0, 3),
				desiredSemanticBody: "  two\n",
				projection: fencedProjection([row({ literalFrom: 3 })], 0, 3, 3),
				source,
				selection: { direction: "forward", end: 7, start: 4 },
			}),
		);

		expect(result).toEqual({
			changes: { from: 4, insert: "     ", to: 7 },
			noop: false,
			selection: { direction: "forward", end: 9, start: 4 },
			status: "available",
		});
	});

	it("preserves a bare fenced row whose semantic body already has two spaces", () => {
		const source = "```\n  run();\n```\n";
		const result = encodeEditorCodeProjection(
			input({
				codeMap: codeMap("  run();\n", 0, 3),
				projection: fencedProjection(
					[row({ literalFrom: 0, sourceLine: 1 })],
					0,
					3,
				),
				desiredSemanticBody: "  run();\n",
				source,
				selection: { direction: "none", end: 8, start: 4 },
			}),
		);

		expect(result).toEqual({
			changes: null,
			noop: true,
			selection: { direction: "none", end: 8, start: 4 },
			status: "available",
		});
	});

	it("changes the complete raw leading span when a bare fenced body gains indentation", () => {
		const source = "```\n  run();\n```\n";
		const result = encodeEditorCodeProjection(
			input({
				codeMap: codeMap("  run();\n", 0, 3),
				projection: fencedProjection(
					[row({ literalFrom: 0, sourceLine: 1 })],
					0,
					3,
				),
				desiredSemanticBody: "    run();\n",
				source,
				selection: { direction: "none", end: 8, start: 4 },
			}),
		);

		expect(result).toMatchObject({
			changes: { from: 4, insert: "    ", to: 6 },
			noop: false,
			selection: { direction: "none", end: 10, start: 4 },
			status: "available",
		});
		if ("available" === result.status && result.changes) {
			expect(
				source.slice(0, result.changes.from) +
					result.changes.insert +
					source.slice(result.changes.to),
			).toBe("```\n    run();\n```\n");
		}
	});

	it("preserves a bare fenced row when a three-space offset has no raw prefix", () => {
		const source = "```\none\n```\n";
		const result = encodeEditorCodeProjection(
			input({
				projection: fencedProjection([row()], 0, 3, 3),
				source,
				selection: { direction: "none", end: 7, start: 4 },
			}),
		);

		expect(result).toEqual({
			changes: null,
			noop: true,
			selection: { direction: "none", end: 7, start: 4 },
			status: "available",
		});
	});

	it("maps a caret through each changed row before returning the compact edit", () => {
		const source = "   ```js\na\nb\nc\n   ```\n";
		const caret = source.indexOf("b") + 1;
		const result = encodeEditorCodeProjection(
			input({
				codeMap: codeMap("a\nb\nc\n", 0, 5),
				contentLineRange: { end: 3, start: 0 },
				desiredSemanticBody: "  a\n  b\n  c\n",
				projection: fencedProjection(
					[
						row({ sourceLine: 1 }),
						row({ contentLine: 1, sourceLine: 2 }),
						row({ contentLine: 2, sourceLine: 3 }),
					],
					0,
					5,
					3,
				),
				source,
				selection: { direction: "none", end: caret, start: caret },
				target: { endLine: 5, kind: "fenced", startLine: 0 },
			}),
		);

		expect(result).toMatchObject({
			changes: { from: 9, to: 13 },
			selection: { direction: "none", end: 22, start: 22 },
			status: "available",
		});
		if ("available" === result.status && result.changes) {
			expect(
				source.slice(0, result.changes.from) +
					result.changes.insert +
					source.slice(result.changes.to),
			).toBe("   ```js\n     a\n     b\n     c\n   ```\n");
		}
	});

	it("uses virtual partial-tab spaces only with an actual tab and keeps the raw suffix", () => {
		const source = "```\n\t  code\n```\n";
		const result = encodeEditorCodeProjection(
			input({
				codeMap: codeMap("    code\n", 0, 3),
				projection: fencedProjection(
					[
						row({
							literalFrom: 1,
							literalLeadingSpaces: 2,
							prefixTabColumns: 2,
							sourceLine: 1,
						}),
					],
					0,
					3,
				),
				desiredSemanticBody: "    code\n",
				source,
				selection: { direction: "none", end: 7, start: 7 },
			}),
		);

		expect(result).toEqual({
			changes: null,
			noop: true,
			selection: { direction: "none", end: 7, start: 7 },
			status: "available",
		});
	});

	it("changes only the selected content-line range and preserves intervening CRLF blanks", () => {
		const source = "```\r\none\r\n  two\r\n\r\n";
		const result = encodeEditorCodeProjection(
			input({
				codeMap: codeMap("one\r\n  two\r\n\r\n", 0, 5),
				contentLineRange: { end: 2, start: 1 },
				desiredSemanticBody: "  changed-outside\r\n    two\r\n\r\n",
				projection: fencedProjection(
					[
						row({ sourceLine: 1 }),
						row({
							contentLine: 1,
							literalFrom: 0,
							sourceLine: 2,
						}),
					],
					0,
					5,
				),
				source,
				target: { endLine: 5, kind: "fenced", startLine: 0 },
				selection: { direction: "backward", end: 10, start: 5 },
			}),
		);

		expect(result).toMatchObject({
			changes: { from: 10, insert: "    ", to: 12 },
			selection: { direction: "backward", end: 10, start: 5 },
			status: "available",
		});
		if ("available" === result.status && result.changes) {
			const updated =
				source.slice(0, result.changes.from) +
				result.changes.insert +
				source.slice(result.changes.to);
			expect(updated).toBe("```\r\none\r\n    two\r\n\r\n");
		}
	});

	it("returns a no-op with the original selection when no prefix changes are needed", () => {
		const source = "```\none\n```\n";
		const selection = { direction: "none" as const, end: 7, start: 4 };
		const result = encodeEditorCodeProjection(input({ source, selection }));

		expect(result).toEqual({
			changes: null,
			noop: true,
			selection,
			status: "available",
		});
	});

	it.each([
		{
			code: "editor-code-projection-source-stale" as const,
			name: "consumes a non-whitespace source prefix",
			input: input({
				projection: fencedProjection([row({ literalFrom: 1 })], 0, 3),
				source: "```\none\n```",
			}),
		},
		{
			code: "editor-code-projection-source-stale" as const,
			name: "does not match the formal source body",
			input: input({
				codeMap: codeMap("other\n", 0, 3),
				source: "```\none\n```",
			}),
		},
		{
			code: "editor-code-projection-map-stale" as const,
			name: "uses a stale request signature",
			input: input({ signature: "new-signature" }),
		},
		{
			code: "editor-code-projection-unsupported" as const,
			name: "changes a non-leading semantic character",
			input: input({ desiredSemanticBody: "other\n" }),
		},
	])("rejects $name with an explicit unavailable result", ({ code, input }) => {
		const result = encodeEditorCodeProjection(input);
		expect(result).toEqual({ code, status: "unavailable" });
	});

	it("rejects a projection map whose signature differs from the request", () => {
		const result = encodeEditorCodeProjection(
			input({
				projection: fencedProjection([row()], 0, 3, 0, "old-signature"),
			}),
		);
		expect(result).toEqual({
			code: "editor-code-projection-map-stale",
			status: "unavailable",
		});
	});

	it("preserves the final EOF line ending when changing an unclosed fenced body", () => {
		const source = "```\r\none\r\n\r\n";
		const result = encodeEditorCodeProjection(
			input({
				codeMap: codeMap("one\r\n\r\n", 0, 4),
				contentLineRange: { end: 2, start: 0 },
				desiredSemanticBody: "  one\r\n\r\n",
				projection: fencedProjection([row({ sourceLine: 1 })], 0, 4),
				source,
				target: { endLine: 4, kind: "fenced", startLine: 0 },
			}),
		);

		expect(result).toMatchObject({
			changes: { from: 5, insert: "  ", to: 5 },
			status: "available",
		});
		if ("available" === result.status && result.changes) {
			expect(
				source.slice(0, result.changes.from) +
					result.changes.insert +
					source.slice(result.changes.to),
			).toBe("```\r\n  one\r\n\r\n");
		}
	});

	it("rejects an unavailable formal projection instead of guessing source offsets", () => {
		const result = encodeEditorCodeProjection(
			input({
				projection: {
					code: "preview-code-projection-unavailable",
					coordinate: "line",
					offsetUnit: "utf16",
					signature,
					status: "unavailable",
					version: 1,
				},
			}),
		);
		expect(result).toEqual({
			code: "editor-code-projection-target-unavailable",
			status: "unavailable",
		});
	});

	it("supports indented code with the four-column base", () => {
		const source = "    one\n";
		const result = encodeEditorCodeProjection(
			input({
				codeMap: codeMap("one\n", 0, 1, "indented"),
				projection: indentedProjection(
					[row({ sourceLine: 0, literalFrom: 4 })],
					0,
					1,
				),
				source,
				target: { endLine: 1, kind: "indented", startLine: 0 },
			}),
		);
		expect(result).toEqual({
			changes: null,
			noop: true,
			selection: { direction: "none", end: 0, start: 0 },
			status: "available",
		});
	});
});
