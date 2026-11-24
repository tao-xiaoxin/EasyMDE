import type {
	WechatClipboardCopyOptions,
	WechatClipboardPort,
	WechatClipboardPreparationOptions,
	WechatClipboardResult,
} from "../../../contracts/ports/wechat-clipboard-port";
import type { BackgroundAssetCache } from "./wechat-background-images";
import { executeLegacyWechatCopy } from "./wechat-clipboard-copy-legacy";
import { createPngCopyTransaction } from "./wechat-clipboard-copy-png";
import { createPortableCopyTransaction } from "./wechat-clipboard-copy-portable";
import {
	executeModernCopyTransaction,
	isModernClipboardRuntime,
	resolveReadyPreview,
	type WechatClipboardCopySharedState,
} from "./wechat-clipboard-copy-transaction";
import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import {
	createWechatMathVectorAtlasCache,
	createWechatMathVectorAtlasLoaderIfConfigured,
	type WechatMathVectorAtlasLoader,
} from "./wechat-math-vector-portable";
import {
	type BackgroundPreparationCache,
	coalescedBackgroundPreparation,
	type PreparedClipboardPayloadCache,
	preparedClipboardPayload,
} from "./wechat-prepared-payload";
import {
	cachedPreviewGeometryMeasurement,
	type PreviewGeometryMeasurementCache,
	preparePreviewGeometryOnly,
} from "./wechat-preview-geometry-cache";
import { rememberPreviewWidthValue } from "./wechat-preview-measurement";
import {
	previewReady,
	type WechatClipboardCopyGuard,
} from "./wechat-source-freshness";

export { CLIPBOARD_COMMIT_TIMEOUT_MS } from "./wechat-clipboard-copy-transaction";
export type {
	BrowserWechatClipboardRuntime,
	ClipboardItemConstructor,
} from "./wechat-clipboard-runtime";
export {
	MAX_WECHAT_PNG_DIMENSION,
	MAX_WECHAT_PNG_PIXELS,
	MAX_WECHAT_PNG_TOTAL_BYTES,
	MAX_WECHAT_PNG_TOTAL_PIXELS,
	MAX_WECHAT_PNG_UPLOAD_CONCURRENCY,
	MAX_WECHAT_PNG_VISUALS,
	WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS,
	WECHAT_PNG_RASTERIZATION_TIMEOUT_MS,
	WECHAT_PNG_TRANSACTION_TIMEOUT_MS,
} from "./wechat-png-conversion-policy";

