import type { PreviewEnhancementBootstrap } from '../../contracts/bootstrap/preview-enhancement-bootstrap';
import type { PreviewFeatures } from '../../contracts/ports/preview-request';
import type { PreviewEnhancementPort } from '../../features/live-preview/ports/preview-enhancement-port';

type SharedEnhancements = Readonly<{
  enhance: (
    surface: HTMLElement,
    config: Readonly<{
      features: PreviewFeatures;
      strings: Readonly<{ renderingFailed: string }>;
    }>
  ) => Promise<unknown> | unknown;
}>;

export type PreviewEnhancementBrowserRuntime = Readonly<{
  getEnhancements: () => SharedEnhancements | null;
  hasHighlight: () => boolean;
  hasKatex: () => boolean;
  hasMathRenderer: () => boolean;
  hasMermaid: () => boolean;
  hasMermaidRenderer: () => boolean;
}>;

type BrowserPreviewEnhancementOptions = Readonly<{
  documentRef: Document;
  runtime: PreviewEnhancementBrowserRuntime;
}>;

type StyleLoad = Readonly<{
  cancel: () => void;
  link: HTMLLinkElement;
  loaded: () => boolean;
  promise: Promise<void>;
  url: string;
}>;

type ScriptLoad = Readonly<{
  cancel: () => void;
  loaded: () => boolean;
  promise: Promise<void>;
  script: HTMLScriptElement;
  url: string;
}>;

const RESOURCE_LOAD_TIMEOUT_MS = 15_000;

function resourceError(code: string): Error {
  return new Error(code);
}

function waitForResource(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(resourceError('preview-enhancement-resource-stale'));
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let abort: () => void;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      callback();
    };
    abort = () => finish(
      () => reject(resourceError('preview-enhancement-resource-stale'))
    );
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      () => finish(resolve),
      (error) => finish(() => reject(error))
    );
  });
}

