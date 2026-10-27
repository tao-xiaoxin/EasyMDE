import {
	EDITOR_BLOCK_INDEX_IMAGE_STATUS_READY,
	EDITOR_BLOCK_INDEX_IMAGE_STATUS_UNAVAILABLE,
	EDITOR_BLOCK_INDEX_LINK_KIND_AUTOLINK,
	EDITOR_BLOCK_INDEX_LINK_KIND_LINK,
	EDITOR_BLOCK_INDEX_PACKED_BLOCK_FIELDS,
	EDITOR_BLOCK_INDEX_PACKED_IMAGE_BLOCK_FIELDS,
	EDITOR_BLOCK_INDEX_PACKED_IMAGE_RANGE_FIELDS,
	EDITOR_BLOCK_INDEX_PACKED_LINK_FIELDS,
	EDITOR_BLOCK_INDEX_PACKED_MATH_FIELDS,
	EDITOR_MARKDOWN_BLOCK_KIND_ORDER,
	type EditorBlockIndexWorkerData,
	type EditorBlockIndexWorkerRequest,
	type EditorBlockIndexWorkerResponse,
	MAX_EDITOR_BLOCK_INDEX_SOURCE_BYTES,
} from "../contracts/ports/editor-block-index-port";
import { createEditorMarkdownBlockIndex } from "../features/editor-context-menu/editor-markdown-block-index";

type WorkerMessage = Readonly<{ data: unknown }>;
export type EditorBlockIndexWorkerScope = Readonly<{
	addEventListener: (
		type: "message",
		listener: (event: WorkerMessage) => void,
	) => void;
	postMessage: (
		message: EditorBlockIndexWorkerResponse,
		transfer?: Transferable[],
	) => void;
}>;

export type EditorBlockIndexWorkerBuildResult = Readonly<{
	data: EditorBlockIndexWorkerData;
	transfer: ArrayBuffer[];
}>;

