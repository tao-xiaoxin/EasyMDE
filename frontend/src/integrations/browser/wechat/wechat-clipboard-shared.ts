import type { WechatVisualRasterizationKind } from '../../../contracts/ports/wechat-visual-rasterization-port';

export const BACKGROUND_PREPARATION_QUIET_DELAY_MS = 120;
export const BACKGROUND_SERIALIZATION_YIELD_BUDGET_MS = 8;
export const BACKGROUND_YIELD_CHUNK_SIZE = 64;
export const CLIPBOARD_COMMIT_TIMEOUT_MS = 10_000;

export const REFRESH_ONLY_PREVIEW_ATTRIBUTES = [
  'aria-busy',
  'data-easymde-preview-accepted',
  'data-easymde-preview-refreshing'
] as const;

export const MAC_FRAME_MARKERS = new WeakSet<Element>();
export const KATEX_VISUAL_ROOTS = new WeakSet<Element>();
export const KATEX_VISUAL_NODES = new WeakSet<Element>();
export const MATH_BLOCK_ROOTS = new WeakSet<Element>();
export const MERMAID_SVG_ROOTS = new WeakSet<Element>();
export const MERMAID_FOREIGN_OBJECTS = new WeakSet<Element>();
export const THEME_IMAGE_CLONES = new WeakSet<Element>();
export const HIDDEN_NODES = new WeakSet<Element>();
export const TASK_LIST_CHECKBOX_CLONES = new WeakSet<Element>();
export const FULL_WIDTH_TABLE_CLONES = new WeakSet<Element>();
export const FULL_WIDTH_TABLE_SOURCE_LAYOUT = new WeakMap<Element, boolean>();
export const FULL_WIDTH_TABLE_ROOT_LAYOUT = new WeakMap<HTMLElement, Map<number, boolean>>();
export const PREVIEW_MEASUREMENT_WIDTHS = new WeakMap<HTMLElement, number>();
export const WECHAT_PNG_VISUAL_CLONES = new WeakMap<Element, Readonly<{
  kind: WechatVisualRasterizationKind;
  source: Element;
}>>();

export type ClipboardItemConstructor = new (payload: Record<string, Blob>) => unknown;

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

export type BackgroundAssetCache = Map<string, Promise<string>>;

export type ThemeImageLayer = Readonly<{
  src: string;
  layerIndex: number;
}>;

export type SerializedClipboardPayload = Readonly<{
  html: string;
  text: string;
}>;

export type PreparedClipboardFallback = Readonly<{
  layoutSignature: string;
  payload: SerializedClipboardPayload;
  sequence: number;
  sourceMarkup: string;
}>;

export type PreparedClipboardPayload = {
  payload: SerializedClipboardPayload | null;
  promise: Promise<SerializedClipboardPayload>;
  sequence: number;
  sourceMarkup: string;
  layoutSignature: string;
  fallback: PreparedClipboardFallback | null;
  recoveredAtLayoutSignature: string | null;
};

export type PreparedClipboardPayloadCache = WeakMap<HTMLElement, PreparedClipboardPayload>;

export type BackgroundPreparationWaiter = {
  reject: (error: unknown) => void;
  resolve: () => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export type BackgroundPreparationState = {
  active: Promise<void> | null;
  activeController: AbortController | null;
  requested: boolean;
  timer: number | ReturnType<typeof setTimeout> | null;
  waiters: BackgroundPreparationWaiter[];
};

export type BackgroundPreparationCache = WeakMap<HTMLElement, BackgroundPreparationState>;

export type SerializationYield = {
  (): Promise<void>;
  shouldYield: () => boolean;
};

export type MarkupWalkMarkers = Readonly<{
  hiddenNodes: Element[];
  katexVisualRoots: Element[];
  mathBlockRoots: Element[];
}>;

export function createMarkupWalkMarkers(): MarkupWalkMarkers {
  return {
    hiddenNodes: [],
    katexVisualRoots: [],
    mathBlockRoots: []
  };
}

export function clipboardSourceMarkup(preview: HTMLElement): string {
  // Root refresh bookkeeping is not source content; descendants still are.
  // Clone only the root to avoid a full DOM clone on each long-document check.
  const source = preview.cloneNode(false) as HTMLElement;
  REFRESH_ONLY_PREVIEW_ATTRIBUTES.forEach((attribute) => {
    source.removeAttribute(attribute);
  });
  return JSON.stringify([source.outerHTML, preview.innerHTML]);
}

export function appendDeclarations(element: Element, declarations: string[], important = false): void {
  if (!declarations.length) return;
  const existing = element.getAttribute('style') ?? '';
  const normalized = important
    ? declarations.map((declaration) => declaration.endsWith('!important') ? declaration : `${declaration}!important`)
    : declarations;
  element.setAttribute('style', [existing, ...normalized].filter(Boolean).join(';'));
}

export function previewReady(preview: HTMLElement): boolean {
  const refreshing = '1' === preview.getAttribute('data-easymde-preview-refreshing')
    || 'true' === preview.getAttribute('aria-busy');
  const acceptedDuringRefresh = refreshing
    && '1' === preview.getAttribute('data-easymde-preview-accepted');
  return '' !== preview.innerHTML.trim()
    && !preview.querySelector(
      '.easymde-preview-empty, .easymde-preview-error, .easymde-render-error'
    )
    && '1' !== preview.getAttribute('data-easymde-preview-error')
    && (!refreshing || acceptedDuringRefresh);
}

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
  const shouldYield = (): boolean => (
    Date.now() - lastYieldAt >= BACKGROUND_SERIALIZATION_YIELD_BUDGET_MS
  );
  const yieldToBrowser = async (): Promise<void> => {
    throwIfBackgroundPreparationAborted(signal);
    if (!shouldYield()) {
      return;
    }

    const browserWindow = runtime.document.defaultView;
    await new Promise<void>((resolve) => {
      if (browserWindow) {
        browserWindow.setTimeout(resolve, 0);
      } else {
        setTimeout(resolve, 0);
      }
    });
    lastYieldAt = Date.now();
    throwIfBackgroundPreparationAborted(signal);
  };
  yieldToBrowser.shouldYield = shouldYield;
  return yieldToBrowser;
}

export async function forEachWithYield<T>(
  items: Iterable<T> | ArrayLike<T>,
  callback: (item: T, index: number) => void,
  yieldToBrowser: SerializationYield,
  signal?: AbortSignal
): Promise<void> {
  const list = Array.isArray(items) ? items : Array.from(items);
  for (let index = 0; index < list.length; index += 1) {
    if (0 === index % BACKGROUND_YIELD_CHUNK_SIZE) {
      throwIfBackgroundPreparationAborted(signal);
      if (yieldToBrowser.shouldYield()) {
        await yieldToBrowser();
      }
    }
    callback(list[index] as T, index);
  }
  throwIfBackgroundPreparationAborted(signal);
  if (yieldToBrowser.shouldYield()) {
    await yieldToBrowser();
  }
}
