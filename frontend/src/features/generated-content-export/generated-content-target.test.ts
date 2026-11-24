import { describe, expect, it } from "vitest";

import {
	associateGeneratedContentTarget,
	createGeneratedContentTarget,
	type GeneratedContentAcceptedPreview,
} from "./generated-content-target";

const preview: GeneratedContentAcceptedPreview = {
	revision: 4,
	signature: "accepted-preview-4",
};

describe("generated content target association", () => {
	it("associates duplicate formulas by worker ordinal, preserving exact source ranges", () => {
		const source = "before $x$ and after $x$";
		const firstFrom = source.indexOf("$x$");
		const secondFrom = source.lastIndexOf("$x$");
		const result = associateGeneratedContentTarget({
			acceptedPreview: preview,
			blockId: "visual-block-0",
			kind: "math",
			mathSpans: [
				{
					bodyFrom: firstFrom + 1,
					bodyTo: firstFrom + 2,
					displayMode: false,
					from: firstFrom,
					to: firstFrom + 3,
				},
				{
					bodyFrom: secondFrom + 1,
					bodyTo: secondFrom + 2,
					displayMode: false,
					from: secondFrom,
					to: secondFrom + 3,
				},
			],
			ordinal: 1,
			source,
			sourceRevision: 9,
		});

		expect(result).toEqual({
			status: "associated",
			target: {
				acceptedPreview: preview,
				blockId: "visual-block-0",
				kind: "math",
				ordinal: 1,
				original: {
					body: "x",
					bodyRange: { from: secondFrom + 1, to: secondFrom + 2 },
					full: "$x$",
					fullRange: { from: secondFrom, to: secondFrom + 3 },
				},
				sourceRevision: 9,
			},
		});
	});

	it("rejects a math association that has no exact ordinal instead of searching text", () => {
		const result = associateGeneratedContentTarget({
			acceptedPreview: preview,
			blockId: "visual-block-0",
			kind: "math",
			mathSpans: [
				{ bodyFrom: 1, bodyTo: 2, displayMode: false, from: 0, to: 3 },
			],
			ordinal: 1,
			source: "$x$ $x$",
			sourceRevision: 1,
		});

		expect(result).toEqual({
			code: "generated-content-target-ordinal-unavailable",
			status: "failed",
		});
	});

	it("rejects a math span whose body range includes either delimiter", () => {
		const result = associateGeneratedContentTarget({
			acceptedPreview: preview,
			blockId: "visual-block-0",
			kind: "math",
			mathSpans: [
				{ bodyFrom: 0, bodyTo: 3, displayMode: false, from: 0, to: 3 },
			],
			ordinal: 0,
			source: "$x$",
			sourceRevision: 1,
		});

		expect(result).toEqual({
			code: "generated-content-target-math-span-invalid",
			status: "failed",
		});
	});

	it("validates caller-supplied Mermaid ranges without parsing or normalizing source", () => {
		const source = "before\n```mermaid\r\nA-->B\r\n```\nafter";
		const fullFrom = source.indexOf("```mermaid");
		const fullTo = source.indexOf("\nafter");
		const bodyFrom = source.indexOf("A-->B");
		const bodyTo = bodyFrom + "A-->B".length;
		const result = createGeneratedContentTarget({
			acceptedPreview: preview,
			blockId: "visual-block-1",
			kind: "mermaid",
			ordinal: 0,
			original: {
				body: "A-->B",
				bodyRange: { from: bodyFrom, to: bodyTo },
				full: source.slice(fullFrom, fullTo),
				fullRange: { from: fullFrom, to: fullTo },
			},
			source,
			sourceRevision: 10,
		});

		expect(result.status).toBe("associated");
		if (result.status !== "associated") return;
		expect(result.target.original.full).toBe(source.slice(fullFrom, fullTo));
		expect(result.target.original.bodyRange).toEqual({
			from: bodyFrom,
			to: bodyTo,
		});
	});

	it("rejects invalid range/source combinations explicitly", () => {
		const result = createGeneratedContentTarget({
			acceptedPreview: preview,
			blockId: "visual-block-2",
			kind: "math",
			ordinal: 0,
			original: {
				body: "wrong",
				bodyRange: { from: 1, to: 2 },
				full: "$x$",
				fullRange: { from: 0, to: 3 },
			},
			source: "$x$",
			sourceRevision: 1,
		});

		expect(result).toEqual({
			code: "generated-content-target-original-mismatch",
			status: "failed",
		});
	});
});
