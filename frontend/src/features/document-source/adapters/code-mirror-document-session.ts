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
  prepareSurfaceTransfer: (host: HTMLElement) => Readonly<{
    activate: () => void;
    dispose: () => void;
  }>;
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
  let activeSurfaceTransfer: Readonly<{ dispose: () => void }> | null = null;
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
      activeSurfaceTransfer?.dispose();
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
    prepareSurfaceTransfer(host: HTMLElement) {
      if (destroyed) {
        throw new Error('code-mirror-session-destroyed');
      }
      if (activeSurfaceTransfer) {
        throw new Error('code-mirror-surface-transfer-active');
      }
      const home = view.dom.parentNode;
      const homeNextSibling = view.dom.nextSibling;
      if (!home) {
        throw new Error('code-mirror-surface-home-unavailable');
      }
      const scrollTop = view.scrollDOM.scrollTop;
      const scrollLeft = view.scrollDOM.scrollLeft;
      const restoreScroll = () => {
        view.scrollDOM.scrollTop = scrollTop;
        view.scrollDOM.scrollLeft = scrollLeft;
      };
      let activated = false;
      let disposed = false;
      const transfer = {
        activate() {
          if (disposed) {
            throw new Error('code-mirror-surface-transfer-disposed');
          }
          if (activated) {
            return;
          }
          activated = true;
          host.append(view.dom);
          view.requestMeasure();
          restoreScroll();
        },
        dispose() {
          if (disposed) {
            return;
          }
          disposed = true;
          if (activated) {
            if (homeNextSibling?.parentNode === home) {
              home.insertBefore(view.dom, homeNextSibling);
            } else {
              home.appendChild(view.dom);
            }
            view.requestMeasure();
            restoreScroll();
            view.scrollDOM.ownerDocument.defaultView?.requestAnimationFrame(restoreScroll);
          }
          if (activeSurfaceTransfer === transfer) {
            activeSurfaceTransfer = null;
          }
        }
      };
      activeSurfaceTransfer = transfer;
      return transfer;
    },
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
