import { describe, expect, it, vi } from 'vitest';

import {
  enhanceFrontendContent,
  renderMathContent,
  renderMermaidContent,
  syncCodeFrameBackgrounds,
  type FrontendEnhancementScheduler,
  type FrontendEnhancementWindow
} from './frontend-enhancement-runtime';

function runtime(): FrontendEnhancementWindow {
  const windowRef = Object.create(window) as FrontendEnhancementWindow;
  for (const key of [
    'EasyMDEEnhancements',
    'EasyMDEFrontendConfig',
    'EasyMDEMathRenderer',
    'EasyMDEMermaidRenderer',
    'hljs',
    'katex',
    'mermaid'
  ] as const) {
    Object.defineProperty(windowRef, key, {
      configurable: true,
      writable: true,
      value: undefined
    });
  }
  return windowRef;
}

function scheduler(nowValues: number[] = []): Readonly<{
  scheduler: FrontendEnhancementScheduler;
  yields: number;
}> {
  let nowIndex = 0;
  let yields = 0;
  return {
    get yields() {
      return yields;
    },
    scheduler: {
      now: () => nowValues[nowIndex] ?? nowValues.at(-1) ?? 0,
      yield: async () => {
        yields += 1;
        nowIndex += 1;
      }
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('frontend enhancement runtime', () => {
  it('keeps code highlighting and frame background behavior unchanged', async () => {
    const root = document.createElement('article');
    root.innerHTML = '<pre><code class="language-javascript">const value = 42;</code></pre>';
    const windowRef = runtime();
    const highlighted: HTMLElement[] = [];
    windowRef.hljs = {
      highlightElement: (code) => highlighted.push(code)
    };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgb(12, 34, 56)',
      color: 'rgb(171, 178, 191)'
    } as CSSStyleDeclaration);

    await enhanceFrontendContent(root, { features: { syntaxHighlight: true } }, windowRef);

    const code = root.querySelector('code');
    expect(code?.classList.contains('hljs')).toBe(true);
    expect(code?.dataset.easymdeHighlighted).toBe('1');
    expect(highlighted).toEqual([code]);
    expect(code?.parentElement?.style.getPropertyValue('--easymde-code-frame-background'))
      .toBe('rgb(12, 34, 56)');
  });

  it('keeps language-free code highlighting and framing unchanged', async () => {
    const root = document.createElement('article');
    root.innerHTML = '<pre><code>plain fenced code</code></pre>';
    const windowRef = runtime();
    const highlightElement = vi.fn();
    windowRef.hljs = { highlightElement };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgb(12, 34, 56)',
      color: 'rgb(171, 178, 191)'
    } as CSSStyleDeclaration);

    await enhanceFrontendContent(
      root,
      { features: { syntaxHighlight: true } },
      windowRef
    );

    const code = root.querySelector('code');
    expect(code?.classList.contains('hljs')).toBe(true);
    expect(code?.dataset.easymdeHighlighted).toBe('1');
    expect(highlightElement).toHaveBeenCalledWith(code);
    expect(code?.parentElement?.style.getPropertyValue(
      '--easymde-code-frame-background'
    )).toBe('rgb(12, 34, 56)');
  });

  it('eventually auto-highlights every code block in a large immersive root in bounded slices', async () => {
    const root = document.createElement('article');
    root.className = 'easymde-immersive-visual-editor';
    root.innerHTML = Array.from({ length: 10 }, (_, index) => {
      const language = 1 === index ? ' class="language-javascript"' : '';
      return `<pre><code${language}>${'plain fenced code\n'.repeat(800)}</code></pre>`;
    }).join('');
    const windowRef = runtime();
    const highlightElement = vi.fn();
    windowRef.hljs = { highlightElement };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgb(12, 34, 56)',
      color: 'rgb(171, 178, 191)'
    } as CSSStyleDeclaration);
    const fake = scheduler();

    await enhanceFrontendContent(
      root,
      { features: { syntaxHighlight: true } },
      windowRef,
      { scheduler: fake.scheduler }
    );

    const codeBlocks = root.querySelectorAll('code');
    expect(new TextEncoder().encode(root.textContent ?? '').length)
      .toBeGreaterThan(128 * 1024);
    expect([...codeBlocks].every((code) => code.classList.contains('hljs'))).toBe(true);
    expect([...codeBlocks].every((code) => code.dataset.easymdeHighlighted === '1'))
      .toBe(true);
    expect(highlightElement).toHaveBeenCalledTimes(codeBlocks.length);
    expect(fake.yields).toBeGreaterThan(0);
    expect(fake.yields).toBeLessThan(codeBlocks.length);
  });

  it('adds one decorative line-number gutter after highlighting without changing code text', async () => {
    const root = document.createElement('article');
    root.className = 'easymde-code-line-numbers';
    root.innerHTML = '<pre><code class="language-javascript">const one = 1;\nconst two = 2;\nreturn one + two;\n</code></pre>';
    const windowRef = runtime();
    const highlightElement = vi.fn((code: HTMLElement) => {
      code.innerHTML = '<span class="hljs-keyword">const</span> one = 1;\nconst two = 2;\nreturn one + two;\n';
    });
    windowRef.hljs = { highlightElement };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgb(12, 34, 56)',
      color: 'rgb(171, 178, 191)'
    } as CSSStyleDeclaration);

    await enhanceFrontendContent(root, { features: { syntaxHighlight: true } }, windowRef);
    await enhanceFrontendContent(root, { features: { syntaxHighlight: true } }, windowRef);

    const pre = root.querySelector('pre');
    const code = root.querySelector('code');
    const gutters = root.querySelectorAll('.easymde-code-line-number-gutter');
    expect(highlightElement).toHaveBeenCalledTimes(1);
    expect(gutters).toHaveLength(1);
    expect(gutters[0]?.getAttribute('aria-hidden')).toBe('true');
    expect(gutters[0]?.querySelectorAll('span')).toHaveLength(3);
    expect(gutters[0]?.textContent).toBe('');
    expect(pre?.style.getPropertyValue('--easymde-code-line-number-color'))
      .toBe('rgb(171, 178, 191)');
    expect(code?.textContent).toBe('const one = 1;\nconst two = 2;\nreturn one + two;\n');
    expect(pre?.textContent).toBe(code?.textContent);
  });

  it('does not add line numbers outside the enabled root or to mixed-case Mermaid code', async () => {
    const root = document.createElement('article');
    root.className = 'easymde-code-line-numbers';
    root.innerHTML = [
      '<pre><code class="language-javascript">const numbered = true;</code></pre>',
      '<pre><code class="language-Mermaid">graph TD; A--&gt;B;</code></pre>'
    ].join('');
    const windowRef = runtime();
    windowRef.hljs = { highlightElement: vi.fn() };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgb(12, 34, 56)',
      color: 'rgb(171, 178, 191)'
    } as CSSStyleDeclaration);

    await enhanceFrontendContent(
      root,
      { features: { mermaid: true, syntaxHighlight: true } },
      windowRef
    );

    expect(root.querySelectorAll('.easymde-code-line-number-gutter')).toHaveLength(1);
    expect(
      root.querySelector('.language-javascript')?.parentElement?.classList
        .contains('easymde-code-with-line-numbers')
    ).toBe(true);
    expect(
      root.querySelector('.language-Mermaid')?.parentElement?.classList
        .contains('easymde-code-with-line-numbers')
    ).toBe(false);
  });

  it('keeps Mermaid fences readable as code when the optional renderer is unavailable', async () => {
    const root = document.createElement('article');
    root.innerHTML = '<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>';
    const windowRef = runtime();
    const highlighted: HTMLElement[] = [];
    windowRef.hljs = {
      highlightElement: (code) => highlighted.push(code)
    };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgb(12, 34, 56)'
    } as CSSStyleDeclaration);

    await enhanceFrontendContent(
      root,
      { features: { mermaid: false, syntaxHighlight: false } },
      windowRef
    );

    const code = root.querySelector('code');
    expect(code?.classList.contains('hljs')).toBe(true);
    expect(highlighted).toEqual([]);
    expect(code?.dataset.easymdeHighlighted).toBeUndefined();
    expect(code?.parentElement?.getAttribute('data-easymde-mermaid-fallback')).toBe('1');
    expect(code?.parentElement?.style.getPropertyValue('--easymde-code-frame-background'))
      .toBe('rgb(12, 34, 56)');
  });

  it('exposes a Mermaid asset contract failure without changing the fallback presentation', async () => {
    const root = document.createElement('article');
    root.innerHTML = '<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>';
    const windowRef = runtime();

    await enhanceFrontendContent(
      root,
      {
        features: {
          mermaid: false,
          syntaxHighlight: false,
          mermaidAssetError: 'frontend-enhancement-frontend-mermaid-build-integrity-invalid'
        }
      },
      windowRef
    );

    const pre = root.querySelector('pre');
    expect(pre?.getAttribute('data-easymde-mermaid-fallback')).toBe('1');
    expect(pre?.getAttribute('data-easymde-mermaid-error'))
      .toBe('frontend-enhancement-frontend-mermaid-build-integrity-invalid');
    expect(pre?.classList.contains('easymde-render-error')).toBe(false);
  });

  it('keeps KaTeX normalization, options, and rendered marker behavior unchanged', async () => {
    const root = document.createElement('article');
    root.innerHTML = '<span class="easymde-math easymde-math-block">$$frac{a}{b}$$</span>';
    const windowRef = runtime();
    const render = vi.fn();
    windowRef.katex = { render };

    await renderMathContent(root, { features: { math: true } }, windowRef);

    expect(render).toHaveBeenCalledWith(
      '\\frac{a}{b}',
      root.querySelector('.easymde-math'),
      { displayMode: true, throwOnError: false, strict: 'warn' }
    );
    expect(root.querySelector('.easymde-math')?.getAttribute('data-easymde-rendered'))
      .toBe('1');
  });

  it('does not yield between short enhancement batches', async () => {
    const root = document.createElement('article');
    root.innerHTML = [
      ...Array.from({ length: 6 }, (_, index) =>
        `<pre><code class="language-javascript">const value${index} = ${index};</code></pre>`
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        `<span class="easymde-math easymde-math-inline">$x_${index}$</span>`
      )
    ].join('');
    const windowRef = runtime();
    const highlightElement = vi.fn();
    const mathRender = vi.fn();
    windowRef.hljs = { highlightElement };
    windowRef.katex = { render: mathRender };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgb(12, 34, 56)',
      color: 'rgb(171, 178, 191)'
    } as CSSStyleDeclaration);
    const fake = scheduler();

    await enhanceFrontendContent(
      root,
      { features: { syntaxHighlight: true } },
      windowRef,
      { scheduler: fake.scheduler }
    );
    await renderMathContent(
      root,
      { features: { math: true } },
      windowRef,
      { scheduler: fake.scheduler }
    );

    expect(highlightElement).toHaveBeenCalledTimes(6);
    expect(mathRender).toHaveBeenCalledTimes(6);
    expect(fake.yields).toBe(0);
  });

  it('yields only after the accumulated enhancement slice exceeds 8ms', async () => {
    const root = document.createElement('article');
    root.innerHTML = Array.from({ length: 12 }, (_, index) =>
      `<pre><code class="language-javascript">const value${index} = ${index};</code></pre>`
    ).join('');
    const windowRef = runtime();
    let clock = 0;
    const highlightElement = vi.fn(() => {
      clock += 1;
    });
    windowRef.hljs = { highlightElement };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgb(12, 34, 56)',
      color: 'rgb(171, 178, 191)'
    } as CSSStyleDeclaration);
    const base = scheduler();
    const timedScheduler: FrontendEnhancementScheduler = {
      now: () => clock,
      yield: base.scheduler.yield
    };

    await enhanceFrontendContent(
      root,
      { features: { syntaxHighlight: true } },
      windowRef,
      { scheduler: timedScheduler }
    );

    expect(highlightElement).toHaveBeenCalledTimes(12);
    expect(base.yields).toBeGreaterThan(0);
    expect(base.yields).toBeLessThan(12);
  });

  it('lets the browser paint between default enhancement slices', async () => {
    const root = document.createElement('article');
    root.innerHTML = [
      '<pre><code class="language-javascript">const first = 1;</code></pre>',
      '<pre><code class="language-javascript">const second = 2;</code></pre>'
    ].join('');
    const windowRef = runtime();
    let clock = 0;
    Object.defineProperty(windowRef, 'performance', {
      configurable: true,
      value: { now: () => clock }
    });
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(clock);
      return 1;
    });
    Object.defineProperty(windowRef, 'requestAnimationFrame', {
      configurable: true,
      value: requestAnimationFrame
    });
    windowRef.hljs = {
      highlightElement: () => {
        clock += 9;
      }
    };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgb(12, 34, 56)',
      color: 'rgb(171, 178, 191)'
    } as CSSStyleDeclaration);

    await enhanceFrontendContent(
      root,
      { features: { syntaxHighlight: true } },
      windowRef
    );

    expect(requestAnimationFrame).toHaveBeenCalled();
  });

  it('finishes enhancement when requestAnimationFrame never invokes its callback', async () => {
    const root = document.createElement('article');
    root.className = 'easymde-code-line-numbers';
    root.innerHTML = [
      '<pre><code class="language-javascript">const first = 1;</code></pre>',
      '<pre><code class="language-javascript">const second = 2;</code></pre>'
    ].join('');
    const windowRef = runtime();
    let clock = 0;
    Object.defineProperty(windowRef, 'performance', {
      configurable: true,
      value: { now: () => clock }
    });
    const requestAnimationFrame = vi.fn(() => 1);
    Object.defineProperty(windowRef, 'requestAnimationFrame', {
      configurable: true,
      value: requestAnimationFrame
    });
    Object.defineProperty(windowRef, 'setTimeout', {
      configurable: true,
      value: window.setTimeout.bind(window)
    });
    windowRef.hljs = {
      highlightElement: () => {
        clock += 9;
      }
    };
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      backgroundColor: 'rgb(12, 34, 56)',
      color: 'rgb(171, 178, 191)'
    } as CSSStyleDeclaration);

    const completion = Promise.race([
      enhanceFrontendContent(
        root,
        { features: { syntaxHighlight: true } },
        windowRef
      ).then(() => 'complete' as const),
      new Promise<'timeout'>((resolve) => {
        window.setTimeout(() => resolve('timeout'), 100);
      })
    ]);

    expect(await completion).toBe('complete');
    expect(requestAnimationFrame).toHaveBeenCalled();
    expect(root.querySelectorAll('.easymde-code-line-number-gutter > span'))
      .toHaveLength(2);
  });

  it('renders Mermaid serially and stops between blocks when the owner is stale', async () => {
    const root = document.createElement('article');
    root.innerHTML = [
      '<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>',
      '<pre><code class="language-mermaid">graph TD; B--&gt;C;</code></pre>'
    ].join('');
    const windowRef = runtime();
    const first = deferred<{ svg: string }>();
    let active = true;
    let clock = 0;
    const render = vi
      .fn()
      .mockImplementationOnce(() => {
        clock = 9;
        return first.promise;
      })
      .mockResolvedValueOnce({ svg: '<svg data-index="2"></svg>' });
    windowRef.mermaid = {
      initialize: vi.fn(),
      render
    };
    const fake = scheduler();
    const timedScheduler: FrontendEnhancementScheduler = {
      now: () => clock,
      yield: fake.scheduler.yield
    };
    const operation = renderMermaidContent(
      root,
      { features: { mermaid: true } },
      windowRef,
      {
        control: { isCurrent: () => active },
        scheduler: timedScheduler
      }
    );

    expect(render).toHaveBeenCalledOnce();
    active = false;
    first.resolve({ svg: '<svg data-index="1"></svg>' });
    await operation;

    expect(render).toHaveBeenCalledOnce();
    expect(root.querySelectorAll('.easymde-mermaid')).toHaveLength(0);
    expect(fake.yields).toBeGreaterThan(0);
  });

  it('stops scheduled math work when its AbortSignal is cancelled between blocks', async () => {
    const root = document.createElement('article');
    root.innerHTML = [
      '<span class="easymde-math easymde-math-inline">$x$</span>',
      '<span class="easymde-math easymde-math-inline">$y$</span>'
    ].join('');
    const windowRef = runtime();
    const render = vi.fn();
    windowRef.katex = { render };
    const controller = new AbortController();
    let clock = 0;
    const fake = scheduler();
    const timedScheduler: FrontendEnhancementScheduler = {
      now: () => clock,
      yield: fake.scheduler.yield
    };
    render.mockImplementation(() => {
      clock += 9;
    });
    const abortingScheduler: FrontendEnhancementScheduler = {
      now: fake.scheduler.now,
      yield: async () => {
        await fake.scheduler.yield();
        controller.abort();
      }
    };

    await renderMathContent(
      root,
      { features: { math: true } },
      windowRef,
      {
        control: { signal: controller.signal },
        scheduler: {
          now: timedScheduler.now,
          yield: abortingScheduler.yield
        }
      }
    );

    expect(render).toHaveBeenCalledOnce();
    expect(root.querySelectorAll('[data-easymde-rendered]')).toHaveLength(1);
    expect(fake.yields).toBe(1);
  });

  it('keeps Mermaid replacement and rendering failure markers unchanged', async () => {
    const root = document.createElement('article');
    const maliciousSequence = 'sequenceDiagram\nA-&gt;&gt;B: &lt;img src=x onerror=alert(1)&gt;';
    root.innerHTML = `<pre><code class="language-mermaid">${maliciousSequence}</code></pre>`;
    const windowRef = runtime();
    const initialize = vi.fn();
    windowRef.mermaid = {
      initialize,
      render: vi.fn().mockResolvedValue({ svg: '<svg aria-label="diagram"></svg>' })
    };

    await renderMermaidContent(root, { features: { mermaid: true } }, windowRef);

    expect(initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      fontFamily: '"trebuchet ms", verdana, arial, sans-serif',
      fontSize: 16,
      flowchart: {
        diagramPadding: 12
      },
      themeCSS: expect.stringContaining('font-weight: 400 !important;')
    });
    const initialization = initialize.mock.calls[0]?.[0];
    expect(initialization?.themeCSS).toContain('box-sizing: border-box !important;');
    expect(initialization?.themeCSS).toContain('font-family: "trebuchet ms", verdana, arial, sans-serif !important;');
    expect(initialization?.themeCSS).toContain('font-size: 16px !important;');
    expect(initialization?.themeCSS).toContain('line-height: 20px !important;');
    expect(initialization?.themeCSS).toContain('letter-spacing: normal !important;');
    expect(initialization?.themeCSS).toContain('word-spacing: normal !important;');
    expect(initialization?.themeCSS).toContain('white-space: nowrap !important;');
    expect(initialization?.themeCSS).toContain('margin: 0 !important;');
    expect(initialization?.themeCSS).toContain('padding: 0 !important;');
    expect(initialization?.themeCSS).toContain('display: table-cell !important;');
    expect(windowRef.mermaid.render).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('<img src=x onerror=alert(1)>')
    );
    expect(root.querySelector('.easymde-mermaid svg')?.getAttribute('aria-label'))
      .toBe('diagram');
    expect(root.querySelector('pre')).toBeNull();
  });

  it('keeps a Mermaid rejection visible on the original pre element', async () => {
    const root = document.createElement('article');
    root.innerHTML = '<pre><code class="language-mermaid">invalid</code></pre>';
    const windowRef = runtime();
    windowRef.mermaid = {
      initialize: vi.fn(),
      render: vi.fn().mockRejectedValue(new Error('renderer failed'))
    };

    await renderMermaidContent(
      root,
      { features: { mermaid: true }, strings: { renderingFailed: 'Rendering failed.' } },
      windowRef
    );

    const pre = root.querySelector('pre');
    expect(pre?.classList.contains('easymde-render-error')).toBe(true);
    expect(pre?.getAttribute('data-easymde-error')).toBe('Rendering failed.');
  });

  it('batches all getComputedStyle reads before any DOM writes in syncCodeFrameBackgrounds', () => {
    const root = document.createElement('article');
    root.innerHTML = Array.from({ length: 5 }, (_, index) =>
      `<pre class="easymde-code-with-line-numbers"><code class="hljs language-javascript">const n = ${index};</code></pre>`
    ).join('');
    const events: string[] = [];
    const windowRef = runtime();
    Object.defineProperty(windowRef, 'getComputedStyle', {
      configurable: true,
      value: vi.fn(() => {
        events.push('read');
        return {
          backgroundColor: 'rgb(12, 34, 56)',
          color: 'rgb(171, 178, 191)'
        } as CSSStyleDeclaration;
      })
    });
    const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
    const trackedSetProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
      .mockImplementation(function (
        this: CSSStyleDeclaration,
        property: string,
        value: string | null,
        priority?: string
      ) {
        events.push(`write:${property}`);
        originalSetProperty.call(this, property, value, priority);
      });

    try {
      syncCodeFrameBackgrounds(root, windowRef);

      const firstWriteIndex = events.findIndex((event) => event.startsWith('write:'));
      const lastReadIndex = events.lastIndexOf('read');
      expect(events.filter((event) => 'read' === event)).toHaveLength(5);
      expect(firstWriteIndex).toBeGreaterThan(lastReadIndex);
      for (const pre of root.querySelectorAll('pre')) {
        expect(pre.style.getPropertyValue('--easymde-code-frame-background'))
          .toBe('rgb(12, 34, 56)');
        expect(pre.style.getPropertyValue('--easymde-code-line-number-color'))
          .toBe('rgb(171, 178, 191)');
      }
    } finally {
      trackedSetProperty.mockRestore();
    }
  });

  it('batches getComputedStyle reads before gutter and code-frame writes during highlightCode', async () => {
    const root = document.createElement('article');
    root.className = 'easymde-code-line-numbers';
    root.innerHTML = Array.from({ length: 4 }, (_, index) =>
      `<pre><code class="language-javascript">const a = ${index};\nconst b = ${index + 1};</code></pre>`
    ).join('');
    const events: string[] = [];
    const windowRef = runtime();
    windowRef.hljs = { highlightElement: vi.fn() };
    Object.defineProperty(windowRef, 'getComputedStyle', {
      configurable: true,
      value: vi.fn(() => {
        events.push('read');
        return {
          backgroundColor: 'rgb(12, 34, 56)',
          color: 'rgb(171, 178, 191)'
        } as CSSStyleDeclaration;
      })
    });
    const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
    const trackedSetProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty')
      .mockImplementation(function (
        this: CSSStyleDeclaration,
        property: string,
        value: string | null,
        priority?: string
      ) {
        events.push(`write:${property}`);
        originalSetProperty.call(this, property, value, priority);
      });

    try {
      await enhanceFrontendContent(
        root,
        { features: { syntaxHighlight: true } },
        windowRef
      );

      const firstWriteIndex = events.findIndex((event) => event.startsWith('write:'));
      const lastReadIndex = events.lastIndexOf('read');
      expect(events.filter((event) => 'read' === event)).toHaveLength(4);
      expect(firstWriteIndex).toBeGreaterThan(lastReadIndex);
      expect(root.querySelectorAll('.easymde-code-line-number-gutter')).toHaveLength(4);
    } finally {
      trackedSetProperty.mockRestore();
    }
  });

  it('yields after every Mermaid diagram even when each render stays under 8ms', async () => {
    const root = document.createElement('article');
    root.innerHTML = Array.from({ length: 3 }, (_, index) =>
      `<pre><code class="language-mermaid">graph TD; A${index}--&gt;B${index};</code></pre>`
    ).join('');
    const windowRef = runtime();
    const render = vi.fn().mockResolvedValue({ svg: '<svg></svg>' });
    windowRef.mermaid = { initialize: vi.fn(), render };
    const fake = scheduler([0]);

    await renderMermaidContent(
      root,
      { features: { mermaid: true } },
      windowRef,
      { scheduler: fake.scheduler }
    );

    expect(render).toHaveBeenCalledTimes(3);
    expect(root.querySelectorAll('.easymde-mermaid')).toHaveLength(3);
    expect(fake.yields).toBe(2);
  });

  it('bounds KaTeX rendering slices on large math batches even under the 8ms clock budget', async () => {
    const root = document.createElement('article');
    root.innerHTML = Array.from({ length: 20 }, (_, index) =>
      `<span class="easymde-math easymde-math-inline">$x_${index}$</span>`
    ).join('');
    const windowRef = runtime();
    const render = vi.fn();
    windowRef.katex = { render };
    const fake = scheduler([0]);

    await renderMathContent(
      root,
      { features: { math: true } },
      windowRef,
      { scheduler: fake.scheduler }
    );

    expect(render).toHaveBeenCalledTimes(20);
    expect(fake.yields).toBe(2);
  });

  it('prefers requestAnimationFrame over a nonzero fallback timer and cancels the fallback when rAF fires', async () => {
    const root = document.createElement('article');
    root.innerHTML = [
      '<pre><code class="language-javascript">const first = 1;</code></pre>',
      '<pre><code class="language-javascript">const second = 2;</code></pre>'
    ].join('');
    const windowRef = runtime();
    let clock = 0;
    Object.defineProperty(windowRef, 'performance', {
      configurable: true,
      value: { now: () => clock }
    });
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return 7;
    });
    const setTimeoutSpy = vi.fn((_handler: TimerHandler, _delay?: number) => 42);
    const clearTimeoutSpy = vi.fn();
    Object.defineProperty(windowRef, 'requestAnimationFrame', {
      configurable: true,
      value: requestAnimationFrame
    });
    Object.defineProperty(windowRef, 'setTimeout', {
      configurable: true,
      value: setTimeoutSpy
    });
    Object.defineProperty(windowRef, 'clearTimeout', {
      configurable: true,
      value: clearTimeoutSpy
    });
    windowRef.hljs = {
      highlightElement: () => {
        clock += 9;
      }
    };
    Object.defineProperty(windowRef, 'getComputedStyle', {
      configurable: true,
      value: vi.fn(() => ({
        backgroundColor: 'rgb(12, 34, 56)',
        color: 'rgb(171, 178, 191)'
      } as CSSStyleDeclaration))
    });

    const operation = enhanceFrontendContent(
      root,
      { features: { syntaxHighlight: true } },
      windowRef
    );
    await Promise.resolve();

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(setTimeoutSpy).toHaveBeenCalledOnce();
    expect(setTimeoutSpy.mock.calls[0]?.[1]).toBeGreaterThanOrEqual(32);

    rafCallbacks.shift()?.(16);
    await operation;

    expect(clearTimeoutSpy).toHaveBeenCalledWith(42);
  });

  it('reuses cached Mermaid SVGs with rewritten unique renderIds and skips per-item yields on cache hits', async () => {
    const windowRef = runtime();
    const initialize = vi.fn();
    const render = vi.fn(async (id: string, source: string) => ({
      svg: `<svg id="${id}" data-source="${source}"><style>#${id} .node{}</style><g id="${id}-node"></g></svg>`
    }));
    windowRef.mermaid = { initialize, render };

    const makeRoot = () => {
      const root = document.createElement('article');
      root.innerHTML = Array.from({ length: 3 }, (_, index) =>
        `<pre><code class="language-mermaid">graph TD; A${index}--&gt;B${index};</code></pre>`
      ).join('');
      return root;
    };

    const firstRoot = makeRoot();
    const coldScheduler = scheduler([0]);
    await renderMermaidContent(
      firstRoot,
      { features: { mermaid: true } },
      windowRef,
      { scheduler: coldScheduler.scheduler }
    );

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(3);
    expect(coldScheduler.yields).toBe(2);
    const firstPassIds = [...firstRoot.querySelectorAll('.easymde-mermaid svg')]
      .map((svg) => svg.getAttribute('id'));
    expect(new Set(firstPassIds).size).toBe(3);

    const secondRoot = makeRoot();
    const warmScheduler = scheduler([0]);
    await renderMermaidContent(
      secondRoot,
      { features: { mermaid: true } },
      windowRef,
      { scheduler: warmScheduler.scheduler }
    );

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(3);
    expect(warmScheduler.yields).toBe(0);

    const secondPassSvgs = [...secondRoot.querySelectorAll('.easymde-mermaid svg')];
    expect(secondPassSvgs).toHaveLength(3);
    const secondPassIds = secondPassSvgs.map((svg) => svg.getAttribute('id'));
    expect(new Set(secondPassIds).size).toBe(3);
    for (const [index, svg] of secondPassSvgs.entries()) {
      const id = secondPassIds[index];
      expect(id).toBeTruthy();
      expect(firstPassIds).not.toContain(id);
      expect(svg.querySelector('style')?.textContent).toContain(`#${id} .node{}`);
      expect(svg.querySelector('g')?.getAttribute('id')).toBe(`${id}-node`);
    }

    // Cached hits still yield when the 8ms slice time budget is exceeded.
    const timedRoot = makeRoot();
    let clock = 0;
    let timedYields = 0;
    const timedScheduler: FrontendEnhancementScheduler = {
      now: () => {
        clock += 5;
        return clock;
      },
      yield: async () => {
        timedYields += 1;
      }
    };
    await renderMermaidContent(
      timedRoot,
      { features: { mermaid: true } },
      windowRef,
      { scheduler: timedScheduler }
    );
    expect(render).toHaveBeenCalledTimes(3);
    expect(timedYields).toBeGreaterThan(0);
    expect(timedRoot.querySelectorAll('.easymde-mermaid svg')).toHaveLength(3);
  });

  it('isolates the Mermaid cache per runtime instance, enforces eligibility guards, and evicts LRU entries past 256', async () => {
    const createMermaidWindow = () => {
      const windowRef = runtime();
      const render = vi.fn(async (id: string, source: string) => ({
        svg: `<svg id="${id}">${source}</svg>`
      }));
      windowRef.mermaid = { initialize: vi.fn(), render };
      return { render, windowRef };
    };

    const first = createMermaidWindow();
    const second = createMermaidWindow();
    const fake = scheduler([0]);

    const renderSources = async (
      windowRef: FrontendEnhancementWindow,
      sources: string[]
    ) => {
      const root = document.createElement('article');
      root.innerHTML = sources
        .map((source) => `<pre><code class="language-mermaid">${source}</code></pre>`)
        .join('');
      await renderMermaidContent(
        root,
        { features: { mermaid: true } },
        windowRef,
        { scheduler: fake.scheduler }
      );
      return root;
    };

    // Runtime isolation: same source on a distinct mermaid runtime is a miss.
    await renderSources(first.windowRef, ['graph TD; X-->Y;']);
    await renderSources(second.windowRef, ['graph TD; X-->Y;']);
    expect(first.render).toHaveBeenCalledTimes(1);
    expect(second.render).toHaveBeenCalledTimes(1);

    // LRU eviction past 256 entries on a fresh runtime.
    const lru = createMermaidWindow();
    const initial256 = Array.from({ length: 256 }, (_, index) => `graph TD; N${index}-->M${index};`);
    const diagram0 = 'graph TD; N0-->M0;';
    const diagram1 = 'graph TD; N1-->M1;';
    await renderSources(lru.windowRef, initial256);
    expect(lru.render).toHaveBeenCalledTimes(256);

    // Refresh entry 0 so entry 1 becomes the least-recently-used entry.
    await renderSources(lru.windowRef, [diagram0]);
    expect(lru.render).toHaveBeenCalledTimes(256);

    // Insert entry 256 -> evicts entry 1, keeps entry 0.
    await renderSources(lru.windowRef, ['graph TD; N256-->M256;']);
    expect(lru.render).toHaveBeenCalledTimes(257);

    await renderSources(lru.windowRef, [diagram0]);
    expect(lru.render).toHaveBeenCalledTimes(257);

    await renderSources(lru.windowRef, [diagram1]);
    expect(lru.render).toHaveBeenCalledTimes(258);

    // Eligibility guards: missing renderId in SVG or oversized source/SVG skip caching.
    const guardedWindow = runtime();
    const guardedRender = vi.fn(async (id: string, source: string) => {
      if (source.startsWith('no-id')) return { svg: '<svg></svg>' };
      if (source.startsWith('huge-svg')) {
        return { svg: `<svg id="${id}">${'x'.repeat(128 * 1024 + 1)}</svg>` };
      }
      return { svg: `<svg id="${id}"></svg>` };
    });
    guardedWindow.mermaid = { initialize: vi.fn(), render: guardedRender };

    const hugeSource = `graph TD; ${'A'.repeat(16 * 1024 + 1)}`;
    await renderSources(guardedWindow, ['no-id', 'huge-svg', hugeSource]);
    await renderSources(guardedWindow, ['no-id', 'huge-svg', hugeSource]);
    expect(guardedRender).toHaveBeenCalledTimes(6);
  });

  it('caches KaTeX HTML per runtime by displayMode and TeX, skips per-item yields on hits, and evicts LRU entries past 128', async () => {
    const createKatexWindow = () => {
      const windowRef = runtime();
      const render = vi.fn(
        (
          tex: string,
          element: HTMLElement,
          options: Readonly<{ displayMode: boolean; throwOnError: boolean; strict: string }>
        ) => {
          if ('throw' === tex) {
            throw new Error('katex-failed');
          }
          if ('empty' === tex) {
            element.innerHTML = '';
            return;
          }
          if ('huge-html' === tex) {
            element.innerHTML = `<span>${'y'.repeat(32 * 1024 + 1)}</span>`;
            return;
          }
          element.innerHTML = `<span class="${options.displayMode ? 'katex-display' : 'katex'}">${tex}</span>`;
        }
      );
      windowRef.katex = { render };
      return { render, windowRef };
    };

    const first = createKatexWindow();
    const second = createKatexWindow();
    const fake = scheduler([0]);

    // Same TeX in inline vs display mode must stay distinct in cache.
    const mixedRoot = document.createElement('article');
    mixedRoot.innerHTML = [
      '<span class="easymde-math easymde-math-inline">\\(x^2\\)</span>',
      '<span class="easymde-math easymde-math-block">$$x^2$$</span>'
    ].join('');
    await renderMathContent(
      mixedRoot,
      { features: { math: true } },
      first.windowRef,
      { scheduler: fake.scheduler }
    );
    expect(first.render).toHaveBeenCalledTimes(2);
    expect(mixedRoot.querySelector('.easymde-math-inline')?.innerHTML)
      .toBe('<span class="katex">x^2</span>');
    expect(mixedRoot.querySelector('.easymde-math-block')?.innerHTML)
      .toBe('<span class="katex-display">x^2</span>');

    // Runtime isolation: second katex runtime does not share first runtime's cache.
    const isolatedRoot = document.createElement('article');
    isolatedRoot.innerHTML = '<span class="easymde-math easymde-math-inline">\\(x^2\\)</span>';
    await renderMathContent(
      isolatedRoot,
      { features: { math: true } },
      second.windowRef,
      { scheduler: fake.scheduler }
    );
    expect(second.render).toHaveBeenCalledTimes(1);

    // 20 cached math nodes skip per-item slice yields (0 yields under 8ms) and call render 0 times.
    const cachedBatchRoot = document.createElement('article');
    cachedBatchRoot.innerHTML = Array.from({ length: 20 }, (_, index) =>
      0 === index % 2
        ? '<span class="easymde-math easymde-math-inline">\\(x^2\\)</span>'
        : '<span class="easymde-math easymde-math-block">$$x^2$$</span>'
    ).join('');
    const warmScheduler = scheduler([0]);
    await renderMathContent(
      cachedBatchRoot,
      { features: { math: true } },
      first.windowRef,
      { scheduler: warmScheduler.scheduler }
    );
    expect(first.render).toHaveBeenCalledTimes(2);
    expect(warmScheduler.yields).toBe(0);
    expect(cachedBatchRoot.querySelectorAll('[data-easymde-rendered="1"]')).toHaveLength(20);
    expect(cachedBatchRoot.querySelector('.easymde-math-inline')?.innerHTML)
      .toBe('<span class="katex">x^2</span>');
    expect(cachedBatchRoot.querySelector('.easymde-math-block')?.innerHTML)
      .toBe('<span class="katex-display">x^2</span>');

    // Cached hits still obey the 8ms clock budget.
    const timedRoot = document.createElement('article');
    timedRoot.innerHTML = Array.from({ length: 4 }, () =>
      '<span class="easymde-math easymde-math-inline">\\(x^2\\)</span>'
    ).join('');
    let clock = 0;
    let timedYields = 0;
    await renderMathContent(
      timedRoot,
      { features: { math: true } },
      first.windowRef,
      {
        scheduler: {
          now: () => {
            clock += 5;
            return clock;
          },
          yield: async () => {
            timedYields += 1;
          }
        }
      }
    );
    expect(first.render).toHaveBeenCalledTimes(2);
    expect(timedYields).toBeGreaterThan(0);

    // LRU eviction past 128 entries.
    const lru = createKatexWindow();
    const renderTexBatch = async (expressions: string[]) => {
      const root = document.createElement('article');
      root.innerHTML = expressions
        .map((expr) => `<span class="easymde-math easymde-math-inline">\\(${expr}\\)</span>`)
        .join('');
      await renderMathContent(
        root,
        { features: { math: true } },
        lru.windowRef,
        { scheduler: fake.scheduler }
      );
      return root;
    };

    const initial128 = Array.from({ length: 128 }, (_, index) => `v_${index}`);
    await renderTexBatch(initial128);
    expect(lru.render).toHaveBeenCalledTimes(128);

    // Refresh v_0 so v_1 becomes the least-recently-used entry.
    await renderTexBatch(['v_0']);
    expect(lru.render).toHaveBeenCalledTimes(128);

    // Insert v_128 -> evicts v_1, retains v_0.
    await renderTexBatch(['v_128']);
    expect(lru.render).toHaveBeenCalledTimes(129);

    await renderTexBatch(['v_0']);
    expect(lru.render).toHaveBeenCalledTimes(129);

    await renderTexBatch(['v_1']);
    expect(lru.render).toHaveBeenCalledTimes(130);

    // Guarded entries (throw, empty HTML, oversized TeX, oversized HTML) skip caching.
    const guarded = createKatexWindow();
    const hugeTex = 'z'.repeat(4 * 1024 + 1);
    const renderGuarded = async () => {
      const root = document.createElement('article');
      root.innerHTML = [
        '<span class="easymde-math easymde-math-inline">throw</span>',
        '<span class="easymde-math easymde-math-inline">empty</span>',
        '<span class="easymde-math easymde-math-inline">huge-html</span>',
        `<span class="easymde-math easymde-math-inline">${hugeTex}</span>`
      ].join('');
      await renderMathContent(
        root,
        { features: { math: true } },
        guarded.windowRef,
        { scheduler: fake.scheduler }
      );
      return root;
    };
    const guardedFirst = await renderGuarded();
    expect(guardedFirst.querySelector('.easymde-render-error')).not.toBeNull();
    await renderGuarded();
    expect(guarded.render).toHaveBeenCalledTimes(8);
  });

  it('caches at least 100 distinct Mermaid diagrams without LRU eviction thrashing', async () => {
    const windowRef = runtime();
    const render = vi.fn(async (id: string, source: string) => ({
      svg: `<svg id="${id}">${source}</svg>`
    }));
    windowRef.mermaid = {
      initialize: vi.fn(),
      render
    };
    const fake = scheduler();
    const diagrams = Array.from(
      { length: 100 },
      (_, index) => `graph LR; N${index + 1}-->M${index + 1};`
    );
    const renderPass = async () => {
      const root = document.createElement('article');
      root.innerHTML = diagrams
        .map((diagram) => `<pre><code class="language-mermaid">${diagram}</code></pre>`)
        .join('');
      await renderMermaidContent(
        root,
        { features: { mermaid: true } },
        windowRef,
        { scheduler: fake.scheduler }
      );
      expect(root.querySelectorAll('.easymde-mermaid svg')).toHaveLength(100);
    };

    await renderPass();
    expect(render).toHaveBeenCalledTimes(100);

    await renderPass();
    expect(render).toHaveBeenCalledTimes(100);
  });
});
