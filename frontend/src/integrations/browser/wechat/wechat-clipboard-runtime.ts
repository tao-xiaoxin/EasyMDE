import type { WechatVisualRasterizationYield } from '../../../contracts/ports/wechat-visual-rasterization-port';
import { assertPngConversionCurrent, type WechatPngConversionContext } from './wechat-png-conversion-policy';

export const BACKGROUND_SERIALIZATION_YIELD_BUDGET_MS = 8;

export type ClipboardItemConstructor = new (payload: Record<string, Blob | PromiseLike<Blob>>) => unknown;

export type BrowserWechatClipboardRuntime = Readonly<{
  blob: typeof Blob;
  clipboardItem: ClipboardItemConstructor | null;
  document: Document;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  getComputedStyle: (element: Element, pseudoElement?: string) => CSSStyleDeclaration;
  getSelection: () => Selection | null;
  pageOffset: () => Readonly<{ x: number; y: number }>;
  scrollTo: (x: number, y: number) => void;
  write: ((items: unknown[]) => Promise<void>) | null;
}>;

export type SerializationYield = (() => Promise<void>) & { shouldYield: () => boolean };

export const WECHAT_COPY_TIMING_NAMES = {
  candidateCapture: 'easymde.wechat.copy.candidate.capture',
  candidateGeometry: 'easymde.wechat.copy.candidate.geometry',
  candidateRasterization: 'easymde.wechat.copy.candidate.rasterization',
  connectedPlainText: 'easymde.wechat.copy.connected-plain-text',
  copyTotal: 'easymde.wechat.copy.total',
  finalGeometry: 'easymde.wechat.copy.final-geometry',
  finalRawContextRefresh: 'easymde.wechat.copy.final-raw-context-refresh',
  finalSourceFreshness: 'easymde.wechat.copy.final-source-freshness',
  finalizeMarkup: 'easymde.wechat.copy.finalize-markup',
  geometryReadiness: 'easymde.wechat.copy.geometry-readiness',
  inlineStyles: 'easymde.wechat.copy.inline-styles',
  markupPreparation: 'easymde.wechat.copy.markup-preparation',
  outerHtml: 'easymde.wechat.copy.outer-html',
  replacement: 'easymde.wechat.copy.replacement',
  taskGeometryReadiness: 'easymde.wechat.copy.task-geometry-readiness',
  transitionReadiness: 'easymde.wechat.copy.transition-readiness'
} as const;

export function backgroundPreparationAbortError(): Error {
  const error = new Error('wechat-background-preparation-cancelled');
  error.name = 'AbortError';
  return error;
}

export function throwIfBackgroundPreparationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw backgroundPreparationAbortError();
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutCode = 'wechat-clipboard-commit-timeout'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutCode));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (null !== timer) {
      clearTimeout(timer);
      timer = null;
    }
  });
}

export function createSerializationYield(
  runtime: BrowserWechatClipboardRuntime,
  enabled: boolean,
  signal?: AbortSignal
): SerializationYield | null {
  if (!enabled) return null;

  let lastYieldAt = Date.now();
  let firstYield = true;
  const yieldToBrowser = (async () => {
    throwIfBackgroundPreparationAborted(signal);
    if (firstYield) {
      firstYield = false;
      await waitForBrowserTask(runtime);
      lastYieldAt = Date.now();
      throwIfBackgroundPreparationAborted(signal);
      return;
    }
    if (Date.now() - lastYieldAt < BACKGROUND_SERIALIZATION_YIELD_BUDGET_MS) {
      return;
    }
    await waitForBrowserTask(runtime);
    lastYieldAt = Date.now();
    throwIfBackgroundPreparationAborted(signal);
  }) as SerializationYield;
  yieldToBrowser.shouldYield = () => firstYield || Date.now() - lastYieldAt >= BACKGROUND_SERIALIZATION_YIELD_BUDGET_MS;
  return yieldToBrowser;
}

export async function yieldSerializationBoundary(
  yieldToBrowser: SerializationYield | null,
  conversion: WechatPngConversionContext | undefined,
  signal?: AbortSignal
): Promise<void> {
  if (!yieldToBrowser?.shouldYield()) return;
  throwIfBackgroundPreparationAborted(signal);
  if (conversion) assertPngConversionCurrent(conversion);
  await yieldToBrowser();
  throwIfBackgroundPreparationAborted(signal);
  if (conversion) assertPngConversionCurrent(conversion);
}

export function createRasterizationYield(
  yieldToBrowser: SerializationYield | null,
  conversion: WechatPngConversionContext
): WechatVisualRasterizationYield | undefined {
  if (!yieldToBrowser) return undefined;
  return Object.assign(
    async (): Promise<void> => {
      await yieldSerializationBoundary(yieldToBrowser, conversion, conversion.signal);
    },
    { shouldYield: () => yieldToBrowser.shouldYield() }
  );
}

export function waitForBrowserTask(runtime: BrowserWechatClipboardRuntime): Promise<void> {
  const browserWindow = runtime.document.defaultView;
  return new Promise<void>((resolve) => {
    if (browserWindow) {
      browserWindow.setTimeout(resolve, 0);
    } else {
      setTimeout(resolve, 0);
    }
  });
}
