import type { ImageUploadPort } from '../../../contracts/ports/image-upload-port';
import type {
  WechatClipboardCopyOptions,
  WechatClipboardPort,
  WechatClipboardPreparationOptions,
  WechatClipboardResult
} from '../../../contracts/ports/wechat-clipboard-port';
import type { WechatVisualRasterizationPort } from '../../../contracts/ports/wechat-visual-rasterization-port';
import {
  coalescedBackgroundPreparation,
  preparedClipboardPayload,
  preparedLayoutSignature
} from './wechat-background-preparation';
import {
  type BackgroundAssetCache,
  type BackgroundPreparationCache,
  type BrowserWechatClipboardRuntime,
  CLIPBOARD_COMMIT_TIMEOUT_MS,
  type ClipboardItemConstructor,
  type PreparedClipboardPayload,
  type PreparedClipboardPayloadCache,
  type SerializedClipboardPayload,
  clipboardSourceMarkup,
  previewReady,
  withTimeout
} from './wechat-clipboard-shared';
import {
  serializeClipboardPayload,
  serializeClipboardPayloadSynchronously
} from './wechat-payload-serializer';
import {
  MAX_WECHAT_PNG_DIMENSION,
  MAX_WECHAT_PNG_PIXELS,
  MAX_WECHAT_PNG_TOTAL_BYTES,
  MAX_WECHAT_PNG_TOTAL_PIXELS,
  MAX_WECHAT_PNG_VISUALS,
  WECHAT_PNG_RASTERIZATION_TIMEOUT_MS,
  WECHAT_PNG_TRANSACTION_TIMEOUT_MS,
  WechatPngConversionError,
  type WechatPngConversionState,
  pngScale
} from './wechat-png-conversion';

export {
  CLIPBOARD_COMMIT_TIMEOUT_MS,
  MAX_WECHAT_PNG_DIMENSION,
  MAX_WECHAT_PNG_PIXELS,
  MAX_WECHAT_PNG_TOTAL_BYTES,
  MAX_WECHAT_PNG_TOTAL_PIXELS,
  MAX_WECHAT_PNG_VISUALS,
  WECHAT_PNG_RASTERIZATION_TIMEOUT_MS,
  WECHAT_PNG_TRANSACTION_TIMEOUT_MS
};
export type { BrowserWechatClipboardRuntime, ClipboardItemConstructor };

function legacyCopy(html: string, runtime: BrowserWechatClipboardRuntime): boolean {
  const selection = runtime.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
    : [];
  const activeElement = runtime.document.activeElement as HTMLElement | null;
  const container = runtime.document.createElement('div');
  const range = runtime.document.createRange();
  const offset = runtime.pageOffset();
  container.className = 'easymde-copy-sandbox';
  container.setAttribute('contenteditable', 'true');
  container.innerHTML = html;
  runtime.document.body.appendChild(container);
  try {
    if (selection) {
      selection.removeAllRanges();
      range.selectNodeContents(container);
      selection.addRange(range);
    }
    try {
      return 'function' === typeof runtime.document.execCommand
        && runtime.document.execCommand('copy');
    } catch {
      return false;
    }
  } finally {
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((storedRange) => {
        selection.addRange(storedRange);
      });
    }
    container.remove();
    if (activeElement?.isConnected) activeElement.focus({ preventScroll: true });
    runtime.scrollTo(offset.x, offset.y);
  }
}

