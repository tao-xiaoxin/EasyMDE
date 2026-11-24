import { normalizeMathTex } from '../../shared/markdown/normalize-math-tex';
import {
  initializeMermaidRuntime,
  markIntrinsicMermaidLayout,
  type MermaidInitializationOptions
} from '../../shared/mermaid/mermaid-runtime-config';

export type FrontendEnhancementConfig = unknown;

export type FrontendEnhancementScheduler = Readonly<{
  now: () => number;
  yield: () => Promise<void>;
}>;

export type FrontendEnhancementControl = Readonly<{
  isCurrent?: () => boolean;
  scheduler?: FrontendEnhancementScheduler;
  signal?: AbortSignal;
}>;

export type FrontendEnhancementRuntimeOptions = Readonly<{
  control?: FrontendEnhancementControl;
  scheduler?: FrontendEnhancementScheduler;
}>;

type HighlightRuntime = Readonly<{
  highlightElement: (code: HTMLElement) => void;
}>;

type KatexRuntime = Readonly<{
  render: (
    tex: string,
    element: HTMLElement,
    options: Readonly<{ displayMode: boolean; throwOnError: boolean; strict: string }>
  ) => void;
}>;

type MermaidRenderResult = Readonly<{ svg: string }>;

type MermaidRuntime = Readonly<{
  initialize: (options: MermaidInitializationOptions) => void;
  render: (id: string, source: string) => Promise<MermaidRenderResult>;
}>;

export type FrontendEnhancementWindow = Window & {
  EasyMDEEnhancements?: Readonly<{
    enhance: (
      root: ParentNode,
      config: FrontendEnhancementConfig,
      control?: FrontendEnhancementControl
    ) => Promise<void>;
    syncCodeFrameBackgrounds: (root: ParentNode) => void;
  }>;
  EasyMDEFrontendConfig?: FrontendEnhancementConfig;
  EasyMDEMathRenderer?: Readonly<{
    render: (
      root: ParentNode,
      config: FrontendEnhancementConfig,
      control?: FrontendEnhancementControl
    ) => void | Promise<void>;
  }>;
  EasyMDEMermaidRenderer?: Readonly<{
    readCachedSvg?: (source: string, renderId: string) => string | null;
    render: (
      root: ParentNode,
      config: FrontendEnhancementConfig,
      control?: FrontendEnhancementControl
    ) => Promise<void>;
    writeCachedSvg?: (source: string, renderId: string, svg: string) => void;
  }>;
  hljs?: HighlightRuntime;
  katex?: KatexRuntime;
  mermaid?: MermaidRuntime;
};

let mermaidRenderIndex = 0;

const ENHANCEMENT_SLICE_BUDGET_MS = 8;
const ENHANCEMENT_RAF_FALLBACK_MS = 40;
// Auto-detection is synchronous per block; keep large immersive previews bounded
// between paints without dropping language-free code blocks.
const LARGE_IMMERSIVE_PREVIEW_BYTE_LIMIT = 128 * 1024;
const LARGE_IMMERSIVE_ITEMS_PER_SLICE = 4;
const MATH_ITEMS_PER_SLICE = 8;
const MERMAID_ITEMS_PER_SLICE = 1;

const MERMAID_CACHE_MAX_ENTRIES = 256;
const MERMAID_CACHE_MAX_SOURCE_LENGTH = 16 * 1024;
const MERMAID_CACHE_MAX_SVG_LENGTH = 128 * 1024;

const KATEX_CACHE_MAX_ENTRIES = 128;
const KATEX_CACHE_MAX_TEX_LENGTH = 4 * 1024;
const KATEX_CACHE_MAX_HTML_LENGTH = 32 * 1024;

type CachedMermaidSvg = Readonly<{
  renderId: string;
  svg: string;
}>;

const mermaidSvgCaches = new WeakMap<MermaidRuntime, Map<string, CachedMermaidSvg>>();
const katexHtmlCaches = new WeakMap<KatexRuntime, Map<string, string>>();

type ScheduledWorkCost = 0 | 1;

