import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  codeRows,
  declaration,
  installClipboardTestEnvironment,
  prepareClipboard,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('maps terminal and intentional code newlines to the source logical lines', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<pre><code><span class="token keyword">alpha  </span>\n<span class="token comment">beta  </span>\n</code></pre>',
      '<pre><code>double\n\n</code></pre>',
      '<pre><code>triple\n\n\n</code></pre>',
      '<pre><code>crlf\r\nnext\r\n</code></pre>',
      '<pre><code>single</code></pre>',
      '<pre><code></code></pre>',
      '<pre><code>\n</code></pre>',
      '<pre><code>alpha\n\nbeta</code></pre>',
      '<pre><code><span class="token outer">alpha\n<span class="token inner">beta\n</span></span></code></pre>'
    ].join('');
    const sourceText = 'alpha  \nbeta  \ndouble\n\ntriple\n\n\ncrlf\r\nnext\r\nsingle\n\n\nalpha\n\nbeta\nalpha\nbeta';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('SPAN' === element.tagName && element.classList.contains('token')) {
          return declaration({ color: 'rgb(1, 2, 3)', display: 'inline' });
        }
        if ('PRE' === element.tagName || 'CODE' === element.tagName) {
          return declaration({ display: 'block', 'white-space': 'pre' });
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
    if (!htmlBlob || !textBlob) throw new Error('clipboard payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const codeBlocks = holder.querySelectorAll('pre > code');
    const rowContainers = [...codeBlocks].map(codeRows);
    expect(await blobText(textBlob)).toBe(sourceText);
    expect(codeBlocks).toHaveLength(9);
    expect(rowContainers.every((rows) => rows !== null)).toBe(true);
    expect([...codeBlocks].every((code) => code.children.length === 1)).toBe(true);
    expect(rowContainers[0]?.querySelectorAll(':scope > nobr')).toHaveLength(2);
    expect(rowContainers[0]?.querySelectorAll(':scope > br')).toHaveLength(1);
    expect(rowContainers[0]?.querySelector('nobr')?.textContent?.replaceAll('\u2060', '')).toBe('alpha  ');
    expect(codeBlocks[0]?.querySelectorAll('span[style*="color:rgb(1, 2, 3)"]')).toHaveLength(2);
    expect(rowContainers[1]?.querySelectorAll(':scope > nobr')).toHaveLength(2);
    expect(rowContainers[1]?.querySelectorAll(':scope > br')).toHaveLength(1);
    expect(rowContainers[2]?.querySelectorAll(':scope > nobr')).toHaveLength(3);
    expect(rowContainers[2]?.querySelectorAll(':scope > br')).toHaveLength(2);
    expect(rowContainers[3]?.querySelectorAll(':scope > nobr')).toHaveLength(2);
    expect(rowContainers[3]?.querySelectorAll(':scope > br')).toHaveLength(1);
    expect(rowContainers[4]?.querySelectorAll(':scope > nobr')).toHaveLength(1);
    expect(rowContainers[4]?.querySelectorAll(':scope > br')).toHaveLength(0);
    expect(rowContainers[5]?.querySelectorAll(':scope > nobr')).toHaveLength(1);
    expect(rowContainers[5]?.querySelectorAll(':scope > br')).toHaveLength(0);
    expect(rowContainers[6]?.querySelectorAll(':scope > nobr')).toHaveLength(1);
    expect(rowContainers[6]?.querySelectorAll(':scope > br')).toHaveLength(0);
    expect(rowContainers[7]?.querySelectorAll(':scope > nobr')).toHaveLength(3);
    expect(rowContainers[7]?.querySelectorAll(':scope > br')).toHaveLength(2);
    expect(rowContainers[8]?.querySelectorAll(':scope > nobr')).toHaveLength(2);
    expect(rowContainers[8]?.querySelectorAll(':scope > br')).toHaveLength(1);
    const nestedTokenSpans = [...(codeBlocks[8]?.querySelectorAll('span[style*="color:rgb(1, 2, 3)"]') ?? [])];
    expect(nestedTokenSpans.length).toBeGreaterThanOrEqual(2);
    expect(
      nestedTokenSpans.every((span) => span.textContent?.includes('alpha') || span.textContent?.includes('beta'))
    ).toBe(true);
    expect(rowContainers[8]?.querySelectorAll(':scope > nobr')[0]?.textContent).toContain('alpha');
    expect(rowContainers[8]?.querySelectorAll(':scope > nobr')[1]?.textContent).toContain('beta');
  });


  it('preserves code-frame pseudo geometry in modern and legacy payloads', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<pre><code>zero margin</code></pre>',
      '<pre class="authored-offset"><code>authored margin</code></pre>',
      '<pre class="boxed-offset"><code>boxed margin</code></pre>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'zero margin\nauthored margin\nboxed margin'
    });
    const frameComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('PRE' === element.tagName && '::before' === pseudoElement) {
        const authoredMargin = element.classList.contains('authored-offset');
        const boxedMargin = element.classList.contains('boxed-offset');
        return declaration({
          background: 'rgb(255, 95, 86)',
          'border-radius': '50%',
          'box-shadow': 'rgb(255, 189, 46) 20px 0 0, rgb(39, 201, 63) 40px 0 0',
          content: '""',
          display: 'inline',
          height: '12px',
          left: boxedMargin ? '18px' : '14px',
          'margin-bottom': authoredMargin ? '5px' : '0px',
          'margin-left': boxedMargin ? '4px' : authoredMargin ? '6px' : '0px',
          'margin-right': authoredMargin ? '4px' : '0px',
          'margin-top': boxedMargin ? '2px' : authoredMargin ? '3px' : '0px',
          position: 'absolute',
          top: boxedMargin ? '9px' : '13px',
          width: '12px'
        });
      }
      if ('PRE' === element.tagName) {
        const boxed = element.classList.contains('boxed-offset');
        return declaration({
          display: 'block',
          'border-left-color': boxed ? 'rgb(0, 0, 0)' : 'none',
          'border-left-style': boxed ? 'solid' : 'none',
          'border-left-width': boxed ? '3px' : '0px',
          'box-sizing': 'border-box',
          'padding-left': boxed ? '7px' : '0px',
          'padding-top': boxed ? '41px' : '34px',
          'white-space': 'pre'
        });
      }
      if ('CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const modernWrites: ClipboardItemStub[] = [];
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: frameComputedStyle,
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
    if (!modernHtmlBlob) throw new Error('modern frame payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    const modernTextBlob = modernWrites[0]?.payload['text/plain'];
    if (!modernTextBlob) throw new Error('modern frame text payload missing');
    expect(await blobText(modernTextBlob)).toBe('zero margin\nauthored margin\nboxed margin');

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
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    const headers = holder.querySelectorAll('pre > div[aria-hidden="true"]');
    expect(headers).toHaveLength(3);
    const markers = holder.querySelectorAll('pre > div[aria-hidden="true"] > span[aria-hidden="true"]');
    expect(markers).toHaveLength(3);
    const zeroMargin = markers[0] as HTMLElement | undefined;
    const authoredMargin = markers[1] as HTMLElement | undefined;
    const boxedMargin = markers[2] as HTMLElement | undefined;
    const zeroHeader = headers[0] as HTMLElement | undefined;
    const authoredHeader = headers[1] as HTMLElement | undefined;
    const boxedHeader = headers[2] as HTMLElement | undefined;
    expect(holder.querySelectorAll('pre > code[data-ignore-width]')).toHaveLength(3);
    expect(holder.querySelectorAll('pre[data-ignore-width]')).toHaveLength(0);
    expect(holder.querySelectorAll('pre > div[aria-hidden="true"][data-ignore-width]')).toHaveLength(0);
    expect(zeroHeader?.style.display).toBe('block');
    expect(zeroHeader?.style.width).toBe('100%');
    expect(zeroHeader?.style.height).toBe('34px');
    expect(zeroHeader?.style.paddingTop).toBe('13px');
    expect(zeroHeader?.style.paddingLeft).toBe('14px');
    expect(authoredHeader?.style.height).toBe('34px');
    expect(authoredHeader?.style.paddingTop).toBe('16px');
    expect(authoredHeader?.style.paddingLeft).toBe('20px');
    expect(boxedHeader?.style.height).toBe('41px');
    expect(boxedHeader?.style.paddingTop).toBe('11px');
    expect(boxedHeader?.style.paddingLeft).toBe('15px');
    expect([...holder.querySelectorAll('pre')].map((pre) => pre.style.paddingTop)).toEqual(['0px', '0px', '0px']);
    expect(zeroMargin?.style.position).toBe('');
    expect(zeroMargin?.style.display).toBe('block');
    expect(zeroMargin?.style.top).toBe('');
    expect(zeroMargin?.style.left).toBe('');
    expect(zeroMargin?.style.width).toBe('12px');
    expect(zeroMargin?.style.height).toBe('12px');
    expect(zeroMargin?.style.marginTop).toBe('0px');
    expect(zeroMargin?.style.marginRight).toBe('0px');
    expect(zeroMargin?.style.marginBottom).toBe('0px');
    expect(zeroMargin?.style.marginLeft).toBe('0px');
    expect(authoredMargin?.style.position).toBe('');
    expect(authoredMargin?.style.display).toBe('block');
    expect(authoredMargin?.style.top).toBe('');
    expect(authoredMargin?.style.left).toBe('');
    expect(authoredMargin?.style.marginTop).toBe('0px');
    expect(authoredMargin?.style.marginRight).toBe('0px');
    expect(authoredMargin?.style.marginBottom).toBe('0px');
    expect(authoredMargin?.style.marginLeft).toBe('0px');
    expect(boxedMargin?.style.position).toBe('');
    expect(boxedMargin?.style.display).toBe('block');
    expect(boxedMargin?.style.top).toBe('');
    expect(boxedMargin?.style.left).toBe('');
    expect(boxedMargin?.style.marginTop).toBe('0px');
    expect(boxedMargin?.style.marginLeft).toBe('0px');
    expect([...markers].map((marker) => marker.textContent)).toEqual(['\u2060', '\u2060', '\u2060']);
    const flowHolder = document.createElement('div');
    flowHolder.innerHTML = modernHtml;
    flowHolder.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
      element.style.removeProperty('position');
      element.style.removeProperty('top');
      element.style.removeProperty('left');
    });
    const flowFrame = flowHolder.querySelector('pre');
    const flowHeader = flowFrame?.querySelector<HTMLElement>(':scope > div[aria-hidden="true"]');
    const flowMarker = flowHeader?.querySelector<HTMLElement>(':scope > span[aria-hidden="true"]');
    if (!flowFrame || !flowHeader || !flowMarker) throw new Error('normal-flow frame missing');
    const flowOffset = (value: string): number => Number.parseFloat(value || '0');
    expect(flowHeader.style.position).toBe('');
    expect(flowMarker.style.position).toBe('');
    expect(flowMarker.style.top).toBe('');
    expect(flowMarker.style.left).toBe('');
    expect(flowOffset(flowHeader.style.paddingTop) + flowOffset(flowMarker.style.marginTop)).toBe(13);
    expect(flowOffset(flowHeader.style.paddingLeft) + flowOffset(flowMarker.style.marginLeft)).toBe(14);
    expect(flowHeader.style.height).toBe('34px');
    expect(flowFrame.style.paddingTop).toBe('0px');
    expect(modernHtml).not.toContain('margin:-22px 0 10px 14px');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('leaves non-absolute, hidden, and absent frame decorations in their source states', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<pre class="static-decoration"><code>static decoration</code></pre>',
      '<pre class="hidden-decoration"><code>hidden decoration</code></pre>',
      '<pre class="absent-decoration"><code>absent decoration</code></pre>',
      '<pre class="nonempty-decoration"><code>nonempty decoration</code></pre>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'static decoration\nhidden decoration\nabsent decoration\nnonempty decoration'
    });
    const frameComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('PRE' === element.tagName && '::before' === pseudoElement) {
        const className = element.className;
        if ('static-decoration' === className) {
          return declaration({
            background: 'rgb(255, 95, 86)',
            content: '""',
            display: 'inline',
            height: '12px',
            left: '14px',
            position: 'relative',
            top: '13px',
            width: '12px'
          });
        }
        if ('nonempty-decoration' === className) {
          return declaration({
            background: 'rgb(255, 95, 86)',
            content: '"dot"',
            display: 'inline',
            height: '12px',
            left: '14px',
            position: 'absolute',
            top: '13px',
            width: '12px'
          });
        }
        if ('hidden-decoration' === className) {
          return declaration({
            background: 'rgb(255, 95, 86)',
            content: '""',
            display: 'none',
            height: '12px',
            left: '14px',
            position: 'absolute',
            top: '13px',
            width: '12px'
          });
        }
        return declaration({ content: 'none' });
      }
      if ('PRE' === element.tagName) {
        return declaration({ display: 'block', 'padding-left': '5px', 'padding-top': '28px', 'white-space': 'pre' });
      }
      if ('CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const writes: ClipboardItemStub[] = [];
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: frameComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items[0] as ClipboardItemStub);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const htmlBlob = writes[0]?.payload['text/html'];
    const textBlob = writes[0]?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('frame variant payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const frames = [...holder.querySelectorAll('pre')];
    expect(frames).toHaveLength(4);
    expect(frames.every((frame) => !frame.querySelector(':scope > div[aria-hidden="true"]'))).toBe(true);
    expect(frames.map((frame) => frame.style.paddingTop)).toEqual(['28px', '28px', '28px', '28px']);
    expect(frames[0]?.querySelector(':scope > span[aria-hidden="true"]')?.getAttribute('style')).toContain(
      'position:relative'
    );
    expect(frames[0]?.querySelector(':scope > span[aria-hidden="true"]')?.textContent).toBe(' ');
    expect(frames[1]?.querySelector(':scope > span[aria-hidden="true"]')).toBeNull();
    expect(frames[2]?.querySelector(':scope > span[aria-hidden="true"]')).toBeNull();
    expect(frames[3]?.querySelector(':scope > span[aria-hidden="true"]')?.textContent).toBe('dot');
    expect(await blobText(textBlob)).toBe(
      'static decoration\nhidden decoration\nabsent decoration\nnonempty decoration'
    );
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('fails explicitly when a registered frame marker has unsupported geometry', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code>unsupported frame</code></pre>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'unsupported frame' });
    const frameComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('PRE' === element.tagName && '::before' === pseudoElement) {
        return declaration({
          background: 'rgb(255, 95, 86)',
          content: '""',
          display: 'inline',
          height: '12px',
          position: 'absolute',
          width: '12px'
        });
      }
      if ('PRE' === element.tagName) {
        return declaration({ display: 'block', 'padding-left': '0px', 'padding-top': '28px', 'white-space': 'pre' });
      }
      if ('CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const writes: unknown[] = [];
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: frameComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it.each([
    { label: 'zero reserved band', paddingTop: '0px', markerTop: '0px' },
    { label: 'negative marker offset', paddingTop: '28px', markerTop: '-1px' },
    { label: 'marker beyond reserved band', paddingTop: '28px', markerTop: '29px' }
  ])('rejects $label code-frame geometry without mutating source', async ({ paddingTop, markerTop }) => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code>unsupported vertical frame</code></pre>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'unsupported vertical frame' });
    const frameComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('PRE' === element.tagName && '::before' === pseudoElement) {
        return declaration({
          background: 'rgb(255, 95, 86)',
          content: '""',
          display: 'inline',
          height: '12px',
          left: '14px',
          position: 'absolute',
          top: markerTop,
          width: '12px'
        });
      }
      if ('PRE' === element.tagName) {
        return declaration({
          display: 'block',
          'padding-left': '0px',
          'padding-top': paddingTop,
          'white-space': 'pre'
        });
      }
      if ('CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: frameComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async () => {}
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(preview.innerHTML).toBe(sourceMarkup);
  });


  it('protects CSS hash tokens split across syntax spans from WeChat topic parsing', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<pre><code><span class="selector">.sample</span><span class="punct"> { color: </span><span class="hash">#</span><span class="number">336699</span><span class="punct">; }</span></code></pre>';
    const sourceMarkup = preview.innerHTML;
    const sourceText = '.sample { color: #336699; }';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' });
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
    if (!htmlBlob || !textBlob) throw new Error('clipboard hash payload missing');
    const html = await blobText(htmlBlob);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(holder.querySelector('pre > code')?.textContent).toContain('#\uFEFF336699');
    expect(await blobText(textBlob)).toBe(sourceText);
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps existing markers, body hashes, inline code, and emoji suffix boundaries unchanged', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<pre><code><span>#</span><span>336699</span></code></pre>',
      '<pre><code><span>#</span><span>\u2060existing</span></code></pre>',
      '<pre><code><span>#</span><span>\uFEFFexisting</span></code></pre>',
      '<pre><code># <span>body</span></code></pre>',
      '<pre><code><span>#</span><span>\uFE0F</span><span>\u20E3</span></code></pre>',
      '<pre><code><span>#</span><span>\uFE0E</span></code></pre>',
      '<pre><code><span>#</span><span>😀</span></code></pre>',
      '<pre><code><span>#</span><span>;</span></code></pre>',
      '<pre><code><span>#</span><span>，</span></code></pre>',
      '<pre><code><span>#</span></code></pre>',
      '<pre><code><span>#</span>\n<span>next</span></code></pre>',
      '<p>#body</p>',
      '<p><code>#inline</code></p>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText = [
      '#336699',
      '#\u2060existing',
      '#\uFEFFexisting',
      '# body',
      '#\uFE0F\u20E3',
      '#\uFE0E',
      '#😀',
      '#;',
      '#，',
      '#',
      '#',
      'next',
      '#body',
      '#inline'
    ].join('\n');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' });
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
    if (!htmlBlob || !textBlob) throw new Error('marker boundary payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const codeTexts = [...holder.querySelectorAll('pre > code')].map((code) => code.textContent ?? '');
    expect(codeTexts).toHaveLength(11);
    expect(codeTexts[0]).toBe('#\uFEFF336699');
    expect(codeTexts[1]).toBe('#\uFEFF\u2060existing');
    expect(codeTexts[2]).toBe('#\uFEFFexisting');
    expect(codeTexts[3]).toBe('#\uFEFF\u2060 \u2060body');
    expect(codeTexts[4]).toBe('#\uFE0F\u20E3');
    expect(codeTexts[5]).toBe('#\uFE0E');
    expect(codeTexts[6]).toBe('#\uFEFF😀');
    expect(codeTexts[7]).toBe('#;');
    expect(codeTexts[8]).toBe('#，');
    expect(codeTexts[9]).toBe('#');
    expect(codeTexts[10]).toBe('#next');
    const paragraphs = holder.querySelectorAll('p');
    expect(paragraphs[0]?.textContent).toBe('#body');
    expect(paragraphs[1]?.querySelector('code')?.textContent).toBe('#inline');
    expect(await blobText(textBlob)).toBe(sourceText.replaceAll('\u2060', ''));
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps modern and prepared legacy code payloads identical', async () => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre dir="rtl"><code><span class="token">#abc   tail</span></code></pre>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '#abc   tail' });
    const styleFor = (_element: Element, pseudoElement?: string): CSSStyleDeclaration =>
      pseudoElement
        ? declaration({})
        : declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' });
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modernWrites: unknown[] = [];
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('modern code payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(await blobText(modernTextBlob)).toBe('#abc   tail');

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        dispatchSuccessfulLegacyCopy();
        return true;
      })
    });
    const preparedLegacy = createRuntime(null, null);
    await prepareClipboard(preparedLegacy, preview);
    await expect(preparedLegacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    expect(legacyHtml).toBe(modernHtml);
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    expect(holder.querySelector('pre')?.getAttribute('dir')).toBe('rtl');
    expect(holder.querySelector('pre > code')?.textContent).toBe('#\uFEFFabc   tail'.replaceAll(' ', '\u2060 \u2060'));
  });

  it('restores encoded clone text after connected plaintext measurement throws', async () => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code><span class="token">#abc   tail</span></code></pre>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '#abc   tail' });
    let measuredClone: HTMLElement | null = null;
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        if (this !== preview && this.querySelector('pre > code')) {
          measuredClone = this;
          throw new Error('plain-text-measurement-failed');
        }
        return this.textContent ?? '';
      }
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement
            ? declaration({})
            : declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' }),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async () => undefined
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      const cloneAfterThrow = measuredClone as HTMLElement | null;
      expect(cloneAfterThrow).not.toBeNull();
      expect(cloneAfterThrow?.querySelector('pre > code')?.textContent).toBe(
        '#\uFEFFabc   tail'.replaceAll(' ', '\u2060 \u2060')
      );
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
    }
  });

  it('does not mutate source code when the modern copy is cancelled after serialization starts', async () => {
    let resolveWrite: (() => void) | null = null;
    let capturedItem: { payload: Record<string, Blob | PromiseLike<Blob>> } | null = null;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {
        capturedItem = this;
      }
    }
    const controller = new AbortController();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code><span>#</span><span>336699</span></code></pre>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '#336699' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) =>
        pseudoElement
          ? declaration({})
          : declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        })
    });
    const operation = clipboard.copy(preview, { signal: controller.signal });
    const itemAfterWrite = capturedItem as { payload: Record<string, Blob | PromiseLike<Blob>> } | null;
    if (!itemAfterWrite) throw new Error('ClipboardItem was not created');
    const htmlBlob = itemAfterWrite.payload['text/html'];
    if (!htmlBlob) throw new Error('cancelled code HTML missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelector('pre > code')?.textContent).toContain('#\uFEFF336699');
    controller.abort();
    (resolveWrite as (() => void) | null)?.();
    await expect(operation).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps syntax-highlighted long lines in one non-wrapping line box', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
    const code = holder.querySelector('pre > code');
    const rows = codeRows(code);
    const line = rows?.querySelector(':scope > nobr');
    const serialized = rows
      ? Array.from(rows.childNodes)
          .map((node) => ('BR' === (node as Element).tagName ? '\n' : (node.textContent ?? '')))
          .join('')
      : '';
    expect(serialized.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toBe(source);
    expect(code?.children).toHaveLength(1);
    expect(rows?.querySelectorAll(':scope > br')).toHaveLength(1);
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const source = '/* first line\nsecond line */\nconst value = 1;';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<pre><code><span class="hljs-comment">/* first line\nsecond line */</span>\n<span class="hljs-keyword">const</span> value = 1;</code></pre>';
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
    const code = holder.querySelector('pre > code');
    const rows = codeRows(code);
    const lines = rows ? Array.from(rows.querySelectorAll(':scope > nobr')) : [];
    const serialized = rows
      ? Array.from(rows.childNodes)
          .map((node) => ('BR' === (node as Element).tagName ? '\n' : (node.textContent ?? '')))
          .join('')
      : '';
    expect(serialized.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toBe(source);
    expect(lines).toHaveLength(3);
    expect(code?.children).toHaveLength(1);
    expect(rows?.querySelectorAll(':scope > br')).toHaveLength(2);
    expect(rows?.querySelectorAll(':scope > nobr br')).toHaveLength(0);
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

});
