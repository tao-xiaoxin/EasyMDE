import { describe, expect, it, vi } from 'vitest';

import { createNativeTitleSession } from './native-title-session';

describe('createNativeTitleSession', () => {
  it('exposes the WordPress title value and saved baseline without writing either value', () => {
    const field = document.createElement('input');
    field.defaultValue = 'Saved title';
    field.value = 'Current title';

    const session = createNativeTitleSession(field);

    expect(session.getSnapshot()).toEqual({
      savedValue: 'Saved title',
      value: 'Current title'
    });
    expect(field.value).toBe('Current title');

    session.destroy();
  });

  it('publishes stable snapshots for native input and change events', () => {
    const field = document.createElement('input');
    field.defaultValue = 'Saved title';
    field.value = 'Saved title';
    const session = createNativeTitleSession(field);
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    expect(session.getSnapshot()).toBe(session.getSnapshot());

    field.value = 'Edited title';
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toEqual({
      savedValue: 'Saved title',
      value: 'Edited title'
    });
    expect(session.getSnapshot()).toBe(session.getSnapshot());

    field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    session.destroy();
  });

  it('stops publishing after unsubscribe and destroy', () => {
    const field = document.createElement('input');
    const session = createNativeTitleSession(field);
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    unsubscribe();
    field.value = 'Ignored once';
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    session.subscribe(listener);
    session.destroy();
    field.value = 'Ignored twice';
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(listener).not.toHaveBeenCalled();
  });
});