type ScheduledWorkOptions = Readonly<{
  maxItemsPerSlice?: number;
}>;

function readLruCache<V>(cache: Map<string, V>, key: string): V | undefined {
  const value = cache.get(key);
  if (undefined === value) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function writeLruCache<V>(
  cache: Map<string, V>,
  key: string,
  value: V,
  maxEntries: number
): void {
  if (cache.has(key)) {
    cache.delete(key);
  } else if (cache.size >= maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (undefined !== oldestKey) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, value);
}

function mermaidCacheKey(source: string): string {
  return source.trim();
}

function mermaidSvgCache(mermaid: MermaidRuntime): Map<string, CachedMermaidSvg> {
  let cache = mermaidSvgCaches.get(mermaid);
  if (!cache) {
    cache = new Map<string, CachedMermaidSvg>();
    mermaidSvgCaches.set(mermaid, cache);
  }
  return cache;
}

function katexHtmlCache(katex: KatexRuntime): Map<string, string> {
  let cache = katexHtmlCaches.get(katex);
  if (!cache) {
    cache = new Map<string, string>();
    katexHtmlCaches.set(katex, cache);
  }
  return cache;
}

function enhancementIsCurrent(
  control: FrontendEnhancementControl | undefined
): boolean {
  return !control?.signal?.aborted && (control?.isCurrent?.() ?? true);
}

function clearScheduledTimeout(
  windowRef: FrontendEnhancementWindow,
  id: number
): void {
  if ('function' !== typeof windowRef.clearTimeout) return;
  try {
    windowRef.clearTimeout(id);
  } catch {
    globalThis.clearTimeout(id);
  }
}

function cancelScheduledAnimationFrame(
  windowRef: FrontendEnhancementWindow,
  id: number
): void {
  if ('function' !== typeof windowRef.cancelAnimationFrame) return;
  try {
    windowRef.cancelAnimationFrame(id);
  } catch {
    if ('function' === typeof globalThis.cancelAnimationFrame) {
      globalThis.cancelAnimationFrame(id);
    }
  }
}

function defaultEnhancementScheduler(
  windowRef: FrontendEnhancementWindow
): FrontendEnhancementScheduler {
  return {
    now: () => windowRef.performance?.now() ?? Date.now(),
    yield: () => new Promise<void>((resolve) => {
      let settled = false;
      let rafId: number | null = null;
      let timeoutId: number | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (null !== timeoutId) {
          const pendingTimeout = timeoutId;
          timeoutId = null;
          clearScheduledTimeout(windowRef, pendingTimeout);
        }
        if (null !== rafId) {
          const pendingRaf = rafId;
          rafId = null;
          cancelScheduledAnimationFrame(windowRef, pendingRaf);
        }
        resolve();
      };

      // Prefer requestAnimationFrame so visible tabs actually paint and process
      // input between slices instead of starving rendering with setTimeout(0).
      // Keep a bounded fallback timer so hidden tabs or throttled surfaces
      // still make progress when frame delivery is paused.
      if ('function' === typeof windowRef.requestAnimationFrame) {
        rafId = windowRef.requestAnimationFrame(finish);
        if (!settled) {
          timeoutId = windowRef.setTimeout(finish, ENHANCEMENT_RAF_FALLBACK_MS);
        }
        return;
      }
      timeoutId = windowRef.setTimeout(finish, 0);
    })
  };
}

function enhancementRuntimeOptions(
  windowRef: FrontendEnhancementWindow,
  options: FrontendEnhancementRuntimeOptions = {}
): Readonly<{
  control: FrontendEnhancementControl;
  scheduler: FrontendEnhancementScheduler;
}> {
  const scheduler = options.scheduler
    ?? options.control?.scheduler
    ?? defaultEnhancementScheduler(windowRef);
  const control: FrontendEnhancementControl = {
    ...(options.control ?? {}),
    scheduler
  };
  return { control, scheduler };
}

