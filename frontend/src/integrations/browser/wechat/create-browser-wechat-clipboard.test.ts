// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  WechatClipboardCopyOptions,
  WechatClipboardPreparationOptions
} from '../../../contracts/ports/wechat-clipboard-port';
import type {
  WechatVisualRasterizationResult,
  WechatVisualRasterizationYield
} from '../../../contracts/ports/wechat-visual-rasterization-port';
import {
  CLIPBOARD_COMMIT_TIMEOUT_MS,
  type ClipboardItemConstructor,
  createBrowserWechatClipboard,
  MAX_WECHAT_PNG_DIMENSION,
  MAX_WECHAT_PNG_UPLOAD_CONCURRENCY,
  MAX_WECHAT_PNG_VISUALS,
  WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS,
  WECHAT_PNG_TRANSACTION_TIMEOUT_MS
} from './create-browser-wechat-clipboard';

function readyPreview(): HTMLElement {
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', 'true');
  preview.innerHTML =
    '<p id="private-id" class="theme-class" data-easymde-rendered="1">Rendered</p><script>bad()</script><style>.bad{}</style>';
  Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Rendered' });
  return preview;
}
function computedStyle(element: Element, pseudoElement?: string): CSSStyleDeclaration {
  if (pseudoElement) return { getPropertyValue: () => '' } as unknown as CSSStyleDeclaration;
  return window.getComputedStyle(element);
}

function declaration(values: Record<string, string>): CSSStyleDeclaration {
  return { getPropertyValue: (property: string) => values[property] ?? '' } as unknown as CSSStyleDeclaration;
}

function captionFaultComputedStyle(element: Element, pseudoElement?: string): CSSStyleDeclaration {
  if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
  if ('INPUT' === element.tagName) {
    return declaration({ appearance: 'none', display: 'block', height: '12px', position: 'absolute', width: '12px' });
  }
  if ('ARTICLE' === element.tagName) {
    return declaration({
      'border-bottom-width': '0px',
      'border-left-width': '0px',
      'border-right-width': '0px',
      'border-top-width': '0px',
      'box-sizing': 'content-box',
      display: 'block',
      'padding-bottom': '0px',
      'padding-left': '0px',
      'padding-right': '0px',
      'padding-top': '0px',
      'white-space': 'normal'
    });
  }
  if (['SPAN', 'STRONG'].includes(element.tagName)) return declaration({ display: 'inline', 'white-space': 'normal' });
  return declaration({ display: 'block', 'white-space': 'normal' });
}

const safeMermaidComputedStyleMap = (): Readonly<{ get: (property: string) => Readonly<{ value: string }> }> => ({
  get: (property) => ({
    value:
      {
        'block-size': 'auto',
        height: 'auto',
        'max-block-size': 'none',
        'max-height': 'none',
        'min-block-size': 'auto',
        'min-height': 'auto'
      }[property] ?? 'auto'
  })
});

function setMermaidComputedStyleMap(source: Element, overrides: Record<string, string> = {}): void {
  Object.defineProperty(source, 'computedStyleMap', {
    configurable: true,
    value: () => ({
      get: (property: string) => ({
        ...safeMermaidComputedStyleMap().get(property),
        ...(property in overrides ? { value: overrides[property] } : {})
      })
    })
  });
}

function mdmdtNormalPngDataUrl(): string {
  const css = readFileSync(join(process.cwd(), 'assets/themes/article/mdmdt.css'), 'utf8');
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while (true) {
    match = rulePattern.exec(css);
    if (null === match) break;
    const selectorText = match[1];
    const ruleText = match[2];
    if (undefined === selectorText || undefined === ruleText) continue;
    const selectors = selectorText.split(',').map((selector) => selector.trim());
    if (!selectors.includes('.easymde-rendered-content.easymde-markdown-theme-mdmdt p a::before')) continue;
    const dataUrl = /background-image:\s*url\(["'](data:image\/png;base64,[^"']+)["']\)/u.exec(ruleText)?.[1];
    if (dataUrl) return dataUrl;
  }
  throw new Error('Mdmdt normal PNG data URI missing');
}

async function blobText(value: Blob | PromiseLike<Blob>): Promise<string> {
  return (await value).text();
}

function codeRows(code: Element | null): HTMLElement | null {
  if (!code) return null;
  return (
    [...code.children].find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        'SPAN' === child.tagName &&
        (child.getAttribute('style') ?? '').includes('display:block!important') &&
        (child.getAttribute('style') ?? '').includes('width:max-content!important')
    ) ?? null
  );
}

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void }> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function installHiddenImageProbe(): Readonly<{
  capture: () => HTMLImageElement | null;
  dispatch: (type: 'error' | 'load') => void;
  restore: () => void;
  setReady: (ready: boolean) => void;
  workspace: HTMLElement;
  preview: HTMLElement;
}> {
  let cloneImageReady = false;
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', '1');
  preview.innerHTML = '<p>Image readiness</p><img loading="lazy" src="https://example.test/ready.png">';
  Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Image readiness' });
  const sourceImage = preview.querySelector('img');
  if (!sourceImage) throw new Error('hidden probe source image missing');
  Object.defineProperties(sourceImage, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 64 },
    naturalHeight: { configurable: true, value: 32 }
  });
  const workspace = document.createElement('div');
  workspace.className = 'workspace-shell';
  workspace.append(preview);
  document.body.append(workspace);
  let lastClone: HTMLImageElement | null = null;
  const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
  const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
  const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
  const originalNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');
  const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (this: HTMLElement) {
      if (this.classList.contains('workspace-shell')) {
        return { bottom: 240, height: 240, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
      }
      return (
        originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
      );
    }
  });
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.closest('.easymde-wechat-preview-measurement') ? cloneImageReady : true;
    }
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.closest('.easymde-wechat-preview-measurement') && cloneImageReady ? 64 : 0;
    }
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.closest('.easymde-wechat-preview-measurement') && cloneImageReady ? 32 : 0;
    }
  });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: vi.fn(async () => undefined)
  });

  return {
    capture: () => {
      lastClone = document.querySelector<HTMLImageElement>('.easymde-wechat-preview-measurement img');
      return lastClone;
    },
    dispatch: (type) => {
      const image = document.querySelector<HTMLImageElement>('.easymde-wechat-preview-measurement img') ?? lastClone;
      if (!image) throw new Error('hidden probe clone image missing');
      lastClone = image;
      image.dispatchEvent(new Event(type));
    },
    restore: () => {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalComplete) Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
      else delete (HTMLImageElement.prototype as unknown as { complete?: unknown }).complete;
      if (originalNaturalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
      else delete (HTMLImageElement.prototype as unknown as { naturalWidth?: unknown }).naturalWidth;
      if (originalNaturalHeight)
        Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', originalNaturalHeight);
      else delete (HTMLImageElement.prototype as unknown as { naturalHeight?: unknown }).naturalHeight;
      if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
      else delete (HTMLImageElement.prototype as unknown as { decode?: unknown }).decode;
      workspace.remove();
    },
    setReady: (ready) => {
      cloneImageReady = ready;
    },
    workspace,
    preview
  };
}

function prepareClipboard(
  clipboard: ReturnType<typeof createBrowserWechatClipboard>,
  preview: HTMLElement,
  options?: WechatClipboardPreparationOptions
): Promise<void> {
  const prepare = clipboard.prepare;
  if (!prepare) throw new Error('clipboard preparation is unavailable');
  return prepare(preview, options);
}

function pngOptions(
  rasterize: NonNullable<WechatClipboardCopyOptions['visualRasterizationPort']>,
  upload: NonNullable<WechatClipboardCopyOptions['imageUploadPort']>,
  overrides: Partial<WechatClipboardCopyOptions> = {}
): WechatClipboardCopyOptions {
  return {
    imageUploadPort: upload,
    maxBytes: 1024,
    pngConversionEnabled: true,
    postId: 17,
    signal: new AbortController().signal,
    visualRasterizationPort: rasterize,
    ...overrides
  };
}

type MermaidCenteringCase = Readonly<{
  cssLeft: string;
  cssRight: string;
  direction?: string;
  display?: string;
  inlineLeft?: string;
  inlineRight?: string;
  label: string;
  overflow?: string;
  rootMarginLeft?: string;
  rootMarginRight?: string;
  textAlign?: string;
  typed: 'auto' | 'missing' | 'pixels' | 'throw' | 'zero';
  expected: boolean;
}>;

async function copyMermaidCenteringCase(
  testCase: MermaidCenteringCase
): Promise<Readonly<{ imageStyle: string; ownerStyle: string }>> {
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', '1');
  preview.innerHTML =
    '<div class="easymde-mermaid"><svg width="180" height="40">' + '<path d="M0 0h180v40H0z"></path></svg></div>';
  Object.defineProperty(preview, 'innerText', { configurable: true, value: testCase.label });
  const root = preview.querySelector('.easymde-mermaid');
  const svg = preview.querySelector('svg');
  if (!root || !svg) throw new Error('Mermaid centering fixture missing');
  Object.defineProperty(svg, 'computedStyleMap', {
    configurable: true,
    value:
      'missing' === testCase.typed
        ? undefined
        : 'throw' === testCase.typed
          ? () => {
              throw new Error('TypedOM unavailable');
            }
          : () => ({
              get: (property: string) => ({
                value: ['margin-left', 'margin-right'].includes(property)
                  ? 'auto' === testCase.typed
                    ? 'auto'
                    : 'zero' === testCase.typed
                      ? '0px'
                      : '120px'
                  : 'auto'
              })
            })
  });
  if (testCase.inlineLeft) svg.style.setProperty('margin-left', testCase.inlineLeft);
  if (testCase.inlineRight) svg.style.setProperty('margin-right', testCase.inlineRight);
  class ClipboardItemStub {
    constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
  }
  const writes: string[] = [];
  const rootOverflow = testCase.overflow ?? 'auto';
  const clipboard = createBrowserWechatClipboard({
    blob: Blob,
    clipboardItem: ClipboardItemStub,
    document,
    getComputedStyle: (element, pseudoElement) => {
      if (pseudoElement) return declaration({});
      if (element === root) {
        return declaration({
          display: 'block',
          height: '40px',
          'margin-left': testCase.rootMarginLeft ?? '7px',
          'margin-right': testCase.rootMarginRight ?? '9px',
          direction: testCase.direction ?? 'ltr',
          overflow: rootOverflow,
          'overflow-x': rootOverflow,
          'overflow-y': 'visible',
          'text-align': testCase.textAlign ?? 'left',
          width: '180px'
        });
      }
      if (element === svg) {
        return declaration({
          display: testCase.display ?? 'block',
          height: '40px',
          'margin-left': testCase.cssLeft,
          'margin-right': testCase.cssRight,
          width: '180px'
        });
      }
      return declaration({ display: 'block' });
    },
    getSelection: window.getSelection.bind(window),
    pageOffset: () => ({ x: 0, y: 0 }),
    scrollTo: vi.fn(),
    write: async (items) => {
      const item = items[0] as ClipboardItemStub;
      const html = item.payload['text/html'];
      if (!html) throw new Error('Mermaid centering HTML missing');
      writes.push(await blobText(html));
    }
  });
  const rasterize = vi.fn(async () => ({
    file: new File([testCase.label], `${testCase.label}.png`, { type: 'image/png' }),
    height: 40,
    pixelCount: 7200,
    width: 180
  }));
  const upload = vi.fn(async () => ({
    alt: '',
    status: 'uploaded' as const,
    title: `${testCase.label}.png`,
    url: `https://example.test/${testCase.label}.png`
  }));

  await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
    method: 'clipboard',
    status: 'copied'
  });
  const holder = document.createElement('div');
  holder.innerHTML = writes[0] ?? '';
  const image = holder.querySelector('img');
  if (!image) throw new Error('Mermaid centering image missing');
  return {
    imageStyle: image.getAttribute('style') ?? '',
    ownerStyle: image.parentElement?.getAttribute('style') ?? ''
  };
}

describe('createBrowserWechatClipboard', () => {
  const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
  const originalComputedStyleMap = Object.getOwnPropertyDescriptor(Element.prototype, 'computedStyleMap');
  const originalGetAnimations = Object.getOwnPropertyDescriptor(document, 'getAnimations');

  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'computedStyleMap', {
      configurable: true,
      value: safeMermaidComputedStyleMap
    });
    Object.defineProperty(document, 'getAnimations', { configurable: true, value: () => [] });
  });

  afterEach(() => {
    document.querySelectorAll('.easymde-copy-sandbox').forEach((element) => {
      element.remove();
    });
    if (originalExecCommand) {
      Object.defineProperty(document, 'execCommand', originalExecCommand);
    } else {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
    if (originalComputedStyleMap) {
      Object.defineProperty(Element.prototype, 'computedStyleMap', originalComputedStyleMap);
    } else {
      delete (Element.prototype as unknown as { computedStyleMap?: unknown }).computedStyleMap;
    }
    if (originalGetAnimations) {
      Object.defineProperty(document, 'getAnimations', originalGetAnimations);
    } else {
      delete (document as unknown as { getAnimations?: unknown }).getAnimations;
    }
  });

  it('starts PNG rasterization only after modern Clipboard write invocation', async () => {
    const writes: unknown[] = [];
    const measure = vi.spyOn(window.performance, 'measure');
    const clearMeasures = vi.spyOn(window.performance, 'clearMeasures');
    let writeReturned = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="20" height="10"><path d="M0 0"></path></svg></div><table><tbody><tr><td>Keep HTML</td></tr></tbody></table>';
    const liveMermaid = preview.querySelector('.easymde-mermaid');
    if (!liveMermaid) throw new Error('live Mermaid missing');
    Object.defineProperty(liveMermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 })
    });
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Keep HTML' });
    let rasterizationYield: WechatVisualRasterizationYield | undefined;
    const rasterize = vi.fn(async ({ yieldToBrowser }: { yieldToBrowser?: WechatVisualRasterizationYield }) => {
      rasterizationYield = yieldToBrowser;
      expect(yieldToBrowser).toBeDefined();
      expect(yieldToBrowser?.shouldYield).toEqual(expect.any(Function));
      await yieldToBrowser?.();
      expect(writeReturned).toBe(true);
      return {
        file: new File(['png'], 'wechat-mermaid.png', { type: 'image/png' }),
        height: 10,
        pixelCount: 200,
        width: 20
      };
    });
    const upload = vi.fn(async ({ file, postId }: { file: File; postId: number }) => {
      expect(file.type).toBe('image/png');
      expect(postId).toBe(17);
      return { alt: '', status: 'uploaded' as const, title: '', url: 'https://example.test/wechat-mermaid.png' };
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn((items) => {
        writeReturned = true;
        writes.push(items);
        return Promise.resolve();
      })
    });

    await expect(
      clipboard.copy(preview, {
        imageUploadPort: { upload },
        isCurrent: () => true,
        maxBytes: 1024,
        pngConversionEnabled: true,
        postId: 17,
        signal: new AbortController().signal,
        visualRasterizationPort: { rasterize }
      })
    ).resolves.toEqual({ method: 'clipboard', status: 'copied' });

    expect(rasterize).toHaveBeenCalledWith(
      expect.objectContaining({ height: 10, kind: 'mermaid', yieldToBrowser: rasterizationYield, width: 20 })
    );
    expect(upload).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
    const measuredNames = new Set(measure.mock.calls.map(([name]) => name));
    expect(measuredNames).toEqual(
      new Set([
        'easymde.wechat.copy.candidate.capture',
        'easymde.wechat.copy.candidate.geometry',
        'easymde.wechat.copy.candidate.rasterization',
        'easymde.wechat.copy.replacement',
        'easymde.wechat.copy.finalize-markup',
        'easymde.wechat.copy.outer-html',
        'easymde.wechat.copy.connected-plain-text',
        'easymde.wechat.copy.final-raw-context-refresh',
        'easymde.wechat.copy.final-geometry',
        'easymde.wechat.copy.final-source-freshness'
      ])
    );
    expect(clearMeasures.mock.calls.map(([name]) => name)).toEqual(measure.mock.calls.map(([name]) => name));
    measure.mock.calls.forEach(([, options]) => {
      const timingOptions = options as PerformanceMeasureOptions & { detail?: Record<string, unknown> };
      expect(timingOptions.start).toEqual(expect.any(Number));
      expect(timingOptions.end).toEqual(expect.any(Number));
      expect(Object.keys(timingOptions.detail ?? {}).sort()).toEqual(
        Object.keys(timingOptions.detail ?? {})
          .filter((key) => ['candidate', 'kind', 'mode', 'terminal'].includes(key))
          .sort()
      );
      expect(timingOptions.detail?.mode).toMatch(/^(?:sync|async)$/u);
      expect(timingOptions.detail?.terminal).toMatch(/^(?:success|error)$/u);
      if ('candidate' in (timingOptions.detail ?? {})) {
        expect(timingOptions.detail?.candidate).toEqual(expect.any(Number));
        expect(timingOptions.detail?.candidate as number).toBeGreaterThanOrEqual(0);
        expect(timingOptions.detail?.candidate as number).toBeLessThanOrEqual(31);
        expect(timingOptions.detail?.kind).toMatch(/^(?:math|mermaid)$/u);
      }
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelector('img[src="https://example.test/wechat-mermaid.png"]')).not.toBeNull();
    expect(holder.querySelector('table')).not.toBeNull();
    expect(preview.querySelector('svg')).not.toBeNull();
  });

  it.each([
    [
      'resolved TypedOM auto',
      { cssLeft: '120px', cssRight: '120px', expected: true, label: 'typed-auto', typed: 'auto' }
    ],
    [
      'literal CSSOM auto',
      { cssLeft: 'auto', cssRight: 'auto', expected: true, label: 'cssom-auto', typed: 'missing' }
    ],
    ['numeric margins', { cssLeft: '120px', cssRight: '120px', expected: false, label: 'numeric', typed: 'pixels' }],
    [
      'custom margins',
      { cssLeft: 'var(--gap)', cssRight: 'var(--gap)', expected: false, label: 'custom', typed: 'missing' }
    ],
    ['zero margins', { cssLeft: '0px', cssRight: '0px', expected: false, label: 'zero', typed: 'missing' }],
    [
      'computed and TypedOM zero margins',
      { cssLeft: '0px', cssRight: '0px', expected: false, label: 'typed-zero', typed: 'zero' }
    ],
    ['one-sided auto', { cssLeft: 'auto', cssRight: '120px', expected: false, label: 'one-sided', typed: 'missing' }],
    [
      'throwing TypedOM',
      { cssLeft: '120px', cssRight: '120px', expected: false, label: 'typed-throw', typed: 'throw' }
    ],
    [
      'missing TypedOM',
      { cssLeft: '120px', cssRight: '120px', expected: false, label: 'typed-missing', typed: 'missing' }
    ],
    [
      'inline auto overridden by computed pixels',
      {
        cssLeft: '120px',
        cssRight: '120px',
        expected: false,
        inlineLeft: 'auto',
        inlineRight: 'auto',
        label: 'inline-auto',
        typed: 'pixels'
      }
    ],
    [
      'inline SVG display',
      {
        cssLeft: 'auto',
        cssRight: 'auto',
        display: 'inline-block',
        expected: false,
        label: 'inline-display',
        typed: 'auto'
      }
    ],
    [
      'center text alignment with zero SVG margins',
      {
        cssLeft: '0px',
        cssRight: '0px',
        expected: false,
        label: 'text-align-center',
        textAlign: 'center',
        typed: 'missing'
      }
    ],
    [
      'RTL auto margins',
      { cssLeft: '120px', cssRight: '120px', direction: 'rtl', expected: true, label: 'rtl-auto', typed: 'auto' }
    ],
    [
      'no-wrapper flow margins',
      {
        cssLeft: 'auto',
        cssRight: 'auto',
        expected: false,
        label: 'no-wrapper-flow',
        overflow: 'visible',
        rootMarginLeft: '7px',
        rootMarginRight: '9px',
        typed: 'auto'
      }
    ]
  ] as const)('centers retained Mermaid PNG only for %s', async (_label, testCase) => {
    const result = await copyMermaidCenteringCase(testCase);
    expect(result.imageStyle).toContain('display:block');
    if (testCase.expected) {
      expect(result.imageStyle).toContain('margin-left:auto!important');
      expect(result.imageStyle).toContain('margin-right:auto!important');
    } else {
      expect(result.imageStyle).not.toContain('margin-left:auto!important');
      expect(result.imageStyle).not.toContain('margin-right:auto!important');
    }
    if ('visible' === (testCase as MermaidCenteringCase).overflow) {
      expect(result.imageStyle).toContain('margin-left:7px');
      expect(result.imageStyle).toContain('margin-right:9px');
    }
  });

  it.each([
    ['margin-only', 'margin'],
    ['display-only', 'display']
  ] as const)('rejects computed Mermaid %s changes after rasterization waits', async (_label, changedProperty) => {
    const pendingRasterization = deferred<WechatVisualRasterizationResult>();
    let typedMargin = 'auto';
    let computedDisplay = 'block';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="180" height="40">' + '<path d="M0 0h180v40H0z"></path></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'snapshot' });
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid snapshot fixture missing');
    const stableRect = (): DOMRect =>
      ({ bottom: 40, height: 40, left: 0, right: 180, top: 0, width: 180, x: 0, y: 0 }) as DOMRect;
    Object.defineProperty(root, 'getBoundingClientRect', { configurable: true, value: stableRect });
    Object.defineProperty(svg, 'getBoundingClientRect', { configurable: true, value: stableRect });
    Object.defineProperty(svg, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({
          value: ['margin-left', 'margin-right'].includes(property) ? typedMargin : 'auto'
        })
      })
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const writes: string[] = [];
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root) {
          return declaration({
            display: 'block',
            height: '40px',
            'margin-left': '7px',
            'margin-right': '9px',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'visible',
            width: '180px'
          });
        }
        if (element === svg) {
          return declaration({
            display: computedDisplay,
            height: '40px',
            'margin-left': '120px',
            'margin-right': '120px',
            width: '180px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('snapshot HTML missing');
        writes.push(await blobText(html));
      }
    });
    const rasterize = vi.fn(async () => {
      if ('margin' === changedProperty) typedMargin = '120px';
      if ('display' === changedProperty) computedDisplay = 'inline-block';
      return pendingRasterization.promise;
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'snapshot.png',
      url: 'https://example.test/snapshot.png'
    }));

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    pendingRasterization.resolve({
      file: new File(['snapshot'], 'snapshot.png', { type: 'image/png' }),
      height: 40,
      pixelCount: 7200,
      width: 180
    });
    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(root.getBoundingClientRect()).toEqual(svg.getBoundingClientRect());
    expect(writes).toHaveLength(0);
    expect(upload).toHaveBeenCalledOnce();
  });

  it('rejects a Mermaid auto-to-fixed source margin mutation during rasterization', async () => {
    const pendingRasterization = deferred<WechatVisualRasterizationResult>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="180" height="40"' +
      ' style="display:block;margin-left:auto;margin-right:auto">' +
      '<path d="M0 0h180v40H0z"></path></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'source mutation' });
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid source mutation fixture missing');
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const writes: unknown[] = [];
    const rasterize = vi.fn(async () => {
      (svg as SVGSVGElement).style.setProperty('margin-left', '0px');
      (svg as SVGSVGElement).style.setProperty('margin-right', '0px');
      return pendingRasterization.promise;
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'source-mutation.png',
      url: 'https://example.test/source-mutation.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root) {
          return declaration({ display: 'block', overflow: 'auto', 'overflow-x': 'auto', width: '180px' });
        }
        if (element === svg) {
          return declaration({
            display: 'block',
            'margin-left': svg.style.getPropertyValue('margin-left'),
            'margin-right': svg.style.getPropertyValue('margin-right')
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    pendingRasterization.resolve({
      file: new File(['source-mutation'], 'source-mutation.png', { type: 'image/png' }),
      height: 40,
      pixelCount: 7200,
      width: 180
    });

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(writes).toHaveLength(1);
    expect(upload).not.toHaveBeenCalled();
  });

  it('surfaces a direct SVG CSSOM failure without upload side effects', async () => {
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="180" height="40">' + '<path d="M0 0h180v40H0z"></path></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'cssom failure' });
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid CSSOM failure fixture missing');
    let svgStyleReads = 0;
    const rasterize = vi.fn(async () => ({
      file: new File(['cssom'], 'cssom.png', { type: 'image/png' }),
      height: 40,
      pixelCount: 7200,
      width: 180
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'cssom.png',
      url: 'https://example.test/cssom.png'
    }));
    const write = vi.fn(async (items: unknown[]) => {
      const html = (items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> }).payload['text/html'];
      if (!html) throw new Error('CSSOM failure HTML missing');
      await blobText(html);
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root) {
          return declaration({ display: 'block', overflow: 'auto', 'overflow-x': 'auto', width: '180px' });
        }
        if (element === svg) {
          svgStyleReads += 1;
          if (svgStyleReads > 1) throw new Error('CSSOM margin read failed');
          return declaration({ display: 'block', 'margin-left': '120px', 'margin-right': '120px' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(write).toHaveBeenCalledOnce();
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('logs privacy-safe candidate diagnostics while preserving the aggregate failure', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<span class="easymde-math-inline" style="display:inline-block">' +
      '<span class="katex"><span class="katex-html"></span></span></span>';
    const rasterize = vi.fn(async () => {
      throw Object.assign(new Error('ignored'), { code: 'wechat-png-baseline-failed' });
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/math.png'
    }));
    const write = vi.fn(async () => undefined);
    const measure = vi.spyOn(window.performance, 'measure');
    const clearMeasures = vi.spyOn(window.performance, 'clearMeasures');
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'none',
      status: 'failed'
    });

    expect(diagnostic).toHaveBeenCalledWith(
      '[EasyMDE] wechat-png-rasterization-failed',
      expect.objectContaining({
        candidate: 0,
        height: expect.any(Number),
        kind: 'math',
        originalCode: 'wechat-png-baseline-failed',
        stage: 'rasterization',
        width: expect.any(Number)
      })
    );
    expect(upload).not.toHaveBeenCalled();
    const failedRasterization = measure.mock.calls.find(
      ([name, options]) =>
        name === 'easymde.wechat.copy.candidate.rasterization' &&
        (options as PerformanceMeasureOptions & { detail?: { terminal?: string } }).detail?.terminal === 'error'
    );
    expect(failedRasterization).toBeDefined();
    expect(clearMeasures).toHaveBeenCalledWith('easymde.wechat.copy.candidate.rasterization');
  });

  it('stops the rasterizer after its scheduler yield when the conversion is stale', async () => {
    const callbackStarted = deferred<void>();
    let current = true;
    let didAdvance = false;
    let decodeCalls = 0;
    let encodeCalls = 0;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"><path d="M0 0"></path></svg></div>';
    const liveMermaid = preview.querySelector('.easymde-mermaid');
    if (!liveMermaid) throw new Error('live Mermaid missing');
    Object.defineProperty(liveMermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 })
    });
    const rasterize = vi.fn(
      async ({
        yieldToBrowser
      }: {
        yieldToBrowser?: WechatVisualRasterizationYield;
      }): Promise<WechatVisualRasterizationResult> => {
        if (!yieldToBrowser) throw new Error('rasterization scheduler missing');
        while (!yieldToBrowser.shouldYield()) {
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        const yieldResult = yieldToBrowser();
        callbackStarted.resolve();
        await yieldResult;
        didAdvance = true;
        decodeCalls += 1;
        encodeCalls += 1;
        return {
          file: new File(['png'], 'wechat-mermaid.png', { type: 'image/png' }),
          height: 10,
          pixelCount: 200,
          width: 20
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'wechat-mermaid.png',
      url: 'https://example.test/wechat-mermaid.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never, { isCurrent: () => current }));
    await callbackStarted.promise;
    current = false;

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(didAdvance).toBe(false);
    expect(decodeCalls).toBe(0);
    expect(encodeCalls).toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });

  it('passes Mermaid downscale compensation separately from DPR to the rasterizer', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="100" height="50" viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg></div>';
    const liveMermaid = preview.querySelector('.easymde-mermaid');
    const liveSvg = preview.querySelector('svg');
    if (!liveMermaid || !liveSvg) throw new Error('Mermaid source missing');
    Object.defineProperty(liveMermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(liveSvg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(liveSvg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
    });
    let layoutMagnification: number | undefined;
    const rasterize = vi.fn(
      async ({
        layoutMagnification: value,
        scale,
        width,
        height
      }: {
        height: number;
        layoutMagnification?: number;
        scale: number;
        width: number;
      }) => {
        layoutMagnification = value;
        expect(scale).toBe(1);
        expect(width).toBe(100);
        expect(height).toBe(50);
        return {
          file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
          height: 100,
          pixelCount: 10_000,
          width: 200
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'mermaid.png',
      url: 'https://example.test/mermaid.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    document.body.append(preview);
    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(layoutMagnification).toBe(2);
    preview.remove();
  });

  it('captures a neutral Mermaid child viewport and retains its finite responsive cap', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="350.3125" height="725.734375"' +
      ' viewBox="0 0 350.3125 725.734375" style="display:block;margin-left:auto;' +
      'margin-right:auto;">' +
      '<rect width="350.3125" height="725.734375"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('responsive Mermaid source missing');
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 725.734375, height: 725.734375, left: 0, right: 461.25, top: 0, width: 461.25 })
    });
    setMermaidComputedStyleMap(root);
    setMermaidComputedStyleMap(svg, { height: 'auto', 'max-height': 'none', 'max-width': '350.316px', width: '100%' });
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 725.734375, height: 725.734375, left: 0, right: 461.25, top: 0, width: 461.25 })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 725.734375,
        height: 725.734375,
        left: 55.46875,
        right: 405.78125,
        top: 0,
        width: 350.3125
      })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    });
    let svgFilter = 'none';
    let svgEffectiveStylesUnknown = false;
    let mutateDuringClone = false;
    let cloneMutationScheduled = false;
    const setResponsiveSvgStyleMap = (margin = 'auto'): void => {
      setMermaidComputedStyleMap(svg, {
        height: 'auto',
        'margin-left': margin,
        'margin-right': margin,
        'max-height': 'none',
        'max-width': '350.316px',
        width: '100%'
      });
    };
    setResponsiveSvgStyleMap();
    const originalRootCloneNode = root.cloneNode.bind(root);
    vi.spyOn(root, 'cloneNode').mockImplementation((deep) => {
      const clone = originalRootCloneNode(deep);
      if (mutateDuringClone && !cloneMutationScheduled) {
        cloneMutationScheduled = true;
        setResponsiveSvgStyleMap('55.46875px');
      }
      return clone;
    });
    const rootStyle: Record<string, string> = {
      'background-image': 'none',
      'border-bottom-style': 'none',
      'border-bottom-width': '0px',
      'border-left-style': 'none',
      'border-left-width': '0px',
      'border-radius': '0px',
      'border-right-style': 'none',
      'border-right-width': '0px',
      'border-top-style': 'none',
      'border-top-width': '0px',
      'box-shadow': 'none',
      display: 'block',
      float: 'none',
      filter: 'none',
      height: 'auto',
      'mask-image': 'none',
      overflow: 'auto',
      'overflow-x': 'auto',
      'overflow-y': 'auto',
      padding: '0px',
      'padding-bottom': '0px',
      'padding-left': '0px',
      'padding-right': '0px',
      'padding-top': '0px',
      position: 'static',
      opacity: '1',
      transform: 'none',
      width: '100%'
    };
    const writes: unknown[] = [];
    const rasterize = vi.fn(
      async ({
        height,
        mermaidCapture,
        source,
        width
      }: {
        height: number;
        mermaidCapture?: string;
        source: Element;
        width: number;
      }) => {
        expect(mermaidCapture).toBe('responsive-viewport');
        expect(source.matches('svg')).toBe(true);
        expect(source.getAttribute('viewBox')).toBe('0 0 350.3125 725.734375');
        expect({ height, width }).toEqual({ height: 725.734375, width: 350.3125 });
        return {
          file: new File(['responsive'], 'responsive.png', { type: 'image/png' }),
          height,
          pixelCount: 351 * 727,
          width
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'responsive.png',
      url: 'https://example.test/responsive.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root) return declaration(rootStyle);
        if (element === svg) {
          const svgStyle: Record<string, string> = {
            ...rootStyle,
            display: 'block',
            filter: svgFilter,
            'margin-left': '55.46875px',
            'margin-right': '55.46875px'
          };
          if (svgEffectiveStylesUnknown) {
            delete svgStyle.height;
            delete svgStyle['max-width'];
            delete svgStyle.width;
          }
          return declaration(svgStyle);
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
      })
    });
    document.body.append(preview);
    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const html = await blobText(item?.payload['text/html'] ?? new Blob());
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const image = holder.querySelector('img');
      const retainedRoot = image?.parentElement;
      expect(retainedRoot?.getAttribute('style')).toContain('overflow:auto');
      expect(retainedRoot?.getAttribute('style')).not.toContain('max-width:350.316px');
      expect(retainedRoot?.hasAttribute('data-ignore-width')).toBe(false);
      expect(image?.getAttribute('style')).toContain('width:100%!important');
      expect(image?.getAttribute('style')).toContain('max-width:350.316px!important');
      expect(image?.getAttribute('style')).toContain('height:auto!important');
      expect(image?.getAttribute('style')).toContain('margin-left:auto!important');
      expect(image?.getAttribute('style')).toContain('margin-right:auto!important');
      expect(svg.style.marginLeft).toBe('auto');
      expect(svg.style.marginRight).toBe('auto');
      const sourceMarkupBeforeSemanticStale = svg.outerHTML;

      const pending = deferred<WechatVisualRasterizationResult>();
      rasterize.mockImplementationOnce(async () => pending.promise);
      const staleCopy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await vi.waitFor(() => expect(rasterize).toHaveBeenCalledTimes(2));
      setMermaidComputedStyleMap(svg, {
        height: 'auto',
        'max-height': 'none',
        'max-width': '350.316px',
        width: '350.3125px'
      });
      pending.resolve({
        file: new File(['stale'], 'stale.png', { type: 'image/png' }),
        height: 725.734375,
        pixelCount: 351 * 727,
        width: 350.3125
      });
      await expect(staleCopy).resolves.toMatchObject({ code: 'wechat-png-rasterization-cancelled', status: 'failed' });
      expect(writes).toHaveLength(2);
      const staleItem = (writes[1] as ClipboardItemStub[])[0];
      await expect(blobText(staleItem?.payload['text/html'] ?? new Blob())).rejects.toThrow();

      setResponsiveSvgStyleMap();
      const rawMarginPending = deferred<WechatVisualRasterizationResult>();
      rasterize.mockImplementationOnce(async () => rawMarginPending.promise);
      const rawMarginStaleCopy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await vi.waitFor(() => expect(rasterize).toHaveBeenCalledTimes(3));
      setResponsiveSvgStyleMap('55.46875px');
      rawMarginPending.resolve({
        file: new File(['raw-margin-stale'], 'raw-margin-stale.png', { type: 'image/png' }),
        height: 725.734375,
        pixelCount: 351 * 727,
        width: 350.3125
      });
      await expect(rawMarginStaleCopy).resolves.toMatchObject({
        code: 'wechat-png-rasterization-cancelled',
        status: 'failed'
      });
      expect(svg.outerHTML).toBe(sourceMarkupBeforeSemanticStale);
      setResponsiveSvgStyleMap();

      setMermaidComputedStyleMap(svg, {
        height: '725.734375px',
        'max-height': 'none',
        'max-width': '350.316px',
        width: '350px'
      });
      rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
        expect(mermaidCapture).toBeUndefined();
        expect({ height, width }).toEqual({ height: 725.734375, width: 461.25 });
        return {
          file: new File(['fallback'], 'fallback.png', { type: 'image/png' }),
          height,
          pixelCount: 461 * 726,
          width
        };
      });
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      setMermaidComputedStyleMap(svg, {
        height: 'auto',
        'max-height': 'none',
        'max-width': '350.316px',
        width: '100%'
      });

      for (const [property, value] of [
        ['opacity', '0.5'],
        ['opacity', ''],
        ['border-radius', '4px'],
        ['box-shadow', '0 0 1px black'],
        ['filter', 'blur(1px)'],
        ['float', 'left'],
        ['background-color', 'rgb(1, 2, 3)']
      ] as const) {
        rootStyle[property] = value;
        rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
          expect(mermaidCapture).toBeUndefined();
          expect({ height, width }).toEqual({ height: 725.734375, width: 461.25 });
          return {
            file: new File([property], `${property}.png`, { type: 'image/png' }),
            height,
            pixelCount: 461 * 726,
            width
          };
        });
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        if ('opacity' === property) {
          rootStyle[property] = '1';
        } else if ('float' === property) {
          rootStyle[property] = 'none';
        } else if ('border-radius' === property) {
          rootStyle[property] = '0px';
        } else if ('box-shadow' === property) {
          rootStyle[property] = 'none';
        } else if ('filter' === property) {
          rootStyle[property] = 'none';
        } else {
          delete rootStyle[property];
        }
      }
      svgFilter = 'blur(1px)';
      rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
        expect(mermaidCapture).toBeUndefined();
        expect({ height, width }).toEqual({ height: 725.734375, width: 461.25 });
        return {
          file: new File(['svg-filter'], 'svg-filter.png', { type: 'image/png' }),
          height,
          pixelCount: 461 * 726,
          width
        };
      });
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      svgFilter = 'none';

      for (const [label, mutate, restore] of [
        [
          'grid formatting owner',
          () => preview.style.setProperty('display', 'grid'),
          () => preview.style.removeProperty('display')
        ]
      ] as const) {
        mutate();
        rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
          expect(mermaidCapture, label).toBeUndefined();
          expect({ height, width }).toEqual({ height: 725.734375, width: 461.25 });
          return {
            file: new File([label], `${label}.png`, { type: 'image/png' }),
            height,
            pixelCount: 461 * 726,
            width
          };
        });
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        restore();
      }
      svgEffectiveStylesUnknown = true;
      Object.defineProperty(svg, 'computedStyleMap', {
        configurable: true,
        value: () => ({ get: () => ({ value: 120 }) })
      });
      rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
        expect(mermaidCapture).toBeUndefined();
        expect({ height, width }).toEqual({ height: 725.734375, width: 461.25 });
        return {
          file: new File(['unknown-effective'], 'unknown-effective.png', { type: 'image/png' }),
          height,
          pixelCount: 461 * 726,
          width
        };
      });
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      svgEffectiveStylesUnknown = false;
      setResponsiveSvgStyleMap();
      mutateDuringClone = true;
      cloneMutationScheduled = false;
      rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
        expect(mermaidCapture).toBe('responsive-viewport');
        return {
          file: new File(['clone-stale'], 'clone-stale.png', { type: 'image/png' }),
          height,
          pixelCount: 351 * 727,
          width
        };
      });
      const cloneStaleCopy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await expect(cloneStaleCopy).resolves.toMatchObject({
        code: 'wechat-png-rasterization-cancelled',
        status: 'failed'
      });
      expect(cloneMutationScheduled).toBe(true);
      expect(svg.outerHTML).toBe(sourceMarkupBeforeSemanticStale);
      mutateDuringClone = false;
      setResponsiveSvgStyleMap();
      const uploadsBeforeMismatchedResult = upload.mock.calls.length;
      rasterize.mockReset();
      rasterize.mockImplementation(async ({ height, mermaidCapture, width }) => {
        expect(mermaidCapture).toBe('responsive-viewport');
        return {
          file: new File(['default-responsive'], 'default-responsive.png', { type: 'image/png' }),
          height,
          pixelCount: 351 * 727,
          width
        };
      });
      rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
        expect(mermaidCapture).toBe('responsive-viewport');
        return {
          file: new File(['mismatched'], 'mismatched.png', { type: 'image/png' }),
          height,
          pixelCount: 1,
          width
        };
      });
      const mismatchedResult = await clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      expect(mismatchedResult).toMatchObject({
        code: 'wechat-png-rasterization-failed',
        sideEffects: 'none',
        status: 'failed'
      });
      expect(upload).toHaveBeenCalledTimes(uploadsBeforeMismatchedResult);
    } finally {
      preview.remove();
    }
  });

  it.each([
    ['gantt', '0 0 1200 268', 1200, 268],
    ['sequence', '-40.5 8.25 640.5 268.25', 640.5, 268.25],
    ['timeline', '12.5 -6.75 900.25 320.5', 900.25, 320.5]
  ] as const)(
    'captures the intrinsic viewport for a marked %s scroll owner',
    async (role, viewBox, viewportWidth, viewportHeight) => {
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob>) {}
      }
      const preview = readyPreview();
      preview.style.position = 'fixed';
      preview.innerHTML =
        `<div class="easymde-mermaid" data-easymde-mermaid-layout="${role}">` +
        `<svg aria-roledescription="${role}" width="${viewportWidth}" height="${viewportHeight}" viewBox="${viewBox}">` +
        `<rect width="${viewportWidth}" height="${viewportHeight}"></rect></svg></div>`;
      const root = preview.querySelector('.easymde-mermaid');
      const svg = preview.querySelector('svg');
      if (!root || !svg) throw new Error(`${role} source missing`);
      let direction: 'ltr' | 'rtl' = 'ltr';
      let ownerWidth = 335;
      let scrollLeft = 0;
      setMermaidComputedStyleMap(root);
      Object.defineProperty(preview, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ bottom: viewportHeight, height: viewportHeight, left: 0, right: 335, top: 0, width: 335 })
      });
      Object.defineProperties(root, {
        clientWidth: { configurable: true, value: 335 },
        scrollLeft: { configurable: true, get: () => scrollLeft },
        scrollWidth: { configurable: true, value: viewportWidth }
      });
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          bottom: viewportHeight,
          height: viewportHeight,
          left: 0,
          right: ownerWidth,
          top: 0,
          width: ownerWidth
        })
      });
      Object.defineProperty(svg, 'getBoundingClientRect', {
        configurable: true,
        value: () => {
          const left =
            ownerWidth > viewportWidth
              ? (ownerWidth - viewportWidth) / 2
              : 'rtl' === direction
                ? -(viewportWidth - 335) - scrollLeft
                : -scrollLeft;
          return {
            bottom: viewportHeight,
            height: viewportHeight,
            left,
            right: left + viewportWidth,
            top: 0,
            width: viewportWidth
          };
        }
      });
      Object.defineProperty(svg, 'getScreenCTM', {
        configurable: true,
        value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
      });
      const writes: unknown[] = [];
      let observed: Readonly<{ height: number; layoutMagnification?: number; width: number }> | null = null;
      let observedCapture: string | undefined;
      const rasterize = vi.fn(
        async ({
          height,
          layoutMagnification,
          mermaidCapture,
          source,
          width
        }: {
          height: number;
          layoutMagnification?: number;
          mermaidCapture?: string;
          source: Element;
          width: number;
        }) => {
          expect(source.querySelector(':scope > svg')?.getAttribute('aria-roledescription')).toBe(role);
          observed = { height, ...(layoutMagnification !== undefined ? { layoutMagnification } : {}), width };
          observedCapture = mermaidCapture;
          return {
            file: new File([role], `${role}.png`, { type: 'image/png' }),
            height,
            pixelCount: Math.ceil(width) * Math.ceil(height),
            width
          };
        }
      );
      const upload = vi.fn(async () => ({
        alt: '',
        status: 'uploaded' as const,
        title: 'gantt.png',
        url: 'https://example.test/gantt.png'
      }));
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return declaration({});
          if (element === root || element.matches('.easymde-mermaid[data-easymde-mermaid-layout="gantt"]')) {
            return declaration({
              'border-bottom-style': 'none',
              'border-bottom-width': '0px',
              'border-left-style': 'none',
              'border-left-width': '0px',
              'border-right-style': 'none',
              'border-right-width': '0px',
              'border-top-style': 'none',
              'border-top-width': '0px',
              'background-color': 'rgb(18, 18, 18)',
              'background-image': 'none',
              'border-radius': '0px',
              'box-shadow': 'none',
              direction,
              display: 'block',
              filter: 'none',
              height: 'auto',
              'max-height': 'none',
              overflow: 'auto',
              'overflow-x': 'auto',
              'overflow-y': 'auto',
              'padding-bottom': '0px',
              'padding-left': '0px',
              'padding-right': '0px',
              'padding-top': '0px'
            });
          }
          if (element === svg || element.matches('svg')) {
            return declaration({
              'border-bottom-style': 'none',
              'border-bottom-width': '0px',
              'border-left-style': 'none',
              'border-left-width': '0px',
              'border-right-style': 'none',
              'border-right-width': '0px',
              'border-top-style': 'none',
              'border-top-width': '0px',
              padding: '0px',
              'padding-bottom': '0px',
              'padding-left': '0px',
              'padding-right': '0px',
              'padding-top': '0px',
              display: 'block',
              'margin-left': 'auto',
              'margin-right': 'auto',
              transform: 'none'
            });
          }
          return computedStyle(element);
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: vi.fn(async (items) => {
          writes.push(items);
        })
      });

      const uiClipShell = document.createElement('div');
      uiClipShell.style.overflowX = 'hidden';
      uiClipShell.style.overflowY = 'auto';
      uiClipShell.append(preview);
      document.body.append(uiClipShell);
      try {
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        expect(observed).toEqual({ height: viewportHeight, layoutMagnification: 1, width: viewportWidth });
        expect(observedCapture).toBe('intrinsic-viewport');
        const firstItem = (writes[0] as ClipboardItemStub[])[0];
        const firstHtml = firstItem?.payload['text/html'];
        if (!firstHtml) throw new Error('intrinsic Mermaid HTML missing');
        const firstHolder = document.createElement('div');
        firstHolder.innerHTML = await blobText(firstHtml);
        const firstImage = firstHolder.querySelector('img');
        expect(firstImage?.getAttribute('style')).toContain('margin-left:auto!important');
        expect(firstImage?.getAttribute('style')).toContain('margin-right:auto!important');
        direction = 'ltr';
        scrollLeft = viewportWidth - 335;
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        direction = 'rtl';
        scrollLeft = 0;
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        direction = 'rtl';
        scrollLeft = -(viewportWidth - 335);
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        ownerWidth = 1600;
        Object.defineProperty(root, 'clientWidth', { configurable: true, value: ownerWidth });
        Object.defineProperty(root, 'scrollWidth', { configurable: true, value: ownerWidth });
        direction = 'ltr';
        scrollLeft = 0;
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        expect(observed).toEqual({ height: viewportHeight, layoutMagnification: 1, width: viewportWidth });
        expect(observedCapture).toBe('intrinsic-viewport');
        expect(rasterize).toHaveBeenCalledTimes(5);
      } finally {
        uiClipShell.remove();
      }
    }
  );

  it('accepts measured Timeline fractional CTM and viewBox rounding within one pixel quantum', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid" data-easymde-mermaid-layout="timeline">' +
      '<svg aria-roledescription="timeline" width="790" height="512.1875"' +
      ' viewBox="-18.25 7.5 790 512.200012">' +
      '<rect width="790" height="512.200012"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('measured Timeline source missing');
    const viewBoxWidth = 790;
    const viewBoxHeight = 512.200012;
    const renderedHeight = 512.1875;
    const measuredScale = renderedHeight / viewBoxHeight;
    let rootWidth = viewBoxWidth;
    let rootHeight = renderedHeight;
    let svgWidth = viewBoxWidth;
    let svgHeight = renderedHeight;
    let ownerClientWidth = viewBoxWidth;
    let ownerScrollWidth = viewBoxWidth;
    let ctm = { a: measuredScale, b: 0, c: 0, d: measuredScale, e: 0, f: 0 };
    setMermaidComputedStyleMap(root);
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: rootHeight, height: rootHeight, left: 0, right: rootWidth, top: 0, width: rootWidth })
    });
    Object.defineProperties(root, {
      clientWidth: { configurable: true, get: () => ownerClientWidth },
      scrollLeft: { configurable: true, value: 0 },
      scrollWidth: { configurable: true, get: () => ownerScrollWidth }
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: svgHeight, height: svgHeight, left: 0, right: svgWidth, top: 0, width: svgWidth })
    });
    Object.defineProperty(svg, 'getScreenCTM', { configurable: true, value: () => ctm });
    let observed: Readonly<{ height: number; layoutMagnification?: number; width: number }> | null = null;
    const rasterize = vi.fn(
      async ({
        height,
        layoutMagnification,
        mermaidCapture,
        source,
        width
      }: {
        height: number;
        layoutMagnification?: number;
        mermaidCapture?: string;
        source: Element;
        width: number;
      }) => {
        expect(source.querySelector(':scope > svg')?.getAttribute('aria-roledescription')).toBe('timeline');
        observed = { height, ...(layoutMagnification !== undefined ? { layoutMagnification } : {}), width };
        expect(mermaidCapture).toBe('intrinsic-viewport');
        return {
          file: new File(['timeline'], 'timeline.png', { type: 'image/png' }),
          height,
          pixelCount: Math.ceil(width) * Math.ceil(height),
          width
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'timeline.png',
      url: 'https://example.test/timeline.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root) {
          return declaration({
            'background-image': 'none',
            'border-bottom-style': 'none',
            'border-bottom-width': '0px',
            'border-left-style': 'none',
            'border-left-width': '0px',
            'border-right-style': 'none',
            'border-right-width': '0px',
            'border-top-style': 'none',
            'border-top-width': '0px',
            'box-shadow': 'none',
            direction: 'ltr',
            display: 'block',
            filter: 'none',
            height: 'auto',
            'max-height': 'none',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            position: 'static',
            transform: 'none'
          });
        }
        if (element === svg) {
          return declaration({
            'border-bottom-style': 'none',
            'border-bottom-width': '0px',
            'border-left-style': 'none',
            'border-left-width': '0px',
            'border-right-style': 'none',
            'border-right-width': '0px',
            'border-top-style': 'none',
            'border-top-width': '0px',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            bottom: 'auto',
            left: 'auto',
            position: 'static',
            right: 'auto',
            top: 'auto',
            transform: 'none'
          });
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    document.body.append(preview);
    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(observed).toEqual({ height: viewBoxHeight, layoutMagnification: 1, width: viewBoxWidth });
      expect(rasterize).toHaveBeenCalledOnce();
      expect(upload).toHaveBeenCalledOnce();

      const rejectedGeometries = [
        {
          label: 'normal rect with half CTM',
          ctm: { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 },
          rootHeight: renderedHeight,
          rootWidth: viewBoxWidth,
          svgHeight: renderedHeight,
          svgWidth: viewBoxWidth,
          transform: null
        },
        {
          label: 'half rect with half CTM',
          ctm: { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 },
          rootHeight: viewBoxHeight / 2,
          rootWidth: viewBoxWidth / 2,
          svgHeight: viewBoxHeight / 2,
          svgWidth: viewBoxWidth / 2,
          transform: null
        },
        {
          label: 'single-axis CTM',
          ctm: { a: 0.5, b: 0, c: 0, d: 1, e: 0, f: 0 },
          rootHeight: renderedHeight,
          rootWidth: viewBoxWidth,
          svgHeight: renderedHeight,
          svgWidth: viewBoxWidth,
          transform: null
        },
        {
          label: 'rotation CTM',
          ctm: { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 },
          rootHeight: renderedHeight,
          rootWidth: viewBoxWidth,
          svgHeight: renderedHeight,
          svgWidth: viewBoxWidth,
          transform: null
        },
        {
          label: 'skew CTM',
          ctm: { a: 1, b: 0.25, c: 0, d: 1, e: 0, f: 0 },
          rootHeight: renderedHeight,
          rootWidth: viewBoxWidth,
          svgHeight: renderedHeight,
          svgWidth: viewBoxWidth,
          transform: null
        },
        {
          label: 'explicit transform masked by identity CTM',
          ctm: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
          rootHeight: renderedHeight,
          rootWidth: viewBoxWidth,
          svgHeight: renderedHeight,
          svgWidth: viewBoxWidth,
          transform: 'scale(0.5)'
        }
      ] as const;
      for (const rejected of rejectedGeometries) {
        ctm = rejected.ctm;
        rootHeight = rejected.rootHeight;
        rootWidth = rejected.rootWidth;
        svgHeight = rejected.svgHeight;
        svgWidth = rejected.svgWidth;
        ownerClientWidth = rejected.rootWidth;
        ownerScrollWidth = rejected.label === 'half rect with half CTM' ? viewBoxWidth : rejected.rootWidth;
        if (rejected.transform) svg.setAttribute('transform', rejected.transform);
        else svg.removeAttribute('transform');
        rasterize.mockClear();
        upload.mockClear();
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          code: 'wechat-png-rasterization-failed',
          sideEffects: 'none',
          status: 'failed'
        });
        expect(rasterize, rejected.label).not.toHaveBeenCalled();
        expect(upload, rejected.label).not.toHaveBeenCalled();
      }
    } finally {
      preview.remove();
    }
  });

  it('captures a marked Gantt from a hidden measurement owner outside UI clipping', async () => {
    const writes: unknown[] = [];
    const requests: Array<Readonly<{ height: number; width: number }>> = [];
    let measurementGeometryReads = 0;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid" data-easymde-mermaid-layout="gantt">' +
      '<svg aria-roledescription="gantt" width="1200" height="268" viewBox="0 0 1200 268">' +
      '<rect width="1200" height="268"></rect></svg></div>';
    const originalMarkup = preview.innerHTML;
    const uiPane = document.createElement('div');
    uiPane.className = 'preview-pane';
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    uiPane.append(workspace);
    document.body.append(uiPane);

    const rect = (left: number, width: number, height: number, top = 0) => ({
      bottom: top + height,
      height,
      left,
      right: left + width,
      top,
      width,
      x: left,
      y: top
    });
    const originalHtmlRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalSvgRect = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBoundingClientRect');
    const originalCtm = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'getScreenCTM');
    const originalClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    const originalScrollLeft = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');
    const originalScrollWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) return rect(0, 500, 268);
        if (this.classList.contains('preview-pane')) return rect(0, 335, 268);
        if (this.classList.contains('easymde-mermaid')) {
          if (this.closest('.easymde-wechat-preview-measurement')) measurementGeometryReads += 1;
          return rect(0, 335, 268);
        }
        return originalHtmlRect?.value?.call(this) ?? rect(0, 0, 0);
      }
    });
    Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: SVGElement) {
        if (this.closest('.easymde-wechat-preview-measurement') || 'svg' === this.localName) {
          return rect(0, 1200, 268);
        }
        return originalSvgRect?.value?.call(this) ?? rect(0, 0, 0);
      }
    });
    Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    });
    Object.defineProperty(Element.prototype, 'clientWidth', {
      configurable: true,
      get: function (this: Element) {
        return this.classList.contains('easymde-mermaid') ? 335 : (originalClientWidth?.get?.call(this) ?? 0);
      }
    });
    Object.defineProperty(Element.prototype, 'scrollLeft', {
      configurable: true,
      get: function (this: Element) {
        return this.classList.contains('easymde-mermaid') ? 0 : (originalScrollLeft?.get?.call(this) ?? 0);
      }
    });
    Object.defineProperty(Element.prototype, 'scrollWidth', {
      configurable: true,
      get: function (this: Element) {
        return this.classList.contains('easymde-mermaid') ? 1200 : (originalScrollWidth?.get?.call(this) ?? 0);
      }
    });
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => {
      requests.push({ height, width });
      return {
        file: new File(['hidden-gantt'], 'gantt.png', { type: 'image/png' }),
        height,
        pixelCount: width * height,
        width
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'gantt.png',
      url: 'https://example.test/gantt.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element.classList.contains('preview-pane')) {
          return declaration({ display: 'block', overflow: 'hidden', 'overflow-x': 'hidden', 'overflow-y': 'auto' });
        }
        if (element.classList.contains('workspace-shell')) {
          return declaration({
            display: 'none',
            overflow: 'hidden',
            'overflow-x': 'hidden',
            'overflow-y': 'auto',
            width: '500px'
          });
        }
        if (element.classList.contains('easymde-mermaid')) {
          return declaration({
            'border-bottom-style': 'none',
            'border-bottom-width': '0px',
            'border-left-style': 'none',
            'border-left-width': '0px',
            'border-right-style': 'none',
            'border-right-width': '0px',
            'border-top-style': 'none',
            'border-top-width': '0px',
            direction: 'ltr',
            display: 'block',
            height: 'auto',
            'max-height': 'none',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            transform: 'none'
          });
        }
        if ('svg' === element.localName) {
          return declaration({
            'border-bottom-style': 'none',
            'border-bottom-width': '0px',
            'border-left-style': 'none',
            'border-left-width': '0px',
            'border-right-style': 'none',
            'border-right-width': '0px',
            'border-top-style': 'none',
            'border-top-width': '0px',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            transform: 'none'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
      })
    });

    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(requests).toEqual([{ height: 268, width: 1200 }]);
      expect(measurementGeometryReads).toBeGreaterThan(0);
      expect(upload).toHaveBeenCalledOnce();
      expect(writes).toHaveLength(1);
      expect(preview.innerHTML).toBe(originalMarkup);
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      if (originalHtmlRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalHtmlRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalSvgRect) Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', originalSvgRect);
      else delete (SVGElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalCtm) Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', originalCtm);
      else delete (SVGSVGElement.prototype as unknown as { getScreenCTM?: unknown }).getScreenCTM;
      if (originalClientWidth) Object.defineProperty(Element.prototype, 'clientWidth', originalClientWidth);
      else delete (Element.prototype as unknown as { clientWidth?: unknown }).clientWidth;
      if (originalScrollLeft) Object.defineProperty(Element.prototype, 'scrollLeft', originalScrollLeft);
      else delete (Element.prototype as unknown as { scrollLeft?: unknown }).scrollLeft;
      if (originalScrollWidth) Object.defineProperty(Element.prototype, 'scrollWidth', originalScrollWidth);
      else delete (Element.prototype as unknown as { scrollWidth?: unknown }).scrollWidth;
      uiPane.remove();
    }
  });

  it.each([
    [
      'Bloom decoration',
      {
        borderBottomStyle: 'none',
        borderBottomWidth: '0px',
        borderLeftStyle: 'none',
        borderLeftWidth: '0px',
        borderRightStyle: 'none',
        borderRightWidth: '0px',
        borderTopStyle: 'none',
        borderTopWidth: '0px',
        paddingBottom: '10px',
        paddingLeft: '10px',
        paddingRight: '10px',
        paddingTop: '10px',
        rootHeight: 288,
        rootWidth: 1220,
        svgLeft: 10,
        svgTop: 10,
        svgWidth: 1200,
        svgHeight: 268,
        outputWidth: 1220,
        outputHeight: 288
      }
    ],
    [
      'non-symmetric padding',
      {
        borderBottomStyle: 'none',
        borderBottomWidth: '0px',
        borderLeftStyle: 'none',
        borderLeftWidth: '0px',
        borderRightStyle: 'none',
        borderRightWidth: '0px',
        borderTopStyle: 'none',
        borderTopWidth: '0px',
        paddingBottom: '10px',
        paddingLeft: '14px',
        paddingRight: '12px',
        paddingTop: '8px',
        rootHeight: 286,
        rootWidth: 1226,
        svgLeft: 14,
        svgTop: 8,
        svgWidth: 1200,
        svgHeight: 268,
        outputWidth: 1226,
        outputHeight: 286
      }
    ],
    [
      'one pixel solid border',
      {
        borderBottomStyle: 'solid',
        borderBottomWidth: '1px',
        borderLeftStyle: 'solid',
        borderLeftWidth: '1px',
        borderRightStyle: 'solid',
        borderRightWidth: '1px',
        borderTopStyle: 'solid',
        borderTopWidth: '1px',
        paddingBottom: '10px',
        paddingLeft: '10px',
        paddingRight: '10px',
        paddingTop: '10px',
        rootHeight: 290,
        rootWidth: 1222,
        svgLeft: 11,
        svgTop: 11,
        svgWidth: 1200,
        svgHeight: 268,
        outputWidth: 1222,
        outputHeight: 290
      }
    ]
  ])('captures a decorated intrinsic Gantt root: %s', async (_label, geometry) => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid" data-easymde-mermaid-layout="gantt">' +
      '<svg aria-roledescription="gantt" width="1200" height="268" viewBox="0 0 1200 268">' +
      '<rect width="1200" height="268"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('decorated Gantt source missing');
    setMermaidComputedStyleMap(root);
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: geometry.rootHeight,
        height: geometry.rootHeight,
        left: 0,
        right: geometry.rootWidth,
        top: 0,
        width: geometry.rootWidth
      })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: geometry.svgTop + geometry.svgHeight,
        height: geometry.svgHeight,
        left: geometry.svgLeft,
        right: geometry.svgLeft + geometry.svgWidth,
        top: geometry.svgTop,
        width: geometry.svgWidth
      })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    });
    const writes: unknown[] = [];
    const rasterize = vi.fn(
      async ({ height, mermaidCapture, width }: { height: number; mermaidCapture?: string; width: number }) => {
        expect(mermaidCapture).toBe('intrinsic-viewport');
        expect({ height, width }).toEqual({ height: geometry.outputHeight, width: geometry.outputWidth });
        return {
          file: new File(['gantt'], 'gantt.png', { type: 'image/png' }),
          height,
          pixelCount: width * height,
          width
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'gantt.png',
      url: 'https://example.test/gantt.png'
    }));
    const rootStyle = {
      background: 'rgb(24, 24, 24)',
      'background-color': 'rgb(24, 24, 24)',
      'background-image': 'none',
      'border-bottom-style': geometry.borderBottomStyle,
      'border-bottom-width': geometry.borderBottomWidth,
      'border-left-style': geometry.borderLeftStyle,
      'border-left-width': geometry.borderLeftWidth,
      'border-right-style': geometry.borderRightStyle,
      'border-right-width': geometry.borderRightWidth,
      'border-top-style': geometry.borderTopStyle,
      'border-top-width': geometry.borderTopWidth,
      'border-radius': '12px',
      'box-shadow': 'none',
      direction: 'ltr',
      display: 'block',
      filter: 'none',
      height: 'auto',
      'max-height': 'none',
      overflow: 'auto',
      'overflow-x': 'auto',
      'overflow-y': 'auto',
      'padding-bottom': geometry.paddingBottom,
      'padding-left': geometry.paddingLeft,
      'padding-right': geometry.paddingRight,
      'padding-top': geometry.paddingTop,
      position: 'static',
      transform: 'none'
    } as Record<string, string>;
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root || element.matches('.easymde-mermaid')) return declaration(rootStyle);
        if (element === svg || element.matches('svg')) {
          return declaration({
            'border-bottom-style': 'none',
            'border-bottom-width': '0px',
            'border-left-style': 'none',
            'border-left-width': '0px',
            'border-right-style': 'none',
            'border-right-width': '0px',
            'border-top-style': 'none',
            'border-top-width': '0px',
            padding: '0px',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            transform: 'none'
          });
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
      })
    });

    document.body.append(preview);
    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(rasterize).toHaveBeenCalledOnce();
      expect(upload).toHaveBeenCalledOnce();
      const item = (writes[0] as { payload: Record<string, Blob> }[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('clipboard html missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(htmlBlob);
      const copiedImage = holder.querySelector('img[src="https://example.test/gantt.png"]');
      const copiedRoot = copiedImage?.parentElement;
      expect(copiedImage?.getAttribute('width')).toBe(String(geometry.outputWidth));
      expect(copiedImage?.getAttribute('height')).toBe(String(geometry.outputHeight));
      expect(copiedRoot?.getAttribute('style') ?? '').not.toMatch(/padding|background|border-radius/u);
    } finally {
      preview.remove();
    }
  });

  it.each([
    ['missing Gantt role', 'missing-gantt-role', 'wechat-png-rasterization-failed'],
    ['non-Gantt Mermaid role', 'non-gantt-role', 'wechat-png-rasterization-failed'],
    ['marker and role mismatch', 'marker-role-mismatch', 'wechat-png-rasterization-failed'],
    ['sequenceDiagram role', 'sequence-diagram-role', 'wechat-png-rasterization-failed'],
    ['multiple direct Gantt SVGs', 'multiple-gantt-svgs', 'wechat-png-rasterization-failed'],
    ['intrinsic layout magnification', 'intrinsic-magnification', 'wechat-png-rasterization-failed'],
    ['owner percentage padding', 'percentage-padding', 'wechat-png-rasterization-failed'],
    ['ancestor transform', 'transform', 'wechat-png-rasterization-failed'],
    ['ancestor clip', 'clip', 'wechat-png-rasterization-failed'],
    ['boundary x clip', 'boundary-x-clip', 'wechat-png-rasterization-failed'],
    ['boundary y clip', 'boundary-y-clip', 'wechat-png-rasterization-failed'],
    ['RTL wrong signed position', 'rtl-misaligned', 'wechat-png-rasterization-failed'],
    ['fractional owner offset', 'fractional', 'wechat-png-rasterization-failed'],
    ['SVG CSS transform', 'svg-transform', 'wechat-png-rasterization-failed'],
    ['wide centered SVG inline transform', 'wide-inline-transform', 'wechat-png-rasterization-failed'],
    ['SVG positioned', 'svg-position', 'wechat-png-rasterization-failed'],
    ['SVG non-auto inset', 'svg-inset', 'wechat-png-rasterization-failed'],
    ['Gantt root positioned', 'root-position', 'wechat-png-rasterization-failed'],
    ['Gantt root non-auto inset', 'root-inset', 'wechat-png-rasterization-failed'],
    ['wide fixed SVG margin', 'wide-fixed-margin', 'wechat-png-rasterization-failed'],
    ['wide root border width', 'wide-root-border-width', 'wechat-png-rasterization-failed'],
    ['wide root border style', 'wide-root-border-style', 'wechat-png-rasterization-failed'],
    ['wide root gradient', 'wide-root-gradient', 'wechat-png-rasterization-failed'],
    ['wide root shadow', 'wide-root-shadow', 'wechat-png-rasterization-failed'],
    ['wide root filter', 'wide-root-filter', 'wechat-png-rasterization-failed'],
    ['wide root clip', 'wide-root-clip', 'wechat-png-rasterization-failed'],
    ['wide root mask', 'wide-root-mask', 'wechat-png-rasterization-failed'],
    ['wide root radius unit', 'wide-root-radius-unit', 'wechat-png-rasterization-failed'],
    ['wide root radius overlap', 'wide-root-radius-overlap', 'wechat-png-rasterization-failed'],
    ['wide root radius computed longhand axes', 'wide-root-radius-longhand', 'wechat-png-rasterization-failed'],
    ['wide root radius computed longhand slash', 'wide-root-radius-longhand-slash', 'wechat-png-rasterization-failed'],
    ['wide root pseudo paint', 'wide-root-pseudo', 'wechat-png-rasterization-failed'],
    ['oversized viewBox', 'oversized', 'wechat-png-limit-exceeded']
  ])('fails closed for an unsafe marked Gantt geometry: %s', async (_label, failure, code) => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.className = 'gantt-ancestor';
    const viewBoxWidth = 'oversized' === failure ? MAX_WECHAT_PNG_DIMENSION + 1 : 1200;
    const wideOwner = failure.startsWith('wide-');
    const ownerWidth = wideOwner ? 1600 : 'intrinsic-magnification' === failure ? 600 : 335;
    const marker = ['marker-role-mismatch', 'sequence-diagram-role'].includes(failure) ? 'sequence' : 'gantt';
    const roleAttribute =
      'missing-gantt-role' === failure
        ? ''
        : ` aria-roledescription="${
            'non-gantt-role' === failure
              ? 'flowchart'
              : 'marker-role-mismatch' === failure
                ? 'timeline'
                : 'sequence-diagram-role' === failure
                  ? 'sequenceDiagram'
                  : 'gantt'
          }"`;
    preview.innerHTML =
      `<div class="easymde-mermaid" data-easymde-mermaid-layout="${marker}">` +
      `<svg${roleAttribute} width="${viewBoxWidth}" height="268" viewBox="0 0 ${viewBoxWidth} 268">` +
      `<rect width="${viewBoxWidth}" height="268"></rect></svg></div>`;
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('unsafe Gantt source missing');
    if ('multiple-gantt-svgs' === failure) root.append(svg.cloneNode(true));
    if ('wide-fixed-margin' === failure) {
      svg.style.marginLeft = '200px';
      svg.style.marginRight = '200px';
    }
    if ('wide-inline-transform' === failure) {
      svg.style.marginLeft = 'auto';
      svg.style.marginRight = 'auto';
      svg.style.transform = 'translateX(-200px)';
    }
    if (['boundary-x-clip', 'boundary-y-clip'].includes(failure)) {
      const boundaryClip = document.createElement('div');
      boundaryClip.className = 'gantt-inner-clip';
      root.replaceWith(boundaryClip);
      boundaryClip.append(root);
      Object.defineProperty(boundaryClip, 'getBoundingClientRect', {
        configurable: true,
        value: () =>
          'boundary-y-clip' === failure
            ? { bottom: 260, height: 260, left: 0, right: 335, top: 0, width: 335 }
            : { bottom: 268, height: 268, left: 0, right: 300, top: 0, width: 300 }
      });
    }
    setMermaidComputedStyleMap(root);
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 268, height: 268, left: 0, right: 335, top: 0, width: 335 })
    });
    if (['wide-fixed-margin', 'wide-inline-transform'].includes(failure)) {
      setMermaidComputedStyleMap(svg, {
        'margin-left': 'wide-inline-transform' === failure ? 'auto' : '200px',
        'margin-right': 'wide-inline-transform' === failure ? 'auto' : '200px'
      });
    }
    Object.defineProperties(root, {
      clientWidth: { configurable: true, value: ownerWidth },
      scrollLeft: { configurable: true, value: 'rtl-misaligned' === failure ? -400 : 0 },
      scrollWidth: {
        configurable: true,
        value: wideOwner ? ownerWidth : 'rtl-misaligned' === failure ? 2000 : viewBoxWidth
      }
    });
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 'fractional' === failure ? 268.5 : 'intrinsic-magnification' === failure ? 134 : 268,
        height: 'fractional' === failure ? 268.5 : 'intrinsic-magnification' === failure ? 134 : 268,
        left: 0,
        right: ownerWidth,
        top: 0,
        width: ownerWidth
      })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        const left = wideOwner ? 200 : 'rtl-misaligned' === failure ? -1265 : 0;
        const top = 'fractional' === failure ? 0.5 : 0;
        const width = 'intrinsic-magnification' === failure ? 600 : viewBoxWidth;
        const height = 'intrinsic-magnification' === failure ? 134 : 268;
        return { bottom: top + height, height, left, right: left + width, top, width };
      }
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () =>
        'intrinsic-magnification' === failure
          ? { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }
          : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    });
    const rasterize = vi.fn(async () => ({
      file: new File(['gantt'], 'gantt.png', { type: 'image/png' }),
      height: 268,
      pixelCount: viewBoxWidth * 268,
      width: viewBoxWidth
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'gantt.png',
      url: 'https://example.test/gantt.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) {
          return 'wide-root-pseudo' === failure && element === root
            ? declaration({ content: '"paint"', display: 'block' })
            : declaration({});
        }
        if (element.classList.contains('gantt-inner-clip')) {
          return declaration({
            overflow: 'boundary-y-clip' === failure ? 'visible' : 'hidden',
            'overflow-x': 'boundary-y-clip' === failure ? 'auto' : 'hidden',
            'overflow-y': 'boundary-y-clip' === failure ? 'hidden' : 'auto',
            transform: 'none'
          });
        }
        if (element.classList.contains('gantt-ancestor') || ('ARTICLE' === element.tagName && element !== root)) {
          return declaration({
            overflow: 'clip' === failure ? 'hidden' : 'visible',
            transform: 'transform' === failure ? 'translateX(10px)' : 'none'
          });
        }
        if (element === root) {
          const longhandRadius =
            'wide-root-radius-longhand' === failure
              ? '1px 150px'
              : 'wide-root-radius-longhand-slash' === failure
                ? '1px / 1px'
                : '';
          return declaration({
            'border-bottom-style': ['wide-root-border-style', 'wide-root-border-width'].includes(failure)
              ? 'wide-root-border-style' === failure
                ? 'dashed'
                : 'solid'
              : 'none',
            'border-bottom-width': 'wide-root-border-width' === failure ? '1em' : '0px',
            'border-left-style': ['wide-root-border-style', 'wide-root-border-width'].includes(failure)
              ? 'wide-root-border-style' === failure
                ? 'dashed'
                : 'solid'
              : 'none',
            'border-left-width': 'wide-root-border-width' === failure ? '1em' : '0px',
            'border-right-style': ['wide-root-border-style', 'wide-root-border-width'].includes(failure)
              ? 'wide-root-border-style' === failure
                ? 'dashed'
                : 'solid'
              : 'none',
            'border-right-width': 'wide-root-border-width' === failure ? '1em' : '0px',
            'border-top-style': ['wide-root-border-style', 'wide-root-border-width'].includes(failure)
              ? 'wide-root-border-style' === failure
                ? 'dashed'
                : 'solid'
              : 'none',
            'border-top-width': 'wide-root-border-width' === failure ? '1em' : '0px',
            background: 'wide-root-gradient' === failure ? 'linear-gradient(red, blue)' : '',
            'background-image': 'wide-root-gradient' === failure ? 'linear-gradient(red, blue)' : 'none',
            'box-shadow': 'wide-root-shadow' === failure ? '0 0 2px black' : 'none',
            'border-radius':
              'wide-root-radius-unit' === failure
                ? '12%'
                : 'wide-root-radius-overlap' === failure
                  ? '1000px / 100px'
                  : longhandRadius || '0px',
            'border-top-left-radius': longhandRadius,
            'border-top-right-radius': longhandRadius,
            'border-bottom-right-radius': longhandRadius,
            'border-bottom-left-radius': longhandRadius,
            'clip-path': 'wide-root-clip' === failure ? 'inset(0 1px)' : 'none',
            direction: 'rtl-misaligned' === failure ? 'rtl' : 'ltr',
            filter: 'wide-root-filter' === failure ? 'blur(2px)' : 'none',
            height: 'auto',
            mask: 'wide-root-mask' === failure ? 'url(#mask)' : 'none',
            'max-height': 'none',
            overflow: 'clip' === failure ? 'hidden' : 'auto',
            'overflow-x': 'clip' === failure ? 'hidden' : 'auto',
            'overflow-y': 'auto',
            'padding-bottom': '0px',
            'padding-left': 'percentage-padding' === failure ? '10%' : '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            position: 'root-position' === failure ? 'relative' : 'static',
            top: 'root-inset' === failure ? '1px' : 'auto',
            transform: 'transform' === failure ? 'translateX(10px)' : 'none'
          });
        }
        if (element === svg) {
          return declaration({
            'border-bottom-style': 'none',
            'border-bottom-width': '0px',
            'border-left-style': 'none',
            'border-left-width': '0px',
            'border-right-style': 'none',
            'border-right-width': '0px',
            'border-top-style': 'none',
            'border-top-width': '0px',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            position: 'svg-position' === failure ? 'relative' : 'static',
            top: 'svg-inset' === failure ? '1px' : 'auto',
            transform: 'svg-transform' === failure ? 'translateX(-200px)' : 'none'
          });
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    document.body.append(preview);
    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        code,
        sideEffects: 'none',
        status: 'failed'
      });
      expect(rasterize).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    } finally {
      preview.remove();
    }
  });

  it.each([
    ['CTM 1', { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, '', '', '0 0 200 100', 1],
    ['upscale', { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }, '', '', '0 0 200 100', 1],
    ['low-resolution noise', { a: 0.999, b: 0, c: 0, d: 0.999, e: 0, f: 0 }, '', '', '0 0 200 100', 1],
    ['non-uniform CTM', { a: 0.5, b: 0, c: 0, d: 0.75, e: 0, f: 0 }, '', '', '0 0 200 100', 1],
    ['external transform', { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }, 'transform:scale(.5)', '', '0 0 200 100', 1],
    ['clipped source', { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }, '', 'hidden', '0 0 200 100', 1],
    ['fixed-height source', { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }, 'height:100px', '', '0 0 200 100', 1],
    ['invalid viewBox', { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }, '', '', 'invalid', 1],
    ['valid downscale', { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }, '', '', '0 0 200 100', 2]
  ])(
    'derives Mermaid layout magnification only for %s',
    async (_label, matrix, rootStyle, computedOverflow, viewBox, expectedMagnification) => {
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob>) {}
      }
      const preview = readyPreview();
      preview.innerHTML = `<div class="easymde-mermaid" style="${rootStyle}"><svg viewBox="${viewBox}"><rect width="200" height="100"></rect></svg></div>`;
      const root = preview.querySelector('.easymde-mermaid');
      const svg = preview.querySelector('svg');
      if (!root || !svg) throw new Error('Mermaid source missing');
      if (computedOverflow) {
        root.setAttribute('style', [rootStyle, `overflow:${computedOverflow}`].filter(Boolean).join(';'));
      }
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 50, width: 100 })
      });
      Object.defineProperty(svg, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 50, width: 100 })
      });
      Object.defineProperty(svg, 'getScreenCTM', { configurable: true, value: () => matrix });
      let observedMagnification: number | undefined;
      const rasterize = vi.fn(async ({ layoutMagnification: value }: { layoutMagnification?: number }) => {
        observedMagnification = value;
        return {
          file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
          height: 100,
          pixelCount: 10_000,
          width: 200
        };
      });
      const upload = vi.fn(async () => ({
        alt: '',
        status: 'uploaded' as const,
        title: 'mermaid.png',
        url: 'https://example.test/mermaid.png'
      }));
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return declaration({});
          if (element === root && computedOverflow) {
            return declaration({ overflow: computedOverflow });
          }
          return computedStyle(element);
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: vi.fn(async () => undefined)
      });

      document.body.append(preview);
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(observedMagnification).toBe(expectedMagnification);
      preview.remove();
    }
  );

  it.each([
    ['Gantt viewport quantization', [255, 56.9453125], [255, 56.9453125], '0 0 1200 268', '', 0, 1200 / 255],
    ['Sequence viewport quantization', [255, 137.6875], [255, 137.6875], '-50 -10 850 459', '', 0, 850 / 255],
    ['wrapper padding', [275, 76.9453125], [255, 56.9453125], '0 0 1200 268', '', 10, 1200 / 255],
    ['non-full-width SVG', [255, 56.9453125], [204, 45.546875], '0 0 1200 268', '', 0, 1],
    ['SVG border', [255, 56.9453125], [255, 56.9453125], '0 0 1200 268', '', 0, 1, 1],
    ['preserveAspectRatio none', [255, 56.9453125], [255, 56.9453125], '0 0 1200 268', 'none', 0, 1],
    ['preserveAspectRatio slice', [255, 56.9453125], [255, 56.9453125], '0 0 1200 268', 'xMidYMid slice', 0, 1],
    ['authored aspect mismatch', [255, 60], [255, 60], '0 0 1200 268', '', 0, 1]
  ])(
    'uses the SVG viewport ratio only for %s',
    async (_label, [rootWidth, rootHeight], [
      svgWidth,
      svgHeight
    ], viewBox, preserveAspectRatio, rootPadding, expectedMagnification, svgBorder = 0) => {
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob>) {}
      }
      const preview = readyPreview();
      preview.innerHTML = `<div class="easymde-mermaid"><svg viewBox="${viewBox}"><rect width="1200" height="268"></rect></svg></div>`;
      const root = preview.querySelector('.easymde-mermaid');
      const svg = preview.querySelector('svg');
      if (!root || !svg) throw new Error('Mermaid source missing');
      if (preserveAspectRatio) svg.setAttribute('preserveAspectRatio', preserveAspectRatio);
      setMermaidComputedStyleMap(root);
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: rootHeight, width: rootWidth })
      });
      Object.defineProperty(svg, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: svgHeight, width: svgWidth })
      });
      Object.defineProperty(svg, 'getScreenCTM', {
        configurable: true,
        value: () => ({ a: 0.2, b: 0, c: 0, d: 0.2, e: 0, f: 0 })
      });
      let observedMagnification: number | undefined;
      const rasterize = vi.fn(async ({ layoutMagnification }: { layoutMagnification?: number }) => {
        observedMagnification = layoutMagnification;
        return {
          file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
          height: 268,
          pixelCount: 321_600,
          width: 1200
        };
      });
      const upload = vi.fn(async () => ({
        alt: '',
        status: 'uploaded' as const,
        title: 'mermaid.png',
        url: 'https://example.test/mermaid.png'
      }));
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return declaration({});
          if (element === root) {
            return declaration({
              'border-bottom-style': 'none',
              'border-bottom-width': '0px',
              'border-left-style': 'none',
              'border-left-width': '0px',
              'border-right-style': 'none',
              'border-right-width': '0px',
              'border-top-style': 'none',
              'border-top-width': '0px',
              display: 'block',
              height: 'auto',
              'max-height': 'none',
              overflow: 'auto',
              'overflow-x': 'auto',
              'overflow-y': 'auto',
              'padding-bottom': `${rootPadding}px`,
              'padding-left': `${rootPadding}px`,
              'padding-right': `${rootPadding}px`,
              'padding-top': `${rootPadding}px`
            });
          }
          if (element === svg) {
            return declaration({
              'border-bottom-style': svgBorder ? 'solid' : 'none',
              'border-bottom-width': `${svgBorder}px`,
              'border-left-style': svgBorder ? 'solid' : 'none',
              'border-left-width': `${svgBorder}px`,
              'border-right-style': svgBorder ? 'solid' : 'none',
              'border-right-width': `${svgBorder}px`,
              'border-top-style': svgBorder ? 'solid' : 'none',
              'border-top-width': `${svgBorder}px`,
              'padding-bottom': '0px',
              'padding-left': '0px',
              'padding-right': '0px',
              'padding-top': '0px',
              transform: 'none'
            });
          }
          return computedStyle(element);
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: vi.fn(async () => undefined)
      });

      document.body.append(preview);
      try {
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        expect(observedMagnification).toBeCloseTo(expectedMagnification, 10);
      } finally {
        preview.remove();
      }
    }
  );

  it('derives Mermaid magnification for a connected horizontal autoheight owner', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid" style="overflow-x:scroll;overflow-y:visible;height:auto"><svg viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid source missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
    });
    let observedMagnification: number | undefined;
    const rasterize = vi.fn(async ({ layoutMagnification: value }: { layoutMagnification?: number }) => {
      observedMagnification = value;
      return {
        file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
        height: 100,
        pixelCount: 20_000,
        width: 200
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'mermaid.png',
      url: 'https://example.test/mermaid.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root) {
          return declaration({
            height: 'auto',
            overflow: 'auto',
            'overflow-x': 'scroll',
            'overflow-y': 'auto',
            width: '100px'
          });
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    document.body.append(preview);
    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(observedMagnification).toBe(2);
    } finally {
      preview.remove();
    }
  });

  it('derives Mermaid magnification for a stylesheet-owned autoheight owner', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid source missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
    });
    let observedMagnification: number | undefined;
    const rasterize = vi.fn(async ({ layoutMagnification: value }: { layoutMagnification?: number }) => {
      observedMagnification = value;
      return {
        file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
        height: 100,
        pixelCount: 20_000,
        width: 200
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'mermaid.png',
      url: 'https://example.test/mermaid.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root) {
          return declaration({
            height: 'auto',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            width: '100px'
          });
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    document.body.append(preview);
    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(observedMagnification).toBe(2);
    } finally {
      preview.remove();
    }
  });

  it.each([
    ['stylesheet fixed height', 'height:120px', { height: '120px' }],
    ['stylesheet fixed max-height', 'max-height:80px', { 'max-height': '80px' }],
    ['stylesheet fixed block-size', 'block-size:120px', { 'block-size': '120px' }],
    ['stylesheet fixed min-height', 'min-height:1px', { 'min-height': '1px' }],
    ['stylesheet fixed min-block-size', 'min-block-size:1px', { 'min-block-size': '1px' }],
    ['stylesheet fixed max-block-size', 'max-block-size:80px', { 'max-block-size': '80px' }],
    ['inline fixed height', '', { height: '120px' }, 'height:120px'],
    ['inline fixed max-height', '', { 'max-height': '80px' }, 'max-height:80px'],
    ['inline fixed block-size', '', { 'block-size': '120px' }, 'block-size:120px'],
    ['inline fixed min-height', '', { 'min-height': '1px' }, 'min-height:1px'],
    ['inline fixed min-block-size', '', { 'min-block-size': '1px' }, 'min-block-size:1px'],
    ['inline fixed max-block-size', '', { 'max-block-size': '80px' }, 'max-block-size:80px']
  ])(
    'does not derive Mermaid magnification for %s',
    async (_label, declarationText, typedOverride, inlineStyle = '') => {
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob>) {}
      }
      const stylesheet = document.createElement('style');
      stylesheet.textContent = `.easymde-mermaid { ${declarationText}; }`;
      document.head.append(stylesheet);
      const preview = readyPreview();
      preview.innerHTML =
        '<div class="easymde-mermaid"><svg viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg></div>';
      const root = preview.querySelector('.easymde-mermaid');
      const svg = preview.querySelector('svg');
      if (!root || !svg) throw new Error('Mermaid source missing');
      if (inlineStyle) root.setAttribute('style', inlineStyle);
      setMermaidComputedStyleMap(root, typedOverride);
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 50, width: 100 })
      });
      Object.defineProperty(svg, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 50, width: 100 })
      });
      Object.defineProperty(svg, 'getScreenCTM', {
        configurable: true,
        value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
      });
      let observedMagnification: number | undefined;
      const rasterize = vi.fn(async ({ layoutMagnification: value }: { layoutMagnification?: number }) => {
        observedMagnification = value;
        return {
          file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
          height: 100,
          pixelCount: 20_000,
          width: 200
        };
      });
      const upload = vi.fn(async () => ({
        alt: '',
        status: 'uploaded' as const,
        title: 'mermaid.png',
        url: 'https://example.test/mermaid.png'
      }));
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return declaration({});
          if (element === root) {
            return declaration({
              height: 'auto',
              'max-height': 'none',
              overflow: 'auto',
              'overflow-x': 'auto',
              'overflow-y': 'auto',
              width: '100px'
            });
          }
          return computedStyle(element);
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: vi.fn(async () => undefined)
      });

      document.body.append(preview);
      try {
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        expect(observedMagnification).toBe(1);
      } finally {
        preview.remove();
        stylesheet.remove();
      }
    }
  );

  it.each([
    ['computedStyleMap unavailable', 'missing'],
    ['computedStyleMap unknown value', 'unknown'],
    ['computedStyleMap throws', 'throws'],
    ['percentage height', 'percentage'],
    ['calc height', 'calc'],
    ['active animation', 'animation']
  ])('fails closed for Mermaid dimension proof %s', async (_label, mode) => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid source missing');
    if ('missing' === mode) {
      Object.defineProperty(root, 'computedStyleMap', { configurable: true, value: undefined });
    } else if ('unknown' === mode) {
      Object.defineProperty(root, 'computedStyleMap', {
        configurable: true,
        value: () => ({ get: () => ({ value: 120 }) })
      });
    } else if ('throws' === mode) {
      Object.defineProperty(root, 'computedStyleMap', {
        configurable: true,
        value: () => {
          throw new Error('computed-style-map-failed');
        }
      });
    } else if ('percentage' === mode) {
      setMermaidComputedStyleMap(root, { height: '100%' });
    } else if ('calc' === mode) {
      setMermaidComputedStyleMap(root, { height: 'calc(100% - 1px)' });
    } else {
      Object.defineProperty(document, 'getAnimations', {
        configurable: true,
        value: () => [{ effect: { target: root } }]
      });
    }
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
    });
    let observedMagnification: number | undefined;
    const rasterize = vi.fn(async ({ layoutMagnification: value }: { layoutMagnification?: number }) => {
      observedMagnification = value;
      return {
        file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
        height: 100,
        pixelCount: 20_000,
        width: 200
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'mermaid.png',
      url: 'https://example.test/mermaid.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root) {
          return declaration({
            height: 'auto',
            'max-height': 'none',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            width: '100px'
          });
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    document.body.append(preview);
    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(observedMagnification).toBe(1);
    } finally {
      preview.remove();
    }
  });

  it('does not derive Mermaid magnification from a disconnected source', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid source missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
    });
    let observedMagnification: number | undefined;
    const rasterize = vi.fn(async ({ layoutMagnification: value }: { layoutMagnification?: number }) => {
      observedMagnification = value;
      return {
        file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
        height: 100,
        pixelCount: 20_000,
        width: 200
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'mermaid.png',
      url: 'https://example.test/mermaid.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(observedMagnification).toBe(1);
  });

  it('aborts PNG conversion when the browser rejects Clipboard write mid-rasterization', async () => {
    let rejectWrite: ((error: Error) => void) | undefined;
    let rasterizationAborted = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          const abort = (): void => {
            rasterizationAborted = true;
            reject(new Error('rasterization-aborted'));
          };
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        })
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-math.png',
      url: 'https://example.test/hidden-math.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectWrite = reject;
          })
      )
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    rejectWrite?.(new Error('NotAllowedError'));

    await expect(copy).resolves.toEqual({ code: 'wechat-png-clipboard-failed', sideEffects: 'none', status: 'failed' });
    expect(rasterizationAborted).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it('starts modern Clipboard write before resolving a complete windowed Preview', async () => {
    const writes: unknown[] = [];
    const ready = deferred<HTMLElement | null>();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = ['<p>Visible window</p>', '<div data-easymde-preview-window-spacer="1"></div>'].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Visible window' });
    const write = vi.fn((items: unknown[]) => {
      writes.push(items);
      return Promise.resolve();
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    const operation = clipboard.copy(preview, { resolvePreview: () => ready.promise });
    expect(write).toHaveBeenCalledOnce();

    preview.innerHTML = '<p>Complete Preview</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Complete Preview' });
    ready.resolve(preview);

    await expect(operation).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = await item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    expect(await blobText(htmlBlob)).toContain('Complete Preview');
    expect(await blobText(htmlBlob)).not.toContain('data-easymde-preview-window-spacer');
  });

  it('does not create a late freshness observer after windowed copy aborts before materialization', async () => {
    const resolvedPreview = deferred<HTMLElement | null>();
    const controller = new AbortController();
    const observe = vi.spyOn(window.MutationObserver.prototype, 'observe');
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    const spacer = document.createElement('div');
    spacer.setAttribute('data-easymde-preview-window-spacer', '1');
    preview.append(spacer);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub;
        const html = item.payload['text/html'];
        if (!html) throw new Error('clipboard html missing');
        await blobText(html);
        committed = true;
      }
    });

    try {
      const copy = clipboard.copy(preview, {
        resolvePreview: () => resolvedPreview.promise,
        signal: controller.signal
      });
      expect(observe).not.toHaveBeenCalled();
      controller.abort();
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      resolvedPreview.resolve(preview);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      expect(observe).not.toHaveBeenCalled();
      expect(committed).toBe(false);
    } finally {
      observe.mockRestore();
    }
  });

  it('invokes modern write before freshness style and geometry reads', async () => {
    const events: string[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    const getComputedStyle = vi.fn((element: Element, pseudoElement?: string) => {
      events.push(pseudoElement ? `pseudo:${pseudoElement}` : `style:${element.tagName}`);
      return computedStyle(element, pseudoElement);
    });
    const write = vi.fn(() => {
      events.push('write');
      return Promise.resolve();
    });
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        events.push('geometry');
        return { height: 240, width: 640 };
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    const operation = clipboard.copy(preview);
    expect(write).toHaveBeenCalledOnce();
    expect(getComputedStyle).not.toHaveBeenCalled();
    expect(events[0]).toBe('write');

    await expect(operation).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(getComputedStyle).toHaveBeenCalled();
    expect(events).toContain('geometry');
    expect(events.some((event) => event.startsWith('pseudo:'))).toBe(true);
  });

  it('disconnects portable source freshness observation after modern copy settles', async () => {
    const disconnect = vi.spyOn(window.MutationObserver.prototype, 'disconnect');
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub | undefined;
        const html = item?.payload['text/html'];
        if (!html) throw new Error('clipboard html missing');
        await blobText(html);
      }
    });

    try {
      await expect(clipboard.copy(readyPreview())).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      disconnect.mockRestore();
    }
  });

  it('fails after portable freshness setup breaks without legacy fallback', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    const observe = vi.spyOn(window.MutationObserver.prototype, 'observe').mockImplementation(() => {
      throw new Error('freshness-observer-setup-failed');
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const write = vi.fn(async (items: unknown[]) => {
      const item = items[0] as { payload?: Record<string, Blob> } | undefined;
      const html = item?.payload?.['text/html'];
      if (!html) throw new Error('clipboard html missing');
      await blobText(html);
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    try {
      await expect(clipboard.copy(readyPreview())).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(write).toHaveBeenCalledOnce();
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      observe.mockRestore();
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('fails explicitly without modern Clipboard support and never enters legacy copy', async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const rasterize = vi.fn();
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-math.png',
      url: 'https://example.test/hidden-math.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    await expect(
      clipboard.copy(readyPreview(), pngOptions({ rasterize } as never, { upload } as never))
    ).resolves.toEqual({ code: 'wechat-png-clipboard-failed', sideEffects: 'none', status: 'failed' });
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('fails synchronously when ClipboardItem construction throws without legacy fallback', async () => {
    class ThrowingClipboardItem {
      constructor() {
        throw new Error('clipboard-item-constructor-failed');
      }
    }
    const write = vi.fn();
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const rasterize = vi.fn();
    const upload = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ThrowingClipboardItem,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    await expect(
      clipboard.copy(readyPreview(), pngOptions({ rasterize } as never, { upload } as never))
    ).resolves.toEqual({ code: 'wechat-png-clipboard-failed', sideEffects: 'none', status: 'failed' });
    expect(write).not.toHaveBeenCalled();
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('reports conversion failure without publishing a partial Clipboard payload', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const rasterize = vi.fn(async () => {
      throw new Error('native-rasterizer-failed');
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-math.png',
      url: 'https://example.test/hidden-math.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn((items) => {
        writes.push(items);
        return Promise.resolve();
      })
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(writes).toHaveLength(1);
    expect(upload).not.toHaveBeenCalled();
  });

  it('rasterizes only outermost visual roots in DOM order and preserves tables', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const rasterize = vi.fn(async ({ kind }: { kind: string }) => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20,
      kind
    }));
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn((items) => {
        writes.push(items);
        return Promise.resolve();
      })
    });
    const preview = readyPreview();
    preview.innerHTML = [
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg>',
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div></div>',
      '<div class="easymde-math"><span class="katex"><span>x</span></span></div>',
      '<table><tbody><tr><td>Keep HTML</td></tr></tbody></table>'
    ].join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(rasterize).toHaveBeenCalledTimes(2);
    expect(rasterize.mock.calls.map(([value]) => value.kind)).toEqual(['mermaid', 'math']);
    expect(upload).toHaveBeenCalledTimes(2);
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('img[src^="https://example.test/"]')).toHaveLength(2);
    expect(holder.querySelector('table')).not.toBeNull();
    expect(holder.querySelectorAll('svg')).toHaveLength(0);
    expect(holder.querySelectorAll('section[data-ignore-width]')).toHaveLength(1);
    expect(holder.querySelector('section[data-ignore-width] table')).not.toBeNull();
    expect(holder.querySelectorAll('section[data-ignore-width] code')).toHaveLength(0);
  });

  it('does not style discarded PNG descendants twice before native capture', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">x</span></span></span></div>';
    const descendant = preview.querySelector('.mord');
    if (!descendant) throw new Error('math descendant missing');
    let descendantStyleReads = 0;
    const rasterize = vi.fn(async ({ source }: { source: Element }) => {
      expect(source.querySelector('.mord')).not.toBeNull();
      return { file: new File(['png'], 'math.png', { type: 'image/png' }), height: 24, pixelCount: 576, width: 24 };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'math.png',
      url: 'https://example.test/math.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && element === descendant) descendantStyleReads += 1;
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(descendantStyleReads).toBe(1);
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
  });

  it('accepts expanded math output while retaining visual-root flow semantics on generated PNGs', async () => {
    const writes: unknown[] = [];
    const requests: Array<Readonly<{ height: number; inline: boolean; kind: string; width: number }>> = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const rasterize = vi.fn(
      async ({ height, kind, source, width }: { height: number; kind: string; source: Element; width: number }) => {
        const inline = source.classList.contains('easymde-math-inline');
        requests.push({ height, inline, kind, width });
        const outputWidth = inline ? 40 : 'math' === kind ? 547 : width;
        if ('math' === kind) {
          expect(source.querySelector('.katex-mathml')).toBeNull();
        }
        return {
          file: new File([`${kind}-${outputWidth}`], `${kind}-${outputWidth}.png`, { type: 'image/png' }),
          height: height || 1,
          ...(inline ? { inlineLayout: { baseline: 5, height: 20, paintOffsetX: 0, paintOffsetY: 0, width: 40 } } : {}),
          pixelCount: 200,
          width: outputWidth || 1
        };
      }
    );
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const preview = readyPreview();
    preview.setAttribute('data-ignore-width', 'untrusted-root');
    preview.innerHTML = [
      '<div class="easymde-math-block"><span class="katex"><span class="katex-mathml"><math><annotation>wide formula</annotation></math></span><span class="katex-html">wide formula</span></span></div>',
      '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>',
      '<span class="easymde-math-inline" data-ignore-width="untrusted-inline"><span class="katex"><span class="katex-html">inline formula</span></span></span>',
      '<section data-ignore-width="untrusted-overflow" style="overflow:auto">Unowned overflow</section>'
    ].join('');
    const math = preview.querySelector('.easymde-math-block');
    const mermaid = preview.querySelector('.easymde-mermaid');
    const inlineMath = preview.querySelector('.easymde-math-inline');
    if (!math || !mermaid || !inlineMath) throw new Error('visual roots missing');
    Object.defineProperties(math, {
      getBoundingClientRect: { configurable: true, value: () => ({ height: 30, width: 180 }) },
      scrollHeight: { configurable: true, value: 30 },
      scrollWidth: { configurable: true, value: 547 }
    });
    Object.defineProperty(mermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 40, width: 80 })
    });
    Object.defineProperty(inlineMath, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 20, width: 40 })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            height: '30px',
            'margin-left': '12px',
            'margin-right': '14px',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'padding-top': '8px',
            'padding-right': '8px',
            'padding-bottom': '8px',
            'padding-left': '8px',
            'border-top-width': '2px',
            'border-right-width': '2px',
            'border-bottom-width': '2px',
            'border-left-width': '2px',
            background: 'blue',
            'vertical-align': 'middle',
            width: '180px'
          });
        }
        if ('DIV' === element.tagName && element.classList.contains('easymde-mermaid')) {
          return declaration({
            display: 'inline-block',
            height: '40px',
            'margin-left': '7px',
            'margin-right': '9px',
            overflow: 'visible',
            'vertical-align': 'middle',
            width: '80px'
          });
        }
        if (element.classList.contains('easymde-math-inline')) {
          return declaration({
            display: 'inline',
            'overflow-x': 'visible',
            'overflow-y': 'visible',
            'vertical-align': 'baseline'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(requests).toEqual([
      { height: 30, inline: false, kind: 'math', width: 180 },
      { height: 40, inline: false, kind: 'mermaid', width: 80 },
      { height: 20, inline: true, kind: 'math', width: 40 }
    ]);
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/"]')];
    expect(images).toHaveLength(3);
    expect(images[0]?.getAttribute('style')).toContain('width:547px!important');
    expect(images[0]?.getAttribute('style')).toContain('max-width:none!important');
    expect(images[0]?.getAttribute('style')).toContain('display:block');
    expect(images[0]?.getAttribute('style')).toContain('margin-left:auto!important');
    expect(images[0]?.getAttribute('style')).toContain('margin-right:auto!important');
    expect(images[0]?.getAttribute('style')).not.toContain('width:auto!important');
    expect(images[0]?.getAttribute('style')).not.toContain('inline-size:100%!important');
    expect(images[0]?.getAttribute('style')).not.toMatch(/(?:^|;)padding-/);
    expect(images[0]?.getAttribute('style')).not.toMatch(/(?:^|;)border-/);
    expect(images[0]?.getAttribute('style')).not.toMatch(/(?:^|;)background/);
    const mathWrapperStyle = images[0]?.parentElement?.getAttribute('style') ?? '';
    expect(mathWrapperStyle).toContain('display:block');
    expect(mathWrapperStyle).toContain('overflow-x:auto');
    expect(mathWrapperStyle).toContain('overflow-y:hidden');
    expect(mathWrapperStyle).toContain('height:auto');
    expect(mathWrapperStyle).toContain('margin-left:12px');
    expect(mathWrapperStyle).toContain('margin-right:14px');
    expect(mathWrapperStyle).toContain('vertical-align:middle');
    expect(mathWrapperStyle.match(/margin-left:12px/g)).toHaveLength(1);
    expect(mathWrapperStyle.match(/margin-right:14px/g)).toHaveLength(1);
    expect(mathWrapperStyle).not.toMatch(/(?:^|;)padding-/);
    expect(mathWrapperStyle).not.toMatch(/(?:^|;)border-/);
    expect(mathWrapperStyle).not.toMatch(/(?:^|;)background/);
    expect(images[1]?.getAttribute('style')).toContain('width:80px!important');
    expect(images[1]?.getAttribute('style')).toContain('display:inline-block');
    expect(images[1]?.getAttribute('style')).toContain('margin-left:7px');
    expect(images[1]?.getAttribute('style')).toContain('margin-right:9px');
    expect(images[1]?.getAttribute('style')).toContain('vertical-align:middle');
    expect(images[2]?.getAttribute('style')).toContain('width:40px!important');
    expect(images[0]?.parentElement?.getAttribute('data-ignore-width')).toBe('');
    expect(images[1]?.parentElement?.hasAttribute('data-ignore-width')).toBe(false);
    expect(images[2]?.parentElement?.hasAttribute('data-ignore-width')).toBe(false);
    expect(holder.querySelectorAll('section[data-ignore-width]')).toHaveLength(1);
    expect(holder.querySelector('section[data-ignore-width] > img[src^="https://example.test/"]')).not.toBeNull();
    expect(holder.firstElementChild?.hasAttribute('data-ignore-width')).toBe(false);
    expect(holder.querySelector('[data-ignore-width="untrusted-root"]')).toBeNull();
    expect(holder.querySelector('[data-ignore-width="untrusted-inline"]')).toBeNull();
    expect(holder.querySelector('[data-ignore-width="untrusted-overflow"]')).toBeNull();
  });

  it.each(['fixed', 'relative'] as const)(
    'keeps magnified Mermaid PNGs in an autoheight local scroll owner inside a %s UI shell',
    async (shellPosition) => {
      const writes: unknown[] = [];
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob>) {}
      }
      const preview = readyPreview();
      const shell = document.createElement('div');
      shell.style.position = shellPosition;
      shell.append(preview);
      preview.innerHTML =
        '<div class="easymde-mermaid" style="display:block;width:63px;height:auto;overflow-x:scroll;overflow-y:visible"><svg viewBox="0 0 100 50"><rect width="100" height="50"></rect></svg></div>';
      const mermaid = preview.querySelector('.easymde-mermaid');
      const svg = preview.querySelector('svg');
      if (!mermaid || !svg) throw new Error('Mermaid root missing');
      Object.defineProperty(mermaid, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 31.5, width: 63 })
      });
      Object.defineProperty(svg, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 31.5, width: 63 })
      });
      Object.defineProperty(svg, 'getScreenCTM', {
        configurable: true,
        value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
      });
      const rasterize = vi.fn(
        async ({
          height,
          layoutMagnification = 1,
          width
        }: {
          height: number;
          layoutMagnification?: number;
          width: number;
        }) => ({
          file: new File(['magnified'], 'magnified.png', { type: 'image/png' }),
          height: height * layoutMagnification,
          pixelCount: width * height * layoutMagnification * layoutMagnification,
          width: width * layoutMagnification
        })
      );
      const upload = vi.fn(async ({ file }: { file: File }) => ({
        alt: '',
        status: 'uploaded' as const,
        title: file.name,
        url: 'https://example.test/magnified.png'
      }));
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return declaration({});
          if (element === mermaid) {
            return declaration({
              'box-sizing': 'content-box',
              display: 'block',
              height: 'auto',
              'max-width': '63px',
              overflow: 'auto',
              'overflow-x': 'scroll',
              'overflow-y': 'auto',
              width: '63px'
            });
          }
          return computedStyle(element);
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      document.body.append(shell);
      try {
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        const item = (writes[0] as ClipboardItemStub[])[0];
        const htmlBlob = item?.payload['text/html'];
        if (!htmlBlob) throw new Error('clipboard html missing');
        const holder = document.createElement('div');
        holder.innerHTML = await blobText(htmlBlob);
        const image = holder.querySelector('img[src="https://example.test/magnified.png"]');
        const owner = image?.parentElement;
        if (!image || !owner) throw new Error('magnified Mermaid output missing');
        const ownerStyle = owner.getAttribute('style') ?? '';
        const imageStyle = image.getAttribute('style') ?? '';
        expect(owner.getAttribute('data-ignore-width')).toBe('');
        expect(ownerStyle).toContain('width:100%!important');
        expect(ownerStyle).toContain('min-width:0!important');
        expect(ownerStyle).toContain('max-width:100%!important');
        expect(ownerStyle).toContain('overflow-x:auto!important');
        expect(ownerStyle).toContain('overflow-y:visible!important');
        expect(ownerStyle).toContain('height:auto!important');
        expect(ownerStyle).toContain('max-height:none!important');
        expect(ownerStyle).toContain('box-sizing:border-box!important');
        expect(ownerStyle).not.toContain('63px');
        expect(image.getAttribute('width')).toBe('100');
        expect(image.getAttribute('height')).toBe('50');
        expect(imageStyle).toContain('width:100px!important');
        expect(imageStyle).toContain('height:50px!important');
        expect(imageStyle).toContain('max-width:none!important');
        expect(imageStyle).toContain('display:block!important');
      } finally {
        shell.remove();
      }
    }
  );

  it('captures hidden-source PNG visuals with their native candidate geometry', async () => {
    const writes: unknown[] = [];
    const requests: Array<Readonly<{ height: number; kind: string; source: Element; width: number }>> = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html">Hidden math</span></span></div>';
    const math = preview.querySelector('.easymde-math-block');
    if (!math) throw new Error('math root missing');
    Object.defineProperty(math, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 0, width: 0 })
    });
    const sourceMarkup = preview.innerHTML;
    let measurementWidth = '';
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 300, height: 300, left: 0, right: 500, top: 0, width: 500, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-math-block') && this.closest('.easymde-wechat-preview-measurement')) {
          return { bottom: 24, height: 24, left: 0, right: 180, top: 0, width: 180, x: 0, y: 0 };
        }
        return originalRect?.value?.call(this);
      }
    });
    const rasterize = vi.fn(
      async ({ height, kind, source, width }: { height: number; kind: string; source: Element; width: number }) => {
        measurementWidth =
          document.querySelector<HTMLElement>('.easymde-wechat-preview-measurement')?.style.width ?? '';
        requests.push({ height, kind, source, width });
        if (width <= 0 || height <= 0) throw new Error('wechat-png-size-invalid');
        return {
          file: new File(['unexpected'], 'unexpected.png', { type: 'image/png' }),
          height,
          pixelCount: width * height,
          width
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-math.png',
      url: 'https://example.test/hidden-math.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) {
          return declaration({
            display: 'block',
            'border-left-width': '5px',
            'border-right-width': '5px',
            'padding-left': '20px',
            'padding-right': '20px',
            width: '500px'
          });
        }
        if (element === preview) return declaration({ display: 'none', 'max-width': '760px' });
        if (element === math) {
          return declaration({ display: 'block', height: '24px', width: '180px' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    let result: Awaited<ReturnType<typeof clipboard.copy>>;
    try {
      result = await clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ height: 24, kind: 'math', width: 180 });
    expect(requests[0]?.source).not.toBe(math);
    expect(measurementWidth).toBe('450px');
    expect(result).toEqual({ method: 'clipboard', status: 'copied' });
    expect(upload).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('cleans the hidden measurement tree when modern PNG write rejects immediately', async () => {
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html">Held math</span></span></div>';
    const sourceMarkup = preview.innerHTML;
    const rasterize = vi.fn(async () => ({
      file: new File(['late'], 'late.png', { type: 'image/png' }),
      height: 24,
      pixelCount: 4320,
      width: 180
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'late.png',
      url: 'https://example.test/late.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === preview) return declaration({ display: 'none' });
        if (element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '24px', width: '180px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.reject(new Error('NotAllowedError')))
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-clipboard-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('waits for fonts on the attached hidden clone before cold PNG layout', async () => {
    const writes: unknown[] = [];
    const fontsReady = deferred<unknown>();
    let cloneLayoutStarted = false;
    let fontSettled = false;
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      get: () => ({
        get status(): 'loaded' | 'loading' {
          return cloneLayoutStarted && !fontSettled ? 'loading' : 'loaded';
        },
        get ready(): Promise<unknown> {
          return cloneLayoutStarted ? fontsReady.promise : Promise.resolve();
        }
      })
    });
    const preview = readyPreview();
    preview.className = 'easymde-preview';
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Cold diagram' });
    const sourceMarkup = preview.innerHTML;
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 300, height: 300, left: 0, right: 500, top: 0, width: 500, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-preview') && this.closest('.easymde-wechat-preview-measurement')) {
          expect(this.isConnected).toBe(true);
          cloneLayoutStarted = true;
          const height = fontSettled ? 40.375 : 40;
          return { bottom: height, height, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-mermaid') && this.closest('.easymde-wechat-preview-measurement')) {
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['cold-font'], 'cold-font.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'cold-font.png',
      url: 'https://example.test/cold-font.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '500px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          if (element.classList.contains('easymde-mermaid')) {
            return declaration({ display: 'block', height: '40px', width: '80px' });
          }
          return declaration({ display: 'block' });
        }
        if (element === preview) return declaration({ display: 'none' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    try {
      const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      await vi.waitFor(() => expect(cloneLayoutStarted).toBe(true));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      expect(rasterize).not.toHaveBeenCalled();
      expect(writes).toHaveLength(1);
      fontSettled = true;
      fontsReady.resolve(undefined);
      const result = await copy;
      expect(rasterize).toHaveBeenCalledOnce();
      expect(rasterize.mock.calls[0]?.[0]).toMatchObject({ height: 40, width: 80 });
      expect(upload).toHaveBeenCalledOnce();
      expect(result).toEqual({ method: 'clipboard', status: 'copied' });
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
      if (originalFonts) {
        Object.defineProperty(document, 'fonts', originalFonts);
      } else {
        delete (document as unknown as { fonts?: unknown }).fonts;
      }
    }
  });

  it('waits for visible finite transitions after modern write before style keys', async () => {
    const writes: unknown[] = [];
    const transitionFinished = deferred<Animation>();
    let transitionState: 'running' | 'finished' = 'running';
    let styleReads = 0;
    const animation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() {
        return transitionState;
      },
      finished: transitionFinished.promise,
      transitionProperty: 'padding'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => ('running' === transitionState ? [animation] : [])
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (!pseudoElement) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(styleReads).toBe(0);
    transitionState = 'finished';
    transitionFinished.resolve(animation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(0);
  });

  it('waits for a visible finite CSSAnimation after modern write before style keys', async () => {
    const writes: unknown[] = [];
    const animationFinished = deferred<Animation>();
    let animationState: 'running' | 'finished' = 'running';
    let styleReads = 0;
    const animation = {
      animationName: 'pulse',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return animationState;
      },
      finished: animationFinished.promise
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => ('running' === animationState ? [animation] : [])
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    let copySettled = false;
    const copy = clipboard.copy(preview).then((result) => {
      copySettled = true;
      return result;
    });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(copySettled).toBe(false);
    expect(styleReads).toBe(0);
    animationState = 'finished';
    animationFinished.resolve(animation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(0);
  });

  it('waits for a finite transition that starts when the first one settles', async () => {
    const writes: unknown[] = [];
    const firstFinished = deferred<Animation>();
    const secondFinished = deferred<Animation>();
    let phase: 'first' | 'ready' | 'second' | 'done' = 'first';
    let styleReads = 0;
    let transitionReads = 0;
    const firstAnimation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() {
        return 'first' === phase ? 'running' : 'finished';
      },
      finished: firstFinished.promise,
      transitionProperty: 'padding'
    } as unknown as Animation;
    const secondAnimation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() {
        return 'second' === phase ? 'running' : 'finished';
      },
      finished: secondFinished.promise,
      transitionProperty: 'margin'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => {
        transitionReads += 1;
        return 'first' === phase ? [firstAnimation] : 'second' === phase ? [secondAnimation] : [];
      }
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (!pseudoElement) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await vi.waitFor(() => expect(transitionReads).toBeGreaterThan(0));
    const styleReadsBeforeReplacement = styleReads;
    phase = 'second';
    firstFinished.resolve(firstAnimation);
    await Promise.resolve();
    expect(styleReads).toBe(styleReadsBeforeReplacement);
    phase = 'done';
    secondFinished.resolve(secondAnimation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(0);
  });

  it('waits for a finite CSSAnimation that starts when the first one settles', async () => {
    const writes: unknown[] = [];
    const firstFinished = deferred<Animation>();
    const secondFinished = deferred<Animation>();
    let phase: 'first' | 'second' | 'done' = 'first';
    let styleReads = 0;
    const firstAnimation = {
      animationName: 'pulse-a',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return 'first' === phase ? 'running' : 'finished';
      },
      finished: firstFinished.promise
    } as unknown as Animation;
    const secondAnimation = {
      animationName: 'pulse-b',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return 'second' === phase ? 'running' : 'finished';
      },
      finished: secondFinished.promise
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => ('first' === phase ? [firstAnimation] : 'second' === phase ? [secondAnimation] : [])
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (!pseudoElement) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await vi.waitFor(() => expect(styleReads).toBeGreaterThan(0));
    const styleReadsBeforeReplacement = styleReads;
    phase = 'second';
    firstFinished.resolve(firstAnimation);
    await Promise.resolve();
    expect(styleReads).toBe(styleReadsBeforeReplacement);
    phase = 'done';
    secondFinished.resolve(secondAnimation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(styleReadsBeforeReplacement);
  });

  it('rejects a new active CSSAnimation after initial readiness without publishing stale cache', async () => {
    const writes: unknown[] = [];
    const firstFinished = deferred<Animation>();
    const secondFinished = deferred<Animation>();
    let phase: 'first' | 'ready' | 'second' | 'done' = 'first';
    let styleReads = 0;
    const firstAnimation = {
      animationName: 'pulse-a',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return 'first' === phase ? 'running' : 'finished';
      },
      finished: firstFinished.promise
    } as unknown as Animation;
    const secondAnimation = {
      animationName: 'pulse-b',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return 'second' === phase ? 'running' : 'finished';
      },
      finished: secondFinished.promise
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => ('first' === phase ? [firstAnimation] : 'second' === phase ? [secondAnimation] : [])
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName) {
          styleReads += 1;
          if (1 === styleReads) phase = 'second';
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    phase = 'ready';
    firstFinished.resolve(firstAnimation);
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writes).toHaveLength(1);
    phase = 'done';
    secondFinished.resolve(secondAnimation);
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(2);
  });

  it('waits for visible transitions before PNG rasterization or upload', async () => {
    const writes: unknown[] = [];
    const transitionFinished = deferred<Animation>();
    let transitionState: 'running' | 'finished' = 'running';
    const animation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() {
        return transitionState;
      },
      finished: transitionFinished.promise,
      animationName: 'pulse'
    } as unknown as Animation;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Visible diagram' });
    const liveMermaid = preview.querySelector('.easymde-mermaid');
    if (!liveMermaid) throw new Error('visible transition Mermaid missing');
    Object.defineProperty(liveMermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 40, width: 80 })
    });
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => ('running' === transitionState ? [animation] : [])
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['transition-png'], 'transition.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'transition.png',
      url: 'https://example.test/transition.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element.classList.contains('easymde-mermaid')) {
          return declaration({ display: 'block', height: '40px', width: '80px' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(rasterize).not.toHaveBeenCalled();
    transitionState = 'finished';
    transitionFinished.resolve(animation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
  });

  it('keeps a PNG copy alive beyond the initial transition deadline while upload is pending', async () => {
    vi.useFakeTimers();
    try {
      const writes: unknown[] = [];
      const transitionFinished = deferred<Animation>();
      const uploadResult = deferred<{ alt: string; status: 'uploaded'; title: string; url: string }>();
      let transitionState: 'running' | 'finished' = 'running';
      const animation = {
        effect: { getComputedTiming: () => ({ endTime: 120 }) },
        playState: 'running',
        finished: transitionFinished.promise,
        transitionProperty: 'width'
      } as unknown as Animation;
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Slow upload diagram' });
      const mermaid = preview.querySelector('.easymde-mermaid');
      if (!mermaid) throw new Error('slow upload Mermaid missing');
      Object.defineProperty(mermaid, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 40, width: 80 })
      });
      Object.defineProperty(preview, 'getAnimations', {
        configurable: true,
        value: () => ('running' === transitionState ? [animation] : [])
      });
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
        file: new File(['slow-upload'], 'slow-upload.png', { type: 'image/png' }),
        height,
        pixelCount: width * height,
        width
      }));
      const upload = vi.fn(() => uploadResult.promise);
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return declaration({});
          if (element.classList.contains('easymde-mermaid')) {
            return declaration({ display: 'block', height: '40px', width: '80px' });
          }
          return declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      const sourceMarkup = preview.innerHTML;
      const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      expect(writes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(0);
      transitionState = 'finished';
      transitionFinished.resolve(animation);
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(10_000);
      uploadResult.resolve({
        alt: '',
        status: 'uploaded',
        title: 'slow-upload.png',
        url: 'https://example.test/slow-upload.png'
      });
      await vi.advanceTimersByTimeAsync(0);
      await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { label: 'pending', pending: true, playState: 'idle' },
    { label: 'paused', pending: false, playState: 'paused' }
  ])('fails a $label finite transition at the existing resource deadline', async ({ pending, playState }) => {
    vi.useFakeTimers();
    try {
      const writes: unknown[] = [];
      const transitionFinished = deferred<Animation>();
      const animation = {
        effect: { getComputedTiming: () => ({ endTime: 120 }) },
        pending,
        playState,
        finished: transitionFinished.promise,
        transitionProperty: 'padding'
      } as unknown as Animation;
      const preview = readyPreview();
      Object.defineProperty(preview, 'getAnimations', { configurable: true, value: () => [animation] });
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement ? declaration({}) : declaration({ display: 'block' }),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      const copy = clipboard.copy(preview);
      expect(writes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      transitionFinished.resolve(animation);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects visible legacy copy before execCommand while a transition is pending', async () => {
    const transitionFinished = deferred<Animation>();
    const animation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      playState: 'running',
      finished: transitionFinished.promise,
      transitionProperty: 'padding'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', { configurable: true, value: () => [animation] });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (_element, _pseudoElement) => declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();
      transitionFinished.resolve(animation);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('rejects visible legacy copy before execCommand while a CSSAnimation is pending', async () => {
    const animationFinished = deferred<Animation>();
    const animation = {
      animationName: 'pulse',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      finished: animationFinished.promise,
      playState: 'running'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', { configurable: true, value: () => [animation] });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (_element, _pseudoElement) => declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();
      animationFinished.resolve(animation);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it.each([
    { label: 'pending', pending: true, playState: 'idle' },
    { label: 'paused', pending: false, playState: 'paused' }
  ])('fails a $label finite CSSAnimation at the existing resource deadline', async ({ pending, playState }) => {
    vi.useFakeTimers();
    try {
      const writes: unknown[] = [];
      const animationFinished = deferred<Animation>();
      const animation = {
        animationName: 'pulse',
        effect: { getComputedTiming: () => ({ endTime: 400 }) },
        pending,
        playState,
        finished: animationFinished.promise
      } as unknown as Animation;
      const preview = readyPreview();
      Object.defineProperty(preview, 'getAnimations', { configurable: true, value: () => [animation] });
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement ? declaration({}) : declaration({ display: 'block' }),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      const copy = clipboard.copy(preview);
      expect(writes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      animationFinished.resolve(animation);
    } finally {
      vi.useRealTimers();
    }
  });

  it('latches a transition API error before visible legacy cache or exec fallback', async () => {
    let apiCalls = 0;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => {
        apiCalls += 1;
        if (1 === apiCalls) throw new Error('transition-api-failed');
        return [];
      }
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (_element, _pseudoElement) => declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();
      expect(apiCalls).toBe(1);
      if (!clipboard.prepare) throw new Error('clipboard preparation unavailable');
      await clipboard.prepare(preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(execCommand).toHaveBeenCalledOnce();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('treats a CSS transition cancellation as terminal and publishes no stale cache', async () => {
    const writes: unknown[] = [];
    let rejectFinished!: (reason?: unknown) => void;
    const finished = new Promise<Animation>((_resolve, reject) => {
      rejectFinished = reject;
    });
    let transitionState: 'running' | 'finished' = 'running';
    let transitionReads = 0;
    const animation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() {
        return transitionState;
      },
      finished,
      transitionProperty: 'padding'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => {
        transitionReads += 1;
        return 'running' === transitionState ? [animation] : [];
      }
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) =>
        pseudoElement ? declaration({}) : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const firstCopy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await vi.waitFor(() => expect(transitionReads).toBeGreaterThan(0));
    rejectFinished({ name: 'AbortError' });
    await expect(firstCopy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    transitionState = 'finished';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(2);
    expect(preview.innerHTML).toContain('Rendered');
  });

  it('treats a CSSAnimation cancellation as terminal and publishes no stale cache', async () => {
    const writes: unknown[] = [];
    let rejectFinished!: (reason?: unknown) => void;
    const finished = new Promise<Animation>((_resolve, reject) => {
      rejectFinished = reject;
    });
    void finished.catch(() => undefined);
    let animationState: 'running' | 'finished' = 'running';
    const animation = {
      animationName: 'pulse',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return animationState;
      },
      finished
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => ('running' === animationState ? [animation] : [])
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) =>
        pseudoElement ? declaration({}) : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const firstCopy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    rejectFinished({ name: 'AbortError' });
    await expect(firstCopy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    animationState = 'finished';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(2);
  });

  it.each(['infinite CSSAnimation', 'JavaScript WAAPI Animation'])('does not wait for an excluded %s', async (kind) => {
    const writes: unknown[] = [];
    const animationFinished = deferred<Animation>();
    let styleReads = 0;
    const animation = ('infinite CSSAnimation' === kind
      ? {
          animationName: 'pulse',
          effect: { getComputedTiming: () => ({ endTime: Infinity }) },
          finished: animationFinished.promise,
          playState: 'running'
        }
      : {
          effect: { getComputedTiming: () => ({ endTime: 400 }) },
          finished: animationFinished.promise,
          playState: 'running'
        }) as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', { configurable: true, value: () => [animation] });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (!pseudoElement) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(0);
    animationFinished.resolve(animation);
  });

  it('joins hidden source and clone CSSAnimation under the measurement readiness lease', async () => {
    const writes: unknown[] = [];
    const animationFinished = deferred<Animation>();
    let animationState: 'running' | 'finished' = 'running';
    let cloneLayoutStarted = false;
    let styleReads = 0;
    const animation = {
      animationName: 'pulse',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return animationState;
      },
      finished: animationFinished.promise
    } as unknown as Animation;
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalAnimations = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getAnimations');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('easymde-preview') && this.closest('.easymde-wechat-preview-measurement')) {
          cloneLayoutStarted = true;
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-mermaid') && this.closest('.easymde-wechat-preview-measurement')) {
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (
          cloneLayoutStarted &&
          this.classList.contains('easymde-preview') &&
          this.closest('.easymde-wechat-preview-measurement')
        )
          return 'running' === animationState ? [animation] : [];
        return [];
      }
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Hidden transition' });
    preview.className = 'easymde-preview';
    Object.defineProperty(preview, 'getAnimations', { configurable: true, value: () => [] });
    workspace.append(preview);
    document.body.append(workspace);
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['hidden-css-animation'], 'hidden-css-animation.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-css-animation.png',
      url: 'https://example.test/hidden-css-animation.png'
    }));
    const sourceMarkup = preview.innerHTML;
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace || element === preview) return declaration({ display: 'none' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          styleReads += 1;
          if (element.classList.contains('easymde-mermaid')) {
            return declaration({ display: 'block', height: '40px', width: '80px' });
          }
          return declaration({ display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    try {
      const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      expect(cloneLayoutStarted).toBe(true);
      expect(styleReads).toBe(0);
      expect(rasterize).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      animationState = 'finished';
      animationFinished.resolve(animation);
      await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(styleReads).toBeGreaterThan(0);
      expect(rasterize).toHaveBeenCalledOnce();
      expect(upload).toHaveBeenCalledOnce();
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      if (originalAnimations) {
        Object.defineProperty(HTMLElement.prototype, 'getAnimations', originalAnimations);
      } else {
        delete (HTMLElement.prototype as unknown as { getAnimations?: unknown }).getAnimations;
      }
      workspace.remove();
    }
  });

  it('cleans a pending hidden font lease on PNG abort before late font resolution', async () => {
    const writes: unknown[] = [];
    const fontsReady = deferred<unknown>();
    let cloneLayoutStarted = false;
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { status: 'loading', ready: fontsReady.promise }
    });
    const preview = readyPreview();
    preview.className = 'easymde-preview';
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Abort diagram' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 300, height: 300, left: 0, right: 500, top: 0, width: 500, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-preview') && this.closest('.easymde-wechat-preview-measurement')) {
          cloneLayoutStarted = true;
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-mermaid') && this.closest('.easymde-wechat-preview-measurement')) {
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['abort-font'], 'abort-font.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'abort-font.png',
      url: 'https://example.test/abort-font.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '500px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          if (element.classList.contains('easymde-mermaid')) {
            return declaration({ display: 'block', height: '40px', width: '80px' });
          }
          return declaration({ display: 'block' });
        }
        if (element === preview) return declaration({ display: 'none' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });
    const controller = new AbortController();

    try {
      const copy = clipboard.copy(
        preview,
        pngOptions({ rasterize }, { upload } as never, { signal: controller.signal })
      );
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      await vi.waitFor(() => expect(cloneLayoutStarted).toBe(true));
      controller.abort();
      await expect(copy).resolves.toEqual({
        code: 'wechat-png-rasterization-cancelled',
        sideEffects: 'none',
        status: 'failed'
      });
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(rasterize).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      fontsReady.resolve(undefined);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(rasterize).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
      if (originalFonts) {
        Object.defineProperty(document, 'fonts', originalFonts);
      } else {
        delete (document as unknown as { fonts?: unknown }).fonts;
      }
    }
  });

  it('uses one current attached measurement tree for hidden portable HTML and text', async () => {
    const writes: Array<{ html: string; text: string }> = [];
    const measurementHosts = new Set<Element>();
    let themeColor = 'rgb(1, 2, 3)';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<p>Hidden source</p><pre><code>one\ntwo</code></pre>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Hidden source\none\ntwo' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 300, height: 300, left: 0, right: 500, top: 0, width: 500, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const copy = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        const measurement = element.closest('.easymde-wechat-preview-measurement');
        if (measurement) {
          measurementHosts.add(measurement);
          if (element.classList.contains('workspace-shell')) {
            return declaration({
              display: 'block',
              'border-left-width': '5px',
              'border-right-width': '5px',
              'padding-left': '20px',
              'padding-right': '20px',
              width: '450px'
            });
          }
          return declaration({ color: themeColor, display: 'block', 'padding-left': '28px', 'padding-right': '28px' });
        }
        if (element === workspace) return declaration({ display: 'none', width: '500px' });
        if (element === preview) return declaration({ color: 'rgb(200, 0, 0)', display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub;
        const html = await blobText(item.payload['text/html'] as Blob | PromiseLike<Blob>);
        const text = await blobText(item.payload['text/plain'] as Blob | PromiseLike<Blob>);
        writes.push({ html, text });
      }
    });
    const sourceMarkup = preview.innerHTML;

    try {
      await expect(copy.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(writes).toHaveLength(1);
      expect(writes[0]?.html).toContain('color:rgb(1, 2, 3)');
      expect(writes[0]?.html).not.toContain('color:rgb(200, 0, 0)');
      expect(writes[0]?.text).toContain('Hidden source');
      expect(measurementHosts).toHaveLength(1);
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();

      themeColor = 'rgb(4, 5, 6)';
      await expect(copy.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(writes).toHaveLength(2);
      expect(writes[1]?.html).toContain('color:rgb(4, 5, 6)');
      expect(writes[1]?.html).not.toContain('color:rgb(1, 2, 3)');
      expect(measurementHosts).toHaveLength(2);
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('waits for hidden clone image readiness on cold and warm copies', async () => {
    const writes: unknown[] = [];
    let cloneImageReady = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<p>Image geometry</p><img loading="lazy" src="https://example.test/geometry.png">';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Image geometry' });
    const sourceImage = preview.querySelector('img');
    if (!sourceImage) throw new Error('source image missing');
    Object.defineProperties(sourceImage, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 64 },
      naturalHeight: { configurable: true, value: 32 }
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
    const originalNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');
    const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 240, height: 240, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.closest('.easymde-wechat-preview-measurement') ? cloneImageReady : true;
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.closest('.easymde-wechat-preview-measurement') && cloneImageReady ? 64 : 0;
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.closest('.easymde-wechat-preview-measurement') && cloneImageReady ? 32 : 0;
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: vi.fn(async () => undefined)
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          return declaration({ display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('clone readiness html payload missing');
        await blobText(htmlPayload);
      }
    });

    const restore = (): void => {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalComplete) Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
      else delete (HTMLImageElement.prototype as unknown as { complete?: unknown }).complete;
      if (originalNaturalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
      else delete (HTMLImageElement.prototype as unknown as { naturalWidth?: unknown }).naturalWidth;
      if (originalNaturalHeight)
        Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', originalNaturalHeight);
      else delete (HTMLImageElement.prototype as unknown as { naturalHeight?: unknown }).naturalHeight;
      if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
      else delete (HTMLImageElement.prototype as unknown as { decode?: unknown }).decode;
      workspace.remove();
    };

    try {
      const firstCopy = clipboard.copy(preview);
      await vi.waitFor(() => {
        expect(writes).toHaveLength(1);
        const cloneImage = document.querySelector<HTMLElement>('.easymde-wechat-preview-measurement img');
        expect(cloneImage?.getAttribute('loading')).toBe('eager');
      });
      const firstClone = document.querySelector<HTMLImageElement>('.easymde-wechat-preview-measurement img');
      if (!firstClone) throw new Error('cold clone image missing');
      cloneImageReady = true;
      firstClone.dispatchEvent(new Event('load'));
      expect(await firstCopy).toEqual({ method: 'clipboard', status: 'copied' });

      cloneImageReady = false;
      const secondCopy = clipboard.copy(preview);
      await vi.waitFor(() => {
        expect(writes).toHaveLength(2);
        expect(document.querySelector('.easymde-wechat-preview-measurement img')).not.toBeNull();
      });
      const secondClone = document.querySelector<HTMLImageElement>('.easymde-wechat-preview-measurement img');
      if (!secondClone) throw new Error('warm clone image missing');
      cloneImageReady = true;
      secondClone.dispatchEvent(new Event('load'));
      await expect(secondCopy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      restore();
    }
  });

  it('fails and tears down the hidden lease when a clone image errors', async () => {
    const probe = installHiddenImageProbe();
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === probe.workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('clone image error payload missing');
        await blobText(htmlPayload);
      }
    });

    try {
      const copy = clipboard.copy(probe.preview);
      await vi.waitFor(() => {
        expect(writes).toHaveLength(1);
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      probe.dispatch('error');
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      probe.restore();
    }
  });

  it('fails and tears down the hidden lease when the paired source image is broken', async () => {
    const probe = installHiddenImageProbe();
    const sourceImage = probe.preview.querySelector('img');
    if (!sourceImage) throw new Error('source image missing');
    Object.defineProperties(sourceImage, {
      complete: { configurable: true, value: true },
      naturalHeight: { configurable: true, value: 0 },
      naturalWidth: { configurable: true, value: 0 }
    });
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === probe.workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('source image error payload missing');
        await blobText(htmlPayload);
      }
    });

    try {
      const copy = clipboard.copy(probe.preview);
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      probe.restore();
    }
  });

  it('cancels a pending clone image wait before late events can publish', async () => {
    const probe = installHiddenImageProbe();
    const writes: unknown[] = [];
    const controller = new AbortController();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === probe.workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('clone cancel payload missing');
        await blobText(htmlPayload);
      }
    });

    try {
      const copy = clipboard.copy(probe.preview, { signal: controller.signal });
      await vi.waitFor(() => {
        expect(writes).toHaveLength(1);
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      expect(probe.capture()).not.toBeNull();
      controller.abort();
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      probe.setReady(true);
      probe.dispatch('load');
      await Promise.resolve();
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      probe.restore();
    }
  });

  it('fails a hidden clone image that never settles within the resource budget', async () => {
    vi.useFakeTimers();
    const probe = installHiddenImageProbe();
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === probe.workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('clone timeout payload missing');
        await blobText(htmlPayload);
      }
    });

    try {
      const copy = clipboard.copy(probe.preview);
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(writes).toHaveLength(1);
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      probe.restore();
      vi.useRealTimers();
    }
  });

  it('does not enter synchronous legacy copy before hidden clone readiness', async () => {
    const probe = installHiddenImageProbe();
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === probe.workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await expect(clipboard.copy(probe.preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      probe.setReady(true);
      probe.dispatch('load');
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      });
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
      probe.restore();
    }
  });

  it('cleans a hidden portable measurement after a rejected modern write', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 200, height: 200, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const write = vi.fn(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      throw new Error('NotAllowedError');
    });
    const copy = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          return declaration({ display: 'block', color: 'rgb(1, 2, 3)' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    try {
      await expect(copy.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(write).toHaveBeenCalledOnce();
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      });
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('does not create a second hidden lease while an old background preparation is pending', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/pending-hidden.png', document.baseURI).href;
    const writes: unknown[] = [];
    const abortController = new AbortController();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<h1>Pending hidden</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Pending hidden' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 200, height: 200, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch: vi.fn(() => pendingImage.promise),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          return declaration({ display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        await blobText(item.payload['text/html'] as Blob | PromiseLike<Blob>);
      })
    });
    const background = prepareClipboard(clipboard, preview, { background: true });

    try {
      await vi.waitFor(() => {
        expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);
      });
      const copy = clipboard.copy(preview, { signal: abortController.signal });
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      abortController.abort();
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(writes).toHaveLength(1);
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);

      pendingImage.resolve({
        blob: async () => new Blob(['theme image'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await expect(background).resolves.toBeUndefined();
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('cancels a visible background owner before a hidden Source copy takes its lease', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/source-race.png', document.baseURI).href;
    const writes: unknown[] = [];
    const preview = readyPreview();
    preview.innerHTML = '<h1>Visible owner</h1><ul><li>List item</li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Visible owner\nList item' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    let hidden = false;
    let hiddenLiveListReads = 0;
    let measurementListReads = 0;
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const rect = (width: number, height = 20) => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.hasAttribute('data-easymde-wechat-list-marker-anchor')) {
          return { bottom: 20, height: 0, left: 12, right: 12, top: 20, width: 0, x: 12, y: 20 };
        }
        if ('LI' === this.tagName && this.closest('[data-easymde-wechat-list-marker-probe]')) {
          return rect(400);
        }
        if (this.matches('ul, ol') && !this.closest('[data-easymde-wechat-list-marker-probe]')) {
          if (this.closest('.easymde-wechat-preview-measurement')) measurementListReads += 1;
          else if (hidden) hiddenLiveListReads += 1;
        }
        if (this.closest('.easymde-wechat-preview-measurement')) return rect(400);
        if (this.closest('[data-easymde-wechat-list-marker-probe]')) return rect(400);
        if (this === workspace || this.matches('ul, ol')) return rect(hidden ? 0 : 400);
        return originalRect?.value?.call(this) ?? rect(0, 0);
      }
    });
    const declarationFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('::before' === pseudoElement && 'H1' === element.tagName) {
        return declaration({
          background: `url("${imageUrl}")`,
          'background-image': `url("${imageUrl}")`,
          content: '""',
          display: 'block',
          height: '20px',
          width: '20px'
        });
      }
      if ('::marker' === pseudoElement) {
        return declaration({
          content: 'normal',
          'font-family': 'sans-serif',
          'font-size': '16px',
          'font-style': 'normal',
          'font-stretch': '100%',
          'font-variant': 'normal',
          'font-weight': '400',
          'letter-spacing': 'normal',
          'line-height': 'normal',
          'writing-mode': 'horizontal-tb'
        });
      }
      if (pseudoElement) return declaration({});
      if (element === workspace) {
        return declaration({ display: hidden ? 'none' : 'block', width: '400px' });
      }
      if (element.closest('.easymde-wechat-preview-measurement')) {
        return declarationForElement(element);
      }
      return declarationForElement(element);
    };
    const declarationForElement = (element: Element): CSSStyleDeclaration => {
      if ('UL' === element.tagName || 'OL' === element.tagName) {
        return declaration({
          'counter-increment': 'none',
          'counter-reset': 'none',
          'counter-set': 'none',
          direction: 'ltr',
          display: 'block',
          'list-style-image': 'none',
          'list-style-position': 'outside',
          'list-style-type': 'disc',
          'padding-left': '0px',
          'padding-right': '0px',
          'writing-mode': 'horizontal-tb'
        });
      }
      if ('LI' === element.tagName) {
        return declaration({
          'counter-increment': 'none',
          'counter-reset': 'none',
          'counter-set': 'none',
          direction: 'ltr',
          display: 'list-item',
          'list-style-image': 'none',
          'list-style-position': 'outside',
          'list-style-type': 'disc',
          'writing-mode': 'horizontal-tb'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: declarationFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        await blobText(item.payload['text/html'] as Blob | PromiseLike<Blob>);
      })
    });
    const background = prepareClipboard(clipboard, preview, { background: true });

    try {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      hidden = true;
      const copy = clipboard.copy(preview);
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      expect(hiddenLiveListReads).toBe(0);
      pendingImage.resolve({
        blob: async () => new Blob(['theme image'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await expect(background).rejects.toThrow('wechat-background-preparation-cancelled');
      await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(measurementListReads).toBeGreaterThan(0);
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(0);
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('hands off from a visible background transition before its finished promise settles', async () => {
    const pendingTransition = deferred<void>();
    const transitionState = {
      animationName: '',
      effect: { getComputedTiming: () => ({ endTime: 100 }) },
      finished: pendingTransition.promise,
      pending: false,
      playState: 'running',
      transitionProperty: 'opacity'
    };
    const transition = transitionState as unknown as Animation;
    const preview = readyPreview();
    preview.innerHTML = '<p>Transition owner</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Transition owner' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    let hidden = false;
    let transitionReads = 0;
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => {
        transitionReads += 1;
        return [transition];
      }
    });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.closest('.easymde-wechat-preview-measurement')) {
          return { bottom: 200, height: 200, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        if (this === workspace) {
          return {
            bottom: hidden ? 0 : 200,
            height: hidden ? 0 : 200,
            left: 0,
            right: hidden ? 0 : 400,
            top: 0,
            width: hidden ? 0 : 400,
            x: 0,
            y: 0
          };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if (element === workspace) {
          return declaration({ display: hidden ? 'none' : 'block', width: '400px' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });
    const background = prepareClipboard(clipboard, preview, { background: true });
    const backgroundResult = background.then(
      () => ({ error: null, ok: true as const }),
      (error: unknown) => ({ error, ok: false as const })
    );

    try {
      await vi.waitFor(() => expect(transitionReads).toBeGreaterThan(0));
      hidden = true;
      const copy = clipboard.copy(preview);
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      const result = await backgroundResult;
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('background transition unexpectedly succeeded');
      expect(result.error).toEqual(expect.objectContaining({ message: 'wechat-preview-measurement-cancelled' }));
      transitionState.playState = 'finished';
      pendingTransition.resolve();
      await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    } finally {
      transitionState.playState = 'finished';
      pendingTransition.resolve();
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('removes an owned hidden lease immediately on abort while its resource is pending', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/pending-owned.png', document.baseURI).href;
    const fetch = vi.fn(() => pendingImage.promise);
    const writes: unknown[] = [];
    const abortController = new AbortController();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<h1>Owned hidden lease</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Owned hidden lease' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 200, height: 200, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          return declaration({ display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('owned lease html payload missing');
        await blobText(htmlPayload);
      }
    });

    try {
      const copy = clipboard.copy(preview, { signal: abortController.signal });
      await vi.waitFor(() => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);
      });
      abortController.abort();
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(writes).toHaveLength(1);
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();

      pendingImage.resolve({
        blob: async () => new Blob(['theme image'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await Promise.resolve();
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('starts a fresh copy after aborting its pending preparation', async () => {
    const oldImage = deferred<Response>();
    const oldImageUrl = new URL('/assets/images/pending-old-copy.png', document.baseURI).href;
    const newImageUrl = new URL('/assets/images/fresh-copy.png', document.baseURI).href;
    const fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('pending-old-copy')) return oldImage.promise;
      return Promise.resolve({
        blob: async () => new Blob(['fresh image'], { type: 'image/png' }),
        ok: true,
        url: newImageUrl
      } as unknown as Response);
    });
    const writes: unknown[] = [];
    const firstAbort = new AbortController();
    let useFreshImage = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<h1>Fresh copy after abort</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Fresh copy after abort' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 200, height: 200, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          const imageUrl = useFreshImage ? newImageUrl : oldImageUrl;
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          return declaration({ display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('fresh copy html payload missing');
        await blobText(htmlPayload);
      }
    });

    try {
      const firstCopy = clipboard.copy(preview, { signal: firstAbort.signal });
      await vi.waitFor(() => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(writes).toHaveLength(1);
        expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);
      });
      firstAbort.abort();
      await expect(firstCopy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });

      useFreshImage = true;
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      const secondItem = (writes[1] as ClipboardItemStub[])[0];
      const secondHtml = secondItem?.payload['text/html'];
      if (!secondHtml) throw new Error('fresh copy html missing');
      expect(await blobText(secondHtml)).toContain('data:image/png;base64,ZnJlc2ggaW1hZ2U=');

      oldImage.resolve({
        blob: async () => new Blob(['old image'], { type: 'image/png' }),
        ok: true,
        url: oldImageUrl
      } as unknown as Response);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('commits a warm hidden legacy payload when the lease has no media', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Warm hidden</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Warm hidden' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 240, height: 240, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await prepareClipboard(clipboard, preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(execCommand).toHaveBeenCalledWith('copy');
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
      workspace.remove();
    }
  });

  it('uses a ready hidden payload for synchronous modern fallback commitment', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Ready hidden</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Ready hidden' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 240, height: 240, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const write = vi.fn(async () => undefined);
    class ThrowingClipboardItem {
      constructor() {
        throw new Error('clipboard-item-constructor-failed');
      }
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ThrowingClipboardItem,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    try {
      await prepareClipboard(clipboard, preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(write).not.toHaveBeenCalled();
      expect(execCommand).toHaveBeenCalledWith('copy');
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
      workspace.remove();
    }
  });

  it('cleans the hidden measurement tree when modern PNG write rejects immediately', async () => {
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html">Held math</span></span></div>';
    const sourceMarkup = preview.innerHTML;
    const rasterize = vi.fn(async () => ({
      file: new File(['late'], 'late.png', { type: 'image/png' }),
      height: 24,
      pixelCount: 4320,
      width: 180
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'late.png',
      url: 'https://example.test/late.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === preview) return declaration({ display: 'none' });
        if (element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '24px', width: '180px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.reject(new Error('NotAllowedError')))
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-clipboard-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('builds a native root capture clone without exporter markers or unsafe SVG URLs', async () => {
    const writes: unknown[] = [];
    let captured: Element | null = null;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex"><span class="vlist" data-source="native"><span class="pstrut">A\u2060B</span><svg><a href="javascript:bad"><rect width="10" height="10"></rect></a></svg></span><span class="katex-mathml"><math><annotation>fallback</annotation></math></span></span></div>';
    const root = preview.querySelector('.easymde-math-block');
    if (!root) throw new Error('math root missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 30, width: 180 })
    });
    const rasterize = vi.fn(async ({ source }: { source: Element }) => {
      captured = source;
      return {
        file: new File(['native'], 'native.png', { type: 'image/png' }),
        height: 30,
        pixelCount: 200,
        width: 180
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/native.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '30px', overflow: 'auto', width: '180px' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('vlist')) {
          return declaration({ display: 'table', 'table-layout': 'fixed' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('pstrut')) {
          return declaration({ display: 'table-cell', width: '12px', height: '24px' });
        }
        if ('svg' === element.localName.toLowerCase()) {
          return declaration({ display: 'inline-block', width: '10px', height: '10px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const capture = captured as unknown as Element;
    expect(capture.classList.contains('easymde-math-block')).toBe(true);
    expect(capture.querySelector('.katex-mathml')).toBeNull();
    expect(capture.querySelector('.pstrut')).not.toBeNull();
    expect(capture.querySelector('.pstrut')?.getAttribute('style')).toContain('display:table-cell');
    expect(capture.querySelector('.pstrut')?.getAttribute('style')).toContain('width:12px');
    expect(capture.textContent).toContain('A\u2060B');
    expect(capture.querySelector('[href^="javascript:"]')).toBeNull();
    expect(writes).toHaveLength(1);
  });

  it('preserves native KaTeX table layout without freezing intrinsic table geometry', async () => {
    let captured: Element | null = null;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="base"><span class="vlist-t"><span class="vlist-r"><span class="vlist"><span class="pstrut"></span><span class="mord">1</span></span></span></span></span></span></span></div>';
    const root = preview.querySelector('.easymde-math-block');
    if (!root) throw new Error('math root missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 24, width: 12.390625 })
    });
    const rasterize = vi.fn(async ({ source }: { source: Element }) => {
      captured = source;
      return {
        file: new File(['native-table'], 'native-table.png', { type: 'image/png' }),
        height: 24,
        pixelCount: 200,
        width: 12.390625
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'native-table.png',
      url: 'https://example.test/native-table.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            height: '24px',
            'overflow-wrap': 'normal',
            'white-space': 'normal',
            width: '12.390625px'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('vlist-t')) {
          return declaration({
            display: 'inline-table',
            height: '22.765625px',
            'table-layout': 'fixed',
            width: '9.765625px'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('vlist-r')) {
          return declaration({ display: 'table-row', height: '13.453125px', width: '9.765625px' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('vlist')) {
          return declaration({ display: 'table-cell', height: '13.453125px', width: '12.390625px' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('pstrut')) {
          return declaration({ display: 'inline-block', height: '58.078125px', width: '0px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn()
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const capture = captured as unknown as Element;
    const rootStyle = capture.getAttribute('style') ?? '';
    expect(rootStyle).toContain('white-space:normal');
    expect(rootStyle).toContain('overflow-wrap:normal');
    const vlistTableStyle = capture.querySelector('.vlist-t')?.getAttribute('style') ?? '';
    expect(vlistTableStyle).toContain('display:inline-table');
    expect(vlistTableStyle).toContain('table-layout:fixed');
    expect(vlistTableStyle).toContain('width:9.765625px');
    expect(vlistTableStyle).toContain('height:22.765625px');
    for (const [selector, width, height] of [
      ['.vlist-r', '9.765625px', '13.453125px'],
      ['.vlist', '12.390625px', '13.453125px']
    ] as const) {
      const style = capture.querySelector(selector)?.getAttribute('style') ?? '';
      expect(style).toContain(`width:${width}`);
      expect(style).toContain(`height:${height}`);
    }
    expect(capture.querySelector('.pstrut')?.getAttribute('style')).toContain('width:0px');
    expect(capture.querySelector('.pstrut')?.getAttribute('style')).toContain('height:58.078125px');
  });

  it('rejects expanded raster output beyond the existing PNG edge bound', async () => {
    const rasterize = vi.fn(async () => ({
      file: new File(['oversized'], 'oversized.png', { type: 'image/png' }),
      height: 30,
      pixelCount: 200,
      width: MAX_WECHAT_PNG_DIMENSION + 1
    }));
    const upload = vi.fn();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math"><span class="katex"><span class="katex-html">oversized formula</span></span></div>';
    const math = preview.querySelector('.easymde-math');
    if (!math) throw new Error('math root missing');
    Object.defineProperties(math, {
      getBoundingClientRect: { configurable: true, value: () => ({ height: 30, width: 180 }) },
      scrollHeight: { configurable: true, value: 30 },
      scrollWidth: { configurable: true, value: MAX_WECHAT_PNG_DIMENSION + 1 }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math')) {
          return declaration({ display: 'block', height: '30px', overflow: 'auto', width: '180px' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-limit-exceeded',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
  });

  it('aligns short and wide block PNGs while preserving inline math baseline flow', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = [
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html">short formula</span></span></div>',
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html">wide formula</span></span></div>',
      '<span class="easymde-math-inline"><span class="katex"><span class="katex-html">inline formula</span></span></span>'
    ].join('');
    const roots = [...preview.querySelectorAll('.easymde-math-block, .easymde-math-inline')];
    roots.forEach((root) => {
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 26, width: 374 })
      });
    });
    const rasterize = vi.fn(async ({ height, source }: { height: number; source: Element }) => {
      const text = source.textContent ?? '';
      const width = text.includes('short') ? 300 : text.includes('wide') ? 605 : 120;
      return {
        ...('SPAN' === source.tagName
          ? { inlineLayout: { baseline: 6, height: 26, paintOffsetX: 0, paintOffsetY: 0, width: 120 } }
          : {}),
        file: new File([`${width}`], `math-${width}.png`, { type: 'image/png' }),
        height,
        pixelCount: 200,
        width
      };
    });
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            height: '26px',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            width: '374px'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({ display: 'inline', 'vertical-align': 'baseline' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/math-"]')];
    expect(images).toHaveLength(3);
    expect(images[0]?.getAttribute('style')).toContain('display:block');
    expect(images[0]?.getAttribute('style')).toContain('margin-left:auto!important');
    expect(images[0]?.getAttribute('style')).toContain('margin-right:auto!important');
    expect(images[1]?.getAttribute('style')).toContain('display:block');
    expect(images[1]?.getAttribute('style')).toContain('width:605px!important');
    expect(images[1]?.getAttribute('style')).toContain('margin-left:auto!important');
    expect(images[1]?.parentElement?.getAttribute('style')).toContain('overflow-x:auto');
    expect(images[1]?.parentElement?.getAttribute('style')).toContain('inline-size:100%!important');
    expect(images[2]?.parentElement?.getAttribute('style')).toContain('display:inline-block!important');
    expect(images[2]?.parentElement?.getAttribute('style')).toContain('vertical-align:-20px');
    expect(images[2]?.getAttribute('style')).not.toContain('margin-left:auto!important');
  });

  it('derives inline math vertical alignment from measured raster baselines', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = [
      '<p>before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">fraction</span></span></span> after</p>',
      '<p>before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">superscript</span></span></span> after</p>',
      '<p>before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">neighbor</span></span></span> after</p>'
    ].join('');
    const roots = [...preview.querySelectorAll('.easymde-math-inline')];
    roots.forEach((root) => {
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 12, width: 24 })
      });
    });
    const rasterize = vi.fn(async ({ height, source, width }: { height: number; source: Element; width: number }) => {
      const text = source.textContent ?? '';
      const baselinePosition = text.includes('fraction') ? -4 : text.includes('superscript') ? 6 : 10;
      return {
        file: new File([text], `inline-${baselinePosition}.png`, { type: 'image/png' }),
        height,
        inlineLayout: { baseline: baselinePosition, height, paintOffsetX: 0, paintOffsetY: 0, width },
        pixelCount: 200,
        width
      };
    });
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({
            display: 'inline',
            'margin-bottom': '5px',
            'margin-left': '7px',
            'margin-right': '11px',
            'margin-top': '3px'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/inline-"]')];
    expect(images).toHaveLength(3);
    expect(images[0]?.parentElement?.getAttribute('style')).toContain('vertical-align:-16px');
    expect(images[1]?.parentElement?.getAttribute('style')).toContain('vertical-align:-6px');
    expect(images[2]?.parentElement?.getAttribute('style')).toContain('vertical-align:-2px');
    expect(images[0]?.parentElement?.getAttribute('style')).toContain('margin-left:7px');
    expect(images[0]?.parentElement?.getAttribute('style')).toContain('margin-right:11px');
    expect(images[0]?.parentElement?.getAttribute('style')).not.toContain('margin-top');
    expect(images[0]?.parentElement?.getAttribute('style')).not.toContain('margin-bottom');
    expect(holder.textContent).toContain('before  after');
  });

  it('mounts native inline captures with the source parent typography context', async () => {
    const writes: unknown[] = [];
    let inlineParent: Element | null = null;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<p class="source-parent"><span class="easymde-math-inline"><span class="katex"><span class="katex-html">inline</span></span></span></p>';
    const root = preview.querySelector('.easymde-math-inline');
    if (!root) throw new Error('inline math root missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 18, width: 42 })
    });
    const rasterize = vi.fn(
      async ({ inlineParent: requestInlineParent, source }: { inlineParent?: Element; source: Element }) => {
        inlineParent = requestInlineParent ?? null;
        expect(source.parentElement).toBeNull();
        return {
          file: new File(['inline'], 'inline.png', { type: 'image/png' }),
          height: 18,
          inlineLayout: { baseline: 13, height: 18, paintOffsetX: 0, paintOffsetY: 0, width: 42 },
          pixelCount: 200,
          width: 42
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'inline.png',
      url: 'https://example.test/inline.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          return declaration({
            'font-family': 'Parent Serif',
            'font-size': '18px',
            'font-style': 'italic',
            'font-weight': '600',
            'letter-spacing': '0.25px',
            'line-height': '30px',
            'word-spacing': '1px'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({ display: 'inline', 'font-size': '12px', 'line-height': '14px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(inlineParent).toBe(root.parentElement);
    expect(writes).toHaveLength(1);
  });

  it('preserves top and bottom inline alignment keywords from the source flow', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = [
      '<p>Before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">top</span></span></span> after</p>',
      '<p>Before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">bottom</span></span></span> after</p>'
    ].join('');
    [...preview.querySelectorAll('.easymde-math-inline')].forEach((root) => {
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 22, width: 24 })
      });
    });
    const rasterize = vi.fn(async ({ source }: { source: Element }) => ({
      file: new File([source.textContent ?? ''], `${source.textContent}.png`, { type: 'image/png' }),
      height: 22,
      inlineLayout: { baseline: 18, height: 22, paintOffsetX: 0, paintOffsetY: 0, width: 24 },
      pixelCount: 200,
      width: 24
    }));
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({
            display: 'inline',
            'vertical-align': element.textContent?.includes('top') ? 'top' : 'bottom'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/"]')];
    expect(images).toHaveLength(2);
    expect(images[0]?.parentElement?.getAttribute('style')).toContain('vertical-align:top!important');
    expect(images[1]?.parentElement?.getAttribute('style')).toContain('vertical-align:bottom!important');
    expect(images[0]?.parentElement?.getAttribute('style')).not.toContain('-4px');
    expect(images[1]?.parentElement?.getAttribute('style')).not.toContain('-4px');
  });

  it('keeps inline PNG scroll and clip behavior on the source allocation viewport', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = [
      '<p><span class="easymde-math-inline" data-overflow="auto"><span class="katex"><span class="katex-html">scroll</span></span></span></p>',
      '<p><span class="easymde-math-inline" data-overflow="hidden"><span class="katex"><span class="katex-html">clip</span></span></span></p>'
    ].join('');
    const roots = [...preview.querySelectorAll('.easymde-math-inline')];
    roots.forEach((root) => {
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 18, width: 12 })
      });
    });
    const rasterize = vi.fn(async ({ source }: { source: Element }) => {
      const isScroll = source.textContent?.includes('scroll') ?? false;
      return {
        file: new File(['png'], `${isScroll ? 'auto' : 'hidden'}.png`, { type: 'image/png' }),
        height: 18,
        inlineLayout: {
          baseline: 18,
          height: 22,
          overflowX: isScroll ? ('auto' as const) : ('hidden' as const),
          overflowY: 'hidden' as const,
          paintOffsetX: 0,
          paintOffsetY: 0,
          viewport: { height: 18, offsetX: 0, offsetY: 0, width: 12 },
          width: 12
        },
        pixelCount: 200,
        width: isScroll ? 35 : 45
      };
    });
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          const overflow = 'auto' === element.getAttribute('data-overflow') ? 'auto' : 'hidden';
          return declaration({
            display: 'inline-block',
            height: '18px',
            'overflow-x': overflow,
            'overflow-y': 'hidden',
            width: '12px'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/"]')];
    expect(images).toHaveLength(2);
    const scrollStyle = images[0]?.parentElement?.getAttribute('style') ?? '';
    expect(scrollStyle).toContain('width:12px!important');
    expect(scrollStyle).toContain('height:18px!important');
    expect(scrollStyle).toContain('overflow-x:auto!important');
    expect(scrollStyle).toContain('overflow-y:hidden!important');
    expect(images[0]?.getAttribute('style')).toContain('width:35px');
    expect(images[0]?.getAttribute('style')).toContain('left:0px');
    expect(images[0]?.parentElement?.parentElement?.getAttribute('style')).toContain('height:22px!important');
    expect(images[0]?.parentElement?.parentElement?.getAttribute('style')).toContain('vertical-align:-4px!important');
    const clipStyle = images[1]?.parentElement?.getAttribute('style') ?? '';
    expect(clipStyle).toContain('width:12px!important');
    expect(clipStyle).toContain('height:18px!important');
    expect(clipStyle).toContain('overflow-x:hidden!important');
    expect(clipStyle).toContain('overflow-y:hidden!important');
    expect(clipStyle).not.toContain('overflow:visible!important');
    expect(images[1]?.getAttribute('style')).toContain('width:45px');
  });

  it.each([
    ['missing', undefined],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['below the baseline bound', -(MAX_WECHAT_PNG_DIMENSION + 1)],
    ['above the baseline bound', MAX_WECHAT_PNG_DIMENSION + 1]
  ])('rejects inline PNGs with a %s measured baseline before upload', async (_label, baselinePosition) => {
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<p>before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">formula</span></span></span> after</p>';
    const root = preview.querySelector('.easymde-math-inline');
    if (!root) throw new Error('inline math root missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 12, width: 24 })
    });
    const rasterize = vi.fn(async () => ({
      file: new File(['inline'], 'inline.png', { type: 'image/png' }),
      height: 12,
      ...(undefined === baselinePosition
        ? {}
        : { inlineLayout: { baseline: baselinePosition, height: 12, paintOffsetX: 0, paintOffsetY: 0, width: 24 } }),
      pixelCount: 200,
      width: 24
    }));
    const upload = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({ display: 'inline' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
    expect(committed).toBe(false);
  });

  it('allows a natural math extent exactly at the PNG edge bound', async () => {
    const requests: number[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const rasterize = vi.fn(async ({ width }: { width: number }) => {
      requests.push(width);
      return {
        file: new File(['png'], 'math.png', { type: 'image/png' }),
        height: 30,
        pixelCount: 200,
        width: MAX_WECHAT_PNG_DIMENSION
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/math.png'
    }));
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math"><span class="katex"><span class="katex-html">edge formula</span></span></div>';
    const math = preview.querySelector('.easymde-math');
    if (!math) throw new Error('math root missing');
    Object.defineProperties(math, {
      getBoundingClientRect: { configurable: true, value: () => ({ height: 30, width: 180 }) },
      scrollHeight: { configurable: true, value: 30 },
      scrollWidth: { configurable: true, value: MAX_WECHAT_PNG_DIMENSION }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math')) {
          return declaration({ display: 'block', height: '30px', overflow: 'auto', width: '180px' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(requests).toEqual([180]);
    expect(upload).toHaveBeenCalledOnce();
  });

  it('converts and uploads 10 rendered Mermaid roots in the category fixture', async () => {
    // Parser/category execution is covered by the authorized browser fixture;
    // this unit test verifies the resulting rendered-root upload path.
    const mermaidCategories = [
      'flowchart',
      'sequenceDiagram',
      'pie',
      'gantt',
      'classDiagram',
      'stateDiagram-v2',
      'erDiagram',
      'mindmap',
      'timeline',
      'xychart-beta'
    ];
    const writes: unknown[] = [];
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    let uploadIndex = 0;
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: `https://example.test/mermaid-${++uploadIndex}.png`
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn((items) => {
        writes.push(items);
        return Promise.resolve();
      })
    });
    const preview = readyPreview();
    preview.innerHTML = mermaidCategories
      .map(
        (category) =>
          `<div class="easymde-mermaid" data-category="${category}"><svg width="20" height="10"></svg></div>`
      )
      .join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(rasterize).toHaveBeenCalledTimes(mermaidCategories.length);
    expect(upload).toHaveBeenCalledTimes(mermaidCategories.length);
    const item = (writes[0] as { payload: Record<string, Blob> }[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('img[src^="https://example.test/mermaid-"]')).toHaveLength(mermaidCategories.length);
    expect(holder.querySelectorAll('svg')).toHaveLength(0);
  });

  it('accepts exactly 32 rendered Mermaid roots in one conversion transaction', async () => {
    const renderedRootCount = 32;
    expect(MAX_WECHAT_PNG_VISUALS).toBe(renderedRootCount);
    const writes: unknown[] = [];
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    let uploadIndex = 0;
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: `https://example.test/mermaid-${++uploadIndex}.png`
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn((items) => {
        writes.push(items);
        return Promise.resolve();
      })
    });
    const preview = readyPreview();
    preview.innerHTML = Array.from(
      { length: renderedRootCount },
      (_, index) =>
        `<div class="easymde-mermaid"><svg width="20" height="10"><title>Root ${index + 1}</title></svg></div>`
    ).join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(rasterize).toHaveBeenCalledTimes(renderedRootCount);
    expect(upload).toHaveBeenCalledTimes(renderedRootCount);
    const item = (writes[0] as { payload: Record<string, Blob> }[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('img[src^="https://example.test/mermaid-"]')).toHaveLength(renderedRootCount);
    expect(holder.querySelectorAll('svg')).toHaveLength(0);
  });

  it('keeps rasterization serial, limits PNG uploads to three, and replaces visuals in DOM order', async () => {
    const writes: unknown[] = [];
    let activeUploads = 0;
    let maximumActiveUploads = 0;
    type Uploaded = Readonly<{ alt: string; status: 'uploaded'; title: string; url: string }>;
    const pendingUploads: Array<Readonly<{ resolve: (url: string) => void }>> = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const rasterize = vi.fn(async () => {
      const index = rasterize.mock.calls.length;
      return {
        file: new File([`png-${index}`], `visual-${index}.png`, { type: 'image/png' }),
        height: 10,
        pixelCount: 200,
        width: 20
      };
    });
    const upload = vi.fn(
      ({ signal }: { signal: AbortSignal }): Promise<Uploaded> =>
        new Promise<Uploaded>((resolve, reject) => {
          let settled = false;
          activeUploads += 1;
          maximumActiveUploads = Math.max(maximumActiveUploads, activeUploads);
          const settle = (callback: () => void): void => {
            if (settled) return;
            settled = true;
            activeUploads -= 1;
            signal.removeEventListener('abort', abort);
            callback();
          };
          const abort = (): void => settle(() => reject(new Error('aborted')));
          signal.addEventListener('abort', abort, { once: true });
          pendingUploads.push({
            resolve: (url) => settle(() => resolve({ alt: '', status: 'uploaded', title: '', url }))
          });
        })
    );
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn((items) => {
        writes.push(items);
        return Promise.resolve();
      })
    });
    const preview = readyPreview();
    preview.innerHTML = Array.from(
      { length: 4 },
      (_, index) => `<div class="easymde-mermaid"><svg width="20" height="10"><title>Root ${index}</title></svg></div>`
    ).join('');

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(MAX_WECHAT_PNG_UPLOAD_CONCURRENCY));
    expect(rasterize).toHaveBeenCalledTimes(MAX_WECHAT_PNG_UPLOAD_CONCURRENCY);
    pendingUploads[1]?.resolve('https://example.test/visual-1.png');
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(4));
    pendingUploads[2]?.resolve('https://example.test/visual-2.png');
    pendingUploads[3]?.resolve('https://example.test/visual-3.png');
    pendingUploads[0]?.resolve('https://example.test/visual-0.png');

    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(maximumActiveUploads).toBe(MAX_WECHAT_PNG_UPLOAD_CONCURRENCY);
    expect(activeUploads).toBe(0);
    expect(rasterize).toHaveBeenCalledTimes(4);
    expect(upload).toHaveBeenCalledTimes(4);
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect([...holder.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual([
      'https://example.test/visual-0.png',
      'https://example.test/visual-1.png',
      'https://example.test/visual-2.png',
      'https://example.test/visual-3.png'
    ]);
  });

  it('aborts remaining PNG uploads and publishes no partial Clipboard payload after upload failure', async () => {
    let committed = false;
    let abortedUploads = 0;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(({ signal }: { signal: AbortSignal }) => {
      signal.addEventListener(
        'abort',
        () => {
          abortedUploads += 1;
        },
        { once: true }
      );
      if (3 === upload.mock.calls.length) {
        return Promise.resolve({ alt: '', status: 'failed' as const });
      }
      return new Promise<never>(() => {});
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });
    const preview = readyPreview();
    preview.innerHTML = Array.from(
      { length: 3 },
      () => '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ).join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledTimes(3);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(abortedUploads).toBeGreaterThanOrEqual(2);
    expect(committed).toBe(false);
  });

  it('reports a single preflight nonce rejection without residual uploads or retry', async () => {
    let committed = false;
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(
      async () => ({ code: 'easymde_rest_invalid_image_hosting_nonce', sideEffects: 'none', status: 'failed' }) as never
    );
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-upload-nonce-invalid',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
    expect(committed).toBe(false);
  });

  it('keeps residual-upload reporting when the upload provider rejects', async () => {
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(async () => {
      throw new Error('synthetic network failure');
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(upload).toHaveBeenCalledOnce();
  });

  it('keeps residual-upload reporting when a successful upload precedes nonce rejection', async () => {
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], `visual-${rasterize.mock.calls.length}.png`, { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(async () => {
      if (1 === upload.mock.calls.length) {
        return { alt: '', status: 'uploaded' as const, title: '', url: 'https://example.test/visual.png' };
      }
      return { code: 'easymde_rest_invalid_image_hosting_nonce', sideEffects: 'none', status: 'failed' } as never;
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });
    const preview = readyPreview();
    preview.innerHTML = [
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>',
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ].join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-upload-nonce-invalid',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(committed).toBe(false);
  });

  it('keeps residual-upload reporting when a nonce rejection races a pending upload', async () => {
    let committed = false;
    const firstUpload = deferred<never>();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], `visual-${rasterize.mock.calls.length}.png`, { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(({ signal }: { signal: AbortSignal }) => {
      if (1 === upload.mock.calls.length) {
        signal.addEventListener('abort', () => undefined, { once: true });
        return firstUpload.promise;
      }
      return Promise.resolve({
        code: 'easymde_rest_invalid_image_hosting_nonce',
        sideEffects: 'none',
        status: 'failed'
      } as never);
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });
    const preview = readyPreview();
    preview.innerHTML = [
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>',
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ].join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-upload-nonce-invalid',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(committed).toBe(false);
  });

  it('reports rasterization timeout without residual uploads when timeout occurs before upload', async () => {
    vi.useFakeTimers();
    try {
      const pendingRasterization = deferred<WechatVisualRasterizationResult>();
      const rasterize = vi.fn(() => pendingRasterization.promise);
      const upload = vi.fn();
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: class {
          constructor(public payload: Record<string, Blob>) {}
        },
        document,
        getComputedStyle: computedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: vi.fn(() => Promise.resolve())
      });
      const preview = readyPreview();
      preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

      const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(WECHAT_PNG_TRANSACTION_TIMEOUT_MS);

      await expect(copy).resolves.toEqual({
        code: 'wechat-png-rasterization-timeout',
        sideEffects: 'none',
        status: 'failed'
      });
      expect(rasterize).toHaveBeenCalledOnce();
      expect(upload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports transaction timeout without residual uploads when no upload started', async () => {
    vi.useFakeTimers();
    try {
      const upload = vi.fn();
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: class {
          constructor(public payload: Record<string, Blob>) {}
        },
        document,
        getComputedStyle: computedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: vi.fn(() => new Promise<void>(() => undefined))
      });
      const preview = readyPreview();

      const copy = clipboard.copy(preview, pngOptions({ rasterize: vi.fn() }, { upload } as never));
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(WECHAT_PNG_TRANSACTION_TIMEOUT_MS);

      await expect(copy).resolves.toEqual({
        code: 'wechat-png-transaction-timeout',
        sideEffects: 'none',
        status: 'failed'
      });
      expect(upload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails the conversion gate while a later rasterization is pending after upload failure', async () => {
    let committed = false;
    let abortedSecondUpload = false;
    let abortedThirdRasterization = false;
    const firstUploadFailure = deferred<{ alt: string; status: 'failed' }>();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(({ signal }: { signal: AbortSignal }) => {
      if (3 > rasterize.mock.calls.length) {
        return Promise.resolve({
          file: new File(['png'], `visual-${rasterize.mock.calls.length}.png`, { type: 'image/png' }),
          height: 10,
          pixelCount: 200,
          width: 20
        });
      }
      return new Promise<never>((_resolve, reject) => {
        const abort = (): void => {
          abortedThirdRasterization = true;
          reject(new Error('rasterization-aborted'));
        };
        signal.addEventListener('abort', abort, { once: true });
      });
    });
    const upload = vi.fn(({ signal }: { signal: AbortSignal }) => {
      if (1 === upload.mock.calls.length) return firstUploadFailure.promise;
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            abortedSecondUpload = true;
            reject(new Error('upload-aborted'));
          },
          { once: true }
        );
      });
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });
    const preview = readyPreview();
    preview.innerHTML = Array.from(
      { length: 3 },
      () => '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ).join('');

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledTimes(3));
    firstUploadFailure.resolve({ alt: '', status: 'failed' });

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(abortedSecondUpload).toBe(true);
    expect(abortedThirdRasterization).toBe(true);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(committed).toBe(false);
  });

  it('fails while a later native capture clone is yielding after upload failure', async () => {
    let firstUploadStarted = false;
    let captureStarted = false;
    let abortedFirstUpload = false;
    const firstUploadFailure = deferred<{ alt: string; status: 'failed' }>();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(({ signal }: { signal: AbortSignal }) => {
      if (1 === upload.mock.calls.length) {
        firstUploadStarted = true;
        signal.addEventListener(
          'abort',
          () => {
            abortedFirstUpload = true;
          },
          { once: true }
        );
        return firstUploadFailure.promise;
      }
      return Promise.resolve({ alt: '', status: 'uploaded' as const, title: '', url: 'https://example.test/late.png' });
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (
          !pseudoElement &&
          firstUploadStarted &&
          element.classList.contains('easymde-mermaid') &&
          element.textContent?.includes('second')
        ) {
          captureStarted = true;
          firstUploadFailure.resolve({ alt: '', status: 'failed' });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
      })
    });
    const preview = readyPreview();
    preview.innerHTML = [
      '<div class="easymde-mermaid"><svg width="20" height="10"><title>first</title></svg></div>',
      '<div class="easymde-mermaid"><svg width="20" height="10"><title>second</title></svg></div>'
    ].join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(captureStarted).toBe(true);
    expect(abortedFirstUpload).toBe(true);
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
  });

  it('cancels in-flight PNG uploads and rejects the deferred payload without committing', async () => {
    const controller = new AbortController();
    let committed = false;
    let abortedUploads = 0;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(({ signal }: { signal: AbortSignal }) => {
      signal.addEventListener(
        'abort',
        () => {
          abortedUploads += 1;
        },
        { once: true }
      );
      return new Promise<never>(() => {});
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });
    const preview = readyPreview();
    preview.innerHTML = Array.from(
      { length: 2 },
      () => '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ).join('');

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never, { signal: controller.signal }));
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(abortedUploads).toBe(2);
    expect(committed).toBe(false);
  });

  it('rejects more than the maximum candidates before rasterization or upload', async () => {
    const rasterize = vi.fn();
    const upload = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = Array.from(
      { length: MAX_WECHAT_PNG_VISUALS + 1 },
      () => '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ).join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-limit-exceeded',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports uploads that may remain when a later visual fails', async () => {
    const rasterize = vi
      .fn()
      .mockResolvedValueOnce({
        file: new File(['png'], 'first.png', { type: 'image/png' }),
        height: 10,
        pixelCount: 200,
        width: 20
      })
      .mockRejectedValueOnce(new Error('second-rasterizer-failed'));
    const upload = vi
      .fn()
      .mockResolvedValue({ alt: '', status: 'uploaded' as const, title: '', url: 'https://example.test/first.png' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = [
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>',
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ].join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(upload).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'descendant text',
      (preview: HTMLElement) => {
        const visual = preview.querySelector('.easymde-mermaid');
        if (!visual) throw new Error('visual missing');
        visual.textContent = 'changed';
      }
    ],
    [
      'descendant refresh-named attribute',
      (preview: HTMLElement) => {
        const visual = preview.querySelector('.easymde-mermaid');
        if (!visual) throw new Error('visual missing');
        visual.setAttribute('data-easymde-preview-refreshing', '1');
      }
    ],
    [
      'root non-refresh attribute',
      (preview: HTMLElement) => {
        preview.setAttribute('data-copy-source', 'changed');
      }
    ]
  ])('rejects a %s mutation before the observer callback delivers its record', async (_, change) => {
    const pendingRasterization = deferred<{ file: File; height: number; pixelCount: number; width: number }>();
    const rasterize = vi.fn(() => pendingRasterization.promise);
    const upload = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';
    const visual = preview.querySelector('.easymde-mermaid');
    if (!visual) throw new Error('visual missing');
    Object.defineProperty(visual, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 })
    });

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    change(preview);
    pendingRasterization.resolve({
      file: new File(['png'], 'stale.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    });

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps a PNG copy current after a same-value source attribute mutation', async () => {
    const pendingRasterization = deferred<{ file: File; height: number; pixelCount: number; width: number }>();
    const rasterize = vi.fn(() => pendingRasterization.promise);
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/visual.png'
    }));
    const write = vi.fn(() => Promise.resolve());
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    preview.setAttribute('data-easymde-preview-html-sink', 'true');
    pendingRasterization.resolve({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    });

    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(upload).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
  });

  it('rejects a live Preview mutation discovered at the final serialization check', async () => {
    let mutateOnSourceTextRead = true;
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      get: () => {
        if (mutateOnSourceTextRead) {
          mutateOnSourceTextRead = false;
          preview.setAttribute('data-final-mutation', '1');
        }
        return 'Rendered';
      }
    });
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'visual.png',
      url: 'https://example.test/visual.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
  });

  it('disconnects freshness observation when an aborted PNG copy finishes late', async () => {
    const pendingRasterization = deferred<{ file: File; height: number; pixelCount: number; width: number }>();
    const rasterize = vi.fn(() => pendingRasterization.promise);
    const upload = vi.fn();
    const controller = new AbortController();
    const disconnect = vi.spyOn(window.MutationObserver.prototype, 'disconnect');
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never, { signal: controller.signal }));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    controller.abort();
    preview.setAttribute('data-late-mutation', '1');
    pendingRasterization.resolve({
      file: new File(['png'], 'late.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    });

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(upload).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
  });

  it('keeps a PNG copy current while only root Preview refresh flags change', async () => {
    const pendingRasterization = deferred<{ file: File; height: number; pixelCount: number; width: number }>();
    const rasterize = vi.fn(() => pendingRasterization.promise);
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/visual.png'
    }));
    const write = vi.fn(() => Promise.resolve());
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';
    const visual = preview.querySelector('.easymde-mermaid');
    if (!visual) throw new Error('visual missing');
    Object.defineProperty(visual, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 })
    });

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    preview.setAttribute('aria-busy', 'true');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.setAttribute('data-easymde-preview-accepted', '1');
    pendingRasterization.resolve({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    });

    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(upload).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
  });

  it('rejects stale no-candidate markup after asynchronous theme preparation', async () => {
    const imageUrl = new URL('/assets/images/fullstack-blue-h2.png', document.baseURI).href;
    const pendingFetch = deferred<Response>();
    const fetch = vi.fn(() => pendingFetch.promise);
    const rasterize = vi.fn();
    const upload = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          return declaration({ 'background-image': `url("${imageUrl}")`, display: 'block' });
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = '<p>Original</p><table><tbody><tr><td>Keep HTML</td></tr></tbody></table>';

    const copy = clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    preview.innerHTML = '<p>Replacement</p>';
    pendingFetch.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as Response);

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects an aborted no-candidate copy after asynchronous theme preparation', async () => {
    const imageUrl = new URL('/assets/images/fullstack-blue-h3.png', document.baseURI).href;
    const pendingFetch = deferred<Response>();
    const fetch = vi.fn(() => pendingFetch.promise);
    const rasterize = vi.fn();
    const upload = vi.fn();
    const controller = new AbortController();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          return declaration({ 'background-image': `url("${imageUrl}")`, display: 'block' });
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = '<p>Original</p><table><tbody><tr><td>Keep HTML</td></tr></tbody></table>';

    const copy = clipboard.copy(
      preview,
      pngOptions({ rasterize } as never, { upload } as never, { signal: controller.signal })
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    pendingFetch.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as Response);

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports the stable transaction timeout after an upload has started', async () => {
    vi.useFakeTimers();
    try {
      const pendingUpload = deferred<never>();
      const rasterize = vi.fn(async () => ({
        file: new File(['png'], 'pending.png', { type: 'image/png' }),
        height: 10,
        pixelCount: 200,
        width: 20
      }));
      const uploadSignals: AbortSignal[] = [];
      const upload = vi.fn(({ signal }: { signal: AbortSignal }) => {
        uploadSignals.push(signal);
        return pendingUpload.promise;
      });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: class {
          constructor(public payload: Record<string, Blob>) {}
        },
        document,
        getComputedStyle: computedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: vi.fn(() => Promise.resolve())
      });
      const preview = readyPreview();
      preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';
      const visual = preview.querySelector('.easymde-mermaid');
      if (!visual) throw new Error('visual missing');
      Object.defineProperty(visual, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 10, width: 20 })
      });

      const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
      expect(uploadSignals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(WECHAT_PNG_TRANSACTION_TIMEOUT_MS);

      await expect(copy).resolves.toEqual({
        code: 'wechat-png-transaction-timeout',
        sideEffects: 'uploads-may-remain',
        status: 'failed'
      });
      expect(uploadSignals[0]?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects pending, failed, or empty preview surfaces before touching Clipboard', async () => {
    const write = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write,
      pageOffset: () => ({ x: 0, y: 0 })
    });
    const preview = readyPreview();
    preview.setAttribute('aria-busy', 'true');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.removeAttribute('data-easymde-preview-accepted');

    await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-preview-unavailable', status: 'failed' });
    expect(write).not.toHaveBeenCalled();
  });

  it('copies the previously accepted Preview while its replacement is refreshing', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });
    const preview = readyPreview();
    preview.setAttribute('aria-busy', 'true');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.setAttribute('data-easymde-preview-accepted', '1');

    await expect(clipboard.copy(preview)).resolves.toMatchObject({ status: 'copied' });
    expect(writes).toHaveLength(1);
  });

  it('reuses the prepared legacy payload when only refresh attributes change', async () => {
    const preview = readyPreview();
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    await prepareClipboard(clipboard, preview);
    preview.setAttribute('aria-busy', 'true');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.setAttribute('data-easymde-preview-accepted', '1');

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it.each([
    ['root style', (preview: HTMLElement) => preview.setAttribute('style', 'color: red')],
    [
      'descendant text',
      (preview: HTMLElement) => {
        const paragraph = preview.querySelector('p');
        if (!paragraph) throw new Error('paragraph missing');
        paragraph.textContent = 'Replaced';
      }
    ],
    [
      'descendant class',
      (preview: HTMLElement) => {
        const paragraph = preview.querySelector('p');
        if (!paragraph) throw new Error('paragraph missing');
        paragraph.classList.add('changed');
      }
    ],
    [
      'descendant refresh-named attribute',
      (preview: HTMLElement) => {
        const paragraph = preview.querySelector('p');
        if (!paragraph) throw new Error('paragraph missing');
        paragraph.setAttribute('data-easymde-preview-refreshing', '1');
      }
    ]
  ])('invalidates a prepared legacy payload after %s changes', async (_, change) => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const preview = readyPreview();
    await prepareClipboard(clipboard, preview);
    change(preview);

    await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('rejects an accepted windowed Preview during refresh before resolving materialization', async () => {
    const write = vi.fn();
    const resolvePreview = vi.fn(async () => null);
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    const preview = readyPreview();
    preview.setAttribute('aria-busy', 'true');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.setAttribute('data-easymde-preview-accepted', '1');
    const spacer = document.createElement('div');
    spacer.setAttribute('data-easymde-preview-window-spacer', '1');
    preview.append(spacer);

    await expect(clipboard.copy(preview, { resolvePreview })).resolves.toEqual({
      code: 'wechat-preview-unavailable',
      status: 'failed'
    });
    expect(resolvePreview).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('writes sanitized styled HTML and plain text through the modern Clipboard API', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(readyPreview())).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    expect(item).toBeDefined();
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    expect(htmlBlob).toBeDefined();
    expect(textBlob).toBeDefined();
    if (!htmlBlob || !textBlob) throw new Error('clipboard payload missing');
    const html = await blobText(htmlBlob);
    const text = await blobText(textBlob);
    expect(html).toContain('Rendered');
    expect(html).toContain('max-width:100%');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('private-id');
    expect(html).not.toContain('theme-class');
    expect(html).not.toContain('data-easymde-');
    expect(text).toBe('Rendered');
  });

  it('marks only owned table, math, and code scroll containers across modern and legacy payloads', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.setAttribute('data-ignore-width', 'untrusted-root');
    preview.innerHTML = [
      '<p data-ignore-width="untrusted">Before</p>',
      '<table data-ignore-width="untrusted-table"><tbody><tr><td>Table</td></tr></tbody></table>',
      '<div class="easymde-math-block" data-ignore-width="untrusted-math"><span class="katex"><span class="katex-html">Math</span></span></div>',
      '<pre data-ignore-width="untrusted-pre"><code data-ignore-width="untrusted-code">Code</code></pre>',
      '<code data-ignore-width="untrusted-standalone-code">Standalone code</code>',
      '<section class="unowned-overflow" data-ignore-width="untrusted-overflow" style="overflow:auto">Unowned overflow</section>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Before\nTable\nMath\nCode\nStandalone code\nUnowned overflow'
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const modernWrites: ClipboardItemStub[] = [];
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: computedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items[0] as ClipboardItemStub);
    });

    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernHtmlBlob = modernWrites[0]?.payload['text/html'];
    const modernTextBlob = modernWrites[0]?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('modern payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(await blobText(modernTextBlob)).toBe('Before\nTable\nMath\nCode\nStandalone code\nUnowned overflow');

    const assertOwnedMarkers = (html: string): void => {
      const holder = document.createElement('div');
      holder.innerHTML = html;
      expect(holder.textContent).toContain('Standalone code');
      expect(holder.textContent).toContain('Unowned overflow');
      const markers = [...holder.querySelectorAll('[data-ignore-width]')];
      expect(markers).toHaveLength(3);
      expect(markers.every((element) => element.getAttribute('data-ignore-width') === '')).toBe(true);
      expect(holder.querySelectorAll('section[data-ignore-width]')).toHaveLength(2);
      expect(holder.querySelectorAll('section[data-ignore-width] table')).toHaveLength(1);
      expect(holder.querySelectorAll('section[data-ignore-width] img')).toHaveLength(0);
      expect(holder.querySelectorAll('pre > code[data-ignore-width]')).toHaveLength(1);
      expect(holder.querySelectorAll('pre[data-ignore-width]')).toHaveLength(0);
      expect(holder.querySelectorAll('table[data-ignore-width]')).toHaveLength(0);
      expect(holder.querySelectorAll('code[data-ignore-width]')).toHaveLength(1);
      expect(holder.firstElementChild?.hasAttribute('data-ignore-width')).toBe(false);
      expect(holder.querySelector('[data-ignore-width="untrusted"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-table"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-math"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-pre"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-code"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-standalone-code"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-overflow"]')).toBeNull();
    };
    assertOwnedMarkers(modernHtml);

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacy = createRuntime(null, null);
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    expect(legacyHtml).toBe(modernHtml);
    assertOwnedMarkers(legacyHtml);
    expect(preview.innerHTML).toBe(sourceMarkup);
    expect(preview.getAttribute('data-ignore-width')).toBe('untrusted-root');
  });

  it('maps logical text alignment to physical WeChat-compatible values', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p id="ltr-start">LTR start</p>',
      '<p id="rtl-start" dir="rtl">RTL start</p>',
      '<p id="rtl-end" dir="rtl">RTL end</p>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'LTR start\nRTL start\nRTL end' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' !== element.tagName) return declaration({ display: 'block' });
        return declaration({
          display: 'block',
          direction: element.id.startsWith('rtl') ? 'rtl' : 'ltr',
          'text-align': element.id.endsWith('end') ? 'end' : 'start'
        });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const paragraphs = holder.querySelectorAll('section p');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]?.getAttribute('style')).toContain('text-align:left');
    expect(paragraphs[1]?.getAttribute('style')).toContain('text-align:right');
    expect(paragraphs[2]?.getAttribute('style')).toContain('text-align:left');
  });

  it('projects root paper styles through the marked CSSOM context only', async () => {
    const writes: unknown[] = [];
    let sawMarkedRoot = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="theme-child">Theme child</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme child' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
        const marked = '1' === element.getAttribute('data-easymde-wechat-export-style-context');
        if (element.classList.contains('easymde-preview')) {
          if (raw && marked) sawMarkedRoot = true;
          return declaration({
            background: raw && marked ? 'rgb(247, 248, 250)' : 'rgb(255, 255, 255)',
            color: 'rgb(1, 2, 3)',
            display: 'block',
            'padding-bottom': raw && marked ? '0px' : '28px',
            'padding-left': raw && marked ? '0px' : '28px',
            'padding-right': raw && marked ? '0px' : '28px',
            'padding-top': raw && marked ? '0px' : '22px'
          });
        }
        if (element.classList.contains('theme-child')) {
          return declaration({ color: 'rgb(9, 9, 9)', display: 'block', 'margin-top': '12px' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const rootStyle = holder.firstElementChild?.getAttribute('style') ?? '';
    const childStyle = holder.querySelector('p')?.getAttribute('style') ?? '';
    expect(sawMarkedRoot).toBe(true);
    expect(rootStyle).toContain('background:rgb(247, 248, 250)');
    expect(rootStyle).not.toContain('padding-top:22px');
    expect(rootStyle).not.toContain('background:rgb(255, 255, 255)');
    expect(childStyle).toContain('color:rgb(9, 9, 9)');
    expect(holder.querySelector('[data-easymde-wechat-export-style-context="1"]')).toBeNull();
  });

  it('refreshes projected root styles when a warm paper context changes', async () => {
    const writes: unknown[] = [];
    const paperPadding = '28px';
    let projectedPadding = '24px';
    let themeBackground = 'rgb(247, 248, 250)';
    let markedRootReads = 0;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="theme-child">Warm content</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Warm content' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const marked = '1' === element.getAttribute('data-easymde-wechat-export-style-context');
        if (element.classList.contains('easymde-preview')) {
          if (marked) markedRootReads += 1;
          return declaration({
            background: marked ? themeBackground : 'rgb(255, 255, 255)',
            'background-color': marked ? themeBackground : 'rgb(255, 255, 255)',
            color: 'rgb(1, 2, 3)',
            display: 'block',
            'padding-bottom': marked ? projectedPadding : paperPadding,
            'padding-left': marked ? projectedPadding : paperPadding,
            'padding-right': marked ? projectedPadding : paperPadding,
            'padding-top': marked ? projectedPadding : paperPadding
          });
        }
        if (element.classList.contains('theme-child')) {
          return declaration({ color: 'rgb(9, 9, 9)', display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const clipboardHtml = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('clipboard html missing');
      return blobText(htmlBlob);
    };

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const firstHtml = await clipboardHtml(0);
    expect(firstHtml).toContain('background:rgb(247, 248, 250)');
    expect(firstHtml).toContain('padding-top:24px');
    expect(firstHtml).not.toContain('padding-top:28px');

    projectedPadding = '36px';
    themeBackground = 'rgb(240, 241, 242)';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const secondHtml = await clipboardHtml(1);
    expect(secondHtml).toContain('background:rgb(240, 241, 242)');
    expect(secondHtml).toContain('padding-top:36px');
    expect(secondHtml).not.toContain('padding-top:28px');
    expect(markedRootReads).toBeGreaterThanOrEqual(2);
  });

  it('does not reuse an older projected root in synchronous legacy fallback', async () => {
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Legacy projection</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Legacy projection' });
    let projectedPadding = '24px';
    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    class ThrowingClipboardItem {
      constructor() {
        throw new Error('clipboard-item-constructor-failed');
      }
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ThrowingClipboardItem,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const marked = '1' === element.getAttribute('data-easymde-wechat-export-style-context');
        if (element.classList.contains('easymde-preview')) {
          return declaration({
            background: marked ? 'rgb(247, 248, 250)' : 'rgb(255, 255, 255)',
            'background-color': marked ? 'rgb(247, 248, 250)' : 'rgb(255, 255, 255)',
            color: 'rgb(1, 2, 3)',
            display: 'block',
            'padding-bottom': marked ? projectedPadding : '28px',
            'padding-left': marked ? projectedPadding : '28px',
            'padding-right': marked ? projectedPadding : '28px',
            'padding-top': marked ? projectedPadding : '28px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn()
    });

    try {
      await prepareClipboard(clipboard, preview);
      projectedPadding = '36px';
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toContain('padding-top:36px');
      expect(legacyHtml).not.toContain('padding-top:28px');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('rejects a projected root change during serialization', async () => {
    const writes: unknown[] = [];
    let markedNormalReads = 0;
    let themeBackground = 'rgb(247, 248, 250)';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Changing projection</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Changing projection' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const marked = '1' === element.getAttribute('data-easymde-wechat-export-style-context');
        if (element.classList.contains('easymde-preview')) {
          if (marked) {
            markedNormalReads += 1;
            if (5 === markedNormalReads) themeBackground = 'rgb(240, 241, 242)';
          }
          const style = declaration({
            background: marked ? themeBackground : 'rgb(255, 255, 255)',
            'background-color': marked ? themeBackground : 'rgb(255, 255, 255)',
            color: 'rgb(1, 2, 3)',
            display: 'block',
            'padding-bottom': '28px',
            'padding-left': '28px',
            'padding-right': '28px',
            'padding-top': '28px'
          });
          return style;
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const result = await clipboard.copy(preview);
    expect(markedNormalReads).toBeGreaterThanOrEqual(5);
    expect(result).toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writes).toHaveLength(1);
  });

  it('invalidates a warm payload after a direction-only change with unchanged geometry', async () => {
    const writes: unknown[] = [];
    let direction = 'ltr';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Direction only</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Direction only' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          return declaration({ display: 'block', direction, 'text-align': 'start' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await prepareClipboard(clipboard, preview);
    direction = 'rtl';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('direction payload missing');
    expect(await blobText(htmlBlob)).toContain('text-align:right');
  });

  it('invalidates a warm payload after a root pseudo box-sizing change with unchanged geometry', async () => {
    const writes: unknown[] = [];
    let boxSizing = 'content-box';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Root pseudo</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Root pseudo' });
    const clipboardRuntimeStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (
        ('1' === element.getAttribute('data-easymde-wechat-export-style-context') || element === preview) &&
        '::before' === pseudoElement
      ) {
        return declaration({
          'background-color': 'rgb(9, 10, 11)',
          'box-sizing': boxSizing,
          color: 'rgb(12, 13, 14)',
          content: '""',
          display: 'block',
          height: '8px',
          'padding-bottom': '2px',
          'padding-left': '2px',
          'padding-right': '3px',
          'padding-top': '1px',
          width: '10px'
        });
      }
      if (pseudoElement) return declaration({});
      return declaration({ display: 'block' });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: clipboardRuntimeStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await prepareClipboard(clipboard, preview);
    boxSizing = 'border-box';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('root pseudo payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const markerStyle = holder.querySelector('section > span[aria-hidden="true"]')?.getAttribute('style') ?? '';
    expect(markerStyle).toContain('width:10px');
    expect(markerStyle).toContain('height:8px');
    expect(markerStyle).toContain('background-color:rgb(9, 10, 11)');
    expect(markerStyle).toContain('color:rgb(12, 13, 14)');
    expect(markerStyle).not.toContain('width:17px');
    expect(markerStyle).not.toContain('height:11px');

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacyClipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: clipboardRuntimeStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    try {
      await prepareClipboard(legacyClipboard, preview);
      await expect(legacyClipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toContain('width:10px');
      expect(legacyHtml).toContain('height:8px');
      expect(legacyHtml).toContain('background-color:rgb(9, 10, 11)');
      expect(legacyHtml).toContain('color:rgb(12, 13, 14)');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('projects content-box dimensions for a border-box paste destination', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p class="content-box">Flow content</p>',
      '<p class="intrinsic">Intrinsic content</p>',
      '<p class="border-box">Border box content</p>',
      '<p class="decorated">Decorated content</p>',
      '<svg><rect width="40" height="20"></rect></svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Flow content\nIntrinsic content\nBorder box content\nDecorated content'
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement && element.classList.contains('decorated')) {
          return declaration({
            content: '""',
            display: 'block',
            'box-sizing': 'content-box',
            width: '10px',
            height: '8px',
            'padding-left': '2px',
            'padding-right': '3px',
            'padding-top': '1px',
            'padding-bottom': '2px',
            'border-left-width': '1px',
            'border-right-width': '1px',
            'border-top-width': '1px',
            'border-bottom-width': '1px'
          });
        }
        if ('svg' === element.localName.toLowerCase()) {
          return declaration({ display: 'inline-block', 'box-sizing': 'content-box', width: '40px', height: '20px' });
        }
        if (!pseudoElement && element.classList.contains('content-box')) {
          return declaration({
            display: 'block',
            'box-sizing': 'content-box',
            width: '100px',
            height: '20px',
            'min-width': '40px',
            'max-width': '180px',
            'min-height': '12px',
            'max-height': '60px',
            'padding-left': '12px',
            'padding-right': '8px',
            'padding-top': '5px',
            'padding-bottom': '7px',
            'border-left-width': '2px',
            'border-right-width': '3px',
            'border-top-width': '1px',
            'border-bottom-width': '2px'
          });
        }
        if (!pseudoElement && element.classList.contains('intrinsic')) {
          return declaration({
            display: 'block',
            'box-sizing': 'content-box',
            width: 'auto',
            height: 'auto',
            'padding-left': '12px',
            'padding-right': '8px',
            'padding-top': '5px',
            'padding-bottom': '7px'
          });
        }
        if (!pseudoElement && element.classList.contains('border-box')) {
          return declaration({
            display: 'block',
            'box-sizing': 'border-box',
            width: '90px',
            height: '30px',
            'padding-left': '12px',
            'padding-right': '8px',
            'padding-top': '5px',
            'padding-bottom': '7px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const paragraphs = holder.querySelectorAll('section p');
    expect(paragraphs).toHaveLength(4);
    const contentBoxStyle = paragraphs[0]?.getAttribute('style') ?? '';
    expect(contentBoxStyle).toContain('box-sizing:border-box');
    expect(contentBoxStyle).toContain('width:125px');
    expect(contentBoxStyle).toContain('height:35px');
    expect(contentBoxStyle).toContain('min-width:65px');
    expect(contentBoxStyle).toContain('max-width:205px');
    expect(contentBoxStyle).toContain('min-height:27px');
    expect(contentBoxStyle).toContain('max-height:75px');

    const intrinsicStyle = paragraphs[1]?.getAttribute('style') ?? '';
    expect(intrinsicStyle).toContain('box-sizing:border-box');
    expect(intrinsicStyle).toContain('width:auto');
    expect(intrinsicStyle).toContain('height:auto');

    const borderBoxStyle = paragraphs[2]?.getAttribute('style') ?? '';
    expect(borderBoxStyle).toContain('box-sizing:border-box');
    expect(borderBoxStyle).toContain('width:90px');
    expect(borderBoxStyle).toContain('height:30px');

    const pseudoStyle = paragraphs[3]?.querySelector('span')?.getAttribute('style') ?? '';
    expect(pseudoStyle).toContain('box-sizing:border-box');
    expect(pseudoStyle).toContain('width:17px');
    expect(pseudoStyle).toContain('height:13px');

    const svgStyle = holder.querySelector('svg')?.getAttribute('style') ?? '';
    expect(svgStyle).toContain('box-sizing:content-box');
    expect(svgStyle).toContain('width:40px');
    expect(svgStyle).toContain('height:20px');
  });

  it('promotes only eligible raw percentage content-box bounds in both Clipboard paths', async () => {
    type DimensionCase = Readonly<{
      boxSizing?: string;
      display?: string;
      float?: string;
      height?: string;
      maxHeight?: string;
      maxWidth?: string;
      minHeight?: string;
      minWidth?: string;
      paddingBottom?: string;
      paddingLeft?: string;
      paddingRight?: string;
      paddingTop?: string;
      position?: string;
      borderBottom?: string;
      borderLeft?: string;
      borderRight?: string;
      borderTop?: string;
      width?: string;
    }>;
    const eligibleHorizontal: DimensionCase = {
      boxSizing: 'content-box',
      display: 'block',
      float: 'none',
      height: '120px',
      maxHeight: '180px',
      maxWidth: '64%',
      minHeight: '40px',
      minWidth: '0%',
      paddingBottom: '0px',
      paddingLeft: '10px',
      paddingRight: '8px',
      paddingTop: '0px',
      position: 'static',
      borderBottom: '0px',
      borderLeft: '2px',
      borderRight: '3px',
      borderTop: '0px',
      width: '64%'
    };
    const eligibleVertical: DimensionCase = {
      ...eligibleHorizontal,
      height: '64%',
      maxHeight: 'none',
      maxWidth: 'none',
      paddingBottom: '7px',
      paddingLeft: '0px',
      paddingRight: '0px',
      paddingTop: '5px',
      borderBottom: '2px',
      borderLeft: '0px',
      borderRight: '0px',
      borderTop: '1px',
      width: 'auto'
    };
    const eligibleMaxNone: DimensionCase = { ...eligibleHorizontal, maxWidth: 'none', width: '80%' };
    const decimalPercentage: DimensionCase = {
      ...eligibleHorizontal,
      maxWidth: '.5%',
      minHeight: '1e-8px',
      minWidth: '1e-8%',
      paddingLeft: '1e-8px',
      width: '.5%'
    };
    const zeroEdge: DimensionCase = {
      ...eligibleHorizontal,
      maxWidth: '80%',
      paddingLeft: '0px',
      paddingRight: '0px',
      borderLeft: '0px',
      borderRight: '0px',
      width: '80%'
    };
    const invalidCalc: DimensionCase = { ...eligibleHorizontal, maxWidth: 'calc(80% - 1px)', width: '80%' };
    const invalidNegative: DimensionCase = { ...eligibleHorizontal, maxWidth: '80%', minWidth: '-1px', width: '80%' };
    const invalidUnit: DimensionCase = { ...eligibleHorizontal, maxWidth: '80vw', width: '80vw' };
    const cases: Record<string, DimensionCase> = {
      eligibleHorizontal,
      eligibleVertical,
      eligibleMaxNone,
      decimalPercentage,
      zeroEdge,
      invalidCalc,
      invalidNegative,
      invalidUnit,
      float: { ...eligibleHorizontal, float: 'left' },
      absolute: { ...eligibleHorizontal, position: 'absolute' },
      inline: { ...eligibleHorizontal, display: 'inline' },
      flex: { ...eligibleHorizontal, display: 'flex' },
      flexParent: { ...eligibleHorizontal, display: 'flex' },
      flexParentChild: eligibleHorizontal,
      gridParent: { ...eligibleHorizontal, display: 'grid' },
      gridParentChild: eligibleHorizontal,
      contentsParent: { ...eligibleHorizontal, display: 'contents' },
      contentsGridParent: { ...eligibleHorizontal, display: 'grid' },
      contentsGridChild: eligibleHorizontal,
      root: eligibleHorizontal,
      media: eligibleHorizontal,
      preCode: eligibleHorizontal,
      tableDescendant: eligibleHorizontal,
      svgDescendant: eligibleHorizontal,
      mermaidDescendant: eligibleHorizontal,
      mathDescendant: eligibleHorizontal,
      pseudo: eligibleHorizontal
    };
    const preview = document.createElement('article');
    preview.className = 'root';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p class="eligibleHorizontal">Horizontal</p>',
      '<p class="eligibleVertical">Vertical</p>',
      '<p class="eligibleMaxNone">Max none</p>',
      '<p class="decimalPercentage">Decimal</p>',
      '<p class="zeroEdge">Zero edge</p>',
      '<p class="invalidCalc">Calc</p>',
      '<p class="invalidNegative">Negative</p>',
      '<p class="invalidUnit">Unit</p>',
      '<p class="float">Float</p>',
      '<p class="absolute">Absolute</p>',
      '<p class="inline">Inline</p>',
      '<p class="flex">Flex</p>',
      '<p class="pseudo">Pseudo</p>',
      '<div class="flexParent"><p class="flexParentChild">Flex parent</p></div>',
      '<div class="gridParent"><p class="gridParentChild">Grid parent</p></div>',
      '<div class="contentsGridParent"><div class="contentsParent"><p class="contentsGridChild">Contents grid</p></div></div>',
      '<img class="media" src="https://example.test/box.png">',
      '<pre><code><span class="preCode">Pre code</span></code></pre>',
      '<table><tbody><tr><td class="tableDescendant">Table</td></tr></tbody></table>',
      '<svg><g class="svgDescendant">SVG</g></svg>',
      '<div class="easymde-mermaid"><svg width="20" height="10"><g class="mermaidDescendant">Mermaid</g></svg></div>',
      '<div class="easymde-math-block"><span class="mathDescendant">Math</span></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value:
        'Horizontal\nVertical\nMax none\nDecimal\nZero edge\nCalc\nNegative\nUnit\nFloat\nAbsolute\nInline\nFlex\nPseudo\nFlex parent\nGrid parent\nContents grid\nPre code\nTable\nSVG\nMermaid\nMath'
    });

    const findCase = (element: Element): DimensionCase | null => {
      for (const [className, candidate] of Object.entries(cases)) {
        if (element.classList.contains(className)) return candidate;
      }
      return null;
    };
    const styleFor = (element: Element, candidate: DimensionCase, root = false): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      const dimensions = raw
        ? candidate
        : {
            ...candidate,
            boxSizing: 'border-box',
            height: '176px',
            maxHeight: '176px',
            maxWidth: '274px',
            minHeight: '32px',
            minWidth: '40px',
            width: '274px'
          };
      return declaration({
        'border-bottom-width': dimensions.borderBottom ?? '0px',
        'border-left-width': dimensions.borderLeft ?? '0px',
        'border-right-width': dimensions.borderRight ?? '0px',
        'border-top-width': dimensions.borderTop ?? '0px',
        'box-sizing': dimensions.boxSizing ?? 'border-box',
        display: dimensions.display ?? 'block',
        float: dimensions.float ?? 'none',
        height: dimensions.height ?? 'auto',
        'max-height': dimensions.maxHeight ?? 'none',
        'max-width': dimensions.maxWidth ?? 'none',
        'min-height': dimensions.minHeight ?? 'auto',
        'min-width': dimensions.minWidth ?? 'auto',
        'padding-bottom': dimensions.paddingBottom ?? '0px',
        'padding-left': dimensions.paddingLeft ?? '0px',
        'padding-right': dimensions.paddingRight ?? '0px',
        'padding-top': dimensions.paddingTop ?? '0px',
        position: dimensions.position ?? 'static',
        width: dimensions.width ?? 'auto',
        ...(root ? { 'data-root-style': raw ? 'raw' : 'used' } : {})
      });
    };
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement && element.classList.contains('pseudo')) {
        return declaration({
          'border-left-width': '2px',
          'border-right-width': '2px',
          'box-sizing': 'content-box',
          content: '""',
          display: 'block',
          height: 'auto',
          'max-height': 'none',
          'max-width': '64%',
          'min-height': 'auto',
          'min-width': 'auto',
          'padding-left': '4px',
          'padding-right': '4px',
          position: 'static',
          width: '64%'
        });
      }
      if (element === preview) return styleFor(element, eligibleHorizontal, true);
      const candidate = findCase(element);
      if (candidate) return styleFor(element, candidate);
      return declaration({
        'box-sizing': 'border-box',
        display: 'block',
        height: 'auto',
        'max-height': 'none',
        'max-width': 'none',
        'min-height': 'auto',
        'min-width': 'auto',
        position: 'static',
        width: 'auto'
      });
    };
    Object.defineProperty(preview.querySelector('.pseudo'), 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 20, width: 120 })
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const writes: unknown[] = [];
    const modern = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });
    const sourceMarkup = preview.innerHTML;
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernPayload = modernItem?.payload['text/html'];
    if (!modernPayload) throw new Error('content-box priority HTML missing');
    const modernHtml = await blobText(modernPayload);

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }

    expect(legacyHtml).toBe(modernHtml);
    expect(preview.innerHTML).toBe(sourceMarkup);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const paragraphStyle = (text: string): string => {
      const paragraph = [...modernHolder.querySelectorAll('p')].find((element) => element.textContent?.trim() === text);
      if (!paragraph) throw new Error(`missing copied paragraph ${text}`);
      return paragraph.getAttribute('style') ?? '';
    };
    const horizontalStyle = paragraphStyle('Horizontal');
    expect(horizontalStyle).toContain('box-sizing:content-box!important');
    expect(horizontalStyle).toContain('width:64%');
    expect(horizontalStyle).toContain('min-width:0%');
    expect(horizontalStyle).toContain('max-width:64%!important');
    expect(horizontalStyle).toContain('height:120px');
    expect(horizontalStyle).toContain('min-height:40px');
    expect(horizontalStyle).toContain('max-height:180px');
    const verticalStyle = paragraphStyle('Vertical');
    expect(verticalStyle).toContain('box-sizing:content-box!important');
    expect(verticalStyle).toContain('width:auto');
    expect(verticalStyle).toContain('height:64%');
    expect(verticalStyle).toContain('max-height:none');
    expect(verticalStyle).toContain('max-width:none!important');
    const maxNoneStyle = paragraphStyle('Max none');
    expect(maxNoneStyle).toContain('width:80%');
    expect(maxNoneStyle).toContain('max-width:none!important');
    const decimalStyle = paragraphStyle('Decimal');
    expect(decimalStyle).toContain('width:.5%');
    expect(decimalStyle).toContain('min-width:1e-8%');
    expect(decimalStyle).toContain('max-width:.5%!important');
    expect(decimalStyle).toContain('min-height:1e-8px');
    const assertNotPromoted = (style: string): void => {
      expect(style).not.toContain('box-sizing:content-box!important');
      expect(style).not.toContain('max-width:64%!important');
      expect(style).not.toContain('max-width:80%!important');
    };
    assertNotPromoted(paragraphStyle('Zero edge'));
    assertNotPromoted(paragraphStyle('Calc'));
    assertNotPromoted(paragraphStyle('Negative'));
    assertNotPromoted(paragraphStyle('Unit'));
    assertNotPromoted(paragraphStyle('Float'));
    assertNotPromoted(paragraphStyle('Absolute'));
    assertNotPromoted(paragraphStyle('Inline'));
    assertNotPromoted(paragraphStyle('Flex'));
    assertNotPromoted(paragraphStyle('Flex parent'));
    assertNotPromoted(paragraphStyle('Grid parent'));
    assertNotPromoted(paragraphStyle('Contents grid'));
    const rootStyle = modernHolder.firstElementChild?.getAttribute('style') ?? '';
    assertNotPromoted(rootStyle);
    const pseudoStyle = modernHolder.querySelector('p > span[aria-hidden="true"]')?.getAttribute('style') ?? '';
    assertNotPromoted(pseudoStyle);
    const excludedTextStyle = (text: string): string => {
      const element = [...modernHolder.querySelectorAll('span, td, g')].find(
        (candidate) => candidate.textContent?.replaceAll('\u2060', '').trim() === text
      );
      if (!element) throw new Error(`missing copied excluded content ${text}`);
      return element.getAttribute('style') ?? '';
    };
    assertNotPromoted(excludedTextStyle('Pre code'));
    assertNotPromoted(excludedTextStyle('Table'));
    assertNotPromoted(excludedTextStyle('SVG'));
    assertNotPromoted(excludedTextStyle('Mermaid'));
    assertNotPromoted(excludedTextStyle('Math'));
    const imageStyle = modernHolder.querySelector('img')?.getAttribute('style') ?? '';
    assertNotPromoted(imageStyle);
  });

  it('invalidates warm and in-flight payloads when raw content-box bounds change at equal used pixels', async () => {
    let rawBoxSizing = 'content-box';
    let rawWidth = '80%';
    let includeDecoration = false;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="raw-bounds">Raw bounds</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Raw bounds' });
    const paragraph = preview.querySelector<HTMLElement>('.raw-bounds');
    if (!paragraph) throw new Error('raw bounds fixture missing');
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 64, width: 274 })
    });
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const imageUrl = new URL('/assets/images/raw-bounds-race.png', document.baseURI).href;
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if (element.classList.contains('raw-bounds')) {
        return declaration({
          'background-image': includeDecoration ? `url("${imageUrl}")` : 'none',
          background: includeDecoration ? `url("${imageUrl}")` : 'none',
          'border-left-width': '2px',
          'border-right-width': '2px',
          'box-sizing': raw ? rawBoxSizing : 'content-box',
          display: 'block',
          float: 'none',
          height: 'auto',
          'max-height': 'none',
          'max-width': raw ? rawWidth : '274px',
          'min-height': 'auto',
          'min-width': 'auto',
          'padding-left': '10px',
          'padding-right': '10px',
          position: 'static',
          width: raw ? rawWidth : '274px'
        });
      }
      return declaration({ display: 'block' });
    };
    const writes: string[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('raw bounds HTML missing');
        writes.push(await blobText(html));
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes[0]).toContain('box-sizing:content-box!important');
    expect(writes[0]).toContain('width:80%');
    expect(writes[0]).toContain('min-width:auto');
    expect(writes[0]).toContain('max-width:80%!important');
    expect(writes[0]).toContain('height:auto');
    expect(writes[0]).toContain('min-height:auto');
    expect(writes[0]).toContain('max-height:none');

    rawBoxSizing = 'border-box';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(2);
    expect(writes[1]).not.toContain('box-sizing:border-box!important');
    expect(writes[1]).not.toContain('max-width:80%!important');

    rawBoxSizing = 'content-box';
    rawWidth = '72%';
    includeDecoration = true;
    const preparation = prepareClipboard(clipboard, preview, { background: true });
    await fetchStarted.promise;
    rawWidth = '68%';
    pendingImage.resolve({
      blob: async () => new Blob(['raw bounds'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(preparation).rejects.toThrow('wechat-copy-stale');
    expect(document.querySelector('.easymde-wechat-raw-dimension-context')).toBeNull();
    expect(preview.innerHTML).toContain('Raw bounds');
  });

  it('keeps ordinary flow dimensions fluid in modern and legacy payloads', async () => {
    type DimensionState = Readonly<{ height: string; width: string }>;
    const authored: Record<'fluid' | 'inner' | 'outer', DimensionState> = {
      fluid: { height: 'auto', width: 'auto' },
      inner: { height: 'auto', width: 'auto' },
      outer: { height: 'auto', width: 'auto' }
    };
    const used: Record<'fluid' | 'inner' | 'outer', DimensionState> = {
      fluid: { height: '64px', width: '356.5px' },
      inner: { height: '58px', width: '292.5px' },
      outer: { height: '117px', width: '324.5px' }
    };
    const createPreview = (): HTMLElement => {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = [
        '<h1 class="fluid">Responsive heading</h1>',
        '<p class="fluid">A paragraph that must reflow at the destination width.</p>',
        '<blockquote class="outer"><p>Outer quote content</p>',
        '<blockquote class="inner"><p>Nested quote content</p></blockquote></blockquote>'
      ].join('');
      Object.defineProperty(preview, 'innerText', {
        configurable: true,
        value:
          'Responsive heading\nA paragraph that must reflow at the destination width.\nOuter quote content\nNested quote content'
      });
      const rects: Array<readonly [string, number, number]> = [
        ['.fluid', 356.5, 64],
        ['.outer', 324.5, 117],
        ['.inner', 292.5, 58]
      ];
      rects.forEach(([selector, width, height]) => {
        const element = preview.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`missing responsive fixture ${selector}`);
        Object.defineProperty(element, 'getBoundingClientRect', {
          configurable: true,
          value: () => ({ height, width })
        });
      });
      return preview;
    };
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      const key: keyof typeof authored | null = element.classList.contains('inner')
        ? 'inner'
        : element.classList.contains('outer')
          ? 'outer'
          : element.classList.contains('fluid')
            ? 'fluid'
            : null;
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      const dimensions =
        'fluid' === key
          ? raw
            ? authored.fluid
            : used.fluid
          : 'inner' === key
            ? raw
              ? authored.inner
              : used.inner
            : 'outer' === key
              ? raw
                ? authored.outer
                : used.outer
              : { height: raw ? 'auto' : '240px', width: raw ? 'auto' : '522px' };
      return declaration({
        'box-sizing': 'border-box',
        display: 'block',
        height: dimensions.height,
        'max-height': 'none',
        'max-width': 'none',
        'min-height': 'auto',
        'min-width': 'auto',
        width: dimensions.width
      });
    };
    const copyModern = async (preview: HTMLElement): Promise<string> => {
      const writes: unknown[] = [];
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error('responsive modern HTML missing');
      return blobText(html);
    };

    const modernHtml = await copyModern(createPreview());
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const modernFlowStyles = [...modernHolder.querySelectorAll('h1, p, section')]
      .map((element) => element.getAttribute('style') ?? '')
      .join(';');
    expect(modernFlowStyles).toContain('width:auto');
    expect(modernFlowStyles).toContain('height:auto');
    expect(modernFlowStyles).not.toContain('width:356.5px');
    expect(modernFlowStyles).not.toContain('width:324.5px');
    expect(modernFlowStyles).not.toContain('width:292.5px');
    expect(modernFlowStyles).not.toContain('height:64px');
    expect(modernFlowStyles).not.toContain('height:117px');
    expect(modernHolder.querySelectorAll('blockquote')).toHaveLength(0);
    expect(modernHolder.querySelectorAll('section')).toHaveLength(3);

    const legacyPreview = createPreview();
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, legacyPreview);
      await expect(legacy.copy(legacyPreview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toContain('width:auto');
      expect(legacyHtml).toContain('height:auto');
      expect(legacyHtml).not.toContain('width:356.5px');
      expect(legacyHtml).not.toContain('width:324.5px');
      expect(legacyHtml).not.toContain('width:292.5px');
      expect(legacyHtml).not.toContain('height:117px');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('preserves authored fixed, percentage, and calc dimensions and refreshes equal geometry', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const authored = {
      height: 'calc(100% - 20px)',
      maxHeight: 'calc(100% - 4px)',
      maxWidth: 'calc(100% - 20px)',
      minHeight: '40px',
      minWidth: '30%',
      width: '50%'
    };
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div class="parent"><p class="relative">Relative content-box</p></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Relative content-box' });
    const relative = preview.querySelector<HTMLElement>('.relative');
    if (!relative) throw new Error('relative dimension fixture missing');
    Object.defineProperty(relative, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 100, width: 274 })
    });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if (element.classList.contains('relative')) {
        return declaration({
          'border-bottom-width': '2px',
          'border-left-width': '2px',
          'border-right-width': '2px',
          'border-top-width': '2px',
          'box-sizing': 'content-box',
          display: 'block',
          height: raw ? authored.height : '100px',
          'max-height': raw ? authored.maxHeight : '110px',
          'max-width': raw ? authored.maxWidth : '476px',
          'min-height': raw ? authored.minHeight : '54px',
          'min-width': raw ? authored.minWidth : '143px',
          'padding-bottom': '5px',
          'padding-left': '10px',
          'padding-right': '10px',
          'padding-top': '5px',
          width: raw ? authored.width : '250px'
        });
      }
      return declaration({
        'box-sizing': 'border-box',
        display: 'block',
        height: raw ? 'auto' : '120px',
        width: raw ? 'auto' : '500px'
      });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });
    const readHtml = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const payload = item?.payload['text/html'];
      if (!payload) throw new Error('relative dimension HTML missing');
      return blobText(payload);
    };

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const firstHtml = await readHtml(0);
    expect(firstHtml).toContain('width:calc(50% + 24px)');
    expect(firstHtml).toContain('min-width:calc(30% + 24px)');
    expect(firstHtml).toContain('max-width:calc(');
    expect(firstHtml).toContain('100% - 20px');
    expect(firstHtml).toContain('min-height:54px');
    expect(firstHtml).toContain('max-height:calc(');
    expect(firstHtml).toContain('height:calc(');
    expect(firstHtml).toContain('14px');
    expect(firstHtml).not.toContain('width:274px');
    expect(firstHtml).not.toContain('height:100px');

    authored.width = '240px';
    authored.height = '80px';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const secondHtml = await readHtml(1);
    // The fixed authored values are projected to border-box for this
    // content-box source, retaining the same 24px/14px edge contribution.
    expect(secondHtml).toContain('width:264px');
    expect(secondHtml).toContain('height:94px');
    expect(secondHtml).not.toContain('width:calc(50% + 24px)');
    expect(preview.innerHTML).toContain('Relative content-box');
  });

  it('rejects a pending preparation when authored dimensions change at equal used geometry', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const imageUrl = new URL('/assets/images/dimension-race.png', document.baseURI).href;
    const authored = { height: 'auto', width: '50%' };
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="dimension-race">Dimension race</p>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Dimension race' });
    const paragraph = preview.querySelector<HTMLElement>('.dimension-race');
    if (!paragraph) throw new Error('dimension race fixture missing');
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 100, width: 274 })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
        if (element.classList.contains('dimension-race')) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'box-sizing': 'content-box',
            display: 'block',
            height: raw ? authored.height : '100px',
            'padding-left': '10px',
            'padding-right': '10px',
            width: raw ? authored.width : '250px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const prepare = clipboard.prepare;
    if (!prepare) throw new Error('clipboard preparation is unavailable');
    const preparation = prepare(preview, { background: true });
    await fetchStarted.promise;
    authored.width = '240px';
    pendingImage.resolve({
      blob: async () => new Blob(['dimension image'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);

    await expect(preparation).rejects.toThrow('wechat-copy-stale');
    expect(preview.innerHTML).toBe(sourceMarkup);
    expect(document.querySelector('.easymde-wechat-raw-dimension-context')).toBeNull();
  });

  it('rejects a pending fallback whose authored dimensions no longer match', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const imageUrl = new URL('/assets/images/dimension-fallback-race.png', document.baseURI).href;
    const authored = { height: 'auto', width: '50%' };
    let includeDecoration = false;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="dimension-fallback-race">Fallback race</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Fallback race' });
    const paragraph = preview.querySelector<HTMLElement>('.dimension-fallback-race');
    if (!paragraph) throw new Error('dimension fallback fixture missing');
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 100, width: 274 })
    });
    class ThrowingClipboardItem {
      constructor() {
        throw new Error('clipboard-item-constructor-failed');
      }
    }
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ThrowingClipboardItem,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement && includeDecoration) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        if (pseudoElement) return declaration({ content: 'none' });
        const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
        if (element.classList.contains('dimension-fallback-race')) {
          return declaration({
            'box-sizing': 'border-box',
            display: 'block',
            height: raw ? authored.height : '100px',
            width: raw ? authored.width : '274px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn()
    });
    const replacement = async (): Promise<void> => {
      await prepareClipboard(clipboard, preview);
    };

    try {
      await prepareClipboard(clipboard, preview);
      authored.width = '240px';
      includeDecoration = true;
      const pendingReplacement = replacement();
      await fetchStarted.promise;

      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();

      pendingImage.resolve({
        blob: async () => new Blob(['dimension fallback image'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await pendingReplacement;
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('keeps the raw dimension mirror out of Preview ownership while preserving CSS context', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const imageUrl = new URL('/assets/images/raw-context-owner.png', document.baseURI).href;
    const preview = document.createElement('article');
    const pane = document.createElement('section');
    pane.className = 'easymde-pane-preview';
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-accepted', '1');
    preview.setAttribute('data-easymde-preview-error', '0');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.setAttribute('data-easymde-editor-owner', 'react');
    preview.innerHTML = '<h1 class="raw-context-owner">Raw context owner</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Raw context owner' });
    pane.append(preview);
    document.body.append(pane);
    let sawRawPreviewContext = false;
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
        if (raw && element.closest('.easymde-pane-preview')) sawRawPreviewContext = true;
        if (pseudoElement && element.classList.contains('raw-context-owner')) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        if (pseudoElement) return declaration({ content: 'none' });
        return declaration({
          'box-sizing': 'border-box',
          display: 'block',
          height: raw ? 'auto' : '100px',
          width: raw ? 'auto' : '320px'
        });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const prepare = clipboard.prepare;
    if (!prepare) throw new Error('clipboard preparation is unavailable');

    try {
      const preparation = prepare(preview, { background: true });
      await fetchStarted.promise;
      expect(document.querySelectorAll('.easymde-pane-preview [data-easymde-preview-html-sink="1"]')).toHaveLength(1);
      expect(preview.getAttribute('data-easymde-editor-owner')).toBe('react');
      expect(sawRawPreviewContext).toBe(true);
      expect(document.querySelector('.easymde-wechat-raw-dimension-context')).not.toBeNull();
      const transientIdentitySelector = ['.easymde-wechat-raw-dimension-context', '.easymde-wechat-preview-measurement']
        .map(
          (selector) =>
            `${selector} [data-easymde-editor-owner],` +
            `${selector} [data-easymde-preview-accepted],` +
            `${selector} [data-easymde-preview-error],` +
            `${selector} [data-easymde-preview-html-sink],` +
            `${selector} [data-easymde-preview-refreshing]`
        )
        .join(',');
      expect(document.querySelectorAll(transientIdentitySelector)).toHaveLength(0);
      pendingImage.resolve({
        blob: async () => new Blob(['raw context owner'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await preparation;
      expect(document.querySelectorAll('.easymde-pane-preview [data-easymde-preview-html-sink="1"]')).toHaveLength(1);
    } finally {
      pane.remove();
    }
  });

  it('keeps pseudo dimensions at their source limits after border-box projection in both Clipboard paths', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="edge">Edge</p><p class="over">Over</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Edge\nOver' });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('P' === element.tagName && '::before' === pseudoElement) {
        const over = element.classList.contains('over');
        return declaration({
          content: '""',
          display: 'block',
          'box-sizing': 'content-box',
          width: over ? '321px' : '319px',
          height: over ? '121px' : '119px',
          'padding-left': '1px',
          'padding-right': '1px',
          'padding-top': '1px',
          'padding-bottom': '1px',
          'border-left-width': '1px',
          'border-right-width': '1px',
          'border-top-width': '1px',
          'border-bottom-width': '1px'
        });
      }
      if (pseudoElement) return declaration({});
      return declaration({ display: 'block' });
    };
    const runtime = {
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items: unknown[]) => {
        writes.push(items);
      }
    };
    const modern = createBrowserWechatClipboard(runtime);

    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('modern clipboard html missing');
    const modernHtml = await blobText(htmlBlob);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const modernMarkers = [...modernHolder.querySelectorAll('section p > span[aria-hidden="true"]')];
    expect(modernMarkers).toHaveLength(2);
    const edgeStyle = modernMarkers[0]?.getAttribute('style') ?? '';
    expect(edgeStyle).toContain('box-sizing:border-box');
    expect(edgeStyle).toContain('width:323px');
    expect(edgeStyle).toContain('height:123px');
    const overStyle = modernMarkers[1]?.getAttribute('style') ?? '';
    expect(overStyle).toContain('box-sizing:border-box');
    expect(overStyle).not.toMatch(/(?:^|;)width:/);
    expect(overStyle).not.toMatch(/(?:^|;)height:/);

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({ ...runtime, clipboardItem: null, write: null });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('preserves connected Preview block boundaries in text-only clipboard data', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>First paragraph</p><p>Second paragraph</p><ul><li>A</li><li>B</li></ul>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'First paragraph\n\nSecond paragraph\n\nA\nB'
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const textBlob = item?.payload['text/plain'];
    if (!textBlob) throw new Error('clipboard text missing');
    expect(await blobText(textBlob)).toBe('First paragraph\n\nSecond paragraph\n\nA\nB');
  });

  it('measures modern plain text against the rendered Preview width', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Measured text</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Measured text' });
    Object.defineProperty(preview, 'getBoundingClientRect', { configurable: true, value: () => ({ width: 312 }) });
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    let measuredWidth = '';
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() {
        if ('fixed' === this.parentElement?.style.position) {
          measuredWidth = this.parentElement.style.width;
        }
        return this.textContent ?? '';
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(measuredWidth).toBe('312px');
      expect(writes).toHaveLength(1);
    } finally {
      if (originalInnerText) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      } else {
        delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
      }
    }
  });

  it('reuses the last visible Preview width while the source mode hides Preview', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Hidden Preview text</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Hidden Preview text' });
    let previewVisible = true;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: previewVisible ? 312 : 0 })
    });
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    const measuredWidths: string[] = [];
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() {
        if ('fixed' === this.parentElement?.style.position) {
          measuredWidths.push(this.parentElement.style.width);
        }
        return this.textContent ?? '';
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    clipboard.rememberPreviewWidth?.(preview);
    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      previewVisible = false;
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(measuredWidths).toEqual(['312px', '312px']);
      expect(writes).toHaveLength(2);
    } finally {
      if (originalInnerText) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      } else {
        delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
      }
    }
  });

  it('preserves inline media layout while adding responsive bounds', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Before <img src="https://example.test/inline.png" alt="Inline"> after</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Before  after' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (element instanceof HTMLImageElement && !pseudoElement) {
          return declaration({
            display: 'inline',
            'margin-left': '3px',
            'margin-right': '4px',
            'vertical-align': 'middle',
            width: '24px',
            height: '16px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const image = holder.querySelector('img');
    expect(image?.getAttribute('style')).toContain('display:inline');
    expect(image?.getAttribute('style')).toContain('margin-left:3px');
    expect(image?.getAttribute('style')).toContain('margin-right:4px');
    expect(image?.getAttribute('style')).toContain('max-width:100%');
    expect(image?.getAttribute('style')).toContain('height:auto');
    expect(image?.getAttribute('style')).not.toContain('display:block');
    expect(image?.getAttribute('style')).not.toContain('margin:0 auto');
  });

  it('does not serialize editor geometry into the pasted article', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Heading</h1><p>Portable content</p><table><tbody><tr><td>Cell</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Heading\nPortable content\nCell' });
    const values: Record<string, string> = {
      display: 'grid',
      position: 'fixed',
      float: 'left',
      background: 'url("https://unsafe.example")',
      overflow: 'hidden',
      width: '1024px',
      height: '640px',
      'background-color': 'rgb(250, 251, 252)',
      color: 'rgb(20, 21, 22)',
      'font-family': 'EasyMDE Inter',
      'font-size': '18px',
      'font-weight': '600',
      'line-height': '1.6',
      'text-align': 'left',
      'word-break': 'break-word',
      'overflow-wrap': 'anywhere'
    };
    const exportStyleContextAttribute = 'data-easymde-wechat-export-style-context';
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) =>
        element === preview || '1' === element.getAttribute(exportStyleContextAttribute)
          ? declaration(values)
          : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const html = await blobText(htmlBlob);
    if (!textBlob) throw new Error('clipboard text missing');
    const text = await blobText(textBlob);
    expect(html).toContain('background-color:rgb(250, 251, 252)');
    expect(html).toContain('line-height:1.6');
    expect(html).not.toContain('display:grid');
    expect(html).not.toContain('position:fixed');
    expect(html).not.toContain('float:left');
    expect(html).not.toContain('overflow:hidden');
    expect(html).not.toContain('width:1024px');
    expect(html).not.toContain('unsafe.example');
    expect(html).not.toContain('height:640px');
    expect(text).toContain('Heading');
  });

  it.each(['mdmdt', 'phycat'] as const)(
    'measures native outside list markers for %s without changing Source',
    async (theme) => {
      const markerAdvances: Readonly<Record<string, number>> = {
        alpha: 27.5,
        circle: 13.3,
        decimal: 31.2,
        disc: 12.1,
        roman: 34.6,
        square: 14.4
      };
      const markerTypes: Readonly<Record<string, string>> = {
        alpha: 'upper-alpha',
        circle: 'circle',
        decimal: 'decimal',
        disc: 'disc',
        roman: 'upper-roman',
        square: 'square'
      };
      const sourceMarkup = [
        '<ol class="marker-decimal" start="98" reversed dir="ltr"><li value="100"><p>Decimal multi digit</p><ol class="marker-alpha" type="A"><li><p>Alpha nested</p><ul class="marker-disc"><li>Disc third level</li></ul></li></ol></li></ol>',
        '<ul class="marker-circle"><li>Circle</li></ul>',
        '<ul class="marker-square"><li>Square</li></ul>',
        '<ol class="marker-roman" type="I"><li>Roman</li></ol>',
        '<ul class="marker-positive"><li>Positive start padding</li></ul>'
      ].join('');
      const sourceText = [
        'Decimal multi digit',
        'Alpha nested',
        'Disc third level',
        'Circle',
        'Square',
        'Roman',
        'Positive start padding'
      ].join('\n');

      for (const direction of ['ltr', 'rtl'] as const) {
        for (const width of [335, 677] as const) {
          const source = (): HTMLElement => {
            const preview = document.createElement('article');
            preview.setAttribute('data-easymde-preview-html-sink', '1');
            preview.className = `easymde-markdown-theme-${theme}`;
            preview.innerHTML = sourceMarkup.replaceAll('dir="ltr"', `dir="${direction}"`);
            Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
            return preview;
          };
          const listClass = (element: Element): string =>
            [...element.classList].find((className) => className.startsWith('marker-')) ?? '';
          const elementDirection = (element: Element): 'ltr' | 'rtl' =>
            ((element as HTMLElement).style?.getPropertyValue('direction').trim() as 'ltr' | 'rtl') ||
            (element.classList.contains('mixed-item') ? ('ltr' === direction ? 'rtl' : 'ltr') : direction);
          const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
            if ('::marker' === pseudoElement && 'LI' === element.tagName) {
              return declaration({
                content: 'normal',
                direction: elementDirection(element),
                'font-family': 'Marker Sans',
                'font-size': '16px',
                'font-weight': '400',
                'line-height': '20px'
              });
            }
            if (pseudoElement) return declaration({ content: 'none' });
            const directionValue = elementDirection(element);
            if (['OL', 'UL'].includes(element.tagName)) {
              const className = listClass(element).slice('marker-'.length);
              const positive = 'positive' === className;
              const inlineType = (element as HTMLElement).style?.getPropertyValue('list-style-type').trim();
              return declaration({
                'content-visibility': 'visible',
                counter: 'none',
                'counter-increment': 'none',
                'counter-reset': 'none',
                'counter-set': 'none',
                direction: directionValue,
                display: 'block',
                'list-style-image':
                  'custom-image' === className ? 'url("https://example.test/custom-marker.png")' : 'none',
                'list-style-position': 'outside',
                'list-style-type':
                  'custom-counter' === className
                    ? '--custom-marker'
                    : 'none' === className
                      ? 'none'
                      : inlineType || (markerTypes[className] ?? 'disc'),
                'padding-left': 'rtl' === directionValue ? (positive ? '7px' : '7px') : positive ? '4px' : '0px',
                'padding-right': 'rtl' === directionValue ? (positive ? '4px' : '0px') : '7px',
                'writing-mode': 'horizontal-tb'
              });
            }
            if ('LI' === element.tagName) {
              const list = element.closest('ol, ul');
              const className = listClass(list ?? element).slice('marker-'.length);
              return declaration({
                'content-visibility': 'visible',
                'counter-increment': 'none',
                'counter-reset': 'none',
                'counter-set': 'none',
                direction: directionValue,
                display: 'list-item',
                'list-style-image': 'none',
                'list-style-position': 'outside',
                'list-style-type': markerTypes[className] ?? 'disc',
                padding: '0px',
                'writing-mode': 'horizontal-tb'
              });
            }
            return declaration({ display: 'block', direction: directionValue });
          };
          const probeRecords: string[] = [];
          const rect = (left: number, right: number, height = 20): DOMRect =>
            ({
              bottom: height,
              height,
              left,
              right,
              top: 0,
              width: right - left,
              x: left,
              y: 0,
              toJSON: () => ({})
            }) as DOMRect;
          const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
          Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
            configurable: true,
            value: function getBoundingClientRect(): DOMRect {
              const element = this as HTMLElement;
              const probe = element.closest('[data-easymde-wechat-list-marker-probe]');
              if (probe) {
                if (element.matches('ol, ul')) {
                  const list = element as HTMLElement;
                  probeRecords.push(
                    [
                      list.tagName,
                      list.getAttribute('start') ?? '',
                      list.hasAttribute('reversed') ? 'reversed' : '',
                      list.getAttribute('type') ?? '',
                      list.querySelector(':scope > li')?.getAttribute('value') ?? ''
                    ].join(':')
                  );
                  return rect(0, width);
                }
                if (element.matches('[data-easymde-wechat-list-marker-anchor]')) {
                  const list = element.closest('ol, ul');
                  const type = list ? styleFor(list).getPropertyValue('list-style-type') : 'disc';
                  const advance =
                    markerAdvances[Object.entries(markerTypes).find(([, value]) => value === type)?.[0] ?? 'disc'] ??
                    12;
                  const rtl = 'rtl' === (list ? styleFor(list).getPropertyValue('direction') : direction);
                  return rtl ? rect(400 - advance, 400 - advance) : rect(100 + advance, 100 + advance);
                }
                if ('LI' === element.tagName) return rect(100, 400);
              }
              if (element.matches('ol, ul')) return rect(0, width);
              return originalRect?.value?.call(element) ?? rect(0, 0, 0);
            }
          });

          try {
            let modernHtml = '';
            let modernText = '';
            class ClipboardItemStub {
              constructor(public payload: Record<string, Blob>) {}
            }
            const modern = createBrowserWechatClipboard({
              blob: Blob,
              clipboardItem: ClipboardItemStub,
              document,
              getComputedStyle: styleFor,
              getSelection: window.getSelection.bind(window),
              pageOffset: () => ({ x: 0, y: 0 }),
              scrollTo: vi.fn(),
              write: async (items) => {
                const item = items[0] as ClipboardItemStub;
                const html = item.payload['text/html'];
                const text = item.payload['text/plain'];
                if (!html || !text) throw new Error('list marker payload missing');
                modernHtml = await blobText(html);
                modernText = await blobText(text);
              }
            });
            const modernPreview = source();
            const originalSourceMarkup = modernPreview.innerHTML;
            await expect(modern.copy(modernPreview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
            const holder = document.createElement('div');
            holder.innerHTML = modernHtml;
            const lists = [...holder.querySelectorAll('ol, ul')];
            const expectedGutters = [32, 28, 13, 14, 15, 35];
            expect(lists).toHaveLength(7);
            expectedGutters.forEach((gutter, index) => {
              const style = lists[index]?.getAttribute('style') ?? '';
              expect(style).toMatch(
                new RegExp(
                  `${'ltr' === direction ? 'padding-left' : 'padding-right'}:\\s*${gutter}px(?:\\s*!important)?`
                )
              );
              expect(style).toMatch(new RegExp(`${'ltr' === direction ? 'padding-right' : 'padding-left'}:\\s*7px`));
            });
            const positiveStyle = lists[6]?.getAttribute('style') ?? '';
            expect(positiveStyle).toMatch(
              new RegExp(`${'ltr' === direction ? 'padding-left' : 'padding-right'}:\\s*4px`)
            );
            expect(positiveStyle).not.toMatch(/padding-(?:left|right):(?:1[3-9]|2[0-9]|3[0-9])px/);
            expect(modernText).toBe(sourceText);
            expect(modernPreview.innerHTML).toBe(originalSourceMarkup);
            expect(document.querySelectorAll('[data-easymde-wechat-list-marker-probe]')).toHaveLength(0);
            expect(probeRecords.some((record) => record.includes('98:reversed::100'))).toBe(true);

            let legacyHtml = '';
            const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
            Object.defineProperty(document, 'execCommand', {
              configurable: true,
              value: vi.fn(() => {
                legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
                return true;
              })
            });
            try {
              const legacy = createBrowserWechatClipboard({
                blob: Blob,
                clipboardItem: null,
                document,
                getComputedStyle: styleFor,
                getSelection: window.getSelection.bind(window),
                pageOffset: () => ({ x: 0, y: 0 }),
                scrollTo: vi.fn(),
                write: null
              });
              const legacyPreview = source();
              await prepareClipboard(legacy, legacyPreview);
              await expect(legacy.copy(legacyPreview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
            } finally {
              if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
              else delete (document as unknown as { execCommand?: unknown }).execCommand;
            }
            expect(legacyHtml).toBe(modernHtml);
          } finally {
            if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
            else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
          }
        }
      }
    }
  );

  it('excludes non-native, task, inside, mixed-direction, and padded lists from marker probes', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<ul class="marker-none"><li>None</li></ul>',
      '<ul class="task-list marker-disc"><li class="task-list-item">Task</li></ul>',
      '<ul class="marker-counter"><li>Counter</li></ul>',
      '<ul class="marker-item-counter"><li>Item counter</li></ul>',
      '<ul class="marker-image"><li>Image</li></ul>',
      '<ul class="marker-custom"><li>Custom</li></ul>',
      '<ul class="marker-pseudo-list"><li>Pseudo list</li></ul>',
      '<ul class="marker-item-pseudo"><li>Pseudo item</li></ul>',
      '<ul class="marker-inside"><li>Inside</li></ul>',
      '<ul class="marker-mixed"><li class="mixed-item">Mixed</li></ul>',
      '<ul class="marker-positive"><li>Positive padding</li></ul>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText =
      'None\nTask\nCounter\nItem counter\nImage\nCustom\nPseudo list\nPseudo item\nInside\nMixed\nPositive padding';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const listClass = (element: Element): string =>
      [...element.classList].find((className) => className.startsWith('marker-')) ?? '';
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const markerKind = listClass(element.closest('ol, ul') ?? element).slice('marker-'.length);
      const direction = element.classList.contains('mixed-item') ? 'rtl' : 'ltr';
      if (pseudoElement && ['::before', '::after'].includes(pseudoElement)) {
        return declaration({
          content:
            ('UL' === element.tagName && 'pseudo-list' === markerKind) ||
            ('LI' === element.tagName && 'item-pseudo' === markerKind)
              ? '"badge"'
              : 'none'
        });
      }
      if ('::marker' === pseudoElement && 'LI' === element.tagName) {
        return declaration({ content: 'custom' === markerKind ? '"x"' : 'normal' });
      }
      if (pseudoElement) return declaration({ content: 'none' });
      if ('UL' === element.tagName) {
        return declaration({
          'counter-increment': 'none',
          'counter-reset': 'none',
          'counter-set': 'counter' === markerKind ? 'item' : 'none',
          direction,
          display: 'block',
          'list-style-image': 'image' === markerKind ? 'url("https://example.test/list.png")' : 'none',
          'list-style-position': 'inside' === markerKind ? 'inside' : 'outside',
          'list-style-type': 'none' === markerKind ? 'none' : 'disc',
          'padding-left': 'positive' === markerKind ? '4px' : '0px',
          'padding-right': '0px',
          'writing-mode': 'horizontal-tb'
        });
      }
      if ('LI' === element.tagName) {
        return declaration({
          'counter-increment': 'none',
          'counter-reset': 'none',
          'counter-set': 'item-counter' === markerKind ? 'item' : 'none',
          direction,
          display: 'list-item',
          'list-style-image': 'none',
          'list-style-position': 'outside',
          'list-style-type': 'disc',
          'writing-mode': 'horizontal-tb'
        });
      }
      return declaration({ display: 'block', direction });
    };
    const writes: unknown[] = [];
    let probeCalls = 0;
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function getBoundingClientRect(): DOMRect {
        if ((this as HTMLElement).closest('[data-easymde-wechat-list-marker-probe]')) probeCalls += 1;
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
        );
      }
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const modern = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });
    try {
      await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      const text = item?.payload['text/plain'];
      if (!html || !text) throw new Error('list exclusion payload missing');
      const modernHtml = await blobText(html);
      expect(await blobText(text)).toBe(sourceText);
      const holder = document.createElement('div');
      holder.innerHTML = modernHtml;
      const lists = [...holder.querySelectorAll('ul')];
      expect(lists).toHaveLength(11);
      expect(
        lists.every((list) => !/padding-left:\s*(?:1[0-9]|[2-9][0-9])px/.test(list.getAttribute('style') ?? ''))
      ).toBe(true);
      expect(lists[10]?.getAttribute('style')).toMatch(/padding-left:\s*4px/);
      expect(preview.innerHTML).toBe(sourceMarkup);
      expect(probeCalls).toBe(0);
      expect(document.querySelectorAll('[data-easymde-wechat-list-marker-probe]')).toHaveLength(0);

      let legacyHtml = '';
      const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => {
          legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
          return true;
        })
      });
      try {
        const legacy = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle: styleFor,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        await prepareClipboard(legacy, preview);
        await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      } finally {
        if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
        else delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
      expect(legacyHtml).toBe(modernHtml);
      expect(probeCalls).toBe(0);
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    }
  });

  it('remeasures an outside marker after a warm payload font advance changes', async () => {
    let advance = 20;
    let probeCalls = 0;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<ul><li>Warm marker</li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Warm marker' });
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('::marker' === pseudoElement) return declaration({ content: 'normal', 'font-family': 'Marker Sans' });
      if (pseudoElement) return declaration({ content: 'none' });
      if ('UL' === element.tagName) {
        return declaration({
          'counter-increment': 'none',
          'counter-reset': 'none',
          'counter-set': 'none',
          direction: 'ltr',
          display: 'block',
          'list-style-image': 'none',
          'list-style-position': 'outside',
          'list-style-type': 'disc',
          'padding-left': '0px',
          'padding-right': '0px',
          'writing-mode': 'horizontal-tb'
        });
      }
      if ('LI' === element.tagName) {
        return declaration({
          'counter-increment': 'none',
          'counter-reset': 'none',
          'counter-set': 'none',
          direction: 'ltr',
          display: 'list-item',
          'list-style-image': 'none',
          'list-style-position': 'outside',
          'list-style-type': 'disc',
          'writing-mode': 'horizontal-tb'
        });
      }
      if ('ARTICLE' === element.tagName) {
        return declaration({
          'border-bottom-width': '0px',
          'border-left-width': '0px',
          'border-right-width': '0px',
          'border-top-width': '0px',
          'box-sizing': 'content-box',
          display: 'block',
          'font-family': 'sans-serif',
          'font-size': '16px',
          'font-weight': '400',
          'letter-spacing': 'normal',
          'line-height': 'normal',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          'word-spacing': 'normal'
        });
      }
      return declaration({ display: 'block' });
    };
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function getBoundingClientRect(): DOMRect {
        const element = this as HTMLElement;
        const probe = element.closest('[data-easymde-wechat-list-marker-probe]');
        if (probe && element.hasAttribute('data-easymde-wechat-list-marker-anchor')) {
          probeCalls += 1;
          return {
            bottom: 20,
            height: 20,
            left: 100 + advance,
            right: 100 + advance,
            top: 0,
            width: 0,
            x: 100 + advance,
            y: 0,
            toJSON: () => ({})
          } as DOMRect;
        }
        if (probe && 'LI' === element.tagName) return { left: 100, right: 400, width: 300 } as DOMRect;
        if (probe && 'UL' === element.tagName) return { left: 0, right: 300, width: 300 } as DOMRect;
        if ('UL' === element.tagName) return { left: 0, right: 300, width: 300 } as DOMRect;
        return originalRect?.value?.call(element) ?? ({ left: 0, right: 0, width: 0 } as DOMRect);
      }
    });
    try {
      let html = '';
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob>) {}
      }
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          const item = items[0] as ClipboardItemStub;
          const payload = item.payload['text/html'];
          if (!payload) throw new Error('warm marker HTML missing');
          html = await blobText(payload);
        }
      });
      await prepareClipboard(clipboard, preview);
      advance = 80;
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(probeCalls).toBeGreaterThan(1);
      expect(html).toMatch(/padding-left:\s*80px/);
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    }
  });

  it('maps terminal and intentional code newlines to the source logical lines', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<pre><code><span class="token keyword">alpha  </span>\n<span class="token comment">beta  </span>\n</code></pre>',
      '<pre><code>double\n\n</code></pre>',
      '<pre><code>triple\n\n\n</code></pre>',
      '<pre><code>crlf\r\nnext\r\n</code></pre>',
      '<pre><code>single</code></pre>',
      '<pre><code></code></pre>',
      '<pre><code>\n</code></pre>',
      '<pre><code>alpha\n\nbeta</code></pre>',
      '<pre><code><span class="token outer">alpha\n<span class="token inner">beta\n</span></span></code></pre>'
    ].join('');
    const sourceText = 'alpha  \nbeta  \ndouble\n\ntriple\n\n\ncrlf\r\nnext\r\nsingle\n\n\nalpha\n\nbeta\nalpha\nbeta';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('SPAN' === element.tagName && element.classList.contains('token')) {
          return declaration({ color: 'rgb(1, 2, 3)', display: 'inline' });
        }
        if ('PRE' === element.tagName || 'CODE' === element.tagName) {
          return declaration({ display: 'block', 'white-space': 'pre' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('clipboard payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const codeBlocks = holder.querySelectorAll('pre > code');
    const rowContainers = [...codeBlocks].map(codeRows);
    expect(await blobText(textBlob)).toBe(sourceText);
    expect(codeBlocks).toHaveLength(9);
    expect(rowContainers.every((rows) => rows !== null)).toBe(true);
    expect([...codeBlocks].every((code) => code.children.length === 1)).toBe(true);
    expect(rowContainers[0]?.querySelectorAll(':scope > nobr')).toHaveLength(2);
    expect(rowContainers[0]?.querySelectorAll(':scope > br')).toHaveLength(1);
    expect(rowContainers[0]?.querySelector('nobr')?.textContent?.replaceAll('\u2060', '')).toBe('alpha  ');
    expect(codeBlocks[0]?.querySelectorAll('span[style*="color:rgb(1, 2, 3)"]')).toHaveLength(2);
    expect(rowContainers[1]?.querySelectorAll(':scope > nobr')).toHaveLength(2);
    expect(rowContainers[1]?.querySelectorAll(':scope > br')).toHaveLength(1);
    expect(rowContainers[2]?.querySelectorAll(':scope > nobr')).toHaveLength(3);
    expect(rowContainers[2]?.querySelectorAll(':scope > br')).toHaveLength(2);
    expect(rowContainers[3]?.querySelectorAll(':scope > nobr')).toHaveLength(2);
    expect(rowContainers[3]?.querySelectorAll(':scope > br')).toHaveLength(1);
    expect(rowContainers[4]?.querySelectorAll(':scope > nobr')).toHaveLength(1);
    expect(rowContainers[4]?.querySelectorAll(':scope > br')).toHaveLength(0);
    expect(rowContainers[5]?.querySelectorAll(':scope > nobr')).toHaveLength(1);
    expect(rowContainers[5]?.querySelectorAll(':scope > br')).toHaveLength(0);
    expect(rowContainers[6]?.querySelectorAll(':scope > nobr')).toHaveLength(1);
    expect(rowContainers[6]?.querySelectorAll(':scope > br')).toHaveLength(0);
    expect(rowContainers[7]?.querySelectorAll(':scope > nobr')).toHaveLength(3);
    expect(rowContainers[7]?.querySelectorAll(':scope > br')).toHaveLength(2);
    expect(rowContainers[8]?.querySelectorAll(':scope > nobr')).toHaveLength(2);
    expect(rowContainers[8]?.querySelectorAll(':scope > br')).toHaveLength(1);
    const nestedTokenSpans = [...(codeBlocks[8]?.querySelectorAll('span[style*="color:rgb(1, 2, 3)"]') ?? [])];
    expect(nestedTokenSpans.length).toBeGreaterThanOrEqual(2);
    expect(
      nestedTokenSpans.every((span) => span.textContent?.includes('alpha') || span.textContent?.includes('beta'))
    ).toBe(true);
    expect(rowContainers[8]?.querySelectorAll(':scope > nobr')[0]?.textContent).toContain('alpha');
    expect(rowContainers[8]?.querySelectorAll(':scope > nobr')[1]?.textContent).toContain('beta');
  });

  it('preserves inherited computed defaults and nested resets in both Clipboard paths', async () => {
    const inheritedDefaults: Record<string, string> = {
      'font-style': 'normal',
      'font-variant': 'normal',
      'font-stretch': '100%',
      'letter-spacing': 'normal',
      'text-transform': 'none',
      'white-space': 'normal',
      'text-indent': '0px',
      'text-shadow': 'none',
      'tab-size': '8',
      'list-style-position': 'outside'
    };
    const nestedReset = {
      'letter-spacing': '0.25px',
      'text-indent': '4px',
      'text-transform': 'uppercase',
      'overflow-wrap': 'anywhere'
    };
    const source = (): HTMLElement => {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p><span>Inherited text</span></p>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Inherited text' });
      return preview;
    };
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) {
        return declaration({
          ...inheritedDefaults,
          content: '"before"',
          display: 'inline',
          'overflow-wrap': 'break-word'
        });
      }
      if ('ARTICLE' === element.tagName) {
        return declaration({ ...inheritedDefaults, display: 'block', opacity: '1', 'overflow-wrap': 'normal' });
      }
      if ('SPAN' === element.tagName) {
        return declaration({ ...inheritedDefaults, ...nestedReset, display: 'inline' });
      }
      return declaration({ ...inheritedDefaults, display: 'block', opacity: '1', 'overflow-wrap': 'normal' });
    };
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const runtime = {
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items: unknown[]) => {
        writes.push(items);
      }
    };
    const modern = createBrowserWechatClipboard(runtime);
    await expect(modern.copy(source())).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernBlob = modernItem?.payload['text/html'];
    if (!modernBlob) throw new Error('modern HTML missing');
    const modernHtml = await blobText(modernBlob);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const paragraph = modernHolder.querySelector<HTMLElement>('section p');
    const paragraphStyle = paragraph?.getAttribute('style') ?? '';
    for (const [property, value] of Object.entries(inheritedDefaults)) {
      expect(paragraphStyle).toContain(`${property}:${value}`);
    }
    expect(paragraphStyle).not.toContain('opacity:1');
    const beforeStyle = modernHolder.querySelector('section p > span[aria-hidden="true"]')?.getAttribute('style') ?? '';
    expect(beforeStyle).toContain('letter-spacing:normal');
    expect(beforeStyle).toContain('overflow-wrap:break-word!important');
    const nestedElement = modernHolder.querySelector<HTMLElement>(
      'section p span:not([aria-hidden="true"]):not([leaf])'
    );
    const nestedStyle = nestedElement?.getAttribute('style') ?? '';
    expect(nestedStyle).toContain('letter-spacing:0.25px');
    expect(nestedStyle).toContain('text-indent:4px');
    expect(nestedStyle).toContain('text-transform:uppercase');
    expect(nestedStyle).toContain('overflow-wrap:anywhere!important');

    const hostileStyles = document.createElement('style');
    hostileStyles.textContent = '.wechat-hostile section * { overflow-wrap:break-word !important; }';
    modernHolder.className = 'wechat-hostile';
    document.head.append(hostileStyles);
    document.body.append(modernHolder);
    try {
      expect(paragraph?.style.getPropertyPriority('overflow-wrap')).toBe('important');
      expect(nestedElement?.style.getPropertyPriority('overflow-wrap')).toBe('important');
      expect(window.getComputedStyle(paragraph as Element).getPropertyValue('overflow-wrap')).toBe('normal');
      expect(window.getComputedStyle(nestedElement as Element).getPropertyValue('overflow-wrap')).toBe('anywhere');
    } finally {
      modernHolder.remove();
      hostileStyles.remove();
    }

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({ ...runtime, clipboardItem: null, write: null });
      const legacyPreview = source();
      await prepareClipboard(legacy, legacyPreview);
      await expect(legacy.copy(legacyPreview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('keeps semantic article structure and materializes safe pseudo content', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h1>Article title</h1>',
      '<h2>Section heading</h2>',
      '<p><strong>Bold</strong> <em>italic</em> <a href="https://example.test/link">link</a> <code>inline()</code></p>',
      '<blockquote>Quoted text</blockquote>',
      '<ul><li>First</li><li>Second</li></ul>',
      '<ol><li>Ordered</li></ol>',
      '<hr>',
      '<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>',
      '<figure><img src="https://example.test/image.png" alt="Synthetic image"></figure>',
      '<pre><code>const value = 1;</code></pre>',
      '<p style="background:url(https://unsafe.example)">Unsafe style</p>',
      '<span style="display:none">Hidden internal placeholder</span>',
      '<button data-easymde-code-copy="1">Copy</button>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Article title\nSection heading\nBold italic link inline()'
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('FIGURE' === element.tagName && !pseudoElement) {
          return declaration({ display: 'flex', position: 'relative', width: '320px' });
        }
        if ('H2' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '"Chapter"',
            display: 'inline',
            color: 'rgb(1, 2, 3)',
            'border-bottom-width': '36px',
            'border-bottom-style': 'solid',
            'border-bottom-color': 'rgb(239, 235, 233)',
            'border-right-width': '20px',
            'border-right-style': 'solid',
            'border-right-color': 'rgba(0, 0, 0, 0)',
            'background-image': 'linear-gradient(135deg, rgb(1, 2, 3), transparent)'
          });
        }
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '76px',
            height: '42px',
            'background-image': 'linear-gradient(135deg, rgb(1, 2, 3), transparent)'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const html = await blobText(htmlBlob);
    if (!textBlob) throw new Error('clipboard text missing');
    const text = await blobText(textBlob);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(holder.querySelector('h1')).not.toBeNull();
    expect(holder.querySelector('h1 > span[aria-hidden="true"]')?.textContent).toBe(' ');
    expect(holder.querySelector('h1 > span[aria-hidden="true"]')?.getAttribute('style')).toContain('font-size:0');
    expect(holder.querySelector('h1 > span[aria-hidden="true"]')?.getAttribute('style')).toContain(
      'background-image:linear-gradient(135deg, rgb(1, 2, 3), transparent)'
    );
    expect(holder.querySelector('h2 > span[aria-hidden="true"]')?.textContent).toBe('Chapter');
    expect(holder.querySelector('h2 > span[aria-hidden="true"]')?.getAttribute('style')).toContain(
      'background-image:linear-gradient(135deg, rgb(1, 2, 3), transparent)'
    );
    expect(holder.querySelector('h2 > span[aria-hidden="true"]')?.getAttribute('style')).toContain(
      'border-right-color:rgba(0, 0, 0, 0)'
    );
    expect(holder.querySelector('strong')?.textContent).toBe('Bold');
    expect(holder.querySelector('em')?.textContent).toBe('italic');
    expect(holder.querySelector('a')?.getAttribute('href')).toBe('https://example.test/link');
    expect(holder.querySelectorAll('blockquote')).toHaveLength(0);
    expect(holder.textContent).toContain('Quoted text');
    expect(holder.querySelectorAll('ul > li')).toHaveLength(2);
    expect(holder.querySelectorAll('ol > li')).toHaveLength(1);
    expect(holder.querySelector('table th')?.textContent).toBe('Header');
    expect(holder.querySelector('table td')?.textContent).toBe('Cell');
    expect(holder.querySelector('figure')?.getAttribute('style')).toContain('display:flex');
    expect(holder.querySelector('img')?.getAttribute('alt')).toBe('Synthetic image');
    expect(holder.querySelector('img')?.getAttribute('style')).toContain('max-width:100%');
    expect(holder.querySelector('pre code')?.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toContain(
      'const value = 1;'
    );
    expect(holder.querySelector('button')).toBeNull();
    expect(html).not.toContain('data-easymde-');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('unsafe.example');
    expect(html).not.toContain('id=');
    expect(text).not.toContain('Copy');
    expect(html).not.toContain('Hidden internal placeholder');
    expect(text).toContain('Article title');
  });

  it.each([
    ['display:none', { display: 'none' }],
    ['visibility:hidden', { visibility: 'hidden' }],
    ['visibility:collapse', { visibility: 'collapse' }],
    ['content-visibility:hidden', { 'content-visibility': 'hidden' }],
    ['numeric opacity at zero', { opacity: '0.00' }],
    ['numeric negative opacity', { opacity: '-0.25' }]
  ] as const)(
    'does not materialize hidden heading pseudo text for %s in either Clipboard path',
    async (_label, hiddenStyle) => {
      const sourceMarkup = [
        '<h1>Title one</h1>',
        '<h2>Title two</h2>',
        '<h3>Title three</h3>',
        '<h4>Title four</h4>'
      ].join('');
      const createPreview = (): HTMLElement => {
        const preview = document.createElement('article');
        preview.setAttribute('data-easymde-preview-html-sink', '1');
        preview.innerHTML = sourceMarkup;
        Object.defineProperty(preview, 'innerText', {
          configurable: true,
          value: 'Title one\nTitle two\nTitle three\nTitle four'
        });
        return preview;
      };
      const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if (pseudoElement && ['H1', 'H2', 'H3', 'H4'].includes(element.tagName)) {
          return declaration({
            content: `"${element.tagName.toLowerCase()}"`,
            display: 'inline',
            opacity: '1',
            visibility: 'visible',
            'content-visibility': 'visible',
            ...hiddenStyle
          });
        }
        return declaration({ display: 'block', opacity: '1', visibility: 'visible' });
      };
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob>) {}
      }
      let modernHtml = '';
      const modern = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          const item = items[0] as ClipboardItemStub;
          const html = item.payload['text/html'];
          if (!html) throw new Error('hidden pseudo HTML missing');
          modernHtml = await blobText(html);
        }
      });

      await expect(modern.copy(createPreview())).resolves.toEqual({ method: 'clipboard', status: 'copied' });

      let legacyHtml = '';
      const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => {
          legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
          return true;
        })
      });
      try {
        const legacy = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        const legacyPreview = createPreview();
        await prepareClipboard(legacy, legacyPreview);
        await expect(legacy.copy(legacyPreview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      } finally {
        if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
        else delete (document as unknown as { execCommand?: unknown }).execCommand;
      }

      expect(legacyHtml).toBe(modernHtml);
      expect(modernHtml).not.toMatch(/>h[1-4]</);
      expect(modernHtml).not.toContain('aria-hidden="true"');
    }
  );

  it.each([
    ['none', 'none'],
    ['normal', 'normal'],
    ['unsupported', 'attr(data-label)']
  ])('does not walk or fetch styles for a non-generating %s pseudo', async (_, content) => {
    const writes: unknown[] = [];
    const pseudoProperties: string[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const imageUrl = new URL('/assets/images/non-generating-pseudo.png', document.baseURI).href;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Pseudo content</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Pseudo content' });
    const fetch = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) {
          return {
            getPropertyValue: (property: string) => {
              pseudoProperties.push(property);
              if ('content' === property) return content;
              if ('background-image' === property) return `url("${imageUrl}")`;
              return 'block';
            }
          } as unknown as CSSStyleDeclaration;
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(fetch).not.toHaveBeenCalled();
    expect(pseudoProperties.length).toBeGreaterThan(0);
    expect(pseudoProperties.every((property) => 'content' === property)).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it('invalidates pseudo freshness for null-to-generated transitions and generated style changes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    let content = 'none';
    let color = 'red';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Pseudo transition</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Pseudo transition' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({ color, content, display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });
    const readHtml = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error('clipboard html missing');
      return blobText(html);
    };

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await readHtml(0)).not.toContain('aria-hidden="true"');

    content = '""';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const emptyHtml = await readHtml(1);
    expect(emptyHtml).toContain('aria-hidden="true"');
    expect(emptyHtml).toContain('font-size:0');

    content = '"Generated"';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const generatedHtml = await readHtml(2);
    expect(generatedHtml).toContain('Generated');
    expect(generatedHtml).toContain('color:red');

    color = 'blue';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const restyledHtml = await readHtml(3);
    expect(restyledHtml).toContain('color:blue');
    expect(restyledHtml).not.toContain('color:red');

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('H1' === element.tagName && '::before' === pseudoElement) {
            return declaration({ color, content, display: 'block' });
          }
          return declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(restyledHtml);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('inlines same-origin theme background images without fetching arbitrary URLs', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-size': '100% 100%'
          });
        }
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `transparent url("${imageUrl}") left center / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': 'left center',
            'background-size': '100% 100%'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const html = await blobText(htmlBlob);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('src')).toMatch(
      /^data:image\/png;base64,/
    );
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('style')).toContain('width:100%');
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('style')).toContain('height:100%');
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('style')).not.toContain(
      'height:auto'
    );
    const overlayStyle = holder.querySelector('h1 > img')?.getAttribute('style') ?? '';
    expect(overlayStyle).toContain('left:0');
    expect(overlayStyle).toContain('transform:translateY(-50%)');
    expect(overlayStyle).toContain('z-index:-1');
    expect(overlayStyle).not.toContain('translateX(-50%)');
    expect(overlayStyle).not.toContain('translate(-50%,-50%)');
    expect(holder.querySelector('h1')?.getAttribute('style')).toContain('isolation:isolate');
    expect(html).not.toContain('background-image:url("data:');
    expect(html).not.toContain(imageUrl);
  });

  it('rejects a theme image response that redirects outside the approved path', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(
        async () =>
          ({
            ok: true,
            url: 'https://cdn.example.test/assets/images/cupid-busy-heart.png',
            blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
          }) as unknown as Response
      ),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    await expect(prepareClipboard(clipboard, preview)).rejects.toThrow('wechat-theme-image-redirected');
  });

  it('preserves repeating theme backgrounds instead of flattening them to one image', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<hr>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '' });
    const imageUrl = new URL('/assets/images/qingbi-rule-texture.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('HR' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            height: '4px',
            background: `transparent url("${imageUrl}") repeat-x 0 0`,
            'background-image': `url("${imageUrl}")`,
            'background-repeat': 'repeat-x'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const rule = holder.querySelector('hr');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rule?.getAttribute('style')).toContain('background:transparent url("data:image/png;base64,');
    expect(rule?.getAttribute('style')).toContain('repeat-x');
    expect(rule?.querySelector('img')).toBeNull();
  });

  it('preserves non-image layers in a mixed theme background', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const gradient = 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))';
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `${gradient} 0 0 / 100% 100% no-repeat, url("${imageUrl}") left center / 20px 20px no-repeat`,
            'background-image': `${gradient}, url("${imageUrl}")`,
            'background-position': '0% 0%, 0% 50%',
            'background-repeat': 'no-repeat, no-repeat',
            'background-size': '100% 100%, 20px 20px',
            'background-color': 'rgb(255, 255, 255)'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const heading = holder.querySelector('h1');
    const style = heading?.getAttribute('style') ?? '';
    expect(fetch).toHaveBeenCalledOnce();
    expect(style).toContain(`background-image:${gradient}`);
    expect(style).toContain('background-position:0% 0%');
    expect(style).toContain('background-repeat:no-repeat');
    expect(style).toContain('background-size:100% 100%');
    expect(style).not.toContain('background-position:0% 0%, 0% 50%');
    expect(style).not.toContain('background-size:100% 100%, 20px 20px');
    expect(style).toContain('background-color:rgb(255, 255, 255)');
    expect(heading?.querySelector(':scope > img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(heading?.querySelector(':scope > img')?.getAttribute('style')).toContain('width:20px');
    expect(style).not.toContain(`background:${gradient}`);
    expect(style).not.toContain('url("data:image');
  });

  it('keeps longhand layers aligned when an image precedes a gradient', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const gradient = 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))';
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") left top / 20px 20px no-repeat, ${gradient} 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}"), ${gradient}`,
            'background-position': '0% 0%, 50% 50%',
            'background-repeat': 'no-repeat, no-repeat',
            'background-size': '20px 20px, 100% 100%'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const heading = holder.querySelector('h1');
    const style = heading?.getAttribute('style') ?? '';
    expect(fetch).toHaveBeenCalledOnce();
    expect(style).toContain(`background-image:${gradient}`);
    expect(style).toContain('background-position:50% 50%');
    expect(style).toContain('background-repeat:no-repeat');
    expect(style).toContain('background-size:100% 100%');
    expect(style).not.toContain('background-position:0% 0%, 50% 50%');
    expect(style).not.toContain('background-size:20px 20px, 100% 100%');
    expect(heading?.querySelector(':scope > img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('overlays pseudo-element images behind visible generated text', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Badge heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Badge heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '"NEW"',
            display: 'inline-block',
            position: 'relative',
            width: '48px',
            height: '20px',
            background: `url("${imageUrl}") center / 48px 20px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': '50% 50%',
            'background-repeat': 'no-repeat',
            'background-size': '48px 20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const marker = holder.querySelector('h1 > span[aria-hidden="true"]');
    const image = marker?.querySelector(':scope > img');
    expect(fetch).toHaveBeenCalledOnce();
    expect(marker?.textContent).toContain('NEW');
    expect(image?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(image?.getAttribute('style')).toContain('position:absolute');
    expect(image?.getAttribute('style')).toContain('z-index:-1');
    expect(marker?.getAttribute('style')).toContain('isolation:isolate');
  });

  it('does not reactivate fixed or sticky positioning for materialized backgrounds', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Portable heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Portable heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'fixed',
            top: '24px',
            left: '32px',
            background: `url("${imageUrl}") left top / 20px 20px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': '0% 0%',
            'background-repeat': 'no-repeat',
            'background-size': '20px 20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const heading = holder.querySelector('h1');
    const style = heading?.getAttribute('style') ?? '';
    expect(fetch).toHaveBeenCalledOnce();
    expect(style).not.toContain('position:fixed');
    expect(style).not.toContain('position:sticky');
    expect(style).toContain('position:relative');
    expect(style).toContain('top:auto');
    expect(style).toContain('right:auto');
    expect(style).toContain('bottom:auto');
    expect(style).toContain('left:auto');
    expect(heading?.querySelector(':scope > img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('retains safe background layers when an unsafe URL shares the stack', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2>Theme heading</h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const externalImageUrl = 'https://cdn.example.test/theme-decoration.png';
    const gradient = 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))';
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch: vi.fn(),
      getComputedStyle: (element, pseudoElement) => {
        if ('H2' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            background: `${gradient} 0 0 / 100% 100% no-repeat, url("${externalImageUrl}") center / 20px 20px no-repeat`,
            'background-image': `${gradient}, url("${externalImageUrl}")`,
            'background-position': '0% 0%, 50% 50%',
            'background-repeat': 'no-repeat, no-repeat',
            'background-size': '100% 100%, 20px 20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const style = holder.querySelector('h2')?.getAttribute('style') ?? '';
    expect(style).toContain(`background-image:${gradient}, none`);
    expect(style).toContain('background-position:0% 0%, 50% 50%');
    expect(style).toContain('background-repeat:no-repeat, no-repeat');
    expect(style).toContain('background-size:100% 100%, 20px 20px');
    expect(style).not.toContain(externalImageUrl);
    expect(style).not.toContain('url(');
  });

  it('preserves multiple materialized background layers and their stacking', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<span data-decoration="1"></span>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '' });
    const firstImageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const secondImageUrl = new URL('/assets/images/fullstack-blue-h2.png', document.baseURI).href;
    const fetch = vi.fn(
      async (value: RequestInfo | URL) =>
        ({ ok: true, blob: async () => new window.Blob([String(value)], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('SPAN' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            height: '20px',
            'background-image': `url("${firstImageUrl}"), url("${secondImageUrl}")`,
            background: `url("${firstImageUrl}"), url("${secondImageUrl}")`,
            'background-position': 'left top, right bottom',
            'background-repeat': 'no-repeat, no-repeat',
            'background-size': '10px 10px, 12px 12px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('span > img')];
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(images).toHaveLength(2);
    const firstLayer = images.find((image) => image.getAttribute('style')?.includes('width:10px'));
    const secondLayer = images.find((image) => image.getAttribute('style')?.includes('width:12px'));
    expect(firstLayer?.getAttribute('style')).toContain('position:absolute');
    expect(firstLayer?.getAttribute('style')).toContain('z-index:-1');
    expect(firstLayer?.getAttribute('style')).not.toContain('display:none');
    expect(secondLayer?.getAttribute('style')).toContain('position:absolute');
    expect(secondLayer?.getAttribute('style')).toContain('z-index:-2');
    expect(secondLayer?.getAttribute('style')).not.toContain('display:none');
  });

  it('centers theme overlays when computed background positions are percentages', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/fullstack-blue-h2.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") 50% 50% / 20px 20px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': '50% 50%',
            'background-size': '20px 20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const overlayStyle = holder.querySelector('h1 > img')?.getAttribute('style') ?? '';
    expect(overlayStyle).toContain('left:50%');
    expect(overlayStyle).toContain('top:50%');
    expect(overlayStyle).toContain('transform:translateX(-50%) translateY(-50%)');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('applies CSS single-value background-position defaults to both axes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h3>Theme heading</h3>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/fullstack-blue-h3.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H3' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") center / 30px 30px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': 'center',
            'background-size': '30px 30px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const overlayStyle = holder.querySelector('h3 > img')?.getAttribute('style') ?? '';
    expect(overlayStyle).toContain('left:50%');
    expect(overlayStyle).toContain('top:50%');
    expect(overlayStyle).toContain('transform:translateX(-50%) translateY(-50%)');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('preserves a two-value background-position with only horizontal centering', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h4>Theme heading</h4>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/fullstack-blue-h4.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H4' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") 50% 0% / 30px 30px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': '50% 0%',
            'background-size': '30px 30px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const overlayStyle = holder.querySelector('h4 > img')?.getAttribute('style') ?? '';
    expect(overlayStyle).toContain('left:50%');
    expect(overlayStyle).toContain('top:0');
    expect(overlayStyle).toContain('transform:translateX(-50%)');
    expect(overlayStyle).not.toContain('translateY');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps two-value keyword and offset positions on their CSS axes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h4>Left offset</h4><h5>Top offset</h5>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Left offset Top offset' });
    const imageUrl = new URL('/assets/images/theme.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H4' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") left 10px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': 'left 10px',
            'background-size': '30px 30px'
          });
        }
        if ('H5' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") top 10px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': 'top 10px',
            'background-size': '30px 30px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const leftOffsetStyle = holder.querySelector('h4 > img')?.getAttribute('style') ?? '';
    const topOffsetStyle = holder.querySelector('h5 > img')?.getAttribute('style') ?? '';
    expect(leftOffsetStyle).toContain('left:0');
    expect(leftOffsetStyle).toContain('top:10px');
    expect(leftOffsetStyle).not.toContain('left:10px');
    expect(topOffsetStyle).toContain('left:10px');
    expect(topOffsetStyle).toContain('top:0');
    expect(topOffsetStyle).not.toContain('top:10px');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('preserves non-edge percentage background positions with inverse image transforms', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h5>Theme heading</h5>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/fullstack-blue-h5.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H5' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") 25% 75% / 30px 30px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': '25% 75%',
            'background-size': '30px 30px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const overlayStyle = holder.querySelector('h5 > img')?.getAttribute('style') ?? '';
    expect(overlayStyle).toContain('left:25%');
    expect(overlayStyle).toContain('top:75%');
    expect(overlayStyle).toContain('transform:translateX(-25%) translateY(-75%)');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('preserves intrinsic height and removes width clamps for single-value theme sizes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2>Wide heading</h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Wide heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H2' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '32px',
            height: '38px',
            background: `url("${imageUrl}") center / 63px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': '50% 50%',
            'background-repeat': 'no-repeat',
            'background-size': '63px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const style = holder.querySelector('h2 > img')?.getAttribute('style') ?? '';
    expect(fetch).toHaveBeenCalledOnce();
    expect(style).toContain('width:63px');
    expect(style).toContain('height:auto');
    expect(style).toContain('max-width:none!important');
    expect(style).not.toContain('height:63px');
    expect(style).not.toContain('max-width:100%');
  });

  it('keeps intrinsic theme-image sizing when background-size is omitted', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2>Intrinsic heading</h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Intrinsic heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H2' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            'background-image': `url("${imageUrl}")`,
            'background-position': 'center center',
            'background-repeat': 'no-repeat'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const imageStyle = holder.querySelector('h2 > img')?.getAttribute('style') ?? '';
    expect(fetch).toHaveBeenCalledOnce();
    expect(imageStyle).toContain('max-width:none!important');
    expect(imageStyle).not.toMatch(/(?:^|;)width:/);
    expect(imageStyle).not.toMatch(/(?:^|;)height:/);
  });

  it('preserves cover and contain theme-image sizing as object-fit overlays', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2 data-fit="cover">Cover heading</h2><h2 data-fit="contain">Contain heading</h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Cover heading\nContain heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H2' === element.tagName && !pseudoElement) {
          const fit = element.getAttribute('data-fit') ?? 'cover';
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            'background-image': `url("${imageUrl}")`,
            'background-position': 'center center',
            'background-repeat': 'no-repeat',
            'background-size': fit
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('h2 > img')];
    expect(fetch).toHaveBeenCalledOnce();
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute('style')).toContain('width:100%');
    expect(images[0]?.getAttribute('style')).toContain('height:100%');
    expect(images[0]?.getAttribute('style')).toContain('object-fit:cover');
    expect(images[1]?.getAttribute('style')).toContain('width:100%');
    expect(images[1]?.getAttribute('style')).toContain('height:100%');
    expect(images[1]?.getAttribute('style')).toContain('object-fit:contain');
  });

  it('preserves edge offsets in four-token theme-image positions', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h3>Offset heading</h3>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Offset heading' });
    const imageUrl = new URL('/assets/images/fullstack-blue-h3.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H3' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            'background-image': `url("${imageUrl}")`,
            'background-position': 'right 12px bottom 6px',
            'background-repeat': 'no-repeat',
            'background-size': '20px 20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const imageStyle = holder.querySelector('h3 > img')?.getAttribute('style') ?? '';
    expect(imageStyle).toContain('right:12px');
    expect(imageStyle).toContain('bottom:6px');
    expect(imageStyle).not.toContain('top:12px');
    expect(imageStyle).not.toContain('left:12px');
  });

  it('preserves ordinary theme decoration layout styles', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2><span class="suffix">Decoration</span>Heading</h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'DecorationHeading' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'SPAN' === element.tagName && element.classList.contains('suffix')) {
          return declaration({
            display: 'flex',
            flex: '0 0 15px',
            'flex-grow': '0',
            'flex-shrink': '0',
            'flex-basis': '15px',
            width: '200px',
            height: '10px',
            float: 'right',
            'box-sizing': 'border-box'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const suffixStyle = holder.querySelector('h2 > span')?.getAttribute('style') ?? '';
    expect(suffixStyle).toContain('width:200px');
    expect(suffixStyle).toContain('height:10px');
    expect(suffixStyle).toContain('flex:0 0 15px');
    expect(suffixStyle).toContain('flex-shrink:0');
    expect(suffixStyle).toContain('flex-basis:15px');
    expect(suffixStyle).toContain('float:right');
    expect(suffixStyle).toContain('box-sizing:border-box');
  });

  it('protects generated empty heading after markers across both Clipboard paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h1 class="generated-h1">H1</h1>',
      '<h2 class="generated-h2">H2</h2>',
      '<h3 class="generated-h3">H3</h3>',
      '<h4 class="generated-h4">H4</h4>',
      '<h2 class="before">Before</h2>',
      '<h2 class="absolute">Absolute</h2>',
      '<h2 class="fixed">Fixed</h2>',
      '<h2 class="sticky">Sticky</h2>',
      '<h2 class="display-none">None</h2>',
      '<h2 class="visibility-hidden">Hidden</h2>',
      '<h2 class="opacity-zero">Transparent</h2>',
      '<h2 class="transparent">No paint</h2>',
      '<h2 class="auto-width">Auto width</h2>',
      '<h2 class="auto-height">Auto height</h2>',
      '<h2 class="blocked-paint">Blocked paint</h2>',
      '<h2 class="oversized">Oversized</h2>',
      '<h2 class="zero-size">Zero size</h2>',
      '<h2 class="url-content">URL</h2>',
      '<h2 class="attr-content">Attr</h2>',
      '<h2 class="counter-content">Counter</h2>',
      '<h2 class="text-content">Text</h2>',
      '<p class="nonheading">Nonheading</p>',
      '<p>Authored \u2060 and \uFEFF</p>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText =
      'H1\nH2\nH3\nH4\nBefore\nAbsolute\nFixed\nSticky\nNone\nHidden\nTransparent\nNo paint\nAuto width\nAuto height\nBlocked paint\nOversized\nZero size\nURL\nAttr\nCounter\nText\nNonheading\nAuthored \u2060 and \uFEFF';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const positiveClasses = new Set(['generated-h1', 'generated-h2', 'generated-h3', 'generated-h4']);
    const pseudoContentByClass: Record<string, string> = {
      before: '""',
      absolute: '""',
      fixed: '""',
      sticky: '""',
      'display-none': '""',
      'visibility-hidden': '""',
      'opacity-zero': '""',
      transparent: '""',
      'auto-width': '""',
      'auto-height': '""',
      'blocked-paint': '""',
      oversized: '""',
      'zero-size': '""',
      nonheading: '""',
      'url-content': 'url("/assets/images/heading.png")',
      'attr-content': 'attr(data-heading)',
      'counter-content': 'counter(heading)',
      'text-content': 'open-quote'
    };
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) {
        const className = [...element.classList][0] ?? '';
        if ('::before' === pseudoElement) {
          return 'before' === className
            ? declaration({
                'background-color': 'rgb(1, 2, 3)',
                content: '""',
                display: 'block',
                height: '6px',
                opacity: '1',
                position: 'relative',
                visibility: 'visible',
                width: '12px'
              })
            : declaration({ content: 'none' });
        }
        if ('before' === className) return declaration({ content: 'none' });
        if (positiveClasses.has(className)) {
          return declaration({
            'background-color': 'rgb(1, 2, 3)',
            content: '""',
            display: 'block',
            height: '6px',
            opacity: '1',
            position: 'relative',
            visibility: 'visible',
            width: '12px'
          });
        }
        if (element === preview) {
          return declaration({
            'background-color': 'rgb(1, 2, 3)',
            content: '""',
            display: 'block',
            height: '6px',
            opacity: '1',
            position: 'relative',
            visibility: 'visible',
            width: '12px'
          });
        }
        return declaration({
          'background-color': 'rgb(1, 2, 3)',
          content: pseudoContentByClass[className] ?? 'none',
          display: ['display-none'].includes(className) ? 'none' : 'block',
          height: ['auto-height'].includes(className) ? 'auto' : '6px',
          opacity: ['opacity-zero'].includes(className) ? '0' : '1',
          position: ['absolute', 'fixed', 'sticky'].includes(className) ? className : 'relative',
          visibility: ['visibility-hidden'].includes(className) ? 'hidden' : 'visible',
          width: ['auto-width'].includes(className)
            ? 'auto'
            : ['oversized'].includes(className)
              ? '400px'
              : ['zero-size'].includes(className)
                ? '0px'
                : '12px',
          ...(className === 'transparent' ? { 'background-color': 'rgba(0, 0, 0, 0)' } : {}),
          ...(className === 'blocked-paint'
            ? {
                'background-color': 'rgba(0, 0, 0, 0)',
                background:
                  'rgba(0,0,0,0) url("https://blocked.example/paint.png") repeat scroll 0% 0% / auto padding-box border-box',
                'background-image': 'url("https://blocked.example/paint.png")'
              }
            : {})
        });
      }
      return declaration({ display: 'block', visibility: 'visible' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const modernWrites: unknown[] = [];
    const modern = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        modernWrites.push(items);
      }
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('generated heading payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(await blobText(modernTextBlob)).toBe(sourceText.replace('\u2060', ''));
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const headingMarkers = [
      ...modernHolder.querySelectorAll(
        'h1 > span[aria-hidden="true"], h2 > span[aria-hidden="true"], h3 > span[aria-hidden="true"], h4 > span[aria-hidden="true"]'
      )
    ];
    const markers = headingMarkers.filter((marker) => marker.textContent === '\u2060');
    expect(markers).toHaveLength(4);
    expect(headingMarkers.filter((marker) => marker.textContent === ' ')).toHaveLength(13);
    markers.forEach((marker) => {
      expect(marker.textContent).toBe('\u2060');
      expect(marker.getAttribute('style')).toContain('width:12px');
      expect(marker.getAttribute('style')).toContain('height:6px');
      expect(marker.getAttribute('style')).toContain('background-color:rgb(1, 2, 3)');
    });
    [
      'Before',
      'Absolute',
      'Fixed',
      'Sticky',
      'None',
      'Hidden',
      'Transparent',
      'No paint',
      'Auto width',
      'Auto height',
      'Blocked paint',
      'Oversized',
      'Zero size'
    ].forEach((text) => {
      const heading = [...modernHolder.querySelectorAll('h2')].find(
        (element) => element.textContent?.replaceAll('\u2060', '').trim() === text
      );
      expect(heading?.querySelector(':scope > span[aria-hidden="true"]')?.textContent).toBe(' ');
    });
    ['URL', 'Attr', 'Counter', 'Text'].forEach((text) => {
      const heading = [...modernHolder.querySelectorAll('h2')].find(
        (element) => element.textContent?.replaceAll('\u2060', '').trim() === text
      );
      expect(heading?.querySelector(':scope > span[aria-hidden="true"]')).toBeNull();
    });
    const nativeLike = modernHolder.cloneNode(true) as HTMLElement;
    nativeLike.querySelectorAll('span[aria-hidden="true"]').forEach((marker) => {
      if (' ' === marker.textContent || '' === marker.textContent) marker.remove();
    });
    expect(nativeLike.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(4);
    expect(
      [...nativeLike.querySelectorAll('span[aria-hidden="true"]')].every((marker) => marker.textContent === '\u2060')
    ).toBe(true);
    const nonheading = [...modernHolder.querySelectorAll('p')].find(
      (element) => element.textContent?.replaceAll('\u2060', '').trim() === 'Nonheading'
    );
    expect(nonheading?.querySelector(':scope > span[aria-hidden="true"]')?.textContent).toBe(' ');
    expect(modernHtml).toContain('Authored \u2060 and \uFEFF');
    expect(preview.innerHTML).toBe(sourceMarkup);

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('does not protect a generated marker on an H1 root', async () => {
    const preview = document.createElement('h1');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.textContent = 'Root heading';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Root heading' });
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) =>
        pseudoElement
          ? declaration({
              'background-color': 'rgb(1, 2, 3)',
              content: '""',
              display: 'block',
              height: '6px',
              opacity: '1',
              position: 'relative',
              visibility: 'visible',
              width: '12px'
            })
          : declaration({ display: 'block', visibility: 'visible' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const html = item?.payload['text/html'];
    if (!html) throw new Error('root heading HTML missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(html);
    expect(holder.querySelector('h1 > span[aria-hidden="true"]')?.textContent).toBe(' ');
    expect(holder.querySelector('h1 > span[aria-hidden="true"]')?.textContent).not.toBe('\u2060');
  });

  it('carries finite negative heading paint through both Clipboard paths', async () => {
    type Variant = 'positive' | 'drop-carrier' | 'clear-paint' | 'clear-opacity' | 'clear-radius';
    const sourceMarkup = '<h3>Cherry heading</h3>';
    let firstLeft = -6;
    let translateX = 0;
    const translateY = -7.9219;
    let autoDimensions = false;
    let zeroDimension: 'height' | 'width' | null = null;
    let sourceVisibility = 'visible';
    let sourceOpacity = '1';
    let pseudoVisibility = 'visible';
    let pseudoOpacity = '1';
    let sourcePaddingLeft = '10px';
    let sourcePaddingTop = '0px';
    let pseudoPadding = '0px';
    type NonEligibleCase =
      | 'missing-source-visibility'
      | 'missing-source-opacity'
      | 'source-opacity-over-one'
      | 'missing-pseudo-visibility'
      | 'missing-pseudo-opacity'
      | 'pseudo-opacity-over-one'
      | 'negative-source-padding'
      | 'negative-pseudo-padding';
    const nonEligibleCases: readonly NonEligibleCase[] = [
      'missing-source-visibility',
      'missing-source-opacity',
      'source-opacity-over-one',
      'missing-pseudo-visibility',
      'missing-pseudo-opacity',
      'pseudo-opacity-over-one',
      'negative-source-padding',
      'negative-pseudo-padding'
    ];
    const applyNonEligibleCase = (caseName: NonEligibleCase): void => {
      sourceVisibility = 'visible';
      sourceOpacity = '1';
      pseudoVisibility = 'visible';
      pseudoOpacity = '1';
      sourcePaddingLeft = '10px';
      sourcePaddingTop = '0px';
      pseudoPadding = '0px';
      if ('missing-source-visibility' === caseName) sourceVisibility = '';
      if ('missing-source-opacity' === caseName) sourceOpacity = '';
      if ('source-opacity-over-one' === caseName) sourceOpacity = '1.01';
      if ('missing-pseudo-visibility' === caseName) pseudoVisibility = '';
      if ('missing-pseudo-opacity' === caseName) pseudoOpacity = '';
      if ('pseudo-opacity-over-one' === caseName) pseudoOpacity = '1.01';
      if ('negative-source-padding' === caseName) {
        sourcePaddingLeft = '-1px';
        sourcePaddingTop = '-1px';
      }
      if ('negative-pseudo-padding' === caseName) pseudoPadding = '-1px';
    };
    const styleFor = (_variant: Variant, element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) {
        if ('H3' !== element.tagName || '::before' !== pseudoElement) {
          return declaration({ content: 'none' });
        }
        return declaration({
          background: 'rgb(1, 2, 3)',
          'background-color': 'rgb(1, 2, 3)',
          'background-image': 'none',
          'border-bottom-style': 'none',
          'border-bottom-width': '0px',
          'border-radius': '2px',
          'border-left-style': 'none',
          'border-left-width': '0px',
          'border-right-style': 'none',
          'border-right-width': '0px',
          'border-top-style': 'none',
          'border-top-width': '0px',
          'box-shadow': 'none',
          content: '""',
          display: 'block',
          filter: 'none',
          height: 'height' === zeroDimension ? '0px' : autoDimensions ? 'auto' : '15.8438px',
          left: `${firstLeft}px`,
          'margin-left': '0px',
          'margin-top': '0px',
          opacity: pseudoOpacity,
          'padding-bottom': pseudoPadding,
          'padding-left': pseudoPadding,
          'padding-right': pseudoPadding,
          'padding-top': pseudoPadding,
          position: 'absolute',
          top: '12.9844px',
          transform: `matrix(1, 0, 0, 1, ${translateX}, ${translateY})`,
          visibility: pseudoVisibility,
          width: 'width' === zeroDimension ? '0px' : autoDimensions ? 'auto' : '5px'
        });
      }
      if ('H3' === element.tagName) {
        return declaration({
          'border-left-width': '0px',
          'border-right-width': '0px',
          'border-bottom-width': '0px',
          'border-top-width': '0px',
          display: 'block',
          opacity: sourceOpacity,
          'padding-left': sourcePaddingLeft,
          'padding-top': sourcePaddingTop,
          position: 'relative',
          transform: 'none',
          visibility: sourceVisibility
        });
      }
      return declaration({ display: 'block', visibility: 'visible' });
    };
    const createPreview = (): HTMLElement => {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = sourceMarkup;
      const heading = preview.querySelector('h3');
      if (!heading) throw new Error('heading flow source missing');
      Object.defineProperty(heading, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ bottom: 15.8438, height: 15.8438, left: 0, right: 300, top: 0, width: 300, x: 0, y: 0 })
      });
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Cherry heading' });
      return preview;
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const createClipboard = (variant: Variant, writes: unknown[]) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => styleFor(variant, element, pseudoElement),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
    const inspectPositive = async (htmlBlob: Blob, textBlob?: Blob): Promise<string> => {
      const html = await blobText(htmlBlob);
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const headings = [...holder.querySelectorAll('h3')];
      expect(headings).toHaveLength(1);
      const first = headings[0];
      if (!first) throw new Error('heading flow output missing');
      const firstMarker = first.querySelector(':scope > span[aria-hidden="true"]');
      expect(firstMarker?.textContent).toBe('\u2060');
      expect(first.getAttribute('style')).toContain('padding-left:16px!important');
      expect(firstMarker?.getAttribute('style')).toContain('margin-left:-16px!important');
      expect(firstMarker?.getAttribute('style')).toContain('margin-right:11px!important');
      const marginTop = Number.parseFloat(
        (firstMarker as HTMLElement | null)?.style.getPropertyValue('margin-top') ?? ''
      );
      expect(marginTop).toBeCloseTo(5.0625, 6);
      expect(firstMarker?.getAttribute('style')).toContain('float:left!important');
      expect(firstMarker?.getAttribute('style')).toContain('position:static!important');
      expect(firstMarker?.getAttribute('style')).toContain('transform:none!important');
      expect(firstMarker?.getAttribute('style')).toContain('opacity:1!important');
      expect(firstMarker?.getAttribute('style')).toContain('border-radius:2px!important');
      if (textBlob) expect(await blobText(textBlob)).toBe('Cherry heading');
      return html;
    };
    const inspectOriginal = async (htmlBlob: Blob, textBlob?: Blob): Promise<void> => {
      const html = await blobText(htmlBlob);
      expect(html).toContain('Cherry heading');
      expect(html).not.toContain('\u2060');
      expect(html).not.toContain('padding-left:16px!important');
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const marker = holder.querySelector('h3 > span[aria-hidden="true"]');
      expect(marker?.textContent).toBe(' ');
      expect((marker as HTMLElement | null)?.style.position).toBe('absolute');
      if (textBlob) await expect(blobText(textBlob)).resolves.toBe(' Cherry heading');
    };

    const modernPreview = createPreview();
    const modernWrites: unknown[] = [];
    const modern = createClipboard('positive', modernWrites);
    await expect(modern.copy(modernPreview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtml = modernItem?.payload['text/html'];
    const modernText = modernItem?.payload['text/plain'];
    if (!modernHtml || !modernText) throw new Error('heading flow modern payload missing');
    const positiveHtml = await inspectPositive(modernHtml, modernText);
    firstLeft = -10;
    await expect(modern.copy(modernPreview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const refreshedItem = (modernWrites[1] as ClipboardItemStub[])[0];
    const refreshedHtml = refreshedItem?.payload['text/html'];
    if (!refreshedHtml) throw new Error('heading flow refreshed payload missing');
    const refreshedMarkup = await blobText(refreshedHtml);
    expect(refreshedMarkup).toContain('padding-left:20px!important');
    expect(refreshedMarkup).toContain('margin-left:-20px!important');
    firstLeft = -6;

    translateX = -8;
    firstLeft = 2;
    const composedNegativePreview = createPreview();
    const composedNegativeWrites: unknown[] = [];
    const composedNegative = createClipboard('positive', composedNegativeWrites);
    await expect(composedNegative.copy(composedNegativePreview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const composedNegativeItem = (composedNegativeWrites[0] as ClipboardItemStub[])[0];
    const composedNegativeHtml = composedNegativeItem?.payload['text/html'];
    if (!composedNegativeHtml) throw new Error('heading flow composed negative payload missing');
    await inspectPositive(composedNegativeHtml);

    translateX = 8;
    firstLeft = -6;
    autoDimensions = true;
    const composedPositivePreview = createPreview();
    const composedPositiveWrites: unknown[] = [];
    const composedPositive = createClipboard('positive', composedPositiveWrites);
    await expect(composedPositive.copy(composedPositivePreview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const composedPositiveItem = (composedPositiveWrites[0] as ClipboardItemStub[])[0];
    const composedPositiveHtml = composedPositiveItem?.payload['text/html'];
    if (!composedPositiveHtml) throw new Error('heading flow composed positive payload missing');
    const composedPositiveHolder = document.createElement('div');
    composedPositiveHolder.innerHTML = await blobText(composedPositiveHtml);
    expect(composedPositiveHolder.querySelector('h3 > span[aria-hidden="true"]')?.textContent).toBe(' ');
    expect(
      (composedPositiveHolder.querySelector('h3 > span[aria-hidden="true"]') as HTMLElement | null)?.style.position
    ).toBe('absolute');
    autoDimensions = false;
    translateX = 0;
    firstLeft = -6;

    for (const dimension of ['width', 'height'] as const) {
      zeroDimension = dimension;
      const zeroPreview = createPreview();
      const zeroWrites: unknown[] = [];
      const zeroClipboard = createClipboard('positive', zeroWrites);
      const zeroResult = await zeroClipboard.copy(zeroPreview);
      expect(zeroPreview.innerHTML).toBe(sourceMarkup);
      const zeroItem = (zeroWrites[0] as ClipboardItemStub[])[0];
      const zeroHtml = zeroItem?.payload['text/html'];
      const zeroText = zeroItem?.payload['text/plain'];
      if (!zeroHtml || !zeroText) throw new Error('heading flow zero-dimension payload missing');
      const zeroMarkup = await blobText(zeroHtml);
      expect(zeroMarkup).toContain('Cherry heading');
      expect(zeroMarkup).not.toContain('\u2060');
      expect(zeroMarkup).not.toContain('padding-left:16px!important');
      const zeroHolder = document.createElement('div');
      zeroHolder.innerHTML = zeroMarkup;
      const zeroMarker = zeroHolder.querySelector('h3 > span[aria-hidden="true"]');
      expect(zeroMarker?.textContent).toBe(' ');
      expect((zeroMarker as HTMLElement | null)?.style.position).toBe('absolute');
      await expect(blobText(zeroText)).resolves.toBe(' Cherry heading');
      expect(zeroResult).toEqual({ method: 'clipboard', status: 'copied' });
    }
    zeroDimension = null;
    for (const caseName of nonEligibleCases) {
      applyNonEligibleCase(caseName);
      const nonEligiblePreview = createPreview();
      const nonEligibleWrites: unknown[] = [];
      const nonEligibleClipboard = createClipboard('positive', nonEligibleWrites);
      const nonEligibleResult = await nonEligibleClipboard.copy(nonEligiblePreview);
      expect(nonEligiblePreview.innerHTML).toBe(sourceMarkup);
      const nonEligibleItem = (nonEligibleWrites[0] as ClipboardItemStub[])[0];
      const nonEligibleHtml = nonEligibleItem?.payload['text/html'];
      const nonEligibleText = nonEligibleItem?.payload['text/plain'];
      if (!nonEligibleHtml || !nonEligibleText) throw new Error('heading flow noneligible payload missing');
      await inspectOriginal(nonEligibleHtml, nonEligibleText);
      expect(nonEligibleResult).toEqual({ method: 'clipboard', status: 'copied' });
    }
    sourceVisibility = 'visible';
    sourceOpacity = '1';
    pseudoVisibility = 'visible';
    pseudoOpacity = '1';
    sourcePaddingLeft = '10px';
    sourcePaddingTop = '0px';
    pseudoPadding = '0px';
    expect(modernPreview.innerHTML).toBe(sourceMarkup);

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacyPreview = createPreview();
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (element, pseudoElement) => styleFor('positive', element, pseudoElement),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, legacyPreview);
      await expect(legacy.copy(legacyPreview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(positiveHtml);
      expect(legacyPreview.innerHTML).toBe(sourceMarkup);

      for (const dimension of ['width', 'height'] as const) {
        zeroDimension = dimension;
        const zeroLegacyPreview = createPreview();
        const zeroLegacy = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle: (element, pseudoElement) => styleFor('positive', element, pseudoElement),
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        await prepareClipboard(zeroLegacy, zeroLegacyPreview);
        await expect(zeroLegacy.copy(zeroLegacyPreview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
        expect(zeroLegacyPreview.innerHTML).toBe(sourceMarkup);
        expect(legacyHtml).toContain('Cherry heading');
        expect(legacyHtml).not.toContain('\u2060');
        expect(legacyHtml).not.toContain('padding-left:16px!important');
        expect(legacyHtml).toContain('position:absolute');
      }
      zeroDimension = null;
      for (const caseName of nonEligibleCases) {
        applyNonEligibleCase(caseName);
        const nonEligibleLegacyPreview = createPreview();
        const nonEligibleLegacy = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle: (element, pseudoElement) => styleFor('positive', element, pseudoElement),
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        await prepareClipboard(nonEligibleLegacy, nonEligibleLegacyPreview);
        await expect(nonEligibleLegacy.copy(nonEligibleLegacyPreview)).resolves.toEqual({
          method: 'legacy',
          status: 'copied'
        });
        expect(nonEligibleLegacyPreview.innerHTML).toBe(sourceMarkup);
        expect(legacyHtml).toContain('Cherry heading');
        expect(legacyHtml).not.toContain('\u2060');
        expect(legacyHtml).not.toContain('padding-left:16px!important');
        expect(legacyHtml).toContain('position:absolute');
      }
      sourceVisibility = 'visible';
      sourceOpacity = '1';
      pseudoVisibility = 'visible';
      pseudoOpacity = '1';
      sourcePaddingLeft = '10px';
      sourcePaddingTop = '0px';
      pseudoPadding = '0px';
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }

    const faultCases: ReadonlyArray<Readonly<{ expectedError: string; variant: Variant }>> = [
      { expectedError: 'wechat-heading-pseudo-flow-carrier-missing', variant: 'drop-carrier' },
      { expectedError: 'wechat-heading-pseudo-flow-paint-mismatch', variant: 'clear-paint' },
      { expectedError: 'wechat-heading-pseudo-flow-paint-mismatch', variant: 'clear-opacity' },
      { expectedError: 'wechat-heading-pseudo-flow-geometry-mismatch', variant: 'clear-radius' }
    ];
    for (const { expectedError, variant } of faultCases) {
      const preview = createPreview();
      const writes: unknown[] = [];
      const originalInsertBefore = Node.prototype.insertBefore;
      const originalSetAttribute = Element.prototype.setAttribute;
      let faultHit = false;
      if ('drop-carrier' === variant) {
        Object.defineProperty(Node.prototype, 'insertBefore', {
          configurable: true,
          value: function (this: Node, node: Node, _reference: Node | null): Node {
            if (
              this instanceof HTMLElement &&
              'H3' === this.tagName &&
              node instanceof HTMLSpanElement &&
              'true' === node.getAttribute('aria-hidden')
            ) {
              faultHit = true;
              return node;
            }
            return originalInsertBefore.call(this, node, _reference);
          }
        });
      }
      if ('clear-paint' === variant || 'clear-opacity' === variant || 'clear-radius' === variant) {
        Object.defineProperty(Element.prototype, 'setAttribute', {
          configurable: true,
          value: function (this: Element, name: string, value: string): void {
            if (
              'style' === name &&
              'true' === this.getAttribute('aria-hidden') &&
              ('clear-radius' === variant
                ? value.includes('border-radius:') && value.includes('margin-top:')
                : value.includes('float:left!important')) &&
              ('clear-paint' === variant
                ? value.includes('background-color:')
                : 'clear-opacity' === variant
                  ? value.includes('opacity:')
                  : value.includes('border-radius:'))
            ) {
              faultHit = true;
              value =
                'clear-paint' === variant
                  ? value
                      .replace(/(?:^|;)background-color:[^;]*/u, '')
                      .replace(/(?:^|;)background:[^;]*/u, '')
                  : 'clear-opacity' === variant
                    ? value.replace(/(?:^|;)opacity:[^;]*/u, '')
                    : value.replace(/border-radius:[^;]*/gu, '');
            }
            originalSetAttribute.call(this, name, value);
          }
        });
      }
      try {
        const clipboard = createClipboard(variant, writes);
        const faultResult = await clipboard.copy(preview);
        expect(faultHit).toBe(true);
        expect(faultResult).toEqual({ code: 'wechat-copy-failed', status: 'failed' });
        const item = (writes[0] as ClipboardItemStub[])[0];
        const htmlBlob = item?.payload['text/html'];
        if (!htmlBlob) throw new Error('heading flow fault payload missing');
        await expect(blobText(htmlBlob)).rejects.toThrow(expectedError);
        expect(preview.innerHTML).toBe(sourceMarkup);
      } finally {
        Object.defineProperty(Node.prototype, 'insertBefore', { configurable: true, value: originalInsertBefore });
        Object.defineProperty(Element.prototype, 'setAttribute', { configurable: true, value: originalSetAttribute });
      }
    }
  });

  it('keeps unsupported empty heading before paint on the original path', async () => {
    type Case = 'border' | 'auto' | 'percentage' | 'positive' | 'transform' | 'negative-rotation' | 'negative-3d';
    const cases: readonly Case[] = [
      'border',
      'auto',
      'percentage',
      'positive',
      'transform',
      'negative-rotation',
      'negative-3d'
    ];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    for (const caseName of cases) {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<h3>Existing path</h3>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Existing path' });
      const writes: unknown[] = [];
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('H3' === element.tagName && '::before' === pseudoElement) {
            return declaration({
              background: 'rgb(1, 2, 3)',
              'background-color': 'rgb(1, 2, 3)',
              'background-image': 'none',
              'border-bottom-style': 'none',
              'border-bottom-width': '0px',
              'border-left-style': 'none',
              'border-left-width': '0px',
              'border-radius': '2px',
              'border-right-style': 'none',
              'border-right-width': '0px',
              'border-top-style': 'border' === caseName ? 'solid' : 'none',
              'border-top-width': 'border' === caseName ? '1px' : '0px',
              'box-shadow': 'none',
              content: '""',
              display: 'block',
              filter: 'none',
              height: '5px',
              left:
                'auto' === caseName
                  ? 'auto'
                  : 'percentage' === caseName
                    ? '50%'
                    : 'negative-rotation' === caseName || 'negative-3d' === caseName
                      ? '-6px'
                      : '2px',
              opacity: '1',
              'padding-bottom': '0px',
              'padding-left': '0px',
              'padding-right': '0px',
              'padding-top': '0px',
              position: 'absolute',
              right: 'auto' === caseName ? '0px' : 'auto',
              top: '2px',
              transform:
                'transform' === caseName || 'negative-rotation' === caseName
                  ? 'matrix(0, 1, -1, 0, 0, 0)'
                  : 'negative-3d' === caseName
                    ? 'matrix3d(0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'
                    : 'none',
              visibility: 'visible',
              width: '5px'
            });
          }
          if ('H3' === element.tagName) {
            return declaration({
              'border-bottom-width': '0px',
              'border-left-width': '0px',
              'border-right-width': '0px',
              'border-top-width': '0px',
              display: 'block',
              'padding-left': '10px',
              'padding-top': '0px',
              position: 'relative',
              transform: 'none',
              visibility: 'visible'
            });
          }
          return declaration({ display: 'block', visibility: 'visible' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error('unsupported heading path payload missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(html);
      const marker = holder.querySelector('h3 > span[aria-hidden="true"]');
      expect(marker?.textContent).toBe(' ');
      expect(marker?.getAttribute('style')).toContain('position:absolute');
      expect(preview.innerHTML).toBe('<h3>Existing path</h3>');
    }
  });

  it('invalidates generated heading markers when visibility changes warm and in flight', async () => {
    let visibility = 'visible';
    let includeImage = false;
    const imageUrl = new URL('/assets/images/generated-heading-race.png', document.baseURI).href;
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Visibility race</h1>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Visibility race' });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const writes: string[] = [];
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::after' === pseudoElement) {
          return declaration({
            'background-color': includeImage ? 'transparent' : 'rgb(1, 2, 3)',
            background: includeImage ? `transparent url("${imageUrl}")` : 'rgb(1, 2, 3)',
            'background-image': includeImage ? `url("${imageUrl}")` : 'none',
            content: '""',
            display: 'block',
            height: '6px',
            opacity: '1',
            position: 'relative',
            visibility,
            width: '12px'
          });
        }
        return declaration({ display: 'block', visibility: 'visible' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('visibility race HTML missing');
        writes.push(await blobText(html));
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes[0]).toContain('\u2060');
    visibility = 'hidden';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes[1]).not.toContain('\u2060');

    visibility = 'visible';
    includeImage = true;
    const preparation = prepareClipboard(clipboard, preview, { background: true });
    await fetchStarted.promise;
    visibility = 'hidden';
    pendingImage.resolve({
      blob: async () => new Blob(['heading image'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(preparation).rejects.toThrow('wechat-copy-stale');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('protects a visible painted empty PHP theme heading suffix in both Clipboard paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<h2><span class="prefix"></span><span class="content">Heading</span><span class="suffix"></span></h2>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Heading' });
    const suffix = preview.querySelector<HTMLElement>('.suffix');
    if (!suffix) throw new Error('heading suffix fixture missing');
    Object.defineProperty(suffix, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 30, height: 10, left: 0, right: 200, top: 20, width: 200, x: 0, y: 20 })
    });
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      if ('SPAN' === element.tagName && element.classList.contains('suffix')) {
        return declaration({
          'background-color': 'rgb(1, 2, 3)',
          display: 'block',
          height: '10px',
          opacity: '1',
          visibility: 'visible',
          width: '200px'
        });
      }
      if ('SPAN' === element.tagName) {
        return declaration({ display: 'inline', visibility: 'visible' });
      }
      return declaration({ display: 'block', visibility: 'visible' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modernWrites: unknown[] = [];
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('heading suffix payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(await blobText(modernTextBlob)).toBe('Heading');
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    expect(modernHolder.querySelector('h2 > span:nth-child(3)')?.textContent).toBe('\u2060');

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createRuntime(null, null);
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it('keeps a visible suffix marked inside an opacity-zero measurement host', async () => {
    const host = document.createElement('div');
    host.className = 'easymde-wechat-preview-measurement';
    host.style.opacity = '0';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<h2><span class="prefix"></span><span class="content">Hidden host</span><span class="suffix"></span></h2>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Hidden host' });
    const suffix = preview.querySelector<HTMLElement>('.suffix');
    if (!suffix) throw new Error('measurement suffix fixture missing');
    Object.defineProperty(suffix, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 200 })
    });
    host.append(preview);
    document.body.append(host);
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('SPAN' === element.tagName && element.classList.contains('suffix')) {
          return declaration({
            'background-color': 'rgba(64, 184, 250, 1)',
            display: 'inline-block',
            height: '10px',
            opacity: '1',
            visibility: 'visible',
            width: '200px'
          });
        }
        return declaration({ display: 'block', visibility: 'visible' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });
    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('measurement suffix HTML missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(htmlBlob);
      expect(holder.querySelector('h2 > span:nth-child(3)')?.textContent).toBe('\u2060');
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      host.remove();
    }
  });

  it('does not mark malformed, authored, hidden, unpainted, or ordinary suffix-like spans', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h2 class="single"><span class="suffix"></span>Single</h2>',
      '<h2 class="single-class"><span class="prefix"></span><span class="content">Single class</span><span class="suffix extra"></span></h2>',
      '<h2 class="direct-text"><span class="prefix"></span><span class="content">Direct</span>tail<span class="suffix"></span></h2>',
      '<h2 class="image-suffix"><span class="prefix"></span><span class="content">Image</span><span class="suffix"><img alt="decoration"></span></h2>',
      '<h2 class="nonempty"><span class="prefix"></span><span class="content">Nonempty</span><span class="suffix">suffix</span></h2>',
      '<h2 class="hidden"><span class="prefix"></span><span class="content">Hidden</span><span class="suffix"></span></h2>',
      '<h2 class="unpainted"><span class="prefix"></span><span class="content">Unpainted</span><span class="suffix"></span></h2>',
      '<h2 class="unpainted-slash"><span class="prefix"></span><span class="content">Unpainted slash</span><span class="suffix"></span></h2>',
      '<h2 class="unpainted-color"><span class="prefix"></span><span class="content">Unpainted color</span><span class="suffix"></span></h2>',
      '<p><span class="suffix">Ordinary</span></p>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText =
      'Single\nSingle class\nDirecttail\nImage\nNonemptysuffix\nHidden\nUnpainted\nUnpainted slash\nUnpainted color\nOrdinary';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    preview.querySelectorAll<HTMLElement>('h2 > span.suffix').forEach((suffix) => {
      Object.defineProperty(suffix, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ bottom: 30, height: 10, left: 0, right: 200, top: 20, width: 200, x: 0, y: 20 })
      });
    });
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('SPAN' === element.tagName && element.classList.contains('suffix')) {
          const parentClass = element.parentElement?.className;
          if ('hidden' === parentClass) {
            return declaration({
              'background-color': 'rgb(1, 2, 3)',
              display: 'none',
              height: '10px',
              visibility: 'hidden',
              width: '200px'
            });
          }
          if ('unpainted' === parentClass) {
            return declaration({
              'background-color': 'rgba(64, 184, 250, 0)',
              'background-image': 'none',
              display: 'inline-block',
              height: '10px',
              visibility: 'visible',
              width: '200px'
            });
          }
          if ('unpainted-slash' === parentClass) {
            return declaration({
              'background-color': 'rgb(64 184 250 / 0)',
              display: 'inline-block',
              height: '10px',
              visibility: 'visible',
              width: '200px'
            });
          }
          if ('unpainted-color' === parentClass) {
            return declaration({
              'background-color': 'color(srgb 0.25 0.72 0.98 / 0)',
              display: 'inline-block',
              height: '10px',
              visibility: 'visible',
              width: '200px'
            });
          }
          return declaration({
            'background-color': 'rgb(1, 2, 3)',
            display: 'inline-block',
            height: '10px',
            visibility: 'visible',
            width: '200px'
          });
        }
        return declaration({ display: 'block', visibility: 'visible' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('heading suffix negative payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('h2')).toHaveLength(9);
    expect(holder.textContent).not.toContain('\u2060');
    expect(await blobText(textBlob)).toBe(sourceText);
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('restores H2 suffix and code markers around connected plaintext with authored FEFF', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h2><span class="prefix"></span><span class="content">Heading</span><span class="suffix"></span></h2>',
      '<p>Body \uFEFF authored</p>',
      '<pre><code><span>#</span><span>336699</span>\n#\uFEFFauthored</code></pre>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText = 'Heading\nBody \uFEFF authored\n#336699\n#\uFEFFauthored';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const suffix = preview.querySelector<HTMLElement>('.suffix');
    if (!suffix) throw new Error('combined suffix fixture missing');
    Object.defineProperty(suffix, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 200 })
    });
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      if ('SPAN' === element.tagName && element.classList.contains('suffix')) {
        return declaration({
          'background-color': 'rgba(64, 184, 250, 1)',
          display: 'inline-block',
          height: '10px',
          opacity: '1',
          visibility: 'visible',
          width: '200px'
        });
      }
      if ('PRE' === element.tagName || 'CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre', visibility: 'visible' });
      }
      return declaration({ display: 'block', visibility: 'visible' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modernWrites: unknown[] = [];
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('combined marker payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(await blobText(modernTextBlob)).toBe(sourceText);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    expect(modernHolder.querySelector('h2 > span:nth-child(3)')?.textContent).toBe('\u2060');
    expect(modernHolder.querySelector('pre > code')?.textContent).toContain('#\uFEFF336699');
    expect(modernHolder.querySelector('pre > code')?.textContent).toContain('#\uFEFFauthored');
    expect(modernHolder.textContent).toContain('Body \uFEFF authored');

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createRuntime(null, null);
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }

    let measuredClone: HTMLElement | null = null;
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        if (this !== preview && this.querySelector('pre > code') && this.querySelector('h2')) {
          measuredClone = this;
          throw new Error('combined-plain-text-measurement-failed');
        }
        return this.textContent ?? '';
      }
    });
    try {
      const throwing = createRuntime(ClipboardItemStub, async () => undefined);
      await expect(throwing.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      const cloneAfterThrow = measuredClone as HTMLElement | null;
      expect(cloneAfterThrow?.querySelector('h2 > span:nth-child(3)')?.textContent).toBe('\u2060');
      expect(cloneAfterThrow?.querySelector('pre > code')?.textContent).toContain('#\uFEFF336699');
      expect(cloneAfterThrow?.textContent).toContain('Body \uFEFF authored');
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
    }
  });

  it('starts the Clipboard write while a theme image is still pending activation', async () => {
    let activation = true;
    let activationAtWrite = false;
    const pendingImage = deferred<Response>();
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch: vi.fn(() => pendingImage.promise),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        activationAtWrite = activation;
        writes.push(items);
        const item = items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> };
        const htmlPayload = item?.payload['text/html'];
        if (!htmlPayload) throw new Error('clipboard html missing');
        await blobText(htmlPayload);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    const copy = clipboard.copy(preview);
    expect(writes).toHaveLength(1);
    expect(activationAtWrite).toBe(true);
    activation = false;
    pendingImage.resolve({
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
      ok: true
    } as unknown as Response);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
  });

  it('does not wait for an obsolete background payload after the Preview theme changes', async () => {
    const oldImage = deferred<Response>();
    const oldImageUrl = new URL('/assets/images/theme-old.png', document.baseURI).href;
    const newImageUrl = new URL('/assets/images/theme-new.png', document.baseURI).href;
    const writes: unknown[] = [];
    let newTheme = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('theme-old')) return oldImage.promise;
      return Promise.resolve({
        blob: async () => new Blob(['new'], { type: 'image/png' }),
        ok: true,
        url: newImageUrl
      } as unknown as Response);
    });
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme switch</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme switch' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          const imageUrl = newTheme ? newImageUrl : oldImageUrl;
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const obsoletePreparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    preview.classList.add('theme-new');
    newTheme = true;

    const copy = clipboard.copy(preview);
    expect(writes).toHaveLength(1);
    await Promise.resolve();
    oldImage.resolve({
      blob: async () => new Blob(['old'], { type: 'image/png' }),
      ok: true,
      url: oldImageUrl
    } as unknown as Response);

    await expect(obsoletePreparation).rejects.toThrow('wechat-copy-stale');
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(fetch).toHaveBeenCalledTimes(2);
    const item = (writes[0] as ClipboardItemStub[])[0];
    const html = item?.payload['text/html'];
    if (!html) throw new Error('clipboard html missing');
    expect(await blobText(html)).toContain('data:image/png;base64,bmV3');
  });

  it('refreshes a same-markup copy after a pending background layout changes', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/layout-old.png', document.baseURI).href;
    const writes: unknown[] = [];
    let width = '100px';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Stable source</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Stable source' });
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({ display: 'block', height: '40px', width });
        }
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const obsoletePreparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    width = '200px';

    const copy = clipboard.copy(preview);
    expect(writes).toHaveLength(1);
    pendingImage.resolve({
      blob: async () => new Blob(['layout image'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);

    await expect(obsoletePreparation).rejects.toThrow('wechat-copy-stale');
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const html = item?.payload['text/html'];
    if (!html) throw new Error('clipboard html missing');
    expect(await blobText(html)).toContain('width:200px');
  });

  it('fails when the one fresh rebuild becomes stale during serialization', async () => {
    const obsoleteImage = deferred<Response>();
    const freshImage = deferred<Response>();
    const obsoleteImageUrl = new URL('/assets/images/layout-rebuild-old.png', document.baseURI).href;
    const freshImageUrl = new URL('/assets/images/layout-rebuild-fresh.png', document.baseURI).href;
    const writes: unknown[] = [];
    let committed = false;
    let width = '100px';
    let imageUrl = obsoleteImageUrl;
    let requestCount = 0;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Fresh rebuild</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Fresh rebuild' });
    const fetch = vi.fn(() => {
      requestCount += 1;
      return 1 === requestCount ? obsoleteImage.promise : freshImage.promise;
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({ display: 'block', height: '40px', width });
        }
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub | undefined;
        const html = item?.payload['text/html'];
        if (!html) throw new Error('clipboard html missing');
        await blobText(html);
        committed = true;
      }
    });

    const obsoletePreparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    width = '200px';
    const copy = clipboard.copy(preview);
    expect(writes).toHaveLength(1);
    obsoleteImage.resolve({
      blob: async () => new Blob(['obsolete'], { type: 'image/png' }),
      ok: true,
      url: obsoleteImageUrl
    } as unknown as Response);

    await expect(obsoletePreparation).rejects.toThrow('wechat-copy-stale');
    imageUrl = freshImageUrl;
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    width = '300px';
    freshImage.resolve({
      blob: async () => new Blob(['fresh'], { type: 'image/png' }),
      ok: true,
      url: freshImageUrl
    } as unknown as Response);

    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(committed).toBe(false);
  });

  it('fails when source markup changes after copy activation while preparation is pending', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/markup-after-copy.png', document.baseURI).href;
    const writes: unknown[] = [];
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Before copy</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Before copy' });
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub | undefined;
        const html = item?.payload['text/html'];
        if (!html) throw new Error('clipboard html missing');
        await blobText(html);
        committed = true;
      }
    });

    const obsoletePreparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const copy = clipboard.copy(preview);
    expect(writes).toHaveLength(1);
    preview.innerHTML = '<h1>Changed after copy</h1>';
    pendingImage.resolve({
      blob: async () => new Blob(['markup image'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);

    await expect(obsoletePreparation).rejects.toThrow('wechat-copy-stale');
    const result = await copy;
    if ('copied' === result.status) {
      const item = (writes[0] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error('clipboard html missing');
      expect(await blobText(html)).not.toContain('Changed after copy');
    }
    expect(committed).toBe(false);
    expect(result).toEqual({ code: 'wechat-copy-failed', status: 'failed' });
  });

  it('runs legacy copy synchronously only after theme-image preparation completes', async () => {
    const pendingImage = deferred<Response>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let activation = false;
    let activationAtCopy: boolean | null = null;
    const execCommand = vi.fn(() => {
      activationAtCopy = activation;
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => pendingImage.promise),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      const preparation = prepareClipboard(clipboard, preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();

      pendingImage.resolve({
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await preparation;
      activation = true;
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(activationAtCopy).toBe(true);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('keeps the last stable legacy payload during a layout-only refresh', async () => {
    const pendingImage = deferred<Response>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let includeDecoration = false;
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => pendingImage.promise),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement && includeDecoration) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await prepareClipboard(clipboard, preview);
      includeDecoration = true;
      const refresh = prepareClipboard(clipboard, preview);

      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).not.toContain('data:image/');

      pendingImage.resolve({
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await refresh;
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toContain('data:image/png;base64,');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('serializes coalesced background refreshes one at a time', async () => {
    const pendingA = deferred<Response>();
    const pendingB = deferred<Response>();
    const fetchStartedA = deferred<void>();
    const fetchStartedB = deferred<void>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrlA = new URL('/assets/images/cupid-busy-heart-background-a.png', document.baseURI).href;
    const imageUrlB = new URL('/assets/images/cupid-busy-heart-background-b.png', document.baseURI).href;
    let includeDecoration: 'a' | 'b' = 'a';
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn((input) => {
        if (String(input).includes('background-a')) {
          fetchStartedA.resolve(undefined);
          return pendingA.promise;
        }
        fetchStartedB.resolve(undefined);
        return pendingB.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          const imageUrl = 'a' === includeDecoration ? imageUrlA : imageUrlB;
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    const first = prepareClipboard(clipboard, preview, { background: true });
    await fetchStartedA.promise;
    includeDecoration = 'b';
    const second = prepareClipboard(clipboard, preview, { background: true });
    let secondStarted = false;
    void fetchStartedB.promise.then(() => {
      secondStarted = true;
    });
    await Promise.resolve();
    expect(secondStarted).toBe(false);

    pendingA.resolve({
      blob: async () => new window.Blob(['theme image A'], { type: 'image/png' }),
      ok: true
    } as unknown as Response);
    await fetchStartedB.promise;
    pendingB.resolve({
      blob: async () => new window.Blob(['theme image B'], { type: 'image/png' }),
      ok: true
    } as unknown as Response);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('does not chain a new browser-task yield after a delayed timer resumes', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    let clock = 0;
    let zeroDelayTimers = 0;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = Number(timeout ?? 0);
      if (0 === delay) zeroDelayTimers += 1;
      return originalSetTimeout(() => {
        if (0 === delay) clock += 20;
        if ('function' === typeof handler) handler(...args);
      }, 0) as unknown as number;
    }) as typeof window.setTimeout);
    try {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p>First</p><p>Second</p><p>Third</p>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'First\nSecond\nThird' });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement ? declaration({}) : declaration({ display: 'block' }),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });

      await prepareClipboard(clipboard, preview, { background: true });
      expect(zeroDelayTimers).toBe(2);
    } finally {
      setTimeout.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('still yields when continuous serialization work exceeds the budget', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    let clock = 0;
    let zeroDelayTimers = 0;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = Number(timeout ?? 0);
      if (0 === delay) zeroDelayTimers += 1;
      return originalSetTimeout(() => {
        if (0 === delay) clock += 20;
        if ('function' === typeof handler) handler(...args);
      }, 0) as unknown as number;
    }) as typeof window.setTimeout);
    try {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p>First</p><p>Second</p><p>Third</p>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'First\nSecond\nThird' });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) => {
          if (!pseudoElement) clock += 9;
          return pseudoElement ? declaration({}) : declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });

      await prepareClipboard(clipboard, preview, { background: true });
      expect(zeroDelayTimers).toBeGreaterThan(2);
    } finally {
      setTimeout.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('does not suspend between ordinary style properties without background URLs', async () => {
    let observedUnnecessarySuspension = false;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(0);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        let displayMicrotaskRan = false;
        return {
          getPropertyValue: (property: string) => {
            const stack = new Error().stack ?? '';
            const inAsyncStyleLoop = /styleDeclarations/u.test(stack);
            if ('display' === property && inAsyncStyleLoop) {
              queueMicrotask(() => {
                displayMicrotaskRan = true;
              });
            }
            if ('flex-direction' === property && displayMicrotaskRan) {
              observedUnnecessarySuspension = true;
            }
            return 'display' === property ? 'block' : '';
          }
        } as unknown as CSSStyleDeclaration;
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const preview = readyPreview();

    try {
      await prepareClipboard(clipboard, preview, { background: true });
      expect(observedUnnecessarySuspension).toBe(false);
    } finally {
      dateNow.mockRestore();
    }
  });

  it('yields at both async serialization boundaries when the budget is exhausted', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    let clock = 0;
    let boundary: 'none' | 'html' | 'text' = 'none';
    const boundaryYields: string[] = [];
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = Number(timeout ?? 0);
      if (0 === delay && 'none' !== boundary) boundaryYields.push(boundary);
      return originalSetTimeout(handler, 0, ...args) as unknown as number;
    }) as typeof window.setTimeout);
    Object.defineProperty(Element.prototype, 'outerHTML', {
      configurable: true,
      get(this: Element) {
        if ('SECTION' === this.tagName && 'none' === boundary) {
          boundary = 'html';
          clock = 20;
        }
        return originalOuterHTML?.get?.call(this) ?? '';
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        if ('html' === boundary) {
          boundary = 'text';
          clock = 40;
        }
        return this.textContent ?? '';
      }
    });
    try {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p>First</p><p>Second</p>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'First\nSecond' });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement ? declaration({}) : declaration({ display: 'block' }),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });

      await prepareClipboard(clipboard, preview, { background: true });
      expect(boundaryYields).toEqual(['html', 'text']);
    } finally {
      if (originalOuterHTML) Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHTML);
      else delete (Element.prototype as unknown as { outerHTML?: unknown }).outerHTML;
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
      setTimeout.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('rejects a source change during the final serialization boundary', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    let clock = 0;
    let boundary: 'none' | 'html' | 'text' = 'none';
    let preview: HTMLElement | null = null;
    let mutateAtTextBoundary = true;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = Number(timeout ?? 0);
      if (0 === delay && 'text' === boundary && mutateAtTextBoundary) {
        mutateAtTextBoundary = false;
        return originalSetTimeout(() => {
          preview?.querySelector('p')?.replaceChildren('Changed during boundary');
          if ('function' === typeof handler) handler(...args);
        }, 0) as unknown as number;
      }
      return originalSetTimeout(handler, 0, ...args) as unknown as number;
    }) as typeof window.setTimeout);
    Object.defineProperty(Element.prototype, 'outerHTML', {
      configurable: true,
      get(this: Element) {
        if ('SECTION' === this.tagName && 'none' === boundary) {
          boundary = 'html';
          clock = 20;
        }
        return originalOuterHTML?.get?.call(this) ?? '';
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        if ('html' === boundary) {
          boundary = 'text';
          clock = 40;
        }
        return this.textContent ?? '';
      }
    });
    try {
      preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p>Before boundary</p>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Before boundary' });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement ? declaration({}) : declaration({ display: 'block' }),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });

      await expect(prepareClipboard(clipboard, preview, { background: true })).rejects.toThrow('wechat-copy-stale');
      expect(preview.innerHTML).toContain('Changed during boundary');
      expect(boundary).toBe('text');
    } finally {
      if (originalOuterHTML) Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHTML);
      else delete (Element.prototype as unknown as { outerHTML?: unknown }).outerHTML;
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
      setTimeout.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('rejects an abort during the final serialization boundary without publishing a payload', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    const controller = new AbortController();
    let clock = 0;
    let boundary: 'none' | 'html' | 'text' = 'none';
    let abortAtTextBoundary = true;
    let preview: HTMLElement | null = null;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = Number(timeout ?? 0);
      if (0 === delay && 'text' === boundary && abortAtTextBoundary) {
        abortAtTextBoundary = false;
        return originalSetTimeout(() => {
          controller.abort();
          if ('function' === typeof handler) handler(...args);
        }, 0) as unknown as number;
      }
      return originalSetTimeout(handler, 0, ...args) as unknown as number;
    }) as typeof window.setTimeout);
    Object.defineProperty(Element.prototype, 'outerHTML', {
      configurable: true,
      get(this: Element) {
        if ('SECTION' === this.tagName && 'none' === boundary) {
          boundary = 'html';
          clock = 20;
        }
        return originalOuterHTML?.get?.call(this) ?? '';
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        if ('html' === boundary) {
          boundary = 'text';
          clock = 40;
        }
        return this.textContent ?? '';
      }
    });
    try {
      preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p>Abort boundary</p>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Abort boundary' });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement ? declaration({}) : declaration({ display: 'block' }),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });

      await expect(
        prepareClipboard(clipboard, preview, { background: true, signal: controller.signal })
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(boundary).toBe('text');
      await expect(prepareClipboard(clipboard, preview, { background: true })).resolves.toBeUndefined();
    } finally {
      if (originalOuterHTML) Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHTML);
      else delete (Element.prototype as unknown as { outerHTML?: unknown }).outerHTML;
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
      setTimeout.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('cancels an active background serialization when its owner aborts', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const ownerController = new AbortController();
    const writes: unknown[] = [];
    const bodyAppend = vi.spyOn(document.body, 'append');
    let sourceInnerTextReads = 0;
    let requestSignal: AbortSignal | null = null;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      get: () => {
        sourceInnerTextReads += 1;
        return 'Theme heading';
      }
    });
    const imageUrl = new URL('/assets/images/cupid-busy-heart-cancel.png', document.baseURI).href;
    const fetch = vi.fn((_value: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? null;
      fetchStarted.resolve();
      return pendingImage.promise;
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn((items) => {
        writes.push(items);
        return Promise.resolve();
      })
    });
    const prepare = clipboard.prepare;
    if (!prepare) throw new Error('clipboard preparation is unavailable');

    const preparation = prepare(preview, {
      background: true,
      signal: ownerController.signal
    } as WechatClipboardPreparationOptions & Readonly<{ signal: AbortSignal }>);
    await fetchStarted.promise;

    try {
      ownerController.abort();
      expect(requestSignal).not.toBeNull();
      expect((requestSignal as AbortSignal | null)?.aborted).toBe(false);
      const appendCallsBeforeResolution = bodyAppend.mock.calls.length;
      const copy = clipboard.copy(preview);
      pendingImage.resolve({
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await expect(preparation).rejects.toMatchObject({ name: 'AbortError' });
      await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      // The retry owns one raw semantic context and one connected plain-text
      // layout host; both are removed after the payload settles.
      expect(bodyAppend).toHaveBeenCalledTimes(appendCallsBeforeResolution + 2);
      expect(sourceInnerTextReads).toBe(1);
      expect(fetch).toHaveBeenCalledOnce();
      const item = (writes[0] as ClipboardItemStub[])[0];
      if (!item) throw new Error('ClipboardItem missing');
      const htmlPayload = item.payload['text/html'];
      if (!htmlPayload) throw new Error('Clipboard HTML missing');
      const html = await blobText(htmlPayload);
      expect(html).toContain('data:image/png;base64,');

      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(writes).toHaveLength(2);
      expect(sourceInnerTextReads).toBe(1);
    } finally {
      if (!ownerController.signal.aborted) ownerController.abort();
      await preparation.catch(() => undefined);
      bodyAppend.mockRestore();
    }
  });

  it('settles canceled waiters without reviving the old background job', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const nextController = new AbortController();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart-waiters.png', document.baseURI).href;
    const fetch = vi.fn((_value: RequestInfo | URL, _init?: RequestInit) => {
      fetchStarted.resolve();
      return pendingImage.promise;
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const prepare = clipboard.prepare;
    if (!prepare) throw new Error('clipboard preparation is unavailable');
    const first = prepare(preview, { background: true, signal: firstController.signal });
    await fetchStarted.promise;
    const second = prepare(preview, { background: true, signal: secondController.signal });
    firstController.abort();
    secondController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });

    const next = prepare(preview, { background: true, signal: nextController.signal });
    pendingImage.resolve({
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(next).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects a computed-style change between serialization and final freshness', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/fidelity-race.png', document.baseURI).href;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Freshness race</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Freshness race' });
    let color = 'red';
    let paragraphStyleReads = 0;
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          paragraphStyleReads += 1;
          if (2 === paragraphStyleReads) {
            window.setTimeout(() => {
              color = 'blue';
            }, 0);
          }
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            color,
            display: 'block'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    const preparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);

    await expect(preparation).rejects.toThrow('wechat-copy-stale');
    expect(paragraphStyleReads).toBeGreaterThanOrEqual(3);
  });

  it('rejects source markup changed during the final freshness walk', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/markup-race.png', document.baseURI).href;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Freshness race</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Freshness race' });
    let imageBodyRead = false;
    let mutated = false;
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName && imageBodyRead && !mutated) {
          mutated = true;
          element.textContent = 'Changed during final freshness';
        }
        if (!pseudoElement && 'P' === element.tagName) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            display: 'block'
          });
        }
        return declaration({});
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    const preparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    pendingImage.resolve({
      blob: async () => {
        imageBodyRead = true;
        return new Blob(['theme'], { type: 'image/png' });
      },
      ok: true,
      url: imageUrl
    } as unknown as Response);

    await expect(preparation).rejects.toThrow('wechat-copy-stale');
    expect(mutated).toBe(true);
    expect(preview.innerHTML).toContain('Changed during final freshness');
  });

  it('uses the stable legacy payload when modern Clipboard setup fails during refresh', async () => {
    const pendingImage = deferred<Response>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    let includeDecoration = false;
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      fetch: vi.fn(() => pendingImage.promise),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement && includeDecoration) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => {
        throw new Error('clipboard-write-setup-failed');
      })
    });

    try {
      await prepareClipboard(clipboard, preview);
      includeDecoration = true;
      const refresh = prepareClipboard(clipboard, preview);

      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(execCommand).toHaveBeenCalledWith('copy');

      pendingImage.resolve({
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await refresh;
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('keeps an earlier successful payload when a newer refresh fails', async () => {
    const pendingA = deferred<Response>();
    const pendingB = deferred<Response>();
    const fetchStartedA = deferred<void>();
    const fetchStartedB = deferred<void>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrlA = new URL('/assets/images/cupid-busy-heart-a.png', document.baseURI).href;
    const imageUrlB = new URL('/assets/images/cupid-busy-heart-b.png', document.baseURI).href;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let includeDecoration: 'none' | 'a' | 'b' = 'none';
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn((input) => {
        if (String(input).includes('heart-a')) {
          fetchStartedA.resolve(undefined);
          return pendingA.promise;
        }
        fetchStartedB.resolve(undefined);
        return pendingB.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement && 'none' !== includeDecoration) {
          const imageUrl = 'a' === includeDecoration ? imageUrlA : imageUrlB;
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await prepareClipboard(clipboard, preview);
      includeDecoration = 'a';
      const refreshA = prepareClipboard(clipboard, preview);
      await fetchStartedA.promise;
      includeDecoration = 'b';
      const refreshB = prepareClipboard(clipboard, preview);
      await fetchStartedB.promise;

      pendingA.resolve({
        blob: async () => new window.Blob(['theme image A'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await refreshA;
      pendingB.resolve({ ok: false } as unknown as Response);
      await expect(refreshB).rejects.toThrow('wechat-theme-image-fetch-failed');

      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toContain('data:image/png;base64,');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('keeps the newest successful fallback when an older refresh resolves later', async () => {
    const pendingA = deferred<Response>();
    const pendingB = deferred<Response>();
    const pendingC = deferred<Response>();
    const fetchStartedA = deferred<void>();
    const fetchStartedB = deferred<void>();
    const fetchStartedC = deferred<void>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrlA = new URL('/assets/images/cupid-busy-heart-a.png', document.baseURI).href;
    const imageUrlB = new URL('/assets/images/cupid-busy-heart-b.png', document.baseURI).href;
    const imageUrlC = new URL('/assets/images/cupid-busy-heart-c.png', document.baseURI).href;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let includeDecoration: 'none' | 'a' | 'b' | 'c' = 'none';
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn((input) => {
        const value = String(input);
        if (value.includes('heart-a')) {
          fetchStartedA.resolve(undefined);
          return pendingA.promise;
        }
        if (value.includes('heart-b')) {
          fetchStartedB.resolve(undefined);
          return pendingB.promise;
        }
        fetchStartedC.resolve(undefined);
        return pendingC.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement && 'none' !== includeDecoration) {
          const imageUrl = 'a' === includeDecoration ? imageUrlA : 'b' === includeDecoration ? imageUrlB : imageUrlC;
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await prepareClipboard(clipboard, preview);
      includeDecoration = 'a';
      const refreshA = prepareClipboard(clipboard, preview);
      await fetchStartedA.promise;
      includeDecoration = 'b';
      const refreshB = prepareClipboard(clipboard, preview);
      await fetchStartedB.promise;
      includeDecoration = 'c';
      const refreshC = prepareClipboard(clipboard, preview);
      await fetchStartedC.promise;

      pendingB.resolve({
        blob: async () => new window.Blob(['theme image B'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await refreshB;
      pendingA.resolve({
        blob: async () => new window.Blob(['theme image A'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await refreshA;
      pendingC.resolve({ ok: false } as unknown as Response);
      await expect(refreshC).rejects.toThrow('wechat-theme-image-fetch-failed');

      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toContain('dGhlbWUgaW1hZ2UgQg==');
      expect(legacyHtml).not.toContain('dGhlbWUgaW1hZ2UgQQ==');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('restores the last stable legacy payload after a refresh failure', async () => {
    const pendingImage = deferred<Response>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let includeDecoration = false;
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => pendingImage.promise),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement && includeDecoration) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await prepareClipboard(clipboard, preview);
      includeDecoration = true;
      const refresh = prepareClipboard(clipboard, preview);
      pendingImage.resolve({ ok: false } as unknown as Response);
      await expect(refresh).rejects.toThrow('wechat-theme-image-fetch-failed');
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(execCommand).toHaveBeenCalledWith('copy');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('reuses a prepared legacy payload after scroll-only geometry changes', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Scroll-stable heading</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Scroll-stable heading' });
    let scrollTop = 0;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: scrollTop + 80, height: 80, left: 10, right: 330, top: scrollTop, width: 320 })
    });
    const paragraph = preview.querySelector('p');
    if (!paragraph) throw new Error('preview paragraph missing');
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: scrollTop + 24, height: 24, left: 10, right: 330, top: scrollTop, width: 320 })
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: scrollTop }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await prepareClipboard(clipboard, preview);
      scrollTop = 120;
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(execCommand).toHaveBeenCalledWith('copy');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('does not reuse an older fallback after a later layout change', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Layout-stable source</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Layout-stable source' });
    let width = 320;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 80, height: 80, left: 0, right: width, top: 0, width })
    });
    const paragraph = preview.querySelector('p');
    if (!paragraph) throw new Error('preview paragraph missing');
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 24, height: 24, left: 0, right: width, top: 0, width })
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await prepareClipboard(clipboard, preview);
      width = 360;
      await prepareClipboard(clipboard, preview);
      width = 400;
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('retries legacy preparation after a transient background failure', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Retry heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Retry heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const retryFetchStarted = deferred<void>();
    let attempts = 0;
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => {
        attempts += 1;
        if (1 === attempts) return Promise.resolve({ ok: false } as unknown as Response);
        retryFetchStarted.resolve(undefined);
        return Promise.resolve({
          blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
          ok: true
        } as unknown as Response);
      }),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    await expect(prepareClipboard(clipboard, preview)).rejects.toThrow('wechat-theme-image-fetch-failed');
    await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    await retryFetchStarted.promise;
    await vi.waitFor(async () => {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    });
    expect(attempts).toBe(2);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('fails a stalled theme-image preparation and aborts its request', async () => {
    vi.useFakeTimers();
    const pendingImage = deferred<Response>();
    const abort = vi.fn();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn((_value: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', abort, { once: true });
      return pendingImage.promise;
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      const preparation = prepareClipboard(clipboard, preview);
      const rejected = expect(preparation).rejects.toThrow('wechat-theme-image-fetch-timeout');
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
      expect(fetch).toHaveBeenCalledOnce();
      expect(abort).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the theme-image timeout active while reading the response body', async () => {
    vi.useFakeTimers();
    const fetchStarted = deferred<void>();
    const blobStarted = deferred<void>();
    const pendingBlob = deferred<Blob>();
    const abort = vi.fn();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const blob = vi.fn(() => {
      blobStarted.resolve();
      return pendingBlob.promise;
    });
    const fetch = vi.fn((_value: RequestInfo | URL, init?: RequestInit) => {
      fetchStarted.resolve();
      init?.signal?.addEventListener('abort', abort, { once: true });
      return Promise.resolve({ ok: true, url: imageUrl, blob } as unknown as Response);
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      const preparation = prepareClipboard(clipboard, preview);
      await fetchStarted.promise;
      await blobStarted.promise;
      const rejected = expect(preparation).rejects.toThrow('wechat-theme-image-fetch-timeout');
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
      expect(fetch).toHaveBeenCalledOnce();
      expect(blob).toHaveBeenCalledOnce();
      expect(abort).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails invalid theme-image responses without writing a partial payload', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({
          ok: true,
          blob: async () => new window.Blob(['not an image'], { type: 'text/plain' })
        }) as unknown as Response
    );
    const write = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(prepareClipboard(clipboard, preview)).rejects.toThrow('wechat-theme-image-response-invalid');
    expect(fetch).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it('does not start legacy serialization before preview preparation', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(fetch).not.toHaveBeenCalled();
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('does not enter legacy copy after an asynchronous modern write rejection', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async () => {
        throw new Error('denied');
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await expect(clipboard.copy(readyPreview())).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('waits for a delayed modern write instead of misclassifying it as failed', async () => {
    vi.useFakeTimers();
    let resolveWrite: (() => void) | undefined;
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        })
    );
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write,
      pageOffset: () => ({ x: 0, y: 0 })
    });
    const copy = clipboard.copy(readyPreview());
    let settled = false;
    copy.finally(() => {
      settled = true;
    });

    try {
      await vi.advanceTimersByTimeAsync(2_501);
      expect(settled).toBe(false);
      resolveWrite?.();
      await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(write).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails a modern write that remains stalled after payload preparation', async () => {
    vi.useFakeTimers();
    let payloadConsumed = false;
    const write = vi.fn(async (items: unknown[]) => {
      const item = items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> };
      await item.payload['text/html'];
      payloadConsumed = true;
      await new Promise<void>(() => undefined);
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      const copy = clipboard.copy(readyPreview());
      for (let elapsed = 0; elapsed < 1_000 && !payloadConsumed; elapsed += 10) {
        await vi.advanceTimersByTimeAsync(10);
      }
      expect(payloadConsumed).toBe(true);
      await vi.advanceTimersByTimeAsync(CLIPBOARD_COMMIT_TIMEOUT_MS);
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(write).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds deferred payload preparation separately from the browser commit', async () => {
    vi.useFakeTimers();
    const pendingImage = deferred<Response>();
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Timeout payload</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Timeout payload' });
    const imageUrl = new URL('/assets/images/timeout-payload.png', document.baseURI).href;
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });

    try {
      const copy = clipboard.copy(preview);
      let settled = false;
      void copy.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await vi.advanceTimersByTimeAsync(CLIPBOARD_COMMIT_TIMEOUT_MS);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS - CLIPBOARD_COMMIT_TIMEOUT_MS);
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(committed).toBe(false);
      pendingImage.resolve({
        blob: async () => new Blob(['late'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledOnce();
      expect(committed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not commit a portable payload when the copy is aborted before the first browser task', async () => {
    let committed = false;
    const controller = new AbortController();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });

    const copy = clipboard.copy(readyPreview(), { isCurrent: () => true, signal: controller.signal });
    controller.abort();

    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(committed).toBe(false);
  });

  it('does not commit a portable payload after the copy generation becomes stale before the first browser task', async () => {
    let committed = false;
    let current = true;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });

    const copy = clipboard.copy(readyPreview(), { isCurrent: () => current });
    current = false;

    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(committed).toBe(false);
  });

  it('uses a prepared legacy payload when modern Clipboard setup throws synchronously', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const write = vi.fn(() => {
      throw new Error('clipboard-write-setup-failed');
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    const preview = readyPreview();

    try {
      await prepareClipboard(clipboard, preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(write).toHaveBeenCalledOnce();
      expect(execCommand).toHaveBeenCalledWith('copy');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('does not use a stale ready payload after a computed layout change', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let width = '100px';
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName) {
          return declaration({ display: 'block', width });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => {
        throw new Error('clipboard-write-setup-failed');
      })
    });
    const preview = readyPreview();

    try {
      await prepareClipboard(clipboard, preview);
      width = '200px';
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toContain('width:200px');
      expect(legacyHtml).not.toContain('width:100px');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('reports deferred payload failure even when modern write resolves first', async () => {
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () => ({ ok: false, blob: async () => new window.Blob([], { type: 'image/png' }) }) as unknown as Response
    );
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async () => undefined,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retain a rejected theme image request for the next copy', async () => {
    const writes: unknown[] = [];
    const responses = [
      { ok: false, blob: async () => new window.Blob([], { type: 'image/png' }) },
      { ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }
    ];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    const fetch = vi.fn(async () => responses.shift() as unknown as Response);
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> };
        const htmlPayload = item?.payload['text/html'];
        const textPayload = item?.payload['text/plain'];
        if (!htmlPayload || !textPayload) throw new Error('clipboard payload missing');
        await Promise.all([blobText(htmlPayload), blobText(textPayload)]);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(2);
  });

  it('preserves authored auto margins for eligible flow pseudos and outer Mermaid roots', async () => {
    const modernWrites: Array<{ html: string; text: string }> = [];
    let useAutoMargins = true;
    let rawAutoReads = 0;
    let rawPseudoReads = 0;
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h1 class="auto-pseudo">Auto pseudo</h1>',
      '<h1 class="fixed-pseudo">Fixed pseudo</h1>',
      '<h1 class="absolute-pseudo">Absolute pseudo</h1>',
      '<div class="easymde-mermaid"><svg width="180.5" height="40"><svg width="90" height="20"></svg><g class="nested-svg"></g></svg></div>',
      '<div class="ordinary-svg"><svg width="140" height="30"></svg></div>',
      '<div class="easymde-math-block"><span class="katex">Math</span></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Auto pseudo\nFixed pseudo\nAbsolute pseudo\nMath'
    });
    const sourceMarkup = preview.innerHTML;
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if (raw && pseudoElement) rawPseudoReads += 1;
      if ('H1' === element.tagName && '::after' === pseudoElement) {
        const position = element.classList.contains('absolute-pseudo') ? 'absolute' : 'static';
        const marginLeft = element.classList.contains('fixed-pseudo')
          ? '16px'
          : raw && useAutoMargins
            ? 'auto'
            : '285px';
        if (raw && useAutoMargins && element.classList.contains('auto-pseudo')) rawAutoReads += 1;
        return declaration({
          content: '""',
          display: 'block',
          height: '10px',
          'margin-left': marginLeft,
          'margin-right': '0px',
          position,
          width: '110px'
        });
      }
      if ('SVG' === element.localName.toUpperCase()) {
        return declaration({
          display: 'block',
          height: '40px',
          'margin-left': raw && useAutoMargins ? 'auto' : '249.75px',
          'margin-right': raw && useAutoMargins ? 'auto' : '0px',
          width: '180.5px'
        });
      }
      if ('g' === element.localName.toLowerCase()) {
        return declaration({ display: 'inline', 'margin-left': raw ? 'auto' : '20px', 'margin-right': '0px' });
      }
      if (element.classList.contains('katex')) {
        return declaration({ display: 'inline', 'margin-left': raw ? 'auto' : '40px', 'margin-right': '0px' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        const textPayload = item.payload['text/plain'];
        if (!htmlPayload || !textPayload) throw new Error('auto margin payload missing');
        modernWrites.push({ html: await blobText(htmlPayload), text: await blobText(textPayload) });
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(rawPseudoReads).toBeGreaterThan(0);
    expect(rawAutoReads).toBeGreaterThan(0);
    const firstHolder = document.createElement('div');
    firstHolder.innerHTML = modernWrites[0]?.html ?? '';
    const firstPseudos = firstHolder.querySelectorAll('h1 > span[aria-hidden="true"]');
    expect(firstPseudos[0]?.getAttribute('style')).toContain('margin-left:auto');
    expect(firstPseudos[1]?.getAttribute('style')).toContain('margin-left:16px');
    expect(firstPseudos[2]?.getAttribute('style')).toContain('margin-left:285px');
    const svgStyles = Array.from(firstHolder.querySelectorAll('svg')).map(
      (element) => element.getAttribute('style') ?? ''
    );
    expect(svgStyles[0]).toContain('margin-left:auto');
    expect(svgStyles[1]).toContain('margin-left:249.75px');
    expect(svgStyles[2]).toContain('margin-left:auto');
    expect(firstHolder.querySelector('g')?.getAttribute('style')).toContain('margin-left:20px');
    expect(
      Array.from(firstHolder.querySelectorAll('span')).some(
        (element) => element.getAttribute('style')?.includes('margin-left:40px') ?? false
      )
    ).toBe(true);

    useAutoMargins = false;
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(modernWrites).toHaveLength(2);
    const secondHolder = document.createElement('div');
    secondHolder.innerHTML = modernWrites[1]?.html ?? '';
    const secondPseudo = secondHolder.querySelector('h1 > span[aria-hidden="true"]');
    expect(secondPseudo?.getAttribute('style')).toContain('margin-left:285px');
    expect(secondPseudo?.getAttribute('style')).not.toContain('margin-left:auto');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps auto-margin HTML identical across modern and legacy Clipboard paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1 class="auto-pseudo">Auto pseudo</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Auto pseudo' });
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('H1' === element.tagName && '::after' === pseudoElement) {
        return declaration({
          content: '""',
          display: 'block',
          height: '10px',
          'margin-left': 'auto',
          'margin-right': 'auto',
          position: 'static',
          width: '110px'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    let modernHtml = '';
    const modern = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('modern auto margin HTML missing');
        modernHtml = await blobText(html);
      }
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: computed,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
      expect(modernHtml).toContain('margin-left:auto');
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it('invalidates prepared auto-margin payloads when raw semantics change', async () => {
    let useAutoMargins = true;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1 class="auto-pseudo">Auto pseudo</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Auto pseudo' });
    const writes: string[] = [];
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if ('H1' === element.tagName && '::after' === pseudoElement) {
        return declaration({
          content: '""',
          display: 'block',
          height: '10px',
          'margin-left': raw && useAutoMargins ? 'auto' : '285px',
          position: 'static',
          width: '110px'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('freshness auto margin HTML missing');
        writes.push(await blobText(html));
      }
    });

    await prepareClipboard(clipboard, preview);
    useAutoMargins = false;
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('margin-left:285px');
  });

  it('rejects an in-flight auto-margin semantic change before final commit', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/auto-margin-race.png', document.baseURI).href;
    const writes: string[] = [];
    const writeCalls: unknown[] = [];
    let useAutoMargins = true;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1 class="auto-pseudo">Auto pseudo</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Auto pseudo' });
    const sourceMarkup = preview.innerHTML;
    const fetch = vi.fn(() => {
      useAutoMargins = false;
      return pendingImage.promise;
    });
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if ('H1' === element.tagName && '::after' === pseudoElement) {
        const marginLeft = raw && useAutoMargins ? 'auto' : '285px';
        return declaration({
          background: `url("${imageUrl}")`,
          'background-image': `url("${imageUrl}")`,
          content: '""',
          display: 'block',
          height: '10px',
          'margin-left': marginLeft,
          position: 'static',
          width: '110px'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writeCalls.push(items);
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('auto margin race HTML missing');
        writes.push(await blobText(html));
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(useAutoMargins).toBe(false);
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writeCalls).toHaveLength(1);
    expect(writes).toHaveLength(0);
    expect(preview.innerHTML).toBe(sourceMarkup);

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writeCalls).toHaveLength(2);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('margin-left:285px');
  });

  it('preserves valid percentage margins across ordinary flow and outer SVG HTML paths', async () => {
    const usePercent = true;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h2><span class="percent-suffix">Percent suffix</span> <span class="signed-suffix">Signed suffix</span> <span class="leading-suffix">Leading suffix</span> <span class="fixed-suffix">Fixed suffix</span> <span class="invalid-suffix">Invalid suffix</span> <span class="calc-suffix">Calc suffix</span> <span class="malformed-suffix">Malformed suffix</span></h2>',
      '<div class="ordinary-svg"><svg width="140" height="30"><svg width="90" height="20"></svg></svg></div>',
      '<div class="easymde-math-block"><span class="katex">Math</span></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value:
        'Percent suffix Signed suffix Leading suffix Fixed suffix Invalid suffix Calc suffix Malformed suffix\nMath'
    });
    const sourceMarkup = preview.innerHTML;
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if (pseudoElement) return declaration({ content: 'none' });
      if (element.classList.contains('percent-suffix')) {
        return declaration({
          display: 'inline',
          'margin-left': raw && usePercent ? '95%' : '621.297px',
          'margin-right': '0px',
          position: 'static'
        });
      }
      if (element.classList.contains('signed-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? '+5%' : '5px', position: 'static' });
      }
      if (element.classList.contains('leading-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? '.5%' : '0.5px', position: 'static' });
      }
      if (element.classList.contains('fixed-suffix')) {
        return declaration({ display: 'inline', 'margin-left': '12px', position: 'static' });
      }
      if (element.classList.contains('invalid-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? 'Infinity%' : '7px', position: 'static' });
      }
      if (element.classList.contains('calc-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? 'calc(95% - 1px)' : '8px', position: 'static' });
      }
      if (element.classList.contains('malformed-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? '1.%' : '9px', position: 'static' });
      }
      if ('svg' === element.localName.toLowerCase()) {
        const nested = Boolean(element.parentElement?.closest('svg'));
        return declaration({
          display: 'block',
          height: nested ? '20px' : '30px',
          'margin-left': nested ? '20px' : raw && usePercent ? '5%' : '18px',
          width: nested ? '90px' : '140px'
        });
      }
      if ('g' === element.localName.toLowerCase()) {
        return declaration({ display: 'inline', 'margin-left': raw ? '95%' : '20px' });
      }
      if (element.classList.contains('katex')) {
        return declaration({ display: 'inline', 'margin-left': raw ? '95%' : '40px' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    let modernHtml = '';
    const modern = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('percentage margin HTML missing');
        modernHtml = await blobText(html);
      }
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: computed,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
      const holder = document.createElement('div');
      holder.innerHTML = modernHtml;
      const styles = Array.from(holder.querySelectorAll('span')).map((element) => element.getAttribute('style') ?? '');
      expect(styles.some((style) => style.includes('margin-left:95%'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:+5%'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:.5%'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:12px'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:7px'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:8px'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:9px'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:40px'))).toBe(true);
      const svgStyles = Array.from(holder.querySelectorAll('svg')).map(
        (element) => element.getAttribute('style') ?? ''
      );
      expect(svgStyles[0]).toContain('margin-left:5%');
      expect(svgStyles[1]).toContain('margin-left:20px');
      expect(modernHtml).not.toContain('Infinity%');
      expect(modernHtml).not.toContain('calc(95% - 1px)');
      expect(modernHtml).not.toContain('1.%');
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it('invalidates a prepared percentage-margin payload when raw semantics become fixed pixels', async () => {
    let usePercent = true;
    const writes: string[] = [];
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2><span class="percent-suffix">Percent suffix</span></h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Percent suffix' });
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if ('SPAN' === element.tagName && element.classList.contains('percent-suffix') && !pseudoElement) {
        return declaration({
          display: 'inline',
          'margin-left': raw && usePercent ? '95%' : '621.297px',
          position: 'static'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('percentage freshness HTML missing');
        writes.push(await blobText(html));
      }
    });

    await prepareClipboard(clipboard, preview);
    usePercent = false;
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('margin-left:621.297px');
    expect(writes[0]).not.toContain('margin-left:95%');
  });

  it('rejects an in-flight percentage-margin semantic change before final commit', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/percentage-margin-race.png', document.baseURI).href;
    const writes: string[] = [];
    const writeCalls: unknown[] = [];
    let usePercent = true;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2><span class="percent-suffix">Percent suffix</span></h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Percent suffix' });
    const sourceMarkup = preview.innerHTML;
    const fetch = vi.fn(() => {
      usePercent = false;
      return pendingImage.promise;
    });
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if ('SPAN' === element.tagName && element.classList.contains('percent-suffix') && !pseudoElement) {
        return declaration({
          background: `url("${imageUrl}")`,
          'background-image': `url("${imageUrl}")`,
          display: 'inline',
          'margin-left': raw && usePercent ? '95%' : '621.297px',
          position: 'static'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writeCalls.push(items);
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('percentage race HTML missing');
        writes.push(await blobText(html));
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(usePercent).toBe(false);
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writeCalls).toHaveLength(1);
    expect(writes).toHaveLength(0);
    expect(preview.innerHTML).toBe(sourceMarkup);

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writeCalls).toHaveLength(2);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('margin-left:621.297px');
  });

  it('normalizes WeChat structure, leaf text, unsafe URLs, and code overflow', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const longLine = `const long = "${'x'.repeat(240)}";`;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<div class="wrapper"><h3>公众号标题</h3><p>正文 <strong>重点</strong> <a href="javascript:alert(1)">危险链接</a></p></div>',
      '<p><a href="https://example.test/ok">安全链接</a><img src="javascript:alert(1)" alt="bad"><img src="https://example.test/image.png" alt="good"></p>',
      `<pre><code>const value = 1;\n${longLine}</code></pre>`
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: '公众号标题\n正文 重点 危险链接\n安全链接\nconst value = 1;'
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('PRE' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'inline',
            width: '12px',
            height: '12px',
            'border-radius': '50%',
            background: 'rgb(255, 95, 86)',
            'box-shadow': 'rgb(255, 189, 46) 20px 0 0, rgb(39, 201, 63) 40px 0 0'
          });
        }
        if ('PRE' === element.tagName) {
          return declaration({ display: 'block', 'white-space': 'pre', 'padding-top': '34px' });
        }
        if ('CODE' === element.tagName) {
          return declaration({ display: 'block', 'white-space': 'pre', 'font-family': 'monospace' });
        }
        return declaration({ display: 'block', color: 'rgb(20, 21, 22)' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const html = await blobText(htmlBlob);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const code = holder.querySelector('pre > code');
    const rows = codeRows(code);
    expect(holder.querySelector('div')).toBeNull();
    expect(holder.querySelector('section')).not.toBeNull();
    expect(holder.querySelectorAll('span[leaf]')).toHaveLength(7);
    expect(holder.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(holder.querySelector('a[href="https://example.test/ok"]')).not.toBeNull();
    expect(holder.querySelector('img[src^="javascript:"]')).toBeNull();
    expect(holder.querySelector('img[src="https://example.test/image.png"]')).not.toBeNull();
    const preStyle = holder.querySelector('pre')?.getAttribute('style') ?? '';
    const codeStyle = holder.querySelector('pre > code')?.getAttribute('style') ?? '';
    expect(preStyle).toContain('overflow-x:auto');
    expect(preStyle).toContain('-webkit-overflow-scrolling:touch');
    expect(preStyle).toContain('white-space:pre');
    expect(preStyle).toContain('overflow-x:auto!important');
    expect(preStyle).toContain('white-space:pre!important');
    expect(codeStyle).toContain('display:block');
    expect(codeStyle).toContain('width:100%');
    expect(codeStyle).toContain('max-width:100%');
    expect(codeStyle).toContain('overflow-x:auto');
    expect(codeStyle).toContain('white-space:pre');
    expect(codeStyle).toContain('word-break:normal');
    expect(codeStyle).toContain('overflow-wrap:normal');
    expect(codeStyle).toContain('overflow-x:auto!important');
    expect(codeStyle).toContain('white-space:pre!important');
    expect(
      holder.querySelector('pre > code')?.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')
    ).toContain(longLine);
    expect(rows).not.toBeNull();
    const longLineWrapper = [...(rows?.querySelectorAll(':scope > nobr') ?? [])].find((element) =>
      element.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' ').includes(longLine)
    );
    expect(rows?.querySelectorAll(':scope > br')).toHaveLength(1);
    expect(rows?.style.display).toBe('block');
    expect(rows?.style.width).toBe('max-content');
    expect(rows?.style.minWidth).toBe('100%');
    expect(rows?.style.maxWidth).toBe('none');
    expect(rows?.style.whiteSpace).toBe('pre');
    expect(rows?.style.wordBreak).toBe('normal');
    expect(rows?.style.overflowWrap).toBe('normal');
    expect(rows?.hasAttribute('data-ignore-width')).toBe(false);
    expect(rows?.style.overflow).toBe('');
    expect(rows?.style.overflowX).toBe('');
    expect(rows?.style.overflowY).toBe('');
    expect(longLineWrapper?.getAttribute('style')).toContain('display:inline-block');
    expect(longLineWrapper?.getAttribute('style')).toContain('width:max-content');
    expect(longLineWrapper?.getAttribute('style')).toContain('min-width:max-content');
    expect(longLineWrapper?.getAttribute('style')).toContain('white-space:nowrap');
    expect(longLineWrapper?.getAttribute('style')).toContain('word-break:keep-all');
    expect(longLineWrapper?.getAttribute('style')).toContain('max-width:none!important');
    expect(longLineWrapper?.getAttribute('style')).toContain('white-space:nowrap!important');
    expect(holder.querySelector('pre > code span[leaf]')?.getAttribute('style')).toContain('white-space:pre');
    expect(holder.querySelector('pre > code span[leaf]')?.getAttribute('style')).toContain('white-space:pre!important');
    expect(holder.querySelector('pre > span[aria-hidden="true"]')?.getAttribute('style')).not.toContain(
      'margin:-22px 0 10px 14px'
    );
    expect(holder.querySelector('pre > span[aria-hidden="true"]')?.getAttribute('style')).toContain(
      'box-shadow:rgb(255, 189, 46) 20px 0 0, rgb(39, 201, 63) 40px 0 0'
    );
  });

  it('keeps only eligible LI marker text leaves inline across Clipboard paths', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<ul><li class="outer">Outer<ul><li class="eligible-ltr">Eligible LTR</li><li class="eligible-rtl" dir="rtl">Eligible RTL</li></ul></li></ul>',
      '<ul class="task-list"><li class="task-list-item">Task</li></ul>',
      '<ul><li class="after">After marker</li><li class="whitespace">   </li></ul>',
      '<ul><li class="intermediary"><strong>Element intermediary</strong></li><li class="multiple">One<span>middle</span>Two</li></ul>',
      '<ul><li class="source-flex">Source flex</li><li class="owner-grid">Owner grid</li><li class="owner-table">Owner table</li></ul>',
      '<ul><li class="code"><pre>Code</pre></li></ul><math><li class="math">Math</li></math><svg><foreignObject><li class="svg">SVG</li></foreignObject></svg>',
      '<ul><li class="mask">Mask</li><li class="image">Image</li><li class="counter">Counter</li><li class="transform">Transform</li><li class="positioned">Positioned</li></ul>',
      '<ul><li><span class="authored">Authored <span>span</span></span></li></ul>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText = [
      'Outer',
      'Eligible LTR',
      'Eligible RTL',
      'Task',
      'After marker',
      '   ',
      'Element intermediary',
      'One middle Two',
      'Source flex',
      'Owner grid',
      'Owner table',
      'Code',
      'Math',
      'SVG',
      'Mask',
      'Image',
      'Counter',
      'Transform',
      'Positioned',
      'Authored span'
    ].join('\n');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const className = (element: Element): string =>
      [...element.classList].find((name) => !['task-list', 'task-list-item'].includes(name)) ?? '';
    const markerStyle = (element: Element, pseudoElement: string): CSSStyleDeclaration => {
      const name = className(element);
      const markerEligible = [
        'eligible-ltr',
        'eligible-rtl',
        'task',
        'after',
        'whitespace',
        'intermediary',
        'multiple',
        'source-flex',
        'owner-grid',
        'owner-table',
        'code',
        'math',
        'svg',
        'mask',
        'image',
        'counter',
        'transform',
        'positioned'
      ].includes(name);
      const content =
        'after' === name && '::after' === pseudoElement
          ? '"after"'
          : '::before' !== pseudoElement || !markerEligible
            ? 'none'
            : '"•"';
      return declaration({
        background: 'image' === name ? 'url("https://example.test/marker.png")' : 'none',
        'background-image': 'image' === name ? 'url("https://example.test/marker.png")' : 'none',
        content,
        'counter-increment': 'counter' === name ? 'item' : 'none',
        'counter-reset': 'none',
        'counter-set': 'none',
        display: 'inline',
        float: 'none',
        mask: 'mask' === name ? 'url("https://example.test/mask.svg")' : 'none',
        'mask-image': 'mask' === name ? 'url("https://example.test/mask.svg")' : 'none',
        opacity: '1',
        position: 'positioned' === name ? 'absolute' : 'static',
        transform: 'transform' === name ? 'translateX(1px)' : 'none',
        visibility: 'visible'
      });
    };
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return markerStyle(element, pseudoElement);
      if ('LI' === element.tagName) {
        const name = className(element);
        return declaration({
          display:
            'source-flex' === name
              ? 'flex'
              : 'owner-grid' === name
                ? 'grid'
                : 'owner-table' === name
                  ? 'table'
                  : 'list-item',
          float: 'none',
          position: 'positioned' === name ? 'relative' : 'static',
          transform: 'transform' === name ? 'translateX(1px)' : 'none'
        });
      }
      if ('PRE' === element.tagName || 'CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      if ('MATH' === element.tagName || 'SVG' === element.tagName) return declaration({ display: 'inline' });
      return declaration({ display: 'inline' });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('LI marker payload missing');
    const modernHtml = await blobText(htmlBlob);
    expect(await blobText(textBlob)).toBe(sourceText);
    expect(preview.innerHTML).toBe(sourceMarkup);

    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    const eligible = [...holder.querySelectorAll('li')].filter(
      (element) =>
        ['Eligible LTR', 'Eligible RTL'].some((text) => element.textContent?.includes(text)) &&
        2 === element.children.length &&
        element.children[0]?.matches('span[aria-hidden="true"]')
    );
    expect(eligible).toHaveLength(2);
    eligible.forEach((link) => {
      const children = [...link.children];
      expect(children).toHaveLength(2);
      expect(children[0]?.matches('span[aria-hidden="true"]')).toBe(true);
      expect(children[1]?.matches('span:not([leaf])')).toBe(true);
      expect(children[1]?.getAttribute('style')?.replaceAll(/\s+/gu, '')).toContain('display:inline');
      expect(children[1]?.getAttribute('style')).not.toContain('!important');
    });
    const generatedLeaves = [...holder.querySelectorAll('span[leaf]')];
    expect(generatedLeaves.length).toBeGreaterThan(10);
    generatedLeaves.forEach((leaf) => {
      expect(leaf.getAttribute('style')?.replaceAll(/\s+/gu, '') ?? '').not.toContain('display:inline');
    });
    expect(holder.querySelectorAll('li > span[leaf]')).not.toHaveLength(0);
    ['Mask', 'Image', 'Counter'].forEach((text) => {
      const guard = [...holder.querySelectorAll('li')].find((element) => element.textContent?.includes(text));
      expect(guard?.querySelector(':scope > span[leaf]')).not.toBeNull();
    });

    const simulatedWechat = document.createElement('div');
    simulatedWechat.innerHTML = modernHtml;
    simulatedWechat.querySelectorAll('span[leaf]').forEach((leaf) => {
      leaf.removeAttribute('style');
      const section = document.createElement('section');
      Array.from(leaf.attributes).forEach((attribute) => {
        section.setAttribute(attribute.name, attribute.value);
      });
      while (leaf.firstChild) section.appendChild(leaf.firstChild);
      leaf.replaceWith(section);
    });
    [...simulatedWechat.querySelectorAll('li')]
      .filter(
        (element) =>
          ['Eligible LTR', 'Eligible RTL'].some((text) => element.textContent?.includes(text)) &&
          2 === element.children.length &&
          element.children[0]?.matches('span[aria-hidden="true"]')
      )
      .forEach((link) => {
        expect(link.children[0]?.matches('span[aria-hidden="true"]')).toBe(true);
        expect(link.children[1]?.matches('span:not([leaf])')).toBe(true);
        expect(link.children[1]?.getAttribute('style')?.replaceAll(/\s+/gu, '')).toContain('display:inline');
      });

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
    const legacyHolder = document.createElement('div');
    legacyHolder.innerHTML = legacyHtml;
    const legacyEligible = [...legacyHolder.querySelectorAll('li')]
      .filter(
        (element) =>
          ['Eligible LTR', 'Eligible RTL'].some((text) => element.textContent?.includes(text)) &&
          2 === element.children.length &&
          element.children[0]?.matches('span[aria-hidden="true"]')
      )
      .map((element) => element.outerHTML);
    const modernEligible = eligible.map((element) => element.outerHTML);
    expect(legacyEligible).toEqual(modernEligible);
  });

  it.each(['counter-reset', 'counter-increment', 'counter-set'] as const)(
    'invalidates a prepared inline LI marker payload when pseudo %s changes',
    async (changedProperty) => {
      let counterReset = 'none';
      let counterIncrement = 'none';
      let counterSet = 'none';
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<ul><li class="eligible">Eligible marker</li></ul>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Eligible marker' });
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob>) {}
      }
      const writes: ClipboardItemStub[] = [];
      const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if (pseudoElement) {
          if ('::before' !== pseudoElement) return declaration({ content: 'none' });
          return declaration({
            background: 'none',
            'background-image': 'none',
            content: '"•"',
            'counter-increment': counterIncrement,
            'counter-reset': counterReset,
            'counter-set': counterSet,
            display: 'inline',
            float: 'none',
            mask: 'none',
            'mask-image': 'none',
            opacity: '1',
            position: 'static',
            transform: 'none',
            visibility: 'visible'
          });
        }
        if ('LI' === element.tagName) {
          return declaration({ display: 'list-item', float: 'none', position: 'static', transform: 'none' });
        }
        return declaration({ display: 'inline' });
      };
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items[0] as ClipboardItemStub);
        }
      });
      const htmlAt = async (index: number): Promise<string> => {
        const html = writes[index]?.payload['text/html'];
        if (!html) throw new Error(`inline marker freshness payload ${index} missing`);
        return blobText(html);
      };
      const markerLeaf = (html: string): Element | null => {
        const holder = document.createElement('div');
        holder.innerHTML = html;
        return holder.querySelector('li > span:not([aria-hidden="true"])');
      };

      await prepareClipboard(clipboard, preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const initialHtml = await htmlAt(0);
      const initialLeaf = markerLeaf(initialHtml);
      expect(initialLeaf?.matches('span:not([leaf])')).toBe(true);
      expect(initialLeaf?.getAttribute('style')?.replaceAll(/\s+/gu, '')).toContain('display:inline');

      if ('counter-reset' === changedProperty) counterReset = 'item';
      if ('counter-increment' === changedProperty) counterIncrement = 'item';
      if ('counter-set' === changedProperty) counterSet = 'item';
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const guardedLeaf = markerLeaf(await htmlAt(1));
      expect(guardedLeaf?.matches('span[leaf]')).toBe(true);
      expect(guardedLeaf?.getAttribute('style')?.replaceAll(/\s+/gu, '') ?? '').not.toContain('display:inline');

      counterReset = 'none';
      counterIncrement = 'none';
      counterSet = 'none';
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const restoredLeaf = markerLeaf(await htmlAt(2));
      expect(restoredLeaf?.matches('span:not([leaf])')).toBe(true);
      expect(restoredLeaf?.getAttribute('style')?.replaceAll(/\s+/gu, '')).toContain('display:inline');
      expect(preview.innerHTML).toBe('<ul><li class="eligible">Eligible marker</li></ul>');
    }
  );

  it('preserves code-frame pseudo geometry in modern and legacy payloads', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<pre><code>zero margin</code></pre>',
      '<pre class="authored-offset"><code>authored margin</code></pre>',
      '<pre class="boxed-offset"><code>boxed margin</code></pre>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'zero margin\nauthored margin\nboxed margin'
    });
    const frameComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('PRE' === element.tagName && '::before' === pseudoElement) {
        const authoredMargin = element.classList.contains('authored-offset');
        const boxedMargin = element.classList.contains('boxed-offset');
        return declaration({
          background: 'rgb(255, 95, 86)',
          'border-radius': '50%',
          'box-shadow': 'rgb(255, 189, 46) 20px 0 0, rgb(39, 201, 63) 40px 0 0',
          content: '""',
          display: 'inline',
          height: '12px',
          left: boxedMargin ? '18px' : '14px',
          'margin-bottom': authoredMargin ? '5px' : '0px',
          'margin-left': boxedMargin ? '4px' : authoredMargin ? '6px' : '0px',
          'margin-right': authoredMargin ? '4px' : '0px',
          'margin-top': boxedMargin ? '2px' : authoredMargin ? '3px' : '0px',
          position: 'absolute',
          top: boxedMargin ? '9px' : '13px',
          width: '12px'
        });
      }
      if ('PRE' === element.tagName) {
        const boxed = element.classList.contains('boxed-offset');
        return declaration({
          display: 'block',
          'border-left-color': boxed ? 'rgb(0, 0, 0)' : 'none',
          'border-left-style': boxed ? 'solid' : 'none',
          'border-left-width': boxed ? '3px' : '0px',
          'box-sizing': 'border-box',
          'padding-left': boxed ? '7px' : '0px',
          'padding-top': boxed ? '41px' : '34px',
          'white-space': 'pre'
        });
      }
      if ('CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const modernWrites: ClipboardItemStub[] = [];
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: frameComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items[0] as ClipboardItemStub);
    });

    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernHtmlBlob = modernWrites[0]?.payload['text/html'];
    if (!modernHtmlBlob) throw new Error('modern frame payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    const modernTextBlob = modernWrites[0]?.payload['text/plain'];
    if (!modernTextBlob) throw new Error('modern frame text payload missing');
    expect(await blobText(modernTextBlob)).toBe('zero margin\nauthored margin\nboxed margin');

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacy = createRuntime(null, null);
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });

    expect(legacyHtml).toBe(modernHtml);
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    const headers = holder.querySelectorAll('pre > div[aria-hidden="true"]');
    expect(headers).toHaveLength(3);
    const markers = holder.querySelectorAll('pre > div[aria-hidden="true"] > span[aria-hidden="true"]');
    expect(markers).toHaveLength(3);
    const zeroMargin = markers[0] as HTMLElement | undefined;
    const authoredMargin = markers[1] as HTMLElement | undefined;
    const boxedMargin = markers[2] as HTMLElement | undefined;
    const zeroHeader = headers[0] as HTMLElement | undefined;
    const authoredHeader = headers[1] as HTMLElement | undefined;
    const boxedHeader = headers[2] as HTMLElement | undefined;
    expect(holder.querySelectorAll('pre > code[data-ignore-width]')).toHaveLength(3);
    expect(holder.querySelectorAll('pre[data-ignore-width]')).toHaveLength(0);
    expect(holder.querySelectorAll('pre > div[aria-hidden="true"][data-ignore-width]')).toHaveLength(0);
    expect(zeroHeader?.style.display).toBe('block');
    expect(zeroHeader?.style.width).toBe('100%');
    expect(zeroHeader?.style.height).toBe('34px');
    expect(zeroHeader?.style.paddingTop).toBe('13px');
    expect(zeroHeader?.style.paddingLeft).toBe('14px');
    expect(authoredHeader?.style.height).toBe('34px');
    expect(authoredHeader?.style.paddingTop).toBe('16px');
    expect(authoredHeader?.style.paddingLeft).toBe('20px');
    expect(boxedHeader?.style.height).toBe('41px');
    expect(boxedHeader?.style.paddingTop).toBe('11px');
    expect(boxedHeader?.style.paddingLeft).toBe('15px');
    expect([...holder.querySelectorAll('pre')].map((pre) => pre.style.paddingTop)).toEqual(['0px', '0px', '0px']);
    expect(zeroMargin?.style.position).toBe('');
    expect(zeroMargin?.style.display).toBe('block');
    expect(zeroMargin?.style.top).toBe('');
    expect(zeroMargin?.style.left).toBe('');
    expect(zeroMargin?.style.width).toBe('12px');
    expect(zeroMargin?.style.height).toBe('12px');
    expect(zeroMargin?.style.marginTop).toBe('0px');
    expect(zeroMargin?.style.marginRight).toBe('0px');
    expect(zeroMargin?.style.marginBottom).toBe('0px');
    expect(zeroMargin?.style.marginLeft).toBe('0px');
    expect(authoredMargin?.style.position).toBe('');
    expect(authoredMargin?.style.display).toBe('block');
    expect(authoredMargin?.style.top).toBe('');
    expect(authoredMargin?.style.left).toBe('');
    expect(authoredMargin?.style.marginTop).toBe('0px');
    expect(authoredMargin?.style.marginRight).toBe('0px');
    expect(authoredMargin?.style.marginBottom).toBe('0px');
    expect(authoredMargin?.style.marginLeft).toBe('0px');
    expect(boxedMargin?.style.position).toBe('');
    expect(boxedMargin?.style.display).toBe('block');
    expect(boxedMargin?.style.top).toBe('');
    expect(boxedMargin?.style.left).toBe('');
    expect(boxedMargin?.style.marginTop).toBe('0px');
    expect(boxedMargin?.style.marginLeft).toBe('0px');
    expect([...markers].map((marker) => marker.textContent)).toEqual(['\u2060', '\u2060', '\u2060']);
    const flowHolder = document.createElement('div');
    flowHolder.innerHTML = modernHtml;
    flowHolder.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
      element.style.removeProperty('position');
      element.style.removeProperty('top');
      element.style.removeProperty('left');
    });
    const flowFrame = flowHolder.querySelector('pre');
    const flowHeader = flowFrame?.querySelector<HTMLElement>(':scope > div[aria-hidden="true"]');
    const flowMarker = flowHeader?.querySelector<HTMLElement>(':scope > span[aria-hidden="true"]');
    if (!flowFrame || !flowHeader || !flowMarker) throw new Error('normal-flow frame missing');
    const flowOffset = (value: string): number => Number.parseFloat(value || '0');
    expect(flowHeader.style.position).toBe('');
    expect(flowMarker.style.position).toBe('');
    expect(flowMarker.style.top).toBe('');
    expect(flowMarker.style.left).toBe('');
    expect(flowOffset(flowHeader.style.paddingTop) + flowOffset(flowMarker.style.marginTop)).toBe(13);
    expect(flowOffset(flowHeader.style.paddingLeft) + flowOffset(flowMarker.style.marginLeft)).toBe(14);
    expect(flowHeader.style.height).toBe('34px');
    expect(flowFrame.style.paddingTop).toBe('0px');
    expect(modernHtml).not.toContain('margin:-22px 0 10px 14px');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('leaves non-absolute, hidden, and absent frame decorations in their source states', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<pre class="static-decoration"><code>static decoration</code></pre>',
      '<pre class="hidden-decoration"><code>hidden decoration</code></pre>',
      '<pre class="absent-decoration"><code>absent decoration</code></pre>',
      '<pre class="nonempty-decoration"><code>nonempty decoration</code></pre>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'static decoration\nhidden decoration\nabsent decoration\nnonempty decoration'
    });
    const frameComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('PRE' === element.tagName && '::before' === pseudoElement) {
        const className = element.className;
        if ('static-decoration' === className) {
          return declaration({
            background: 'rgb(255, 95, 86)',
            content: '""',
            display: 'inline',
            height: '12px',
            left: '14px',
            position: 'relative',
            top: '13px',
            width: '12px'
          });
        }
        if ('nonempty-decoration' === className) {
          return declaration({
            background: 'rgb(255, 95, 86)',
            content: '"dot"',
            display: 'inline',
            height: '12px',
            left: '14px',
            position: 'absolute',
            top: '13px',
            width: '12px'
          });
        }
        if ('hidden-decoration' === className) {
          return declaration({
            background: 'rgb(255, 95, 86)',
            content: '""',
            display: 'none',
            height: '12px',
            left: '14px',
            position: 'absolute',
            top: '13px',
            width: '12px'
          });
        }
        return declaration({ content: 'none' });
      }
      if ('PRE' === element.tagName) {
        return declaration({ display: 'block', 'padding-left': '5px', 'padding-top': '28px', 'white-space': 'pre' });
      }
      if ('CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const writes: ClipboardItemStub[] = [];
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: frameComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items[0] as ClipboardItemStub);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const htmlBlob = writes[0]?.payload['text/html'];
    const textBlob = writes[0]?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('frame variant payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const frames = [...holder.querySelectorAll('pre')];
    expect(frames).toHaveLength(4);
    expect(frames.every((frame) => !frame.querySelector(':scope > div[aria-hidden="true"]'))).toBe(true);
    expect(frames.map((frame) => frame.style.paddingTop)).toEqual(['28px', '28px', '28px', '28px']);
    expect(frames[0]?.querySelector(':scope > span[aria-hidden="true"]')?.getAttribute('style')).toContain(
      'position:relative'
    );
    expect(frames[0]?.querySelector(':scope > span[aria-hidden="true"]')?.textContent).toBe(' ');
    expect(frames[1]?.querySelector(':scope > span[aria-hidden="true"]')).toBeNull();
    expect(frames[2]?.querySelector(':scope > span[aria-hidden="true"]')).toBeNull();
    expect(frames[3]?.querySelector(':scope > span[aria-hidden="true"]')?.textContent).toBe('dot');
    expect(await blobText(textBlob)).toBe(
      'static decoration\nhidden decoration\nabsent decoration\nnonempty decoration'
    );
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('fails explicitly when a registered frame marker has unsupported geometry', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code>unsupported frame</code></pre>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'unsupported frame' });
    const frameComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('PRE' === element.tagName && '::before' === pseudoElement) {
        return declaration({
          background: 'rgb(255, 95, 86)',
          content: '""',
          display: 'inline',
          height: '12px',
          position: 'absolute',
          width: '12px'
        });
      }
      if ('PRE' === element.tagName) {
        return declaration({ display: 'block', 'padding-left': '0px', 'padding-top': '28px', 'white-space': 'pre' });
      }
      if ('CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const writes: unknown[] = [];
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: frameComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it.each([
    { label: 'zero reserved band', paddingTop: '0px', markerTop: '0px' },
    { label: 'negative marker offset', paddingTop: '28px', markerTop: '-1px' },
    { label: 'marker beyond reserved band', paddingTop: '28px', markerTop: '29px' }
  ])('rejects $label code-frame geometry without mutating source', async ({ paddingTop, markerTop }) => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code>unsupported vertical frame</code></pre>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'unsupported vertical frame' });
    const frameComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('PRE' === element.tagName && '::before' === pseudoElement) {
        return declaration({
          background: 'rgb(255, 95, 86)',
          content: '""',
          display: 'inline',
          height: '12px',
          left: '14px',
          position: 'absolute',
          top: markerTop,
          width: '12px'
        });
      }
      if ('PRE' === element.tagName) {
        return declaration({
          display: 'block',
          'padding-left': '0px',
          'padding-top': paddingTop,
          'white-space': 'pre'
        });
      }
      if ('CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: frameComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async () => {}
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('normalizes blockquotes before destination pseudos while preserving both Clipboard paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<blockquote cite="https://example.test/outer"><p>Outer quote</p>',
      '<blockquote cite="https://example.test/inner"><p>Inner quote</p></blockquote>',
      '</blockquote>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Outer quote\nInner quote' });

    const quoteComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('BLOCKQUOTE' === element.tagName && '::before' === pseudoElement) {
        return declaration({ color: 'rgb(120, 10, 10)', content: '"Source marker"', display: 'inline' });
      }
      if (pseudoElement) return declaration({});
      if ('BLOCKQUOTE' === element.tagName) {
        return declaration({
          background: 'rgb(255, 249, 249)',
          'background-color': 'rgb(255, 249, 249)',
          'border-left-color': 'rgb(239, 112, 96)',
          'border-left-style': 'solid',
          'border-left-width': '3px',
          color: 'rgb(0, 0, 0)',
          display: 'block',
          'font-size': '14px',
          'line-height': '22px',
          'margin-bottom': '20px',
          'margin-left': '0px',
          'margin-right': '0px',
          'margin-top': '20px',
          overflow: 'auto',
          'overflow-wrap': 'normal',
          'overflow-x': 'auto',
          'overflow-y': 'auto',
          'padding-bottom': '10px',
          'padding-left': '20px',
          'padding-right': '10px',
          'padding-top': '10px',
          position: 'static',
          'word-break': 'normal'
        });
      }
      if ('ARTICLE' === element.tagName || 'P' === element.tagName) {
        return declaration({ display: 'block', color: 'rgb(20, 21, 22)' });
      }
      return declaration({ display: 'inline' });
    };

    const modernWrites: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: quoteComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });

    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('modern quote payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    const modernText = await blobText(modernTextBlob);

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacy = createRuntime(null, null);
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });

    expect(modernHtml).toBe(legacyHtml);
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    expect(holder.querySelectorAll('blockquote')).toHaveLength(0);
    const quotes = holder.querySelectorAll('section[cite]');
    expect(quotes).toHaveLength(2);
    expect(quotes[0]?.getAttribute('style')).toContain('border-left-width:3px');
    expect(quotes[0]?.getAttribute('style')).toContain('background:rgb(255, 249, 249)');
    expect(quotes[1]?.getAttribute('style')).toContain('padding-left:20px');
    expect(quotes[0]?.querySelector('span[aria-hidden="true"]')?.textContent).toBe('Source marker');
    expect(modernText).toContain('Outer quote');
    expect(modernText).toContain('Inner quote');
    expect(preview.querySelectorAll('blockquote')).toHaveLength(2);
  });

  it('preserves undecorated and intentionally underlined links in both Clipboard paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p><a class="plain-link" href="https://example.test/plain">Plain</a> ',
      '<a class="underlined-link" href="https://example.test/underlined">Underlined</a></p>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Plain Underlined' });
    const sourceMarkup = preview.innerHTML;
    const linkComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({});
      if ('A' === element.tagName) {
        return declaration({
          color: 'rgb(30, 107, 184)',
          display: 'inline',
          'text-decoration': element.classList.contains('underlined-link') ? 'underline' : 'none'
        });
      }
      return declaration({ display: 'block' });
    };
    const modernWrites: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: linkComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });

    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('modern link payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    const modernText = await blobText(modernTextBlob);

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacy = createRuntime(null, null);
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });

    expect(modernHtml).toBe(legacyHtml);
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    const links = holder.querySelectorAll('section a');
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('https://example.test/plain');
    expect(links[1]?.getAttribute('href')).toBe('https://example.test/underlined');
    expect(links[0]?.getAttribute('style')).toContain('text-decoration:none');
    expect(links[1]?.getAttribute('style')).toContain('text-decoration:underline');
    expect(modernText).toContain('Plain');
    expect(modernText).toContain('Underlined');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('protects CSS hash tokens split across syntax spans from WeChat topic parsing', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<pre><code><span class="selector">.sample</span><span class="punct"> { color: </span><span class="hash">#</span><span class="number">336699</span><span class="punct">; }</span></code></pre>';
    const sourceMarkup = preview.innerHTML;
    const sourceText = '.sample { color: #336699; }';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('clipboard hash payload missing');
    const html = await blobText(htmlBlob);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(holder.querySelector('pre > code')?.textContent).toContain('#\uFEFF336699');
    expect(await blobText(textBlob)).toBe(sourceText);
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps existing markers, body hashes, inline code, and emoji suffix boundaries unchanged', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<pre><code><span>#</span><span>336699</span></code></pre>',
      '<pre><code><span>#</span><span>\u2060existing</span></code></pre>',
      '<pre><code><span>#</span><span>\uFEFFexisting</span></code></pre>',
      '<pre><code># <span>body</span></code></pre>',
      '<pre><code><span>#</span><span>\uFE0F</span><span>\u20E3</span></code></pre>',
      '<pre><code><span>#</span><span>\uFE0E</span></code></pre>',
      '<pre><code><span>#</span><span>😀</span></code></pre>',
      '<pre><code><span>#</span><span>;</span></code></pre>',
      '<pre><code><span>#</span><span>，</span></code></pre>',
      '<pre><code><span>#</span></code></pre>',
      '<pre><code><span>#</span>\n<span>next</span></code></pre>',
      '<p>#body</p>',
      '<p><code>#inline</code></p>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText = [
      '#336699',
      '#\u2060existing',
      '#\uFEFFexisting',
      '# body',
      '#\uFE0F\u20E3',
      '#\uFE0E',
      '#😀',
      '#;',
      '#，',
      '#',
      '#',
      'next',
      '#body',
      '#inline'
    ].join('\n');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('marker boundary payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const codeTexts = [...holder.querySelectorAll('pre > code')].map((code) => code.textContent ?? '');
    expect(codeTexts).toHaveLength(11);
    expect(codeTexts[0]).toBe('#\uFEFF336699');
    expect(codeTexts[1]).toBe('#\uFEFF\u2060existing');
    expect(codeTexts[2]).toBe('#\uFEFFexisting');
    expect(codeTexts[3]).toBe('#\uFEFF\u2060 \u2060body');
    expect(codeTexts[4]).toBe('#\uFE0F\u20E3');
    expect(codeTexts[5]).toBe('#\uFE0E');
    expect(codeTexts[6]).toBe('#\uFEFF😀');
    expect(codeTexts[7]).toBe('#;');
    expect(codeTexts[8]).toBe('#，');
    expect(codeTexts[9]).toBe('#');
    expect(codeTexts[10]).toBe('#next');
    const paragraphs = holder.querySelectorAll('p');
    expect(paragraphs[0]?.textContent).toBe('#body');
    expect(paragraphs[1]?.querySelector('code')?.textContent).toBe('#inline');
    expect(await blobText(textBlob)).toBe(sourceText.replaceAll('\u2060', ''));
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps modern and prepared legacy code payloads identical', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre dir="rtl"><code><span class="token">#abc   tail</span></code></pre>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '#abc   tail' });
    const styleFor = (_element: Element, pseudoElement?: string): CSSStyleDeclaration =>
      pseudoElement
        ? declaration({})
        : declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' });
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modernWrites: unknown[] = [];
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('modern code payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(await blobText(modernTextBlob)).toBe('#abc   tail');

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const preparedLegacy = createRuntime(null, null);
    await prepareClipboard(preparedLegacy, preview);
    await expect(preparedLegacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    expect(legacyHtml).toBe(modernHtml);
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    expect(holder.querySelector('pre')?.getAttribute('dir')).toBe('rtl');
    expect(holder.querySelector('pre > code')?.textContent).toBe('#\uFEFFabc   tail'.replaceAll(' ', '\u2060 \u2060'));
  });

  it('restores encoded clone text after connected plaintext measurement throws', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code><span class="token">#abc   tail</span></code></pre>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '#abc   tail' });
    let measuredClone: HTMLElement | null = null;
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        if (this !== preview && this.querySelector('pre > code')) {
          measuredClone = this;
          throw new Error('plain-text-measurement-failed');
        }
        return this.textContent ?? '';
      }
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement
            ? declaration({})
            : declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' }),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async () => undefined
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      const cloneAfterThrow = measuredClone as HTMLElement | null;
      expect(cloneAfterThrow).not.toBeNull();
      expect(cloneAfterThrow?.querySelector('pre > code')?.textContent).toBe(
        '#\uFEFFabc   tail'.replaceAll(' ', '\u2060 \u2060')
      );
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
    }
  });

  it('does not mutate source code when the modern copy is cancelled after serialization starts', async () => {
    let resolveWrite: (() => void) | null = null;
    let capturedItem: { payload: Record<string, Blob | PromiseLike<Blob>> } | null = null;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {
        capturedItem = this;
      }
    }
    const controller = new AbortController();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code><span>#</span><span>336699</span></code></pre>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '#336699' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) =>
        pseudoElement
          ? declaration({})
          : declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        })
    });
    const operation = clipboard.copy(preview, { signal: controller.signal });
    const itemAfterWrite = capturedItem as { payload: Record<string, Blob | PromiseLike<Blob>> } | null;
    if (!itemAfterWrite) throw new Error('ClipboardItem was not created');
    const htmlBlob = itemAfterWrite.payload['text/html'];
    if (!htmlBlob) throw new Error('cancelled code HTML missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelector('pre > code')?.textContent).toContain('#\uFEFF336699');
    controller.abort();
    (resolveWrite as (() => void) | null)?.();
    await expect(operation).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps syntax-highlighted long lines in one non-wrapping line box', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const longLine = `print("Hello, ${'x'.repeat(240)} world")`;
    const source = `${longLine}\nreturn value`;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = `<pre><code><span class="hljs-built_in">print</span>(<span class="hljs-string">"Hello, ${'x'.repeat(240)} world"</span>)\n<span class="hljs-keyword">return</span> value</code></pre>`;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: source });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const code = holder.querySelector('pre > code');
    const rows = codeRows(code);
    const line = rows?.querySelector(':scope > nobr');
    const serialized = rows
      ? Array.from(rows.childNodes)
          .map((node) => ('BR' === (node as Element).tagName ? '\n' : (node.textContent ?? '')))
          .join('')
      : '';
    expect(serialized.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toBe(source);
    expect(code?.children).toHaveLength(1);
    expect(rows?.querySelectorAll(':scope > br')).toHaveLength(1);
    expect(line?.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toBe(longLine);
    expect(line?.getAttribute('style')).toContain('display:inline-block');
    expect(line?.getAttribute('style')).toContain('width:max-content');
    expect(line?.getAttribute('style')).toContain('min-width:max-content');
    expect(line?.getAttribute('style')).toContain('white-space:nowrap');
    expect(line?.getAttribute('style')).toContain('word-break:keep-all');
    expect(line?.getAttribute('style')).toContain('max-width:none!important');
    expect(line?.getAttribute('style')).toContain('white-space:nowrap!important');
    expect(line?.querySelector('span[leaf]')).not.toBeNull();
  });

  it('splits multiline highlighted tokens into separate non-wrapping lines', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const source = '/* first line\nsecond line */\nconst value = 1;';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<pre><code><span class="hljs-comment">/* first line\nsecond line */</span>\n<span class="hljs-keyword">const</span> value = 1;</code></pre>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: source });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const code = holder.querySelector('pre > code');
    const rows = codeRows(code);
    const lines = rows ? Array.from(rows.querySelectorAll(':scope > nobr')) : [];
    const serialized = rows
      ? Array.from(rows.childNodes)
          .map((node) => ('BR' === (node as Element).tagName ? '\n' : (node.textContent ?? '')))
          .join('')
      : '';
    expect(serialized.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toBe(source);
    expect(lines).toHaveLength(3);
    expect(code?.children).toHaveLength(1);
    expect(rows?.querySelectorAll(':scope > br')).toHaveLength(2);
    expect(rows?.querySelectorAll(':scope > nobr br')).toHaveLength(0);
    expect(lines.map((line) => line.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' '))).toEqual([
      '/* first line',
      'second line */',
      'const value = 1;'
    ]);
    lines.forEach((line) => {
      expect(line.getAttribute('style')).toContain('white-space:nowrap!important');
      expect(line.getAttribute('style')).toContain('width:max-content!important');
    });
  });

  it('centers intrinsic-width tables inside a real horizontal scroll owner', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name Status\nEasyMDE Ready' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('TABLE' === element.tagName) {
          return declaration({
            display: 'table',
            width: '320px',
            'max-width': '100%',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            'margin-left': '0px',
            'margin-right': '0px',
            'border-collapse': 'separate'
          });
        }
        return declaration({ display: 'table-row' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const table = holder.querySelector('table');
    const scrollOwner = table?.parentElement;
    const scrollOwnerStyle = scrollOwner?.getAttribute('style') ?? '';
    const tableStyle = table?.getAttribute('style') ?? '';
    expect(scrollOwner?.tagName).toBe('SECTION');
    expect(scrollOwnerStyle).toContain('display:block!important');
    expect(scrollOwnerStyle).toContain('width:100%!important');
    expect(scrollOwnerStyle).toContain('overflow-x:auto!important');
    expect(scrollOwnerStyle).toContain('overflow-y:hidden!important');
    expect(tableStyle).toContain('display:table!important');
    expect(tableStyle).toContain('width:max-content!important');
    expect(tableStyle).toContain('max-width:none!important');
    expect(tableStyle).toContain('min-width:0!important');
    expect(tableStyle).toContain('margin-left:auto!important');
    expect(tableStyle).toContain('margin-right:auto!important');
    expect(tableStyle).toContain('table-layout:auto!important');
    expect(tableStyle).toContain('overflow-x:visible!important');
    expect(tableStyle).toContain('overflow-y:visible!important');
    expect(tableStyle).toContain('border-collapse:collapse!important');
  });

  it('projects eligible THEAD paint to TH while preserving table cell styles', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const headerColor = 'rgb(226, 232, 240)';
    const cellColor = 'rgb(253, 230, 138)';
    const rowColor = 'rgb(191, 219, 254)';
    const variants = [
      'valid',
      'cell-bg',
      'row-bg',
      'alpha',
      'gradient',
      'spacing',
      'rowspan',
      'contents',
      'row-layout',
      'cell-layout',
      'math',
      'svg'
    ] as const;
    const tableMarkup = (variant: (typeof variants)[number]): string => {
      const theadAttributes = 'contents' === variant ? ' class="animal-contents"' : '';
      const thAttributes = 'rowspan' === variant ? ' rowspan="2"' : '';
      const cellContent =
        'math' === variant
          ? '<math><mi>x</mi></math>'
          : 'svg' === variant
            ? '<svg viewBox="0 0 10 10"><text>Header</text></svg>'
            : 'Header';
      return `<table class="animal-${variant}"><thead${theadAttributes}><tr><th${thAttributes}>${cellContent}</th></tr></thead><tbody><tr><td>Body</td></tr></tbody></table>`;
    };
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = variants.map(tableMarkup).join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText =
      variants.map((variant) => ('math' === variant || 'svg' === variant ? 'Header' : 'Header')).join('\n') +
      '\n' +
      variants.map(() => 'Body').join('\n');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const tableKind = (element: Element): string => {
      const table = element.closest('table');
      return (
        [...(table?.classList ?? [])].find((className) => className.startsWith('animal-'))?.slice('animal-'.length) ??
        'valid'
      );
    };
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      const kind = tableKind(element);
      if ('TABLE' === element.tagName) {
        return declaration({
          'background-color': 'transparent',
          'background-image': 'none',
          border: '0px none transparent',
          'border-spacing': 'spacing' === kind ? '2px' : '0px',
          display: 'table',
          width: '100%'
        });
      }
      if ('THEAD' === element.tagName) {
        const background =
          'alpha' === kind ? 'rgba(226, 232, 240, 0.5)' : 'gradient' === kind ? headerColor : headerColor;
        return declaration({
          background,
          'background-color': background,
          'background-image': 'gradient' === kind ? 'linear-gradient(rgb(226, 232, 240), rgb(203, 213, 225))' : 'none',
          display: 'contents' === kind ? 'contents' : 'table-header-group'
        });
      }
      if ('TR' === element.tagName) {
        const background = 'row-bg' === kind ? rowColor : 'transparent';
        return declaration({
          background,
          'background-color': background,
          'background-image': 'none',
          display: 'row-layout' === kind ? 'block' : 'table-row'
        });
      }
      if ('TH' === element.tagName) {
        const background = 'cell-bg' === kind ? cellColor : 'transparent';
        return declaration({
          background,
          'background-color': background,
          'background-image': 'none',
          'border-bottom-color': 'rgb(15, 23, 42)',
          'border-bottom-style': 'solid',
          'border-bottom-width': '1px',
          'border-radius': '6px',
          color: 'rgb(30, 41, 59)',
          display: 'cell-layout' === kind ? 'flex' : 'table-cell',
          'font-family': 'EasyMDE Header',
          'font-size': '16px',
          'overflow-x': 'auto',
          'overflow-y': 'hidden'
        });
      }
      if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
      if ('SVG' === element.tagName || 'MATH' === element.tagName) return declaration({ display: 'inline' });
      return declaration({ display: 'inline' });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('table header payload missing');
    const modernHtml = await blobText(htmlBlob);
    expect(await blobText(textBlob)).toBe(sourceText);
    expect(preview.innerHTML).toBe(sourceMarkup);

    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    const cells = [...holder.querySelectorAll('table th')];
    expect(cells).toHaveLength(variants.length);
    const normalizeStyle = (element: Element): string => (element.getAttribute('style') ?? '').replaceAll(/\s+/gu, '');
    expect(normalizeStyle(cells[0] as Element)).toContain(`background-color:${headerColor.replaceAll(/\s+/gu, '')}`);
    expect(normalizeStyle(cells[0] as Element)).toContain('font-family:EasyMDEHeader');
    expect(normalizeStyle(cells[0] as Element)).toContain('border-radius:6px');
    expect(normalizeStyle(cells[0] as Element)).toContain('overflow-x:auto');
    expect(normalizeStyle(cells[1] as Element)).toContain(`background-color:${cellColor.replaceAll(/\s+/gu, '')}`);
    expect(normalizeStyle(cells[2] as Element)).not.toContain(
      `background-color:${headerColor.replaceAll(/\s+/gu, '')}`
    );
    variants.slice(3).forEach((_variant, index) => {
      expect(normalizeStyle(cells[index + 3] as Element)).not.toContain(
        `background-color:${headerColor.replaceAll(/\s+/gu, '')}`
      );
    });

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
    expect(legacyHtml).toBe(modernHtml);
  });

  it('keeps THEAD paint decision work linear as header cells scale', async () => {
    const calls: number[] = [];
    for (const size of [10, 100, 500]) {
      let computedStyleCalls = 0;
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob>) {}
      }
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = `<table><thead><tr>${'<th>Header</th>'.repeat(size)}</tr></thead><tbody><tr>${'<td>Body</td>'.repeat(size)}</tr></tbody></table>`;
      Object.defineProperty(preview, 'innerText', {
        configurable: true,
        value: Array.from({ length: size }, () => 'Header').join(' ')
      });
      const writes: unknown[] = [];
      const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if (['TABLE', 'THEAD', 'TR', 'TH'].includes(element.tagName)) computedStyleCalls += 1;
        if (pseudoElement) return declaration({ content: 'none' });
        if ('TABLE' === element.tagName) {
          return declaration({
            'border-collapse': 'separate',
            'border-spacing': '0px',
            display: 'table',
            'overflow-x': 'clip',
            'overflow-y': 'hidden',
            'table-layout': 'auto',
            width: '320px'
          });
        }
        if ('THEAD' === element.tagName) {
          return declaration({
            'background-color': 'rgb(226, 232, 240)',
            'background-image': 'none',
            display: 'table-header-group'
          });
        }
        if ('TR' === element.tagName) {
          return declaration({ 'background-color': 'transparent', 'background-image': 'none', display: 'table-row' });
        }
        if ('TH' === element.tagName) {
          return declaration({ 'background-color': 'transparent', 'background-image': 'none', display: 'table-cell' });
        }
        if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
        return declaration({ display: 'block' });
      };
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error(`scaling table payload ${size} missing`);
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(html);
      expect(holder.querySelector('th')?.getAttribute('style')).toContain('background-color:rgb(226, 232, 240)');
      calls.push(computedStyleCalls);
    }
    expect(calls[1]).toBeLessThan((calls[0] ?? 0) * 20);
    expect(calls[2]).toBeLessThan((calls[1] ?? 0) * 10);
  });

  it('refreshes THEAD, TR, and TH paint inputs across prepared and warm copies', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    let headerColor = 'rgb(226, 232, 240)';
    let rowColor = 'transparent';
    const cellColor = 'transparent';
    let borderSpacing = '0px';
    const reads = { table: 0, thead: 0, tr: 0, th: 0 };
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Body</td></tr></tbody></table>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Header\nBody' });
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      if ('TABLE' === element.tagName) {
        reads.table += 1;
        return declaration({
          'background-color': 'transparent',
          'background-image': 'none',
          'border-spacing': borderSpacing,
          display: 'table',
          width: '100%'
        });
      }
      if ('THEAD' === element.tagName) {
        reads.thead += 1;
        return declaration({
          background: headerColor,
          'background-color': headerColor,
          'background-image': 'none',
          display: 'table-header-group'
        });
      }
      if ('TR' === element.tagName) {
        reads.tr += 1;
        return declaration({
          background: rowColor,
          'background-color': rowColor,
          'background-image': 'none',
          display: 'table-row'
        });
      }
      if ('TH' === element.tagName) {
        reads.th += 1;
        return declaration({
          background: cellColor,
          'background-color': cellColor,
          'background-image': 'none',
          display: 'table-cell'
        });
      }
      if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
      return declaration({ display: 'inline' });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });
    const htmlAt = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error(`table freshness payload ${index} missing`);
      return blobText(html);
    };
    const thStyle = (html: string): string => {
      const holder = document.createElement('div');
      holder.innerHTML = html;
      return (holder.querySelector('table th')?.getAttribute('style') ?? '').replaceAll(/\s+/gu, '');
    };

    await prepareClipboard(clipboard, preview);
    const initialReads = { ...reads };
    expect(initialReads.table).toBeGreaterThan(0);
    expect(initialReads.thead).toBeGreaterThan(0);
    expect(initialReads.tr).toBeGreaterThan(0);
    expect(initialReads.th).toBeGreaterThan(0);
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const firstHtml = await htmlAt(0);
    expect(thStyle(firstHtml)).toContain('background-color:rgb(226,232,240)');

    headerColor = 'rgb(30, 64, 175)';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const secondHtml = await htmlAt(1);
    expect(thStyle(secondHtml)).toContain('background-color:rgb(30,64,175)');
    expect(thStyle(secondHtml)).not.toContain('background-color:rgb(226,232,240)');
    expect(reads.table).toBeGreaterThan(initialReads.table);
    expect(reads.thead).toBeGreaterThan(initialReads.thead);
    expect(reads.tr).toBeGreaterThan(initialReads.tr);
    expect(reads.th).toBeGreaterThan(initialReads.th);

    rowColor = 'rgb(191, 219, 254)';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const thirdHtml = await htmlAt(2);
    expect(thStyle(thirdHtml)).not.toContain('background-color:rgb(30,64,175)');

    borderSpacing = '2px';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const fourthHtml = await htmlAt(3);
    expect(thStyle(fourthHtml)).not.toContain('background-color:rgb(30,64,175)');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('preserves eligible table clipping and separate borders through both paths', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const variants = [
      'eligible-hidden',
      'eligible-clip',
      'eligible-elliptical',
      'square',
      'collapsed',
      'spacing',
      'overflow-auto',
      'fixed',
      'katex',
      'svg'
    ] as const;
    const tableMarkup = (variant: (typeof variants)[number]): string => {
      const table = `<table class="scroll-${variant}"><tbody><tr><td>${variant}</td></tr></tbody></table>`;
      if ('katex' === variant) return `<span class="katex">${table}</span>`;
      if ('svg' === variant) return `<svg><foreignObject>${table}</foreignObject></svg>`;
      return table;
    };
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = variants.map(tableMarkup).join('');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: variants.join('\n') });
    const tableKind = (element: Element): string =>
      [...(element.closest('table')?.classList ?? [])]
        .find((name) => name.startsWith('scroll-'))
        ?.slice('scroll-'.length) ?? 'eligible-hidden';
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      const kind = tableKind(element);
      if ('TABLE' === element.tagName) {
        const eligible = ['eligible-hidden', 'eligible-clip', 'eligible-elliptical'].includes(kind);
        return declaration({
          'border-collapse': 'collapsed' === kind ? 'collapse' : 'separate',
          'border-radius': 'square' === kind ? '0px' : 'eligible-elliptical' === kind ? '12px 0px / 24px 0px' : '8px',
          'border-spacing': 'spacing' === kind ? '2px' : '0px',
          display: 'block' === kind ? 'block' : 'table',
          'overflow-x':
            'overflow-auto' === kind
              ? 'auto'
              : eligible && ['eligible-clip', 'eligible-elliptical'].includes(kind)
                ? 'clip'
                : 'hidden',
          'overflow-y': eligible && ['eligible-clip', 'eligible-elliptical'].includes(kind) ? 'clip' : 'hidden',
          'table-layout': 'fixed' === kind ? 'fixed' : 'auto',
          width: '320px'
        });
      }
      if ('TBODY' === element.tagName) return declaration({ display: 'table-row-group' });
      if ('TR' === element.tagName) return declaration({ display: 'table-row' });
      if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
      return declaration({ display: 'block' });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('table clipping payload missing');
    const modernHtml = await blobText(htmlBlob);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const modernTables = [...modernHolder.querySelectorAll('table')];
    expect(modernTables).toHaveLength(variants.length);
    const normalizedStyle = (element: Element): string => (element.getAttribute('style') ?? '').replaceAll(/\s+/gu, '');
    [0, 1, 2].forEach((index) => {
      const table = modernTables[index] as Element;
      const style = normalizedStyle(table);
      expect(style).toContain('border-collapse:separate!important');
      expect(style).toContain(`overflow-x:${0 === index ? 'hidden' : 'clip'}!important`);
      expect(style).toContain(`overflow-y:${0 === index ? 'hidden' : 'clip'}!important`);
      expect(style).toContain('border-radius:');
      expect(table.parentElement?.tagName).toBe('SECTION');
      expect(table.parentElement?.getAttribute('data-ignore-width')).not.toBeNull();
      expect(normalizedStyle(table.parentElement as Element)).toContain('overflow-x:auto!important');
    });
    variants.slice(3).forEach((_variant, index) => {
      const style = normalizedStyle(modernTables[index + 3] as Element);
      expect(style).not.toContain('border-collapse:separate!important');
      expect(style).not.toContain('overflow-x:clip!important');
      expect(style).not.toContain('overflow-y:clip!important');
    });
    expect(preview.innerHTML).toBe(sourceMarkup);

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
    const legacyHolder = document.createElement('div');
    legacyHolder.innerHTML = legacyHtml;
    const legacyTables = [...legacyHolder.querySelectorAll('table')];
    [0, 1, 2].forEach((index) => {
      expect(normalizedStyle(legacyTables[index] as Element)).toBe(normalizedStyle(modernTables[index] as Element));
    });
  });

  it('invalidates warm table clipping metadata when same-size paint inputs change', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    let radius = '8px';
    let collapse = 'separate';
    let spacing = '0px';
    let overflowX = 'clip';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><tbody><tr><td>Warm table</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Warm table' });
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      if ('TABLE' === element.tagName) {
        return declaration({
          'border-collapse': collapse,
          'border-radius': radius,
          'border-spacing': spacing,
          display: 'table',
          'overflow-x': overflowX,
          'overflow-y': 'hidden',
          'table-layout': 'auto',
          width: '320px'
        });
      }
      if ('TBODY' === element.tagName) return declaration({ display: 'table-row-group' });
      if ('TR' === element.tagName) return declaration({ display: 'table-row' });
      if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
      return declaration({ display: 'block' });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });
    const tableStyleAt = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error(`warm table payload ${index} missing`);
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(html);
      return (holder.querySelector('table')?.getAttribute('style') ?? '').replaceAll(/\s+/gu, '');
    };

    await prepareClipboard(clipboard, preview);
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await tableStyleAt(0)).toContain('border-collapse:separate!important');
    expect(await tableStyleAt(0)).toContain('overflow-x:clip!important');

    radius = '0px';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await tableStyleAt(1)).not.toContain('overflow-x:clip!important');

    radius = '8px';
    collapse = 'collapse';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await tableStyleAt(2)).not.toContain('overflow-x:clip!important');

    collapse = 'separate';
    spacing = '2px';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await tableStyleAt(3)).not.toContain('overflow-x:clip!important');

    spacing = '0px';
    overflowX = 'auto';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await tableStyleAt(4)).not.toContain('overflow-x:clip!important');
  });

  it('rejects an in-flight table radius change before final commit', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/table-freshness.png', document.baseURI).href;
    let radius = '8px';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><tbody><tr><td>In-flight table</td></tr></tbody></table><p>Delay image</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'In-flight table\nDelay image' });
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('TABLE' === element.tagName) {
          return declaration({
            'border-collapse': 'separate',
            'border-radius': radius,
            'border-spacing': '0px',
            display: 'table',
            'overflow-x': 'clip',
            'overflow-y': 'hidden',
            'table-layout': 'auto',
            width: '320px'
          });
        }
        if ('P' === element.tagName) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            display: 'block'
          });
        }
        if ('TBODY' === element.tagName) return declaration({ display: 'table-row-group' });
        if ('TR' === element.tagName) return declaration({ display: 'table-row' });
        if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const preparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    radius = '0px';
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(preparation).rejects.toThrow('wechat-copy-stale');
  });

  it('preserves block table scroll ownership from article themes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name Status\nEasyMDE Ready' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('TABLE' === element.tagName) {
          return declaration({
            display: 'block',
            width: '100%',
            'max-width': '100%',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'margin-left': '0px',
            'margin-right': '0px'
          });
        }
        return declaration({ display: 'table-row' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const table = holder.querySelector('table');
    const scrollOwner = table?.parentElement;
    const scrollOwnerStyle = scrollOwner?.getAttribute('style') ?? '';
    const tableStyle = table?.getAttribute('style') ?? '';
    expect(scrollOwner?.tagName).toBe('SECTION');
    expect(scrollOwnerStyle).toContain('overflow-x:auto!important');
    expect(scrollOwnerStyle).toContain('overflow-y:hidden!important');
    expect(tableStyle).toContain('display:block!important');
    expect(tableStyle).toContain('width:100%!important');
    expect(tableStyle).toContain('max-width:100%!important');
    expect(tableStyle).toContain('overflow-x:visible!important');
    expect(tableStyle).toContain('overflow-y:visible!important');
    expect(tableStyle).not.toContain('display:table!important');
    expect(tableStyle).toContain('margin-left:0!important');
  });

  it('keeps full-width table sizing while moving overflow to its wrapper', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name Status\nEasyMDE Ready' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('TABLE' === element.tagName) {
          return declaration({
            display: 'table',
            width: '100%',
            'max-width': '100%',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'margin-left': '0px',
            'margin-right': '0px'
          });
        }
        return declaration({ display: 'table-row' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const table = holder.querySelector('table');
    const tableStyle = table?.getAttribute('style') ?? '';
    expect(table?.parentElement?.tagName).toBe('SECTION');
    expect(tableStyle).toContain('display:table!important');
    expect(tableStyle).toContain('width:100%!important');
    expect(tableStyle).toContain('max-width:100%!important');
    expect(tableStyle).toContain('margin-left:0!important');
    expect(tableStyle).toContain('margin-right:0!important');
    expect(tableStyle).not.toContain('width:max-content!important');
    expect(table?.parentElement?.getAttribute('style')).toContain('overflow-x:auto!important');
  });

  it('preserves authored table min-width while the wrapper owns overflow', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><tbody><tr><td>Wide source</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Wide source' });
    const table = preview.querySelector('table');
    if (!table) throw new Error('authored min-width table missing');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 206, height: 206, left: 0, right: 412, top: 0, width: 412 })
    });
    Object.defineProperty(table, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 206, height: 206, left: 0, right: 520, top: 0, width: 520 })
    });
    const tableComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({});
      if ('TABLE' === element.tagName) {
        return declaration({
          display: 'table',
          height: '206px',
          'max-width': 'none',
          'min-width': '520px',
          'overflow-x': 'auto',
          'overflow-y': 'hidden',
          width: '100%'
        });
      }
      return declaration({ display: 'table-row' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const modernWrites: ClipboardItemStub[] = [];
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: tableComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items[0] as ClipboardItemStub);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernHtmlPayload = modernWrites[0]?.payload['text/html'];
    if (!modernHtmlPayload) throw new Error('authored min-width modern payload missing');
    const modernHtml = await blobText(modernHtmlPayload);

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createRuntime(null, null);
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }

    expect(legacyHtml).toBe(modernHtml);
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    const outputTable = holder.querySelector('table');
    const outputWrapper = outputTable?.parentElement;
    const tableStyle = outputTable?.getAttribute('style') ?? '';
    const wrapperStyle = outputWrapper?.getAttribute('style') ?? '';
    expect(outputWrapper?.tagName).toBe('SECTION');
    expect(tableStyle).toContain('min-width:520px');
    expect(tableStyle).not.toContain('min-width:0!important');
    expect(tableStyle).toContain('overflow-x:visible!important');
    expect(wrapperStyle).toContain('min-width:0!important');
    expect(wrapperStyle).toContain('overflow-x:auto!important');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('uses current hidden table geometry instead of stale visible classification', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | Promise<Blob>>) {}
    }
    const pane = document.createElement('div');
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><tbody><tr><td>Cell</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Cell' });
    const table = preview.querySelector('table');
    if (!(table instanceof HTMLElement)) throw new Error('table missing');
    let paneHidden = false;
    let tableWidth = '500px';
    const rect = () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      toJSON: () => ({}),
      top: 0,
      width: paneHidden ? 0 : 500,
      x: 0,
      y: 0
    });
    Object.defineProperty(preview, 'getBoundingClientRect', { configurable: true, value: rect });
    const tableRect = (element: HTMLElement): DOMRect => {
      const width = 'TABLE' === element.tagName ? (paneHidden ? 100 : 500) : 500;
      return { bottom: 0, height: 0, left: 0, right: width, toJSON: () => ({}), top: 0, width, x: 0, y: 0 } as DOMRect;
    };
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if ('TABLE' === this.tagName || 'TBODY' === this.tagName) return tableRect(this);
        if ('ARTICLE' === this.tagName && this.closest('.easymde-wechat-preview-measurement')) {
          return tableRect(this);
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    Object.defineProperty(table, 'getBoundingClientRect', { configurable: true, value: () => tableRect(table) });
    const tbody = table.querySelector('tbody');
    if (tbody)
      Object.defineProperty(tbody, 'getBoundingClientRect', { configurable: true, value: () => tableRect(tbody) });
    pane.appendChild(preview);
    document.body.appendChild(pane);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if (element === pane) return declaration({ display: paneHidden ? 'none' : 'block' });
        if ('TABLE' === element.tagName) {
          return declaration({ display: 'table', width: tableWidth });
        }
        if ('TBODY' === element.tagName) return declaration({ display: 'table-row-group' });
        if ('TR' === element.tagName) return declaration({ display: 'table-row' });
        if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      paneHidden = true;
      tableWidth = '100px';
      // A hidden SafePreviewHtmlSink refresh replaces innerHTML, so the
      // second copy must use current measured CSS rather than the old table
      // element's WeakMap entry.
      preview.innerHTML = '<table><tbody><tr><td>Cell</td></tr></tbody></table>';
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const secondItem = (writes[1] as ClipboardItemStub[])[0];
      const htmlBlob = secondItem?.payload['text/html'];
      if (!htmlBlob) throw new Error('clipboard html missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(await htmlBlob);
      const tableStyle = holder.querySelector('table')?.getAttribute('style') ?? '';
      expect(tableStyle).toContain('width:max-content!important');
      expect(tableStyle).not.toContain('width:100%!important');
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      pane.remove();
    }
  });

  it('preserves table theme display shims and container-query pseudo geometry', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>EasyMDE</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name\nEasyMDE' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) {
          if ('TABLE' === element.tagName && '::before' === pseudoElement) {
            return declaration({ display: 'table-caption', width: '100cqi', height: '0px', content: '""' });
          }
          return declaration({});
        }
        if ('TABLE' === element.tagName) {
          return declaration({
            display: 'block',
            width: '100%',
            'max-width': '100%',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'container-type': 'inline-size'
          });
        }
        if ('THEAD' === element.tagName || 'TBODY' === element.tagName) {
          return declaration({ display: 'contents' });
        }
        if ('TR' === element.tagName) return declaration({ display: 'table-row' });
        if ('TH' === element.tagName || 'TD' === element.tagName) return declaration({ display: 'table-cell' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const table = holder.querySelector('table');
    expect(table?.getAttribute('style')).toContain('container-type:inline-size');
    expect(table?.querySelector(':scope > thead')?.getAttribute('style')).toContain('display:contents');
    expect(table?.querySelector(':scope > tbody')?.getAttribute('style')).toContain('display:contents');
    const pseudo = table?.parentElement?.querySelector(':scope > span[aria-hidden="true"]');
    expect(pseudo?.getAttribute('style')).toContain('display:table-caption');
    expect(pseudo?.getAttribute('style')).toContain('width:100cqi');
    expect(pseudo?.getAttribute('style')).toContain('height:0px');
  });

  it('retains task-list checkbox state while removing arbitrary form controls', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<ul class="task-list">',
      '<li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked name="secret" value="done">Done</li>',
      '<li class="task-list-item"><input type="checkbox">Todo</li>',
      '</ul>',
      '<form><input type="text" name="secret" value="private"></form>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Done\nTodo' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('INPUT' === element.tagName) return declaration({ display: 'inline-block', width: '13px', height: '13px' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const checkboxes = holder.querySelectorAll('[role="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]?.getAttribute('aria-checked')).toBe('true');
    expect(checkboxes[0]?.getAttribute('aria-disabled')).toBe('true');
    expect(checkboxes[1]?.getAttribute('aria-checked')).toBe('false');
    expect(checkboxes[1]?.getAttribute('aria-disabled')).toBe('true');
    expect(holder.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(holder.querySelector('input[type="text"]')).toBeNull();
  });

  it.each([
    { label: 'positive source geometry', rangeMode: 'normal', expectedStatus: 'copied' },
    {
      expectedError: 'wechat-task-checkbox-geometry-text-fragment-owner-missing',
      label: 'visible text fragment owner missing',
      rangeMode: 'missing',
      expectedStatus: 'failed'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-text-fragment-empty',
      label: 'visible text fragment list empty',
      rangeMode: 'empty',
      expectedStatus: 'failed'
    }
  ] as const)(
    'validates the task checkbox static owner with $label',
    async ({ expectedError, expectedStatus, rangeMode }) => {
      const writes: unknown[] = [];
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const workspace = document.createElement('div');
      workspace.className = 'task-geometry-workspace';
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML =
        '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked>Positive</li></ul>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Positive' });
      workspace.append(preview);
      document.body.append(workspace);
      const sourceMarkup = preview.innerHTML;
      const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
      const originalRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
      const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
      const scrollOffset = (element: Element): number =>
        element.closest('.easymde-wechat-task-checkbox-measurement') ? 240 : 80;
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function (this: HTMLElement): DOMRect {
          const element = this as HTMLElement;
          if (element.matches('.task-geometry-workspace'))
            return { bottom: 240, height: 160, left: 80, right: 480, top: 80, width: 400, x: 80, y: 80 } as DOMRect;
          if ('ARTICLE' === element.tagName) {
            const offset = scrollOffset(element);
            return {
              bottom: offset + 120,
              height: 120,
              left: offset,
              right: offset + 300,
              top: offset,
              width: 300,
              x: offset,
              y: offset
            } as DOMRect;
          }
          if ('UL' === element.tagName && element.classList.contains('task-list')) {
            const offset = scrollOffset(element);
            return {
              bottom: offset + 120,
              height: 120,
              left: offset,
              right: offset + 300,
              top: offset,
              width: 300,
              x: offset,
              y: offset
            } as DOMRect;
          }
          if ('LI' === element.tagName && element.classList.contains('task-list-item')) {
            const offset = scrollOffset(element);
            return {
              bottom: offset + 40,
              height: 40,
              left: offset,
              right: offset + 300,
              top: offset,
              width: 300,
              x: offset,
              y: offset
            } as DOMRect;
          }
          if ('INPUT' === element.tagName && element.classList.contains('easymde-task-checkbox')) {
            const offset = scrollOffset(element);
            return {
              bottom: offset + 18,
              height: 16,
              left: offset,
              right: offset + 16,
              top: offset + 2,
              width: 16,
              x: offset,
              y: offset + 2
            } as DOMRect;
          }
          return (
            originalRect?.value?.call(this) ??
            ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
          );
        }
      });
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function (this: Range): DOMRect {
          const offset = this.startContainer.parentElement?.closest('.easymde-wechat-task-checkbox-measurement')
            ? 240
            : 80;
          return {
            bottom: offset + 18,
            height: 16,
            left: offset + 16,
            right: offset + 72,
            top: offset + 2,
            width: 56,
            x: offset + 16,
            y: offset + 2
          } as DOMRect;
        }
      });
      if ('missing' === rangeMode) {
        delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      } else {
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: function (this: Range): DOMRect[] {
            if ('empty' === rangeMode) return [];
            const offset = this.startContainer.parentElement?.closest('.easymde-wechat-task-checkbox-measurement')
              ? 240
              : 80;
            return [
              {
                bottom: offset + 18,
                height: 16,
                left: offset + 16,
                right: offset + 72,
                top: offset + 2,
                width: 56,
                x: offset + 16,
                y: offset + 2
              } as DOMRect
            ];
          }
        });
      }
      const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if ('INPUT' === element.tagName && pseudoElement) {
          return declaration(
            '::before' === pseudoElement
              ? { content: '""', display: 'block', height: '16px', position: 'absolute', width: '16px' }
              : { content: 'none' }
          );
        }
        if ('INPUT' === element.tagName) {
          return declaration({
            appearance: 'none',
            display: 'inline-block',
            height: '16px',
            position: 'absolute',
            width: '16px'
          });
        }
        if ('ARTICLE' === element.tagName) {
          return declaration({
            'border-bottom-width': '0px',
            'border-left-width': '0px',
            'border-right-width': '0px',
            'border-top-width': '0px',
            'box-sizing': 'content-box',
            display: 'block',
            'font-family': 'sans-serif',
            'font-size': '16px',
            'font-weight': '400',
            'letter-spacing': 'normal',
            'line-height': 'normal',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            'word-spacing': 'normal'
          });
        }
        return declaration({ display: 'block' });
      };
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      try {
        if ('copied' === expectedStatus) {
          await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
        } else {
          await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
        }
        expect(writes).toHaveLength(1);
        const item = (writes[0] as ClipboardItemStub[])[0];
        const htmlBlob = item?.payload['text/html'];
        if (!htmlBlob) throw new Error('positive task HTML missing');
        if ('copied' === expectedStatus) {
          const holder = document.createElement('div');
          holder.innerHTML = await blobText(htmlBlob);
          const owner = holder.querySelector('[role="checkbox"]');
          expect(owner).not.toBeNull();
          expect(owner?.getAttribute('aria-checked')).toBe('true');
          expect(owner?.getAttribute('aria-disabled')).toBe('true');
          expect(owner?.getAttribute('style')).toBeTruthy();
          expect(holder.querySelectorAll('input')).toHaveLength(0);
        } else {
          if (!expectedError) throw new Error('task failure expectation missing');
          await expect(blobText(htmlBlob)).rejects.toThrow(expectedError);
        }
        expect(preview.innerHTML).toBe(sourceMarkup);
        expect(document.querySelector('.easymde-wechat-task-checkbox-measurement')).toBeNull();
      } finally {
        workspace.remove();
        if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
        else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
        if (originalRangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeRect);
        else delete (Range.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
        if (originalRangeClientRects)
          Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
        else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      }
    }
  );

  type HiddenTaskGeometryCase = Readonly<{
    accentColor?: string;
    borderEdge?: string;
    boxSizing?: string;
    expectedError?: string;
    expectedStatus?: 'copied' | 'failed';
    horizontalEdge?: string;
    inputDisplay?: string;
    label: string;
    maxHeight?: string;
    maxWidth?: string;
    missingListValue?: boolean;
    missingRootEdge?: boolean;
    measurementHeight: number;
    measurementWidth: number;
    minHeight?: string;
    minWidth?: string;
    measurementListWidth?: string;
    pseudoBoxSizing?: string;
    pseudoPadding?: string;
    pseudoTransformBox?: string;
    measurementPseudoTransform?: string;
    pseudoTransform?: string;
    pseudoTransformOrigin?: string;
    measurementTransform?: string;
    nonPaintText?: boolean;
    rangeMode?: 'empty' | 'missing' | 'multi' | 'normal';
    textMode?: 'content-visibility-hidden' | 'display-none-hidden' | 'none' | 'visibility-hidden-visible';
    sourceWidth: string;
    transform: string;
    verticalEdge?: string;
  }>;
  const hiddenTaskGeometryCases: HiddenTaskGeometryCase[] = [
    {
      expectedStatus: 'copied',
      label: 'quantized width',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'hidden caption prefix uses ready text geometry',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-static-owner-count-mismatch',
      inputDisplay: 'none',
      label: 'task input without a static paint owner',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      horizontalEdge: '2px',
      label: 'border-box edge floor',
      measurementHeight: 16,
      measurementWidth: 4.003,
      sourceWidth: '3px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      boxSizing: 'content-box',
      horizontalEdge: '2px',
      label: 'content-box edges',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '12px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      boxSizing: 'content-box',
      horizontalEdge: '2px',
      label: 'content-box min clamp',
      measurementHeight: 16,
      measurementWidth: 22.003,
      minWidth: '18px',
      sourceWidth: '12px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-mismatch',
      boxSizing: 'content-box',
      horizontalEdge: '2px',
      label: 'content-box min clamp without edge conversion',
      measurementHeight: 16,
      measurementWidth: 18.003,
      minWidth: '18px',
      sourceWidth: '12px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      boxSizing: 'content-box',
      horizontalEdge: '2px',
      label: 'content-box max clamp',
      maxWidth: '18px',
      measurementHeight: 16,
      measurementWidth: 22.003,
      sourceWidth: '24px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-mismatch',
      boxSizing: 'content-box',
      horizontalEdge: '2px',
      label: 'content-box max clamp without edge conversion',
      maxWidth: '18px',
      measurementHeight: 16,
      measurementWidth: 18.003,
      sourceWidth: '24px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-mismatch',
      label: 'width plus 2.5px',
      measurementHeight: 16,
      measurementWidth: 18.5,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-mismatch',
      label: 'width plus 24px',
      measurementHeight: 16,
      measurementWidth: 40,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-mismatch',
      label: 'height plus 2.5px',
      measurementHeight: 18.5,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-checkbox-measurement-unavailable',
      label: 'zero measurement width',
      measurementHeight: 16,
      measurementWidth: 0,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-unavailable',
      label: 'auto source width',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: 'auto',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-unavailable',
      label: 'percentage source width',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '50%',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-dimensions-unavailable',
      label: 'nonfinite source width',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: 'NaNpx',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'identity matrix input',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      measurementTransform: 'matrix(1, 0, 0, 1, 0, 0)',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'ready pure translation input',
      measurementHeight: 16,
      measurementWidth: 16.003,
      measurementTransform: 'matrix(1, 0, 0, 1, 0, 1)',
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-text-fragment-owner-missing',
      label: 'text fragment owner missing',
      measurementHeight: 16,
      measurementWidth: 16.003,
      rangeMode: 'missing',
      sourceWidth: '16px',
      textMode: 'visibility-hidden-visible',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-text-fragment-empty',
      label: 'text fragment list empty',
      measurementHeight: 16,
      measurementWidth: 16.003,
      rangeMode: 'empty',
      sourceWidth: '16px',
      textMode: 'visibility-hidden-visible',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'middle text fragments use one union',
      measurementHeight: 16,
      measurementWidth: 16.003,
      rangeMode: 'multi',
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-transform-unavailable',
      label: 'rotated input',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'matrix(0, 1, -1, 0, 0, 0)'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-transform-unavailable',
      label: 'scaled input',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'matrix(2, 0, 0, 1, 0, 0)'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-transform-unavailable',
      label: 'three-dimensional identity input',
      measurementHeight: 16,
      measurementWidth: 16.003,
      measurementTransform: 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)',
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-input-transform-unavailable',
      label: 'ready rotated square with source none',
      measurementHeight: 16,
      measurementWidth: 16.003,
      measurementTransform: 'matrix(0, 1, -1, 0, 0, 0)',
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'hidden LI auto with measured active pseudo',
      measurementHeight: 16,
      measurementWidth: 16.003,
      measurementListWidth: '306.5px',
      measurementPseudoTransform: 'matrix(1.1, 0, 0, 1.1, 2, 3)',
      nonPaintText: true,
      pseudoTransformOrigin: '50% 50%',
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'visible child overrides hidden visibility with fragments',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      textMode: 'visibility-hidden-visible',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'display none ancestor skips text fragments',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      textMode: 'display-none-hidden',
      transform: 'none'
    },
    {
      expectedStatus: 'copied',
      label: 'content visibility ancestor skips text fragments',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      textMode: 'content-visibility-hidden',
      transform: 'none'
    },
    {
      accentColor: 'rgb(18, 52, 86)',
      expectedError: 'wechat-task-checkbox-geometry-style-mismatch',
      label: 'hidden non-layout paint mismatch',
      measurementHeight: 16,
      measurementWidth: 16.003,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-measurement-root-content-width-unavailable',
      label: 'measurement root edge missing',
      measurementHeight: 16,
      measurementWidth: 16.003,
      missingRootEdge: true,
      sourceWidth: '16px',
      transform: 'none'
    },
    {
      expectedError: 'wechat-task-checkbox-geometry-list-item-style-unavailable',
      label: 'measurement list used value missing',
      measurementHeight: 16,
      measurementWidth: 16.003,
      missingListValue: true,
      sourceWidth: '16px',
      transform: 'none'
    }
  ];
  it.each(hiddenTaskGeometryCases)(
    'uses ready hidden measurement geometry for $label',
    async ({
      accentColor,
      borderEdge = '0px',
      boxSizing = 'border-box',
      expectedError,
      expectedStatus = 'failed',
      label,
      inputDisplay = 'inline-block',
      horizontalEdge = '0px',
      maxHeight = 'none',
      maxWidth = 'none',
      missingListValue = false,
      missingRootEdge = false,
      measurementHeight,
      measurementListWidth = 'auto',
      measurementWidth,
      minHeight = 'auto',
      minWidth = 'auto',
      pseudoBoxSizing = 'border-box',
      pseudoPadding = '0px',
      pseudoTransformBox = 'border-box',
      pseudoTransform = 'none',
      measurementPseudoTransform = pseudoTransform,
      pseudoTransformOrigin = '50% 50%',
      nonPaintText = false,
      rangeMode = 'normal',
      sourceWidth,
      textMode = 'none',
      transform,
      measurementTransform = transform,
      verticalEdge = '0px'
    }) => {
      const writes: unknown[] = [];
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const workspace = document.createElement('div');
      workspace.className = 'task-hidden-workspace';
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      const textMarkup = nonPaintText
        ? '<span data-task-hidden>Metadata</span><svg><title>SVG title</title><defs><path d="M0 0"></path></defs></svg><math><annotation>Math metadata</annotation></math>'
        : 'visibility-hidden-visible' === textMode
          ? '<span data-task-visibility-wrapper><span data-task-visible>Visible metadata</span></span>'
          : 'display-none-hidden' === textMode
            ? '<span data-task-display-none-wrapper>Metadata</span>'
            : 'content-visibility-hidden' === textMode
              ? '<span data-task-content-hidden-wrapper>Metadata</span>'
              : '';
      const hiddenCaptionPrefix = 'hidden caption prefix uses ready text geometry' === label;
      preview.innerHTML = hiddenCaptionPrefix
        ? '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked> <strong>Caption</strong></li></ul>'
        : `<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked>Hidden${textMarkup}</li></ul>`;
      Object.defineProperty(preview, 'innerText', { configurable: true, value: hiddenCaptionPrefix ? ' Caption' : 'Hidden' });
      workspace.append(preview);
      document.body.append(workspace);
      const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
      const originalRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
      const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
      const rect = (width: number, height: number, top = 0): DOMRect =>
        ({ bottom: top + height, height, left: 0, right: width, top, width, x: 0, y: top }) as DOMRect;
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function (this: HTMLElement): DOMRect {
          if (this.matches('.task-hidden-workspace')) return rect(400, 160);
          const hiddenSource = Boolean(
            this.closest('.task-hidden-workspace') &&
              !this.closest('.easymde-wechat-preview-measurement, .easymde-wechat-task-checkbox-measurement')
          );
          if (this.matches('article, ul.task-list')) return hiddenSource ? rect(0, 0) : rect(300, 120);
          if (this.matches('li.task-list-item')) return hiddenSource ? rect(0, 0) : rect(300, 40);
          if (this.matches('input.easymde-task-checkbox'))
            return hiddenSource ? rect(0, 0) : rect(measurementWidth, measurementHeight, 2);
          return originalRect?.value?.call(this) ?? rect(0, 0);
        }
      });
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () => rect(56, 16, 2)
      });
      if ('missing' === rangeMode) {
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          get(this: Range): (() => DOMRect[]) | undefined {
            if (this.startContainer.parentElement?.closest('[data-task-visible]')) return undefined;
            return function (this: Range): DOMRect[] {
              const sourceHidden = Boolean(
                this.startContainer.parentElement?.closest('.task-hidden-workspace') &&
                  !this.startContainer.parentElement?.closest(
                    '.easymde-wechat-preview-measurement, .easymde-wechat-task-checkbox-measurement'
                  )
              );
              return sourceHidden ? [] : [rect(56, 16, 2)];
            };
          }
        });
      } else {
        Object.defineProperty(Range.prototype, 'getClientRects', {
          configurable: true,
          value: function (this: Range): DOMRect[] {
            const sourceHidden = Boolean(
              this.startContainer.parentElement?.closest('.task-hidden-workspace') &&
                !this.startContainer.parentElement?.closest(
                  '.easymde-wechat-preview-measurement, .easymde-wechat-task-checkbox-measurement'
                )
            );
            if (sourceHidden) return [];
            if (hiddenCaptionPrefix) {
              const selected = (this.startContainer.nodeValue ?? '').slice(this.startOffset, this.endOffset);
              return [rect(selected.trim() ? 56 : 0, 16, 2)];
            }
            if ('empty' === rangeMode && this.startContainer.parentElement?.closest('[data-task-visible]')) {
              return [];
            }
            if ('multi' === rangeMode) return [rect(56, 16, 2), rect(56, 16, 18)];
            return [rect(56, 16, 2)];
          }
        });
      }
      const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if ('DIV' === element.tagName && element.classList.contains('task-hidden-workspace')) {
          return declaration({ display: 'none' });
        }
        if ('SPAN' === element.tagName && element.hasAttribute('data-task-hidden')) {
          return declaration({ display: 'none' });
        }
        if ('SPAN' === element.tagName && element.hasAttribute('data-task-visibility-wrapper')) {
          return declaration({ display: 'block', visibility: 'hidden' });
        }
        if ('SPAN' === element.tagName && element.hasAttribute('data-task-visible')) {
          return declaration({ display: 'block', visibility: 'visible' });
        }
        if ('SPAN' === element.tagName && element.hasAttribute('data-task-display-none-wrapper')) {
          return declaration({ display: 'none' });
        }
        if ('SPAN' === element.tagName && element.hasAttribute('data-task-content-hidden-wrapper')) {
          return declaration({ 'content-visibility': 'hidden', display: 'block' });
        }
        if ('ARTICLE' === element.tagName) {
          return declaration({
            'border-bottom-width': '0px',
            'border-left-width': '0px',
            'border-right-width': '0px',
            'border-top-width': '0px',
            'box-sizing': 'content-box',
            display: 'block',
            'font-family': 'sans-serif',
            'font-size': '16px',
            'font-weight': '400',
            'letter-spacing': 'normal',
            'line-height': 'normal',
            'padding-bottom': '0px',
            'padding-left': missingRootEdge ? '' : '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            'word-spacing': 'normal'
          });
        }
        if ('INPUT' === element.tagName && pseudoElement) {
          const pseudoTransformValue = element.closest('.easymde-wechat-preview-measurement')
            ? measurementPseudoTransform
            : pseudoTransform;
          return declaration(
            '::before' === pseudoElement
              ? {
                  'accent-color': accentColor ?? 'auto',
                  'box-sizing': pseudoBoxSizing,
                  'border-bottom-width': '0px',
                  'border-left-width': '0px',
                  'border-right-width': '0px',
                  'border-top-width': '0px',
                  content: '""',
                  display: 'block',
                  height: '16px',
                  left: 'auto',
                  'margin-bottom': '0px',
                  'margin-left': '0px',
                  'margin-right': '0px',
                  'margin-top': '0px',
                  'padding-bottom': pseudoPadding,
                  'padding-left': pseudoPadding,
                  'padding-right': pseudoPadding,
                  'padding-top': pseudoPadding,
                  position: 'absolute',
                  bottom: 'auto',
                  right: 'auto',
                  top: 'auto',
                  transform: pseudoTransformValue,
                  'transform-box': pseudoTransformBox,
                  'transform-origin': pseudoTransformOrigin,
                  width: '16px'
                }
              : { content: 'none' }
          );
        }
        if ('INPUT' === element.tagName) {
          return declaration({
            'accent-color': accentColor
              ? element.closest('.easymde-wechat-preview-measurement')
                ? 'rgb(101, 67, 33)'
                : accentColor
              : 'auto',
            appearance: 'none',
            'box-sizing': boxSizing,
            'border-bottom-width': borderEdge,
            'border-left-width': borderEdge,
            'border-right-width': borderEdge,
            'border-top-width': borderEdge,
            display: inputDisplay,
            height: '16px',
            'max-height': maxHeight,
            'max-width': maxWidth,
            'min-height': minHeight,
            'min-width': minWidth,
            padding: '0px',
            'padding-bottom': verticalEdge,
            'padding-left': horizontalEdge,
            'padding-right': horizontalEdge,
            'padding-top': verticalEdge,
            position: 'absolute',
            transform: element.closest('.easymde-wechat-preview-measurement') ? measurementTransform : transform,
            width: sourceWidth
          });
        }
        if ('LI' === element.tagName && element.classList.contains('task-list-item')) {
          return declaration({
            'border-bottom-width': '0px',
            'border-left-width': '0px',
            'border-right-width': '0px',
            'border-top-width': '0px',
            display: 'block',
            height: 'auto',
            'margin-bottom': '0px',
            'margin-left': '0px',
            'margin-right': '0px',
            'margin-top': '0px',
            'max-height': 'none',
            'max-width': 'none',
            'min-height': 'auto',
            'min-width': 'auto',
            'padding-bottom': '0px',
            'padding-left': missingListValue ? '' : '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            'white-space': 'normal',
            width: element.closest('.easymde-wechat-preview-measurement') ? measurementListWidth : 'auto'
          });
        }
        if ('STRONG' === element.tagName) return declaration({ display: 'inline', 'white-space': 'normal' });
        return declaration({ display: 'block' });
      };
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      try {
        if ('copied' === expectedStatus) {
          await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
        } else {
          await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
        }
        const item = (writes[0] as ClipboardItemStub[])[0];
        const htmlBlob = item?.payload['text/html'];
        if (!htmlBlob) throw new Error('hidden task HTML missing');
        if ('copied' === expectedStatus) {
          const holder = document.createElement('div');
          holder.innerHTML = await blobText(htmlBlob);
          const owner = holder.querySelector('[role="checkbox"]');
          expect(owner).not.toBeNull();
          expect(owner?.getAttribute('aria-checked')).toBe('true');
          expect(owner?.getAttribute('aria-disabled')).toBe('true');
          expect(owner?.getAttribute('style')).toBeTruthy();
          expect(holder.querySelectorAll('input')).toHaveLength(0);
          if (hiddenCaptionPrefix) {
            expect(holder.querySelector('strong')?.textContent).toBe('Caption');
            expect(holder.textContent).not.toContain(' Caption');
          }
        } else {
          if (!expectedError) throw new Error('hidden task failure expectation missing');
          await expect(blobText(htmlBlob)).rejects.toThrow(expectedError);
        }
        expect(preview.getBoundingClientRect().width).toBe(0);
        expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      } finally {
        workspace.remove();
        if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
        else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
        if (originalRangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeRect);
        else delete (Range.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
        if (originalRangeClientRects)
          Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
        else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      }
    }
  );

  it.each(['source', 'clone'] as const)(
    'fails a sparse LI direct image when the %s image owner is broken',
    async (brokenOwner) => {
      const writes: unknown[] = [];
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const workspace = document.createElement('div');
      workspace.className = 'task-image-workspace';
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML =
        '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">Image<img src="https://example.test/task.png"></li></ul>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Image' });
      workspace.append(preview);
      document.body.append(workspace);
      const sourceImage = preview.querySelector('img');
      if (!sourceImage) throw new Error('sparse task image missing');
      const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
      const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
      const originalNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');
      Object.defineProperties(sourceImage, {
        complete: { configurable: true, value: true },
        naturalHeight: { configurable: true, value: 'source' === brokenOwner ? 0 : 32 },
        naturalWidth: { configurable: true, value: 'source' === brokenOwner ? 0 : 64 }
      });
      Object.defineProperty(HTMLImageElement.prototype, 'complete', {
        configurable: true,
        get(this: HTMLImageElement) {
          return true;
        }
      });
      Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
        configurable: true,
        get(this: HTMLImageElement) {
          if (!this.closest('.easymde-wechat-task-checkbox-measurement')) return 64;
          return 'clone' === brokenOwner ? 0 : 64;
        }
      });
      Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
        configurable: true,
        get(this: HTMLImageElement) {
          if (!this.closest('.easymde-wechat-task-checkbox-measurement')) return 32;
          return 'clone' === brokenOwner ? 0 : 32;
        }
      });
      const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function (this: HTMLElement): DOMRect {
          if (this.matches('.task-image-workspace'))
            return { bottom: 160, height: 160, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
          return (
            originalRect?.value?.call(this) ??
            ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
          );
        }
      });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('INPUT' === element.tagName && pseudoElement)
            return declaration('::before' === pseudoElement ? { content: '""' } : { content: 'none' });
          if ('INPUT' === element.tagName)
            return declaration({ appearance: 'none', display: 'inline-block', position: 'absolute' });
          if (element === workspace) return declaration({ display: 'block' });
          return declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      try {
        await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
        expect(writes).toHaveLength(1);
        expect(document.querySelector('.easymde-wechat-task-checkbox-measurement')).toBeNull();
      } finally {
        workspace.remove();
        if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
        else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
        if (originalComplete) Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
        else delete (HTMLImageElement.prototype as unknown as { complete?: unknown }).complete;
        if (originalNaturalWidth)
          Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
        else delete (HTMLImageElement.prototype as unknown as { naturalWidth?: unknown }).naturalWidth;
        if (originalNaturalHeight)
          Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', originalNaturalHeight);
        else delete (HTMLImageElement.prototype as unknown as { naturalHeight?: unknown }).naturalHeight;
      }
    }
  );

  it('removes an owned sparse task lease after abort while image readiness is pending', async () => {
    const controller = new AbortController();
    let cloneReady = false;
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const workspace = document.createElement('div');
    workspace.className = 'task-pending-workspace';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">Pending<img src="https://example.test/pending-task.png"></li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Pending' });
    workspace.append(preview);
    document.body.append(workspace);
    const sourceImage = preview.querySelector('img');
    if (!sourceImage) throw new Error('pending sparse task image missing');
    const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
    const originalNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');
    Object.defineProperties(sourceImage, {
      complete: { configurable: true, value: true },
      naturalHeight: { configurable: true, value: 32 },
      naturalWidth: { configurable: true, value: 64 }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.closest('.easymde-wechat-task-checkbox-measurement') ? cloneReady : true;
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.closest('.easymde-wechat-task-checkbox-measurement') && cloneReady ? 64 : 0;
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.closest('.easymde-wechat-task-checkbox-measurement') && cloneReady ? 32 : 0;
      }
    });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('.task-pending-workspace'))
          return { bottom: 160, height: 160, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('INPUT' === element.tagName && pseudoElement)
          return declaration('::before' === pseudoElement ? { content: '""' } : { content: 'none' });
        if ('INPUT' === element.tagName)
          return declaration({ appearance: 'none', display: 'inline-block', position: 'absolute' });
        if (element === workspace) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    try {
      const copy = clipboard.copy(preview, { signal: controller.signal });
      await vi.waitFor(() => {
        expect(writes).toHaveLength(1);
        expect(document.querySelector('.easymde-wechat-task-checkbox-measurement')).not.toBeNull();
      });
      controller.abort();
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(document.querySelector('.easymde-wechat-task-checkbox-measurement')).toBeNull();
      cloneReady = true;
    } finally {
      workspace.remove();
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      if (originalComplete) Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
      else delete (HTMLImageElement.prototype as unknown as { complete?: unknown }).complete;
      if (originalNaturalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
      else delete (HTMLImageElement.prototype as unknown as { naturalWidth?: unknown }).naturalWidth;
      if (originalNaturalHeight)
        Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', originalNaturalHeight);
      else delete (HTMLImageElement.prototype as unknown as { naturalHeight?: unknown }).naturalHeight;
    }
  });

  it('exports every task checkbox through an aligned static owner', async () => {
    const modernWrites: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    const initialTaskStates = Array.from({ length: 19 }, (_, index) => ![2, 15].includes(index));
    const taskStates = initialTaskStates.map((checked, index) => (1 === index ? false : checked));
    const taskText = taskStates.map((_, index) => `Task ${index + 1}`).join('\n');
    const workspace = document.createElement('div');
    workspace.className = 'task-owner-workspace';
    preview.innerHTML = [
      '<ul class="task-list">',
      ...initialTaskStates.map(
        (checked, index) =>
          `<li class="task-list-item"><input class="easymde-task-checkbox${18 === index ? ' native' : ''}" type="checkbox"${checked ? ' checked' : ''}>Task ${index + 1}</li>`
      ),
      '</ul>',
      '<form><input type="text" name="secret" value="private"></form>'
    ].join('');
    const propertyDivergenceInput = preview.querySelectorAll<HTMLInputElement>('input.easymde-task-checkbox')[1];
    if (!propertyDivergenceInput) throw new Error('task property divergence input missing');
    propertyDivergenceInput.checked = false;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: taskText });
    workspace.append(preview);
    document.body.append(workspace);
    const sourceMarkup = preview.innerHTML;
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('INPUT' === element.tagName) {
        const input = element as HTMLInputElement;
        const native = input.classList.contains('native');
        if (pseudoElement && native) return declaration({ content: 'none' });
        if ('::before' === pseudoElement) {
          return declaration({
            'background-color': 'rgb(255, 255, 255)',
            'border-color': 'rgb(255, 165, 49)',
            'border-radius': '50%',
            'border-style': 'solid',
            'border-width': '1px',
            content: '""',
            display: 'block',
            height: '16px',
            position: 'absolute',
            width: '16px'
          });
        }
        if ('::after' === pseudoElement) {
          return declaration({
            'border-bottom-color': 'rgb(255, 255, 255)',
            'border-bottom-style': 'solid',
            'border-bottom-width': '2px',
            'border-right-color': 'rgb(255, 255, 255)',
            'border-right-style': 'solid',
            'border-right-width': '2px',
            content: '""',
            display: 'block',
            height: '10px',
            opacity: input.checked ? '1' : '0',
            position: 'absolute',
            width: '6px'
          });
        }
        return declaration({
          '-webkit-appearance': 'none',
          'accent-color': native ? 'rgb(52, 152, 219)' : input.checked ? 'rgb(255, 192, 0)' : 'auto',
          appearance: 'none',
          ...(native
            ? {
                'background-color': 'rgb(255, 255, 255)',
                'border-color': 'rgb(52, 152, 219)',
                'border-style': 'solid',
                'border-width': '1px'
              }
            : {}),
          display: 'inline-block',
          height: '16px',
          'margin-right': '4px',
          position: 'relative',
          width: '16px'
        });
      }
      if ('ARTICLE' === element.tagName) {
        return declaration({
          'border-bottom-width': '0px',
          'border-left-width': '0px',
          'border-right-width': '0px',
          'border-top-width': '0px',
          'box-sizing': 'content-box',
          display: 'block',
          'font-family': 'sans-serif',
          'font-size': '16px',
          'font-weight': '400',
          'letter-spacing': 'normal',
          'line-height': 'normal',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          'word-spacing': 'normal'
        });
      }
      return declaration({ display: 'block' });
    };
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('.task-owner-workspace')) {
          return { bottom: 160, height: 160, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        if ('ARTICLE' === this.tagName || ('UL' === this.tagName && this.classList.contains('task-list'))) {
          return { bottom: 120, height: 120, left: 0, right: 300, top: 0, width: 300, x: 0, y: 0 } as DOMRect;
        }
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 116, height: 16, left: 100, right: 116, top: 100, width: 16, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 40, left: 100, right: 400, top: 90, width: 300, x: 100, y: 90 } as DOMRect;
        }
        if (this.matches('span[inert]')) {
          const parent = this.parentElement;
          const children = parent ? [...parent.children] : [];
          const index = children.indexOf(this);
          const left = 0 === index ? 100 : 116;
          return { bottom: 116, height: 0, left, right: left, top: 116, width: 0, x: left, y: 116 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: (): DOMRect[] => [
        { bottom: 116, height: 16, left: 116, right: 172, top: 102, width: 56, x: 116, y: 102 } as DOMRect
      ]
    });
    const modern = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        modernWrites.push(items);
      }
    });

    try {
      await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (modernWrites[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('task checkbox payload missing');
      const textBlob = item?.payload['text/plain'];
      if (!textBlob) throw new Error('task checkbox plain payload missing');
      await expect(blobText(textBlob)).resolves.toBe(taskText);
      const modernHtml = await blobText(htmlBlob);
      const holder = document.createElement('div');
      holder.innerHTML = modernHtml;
      const owners = [...holder.querySelectorAll('[role="checkbox"]')];
      expect(holder.querySelectorAll('input')).toHaveLength(0);
      expect(holder.querySelector('input[type="text"]')).toBeNull();
      expect(owners).toHaveLength(taskStates.length);
      expect(owners.map((owner) => owner.getAttribute('aria-checked'))).toEqual(
        taskStates.map((checked) => (checked ? 'true' : 'false'))
      );
      expect(owners.every((owner) => owner.getAttribute('aria-disabled') === 'true')).toBe(true);
      expect(owners.every((owner) => Boolean(owner.getAttribute('style')))).toBe(true);
      expect(
        owners.filter((owner) => owner.querySelectorAll(':scope > span[aria-hidden="true"]').length > 0)
      ).toHaveLength(18);
      expect(owners[18]?.querySelectorAll(':scope > span[aria-hidden="true"]')).toHaveLength(0);
      expect(holder.querySelectorAll('li span[leaf]')).toHaveLength(0);
      expect(modernHtml).toContain('\u2060');
      expect(modernHtml).not.toContain('✓');
      expect(preview.innerHTML).toBe(sourceMarkup);

      let legacyHtml = '';
      const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => {
          legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
          return true;
        })
      });
      try {
        const legacy = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        await prepareClipboard(legacy, preview);
        await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      } finally {
        if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
        else delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
      const strippedPreview = preview.cloneNode(true) as HTMLElement;
      Object.defineProperty(strippedPreview, 'innerText', { configurable: true, value: taskText });
      workspace.append(strippedPreview);
      const strippedInput = strippedPreview.querySelectorAll<HTMLInputElement>('input.easymde-task-checkbox')[1];
      if (!strippedInput) throw new Error('stripped task input missing');
      const strippedWrites: unknown[] = [];
      const originalSetAttribute = Element.prototype.setAttribute;
      Object.defineProperty(Element.prototype, 'setAttribute', {
        configurable: true,
        value: function (this: Element, name: string, value: string): void {
          let strippedStyle: string | null = null;
          if ('style' === name && this.matches('span') && value.includes('accent-color:')) {
            strippedStyle = value
              .split(';')
              .filter((declaration) => {
                const property = declaration.slice(0, declaration.indexOf(':')).trim().toLowerCase();
                return (
                  !property.startsWith('background') &&
                  !property.startsWith('border-') &&
                  !['box-shadow', 'filter'].includes(property)
                );
              })
              .join(';');
          }
          originalSetAttribute.call(this, name, value);
          if (strippedStyle !== null) {
            queueMicrotask(() => originalSetAttribute.call(this, name, strippedStyle as string));
          }
        }
      });
      try {
        const stripped = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: ClipboardItemStub,
          document,
          getComputedStyle,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: async (items) => {
            strippedWrites.push(items);
          }
        });
        strippedInput.checked = true;
        const strippedResult = await stripped.copy(strippedPreview);
        expect(strippedResult).toEqual({ code: 'wechat-copy-failed', status: 'failed' });
        const strippedItem = (strippedWrites[0] as ClipboardItemStub[])[0];
        const strippedBlob = strippedItem?.payload['text/html'];
        if (!strippedBlob) throw new Error('stripped task checkbox payload missing');
        await expect(blobText(strippedBlob)).rejects.toThrow('wechat-task-checkbox-static-owner-paint-mismatch');
      } finally {
        strippedInput.checked = false;
        Object.defineProperty(Element.prototype, 'setAttribute', { configurable: true, value: originalSetAttribute });
      }

      const missingPseudoPreview = preview.cloneNode(true) as HTMLElement;
      Object.defineProperty(missingPseudoPreview, 'innerText', { configurable: true, value: taskText });
      workspace.append(missingPseudoPreview);
      const missingPseudoWrites: unknown[] = [];
      const originalInsertBefore = Element.prototype.insertBefore;
      Object.defineProperty(Element.prototype, 'insertBefore', {
        configurable: true,
        value: function (this: Element, node: Node, reference: Node | null): Node {
          if (
            node instanceof Element &&
            node.matches('span[aria-hidden="true"]') &&
            this.matches('span') &&
            this.getAttribute('style')?.includes('accent-color:')
          ) {
            return node;
          }
          return originalInsertBefore.call(this, node, reference);
        }
      });
      try {
        const missingPseudo = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: ClipboardItemStub,
          document,
          getComputedStyle,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: async (items) => {
            missingPseudoWrites.push(items);
          }
        });
        await expect(missingPseudo.copy(missingPseudoPreview)).resolves.toEqual({
          code: 'wechat-copy-failed',
          status: 'failed'
        });
        const missingPseudoItem = (missingPseudoWrites[0] as ClipboardItemStub[])[0];
        const missingPseudoBlob = missingPseudoItem?.payload['text/html'];
        if (!missingPseudoBlob) throw new Error('missing task pseudo payload');
        await expect(blobText(missingPseudoBlob)).rejects.toThrow('wechat-task-checkbox-static-owner-pseudo-missing');
      } finally {
        Object.defineProperty(Element.prototype, 'insertBefore', { configurable: true, value: originalInsertBefore });
      }
      const legacyHolder = document.createElement('div');
      legacyHolder.innerHTML = legacyHtml;
      expect(legacyHtml).toBe(modernHtml);
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      workspace.remove();
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      }
      if (originalRangeClientRects) {
        Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      } else {
        delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      }
    }
  });

  it('regenerates a warm task payload when the source checked property changes', async () => {
    const writes: unknown[] = [];
    let accentColor = 'rgb(18, 52, 86)';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">Todo</li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Todo' });
    const input = preview.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!input) throw new Error('warm task checkbox missing');
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) =>
        'INPUT' === element.tagName
          ? declaration({
              appearance: 'none',
              'accent-color': accentColor,
              display: 'inline-block',
              height: '12px',
              width: '12px'
            })
          : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    accentColor = 'rgb(101, 67, 33)';
    input.checked = true;
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[1] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('warm task payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
    expect(holder.querySelector('[role="checkbox"]')?.getAttribute('style')).toContain('accent-color:rgb(101, 67, 33)');
  });

  it('rejects a task paint change during async preparation', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/task-freshness.png', document.baseURI).href;
    let accentColor = 'rgb(18, 52, 86)';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">Async task</li></ul><p>Delay image</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Async task\nDelay image' });
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('INPUT' === element.tagName) {
          return declaration({
            'accent-color': accentColor,
            appearance: 'none',
            display: 'inline-block',
            height: '12px',
            width: '12px'
          });
        }
        if ('P' === element.tagName) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            display: 'block'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const preparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    accentColor = 'rgb(101, 67, 33)';
    pendingImage.resolve({
      blob: async () => new Blob(['task freshness'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(preparation).rejects.toThrow('wechat-copy-stale');
  });

  it('fails explicitly when a task checkbox relies on unknown native paint', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked>Native</li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Native' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) =>
        'INPUT' === element.tagName
          ? declaration({ appearance: 'auto', display: 'inline-block', height: '16px', width: '16px' })
          : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async () => undefined
    });

    await expect(clipboard.copy(preview)).resolves.toMatchObject({ code: 'wechat-copy-failed', status: 'failed' });
  });

  it('keeps a loose task paragraph owner and its following text inline', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><p><input class="easymde-task-checkbox" type="checkbox" checked>Loose</p></li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Loose' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) =>
        'INPUT' === element.tagName
          ? declaration({ display: 'inline-block', height: '12px', width: '12px' })
          : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('loose task payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const owner = holder.querySelector('[role="checkbox"]');
    expect(owner?.parentElement?.tagName).toBe('P');
    expect(owner?.parentElement?.querySelectorAll('span[leaf]')).toHaveLength(0);
    expect(owner?.nextSibling).toBeInstanceOf(HTMLSpanElement);
    expect((owner?.nextSibling as Element | null)?.hasAttribute('leaf')).toBe(false);
    expect((owner?.nextSibling as Element | null)?.getAttribute('style')).toContain('display: inline');
  });

  it('removes a measured zero-advance task caption prefix in both Clipboard paths', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked> <a href="#"> Caption</a></li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '  Caption' });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 112, height: 12, left: 100, right: 112, top: 100, width: 12, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('article, ul.task-list')) {
          return { bottom: 140, height: 40, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 30, left: 100, right: 400, top: 100, width: 300, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('span[inert]')) {
          const parent = this.parentElement;
          const children = parent ? [...parent.children] : [];
          const index = children.indexOf(this);
          const left = 100 + Math.max(0, index) * 12;
          return { bottom: 112, height: 0, left, right: left, top: 112, width: 0, x: left, y: 112 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: function (this: Range): DOMRect[] {
        const value =
          this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? this.startContainer.nodeValue ?? '';
        const width = value.trim() ? 48 : 0;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
          if ('INPUT' === element.tagName) {
            return declaration({
              appearance: 'none',
              display: 'block',
              height: '12px',
              position: 'absolute',
              width: '12px',
              'white-space': 'normal'
            });
          }
          if ('A' === element.tagName) return declaration({ display: 'inline', 'white-space': 'nowrap' });
          if ('ARTICLE' === element.tagName) {
            return declaration({
              'border-bottom-width': '0px',
              'border-left-width': '0px',
              'border-right-width': '0px',
              'border-top-width': '0px',
              'box-sizing': 'content-box',
              display: 'block',
              'padding-bottom': '0px',
              'padding-left': '0px',
              'padding-right': '0px',
              'padding-top': '0px',
              'white-space': 'normal'
            });
          }
          if ('UL' === element.tagName || 'LI' === element.tagName) {
            return declaration({ display: 'block', 'white-space': 'normal' });
          }
          return declaration({ display: 'block', 'white-space': 'normal' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      const initialResult = await clipboard.copy(preview);
      expect(initialResult).toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      const textBlob = item?.payload['text/plain'];
      if (!htmlBlob || !textBlob) throw new Error('caption prefix payload missing');
      const modernHtml = await blobText(htmlBlob);
      const modernHolder = document.createElement('div');
      modernHolder.innerHTML = modernHtml;
      expect(modernHolder.querySelector('a')?.textContent).toBe('Caption');
      expect(modernHtml).not.toContain('></span> <strong>');
      await expect(blobText(textBlob)).resolves.toBe('  Caption');

      let legacyHtml = '';
      const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => {
          legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
          return true;
        })
      });
      try {
        const legacy = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle: (element, pseudoElement) => {
            if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
            if ('INPUT' === element.tagName) {
              return declaration({
                appearance: 'none',
                display: 'block',
                height: '12px',
                position: 'absolute',
                width: '12px',
                'white-space': 'normal'
              });
            }
            if ('A' === element.tagName) return declaration({ display: 'inline', 'white-space': 'nowrap' });
            if ('ARTICLE' === element.tagName) {
              return declaration({
                'border-bottom-width': '0px',
                'border-left-width': '0px',
                'border-right-width': '0px',
                'border-top-width': '0px',
                'box-sizing': 'content-box',
                display: 'block',
                'padding-bottom': '0px',
                'padding-left': '0px',
                'padding-right': '0px',
                'padding-top': '0px',
                'white-space': 'normal'
              });
            }
            return declaration({ display: 'block', 'white-space': 'normal' });
          },
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        await prepareClipboard(legacy, preview);
        await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      } finally {
        if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
        else delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
      expect(legacyHtml).toBe(modernHtml);
      expect(preview.innerHTML).toContain('> <a href="#"> Caption</a>');
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    }
  });

  it('stops absolute task projection before Stage B is approved', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked>Absolute</li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Absolute' });
    const input = preview.querySelector('input');
    const item = preview.querySelector('li');
    if (!input || !item) throw new Error('absolute task fixture missing');
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 119, height: 20, left: 78, right: 98, top: 99, width: 20, x: 78, y: 99 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 30, left: 100, right: 400, top: 100, width: 300, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('span[inert]')) {
          const parent = this.parentElement;
          const children = parent ? [...parent.children] : [];
          const index = children.indexOf(this);
          const left = 0 === index ? 100 : 120;
          return { bottom: 120, height: 0, left, right: left, top: 120, width: 0, x: left, y: 120 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('INPUT' === element.tagName && '::before' === pseudoElement) {
            return declaration({
              content: '""',
              display: 'block',
              height: '18px',
              left: '18px',
              position: 'absolute',
              top: '-2px',
              width: '18px'
            });
          }
          if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
          if ('INPUT' === element.tagName)
            return declaration({
              appearance: 'none',
              display: 'block',
              height: '20px',
              left: '-22px',
              position: 'absolute',
              top: '3px',
              width: '20px'
            });
          return declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      if (writes.length > 1) {
        const payload = (writes[0] as ClipboardItemStub[])[0]?.payload['text/html'];
        if (!payload) throw new Error('absolute task payload missing');
        const holder = document.createElement('div');
        holder.innerHTML = await blobText(payload);
        const owner = holder.querySelector('[role="checkbox"]');
        const style = owner?.getAttribute('style') ?? '';
        expect(style).not.toMatch(/(?:^|;)position:/);
        expect(style).not.toMatch(/(?:^|;)top:/);
        expect(style).not.toMatch(/(?:^|;)left:/);
        expect(style).not.toMatch(/(?:^|;)right:/);
        expect(style).not.toMatch(/(?:^|;)bottom:/);
        expect(style).toContain('margin-left:-22px!important');
        expect(style).toContain('margin-right:2px!important');
        const pseudoStyle = owner?.querySelector('span[aria-hidden="true"]')?.getAttribute('style') ?? '';
        expect(pseudoStyle).not.toMatch(/(?:^|;)position:/);
        expect(pseudoStyle).not.toMatch(/(?:^|;)left:/);
        expect(pseudoStyle).toContain('margin-left:18px!important');
      }
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    }
  });

  it.each([
    { label: 'non-breaking space', text: '\u00a0Caption', whiteSpace: 'normal' },
    { label: 'wide space', text: '\u3000Caption', whiteSpace: 'normal' },
    { label: 'pre', text: ' Caption', whiteSpace: 'pre' },
    { label: 'pre-wrap', text: ' Caption', whiteSpace: 'pre-wrap' },
    { label: 'pre-line', text: ' Caption', whiteSpace: 'pre-line' },
    { label: 'break-spaces', text: ' Caption', whiteSpace: 'break-spaces' },
    { label: 'interior spaces', text: '  Caption text', whiteSpace: 'normal' },
    { label: 'positive prefix advance', prefixWidth: 4, text: ' Caption', whiteSpace: 'normal' },
    { label: 'relative input', position: 'relative', text: ' Caption', whiteSpace: 'normal' }
  ])('preserves caption whitespace for $label', async ({ position = 'absolute', prefixWidth = 0, text, whiteSpace }) => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = `<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">${text}</li></ul>`;
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: text });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 112, height: 12, left: 100, right: 112, top: 100, width: 12, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('article, ul.task-list')) {
          return { bottom: 140, height: 40, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 30, left: 100, right: 400, top: 100, width: 300, x: 100, y: 100 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: function (this: Range): DOMRect[] {
        const value =
          this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? this.startContainer.nodeValue ?? '';
        const width = value.trim() ? 48 : prefixWidth;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
          if ('INPUT' === element.tagName) {
            return declaration({
              appearance: 'none',
              display: 'block',
              height: '12px',
              position,
              width: '12px',
              'white-space': 'normal'
            });
          }
          if ('ARTICLE' === element.tagName) {
            return declaration({
              'border-bottom-width': '0px',
              'border-left-width': '0px',
              'border-right-width': '0px',
              'border-top-width': '0px',
              'box-sizing': 'content-box',
              display: 'block',
              'padding-bottom': '0px',
              'padding-left': '0px',
              'padding-right': '0px',
              'padding-top': '0px',
              'white-space': 'normal'
            });
          }
          if ('LI' === element.tagName) return declaration({ display: 'block', 'white-space': whiteSpace });
          return declaration({ display: 'block', 'white-space': whiteSpace });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('preserve caption payload missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(htmlBlob);
      expect(holder.textContent).toContain(text.startsWith('  ') ? 'Caption text' : text);
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    }
  });

  it.each(['missing', 'empty', 'nonfinite'] as const)('rejects a caption Range that is %s', async (rangeMode) => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"> Caption</li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: ' Caption' });
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: function (this: Range): DOMRect[] | undefined {
        const prefixRange = this.endOffset - this.startOffset === 1;
        if (prefixRange && 'missing' === rangeMode) return undefined;
        if (prefixRange && 'empty' === rangeMode) return [];
        if (prefixRange && 'nonfinite' === rangeMode) {
          return [
            {
              bottom: 122,
              height: 16,
              left: 112,
              right: Number.NaN,
              top: 102,
              width: Number.NaN,
              x: 112,
              y: 102
            } as DOMRect
          ];
        }
        return [{ bottom: 122, height: 16, left: 112, right: 160, top: 102, width: 48, x: 112, y: 102 } as DOMRect];
      }
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
          if ('INPUT' === element.tagName) {
            return declaration({ appearance: 'none', display: 'block', height: '12px', position: 'absolute', width: '12px' });
          }
          if ('ARTICLE' === element.tagName) {
            return declaration({
              'border-bottom-width': '0px',
              'border-left-width': '0px',
              'border-right-width': '0px',
              'border-top-width': '0px',
              'box-sizing': 'content-box',
              display: 'block',
              'padding-bottom': '0px',
              'padding-left': '0px',
              'padding-right': '0px',
              'padding-top': '0px',
              'white-space': 'normal'
            });
          }
          return declaration({ display: 'block', 'white-space': 'normal' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('caption range failure payload missing');
      await expect(blobText(htmlBlob)).rejects.toThrow('wechat-task-checkbox-caption-range-unavailable');
      expect(preview.innerHTML).toContain('> Caption</li>');
    } finally {
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    }
  });

  it.each([
    'reinsert',
    'replace',
    'move',
    'move-before-owner',
    'insert-earlier',
    'forge-wrapper',
    'reorder-prefix',
    'replace-glyph-no-prefix',
    'swap-owners',
    'late-html',
    'late-original',
    'late-block-wrapper',
    'late-owner-removal'
  ] as const)('rejects a final ordered caption %s fault', async (fault) => {
    const getComputedStyle = captionFaultComputedStyle;
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      ['reorder-prefix', 'replace-glyph-no-prefix'].includes(fault)
        ? '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><span> </span><strong>' +
          ('replace-glyph-no-prefix' === fault ? 'Caption' : ' Caption') +
          '</strong></li></ul>'
        : 'swap-owners' === fault
          ? '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><strong> Caption A</strong></li><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><strong> Caption B</strong></li></ul>'
        : '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><strong> Caption</strong></li></ul>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: ' Caption' });
    const originalSetAttribute = Element.prototype.setAttribute;
    let faultHit = false;
    Object.defineProperty(Element.prototype, 'setAttribute', {
      configurable: true,
      value: function (this: Element, name: string, value: string): void {
        originalSetAttribute.call(this, name, value);
        if (faultHit || 'style' !== name || 'STRONG' !== this.tagName) return;
        if (['swap-owners', 'late-html', 'late-original', 'late-block-wrapper', 'late-owner-removal'].includes(fault)) return;
        const textNode = this.firstChild;
        if (!(textNode instanceof Text)) return;
        faultHit = true;
        if ('reinsert' === fault) textNode.nodeValue = ' Caption';
        else if ('replace' === fault) textNode.replaceWith(this.ownerDocument.createTextNode('Caption'));
        else if ('move' === fault) {
          const list = this.parentElement?.parentElement;
          const movedItem = this.ownerDocument.createElement('li');
          movedItem.className = 'task-list-item';
          list?.append(movedItem);
          movedItem.append(this);
        } else if ('move-before-owner' === fault) {
          const parent = this.parentElement;
          if (parent) parent.insertBefore(this, parent.firstChild);
        } else if ('insert-earlier' === fault) {
          this.parentElement?.insertBefore(this.ownerDocument.createTextNode('Injected'), this);
        } else if ('forge-wrapper' === fault) {
          const wrapper = this.ownerDocument.createElement('span');
          wrapper.append(textNode);
          this.append(wrapper);
        } else if ('replace-glyph-no-prefix' === fault) {
          textNode.replaceWith(this.ownerDocument.createTextNode('Caption'));
        } else {
          const parent = this.parentElement;
          const prefix = parent?.children[1];
          if (prefix) parent?.append(prefix);
        }
      }
    });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    const originalOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 112, height: 12, left: 100, right: 112, top: 100, width: 12, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('article, ul.task-list')) {
          return { bottom: 140, height: 40, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 30, left: 100, right: 400, top: 100, width: 300, x: 100, y: 100 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: function (this: Range): DOMRect[] {
        const value = this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? '';
        const width = value.trim() ? 48 : 0;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
    if (['swap-owners', 'late-html', 'late-block-wrapper', 'late-owner-removal'].includes(fault)) {
      if (!originalOuterHTML?.get) throw new Error('caption late outerHTML getter unavailable');
      Object.defineProperty(Element.prototype, 'outerHTML', {
        configurable: true,
        get: function (this: Element): string {
          if (!faultHit && this.querySelector('strong')) {
            const leaf = this.querySelector('strong span');
            const text = leaf?.firstChild;
            faultHit = true;
            if ('swap-owners' === fault) {
              const firstItem = this.querySelector('li');
              const list = firstItem?.parentElement;
              const items = list
                ? Array.from(list.children).filter((child) => 'LI' === child.tagName)
                : [];
              if (list && items.length === 2 && items[0] && items[1]) list.insertBefore(items[1], items[0]);
            } else if ('late-block-wrapper' === fault) {
              (leaf as HTMLElement | null)?.style.setProperty('display', 'block');
            } else if ('late-owner-removal' === fault) {
              this.querySelector('span[role="checkbox"]')?.remove();
            } else if (text instanceof Text) {
              text.nodeValue = ' Caption';
            }
          }
          return originalOuterHTML.get?.call(this) ?? '';
        }
      });
    }
    if ('late-original' === fault) {
      Object.defineProperty(HTMLElement.prototype, 'innerText', {
        configurable: true,
        get: function (this: HTMLElement): string {
          if (!faultHit && this.querySelector('strong')) {
            const text = this.querySelector('strong span')?.firstChild;
            faultHit = true;
            if (text instanceof Text) text.nodeValue = 'Caption';
          }
          return originalInnerText?.get?.call(this) ?? this.textContent ?? '';
        }
      });
    }
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      const copyResult = await clipboard.copy(preview);
      expect(faultHit).toBe(true);
      expect(copyResult).toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('caption final fault payload missing');
      expect(faultHit).toBe(true);
      await expect(blobText(htmlBlob)).rejects.toThrow(
        ['reinsert', 'late-html'].includes(fault)
          ? 'wechat-task-checkbox-caption-prefix-reinserted'
          : 'late-original' === fault
            ? 'wechat-task-checkbox-caption-plain-text-restore-failed'
            : 'swap-owners' === fault
              ? 'wechat-task-checkbox-caption-owner-order-mismatch'
              : 'late-owner-removal' === fault
                ? 'wechat-task-checkbox-static-owner-count-mismatch'
              : 'wechat-task-checkbox-caption-record-missing'
      );
      faultHit = false;
      const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => true)
      });
      try {
        const legacy = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        await expect(prepareClipboard(legacy, preview)).rejects.toThrow(
          ['reinsert', 'late-html'].includes(fault)
            ? 'wechat-task-checkbox-caption-prefix-reinserted'
            : 'late-original' === fault
              ? 'wechat-task-checkbox-caption-plain-text-restore-failed'
            : 'swap-owners' === fault
              ? 'wechat-task-checkbox-caption-owner-order-mismatch'
              : 'late-owner-removal' === fault
                ? 'wechat-task-checkbox-static-owner-count-mismatch'
              : 'wechat-task-checkbox-caption-record-missing'
        );
        expect(faultHit).toBe(true);
      } finally {
        if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
        else delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      Object.defineProperty(Element.prototype, 'setAttribute', { configurable: true, value: originalSetAttribute });
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      if (originalOuterHTML) Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHTML);
      else delete (Element.prototype as unknown as { outerHTML?: unknown }).outerHTML;
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
    }
  });

  it('keeps registered caption pseudo, theme image, and empty Text projections ordered', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><em class="empty-after"></em><strong> Caption</strong></li></ul>';
    const item = preview.querySelector('li.task-list-item');
    const strong = item?.querySelector('strong');
    if (!item || !strong) throw new Error('caption representation fixture missing');
    item.insertBefore(document.createTextNode(''), strong);
    Object.defineProperty(preview, 'innerText', { configurable: true, value: ' Caption' });
    const imageUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 112, height: 12, left: 100, right: 112, top: 100, width: 12, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('article, ul.task-list, li.task-list-item')) {
          return { bottom: 140, height: 40, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: function (this: Range): DOMRect[] {
        const value = this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? '';
        const width = value.trim() ? 48 : 0;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
      if ('INPUT' === element.tagName) {
        return declaration({ appearance: 'none', display: 'block', height: '12px', position: 'absolute', width: '12px' });
      }
      if ('STRONG' === element.tagName && pseudoElement) {
        return declaration({
          'background-image': `url("${imageUrl}")`,
          content: '"★"',
          display: 'inline',
          position: 'static',
          'white-space': 'normal'
        });
      }
      if ('EM' === element.tagName && pseudoElement) {
        return declaration({ content: '"◇"', display: 'inline', position: 'static', 'white-space': 'normal' });
      }
      if ('STRONG' === element.tagName) return declaration({ display: 'inline', 'white-space': 'normal' });
      if ('EM' === element.tagName) return declaration({ display: 'inline', 'white-space': 'normal' });
      if ('ARTICLE' === element.tagName) {
        return declaration({
          'border-bottom-width': '0px',
          'border-left-width': '0px',
          'border-right-width': '0px',
          'border-top-width': '0px',
          'box-sizing': 'content-box',
          display: 'block',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          'white-space': 'normal'
        });
      }
      return declaration({ display: 'block', 'white-space': 'normal' });
    };
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const htmlBlob = (writes[0] as ClipboardItemStub[])[0]?.payload['text/html'];
      if (!htmlBlob) throw new Error('caption representation payload missing');
      const html = await blobText(htmlBlob);
      expect(html).toMatch(/^<section\b/u);
      expect(html).toContain('◇');
      expect(html).toContain('★');
      expect(html).toContain(imageUrl);
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    }
  });

  it('rejects a queued caption prefix mutation after the HTML yield', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    let clock = 0;
    let htmlCaptured = false;
    let faultHit = false;
    let capturedClone: HTMLElement | null = null;
    let sourcePreview: HTMLElement | null = null;
    let workspace: HTMLDivElement | null = null;
    const realDateNow = Date.now.bind(Date);
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => realDateNow() + clock);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(( (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = Number(timeout ?? 0);
      if (0 === delay && htmlCaptured && !faultHit) {
        faultHit = true;
        return originalSetTimeout(() => {
          const text = capturedClone?.querySelector('strong span')?.firstChild;
          if (text instanceof Text) text.nodeValue = ' Caption';
          if ('function' === typeof handler) handler(...args);
        }, 0) as unknown as number;
      }
      return originalSetTimeout(handler, timeout, ...args) as unknown as number;
    }) as typeof window.setTimeout);
    Object.defineProperty(Element.prototype, 'outerHTML', {
      configurable: true,
      get(this: Element): string {
        const html = originalOuterHTML?.get?.call(this) ?? '';
        if (!htmlCaptured && this !== sourcePreview && this.querySelector('strong')) {
          capturedClone = this as HTMLElement;
          htmlCaptured = true;
          clock = 20;
        }
        return html;
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('.queued-caption-workspace')) {
          return { bottom: 160, height: 160, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 112, height: 12, left: 100, right: 112, top: 100, width: 12, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('article, ul.task-list')) {
          return { bottom: 140, height: 40, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 30, left: 100, right: 400, top: 100, width: 300, x: 100, y: 100 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: function (this: Range): DOMRect[] {
        const value =
          this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? this.startContainer.nodeValue ?? '';
        const width = value.trim() ? 48 : 0;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
    try {
      const preview = document.createElement('article');
      sourcePreview = preview;
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML =
        '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><strong> Caption</strong></li></ul>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: ' Caption' });
      workspace = document.createElement('div');
      workspace.className = 'queued-caption-workspace';
      workspace.append(preview);
      document.body.append(workspace);
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: captionFaultComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      await expect(prepareClipboard(clipboard, preview, { background: true })).rejects.toThrow(
        'wechat-task-checkbox-caption-prefix-reinserted'
      );
      expect(htmlCaptured).toBe(true);
      expect(faultHit).toBe(true);
    } finally {
      workspace?.remove();
      if (originalOuterHTML) Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHTML);
      else delete (Element.prototype as unknown as { outerHTML?: unknown }).outerHTML;
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      setTimeout.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('rejects a theme image moved across ordered caption owners', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><strong> Caption A</strong></li><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><strong> Caption B</strong></li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: ' Caption A\n Caption B' });
    const imageUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    const originalOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    let faultHit = false;
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 112, height: 12, left: 100, right: 112, top: 100, width: 12, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('article, ul.task-list, li.task-list-item')) {
          return { bottom: 140, height: 40, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: function (this: Range): DOMRect[] {
        const value = this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? '';
        const width = value.trim() ? 48 : 0;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
    Object.defineProperty(Element.prototype, 'outerHTML', {
      configurable: true,
      get(this: Element): string {
        if (!faultHit && 'SECTION' === this.tagName) {
          const [firstStrong, secondStrong] = Array.from(this.querySelectorAll('strong'));
          const image = firstStrong?.querySelector('img');
          const secondMarker = secondStrong?.querySelector('span[aria-hidden="true"]');
          if (image && secondMarker) {
            secondMarker.append(image);
            faultHit = true;
          }
        }
        return originalOuterHTML?.get?.call(this) ?? '';
      }
    });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
      if ('INPUT' === element.tagName) {
        return declaration({ appearance: 'none', display: 'block', height: '12px', position: 'absolute', width: '12px' });
      }
      if ('STRONG' === element.tagName && pseudoElement) {
        return declaration({
          'background-image': `url("${imageUrl}")`,
          content: '"★"',
          display: 'inline',
          position: 'static',
          'white-space': 'normal'
        });
      }
      if ('STRONG' === element.tagName) return declaration({ display: 'inline', 'white-space': 'normal' });
      if ('ARTICLE' === element.tagName) {
        return declaration({
          'border-bottom-width': '0px',
          'border-left-width': '0px',
          'border-right-width': '0px',
          'border-top-width': '0px',
          'box-sizing': 'content-box',
          display: 'block',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          'white-space': 'normal'
        });
      }
      return declaration({ display: 'block', 'white-space': 'normal' });
    };
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(faultHit).toBe(true);
      const htmlBlob = (writes[0] as ClipboardItemStub[])[0]?.payload['text/html'];
      if (!htmlBlob) throw new Error('caption cross-owner payload missing');
      await expect(blobText(htmlBlob)).rejects.toThrow('wechat-task-checkbox-caption-record-missing');

      faultHit = false;
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await expect(prepareClipboard(legacy, preview)).rejects.toThrow('wechat-task-checkbox-caption-record-missing');
      expect(faultHit).toBe(true);
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      if (originalOuterHTML) Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHTML);
      else delete (Element.prototype as unknown as { outerHTML?: unknown }).outerHTML;
    }
  });

  it('rejects moving the whole caption P and owner across list items in both Clipboard paths', async () => {
    const getComputedStyle = captionFaultComputedStyle;
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><p><input class="easymde-task-checkbox" type="checkbox"> <strong> Caption</strong></p></li></ul>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: ' Caption' });
    const originalSetAttribute = Element.prototype.setAttribute;
    let faultHit = false;
    Object.defineProperty(Element.prototype, 'setAttribute', {
      configurable: true,
      value: function (this: Element, name: string, value: string): void {
        originalSetAttribute.call(this, name, value);
        if (faultHit || 'style' !== name || 'STRONG' !== this.tagName) return;
        const paragraph = this.parentElement;
        const list = paragraph?.parentElement?.parentElement;
        if (!paragraph || !list) return;
        faultHit = true;
        const movedItem = this.ownerDocument.createElement('li');
        movedItem.className = 'task-list-item';
        list.append(movedItem);
        movedItem.append(paragraph);
      }
    });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 112, height: 12, left: 100, right: 112, top: 100, width: 12, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('article, ul.task-list')) {
          return { bottom: 140, height: 40, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        if (this.matches('li.task-list-item, p')) {
          return { bottom: 130, height: 30, left: 100, right: 400, top: 100, width: 300, x: 100, y: 100 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: function (this: Range): DOMRect[] {
        const value = this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? '';
        const width = value.trim() ? 48 : 0;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('caption parent fault payload missing');
      await expect(blobText(htmlBlob)).rejects.toThrow('wechat-task-checkbox-caption-record-missing');
      expect(faultHit).toBe(true);

      faultHit = false;
      const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => true)
      });
      try {
        const legacy = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        await expect(prepareClipboard(legacy, preview)).rejects.toThrow(
          'wechat-task-checkbox-caption-record-missing'
        );
        expect(faultHit).toBe(true);
      } finally {
        if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
        else delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      Object.defineProperty(Element.prototype, 'setAttribute', { configurable: true, value: originalSetAttribute });
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    }
  });

  it('stops RTL task projection before Stage B is approved', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list" dir="rtl"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">RTL</li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'RTL' });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 116, height: 16, left: 82, right: 98, top: 100, width: 16, x: 82, y: 100 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 40, left: 100, right: 400, top: 90, width: 300, x: 100, y: 90 } as DOMRect;
        }
        if (this.matches('span[inert]')) {
          const parent = this.parentElement;
          const children = parent ? [...parent.children] : [];
          const index = children.indexOf(this);
          const right = 0 === index ? 400 : 384;
          return { bottom: 116, height: 0, left: right, right, top: 116, width: 0, x: right, y: 116 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('INPUT' === element.tagName && '::before' === pseudoElement) {
        return declaration({
          content: '""',
          display: 'block',
          height: '16px',
          position: 'absolute',
          right: '-4px',
          width: '16px'
        });
      }
      if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
      if ('INPUT' === element.tagName) {
        return declaration({
          appearance: 'none',
          display: 'inline-block',
          height: '16px',
          position: 'absolute',
          width: '16px'
        });
      }
      return declaration({ direction: element.closest('[dir="rtl"]') ? 'rtl' : 'ltr', display: 'block' });
    };
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      if (writes.length > 1) {
        const item = (writes[0] as ClipboardItemStub[])[0];
        const htmlBlob = item?.payload['text/html'];
        if (!htmlBlob) throw new Error('RTL task payload missing');
        const holder = document.createElement('div');
        holder.innerHTML = await blobText(htmlBlob);
        const owner = holder.querySelector('[role="checkbox"]');
        const style = owner?.getAttribute('style') ?? '';
        expect(style).toContain('margin-right:302px!important');
        expect(style).toContain('margin-left:-318px!important');
        expect(style).not.toMatch(/(?:^|;)position:/);
        expect(owner?.querySelector('span[aria-hidden="true"]')?.getAttribute('style')).toContain(
          'margin-left:4px!important'
        );
      }
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      }
    }
  });

  it('verifies final task SVG owner faults after a passing owner', async () => {
    const svgPath = 'M14.83 4.89l1.34.94-5.81 8.38H9.02L5.78 9.67l1.34-1.25 2.57 2.4z';
    const svgContent = `url("data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="${svgPath}" fill="#3582c4"/></svg>`
    )}") / ''`;
    type Variant = 'positive' | 'drop-svg' | 'empty-path' | 'remove-paint';
    const cases: ReadonlyArray<Readonly<{ expectedError?: string; variant: Variant }>> = [
      { variant: 'positive' },
      { expectedError: 'wechat-task-checkbox-static-owner-svg-paint-missing', variant: 'drop-svg' },
      { expectedError: 'wechat-task-checkbox-static-owner-svg-paint-missing', variant: 'empty-path' },
      { expectedError: 'wechat-task-checkbox-static-owner-svg-paint-missing', variant: 'remove-paint' }
    ];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const createPreview = (): Readonly<{ preview: HTMLElement; workspace: HTMLElement }> => {
      const workspace = document.createElement('div');
      workspace.className = 'svg-owner-workspace';
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML =
        '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked>SVG check</li></ul>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'SVG check' });
      workspace.append(preview);
      document.body.append(workspace);
      return { preview, workspace };
    };
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('INPUT' === element.tagName && '::before' === pseudoElement) {
        return declaration({
          content: svgContent,
          display: 'block',
          height: '16px',
          position: 'relative',
          width: '16px'
        });
      }
      if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
      if ('INPUT' === element.tagName) {
        return declaration({
          appearance: 'none',
          display: 'inline-block',
          height: '16px',
          position: 'absolute',
          width: '16px'
        });
      }
      if ('ARTICLE' === element.tagName && element.closest('.svg-owner-workspace')) {
        return declaration({
          'border-bottom-width': '0px',
          'border-left-width': '0px',
          'border-right-width': '0px',
          'border-top-width': '0px',
          'box-sizing': 'content-box',
          display: 'block',
          'font-family': 'sans-serif',
          'font-size': '16px',
          'font-weight': '400',
          'letter-spacing': 'normal',
          'line-height': 'normal',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          'word-spacing': 'normal'
        });
      }
      return declaration({ display: 'block' });
    };
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    const originalImage = window.Image;
    const originalCanvasContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('.svg-owner-workspace')) {
          return { bottom: 160, height: 160, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        if (
          this.closest('.svg-owner-workspace') &&
          ('ARTICLE' === this.tagName || ('UL' === this.tagName && this.classList.contains('task-list')))
        ) {
          return { bottom: 120, height: 120, left: 0, right: 300, top: 0, width: 300, x: 0, y: 0 } as DOMRect;
        }
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 116, height: 16, left: 100, right: 116, top: 100, width: 16, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 40, left: 100, right: 400, top: 90, width: 300, x: 100, y: 90 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: (): DOMRect[] => [
        { bottom: 118, height: 16, left: 116, right: 172, top: 102, width: 56, x: 116, y: 102 } as DOMRect
      ]
    });
    class ImageStub {
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      decode(): Promise<void> {
        return Promise.resolve();
      }
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    Object.defineProperty(window, 'Image', { configurable: true, value: ImageStub });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: function (this: HTMLCanvasElement): CanvasRenderingContext2D {
        return {
          clearRect: vi.fn(),
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }))
        } as unknown as CanvasRenderingContext2D;
      }
    });
    try {
      for (const { expectedError, variant } of cases) {
        const { preview, workspace } = createPreview();
        const writes: unknown[] = [];
        const originalAppendChild = Node.prototype.appendChild;
        let faultHit = false;
        if (variant !== 'positive') {
          Object.defineProperty(Node.prototype, 'appendChild', {
            configurable: true,
            value: function (this: Node, node: Node): Node {
              if (this instanceof Element && this.matches('span[aria-hidden="true"]') && node instanceof SVGElement) {
                faultHit = true;
                const path = node.querySelector('path');
                if ('drop-svg' === variant) return node;
                if ('empty-path' === variant) path?.setAttribute('d', '');
                if ('remove-paint' === variant) path?.setAttribute('fill', 'none');
              }
              return originalAppendChild.call(this, node);
            }
          });
        }
        try {
          const clipboard = createBrowserWechatClipboard({
            blob: Blob,
            clipboardItem: ClipboardItemStub,
            document,
            getComputedStyle,
            getSelection: window.getSelection.bind(window),
            pageOffset: () => ({ x: 0, y: 0 }),
            scrollTo: vi.fn(),
            write: async (items) => {
              writes.push(items);
            }
          });
          const result = await clipboard.copy(preview);
          if ('positive' === variant) {
            expect(result).toEqual({ method: 'clipboard', status: 'copied' });
            const item = (writes[0] as ClipboardItemStub[])[0];
            const htmlBlob = item?.payload['text/html'];
            if (!htmlBlob) throw new Error('positive SVG owner payload missing');
            const holder = document.createElement('div');
            holder.innerHTML = await blobText(htmlBlob);
            expect(holder.querySelector('[role="checkbox"] svg path')?.getAttribute('d')).toBe(svgPath);
          } else {
            expect(result).toEqual({ code: 'wechat-copy-failed', status: 'failed' });
            expect(faultHit).toBe(true);
            if (!expectedError) throw new Error('SVG fault expectation missing');
            const item = (writes[0] as ClipboardItemStub[])[0];
            const htmlBlob = item?.payload['text/html'];
            if (!htmlBlob) throw new Error('fault SVG owner payload missing');
            await expect(blobText(htmlBlob)).rejects.toThrow(expectedError);
          }
        } finally {
          Object.defineProperty(Node.prototype, 'appendChild', { configurable: true, value: originalAppendChild });
          workspace.remove();
        }
      }
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      Object.defineProperty(window, 'Image', { configurable: true, value: originalImage });
      if (originalCanvasContext)
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', originalCanvasContext);
      else delete (HTMLCanvasElement.prototype as unknown as { getContext?: unknown }).getContext;
    }
  });

  it('makes formula blocks horizontal-only scroll owners with automatic height', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord">long formula</span></span></span></span></span></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'long formula' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            height: '88px',
            'max-height': '120px',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            'text-align': 'left'
          });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          return declaration({ display: 'inline', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const formulaStyle =
      [...holder.querySelectorAll('section')]
        .filter((element) => element.textContent?.includes('long formula'))
        .at(-1)
        ?.getAttribute('style') ?? '';
    const formulaLayoutStyle = holder.querySelector('section > span')?.getAttribute('style') ?? '';
    const formulaVisualStyle = holder.querySelector('section > span > nobr > span')?.getAttribute('style') ?? '';
    expect(holder.querySelector('nobr')?.getAttribute('style')).toContain('display:block!important');
    expect(formulaLayoutStyle).toContain('inline-size:100%!important');
    expect(formulaLayoutStyle).toContain('max-inline-size:100%!important');
    expect(formulaLayoutStyle).toContain('width:auto!important');
    expect(formulaLayoutStyle).toContain('box-sizing:border-box!important');
    expect(formulaLayoutStyle).toContain('text-align:center!important');
    expect(formulaVisualStyle).toContain('inline-size:100%!important');
    expect(formulaVisualStyle).toContain('max-inline-size:100%!important');
    expect(formulaVisualStyle).toContain('width:auto!important');
    expect(formulaVisualStyle).toContain('box-sizing:border-box!important');
    expect(formulaVisualStyle).toContain('text-align:center!important');
    expect(formulaStyle).toContain('overflow-x:auto!important');
    expect(formulaStyle).toContain('overflow-y:hidden!important');
    expect(formulaStyle).toContain('height:auto!important');
    expect(formulaStyle).toContain('max-height:none!important');
    expect(formulaStyle).toContain('inline-size:100%!important');
    expect(formulaStyle).toContain('max-inline-size:100%!important');
    expect(formulaStyle).toContain('margin-left:auto!important');
    expect(formulaStyle).toContain('margin-right:auto!important');
    expect(formulaStyle).toContain('text-align:center!important');
  });

  it('preserves KaTeX SVG geometry while normalizing non-math SVG media', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord"><span class="sqrt"><svg width="400em" height="2.48em"></svg><span class="sqrt-line"></span></span></span></span></span></span></span></div>',
      '<svg id="diagram" width="100" height="40"></svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'sqrt formula' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', overflow: 'auto', 'overflow-x': 'auto', 'overflow-y': 'auto' });
        }
        if ('svg' === element.tagName.toLowerCase()) {
          return element.closest('.katex')
            ? declaration({
                display: 'block',
                position: 'absolute',
                width: '175px',
                height: '45px',
                overflow: 'hidden'
              })
            : declaration({ display: 'inline-block', width: '100px', height: '40px' });
        }
        if (element.closest('.katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const katexSvgStyle = holder.querySelector('nobr svg')?.getAttribute('style') ?? '';
    const diagramStyle = holder.querySelector('svg#diagram')?.getAttribute('style') ?? '';
    expect(katexSvgStyle).toContain('height:45px');
    expect(katexSvgStyle).not.toContain('height:auto');
    expect(diagramStyle).toContain('height:auto');
    expect(diagramStyle).toContain('max-width:100%');
  });

  it('keeps complete Mermaid HTML labels visible in modern and legacy payloads', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<div class="easymde-mermaid">',
      '<svg width="220" height="360" viewBox="0 0 220 360">',
      '<foreignObject width="64" height="22" x="78" y="0"><div xmlns="http://www.w3.org/1999/xhtml"><span>用户请求</span></div></foreignObject>',
      '<foreignObject width="101.875" height="22" x="59" y="70"><div xmlns="http://www.w3.org/1999/xhtml"><span>是否命中缓存?</span></div></foreignObject>',
      '<foreignObject width="96" height="22" x="62" y="140"><div xmlns="http://www.w3.org/1999/xhtml"><span>返回缓存结果</span></div></foreignObject>',
      '<foreignObject width="72" height="22" x="74" y="210"><div xmlns="http://www.w3.org/1999/xhtml"><span>调用 API</span></div></foreignObject>',
      '</svg></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: '用户请求\n是否命中缓存?\n返回缓存结果\n调用 API'
    });

    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const runtime = {
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element: Element, pseudoElement?: string) => {
        if (pseudoElement) return declaration({});
        if ('svg' === element.localName) {
          return declaration({
            display: 'block',
            width: '220px',
            height: '360px',
            overflow: 'hidden',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden'
          });
        }
        if ('foreignobject' === element.localName) {
          return declaration({
            display: 'block',
            width: element.getAttribute('width') ?? '64px',
            height: '22px',
            overflow: 'hidden',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden'
          });
        }
        if ('div' === element.localName || 'span' === element.localName) {
          return declaration({ display: 'block', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items: unknown[]) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    };

    const modern = createBrowserWechatClipboard(runtime);
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernBlob = modernItem?.payload['text/html'];
    if (!modernBlob) throw new Error('modern clipboard html missing');
    const modernHtml = await blobText(modernBlob);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    expect(modernHolder.querySelectorAll('svg foreignObject')).toHaveLength(4);
    expect(modernHolder.querySelector('svg')?.getAttribute('style')).toContain('overflow:visible!important');
    expect(
      [...modernHolder.querySelectorAll('foreignObject')].every((element) => {
        const style = element.getAttribute('style') ?? '';
        return (
          style.includes('overflow:visible!important') &&
          style.includes('overflow-x:visible!important') &&
          style.includes('overflow-y:visible!important') &&
          style.includes('min-width:max-content!important') &&
          style.includes('max-width:none!important') &&
          style.includes('white-space:nowrap!important') &&
          style.includes('word-break:normal!important') &&
          style.includes('overflow-wrap:normal!important')
        );
      })
    ).toBe(true);
    const originalGeometry = [
      { width: 64, x: 78 },
      { width: 101.875, x: 59 },
      { width: 96, x: 62 },
      { width: 72, x: 74 }
    ];
    [...modernHolder.querySelectorAll('foreignObject')].forEach((element, index) => {
      const original = originalGeometry[index];
      if (!original) {
        throw new Error(`Missing Mermaid geometry fixture at index ${index}.`);
      }
      const width = Number.parseFloat(element.getAttribute('width') ?? '');
      const x = Number.parseFloat(element.getAttribute('x') ?? '');
      expect(width).toBeGreaterThanOrEqual(original.width * 1.5);
      expect(x + width / 2).toBeCloseTo(original.x + original.width / 2, 5);
      expect(element.firstElementChild?.getAttribute('style')).toContain('width:max-content!important');
    });
    expect(
      [...modernHolder.querySelectorAll('foreignObject')].every((element) => {
        const label = element.querySelector('nobr');
        return label?.textContent === element.textContent;
      })
    ).toBe(true);
    const visualText = modernHolder.textContent?.replaceAll('\u2060', '') ?? '';
    for (const label of ['用户请求', '是否命中缓存?', '返回缓存结果', '调用 API']) {
      expect(visualText).toContain(label);
    }
    expect(modernHtml).toContain('\u2060');

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacy = createBrowserWechatClipboard({ ...runtime, clipboardItem: null, write: null });
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    expect(legacyHtml).toBe(modernHtml);
  });

  it('keeps referenced anchors, SVG paint, supported math layout, and safe image URLs', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p><a href="#math-target">Jump to math</a></p>',
      '<h3 id="math-target">Formula</h3>',
      '<div class="katex"><span class="katex-mathml"><math><annotation>x + y</annotation></math></span><span class="katex-html"><span class="vlist-t"><span class="vlist-r"><span class="vlist"><span class="pstrut"></span>x + y</span></span></span></span></div>',
      '<svg id="diagram" viewBox="0 0 20 20"><defs><linearGradient id="gradient"><stop offset="0" stop-color="#fff"></stop></linearGradient><marker id="arrowhead"><path d="M0 0l4 2-4 2z"></path></marker></defs><path id="path" fill="url(#gradient)" marker-end="url(#arrowhead)" d="M0 0h20v20H0z"></path></svg>',
      '<p id="discard-me"><img src="data:image/png;base64,AAAA" srcset="data:image/png;base64,AAAA 1x, javascript:bad 2x, https://example.test/image.png 2x" alt="inline image"></p>'
    ].join('');
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('katex')) {
          return declaration({ display: 'inline', position: 'fixed', width: 'min-content' });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          if (element.classList.contains('vlist-t')) {
            return declaration({ display: 'inline-table', position: 'static', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('vlist-r')) {
            return declaration({ display: 'table-row', position: 'static', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('vlist')) {
            return declaration({ display: 'table-cell', position: 'relative', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('pstrut')) {
            return declaration({ display: 'inline-block', width: '0px', height: '45.7344px', 'white-space': 'nowrap' });
          }
          return declaration({
            display: 'inline',
            position: 'relative',
            height: '1.2em',
            transform: 'translateY(1px)'
          });
        }
        if ('path' === element.tagName.toLowerCase()) {
          return declaration({
            display: 'inline',
            fill: 'url(#gradient)',
            stroke: 'none',
            'marker-end': 'url("#arrowhead")'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    if (!textBlob) throw new Error('clipboard text missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const text = await blobText(textBlob);
    expect(holder.querySelector('a[href="#math-target"]')).not.toBeNull();
    expect(holder.querySelector('#math-target')).not.toBeNull();
    expect(holder.querySelector('#discard-me')).toBeNull();
    expect(holder.querySelector('svg#diagram')).not.toBeNull();
    expect(holder.querySelector('svg #gradient')).not.toBeNull();
    expect(holder.querySelector('svg #arrowhead')).not.toBeNull();
    expect(holder.querySelector('svg #path')?.getAttribute('style')).toContain('fill:url(#gradient)');
    expect(holder.querySelector('svg #path')?.getAttribute('style')).toContain('marker-end:url("#arrowhead")');
    expect(holder.querySelector('.katex')).toBeNull();
    expect(holder.querySelector('math')).toBeNull();
    expect(holder.querySelector('nobr')).not.toBeNull();
    expect(holder.querySelector('nobr')?.getAttribute('style')).toContain('display:inline-block!important');
    expect(holder.querySelector('span[style*="display:inline-table"]')).not.toBeNull();
    expect(holder.querySelector('span[style*="height:45.7344px"]')?.textContent).toContain('\u2060');
    expect([...holder.querySelectorAll('section span')].some((element) => element.textContent?.includes('x + y'))).toBe(
      true
    );
    const visualFormulaNodes = [...holder.querySelectorAll('section span')].filter((element) =>
      element.textContent?.includes('x + y')
    );
    expect(
      visualFormulaNodes.some((element) => {
        const style = element.getAttribute('style') ?? '';
        return (
          style.includes('white-space:nowrap!important') &&
          style.includes('word-break:normal!important') &&
          style.includes('overflow-wrap:normal!important') &&
          style.includes('max-width:none!important')
        );
      })
    ).toBe(true);
    expect(text.match(/x \+ y/g)).toHaveLength(1);
    expect(holder.querySelector('section[style*="position:fixed"]')).toBeNull();
    expect(holder.querySelector('section span[style*="position:relative"]')).not.toBeNull();
    expect(holder.querySelector('img[src="data:image/png;base64,AAAA"]')).not.toBeNull();
    expect(holder.querySelector('img[srcset*="javascript:"]')).toBeNull();
    expect(holder.querySelector('img[srcset*="https://example.test/image.png"]')).not.toBeNull();
  });

  it('materializes Mdmdt link pseudo paint in modern and synchronous Clipboard payloads', async () => {
    const writes: unknown[] = [];
    const fetch = vi.fn();
    const pngDataUrl = mdmdtNormalPngDataUrl();
    const sourceText = 'Visible link\n1\nFootnote body';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p><a href="https://example.test/link">Visible link</a></p>',
      '<p><sup><a href="#fn1">1</a></sup></p>',
      '<section class="footnotes"><p id="fn1">Footnote body</p></section>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('::before' === pseudoElement && 'A' === element.tagName && '#fn1' === element.getAttribute('href')) {
        return declaration({ content: '""', display: 'none' });
      }
      if (
        '::before' === pseudoElement &&
        'A' === element.tagName &&
        'https://example.test/link' === element.getAttribute('href')
      ) {
        return declaration({
          background: `url("${pngDataUrl}")`,
          'background-image': `url("${pngDataUrl}")`,
          'background-position': 'center',
          'background-repeat': 'no-repeat',
          'background-size': '100%',
          content: '""',
          display: 'inline-block',
          height: '14px',
          position: 'relative',
          width: '14px'
        });
      }
      if ('::after' === pseudoElement) return declaration({ content: 'none' });
      if (pseudoElement) return declaration({ content: 'none' });
      return declaration({ display: 'block' });
    };
    const createClipboard = (
      clipboardItem: ClipboardItemConstructor | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        fetch,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modern = createClipboard(ClipboardItemStub, async (items) => {
      writes.push(items);
    });

    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('Mdmdt pseudo payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    const modernText = await blobText(modernTextBlob);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const link = modernHolder.querySelector('a[href="https://example.test/link"]');
    expect(link).not.toBeNull();
    const modernMarker = link?.querySelector('span[aria-hidden="true"]');
    expect(modernMarker?.querySelector('img[src^="data:image/png;base64,"]')).not.toBeNull();
    expect(modernMarker?.textContent).toBe('');
    expect(link?.querySelector('span[aria-hidden="true"] img[src^="data:image/svg+xml"]')).toBeNull();
    expect(modernHolder.querySelector('a[href="#fn1"] > span[aria-hidden="true"]')).toBeNull();
    expect(modernText).toBe(sourceText);
    expect(fetch).not.toHaveBeenCalled();

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    class ThrowingClipboardItem {
      constructor(_payload: Record<string, Blob>) {
        throw new Error('synchronous-clipboard-item-failure');
      }
    }
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createClipboard(
        ThrowingClipboardItem,
        vi.fn(async () => undefined)
      );
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      const legacyHolder = document.createElement('div');
      legacyHolder.innerHTML = legacyHtml;
      const legacyLink = legacyHolder.querySelector('a[href="https://example.test/link"]');
      expect(legacyLink).not.toBeNull();
      const legacyMarker = legacyLink?.querySelector('span[aria-hidden="true"]');
      expect(legacyMarker?.querySelector('img[src^="data:image/png;base64,"]')).not.toBeNull();
      expect(legacyMarker?.textContent).toBe('');
      expect(legacyLink?.textContent).toContain('Visible link');
      expect(legacyHolder.textContent).toContain('Footnote body');
      expect(legacyHolder.querySelector('a[href="#fn1"] > span[aria-hidden="true"]')).toBeNull();
      expect(legacyHtml).not.toContain('data:image/svg+xml');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('keeps pseudo carriers alive without duplicating or leaking unsafe image layers', async () => {
    const writes: unknown[] = [];
    const fetch = vi.fn();
    const pngDataUrl = mdmdtNormalPngDataUrl();
    const svgDataUrl = 'data:image/svg+xml;base64,PHN2Zy8+';
    const unknownImageUrl = 'https://unknown.example.test/pseudo.png';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p id="safe">Safe</p>',
      '<p id="repeat">Repeat</p>',
      '<p id="repeat-x">Repeat X</p>',
      '<p id="gradient">Gradient</p>',
      '<p id="color">Color</p>',
      '<p id="shadow">Shadow</p>',
      '<p id="text">Text</p>',
      '<p id="svg">SVG</p>',
      '<p id="unknown">Unknown</p>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Safe\nRepeat\nRepeat X\nGradient\nColor\nShadow\nText\nSVG\nUnknown'
    });
    const pseudoStyle = (id: string): Record<string, string> => {
      const base = { content: '""', display: 'inline-block', height: '14px', width: '14px' };
      if ('safe' === id) {
        return {
          ...base,
          'background-image': `url("${pngDataUrl}")`,
          'background-position': 'center',
          'background-repeat': 'no-repeat',
          'background-size': '100%'
        };
      }
      if ('repeat' === id || 'repeat-x' === id) {
        const repeat = 'repeat-x' === id ? 'repeat-x' : 'repeat';
        return {
          ...base,
          background: `transparent url("${pngDataUrl}") ${repeat} 0 0`,
          'background-image': `url("${pngDataUrl}")`,
          'background-repeat': repeat
        };
      }
      if ('gradient' === id) {
        return { ...base, 'background-image': 'linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))' };
      }
      if ('color' === id) return { ...base, 'background-color': 'rgb(7, 8, 9)' };
      if ('shadow' === id) return { ...base, 'box-shadow': 'rgb(10, 11, 12) 0 1px 2px' };
      if ('text' === id) return { ...base, content: '"Caption"' };
      if ('svg' === id) return { ...base, 'background-image': `url("${svgDataUrl}")` };
      return { ...base, 'background-image': `url("${unknownImageUrl}")` };
    };
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('::before' === pseudoElement && element instanceof HTMLElement) {
        return declaration(pseudoStyle(element.id));
      }
      if (pseudoElement) return declaration({ content: 'none' });
      return declaration({ display: 'block' });
    };
    const createClipboard = (
      clipboardItem: ClipboardItemConstructor | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        fetch,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const modern = createClipboard(ClipboardItemStub, async (items) => {
      writes.push(items);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    if (!modernHtmlBlob) throw new Error('pseudo carrier modern payload missing');
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = await blobText(modernHtmlBlob);

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    class ThrowingClipboardItem {
      constructor(_payload: Record<string, Blob>) {
        throw new Error('forced-synchronous-pseudo-carrier');
      }
    }
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createClipboard(
        ThrowingClipboardItem,
        vi.fn(async () => undefined)
      );
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      const legacyHolder = document.createElement('div');
      legacyHolder.innerHTML = legacyHtml;
      for (const holder of [modernHolder, legacyHolder]) {
        const marker = (index: number): Element | null =>
          holder.querySelectorAll('p')[index]?.querySelector(':scope > span[aria-hidden="true"]') ?? null;
        const safe = marker(0);
        expect(safe?.textContent).toBe('');
        expect(safe?.querySelectorAll(':scope > img')).toHaveLength(1);
        expect(safe?.querySelectorAll('img')).toHaveLength(1);

        for (const id of ['repeat', 'repeat-x']) {
          const repeated = marker('repeat-x' === id ? 2 : 1);
          expect(repeated?.textContent).toBe(' ');
          expect(repeated?.querySelectorAll('img')).toHaveLength(0);
          expect(repeated?.getAttribute('style')).toContain('background-image:url("data:image/png;base64,');
          expect(repeated?.getAttribute('style')).toContain(
            `background-repeat:${'repeat-x' === id ? 'repeat-x' : 'repeat'}`
          );
        }

        const gradient = marker(3);
        expect(gradient?.textContent).toBe(' ');
        expect(gradient?.querySelectorAll('img')).toHaveLength(0);
        expect(gradient?.getAttribute('style')).toContain('background-image:linear-gradient(');
        const color = marker(4);
        expect(color?.textContent).toBe(' ');
        expect(color?.querySelectorAll('img')).toHaveLength(0);
        expect(color?.getAttribute('style')).toContain('background-color:rgb(7, 8, 9)');
        const shadow = marker(5);
        expect(shadow?.textContent).toBe(' ');
        expect(shadow?.querySelectorAll('img')).toHaveLength(0);
        expect(shadow?.getAttribute('style')).toContain('box-shadow:rgb(10, 11, 12) 0 1px 2px');

        expect(marker(6)?.textContent).toBe('Caption');
        for (const index of [7, 8]) {
          const filtered = marker(index);
          expect(filtered?.textContent).toBe(' ');
          expect(filtered?.querySelectorAll('img')).toHaveLength(0);
          expect(filtered?.getAttribute('style')).not.toContain('data:image/svg+xml');
          expect(filtered?.getAttribute('style')).not.toContain(unknownImageUrl);
        }
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('preserves hidden SVG definitions referenced by visible shapes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<svg id="masked" viewBox="0 0 40 40">',
      '<defs style="display:none">',
      '<clipPath id="clip"><rect width="40" height="40"></rect></clipPath>',
      '<linearGradient id="gradient"><stop offset="0" stop-color="#fff"></stop><stop offset="1" stop-color="#000"></stop></linearGradient>',
      '</defs>',
      '<rect width="40" height="40" clip-path="url(#clip)" fill="url(#gradient)"></rect>',
      '</svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Masked shape' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DEFS' === element.tagName) return declaration({ display: 'none' });
        if ('SVG' === element.tagName) {
          return declaration({ display: 'block', width: '40px', height: '40px' });
        }
        if ('RECT' === element.tagName) {
          return declaration({ display: 'block', fill: 'url(#gradient)' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelector('svg#masked defs')).not.toBeNull();
    expect(holder.querySelector('svg #clip')).not.toBeNull();
    expect(holder.querySelector('svg #gradient')).not.toBeNull();
    expect(holder.querySelector('svg rect[clip-path="url(#clip)"]')).not.toBeNull();
    expect(holder.querySelector('svg rect[fill="url(#gradient)"]')).not.toBeNull();
  });

  it('preserves multi-row KaTeX matrix and cases layout', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const column = (first: string, second: string): string =>
      [
        '<span class="col-align-c"><span class="vlist-t vlist-t2">',
        `<span class="vlist-r"><span class="vlist"><span style="top:-2em"><span class="pstrut"></span><span class="mord">${first}</span></span></span></span>`,
        `<span class="vlist-r"><span class="vlist"><span><span class="pstrut"></span><span class="mord">${second}</span></span></span></span>`,
        '</span></span>'
      ].join('');
    const row = (content: string): string =>
      [
        '<span class="vlist-r"><span class="vlist"><span><span class="pstrut"></span><span class="mord">',
        content,
        '</span></span></span></span>'
      ].join('');
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<div class="katex"><span class="katex-mathml"><math><mtable><mtr><mtd>1</mtd></mtr></mtable></math></span><span class="katex-html"><span class="base"><span class="mord"><span class="mtable">',
      column('1', '4'),
      column('2', '5'),
      column('3', '6'),
      '</span></span></span></span></div>',
      '<div class="katex"><span class="katex-mathml"><math><mtable><mtr><mtd>x+y=10</mtd></mtr><mtr><mtd>2x-y=5</mtd></mtr></mtable></math></span><span class="katex-html"><span class="base"><span class="mord"><span class="vlist-t">',
      row('x + y = 10'),
      row('2x - y = 5'),
      '</span></span></span></span></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '1 4 2 5 3 6\nx + y = 10\n2x - y = 5' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DIV' === element.tagName && element.classList.contains('katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          if (element.classList.contains('vlist-t')) {
            return declaration({ display: 'inline-table', position: 'static', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('vlist-r')) {
            return declaration({ display: 'table-row', position: 'static', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('vlist')) {
            return declaration({ display: 'table-cell', position: 'relative', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('pstrut')) {
            return declaration({ display: 'inline-block', width: '0px', height: '45.7344px', 'white-space': 'nowrap' });
          }
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const visualText = (holder.textContent ?? '').replaceAll('\u2060', '').replace(/\s+/g, ' ');
    expect(holder.querySelectorAll('nobr')).toHaveLength(2);
    expect(holder.querySelectorAll('nobr[style*="display:inline-block!important"]')).toHaveLength(2);
    expect(holder.querySelector('math')).toBeNull();
    expect(holder.querySelectorAll('span[style*="display:inline-table"]').length).toBeGreaterThanOrEqual(4);
    expect(holder.querySelectorAll('span[style*="display:table-row"]').length).toBeGreaterThanOrEqual(8);
    expect(holder.querySelectorAll('span[style*="display:table-cell"]').length).toBeGreaterThanOrEqual(8);
    expect(holder.querySelectorAll('span[style*="height:45.7344px"]').length).toBeGreaterThanOrEqual(8);
    expect(visualText).toContain('142536');
    expect(visualText).toContain('x + y = 10');
    expect(visualText).toContain('2x - y = 5');
  });

  it('uses the synchronous compatibility copy only when modern write is unavailable', async () => {
    const source = document.createElement('button');
    let copiedMarkup = '';
    const scrollTo = vi.fn();
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    document.body.appendChild(source);
    source.focus();
    try {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => {
          const sandbox = document.querySelector('.easymde-copy-sandbox') as HTMLElement | null;
          copiedMarkup = sandbox?.innerHTML ?? '';
          sandbox?.focus();
          return true;
        })
      });
      const execCommand = vi.spyOn(document, 'execCommand');
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: computedStyle,
        getSelection: window.getSelection.bind(window),
        scrollTo,
        write: null,
        pageOffset: () => ({ x: 5, y: 8 })
      });

      const preview = readyPreview();
      await prepareClipboard(clipboard, preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(copiedMarkup).toContain('max-width:100%');
      expect(copiedMarkup).not.toContain('data-easymde-');
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(document.querySelector('.easymde-copy-sandbox')).toBeNull();
      expect(document.activeElement).toBe(source);
      expect(scrollTo).toHaveBeenCalledWith(5, 8);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
      source.remove();
    }
  });

  it('falls back to the current payload when ClipboardItem setup rejects synchronously', async () => {
    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    try {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => {
          legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
          return true;
        })
      });
      class RejectingClipboardItem {
        constructor(_payload: Record<string, Blob>) {
          throw new TypeError('deferred clipboard items are unsupported');
        }
      }
      const write = vi.fn(async () => undefined);
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: RejectingClipboardItem,
        document,
        getComputedStyle: computedStyle,
        getSelection: window.getSelection.bind(window),
        scrollTo: vi.fn(),
        write,
        pageOffset: () => ({ x: 0, y: 0 })
      });

      await expect(clipboard.copy(readyPreview())).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(write).not.toHaveBeenCalled();
      expect(legacyHtml).toContain('Rendered');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('does not reuse a prepared payload after root-only style changes', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: computedStyle,
        getSelection: window.getSelection.bind(window),
        scrollTo: vi.fn(),
        write: null,
        pageOffset: () => ({ x: 0, y: 0 })
      });
      const preview = readyPreview();
      await prepareClipboard(clipboard, preview);

      preview.classList.add('easymde-font-overrides');

      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('does not reuse a prepared payload after responsive computed layout changes', async () => {
    const writes: unknown[] = [];
    let width = '100px';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Responsive layout</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Responsive layout' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName) {
          return declaration({ display: 'block', width });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await prepareClipboard(clipboard, preview);
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const firstItem = (writes[0] as ClipboardItemStub[])[0];
    const firstHtml = firstItem?.payload['text/html'];
    if (!firstHtml) throw new Error('first clipboard html missing');
    expect(await blobText(firstHtml)).toContain('width:100px');

    width = '200px';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const secondItem = (writes[1] as ClipboardItemStub[])[0];
    const secondHtml = secondItem?.payload['text/html'];
    if (!secondHtml) throw new Error('second clipboard html missing');
    expect(await blobText(secondHtml)).toContain('width:200px');
  });

  it('rejects live source markup changes after the warm-cache freshness walk', async () => {
    const writes: unknown[] = [];
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Original</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Original' });
    let mutateDuringFreshness = false;
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName && mutateDuringFreshness) {
          mutateDuringFreshness = false;
          element.textContent = 'Changed';
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub | undefined;
        const html = item?.payload['text/html'];
        if (!html) throw new Error('clipboard html missing');
        await blobText(html);
        committed = true;
      }
    });

    await prepareClipboard(clipboard, preview);
    mutateDuringFreshness = true;
    await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writes).toHaveLength(1);
    expect(committed).toBe(false);
  });

  it('feeds modern Clipboard and legacy copy with the same normalized HTML', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div><h4>相同载荷</h4><p><strong>Portable</strong></p></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '相同载荷\nPortable' });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const writes: unknown[] = [];
    const runtime = {
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items: unknown[]) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    };
    const modern = createBrowserWechatClipboard(runtime);
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernBlob = modernItem?.payload['text/html'];
    if (!modernBlob) throw new Error('modern clipboard html missing');
    const modernHtml = await blobText(modernBlob);

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacy = createBrowserWechatClipboard({ ...runtime, clipboardItem: null, write: null });
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    expect(legacyHtml).toBe(modernHtml);
  });

  it('returns an explicit failure when modern and compatibility copy both fail', async () => {
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: vi.fn(async () => {
        throw new Error('denied');
      }),
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(readyPreview())).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(document.querySelector('.easymde-copy-sandbox')).toBeNull();
  });
});
