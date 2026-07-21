// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { createAdminEditorScrollSyncBridge } from './admin-editor-scroll-sync';

describe('createAdminEditorScrollSyncBridge', () => {
  it('preflights one normal-editor binding before activation', () => {
    const source = document.createElement('div');
    const preview = document.createElement('div');
    const bridge = createAdminEditorScrollSyncBridge(window);
    const prepared = bridge.prepareBinding({ preview, source });

    prepared.activate();
    prepared.dispose();
    prepared.dispose();
  });

  it('rejects invalid handoff options before activation', () => {
    const bridge = createAdminEditorScrollSyncBridge(window);

    expect(() => bridge.prepareBinding(null)).toThrow('scroll-sync-binding-options-invalid');
    expect(() => bridge.prepareBinding({
      preview: document.createElement('div'),
      source: null
    })).toThrow('scroll-sync-binding-options-invalid');
  });
});