async function runScheduled<T>(
  items: ReadonlyArray<T>,
  work: (item: T) => void | ScheduledWorkCost | Promise<ScheduledWorkCost> | Promise<void>,
  scheduler: FrontendEnhancementScheduler,
  control: FrontendEnhancementControl,
  options: ScheduledWorkOptions = {}
): Promise<boolean> {
  let sliceStartedAt = scheduler.now();
  let itemsInSlice = 0;
  for (let index = 0; index < items.length; index += 1) {
    if (!enhancementIsCurrent(control)) return false;
    const item = items[index];
    if (undefined === item) return false;
    const itemCost = await work(item);
    itemsInSlice += undefined === itemCost ? 1 : itemCost;
    const hasMore = index < items.length - 1;
    const elapsed = scheduler.now() - sliceStartedAt;
    const reachedItemBound = options.maxItemsPerSlice !== undefined
      && itemsInSlice >= options.maxItemsPerSlice;
    if (hasMore && (elapsed >= ENHANCEMENT_SLICE_BUDGET_MS || reachedItemBound)) {
      await scheduler.yield();
      if (!enhancementIsCurrent(control)) return false;
      sliceStartedAt = scheduler.now();
      itemsInSlice = 0;
    }
  }
  return enhancementIsCurrent(control);
}

