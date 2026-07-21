import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWordPressEditorSessionPort } from './create-wordpress-editor-session-port';

type HookCallback = (...args: ReadonlyArray<unknown>) => void;

function fixture() {
  const callbacks = new Map<string, HookCallback>();
  const hooks = {
    addAction: vi.fn((hook: string, namespace: string, callback: HookCallback) => {
      callbacks.set(`${hook}:${namespace}`, callback);
    }),
    removeAction: vi.fn((hook: string, namespace: string) => {
      callbacks.delete(`${hook}:${namespace}`);
    })
  };
  const form = document.createElement('form');
  form.innerHTML = `
    <input id="post_ID" value="7">
    <input id="active_post_lock" value="7:42">
    <div id="post-lock-dialog"></div>
  `;
  document.body.append(form);
  const nonceMiddleware = { nonce: 'initial-rest-nonce' };
  const port = createWordPressEditorSessionPort({
    apiFetch: { nonceMiddleware },
    document: form.ownerDocument,
    hooks,
    namespace: 'easymde/session-test'
  });
  const emit = (hook: string, ...args: ReadonlyArray<unknown>) => {
    callbacks.get(`${hook}:easymde/session-test`)?.(...args);
  };
  return { emit, form, hooks, nonceMiddleware, port };
}

afterEach(() => document.body.replaceChildren());

describe('createWordPressEditorSessionPort', () => {
  it('publishes one cached ready snapshot and refreshes the existing WordPress lock', () => {
    const { emit, port } = fixture();
    const first = port.getSnapshot();
    const listener = vi.fn();
    const unsubscribe = port.subscribe(listener);
    const data: Record<string, unknown> = {};

    emit('heartbeat.send', data);

    expect(first).toBe(port.getSnapshot());
    expect(first).toEqual({ status: 'ready' });
    expect(data).toEqual({
      'wp-refresh-post-lock': { lock: '7:42', post_id: '7' }
    });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('updates the apiFetch nonce owner before notifying subscribers', () => {
    const { emit, nonceMiddleware, port } = fixture();
    const snapshots: Array<unknown> = [];
    const unsubscribe = port.subscribe(() => snapshots.push(port.getSnapshot()));

    emit('heartbeat.nonces-expired');
    expect(port.getSnapshot()).toEqual({ status: 'nonce-expired' });
    emit('heartbeat.tick', { rest_nonce: 'refreshed-rest-nonce' });

    expect(nonceMiddleware.nonce).toBe('refreshed-rest-nonce');
    expect(port.getSnapshot()).toEqual({ status: 'ready' });
    expect(snapshots).toEqual([
      { status: 'nonce-expired' },
      { status: 'ready' }
    ]);
    unsubscribe();
  });

  it('blocks protected operations after authentication, lock, capability, or connection loss', () => {
    const { emit, form, port } = fixture();
    const unsubscribe = port.subscribe(vi.fn());

    emit('heartbeat.tick', { 'wp-auth-check': false });
    expect(port.getSnapshot()).toEqual({ status: 'authentication-required' });

    emit('heartbeat.tick', {
      'wp-auth-check': true,
      'wp-refresh-post-lock': { lock_error: { text: 'private server text' } }
    });
    expect(port.getSnapshot()).toEqual({ status: 'locked' });

    const sent: Record<string, unknown> = {};
    emit('heartbeat.send', sent);
    emit('heartbeat.tick', { 'wp-auth-check': true });
    expect(port.getSnapshot()).toEqual({ status: 'capability-lost' });

    emit('heartbeat.connection-lost');
    expect(port.getSnapshot()).toEqual({ status: 'connection-lost' });
    emit('heartbeat.connection-restored');
    emit('heartbeat.tick', {
      'wp-auth-check': true,
      'wp-refresh-post-lock': { new_lock: '7:99' }
    });
    expect(port.getSnapshot()).toEqual({ status: 'ready' });
    expect(form.querySelector<HTMLInputElement>('#active_post_lock')?.value).toBe('7:99');
    unsubscribe();
  });

  it('registers one hook set for multiple subscribers and removes it after idempotent final cleanup', () => {
    const { hooks, port } = fixture();
    const first = port.subscribe(vi.fn());
    const second = port.subscribe(vi.fn());

    expect(hooks.addAction).toHaveBeenCalledTimes(5);
    first();
    first();
    expect(hooks.removeAction).not.toHaveBeenCalled();
    second();
    second();
    expect(hooks.removeAction).toHaveBeenCalledTimes(5);
  });

  it('does not carry an unfinished lock request across teardown and remount', () => {
    const { emit, port } = fixture();
    const first = port.subscribe(vi.fn());
    emit('heartbeat.send', {});
    first();

    const second = port.subscribe(vi.fn());
    emit('heartbeat.tick', { 'wp-auth-check': true });

    expect(port.getSnapshot()).toEqual({ status: 'ready' });
    second();
  });

  it('does not invent a lock owner when WordPress supplies no lock surface', () => {
    document.body.innerHTML = '<input id="post_ID" value="7">';
    const hooks = { addAction: vi.fn(), removeAction: vi.fn() };
    const port = createWordPressEditorSessionPort({
      apiFetch: { nonceMiddleware: { nonce: 'synthetic-nonce' } },
      document,
      hooks,
      namespace: 'easymde/session-no-lock'
    });

    const unsubscribe = port.subscribe(vi.fn());

    expect(port.getSnapshot()).toEqual({ status: 'ready' });
    expect(hooks.addAction).toHaveBeenCalledTimes(5);
    unsubscribe();
  });

  it('fails before subscription when the WordPress nonce owner is unavailable', () => {
    expect(() => createWordPressEditorSessionPort({
      apiFetch: {},
      document,
      hooks: { addAction: vi.fn(), removeAction: vi.fn() },
      namespace: 'easymde/session-invalid'
    })).toThrowError('editor-session-wordpress-runtime-unavailable');
  });
});
