export type NativeTitleSnapshot = Readonly<{
  savedValue: string;
  value: string;
}>;

export type NativeTitleSession = Readonly<{
  destroy: () => void;
  getSnapshot: () => NativeTitleSnapshot;
  subscribe: (listener: () => void) => () => void;
}>;

export function createNativeTitleSession(field: HTMLInputElement): NativeTitleSession {
  const listeners = new Set<() => void>();
  const savedValue = field.defaultValue;
  let destroyed = false;
  let snapshot: NativeTitleSnapshot = {
    savedValue,
    value: field.value
  };

  const publish = () => {
    if (destroyed || field.value === snapshot.value) {
      return;
    }

    snapshot = {
      savedValue,
      value: field.value
    };
    for (const listener of listeners) {
      listener();
    }
  };

  field.addEventListener('input', publish);
  field.addEventListener('change', publish);

  return {
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      listeners.clear();
      field.removeEventListener('input', publish);
      field.removeEventListener('change', publish);
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (destroyed) {
        return () => {};
      }

      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
