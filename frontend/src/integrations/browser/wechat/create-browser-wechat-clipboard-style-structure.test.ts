import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  codeRows,
  computedStyle,
  declaredStyleDeclarations,
  declaration,
  installClipboardTestEnvironment,
  prepareClipboard,
  readyPreview,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('writes sanitized styled HTML and plain text through the modern Clipboard API', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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

  it('gives block media responsive bounds for capped, percentage, and auto widths', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Before</p><img src="https://example.test/chart.png" style="width:1200px!important;height:268px!important;max-width:332px!important"><video src="https://example.test/chart.mp4" style="width:332px!important;height:268px!important;max-width:none!important"></video><video src="https://example.test/auto-video.mp4" style="width:auto!important;height:268px!important;max-width:none!important"></video><video src="https://example.test/percentage-video.mp4" style="width:50%!important;height:268px!important;max-width:none!important"></video><img class="wide-inline" src="https://example.test/wide-inline.png" style="width:1200px!important;height:675px!important;max-width:none!important">';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Before\n' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
        if (pseudoElement) return declaration({});
        if (element.classList.contains('wide-inline')) {
          return declaration({
            display: 'inline-block',
            width: '1200px',
            height: '675px',
            'max-width': 'none',
            'box-sizing': 'border-box'
          });
        }
        if (
          'VIDEO' === element.tagName
          && ['https://example.test/auto-video.mp4', 'https://example.test/percentage-video.mp4'].includes(
            element.getAttribute('src') ?? ''
          )
        ) {
          return declaration({
            display: 'block',
            width: 'https://example.test/auto-video.mp4' === element.getAttribute('src') ? 'auto' : '50%',
            height: '268px',
            'max-width': 'none',
            'box-sizing': 'border-box'
          });
        }
        if ('IMG' === element.tagName || 'VIDEO' === element.tagName) {
          return declaration({
            display: 'block',
            width: 'IMG' === element.tagName ? '1200px' : '332px',
            height: '268px',
            'max-width': 'IMG' === element.tagName ? '332px' : 'none',
            'box-sizing': 'border-box'
          });
        }
        if ('P' === element.tagName) return declaration({ display: 'block' });
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
    const image = holder.querySelector('img');
    const video = holder.querySelector('video[src="https://example.test/chart.mp4"]');
    const autoVideo = holder.querySelector('video[src="https://example.test/auto-video.mp4"]');
    const percentageVideo = holder.querySelector('video[src="https://example.test/percentage-video.mp4"]');
    const wideInline = holder.querySelector('img[src="https://example.test/wide-inline.png"]');
    if (!image || !video || !autoVideo || !percentageVideo || !wideInline) throw new Error('clipboard media missing');
    const maxWidth = declaredStyleDeclarations(image, 'max-width');
    const height = declaredStyleDeclarations(image, 'height');
    const width = declaredStyleDeclarations(image, 'width');
    expect(width).toEqual([{ property: 'width', value: '332px', important: true }]);
    expect(maxWidth).toEqual([{ property: 'max-width', value: '100%', important: true }]);
    expect(height).toEqual([{ property: 'height', value: 'auto', important: true }]);
    expect(declaredStyleDeclarations(video, 'width')).toEqual([{ property: 'width', value: '332px', important: true }]);
    expect(declaredStyleDeclarations(video, 'max-width')).toEqual([{ property: 'max-width', value: '100%', important: true }]);
    expect(declaredStyleDeclarations(video, 'height')).toEqual([{ property: 'height', value: 'auto', important: true }]);
    expect(declaredStyleDeclarations(autoVideo, 'width')).toEqual([{ property: 'width', value: 'auto', important: false }]);
    expect(declaredStyleDeclarations(autoVideo, 'max-width')).toEqual([{ property: 'max-width', value: '100%', important: true }]);
    expect(declaredStyleDeclarations(autoVideo, 'height')).toEqual([{ property: 'height', value: 'auto', important: true }]);
    expect(declaredStyleDeclarations(percentageVideo, 'width')).toEqual([{ property: 'width', value: '50%', important: false }]);
    expect(declaredStyleDeclarations(percentageVideo, 'max-width')).toEqual([{ property: 'max-width', value: '100%', important: true }]);
    expect(declaredStyleDeclarations(percentageVideo, 'height')).toEqual([{ property: 'height', value: 'auto', important: true }]);
    expect(declaredStyleDeclarations(wideInline, 'width')).toEqual([{ property: 'width', value: '1200px', important: false }]);
    expect(declaredStyleDeclarations(wideInline, 'max-width')).toEqual([{ property: 'max-width', value: '100%', important: true }]);
    expect(declaredStyleDeclarations(wideInline, 'height')).toEqual([{ property: 'height', value: 'auto', important: true }]);
  });

  it('preserves inline icon width while adding responsive bounds', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Icon <img src="https://example.test/icon.png" style="width:16px!important;height:16px!important"></p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Icon' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
        if (pseudoElement) return declaration({});
        if ('IMG' === element.tagName) {
          return declaration({ display: 'inline', height: '16px', width: '16px' });
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
    const image = holder.querySelector('img');
    if (!image) throw new Error('clipboard inline image missing');
    expect(declaredStyleDeclarations(image, 'width')).toEqual([{ property: 'width', value: '16px', important: false }]);
    expect(declaredStyleDeclarations(image, 'max-width')).toEqual([{ property: 'max-width', value: '100%', important: true }]);
    expect(declaredStyleDeclarations(image, 'height')).toEqual([{ property: 'height', value: 'auto', important: true }]);
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
      expect(markers).toHaveLength(4);
      expect(markers.every((element) => element.getAttribute('data-ignore-width') === '')).toBe(true);
      expect(holder.querySelectorAll('section[data-ignore-width]')).toHaveLength(2);
      expect(holder.querySelectorAll('section[data-ignore-width] > table[data-ignore-width]')).toHaveLength(1);
      expect(holder.querySelectorAll('section[data-ignore-width] img')).toHaveLength(0);
      expect(holder.querySelectorAll('pre > code[data-ignore-width]')).toHaveLength(1);
      expect(holder.querySelectorAll('pre[data-ignore-width]')).toHaveLength(0);
      expect(holder.querySelectorAll('table[data-ignore-width]')).toHaveLength(1);
      expect(holder.querySelectorAll('code[data-ignore-width]')).toHaveLength(1);
      expect(holder.firstElementChild?.hasAttribute('data-ignore-width')).toBe(false);
      expect(holder.querySelector('[data-ignore-width="untrusted"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-table"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-math"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-pre"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-code"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-standalone-code"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-overflow"]')).toBeNull();
      const outputTable = holder.querySelector('table');
      if (!outputTable) throw new Error('clipboard table missing');
      expect(declaredStyleDeclarations(outputTable, 'width')).toEqual([
        { property: 'width', value: 'max-content', important: true }
      ]);
      expect(declaredStyleDeclarations(outputTable, 'max-width')).toEqual([
        { property: 'max-width', value: 'none', important: true }
      ]);
    };
    assertOwnedMarkers(modernHtml);

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        dispatchSuccessfulLegacyCopy();
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
        dispatchSuccessfulLegacyCopy();
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
    expect(declaredStyleDeclarations(holder.querySelector('img') as Element, 'max-width')).toContainEqual({
      property: 'max-width',
      value: '100%',
      important: true
    });
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


  it('normalizes WeChat structure, leaf text, unsafe URLs, and code overflow', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
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
      if ('::before' === pseudoElement || '::after' === pseudoElement)
        return computedStyle(element, pseudoElement);
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
        dispatchSuccessfulLegacyCopy();
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
      if ('::before' === pseudoElement || '::after' === pseudoElement)
        return computedStyle(element, pseudoElement);
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
        dispatchSuccessfulLegacyCopy();
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

  it('strips untrusted data-ignore-dm and marks only finalized non-SVG gradient surfaces across modern and legacy payloads', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.setAttribute('data-ignore-dm', 'untrusted-root');
    preview.innerHTML = [
      '<p class="plain" data-ignore-dm="untrusted-plain">Plain</p>',
      '<p class="linear" data-ignore-dm="untrusted-linear">Linear</p>',
      '<div class="radial">Radial</div>',
      '<div class="conic">Conic</div>',
      '<div class="repeating">Repeating</div>',
      '<svg class="svg-gradient" data-ignore-dm="untrusted-svg" viewBox="0 0 10 10"><rect width="10" height="10"></rect></svg>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Plain\nLinear\nRadial\nConic\nRepeating'
    });
    const gradientComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('::before' === pseudoElement || '::after' === pseudoElement)
        return computedStyle(element, pseudoElement);
      if (pseudoElement) return declaration({});
      if ('ARTICLE' === element.tagName) {
        return declaration({
          background: 'linear-gradient(180deg, rgb(255, 255, 255), rgb(248, 250, 252))',
          'background-image': 'linear-gradient(180deg, rgb(255, 255, 255), rgb(248, 250, 252))',
          display: 'block'
        });
      }
      if (element.classList.contains('plain')) {
        return declaration({
          'background-color': 'rgb(241, 245, 249)',
          'background-image': 'none',
          display: 'block'
        });
      }
      if (element.classList.contains('linear')) {
        return declaration({
          'background-image': 'linear-gradient(90deg, rgb(59, 130, 246), rgb(147, 51, 234))',
          display: 'block'
        });
      }
      if (element.classList.contains('radial')) {
        return declaration({
          background: 'radial-gradient(circle, rgb(254, 243, 199), rgb(253, 230, 138))',
          display: 'block'
        });
      }
      if (element.classList.contains('conic')) {
        return declaration({
          'background-image': 'conic-gradient(from 90deg, rgb(16, 185, 129), rgb(6, 182, 212))',
          display: 'block'
        });
      }
      if (element.classList.contains('repeating')) {
        return declaration({
          'background-image': 'repeating-linear-gradient(45deg, rgb(241, 245, 249) 0px, rgb(226, 232, 240) 8px)',
          display: 'block'
        });
      }
      if (element.classList.contains('svg-gradient')) {
        return declaration({
          'background-image': 'linear-gradient(90deg, rgb(1, 2, 3), rgb(4, 5, 6))',
          display: 'block'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const modernWrites: ClipboardItemStub[] = [];
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: gradientComputedStyle,
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
    if (!modernHtmlBlob) throw new Error('gradient modern payload missing');
    const modernHtml = await blobText(modernHtmlBlob);

    const assertGradientMarkers = (html: string): void => {
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const root = holder.firstElementChild;
      expect(root?.getAttribute('data-ignore-dm')).toBe('text-bg-gradient');
      const marked = [...holder.querySelectorAll('[data-ignore-dm]')];
      expect(marked).toHaveLength(5);
      expect(marked.every((element) => element.getAttribute('data-ignore-dm') === 'text-bg-gradient')).toBe(true);
      expect(holder.querySelector('[data-ignore-dm="untrusted-root"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-dm="untrusted-plain"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-dm="untrusted-linear"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-dm="untrusted-svg"]')).toBeNull();
      const paragraphs = holder.querySelectorAll('p');
      expect(paragraphs[0]?.hasAttribute('data-ignore-dm')).toBe(false);
      expect(paragraphs[1]?.getAttribute('data-ignore-dm')).toBe('text-bg-gradient');
      const svg = holder.querySelector('svg');
      expect(svg?.hasAttribute('data-ignore-dm')).toBe(false);
    };
    assertGradientMarkers(modernHtml);

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        dispatchSuccessfulLegacyCopy();
        return true;
      })
    });
    const legacy = createRuntime(null, null);
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    expect(legacyHtml).toBe(modernHtml);
    assertGradientMarkers(legacyHtml);
    expect(preview.innerHTML).toBe(sourceMarkup);
    expect(preview.getAttribute('data-ignore-dm')).toBe('untrusted-root');
  });

});
