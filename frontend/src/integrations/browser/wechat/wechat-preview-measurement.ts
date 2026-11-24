import { type BrowserWechatClipboardRuntime, withTimeout } from './wechat-clipboard-runtime';
import { THEME_IMAGE_FETCH_TIMEOUT_MS } from './wechat-background-images';
import { stripRawDimensionContextIdentityAttributes } from './wechat-dimension-semantics';
import { clipboardSourceMarkup } from './wechat-source-freshness';
import {
  PREVIEW_MEASUREMENT_WIDTHS,
  rememberPreviewWidthValue
} from './wechat-preview-width-store';

export { PREVIEW_MEASUREMENT_WIDTHS, rememberPreviewWidthValue };

export type WechatPreviewMeasurementLease = Readonly<{
  cleanup: () => void;
  isReady: () => boolean;
  measurementFor: (source: Element) => Element | null;
  ready: Promise<void>;
  root: HTMLElement;
  sourceGeometryReference: 'measurement' | 'source';
  sourceMarkup: string;
  sourceFor: (measurement: Element) => Element | null;
  sourceRoot: HTMLElement;
  sourceWidthKey: number | null;
  wait: () => Promise<void>;
}>;

export type WechatMeasurementImagePair = Readonly<{ measurement: HTMLImageElement; source: HTMLImageElement }>;

export type WechatMeasurementElementPairing = Readonly<{
  byMeasurement: WeakMap<Element, Element>;
  bySource: WeakMap<Element, Element>;
  imagePairs: readonly WechatMeasurementImagePair[];
}>;

export type WechatPreviewTransitionLease = Readonly<{
  cleanup: () => void;
  isReady: () => boolean;
  ready: Promise<void>;
  wait: () => Promise<void>;
}>;

export function previewMeasurementWidth(source: HTMLElement): number | null {
  const rectWidth = source.getBoundingClientRect?.()?.width ?? 0;
  const visibleWidth = rectWidth || source.clientWidth || source.offsetWidth;
  if (visibleWidth > 0) {
    PREVIEW_MEASUREMENT_WIDTHS.set(source, visibleWidth);
    return visibleWidth;
  }

  // Immersive source mode hides the Preview pane with `display:none`, so its
  // live geometry is zero even though the user can still invoke Copy. Reuse
  // the last visible Preview width to keep plain-text soft wrapping stable
  // across the mode transition instead of letting an auto-sized host flatten
  // all line boundaries.
  const lastVisibleWidth = PREVIEW_MEASUREMENT_WIDTHS.get(source);
  if (lastVisibleWidth && lastVisibleWidth > 0) return lastVisibleWidth;

  const viewport = source.ownerDocument.defaultView;
  const documentWidth = source.ownerDocument.documentElement.clientWidth;
  const viewportWidth = viewport?.innerWidth ?? 0;
  const fallbackWidth = documentWidth || viewportWidth;
  return fallbackWidth > 0 ? fallbackWidth : null;
}

export const PREVIEW_MEASUREMENT_INHERITED_PROPERTIES = [
  'color',
  'direction',
  'font-family',
  'font-size',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'line-height',
  'list-style-position',
  'list-style-type',
  'text-align',
  'text-indent',
  'text-shadow',
  'text-transform',
  'tab-size',
  'white-space',
  'word-break',
  'word-spacing',
  'overflow-wrap'
] as const;

