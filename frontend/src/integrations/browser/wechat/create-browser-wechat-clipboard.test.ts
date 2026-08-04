// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WechatClipboardPreparationOptions } from '../../../contracts/ports/wechat-clipboard-port';
import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

function readyPreview(): HTMLElement {
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', 'true');
  preview.innerHTML = '<p id="private-id" class="theme-class" data-easymde-rendered="1">Rendered</p><script>bad()</script><style>.bad{}</style>';
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

async function blobText(value: Blob | PromiseLike<Blob>): Promise<string> {
  return (await value).text();
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
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

describe('createBrowserWechatClipboard', () => {
  const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

  afterEach(() => {
    document.querySelectorAll('.easymde-copy-sandbox').forEach((element) => {
      element.remove();
    });
    if (originalExecCommand) {
      Object.defineProperty(document, 'execCommand', originalExecCommand);
    } else {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it('rejects pending, failed, or empty preview surfaces before touching Clipboard', async () => {
    const write = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write,
      pageOffset: () => ({ x: 0, y: 0 })
    });
    const preview = readyPreview();
    preview.setAttribute('data-easymde-preview-refreshing', '1');

    await expect(clipboard.copy(preview)).resolves.toEqual({
      code: 'wechat-preview-unavailable',
      status: 'failed'
    });
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
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(readyPreview())).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
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
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const textBlob = item?.payload['text/plain'];
    if (!textBlob) throw new Error('clipboard text missing');
    expect(await blobText(textBlob)).toBe(
      'First paragraph\n\nSecond paragraph\n\nA\nB'
    );
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
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 312 })
    });
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
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
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
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Hidden Preview text'
    });
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
      write: async (items) => { writes.push(items); }
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      previewVisible = false;
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
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
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
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
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => element === preview
        ? declaration(values)
        : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
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
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Article title\nSection heading\nBold italic link inline()' });
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
      write: async (items) => { writes.push(items); },
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
    expect(holder.querySelector('h1 > span[aria-hidden="true"]')?.getAttribute('style'))
      .toContain('font-size:0');
    expect(holder.querySelector('h1 > span[aria-hidden="true"]')?.getAttribute('style'))
      .toContain('background-image:linear-gradient(135deg, rgb(1, 2, 3), transparent)');
    expect(holder.querySelector('h2 > span[aria-hidden="true"]')?.textContent).toBe('Chapter');
    expect(holder.querySelector('h2 > span[aria-hidden="true"]')?.getAttribute('style'))
      .toContain('background-image:linear-gradient(135deg, rgb(1, 2, 3), transparent)');
    expect(holder.querySelector('h2 > span[aria-hidden="true"]')?.getAttribute('style'))
      .toContain('border-right-color:rgba(0, 0, 0, 0)');
    expect(holder.querySelector('strong')?.textContent).toBe('Bold');
    expect(holder.querySelector('em')?.textContent).toBe('italic');
    expect(holder.querySelector('a')?.getAttribute('href')).toBe('https://example.test/link');
    expect(holder.querySelector('blockquote')?.textContent).toBe('Quoted text');
    expect(holder.querySelectorAll('ul > li')).toHaveLength(2);
    expect(holder.querySelectorAll('ol > li')).toHaveLength(1);
    expect(holder.querySelector('table th')?.textContent).toBe('Header');
    expect(holder.querySelector('table td')?.textContent).toBe('Cell');
    expect(holder.querySelector('figure')?.getAttribute('style')).toContain('display:flex');
    expect(holder.querySelector('img')?.getAttribute('alt')).toBe('Synthetic image');
    expect(holder.querySelector('img')?.getAttribute('style')).toContain('max-width:100%');
    expect(holder.querySelector('pre code')?.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toContain('const value = 1;');
    expect(holder.querySelector('button')).toBeNull();
    expect(html).not.toContain('data-easymde-');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('unsafe.example');
    expect(html).not.toContain('id=');
    expect(text).not.toContain('Copy');
    expect(html).not.toContain('Hidden internal placeholder');
    expect(text).toContain('Article title');
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
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
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
      write: async (items) => { writes.push(items); },
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
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('src'))
      .toMatch(/^data:image\/png;base64,/);
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('style'))
      .toContain('width:100%');
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('style'))
      .toContain('height:100%');
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('style'))
      .not.toContain('height:auto');
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
      fetch: vi.fn(async () => ({
        ok: true,
        url: 'https://cdn.example.test/assets/images/cupid-busy-heart.png',
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
      } as unknown as Response)),
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
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
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
      write: async (items) => { writes.push(items); },
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
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
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
      write: async (items) => { writes.push(items); },
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
    expect(heading?.querySelector(':scope > img')?.getAttribute('src'))
      .toMatch(/^data:image\/png;base64,/);
    expect(heading?.querySelector(':scope > img')?.getAttribute('style'))
      .toContain('width:20px');
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
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
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
      write: async (items) => { writes.push(items); },
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
    expect(heading?.querySelector(':scope > img')?.getAttribute('src'))
      .toMatch(/^data:image\/png;base64,/);
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
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
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
      write: async (items) => { writes.push(items); },
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
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
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
      write: async (items) => { writes.push(items); },
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
    expect(heading?.querySelector(':scope > img')?.getAttribute('src'))
      .toMatch(/^data:image\/png;base64,/);
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
      write: async (items) => { writes.push(items); },
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
    const fetch = vi.fn(async (value: RequestInfo | URL) => ({
      ok: true,
      blob: async () => new window.Blob([String(value)], { type: 'image/png' })
    } as unknown as Response));
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
      write: async (items) => { writes.push(items); },
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
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
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
      write: async (items) => { writes.push(items); },
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
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
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
      write: async (items) => { writes.push(items); },
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
      async () => ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
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
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Left offset Top offset'
    });
    const imageUrl = new URL('/assets/images/theme.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({
          ok: true,
          blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
        }) as unknown as Response
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

    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
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
      async () => ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
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
      async () => ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
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
      write: async (items) => { writes.push(items); },
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
      async () => ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
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
      write: async (items) => { writes.push(items); },
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
      async () => ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
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
      write: async (items) => { writes.push(items); },
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
      async () => ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
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
      write: async (items) => { writes.push(items); },
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
      write: async (items) => { writes.push(items); },
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

  it('starts the Clipboard write while a theme image is still pending activation', async () => {
    let activation = true;
    let activationAtWrite = false;
    const pendingImage = deferred<Response>();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const writes: unknown[] = [];
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
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
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
      await expect(clipboard.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(execCommand).not.toHaveBeenCalled();

      pendingImage.resolve({
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await preparation;
      activation = true;
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
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

      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(legacyHtml).not.toContain('data:image/');

      pendingImage.resolve({
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await refresh;
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
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
    void fetchStartedB.promise.then(() => { secondStarted = true; });
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
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
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
      write: vi.fn(() => { throw new Error('clipboard-write-setup-failed'); })
    });

    try {
      await prepareClipboard(clipboard, preview);
      includeDecoration = true;
      const refresh = prepareClipboard(clipboard, preview);

      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
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

      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
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

      pendingB.resolve({ blob: async () => new window.Blob(['theme image B'], { type: 'image/png' }), ok: true } as unknown as Response);
      await refreshB;
      pendingA.resolve({ blob: async () => new window.Blob(['theme image A'], { type: 'image/png' }), ok: true } as unknown as Response);
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
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
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
      await expect(clipboard.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
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

    await expect(prepareClipboard(clipboard, preview)).rejects.toThrow(
      'wechat-theme-image-fetch-failed'
    );
    await expect(clipboard.copy(preview)).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    await retryFetchStarted.promise;
    await vi.waitFor(async () => {
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
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
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['not an image'], { type: 'text/plain' })
    } as unknown as Response));
    const write = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
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

    await expect(prepareClipboard(clipboard, preview))
      .rejects.toThrow('wechat-theme-image-response-invalid');
    expect(fetch).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it('does not start legacy serialization before preview preparation', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
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
      await expect(clipboard.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
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
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async () => { throw new Error('denied'); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await expect(clipboard.copy(readyPreview())).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('uses a prepared legacy payload when modern Clipboard setup throws synchronously', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    const write = vi.fn(() => {
      throw new Error('clipboard-write-setup-failed');
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
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
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
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

  it('reports deferred payload failure even when modern write resolves first', async () => {
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(async () => ({
      ok: false,
      blob: async () => new window.Blob([], { type: 'image/png' })
    } as unknown as Response));
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
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

    await expect(clipboard.copy(preview)).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
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
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false)
    });
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

    await expect(clipboard.copy(preview)).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(2);
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
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '公众号标题\n正文 重点 危险链接\n安全链接\nconst value = 1;' });
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
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const html = await blobText(htmlBlob);
    const holder = document.createElement('div');
    holder.innerHTML = html;
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
    expect(holder.querySelector('pre > code')?.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toContain(longLine);
    const longLineWrapper = [...holder.querySelectorAll('pre > code > nobr')]
      .find((element) => element.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' ').includes(longLine));
    expect(longLineWrapper?.getAttribute('style')).toContain('display:inline-block');
    expect(longLineWrapper?.getAttribute('style')).toContain('width:max-content');
    expect(longLineWrapper?.getAttribute('style')).toContain('min-width:max-content');
    expect(longLineWrapper?.getAttribute('style')).toContain('white-space:nowrap');
    expect(longLineWrapper?.getAttribute('style')).toContain('word-break:keep-all');
    expect(longLineWrapper?.getAttribute('style')).toContain('max-width:none!important');
    expect(longLineWrapper?.getAttribute('style')).toContain('white-space:nowrap!important');
    expect(holder.querySelector('pre > code span[leaf]')?.getAttribute('style'))
      .toContain('white-space:pre');
    expect(holder.querySelector('pre > code span[leaf]')?.getAttribute('style'))
      .toContain('white-space:pre!important');
    expect(holder.querySelectorAll('pre > code br')).toHaveLength(1);
    expect(holder.querySelector('pre > span[aria-hidden="true"]')?.getAttribute('style')).toContain('margin:-22px 0 10px 14px');
    expect(holder.querySelector('pre > span[aria-hidden="true"]')?.getAttribute('style')).toContain('box-shadow:rgb(255, 189, 46) 20px 0 0, rgb(39, 201, 63) 40px 0 0');
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
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const code = holder.querySelector('pre > code');
    const line = code?.querySelector(':scope > nobr');
    const serialized = code
      ? Array.from(code.childNodes).map((node) => 'BR' === (node as Element).tagName ? '\n' : node.textContent ?? '').join('')
      : '';
    expect(serialized.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toBe(source);
    expect(code?.querySelectorAll(':scope > br')).toHaveLength(1);
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
    preview.innerHTML = '<pre><code><span class="hljs-comment">/* first line\nsecond line */</span>\n<span class="hljs-keyword">const</span> value = 1;</code></pre>';
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
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const code = holder.querySelector('pre > code');
    const lines = code ? Array.from(code.querySelectorAll(':scope > nobr')) : [];
    const serialized = code
      ? Array.from(code.childNodes).map((node) => 'BR' === (node as Element).tagName ? '\n' : node.textContent ?? '').join('')
      : '';
    expect(serialized.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toBe(source);
    expect(lines).toHaveLength(3);
    expect(code?.querySelectorAll(':scope > br')).toHaveLength(2);
    expect(code?.querySelectorAll('span br')).toHaveLength(0);
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
    preview.innerHTML = '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
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
      write: async (items) => { writes.push(items); },
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

  it('preserves block table scroll ownership from article themes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
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
      write: async (items) => { writes.push(items); }
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
    preview.innerHTML = '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
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
      write: async (items) => { writes.push(items); }
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

  it('reuses visible full-width table geometry while the Preview pane is hidden', async () => {
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
    const rect = () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      toJSON: () => ({}),
      top: 0,
      width: paneHidden ? 0 : 300,
      x: 0,
      y: 0
    });
    Object.defineProperty(preview, 'getBoundingClientRect', { configurable: true, value: rect });
    Object.defineProperty(table, 'getBoundingClientRect', { configurable: true, value: rect });
    pane.appendChild(preview);
    document.body.appendChild(pane);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if (element === pane) return declaration({ display: paneHidden ? 'none' : 'block' });
        if (element === table) return declaration({ display: 'table', width: 'auto' });
        if ('TBODY' === element.tagName) return declaration({ display: 'table-row-group' });
        if ('TR' === element.tagName) return declaration({ display: 'table-row' });
        if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      paneHidden = true;
      // A hidden SafePreviewHtmlSink refresh replaces innerHTML, so the
      // second copy must reuse the root-level classification rather than the
      // old table element's WeakMap entry.
      preview.innerHTML = '<table><tbody><tr><td>Cell</td></tr></tbody></table>';
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const secondItem = (writes[1] as ClipboardItemStub[])[0];
      const htmlBlob = secondItem?.payload['text/html'];
      if (!htmlBlob) throw new Error('clipboard html missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(await htmlBlob);
      const tableStyle = holder.querySelector('table')?.getAttribute('style') ?? '';
      expect(tableStyle).toContain('width:100%!important');
      expect(tableStyle).not.toContain('width:max-content!important');
    } finally {
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
            return declaration({
              display: 'table-caption',
              width: '100cqi',
              height: '0px',
              content: '""'
            });
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
      write: async (items) => { writes.push(items); },
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
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const checkboxes = holder.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]?.hasAttribute('checked')).toBe(true);
    expect(checkboxes[0]?.hasAttribute('disabled')).toBe(true);
    expect(checkboxes[1]?.hasAttribute('checked')).toBe(false);
    expect(checkboxes[1]?.hasAttribute('disabled')).toBe(true);
    expect(checkboxes[0]?.hasAttribute('name')).toBe(false);
    expect(checkboxes[0]?.hasAttribute('value')).toBe(false);
    expect(holder.querySelector('input[type="text"]')).toBeNull();
  });

  it('makes formula blocks horizontal-only scroll owners with automatic height', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord">long formula</span></span></span></span></span></div>';
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
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const formulaStyle = [...holder.querySelectorAll('section')]
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
          return declaration({
            display: 'block',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto'
          });
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
      write: async (items) => { writes.push(items); },
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
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '用户请求\n是否命中缓存?\n返回缓存结果\n调用 API' });

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
      write: async (items: unknown[]) => { writes.push(items); },
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
    expect([...modernHolder.querySelectorAll('foreignObject')].every((element) => {
      const style = element.getAttribute('style') ?? '';
      return style.includes('overflow:visible!important')
        && style.includes('overflow-x:visible!important')
        && style.includes('overflow-y:visible!important')
        && style.includes('min-width:max-content!important')
        && style.includes('max-width:none!important')
        && style.includes('white-space:nowrap!important')
        && style.includes('word-break:normal!important')
        && style.includes('overflow-wrap:normal!important');
    })).toBe(true);
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
    expect([...modernHolder.querySelectorAll('foreignObject')].every((element) => {
      const label = element.querySelector('nobr');
      return label?.textContent === element.textContent;
    })).toBe(true);
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
          return declaration({ display: 'inline', position: 'relative', height: '1.2em', transform: 'translateY(1px)' });
        }
        if ('path' === element.tagName.toLowerCase()) {
          return declaration({ display: 'inline', fill: 'url(#gradient)', stroke: 'none', 'marker-end': 'url("#arrowhead")' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
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
    expect([...holder.querySelectorAll('section span')].some((element) => element.textContent?.includes('x + y')))
      .toBe(true);
    const visualFormulaNodes = [...holder.querySelectorAll('section span')]
      .filter((element) => element.textContent?.includes('x + y'));
    expect(visualFormulaNodes.some((element) => {
      const style = element.getAttribute('style') ?? '';
      return style.includes('white-space:nowrap!important')
        && style.includes('word-break:normal!important')
        && style.includes('overflow-wrap:normal!important')
        && style.includes('max-width:none!important');
    })).toBe(true);
    expect(text.match(/x \+ y/g)).toHaveLength(1);
    expect(holder.querySelector('section[style*="position:fixed"]')).toBeNull();
    expect(holder.querySelector('section span[style*="position:relative"]')).not.toBeNull();
    expect(holder.querySelector('img[src="data:image/png;base64,AAAA"]')).not.toBeNull();
    expect(holder.querySelector('img[srcset*="javascript:"]')).toBeNull();
    expect(holder.querySelector('img[srcset*="https://example.test/image.png"]')).not.toBeNull();
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
      write: async (items) => { writes.push(items); },
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
    const column = (first: string, second: string): string => [
      '<span class="col-align-c"><span class="vlist-t vlist-t2">',
      `<span class="vlist-r"><span class="vlist"><span style="top:-2em"><span class="pstrut"></span><span class="mord">${first}</span></span></span></span>`,
      `<span class="vlist-r"><span class="vlist"><span><span class="pstrut"></span><span class="mord">${second}</span></span></span></span>`,
      '</span></span>'
    ].join('');
    const row = (content: string): string => [
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
      write: async (items) => { writes.push(items); },
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
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
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

      await expect(clipboard.copy(readyPreview())).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
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
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
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

      await expect(clipboard.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
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
      write: async (items) => { writes.push(items); },
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
      write: async (items: unknown[]) => { writes.push(items); },
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
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false)
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: vi.fn(async () => { throw new Error('denied'); }),
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(readyPreview())).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    expect(document.querySelector('.easymde-copy-sandbox')).toBeNull();
  });
});