export function createBrowserWechatClipboard(
  runtime: BrowserWechatClipboardRuntime
): WechatClipboardPort {
  const backgroundAssetCache: BackgroundAssetCache = new Map();
  const preparedPayloads: PreparedClipboardPayloadCache = new WeakMap();
  const backgroundPreparations: BackgroundPreparationCache = new WeakMap();
  let preparationSequence = 0;
  const nextPreparationSequence = (): number => {
    preparationSequence += 1;
    return preparationSequence;
  };

  return {
    async prepare(
      preview: HTMLElement,
      options: WechatClipboardPreparationOptions = {}
    ): Promise<void> {
      if (!previewReady(preview)) return;
      if (options.background) {
        await coalescedBackgroundPreparation(
          preview,
          runtime,
          backgroundAssetCache,
          preparedPayloads,
          backgroundPreparations,
          nextPreparationSequence,
          options.signal
        );
        return;
      }
      await preparedClipboardPayload(
        preview,
        runtime,
        backgroundAssetCache,
        preparedPayloads,
        nextPreparationSequence,
        true
      ).promise;
    },
    async copy(
      preview: HTMLElement,
      options: WechatClipboardCopyOptions = {}
    ): Promise<WechatClipboardResult> {
      const hiddenFormalPreview =
        Boolean(options.resolvePreview)
        && preview.classList.contains('easymde-preview-surface-hidden');
      if (!hiddenFormalPreview && !previewReady(preview)) {
        return { code: 'wechat-preview-unavailable', status: 'failed' };
      }

      const pngConversionEnabled = true === options.pngConversionEnabled;
      const requiresPreviewResolution = Boolean(
        hiddenFormalPreview
        || (
          options.resolvePreview
          && preview.querySelector('[data-easymde-preview-window-spacer]')
        )
      );
      if (pngConversionEnabled && (!runtime.write || !runtime.clipboardItem)) {
        return {
          code: 'wechat-png-clipboard-failed',
          sideEffects: 'none',
          status: 'failed'
        };
      }
      if (pngConversionEnabled && (
        !options.visualRasterizationPort
        || !options.imageUploadPort
        || !Number.isSafeInteger(options.postId)
        || (options.postId as number) < 0
        || !Number.isSafeInteger(options.maxBytes)
        || (options.maxBytes as number) < 1
      )) {
        return {
          code: 'wechat-png-rasterization-failed',
          sideEffects: 'none',
          status: 'failed'
        };
      }

      if (runtime.write && runtime.clipboardItem) {
        const readyPreview = requiresPreviewResolution
          ? Promise.resolve().then(() => options.resolvePreview?.()).then(
              (resolved) => {
                if (!resolved || !previewReady(resolved)) {
                  throw new Error('wechat-preview-unavailable');
                }
                return resolved;
              }
            )
          : Promise.resolve(preview);
        const prepared = pngConversionEnabled || requiresPreviewResolution
          ? null
          : preparedClipboardPayload(
            preview,
            runtime,
            backgroundAssetCache,
            preparedPayloads,
            nextPreparationSequence
          );
        const nonPngPrepared = prepared as PreparedClipboardPayload | null;
        const conversionState: WechatPngConversionState = {
          uploadsMayRemain: false
        };
        const conversionController = pngConversionEnabled
          ? new AbortController()
          : null;
        const propagateConversionAbort = () => conversionController?.abort();
        if (conversionController && options.signal) {
          if (options.signal.aborted) {
            conversionController.abort();
          } else {
            options.signal.addEventListener('abort', propagateConversionAbort, {
              once: true
            });
          }
        }
        const detachConversionAbort = () => {
          options.signal?.removeEventListener('abort', propagateConversionAbort);
        };
        const conversionSignal = conversionController?.signal
          ?? options.signal
          ?? new AbortController().signal;
        const conversionRasterizationPort = options.visualRasterizationPort as WechatVisualRasterizationPort | undefined;
        const conversionImageUploadPort = options.imageUploadPort as ImageUploadPort | undefined;
        let startConversion: () => void = () => undefined;
        const payload = pngConversionEnabled
          ? new Promise<SerializedClipboardPayload>((resolve, reject) => {
            startConversion = () => {
              void readyPreview.then((resolvedPreview) => {
                const sourceMarkup = clipboardSourceMarkup(resolvedPreview);
                return serializeClipboardPayload(
                  resolvedPreview,
                  runtime,
                  backgroundAssetCache,
                  null,
                  {
                    isCurrent: () => (
                      (!options.isCurrent || options.isCurrent())
                      && clipboardSourceMarkup(resolvedPreview) === sourceMarkup
                    ),
                    imageUploadPort: conversionImageUploadPort as ImageUploadPort,
                    maxBytes: options.maxBytes as number,
                    postId: options.postId as number,
                    rasterizationPort: conversionRasterizationPort as WechatVisualRasterizationPort,
                    scale: pngScale(resolvedPreview),
                    signal: conversionSignal,
                    state: conversionState
                  }
                );
              }).then(resolve, reject);
            };
          })
          : requiresPreviewResolution
            ? readyPreview.then((resolvedPreview) =>
                preparedClipboardPayload(
                  resolvedPreview,
                  runtime,
                  backgroundAssetCache,
                  preparedPayloads,
                  nextPreparationSequence
                ).promise
              )
            : (prepared as PreparedClipboardPayload).promise;
        const htmlBlob = pngConversionEnabled
          ? payload.then(({ html }) => new runtime.blob([html], { type: 'text/html' }))
          : nonPngPrepared?.payload
            ? new runtime.blob([nonPngPrepared.payload.html], { type: 'text/html' })
            : payload.then(({ html }) => new runtime.blob([html], { type: 'text/html' }));
        const textBlob = pngConversionEnabled
          ? payload.then(({ text }) => new runtime.blob([text], { type: 'text/plain' }))
          : nonPngPrepared?.payload
            ? new runtime.blob([nonPngPrepared.payload.text], { type: 'text/plain' })
            : payload.then(({ text }) => new runtime.blob([text], { type: 'text/plain' }));
        const observeBlobRejections = (): void => {
          if (htmlBlob instanceof Promise) void htmlBlob.catch(() => undefined);
          if (textBlob instanceof Promise) void textBlob.catch(() => undefined);
        };
        const fallbackAfterSynchronousModernFailure = (): WechatClipboardResult => {
          if (pngConversionEnabled) {
            return {
              code: 'wechat-png-clipboard-failed',
              sideEffects: 'none',
              status: 'failed'
            };
          }
          if (requiresPreviewResolution) {
            return { code: 'wechat-copy-failed', status: 'failed' };
          }
          // ClipboardItem construction and write invocation still happen in
          // the originating click task. A payload prepared before that task
          // may therefore use the activation-safe compatibility path.
          if (!nonPngPrepared) return { code: 'wechat-copy-failed', status: 'failed' };
          const currentMarkup = clipboardSourceMarkup(preview);
          const currentLayoutSignature = preparedLayoutSignature(preview, runtime);
          const preparedFallback = nonPngPrepared.payload
            && nonPngPrepared.sourceMarkup === currentMarkup
            && nonPngPrepared.layoutSignature === currentLayoutSignature
            ? nonPngPrepared.payload
            : nonPngPrepared.payload
              && nonPngPrepared.recoveredAtLayoutSignature === currentLayoutSignature
              && nonPngPrepared.fallback?.sourceMarkup === currentMarkup
              ? nonPngPrepared.payload
            : !nonPngPrepared.payload && nonPngPrepared.fallback?.sourceMarkup === currentMarkup
              ? nonPngPrepared.fallback.payload
              : null;
          // If no background payload has completed yet, the compatibility
          // path gets one synchronous attempt in the click task. A remote
          // theme image deliberately returns null here; claiming success
          // without its materialized asset would produce a partial paste.
          const fallback = preparedFallback
            ?? serializeClipboardPayloadSynchronously(preview, runtime);
          if (fallback && legacyCopy(fallback.html, runtime)) {
            return { method: 'legacy', status: 'copied' };
          }
          return { code: 'wechat-copy-failed', status: 'failed' };
        };
        let writePromise: Promise<void>;
        try {
          const item = new runtime.clipboardItem({
            // ClipboardItem accepts PromiseLike<Blob> values. Starting the
            // write before theme-image fetches finish keeps the click's
            // transient user activation attached to the operation.
            'text/html': htmlBlob,
            'text/plain': textBlob
          } as unknown as Record<string, Blob>);
          writePromise = Promise.resolve(runtime.write([item]));
        } catch {
          conversionController?.abort();
          detachConversionAbort();
          observeBlobRejections();
          return fallbackAfterSynchronousModernFailure();
        }
        if (pngConversionEnabled) startConversion?.();
        try {
          const writeOutcome = writePromise.then(
            () => ({ error: null }),
            (error: unknown) => ({ error })
          );
          if (pngConversionEnabled) {
            await withTimeout(
              Promise.all([payload, htmlBlob, textBlob]),
              WECHAT_PNG_TRANSACTION_TIMEOUT_MS,
              'wechat-png-transaction-timeout'
            );
          } else {
            await Promise.all([payload, htmlBlob, textBlob]);
          }
          const { error } = await withTimeout(
            writeOutcome,
            CLIPBOARD_COMMIT_TIMEOUT_MS
          );
          if (null !== error) throw error;
          return { method: 'clipboard', status: 'copied' };
        } catch (error: unknown) {
          // A rejected modern write resumes after an await and cannot safely
          // enter the activation-sensitive legacy path. Report the failure
          // instead of attempting an asynchronous compatibility fallback.
          observeBlobRejections();
          if (pngConversionEnabled) {
            conversionController?.abort();
            if (
              error instanceof Error
              && 'wechat-png-transaction-timeout' === error.message
            ) {
              conversionState.uploadsMayRemain = true;
            }
            return {
              code: error instanceof WechatPngConversionError
                ? error.code
                : error instanceof Error
                  && 'wechat-png-transaction-timeout' === error.message
                  ? 'wechat-png-transaction-timeout'
                : 'wechat-png-clipboard-failed',
              sideEffects: conversionState.uploadsMayRemain
                ? 'uploads-may-remain'
                : 'none',
              status: 'failed'
            };
          }
          return { code: 'wechat-copy-failed', status: 'failed' };
        } finally {
          detachConversionAbort();
        }
      }

      if (pngConversionEnabled) {
        return {
          code: 'wechat-png-clipboard-failed',
          sideEffects: 'none',
          status: 'failed'
        };
      }

      if (requiresPreviewResolution) {
        return { code: 'wechat-copy-failed', status: 'failed' };
      }

      // Legacy execCommand must run synchronously in the originating click
      // task. Preview preparation owns the asynchronous serialization; a
      // click before it resolves is a truthful failure and can be retried once
      // the next stable Preview notification has completed preparation.
      const prepared = preparedPayloads.get(preview);
      const currentMarkup = clipboardSourceMarkup(preview);
      const currentLayoutSignature = preparedLayoutSignature(preview, runtime);
      const payload = prepared?.payload
        && prepared.sourceMarkup === currentMarkup
        && prepared.layoutSignature === currentLayoutSignature
        ? prepared.payload
        : prepared?.payload
          && prepared.recoveredAtLayoutSignature === currentLayoutSignature
          && prepared.fallback?.sourceMarkup === currentMarkup
          ? prepared.payload
        : prepared && prepared.payload === null
          && prepared.fallback
          && prepared.fallback.sourceMarkup === currentMarkup
          ? prepared.fallback.payload
          : null;
      if (!payload) {
        const current = preparedPayloads.get(preview);
        const preparationIsPending = Boolean(current && !current.payload);
        if (!preparationIsPending) {
          const retry = preparedClipboardPayload(
            preview,
            runtime,
            backgroundAssetCache,
            preparedPayloads,
            nextPreparationSequence,
            true
          );
          void retry.promise.catch(() => undefined);
        }
        return { code: 'wechat-copy-failed', status: 'failed' };
      }
      if (legacyCopy(payload.html, runtime)) {
        return { method: 'legacy', status: 'copied' };
      }
      return { code: 'wechat-clipboard-unsupported', status: 'failed' };
    }
  };
}
