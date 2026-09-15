import { act, render, waitFor } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';
import type { ImmersiveI18nPort } from '../../../contracts/ports/immersive-i18n-port';
import type { ImmersivePreferencesPort } from '../../../contracts/ports/immersive-preferences-port';
import type { GeneralSettings } from '../../../contracts/settings-center-settings';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import { describe, expect, it, vi } from 'vitest';

import {
  ImmersiveEditor,
  useImmersiveDocumentDerivations
} from './ImmersiveEditor';
import type { ImmersiveStrings } from './immersive-editor-ui-types';

function DerivationProbe({ markdown }: Readonly<{ markdown: string }>) {
  const { outline, stats } = useImmersiveDocumentDerivations(markdown);
  return (
    <div>
      <output data-testid="canonical">{markdown}</output>
      <output data-testid="characters">{stats.characters}</output>
      <output data-testid="headings">{outline.length}</output>
    </div>
  );
}

function createImmersiveEditorFixture(initial: string) {
  let documentSnapshot = { savedValue: initial, value: initial };
  let documentListener: (() => void) | null = null;
  const getValue = vi.fn(() => initial);
  const documentSubscribe = vi.fn((listener: () => void) => {
    documentListener = listener;
    return () => {
      if (documentListener === listener) documentListener = null;
    };
  });
  const documentSession = {
    document: {
      applyTextChange: vi.fn(),
      canRedo: () => false,
      canUndo: () => false,
      destroy: vi.fn(),
      flush: vi.fn(),
      focus: vi.fn(),
      getCursorPosition: () => ({ column: 0, line: 1 }),
      getInputElement: () => document.createElement('textarea'),
      getScrollElement: () => document.createElement('div'),
      getSelection: () => ({ direction: 'none', end: 0, start: 0 }),
      getSnapshot: vi.fn(() => documentSnapshot),
      getValue,
      replaceSavedValue: vi.fn(),
      redo: () => false,
      revealPosition: vi.fn(),
      subscribe: documentSubscribe,
      subscribeSelection: () => () => {},
      setVisualEditingActive: vi.fn(),
      syncFromSubmissionField: vi.fn(),
      undo: () => false
    },
    destroy: vi.fn(),
    getSnapshot: () => ({ dirty: false }),
    registerSubmissionState: vi.fn(),
    reconcileSavedBaseline: vi.fn(),
    replaceSubmissionState: vi.fn(),
    subscribe: () => () => {},
    title: {
      destroy: vi.fn(),
      getSnapshot: () => ({ savedValue: '', value: '' }),
      replaceSavedValue: vi.fn(),
      setValue: vi.fn(),
      subscribe: () => () => {}
    }
  } as unknown as EditorDocumentSession;

  const cleanup = () => {};
  const environment = {
    activeElement: () => null,
    activateFavicon: () => cleanup,
    activateFocusBoundary: () => cleanup,
    hasOpenToolbarPopover: () => false,
    now: () => 0,
    observePreviewLayout: () => cleanup,
    schedule: () => cleanup,
    subscribeKeydown: () => cleanup,
    subscribeResize: () => cleanup
  } as unknown as ImmersiveEnvironmentPort;
  const i18n = {
    characters: (count: number) => `characters:${count}`,
    readingTime: (minutes: number) => `reading:${minutes}`,
    revisions: (count: number) => `revisions:${count}`,
    words: (count: number) => `words:${count}`
  } satisfies ImmersiveI18nPort;
  const immersivePreferencesPort = {
    read: () => ({ status: 'missing' as const }),
    write: () => ({ status: 'saved' as const })
  } satisfies ImmersivePreferencesPort;
  const generalSettings = {
    applyEditorThemeToFrontend: false,
    autoSave: false,
    autoSaveInterval: '60',
    editingMode: 'immersive',
    interfaceLanguage: 'en_US',
    openPreviewAfterPublish: false,
    publishVisibility: 'public',
    showLineNumbers: false,
    showPublishedCodeCopyButton: false,
    statusBarMode: 'compact',
    summaryMode: 'manual',
    syncScroll: true
  } satisfies GeneralSettings;
  const strings = new Proxy(
    {},
    { get: (_target, property) => String(property) }
  ) as unknown as ImmersiveStrings;
  const publishSnapshot = {
    availableFields: {
      categories: false,
      excerpt: false,
      featuredImage: false,
      sticky: false,
      tags: false,
      visibility: false
    },
    categories: [],
    categoryIds: [],
    excerpt: '',
    existing: false,
    featuredImage: null,
    openPreview: false,
    password: '',
    sticky: false,
    tags: [],
    visibility: 'public'
  } as const;

  return {
    documentSession,
    documentSubscribe,
    emitDocument(value: string) {
      documentSnapshot = { savedValue: initial, value };
      documentListener?.();
    },
    environment,
    getValue,
    generalSettings,
    i18n,
    immersivePreferencesPort,
    props: {
      direction: 'ltr' as const,
      documentSession,
      environment,
      generalSettings,
      i18n,
      immersivePreferencesPort,
      initialPreferences: { outline: true },
      mode: 'source' as const,
      onBeforeSourceMutation: () => true,
      onConfirmPublish: () => true,
      onCopyWechat: async () => true,
      onExit: () => {},
      onFailure: () => {},
      onSelectFeaturedImage: async () => null,
      onViewModeChange: () => {},
      readPublishSnapshot: () => publishSnapshot,
      restoreRevision: () => {},
      revisionPort: null,
      strings,
      styleControls: null,
      toolbar: null
    }
  };
}