export function cssPixelValue(value: string): number {
  const match = /^(\d+(?:\.\d+)?)px$/i.exec(value.trim());
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function finiteCssPixelValue(value: string): number | null {
  const match = /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/i.exec(value.trim());
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

const HIDDEN_PREVIEW_SURFACE_CLASS = 'easymde-preview-surface-hidden';
const PROSEMIRROR_SURFACE_SELECTORS = [
  '[data-easymde-prosemirror-host="1"] .easymde-prosemirror-surface',
  '[data-easymde-prosemirror-host="1"]'
] as const;

export function previewWorkspaceMeasurementWidth(preview: HTMLElement, runtime: BrowserWechatClipboardRuntime): number | null {
  if (preview.classList.contains(HIDDEN_PREVIEW_SURFACE_CLASS)) {
    const parent = preview.parentElement;
    if (parent && (parent.getBoundingClientRect?.()?.width ?? 0) > 0) {
      for (const selector of PROSEMIRROR_SURFACE_SELECTORS) {
        const surfaceWidth = parent.querySelector(selector)?.getBoundingClientRect?.()?.width ?? 0;
        if (Number.isFinite(surfaceWidth) && surfaceWidth > 0) return surfaceWidth;
      }
    }
  }
  const remembered = PREVIEW_MEASUREMENT_WIDTHS.get(preview);
  if (remembered && remembered > 0) return remembered;

  let current: Element | null = preview.parentElement;
  while (current) {
    const computed = runtime.getComputedStyle(current);
    const rectWidth = current.getBoundingClientRect?.()?.width ?? 0;
    if (Number.isFinite(rectWidth) && rectWidth > 0) {
      const horizontalEdges = ['padding-left', 'padding-right', 'border-left-width', 'border-right-width'].reduce(
        (total, property) => total + cssPixelValue(computed.getPropertyValue(property)),
        0
      );
      const contentWidth = rectWidth - horizontalEdges;
      return contentWidth > 0 ? contentWidth : rectWidth;
    }
    current = current.parentElement;
  }
  return null;
}

export function isPreviewHidden(preview: HTMLElement, runtime: BrowserWechatClipboardRuntime): boolean {
  let current: Element | null = preview;
  while (current) {
    const computed = runtime.getComputedStyle(current);
    if (
      ['none', 'hidden'].includes(computed.getPropertyValue('display').trim().toLowerCase()) ||
      'hidden' === computed.getPropertyValue('visibility').trim().toLowerCase() ||
      'hidden' === computed.getPropertyValue('content-visibility').trim().toLowerCase()
    )
      return true;
    current = current.parentElement;
  }
  return false;
}

export function previewMeasurementAbortError(): Error {
  const error = new Error('wechat-preview-measurement-cancelled');
  error.name = 'AbortError';
  return error;
}

export function previewMeasurementResourceError(kind: 'failed' | 'timeout'): Error {
  return new Error(`wechat-preview-measurement-resource-${kind}`);
}

export function previewTransitionStaleError(): Error {
  return new Error('wechat-preview-transition-stale');
}

export function previewTransitionCancelledError(): Error {
  return new Error('wechat-preview-transition-cancelled');
}

export function activePreviewTransitions(roots: readonly Element[]): Animation[] {
  const seen = new Set<Animation>();
  const transitions: Animation[] = [];
  roots.forEach((root) => {
    const getAnimations = root.getAnimations?.bind(root);
    if ('function' !== typeof getAnimations) return;
    let animations: Animation[];
    try {
      animations = getAnimations({ subtree: true });
    } catch (error: unknown) {
      throw new Error('wechat-preview-transition-unavailable', { cause: error });
    }
    animations.forEach((animation) => {
      if (seen.has(animation)) return;
      seen.add(animation);
      const transition = animation as Animation & {
        animationName?: unknown;
        pending?: unknown;
        transitionProperty?: unknown;
      };
      const timing = animation.effect?.getComputedTiming?.();
      const hasCssTransition = 'string' === typeof transition.transitionProperty;
      const hasCssAnimation =
        'string' === typeof transition.animationName && 'none' !== transition.animationName.trim().toLowerCase();
      if (
        (!hasCssTransition && !hasCssAnimation) ||
        (true !== transition.pending && !['paused', 'running'].includes(animation.playState)) ||
        !timing ||
        !Number.isFinite(timing.endTime)
      )
        return;
      transitions.push(animation);
    });
  });
  return transitions;
}

export function waitForPreviewTransitions(roots: readonly Element[], signal: AbortSignal, deadline: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = (): void => finish(previewMeasurementAbortError());
    const wait = (): void => {
      if (settled) return;
      if (signal.aborted) {
        onAbort();
        return;
      }
      if (Date.now() >= deadline) {
        finish(previewMeasurementResourceError('timeout'));
        return;
      }
      let transitions: Animation[];
      try {
        transitions = activePreviewTransitions(roots);
      } catch (error: unknown) {
        finish(error);
        return;
      }
      if (!transitions.length) {
        finish();
        return;
      }
      Promise.all(
        transitions.map((animation) =>
          Promise.resolve(animation.finished).catch((error: unknown) => {
            if (signal.aborted) throw previewMeasurementAbortError();
            if (error instanceof Error && 'AbortError' === error.name) {
              throw previewTransitionCancelledError();
            }
            if (error && 'object' === typeof error && 'AbortError' === (error as { name?: unknown }).name) {
              throw previewTransitionCancelledError();
            }
            throw new Error('wechat-preview-transition-failed', { cause: error });
          })
        )
      ).then(wait, finish);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    wait();
  });
}

export function createPreviewTransitionLease(roots: readonly Element[], signal?: AbortSignal): WechatPreviewTransitionLease {
  const controller = new AbortController();
  const deadline = Date.now() + THEME_IMAGE_FETCH_TIMEOUT_MS;
  let cleaned = false;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let initialReady = false;
  let initialError: unknown = null;
  let removeExternalAbort = (): void => undefined;
  const finishCleanup = (): void => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    removeExternalAbort();
    removeExternalAbort = () => undefined;
  };
  if (signal) {
    if (signal.aborted) controller.abort();
    else {
      const onExternalAbort = (): void => controller.abort();
      signal.addEventListener('abort', onExternalAbort, { once: true });
      removeExternalAbort = () => signal.removeEventListener('abort', onExternalAbort);
    }
  }
  const armTimeout = (): void => {
    if (timeout !== null) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      timedOut = true;
      controller.abort();
      return;
    }
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, remaining);
  };
  const wait = (): Promise<void> => {
    if (cleaned) return Promise.reject(previewMeasurementAbortError());
    if (initialError) return Promise.reject(initialError);
    if (initialReady) {
      try {
        if (activePreviewTransitions(roots).length) {
          return Promise.reject(previewTransitionStaleError());
        }
      } catch (error: unknown) {
        return Promise.reject(error);
      }
      return Promise.resolve();
    }
    if (controller.signal.aborted) {
      return Promise.reject(timedOut ? previewMeasurementResourceError('timeout') : previewMeasurementAbortError());
    }
    let transitions: Animation[];
    try {
      transitions = activePreviewTransitions(roots);
    } catch (error: unknown) {
      initialError = error;
      return Promise.reject(error);
    }
    if (!transitions.length) return Promise.resolve();
    armTimeout();
    if (timedOut) return Promise.reject(previewMeasurementResourceError('timeout'));
    return waitForPreviewTransitions(roots, controller.signal, deadline).catch((error: unknown) => {
      if (timedOut) throw previewMeasurementResourceError('timeout');
      throw error;
    });
  };
  const ready = wait().then(
    () => {
      initialReady = true;
      finishCleanup();
    },
    (error: unknown) => {
      initialError ??= error;
      throw error;
    }
  );
  void ready.catch(() => undefined);
  return {
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      finishCleanup();
      controller.abort();
    },
    isReady: () => !cleaned && !initialError && !controller.signal.aborted && !activePreviewTransitions(roots).length,
    ready,
    wait
  };
}

