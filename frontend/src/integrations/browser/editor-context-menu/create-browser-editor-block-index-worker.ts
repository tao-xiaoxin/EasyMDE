import {
	EDITOR_BLOCK_INDEX_IMAGE_STATUS_READY,
	EDITOR_BLOCK_INDEX_IMAGE_STATUS_UNAVAILABLE,
	EDITOR_BLOCK_INDEX_PACKED_BLOCK_FIELDS,
	EDITOR_BLOCK_INDEX_PACKED_IMAGE_BLOCK_FIELDS,
	EDITOR_BLOCK_INDEX_PACKED_IMAGE_RANGE_FIELDS,
	EDITOR_BLOCK_INDEX_PACKED_MATH_FIELDS,
	EDITOR_MARKDOWN_BLOCK_KIND_ORDER,
	type EditorBlockIndexWorkerRequest,
	type EditorMarkdownBlockIndexBuildInput,
	type EditorMarkdownBlockIndexData,
	type EditorMarkdownBlockIndexDataWithImages,
	type EditorMarkdownBlockIndexFailureCode,
	type EditorMarkdownBlockIndexPackedData,
	type EditorMarkdownBlockIndexPort,
	type EditorMarkdownImageBlock,
	type EditorMarkdownImageBlockStatus,
	type EditorMarkdownImageRange,
	type EditorMarkdownMathSpan,
	type EditorMarkdownSourceBlock,
	MAX_EDITOR_BLOCK_INDEX_BLOCKS,
	MAX_EDITOR_BLOCK_INDEX_IMAGES,
	MAX_EDITOR_BLOCK_INDEX_MATH_SPANS,
	MAX_EDITOR_BLOCK_INDEX_SOURCE_BYTES,
	resolveEditorBlockIndexWorkerUrl,
} from "../../../contracts/ports/editor-block-index-port";

type WorkerEventListener = (event: Event | MessageEvent<unknown>) => void;

type EditorBlockIndexWorkerLike = Readonly<{
	addEventListener: (type: string, listener: WorkerEventListener) => void;
	postMessage: (
		message: EditorBlockIndexWorkerRequest,
		transfer?: Transferable[] | StructuredSerializeOptions,
	) => void;
	removeEventListener: (type: string, listener: WorkerEventListener) => void;
	terminate: () => void;
}>;

type EditorBlockIndexWorkerConstructor = new (
	scriptURL: string,
	options?: WorkerOptions,
) => EditorBlockIndexWorkerLike;

export type BrowserEditorBlockIndexWorkerRuntime = Readonly<{
	Worker: EditorBlockIndexWorkerConstructor;
	location: Readonly<{ href: string; origin: string }>;
}>;

type PendingBuild = Readonly<{
	onAbort: () => void;
	onError: WorkerEventListener;
	onMessage: WorkerEventListener;
	onMessageError: WorkerEventListener;
	request: EditorBlockIndexWorkerRequest;
	reject: (reason: Error) => void;
	resolve: (value: EditorMarkdownBlockIndexData) => void;
	signal?: AbortSignal;
	timer: ReturnType<typeof setTimeout>;
	worker: EditorBlockIndexWorkerLike;
}>;

const DEFAULT_WORKER_TIMEOUT_MS = 10_000;
const VALIDATION_SLICE_MS = 4;
const VALIDATION_FIRST_BATCH_SIZE = 8;
const FAILURE_CODES = new Set<EditorMarkdownBlockIndexFailureCode>([
	"editor-block-index-build-failed",
	"editor-block-index-source-too-large",
	"editor-block-index-worker-request-invalid",
]);

function failure(code: EditorMarkdownBlockIndexFailureCode): Error {
	return new Error(code);
}

