import { createElement } from '@wordpress/element';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { editorLayoutBootstrapFixture } from '../../../test/editor-layout-bootstrap-fixture';
import type { DocumentSelection } from '../../document-source/adapters/code-mirror-document-session';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import { EditorWorkspace } from './EditorWorkspace';

function sessionFixture() {
  let markdown = '# First\n\n## Second';
  let selection: DocumentSelection = { direction: 'none', end: 0, start: 0 };
  let dirty = false;
  const documentListeners = new Set<() => void>();
  const selectionListeners = new Set<() => void>();
  const dirtyListeners = new Set<() => void>();
  const revealPosition = vi.fn((position: number) => {
    selection = { direction: 'none', end: position, start: position };
    for (const listener of selectionListeners) listener();
  });
  const destroy = vi.fn();
  const editorSession = {
    destroy,
    document: {
      applyTextChange: vi.fn(),
      destroy,
      flush: vi.fn(),
      focus: vi.fn(),
      getCursorPosition: () => {
        const offset = 'backward' === selection.direction ? selection.start : selection.end;
        const preceding = markdown.slice(0, offset).split('\n');
        return { column: (preceding.at(-1)?.length ?? 0) + 1, line: preceding.length };
      },
      getInputElement: vi.fn(() => document.createElement('div')),
      getScrollElement: vi.fn(() => document.createElement('div')),
      getSelection: () => selection,
      getSnapshot: () => ({ savedValue: '# First', value: markdown }),
      getValue: () => markdown,
      replaceSavedValue: vi.fn(),
      revealPosition,
      subscribe: (listener: () => void) => {
        documentListeners.add(listener);
        return () => documentListeners.delete(listener);
      },
      subscribeSelection: (listener: () => void) => {
        selectionListeners.add(listener);
        return () => selectionListeners.delete(listener);
      },
      syncFromSubmissionField: vi.fn()
    },
    getSnapshot: () => ({ dirty }),
    registerSubmissionState: vi.fn(),
    reconcileSavedBaseline: vi.fn(),
    replaceSubmissionState: vi.fn(),
    subscribe: (listener: () => void) => {
      dirtyListeners.add(listener);
      return () => dirtyListeners.delete(listener);
    },
    title: {
      destroy,
      getSnapshot: () => ({ savedValue: 'Title', value: 'Title' }),
      replaceSavedValue: vi.fn(),
      subscribe: vi.fn(() => () => {})
    }
  } satisfies EditorDocumentSession;

  return {
    documentListeners,
    dirtyListeners,
    editorSession,
    revealPosition,
    selectionListeners,
    update(next: Readonly<{
      dirty?: boolean;
      markdown?: string;
      offset?: number;
      selection?: DocumentSelection;
    }>) {
      if (undefined !== next.dirty) dirty = next.dirty;
      if (undefined !== next.markdown) markdown = next.markdown;
      if (undefined !== next.offset) {
        selection = { direction: 'none', end: next.offset, start: next.offset };
      }
      if (undefined !== next.selection) selection = next.selection;
      for (const listener of documentListeners) listener();
      for (const listener of selectionListeners) listener();
      for (const listener of dirtyListeners) listener();
    }
  };
}

