import { describe, expect, it, vi } from 'vitest';

import {
  enhanceFrontendContent,
  renderMathContent,
  renderMermaidContent,
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
      backgroundColor: 'rgb(12, 34, 56)'
    } as CSSStyleDeclaration);

    await enhanceFrontendContent(root, { features: { syntaxHighlight: true } }, windowRef);

    const code = root.querySelector('code');
    expect(code?.classList.contains('hljs')).toBe(true);
    expect(code?.dataset.easymdeHighlighted).toBe('1');
    expect(highlighted).toEqual([code]);
    expect(code?.parentElement?.style.getPropertyValue('--easymde-code-frame-background'))
      .toBe('rgb(12, 34, 56)');
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

  it('keeps KaTeX normalization, options, and rendered marker behavior unchanged', () => {
    const root = document.createElement('article');
    root.innerHTML = '<span class="easymde-math easymde-math-block">$$frac{a}{b}$$</span>';
    const windowRef = runtime();
    const render = vi.fn();
    windowRef.katex = { render };

    renderMathContent(root, { features: { math: true } }, windowRef);

    expect(render).toHaveBeenCalledWith(
      '\\frac{a}{b}',
      root.querySelector('.easymde-math'),
      { displayMode: true, throwOnError: false, strict: 'warn' }
    );
    expect(root.querySelector('.easymde-math')?.getAttribute('data-easymde-rendered'))
      .toBe('1');
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
      theme: 'default'
    });
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
});