describe('ImmersiveEditor document derivations', () => {
  it('keeps the canonical value immediate while deferred stats and outline settle', async () => {
    const initial = '# Initial\n\nshort';
    const next = `${Array.from(
      { length: 1200 },
      (_, index) => `## Section ${index}\n\nbody ${index}`
    ).join('\n\n')}\n\nend`;
    const view = render(<DerivationProbe markdown={initial} />);

    expect(view.getByTestId('canonical').textContent).toBe(initial);
    expect(view.getByTestId('characters').textContent).toBe('12');
    expect(view.getByTestId('headings').textContent).toBe('1');

    view.rerender(<DerivationProbe markdown={next} />);

    expect(view.getByTestId('canonical').textContent).toBe(next);
    await waitFor(() => {
      expect(view.getByTestId('characters').textContent).toBe(
        String(next.replace(/[#*_~`>|()[\]]/g, '').replace(/\s/gu, '').length)
      );
      expect(view.getByTestId('headings').textContent).toBe('1200');
    });
  });

  it('settles on the final derivation after rapid consecutive edits', async () => {
    const first = '# First\n\nbody';
    const second = '# Second\n\n## Intermediate\n\nbody';
    const final = '# Final\n\n## Stable\n\n## More\n\nbody';
    const view = render(<DerivationProbe markdown={first} />);

    view.rerender(<DerivationProbe markdown={second} />);
    view.rerender(<DerivationProbe markdown={final} />);

    expect(view.getByTestId('canonical').textContent).toBe(final);
    await waitFor(() => {
      expect(view.getByTestId('headings').textContent).toBe('3');
      expect(view.getByTestId('characters').textContent).toBe('19');
    });
  });

  it('uses the document snapshot for subscription updates without re-reading the document', async () => {
    const fixture = createImmersiveEditorFixture('# Initial\n\nshort');
    const view = render(<ImmersiveEditor {...fixture.props} />);

    expect(fixture.documentSubscribe).toHaveBeenCalledOnce();
    expect(fixture.getValue).toHaveBeenCalledOnce();
    expect(view.getByText('characters:12')).toBeTruthy();

    fixture.getValue.mockImplementation(() => {
      throw new Error('immersive-document-subscription-used-getValue');
    });

    act(() => {
      fixture.emitDocument('# Snapshot\n\nupdated body');
    });

    await waitFor(() => {
      expect(view.getByText('characters:19')).toBeTruthy();
    });
    expect(fixture.getValue).toHaveBeenCalledOnce();
  });
});
