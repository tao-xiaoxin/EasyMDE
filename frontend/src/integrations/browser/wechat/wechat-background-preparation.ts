import {
  BACKGROUND_PREPARATION_QUIET_DELAY_MS,
  type BackgroundAssetCache,
  type BackgroundPreparationCache,
  type BackgroundPreparationState,
  type BackgroundPreparationWaiter,
  type BrowserWechatClipboardRuntime,
  type PreparedClipboardFallback,
  type PreparedClipboardPayload,
  type PreparedClipboardPayloadCache,
  type SerializationYield,
  backgroundPreparationAbortError,
  clipboardSourceMarkup,
  createSerializationYield,
  throwIfBackgroundPreparationAborted
} from './wechat-clipboard-shared';
import { serializeClipboardPayload } from './wechat-payload-serializer';
import {
  PREPARED_PSEUDO_ELEMENTS,
  PREPARED_STYLE_PROPERTIES,
  pseudoContent
} from './wechat-style-inliner';

function preparedElementLayoutSignature(
  element: Element,
  index: number,
  runtime: BrowserWechatClipboardRuntime
): string {
  const rect = element.getBoundingClientRect();
  const computed = runtime.getComputedStyle(element);
  const styles = PREPARED_STYLE_PROPERTIES
    .map((property) => `${property}=${computed.getPropertyValue(property)}`)
    .join(';');
  const pseudoStyles = PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) => {
    const pseudo = runtime.getComputedStyle(element, pseudoElement);
    const content = pseudo.getPropertyValue('content');
    if (null === pseudoContent(content)) {
      return `${pseudoElement}:content=${content}`;
    }
    return `${pseudoElement}:${PREPARED_STYLE_PROPERTIES
      .map((property) => `${property}=${pseudo.getPropertyValue(property)}`)
      .join(';')}`;
  }).join('|');
  // `left`/`top`/`right`/`bottom` are viewport-relative and change when
  // the user scrolls, even though the exported markup and layout did not.
  // Only retain dimensions here; they can affect wrapping and image/text
  // geometry without invalidating a prepared payload on ordinary scroll.
  return `${index}:${rect.width},${rect.height}:${styles}:${pseudoStyles}`;
}

export function preparedLayoutSignature(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): string {
  const viewport = preview.ownerDocument.defaultView;
  const viewportSignature = viewport
    ? `${viewport.innerWidth}x${viewport.innerHeight}@${viewport.devicePixelRatio}`
    : '';
  const elements = [preview, ...Array.from(preview.querySelectorAll('*'))];
  return [
    viewportSignature,
    ...elements.map((element, index) => (
      preparedElementLayoutSignature(element, index, runtime)
    ))
  ].join('\u0001');
}

async function preparedLayoutSignatureWithYield(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  yieldToBrowser: SerializationYield,
  signal?: AbortSignal
): Promise<string> {
  throwIfBackgroundPreparationAborted(signal);
  const viewport = preview.ownerDocument.defaultView;
  const viewportSignature = viewport
    ? `${viewport.innerWidth}x${viewport.innerHeight}@${viewport.devicePixelRatio}`
    : '';
  const entries: string[] = [];
  const elements = [preview, ...Array.from(preview.querySelectorAll('*'))];
  for (let index = 0; index < elements.length; index += 1) {
    throwIfBackgroundPreparationAborted(signal);
    entries.push(
      preparedElementLayoutSignature(elements[index] as Element, index, runtime)
    );
    if (yieldToBrowser.shouldYield()) {
      await yieldToBrowser();
    }
  }

  return [viewportSignature, ...entries].join('\u0001');
}

