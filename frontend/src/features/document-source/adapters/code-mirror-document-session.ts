import {
  defaultKeymap,
  history,
  historyKeymap,
  redo as redoCommand,
  redoDepth,
  undo as undoCommand,
  undoDepth
} from '@codemirror/commands';
import {
  HighlightStyle,
  syntaxHighlighting
} from '@codemirror/language';
import { markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Transaction
} from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export type DocumentSelectionDirection = 'backward' | 'forward' | 'none';

export type DocumentSelection = Readonly<{
  direction: DocumentSelectionDirection;
  end: number;
  start: number;
}>;

export type DocumentTextChangeRange = Readonly<{
  from: number;
  insert: string;
  to: number;
}>;

export type DocumentTextChange = Readonly<{
  deferNativeBridge?: boolean;
  selection: DocumentSelection;
  value: string;
  changes?: DocumentTextChangeRange;
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
  canRedo: () => boolean;
  canUndo: () => boolean;
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
  redo: () => boolean;
  revealPosition: (position: number) => void;
  subscribe: (listener: () => void) => () => void;
  subscribeSelection: (listener: () => void) => () => void;
  setVisualEditingActive: (active: boolean) => void;
  syncFromSubmissionField: () => void;
  undo: () => boolean;
}>;

type CreateCodeMirrorDocumentSessionOptions = Readonly<{
  container: HTMLElement;
  label: string;
  lineNumbers?: boolean;
  submissionField: HTMLTextAreaElement;
  wordWrap?: boolean;
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

function localTextChange(
  currentValue: string,
  nextValue: string
): Readonly<{ from: number; insert: string; to: number }> | null {
  if (currentValue === nextValue) return null;

  const currentLength = currentValue.length;
  const nextLength = nextValue.length;
  const commonLength = Math.min(currentLength, nextLength);
  let prefixLength = 0;
  while (
    prefixLength < commonLength
    && currentValue.charCodeAt(prefixLength) === nextValue.charCodeAt(prefixLength)
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    prefixLength + suffixLength < currentLength
    && prefixLength + suffixLength < nextLength
    && currentValue.charCodeAt(currentLength - suffixLength - 1)
      === nextValue.charCodeAt(nextLength - suffixLength - 1)
  ) {
    suffixLength += 1;
  }

  return {
    from: prefixLength,
    insert: nextValue.slice(prefixLength, nextLength - suffixLength),
    to: currentLength - suffixLength
  };
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
  return stateSelection(view.state);
}

function stateSelection(state: EditorState): DocumentSelection {
  const range = state.selection.main;
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
  lineNumbers: showLineNumbers = true,
  submissionField,
  wordWrap = true
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
  const markdownSyntax = new Compartment();
  let visualEditingActive = false;
  let activeVisualState: EditorState | null = null;
  let visualEditingFragment: DocumentFragment | null = null;
  let visualEditingParent: Node | null = null;
  let visualEditingNextSibling: ChildNode | null = null;
  let visualNativeBridgeTimer: number | null = null;
  let pendingVisualNativeBridge: Readonly<{
    emitInput: boolean;
    selection: DocumentSelection;
    value: string | null;
  }> | null = null;
  const markdownSyntaxExtensions = [
    markdownLanguage,
    syntaxHighlighting(markdownHighlightStyle)
  ];
  const extensions = [
    history(),
    markdownSyntax.of(markdownSyntaxExtensions),
    EditorView.domEventHandlers({
      drop(event) {
        return hasImageFileTransfer(event.dataTransfer);
      },
      paste(event) {
        return hasImageFileTransfer(event.clipboardData);
      }
    }),
    keymap.of([
      ...markdownKeymap,
      ...defaultKeymap,
      ...historyKeymap
    ]),
    ...(showLineNumbers ? [lineNumbers()] : []),
    // Keep line numbers in CodeMirror's own scroll-synchronized gutter;
    // each editor surface owns its presentation.
    ...(wordWrap ? [EditorView.lineWrapping] : []),
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
      const value = update.docChanged
        ? update.state.doc.toString()
        : null;
      if (null !== value) {
        submissionField.value = value;
      }
      submissionField.setSelectionRange(
        selection.start,
        selection.end,
        selection.direction
      );

      if (null !== value) {
        syncingFromNative = true;
        try {
          submissionField.dispatchEvent(new Event('input', { bubbles: true }));
        } finally {
          syncingFromNative = false;
        }
        publishValue(value);
      }
      if (update.selectionSet) {
        for (const listener of selectionListeners) listener();
      }
    })
  ];
  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: initialValue,
      extensions,
      selection: editorSelection(initialSelection, initialValue.length)
    })
  });
  const browserWindow = view.dom.ownerDocument.defaultView;
  if (!browserWindow) {
    view.destroy();
    throw new Error('document-editor-window-unavailable');
  }

  const cancelVisualNativeBridge = (): void => {
    if (null !== visualNativeBridgeTimer) {
      browserWindow.clearTimeout(visualNativeBridgeTimer);
      visualNativeBridgeTimer = null;
    }
    pendingVisualNativeBridge = null;
  };
  const flushVisualNativeBridge = (): void => {
    if (null !== visualNativeBridgeTimer) {
      browserWindow.clearTimeout(visualNativeBridgeTimer);
      visualNativeBridgeTimer = null;
    }
    const pending = pendingVisualNativeBridge;
    pendingVisualNativeBridge = null;
    if (!pending || destroyed) return;
    if (null !== pending.value) submissionField.value = pending.value;
    submissionField.setSelectionRange(
      pending.selection.start,
      pending.selection.end,
      pending.selection.direction
    );
    if (pending.emitInput && null !== pending.value) {
      syncingFromNative = true;
      try {
        submissionField.dispatchEvent(new Event('input', { bubbles: true }));
      } finally {
        syncingFromNative = false;
      }
    }
  };
  const scheduleVisualNativeBridge = (
    selection: DocumentSelection,
    value: string | null,
    emitInput: boolean
  ): void => {
    pendingVisualNativeBridge = {
      emitInput: emitInput || Boolean(pendingVisualNativeBridge?.emitInput),
      selection,
      value: value ?? pendingVisualNativeBridge?.value ?? null
    };
    if (null !== visualNativeBridgeTimer) return;
    visualNativeBridgeTimer = browserWindow.setTimeout(() => {
      visualNativeBridgeTimer = null;
      flushVisualNativeBridge();
    }, 0);
  };

  const assertDetachedViewPlacement = (): void => {
    const fragment = visualEditingFragment;
    const parent = visualEditingParent;
    if (!fragment || !parent) {
      throw new Error('document-visual-editor-fragment-missing');
    }
    if (view.dom.parentNode !== fragment) {
      throw new Error('document-visual-editor-fragment-changed');
    }
    if (
      visualEditingNextSibling
      && visualEditingNextSibling.parentNode !== parent
    ) {
      throw new Error('document-visual-editor-next-sibling-changed');
    }
  };

  const restoreDetachedView = (): void => {
    assertDetachedViewPlacement();
    const parent = visualEditingParent;
    if (!parent) {
      throw new Error('document-visual-editor-parent-missing');
    }
    parent.insertBefore(view.dom, visualEditingNextSibling);
    visualEditingFragment = null;
    visualEditingParent = null;
    visualEditingNextSibling = null;
  };

  const authoritativeState = (): EditorState =>
    activeVisualState ?? view.state;
  const publishVisualTransaction = (
    transaction: Transaction,
    emitNativeInput = true,
    deferNativeBridge = false
  ): void => {
    const current = activeVisualState;
    if (!current || transaction.startState !== current) {
      throw new Error('document-visual-editor-transaction-stale');
    }
    activeVisualState = transaction.state;
    const selection = stateSelection(transaction.state);
    const value = transaction.docChanged
      ? transaction.state.doc.toString()
      : null;
    if (null !== value) {
      publishValue(value);
    }
    if (emitNativeInput) {
      scheduleVisualNativeBridge(selection, value, null !== value);
      if (!deferNativeBridge) flushVisualNativeBridge();
    }
    if (transaction.selection) {
      for (const listener of selectionListeners) listener();
    }
  };
  const dispatchAuthoritative = (
    transaction: Transaction,
    emitNativeInput = true
  ): void => {
    if (visualEditingActive) {
      publishVisualTransaction(transaction, emitNativeInput);
      return;
    }
    view.dispatch(transaction);
  };

  const mutationObserver = new MutationObserver(() => {
    if (destroyed) {
      return;
    }

    const effects = editability.reconfigure(
      editabilityExtensions(submissionField)
    );
    if (activeVisualState) {
      dispatchAuthoritative(activeVisualState.update({ effects }));
    } else {
      view.dispatch({ effects });
    }
  });
  mutationObserver.observe(submissionField, {
    attributeFilter: ['disabled', 'readonly'],
    attributes: true
  });

  const syncFromNative = () => {
    if (destroyed || syncingFromNative) {
      return;
    }
    if (activeVisualState) cancelVisualNativeBridge();

    const value = submissionField.value;
    const selection = nativeSelection(submissionField);
    const state = authoritativeState();
    const currentValue = state.doc.toString();
    const currentSelection = stateSelection(state);
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
      if (visualEditingActive) {
        dispatchAuthoritative(state.update(transaction), false);
      } else {
        view.dispatch(transaction);
      }
      if (valueChanged && !visualEditingActive) {
        publishValue(value);
      }
    } finally {
      syncingFromNative = false;
    }
  };

  submissionField.addEventListener('input', syncFromNative);

  return {
    applyTextChange({
      changes,
      deferNativeBridge = false,
      selection,
      value
    }: DocumentTextChange) {
      if (destroyed) {
        return;
      }
      const state = authoritativeState();
      let valueChanged = false;
      let resolvedChanges: DocumentTextChangeRange | null = null;
      if (changes) {
        const { from, insert, to } = changes;
        if (
          !Number.isInteger(from)
          || !Number.isInteger(to)
          || from < 0
          || to < from
          || to > state.doc.length
        ) {
          throw new Error('document-text-change-range-invalid');
        }
        const expectedLength =
          state.doc.length - (to - from) + insert.length;
        if (value.length !== expectedLength) {
          throw new Error('document-text-change-value-length-mismatch');
        }
        valueChanged =
          to - from !== insert.length
          || state.doc.sliceString(from, to) !== insert;
        resolvedChanges = valueChanged ? changes : null;
      } else {
        const currentValue = state.doc.toString();
        valueChanged = value !== currentValue;
        if (valueChanged) {
          resolvedChanges = localTextChange(currentValue, value);
        }
      }
      const transactionSpec = {
        annotations: [
          Transaction.addToHistory.of(valueChanged),
          Transaction.userEvent.of('input')
        ],
        ...(resolvedChanges ? { changes: resolvedChanges } : {}),
        selection: editorSelection(selection, value.length)
      };
      if (activeVisualState) {
        publishVisualTransaction(
          activeVisualState.update(transactionSpec),
          true,
          deferNativeBridge
        );
      } else {
        view.dispatch(transactionSpec);
      }
    },
    canUndo: () => !destroyed && undoDepth(authoritativeState()) > 0,
    canRedo: () => !destroyed && redoDepth(authoritativeState()) > 0,
    destroy() {
      if (destroyed) {
        return;
      }
      flushVisualNativeBridge();
      destroyed = true;
      cancelVisualNativeBridge();
      visualEditingActive = false;
      activeVisualState = null;
      listeners.clear();
      selectionListeners.clear();
      mutationObserver.disconnect();
      submissionField.removeEventListener('input', syncFromNative);
      visualEditingFragment?.replaceChildren();
      visualEditingFragment = null;
      visualEditingParent = null;
      visualEditingNextSibling = null;
      view.destroy();
    },
    flush() {
      if (destroyed) {
        return;
      }

      flushVisualNativeBridge();
      const state = authoritativeState();
      const selection = stateSelection(state);
      submissionField.value = state.doc.toString();
      submissionField.setSelectionRange(
        selection.start,
        selection.end,
        selection.direction
      );
    },
    focus() {
      if (!destroyed && !activeVisualState) {
        view.focus();
      }
    },
    getCursorPosition() {
      const state = authoritativeState();
      const selection = stateSelection(state);
      const offset = 'backward' === selection.direction ? selection.start : selection.end;
      const line = state.doc.lineAt(offset);
      return {
        column: offset - line.from + 1,
        line: line.number
      };
    },
    getInputElement: () => view.contentDOM,
    getScrollElement: () => view.scrollDOM,
    getSelection: () => stateSelection(authoritativeState()),
    getSnapshot: () => snapshot,
    getValue: () => authoritativeState().doc.toString(),
    replaceSavedValue(value: string) {
      if (destroyed || value === savedValue) return;
      savedValue = value;
      snapshot = { savedValue, value: snapshot.value };
      for (const listener of listeners) listener();
    },
    revealPosition(position: number) {
      if (destroyed) return;
      const state = authoritativeState();
      const bounded = clampPosition(position, state.doc.length);
      if (activeVisualState) {
        dispatchAuthoritative(state.update({
          effects: EditorView.scrollIntoView(bounded, { y: 'center' }),
          selection: EditorSelection.cursor(bounded)
        }));
      } else {
        view.dispatch({
          effects: EditorView.scrollIntoView(bounded, { y: 'center' }),
          selection: EditorSelection.cursor(bounded)
        });
        view.focus();
      }
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
    setVisualEditingActive(active: boolean) {
      if (destroyed || active === visualEditingActive) {
        return;
      }
      if (active) {
        if (activeVisualState) {
          throw new Error('document-visual-editor-state-already-active');
        }
        const parent = view.dom.parentNode;
        if (!parent) {
          throw new Error('document-visual-editor-parent-missing');
        }
        view.dispatch({
          effects: markdownSyntax.reconfigure([])
        });
        const nextSibling = view.dom.nextSibling;
        const fragment = view.dom.ownerDocument.createDocumentFragment();
        fragment.append(view.dom);
        visualEditingParent = parent;
        visualEditingNextSibling = nextSibling;
        visualEditingFragment = fragment;
        activeVisualState = view.state;
        visualEditingActive = true;
        return;
      }

      if (!visualEditingFragment || !activeVisualState) {
        throw new Error('document-visual-editor-fragment-missing');
      }
      flushVisualNativeBridge();
      assertDetachedViewPlacement();
      const restoredState = activeVisualState.update({
        effects: markdownSyntax.reconfigure(markdownSyntaxExtensions)
      }).state;
      view.setState(restoredState);
      restoreDetachedView();
      activeVisualState = null;
      visualEditingActive = false;
    },
    syncFromSubmissionField: syncFromNative,
    redo() {
      if (destroyed) return false;
      const state = authoritativeState();
      const changed = redoCommand({
        dispatch: (transaction: Transaction) =>
          dispatchAuthoritative(transaction),
        state
      });
      if (changed && !visualEditingActive) view.focus();
      return changed;
    },
    undo() {
      if (destroyed) return false;
      const state = authoritativeState();
      const changed = undoCommand({
        dispatch: (transaction: Transaction) =>
          dispatchAuthoritative(transaction),
        state
      });
      if (changed && !visualEditingActive) view.focus();
      return changed;
    }
  };
}
