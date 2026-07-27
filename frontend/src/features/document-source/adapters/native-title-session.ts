export type NativeTitleSnapshot = Readonly<{
  savedValue: string;
  value: string;
}>;

export type NativeTitleSession = Readonly<{
  destroy: () => void;
  getSnapshot: () => NativeTitleSnapshot;
  replaceSavedValue: (value: string) => void;
  setValue: (value: string) => void;
  subscribe: (listener: () => void) => () => void;
}>;

export function createNativeTitleSession(
  field: HTMLInputElement | null
): NativeTitleSession {
  if (!field) {
    const snapshot: NativeTitleSnapshot = { savedValue: '', value: '' };
    return {
      destroy() {},
      getSnapshot: () => snapshot,
      replaceSavedValue() {},
      setValue() {},
      subscribe: () => () => {}
    };
  }

  const listeners = new Set<() => void>();
  let savedValue = field.defaultValue;
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
    replaceSavedValue(value: string) {
      if (destroyed || value === savedValue) return;
      savedValue = value;
      snapshot = { savedValue, value: snapshot.value };
      for (const listener of listeners) listener();
    },
    setValue(value: string) {
      if (destroyed || field.value === value) return;
      const EventConstructor = field.ownerDocument.defaultView?.Event;
      if (!EventConstructor)
        throw new Error('native-title-event-constructor-unavailable');
      field.value = value;
      field.dispatchEvent(new EventConstructor('input', { bubbles: true }));
    },
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
