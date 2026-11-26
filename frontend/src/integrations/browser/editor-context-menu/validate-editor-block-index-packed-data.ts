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
	type EditorMarkdownBlockIndexDataWithImages,
	type EditorMarkdownImageBlock,
	type EditorMarkdownImageBlockStatus,
	type EditorMarkdownImageRange,
	type EditorMarkdownLinkCandidate,
	type EditorMarkdownLinkCandidateKind,
	type EditorMarkdownMathSpan,
	type EditorMarkdownSourceBlock,
	hasExactEditorBlockIndexPackedKeys,
	MAX_EDITOR_BLOCK_INDEX_BLOCKS,
	MAX_EDITOR_BLOCK_INDEX_IMAGES,
	MAX_EDITOR_BLOCK_INDEX_LINKS,
	MAX_EDITOR_BLOCK_INDEX_MATH_SPANS,
} from "../../../contracts/ports/editor-block-index-port";
import { unpackEditorMarkdownLinkTableCells } from "../../../shared/markdown/editor-block-index-table-cell-codec";
import {
	createYieldBudget,
	now,
	record,
	safeInteger,
	VALIDATION_SLICE_MS,
	type YieldBudget,
	yieldValidation,
} from "./editor-block-index-validation-budget";

type SectionFailure = Readonly<{ status: "cancelled" | "invalid" }>;

type DataValidation =
	| Readonly<{ status: "cancelled" | "invalid" | "too-large" }>
	| Readonly<{
			status: "valid";
			value: EditorMarkdownBlockIndexDataWithImages;
	  }>;

const CANCELLED: Readonly<{ status: "cancelled" }> = { status: "cancelled" };
const INVALID: Readonly<{ status: "invalid" }> = { status: "invalid" };

type Cancelled = () => boolean;

