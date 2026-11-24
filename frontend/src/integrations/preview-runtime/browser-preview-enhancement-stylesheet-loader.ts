import type { PreparedCodeTheme } from '../../features/live-preview/ports/preview-enhancement-port';
import {
  type EditorStylesheetScopeLease,
  scopeEditorStylesheetLink
} from '../../shared/css/editor-stylesheet-scope';
import {
  getDocumentHead,
  RESOURCE_LOAD_TIMEOUT_MS,
  resourceError,
  waitForResource
} from './browser-preview-enhancement-resource-helpers';

type StyleLoad = {
  cancel: () => void;
  link: HTMLLinkElement;
  loaded: () => boolean;
  promise: Promise<void>;
  scopeLease: EditorStylesheetScopeLease | null;
  url: string;
  wait: (signal: AbortSignal) => Promise<void>;
};

function createStyleLoadWait(
  promise: Promise<void>,
  isLoaded: () => boolean,
  cancel: () => void
): (signal: AbortSignal) => Promise<void> {
  let activeWaiters = 0;
  return (signal: AbortSignal): Promise<void> => {
    if (signal.aborted) {
      return Promise.reject(resourceError('preview-enhancement-resource-stale'));
    }
    if (isLoaded()) {
      return waitForResource(promise, signal);
    }
    activeWaiters += 1;
    let released = false;
    const release = (aborted: boolean) => {
      if (released) return;
      released = true;
      activeWaiters = Math.max(0, activeWaiters - 1);
      if (aborted && 0 === activeWaiters && !isLoaded()) {
        cancel();
      }
    };
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let abort: () => void;
      const finish = (callback: () => void, aborted = false) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        release(aborted);
        callback();
      };
      abort = () => finish(
        () => reject(resourceError('preview-enhancement-resource-stale')),
        true
      );
      signal.addEventListener('abort', abort, { once: true });
      void promise.then(
        () => finish(resolve),
        (error) => finish(() => reject(error))
      );
    });
  };
}

export type PreparedStyleOwner = 'activation' | 'enhancement';

export type PreparedStyleLoad = Readonly<{
  attemptCommit: () => void;
  cancel: () => void;
  owner: PreparedStyleOwner;
  promise: Promise<PreparedCodeTheme>;
  sequence: number;
}>;

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
  suppressReconcile: boolean;
};

