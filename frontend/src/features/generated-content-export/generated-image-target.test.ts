import { markdownLanguage } from "@codemirror/lang-markdown";
import { describe, expect, it, vi } from "vitest";

import type { EditorMarkdownSourceBlock } from "../../contracts/ports/editor-block-index-port";
import { createEditorMarkdownBlockIndex } from "../editor-context-menu/editor-markdown-block-index";
import {
	type MarkdownImageScaleMatch,
	parseMarkdownImageScale,
} from "../image-scale/image-scale-contract";
import {
	associateGeneratedImageTarget,
	associateGeneratedImageTargetBySelection,
	type GeneratedImageTargetIndex,
	hydrateGeneratedImageTargetIndex,
} from "./generated-image-target";

function imageAt(source: string, value: string): MarkdownImageScaleMatch {
	const start = source.indexOf(value);
	if (start < 0) throw new Error("image-fixture-missing");
	const image = parseMarkdownImageScale(source, start);
	if (!image) throw new Error("image-fixture-invalid");
	return image;
}

function imageFromParsedAst(source: string): MarkdownImageScaleMatch {
	const tree = markdownLanguage.parser.parse(source);
	let from = -1;
	let to = -1;
	tree.iterate({
		enter: (node) => {
			if (-1 === from && "Image" === node.name) {
				from = node.from;
				to = node.to;
			}
		},
	});
	if (from < 0 || to <= from) throw new Error("image-ast-missing");
	const parsed = parseMarkdownImageScale(source.slice(from, to), 0);
	if (!parsed || parsed.end !== to - from)
		throw new Error("image-ast-image-invalid");
	const shift = (value: number | null): number | null =>
		null === value ? null : value + from;
	return {
		...parsed,
		destinationEnd: parsed.destinationEnd + from,
		destinationStart: parsed.destinationStart + from,
		end: parsed.end + from,
		imageEnd: parsed.imageEnd + from,
		start: parsed.start + from,
		titleEnd: shift(parsed.titleEnd),
		titleMarkerEnd: shift(parsed.titleMarkerEnd),
		titleMarkerStart: shift(parsed.titleMarkerStart),
		titleStart: shift(parsed.titleStart),
	};
}

function block(
	source: string,
	kind: EditorMarkdownSourceBlock["kind"] = "paragraph",
): EditorMarkdownSourceBlock {
	return {
		editable: true,
		from: 0,
		kind,
		lineEnd: 1,
		lineStart: 0,
		to: source.length,
	};
}

function index(
	source: string,
	images: ReadonlyArray<MarkdownImageScaleMatch>,
	kind: EditorMarkdownSourceBlock["kind"] = "paragraph",
): GeneratedImageTargetIndex {
	return {
		blockImages: [{ end: source.length, images, start: 0, status: "ready" }],
		blocks: [block(source, kind)],
		complete: true,
		images,
		length: source.length,
		revision: 7,
		source,
		sourceBytes: source.length,
	};
}

const hydration = {
	deadline: 10_000,
	now: () => 0,
	signal: new AbortController().signal,
	yield: async () => undefined,
};

