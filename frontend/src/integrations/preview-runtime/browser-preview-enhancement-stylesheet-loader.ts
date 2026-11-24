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

function toStyleScopeError(error: unknown): Error {
  return error instanceof Error
    ? error
    : resourceError('preview-enhancement-style-scope-failed');
}

function disposeScopeLeaseSafely(
  lease: EditorStylesheetScopeLease | null
): void {
  if (!lease) return;
  try {
    lease.dispose();
  } catch {
    // Ignore secondary rollback failures during cleanup/teardown so DOM cleanup and settlement still complete.
  }
}

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
  const styleLoadVersions = new Map<string, number>();
  const preparedStyleSlots = new Map<string, PreparedStyleSlot>();
  let disposed = false;
  const isLoaderDisposed = () => disposed || isDisposed();
  const bumpStyleLoadVersion = (id: string): number => {
    const nextVersion = (styleLoadVersions.get(id) ?? 0) + 1;
    styleLoadVersions.set(id, nextVersion);
    return nextVersion;
  };

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
    if (isLoaderDisposed()) {
      return Promise.reject(resourceError('preview-enhancement-runtime-unavailable'));
    }
    if (signal.aborted) {
      return Promise.reject(resourceError('preview-enhancement-resource-stale'));
    }
    const callVersion = bumpStyleLoadVersion(id);
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
      const isReuseInvalidated = () => (
        isLoaderDisposed()
        || signal.aborted
        || styleLoadVersions.get(id) !== callVersion
        || !current.isConnected
        || documentRef.getElementById(id) !== current
      );
      let acquiredScopeLease: EditorStylesheetScopeLease | null = null;
      try {
        acquiredScopeLease = scopeEditorStylesheetLink(
          current,
          { rootSelector: editorRootSelector }
        );
      } catch (error) {
        disposeScopeLeaseSafely(acquiredScopeLease);
        return Promise.reject(toStyleScopeError(error));
      }
      if (isReuseInvalidated()) {
        disposeScopeLeaseSafely(acquiredScopeLease);
        return Promise.reject(
          resourceError(
            isLoaderDisposed()
              ? 'preview-enhancement-runtime-unavailable'
              : 'preview-enhancement-resource-stale'
          )
        );
      }
      const orphanLoad = styleLoads.get(id);
      if (orphanLoad) {
        if (!orphanLoad.loaded()) {
          orphanLoad.cancel();
        }
        const orphanScopeLease = orphanLoad.scopeLease;
        orphanLoad.scopeLease = null;
        if (orphanScopeLease) {
          try {
            orphanScopeLease.dispose();
          } catch (error) {
            disposeScopeLeaseSafely(acquiredScopeLease);
            return Promise.reject(toStyleScopeError(error));
          }
        }
      }
      if (isReuseInvalidated()) {
        disposeScopeLeaseSafely(acquiredScopeLease);
        return Promise.reject(
          resourceError(
            isLoaderDisposed()
              ? 'preview-enhancement-runtime-unavailable'
              : 'preview-enhancement-resource-stale'
          )
        );
      }
      const loaded = Promise.resolve();
      let existingScopeLease: EditorStylesheetScopeLease | null = acquiredScopeLease;
      styleLoads.set(id, {
        cancel: () => {
          disposeScopeLeaseSafely(existingScopeLease);
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
      disposeScopeLeaseSafely(activeLoad.scopeLease);
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
    let loadEventHandled = false;
    let cancelled = false;
    let settled = false;
    let previousRestored = false;
    let scopeLease: EditorStylesheetScopeLease | null = null;
    let resolveLoad!: () => void;
    let rejectLoad!: (error: Error) => void;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let load!: StyleLoad;
    const resolvePromise = () => {
      if (settled) return;
      settled = true;
      resolveLoad();
    };
    const rejectPromise = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectLoad(error);
    };
    const restorePrevious = () => {
      link.remove();
      if (previousRestored) return;
      previousRestored = true;
      const isCurrentLoad = styleLoads.get(id) === load;
      if (isCurrentLoad && previous?.isConnected) {
        previous.id = id;
        if (previousLoad) {
          styleLoads.set(id, previousLoad);
        } else {
          styleLoads.delete(id);
        }
        return;
      }
      if (previousLoad && styleLoads.get(id) !== previousLoad) {
        disposeScopeLeaseSafely(previousLoad.scopeLease);
        previousLoad.scopeLease = null;
      }
      if (!isCurrentLoad && (!previous || styleLoads.get(id)?.link !== previous)) {
        previous?.remove();
      }
      if (isCurrentLoad) {
        styleLoads.delete(id);
      }
    };
    let handleLoad: () => void = () => undefined;
    let handleError: () => void = () => undefined;
    const cleanup = () => {
      link.removeEventListener('load', handleLoad);
      link.removeEventListener('error', handleError);
      if (null !== timer) clearTimeout(timer);
      timer = null;
    };
    const promise = new Promise<void>((resolve, reject) => {
      resolveLoad = resolve;
      rejectLoad = reject;
    });
    void promise.catch(() => undefined);
    const isLoadInvalidated = () => (
      isLoaderDisposed()
      || cancelled
      || settled
      || styleLoads.get(id) !== load
    );
    const abortHandleLoad = (
      acquiredScopeLease: EditorStylesheetScopeLease | null
    ) => {
      disposeScopeLeaseSafely(acquiredScopeLease);
      link.remove();
      if (!cancelled && !settled) {
        restorePrevious();
        rejectPromise(
          resourceError(
            isLoaderDisposed()
              ? 'preview-enhancement-runtime-unavailable'
              : 'preview-enhancement-resource-stale'
          )
        );
      }
    };
    handleLoad = () => {
      if (loadEventHandled || cancelled || settled) return;
      loadEventHandled = true;
      cleanup();
      let acquiredScopeLease: EditorStylesheetScopeLease | null = null;
      try {
        acquiredScopeLease = scopeEditorStylesheetLink(
          link,
          { rootSelector: editorRootSelector }
        );
        if (isLoadInvalidated()) {
          abortHandleLoad(acquiredScopeLease);
          acquiredScopeLease = null;
          return;
        }
        if (previousLoad) {
          const previousScopeLease = previousLoad.scopeLease;
          previousLoad.scopeLease = null;
          previousScopeLease?.dispose();
        }
        if (isLoadInvalidated()) {
          abortHandleLoad(acquiredScopeLease);
          acquiredScopeLease = null;
          return;
        }
        scopeLease = acquiredScopeLease;
        acquiredScopeLease = null;
        previous?.remove();
        load.scopeLease = scopeLease;
        loaded = true;
        link.dataset.easymdeLoadedHref = url;
        const activePreparedSlot = preparedStyleSlots.get(id);
        if (activePreparedSlot) {
          activePreparedSlot.authoritativeActivationUrl = null;
        }
        resolvePromise();
      } catch (error) {
        disposeScopeLeaseSafely(acquiredScopeLease);
        acquiredScopeLease = null;
        disposeScopeLeaseSafely(scopeLease);
        scopeLease = null;
        load.scopeLease = null;
        link.remove();
        if (!cancelled && !settled) {
          restorePrevious();
          rejectPromise(toStyleScopeError(error));
        }
      }
    };
    handleError = () => {
      if (loadEventHandled || cancelled || settled) return;
      loadEventHandled = true;
      cleanup();
      disposeScopeLeaseSafely(scopeLease);
      scopeLease = null;
      load.scopeLease = null;
      restorePrevious();
      rejectPromise(resourceError('preview-enhancement-resource-load-failed'));
    };
    const cancel = () => {
      if (cancelled || settled) return;
      cancelled = true;
      loadEventHandled = true;
      cleanup();
      disposeScopeLeaseSafely(scopeLease);
      scopeLease = null;
      load.scopeLease = null;
      restorePrevious();
      rejectPromise(resourceError('preview-enhancement-resource-stale'));
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
    styleLoads.set(id, createdLoad);
    link.addEventListener('load', handleLoad);
    link.addEventListener('error', handleError);
    link.href = url;
    timer = setTimeout(handleError, RESOURCE_LOAD_TIMEOUT_MS);
    try {
      if (!link.parentNode) getDocumentHead(documentRef).appendChild(link);
    } catch {
      handleError();
    }
    return createdLoad.wait(signal);
  }

  function prepareStylesheet(
    id: string,
    url: string,
    signal: AbortSignal,
    owner: PreparedStyleOwner
  ): PreparedStyleLoad {
    if (isLoaderDisposed()) {
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
    let state: 'pending' | 'ready' | 'terminal' = 'pending';
    let settled = false;
    let scopeLease: EditorStylesheetScopeLease | null = null;
    let commitRequested = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let resolveLoad!: (prepared: PreparedCodeTheme) => void;
    let rejectLoad!: (error: Error) => void;
    const resolvePromise = (prepared: PreparedCodeTheme) => {
      if (settled) return;
      settled = true;
      resolveLoad(prepared);
    };
    const rejectPromise = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectLoad(error);
    };
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
      rejectionError?: Error,
      committedActivationUrl?: string,
      preserveLink = false
    ) => {
      if ('terminal' === state) return;
      state = 'terminal';
      cleanup();
      if (!preserveLink) {
        disposeScopeLeaseSafely(scopeLease);
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
      if (!settled) {
        rejectPromise(
          rejectionError ?? resourceError('preview-enhancement-resource-stale')
        );
      }
      reconcile();
      pruneActivationOutcomes();
    };
    const applyCommit = () => {
      if ('ready' !== state || !commitRequested || isLoaderDisposed()) return;
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
      if ('ready' !== state || !commitRequested || isLoaderDisposed()) {
        finish(
          resourceError(
            isLoaderDisposed()
              ? 'preview-enhancement-runtime-unavailable'
              : 'preview-enhancement-resource-stale'
          )
        );
        return;
      }
      const current = documentRef.getElementById(id);
      if (current && !(current instanceof HTMLLinkElement)) {
        finish();
        return;
      }
      if (!link && (!(existing instanceof HTMLLinkElement) || current !== existing)) {
        finish();
        return;
      }
      const previousLoad = styleLoads.get(id);
      if (previousLoad) {
        const previousScopeLease = previousLoad.scopeLease;
        previousLoad.scopeLease = null;
        if (previousScopeLease) {
          try {
            previousScopeLease.dispose();
          } catch (error) {
            finish(toStyleScopeError(error));
            return;
          }
        }
      }
      if ('ready' !== state || !commitRequested || isLoaderDisposed()) {
        finish(
          resourceError(
            isLoaderDisposed()
              ? 'preview-enhancement-runtime-unavailable'
              : 'preview-enhancement-resource-stale'
          )
        );
        return;
      }
      if (link && !link.isConnected) {
        finish();
        return;
      }
      const currentAfterDispose = documentRef.getElementById(id);
      if (currentAfterDispose && !(currentAfterDispose instanceof HTMLLinkElement)) {
        finish();
        return;
      }
      let activeLink: HTMLLinkElement;
      if (link) {
        currentAfterDispose?.remove();
        link.id = id;
        link.media = 'all';
        link.dataset.easymdeLoadedHref = url;
        activeLink = link;
      } else {
        if (!(existing instanceof HTMLLinkElement) || currentAfterDispose !== existing) {
          finish();
          return;
        }
        activeLink = existing;
      }
      bumpStyleLoadVersion(id);
      if ('activation' === owner) {
        slot.committedActivationSequence = sequence;
        slot.authoritativeActivationUrl = url;
      } else {
        slot.committedEnhancementSequence = sequence;
      }
      const ready = Promise.resolve();
      styleLoads.set(id, {
        cancel: () => {
          disposeScopeLeaseSafely(scopeLease);
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
    const cancel = () => finish(resourceError('preview-enhancement-resource-stale'));
    const commit = () => {
      if ('ready' !== state || signal.aborted || isLoaderDisposed()) {
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
        const acquiredScopeLease = scopeEditorStylesheetLink(
          existing,
          { rootSelector: editorRootSelector }
        );
        if ('pending' !== state || isLoaderDisposed() || signal.aborted) {
          disposeScopeLeaseSafely(acquiredScopeLease);
          finish(
            resourceError(
              isLoaderDisposed()
                ? 'preview-enhancement-runtime-unavailable'
                : 'preview-enhancement-resource-stale'
            )
          );
          return load;
        }
        scopeLease = acquiredScopeLease;
        state = 'ready';
        resolvePromise({ cancel, commit });
      } catch (error) {
        finish(toStyleScopeError(error));
      }
      return load;
    }
    handleLoad = () => {
      if ('pending' !== state || !link) return;
      cleanupLoad();
      try {
        const acquiredScopeLease = scopeEditorStylesheetLink(
          link,
          { rootSelector: editorRootSelector }
        );
        if ('pending' !== state || isLoaderDisposed() || signal.aborted) {
          disposeScopeLeaseSafely(acquiredScopeLease);
          finish(
            resourceError(
              isLoaderDisposed()
                ? 'preview-enhancement-runtime-unavailable'
                : 'preview-enhancement-resource-stale'
            )
          );
          return;
        }
        scopeLease = acquiredScopeLease;
        state = 'ready';
        link.dataset.easymdeLoadedHref = url;
        resolvePromise({ cancel, commit });
      } catch (error) {
        finish(toStyleScopeError(error));
      }
    };
    handleError = () => finish(resourceError('preview-enhancement-resource-load-failed'));
    link?.addEventListener('load', handleLoad);
    link?.addEventListener('error', handleError);
    timer = setTimeout(handleError, RESOURCE_LOAD_TIMEOUT_MS);
    try {
      if (link) getDocumentHead(documentRef).appendChild(link);
    } catch {
      finish(resourceError('preview-enhancement-document-head-missing'));
    }
    return load;
  }

  function dispose(): void {
    disposed = true;
    for (const load of [...styleLoads.values()]) {
      if (!load.loaded()) load.cancel();
    }
    for (const load of [...styleLoads.values()]) {
      disposeScopeLeaseSafely(load.scopeLease);
      load.scopeLease = null;
    }
    for (const slot of preparedStyleSlots.values()) {
      cancelPreparedSlotLoads(slot);
    }
    styleLoads.clear();
    preparedStyleSlots.clear();
    styleLoadVersions.clear();
  }

  return {
    dispose,
    loadStylesheet,
    prepareStylesheet
  };
}
