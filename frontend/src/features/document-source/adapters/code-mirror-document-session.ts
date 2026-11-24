import {
  defaultKeymap,
  historyKeymap,
  invertedEffects,
  redo as redoCommand,
  redoDepth,
  undo as undoCommand,
  undoDepth
} from '@codemirror/commands';
import { markdownKeymap } from '@codemirror/lang-markdown';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  Transaction
} from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';

import {
  buildApplyTextChangeTransactionSpec,
  buildNativeSyncTransactionSpec,
  canonicalHistorySelectionField,
  clampPosition,
  createDynamicHistoryExtensions,
  createMarkdownSyntaxExtensions,
  type DocumentSelection,
  type DocumentSelectionDirection,
  type DocumentTextChangeRange,
  editabilityExtensions,
  editorSelection,
  hasImageFileTransfer,
  invertCanonicalHistorySelection,
  localTextChange,
  nativeSelection,
  resolveDocumentTextChange,
  selectionEquals,
  sessionSelection,
  stateSelection
} from './code-mirror-document-helpers';

export {
  type DocumentSelection,
  type DocumentSelectionDirection,
  type DocumentTextChangeRange,
  localTextChange
};

export type DocumentTextChange = Readonly<{
  deferNativeBridge?: boolean;
  holdNativeBridge?: boolean;
  isolateHistoryBefore?: boolean;
  /**
   * Joins this change to the previous canonical history event when
   * CodeMirror's own adjacency and time rules allow it. Only an owner that
   * knows both changes belong to ONE user operation may ask for that; every
   * other caller keeps a separate undo step.
   */
  joinPreviousHistory?: boolean;
  /** Records the accepted post-edit selection in CodeMirror's history event. */
  recordHistorySelection?: boolean;
  /**
   * Carries the post-edit selection into the canonical selection field
   * WITHOUT appending the separate history selection event. An owner that
   * commits one typed run keystroke by keystroke needs this: the selection
   * event would hang off the run's first character and block CodeMirror from
   * joining the next keystroke onto it, splitting the run into one undo step
   * per character.
   */
  carryHistorySelectionWithoutEvent?: boolean;
  /** Authenticated native pre-edit selection, committed with the same edit. */
  historySelectionBefore?: DocumentSelection;
  selection: DocumentSelection;
  value: string;
  changes?: DocumentTextChangeRange;
}>;

export type CodeMirrorDocumentSnapshot = Readonly<{
  savedValue: string;
  value: string;
}>;

export type DocumentHistoryState = Readonly<{
  redoDepth: number;
  undoDepth: number;
}>;

export type DocumentCursorPosition = Readonly<{
  column: number;
  line: number;
}>;

export type CodeMirrorDocumentSession = Readonly<{
  applyTextChange: (change: DocumentTextChange) => DocumentTextChangeRange | null;
  canRedo: () => boolean;
  canUndo: () => boolean;
  destroy: () => void;
  flush: () => void;
  focus: () => void;
  isEditable: () => boolean;
  /**
   * Commits the selection a context-menu pointer gesture must be described
   * by, mapping the real pointer through CodeMirror's own coordinates. The
   * committed transaction changes the selection only: no document write, no
   * history entry, and no scrolling. A deliberate non-empty selection is
   * preserved as the user's own pointer extent. Returns `false` when the
   * pointer cannot be established against this source - a destroyed session,
   * a detached view, or an unmappable pointer coordinate - instead of
   * falling back to a fabricated position.
   */
  prepareContextMenuPointer: (
    position: Readonly<{ x: number; y: number }>
  ) => boolean;
  getCursorPosition: () => DocumentCursorPosition;
  getInputElement: () => HTMLElement;
  getHistoryState: () => DocumentHistoryState;
  getScrollElement: () => HTMLElement;
  /**
   * Captures CodeMirror's own public scroll snapshot for a layout change that
   * commits before the next layout effect. The returned restore dispatches the
   * snapshot only while this session is alive, the same document revision is
   * current, the view is attached, and visual editing has not parked it;
   * otherwise it is a no-op. Neither the capture nor the restore changes the
   * document or the selection.
   */
  captureLayoutScrollRestore: () => (() => void) | null;
  getSelection: () => DocumentSelection;
  getSnapshot: () => CodeMirrorDocumentSnapshot;
  getValue: () => string;
  getRevision: () => number;
  replaceSavedValue: (value: string) => void;
  /**
   * Applies one history step. A caller that keeps offsets bound to this
   * document passes `observe` to receive the exact replacements the step
   * made, in the pre-step document's coordinates and ascending order.
   */
  redo: (observe?: DocumentHistoryStepObserver) => boolean;
  revealPosition: (position: number) => void;
  subscribe: (listener: () => void) => () => void;
  subscribeSelection: (listener: () => void) => () => void;
  setVisualEditingActive: (active: boolean) => void;
  syncFromSubmissionField: () => void;
  undo: (observe?: DocumentHistoryStepObserver) => boolean;
}>;

