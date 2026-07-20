import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

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

export type CodeMirrorDocumentSession = Readonly<{
  applyTextChange: (change: DocumentTextChange) => void;
  destroy: () => void;
  flush: () => void;
  focus: () => void;
  getInputElement: () => HTMLElement;
  getScrollElement: () => HTMLElement;
  getSelection: () => DocumentSelection;
  getValue: () => string;
  syncFromSubmissionField: () => void;
}>;

type CreateCodeMirrorDocumentSessionOptions = Readonly<{
  container: HTMLElement;
  label: string;
  submissionField: HTMLTextAreaElement;
}>;

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
  const initialSelection = nativeSelection(submissionField);
  const editability = new Compartment();
  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: initialValue,
      extensions: [
        history(),
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
    getInputElement: () => view.contentDOM,
    getScrollElement: () => view.scrollDOM,
    getSelection: () => sessionSelection(view),
    getValue: () => view.state.doc.toString(),
    syncFromSubmissionField: syncFromNative
  };
}
