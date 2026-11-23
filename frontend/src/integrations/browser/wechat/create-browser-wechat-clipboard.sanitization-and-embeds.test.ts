// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  createBrowserWechatClipboard
} from './create-browser-wechat-clipboard';
import {
  blobText,
  declaration,
  prepareClipboard,
  registerWechatClipboardCleanup
} from './wechat-clipboard.test-harness';

describe('createBrowserWechatClipboard', () => {
  registerWechatClipboardCleanup();

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
    const formulaSections = [...holder.querySelectorAll('section')]
      .filter((element) => element.textContent?.includes('long formula'));
    const formulaStyle = formulaSections[formulaSections.length - 1]?.getAttribute('style') ?? '';
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
});
