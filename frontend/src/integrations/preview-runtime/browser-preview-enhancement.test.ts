import { afterEach, describe, expect, it, vi } from 'vitest';

import { previewEnhancementBootstrapFixture } from '../../test/preview-enhancement-bootstrap-fixture';
import {
  createBrowserPreviewEnhancementPort,
  type PreviewEnhancementBrowserRuntime
} from './browser-preview-enhancement';

const appended: Element[] = [];

function runtime(
  enhance = vi.fn().mockResolvedValue(undefined)
): PreviewEnhancementBrowserRuntime {
  return {
    getEnhancements: () => ({ enhance }),
    hasHighlight: () => true,
    hasKatex: () => true,
    hasMathRenderer: () => true,
    hasMermaid: () => true,
    hasMermaidRenderer: () => true
  };
}

function context(codeTheme = 'github') {
  return { codeTheme, signal: new AbortController().signal };
}

function autoLoadResources() {
  const append = document.head.appendChild.bind(document.head);
  return vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
    const result = append(node);
    if (node instanceof Element) appended.push(node);
    queueMicrotask(() => node.dispatchEvent(new Event('load')));
    return result;
  });
}

afterEach(() => {
  for (const node of appended.splice(0)) node.remove();
  vi.restoreAllMocks();
});

describe('createBrowserPreviewEnhancementPort', () => {
  it('leaves plain server-rendered preview untouched and loads no optional assets', async () => {
    const enhance = vi.fn();
    const append = autoLoadResources();
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime(enhance) }
    );

    await port.enhance(
      document.createElement('article'),
      {},
      () => true,
      context('atom-one-dark')
    );

    expect(append).not.toHaveBeenCalled();
    expect(enhance).not.toHaveBeenCalled();
  });

  it('loads Highlight and fixed-frame styles once and enhances with the current code theme', async () => {
    const enhance = vi.fn().mockResolvedValue(undefined);
    autoLoadResources();
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime(enhance) }
    );
    const surface = document.createElement('article');

    await port.enhance(
      surface,
      { codeBlocks: true, syntaxHighlight: true },
      () => true,
      context('github')
    );
    await port.enhance(
      surface,
      { codeBlocks: true, syntaxHighlight: true },
      () => true,
      context('github')
    );

    expect(document.querySelector('#easymde-code-frame-css')).not.toBeNull();
    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/github.min.css');
    expect(enhance).toHaveBeenCalledTimes(2);
    expect(enhance).toHaveBeenLastCalledWith(surface, {
      features: { codeBlocks: true, syntaxHighlight: true },
      strings: { renderingFailed: 'Rendering failed.' }
    });

    await port.enhance(
      surface,
      { syntaxHighlight: true },
      () => true,
      context('atom-one-dark')
    );
    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/atom-one-dark.min.css');
  });

  it('keeps only the latest code theme and settles superseded out-of-order loads', async () => {
    const port = createBrowserPreviewEnhancementPort(
      {
        ...previewEnhancementBootstrapFixture,
        codeThemes: [
          ...previewEnhancementBootstrapFixture.codeThemes,
          {
            cssUrl: 'https://example.test/wp-content/plugins/easymde/assets/vendor/highlight/styles/monokai.min.css',
            id: 'monokai'
          }
        ]
      },
      { documentRef: document, runtime: runtime() }
    );
    const surface = document.createElement('article');
    let firstCurrent = true;
    let secondCurrent = true;

    const first = port.enhance(
      surface,
      { syntaxHighlight: true },
      () => firstCurrent,
      context('github')
    );
    const firstTheme = document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css');
    firstCurrent = false;
    const second = port.enhance(
      surface,
      { syntaxHighlight: true },
      () => secondCurrent,
      context('atom-one-dark')
    );
    const secondTheme = document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css');
    secondCurrent = false;
    const third = port.enhance(
      surface,
      { syntaxHighlight: true },
      () => true,
      context('monokai')
    );
    const thirdTheme = document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css');
    const codeFrame = document.querySelector<HTMLLinkElement>('#easymde-code-frame-css');
    if (!firstTheme || !secondTheme || !thirdTheme || !codeFrame) {
      throw new Error('expected pending stylesheets');
    }

    thirdTheme.dispatchEvent(new Event('load'));
    firstTheme.dispatchEvent(new Event('load'));
    codeFrame.dispatchEvent(new Event('load'));
    secondTheme.dispatchEvent(new Event('error'));
    const results = await Promise.allSettled([first, second, third]);

    expect(results.map(({ status }) => status)).toEqual(['rejected', 'rejected', 'fulfilled']);
    expect(document.querySelectorAll('[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'))
      .toHaveLength(1);
    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/monokai.min.css');
    expect(firstTheme.isConnected).toBe(false);
    expect(secondTheme.isConnected).toBe(false);
  });

  it('loads KaTeX, Mermaid and TOC resources before invoking shared enhancements', async () => {
    const enhance = vi.fn().mockResolvedValue(undefined);
    autoLoadResources();
    const unavailableRuntime: PreviewEnhancementBrowserRuntime = {
      ...runtime(enhance),
      hasKatex: () => !!document.getElementById('easymde-katex-js'),
      hasMathRenderer: () => !!document.getElementById('easymde-math-renderer-js'),
      hasMermaid: () => !!document.getElementById('easymde-mermaid-js'),
      hasMermaidRenderer: () => !!document.getElementById('easymde-mermaid-renderer-js')
    };
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: unavailableRuntime }
    );

    await port.enhance(
      document.createElement('article'),
      { math: true, mermaid: true, toc: true },
      () => true,
      context('github')
    );

    expect(document.querySelector('#easymde-math-css')).not.toBeNull();
    expect(document.querySelector('#easymde-katex-css')).not.toBeNull();
    expect(document.querySelector('#easymde-toc-css')).not.toBeNull();
    expect(document.querySelector('#easymde-katex-js')).not.toBeNull();
    expect(document.querySelector('#easymde-math-renderer-js')).not.toBeNull();
    expect(document.querySelector('#easymde-mermaid-js')).not.toBeNull();
    expect(document.querySelector('#easymde-mermaid-renderer-js')).not.toBeNull();
    expect(enhance).toHaveBeenCalledTimes(1);
  });

  it('rejects failed assets, missing themes and rendered enhancement errors truthfully', async () => {
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      queueMicrotask(() => node.dispatchEvent(new Event('error')));
      return result;
    });
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime() }
    );

    await expect(port.enhance(
      document.createElement('article'),
      { syntaxHighlight: true },
      () => true,
      context('missing')
    )).rejects.toThrowError('preview-enhancement-code-theme-missing');

    const failedAssetPort = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      {
        documentRef: document,
        runtime: { ...runtime(), hasMermaid: () => false }
      }
    );
    await expect(failedAssetPort.enhance(
      document.createElement('article'),
      { mermaid: true },
      () => true,
      context('github')
    )).rejects.toThrowError('preview-enhancement-resource-load-failed');

    vi.restoreAllMocks();
    const surface = document.createElement('article');
    const enhance = vi.fn().mockImplementation(() => {
      surface.innerHTML = '<pre class="easymde-render-error"></pre>';
    });
    const renderErrorPort = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime(enhance) }
    );
    await expect(renderErrorPort.enhance(
      surface,
      { mermaid: true },
      () => true,
      context('github')
    )).rejects.toThrowError('preview-enhancement-render-failed');
  });

  it('removes a failed script and permits a later explicit preview retry', async () => {
    const append = document.head.appendChild.bind(document.head);
    let mermaidAttempts = 0;
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      queueMicrotask(() => {
        if (node instanceof HTMLScriptElement && 'easymde-mermaid-js' === node.id) {
          mermaidAttempts += 1;
          node.dispatchEvent(new Event(1 === mermaidAttempts ? 'error' : 'load'));
          return;
        }
        node.dispatchEvent(new Event('load'));
      });
      return result;
    });
    const runtimeOwner: PreviewEnhancementBrowserRuntime = {
      ...runtime(),
      hasMermaid: () => !!document.getElementById('easymde-mermaid-js'),
      hasMermaidRenderer: () => !!document.getElementById('easymde-mermaid-renderer-js')
    };
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtimeOwner }
    );

    await expect(port.enhance(
      document.createElement('article'),
      { mermaid: true },
      () => true,
      context()
    )).rejects.toThrowError('preview-enhancement-resource-load-failed');
    expect(document.getElementById('easymde-mermaid-js')).toBeNull();

    await expect(port.enhance(
      document.createElement('article'),
      { mermaid: true },
      () => true,
      context()
    )).resolves.toBeUndefined();
    expect(mermaidAttempts).toBe(2);
  });

  it('settles an aborted request and disposes pending owned resources', async () => {
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      return result;
    });
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      {
        documentRef: document,
        runtime: { ...runtime(), hasMermaid: () => false }
      }
    );
    const controller = new AbortController();
    const operation = port.enhance(
      document.createElement('article'),
      { mermaid: true },
      () => true,
      { codeTheme: 'github', signal: controller.signal }
    );

    controller.abort();
    await expect(operation).rejects.toThrowError('preview-enhancement-resource-stale');
    port.dispose?.();
    expect(document.getElementById('easymde-mermaid-js')).toBeNull();
  });

  it('bounds a never-settling resource load', async () => {
    vi.useFakeTimers();
    try {
      const append = document.head.appendChild.bind(document.head);
      vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
        const result = append(node);
        if (node instanceof Element) appended.push(node);
        return result;
      });
      const port = createBrowserPreviewEnhancementPort(
        previewEnhancementBootstrapFixture,
        {
          documentRef: document,
          runtime: { ...runtime(), hasMermaid: () => false }
        }
      );
      const operation = port.enhance(
        document.createElement('article'),
        { mermaid: true },
        () => true,
        context()
      );
      const rejection = expect(operation).rejects.toThrowError(
        'preview-enhancement-resource-load-failed'
      );

      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;
      expect(document.getElementById('easymde-mermaid-js')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not invoke shared enhancements after the preview generation becomes stale', async () => {
    const enhance = vi.fn();
    autoLoadResources();
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime(enhance) }
    );
    let current = true;
    queueMicrotask(() => { current = false; });

    await port.enhance(
      document.createElement('article'),
      { syntaxHighlight: true },
      () => current,
      context('github')
    );

    expect(enhance).not.toHaveBeenCalled();
  });

  it('fails clearly when the required shared enhancement owner is unavailable', async () => {
    autoLoadResources();
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      {
        documentRef: document,
        runtime: { ...runtime(), getEnhancements: () => null }
      }
    );

    await expect(port.enhance(
      document.createElement('article'),
      { syntaxHighlight: true },
      () => true,
      context('github')
    )).rejects.toThrowError('preview-enhancement-runtime-unavailable');
  });
});