function createPreparedClipboardPayload(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundAssetCache: BackgroundAssetCache,
  preparedPayloads: PreparedClipboardPayloadCache,
  fallback: PreparedClipboardFallback | null,
  sequence: number,
  background = false,
  signal?: AbortSignal
): PreparedClipboardPayload {
  let prepared: PreparedClipboardPayload;
  throwIfBackgroundPreparationAborted(signal);
  // Root class/style changes (font and article-theme controls) can change the
  // computed output without changing the rendered child markup. Responsive
  // breakpoints can also change computed styles and geometry without changing
  // the DOM, so keep both the full sink markup and a layout fingerprint.
  const sourceMarkup = clipboardSourceMarkup(preview);
  const yieldToBrowser = createSerializationYield(runtime, background, signal);
  const layoutSignature = background
    ? ''
    : preparedLayoutSignature(preview, runtime);
  // Keep normal preparation asynchronous. A synchronous full-Preview walk is
  // only justified inside the originating click task when a browser rejects
  // Promise-backed ClipboardItem values; doing it for every background refresh
  // can monopolize the main thread on Mermaid/KaTeX-heavy articles.
  const promise = serializeClipboardPayload(
    preview,
    runtime,
    backgroundAssetCache,
    yieldToBrowser,
    undefined,
    signal
  )
    .then(async (payload) => {
      throwIfBackgroundPreparationAborted(signal);
      if (background && yieldToBrowser?.shouldYield()) {
        await yieldToBrowser();
      }
      const resolvedLayoutSignature = background
        ? await preparedLayoutSignatureWithYield(
          preview,
          runtime,
          yieldToBrowser as SerializationYield,
          signal
        )
        : layoutSignature;
      throwIfBackgroundPreparationAborted(signal);
      prepared.layoutSignature = resolvedLayoutSignature;
      const current = preparedPayloads.get(preview);
      throwIfBackgroundPreparationAborted(signal);
      prepared.payload = payload;
      if (
        current
        && current !== prepared
        && current.sourceMarkup === prepared.sourceMarkup
        && (!current.fallback || current.fallback.sequence < prepared.sequence)
      ) {
        // A replacement may have started while this serialization was waiting
        // on theme assets. Keep the most recent successful payload available
        // to that replacement if its own preparation later fails.
        current.fallback = {
          layoutSignature: prepared.layoutSignature,
          payload,
          sequence: prepared.sequence,
          sourceMarkup: prepared.sourceMarkup
        };
      }
      return payload;
    })
    .catch((error: unknown) => {
      const current = preparedPayloads.get(preview);
      if (current === prepared) {
        const recovery = current.fallback;
        if (recovery) {
          preparedPayloads.set(preview, {
            fallback: recovery,
            layoutSignature: recovery.layoutSignature,
            payload: recovery.payload,
            promise: Promise.resolve(recovery.payload),
            sequence: prepared.sequence,
            sourceMarkup: recovery.sourceMarkup,
            recoveredAtLayoutSignature: prepared.layoutSignature
          });
        } else {
          preparedPayloads.delete(preview);
        }
      }
      throw error;
    });
  prepared = {
    fallback,
    payload: null,
    promise,
    sequence,
    sourceMarkup,
    layoutSignature,
    recoveredAtLayoutSignature: null
  };
  preparedPayloads.set(preview, prepared);
  return prepared;
}

export function preparedClipboardPayload(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundAssetCache: BackgroundAssetCache,
  preparedPayloads: PreparedClipboardPayloadCache,
  nextSequence: () => number,
  replace = false,
  background = false,
  signal?: AbortSignal
): PreparedClipboardPayload {
  throwIfBackgroundPreparationAborted(signal);
  const existing = preparedPayloads.get(preview);
  if (!replace) {
    if (
      existing
      && existing.sourceMarkup === clipboardSourceMarkup(preview)
      && existing.layoutSignature === preparedLayoutSignature(preview, runtime)
    ) return existing;
  }
  const fallback = existing
    ? existing.payload
      ? {
        layoutSignature: existing.layoutSignature,
        payload: existing.payload,
        sequence: existing.sequence,
        sourceMarkup: existing.sourceMarkup
      }
      : existing.fallback
    : null;
  return createPreparedClipboardPayload(
    preview,
    runtime,
    backgroundAssetCache,
    preparedPayloads,
    fallback,
    nextSequence(),
    background,
    signal
  );
}

