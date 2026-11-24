// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';
import {
  createCapturePlan,
  isMathBlockContentCaptureSnapshot,
  snapshotMathCaptureNode,
  type WechatMathCaptureNodeSnapshot,
  type WechatMathCaptureSnapshot,
} from './wechat-capture-plan';
import type { WechatVisualRasterizationRequest } from '../../../contracts/ports/wechat-visual-rasterization-port';

import {
  blobText,
  computedStyle,
  declaration,
  installClipboardTestEnvironment,
  pngOptions,
  readyPreview
} from './wechat-clipboard-test-fixtures';

const MATH_CAPTURE_AUTO_VALUES: Readonly<Record<string, string>> = {
  'block-size': 'auto',
  'clip': 'auto',
  'clip-path': 'none',
  'contain': 'none',
  'content-visibility': 'visible',
  'display': 'block',
  'height': 'auto',
  'inline-size': 'auto',
  'mask-image': 'none',
  'max-block-size': 'none',
  'max-height': 'none',
  'max-inline-size': 'none',
  'max-width': 'none',
  'min-block-size': '0px',
  'min-height': '0px',
  'min-inline-size': '0px',
  'min-width': '0px',
  'overflow': 'visible',
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  'width': 'auto',
  'writing-mode': 'horizontal-tb',
};

const MATH_CAPTURE_TYPED_SIZE_PROPERTIES = new Set([
  'block-size',
  'height',
  'inline-size',
  'max-block-size',
  'max-height',
  'max-inline-size',
  'max-width',
  'min-block-size',
  'min-height',
  'min-inline-size',
  'min-width',
  'width'
]);

const MATH_CAPTURE_SAFE_PAINT_VALUES: Readonly<Record<string, string>> = {
  clip: 'auto',
  'clip-path': 'none',
  contain: 'none',
  'content-visibility': 'visible',
  'mask-image': 'none',
  overflow: 'visible',
  'overflow-x': 'visible',
  'overflow-y': 'visible',
  'writing-mode': 'horizontal-tb'
};

function setMathComputedStyleMap(
  element: Element,
  overrides: Readonly<Record<string, string>> = {},
): void {
  const values = { ...MATH_CAPTURE_AUTO_VALUES, ...overrides };
  Object.defineProperty(element, 'computedStyleMap', {
    configurable: true,
    value: () => ({
      get: (property: string) => {
        if (!MATH_CAPTURE_TYPED_SIZE_PROPERTIES.has(property)) throw new TypeError(`unsupported size property: ${property}`);
        return { value: values[property] };
      },
    }),
  });
}

type MathTypedOverride = string | null | undefined;

function mathCaptureNodeSnapshot(
  typedOverrides: Readonly<Record<string, MathTypedOverride>> = {},
  paintOverrides: Readonly<Record<string, string>> = {},
): WechatMathCaptureNodeSnapshot {
  const element = document.createElement('div');
  const values: Readonly<Record<string, MathTypedOverride>> = {
    ...MATH_CAPTURE_AUTO_VALUES,
    ...typedOverrides,
  };
  Object.defineProperty(element, 'computedStyleMap', {
    configurable: true,
    value: () => ({
      get: (property: string) => {
        if (!MATH_CAPTURE_TYPED_SIZE_PROPERTIES.has(property)) {
          throw new TypeError(`unsupported size property: ${property}`);
        }
        const value = values[property];
        return null === value || undefined === value ? null : { value };
      },
    }),
  });
  return snapshotMathCaptureNode(
    element,
    declaration({
      ...MATH_CAPTURE_SAFE_PAINT_VALUES,
      display: 'block',
      height: '32px',
      width: '416px',
      ...paintOverrides,
    }),
  );
}