function property(value: unknown, key: string): unknown {
  if (
    !value
    || ('object' !== typeof value && 'function' !== typeof value)
  ) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

function featureEnabled(config: FrontendEnhancementConfig, key: string): boolean {
  const features = property(config, 'features');
  return !features || property(features, key) !== false;
}

function isMermaidCode(element: Element): boolean {
  return [...element.classList].some(
    (className) => 'language-mermaid' === className.toLowerCase()
  );
}

function isLargeImmersivePreviewRoot(root: ParentNode): boolean {
  const text = root.textContent;
  return root instanceof HTMLElement
    && root.classList.contains('easymde-immersive-visual-editor')
    && new TextEncoder().encode(text ?? '').length
      > LARGE_IMMERSIVE_PREVIEW_BYTE_LIMIT;
}

function stringValue(
  config: FrontendEnhancementConfig,
  key: string,
  fallback: string
): string {
  const strings = property(config, 'strings');
  const value = property(strings, key);
  return value ? String(value) : fallback || '';
}

function mathText(element: HTMLElement): string {
  const value = (element.textContent || '').trim();

  if ('$$' === value.slice(0, 2) && '$$' === value.slice(-2)) {
    return normalizeMathTex(value.slice(2, -2).trim());
  }

  if ('\\(' === value.slice(0, 2) && '\\)' === value.slice(-2)) {
    return normalizeMathTex(value.slice(2, -2).trim());
  }

  return normalizeMathTex(value);
}

type CodeComputedStyles = Readonly<{
  backgroundColor: string;
  color: string;
}>;

type CodeFrameBackgroundEntry = Readonly<{
  backgroundColor: string;
  isMermaid: boolean;
  languageBadges: ReadonlyArray<HTMLElement>;
  lineNumberColor: string;
  parent: HTMLElement;
}>;

const CODE_FRAME_SELECTOR = 'pre > code.hljs, pre.easymde-code-block > code';
const VISUAL_CODE_LANGUAGE_BADGE_CLASS = 'easymde-visual-code-lang';

function readCodeFrameBackgroundEntry(
  element: Element,
  windowRef: Pick<Window, 'getComputedStyle'>
): CodeFrameBackgroundEntry {
  if (!(element instanceof HTMLElement) || !element.parentElement) {
    throw new Error('easymde-code-frame-parent-missing');
  }
  const computed = windowRef.getComputedStyle(element);
  const parent = element.parentElement;
  return {
    backgroundColor: computed.backgroundColor,
    isMermaid: isMermaidCode(element),
    languageBadges: [...parent.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement
        && child.classList.contains(VISUAL_CODE_LANGUAGE_BADGE_CLASS)
    ),
    lineNumberColor: computed.color,
    parent
  };
}

function writeCodeFrameBackgroundEntry(entry: CodeFrameBackgroundEntry): void {
  if (entry.isMermaid) {
    entry.parent.setAttribute('data-easymde-mermaid-fallback', '1');
  }
  entry.parent.style.setProperty(
    '--easymde-code-frame-background',
    entry.backgroundColor
  );
  if (!entry.lineNumberColor) {
    return;
  }
  if (entry.parent.classList.contains('easymde-code-with-line-numbers')) {
    entry.parent.style.setProperty(
      '--easymde-code-line-number-color',
      entry.lineNumberColor
    );
  }
  // Visual-editor language badges follow the live code-theme foreground so a
  // code-theme switch never leaves stale badge text on the new frame.
  for (const badge of entry.languageBadges) {
    badge.style.setProperty('color', entry.lineNumberColor);
  }
}

export function syncCodeFrameBackgrounds(
  root: ParentNode,
  windowRef: Pick<Window, 'getComputedStyle'>
): void {
  // Pass 1 (read-only): read all computed styles before mutating any attribute
  // or inline custom property so the browser never thrashes style recalculation
  // across multiple code frames.
  const entries = [...root.querySelectorAll(CODE_FRAME_SELECTOR)].map(
    (element) => readCodeFrameBackgroundEntry(element, windowRef)
  );
  // Pass 2 (write-only): apply all frame attributes and custom properties.
  for (const entry of entries) {
    writeCodeFrameBackgroundEntry(entry);
  }
}

function syncCodeFrameBackground(
  element: Element,
  windowRef: Pick<Window, 'getComputedStyle'>,
  computedStyles?: ReadonlyMap<HTMLElement, CodeComputedStyles>
): void {
  if (!(element instanceof HTMLElement) || !element.parentElement) {
    throw new Error('easymde-code-frame-parent-missing');
  }
  const cached = computedStyles?.get(element);
  const backgroundColor = cached
    ? cached.backgroundColor
    : windowRef.getComputedStyle(element).backgroundColor;
  if (isMermaidCode(element)) {
    element.parentElement.setAttribute('data-easymde-mermaid-fallback', '1');
  }
  element.parentElement.style.setProperty(
    '--easymde-code-frame-background',
    backgroundColor
  );
}

function syncCodeLineNumberGutter(
  element: Element,
  windowRef: FrontendEnhancementWindow,
  computedStyles?: ReadonlyMap<HTMLElement, CodeComputedStyles>
): void {
  if (!(element instanceof HTMLElement) || !element.parentElement) {
    throw new Error('easymde-code-line-number-parent-missing');
  }

  const pre = element.parentElement;
  const existingGutters = [...pre.children].filter((child) =>
    child.classList.contains('easymde-code-line-number-gutter')
  );
  const enabled = !isMermaidCode(element)
    && Boolean(element.closest('.easymde-code-line-numbers'));

  if (!enabled) {
    existingGutters.forEach((gutter) => {
      gutter.remove();
    });
    pre.classList.remove('easymde-code-with-line-numbers');
    pre.style.removeProperty('--easymde-code-line-number-gutter-width');
    pre.style.removeProperty('--easymde-code-line-number-color');
    return;
  }

  const cached = computedStyles?.get(element);
  const lineNumberColor = cached
    ? cached.color
    : windowRef.getComputedStyle(element).color;
  const codeText = element.textContent || '';
  const lineCount = Math.max(
    1,
    codeText.split('\n').length - (codeText.endsWith('\n') ? 1 : 0)
  );
  const gutter = existingGutters.shift() ?? element.ownerDocument.createElement('span');
  const lines = element.ownerDocument.createDocumentFragment();
  existingGutters.forEach((duplicate) => {
    duplicate.remove();
  });
  gutter.className = 'easymde-code-line-number-gutter';
  gutter.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < lineCount; index += 1) {
    lines.append(element.ownerDocument.createElement('span'));
  }
  gutter.replaceChildren(lines);
  pre.classList.add('easymde-code-with-line-numbers');
  pre.style.setProperty(
    '--easymde-code-line-number-gutter-width',
    `${Math.max(2, String(lineCount).length)}ch`
  );
  pre.style.setProperty(
    '--easymde-code-line-number-color',
    lineNumberColor
  );
  pre.insertBefore(gutter, element);
}