async function lineCount(
	source: string,
	cancelled: Cancelled,
): Promise<number | null> {
	let count = 1;
	let sliceStarted = now();
	for (let index = 0; index < source.length; index += 1) {
		if (cancelled()) return null;
		if ("\r" === source[index]) {
			if ("\n" === source[index + 1]) index += 1;
			count += 1;
		} else if ("\n" === source[index]) {
			count += 1;
		}
		if (now() - sliceStarted >= VALIDATION_SLICE_MS) {
			await yieldValidation();
			sliceStarted = now();
			if (cancelled()) return null;
		}
	}
	return count;
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

/**
 * Validates that a packed math span `[from, to)` is covered by editable
 * non-code, non-unavailable blocks starting at `startBlockIndex` and returns
 * the ending block index, or `-1` on any violation. Only inline `\(...\)` math
 * may span across Lezer block boundaries (such as blank lines or headings).
 */
function findEditorBlockIndexMathSpanEndBlockIndex(
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	startBlockIndex: number,
	from: number,
	to: number,
	displayMode: boolean,
	source: string,
): number {
	const startBlock = blocks[startBlockIndex];
	if (
		!startBlock ||
		from < startBlock.from ||
		!startBlock.editable ||
		"code" === startBlock.kind ||
		"unavailable" === startBlock.kind ||
		(!displayMode && "math" === startBlock.kind)
	) {
		return -1;
	}
	if (to <= startBlock.to) return startBlockIndex;
	if (displayMode || "\\" !== source[from] || "(" !== source[from + 1]) {
		return -1;
	}
	for (let idx = startBlockIndex + 1; idx < blocks.length; idx += 1) {
		const block = blocks[idx];
		if (
			!block?.editable ||
			"code" === block.kind ||
			"unavailable" === block.kind ||
			"math" === block.kind
		) {
			return -1;
		}
		if (to <= block.to) return to > block.from ? idx : -1;
	}
	return -1;
}

function packedBuffer(
	value: unknown,
	count: unknown,
	fields: number,
): Int32Array | null {
	if (!(value instanceof ArrayBuffer) || !safeInteger(count)) return null;
	if (
		count > 100_000 ||
		value.byteLength !== count * fields * Int32Array.BYTES_PER_ELEMENT
	)
		return null;
	try {
		return new Int32Array(value);
	} catch {
		return null;
	}
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

type PackedEnvelope = Readonly<{
	blockCount: number;
	blocksBuffer: Int32Array;
	imageBuffer: Int32Array;
	imageCount: number;
	length: number;
	linkBuffer: Int32Array;
	linkCount: number;
	mathBuffer: Int32Array;
	mathSpanCount: number;
	packedKeyShape: NonNullable<
		ReturnType<typeof hasExactEditorBlockIndexPackedKeys>
	>;
}>;

function readPackedEnvelope(
	data: Readonly<Record<string, unknown>>,
	source: string,
): PackedEnvelope | Readonly<{ status: "invalid" | "too-large" }> {
	const packedKeyShape = hasExactEditorBlockIndexPackedKeys(data);
	const { blockCount, imageCount, length, linkCount, mathSpanCount } = data;
	if (
		null === packedKeyShape ||
		data.format !== "packed-v3" ||
		length !== source.length ||
		!safeInteger(length) ||
		!safeInteger(blockCount) ||
		!safeInteger(linkCount) ||
		!safeInteger(mathSpanCount) ||
		!safeInteger(imageCount)
	)
		return INVALID;
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
		return INVALID;
	return {
		blockCount,
		blocksBuffer,
		imageBuffer,
		imageCount,
		length,
		linkBuffer,
		linkCount,
		mathBuffer,
		mathSpanCount,
		packedKeyShape,
	};
}

async function validateBlocks(
	envelope: PackedEnvelope,
	source: string,
	lines: number,
	budget: YieldBudget,
	cancelled: Cancelled,
): Promise<EditorMarkdownSourceBlock[] | SectionFailure> {
	const { blockCount, blocksBuffer } = envelope;
	const blocks: EditorMarkdownSourceBlock[] = [];
	let previousBlockTo = 0;
	for (let index = 0; index < blockCount; index += 1) {
		if (cancelled()) return CANCELLED;
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
			to > source.length ||
			from < previousBlockTo ||
			lineStart > lineEnd ||
			lineEnd >= lines
		)
			return INVALID;
		previousBlockTo = to;
		blocks.push({
			editable: editableCode === 1,
			from,
			kind,
			lineEnd,
			lineStart,
			to,
		});
		if (budget.itemYieldDue()) await budget.yieldItem();
	}
	return blocks;
}

async function validateMathSpans(
	envelope: PackedEnvelope,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	source: string,
	budget: YieldBudget,
	cancelled: Cancelled,
): Promise<EditorMarkdownMathSpan[] | SectionFailure> {
	const { mathBuffer, mathSpanCount } = envelope;
	const mathSpans: EditorMarkdownMathSpan[] = [];
	let previousMathTo = 0;
	let mathBlockIndex = 0;
	budget.resetBatch();
	for (let index = 0; index < mathSpanCount; index += 1) {
		if (cancelled()) return CANCELLED;
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
			if (budget.sliceYieldDue()) {
				await budget.yieldSlice();
				if (cancelled()) return CANCELLED;
			}
		}
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
			!validMathDelimitersAt(from, to, bodyFrom, bodyTo, displayMode, source)
		)
			return INVALID;
		const coveredEndBlockIndex = findEditorBlockIndexMathSpanEndBlockIndex(
			blocks,
			mathBlockIndex,
			from,
			to,
			displayMode,
			source,
		);
		if (coveredEndBlockIndex < 0) return INVALID;
		mathBlockIndex = coveredEndBlockIndex;
		previousMathTo = to;
		mathSpans.push({ bodyFrom, bodyTo, displayMode, from, to });
		if (budget.itemYieldDue()) await budget.yieldItem();
	}
	return mathSpans;
}

async function validateImageBlocks(
	envelope: PackedEnvelope,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	cancelled: Cancelled,
): Promise<EditorMarkdownImageBlock[] | SectionFailure> {
	const { blockCount, imageBuffer, imageCount } = envelope;
	const imageBlocks: EditorMarkdownImageBlock[] = [];
	let firstImageIndex = 0;
	const budget = createYieldBudget();
	for (let index = 0; index < blockCount; index += 1) {
		if (cancelled()) return CANCELLED;
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
			return INVALID;
		imageBlocks.push({ count, firstImageIndex: candidateFirst, status });
		firstImageIndex += count;
		if (budget.itemYieldDue()) await budget.yieldItem();
	}
	if (firstImageIndex !== imageCount) return INVALID;
	return imageBlocks;
}

