import {
	type EditorBlockIndexWorkerRequest,
	type EditorMarkdownBlockIndexBuildInput,
	type EditorMarkdownBlockIndexData,
	type EditorMarkdownBlockIndexPort,
	isReferenceLabelCaseFoldProfile,
	type ReferenceLabelCaseFoldProfile,
	resolveEditorBlockIndexWorkerUrl,
} from "../../../contracts/ports/editor-block-index-port";
import {
	failure,
	record,
	responseCode,
	validateBuildInput,
	validateData,
} from "./editor-block-index-worker-protocol";

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

	const onIdleWorkerEvent: WorkerEventListener = () => {
		const idle = worker;
		if (!idle || pending) return;
		detachIdleListeners(idle);
		worker = null;
		terminate(idle);
	};

	const attachIdleListeners = (candidate: EditorBlockIndexWorkerLike): void => {
		candidate.addEventListener("error", onIdleWorkerEvent);
		candidate.addEventListener("messageerror", onIdleWorkerEvent);
		candidate.addEventListener("message", onIdleWorkerEvent);
	};

	const detachIdleListeners = (candidate: EditorBlockIndexWorkerLike): void => {
		candidate.removeEventListener("error", onIdleWorkerEvent);
		candidate.removeEventListener("messageerror", onIdleWorkerEvent);
		candidate.removeEventListener("message", onIdleWorkerEvent);
	};

	const settle = (
		request: PendingBuild,
		result: { error?: Error; value?: EditorMarkdownBlockIndexData },
	): void => {
		if (pending !== request) return;
		pending = null;
		clearTimeout(request.timer);
		request.signal?.removeEventListener("abort", request.onAbort);
		request.worker.removeEventListener("message", request.onMessage);
		request.worker.removeEventListener("error", request.onError);
		request.worker.removeEventListener("messageerror", request.onMessageError);
		if (!result.error && result.value && active) {
			worker = request.worker;
			attachIdleListeners(request.worker);
			request.resolve(result.value);
			return;
		}
		if (worker === request.worker) worker = null;
		terminate(request.worker);
		if (result.error) request.reject(result.error);
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
		const inactiveFailure = (): Error | null => {
			if (!active) return failure("editor-block-index-disposed");
			if (token !== buildToken) return failure("editor-block-index-stale");
			if (signal?.aborted) return failure("editor-block-index-cancelled");
			return null;
		};
		const startRequest = (
			validatedInput: EditorBlockIndexWorkerRequest,
		): Promise<EditorMarkdownBlockIndexData> => {
			const inactive = inactiveFailure();
			if (inactive) return Promise.reject(inactive);

			if (pending) {
				settle(pending, { error: failure("editor-block-index-stale") });
			}

			let nextWorker: EditorBlockIndexWorkerLike;
			if (worker) {
				nextWorker = worker;
				detachIdleListeners(nextWorker);
			} else {
				try {
					nextWorker = new runtime.Worker(workerUrl, { type: "classic" });
				} catch {
					return Promise.reject(
						failure("editor-block-index-worker-construction-failed"),
					);
				}
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
						recordResponse.generation !== validatedInput.generation ||
						recordResponse.revision !== validatedInput.revision
					) {
						settle(request, { error: failure("editor-block-index-stale") });
						return;
					}
					if ("error" === recordResponse.type) {
						const code = responseCode(recordResponse.code);
						settle(request, {
							error: failure(
								code ?? "editor-block-index-worker-message-invalid",
							),
						});
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
			return requestInput.then(startRequest, (error) =>
				Promise.reject(
					inactiveFailure() ??
						(error instanceof Error
							? error
							: failure("editor-block-index-input-invalid")),
				),
			);
		}
		return startRequest(requestInput);
	};

	return {
		build,
		dispose() {
			if (!active) return;
			active = false;
			buildToken += 1;
			if (pending) {
				settle(pending, { error: failure("editor-block-index-disposed") });
			} else if (worker) {
				const idle = worker;
				worker = null;
				detachIdleListeners(idle);
				terminate(idle);
			}
			worker = null;
		},
	};
}
