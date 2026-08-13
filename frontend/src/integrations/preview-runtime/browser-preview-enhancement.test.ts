import { afterEach, describe, expect, it, vi } from 'vitest';

import { previewEnhancementBootstrapFixture } from '../../test/preview-enhancement-bootstrap-fixture';
import {
  createBrowserPreviewEnhancementPort,
  type PreviewEnhancementBrowserRuntime
} from './browser-preview-enhancement';

const appended: Element[] = [];

function runtime(
  enhance = vi.fn().mockResolvedValue(undefined),
  syncCodeFrameBackgrounds = vi.fn()
): PreviewEnhancementBrowserRuntime {
  return {
    getEnhancements: () => ({ enhance, syncCodeFrameBackgrounds }),
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

  it('prepares a code theme without executing document enhancements', async () => {
    const enhance = vi.fn();
    autoLoadResources();
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime(enhance) }
    );

    const prepared = await port.prepareCodeTheme({
      codeTheme: 'github',
      signal: new AbortController().signal
    });

    expect(document.querySelector('#easymde-code-frame-css')).not.toBeNull();
    expect(document.querySelector('#easymde-highlight-theme-css')).toBeNull();
    prepared.commit();
    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/github.min.css');
    expect(enhance).not.toHaveBeenCalled();
  });

  it('keeps the active code stylesheet until commit and removes a cancelled candidate', async () => {
    const append = autoLoadResources();
    const active = document.createElement('link');
    active.id = 'easymde-highlight-theme-css';
    active.rel = 'stylesheet';
    active.href = previewEnhancementBootstrapFixture.codeThemes.find(
      ({ id }) => 'atom-one-dark' === id
    )?.cssUrl ?? '';
    active.dataset.easymdeLoadedHref = active.getAttribute('href') ?? '';
    active.dataset.easymdeStylesheetOwner = active.id;
    document.head.appendChild(active);
    append.mockClear();
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime() }
    );

    const prepared = await port.prepareCodeTheme(context('github'));
    const candidate = document.querySelector<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]:not(#easymde-highlight-theme-css)'
    );
    expect(candidate?.media).toBe('not all');
    expect(document.querySelector('#easymde-highlight-theme-css')).toBe(active);

    prepared.cancel();

    expect(candidate?.isConnected).toBe(false);
    expect(document.querySelector('#easymde-highlight-theme-css')).toBe(active);
    active.remove();
  });

  it('treats reuse of the active stylesheet as a newer successful transaction', async () => {
    autoLoadResources();
    const active = document.createElement('link');
    active.id = 'easymde-highlight-theme-css';
    active.rel = 'stylesheet';
    active.href = previewEnhancementBootstrapFixture.codeThemes.find(
      ({ id }) => 'atom-one-dark' === id
    )?.cssUrl ?? '';
    active.dataset.easymdeLoadedHref = active.getAttribute('href') ?? '';
    active.dataset.easymdeStylesheetOwner = active.id;
    document.head.appendChild(active);
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime() }
    );

    const preparedGithub = await port.prepareCodeTheme(context('github'));
    const reusedAtom = await port.prepareCodeTheme(context('atom-one-dark'));

    reusedAtom.commit();
    preparedGithub.commit();

    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/atom-one-dark.min.css');
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(1);
  });

  it('keeps a pending appearance activation authoritative over a later old preview enhancement', async () => {
    autoLoadResources();
    const active = document.createElement('link');
    active.id = 'easymde-highlight-theme-css';
    active.rel = 'stylesheet';
    active.href = previewEnhancementBootstrapFixture.codeThemes.find(
      ({ id }) => 'atom-one-dark' === id
    )?.cssUrl ?? '';
    active.dataset.easymdeLoadedHref = active.getAttribute('href') ?? '';
    active.dataset.easymdeStylesheetOwner = active.id;
    document.head.appendChild(active);
    const enhance = vi.fn().mockResolvedValue(undefined);
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime(enhance) }
    );
    const surface = document.createElement('article');

    const activation = await port.prepareCodeTheme(context('github'));
    await expect(port.enhance(
      surface,
      { syntaxHighlight: true },
      () => true,
      context('atom-one-dark')
    )).resolves.toBeUndefined();
    activation.commit();

    expect(enhance).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/github.min.css');
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(1);
  });

  it('allows a committed preview enhancement after the pending appearance activation fails', async () => {
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      return result;
    });
    const enhance = vi.fn().mockResolvedValue(undefined);
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime(enhance) }
    );
    const surface = document.createElement('article');

    const activation = port.prepareCodeTheme(context('github'));
    const activationTheme = [...document.querySelectorAll<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )].find((link) => link.href.includes('/github.min.css'));
    const enhancement = port.enhance(
      surface,
      { syntaxHighlight: true },
      () => true,
      context('atom-one-dark')
    );
    const enhancementTheme = [...document.querySelectorAll<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )].find((link) => link.href.includes('/atom-one-dark.min.css'));
    const codeFrame = document.querySelector<HTMLLinkElement>('#easymde-code-frame-css');
    if (!activationTheme || !enhancementTheme || !codeFrame) {
      throw new Error('expected activation and enhancement candidates');
    }

    enhancementTheme.dispatchEvent(new Event('load'));
    codeFrame.dispatchEvent(new Event('load'));
    await enhancement;
    const activationRejection = expect(activation).rejects.toThrowError(
      'preview-enhancement-resource-load-failed'
    );
    activationTheme.dispatchEvent(new Event('error'));
    await activationRejection;

    expect(enhance).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/atom-one-dark.min.css');
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(1);
  });

  it('keeps the last committed activation authoritative over a later stale preview enhancement', async () => {
    autoLoadResources();
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime() }
    );
    const surface = document.createElement('article');

    const activation = await port.prepareCodeTheme(context('github'));
    activation.commit();
    await port.enhance(
      surface,
      { syntaxHighlight: true },
      () => true,
      context('atom-one-dark')
    );

    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/github.min.css');
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(1);
  });

  it('keeps overlapping code-theme preparations independent and makes an older late commit inert', async () => {
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      return result;
    });
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime() }
    );

    const firstOperation = port.prepareCodeTheme(context('github'));
    const firstTheme = document.querySelector<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    );
    const secondOperation = port.prepareCodeTheme(context('atom-one-dark'));
    const candidates = document.querySelectorAll<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    );
    const secondTheme = [...candidates].find((link) => link !== firstTheme);
    const codeFrame = document.querySelector<HTMLLinkElement>('#easymde-code-frame-css');
    if (!firstTheme || !secondTheme || !codeFrame) {
      throw new Error('expected independent pending stylesheets');
    }

    firstTheme.dispatchEvent(new Event('load'));
    secondTheme.dispatchEvent(new Event('load'));
    codeFrame.dispatchEvent(new Event('load'));
    const [first, second] = await Promise.all([firstOperation, secondOperation]);

    second.commit();
    first.commit();

    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/atom-one-dark.min.css');
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(1);
    expect(firstTheme.isConnected).toBe(false);
  });

  it('allows an older preparation to commit when the newer candidate fails', async () => {
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      return result;
    });
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime() }
    );

    const firstOperation = port.prepareCodeTheme(context('github'));
    const firstTheme = document.querySelector<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    );
    const secondOperation = port.prepareCodeTheme(context('atom-one-dark'));
    const candidates = document.querySelectorAll<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    );
    const secondTheme = [...candidates].find((link) => link !== firstTheme);
    const codeFrame = document.querySelector<HTMLLinkElement>('#easymde-code-frame-css');
    if (!firstTheme || !secondTheme || !codeFrame) {
      throw new Error('expected independent pending stylesheets');
    }

    firstTheme.dispatchEvent(new Event('load'));
    const secondRejection = expect(secondOperation).rejects.toThrowError(
      'preview-enhancement-resource-load-failed'
    );
    secondTheme.dispatchEvent(new Event('error'));
    codeFrame.dispatchEvent(new Event('load'));
    const first = await firstOperation;
    await secondRejection;
    first.commit();

    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/github.min.css');
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(1);
  });

  it('aborts only the owning code-theme transaction and keeps its peer committable', async () => {
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      return result;
    });
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime() }
    );
    const firstController = new AbortController();
    const secondController = new AbortController();

    const firstOperation = port.prepareCodeTheme({
      codeTheme: 'github',
      signal: firstController.signal
    });
    const firstTheme = document.querySelector<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    );
    const secondOperation = port.prepareCodeTheme({
      codeTheme: 'atom-one-dark',
      signal: secondController.signal
    });
    const codeFrame = document.querySelector<HTMLLinkElement>('#easymde-code-frame-css');
    if (!firstTheme || !codeFrame) {
      throw new Error('expected pending stylesheets');
    }

    const secondRejection = expect(secondOperation).rejects.toThrowError(
      'preview-enhancement-resource-stale'
    );
    secondController.abort();
    firstTheme.dispatchEvent(new Event('load'));
    codeFrame.dispatchEvent(new Event('load'));
    const first = await firstOperation;
    await secondRejection;
    first.commit();

    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/github.min.css');
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(1);
  });

  it('keeps a loaded transaction inert when it is aborted before commit', async () => {
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      return result;
    });
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime() }
    );
    const firstController = new AbortController();

    const firstOperation = port.prepareCodeTheme({
      codeTheme: 'github',
      signal: firstController.signal
    });
    const firstTheme = [...document.querySelectorAll<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )].find((link) => link.href.includes('/github.min.css'));
    const secondOperation = port.prepareCodeTheme(context('atom-one-dark'));
    const secondTheme = [...document.querySelectorAll<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )].find((link) => link.href.includes('/atom-one-dark.min.css'));
    const codeFrame = document.querySelector<HTMLLinkElement>('#easymde-code-frame-css');
    if (!firstTheme || !secondTheme || !codeFrame) {
      throw new Error('expected independent pending stylesheets');
    }

    firstTheme.dispatchEvent(new Event('load'));
    secondTheme.dispatchEvent(new Event('load'));
    codeFrame.dispatchEvent(new Event('load'));
    const [first, second] = await Promise.all([firstOperation, secondOperation]);
    firstController.abort();
    first.commit();
    second.commit();

    expect(firstTheme.isConnected).toBe(false);
    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/atom-one-dark.min.css');
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(1);
  });

  it('lets an older loaded transaction commit after the newer transaction aborts', async () => {
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      return result;
    });
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime() }
    );
    const secondController = new AbortController();

    const firstOperation = port.prepareCodeTheme(context('github'));
    const firstTheme = [...document.querySelectorAll<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )].find((link) => link.href.includes('/github.min.css'));
    const secondOperation = port.prepareCodeTheme({
      codeTheme: 'atom-one-dark',
      signal: secondController.signal
    });
    const secondTheme = [...document.querySelectorAll<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )].find((link) => link.href.includes('/atom-one-dark.min.css'));
    const codeFrame = document.querySelector<HTMLLinkElement>('#easymde-code-frame-css');
    if (!firstTheme || !secondTheme || !codeFrame) {
      throw new Error('expected independent pending stylesheets');
    }

    firstTheme.dispatchEvent(new Event('load'));
    secondTheme.dispatchEvent(new Event('load'));
    codeFrame.dispatchEvent(new Event('load'));
    const [first, second] = await Promise.all([firstOperation, secondOperation]);
    secondController.abort();
    second.commit();
    first.commit();

    expect(secondTheme.isConnected).toBe(false);
    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/github.min.css');
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(1);
  });

  it('disposes every independent pending code-theme transaction without orphan links', async () => {
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      return result;
    });
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime() }
    );

    const first = port.prepareCodeTheme(context('github'));
    const second = port.prepareCodeTheme(context('atom-one-dark'));
    port.dispose?.();

    const results = await Promise.allSettled([first, second]);
    expect(results).toEqual([
      expect.objectContaining({ status: 'rejected' }),
      expect.objectContaining({ status: 'rejected' })
    ]);
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(0);
  });

  it('preserves the active stylesheet and invalidates loaded handles on dispose', async () => {
    const append = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      return result;
    });
    const active = document.createElement('link');
    active.id = 'easymde-highlight-theme-css';
    active.rel = 'stylesheet';
    active.href = previewEnhancementBootstrapFixture.codeThemes.find(
      ({ id }) => 'atom-one-dark' === id
    )?.cssUrl ?? '';
    active.dataset.easymdeLoadedHref = active.getAttribute('href') ?? '';
    active.dataset.easymdeStylesheetOwner = active.id;
    document.head.appendChild(active);
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime() }
    );

    const firstOperation = port.prepareCodeTheme(context('github'));
    const firstTheme = [...document.querySelectorAll<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )].find((link) => link.href.includes('/github.min.css'));
    const secondOperation = port.prepareCodeTheme(context('atom-one-dark'));
    const codeFrame = document.querySelector<HTMLLinkElement>('#easymde-code-frame-css');
    if (!firstTheme || !codeFrame) throw new Error('expected pending stylesheets');
    firstTheme.dispatchEvent(new Event('load'));
    codeFrame.dispatchEvent(new Event('load'));
    const [first, second] = await Promise.all([firstOperation, secondOperation]);

    port.dispose?.();
    first.commit();
    second.commit();

    expect(document.querySelector('#easymde-highlight-theme-css')).toBe(active);
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(1);
    expect(firstTheme.isConnected).toBe(false);
  });

  it('cleans a synchronous stylesheet append failure before a later preparation', async () => {
    const append = document.head.appendChild.bind(document.head);
    let rejectFirstTheme = true;
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      if (
        rejectFirstTheme
        && node instanceof HTMLLinkElement
        && 'easymde-highlight-theme-css' === node.dataset.easymdeStylesheetOwner
      ) {
        rejectFirstTheme = false;
        throw new Error('synthetic append failure');
      }
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      queueMicrotask(() => node.dispatchEvent(new Event('load')));
      return result;
    });
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      { documentRef: document, runtime: runtime() }
    );

    await expect(port.prepareCodeTheme(context('github'))).rejects.toThrowError(
      'preview-enhancement-document-head-missing'
    );
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(0);

    const prepared = await port.prepareCodeTheme(context('atom-one-dark'));
    prepared.commit();
    port.dispose?.();
    port.dispose?.();

    expect(document.querySelector<HTMLLinkElement>('#easymde-highlight-theme-css')?.href)
      .toContain('/assets/vendor/highlight/styles/atom-one-dark.min.css');
    expect(document.querySelectorAll(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )).toHaveLength(1);
  });

  it('forwards lightweight code-frame background synchronization', () => {
    const syncCodeFrameBackgrounds = vi.fn();
    const port = createBrowserPreviewEnhancementPort(
      previewEnhancementBootstrapFixture,
      {
        documentRef: document,
        runtime: runtime(undefined, syncCodeFrameBackgrounds)
      }
    );
    const surface = document.createElement('article');

    port.syncCodeFrameBackgrounds(surface);

    expect(syncCodeFrameBackgrounds).toHaveBeenCalledWith(surface);
  });

  it('commits the newest successful theme without cancelling older out-of-order loads', async () => {
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
    const firstTheme = [...document.querySelectorAll<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )].find((link) => link.href.includes('/github.min.css'));
    firstCurrent = false;
    const second = port.enhance(
      surface,
      { syntaxHighlight: true },
      () => secondCurrent,
      context('atom-one-dark')
    );
    const secondTheme = [...document.querySelectorAll<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )].find((link) => link.href.includes('/atom-one-dark.min.css'));
    secondCurrent = false;
    const third = port.enhance(
      surface,
      { syntaxHighlight: true },
      () => true,
      context('monokai')
    );
    const thirdTheme = [...document.querySelectorAll<HTMLLinkElement>(
      '[data-easymde-stylesheet-owner="easymde-highlight-theme-css"]'
    )].find((link) => link.href.includes('/monokai.min.css'));
    const codeFrame = document.querySelector<HTMLLinkElement>('#easymde-code-frame-css');
    if (!firstTheme || !secondTheme || !thirdTheme || !codeFrame) {
      throw new Error('expected pending stylesheets');
    }

    thirdTheme.dispatchEvent(new Event('load'));
    firstTheme.dispatchEvent(new Event('load'));
    codeFrame.dispatchEvent(new Event('load'));
    const secondRejection = expect(second).rejects.toThrowError(
      'preview-enhancement-resource-load-failed'
    );
    secondTheme.dispatchEvent(new Event('error'));
    const results = await Promise.allSettled([first, second, third]);
    await secondRejection;

    expect(results.map(({ status }) => status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
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
      hasMathRenderer: () => !!document.querySelector(
        'script[data-easymde-loaded*="frontend-enhancements-fixture.js"]'
      ),
      hasMermaid: () => !!document.getElementById('easymde-mermaid-js'),
      hasMermaidRenderer: () => !!document.querySelector(
        'script[data-easymde-loaded*="frontend-enhancements-fixture.js"]'
      )
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
    expect(document.querySelector(
      'script[data-easymde-loaded*="frontend-enhancements-fixture.js"]'
    )).not.toBeNull();
    expect(document.querySelector('#easymde-mermaid-js')).not.toBeNull();
    expect(document.querySelectorAll<HTMLScriptElement>(
      'script[src*="frontend-enhancements-fixture.js"]'
    )).toHaveLength(1);
    expect(enhance).toHaveBeenCalledTimes(1);
  });

  it('re-associates a reused renderer URL and cancels the superseded alias', async () => {
    const append = document.head.appendChild.bind(document.head);
    let rendererReady = false;
    const mathRendererUrl = 'https://example.test/wp-content/plugins/easymde/assets/frontend-enhancements-math.js';
    const mermaidRendererUrl = 'https://example.test/wp-content/plugins/easymde/assets/frontend-enhancements-mermaid.js';
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      if (node instanceof HTMLLinkElement) {
        queueMicrotask(() => node.dispatchEvent(new Event('load')));
      }
      return result;
    });
    const bootstrap = {
      ...previewEnhancementBootstrapFixture,
      assets: {
        ...previewEnhancementBootstrapFixture.assets,
        mathRendererUrl,
        mermaidRendererUrl
      }
    };
    const port = createBrowserPreviewEnhancementPort(
      bootstrap,
      {
        documentRef: document,
        runtime: {
          ...runtime(),
          hasKatex: () => true,
          hasMathRenderer: () => rendererReady,
          hasMermaid: () => true,
          hasMermaidRenderer: () => rendererReady
        }
      }
    );

    const math = port.enhance(
      document.createElement('article'),
      { math: true },
      () => true,
      context()
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const firstMermaid = port.enhance(
      document.createElement('article'),
      { mermaid: true },
      () => true,
      context()
    );
    void firstMermaid.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const staleMermaidScript = document.querySelector<HTMLScriptElement>(
      '#easymde-mermaid-renderer-js'
    );
    bootstrap.assets.mermaidRendererUrl = mathRendererUrl;
    const secondMermaid = port.enhance(
      document.createElement('article'),
      { mermaid: true },
      () => true,
      context()
    );
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const mathScript = document.querySelector<HTMLScriptElement>(
      '#easymde-math-renderer-js'
    );
    if (!mathScript || !staleMermaidScript) {
      throw new Error('expected pending renderer scripts');
    }

    rendererReady = true;
    mathScript.dispatchEvent(new Event('load'));
    await expect(math).resolves.toBeUndefined();
    await expect(secondMermaid).resolves.toBeUndefined();
    await expect(firstMermaid).rejects.toThrowError('preview-enhancement-resource-stale');
    expect(staleMermaidScript.isConnected).toBe(false);
    expect(document.querySelectorAll(`script[src="${mathRendererUrl}"]`)).toHaveLength(1);
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

  it('reports an unavailable optional Mermaid runtime when its bundle is absent', async () => {
    const port = createBrowserPreviewEnhancementPort(
      {
        ...previewEnhancementBootstrapFixture,
        assets: { ...previewEnhancementBootstrapFixture.assets, mermaidScriptUrl: null }
      },
      { documentRef: document, runtime: runtime() }
    );

    await expect(port.enhance(
      document.createElement('article'),
      { mermaid: true },
      () => true,
      context('github')
    )).rejects.toThrowError('preview-enhancement-mermaid-runtime-unavailable');
  });

  it('downgrades a classified Mermaid asset failure to readable preview code and reports it', async () => {
    const enhance = vi.fn().mockResolvedValue(undefined);
    autoLoadResources();
    const port = createBrowserPreviewEnhancementPort(
      {
        ...previewEnhancementBootstrapFixture,
        assets: {
          ...previewEnhancementBootstrapFixture.assets,
          mermaidAssetError: 'frontend-enhancement-frontend-mermaid-build-integrity-invalid',
          mermaidScriptUrl: null
        }
      },
      { documentRef: document, runtime: runtime(enhance) }
    );

    await expect(port.enhance(
      document.createElement('article'),
      { mermaid: true },
      () => true,
      context()
    )).rejects.toThrowError('preview-enhancement-mermaid-asset-contract-failed');

    expect(document.querySelector('#easymde-code-frame-css')).not.toBeNull();
    expect(document.querySelector('#easymde-highlight-theme-css')).not.toBeNull();
    expect(document.querySelector('#easymde-highlight-js')).toBeNull();

    expect(enhance).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      {
        assetErrors: { mermaid: 'frontend-enhancement-frontend-mermaid-build-integrity-invalid' },
        features: { mermaid: false },
        strings: { renderingFailed: 'Rendering failed.' }
      }
    );
  });

  it('does not forward a Mermaid asset error when Mermaid is not requested', async () => {
    const enhance = vi.fn().mockResolvedValue(undefined);
    autoLoadResources();
    const port = createBrowserPreviewEnhancementPort(
      {
        ...previewEnhancementBootstrapFixture,
        assets: {
          ...previewEnhancementBootstrapFixture.assets,
          mermaidAssetError: 'frontend-enhancement-frontend-mermaid-build-integrity-invalid'
        }
      },
      { documentRef: document, runtime: runtime(enhance) }
    );

    await port.enhance(
      document.createElement('article'),
      { syntaxHighlight: true, mermaid: false },
      () => true,
      context()
    );

    expect(enhance).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      {
        features: { syntaxHighlight: true, mermaid: false },
        strings: { renderingFailed: 'Rendering failed.' }
      }
    );
  });

  it('removes a failed script and permits a later explicit preview retry', async () => {
    const append = document.head.appendChild.bind(document.head);
    let mermaidAttempts = 0;
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      const result = append(node);
      if (node instanceof Element) appended.push(node);
      queueMicrotask(() => {
        if (node instanceof HTMLScriptElement && 'easymde-mermaid-renderer-js' === node.id) {
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
    expect(document.getElementById('easymde-mermaid-renderer-js')).toBeNull();

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