export function createBrowserWechatClipboard(
	runtime: BrowserWechatClipboardRuntime,
): WechatClipboardPort {
	const backgroundAssetCache: BackgroundAssetCache = new Map();
	const preparedPayloads: PreparedClipboardPayloadCache = new WeakMap();
	const backgroundPreparations: BackgroundPreparationCache = new WeakMap();
	const geometryMeasurements: PreviewGeometryMeasurementCache = new WeakMap();
	const mathVectorAtlasCache = createWechatMathVectorAtlasCache();
	const mathVectorAtlasLoader: WechatMathVectorAtlasLoader | undefined =
		createWechatMathVectorAtlasLoaderIfConfigured(
			runtime,
			mathVectorAtlasCache,
		);
	let preparationSequence = 0;
	const nextPreparationSequence = (): number => {
		preparationSequence += 1;
		return preparationSequence;
	};
	const shared: WechatClipboardCopySharedState = {
		backgroundAssetCache,
		geometryMeasurements,
		mathVectorAtlasLoader,
		nextPreparationSequence,
		preparedPayloads,
		runtime,
	};

	return {
		releasePrepared(preview: HTMLElement): void {
			const prepared = preparedPayloads.get(preview);
			if (!prepared) return;
			preparedPayloads.delete(preview);
			prepared.backgroundCancel?.();
			prepared.cancel?.();
			prepared.contentBoxes?.cleanup();
			if (prepared.fallback?.contentBoxes !== prepared.contentBoxes) {
				prepared.fallback?.contentBoxes?.cleanup();
			}
		},
		rememberPreviewWidth(preview: HTMLElement): void {
			rememberPreviewWidthValue(preview);
		},
		async prepare(
			preview: HTMLElement,
			options: WechatClipboardPreparationOptions = {},
		): Promise<void> {
			if (!previewReady(preview)) return;
			if (options.geometryOnly) {
				await preparePreviewGeometryOnly(
					preview,
					runtime,
					geometryMeasurements,
					options.signal,
				);
				return;
			}
			if (options.background) {
				await coalescedBackgroundPreparation(
					preview,
					runtime,
					backgroundAssetCache,
					preparedPayloads,
					backgroundPreparations,
					nextPreparationSequence,
					options.signal,
					mathVectorAtlasLoader,
				);
				return;
			}
			await preparedClipboardPayload(
				preview,
				runtime,
				backgroundAssetCache,
				preparedPayloads,
				nextPreparationSequence,
				true,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				mathVectorAtlasLoader,
			).promise;
		},
		async copy(
			preview: HTMLElement,
			options: WechatClipboardCopyOptions = {},
		): Promise<WechatClipboardResult> {
			const hiddenFormalPreview =
				Boolean(options.resolvePreview) &&
				preview.classList.contains("easymde-preview-surface-hidden");
			if (!hiddenFormalPreview && !previewReady(preview)) {
				return { code: "wechat-preview-unavailable", status: "failed" };
			}

			const pngConversionEnabled = true === options.pngConversionEnabled;
			const copyGuard: WechatClipboardCopyGuard = {
				isCurrent: options.isCurrent,
				signal: options.signal,
			};
			const copyWasCancelled = (): boolean =>
				Boolean(options.signal?.aborted) ||
				Boolean(options.isCurrent && !options.isCurrent());
			const requiresPreviewResolution = Boolean(
				options.resolvePreview &&
					(hiddenFormalPreview ||
						preview.querySelector("[data-easymde-preview-window-spacer]")),
			);
			if (pngConversionEnabled && (!runtime.write || !runtime.clipboardItem)) {
				return {
					code: "wechat-png-clipboard-failed",
					sideEffects: "none",
					status: "failed",
				};
			}
			if (
				pngConversionEnabled &&
				(!options.visualRasterizationPort ||
					!options.imageUploadPort ||
					!Number.isSafeInteger(options.postId) ||
					(options.postId as number) < 0 ||
					!Number.isSafeInteger(options.maxBytes) ||
					(options.maxBytes as number) < 1)
			) {
				return {
					code: "wechat-png-rasterization-failed",
					sideEffects: "none",
					status: "failed",
				};
			}
			if (copyWasCancelled()) {
				return pngConversionEnabled
					? {
							code: "wechat-png-rasterization-cancelled",
							sideEffects: "none",
							status: "failed",
						}
					: { code: "wechat-copy-failed", status: "failed" };
			}

			if (isModernClipboardRuntime(runtime)) {
				// Claim a matching hidden geometry lease synchronously with the user
				// activation. Theme/mode layout work may make the Preview visible
				// before the async resolver runs; once claimed, the foreground copy
				// owns the lease and background preparation cannot abort its host.
				const foregroundGeometryMeasurement = pngConversionEnabled
					? cachedPreviewGeometryMeasurement(
							preview,
							runtime,
							geometryMeasurements,
						)
					: null;
				const readyPreview = resolveReadyPreview(
					preview,
					options,
					requiresPreviewResolution,
				);
				const transaction = pngConversionEnabled
					? createPngCopyTransaction({
							copyGuard,
							copyWasCancelled,
							foregroundGeometryMeasurement,
							options,
							preview,
							readyPreview,
							shared,
						})
					: createPortableCopyTransaction({
							copyGuard,
							copyWasCancelled,
							preview,
							readyPreview,
							requiresPreviewResolution,
							shared,
						});
				return executeModernCopyTransaction(
					runtime,
					options,
					copyWasCancelled,
					transaction,
				);
			}

			if (pngConversionEnabled) {
				return {
					code: "wechat-png-clipboard-failed",
					sideEffects: "none",
					status: "failed",
				};
			}

			if (requiresPreviewResolution) {
				return { code: "wechat-copy-failed", status: "failed" };
			}

			return executeLegacyWechatCopy(preview, shared);
		},
	};
}