export function createPreviewStylesheetLoader(
  documentRef: Document,
  isDisposed: () => boolean,
  editorRootSelector: string
) {
  const styleLoads = new Map<string, StyleLoad>();
  const preparedStyleSlots = new Map<string, PreparedStyleSlot>();

  function cancelPreparedSlotLoads(slot: PreparedStyleSlot): void {
    const loadsToCancel = [...slot.loads];
    const previousSuppressReconcile = slot.suppressReconcile;
    slot.suppressReconcile = true;
    try {
      for (const load of loadsToCancel) load.cancel();
    } finally {
      slot.suppressReconcile = previousSuppressReconcile;
    }
  }

  function loadStylesheet(id: string, url: string, signal: AbortSignal): Promise<void> {
    if (isDisposed()) {
      return Promise.reject(resourceError('preview-enhancement-runtime-unavailable'));
    }
    if (signal.aborted) {
      return Promise.reject(resourceError('preview-enhancement-resource-stale'));
    }
    const preparedSlot = preparedStyleSlots.get(id);
    if (preparedSlot) {
      cancelPreparedSlotLoads(preparedSlot);
    }
    const cached = styleLoads.get(id);
    const existing = documentRef.getElementById(id);
    if (
      cached?.url === url
      && cached.link.isConnected
      && cached.link.getAttribute('href') === url
    ) {
      return cached.wait(signal);
    }
    if (existing && !(existing instanceof HTMLLinkElement)) {
      return Promise.reject(resourceError('preview-enhancement-resource-conflict'));
    }

    if (cached && !cached.loaded()) {
      cached.cancel();
    }

    const restored = styleLoads.get(id);
    if (
      restored?.url === url
      && restored.link.isConnected
      && restored.link.getAttribute('href') === url
    ) {
      return restored.wait(signal);
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
      const orphanLoad = styleLoads.get(id);
      if (orphanLoad && orphanLoad.link !== current) {
        orphanLoad.scopeLease?.dispose();
        orphanLoad.scopeLease = null;
      }
      const loaded = Promise.resolve();
      let existingScopeLease: EditorStylesheetScopeLease | null = null;
      try {
        existingScopeLease = scopeEditorStylesheetLink(
          current,
          { rootSelector: editorRootSelector }
        );
      } catch (error) {
        existingScopeLease?.dispose();
        return Promise.reject(
          error instanceof Error
            ? error
            : resourceError('preview-enhancement-style-scope-failed')
        );
      }
      styleLoads.set(id, {
        cancel: () => {
          existingScopeLease?.dispose();
          existingScopeLease = null;
        },
        link: current,
        loaded: () => true,
        promise: loaded,
        scopeLease: existingScopeLease,
        url,
        wait: (waitSignal) => waitForResource(loaded, waitSignal)
      });
      const activePreparedSlot = preparedStyleSlots.get(id);
      if (activePreparedSlot) {
        activePreparedSlot.authoritativeActivationUrl = null;
      }
      return waitForResource(loaded, signal);
    }

    const previous = current instanceof HTMLLinkElement ? current : null;
    const activeLoad = styleLoads.get(id) ?? null;
    const previousLoad = previous && activeLoad?.link === previous
      ? activeLoad
      : null;
    if (activeLoad && activeLoad !== previousLoad) {
      activeLoad.scopeLease?.dispose();
      activeLoad.scopeLease = null;
    }
    if (previous) {
      previous.id = `${id}-previous`;
    }
    const link = documentRef.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.dataset.easymdeStylesheetOwner = id;

    let loaded = false;
    let settled = false;
    let scopeLease: EditorStylesheetScopeLease | null = null;
    let rejectLoad!: (error: Error) => void;
    let cleanup = () => undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let load: StyleLoad | null = null;
    const restorePrevious = () => {
      link.remove();
      const isCurrentLoad = !load || styleLoads.get(id) === load;
      if (isCurrentLoad && previous?.isConnected) {
        previous.id = id;
        if (previousLoad) {
          styleLoads.set(id, previousLoad);
        } else if (load) {
          styleLoads.delete(id);
        }
        return;
      }
      if (previousLoad && styleLoads.get(id) !== previousLoad) {
        previousLoad.scopeLease?.dispose();
        previousLoad.scopeLease = null;
      }
      if (!isCurrentLoad && (!previous || styleLoads.get(id)?.link !== previous)) {
        previous?.remove();
      }
      if (load && styleLoads.get(id) === load) {
        styleLoads.delete(id);
      }
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
        try {
          scopeLease = scopeEditorStylesheetLink(
            link,
            { rootSelector: editorRootSelector }
          );
          if (previousLoad) {
            previousLoad.scopeLease?.dispose();
            previousLoad.scopeLease = null;
          }
          previous?.remove();
          if (load) load.scopeLease = scopeLease;
          loaded = true;
          link.dataset.easymdeLoadedHref = url;
          const activePreparedSlot = preparedStyleSlots.get(id);
          if (activePreparedSlot) {
            activePreparedSlot.authoritativeActivationUrl = null;
          }
          resolve();
        } catch (error) {
          scopeLease?.dispose();
          scopeLease = null;
          if (load) load.scopeLease = null;
          restorePrevious();
          reject(
            error instanceof Error
              ? error
              : resourceError('preview-enhancement-style-scope-failed')
          );
        }
      };
      const handleError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        scopeLease?.dispose();
        scopeLease = null;
        if (load) load.scopeLease = null;
        restorePrevious();
        reject(resourceError('preview-enhancement-resource-load-failed'));
      };
      link.addEventListener('load', handleLoad);
      link.addEventListener('error', handleError);
      link.href = url;
      timer = setTimeout(handleError, RESOURCE_LOAD_TIMEOUT_MS);
      try {
        if (!link.parentNode) getDocumentHead(documentRef).appendChild(link);
      } catch {
        handleError();
      }
    });
    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      scopeLease?.dispose();
      scopeLease = null;
      if (load) load.scopeLease = null;
      restorePrevious();
      rejectLoad(resourceError('preview-enhancement-resource-stale'));
    };
    const wait = createStyleLoadWait(promise, () => loaded, cancel);
    const createdLoad: StyleLoad = {
      cancel,
      link,
      loaded: () => loaded,
      promise,
      scopeLease,
      url,
      wait
    };
    load = createdLoad;
    if (!settled || loaded) {
      styleLoads.set(id, createdLoad);
    }
    return createdLoad.wait(signal);
  }

  function prepareStylesheet(
    id: string,
    url: string,
    signal: AbortSignal,
    owner: PreparedStyleOwner
  ): PreparedStyleLoad {
    if (isDisposed()) {
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
        reconciling: false,
        suppressReconcile: false
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
    let scopeLease: EditorStylesheetScopeLease | null = null;
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
      if (slot.reconciling || slot.suppressReconcile) return;
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
      if (!preserveLink) {
        scopeLease?.dispose();
        scopeLease = null;
        link?.remove();
      }
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
      if ('ready' !== state || !commitRequested || isDisposed()) return;
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

      if (link && !link.isConnected) {
        finish();
        return;
      }
      const existingBeforeCancel = documentRef.getElementById(id);
      if (existingBeforeCancel && !(existingBeforeCancel instanceof HTMLLinkElement)) {
        finish();
        return;
      }
      const activeLoad = styleLoads.get(id);
      if (activeLoad && !activeLoad.loaded()) {
        activeLoad.cancel();
      }
      const current = documentRef.getElementById(id);
      if (current && !(current instanceof HTMLLinkElement)) {
        finish();
        return;
      }
      let activeLink: HTMLLinkElement;
      if (link) {
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
      const previousLoad = styleLoads.get(id);
      if (previousLoad) {
        previousLoad.scopeLease?.dispose();
        previousLoad.scopeLease = null;
      }
      if ('activation' === owner) {
        slot.committedActivationSequence = sequence;
        slot.authoritativeActivationUrl = url;
      } else {
        slot.committedEnhancementSequence = sequence;
      }
      const ready = Promise.resolve();
      styleLoads.set(id, {
        cancel: () => {
          scopeLease?.dispose();
          scopeLease = null;
        },
        link: activeLink,
        loaded: () => true,
        promise: ready,
        scopeLease,
        url,
        wait: (waitSignal) => waitForResource(ready, waitSignal)
      });
      finish(undefined, 'activation' === owner ? url : undefined, true);
    };
    const cancel = () => finish('preview-enhancement-resource-stale');
    const commit = () => {
      if ('ready' !== state || signal.aborted || isDisposed()) {
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
      try {
        if (!(existing instanceof HTMLLinkElement)) {
          throw resourceError('preview-enhancement-resource-conflict');
        }
        scopeLease = scopeEditorStylesheetLink(
          existing,
          { rootSelector: editorRootSelector }
        );
        resolveLoad({ cancel, commit });
      } catch (error) {
        finish(
          error instanceof Error
            ? error.message
            : 'preview-enhancement-style-scope-failed'
        );
      }
      return load;
    }
    handleLoad = () => {
      if ('pending' !== state || !link) return;
      cleanupLoad();
      try {
        scopeLease = scopeEditorStylesheetLink(
          link,
          { rootSelector: editorRootSelector }
        );
        state = 'ready';
        link.dataset.easymdeLoadedHref = url;
        resolveLoad({ cancel, commit });
      } catch (error) {
        finish(
          error instanceof Error
            ? error.message
            : 'preview-enhancement-style-scope-failed'
        );
      }
    };
    handleError = () => finish('preview-enhancement-resource-load-failed');
    link?.addEventListener('load', handleLoad);
    link?.addEventListener('error', handleError);
    timer = setTimeout(handleError, RESOURCE_LOAD_TIMEOUT_MS);
    try {
      if (link) getDocumentHead(documentRef).appendChild(link);
    } catch {
      finish('preview-enhancement-document-head-missing');
    }
    return load;
  }

  function dispose(): void {
    for (const load of [...styleLoads.values()]) {
      if (!load.loaded()) load.cancel();
    }
    for (const load of [...styleLoads.values()]) {
      load.scopeLease?.dispose();
      load.scopeLease = null;
    }
    for (const slot of preparedStyleSlots.values()) {
      cancelPreparedSlotLoads(slot);
    }
    styleLoads.clear();
    preparedStyleSlots.clear();
  }

  return {
    dispose,
    loadStylesheet,
    prepareStylesheet
  };
}
