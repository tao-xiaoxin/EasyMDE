import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard, MAX_WECHAT_PNG_DIMENSION } from './create-browser-wechat-clipboard';

import {
  computedStyle,
  declaration,
  installClipboardTestEnvironment,
  observeFixtureContentBox,
  pngOptions,
  readyPreview,
  setMermaidComputedStyleMap
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();
  afterEach(() => vi.unstubAllGlobals());

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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.className = 'gantt-ancestor';
    const viewBoxWidth = 'oversized' === failure ? MAX_WECHAT_PNG_DIMENSION + 1 : 1200;
    const wideOwner = failure.startsWith('wide-');
    const ownerWidth = wideOwner ? 1600 : 'intrinsic-magnification' === failure ? 600 : 335;
    observeFixtureContentBox(() => ({
      width: ownerWidth,
      height: 'intrinsic-magnification' === failure ? 134 : 268
    }));
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
            : computedStyle(element, pseudoElement);
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

});
