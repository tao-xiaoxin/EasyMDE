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
	type EditorBlockIndexWorkerRequest,
	type EditorMarkdownBlockIndexBuildInput,
	type EditorMarkdownBlockIndexDataWithImages,
	type EditorMarkdownBlockIndexFailureCode,
	type EditorMarkdownImageBlock,
	type EditorMarkdownImageBlockStatus,
	type EditorMarkdownImageRange,
	type EditorMarkdownLinkCandidate,
	type EditorMarkdownLinkCandidateKind,
	type EditorMarkdownMathSpan,
	type EditorMarkdownSourceBlock,
	MAX_EDITOR_BLOCK_INDEX_BLOCKS,
	MAX_EDITOR_BLOCK_INDEX_IMAGES,
	MAX_EDITOR_BLOCK_INDEX_LINKS,
	MAX_EDITOR_BLOCK_INDEX_MATH_SPANS,
	MAX_EDITOR_BLOCK_INDEX_SOURCE_BYTES,
	type ReferenceLabelCaseFoldProfile,
} from "../../../contracts/ports/editor-block-index-port";

const VALIDATION_SLICE_MS = 4;
const VALIDATION_FIRST_BATCH_SIZE = 4096;

const FAILURE_CODES = new Set<EditorMarkdownBlockIndexFailureCode>([
	"editor-block-index-build-failed",
	"editor-block-index-reference-profile-unavailable",
	"editor-block-index-source-too-large",
	"editor-block-index-worker-profile-invalid",
	"editor-block-index-worker-request-invalid",
]);

type DataValidation =
	| Readonly<{ status: "cancelled" | "invalid" | "too-large" }>
	| Readonly<{
			status: "valid";
			value: EditorMarkdownBlockIndexDataWithImages;
	  }>;

type ValidationPhaseResult<T> =
	| Readonly<{ status: "cancelled" | "invalid" }>
	| Readonly<{ status: "valid"; value: T }>;

type ValidationBudget = Readonly<{
	cancelled: () => boolean;
	checkpoint: () => Promise<boolean>;
	resetPhase: () => void;
	shouldYield: () => boolean;
	shouldYieldTime: () => boolean;
}>;

type SourceByteLength = number | Promise<number>;

type SourceByteSlice = Readonly<{
	bytes: number;
	done: boolean;
	nextIndex: number;
}>;

export function failure(code: EditorMarkdownBlockIndexFailureCode): Error {
	return new Error(code);
}

