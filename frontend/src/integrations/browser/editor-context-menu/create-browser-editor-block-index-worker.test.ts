import { describe, expect, it, vi } from "vitest";

import {
	EDITOR_MARKDOWN_BLOCK_KIND_ORDER,
	type EditorBlockIndexWorkerRequest,
	type EditorBlockIndexWorkerResponse,
	type EditorMarkdownBlockIndexDataWithImages,
	type EditorMarkdownBlockIndexPackedData,
	type ReferenceLabelCaseFoldProfile,
	MAX_EDITOR_BLOCK_INDEX_BLOCKS,
	MAX_EDITOR_BLOCK_INDEX_IMAGES,
	MAX_EDITOR_BLOCK_INDEX_LINKS,
	MAX_EDITOR_BLOCK_INDEX_SOURCE_BYTES,
} from "../../../contracts/ports/editor-block-index-port";
import { createEditorBlockIndexWorkerHandler } from "../../../entrypoints/editor-block-index-worker";
import { createEditorMarkdownBlockIndex } from "../../../features/editor-context-menu/editor-markdown-block-index";
import { createBrowserEditorBlockIndexWorker } from "./create-browser-editor-block-index-worker";

type WorkerListener = (event: Event | MessageEvent<unknown>) => void;

class FakeWorker {
	static instances: FakeWorker[] = [];

	readonly posted: EditorBlockIndexWorkerRequest[] = [];
	terminated = false;
	private readonly listeners = new Map<string, Set<WorkerListener>>();

	constructor(readonly url: string) {
		FakeWorker.instances.push(this);
	}

	addEventListener(type: string, listener: WorkerListener): void {
		const listeners = this.listeners.get(type) ?? new Set<WorkerListener>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: WorkerListener): void {
		this.listeners.get(type)?.delete(listener);
	}

	postMessage(message: EditorBlockIndexWorkerRequest): void {
		this.posted.push(message);
	}

	terminate(): void {
		this.terminated = true;
	}

	emit(response: EditorBlockIndexWorkerResponse): void {
		const event = { data: response } as MessageEvent<unknown>;
		this.listeners.get("message")?.forEach((listener) => {
			listener(event);
		});
	}

	emitError(type: "error" | "messageerror"): void {
		const event = new Event(type);
		this.listeners.get(type)?.forEach((listener) => {
			listener(event);
		});
	}
}

const workerUrl =
	"https://example.test/wp-content/plugins/easymde/assets/build/editor-block-index-worker/assets/editor-block-index-worker-test.js";

function createAdapter() {
	FakeWorker.instances = [];
	return createBrowserEditorBlockIndexWorker({
		assetBaseUrl: "https://example.test/wp-content/plugins/easymde/",
		referenceLabelCaseFoldProfile: 14,
		Worker: FakeWorker,
		location: {
			href: "https://example.test/wp-admin/post.php",
			origin: "https://example.test",
		},
		workerUrl,
	});
}

async function firstWorker(): Promise<FakeWorker> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		const worker = FakeWorker.instances[0];
		if (worker) return worker;
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("test-worker-missing");
}

function signal(): AbortSignal {
	return new AbortController().signal;
}

function data(
	overrides: Partial<EditorMarkdownBlockIndexDataWithImages> = {},
): EditorMarkdownBlockIndexDataWithImages {
	return {
		blocks: [
			{
				editable: true,
				from: 0,
				kind: "paragraph",
				lineEnd: 0,
				lineStart: 0,
				to: 3,
			},
		],
		imageBlocks: [{ count: 0, firstImageIndex: 0, status: "ready" }],
		imageRanges: [],
		length: 3,
		linkCandidates: [],
		mathSpans: [],
		...overrides,
	};
}

function packedData(
	blockCount: number,
	sourceLength: number,
): EditorMarkdownBlockIndexPackedData {
	const blocks = new Int32Array(blockCount * 6);
	for (let index = 0; index < blockCount; index += 1) {
		const offset = index * 6;
		const from = index * 2;
		blocks[offset] = from;
		blocks[offset + 1] = 1 === blockCount ? sourceLength : from + 1;
		blocks[offset + 2] = index;
		blocks[offset + 3] = index;
		blocks[offset + 4] = 4;
		blocks[offset + 5] = 1;
	}
	const imageHeaders = new Int32Array(blockCount * 3);
	for (let index = 0; index < blockCount; index += 1) {
		imageHeaders[index * 3 + 2] = 0;
	}
	return {
		blockCount,
		blocks: blocks.buffer,
		format: "packed-v3",
		imageCount: 0,
		images: imageHeaders.buffer,
		length: sourceLength,
		linkCount: 0,
		links: new Int32Array().buffer,
		mathSpanCount: 0,
		mathSpans: new Int32Array().buffer,
	};
}
function packedFields(
	blockFields: ReadonlyArray<number>,
	mathFields: ReadonlyArray<number> = [],
	length = 3,
	imageFields: ReadonlyArray<number> = [],
	imageHeaderFields: ReadonlyArray<number> = [],
	linkFields: ReadonlyArray<number> = [],
): EditorMarkdownBlockIndexPackedData {
	const blockCount = blockFields.length / 6;
	const imageCount = imageFields.length / 2;
	const images = new Int32Array(blockCount * 3 + imageCount * 2);
	for (let index = 0; index < blockCount; index += 1) {
		images[index * 3 + 2] = 0;
	}
	imageHeaderFields.forEach((value, index) => {
		images[index] = value;
	});
	imageFields.forEach((value, index) => {
		images[blockCount * 3 + index] = value;
	});
	return {
		blockCount,
		blocks: Int32Array.from(blockFields).buffer,
		format: "packed-v3",
		imageCount,
		images: images.buffer,
		length,
		linkCount: linkFields.length / 6,
		links: Int32Array.from(linkFields).buffer,
		mathSpanCount: mathFields.length / 5,
		mathSpans: Int32Array.from(mathFields).buffer,
	};
}

