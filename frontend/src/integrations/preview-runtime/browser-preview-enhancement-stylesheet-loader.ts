import type { PreparedCodeTheme } from '../../features/live-preview/ports/preview-enhancement-port';
import {
  getDocumentHead,
  RESOURCE_LOAD_TIMEOUT_MS,
  resourceError,
  waitForResource
} from './browser-preview-enhancement-resource-helpers';

type StyleLoad = Readonly<{
  cancel: () => void;
  link: HTMLLinkElement;
  loaded: () => boolean;
  promise: Promise<void>;
  url: string;
}>;

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
};

export function createPreviewStylesheetLoader(
  documentRef: Document,
  isDisposed: () => boolean
) {
  const styleLoads = new Map<string, StyleLoad>();
  const preparedStyleSlots = new Map<string, PreparedStyleSlot>();

  function loadStylesheet(id: string, url: string, signal: AbortSignal): Promise<void> {
    if (isDisposed()) {
      return Promise.reject(resourceError('preview-enhancement-runtime-unavailable'));
    }
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
        if (!link.parentNode) getDocumentHead(documentRef).appendChild(link);
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
      if (link) getDocumentHead(documentRef).appendChild(link);
    } catch {
      finish('preview-enhancement-document-head-missing');
    }
    return load;
  }

  function dispose(): void {
    for (const load of styleLoads.values()) {
      if (!load.loaded()) load.cancel();
    }
    for (const slot of preparedStyleSlots.values()) {
      for (const load of [...slot.loads]) load.cancel();
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