function createResourceLoader(documentRef: Document) {
  const scriptLoads = new Map<string, ScriptLoad>();
  const styleLoads = new Map<string, StyleLoad>();
  let disposed = false;

  function head(): HTMLHeadElement {
    const value = documentRef.head;
    if (!value) throw resourceError('preview-enhancement-document-head-missing');
    return value;
  }

  function loadScript(id: string, url: string, signal: AbortSignal): Promise<void> {
    if (disposed) return Promise.reject(resourceError('preview-enhancement-runtime-unavailable'));
    const cached = scriptLoads.get(id);
    if (cached?.url === url && cached.script.isConnected) {
      return waitForResource(cached.promise, signal);
    }
    if (cached && !cached.loaded()) cached.cancel();

    const existing = documentRef.getElementById(id);
    if (existing) {
      if (!(existing instanceof HTMLScriptElement) || existing.getAttribute('src') !== url) {
        return Promise.reject(resourceError('preview-enhancement-resource-conflict'));
      }
      if (existing.dataset.easymdeLoaded === url) return Promise.resolve();
      return Promise.reject(resourceError('preview-enhancement-runtime-unavailable'));
    }

    const script = documentRef.createElement('script');
    script.id = id;
    script.async = false;
    script.src = url;
    let resolveLoad!: () => void;
    let rejectLoad!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    });
    let loaded = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let load!: ScriptLoad;
    const cleanup = () => {
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
      if (null !== timer) clearTimeout(timer);
      timer = null;
    };
    const fail = (code: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      if (scriptLoads.get(id) === load) scriptLoads.delete(id);
      rejectLoad(resourceError(code));
    };
    const handleLoad = () => {
      if (settled) return;
      settled = true;
      cleanup();
      loaded = true;
      script.dataset.easymdeLoaded = url;
      resolveLoad();
    };
    const handleError = () => fail('preview-enhancement-resource-load-failed');
    load = {
      cancel: () => fail('preview-enhancement-resource-stale'),
      loaded: () => loaded,
      promise,
      script,
      url
    };
    scriptLoads.set(id, load);
    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);
    timer = setTimeout(handleError, RESOURCE_LOAD_TIMEOUT_MS);
    try {
      head().appendChild(script);
    } catch {
      fail('preview-enhancement-document-head-missing');
    }
    return waitForResource(promise, signal);
  }

  function loadStylesheet(id: string, url: string, signal: AbortSignal): Promise<void> {
    if (disposed) return Promise.reject(resourceError('preview-enhancement-runtime-unavailable'));
    const cached = styleLoads.get(id);
    const existing = documentRef.getElementById(id);
    if (
      cached?.url === url
      && cached.link.isConnected
      && cached.link.getAttribute('href') === url
    ) {
      return waitForResource(cached.promise, signal);
    }
    if (existing && !(existing instanceof HTMLLinkElement)) {
      return Promise.reject(resourceError('preview-enhancement-resource-conflict'));
    }

    if (cached && !cached.loaded()) {
      cached.cancel();
    }

    const current = documentRef.getElementById(id);
    if (current && !(current instanceof HTMLLinkElement)) {
      return Promise.reject(resourceError('preview-enhancement-resource-conflict'));
    }
    if (
      current instanceof HTMLLinkElement
      && current.getAttribute('href') === url
      && current.dataset.easymdeLoadedHref === url
    ) {
      const loaded = Promise.resolve();
      styleLoads.set(id, {
        cancel: () => undefined,
        link: current,
        loaded: () => true,
        promise: loaded,
        url
      });
      return waitForResource(loaded, signal);
    }

    const previous = current instanceof HTMLLinkElement ? current : null;
    if (previous) previous.id = `${id}-previous`;
    const link = documentRef.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.dataset.easymdeStylesheetOwner = id;

    let loaded = false;
    let settled = false;
    let rejectLoad!: (error: Error) => void;
    let cleanup = () => undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const restorePrevious = () => {
      link.remove();
      if (previous?.isConnected) previous.id = id;
    };
    const promise = new Promise<void>((resolve, reject) => {
      rejectLoad = reject;
      cleanup = () => {
        link.removeEventListener('load', handleLoad);
        link.removeEventListener('error', handleError);
        if (null !== timer) clearTimeout(timer);
        timer = null;
      };
      const handleLoad = () => {
        if (settled) return;
        settled = true;
        cleanup();
        loaded = true;
        link.dataset.easymdeLoadedHref = url;
        previous?.remove();
        resolve();
      };
      const handleError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        restorePrevious();
        reject(resourceError('preview-enhancement-resource-load-failed'));
      };
      link.addEventListener('load', handleLoad);
      link.addEventListener('error', handleError);
      link.href = url;
      timer = setTimeout(handleError, RESOURCE_LOAD_TIMEOUT_MS);
      try {
        if (!link.parentNode) head().appendChild(link);
      } catch {
        handleError();
      }
    });
    const load: StyleLoad = {
      cancel: () => {
        if (settled) return;
        settled = true;
        cleanup();
        link.remove();
        if (previous?.isConnected) previous.id = id;
        rejectLoad(resourceError('preview-enhancement-resource-stale'));
      },
      link,
      loaded: () => loaded,
      promise,
      url
    };
    styleLoads.set(id, load);
    return waitForResource(promise, signal);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const load of scriptLoads.values()) {
      if (!load.loaded()) load.cancel();
    }
    for (const load of styleLoads.values()) {
      if (!load.loaded()) load.cancel();
    }
    scriptLoads.clear();
    styleLoads.clear();
  }

  return { dispose, loadScript, loadStylesheet };
}

async function loadRuntime(
  available: () => boolean,
  load: () => Promise<void>
): Promise<void> {
  if (available()) return;
  await load();
  if (!available()) {
    throw resourceError('preview-enhancement-runtime-unavailable');
  }
}

