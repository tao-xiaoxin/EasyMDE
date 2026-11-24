import { isTaskListCheckbox } from './wechat-clone-metadata';

export const REFRESH_ONLY_PREVIEW_ATTRIBUTES = [
  'aria-busy',
  'data-easymde-preview-accepted',
  'data-easymde-preview-refreshing'
] as const;

export function clipboardTaskCheckboxState(preview: HTMLElement): string {
  return Array.from(preview.querySelectorAll('input'))
    .filter(isTaskListCheckbox)
    .map((input) => ((input as HTMLInputElement).checked ? '1' : '0'))
    .join(',');
}

export function clipboardSourceMarkup(preview: HTMLElement): string {
  // Root refresh bookkeeping is not source content; descendants still are.
  // Clone only the root to avoid a full DOM clone on each long-document check.
  const source = preview.cloneNode(false) as HTMLElement;
  REFRESH_ONLY_PREVIEW_ATTRIBUTES.forEach((attribute) => {
    source.removeAttribute(attribute);
  });
  return JSON.stringify([source.outerHTML, preview.innerHTML, clipboardTaskCheckboxState(preview)]);
}

export type ClipboardSourceFreshnessGuard = Readonly<{
  dispose: () => void;
  finalize: () => boolean;
  isCurrent: () => boolean;
}>;

export function createClipboardSourceFreshnessGuard(preview: HTMLElement): ClipboardSourceFreshnessGuard {
  const MutationObserverConstructor =
    preview.ownerDocument.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if ('function' !== typeof MutationObserverConstructor) {
    throw new Error('wechat-copy-freshness-observer-unavailable');
  }

  let dirty = false;
  let disposed = false;
  let stale = false;
  let sourceMarkup = '';
  let sourceTaskCheckboxState = '';
  const isMeaningfulMutation = (record: MutationRecord): boolean =>
    !(
      'attributes' === record.type &&
      record.target === preview &&
      'string' === typeof record.attributeName &&
      REFRESH_ONLY_PREVIEW_ATTRIBUTES.includes(record.attributeName as (typeof REFRESH_ONLY_PREVIEW_ATTRIBUTES)[number])
    );
  const recordMutations = (records: readonly MutationRecord[]): void => {
    if (records.some(isMeaningfulMutation)) dirty = true;
  };
  const observer = new MutationObserverConstructor((records) => {
    recordMutations(records);
  });

  try {
    observer.observe(preview, { attributes: true, characterData: true, childList: true, subtree: true });
    sourceMarkup = clipboardSourceMarkup(preview);
    sourceTaskCheckboxState = clipboardTaskCheckboxState(preview);
    recordMutations(observer.takeRecords());
    if (dirty) {
      stale = clipboardSourceMarkup(preview) !== sourceMarkup;
      dirty = false;
      recordMutations(observer.takeRecords());
    }
  } catch (error: unknown) {
    observer.disconnect();
    throw error;
  }

  const refreshPendingMutations = (): void => {
    if (disposed) return;
    recordMutations(observer.takeRecords());
  };
  const isCurrent = (): boolean => {
    refreshPendingMutations();
    if (stale) return false;
    const currentTaskCheckboxState = clipboardTaskCheckboxState(preview);
    if (!dirty && currentTaskCheckboxState === sourceTaskCheckboxState) return true;
    const currentMarkup = clipboardSourceMarkup(preview);
    dirty = false;
    stale = currentMarkup !== sourceMarkup;
    return !stale;
  };
  const finalize = (): boolean => {
    refreshPendingMutations();
    if (stale) return false;
    const currentMarkup = clipboardSourceMarkup(preview);
    dirty = false;
    stale = currentMarkup !== sourceMarkup;
    return !stale;
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
  };
  return { dispose, finalize, isCurrent };
}

export function previewReady(preview: HTMLElement): boolean {
  const refreshing =
    '1' === preview.getAttribute('data-easymde-preview-refreshing') || 'true' === preview.getAttribute('aria-busy');
  const acceptedDuringRefresh =
    refreshing &&
    '1' === preview.getAttribute('data-easymde-preview-accepted') &&
    !preview.querySelector('[data-easymde-preview-window-spacer]');
  return (
    (Boolean(preview.firstElementChild) || '' !== preview.innerHTML.trim()) &&
    !preview.querySelector('.easymde-preview-empty, .easymde-preview-error, .easymde-render-error') &&
    '1' !== preview.getAttribute('data-easymde-preview-error') &&
    (!refreshing || acceptedDuringRefresh)
  );
}

export type WechatClipboardCopyGuard = Readonly<{ isCurrent?: (() => boolean) | undefined; signal?: AbortSignal | undefined }>;

export type ClipboardSourceFreshnessState = Readonly<{
  current: () => ClipboardSourceFreshnessGuard | null;
  ready: Promise<void>;
}>;

export function assertCopyGuardCurrent(guard: WechatClipboardCopyGuard): void {
  if (guard.signal?.aborted || (guard.isCurrent && !guard.isCurrent())) {
    throw new Error('wechat-copy-cancelled');
  }
}

export function assertCopyPreviewCurrent(preview: HTMLElement, guard: WechatClipboardCopyGuard): void {
  assertCopyGuardCurrent(guard);
  if (!previewReady(preview)) throw new Error('wechat-preview-unavailable');
}

export function assertPortableCopyCurrent(
  preview: HTMLElement,
  guard: WechatClipboardCopyGuard,
  sourceFreshness: ClipboardSourceFreshnessState
): void {
  assertCopyPreviewCurrent(preview, guard);
  const sourceGuard = sourceFreshness.current();
  if (!sourceGuard?.isCurrent()) {
    throw new Error('wechat-copy-stale');
  }
}

export function isWechatCopyStaleError(error: unknown): boolean {
  return error instanceof Error && 'wechat-copy-stale' === error.message;
}

export function isRetryableBackgroundPreparationError(error: unknown): boolean {
  return (
    isWechatCopyStaleError(error) ||
    (error instanceof Error &&
      'AbortError' === error.name &&
      'wechat-background-preparation-cancelled' === error.message)
  );
}
