import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  computedStyle,
  declaration,
  installClipboardTestEnvironment,
  pngOptions,
  readyPreview
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('aborts PNG conversion when the browser rejects Clipboard write mid-rasterization', async () => {
    let rejectWrite: ((error: Error) => void) | undefined;
    let rasterizationAborted = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          const abort = (): void => {
            rasterizationAborted = true;
            reject(new Error('rasterization-aborted'));
          };
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        })
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-math.png',
      url: 'https://example.test/hidden-math.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectWrite = reject;
          })
      )
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    rejectWrite?.(new Error('NotAllowedError'));

    await expect(copy).resolves.toEqual({ code: 'wechat-png-clipboard-failed', sideEffects: 'none', status: 'failed' });
    expect(rasterizationAborted).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });


  it('reports conversion failure without publishing a partial Clipboard payload', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const rasterize = vi.fn(async () => {
      throw new Error('native-rasterizer-failed');
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-math.png',
      url: 'https://example.test/hidden-math.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn((items) => {
        writes.push(items);
        return Promise.resolve();
      })
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(writes).toHaveLength(1);
    expect(upload).not.toHaveBeenCalled();
  });

  it('rasterizes only outermost visual roots in DOM order and preserves tables', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const rasterize = vi.fn(async ({ kind }: { kind: string }) => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20,
      kind
    }));
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn((items) => {
        writes.push(items);
        return Promise.resolve();
      })
    });
    const preview = readyPreview();
    preview.innerHTML = [
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg>',
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div></div>',
      '<div class="easymde-math"><span class="katex"><span>x</span></span></div>',
      '<table><tbody><tr><td>Keep HTML</td></tr></tbody></table>'
    ].join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(rasterize).toHaveBeenCalledTimes(2);
    expect(rasterize.mock.calls.map(([value]) => value.kind)).toEqual(['mermaid', 'math']);
    expect(upload).toHaveBeenCalledTimes(2);
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('img[src^="https://example.test/"]')).toHaveLength(2);
    expect(holder.querySelector('table')).not.toBeNull();
    expect(holder.querySelectorAll('svg')).toHaveLength(0);
    expect(holder.querySelectorAll('section[data-ignore-width]')).toHaveLength(1);
    expect(holder.querySelector('section[data-ignore-width] table')).not.toBeNull();
    expect(holder.querySelectorAll('section[data-ignore-width] code')).toHaveLength(0);
  });

  it('does not style discarded PNG descendants twice before native capture', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">x</span></span></span></div>';
    const descendant = preview.querySelector('.mord');
    if (!descendant) throw new Error('math descendant missing');
    let descendantStyleReads = 0;
    const rasterize = vi.fn(async ({ source }: { source: Element }) => {
      expect(source.querySelector('.mord')).not.toBeNull();
      return { file: new File(['png'], 'math.png', { type: 'image/png' }), height: 24, pixelCount: 576, width: 24 };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'math.png',
      url: 'https://example.test/math.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && element === descendant) descendantStyleReads += 1;
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(descendantStyleReads).toBe(1);
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
  });

  it('accepts expanded math output while retaining visual-root flow semantics on generated PNGs', async () => {
    const writes: unknown[] = [];
    const requests: Array<Readonly<{ height: number; inline: boolean; kind: string; width: number }>> = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const rasterize = vi.fn(
      async ({ height, kind, source, width }: { height: number; kind: string; source: Element; width: number }) => {
        const inline = source.classList.contains('easymde-math-inline');
        requests.push({ height, inline, kind, width });
        const outputWidth = inline ? 40 : 'math' === kind ? 547 : width;
        if ('math' === kind) {
          expect(source.querySelector('.katex-mathml')).toBeNull();
        }
        return {
          file: new File([`${kind}-${outputWidth}`], `${kind}-${outputWidth}.png`, { type: 'image/png' }),
          height: height || 1,
          ...(inline ? { inlineLayout: { baseline: 5, height: 20, paintOffsetX: 0, paintOffsetY: 0, width: 40 } } : {}),
          pixelCount: 200,
          width: outputWidth || 1
        };
      }
    );
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const preview = readyPreview();
    preview.setAttribute('data-ignore-width', 'untrusted-root');
    preview.innerHTML = [
      '<div class="easymde-math-block"><span class="katex"><span class="katex-mathml"><math><annotation>wide formula</annotation></math></span><span class="katex-html">wide formula</span></span></div>',
      '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>',
      '<span class="easymde-math-inline" data-ignore-width="untrusted-inline"><span class="katex"><span class="katex-html">inline formula</span></span></span>',
      '<section data-ignore-width="untrusted-overflow" style="overflow:auto">Unowned overflow</section>'
    ].join('');
    const math = preview.querySelector('.easymde-math-block');
    const mermaid = preview.querySelector('.easymde-mermaid');
    const inlineMath = preview.querySelector('.easymde-math-inline');
    if (!math || !mermaid || !inlineMath) throw new Error('visual roots missing');
    Object.defineProperties(math, {
      getBoundingClientRect: { configurable: true, value: () => ({ height: 30, width: 180 }) },
      scrollHeight: { configurable: true, value: 30 },
      scrollWidth: { configurable: true, value: 547 }
    });
    Object.defineProperty(mermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 40, width: 80 })
    });
    Object.defineProperty(inlineMath, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 20, width: 40 })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            height: '30px',
            'margin-left': '12px',
            'margin-right': '14px',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'padding-top': '8px',
            'padding-right': '8px',
            'padding-bottom': '8px',
            'padding-left': '8px',
            'border-top-width': '2px',
            'border-right-width': '2px',
            'border-bottom-width': '2px',
            'border-left-width': '2px',
            background: 'blue',
            'vertical-align': 'middle',
            width: '180px'
          });
        }
        if ('DIV' === element.tagName && element.classList.contains('easymde-mermaid')) {
          return declaration({
            display: 'inline-block',
            height: '40px',
            'margin-left': '7px',
            'margin-right': '9px',
            overflow: 'visible',
            'vertical-align': 'middle',
            width: '80px'
          });
        }
        if (element.classList.contains('easymde-math-inline')) {
          return declaration({
            display: 'inline',
            'overflow-x': 'visible',
            'overflow-y': 'visible',
            'vertical-align': 'baseline'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(requests).toEqual([
      { height: 30, inline: false, kind: 'math', width: 180 },
      { height: 40, inline: false, kind: 'mermaid', width: 80 },
      { height: 20, inline: true, kind: 'math', width: 40 }
    ]);
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/"]')];
    expect(images).toHaveLength(3);
    expect(images[0]?.getAttribute('style')).toContain('width:547px!important');
    expect(images[0]?.getAttribute('style')).toContain('max-width:none!important');
    expect(images[0]?.getAttribute('style')).toContain('display:block');
    expect(images[0]?.getAttribute('style')).toContain('margin-left:auto!important');
    expect(images[0]?.getAttribute('style')).toContain('margin-right:auto!important');
    expect(images[0]?.getAttribute('style')).not.toContain('width:auto!important');
    expect(images[0]?.getAttribute('style')).not.toContain('inline-size:100%!important');
    expect(images[0]?.getAttribute('style')).not.toMatch(/(?:^|;)padding-/);
    expect(images[0]?.getAttribute('style')).not.toMatch(/(?:^|;)border-/);
    expect(images[0]?.getAttribute('style')).not.toMatch(/(?:^|;)background/);
    const mathWrapperStyle = images[0]?.parentElement?.getAttribute('style') ?? '';
    expect(mathWrapperStyle).toContain('display:block');
    expect(mathWrapperStyle).toContain('overflow-x:auto');
    expect(mathWrapperStyle).toContain('overflow-y:hidden');
    expect(mathWrapperStyle).toContain('height:auto');
    expect(mathWrapperStyle).toContain('margin-left:12px');
    expect(mathWrapperStyle).toContain('margin-right:14px');
    expect(mathWrapperStyle).toContain('vertical-align:middle');
    expect(mathWrapperStyle.match(/margin-left:12px/g)).toHaveLength(1);
    expect(mathWrapperStyle.match(/margin-right:14px/g)).toHaveLength(1);
    expect(mathWrapperStyle).not.toMatch(/(?:^|;)padding-/);
    expect(mathWrapperStyle).not.toMatch(/(?:^|;)border-/);
    expect(mathWrapperStyle).not.toMatch(/(?:^|;)background/);
    expect(images[1]?.getAttribute('style')).toContain('width:80px!important');
    expect(images[1]?.getAttribute('style')).toContain('display:inline-block');
    expect(images[1]?.getAttribute('style')).toContain('margin-left:7px');
    expect(images[1]?.getAttribute('style')).toContain('margin-right:9px');
    expect(images[1]?.getAttribute('style')).toContain('vertical-align:middle');
    expect(images[2]?.getAttribute('style')).toContain('width:40px!important');
    expect(images[0]?.parentElement?.getAttribute('data-ignore-width')).toBe('');
    expect(images[1]?.parentElement?.hasAttribute('data-ignore-width')).toBe(false);
    expect(images[2]?.parentElement?.hasAttribute('data-ignore-width')).toBe(false);
    expect(holder.querySelectorAll('section[data-ignore-width]')).toHaveLength(1);
    expect(holder.querySelector('section[data-ignore-width] > img[src^="https://example.test/"]')).not.toBeNull();
    expect(holder.firstElementChild?.hasAttribute('data-ignore-width')).toBe(false);
    expect(holder.querySelector('[data-ignore-width="untrusted-root"]')).toBeNull();
    expect(holder.querySelector('[data-ignore-width="untrusted-inline"]')).toBeNull();
    expect(holder.querySelector('[data-ignore-width="untrusted-overflow"]')).toBeNull();
  });

  it.each(['fixed', 'relative'] as const)(
    'renders magnified Mermaid PNGs responsively inside a local owner in a %s UI shell',
    async (shellPosition) => {
      const writes: unknown[] = [];
      class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
      const preview = readyPreview();
      const shell = document.createElement('div');
      shell.style.position = shellPosition;
      shell.append(preview);
      preview.innerHTML =
        '<div class="easymde-mermaid" style="display:block;width:63px;height:auto;overflow-x:scroll;overflow-y:visible"><svg viewBox="0 0 100 50"><rect width="100" height="50"></rect></svg></div>';
      const mermaid = preview.querySelector('.easymde-mermaid');
      const svg = preview.querySelector('svg');
      if (!mermaid || !svg) throw new Error('Mermaid root missing');
      Object.defineProperty(mermaid, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 31.5, width: 63 })
      });
      Object.defineProperty(svg, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 31.5, width: 63 })
      });
      Object.defineProperty(svg, 'getScreenCTM', {
        configurable: true,
        value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
      });
      const rasterize = vi.fn(
        async ({
          height,
          layoutMagnification = 1,
          width
        }: {
          height: number;
          layoutMagnification?: number;
          width: number;
        }) => ({
          file: new File(['magnified'], 'magnified.png', { type: 'image/png' }),
          height: height * layoutMagnification,
          pixelCount: width * height * layoutMagnification * layoutMagnification,
          width: width * layoutMagnification
        })
      );
      const upload = vi.fn(async ({ file }: { file: File }) => ({
        alt: '',
        status: 'uploaded' as const,
        title: file.name,
        url: 'https://example.test/magnified.png'
      }));
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return declaration({});
          if (element === mermaid) {
            return declaration({
              'box-sizing': 'content-box',
              display: 'block',
              height: 'auto',
              'max-width': '63px',
              overflow: 'auto',
              'overflow-x': 'scroll',
              'overflow-y': 'auto',
              width: '63px'
            });
          }
          return computedStyle(element);
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      document.body.append(shell);
      try {
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        const item = (writes[0] as ClipboardItemStub[])[0];
        const htmlBlob = item?.payload['text/html'];
        if (!htmlBlob) throw new Error('clipboard html missing');
        const holder = document.createElement('div');
        holder.innerHTML = await blobText(htmlBlob);
        const image = holder.querySelector('img[src="https://example.test/magnified.png"]');
        const owner = image?.parentElement;
        if (!image || !owner) throw new Error('magnified Mermaid output missing');
        const ownerStyle = owner.getAttribute('style') ?? '';
        const imageStyle = image.getAttribute('style') ?? '';
        expect(owner.getAttribute('data-ignore-width')).toBe('');
        expect(ownerStyle).toContain('width:100%!important');
        expect(ownerStyle).toContain('min-width:0!important');
        expect(ownerStyle).toContain('max-width:100%!important');
        expect(ownerStyle).toContain('overflow-x:auto!important');
        expect(ownerStyle).toContain('overflow-y:visible!important');
        expect(ownerStyle).toContain('height:auto!important');
        expect(ownerStyle).toContain('max-height:none!important');
        expect(ownerStyle).toContain('box-sizing:border-box!important');
        expect(ownerStyle).not.toContain('63px');
        expect(image.getAttribute('width')).toBe('100');
        expect(image.getAttribute('height')).toBe('50');
        expect(imageStyle).toContain('width:100%!important');
        expect(imageStyle).toContain('max-width:100%!important');
        expect(imageStyle).toContain('height:auto!important');
        expect(imageStyle).toContain('display:block!important');
      } finally {
        shell.remove();
      }
    }
  );

});