export function createBrowserPreviewEnhancementPort(
  bootstrap: PreviewEnhancementBootstrap,
  options: BrowserPreviewEnhancementOptions
): PreviewEnhancementPort {
  const loader = createResourceLoader(options.documentRef);
  const assets = bootstrap.assets;

  async function prepareHighlight(codeTheme: string, signal: AbortSignal): Promise<void> {
    const theme = bootstrap.codeThemes.find(({ id }) => id === codeTheme);
    if (!theme) throw resourceError('preview-enhancement-code-theme-missing');
    await Promise.all([
      loader.loadStylesheet(assets.codeFrameLinkId, assets.codeFrameCssUrl, signal),
      loader.loadStylesheet(assets.highlightThemeLinkId, theme.cssUrl, signal),
      loadRuntime(options.runtime.hasHighlight, () =>
        loader.loadScript('easymde-highlight-js', assets.highlightScriptUrl, signal))
    ]);
  }

  async function prepareMath(signal: AbortSignal): Promise<void> {
    await Promise.all([
      loader.loadStylesheet(assets.mathCssLinkId, assets.mathCssUrl, signal),
      loader.loadStylesheet(assets.katexCssLinkId, assets.katexCssUrl, signal),
      loadRuntime(options.runtime.hasKatex, () =>
        loader.loadScript('easymde-katex-js', assets.katexScriptUrl, signal))
    ]);
    await loadRuntime(options.runtime.hasMathRenderer, () =>
      loader.loadScript('easymde-math-renderer-js', assets.mathRendererUrl, signal));
  }

  async function prepareMermaid(signal: AbortSignal): Promise<void> {
    await loadRuntime(options.runtime.hasMermaid, () =>
      loader.loadScript('easymde-mermaid-js', assets.mermaidScriptUrl, signal));
    await loadRuntime(options.runtime.hasMermaidRenderer, () =>
      loader.loadScript('easymde-mermaid-renderer-js', assets.mermaidRendererUrl, signal));
  }

  return {
    dispose: loader.dispose,
    async enhance(surface, features, isCurrent, context) {
      if (!isCurrent() || context.signal.aborted) return;
      const tasks: Promise<void>[] = [];
      const hasExecutableEnhancement = !!(
        features.syntaxHighlight
        || features.math
        || features.mermaid
      );

      if (features.syntaxHighlight) {
        tasks.push(prepareHighlight(context.codeTheme, context.signal));
      }
      if (features.math) tasks.push(prepareMath(context.signal));
      if (features.mermaid) tasks.push(prepareMermaid(context.signal));
      if (features.toc) {
        tasks.push(
          loader.loadStylesheet(assets.tocCssLinkId, assets.tocCssUrl, context.signal)
        );
      }
      if (!tasks.length) return;

      await Promise.all(tasks);
      if (!isCurrent() || context.signal.aborted || !hasExecutableEnhancement) return;
      const enhancements = options.runtime.getEnhancements();
      if (!enhancements) {
        throw resourceError('preview-enhancement-runtime-unavailable');
      }
      await enhancements.enhance(surface, {
        features,
        strings: bootstrap.strings
      });
      if (!isCurrent() || context.signal.aborted) return;
      if (surface.querySelector('.easymde-render-error')) {
        throw resourceError('preview-enhancement-render-failed');
      }
    }
  };
}

declare global {
  interface Window {
    EasyMDEEnhancements?: SharedEnhancements;
    EasyMDEMathRenderer?: unknown;
    EasyMDEMermaidRenderer?: unknown;
    hljs?: unknown;
    katex?: unknown;
    mermaid?: unknown;
  }
}

export function createWindowPreviewEnhancementRuntime(
  windowRef: Window
): PreviewEnhancementBrowserRuntime {
  return {
    getEnhancements: () => windowRef.EasyMDEEnhancements ?? null,
    hasHighlight: () => !!windowRef.hljs,
    hasKatex: () => !!windowRef.katex,
    hasMathRenderer: () => !!windowRef.EasyMDEMathRenderer,
    hasMermaid: () => !!windowRef.mermaid,
    hasMermaidRenderer: () => !!windowRef.EasyMDEMermaidRenderer
  };
}
