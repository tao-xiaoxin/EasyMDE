import type {
	WechatClipboardCopyOptions,
	WechatClipboardResult,
} from "../../../contracts/ports/wechat-clipboard-port";
import type { BackgroundAssetCache } from "./wechat-background-images";
import {
	type BrowserWechatClipboardRuntime,
	type ClipboardItemConstructor,
	withTimeout,
} from "./wechat-clipboard-runtime";
import { previewReady } from "./wechat-copy-preconditions";
import type { WechatMathVectorAtlasLoader } from "./wechat-math-vector-portable";
import type { SerializedClipboardPayload } from "./wechat-portable-serialization";
import type { PreparedClipboardPayloadCache } from "./wechat-prepared-payload-state";
import type { PreviewGeometryMeasurementCache } from "./wechat-preview-geometry-cache";

export const CLIPBOARD_COMMIT_TIMEOUT_MS = 10_000;

export type ClipboardWriteResult = Readonly<{ error: unknown | null }>;

export type PrestartedModernClipboardWrite = Readonly<{
	bind: (htmlBlob: Promise<Blob>, textBlob: Promise<Blob>) => void;
	deadlineMs?: number;
	disposeColdSourceFreshness?: () => void;
	isColdSourceFresh?: () => boolean;
	reject: (error: unknown) => void;
	writePromise: Promise<void>;
}>;

export function remainingTransactionTimeoutMs(
	deadlineMs: number | undefined,
	defaultTimeoutMs: number,
): number {
	if (undefined === deadlineMs || !Number.isFinite(deadlineMs)) {
		return defaultTimeoutMs;
	}
	return Math.min(defaultTimeoutMs, Math.max(0, deadlineMs - Date.now()));
}

export type ModernClipboardRuntime = BrowserWechatClipboardRuntime &
	Readonly<{
		clipboardItem: ClipboardItemConstructor;
		write: NonNullable<BrowserWechatClipboardRuntime["write"]>;
	}>;

export type ModernCopyTransaction = Readonly<{
	assertBlobCurrent: () => void;
	cleanup: () => void;
	commitTimeoutCode?: string | undefined;
	deadlineMs?: number | undefined;
	defaultTimeoutMs: number;
	finalize: () => void;
	finishTotal: (terminal: "error" | "success") => void;
	onFailure: (error: unknown) => WechatClipboardResult;
	onSynchronousModernFailure: () => WechatClipboardResult;
	payload: Promise<SerializedClipboardPayload>;
	preparationTimeoutCode: string;
	start: () => void;
}>;

export type WechatClipboardCopySharedState = Readonly<{
	backgroundAssetCache: BackgroundAssetCache;
	geometryMeasurements: PreviewGeometryMeasurementCache;
	mathVectorAtlasLoader: WechatMathVectorAtlasLoader | undefined;
	nextPreparationSequence: () => number;
	preparedPayloads: PreparedClipboardPayloadCache;
	runtime: BrowserWechatClipboardRuntime;
}>;

export function isModernClipboardRuntime(
	runtime: BrowserWechatClipboardRuntime,
): runtime is ModernClipboardRuntime {
	return Boolean(runtime.write && runtime.clipboardItem);
}

export type ReadyPreviewResolution = Readonly<{
	abort: () => void;
	promise: Promise<HTMLElement>;
	start: () => void;
}>;

export function resolveReadyPreview(
	preview: HTMLElement,
	options: WechatClipboardCopyOptions,
	requiresPreviewResolution: boolean,
): ReadyPreviewResolution {
	if (!requiresPreviewResolution) {
		return {
			abort: () => undefined,
			promise: Promise.resolve(preview),
			start: () => undefined,
		};
	}
	const resolveController = new AbortController();
	let settled = false;
	let started = false;
	let resolveReady!: (element: HTMLElement) => void;
	let rejectReady!: (error: unknown) => void;
	const promise = new Promise<HTMLElement>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	// Attach a passive observer immediately so early exits before start()
	// (e.g. synchronous ClipboardItem failure) never leak unhandled rejections.
	void promise.catch(() => undefined);

	const detachResolveAbort = (): void => {
		options.signal?.removeEventListener("abort", abort);
	};
	const finishResolve = (element: HTMLElement): void => {
		if (settled) return;
		settled = true;
		detachResolveAbort();
		resolveReady(element);
	};
	const finishReject = (error: unknown): void => {
		if (settled) return;
		settled = true;
		detachResolveAbort();
		rejectReady(error);
	};
	const abort = (): void => {
		if (!settled && !resolveController.signal.aborted) {
			resolveController.abort();
		}
		finishReject(new Error("wechat-copy-cancelled"));
	};

	if (options.signal) {
		if (options.signal.aborted) {
			resolveController.abort();
		} else {
			options.signal.addEventListener("abort", abort, {
				once: true,
			});
		}
	}

	const start = (): void => {
		if (started) return;
		started = true;
		if (settled || resolveController.signal.aborted) {
			abort();
			return;
		}
		Promise.resolve()
			.then(() => {
				if (settled || resolveController.signal.aborted) {
					throw new Error("wechat-copy-cancelled");
				}
				return options.resolvePreview?.(resolveController.signal);
			})
			.then((resolved) => {
				if (settled || resolveController.signal.aborted) {
					throw new Error("wechat-copy-cancelled");
				}
				if (!resolved || !previewReady(resolved)) {
					throw new Error("wechat-preview-unavailable");
				}
				finishResolve(resolved);
			})
			.catch((error: unknown) => {
				finishReject(error);
			});
	};

	return {
		abort,
		promise,
		start,
	};
}

