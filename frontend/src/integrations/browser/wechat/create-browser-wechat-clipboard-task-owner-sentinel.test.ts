import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  declaredStylePixels,
  declaredStyleValue,
  installClipboardTestEnvironment,
  prepareClipboard,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

/**
 * Native WeChat drops a completely empty task owner span on import, so an
 * unchecked owner whose paint is element-level only (background/border with no
 * pseudo layer) would lose its box. These focused tests pin the U+2060 word
 * joiner transport glyph that keeps the owner, its geometry, its ARIA state,
 * the checked paint,
 * the plain-text payload, repeated serialization, and the modern/legacy paths.
 */
describe('createBrowserWechatClipboard task owner sentinel', () => {
  installClipboardTestEnvironment();

  const layoutInnerText = (): (() => void) => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        // jsdom cannot lay text out. The measurement host is the only clone
        // connected during plain-text extraction, so report one line per
        // projected task structure the way a layout-capable browser would.
        if ('fixed' === this.parentElement?.style.position) {
          const taskItems = Array.from(this.querySelectorAll(':scope > section > section'));
          if (taskItems.length) return taskItems.map((item) => item.textContent ?? '').join('\n');
        }
        return this.textContent ?? '';
      }
    });
    return () => {
      if (original) Object.defineProperty(HTMLElement.prototype, 'innerText', original);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
    };
  };

  const installTaskLayoutProbe = (): (() => void) => {
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({
        bottom: top + height,
        height,
        left,
        right: left + width,
        top,
        width,
        x: left,
        y: top
      }) as DOMRect;
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('.task-owner-workspace')) return rect(0, 0, 400, 160);
        if ('ARTICLE' === this.tagName || ('UL' === this.tagName && this.classList.contains('task-list'))) {
          return rect(0, 0, 300, 120);
        }
        if ('SECTION' === this.tagName) return rect(80, 80, 300, 40);
        if (this.matches('input.easymde-task-checkbox')) return rect(58, 83, 20, 20);
        if (this.matches('li.task-list-item')) return rect(100, 90, 300, 40);
        if (this.matches('span[inert]')) {
          const parent = this.parentElement;
          const children = parent ? [...parent.children] : [];
          const index = children.indexOf(this);
          const left = 0 === index ? 100 : 116;
          return rect(left, 116, 0, 0);
        }
        return originalRect?.value?.call(this) ?? rect(0, 0, 0, 0);
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: (): DOMRect[] => [rect(116, 102, 56, 16)]
    });
    return () => {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    };
  };

  const expectStaticAllocation = (
    element: HTMLElement,
    captured: Readonly<{ height: number; left: number; top: number; width: number }>
  ): void => {
    expect(declaredStyleValue(element, 'position')).toBe('static');
    expect(declaredStyleValue(element, 'float')).toBe('left');
    ['top', 'right', 'bottom', 'left'].forEach((side) => {
      expect(declaredStyleValue(element, side)).toBe('auto');
    });
    expect(declaredStylePixels(element, 'width')).toBeCloseTo(captured.width, 6);
    expect(declaredStylePixels(element, 'height')).toBeCloseTo(captured.height, 6);
    expect(declaredStylePixels(element, 'margin-left')).toBeCloseTo(captured.left, 6);
    expect(declaredStylePixels(element, 'margin-top')).toBeCloseTo(captured.top, 6);
    expect(declaredStylePixels(element, 'margin-right')).toBeCloseTo(-(captured.left + captured.width), 6);
    expect(declaredStylePixels(element, 'margin-bottom')).toBeCloseTo(-(captured.top + captured.height), 6);
  };

  it('keeps the empty unchecked owner non-empty without leaking the sentinel', async () => {
    const restoreInnerText = layoutInnerText();
    const restoreLayoutProbe = installTaskLayoutProbe();
    const modernWrites: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const workspace = document.createElement('div');
    workspace.className = 'task-owner-workspace';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<ul class="task-list">',
      // The unchecked owner paints through its own background and border and
      // has no pseudo layer, so it reaches the destination as an empty span.
      '<li class="task-list-item"><section><input class="easymde-task-checkbox" type="checkbox">Open task</section></li>',
      // The checked owner keeps its captured pseudo layers untouched.
      '<li class="task-list-item"><section><input class="easymde-task-checkbox" type="checkbox" checked>Done task</section></li>',
      '</ul>'
    ].join('');
    workspace.append(preview);
    document.body.append(workspace);
    const sourceMarkup = preview.innerHTML;
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('INPUT' === element.tagName) {
        const checked = (element as HTMLInputElement).checked;
        if ('::before' === pseudoElement) {
          if (!checked) return declaration({ content: 'none' });
          return declaration({
            'background-color': 'rgb(255, 255, 255)',
            'border-bottom-width': '1px',
            'border-left-width': '1px',
            'border-radius': '50%',
            'border-right-width': '1px',
            'border-top-width': '1px',
            'box-sizing': 'border-box',
            content: '""',
            display: 'block',
            height: '16px',
            left: '18px',
            'margin-bottom': '0px',
            'margin-left': '0px',
            'margin-right': '0px',
            'margin-top': '0px',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            position: 'absolute',
            top: '-2px',
            width: '16px'
          });
        }
        if ('::after' === pseudoElement) {
          if (!checked) return declaration({ content: 'none' });
          return declaration({
            'border-bottom-color': 'rgb(255, 255, 255)',
            'border-bottom-style': 'solid',
            'border-bottom-width': '2px',
            'border-right-color': 'rgb(255, 255, 255)',
            'border-right-style': 'solid',
            'border-right-width': '2px',
            'box-sizing': 'content-box',
            content: '""',
            display: 'block',
            height: '10px',
            left: '27.6px',
            'margin-bottom': '0px',
            'margin-left': '0px',
            'margin-right': '0px',
            'margin-top': '0px',
            opacity: '1',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            position: 'absolute',
            top: '8px',
            width: '6px'
          });
        }
        return declaration({
          appearance: 'none',
          'background-color': 'rgb(255, 255, 255)',
          'border-bottom-color': 'rgb(41, 128, 185)',
          'border-bottom-style': 'solid',
          'border-bottom-width': '1px',
          'border-left-color': 'rgb(41, 128, 185)',
          'border-left-style': 'solid',
          'border-left-width': '1px',
          'border-right-color': 'rgb(41, 128, 185)',
          'border-right-style': 'solid',
          'border-right-width': '1px',
          'border-top-color': 'rgb(41, 128, 185)',
          'border-top-style': 'solid',
          'border-top-width': '1px',
          'box-sizing': 'border-box',
          color: 'transparent',
          display: 'inline-block',
          'font-size': '13px',
          height: '20px',
          left: '-22px',
          'margin-bottom': '0px',
          'margin-left': '0px',
          'margin-right': '0px',
          'margin-top': '0px',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          position: 'absolute',
          top: '3px',
          width: '20px'
        });
      }
      if ('UL' === element.tagName) return declaration({ display: 'block', 'list-style-type': 'disc' });
      if ('LI' === element.tagName) {
        return declaration({
          display: 'block',
          'list-style-type': 'disc',
          'margin-bottom': '0px',
          'margin-left': '0px',
          'margin-right': '0px',
          'margin-top': '0px',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          position: 'relative'
        });
      }
      if ('SECTION' === element.tagName) {
        return declaration({
          display: 'block',
          'margin-bottom': '0px',
          'margin-left': '0px',
          'margin-right': '0px',
          'margin-top': '0px',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          position: 'static'
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
        modernWrites.push(items);
      }
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const firstItem = (modernWrites[0] as ClipboardItemStub[])[0];
      const htmlBlob = firstItem?.payload['text/html'];
      const textBlob = firstItem?.payload['text/plain'];
      if (!htmlBlob) throw new Error('task owner payload missing');
      if (!textBlob) throw new Error('task owner plain payload missing');
      const firstHtml = await blobText(htmlBlob);
      const firstText = await blobText(textBlob);
      // The glyph may live only in the HTML payload.
      expect(firstText).toBe('Open task\nDone task');
      expect(firstText).not.toContain('x');
      expect(firstText).not.toContain('\u2060');
      // The same blob stays byte-identical when the payload is read twice.
      await expect(blobText(htmlBlob)).resolves.toBe(firstHtml);

      const holder = document.createElement('div');
      holder.innerHTML = firstHtml;
      const owners = [...holder.querySelectorAll<HTMLElement>('[role="checkbox"]')];
      expect(owners).toHaveLength(2);
      expect(owners.map((owner) => owner.getAttribute('aria-checked'))).toEqual(['false', 'true']);
      expect(owners.every((owner) => owner.getAttribute('aria-disabled') === 'true')).toBe(true);
      const [uncheckedOwner, checkedOwner] = owners;
      if (!uncheckedOwner || !checkedOwner) throw new Error('task owners missing');
      // The unchecked owner keeps its ARIA state, keeps its element-level paint
      // and now carries exactly one U+2060 transport glyph inside an unstyled
      // carrier that cannot contribute a visible glyph to the owner's box.
      expect(uncheckedOwner.getAttribute('style')).toContain('background-color:rgb(255, 255, 255)');
      expect(uncheckedOwner.getAttribute('style')).toContain('border-top-color:rgb(41, 128, 185)');
      expect(uncheckedOwner.childNodes).toHaveLength(1);
      const uncheckedCarrier = uncheckedOwner.firstElementChild as HTMLElement | null;
      expect(uncheckedCarrier?.tagName).toBe('SPAN');
      expect(uncheckedCarrier?.getAttribute('aria-hidden')).toBe('true');
      expect(uncheckedCarrier?.getAttribute('style')).toBeNull();
      expect(uncheckedCarrier?.childNodes).toHaveLength(1);
      expect(uncheckedCarrier?.textContent).toBe('\u2060');
      expect(uncheckedOwner.textContent).toBe('\u2060');
      // The invisible transport glyph keeps the settled owner allocation
      // unchanged so it matches the captured geometry exactly.
      expectStaticAllocation(uncheckedOwner, { height: 20, left: -22, top: 3, width: 20 });
      // The checked owner keeps its captured paint layers, and each paint-only
      // layer holds the U+2060 transport inside its own span instead of an
      // empty paint span plus a sibling carrier.
      const checkedSpans = [...checkedOwner.querySelectorAll<HTMLElement>(':scope > span[aria-hidden="true"]')];
      expect(checkedSpans).toHaveLength(2);
      expect(checkedSpans.every((marker) => Boolean(marker.getAttribute('style')?.trim()))).toBe(true);
      expect(checkedSpans.every((marker) => marker.textContent === '\u2060')).toBe(true);
      expect(Array.from(checkedOwner.childNodes).every((node) => node.nodeType === 1)).toBe(true);
      expectStaticAllocation(checkedOwner, { height: 20, left: -22, top: 3, width: 20 });
      expectStaticAllocation(checkedSpans[0] as HTMLElement, { height: 16, left: 18, top: -2, width: 16 });
      expectStaticAllocation(checkedSpans[1] as HTMLElement, { height: 12, left: 27.6, top: 8, width: 8 });
      expect(firstHtml).toContain('<span aria-hidden="true">\u2060</span>');
      expect(firstHtml).not.toContain('<span aria-hidden="true">x</span>');
      expect(firstHtml).not.toContain('style="font-size:0"');
      expect(firstHtml).not.toContain('line-height:0');
      expect(firstHtml).not.toContain('✓');
      expect(preview.innerHTML).toBe(sourceMarkup);

      // Repeated serialization must reproduce the same payload instead of
      // dropping the transport glyph or duplicating it.
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const secondItem = (modernWrites[1] as ClipboardItemStub[])[0];
      const secondHtmlBlob = secondItem?.payload['text/html'];
      const secondTextBlob = secondItem?.payload['text/plain'];
      if (!secondHtmlBlob) throw new Error('second task owner payload missing');
      if (!secondTextBlob) throw new Error('second task owner plain payload missing');
      const secondHtml = await blobText(secondHtmlBlob);
      expect(secondHtml).toBe(firstHtml);
      await expect(blobText(secondTextBlob)).resolves.toBe(firstText);
      const secondHolder = document.createElement('div');
      secondHolder.innerHTML = secondHtml;
      const secondOwners = [...secondHolder.querySelectorAll<HTMLElement>('[role="checkbox"]')];
      expect(secondOwners[0]?.childNodes).toHaveLength(1);
      expect(secondOwners[0]?.firstElementChild?.getAttribute('style')).toBeNull();
      expect(secondOwners[0]?.textContent).toBe('\u2060');

      let legacyHtml = '';
      let legacyClipboardHtml = '';
      let legacyClipboardText = '';
      const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => {
          legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
          const event = new Event('copy', { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'clipboardData', {
            configurable: true,
            value: {
              setData(type: string, value: string): void {
                if ('text/html' === type) legacyClipboardHtml = value;
                if ('text/plain' === type) legacyClipboardText = value;
              }
            }
          });
          document.dispatchEvent(event);
          dispatchSuccessfulLegacyCopy();
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
      expect(legacyClipboardHtml).toBe(legacyHtml);
      expect(legacyClipboardText).toBe(firstText);
      expect(legacyClipboardText).not.toContain('x');
      const legacyHolder = document.createElement('div');
      legacyHolder.innerHTML = legacyHtml;
      const legacyOwners = [...legacyHolder.querySelectorAll<HTMLElement>('[role="checkbox"]')];
      expect(legacyOwners).toHaveLength(2);
      expect(legacyOwners[0]?.getAttribute('aria-checked')).toBe('false');
      expect(legacyOwners[0]?.textContent).toBe('\u2060');
      expect(legacyOwners[0]?.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
      expect(legacyOwners[0]?.firstElementChild?.getAttribute('style')).toBeNull();
      // The checked owner keeps its painted marker layers and each paint-only
      // layer owns its in-span U+2060 transport; the unchecked owner retains its
      // separate owner-level carrier.
      expect(Array.from(legacyOwners[1]?.childNodes ?? []).every((node) => node.nodeType === 1)).toBe(true);
    } finally {
      restoreLayoutProbe();
      restoreInnerText();
    }
  });

  it('leaves an unchecked owner that already carries painted layers untouched', async () => {
    const restoreInnerText = layoutInnerText();
    const restoreLayoutProbe = installTaskLayoutProbe();
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const workspace = document.createElement('div');
    workspace.className = 'task-owner-workspace';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    // This owner paints through a captured pseudo layer, so it is already
    // non-empty for the destination and must not receive a second sentinel.
    preview.innerHTML = [
      '<ul class="task-list">',
      '<li class="task-list-item"><section><input class="easymde-task-checkbox" type="checkbox">Painted open task</section></li>',
      '</ul>'
    ].join('');
    workspace.append(preview);
    document.body.append(workspace);
    const sourceMarkup = preview.innerHTML;
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('INPUT' === element.tagName) {
        if ('::before' === pseudoElement) {
          return declaration({
            'background-color': 'rgb(255, 255, 255)',
            'border-bottom-width': '1px',
            'border-left-width': '1px',
            'border-radius': '50%',
            'border-right-width': '1px',
            'border-top-width': '1px',
            'box-sizing': 'border-box',
            content: '""',
            display: 'block',
            height: '16px',
            left: '18px',
            'margin-bottom': '0px',
            'margin-left': '0px',
            'margin-right': '0px',
            'margin-top': '0px',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            position: 'absolute',
            top: '-2px',
            width: '16px'
          });
        }
        if ('::after' === pseudoElement) return declaration({ content: 'none' });
        return declaration({
          appearance: 'none',
          'box-sizing': 'border-box',
          color: 'transparent',
          display: 'inline-block',
          'font-size': '13px',
          height: '20px',
          left: '-22px',
          'margin-bottom': '0px',
          'margin-left': '0px',
          'margin-right': '0px',
          'margin-top': '0px',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          position: 'absolute',
          top: '3px',
          width: '20px'
        });
      }
      if ('UL' === element.tagName) return declaration({ display: 'block', 'list-style-type': 'disc' });
      if ('LI' === element.tagName) {
        return declaration({
          display: 'block',
          'list-style-type': 'disc',
          'margin-bottom': '0px',
          'margin-left': '0px',
          'margin-right': '0px',
          'margin-top': '0px',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          position: 'relative'
        });
      }
      if ('SECTION' === element.tagName) {
        return declaration({
          display: 'block',
          'margin-bottom': '0px',
          'margin-left': '0px',
          'margin-right': '0px',
          'margin-top': '0px',
          'padding-bottom': '0px',
          'padding-left': '0px',
          'padding-right': '0px',
          'padding-top': '0px',
          position: 'static'
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
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      const textBlob = item?.payload['text/plain'];
      if (!htmlBlob) throw new Error('painted owner payload missing');
      if (!textBlob) throw new Error('painted owner plain payload missing');
      const html = await blobText(htmlBlob);
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const owner = holder.querySelector<HTMLElement>('[role="checkbox"]');
      if (!owner) throw new Error('painted owner missing');
      const directSpans = [...owner.querySelectorAll<HTMLElement>(':scope > span[aria-hidden="true"]')];
      const markers = directSpans.filter((marker) => Boolean(marker.getAttribute('style')?.trim()));
      const carriers = directSpans.filter((carrier) => !carrier.getAttribute('style')?.trim());
      // The captured paint layer owns the transport glyph itself, so it stays
      // non-empty without a second element that could change marker geometry.
      expect(markers).toHaveLength(1);
      expect(carriers).toHaveLength(0);
      expect(owner.childElementCount).toBe(1);
      expect(owner.childNodes).toHaveLength(1);
      expect(markers[0]?.textContent).toBe('\u2060');
      const markerStyle = markers[0]?.getAttribute('style') ?? '';
      expect(markerStyle).not.toMatch(/(?:^|;)font-size:0(?:;|$)/u);
      expect(markerStyle).not.toMatch(/(?:^|;)line-height:0(?:;|$)/u);
      expect(html.match(/>\u2060</gu)).toHaveLength(1);
      expect(await blobText(textBlob)).toBe('Painted open task');
      expect(preview.innerHTML).toBe(sourceMarkup);

      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const repeatedItem = (writes[1] as ClipboardItemStub[])[0];
      const repeatedBlob = repeatedItem?.payload['text/html'];
      if (!repeatedBlob) throw new Error('repeated painted owner payload missing');
      expect(await blobText(repeatedBlob)).toBe(html);
    } finally {
      restoreLayoutProbe();
      restoreInnerText();
    }
  });
});