function mathCaptureSnapshot(
  ownerTypedOverrides: Readonly<Record<string, MathTypedOverride>> = {},
  shellTypedOverrides: Readonly<Record<string, MathTypedOverride>> = ownerTypedOverrides,
  ownerPaintOverrides: Readonly<Record<string, string>> = {},
  shellPaintOverrides: Readonly<Record<string, string>> = ownerPaintOverrides,
): WechatMathCaptureSnapshot {
  return {
    owner: mathCaptureNodeSnapshot(ownerTypedOverrides, ownerPaintOverrides),
    shells: [
      mathCaptureNodeSnapshot(shellTypedOverrides, shellPaintOverrides),
      mathCaptureNodeSnapshot(shellTypedOverrides, shellPaintOverrides),
      mathCaptureNodeSnapshot(shellTypedOverrides, shellPaintOverrides),
    ],
  };
}

function mathBlockPlan(
  snapshot: WechatMathCaptureSnapshot,
): Extract<ReturnType<typeof createCapturePlan>, { kind: 'math' }> {
  const source = document.createElement('div');
  const plan = createCapturePlan(
    { element: source, kind: 'math', source },
    snapshot,
    { height: 32, width: 416 },
    false,
    null,
    null,
  );
  if ('math' !== plan.kind) throw new Error('unexpected non-math capture plan');
  return plan;
}

installClipboardTestEnvironment();

