import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  installClipboardTestEnvironment,
  prepareClipboard
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
    const inspectPositive = async (htmlBlob: Blob | PromiseLike<Blob>, textBlob?: Blob | PromiseLike<Blob>): Promise<string> => {
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
    const inspectOriginal = async (
      htmlBlob: Blob | PromiseLike<Blob>,
      textBlob?: Blob | PromiseLike<Blob>
    ): Promise<void> => {
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

});
