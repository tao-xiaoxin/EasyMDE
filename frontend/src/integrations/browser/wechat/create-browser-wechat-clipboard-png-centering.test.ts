import { describe, expect, it, vi } from 'vitest';
import type {
  WechatVisualRasterizationResult
} from '../../../contracts/ports/wechat-visual-rasterization-port';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  deferred,
  installClipboardTestEnvironment,
  pngOptions
} from './wechat-clipboard-test-fixtures';


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
  installClipboardTestEnvironment();

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

});
