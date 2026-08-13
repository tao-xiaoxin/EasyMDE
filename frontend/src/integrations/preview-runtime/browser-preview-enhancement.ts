import type { PreviewEnhancementBootstrap } from '../../contracts/bootstrap/preview-enhancement-bootstrap';
import type { PreviewFeatures } from '../../contracts/ports/preview-request';
import type {
  PreparedCodeTheme,
  PreviewEnhancementContext,
  PreviewEnhancementPort
} from '../../features/live-preview/ports/preview-enhancement-port';

type SharedEnhancements = Readonly<{
  enhance: (
    surface: HTMLElement,
    config: Readonly<{
      assetErrors?: Readonly<{ mermaid?: string }>;
      features: PreviewFeatures;
      strings: Readonly<{ renderingFailed: string }>;
    }>
  ) => Promise<unknown> | unknown;
  syncCodeFrameBackgrounds: (surface: HTMLElement) => void;
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

type PreparedStyleLoad = Readonly<{
  attemptCommit: () => void;
  cancel: () => void;
  owner: PreparedStyleOwner;
  promise: Promise<PreparedCodeTheme>;
  sequence: number;
}>;

type PreparedStyleOwner = 'activation' | 'enhancement';

type PreparedStyleSlot = {
  activationOutcomes: Map<number, string>;
  activeActivations: Set<number>;
  authoritativeActivationUrl: string | null;
  committedActivationSequence: number;
  committedEnhancementSequence: number;
  enhancementBarriers: Map<number, Set<number>>;
  loads: Set<PreparedStyleLoad>;
  nextSequence: number;
  reconciling: boolean;
};

type ScriptLoad = Readonly<{
  cancel: () => void;
  ids: Set<string>;
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
  const scriptLoadsByUrl = new Map<string, ScriptLoad>();
  const styleLoads = new Map<string, StyleLoad>();
  const preparedStyleSlots = new Map<string, PreparedStyleSlot>();
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

    const cachedByUrl = scriptLoadsByUrl.get(url);
    if (cachedByUrl?.script.isConnected) {
      if (cached && cached !== cachedByUrl && !cached.loaded()) {
        cached.cancel();
      }
      cachedByUrl.ids.add(id);
      scriptLoads.set(id, cachedByUrl);
      return waitForResource(cachedByUrl.promise, signal);
    }
    if (cachedByUrl) {
      cachedByUrl.cancel();
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
      for (const alias of load.ids) {
        if (scriptLoads.get(alias) === load) scriptLoads.delete(alias);
      }
      if (scriptLoadsByUrl.get(url) === load) scriptLoadsByUrl.delete(url);
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
      ids: new Set([id]),
      loaded: () => loaded,
      promise,
      script,
      url
    };
    scriptLoads.set(id, load);
    scriptLoadsByUrl.set(url, load);
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
    const preparedSlot = preparedStyleSlots.get(id);
    if (preparedSlot) {
      for (const load of [...preparedSlot.loads]) load.cancel();
    }
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

  function prepareStylesheet(
    id: string,
    url: string,
    signal: AbortSignal,
    owner: PreparedStyleOwner
  ): PreparedStyleLoad {
    if (disposed) {
      return {
        attemptCommit: () => undefined,
        cancel: () => undefined,
        owner,
        promise: Promise.reject(resourceError('preview-enhancement-runtime-unavailable')),
        sequence: 0
      };
    }
    if (signal.aborted) {
      return {
        attemptCommit: () => undefined,
        cancel: () => undefined,
        owner,
        promise: Promise.reject(resourceError('preview-enhancement-resource-stale')),
        sequence: 0
      };
    }
    let slot = preparedStyleSlots.get(id);
    if (!slot) {
      slot = {
        activationOutcomes: new Map(),
        activeActivations: new Set(),
        authoritativeActivationUrl: null,
        committedActivationSequence: 0,
        committedEnhancementSequence: 0,
        enhancementBarriers: new Map(),
        loads: new Set(),
        nextSequence: 0,
        reconciling: false
      };
      preparedStyleSlots.set(id, slot);
    }
    const sequence = ++slot.nextSequence;
    const existing = documentRef.getElementById(id);
    if (existing && !(existing instanceof HTMLLinkElement)) {
      return {
        attemptCommit: () => undefined,
        cancel: () => undefined,
        owner,
        promise: Promise.reject(resourceError('preview-enhancement-resource-conflict')),
        sequence
      };
    }

    const reused = existing instanceof HTMLLinkElement
      && existing.getAttribute('href') === url
      && existing.dataset.easymdeLoadedHref === url;
    const link = reused ? null : documentRef.createElement('link');
    if (link) {
      link.rel = 'stylesheet';
      link.media = 'not all';
      link.dataset.easymdeStylesheetOwner = id;
      link.href = url;
    }
    let state: 'pending' | 'ready' | 'terminal' = reused ? 'ready' : 'pending';
    let commitRequested = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let resolveLoad!: (prepared: PreparedCodeTheme) => void;
    let rejectLoad!: (error: Error) => void;
    let handleLoad: () => void = () => undefined;
    let handleError: () => void = () => undefined;
    let handleAbort: () => void = () => undefined;
    const cleanupLoad = () => {
      link?.removeEventListener('load', handleLoad);
      link?.removeEventListener('error', handleError);
      if (null !== timer) clearTimeout(timer);
      timer = null;
    };
    const cleanup = () => {
      cleanupLoad();
      signal.removeEventListener('abort', handleAbort);
    };
    const clearOwner = (load: PreparedStyleLoad) => {
      slot.loads.delete(load);
    };
    const latestSuccessfulOverlappingActivation = () => {
      const barrier = slot.enhancementBarriers.get(sequence);
      if (!barrier) return null;
      const successfulSequence = [...barrier]
        .filter((activationSequence) => slot.activationOutcomes.has(activationSequence))
        .sort((left, right) => right - left)[0];
      if (undefined === successfulSequence) return null;
      return slot.activationOutcomes.get(successfulSequence) ?? null;
    };
    const activationBlocksEnhancement = () => {
      const barrier = slot.enhancementBarriers.get(sequence);
      return !!barrier && [...barrier].some((activationSequence) =>
        slot.activeActivations.has(activationSequence)
      );
    };
    const pruneActivationOutcomes = () => {
      const referenced = new Set<number>();
      for (const barrier of slot.enhancementBarriers.values()) {
        for (const activationSequence of barrier) referenced.add(activationSequence);
      }
      for (const activationSequence of slot.activationOutcomes.keys()) {
        if (!referenced.has(activationSequence)) {
          slot.activationOutcomes.delete(activationSequence);
        }
      }
    };
    const reconcile = () => {
      if (slot.reconciling) return;
      slot.reconciling = true;
      try {
        for (const candidate of [...slot.loads].sort((left, right) => {
          if (left.owner !== right.owner) return 'activation' === left.owner ? -1 : 1;
          return right.sequence - left.sequence;
        })) {
          candidate.attemptCommit();
        }
      } finally {
        slot.reconciling = false;
      }
    };
    let load!: PreparedStyleLoad;
    const finish = (
      errorCode?: string,
      committedActivationUrl?: string,
      preserveLink = false
    ) => {
      if ('terminal' === state) return;
      const pending = 'pending' === state;
      state = 'terminal';
      cleanup();
      if (!preserveLink) link?.remove();
      if ('activation' === owner) {
        slot.activeActivations.delete(sequence);
        if (committedActivationUrl) {
          slot.activationOutcomes.set(sequence, committedActivationUrl);
        }
      } else {
        slot.enhancementBarriers.delete(sequence);
      }
      clearOwner(load);
      if (pending && errorCode) rejectLoad(resourceError(errorCode));
      reconcile();
      pruneActivationOutcomes();
    };
    const applyCommit = () => {
      if ('ready' !== state || !commitRequested || disposed) return;
      if ('activation' === owner) {
        if (sequence < slot.committedActivationSequence) {
          finish();
          return;
        }
      } else {
        if (activationBlocksEnhancement()) return;
        const overlappingActivationUrl = latestSuccessfulOverlappingActivation();
        if (overlappingActivationUrl && overlappingActivationUrl !== url) {
          finish();
          return;
        }
        if (slot.authoritativeActivationUrl && slot.authoritativeActivationUrl !== url) {
          finish();
          return;
        }
        if (sequence < slot.committedEnhancementSequence) {
          finish();
          return;
        }
      }

      const current = documentRef.getElementById(id);
      if (current && !(current instanceof HTMLLinkElement)) {
        finish();
        return;
      }
      let activeLink: HTMLLinkElement;
      if (link) {
        if (!link.isConnected) {
          finish();
          return;
        }
        current?.remove();
        link.id = id;
        link.media = 'all';
        link.dataset.easymdeLoadedHref = url;
        activeLink = link;
      } else {
        if (!(existing instanceof HTMLLinkElement) || current !== existing) {
          finish();
          return;
        }
        activeLink = existing;
      }
      if ('activation' === owner) {
        slot.committedActivationSequence = sequence;
        slot.authoritativeActivationUrl = url;
      } else {
        slot.committedEnhancementSequence = sequence;
      }
      const ready = Promise.resolve();
      styleLoads.set(id, {
        cancel: () => undefined,
        link: activeLink,
        loaded: () => true,
        promise: ready,
        url
      });
      finish(undefined, 'activation' === owner ? url : undefined, true);
    };
    const cancel = () => finish('preview-enhancement-resource-stale');
    const commit = () => {
      if ('ready' !== state || signal.aborted || disposed) {
        cancel();
        return;
      }
      commitRequested = true;
      reconcile();
    };
    const promise = new Promise<PreparedCodeTheme>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    });
    load = { attemptCommit: applyCommit, cancel, owner, promise, sequence };
    slot.loads.add(load);
    if ('activation' === owner) {
      slot.activeActivations.add(sequence);
      for (const barrier of slot.enhancementBarriers.values()) barrier.add(sequence);
    } else {
      slot.enhancementBarriers.set(sequence, new Set(slot.activeActivations));
    }
    handleAbort = cancel;
    signal.addEventListener('abort', handleAbort, { once: true });
    if (reused) {
      resolveLoad({ cancel, commit });
      return load;
    }
    handleLoad = () => {
      if ('pending' !== state || !link) return;
      state = 'ready';
      cleanupLoad();
      link.dataset.easymdeLoadedHref = url;
      resolveLoad({ cancel, commit });
    };
    handleError = () => finish('preview-enhancement-resource-load-failed');
    link?.addEventListener('load', handleLoad);
    link?.addEventListener('error', handleError);
    timer = setTimeout(handleError, RESOURCE_LOAD_TIMEOUT_MS);
    try {
      if (link) head().appendChild(link);
    } catch {
      finish('preview-enhancement-document-head-missing');
    }
    return load;
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
    for (const slot of preparedStyleSlots.values()) {
      for (const load of [...slot.loads]) load.cancel();
    }
    scriptLoads.clear();
    scriptLoadsByUrl.clear();
    styleLoads.clear();
    preparedStyleSlots.clear();
  }

  return { dispose, loadScript, loadStylesheet, prepareStylesheet };
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

  async function prepareCodeThemeForOwner(
    context: PreviewEnhancementContext,
    owner: PreparedStyleOwner
  ): Promise<PreparedCodeTheme> {
    const theme = bootstrap.codeThemes.find(({ id }) => id === context.codeTheme);
    if (!theme) throw resourceError('preview-enhancement-code-theme-missing');
    const preparation = loader.prepareStylesheet(
      assets.highlightThemeLinkId,
      theme.cssUrl,
      context.signal,
      owner
    );
    try {
      const [prepared] = await Promise.all([
        preparation.promise,
        loader.loadStylesheet(
          assets.codeFrameLinkId,
          assets.codeFrameCssUrl,
          context.signal
        )
      ]);
      return prepared;
    } catch (error) {
      preparation.cancel();
      throw error;
    }
  }

  function prepareCodeTheme(
    context: PreviewEnhancementContext
  ): Promise<PreparedCodeTheme> {
    return prepareCodeThemeForOwner(context, 'activation');
  }

  async function prepareHighlight(codeTheme: string, signal: AbortSignal): Promise<void> {
    const preparedCodeTheme = await prepareCodeThemeForOwner(
      { codeTheme, signal },
      'enhancement'
    );
    try {
      await loadRuntime(options.runtime.hasHighlight, () =>
        loader.loadScript('easymde-highlight-js', assets.highlightScriptUrl, signal));
    } catch (error) {
      preparedCodeTheme.cancel();
      throw error;
    }
    if (signal.aborted) {
      preparedCodeTheme.cancel();
      throw resourceError('preview-enhancement-resource-stale');
    }
    preparedCodeTheme.commit();
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
    const mermaidScriptUrl = assets.mermaidScriptUrl;
    if (!mermaidScriptUrl) {
      throw resourceError('preview-enhancement-mermaid-runtime-unavailable');
    }
    await loadRuntime(options.runtime.hasMermaid, () =>
      loader.loadScript('easymde-mermaid-js', mermaidScriptUrl, signal));
    await loadRuntime(options.runtime.hasMermaidRenderer, () =>
      loader.loadScript('easymde-mermaid-renderer-js', assets.mermaidRendererUrl, signal));
  }

  return {
    dispose: loader.dispose,
    prepareCodeTheme,
    syncCodeFrameBackgrounds(surface) {
      const enhancements = options.runtime.getEnhancements();
      if (!enhancements) {
        throw resourceError('preview-enhancement-runtime-unavailable');
      }
      enhancements.syncCodeFrameBackgrounds(surface);
    },
    async enhance(surface, features, isCurrent, context) {
      if (!isCurrent() || context.signal.aborted) return;
      const mermaidAssetFailure = !!assets.mermaidAssetError && !!features.mermaid;
      const fallbackFeatures = mermaidAssetFailure
        ? { ...features, mermaid: false }
        : features;
      const tasks: Promise<void>[] = [];
      const hasExecutableEnhancement = !!(
        fallbackFeatures.syntaxHighlight
        || fallbackFeatures.math
        || fallbackFeatures.mermaid
        || mermaidAssetFailure
      );

      if (fallbackFeatures.syntaxHighlight) {
        tasks.push(prepareHighlight(context.codeTheme, context.signal));
      } else if (mermaidAssetFailure) {
        tasks.push(
          prepareCodeThemeForOwner(context, 'enhancement')
            .then((prepared) => prepared.commit())
        );
      }
      if (fallbackFeatures.math) tasks.push(prepareMath(context.signal));
      if (fallbackFeatures.mermaid) tasks.push(prepareMermaid(context.signal));
      if (fallbackFeatures.toc) {
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
        ...(mermaidAssetFailure
          ? { assetErrors: { mermaid: assets.mermaidAssetError } }
          : {}),
        features: fallbackFeatures,
        strings: bootstrap.strings
      });
      if (!isCurrent() || context.signal.aborted) return;
      if (surface.querySelector('.easymde-render-error')) {
        throw resourceError('preview-enhancement-render-failed');
      }
      if (mermaidAssetFailure) {
        throw resourceError('preview-enhancement-mermaid-asset-contract-failed');
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
