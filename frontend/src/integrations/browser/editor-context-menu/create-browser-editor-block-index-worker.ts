import {
	type EditorBlockIndexWorkerRequest,
	type EditorMarkdownBlockIndexBuildInput,
	type EditorMarkdownBlockIndexData,
	type EditorMarkdownBlockIndexFailureCode,
	type EditorMarkdownBlockIndexPort,
	hasExactEditorBlockIndexKeys,
	isReferenceLabelCaseFoldProfile,
	MAX_EDITOR_BLOCK_INDEX_SOURCE_BYTES,
	type ReferenceLabelCaseFoldProfile,
	resolveEditorBlockIndexWorkerUrl,
} from "../../../contracts/ports/editor-block-index-port";
import {
	now,
	record,
	safeInteger,
	VALIDATION_SLICE_MS,
	yieldValidation,
} from "./editor-block-index-validation-budget";
import { validateEditorBlockIndexPackedData } from "./validate-editor-block-index-packed-data";

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

type BrowserEditorBlockIndexWorkerRuntime = Readonly<{
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
const FAILURE_CODES = new Set<EditorMarkdownBlockIndexFailureCode>([
	"editor-block-index-build-failed",
	"editor-block-index-reference-profile-unavailable",
	"editor-block-index-source-too-large",
	"editor-block-index-worker-profile-invalid",
	"editor-block-index-worker-request-invalid",
]);

function failure(code: EditorMarkdownBlockIndexFailureCode): Error {
	return new Error(code);
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

function validateBuildInput(
	input: EditorMarkdownBlockIndexBuildInput,
	signal: AbortSignal,
	profile: ReferenceLabelCaseFoldProfile,
): EditorBlockIndexWorkerRequest | Promise<EditorBlockIndexWorkerRequest> {
	if (
		!record(input) ||
		!hasExactEditorBlockIndexKeys(input as Record<string, unknown>, [
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
	referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile;
	location?: Readonly<{ href: string; origin: string }>;
	timeoutMs?: number;
	Worker?: EditorBlockIndexWorkerConstructor;
	workerUrl: string;
}>;

export function createBrowserEditorBlockIndexWorker(
	options: CreateBrowserEditorBlockIndexWorkerOptions,
): EditorMarkdownBlockIndexPort {
	if (!isReferenceLabelCaseFoldProfile(options.referenceLabelCaseFoldProfile)) {
		throw failure("editor-block-index-worker-profile-invalid");
	}
	const profile = options.referenceLabelCaseFoldProfile;
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
			requestInput = validateBuildInput(input, signal, profile);
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
					const validation = await validateEditorBlockIndexPackedData(
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