async function validateImageRanges(
	envelope: PackedEnvelope,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	imageBlocks: ReadonlyArray<EditorMarkdownImageBlock>,
	source: string,
	cancelled: Cancelled,
): Promise<EditorMarkdownImageRange[] | SectionFailure> {
	const { blockCount, imageBuffer, imageCount } = envelope;
	const imageRanges: EditorMarkdownImageRange[] = [];
	let imageBlockIndex = 0;
	let previousImageTo = 0;
	const budget = createYieldBudget();
	for (let index = 0; index < imageCount; index += 1) {
		if (cancelled()) return CANCELLED;
		while (
			imageBlockIndex < imageBlocks.length &&
			index >=
				(imageBlocks[imageBlockIndex]?.firstImageIndex ?? imageCount) +
					(imageBlocks[imageBlockIndex]?.count ?? 0)
		) {
			imageBlockIndex += 1;
			if (budget.sliceYieldDue()) {
				await budget.yieldSlice();
				if (cancelled()) return CANCELLED;
			}
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
			to > source.length ||
			from < block.from ||
			to > block.to
		)
			return INVALID;
		imageRanges.push({ from, to });
		previousImageTo = to;
		if (budget.itemYieldDue()) await budget.yieldItem();
	}
	return imageRanges;
}

async function validateLinkCandidates(
	envelope: PackedEnvelope,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	cancelled: Cancelled,
): Promise<EditorMarkdownLinkCandidate[] | SectionFailure> {
	const { linkBuffer, linkCount } = envelope;
	const linkCandidates: EditorMarkdownLinkCandidate[] = [];
	let linkBlockIndex = 0;
	let previousLinkTo = 0;
	const budget = createYieldBudget();
	for (let index = 0; index < linkCount; index += 1) {
		if (cancelled()) return CANCELLED;
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
			if (budget.sliceYieldDue()) {
				await budget.yieldSlice();
				if (cancelled()) return CANCELLED;
			}
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
			return INVALID;
		previousLinkTo = to;
		linkCandidates.push({
			blockFrom,
			blockTo,
			from,
			kind,
			reference: referenceCode === 1,
			to,
		});
		if (budget.itemYieldDue()) await budget.yieldItem();
	}
	return linkCandidates;
}

function isSectionFailure<T>(
	value: ReadonlyArray<T> | SectionFailure,
): value is SectionFailure {
	return !Array.isArray(value);
}

async function validatePackedData(
	data: Readonly<Record<string, unknown>>,
	source: string,
	cancelled: Cancelled,
): Promise<DataValidation> {
	const envelope = readPackedEnvelope(data, source);
	if ("status" in envelope) return envelope;

	const lines = await lineCount(source, cancelled);
	if (null === lines) return CANCELLED;
	const budget = createYieldBudget();
	const blocks = await validateBlocks(
		envelope,
		source,
		lines,
		budget,
		cancelled,
	);
	if (isSectionFailure(blocks)) return blocks;
	const mathSpans = await validateMathSpans(
		envelope,
		blocks,
		source,
		budget,
		cancelled,
	);
	if (isSectionFailure(mathSpans)) return mathSpans;
	const imageBlocks = await validateImageBlocks(envelope, blocks, cancelled);
	if (isSectionFailure(imageBlocks)) return imageBlocks;
	const imageRanges = await validateImageRanges(
		envelope,
		blocks,
		imageBlocks,
		source,
		cancelled,
	);
	if (isSectionFailure(imageRanges)) return imageRanges;
	const linkCandidates = await validateLinkCandidates(
		envelope,
		blocks,
		cancelled,
	);
	if (isSectionFailure(linkCandidates)) return linkCandidates;

	if (cancelled()) return CANCELLED;
	const linkTableCells =
		"with-table-cells" === envelope.packedKeyShape
			? unpackEditorMarkdownLinkTableCells(
					source,
					linkCandidates,
					blocks,
					data,
					{ envelopeValidated: true },
				)
			: undefined;
	if (null === linkTableCells) return INVALID;
	return {
		status: "valid",
		value: {
			blocks,
			imageBlocks,
			imageRanges,
			length: envelope.length,
			linkCandidates,
			...(undefined !== linkTableCells ? { linkTableCells } : {}),
			mathSpans,
		},
	};
}

/**
 * Deserializes and validates a `packed-v3` worker result against the exact
 * source it was built from, yielding cooperatively between time slices.
 */
export async function validateEditorBlockIndexPackedData(
	value: unknown,
	source: string,
	cancelled: Cancelled,
): Promise<DataValidation> {
	const data = record(value);
	if ("packed-v3" !== data?.format) return INVALID;
	return validatePackedData(data, source, cancelled);
}
