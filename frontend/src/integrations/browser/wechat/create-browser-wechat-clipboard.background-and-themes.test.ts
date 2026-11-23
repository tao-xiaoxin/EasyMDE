// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  createBrowserWechatClipboard
} from './create-browser-wechat-clipboard';
import {
  blobText,
  computedStyle,
  declaration,
  prepareClipboard,
  registerWechatClipboardCleanup
} from './wechat-clipboard.test-harness';

describe('createBrowserWechatClipboard', () => {
  registerWechatClipboardCleanup();

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
});
