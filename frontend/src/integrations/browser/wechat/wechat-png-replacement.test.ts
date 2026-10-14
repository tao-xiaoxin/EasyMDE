import { describe, expect, it } from 'vitest';

import type { CompletedUpload } from './wechat-capture-plan';
import type { WechatPngConversionContext } from './wechat-png-conversion-policy';
import { replaceCompletedVisuals } from './wechat-png-replacement';
import { declaredStyleDeclarations } from './wechat-clipboard-test-fixtures';

function singleDeclarationValue(element: Element, property: string): string {
  const [declaration] = declaredStyleDeclarations(element, property);
  if (!declaration) throw new Error(`wechat-png-replacement-test-missing-${property}`);
  return declaration.value;
}

function mermaidFixture(): Readonly<{ candidate: HTMLElement; root: HTMLElement; svg: Element }> {
  const root = document.createElement('article');
  root.setAttribute('data-easymde-preview-html-sink', 'true');
  root.innerHTML =
    '<div class="easymde-mermaid"><svg viewBox="0 0 586 1200">' +
    '<rect width="586" height="1200"></rect></svg></div>';
  const candidate = root.querySelector<HTMLElement>('.easymde-mermaid');
  const svg = candidate?.querySelector('svg') ?? null;
  if (!candidate || !svg) throw new Error('wechat-png-replacement-test-fixture-missing');
  return { candidate, root, svg };
}

function conversionContext(root: HTMLElement): WechatPngConversionContext {
  return {
    captureBoundary: root,
    imageUploadPort: {} as never,
    maxBytes: 1024,
    mermaidSnapshots: new Map(),
    postId: 17,
    rasterizationPort: {} as never,
    scale: 1,
    signal: new AbortController().signal,
    state: { uploadsMayRemain: false }
  };
}

describe('replaceCompletedVisuals', () => {
  it('serializes one decisive width, max-width, and height declaration for a responsive Mermaid frame', () => {
    const { candidate, root, svg } = mermaidFixture();
    const completed: CompletedUpload = {
      autoMargins: false,
      candidate: { element: candidate, kind: 'mermaid', source: svg },
      captureSize: { height: 1200, width: 586 },
      kind: 'mermaid',
      layoutMagnification: 1,
      maxWidth: 586,
      mode: 'mermaid-responsive',
      rasterized: {
        file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
        height: 1200,
        pixelCount: 586 * 1200,
        width: 586
      },
      url: 'https://example.test/mermaid.png'
    };

    replaceCompletedVisuals(root, conversionContext(root), [completed]);

    const image = root.querySelector('img');
    if (!image) throw new Error('wechat-png-replacement-test-image-missing');
    expect(image.getAttribute('style')).toBe(
      'display:block!important;width:100%!important;max-width:586px!important;height:auto!important'
    );
    expect(declaredStyleDeclarations(image, 'width')).toEqual([{ important: true, property: 'width', value: '100%' }]);
    expect(declaredStyleDeclarations(image, 'max-width')).toEqual([{ important: true, property: 'max-width', value: '586px' }]);
    expect(declaredStyleDeclarations(image, 'height')).toEqual([{ important: true, property: 'height', value: 'auto' }]);
  });

  it('keeps the authored cap while the responsive frame follows 586, 375, and 320 pixel destinations', () => {
    const { candidate, root, svg } = mermaidFixture();
    const completed: CompletedUpload = {
      autoMargins: false,
      candidate: { element: candidate, kind: 'mermaid', source: svg },
      captureSize: { height: 1200, width: 586 },
      kind: 'mermaid',
      layoutMagnification: 1,
      maxWidth: 586,
      mode: 'mermaid-responsive',
      rasterized: {
        file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
        height: 1200,
        pixelCount: 586 * 1200,
        width: 586
      },
      url: 'https://example.test/mermaid.png'
    };

    replaceCompletedVisuals(root, conversionContext(root), [completed]);

    const image = root.querySelector('img');
    if (!image) throw new Error('wechat-png-replacement-test-image-missing');
    expect(singleDeclarationValue(image, 'width')).toBe('100%');
    // WeChat text columns measure 586px in the desktop editor, 375px on a phone,
    // and 320px on a narrow phone: `width:100%` fills the column while the single
    // `max-width:586px` caps it at the authored Mermaid size.
    const renderedWidth = (destination: number): number =>
      Math.min(destination, Number.parseFloat(singleDeclarationValue(image, 'max-width')));
    expect([586, 375, 320].map(renderedWidth)).toEqual([586, 375, 320]);
    // A destination wider than the cap must not upscale the raster frame.
    expect(renderedWidth(760)).toBe(586);
    expect(singleDeclarationValue(image, 'height')).toBe('auto');
    expect(image.getAttribute('width')).toBe('586');
    expect(image.getAttribute('height')).toBe('1200');
  });

  it('keeps an intrinsic Mermaid frame at its rasterized size instead of scaling it to the destination', () => {
    const { candidate, root, svg } = mermaidFixture();
    const completed: CompletedUpload = {
      autoMargins: false,
      candidate: { element: candidate, kind: 'mermaid', source: svg },
      captureSize: { height: 1200, width: 900 },
      kind: 'mermaid',
      layoutMagnification: 1,
      mode: 'mermaid-intrinsic',
      rasterized: {
        file: new File(['png'], 'mermaid-intrinsic.png', { type: 'image/png' }),
        height: 1200,
        pixelCount: 900 * 1200,
        width: 900
      },
      url: 'https://example.test/mermaid-intrinsic.png'
    };

    replaceCompletedVisuals(root, conversionContext(root), [completed]);

    const image = root.querySelector('img');
    if (!image) throw new Error('wechat-png-replacement-test-image-missing');
    expect(singleDeclarationValue(image, 'width')).toBe('900px');
    expect(declaredStyleDeclarations(image, 'height')).toEqual([{ important: true, property: 'height', value: '1200px' }]);
    expect(declaredStyleDeclarations(image, 'max-width')).toEqual([{ important: true, property: 'max-width', value: 'none' }]);
    expect(image.getAttribute('style')).not.toContain('width:100%');
    expect(candidate.getAttribute('style')).toContain('overflow-x:auto!important');
    expect(candidate.hasAttribute('data-ignore-width')).toBe(true);
  });
});
