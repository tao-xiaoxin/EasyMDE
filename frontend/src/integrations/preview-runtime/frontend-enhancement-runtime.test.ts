import { describe, expect, it, vi } from 'vitest';

import {
  enhanceFrontendContent,
  renderMathContent,
  renderMermaidContent,
  type FrontendEnhancementWindow
} from './frontend-enhancement-runtime';

function runtime(): FrontendEnhancementWindow {
  const windowRef = Object.create(window) as FrontendEnhancementWindow;
  delete windowRef.EasyMDEEnhancements;
  delete windowRef.EasyMDEFrontendConfig;
  delete windowRef.EasyMDEMathRenderer;
  delete windowRef.EasyMDEMermaidRenderer;
  delete windowRef.hljs;
  delete windowRef.katex;
  delete windowRef.mermaid;
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
    root.innerHTML = '<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>';
    const windowRef = runtime();
    windowRef.mermaid = {
      initialize: vi.fn(),
      render: vi.fn().mockResolvedValue({ svg: '<svg aria-label="diagram"></svg>' })
    };

    await renderMermaidContent(root, { features: { mermaid: true } }, windowRef);

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
