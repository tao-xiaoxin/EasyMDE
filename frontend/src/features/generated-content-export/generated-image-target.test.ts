import { markdownLanguage } from "@codemirror/lang-markdown";
import { describe, expect, it, vi } from "vitest";

import type { EditorMarkdownSourceBlock } from "../../contracts/ports/editor-block-index-port";
import { createEditorMarkdownBlockIndex as createProfiledMarkdownBlockIndex } from "../editor-context-menu/editor-markdown-block-index";
import {
	createImageScaleReplacement,
	createMarkdownImageDestinationReplacement,
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

	it("hydrates multiline blockquote and list-nested blockquote images by preserving container prefixes", async () => {
		for (const [label, source] of [
			["blockquote multiline image", '> ![alt](/x.png\n> "Caption {width=50%}")'],
			[
				"nested list-blockquote multiline image",
				'- > ![alt](/x.png\n  > "Caption {width=50%}")',
			],
			[
				"offset blockquote multiline image",
				'Intro paragraph\n\n> ![alt](/x.png\n> "Caption {width=50%}")',
			],
			[
				"offset nested list-blockquote multiline image",
				'Intro paragraph\n\n- > ![alt](/x.png\n  > "Caption {width=50%}")',
			],
		] as const) {
			const expectedStart = source.indexOf("![alt]");
			const expectedEnd = source.length;
			const expectedRaw = source.slice(expectedStart, expectedEnd);
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
				revision: 21,
				source,
			});
			const containerBlockIdx = parsed.blocks.length - 1;
			const containerBlock = parsed.blocks[containerBlockIdx];
			expect(result.blockImages[containerBlockIdx]?.status, label).toBe(
				"ready",
			);
			expect(result.images, label).toHaveLength(1);
			const hydrated = result.images[0];
			expect(hydrated, label).toMatchObject({
				alt: "alt",
				destination: "/x.png",
				end: expectedEnd,
				raw: expectedRaw,
				scale: 50,
				start: expectedStart,
				title: "Caption",
			});
			expect(
				source.slice(
					hydrated?.destinationStart ?? -1,
					hydrated?.destinationEnd ?? -1,
				),
				label,
			).toBe("/x.png");
			expect(
				source.slice(
					hydrated?.titleMarkerStart ?? -1,
					hydrated?.titleMarkerEnd ?? -1,
				),
				label,
			).toBe("{width=50%}");

			if (!containerBlock) throw new Error("container-block-missing");
			const associated = associateGeneratedImageTarget({
				acceptedPreview: { revision: 2, signature: label },
				block: {
					editable: containerBlock.editable,
					end: containerBlock.to,
					id: "b-container",
					kind: containerBlock.kind,
					start: containerBlock.from,
				},
				index: result,
				ordinal: 0,
				sourceRevision: 21,
			});
			expect(associated.status, label).toBe("associated");
			if ("associated" === associated.status) {
				expect(associated.target.original, label).toEqual({
					alt: "alt",
					destination: "/x.png",
					end: expectedEnd,
					raw: expectedRaw,
					start: expectedStart,
					title: "Caption",
				});
			}
		}

		// Blockquote multiline title with `>` inside title keeps PHP scale=50 and null raw marker offsets.
		const titleContinuationSource = '> ![alt](/x.png "Line1\n> Line2 {width=50%}")';
		const titleContParsed = createEditorMarkdownBlockIndex(
			titleContinuationSource,
		);
		const titleContResult = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: titleContParsed.blocks,
			imageIndex: {
				blocks: titleContParsed.blocks,
				imageBlocks: titleContParsed.imageBlocks ?? [],
				imageRanges: titleContParsed.imageRanges ?? [],
				length: titleContParsed.length,
				mathSpans: titleContParsed.mathSpans,
			},
			revision: 22,
			source: titleContinuationSource,
		});
		expect(titleContResult.blockImages[0]?.status).toBe("ready");
		expect(titleContResult.images[0]).toMatchObject({
			end: titleContinuationSource.length,
			raw: titleContinuationSource.slice(2),
			scale: 50,
			start: 2,
			title: "Line1\nLine2",
			titleMarkerEnd: null,
			titleMarkerStart: null,
		});

		// Invalid scale markers inside multiline container images stay block-scoped unavailable.
		for (const invalidContainer of [
			'> ![alt](/x.png\n> "Caption {width=51%}")',
			'> ![alt](/x.png "Line1\n> {width=50%}")',
		]) {
			const invalidParsed = createEditorMarkdownBlockIndex(invalidContainer);
			const invalidResult = await hydrateGeneratedImageTargetIndex({
				...hydration,
				blocks: invalidParsed.blocks,
				imageIndex: {
					blocks: invalidParsed.blocks,
					imageBlocks: invalidParsed.imageBlocks ?? [],
					imageRanges: invalidParsed.imageRanges ?? [],
					length: invalidParsed.length,
					mathSpans: invalidParsed.mathSpans,
				},
				revision: 23,
				source: invalidContainer,
			});
			expect(invalidResult.blockImages[0]?.status, invalidContainer).toBe(
				"unavailable",
			);
			expect(invalidResult.images, invalidContainer).toHaveLength(0);
		}
	});

	it("hydrates images with backtick/autolink/HTML alt text and linked/emphasized/CJK continuations while excluding HTML comments and attributes", async () => {
		for (const [label, source, expectedRaw, expectedDest, expectedScale] of [
			[
				"alt with backtick closing bracket",
				"![A `]` next](/image.png)",
				"![A `]` next](/image.png)",
				"/image.png",
				null,
			],
			[
				"alt with URI autolink containing [",
				"![Alt <https://example.test/a[b>](/image.png)",
				"![Alt <https://example.test/a[b>](/image.png)",
				"/image.png",
				null,
			],
			[
				"alt with HTML comment containing [",
				"![Alt <!-- [ -->](/image.png)",
				"![Alt <!-- [ -->](/image.png)",
				"/image.png",
				null,
			],
			[
				"alt with HTML tag attribute containing ](",
				'![<span title="](">](https://example.com/a.png "{width=50%}")',
				'![<span title="](">](https://example.com/a.png "{width=50%}")',
				"https://example.com/a.png",
				50,
			],
			[
				"alt with URI autolink containing ]",
				'![<https://example.com/?a=]>](https://example.com/a.png "{width=50%}")',
				'![<https://example.com/?a=]>](https://example.com/a.png "{width=50%}")',
				"https://example.com/a.png",
				50,
			],
			[
				"multiline linked image",
				"[![Alt\nline2](https://img.test/image.png)](https://site.test/page)",
				"![Alt\nline2](https://img.test/image.png)",
				"https://img.test/image.png",
				null,
			],
			[
				"multiline emphasized image",
				"*![alt\nline2](https://example.com/a.png)*",
				"![alt\nline2](https://example.com/a.png)",
				"https://example.com/a.png",
				null,
			],
			[
				"multiline CJK-adjacent image",
				"![alt\nline2](https://example.com/a.png)中文",
				"![alt\nline2](https://example.com/a.png)",
				"https://example.com/a.png",
				null,
			],
			[
				"compact table image",
				"| Col |\n| --- |\n|![alt](https://example.com/a.png)|",
				"![alt](https://example.com/a.png)",
				"https://example.com/a.png",
				null,
			],
		] as const) {
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
				revision: 31,
				source,
			});
			expect(result.blockImages[0]?.status, label).toBe("ready");
			expect(result.images, label).toHaveLength(1);
			expect(result.images[0], label).toMatchObject({
				destination: expectedDest,
				raw: expectedRaw,
				scale: expectedScale,
			});
		}

		for (const nonImage of [
			"hi <!-- ![a](https://example.com/a.png) -->",
			'<span title="![a](https://example.com/a.png) ">hi</span>',
			'<span title="![a](<https://example.com/a.png>)">hi</span>',
			`<span title="![a](https://example.com/a.png 't')">hi</span>`,
		]) {
			const parsed = createEditorMarkdownBlockIndex(nonImage);
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
				revision: 32,
				source: nonImage,
			});
			expect(result.images, nonImage).toHaveLength(0);
		}
	});

	it("hydrates 4,000 multiline images inside one paragraph block in linear time without hitting the timeout budget", async () => {
		const count = 4_000;
		const source = Array.from(
			{ length: count },
			(_, i) => `![Alt](/x${i}.png\n"Caption")`,
		).join("\n");
		const started = performance.now();
		const parsed = createEditorMarkdownBlockIndex(source);
		const result = await hydrateGeneratedImageTargetIndex({
			blocks: parsed.blocks,
			deadline: started + 10_000,
			imageIndex: {
				blocks: parsed.blocks,
				imageBlocks: parsed.imageBlocks ?? [],
				imageRanges: parsed.imageRanges ?? [],
				length: parsed.length,
				mathSpans: parsed.mathSpans,
			},
			now: () => performance.now(),
			revision: 33,
			signal: new AbortController().signal,
			source,
			yield: async () => undefined,
		});
		const elapsedMs = performance.now() - started;
		expect(result.blockImages).toHaveLength(1);
		expect(result.blockImages[0]?.status).toBe("ready");
		expect(result.images).toHaveLength(count);
		expect(result.images[0]).toMatchObject({
			alt: "Alt",
			destination: "/x0.png",
			title: "Caption",
		});
		expect(result.images[count - 1]).toMatchObject({
			alt: "Alt",
			destination: `/x${count - 1}.png`,
			title: "Caption",
		});
		expect(elapsedMs).toBeLessThan(2_000);
	});

	it("marks single-line bare-destination images with ambiguous trailing continuations unavailable while preserving linked and non-ambiguous images", async () => {
		for (const ambiguous of [
			"![Alt](https://example.test/a).png",
			"![Alt](https://example.test/a)b.png",
			"![Alt](https://example.test/a)/b",
			"![Alt](https://example.test/a)?q=1",
			"![Alt](https://example.test/a)#frag",
			"![Alt](https://example.test/a)_v2.png",
			"![Alt](https://example.test/a)-v2.png",
			"![Alt\nline2](https://example.test/a).png",
		]) {
			const parsed = createEditorMarkdownBlockIndex(ambiguous);
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
				revision: 34,
				source: ambiguous,
			});
			expect(result.blockImages[0]?.status, ambiguous).toBe("unavailable");
			expect(result.images, ambiguous).toHaveLength(0);
		}

		for (const [label, source, expectedDest] of [
			[
				"linked image",
				"[![Alt](https://img.test/image.png)](https://site.test/page)",
				"https://img.test/image.png",
			],
			[
				"sentence period followed by space",
				"![Alt](https://example.test/a). Next sentence",
				"https://example.test/a",
			],
			[
				"compact table cell before dot-prefixed next cell",
				"|![Alt](https://example.test/a)|.png|\n| --- | --- |",
				"https://example.test/a",
			],
		] as const) {
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
				revision: 35,
				source,
			});
			expect(result.blockImages[0]?.status, label).toBe("ready");
			expect(result.images, label).toHaveLength(1);
			const hydrated = result.images[0];
			expect(hydrated?.destination, label).toBe(expectedDest);
			if (!hydrated) throw new Error(`missing-hydrated:${label}`);
			expect(createImageScaleReplacement(source, hydrated, 50)).toBeTruthy();
			expect(
				createMarkdownImageDestinationReplacement(
					source,
					hydrated,
					"https://img.test/updated.png",
				),
			).toBeTruthy();
		}
	});

	it("hydrates a single-line image containing 16,300 repeated `<` characters in linear time", async () => {
		const source = `![A ${"<".repeat(16_300)}](/x.png)`;
		const started = performance.now();
		const parsed = createEditorMarkdownBlockIndex(source);
		const result = await hydrateGeneratedImageTargetIndex({
			blocks: parsed.blocks,
			deadline: started + 10_000,
			imageIndex: {
				blocks: parsed.blocks,
				imageBlocks: parsed.imageBlocks ?? [],
				imageRanges: parsed.imageRanges ?? [],
				length: parsed.length,
				mathSpans: parsed.mathSpans,
			},
			now: () => performance.now(),
			revision: 36,
			signal: new AbortController().signal,
			source,
			yield: async () => undefined,
		});
		const elapsedMs = performance.now() - started;
		expect(result.blockImages[0]?.status).toBe("ready");
		expect(result.images).toHaveLength(1);
		expect(result.images[0]?.destination).toBe("/x.png");
		expect(elapsedMs).toBeLessThan(500);
	});

	it("hydrates GFM table images whose next cell holds backticks or HTML closers without cross-cell lookahead poisoning", async () => {
		for (const [label, source, expectedAlt, expectedDest] of [
			[
				"tight backtick in adjacent table cell",
				"| ![a `b](https://example.com/a.png)|` |\n| --- | --- |",
				"a `b",
				"https://example.com/a.png",
			],
			[
				"spaced backtick in adjacent table cell",
				"| ![a `b](https://example.com/a.png) | ` |\n| --- | --- |",
				"a `b",
				"https://example.com/a.png",
			],
			[
				"HTML attribute closer in adjacent table cell",
				'| ![a <b q="](https://example.com/a.png)|"> |\n| --- | --- |',
				'a <b q="',
				"https://example.com/a.png",
			],
			[
				"blockquote-nested table tight backtick in adjacent cell",
				"> | ![a `b](https://example.com/a.png)|` |\n> | --- | --- |",
				"a `b",
				"https://example.com/a.png",
			],
			[
				"table cell with escaped pipe in destination",
				"| A |\n| --- |\n| ![alt](https://example.com/a\\|b.png) |",
				"alt",
				"https://example.com/a|b.png",
			],
		] as const) {
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
				revision: 37,
				source,
			});
			expect(result.blockImages[0]?.status, label).toBe("ready");
			expect(result.images, label).toHaveLength(1);
			expect(result.images[0], label).toMatchObject({
				alt: expectedAlt,
				destination: expectedDest,
			});
		}
	});

	it("excludes PHP-dropped extra GFM table body cells during indexing and hydration", async () => {
		for (const [label, source] of [
			[
				"2-col table extra 3rd cell",
				"| H | B |\n| --- | --- |\n| a | b | ![extra](https://example.org/i.png) |",
			],
			[
				"asymmetric 1-header / 2-separator table drops 2nd body cell",
				"| A |\n| --- | --- |\n| 1 | ![dropped](https://example.com/dropped.png) |",
			],
			[
				"0-col header table drops all body cells",
				"|\n| --- |\n| ![dropped](https://example.com/dropped.png) |",
			],
		] as const) {
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
				revision: 38,
				source,
			});
			expect(result.blockImages[0]?.status, label).toBe("ready");
			expect(result.images, label).toHaveLength(0);
		}

		// Mixed table: dropped cell on row 1 is excluded so real.png hydrates at DOM ordinal 0.
		const mixed =
			"| A |\n| --- |\n| 1 | ![dropped](https://example.com/dropped.png) |\n| ![real](https://example.com/real.png) |";
		const mixedParsed = createEditorMarkdownBlockIndex(mixed);
		const mixedResult = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: mixedParsed.blocks,
			imageIndex: {
				blocks: mixedParsed.blocks,
				imageBlocks: mixedParsed.imageBlocks ?? [],
				imageRanges: mixedParsed.imageRanges ?? [],
				length: mixedParsed.length,
				mathSpans: mixedParsed.mathSpans,
			},
			revision: 39,
			source: mixed,
		});
		expect(mixedResult.blockImages[0]?.status).toBe("ready");
		expect(mixedResult.images).toHaveLength(1);
		expect(mixedResult.images[0]).toMatchObject({
			alt: "real",
			destination: "https://example.com/real.png",
		});

		// Defense-in-depth: even if an unfiltered imageIndex supplies an extra-cell range
		// on a table block, hydration rejects it instead of hydrating a PHP-dropped image.
		const unfilteredSource =
			"| H | B |\n| --- | --- |\n| a | b | ![extra](https://example.org/i.png) |";
		const extraFrom = unfilteredSource.indexOf("![extra]");
		const extraTo = unfilteredSource.indexOf(")", extraFrom) + 1;
		const tableBlock = {
			editable: true as const,
			from: 0,
			kind: "table" as const,
			lineEnd: 2,
			lineStart: 0,
			to: unfilteredSource.length,
		};
		const rejected = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: [tableBlock],
			imageIndex: {
				blocks: [tableBlock],
				imageBlocks: [{ count: 1, firstImageIndex: 0, status: "ready" }],
				imageRanges: [{ from: extraFrom, to: extraTo }],
				length: unfilteredSource.length,
				mathSpans: [],
			},
			revision: 40,
			source: unfilteredSource,
		});
		expect(rejected.blockImages[0]?.status).toBe("unavailable");
		expect(rejected.images).toHaveLength(0);
	});

	it("hydrates Lezer-split PHP table continuation rows with escaped pipes and stays compatible with destination replacement", async () => {
		for (const [label, source] of [
			[
				"dash continuation row after table",
				"| A |\n| --- |\n- ![a](https://example.com/a\\\\|b.png) |",
			],
			[
				"heading continuation row after table",
				"| A |\n| --- |\n# ![a](https://example.com/a\\\\|b.png) |",
			],
			[
				"blockquote continuation row after table",
				"| A |\n| --- |\n> ![a](https://example.com/a\\\\|b.png) |",
			],
		] as const) {
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
				revision: 41,
				source,
			});
			expect(result.images, label).toHaveLength(1);
			const hydrated = result.images[0];
			expect(hydrated?.destination, label).toBe("https://example.com/a|b.png");
			if (!hydrated) throw new Error(`missing-hydrated:${label}`);
			const replacement = createMarkdownImageDestinationReplacement(
				source,
				hydrated,
				"https://example.com/c|d.png",
			);
			expect(replacement, label).not.toBeNull();
			if (!replacement) continue;
			const updated =
				source.slice(0, replacement.from) +
				replacement.insert +
				source.slice(replacement.to);
			expect(updated, label).toContain("https://example.com/c\\|d.png");
		}
	});

	it("hydrates images in GFM tables alongside inline math pipes matching PHP extract_math", async () => {
		for (const [label, source, expectedAlt, expectedDest] of [
			[
				"$a|b$ before image in same cell",
				"| A |\n| - |\n| $a|b$ ![x](/i) [y](/y) |",
				"x",
				"/i",
			],
			[
				"$a|b$ in cell 0 with image in cell 1",
				"| A | B |\n| --- | --- |\n| $a|b$ | ![img](https://example.com/a.png) |",
				"img",
				"https://example.com/a.png",
			],
			[
				"\\(a|b\\) in cell 0 with image in cell 1",
				"| A | B |\n| --- | --- |\n| \\(a|b\\) | ![img](https://example.com/a.png) |",
				"img",
				"https://example.com/a.png",
			],
			[
				"$a|b$ and $c|d$ flanking an image in the same cell",
				'| A |\n| --- |\n| $a|b$ ![x](https://example.com/a.png "cap") $c|d$ |',
				"x",
				"https://example.com/a.png",
			],
		] as const) {
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
				revision: 42,
				source,
			});
			expect(result.images, label).toHaveLength(1);
			expect(result.images[0], label).toMatchObject({
				alt: expectedAlt,
				destination: expectedDest,
			});
		}

		// Inline math in header counts as 1 column, dropping the extra body-cell image.
		const headerMath =
			"| $a|b$ |\n| --- |\n| 1 | ![extra](https://example.com/x.png) |";
		const headerParsed = createEditorMarkdownBlockIndex(headerMath);
		const headerResult = await hydrateGeneratedImageTargetIndex({
			...hydration,
			blocks: headerParsed.blocks,
			imageIndex: {
				blocks: headerParsed.blocks,
				imageBlocks: headerParsed.imageBlocks ?? [],
				imageRanges: headerParsed.imageRanges ?? [],
				length: headerParsed.length,
				mathSpans: headerParsed.mathSpans,
			},
			revision: 43,
			source: headerMath,
		});
		expect(headerResult.images).toHaveLength(0);
	});

	it("hydrates many pipe-free single-line image blocks in linear time without per-block full-source pipe scans", async () => {
		const count = 10_000;
		const source = "![x](/x)\n\n".repeat(count);
		const blocks: EditorMarkdownSourceBlock[] = [];
		const imageBlocks: Array<{
			count: number;
			firstImageIndex: number;
			status: "ready";
		}> = [];
		const imageRanges: Array<{ from: number; to: number }> = [];
		for (let i = 0; i < count; i += 1) {
			const from = i * 10;
			const to = from + 8;
			blocks.push({
				editable: true,
				from,
				kind: "paragraph",
				lineEnd: i * 2,
				lineStart: i * 2,
				to,
			});
			imageBlocks.push({ count: 1, firstImageIndex: i, status: "ready" });
			imageRanges.push({ from, to });
		}
		const started = performance.now();
		const result = await hydrateGeneratedImageTargetIndex({
			blocks,
			deadline: started + 10_000,
			imageIndex: {
				blocks,
				imageBlocks,
				imageRanges,
				length: source.length,
				mathSpans: [],
			},
			now: () => performance.now(),
			revision: 44,
			signal: new AbortController().signal,
			source,
			yield: async () => undefined,
		});
		const elapsedMs = performance.now() - started;
		expect(result.images).toHaveLength(count);
		expect(elapsedMs).toBeLessThan(2_000);
	});
});

function createEditorMarkdownBlockIndex(source: string, options: Parameters<typeof createProfiledMarkdownBlockIndex>[1] = { referenceLabelCaseFoldProfile: 14 }) {
  return createProfiledMarkdownBlockIndex(source, options);
}
