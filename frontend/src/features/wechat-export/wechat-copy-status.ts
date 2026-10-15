import { useSyncExternalStore } from '@wordpress/element';

export type WechatCopyStatusSnapshot = Readonly<{
  pending: boolean;
  unavailable: boolean;
}>;

export type WechatCopyStatusStore = Readonly<{
  getSnapshot: () => WechatCopyStatusSnapshot;
  setPending: (pending: boolean) => void;
  setUnavailable: (unavailable: boolean) => void;
  subscribe: (listener: () => void) => () => void;
}>;

const INITIAL_SNAPSHOT: WechatCopyStatusSnapshot = Object.freeze({
  pending: false,
  unavailable: false
});

export function createWechatCopyStatusStore(): WechatCopyStatusStore {
  let snapshot = INITIAL_SNAPSHOT;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    setPending: (pending) => {
      if (snapshot.pending === pending) return;
      snapshot = Object.freeze({ ...snapshot, pending });
      for (const listener of listeners) listener();
    },
    setUnavailable: (unavailable) => {
      if (snapshot.unavailable === unavailable) return;
      snapshot = Object.freeze({ ...snapshot, unavailable });
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export function useWechatCopyStatus(
  store: WechatCopyStatusStore
): WechatCopyStatusSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