function packedImageData(
	sourceLength: number,
	imageCount: number,
): EditorMarkdownBlockIndexPackedData {
	const blocks = Int32Array.from([0, sourceLength, 0, 0, 4, 1]);
	const images = new Int32Array(3 + imageCount * 2);
	images[1] = imageCount;
	for (let index = 0; index < imageCount; index += 1) {
		const offset = 3 + index * 2;
		images[offset] = index * 2;
		images[offset + 1] = index * 2 + 1;
	}
	return {
		blockCount: 1,
		blocks: blocks.buffer,
		format: "packed-v3",
		imageCount,
		images: images.buffer,
		length: sourceLength,
		linkCount: 0,
		links: new Int32Array().buffer,
		mathSpanCount: 0,
		mathSpans: new Int32Array().buffer,
	};
}

describe("createBrowserEditorBlockIndexWorker", () => {
	it("preserves the precise reference-profile-unavailable failure", async () => {
		const adapter = createAdapter();
		const pending = adapter.build({ generation: 1, revision: 2, source: "abc" }, signal());
		const worker = await firstWorker();
		worker.emit({ type: "error", generation: 1, revision: 2, code: "editor-block-index-reference-profile-unavailable" });
		await expect(pending).rejects.toThrow("editor-block-index-reference-profile-unavailable");
		expect(worker.terminated).toBe(true);
		adapter.dispose();
	});
	it("retains the validated profile when the caller mutates its options", async () => {
		FakeWorker.instances = [];
		const options = {
			assetBaseUrl: "https://example.test/wp-content/plugins/easymde/",
			referenceLabelCaseFoldProfile: 13 as ReferenceLabelCaseFoldProfile,
			Worker: FakeWorker,
			location: { href: "https://example.test/editor", origin: "https://example.test" },
			workerUrl,
		};
		const adapter = createBrowserEditorBlockIndexWorker(options);
		options.referenceLabelCaseFoldProfile = 17;
		const pending = adapter.build({ generation: 1, revision: 2, source: "abc" }, signal());
		const worker = await firstWorker();
		expect(worker.posted[0]?.referenceLabelCaseFoldProfile).toBe(13);
		worker.emit({ data: packedData(1, 3), generation: 1, revision: 2, type: "result" });
		await pending;
		adapter.dispose();
	});
	it.each([undefined, null, 12, 18, "14", true])("rejects invalid configured profile %#", (profile) => {
		expect(() => createBrowserEditorBlockIndexWorker({
			assetBaseUrl: "https://example.test/wp-content/plugins/easymde/",
			referenceLabelCaseFoldProfile: profile as ReferenceLabelCaseFoldProfile,
			Worker: FakeWorker,
			location: { href: "https://example.test/editor", origin: "https://example.test" },
			workerUrl,
		})).toThrow("editor-block-index-worker-profile-invalid");
	});

	it.each([11, 13, 14, 16, 17, "unsupported"] as const)("transports the configured reference fold profile %s", async (profile) => {
		FakeWorker.instances = [];
		const adapter = createBrowserEditorBlockIndexWorker({
			assetBaseUrl: "https://example.test/wp-content/plugins/easymde/",
			referenceLabelCaseFoldProfile: profile,
			Worker: FakeWorker,
			location: { href: "https://example.test/editor", origin: "https://example.test" },
			workerUrl,
		});
		const pending = adapter.build({ generation: 1, revision: 2, source: "abc" }, signal());
		const worker = await firstWorker();
		expect(worker.posted[0]?.referenceLabelCaseFoldProfile).toBe(profile);
		worker.emit({ data: packedData(1, 3), generation: 1, revision: 2, type: "result" });
		await pending;
		adapter.dispose();
	});
	it("posts the exact source request and returns data without echoing source", async () => {
		const adapter = createAdapter();
		const pending = adapter.build(
			{
				generation: 4,
				revision: 8,
				source: "abc",
			},
			signal(),
		);
		const worker = await firstWorker();

		expect(worker.posted).toEqual([
			{ generation: 4, revision: 8, source: "abc", type: "build", referenceLabelCaseFoldProfile: 14 },
		]);
		worker.emit({
			data: packedData(1, 3),
			generation: 4,
			revision: 8,
			type: "result",
		});

		await expect(pending).resolves.toEqual(data());
		expect(worker.terminated).toBe(true);
		adapter.dispose();
	});

	it("bounds source-byte validation before constructing a worker", async () => {
		const adapter = createAdapter();
		const source = "😀".repeat(
			Math.ceil(MAX_EDITOR_BLOCK_INDEX_SOURCE_BYTES / 4) + 1,
		);

		await expect(
			adapter.build({ generation: 1, revision: 1, source }, signal()),
		).rejects.toThrow("editor-block-index-source-too-large");
		expect(FakeWorker.instances).toHaveLength(0);
		adapter.dispose();
	});

	it("keeps a valid astral source under the byte bound while yielding", async () => {
		const adapter = createAdapter();
		const source = "😀".repeat(260_000);
		const pending = adapter.build(
			{ generation: 1, revision: 1, source },
			signal(),
		);
		const worker = await firstWorker();
		expect(worker.posted[0]).toEqual({
			generation: 1,
			referenceLabelCaseFoldProfile: 14,
			revision: 1,
			source,
			type: "build",
		});
		adapter.dispose();
		await expect(pending).rejects.toThrow("editor-block-index-disposed");
	});

	it("does not construct a worker after dispose during byte validation", async () => {
		const adapter = createAdapter();
		const pending = adapter.build(
			{ generation: 1, revision: 1, source: "x".repeat(1_000_000) },
			signal(),
		);
		adapter.dispose();

		await expect(pending).rejects.toThrow("editor-block-index-disposed");
		expect(FakeWorker.instances).toHaveLength(0);
	});

	it("honors abort during byte validation before worker construction", async () => {
		const adapter = createAdapter();
		const controller = new AbortController();
		const pending = adapter.build(
			{ generation: 1, revision: 1, source: "x".repeat(1_000_000) },
			controller.signal,
		);
		controller.abort();

		await expect(pending).rejects.toThrow("editor-block-index-cancelled");
		expect(FakeWorker.instances).toHaveLength(0);
		adapter.dispose();
	});

	it("does not let an older byte validation displace a newer request", async () => {
		const adapter = createAdapter();
		const first = adapter.build(
			{ generation: 1, revision: 1, source: "x".repeat(1_000_000) },
			signal(),
		);
		const second = adapter.build(
			{ generation: 2, revision: 2, source: "abc" },
			signal(),
		);
		const worker = await firstWorker();
		expect(worker.posted[0]).toEqual({
			generation: 2,
			referenceLabelCaseFoldProfile: 14,
			revision: 2,
			source: "abc",
			type: "build",
		});
		worker.emit({
			data: packedData(1, 3),
			generation: 2,
			revision: 2,
			type: "result",
		});

		await expect(first).rejects.toThrow("editor-block-index-stale");
		await expect(second).resolves.toEqual(data());
		adapter.dispose();
	});

	it("decodes a transferred packed result without returning the source", async () => {
		const adapter = createAdapter();
		const pending = adapter.build(
			{ generation: 4, revision: 8, source: "abc" },
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		worker.emit({
			data: packedData(1, 3),
			generation: 4,
			revision: 8,
			type: "result",
		});

		await expect(pending).resolves.toEqual(data());
		adapter.dispose();
	});

	it("round-trips the appended thematic-break kind through packed validation", async () => {
		const adapter = createAdapter();
		const source = "---";
		const pending = adapter.build(
			{ generation: 4, revision: 8, source },
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		worker.emit({
			data: packedFields([
				0,
				source.length,
				0,
				0,
				EDITOR_MARKDOWN_BLOCK_KIND_ORDER.indexOf("thematic-break"),
				1,
			]),
			generation: 4,
			revision: 8,
			type: "result",
		});

		await expect(pending).resolves.toEqual(
			data({
				blocks: [
					{
						editable: true,
						from: 0,
						kind: "thematic-break",
						lineEnd: 0,
						lineStart: 0,
						to: source.length,
					},
				],
				length: source.length,
			}),
		);
		adapter.dispose();
	});

	it("decodes image block headers and UTF-16 ranges atomically", async () => {
		const adapter = createAdapter();
		const source = "![x](y)";
		const pending = adapter.build(
			{ generation: 4, revision: 8, source },
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		worker.emit({
			data: packedFields(
				[0, source.length, 0, 0, 4, 1],
				[],
				source.length,
				[0, source.length],
				[0, 1, 0],
			),
			generation: 4,
			revision: 8,
			type: "result",
		});

		await expect(pending).resolves.toEqual(
			data({
				blocks: [
					{
						editable: true,
						from: 0,
						kind: "paragraph",
						lineEnd: 0,
						lineStart: 0,
						to: source.length,
					},
				],
				imageBlocks: [{ count: 1, firstImageIndex: 0, status: "ready" }],
				imageRanges: [{ from: 0, to: source.length }],
				length: source.length,
			}),
		);
		adapter.dispose();
	});

	it("decodes prepared link candidates from the packed result", async () => {
		const adapter = createAdapter();
		const source = "[caption](https://source.test)";
		const pending = adapter.build(
			{ generation: 4, revision: 8, source },
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		worker.emit({
			data: packedFields(
				[0, source.length, 0, 0, 4, 1],
				[],
				source.length,
				[],
				[],
				[0, source.length, 0, source.length, 0, 0],
			),
			generation: 4,
			revision: 8,
			type: "result",
		});

		await expect(pending).resolves.toEqual(
			data({
				blocks: [
					{
						editable: true,
						from: 0,
						kind: "paragraph",
						lineEnd: 0,
						lineStart: 0,
						to: source.length,
					},
				],
				length: source.length,
				linkCandidates: [
					{
						blockFrom: 0,
						blockTo: source.length,
						from: 0,
						kind: "link",
						reference: false,
						to: source.length,
					},
				],
			}),
		);
		adapter.dispose();
	});

	it.each([
		["a candidate outside its declared block", "abc", [0, 3, 0, 1, 0, 0]],
		["an unknown link kind code", "abc", [0, 3, 0, 3, 3, 0]],
		["a non boolean reference marker", "abc", [0, 3, 0, 3, 0, 2]],
		[
			"an overlapping prepared candidate range",
			"abcdefghij",
			[0, 10, 0, 10, 0, 0, 4, 6, 0, 10, 0, 0],
		],
	])("rejects %s in the packed result", async (_label, source, linkFields) => {
		const adapter = createAdapter();
		const pending = adapter.build(
			{ generation: 4, revision: 8, source },
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		worker.emit({
			data: packedFields(
				[0, source.length, 0, 0, 4, 1],
				[],
				source.length,
				[],
				[],
				linkFields,
			),
			generation: 4,
			revision: 8,
			type: "result",
		});

		await expect(pending).rejects.toThrow("editor-block-index-result-invalid");
		adapter.dispose();
	});

	it("rejects decreasing prepared candidate starts", async () => {
		const adapter = createAdapter();
		const source = "abcd";
		const pending = adapter.build(
			{ generation: 4, revision: 8, source },
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		worker.emit({
			data: packedFields(
				[0, source.length, 0, 0, 4, 1],
				[],
				source.length,
				[],
				[],
				[2, 4, 0, 4, 0, 0, 0, 2, 0, 4, 0, 0],
			),
			generation: 4,
			revision: 8,
			type: "result",
		});

		await expect(pending).rejects.toThrow("editor-block-index-result-invalid");
		adapter.dispose();
	});

	it("rejects a packed result above the prepared link limit", async () => {
		const adapter = createAdapter();
		const source = "abc";
		const pending = adapter.build(
			{ generation: 4, revision: 8, source },
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		worker.emit({
			data: {
				...packedFields([0, source.length, 0, 0, 4, 1], [], source.length),
				linkCount: MAX_EDITOR_BLOCK_INDEX_LINKS + 1,
			},
			generation: 4,
			revision: 8,
			type: "result",
		});

		await expect(pending).rejects.toThrow(
			"editor-block-index-result-too-large",
		);
		adapter.dispose();
	});

	it("cancels while packed validation is yielding", async () => {
		const adapter = createAdapter();
		const controller = new AbortController();
		const source = "x\n".repeat(100_000);
		const pending = adapter.build(
			{ generation: 1, revision: 1, source },
			controller.signal,
		);
		const worker = await firstWorker();
		worker.emit({
			data: packedData(100_000, source.length),
			generation: 1,
			revision: 1,
			type: "result",
		});
		controller.abort();

		await expect(pending).rejects.toThrow("editor-block-index-cancelled");
		expect(worker.terminated).toBe(true);
		adapter.dispose();
	});

	it("cancels while image range validation is yielding", async () => {
		const adapter = createAdapter();
		const controller = new AbortController();
		const source = "x ".repeat(100_000);
		const pending = adapter.build(
			{ generation: 1, revision: 1, source },
			controller.signal,
		);
		const worker = await firstWorker();
		worker.emit({
			data: packedImageData(source.length, 100_000),
			generation: 1,
			revision: 1,
			type: "result",
		});
		await Promise.resolve();
		controller.abort();

		await expect(pending).rejects.toThrow("editor-block-index-cancelled");
		expect(worker.terminated).toBe(true);
		adapter.dispose();
	});

	it("rejects image provenance inside a code block", async () => {
		const adapter = createAdapter();
		const source = "```\n![x](y)\n```";
		const imageStart = source.indexOf("![");
		const imageEnd = source.indexOf(")", imageStart) + 1;
		const pending = adapter.build(
			{ generation: 1, revision: 1, source },
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		worker.emit({
			data: packedFields(
				[0, source.length, 0, 2, 0, 1],
				[],
				source.length,
				[imageStart, imageEnd],
				[0, 1, 0],
			),
			generation: 1,
			revision: 1,
			type: "result",
		});

		await expect(pending).rejects.toThrow("editor-block-index-result-invalid");
		adapter.dispose();
	});

	it("rejects math provenance inside a fenced code block", async () => {
		const adapter = createAdapter();
		const source = "```\n$x$\n```";
		const mathStart = source.indexOf("$");
		const mathEnd = mathStart + 3;
		const pending = adapter.build(
			{ generation: 1, revision: 1, source },
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		worker.emit({
			data: packedFields(
				[0, source.length, 0, 2, 0, 1],
				[mathStart, mathEnd, mathStart + 1, mathEnd - 1, 0],
				source.length,
			),
			generation: 1,
			revision: 1,
			type: "result",
		});

		await expect(pending).rejects.toThrow("editor-block-index-result-invalid");
		adapter.dispose();
	});

	it.each([
		["length mismatch", packedData(1, 2)],
		["overlapping blocks", packedFields([0, 2, 0, 0, 4, 1, 1, 3, 0, 0, 4, 1])],
		["invalid enum", packedFields([0, 3, 0, 0, 99, 1])],
		["out-of-bounds math span", packedFields([], [0, 5, 1, 4, 0])],
		[
			"invalid image status",
			packedFields([0, 3, 0, 0, 4, 1], [], 3, [0, 3], [0, 1, 9]),
		],
		[
			"unavailable image block with a count",
			packedFields([0, 3, 0, 0, 4, 1], [], 3, [0, 3], [0, 1, 1]),
		],
		[
			"non-contiguous image prefix",
			packedFields([0, 3, 0, 0, 4, 1], [], 3, [0, 3], [1, 0, 0]),
		],
		[
			"out-of-bounds image range",
			packedFields([0, 3, 0, 0, 4, 1], [], 3, [1, 4], [0, 1, 0]),
		],
		[
			"image range crossing its block",
			packedFields(
				[0, 3, 0, 0, 4, 1, 3, 6, 0, 0, 4, 1],
				[],
				6,
				[2, 4],
				[0, 1, 0, 1, 0, 0],
			),
		],
		[
			"overlapping image ranges",
			packedFields([0, 3, 0, 0, 4, 1], [], 3, [0, 2, 1, 3], [0, 2, 0]),
		],
		[
			"image buffer byte length mismatch",
			{ ...packedData(1, 3), images: new Int32Array(2).buffer },
		],
	])(
		"rejects %s worker data with a stable error and no source",
		async (_name, result) => {
			const adapter = createAdapter();
			const source = "abc";
			const pending = adapter.build(
				{ generation: 1, revision: 1, source },
				signal(),
			);
			const worker = FakeWorker.instances[0];
			if (!worker) throw new Error("test-worker-missing");
			worker.emit({ data: result, generation: 1, revision: 1, type: "result" });

			await expect(pending).rejects.toThrow(
				"editor-block-index-result-invalid",
			);
			await expect(pending).rejects.not.toThrow(source);
			adapter.dispose();
		},
	);

	it("unpacks textless 3-int table-cell link context locally and rejects tampered or stale-text payloads", async () => {
		const source = "| [a](/x\\|y) $m$ | [b](/u\\|v) |\n| - | - |";
		const messages: EditorBlockIndexWorkerResponse[] = [];
		createEditorBlockIndexWorkerHandler((message) => messages.push(message))({
			data: { generation: 1, revision: 1, source, type: "build", referenceLabelCaseFoldProfile: 14 },
		});
		const packed = messages[0];
		if ("result" !== packed?.type) throw new Error("result-missing");
		const wire = packed.data;
		expect(wire.linkTableCellCount).toBe(2);
		expect(Object.keys(wire)).toHaveLength(12);
		if (!wire.linkTableCells) throw new Error("table-cells-missing");
		expect(wire.linkTableCells.byteLength).toBe(2 * 3 * 4);
		const run = async (payload: unknown) => {
			const adapter = createAdapter();
			const pending = adapter.build({ generation: 1, revision: 1, source }, signal());
			const worker = await firstWorker();
			worker.emit({
				data: payload as EditorMarkdownBlockIndexPackedData,
				generation: 1,
				revision: 1,
				type: "result",
			});
			try {
				return await pending;
			} finally {
				adapter.dispose();
			}
		};
		const direct = createEditorMarkdownBlockIndex(source, { referenceLabelCaseFoldProfile: 14 });
		const decoded = await run(wire);
		expect(decoded.linkTableCells).toEqual(direct.linkTableCells);
		expect(decoded.linkCandidates).toEqual(direct.linkCandidates);

		const { linkTableCells: _cells, ...countOnly } = wire;
		const { linkTableCellCount: _count, ...bufferOnly } = wire;
		const mutateWords = (edit: (words: Int32Array) => void) => {
			const words = Int32Array.from(new Int32Array(wire.linkTableCells as ArrayBuffer));
			edit(words);
			return { ...wire, linkTableCells: words.buffer };
		};
		for (const malformed of [
			countOnly,
			bufferOnly,
			{ ...wire, linkTableCellCount: 3 },
			{ ...wire, linkTableCellTexts: ["[b](/u|v)"] },
			{ ...wire, linkTableCellTexts: [12345, { evil: 1 }] },
			{ ...wire, linkTableCellTexts: ["x".repeat(10_000_000)] },
			{ ...wire, extra: 1 },
			mutateWords((words) => {
				words[0] = (words[0] ?? 0) + 1;
			}),
			// Tamper cell a to point at cell b or stretch across `|`
			mutateWords((words) => {
				words[1] = words[4] ?? 0;
				words[2] = words[5] ?? 0;
			}),
			mutateWords((words) => {
				words[2] = words[5] ?? 0;
			}),
			// Truncate cell a inside a real table cell (Round 36 Track A #1)
			mutateWords((words) => {
				words[1] = words[0] ?? 0;
			}),
			mutateWords((words) => {
				words[2] = (words[2] ?? 0) - 1;
			}),
			// Duplicate candidateFrom
			mutateWords((words) => {
				words[3] = words[0] ?? 0;
			}),
		]) {
			await expect(run(malformed)).rejects.toThrow("editor-block-index-result-invalid");
		}
	});

	it("rejects forged table cells on plain paragraphs and cross-block invalid math spans, while accepting real cross-block multiline paren-math table cells (Round 36 Track A #1, Track B #3)", async () => {
		const runWithPayload = async (source: string, payload: unknown) => {
			const adapter = createAdapter();
			const pending = adapter.build({ generation: 1, revision: 1, source }, signal());
			const worker = await firstWorker();
			worker.emit({
				data: payload as EditorMarkdownBlockIndexPackedData,
				generation: 1,
				revision: 1,
				type: "result",
			});
			try {
				return await pending;
			} finally {
				adapter.dispose();
			}
		};

		// Track A #1: forged `[0, 0, 11]` table cell on plain paragraph `"[a](/x\\\\|y)"`
		const plain = "[a](/x\\\\|y)";
		const plainMessages: EditorBlockIndexWorkerResponse[] = [];
		createEditorBlockIndexWorkerHandler((message) => plainMessages.push(message))({
			data: { generation: 1, revision: 1, source: plain, type: "build", referenceLabelCaseFoldProfile: 14 },
		});
		const plainPacked = plainMessages[0];
		if ("result" !== plainPacked?.type) throw new Error("plain-result-missing");
		await expect(
			runWithPayload(plain, {
				...plainPacked.data,
				linkTableCellCount: 1,
				linkTableCells: Int32Array.from([0, 0, plain.length]).buffer,
			}),
		).rejects.toThrow("editor-block-index-result-invalid");

		// Cross-block tampered `$...$` or `\(...\)` spanning a code/unavailable block stays rejected
		const codeCross = "\\(a\n```\nc\n```\nb\\)";
		await expect(
			runWithPayload(
				codeCross,
				packedFields(
					[0, 3, 0, 0, 4, 1, 4, 13, 1, 3, 0, 1, 14, 17, 4, 4, 4, 1],
					[0, codeCross.length, 2, codeCross.length - 2, 0],
					codeCross.length,
				),
			),
		).rejects.toThrow("editor-block-index-result-invalid");
		const dollarCross = "$a\n\nb$";
		await expect(
			runWithPayload(
				dollarCross,
				packedFields(
					[0, 2, 0, 0, 4, 1, 4, 6, 2, 2, 4, 1],
					[0, dollarCross.length, 1, dollarCross.length - 1, 0],
					dollarCross.length,
				),
			),
		).rejects.toThrow("editor-block-index-result-invalid");

		// Track B Finding 3: all 5 cross-block multiline `\(...\)` PHP table-cell inputs
		for (const source of [
			'[r]: /u "\\(a"\nb\\) [x][a\\|b] | c |\n| --- | --- |\n\n[a|b]: https://example.com/ok',
			"| [x][a\\|b] \\(m\n\nn\\) | c |\n| --- | --- |\n\n[a|b]: https://example.com/ok",
			"| [x](https://example.com/1\\\\|2) \\(m\n\nn\\) | c |\n| --- | --- |",
			"| [x](https://example.com/1\\\\|2) \\(m\n# h\nn\\) | c |\n| --- | --- |",
			'[r]: /u "\\(a"\nb\\) [x](https://example.com/1\\\\|2) | c |\n| --- | --- |',
		]) {
			const messages: EditorBlockIndexWorkerResponse[] = [];
			createEditorBlockIndexWorkerHandler((message) => messages.push(message))({
				data: { generation: 1, revision: 1, source, type: "build", referenceLabelCaseFoldProfile: 14 },
			});
			const packed = messages[0];
			if ("result" !== packed?.type) throw new Error("packed-missing");
			expect(packed.data.linkTableCellCount, source).toBe(1);
			const direct = createEditorMarkdownBlockIndex(source, { referenceLabelCaseFoldProfile: 14 });
			const decoded = await runWithPayload(source, packed.data);
			expect(decoded.linkTableCells, source).toEqual(direct.linkTableCells);
			expect(decoded.linkCandidates, source).toEqual(direct.linkCandidates);
		}
	});

	it("rejects an oversized result with a distinct bounded-result error", async () => {
		const adapter = createAdapter();
		const pending = adapter.build(
			{
				generation: 1,
				revision: 1,
				source: "abc",
			},
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		worker.emit({
			data: packedData(MAX_EDITOR_BLOCK_INDEX_BLOCKS + 1, 3),
			generation: 1,
			revision: 1,
			type: "result",
		});

		await expect(pending).rejects.toThrow(
			"editor-block-index-result-too-large",
		);
		adapter.dispose();
	});

	it("rejects an oversized image result with a distinct bounded-result error", async () => {
		const adapter = createAdapter();
		const pending = adapter.build(
			{ generation: 1, revision: 1, source: "abc" },
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		const result = packedData(1, 3);
		worker.emit({
			data: {
				...result,
				imageCount: MAX_EDITOR_BLOCK_INDEX_IMAGES + 1,
			},
			generation: 1,
			revision: 1,
			type: "result",
		});

		await expect(pending).rejects.toThrow(
			"editor-block-index-result-too-large",
		);
		adapter.dispose();
	});

	it("rejects a stale response and terminates the old worker before rebuilding", async () => {
		const adapter = createAdapter();
		const first = adapter.build(
			{ generation: 1, revision: 1, source: "one" },
			signal(),
		);
		const oldWorker = FakeWorker.instances[0];
		if (!oldWorker) throw new Error("test-worker-missing");
		const second = adapter.build(
			{ generation: 2, revision: 2, source: "two" },
			signal(),
		);
		const nextWorker = FakeWorker.instances[1];
		if (!nextWorker) throw new Error("test-worker-missing");

		expect(oldWorker.terminated).toBe(true);
		await expect(first).rejects.toThrow("editor-block-index-stale");
		nextWorker.emit({
			data: packedData(1, 3),
			generation: 2,
			revision: 2,
			type: "result",
		});
		await expect(second).resolves.toEqual(data());
		adapter.dispose();
	});

	it("cancels while packed validation is yielding", async () => {
		const adapter = createAdapter();
		const controller = new AbortController();
		const source = "x\n".repeat(100_000);
		const pending = adapter.build(
			{ generation: 1, revision: 1, source },
			controller.signal,
		);
		const worker = await firstWorker();
		worker.emit({
			data: packedData(100_000, source.length),
			generation: 1,
			revision: 1,
			type: "result",
		});
		controller.abort();

		await expect(pending).rejects.toThrow("editor-block-index-cancelled");
		expect(worker.terminated).toBe(true);
		adapter.dispose();
	});

	it("rejects a packed result as stale when a newer build supersedes validation", async () => {
		const adapter = createAdapter();
		const source = "x\n".repeat(100_000);
		const first = adapter.build(
			{ generation: 1, revision: 1, source },
			signal(),
		);
		const oldWorker = await firstWorker();
		oldWorker.emit({
			data: packedData(100_000, source.length),
			generation: 1,
			revision: 1,
			type: "result",
		});

		const second = adapter.build(
			{ generation: 2, revision: 2, source: "abc" },
			signal(),
		);
		const nextWorker = FakeWorker.instances[1];
		if (!nextWorker) throw new Error("test-worker-missing");
		nextWorker.emit({
			data: packedData(1, 3),
			generation: 2,
			revision: 2,
			type: "result",
		});

		await expect(first).rejects.toThrow("editor-block-index-stale");
		await expect(second).resolves.toEqual(data());
		adapter.dispose();
	});

	it("cancels with AbortSignal and cleans up the worker", async () => {
		const adapter = createAdapter();
		const controller = new AbortController();
		const pending = adapter.build(
			{ generation: 1, revision: 1, source: "abc" },
			controller.signal,
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		controller.abort();

		await expect(pending).rejects.toThrow("editor-block-index-cancelled");
		expect(worker.terminated).toBe(true);
		adapter.dispose();
	});

	it("times out a worker that never replies without retrying or parsing on the main thread", async () => {
		vi.useFakeTimers();
		FakeWorker.instances = [];
		const adapter = createBrowserEditorBlockIndexWorker({
			assetBaseUrl: "https://example.test/wp-content/plugins/easymde/",
			referenceLabelCaseFoldProfile: 14,
			Worker: FakeWorker,
			location: {
				href: "https://example.test/wp-admin/post.php",
				origin: "https://example.test",
			},
			timeoutMs: 25,
			workerUrl,
		});
		const pending = adapter.build(
			{
				generation: 1,
				revision: 1,
				source: "abc",
			},
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		vi.advanceTimersByTime(25);

		await expect(pending).rejects.toThrow("editor-block-index-worker-timeout");
		expect(worker.terminated).toBe(true);
		expect(FakeWorker.instances).toHaveLength(1);
		adapter.dispose();
		vi.useRealTimers();
	});

	it("maps construction, error and messageerror failures to stable codes", async () => {
		const Constructor = vi.fn(() => {
			throw new Error("private browser detail");
		});
		const invalid = createBrowserEditorBlockIndexWorker({
			assetBaseUrl: "https://example.test/wp-content/plugins/easymde/",
			referenceLabelCaseFoldProfile: 14,
			Worker: Constructor as unknown as typeof FakeWorker,
			location: {
				href: "https://example.test/editor",
				origin: "https://example.test",
			},
			workerUrl,
		});
		await expect(
			invalid.build({ generation: 1, revision: 1, source: "abc" }, signal()),
		).rejects.toThrow("editor-block-index-worker-construction-failed");

		const adapter = createAdapter();
		const pending = adapter.build(
			{
				generation: 1,
				revision: 1,
				source: "abc",
			},
			signal(),
		);
		const worker = FakeWorker.instances[0];
		if (!worker) throw new Error("test-worker-missing");
		worker.emitError("error");
		await expect(pending).rejects.toThrow("editor-block-index-worker-failed");

		const next = adapter.build(
			{ generation: 2, revision: 2, source: "abc" },
			signal(),
		);
		const nextWorker = FakeWorker.instances[1];
		if (!nextWorker) throw new Error("test-worker-missing");
		nextWorker.emitError("messageerror");
		await expect(next).rejects.toThrow(
			"editor-block-index-worker-message-invalid",
		);
		adapter.dispose();
	});

	it("accepts a same-origin plugin subdirectory URL with a version query", () => {
		const adapter = createBrowserEditorBlockIndexWorker({
			assetBaseUrl: "https://example.test/subdir/wp-content/plugins/easymde/",
			referenceLabelCaseFoldProfile: 14,
			location: {
				href: "https://example.test/subdir/wp-admin/post.php",
				origin: "https://example.test",
			},
			workerUrl:
				"https://example.test/subdir/wp-content/plugins/easymde/assets/build/editor-block-index-worker/assets/editor-block-index-worker-test.js?ver=abcdef0123456789",
			Worker: FakeWorker,
		});
		adapter.dispose();
	});

	it.each([
		"https://other.example/assets/editor-block-index-worker-test.js",
		"data:text/javascript,postMessage(1)",
		"https://example.test/wp-content/plugins/easymde/assets/build/other.js",
		"https://example.test/wp-content/plugins/other/assets/build/editor-block-index-worker/assets/editor-block-index-worker-test.js",
		"https://example.test/wp-content/plugins/easymdeX/assets/build/editor-block-index-worker/assets/editor-block-index-worker-test.js",
		"https://example.test/wp-content/plugins/easymde/assets/build/editor-block-index-worker%2Fassets/editor-block-index-worker-test.js",
		"https://example.test/wp-content/plugins/easymde/assets/build/editor-block-index-worker%5Cassets/editor-block-index-worker-test.js",
	])("rejects a non-manifest same-origin worker URL: %s", (unsafeUrl) => {
		expect(() =>
			createBrowserEditorBlockIndexWorker({
				assetBaseUrl: "https://example.test/wp-content/plugins/easymde/",
				referenceLabelCaseFoldProfile: 14,
				Worker: FakeWorker,
				location: {
					href: "https://example.test/editor",
					origin: "https://example.test",
				},
				workerUrl: unsafeUrl,
			}),
		).toThrow("editor-block-index-worker-url-invalid");
	});

	it("rejects a worker URL when the configured asset base is remote", () => {
		expect(() =>
			createBrowserEditorBlockIndexWorker({
				assetBaseUrl: "https://cdn.example/easymde/",
				referenceLabelCaseFoldProfile: 14,
				Worker: FakeWorker,
				location: {
					href: "https://example.test/editor",
					origin: "https://example.test",
				},
				workerUrl,
			}),
		).toThrow("editor-block-index-worker-url-invalid");
	});
});
