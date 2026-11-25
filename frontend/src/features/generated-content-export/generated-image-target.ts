import type {
	EditorMarkdownBlockIndexDataWithImages,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";
import { scanPhpMarkdownMathRanges } from "../../shared/markdown/php-markdown-math-mask";
import {
	type MarkdownImageScaleMatch,
	parseMarkdownImageScale,
} from "../image-scale/image-scale-contract";
import {
	findLineAtOffset,
	getCachedMarkdownBlockScan,
	type ScannedMarkdownBlocks,
} from "../image-scale/image-scale-markdown-scan";
import {
	collectUncoveredPhpTableImages,
	type LocatedMarkdownImageCore,
} from "../image-scale/image-scale-syntax";

export type GeneratedImageAcceptedPreview = Readonly<{
	revision: number;
	signature: string;
}>;

export type GeneratedImageOriginal = Readonly<{
	alt: string;
	destination: string;
	end: number;
	raw: string;
	start: number;
	title: string | null;
}>;

export type GeneratedImageTarget = Readonly<{
	acceptedPreview: GeneratedImageAcceptedPreview;
	blockId: string;
	ordinal: number;
	original: GeneratedImageOriginal;
	sourceRevision: number;
}>;

export type GeneratedImageTargetSelection = Readonly<{
	end: number;
	start: number;
}>;

export type GeneratedImageTargetIndex = Readonly<{
	blockImages: ReadonlyArray<
		Readonly<{
			end: number;
			images: ReadonlyArray<MarkdownImageScaleMatch>;
			start: number;
			status: "ready" | "unavailable";
		}>
	>;
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	complete: true;
	images: ReadonlyArray<MarkdownImageScaleMatch>;
	length: number;
	revision: number;
	sourceBytes: number;
	source: string;
}>;

export type GeneratedImageTargetBlock = Readonly<{
	editable: boolean;
	end: number;
	id: string;
	kind: EditorMarkdownSourceBlock["kind"];
	start: number;
}>;

export type GeneratedImageTargetResult =
	| Readonly<{
			status: "associated";
			target: GeneratedImageTarget;
	  }>
	| Readonly<{
			code: GeneratedImageTargetFailureCode;
			status: "failed";
	  }>;

export type GeneratedImageTargetFailureCode =
	| "generated-image-target-accepted-preview-invalid"
	| "generated-image-target-block-invalid"
	| "generated-image-target-image-ambiguous"
	| "generated-image-target-image-invalid"
	| "generated-image-target-image-unavailable"
	| "generated-image-target-ordinal-invalid"
	| "generated-image-target-source-invalid"
	| "generated-image-target-source-revision-invalid"
	| "generated-image-target-selection-ambiguous"
	| "generated-image-target-selection-invalid";

function failed(
	code: GeneratedImageTargetFailureCode,
): GeneratedImageTargetResult {
	return { code, status: "failed" };
}

function safeNonNegativeInteger(value: unknown): value is number {
	return "number" === typeof value && Number.isSafeInteger(value) && value >= 0;
}

function lineStartOffset(source: string, offset: number): number {
	let cursor = Math.max(0, Math.min(source.length, offset));
	while (
		cursor > 0 &&
		"\n" !== source[cursor - 1] &&
		"\r" !== source[cursor - 1]
	) {
		cursor -= 1;
	}
	return cursor;
}

function parseSingleLineImageMatch(
	source: string,
	from: number,
	to: number,
	blockEnd: number,
	rawSlice: string,
): MarkdownImageScaleMatch | null {
	let singleLineSliceEnd = to;
	const maxSliceEnd = Math.min(blockEnd, to + 4);
	while (
		singleLineSliceEnd < maxSliceEnd &&
		"\n" !== source[singleLineSliceEnd] &&
		"\r" !== source[singleLineSliceEnd]
	) {
		singleLineSliceEnd += 1;
	}
	const singleLineSlice =
		singleLineSliceEnd > to ? source.slice(from, singleLineSliceEnd) : rawSlice;
	const parsed = parseMarkdownImageScale(singleLineSlice);
	return parsed && parsed.end === to - from ? shiftedImage(parsed, from) : null;
}

function shiftedImage(
	image: MarkdownImageScaleMatch,
	offset: number,
): MarkdownImageScaleMatch {
	const shift = (value: number | null): number | null =>
		null === value ? null : value + offset;
	return {
		...image,
		destinationEnd: image.destinationEnd + offset,
		destinationStart: image.destinationStart + offset,
		end: image.end + offset,
		imageEnd: image.imageEnd + offset,
		start: image.start + offset,
		titleEnd: shift(image.titleEnd),
		titleMarkerEnd: shift(image.titleMarkerEnd),
		titleMarkerStart: shift(image.titleMarkerStart),
		titleStart: shift(image.titleStart),
	};
}

export type GeneratedImageTargetHydrationInput = Readonly<{
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	deadline: number;
	imageIndex: EditorMarkdownBlockIndexDataWithImages;
	now: () => number;
	revision: number;
	signal: AbortSignal;
	source: string;
	yield: () => Promise<void>;
}>;

const MAX_IMAGE_TARGET_SOURCE_UNITS = 16_384;
const IMAGE_HYDRATION_SLICE_MS = 4;

type HydrationBudget = Readonly<{
	deadline: number;
	now: () => number;
	signal: AbortSignal;
	yield: () => Promise<void>;
}> & { sliceStarted: number; workUnits: number };

function hydrationFailure(code: string): never {
	throw new Error(code);
}

function assertHydrationActive(budget: HydrationBudget): void {
	if (budget.signal.aborted) hydrationFailure("editor-block-index-cancelled");
	if (budget.now() > budget.deadline) {
		hydrationFailure("editor-block-index-image-hydration-timeout");
	}
}

async function hydrationCheckpoint(budget: HydrationBudget): Promise<void> {
	assertHydrationActive(budget);
	budget.workUnits += 1;
	if (
		budget.workUnits < 256 &&
		budget.now() - budget.sliceStarted < IMAGE_HYDRATION_SLICE_MS
	)
		return;
	await budget.yield();
	assertHydrationActive(budget);
	budget.sliceStarted = budget.now();
	budget.workUnits = 0;
}

function sameBlock(
	left: EditorMarkdownSourceBlock,
	right: EditorMarkdownSourceBlock,
): boolean {
	return (
		left.from === right.from &&
		left.to === right.to &&
		left.kind === right.kind &&
		left.editable === right.editable
	);
}

async function sourceByteLengthBounded(
	source: string,
	budget: HydrationBudget,
): Promise<number> {
	let bytes = 0;
	for (let index = 0; index < source.length; index += 1) {
		if (0 === index % 256) await hydrationCheckpoint(budget);
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

async function validateImageIndexShape(
	input: GeneratedImageTargetHydrationInput,
	sourceBytes: number,
	budget: HydrationBudget,
): Promise<void> {
	const { blocks, imageIndex, source } = input;
	if (
		!safeNonNegativeInteger(input.revision) ||
		sourceBytes > 1_048_576 ||
		imageIndex.length !== source.length ||
		imageIndex.blocks.length !== blocks.length ||
		imageIndex.imageBlocks.length !== blocks.length ||
		imageIndex.imageRanges.length > 100_000
	)
		hydrationFailure("editor-block-index-image-result-invalid");
	let firstImageIndex = 0;
	let previousImageEnd = 0;
	for (let index = 0; index < blocks.length; index += 1) {
		await hydrationCheckpoint(budget);
		const block = blocks[index];
		const candidate = imageIndex.blocks[index];
		const metadata = imageIndex.imageBlocks[index];
		if (
			!block ||
			!candidate ||
			!metadata ||
			!sameBlock(block, candidate) ||
			!safeNonNegativeInteger(metadata.firstImageIndex) ||
			!safeNonNegativeInteger(metadata.count) ||
			metadata.firstImageIndex !== firstImageIndex ||
			("unavailable" === metadata.status && metadata.count !== 0) ||
			("code" === block.kind && metadata.count !== 0) ||
			("ready" !== metadata.status && "unavailable" !== metadata.status)
		)
			hydrationFailure("editor-block-index-image-result-invalid");
		firstImageIndex += metadata.count;
	}
	if (firstImageIndex !== imageIndex.imageRanges.length) {
		hydrationFailure("editor-block-index-image-result-invalid");
	}
	for (const range of imageIndex.imageRanges) {
		await hydrationCheckpoint(budget);
		if (
			!safeNonNegativeInteger(range.from) ||
			!safeNonNegativeInteger(range.to) ||
			range.from >= range.to ||
			range.to > source.length ||
			range.from < previousImageEnd
		)
			hydrationFailure("editor-block-index-image-result-invalid");
		previousImageEnd = range.to;
	}
}

export async function hydrateGeneratedImageTargetIndex(
	input: GeneratedImageTargetHydrationInput,
): Promise<GeneratedImageTargetIndex> {
	const initialNow = input.now();
	if (!safeNonNegativeInteger(input.revision)) {
		hydrationFailure("generated-image-index-revision-invalid");
	}
	if (
		"string" !== typeof input.source ||
		!Number.isFinite(input.deadline) ||
		input.deadline < initialNow
	)
		hydrationFailure("editor-block-index-image-hydration-deadline-invalid");
	const budget: HydrationBudget = {
		deadline: input.deadline,
		now: input.now,
		signal: input.signal,
		yield: input.yield,
		sliceStarted: initialNow,
		workUnits: 0,
	};
	const sourceBytes = await sourceByteLengthBounded(input.source, budget);
	await hydrationCheckpoint(budget);
	await validateImageIndexShape(input, sourceBytes, budget);
	const blockImages: Array<GeneratedImageTargetIndex["blockImages"][number]> =
		[];
	const images: MarkdownImageScaleMatch[] = [];
	const sourceHasPipe = input.source.includes("|");
	const firstDollar = input.source.indexOf("$");
	const sourceHasDollarPair =
		firstDollar >= 0 && input.source.indexOf("$", firstDollar + 1) >= 0;
	const sourceHasBackslash = input.source.includes("\\");
	const sourceHasBackslashMathPair =
		sourceHasBackslash &&
		((input.source.includes("\\[") && input.source.includes("\\]")) ||
			(input.source.includes("\\(") && input.source.includes("\\)")));
	const sourceNeedsDocBlockScan =
		sourceHasPipe ||
		input.imageIndex.mathSpans.length > 0 ||
		sourceHasDollarPair ||
		sourceHasBackslashMathPair;
	let docBlocks: ScannedMarkdownBlocks | null = null;
	const mayHaveUncoveredTableImages =
		sourceHasPipe && input.source.includes("![");
	let uncoveredTableImages: ReadonlyArray<LocatedMarkdownImageCore> = [];
	let uncoveredMathRanges: ReadonlyArray<Readonly<{ from: number; to: number }>> =
		[];
	if (mayHaveUncoveredTableImages) {
		docBlocks = getCachedMarkdownBlockScan(input.source);
		uncoveredTableImages = collectUncoveredPhpTableImages(
			input.source,
			docBlocks,
			input.imageIndex.imageRanges,
		);
		if (uncoveredTableImages.length > 0) {
			uncoveredMathRanges =
				input.imageIndex.mathSpans.length > 0
					? input.imageIndex.mathSpans
					: scanPhpMarkdownMathRanges(input.source);
		}
	}
	let uncoveredIdx = 0;
	let uncoveredMathIdx = 0;
	for (let blockIndex = 0; blockIndex < input.blocks.length; blockIndex += 1) {
		await hydrationCheckpoint(budget);
		const block = input.blocks[blockIndex];
		const metadata = input.imageIndex.imageBlocks[blockIndex];
		if (!block || !metadata)
			hydrationFailure("editor-block-index-image-result-invalid");
		if ("unavailable" === metadata.status) {
			blockImages.push({
				end: block.to,
				images: [],
				start: block.from,
				status: "unavailable",
			});
		} else {
			const prepared: MarkdownImageScaleMatch[] = [];
			let blockUnavailable = false;
			let blockContext: Readonly<{
				blocks: ScannedMarkdownBlocks;
				slice: string;
				start: number;
			}> | null = null;
			for (
				let imageOffset = 0;
				imageOffset < metadata.count;
				imageOffset += 1
			) {
				await hydrationCheckpoint(budget);
				const range =
					input.imageIndex.imageRanges[metadata.firstImageIndex + imageOffset];
				if (
					!range ||
					range.from < block.from ||
					range.from >= range.to ||
					range.to > block.to
				)
					hydrationFailure("editor-block-index-image-result-invalid");
				if (range.to - range.from > MAX_IMAGE_TARGET_SOURCE_UNITS) {
					blockUnavailable = true;
					continue;
				}
				if (!blockUnavailable) {
					try {
						const rawSlice = input.source.slice(range.from, range.to);
						const isMultiline =
							rawSlice.includes("\n") || rawSlice.includes("\r");
						let image: MarkdownImageScaleMatch | null = null;
						if (sourceNeedsDocBlockScan) {
							if (null === docBlocks) {
								docBlocks = getCachedMarkdownBlockScan(input.source);
							}
							const line = findLineAtOffset(docBlocks.lines, range.from);
							image =
								!isMultiline &&
								line &&
								!line.isTableRow &&
								line.inlineBlockId >= 0 &&
								range.to <= line.lineEnd
									? parseSingleLineImageMatch(
											input.source,
											range.from,
											range.to,
											block.to,
											rawSlice,
										)
									: parseMarkdownImageScale(input.source, range.from, docBlocks);
						} else if (!isMultiline) {
							image = parseSingleLineImageMatch(
								input.source,
								range.from,
								range.to,
								block.to,
								rawSlice,
							);
						} else {
							if (null === blockContext) {
								const contextStart = lineStartOffset(input.source, block.from);
								const slice = input.source.slice(contextStart, block.to);
								blockContext = {
									blocks: getCachedMarkdownBlockScan(slice),
									slice,
									start: contextStart,
								};
							}
							const parsed = parseMarkdownImageScale(
								blockContext.slice,
								range.from - blockContext.start,
								blockContext.blocks,
							);
							if (parsed) {
								image = shiftedImage(parsed, blockContext.start);
							}
						}
						if (
							!image ||
							image.start !== range.from ||
							image.end !== range.to ||
							image.raw !== rawSlice
						) {
							blockUnavailable = true;
						} else {
							prepared.push(image);
						}
					} catch (error) {
						if (
							error instanceof Error &&
							error.message === "image-scale-syntax-invalid"
						) {
							blockUnavailable = true;
						} else {
							throw error;
						}
					}
				}
			}
			if (
				!blockUnavailable &&
				uncoveredTableImages.length > 0 &&
				"code" !== block.kind &&
				"unavailable" !== block.kind
			) {
				while (
					uncoveredIdx < uncoveredTableImages.length &&
					(uncoveredTableImages[uncoveredIdx]?.core.imageEnd ?? 0) <= block.from
				) {
					uncoveredIdx += 1;
				}
				let addedRecovered = false;
				let preparedRangeKeys: Set<string> | null = null;
				while (uncoveredIdx < uncoveredTableImages.length) {
					const located = uncoveredTableImages[uncoveredIdx];
					if (!located || located.start >= block.to) break;
					uncoveredIdx += 1;
					const from = located.start;
					const to = located.core.imageEnd;
					if (from < block.from || to > block.to) {
						blockUnavailable = true;
						continue;
					}
					while (
						uncoveredMathIdx < uncoveredMathRanges.length &&
						(uncoveredMathRanges[uncoveredMathIdx]?.to ?? 0) <= from
					) {
						uncoveredMathIdx += 1;
					}
					const math = uncoveredMathRanges[uncoveredMathIdx];
					if (math && from < math.to && to > math.from) {
						if (from >= math.from && to <= math.to) continue;
						blockUnavailable = true;
						continue;
					}
					if (to - from > MAX_IMAGE_TARGET_SOURCE_UNITS) {
						blockUnavailable = true;
						continue;
					}
					if (prepared.length > 0) {
						if (null === preparedRangeKeys) {
							preparedRangeKeys = new Set<string>();
							for (let idx = 0; idx < prepared.length; idx += 1) {
								const existing = prepared[idx];
								if (existing) {
									preparedRangeKeys.add(`${existing.start}:${existing.end}`);
								}
							}
						}
						if (preparedRangeKeys.has(`${from}:${to}`)) {
							continue;
						}
					}
					if (!blockUnavailable) {
						await hydrationCheckpoint(budget);
						try {
							const parsed = parseMarkdownImageScale(
								input.source,
								from,
								docBlocks ?? undefined,
							);
							if (
								!parsed ||
								parsed.start !== from ||
								parsed.end !== to ||
								parsed.raw !== input.source.slice(from, to)
							) {
								blockUnavailable = true;
							} else {
								prepared.push(parsed);
								preparedRangeKeys?.add(`${from}:${to}`);
								addedRecovered = true;
							}
						} catch (error) {
							if (
								error instanceof Error &&
								error.message === "image-scale-syntax-invalid"
							) {
								blockUnavailable = true;
							} else {
								throw error;
							}
						}
					}
				}
				if (addedRecovered && !blockUnavailable && prepared.length > 1) {
					prepared.sort((left, right) => left.start - right.start || left.end - right.end);
					for (let idx = 1; idx < prepared.length; idx += 1) {
						const prev = prepared[idx - 1];
						const curr = prepared[idx];
						if (prev && curr && curr.start < prev.end) {
							blockUnavailable = true;
							break;
						}
					}
				}
			}
			if (blockUnavailable) {
				blockImages.push({
					end: block.to,
					images: [],
					start: block.from,
					status: "unavailable",
				});
			} else {
				images.push(...prepared);
				blockImages.push({
					end: block.to,
					images: prepared,
					start: block.from,
					status: "ready",
				});
			}
		}
		await hydrationCheckpoint(budget);
	}
	await budget.yield();
	assertHydrationActive(budget);
	return {
		blockImages,
		blocks: input.blocks,
		complete: true,
		images,
		length: input.source.length,
		revision: input.revision,
		sourceBytes,
		source: input.source,
	};
}

function outermostImagesForBlock(
	source: string,
	index: GeneratedImageTargetIndex,
	block: GeneratedImageTargetBlock,
): ReadonlyArray<MarkdownImageScaleMatch> | GeneratedImageTargetFailureCode {
	if (
		!block.id ||
		!block.editable ||
		"code" === block.kind ||
		"unavailable" === block.kind ||
		!safeNonNegativeInteger(block.start) ||
		!safeNonNegativeInteger(block.end) ||
		block.start >= block.end ||
		block.end > source.length
	)
		return "generated-image-target-block-invalid";
	const cached = index.blockImages.find(
		(entry) => entry.start === block.start && entry.end === block.end,
	);
	if (!cached) return "generated-image-target-image-unavailable";
	if ("unavailable" === cached.status) {
		return "generated-image-target-image-unavailable";
	}
	const candidates = cached.images;
	let previous: MarkdownImageScaleMatch | null = null;
	for (const image of candidates) {
		if (
			!safeNonNegativeInteger(image.start) ||
			!safeNonNegativeInteger(image.end) ||
			image.start >= image.end ||
			image.end > source.length ||
			source.slice(image.start, image.end) !== image.raw
		)
			return "generated-image-target-image-invalid";
		if (previous) {
			if (image.start === previous.start && image.end === previous.end) {
				return "generated-image-target-image-ambiguous";
			}
			if (image.start < previous.end) {
				return "generated-image-target-image-ambiguous";
			}
		}
		previous = image;
	}
	return candidates;
}

export function generatedImageTargetCount(
	input: Readonly<{
		block: GeneratedImageTargetBlock;
		index: GeneratedImageTargetIndex;
	}>,
): number | null {
	const images = outermostImagesForBlock(
		input.index.source,
		input.index,
		input.block,
	);
	return Array.isArray(images) ? images.length : null;
}

export function associateGeneratedImageTarget(
	input: Readonly<{
		acceptedPreview: GeneratedImageAcceptedPreview;
		block: GeneratedImageTargetBlock;
		index: GeneratedImageTargetIndex;
		ordinal: number;
		sourceRevision: number;
	}>,
): GeneratedImageTargetResult {
	if (
		!input.index.complete ||
		!safeNonNegativeInteger(input.acceptedPreview.revision) ||
		!input.acceptedPreview.signature
	)
		return failed("generated-image-target-accepted-preview-invalid");
	if (!safeNonNegativeInteger(input.sourceRevision)) {
		return failed("generated-image-target-source-revision-invalid");
	}
	if (
		input.index.revision !== input.sourceRevision ||
		input.index.length !== input.index.source.length ||
		!safeNonNegativeInteger(input.index.sourceBytes) ||
		input.index.sourceBytes < input.index.source.length ||
		input.index.sourceBytes > 1_048_576 ||
		input.index.blockImages.length !== input.index.blocks.length
	)
		return failed("generated-image-target-source-invalid");
	if (!safeNonNegativeInteger(input.ordinal)) {
		return failed("generated-image-target-ordinal-invalid");
	}
	const images = outermostImagesForBlock(
		input.index.source,
		input.index,
		input.block,
	);
	if ("string" === typeof images) return failed(images);
	const image = images[input.ordinal];
	if (!image) return failed("generated-image-target-image-unavailable");
	return {
		status: "associated",
		target: {
			acceptedPreview: input.acceptedPreview,
			blockId: input.block.id,
			ordinal: input.ordinal,
			original: {
				alt: image.alt,
				destination: image.destination,
				end: image.end,
				raw: image.raw,
				start: image.start,
				title: image.title,
			},
			sourceRevision: input.sourceRevision,
		},
	};
}

export function associateGeneratedImageTargetBySelection(
	input: Readonly<{
		acceptedPreview: GeneratedImageAcceptedPreview;
		block: GeneratedImageTargetBlock;
		index: GeneratedImageTargetIndex;
		selection: GeneratedImageTargetSelection;
		sourceRevision: number;
	}>,
): GeneratedImageTargetResult {
	if (
		!safeNonNegativeInteger(input.selection.start) ||
		!safeNonNegativeInteger(input.selection.end) ||
		input.selection.start > input.selection.end ||
		input.selection.end > input.index.source.length
	)
		return failed("generated-image-target-selection-invalid");
	const images = outermostImagesForBlock(
		input.index.source,
		input.index,
		input.block,
	);
	if ("string" === typeof images) return failed(images);
	const matches = images.filter(
		(image) =>
			input.selection.start >= image.start && input.selection.end <= image.end,
	);
	if (matches.length > 1) {
		return failed("generated-image-target-selection-ambiguous");
	}
	const image = matches[0];
	if (!image) return failed("generated-image-target-image-unavailable");
	const ordinal = images.indexOf(image);
	if (ordinal < 0) return failed("generated-image-target-image-unavailable");
	return associateGeneratedImageTarget({
		acceptedPreview: input.acceptedPreview,
		block: input.block,
		index: input.index,
		ordinal,
		sourceRevision: input.sourceRevision,
	});
}

export function generatedImageTargetMatchesIdentity(
	target: GeneratedImageTarget,
	identity: Readonly<{
		acceptedPreview: GeneratedImageAcceptedPreview;
		sourceRevision: number;
	}>,
): boolean {
	return (
		target.sourceRevision === identity.sourceRevision &&
		target.acceptedPreview.revision === identity.acceptedPreview.revision &&
		target.acceptedPreview.signature === identity.acceptedPreview.signature
	);
}