describe('EditorWorkspace', () => {
  it('owns outline navigation, statistics, cursor and dirty status', () => {
    const current = sessionFixture();
    const view = render(
      <EditorWorkspace
        direction="ltr"
        documentSession={current.editorSession}
        locale="en_US"
        source={<section>Source surface</section>}
        preview={<section>Preview surface</section>}
        strings={editorLayoutBootstrapFixture.strings}
      />
    );

    expect(view.getByRole('navigation', { name: 'Outline' })).not.toBeNull();
    expect(view.container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(view.container.querySelector('[aria-live="polite"]')?.textContent).toContain('Saved');
    fireEvent.click(view.getByRole('button', { name: 'Second' }));
    expect(current.revealPosition).toHaveBeenCalledWith(9);
    expect(view.getByText('Line 3, Column 1')).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'Writing statistics' }));
    expect(view.getByRole('region', { name: 'Writing statistics' })).not.toBeNull();
    expect(view.getByText('Reading time uses 300 reading units per minute.')).not.toBeNull();

    act(() => current.update({ dirty: true, markdown: '# Changed', offset: 3 }));
    expect(view.getByText('Unsaved')).not.toBeNull();
    expect(view.getByText('Line 1, Column 4')).not.toBeNull();

    view.unmount();
    expect(current.documentListeners).toHaveLength(0);
    expect(current.selectionListeners).toHaveLength(0);
    expect(current.dirtyListeners).toHaveLength(0);
  });

  it('switches view ownership without unmounting surfaces and resizes split panes by keyboard', () => {
    const current = sessionFixture();
    const view = render(
      <EditorWorkspace
        direction="ltr"
        documentSession={current.editorSession}
        locale="en_US"
        source={<section>Source surface</section>}
        preview={<section>Preview surface</section>}
        strings={editorLayoutBootstrapFixture.strings}
      />
    );
    const sourceSlot = view.getByText('Source surface').parentElement;
    const previewSlot = view.getByText('Preview surface').parentElement;
    const divider = view.getByRole('separator', { name: 'Resize source and preview' });

    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider.getAttribute('aria-valuenow')).toBe('52');
    fireEvent.keyDown(divider, { key: 'End' });
    expect(divider.getAttribute('aria-valuenow')).toBe('70');

    fireEvent.click(view.getByRole('button', { name: 'Preview' }));
    expect(sourceSlot?.hidden).toBe(true);
    expect(previewSlot?.hidden).toBe(false);
    expect(divider.hidden).toBe(true);
    expect(view.getByText('Source surface')).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'Second' }));
    expect(sourceSlot?.hidden).toBe(false);
    expect(previewSlot?.hidden).toBe(true);
    expect(current.revealPosition).toHaveBeenCalledWith(9);

    fireEvent.click(view.getByRole('button', { name: 'Edit' }));
    expect(sourceSlot?.hidden).toBe(false);
    expect(previewSlot?.hidden).toBe(true);
  });

  it('renders a truthful empty outline and returns focus when closing it', () => {
    const current = sessionFixture();
    current.update({ markdown: 'Plain text' });
    const view = render(
      <EditorWorkspace
        direction="ltr"
        documentSession={current.editorSession}
        locale="en_US"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
        strings={editorLayoutBootstrapFixture.strings}
      />
    );

    expect(view.getByText('No headings yet')).not.toBeNull();
    const outlineToggle = view.getByRole('button', { name: 'Outline' });
    const closeOutline = view.getByRole('button', { name: 'Close outline' });
    closeOutline.focus();
    fireEvent.click(closeOutline);
    expect(view.queryByText('No headings yet')).toBeNull();
    expect(document.activeElement).toBe(outlineToggle);
    fireEvent.click(outlineToggle);
    expect(view.getByText('No headings yet')).not.toBeNull();
  });

  it('reports the active caret endpoint for forward and backward selections', () => {
    const current = sessionFixture();
    const view = render(
      <EditorWorkspace
        direction="ltr"
        documentSession={current.editorSession}
        locale="en_US"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
        strings={editorLayoutBootstrapFixture.strings}
      />
    );

    act(() => current.update({
      markdown: 'abc\ndef',
      selection: { direction: 'forward', end: 5, start: 0 }
    }));
    expect(view.getByText('Line 2, Column 2')).not.toBeNull();

    act(() => current.update({
      selection: { direction: 'backward', end: 5, start: 0 }
    }));
    expect(view.getByText('Line 1, Column 1')).not.toBeNull();
  });

  it('uses the WordPress locale and mirrors divider keyboard semantics in RTL', () => {
    const current = sessionFixture();
    current.update({ markdown: 'word '.repeat(1000) });
    const view = render(
      <EditorWorkspace
        direction="rtl"
        documentSession={current.editorSession}
        locale="de_DE"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
        strings={editorLayoutBootstrapFixture.strings}
      />
    );
    const owner = view.container.querySelector('[data-easymde-layout-owner="react"]');
    const divider = view.getByRole('separator', { name: 'Resize source and preview' });

    expect(owner?.getAttribute('dir')).toBe('rtl');
    expect(view.getByRole('button', { name: 'Writing statistics' }).textContent)
      .toContain('Western words 1.000');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider.getAttribute('aria-valuenow')).toBe('52');
  });

  it('uses a complete reorderable cursor translation contract', () => {
    const current = sessionFixture();
    current.update({ markdown: 'abc\ndef', offset: 5 });
    const view = render(
      <EditorWorkspace
        direction="ltr"
        documentSession={current.editorSession}
        locale="en_US"
        source={<section>Source</section>}
        preview={<section>Preview</section>}
        strings={{
          ...editorLayoutBootstrapFixture.strings,
          cursorPosition: '100%% · Column %2$s / Line %1$s'
        }}
      />
    );

    expect(view.getByText('100% · Column 2 / Line 2')).not.toBeNull();
  });

  it('coalesces document insights and bounds rendered outline entries', () => {
    vi.useFakeTimers();
    try {
      const current = sessionFixture();
      const view = render(
        <EditorWorkspace
          direction="ltr"
          documentSession={current.editorSession}
          locale="en_US"
          source={<section>Source</section>}
          preview={<section>Preview</section>}
          strings={editorLayoutBootstrapFixture.strings}
        />
      );
      const markdown = Array.from({ length: 250 }, (_, index) => `## Heading ${index + 1}`)
        .join('\n');

      act(() => current.update({ markdown }));
      expect(view.queryByRole('button', { name: 'Heading 250' })).toBeNull();

      act(() => vi.advanceTimersByTime(149));
      expect(view.queryByRole('button', { name: 'Show more headings' })).toBeNull();

      act(() => vi.advanceTimersByTime(1));
      expect(view.getByRole('button', { name: 'Show more headings' })).not.toBeNull();
      expect(view.queryByRole('button', { name: 'Heading 250' })).toBeNull();

      fireEvent.click(view.getByRole('button', { name: 'Show more headings' }));
      expect(view.getByRole('button', { name: 'Heading 250' })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