export function pairMeasurementElements(
  sourceRoot: HTMLElement,
  measurementRoot: HTMLElement
): WechatMeasurementElementPairing {
  const bySource = new WeakMap<Element, Element>();
  const byMeasurement = new WeakMap<Element, Element>();
  const imagePairs: WechatMeasurementImagePair[] = [];
  const pair = (source: Element, measurement: Element): void => {
    if (source.localName !== measurement.localName || source.namespaceURI !== measurement.namespaceURI) {
      throw new Error('wechat-preview-measurement-element-pair-mismatch');
    }
    bySource.set(source, measurement);
    byMeasurement.set(measurement, source);
    if (source instanceof HTMLImageElement && measurement instanceof HTMLImageElement) {
      imagePairs.push({ measurement, source });
    }
    const sourceChildren = Array.from(source.children);
    const measurementChildren = Array.from(measurement.children);
    if (sourceChildren.length !== measurementChildren.length) {
      throw new Error('wechat-preview-measurement-element-pair-mismatch');
    }
    sourceChildren.forEach((sourceChild, index) => {
      const measurementChild = measurementChildren[index];
      if (!measurementChild) throw new Error('wechat-preview-measurement-element-pair-mismatch');
      pair(sourceChild, measurementChild);
    });
  };
  pair(sourceRoot, measurementRoot);
  return { byMeasurement, bySource, imagePairs };
}

