import { act, render, waitFor } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';
import type { ImmersiveI18nPort } from '../../../contracts/ports/immersive-i18n-port';
import type { ImmersivePreferencesPort } from '../../../contracts/ports/immersive-preferences-port';
import type { GeneralSettings } from '../../../contracts/settings-center-settings';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ImmersiveEditor,
  useImmersiveDocumentDerivations
} from './ImmersiveEditor';
import type { ImmersiveStrings } from './immersive-editor-ui-types';

const scheduleDerivation = (callback: () => void, delay: number) => {
  const timer = window.setTimeout(callback, delay);
  return () => window.clearTimeout(timer);
};

function DerivationProbe({
  markdown,
  schedule = scheduleDerivation
}: Readonly<{
  markdown: string;
  schedule?: (callback: () => void, delay: number) => () => void;
}>) {
  const { outline, stats } = useImmersiveDocumentDerivations(
    markdown,
    schedule
  );
  return (
    <div>
      <output data-testid="canonical">{markdown}</output>
      <output data-testid="characters">{stats.characters}</output>
      <output data-testid="headings">{outline.length}</output>
      <output data-testid="outline">
        {outline.map((item) => item.text).join('|')}
      </output>
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
  const revealPosition = vi.fn();
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
      revealPosition,
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
    schedule: scheduleDerivation,
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
    revealPosition,
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
  afterEach(() => {
    vi.useRealTimers();
  });

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
    await waitFor(
      () => {
        expect(view.getByTestId('characters').textContent).toBe(
          String(next.replace(/[#*_~`>|()[\]]/g, '').replace(/\s/gu, '').length)
        );
        expect(view.getByTestId('headings').textContent).toBe('1200');
      },
      { timeout: 3_000 }
    );
  });

  it('schedules the initial derivation for a long document after mount', () => {
    const scheduled: Array<{
      callback: () => void;
      cancelled: boolean;
      delay: number;
    }> = [];
    const schedule = (callback: () => void, delay: number) => {
      const entry = { callback, cancelled: false, delay };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    };
    const markdown = `# Heading\n${'long ordinary line '.repeat(2000)}`;
    const view = render(<DerivationProbe markdown={markdown} schedule={schedule} />);

    expect(markdown.length).toBeGreaterThan(16 * 1024);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delay).toBe(180);
    expect(view.getByTestId('characters').textContent).toBe('0');

    act(() => scheduled[0]?.callback());
    expect(scheduled[1]?.delay).toBe(0);
    view.unmount();
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

  it('debounces rapid edits and cancels an obsolete derivation', () => {
    vi.useFakeTimers();
    const first = '# First\n\nbody';
    const second = '# Second\n\n## Intermediate\n\nbody';
    const final = '# Final\n\n## Stable\n\n## More\n\nbody';
    const view = render(<DerivationProbe markdown={first} />);

    view.rerender(<DerivationProbe markdown={second} />);
    act(() => vi.advanceTimersByTime(179));
    expect(view.getByTestId('characters').textContent).toBe('9');
    expect(view.getByTestId('headings').textContent).toBe('1');

    view.rerender(<DerivationProbe markdown={final} />);
    act(() => vi.advanceTimersByTime(179));
    expect(view.getByTestId('characters').textContent).toBe('9');
    expect(view.getByTestId('headings').textContent).toBe('1');

    act(() => vi.advanceTimersByTime(1));
    expect(view.getByTestId('characters').textContent).toBe('19');
    expect(view.getByTestId('headings').textContent).toBe('3');
  });

  it('publishes a large outline in bounded frames within the debounce budget', () => {
    const scheduled: Array<{
      callback: () => void;
      cancelled: boolean;
      delay: number;
    }> = [];
    const schedule = (callback: () => void, delay: number) => {
      const entry = { callback, cancelled: false, delay };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    };
    const final = Array.from(
      { length: 346 },
      (_, index) => `# Section ${index}\n\nbody ${index}`
    ).join('\n\n');
    const view = render(
      <DerivationProbe markdown="# Initial\n\nshort" schedule={schedule} />
    );

    view.rerender(<DerivationProbe markdown={final} schedule={schedule} />);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delay).toBe(180);

    act(() => scheduled[0]?.callback());
    let scanFrames = 0;
    while ('1' === view.getByTestId('headings').textContent) {
      const frame = scheduled.at(-1);
      if (!frame) throw new Error('immersive-derivation-frame-missing');
      expect(frame.delay).toBe(0);
      act(() => frame.callback());
      scanFrames += 1;
      if (scanFrames > 16) {
        throw new Error('immersive-derivation-frame-budget-exceeded');
      }
    }
    expect(view.getByTestId('headings').textContent).toBe('16');
    expect(view.getByTestId('characters').textContent).toBe(
      String(final.replace(/[#*_~`>|()[\]]/g, '').replace(/\s/gu, '').length)
    );

    for (let expected = 32; expected < 346; expected += 16) {
      const frame = scheduled.at(-1);
      if (!frame) throw new Error('immersive-outline-frame-missing');
      expect(frame.delay).toBe(4);
      act(() => frame.callback());
      expect(view.getByTestId('headings').textContent).toBe(String(expected));
    }

    const finalFrame = scheduled.at(-1);
    if (!finalFrame) throw new Error('immersive-outline-final-frame-missing');
    expect(finalFrame.delay).toBe(4);
    act(() => finalFrame.callback());
    expect(view.getByTestId('headings').textContent).toBe('346');
    expect(
      scheduled.reduce((total, entry) => total + entry.delay, 0)
    ).toBeLessThanOrEqual(300);
  });

  it('rejects a forced stale progressive frame after a newer derivation', () => {
    const scheduled: Array<{
      callback: () => void;
      cancelled: boolean;
      delay: number;
    }> = [];
    const schedule = (callback: () => void, delay: number) => {
      const entry = { callback, cancelled: false, delay };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    };
    const large = Array.from(
      { length: 130 },
      (_, index) => `# Old ${index}`
    ).join('\n');
    const view = render(
      <DerivationProbe markdown="# Initial" schedule={schedule} />
    );

    view.rerender(<DerivationProbe markdown={large} schedule={schedule} />);
    act(() => scheduled[0]?.callback());
    expect(view.getByTestId('headings').textContent).toBe('16');
    const staleFrame = scheduled[1];
    if (!staleFrame) throw new Error('immersive-outline-stale-frame-missing');

    view.rerender(
      <DerivationProbe markdown="# Replacement" schedule={schedule} />
    );
    expect(staleFrame.cancelled).toBe(true);
    act(() => staleFrame.callback());
    expect(view.getByTestId('headings').textContent).toBe('16');
    expect(view.getByTestId('outline').textContent).not.toContain('Old 16');
  });

  it('does not publish a forced progressive frame after unmount', () => {
    const scheduled: Array<{
      callback: () => void;
      cancelled: boolean;
      delay: number;
    }> = [];
    const schedule = (callback: () => void, delay: number) => {
      const entry = { callback, cancelled: false, delay };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    };
    const large = Array.from(
      { length: 130 },
      (_, index) => `# Heading ${index}`
    ).join('\n');
    const view = render(
      <DerivationProbe markdown="# Initial" schedule={schedule} />
    );

    view.rerender(<DerivationProbe markdown={large} schedule={schedule} />);
    act(() => scheduled[0]?.callback());
    const frame = scheduled[1];
    if (!frame) throw new Error('immersive-outline-unmount-frame-missing');
    view.unmount();

    expect(frame.cancelled).toBe(true);
    expect(() => act(() => frame.callback())).not.toThrow();
  });

  it('keeps final statistics and outline accurate while excluding fenced lines', () => {
    vi.useFakeTimers();
    const initial = '# Initial\n\nshort';
    const final = [
      'visible words',
      '```markdown',
      '# Hidden heading',
      'hidden words',
      '```',
      '~~~text',
      '## Also hidden',
      '~~~',
      '## Visible heading'
    ].join('\n');
    const view = render(<DerivationProbe markdown={initial} />);

    view.rerender(<DerivationProbe markdown={final} />);
    act(() => vi.advanceTimersByTime(180));

    expect(view.getByTestId('characters').textContent).toBe('26');
    expect(view.getByTestId('headings').textContent).toBe('1');
    expect(view.getByTestId('outline').textContent).toBe('Visible heading');
  });

  it('cancels a pending derivation on unmount', () => {
    vi.useFakeTimers();
    const view = render(<DerivationProbe markdown="# Initial\n\nshort" />);

    view.rerender(<DerivationProbe markdown="# Updated\n\nbody" />);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);

    expect(() => {
      act(() => vi.advanceTimersByTime(180));
    }).not.toThrow();
  });

  it('rejects a forced stale callback before publishing the final derivation', () => {
    const scheduled: Array<{
      callback: () => void;
      cancelled: boolean;
      delay: number;
    }> = [];
    const schedule = (callback: () => void, delay: number) => {
      const entry = { callback, cancelled: false, delay };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    };
    const view = render(
      <DerivationProbe markdown={'# Initial\n\nbody'} schedule={schedule} />
    );

    view.rerender(
      <DerivationProbe markdown={'# Stale\n\nbody'} schedule={schedule} />
    );
    view.rerender(
      <DerivationProbe
        markdown={'# Final\n\n## Stable\n\nbody'}
        schedule={schedule}
      />
    );

    expect(scheduled).toHaveLength(2);
    expect(scheduled[0]).toMatchObject({ cancelled: true, delay: 180 });
    expect(scheduled[1]).toMatchObject({ cancelled: false, delay: 180 });
    act(() => scheduled[0]?.callback());
    expect(view.getByTestId('outline').textContent).toBe('Initial');
    act(() => scheduled[1]?.callback());
    expect(view.getByTestId('outline').textContent).toBe('Final|Stable');

    view.rerender(
      <DerivationProbe markdown={'# Unmounted\n\nbody'} schedule={schedule} />
    );
    const late = scheduled.at(-1);
    view.unmount();
    expect(late?.cancelled).toBe(true);
    expect(() => act(() => late?.callback())).not.toThrow();
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

  it('reuses the visible outline while resolving its latest source position', () => {
    vi.useFakeTimers();
    const fixture = createImmersiveEditorFixture('# Heading\n\nbody');
    const view = render(<ImmersiveEditor {...fixture.props} />);
    const heading = view.getByRole('button', { name: 'Heading' });

    act(() => fixture.emitDocument('prefix\n\n# Heading\n\nbody'));
    act(() => vi.advanceTimersByTime(180));

    const currentHeading = view.getByRole('button', { name: 'Heading' });
    expect(currentHeading).toBe(heading);
    act(() => currentHeading.click());
    expect(fixture.revealPosition).toHaveBeenCalledWith(8);
  });
});