export type DocumentHistoryStepObserver = (
  changes: ReadonlyArray<DocumentTextChangeRange>
) => void;

type CreateCodeMirrorDocumentSessionOptions = Readonly<{
  container: HTMLElement;
  label: string;
  lineNumbers?: boolean;
  submissionField: HTMLTextAreaElement;
  wordWrap?: boolean;
}>;

export function createCodeMirrorDocumentSession({
  container,
  label,
  lineNumbers: showLineNumbers = true,
  submissionField,
  wordWrap = true
}: CreateCodeMirrorDocumentSessionOptions): CodeMirrorDocumentSession {
  let syncingFromNative = false;
  let destroyed = false;
  let documentRevision = 0;
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
    documentRevision += 1;
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
  let visualNativeBridgeHeld = false;
  let pendingVisualNativeBridge: Readonly<{
    emitInput: boolean;
    selection: DocumentSelection;
    value: string | null;
  }> | null = null;
  const markdownSyntaxExtensions = createMarkdownSyntaxExtensions();
  const extensions = [
    ...createDynamicHistoryExtensions(initialValue.length),
    canonicalHistorySelectionField,
    invertedEffects.of(invertCanonicalHistorySelection),
    markdownSyntax.of(markdownSyntaxExtensions),
    // CodeMirror's keymap resolves a character key with Shift stripped first,
    // so a lowercase `key: "z"` with Shift (CapsLock on, or a synthetic
    // Ctrl+Shift+z) would match `Mod-z` Undo before `Mod-Shift-z` Redo. Route
    // every Mod+Shift+Z to Redo ahead of the keymap. The physical `KeyZ`
    // fallback only covers non-ASCII-letter keys (IME, non-Latin layouts), so
    // AZERTY `w` and QWERTZ `y` shortcuts on that key are not hijacked.
    Prec.highest(EditorView.domEventHandlers({
      keydown(event, view) {
        const key = event.key.toLowerCase();
        if (
          !(event.ctrlKey || event.metaKey)
          || !event.shiftKey
          || event.altKey
          || ('z' !== key && ('KeyZ' !== event.code || /^[a-z]$/u.test(key)))
        ) {
          return false;
        }
        event.preventDefault();
        redoCommand(view);
        return true;
      }
    })),
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
    visualNativeBridgeHeld = false;
  };
  const flushVisualNativeBridge = (): void => {
    visualNativeBridgeHeld = false;
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
    emitInput: boolean,
    hold: boolean
  ): void => {
    pendingVisualNativeBridge = {
      emitInput: emitInput || Boolean(pendingVisualNativeBridge?.emitInput),
      selection,
      value: value ?? pendingVisualNativeBridge?.value ?? null
    };
    if (hold) {
      visualNativeBridgeHeld = true;
      if (null !== visualNativeBridgeTimer) {
        browserWindow.clearTimeout(visualNativeBridgeTimer);
        visualNativeBridgeTimer = null;
      }
      return;
    }
    if (visualNativeBridgeHeld || null !== visualNativeBridgeTimer) return;
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
    deferNativeBridge = false,
    holdNativeBridge = false,
    knownValue?: string
  ): void => {
    const current = activeVisualState;
    if (!current || transaction.startState !== current) {
      throw new Error('document-visual-editor-transaction-stale');
    }
    activeVisualState = transaction.state;
    const selection = stateSelection(transaction.state);
    const value = transaction.docChanged
      ? knownValue ?? transaction.state.doc.toString()
      : null;
    if (null !== value) {
      publishValue(value);
    }
    if (emitNativeInput) {
      scheduleVisualNativeBridge(
        selection,
        value,
        null !== value,
        holdNativeBridge
      );
      if (!deferNativeBridge && !visualNativeBridgeHeld) {
        flushVisualNativeBridge();
      }
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
  const recordCanonicalHistorySelection = (): void => {
    const state = authoritativeState();
    const transaction = state.update({
      annotations: [
        Transaction.addToHistory.of(true),
        Transaction.userEvent.of('select.canonicalSelection')
      ],
      selection: state.selection
    });
    if (activeVisualState) {
      activeVisualState = transaction.state;
    } else {
      view.dispatch(transaction);
    }
  };
  const restoreHistorySelection = (): void => {
    const state = authoritativeState();
    const expected = state.field(canonicalHistorySelectionField, false) ?? null;
    if (!expected) return;
    const current = stateSelection(state);
    if (selectionEquals(current, expected)) return;
    const transaction = state.update({
      annotations: [
        Transaction.addToHistory.of(false),
        Transaction.userEvent.of('select.canonicalHistory')
      ],
      selection: editorSelection(expected, state.doc.length)
    });
    if (activeVisualState) {
      activeVisualState = transaction.state;
      scheduleVisualNativeBridge(expected, null, false, false);
      for (const listener of selectionListeners) listener();
    } else {
      view.dispatch(transaction);
    }
  };
  const runHistoryStep = (
    command: typeof undoCommand,
    observe?: DocumentHistoryStepObserver
  ): boolean => {
    if (destroyed) return false;
    const changes: DocumentTextChangeRange[] = [];
    const changed = command({
      dispatch: (transaction: Transaction) => {
        if (observe) {
          transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
            changes.push({ from, insert: inserted.toString(), to });
          });
        }
        dispatchAuthoritative(transaction);
      },
      state: authoritativeState()
    });
    if (changed) restoreHistorySelection();
    if (changed && !visualEditingActive) view.focus();
    if (changed) observe?.(changes);
    return changed;
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
    const selectionChanged = !selectionEquals(selection, currentSelection);

    if (!valueChanged && !selectionChanged) {
      return;
    }

    syncingFromNative = true;
    try {
      const transaction = buildNativeSyncTransactionSpec(
        currentValue,
        value,
        selection,
        valueChanged
      );
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
      carryHistorySelectionWithoutEvent = false,
      changes,
      deferNativeBridge = false,
      holdNativeBridge = false,
      isolateHistoryBefore = false,
      joinPreviousHistory = false,
      recordHistorySelection = false,
      historySelectionBefore,
      selection,
      value
    }: DocumentTextChange) {
      if (destroyed) {
        return null;
      }
      const state = authoritativeState();
      const selectionBefore = stateSelection(state);
      const { resolvedChanges, valueChanged } = resolveDocumentTextChange(
        state,
        changes,
        value
      );
      const transactionSpec = buildApplyTextChangeTransactionSpec({
        carryHistorySelectionWithoutEvent,
        docLength: state.doc.length,
        historySelectionBefore,
        isolateHistoryBefore,
        joinPreviousHistory,
        recordHistorySelection,
        resolvedChanges,
        selection,
        selectionBefore,
        value,
        valueChanged
      });
      if (activeVisualState) {
        publishVisualTransaction(
          activeVisualState.update(transactionSpec),
          true,
          deferNativeBridge,
          holdNativeBridge,
          value
        );
      } else {
        view.dispatch(transactionSpec);
      }
      if (recordHistorySelection && valueChanged && !joinPreviousHistory) {
        // A joined typing run must not append a separate selection event to
        // the history branch: CodeMirror refuses to join a later change onto
        // an event that carries selectionsAfter, so the run would split into
        // one undo step per character. The change's own selection effect has
        // already recorded this edit's canonical caret.
        recordCanonicalHistorySelection();
      }
      return resolvedChanges;
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
    isEditable: () => !destroyed && !submissionField.disabled && !submissionField.readOnly,
    prepareContextMenuPointer({ x, y }) {
      // CodeMirror starts its own mouse selection for the primary button
      // only, so the pointer gesture that requests a context menu cannot be
      // assumed to have moved the canonical selection. A detached view has no
      // pointer coordinates to map: immersive visual editing owns the
      // canonical state and has moved this view's DOM out of the document.
      if (destroyed || !view.dom.isConnected) return false;
      // A context-menu gesture has no context to establish on a source the
      // user cannot edit, and a read-only source must not have its selection
      // moved either: the surface's own read-only failure owns that gesture.
      if (submissionField.disabled || submissionField.readOnly) return false;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      const state = view.state;
      const current = stateSelection(state);
      // A deliberate non-empty selection is the user's own pointer extent;
      // collapsing it onto the hit position would discard that intent.
      if (current.start !== current.end) return true;
      const mapped = view.posAtCoords({ x, y }, false);
      if (null === mapped) return false;
      const cursor = clampPosition(mapped, state.doc.length);
      if (cursor === current.start) return true;
      view.dispatch({
        annotations: [
          // Opening a menu is not an edit and must not become a history step:
          // without this, CodeMirror records the selection change and
          // `undoSelection` (Mod-u / Alt-u) could pop it as a selection entry.
          // The canonical selection-only path (`syncFromNative`) gates the same
          // annotation, and the pointer selection still reaches the submission
          // field through the update listener.
          Transaction.addToHistory.of(false),
          Transaction.userEvent.of('select.pointer')
        ],
        selection: EditorSelection.cursor(cursor)
      });
      return true;
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
    getHistoryState: () => {
      if (destroyed) return { redoDepth: 0, undoDepth: 0 };
      const state = authoritativeState();
      return {
        redoDepth: redoDepth(state),
        undoDepth: undoDepth(state)
      };
    },
    getScrollElement: () => view.scrollDOM,
    captureLayoutScrollRestore() {
      // An attached-but-hidden Source (for example the locked Preview's
      // parked CodeMirror) has no real viewport to preserve: capturing it
      // would freeze a zero/invisible scroll position and replay it when the
      // Source is revealed. Only a rendered, non-zero scroll owner may
      // capture or restore; a hidden owner keeps CodeMirror's own reset.
      const hasVisibleScrollOwner = () =>
        view.dom.isConnected
        && view.scrollDOM.getClientRects().length > 0
        && view.scrollDOM.clientHeight > 0;
      if (destroyed || visualEditingActive || !hasVisibleScrollOwner()) {
        return null;
      }
      const revision = documentRevision;
      const snapshot = view.scrollSnapshot();
      return () => {
        if (
          destroyed
          || visualEditingActive
          || documentRevision !== revision
          || !hasVisibleScrollOwner()
        ) {
          return;
        }
        view.dispatch({ effects: snapshot });
      };
    },
    getSelection: () => stateSelection(authoritativeState()),
    getSnapshot: () => snapshot,
    getValue: () => authoritativeState().doc.toString(),
    getRevision: () => documentRevision,
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
    redo: (observe) => runHistoryStep(redoCommand, observe),
    undo: (observe) => runHistoryStep(undoCommand, observe)
  };
}