function scheduleBackgroundPreparation(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundAssetCache: BackgroundAssetCache,
  preparedPayloads: PreparedClipboardPayloadCache,
  backgroundPreparations: BackgroundPreparationCache,
  nextSequence: () => number,
  state: BackgroundPreparationState,
  delay: number
): void {
  if (state.timer !== null) return;
  const browserWindow = runtime.document.defaultView;
  state.timer = browserWindow
    ? browserWindow.setTimeout(run, delay)
    : setTimeout(run, delay);

  function run(): void {
    state.timer = null;
    if (state.active || !state.requested) return;
    state.requested = false;

    const controller = new AbortController();
    state.activeController = controller;
    let operation: Promise<void>;
    try {
      operation = preparedClipboardPayload(
        preview,
        runtime,
        backgroundAssetCache,
        preparedPayloads,
        nextSequence,
        true,
        true,
        controller.signal
      ).promise.then(() => undefined);
    } catch (error: unknown) {
      operation = Promise.reject(error);
    }

    state.active = operation;
    operation.then(
      () => finish(operation, true),
      (error: unknown) => finish(operation, false, error)
    );
  }

  function finish(
    operation: Promise<void>,
    success: boolean,
    error?: unknown
  ): void {
    if (state.active !== operation) return;
    state.active = null;
    state.activeController = null;
    if (backgroundPreparations.get(preview) !== state) return;
    if (state.requested) {
      scheduleBackgroundPreparation(
        preview,
        runtime,
        backgroundAssetCache,
        preparedPayloads,
        backgroundPreparations,
        nextSequence,
        state,
        BACKGROUND_PREPARATION_QUIET_DELAY_MS
      );
      return;
    }

    const waiters = state.waiters.splice(0);
    waiters.forEach((waiter) => {
      waiter.signal?.removeEventListener('abort', waiter.onAbort as EventListener);
      if (success) waiter.resolve();
      else waiter.reject(error);
    });
    if (!state.active && !state.requested && state.waiters.length === 0) {
      if (backgroundPreparations.get(preview) === state) {
        backgroundPreparations.delete(preview);
      }
    }
  }
}

function cancelBackgroundPreparationIfUnused(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundPreparations: BackgroundPreparationCache,
  state: BackgroundPreparationState
): void {
  if (state.waiters.length > 0) return;
  state.requested = false;
  if (state.timer !== null) {
    const browserWindow = runtime.document.defaultView;
    if (browserWindow) browserWindow.clearTimeout(state.timer as number);
    else clearTimeout(state.timer);
    state.timer = null;
  }
  state.activeController?.abort();
  if (!state.active && backgroundPreparations.get(preview) === state) {
    backgroundPreparations.delete(preview);
  }
}

function removeBackgroundPreparationWaiter(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundPreparations: BackgroundPreparationCache,
  state: BackgroundPreparationState,
  waiter: BackgroundPreparationWaiter
): void {
  const index = state.waiters.indexOf(waiter);
  if (index < 0) return;
  state.waiters.splice(index, 1);
  waiter.signal?.removeEventListener('abort', waiter.onAbort as EventListener);
  waiter.reject(backgroundPreparationAbortError());
  cancelBackgroundPreparationIfUnused(
    preview,
    runtime,
    backgroundPreparations,
    state
  );
}

export function coalescedBackgroundPreparation(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundAssetCache: BackgroundAssetCache,
  preparedPayloads: PreparedClipboardPayloadCache,
  backgroundPreparations: BackgroundPreparationCache,
  nextSequence: () => number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return Promise.reject(backgroundPreparationAbortError());
  let state = backgroundPreparations.get(preview);
  if (!state) {
    state = {
      active: null,
      activeController: null,
      requested: false,
      timer: null,
      waiters: []
    };
    backgroundPreparations.set(preview, state);
  }
  state.requested = true;
  let waiter!: BackgroundPreparationWaiter;
  const promise = new Promise<void>((resolve, reject) => {
    waiter = signal ? { reject, resolve, signal } : { reject, resolve };
    state?.waiters.push(waiter);
  });
  if (signal) {
    const onAbort = () => removeBackgroundPreparationWaiter(
      preview,
      runtime,
      backgroundPreparations,
      state as BackgroundPreparationState,
      waiter
    );
    waiter.onAbort = onAbort;
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  }
  if (state.requested && !state.active && state.timer === null) {
    scheduleBackgroundPreparation(
      preview,
      runtime,
      backgroundAssetCache,
      preparedPayloads,
      backgroundPreparations,
      nextSequence,
      state,
      0
    );
  }
  return promise;
}
