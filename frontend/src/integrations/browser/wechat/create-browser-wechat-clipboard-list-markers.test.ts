import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  installClipboardTestEnvironment,
  prepareClipboard,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';
import { TASK_LIST_CHECKBOX_CLONES } from './wechat-clone-metadata';
import {
  TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES,
  TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS
} from './wechat-task-caption';
import { projectCompleteTaskListStructures } from './wechat-task-list-projection';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

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
            class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
                dispatchSuccessfulLegacyCopy();
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
          dispatchSuccessfulLegacyCopy();
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
      class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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


  it('keeps only eligible LI marker text leaves inline across Clipboard paths', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
      class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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

  it('projects complete task lists into destination-safe sections before Clipboard capture', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const markup = [
      '<ul class="task-list tight"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">Tight unchecked</li>',
      '<li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked>Tight checked</li></ul>',
      '<ul class="task-list loose"><li class="task-list-item"><p><input class="easymde-task-checkbox" type="checkbox" checked>Loose checked</p></li></ul>',
      '<ul class="plain-list"><li>Ordinary item</li></ul>',
      '<ul class="nested-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">Outer task<ul class="nested-ordinary"><li>Nested ordinary</li></ul></li></ul>'
    ].join('');
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = markup;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Tight unchecked\nTight checked\nLoose checked\nOrdinary item\nOuter task\nNested ordinary'
    });
    const sourceBeforeCopy = preview.innerHTML;
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('INPUT' === element.tagName) {
          return declaration({ appearance: 'none', display: 'inline-block', height: '12px', width: '12px' });
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
    if (!htmlBlob || !textBlob) throw new Error('task list structure payload missing');
    const html = await blobText(htmlBlob);
    const text = await blobText(textBlob);
    const holder = document.createElement('div');
    holder.innerHTML = html;

    // WeChat Save rebuilds `ul/ol` list markup with destination list semantics
    // (disc markers). A complete task list must therefore leave the clipboard
    // as block sections, so no task list or task item reaches the destination
    // as a list. Complete task items keep their materialized owners.
    const taskOwners = [...holder.querySelectorAll('[role="checkbox"]')];
    expect(taskOwners).toHaveLength(4);
    for (const owner of taskOwners) {
      expect(owner.closest('ul, ol'), `complete task owner ${owner.textContent}`).toBeNull();
      expect(owner.closest('li'), `complete task item ${owner.textContent}`).toBeNull();
      expect(owner.closest('section')).not.toBeNull();
    }
    // Complete task lists leave no list structure at all: no task list and no
    // task item can be rebuilt by the destination list importer.
    expect(holder.querySelector('[role="checkbox"]')?.closest('ul, ol')).toBeNull();
    expect([...holder.querySelectorAll('li')].filter((li) => li.classList.contains('task-list-item')))
      .toHaveLength(0);
    expect(holder.querySelector('ul.task-list, ol.task-list, ul > section, ol > section')).toBeNull();
    // Ordinary lists stay ordinary lists, including a nested list inside a
    // projected task section, because the move keeps valid block structure.
    const remainingLists = [...holder.querySelectorAll('ul, ol')];
    expect(remainingLists).toHaveLength(2);
    expect(remainingLists[0]?.querySelector('li')?.textContent).toBe('Ordinary item');
    expect(remainingLists[1]?.closest('section')).not.toBeNull();
    expect(remainingLists[1]?.querySelector('li')?.textContent).toBe('Nested ordinary');
    expect(text).toContain('Tight unchecked');
    expect(text).toContain('Tight checked');
    expect(text).toContain('Loose checked');
    expect(text).toContain('Ordinary item');
    expect(text).toContain('Outer task');
    expect(text).toContain('Nested ordinary');
    // The live Preview source stays untouched by serialization.
    expect(preview.innerHTML).toBe(sourceBeforeCopy);
  });

  it('keeps clone identity and caption structure resolution when a task list projects to sections', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input type="checkbox" checked>Item</li></ul>';
    const list = root.querySelector('ul');
    const item = root.querySelector('li');
    const input = root.querySelector('input');
    if (!list || !item || !input) throw new Error('projection fixture unavailable');
    TASK_LIST_CHECKBOX_CLONES.add(input);
    TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES.add(item);
    TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES.add(list);

    projectCompleteTaskListStructures(root);

    expect(root.querySelector('ul')).toBeNull();
    expect(root.querySelector('li')).toBeNull();
    expect([...root.querySelectorAll('section')]).toHaveLength(2);
    // The cloned checkbox owner keeps its identity; only the list containers
    // are projected, so every WeakSet/WeakMap registration stays valid.
    expect(root.querySelector('input')).toBe(input);
    expect(root.contains(input)).toBe(true);
    const listSection = TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS.get(list);
    const itemSection = TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS.get(item);
    expect(listSection?.tagName).toBe('SECTION');
    expect(itemSection?.tagName).toBe('SECTION');
    expect(listSection?.contains(input)).toBe(true);
    expect(itemSection?.contains(input)).toBe(true);
    expect(listSection?.getAttribute('class')).toBe('task-list');
    expect(itemSection?.getAttribute('class')).toBe('task-list-item');
  });

  it('keeps a mixed task and ordinary list unprojected instead of emitting invalid structure', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input type="checkbox">Task</li><li>Ordinary</li></ul>';
    const input = root.querySelector('input');
    if (!input) throw new Error('mixed projection fixture unavailable');
    TASK_LIST_CHECKBOX_CLONES.add(input);

    // Mixed lists have no single lossless destination structure yet, so the
    // projection leaves them untouched: the copy stays legal and no
    // `ul > section` shape can reach the Clipboard payload.
    projectCompleteTaskListStructures(root);
    expect(root.querySelector('ul')?.children).toHaveLength(2);
    expect(root.querySelector('ul > section, ol > section')).toBeNull();
    expect(root.querySelectorAll('section')).toHaveLength(0);
    expect(root.querySelector('li.task-list-item')?.parentElement?.tagName).toBe('UL');
    expect(root.querySelector('input')).toBe(input);
  });

  it('keeps an ordered task list start, reversed, and value attributes through projection', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<ol class="task-list" start="4" reversed><li class="task-list-item" value="7"><input type="checkbox">Ordered task</li></ol>';
    const input = root.querySelector('input');
    if (!input) throw new Error('ordered projection fixture unavailable');
    TASK_LIST_CHECKBOX_CLONES.add(input);

    projectCompleteTaskListStructures(root);

    const listSection = root.firstElementChild;
    const itemSection = listSection?.firstElementChild;
    expect(listSection?.tagName).toBe('SECTION');
    expect(itemSection?.tagName).toBe('SECTION');
    expect(listSection?.getAttribute('start')).toBe('4');
    expect(listSection?.hasAttribute('reversed')).toBe(true);
    expect(itemSection?.getAttribute('value')).toBe('7');
  });

});