async function highlightCode(
  root: ParentNode,
  config: FrontendEnhancementConfig,
  windowRef: FrontendEnhancementWindow,
  scheduler: FrontendEnhancementScheduler,
  control: FrontendEnhancementControl
): Promise<boolean> {
  const syntaxHighlight = featureEnabled(config, 'syntaxHighlight');
  const scheduleOptions = isLargeImmersivePreviewRoot(root)
    ? { maxItemsPerSlice: LARGE_IMMERSIVE_ITEMS_PER_SLICE }
    : undefined;
  const codeBlocks = [...root.querySelectorAll('pre > code')].filter(
    (element) => !isMermaidCode(element) || !featureEnabled(config, 'mermaid')
  );

  if (!await runScheduled(
    codeBlocks,
    (element) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('easymde-code-element-invalid');
      }

      element.classList.add('hljs');
      if (
        isMermaidCode(element)
        || !syntaxHighlight
        || !windowRef.hljs
        || element.dataset.easymdeHighlighted
      ) return;

      windowRef.hljs.highlightElement(element);
      element.dataset.easymdeHighlighted = '1';
    },
    scheduler,
    control,
    scheduleOptions
  )) return false;
  const allCodeBlocks = [...root.querySelectorAll('pre > code')];
  // Batch every getComputedStyle read before any gutter or frame DOM writes so
  // large previews never interleave style mutations with forced style recalcs.
  const computedStyles = new Map<HTMLElement, CodeComputedStyles>();
  for (const element of allCodeBlocks) {
    if (!(element instanceof HTMLElement) || !element.parentElement) continue;
    const needsColor = !isMermaidCode(element)
      && Boolean(element.closest('.easymde-code-line-numbers'));
    const needsBackground = element.classList.contains('hljs');
    if (!needsColor && !needsBackground) continue;
    const computed = windowRef.getComputedStyle(element);
    computedStyles.set(element, {
      backgroundColor: computed.backgroundColor,
      color: computed.color
    });
  }
  if (!await runScheduled(
    allCodeBlocks,
    (element) => syncCodeLineNumberGutter(element, windowRef, computedStyles),
    scheduler,
    control,
    scheduleOptions
  )) return false;
  return runScheduled(
    [...root.querySelectorAll('pre > code.hljs')],
    (element) => syncCodeFrameBackground(element, windowRef, computedStyles),
    scheduler,
    control,
    scheduleOptions
  );
}

async function markMermaidAssetFailure(
  root: ParentNode,
  config: FrontendEnhancementConfig,
  scheduler: FrontendEnhancementScheduler,
  control: FrontendEnhancementControl
): Promise<boolean> {
  const error = property(property(config, 'assetErrors'), 'mermaid')
    ?? property(property(config, 'features'), 'mermaidAssetError');
  if ('string' !== typeof error || !error) return true;

  return runScheduled(
    [...root.querySelectorAll('pre > code')],
    (element) => {
      if (!isMermaidCode(element)) return;
      if (!(element instanceof HTMLElement) || !element.parentElement) {
        throw new Error('easymde-mermaid-parent-missing');
      }
      element.parentElement.setAttribute('data-easymde-mermaid-error', error);
    },
    scheduler,
    control
  );
}