function record(value: unknown): Record<string, unknown> | null {
	return value && "object" === typeof value && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function safeInteger(value: unknown): value is number {
	return "number" === typeof value && Number.isSafeInteger(value) && value >= 0;
}

function sourceByteLength(source: string): number {
	let bytes = 0;
	for (let index = 0; index < source.length; index += 1) {
		const codePoint = source.codePointAt(index) ?? 0;
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

function isBuildRequest(
	value: unknown,
): value is EditorBlockIndexWorkerRequest {
	const request = record(value);
	return Boolean(
		request &&
			4 === Object.keys(request).length &&
			"build" === request.type &&
			safeInteger(request.generation) &&
			safeInteger(request.revision) &&
			"string" === typeof request.source,
	);
}

function dataWithoutSource(source: string): EditorBlockIndexWorkerBuildResult {
	const parsedIndex = createEditorMarkdownBlockIndex(source);
	const linkCandidates = parsedIndex.linkCandidates;
	if (!linkCandidates) throw new Error("editor-block-index-link-data-invalid");
	const blocks = new Int32Array(
		parsedIndex.blocks.length * EDITOR_BLOCK_INDEX_PACKED_BLOCK_FIELDS,
	);
	parsedIndex.blocks.forEach((block, blockIndex) => {
		const offset = blockIndex * EDITOR_BLOCK_INDEX_PACKED_BLOCK_FIELDS;
		const kind = EDITOR_MARKDOWN_BLOCK_KIND_ORDER.indexOf(block.kind);
		if (kind < 0) throw new Error("editor-block-index-kind-invalid");
		blocks[offset] = block.from;
		blocks[offset + 1] = block.to;
		blocks[offset + 2] = block.lineStart;
		blocks[offset + 3] = block.lineEnd;
		blocks[offset + 4] = kind;
		blocks[offset + 5] = block.editable ? 1 : 0;
	});
	const mathSpans = new Int32Array(
		parsedIndex.mathSpans.length * EDITOR_BLOCK_INDEX_PACKED_MATH_FIELDS,
	);
	parsedIndex.mathSpans.forEach((span, mathIndex) => {
		const offset = mathIndex * EDITOR_BLOCK_INDEX_PACKED_MATH_FIELDS;
		mathSpans[offset] = span.from;
		mathSpans[offset + 1] = span.to;
		mathSpans[offset + 2] = span.bodyFrom;
		mathSpans[offset + 3] = span.bodyTo;
		mathSpans[offset + 4] = span.displayMode ? 1 : 0;
	});
	const images = new Int32Array(
		parsedIndex.blocks.length * EDITOR_BLOCK_INDEX_PACKED_IMAGE_BLOCK_FIELDS +
			parsedIndex.imageRanges.length *
				EDITOR_BLOCK_INDEX_PACKED_IMAGE_RANGE_FIELDS,
	);
	let imageIndex = 0;
	parsedIndex.imageBlocks.forEach((block, blockIndex) => {
		if (
			!Number.isSafeInteger(block.firstImageIndex) ||
			!Number.isSafeInteger(block.count) ||
			block.firstImageIndex !== imageIndex ||
			block.firstImageIndex < 0 ||
			block.count < 0 ||
			block.firstImageIndex + block.count > parsedIndex.imageRanges.length ||
			("unavailable" === block.status && 0 !== block.count) ||
			("ready" !== block.status && "unavailable" !== block.status)
		) {
			throw new Error("editor-block-index-image-data-invalid");
		}
		const offset = blockIndex * EDITOR_BLOCK_INDEX_PACKED_IMAGE_BLOCK_FIELDS;
		images[offset] = block.firstImageIndex;
		images[offset + 1] = block.count;
		images[offset + 2] =
			"ready" === block.status
				? EDITOR_BLOCK_INDEX_IMAGE_STATUS_READY
				: EDITOR_BLOCK_INDEX_IMAGE_STATUS_UNAVAILABLE;
		imageIndex += block.count;
	});
	if (imageIndex !== parsedIndex.imageRanges.length) {
		throw new Error("editor-block-index-image-data-invalid");
	}
	parsedIndex.imageRanges.forEach((range, imageRangeIndex) => {
		if (
			!Number.isSafeInteger(range.from) ||
			!Number.isSafeInteger(range.to) ||
			range.from < 0 ||
			range.from >= range.to ||
			range.to > source.length
		) {
			throw new Error("editor-block-index-image-data-invalid");
		}
		const offset =
			parsedIndex.blocks.length * EDITOR_BLOCK_INDEX_PACKED_IMAGE_BLOCK_FIELDS +
			imageRangeIndex * EDITOR_BLOCK_INDEX_PACKED_IMAGE_RANGE_FIELDS;
		images[offset] = range.from;
		images[offset + 1] = range.to;
	});
	const links = new Int32Array(
		linkCandidates.length * EDITOR_BLOCK_INDEX_PACKED_LINK_FIELDS,
	);
	linkCandidates.forEach((candidate, candidateIndex) => {
		const offset = candidateIndex * EDITOR_BLOCK_INDEX_PACKED_LINK_FIELDS;
		const kind =
			"autolink" === candidate.kind
				? EDITOR_BLOCK_INDEX_LINK_KIND_AUTOLINK
				: "link" === candidate.kind
					? EDITOR_BLOCK_INDEX_LINK_KIND_LINK
					: -1;
		if (
			kind < 0 ||
			"boolean" !== typeof candidate.reference ||
			!Number.isSafeInteger(candidate.from) ||
			!Number.isSafeInteger(candidate.to) ||
			!Number.isSafeInteger(candidate.blockFrom) ||
			!Number.isSafeInteger(candidate.blockTo) ||
			candidate.from < candidate.blockFrom ||
			candidate.from >= candidate.to ||
			candidate.to > candidate.blockTo ||
			candidate.blockTo > source.length
		) {
			throw new Error("editor-block-index-link-data-invalid");
		}
		links[offset] = candidate.from;
		links[offset + 1] = candidate.to;
		links[offset + 2] = candidate.blockFrom;
		links[offset + 3] = candidate.blockTo;
		links[offset + 4] = kind;
		links[offset + 5] = candidate.reference ? 1 : 0;
	});
	return {
		data: {
			blockCount: parsedIndex.blocks.length,
			blocks: blocks.buffer,
			format: "packed-v3",
			imageCount: parsedIndex.imageRanges.length,
			images: images.buffer,
			length: parsedIndex.length,
			linkCount: linkCandidates.length,
			links: links.buffer,
			mathSpanCount: parsedIndex.mathSpans.length,
			mathSpans: mathSpans.buffer,
		},
		transfer: [blocks.buffer, mathSpans.buffer, images.buffer, links.buffer],
	};
}

export type EditorBlockIndexWorkerBuild = (
	source: string,
) => EditorBlockIndexWorkerBuildResult;

export function createEditorBlockIndexWorkerHandler(
	postMessage: (
		message: EditorBlockIndexWorkerResponse,
		transfer?: Transferable[],
	) => void,
	build: EditorBlockIndexWorkerBuild = dataWithoutSource,
): (event: WorkerMessage) => void {
	return ({ data }): void => {
		const candidate = record(data);
		if (
			candidate &&
			"build" === candidate.type &&
			safeInteger(candidate.generation) &&
			safeInteger(candidate.revision) &&
			"string" === typeof candidate.source &&
			sourceByteLength(candidate.source) > MAX_EDITOR_BLOCK_INDEX_SOURCE_BYTES
		) {
			postMessage({
				code: "editor-block-index-source-too-large",
				generation: candidate.generation,
				revision: candidate.revision,
				type: "error",
			});
			return;
		}
		if (!isBuildRequest(data)) {
			postMessage({
				code: "editor-block-index-worker-request-invalid",
				type: "error",
			});
			return;
		}
		try {
			const result = build(data.source);
			postMessage(
				{
					data: result.data,
					generation: data.generation,
					revision: data.revision,
					type: "result",
				},
				result.transfer,
			);
		} catch {
			postMessage({
				code: "editor-block-index-build-failed",
				generation: data.generation,
				revision: data.revision,
				type: "error",
			});
		}
	};
}

export function registerEditorBlockIndexWorkerScope(
	scope: EditorBlockIndexWorkerScope,
	build: EditorBlockIndexWorkerBuild = dataWithoutSource,
): void {
	scope.addEventListener(
		"message",
		createEditorBlockIndexWorkerHandler(
			(message, transfer) => scope.postMessage(message, transfer),
			build,
		),
	);
}

if (import.meta.env.MODE !== "test") {
	registerEditorBlockIndexWorkerScope(
		globalThis as unknown as EditorBlockIndexWorkerScope,
	);
}
