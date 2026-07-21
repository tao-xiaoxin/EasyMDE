// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { createBrowserToolbarShortcuts } from './create-browser-toolbar-shortcuts';

const shortcuts = {
  bold: { mac: 'Cmd+B', win: 'Ctrl+B' },
  save: { mac: 'Cmd+S', win: 'Ctrl+S' }
};

describe('createBrowserToolbarShortcuts', () => {
  it('prepares without listening, then owns matching shortcuts inside the editor root', () => {
    const editorRoot = document.createElement('div');
    const source = document.createElement('textarea');
    const content = document.createElement('div');
    content.contentEditable = 'true';
    editorRoot.append(source, content);
    document.body.append(editorRoot);
    const execute = vi.fn();
    const binding = createBrowserToolbarShortcuts({
      commands: [{ id: 'bold' }, { id: 'save' }],
      editorRoot,
      eventTarget: document,
      platform: 'win',
      shortcuts,
      source
    }).prepareBinding(execute);

    content.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'b'
    }));
    expect(execute).not.toHaveBeenCalled();

    binding.activate();
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'b'
    });
    content.dispatchEvent(event);

    expect(execute).toHaveBeenCalledWith('bold');
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores composition, unrelated fields, outside targets, and unmatched shortcuts', () => {
    const editorRoot = document.createElement('div');
    const source = document.createElement('textarea');
    const title = document.createElement('input');
    const content = document.createElement('div');
    const outside = document.createElement('div');
    content.contentEditable = 'true';
    editorRoot.append(source, title, content);
    document.body.append(editorRoot, outside);
    const execute = vi.fn();
    const binding = createBrowserToolbarShortcuts({
      commands: [{ id: 'bold' }],
      editorRoot,
      eventTarget: document,
      platform: 'win',
      shortcuts,
      source
    }).prepareBinding(execute);
    binding.activate();

    title.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'b' }));
    outside.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'b' }));
    content.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      ctrlKey: true,
      isComposing: true,
      key: 'b'
    }));
    content.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'u' }));

    expect(execute).not.toHaveBeenCalled();
  });

  it('preserves native textarea handling and Mac modifier normalization', () => {
    const editorRoot = document.createElement('div');
    const source = document.createElement('textarea');
    editorRoot.append(source);
    document.body.append(editorRoot);
    const execute = vi.fn();
    const binding = createBrowserToolbarShortcuts({
      commands: [{ id: 'bold' }],
      editorRoot,
      eventTarget: document,
      platform: 'mac',
      shortcuts,
      source
    }).prepareBinding(execute);
    binding.activate();

    source.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'B',
      metaKey: true
    }));

    expect(execute).toHaveBeenCalledWith('bold');
  });

  it('removes its listener through idempotent disposal', () => {
    const editorRoot = document.createElement('div');
    const source = document.createElement('textarea');
    editorRoot.append(source);
    document.body.append(editorRoot);
    const execute = vi.fn();
    const binding = createBrowserToolbarShortcuts({
      commands: [{ id: 'save' }],
      editorRoot,
      eventTarget: document,
      platform: 'win',
      shortcuts,
      source
    }).prepareBinding(execute);
    binding.activate();
    binding.dispose();
    binding.dispose();

    source.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      ctrlKey: true,
      key: 's'
    }));

    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects invalid surfaces and duplicate activation before registering a second owner', () => {
    const editorRoot = document.createElement('div');
    const source = document.createElement('textarea');
    const shortcutOwner = createBrowserToolbarShortcuts({
      commands: [{ id: 'bold' }],
      editorRoot,
      eventTarget: document,
      platform: 'win',
      shortcuts,
      source
    });
    const binding = shortcutOwner.prepareBinding(vi.fn());

    binding.activate();
    expect(() => binding.activate()).toThrow('toolbar-shortcut-binding-already-activated');
    expect(() => createBrowserToolbarShortcuts({
      commands: [{ id: 'bold' }],
      editorRoot: null as never,
      eventTarget: document,
      platform: 'win',
      shortcuts,
      source
    })).toThrow('toolbar-shortcut-surfaces-invalid');
  });

  it('stays disposable when browser listener activation throws', () => {
    const editorRoot = document.createElement('div');
    const source = document.createElement('textarea');
    editorRoot.append(source);
    const removeEventListener = vi.fn();
    const binding = createBrowserToolbarShortcuts({
      commands: [{ id: 'bold' }],
      editorRoot,
      eventTarget: {
        addEventListener() {
          throw new Error('listener unavailable');
        },
        removeEventListener
      },
      platform: 'win',
      shortcuts,
      source
    }).prepareBinding(vi.fn());

    expect(() => binding.activate()).toThrow('listener unavailable');
    expect(() => binding.dispose()).not.toThrow();
    expect(removeEventListener).not.toHaveBeenCalled();
  });
});
