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
    <input id="easymde-enabled-field" value="1">
    <input id="easymde-markdown-theme-field" value="newsprint">
    <input id="easymde-code-theme-field" value="github">
    <input id="easymde-code-theme-explicit-field" value="0">
    <input id="easymde-custom-css-id-field" value="">
    <input id="easymde-custom-font-field" value="inter">
    <input id="easymde-windows-font-field" value="microsoft-yahei">
    <input id="easymde-apple-font-field" value="pingfang-sc">
    <input id="easymde-serif-font-field" value="noto-serif-sc">
    <textarea id="easymde-source"># Saved Markdown</textarea>
    <textarea id="content">&lt;h1&gt;Saved HTML&lt;/h1&gt;</textarea>
    <div id="post-lock-dialog"></div>
  `;
  document.body.append(form);
  const nonceMiddleware = { nonce: 'initial-rest-nonce' };
  const port = createWordPressEditorSessionPort({
    apiFetch: { nonceMiddleware },
    autosaveFields: {
      appleFont: form.querySelector('#easymde-apple-font-field') as HTMLInputElement,
      codeTheme: form.querySelector('#easymde-code-theme-field') as HTMLInputElement,
      codeThemeExplicit: form.querySelector('#easymde-code-theme-explicit-field') as HTMLInputElement,
      content: form.querySelector('#content') as HTMLTextAreaElement,
      customCssId: form.querySelector('#easymde-custom-css-id-field') as HTMLInputElement,
      customFont: form.querySelector('#easymde-custom-font-field') as HTMLInputElement,
      enabled: form.querySelector('#easymde-enabled-field') as HTMLInputElement,
      markdown: form.querySelector('#easymde-source') as HTMLTextAreaElement,
      markdownTheme: form.querySelector('#easymde-markdown-theme-field') as HTMLInputElement,
      serifFont: form.querySelector('#easymde-serif-font-field') as HTMLInputElement,
      windowsFont: form.querySelector('#easymde-windows-font-field') as HTMLInputElement
    },
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

  it('bridges real Markdown edits into WordPress autosave without writing on mount or inventing a save request', () => {
    const { emit, form, port } = fixture();
    const markdown = form.querySelector<HTMLTextAreaElement>('#easymde-source');
    const content = form.querySelector<HTMLTextAreaElement>('#content');
    const unsubscribe = port.subscribe(vi.fn());

    expect(content?.value).toBe('<h1>Saved HTML</h1>');

    emit('heartbeat.send', {});
    expect(content?.value).toBe('<h1>Saved HTML</h1>');

    if (!markdown || !content) throw new Error('autosave-test-fields-unavailable');
    markdown.value = '# Unsaved Markdown';
    markdown.dispatchEvent(new Event('input', { bubbles: true }));

    expect(content.value).toBe('# Unsaved Markdown');

    const heartbeat: Record<string, unknown> = {
      wp_autosave: {
        content: content.value,
        post_id: '7'
      }
    };
    emit('heartbeat.send', heartbeat);

    expect(heartbeat.wp_autosave).toEqual({
      content: '# Unsaved Markdown',
      post_id: '7',
      _easymde_enabled: '1',
      _easymde_markdown: '# Unsaved Markdown',
      _easymde_markdown_theme: 'newsprint',
      _easymde_code_theme: 'github',
      _easymde_code_theme_explicit: '0',
      _easymde_custom_css_id: '',
      _easymde_custom_font: 'inter',
      _easymde_windows_font: 'microsoft-yahei',
      _easymde_apple_font: 'pingfang-sc',
      _easymde_serif_font: 'noto-serif-sc'
    });

    unsubscribe();
    markdown.value = '# Later edit';
    markdown.dispatchEvent(new Event('input', { bubbles: true }));
    expect(content.value).toBe('# Unsaved Markdown');
  });

  it('prepares pending editor changes before serializing WordPress autosave metadata', () => {
    const { emit, form, port } = fixture();
    const markdown = form.querySelector<HTMLTextAreaElement>('#easymde-source');
    const content = form.querySelector<HTMLTextAreaElement>('#content');
    if (!markdown || !content) throw new Error('autosave-test-fields-unavailable');
    const unsubscribeStatus = port.subscribe(vi.fn());
    const prepare = vi.fn(() => {
      markdown.value = '# Latest visual Markdown';
      return 'continue' as const;
    });
    const unsubscribeAutosave = port.subscribeBeforeAutosave(prepare);
    const heartbeat: Record<string, unknown> = {
      wp_autosave: {
        content: '# Stale Markdown',
        post_id: '7'
      }
    };

    emit('heartbeat.send', heartbeat);

    expect(prepare).toHaveBeenCalledOnce();
    expect(content.value).toBe('# Latest visual Markdown');
    expect(heartbeat.wp_autosave).toMatchObject({
      content: '# Latest visual Markdown',
      _easymde_markdown: '# Latest visual Markdown'
    });
    unsubscribeAutosave();
    unsubscribeStatus();
  });

  it('removes a stale autosave payload when the editor cannot prepare it', () => {
    const { emit, port } = fixture();
    const unsubscribe = port.subscribeBeforeAutosave(() => 'blocked');
    const heartbeat: Record<string, unknown> = {
      wp_autosave: {
        content: '# Stale Markdown',
        post_id: '7'
      }
    };

    emit('heartbeat.send', heartbeat);

    expect(heartbeat).toEqual({
      'wp-refresh-post-lock': { lock: '7:42', post_id: '7' }
    });
    unsubscribe();
  });

  it('does not prepare autosave for ordinary lock heartbeats', () => {
    const { emit, hooks, port } = fixture();
    const prepare = vi.fn(() => 'continue' as const);
    const unsubscribe = port.subscribeBeforeAutosave(prepare);

    emit('heartbeat.send', {});

    expect(prepare).not.toHaveBeenCalled();
    expect(hooks.addAction).toHaveBeenCalledTimes(5);
    unsubscribe();
    expect(hooks.removeAction).toHaveBeenCalledTimes(5);
  });

  it('removes stale autosave data and exposes preparation failures', () => {
    const { emit, port } = fixture();
    const unsubscribe = port.subscribeBeforeAutosave(() => {
      throw new Error('synthetic-autosave-preparation-failure');
    });
    const heartbeat: Record<string, unknown> = {
      wp_autosave: {
        content: '# Stale Markdown',
        post_id: '7'
      }
    };

    expect(() => emit('heartbeat.send', heartbeat)).toThrowError(
      'synthetic-autosave-preparation-failure'
    );
    expect(heartbeat).toEqual({});
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
      autosaveFields: {
        appleFont: document.createElement('input'),
        codeTheme: document.createElement('input'),
        codeThemeExplicit: document.createElement('input'),
        content: document.createElement('textarea'),
        customCssId: document.createElement('input'),
        customFont: document.createElement('input'),
        enabled: document.createElement('input'),
        markdown: document.createElement('textarea'),
        markdownTheme: document.createElement('input'),
        serifFont: document.createElement('input'),
        windowsFont: document.createElement('input')
      },
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
      autosaveFields: {
        appleFont: document.createElement('input'),
        codeTheme: document.createElement('input'),
        codeThemeExplicit: document.createElement('input'),
        content: document.createElement('textarea'),
        customCssId: document.createElement('input'),
        customFont: document.createElement('input'),
        enabled: document.createElement('input'),
        markdown: document.createElement('textarea'),
        markdownTheme: document.createElement('input'),
        serifFont: document.createElement('input'),
        windowsFont: document.createElement('input')
      },
      document,
      hooks: { addAction: vi.fn(), removeAction: vi.fn() },
      namespace: 'easymde/session-invalid'
    })).toThrowError('editor-session-wordpress-runtime-unavailable');
  });
});