describe('wechat math capture plan', () => {
  it('accepts complete physical fallback when every logical size is missing', () => {
    const missingLogicalSizes = {
      'block-size': undefined,
      'inline-size': undefined,
      'max-block-size': undefined,
      'max-inline-size': undefined,
      'min-block-size': undefined,
      'min-inline-size': undefined,
    };
    const snapshot = mathCaptureSnapshot(missingLogicalSizes);

    expect(isMathBlockContentCaptureSnapshot(snapshot)).toBe(true);
    expect(mathBlockPlan(snapshot).mathCapture).toBe('content');
  });

  it('accepts horizontal partial logical fallback for a missing block axis', () => {
    const missingBlockLogicalSizes = {
      'block-size': undefined,
      'max-block-size': undefined,
      'min-block-size': undefined,
    };
    const snapshot = mathCaptureSnapshot(missingBlockLogicalSizes);

    expect(isMathBlockContentCaptureSnapshot(snapshot)).toBe(true);
    expect(mathBlockPlan(snapshot).mathCapture).toBe('content');
  });

  it('maps a vertical inline fallback to physical height', () => {
    const verticalInlineFallback = {
      'inline-size': undefined,
      'max-inline-size': undefined,
      'min-inline-size': undefined,
      width: '32px',
      'max-width': '32px',
      'min-width': '32px',
    };
    const snapshot = mathCaptureSnapshot(
      verticalInlineFallback,
      verticalInlineFallback,
      { 'writing-mode': 'vertical-rl' },
      { 'writing-mode': 'vertical-rl' },
    );

    expect(isMathBlockContentCaptureSnapshot(snapshot)).toBe(true);
    expect(mathBlockPlan(snapshot).mathCapture).toBe('content');
  });

  it('maps a vertical block fallback to physical width', () => {
    const verticalBlockFallback = {
      'block-size': undefined,
      'max-block-size': undefined,
      'min-block-size': undefined,
      height: '32px',
      'max-height': '32px',
      'min-height': '32px',
    };
    const snapshot = mathCaptureSnapshot(
      verticalBlockFallback,
      verticalBlockFallback,
      { 'writing-mode': 'vertical-rl' },
      { 'writing-mode': 'vertical-rl' },
    );

    expect(isMathBlockContentCaptureSnapshot(snapshot)).toBe(true);
    expect(mathBlockPlan(snapshot).mathCapture).toBe('content');
  });

  it('keeps content capture when Chrome omits unsupported mask border and shorthand values', () => {
    const snapshot = mathCaptureSnapshot();

    expect(isMathBlockContentCaptureSnapshot(snapshot)).toBe(true);
    expect(mathBlockPlan(snapshot).mathCapture).toBe('content');
  });

  it.each([
    ['a mask image', { 'mask-image': 'url("mask.svg")' }],
    ['a clip path', { 'clip-path': 'inset(0 1px)' }],
  ] as const)('keeps complex supported %s on the full-root path', (_label, paintOverrides) => {
    const snapshot = mathCaptureSnapshot({}, {}, {}, paintOverrides);

    expect(isMathBlockContentCaptureSnapshot(snapshot)).toBe(false);
    expect(mathBlockPlan(snapshot).mathCapture).toBe('full-root');
  });

  it('does not treat max-inline-size:auto as an unbounded maximum', () => {
    const snapshot = mathCaptureSnapshot({ 'max-inline-size': 'auto' });

    expect(isMathBlockContentCaptureSnapshot(snapshot)).toBe(false);
    expect(mathBlockPlan(snapshot).mathCapture).toBe('full-root');
  });

  it('freezes block capture mode from the native clone snapshot through request and replacement', async () => {
    const writes: unknown[] = [];
    let captureMode: string | undefined;
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math-block" style="display:grid;padding:4px">'
      + '<span class="katex-display"><span class="katex"><span class="katex-html">'
      + '<span class="base">short matrix</span></span></span></span></div>';
    const root = preview.querySelector('.easymde-math-block');
    if (!root) throw new Error('math root missing');
    setMathComputedStyleMap(root);
    root.querySelectorAll('.katex-display, .katex, .katex-html').forEach((element) => {
      setMathComputedStyleMap(element);
    });
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 32, width: 442 })
    });
    const rasterize = vi.fn(async (request: WechatVisualRasterizationRequest) => {
      if ('math' !== request.kind) throw new Error('unexpected mermaid request');
      const { mathCapture, source } = request;
      captureMode = mathCapture;
      expect(source.getAttribute('style')).toContain('display:block');
      return {
        file: new File(['native-mode'], 'native-mode.png', { type: 'image/png' }),
        height: 32,
        pixelCount: 134 * 32,
        width: 134
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'native-mode.png',
      url: 'https://example.test/native-mode.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            ...MATH_CAPTURE_SAFE_PAINT_VALUES,
            display: 'block',
            height: '32px',
            padding: '4px',
            width: '442px'
          });
        }
        if (element.matches('.katex-display, .katex, .katex-html')) {
          return declaration({
            ...MATH_CAPTURE_SAFE_PAINT_VALUES,
            display: 'block',
            height: '32px',
            width: '416px'
          });
        }
        if (element.classList.contains('base')) {
          return declaration({ display: 'inline-block', height: '32px', width: '134px' });
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
    expect(captureMode).toBe('content');
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('section')).toHaveLength(2);
    expect(holder.querySelector('img[src="https://example.test/native-mode.png"]')).not.toBeNull();
  });

  it('keeps an inline-block source with a flex native snapshot on the full-root path', async () => {
    let captureMode: string | undefined;
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<span class="easymde-math-block" style="display:inline-block!important">'
      + '<span class="katex"><span class="katex-html">inline decorated</span></span></span>';
    const root = preview.querySelector('.easymde-math-block');
    if (!root) throw new Error('math root missing');
    setMathComputedStyleMap(root, { display: 'flex' });
    root.querySelectorAll('.katex-display, .katex, .katex-html').forEach((element) => {
      setMathComputedStyleMap(element);
    });
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 20, width: 40 })
    });
    const rasterize = vi.fn(async (request: WechatVisualRasterizationRequest) => {
      if ('math' !== request.kind) throw new Error('unexpected mermaid request');
      captureMode = request.mathCapture;
      return {
        file: new File(['inline-decorated'], 'inline-decorated.png', { type: 'image/png' }),
        height: 20,
        inlineLayout: { baseline: 15, height: 20, paintOffsetX: 0, paintOffsetY: 0, width: 40 },
        pixelCount: 800,
        width: 40
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'inline-decorated.png',
      url: 'https://example.test/inline-decorated.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if (element.classList.contains('easymde-math-block')) {
          return declaration({ ...MATH_CAPTURE_SAFE_PAINT_VALUES, display: 'flex', height: '20px', width: '40px' });
        }
        if (element.matches('.katex-display, .katex, .katex-html')) {
          return declaration({ ...MATH_CAPTURE_SAFE_PAINT_VALUES, display: 'block', height: '20px', width: '40px' });
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
    expect(captureMode).toBe('full-root');
  });

  it.each([
    ['an inner hidden viewport', 'katex', { display: 'block', height: '32px', overflow: 'hidden', width: '80px' }, 'full-root', { overflow: 'hidden' }],
    ['a fixed-height hidden viewport', 'katex-html', { display: 'block', height: '32px', overflow: 'hidden', width: '416px' }, 'full-root', { overflow: 'hidden' }],
    ['an auto viewport without overflow', 'katex', { display: 'block', height: '32px', overflow: 'auto', width: '416px' }, 'full-root', { overflow: 'auto' }],
    ['a scroll viewport without overflow', 'katex-html', { display: 'block', height: '32px', overflow: 'scroll', width: '416px' }, 'full-root', { overflow: 'scroll' }],
    ['typed auto size at a used 32px height', 'katex', { display: 'block', height: '32px', overflow: 'visible', width: '416px' }, 'content', {}],
    ['a fixed typed height', 'katex', { display: 'block', height: '32px', overflow: 'visible', width: '416px' }, 'full-root', { 'block-size': '32px', height: '32px' }],
    ['a fixed typed maximum height', 'katex', { display: 'block', height: '32px', overflow: 'visible', width: '416px' }, 'full-root', { 'max-block-size': '32px', 'max-height': '32px' }],
    ['a fixed typed width', 'katex', { display: 'block', height: '32px', overflow: 'visible', width: '416px' }, 'full-root', { 'inline-size': '416px', width: '416px' }],
    ['a missing Typed OM snapshot', 'katex', { display: 'block', height: '32px', overflow: 'visible', width: '416px' }, 'full-root', null]
  ] as const)('selects the frozen %s math path', async (_label, constrainedClass, shellStyle, expectedMode, typedOverrides) => {
    let captureMode: string | undefined;
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html">'
      + '<span class="base">constrained formula</span></span></span></span></div>';
    const root = preview.querySelector('.easymde-math-block');
    if (!root) throw new Error('math root missing');
    setMathComputedStyleMap(root);
    root.querySelectorAll('.katex-display, .katex, .katex-html').forEach((element) => {
      if (element.classList.contains(constrainedClass) && null === typedOverrides) return;
      setMathComputedStyleMap(
        element,
        element.classList.contains(constrainedClass) ? typedOverrides ?? {} : {},
      );
    });
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 32, width: 442 })
    });
    const rasterize = vi.fn(async (request: WechatVisualRasterizationRequest) => {
      if ('math' !== request.kind) throw new Error('unexpected mermaid request');
      captureMode = request.mathCapture;
      return {
        file: new File(['constrained'], 'constrained.png', { type: 'image/png' }),
        height: 32,
        pixelCount: 134 * 32,
        width: 134
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'constrained.png',
      url: 'https://example.test/constrained.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ ...MATH_CAPTURE_SAFE_PAINT_VALUES, display: 'block', height: '32px', width: '442px' });
        }
        if (element.matches('.katex-display, .katex, .katex-html')) {
          const values = {
            ...MATH_CAPTURE_SAFE_PAINT_VALUES,
            ...(element.classList.contains(constrainedClass) ? shellStyle : {
              display: 'block',
              height: '32px',
              width: '416px'
            })
          };
          return declaration(values);
        }
        return declaration({ display: 'inline-block', height: '32px', width: '134px' });
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
    expect(captureMode).toBe(expectedMode);
  });

});