export function waitForMeasuredImage(pair: WechatMeasurementImagePair, signal: AbortSignal): Promise<void> {
  const waitForImage = (image: HTMLImageElement): Promise<void> => {
    const hasSource = Boolean(image.getAttribute('src') || image.getAttribute('srcset'));
    if (!hasSource) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        image.removeEventListener('load', onLoad);
        image.removeEventListener('error', onError);
        signal.removeEventListener('abort', onAbort);
      };
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onAbort = (): void => finish(previewMeasurementAbortError());
      const onLoad = (): void => {
        if (image.naturalWidth < 1) {
          finish(previewMeasurementResourceError('failed'));
          return;
        }
        if ('function' !== typeof image.decode) {
          finish();
          return;
        }
        void image.decode().then(
          () => finish(),
          () => finish(previewMeasurementResourceError('failed'))
        );
      };
      const onError = (): void => finish(previewMeasurementResourceError('failed'));
      image.addEventListener('load', onLoad);
      image.addEventListener('error', onError);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      if (image.complete) {
        if (image.naturalWidth > 0) onLoad();
        else onError();
      }
    });
  };
  return Promise.all([waitForImage(pair.source), waitForImage(pair.measurement)]).then(() => undefined);
}

export function createPreviewMeasurementReadiness(
  root: HTMLElement,
  source: HTMLElement,
  signal?: AbortSignal,
  transitionRoots: readonly Element[] = [],
  imagePairs: readonly WechatMeasurementImagePair[] | null = null
): Readonly<{
  cleanup: () => void;
  isReady: () => boolean;
  promise: Promise<void>;
  start: () => void;
  wait: () => Promise<void>;
}> {
  const controller = new AbortController();
  const images = [
    ...(root.matches('img') ? [root as unknown as HTMLImageElement] : []),
    ...Array.from(root.querySelectorAll('img'))
  ];
  const pairedImages = imagePairs ?? pairMeasurementElements(source, root).imagePairs;
  if (new Set(pairedImages.map((pair) => pair.measurement)).size !== images.length) {
    throw new Error('wechat-preview-measurement-image-pair-mismatch');
  }
  const lazyAttributes = images.map((image) => {
    const value = image.getAttribute('loading');
    if ('lazy' === value?.trim().toLowerCase()) image.setAttribute('loading', 'eager');
    return { image, value };
  });
  let ready = false;
  let cleaned = false;
  let settled = false;
  let started = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const deadline = Date.now() + THEME_IMAGE_FETCH_TIMEOUT_MS;
  let removeExternalAbort = (): void => undefined;
  const restoreLoadingAttributes = (): void => {
    lazyAttributes.forEach(({ image, value }) => {
      if (null === value) image.removeAttribute('loading');
      else image.setAttribute('loading', value);
    });
  };
  const imageReadiness = pairedImages.map((imagePair) => waitForMeasuredImage(imagePair, controller.signal));
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const finish = (error?: unknown): void => {
    if (settled) return;
    settled = true;
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    removeExternalAbort();
    removeExternalAbort = () => undefined;
    restoreLoadingAttributes();
    if (error) {
      controller.abort();
      rejectReady(error);
      return;
    }
    ready = true;
    resolveReady();
  };
  const onAbort = (): void => finish(previewMeasurementAbortError());
  if (signal) {
    if (signal.aborted) controller.abort();
    else {
      const onExternalAbort = (): void => {
        controller.abort();
        onAbort();
      };
      signal.addEventListener('abort', onExternalAbort, { once: true });
      removeExternalAbort = () => signal.removeEventListener('abort', onExternalAbort);
    }
  }
  const start = (): void => {
    if (started || settled || cleaned) return;
    started = true;
    try {
      // Force one layout on the attached clone so CSS Font Loading can observe
      // fonts used by this measurement owner before its ready promise is read.
      root.getBoundingClientRect();
      if (source !== root) source.getBoundingClientRect();
    } catch (error: unknown) {
      finish(error);
      return;
    }
    const fonts = root.ownerDocument.fonts;
    const fontReadiness = fonts?.ready
      ? Promise.resolve(fonts.ready).catch(() => {
          throw new Error('wechat-preview-measurement-font-failed');
        })
      : Promise.resolve();
    let initialTransitions: Animation[];
    try {
      initialTransitions = activePreviewTransitions(transitionRoots);
    } catch (error: unknown) {
      finish(error);
      return;
    }
    const transitionsReady = initialTransitions.length
      ? waitForPreviewTransitions(transitionRoots, controller.signal, deadline)
      : Promise.resolve();
    if ((!fonts || 'loaded' === fonts.status) && !images.length && !initialTransitions.length) {
      finish();
      return;
    }
    Promise.all([...imageReadiness, fontReadiness, transitionsReady])
      .then(() => waitForPreviewTransitions(transitionRoots, controller.signal, deadline))
      .then(
        () => finish(),
        (error: unknown) => finish(error)
      );
  };
  if (signal?.aborted) onAbort();
  if (!settled) {
    timeout = setTimeout(() => {
      controller.abort();
      finish(previewMeasurementResourceError('timeout'));
    }, THEME_IMAGE_FETCH_TIMEOUT_MS);
  }
  const wait = (): Promise<void> => {
    if (cleaned) return Promise.reject(previewMeasurementAbortError());
    if (settled) {
      if (!ready) return Promise.reject(previewMeasurementAbortError());
      try {
        if (activePreviewTransitions(transitionRoots).length) {
          return Promise.reject(previewTransitionStaleError());
        }
      } catch (error: unknown) {
        return Promise.reject(error);
      }
      return Promise.resolve();
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(previewMeasurementResourceError('timeout'));
    return withTimeout(
      waitForPreviewTransitions(transitionRoots, controller.signal, deadline),
      remaining,
      'wechat-preview-measurement-resource-timeout'
    );
  };
  void promise.catch(() => undefined);

  return {
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      finish(previewMeasurementAbortError());
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      removeExternalAbort();
      removeExternalAbort = () => undefined;
      controller.abort();
      restoreLoadingAttributes();
    },
    isReady: () => ready,
    promise,
    start,
    wait
  };
}

