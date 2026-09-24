import type { PreviewEnhancementBootstrap } from '../../contracts/bootstrap/preview-enhancement-bootstrap';
import type { PreviewFeatures } from '../../contracts/ports/preview-request';
import type {
  PreparedCodeTheme,
  PreviewEnhancementContext,
  PreviewEnhancementPort
} from '../../features/live-preview/ports/preview-enhancement-port';
import type { FrontendEnhancementControl } from './frontend-enhancement-runtime';

type SharedEnhancements = Readonly<{
  enhance: (
    surface: HTMLElement,
    config: Readonly<{
      assetErrors?: Readonly<{ mermaid?: string }>;
      features: PreviewFeatures;
      strings: Readonly<{ renderingFailed: string }>;
    }>,
    control?: FrontendEnhancementControl
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
  warmHighlightAuto: (signal: AbortSignal) => Promise<boolean>;
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

function normalizedScriptUrl(documentRef: Document, value: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, documentRef.baseURI).href;
  } catch {
    return null;
  }
}

function createResourceLoader(documentRef: Document) {
  const scriptLoads = new Map<string, ScriptLoad>();
  const scriptLoadsByUrl = new Map<string, ScriptLoad>();
  const styleLoads = new Map<string, StyleLoad>();
  const preparedStyleSlots = new Map<string, PreparedStyleSlot>();
  const externalScriptWaits = new Set<() => void>();
  let disposed = false;

  function head(): HTMLHeadElement {
    const value = documentRef.head;
    if (!value) throw resourceError('preview-enhancement-document-head-missing');
    return value;
  }

  function waitForExistingScript(
    script: HTMLScriptElement,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) {
      return Promise.reject(resourceError('preview-enhancement-resource-stale'));
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let abort: () => void;
      const cleanup = () => {
        script.removeEventListener('load', handleLoad);
        script.removeEventListener('error', handleError);
        signal.removeEventListener('abort', abort);
        externalScriptWaits.delete(abort);
        if (null !== timer) clearTimeout(timer);
        timer = null;
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const handleLoad = () => finish(resolve);
      const handleError = () => finish(() => reject(
        resourceError('preview-enhancement-resource-load-failed')
      ));
      abort = () => finish(() => reject(
        resourceError('preview-enhancement-resource-stale')
      ));
      externalScriptWaits.add(abort);
      script.addEventListener('load', handleLoad);
      script.addEventListener('error', handleError);
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(() => reject(
        resourceError('preview-enhancement-resource-load-failed')
      )), RESOURCE_LOAD_TIMEOUT_MS);
      if (signal.aborted) abort();
    });
  }

  function waitForExternalScript(
    id: string,
    url: string,
    signal: AbortSignal,
    available: () => boolean
  ): Promise<void> {
    if (disposed) {
      return Promise.reject(resourceError('preview-enhancement-runtime-unavailable'));
    }
    if (signal.aborted) {
      return Promise.reject(resourceError('preview-enhancement-resource-stale'));
    }
    const normalizedUrl = normalizedScriptUrl(documentRef, url);
    if (!normalizedUrl) {
      return Promise.reject(resourceError('preview-enhancement-resource-conflict'));
    }
    const MutationObserverOwner = documentRef.defaultView?.MutationObserver;
    if (!MutationObserverOwner) {
      return Promise.reject(resourceError('preview-enhancement-runtime-unavailable'));
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let observer: MutationObserver | null = null;
      let observedScript: HTMLScriptElement | null = null;
      let abort: () => void;
      const detachScript = () => {
        if (!observedScript) return;
        observedScript.removeEventListener('load', handleLoad);
        observedScript.removeEventListener('error', handleError);
        observedScript = null;
      };
      const cleanup = () => {
        detachScript();
        observer?.disconnect();
        observer = null;
        documentRef.removeEventListener('readystatechange', handleReadyStateChange);
        signal.removeEventListener('abort', abort);
        externalScriptWaits.delete(abort);
        if (null !== timer) clearTimeout(timer);
        timer = null;
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const fail = (code: string) => finish(() => reject(resourceError(code)));
      const handleLoad = () => finish(resolve);
      const handleError = () => fail('preview-enhancement-resource-load-failed');
      const observeScript = (script: HTMLScriptElement) => {
        if (observedScript === script) return;
        detachScript();
        observedScript = script;
        script.addEventListener('load', handleLoad);
        script.addEventListener('error', handleError);
      };
      const discover = () => {
        if (settled) return;
        const existing = documentRef.getElementById(id);
        if (
          existing
          && (
            !(existing instanceof HTMLScriptElement)
            || normalizedScriptUrl(documentRef, existing.getAttribute('src') ?? '') !== normalizedUrl
          )
        ) {
          fail('preview-enhancement-resource-conflict');
          return;
        }
        const matchingScripts = Array.from(
          documentRef.querySelectorAll<HTMLScriptElement>('script[src]')
        ).filter((script) =>
          normalizedScriptUrl(documentRef, script.getAttribute('src') ?? '') === normalizedUrl
        );
        if (matchingScripts.length > 1) {
          fail('preview-enhancement-resource-conflict');
          return;
        }
        const script = matchingScripts[0];
        if (script && script.id !== id) {
          fail('preview-enhancement-resource-conflict');
          return;
        }
        if (!script) {
          detachScript();
          if (available()) {
            finish(resolve);
          } else if ('loading' !== documentRef.readyState) {
            fail('preview-enhancement-runtime-unavailable');
          }
          return;
        }
        if (
          available()
          || normalizedScriptUrl(documentRef, script.dataset.easymdeLoaded ?? '') === normalizedUrl
        ) {
          finish(resolve);
          return;
        }
        if ('loading' !== documentRef.readyState) {
          fail('preview-enhancement-runtime-unavailable');
          return;
        }
        observeScript(script);
      };
      const handleReadyStateChange = () => discover();
      abort = () => finish(() => reject(
        resourceError('preview-enhancement-resource-stale')
      ));
      externalScriptWaits.add(abort);
      signal.addEventListener('abort', abort, { once: true });
      documentRef.addEventListener('readystatechange', handleReadyStateChange);
      observer = new MutationObserverOwner(discover);
      observer.observe(documentRef, { childList: true, subtree: true });
      timer = setTimeout(() => fail('preview-enhancement-resource-load-failed'),
        RESOURCE_LOAD_TIMEOUT_MS);
      discover();
      if (signal.aborted) abort();
    });
  }

  function loadScript(id: string, url: string, signal: AbortSignal): Promise<void> {
    if (disposed) return Promise.reject(resourceError('preview-enhancement-runtime-unavailable'));
    const normalizedUrl = normalizedScriptUrl(documentRef, url);
    if (!normalizedUrl) {
      return Promise.reject(resourceError('preview-enhancement-resource-conflict'));
    }
    const cached = scriptLoads.get(id);
    if (
      cached
      && normalizedScriptUrl(documentRef, cached.url) !== normalizedUrl
      && !cached.loaded()
    ) {
      cached.cancel();
    }
    const existing = documentRef.getElementById(id);
    if (
      existing
      && (
        !(existing instanceof HTMLScriptElement)
        || normalizedScriptUrl(documentRef, existing.getAttribute('src') ?? '') !== normalizedUrl
      )
    ) {
      return Promise.reject(resourceError('preview-enhancement-resource-conflict'));
    }

    const matchingScripts = Array.from(
      documentRef.querySelectorAll<HTMLScriptElement>('script[src]')
    ).filter((script) =>
      normalizedScriptUrl(documentRef, script.getAttribute('src') ?? '') === normalizedUrl
    );
    if (matchingScripts.length > 1) {
      return Promise.reject(resourceError('preview-enhancement-resource-conflict'));
    }
    const existingByUrl = matchingScripts[0];

    if (
      cached
      && normalizedScriptUrl(documentRef, cached.url) === normalizedUrl
      && cached.script.isConnected
    ) {
      return waitForResource(cached.promise, signal);
    }
    if (cached && !cached.loaded()) cached.cancel();

    if (existing) {
      if (
        normalizedScriptUrl(documentRef, existing.dataset.easymdeLoaded ?? '') === normalizedUrl
      ) return Promise.resolve();
      if ('loading' === documentRef.readyState) {
        // WordPress may have started this matching script before the loader ran.
        // Keep the external node untouched; loadRuntime rechecks availability after load.
        return waitForExistingScript(existing, signal);
      }
      return Promise.reject(resourceError('preview-enhancement-runtime-unavailable'));
    }
    const cachedByUrl = scriptLoadsByUrl.get(normalizedUrl);
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

    if (existingByUrl) {
      if (
        normalizedScriptUrl(documentRef, existingByUrl.dataset.easymdeLoaded ?? '') === normalizedUrl
      ) return Promise.resolve();
      if ('loading' === documentRef.readyState) {
        // URL matching is exact after normalization; never take ownership of this node.
        return waitForExistingScript(existingByUrl, signal);
      }
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
      for (const alias of load.ids) {
        if (scriptLoads.get(alias) === load) scriptLoads.delete(alias);
      }
      if (scriptLoadsByUrl.get(normalizedUrl) === load) {
        scriptLoadsByUrl.delete(normalizedUrl);
      }
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
    scriptLoadsByUrl.set(normalizedUrl, load);
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
    for (const cancel of [...externalScriptWaits]) cancel();
    externalScriptWaits.clear();
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

  return {
    dispose,
    loadExternalScript: waitForExternalScript,
    loadScript,
    loadStylesheet,
    prepareStylesheet
  };
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

  async function prepareCodeTheme(
    context: PreviewEnhancementContext
  ): Promise<PreparedCodeTheme> {
    const prepared = await prepareCodeThemeForOwner(context, 'activation');
    try {
      await loadRuntime(options.runtime.hasHighlight, () =>
        loader.loadScript(
          'easymde-highlight-js',
          assets.highlightScriptUrl,
          context.signal
        ));
      const warmed = await options.runtime.warmHighlightAuto(context.signal);
      if (context.signal.aborted) {
        throw resourceError('preview-enhancement-resource-stale');
      }
      if (!warmed) {
        throw resourceError('preview-enhancement-runtime-unavailable');
      }
      return prepared;
    } catch (error) {
      prepared.cancel();
      throw error;
    }
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

  async function prepareMath(
    signal: AbortSignal,
    sharedRuntime: Promise<void>
  ): Promise<void> {
    await Promise.all([
      loader.loadStylesheet(assets.mathCssLinkId, assets.mathCssUrl, signal),
      loader.loadStylesheet(assets.katexCssLinkId, assets.katexCssUrl, signal),
      loadRuntime(options.runtime.hasKatex, () =>
        loader.loadScript('easymde-katex-js', assets.katexScriptUrl, signal)),
      sharedRuntime
    ]);
    if (!options.runtime.hasMathRenderer()) {
      throw resourceError('preview-enhancement-runtime-unavailable');
    }
  }

  async function prepareMermaid(
    signal: AbortSignal,
    sharedRuntime: Promise<void>
  ): Promise<void> {
    const mermaidScriptUrl = assets.mermaidScriptUrl;
    if (!mermaidScriptUrl) {
      throw resourceError('preview-enhancement-mermaid-runtime-unavailable');
    }
    await Promise.all([
      loadRuntime(options.runtime.hasMermaid, () =>
        loader.loadScript('easymde-mermaid-js', mermaidScriptUrl, signal)),
      sharedRuntime
    ]);
    if (!options.runtime.hasMermaidRenderer()) {
      throw resourceError('preview-enhancement-runtime-unavailable');
    }
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
      const sharedController = hasExecutableEnhancement
        ? new AbortController()
        : null;
      let removeSharedAbortListener: (() => void) | null = null;
      if (sharedController) {
        const forwardAbort = () => sharedController.abort();
        if (context.signal.aborted) {
          sharedController.abort();
        } else {
          context.signal.addEventListener('abort', forwardAbort, { once: true });
          removeSharedAbortListener = () => {
            context.signal.removeEventListener('abort', forwardAbort);
          };
        }
      }
      const sharedRuntime = hasExecutableEnhancement
        ? loadRuntime(
          () => !!options.runtime.getEnhancements(),
          () => loader.loadExternalScript(
            'easymde-enhancements-js',
            assets.mathRendererUrl,
            sharedController?.signal ?? context.signal,
            () => !!options.runtime.getEnhancements()
          )
        )
        : null;
      if (sharedRuntime) tasks.push(sharedRuntime);

      if (fallbackFeatures.syntaxHighlight) {
        tasks.push(prepareHighlight(context.codeTheme, context.signal));
      } else if (mermaidAssetFailure) {
        tasks.push(
          prepareCodeThemeForOwner(context, 'enhancement')
            .then((prepared) => prepared.commit())
        );
      }
      if (fallbackFeatures.math) {
        if (!sharedRuntime) {
          throw resourceError('preview-enhancement-runtime-unavailable');
        }
        tasks.push(prepareMath(context.signal, sharedRuntime));
      }
      if (fallbackFeatures.mermaid) {
        if (!sharedRuntime) {
          throw resourceError('preview-enhancement-runtime-unavailable');
        }
        tasks.push(prepareMermaid(context.signal, sharedRuntime));
      }
      if (fallbackFeatures.toc) {
        tasks.push(
          loader.loadStylesheet(assets.tocCssLinkId, assets.tocCssUrl, context.signal)
        );
      }
      if (!tasks.length) return;

      try {
        await Promise.all(tasks);
      } catch (error) {
        sharedController?.abort();
        await sharedRuntime?.catch(() => undefined);
        throw error;
      } finally {
        removeSharedAbortListener?.();
      }
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
      }, { isCurrent, signal: context.signal });
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
  type HighlightWarmRuntime = Readonly<{
    highlight: (
      code: string,
      options: Readonly<{ ignoreIllegals: boolean; language: string }>
    ) => unknown;
    listLanguages: () => string[];
  }>;
  let warmedHighlightRuntime: HighlightWarmRuntime | null = null;
  return {
    getEnhancements: () => windowRef.EasyMDEEnhancements ?? null,
    hasHighlight: () => !!windowRef.hljs,
    hasKatex: () => !!windowRef.katex,
    hasMathRenderer: () => !!windowRef.EasyMDEMathRenderer,
    hasMermaid: () => !!windowRef.mermaid,
    hasMermaidRenderer: () => !!windowRef.EasyMDEMermaidRenderer,
    async warmHighlightAuto(signal) {
      const highlight = windowRef.hljs as HighlightWarmRuntime | undefined;
      if (!highlight) return false;
      if (warmedHighlightRuntime === highlight) return true;
      const languages = highlight.listLanguages();
      for (let index = 0; index < languages.length; index += 1) {
        if (signal.aborted) return false;
        const language = languages[index];
        if (undefined === language) return false;
        highlight.highlight('', { ignoreIllegals: true, language });
        const hasMore = index < languages.length - 1;
        if (hasMore) {
          await new Promise<void>((resolve) => windowRef.setTimeout(resolve, 0));
        }
      }
      if (signal.aborted) return false;
      warmedHighlightRuntime = highlight;
      return true;
    }
  };
}
