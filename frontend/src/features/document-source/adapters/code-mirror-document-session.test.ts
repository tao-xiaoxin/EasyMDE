import { undo } from '@codemirror/commands';
import { describe, expect, it, vi } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { language } from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';

import {
  createCodeMirrorDocumentSession,
  type DocumentSelection
} from './code-mirror-document-session';

function createFixture(value = 'alpha beta') {
  const container = document.createElement('div');
  const submissionField = document.createElement('textarea');
  submissionField.value = value;
  submissionField.setSelectionRange(6, 10, 'backward');
  document.body.append(container, submissionField);

  return { container, submissionField };
}

describe('createCodeMirrorDocumentSession', () => {
  it('hydrates the CodeMirror document and backward selection from the native bridge', () => {
    const { container, submissionField } = createFixture();
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });

    expect(session.getValue()).toBe('alpha beta');
    expect(session.getSelection()).toEqual({
      end: 10,
      start: 6,
      direction: 'backward'
    });
    expect(container.querySelector('.cm-editor')).not.toBeNull();
    expect(container.querySelector('.cm-gutters')).not.toBeNull();
    expect(container.querySelector('.cm-lineNumbers')).not.toBeNull();

    session.destroy();
  });

  it('only enables CodeMirror line wrapping when the saved setting allows it', () => {
    for (const [wordWrap, expected] of [[true, true], [false, false]] as const) {
      const { container, submissionField } = createFixture();
      const session = createCodeMirrorDocumentSession({
        container,
        label: 'Markdown source',
        submissionField,
        wordWrap
      });

      expect(container.querySelector('.cm-lineWrapping') !== null).toBe(expected);
      session.destroy();
      container.remove();
      submissionField.remove();
    }
  });

  it('parses Markdown syntax inside the existing CodeMirror owner', () => {
    const { container, submissionField } = createFixture(
      '# Heading\n\n> Quote with **strong** and `code`'
    );
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });

    const markedText = Array.from(
      container.querySelectorAll<HTMLElement>('.cm-line span')
    ).map((element) => element.textContent?.trim());

    expect(markedText).toContain('#');
    expect(markedText).toContain('Heading');
    expect(markedText).toContain('**');
    expect(markedText).toContain('`');

    session.destroy();
  });

  it('always installs Markdown syntax highlighting', () => {
    const { container, submissionField } = createFixture('# Heading');
    const options = {
      container,
      label: 'Markdown source',
      submissionField
    };
    const session = createCodeMirrorDocumentSession(options);

    expect(container.querySelector('.cm-line span')).not.toBeNull();

    session.destroy();
  });

  it('always continues Markdown list markers as an editor capability', () => {
    const { container, submissionField } = createFixture('- item');
    submissionField.setSelectionRange(6, 6);
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    session.getInputElement().dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }));
    expect(session.getValue()).toBe('- item\n- ');
    session.destroy();
    container.remove();
    submissionField.remove();
  });

  it('keeps heading markers regular and colors quote content as one block', () => {
    const { container, submissionField } = createFixture('# Title\n> Quote');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const heading = container.querySelector('.cm-line');
    const quote = container.querySelectorAll('.cm-line')[1];
    if (!heading || !quote) throw new Error('test-fixture-invalid');
    expect(heading.querySelector('span')?.textContent).toBe('#');
    expect(quote.querySelectorAll('span')).toHaveLength(3);
    session.destroy();
  });

  it('commits one document change to CodeMirror and emits one native input notification', () => {
    const { container, submissionField } = createFixture();
    const handleInput = vi.fn();
    submissionField.addEventListener('input', handleInput);
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });

    session.applyTextChange({
      selection: {
        end: 9,
        start: 2,
        direction: 'forward'
      },
      value: 'updated document'
    });

    expect(session.getValue()).toBe('updated document');
    expect(session.getSelection()).toEqual({
      end: 9,
      start: 2,
      direction: 'forward'
    });
    expect(submissionField.value).toBe('updated document');
    expect([
      submissionField.selectionStart,
      submissionField.selectionEnd,
      submissionField.selectionDirection
    ]).toEqual([2, 9, 'forward']);
    expect(handleInput).toHaveBeenCalledTimes(1);

    session.destroy();
  });

  it('uses a known local change without rescanning the current document', () => {
    const { container, submissionField } = createFixture('alpha beta');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const view = EditorView.findFromDOM(session.getInputElement());
    if (!view) throw new Error('test-editor-view-missing');
    const documentPrototype = Object.getPrototypeOf(view.state.doc) as {
      toString: () => string;
    };
    const toStringSpy = vi.spyOn(documentPrototype, 'toString');
    toStringSpy.mockClear();

    (session.applyTextChange as (change: {
      changes: Readonly<{ from: number; insert: string; to: number }>;
      selection: DocumentSelection;
      value: string;
    }) => void)({
      changes: { from: 6, insert: 'X ', to: 6 },
      selection: { direction: 'none', end: 8, start: 8 },
      value: 'alpha X beta'
    });

    expect(toStringSpy).toHaveBeenCalledTimes(1);
    expect(session.getValue()).toBe('alpha X beta');
    toStringSpy.mockRestore();
    session.destroy();
  });

  it('pauses Markdown parsing before freezing the detached CodeMirror view', () => {
    const { container, submissionField } = createFixture('# Heading');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const view = EditorView.findFromDOM(session.getInputElement());
    if (!view) throw new Error('test-editor-view-missing');
    const dispatch = vi.spyOn(view, 'dispatch');
    const input = vi.fn();
    submissionField.addEventListener('input', input);
    const selection = session.getSelection();
    session.applyTextChange({
      selection,
      value: '# Changed'
    });
    input.mockClear();
    dispatch.mockClear();

    (session as typeof session & {
      setVisualEditingActive: (active: boolean) => void;
    }).setVisualEditingActive(true);

    expect(view.state.facet(language)).toBeNull();
    expect(session.getValue()).toBe('# Changed');
    expect(session.getSelection()).toEqual(selection);
    expect(submissionField.value).toBe('# Changed');
    expect(input).not.toHaveBeenCalled();
    expect(session.canUndo()).toBe(true);
    expect(dispatch).toHaveBeenCalledOnce();

    (session as typeof session & {
      setVisualEditingActive: (active: boolean) => void;
    }).setVisualEditingActive(true);
    expect(dispatch).toHaveBeenCalledOnce();

    expect(session.undo()).toBe(true);
    expect(session.getValue()).toBe('# Heading');
    expect(dispatch).toHaveBeenCalledOnce();
    expect(input).toHaveBeenCalledOnce();
    input.mockClear();

    (session as typeof session & {
      setVisualEditingActive: (active: boolean) => void;
    }).setVisualEditingActive(false);
    expect(view.state.facet(language)).toBe(markdownLanguage);
    expect(input).not.toHaveBeenCalled();
    session.destroy();
  });

  it('publishes visual edits and history without dispatching the detached view', () => {
    vi.useFakeTimers();
    const { container, submissionField } = createFixture('Original');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const view = EditorView.findFromDOM(session.getInputElement());
    if (!view) throw new Error('test-editor-view-missing');
    const dispatch = vi.spyOn(view, 'dispatch');
    const setState = vi.spyOn(view, 'setState');
    const documentListener = vi.fn();
    const selectionListener = vi.fn();
    const input = vi.fn();
    session.subscribe(documentListener);
    session.subscribeSelection(selectionListener);
    submissionField.addEventListener('input', input);

    session.setVisualEditingActive(true);
    dispatch.mockClear();
    session.applyTextChange({
      changes: { from: 0, insert: 'Edited', to: 8 },
      deferNativeBridge: true,
      selection: { direction: 'none', end: 6, start: 6 },
      value: 'Edited'
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(session.getValue()).toBe('Edited');
    expect(session.getSnapshot().value).toBe('Edited');
    expect(session.getSelection()).toEqual({
      direction: 'none',
      end: 6,
      start: 6
    });
    expect(submissionField.value).toBe('Original');
    expect(documentListener).toHaveBeenCalledOnce();
    expect(selectionListener).toHaveBeenCalledOnce();
    expect(input).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(submissionField.value).toBe('Edited');
    expect(input).toHaveBeenCalledOnce();

    expect(session.undo()).toBe(true);
    expect(session.getValue()).toBe('Original');
    expect(session.redo()).toBe(true);
    expect(session.getValue()).toBe('Edited');
    expect(dispatch).not.toHaveBeenCalled();

    session.setVisualEditingActive(false);
    expect(setState).toHaveBeenCalledOnce();
    expect(view.state.doc.toString()).toBe('Edited');
    expect(view.dom.isConnected).toBe(true);

    session.destroy();
    vi.useRealTimers();
  });

  it('flushes the latest coalesced visual bridge before submission', () => {
    vi.useFakeTimers();
    const { container, submissionField } = createFixture('Original');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const input = vi.fn();
    submissionField.addEventListener('input', input);
    session.setVisualEditingActive(true);

    session.applyTextChange({
      changes: { from: 0, insert: 'First', to: 8 },
      deferNativeBridge: true,
      selection: { direction: 'none', end: 5, start: 5 },
      value: 'First'
    });
    session.applyTextChange({
      changes: { from: 0, insert: 'Final', to: 5 },
      deferNativeBridge: true,
      selection: { direction: 'none', end: 5, start: 5 },
      value: 'Final'
    });

    expect(submissionField.value).toBe('Original');
    expect(input).not.toHaveBeenCalled();
    session.flush();
    expect(submissionField.value).toBe('Final');
    expect(input).toHaveBeenCalledOnce();

    vi.runOnlyPendingTimers();
    expect(input).toHaveBeenCalledOnce();
    session.destroy();
    vi.useRealTimers();
  });

  it('cancels a deferred visual bridge when an external native value arrives', () => {
    vi.useFakeTimers();
    const { container, submissionField } = createFixture('Original');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    session.setVisualEditingActive(true);
    session.applyTextChange({
      changes: { from: 0, insert: 'Deferred', to: 8 },
      deferNativeBridge: true,
      selection: { direction: 'none', end: 8, start: 8 },
      value: 'Deferred'
    });

    submissionField.value = 'External';
    submissionField.setSelectionRange(3, 3, 'none');
    submissionField.dispatchEvent(new Event('input', { bubbles: true }));
    vi.runOnlyPendingTimers();

    expect(session.getValue()).toBe('External');
    expect(session.getSelection()).toEqual({
      direction: 'none',
      end: 3,
      start: 3
    });
    expect(submissionField.value).toBe('External');
    session.destroy();
    vi.useRealTimers();
  });

  it('flushes a deferred visual bridge once before destroying the session', () => {
    vi.useFakeTimers();
    const { container, submissionField } = createFixture('Original');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const input = vi.fn();
    submissionField.addEventListener('input', input);
    session.setVisualEditingActive(true);
    session.applyTextChange({
      changes: { from: 0, insert: 'Final', to: 8 },
      deferNativeBridge: true,
      selection: { direction: 'none', end: 5, start: 5 },
      value: 'Final'
    });

    session.destroy();
    expect(submissionField.value).toBe('Final');
    expect(input).toHaveBeenCalledOnce();
    vi.runOnlyPendingTimers();
    expect(input).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('moves the hidden CodeMirror view DOM into a DocumentFragment during visual editing', () => {
    const { container, submissionField } = createFixture('# Heading');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const view = EditorView.findFromDOM(session.getInputElement());
    if (!view) throw new Error('test-editor-view-missing');

    session.setVisualEditingActive(true);

    expect(view.dom.isConnected).toBe(false);
    expect(view.dom.parentNode).toBeInstanceOf(DocumentFragment);
    expect(container.querySelector('.cm-editor')).toBeNull();
    expect(view.state.facet(language)).toBeNull();

    session.applyTextChange({
      selection: { direction: 'none', end: 9, start: 9 },
      value: '# Changed'
    });
    expect(session.getValue()).toBe('# Changed');
    expect(submissionField.value).toBe('# Changed');

    session.destroy();
  });

  it('restores the CodeMirror view at its original parent and next sibling exactly once', () => {
    const { container, submissionField } = createFixture('# Heading');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const view = EditorView.findFromDOM(session.getInputElement());
    if (!view) throw new Error('test-editor-view-missing');
    const nextSibling = document.createElement('span');
    container.append(nextSibling);
    const dispatch = vi.spyOn(view, 'dispatch');
    const setState = vi.spyOn(view, 'setState');
    dispatch.mockClear();

    session.setVisualEditingActive(true);
    session.setVisualEditingActive(true);
    expect(dispatch).toHaveBeenCalledOnce();

    session.setVisualEditingActive(false);

    expect(view.dom.parentNode).toBe(container);
    expect(view.dom.nextSibling).toBe(nextSibling);
    expect(view.state.facet(language)).toBe(markdownLanguage);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(setState).toHaveBeenCalledOnce();

    session.setVisualEditingActive(false);
    expect(dispatch).toHaveBeenCalledOnce();

    session.destroy();
  });

  it('cleans up a temporarily detached CodeMirror view on destroy', () => {
    const { container, submissionField } = createFixture('# Heading');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const view = EditorView.findFromDOM(session.getInputElement());
    if (!view) throw new Error('test-editor-view-missing');

    session.setVisualEditingActive(true);
    session.destroy();
    session.destroy();

    expect(view.dom.isConnected).toBe(false);
    expect(container.querySelector('.cm-editor')).toBeNull();
    expect(() => session.setVisualEditingActive(false)).not.toThrow();
  });

  it.each([
    {
      current: 'alpha beta',
      next: 'Xalpha beta',
      changes: { from: 0, insert: 'X', to: 0 },
      selection: { direction: 'none' as const, end: 1, start: 1 }
    },
    {
      current: 'alpha beta',
      next: 'alpha BIG beta',
      changes: { from: 6, insert: 'BIG ', to: 6 },
      selection: { direction: 'none' as const, end: 9, start: 9 }
    },
    {
      current: 'alpha beta',
      next: 'alpha beta!',
      changes: { from: 10, insert: '!', to: 10 },
      selection: { direction: 'none' as const, end: 11, start: 11 }
    },
    {
      current: 'alpha beta',
      next: 'beta',
      changes: { from: 0, insert: '', to: 6 },
      selection: { direction: 'none' as const, end: 4, start: 4 }
    },
    {
      current: 'alpha beta',
      next: 'alphabeta',
      changes: { from: 5, insert: '', to: 6 },
      selection: { direction: 'none' as const, end: 9, start: 9 }
    },
    {
      current: 'alpha beta',
      next: 'alpha',
      changes: { from: 5, insert: '', to: 10 },
      selection: { direction: 'none' as const, end: 5, start: 5 }
    },
    {
      current: 'A😀B',
      next: 'A😃B',
      changes: { from: 2, insert: '\ude03', to: 3 },
      selection: { direction: 'none' as const, end: 3, start: 3 }
    },
    {
      current: 'one\ntwo\nthree',
      nativeValue: 'one\r\ntwo\r\nthree',
      next: 'one\nTWO\nthree',
      changes: { from: 4, insert: 'TWO', to: 7 },
      selection: { direction: 'none' as const, end: 8, start: 8 }
    }
  ])(
    'dispatches only the changed UTF-16 range for $current -> $next',
    ({ changes, current, nativeValue, next, selection }) => {
      const { container, submissionField } = createFixture(nativeValue ?? current);
      const session = createCodeMirrorDocumentSession({
        container,
        label: 'Markdown source',
        submissionField
      });
      const view = EditorView.findFromDOM(session.getInputElement());
      if (!view) throw new Error('test-editor-view-missing');
      const dispatch = vi.spyOn(view, 'dispatch');

      session.applyTextChange({ selection, value: next });

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ changes })
      );
      expect(session.getValue()).toBe(next);
      expect(session.getSelection()).toEqual(selection);
      session.destroy();
    }
  );

  it('does not dispatch a document change when applyTextChange receives the same value', () => {
    const { container, submissionField } = createFixture('same value');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const view = EditorView.findFromDOM(session.getInputElement());
    if (!view) throw new Error('test-editor-view-missing');
    const dispatch = vi.spyOn(view, 'dispatch');

    session.applyTextChange({
      selection: { direction: 'none', end: 4, start: 4 },
      value: 'same value'
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.not.objectContaining({ changes: expect.anything() })
    );
    expect(session.getValue()).toBe('same value');
    session.destroy();
  });

  it('keeps an externally applied visual edit in its own undo history group', () => {
    const { container, submissionField } = createFixture('# Original');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const view = EditorView.findFromDOM(session.getInputElement());
    if (!view) throw new Error('test-editor-view-missing');

    view.dispatch({
      changes: { from: 2, to: 10, insert: 'Source edit' },
      userEvent: 'input.type'
    });
    session.applyTextChange({
      selection: { direction: 'none', end: 21, start: 21 },
      value: '# Source edit visual'
    });

    expect(session.getValue()).toBe('# Source edit visual');
    expect(undo(view)).toBe(true);
    expect(session.getValue()).toBe('# Source edit');

    session.destroy();
  });

  it('exposes the real CodeMirror undo history to the ordinary toolbar', () => {
    const { container, submissionField } = createFixture('Original');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });

    expect(session.canUndo()).toBe(false);
    expect(session.undo()).toBe(false);

    session.applyTextChange({
      selection: { direction: 'none', end: 6, start: 6 },
      value: 'Edited'
    });

    expect(session.canUndo()).toBe(true);
    expect(session.undo()).toBe(true);
    expect(session.getValue()).toBe('Original');
    expect(submissionField.value).toBe('Original');
    expect(session.canUndo()).toBe(false);

    session.destroy();
  });

  it('exposes CodeMirror redo history for windowed visual editing', () => {
    const { container, submissionField } = createFixture('Original');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });

    session.applyTextChange({
      selection: { direction: 'none', end: 6, start: 6 },
      value: 'Edited'
    });
    expect(session.canRedo()).toBe(false);
    expect(session.undo()).toBe(true);
    expect(session.canRedo()).toBe(true);
    expect(session.redo()).toBe(true);
    expect(session.getValue()).toBe('Edited');
    expect(submissionField.value).toBe('Edited');
    expect(session.canRedo()).toBe(false);

    session.destroy();
  });

  it('publishes stable document snapshots against the native saved baseline', () => {
    const { container, submissionField } = createFixture('saved document');
    submissionField.defaultValue = 'saved document';
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    expect(session.getSnapshot()).toEqual({
      savedValue: 'saved document',
      value: 'saved document'
    });
    expect(session.getSnapshot()).toBe(session.getSnapshot());

    session.applyTextChange({
      selection: { direction: 'none', end: 6, start: 6 },
      value: 'edited'
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toEqual({
      savedValue: 'saved document',
      value: 'edited'
    });
    expect(session.getSnapshot()).toBe(session.getSnapshot());

    session.replaceSavedValue('edited');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot()).toEqual({ savedValue: 'edited', value: 'edited' });

    unsubscribe();
    session.destroy();
  });

  it('accepts an external native bridge update without echoing a second input event', () => {
    const { container, submissionField } = createFixture();
    const handleInput = vi.fn();
    submissionField.addEventListener('input', handleInput);
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });

    submissionField.value = 'external command result';
    submissionField.setSelectionRange(9, 16, 'backward');
    submissionField.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(session.getValue()).toBe('external command result');
    expect(session.getSelection()).toEqual({
      end: 16,
      start: 9,
      direction: 'backward'
    });
    expect(handleInput).toHaveBeenCalledTimes(1);

    session.destroy();
  });

  it('synchronizes selection-only transactions without rewriting the document bridge', () => {
    const { container, submissionField } = createFixture();
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    );
    let valueWrites = 0;

    expect(descriptor?.get).toBeTypeOf('function');
    expect(descriptor?.set).toBeTypeOf('function');
    Object.defineProperty(submissionField, 'value', {
      configurable: true,
      get() {
        return descriptor?.get?.call(this);
      },
      set(value: string) {
        valueWrites += 1;
        descriptor?.set?.call(this, value);
      }
    });

    const view = EditorView.findFromDOM(session.getInputElement());
    expect(view).not.toBeNull();
    view?.dispatch({
      selection: EditorSelection.cursor(2)
    });

    expect(session.getSelection()).toEqual({
      end: 2,
      start: 2,
      direction: 'none'
    });
    expect(valueWrites).toBe(0);
    expect(submissionField.selectionStart).toBe(2);

    session.destroy();
  });

  it('reveals an outline position and publishes cursor changes without editing Markdown', () => {
    const { container, submissionField } = createFixture('# First\n\n## Second');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const selectionListener = vi.fn();
    const unsubscribe = session.subscribeSelection(selectionListener);

    session.revealPosition(11);

    expect(session.getSelection()).toEqual({
      direction: 'none',
      end: 11,
      start: 11
    });
    expect(session.getValue()).toBe('# First\n\n## Second');
    expect(submissionField.value).toBe('# First\n\n## Second');
    expect(selectionListener).toHaveBeenCalledTimes(1);
    expect(session.getCursorPosition()).toEqual({ column: 3, line: 3 });

    unsubscribe();
    session.revealPosition(999);
    expect(session.getSelection().start).toBe(session.getValue().length);
    expect(selectionListener).toHaveBeenCalledTimes(1);
    session.destroy();
  });

  it('derives cursor coordinates from the active selection endpoint without scanning text', () => {
    const { container, submissionField } = createFixture('abc\ndef');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });

    session.applyTextChange({
      selection: { direction: 'forward', end: 5, start: 0 },
      value: 'abc\ndef'
    });
    expect(session.getCursorPosition()).toEqual({ column: 2, line: 2 });

    session.applyTextChange({
      selection: { direction: 'backward', end: 5, start: 0 },
      value: 'abc\ndef'
    });
    expect(session.getCursorPosition()).toEqual({ column: 1, line: 1 });
    session.destroy();
  });

  it('reserves image file paste and drop events for the WordPress media owner', () => {
    const { container, submissionField } = createFixture('before');
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const input = session.getInputElement();
    const delegatedDrop = vi.fn();
    input.addEventListener('drop', delegatedDrop);
    const drop = new Event('drop', {
      bubbles: true,
      cancelable: true
    });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        files: [{ name: 'unsafe.svg', type: 'image/svg+xml' }],
        items: []
      }
    });

    input.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(true);
    expect(delegatedDrop).toHaveBeenCalledTimes(1);
    expect(session.getValue()).toBe('before');
    expect(submissionField.value).toBe('before');

    session.destroy();
  });

  it('flushes the current CodeMirror value and selection before native form serialization', () => {
    const { container, submissionField } = createFixture();
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });

    session.applyTextChange({
      selection: {
        end: 5,
        start: 5,
        direction: 'none'
      },
      value: 'draft'
    });
    submissionField.value = 'stale bridge';

    session.flush();

    expect(submissionField.value).toBe('draft');
    expect([
      submissionField.selectionStart,
      submissionField.selectionEnd,
      submissionField.selectionDirection
    ]).toEqual([5, 5, 'none']);

    session.destroy();
  });

  it('inherits native read-only and disabled state changes', async () => {
    const { container, submissionField } = createFixture();
    submissionField.readOnly = true;
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const input = session.getInputElement();

    expect(input.getAttribute('contenteditable')).toBe('false');
    expect(input.getAttribute('aria-readonly')).toBe('true');
    expect(input.getAttribute('aria-disabled')).toBe('false');

    submissionField.readOnly = false;
    submissionField.disabled = true;

    await vi.waitFor(() => {
      expect(input.getAttribute('contenteditable')).toBe('false');
      expect(input.getAttribute('aria-disabled')).toBe('true');
    });

    submissionField.disabled = false;

    await vi.waitFor(() => {
      expect(input.getAttribute('contenteditable')).toBe('true');
      expect(input.getAttribute('aria-readonly')).toBe('false');
      expect(input.getAttribute('aria-disabled')).toBe('false');
    });

    session.destroy();
  });

  it('removes the editor and native bridge subscription on destroy', () => {
    const { container, submissionField } = createFixture();
    const session = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });

    session.destroy();
    submissionField.value = 'after teardown';
    submissionField.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(container.querySelector('.cm-editor')).toBeNull();
    expect(session.getValue()).toBe('alpha beta');
  });
});
