import { history, isolateHistory } from '@codemirror/commands';
import {
  HighlightStyle,
  syntaxHighlighting
} from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import {
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  Transaction
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
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

export type CanonicalHistorySelectionEffectValue = Readonly<{
  inverse: DocumentSelection | null;
  selection: DocumentSelection | null;
}>;

export const canonicalHistorySelectionEffect =
  StateEffect.define<CanonicalHistorySelectionEffectValue>();

export const canonicalHistorySelectionField =
  StateField.define<DocumentSelection | null>({
    create: () => null,
    update(value, transaction) {
      let next = value;
      let hasCanonicalHistoryEffect = false;
      for (const effect of transaction.effects) {
        if (effect.is(canonicalHistorySelectionEffect)) {
          hasCanonicalHistoryEffect = true;
          next = effect.value.selection;
        }
      }
      if (transaction.docChanged && !hasCanonicalHistoryEffect) {
        return null;
      }
      return next;
    }
  });

// Grouped history replays inverse effects in reverse edit order. Reverse only
// this provider's effects so the next inversion restores the latest selection.
export const invertCanonicalHistorySelection = (transaction: Transaction) =>
  transaction.effects.flatMap((effect) => {
    if (!effect.is(canonicalHistorySelectionEffect)) return [];
    return [canonicalHistorySelectionEffect.of({
      inverse: effect.value.selection,
      selection: effect.value.inverse
    })];
  }).reverse();

export const markdownHighlightStyle = HighlightStyle.define([
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

export function createMarkdownSyntaxExtensions() {
  return [
    markdownLanguage,
    syntaxHighlighting(markdownHighlightStyle)
  ];
}

export function createDynamicHistoryExtensions(initialDocumentLength: number) {
  // Visual editing records one history event per keystroke so undo walks
  // back one edit at a time. The default depth of 100 events would silently
  // drop the beginning of a long pass (typing a document in, or deleting one
  // back to its start), leaving the oldest reachable state partway through.
  // Scale the retained depth to the document so a full pass stays undoable,
  // and keep growing it as the document does: a fixture typed in after mount
  // has no length at creation, but its own deletion still runs one event per
  // character.
  const historyCompartment = new Compartment();
  const historyDepthEffect = StateEffect.define<number>();
  // The configured depth travels with the state, not with the session, so a
  // transaction that is built but never applied cannot report capacity the
  // history field does not actually have.
  const historyDepthField = StateField.define<number>({
    create: () => Math.max(1_000, initialDocumentLength * 2),
    update: (depth, transaction) => {
      for (const effect of transaction.effects) {
        if (effect.is(historyDepthEffect)) return effect.value;
      }
      return depth;
    }
  });
  const historyExtensions = (depth: number) => history({ minDepth: depth });
  return [
    historyCompartment.of(
      historyExtensions(Math.max(1_000, initialDocumentLength * 2))
    ),
    historyDepthField,
    // A transaction extender runs before the transaction's state is built, so
    // the reconfigure below belongs to the same update as the change that made
    // the document longer: its history event is retained at the new depth
    // rather than trimmed at the old one. Depth only ever grows.
    EditorState.transactionExtender.of((transaction) => {
      const required = Math.max(1_000, transaction.newDoc.length * 2);
      if (required <= transaction.startState.field(historyDepthField)) {
        return null;
      }
      return {
        effects: [
          historyDepthEffect.of(required),
          historyCompartment.reconfigure(historyExtensions(required))
        ]
      };
    })
  ];
}

export function clampPosition(value: number, documentLength: number): number {
  return Math.max(0, Math.min(documentLength, value));
}

/**
 * The one minimal-diff owner for a whole-value write: the smallest single
 * replacement that replays `currentValue` as `nextValue`, or `null` when the
 * values are identical.
 *
 * Exported for the editor's unit-test doubles only: a double that returns no
 * range from `applyTextChange` violates the port, so the harness describes the
 * write with this same owner instead of a second diff implementation. No
 * production caller derives a committed range from it.
 */
export function localTextChange(
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

export function editorSelection(selection: DocumentSelection, documentLength: number) {
  const start = clampPosition(selection.start, documentLength);
  const end = clampPosition(selection.end, documentLength);

  if ('backward' === selection.direction) {
    return EditorSelection.single(end, start);
  }

  return EditorSelection.single(start, end);
}

export function normalizedSelection(
  selection: DocumentSelection,
  documentLength: number
): DocumentSelection {
  const normalized = editorSelection(selection, documentLength).main;
  const direction = normalized.empty
    ? 'none'
    : normalized.anchor > normalized.head
      ? 'backward'
      : 'forward';

  return {
    direction,
    end: Math.max(normalized.anchor, normalized.head),
    start: Math.min(normalized.anchor, normalized.head)
  };
}

export function nativeSelection(field: HTMLTextAreaElement): DocumentSelection {
  return {
    direction: field.selectionDirection,
    end: field.selectionEnd,
    start: field.selectionStart
  };
}

export function sessionSelection(view: EditorView): DocumentSelection {
  return stateSelection(view.state);
}

export function stateSelection(state: EditorState): DocumentSelection {
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

export function editabilityExtensions(field: HTMLTextAreaElement) {
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

export function hasImageFileTransfer(transfer: DataTransfer | null): boolean {
  return Array.from(transfer?.items ?? []).some(
    (item) => 'file' === item.kind && /^image\//i.test(item.type)
  ) || Array.from(transfer?.files ?? []).some(
    (file) => /^image\//i.test(file.type)
  );
}

export function resolveDocumentTextChange(
  state: EditorState,
  changes: DocumentTextChangeRange | undefined,
  value: string
): Readonly<{
  resolvedChanges: DocumentTextChangeRange | null;
  valueChanged: boolean;
}> {
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
    const expectedLength = state.doc.length - (to - from) + insert.length;
    if (value.length !== expectedLength) {
      throw new Error('document-text-change-value-length-mismatch');
    }
    const valueChanged =
      to - from !== insert.length
      || state.doc.sliceString(from, to) !== insert;
    return {
      resolvedChanges: valueChanged ? changes : null,
      valueChanged
    };
  }
  const currentValue = state.doc.toString();
  const valueChanged = value !== currentValue;
  return {
    resolvedChanges: valueChanged ? localTextChange(currentValue, value) : null,
    valueChanged
  };
}

export function selectionEquals(
  left: DocumentSelection,
  right: DocumentSelection
): boolean {
  return (
    left.start === right.start
    && left.end === right.end
    && left.direction === right.direction
  );
}

export function buildNativeSyncTransactionSpec(
  currentValue: string,
  value: string,
  selection: DocumentSelection,
  valueChanged: boolean
) {
  return {
    annotations: [
      Transaction.addToHistory.of(valueChanged),
      Transaction.userEvent.of('input')
    ],
    ...(valueChanged
      ? {
        effects: [canonicalHistorySelectionEffect.of({
          inverse: null,
          selection: null
        })]
      }
      : {}),
    selection: editorSelection(selection, value.length),
    ...(valueChanged
      ? { changes: { from: 0, to: currentValue.length, insert: value } }
      : {})
  };
}

export function buildApplyTextChangeTransactionSpec(input: Readonly<{
  carryHistorySelectionWithoutEvent: boolean;
  docLength: number;
  historySelectionBefore: DocumentSelection | undefined;
  isolateHistoryBefore: boolean;
  joinPreviousHistory: boolean;
  recordHistorySelection: boolean;
  resolvedChanges: DocumentTextChangeRange | null;
  selection: DocumentSelection;
  selectionBefore: DocumentSelection;
  value: string;
  valueChanged: boolean;
}>) {
  return {
    annotations: [
      Transaction.addToHistory.of(input.valueChanged),
      Transaction.userEvent.of(input.joinPreviousHistory ? 'input.type' : 'input'),
      ...(input.valueChanged && input.isolateHistoryBefore
        ? [isolateHistory.of('before')]
        : [])
    ],
    ...(input.resolvedChanges ? { changes: input.resolvedChanges } : {}),
    ...(input.valueChanged
      ? {
        effects: [canonicalHistorySelectionEffect.of({
          inverse: input.recordHistorySelection || input.carryHistorySelectionWithoutEvent
            ? normalizedSelection(
                input.historySelectionBefore ?? input.selectionBefore,
                input.docLength
              )
            : null,
          selection: input.recordHistorySelection || input.carryHistorySelectionWithoutEvent
            ? normalizedSelection(input.selection, input.value.length)
            : null
        })]
      }
      : {}),
    selection: editorSelection(input.selection, input.value.length)
  };
}