function record(value: unknown): Record<string, unknown> | null {
	return value && "object" === typeof value && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function safeInteger(value: unknown): value is number {
	return "number" === typeof value && Number.isSafeInteger(value) && value >= 0;
}

type SourceByteLength = number | Promise<number>;

function continueSourceByteLength(
	source: string,
	start: number,
	bytes: number,
	signal: AbortSignal,
): Promise<number> {
	return (async () => {
		await yieldValidation();
		if (signal.aborted) throw failure("editor-block-index-cancelled");
		let sliceStarted = now();
		let length = bytes;
		let processed = 0;
		for (let index = start; index < source.length; index += 1) {
			if (signal.aborted) throw failure("editor-block-index-cancelled");
			const codePoint = source.codePointAt(index) ?? 0;
			if (codePoint > 0xffff) index += 1;
			length +=
				codePoint <= 0x7f
					? 1
					: codePoint <= 0x7ff
						? 2
						: codePoint <= 0xffff
							? 3
							: 4;
			processed += 1;
			if (processed >= 256 && now() - sliceStarted >= VALIDATION_SLICE_MS) {
				await yieldValidation();
				sliceStarted = now();
				processed = 0;
				if (signal.aborted) throw failure("editor-block-index-cancelled");
			}
		}
		return length;
	})();
}

function sourceByteLength(
	source: string,
	signal: AbortSignal,
): SourceByteLength {
	let bytes = 0;
	const sliceStarted = now();
	let processed = 0;
	for (let index = 0; index < source.length; index += 1) {
		if (signal.aborted) throw failure("editor-block-index-cancelled");
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
		processed += 1;
		if (processed >= 256 && now() - sliceStarted >= VALIDATION_SLICE_MS) {
			return continueSourceByteLength(source, index + 1, bytes, signal);
		}
	}
	return bytes;
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
	cancelled: () => boolean,
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

function validateBuildInput(
	input: EditorMarkdownBlockIndexBuildInput,
	signal: AbortSignal,
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
		return { ...input, type: "build" };
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

type DataValidation =
	| Readonly<{ status: "cancelled" | "invalid" | "too-large" }>
	| Readonly<{
			status: "valid";
			value: EditorMarkdownBlockIndexDataWithImages;
	  }>;

function now(): number {
	return "function" === typeof globalThis.performance?.now
		? globalThis.performance.now()
		: Date.now();
}

function yieldValidation(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
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

async function validatePackedData(
	data: EditorMarkdownBlockIndexPackedData,
	source: string,
	cancelled: () => boolean,
): Promise<DataValidation> {
	if (
		!exactKeys(data as unknown as Record<string, unknown>, [
			"blockCount",
			"blocks",
			"format",
			"imageCount",
			"images",
			"length",
			"mathSpanCount",
			"mathSpans",
		]) ||
		data.format !== "packed-v2" ||
		data.length !== source.length ||
		!safeInteger(data.length) ||
		!safeInteger(data.blockCount) ||
		!safeInteger(data.mathSpanCount) ||
		!safeInteger(data.imageCount)
	)
		return { status: "invalid" };
	if (
		data.blockCount > MAX_EDITOR_BLOCK_INDEX_BLOCKS ||
		data.mathSpanCount > MAX_EDITOR_BLOCK_INDEX_MATH_SPANS ||
		data.imageCount > MAX_EDITOR_BLOCK_INDEX_IMAGES
	)
		return { status: "too-large" };
	const blocksBuffer = packedBuffer(
		data.blocks,
		data.blockCount,
		EDITOR_BLOCK_INDEX_PACKED_BLOCK_FIELDS,
	);
	const mathBuffer = packedBuffer(
		data.mathSpans,
		data.mathSpanCount,
		EDITOR_BLOCK_INDEX_PACKED_MATH_FIELDS,
	);
	const imageBuffer = exactPackedWords(
		data.images,
		data.blockCount * EDITOR_BLOCK_INDEX_PACKED_IMAGE_BLOCK_FIELDS +
			data.imageCount * EDITOR_BLOCK_INDEX_PACKED_IMAGE_RANGE_FIELDS,
	);
	if (!blocksBuffer || !mathBuffer || !imageBuffer)
		return { status: "invalid" };

	const lines = await lineCount(source, cancelled);
	if (null === lines) return { status: "cancelled" };
	const blocks: EditorMarkdownSourceBlock[] = [];
	let previousBlockTo = 0;
	let sliceStarted = now();
	let processed = 0;
	let yielded = false;
	for (let index = 0; index < data.blockCount; index += 1) {
		if (cancelled()) return { status: "cancelled" };
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
		processed += 1;
		if (
			now() - sliceStarted >= VALIDATION_SLICE_MS ||
			(!yielded && processed >= VALIDATION_FIRST_BATCH_SIZE)
		) {
			await yieldValidation();
			sliceStarted = now();
			yielded = true;
		}
	}

	const mathSpans: EditorMarkdownMathSpan[] = [];
	let previousMathTo = 0;
	let mathBlockIndex = 0;
	processed = 0;
	for (let index = 0; index < data.mathSpanCount; index += 1) {
		if (cancelled()) return { status: "cancelled" };
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
			if (now() - sliceStarted >= VALIDATION_SLICE_MS) {
				await yieldValidation();
				sliceStarted = now();
				if (cancelled()) return { status: "cancelled" };
			}
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
		processed += 1;
		if (
			now() - sliceStarted >= VALIDATION_SLICE_MS ||
			(!yielded && processed >= VALIDATION_FIRST_BATCH_SIZE)
		) {
			await yieldValidation();
			sliceStarted = now();
			yielded = true;
		}
	}

	const imageBlocks: EditorMarkdownImageBlock[] = [];
	let firstImageIndex = 0;
	processed = 0;
	sliceStarted = now();
	yielded = false;
	for (let index = 0; index < data.blockCount; index += 1) {
		if (cancelled()) return { status: "cancelled" };
		const offset = index * EDITOR_BLOCK_INDEX_PACKED_IMAGE_BLOCK_FIELDS;
		const block = blocks[index];
		const candidateFirst = imageBuffer[offset] ?? -1;
		const count = imageBuffer[offset + 1] ?? -1;
		const status = imageStatus(imageBuffer[offset + 2] ?? -1);
		if (
			!safeInteger(candidateFirst) ||
			!safeInteger(count) ||
			candidateFirst !== firstImageIndex ||
			candidateFirst + count > data.imageCount ||
			!status ||
			("unavailable" === status && count !== 0) ||
			!block ||
			(("code" === block.kind || !block.editable) && count !== 0)
		)
			return { status: "invalid" };
		imageBlocks.push({ count, firstImageIndex: candidateFirst, status });
		firstImageIndex += count;
		processed += 1;
		if (
			now() - sliceStarted >= VALIDATION_SLICE_MS ||
			(!yielded && processed >= VALIDATION_FIRST_BATCH_SIZE)
		) {
			await yieldValidation();
			sliceStarted = now();
			yielded = true;
		}
	}
	if (firstImageIndex !== data.imageCount) return { status: "invalid" };

	const imageRanges: EditorMarkdownImageRange[] = [];
	let imageBlockIndex = 0;
	let previousImageTo = 0;
	processed = 0;
	sliceStarted = now();
	yielded = false;
	for (let index = 0; index < data.imageCount; index += 1) {
		if (cancelled()) return { status: "cancelled" };
		while (
			imageBlockIndex < imageBlocks.length &&
			index >=
				(imageBlocks[imageBlockIndex]?.firstImageIndex ?? data.imageCount) +
					(imageBlocks[imageBlockIndex]?.count ?? 0)
		) {
			imageBlockIndex += 1;
			if (now() - sliceStarted >= VALIDATION_SLICE_MS) {
				await yieldValidation();
				sliceStarted = now();
				if (cancelled()) return { status: "cancelled" };
			}
		}
		const block = blocks[imageBlockIndex];
		const imageBlock = imageBlocks[imageBlockIndex];
		const offset =
			data.blockCount * EDITOR_BLOCK_INDEX_PACKED_IMAGE_BLOCK_FIELDS +
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
			return { status: "invalid" };
		imageRanges.push({ from, to });
		previousImageTo = to;
		processed += 1;
		if (
			now() - sliceStarted >= VALIDATION_SLICE_MS ||
			(!yielded && processed >= VALIDATION_FIRST_BATCH_SIZE)
		) {
			await yieldValidation();
			sliceStarted = now();
			yielded = true;
		}
	}
	return {
		status: "valid",
		value: {
			blocks,
			imageBlocks,
			imageRanges,
			length: data.length,
			mathSpans,
		},
	};
}

async function validateData(
	value: unknown,
	source: string,
	cancelled: () => boolean,
): Promise<DataValidation> {
	const data = record(value);
	if ("packed-v2" !== data?.format) return { status: "invalid" };
	return validatePackedData(
		data as unknown as EditorMarkdownBlockIndexPackedData,
		source,
		cancelled,
	);
}

function responseCode(
	value: unknown,
): EditorMarkdownBlockIndexFailureCode | null {
	return "string" === typeof value &&
		FAILURE_CODES.has(value as EditorMarkdownBlockIndexFailureCode)
		? (value as EditorMarkdownBlockIndexFailureCode)
		: null;
}

function defaultRuntime(): BrowserEditorBlockIndexWorkerRuntime | null {
	const candidate = globalThis as typeof globalThis & {
		Worker?: EditorBlockIndexWorkerConstructor;
		location?: Readonly<{ href: string; origin: string }>;
	};
	if ("function" !== typeof candidate.Worker || !candidate.location)
		return null;
	return { Worker: candidate.Worker, location: candidate.location };
}

export type CreateBrowserEditorBlockIndexWorkerOptions = Readonly<{
	assetBaseUrl: string;
	location?: Readonly<{ href: string; origin: string }>;
	timeoutMs?: number;
	Worker?: EditorBlockIndexWorkerConstructor;
	workerUrl: string;
}>;

export function createBrowserEditorBlockIndexWorker(
	options: CreateBrowserEditorBlockIndexWorkerOptions,
): EditorMarkdownBlockIndexPort {
	const runtime =
		options.Worker && options.location
			? { Worker: options.Worker, location: options.location }
			: defaultRuntime();
	if (!runtime) {
		throw failure("editor-block-index-worker-construction-failed");
	}
	let workerUrl: string;
	try {
		workerUrl = resolveEditorBlockIndexWorkerUrl(
			options.workerUrl,
			options.assetBaseUrl,
			runtime.location.origin,
		);
	} catch {
		throw failure("editor-block-index-worker-url-invalid");
	}
	const timeoutMs = options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw failure("editor-block-index-worker-timeout-invalid");
	}
	let active = true;
	let buildToken = 0;
	let worker: EditorBlockIndexWorkerLike | null = null;
	let pending: PendingBuild | null = null;

	const terminate = (candidate: EditorBlockIndexWorkerLike | null): void => {
		if (!candidate) return;
		try {
			candidate.terminate();
		} catch {
			// Worker termination is best effort after its request is already rejected.
		}
	};

	const settle = (
		request: PendingBuild,
		result: { error?: Error; value?: EditorMarkdownBlockIndexData },
	): void => {
		if (pending !== request) return;
		pending = null;
		worker = null;
		clearTimeout(request.timer);
		request.signal?.removeEventListener("abort", request.onAbort);
		request.worker.removeEventListener("message", request.onMessage);
		request.worker.removeEventListener("error", request.onError);
		request.worker.removeEventListener("messageerror", request.onMessageError);
		terminate(request.worker);
		if (result.error) request.reject(result.error);
		else if (result.value) request.resolve(result.value);
		else request.reject(failure("editor-block-index-result-invalid"));
	};

	const build = (
		input: EditorMarkdownBlockIndexBuildInput,
		signal: AbortSignal,
	): Promise<EditorMarkdownBlockIndexData> => {
		if (!active) return Promise.reject(failure("editor-block-index-disposed"));
		const token = ++buildToken;
		let requestInput:
			| EditorBlockIndexWorkerRequest
			| Promise<EditorBlockIndexWorkerRequest>;
		try {
			requestInput = validateBuildInput(input, signal);
		} catch (error) {
			return Promise.reject(
				error instanceof Error
					? error
					: failure("editor-block-index-input-invalid"),
			);
		}
		const startRequest = (
			validatedInput: EditorBlockIndexWorkerRequest,
		): Promise<EditorMarkdownBlockIndexData> => {
			if (!active)
				return Promise.reject(failure("editor-block-index-disposed"));
			if (token !== buildToken)
				return Promise.reject(failure("editor-block-index-stale"));
			if (signal?.aborted)
				return Promise.reject(failure("editor-block-index-cancelled"));

			if (pending) {
				settle(pending, { error: failure("editor-block-index-stale") });
			} else if (worker) {
				terminate(worker);
				worker = null;
			}

			let nextWorker: EditorBlockIndexWorkerLike;
			try {
				nextWorker = new runtime.Worker(workerUrl, { type: "classic" });
			} catch {
				return Promise.reject(
					failure("editor-block-index-worker-construction-failed"),
				);
			}

			return new Promise<EditorMarkdownBlockIndexData>((resolve, reject) => {
				let request!: PendingBuild;
				const onAbort = (): void =>
					settle(request, { error: failure("editor-block-index-cancelled") });
				const onError: WorkerEventListener = () =>
					settle(request, {
						error: failure("editor-block-index-worker-failed"),
					});
				const onMessageError: WorkerEventListener = () =>
					settle(request, {
						error: failure("editor-block-index-worker-message-invalid"),
					});
				const processMessage = async (
					event: Event | MessageEvent<unknown>,
				): Promise<void> => {
					if (
						!(event instanceof MessageEvent) &&
						(!event || !("data" in event))
					) {
						settle(request, {
							error: failure("editor-block-index-worker-message-invalid"),
						});
						return;
					}
					const response = (event as MessageEvent<unknown>).data as unknown;
					const recordResponse = record(response);
					if (
						!recordResponse ||
						("result" !== recordResponse.type &&
							"error" !== recordResponse.type)
					) {
						settle(request, {
							error: failure("editor-block-index-worker-message-invalid"),
						});
						return;
					}
					if (
						("number" === typeof recordResponse.generation &&
							recordResponse.generation !== validatedInput.generation) ||
						("number" === typeof recordResponse.revision &&
							recordResponse.revision !== validatedInput.revision)
					) {
						settle(request, { error: failure("editor-block-index-stale") });
						return;
					}
					if ("error" === recordResponse.type) {
						if (
							recordResponse.generation !== validatedInput.generation ||
							recordResponse.revision !== validatedInput.revision
						) {
							settle(request, { error: failure("editor-block-index-stale") });
							return;
						}
						const code = responseCode(recordResponse.code);
						settle(request, {
							error: failure(
								code ?? "editor-block-index-worker-message-invalid",
							),
						});
						return;
					}
					if (
						recordResponse.generation !== validatedInput.generation ||
						recordResponse.revision !== validatedInput.revision
					) {
						settle(request, { error: failure("editor-block-index-stale") });
						return;
					}
					const validation = await validateData(
						recordResponse.data,
						validatedInput.source,
						() => pending !== request || Boolean(signal?.aborted) || !active,
					);
					if (pending !== request || "cancelled" === validation.status) return;
					if ("valid" !== validation.status) {
						settle(request, {
							error: failure(
								"too-large" === validation.status
									? "editor-block-index-result-too-large"
									: "editor-block-index-result-invalid",
							),
						});
						return;
					}
					settle(request, { value: validation.value });
				};
				const onMessage: WorkerEventListener = (event): void => {
					void processMessage(event).catch(() => {
						settle(request, {
							error: failure("editor-block-index-result-invalid"),
						});
					});
				};
				const configuredRequest: PendingBuild = {
					request: validatedInput,
					reject,
					resolve,
					...(signal ? { signal } : {}),
					onAbort,
					onError,
					onMessage,
					onMessageError,
					timer: setTimeout(
						() =>
							settle(request, {
								error: failure("editor-block-index-worker-timeout"),
							}),
						timeoutMs,
					),
					worker: nextWorker,
				};
				request = configuredRequest;
				pending = request;
				worker = nextWorker;
				nextWorker.addEventListener("message", onMessage);
				nextWorker.addEventListener("error", onError);
				nextWorker.addEventListener("messageerror", onMessageError);
				signal?.addEventListener("abort", onAbort, { once: true });
				try {
					nextWorker.postMessage(validatedInput);
				} catch {
					settle(configuredRequest, {
						error: failure("editor-block-index-worker-post-failed"),
					});
				}
			});
		};
		if (requestInput instanceof Promise) {
			return requestInput.then(startRequest, (error) => {
				if (!active)
					return Promise.reject(failure("editor-block-index-disposed"));
				if (token !== buildToken)
					return Promise.reject(failure("editor-block-index-stale"));
				if (signal?.aborted)
					return Promise.reject(failure("editor-block-index-cancelled"));
				return Promise.reject(
					error instanceof Error
						? error
						: failure("editor-block-index-input-invalid"),
				);
			});
		}
		return startRequest(requestInput);
	};

	return {
		build,
		dispose() {
			if (!active) return;
			active = false;
			buildToken += 1;
			if (pending)
				settle(pending, { error: failure("editor-block-index-disposed") });
			else terminate(worker);
			worker = null;
		},
	};
}
