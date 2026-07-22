import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  HighlightStyle,
  syntaxHighlighting
} from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export type DocumentSelectionDirection = 'backward' | 'forward' | 'none';

export type DocumentSelection = Readonly<{
  direction: DocumentSelectionDirection;
  end: number;
  start: number;
}>;

export type DocumentTextChange = Readonly<{
  selection: DocumentSelection;
  value: string;
}>;

export type CodeMirrorDocumentSnapshot = Readonly<{
  savedValue: string;
  value: string;
}>;

export type DocumentCursorPosition = Readonly<{
  column: number;
  line: number;
}>;

export type CodeMirrorDocumentSession = Readonly<{
  applyTextChange: (change: DocumentTextChange) => void;
  destroy: () => void;
  flush: () => void;
  focus: () => void;
  getCursorPosition: () => DocumentCursorPosition;
  getInputElement: () => HTMLElement;
  getScrollElement: () => HTMLElement;
  getSelection: () => DocumentSelection;
  getSnapshot: () => CodeMirrorDocumentSnapshot;
  getValue: () => string;
  replaceSavedValue: (value: string) => void;
  revealPosition: (position: number) => void;
  subscribe: (listener: () => void) => () => void;
  subscribeSelection: (listener: () => void) => () => void;
  syncFromSubmissionField: () => void;
}>;

type CreateCodeMirrorDocumentSessionOptions = Readonly<{
  container: HTMLElement;
  label: string;
  submissionField: HTMLTextAreaElement;
}>;

const markdownHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6
    ],
    color: '#1F2430',
    fontWeight: '700'
  },
  { tag: tags.processingInstruction, color: '#4C6EF5', fontWeight: '400' },
  { tag: tags.contentSeparator, color: '#C7CBD3' },
  { tag: tags.list, color: '#3D4350' },
  { tag: tags.strong, color: '#1F2430', fontWeight: '600' },
  { tag: tags.emphasis, color: '#3D4350', fontStyle: 'italic' },
  {
    tag: tags.strikethrough,
    color: '#9CA0A8',
    textDecoration: 'line-through'
  },
  {
    tag: tags.monospace,
    color: '#E8594F',
    backgroundColor: '#F7F2F0'
  },
  { tag: tags.link, color: '#4C6EF5' },
  { tag: tags.url, color: '#0EA5A5' },
  { tag: tags.labelName, color: '#9B5DE0', fontWeight: '600' },
  { tag: tags.content, color: '#3D4350' },
  { tag: tags.quote, color: '#8A8F98' }
]);

function clampPosition(value: number, documentLength: number): number {
  return Math.max(0, Math.min(documentLength, value));
}

function editorSelection(selection: DocumentSelection, documentLength: number) {
  const start = clampPosition(selection.start, documentLength);
  const end = clampPosition(selection.end, documentLength);

  if ('backward' === selection.direction) {
    return EditorSelection.single(end, start);
  }

  return EditorSelection.single(start, end);
}

function nativeSelection(field: HTMLTextAreaElement): DocumentSelection {
  return {
    direction: field.selectionDirection,
    end: field.selectionEnd,
    start: field.selectionStart
  };
}

function sessionSelection(view: EditorView): DocumentSelection {
  const range = view.state.selection.main;
  const direction = range.empty
    ? 'none'
    : range.anchor > range.head
      ? 'backward'
      : 'forward';

  return {
    direction,
    end: Math.max(range.anchor, range.head),
    start: Math.min(range.anchor, range.head)
  };
}

function editabilityExtensions(field: HTMLTextAreaElement) {
  const disabled = field.disabled;
  const readOnly = disabled || field.readOnly;

  return [
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({
      'aria-disabled': String(disabled),
      'aria-readonly': String(readOnly)
    })
  ];
}

function hasImageFileTransfer(transfer: DataTransfer | null): boolean {
  return Array.from(transfer?.items ?? []).some(
    (item) => 'file' === item.kind && /^image\//i.test(item.type)
  ) || Array.from(transfer?.files ?? []).some(
    (file) => /^image\//i.test(file.type)
  );
}