export function renderMathContent(
  root: ParentNode,
  config: FrontendEnhancementConfig,
  windowRef: FrontendEnhancementWindow,
  options: FrontendEnhancementRuntimeOptions = {}
): Promise<void> {
  if (!featureEnabled(config, 'math')) return Promise.resolve();
  const katex = windowRef.katex;
  if (!katex) return Promise.resolve();
  const { control, scheduler } = enhancementRuntimeOptions(windowRef, options);
  const mathNodes = [
    ...root.querySelectorAll('.easymde-math:not([data-easymde-rendered])')
  ];
  if (0 === mathNodes.length) return Promise.resolve();
  const cache = katexHtmlCache(katex);
  const scheduleOptions: ScheduledWorkOptions = {
    maxItemsPerSlice: isLargeImmersivePreviewRoot(root)
      ? LARGE_IMMERSIVE_ITEMS_PER_SLICE
      : MATH_ITEMS_PER_SLICE
  };
  return runScheduled(
    mathNodes,
    (element): ScheduledWorkCost => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('easymde-math-element-invalid');
      }
      const displayMode = element.classList.contains('easymde-math-block');
      const tex = mathText(element);
      const cacheKey = `${displayMode ? '1' : '0'}\0${tex}`;
      const cachedHtml = readLruCache(cache, cacheKey);
      if (undefined !== cachedHtml) {
        element.innerHTML = cachedHtml;
        element.dataset.easymdeRendered = '1';
        return 0;
      }

      try {
        katex.render(tex, element, {
          displayMode,
          throwOnError: false,
          strict: 'warn'
        });
        element.dataset.easymdeRendered = '1';
        const renderedHtml = element.innerHTML;
        if (
          tex.length <= KATEX_CACHE_MAX_TEX_LENGTH
          && renderedHtml.length > 0
          && renderedHtml.length <= KATEX_CACHE_MAX_HTML_LENGTH
        ) {
          writeLruCache(cache, cacheKey, renderedHtml, KATEX_CACHE_MAX_ENTRIES);
        }
      } catch {
        element.classList.add('easymde-render-error');
        element.dataset.easymdeRendered = '1';
      }
      return 1;
    },
    scheduler,
    control,
    scheduleOptions
  ).then(() => undefined);
}

function markMermaidRenderError(
  pre: HTMLElement,
  config: FrontendEnhancementConfig
): void {
  pre.classList.add('easymde-render-error');
  pre.setAttribute(
    'data-easymde-error',
    stringValue(config, 'renderingFailed', '')
  );
}

async function renderUncachedMermaidDiagram(
  mermaid: MermaidRuntime,
  cache: Map<string, CachedMermaidSvg>,
  config: FrontendEnhancementConfig,
  control: FrontendEnhancementControl,
  pre: HTMLElement,
  container: HTMLElement,
  renderId: string,
  source: string
): Promise<ScheduledWorkCost> {
  try {
    const result = await mermaid.render(renderId, source);
    if (!enhancementIsCurrent(control) || !pre.parentNode) return 1;
    const cacheKey = mermaidCacheKey(source);
    if (
      cacheKey.length > 0
      && cacheKey.length <= MERMAID_CACHE_MAX_SOURCE_LENGTH
      && result.svg.length <= MERMAID_CACHE_MAX_SVG_LENGTH
      && result.svg.includes(renderId)
      && !cacheKey.includes(renderId)
    ) {
      writeLruCache(
        cache,
        cacheKey,
        { renderId, svg: result.svg },
        MERMAID_CACHE_MAX_ENTRIES
      );
    }
    container.innerHTML = result.svg;
    markIntrinsicMermaidLayout(container);
    pre.parentNode.replaceChild(container, pre);
  } catch {
    if (!enhancementIsCurrent(control)) return 1;
    markMermaidRenderError(pre, config);
  }
  return 1;
}

export function readCachedMermaidSvg(
  source: string,
  renderId: string,
  windowRef: FrontendEnhancementWindow
): string | null {
  const mermaid = windowRef.mermaid;
  const cacheKey = mermaidCacheKey(source);
  if (!mermaid || !cacheKey || !renderId) return null;
  const cache = mermaidSvgCaches.get(mermaid);
  if (!cache) return null;
  const cached = readLruCache(cache, cacheKey);
  if (!cached) return null;
  return cached.svg.split(cached.renderId).join(renderId);
}