export function createHiddenPreviewGeometryMeasurement(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  signal?: AbortSignal
): WechatPreviewMeasurementLease {
  const document = preview.ownerDocument;
  if (!document.body) throw new Error('wechat-preview-measurement-document-body-unavailable');
  const host = document.createElement('div');
  host.className = 'easymde-wechat-preview-measurement';
  host.dataset.easymdeWechatMeasureHost = '1';
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('inert', '');
  host.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'display:block',
    'opacity:0',
    'pointer-events:none',
    'contain:layout style'
  ].join(';');
  const width = previewWorkspaceMeasurementWidth(preview, runtime);
  if (width) {
    host.style.width = `${width}px`;
    host.style.maxWidth = `${width}px`;
  }
  const inherited = runtime.getComputedStyle(preview);
  PREVIEW_MEASUREMENT_INHERITED_PROPERTIES.forEach((property) => {
    const value = inherited.getPropertyValue(property);
    if (value) host.style.setProperty(property, value);
  });
  for (let index = 0; index < inherited.length; index += 1) {
    const property = inherited.item(index);
    if (!property?.startsWith('--')) continue;
    host.style.setProperty(property, inherited.getPropertyValue(property));
  }
  const path: Element[] = [];
  let source: Element | null = preview;
  while (source && source !== document.body && source !== document.documentElement) {
    path.unshift(source);
    source = source.parentElement;
  }
  let clone: HTMLElement | null = null;
  let cloneParent: Element | null = host;
  path.forEach((pathElement) => {
    const pathClone = (
      pathElement === preview ? pathElement.cloneNode(true) : pathElement.cloneNode(false)
    ) as HTMLElement;
    stripRawDimensionContextIdentityAttributes(pathClone);
    const computed = runtime.getComputedStyle(pathElement);
    if (pathElement !== preview) {
      pathClone.style.setProperty('display', 'block', 'important');
      pathClone.style.setProperty('position', 'static', 'important');
      pathClone.style.setProperty('inset', 'auto', 'important');
      pathClone.style.setProperty('width', '100%', 'important');
      pathClone.style.setProperty('min-width', '0', 'important');
      pathClone.style.setProperty('max-width', 'none', 'important');
      pathClone.style.setProperty('height', 'auto', 'important');
      pathClone.style.setProperty('min-height', '0', 'important');
      pathClone.style.setProperty('max-height', 'none', 'important');
      pathClone.style.setProperty('margin', '0', 'important');
      pathClone.style.setProperty('padding', '0', 'important');
      pathClone.style.setProperty('border', '0', 'important');
      pathClone.style.setProperty('transform', 'none', 'important');
    }
    if (pathElement === preview) {
      pathClone.classList.remove(HIDDEN_PREVIEW_SURFACE_CLASS);
    }
    if ('none' === computed.getPropertyValue('display').trim().toLowerCase()) {
      pathClone.style.setProperty('display', 'block', 'important');
    }
    if ('hidden' === computed.getPropertyValue('content-visibility').trim().toLowerCase()) {
      pathClone.style.setProperty('content-visibility', 'visible', 'important');
    }
    cloneParent?.append(pathClone);
    cloneParent = pathClone;
    if (pathElement === preview) clone = pathClone;
  });
  if (!clone) {
    host.remove();
    throw new Error('wechat-preview-measurement-preview-unavailable');
  }
  const measurementRoot = clone as HTMLElement;
  const pairing = pairMeasurementElements(preview, measurementRoot);
  const readiness = createPreviewMeasurementReadiness(
    measurementRoot,
    preview,
    signal,
    [preview, measurementRoot],
    pairing.imagePairs
  );
  document.body.append(host);
  readiness.start();
  return {
    cleanup: () => {
      readiness.cleanup();
      host.remove();
    },
    isReady: readiness.isReady,
    measurementFor: (source) => pairing.bySource.get(source) ?? null,
    ready: readiness.promise,
    root: measurementRoot,
    sourceGeometryReference: 'measurement',
    sourceMarkup: clipboardSourceMarkup(preview),
    sourceFor: (measurement) => pairing.byMeasurement.get(measurement) ?? null,
    sourceRoot: preview,
    sourceWidthKey: width,
    wait: readiness.wait
  };
}

export function createPreviewMeasurementLease(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  signal?: AbortSignal
): WechatPreviewMeasurementLease | null {
  return isPreviewHidden(preview, runtime) ? createHiddenPreviewGeometryMeasurement(preview, runtime, signal) : null;
}
