import {
  createPreviewMeasurementLease,
  isPreviewHidden,
  previewMeasurementAbortError,
  previewWorkspaceMeasurementWidth,
  type WechatPreviewMeasurementLease
} from './wechat-preview-measurement';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import { clipboardSourceMarkup } from './wechat-source-freshness';

export type CachedPreviewGeometryMeasurement = {
  acquire: () => AcquiredPreviewGeometryMeasurement;
  cleanup: () => void;
  lease: WechatPreviewMeasurementLease;
  sourceMarkup: string;
  sourceWidthKey: number | null;
};

export type PreviewGeometryMeasurementCache = WeakMap<HTMLElement, CachedPreviewGeometryMeasurement>;
export type AcquiredPreviewGeometryMeasurement = Readonly<{
  cleanup: () => void;
  lease: WechatPreviewMeasurementLease;
}>;

export function waitForPreviewMeasurement(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(previewMeasurementAbortError());
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(previewMeasurementAbortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

export function previewMeasurementLeaseSourceMatches(
  lease: WechatPreviewMeasurementLease,
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  return (
    lease.sourceMarkup === clipboardSourceMarkup(preview) &&
    lease.sourceWidthKey === previewWorkspaceMeasurementWidth(preview, runtime)
  );
}

function previewGeometryMeasurementSourceMatches(
  cached: CachedPreviewGeometryMeasurement,
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  return previewMeasurementLeaseSourceMatches(cached.lease, preview, runtime);
}

function previewGeometryMeasurementMatches(
  cached: CachedPreviewGeometryMeasurement,
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  return isPreviewHidden(preview, runtime) && previewGeometryMeasurementSourceMatches(cached, preview, runtime);
}

export function preparePreviewGeometryOnly(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  cache: PreviewGeometryMeasurementCache,
  signal?: AbortSignal
): Promise<void> {
  if (!isPreviewHidden(preview, runtime)) {
    cache.get(preview)?.cleanup();
    return Promise.resolve();
  }
  const sourceMarkup = clipboardSourceMarkup(preview);
  const sourceWidthKey = previewWorkspaceMeasurementWidth(preview, runtime);
  const existing = cache.get(preview);
  if (existing && existing.sourceMarkup === sourceMarkup && existing.sourceWidthKey === sourceWidthKey) {
    return waitForPreviewMeasurement(existing.lease.ready, signal);
  }
  existing?.cleanup();
  if (signal?.aborted) return Promise.reject(previewMeasurementAbortError());
  // The lease has its own cleanup owner. The background demand owns only this
  // listener until a foreground Copy transfers the lease out of the cache.
  const lease = createPreviewMeasurementLease(preview, runtime);
  if (!lease) return Promise.resolve();
  let released = false;
  let transferred = false;
  let removeAbort: () => void = () => undefined;
  let cached!: CachedPreviewGeometryMeasurement;
  const cleanup = (): void => {
    if (released) return;
    released = true;
    removeAbort();
    if (cache.get(preview) === cached) cache.delete(preview);
    lease.cleanup();
  };
  const acquire = (): AcquiredPreviewGeometryMeasurement => {
    if (released) throw new Error('wechat-preview-measurement-lease-unavailable');
    transferred = true;
    removeAbort();
    if (cache.get(preview) === cached) cache.delete(preview);
    return { cleanup, lease };
  };
  cached = {
    acquire,
    cleanup,
    lease,
    sourceMarkup: lease.sourceMarkup,
    sourceWidthKey: lease.sourceWidthKey
  };
  cache.set(preview, cached);
  if (signal) {
    const onAbort = (): void => cleanup();
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbort = () => signal.removeEventListener('abort', onAbort);
  }
  return waitForPreviewMeasurement(lease.ready, signal).then(
    () => {
      if (cache.get(preview) === cached && !previewGeometryMeasurementMatches(cached, preview, runtime)) {
        cleanup();
      }
    },
    (error: unknown) => {
      // The background readiness promise may reject after Copy has already
      // transferred the lease. Its old demand no longer owns the measurement
      // host and must not tear down the foreground transaction's DOM.
      if (!transferred) cleanup();
      throw error;
    }
  );
}

export function cachedPreviewGeometryMeasurement(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  cache: PreviewGeometryMeasurementCache
): AcquiredPreviewGeometryMeasurement | null {
  const cached = cache.get(preview);
  if (!cached) return null;
  // A foreground Copy may resolve after Source switches to Split. The
  // background owner already invalidates visible cached entries on its next
  // preparation; once acquired, source markup and measured width are the
  // transaction's validity keys and the foreground lease owns cleanup.
  if (!previewGeometryMeasurementSourceMatches(cached, preview, runtime)) {
    cached.cleanup();
    return null;
  }
  return cached.acquire();
}
