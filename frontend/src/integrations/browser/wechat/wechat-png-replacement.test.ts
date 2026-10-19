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
  it('keeps one decorated block owner and replaces only its formula content', () => {
    const root = document.createElement('article');
    root.setAttribute('data-easymde-preview-html-sink', 'true');
    root.innerHTML = '<div class="easymde-math-block" style="display:block;width:547px;height:106px;'
      + 'margin:12px auto;padding-top:12px;padding-right:12px;padding-bottom:12px;padding-left:12px;'
      + 'border-top-width:1px;border-right-width:1px;border-bottom-width:1px;border-left-width:1px;'
      + 'border-top-style:solid;border-right-style:solid;border-bottom-style:solid;border-left-style:solid;'
      + 'border-top-color:#dcdcde;border-right-color:#dcdcde;border-bottom-color:#dcdcde;border-left-color:#dcdcde;'
      + 'border-radius:8px;background:#fbfbfc;text-align:center;overflow-x:auto;overflow-y:hidden;opacity:.5">'
      + '<span class="katex"><span class="katex-html"><span class="base">old</span></span></span></div>';
    const candidate = root.querySelector<HTMLElement>('.easymde-math-block');
    if (!candidate) throw new Error('wechat-png-replacement-test-math-root-missing');
    const completed: CompletedUpload = {
      candidate: { element: candidate, kind: 'math', source: candidate },
      captureSize: { height: 106, width: 547 },
      kind: 'math',
      mathCapture: 'content',
      mode: 'math-block',
      rasterized: {
        file: new File(['png'], 'math.png', { type: 'image/png' }),
        height: 32,
        pixelCount: 134 * 32,
        width: 134,
      },
      url: 'https://example.test/math.png',
    };

    replaceCompletedVisuals(root, conversionContext(root), [completed]);

    const image = candidate.querySelector('img');
    if (!image) throw new Error('wechat-png-replacement-test-math-image-missing');
    expect(candidate).toBe(root.querySelector('.easymde-math-block'));
    expect(candidate.children).toHaveLength(1);
    expect(candidate.querySelector('.katex')).toBeNull();
    expect(candidate.getAttribute('style')).toContain('padding-top:12px');
    expect(candidate.getAttribute('style')).toContain('border-top-width:1px');
    expect(candidate.getAttribute('style')).toContain('border-radius:8px');
    expect(candidate.getAttribute('style')).toContain('background:rgb(251, 251, 252)');
    expect(candidate.getAttribute('style')).toContain('opacity:0.5');
    expect(candidate.getAttribute('style')).toContain('width:100%!important');
    expect(candidate.getAttribute('style')).toContain('height:auto!important');
    expect(candidate.getAttribute('style')?.match(/padding-top:/g)).toHaveLength(1);
    expect(candidate.getAttribute('style')?.match(/background:/g)).toHaveLength(1);
    expect(candidate.getAttribute('style')?.match(/opacity:/g)).toHaveLength(1);
    expect(candidate.getAttribute('style')?.match(/overflow-x:auto/g)).toHaveLength(1);
    expect(image.getAttribute('style')).toContain('width:134px!important');
    expect(image.getAttribute('style')).toContain('height:32px!important');
    expect(image.getAttribute('style')).toContain('margin-left:auto!important');
    expect(image.getAttribute('style')).toContain('margin-right:auto!important');
    expect(image.getAttribute('style')).not.toMatch(/(?:^|;)padding/);
    expect(image.getAttribute('style')).not.toMatch(/(?:^|;)border/);
    expect(image.getAttribute('style')).not.toContain('background');
    expect(image.getAttribute('style')).not.toContain('opacity');
    expect(image.getAttribute('style')).not.toContain('left:-');
  });
  it('serializes one decisive source-cap width, responsive bound, and height for a responsive Mermaid frame', () => {
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
      'display:block!important;width:586px!important;max-width:100%!important;height:auto!important'
    );
    expect(declaredStyleDeclarations(image, 'width')).toEqual([{ important: true, property: 'width', value: '586px' }]);
    expect(declaredStyleDeclarations(image, 'max-width')).toEqual([
      { important: true, property: 'max-width', value: '100%' }
    ]);
    expect(declaredStyleDeclarations(image, 'height')).toEqual([{ important: true, property: 'height', value: 'auto' }]);
  });

  it.each([
    { destinationWidth: 280, expectedRenderedWidth: 280 },
    { destinationWidth: 335, expectedRenderedWidth: 335 },
    { destinationWidth: 390, expectedRenderedWidth: 350.3125 },
    { destinationWidth: 677, expectedRenderedWidth: 350.3125 }
  ])('keeps the validated SVG cap at a $destinationWidth pixel destination', ({ destinationWidth, expectedRenderedWidth }) => {
    const { candidate, root, svg } = mermaidFixture();
    const completed: CompletedUpload = {
      autoMargins: false,
      candidate: { element: candidate, kind: 'mermaid', source: svg },
      captureSize: { height: 725.734375, width: 350.3125 },
      kind: 'mermaid',
      layoutMagnification: 1,
      maxWidth: 350.3125,
      mode: 'mermaid-responsive',
      rasterized: {
        file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
        height: 1452,
        pixelCount: 701 * 1452,
        width: 701
      },
      url: 'https://example.test/mermaid.png'
    };

    replaceCompletedVisuals(root, conversionContext(root), [completed]);

    const image = root.querySelector('img');
    if (!image) throw new Error('wechat-png-replacement-test-image-missing');
    // The validated source SVG cap is the desktop width, while max-width:100%
    // keeps narrower destination columns from clipping.
    expect(singleDeclarationValue(image, 'width')).toBe('350.3125px');
    expect(singleDeclarationValue(image, 'max-width')).toBe('100%');
    expect(singleDeclarationValue(image, 'height')).toBe('auto');
    expect(Math.min(destinationWidth, Number.parseFloat(singleDeclarationValue(image, 'width')))).toBe(
      expectedRenderedWidth
    );
    // Raster DPR only changes the uploaded pixels, never the destination CSS size.
    expect(image.getAttribute('width')).toBe('701');
    expect(image.getAttribute('height')).toBe('1452');
  });

  it('keeps a compensated Mermaid root responsive inside its bounded scroll wrapper', () => {
    const { candidate, root, svg } = mermaidFixture();
    const completed: CompletedUpload = {
      autoMargins: false,
      candidate: { element: candidate, kind: 'mermaid', source: svg },
      captureSize: { height: 1200, width: 586 },
      kind: 'mermaid',
      layoutMagnification: 2,
      mode: 'mermaid-root',
      rasterized: {
        file: new File(['png'], 'mermaid-compensated.png', { type: 'image/png' }),
        height: 2400,
        pixelCount: 1172 * 2400,
        width: 1172
      },
      url: 'https://example.test/mermaid-compensated.png'
    };

    replaceCompletedVisuals(root, conversionContext(root), [completed]);

    const image = root.querySelector('img');
    if (!image) throw new Error('wechat-png-replacement-test-compensated-image-missing');
    expect(image.getAttribute('style')).toBe(
      'display:block!important;width:100%!important;max-width:100%!important;height:auto!important'
    );
    expect(declaredStyleDeclarations(candidate, 'width')).toEqual([
      { important: true, property: 'width', value: '100%' }
    ]);
    expect(declaredStyleDeclarations(candidate, 'max-width')).toEqual([
      { important: true, property: 'max-width', value: '100%' }
    ]);
    expect(declaredStyleDeclarations(candidate, 'height')).toEqual([
      { important: true, property: 'height', value: 'auto' }
    ]);
    expect(candidate.getAttribute('style')).toContain('overflow-x:auto!important');
    expect(candidate.hasAttribute('data-ignore-width')).toBe(true);
  });

  it.each([
    { captureWidth: 200, rasterWidth: 240, expectedWidth: 200 },
    { captureWidth: 850, rasterWidth: 800, expectedWidth: 800 },
    { captureWidth: 1220, rasterWidth: 1220, expectedWidth: 1220 }
  ])('keeps an intrinsic Mermaid capture at its measured width without an upper cap', ({ captureWidth, rasterWidth, expectedWidth }) => {
    const { candidate, root, svg } = mermaidFixture();
    const completed: CompletedUpload = {
      autoMargins: false,
      candidate: { element: candidate, kind: 'mermaid', source: svg },
      captureSize: { height: 100, width: captureWidth },
      kind: 'mermaid',
      layoutMagnification: 1,
      mode: 'mermaid-intrinsic',
      rasterized: {
        file: new File(['png'], 'mermaid-intrinsic.png', { type: 'image/png' }),
        height: 100,
        pixelCount: rasterWidth * 100,
        width: rasterWidth
      },
      url: 'https://example.test/mermaid-intrinsic.png'
    };

    replaceCompletedVisuals(root, conversionContext(root), [completed]);

    const image = root.querySelector('img');
    if (!image) throw new Error('wechat-png-replacement-test-image-missing');
    expect(singleDeclarationValue(image, 'width')).toBe(`${expectedWidth}px`);
    expect(declaredStyleDeclarations(image, 'width')).toHaveLength(1);
    expect(declaredStyleDeclarations(image, 'max-width')).toEqual([
      { important: true, property: 'max-width', value: 'none' }
    ]);
    expect(declaredStyleDeclarations(image, 'max-width')).toHaveLength(1);
    expect(declaredStyleDeclarations(image, 'height')).toEqual([{ important: true, property: 'height', value: 'auto' }]);
    expect(declaredStyleDeclarations(image, 'height')).toHaveLength(1);
    expect(image.getAttribute('style')).toContain(`width:${expectedWidth}px!important`);
    expect(image.getAttribute('style')).not.toContain('max-width:100%');
    expect(declaredStyleDeclarations(candidate, 'width')).toEqual([
      { important: true, property: 'width', value: '100%' }
    ]);
    expect(declaredStyleDeclarations(candidate, 'max-width')).toEqual([
      { important: true, property: 'max-width', value: '100%' }
    ]);
    expect(declaredStyleDeclarations(candidate, 'height')).toEqual([{ important: true, property: 'height', value: 'auto' }]);
    expect(candidate.getAttribute('style')).toContain('overflow-x:auto!important');
    expect(candidate.hasAttribute('data-ignore-width')).toBe(true);
  });
});
