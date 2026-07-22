import { describe, expect, it, vi } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { createCodeMirrorDocumentSession } from './code-mirror-document-session';

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