export async function executeModernCopyTransaction(
	runtime: ModernClipboardRuntime,
	options: WechatClipboardCopyOptions,
	copyWasCancelled: () => boolean,
	transaction: ModernCopyTransaction,
	prestartedWrite?: PrestartedModernClipboardWrite,
): Promise<WechatClipboardResult> {
	let rejectDeferredPayload: ((error: unknown) => void) | null = null;
	const deferredPayloadFailure = new Promise<never>((_resolve, reject) => {
		rejectDeferredPayload = reject;
	});
	void deferredPayloadFailure.catch(() => undefined);
	const abortDeferredPayload = (): void => {
		rejectDeferredPayload?.(new Error("wechat-copy-cancelled"));
	};
	const detachCopyAbort = (): void => {
		options.signal?.removeEventListener("abort", abortDeferredPayload);
	};
	if (options.signal) {
		if (options.signal.aborted) {
			abortDeferredPayload();
		} else {
			options.signal.addEventListener("abort", abortDeferredPayload, {
				once: true,
			});
		}
	}
	const gateBlob = (source: Promise<Blob>): Promise<Blob> =>
		Promise.race([
			source.then((blob) => {
				transaction.assertBlobCurrent();
				return blob;
			}),
			deferredPayloadFailure,
		]);
	const htmlBlob = gateBlob(
		transaction.payload.then(
			({ html }) => new runtime.blob([html], { type: "text/html" }),
		),
	);
	const textBlob = gateBlob(
		transaction.payload.then(
			({ text }) => new runtime.blob([text], { type: "text/plain" }),
		),
	);
	const observeBlobRejections = (): void => {
		if (htmlBlob instanceof Promise) void htmlBlob.catch(() => undefined);
		if (textBlob instanceof Promise) void textBlob.catch(() => undefined);
	};
	const rejectDeferred = (error: unknown): void => {
		const rejectPayload = rejectDeferredPayload as
			| ((reason: unknown) => void)
			| null;
		rejectPayload?.(error);
	};
	let writePromise: Promise<void>;
	if (prestartedWrite) {
		prestartedWrite.bind(htmlBlob, textBlob);
		writePromise = prestartedWrite.writePromise;
	} else {
		try {
			const item = new runtime.clipboardItem({
				// ClipboardItem accepts PromiseLike<Blob> values. Starting the
				// write before theme-image fetches finish keeps the click's
				// transient user activation attached to the operation.
				"text/html": htmlBlob,
				"text/plain": textBlob,
			});
			writePromise = Promise.resolve(runtime.write([item]));
		} catch (error: unknown) {
			observeBlobRejections();
			rejectDeferred(error);
			transaction.finishTotal("error");
			transaction.cleanup();
			detachCopyAbort();
			if (copyWasCancelled()) {
				return transaction.onFailure(new Error("wechat-copy-cancelled"));
			}
			return transaction.onSynchronousModernFailure();
		}
	}
	// Observe writePromise before transaction.start() so an immediate write
	// rejection cleans up and cancels the transaction before readiness
	// continuations can run layout walks or schedule deferred browser tasks.
	const writeResult: Promise<ClipboardWriteResult> = writePromise.then(
		() => ({ error: null }),
		(error: unknown) => {
			observeBlobRejections();
			rejectDeferred(error);
			transaction.cleanup();
			return { error };
		},
	);
	transaction.start();
	try {
		const writeFailure = writeResult.then(({ error }) => {
			if (null !== error) throw error;
			return new Promise<never>(() => undefined);
		});
		// Attach a passive observer immediately so an early throw (e.g. an
		// expired cold-copy deadline) never leaves writeFailure unobserved when
		// cleanup rejects deferred Blobs and causes writePromise to reject.
		void writeFailure.catch(() => undefined);

		const prepTimeoutMs = remainingTransactionTimeoutMs(
			transaction.deadlineMs,
			transaction.defaultTimeoutMs,
		);
		if (prepTimeoutMs <= 0) {
			throw new Error(transaction.preparationTimeoutCode);
		}
		const payloadReady = Promise.all([transaction.payload, htmlBlob, textBlob]);
		void payloadReady.catch(() => undefined);
		await withTimeout(
			Promise.race([payloadReady, writeFailure, deferredPayloadFailure]),
			prepTimeoutMs,
			transaction.preparationTimeoutCode,
		);

		const { error } = await withTimeout(
			Promise.race([writeResult, deferredPayloadFailure]),
			CLIPBOARD_COMMIT_TIMEOUT_MS,
			transaction.commitTimeoutCode,
		);
		if (null !== error) throw error;

		transaction.finalize();
		transaction.finishTotal("success");
		return { method: "clipboard", status: "copied" };
	} catch (error: unknown) {
		// A rejected modern write resumes after an await and cannot safely
		// enter the activation-sensitive legacy path. Report the failure
		// instead of attempting an asynchronous compatibility fallback.
		observeBlobRejections();
		rejectDeferred(error);
		return transaction.onFailure(error);
	} finally {
		transaction.cleanup();
		detachCopyAbort();
	}
}