export function record(value: unknown): Record<string, unknown> | null {
	return value && "object" === typeof value && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function safeInteger(value: unknown): value is number {
	return "number" === typeof value && Number.isSafeInteger(value) && value >= 0;
}

function now(): number {
	return "function" === typeof globalThis.performance?.now
		? globalThis.performance.now()
		: Date.now();
}

function yieldValidation(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function createValidationBudget(cancelled: () => boolean): ValidationBudget {
	let sliceStarted = now();
	let processed = 0;
	let yielded = false;

	return {
		cancelled,
		resetPhase(): void {
			sliceStarted = now();
			processed = 0;
			yielded = false;
		},
		shouldYield(): boolean {
			processed += 1;
			return (
				now() - sliceStarted >= VALIDATION_SLICE_MS ||
				(!yielded && processed >= VALIDATION_FIRST_BATCH_SIZE)
			);
		},
		shouldYieldTime(): boolean {
			return now() - sliceStarted >= VALIDATION_SLICE_MS;
		},
		async checkpoint(): Promise<boolean> {
			await yieldValidation();
			sliceStarted = now();
			yielded = true;
			return !cancelled();
		},
	};
}

function utf8CodePointByteLength(codePoint: number): number {
	if (codePoint <= 0x7f) return 1;
	if (codePoint <= 0x7ff) return 2;
	if (codePoint <= 0xffff) return 3;
	return 4;
}

function measureSourceByteSlice(
	source: string,
	start: number,
	initialBytes: number,
	signal: AbortSignal,
): SourceByteSlice {
	let bytes = initialBytes;
	const sliceStarted = now();
	let processed = 0;
	for (let index = start; index < source.length; index += 1) {
		if (signal.aborted) throw failure("editor-block-index-cancelled");
		const codePoint = source.codePointAt(index) ?? 0;
		if (codePoint > 0xffff) index += 1;
		bytes += utf8CodePointByteLength(codePoint);
		processed += 1;
		if (processed >= 256 && now() - sliceStarted >= VALIDATION_SLICE_MS) {
			return { bytes, done: false, nextIndex: index + 1 };
		}
	}
	return { bytes, done: true, nextIndex: source.length };
}

async function continueSourceByteLength(
	source: string,
	start: number,
	initialBytes: number,
	signal: AbortSignal,
): Promise<number> {
	let nextIndex = start;
	let bytes = initialBytes;
	while (true) {
		await yieldValidation();
		if (signal.aborted) throw failure("editor-block-index-cancelled");
		const slice = measureSourceByteSlice(source, nextIndex, bytes, signal);
		bytes = slice.bytes;
		if (slice.done) return bytes;
		nextIndex = slice.nextIndex;
	}
}

function sourceByteLength(
	source: string,
	signal: AbortSignal,
): SourceByteLength {
	const slice = measureSourceByteSlice(source, 0, 0, signal);
	if (slice.done) return slice.bytes;
	return continueSourceByteLength(source, slice.nextIndex, slice.bytes, signal);
}

function exactKeys(
	value: Record<string, unknown>,
	keys: ReadonlyArray<string>,
): boolean {
	const actual = Object.keys(value);
	return (
		actual.length === keys.length &&
		// biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is outside the supported browser baseline.
		keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
	);
}

async function lineCount(
	source: string,
	budget: ValidationBudget,
): Promise<number | null> {
	let count = 1;
	budget.resetPhase();
	for (let index = 0; index < source.length; index += 1) {
		if (budget.cancelled()) return null;
		if ("\r" === source[index]) {
			if ("\n" === source[index + 1]) index += 1;
			count += 1;
		} else if ("\n" === source[index]) {
			count += 1;
		}
		if (budget.shouldYieldTime() && !(await budget.checkpoint())) return null;
	}
	return count;
}

export function validateBuildInput(
	input: EditorMarkdownBlockIndexBuildInput,
	signal: AbortSignal,
	profile: ReferenceLabelCaseFoldProfile,
): EditorBlockIndexWorkerRequest | Promise<EditorBlockIndexWorkerRequest> {
	if (
		!record(input) ||
		!exactKeys(input as Record<string, unknown>, [
			"generation",
			"revision",
			"source",
		]) ||
		!safeInteger(input.generation) ||
		!safeInteger(input.revision) ||
		"string" !== typeof input.source
	) {
		throw failure("editor-block-index-input-invalid");
	}
	const createRequest = (bytes: number): EditorBlockIndexWorkerRequest => {
		if (bytes > MAX_EDITOR_BLOCK_INDEX_SOURCE_BYTES) {
			throw failure("editor-block-index-source-too-large");
		}
		return { ...input, type: "build", referenceLabelCaseFoldProfile: profile };
	};
	const bytes = sourceByteLength(input.source, signal);
	return "number" === typeof bytes
		? createRequest(bytes)
		: bytes.then(createRequest);
}

function validMathDelimitersAt(
	from: number,
	to: number,
	bodyFrom: number,
	bodyTo: number,
	displayMode: boolean,
	source: string,
): boolean {
	if (from < 0 || to > source.length || bodyFrom < 0 || bodyTo > source.length)
		return false;
	const startsWith = (first: string, second: string): boolean =>
		source[from] === first && source[from + 1] === second;
	const endsWith = (first: string, second: string): boolean =>
		source[to - 2] === first && source[to - 1] === second;
	const prefixLength = bodyFrom - from;
	const suffixLength = to - bodyTo;
	if (displayMode) {
		return (
			((startsWith("$", "$") &&
				endsWith("$", "$") &&
				prefixLength === 2 &&
				suffixLength === 2) ||
				(startsWith("\\", "[") &&
					endsWith("\\", "]") &&
					prefixLength === 2 &&
					suffixLength === 2)) &&
			bodyFrom === from + 2 &&
			bodyTo === to - 2
		);
	}
	return (
		((source[from] === "$" &&
			source[to - 1] === "$" &&
			prefixLength === 1 &&
			suffixLength === 1) ||
			(startsWith("\\", "(") &&
				endsWith("\\", ")") &&
				prefixLength === 2 &&
				suffixLength === 2)) &&
		bodyFrom === from + prefixLength &&
		bodyTo === to - suffixLength
	);
}

function exactPackedWords(value: unknown, words: number): Int32Array | null {
	if (
		!(value instanceof ArrayBuffer) ||
		!Number.isSafeInteger(words) ||
		words < 0 ||
		value.byteLength !== words * Int32Array.BYTES_PER_ELEMENT
	)
		return null;
	try {
		return new Int32Array(value);
	} catch {
		return null;
	}
}

function packedBuffer(
	value: unknown,
	count: unknown,
	fields: number,
): Int32Array | null {
	if (!safeInteger(count) || count > 100_000) return null;
	return exactPackedWords(value, count * fields);
}

function imageStatus(value: number): EditorMarkdownImageBlockStatus | null {
	if (value === EDITOR_BLOCK_INDEX_IMAGE_STATUS_READY) return "ready";
	if (value === EDITOR_BLOCK_INDEX_IMAGE_STATUS_UNAVAILABLE)
		return "unavailable";
	return null;
}

function linkKind(value: number): EditorMarkdownLinkCandidateKind | null {
	if (value === EDITOR_BLOCK_INDEX_LINK_KIND_LINK) return "link";
	if (value === EDITOR_BLOCK_INDEX_LINK_KIND_AUTOLINK) return "autolink";
	return null;
}

async function validatePackedBlocks(
	blocksBuffer: Int32Array,
	blockCount: number,
	sourceLength: number,
	lines: number,
	budget: ValidationBudget,
): Promise<ValidationPhaseResult<EditorMarkdownSourceBlock[]>> {
	const blocks: EditorMarkdownSourceBlock[] = [];
	let previousBlockTo = 0;
	budget.resetPhase();
	for (let index = 0; index < blockCount; index += 1) {
		if (budget.cancelled()) return { status: "cancelled" };
		const offset = index * EDITOR_BLOCK_INDEX_PACKED_BLOCK_FIELDS;
		const from = blocksBuffer[offset] ?? -1;
		const to = blocksBuffer[offset + 1] ?? -1;
		const lineStart = blocksBuffer[offset + 2] ?? -1;
		const lineEnd = blocksBuffer[offset + 3] ?? -1;
		const kindCode = blocksBuffer[offset + 4] ?? -1;
		const editableCode = blocksBuffer[offset + 5] ?? -1;
		const kind = EDITOR_MARKDOWN_BLOCK_KIND_ORDER[kindCode];
		if (
			!kind ||
			(editableCode !== 0 && editableCode !== 1) ||
			editableCode !== ("unavailable" === kind ? 0 : 1) ||
			!safeInteger(from) ||
			!safeInteger(to) ||
			!safeInteger(lineStart) ||
			!safeInteger(lineEnd) ||
			from >= to ||
			to > sourceLength ||
			from < previousBlockTo ||
			lineStart > lineEnd ||
			lineEnd >= lines
		)
			return { status: "invalid" };
		previousBlockTo = to;
		blocks.push({
			editable: editableCode === 1,
			from,
			kind,
			lineEnd,
			lineStart,
			to,
		});
		if (budget.shouldYield() && !(await budget.checkpoint()))
			return { status: "cancelled" };
	}
	return { status: "valid", value: blocks };
}

async function validatePackedMathSpans(
	mathBuffer: Int32Array,
	mathSpanCount: number,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	source: string,
	budget: ValidationBudget,
): Promise<ValidationPhaseResult<EditorMarkdownMathSpan[]>> {
	const mathSpans: EditorMarkdownMathSpan[] = [];
	let previousMathTo = 0;
	let mathBlockIndex = 0;
	budget.resetPhase();
	for (let index = 0; index < mathSpanCount; index += 1) {
		if (budget.cancelled()) return { status: "cancelled" };
		const offset = index * EDITOR_BLOCK_INDEX_PACKED_MATH_FIELDS;
		const from = mathBuffer[offset] ?? -1;
		const to = mathBuffer[offset + 1] ?? -1;
		const bodyFrom = mathBuffer[offset + 2] ?? -1;
		const bodyTo = mathBuffer[offset + 3] ?? -1;
		const displayCode = mathBuffer[offset + 4] ?? -1;
		const displayMode = displayCode === 1;
		while (
			mathBlockIndex < blocks.length &&
			(blocks[mathBlockIndex]?.to ?? 0) <= from
		) {
			mathBlockIndex += 1;
			if (budget.shouldYieldTime() && !(await budget.checkpoint()))
				return { status: "cancelled" };
		}
		const mathBlock = blocks[mathBlockIndex];
		if (
			(displayCode !== 0 && displayCode !== 1) ||
			!safeInteger(from) ||
			!safeInteger(to) ||
			!safeInteger(bodyFrom) ||
			!safeInteger(bodyTo) ||
			from >= to ||
			from < previousMathTo ||
			to > source.length ||
			bodyFrom <= from ||
			bodyTo >= to ||
			bodyFrom > bodyTo ||
			!mathBlock ||
			from < mathBlock.from ||
			to > mathBlock.to ||
			!mathBlock.editable ||
			"code" === mathBlock.kind ||
			"unavailable" === mathBlock.kind ||
			!validMathDelimitersAt(from, to, bodyFrom, bodyTo, displayMode, source)
		)
			return { status: "invalid" };
		previousMathTo = to;
		mathSpans.push({ bodyFrom, bodyTo, displayMode, from, to });
		if (budget.shouldYield() && !(await budget.checkpoint()))
			return { status: "cancelled" };
	}
	return { status: "valid", value: mathSpans };
}

async function validatePackedImages(
	imageBuffer: Int32Array,
	blockCount: number,
	imageCount: number,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	sourceLength: number,
	budget: ValidationBudget,
): Promise<
	ValidationPhaseResult<
		Readonly<{
			imageBlocks: EditorMarkdownImageBlock[];
			imageRanges: EditorMarkdownImageRange[];
		}>
	>
> {
	const imageBlocks: EditorMarkdownImageBlock[] = [];
	let firstImageIndex = 0;
	budget.resetPhase();
	for (let index = 0; index < blockCount; index += 1) {
		if (budget.cancelled()) return { status: "cancelled" };
		const offset = index * EDITOR_BLOCK_INDEX_PACKED_IMAGE_BLOCK_FIELDS;
		const block = blocks[index];
		const candidateFirst = imageBuffer[offset] ?? -1;
		const count = imageBuffer[offset + 1] ?? -1;
		const status = imageStatus(imageBuffer[offset + 2] ?? -1);
		if (
			!safeInteger(candidateFirst) ||
			!safeInteger(count) ||
			candidateFirst !== firstImageIndex ||
			candidateFirst + count > imageCount ||
			!status ||
			("unavailable" === status && count !== 0) ||
			!block ||
			(("code" === block.kind || !block.editable) && count !== 0)
		)
			return { status: "invalid" };
		imageBlocks.push({ count, firstImageIndex: candidateFirst, status });
		firstImageIndex += count;
		if (budget.shouldYield() && !(await budget.checkpoint()))
			return { status: "cancelled" };
	}
	if (firstImageIndex !== imageCount) return { status: "invalid" };

	const imageRanges: EditorMarkdownImageRange[] = [];
	let imageBlockIndex = 0;
	let previousImageTo = 0;
	budget.resetPhase();
	for (let index = 0; index < imageCount; index += 1) {
		if (budget.cancelled()) return { status: "cancelled" };
		while (
			imageBlockIndex < imageBlocks.length &&
			index >=
				(imageBlocks[imageBlockIndex]?.firstImageIndex ?? imageCount) +
					(imageBlocks[imageBlockIndex]?.count ?? 0)
		) {
			imageBlockIndex += 1;
			if (budget.shouldYieldTime() && !(await budget.checkpoint()))
				return { status: "cancelled" };
		}
		const block = blocks[imageBlockIndex];
		const imageBlock = imageBlocks[imageBlockIndex];
		const offset =
			blockCount * EDITOR_BLOCK_INDEX_PACKED_IMAGE_BLOCK_FIELDS +
			index * EDITOR_BLOCK_INDEX_PACKED_IMAGE_RANGE_FIELDS;
		const from = imageBuffer[offset] ?? -1;
		const to = imageBuffer[offset + 1] ?? -1;
		if (
			!block ||
			!imageBlock ||
			imageBlock.status !== "ready" ||
			!safeInteger(from) ||
			!safeInteger(to) ||
			from >= to ||
			from < previousImageTo ||
			to > sourceLength ||
			from < block.from ||
			to > block.to
		)
			return { status: "invalid" };
		imageRanges.push({ from, to });
		previousImageTo = to;
		if (budget.shouldYield() && !(await budget.checkpoint()))
			return { status: "cancelled" };
	}
	return { status: "valid", value: { imageBlocks, imageRanges } };
}

async function validatePackedLinks(
	linkBuffer: Int32Array,
	linkCount: number,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	budget: ValidationBudget,
): Promise<ValidationPhaseResult<EditorMarkdownLinkCandidate[]>> {
	const linkCandidates: EditorMarkdownLinkCandidate[] = [];
	let linkBlockIndex = 0;
	let previousLinkTo = 0;
	budget.resetPhase();
	for (let index = 0; index < linkCount; index += 1) {
		if (budget.cancelled()) return { status: "cancelled" };
		const offset = index * EDITOR_BLOCK_INDEX_PACKED_LINK_FIELDS;
		const from = linkBuffer[offset] ?? -1;
		const to = linkBuffer[offset + 1] ?? -1;
		const blockFrom = linkBuffer[offset + 2] ?? -1;
		const blockTo = linkBuffer[offset + 3] ?? -1;
		const kind = linkKind(linkBuffer[offset + 4] ?? -1);
		const referenceCode = linkBuffer[offset + 5] ?? -1;
		while (
			linkBlockIndex < blocks.length &&
			(blocks[linkBlockIndex]?.to ?? 0) <= from
		) {
			linkBlockIndex += 1;
			if (budget.shouldYieldTime() && !(await budget.checkpoint()))
				return { status: "cancelled" };
		}
		const block = blocks[linkBlockIndex];
		if (
			!block ||
			!kind ||
			(referenceCode !== 0 && referenceCode !== 1) ||
			!safeInteger(from) ||
			!safeInteger(to) ||
			!safeInteger(blockFrom) ||
			!safeInteger(blockTo) ||
			from < previousLinkTo ||
			from < blockFrom ||
			from >= to ||
			to > blockTo ||
			blockFrom !== block.from ||
			blockTo !== block.to ||
			"unavailable" === block.kind ||
			"code" === block.kind ||
			"math" === block.kind
		)
			return { status: "invalid" };
		previousLinkTo = to;
		linkCandidates.push({
			blockFrom,
			blockTo,
			from,
			kind,
			reference: referenceCode === 1,
			to,
		});
		if (budget.shouldYield() && !(await budget.checkpoint()))
			return { status: "cancelled" };
	}
	return { status: "valid", value: linkCandidates };
}

async function validatePackedData(
	data: Record<string, unknown>,
	source: string,
	cancelled: () => boolean,
): Promise<DataValidation> {
	const length = data.length;
	const blockCount = data.blockCount;
	const linkCount = data.linkCount;
	const mathSpanCount = data.mathSpanCount;
	const imageCount = data.imageCount;
	if (
		!exactKeys(data, [
			"blockCount",
			"blocks",
			"format",
			"imageCount",
			"images",
			"length",
			"linkCount",
			"links",
			"mathSpanCount",
			"mathSpans",
		]) ||
		data.format !== "packed-v3" ||
		!safeInteger(length) ||
		length !== source.length ||
		!safeInteger(blockCount) ||
		!safeInteger(linkCount) ||
		!safeInteger(mathSpanCount) ||
		!safeInteger(imageCount)
	)
		return { status: "invalid" };
	if (
		blockCount > MAX_EDITOR_BLOCK_INDEX_BLOCKS ||
		mathSpanCount > MAX_EDITOR_BLOCK_INDEX_MATH_SPANS ||
		imageCount > MAX_EDITOR_BLOCK_INDEX_IMAGES ||
		linkCount > MAX_EDITOR_BLOCK_INDEX_LINKS
	)
		return { status: "too-large" };
	const blocksBuffer = packedBuffer(
		data.blocks,
		blockCount,
		EDITOR_BLOCK_INDEX_PACKED_BLOCK_FIELDS,
	);
	const mathBuffer = packedBuffer(
		data.mathSpans,
		mathSpanCount,
		EDITOR_BLOCK_INDEX_PACKED_MATH_FIELDS,
	);
	const imageBuffer = exactPackedWords(
		data.images,
		blockCount * EDITOR_BLOCK_INDEX_PACKED_IMAGE_BLOCK_FIELDS +
			imageCount * EDITOR_BLOCK_INDEX_PACKED_IMAGE_RANGE_FIELDS,
	);
	const linkBuffer = packedBuffer(
		data.links,
		linkCount,
		EDITOR_BLOCK_INDEX_PACKED_LINK_FIELDS,
	);
	if (!blocksBuffer || !mathBuffer || !imageBuffer || !linkBuffer)
		return { status: "invalid" };

	const budget = createValidationBudget(cancelled);
	const lines = await lineCount(source, budget);
	if (null === lines) return { status: "cancelled" };

	const blocksResult = await validatePackedBlocks(
		blocksBuffer,
		blockCount,
		source.length,
		lines,
		budget,
	);
	if ("valid" !== blocksResult.status) return blocksResult;

	const mathResult = await validatePackedMathSpans(
		mathBuffer,
		mathSpanCount,
		blocksResult.value,
		source,
		budget,
	);
	if ("valid" !== mathResult.status) return mathResult;

	const imagesResult = await validatePackedImages(
		imageBuffer,
		blockCount,
		imageCount,
		blocksResult.value,
		source.length,
		budget,
	);
	if ("valid" !== imagesResult.status) return imagesResult;

	const linksResult = await validatePackedLinks(
		linkBuffer,
		linkCount,
		blocksResult.value,
		budget,
	);
	if ("valid" !== linksResult.status) return linksResult;

	return {
		status: "valid",
		value: {
			blocks: blocksResult.value,
			imageBlocks: imagesResult.value.imageBlocks,
			imageRanges: imagesResult.value.imageRanges,
			length,
			linkCandidates: linksResult.value,
			mathSpans: mathResult.value,
		},
	};
}

export async function validateData(
	value: unknown,
	source: string,
	cancelled: () => boolean,
): Promise<DataValidation> {
	const data = record(value);
	if (!data) return { status: "invalid" };
	return validatePackedData(data, source, cancelled);
}

export function responseCode(
	value: unknown,
): EditorMarkdownBlockIndexFailureCode | null {
	return "string" === typeof value &&
		FAILURE_CODES.has(value as EditorMarkdownBlockIndexFailureCode)
		? (value as EditorMarkdownBlockIndexFailureCode)
		: null;
}