describe("associateGeneratedImageTarget", () => {
	it("keeps duplicate destinations distinct by exact source range and ordinal", () => {
		const source =
			"![one](https://img.test/a.png) ![two](https://img.test/a.png)";
		const images = [imageAt(source, "![one]"), imageAt(source, "![two]")];
		const first = associateGeneratedImageTarget({
			acceptedPreview: { revision: 3, signature: "preview" },
			block: { ...block(source), end: source.length, id: "b0", start: 0 },
			index: index(source, images),
			ordinal: 0,
			sourceRevision: 7,
		});
		const second = associateGeneratedImageTarget({
			acceptedPreview: { revision: 3, signature: "preview" },
			block: { ...block(source), end: source.length, id: "b0", start: 0 },
			index: index(source, images),
			ordinal: 1,
			sourceRevision: 7,
		});
		expect(first.status).toBe("associated");
		expect(second.status).toBe("associated");
		if ("associated" !== first.status || "associated" !== second.status) return;
		expect(first.target.original.start).not.toBe(second.target.original.start);
		expect(first.target.original.destination).toBe(
			second.target.original.destination,
		);
	});

	it("supports an inline image nested in a link without using the link URL", () => {
		const source =
			"[![Alt](https://img.test/image.png)](https://site.test/page)";
		const image = imageFromParsedAst(source);
		const result = associateGeneratedImageTarget({
			acceptedPreview: { revision: 1, signature: "linked" },
			block: { ...block(source), end: source.length, id: "b0", start: 0 },
			index: index(source, [image]),
			ordinal: 0,
			sourceRevision: 7,
		});
		expect(result.status).toBe("associated");
		if ("associated" === result.status) {
			expect(result.target.original.destination).toBe(
				"https://img.test/image.png",
			);
			expect(result.target.original.raw).toBe(
				"![Alt](https://img.test/image.png)",
			);
		}
	});

	it("rejects code blocks, unavailable ranges, and unsupported reference-only images", () => {
		const source = "```md\n![code](https://img.test/code.png)\n```";
		const image = imageAt(source, "![code]");
		const result = associateGeneratedImageTarget({
			acceptedPreview: { revision: 1, signature: "code" },
			block: {
				...block(source, "code"),
				end: source.length,
				id: "b0",
				start: 0,
			},
			index: index(source, [image], "code"),
			ordinal: 0,
			sourceRevision: 7,
		});
		expect(result).toEqual({
			code: "generated-image-target-block-invalid",
			status: "failed",
		});
		const reference = "![ref][image]\n\n[image]: https://img.test/ref.png";
		expect(parseMarkdownImageScale(reference, 0)).toBeNull();
	});

	it("preserves CRLF UTF-16 ranges and rejects a stale source binding", () => {
		const source = "Before\r\n![Alt](https://img.test/a.png)\r\nAfter";
		const image = imageAt(source, "![Alt]");
		const valid = associateGeneratedImageTarget({
			acceptedPreview: { revision: 4, signature: "crlf" },
			block: { ...block(source), end: source.length, id: "b0", start: 0 },
			index: index(source, [image]),
			ordinal: 0,
			sourceRevision: 7,
		});
		expect(valid.status).toBe("associated");
		const stale = associateGeneratedImageTarget({
			acceptedPreview: { revision: 4, signature: "crlf" },
			block: { ...block(source), end: source.length, id: "b0", start: 0 },
			index: {
				...index(source, [image]),
				source: `X${source}`,
				length: source.length + 1,
			},
			ordinal: 0,
			sourceRevision: 7,
		});
		expect(stale.status).toBe("failed");
	});

	it("resolves a source selection to one exact image range and rejects a boundary ambiguity", () => {
		const source =
			"![one](https://img.test/a.png) ![two](https://img.test/b.png)";
		const images = [imageAt(source, "![one]"), imageAt(source, "![two]")];
		const first = images[0];
		const second = images[1];
		if (!first || !second) throw new Error("image-selection-fixture-invalid");
		const blockValue = {
			...block(source),
			end: source.length,
			id: "b0",
			start: 0,
		};
		const selected = associateGeneratedImageTargetBySelection({
			acceptedPreview: { revision: 1, signature: "selection" },
			block: blockValue,
			index: index(source, images),
			selection: { end: first.end, start: first.start },
			sourceRevision: 7,
		});
		expect(selected.status).toBe("associated");
		if ("associated" === selected.status) {
			expect(selected.target.original.start).toBe(first.start);
			expect(selected.target.ordinal).toBe(0);
		}
		expect(
			associateGeneratedImageTargetBySelection({
				acceptedPreview: { revision: 1, signature: "selection" },
				block: blockValue,
				index: index(source, images),
				selection: { end: second.start, start: first.end },
				sourceRevision: 7,
			}),
		).toEqual({
			code: "generated-image-target-image-unavailable",
			status: "failed",
		});
	});

	it("builds a complete numeric-index-backed target index and isolates unsupported reference images", async () => {
		const source =
			"[![Alt](https://img.test/image.png)](https://site.test/page)";
		const parsed = createEditorMarkdownBlockIndex(source);
		const result = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: parsed.blocks,
			imageIndex: {
				blocks: parsed.blocks,
				imageBlocks: parsed.imageBlocks ?? [],
				imageRanges: parsed.imageRanges ?? [],
				length: parsed.length,
				mathSpans: parsed.mathSpans,
			},
			revision: 7,
			source,
		});
		expect(result.complete).toBe(true);
		expect(result.images).toHaveLength(1);
		expect(result.images[0]?.raw).toBe("![Alt](https://img.test/image.png)");

		const reference = "![ref][image]\n\n[image]: https://img.test/ref.png";
		const referenceParsed = createEditorMarkdownBlockIndex(reference);
		const unsupported = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: referenceParsed.blocks,
			imageIndex: {
				blocks: referenceParsed.blocks,
				imageBlocks: referenceParsed.imageBlocks ?? [],
				imageRanges: referenceParsed.imageRanges ?? [],
				length: referenceParsed.length,
				mathSpans: referenceParsed.mathSpans,
			},
			revision: 7,
			source: reference,
		});
		expect(
			unsupported.blockImages.some((block) => "unavailable" === block.status),
		).toBe(true);
		expect(unsupported.images).toHaveLength(0);
	});

	it("does not hydrate an image-looking token contained by an accepted math span", async () => {
		const source =
			"$![math](https://img.test/math.png)$ ![real](https://img.test/real.png)";
		const parsed = createEditorMarkdownBlockIndex(source);
		const index = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: parsed.blocks,
			imageIndex: {
				blocks: parsed.blocks,
				imageBlocks: parsed.imageBlocks ?? [],
				imageRanges: parsed.imageRanges ?? [],
				length: parsed.length,
				mathSpans: parsed.mathSpans,
			},
			revision: 8,
			source,
		});
		expect(index.images).toHaveLength(1);
		expect(index.images[0]?.raw).toBe("![real](https://img.test/real.png)");
	});

	it("turns invalid image scale syntax into an affected-block unavailable result", async () => {
		const source = '![image](https://img.test/a.png "{width=300%}")';
		const parsed = createEditorMarkdownBlockIndex(source);
		const result = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: parsed.blocks,
			imageIndex: {
				blocks: parsed.blocks,
				imageBlocks: parsed.imageBlocks ?? [],
				imageRanges: parsed.imageRanges ?? [],
				length: parsed.length,
				mathSpans: parsed.mathSpans,
			},
			revision: 1,
			source,
		});
		expect(result.blockImages[0]?.status).toBe("unavailable");
		expect(result.images).toHaveLength(0);
	});

	it("bounds one oversized image to its block and aborts without fallback hydration", async () => {
		const source = `![huge](https://img.test/${"a".repeat(16_400)})`;
		const parsed = createEditorMarkdownBlockIndex(source);
		const imageIndex = {
			blocks: parsed.blocks,
			imageBlocks: parsed.imageBlocks ?? [],
			imageRanges: parsed.imageRanges ?? [],
			length: parsed.length,
			mathSpans: parsed.mathSpans,
		};
		const oversized = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: parsed.blocks,
			imageIndex,
			revision: 2,
			source,
		});
		expect(oversized.blockImages[0]?.status).toBe("unavailable");
		expect(oversized.images).toHaveLength(0);
		const controller = new AbortController();
		controller.abort();
		await expect(
			hydrateGeneratedImageTargetIndex({
				...hydration,
				blocks: parsed.blocks,
				imageIndex,
				revision: 2,
				signal: controller.signal,
				source,
			}),
		).rejects.toThrow("editor-block-index-cancelled");
	});

	it("checkpoints empty, 1 MiB, and 100K unavailable-block indexes before publishing", async () => {
		const empty = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: [],
			imageIndex: {
				blocks: [],
				imageBlocks: [],
				imageRanges: [],
				length: 0,
				mathSpans: [],
			},
			revision: 3,
			source: "",
		});
		expect(empty.blockImages).toHaveLength(0);

		const source = "a".repeat(1_048_576);
		const oneMiBBlock = {
			editable: true as const,
			from: 0,
			kind: "paragraph" as const,
			lineEnd: 0,
			lineStart: 0,
			to: source.length,
		};
		const oneMiB = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: [oneMiBBlock],
			imageIndex: {
				blocks: [oneMiBBlock],
				imageBlocks: [{ count: 0, firstImageIndex: 0, status: "ready" }],
				imageRanges: [],
				length: source.length,
				mathSpans: [],
			},
			revision: 3,
			source,
		});
		expect(oneMiB.sourceBytes).toBe(1_048_576);

		const blockCount = 100_000;
		const smallSource = "x".repeat(blockCount);
		const blocks = Array.from({ length: blockCount }, (_, index) => ({
			editable: false as const,
			from: index,
			kind: "unavailable" as const,
			lineEnd: index,
			lineStart: index,
			to: index + 1,
		}));
		let clock = 0;
		let yields = 0;
		const manyUnavailable = await hydrateGeneratedImageTargetIndex({
			blocks,
			deadline: 1_000_000_000,
			imageIndex: {
				blocks,
				imageBlocks: blocks.map(() => ({
					count: 0,
					firstImageIndex: 0,
					status: "unavailable" as const,
				})),
				imageRanges: [],
				length: smallSource.length,
				mathSpans: [],
			},
			now: () => ++clock,
			revision: 3,
			signal: new AbortController().signal,
			source: smallSource,
			yield: async () => {
				yields += 1;
			},
		});
		expect(manyUnavailable.blockImages).toHaveLength(blockCount);
		expect(yields).toBeGreaterThan(0);
	});

	it("checks abort and deadline again before publishing an empty result", async () => {
		const emptyInput = {
			...hydration,
			blocks: [],
			imageIndex: {
				blocks: [],
				imageBlocks: [],
				imageRanges: [],
				length: 0,
				mathSpans: [],
			},
			revision: 4,
			source: "",
		};
		const abortController = new AbortController();
		const aborted = hydrateGeneratedImageTargetIndex({
			...emptyInput,
			signal: abortController.signal,
		});
		queueMicrotask(() => abortController.abort());
		await expect(aborted).rejects.toThrow("editor-block-index-cancelled");

		let clock = 0;
		const expired = hydrateGeneratedImageTargetIndex({
			...emptyInput,
			deadline: 10_000,
			now: () => clock,
		});
		queueMicrotask(() => {
			clock = 10_001;
		});
		await expect(expired).rejects.toThrow(
			"editor-block-index-image-hydration-timeout",
		);
	});

	it("rejects code-block image ranges and unexpected parser failures explicitly", async () => {
		const codeSource = "```md\n![code](https://img.test/code.png)\n```";
		const codeStart = codeSource.indexOf("![code]");
		const codeBlock = {
			editable: true as const,
			from: 0,
			kind: "code" as const,
			lineEnd: 3,
			lineStart: 0,
			to: codeSource.length,
		};
		await expect(
			hydrateGeneratedImageTargetIndex({
				...hydration,
				blocks: [codeBlock],
				imageIndex: {
					blocks: [codeBlock],
					imageBlocks: [{ count: 1, firstImageIndex: 0, status: "ready" }],
					imageRanges: [{ from: codeStart, to: codeStart + 34 }],
					length: codeSource.length,
					mathSpans: [],
				},
				revision: 5,
				source: codeSource,
			}),
		).rejects.toThrow("editor-block-index-image-result-invalid");

		const source = "![image](https://img.test/image.png)";
		const parsed = createEditorMarkdownBlockIndex(source);
		const originalSlice = String.prototype.slice;
		const sliceSpy = vi
			.spyOn(String.prototype, "slice")
			.mockImplementation(function (
				this: string,
				start?: number,
				end?: number,
			) {
				if (this === source && (start ?? 0) > 0) {
					throw new TypeError("unexpected-parser-runtime-probe");
				}
				return originalSlice.call(this, start, end);
			});
		try {
			await expect(
				hydrateGeneratedImageTargetIndex({
					...hydration,
					blocks: parsed.blocks,
					imageIndex: {
						blocks: parsed.blocks,
						imageBlocks: parsed.imageBlocks ?? [],
						imageRanges: parsed.imageRanges ?? [],
						length: parsed.length,
						mathSpans: parsed.mathSpans,
					},
					revision: 5,
					source,
				}),
			).rejects.toThrow("unexpected-parser-runtime-probe");
		} finally {
			sliceSpy.mockRestore();
		}
	});

	it("keeps a valid neighboring block usable when one block has unsupported image syntax", async () => {
		const source =
			"![ref][image]\n\n[image]: https://img.test/ref.png\n\n![ok](https://img.test/ok.png)";
		const validStart = source.indexOf("![ok]");
		if (validStart < 0) throw new Error("neighbor-image-fixture-invalid");
		const parsed = createEditorMarkdownBlockIndex(source);
		const result = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: parsed.blocks,
			imageIndex: {
				blocks: parsed.blocks,
				imageBlocks: parsed.imageBlocks ?? [],
				imageRanges: parsed.imageRanges ?? [],
				length: parsed.length,
				mathSpans: parsed.mathSpans,
			},
			revision: 12,
			source,
		});
		expect(
			result.blockImages.some((block) => "unavailable" === block.status),
		).toBe(true);
		expect(
			result.blockImages.some(
				(block) => "ready" === block.status && block.images.length === 1,
			),
		).toBe(true);
		const associated = associateGeneratedImageTarget({
			acceptedPreview: { revision: 1, signature: "neighbor" },
			block: {
				editable: true,
				end: source.length,
				id: "b1",
				kind: "paragraph",
				start: validStart,
			},
			index: result,
			ordinal: 0,
			sourceRevision: 12,
		});
		expect(associated.status).toBe("associated");
	});

	it("keeps CRLF UTF-16 ranges and excludes fenced-code images in the AST producer", async () => {
		const source =
			"```md\r\n![code](https://img.test/code.png)\r\n```\r\n\r\n![ok](https://img.test/ok.png)";
		const codeEnd = source.indexOf("```\r\n\r\n") + "```".length;
		const validStart = source.indexOf("![ok]");
		if (codeEnd < 3 || validStart < 0)
			throw new Error("crlf-image-fixture-invalid");
		const parsed = createEditorMarkdownBlockIndex(source);
		const result = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: parsed.blocks,
			imageIndex: {
				blocks: parsed.blocks,
				imageBlocks: parsed.imageBlocks ?? [],
				imageRanges: parsed.imageRanges ?? [],
				length: parsed.length,
				mathSpans: parsed.mathSpans,
			},
			revision: 19,
			source,
		});
		expect(result.images).toHaveLength(1);
		expect(result.images[0]?.start).toBe(validStart);
		expect(
			result.blockImages.some(
				(block) => "ready" === block.status && block.images.length === 0,
			),
		).toBe(true);
	});
});