export function createCodeMirrorDocumentSession({
  container,
  label,
  submissionField
}: CreateCodeMirrorDocumentSessionOptions): CodeMirrorDocumentSession {
  let syncingFromNative = false;
  let destroyed = false;
  const initialValue = submissionField.value;
  let savedValue = submissionField.defaultValue;
  const initialSelection = nativeSelection(submissionField);
  const listeners = new Set<() => void>();
  const selectionListeners = new Set<() => void>();
  let snapshot: CodeMirrorDocumentSnapshot = {
    savedValue,
    value: initialValue
  };
  const publishValue = (value: string) => {
    if (destroyed || value === snapshot.value) {
      return;
    }
    snapshot = { savedValue, value };
    for (const listener of listeners) {
      listener();
    }
  };
  const editability = new Compartment();
  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: initialValue,
      extensions: [
        history(),
        markdownLanguage,
        syntaxHighlighting(markdownHighlightStyle),
        EditorView.domEventHandlers({
          drop(event) {
            return hasImageFileTransfer(event.dataTransfer);
          },
          paste(event) {
            return hasImageFileTransfer(event.clipboardData);
          }
        }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        editability.of(editabilityExtensions(submissionField)),
        EditorView.contentAttributes.of({
          'aria-label': label,
          autocapitalize: 'off',
          autocorrect: 'off',
          spellcheck: 'false'
        }),
        EditorView.updateListener.of((update) => {
          if (
            destroyed
            || syncingFromNative
            || (!update.docChanged && !update.selectionSet)
          ) {
            return;
          }

          const selection = sessionSelection(update.view);
          if (update.docChanged) {
            submissionField.value = update.state.doc.toString();
          }
          submissionField.setSelectionRange(
            selection.start,
            selection.end,
            selection.direction
          );

          if (update.docChanged) {
            submissionField.dispatchEvent(new Event('input', { bubbles: true }));
            publishValue(update.state.doc.toString());
          }
          if (update.selectionSet) {
            for (const listener of selectionListeners) {
              listener();
            }
          }
        })
      ],
      selection: editorSelection(initialSelection, initialValue.length)
    })
  });
  const mutationObserver = new MutationObserver(() => {
    if (destroyed) {
      return;
    }

    view.dispatch({
      effects: editability.reconfigure(editabilityExtensions(submissionField))
    });
  });
  mutationObserver.observe(submissionField, {
    attributeFilter: ['disabled', 'readonly'],
    attributes: true
  });

  const syncFromNative = () => {
    if (destroyed) {
      return;
    }

    const value = submissionField.value;
    const selection = nativeSelection(submissionField);
    const currentValue = view.state.doc.toString();
    const currentSelection = sessionSelection(view);
    const valueChanged = value !== currentValue;
    const selectionChanged =
      selection.start !== currentSelection.start
      || selection.end !== currentSelection.end
      || selection.direction !== currentSelection.direction;

    if (!valueChanged && !selectionChanged) {
      return;
    }

    syncingFromNative = true;
    try {
      const transaction = {
        annotations: [
          Transaction.addToHistory.of(valueChanged),
          Transaction.userEvent.of('input')
        ],
        selection: editorSelection(selection, value.length),
        ...(valueChanged
          ? { changes: { from: 0, to: currentValue.length, insert: value } }
          : {})
      };
      view.dispatch(transaction);
      if (valueChanged) {
        publishValue(value);
      }
    } finally {
      syncingFromNative = false;
    }
  };

  submissionField.addEventListener('input', syncFromNative);

  return {
    applyTextChange({ selection, value }: DocumentTextChange) {
      if (destroyed) {
        return;
      }

      view.dispatch({
        annotations: [
          Transaction.addToHistory.of(true),
          Transaction.userEvent.of('input')
        ],
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: value
        },
        selection: editorSelection(selection, value.length)
      });
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      listeners.clear();
      selectionListeners.clear();
      mutationObserver.disconnect();
      submissionField.removeEventListener('input', syncFromNative);
      view.destroy();
    },
    flush() {
      if (destroyed) {
        return;
      }

      const selection = sessionSelection(view);
      submissionField.value = view.state.doc.toString();
      submissionField.setSelectionRange(
        selection.start,
        selection.end,
        selection.direction
      );
    },
    focus() {
      if (!destroyed) {
        view.focus();
      }
    },
    getCursorPosition() {
      const selection = sessionSelection(view);
      const offset = 'backward' === selection.direction ? selection.start : selection.end;
      const line = view.state.doc.lineAt(offset);
      return {
        column: offset - line.from + 1,
        line: line.number
      };
    },
    getInputElement: () => view.contentDOM,
    getScrollElement: () => view.scrollDOM,
    getSelection: () => sessionSelection(view),
    getSnapshot: () => snapshot,
    getValue: () => view.state.doc.toString(),
    replaceSavedValue(value: string) {
      if (destroyed || value === savedValue) return;
      savedValue = value;
      snapshot = { savedValue, value: snapshot.value };
      for (const listener of listeners) listener();
    },
    revealPosition(position: number) {
      if (destroyed) return;
      const bounded = clampPosition(position, view.state.doc.length);
      view.dispatch({
        effects: EditorView.scrollIntoView(bounded, { y: 'center' }),
        selection: EditorSelection.cursor(bounded)
      });
      view.focus();
    },
    subscribe(listener: () => void) {
      if (destroyed) {
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeSelection(listener: () => void) {
      if (destroyed) return () => {};
      selectionListeners.add(listener);
      return () => selectionListeners.delete(listener);
    },
    syncFromSubmissionField: syncFromNative
  };
}
