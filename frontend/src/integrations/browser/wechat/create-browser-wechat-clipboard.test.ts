// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

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

describe('createBrowserWechatClipboard', () => {
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
    const html = await htmlBlob.text();
    const text = await textBlob.text();
    expect(html).toContain('Rendered');
    expect(html).toContain('max-width:100%');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('private-id');
    expect(html).not.toContain('theme-class');
    expect(html).not.toContain('data-easymde-');
    expect(text).toBe('Rendered');
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
    const html = await htmlBlob.text();
    if (!textBlob) throw new Error('clipboard text missing');
    const text = await textBlob.text();
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
          return declaration({ content: '"Chapter"', display: 'inline', color: 'rgb(1, 2, 3)' });
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
    const html = await htmlBlob.text();
    if (!textBlob) throw new Error('clipboard text missing');
    const text = await textBlob.text();
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(holder.querySelector('h1')).not.toBeNull();
    expect(holder.querySelector('h2 > span[aria-hidden="true"]')?.textContent).toBe('Chapter');
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
    expect(holder.querySelector('pre code')?.textContent).toContain('const value = 1;');
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
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<div class="wrapper"><h3>公众号标题</h3><p>正文 <strong>重点</strong> <a href="javascript:alert(1)">危险链接</a></p></div>',
      '<p><a href="https://example.test/ok">安全链接</a><img src="javascript:alert(1)" alt="bad"><img src="https://example.test/image.png" alt="good"></p>',
      '<pre><code>const value = 1;\nconst second = 2;</code></pre>'
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
    const html = await htmlBlob.text();
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(holder.querySelector('div')).toBeNull();
    expect(holder.querySelector('section')).not.toBeNull();
    expect(holder.querySelectorAll('span[leaf]')).toHaveLength(7);
    expect(holder.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(holder.querySelector('a[href="https://example.test/ok"]')).not.toBeNull();
    expect(holder.querySelector('img[src^="javascript:"]')).toBeNull();
    expect(holder.querySelector('img[src="https://example.test/image.png"]')).not.toBeNull();
    expect(holder.querySelector('pre')?.getAttribute('style')).toContain('overflow-x:auto');
    expect(holder.querySelectorAll('pre > code br')).toHaveLength(1);
    expect(holder.querySelector('pre > span[aria-hidden="true"]')?.getAttribute('style')).toContain('margin:-22px 0 10px 14px');
    expect(holder.querySelector('pre > span[aria-hidden="true"]')?.getAttribute('style')).toContain('box-shadow:rgb(255, 189, 46) 20px 0 0, rgb(39, 201, 63) 40px 0 0');
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
      '<div class="katex"><span class="katex-mathml"><math><annotation>x + y</annotation></math></span><span class="katex-html">x + y</span></div>',
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
    holder.innerHTML = await htmlBlob.text();
    const text = await textBlob.text();
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
    expect([...holder.querySelectorAll('section span')].some((element) => element.textContent?.includes('x + y')))
      .toBe(true);
    expect(text.match(/x \+ y/g)).toHaveLength(1);
    expect(holder.querySelector('section[style*="position:fixed"]')).toBeNull();
    expect(holder.querySelector('section span[style*="position:relative"]')).not.toBeNull();
    expect(holder.querySelector('img[src="data:image/png;base64,AAAA"]')).not.toBeNull();
    expect(holder.querySelector('img[srcset*="javascript:"]')).toBeNull();
    expect(holder.querySelector('img[srcset*="https://example.test/image.png"]')).not.toBeNull();
  });

  it('uses the synchronous compatibility copy only when modern write is unavailable', async () => {
    const source = document.createElement('button');
    let copiedMarkup = '';
    document.body.appendChild(source);
    source.focus();
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
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 5, y: 8 })
    });

    await expect(clipboard.copy(readyPreview())).resolves.toEqual({
      method: 'legacy',
      status: 'copied'
    });
    expect(copiedMarkup).toContain('max-width:100%');
    expect(copiedMarkup).not.toContain('data-easymde-');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('.easymde-copy-sandbox')).toBeNull();
    expect(document.activeElement).toBe(source);
    source.remove();
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
    const modernHtml = await modernBlob.text();

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacy = createBrowserWechatClipboard({ ...runtime, clipboardItem: null, write: null });
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
