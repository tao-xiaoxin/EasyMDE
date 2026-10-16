import type { ImageUploadPort } from '../../../contracts/ports/image-upload-port';

import type {
  WechatClipboardCopyOptions,
  WechatClipboardPort,
  WechatClipboardPreparationOptions,
  WechatClipboardResult
} from '../../../contracts/ports/wechat-clipboard-port';

import type { WechatVisualRasterizationPort } from '../../../contracts/ports/wechat-visual-rasterization-port';

import type { BackgroundAssetCache } from './wechat-background-images';
import { mermaidCaptureSnapshotIsCurrent, mermaidResponsiveSnapshotIsCurrent } from './wechat-capture-plan';
import {
  type BrowserWechatClipboardRuntime,
  createSerializationYield,
  WECHAT_COPY_TIMING_NAMES,
  waitForBrowserTask,
  withTimeout
} from './wechat-clipboard-runtime';
import { createDimensionSemanticsContext, type WechatDimensionSemanticsContext } from './wechat-dimension-semantics';
import {
  preparedDimensionGeometrySignatureWithYield,
  preparedDimensionSemanticsSignature,
  preparedLayoutSignature
} from './wechat-fidelity-signature';
import { mermaidSourceUsesAutoBlockMargins } from './wechat-mermaid-geometry';
import {
  assertPngConversionCurrent,
  logPngFailureDiagnostic,
  pngScale,
  WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS,
  WECHAT_PNG_TRANSACTION_TIMEOUT_MS,
  type WechatPngConversionContext,
  WechatPngConversionError,
  type WechatPngConversionState
} from './wechat-png-conversion-policy';
import {
  type SerializedClipboardPayload,
  serializeClipboardPayload,
  serializeClipboardPayloadSynchronously
} from './wechat-portable-serialization';
import {
  type BackgroundPreparationCache,
  coalescedBackgroundPreparation,
  type PreparedClipboardPayload,
  type PreparedClipboardPayloadCache,
  preparedClipboardPayload,
  preparedClipboardPayloadAfterWrite,
  reusablePreparedClipboardPayload
} from './wechat-prepared-payload';
import {
  createPreviewMeasurementLease,
  createPreviewTransitionLease,
  rememberPreviewWidthValue,
  type WechatPreviewTransitionLease
} from './wechat-preview-measurement';
import {
  cachedPreviewGeometryMeasurement,
  preparePreviewGeometryOnly,
  previewMeasurementLeaseSourceMatches,
  waitForPreviewMeasurement,
  type PreviewGeometryMeasurementCache
} from './wechat-preview-geometry-cache';
import {
  assertCopyPreviewCurrent,
  assertPortableCopyCurrent,
  type ClipboardSourceFreshnessGuard,
  type ClipboardSourceFreshnessState,
  clipboardSourceMarkup,
  createClipboardSourceFreshnessGuard,
  previewReady,
  type WechatClipboardCopyGuard
} from './wechat-source-freshness';
import { createTaskCheckboxGeometryLease, type TaskCheckboxGeometryLease } from './wechat-task-geometry';
import { beginWechatTiming, runWechatSyncTiming } from './wechat-timing';
import {
  createWechatCopyTotalTiming,
  createWechatReadinessTiming,
  type WechatReadinessTiming
} from './wechat-copy-timing';

export type {
  BrowserWechatClipboardRuntime,
  ClipboardItemConstructor
} from './wechat-clipboard-runtime';
export {
  MAX_WECHAT_PNG_DIMENSION,
  MAX_WECHAT_PNG_PIXELS,
  MAX_WECHAT_PNG_TOTAL_BYTES,
  MAX_WECHAT_PNG_TOTAL_PIXELS,
  MAX_WECHAT_PNG_UPLOAD_CONCURRENCY,
  MAX_WECHAT_PNG_VISUALS,
  WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS,
  WECHAT_PNG_RASTERIZATION_TIMEOUT_MS,
  WECHAT_PNG_TRANSACTION_TIMEOUT_MS
} from './wechat-png-conversion-policy';

export const CLIPBOARD_COMMIT_TIMEOUT_MS = 10_000;

type ClipboardWriteResult = Readonly<{ error: unknown | null }>;

type ModernCopyTransaction = Readonly<{
  assertBlobCurrent: () => void;
  awaitCompletion: (
    writeResult: Promise<ClipboardWriteResult>,
    writeFailure: Promise<never>,
    htmlBlob: Promise<Blob>,
    textBlob: Promise<Blob>
  ) => Promise<void>;
  cleanup: () => void;
  finalize: () => void;
  onFailure: (error: unknown) => WechatClipboardResult;
  onSynchronousModernFailure: () => WechatClipboardResult;
  payload: Promise<SerializedClipboardPayload>;
  start: () => void;
}>;

