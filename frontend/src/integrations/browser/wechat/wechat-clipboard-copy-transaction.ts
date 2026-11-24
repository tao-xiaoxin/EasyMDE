import type {
	WechatClipboardCopyOptions,
	WechatClipboardResult,
} from "../../../contracts/ports/wechat-clipboard-port";
import type { BackgroundAssetCache } from "./wechat-background-images";
import type {
	BrowserWechatClipboardRuntime,
	ClipboardItemConstructor,
} from "./wechat-clipboard-runtime";
import type { WechatMathVectorAtlasLoader } from "./wechat-math-vector-portable";
import type { SerializedClipboardPayload } from "./wechat-portable-serialization";
import type { PreparedClipboardPayloadCache } from "./wechat-prepared-payload-state";
import type { PreviewGeometryMeasurementCache } from "./wechat-preview-geometry-cache";
import { previewReady } from "./wechat-source-freshness";

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
	awaitCompletion: (
		writeResult: Promise<ClipboardWriteResult>,
		writeFailure: Promise<never>,
		htmlBlob: Promise<Blob>,
		textBlob: Promise<Blob>,
		cancellationFailure: Promise<never>,
	) => Promise<void>;
	cleanup: () => void;
	finalize: () => void;
	finishTotal: (terminal: "error" | "success") => void;
	onFailure: (error: unknown) => WechatClipboardResult;
	onSynchronousModernFailure: () => WechatClipboardResult;
	payload: Promise<SerializedClipboardPayload>;
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

export function resolveReadyPreview(
	preview: HTMLElement,
	options: WechatClipboardCopyOptions,
	requiresPreviewResolution: boolean,
): Promise<HTMLElement> {
	const resolveController = requiresPreviewResolution
		? new AbortController()
		: null;
	const propagateResolveAbort = () => resolveController?.abort();
	if (resolveController && options.signal) {
		if (options.signal.aborted) {
			resolveController.abort();
		} else {
			options.signal.addEventListener("abort", propagateResolveAbort, {
				once: true,
			});
		}
	}
	const detachResolveAbort = (): void => {
		if (options.signal) {
			options.signal.removeEventListener("abort", propagateResolveAbort);
		}
	};
	return requiresPreviewResolution
		? Promise.resolve()
				.then(() => options.resolvePreview?.(resolveController?.signal))
				.then((resolved) => {
					if (!resolved || !previewReady(resolved)) {
						throw new Error("wechat-preview-unavailable");
					}
					return resolved;
				})
				.finally(detachResolveAbort)
		: Promise.resolve(preview);
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
		} catch {
			transaction.finishTotal("error");
			transaction.cleanup();
			detachCopyAbort();
			observeBlobRejections();
			if (copyWasCancelled()) {
				return transaction.onFailure(new Error("wechat-copy-cancelled"));
			}
			return transaction.onSynchronousModernFailure();
		}
	}
	transaction.start();
	try {
		const writeResult = writePromise.then(
			() => ({ error: null }),
			(error: unknown) => ({ error }),
		);
		const writeFailure = writeResult.then(({ error }) => {
			if (null !== error) throw error;
			return new Promise<never>(() => undefined);
		});
		await transaction.awaitCompletion(
			writeResult,
			writeFailure,
			htmlBlob,
			textBlob,
			deferredPayloadFailure,
		);
		transaction.finalize();
		transaction.finishTotal("success");
		return { method: "clipboard", status: "copied" };
	} catch (error: unknown) {
		// A rejected modern write resumes after an await and cannot safely
		// enter the activation-sensitive legacy path. Report the failure
		// instead of attempting an asynchronous compatibility fallback.
		observeBlobRejections();
		const rejectPayload = rejectDeferredPayload as
			| ((error: unknown) => void)
			| null;
		rejectPayload?.(error);
		return transaction.onFailure(error);
	} finally {
		transaction.cleanup();
		detachCopyAbort();
	}
}