export function writeCachedMermaidSvg(
  source: string,
  renderId: string,
  svg: string,
  windowRef: FrontendEnhancementWindow
): void {
  const mermaid = windowRef.mermaid;
  const cacheKey = mermaidCacheKey(source);
  if (
    !mermaid
    || !renderId
    || cacheKey.length === 0
    || cacheKey.length > MERMAID_CACHE_MAX_SOURCE_LENGTH
    || svg.length === 0
    || svg.length > MERMAID_CACHE_MAX_SVG_LENGTH
    || !svg.includes(renderId)
    || cacheKey.includes(renderId)
  ) {
    return;
  }
  writeLruCache(
    mermaidSvgCache(mermaid),
    cacheKey,
    { renderId, svg },
    MERMAID_CACHE_MAX_ENTRIES
  );
}

export function renderMermaidContent(
  root: ParentNode,
  config: FrontendEnhancementConfig,
  windowRef: FrontendEnhancementWindow,
  options: FrontendEnhancementRuntimeOptions = {}
): Promise<void> {
  const mermaid = windowRef.mermaid;
  if (!featureEnabled(config, 'mermaid') || !mermaid) {
    return Promise.resolve();
  }
  const { control, scheduler } = enhancementRuntimeOptions(windowRef, options);
  const mermaidNodes = [
    ...root.querySelectorAll('pre > code:not([data-easymde-rendered])')
  ].filter((element) => isMermaidCode(element));
  if (0 === mermaidNodes.length) {
    return Promise.resolve();
  }
  const cache = mermaidSvgCache(mermaid);
  let mermaidInitFailed = false;

  return runScheduled(
    mermaidNodes,
    (element): ScheduledWorkCost | Promise<ScheduledWorkCost> => {
      if (!(element instanceof HTMLElement) || !element.parentElement) {
        throw new Error('easymde-mermaid-parent-missing');
      }
      const pre = element.parentElement;
      const source = element.textContent || '';
      const container = element.ownerDocument.createElement('div');
      const renderId = `easymde-mermaid-${Date.now()}-${++mermaidRenderIndex}`;

      container.className = 'easymde-mermaid';

      const cacheKey = mermaidCacheKey(source);
      const cached = cacheKey.length > 0 ? readLruCache(cache, cacheKey) : undefined;
      if (cached) {
        element.dataset.easymdeRendered = '1';
        if (!pre.parentNode) return 0;
        container.innerHTML = cached.svg.split(cached.renderId).join(renderId);
        markIntrinsicMermaidLayout(container);
        pre.parentNode.replaceChild(container, pre);
        return 0;
      }

      if (!mermaidInitFailed) {
        try {
          initializeMermaidRuntime(mermaid);
        } catch {
          mermaidInitFailed = true;
        }
      }
      if (!enhancementIsCurrent(control)) return 0;
      if (mermaidInitFailed) {
        markMermaidRenderError(pre, config);
        return 0;
      }

      element.dataset.easymdeRendered = '1';
      return renderUncachedMermaidDiagram(
        mermaid,
        cache,
        config,
        control,
        pre,
        container,
        renderId,
        source
      );
    },
    scheduler,
    control,
    { maxItemsPerSlice: MERMAID_ITEMS_PER_SLICE }
  ).then(() => undefined);
}

export function enhanceFrontendContent(
  root: ParentNode | null,
  config: FrontendEnhancementConfig,
  windowRef: FrontendEnhancementWindow,
  options: FrontendEnhancementRuntimeOptions = {}
): Promise<void> {
  if (!root) return Promise.resolve();
  const { control, scheduler } = enhancementRuntimeOptions(windowRef, options);
  return highlightCode(root, config, windowRef, scheduler, control)
    .then((highlighted) => {
      if (!highlighted) return false;
      return markMermaidAssetFailure(root, config, scheduler, control);
    })
    .then((marked) => {
      if (!marked || !enhancementIsCurrent(control)) return false;
      if (!windowRef.EasyMDEMathRenderer) return true;
      return Promise.resolve(
        windowRef.EasyMDEMathRenderer.render(root, config, control)
      ).then(() => enhancementIsCurrent(control));
    })
    .then((mathReady) => {
      if (!mathReady || !windowRef.EasyMDEMermaidRenderer) return;
      return windowRef.EasyMDEMermaidRenderer.render(root, config, control)
        .then(() => undefined);
    });
}