function legacyCopy(html: string, text: string, runtime: BrowserWechatClipboardRuntime): boolean {
  const selection = runtime.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)) : [];
  const activeElement = runtime.document.activeElement as HTMLElement | null;
  const container = runtime.document.createElement('div');
  const range = runtime.document.createRange();
  const offset = runtime.pageOffset();
  container.className = 'easymde-copy-sandbox';
  container.setAttribute('contenteditable', 'true');
  container.innerHTML = html;
  runtime.document.body.appendChild(container);
  let clipboardSubmission: 'pending' | 'complete' | 'failed' = 'pending';
  const handleCopy = (event: Event): void => {
    const clipboardData = (event as ClipboardEvent).clipboardData;
    if (!clipboardData) {
      clipboardSubmission = 'failed';
      event.preventDefault();
      return;
    }
    try {
      clipboardData.setData('text/html', html);
      clipboardData.setData('text/plain', text);
      clipboardSubmission = 'complete';
      event.preventDefault();
    } catch {
      clipboardSubmission = 'failed';
      event.preventDefault();
    }
  };
  runtime.document.addEventListener('copy', handleCopy, true);
  const getClipboardSubmission = (): 'pending' | 'complete' | 'failed' => clipboardSubmission;
  try {
    if (selection) {
      selection.removeAllRanges();
      range.selectNodeContents(container);
      selection.addRange(range);
    }
    try {
      const commandSucceeded = 'function' === typeof runtime.document.execCommand && runtime.document.execCommand('copy');
      return Boolean(commandSucceeded && 'complete' === getClipboardSubmission());
    } catch {
      return false;
    }
  } finally {
    runtime.document.removeEventListener('copy', handleCopy, true);
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

export function createBrowserWechatClipboard(runtime: BrowserWechatClipboardRuntime): WechatClipboardPort {
  const backgroundAssetCache: BackgroundAssetCache = new Map();
  const preparedPayloads: PreparedClipboardPayloadCache = new WeakMap();
  const backgroundPreparations: BackgroundPreparationCache = new WeakMap();
  const geometryMeasurements: PreviewGeometryMeasurementCache = new WeakMap();
  let preparationSequence = 0;
  const nextPreparationSequence = (): number => {
    preparationSequence += 1;
    return preparationSequence;
  };

  return {
    rememberPreviewWidth(preview: HTMLElement): void {
      rememberPreviewWidthValue(preview);
    },
    async prepare(preview: HTMLElement, options: WechatClipboardPreparationOptions = {}): Promise<void> {
      if (!previewReady(preview)) return;
      if (options.geometryOnly) {
        await preparePreviewGeometryOnly(preview, runtime, geometryMeasurements, options.signal);
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
    async copy(preview: HTMLElement, options: WechatClipboardCopyOptions = {}): Promise<WechatClipboardResult> {
      if (!previewReady(preview)) {
        return { code: 'wechat-preview-unavailable', status: 'failed' };
      }

      const pngConversionEnabled = true === options.pngConversionEnabled;
      const copyGuard: WechatClipboardCopyGuard = {
        isCurrent: options.isCurrent,
        signal: options.signal
      };
      const copyWasCancelled = (): boolean =>
        Boolean(options.signal?.aborted) || Boolean(options.isCurrent && !options.isCurrent());
      const requiresPreviewResolution = Boolean(
        options.resolvePreview && preview.querySelector('[data-easymde-preview-window-spacer]')
      );
      if (pngConversionEnabled && (!runtime.write || !runtime.clipboardItem)) {
        return {
          code: 'wechat-png-clipboard-failed',
          sideEffects: 'none',
          status: 'failed'
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
          code: 'wechat-png-rasterization-failed',
          sideEffects: 'none',
          status: 'failed'
        };
      }
      if (copyWasCancelled()) {
        return pngConversionEnabled
          ? {
              code: 'wechat-png-rasterization-cancelled',
              sideEffects: 'none',
              status: 'failed'
            }
          : { code: 'wechat-copy-failed', status: 'failed' };
      }

      if (runtime.write && runtime.clipboardItem) {
        // Claim a matching hidden geometry lease synchronously with the user
        // activation.  Theme/mode layout work may make the Preview visible
        // before the async resolver runs; once claimed, the foreground copy
        // owns the lease and background preparation cannot abort its host.
        let foregroundGeometryMeasurement = pngConversionEnabled
          ? cachedPreviewGeometryMeasurement(preview, runtime, geometryMeasurements)
          : null;
        const readyPreview = requiresPreviewResolution
          ? Promise.resolve()
              .then(() => options.resolvePreview?.())
              .then((resolved) => {
                if (!resolved || !previewReady(resolved)) {
                  throw new Error('wechat-preview-unavailable');
                }
                return resolved;
              })
          : Promise.resolve(preview);
        let payloadPreview = preview;
        let payload!: Promise<SerializedClipboardPayload>;
        let startTransaction!: () => void;
        let assertBlobCurrent!: () => void;
        let awaitCompletion!: ModernCopyTransaction['awaitCompletion'];
        let finalizeTransaction!: () => void;
        let synchronousModernFailure!: () => WechatClipboardResult;
        let transactionFailure!: (error: unknown) => WechatClipboardResult;
        let cleanupTransaction!: () => void;
        let finishCopyTotal: (terminal: 'error' | 'success') => void = () => undefined;

        if (pngConversionEnabled) {
          const conversionState: WechatPngConversionState = {
            uploadsMayRemain: false
          };
          const conversionController = new AbortController();
          const propagateConversionAbort = () => conversionController.abort();
          if (options.signal) {
            if (options.signal.aborted) {
              conversionController.abort();
            } else {
              options.signal.addEventListener('abort', propagateConversionAbort, { once: true });
            }
          }
          const detachConversionAbort = () => {
            options.signal?.removeEventListener('abort', propagateConversionAbort);
          };
          const conversionSignal = conversionController.signal;
          const conversionRasterizationPort = options.visualRasterizationPort as WechatVisualRasterizationPort | undefined;
          const conversionImageUploadPort = options.imageUploadPort as ImageUploadPort | undefined;
          let disposeConversionFreshness: (() => void) | undefined;
          let disposeGeometryMeasurement: (() => void) | undefined;
          let disposeTaskGeometryLease: (() => void) | undefined;
          let disposeTransitionReadiness: (() => void) | undefined;
          let readinessTiming: WechatReadinessTiming | null = null;
          finishCopyTotal = createWechatCopyTotalTiming(
            preview.ownerDocument.defaultView?.performance,
            true
          );
          assertBlobCurrent = () => assertCopyPreviewCurrent(payloadPreview, copyGuard);
          awaitCompletion = async (writeResult, writeFailure, htmlBlob, textBlob) => {
            const completion = Promise.all([payload, htmlBlob, textBlob, writeResult]);
            const completed = await withTimeout(
              Promise.race([completion, writeFailure]),
              WECHAT_PNG_TRANSACTION_TIMEOUT_MS,
              'wechat-png-transaction-timeout'
            );
            const { error } = completed[3];
            if (null !== error) throw error;
          };
          finalizeTransaction = () => assertCopyPreviewCurrent(payloadPreview, copyGuard);
          synchronousModernFailure = () => ({
            code: 'wechat-png-clipboard-failed',
            sideEffects: 'none',
            status: 'failed'
          });
          transactionFailure = (error: unknown) => {
            finishCopyTotal('error');
            conversionController.abort();
            if (error instanceof WechatPngConversionError) logPngFailureDiagnostic(error);
            return {
              code:
                error instanceof WechatPngConversionError
                  ? error.code
                  : copyWasCancelled()
                    ? 'wechat-png-rasterization-cancelled'
                    : error instanceof Error && 'wechat-png-transaction-timeout' === error.message
                      ? 'wechat-png-transaction-timeout'
                      : 'wechat-png-clipboard-failed',
              sideEffects: conversionState.uploadsMayRemain ? 'uploads-may-remain' : 'none',
              status: 'failed'
            };
          };
          cleanupTransaction = () => {
            finishCopyTotal('error');
            readinessTiming?.fail();
            conversionController.abort();
            foregroundGeometryMeasurement?.cleanup();
            foregroundGeometryMeasurement = null;
            disposeConversionFreshness?.();
            disposeGeometryMeasurement?.();
            disposeTaskGeometryLease?.();
            disposeTransitionReadiness?.();
            detachConversionAbort();
          };
          payload = new Promise<SerializedClipboardPayload>((resolve, reject) => {
            startTransaction = () => {
              void readyPreview
                .then((resolvedPreview) => {
                  if (conversionSignal.aborted || (options.isCurrent && !options.isCurrent())) {
                    throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                  }
                  payloadPreview = resolvedPreview;
                  rememberPreviewWidthValue(resolvedPreview);
                  const sourceFreshness = createClipboardSourceFreshnessGuard(resolvedPreview);
                  disposeConversionFreshness = sourceFreshness.dispose;
                  const transferredGeometryMeasurement =
                    foregroundGeometryMeasurement && foregroundGeometryMeasurement.lease.sourceRoot === resolvedPreview
                      ? foregroundGeometryMeasurement
                      : null;
                  if (
                    transferredGeometryMeasurement &&
                    !previewMeasurementLeaseSourceMatches(transferredGeometryMeasurement.lease, resolvedPreview, runtime)
                  ) {
                    transferredGeometryMeasurement.cleanup();
                    foregroundGeometryMeasurement = null;
                    throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                  }
                  if (foregroundGeometryMeasurement && !transferredGeometryMeasurement) {
                    foregroundGeometryMeasurement.cleanup();
                    foregroundGeometryMeasurement = null;
                  }
                  const cachedGeometryMeasurement =
                    transferredGeometryMeasurement ??
                    cachedPreviewGeometryMeasurement(resolvedPreview, runtime, geometryMeasurements);
                  foregroundGeometryMeasurement = null;
                  const geometryMeasurement =
                    cachedGeometryMeasurement?.lease ??
                    createPreviewMeasurementLease(resolvedPreview, runtime, conversionSignal);
                  disposeGeometryMeasurement = () => {
                    if (cachedGeometryMeasurement) cachedGeometryMeasurement.cleanup();
                    else geometryMeasurement?.cleanup();
                  };
                  const taskGeometryLease = createTaskCheckboxGeometryLease(
                    resolvedPreview,
                    runtime,
                    conversionSignal,
                    geometryMeasurement
                  );
                  disposeTaskGeometryLease = () => taskGeometryLease?.cleanup();
                  const measurementOwnedGeometry = null !== geometryMeasurement;
                  const transitionReadiness = geometryMeasurement
                    ? null
                    : createPreviewTransitionLease([resolvedPreview], conversionSignal);
                  disposeTransitionReadiness = () => transitionReadiness?.cleanup();
                  const serializationPreview = geometryMeasurement?.root ?? resolvedPreview;
                  const geometryReadiness = cachedGeometryMeasurement
                    ? waitForPreviewMeasurement(geometryMeasurement?.ready ?? Promise.resolve(), conversionSignal)
                    : (geometryMeasurement?.ready ?? Promise.resolve());
                  readinessTiming = createWechatReadinessTiming({
                    geometryOwner: measurementOwnedGeometry ? 'measurement' : 'source',
                    geometryPairs: geometryMeasurement
                      ? geometryMeasurement.root.querySelectorAll('img').length
                      : null,
                    geometryReadiness,
                    hidden: measurementOwnedGeometry,
                    performance: resolvedPreview.ownerDocument.defaultView?.performance,
                    taskGeometryOwner: taskGeometryLease ? 'task-geometry' : 'source',
                    taskGeometryReadiness: taskGeometryLease?.ready ?? Promise.resolve(),
                    transitionReadiness: transitionReadiness?.ready ?? Promise.resolve()
                  });
                  return readinessTiming.ready
                    .then(() => {
                      const conversionContext: WechatPngConversionContext = {
                        captureBoundary: serializationPreview,
                        isCurrent: () => (!options.isCurrent || options.isCurrent()) && sourceFreshness.isCurrent(),
                        imageUploadPort: conversionImageUploadPort as ImageUploadPort,
                        maxBytes: options.maxBytes as number,
                        mermaidSnapshots: new Map(),
                        postId: options.postId as number,
                        rasterizationPort: conversionRasterizationPort as WechatVisualRasterizationPort,
                        scale: pngScale(resolvedPreview),
                        signal: conversionSignal,
                        state: conversionState
                      };
                      return waitForBrowserTask(runtime)
                        .then(async () => {
                          assertPngConversionCurrent(conversionContext);
                          const yieldToBrowser = createSerializationYield(runtime, true, conversionSignal);
                          if (!yieldToBrowser) throw new Error('wechat-copy-yield-unavailable');
                          const dimensionSemantics = createDimensionSemanticsContext(
                            serializationPreview,
                            resolvedPreview,
                            runtime
                          );
                          try {
                            dimensionSemantics.refresh();
                            const initialSignature = await preparedDimensionGeometrySignatureWithYield(
                              serializationPreview,
                              runtime,
                              yieldToBrowser,
                              conversionSignal,
                              dimensionSemantics
                            );
                            assertPngConversionCurrent(conversionContext);
                            const serialized = await serializeClipboardPayload(
                              serializationPreview,
                              runtime,
                              backgroundAssetCache,
                              yieldToBrowser,
                              conversionContext,
                              undefined,
                              resolvedPreview,
                              dimensionSemantics,
                              taskGeometryLease
                            );
                            assertPngConversionCurrent(conversionContext);
                            await geometryMeasurement?.wait();
                            await transitionReadiness?.wait();
                            await taskGeometryLease?.wait();
                            runWechatSyncTiming(
                              serializationPreview.ownerDocument.defaultView?.performance,
                              WECHAT_COPY_TIMING_NAMES.finalRawContextRefresh,
                              { mode: 'sync' },
                              () => dimensionSemantics.refresh()
                            );
                            const finalGeometryTiming = beginWechatTiming(
                              serializationPreview.ownerDocument.defaultView?.performance,
                              WECHAT_COPY_TIMING_NAMES.finalGeometry,
                              { mode: 'async' }
                            );
                            let finalSignature: string;
                            try {
                              finalSignature = await preparedDimensionGeometrySignatureWithYield(
                                serializationPreview,
                                runtime,
                                yieldToBrowser,
                                conversionSignal,
                                dimensionSemantics
                              );
                              finalGeometryTiming.finish('success');
                            } catch (error: unknown) {
                              finalGeometryTiming.finish('error');
                              throw error;
                            }
                            const finalSourceTiming = beginWechatTiming(
                              serializationPreview.ownerDocument.defaultView?.performance,
                              WECHAT_COPY_TIMING_NAMES.finalSourceFreshness,
                              { mode: 'sync' }
                            );
                            try {
                              if (initialSignature !== finalSignature) {
                                finalSourceTiming.finish('error');
                                throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                              }
                              const sourceFreshnessCurrent = sourceFreshness.finalize();
                              if (!sourceFreshnessCurrent) {
                                finalSourceTiming.finish('error');
                                throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                              }
                              for (const [source, snapshot] of conversionContext.mermaidSnapshots) {
                                if (
                                  !mermaidCaptureSnapshotIsCurrent(
                                    source,
                                    runtime,
                                    conversionContext.captureBoundary,
                                    snapshot
                                  )
                                ) {
                                  finalSourceTiming.finish('error');
                                  throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                                }
                              }
                              for (const [source, snapshot] of conversionContext.mermaidSnapshots) {
                                if (mermaidSourceUsesAutoBlockMargins(source, runtime) !== snapshot.autoMargins) {
                                  finalSourceTiming.finish('error');
                                  throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                                }
                              }
                              for (const [source, snapshot] of conversionContext.mermaidSnapshots) {
                                if (
                                  'mermaid-responsive' === snapshot.mode &&
                                  !mermaidResponsiveSnapshotIsCurrent(
                                    source,
                                    runtime,
                                    conversionContext.captureBoundary,
                                    snapshot.responsive
                                  )
                                ) {
                                  finalSourceTiming.finish('error');
                                  throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
                                }
                              }
                              finalSourceTiming.finish('success');
                            } catch (error: unknown) {
                              finalSourceTiming.finish('error');
                              throw error;
                            }
                            return serialized;
                          } finally {
                            dimensionSemantics.cleanup();
                          }
                        })
                        .finally(() => {
                          conversionContext.mermaidSnapshots.clear();
                        });
                    })
                    .finally(() => {
                      disposeGeometryMeasurement?.();
                      disposeGeometryMeasurement = undefined;
                      disposeTaskGeometryLease?.();
                      disposeTaskGeometryLease = undefined;
                      disposeTransitionReadiness?.();
                      disposeTransitionReadiness = undefined;
                      sourceFreshness.dispose();
                      disposeConversionFreshness = undefined;
                    });
                })
                .then(resolve, reject);
            };
          });
        } else {
          let portablePreparation: {
            preview: HTMLElement;
            prepared: PreparedClipboardPayload;
          } | null = null;
          let disposePortableMeasurement: (() => void) | undefined;
          const disposePortablePreparation = (): void => {
            const owned = portablePreparation;
            portablePreparation = null;
            if (!owned) return;
            const current = preparedPayloads.get(owned.preview);
            if (current !== owned.prepared || owned.prepared.payload) return;
            const recovery = owned.prepared.fallback;
            if (recovery) {
              preparedPayloads.set(owned.preview, {
                backgroundCancel: owned.prepared.backgroundCancel,
                fallback: recovery,
                dimensionSignature: recovery.dimensionSignature,
                layoutOwner: owned.prepared.layoutOwner,
                layoutSignature: recovery.layoutSignature,
                payload: recovery.payload,
                promise: Promise.resolve(recovery.payload),
                sequence: owned.prepared.sequence,
                sourceMarkup: recovery.sourceMarkup,
                recoveredAtLayoutSignature: owned.prepared.layoutSignature
              });
            } else {
              preparedPayloads.delete(owned.preview);
            }
          };
          const portableSourceFreshness: {
            current: ClipboardSourceFreshnessGuard | null;
          } = { current: null };
          let portableFreshnessClosed = false;
          let resolvePortableFreshness!: () => void;
          let rejectPortableFreshness!: (error: unknown) => void;
          const portableFreshnessReady = new Promise<void>((resolve, reject) => {
            resolvePortableFreshness = resolve;
            rejectPortableFreshness = reject;
          });
          void portableFreshnessReady.catch(() => undefined);
          const portableFreshness: ClipboardSourceFreshnessState = {
            current: () => (portableFreshnessClosed ? null : portableSourceFreshness.current),
            ready: portableFreshnessReady
          };
          const disposePortableFreshness = (): void => {
            if (portableFreshnessClosed) return;
            portableFreshnessClosed = true;
            portableSourceFreshness.current?.dispose();
            rejectPortableFreshness(new Error('wechat-copy-cancelled'));
          };
          const initializePortableFreshness = (resolvedPreview: HTMLElement): void => {
            if (portableFreshnessClosed) {
              rejectPortableFreshness(new Error('wechat-copy-cancelled'));
              return;
            }
            try {
              payloadPreview = resolvedPreview;
              rememberPreviewWidthValue(resolvedPreview);
              portableSourceFreshness.current = createClipboardSourceFreshnessGuard(resolvedPreview);
              resolvePortableFreshness();
            } catch (error: unknown) {
              rejectPortableFreshness(error);
            }
          };
          const portablePreparationIsCurrent = (): boolean => !copyWasCancelled() && null !== portableFreshness.current();
          startTransaction = () => {
            if (requiresPreviewResolution) {
              void readyPreview.then(initializePortableFreshness, (error: unknown) => rejectPortableFreshness(error));
            } else {
              initializePortableFreshness(preview);
            }
          };
          assertBlobCurrent = () => assertPortableCopyCurrent(payloadPreview, copyGuard, portableFreshness);
          awaitCompletion = async (writeResult, writeFailure, htmlBlob, textBlob) => {
            const payloadReady = withTimeout(
              Promise.all([payload, htmlBlob, textBlob]),
              WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS,
              'wechat-clipboard-preparation-timeout'
            );
            await Promise.race([
              payloadReady.then(async () => {
                const { error } = await withTimeout(writeResult, CLIPBOARD_COMMIT_TIMEOUT_MS);
                if (null !== error) throw error;
              }),
              writeFailure
            ]);
          };
          finalizeTransaction = () => {
            const sourceGuard = portableFreshness.current();
            assertCopyPreviewCurrent(payloadPreview, copyGuard);
            if (!sourceGuard?.finalize()) throw new Error('wechat-copy-stale');
            assertCopyPreviewCurrent(payloadPreview, copyGuard);
          };
          synchronousModernFailure = fallbackAfterSynchronousModernFailure;
          transactionFailure = () => ({
            code: 'wechat-copy-failed',
            status: 'failed'
          });
          cleanupTransaction = () => {
            disposePortablePreparation();
            disposePortableMeasurement?.();
            disposePortableMeasurement = undefined;
            disposePortableFreshness();
          };
          payload = requiresPreviewResolution
            ? readyPreview.then((resolvedPreview) => {
                payloadPreview = resolvedPreview;
                return preparedClipboardPayloadAfterWrite(
                  resolvedPreview,
                  runtime,
                  backgroundAssetCache,
                  preparedPayloads,
                  nextPreparationSequence,
                  copyGuard,
                  portableFreshness,
                  (cleanup) => {
                    disposePortableMeasurement = cleanup;
                  },
                  (preparedPreview, prepared) => {
                    portablePreparation = {
                      preview: preparedPreview,
                      prepared
                    };
                  },
                  portablePreparationIsCurrent
                ).then((prepared) => prepared.promise);
              })
            : preparedClipboardPayloadAfterWrite(
                preview,
                runtime,
                backgroundAssetCache,
                preparedPayloads,
                nextPreparationSequence,
                copyGuard,
                portableFreshness,
                (cleanup) => {
                  disposePortableMeasurement = cleanup;
                },
                (preparedPreview, prepared) => {
                  portablePreparation = { preview: preparedPreview, prepared };
                },
                portablePreparationIsCurrent
              ).then((prepared) => prepared.promise);
        }
        let rejectDeferredPayload: ((error: unknown) => void) | null = null;
        const deferredPayloadFailure = new Promise<never>((_resolve, reject) => {
          rejectDeferredPayload = reject;
        });
        const abortDeferredPayload = (): void => {
          rejectDeferredPayload?.(new Error('wechat-copy-cancelled'));
        };
        const detachCopyAbort = (): void => {
          options.signal?.removeEventListener('abort', abortDeferredPayload);
        };
        if (options.signal) {
          if (options.signal.aborted) {
            abortDeferredPayload();
          } else {
            options.signal.addEventListener('abort', abortDeferredPayload, {
              once: true
            });
          }
        }
        const transaction: ModernCopyTransaction = {
          assertBlobCurrent,
          awaitCompletion,
          cleanup: cleanupTransaction,
          finalize: finalizeTransaction,
          onFailure: transactionFailure,
          onSynchronousModernFailure: synchronousModernFailure,
          payload,
          start: startTransaction
        };
        const gateBlob = (source: Promise<Blob>): Promise<Blob> =>
          Promise.race([
            source.then((blob) => {
              transaction.assertBlobCurrent();
              return blob;
            }),
            deferredPayloadFailure
          ]);
        const htmlBlob = gateBlob(payload.then(({ html }) => new runtime.blob([html], { type: 'text/html' })));
        const textBlob = gateBlob(payload.then(({ text }) => new runtime.blob([text], { type: 'text/plain' })));
        const preparedBeforeWrite =
          !pngConversionEnabled && !requiresPreviewResolution ? preparedPayloads.get(preview) : null;
        const pendingFallback = preparedBeforeWrite && !preparedBeforeWrite.payload ? preparedBeforeWrite.fallback : null;
        const observeBlobRejections = (): void => {
          if (htmlBlob instanceof Promise) void htmlBlob.catch(() => undefined);
          if (textBlob instanceof Promise) void textBlob.catch(() => undefined);
        };
        function fallbackAfterSynchronousModernFailure(): WechatClipboardResult {
          if (requiresPreviewResolution) {
            return { code: 'wechat-copy-failed', status: 'failed' };
          }
          // ClipboardItem construction and write invocation still happen in
          // the originating click task. A payload prepared before that task
          // may therefore use the activation-safe compatibility path.
          let measurement = createPreviewMeasurementLease(preview, runtime);
          let transition: WechatPreviewTransitionLease | null = null;
          let taskGeometryLease: TaskCheckboxGeometryLease | null = null;
          let dimensionSemantics: WechatDimensionSemanticsContext | null = null;
          try {
            if (measurement && !measurement.isReady()) {
              const retry = preparedClipboardPayload(
                preview,
                runtime,
                backgroundAssetCache,
                preparedPayloads,
                nextPreparationSequence,
                true,
                false,
                undefined,
                measurement
              );
              void retry.promise.catch(() => undefined);
              measurement = null;
              return { code: 'wechat-copy-failed', status: 'failed' };
            }
            transition = measurement ? null : createPreviewTransitionLease([preview]);
            if (transition && !transition.isReady()) {
              return { code: 'wechat-copy-failed', status: 'failed' };
            }
            taskGeometryLease = createTaskCheckboxGeometryLease(preview, runtime, undefined, measurement);
            if (taskGeometryLease && !taskGeometryLease.isReady()) {
              return { code: 'wechat-copy-failed', status: 'failed' };
            }
            const serializationPreview = measurement?.root ?? preview;
            dimensionSemantics = createDimensionSemanticsContext(serializationPreview, preview, runtime);
            const currentMarkup = clipboardSourceMarkup(preview);
            const currentLayoutSignature = preparedLayoutSignature(
              preview,
              runtime,
              serializationPreview,
              dimensionSemantics
            );
            dimensionSemantics.refresh();
            const currentDimensionSignature = preparedDimensionSemanticsSignature(
              serializationPreview,
              runtime,
              dimensionSemantics
            );
            const prepared = preparedPayloads.get(preview);
            const preparedFallback = reusablePreparedClipboardPayload(
              prepared,
              currentMarkup,
              currentDimensionSignature,
              currentLayoutSignature,
              pendingFallback
            );
            // If no background payload has completed yet, the compatibility
            // path gets one synchronous attempt in the click task. A remote
            // theme image deliberately returns null here; claiming success
            // without its materialized asset would produce a partial paste.
            const fallback =
              preparedFallback ??
              serializeClipboardPayloadSynchronously(
                serializationPreview,
                runtime,
                preview,
                dimensionSemantics,
                taskGeometryLease
              );
            if (fallback && legacyCopy(fallback.html, fallback.text, runtime)) {
              return { method: 'legacy', status: 'copied' };
            }
          } finally {
            dimensionSemantics?.cleanup();
            transition?.cleanup();
            taskGeometryLease?.cleanup();
            measurement?.cleanup();
          }
          return { code: 'wechat-copy-failed', status: 'failed' };
        }
        let writePromise: Promise<void>;
        try {
          const item = new runtime.clipboardItem({
            // ClipboardItem accepts PromiseLike<Blob> values. Starting the
            // write before theme-image fetches finish keeps the click's
            // transient user activation attached to the operation.
            'text/html': htmlBlob,
            'text/plain': textBlob
          });
          writePromise = Promise.resolve(runtime.write([item]));
        } catch {
          finishCopyTotal('error');
          transaction.cleanup();
          detachCopyAbort();
          observeBlobRejections();
          if (copyWasCancelled()) {
            return transaction.onFailure(new Error('wechat-copy-cancelled'));
          }
          return transaction.onSynchronousModernFailure();
        }
        transaction.start();
        try {
          const writeResult = writePromise.then(
            () => ({ error: null }),
            (error: unknown) => ({ error })
          );
          const writeFailure = writeResult.then(({ error }) => {
            if (null !== error) throw error;
            return new Promise<never>(() => undefined);
          });
          await transaction.awaitCompletion(writeResult, writeFailure, htmlBlob, textBlob);
          transaction.finalize();
          finishCopyTotal('success');
          return { method: 'clipboard', status: 'copied' };
        } catch (error: unknown) {
          // A rejected modern write resumes after an await and cannot safely
          // enter the activation-sensitive legacy path. Report the failure
          // instead of attempting an asynchronous compatibility fallback.
          observeBlobRejections();
          const rejectPayload = rejectDeferredPayload as ((error: unknown) => void) | null;
          rejectPayload?.(error);
          return transaction.onFailure(error);
        } finally {
          transaction.cleanup();
          detachCopyAbort();
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
      let measurement = createPreviewMeasurementLease(preview, runtime);
      let transition: WechatPreviewTransitionLease | null = null;
      let dimensionSemantics: WechatDimensionSemanticsContext | null = null;
      try {
        if (measurement && !measurement.isReady()) {
          const retry = preparedClipboardPayload(
            preview,
            runtime,
            backgroundAssetCache,
            preparedPayloads,
            nextPreparationSequence,
            true,
            false,
            undefined,
            measurement
          );
          void retry.promise.catch(() => undefined);
          measurement = null;
          return { code: 'wechat-copy-failed', status: 'failed' };
        }
        transition = measurement ? null : createPreviewTransitionLease([preview]);
        if (transition && !transition.isReady()) {
          return { code: 'wechat-copy-failed', status: 'failed' };
        }
        const serializationPreview = measurement?.root ?? preview;
        dimensionSemantics = createDimensionSemanticsContext(serializationPreview, preview, runtime);
        const prepared = preparedPayloads.get(preview);
        const currentMarkup = clipboardSourceMarkup(preview);
        const currentLayoutSignature = preparedLayoutSignature(preview, runtime, serializationPreview, dimensionSemantics);
        dimensionSemantics.refresh();
        const currentDimensionSignature = preparedDimensionSemanticsSignature(
          serializationPreview,
          runtime,
          dimensionSemantics
        );
        const payload = reusablePreparedClipboardPayload(
          prepared,
          currentMarkup,
          currentDimensionSignature,
          currentLayoutSignature
        );
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
              true,
              false,
              undefined,
              measurement,
              dimensionSemantics,
              transition
            );
            void retry.promise.catch(() => undefined);
            dimensionSemantics = null;
            measurement = null;
            transition = null;
            return { code: 'wechat-copy-failed', status: 'failed' };
          }
          return { code: 'wechat-copy-failed', status: 'failed' };
        }
        if (legacyCopy(payload.html, payload.text, runtime)) {
          return { method: 'legacy', status: 'copied' };
        }
        return { code: 'wechat-clipboard-unsupported', status: 'failed' };
      } finally {
        dimensionSemantics?.cleanup();
        transition?.cleanup();
        measurement?.cleanup();
      }
    }
  };
}
