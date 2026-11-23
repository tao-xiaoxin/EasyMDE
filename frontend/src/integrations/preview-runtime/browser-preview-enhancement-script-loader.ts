import {
  getDocumentHead,
  RESOURCE_LOAD_TIMEOUT_MS,
  resourceError,
  waitForResource
} from './browser-preview-enhancement-resource-helpers';

type ScriptLoad = Readonly<{
  cancel: () => void;
  ids: Set<string>;
  loaded: () => boolean;
  promise: Promise<void>;
  script: HTMLScriptElement;
  url: string;
}>;

function normalizedScriptUrl(documentRef: Document, value: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, documentRef.baseURI).href;
  } catch {
    return null;
  }
}

export function createPreviewScriptLoader(
  documentRef: Document,
  isDisposed: () => boolean
) {
  const scriptLoads = new Map<string, ScriptLoad>();
  const scriptLoadsByUrl = new Map<string, ScriptLoad>();
  const externalScriptWaits = new Set<() => void>();

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

  function loadExternalScript(
    id: string,
    url: string,
    signal: AbortSignal,
    available: () => boolean
  ): Promise<void> {
    if (isDisposed()) {
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
      timer = setTimeout(
        () => fail('preview-enhancement-resource-load-failed'),
        RESOURCE_LOAD_TIMEOUT_MS
      );
      discover();
      if (signal.aborted) abort();
    });
  }

  function loadScript(id: string, url: string, signal: AbortSignal): Promise<void> {
    if (isDisposed()) {
      return Promise.reject(resourceError('preview-enhancement-runtime-unavailable'));
    }
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
      getDocumentHead(documentRef).appendChild(script);
    } catch {
      fail('preview-enhancement-document-head-missing');
    }
    return waitForResource(promise, signal);
  }

  function dispose(): void {
    for (const cancel of [...externalScriptWaits]) cancel();
    externalScriptWaits.clear();
    for (const load of scriptLoads.values()) {
      if (!load.loaded()) load.cancel();
    }
    scriptLoads.clear();
    scriptLoadsByUrl.clear();
  }

  return {
    dispose,
    loadExternalScript,
    loadScript
  };
}
