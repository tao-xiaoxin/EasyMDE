import { useCallback, useLayoutEffect, useRef, useState } from '@wordpress/element';

import { type ChangeDesc, ChangeSet } from '@codemirror/state';

import type { ToolbarCommand } from '../../../contracts/bootstrap/toolbar-bootstrap';
import type { PreviewEditMap } from '../../../contracts/ports/preview-request';
import {
  type VisualProtectedNodeAttribute,
  prepareVisualProtectedNodeAdoption,
  visualProtectedNodeAttributes,
  visualProtectedNodeAttributesEqual
} from '../../../shared/dom/visual-protected-node-adoption';
import {
  isMarkdownTerminalWhitespaceSuffix,
  markdownLineStarts
} from '../../../shared/markdown/markdown-line-model';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import type {
  EditorContextMenuSurfaceSnapshot,
  EditorContextMenuTargetLease
} from '../../editor-context-menu/EditorContextMenuFeature';
import type {
  PreviewGeneratedContentTargetForSelectionRequest,
  PreviewGeneratedContentTargetLease,
  PreviewGeneratedContentTargetPinLease,
  PreviewGeneratedContentTargetRequest,
  PreviewGeneratedPreviewIdentity,
  PreviewImageTargetLease,
  PreviewImageTargetPinLease,
  PreviewImageTargetRequest,
  PreviewImageTargetSelectionRequest,
  PreviewSurfaceStatus
} from '../../live-preview/ui/PreviewSurfaceOwner';
import {
  type AcceptedPasteDocumentBoundary,
  VISUAL_MARKDOWN_READ_ONLY_SELECTOR,
  applyVisualBlockShortcut,
  applyVisualCodeFenceMetadataFromSource,
  applyVisualInlineShortcut,
  applyVisualMarkdownEditIntent,
  applyVisualToolbarCommand,
  assertVisualMarkdownReadOnlySnapshot,
  captureVisualThematicBreakSelection,
  visualStructuralBoundaryCapture,
  resolveVisualStructuralKeyboardContextGap,
  visualStructuralBoundaryBlocks,
  visualStructuralBoundaryRows,
  visualStructuralBoundarySurfaceBlocks,
  visualStructuralBoundaryTokenNear,
  visualStructuralBoundarySelection,
  visualStructuralParagraphInsertion,
  placeVisualStructuralBoundarySelection,
  prepareVisualThematicBreakPointerSelection,
  captureVisualCodeInputSnapshot,
  captureVisualSelection,
  captureVisualMarkdownReadOnlySnapshot,
  classifyVisualSelectionProvenance,
  createVisualImageInteraction,
  createVisualMarkdownSourceRangeFromPreviewEditMap,
  createVisualMarkdownWindowChange,
  createVisualCodeBodyOrdinalsForPreviewBlocks,
  createVisualCodeBodyIntervalsForPreviewBlocks,
  createVisualMarkdownDirectSourceIntervalMap,
  createVisualCodeBodyIntervalForPreviewBlock,
  createVisualMarkdownSourceIntervalMap,
  coversMarkdownUnits,
  expandVisualCodeFenceForBody,
  mapTextBoundaryFromInterval,
  mergeVisualMarkdownChangeDetails,
  normalizeVisualCaretAtDocumentBoundary,
  normalizeVisualCodePlaceholders,
  placeVisualCaretAfterAcceptedCodeFenceAtDocumentEnd,
  placeVisualCaretAtAcceptedPasteDocumentBoundary,
  placeVisualCaretFromSourceOffset,
  prepareVisualTaskListMarkers,
  projectVisualCodeBodySelection,
  projectVisualLiteralFencePrefix,
  projectVisualLiteralParagraphLine,
  isMarkdownFenceOpeningLine,
  projectVisualMarkdownRemovalSelection,
  protectVisualMarkdownReadOnlyRegions,
  reconcileVisualCodeBodyDom,
  restoreVisualCodeFenceFamilies,
  restoreVisualCodeFenceOpenEofMetadata,
  serializeVisualMarkdown,
  serializeVisualMarkdownBlockFragment,
  type VisualCodeBodyInterval,
  type VisualCodeInputSnapshot,
  type VisualMarkdownReadOnlySnapshot,
  type VisualMarkdownMergeEdit,
  type VisualMarkdownMergeResult,
  type VisualMarkdownSourceIntervalMap,
  type VisualStructuralBoundaryBlock,
  type VisualThematicBreakPointerPreparation,
  visualCodeBlockCount,
  visualCodeBlockStructureSignature,
  visualCodeBodyDomOffset,
  visualCodeBodyIntervals,
  visualCodeBodyIntervalMap,
  visualCodeBodyIntervalAtOrdinal,
  visualCodeBodyOrdinalForSourceRange,
  visualBoundarySourceOffset,
  visualCaretBoundaryFromSourceOffset,
  visualCodeFenceRootSourceOffset,
  visualEmptyStructuralBodySelection,
  visualSelectionSourceRange,
  visualSelectionSourceRangeForBlocks,
  visualSelectionVisualOffset,
  visualStructuralBodyIsEmpty,
  isVisualThematicBreakSource,
  visualThematicBreakSourceSelection,
  visualThematicBreakTarget,
  visualContextMenuCaretRangeAtPoint
} from '../visual-markdown';

export type ImmersiveVisualEditorRuntime = Readonly<{
  executeCommand: (
    command: ToolbarCommand,
    options?: VisualToolbarCommandOptions
  ) => VisualToolbarCommandResult;
  applyCanonicalChange: (
    request: VisualCanonicalChangeRequest
  ) => VisualToolbarCommandResult;
  getGeneratedPreviewIdentity: () => PreviewGeneratedPreviewIdentity | null;
  isEditable: () => boolean;
  /**
   * Synchronous owner state: the accepted Preview no longer describes the
   * canonical source, so its edit map may not be used to prepare a selection.
   * This covers both an in-flight transfer and the window where the new
   * canonical source is published but its accepted Preview is not installed
   * yet. Context-menu readiness reads this directly instead of a React render
   * value that can lag the owner.
   */
  isTransferPending: () => boolean;
  prepareImageTarget: (
    request: PreviewImageTargetRequest
  ) => PreviewImageTargetLease | null;
  prepareImageTargetBySelection: (
    request: PreviewImageTargetSelectionRequest
  ) => PreviewImageTargetPinLease | null;
  prepareGeneratedContentTarget: (
    request: PreviewGeneratedContentTargetRequest
  ) => PreviewGeneratedContentTargetLease | null;
  prepareGeneratedContentTargetForSelection: (
    request: PreviewGeneratedContentTargetForSelectionRequest
  ) => PreviewGeneratedContentTargetPinLease | null;
  /**
   * The pure preflight a demand runs exactly once, before this owner captures
   * its target: settle the user-authored native input this owner already
   * accepted, then report whether the document is still this owner's to
   * describe. It requests no render, maps no target, and places no selection.
   * An existing pending Preview alone is not a preflight failure, because the
   * demand parks on readiness for that render instead; a pending input that
   * cannot settle is a real failure this owner has already reported exactly
   * once, so callers must not report it again.
   */
  prepareContextMenuDemand: () => boolean;
  /**
   * Capture the logical block - and the exact subtarget - that the user's one
   * gesture addressed, as a witness in the current canonical source. Capture
   * is pure: no selection placement, no document write, no render request. It
   * runs once per initial gesture, after `prepareContextMenuDemand`.
   *
   * `resolve` returns the element that block became in the accepted render for
   * the same source, so a formal re-authentication that renumbers roots or
   * replaces nodes still yields the block the user pointed at. It returns null
   * for a released, replaced, foreign, ambiguous, or stale target, which
   * callers must treat as the target being lost - never as permission to fall
   * back to the pre-render element or to an old coordinate.
   */
  captureContextMenuTarget: (
    target: Element | null
  ) => EditorContextMenuTargetLease | null;
  prepareMediaSelection: () => boolean;
  prepareContextMenuSelection?: (
    target?: Element | null,
    point?: Readonly<{ x: number; y: number }>,
    activation?: 'keyboard' | 'pointer'
  ) => boolean;
  /**
   * True when the accepted Preview cannot be shown to describe the current
   * canonical source - this owner committed a local edit it could not prove
   * line-preserving, or a previous document's render still stands beside a new
   * source. A demand calls `refreshAcceptedPreview` instead of refusing: the
   * refresh requests the formal Preview for the current canonical source, the
   * demand stays parked on readiness, and the same gesture completes once that
   * render is accepted. A foreign DOM change, an unknown canonical revision,
   * or a lost transfer is not refreshable and still fails explicitly.
   */
  needsAcceptedPreviewRefresh?: () => boolean;
  /**
   * Request the formal Preview for the current canonical source, supplying the
   * canonical revision, native history, and selection the acceptance must
   * match, and keep the owner in a pending transfer until that render is
   * accepted. Returns false when the source is not a trusted staleness, which
   * callers must report as an explicit failure rather than retrying.
   */
  refreshAcceptedPreview?: () => boolean;
  prepareSourceNavigation: (
    expected: Readonly<{ revision: number; value: string }>
  ) => boolean;
  prepareToolbarFallback: () => boolean;
  surface: HTMLElement;
}>;

export type VisualToolbarCommandResult =
  | 'blocked'
  | 'failed'
  | 'handled'
  | 'unsupported';

export type VisualToolbarCommandOptions = Readonly<{
  requestPreviewTransfer?: boolean;
}>;

export type VisualCanonicalChangeRequest = Readonly<{
  change: Readonly<{
    changes: Readonly<{ from: number; insert: string; to: number }>;
    selection: Readonly<{
      direction: 'backward' | 'forward' | 'none';
      end: number;
      start: number;
    }>;
    selectionFallback?: 'caret' | 'reflow-caret';
    value: string;
  }>;
  expected: Readonly<{
    revision: number;
    selection: Readonly<{
      direction: 'backward' | 'forward' | 'none';
      end: number;
      start: number;
    }>;
    value: string;
  }>;
}>;

export function assertVisualCanonicalChangeRequest(
  request: VisualCanonicalChangeRequest,
  currentRevision: number | undefined,
  currentValue: string,
  currentSelection: Readonly<{
    direction: 'backward' | 'forward' | 'none';
    end: number;
    start: number;
  }>
): void {
  if (
    !Number.isSafeInteger(request.expected.revision) ||
    request.expected.revision < 0 ||
    undefined === currentRevision ||
    currentRevision !== request.expected.revision ||
    currentValue !== request.expected.value ||
    currentSelection.direction !== request.expected.selection.direction ||
    currentSelection.start !== request.expected.selection.start ||
    currentSelection.end !== request.expected.selection.end
  ) {
    throw new Error('visual-editor-canonical-change-stale');
  }
  const { from, insert, to } = request.change.changes;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > currentValue.length ||
    request.change.value !==
      currentValue.slice(0, from) + insert + currentValue.slice(to) ||
    !Number.isInteger(request.change.selection.start) ||
    !Number.isInteger(request.change.selection.end) ||
    request.change.selection.start < 0 ||
    request.change.selection.end < request.change.selection.start ||
    request.change.selection.end > request.change.value.length
  ) {
    throw new Error('visual-editor-canonical-change-invalid');
  }
}

export type ImmersiveWindowAcceptedSnapshot = Readonly<{
  blocks: ReadonlyArray<
    Readonly<{
      id: string;
      innerHTML: string;
      node: HTMLElement;
    }>
  >;
  /** Formal ledger and canonical revision published with these exact nodes. */
  editMap?: PreviewEditMap;
  sourceRevision?: number;
  key: number;
  nodes: ReadonlyArray<Node>;
  /** Owner-certified physical gap; never a formal edit-map row. */
  ownedGap?: HTMLElement;
  revision: number;
  signature: string;
}>;

export type VisualPreviewSnapshot = Readonly<{
  editMap?: PreviewEditMap | null;
  revision: number;
  signature: string;
}>;

export type ImmersiveVisualEditorProps = Readonly<{
  documentSession: EditorDocumentSession;
  imageUploadEnabled: boolean;
  imagePasteUploadEnabled: boolean;
  onCanonicalDocumentChange: () => void;
  onDiagnostic: (code: string) => void;
  onDispose: (runtime: ImmersiveVisualEditorRuntime) => void;
  onFailure: (code: string) => void;
  onMarkdownChange: () => void;
  onPendingChange: (pending: boolean) => void;
  onReady: (runtime: ImmersiveVisualEditorRuntime) => void;
  onTransferFailure: () => void;
  pending: boolean;
  /**
   * Incremented by the unlock owner when it enables visual editing. The
   * activation effect consumes it once to restore the canonical selection;
   * a plain mount (first entry, remount for another reason) never re-selects.
   */
  resumeCanonicalSelectionToken?: number;
  getGeneratedPreviewIdentity?: () => PreviewGeneratedPreviewIdentity | null;
  prepareImageTarget?: (
    request: PreviewImageTargetRequest
  ) => PreviewImageTargetLease | null;
  prepareImageTargetBySelection?: (
    request: PreviewImageTargetSelectionRequest
  ) => PreviewImageTargetPinLease | null;
  prepareGeneratedContentTarget?: (
    request: PreviewGeneratedContentTargetRequest
  ) => PreviewGeneratedContentTargetLease | null;
  prepareGeneratedContentTargetForSelection?: (
    request: PreviewGeneratedContentTargetForSelectionRequest
  ) => PreviewGeneratedContentTargetPinLease | null;
  acceptedWindowSnapshotGeneration?: number;
  getAcceptedWindowSnapshot?: () => ImmersiveWindowAcceptedSnapshot | null;
  previewSnapshot: VisualPreviewSnapshot;
  previewStatus: PreviewSurfaceStatus;
  requestPreview: (markdown: string) => string;
  surface: HTMLElement;
}>;

/**
 * The one canonical expectation a pending transfer is created against. A
 * transfer proves exactly the facets it records: its source value and placement
 * selection always, the native history depths whenever it was created from a
 * canonical or history command, and the canonical revision only where the owner
 * actually has that capability. An absent revision is a truthful absence, never
 * a match against zero.
 */
type FullCanonicalExpectation = Readonly<{
  history?: DocumentHistoryState;
  revision?: number;
  selection: VisualSelectionSourceRange;
  value: string;
}>;

/** Which expectation facets a consumption boundary actually re-proves. */
type FullCanonicalExpectationFacets = Readonly<{
  history: boolean;
  revision: boolean;
  selection: boolean;
  value: boolean;
}>;

/** The canonical state read for one expectation comparison. */
type FullCanonicalObservation = Readonly<{
  history?: DocumentHistoryState;
  revision?: number;
  selection?: VisualSelectionSourceRange;
  value?: string;
}>;

/**
 * Where acceptance places the native caret, in the owner's real precedence
 * order: a paste's own document boundary wins over an accepted Preview map, and
 * a plain source projection is used only when neither is present.
 */
type FullPendingPlacement =
  | Readonly<{
      boundary: AcceptedPasteDocumentBoundary;
      kind: 'paste-boundary';
    }>
  | Readonly<{ kind: 'accepted-preview' }>
  | Readonly<{ kind: 'source' }>;

/**
 * The known-history proofs a native Undo/Redo replay carries: the exact
 * rematerialize slot a rebuild target was proved from, and the accepted table
 * presentation a replay may retain or normalize.
 */
type FullPendingHistoryProof = Readonly<{
  slot?: Readonly<{ depth: number; value: VisualHistorySlot }>;
  tablePresentation?: FullHistoryTablePresentation;
  emptyParagraph?: Readonly<{
    continuity?: FullRemountEmptyParagraphContinuity;
    depth: number;
    owner: object;
    slot?: VisualHistorySlot;
    sourceOffset: number;
  }>;
}>;
type FullRemountEmptyParagraphContinuity = Readonly<{
  depth: number;
  markdown: string;
  sourceOffset: number;
  historyUndoDepth: number;
}>;

const fullRemountEmptyParagraphContinuity =
  new WeakMap<object, FullRemountEmptyParagraphContinuity>();

/**
 * One pending transfer, named by the trust contract it is created under:
 * `paste` is the ordinary Markdown transfer, `native` is a canonical edit's
 * accepted-Preview adoption, and `history` is a native Undo/Redo replay. Only
 * the variant that needs a proof carries it.
 *
 * The publisher, not the caller, captures the presentation instant: the
 * previous accepted Preview identity, the native focus owner and the
 * presentation selection. The spec names only the capture policy.
 */
type FullPendingTransferSpec = Readonly<{
  /** The operation-bound descriptor that survives later known writes. */
  correspondence?: FullPendingDomCorrespondence;
  /** The one canonical expectation acceptance and pending input re-prove. */
  expectation: FullCanonicalExpectation;
  /** The proof a known-history table replay requires. */
  historyProof?: FullPendingHistoryProof;
  kind: 'history' | 'native' | 'paste';
  /** Where acceptance places this transfer's native caret. */
  placement: FullPendingPlacement;
  /**
   * How the native caret is captured, and therefore whether the owner's own
   * immediately preceding single-line insertion may advance it: the structural
   * gap witness of the owner's own commit, or the plain native selection of a
   * history replay.
   */
  presentation: 'plain' | 'structural';
  /** The accepted replacement this placement must stay inside. */
  replacement?: CanonicalReplacementBoundary;
  /** The accepted-source fallback this transfer may use for its caret. */
  selectionFallback?: 'caret' | 'reflow-caret';
  /** The trusted origin an accepted-selection transition re-authenticates. */
  selectionOrigin?: FullAcceptedSelectionOrigin;
}>;

type PendingMarkdownTransfer = Readonly<{
  focusOwner?: Element | null;
  phase: 'rendering' | 'requesting';
  previousPreview: Readonly<{ revision: number; signature: string }>;
  restoreFocus?: boolean;
  signature: string;
  spec: FullPendingTransferSpec;
  visualSelection: VisualHistorySelection | null;
}>;

type CanonicalReplacementBoundary = Readonly<{
  blockId: string;
  caretOffset: number;
	caretPath: ReadonlyArray<number>;
	postSelection: VisualSelectionSourceRange;
	postSourceRange: Readonly<{ end: number; start: number }>;
	serializedBlock: string;
	sourceBlockMarkdown: string;
  sourceRange: Readonly<{ end: number; start: number }>;
}>;

type NativeTextReplacementBoundary = Readonly<{
  end: number;
  path: ReadonlyArray<number>;
  start: number;
}>;

type VisualSelectionSourceRange = Readonly<{
  direction: 'backward' | 'forward' | 'none';
  end: number;
  start: number;
}>;

/**
 * The frozen metadata of one top-level node of an owned surface. Element
 * attributes and data-node bytes are captured at publication, because the live
 * node's own attributes would otherwise be the very mutation a later
 * comparison is meant to detect.
 */
type FullOwnedNodeMetadata =
  | Readonly<{
      attributes: ReadonlyArray<VisualProtectedNodeAttribute>;
      kind: 'element';
      localName: string;
      namespaceURI: string | null;
    }>
  | Readonly<{
      data: string | null;
      kind: 'data';
      nodeType: number;
    }>;

/**
 * The verified current DOM/source pairing of this owner: the node ledger it
 * published at a real owner operation, with immutable metadata. It is not a
 * document store - `source`/`visual` are the existing strings.
 */
type FullOwnedDom = Readonly<{
  metadata: ReadonlyArray<FullOwnedNodeMetadata>;
  nodes: ReadonlyArray<Node>;
  owner: object;
  source: string;
  sourceRevision: number;
  visual: string;
}>;

/**
 * A formal accepted PRE's source interval, retained by the exact PRE node that
 * the accepted render installed. This is a correspondence, not an ordinal
 * cache: a real canonical change may remove a neighboring code block and move
 * the surviving interval while the PRE identity stays mounted.
 */
type FullAcceptedCodeBodyCorrespondence = Readonly<{
  blockId: string;
  interval: VisualCodeBodyInterval;
  owner: object;
  source: string;
  sourceRevision: number;
  structureSignature: string;
}>;

/** The formal Preview origin an owned pairing still descends from. */
type FullMapCertificate = Readonly<{
  editMap: PreviewEditMap;
  html: string;
  nodes: ReadonlyArray<Node>;
  owner: object;
  previewRevision: number;
  previewSignature: string;
  source: string;
  sourceRevision: number;
  visual: string;
}>;

type FullMapApplicability = 'current' | 'invalid' | 'refresh';

/**
 * Why this owner needs exactly one more formal re-authentication for a document.
 * The reason is part of the one-attempt key, because they are different states:
 * an unproved origin and a stale known identity are expected to become current
 * after acceptance, while an absent identity is a capability the owner does not
 * supply at all.
 */
type FullRefreshReason = 'absent' | 'origin' | 'stale';

type FullSourceRow = Readonly<{
  editable: boolean;
  end: number;
  id: string;
  start: number;
}>;

type FullContextSubtarget =
  | Readonly<{ kind: 'root' }>
  | Readonly<{ interval: VisualCodeBodyInterval; kind: 'code' }>
  | Readonly<{ alt: string; kind: 'image'; ordinal: number; src: string }>
  | Readonly<{
      end: number;
      href: string;
      kind: 'link';
      ordinal: number;
      start: number;
    }>
  | Readonly<{ kind: 'math' | 'mermaid'; ordinal: number; source: string }>;

/**
 * One gesture's witness in the CURRENT canonical source. It is a source range
 * plus a descriptor of the addressed DOM subtarget - never a document copy.
 */
type FullContextSourceWitness = Readonly<{
  anchor: Readonly<{ end: number; start: number }>;
  capturedKind: string;
  capturedPreviewRevision: number;
  capturedPreviewSignature: string;
  capturedRoot: HTMLElement;
  extent: Readonly<{ end: number; start: number }>;
  owner: object;
  selection: VisualSelectionSourceRange;
  selectionWasDeliberateRange: boolean;
  source: string;
  sourceRevision: number;
  subtarget: FullContextSubtarget;
}>;

type FullAcceptedSelectionOrigin = Readonly<{
  extent: Readonly<{ end: number; start: number }>;
  kind: string;
  owner: object;
  selection: VisualSelectionSourceRange;
  source: string;
  sourceRevision: number;
}>;

/** Issued only by a proved accepted paragraph-to-table normalization. */
type FullAcceptedTablePresentation = Readonly<{
  extent: Readonly<{ end: number; start: number }>;
  offset: number;
  owner: object;
  source: string;
}>;

/** One actual native history command targeting an existing source-owned slot. */
type FullHistoryTablePresentation = Readonly<{
  canNormalize: boolean;
  depth: number;
  history: DocumentHistoryState;
  originSource: string;
  owner: object;
  presentation: FullAcceptedTablePresentation;
  revision: number;
  selection: VisualSelectionSourceRange;
  slot: VisualHistorySlot;
}>;

/**
 * The actual canonical splice an already-pending transfer was created from.
 * Only the numeric descriptor is retained: the inserted Text itself stays in
 * the document and its history.
 */
type FullPendingDomCorrespondence = Readonly<{
  change: ChangeDesc;
  history: DocumentHistoryState;
  insertionOwner: HTMLElement | null;
  origin: FullOwnedDom;
  owner: object;
  source: string;
  sourceRevision: number;
}>;

/**
 * One owner presentation normalization, armed only around the real synchronous
 * canonical selection write. The lease reads it exactly once.
 */
type FullAcceptedSelectionPublication = {
  active: boolean;
  readonly after: EditorContextMenuSurfaceSnapshot;
  readonly before: EditorContextMenuSurfaceSnapshot;
  consumed: boolean;
  readonly editMap: PreviewEditMap;
  readonly extent: Readonly<{ end: number; start: number }>;
  readonly history: DocumentHistoryState;
  readonly lease: EditorContextMenuTargetLease;
  readonly owner: object;
  readonly previewRevision: number;
  readonly previewSignature: string;
  readonly root: HTMLElement;
  readonly transfer: PendingMarkdownTransfer;
};

type FullContextLeaseState = {
  lease: EditorContextMenuTargetLease;
  publication: FullAcceptedSelectionPublication | null;
  released: boolean;
  witness: FullContextSourceWitness;
};

type FullResolvedContextTarget = {
  /** The fresh semantic element this resolve proved (an image, a TABLE, ...). */
  readonly element: Element;
  readonly extent: Readonly<{ end: number; start: number }>;
  readonly map: PreviewEditMap;
  /**
   * Whether this binding's one changed-kind whole-row publication has already
   * happened. Preparation is re-entrant for the same gesture, and the user may
   * legitimately place a caret inside the accepted row afterwards; the
   * whole-row expansion belongs to the transition, not to every later
   * preparation of the same binding.
   */
  published: boolean;
  readonly root: HTMLElement;
  readonly signature: string;
  readonly witness: FullContextSourceWitness;
};

/**
 * One short-lived native structural transition: the typed fallback for
 * `insertParagraph` inside a direct paragraph. The browser owns that split, so
 * the provenance is the captured addressed root, its exact range and the two
 * expected fragment serializations - not a new mutation observer.
 */
type FullPendingNativeRootTransition = {
  readonly kind: 'split';
  candidate: Readonly<{
    metadata: ReadonlyArray<FullOwnedNodeMetadata>;
    nodes: ReadonlyArray<Node>;
  }> | null;
  readonly afterFragment: string;
  readonly beforeFragment: string;
  readonly originalRoot: HTMLElement;
  readonly owner: object;
  readonly range: Readonly<{
    endNode: Node;
    endOffset: number;
    startNode: Node;
    startOffset: number;
  }>;
  readonly source: string;
  readonly sourceRevision: number;
  readonly sourceOffset: number | null;
  readonly visual: string;
  readonly windowIndex: number;
  splitOrder: 'after' | 'before' | null;
};

/**
 * One short-lived native EOF join: Backspace at the start of an empty
 * paragraph whose default merges it into the preceding code block. The
 * provenance is the browser's own target range; it is consumed once and never
 * reconstructed after the mutation.
 */
type FullPendingNativeRootJoin = {
  readonly kind: 'join';
  candidate: Readonly<{
    metadata: ReadonlyArray<FullOwnedNodeMetadata>;
    nodes: ReadonlyArray<Node>;
  }> | null;
  readonly interRoot: ReadonlyArray<Node>;
  readonly hasFollowingRoot: boolean;
  readonly joinRoot: HTMLElement;
  readonly lineEndingLength: number;
  readonly owner: object;
  readonly preRoot: HTMLElement;
  readonly preRootSerialization: string | null;
  readonly sharedTerminal: boolean;
  readonly source: string;
  readonly sourceRevision: number;
  readonly sourceRange?: Readonly<{ end: number; start: number }>;
  readonly terminal: Text | null;
  readonly terminalBefore: string;
  readonly windowIndex: number;
};

/** The literal-text grammar one whole plain paragraph line must match. */
const FULL_LITERAL_TEXT_LINE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} ,!?;]*$/u;

function fullOwnedNodeMetadata(node: Node): FullOwnedNodeMetadata {
  if (node instanceof HTMLElement) {
    return {
      attributes: visualProtectedNodeAttributes(node),
      kind: 'element',
      localName: node.localName,
      namespaceURI: node.namespaceURI
    };
  }
  return { data: node.nodeValue, kind: 'data', nodeType: node.nodeType };
}

function fullOwnedNodeMetadataEqual(
  current: FullOwnedNodeMetadata,
  expected: FullOwnedNodeMetadata
): boolean {
  if ('element' === current.kind && 'element' === expected.kind) {
    return (
      current.localName === expected.localName
      && current.namespaceURI === expected.namespaceURI
      && visualProtectedNodeAttributesEqual(
        current.attributes,
        expected.attributes
      )
    );
  }
  if ('data' === current.kind && 'data' === expected.kind) {
    return (
      current.nodeType === expected.nodeType
      && current.data === expected.data
    );
  }
  return false;
}

/**
 * Whether the live surface is still the exact node ledger this owner verified:
 * same node objects in the same order, with their frozen attributes and data.
 */
function fullOwnedDomMatches(
  surface: HTMLElement,
  owned: FullOwnedDom
): boolean {
  const nodes = Array.from(surface.childNodes);
  if (nodes.length !== owned.nodes.length) return false;
  return nodes.every((node, index) => {
    const expected = owned.metadata[index];
    return (
      node === owned.nodes[index]
      && undefined !== expected
      && fullOwnedNodeMetadataEqual(fullOwnedNodeMetadata(node), expected)
    );
  });
}

/**
 * Whether an accepted map names every mounted top-level ELEMENT, in order.
 * Inter-root separators are Text nodes, so a map only ever names elements; a
 * mounted element the map does not name at that position (a generated root) is
 * an inventory this owner cannot certify. A missing id is the ordinary
 * not-yet-adopted shape and is not by itself an unmapped render.
 */
function fullMapNamesElements(
  surface: HTMLElement,
  editMap: PreviewEditMap
): boolean {
  const elements = Array.from(surface.children);
  if (elements.length !== editMap.blocks.length) return false;
  return elements.every((element, index) => {
    const id = element.getAttribute('data-easymde-visual-block-id');
    return null === id || id === editMap.blocks[index]?.id;
  });
}

/** A row's content extent: at most its own one terminal line terminator goes. */
function fullRowContentExtent(
  source: string,
  row: FullSourceRow
): Readonly<{ end: number; start: number }> {
  const terminator = /(?:\r\n|\n|\r)$/u.exec(
    source.slice(row.start, row.end)
  );
  return {
    end: row.end - (terminator?.[0].length ?? 0),
    start: row.start
  };
}

/** Whether a complete canonical row body is one or more literal text lines. */
function fullLiteralTextBody(body: string): boolean {
  const lines = body.split(/\r\n|\n|\r/u);
  return (
    0 < lines.length
    && lines.every(
      (line) => FULL_LITERAL_TEXT_LINE.test(line) && !/[\t ]$/u.test(line)
    )
  );
}

/**
 * Whether a live root is a direct paragraph containing only literal Text nodes.
 * Normalization may merge or split those nodes. No element, line break or
 * inline protected wrapper is admitted, so a browser-inserted placeholder BR
 * keeps the row unproved and it formally refreshes instead.
 */
function fullLiteralParagraphRoot(root: HTMLElement | null): boolean {
  return Boolean(
    root
    && 'P' === root.tagName
    && Array.from(root.childNodes).every(
      (node) =>
        node.nodeType === Node.TEXT_NODE
        // A raw line break inside a paragraph's own text is not the formal
        // paragraph shape: the renderer emits one paragraph per line, so such a
        // Text node cannot be the accepted root this proof compares against.
        && !/[\r\n]/u.test((node as Text).data)
    )
  );
}

/**
 * The one fenced interval covering a whole row slice, or null. The row slice is
 * disjoint from every other row, so this never reads the whole document and
 * never guesses a global code-block ordinal.
 */
function fullFenceRowInterval(
  source: string,
  row: FullSourceRow
): VisualCodeBodyInterval | null {
  if (!row.editable) return null;
  const slice = source.slice(row.start, row.end);
  let interval: VisualCodeBodyInterval;
  try {
    interval = visualCodeBodyIntervalAtOrdinal(slice, 0);
  } catch {
    return null;
  }
  if (
    0 !== interval.codeOrdinal
    || 0 !== interval.sourceBlockStart
    || slice.length !== interval.sourceBlockEnd
  ) return null;
  // An open fence's "EOF" is only a real document end when this row really
  // reaches it; a row slice is never allowed to pretend a crop is the end.
  if (!interval.closed && row.end !== source.length) return null;
  const opener = slice.slice(interval.sourceBlockStart, interval.bodyStart);
  const openerLine = opener.split(/\r\n|\n|\r/u)[0] ?? '';
  // Only a direct fence with 0-3 ordinary spaces of indentation is this proof's
  // domain: a container prefix or an indented code block is a different kind.
  if (!/^ {0,3}(?:`{3,}|~{3,})/u.test(openerLine)) return null;
  const closeLine = interval.closed
    ? slice.slice(interval.bodyEnd, interval.sourceBlockEnd)
    : '';
  if (
    interval.closed
    && !/^(?: {0,3})(?:`{3,}|~{3,})[ \t]*(?:\r\n|\n|\r)?$/u.test(closeLine)
  ) return null;
  const body = slice.slice(interval.bodyStart, interval.bodyEnd);
  const lines = body.split(/\r\n|\n|\r/u);
  const contentLines =
    interval.closed && '' === lines[lines.length - 1]
      ? lines.slice(0, -1)
      : lines;
  if (
    !contentLines.every(
      (line) =>
        '' === line
        || (FULL_LITERAL_TEXT_LINE.test(line) && !/[\t ]$/u.test(line))
    )
  ) return null;
  return interval;
}

/**
 * One unchanged blank-line separator between two top-level rows. Any other
 * gap shape - a row abutting a neighbour with no separating blank line, or
 * non-blank bytes the commit never accounted for - is not boundary evidence.
 */
function fullBlankLineSeparator(gap: string): boolean {
  // Between two rows the shared projector already consumed the first row's
  // terminal terminator, so a single blank line leaves exactly ONE remaining
  // line break here. The gap must be whitespace and must contain one.
  return /^\s*(?:\r\n|\n|\r)\s*$/u.test(gap);
}

function fullNativeJoinSeparator(
  source: string,
  start: number,
  hasFollowingRoot: boolean
): Readonly<{ end: number; lineEnding: string }> | null {
  const suffix = source.slice(start);
  const pattern = hasFollowingRoot
    ? /^[ \t]*(?:\r\n|\r|\n)(?:[ \t]*(?:\r\n|\r|\n))+/u
    : /^[ \t]*(?:(?:\r\n|\r|\n)[ \t]*)+$/u;
  const separator = pattern.exec(suffix)?.[0] ?? '';
  const lineEnding = /\r\n|\r|\n/u.exec(separator)?.[0] ?? '';
  if (!separator || !lineEnding) return null;
  return { end: start + separator.length, lineEnding };
}

/**
 * The positive formal-stability domain: both complete canonical row bodies and
 * their roots stay inside a syntax class the formal renderer cannot promote
 * into another block kind. Anything outside it is unproved, not invalid.
 */
function fullPositiveRowDomain(
  beforeSource: string,
  beforeRow: FullSourceRow,
  beforeRoot: HTMLElement | null,
  afterSource: string,
  afterRow: FullSourceRow,
  afterRoot: HTMLElement | null,
  edits: ReadonlyArray<Readonly<{ end: number; replacement: string; start: number }>>,
  boundariesProved: boolean
): boolean {
  // Both outer boundaries must be document edges or unchanged blank-line
  // separators. Without that evidence a literal paragraph row could be
  // concatenating with a neighbour whose own kind is not part of this proof.
  if (!boundariesProved) return false;
  const beforeBody = beforeSource.slice(
    fullRowContentExtent(beforeSource, beforeRow).start,
    fullRowContentExtent(beforeSource, beforeRow).end
  );
  const afterBody = afterSource.slice(
    fullRowContentExtent(afterSource, afterRow).start,
    fullRowContentExtent(afterSource, afterRow).end
  );
  // A blank row is not a literal paragraph; an empty half is allowed, because
  // the browser's own empty paragraph is the supported split shape.
  if (
    fullLiteralParagraphRoot(beforeRoot)
    && fullLiteralParagraphRoot(afterRoot)
    && ('' === beforeBody || fullLiteralTextBody(beforeBody))
    && ('' === afterBody || fullLiteralTextBody(afterBody))
    && edits.every(
      (edit) => !/[\r\n]/u.test(edit.replacement)
    )
  ) return true;
  const beforeFence = fullFenceRowInterval(beforeSource, beforeRow);
  const afterFence = fullFenceRowInterval(afterSource, afterRow);
  if (
    !beforeFence
    || !afterFence
    || 'PRE' !== beforeRoot?.tagName
    || 'PRE' !== afterRoot?.tagName
    || beforeFence.fence !== afterFence.fence
    || beforeFence.info !== afterFence.info
    || beforeFence.closed !== afterFence.closed
    || beforeFence.lineEnding !== afterFence.lineEnding
  ) return false;
  // Every atomic edit has to be inside the actual body: an edited opener,
  // closer or info string would move the topology the fence owns. These edits
  // are expressed relative to the row's own slice (the same space
  // `beforeFence.bodyStart/bodyEnd` are measured in), never in document
  // coordinates.
  return edits.every(
    (edit) =>
      !/[\r\n]/u.test(edit.replacement)
      && edit.start >= beforeFence.bodyStart
      && edit.end <= beforeFence.bodyEnd
  );
}

/** The number of bytes one change set moved before a source offset. */
function fullChangeDeltaAt(change: ChangeDesc, offset: number): number {
  let delta = 0;
  change.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (toA <= offset) delta += (toB - fromB) - (toA - fromA);
    else if (fromA < offset) delta = Number.NaN;
  });
  return delta;
}

/**
 * Transport one origin source extent through an actual canonical splice. Only
 * the real operation's numeric descriptor decides what survived: a removal or
 * replacement overlapping the target loses it, a foreign insertion inside it is
 * ambiguous, and a pure insertion owned by the target extends it.
 */
export function fullTransportedExtent(
  correspondence: FullPendingDomCorrespondence,
  extent: Readonly<{ end: number; start: number }>,
  insertionOwner: HTMLElement | null
): Readonly<{ end: number; start: number }> | null {
  const { change, origin, source: currentSource } = correspondence;
  const ownedInsertion = null !== insertionOwner;
  const overlapsRemoval = (() => {
    let removed = false;
    change.iterChangedRanges((fromA, toA) => {
      if (fromA === toA) return;
      if (fromA < extent.end && toA > extent.start) removed = true;
    });
    return removed;
  })();
  if (overlapsRemoval) return null;
  // A pure insertion inside the target belongs to it only when this root
  // actually owns the operation. Without that proof the interior content is
  // unknown, so the window is not an unaffected survivor.
  let unownedInteriorInsertion = false;
  change.iterChangedRanges((fromA, toA) => {
    if (fromA !== toA || ownedInsertion) return;
    if (fromA > extent.start && fromA < extent.end) {
      unownedInteriorInsertion = true;
    }
  });
  if (unownedInteriorInsertion) return null;
  const start = change.mapPos(extent.start, ownedInsertion ? -1 : 1);
  const end = change.mapPos(extent.end, ownedInsertion ? 1 : -1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start)
    return null;
  // Rebuild the transported window from the origin bytes plus the operation's
  // actual insertions, and require it to equal the current canonical bytes.
  let expected = '';
  let cursor = extent.start;
  let valid = true;
  change.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (!valid) return;
    if (
      fromA !== toA
        ? toA <= extent.start || fromA >= extent.end
        : fromA < extent.start || fromA > extent.end
    ) return;
    if (fromA < cursor) {
      valid = false;
      return;
    }
    expected += origin.source.slice(cursor, fromA);
    if (fromA !== toA) {
      valid = false;
      return;
    }
    if (fromA > extent.start && fromA < extent.end) {
      expected += currentSource.slice(fromB, toB);
    } else if (fromA === extent.start && ownedInsertion) {
      // The same root owns these prefix bytes, including an empty extent.
      expected += currentSource.slice(fromB, toB);
    } else if (fromA === extent.end && ownedInsertion) {
      expected += currentSource.slice(fromB, toB);
    }
    cursor = toA;
  });
  if (!valid) return null;
  expected += origin.source.slice(cursor, extent.end);
  if (currentSource.slice(start, end) !== expected) return null;
  return { end, start };
}

/**
 * The closing fence is the authenticated code-block boundary. The line
 * ending after that fence is document separator state and may be removed when
 * a neighboring EOF block disappears; it must not make the surviving PRE's
 * correspondence fail closed.
 */
function fullCodeBlockSyntaxEnd(
  source: string,
  interval: VisualCodeBodyInterval
): number {
  if (!interval.closed || interval.sourceBlockEnd <= interval.sourceBlockStart) {
    return interval.sourceBlockEnd;
  }
  const trailing = source.slice(
    Math.max(interval.sourceBlockStart, interval.sourceBlockEnd - 2),
    interval.sourceBlockEnd
  );
  const lineEnding = /(?:\r\n|\r|\n)$/u.exec(trailing)?.[0];
  return interval.sourceBlockEnd - (lineEnding?.length ?? 0);
}

/**
 * The canonical descriptor of one actual owner write against the exact source
 * it replaced. `lineSep` is explicit so UTF-16 lengths are literal, never
 * normalized by the adapter.
 */
function fullChangeDescriptor(
  beforeSource: string,
  afterSource: string,
  change: Readonly<{ from: number; insert: string; to: number }>
): ChangeDesc | null {
  let desc: ChangeDesc;
  try {
    const set = ChangeSet.of(
      [{ from: change.from, insert: change.insert, to: change.to }],
      beforeSource.length,
      '\n'
    );
    desc = set.desc;
  } catch {
    return null;
  }
  if (desc.length !== beforeSource.length || desc.newLength !== afterSource.length)
    return null;
  return desc;
}

function fullChangeDescriptorForEdits(
  beforeSource: string,
  afterSource: string,
  edits: ReadonlyArray<VisualMarkdownMergeEdit>
): ChangeDesc | null {
  let desc: ChangeDesc;
  try {
    const changes = edits
      .slice()
      .sort((left, right) => left.start - right.start)
      .map((edit) => ({
        from: edit.start,
        insert: edit.replacement,
        to: edit.end
      }));
    desc = ChangeSet.of(changes, beforeSource.length, '\n').desc;
  } catch {
    return null;
  }
  if (
    desc.length !== beforeSource.length
    || desc.newLength !== afterSource.length
  ) return null;
  return desc;
}

function canonicalChangeRemovesVisualBlock(
  sourceMarkdown: string,
  sourceRange: Readonly<{ end: number; start: number }>,
  change: Readonly<{ from: number; insert: string; to: number }>
): boolean {
  return (
    change.insert === '' &&
    change.from === sourceRange.start &&
    /^\s*$/u.test(sourceMarkdown.slice(change.to, sourceRange.end))
  );
}

function directVisualBlockForSelectionNode(
  surface: HTMLElement,
  node: Node | null
): HTMLElement | null {
  if (!node || !surface.contains(node)) return null;
  let element =
    node instanceof HTMLElement ? node : (node.parentElement ?? null);
  while (element && element.parentElement !== surface) {
    element = element.parentElement;
  }
  return element?.parentElement === surface ? element : null;
}

function acceptedTopLevelVisualChildren(
  surface: HTMLElement,
  editMap: PreviewEditMap
): ReadonlyArray<HTMLElement> {
  const children = Array.from(surface.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
  const seenBlockIds = new Set<string>();
  if (
    children.length !== editMap.blocks.length ||
    children.some((block, index) => {
      const id = block.getAttribute('data-easymde-visual-block-id');
      const expected = editMap.blocks[index]?.id;
      if (!id || id !== expected || seenBlockIds.has(id)) return true;
      seenBlockIds.add(id);
      return false;
    })
  ) {

    throw new Error('visual-editor-selection-map-failed');
  }
  return children;
}

/**
 * The accepted surface certificate: every top-level editable child must still
 * be the exact node the accepted render published, in order, and its content
 * must still serialize to the accepted bytes. `acceptedNodes` is the node list
 * captured with the accepted HTML, so a same-ID replacement row or an
 * unrelated child mutation is refused instead of being re-serialized into an
 * equal-looking value.
 */
function assertAcceptedTopLevelVisualSurface(
  surface: HTMLElement,
  editMap: PreviewEditMap,
  acceptedHtml: string | null,
  acceptedNodes?: ReadonlyArray<Node> | null
): void {
  if (null === acceptedHtml) {
    throw new Error('visual-editor-canonical-change-dom-stale');
  }
  const children = acceptedTopLevelVisualChildren(surface, editMap);
  if (acceptedNodes) {
    const current = Array.from(surface.childNodes);
    if (
      current.length !== acceptedNodes.length
      || current.some((node, index) => node !== acceptedNodes[index])
    ) {
      throw new Error('visual-editor-canonical-change-dom-stale');
    }
  }
  const template = surface.ownerDocument.createElement('article');
  template.innerHTML = acceptedHtml;
  const baselineById = new Map<string, HTMLElement>();
  for (const child of Array.from(template.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const id = child.getAttribute('data-easymde-visual-block-id');
    if (!id || baselineById.has(id)) {
      throw new Error('visual-editor-canonical-change-dom-stale');
    }
    baselineById.set(id, child);
  }
  if (baselineById.size !== children.length) {
    throw new Error('visual-editor-canonical-change-dom-stale');
  }
  for (const child of children) {
    const id = child.getAttribute('data-easymde-visual-block-id');
    const baseline = id ? baselineById.get(id) : null;
    if (
      !baseline ||
      serializeVisualMarkdownBlockFragment([child]) !==
        serializeVisualMarkdownBlockFragment([baseline])
    ) {
      throw new Error('visual-editor-canonical-change-dom-stale');
    }
  }
}

type AcceptedTopLevelVisualWindow = Readonly<{
  blockRange: Readonly<{ end: number; start: number }>;
  /** The accepted map the selected block range was taken from. */
  editMap: PreviewEditMap;
  previewRevision: number;
  previewSignature: string;
  sourceMarkdown: string;
}>;

function captureAcceptedTopLevelVisualWindow(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap | null | undefined,
  previewSignature: string,
  previewRevision: number,
  capturedPreviewRevision: number | null,
  acceptedPreviewSource: string | null
): AcceptedTopLevelVisualWindow | null {
  if (
    !editMap ||
    editMap.signature !== previewSignature ||
    capturedPreviewRevision !== previewRevision ||
    acceptedPreviewSource !== sourceMarkdown ||
    1 !== editMap.version ||
    'line' !== editMap.coordinate
  ) {
    return null;
  }
  // A native-created root may retain a copied id while the accepted map still
  // describes the pre-split surface. This optional window cannot authenticate
  // that topology; leave shortcut ownership to its other proofs instead of
  // invoking the strict duplicate-id assertion below.
  if (!fullMapNamesElements(surface, editMap)) return null;
  const children = acceptedTopLevelVisualChildren(surface, editMap);
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return null;
  const anchorBlock = directVisualBlockForSelectionNode(
    surface,
    selection.anchorNode
  );
  const focusBlock = directVisualBlockForSelectionNode(
    surface,
    selection.focusNode
  );
  if (!anchorBlock || !focusBlock) return null;
  const anchorIndex = children.indexOf(anchorBlock);
  const focusIndex = children.indexOf(focusBlock);
  if (anchorIndex < 0 || focusIndex < 0) return null;
  const start = Math.min(anchorIndex, focusIndex);
  const end = Math.max(anchorIndex, focusIndex) + 1;
  const mapIndices = children
    .slice(start, end)
    .map((block) =>
      editMap.blocks.findIndex(
        (candidate) =>
          candidate.id === block.getAttribute('data-easymde-visual-block-id')
      )
    );
  const firstMapIndex = mapIndices[0];
  const lastMapIndex = mapIndices[mapIndices.length - 1];
  if (
    undefined === firstMapIndex ||
    undefined === lastMapIndex ||
    mapIndices.some((index) => index < 0) ||
    mapIndices.some((index, offset) => index !== firstMapIndex + offset) ||
    editMap.blocks
      .slice(firstMapIndex, lastMapIndex + 1)
      .some((block) => !block.editable)
  ) {
    return null;
  }
  return {
    blockRange: { end: lastMapIndex + 1, start: firstMapIndex },
    editMap,
    previewRevision,
    previewSignature,
    sourceMarkdown
  };
}

function acceptedBaselineBlocksById(
  surface: HTMLElement,
  acceptedHtml: string
): Map<string, HTMLElement> {
  const template = surface.ownerDocument.createElement('article');
  template.innerHTML = acceptedHtml;
  const baselineById = new Map<string, HTMLElement>();
  for (const child of Array.from(template.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const id = child.getAttribute('data-easymde-visual-block-id');
    if (!id || baselineById.has(id)) {

      throw new Error('visual-editor-selection-map-failed');
    }
    baselineById.set(id, child);
  }
  return baselineById;
}

function ownedAcceptedTopLevelVisualMerge(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  acceptedHtml: string,
  acceptedWindow: AcceptedTopLevelVisualWindow
): Readonly<{
  changes: Readonly<{ from: number; insert: string; to: number }>;
  selection: VisualSelectionSourceRange;
  value: string;
}> | null {
  if (
    acceptedWindow.sourceMarkdown !== sourceMarkdown ||
    acceptedWindow.previewSignature !== editMap.signature ||
    acceptedWindow.editMap !== editMap
  ) {
    return null;
  }
  const currentChildren = Array.from(surface.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
  const selectedMapBlocks = editMap.blocks.slice(
    acceptedWindow.blockRange.start,
    acceptedWindow.blockRange.end
  );
  const selectedIds = new Set(selectedMapBlocks.map((block) => block.id));
  const previousId = editMap.blocks[acceptedWindow.blockRange.start - 1]?.id;
  const nextId = editMap.blocks[acceptedWindow.blockRange.end]?.id;
  const previousIndex = previousId
    ? currentChildren.findIndex(
        (child) =>
          child.getAttribute('data-easymde-visual-block-id') === previousId
      )
    : -1;
  const nextIndex = nextId
    ? currentChildren.findIndex(
        (child) => child.getAttribute('data-easymde-visual-block-id') === nextId
      )
    : currentChildren.length;
  if (
    (previousId && previousIndex < 0) ||
    (nextId && nextIndex < 0) ||
    (previousIndex >= 0 && nextIndex <= previousIndex)
  ) {
    return null;
  }
  const spanStart = previousIndex + 1;
  const spanEnd = nextIndex;
  const blocks = currentChildren.slice(spanStart, spanEnd);
  if (
    !blocks.length ||
    !blocks.some((block) => block.classList.contains('markdown-block-applied'))
  ) {
    return null;
  }
  const seenSelectedIds = new Set<string>();
  for (const block of blocks) {
    const id = block.getAttribute('data-easymde-visual-block-id');
    if (id) {
      if (!selectedIds.has(id) || seenSelectedIds.has(id)) return null;
      seenSelectedIds.add(id);
    }
  }
  if (seenSelectedIds.size !== selectedIds.size) return null;
  const baselineById = acceptedBaselineBlocksById(surface, acceptedHtml);
  const expectedOutsideIds = [
    ...editMap.blocks.slice(0, acceptedWindow.blockRange.start),
    ...editMap.blocks.slice(acceptedWindow.blockRange.end)
  ].map((block) => block.id);
  const outside = [
    ...currentChildren.slice(0, spanStart),
    ...currentChildren.slice(spanEnd)
  ];
  if (outside.length !== expectedOutsideIds.length) return null;
  for (const [index, block] of outside.entries()) {
    const id = block.getAttribute('data-easymde-visual-block-id');
    const expectedId = expectedOutsideIds[index];
    const baseline = expectedId ? baselineById.get(expectedId) : null;
    if (
      !id ||
      id !== expectedId ||
      !baseline ||
      serializeVisualMarkdownBlockFragment([block]) !==
        serializeVisualMarkdownBlockFragment([baseline])
    ) {
      return null;
    }
  }
  const baselineBlocks = selectedMapBlocks.map((block) => {
    const baseline = baselineById.get(block.id);
    if (!baseline) throw new Error('visual-editor-selection-map-failed');
    return baseline;
  });
  const baselineSlice = serializeVisualMarkdownBlockFragment(baselineBlocks);
  const editedSlice = serializeVisualMarkdownBlockFragment(blocks);
  const windowChange = createVisualMarkdownWindowChange(
    sourceMarkdown,
    editMap,
    acceptedWindow.blockRange,
    baselineSlice,
    editedSlice
  );
  const relative = visualSelectionSourceRangeForBlocks(
    blocks,
    windowChange.changes.insert,
    editedSlice
  );
  return {
    changes: windowChange.changes,
    selection: {
      direction: relative.direction,
      end: windowChange.sourceRange.start + relative.end,
      start: windowChange.sourceRange.start + relative.start
    },
    value: windowChange.value
  };
}

function acceptedTopLevelVisualSelection(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap | null | undefined,
  previewSignature: string,
  previewRevision: number,
  capturedPreviewRevision: number | null,
  acceptedPreviewSource: string | null
): VisualSelectionSourceRange | null {
  const thematicBreakSelection = captureVisualThematicBreakSelection(surface);
  if (
    !editMap ||
    editMap.signature !== previewSignature ||
    capturedPreviewRevision !== previewRevision ||
    acceptedPreviewSource !== sourceMarkdown ||
    1 !== editMap.version ||
    'line' !== editMap.coordinate
  ) {
    if (thematicBreakSelection) {

      throw new Error('visual-editor-selection-map-failed');
    }
    return null;
  }
  const children = acceptedTopLevelVisualChildren(surface, editMap);
  if (thematicBreakSelection) {
    const blockIndex = children.indexOf(thematicBreakSelection.block);
    const block = blockIndex >= 0 ? editMap.blocks[blockIndex] : undefined;
    if (
      !block
      || block.id !== thematicBreakSelection.block.getAttribute(
        'data-easymde-visual-block-id'
      )
      || !block.editable
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
      sourceMarkdown,
      editMap,
      { end: blockIndex + 1, start: blockIndex }
    );
    return visualThematicBreakSourceSelection(
      sourceMarkdown,
      sourceRange,
      thematicBreakSelection.direction
    );
  }
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !selection.anchorNode.isConnected ||
    !selection.focusNode.isConnected
  ) {
    return null;
  }
  const anchorBlock = directVisualBlockForSelectionNode(
    surface,
    selection.anchorNode
  );
  const focusBlock = directVisualBlockForSelectionNode(
    surface,
    selection.focusNode
  );
  if (!anchorBlock || !focusBlock) return null;
  const anchorIndex = children.indexOf(anchorBlock);
  const focusIndex = children.indexOf(focusBlock);
  if (anchorIndex < 0 || focusIndex < 0) return null;
  const blockStart = Math.min(anchorIndex, focusIndex);
  const blockEnd = Math.max(anchorIndex, focusIndex) + 1;
  const blocks = children.slice(blockStart, blockEnd);
  if (blocks.length !== blockEnd - blockStart) {
    return null;
  }
  const mapIndices = blocks.map((block) =>
    editMap.blocks.findIndex(
      (candidate) =>
        candidate.id === block.getAttribute('data-easymde-visual-block-id')
    )
  );
  const firstMapIndex = mapIndices[0];
  const lastMapIndex = mapIndices[mapIndices.length - 1];
  if (
    undefined === firstMapIndex ||
    undefined === lastMapIndex ||
    mapIndices.some((index) => index < 0) ||
    mapIndices.some((index, offset) => index !== firstMapIndex + offset) ||
    editMap.blocks
      .slice(firstMapIndex, lastMapIndex + 1)
      .some((block) => !block.editable)
  ) {
    return null;
  }
  try {
    const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
      sourceMarkdown,
      editMap,
      {
        end: lastMapIndex + 1,
        start: firstMapIndex
      }
    );
    const sourceSlice = sourceMarkdown.slice(
      sourceRange.start,
      sourceRange.end
    );
    const baselineSlice = serializeVisualMarkdownBlockFragment(blocks);
    const relative = visualSelectionSourceRangeForBlocks(
      blocks,
      sourceSlice,
      baselineSlice
    );
    return {
      direction: relative.direction,
      end: sourceRange.start + relative.end,
      start: sourceRange.start + relative.start
    };
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'visual-editor-selection-unavailable',
        'visual-editor-selection-invalid',
        'visual-editor-window-block-range-invalid',
        'visual-editor-window-source-range-invalid'
      ].includes(error.message)
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    throw error;
  }
}

function acceptedTopLevelVisualMerge(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap | null | undefined,
  previewSignature: string,
  previewRevision: number,
  capturedPreviewRevision: number | null,
  acceptedPreviewSource: string | null,
  acceptedHtml: string | null,
  acceptedWindow: AcceptedTopLevelVisualWindow | null
): Readonly<{
  changes: Readonly<{ from: number; insert: string; to: number }>;
  selection: VisualSelectionSourceRange;
  value: string;
}> | null {
  if (
    !editMap ||
    editMap.signature !== previewSignature ||
    capturedPreviewRevision !== previewRevision ||
    acceptedPreviewSource !== sourceMarkdown ||
    !acceptedHtml ||
    1 !== editMap.version ||
    'line' !== editMap.coordinate
  ) {
    return null;
  }
  let children: ReadonlyArray<HTMLElement>;
  try {
    children = acceptedTopLevelVisualChildren(surface, editMap);
  } catch (error) {
    if (
      !acceptedWindow ||
      acceptedWindow.previewRevision !== previewRevision ||
      acceptedWindow.previewSignature !== previewSignature
    ) {
      throw error;
    }
    return ownedAcceptedTopLevelVisualMerge(
      surface,
      sourceMarkdown,
      editMap,
      acceptedHtml,
      acceptedWindow
    );
  }
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !selection.anchorNode.isConnected ||
    !selection.focusNode.isConnected
  ) {
    return null;
  }
  const anchorBlock = directVisualBlockForSelectionNode(
    surface,
    selection.anchorNode
  );
  const focusBlock = directVisualBlockForSelectionNode(
    surface,
    selection.focusNode
  );
  if (!anchorBlock || !focusBlock) return null;
  const anchorIndex = children.indexOf(anchorBlock);
  const focusIndex = children.indexOf(focusBlock);
  if (anchorIndex < 0 || focusIndex < 0) return null;
  const blockStart = Math.min(anchorIndex, focusIndex);
  const blockEnd = Math.max(anchorIndex, focusIndex) + 1;
  const blocks = children.slice(blockStart, blockEnd);
  const mapIndices = blocks.map((block) =>
    editMap.blocks.findIndex(
      (candidate) =>
        candidate.id === block.getAttribute('data-easymde-visual-block-id')
    )
  );
  const firstMapIndex = mapIndices[0];
  const lastMapIndex = mapIndices[mapIndices.length - 1];
  if (
    undefined === firstMapIndex ||
    undefined === lastMapIndex ||
    mapIndices.some((index) => index < 0) ||
    mapIndices.some((index, offset) => index !== firstMapIndex + offset) ||
    editMap.blocks
      .slice(firstMapIndex, lastMapIndex + 1)
      .some((block) => !block.editable)
  ) {
    return null;
  }
  const template = surface.ownerDocument.createElement('article');
  template.innerHTML = acceptedHtml;
  const baselineById = new Map<string, HTMLElement>();
  for (const child of Array.from(template.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const id = child.getAttribute('data-easymde-visual-block-id');
    if (!id || baselineById.has(id)) {

      throw new Error('visual-editor-selection-map-failed');
    }
    baselineById.set(id, child);
  }
  for (const [index, child] of children.entries()) {
    if (index >= blockStart && index < blockEnd) continue;
    const id = child.getAttribute('data-easymde-visual-block-id');
    const baseline = id ? baselineById.get(id) : null;
    if (
      !baseline ||
      serializeVisualMarkdownBlockFragment([child]) !==
        serializeVisualMarkdownBlockFragment([baseline])
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
  }
  try {
    const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
      sourceMarkdown,
      editMap,
      {
        end: lastMapIndex + 1,
        start: firstMapIndex
      }
    );
    const baselineBlocks = blocks.map((block) => {
      const id = block.getAttribute('data-easymde-visual-block-id');
      const baseline = id ? baselineById.get(id) : null;
      if (!baseline) {

        throw new Error('visual-editor-selection-map-failed');
      }
      return baseline;
    });
    const baselineSlice = serializeVisualMarkdownBlockFragment(baselineBlocks);
    const editedSlice = serializeVisualMarkdownBlockFragment(blocks);
    const windowChange = createVisualMarkdownWindowChange(
      sourceMarkdown,
      editMap,
      { end: lastMapIndex + 1, start: firstMapIndex },
      baselineSlice,
      editedSlice
    );
    const relative = visualSelectionSourceRangeForBlocks(
      blocks,
      windowChange.changes.insert,
      editedSlice
    );
    return {
      changes: windowChange.changes,
      selection: {
        direction: relative.direction,
        end: sourceRange.start + relative.end,
        start: sourceRange.start + relative.start
      },
      value: windowChange.value
    };
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'visual-editor-selection-invalid',
        'visual-editor-window-block-range-invalid',
        'visual-editor-window-selection-invalid',
        'visual-editor-window-source-range-invalid',
        'visual-editor-markdown-merge-ambiguous',
        'visual-editor-markdown-merge-failed'
      ].includes(error.message)
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    throw error;
  }
}

type OwnerCodeFenceCommand = Readonly<{
  historySelectionBefore?: VisualSelectionSourceRange;
  kind: 'create' | 'remove';
  owned: FullOwnedDom;
  prior: HTMLElement;
  html: string;
  sourceStart: number;
  sourceEnd: number;
}>;

type SynchronizeMarkdownOptions = Readonly<{
  acceptedTopLevelWindow?: AcceptedTopLevelVisualWindow | null;
  acceptedDocumentBoundary?: AcceptedPasteDocumentBoundary;
  acceptedTopLevelSelection?: boolean;
  historySelectionBefore?: VisualSelectionSourceRange;
  historySelectionWitness?: VisualHistorySelectionWitness;
  ownerResult?: Readonly<{
    value: string;
    selection: VisualSelectionSourceRange;
    historySelectionBefore?: VisualSelectionSourceRange;
    ledger: Readonly<{ metadata: ReadonlyArray<FullOwnedNodeMetadata>; nodes: ReadonlyArray<Node> }>;
  }>;
  /**
   * Provenance for a command THIS owner ran synchronously against an unmapped
   * surface: the exact child list that existed immediately before the command
   * ran. There is no formal render to launder on such a surface, so the nodes
   * the command itself produced are the operation's own result.
   */
  ownerCommandBefore?: ReadonlyArray<Node>;
  ownerCodeFenceCommand?: OwnerCodeFenceCommand;
  isolateHistoryBefore?: boolean;
  localCodeBodyPre?: HTMLElement;
  localCodeBodyInputPre?: HTMLElement;
  mapSelectionWhenUnchanged?: boolean;
  preferVisualSelection?: boolean;
  rejectCodeStructureMismatch?: boolean;
}>;

type CaptureSnapshotOptions = Readonly<{
  acceptedPreviewSource?: boolean;
  cacheSourceIntervalMap?: boolean;
  historyRestore?: boolean;
  tablePresentation?: FullAcceptedTablePresentation;
}>;

type VisualCodeStructureValidation = Readonly<{
  matchesPreview: boolean;
  markdown: string;
}>;

/**
 * Whether one committed source change is exactly one plain typed character
 * inside a fenced code body, compared by code-body SEMANTICS rather than raw
 * source bytes: the synchronizer may re-serialize the whole fenced block
 * (replacing its entire source interval) even though the user only typed one
 * character. The proof requires the same code-block structure, the same fence
 * family/info/opening/closing line per ordinal, and a body prefix/suffix diff
 * that is exactly a single-line insertion strictly inside that same body.
 */
function singleCodeBodyTypingChange(
  previousSource: string,
  nextSource: string
): boolean {
  if (nextSource.length <= previousSource.length) return false;
  let previousStructure: string;
  let nextStructure: string;
  try {
    previousStructure = visualCodeBlockStructureSignature(previousSource);
    nextStructure = visualCodeBlockStructureSignature(nextSource);
  } catch {
    return false;
  }
  if (previousStructure !== nextStructure) return false;
  for (let ordinal = 0; ; ordinal += 1) {
    let previousInterval: ReturnType<typeof visualCodeBodyIntervalAtOrdinal>;
    let nextInterval: ReturnType<typeof visualCodeBodyIntervalAtOrdinal>;
    try {
      previousInterval = visualCodeBodyIntervalAtOrdinal(
        previousSource,
        ordinal
      );
      nextInterval = visualCodeBodyIntervalAtOrdinal(nextSource, ordinal);
    } catch {
      return false;
    }
    const previousBody = previousSource.slice(
      previousInterval.bodyStart,
      previousInterval.bodyEnd
    );
    const nextBody = nextSource.slice(
      nextInterval.bodyStart,
      nextInterval.bodyEnd
    );
    if (previousBody === nextBody) continue;
    // The body grew by a prefix/suffix-exact single-line insertion.
    if (nextBody.length <= previousBody.length) return false;
    let from = 0;
    while (
      from < previousBody.length
      && previousBody.charCodeAt(from) === nextBody.charCodeAt(from)
    ) {
      from += 1;
    }
    let suffixLength = 0;
    while (
      suffixLength < previousBody.length - from
      && previousBody.charCodeAt(previousBody.length - suffixLength - 1)
        === nextBody.charCodeAt(nextBody.length - suffixLength - 1)
    ) {
      suffixLength += 1;
    }
    const insert = nextBody.slice(from, nextBody.length - suffixLength);
    if (
      0 === insert.length
      || /[\r\n]/u.test(insert)
      || 0 !== previousBody.length - from - suffixLength
      || from <= 0
      || from >= nextBody.length - suffixLength
    ) {
      return false;
    }
    // Every other block's body must be byte-identical: one keystroke touches
    // exactly one body.
    for (let other = ordinal + 1; ; other += 1) {
      let otherPrevious: ReturnType<typeof visualCodeBodyIntervalAtOrdinal>;
      let otherNext: ReturnType<typeof visualCodeBodyIntervalAtOrdinal>;
      try {
        otherPrevious = visualCodeBodyIntervalAtOrdinal(previousSource, other);
        otherNext = visualCodeBodyIntervalAtOrdinal(nextSource, other);
      } catch {
        break;
      }
      if (
        previousSource.slice(otherPrevious.bodyStart, otherPrevious.bodyEnd)
          !== nextSource.slice(otherNext.bodyStart, otherNext.bodyEnd)
      ) {
        return false;
      }
    }
    return true;
  }
}



type ApplyDocumentChangeOptions = Readonly<{
  historySelectionWitness?: VisualHistorySelectionWitness;
  isolateHistoryBefore?: boolean;
  /**
   * Whether this change is the continuation of ONE user operation whose
   * previous canonical edit is still the last history event. The owner sets it
   * only for a debounce-grouped native text input in the same code body, where
   * the browser would have produced a single typed run.
   */
  joinPreviousHistory?: boolean;
  rejectCodeStructureMismatch?: boolean;
  validatedCodeStructure?: VisualCodeStructureValidation;
}>;

const VISUAL_INPUT_DEBOUNCE_MS = 80;
const VISUAL_CANONICAL_ADOPTION_PENDING_CODE =
  'visual-editor-canonical-change-preview-adoption-pending';
const VISUAL_CANONICAL_STALE_SERIALIZATION_CODE =
  'visual-editor-canonical-change-preview-stale-serialization';
const VISUAL_CANONICAL_ADOPTION_DEADLINE_MS = 1500;
const VISUAL_WHOLE_DOCUMENT_DELETION_TYPES = new Set([
  'deleteContentBackward',
  'deleteContentForward'
]);

type DocumentHistoryState = ReturnType<
  EditorDocumentSession['document']['getHistoryState']
>;

function documentHistoryState(
  document: EditorDocumentSession['document']
): DocumentHistoryState {
  const state = document.getHistoryState();
  if (
    !Number.isSafeInteger(state.undoDepth) ||
    state.undoDepth < 0 ||
    !Number.isSafeInteger(state.redoDepth) ||
    state.redoDepth < 0
  ) {
    throw new Error('visual-editor-history-state-invalid');
  }
  return state;
}

/**
 * Read exactly the canonical facets one boundary compares. Facets that the
 * boundary never proved are not read at all, so an unproved capability cannot
 * fail or succeed by accident.
 */
function readCanonicalObservation(
  document: EditorDocumentSession['document'],
  facets: FullCanonicalExpectationFacets
): FullCanonicalObservation {
  const revision = facets.revision ? document.getRevision?.() : undefined;
  return {
    ...(facets.history ? { history: documentHistoryState(document) } : {}),
    ...(undefined !== revision ? { revision } : {}),
    ...(facets.selection ? { selection: document.getSelection() } : {}),
    ...(facets.value ? { value: document.getValue() } : {})
  };
}

/**
 * The one comparison between a transfer's canonical expectation and the state
 * the document really has. Callers name the facets their trust boundary
 * proves; every other proof (slot, DOM, correspondence, replacement) stays at
 * that boundary.
 */
function canonicalExpectationMismatch(
  expectation: FullCanonicalExpectation,
  current: FullCanonicalObservation,
  facets: FullCanonicalExpectationFacets
): 'history' | 'revision' | 'selection' | 'value' | null {
  if (facets.value && expectation.value !== current.value) return 'value';
  if (
    facets.selection &&
    (!current.selection ||
      expectation.selection.direction !== current.selection.direction ||
      expectation.selection.start !== current.selection.start ||
      expectation.selection.end !== current.selection.end)
  ) {
    return 'selection';
  }
  if (facets.revision && expectation.revision !== current.revision) {
    return 'revision';
  }
  if (
    facets.history &&
    (!expectation.history ||
      !current.history ||
      expectation.history.undoDepth !== current.history.undoDepth ||
      expectation.history.redoDepth !== current.history.redoDepth)
  ) {
    return 'history';
  }
  return null;
}

type VisualSelectionMemory = Readonly<{
  anchorNode: Text;
  anchorOffset: number;
  focusNode: Text;
  focusOffset: number;
  sourceAnchor: number;
  sourceFocus: number;
  visualAnchor: number;
  visualFocus: number;
}>;

/**
 * The interval map of one exact source/baseline pair. A map may only be reused
 * for the pair it was created from: a map built for an earlier pair still
 * resolves offsets that the current pair means differently.
 */
type VisualSourceIntervalMapRecord = Readonly<{
  map: VisualMarkdownSourceIntervalMap;
  sourceMarkdown: string;
  visualMarkdown: string;
}>;

type VisualHistorySelectionBoundary = Readonly<{
  offset: number;
  path: ReadonlyArray<number>;
}>;

type VisualHistorySelection = Readonly<{
  anchor: VisualHistorySelectionBoundary;
  backward: boolean;
  focus: VisualHistorySelectionBoundary;
  /** The paths were transported through a normalized clone matching snapshot HTML. */
  nativePathPaired?: boolean;
  /** Canonical endpoints used when a retained path crosses Text normalization. */
  sourceSelection?: VisualSelectionSourceRange;

}>;
function visualHistorySelectionBoundaryEqual(
  left: VisualHistorySelectionBoundary,
  right: VisualHistorySelectionBoundary
): boolean {
  return left.offset === right.offset
    && left.path.length === right.path.length
    && left.path.every((value, index) => value === right.path[index]);
}

function visualHistorySelectionEqual(
  left: VisualHistorySelection,
  right: VisualHistorySelection
): boolean {
  return left.backward === right.backward
    && visualHistorySelectionBoundaryEqual(left.anchor, right.anchor)
    && visualHistorySelectionBoundaryEqual(left.focus, right.focus);
}

type LocalVisualCodeBodyProvenance = Readonly<{
  codeOrdinal: number;
  fence: string;
  info: string;
  sourceBlockStart?: number;
  structureSignature: string;
}>;

type IndexedLocalVisualCodeBodyProvenance = Readonly<
  LocalVisualCodeBodyProvenance & { preIndex: number }
>;

type IndexedAcceptedCodeBodyCorrespondence = Readonly<{
  blockId: string;
  interval: VisualCodeBodyInterval;
  preIndex: number;
  source: string;
  sourceRevision: number;
  structureSignature: string;
}>;

type LocalVisualCodeBodyRegistration = Readonly<{
  order: ReadonlyArray<HTMLElement>;
  pre: HTMLElement;
  provenance: LocalVisualCodeBodyProvenance;
  updates: ReadonlyArray<
    Readonly<{
      pre: HTMLElement;
      provenance: LocalVisualCodeBodyProvenance;
    }>
  >;
}>;

/**
 * Accepted Preview identity captured with a history snapshot. A stored
 * snapshot is only a complete restore target while the live Preview identity
 * is still exactly this render: its DOM, Markdown, edit map, and accepted
 * identity then belong to one document state.
 */
type VisualHistoryPreviewIdentity = Readonly<{
  mapped: boolean;
  markdown: string | null;
  revision: number;
  signature: string;
}>;

type VisualHistorySnapshot = Readonly<{
  acceptedCodeBodies: ReadonlyArray<IndexedAcceptedCodeBodyCorrespondence>;
  acceptedPreview: VisualHistoryPreviewIdentity;
  codeBodyPreviewSourceMarkdown: string | null;
  codeBodyPreviewStructureSignature: string | null;
  domPair?: Readonly<{ owner: object; token: number }>;
  emptyParagraph?: Readonly<{
    bodyPath: ReadonlyArray<number>;
    sourceLength: 0 | 2;
    sourceOffset: number;
  }>;
  html: string;
  historyState: DocumentHistoryState;
  localCodeBodies: ReadonlyArray<IndexedLocalVisualCodeBodyProvenance>;
  markdown: string;
  selection: VisualHistorySelection | null;
  tablePresentation: FullAcceptedTablePresentation | null;
}>;

type VisualHistorySelectionWitness = Readonly<{
  acceptedHtml: string;
  acceptedPreview: VisualHistoryPreviewIdentity;
  historySelectionBefore: VisualSelectionSourceRange;
  historyState: DocumentHistoryState;
  /** The exact slot object this caret was read against. */
  slot: VisualHistorySnapshot;
  revision: number;
  selection: VisualHistorySelection;
  sourceMarkdown: string;
}>;

type VisualHistorySlot =
  | Readonly<{
      kind: 'rematerialize';
      markdown: string;
    }>
  | Readonly<{
      kind: 'snapshot';
      markdown: string;
      snapshot: VisualHistorySnapshot;
    }>;

type VisualInputIntent = Readonly<{
  codeBlockStructure?: Readonly<{
    baseMarkdown: string;
    blockId: string | null;
    codeOrdinal: number;
    localPre?: HTMLElement;
    preserving: boolean;
  }>;
  codeBody?: Readonly<{
    codeOrdinal: number;
    initialEmptyBody: boolean;
    lineEnding: string;
    openEof: boolean;
    sourceBlockStart: number;
    sourcePrefix: string;
    visualPrefix: string;
  }>;
  /** A supported same-block native Range spanning distinct Text nodes. */
  crossTextTarget?: Readonly<{ owner: HTMLElement }>;
  data: string | null;
  emptyParagraphTarget?: HTMLParagraphElement;
  hasTargetRange: boolean;
  historyBefore?: VisualHistorySnapshot;
  historySelectionBefore?: VisualSelectionSourceRange;
  historySelectionWitness?: VisualHistorySelectionWitness;
  inputType: string;
  literalFencePrefix?: Readonly<{ markdown: string; offset: number }>;
  sourceSelection: Readonly<{ end: number; start: number }>;
  /**
   * The authored caret sat on the renderer's own terminal code-body line, so
   * the projection was clamped to the body's last line. The browser's default
   * would write that character back onto the terminal line, outside the body,
   * so this input is applied by the owner at the clamped caret instead.
   */
  terminalLine?: boolean;
  textData: string;
  textNode: Text;
  textSelection: Readonly<{ end: number; start: number }>;
  visualSelection: Readonly<{ end: number; start: number }>;
}>;

type VisualEmptyStructuralInput = Readonly<{
  body: HTMLElement;
  bodyPath: ReadonlyArray<number>;
  beforeSurface: HTMLElement;
  data: string;
  historyGroupOrigin?: Readonly<{
    historyRedoDepth: number;
    historySelectionBefore: VisualSelectionSourceRange;
    historyUndoDepth: number;
    owned: FullOwnedDom;
  }>;
  historyBefore?: VisualHistorySnapshot;
  historyOrigin?: 'empty-structural';
  inputType: string;
  placeholder: HTMLBRElement;
  sourceMarkdown: string;
  sourceSelection: Readonly<{ end: number; start: number }>;
  targetRange: Readonly<{
    endNode: Node;
    endOffset: number;
    startNode: Node;
    startOffset: number;
  }>;
  visualMarkdown: string;
  visualSelection: Readonly<{ end: number; start: number }>;
}>;

type VisualCompositionCodeBodyContext = Readonly<{
  code: HTMLElement;
  codeOrdinal: number;
  historyBefore: VisualHistorySnapshot;
  localPre?: HTMLElement;
}>;

/**
 * Whether one input is a plain character typed into an owned fenced code body.
 *
 * The browser groups consecutive characters of one typed run into a single undo
 * step; this owner commits each debounce group separately, so it has to say
 * explicitly which commits belong to that same run. Only a single-line
 * insertion whose own native text node sits inside a `pre > code` body
 * qualifies: a line break, a deletion, a paste or any text outside a code body
 * starts its own step.
 */
function nativeCodeBodyTypingRun(intent: VisualInputIntent): boolean {
  if (
    !['insertText', 'insertReplacementText'].includes(intent.inputType) ||
    !intent.data ||
    /[\r\n]/u.test(intent.data)
  ) {
    return false;
  }
  const parent = intent.textNode.parentElement;
  return Boolean(
    parent
    && 'CODE' === parent.tagName
    && parent.closest('pre')
  );
}

type PendingVisualIntent = Readonly<{
  baseSourceMarkdown: string;
  /** The native input event that produced this commit. */
  inputType: string;
  codeBlockStructure?: Readonly<{
    baseMarkdown: string;
    blockId: string | null;
    codeOrdinal: number;
    localPre?: HTMLElement;
    preserving: boolean;
  }>;
  codeBodyTopology?: Readonly<{
    openEof: boolean;
    pre: HTMLElement;
    sourceBlockStart: number;
  }>;
  emptyParagraphTarget?: HTMLParagraphElement;
  historyBefore?: VisualHistorySnapshot;
  historySelectionBefore?: VisualSelectionSourceRange;
  historyGroupOrigin?: Readonly<{
    historyRedoDepth: number;
    historySelectionBefore: VisualSelectionSourceRange;
    historyUndoDepth: number;
    owned: FullOwnedDom;
  }>;
  historySelectionWitness?: VisualHistorySelectionWitness;
  historyOrigin?: 'empty-structural';
  deferSourceChange?: boolean;
  memory: VisualSelectionMemory | null;
  /**
   * Whether this commit is one plain character typed into an owned code body.
   * Such a commit continues the browser's own typed run, so its canonical
   * event may join the previous one instead of opening a new undo step.
   */
  nativeTypingRun?: boolean;
  result: NonNullable<ReturnType<typeof applyVisualMarkdownEditIntent>>;
  sourceChange: Readonly<{
    from: number;
    insert: string;
    to: number;
  }>;
}>;

function hasImageFile(transfer: DataTransfer | null): boolean {
  return (
    Array.from(transfer?.items ?? []).some(
      (item) => 'file' === item.kind && /^image\//i.test(item.type)
    ) ||
    Array.from(transfer?.files ?? []).some((file) =>
      /^image\//i.test(file.type)
    )
  );
}

function visualEditorFailureCode(error: unknown, fallback: string): string {
  return error instanceof Error &&
    /^visual-editor-[a-z0-9-]+$/.test(error.message)
    ? error.message
    : fallback;
}


function visualBlockIdForPre(
  pre: HTMLElement,
  surface: HTMLElement
): string | null {
  let root: HTMLElement | null = pre;
  while (root && root !== surface) {
    const id = root.getAttribute('data-easymde-visual-block-id');
    if (id) return id;
    root = root.parentElement;
  }
  return null;
}

function newlyCreatedVisualCodePre(
  surface: HTMLElement,
  previous: ReadonlySet<HTMLElement>
): HTMLElement | undefined {
  const created = Array.from(
    surface.querySelectorAll<HTMLElement>('pre')
  ).filter((pre) => !previous.has(pre));
  if (created.length > 1) {
    throw new Error('visual-editor-code-body-map-ambiguous');
  }
  return created[0];
}

function placeSurfaceCaretAtEnd(surface: HTMLElement): boolean {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) return false;
  const range = surface.ownerDocument.createRange();
  range.selectNodeContents(surface);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/**
 * The presentation-only projection for an accepted source caret that the
 * accepted map cannot place: when the requested offset is on the opening
 * delimiter/info line of an editable fenced block of this accepted source, the
 * representable caret is that block's own code-body start. Ownership comes
 * from the strict accepted ledger owner (`createVisualCodeBodyIntervalForPreviewBlock`,
 * which validates the whole ledger and binds the whole fence), and the code
 * surface is the native input shape (`captureVisualCodeInputSnapshot`) whose
 * body `projectVisualCodeBodySelection` proves against that same interval.
 * It never re-parses the surface or falls back to a different block.
 */
/**
 * Whether a boundary's own ancestry from its element to the surface carries no
 * protection marker: no read-only region, no `contenteditable="false"` and no
 * Preview window spacer. The native input shape checks the block; this checks
 * the exact returned boundary, including highlighted spans inside the code.
 */
function acceptedBoundaryAncestryIsEditable(
  node: Node,
  code: HTMLElement,
  surface: HTMLElement
): boolean {
  let element = node instanceof HTMLElement ? node : node.parentElement;
  while (element) {
    if (
      element.matches('[contenteditable="false"]')
      || element.matches('[data-easymde-preview-window-spacer]')
      || element.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
    ) return false;
    if (element === surface) return true;
    if (element === code) {
      element = element.parentElement;
      continue;
    }
    element = element.parentElement;
  }
  return false;
}

function acceptedCodeBodyStartProjection(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  previewSignature: string,
  sourceOffset: number
): Readonly<{ node: Node; offset: number; sourceOffset: number }> | null {
  if (
    1 !== editMap.version
    || 'line' !== editMap.coordinate
    || editMap.signature !== previewSignature
  ) return null;
  const lineStarts = markdownLineStarts(sourceMarkdown);
  let children: ReadonlyArray<HTMLElement>;
  try {
    children = acceptedTopLevelVisualChildren(surface, editMap);
  } catch {
    return null;
  }
  // Only the ledger row whose own source range holds the caret can own it.
  // Row ranges are half-open: an offset on a shared boundary belongs to the row
  // that starts there, so a preceding paragraph cannot veto the fence owner.
  // The document end stays inclusive.
  for (const [index, block] of editMap.blocks.entries()) {
    if (!block.editable) continue;
    const start = lineStarts[block.startLine];
    const end = block.endLine === lineStarts.length
      ? sourceMarkdown.length
      : lineStarts[block.endLine];
    if (
      undefined === start
      || undefined === end
      || sourceOffset < start
      || sourceOffset > end
      || (sourceOffset === end && end !== sourceMarkdown.length)
    ) continue;
    const visualBlock = children[index];
    if (!visualBlock) continue;
    const pre = visualBlock.matches('pre')
      ? visualBlock
      : visualBlock.querySelector<HTMLElement>(':scope > pre');
    // A row that carries no fence at all is not this lookup's owner; only a
    // fence whose live `<pre>` is not its own block is a real mismatch.
    if (!pre) continue;
    if (pre !== visualBlock && pre.parentElement !== visualBlock) {
      return null;
    }
    let interval: ReturnType<typeof createVisualCodeBodyIntervalForPreviewBlock>;
    let input: ReturnType<typeof captureVisualCodeInputSnapshot>;
    try {
      interval = createVisualCodeBodyIntervalForPreviewBlock(
        sourceMarkdown,
        editMap,
        block.id
      );
      input = captureVisualCodeInputSnapshot(pre);
    } catch {
      return null;
    }
    if (
      !input
      || input.code !== pre.querySelector(':scope > code')
      || input.pre !== pre
      || pre.closest(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
      // `protectVisualMarkdownReadOnlyRegions` marks every protected region
      // with this attribute, so it is the runtime protection marker too.
      || pre.closest('[contenteditable="false"]')
      || !surface.contains(input.code)
    ) return null;
    // The caret has to be on this fence's own opening delimiter/info line.
    if (
      sourceOffset < interval.sourceBlockStart
      || sourceOffset >= interval.bodyStart
      || !sourceMarkdown
        .slice(interval.sourceBlockStart, interval.bodyStart)
        .includes(interval.fence)
    ) continue;
    let projection: ReturnType<typeof projectVisualCodeBodySelection>;
    try {
      projection = projectVisualCodeBodySelection(
        input.code,
        sourceMarkdown,
        sourceMarkdown,
        interval.codeOrdinal,
        {
          end: { node: input.code, offset: 0 },
          start: { node: input.code, offset: 0 }
        }
      );
    } catch {
      return null;
    }
    if (
      projection.sourceSelection.start !== interval.bodyStart
      || projection.sourceSelection.end !== interval.bodyStart
      || projection.localSelection.start !== 0
      || projection.localSelection.end !== 0
    ) return null;
    // The returned boundary's own ancestry is the final proof: the caret must
    // not land inside protected markup, a read-only region or a spacer, even
    // when the body text and markup themselves look supported.
    const walker = input.code.ownerDocument.createTreeWalker(
      input.code,
      NodeFilter.SHOW_TEXT
    );
    const firstText = walker.nextNode();
    const node = firstText instanceof Text ? firstText : input.code;
    if (!acceptedBoundaryAncestryIsEditable(node, input.code, surface)) {
      return null;
    }
    return {
      node,
      offset: 0,
      sourceOffset: interval.bodyStart
    };
  }
  return null;
}

/**
 * The canonical offset of the caret the accepted placement actually installed.
 * A fence's source range covers its closing delimiter, while the live DOM ends
 * at the code element's content boundary, so a placement at that boundary
 * yields a DOM caret whose own code-body projection is the body's last
 * position, not the recorded end-of-fence offset. Reading the placed caret back
 * through the same projection keeps the recorded canonical selection and the
 * native caret describing one position. Anything unproved returns null.
 */
function codeBodyCaretSourceOffset(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  recordedSourceOffset: number
): number | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.isCollapsed
    || !selection.anchorNode
    || !surface.contains(selection.anchorNode)
  ) return null;
  let code: HTMLElement | null = null;
  let node: Node | null = selection.anchorNode;
  while (node && node !== surface) {
    if (node instanceof HTMLElement && 'CODE' === node.tagName) {
      code = node;
      break;
    }
    node = node.parentNode;
  }
  if (!code) return null;
  const pre = code.closest<HTMLElement>('pre');
  if (!pre || !surface.contains(pre)) return null;
  const blockId = visualBlockIdForPre(pre, surface);
  if (!blockId) return null;
  let interval: ReturnType<typeof createVisualCodeBodyIntervalForPreviewBlock>;
  try {
    interval = createVisualCodeBodyIntervalForPreviewBlock(
      sourceMarkdown,
      editMap,
      blockId
    );
  } catch {
    return null;
  }
  // A code body's DOM positions cover only its own text. The opening
  // delimiter, the info line and the closing delimiter have no DOM text, so a
  // recorded offset on any of them cannot be represented and the placement
  // necessarily lands somewhere else. The projection is then the only truthful
  // canonical position for the caret that was actually installed. A recorded
  // offset the DOM does represent projects back to itself, so this only
  // rewrites positions the DOM could not express.
  if (
    recordedSourceOffset >= interval.bodyStart
    && recordedSourceOffset <= interval.bodyEnd
  ) {
    return null;
  }
  let projection: ReturnType<typeof projectVisualCodeBodySelection>;
  try {
    projection = projectVisualCodeBodySelection(
      code,
      sourceMarkdown,
      sourceMarkdown,
      interval.codeOrdinal,
      {
        end: { node: selection.anchorNode, offset: selection.anchorOffset },
        start: { node: selection.anchorNode, offset: selection.anchorOffset }
      }
    );
  } catch {
    return null;
  }
  return projection.sourceSelection.start;
}

function placeVisualCaretAtAcceptedCodeBlockStart(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  sourceOffset: number
): boolean {
  const children = acceptedTopLevelVisualChildren(surface, editMap);
  const lineStarts = markdownLineStarts(sourceMarkdown);
  let previousEndLine = 0;
  for (const [index, block] of editMap.blocks.entries()) {
    if (
      !Number.isInteger(block.startLine)
      || !Number.isInteger(block.endLine)
      || block.startLine < previousEndLine
      || block.startLine < 0
      || block.endLine < block.startLine
      || block.endLine > lineStarts.length
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    previousEndLine = block.endLine;
    const start = lineStarts[block.startLine];
    const end = block.endLine === lineStarts.length
      ? sourceMarkdown.length
      : lineStarts[block.endLine];
    if (
      start === undefined
      || end === undefined
      || end < start
      || sourceOffset < start
      || sourceOffset > end
      || !block.editable
    ) continue;
    const visualBlock = children[index];
    const pre = visualBlock?.matches('pre')
      ? visualBlock
      : visualBlock?.querySelector<HTMLElement>('pre');
    const code = pre?.querySelector<HTMLElement>(':scope > code') ?? pre;
    if (!pre || !code || !surface.contains(code)) continue;
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-editor-selection-map-failed');
    const range = surface.ownerDocument.createRange();
    range.selectNodeContents(code);
    range.collapse(true);
    surface.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
  return false;
}

function focusVisualSurface(surface: HTMLElement): void {
  surface.focus({ preventScroll: true });
}

function placeVisualContextMenuCaret(
  surface: HTMLElement,
  target: Element | null,
  point?: Readonly<{ x: number; y: number }>
): boolean {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-unavailable');
  const range = visualContextMenuCaretRangeAtPoint(surface, target, point);
  if (!range) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function selectedVisualCodeBlock(surface: HTMLElement): HTMLElement | null {
  const node = surface.ownerDocument.defaultView?.getSelection()?.anchorNode;
  if (!node || !surface.contains(node)) return null;
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const pre = element?.closest('pre');
  return pre && surface.contains(pre) ? pre : null;
}

function ensureEmptyVisualParagraph(
  surface: HTMLElement,
  sourceMarkdown: string
): void {
  if (!isVisualMarkdownEmpty(sourceMarkdown)) return;
  if (
    surface.hasChildNodes() &&
    !(
      1 === surface.childNodes.length &&
      surface.firstChild instanceof HTMLBRElement
    )
  )
    return;
  resetEmptyVisualParagraph(surface);
}

function resetEmptyVisualParagraph(surface: HTMLElement): void {
  surface.replaceChildren();
  const paragraph = surface.ownerDocument.createElement('p');
  paragraph.append(surface.ownerDocument.createElement('br'));
  surface.append(paragraph);
  placeSurfaceCaretAtEnd(paragraph);
}

function isVisualMarkdownEmpty(markdown: string): boolean {
  return isMarkdownTerminalWhitespaceSuffix(markdown);
}

function isEmptyVisualSurface(surface: HTMLElement): boolean {
  return (
    0 === surface.childNodes.length ||
    (1 === surface.childNodes.length &&
      surface.firstChild instanceof HTMLBRElement)
  );
}

function selectVisualSurfaceContents(surface: HTMLElement): void {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-unavailable');
  const range = surface.ownerDocument.createRange();
  range.selectNodeContents(surface);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectionCoversVisualSurface(surface: HTMLElement): boolean {
  const documentRef = surface.ownerDocument;
  const selection = documentRef.defaultView?.getSelection();
  if (
    !surface.isConnected ||
    documentRef.activeElement !== surface ||
    !selection ||
    1 !== selection.rangeCount ||
    selection.isCollapsed ||
    !selection.anchorNode?.isConnected ||
    !selection.focusNode?.isConnected ||
    !surface.contains(selection.anchorNode) ||
    !surface.contains(selection.focusNode)
  )
    return false;
  const range = selection.getRangeAt(0);
  return (
    range.startContainer === surface &&
    range.startOffset === 0 &&
    range.endContainer === surface &&
    range.endOffset === surface.childNodes.length
  );
}

function editableTextNode(surface: HTMLElement, node: Node): node is Text {
  if (!(node instanceof Text) || !surface.contains(node)) return false;
  let element = node.parentElement;
  while (element && element !== surface) {
    if ('false' === element.getAttribute('contenteditable')) return false;
    element = element.parentElement;
  }
  return true;
}

function currentTextSelection(surface: HTMLElement): Readonly<{
  anchorNode: Text;
  anchorOffset: number;
  focusNode: Text;
  focusOffset: number;
}> | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  const anchorNode = selection?.anchorNode;
  const focusNode = selection?.focusNode;
  if (
    !selection ||
    !anchorNode ||
    !focusNode ||
    !editableTextNode(surface, anchorNode) ||
    !editableTextNode(surface, focusNode)
  ) {
    return null;
  }
  return {
    anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode,
    focusOffset: selection.focusOffset
  };
}

function selectionRange(
  anchor: number,
  focus: number
): Readonly<{ end: number; start: number }> {
  return { end: Math.max(anchor, focus), start: Math.min(anchor, focus) };
}

function selectionMemoryForCurrentSelection(
  surface: HTMLElement,
  sourceSelection: Readonly<{ end: number; start: number }>,
  visualSelection: Readonly<{ end: number; start: number }>
): VisualSelectionMemory | null {
  const current = currentTextSelection(surface);
  if (!current) return null;
  return {
    ...current,
    sourceAnchor: sourceSelection.start,
    sourceFocus: sourceSelection.end,
    visualAnchor: visualSelection.start,
    visualFocus: visualSelection.end
  };
}

const VISUAL_DIRECT_FORMATTING_TAGS = new Set([
  'A',
  'CODE',
  'DEL',
  'EM',
  'I',
  'MARK',
  'S',
  'STRONG',
  'SUB',
  'SUP',
  'U'
]);

/** A native terminal placeholder break adds no character to its Text run. */
function isPlainVisualTextBody(element: HTMLElement, text: Text): boolean {
  return ['DIV', 'P'].includes(element.tagName) && element.firstChild === text
    && (element.childNodes.length === 1
      || (element.childNodes.length === 2 && element.lastChild instanceof HTMLBRElement));
}

type NativeVisualTextBoundary = Readonly<{
  node: Text;
  offset: number;
}>;

/**
 * Resolve only the native boundaries that are exactly a direct plain paragraph
 * edge. A P edge and its equivalent first/last Text edge share one proof; no
 * adjacent node or wrapper is searched, and an empty/BR-only paragraph has no
 * text boundary to borrow.
 */
function nativeVisualTextBoundary(
  surface: HTMLElement,
  node: Node,
  offset: number
): NativeVisualTextBoundary | null {
  if (node instanceof Text) {
    return editableTextNode(surface, node)
      && Number.isInteger(offset)
      && offset >= 0
      && offset <= node.length
      ? { node, offset }
      : null;
  }
  if (!(node instanceof HTMLParagraphElement)
    || node.parentElement !== surface
    || 'false' === node.getAttribute('contenteditable')) {
    return null;
  }
  const text = node.firstChild;
  if (!(text instanceof Text)
    || text.data.length === 0
    || !isPlainVisualTextBody(node, text)
    || !editableTextNode(surface, text)) {
    return null;
  }
  if (0 === offset) return { node: text, offset: 0 };
  if (1 === offset) return { node: text, offset: text.length };
  return null;
}

function nativeVisualTextSelection(
  surface: HTMLElement,
  event: InputEvent
): Readonly<{
  anchorNode: Text;
  anchorOffset: number;
  focusNode: Text;
  focusOffset: number;
}> | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  const anchorNode = selection?.anchorNode;
  const focusNode = selection?.focusNode;
  if (!selection
    || !anchorNode
    || !focusNode
    || !selection.isCollapsed
    || anchorNode !== focusNode) {
    return null;
  }
  const current = nativeVisualTextBoundary(
    surface,
    anchorNode,
    selection.anchorOffset
  );
  if (!current) return null;
  const ranges = event.getTargetRanges?.() ?? [];
  if (1 !== ranges.length) return null;
  const target = ranges[0];
  if (!target
    || target.startContainer !== target.endContainer
    || target.startOffset !== target.endOffset) {
    return null;
  }
  const targetStart = nativeVisualTextBoundary(
    surface,
    target.startContainer,
    target.startOffset
  );
  if (!targetStart
    || targetStart.node !== current.node
    || targetStart.offset !== current.offset) {
    return null;
  }
  return {
    anchorNode: current.node,
    anchorOffset: current.offset,
    focusNode: current.node,
    focusOffset: current.offset
  };
}

/** Whether both Markdown strings spell the same code units before `end`. */
function sameMarkdownPrefix(
  left: string,
  right: string,
  end: number
): boolean {
  if (
    !Number.isInteger(end)
    || end < 0
    || end > left.length
    || end > right.length
  ) {
    return false;
  }
  if (left === right) return true;
  for (let index = 0; index < end; index += 1) {
    if (left.charCodeAt(index) !== right.charCodeAt(index)) return false;
  }
  return true;
}

function canUseIdentityVisualSelection(
  surface: HTMLElement,
  sourceMarkdown: string,
  visualMarkdown: string,
  sourceSelection: Readonly<{ end: number; start: number }>,
  visualSelection: Readonly<{ end: number; start: number }>
): boolean {
  // Identity offsets are only claimed up to the boundary this memory starts
  // from. The serializer trims a document-level suffix that cannot move a
  // boundary both spaces spell identically; any difference before the
  // boundary still refuses the identity, and every later move is re-proved by
  // provedLinearBoundary.
  const identityBoundary = Math.max(
    sourceSelection.start,
    sourceSelection.end,
    visualSelection.start,
    visualSelection.end
  );
  if (
    sourceSelection.start !== visualSelection.start ||
    sourceSelection.end !== visualSelection.end ||
    !sameMarkdownPrefix(sourceMarkdown, visualMarkdown, identityBoundary)
  ) {
    return false;
  }
  const current = currentTextSelection(surface);
  if (!current || current.anchorNode !== current.focusNode) return false;
  let element = current.anchorNode.parentElement;
  while (element && element !== surface) {
    if (VISUAL_DIRECT_FORMATTING_TAGS.has(element.tagName)) return false;
    if (!isPlainVisualTextBody(element, current.anchorNode)) return false;
    element = element.parentElement;
  }
  return element === surface;
}

type VisualBoundaryProjection = Readonly<{
  sourceOffset: number;
  visualOffset: number;
}>;

/**
 * The canonical and baseline offset a boundary moves to from an already mapped
 * boundary, or `null` unless the traversed raw text proves the move in both
 * markdown spaces. Offsets move one to one only while the raw text between the
 * two boundaries is the same text in canonical source and in the baseline, so
 * a soft break, a collapsed run or an escape in between moves both with it.
 */
function provedLinearBoundary(
  node: Text,
  offset: number,
  boundary: Readonly<{
    offset: number;
    sourceOffset: number;
    visualOffset: number;
  }>,
  sourceMarkdown: string,
  baselineVisualMarkdown: string
): VisualBoundaryProjection | null {
  if (!Number.isInteger(offset) || !Number.isInteger(boundary.offset)) {
    return null;
  }
  const rawStart = Math.min(offset, boundary.offset);
  const rawEnd = Math.max(offset, boundary.offset);
  if (rawStart < 0 || rawEnd > node.data.length) return null;
  const backward = offset < boundary.offset;
  const sourceStart = backward
    ? boundary.sourceOffset + offset - boundary.offset
    : boundary.sourceOffset;
  const visualStart = backward
    ? boundary.visualOffset + offset - boundary.offset
    : boundary.visualOffset;
  const traversed = node.data.slice(rawStart, rawEnd);
  if (
    sourceStart < 0
    || visualStart < 0
    || sourceStart + traversed.length > sourceMarkdown.length
    || visualStart + traversed.length > baselineVisualMarkdown.length
  ) {
    return null;
  }
  if (
    sourceMarkdown.slice(sourceStart, sourceStart + traversed.length)
      !== traversed
    || baselineVisualMarkdown.slice(visualStart, visualStart + traversed.length)
      !== traversed
  ) {
    return null;
  }
  // Equal text at equal distance is still not a linear move when a boundary of
  // the traversed span sits inside a backslash escape or covers an escape
  // introducer: the raw character there is not the source unit at that offset,
  // so the arithmetic would split or swallow a unit. Those boundaries belong to
  // the owning block's canonical projection instead.
  if (
    !coversMarkdownUnits(
      sourceMarkdown,
      sourceStart,
      sourceStart + traversed.length
    )
    || !coversMarkdownUnits(
      baselineVisualMarkdown,
      visualStart,
      visualStart + traversed.length
    )
  ) {
    return null;
  }
  return {
    sourceOffset: boundary.sourceOffset + offset - boundary.offset,
    visualOffset: boundary.visualOffset + offset - boundary.offset
  };
}

/** Decode only the exact Text run around an already authenticated native caret. */
function literalTextBoundsAtSelection(
  text: string,
  raw: Readonly<{ start: number; end: number }>,
  markdown: string,
  mapped: Readonly<{ start: number; end: number }>
): Readonly<{ start: number; end: number }> | null {
  if (raw.start < 0 || raw.end < raw.start || raw.end > text.length
    || !coversMarkdownUnits(markdown, mapped.start, mapped.end)) return null;
  let start = mapped.start;
  for (let index = raw.start - 1; index >= 0; index -= 1) {
    if (start <= 0 || markdown[start - 1] !== text[index]) return null;
    start -= 1;
    if (!coversMarkdownUnits(markdown, start, start)) {
      if (start <= 0 || markdown[start - 1] !== '\\') return null;
      start -= 1;
      if (!coversMarkdownUnits(markdown, start, start)) return null;
    }
  }
  let end = mapped.start;
  for (let index = raw.start; index <= text.length; index += 1) {
    if (index === raw.end && end !== mapped.end) return null;
    if (index === text.length) break;
    if (markdown[end] === text[index] && coversMarkdownUnits(markdown, end, end + 1)) {
      end += 1;
    } else if (markdown[end] === '\\' && markdown[end + 1] === text[index]
      && !coversMarkdownUnits(markdown, end + 1, end + 1)
      && coversMarkdownUnits(markdown, end, end + 2)) {
      end += 2;
    } else return null;
  }
  return { start, end };
}

function mapSelectionFromMemory(
  memory: VisualSelectionMemory,
  current: Readonly<{
    anchorNode: Text;
    anchorOffset: number;
    focusNode: Text;
    focusOffset: number;
  }>,
  visualLength: number,
  sourceMarkdown: string | null,
  baselineVisualMarkdown: string
): Readonly<{
  source: Readonly<{ end: number; start: number }>;
  visual: Readonly<{ end: number; start: number }>;
}> | null {
  if (
    memory.anchorNode !== current.anchorNode ||
    memory.focusNode !== current.focusNode
  ) {
    return null;
  }
  if (null === sourceMarkdown) return null;
  const anchor = provedLinearBoundary(
    current.anchorNode,
    current.anchorOffset,
    {
      offset: memory.anchorOffset,
      sourceOffset: memory.sourceAnchor,
      visualOffset: memory.visualAnchor
    },
    sourceMarkdown,
    baselineVisualMarkdown
  );
  const focus = provedLinearBoundary(
    current.focusNode,
    current.focusOffset,
    {
      offset: memory.focusOffset,
      sourceOffset: memory.sourceFocus,
      visualOffset: memory.visualFocus
    },
    sourceMarkdown,
    baselineVisualMarkdown
  );
  if (!anchor || !focus) return null;
  const sourceAnchor = anchor.sourceOffset;
  const sourceFocus = focus.sourceOffset;
  const visualAnchor = anchor.visualOffset;
  const visualFocus = focus.visualOffset;
  if (
    sourceAnchor < 0 ||
    sourceFocus < 0 ||
    sourceAnchor > sourceMarkdown.length ||
    sourceFocus > sourceMarkdown.length ||
    visualAnchor < 0 ||
    visualFocus < 0 ||
    visualAnchor > visualLength ||
    visualFocus > visualLength
  ) {
    return null;
  }
  return {
    source: selectionRange(sourceAnchor, sourceFocus),
    visual: selectionRange(visualAnchor, visualFocus)
  };
}

type LocalVisualBoundaryCertificate = Readonly<{
  root: HTMLElement;
  sourceStart: number;
  textNode: Text;
  visualStart: number;
  visualEnd: number;
}>;

type LocalCompositionVisualCertificate = LocalVisualBoundaryCertificate & Readonly<{
  sourceRange: Readonly<{ end: number; start: number }>;
  visual: string;
  visualRange: Readonly<{ end: number; start: number }>;
  formalWholeRow?: boolean;
}>;

/** Project a prefix of an already certified literal Text run, in whole units. */
function literalTextBoundary(text: string, offset: number, markdown: string, start: number): number | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return null;
  return literalTextBoundsAtSelection(
    text.slice(0, offset),
    { start: 0, end: 0 },
    markdown,
    { start, end: start }
  )?.end ?? null;
}

/** The existing owner memory authenticates this Text, without a Preview id. */
function localVisualBoundaryCertificate(
  surface: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  textNode: Text,
  memory: VisualSelectionMemory | null
): LocalVisualBoundaryCertificate | null {
  const root = textNode.parentElement;
  if (!root || root.parentElement !== surface || !isPlainVisualTextBody(root, textNode)
    || !memory || memory.anchorNode !== textNode || memory.focusNode !== textNode) return null;
  const raw = selectionRange(memory.anchorOffset, memory.focusOffset);
  const sourceBounds = literalTextBoundsAtSelection(textNode.data, raw, sourceMarkdown,
    selectionRange(memory.sourceAnchor, memory.sourceFocus));
  const visualBounds = literalTextBoundsAtSelection(textNode.data, raw, baselineVisualMarkdown,
    selectionRange(memory.visualAnchor, memory.visualFocus));
  if (!sourceBounds || !visualBounds) return null;
  return {
    root,
    sourceStart: sourceBounds.start,
    textNode,
    visualEnd: visualBounds.end,
    visualStart: visualBounds.start
  };
}

function localCompositionVisualCertificate(
  surface: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  textNode: Text,
  anchorOffset: number,
  focusOffset: number,
  memory: VisualSelectionMemory | null
): LocalCompositionVisualCertificate | null {
  const certificate = localVisualBoundaryCertificate(
    surface,
    sourceMarkdown,
    baselineVisualMarkdown,
    textNode,
    memory
  );
  if (!certificate) return null;
  const sourceAnchor = literalTextBoundary(
    textNode.data,
    anchorOffset,
    sourceMarkdown,
    certificate.sourceStart
  );
  const sourceFocus = literalTextBoundary(
    textNode.data,
    focusOffset,
    sourceMarkdown,
    certificate.sourceStart
  );
  if (null === sourceAnchor || null === sourceFocus) return null;
  const visual = baselineVisualMarkdown.slice(0, certificate.visualStart)
    + textNode.data
    + baselineVisualMarkdown.slice(certificate.visualEnd);
  return {
    ...certificate,
    sourceRange: selectionRange(sourceAnchor, sourceFocus),
    visual,
    visualRange: selectionRange(
      certificate.visualStart + anchorOffset,
      certificate.visualStart + focusOffset
    )
  };
}

function mapSelectionFromInterval(
  surface: HTMLElement,
  current: Readonly<{
    anchorNode: Text;
    anchorOffset: number;
    focusNode: Text;
    focusOffset: number;
  }>,
  baselineVisualMarkdown: string,
  sourceIntervalMap: VisualMarkdownSourceIntervalMap,
  acceptedPrefixOnly: boolean,
  textOverride?: Readonly<{ data: string; node: Text }>
): Readonly<{
  source: Readonly<{ end: number; start: number }>;
  visual: Readonly<{ end: number; start: number }>;
}> | null {
  const anchor = mapTextBoundaryFromInterval(
    surface,
    current.anchorNode,
    current.anchorOffset,
    baselineVisualMarkdown,
    sourceIntervalMap,
    acceptedPrefixOnly,
    textOverride?.node === current.anchorNode ? textOverride.data : undefined
  );
  // A collapsed selection asks the same boundary twice; its projection is
  // pure, so reuse the anchor result instead of serializing the block again.
  const collapsed =
    current.anchorNode === current.focusNode
    && current.anchorOffset === current.focusOffset;
  const focus = collapsed
    ? anchor
    : mapTextBoundaryFromInterval(
        surface,
        current.focusNode,
        current.focusOffset,
        baselineVisualMarkdown,
        sourceIntervalMap,
        acceptedPrefixOnly,
        textOverride?.node === current.focusNode ? textOverride.data : undefined
      );
  if (!anchor || !focus) return null;
  return {
    source: selectionRange(anchor.sourceOffset, focus.sourceOffset),
    visual: selectionRange(anchor.visualOffset, focus.visualOffset)
  };
}

function codePointLengthBefore(text: Text, offset: number): number {
  if (offset <= 0) return 0;
  const codePoint = text.data.codePointAt(offset - 1);
  return codePoint && codePoint > 0xffff ? 2 : 1;
}

function codePointLengthAfter(text: Text, offset: number): number {
  if (offset >= text.length) return 0;
  const codePoint = text.data.codePointAt(offset);
  return codePoint && codePoint > 0xffff ? 2 : 1;
}

function wordStartBefore(text: Text, offset: number): number {
  let start = offset;
  while (start > 0 && /\s/u.test(text.data[start - 1] ?? '')) start -= 1;
  while (start > 0 && !/\s/u.test(text.data[start - 1] ?? '')) start -= 1;
  return start;
}

function wordEndAfter(text: Text, offset: number): number {
  let end = offset;
  while (end < text.length && /\s/u.test(text.data[end] ?? '')) end += 1;
  while (end < text.length && !/\s/u.test(text.data[end] ?? '')) end += 1;
  while (end < text.length && /\s/u.test(text.data[end] ?? '')) end += 1;
  return end;
}

function replaceTextRange(
  value: string,
  range: Readonly<{ end: number; start: number }>,
  replacement: string
): string {
  return value.slice(0, range.start) + replacement + value.slice(range.end);
}

function browserTextMatchesExpected(actual: string, expected: string): boolean {
  return (
    actual === expected ||
    actual.replace(/\u00a0/g, ' ') === expected.replace(/\u00a0/g, ' ')
  );
}

function normalizeCodeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function visualCodeBodyInputIntent(
  event: InputEvent,
  inputBlock: VisualCodeInputSnapshot,
  sourceMarkdown: string,
  visualMarkdown: string,
  codeOrdinal: number,
  intervalInventory?: Readonly<{
    source: ReadonlyMap<number, VisualCodeBodyInterval>;
    visual: ReadonlyMap<number, VisualCodeBodyInterval>;
  }>
): VisualInputIntent {
  const targetRange = event.getTargetRanges?.()[0];
  const selection = inputBlock.code.ownerDocument.defaultView?.getSelection();
  const startNode = targetRange?.startContainer ?? selection?.anchorNode;
  const endNode = targetRange?.endContainer ?? selection?.focusNode;
  const startNodeOffset = targetRange?.startOffset ?? selection?.anchorOffset;
  const endNodeOffset = targetRange?.endOffset ?? selection?.focusOffset;
  if (
    !startNode ||
    !endNode ||
    undefined === startNodeOffset ||
    undefined === endNodeOffset
  ) {
    throw new Error('visual-editor-code-body-selection-unavailable');
  }
  let projection = projectVisualCodeBodySelection(
    inputBlock.code,
    sourceMarkdown,
    visualMarkdown,
    codeOrdinal,
    {
      end: { node: endNode, offset: endNodeOffset },
      start: { node: startNode, offset: startNodeOffset }
    },
    intervalInventory
  );
  if (
    !targetRange
    && selection?.isCollapsed
    && selection.anchorNode instanceof Text
    && selection.anchorNode === selection.focusNode
  ) {
    const localStart = 'deleteContentBackward' === event.inputType
      ? Math.max(
          0,
          selection.anchorOffset
            - codePointLengthBefore(selection.anchorNode, selection.anchorOffset)
        )
      : 'deleteContentForward' === event.inputType
        ? selection.anchorOffset
        : selection.anchorOffset;
    const localEnd = 'deleteContentForward' === event.inputType
      ? selection.anchorOffset
        + codePointLengthAfter(selection.anchorNode, selection.anchorOffset)
      : selection.anchorOffset;
    projection = projectVisualCodeBodySelection(
      inputBlock.code,
      sourceMarkdown,
      visualMarkdown,
      codeOrdinal,
      {
        end: { node: selection.anchorNode, offset: localEnd },
        start: { node: selection.anchorNode, offset: localStart }
      },
      intervalInventory
    );
  }
  const opening = sourceMarkdown.slice(
    projection.sourceInterval.sourceBlockStart,
    projection.sourceInterval.bodyStart
  );
  const visualOpening = visualMarkdown.slice(
    projection.visualInterval.sourceBlockStart,
    projection.visualInterval.bodyStart
  );
  const lineEnding =
    projection.sourceInterval.lineEnding ||
    sourceMarkdown.match(/\r\n|\r|\n/)?.[0] ||
    '\n';
  // `bodyEnd` is the offset AFTER the last body line's terminator, so a plain
  // text insertion there would spell itself on the closing fence's own line and
  // leave the fence. The authored caret on that terminal line belongs to the
  // body's last line, whose representable insertion point is before its
  // terminator. Structural input (the owner's own line break) and every
  // non-terminal caret keep the exact projection.
  //
  // The clamp is limited to the two input types this owner applies itself at
  // the clamped caret, and to a collapsed caret: composition and deletion keep
  // the exact projection because their own default behavior writes the DOM,
  // and a ranged delete that merely ends on the terminal line still describes
  // the exact source window the user selected.
  const terminalBodyInsertion =
    'insertText' === event.inputType
    || 'insertReplacementText' === event.inputType;
  const collapsedSourceCaret =
    projection.sourceSelection.start === projection.sourceSelection.end;
  const clampAtBodyEnd = (offset: number): number =>
    terminalBodyInsertion
    && collapsedSourceCaret
    && offset === projection.sourceInterval.bodyEnd
    && projection.sourceInterval.bodyEnd - projection.sourceInterval.bodyStart
      >= lineEnding.length
    && sourceMarkdown.slice(
      projection.sourceInterval.bodyEnd - lineEnding.length,
      projection.sourceInterval.bodyEnd
    ) === lineEnding
      ? offset - lineEnding.length
      : offset;
  const sourceSelection = {
    end: clampAtBodyEnd(projection.sourceSelection.end),
    start: clampAtBodyEnd(projection.sourceSelection.start)
  };
  const historyProjection = selection?.anchorNode && selection.focusNode
    ? projectVisualCodeBodySelection(
        inputBlock.code,
        sourceMarkdown,
        visualMarkdown,
        codeOrdinal,
        {
          end: { node: selection.focusNode, offset: selection.focusOffset },
          start: { node: selection.anchorNode, offset: selection.anchorOffset }
        },
        intervalInventory
      )
    : null;
  const clampedTerminalLine =
    sourceSelection.start !== projection.sourceSelection.start
    || sourceSelection.end !== projection.sourceSelection.end;
  const visualBodyEnd = projection.visualInterval.bodyEnd;
  // The same clamp applies to the visual selection, and it is valid only for a
  // body that really ends with its own terminator: an EMPTY body (or an
  // unterminated last line) has no representable position before a terminator,
  // so its empty window stays exact at the body's start.
  const visualTerminalCaret = Boolean(
    terminalBodyInsertion
    && projection.visualSelection.start === visualBodyEnd
    && projection.visualSelection.end === visualBodyEnd
    && visualBodyEnd - projection.visualInterval.bodyStart >= lineEnding.length
    && visualMarkdown.slice(
      visualBodyEnd - lineEnding.length,
      visualBodyEnd
    ) === lineEnding
  );
  const visualSelection = {
    end: visualTerminalCaret
      ? visualBodyEnd - lineEnding.length
      : projection.visualSelection.end,
    start: visualTerminalCaret
      ? visualBodyEnd - lineEnding.length
      : projection.visualSelection.start
  };
  const initialEmptyBody = '' === projection.sourceText;
  const textNode =
    startNode instanceof Text
      ? startNode
      : inputBlock.code.firstChild instanceof Text
        ? inputBlock.code.firstChild
        : inputBlock.code.ownerDocument.createTextNode('');

  return {
    codeBody: {
      codeOrdinal,
      initialEmptyBody,
      lineEnding,
      openEof: !projection.sourceInterval.closed,
      sourceBlockStart: projection.sourceInterval.sourceBlockStart,
      sourcePrefix:
        initialEmptyBody && !/(?:\r\n|\r|\n)$/.test(opening) ? lineEnding : '',
      visualPrefix:
        initialEmptyBody && !/(?:\r\n|\r|\n)$/.test(visualOpening)
          ? lineEnding
          : ''
    },
    data: ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
      ? null
      : event.data,
    hasTargetRange: Boolean(targetRange),
    ...(historyProjection
      ? {
          historySelectionBefore: {
            direction: nativeDocumentSelectionDirection(selection as Selection),
            end: historyProjection.sourceSelection.end,
            start: historyProjection.sourceSelection.start
          }
        }
      : {}),
    inputType:
      'insertParagraph' === event.inputType
        ? 'insertLineBreak'
        : event.inputType,
    sourceSelection,
    ...(clampedTerminalLine ? { terminalLine: true } : {}),
    textData: inputBlock.codeText,
    textNode,
    textSelection: projection.localSelection,
    visualSelection
  };
}

function insertVisualCodeBodyText(
  code: HTMLElement,
  offset: number,
  text: string
): void {
  const documentRef = code.ownerDocument;
  if ('' === text) return;
  const walker = documentRef.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node = walker.nextNode();
  let target: Text | null = null;
  while (node) {
    if (node instanceof Text) {
      if (remaining <= node.data.length) {
        target = node;
        break;
      }
      remaining -= node.data.length;
    }
    node = walker.nextNode();
  }
  if (!target) {
    target = code.firstChild instanceof Text
      ? code.firstChild
      : code.appendChild(documentRef.createTextNode(''));
    remaining = target.data.length;
  }
  // The clamped caret is the body's LAST LINE, which the renderer spells with
  // its own terminal newline. The character belongs before that newline, not
  // after it, or the DOM would carry a line the accepted body does not.
  const terminalEnding = /\r\n|\r|\n$/u.exec(target.data);
  if (
    terminalEnding
    && remaining >= target.data.length - terminalEnding[0].length
  ) {
    remaining = target.data.length - terminalEnding[0].length;
  }
  target.insertData(remaining, text);
  const range = documentRef.createRange();
  range.setStart(target, remaining + text.length);
  range.collapse(true);
  const selection = documentRef.defaultView?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function insertVisualCodeBodyLineBreak(
  event: InputEvent,
  code: HTMLElement
): void {
  const documentRef = code.ownerDocument;
  const selection = documentRef.defaultView?.getSelection();
  const targetRange = event.getTargetRanges?.()[0];
  let range: Range;
  if (targetRange) {
    range = documentRef.createRange();
    range.setStart(targetRange.startContainer, targetRange.startOffset);
    range.setEnd(targetRange.endContainer, targetRange.endOffset);
  } else if (selection?.rangeCount) {
    range = selection.getRangeAt(0).cloneRange();
  } else {
    throw new Error('visual-editor-code-body-selection-unavailable');
  }
  if (
    (range.startContainer !== code && !code.contains(range.startContainer)) ||
    (range.endContainer !== code && !code.contains(range.endContainer))
  ) {
    throw new Error('visual-editor-code-body-selection-invalid');
  }

  range.deleteContents();
  if (range.startContainer instanceof Text) {
    const insertionNode = range.startContainer;
    const insertionOffset = range.startOffset;
    insertionNode.insertData(insertionOffset, '\n');
    range.setStart(insertionNode, insertionOffset + 1);
  } else {
    const lineBreak = documentRef.createTextNode('\n');
    range.insertNode(lineBreak);
    range.setStartAfter(lineBreak);
  }
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function browserInsertedBeforeVisualCodePlaceholder(
  inputBlock: VisualCodeInputSnapshot | null,
  intent: VisualInputIntent,
  expectedText: string
): boolean {
  const code = inputBlock?.code;
  const placeholder = inputBlock?.placeholder;
  if (
    !code ||
    !placeholder ||
    intent.textData !== '' ||
    intent.textNode.data !== '' ||
    '' === expectedText ||
    !['insertText', 'insertReplacementText'].includes(intent.inputType) ||
    intent.textNode !== placeholder.firstChild ||
    placeholder.parentElement !== code
  )
    return false;

  // Chromium can insert a sibling Text node on either side of the empty span.
  const children = Array.from(code.childNodes);
  const textNodes: Text[] = [];
  const walker = code.ownerDocument.createTreeWalker(
    code,
    NodeFilter.SHOW_TEXT
  );
  let node = walker.nextNode();
  while (node) {
    if (node instanceof Text && '' !== node.data) textNodes.push(node);
    node = walker.nextNode();
  }
  const insertedText = textNodes[0];
  return (
    1 === textNodes.length &&
    insertedText !== intent.textNode &&
    insertedText?.data === expectedText &&
    children.includes(placeholder) &&
    2 === children.length &&
    children.includes(insertedText)
  );
}

/**
 * One accepted marker row's UTF-16 correspondence in both directions. Every
 * source endpoint covers complete Markdown units, including escaped backslashes;
 * no independently decoded prefix can certify a position inside an escape.
 */
function acceptedDecodedRowCorrespondence(
  block: HTMLElement,
  source: string
): Readonly<{
  boundaries: ReadonlyArray<Readonly<{ character: string; node: Node; offset: number; after: number }>>;
  sourceOffsets: ReadonlyArray<number>;
  visible: string;
}> | null {
  const boundaries: Array<{ character: string; node: Node; offset: number; after: number }> = [];
  let protectedDescendant = false;
  const walk = (parent: Node): void => {
    for (let index = 0; index < parent.childNodes.length; index += 1) {
      const child = parent.childNodes[index];
      if (!child) continue;
      if (child instanceof Text) {
        for (let offset = 0; offset < child.data.length; offset += 1) {
          boundaries.push({ character: child.data[offset] ?? '', node: child,
            offset: offset + 1, after: boundaries.length + 1 });
        }
      } else if (child instanceof HTMLBRElement) {
        boundaries.push({ character: '\n', node: parent, offset: index + 1,
          after: boundaries.length + 1 });
      } else if (child instanceof HTMLElement
        && child.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)) {
        protectedDescendant = true;
      } else {
        walk(child);
      }
    }
  };
  walk(block);
  if (protectedDescendant) return null;
  const sourceOffsets: number[] = [0];
  let cursor = 0;
  let escapedMarker = false;
  for (const boundary of boundaries) {
    const character = boundary.character;
    if (source[cursor] === character && coversMarkdownUnits(source, cursor, cursor + 1)) {
      cursor += 1;
    } else if (source[cursor] === '\\' && source[cursor + 1] === character
      && !coversMarkdownUnits(source, cursor + 1, cursor + 1)
      && coversMarkdownUnits(source, cursor, cursor + 2)) {
      escapedMarker ||= character === '`' || character === '~';
      cursor += 2;
    } else {
      return null;
    }
    sourceOffsets.push(cursor);
  }
  // A formal block's source slice can include its trailing line endings. They
  // do not create visible endpoints; all other unmatched content is rejected.
  if (!escapedMarker || /\S/u.test(source.slice(cursor))) return null;
  return { boundaries, sourceOffsets,
    visible: boundaries.map((boundary) => boundary.character).join('') };
}

/**
 * The native selection's own direction, independent of any source mapping.
 * Same-node offsets and cross-Text boundaries both use the DOM's anchor/focus
 * order; a sorted source range never substitutes for this witness.
 */
function nativeDocumentSelectionDirection(
  selection: Selection
): 'backward' | 'forward' | 'none' {
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if (!anchorNode || !focusNode) return 'none';
  if (anchorNode === focusNode) {
    return selection.anchorOffset === selection.focusOffset
      ? 'none'
      : selection.anchorOffset < selection.focusOffset
        ? 'forward'
        : 'backward';
  }
  const documentRef = anchorNode.ownerDocument;
  if (!documentRef) return 'none';
  const anchorPoint = documentRef.createRange();
  anchorPoint.setStart(anchorNode, selection.anchorOffset);
  anchorPoint.collapse(true);
  const focusPoint = documentRef.createRange();
  focusPoint.setStart(focusNode, selection.focusOffset);
  focusPoint.collapse(true);
  const order = anchorPoint.compareBoundaryPoints(
    anchorPoint.START_TO_START,
    focusPoint
  );
  return 0 === order ? 'none' : order < 0 ? 'forward' : 'backward';
}

function acceptedDecodedBlockSelection(
  surface: HTMLElement,
  selection: Readonly<{
    anchorNode: Node;
    anchorOffset: number;
    focusNode: Node;
    focusOffset: number;
  }>,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  editMap: PreviewEditMap | null
): Readonly<{
  source: Readonly<{ start: number; end: number }>;
  visual: Readonly<{ start: number; end: number }>;
}> | null {
  if (!editMap || 0 === editMap.blocks.length) return null;
  const baselineIntervalMap = createVisualMarkdownSourceIntervalMap(
    sourceMarkdown,
    baselineVisualMarkdown
  );
  const baselineOffsetAtSource = (
    sourceOffset: number,
    preferEnd: boolean
  ): number | null => {
    let first: number | null = null;
    let last: number | null = null;
    for (let offset = 0; offset <= baselineVisualMarkdown.length; offset += 1) {
      if (baselineIntervalMap.sourceOffsetAt(offset) !== sourceOffset) continue;
      first ??= offset;
      last = offset;
    }
    return preferEnd ? last : first;
  };
  const lineStarts = markdownLineStarts(sourceMarkdown);
  const resolve = (
    node: Node,
    offset: number
  ): Readonly<{ sourceOffset: number; visualOffset: number }> | null => {
    const element = node instanceof Element ? node : node.parentElement;
    const block = element?.closest('[data-easymde-visual-block-id]');
    if (!(block instanceof HTMLElement)) return null;
    const id = block.getAttribute('data-easymde-visual-block-id');
    if (!id) return null;
    const entry = editMap.blocks.find((candidate) => candidate.id === id);
    if (!entry) return null;
    const blockStart = lineStarts[entry.startLine];
    if (undefined === blockStart) return null;
    const blockEnd = entry.endLine >= lineStarts.length
      ? sourceMarkdown.length
      : lineStarts[entry.endLine]!;
    const sourceBlock = sourceMarkdown.slice(blockStart, blockEnd);
    const correspondence = acceptedDecodedRowCorrespondence(block, sourceBlock);
    if (!correspondence) return null;
    const { boundaries, sourceOffsets: advance, visible } = correspondence;
    let visibleIndex = 0;
    if (node === block && 0 === offset) {
      visibleIndex = 0;
    } else {
      const match = boundaries.find(
        (entry) => entry.node === node && entry.offset === offset
      );
      if (!match) {
        if (node instanceof Text && 0 === offset) {
          const before = boundaries.find((entry) => entry.node === node);
          visibleIndex = before ? before.after - 1 : 0;
        } else {
          return null;
        }
      } else {
        visibleIndex = match.after;
      }
    }
    // Soft breaks serialize as one space, so the block certificate is the
    // serialized prefix plus this row under the same spelling.
    const blockIndex = Array.prototype.indexOf.call(surface.children, block);
    if (blockIndex < 0) return null;
    const sourceOffset = blockStart + (advance[visibleIndex] ?? -1);
    if (sourceOffset < blockStart) return null;
    const precedingBlocks = Array.from(surface.children)
      .slice(0, blockIndex)
      .filter((child): child is HTMLElement => child instanceof HTMLElement);
    const serializedPrefix = 0 === precedingBlocks.length
      ? ''
      : serializeVisualMarkdownBlockFragment(precedingBlocks);
    const normalizedVisible = visible.replace(/\n/gu, ' ');
    // The surface serializer joins rows with a blank-line separator; the
    // single-block fragment provably ends before that separator.
    const separator = serializedPrefix.length > 0
      ? ['\n\n', '\n', ''].find((candidate) =>
          baselineVisualMarkdown.startsWith(
            serializedPrefix + candidate + normalizedVisible
          )
        )
      : '';
    if (undefined === separator && !visible.includes('\\')) {
      // A standalone marker paragraph is escaped when the following accepted
      // root is a code block. The DOM correspondence remains formal, but the
      // baseline spelling is longer than its visible text; use the existing
      // source/visual interval alignment for the exact whole-unit boundary.
      const visualOffset = baselineOffsetAtSource(
        sourceOffset,
        visibleIndex === boundaries.length
      );
      if (null === visualOffset) return null;
      return { sourceOffset, visualOffset };
    }
    if (undefined === separator) return null;
    const baselineStart = serializedPrefix.length + separator.length;
    return {
      sourceOffset,
      visualOffset: baselineStart + visibleIndex
    };
  };
  const anchor = resolve(selection.anchorNode, selection.anchorOffset);
  const focus = anchor && selection.focusNode === selection.anchorNode
    && selection.focusOffset === selection.anchorOffset
    ? anchor
    : resolve(selection.focusNode, selection.focusOffset);
  if (!anchor || !focus) return null;
  return {
    source: {
      end: Math.max(anchor.sourceOffset, focus.sourceOffset),
      start: Math.min(anchor.sourceOffset, focus.sourceOffset)
    },
    visual: {
      end: Math.max(anchor.visualOffset, focus.visualOffset),
      start: Math.min(anchor.visualOffset, focus.visualOffset)
    }
  };
}

function visualInputIntent(
  surface: HTMLElement,
  event: InputEvent,
  memory: VisualSelectionMemory | null,
  sourceMarkdown: string,
  visualLength: number,
  baselineVisualMarkdown: string,
  acceptedEditMap: PreviewEditMap | null,
  // Built on first use: selection memory answers ordinary linear input without
  // a whole-document alignment, and only a projection needs the map.
  intervalMapFor: () => VisualMarkdownSourceIntervalMap,
  acceptedPrefixOnly: boolean,
  localCertificate: LocalVisualBoundaryCertificate | null = null
): VisualInputIntent | null {
  const current = currentTextSelection(surface)
    ?? nativeVisualTextSelection(surface, event);
  if (!current) return null;
  const emptyParagraphTarget = (() => {
    if ('deleteContentBackward' !== event.inputType
      || !(current.anchorNode instanceof Text)
      || current.anchorNode.parentElement === null
      || !(current.anchorNode.parentElement instanceof HTMLParagraphElement)
      || current.anchorNode.parentElement.parentElement !== surface
      || !isPlainVisualTextBody(current.anchorNode.parentElement, current.anchorNode)) {
      return undefined;
    }
    const text = current.anchorNode;
    const fullSelection =
      (current.anchorOffset === 0 && current.focusOffset === text.length)
      || (current.focusOffset === 0 && current.anchorOffset === text.length);
    const target = event.getTargetRanges?.()[0];
    const targetCoversText = Boolean(
      target
      && target.startContainer === text
      && target.endContainer === text
      && target.startOffset === 0
      && target.endOffset === text.length
    );
    return targetCoversText || fullSelection
      ? current.anchorNode.parentElement
      : undefined;
  })();
  /**
   * Projects one raw boundary through the projection both caret owners share,
   * under the provenance the baseline in hand actually proves.
   */
  /**
   * The canonical spelling of a terminal browser NBSP artifact, or null. The
   * browser stores the ASCII space before a collapsed caret as a trailing NBSP
   * when that space is the last character it rendered. The accepted baseline
   * in hand already carries the ASCII space the artifact replaced, so a
   * deletion whose own target is exactly that terminal artifact is witnessed:
   * project this one node under its ASCII spelling without touching the live
   * text node or the caret.
   */
  let deletedTerminalNbsp: Readonly<{ data: string; node: Text }> | null = null;
  const mapBoundary = (
    node: Node,
    offset: number
  ): Readonly<{ sourceOffset: number; visualOffset: number }> | null => {
    if (localCertificate?.textNode === node && node instanceof Text) {
      const sourceOffset = literalTextBoundary(
        node.data,
        offset,
        sourceMarkdown,
        localCertificate.sourceStart
      );
      const visualOffset = literalTextBoundary(
        node.data,
        offset,
        baselineVisualMarkdown,
        localCertificate.visualStart
      );
      // A retained local certificate is the only authority for this cloned
      // root. Do not fall through to its copied formal id when the certificate
      // cannot prove this endpoint.
      return null !== sourceOffset && null !== visualOffset
        ? { sourceOffset, visualOffset }
        : null;
    }
    const boundary = nativeVisualTextBoundary(surface, node, offset);
    if (!boundary) return null;
    const result =
      mapTextBoundaryFromInterval(
        surface,
        boundary.node,
        boundary.offset,
        baselineVisualMarkdown,
        intervalMapFor(),
        acceptedPrefixOnly,
        deletedTerminalNbsp?.node === boundary.node
          ? deletedTerminalNbsp.data
          : undefined
      )
      ?? (() => {
        const decoded = acceptedDecodedBlockSelection(
          surface,
          {
            anchorNode: boundary.node,
            anchorOffset: boundary.offset,
            focusNode: boundary.node,
            focusOffset: boundary.offset
          },
          sourceMarkdown,
          baselineVisualMarkdown,
          acceptedEditMap
        );
        return decoded
          ? {
              sourceOffset: decoded.source.start,
              visualOffset: decoded.visual.start
            }
          : null;
      })();
    return result;
  };
  const targetRange = event.getTargetRanges?.()[0];
  const currentCollapsed =
    current.anchorNode === current.focusNode
    && current.anchorOffset === current.focusOffset;
  const targetRangeMatchesCurrent = Boolean(
    targetRange
    && targetRange.startContainer === current.anchorNode
    && targetRange.endContainer === current.focusNode
    && targetRange.startOffset === current.anchorOffset
    && targetRange.endOffset === current.focusOffset
  );
  if (
    'deleteContentBackward' === event.inputType
    && currentCollapsed
    && current.anchorNode instanceof Text
  ) {
    const artifact = current.anchorNode;
    if (
      artifact.data.endsWith('\u00a0')
      && artifact.data.indexOf('\u00a0') === artifact.data.length - 1
      && current.anchorOffset === artifact.data.length
      && targetRange?.startContainer === artifact
      && targetRange.endContainer === artifact
      && targetRange.startOffset === artifact.data.length - 1
      && targetRange.endOffset === artifact.data.length
      && !artifact.parentElement?.closest('pre, code, [contenteditable="false"]')
    ) {
      const data = artifact.data.replace(/\u00a0/gu, ' ');
      const source = intervalMapFor().source;
      const sourceOffset = source.indexOf(data);
      if (
        sourceOffset >= 0
        && ' ' === source[sourceOffset + data.length - 1]
        && baselineVisualMarkdown.indexOf(data) >= 0
      ) {
        deletedTerminalNbsp = { data, node: artifact };
      }
    }
  }
  // A retained local paragraph may carry a formal id copied by native Enter,
  // while its escaped source spelling is not the formal row that id names.
  // Project both current endpoints through the authenticated literal run before
  // trying memory, interval, or formal-id mapping.
  const localMapped = localCertificate
    && current.anchorNode === localCertificate.textNode
    && current.focusNode === localCertificate.textNode
    ? (() => {
        const anchor = mapBoundary(current.anchorNode, current.anchorOffset);
        const focus = mapBoundary(current.focusNode, current.focusOffset);
        return anchor && focus
          ? {
              source: selectionRange(anchor.sourceOffset, focus.sourceOffset),
              visual: selectionRange(anchor.visualOffset, focus.visualOffset)
            }
          : null;
      })()
    : null;
  // The remembered boundary proves itself, so it is tried before the interval
  // projection: an authenticated memory result needs neither a whole-document
  // alignment nor a block-prefix serialization.
  const memoryMapped = localMapped ?? (
    memory
      && (
        !currentCollapsed
        || !event.inputType.startsWith('delete')
        || intervalMapFor().source.indexOf(current.anchorNode.data) >= 0
      )
      ? mapSelectionFromMemory(
          memory,
          current,
          visualLength,
          sourceMarkdown,
          baselineVisualMarkdown
        )
      : null
  );
  const intervalMapped = memoryMapped
    ? null
    : mapSelectionFromInterval(
        surface,
        current,
        baselineVisualMarkdown,
        intervalMapFor(),
        acceptedPrefixOnly,
        deletedTerminalNbsp ?? undefined
      );
  const decodedMapped = !memoryMapped && !intervalMapped
    ? acceptedDecodedBlockSelection(
        surface,
        current,
        sourceMarkdown,
        baselineVisualMarkdown,
        acceptedEditMap
      )
    : null;
  if (
    !intervalMapped
    && !memoryMapped
    && !decodedMapped
    && current.anchorNode instanceof Text
    && current.focusNode instanceof Text
    && event.inputType.startsWith('delete')
    && intervalMapFor().source.indexOf(current.anchorNode.data) < 0
  ) return null;
  const mapped = memoryMapped ?? intervalMapped ?? decodedMapped;
  if (!mapped) return null;

  const currentMapped = mapped;
  // The boundary every raw delta moves from: the earlier end of the mapped
  // selection, which is where its canonical and its baseline start sit.
  const mappedBoundary = {
    offset: Math.min(current.anchorOffset, current.focusOffset),
    sourceOffset: currentMapped.source.start,
    visualOffset: currentMapped.visual.start
  } as const;
  /**
   * Projects a raw boundary of this node through the same canonical owner as
   * the caret, then through the proved delta from the mapped boundary: a raw
   * distance is a projection only while both markdown spaces repeat the raw
   * text it spans.
   */
  const projectBoundary = (
    node: Text,
    offset: number
  ): Readonly<{ sourceOffset: number; visualOffset: number }> | null => {
    const projected = mapBoundary(node, offset);
    if (projected) return projected;
    return provedLinearBoundary(
      node,
      offset,
      mappedBoundary,
      sourceMarkdown,
      baselineVisualMarkdown
    );
  };

  let visualSelection = currentMapped.visual;
  const nativeSelection = surface.ownerDocument.defaultView?.getSelection();
  const collapsedHistorySourceOffset = currentCollapsed
    ? memoryMapped
      ? currentMapped.source.start
      : mapBoundary(current.anchorNode, current.anchorOffset)?.sourceOffset ?? null
    : null;
  const historySource = null !== collapsedHistorySourceOffset
    ? { end: collapsedHistorySourceOffset, start: collapsedHistorySourceOffset }
    : currentMapped.source;
  const historySelectionBefore: VisualSelectionSourceRange = {
    ...historySource,
    direction: nativeSelection
      ? nativeDocumentSelectionDirection(nativeSelection)
      : 'none'
  };
  let textSelection = selectionRange(current.anchorOffset, current.focusOffset);
  if (
    targetRange &&
    targetRange.startContainer instanceof Text &&
    targetRange.endContainer instanceof Text &&
    !(currentCollapsed && targetRangeMatchesCurrent)
  ) {
    const start = mapBoundary(
      targetRange.startContainer,
      targetRange.startOffset
    );
    const end = mapBoundary(targetRange.endContainer, targetRange.endOffset);
    if (start && end) {
      const sourceStart = start.sourceOffset;
      const sourceEnd = end.sourceOffset;
      const visualStart = start.visualOffset;
      const visualEnd = end.visualOffset;
      if (
        sourceStart >= 0 &&
        sourceEnd >= sourceStart &&
        sourceEnd <= sourceMarkdown.length &&
        visualStart >= 0 &&
        visualEnd >= visualStart &&
        visualEnd <= visualLength
      ) {
        textSelection = selectionRange(
          targetRange.startOffset,
          targetRange.startContainer === targetRange.endContainer
            ? targetRange.endOffset
            : targetRange.startOffset
        );
        const crossTextTarget =
          targetRange.startContainer !== targetRange.endContainer
            ? (() => {
                const startOwner = directVisualBlockForSelectionNode(
                  surface,
                  targetRange.startContainer
                );
                const endOwner = directVisualBlockForSelectionNode(
                  surface,
                  targetRange.endContainer
                );
                return startOwner && startOwner === endOwner
                  ? { owner: startOwner }
                  : undefined;
              })()
            : undefined;
        return {
          data: event.data,
          ...(emptyParagraphTarget ? { emptyParagraphTarget } : {}),
          hasTargetRange: true,
          ...(crossTextTarget ? { crossTextTarget } : {}),
          historySelectionBefore,
          inputType: event.inputType,
          sourceSelection: { end: sourceEnd, start: sourceStart },
          textData: current.anchorNode.data,
          textNode: current.anchorNode,
          textSelection,
          visualSelection: { end: visualEnd, start: visualStart }
        };
      }
    }
  }
  if (targetRange && !targetRangeMatchesCurrent) {
    const targetStartNode = targetRange.startContainer;
    const targetEndNode = targetRange.endContainer;
    const targetStart = mapBoundary(targetStartNode, targetRange.startOffset);
    const targetEnd = mapBoundary(targetEndNode, targetRange.endOffset);
    if (!targetStart || !targetEnd) return null;
  }
  if (
    targetRange &&
    targetRange.startContainer === current.anchorNode &&
    targetRange.endContainer === current.anchorNode
  ) {
    textSelection = selectionRange(
      targetRange.startOffset,
      targetRange.endOffset
    );
    // A target identical to the collapsed boundary already mapped is that
    // mapping: re-projecting it would serialize the owning block and its prefix
    // for a boundary the intent already holds.
    const targetIsMappedBoundary =
      currentCollapsed && targetRangeMatchesCurrent;
    const start = targetIsMappedBoundary
      ? {
          sourceOffset: currentMapped.source.start,
          visualOffset: currentMapped.visual.start
        }
      : projectBoundary(current.anchorNode, textSelection.start);
    const end = targetIsMappedBoundary
      ? {
          sourceOffset: currentMapped.source.end,
          visualOffset: currentMapped.visual.end
        }
      : projectBoundary(current.anchorNode, textSelection.end);
    if (!start || !end) return null;
    if (
      end.sourceOffset < start.sourceOffset
      || end.sourceOffset > sourceMarkdown.length
      || end.visualOffset < start.visualOffset
      || end.visualOffset > visualLength
    ) {
      return null;
    }
    return {
      data: event.data,
      ...(emptyParagraphTarget ? { emptyParagraphTarget } : {}),
      hasTargetRange: true,
      historySelectionBefore,
      inputType: event.inputType,
      sourceSelection: { end: end.sourceOffset, start: start.sourceOffset },
      textData: current.anchorNode.data,
      textNode: current.anchorNode,
      textSelection,
      visualSelection: { end: end.visualOffset, start: start.visualOffset }
    };
  }

  if (
    'deleteContentBackward' === event.inputType &&
    current.anchorOffset === current.focusOffset
  ) {
    const start = Math.max(
      0,
      current.anchorOffset -
        codePointLengthBefore(current.anchorNode, current.anchorOffset)
    );
    textSelection = { end: current.anchorOffset, start };
  } else if (
    'deleteContentForward' === event.inputType &&
    current.anchorOffset === current.focusOffset
  ) {
    textSelection = {
      end:
        current.anchorOffset +
        codePointLengthAfter(current.anchorNode, current.anchorOffset),
      start: current.anchorOffset
    };
  } else if (
    [
      'deleteByCut',
      'insertFromComposition',
      'insertLineBreak',
      'insertReplacementText',
      'insertText'
    ].includes(event.inputType)
  ) {
    // The selection is the edit itself: both endpoints were mapped
    // independently, so the canonical interval is theirs, not a raw length.
    textSelection = selectionRange(current.anchorOffset, current.focusOffset);
    visualSelection = currentMapped.visual;
    return {
      data: event.data,
      ...(emptyParagraphTarget ? { emptyParagraphTarget } : {}),
      hasTargetRange: false,
      inputType: event.inputType,
      historySelectionBefore,
      sourceSelection: {
        end: currentMapped.source.end,
        start: currentMapped.source.start
      },
      textData: current.anchorNode.data,
      textNode: current.anchorNode,
      textSelection,
      visualSelection
    };
  } else if (
    ['deleteWordBackward', 'deleteWordForward'].includes(event.inputType)
  ) {
    if (current.anchorOffset !== current.focusOffset) return null;
    textSelection =
      'deleteWordBackward' === event.inputType
        ? {
            end: current.anchorOffset,
            start: wordStartBefore(current.anchorNode, current.anchorOffset)
          }
        : {
            end: wordEndAfter(current.anchorNode, current.anchorOffset),
            start: current.anchorOffset
          };
  } else {
    return null;
  }

  // A computed endpoint is an offset in raw text, so it is projected through
  // the same canonical owner as the caret: deleting the raw character behind
  // an escape deletes the escape with it, and the caret endpoint keeps its own
  // mapping.
  const start = textSelection.start === mappedBoundary.offset
    ? {
        sourceOffset: currentMapped.source.start,
        visualOffset: currentMapped.visual.start
      }
    : projectBoundary(current.anchorNode, textSelection.start);
  const end = textSelection.end === mappedBoundary.offset
    ? {
        sourceOffset: currentMapped.source.start,
        visualOffset: currentMapped.visual.start
      }
    : projectBoundary(current.anchorNode, textSelection.end);
  if (!start || !end) return null;
  visualSelection = { end: end.visualOffset, start: start.visualOffset };
  const sourceStart = start.sourceOffset;
  const sourceEnd = end.sourceOffset;
  if (
    sourceStart < 0
    || sourceEnd < sourceStart
    || sourceEnd > sourceMarkdown.length
    || end.visualOffset < start.visualOffset
    || end.visualOffset > visualLength
  ) {
    return null;
  }
  return {
    data: event.data,
    ...(emptyParagraphTarget ? { emptyParagraphTarget } : {}),
    hasTargetRange: false,
    historySelectionBefore,
    inputType: event.inputType,
    sourceSelection: { end: sourceEnd, start: sourceStart },
    textData: current.anchorNode.data,
    textNode: current.anchorNode,
    textSelection,
    visualSelection
  };
}

function visualEmptyStructuralInputIntent(
  surface: HTMLElement,
  event: InputEvent,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  plainBody?: Readonly<{ body: HTMLElement; sourceLength: 0 | 2; sourceOffset: number }>
): VisualEmptyStructuralInput | null {
  if (
    ![
      'insertCompositionText',
      'insertFromComposition',
      'insertReplacementText',
      'insertText'
    ].includes(event.inputType) ||
    null === event.data
  )
    return null;
  const selection = surface.ownerDocument.defaultView?.getSelection();
  const anchorNode = selection?.anchorNode;
  const focusNode = selection?.focusNode;
  const plainEmptyParagraph = plainBody?.body === anchorNode;
  const emptyParagraphBoundary = plainEmptyParagraph
    && (0 === selection?.anchorOffset || 1 === selection?.anchorOffset);
  if (
    !selection?.isCollapsed ||
    !(anchorNode instanceof HTMLElement) ||
    anchorNode !== focusNode ||
    (!emptyParagraphBoundary && selection.anchorOffset !== 0) ||
    !surface.contains(anchorNode) ||
    (!anchorNode.closest('blockquote, ol, ul') && plainBody?.body !== anchorNode) ||
    !['P', 'LI'].includes(anchorNode.tagName) ||
    anchorNode.childNodes.length !== 1 ||
    !(anchorNode.firstChild instanceof HTMLBRElement)
  )
    return null;
  const target = event.getTargetRanges?.()[0];
  if (
    !target ||
    target.startContainer !== anchorNode ||
    target.endContainer !== anchorNode ||
    target.startOffset !== target.endOffset ||
    target.startOffset !== selection.anchorOffset
  )
    return null;
  const placeholder = anchorNode.firstChild;
  if (!(placeholder instanceof HTMLBRElement)) return null;
  const plain = plainBody?.body === anchorNode ? plainBody : null;
  const terminalOmission = Boolean(plain && anchorNode === surface.lastElementChild
    && serializeVisualMarkdownBlockFragment(Array.from(surface.children).slice(0, -1)
      .filter((node): node is HTMLElement => node instanceof HTMLElement)) === baselineVisualMarkdown);
  const mapped = plain
    ? { sourceOffset: plain.sourceOffset, visualOffset: terminalOmission
        ? baselineVisualMarkdown.length : visualSelectionVisualOffset(surface, baselineVisualMarkdown) }
    : visualEmptyStructuralBodySelection(surface, sourceMarkdown, baselineVisualMarkdown, baselineVisualMarkdown);
  if (!mapped) return null;
  if ('failure' in mapped) throw new Error(mapped.failure);
  if (plain && !terminalOmission && baselineVisualMarkdown.slice(mapped.visualOffset, mapped.visualOffset + 2) !== '  ') {
    throw new Error('visual-editor-empty-structural-input-map-failed');
  }
  const bodyPath = visualNodePath(surface, anchorNode);
  if (!bodyPath) throw new Error('visual-editor-selection-map-failed');
  return {
    body: anchorNode,
    bodyPath,
    beforeSurface: surface.cloneNode(true) as HTMLElement,
    data: event.data,
    inputType: event.inputType,
    placeholder,
    sourceMarkdown,
    sourceSelection: {
      end: mapped.sourceOffset + (plain ? plain.sourceLength : 0),
      start: mapped.sourceOffset
    },
    targetRange: {
      endNode: target.endContainer,
      // Chromium may expose the empty paragraph's caret after its placeholder
      // BR (P:1), while the structural owner consumes the same boundary as
      // P:0. Keep the native event authenticated above, then store the
      // canonical boundary used by the post-input DOM proof.
      endOffset: plainEmptyParagraph ? 0 : target.endOffset,
      startNode: target.startContainer,
      startOffset: plainEmptyParagraph ? 0 : target.startOffset
    },
    visualMarkdown: baselineVisualMarkdown,
    visualSelection: {
      end: mapped.visualOffset + (plain && !terminalOmission ? 2 : 0),
      start: mapped.visualOffset
    }
  };

}

function collapsedVisualSelection(surface: HTMLElement): boolean {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  return Boolean(
    selection?.isCollapsed &&
      selection.anchorNode &&
      surface.contains(selection.anchorNode)
  );
}

function visualNodePath(
  root: HTMLElement,
  node: Node
): ReadonlyArray<number> | null {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return null;
    const index = Array.from(parent.childNodes)
      .filter(
        (child) =>
          child === current || !(child instanceof Text && '' === child.data)
      )
      .indexOf(current as ChildNode);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === root ? path : null;
}

function captureVisualHistorySelection(
  surface: HTMLElement,
  structural?: () => Readonly<{
    blocks: ReadonlyArray<VisualStructuralBoundaryBlock>;
    recordedCaret: number;
    sourceMarkdown: string;
  }> | null
): VisualHistorySelection | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    structural
    && selection?.isCollapsed
    && selection.anchorNode === surface
    && selection.focusNode === surface
  ) {
    // A caret the structural owner left in the parent gap beside a certified
    // thematic break has no descendant boundary. It is captured as the
    // surface's own child offset, which stays stable while the DOM does.
    const proof = structural();
    const gap = proof
      ? visualStructuralBoundarySelection(
          surface,
          proof.blocks,
          proof.sourceMarkdown,
          proof.recordedCaret
        )
      : null;
    if (gap) return gap;
  }
  if (
    !selection?.rangeCount ||
    !selection.anchorNode ||
    !selection.focusNode ||
    selection.anchorNode === surface ||
    selection.focusNode === surface ||
    !surface.contains(selection.anchorNode) ||
    !surface.contains(selection.focusNode)
  )
    return null;
  const anchorPath = visualNodePath(surface, selection.anchorNode);
  const focusPath = visualNodePath(surface, selection.focusNode);
  if (!anchorPath || !focusPath) return null;
  const range = surface.ownerDocument.createRange();
  try {
    range.setStart(selection.anchorNode, selection.anchorOffset);
    range.setEnd(selection.focusNode, selection.focusOffset);
  } catch (error) {
    const normalized = captureVisualSelection(surface);
    if (!normalized) throw error;
    const normalizedAnchorPath = visualNodePath(surface, normalized.anchorNode);
    const normalizedFocusPath = visualNodePath(surface, normalized.focusNode);
    if (!normalizedAnchorPath || !normalizedFocusPath) throw error;
    return {
      anchor: {
        offset: normalized.anchorOffset,
        path: normalizedAnchorPath
      },
      backward: normalized.backward,
      focus: {
        offset: normalized.focusOffset,
        path: normalizedFocusPath
      }
    };
  }
  const forward =
    range.startContainer === selection.anchorNode &&
    range.startOffset === selection.anchorOffset;
  return {
    anchor: { offset: selection.anchorOffset, path: anchorPath },
    backward: !selection.isCollapsed && !forward,
    focus: { offset: selection.focusOffset, path: focusPath }
  };
}

function visualNodeAtPath(
  root: HTMLElement,
  path: ReadonlyArray<number>
): Node | null {
  let current: Node = root;
  for (const index of path) {
    const isCodePlaceholder =
      current instanceof HTMLElement &&
      current.hasAttribute('data-easymde-visual-code-placeholder');
    const child = Array.from(current.childNodes).filter(
      (candidate) =>
        isCodePlaceholder ||
        !(candidate instanceof Text && '' === candidate.data)
    )[index];
    if (!child) return null;
    current = child;
  }
  return current;
}
function visualHistorySelectionNeedsNormalization(
  surface: HTMLElement
): boolean {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return true;
  return [selection.anchorNode, selection.focusNode].some((node) => {
    let current: Node | null = node;
    while (current && current !== surface) {
      const parent: Node | null = current.parentNode;
      if (!parent) return true;
      const children = Array.from(parent.childNodes);
      if (children.some((child, index) =>
        child instanceof Text && children[index + 1] instanceof Text
      )) return true;
      current = parent;
    }
    return current !== surface;
  });
}

function pairedVisualHistorySelection(
  surface: HTMLElement,
  selection: VisualHistorySelection,
  snapshotHtml: string,
  domPairVerified = false
): VisualHistorySelection | null {
  if (!visualHistorySelectionNeedsNormalization(surface)) {
    return domPairVerified
      ? { ...selection, nativePathPaired: true }
      : null;
  }
  const clone = surface.cloneNode(true) as HTMLElement;
  const anchorNode = visualNodeAtPath(clone, selection.anchor.path);
  const focusNode = visualNodeAtPath(clone, selection.focus.path);
  if (!anchorNode || !focusNode) return null;
  const textPoint = (
    node: Node,
    offset: number
  ): Readonly<{ parent: Node; runOffset: number; runStart: Text }> | null => {
    if (!(node instanceof Text) || !node.parentNode) return null;
    const parent = node.parentNode;
    const children = Array.from(parent.childNodes);
    const index = children.indexOf(node);
    if (index < 0) return null;
    let start = index;
    while (start > 0 && children[start - 1] instanceof Text) start -= 1;
    let runOffset = offset;
    for (let childIndex = start; childIndex < index; childIndex += 1) {
      const child = children[childIndex];
      if (child instanceof Text) runOffset += child.data.length;
    }
    const runStart = children
      .slice(start, index + 1)
      .find((child): child is Text => child instanceof Text && child.data.length > 0);
    return runStart ? { parent, runOffset, runStart } : null;
  };
  const anchorPoint = textPoint(anchorNode, selection.anchor.offset);
  const focusPoint = textPoint(focusNode, selection.focus.offset);
  const anchorRange = clone.ownerDocument.createRange();
  const focusRange = clone.ownerDocument.createRange();
  try {
    anchorRange.setStart(anchorNode, selection.anchor.offset);
    anchorRange.collapse(true);
    focusRange.setStart(focusNode, selection.focus.offset);
    focusRange.collapse(true);
  } catch {
    return null;
  }
  clone.normalize();
  if (clone.innerHTML !== snapshotHtml) return null;
  const resolve = (
    point: Readonly<{ parent: Node; runOffset: number; runStart: Text }> | null,
    range: Range
  ): Readonly<{ node: Node; offset: number }> => {
    if (point && point.runStart.parentNode === point.parent) {
      return {
        node: point.runStart,
        offset: Math.min(point.runOffset, point.runStart.data.length)
      };
    }
    return { node: range.startContainer, offset: range.startOffset };
  };
  const normalizedAnchor = resolve(anchorPoint, anchorRange);
  const normalizedFocus = resolve(focusPoint, focusRange);
  const normalizedAnchorPath = visualNodePath(clone, normalizedAnchor.node);
  const normalizedFocusPath = visualNodePath(clone, normalizedFocus.node);
  if (!normalizedAnchorPath || !normalizedFocusPath) return null;
  return {
    ...selection,
    anchor: {
      offset: normalizedAnchor.offset,
      path: normalizedAnchorPath
    },
    focus: {
      offset: normalizedFocus.offset,
      path: normalizedFocusPath
    },
    nativePathPaired: true
  };
}

function restoreVisualHistorySelection(
  surface: HTMLElement,
  snapshot: VisualHistorySelection | null
): boolean {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) return false;
  if (!snapshot) {
    selection.removeAllRanges();
    return true;
  }
  const anchorNode = visualNodeAtPath(surface, snapshot.anchor.path);
  const focusNode = visualNodeAtPath(surface, snapshot.focus.path);
  if (!anchorNode || !focusNode) return false;
  try {
    selection.removeAllRanges();
    selection.setBaseAndExtent(
      anchorNode,
      snapshot.anchor.offset,
      focusNode,
      snapshot.focus.offset
    );
    return true;
  } catch {
    return false;
  }
}

function placeVisualSelectionFromSourceRange(
  surface: HTMLElement,
  sourceMarkdown: string,
  visualMarkdown: string,
  selectionRange: VisualSelectionSourceRange
): void {
  placeVisualCaretFromSourceOffset(
    surface,
    sourceMarkdown,
    visualMarkdown,
    selectionRange.start
  );
  const selection = surface.ownerDocument.defaultView?.getSelection();
  const anchorNode = selection?.anchorNode;
  const anchorOffset = selection?.anchorOffset;
  if (!selection || !anchorNode || anchorOffset === undefined) {
    throw new Error('visual-editor-selection-restore-failed');
  }
  placeVisualCaretFromSourceOffset(
    surface,
    sourceMarkdown,
    visualMarkdown,
    selectionRange.end
  );
  const focusNode = selection.anchorNode;
  const focusOffset = selection.anchorOffset;
  if (!focusNode || focusOffset === undefined) {
    throw new Error('visual-editor-selection-restore-failed');
  }
  selection.removeAllRanges();
  if ('backward' === selectionRange.direction) {
    selection.setBaseAndExtent(
      focusNode,
      focusOffset,
      anchorNode,
      anchorOffset
    );
  } else {
    selection.setBaseAndExtent(
      anchorNode,
      anchorOffset,
      focusNode,
      focusOffset
    );
  }
}

function visualFragmentNodePath(root: Node, node: Node): ReadonlyArray<number> {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) throw new Error('visual-editor-selection-map-failed');
    const index = Array.prototype.indexOf.call(parent.childNodes, current);
    if (index < 0) throw new Error('visual-editor-selection-map-failed');
    path.unshift(index);
    current = parent;
  }
  if (current !== root) {

    throw new Error('visual-editor-selection-map-failed');
  }
  return path;
}

/** Restore only a whole source unit boundary from the same accepted-row proof. */
function acceptedDecodedPrefixBoundary(
  block: HTMLElement,
  endpointMarkdown: string,
  sourceOffsetInBlock: number
): Readonly<{ node: Node; offset: number }> | null {
  if (!coversMarkdownUnits(endpointMarkdown, sourceOffsetInBlock, sourceOffsetInBlock)) {
    return null;
  }
  const correspondence = acceptedDecodedRowCorrespondence(block, endpointMarkdown);
  if (!correspondence) return null;
  const index = correspondence.sourceOffsets.indexOf(sourceOffsetInBlock);
  if (index < 0) return null;
  if (index === 0) return { node: block, offset: 0 };
  const boundary = correspondence.boundaries[index - 1];
  return boundary ? { node: boundary.node, offset: boundary.offset } : null;
}

/**
 * The accepted block's own visible text end. Read-only descendants are never
 * content, so a trailing protected node ends the editable text before it.
 */
function acceptedBlockTextEndBoundary(
  block: HTMLElement
): Readonly<{ node: Node; offset: number }> {
  const visit = (node: Node): Readonly<{ node: Node; offset: number }> | null => {
    if (node instanceof Text) {
      return node.data.length > 0 ? { node, offset: node.data.length } : null;
    }
    if (
      node instanceof HTMLElement
      && node.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
    ) {
      return null;
    }
    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
      const child = node.childNodes[index];
      if (!child) continue;
      if (
        child instanceof HTMLElement
        && child.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
      ) {
        return { node, offset: index + 1 };
      }
      const boundary = visit(child);
      if (boundary) return boundary;
    }
    return { node, offset: node.childNodes.length };
  };
  return visit(block) ?? { node: block, offset: block.childNodes.length };
}

function acceptedVisualCaretBoundaryFromSourceOffset(
  clone: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  sourceOffset: number
): Readonly<{ node: Node; offset: number }> {
  try {
    return visualCaretBoundaryFromSourceOffset(
      clone,
      sourceMarkdown,
      baselineVisualMarkdown,
      sourceOffset
    );
  } catch (error) {
    const recoverableErrors = new Set([
      'visual-editor-markdown-merge-ambiguous',
      'visual-editor-markdown-merge-failed',
      'visual-editor-selection-map-budget-exceeded',
      'visual-editor-selection-map-failed'
    ]);
    if (!(error instanceof Error) || !recoverableErrors.has(error.message)) {
      throw error;
    }
    // Empty list/paragraph bodies hide structural Markdown separators. Probe
    // only their explicit DOM boundaries and require an exact source match.
    const structuralBodies = Array.from(
      clone.querySelectorAll<HTMLElement>('p, li')
    ).filter(
      (body) =>
        body.childNodes.length === 1 &&
        body.firstChild instanceof HTMLBRElement &&
        !body.closest('pre, code, [contenteditable="false"]')
    );
    for (const body of structuralBodies) {
      for (const offset of [0, body.childNodes.length]) {
        try {
          const mapped = visualBoundarySourceOffset(
            clone,
            sourceMarkdown,
            baselineVisualMarkdown,
            body,
            offset
          );
          if (mapped === sourceOffset) {
            return { node: body, offset };
          }
        } catch (candidateError) {
          if (
            !(candidateError instanceof Error) ||
            !recoverableErrors.has(candidateError.message)
          ) {
            throw candidateError;
          }
        }
      }
    }
    throw error;
  }
}

function canonicalReplacementBoundaryForBlock(
  block: HTMLElement,
  blockId: string,
  sourceMarkdown: string,
  sourceRange: Readonly<{ end: number; start: number }>,
  change: Readonly<{
    from: number;
    insert: string;
    to: number;
  }>,
  nativeTextSelection: NativeTextReplacementBoundary | null
): CanonicalReplacementBoundary | null {
  if (
    !blockId ||
    !nativeTextSelection ||
    change.insert !== '' ||
    change.from < sourceRange.start ||
    change.to > sourceRange.end ||
    change.to < change.from ||
    canonicalChangeRemovesVisualBlock(sourceMarkdown, sourceRange, change)
  ) {
    return null;
  }
  const selectedSource = sourceMarkdown.slice(change.from, change.to);
  if (!selectedSource) return null;
  const clone = block.cloneNode(true) as HTMLElement;
  const sourceBlockMarkdown = serializeVisualMarkdownBlockFragment([clone]);
  let textNode: Node = clone;
  for (const index of nativeTextSelection.path) {
    const child = textNode.childNodes[index];
    if (!child) return null;
    textNode = child;
  }
  if (!(textNode instanceof Text)) return null;
  const selectedAt = nativeTextSelection.start;
  if (
    selectedAt < 0 ||
    nativeTextSelection.end <= selectedAt ||
    nativeTextSelection.end > textNode.length ||
    textNode.data.slice(selectedAt, nativeTextSelection.end) !== selectedSource
  ) {
    return null;
  }
  const text = textNode;
  text.data =
    text.data.slice(0, selectedAt) +
    text.data.slice(selectedAt + selectedSource.length);
  let caretNode: Node = text;
  let caretOffset = selectedAt;
  if (text.data.length === 0) {
    let body = text.parentElement;
    while (body && body !== clone && !['LI', 'P'].includes(body.tagName)) {
      body = body.parentElement;
    }
    if (
      body?.childNodes.length !== 1 ||
      body?.firstChild !== text
    ) {
      return null;
    }
    const listItem =
      body.tagName === 'P' && body.parentElement?.tagName === 'LI'
        ? body.parentElement
        : null;
    if (listItem) {
      body.remove();
      caretNode = listItem;
    } else {
      body.replaceChildren(clone.ownerDocument.createElement('br'));
      caretNode = body;
    }
    caretOffset = 0;
  }
  return {
    blockId,
    caretOffset,
    caretPath: visualFragmentNodePath(clone, caretNode),
    postSelection: {
      direction: 'none',
      end: change.from,
      start: change.from
    },
    postSourceRange: {
      end: sourceRange.end - selectedSource.length,
      start: sourceRange.start
    },
    serializedBlock: serializeVisualMarkdownBlockFragment([clone]),
    sourceBlockMarkdown,
    sourceRange
  };
}

function nativeTextReplacementBoundaryForBlock(
  block: HTMLElement
): NativeTextReplacementBoundary | null {
  const selection = block.ownerDocument.defaultView?.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (
    range.startContainer !== range.endContainer ||
    !(range.startContainer instanceof Text) ||
    !block.contains(range.startContainer) ||
    range.startOffset === range.endOffset
  ) {
    return null;
  }
  return {
    end: range.endOffset,
    path: visualFragmentNodePath(block, range.startContainer),
    start: range.startOffset
  };
}

/**
 * Whether a serialized terminal row still spells the terminal source row.
 * Serialization canonicalizes Markdown spelling (setext headings become ATX,
 * `_` emphasis becomes `*`, escapes are resolved), so a byte comparison would
 * refuse a faithful row. The comparison keeps every letter and non-marker
 * character, removes only those canonical block/inline markers, and is still
 * false for a row whose text changed.
 */
function terminalRowSpellsSource(sourceRow: string, projection: string): boolean {
  const comparable = (text: string): string =>
    text
      .replace(/\r\n|\r/gu, '\n')
      .replace(/\\([\\`*_{}\[\]()#+\-.!~>|])/gu, '$1')
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gmu, '')
      .replace(/^[ \t]{0,3}(?:=+|-+)[ \t]*$/gmu, '')
      .replace(/_/gu, '*')
      .replace(/[ \t]+/gu, ' ')
      .trim();
  return comparable(sourceRow) === comparable(projection);
}

function placeVisualSelectionFromAcceptedSourceRange(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  selectionRange: VisualSelectionSourceRange,
  visualSelection: VisualHistorySelection | null,
  canonicalReplacement?: CanonicalReplacementBoundary
): void {
  const children = acceptedTopLevelVisualChildren(surface, editMap);
  const lineStarts = markdownLineStarts(sourceMarkdown);
  let previousEndLine = 0;
  const sourceRanges = editMap.blocks.map((block) => {
    if (
      !Number.isInteger(block.startLine) ||
      !Number.isInteger(block.endLine) ||
      block.startLine < previousEndLine ||
      block.startLine < 0 ||
      block.endLine < block.startLine ||
      block.endLine > lineStarts.length
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    const start = lineStarts[block.startLine];
    const end =
      block.endLine === lineStarts.length
        ? sourceMarkdown.length
        : lineStarts[block.endLine];
    if (start === undefined || end === undefined || end < start) {

      throw new Error('visual-editor-selection-map-failed');
    }
    previousEndLine = block.endLine;
    return { end, start };
  });
  const thematicBreakIndex = sourceRanges.findIndex((range, index) => {
    const block = children[index];
    const mapBlock = editMap.blocks[index];
    if (
      !(block instanceof HTMLHRElement)
      || mapBlock?.editable !== true
      || mapBlock?.id !== block.getAttribute('data-easymde-visual-block-id')
      || visualThematicBreakTarget(surface, block) !== block
      || selectionRange.start !== range.start
      || !isVisualThematicBreakSource(sourceMarkdown, range)
      || 'none' === selectionRange.direction
    ) return false;
    const exact = visualThematicBreakSourceSelection(
      sourceMarkdown,
      range,
      selectionRange.direction
    );
    return (
      exact.start === selectionRange.start
      && exact.end === selectionRange.end
    );
  });
  if (thematicBreakIndex >= 0) {
    const thematicBreak = children[thematicBreakIndex];
    const selection = surface.ownerDocument.defaultView?.getSelection();
    const surfaceIndex = thematicBreak
      ? Array.from(surface.childNodes).indexOf(thematicBreak)
      : -1;
    if (!(thematicBreak instanceof HTMLHRElement) || !selection || surfaceIndex < 0) {
      throw new Error('visual-editor-selection-map-failed');
    }
    const range = surface.ownerDocument.createRange();
    range.selectNode(thematicBreak);
    selection.removeAllRanges();
    selection.addRange(range);
    if ('backward' === selectionRange.direction) {
      selection.setBaseAndExtent(
        surface,
        surfaceIndex + 1,
        surface,
        surfaceIndex
      );
    }
    return;
  }
  const firstIndex = sourceRanges.findIndex(
    (range) =>
      selectionRange.start <= range.end && selectionRange.end >= range.start
  );
  let lastIndex = -1;
  for (const [index, range] of sourceRanges.entries()) {
    if (
      selectionRange.end >= range.start &&
      selectionRange.start <= range.end
    ) {
      lastIndex = index;
    }
  }
  type AcceptedBoundary = Readonly<{
    blockIndex: number;
    nodePath: ReadonlyArray<number>;
    offset: number;
  }>;
  const mapBoundaryOnBlock = (
    blockIndex: number,
    sourceOffset: number
  ): AcceptedBoundary => {
    const block = children[blockIndex];
    const range = sourceRanges[blockIndex];
    if (
      !block ||
      !range ||
      !editMap.blocks[blockIndex]?.editable ||
      sourceOffset < range.start ||
      sourceOffset > range.end
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    const clone = block.cloneNode(true) as HTMLElement;
    const endpointMarkdown = sourceMarkdown.slice(range.start, range.end);
    // The formal renderer's fence markup carries no fence metadata: this owner
    // restores it from the source during capture, and the accepted mapping runs
    // before that restore. Restore it on the mapping clone from the same source
    // so the clone serializes back to the endpoint Markdown it is mapped
    // against.
    applyVisualCodeFenceMetadataFromSource(clone, endpointMarkdown);
    const endpointBaseline = serializeVisualMarkdownBlockFragment([clone]);
    // A fence block is mapped against the block itself, and that root's
    // boundary space starts at the code body: the live surface keeps the
    // opening delimiter line as fence metadata instead of DOM text, so its
    // mapped offsets omit that line. Translate the source offset once here so
    // the accepted mapper receives offsets in its own root space.
    const rootOffset = visualCodeFenceRootSourceOffset(
      clone,
      endpointMarkdown,
      sourceOffset - range.start
    );
    if (rootOffset < 0) {
      throw new Error('visual-editor-selection-map-failed');
    }
    let boundary: Readonly<{ node: Node; offset: number }>;
    try {
      boundary = acceptedVisualCaretBoundaryFromSourceOffset(
        clone,
        endpointMarkdown,
        endpointBaseline,
        rootOffset
      );
    } catch (error) {
      const documentedFailure = Boolean(
        error instanceof Error
        && 'visual-editor-selection-map-failed' === error.message
      );
      const code = clone.matches('pre')
        ? clone.querySelector<HTMLElement>(':scope > code')
        : null;
      // A canonical caret at this block's text tail is the same point as the
      // accepted block's visible end, including when the renderer decoded the
      // source's backslash-escaped fence markers (shorter visible text). Only
      // a tail whose remaining source bytes are line endings takes this path;
      // every interior offset keeps the explicit failure.
      const remaining = sourceMarkdown.slice(sourceOffset, range.end);
      const textTail = documentedFailure && !code
        && (sourceOffset === range.end || /^[\r\n]+$/u.test(remaining));
      const decodedBoundary = documentedFailure && !code
        ? acceptedDecodedPrefixBoundary(
            clone,
            endpointMarkdown,
            sourceOffset - range.start
          )
        : null;
      if (textTail) {
        // Escaped marker rows use the same complete-unit proof as every other
        // endpoint; ordinary unchanged text retains its exact-spelling proof.
        if (
          clone.querySelector(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
          || (!acceptedDecodedRowCorrespondence(clone, endpointMarkdown)
            && (clone.textContent ?? '').replace(/\u200b/gu, '').trimEnd()
              !== endpointMarkdown.trimEnd())
        ) {
          throw error;
        }
        boundary = acceptedBlockTextEndBoundary(clone);
      } else if (decodedBoundary) {
        boundary = decodedBoundary;
      } else if (
        sourceOffset !== range.end
        || !code
        || !documentedFailure
      ) {
        // A marker projection that cannot even be serialized is not a stale
        // document, a protection failure or a history mismatch: it is this
        // accepted row's own inability to place the offset. It is reported as
        // that single documented code so exactly the bounded presentation
        // policy can decide it, and every other failure keeps its own identity.
        if (!documentedFailure) {
          throw new Error('visual-editor-selection-map-failed');
        }
        throw error;
      } else {
        const endRange = clone.ownerDocument.createRange();
        endRange.selectNodeContents(code!);
        endRange.collapse(false);
        boundary = { node: endRange.startContainer, offset: endRange.startOffset };
      }
    }
    if (boundary.node !== clone && !clone.contains(boundary.node)) {

      throw new Error('visual-editor-selection-map-failed');
    }
    return {
      blockIndex,
      nodePath: visualFragmentNodePath(clone, boundary.node),
      offset: boundary.offset
    };
  };
  const liveBoundary = (
    boundary: AcceptedBoundary
  ): Readonly<{ node: Node; offset: number }> => {
    const block = children[boundary.blockIndex];
    if (!block) throw new Error('visual-editor-selection-map-failed');
    let node: Node = block;
    for (const index of boundary.nodePath) {
      const child = node.childNodes[index];
      if (!child) throw new Error('visual-editor-selection-map-failed');
      node = child;
    }
    return { node, offset: boundary.offset };
  };
  const restoreCanonicalReplacementCaret = (): boolean => {
    if (!canonicalReplacement) return false;
    const blockIndex = editMap.blocks.findIndex(
      (block) => block.id === canonicalReplacement.blockId
    );
    const block = children[blockIndex];
    const range = sourceRanges[blockIndex];
    if (blockIndex < 0 || !block || !range) {
      throw new Error('visual-editor-canonical-change-preview-stale-boundary-identity');
    }
    if (
      range.start !== canonicalReplacement.postSourceRange.start ||
      range.end !== canonicalReplacement.postSourceRange.end
    ) {
      throw new Error('visual-editor-canonical-change-preview-stale-boundary-range');
    }
    if (
      canonicalReplacement.postSelection.start !==
        canonicalReplacement.postSelection.end ||
      canonicalReplacement.postSelection.start !== selectionRange.start
    ) {
      throw new Error('visual-editor-canonical-change-preview-stale-boundary-post');
    }
    const serializedBlock = serializeVisualMarkdownBlockFragment([block]);
    if (serializedBlock !== canonicalReplacement.serializedBlock) {
      // The accepted Preview render for the post-write Markdown may not own
      // this block yet: the Preview sink publishes the accepted snapshot and
      // replaces the surface DOM on its own ordering. While the block still
      // serializes to its pre-write value that is a bounded adoption wait,
      // not a stale document; any other difference stays an explicit
      // staleness failure.
      if (serializedBlock === canonicalReplacement.sourceBlockMarkdown) {
        throw new Error(VISUAL_CANONICAL_ADOPTION_PENDING_CODE);
      }
      throw new Error(VISUAL_CANONICAL_STALE_SERIALIZATION_CODE);
    }
    const clone = block.cloneNode(true) as HTMLElement;
    const cloneNode = (() => {
      let node: Node = clone;
      for (const index of canonicalReplacement.caretPath) {
        const child = node.childNodes[index];
        if (!child) throw new Error('visual-editor-selection-map-failed');
        node = child;
      }
      return node;
    })();
    const endpointMarkdown = sourceMarkdown.slice(range.start, range.end);
    const endpointBaseline = serializeVisualMarkdownBlockFragment([clone]);
    // The block above IS the operation's own result (its serialization matched
    // exactly). What may still be unrepresentable is the CARET: an accepted
    // edit can leave adjacent bytes the renderer collapses, and a caret between
    // them has no DOM position. That is a presentation question, not a
    // provenance one, so this restore declines and the caller's ordinary exact
    // accepted mapping (and its own closed failure) decides.
    let mapped: number | null;
    try {
      mapped = visualBoundarySourceOffset(
        clone,
        endpointMarkdown,
        endpointBaseline,
        cloneNode,
        canonicalReplacement.caretOffset
      );
    } catch (error) {
      if (
        error instanceof Error
        && (
          'visual-editor-markdown-merge-ambiguous' === error.message
          || 'visual-editor-markdown-merge-failed' === error.message
          || 'visual-editor-selection-map-failed' === error.message
        )
      ) return false;
      throw error;
    }
    if (
      mapped !==
      canonicalReplacement.postSelection.start - canonicalReplacement.sourceRange.start
    ) return false;
    let liveNode: Node = block;
    for (const index of canonicalReplacement.caretPath) {
      const child = liveNode.childNodes[index];
      if (!child) throw new Error('visual-editor-selection-map-failed');
      liveNode = child;
    }
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-editor-selection-map-failed');
    selection.removeAllRanges();
    selection.collapse(liveNode, canonicalReplacement.caretOffset);
    return true;
  };
  const restoreAcceptedNativeSelection = (): boolean => {
    if (
      selectionRange.start !== selectionRange.end ||
      selectionRange.direction !== 'none' ||
      !visualSelection ||
      !restoreVisualHistorySelection(surface, visualSelection)
    )
      return false;
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (
      !selection?.isCollapsed ||
      !selection.anchorNode ||
      !selection.focusNode ||
      selection.anchorNode !== selection.focusNode ||
      selection.anchorOffset !== selection.focusOffset
    )
      return false;
    const sourceOffset = selectionRange.start;
    const matchingIndex = sourceRanges.findIndex(
      (range) => sourceOffset >= range.start && sourceOffset <= range.end
    );
    const range = sourceRanges[matchingIndex];
    const block = children[matchingIndex];
    if (!range || !block || !editMap.blocks[matchingIndex]?.editable) {
      return false;
    }
    try {
      const mapped = visualSelectionSourceRangeForBlocks(
        [block],
        sourceMarkdown.slice(range.start, range.end),
        serializeVisualMarkdownBlockFragment([block])
      );
      return (
        mapped.direction === 'none' &&
        mapped.start === sourceOffset - range.start &&
        mapped.end === sourceOffset - range.start
      );
    } catch {
      return false;
    }
  };
  if (
    selectionRange.start === selectionRange.end &&
    'none' === selectionRange.direction
  ) {
    const sourceOffset = selectionRange.start;
    if (restoreCanonicalReplacementCaret()) return;
    if (restoreAcceptedNativeSelection()) return;
    // A canonical caret on a certified thematic-break token edge belongs to
    // the parent gap immediately before/after that same direct-child row. The
    // row's own source slice proves the token, so an interior offset, a
    // replaced row, or a missing row leaves the generic mapping in charge.
    if (
      placeVisualStructuralBoundarySelection(
        surface,
        sourceMarkdown,
        visualStructuralBoundaryBlocks(
          surface,
          editMap.blocks.flatMap((block, index) => {
            const range = sourceRanges[index];
            return range
              ? [{
                  editable: block.editable === true,
                  end: range.end,
                  id: block.id,
                  start: range.start
                }]
              : [];
          })
        ),
        sourceOffset
      )
    ) {
      return;
    }
    // A collapsed caret exactly at the next paragraph's source start belongs
    // to that row, not the preceding row's trailing separators. Fence and
    // noncollapsed endpoint policies retain their existing owners.
    const paragraphStartIndex = sourceRanges.findIndex((range, index) =>
      range.start === sourceOffset && sourceRanges[index - 1]?.end === sourceOffset
      && children[index] instanceof HTMLParagraphElement && editMap.blocks[index]?.editable);
    const matchingIndex = paragraphStartIndex >= 0 ? paragraphStartIndex : sourceRanges.findIndex(
      (range) => sourceOffset >= range.start && sourceOffset <= range.end
    );
    let boundary: AcceptedBoundary | null = null;
    if (
      matchingIndex >= firstIndex &&
      matchingIndex <= lastIndex &&
      editMap.blocks[matchingIndex]?.editable
    ) {
      try {
        boundary = mapBoundaryOnBlock(matchingIndex, sourceOffset);
      } catch (error) {
        // A canonical caret at the document end sits one line terminator past
        // the last visible character. Cheap exact conditions first: only the
        // documented mapping failure, at the canonical document end, owned by
        // the terminal accepted block, with no later editable row. Nothing is
        // serialized for any other failure.
        const terminalRange = sourceRanges[matchingIndex];
        if (
          !(error instanceof Error)
          || 'visual-editor-selection-map-failed' !== error.message
          || sourceOffset !== sourceMarkdown.length
          || !terminalRange
          || terminalRange.end !== sourceMarkdown.length
        ) {
          throw error;
        }
        for (
          let index = matchingIndex + 1;
          index < editMap.blocks.length;
          index += 1
        ) {
          if (editMap.blocks[index]?.editable === true) throw error;
        }
        // The failure is only the invisible terminator when the terminal row
        // still projects onto its own source slice: its serialized Markdown
        // must equal that slice with the terminal line terminator removed. A
        // same-id replaced or unprovable row keeps the original failure.
        const terminalSource = sourceMarkdown.slice(
          terminalRange.start,
          terminalRange.end
        );
        const terminalTerminator =
          terminalSource.match(/[\r\n]+$/u)?.[0] ?? '';
        const terminal = children[matchingIndex];
        if (!terminal || 0 === terminalTerminator.length) throw error;
        let terminalProjection: string | null = null;
        try {
          terminalProjection = serializeVisualMarkdownBlockFragment([terminal]);
        } catch {
          terminalProjection = null;
        }
        const terminalBody = terminalSource.slice(
          0,
          terminalSource.length - terminalTerminator.length
        );
        if (
          null === terminalProjection
          || (
            terminalProjection !== terminalBody
            && !terminalRowSpellsSource(terminalBody, terminalProjection)
          )
        ) {
          throw error;
        }
        placeVisualCaretAtAcceptedPasteDocumentBoundary(surface, 'end');
        // The document-end presentation must still be the accepted terminal
        // row this map and ledger named; a live DOM that disagrees with them
        // keeps the original explicit failure.
        const placed = surface.ownerDocument.defaultView?.getSelection();
        if (
          !placed?.isCollapsed
          || !placed.anchorNode
          || (placed.anchorNode !== terminal
            && !terminal.contains(placed.anchorNode))
        ) {
          throw error;
        }
        return;
      }
    }
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-editor-selection-map-failed');
    const collapseAtTopLevelBoundary = (
      blockIndex: number,
      before: boolean
    ): boolean => {
      const block = children[blockIndex];
      if (!block) return false;
      const childIndex = Array.from(surface.childNodes).indexOf(block);
      if (childIndex < 0) return false;
      selection.removeAllRanges();
      selection.collapse(surface, before ? childIndex : childIndex + 1);
      return true;
    };
    if (boundary) {
      const live = liveBoundary(boundary);
      selection.removeAllRanges();
      selection.collapse(live.node, live.offset);
      return;
    }
    if (matchingIndex < 0) {
      let previousIndex = -1;
      for (const [index, range] of sourceRanges.entries()) {
        if (range.end <= sourceOffset) previousIndex = index;
      }
      const nextIndex = sourceRanges.findIndex(
        (range) => range.start >= sourceOffset
      );
      const gapStart =
        previousIndex >= 0 ? sourceRanges[previousIndex]?.end : 0;
      const gapEnd =
        nextIndex >= 0 ? sourceRanges[nextIndex]?.start : sourceMarkdown.length;
      if (
        gapStart !== undefined &&
        gapEnd !== undefined &&
        sourceOffset >= gapStart &&
        sourceOffset <= gapEnd &&
        /^\s*$/u.test(sourceMarkdown.slice(gapStart, gapEnd))
      ) {
        if (nextIndex >= 0 && collapseAtTopLevelBoundary(nextIndex, true)) {
          return;
        }
        if (
          previousIndex >= 0 &&
          collapseAtTopLevelBoundary(previousIndex, false)
        ) {
          return;
        }
        selection.removeAllRanges();
        selection.collapse(
          surface,
          nextIndex < 0 ? surface.childNodes.length : 0
        );
        return;
      }
    }
    const previousIndex = sourceRanges.reduce(
      (previous, range, index) =>
        range.end === sourceOffset && editMap.blocks[index]?.editable
          ? index
          : previous,
      -1
    );
    const nextIndex = sourceRanges.findIndex(
      (range, index) =>
        range.start === sourceOffset && editMap.blocks[index]?.editable
    );
    if (previousIndex >= 0) {
      boundary = mapBoundaryOnBlock(previousIndex, sourceOffset);
    } else if (nextIndex >= 0) {
      boundary = mapBoundaryOnBlock(nextIndex, sourceOffset);
    }
    if (boundary) {
      const live = liveBoundary(boundary);
      selection.removeAllRanges();
      selection.collapse(live.node, live.offset);
      return;
    }
    if (matchingIndex >= 0) {
      const matchingRange = sourceRanges[matchingIndex];
      if (
        matchingRange?.start === sourceOffset &&
        collapseAtTopLevelBoundary(matchingIndex, true)
      ) {
        return;
      }
      if (
        matchingRange?.end === sourceOffset &&
        collapseAtTopLevelBoundary(matchingIndex, false)
      ) {
        return;
      }
    }
    if (sourceOffset === 0 || sourceOffset === sourceMarkdown.length) {
      selection.removeAllRanges();
      selection.collapse(
        surface,
        sourceOffset === 0 ? 0 : surface.childNodes.length
      );
      return;
    }

    throw new Error('visual-editor-selection-map-failed');
  }
  if (firstIndex < 0 || lastIndex < firstIndex) {

    throw new Error('visual-editor-selection-map-failed');
  }
  const blocks = children.slice(firstIndex, lastIndex + 1);
  if (blocks.length !== lastIndex - firstIndex + 1) {

    throw new Error('visual-editor-selection-map-failed');
  }
  if (
    editMap.blocks
      .slice(firstIndex, lastIndex + 1)
      .some((block) => !block.editable)
  ) {

    throw new Error('visual-editor-selection-map-failed');
  }
  const locateEndpoint = (
    sourceOffset: number,
    preferPreviousBlock: boolean
  ): Readonly<{ blockIndex: number; offset: number }> => {
    const firstMatching = sourceRanges.findIndex(
      (range, index) =>
        sourceOffset >= range.start &&
        sourceOffset <= range.end &&
        (!preferPreviousBlock || sourceOffset !== range.start || 0 === index)
    );
    if (firstMatching < 0) {

      throw new Error('visual-editor-selection-map-failed');
    }
    const range = sourceRanges[firstMatching];
    if (!range) throw new Error('visual-editor-selection-map-failed');
    return {
      blockIndex: firstMatching,
      offset: sourceOffset - range.start
    };
  };
  const mapBoundary = (
    sourceOffset: number,
    preferPreviousBlock: boolean
  ): AcceptedBoundary => {
    const endpoint = locateEndpoint(sourceOffset, preferPreviousBlock);
    if (endpoint.blockIndex < firstIndex || endpoint.blockIndex > lastIndex) {

      throw new Error('visual-editor-selection-map-failed');
    }
    return mapBoundaryOnBlock(endpoint.blockIndex, sourceOffset);
  };
  const start = mapBoundary(selectionRange.start, false);
  const end = mapBoundary(selectionRange.end, true);
  const startBoundary = liveBoundary(start);
  const endBoundary = liveBoundary(end);
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-map-failed');
  selection.removeAllRanges();
  if ('backward' === selectionRange.direction) {
    selection.setBaseAndExtent(
      endBoundary.node,
      endBoundary.offset,
      startBoundary.node,
      startBoundary.offset
    );
  } else {
    selection.setBaseAndExtent(
      startBoundary.node,
      startBoundary.offset,
      endBoundary.node,
      endBoundary.offset
    );
  }
}

export function ImmersiveVisualEditor({
  documentSession,
  imageUploadEnabled,
  imagePasteUploadEnabled,
  onCanonicalDocumentChange,
  onDiagnostic,
  onDispose,
  onFailure,
  onMarkdownChange,
  onPendingChange,
  onReady,
  onTransferFailure,
  getGeneratedPreviewIdentity,
  pending,
  resumeCanonicalSelectionToken,
  prepareImageTarget,
  prepareImageTargetBySelection,
  prepareGeneratedContentTarget,
  prepareGeneratedContentTargetForSelection,
  previewSnapshot,
  previewStatus,
  requestPreview,
  surface
}: ImmersiveVisualEditorProps) {
  // A Preview sink can adopt the new DOM without changing the accepted
  // snapshot object identity. This tick is only advanced while a canonical
  // transfer is waiting for that adoption, giving the commit effect a real
  // wake-up source instead of relying on a synthetic revision.
  const [previewAdoptionTick, setPreviewAdoptionTick] = useState(0);
  const sourceMarkdownRef = useRef<string | null>(null);
  const visualMarkdownRef = useRef<string | null>(null);
  const acceptedHtmlRef = useRef<string | null>(null);
  const acceptedNodesRef = useRef<ReadonlyArray<Node> | null>(null);
  const acceptedCodeBodySnapshotsRef = useRef(new Map<number, HTMLElement>());
  const externalChangeReportedRef = useRef(false);
  const pendingTransferRef = useRef<PendingMarkdownTransfer | null>(null);
  /**
   * The owner's OWN last pure single-line insertion, in the canonical source it
   * produced. It exists for exactly one purpose: a presentation boundary this
   * owner captured for a transfer may still name the pre-insertion DOM offset
   * when the browser applied the text without moving the native caret. That is
   * the owner's own operation, so the boundary is advanced by the inserted
   * length - never re-read from the DOM, and never across a line break.
   */
  const ownerInsertionRef = useRef<
    Readonly<{ insert: string; source: string; visualFrom: number }> | null
  >(null);
  const pendingCanonicalCompositionRef = useRef(false);
  const contextMenuSelectionRef = useRef<VisualHistorySelection | null>(null);
  // The exact native selection this owner placed itself during an accepted
  // transfer (Preview adoption or in-place history restore). It is the same
  // shape and the same drift rule as the context-menu lease: any later
  // selection that differs from it drops the record. It exists so a pointer
  // demand on an image can tell an owner-placed selection apart from a
  // selection the user made, which the gesture policy must keep.
  const ownerPlacedSelectionRef = useRef<VisualHistorySelection | null>(null);
  const acceptedPasteDocumentBoundaryRef =
    useRef<AcceptedPasteDocumentBoundary | null>(null);
  const lastSelectionRef = useRef<VisualSelectionSourceRange | null>(null);
  const visualInputPendingRef = useRef(false);
  const pendingUnmappedVisualInputRef = useRef(false);
  const continuingUnmappedVisualInputRef = useRef(false);
  const visualInputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const visualHistoryDomPairTokenRef = useRef(0);
  const visualHistoryDomPairObserverRef = useRef<MutationObserver | null>(null);
  const canonicalAdoptionDeadlineRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const visualSelectionMemoryRef = useRef<VisualSelectionMemory | null>(null);
  // The raw native selection boundaries of the input event currently in
  // flight, captured before any mutation together with a one-time ownership
  // certificate: both boundary nodes were inside this surface at the moment
  // the gesture began. The certificate is an immutable witness - the native
  // edit may detach or remove the very node it deleted, so the post-mutation
  // state of a captured node proves nothing and is never re-checked. The
  // whole-value synchronizer consumes the witness once, at the write, and
  // uses it as the history event's pre-edit selection so Undo restores the
  // selection the user actually had, never a stale caret another view left
  // in the document.
  const pendingEditSelectionBeforeRef = useRef<Readonly<{
    anchorNode: Node;
    anchorOffset: number;
    certifiedInsideSurface: true;
    focusNode: Node;
    focusOffset: number;
    historySelectionBefore?: VisualSelectionSourceRange;
    historySelectionWitness?: VisualHistorySelectionWitness;
  }> | null>(null);
  // Exact roots admitted by the verified native paragraph-split producer.
  // This survives the formal map becoming temporarily inapplicable to a
  const visualSourceIntervalMapRef =
    useRef<VisualSourceIntervalMapRecord | null>(null);
  const pendingVisualIntentRef = useRef<VisualInputIntent | null>(null);
  const pendingVisualEmptyStructuralInputRef =
    useRef<VisualEmptyStructuralInput | null>(null);
  const ownedEmptyParagraphRef = useRef<Readonly<{
    body: HTMLParagraphElement;
    owner: object;
    source: string;
    revision: number;
    sourceLength: 0 | 2;
    sourceOffset: number;
  }> | null>(null);
  const emptyParagraphHistoryRef = useRef<Readonly<{
    depth: number;
    historyUndoDepth: number;
    markdown: string;
    sourceOffset: number;
  }> | null>(null);
  const pendingVisualIntentResultRef = useRef<PendingVisualIntent | null>(null);
  /**
   * Whether the canonical event this owner committed last was a native text
   * insertion in one code body. Only those commits continue the same typed run,
   * so only they may join the previous undo group; a structural or fence commit
   * ends the run. This mirrors CodeMirror's own adjacent-typing grouping
   * without ever joining an unrelated operation into one undo step.
   */
  const codeBodyTypingRunRef = useRef(false);
  const visualBaselineMaterializedRef = useRef(false);
  const capturedPreviewRevisionRef = useRef<number | null>(null);
  const previewSnapshotRevisionRef = useRef(previewSnapshot.revision);
  previewSnapshotRevisionRef.current = previewSnapshot.revision;
  const previewSnapshotRef = useRef(previewSnapshot);
  const resumeCanonicalTokenRef = useRef(0);
  previewSnapshotRef.current = previewSnapshot;
  const visualCodeBodyPreviewSourceRef = useRef<string | null>(null);
  const visualCodeBodyPreviewStructureRef = useRef<string | null>(null);
  const visualCodeBodyStructureValidationRef =
    useRef<VisualCodeStructureValidation | null>(null);
  const visualCodeBodyDomOrderInvalidRef = useRef(true);
  const visualCodeBodyDomOrderObserverRef = useRef<MutationObserver | null>(
    null
  );
  const visualCodeBodyOrdinalsRef = useRef<Readonly<{
    ordinals: ReadonlyMap<string, number>;
    orderedBlockIds: ReadonlyArray<string>;
    previewSourceMarkdown: string;
    signature: string;
  }> | null>(null);
  const visualLocalCodeBodyProvenanceRef = useRef(
    new WeakMap<HTMLElement, LocalVisualCodeBodyProvenance>()
  );
  const visualLocalCodeBodyBlocksRef = useRef(new Set<HTMLElement>());
  const visualLocalCodeBodyOrderRef = useRef<ReadonlyArray<HTMLElement> | null>(
    null
  );
  const acceptedCodeBodyCorrespondenceRef = useRef(
    new Map<HTMLElement, FullAcceptedCodeBodyCorrespondence>()
  );
  const acceptedLocalCodeBodiesRef = useRef<
    ReadonlyArray<IndexedLocalVisualCodeBodyProvenance>
  >([]);
  const visualTransferFailureReportedRef = useRef(false);
  // The verified current DOM/source pairing: the node ledger this owner
  // published at a real owner operation, plus the source/visual it described.
  // It is a reference record, never a second document: the strings are the
  // existing ones and the nodes are the live top-level children.
  const ownedDomRef = useRef<FullOwnedDom | null>(null);
  // The formal Preview origin the owned pairing descends from. Only a real
  // accepted render installs it; a local commit only makes it inapplicable.
  const mapCertificateRef = useRef<FullMapCertificate | null>(null);
  /**
   * A render whose accepted map does not name every mounted top-level element.
   * The owner may hold the render's own node ledger, but it has no formal
   * inventory for that surface: no map-mediated operation and no local commit
   * is admitted for it, and a demand resolves no target.
   */
  const acceptedMapUnmappedRef = useRef(false);
  // The one native structural fallback this owner is waiting to observe, and
  // the exact operation-bound correspondence of an already-pending canonical
  // splice. Both are short-lived records, consumed once.
  // One operation-scoped native witness. Consumers narrow this discriminated
  // record at the point of use, so a later input cannot borrow another shape.
  const pendingNativeOperationRef = useRef<
    FullPendingNativeRootTransition | FullPendingNativeRootJoin | null
  >(null);
  const fullOwnerRef = useRef<object>({});
  // Whether the owning effect that publishes this runtime is still live. The
  // applicability proofs run outside that effect, so they read this instead of
  // a closure variable that would be captured once.
  const activeRef = useRef(false);
  /**
   * Consume MutationObserver records through one owner. Observer callbacks and
   * synchronous takeRecords() drains must advance the same DOM-pair epoch;
   * otherwise a same-tick mutation can be mistaken for the accepted render.
   */
  const consumeVisualDomMutations = useCallback(
    (mutations: ReadonlyArray<MutationRecord>): boolean => {
      if (!mutations.length) return false;
      visualHistoryDomPairTokenRef.current += 1;
      const orderMutation = mutations.some((mutation) =>
        mutation.type === 'childList'
        || (
          mutation.type === 'attributes'
          && mutation.attributeName === 'data-easymde-visual-block-id'
        )
      );
      if (orderMutation) {
        visualCodeBodyDomOrderInvalidRef.current = true;
      }
      if (
        activeRef.current
        && orderMutation
        && 'accepted-preview' === pendingTransferRef.current?.spec.placement.kind
      ) {
        setPreviewAdoptionTick((tick) => tick + 1);
      }
      return orderMutation;
    },
    []
  );
  const contextMenuLeaseRef = useRef<FullContextLeaseState | null>(null);
  const resolvedContextTargetRef = useRef<FullResolvedContextTarget | null>(
    null
  );
  /**
   * The one re-authentication this owner has already requested for a document.
   *
   * `reason` is part of the key because these are genuinely different states:
   * an unproved ORIGIN is expected to become `current` once its render is
   * accepted, a KNOWN identity that no longer describes the accepted render
   * likewise, while an ABSENT identity is a capability the owner never supplies.
   * Keying the attempt means none of them can repeat the same request for the
   * same owner/source/revision - in particular the absent case, which could
   * otherwise never be satisfied and would park a demand forever.
   */
  const refreshAttemptRef = useRef<Readonly<{
    owner: object;
    reason: FullRefreshReason;
    source: string;
    sourceRevision: number;
  }> | null>(null);
  // Live Preview readiness, readable from the owner's synchronous runtime
  // methods. React props can lag a mount/teardown, and a public resolve must
  // never describe a surface that is still `loading`.
  const previewStatusRef = useRef<PreviewSurfaceStatus>(previewStatus);
  previewStatusRef.current = previewStatus;
  // The live generated/image identity getter, so the accepted-adoption path can
  // ask whether that capability is actually installed without taking a prop
  // dependency in every callback that captures a snapshot.
  const generatedIdentityRef = useRef<typeof getGeneratedPreviewIdentity>(
    getGeneratedPreviewIdentity
  );
  generatedIdentityRef.current = getGeneratedPreviewIdentity;
  const flushVisualInputRef = useRef<() => boolean>(() => true);
  const restoreFocusRef = useRef(false);
  const selfWriteRef = useRef(false);
  const readOnlySnapshotRef = useRef<VisualMarkdownReadOnlySnapshot | null>(
    null
  );
  const visualHistorySnapshotsRef = useRef(
    new Map<number, VisualHistorySlot>()
  );

  const visualCodeStructureCandidate = (
    markdown: string
  ): VisualCodeStructureValidation => {
    const acceptedSignature = visualCodeBodyPreviewStructureRef.current;
    const cached = visualCodeBodyStructureValidationRef.current;
    if (cached?.markdown === markdown) return cached;
    return {
      markdown,
      matchesPreview:
        null !== acceptedSignature &&
        visualCodeBlockStructureSignature(markdown) === acceptedSignature
    };
  };

  const visualCodePreOrder = (): ReadonlyArray<HTMLElement> =>
    Array.from(surface.querySelectorAll<HTMLElement>('pre'));

  const captureAcceptedCodeBodyCorrespondence = (
    source: string,
    editMap: PreviewEditMap | null,
    sourceRevision: number
  ): Map<HTMLElement, FullAcceptedCodeBodyCorrespondence> => {
    const next = new Map<HTMLElement, FullAcceptedCodeBodyCorrespondence>();
    if (!editMap) return next;
    const structureSignature = visualCodeBlockStructureSignature(source);
    let intervalsByBlockId: ReadonlyMap<string, VisualCodeBodyInterval>;
    try {
      intervalsByBlockId = createVisualCodeBodyIntervalsForPreviewBlocks(
        source,
        editMap
      );
    } catch {
      return next;
    }
    const editableBlockIds = new Set(
      editMap.blocks
        .filter((block) => block.editable)
        .map((block) => block.id)
    );
    for (const pre of visualCodePreOrder()) {
      const blockId = visualBlockIdForPre(pre, surface);
      if (!blockId) continue;
      if (!editableBlockIds.has(blockId)) continue;
      const input = captureVisualCodeInputSnapshot(pre);
      if (!input) continue;
      const interval = intervalsByBlockId.get(blockId);
      if (!interval) continue;
      if (
        input.fence !== interval.fence
        || (null !== input.fenceInfo && input.fenceInfo !== interval.info)
      ) continue;
      next.set(pre, {
        blockId,
        interval,
        owner: fullOwnerRef.current,
        source,
        sourceRevision,
        structureSignature
      });
    }
    return next;
  };

  const acceptedCodeBodyCorrespondenceForCommit = (
    beforeSource: string,
    nextSource: string,
    edits: ReadonlyArray<VisualMarkdownMergeEdit>,
    sourceRevision: number
  ): Map<HTMLElement, FullAcceptedCodeBodyCorrespondence> => {
    const previous = acceptedCodeBodyCorrespondenceRef.current;
    if (!previous.size) return new Map();
    if (beforeSource === nextSource) return new Map(previous);
    const descriptor = fullChangeDescriptorForEdits(
      beforeSource,
      nextSource,
      edits
    );
    if (!descriptor) return new Map();
    const next = new Map<HTMLElement, FullAcceptedCodeBodyCorrespondence>();
    const beforeStructure = visualCodeBlockStructureSignature(beforeSource);
    const nextStructure = visualCodeBlockStructureSignature(nextSource);
    let nextIntervals: ReadonlyArray<VisualCodeBodyInterval>;
    try {
      nextIntervals = visualCodeBodyIntervals(nextSource);
    } catch {
      return next;
    }
    const nextIntervalsByOrdinal = new Map(
      nextIntervals.map((interval) => [interval.codeOrdinal, interval])
    );
    const nextIntervalsByExtent = new Map(
      nextIntervals.map((interval) => [
        [
          interval.sourceBlockStart,
          fullCodeBlockSyntaxEnd(nextSource, interval),
          interval.bodyStart,
          interval.bodyEnd
        ].join(':'),
        interval
      ])
    );
    const origin = ownedDomRef.current;
    const operation = origin
      && origin.owner === fullOwnerRef.current
      && origin.source === beforeSource
      ? {
          change: descriptor,
          history: documentHistoryState(documentSession.document),
          insertionOwner: null,
          origin,
          owner: fullOwnerRef.current,
          source: nextSource,
          sourceRevision
        }
      : null;
    for (const [pre, record] of previous) {
      if (
        record.owner !== fullOwnerRef.current
        || !pre.isConnected
        || pre.parentElement === null
        || !surface.contains(pre)
      ) continue;
      let interval: VisualCodeBodyInterval | null = null;
      if (beforeStructure === nextStructure) {
        interval = nextIntervalsByOrdinal.get(record.interval.codeOrdinal) ?? null;
      } else if (operation) {
        const blockExtent = fullTransportedExtent(
          operation,
          {
            end: fullCodeBlockSyntaxEnd(beforeSource, record.interval),
            start: record.interval.sourceBlockStart
          },
          null
        );
        const bodyExtent = fullTransportedExtent(
          operation,
          { end: record.interval.bodyEnd, start: record.interval.bodyStart },
          null
        );
        if (blockExtent && bodyExtent) {
          interval = nextIntervalsByExtent.get([
            blockExtent.start,
            blockExtent.end,
            bodyExtent.start,
            bodyExtent.end
          ].join(':')) ?? null;
        }
      }
      if (!interval) continue;
      const input = captureVisualCodeInputSnapshot(pre);
      if (
        !input
        || input.fence !== interval.fence
        || (null !== input.fenceInfo && input.fenceInfo !== interval.info)
      ) continue;
      next.set(pre, {
        ...record,
        interval,
        source: nextSource,
        sourceRevision,
        structureSignature: nextStructure
      });
    }
    return next;
  };

  /**
   * Record the DOM/source pairing this owner has just verified at one of its
   * own real operations. It performs no render and rebases no map.
   *
   * The ledger is REQUIRED. A caller that cannot name the exact node list it
   * proved - the retained prior ledger, one verified native split, or the nodes
   * a typed owner operation itself installed - must not publish at all: falling
   * back to "whatever is mounted now" is precisely how a foreign mutation would
   * become this owner's baseline. Such a caller passes null and the previous
   * pairing is invalidated instead.
   */
  const publishOwnedDom = (
    source: string,
    visual: string,
    sourceRevision: number,
    ledger: Readonly<{
      metadata: ReadonlyArray<FullOwnedNodeMetadata>;
      nodes: ReadonlyArray<Node>;
    }> | null
  ): FullOwnedDom | null => {
    if (!ledger) {
      ownedDomRef.current = null;
      return null;
    }
    const owned: FullOwnedDom = {
      metadata: ledger.metadata,
      nodes: ledger.nodes,
      owner: fullOwnerRef.current,
      source,
      sourceRevision,
      visual
    };
    ownedDomRef.current = owned;
    return owned;
  };

  /**
   * Whether a top-level node list is exactly the ledger this owner verified.
   * A body-only edit changes text inside a root, so the node identities, order
   * and frozen attributes are all unchanged and the ledger is retained without
   * re-reading every root.
   */
  /**
   * Whether a node list still carries the metadata frozen with the ledger.
   * Node identity is checked by the callers; this is the attribute/data half.
   */
  const ledgerMetadataRetains = (
    owned: FullOwnedDom,
    nodes: ReadonlyArray<Node>
  ): boolean => {
    for (let index = 0; index < nodes.length; index += 1) {
      const expected = owned.metadata[index];
      if (
        undefined === expected
        || !fullOwnedNodeMetadataEqual(
          fullOwnedNodeMetadata(nodes[index] as Node),
          expected
        )
      ) return false;
    }
    return true;
  };

  const ownedLedgerRetains = (
    nodes: ReadonlyArray<Node>
  ): Readonly<{
    metadata: ReadonlyArray<FullOwnedNodeMetadata>;
    nodes: ReadonlyArray<Node>;
  }> | null => {
    const owned = ownedDomRef.current;
    if (!owned || owned.owner !== fullOwnerRef.current) return null;
    if (nodes.length !== owned.nodes.length) return null;
    if (nodes.some((node, index) => node !== owned.nodes[index])) return null;
    // Same node object is not the same ROOT. A guarded attribute mutation
    // keeps the identity while changing what the renderer will see, so the
    // frozen metadata is re-checked here: attributes are compared, and nothing
    // is cloned, parsed or re-serialized.
    if (!ledgerMetadataRetains(owned, nodes)) return null;
    return { metadata: owned.metadata, nodes: owned.nodes };
  };

  /**
   * The same check against the live child list, read by index. A keystroke path
   * must not allocate a whole child array or re-freeze metadata it already
   * owns, so this walks the live list once with an early exit and returns the
   * retained ledger itself.
   */
  const ownedLedgerRetainsLive = (): Readonly<{
    metadata: ReadonlyArray<FullOwnedNodeMetadata>;
    nodes: ReadonlyArray<Node>;
  }> | null => {
    const owned = ownedDomRef.current;
    if (!owned || owned.owner !== fullOwnerRef.current) return null;
    const live = surface.childNodes;
    if (live.length !== owned.nodes.length) return null;
    for (let index = 0; index < owned.nodes.length; index += 1) {
      if (live[index] !== owned.nodes[index]) return null;
    }
    return { metadata: owned.metadata, nodes: owned.nodes };
  };

  /**
   * The frozen attributes of one element, as the browser inherited them. This
   * is what a native root split may add: the browser clones the addressed
   * paragraph's own attributes (an id may be absent), and no other attribute
   * change is a supported split.
   */
  const fullInheritedRootMetadata = (
    original: HTMLElement,
    created: HTMLElement
  ): boolean => {
    const inherited = visualProtectedNodeAttributes(original).filter(
      ({ name }) => 'data-easymde-visual-block-id' !== name
    );
    const createdAttributes = visualProtectedNodeAttributes(created);
    const allowed = createdAttributes.filter(
      ({ name }) => 'data-easymde-visual-block-id' !== name
    );
    if (!visualProtectedNodeAttributesEqual(allowed, inherited)) return false;
    const createdId = created.getAttribute('data-easymde-visual-block-id');
    return (
      null === createdId
      || createdId === original.getAttribute('data-easymde-visual-block-id')
    );
  };

  /**
   * Capture the one native structural transition this owner supports: the
   * browser's own `insertParagraph` split inside a direct paragraph. The record
   * is the addressed root, the typed range in it, and the two fragment
   * serializations the split must produce - a proof captured before the
   * default runs, never reconstructed from a later mutation.
   */
  const captureNativeRootTransition = (
    event: InputEvent,
    sourceMarkdown: string,
    visualMarkdown: string
  ): void => {
    pendingNativeOperationRef.current = null;
    if ('insertParagraph' !== event.inputType) return;
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (
      !selection?.rangeCount
      || !selection.isCollapsed
      || !selection.anchorNode
    ) return;
    const owned = ownedDomRef.current;
    if (!owned || owned.owner !== fullOwnerRef.current) return;
    const nodes = Array.from(surface.childNodes);
    const ledger = ownedLedgerRetains(nodes);
    if (!ledger || owned.source !== sourceMarkdown) return;
    if (owned.visual !== visualMarkdown) return;
    const root = directVisualBlockForSelectionNode(
      surface,
      selection.anchorNode
    );
    if (!root || (!['P'].includes(root.tagName) && !/^H[1-6]$/u.test(root.tagName))) return;
    const windowIndex = nodes.indexOf(root);
    if (windowIndex < 0) return;
    const range = selection.getRangeAt(0);
    if (
      !root.contains(range.startContainer)
      || !root.contains(range.endContainer)
    ) return;
    // A split is defined by the retained halves, so a selection that spans the
    // range is not the supported transition and keeps the ordinary owner.
    if (!range.collapsed) return;
    const prefixRoot = root.cloneNode(false) as HTMLElement;
    const suffixRoot = root.cloneNode(false) as HTMLElement;
    const prefixRange = surface.ownerDocument.createRange();
    prefixRange.selectNodeContents(root);
    prefixRange.setEnd(selection.anchorNode, selection.anchorOffset);
    const suffixRange = surface.ownerDocument.createRange();
    suffixRange.selectNodeContents(root);
    suffixRange.setStart(selection.anchorNode, selection.anchorOffset);
    prefixRoot.append(prefixRange.cloneContents());
    suffixRoot.append(suffixRange.cloneContents());
    let prefixSerialization: string;
    let suffixSerialization: string;
    try {
      prefixSerialization = serializeVisualMarkdownBlockFragment([prefixRoot]);
      suffixSerialization = serializeVisualMarkdownBlockFragment([suffixRoot]);
    } catch {
      return;
    }
    const nativeBoundary = nativeVisualTextBoundary(
      surface,
      selection.anchorNode,
      selection.anchorOffset
    );
    const sourceBoundary = nativeBoundary
      ? mapTextBoundaryFromInterval(
          surface,
          nativeBoundary.node,
          nativeBoundary.offset,
          visualMarkdown,
          createVisualMarkdownSourceIntervalMap(sourceMarkdown, visualMarkdown),
          false
        )
      : null;
    pendingNativeOperationRef.current = {
      kind: 'split',
      afterFragment: suffixSerialization,
      beforeFragment: prefixSerialization,
      candidate: null,
      originalRoot: root,
      owner: fullOwnerRef.current,
      range: {
        endNode: selection.anchorNode,
        endOffset: selection.anchorOffset,
        startNode: selection.anchorNode,
        startOffset: selection.anchorOffset
      },
      source: owned.source,
      sourceRevision: owned.sourceRevision,
      sourceOffset: sourceBoundary?.sourceOffset ?? null,
      visual: owned.visual,
      windowIndex,
      splitOrder: null
    };
  };

  /**
   * Verify the record against the DOM the browser actually produced. Only the
   * exact adjacent two-paragraph split inside the captured window is admitted:
   * outside it every prior node, its order and its frozen metadata must be
   * untouched, and the two halves must serialize to the captured fragments.
   * The verified ledger is what the ordinary synchronizer may then adopt once.
   */
  const verifyNativeRootTransition = (): void => {
    const pending = pendingNativeOperationRef.current;
    const transition = pending?.kind === 'split' ? pending : null;
    if (!transition || transition.kind !== 'split') return;
    pendingNativeOperationRef.current = null;
    if (
      transition.owner !== fullOwnerRef.current
      || !transition.originalRoot.isConnected
    ) return;
    const owned = ownedDomRef.current;
    if (
      !owned
      || owned.source !== transition.source
      || owned.sourceRevision !== transition.sourceRevision
      || documentSession.document.getRevision?.() !== transition.sourceRevision
    ) return;
    const readOnlySnapshot = readOnlySnapshotRef.current;
    if (!readOnlySnapshot) return;
    try {
      assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
    } catch {
      return;
    }
    const nodes = Array.from(surface.childNodes);
    if (nodes.length !== owned.nodes.length + 1) return;
    const first = nodes[transition.windowIndex];
    const second = nodes[transition.windowIndex + 1];
    if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)
      || first.localName !== transition.originalRoot.localName
      || second.localName !== transition.originalRoot.localName) return;
    let created: HTMLElement;
    if (first === transition.originalRoot) {
      transition.splitOrder = 'after';
      created = second;
    } else if (second === transition.originalRoot) {
      transition.splitOrder = 'before';
      created = first;
    } else return;
    if (!fullInheritedRootMetadata(transition.originalRoot, created)) return;
    let firstSerialization: string;
    let secondSerialization: string;
    try {
      // `first` is compared to the captured root above, but only `second` was
      // narrowed to an element; the serializer takes elements.
      if (!(first instanceof HTMLElement)) return;
      firstSerialization = serializeVisualMarkdownBlockFragment([first]);
      secondSerialization = serializeVisualMarkdownBlockFragment([second]);
    } catch {
      return;
    }
    const nativeFragmentMatches = (
      root: HTMLElement,
      actual: string,
      expected: string
    ): boolean => {
      if (actual === expected) return true;
      // Chromium represents an empty native root with a renderer-only BR.
      // The pre-default clone has no child, so compare the same root with that
      // placeholder removed instead of treating the browser's spelling as a
      // foreign edit.
      if (
        root.childNodes.length === 1
        && root.firstChild instanceof HTMLBRElement
      ) {
        const withoutPlaceholder = root.cloneNode(false) as HTMLElement;
        return serializeVisualMarkdownBlockFragment([withoutPlaceholder]) === expected;
      }
      return false;
    };
    if (
      first.localName !== transition.originalRoot.localName
      || second.localName !== transition.originalRoot.localName
      || !nativeFragmentMatches(first, firstSerialization, transition.beforeFragment)
      || !nativeFragmentMatches(second, secondSerialization, transition.afterFragment)
    ) return;
    for (const [index, node] of nodes.entries()) {
      if (index === transition.windowIndex || index === transition.windowIndex + 1) {
        continue;
      }
      const prior = owned.nodes[index < transition.windowIndex ? index : index - 1];
      const metadata =
        owned.metadata[index < transition.windowIndex ? index : index - 1];
      if (
        node !== prior
        || undefined === metadata
        || !fullOwnedNodeMetadataEqual(fullOwnedNodeMetadata(node), metadata)
      ) return;
    }
    transition.candidate = {
      metadata: nodes.map(fullOwnedNodeMetadata),
      nodes
    };
    pendingNativeOperationRef.current = transition;
  };

  /**
   * Capture the one native EOF join this owner supports: Backspace at the
   * start of an empty paragraph whose default merges it into the preceding
   * code block. The browser removes that paragraph, the block's renderer-only
   * terminal LF text, and any whitespace text between the two roots, while the
   * serialized Markdown stays byte-identical. The target range the browser
   * reports is the provenance; the pre-default serialization is the bounded
   * zero-byte proof. Anything else keeps the ordinary strict path.
   */
  const captureNativeRootJoin = (
    event: InputEvent,
    sourceMarkdown: string,
    visualMarkdown: string
  ): void => {
    if ('deleteContentBackward' !== event.inputType || event.defaultPrevented)
      return;
    const pending = pendingNativeOperationRef.current;
    if (pending?.kind === 'join' && pending.candidate) return;
    pendingNativeOperationRef.current = null;
    const target = event.getTargetRanges?.()[0];
    if (!target || target.collapsed) return;
    const owned = ownedDomRef.current;
    if (!owned || owned.owner !== fullOwnerRef.current) return;
    if (owned.source !== sourceMarkdown || owned.visual !== visualMarkdown)
      return;
    const nodes = Array.from(surface.childNodes);
    if (!ownedLedgerRetains(nodes)) return;
    const terminal = target.startContainer;
    if (!(terminal instanceof Text)) return;
    const preRoot = directVisualBlockForSelectionNode(surface, terminal);
    if (!preRoot || preRoot.parentElement !== surface) return;
    let lineEndingLength = 0;
    let sharedTerminal = true;
    if ('PRE' === preRoot.tagName) {
      // The start is the code's own terminal renderer LF: either a lone
      // line-ending text node, or the suffix of the retained final text node
      // (highlighted code keeps its last line and the renderer LF in one node).
      const lineEnding = /(?:\r\n|\r|\n)$/u.exec(terminal.data)?.[0];
      if (!lineEnding) return;
      lineEndingLength = lineEnding.length;
      const terminalOffset = terminal.data.length - lineEndingLength;
      if (target.startOffset !== terminalOffset) return;
      sharedTerminal = 0 !== terminalOffset;
      const code = Array.from(preRoot.children).find(
        (child): child is HTMLElement => 'CODE' === child.tagName
      );
      if (!code || code.lastChild !== terminal) return;
    } else if (
      !['P'].includes(preRoot.tagName)
      && !/^H[1-6]$/u.test(preRoot.tagName)
    ) {
      return;
    } else if (target.startOffset !== terminal.data.length) {
      return;
    }
    const joinRoot = (
      target.endContainer instanceof HTMLElement
        ? target.endContainer
        : target.endContainer.parentElement
    );
    if (!joinRoot || 'P' !== joinRoot.tagName) return;
    if (joinRoot.parentElement !== surface) return;
    if (joinRoot.contains(target.endContainer) || joinRoot === target.endContainer) {
      const remainder = surface.ownerDocument.createRange();
      remainder.setStart(target.endContainer, target.endOffset);
      remainder.setEnd(joinRoot, joinRoot.childNodes.length);
      if ('' !== remainder.toString().trim()) return;
    } else {
      return;
    }
    if ('' !== (joinRoot.textContent ?? '').trim()) return;
    if (
      Array.from(joinRoot.children).some(
        (child) => !(child instanceof HTMLBRElement)
      )
    )
      return;
    const preIndex = nodes.indexOf(preRoot);
    const joinIndex = nodes.indexOf(joinRoot);
    if (preIndex < 0 || joinIndex <= preIndex) return;
    const interRoot = nodes.slice(preIndex + 1, joinIndex);
    if (
      interRoot.some(
        (node) => !(node instanceof Text) || !/^\s*$/u.test(node.data)
      )
    )
      return;
    // The pre-join serialization is the proof both accepted shapes need:
    // a shared terminal that keeps its final line, and a lone renderer LF that
    // the browser removes as its own node. It is captured for every join, so a
    // removal that also changes code bytes can never pass unproved.
    let preRootSerialization: string | null = null;
    try {
      preRootSerialization = serializeVisualMarkdownBlockFragment([preRoot]);
    } catch {
      return;
    }
    let sourceRange: Readonly<{ end: number; start: number }> | undefined;
    if ('PRE' !== preRoot.tagName) {
      try {
        const sourceIntervalMap = createVisualMarkdownSourceIntervalMap(
          sourceMarkdown,
          visualMarkdown
        );
        const start = mapTextBoundaryFromInterval(
          surface,
          terminal,
          target.startOffset,
          visualMarkdown,
          sourceIntervalMap,
          false
        )?.sourceOffset;
        const end = visualSelectionSourceRange(
          surface,
          sourceMarkdown,
          visualMarkdown,
          visualMarkdown,
          { structuralEmptyParagraphRemoval: true }
        ).start;
        if (undefined !== start && end >= start) {
          sourceRange = { end, start };
        }
      } catch {
        sourceRange = undefined;
      }
    }
    pendingNativeOperationRef.current = {
      kind: 'join',
      candidate: null,
      interRoot,
      hasFollowingRoot: Boolean(joinRoot.nextElementSibling),
      joinRoot,
      lineEndingLength,
      owner: fullOwnerRef.current,
      preRoot,
      preRootSerialization,
      sharedTerminal,
      source: owned.source,
      sourceRevision: owned.sourceRevision,
      ...(sourceRange ? { sourceRange } : {}),
      terminal,
      terminalBefore: terminal.data,
      windowIndex: preIndex
    };
  };

  /**
   * Verify the captured join against the DOM the browser actually produced.
   * Only the exact captured removal is admitted: the code root is retained at
   * its index with unchanged element metadata, the terminal LF, the empty
   * paragraph and exactly the captured inter-root whitespace texts are gone,
   * every other root is the same node with unchanged metadata, and the
   * serialized Markdown is byte-identical to the pre-default snapshot. A
   * same-id clone or any other node delta keeps the strict refusal.
   */
  const verifyNativeRootJoin = (): void => {
    const pending = pendingNativeOperationRef.current;
    const join = pending?.kind === 'join' ? pending : null;
    if (!join || join.kind !== 'join') return;
    pendingNativeOperationRef.current = null;
    if (join.owner !== fullOwnerRef.current) return;
    const owned = ownedDomRef.current;
    if (
      !owned
      || owned.source !== join.source
      || owned.sourceRevision !== documentSession.document.getRevision?.()
    ) return;
    const readOnlySnapshot = readOnlySnapshotRef.current;
    if (!readOnlySnapshot) return;
    try {
      assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
    } catch {
      return;
    }
    if (join.preRoot.parentNode !== surface || !join.preRoot.isConnected) return;
    if (join.joinRoot.isConnected) return;
    if (join.interRoot.some((node) => node.isConnected)) return;
    if (join.terminal?.isConnected) {
      if (!join.sharedTerminal || !join.preRoot.contains(join.terminal)) return;
      if (
        join.terminal.data !==
        join.terminalBefore.slice(
          0,
          join.terminalBefore.length - join.lineEndingLength
        )
      )
        return;
    }
    // Every admitted join must still serialize to the exact code block it was
    // captured from, whether the renderer LF was trimmed from a shared Text or
    // its own node disappeared. A join that also removed code bytes or changed
    // any code character therefore stays refused.
    if (null === join.preRootSerialization) return;
    let codeSerialization: string;
    try {
      codeSerialization = serializeVisualMarkdownBlockFragment([join.preRoot]);
    } catch {
      return;
    }
    if (codeSerialization !== join.preRootSerialization) return;
    const removedCount = 1 + join.interRoot.length;
    if (owned.nodes.length < removedCount + 1) return;
    const nodes = Array.from(surface.childNodes);
    if (nodes.length !== owned.nodes.length - removedCount) return;
    const preIndex = join.windowIndex;
    if (nodes[preIndex] !== join.preRoot) return;
    if (owned.nodes[preIndex] !== join.preRoot) return;
    if (owned.nodes[preIndex + 1 + join.interRoot.length] !== join.joinRoot)
      return;
    for (let offset = 0; offset < join.interRoot.length; offset += 1) {
      if (owned.nodes[preIndex + 1 + offset] !== join.interRoot[offset]) return;
    }
    for (let index = 0; index < nodes.length; index += 1) {
      if (index === preIndex) continue;
      const priorIndex = index < preIndex ? index : index + removedCount;
      const node = nodes[index];
      if (!node || node !== owned.nodes[priorIndex]) return;
      const metadata = owned.metadata[priorIndex];
      if (
        !metadata ||
        !fullOwnedNodeMetadataEqual(fullOwnedNodeMetadata(node), metadata)
      )
        return;
    }
    const preMetadata = owned.metadata[preIndex];
    if (
      !preMetadata ||
      !fullOwnedNodeMetadataEqual(
        fullOwnedNodeMetadata(join.preRoot),
        preMetadata
      )
    )
      return;
    join.candidate = {
      metadata: nodes.map(fullOwnedNodeMetadata),
      nodes
    };
    pendingNativeOperationRef.current = join;
  };

  /**
   * The verified native EOF-join ledger, consumable once. The candidate must
   * still be the live top-level window by node identity; anything else leaves
   * the strict gates untouched.
   */
  const consumeVerifiedNativeRootJoin = (consume = true): Readonly<{
    metadata: ReadonlyArray<FullOwnedNodeMetadata>;
    nodes: ReadonlyArray<Node>;
  }> | null => {
    const pending = pendingNativeOperationRef.current;
    const candidate = pending?.kind === 'join' ? pending.candidate : null;
    if (!candidate) return null;
    const nodes = Array.from(surface.childNodes);
    if (
      candidate.nodes.length !== nodes.length ||
      candidate.nodes.some((node, index) => node !== nodes[index])
    )
      return null;
    if (consume) pendingNativeOperationRef.current = null;
    return candidate;
  };

  /**
   * The ledger the synchronizer may publish after this commit: the verified
   * native split candidate when one was proved, or the retained prior ledger
   * when the top-level window is unchanged. Anything else is a foreign
   * transition and is refused before the canonical write.
   */
  const verifiedOwnedLedgerForCommit = (): Readonly<{
    metadata: ReadonlyArray<FullOwnedNodeMetadata>;
    nodes: ReadonlyArray<Node>;
  }> | null => {
    const nodes = Array.from(surface.childNodes);
    // A commit publishes a NEW source, so the node list must still be the
    // ledger AND still carry its frozen attributes: same object identity with a
    // mutated guarded attribute is not the root this owner verified.
    const retained = ownedLedgerRetains(nodes);
    if (retained) {
      pendingNativeOperationRef.current = null;
      return retained;
    }
    const pending = pendingNativeOperationRef.current;
    const candidate = pending?.candidate ?? null;
    if (candidate) {
      if (
        candidate.nodes.length === nodes.length &&
        candidate.nodes.every((node, index) => node === nodes[index])
      ) {
        pendingNativeOperationRef.current = null;
        return candidate;
      }
    }
    return null;
  };

  /**
   * The author's own recomposition of the surface they are editing.
   *
   * The debounced synchronizer normally advances only the ledger it verified,
   * because an equal-looking or partially rewritten window is exactly the
   * laundering this owner refuses. A surface whose verified roots are ALL gone
   * and replaced by a new top-level composition is a different case: the author
   * rewrote the article itself, no accepted root survives to be re-blessed, and
   * the new list is an AUTHORING ledger. The formal certificate is deliberately
   * NOT installed for it and the code inventory is not advanced, so no
   * map-mediated operation can treat it as an accepted render: the next demand
   * asks for one formal refresh. Any surviving accepted root - a clone, a
   * reorder, an insertion next to the accepted blocks - keeps the strict proof.
   */
  const verifiedRecomposedSurfaceLedger = (): Readonly<{
    metadata: ReadonlyArray<FullOwnedNodeMetadata>;
    nodes: ReadonlyArray<Node>;
  }> | null => {
    const owned = ownedDomRef.current;
    if (!owned || owned.owner !== fullOwnerRef.current) return null;
    if (owned.source !== sourceMarkdownRef.current) return null;
    if (owned.visual !== visualMarkdownRef.current) return null;
    const live = Array.from(surface.childNodes);
    if (!live.length) return null;
    for (const node of live) {
      if (owned.nodes.includes(node)) return null;
    }
    return { metadata: live.map(fullOwnedNodeMetadata), nodes: live };
  };

  /**
   * The one retained root a pure insertion was typed into.
   *
   * The caret's own native root must still be a node of the verified origin
   * ledger, and the insertion offset must lie inside that root's proved source
   * extent (or exactly at its content end). No id lookup, no neighbour guess and
   * no affinity at all when those proofs do not hold.
   */
  const nativeInsertionOwner = (
    origin: FullOwnedDom,
    source: string,
    offset: number
  ): HTMLElement | null => {
    const certificate = mapCertificateRef.current;
    if (!certificate) return null;
    if (
      certificate.source !== origin.source
      || certificate.visual !== origin.visual
    ) return null;
    const selection = surface.ownerDocument.defaultView?.getSelection();
    const anchor = selection?.anchorNode ?? null;
    if (!anchor || !surface.contains(anchor)) return null;
    const root = directVisualBlockForSelectionNode(surface, anchor);
    if (!root || !origin.nodes.includes(root)) return null;
    if (root.parentNode !== surface) return null;
    let rows: ReturnType<typeof visualStructuralBoundaryRows>;
    try {
      rows = visualStructuralBoundaryRows(origin.source, certificate.editMap);
    } catch {
      return null;
    }
    const elementIndex = Array.from(surface.children).indexOf(root);
    const row = 0 <= elementIndex ? rows[elementIndex] : undefined;
    if (
      !row
      || !row.editable
      || row.id !== root.getAttribute('data-easymde-visual-block-id')
    ) return null;
    const content = fullRowContentExtent(origin.source, row);
    if (offset > content.end || offset < content.start) return null;
    if (!coversMarkdownUnits(source, content.start, content.end)) return null;
    return root;
  };

  /**
   * The ledger one typed owner operation just installed.
   *
   * This is deliberately narrower than "whatever is mounted now": it is only
   * called for a typed owner operation that already produced a bounded merge,
   * and it still requires the two accepted neighbours to bracket the changed
   * span, every child outside that span to be the published node with its
   * frozen attributes and data, and the span to hold only block elements or
   * bare whitespace. The resulting child list is therefore the operation's
   * adopted topology, not an observation of it.
   */
  const verifiedAcceptedWindowLedger = (
    acceptedWindow: AcceptedTopLevelVisualWindow
  ): Readonly<{
    metadata: ReadonlyArray<FullOwnedNodeMetadata>;
    nodes: ReadonlyArray<Node>;
  }> | null => {
    const owned = ownedDomRef.current;
    if (!owned || owned.owner !== fullOwnerRef.current) return null;
    if (owned.nodes.length !== owned.metadata.length) return null;
    const blocks = acceptedWindow.editMap.blocks;
    const previousId = blocks[acceptedWindow.blockRange.start - 1]?.id ?? null;
    const nextId = blocks[acceptedWindow.blockRange.end]?.id ?? null;
    const nodes = Array.from(surface.childNodes);
    const elementIds = nodes.map((node) =>
      node instanceof HTMLElement
        ? node.getAttribute('data-easymde-visual-block-id')
        : null
    );
    // The window sits between this operation's accepted neighbours. Those two
    // ids are the anchors the command itself cannot have renamed, so their live
    // positions bound exactly what it may have rewritten.
    let previousIndex = -1;
    let nextIndex = -1;
    for (const [index, id] of elementIds.entries()) {
      if (null !== previousId && id === previousId) previousIndex = index;
      if (null !== nextId && id === nextId && 0 > nextIndex) nextIndex = index;
    }
    if (null !== previousId && 0 > previousIndex) return null;
    if (null !== nextId && 0 > nextIndex) return null;
    const spanStart = null === previousId ? 0 : previousIndex + 1;
    const spanEnd = null === nextId ? nodes.length : nextIndex;
    if (spanEnd < spanStart) return null;
    const suffix = nodes.slice(spanEnd);
    // The published prefix and suffix have to be the same two runs; otherwise
    // the command changed the document's own node count outside its window.
    if (spanStart > owned.nodes.length - suffix.length) return null;
    const retainedSuffix = owned.nodes.slice(owned.nodes.length - suffix.length);
    const metadata: FullOwnedNodeMetadata[] = [];
    for (let index = 0; index < spanStart; index += 1) {
      const node = nodes[index];
      const priorMetadata = owned.metadata[index];
      if (
        undefined === node
        || undefined === priorMetadata
        || node !== owned.nodes[index]
        || !fullOwnedNodeMetadataEqual(
          fullOwnedNodeMetadata(node),
          priorMetadata
        )
      ) return null;
      metadata.push(priorMetadata);
    }
    // Inside the window this typed operation owns the output. Its ELEMENTS are
    // read here, and any non-element child is only ever the surface's own
    // whitespace spacer - never foreign content or a foreign block.
    const windowNodes = nodes.slice(spanStart, spanEnd);
    if (!windowNodes.some((node) => node instanceof HTMLElement)) return null;
    // The accepted window's own block ids are the only identities this command
    // may still carry; a window element under any other id is foreign.
    const selectedIds = new Set(
      blocks
        .slice(acceptedWindow.blockRange.start, acceptedWindow.blockRange.end)
        .map((block) => block.id)
    );
    for (const node of windowNodes) {
      if (node instanceof HTMLElement) {
        // A window element either kept one of the accepted window's ids, or is
        // a brand-new block the command itself just created (a heading's own
        // trailing paragraph, for example). Either way its content was already
        // serialized into the bounded merge's edited slice.
        const id = node.getAttribute('data-easymde-visual-block-id');
        if (id && !selectedIds.has(id)) return null;
      } else if (!(node instanceof Text) || /\S/u.test(node.data)) {
        return null;
      }
      metadata.push(fullOwnedNodeMetadata(node));
    }
    // Everything after the window is still the published node, with its frozen
    // attributes and data, in the same relative order.
    for (const [offset, node] of suffix.entries()) {
      const priorIndex = owned.nodes.length - suffix.length + offset;
      const priorMetadata = owned.metadata[priorIndex];
      if (
        undefined === node
        || undefined === priorMetadata
        || node !== retainedSuffix[offset]
        || !fullOwnedNodeMetadataEqual(
          fullOwnedNodeMetadata(node),
          priorMetadata
        )
      ) return null;
      metadata.push(priorMetadata);
    }
    if (metadata.length !== nodes.length) return null;
    return { metadata, nodes };
  };

  /**
   * The ledger a command that THIS owner ran itself just produced.
   *
   * It is only reachable when the caller supplies the exact child list that
   * existed immediately before that same synchronous command. Crucially it
   * never advances the origin certificate: the older formal origin stays in
   * place, so applicability reports this pairing as needing re-authentication
   * rather than blessing it. The nodes are therefore the operation's own
   * output - adoption, not proof - and every element must still be a real
   * block element with an id.
   */
  const verifiedOwnerCommandLedger = (
    before: ReadonlyArray<Node> | undefined,
    fenceCommand?: OwnerCodeFenceCommand
  ): Readonly<{
    metadata: ReadonlyArray<FullOwnedNodeMetadata>;
    nodes: ReadonlyArray<Node>;
  }> | null => {
    if (!before) return null;
    if (!activeRef.current) return null;
    const nodes = Array.from(surface.childNodes);
    let authoredCode: HTMLElement | null = null;
    const ownsFenceCommand = Boolean(fenceCommand
      && fenceCommand.owned === ownedDomRef.current
      && fenceCommand.owned.source === sourceMarkdownRef.current
      && fenceCommand.owned.source === documentSession.document.getValue()
      && fenceCommand.owned.sourceRevision === documentSession.document.getRevision?.()
      && fenceCommand.prior.innerHTML === fenceCommand.html
      && ownedLedgerRetains(before));
    if (
      nodes.length === before.length
      && nodes.every((node, index) => node === before[index])
    ) return null;
    if (previewSnapshotRef.current.editMap) {
      // Heading Enter is a synchronous owner command, not an observed native
      // insertion: its sole new node is the empty paragraph after that heading.
      if (nodes.length === before.length + 1) {
        const insertedIndex = nodes.findIndex((node, index) => node !== before[index]);
        const inserted = nodes[insertedIndex];
        const previous = nodes[insertedIndex - 1];
        if (!(inserted instanceof HTMLParagraphElement)
          || !(previous instanceof HTMLElement) || !/^H[1-6]$/u.test(previous.tagName)
          || inserted.childNodes.length !== 1 || !(inserted.firstChild instanceof HTMLBRElement)
          || !before.every((node, index) => node === nodes[index < insertedIndex ? index : index + 1])) return null;
        return { metadata: nodes.map(fullOwnedNodeMetadata), nodes };
      }
      // On a mapped surface this is not a free observation: the command may
      // only have rewritten ONE position, and only into a node that still
      // carries that position's accepted block identity (a block kind
      // replacement such as an empty fence becoming its paragraph). Every
      // other node must be the very object that existed before the command, so
      // an inserted, removed, reordered or re-identified sibling is refused.
      if (nodes.length !== before.length) return null;
      let changed = 0;
      for (const [index, node] of nodes.entries()) {
        const prior = before[index];
        if (node === prior) continue;
        if (!(prior instanceof HTMLElement) || !(node instanceof HTMLElement)) {
          return null;
        }
        const priorId = prior.getAttribute('data-easymde-visual-block-id');
        const nextId = node.getAttribute('data-easymde-visual-block-id');
        if (!priorId || priorId !== nextId) {
          if (priorId || nextId || !ownsFenceCommand || fenceCommand?.prior !== prior) return null;
          if (fenceCommand.kind === 'remove') {
            if (!(prior instanceof HTMLPreElement) || !(node instanceof HTMLParagraphElement)
              || node.childNodes.length !== 1 || !(node.firstChild instanceof HTMLBRElement)) return null;
          } else {
            const input = node instanceof HTMLPreElement ? captureVisualCodeInputSnapshot(node) : null;
            const literal = projectVisualLiteralParagraphLine(prior.textContent ?? '', prior.textContent?.length ?? 0);
            const sourceSpan = fenceCommand.owned.source.slice(fenceCommand.sourceStart, fenceCommand.sourceEnd);
            if (!literal || !sourceSpan || isMarkdownFenceOpeningLine(sourceSpan)
              || !literalTextBoundsAtSelection(prior.textContent ?? '', { start: 0, end: prior.textContent?.length ?? 0 },
                fenceCommand.owned.source, { start: fenceCommand.sourceStart, end: fenceCommand.sourceEnd })
              || !input?.placeholder || input.codeText !== '') return null;
          }
          authoredCode = node;
        }
        changed += 1;
      }
      if (1 !== changed) return null;
    }
    for (const node of nodes) {
      if (node instanceof HTMLElement) {
        if (!node.getAttribute('data-easymde-visual-block-id')
          && !(ownsFenceCommand && (node === authoredCode || before.includes(node)))) return null;
        continue;
      }
      if (!(node instanceof Text) || /\S/u.test(node.data)) return null;
    }
    return { metadata: nodes.map(fullOwnedNodeMetadata), nodes };
  };

  /**
   * Whether the live surface is still exactly the pairing this owner published,
   * and still describes the canonical document. This is the current-owner
   * half of the applicability proof: a failure here is not refreshable.
   */
  const ownedDomIsCurrent = (): boolean => {
    const owned = ownedDomRef.current;
    if (!owned || !activeRef.current) return false;
    if (owned.owner !== fullOwnerRef.current) return false;
    if (documentSession.document.getValue() !== owned.source) return false;
    if (sourceMarkdownRef.current !== owned.source) return false;
    if (visualMarkdownRef.current !== owned.visual) return false;
    if (!fullOwnedDomMatches(surface, owned)) return false;
    const readOnlySnapshot = readOnlySnapshotRef.current;
    if (!readOnlySnapshot) return false;
    try {
      assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
      if (serializeVisualMarkdown(surface) !== owned.visual) return false;
    } catch {
      return false;
    }
    return true;
  };

  /**
   * The one complete demand-time applicability operation. Current ownership is
   * authenticated first, so a foreign DOM is `invalid` and never becomes a
   * refresh; only a legitimate owner-authored transition that the older formal
   * origin cannot describe is `refresh`.
   *
   * Everything after that origin gate is the complete proof: the actual global
   * source merge, the exact assignment of every atomic edit to one editable
   * origin row, an exact byte comparison of every source interval no edit
   * touched, a disjoint row merge for every changed row, and the positive
   * whole-row stability domain. Merge equality alone is never the topology
   * proof, and an unproved row is a refresh rather than an omission.
   */
  const certifyAcceptedMapApplicability = (): FullMapApplicability => {
    if (!activeRef.current || externalChangeReportedRef.current) return 'invalid';
    if (visualTransferFailureReportedRef.current) return 'invalid';
    const owned = ownedDomRef.current;
    const certificate = mapCertificateRef.current;
    const snapshot = previewSnapshotRef.current;
    if (!owned || !certificate) return 'invalid';
    if (!Number.isSafeInteger(documentSession.document.getRevision?.())) {
      return 'invalid';
    }
    if (!ownedDomIsCurrent()) return 'invalid';
    // This operation is a proof about the FORMAL origin, so it is gated on the
    // certificate itself. The code-body preview memo is advanced only when a
    // certificate is installed, so a native commit legitimately leaves it (like
    // the certificate) describing the older render. Requiring it to equal the
    // new source here would fail closed before the all-row proof that exists
    // precisely to classify that transition - and would suppress the one
    // formal re-authentication the gesture needs.
    //
    // What must never be tolerated is a memo from a THIRD document: it names
    // code ordinals for bytes neither the origin nor the current pairing owns.
    if (
      null !== visualCodeBodyPreviewSourceRef.current
      && visualCodeBodyPreviewSourceRef.current !== certificate.source
      && visualCodeBodyPreviewSourceRef.current !== owned.source
    ) return 'invalid';
    if (
      !snapshot.editMap
      || snapshot.editMap.signature !== snapshot.signature
      || capturedPreviewRevisionRef.current !== snapshot.revision
      || 1 !== snapshot.editMap.version
      || 'line' !== snapshot.editMap.coordinate
    ) return 'invalid';
    if (
      certificate.owner !== fullOwnerRef.current
      || certificate.previewSignature !== snapshot.signature
      || certificate.previewRevision !== snapshot.revision
      || certificate.editMap.signature !== snapshot.signature
    ) return 'invalid';
    // The origin describes the source and the node ledger it was adopted for.
    // A legitimate owner-authored transition (a native split, a local commit)
    // leaves those behind without any foreign mutation, which is precisely the
    // case a formal re-authentication resolves.
    if (
      certificate.source === owned.source
      && certificate.visual === owned.visual
      && certificate.sourceRevision === owned.sourceRevision
      && certificate.nodes.length === owned.nodes.length
      && certificate.nodes.every((node, index) => node === owned.nodes[index])
      && certificate.html === acceptedHtmlRef.current
    ) return 'current';

    // Origin applicability: the origin map must still name this surface's own
    // top-level roots in order. A count or id difference is not corruption -
    // a native split legitimately produces one - but it is not current either.
    const blocks = certificate.editMap.blocks;
    const liveElements = Array.from(surface.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement
    );
    if (
      liveElements.length !== blocks.length
      || liveElements.some(
        (element, index) =>
          element.getAttribute('data-easymde-visual-block-id')
            !== blocks[index]?.id
      )
    ) return 'refresh';

    const beforeSource = certificate.source;
    const afterSource = owned.source;
    const beforeRows = visualStructuralBoundaryRows(
      beforeSource,
      certificate.editMap
    );
    if (beforeRows.length !== blocks.length) return 'refresh';

    // Reuse the interval map only for the exact pair it was built from.
    const record = visualSourceIntervalMapRef.current;
    let intervalMap: VisualMarkdownSourceIntervalMap;
    try {
      intervalMap = record
        && record.sourceMarkdown === beforeSource
        && record.visualMarkdown === certificate.visual
        ? record.map
        : createVisualMarkdownSourceIntervalMap(
            beforeSource,
            certificate.visual
          );
    } catch {
      return 'refresh';
    }
    let global: VisualMarkdownMergeResult;
    try {
      global = mergeVisualMarkdownChangeDetails(
        beforeSource,
        certificate.visual,
        owned.visual,
        intervalMap
      );
    } catch {
      return 'refresh';
    }
    if (global.value !== afterSource) return 'refresh';

    const edits = [...global.edits].sort(
      (left, right) => left.start - right.start || left.end - right.end
    );
    // Every atomic edit has to be a CR/LF-free replacement of bytes that exist,
    // in ascending order, and wholly inside exactly one editable origin row.
    const editsByRow = new Map<number, Array<VisualMarkdownMergeEdit>>();
    let previousEnd = -1;
    // Rows and edits are both ascending, so ownership is assigned in ONE
    // forward pass: a single edit is never compared against every row.
    let ownerCursor = 0;
    for (const edit of edits) {
      if (
        !Number.isSafeInteger(edit.start)
        || !Number.isSafeInteger(edit.end)
        || edit.start < 0
        || edit.end < edit.start
        || edit.end > beforeSource.length
        || edit.start < previousEnd
        || /[\r\n]/u.test(edit.replacement)
        || /[\r\n]/u.test(beforeSource.slice(edit.start, edit.end))
      ) return 'refresh';
      previousEnd = edit.end;
      while (
        ownerCursor < beforeRows.length
        && (beforeRows[ownerCursor]?.end ?? 0) < edit.start
      ) ownerCursor += 1;
      // Rows are sorted and disjoint, so only the first row ending at or after
      // this edit can own it - apart from zero-width rows sharing that exact
      // anchor, which stay in order and are checked here.
      const candidateIndices: number[] = [];
      for (
        let index = Math.max(0, ownerCursor - 1);
        index < beforeRows.length;
        index += 1
      ) {
        const row = beforeRows[index];
        if (!row || row.start > edit.start) break;
        candidateIndices.push(index);
      }
      if (0 === candidateIndices.length) return 'refresh';
      const owners = candidateIndices.flatMap((index) => {
        const row = beforeRows[index];
        if (!row || !row.editable) return [];
        // A removal is owned by this row while every removed byte lies inside
        // that row's own extent: rows are disjoint and never contain a
        // separator, so an inclusive whole-row removal (a real block delete) is
        // this row's own operation, while a removal reaching past its bounds
        // touches shared bytes and rebases nothing.
        if (
          edit.start !== edit.end
          && edit.start >= row.start
          && edit.end <= row.end
        ) return [index];
        if (edit.start === edit.end) {
          // A boundary insertion needs positive body ownership. The row slice
          // includes its own terminal terminator and excludes the blank
          // separator a neighbour owns, so exactly two boundaries are this
          // row's own body:
          //   * its start, when the origin byte before it is that terminator
          //     (or there is none) - a prepend to this row's first line;
          //   * its end, ONLY at the actual document end and ONLY when the row
          //     has no terminal terminator - a real append to its last line.
          // Anything at a separator line, or after a terminator, is gap bytes
          // and cannot rebase this row.
          const content = fullRowContentExtent(beforeSource, row);
          if (edit.start > row.start && edit.end < row.end) return [index];
          if (
            edit.start === row.end
            && row.end === beforeSource.length
            && content.end === row.end
          ) return [index];
          if (
            edit.start === row.start
            && (0 === row.start
              || /[\r\n]/u.test(beforeSource[row.start - 1] ?? ''))
            && content.start === row.start
          ) return [index];
          return [];
        }
        return [];
      });
      const owner = owners[0];
      if (undefined === owner || 1 !== owners.length) return 'refresh';
      const list = editsByRow.get(owner);
      if (list) list.push(edit);
      else editsByRow.set(owner, [edit]);
    }

    // Apply the same accepted line coordinates to the current source and walk
    // rows/edits once with the cumulative UTF-16 delta.
    const beforeLineStarts = markdownLineStarts(beforeSource);
    const afterLineStarts = markdownLineStarts(afterSource);
    if (afterLineStarts.length !== beforeLineStarts.length) return 'refresh';
    // Cumulative UTF-16 delta at every edit boundary, computed once. Affinity
    // is explicit: a start boundary excludes an insertion exactly at it (so an
    // insertion before a row is not part of that row), while an end boundary
    // includes it for a root that owns the append.
    const editEnds: number[] = [];
    const editStarts: number[] = [];
    const cumulativeDelta: number[] = [];
    let runningDelta = 0;
    for (const edit of edits) {
      runningDelta += edit.replacement.length - (edit.end - edit.start);
      editEnds.push(edit.end);
      editStarts.push(edit.start);
      cumulativeDelta.push(runningDelta);
    }
    const movedBefore = (offset: number, includeInsertionAtOffset: boolean): number => {
      let low = 0;
      let high = editEnds.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if ((editEnds[middle] ?? 0) <= offset) low = middle + 1;
        else high = middle;
      }
      let delta = 0 < low ? (cumulativeDelta[low - 1] ?? 0) : 0;
      if (includeInsertionAtOffset) {
        // Only a zero-width edit exactly at the boundary is additionally owned
        // by this endpoint: anything wider has already been counted above.
        for (let index = low; index < edits.length; index += 1) {
          const edit = edits[index];
          if (!edit || edit.start > offset) break;
          if (edit.start === offset && edit.end === offset) {
            delta += edit.replacement.length;
          }
        }
      }
      return delta;
    };
    const projectedRows: Array<Readonly<{
      contentEnd: number;
      contentStart: number;
      end: number;
      start: number;
    }>> = [];
    let coveredEnd = 0;
    for (const [index, block] of blocks.entries()) {
      const row = beforeRows[index];
      // A noneditable zero-width row may sit at the EOF sentinel line, exactly
      // like the shared helper projects it: it owns no bytes at the document
      // end and must keep that anchor after the edit.
      const eofSentinel = Boolean(
        row
        && !row.editable
        && row.start === row.end
        && block.startLine === afterLineStarts.length
        && block.endLine === afterLineStarts.length
      );
      const afterStart = eofSentinel
        ? afterSource.length
        : afterLineStarts[block.startLine];
      const afterEnd = eofSentinel
        ? afterSource.length
        : block.endLine === afterLineStarts.length
          ? afterSource.length
          : afterLineStarts[block.endLine];
      if (
        undefined === afterStart
        || undefined === afterEnd
        || !row
      ) return 'refresh';
      const projectedStart = row.start + movedBefore(row.start, false);
      const projectedEnd = row.end + movedBefore(row.end, true);
      if (projectedStart !== afterStart || projectedEnd !== afterEnd) {
        return 'refresh';
      }
      if (row.start < coveredEnd) return 'refresh';
      coveredEnd = row.end;
      const content = fullRowContentExtent(afterSource, {
        editable: block.editable === true,
        end: afterEnd,
        id: block.id,
        start: afterStart
      });
      projectedRows.push({
        contentEnd: content.end,
        contentStart: content.start,
        end: projectedEnd,
        start: projectedStart
      });
    }

    // Every byte no edit touched has to survive unchanged and in place.
    let cursor = 0;
    for (const edit of edits) {
      if (edit.start < cursor) return 'refresh';
      const moved = movedBefore(cursor, false);
      if (
        beforeSource.slice(cursor, edit.start)
        !== afterSource.slice(cursor + moved, edit.start + moved)
      ) return 'refresh';
      cursor = edit.end;
    }
    const tailMoved = movedBefore(cursor, false);
    if (
      beforeSource.slice(cursor)
      !== afterSource.slice(cursor + tailMoved)
    ) return 'refresh';

    // Baseline roots come from the accepted HTML the certificate captured.
    const template = surface.ownerDocument.createElement('article');
    try {
      template.innerHTML = certificate.html;
    } catch {
      return 'refresh';
    }
    const baselineRoots = new Map<string, HTMLElement>();
    for (const child of Array.from(template.children)) {
      if (!(child instanceof HTMLElement)) continue;
      const id = child.getAttribute('data-easymde-visual-block-id');
      if (!id || baselineRoots.has(id)) return 'refresh';
      baselineRoots.set(id, child);
    }
    if (baselineRoots.size !== blocks.length) return 'refresh';

    for (const [index, block] of blocks.entries()) {
      const row = beforeRows[index];
      const live = liveElements[index];
      const projection = projectedRows[index];
      const baseline = baselineRoots.get(block.id);
      if (!row || !live || !projection || !baseline) return 'refresh';
      const rowEdits = editsByRow.get(index) ?? [];
      const sourceFree = row.start === row.end;
      if (sourceFree) {
        // A source-free row owns no bytes: only its exact identity, frozen
        // attributes and content may survive, at its recorded anchor.
        if (block.editable || row.editable) return 'refresh';
        if (projection.start !== projection.end) return 'refresh';
        if (rowEdits.length) return 'refresh';
        if (
          serializeVisualMarkdownBlockFragment([live])
          !== serializeVisualMarkdownBlockFragment([baseline])
        ) return 'refresh';
        continue;
      }
      if (!rowEdits.length) {
        // An unchanged row need not be re-parsed, but its source bytes, node
        // and rendered content must all be exactly the accepted ones.
        if (
          serializeVisualMarkdownBlockFragment([live])
          !== serializeVisualMarkdownBlockFragment([baseline])
        ) return 'refresh';
        continue;
      }
      if (!row.editable) return 'refresh';
      const beforeSlice = beforeSource.slice(row.start, row.end);
      const afterSlice = afterSource.slice(projection.start, projection.end);
      let rowMerge: VisualMarkdownMergeResult;
      try {
        const beforeVisual = serializeVisualMarkdownBlockFragment([baseline]);
        const afterVisual = serializeVisualMarkdownBlockFragment([live]);
        rowMerge = mergeVisualMarkdownChangeDetails(
          beforeSlice,
          beforeVisual,
          afterVisual,
          createVisualMarkdownSourceIntervalMap(beforeSlice, beforeVisual)
        );
      } catch {
        return 'refresh';
      }
      if (rowMerge.value !== afterSlice) return 'refresh';
      const rowGlobalEdits = rowEdits.map((edit) => ({
        end: edit.end - row.start,
        replacement: edit.replacement,
        start: edit.start - row.start
      }));
      const rowMergedEdits = [...rowMerge.edits]
        .sort((left, right) => left.start - right.start)
        .map((edit) => ({
          end: edit.end,
          replacement: edit.replacement,
          start: edit.start
        }));
      if (
        rowMergedEdits.length !== rowGlobalEdits.length
        || rowMergedEdits.some((edit, position) => {
          const expected = rowGlobalEdits[position];
          return (
            !expected
            || edit.start !== expected.start
            || edit.end !== expected.end
            || edit.replacement !== expected.replacement
          );
        })
      ) return 'refresh';
      // Both outer boundaries of the changed row must be document edges or
      // unchanged blank-line separators, in the old AND the accepted source.
      // The rows are disjoint and ascending, so this is a pair of constant
      // slices - never a scan over neighbours.
      const beforePreviousEnd = 0 < index
        ? (beforeRows[index - 1]?.end ?? 0)
        : 0;
      const beforeNextStart = beforeRows[index + 1]?.start
        ?? beforeSource.length;
      const afterPreviousEnd = 0 < index
        ? (projectedRows[index - 1]?.end ?? 0)
        : 0;
      // The next row's accepted start comes from the same applied line
      // coordinates this walk already checked, never from a later iteration.
      const nextBlock = blocks[index + 1];
      const afterNextStart = nextBlock
        ? afterLineStarts[nextBlock.startLine] ?? afterSource.length
        : afterSource.length;
      const boundariesProved =
        (0 === row.start
          || fullBlankLineSeparator(beforeSource.slice(beforePreviousEnd, row.start)))
        && (beforeNextStart === row.end
          ? beforeNextStart === beforeSource.length
          : fullBlankLineSeparator(beforeSource.slice(row.end, beforeNextStart)))
        && (0 === projection.start
          || fullBlankLineSeparator(afterSource.slice(afterPreviousEnd, projection.start)))
        && (afterNextStart === projection.end
          ? afterNextStart === afterSource.length
          : fullBlankLineSeparator(afterSource.slice(projection.end, afterNextStart)));
      if (
        !fullPositiveRowDomain(
          beforeSource,
          row,
          baseline,
          afterSource,
          {
            editable: true,
            end: projection.end,
            id: block.id,
            start: projection.start
          },
          live,
          rowGlobalEdits,
          boundariesProved
        )
      ) return 'refresh';
    }

    // The complete proof passed: the origin still describes this topology, and
    // this DOM/source pair is the accepted one for it. The baseline installed
    // here is the live state this proof just validated, read once and stored
    // together with the ledger that describes those exact nodes, so the next
    // comparison is against what was proved rather than an older render.
    const validatedHtml = surface.innerHTML;
    acceptedHtmlRef.current = validatedHtml;
    acceptedNodesRef.current = owned.nodes;
    mapCertificateRef.current = {
      editMap: certificate.editMap,
      html: validatedHtml,
      nodes: owned.nodes,
      owner: fullOwnerRef.current,
      previewRevision: certificate.previewRevision,
      previewSignature: certificate.previewSignature,
      source: owned.source,
      sourceRevision: owned.sourceRevision,
      visual: owned.visual
    };
    if (visualCodeBodyOrdinalsRef.current) {
      const memo = visualCodeBodyOrdinalsRef.current;
      if (memo.previewSourceMarkdown !== owned.source) {
        visualCodeBodyOrdinalsRef.current = null;
        visualCodeBodyDomOrderInvalidRef.current = true;
      }
    }
    visualCodeBodyPreviewSourceRef.current = owned.source;
    return 'current';
  };

  const acceptedVisualCodePreIndex = (pre: HTMLElement): number | null => {
    if (null === acceptedHtmlRef.current) return null;
    const preIndex = visualCodePreOrder().indexOf(pre);
    if (preIndex < 0) {
      throw new Error('visual-editor-accepted-code-body-snapshot-stale');
    }
    return preIndex;
  };

  const visualLocalCodeBodyRecords =
    (): ReadonlyArray<IndexedLocalVisualCodeBodyProvenance> => {
      const order = visualCodePreOrder();
      const previousOrder = visualLocalCodeBodyOrderRef.current;
      if (
        previousOrder &&
        (previousOrder.length !== order.length ||
          previousOrder.some((pre, index) => pre !== order[index]))
      )
        return [];
      return order.flatMap((pre, preIndex) => {
        const provenance = visualLocalCodeBodyProvenanceRef.current.get(pre);
        return provenance ? [{ ...provenance, preIndex }] : [];
      });
    };

  const clearVisualLocalCodeBodyProvenance = (): void => {
    visualLocalCodeBodyProvenanceRef.current = new WeakMap();
    visualLocalCodeBodyBlocksRef.current = new Set();
    visualLocalCodeBodyOrderRef.current = null;
    acceptedLocalCodeBodiesRef.current = [];
  };

  const validateLocalVisualCodeBody = (
    inputBlock: VisualCodeInputSnapshot,
    markdown: string,
    provenance: LocalVisualCodeBodyProvenance
  ): void => {
    const order = visualCodePreOrder();
    const expectedOrder = visualLocalCodeBodyOrderRef.current;
    if (
      !surface.contains(inputBlock.pre) ||
      !inputBlock.pre.isConnected ||
      !expectedOrder ||
      expectedOrder.length !== order.length ||
      expectedOrder.some((pre, index) => pre !== order[index]) ||
      visualCodeBlockStructureSignature(markdown) !==
        provenance.structureSignature
    ) {
      throw new Error('visual-editor-code-body-map-stale');
    }
    const interval = visualCodeBodyIntervalAtOrdinal(
      markdown,
      provenance.codeOrdinal
    );
    if (
      interval.fence !== provenance.fence ||
      interval.info !== provenance.info ||
      inputBlock.fence !== provenance.fence ||
      (null !== inputBlock.fenceInfo &&
        inputBlock.fenceInfo !== provenance.info)
    ) {
      throw new Error('visual-editor-code-body-map-stale');
    }
  };

  const visualLocalCodeBodyProvenance = (
    inputBlock: VisualCodeInputSnapshot,
    markdown: string
  ): LocalVisualCodeBodyProvenance | null => {
    const provenance = visualLocalCodeBodyProvenanceRef.current.get(
      inputBlock.pre
    );
    if (!provenance) return null;
    validateLocalVisualCodeBody(inputBlock, markdown, provenance);
    return provenance;
  };

  const locallyExtendedPreviewCodeBodyOrdinal = (
    inputBlock: VisualCodeInputSnapshot,
    markdown: string,
    blockId: string,
    previewOrdinal: number
  ): number | null => {
    const snapshot = previewSnapshotRef.current;
    const editMap = snapshot.editMap;
    const previewSourceMarkdown = visualCodeBodyPreviewSourceRef.current;
    if (
      !editMap ||
      editMap.signature !== snapshot.signature ||
      null === previewSourceMarkdown
    ) {
      return null;
    }
    const previewOrdinals = createVisualCodeBodyOrdinalsForPreviewBlocks(
      previewSourceMarkdown,
      editMap
    );
    if (previewOrdinals.get(blockId) !== previewOrdinal) return null;

    const order = visualCodePreOrder();
    const targetIndex = order.indexOf(inputBlock.pre);
    if (targetIndex < 0) return null;
    const localRecords = visualLocalCodeBodyRecords();
    const currentLocalBlocks = Array.from(
      visualLocalCodeBodyBlocksRef.current
    ).filter((pre) => surface.contains(pre));
    if (
      !localRecords.length ||
      localRecords.length !== currentLocalBlocks.length
    ) {
      return null;
    }
    const localCodeBlockCount =
      visualCodeBlockCount(markdown) -
      visualCodeBlockCount(previewSourceMarkdown);
    if (localCodeBlockCount < 0 || localCodeBlockCount > localRecords.length) {
      return null;
    }
    for (const record of localRecords) {
      const localPre = order[record.preIndex];
      if (!localPre || record.preIndex <= targetIndex) return null;
      const localBlock = captureVisualCodeInputSnapshot(localPre);
      const provenance = visualLocalCodeBodyProvenanceRef.current.get(localPre);
      if (!localBlock || !provenance) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      validateLocalVisualCodeBody(localBlock, markdown, provenance);
    }

    const interval = visualCodeBodyIntervalAtOrdinal(markdown, previewOrdinal);
    if (
      interval.fence !== inputBlock.fence ||
      (null !== inputBlock.fenceInfo && interval.info !== inputBlock.fenceInfo)
    ) {
      return null;
    }
    return previewOrdinal;
  };

  const installVisualLocalCodeBodyProvenance = (
    markdown: string,
    records: ReadonlyArray<IndexedLocalVisualCodeBodyProvenance>
  ): void => {
    const preElements = visualCodePreOrder();
    visualLocalCodeBodyOrderRef.current = records.length ? preElements : null;
    const nextProvenance = new WeakMap<
      HTMLElement,
      LocalVisualCodeBodyProvenance
    >();
    const nextBlocks = new Set<HTMLElement>();
    for (const record of records) {
      const pre = preElements[record.preIndex];
      if (!pre) {
        throw new Error('visual-editor-code-body-history-restore-failed');
      }
      const provenance: LocalVisualCodeBodyProvenance = {
        codeOrdinal: record.codeOrdinal,
        fence: record.fence,
        info: record.info,
        structureSignature: record.structureSignature
      };
      const inputBlock = captureVisualCodeInputSnapshot(pre);
      if (!inputBlock) {
        throw new Error('visual-editor-code-body-history-restore-failed');
      }
      validateLocalVisualCodeBody(inputBlock, markdown, provenance);
      nextProvenance.set(pre, provenance);
      nextBlocks.add(pre);
    }
    visualLocalCodeBodyProvenanceRef.current = nextProvenance;
    visualLocalCodeBodyBlocksRef.current = nextBlocks;
  };

  const createLocalVisualCodeBodyProvenance = (
    pre: HTMLElement,
    markdown: string,
    visualMarkdown: string
  ): LocalVisualCodeBodyProvenance => {
    const inputBlock = captureVisualCodeInputSnapshot(pre);
    const selection = currentTextSelection(surface);
    if (
      !inputBlock ||
      !selection ||
      !inputBlock.code.contains(selection.anchorNode) ||
      !inputBlock.code.contains(selection.focusNode)
    ) {
      throw new Error('visual-editor-code-body-selection-invalid');
    }
    const sourceSelection = visualSelectionSourceRange(
      surface,
      markdown,
      visualMarkdown,
      visualMarkdown
    );
    const codeOrdinal = visualCodeBodyOrdinalForSourceRange(markdown, {
      end: sourceSelection.end,
      start: sourceSelection.start
    });
    const interval = visualCodeBodyIntervalAtOrdinal(markdown, codeOrdinal);
    const projection = projectVisualCodeBodySelection(
      inputBlock.code,
      markdown,
      visualMarkdown,
      codeOrdinal,
      {
        end: { node: selection.focusNode, offset: selection.focusOffset },
        start: { node: selection.anchorNode, offset: selection.anchorOffset }
      }
    );
    if (
      interval.fence !== inputBlock.fence ||
      (null !== inputBlock.fenceInfo &&
        interval.info !== inputBlock.fenceInfo) ||
      projection.codeOrdinal !== codeOrdinal
    ) {
      throw new Error('visual-editor-code-body-map-stale');
    }
    return {
      codeOrdinal,
      fence: interval.fence,
      info: interval.info,
      sourceBlockStart: interval.sourceBlockStart,
      structureSignature: visualCodeBlockStructureSignature(markdown)
    };
  };

  const prepareLocalVisualCodeBodyRegistration = (
    pre: HTMLElement,
    markdown: string,
    visualMarkdown: string,
    previousMarkdown: string
  ): LocalVisualCodeBodyRegistration => {
    const provenance = createLocalVisualCodeBodyProvenance(
      pre,
      markdown,
      visualMarkdown
    );
    const order = visualCodePreOrder();
    const previousOrder = visualLocalCodeBodyOrderRef.current;
    if (previousOrder) {
      const retainedOrder = previousOrder.filter((candidate) =>
        surface.contains(candidate)
      );
      const currentRetainedOrder = order.filter((candidate) =>
        previousOrder.includes(candidate)
      );
      if (
        retainedOrder.length !== currentRetainedOrder.length ||
        retainedOrder.some(
          (candidate, index) => candidate !== currentRetainedOrder[index]
        )
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
    }
    const codeBlockCountChange =
      visualCodeBlockCount(markdown) - visualCodeBlockCount(previousMarkdown);
    if (codeBlockCountChange < 0 || codeBlockCountChange > 1) {
      throw new Error('visual-editor-code-body-map-stale');
    }
    const structureSignature = provenance.structureSignature;
    const updates: Array<
      Readonly<{
        pre: HTMLElement;
        provenance: LocalVisualCodeBodyProvenance;
      }>
    > = [];
    for (const localPre of visualLocalCodeBodyBlocksRef.current) {
      if (!surface.contains(localPre) || localPre === pre) continue;
      const previousProvenance =
        visualLocalCodeBodyProvenanceRef.current.get(localPre);
      if (!previousProvenance) continue;
      const nextOrdinal =
        previousProvenance.codeOrdinal +
        (1 === codeBlockCountChange &&
        provenance.codeOrdinal <= previousProvenance.codeOrdinal
          ? 1
          : 0);
      const interval = visualCodeBodyIntervalAtOrdinal(markdown, nextOrdinal);
      if (
        interval.fence !== previousProvenance.fence ||
        interval.info !== previousProvenance.info
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      updates.push({
        pre: localPre,
        provenance: {
          ...previousProvenance,
          codeOrdinal: nextOrdinal,
          sourceBlockStart: interval.sourceBlockStart,
          structureSignature
        }
      });
    }
    return { order, pre, provenance, updates };
  };

  const commitLocalVisualCodeBodyRegistration = (
    registration: LocalVisualCodeBodyRegistration
  ): void => {
    for (const update of registration.updates) {
      visualLocalCodeBodyProvenanceRef.current.set(
        update.pre,
        update.provenance
      );
    }
    visualLocalCodeBodyProvenanceRef.current.set(
      registration.pre,
      registration.provenance
    );
    visualLocalCodeBodyBlocksRef.current.add(registration.pre);
    visualLocalCodeBodyOrderRef.current = registration.order;
  };


  /**
   * The structural certificate for one capture: accepted rows aligned to the
   * live surface plus the canonical caret the surface records. Without both,
   * the capture falls back to its ordinary owned-selection rule.
   */
  const structuralCaptureFor = (
    sourceMarkdown: string | null,
    editMap: PreviewEditMap | null | undefined,
    recordedCaret: number
  ): Readonly<{
    blocks: ReadonlyArray<VisualStructuralBoundaryBlock>;
    recordedCaret: number;
    sourceMarkdown: string;
  }> | null =>
    null === sourceMarkdown
      ? null
      : {
          blocks: visualStructuralBoundarySurfaceBlocks(
            surface,
            sourceMarkdown,
            editMap
          ),
          recordedCaret,
          sourceMarkdown
        };

  const captureVisualHistorySnapshot = useCallback(
    (
      markdown: string,
      html: string | undefined = undefined,
      tablePresentation: FullAcceptedTablePresentation | null = null
    ): VisualHistorySnapshot => {
      const resolvedHtml = html ?? (
        acceptedCodeBodySnapshotsRef.current.size
          ? surface.innerHTML
          : (acceptedHtmlRef.current ?? surface.innerHTML)
      );
      consumeVisualDomMutations(
        visualHistoryDomPairObserverRef.current?.takeRecords() ?? []
      );
      const historyState = documentHistoryState(documentSession.document);
      const slot = visualHistorySnapshotsRef.current.get(historyState.undoDepth);
      let retainedPresentation = tablePresentation;
      if (!retainedPresentation && slot?.kind === 'snapshot'
        && slot.markdown === markdown && slot.snapshot.tablePresentation?.source === markdown
        && slot.snapshot.tablePresentation.owner === fullOwnerRef.current) {
        // A same-source selection capture may retain the anchor, but foreign
        // replacements/reorders or protected mutations cannot carry it onward.
        try {
          const editMap = previewSnapshotRef.current.editMap;
          const protectedSnapshot = readOnlySnapshotRef.current;
          if (editMap && protectedSnapshot) {
            assertVisualMarkdownReadOnlySnapshot(surface, protectedSnapshot);
            assertAcceptedTopLevelVisualSurface(surface, editMap, acceptedHtmlRef.current, acceptedNodesRef.current);
            retainedPresentation = slot.snapshot.tablePresentation;
          }
        } catch {
          // The snapshot remains usable by ordinary history, but grants no
          // additional table-normalization capability from unowned DOM.
        }
      }
      const emptyParagraph = (() => {
        const ownedEmpty = ownedEmptyParagraphRef.current;
        if (!ownedEmpty || ownedEmpty.owner !== fullOwnerRef.current
          || ownedEmpty.source !== markdown
          || documentSession.document.getValue() !== markdown
          || ownedEmpty.revision !== documentSession.document.getRevision?.()
          || ownedEmpty.body.parentElement !== surface
          || ownedEmpty.body.childNodes.length !== 1
          || !(ownedEmpty.body.firstChild instanceof HTMLBRElement)
          || !ownedLedgerRetains(Array.from(surface.childNodes))) return undefined;
        const bodyPath = visualNodePath(surface, ownedEmpty.body);
        return bodyPath ? {
          bodyPath,
          sourceLength: ownedEmpty.sourceLength,
          sourceOffset: ownedEmpty.sourceOffset
        } : undefined;
      })();
      const acceptedCodeBodies = (() => {
        const sourceRevision = documentSession.document.getRevision?.();
        if (
          !Number.isSafeInteger(sourceRevision)
          || documentSession.document.getValue() !== markdown
        ) return [];
        const preOrder = visualCodePreOrder();
        const records: IndexedAcceptedCodeBodyCorrespondence[] = [];
        preOrder.forEach((pre, preIndex) => {
          const correspondence = acceptedCodeBodyCorrespondenceRef.current.get(pre);
          if (
            !correspondence
            || correspondence.owner !== fullOwnerRef.current
            || correspondence.source !== markdown
            || !Number.isSafeInteger(correspondence.sourceRevision)
            || !pre.isConnected
            || !surface.contains(pre)
          ) return;
          records.push({
            blockId: correspondence.blockId,
            interval: correspondence.interval,
            preIndex,
            source: correspondence.source,
            sourceRevision: correspondence.sourceRevision,
            structureSignature: correspondence.structureSignature
          });
        });
        return records;
      })();
      const selection = captureVisualHistorySelection(
        surface,
        () =>
          structuralCaptureFor(
            markdown,
            previewSnapshotRef.current.editMap,
            documentSession.document.getSelection?.().start ?? -1
          )
      );
      const domPair = undefined !== html && visualHistoryDomPairObserverRef.current
        ? {
            owner: fullOwnerRef.current,
            token: visualHistoryDomPairTokenRef.current
          }
        : undefined;
      return {
        acceptedCodeBodies,
        acceptedPreview: {
          mapped: Boolean(previewSnapshotRef.current.editMap),
          markdown: visualCodeBodyPreviewSourceRef.current,
          revision: previewSnapshotRef.current.revision,
          signature: previewSnapshotRef.current.signature
        },
        codeBodyPreviewSourceMarkdown: visualCodeBodyPreviewSourceRef.current,
        codeBodyPreviewStructureSignature:
          visualCodeBodyPreviewStructureRef.current,
        html: resolvedHtml,
        ...(emptyParagraph ? { emptyParagraph } : {}),
        historyState,
        localCodeBodies: visualLocalCodeBodyRecords(),
        markdown,
        tablePresentation: retainedPresentation,
        ...(domPair ? { domPair } : {}),
        selection: selection && domPair && !visualHistorySelectionNeedsNormalization(surface)
          ? { ...selection, nativePathPaired: true }
          : selection
      };
    },
    [consumeVisualDomMutations, documentSession, surface]
  );

  /**
   * A stored history snapshot may only be restored in place while the live
   * Preview identity is still the render the snapshot was captured against.
   * Any later Preview render owns a different edit map, so restoring the
   * stored DOM would pair it with a map that never described it. The target
   * state must then be rebuilt by the formal Preview owner instead.
   */
  const visualHistorySnapshotIsRestorable = useCallback(
    (snapshot: VisualHistorySnapshot): boolean => {
      const current = previewSnapshotRef.current;
      // A Preview without an edit map has no block identity that could be
      // paired with stale DOM. Preserve the existing plain-text history path;
      // mapped visual content still requires an exact accepted identity.
      if (!current.editMap) return !snapshot.acceptedPreview.mapped;
      if (
        snapshot.acceptedPreview.signature !== current.signature ||
        snapshot.acceptedPreview.revision !== current.revision
      ) {
        return false;
      }
      return current.editMap.signature === current.signature;
    },
    []
  );

  const appendVisualHistoryTransition = useCallback(
    (before: VisualHistorySnapshot, after: VisualHistorySnapshot): void => {
      if (before.markdown === after.markdown) return;
      const current = documentHistoryState(documentSession.document);
      if (
        current.undoDepth !== after.historyState.undoDepth ||
        current.redoDepth !== after.historyState.redoDepth
      ) {
        throw new Error('visual-editor-history-state-stale');
      }
      const beforeDepth =
        after.historyState.undoDepth < before.historyState.undoDepth
          ? after.historyState.undoDepth - 1
          : before.historyState.undoDepth;
      if (beforeDepth !== current.undoDepth) {
        const currentBeforeSlot =
          visualHistorySnapshotsRef.current.get(beforeDepth);
        if (currentBeforeSlot?.kind !== 'rematerialize') {
          visualHistorySnapshotsRef.current.set(beforeDepth, {
            kind: 'snapshot',
            markdown: before.markdown,
            snapshot: before
          });
        }
      }
      visualHistorySnapshotsRef.current.set(current.undoDepth, {
        kind: 'snapshot',
        markdown: after.markdown,
        snapshot: after
      });
    },
    [documentSession]
  );

  const recordVisualHistoryMutation = useCallback(
    (
      before: DocumentHistoryState,
      after: DocumentHistoryState,
      isolateHistoryBefore: boolean
    ): void => {
      const snapshots = visualHistorySnapshotsRef.current;
      if (0 !== after.redoDepth) {
        throw new Error('visual-editor-history-state-stale');
      }
      if (after.undoDepth > before.undoDepth + 1) {
        throw new Error('visual-editor-history-state-invalid');
      }
      if (isolateHistoryBefore && after.undoDepth === before.undoDepth) {
        throw new Error('visual-editor-history-boundary-not-isolated');
      }
      if (after.undoDepth < before.undoDepth) {
        const prunedDepths = before.undoDepth - after.undoDepth + 1;
        const rebased = new Map<number, VisualHistorySlot>();
        for (const [depth, slot] of snapshots) {
          if (depth < prunedDepths || depth > before.undoDepth) continue;
          rebased.set(depth - prunedDepths, slot);
        }
        snapshots.clear();
        for (const [depth, snapshot] of rebased) {
          snapshots.set(depth, snapshot);
        }
      } else if (before.redoDepth > 0) {
        for (const depth of snapshots.keys()) {
          if (depth > before.undoDepth) snapshots.delete(depth);
        }
      }
    },
    []
  );

  const recordCurrentVisualHistorySnapshot = useCallback(
    (markdown: string, html?: string): void => {
      const snapshot = captureVisualHistorySnapshot(
        markdown,
        html ?? surface.innerHTML
      );
      visualHistorySnapshotsRef.current.set(snapshot.historyState.undoDepth, {
        kind: 'snapshot',
        markdown: snapshot.markdown,
        snapshot
      });
      acceptedHtmlRef.current = snapshot.html;
      acceptedNodesRef.current = Array.from(surface.childNodes);
    },
    [captureVisualHistorySnapshot, surface]
  );

  /**
   * Captures the operation-level pre-edit native caret together with the
   * accepted identity it was read from.
   *
   * A preview-only surface never hands the visual caret to the canonical
   * session, so the history slot captured at mount keeps whatever selection the
   * session had then (often 0) while the user's caret sits elsewhere. The
   * witness is taken while the surface still shows exactly the accepted render
   * this owner holds: the live children are the accepted ledger, and the
   * Preview identity the slot records is the current accepted one. It is only
   * data for the commit that will consume it - nothing is written here, so a
   * cancelled input cannot alter history.
   */
  const captureVisualHistorySelectionWitness = useCallback(
    (
      historySelectionBefore: VisualSelectionSourceRange
    ): VisualHistorySelectionWitness | null => {
      const sourceMarkdown = sourceMarkdownRef.current;
      if (null === sourceMarkdown) return null;
      const historyState = documentHistoryState(documentSession.document);
      if (documentSession.document.getValue() !== sourceMarkdown) return null;
      const slot = visualHistorySnapshotsRef.current.get(historyState.undoDepth);
      if (
        slot?.kind !== 'snapshot' ||
        slot.markdown !== sourceMarkdown ||
        slot.snapshot.markdown !== sourceMarkdown ||
        slot.snapshot.historyState.undoDepth !== historyState.undoDepth ||
        slot.snapshot.historyState.redoDepth !== historyState.redoDepth
      ) {
        return null;
      }
      if (acceptedHtmlRef.current !== slot.snapshot.html) return null;
      // The accepted ledger must still be the live DOM: a replaced or reordered
      // window is not the surface this caret was read from.
      const acceptedNodes = acceptedNodesRef.current;
      const live = surface.childNodes;
      if (
        !acceptedNodes ||
        acceptedNodes.length !== live.length ||
        acceptedNodes.some((node, index) => live[index] !== node)
      ) {
        return null;
      }
      const accepted = previewSnapshotRef.current;
      if (
        slot.snapshot.acceptedPreview.signature !== accepted.signature ||
        slot.snapshot.acceptedPreview.revision !== accepted.revision ||
        slot.snapshot.acceptedPreview.mapped !== Boolean(accepted.editMap) ||
        (accepted.editMap &&
          accepted.editMap.signature !== accepted.signature)
      ) {
        return null;
      }
      consumeVisualDomMutations(
        visualHistoryDomPairObserverRef.current?.takeRecords() ?? []
      );
      const domPairVerified = Boolean(
        slot.snapshot.domPair
        && slot.snapshot.domPair.owner === fullOwnerRef.current
        && slot.snapshot.domPair.token === visualHistoryDomPairTokenRef.current
      );
      const revision = documentSession.document.getRevision?.();
      if (!Number.isSafeInteger(revision)) return null;
      const selection = captureVisualHistorySelection(surface);
      if (!selection) return null;
      const nativeSelection = surface.ownerDocument.defaultView?.getSelection();
      const witnessedHistorySelectionBefore = nativeSelection
        ? {
            ...historySelectionBefore,
            direction: nativeDocumentSelectionDirection(nativeSelection)
          }
        : historySelectionBefore;
      const pairedSelection = pairedVisualHistorySelection(
        surface,
        selection,
        slot.snapshot.html,
        domPairVerified
      );
      return {
        acceptedHtml: acceptedHtmlRef.current ?? '',
        acceptedPreview: slot.snapshot.acceptedPreview,
        historySelectionBefore: witnessedHistorySelectionBefore,
        historyState,
        revision: revision as number,
        selection: {
          ...(pairedSelection ?? selection),
          sourceSelection: { ...witnessedHistorySelectionBefore }
        },
        slot: slot.snapshot,
        sourceMarkdown
      };
    },
    [consumeVisualDomMutations, documentSession, surface]
  );

  /**
   * Applies a captured witness to the history slot the commit is about to
   * retire, and only while that slot, the canonical source and the accepted
   * Preview identity are still exactly the ones the witness was read from. The
   * slot keeps its own HTML, Preview identity and ledger: only its selection is
   * refreshed.
   */
  const applyVisualHistorySelectionWitness = useCallback(
    (
      witness: VisualHistorySelectionWitness | undefined,
      committedSourceMarkdown: string,
      historyBefore: DocumentHistoryState
    ): void => {
    if (!witness) { return; }
    // Every fact the witness was read from must still hold: the same canonical
    // source and revision, the same history depth, the same accepted Preview
    // identity and HTML, and the very same slot object. Anything else is an
    // ABA, a replacement or a foreign acceptance, and the slot keeps its own
    // recorded selection.
    if (
      witness.sourceMarkdown !== committedSourceMarkdown ||
      witness.historyState.undoDepth !== historyBefore.undoDepth ||
      witness.historyState.redoDepth !== historyBefore.redoDepth ||
      witness.revision !== documentSession.document.getRevision?.() ||
      witness.acceptedHtml !== acceptedHtmlRef.current
    ) {
      return;
    }
    const accepted = previewSnapshotRef.current;
    if (
      witness.acceptedPreview.signature !== accepted.signature ||
      witness.acceptedPreview.revision !== accepted.revision ||
      witness.acceptedPreview.mapped !== Boolean(accepted.editMap)
    ) {
      return;
    }
    const slot = visualHistorySnapshotsRef.current.get(historyBefore.undoDepth);
    if (
      slot?.kind !== 'snapshot' ||
      slot.snapshot !== witness.slot ||
      slot.markdown !== witness.sourceMarkdown
    ) {
      return;
    }
      visualHistorySnapshotsRef.current.set(historyBefore.undoDepth, {
        kind: 'snapshot',
        markdown: slot.markdown,
        snapshot: { ...slot.snapshot, selection: witness.selection }
      });
    },
    [documentSession]
  );

  const captureSnapshot = useCallback(
    (sourceMarkdown: string, options: CaptureSnapshotOptions = {}) => {
      if (options.acceptedPreviewSource || options.historyRestore) ownedEmptyParagraphRef.current = null;
      const previousIntervalRecord = visualSourceIntervalMapRef.current;
      const previousOwned = ownedDomRef.current;
      const previousMemory = visualSelectionMemoryRef.current;
      const previousVisual = visualMarkdownRef.current;
      const nativeMemoryWitness = surface.ownerDocument.defaultView?.getSelection();
      // A read-only materialization may change visual spelling, not the local
      // row's authority. Authenticate its existing memory before retiring it.
      const retainedLocal = !options.acceptedPreviewSource && !options.historyRestore
        && previousOwned?.owner === fullOwnerRef.current
        && previousOwned.source === sourceMarkdown
        && previousOwned.sourceRevision === documentSession.document.getRevision?.()
        && documentSession.document.getValue() === sourceMarkdown
        && fullOwnedDomMatches(surface, previousOwned)
        && previousMemory && null !== previousVisual
        && nativeMemoryWitness?.anchorNode === previousMemory.anchorNode
        && nativeMemoryWitness.anchorOffset === previousMemory.anchorOffset
        && nativeMemoryWitness.focusNode === previousMemory.focusNode
        && nativeMemoryWitness.focusOffset === previousMemory.focusOffset
        ? localCompositionVisualCertificate(surface, sourceMarkdown, previousVisual,
            previousMemory.anchorNode, previousMemory.anchorOffset,
            previousMemory.focusOffset, previousMemory)
        : null;
      if (options.acceptedPreviewSource) {
        clearVisualLocalCodeBodyProvenance();
        visualCodeBodyPreviewSourceRef.current = sourceMarkdown;
        // An accepted render retires the recorded re-authentication attempt
        // only when the condition behind it is actually resolved. This render
        // IS that resolution for an unproved origin (it becomes the new
        // certificate), and for a capability mismatch only once the supplied
        // identity really describes this accepted render. A blanket clear would
        // turn a persistent mismatch - an absent capability, or an identity the
        // accepted render still contradicts - into an unbounded request loop,
        // because acceptance alone cannot change either of those.
        const previousAttempt = refreshAttemptRef.current;
        if (previousAttempt) {
          const identity = generatedIdentityRef.current?.() ?? null;
          const acceptedMap = previewSnapshotRef.current.editMap;
          const acceptedRevision = documentSession.document.getRevision?.();
          // Any accepted render resolves an ORIGIN attempt: that render is what
          // the new certificate will describe, and it is per-generation keyed.
          const resolved =
            'origin' === previousAttempt.reason
            || previousAttempt.source !== sourceMarkdown
            || (null !== identity
              && null != acceptedMap
              && Number.isSafeInteger(acceptedRevision)
              && identity.signature === acceptedMap.signature
              && identity.editMap?.signature === acceptedMap.signature
              && identity.sourceRevision === acceptedRevision);
          if (resolved) refreshAttemptRef.current = null;
        }
        visualCodeBodyPreviewStructureRef.current =
          visualCodeBlockStructureSignature(sourceMarkdown);
        visualCodeBodyStructureValidationRef.current = {
          markdown: sourceMarkdown,
          matchesPreview: true
        };
        visualCodeBodyOrdinalsRef.current = null;
        visualCodeBodyDomOrderInvalidRef.current = true;
      }
      prepareVisualTaskListMarkers(surface);
      ensureEmptyVisualParagraph(surface, sourceMarkdown);
      protectVisualMarkdownReadOnlyRegions(surface);
      restoreVisualCodeFenceFamilies(surface, sourceMarkdown);
      readOnlySnapshotRef.current =
        captureVisualMarkdownReadOnlySnapshot(surface);
      acceptedPasteDocumentBoundaryRef.current = null;
      lastSelectionRef.current = null;
      visualSelectionMemoryRef.current = null;
      pendingVisualIntentRef.current = null;
      pendingVisualEmptyStructuralInputRef.current = null;
      pendingVisualIntentResultRef.current = null;
      pendingUnmappedVisualInputRef.current = false;
      continuingUnmappedVisualInputRef.current = false;
      sourceMarkdownRef.current = sourceMarkdown;
      if (!options.acceptedPreviewSource) {
        visualCodeBodyStructureValidationRef.current =
          visualCodeStructureCandidate(sourceMarkdown);
      }
      const visualMarkdown = serializeVisualMarkdown(surface);
      visualMarkdownRef.current = visualMarkdown;
      visualSourceIntervalMapRef.current = {
        map:
          !options.cacheSourceIntervalMap
          && previousIntervalRecord
          && previousIntervalRecord.sourceMarkdown === sourceMarkdown
          && previousIntervalRecord.visualMarkdown === visualMarkdown
            ? previousIntervalRecord.map
            : createVisualMarkdownSourceIntervalMap(
                sourceMarkdown,
                visualMarkdown
              ),
        sourceMarkdown,
        visualMarkdown
      };
      consumeVisualDomMutations(
        visualHistoryDomPairObserverRef.current?.takeRecords() ?? []
      );
      const html = surface.innerHTML;
      const domPair = {
        owner: fullOwnerRef.current,
        token: visualHistoryDomPairTokenRef.current
      };
      const capturedHistorySnapshot = captureVisualHistorySnapshot(
          sourceMarkdown,
          html,
          options.tablePresentation
        );
      const historySnapshot = {
        ...capturedHistorySnapshot,
        domPair,
        selection: capturedHistorySnapshot.selection
          && !visualHistorySelectionNeedsNormalization(surface)
          ? {
              ...capturedHistorySnapshot.selection,
              nativePathPaired: true
            }
          : capturedHistorySnapshot.selection
      };
      // A NEW observation never replaces an existing owner baseline. Only a
      // formal accepted render, or a surface that has no proved origin yet,
      // may install one; a history restore names its own ledger below.
      if (options.acceptedPreviewSource || !mapCertificateRef.current) {
        acceptedHtmlRef.current = historySnapshot.html;
        acceptedNodesRef.current = Array.from(surface.childNodes);
      }
      acceptedCodeBodySnapshotsRef.current.clear();
      acceptedLocalCodeBodiesRef.current = historySnapshot.localCodeBodies;
      visualHistorySnapshotsRef.current.set(
        historySnapshot.historyState.undoDepth,
        {
          kind: 'snapshot',
          markdown: historySnapshot.markdown,
          snapshot: historySnapshot
        }
      );
      visualBaselineMaterializedRef.current = true;
      capturedPreviewRevisionRef.current = previewSnapshotRevisionRef.current;
      if (options.acceptedPreviewSource) {
        // A real accepted render owns this DOM/source pair: the sink has just
        // adopted this surface, so the children read here are exactly the
        // render the accepted HTML describes. They are frozen as the ledger
        // together with their metadata and the formal origin, so a later local
        // commit is always compared against the render it descended from.
        const acceptedLedger = Array.from(surface.childNodes);
        acceptedNodesRef.current = acceptedLedger;
        const owned = publishOwnedDom(
          sourceMarkdown,
          visualMarkdown,
          documentSession.document.getRevision?.() ?? 0,
          {
            metadata: acceptedLedger.map(fullOwnedNodeMetadata),
            nodes: acceptedLedger
          }
        );
        if (!owned) return;
        const snapshot = previewSnapshotRef.current;
        // The accepted HTML is this owner's own ledger, but only a map that
        // actually names every mounted top-level ELEMENT can be certified for
        // it. Inter-root separators are Text nodes, so the map names elements
        // only: a render that mounted an element the map does not name (an
        // unmapped generated root) keeps its ledger and installs no
        // certificate, so no map-mediated operation can treat that surface as
        // having an accepted formal inventory.
        const acceptedMapNamesLedger = !snapshot.editMap
          || fullMapNamesElements(surface, snapshot.editMap);
        acceptedMapUnmappedRef.current = Boolean(
          snapshot.editMap && !acceptedMapNamesLedger
        );
        mapCertificateRef.current = snapshot.editMap && acceptedMapNamesLedger
          ? {
              editMap: snapshot.editMap,
              html: acceptedHtmlRef.current ?? html,
              nodes: owned.nodes,
              owner: fullOwnerRef.current,
              previewRevision: snapshot.revision,
              previewSignature: snapshot.signature,
              source: owned.source,
              sourceRevision: owned.sourceRevision,
              visual: owned.visual
            }
          : null;
        acceptedCodeBodyCorrespondenceRef.current =
          snapshot.editMap && acceptedMapNamesLedger
            ? captureAcceptedCodeBodyCorrespondence(
                sourceMarkdown,
                snapshot.editMap,
                owned.sourceRevision
              )
            : new Map();
      } else {
        // A materialized baseline or an in-place history/reset restore is this
        // owner's own operation, but it is not a formal render. It may only
        // publish a pairing it can actually prove: the retained verified ledger
        // (a selected-attribute restore over the same roots) or, for a real
        // history replacement, the nodes that operation itself installed. A
        // materialization over newly observed nodes proves nothing and
        // deliberately publishes nothing.
        const retained = ownedLedgerRetains(Array.from(surface.childNodes));
        if (retained) {
          publishOwnedDom(
            sourceMarkdown,
            visualMarkdown,
            documentSession.document.getRevision?.() ?? 0,
            retained
          );
        } else if (options.historyRestore) {
          // A history restore installed these exact children itself, so this
          // names the ledger that operation adopted rather than an unproven
          // observation of the surface.
          const restored = Array.from(surface.childNodes);
          publishOwnedDom(
            sourceMarkdown,
            visualMarkdown,
            documentSession.document.getRevision?.() ?? 0,
            {
              metadata: restored.map(fullOwnedNodeMetadata),
              nodes: restored
            }
          );
        } else {
          ownedDomRef.current = null;
        }
      }
      if (retainedLocal && previousMemory && ownedDomRef.current?.source === sourceMarkdown) {
        const sameVisual = visualMarkdown === previousVisual;
        const memoryStillCurrent = sameVisual
          && previousMemory.anchorNode.isConnected
          && previousMemory.focusNode.isConnected
          && previousMemory.anchorNode.parentElement === retainedLocal.root
          && previousMemory.focusNode.parentElement === retainedLocal.root
          && retainedLocal.root.parentElement === surface
          && isPlainVisualTextBody(retainedLocal.root, previousMemory.anchorNode)
          && isPlainVisualTextBody(retainedLocal.root, previousMemory.focusNode)
          && nativeMemoryWitness?.anchorNode === previousMemory.anchorNode
          && nativeMemoryWitness.anchorOffset === previousMemory.anchorOffset
          && nativeMemoryWitness.focusNode === previousMemory.focusNode
          && nativeMemoryWitness.focusOffset === previousMemory.focusOffset;
        if (memoryStillCurrent) {
          visualSelectionMemoryRef.current = previousMemory;
        } else {
          // When serialization changed, literal unit projection rebases only
          // the visual half of this retained memory through the current root.
          const roots = Array.from(surface.children).filter(
            (node): node is HTMLElement => node instanceof HTMLElement
          );
          const rootIndex = roots.indexOf(retainedLocal.root);
          const blockVisual = serializeVisualMarkdownBlockFragment([retainedLocal.root]);
          const prefixAndBlock = rootIndex < 0 ? ''
            : serializeVisualMarkdownBlockFragment(roots.slice(0, rootIndex + 1));
          const visualStart = prefixAndBlock.length - blockVisual.length;
          if (rootIndex >= 0 && visualStart >= 0 && visualMarkdown.startsWith(prefixAndBlock)) {
            const visualAnchor = literalTextBoundary(previousMemory.anchorNode.data,
              previousMemory.anchorOffset, visualMarkdown, visualStart);
            const visualFocus = literalTextBoundary(previousMemory.focusNode.data,
              previousMemory.focusOffset, visualMarkdown, visualStart);
            if (null !== visualAnchor && null !== visualFocus) {
              visualSelectionMemoryRef.current = { ...previousMemory, visualAnchor, visualFocus };
            }
          }
        }
      }
    },
    [
      captureVisualHistorySnapshot,
      consumeVisualDomMutations,
      documentSession,
      surface
    ]
  );

  const captureAcceptedPasteSnapshot = useCallback(
    (sourceMarkdown: string): void => {
      clearVisualLocalCodeBodyProvenance();
      prepareVisualTaskListMarkers(surface);
      ensureEmptyVisualParagraph(surface, sourceMarkdown);
      protectVisualMarkdownReadOnlyRegions(surface);
      restoreVisualCodeFenceFamilies(surface, sourceMarkdown);
      readOnlySnapshotRef.current =
        captureVisualMarkdownReadOnlySnapshot(surface);
      acceptedPasteDocumentBoundaryRef.current = null;
      lastSelectionRef.current = null;
      visualSelectionMemoryRef.current = null;
      pendingVisualIntentRef.current = null;
      pendingVisualEmptyStructuralInputRef.current = null;
      pendingVisualIntentResultRef.current = null;
      pendingUnmappedVisualInputRef.current = false;
      continuingUnmappedVisualInputRef.current = false;
      sourceMarkdownRef.current = sourceMarkdown;
      visualCodeBodyPreviewSourceRef.current = sourceMarkdown;
      visualCodeBodyPreviewStructureRef.current =
        visualCodeBlockStructureSignature(sourceMarkdown);
      visualCodeBodyStructureValidationRef.current = {
        markdown: sourceMarkdown,
        matchesPreview: true
      };
      visualCodeBodyOrdinalsRef.current = null;
      visualCodeBodyDomOrderInvalidRef.current = true;
      const directMap =
        createVisualMarkdownDirectSourceIntervalMap(sourceMarkdown);
      visualMarkdownRef.current = directMap.source;
      visualSourceIntervalMapRef.current = {
        map: directMap,
        sourceMarkdown,
        visualMarkdown: directMap.source
      };
      acceptedHtmlRef.current = null;
      acceptedCodeBodySnapshotsRef.current.clear();
      acceptedLocalCodeBodiesRef.current = [];
      const historySnapshot = captureVisualHistorySnapshot(
        sourceMarkdown,
        surface.innerHTML
      );
      visualHistorySnapshotsRef.current.set(
        historySnapshot.historyState.undoDepth,
        {
          kind: 'snapshot',
          markdown: historySnapshot.markdown,
          snapshot: historySnapshot
        }
      );
      visualBaselineMaterializedRef.current = false;
      capturedPreviewRevisionRef.current = previewSnapshotRevisionRef.current;
      // An accepted paste installs the source's own DOM, so these children are
      // the ledger that operation adopted - not a later observation. It is not
      // a formal render, so no certificate is installed: the next demand has to
      // obtain a real Preview for this source.
      const pasteLedger = Array.from(surface.childNodes);
      const pasteOwned = publishOwnedDom(
        sourceMarkdown,
        directMap.source,
        documentSession.document.getRevision?.() ?? 0,
        {
          metadata: pasteLedger.map(fullOwnedNodeMetadata),
          nodes: pasteLedger
        }
      );
      // The paste installs this source's own DOM, and the accepted snapshot
      // may already describe it. When that map names every mounted element and
      // its signature/revision are this snapshot's own, the pairing IS the
      // accepted render for these bytes, so it is certified like any other
      // accepted render. Otherwise nothing is installed and the next demand
      // obtains the formal render, exactly as before.
      const pasteSnapshot = previewSnapshotRef.current;
      mapCertificateRef.current =
        pasteOwned
        && pasteSnapshot.editMap
        && pasteSnapshot.editMap.signature === pasteSnapshot.signature
        && capturedPreviewRevisionRef.current === pasteSnapshot.revision
        && fullMapNamesElements(surface, pasteSnapshot.editMap)
          ? {
              editMap: pasteSnapshot.editMap,
              html: surface.innerHTML,
              nodes: pasteOwned.nodes,
              owner: fullOwnerRef.current,
              previewRevision: pasteSnapshot.revision,
              previewSignature: pasteSnapshot.signature,
              source: pasteOwned.source,
              sourceRevision: pasteOwned.sourceRevision,
              visual: pasteOwned.visual
            }
          : null;
      acceptedHtmlRef.current =
        null === mapCertificateRef.current
          ? null
          : mapCertificateRef.current.html;
      acceptedNodesRef.current =
        null === mapCertificateRef.current
          ? acceptedNodesRef.current
          : pasteOwned?.nodes ?? acceptedNodesRef.current;
    },
    [captureVisualHistorySnapshot, documentSession, surface]
  );

  const materializeVisualBaseline = useCallback((): boolean => {
    const sourceMarkdown = sourceMarkdownRef.current;
    if (null === sourceMarkdown) {
      throw new Error('visual-editor-markdown-snapshot-missing');
    }
    captureSnapshot(sourceMarkdown);
    return true;
  }, [captureSnapshot]);

  const restoreAcceptedSnapshot = useCallback((): boolean => {
    const acceptedHtml = acceptedHtmlRef.current;
    if (null === acceptedHtml) return false;
    // Restoring the accepted render repairs a window that was replaced,
    // reordered or inserted into. It is NOT a repair for a guarded ATTRIBUTE
    // change on a root this owner still holds: an element whose frozen
    // attributes no longer match the ledger (an editability change, a fence
    // flag, a block id) has been rewritten by someone else, and writing the old
    // HTML back would erase that edit while claiming a pairing this owner
    // cannot prove. Such a window is refused terminally instead. Text data
    // changes are ordinary typing and never reach this check.
    const ownedForRestore = ownedDomRef.current;
    if (ownedForRestore && ownedForRestore.owner === fullOwnerRef.current) {
      const live = surface.childNodes;
      for (let index = 0; index < ownedForRestore.nodes.length; index += 1) {
        const node = live[index];
        const expected = ownedForRestore.metadata[index];
        if (
          undefined === expected
          || !(node instanceof HTMLElement)
          || 'element' !== expected.kind
          || node !== ownedForRestore.nodes[index]
        ) continue;
        if (!fullOwnedNodeMetadataEqual(fullOwnedNodeMetadata(node), expected)) {
          return false;
        }
      }
    }
    const markdown = sourceMarkdownRef.current ?? '';
    const currentSlot = visualHistorySnapshotsRef.current.get(
      documentHistoryState(documentSession.document).undoDepth
    );
    if (currentSlot?.kind !== 'snapshot' || currentSlot.markdown !== markdown)
      return false;
    const codeBodySnapshots = Array.from(
      acceptedCodeBodySnapshotsRef.current.entries()
    );
    acceptedCodeBodySnapshotsRef.current.clear();
    const localCodeBodies = acceptedLocalCodeBodiesRef.current;
    clearVisualLocalCodeBodyProvenance();
    surface.innerHTML = acceptedHtml;
    const preElements = visualCodePreOrder();
    for (const [preIndex, preSnapshot] of codeBodySnapshots) {
      const acceptedPre = preElements[preIndex];
      if (!acceptedPre) {
        throw new Error('visual-editor-accepted-code-body-snapshot-stale');
      }
      acceptedPre.replaceWith(preSnapshot.cloneNode(true) as HTMLElement);
    }
    captureSnapshot(markdown);
    installVisualLocalCodeBodyProvenance(markdown, localCodeBodies);
    acceptedLocalCodeBodiesRef.current = localCodeBodies;
    recordCurrentVisualHistorySnapshot(markdown);
    return true;
  }, [
    captureSnapshot,
    documentSession,
    recordCurrentVisualHistorySnapshot,
    surface
  ]);

  const applyDocumentChange = useCallback(
    (
      change: Parameters<
        EditorDocumentSession['document']['applyTextChange']
      >[0],
      options: ApplyDocumentChangeOptions = {}
    ) => {
      const sourceChanged = change.value !== sourceMarkdownRef.current;
      const codeStructureValidation =
        options.validatedCodeStructure ??
        (sourceChanged ? visualCodeStructureCandidate(change.value) : null);
      if (
        codeStructureValidation &&
        codeStructureValidation.markdown !== change.value
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      if (
        options.rejectCodeStructureMismatch &&
        !codeStructureValidation?.matchesPreview
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      const historyBefore = sourceChanged
        ? documentHistoryState(documentSession.document)
        : null;
      if (historyBefore) {
        if (documentSession.document.getValue() !== sourceMarkdownRef.current) {
          throw new Error('visual-editor-history-document-stale');
        }
        const current = visualHistorySnapshotsRef.current.get(
          historyBefore.undoDepth
        );
        if (!current) {
          throw new Error('visual-editor-history-snapshot-missing');
        }
        if (current.markdown !== sourceMarkdownRef.current) {
          throw new Error('visual-editor-history-snapshot-stale');
        }
        // The operation's own pre-edit caret is only written here, at the
        // commit that retires this exact slot, and only while the slot, the
        // source and the accepted identity are still the ones it was read
        // from. A cancelled or superseded input never reaches this point.
        applyVisualHistorySelectionWitness(
          options.historySelectionWitness,
          sourceMarkdownRef.current,
          historyBefore
        );
      }
      const isolateHistoryBefore = Boolean(
        sourceChanged &&
          (options.isolateHistoryBefore || change.isolateHistoryBefore)
      );
      // The browser groups one typed run by WHAT changed (plain characters
      // inserted inside one code body), not by which internal path wrote it:
      // the fast intent splice and the whole-value synchronizer commit of the
      // same keystroke are one run either way.
      const sourceBeforeChange = sourceMarkdownRef.current;
      // The fast intent path already states its typing shape through
      // `options.joinPreviousHistory`; the document-wide semantic proof is
      // reserved for whole-value writes, which carry no `changes` at all.
      const typingChange = sourceChanged
        && (options.joinPreviousHistory
          || (undefined === change.changes
            && null !== sourceBeforeChange
            && singleCodeBodyTypingChange(sourceBeforeChange, change.value)));
      const joinPreviousHistory = Boolean(
        sourceChanged
        && typingChange
        && !options.isolateHistoryBefore
        && !change.isolateHistoryBefore
        && codeBodyTypingRunRef.current
      );
      selfWriteRef.current = true;
      try {
        documentSession.document.applyTextChange({
          ...change,
          ...(isolateHistoryBefore
            ? { isolateHistoryBefore: true }
            : {}),
          ...(joinPreviousHistory ? { joinPreviousHistory: true } : {})
        });
      } finally {
        selfWriteRef.current = false;
      }
      if (sourceChanged) {
        codeBodyTypingRunRef.current = Boolean(
          options.joinPreviousHistory || typingChange
        );
      }
      if (sourceChanged && historyBefore) {
        recordVisualHistoryMutation(
          historyBefore,
          documentHistoryState(documentSession.document),
          isolateHistoryBefore
        );
      }
      if (codeStructureValidation) {
        visualCodeBodyStructureValidationRef.current = codeStructureValidation;
      }
    },
    [
      applyVisualHistorySelectionWitness,
      captureVisualHistorySnapshot,
      documentSession,
      recordVisualHistoryMutation,
      surface
    ]
  );

  /**
   * The current source extent of one owned top-level root.
   *
   * When the certificate applies to this pair the row already IS that extent:
   * the complete proof above compared its rendered content, its source bytes
   * and its coordinates, so no second serialization of the document is
   * needed. When the pair is only owner-verified (a native split, or a
   * local commit outside the positive domain) the root's own serialization
   * and its real DOM prefix locate the same window, and both ends are
   * projected on whole Markdown-unit boundaries so a structural separator is
   * never pulled into the row.
   */
  /**
   * The native boundary for an accepted source offset inside a TABLE-like row.
   *
   * A table wrapper's rendered kind has no Markdown-unit projection of its own
   * (its cells are not source text), so the generic marker walk cannot place a
   * caret there. The row's own editable cells still spell the row's first line,
   * so an offset inside that line is placed at the same character position in
   * the corresponding cell, and only when both the accepted row and the live
   * element name the same block id. Returns the offset the DOM can actually
   * represent, or null.
   */
  const acceptedTableCaretBoundary = (
    surfaceElement: HTMLElement,
    source: string,
    editMap: PreviewEditMap,
    sourceOffset: number
  ): Readonly<{ node: Text; offset: number }> | null => {
    let rows: ReturnType<typeof visualStructuralBoundaryRows>;
    try {
      rows = visualStructuralBoundaryRows(source, editMap);
    } catch {
      return null;
    }
    if (rows.length !== editMap.blocks.length) return null;
    const elements = Array.from(surfaceElement.children);
    if (elements.length !== rows.length) return null;
    const matching = rows.flatMap((row, index) => {
      const content = fullRowContentExtent(source, row);
      return row.editable
        && sourceOffset >= content.start
        && sourceOffset <= content.end
        ? [{ content, index, row }]
        : [];
    });
    if (1 !== matching.length) return null;
    const match = matching[0];
    const root = match ? elements[match.index] : undefined;
    if (
      !match
      || !(root instanceof HTMLElement)
      || root.getAttribute('data-easymde-visual-block-id') !== match.row.id
    ) return null;
    const table = root.matches('table')
      ? root
      : root.querySelector<HTMLElement>(':scope > table');
    if (!table) return null;
    // The row's own first line is what its cells spell; anything past that
    // first line has no table-cell representation.
    const firstLine = source.slice(match.content.start, match.content.end)
      .split(/\r\n|\n|\r/u)[0] ?? '';
    const localOffset = sourceOffset - match.content.start;
    if (localOffset > firstLine.length) return null;
    const cells = Array.from(table.querySelectorAll<HTMLElement>('th, td'))
      .filter((cell) =>
        acceptedBoundaryAncestryIsEditable(
          cell.firstChild ?? cell,
          cell,
          surfaceElement
        )
      );
    // Walk the cells as the row's columns: each cell contributes its own text
    // plus the one pipe separator between columns.
    let cursor = 0;
    for (const cell of cells) {
      const text = cell.firstChild;
      if (!(text instanceof Text)) continue;
      const cellStart = cursor;
      const cellEnd = cellStart + text.data.length;
      if (localOffset >= cellStart && localOffset <= cellEnd) {
        return { node: text, offset: localOffset - cellStart };
      }
      cursor = cellEnd + 3;
    }
    return null;
  };

  /**
   * Publish a deliberate accepted source RANGE that is exactly one editable
   * row's content extent as that whole row. Returns true only when the range
   * matches one accepted row and the live element for that row exists; nothing
   * else is searched, widened or collapsed.
   */
  const acceptedWholeRowRangeSelection = (
    target: HTMLElement,
    source: string,
    editMap: PreviewEditMap,
    selection: VisualSelectionSourceRange
  ): boolean => {
    let rows: ReturnType<typeof visualStructuralBoundaryRows>;
    try {
      rows = visualStructuralBoundaryRows(source, editMap);
    } catch {
      return false;
    }
    if (rows.length !== editMap.blocks.length) return false;
    const elements = Array.from(target.children);
    if (elements.length !== rows.length) return false;
    const matching = rows.flatMap((row, index) => {
      const content = fullRowContentExtent(source, row);
      return row.editable
        && content.start === Math.min(selection.start, selection.end)
        && content.end === Math.max(selection.start, selection.end)
        ? [{ index, row }]
        : [];
    });
    if (1 !== matching.length) return false;
    const match = matching[0];
    const root = match ? elements[match.index] : undefined;
    if (
      !match
      || !(root instanceof HTMLElement)
      || root.getAttribute('data-easymde-visual-block-id') !== match.row.id
    ) return false;
    const native = target.ownerDocument.defaultView?.getSelection();
    if (!native) return false;
    const range = target.ownerDocument.createRange();
    range.selectNode(root);
    native.removeAllRanges();
    native.addRange(range);
    return true;
  };

  const currentRootExtent = (
    root: HTMLElement,
    source: string,
    visual: string,
    intervalMap: VisualMarkdownSourceIntervalMap,
    rows: ReadonlyArray<FullSourceRow> | null
  ): Readonly<{ end: number; start: number }> | null => {
    if (root.parentNode !== surface) return null;
    const siblings = Array.from(surface.childNodes);
    const index = siblings.indexOf(root);
    if (0 > index) return null;
    // Rows describe top-level ELEMENTS, in order. A whitespace or comment node
    // between roots does not own a row, so indexing by childNodes position
    // would silently pair this root with a neighbour's extent.
    const elements = Array.from(surface.children);
    const elementIndex = elements.indexOf(root);
    if (0 > elementIndex) return null;
    const row = rows?.[elementIndex];
    if (row) {
      if (!row.editable) return null;
      if (
        root.getAttribute('data-easymde-visual-block-id') !== row.id
        || elementIndex >= rows.length
        || elements.length !== rows.length
      ) return null;
      let serialization: string;
      let baseline: string;
      try {
        // The comparison source is the render this map describes. If that
        // render cannot be recovered for this row there is nothing to compare
        // against, and comparing the root with itself would prove nothing.
        // A `current` applicability certificate already states that this is
        // the accepted render the owned node list came from.
        const template = surface.ownerDocument.createElement('article');
        template.innerHTML = acceptedHtmlRef.current ?? '';
        const baselineRoot = Array.from(template.children).find(
          (child): child is HTMLElement =>
            child instanceof HTMLElement
            && child.getAttribute('data-easymde-visual-block-id') === row.id
        );
        if (!baselineRoot) return null;
        serialization = serializeVisualMarkdownBlockFragment([root]);
        baseline = serializeVisualMarkdownBlockFragment([baselineRoot]);
      } catch {
        return null;
      }
      if (serialization !== baseline) return null;
      return fullRowContentExtent(source, row);
    }
    let prefixMarkdown: string;
    let prefixWithRoot: string;
    let rootMarkdown: string;
    try {
      // Authenticated renderer whitespace stays in the owned child-node ledger,
      // but has no element row or block serialization. Never discard root text
      // that could contribute content, or accept an unowned node by filtering it.
      if (!ownedDomIsCurrent() || siblings.some((node) =>
        !(node instanceof HTMLElement)
        && !(node instanceof Text && /^[ \t\r\n]*$/u.test(node.data))
      )) return null;
      const clones = elements.map((node) => node.cloneNode(true) as HTMLElement);
      prefixMarkdown =
        0 === elementIndex
          ? ''
          : serializeVisualMarkdownBlockFragment(clones.slice(0, elementIndex));
      prefixWithRoot = serializeVisualMarkdownBlockFragment(
        clones.slice(0, elementIndex + 1)
      );
      rootMarkdown = serializeVisualMarkdownBlockFragment([root]);
    } catch {
      return null;
    }
    if (!prefixWithRoot.startsWith(prefixMarkdown)) return null;
    if (!prefixWithRoot.endsWith(rootMarkdown)) return null;
    const rootVisualStart = prefixWithRoot.length - rootMarkdown.length;
    if (rootVisualStart < prefixMarkdown.length) return null;
    // Whatever the serializer emitted between the previous root and this one
    // is separator only; the row's own extent starts at its own content.
    if (
      !/^[ \t\r\n]*$/u.test(
        prefixWithRoot.slice(prefixMarkdown.length, rootVisualStart)
      )
    ) return null;
    if (!visual.startsWith(prefixWithRoot)) return null;
    const sourceAt = (visualOffset: number): number | null => {
      const normalized = intervalMap.rawSourceOffsetAt(visualOffset);
      if (undefined === normalized) return null;
      if (!coversMarkdownUnits(intervalMap.source, normalized, normalized)) {
        return null;
      }
      const original = intervalMap.originalOffsetAt(normalized);
      return undefined === original ? null : original;
    };
    const start = sourceAt(rootVisualStart);
    const end = sourceAt(prefixWithRoot.length);
    if (null === start || null === end || end < start) return null;
    if (!coversMarkdownUnits(source, start, end)) return null;
    const terminator = /(?:\r\n|\n|\r)$/u.exec(source.slice(start, end));
    return { end: end - (terminator?.[0].length ?? 0), start };
  };

  /**
   * The first nonempty editable Text boundary inside one root. Protected,
   * spacer and read-only subtrees are skipped rather than searched, so a
   * generated region never supplies a native caret.
   */
  const firstEditableTextBoundary = (
    root: HTMLElement
  ): Readonly<{ node: Text; offset: number }> | null => {
    const walker = root.ownerDocument.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node instanceof Text) || !/\S/u.test(node.data)) continue;
      if (!acceptedBoundaryAncestryIsEditable(node, root, surface)) continue;
      return { node, offset: 0 };
    }
    return null;
  };

  /** The fenced interval whose own source block starts at this extent. */
  const codeIntervalAtExtentStart = (
    source: string,
    start: number,
    end: number
  ): VisualCodeBodyInterval | null => {
    let ordinal = 0;
    while (true) {
      let interval: VisualCodeBodyInterval;
      try {
        interval = visualCodeBodyIntervalAtOrdinal(source, ordinal);
      } catch {
        return null;
      }
      if (interval.sourceBlockStart === start) {
        return interval.sourceBlockEnd > end + 1 ? null : interval;
      }
      if (interval.sourceBlockStart > start) return null;
      if (interval.sourceBlockEnd > end) return null;
      ordinal += 1;
    }
  };

  /**
   * Every protected region of one kind inside a row, root included, in document
   * order. Capture and resolve must enumerate identically or an ordinal names
   * different regions on the two sides of a demand.
   */
  const enumerateProtected = (
    root: HTMLElement,
    selector: string
  ): ReadonlyArray<HTMLElement> => [
    ...(root.matches(selector) ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(selector))
  ];

  /**
   * The immutable descriptor of the generated or image subtarget this gesture
   * addressed inside one root, or null when it addressed no such region.
   */
  const protectedSubtargetTarget = (
    root: HTMLElement,
    target: Element | null,
    extent: Readonly<{ end: number; start: number }>
  ): FullContextSubtarget | null => {
    if (!target) return null;
    // Enumeration includes the root itself: a generated region can BE the
    // top-level row, and an ordinal derived from descendants alone would then
    // name a region that is not this row's own target.
    const image = target.closest('img');
    if (image instanceof HTMLImageElement && root.contains(image)) {
      const ordinal = enumerateProtected(root, 'img').indexOf(image);
      return 0 > ordinal
        ? null
        : {
            alt: image.getAttribute('alt') ?? '',
            kind: 'image',
            ordinal,
            src: image.getAttribute('src') ?? ''
          };
    }
    for (const kind of ['math', 'mermaid'] as const) {
      const selector =
        'math' === kind
          ? '.easymde-math, .easymde-math-block, .easymde-math-inline'
          : '.easymde-mermaid';
      const region = target.closest(selector);
      if (!(region instanceof HTMLElement) || !root.contains(region)) continue;
      const ordinal = enumerateProtected(root, selector).indexOf(region);
      if (0 > ordinal) return null;
      return {
        kind,
        ordinal,
        source:
          region.getAttribute('data-easymde-visual-markdown-source')
          ?? region.textContent
          ?? ''
      };
    }
    const link = target.closest('a');
    if (link instanceof HTMLAnchorElement && root.contains(link)) {
      const ordinal = enumerateProtected(root, 'a').indexOf(link);
      if (0 > ordinal) return null;
      return {
        end: extent.end,
        href: link.getAttribute('href') ?? '',
        kind: 'link',
        ordinal,
        start: extent.start
      };
    }
    return null;
  };

  /**
   * The current-source origin a pending transfer records about itself, so a
   * demand can later recognize the one presentation selection this owner
   * publishes for the same root. It is derived without moving the selection
   * and is independent of any target-lease lifetime: cancelling a menu must
   * not take away the transfer's own ability to restore its caret.
   */
  const currentAcceptedSelectionOrigin = (): FullAcceptedSelectionOrigin | null => {
    const source = sourceMarkdownRef.current;
    const visual = visualMarkdownRef.current;
    const revision = documentSession.document.getRevision?.();
    if (null === source || null === visual) return null;
    if (!Number.isSafeInteger(revision)) return null;
    const native = surface.ownerDocument.defaultView?.getSelection();
    if (!native?.anchorNode || !surface.contains(native.anchorNode)) return null;
    const root = directVisualBlockForSelectionNode(surface, native.anchorNode);
    if (!root) return null;
    const record = visualSourceIntervalMapRef.current;
    let intervalMap: VisualMarkdownSourceIntervalMap;
    try {
      intervalMap =
        record
        && record.sourceMarkdown === source
        && record.visualMarkdown === visual
          ? record.map
          : createVisualMarkdownSourceIntervalMap(source, visual);
    } catch {
      return null;
    }
    const applicability = certifyAcceptedMapApplicability();
    // The origin extent must be this root's own CURRENT-source bytes. The
    // accepted line topology names them under the same gates the complete
    // operation uses: the map still names every mounted top-level element in
    // order, and the accepted source has the same number of lines as this one.
    // Without that, an unchanged-row serialization is required instead.
    const snapshot = previewSnapshotRef.current;
    const certificate = mapCertificateRef.current;
    const topologyRows = (() => {
      const map = snapshot.editMap;
      if (!map || !certificate) return null;
      if (markdownLineStarts(source).length !== markdownLineStarts(certificate.source).length) {
        return null;
      }
      const elements = Array.from(surface.children);
      if (elements.length !== map.blocks.length) return null;
      if (elements.some((element, index) =>
        element.getAttribute('data-easymde-visual-block-id') !== map.blocks[index]?.id
      )) return null;
      const rows = visualStructuralBoundaryRows(source, map);
      return rows.length === map.blocks.length ? rows : null;
    })();
    const rows =
      topologyRows
      ?? ('current' === applicability && snapshot.editMap
        ? visualStructuralBoundaryRows(source, snapshot.editMap)
        : null);
    const extent =
      currentRootExtent(
        root,
        source,
        visual,
        intervalMap,
        rows && rows.length === previewSnapshotRef.current.editMap?.blocks.length
          ? rows
          : null
      )
      // A changed row KIND is what the complete operation reports as needing
      // one formal refresh, so its own serialization cannot match the accepted
      // render by definition. Its source bytes are still exactly the accepted
      // line topology's row for this element - and the transfer records them
      // only as the origin it will re-authenticate against that fresh render.
      ?? ('refresh' === applicability && topologyRows
        ? (() => {
            const index = Array.from(surface.children).indexOf(root);
            const row = topologyRows[index];
            if (!row || !row.editable) return null;
            if (row.id !== root.getAttribute('data-easymde-visual-block-id')) {
              return null;
            }
            const content = fullRowContentExtent(source, row);
            return content.end > content.start ? content : null;
          })()
        : null);
    if (!extent) return null;
    const canonical = documentSession.document.getSelection();
    return {
      extent,
      kind: root.tagName.toLowerCase(),
      owner: fullOwnerRef.current,
      selection: {
        direction: canonical.direction,
        end: canonical.end,
        start: canonical.start
      },
      source,
      sourceRevision: revision as number
    };
  };

  /**
   * Source-owned paragraph/table presentation normalization, only after the
   * exact accepted mapper refuses a collapsed source caret. Ordinary edits
   * require the same-source origin of a genuine kind change. Native history
   * instead requires an existing target slot's accepted table anchor and a
   * separately authenticated canonical history command; it never transports
   * or relabels the pre-command origin.
   *
   * Both paths independently prove the fresh accepted row, exact extent and
   * first editable Text boundary. Source, revision and both history depths
   * remain unchanged. Only the ordinary demand may publish its one-shot
   * receipt; later history replay cannot revive that demand.
   */

  const acceptTablePresentation = (
    pending: PendingMarkdownTransfer,
    editMap: PreviewEditMap,
    mode: 'normalize' | 'retain'
  ): Readonly<{
    presentation: FullAcceptedTablePresentation;
    selection: VisualSelectionSourceRange;
  }> | null => {
    const revision = documentSession.document.getRevision?.();
    const expectation = pending.spec.expectation;
    const historyProof = pending.spec.historyProof?.tablePresentation;
    const origin = pending.spec.selectionOrigin;
    const retaining = mode === 'retain';
    if (retaining && !historyProof) return null;
    if (!retaining && historyProof && !historyProof.canNormalize) return null;
    let extent: Readonly<{ end: number; start: number }>;
    if (historyProof) {
      const slot = visualHistorySnapshotsRef.current.get(historyProof.depth);
      const currentHistory = documentHistoryState(documentSession.document);
      const currentSelection = documentSession.document.getSelection();
      const presentation = historyProof.presentation;
      if (
        historyProof.owner !== fullOwnerRef.current
        || presentation.owner !== fullOwnerRef.current
        || !slot
        || slot !== historyProof.slot
        || slot.kind !== 'snapshot'
        || slot.snapshot.tablePresentation !== presentation
        || slot.markdown !== expectation.value
        || slot.snapshot.markdown !== expectation.value
        || presentation.source !== expectation.value
        || revision !== historyProof.revision
        || currentHistory.undoDepth !== historyProof.depth
        || currentHistory.undoDepth !== historyProof.history.undoDepth
        || currentHistory.redoDepth !== historyProof.history.redoDepth
        || null !== canonicalExpectationMismatch(
          expectation,
          { history: currentHistory, selection: currentSelection },
          { history: true, revision: false, selection: true, value: false }
        )
        || expectation.selection.direction !== historyProof.selection.direction
        || expectation.selection.start !== historyProof.selection.start
        || expectation.selection.end !== historyProof.selection.end
      ) return null;
      extent = presentation.extent;
    } else {
      // Ordinary edits still require their honest same-source origin. A native
      // history restore must never relabel that pre-command source/revision.
      if (!origin || origin.owner !== fullOwnerRef.current) return null;
      if (origin.source !== expectation.value) return null;
      if ('p' !== origin.kind) return null;
      if ('none' !== origin.selection.direction) return null;
      if (origin.selection.start !== origin.selection.end) return null;
      if (revision !== origin.sourceRevision) return null;
      if (origin.selection.start !== expectation.selection.start) return null;
      extent = origin.extent;
    }
    if (!retaining && ('none' !== expectation.selection.direction
      || expectation.selection.start !== expectation.selection.end)) return null;
    if (documentSession.document.getValue() !== expectation.value) return null;
    if (!activeRef.current) return null;
    if (externalChangeReportedRef.current) return null;
    if (visualTransferFailureReportedRef.current) return null;
    if (pendingTransferRef.current !== pending) return null;
    if (!documentSession.document.isEditable()) return null;
    // The staged proof must be the ACTUAL ready accepted render: the same map
    // object, its signature and the revision this surface really accepted.
    const staged = previewSnapshotRef.current;
    // The accepted render is identified by its own signature/map identity, not
    // by this owner's snapshot counter: `capturedPreviewRevisionRef` records
    // the counter value at the last capture and the ordinary direct-canonical
    // demand path has always compared the map signature there, not the
    // revision. Requiring the snapshot counter to equal the current one would
    // reject a genuinely staged render whose counter moved on.
    if (
      staged.editMap !== editMap
      || staged.editMap.signature !== staged.signature
      || staged.signature !== pending.signature
      // The code-body inventory is advanced only by the complete proof, so a
      // native commit legitimately leaves it naming the ORIGIN source this
      // origin record was taken from. What it must never name is a third
      // document: then its code ordinals describe bytes nobody here owns.
      || (
        null !== visualCodeBodyPreviewSourceRef.current
        && visualCodeBodyPreviewSourceRef.current !== expectation.value
        && visualCodeBodyPreviewSourceRef.current
          !== (historyProof ? historyProof.originSource : mapCertificateRef.current?.source)
      )
    ) return null;
    const readOnlySnapshot = readOnlySnapshotRef.current;
    if (!readOnlySnapshot) return null;
    try {
      // The staged DOM must still be the protected accepted surface; a
      // generated/opaque mutation disqualifies the presentation policy.
      assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
    } catch {
      return null;
    }
    const history = documentHistoryState(documentSession.document);
    let rows: ReturnType<typeof visualStructuralBoundaryRows>;
    try {
      rows = visualStructuralBoundaryRows(expectation.value, editMap);
    } catch {
      return null;
    }
    const matching = rows.flatMap((row, index) => {
      const content = fullRowContentExtent(expectation.value, row);
      return row.editable
        && content.start === extent.start
        && content.end === extent.end
        ? [{ content, index }]
        : [];
    });
    if (1 !== matching.length) return null;
    const match = matching[0];
    if (!match) return null;
    if (!retaining && (expectation.selection.start < match.content.start
      || expectation.selection.start > match.content.end)) return null;
    const liveElements = Array.from(surface.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement
    );
    const root = liveElements[match.index];
    if (!root || !surface.contains(root)) return null;
    // The policy exists for a GENUINE kind change. A same-kind root has an
    // exact presentation and must not borrow this normalization.
    if (!historyProof && root.tagName.toLowerCase() === origin?.kind) return null;
    // The replacement root must really be the table wrapper for this source
    // row: a section holding the table the accepted row's bytes spell. A
    // paragraph that merely became some other section-shaped block is not this
    // transition and keeps its existing failure.
    if ('section' !== root.tagName.toLowerCase()) return null;
    if (!root.querySelector('table')) return null;
    if (
      root.getAttribute('data-easymde-visual-block-id') !== rows[match.index]?.id
    ) return null;
    const detached = root.cloneNode(true) as HTMLElement;
    let rowVisual: string;
    try {
      rowVisual = serializeVisualMarkdownBlockFragment([detached]);
    } catch {
      return null;
    }
    let rowMap: VisualMarkdownSourceIntervalMap;
    try {
      rowMap = createVisualMarkdownSourceIntervalMap(
        expectation.value.slice(match.content.start, match.content.end),
        rowVisual
      );
    } catch {
      return null;
    }
    // One detached clone and one row interval map: walk to the FIRST nonempty
    // editable Text unit and require both of its endpoints to map. There is
    // no search of other text and no other root.
    const walker = detached.ownerDocument.createTreeWalker(
      detached,
      NodeFilter.SHOW_TEXT
    );
    let unit: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node instanceof Text) || !/\S/u.test(node.data)) continue;
      if (!acceptedBoundaryAncestryIsEditable(node, detached, detached)) {
        continue;
      }
      unit = node;
      break;
    }
    if (!unit) return null;
    const rowSource = expectation.value.slice(
      match.content.start,
      match.content.end
    );
    const start = mapTextBoundaryFromInterval(
      detached,
      unit,
      0,
      rowVisual,
      rowMap,
      true
    );
    const end = mapTextBoundaryFromInterval(
      detached,
      unit,
      unit.data.length,
      rowVisual,
      rowMap,
      true
    );
    if (!start || !end || end.sourceOffset < start.sourceOffset) return null;
    if (!coversMarkdownUnits(rowSource, start.sourceOffset, end.sourceOffset))
      return null;
    const path = visualFragmentNodePath(detached, unit);
    let liveNode: Node = root;
    for (const index of path) {
      const child = liveNode.childNodes[index];
      if (!child) return null;
      liveNode = child;
    }
    if (!(liveNode instanceof Text)) return null;
    if (!acceptedBoundaryAncestryIsEditable(liveNode, root, surface)) {
      return null;
    }
    const actualOffset = match.content.start + start.sourceOffset;
    if (!coversMarkdownUnits(expectation.value, actualOffset, actualOffset)) {
      return null;
    }
    if (historyProof && actualOffset !== historyProof.presentation.offset) return null;
    // Retention authenticates an EXISTING anchor against the fresh accepted
    // row. It ends before reading/changing focus, selection or any receipt.
    if (retaining && historyProof) return {
      presentation: historyProof.presentation,
      selection: expectation.selection
    };
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection) return null;
    const canonicalBefore = documentSession.document.getSelection();
    const leaseState = contextMenuLeaseRef.current;
    const lease = leaseState && !leaseState.released ? leaseState.lease : null;
    const witnessExtent = leaseState?.witness.extent;
    const canPublishReceipt = Boolean(
      !historyProof && lease
      && 'undefined' !== typeof lease.consumeAcceptedSelectionTransition
      && witnessExtent
      && witnessExtent.start === extent.start
      && witnessExtent.end === extent.end
      && leaseState?.witness.selection.start === canonicalBefore.start
      && leaseState?.witness.selection.end === canonicalBefore.end
    );
    surface.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.collapse(liveNode, 0);
    const after: EditorContextMenuSurfaceSnapshot = {
      revision,
      selection: {
        direction: 'none',
        end: actualOffset,
        start: actualOffset
      },
      value: expectation.value
    };
    const publication: FullAcceptedSelectionPublication | null =
      canPublishReceipt && lease
        ? {
            active: true,
            after,
            before: {
              revision,
              selection: canonicalBefore,
              value: expectation.value
            },
            consumed: false,
            editMap,
            extent,
            history,
            lease,
            owner: fullOwnerRef.current,
            previewRevision: previewSnapshotRef.current.revision,
            previewSignature: previewSnapshotRef.current.signature,
            root,
            transfer: pending
          }
        : null;
    if (publication && leaseState) leaseState.publication = publication;
    try {
      applyDocumentChange({
        selection: after.selection,
        value: expectation.value
      });
    } finally {
      if (publication) publication.active = false;
      if (leaseState) leaseState.publication = null;
    }
    const committed = documentSession.document.getSelection();
    const committedHistory = documentHistoryState(documentSession.document);
    if (
      committedHistory.undoDepth !== history.undoDepth
      || committedHistory.redoDepth !== history.redoDepth
      || documentSession.document.getRevision?.() !== revision
      || documentSession.document.getValue() !== expectation.value
      || committed.start !== actualOffset
      || committed.end !== actualOffset
      || 'none' !== committed.direction
    ) return null;
    if (!root.isConnected || surface.children[match.index] !== root
      || previewSnapshotRef.current !== staged) return null;
    if (!acceptedBoundaryAncestryIsEditable(liveNode, root, surface)) return null;
    if (!selection.isCollapsed || selection.anchorNode !== liveNode
      || selection.focusNode !== liveNode || selection.anchorOffset !== 0
      || selection.focusOffset !== 0) return null;
    try {
      assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
    } catch {
      return null;
    }
    return {
      presentation: historyProof?.presentation ?? {
        extent: { end: match.content.end, start: match.content.start },
        offset: actualOffset,
        owner: fullOwnerRef.current,
        source: expectation.value
      },
      selection: { direction: 'none', end: actualOffset, start: actualOffset }
    };
  };

  const codeOrdinalForInputBlock = (
    inputBlock: VisualCodeInputSnapshot,
    markdown: string,
    required = false,
    allowAuthenticatedPendingBody = false
  ): number | null => {
    const localProvenance = visualLocalCodeBodyProvenance(inputBlock, markdown);
    if (localProvenance) return localProvenance.codeOrdinal;
    const correspondence = acceptedCodeBodyCorrespondenceRef.current.get(
      inputBlock.pre
    );
    if (
      correspondence
      && correspondence.owner === fullOwnerRef.current
      && inputBlock.pre.parentElement
      && surface.contains(inputBlock.pre)
    ) {
      try {
        let previousOrdinal = -1;
        for (const pre of visualCodePreOrder()) {
          const mounted = acceptedCodeBodyCorrespondenceRef.current.get(pre);
          if (!mounted) continue;
          if (mounted.interval.codeOrdinal <= previousOrdinal) {
            throw new Error('visual-editor-code-body-map-stale');
          }
          previousOrdinal = mounted.interval.codeOrdinal;
        }
        const interval = visualCodeBodyIntervalAtOrdinal(
          markdown,
          correspondence.interval.codeOrdinal
        );
        const expectedBody = normalizeCodeLineEndings(
          markdown.slice(interval.bodyStart, interval.bodyEnd)
        );
        const actualBody = normalizeCodeLineEndings(inputBlock.codeText);
        const rendererTerminalLine = interval.lineEnding
          && expectedBody.endsWith(interval.lineEnding)
          && actualBody === expectedBody.slice(0, -interval.lineEnding.length);
        const bodyMatches =
          actualBody === expectedBody
          || actualBody === `${expectedBody}\n`
          || rendererTerminalLine;
        if (
          interval.fence === correspondence.interval.fence
          && interval.info === correspondence.interval.info
          && inputBlock.fence === interval.fence
          && (null === inputBlock.fenceInfo
            || inputBlock.fenceInfo === interval.info)
          && (
            bodyMatches
            || (
              allowAuthenticatedPendingBody
              && correspondence.source === markdown
              && correspondence.structureSignature ===
                visualCodeBlockStructureSignature(markdown)
            )
          )
        ) {
          return interval.codeOrdinal;
        }
      } catch {
        // The formal path below remains the fail-closed authority when the
        // transported correspondence no longer describes this PRE.
      }
    }
    const snapshot = previewSnapshotRef.current;
    const editMap = snapshot.editMap;
    if (!editMap || editMap.signature !== snapshot.signature) {
      if (!required) return null;
      throw new Error('visual-editor-code-block-map-unavailable');
    }
    const previewSourceMarkdown = visualCodeBodyPreviewSourceRef.current;
    if (null === previewSourceMarkdown) {
      if (!required) return null;
      throw new Error('visual-editor-code-block-map-unavailable');
    }
    const blockId = visualBlockIdForPre(inputBlock.pre, surface);
    if (!blockId) {
      if (!required) return null;
      throw new Error('visual-editor-code-block-map-unavailable');
    }
    const validation = visualCodeBodyStructureValidationRef.current;
    const pendingVisual = pendingVisualIntentResultRef.current;
    const pendingCodeStructure = pendingVisual?.codeBlockStructure;
    const pendingSourceMatchesPreview = Boolean(
      validation?.matchesPreview &&
        pendingCodeStructure?.preserving &&
        pendingCodeStructure.baseMarkdown === validation.markdown &&
        pendingVisual?.result.sourceMarkdown === markdown
    );
    const sourceMatchesPreview =
      validation?.markdown === markdown
        ? validation.matchesPreview
        : pendingSourceMatchesPreview ||
          visualCodeStructureCandidate(markdown).matchesPreview;
    let cached = visualCodeBodyOrdinalsRef.current;
    if (
      cached?.signature !== snapshot.signature ||
      cached.previewSourceMarkdown !== previewSourceMarkdown
    ) {
      cached = {
        ordinals: createVisualCodeBodyOrdinalsForPreviewBlocks(
          previewSourceMarkdown,
          editMap
        ),
        orderedBlockIds: [],
        previewSourceMarkdown,
        signature: snapshot.signature
      };
      cached = {
        ...cached,
        orderedBlockIds: Array.from(cached.ordinals.entries())
          .sort((left, right) => left[1] - right[1])
          .map(([id]) => id)
      };
      visualCodeBodyOrdinalsRef.current = cached;
      visualCodeBodyDomOrderInvalidRef.current = true;
    }
    consumeVisualDomMutations(
      visualCodeBodyDomOrderObserverRef.current?.takeRecords() ?? []
    );
    if (visualCodeBodyDomOrderInvalidRef.current) {
      // The live surface can mount only a slice of the document (the windowed
      // owner), and that slice need not be one run: the window can keep a
      // retained block alongside the visible chunk. Collect every mounted id,
      // including ones the map does not know, so a foreign node cannot hide.
      const mountedPres = Array.from(surface.querySelectorAll('pre'));
      const mountedBlockIds = mountedPres.flatMap((pre) => {
        let root: HTMLElement | null = pre;
        while (root && root !== surface) {
          const id = root.getAttribute('data-easymde-visual-block-id');
          if (id) return [id];
          root = root.parentElement;
        }
        return [];
      });
      // Indexes of mounted fences this owner created itself, which the
      // accepted ordinal map deliberately does not contain.
      const locallyCreatedCodeBodyPreIndexes = new Set(
        mountedPres.flatMap((pre, index) =>
          visualLocalCodeBodyProvenanceRef.current.has(pre) ? [index] : []
        )
      );
      const mountedIdsAreOrderedSubsequence = (
        ordinals: ReadonlyMap<string, number>,
        orderedBlockIds: ReadonlyArray<string>
      ): boolean => {
        // A mounted `pre` the accepted map does not describe is legitimate
        // only when this owner created it locally (an unpreviewed fence the
        // user just typed): those carry local provenance and are intentionally
        // outside the accepted ordinal map. Anything else is foreign.
        const known = mountedBlockIds.filter(
          (id, index) =>
            ordinals.has(id)
            || locallyCreatedCodeBodyPreIndexes.has(index)
        );
        if (known.length !== mountedBlockIds.length) return false;
        // The mapped ids must appear in the map's own order, but need not be
        // adjacent: an unmounted stretch between two mounted runs is normal,
        // and so is a map that extends past the mounted window. Walking once
        // with a forward-only cursor still rejects a reorder, because a
        // swapped pair needs a step backwards.
        let cursor = 0;
        for (const id of mountedBlockIds) {
          if (!ordinals.has(id)) continue;
          while (
            cursor < orderedBlockIds.length
            && orderedBlockIds[cursor] !== id
          ) {
            cursor += 1;
          }
          if (cursor === orderedBlockIds.length) return false;
          cursor += 1;
        }
        return true;
      };
      if (
        !mountedIdsAreOrderedSubsequence(
          cached.ordinals,
          cached.orderedBlockIds
        )
      ) {
        // An accepted snapshot can introduce a fence the cached map predates: a
        // paste that opens a code block turns an existing block into a new
        // `pre`. The canonical source is already correct at that point, so
        // rebuild once from the pair that is current now and re-check. A
        // genuine reorder, a foreign node or a missing block still disagrees
        // and stays an explicit failure.
        const rebuiltOrdinals = createVisualCodeBodyOrdinalsForPreviewBlocks(
          previewSourceMarkdown,
          editMap
        );
        const rebuiltOrder = Array.from(rebuiltOrdinals.entries())
          .sort((left, right) => left[1] - right[1])
          .map(([id]) => id);
        if (!mountedIdsAreOrderedSubsequence(rebuiltOrdinals, rebuiltOrder)) {
          throw new Error('visual-editor-code-body-map-stale');
        }
        cached = {
          ordinals: rebuiltOrdinals,
          orderedBlockIds: rebuiltOrder,
          previewSourceMarkdown,
          signature: snapshot.signature
        };
        visualCodeBodyOrdinalsRef.current = cached;
      }
      visualCodeBodyDomOrderInvalidRef.current = false;
    }
    const previewOrdinal = cached.ordinals.get(blockId);
    if (undefined === previewOrdinal) {
      if (!required) return null;
      throw new Error('visual-editor-code-body-map-ambiguous');
    }
    if (sourceMatchesPreview) return previewOrdinal;
    const locallyExtendedOrdinal = locallyExtendedPreviewCodeBodyOrdinal(
      inputBlock,
      markdown,
      blockId,
      previewOrdinal
    );
    if (null === locallyExtendedOrdinal) {
      throw new Error('visual-editor-code-body-map-stale');
    }
    return locallyExtendedOrdinal;
  };

  const failPendingTransfer = useCallback(
    (code: string) => {
      if (null !== canonicalAdoptionDeadlineRef.current) {
        clearTimeout(canonicalAdoptionDeadlineRef.current);
        canonicalAdoptionDeadlineRef.current = null;
      }
      if (!pendingTransferRef.current) {
        // Already terminal: report the code, but never repeat the one
        // transfer-failure notification or a second pending settle.
        onFailure(code);
        return;
      }
      pendingTransferRef.current = null;
      acceptedPasteDocumentBoundaryRef.current = null;
      pendingNativeOperationRef.current = null;
      // A transfer's operation-bound correspondence dies with the transfer.
      // Publish the terminal failure state BEFORE the readiness settle. Root
      // notifies parked demands synchronously from the pending transition, so a
      // demand that woke there would otherwise see a stale accepted source with
      // no failure flag set and start a second formal Preview request for a
      // transfer that has already failed. The flag is what makes that wake
      // observe a terminal failure, so it must be set before anything publishes
      // readiness.
      visualTransferFailureReportedRef.current = true;
      onFailure(code);
      onTransferFailure();
      onPendingChange(false);
    },
    [onFailure, onPendingChange, onTransferFailure]
  );

const failVisualSynchronization = useCallback(
      (error: unknown): false => {
        const code =
        error instanceof Error
          ? error.message
          : 'visual-editor-markdown-sync-failed';
            if (restoreAcceptedSnapshot()) {
        onFailure(code);
        return false;
      }
      if (visualTransferFailureReportedRef.current) return false;
      visualTransferFailureReportedRef.current = true;
      onFailure(code);
      onTransferFailure();
      return false;
    },
    [onFailure, onTransferFailure, restoreAcceptedSnapshot]
  );

  const synchronizeMarkdown = useCallback(
    (options: SynchronizeMarkdownOptions = {}): boolean => {
      let sourceBeforeSynchronize: string | null = null;
      let synchronizeStartedFromCurrentDocument = false;
      if (visualTransferFailureReportedRef.current) return false;
      try {
        if (pendingTransferRef.current) return false;
        const readOnlySnapshot = readOnlySnapshotRef.current;
        if (null === readOnlySnapshot) {
          throw new Error('visual-editor-read-only-snapshot-missing');
        }
        assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
        const editedVisualMarkdown = serializeVisualMarkdown(surface);
        const sourceMarkdown = sourceMarkdownRef.current;
        const baselineVisualMarkdown = visualMarkdownRef.current;
        if (null === sourceMarkdown || null === baselineVisualMarkdown) {
          throw new Error('visual-editor-markdown-snapshot-missing');
        }
        sourceBeforeSynchronize = sourceMarkdown;
        synchronizeStartedFromCurrentDocument =
          documentSession.document.getValue() === sourceMarkdown;
        const pendingNative = pendingNativeOperationRef.current;
        const nativeSplit =
          pendingNative?.kind === 'split' ? pendingNative : null;
        const splitSelectionBefore = nativeSplit?.candidate && nativeSplit.owner === fullOwnerRef.current
          && nativeSplit.source === sourceMarkdown && nativeSplit.sourceOffset !== null
          && nativeSplit.sourceRevision === documentSession.document.getRevision?.()
          ? { direction: 'none' as const, start: nativeSplit.sourceOffset, end: nativeSplit.sourceOffset } : null;
        // Ownership is validated BEFORE this synchronizer writes the canonical
        // document. Serialization equality is not ownership: an equal-looking
        // clone would otherwise be adopted as this owner's DOM simply because
        // Markdown stayed the same. An unchanged window therefore has to be the
        // retained ledger itself, and a changed window is either that ledger or
        // one verified native paragraph split - nothing else.
        const retainedLedger = options.ownerResult?.ledger
          ?? ownedLedgerRetainsLive()
          ?? verifiedOwnerCommandLedger(options.ownerCommandBefore, options.ownerCodeFenceCommand);
        // A surface with no proved formal origin at all has nothing whose nodes
        // could be laundered, so its existing no-render behaviour stays exactly
        // as it was. As soon as this owner holds an origin certificate, only a
        // verified ledger may advance it.
        const noProvedOrigin = !mapCertificateRef.current;
        if (editedVisualMarkdown === baselineVisualMarkdown
          && (!options.ownerResult || options.ownerResult.value === sourceMarkdown)) {
          // A zero-byte own native join changes the node window without
          // changing the source, so this gate admits exactly that bounded
          // witness and nothing else.
          const verifiedJoinLedger = retainedLedger
            ? null
            : consumeVerifiedNativeRootJoin(false);
          if (!retainedLedger && !verifiedJoinLedger && !noProvedOrigin) {
            throw new Error('visual-editor-canonical-change-dom-stale');
          }
          if (!verifiedJoinLedger) pendingNativeOperationRef.current = null;
          if (options.ownerResult) {
            applyDocumentChange({ value: sourceMarkdown, selection: options.ownerResult.selection });
            lastSelectionRef.current = options.ownerResult.selection;
          }
          if ('' === editedVisualMarkdown) {
            ensureEmptyVisualParagraph(surface, sourceMarkdown);
          }
          if (options.mapSelectionWhenUnchanged) {
            let mappedSelection: VisualSelectionSourceRange;
            try {
              // A structural gap certificate is only meaningful on the
              // accepted surface: the map, its signature, the accepted
              // children and the canonical source must all still describe
              // what is mounted, so a mutated accepted child cannot be
              // blessed just because the serialized Markdown is unchanged.
              const structuralMap = previewSnapshotRef.current.editMap;
              const gapSelection = surface.ownerDocument.defaultView?.getSelection();
              const gapOffset = gapSelection?.anchorOffset ?? -1;
              const caretBesideBreak = Boolean(
                gapSelection?.isCollapsed
                && gapSelection.anchorNode === surface
                && gapSelection.focusNode === surface
                && (surface.childNodes[gapOffset] instanceof HTMLHRElement
                  || surface.childNodes[gapOffset - 1] instanceof HTMLHRElement)
              );
              let structuralCapture: ReturnType<
                typeof visualStructuralBoundaryCapture
              > = null;
              if (
                caretBesideBreak
                && structuralMap
                && structuralMap.signature ===
                  previewSnapshotRef.current.signature
                && capturedPreviewRevisionRef.current ===
                  previewSnapshotRef.current.revision
                && visualCodeBodyPreviewSourceRef.current === sourceMarkdown
                && documentSession.document.getValue() === sourceMarkdown
              ) {
                try {
                  assertAcceptedTopLevelVisualSurface(
                    surface,
                    structuralMap,
                    acceptedHtmlRef.current,
                    acceptedNodesRef.current
                  );
                  structuralCapture = visualStructuralBoundaryCapture(
                    surface,
                    sourceMarkdown,
                    visualStructuralBoundarySurfaceBlocks(
                      surface,
                      sourceMarkdown,
                      structuralMap
                    ),
                    documentSession.document.getSelection?.().start ?? -1
                  );
                } catch {
                  structuralCapture = null;
                }
              }
              const genericSelection = (): VisualSelectionSourceRange => {
                try {
                  return visualSelectionSourceRange(
                    surface,
                    sourceMarkdown,
                    baselineVisualMarkdown,
                    editedVisualMarkdown,
                    options.acceptedDocumentBoundary
                      ? {
                          acceptedPasteDocumentBoundary:
                            options.acceptedDocumentBoundary
                        }
                      : {}
                  );
                } catch (error) {
                  // The already-projected literal row is a certified native
                  // spelling of its canonical slice; the generic merge cannot
                  // re-merge it for selection mapping. Use the same accepted
                  // whole-row certificate the edit path uses, and keep the
                  // merge rejection for every uncertified input.
                  const native = surface.ownerDocument.defaultView?.getSelection();
                  const certified = native?.anchorNode && native.focusNode
                    ? acceptedDecodedBlockSelection(
                        surface,
                        {
                          anchorNode: native.anchorNode,
                          anchorOffset: native.anchorOffset,
                          focusNode: native.focusNode,
                          focusOffset: native.focusOffset
                        },
                        sourceMarkdown,
                        editedVisualMarkdown,
                        previewSnapshotRef.current.editMap ?? null
                      )
                    : null;
                  if (!certified) throw error;
                  return {
                    direction: native
                      ? nativeDocumentSelectionDirection(native)
                      : 'none',
                    end: certified.source.end,
                    start: certified.source.start
                  };
                }
              };
              const formalCompositionSelection = (): VisualSelectionSourceRange | null => {
                const current = currentTextSelection(surface);
                const root = current?.anchorNode.parentElement;
                if (!current || !(current.anchorNode instanceof Text)
                  || root?.textContent?.includes('\\')) return null;
                const formal = acceptedDecodedBlockSelection(
                  surface,
                  current,
                  sourceMarkdown,
                  baselineVisualMarkdown,
                  previewSnapshotRef.current.editMap ?? null
                );
                if (!formal) return null;
                const native = surface.ownerDocument.defaultView?.getSelection();
                return {
                  direction: native ? nativeDocumentSelectionDirection(native) : 'none',
                  end: formal.source.end,
                  start: formal.source.start
                };
              };
              const localCompositionSelection = (): VisualSelectionSourceRange | null => {
                const current = currentTextSelection(surface);
                const memory = visualSelectionMemoryRef.current;
                const root = current?.anchorNode.parentElement;
                const owned = ownedDomRef.current;
                if (
                  !current
                  || !memory
                  || !root
                  || current.anchorNode !== current.focusNode
                  || root.parentElement !== surface
                  || !isPlainVisualTextBody(root, current.anchorNode)
                  || !owned
                  || owned.owner !== fullOwnerRef.current
                  || owned.source !== sourceMarkdown
                  || owned.visual !== baselineVisualMarkdown
                  || owned.sourceRevision !== documentSession.document.getRevision?.()
                  || !owned.nodes.includes(root)
                  || !ownedLedgerRetains(Array.from(surface.childNodes))
                ) return null;
                const formal = current.anchorNode.data.includes('\\')
                  ? null
                  : acceptedDecodedBlockSelection(
                      surface,
                      current,
                      sourceMarkdown,
                      baselineVisualMarkdown,
                      previewSnapshotRef.current.editMap ?? null
                    );
                if (formal) return null;
                const certificate = localCompositionVisualCertificate(
                  surface,
                  sourceMarkdown,
                  baselineVisualMarkdown,
                  current.anchorNode,
                  current.anchorOffset,
                  current.focusOffset,
                  memory
                );
                if (!certificate) return null;
                const native = surface.ownerDocument.defaultView?.getSelection();
                return {
                  direction: native ? nativeDocumentSelectionDirection(native) : 'none',
                  end: certificate.sourceRange.end,
                  start: certificate.sourceRange.start
                };
              };
              mappedSelection =
                structuralCapture?.selection
                ?? (options.acceptedTopLevelSelection
                  ? acceptedTopLevelVisualSelection(
                      surface,
                      sourceMarkdown,
                      previewSnapshotRef.current.editMap,
                      previewSnapshotRef.current.signature,
                      previewSnapshotRef.current.revision,
                      capturedPreviewRevisionRef.current,
                      visualCodeBodyPreviewSourceRef.current
                    )
                  : null) ??
                formalCompositionSelection() ??
                localCompositionSelection() ??
                genericSelection();
            } catch (error) {
              if (
                error instanceof Error &&
                'visual-editor-markdown-merge-failed' === error.message
              ) {
                throw new Error(
                  'visual-editor-unchanged-selection-merge-failed'
                );
              }
              throw error;
            }
            lastSelectionRef.current = mappedSelection;
            // CodeMirror owns the canonical selection used by delegated
            // Media operations. This same-value dispatch changes only that
            // selection; its document adapter does not write the document.
            applyDocumentChange({
              selection: mappedSelection,
              value: sourceMarkdown
            });
          }
          visualMarkdownRef.current = editedVisualMarkdown;
          const unchangedNodes = Array.from(surface.childNodes);
          const unchangedLedger = retainedLedger
            ?? verifiedJoinLedger
            ?? (noProvedOrigin
              ? {
                  metadata: unchangedNodes.map(fullOwnedNodeMetadata),
                  nodes: unchangedNodes
                }
              : null);
          if (!unchangedLedger) {
            throw new Error('visual-editor-canonical-change-dom-stale');
          }
          acceptedHtmlRef.current = surface.innerHTML;
          acceptedNodesRef.current = unchangedLedger.nodes;
          acceptedCodeBodySnapshotsRef.current.clear();
          acceptedLocalCodeBodiesRef.current = visualLocalCodeBodyRecords();
          // The surface still is the pairing this owner verified, so the
          // ledger and the committed source advance together. A newly observed
          // node or attribute is never adopted on the strength of unchanged
          // Markdown: that is exactly the laundering this check exists for.
          publishOwnedDom(
            sourceMarkdown,
            editedVisualMarkdown,
            documentSession.document.getRevision?.() ?? 0,
            unchangedLedger
          );
          if (options.ownerResult || options.ownerCommandBefore) {
            recordCurrentVisualHistorySnapshot(sourceMarkdown, surface.innerHTML);
          }
          return true;
        }
        // A changed surface is a NEW source. This render mounted a top-level
        // root its accepted map does not name, so the owner has no formal
        // inventory mapping those bytes to rows: publishing a changed pairing
        // here would launder exactly the unowned root the map omits. An
        // unchanged surface is still this render's own visual state and takes
        // the untouched path above.
        if (acceptedMapUnmappedRef.current) {
          throw new Error('visual-editor-canonical-change-dom-stale');
        }
        const boundedMerge = !options.ownerResult && options.acceptedTopLevelSelection
          ? acceptedTopLevelVisualMerge(
              surface,
              sourceMarkdown,
              previewSnapshotRef.current.editMap,
              previewSnapshotRef.current.signature,
              previewSnapshotRef.current.revision,
              capturedPreviewRevisionRef.current,
              visualCodeBodyPreviewSourceRef.current,
              acceptedHtmlRef.current,
              options.acceptedTopLevelWindow ?? null
            )
          : null;
        // A composition owner result names both the exact canonical value and
        // the witnessed native caret. Its visible surface is expected to
        // differ from the pre-composition baseline by the serializer's escaped
        // spelling, so the ordinary merge would either duplicate that spelling
        // or reject its own authenticated result. Preserve the owner's value
        // and selection directly; the retained ledger above remains the proof
        // that no foreign root entered this window.
        const mergeResult = options.ownerResult
          ? { edits: [], value: options.ownerResult.value }
          : boundedMerge
            ? {
                edits: [{
                  end: boundedMerge.changes.to,
                  replacement: boundedMerge.changes.insert,
                  start: boundedMerge.changes.from
                }],
                value: boundedMerge.value
              }
            : mergeVisualMarkdownChangeDetails(
                sourceMarkdown,
                baselineVisualMarkdown,
                editedVisualMarkdown,
                undefined,
                {
                  structuralEmptyParagraphRemoval: Boolean(
                    pendingNativeOperationRef.current?.candidate
                  )
                }
              );
        const value = options.ownerResult?.value ?? mergeResult.value;
        if ('' === editedVisualMarkdown) {
          ensureEmptyVisualParagraph(surface, value);
        }
        let selection: VisualSelectionSourceRange;
        if (options.ownerResult || boundedMerge) {
          selection = options.ownerResult?.selection ?? boundedMerge!.selection;
          lastSelectionRef.current = selection;
        } else {
          const inferredEdit =
            !options.preferVisualSelection &&
            collapsedVisualSelection(surface) &&
            1 === mergeResult.edits.length
              ? mergeResult.edits[0]
              : null;
          if (inferredEdit) {
            const caret = inferredEdit.start + inferredEdit.replacement.length;
            selection = {
              direction: 'none',
              end: caret,
              start: caret
            };
            lastSelectionRef.current = selection;
          } else {
            try {
              selection = visualSelectionSourceRange(
                surface,
                sourceMarkdown,
                baselineVisualMarkdown,
                editedVisualMarkdown,
                {
                  structuralEmptyParagraphRemoval: Boolean(
                    pendingNativeOperationRef.current?.candidate
                  )
                }
              );
              lastSelectionRef.current = selection;
            } catch (error) {
              if (
                error instanceof Error &&
                'visual-editor-selection-unavailable' === error.message &&
                lastSelectionRef.current
              ) {
                selection = lastSelectionRef.current;
              } else {
                throw error;
              }
            }
          }
        }
        // The DOM window this synchronizer is about to adopt must be this
        // owner's own ledger, one verified native split, or the exact bounded
        // window a typed owner operation just rewrote. This runs before the
        // canonical write, so an unproven transition never reaches the document.
        // The window this commit adopts. A verified ledger (retained or one
        // proved native split) and a typed owner operation are the only ways a
        // surface WITH a formal origin may advance. A surface with no proved
        // origin at all has no accepted render whose nodes could be laundered,
        // so its own native input remains the owner's operation, exactly as
        // before this certificate existed.
        const commitLedger =
          options.ownerResult?.ledger ??
          verifiedOwnedLedgerForCommit()
          ?? (boundedMerge && options.acceptedTopLevelWindow
            ? verifiedAcceptedWindowLedger(options.acceptedTopLevelWindow)
            : null)
          ?? verifiedOwnerCommandLedger(options.ownerCommandBefore, options.ownerCodeFenceCommand)
          ?? verifiedRecomposedSurfaceLedger()
          ?? (noProvedOrigin
            ? {
                metadata: Array.from(surface.childNodes).map(
                  fullOwnedNodeMetadata
                ),
                nodes: Array.from(surface.childNodes)
              }
            : null);
        if (!commitLedger) {
          throw new Error('visual-editor-canonical-change-dom-stale');
        }
        const validatedCodeStructure = visualCodeStructureCandidate(value);
        if (options.localCodeBodyInputPre) {
          const localInput = captureVisualCodeInputSnapshot(
            options.localCodeBodyInputPre
          );
          const localProvenance = visualLocalCodeBodyProvenanceRef.current.get(
            options.localCodeBodyInputPre
          );
          if (!localInput || !localProvenance) {
            throw new Error('visual-editor-code-body-map-stale');
          }
          validateLocalVisualCodeBody(localInput, value, localProvenance);
        }
        if (
          options.rejectCodeStructureMismatch &&
          !validatedCodeStructure.matchesPreview
        ) {
          throw new Error('visual-editor-code-body-map-stale');
        }
        const localCodeBodyRegistration = options.localCodeBodyPre
          ? prepareLocalVisualCodeBodyRegistration(
              options.localCodeBodyPre,
              value,
              editedVisualMarkdown,
              sourceMarkdown
            )
          : null;
        const nextAcceptedCodeBodyCorrespondence =
          value === sourceMarkdown
            ? new Map(acceptedCodeBodyCorrespondenceRef.current)
            : acceptedCodeBodyCorrespondenceForCommit(
                sourceMarkdown,
                value,
                mergeResult.edits,
                documentSession.document.getRevision?.() ?? 0
              );
        const editSelectionBeforeRaw = pendingEditSelectionBeforeRef.current;
        pendingEditSelectionBeforeRef.current = null;
        const editHistorySelectionBefore = editSelectionBeforeRaw?.historySelectionBefore;
        const editHistorySelectionWitness = editSelectionBeforeRaw?.historySelectionWitness;
        // Pre-edit selection proof for one shape only: the user's own
        // noncollapsed TEXT selection that this edit deleted. The merge
        // producer already verified the removed interval; the captured raw
        // selection corroborates it O(1) - same text node, and the selected
        // span length equals the removed length - so Undo's inverse restores
        // exactly what the user had selected. Everything else (collapsed
        // carets, element-anchored selections) records nothing new and keeps
        // the write's existing shape. Connectivity is certified ONCE, at the
        // beforeinput capture, as an immutable witness: the native edit may
        // legitimately detach or remove the very node it deleted, so the
        // post-mutation state of that node proves nothing either way.
        let editSelectionBefore: VisualSelectionSourceRange | null = null;
        const pureDeletionEdit =
          1 === mergeResult.edits.length &&
          "" === mergeResult.edits[0]?.replacement
            ? mergeResult.edits[0]
            : null;
        if (
          pureDeletionEdit &&
          editSelectionBeforeRaw?.certifiedInsideSurface &&
          editSelectionBeforeRaw.anchorNode === editSelectionBeforeRaw.focusNode &&
          editSelectionBeforeRaw.anchorNode instanceof Text &&
          editSelectionBeforeRaw.anchorOffset !== editSelectionBeforeRaw.focusOffset
        ) {
          const selectedLength = Math.abs(
            editSelectionBeforeRaw.focusOffset - editSelectionBeforeRaw.anchorOffset
          );
          if (selectedLength === pureDeletionEdit.end - pureDeletionEdit.start) {
            editSelectionBefore = {
              direction:
                editSelectionBeforeRaw.anchorOffset < editSelectionBeforeRaw.focusOffset
                  ? "forward"
                  : "backward",
              end: pureDeletionEdit.end,
              start: pureDeletionEdit.start
            };
          }
        }
        if (
          options.ownerResult?.historySelectionBefore
          || options.historySelectionBefore
          || editHistorySelectionBefore
          || splitSelectionBefore
        ) {
          editSelectionBefore =
            options.ownerResult?.historySelectionBefore
            ?? options.historySelectionBefore
            ?? editHistorySelectionBefore
            ?? splitSelectionBefore;
        }
        const historySelectionWitness =
          options.historySelectionWitness ?? editHistorySelectionWitness;
        applyDocumentChange(
          {
            selection,
            ...(editSelectionBefore
              ? {
                  historySelectionBefore: {
                    direction: editSelectionBefore.direction,
                    end: editSelectionBefore.end,
                    start: editSelectionBefore.start
                  },
                  recordHistorySelection: true
                }
              : {}),
            value
          },
          {
            ...(historySelectionWitness
              ? { historySelectionWitness }
              : {}),
            isolateHistoryBefore: Boolean(options.isolateHistoryBefore),
            rejectCodeStructureMismatch: Boolean(
              options.rejectCodeStructureMismatch
            ),
            validatedCodeStructure
          }
        );
        if (localCodeBodyRegistration) {
          commitLocalVisualCodeBodyRegistration(localCodeBodyRegistration);
        }
        acceptedCodeBodyCorrespondenceRef.current =
          nextAcceptedCodeBodyCorrespondence;
        sourceMarkdownRef.current = value;
        visualMarkdownRef.current = editedVisualMarkdown;
        visualSourceIntervalMapRef.current = {
          map: createVisualMarkdownSourceIntervalMap(
            value,
            editedVisualMarkdown
          ),
          sourceMarkdown: value,
          visualMarkdown: editedVisualMarkdown
        };
        const presentationRevisionBefore = documentSession.document.getRevision?.();
        const presentationHistoryBefore = documentHistoryState(documentSession.document);
        const presentationSelectionBefore = documentSession.document.getSelection();
        const presentationPendingIntentBefore = pendingVisualIntentRef.current;
        const presentationPendingResultBefore = pendingVisualIntentResultRef.current;
        const presentationTransferBefore = pendingTransferRef.current;
        let presentationFailed = false;
        let presentationError: unknown = null;
        const presentationOwnedBefore = ownedDomRef.current;
        const presentationOwnerBefore = fullOwnerRef.current;
        const presentationActiveBefore = activeRef.current;
        if (value !== sourceMarkdown) {
          try {
            onMarkdownChange();
          } catch (error) {
            presentationFailed = true;
            presentationError = error;
          }
          if (sourceMarkdownRef.current !== value
            || documentSession.document.getValue() !== value) {
            throw new Error('visual-editor-history-document-stale');
          }
        }
        const presentationNodes = Array.from(surface.childNodes);
        const presentationActiveAfter = activeRef.current;
        const presentationRevisionAfter = documentSession.document.getRevision?.();
        const presentationHistoryAfter = documentHistoryState(documentSession.document);
        const presentationSelectionAfter = documentSession.document.getSelection();
        const presentationWitnessFailures = [
          presentationRevisionAfter !== presentationRevisionBefore ? 'revision' : null,
          documentSession.document.getValue() !== value ? 'document-value' : null,
          sourceMarkdownRef.current !== value ? 'source-ref' : null,
          presentationHistoryAfter.undoDepth !== presentationHistoryBefore.undoDepth
            ? 'history-undo'
            : null,
          presentationHistoryAfter.redoDepth !== presentationHistoryBefore.redoDepth
            ? 'history-redo'
            : null,
          presentationSelectionAfter.start !== presentationSelectionBefore.start
            ? 'selection-start'
            : null,
          presentationSelectionAfter.end !== presentationSelectionBefore.end
            ? 'selection-end'
            : null,
          presentationSelectionAfter.direction !== presentationSelectionBefore.direction
            ? 'selection-direction'
            : null,
          pendingVisualIntentRef.current !== presentationPendingIntentBefore
            ? 'pending-intent'
            : null,
          pendingVisualIntentResultRef.current !== presentationPendingResultBefore
            ? 'pending-result'
            : null,
          pendingTransferRef.current !== presentationTransferBefore
            ? 'transfer'
            : null,
          !presentationActiveBefore ? 'lifecycle-before' : null,
          !presentationActiveAfter ? 'lifecycle-after' : null,
          presentationActiveBefore !== presentationActiveAfter
            ? 'lifecycle-changed'
            : null,
          ownedDomRef.current !== presentationOwnedBefore ? 'owned-dom' : null,
          fullOwnerRef.current !== presentationOwnerBefore ? 'owner' : null
        ].filter((reason): reason is string => null !== reason);
        if (presentationWitnessFailures.length > 0) {
          onDiagnostic(
            `visual-editor-canonical-change-dom-stale:${presentationWitnessFailures.join(',')}`
          );
          throw new Error('visual-editor-canonical-change-dom-stale');
        }
        assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
        if (
          presentationNodes.length !== commitLedger.nodes.length
          || presentationNodes.some((node, index) => node !== commitLedger.nodes[index])
        ) {
          throw new Error('visual-editor-canonical-change-dom-stale');
        }
        const finalCommitLedger = {
          metadata: presentationNodes.map(fullOwnedNodeMetadata),
          nodes: presentationNodes
        };
        acceptedHtmlRef.current = surface.innerHTML;
        acceptedNodesRef.current = finalCommitLedger.nodes;
        acceptedCodeBodySnapshotsRef.current.clear();
        acceptedLocalCodeBodiesRef.current = visualLocalCodeBodyRecords();
        publishOwnedDom(
          value,
          editedVisualMarkdown,
          documentSession.document.getRevision?.() ?? 0,
          finalCommitLedger
        );
        visualBaselineMaterializedRef.current = true;
        visualSelectionMemoryRef.current =
          canUseIdentityVisualSelection(
            surface,
            value,
            editedVisualMarkdown,
            { end: selection.end, start: selection.start },
            { end: selection.end, start: selection.start }
          ) && 'none' === selection.direction
            ? selectionMemoryForCurrentSelection(
                surface,
                { end: selection.end, start: selection.start },
                { end: selection.end, start: selection.start }
              )
            : null;
        if (value !== sourceMarkdown) {
          acceptedPasteDocumentBoundaryRef.current = null;
          const acceptedHtml = acceptedHtmlRef.current;
          if (null === acceptedHtml) {
            throw new Error('visual-editor-markdown-snapshot-missing');
          }
          recordCurrentVisualHistorySnapshot(value, acceptedHtml);
        }
        if (presentationFailed) throw presentationError;
        return true;
      } catch (error) {
        if (
          synchronizeStartedFromCurrentDocument &&
          null !== sourceBeforeSynchronize &&
          documentSession.document.getValue() !== sourceBeforeSynchronize
        ) {
          onFailure(
            visualEditorFailureCode(error, 'visual-editor-markdown-sync-failed')
          );
          return false;
        }
        return failVisualSynchronization(error);
      }
    },
    [
      applyDocumentChange,
      failVisualSynchronization,
      onDiagnostic,
      onFailure,
      onMarkdownChange,
      recordCurrentVisualHistorySnapshot,
      surface
    ]
  );

  /**
   * The one publication owner for pending transfers. It captures the native
   * presentation, publishes the synchronous `requesting` phase BEFORE the
   * pending notification and the Preview request, and derives the `rendering`
   * phase from the signature that request returned. The spec object is the
   * same-transfer identity: a legal presentation clone (invalidated caret,
   * suppressed focus restore) keeps it and receives the signature, while a
   * genuinely replaced or cancelled transfer is never overwritten.
   */
  const publishPendingTransfer = useCallback(
    (spec: FullPendingTransferSpec, notifyMarkdownChange?: () => void): void => {
      const markdown = spec.expectation.value;
      const selection = spec.expectation.selection;
      const visualSelection =
        'structural' === spec.presentation
          ? captureVisualHistorySelection(surface, () =>
              structuralCaptureFor(
                markdown,
                previewSnapshotRef.current.editMap,
                documentSession.document.getSelection?.().start ?? -1
              )
            )
          : captureVisualHistorySelection(surface);
      // The owner may advance its OWN recorded presentation boundary by its own
      // pure single-line insertion. The five bounds are all required: the record
      // belongs to the transfer being created here, it was produced by this
      // owner's own commit of this exact source (never an external change), the
      // insertion carries no line break, the boundary is collapsed (a ranged
      // selection is never moved), and the advance is exactly the inserted
      // length from a boundary the owner itself placed. Nothing is read back
      // from the DOM and nothing is searched for.
      const ownerInsertion = ownerInsertionRef.current;
      const presentationSelection =
        'structural' === spec.presentation
        && ownerInsertion
        && ownerInsertion.source === markdown
        && visualSelection
        && visualSelection.anchor.path.length === visualSelection.focus.path.length
        && visualSelection.anchor.offset === visualSelection.focus.offset
        && visualSelection.anchor.offset >= ownerInsertion.visualFrom
        && selection.start === selection.end
        && 'none' === selection.direction
        ? (() => {
            const advanced = visualSelection.anchor.offset
              + ownerInsertion.insert.length;
            return {
              anchor: { offset: advanced, path: visualSelection.anchor.path },
              backward: visualSelection.backward,
              focus: { offset: advanced, path: visualSelection.focus.path }
            };
          })()
        : visualSelection;
      // A canonical adoption leaves the current history slot describable only
      // by rematerializing it from the formal Preview; a history replay instead
      // proves the slot it already targets.
      const history = spec.expectation.history;
      if ('native' === spec.kind && history) {
        const slot = visualHistorySnapshotsRef.current.get(history.undoDepth);
        if (!slot || slot.markdown !== markdown) {
          visualHistorySnapshotsRef.current.set(history.undoDepth, {
            kind: 'rematerialize',
            markdown
          });
        }
      }
      const requesting: PendingMarkdownTransfer = {
        focusOwner: surface.ownerDocument.activeElement,
        phase: 'requesting',
        previousPreview: previewSnapshotRef.current,
        restoreFocus: true,
        signature: '',
        spec,
        visualSelection: presentationSelection
      };
      pendingTransferRef.current = requesting;
      onPendingChange(true);
      notifyMarkdownChange?.();
      const signature = requestPreview(markdown);
      const current = pendingTransferRef.current;
      if (
        current &&
        'requesting' === current.phase &&
        current.spec === requesting.spec
      ) {
        pendingTransferRef.current = {
          ...current,
          phase: 'rendering',
          previousPreview: previewSnapshotRef.current,
          signature
        };
      }
    },
    [onPendingChange, requestPreview, surface]
  );

  const requestMarkdownTransfer = useCallback(
    (value: string) => {
      if (
        !value ||
        pendingTransferRef.current ||
        visualTransferFailureReportedRef.current
      )
        return;
      const hadPendingVisualInput = visualInputPendingRef.current;
      if (!flushVisualInputRef.current()) return;
      if (hadPendingVisualInput && !synchronizeMarkdown()) return;
      const sourceMarkdown = sourceMarkdownRef.current;
      const baselineVisualMarkdown = visualMarkdownRef.current;
      if (null === sourceMarkdown || null === baselineVisualMarkdown) {
        throw new Error('visual-editor-markdown-snapshot-missing');
      }
      try {
        let currentSelection: VisualSelectionSourceRange;
        const acceptedDocumentBoundary =
          acceptedPasteDocumentBoundaryRef.current ?? undefined;
        try {
          currentSelection = visualSelectionSourceRange(
            surface,
            sourceMarkdown,
            baselineVisualMarkdown,
            baselineVisualMarkdown,
            {
              ...(acceptedDocumentBoundary
                ? { acceptedPasteDocumentBoundary: acceptedDocumentBoundary }
                : {})
            }
          );
          lastSelectionRef.current = currentSelection;
        } catch (error) {
          if (
            error instanceof Error &&
            'visual-editor-selection-unavailable' === error.message &&
            lastSelectionRef.current
          ) {
            currentSelection = lastSelectionRef.current;
          } else {
            throw error;
          }
        }
        const markdown =
          sourceMarkdown.slice(0, currentSelection.start) +
          value +
          sourceMarkdown.slice(currentSelection.end);
        const caret = currentSelection.start + value.length;
        const selection = {
          direction: 'none' as const,
          end: caret,
          start: caret
        };
        const pasteDocumentBoundary =
          0 === caret ? 'start' : caret === markdown.length ? 'end' : null;
        // The paste is a REAL splice at the mapped selection, so it is passed
        // as such: a whole-value write would let the document adapter choose an
        // equivalent but semantically different occurrence of the same bytes.
        const changes = {
          from: currentSelection.start,
          insert: value,
          to: currentSelection.end
        };
        const origin = ownedDomRef.current;
        const verifiedOrigin =
          origin
          && origin.owner === fullOwnerRef.current
          && origin.source === sourceMarkdown
          && sourceMarkdownRef.current === sourceMarkdown
          && fullOwnedDomMatches(surface, origin)
            ? origin
            : null;
        const witness = captureVisualHistorySelectionWitness(currentSelection);
        const change = verifiedOrigin
          ? fullChangeDescriptor(sourceMarkdown, markdown, changes)
          : null;
        // A pure insertion typed/pasted at a caret inside one retained root
        // belongs to that root, and only that root may extend its transported
        // extent. Anything else keeps no affinity at all.
        const insertionOwner = verifiedOrigin
          && changes.from === changes.to
            ? nativeInsertionOwner(
                verifiedOrigin,
                sourceMarkdown,
                currentSelection.start
              )
            : null;
        // The caret this transfer will restore is defined BEFORE the write, by
        // the same current-source witness helpers a demand uses. It is the
        // transfer's own record, independent of any target lease.
        const selectionOrigin = verifiedOrigin
          ? currentAcceptedSelectionOrigin()
          : null;
        applyDocumentChange(
          {
            changes,
            historySelectionBefore: currentSelection,
            recordHistorySelection: true,
            selection,
            value: markdown
          },
          {
            ...(witness ? { historySelectionWitness: witness } : {}),
            validatedCodeStructure: { markdown, matchesPreview: false }
          }
        );
        onMarkdownChange();
        const sourceRevision = documentSession.document.getRevision?.();
        const correspondence =
          verifiedOrigin && change && Number.isSafeInteger(sourceRevision)
            ? {
                change,
                history: documentHistoryState(documentSession.document),
                insertionOwner,
                origin: verifiedOrigin,
                owner: fullOwnerRef.current,
                source: markdown,
                sourceRevision: sourceRevision as number
              }
            : undefined;
        publishPendingTransfer({
          expectation: { selection, value: markdown },
          kind: 'paste',
          placement: pasteDocumentBoundary
            ? { boundary: pasteDocumentBoundary, kind: 'paste-boundary' }
            : { kind: 'source' },
          presentation: 'structural',
          ...(correspondence ? { correspondence } : {}),
          ...(selectionOrigin ? { selectionOrigin } : {})
        });
      } catch (error) {
        const code =
          error instanceof Error
            ? error.message
            : 'visual-editor-markdown-paste-failed';
        if (pendingTransferRef.current) {
          failPendingTransfer(code);
        } else {
          onFailure(code);
        }
      }
    },
    [
      applyDocumentChange,
      captureVisualHistorySelectionWitness,
      documentSession,
      failPendingTransfer,
      onFailure,
      onMarkdownChange,
      publishPendingTransfer,
      surface,
      synchronizeMarkdown
    ]
  );

  useLayoutEffect(() => {
    if (!pending && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      focusVisualSurface(surface);
    }
  }, [pending, surface]);

  useLayoutEffect(() => {
    let active = true;
    const unsubscribe = documentSession.document.subscribe(() => {
      if (
        !active ||
        selfWriteRef.current ||
        externalChangeReportedRef.current ||
        documentSession.document.getValue() === sourceMarkdownRef.current
      ) {
        return;
      }
      externalChangeReportedRef.current = true;
      onCanonicalDocumentChange();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [documentSession, onCanonicalDocumentChange]);

  useLayoutEffect(() => {
    const pending = pendingTransferRef.current;
    if ('error' === previewStatus && pending) {
      failPendingTransfer(
        'history' === pending.spec.kind
          ? 'visual-editor-history-preview-failed'
          : 'accepted-preview' === pending.spec.placement.kind
            ? 'visual-editor-native-preview-failed'
            : 'visual-editor-markdown-paste-render-failed'
      );
    }
  }, [failPendingTransfer, previewStatus]);

  useLayoutEffect(() => {
    if ('ready' !== previewStatus) return;
    const pending = pendingTransferRef.current;
    if (!pending) {
      const sourceMarkdown = documentSession.document.getValue();
      if (
        sourceMarkdown === sourceMarkdownRef.current &&
        capturedPreviewRevisionRef.current === previewSnapshot.revision
      ) {
        return;
      }
      captureSnapshot(sourceMarkdown, { acceptedPreviewSource: true });
      return;
    }
    // React can publish pending state before the Preview owner publishes its
    // loading state. The exact prior accepted snapshot is not a stale response
    // to this request; keep waiting for a new accepted generation. Any different
    // accepted identity must still match the requested signature below.
    if (
      pending.previousPreview.revision === previewSnapshot.revision &&
      pending.previousPreview.signature === previewSnapshot.signature
    ) return;
    const spec = pending.spec;
    const expectation = spec.expectation;
    const placement = spec.placement;
    const historyTransfer = 'history' === spec.kind;
    const acceptedPreview = 'accepted-preview' === placement.kind;
    const acceptedDocumentBoundary =
      'paste-boundary' === placement.kind ? placement.boundary : null;
    if (pending.signature !== previewSnapshot.signature) {
      failPendingTransfer(
        historyTransfer
          ? 'visual-editor-history-preview-stale'
          : acceptedPreview
            ? 'visual-editor-native-preview-stale'
            : 'visual-editor-markdown-paste-superseded'
      );
      return;
    }
    let selectionDiagnostic: string | null = null;
    let recoveredSourceSelection: VisualSelectionSourceRange | null = null;
    let recoveredTablePresentation: FullAcceptedTablePresentation | undefined;
    let restoredEmptyParagraph = false;
    const activeElement = surface.ownerDocument.activeElement;
    const shouldRestoreFocus = !pendingCanonicalCompositionRef.current && pending.restoreFocus !== false &&
      (activeElement === surface || activeElement === surface.ownerDocument.body ||
        pending.focusOwner === undefined || activeElement === pending.focusOwner);
    try {
      if (documentSession.document.getValue() !== expectation.value) {
        throw new Error(
          historyTransfer
            ? 'visual-editor-history-preview-stale'
            : acceptedPreview
              ? 'visual-editor-native-preview-document-stale'
              : 'visual-editor-markdown-paste-document-stale'
        );
      }
      if (historyTransfer) {
        const observation = readCanonicalObservation(documentSession.document, {
          history: true,
          revision: false,
          selection: true,
          value: false
        });
        if (
          null !== canonicalExpectationMismatch(expectation, observation, {
            history: true,
            revision: false,
            selection: true,
            value: false
          })
        ) {
          throw new Error('visual-editor-history-preview-stale');
        }
        const slotProof = spec.historyProof?.slot;
        if (slotProof) {
          const slot = visualHistorySnapshotsRef.current.get(slotProof.depth);
          if (
            !slot ||
            slot !== slotProof.value ||
            slot.kind !== 'rematerialize' ||
            slot.markdown !== expectation.value ||
            slotProof.depth !== observation.history?.undoDepth
          ) {
            throw new Error('visual-editor-history-preview-stale');
          }
        }
        const gapProof = spec.historyProof?.emptyParagraph;
        const gapContinuity = gapProof?.continuity;
        const gapSlotValid = gapProof
          ? gapContinuity
            ? gapContinuity.depth === gapProof.depth
              && gapContinuity.historyUndoDepth === observation.history?.undoDepth
              && gapContinuity.markdown === expectation.value
            : Boolean(
                gapProof.slot
                && gapProof.slot === visualHistorySnapshotsRef.current.get(gapProof.depth)
                && gapProof.slot.kind === 'snapshot'
                && gapProof.slot.markdown === expectation.value
              )
          : true;
        if (gapProof && (gapProof.owner !== fullOwnerRef.current
          || !gapSlotValid
          || gapProof.depth !== observation.history?.undoDepth
          || gapProof.sourceOffset !== expectation.selection.start
          || expectation.selection.start !== expectation.selection.end)) {
          throw new Error('visual-editor-history-preview-stale');
        }
      } else if (undefined !== expectation.revision) {
        const observation = readCanonicalObservation(documentSession.document, {
          history: true,
          revision: true,
          selection: true,
          value: false
        });
        if (
          null !== canonicalExpectationMismatch(expectation, observation, {
            history: true,
            revision: true,
            selection: true,
            value: false
          })
        ) {
          throw new Error('visual-editor-canonical-change-stale');
        }
      }
      if (shouldRestoreFocus) {
      try {
        if (acceptedDocumentBoundary) {
          placeVisualCaretAtAcceptedPasteDocumentBoundary(
            surface,
            acceptedDocumentBoundary
          );
        } else if (acceptedPreview) {
          const editMap = previewSnapshotRef.current.editMap;
          if (!editMap) {
            // An accepted empty source has no Preview block to map: the paper
            // placeholder owns the surface with a null edit map. The
            // representable accepted selection for that source is the empty
            // paragraph's own terminal caret, which is exactly what the empty
            // paragraph reset places. Non-empty accepted sources still require
            // the accepted map, so a missing one remains a real failure.
            if (!isVisualMarkdownEmpty(expectation.value)) {
              throw new Error('visual-editor-selection-map-missing');
            }
            // The accepted empty render publishes empty HTML, so the surface
            // holds no block to map. The empty-source presentation owns the
            // paragraph and its terminal caret; `captureSnapshot` below keeps
            // that same shape.
            resetEmptyVisualParagraph(surface);
          } else if (spec.historyProof?.emptyParagraph) {
            const proof = spec.historyProof.emptyParagraph;
            const starts = markdownLineStarts(expectation.value);
            const nextIndex = editMap.blocks.findIndex(block => (starts[block.startLine] ?? -1) > proof.sourceOffset);
            const previousIndex = (nextIndex < 0 ? editMap.blocks.length : nextIndex) - 1;
            const previous = editMap.blocks[previousIndex];
            const previousStart = previous ? starts[previous.startLine] : undefined;
            const previousEnd = previous ? starts[previous.endLine] ?? expectation.value.length : undefined;
            const nextBlock = editMap.blocks[nextIndex];
            const nextStart = nextIndex < 0 ? expectation.value.length : nextBlock ? starts[nextBlock.startLine] : undefined;
            if (previousStart === undefined || previousEnd === undefined || nextStart === undefined) {
              throw new Error('visual-editor-selection-map-failed');
            }
            const contentEnd = previousStart + expectation.value.slice(previousStart, previousEnd).trimEnd().length;
            if (proof.sourceOffset < contentEnd || proof.sourceOffset + 2 > nextStart
              || !/^[\t\r\n ]*$/u.test(expectation.value.slice(contentEnd, nextStart))) {
              throw new Error('visual-editor-selection-map-failed');
            }
            const children = acceptedTopLevelVisualChildren(surface, editMap);
            // First certify the real renderer's exact rows. The extra physical
            // paragraph belongs to this history operation, never its edit map.
            captureSnapshot(expectation.value, { acceptedPreviewSource: true });
            const paragraph = surface.ownerDocument.createElement('p'); paragraph.append(surface.ownerDocument.createElement('br'));
            const next = nextIndex < 0 ? null : children[nextIndex];
            if (next) next.before(paragraph); else surface.append(paragraph);
            const visual = serializeVisualMarkdown(surface);
            const nodes = Array.from(surface.childNodes);
            if (!publishOwnedDom(expectation.value, visual, documentSession.document.getRevision?.() ?? 0,
              { nodes, metadata: nodes.map(fullOwnedNodeMetadata) })) throw new Error('visual-editor-canonical-change-dom-stale');
            visualMarkdownRef.current = visual;
            visualSourceIntervalMapRef.current = {
              sourceMarkdown: expectation.value, visualMarkdown: visual,
              map: createVisualMarkdownSourceIntervalMap(expectation.value, visual)
            };
            lastSelectionRef.current = expectation.selection;
            surface.focus({ preventScroll: true });
            surface.ownerDocument.defaultView?.getSelection()?.collapse(paragraph, 0);
            restoredEmptyParagraph = true;
            ownedEmptyParagraphRef.current = { body: paragraph, owner: fullOwnerRef.current, source: expectation.value,
              revision: documentSession.document.getRevision?.() ?? 0, sourceLength: 2, sourceOffset: proof.sourceOffset };
            recoveredSourceSelection = expectation.selection;
          } else {
            placeVisualSelectionFromAcceptedSourceRange(
              surface,
              expectation.value,
              editMap,
              expectation.selection,
              pending.visualSelection,
              spec.replacement
            );
          }
        } else if (
          expectation.selection.start !== expectation.selection.end ||
          expectation.selection.direction !== 'none'
        ) {
          const visualMarkdown = serializeVisualMarkdown(surface);
          placeVisualSelectionFromSourceRange(
            surface,
            expectation.value,
            visualMarkdown,
            expectation.selection
          );
        } else {
          const visualMarkdown = serializeVisualMarkdown(surface);
          placeVisualCaretFromSourceOffset(
            surface,
            expectation.value,
            visualMarkdown,
            expectation.selection.start
          );
        }
      } catch (error) {
        if (
          acceptedPreview
          && error instanceof Error
          && VISUAL_CANONICAL_ADOPTION_PENDING_CODE === error.message
        ) {
          // The canonical write already landed and this block still carries
          // the pre-write render. Keep the transfer pending until the accepted
          // Preview render owns the surface, and keep one bounded, explicit
          // terminal failure instead of reporting a stale command now.
          onDiagnostic('visual-editor-canonical-change-preview-adoption-wait');
          if (null === canonicalAdoptionDeadlineRef.current) {
            canonicalAdoptionDeadlineRef.current = setTimeout(() => {
              canonicalAdoptionDeadlineRef.current = null;
              if (pendingTransferRef.current === pending) {
                failPendingTransfer(VISUAL_CANONICAL_STALE_SERIALIZATION_CODE);
              }
            }, VISUAL_CANONICAL_ADOPTION_DEADLINE_MS);
          }
          return;
        }
        // An accepted-source caret the accepted map cannot place may still sit
        // on the opening delimiter/info line of this source's own editable
        // fenced block. Its representable position is that block's code-body
        // start, proved from the same interval and code-body projection the
        // native path uses. This is presentation only: the source bytes,
        // revision, history and Preview request stay exactly as accepted, and
        // only the presentation selection is corrected. Genuine stale,
        // render, protection and history failures never reach this branch.
        // Both codes mean "the accepted map could not place this caret". They
        // are kept together for the EXISTING projection/fallback recovery, which
        // has always accepted either one. The bounded presentation
        // normalization below is the narrower path: it may not treat a mapper
        // budget exhaustion as a proven absence of an exact point.
        const selectionMapFailed = Boolean(
          error instanceof Error
          && (
            'visual-editor-selection-map-failed' === error.message
            || 'visual-editor-selection-map-budget-exceeded' === error.message
          )
        );
        const exactSelectionMapFailed = Boolean(
          error instanceof Error
          && 'visual-editor-selection-map-failed' === error.message
        );
        if (
          exactSelectionMapFailed
          && acceptedPreview
          && !acceptedDocumentBoundary
          && !spec.replacement
          && 'none' === expectation.selection.direction
          && expectation.selection.start === expectation.selection.end
        ) {
          // The normal exact mapper failed. Only the bounded same-root policy
          // may recover: it needs the trusted origin, the freshly accepted
          // ledger, one row owning that extent, a genuine kind change and a
          // positively mapped boundary inside the SAME accepted root. Every
          // other failure keeps its own error.
          const normalizedMap = previewSnapshotRef.current.editMap;
          const normalized = normalizedMap
            ? acceptTablePresentation(pending, normalizedMap, 'normalize')
            : null;
          if (normalized) {
            // A bounded presentation normalization is a SUCCESSFUL placement,
            // not a diagnostic: it is the ordinary presentation of an accepted
            // changed-kind row. Only a real refusal or an existing recovery
            // reports a code here.
            recoveredSourceSelection = normalized.selection;
            recoveredTablePresentation = normalized.presentation;
          }
        }
        if (
          !recoveredSourceSelection
          && acceptedPreview
          && !acceptedDocumentBoundary
          && !spec.replacement
          && 'none' === expectation.selection.direction
          && expectation.selection.start === expectation.selection.end
          && selectionMapFailed
        ) {
          // A table-shaped accepted row has no Markdown-unit projection, so the
          // generic marker walk cannot place a caret in it. The row's own cells
          // still spell its first line: the accepted offset is placed at the
          // same character inside the cell, and the canonical selection keeps
          // the accepted offset it already had.
          const map = previewSnapshotRef.current.editMap;
          if (map) {
            const boundary = acceptedTableCaretBoundary(
              surface,
              expectation.value,
              map,
              expectation.selection.start
            );
            const selection = surface.ownerDocument.defaultView?.getSelection();
            if (boundary && selection) {
              surface.focus({ preventScroll: true });
              selection.removeAllRanges();
              selection.collapse(boundary.node, boundary.offset);
              recoveredSourceSelection = expectation.selection;
            }
          }
        }
        if (
          !recoveredSourceSelection
          && acceptedPreview
          && !acceptedDocumentBoundary
          && !spec.replacement
          && 'none' !== expectation.selection.direction
          && expectation.selection.start !== expectation.selection.end
          && selectionMapFailed
        ) {
          // A deliberate RANGE that exactly covers one accepted row is placed
          // as that whole row, the same way a thematic break already is. The
          // canonical selection is left exactly as accepted - no offset is
          // collapsed, widened or re-tokenised - so only the presentation of an
          // already-exact range changes.
          const map = previewSnapshotRef.current.editMap;
          if (map) {
            const rowSelection = acceptedWholeRowRangeSelection(
              surface,
              expectation.value,
              map,
              expectation.selection
            );
            if (rowSelection) {
              recoveredSourceSelection = expectation.selection;
            }
          }
        }
        if (
          !recoveredSourceSelection
          && acceptedPreview
          && !historyTransfer
          && !acceptedDocumentBoundary
          && !spec.replacement
          && 'none' === expectation.selection.direction
          && expectation.selection.start === expectation.selection.end
          && selectionMapFailed
        ) {
          const editMap = previewSnapshotRef.current.editMap;
          let projection: ReturnType<typeof acceptedCodeBodyStartProjection> = null;
          try {
            projection = editMap
              ? acceptedCodeBodyStartProjection(
                  surface,
                  expectation.value,
                  editMap,
                  pending.signature,
                  expectation.selection.start
                )
              : null;
          } catch {
            projection = null;
          }
          if (projection) {
            const owner = surface.ownerDocument.defaultView?.getSelection();
            if (owner) {
              surface.focus({ preventScroll: true });
              owner.removeAllRanges();
              owner.collapse(projection.node, projection.offset);
              recoveredSourceSelection = {
                direction: 'none',
                end: projection.sourceOffset,
                start: projection.sourceOffset
              };
              selectionDiagnostic = 'visual-editor-selection-restore-projection';
            }
          }
        }
        const canUseSelectionFallback = Boolean(
          acceptedPreview
          && ('caret' === spec.selectionFallback
            || 'reflow-caret' === spec.selectionFallback)
          && error instanceof Error
          && 'visual-editor-selection-map-failed' === error.message
        );
        if (canUseSelectionFallback && !recoveredSourceSelection) {
          const editMap = previewSnapshotRef.current.editMap;
          if (!editMap) throw error;
          let placed = false;
          if ('reflow-caret' === spec.selectionFallback) {
            placed = placeVisualCaretAtAcceptedCodeBlockStart(
              surface,
              expectation.value,
              editMap,
              expectation.selection.start
            );
          } else {
            try {
              placeVisualCaretFromSourceOffset(
                surface,
                expectation.value,
                serializeVisualMarkdown(surface),
                expectation.selection.start
              );
              placed = true;
            } catch {
              placed = false;
            }
          }
          if (!placed) throw error;
          selectionDiagnostic = 'visual-editor-selection-restore-fallback';
        } else if (!recoveredSourceSelection) {
          if (historyTransfer || acceptedPreview) throw error;
          selectionDiagnostic = visualEditorFailureCode(
            error,
            'visual-editor-selection-restore-failed'
          );
          placeSurfaceCaretAtEnd(surface);
        }
      }
      }
      if (recoveredSourceSelection) {
        // Presentation only: the accepted source bytes, revision, history
        // depth and Preview request stay exactly as accepted, so this records
        // the same value with the recovered presentation selection and
        // creates no history entry.
        applyDocumentChange({
          selection: recoveredSourceSelection,
          value: expectation.value
        });
      }
      if (!recoveredTablePresentation && spec.historyProof?.tablePresentation) {
        const map = previewSnapshotRef.current.editMap;
        recoveredTablePresentation = map
          ? acceptTablePresentation(pending, map, 'retain')?.presentation
          : undefined;
      }
      if (restoredEmptyParagraph) {
        recordCurrentVisualHistorySnapshot(expectation.value, surface.innerHTML);
      } else if (acceptedPreview) {
        captureSnapshot(expectation.value, {
          acceptedPreviewSource: true,
          ...(recoveredTablePresentation ? { tablePresentation: recoveredTablePresentation } : {})
        });
      } else {
        captureAcceptedPasteSnapshot(expectation.value);
      }
      // The accepted snapshot now describes the placed DOM, so the canonical
      // caret can be read back from it. A document-end placement inside a
      // trailing code block lands at the code element's content boundary,
      // while the recorded canonical offset is the block end past the closing
      // delimiter. Recording the offset the placement actually established
      // keeps the native caret and the canonical selection describing one
      // position, so a subsequent native edit commits instead of being judged
      // against an offset the DOM cannot represent.
      if (
        shouldRestoreFocus &&
        !recoveredSourceSelection
        && 'none' === expectation.selection.direction
        && expectation.selection.start === expectation.selection.end
        && !spec.replacement
      ) {
        const editMap = previewSnapshotRef.current.editMap;
        const placed = editMap
          ? codeBodyCaretSourceOffset(
              surface,
              expectation.value,
              editMap,
              expectation.selection.start
            )
          : null;
        if (null !== placed && placed !== expectation.selection.start) {
          recoveredSourceSelection = {
            direction: 'none',
            end: placed,
            start: placed
          };
          // This is a correctness alignment, not a recovery from a rejected
          // projection, so it reports nothing: the accepted caret and the
          // native caret now describe one position.
          // The accepted snapshot now holds the accepted value, so this is a
          // selection-only write: no source change, no history entry.
          applyDocumentChange({
            selection: recoveredSourceSelection,
            value: expectation.value
          });
        }
      }
      if (historyTransfer) {
        const adoptedSlot = visualHistorySnapshotsRef.current.get(
          expectation.history?.undoDepth ?? -1
        );
        if (
          adoptedSlot?.kind !== 'snapshot' ||
          adoptedSlot.markdown !== expectation.value ||
          adoptedSlot.snapshot.markdown !== expectation.value
        ) {
          throw new Error('visual-editor-history-preview-stale');
        }
      }
      if (null !== canonicalAdoptionDeadlineRef.current) {
        clearTimeout(canonicalAdoptionDeadlineRef.current);
        canonicalAdoptionDeadlineRef.current = null;
      }
      pendingTransferRef.current = null;
      acceptedPasteDocumentBoundaryRef.current = acceptedDocumentBoundary;
      lastSelectionRef.current =
        recoveredSourceSelection ?? expectation.selection;
      // The placement above is this owner's own publication of a native
      // selection. Recording it here is what lets a later pointer image demand
      // replace it: a selection the user made never passes through this point.
      // A surface whose selection cannot be captured records nothing, which
      // keeps the stricter gesture policy.
      if (!shouldRestoreFocus) {
        ownerPlacedSelectionRef.current = null;
      } else {
        try {
          ownerPlacedSelectionRef.current =
            captureVisualHistorySelection(surface);
        } catch {
          ownerPlacedSelectionRef.current = null;
        }
      }
      if (
        acceptedDocumentBoundary &&
        visualMarkdownRef.current &&
        canUseIdentityVisualSelection(
          surface,
          expectation.value,
          visualMarkdownRef.current,
          {
            end: expectation.selection.end,
            start: expectation.selection.start
          },
          {
            end:
              'start' === acceptedDocumentBoundary
                ? 0
                : visualMarkdownRef.current.length,
            start:
              'start' === acceptedDocumentBoundary
                ? 0
                : visualMarkdownRef.current.length
          }
        )
      ) {
        const visualOffset =
          'start' === acceptedDocumentBoundary
            ? 0
            : visualMarkdownRef.current.length;
        visualSelectionMemoryRef.current = selectionMemoryForCurrentSelection(
          surface,
          { end: expectation.selection.end, start: expectation.selection.start },
          { end: visualOffset, start: visualOffset }
        );
      }
      restoreFocusRef.current = shouldRestoreFocus;
      onPendingChange(false);
    } catch (error) {
      failPendingTransfer(
        visualEditorFailureCode(
          error,
          historyTransfer
            ? 'visual-editor-history-preview-failed'
            : acceptedPreview
              ? 'visual-editor-native-preview-commit-failed'
              : 'visual-editor-markdown-paste-commit-failed'
        )
      );
      return;
    }
    if (selectionDiagnostic) {
      onDiagnostic(selectionDiagnostic);
    }
  }, [
    applyDocumentChange,
    captureAcceptedPasteSnapshot,
    captureSnapshot,
    documentSession,
    failPendingTransfer,
    onDiagnostic,
    onPendingChange,
    previewAdoptionTick,
    previewSnapshot,
    previewStatus,
    surface
  ]);

  useLayoutEffect(() => {
    const MutationObserverConstructor =
      surface.ownerDocument.defaultView?.MutationObserver;
    if (!MutationObserverConstructor) {
      throw new Error('visual-editor-code-block-observer-unavailable');
    }
    let active = true;
    activeRef.current = true;
    const codeBlockOrderObserver = new MutationObserverConstructor((mutations) => {
      consumeVisualDomMutations(mutations);
    });
    codeBlockOrderObserver.observe(surface, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });
    visualHistoryDomPairObserverRef.current = codeBlockOrderObserver;
    visualCodeBodyDomOrderObserverRef.current = codeBlockOrderObserver;
    documentSession.document.setVisualEditingActive(true);
    captureSnapshot(documentSession.document.getValue(), {
      acceptedPreviewSource: true
    });
    focusVisualSurface(surface);
    // Enabling visual editing after a lock expresses the user's intent to
    // continue at the canonical caret. A transfer that was requested by the
    // lock recorded restoreFocus:false because the lock button held focus;
    // re-arm that same lease (selection unchanged) so its accepted commit
    // places the caret. With no transfer, the accepted map already describes
    // the canonical source (the unlock checked it), so place it now.
    const resumeToken = resumeCanonicalSelectionToken ?? 0;
    const resumeOnEnable = resumeToken > resumeCanonicalTokenRef.current;
    resumeCanonicalTokenRef.current = resumeToken;
    const pendingOnEnable = pendingTransferRef.current;
    const activeOnEnable = surface.ownerDocument.activeElement;
    const focusOwner = pendingOnEnable?.focusOwner;
    const focusIsOurs = activeOnEnable === surface
      || activeOnEnable === surface.ownerDocument.body
      || focusOwner === surface
      || focusOwner === undefined;
    if (resumeOnEnable && pendingOnEnable && pendingOnEnable.restoreFocus === false
      && focusIsOurs) {
      pendingTransferRef.current = { ...pendingOnEnable, restoreFocus: true };
    } else if (resumeOnEnable && !pendingOnEnable) {
      const canonicalSelection = documentSession.document.getSelection?.();
      const editMapOnEnable = previewSnapshotRef.current.editMap;
      const nativeOnEnable = surface.ownerDocument.defaultView?.getSelection();
      // A real caret is preserved only when BOTH endpoints belong to this
      // surface's own accepted editable block, with no protected node or
      // window spacer in their ancestry. Anything else (root, body, foreign
      // block, detached node) is not a legal native position here.
      const nativeCaretInBlock = Boolean(nativeOnEnable
        && [nativeOnEnable.anchorNode, nativeOnEnable.focusNode].every((node) => {
          if (!node || !surface.contains(node)) return false;
          const element = node instanceof Element ? node : node.parentElement;
          const block = element?.closest('[data-easymde-visual-block-id]');
          return Boolean(
            block
            && block.parentElement === surface
            && !block.closest(
              `[data-easymde-preview-window-spacer], ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}, [contenteditable="false"]`
            )
          );
        }));
      // Legality is read from the native selection, never from source
      // spelling: a real owner caret inside an editable block is never
      // replaced. Only a mount that left the caret at the surface root or
      // body restores the canonical selection through the accepted map.
      if (!nativeCaretInBlock && canonicalSelection && editMapOnEnable) {
        try {
          placeVisualSelectionFromAcceptedSourceRange(
            surface,
            documentSession.document.getValue(),
            editMapOnEnable,
            canonicalSelection,
            null
          );
        } catch (error) {
          // A canonical caret that the accepted map cannot express is a real
          // owner failure, not something activation may hide. The mapper must
          // learn the point (same owner) instead of a fake success.
          failVisualSynchronization(error);
        }
      }
    }
    const imageInteraction = createVisualImageInteraction(surface, {
      canActivate: () =>
        active
        && !composing
        && !pendingTransferRef.current
        && !externalChangeReportedRef.current
        && !visualTransferFailureReportedRef.current,
      focus: () => focusVisualSurface(surface),
      report: failVisualSynchronization,
      ownsSelection: () => {
        const ownerPlaced = ownerPlacedSelectionRef.current;
        if (!ownerPlaced) return false;
        try {
          const current = captureVisualHistorySelection(surface);
          return Boolean(
            current && visualHistorySelectionEqual(ownerPlaced, current)
          );
        } catch {
          // An uncapturable selection is never proven to be the owner's own,
          // so the stricter deliberate-selection policy stays in force.
          return false;
        }
      },
      synchronizeSelection: () => runtime.prepareMediaSelection()
    });
    let composing = false;
    let compositionRejected = false;
    let rejectedCompositionSelection: VisualHistorySelection | null = null;
    let compositionCommitScheduled = false;
    let compositionCodeBodyCommit = false;
    let compositionCodeBodyLocalPre: HTMLElement | null = null;
    let visualInputBlock: VisualCodeInputSnapshot | null = null;
    let visualInputCodeOrdinal: number | null = null;
    let compositionCodeBodyContext: VisualCompositionCodeBodyContext | null =
      null;
    let ordinaryCompositionOrigin: Readonly<{
      localCertificate: LocalCompositionVisualCertificate | null;
      revision: number | undefined;
      serializedVisual: string;
      source: string;
      sourceRange: Readonly<{ end: number; start: number }>;
      visual: string;
      visualRange: Readonly<{ end: number; start: number }>;
      textNode: Text;
      textOffset: number;
      textBefore: string;
    }> | null = null;
    let pendingComposition: Readonly<{
      lease: PendingMarkdownTransfer;
      block: HTMLElement;
      template: HTMLElement;
      nodes: ReadonlyArray<Node>;
      selection: VisualHistorySelection | null;
    }> | null = null;
    let cancelledPendingComposition = false;
    let completedPendingComposition: Readonly<{ data: string; markdown: string }> | null = null;
    const assertPendingCanonicalLease = (lease: PendingMarkdownTransfer): void => {
      const expectation = lease.spec.expectation;
      const observation = readCanonicalObservation(documentSession.document, {
        history: true,
        revision: expectation.revision !== undefined,
        selection: true,
        value: true
      });
      if (
        !active ||
        externalChangeReportedRef.current ||
        visualTransferFailureReportedRef.current ||
        !expectation.history ||
        sourceMarkdownRef.current !== expectation.value ||
        null !== canonicalExpectationMismatch(expectation, observation, {
          history: true,
          revision: expectation.revision !== undefined,
          selection: true,
          value: true
        })
      ) {
        throw new Error('visual-editor-pending-selection-stale');
      }
    };
    const assertPendingInputDom = (): VisualMarkdownReadOnlySnapshot => {
      const snapshot = readOnlySnapshotRef.current;
      const map = previewSnapshotRef.current.editMap;
      if (!snapshot) throw new Error('visual-editor-pending-input-unavailable');
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot);
      if (map) assertAcceptedTopLevelVisualSurface(surface, map, acceptedHtmlRef.current, acceptedNodesRef.current);
      else if (acceptedHtmlRef.current === null || surface.innerHTML !== acceptedHtmlRef.current) {
        throw new Error('visual-editor-canonical-change-dom-stale');
      }
      return snapshot;
    };
    const pendingInputLease = (event?: InputEvent): PendingMarkdownTransfer => {
      const lease = pendingTransferRef.current;
      const current = captureVisualHistorySelection(
        surface,
        () =>
          structuralCaptureFor(
            lease?.spec.expectation.value ?? null,
            previewSnapshotRef.current.editMap,
            lease?.spec.expectation.selection.start ?? -1
          )
      );
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (lease?.phase !== 'rendering' || !lease.visualSelection || !current ||
          surface.ownerDocument.activeElement !== surface ||
          !visualHistorySelectionEqual(current, lease.visualSelection) || !selection?.rangeCount) {
        throw new Error('visual-editor-pending-selection-stale');
      }
      assertPendingCanonicalLease(lease);
      const readOnly = assertPendingInputDom();
      const range = selection.getRangeAt(0);
      if (readOnly.some(({ node }) => node.contains(selection.anchorNode) || node.contains(selection.focusNode) ||
          (!range.collapsed && range.intersectsNode(node)))) {
        throw new Error('visual-editor-read-only-region-mutated');
      }
      const targets = event?.getTargetRanges?.() ?? [];
      const target = targets[0];
      if (target && readOnly.some(({ node }) => node.contains(target.startContainer) || node.contains(target.endContainer))) {
        throw new Error('visual-editor-read-only-region-mutated');
      }
      let matches = !target || (target.startContainer === range.startContainer && target.startOffset === range.startOffset &&
        target.endContainer === range.endContainer && target.endOffset === range.endOffset);
      if (!matches && target && range.collapsed && target.startContainer === target.endContainer &&
          target.startOffset === target.endOffset && event?.inputType !== 'insertReplacementText') {
        const block = captureVisualCodeInputSnapshot(selectedVisualCodeBlock(surface));
        if (block) {
          const nativeOffset = visualCodeBodyDomOffset(block.code, { node: range.startContainer, offset: range.startOffset });
          const targetOffset = visualCodeBodyDomOffset(block.code, { node: target.startContainer, offset: target.startOffset });
          matches = nativeOffset !== null && nativeOffset === targetOffset;
        }
      }
      if (targets.length > 1 || !matches || (event?.inputType === 'insertReplacementText' &&
          (!target || !range.collapsed || lease.spec.expectation.selection.start !== lease.spec.expectation.selection.end))) {
        throw new Error('visual-editor-pending-input-unavailable');
      }
      return lease;
    };
    /**
     * The operation-bound correspondence that survives one more KNOWN canonical
     * write while the same origin DOM is still mounted.
     *
     * Only the actual operation descriptor is used: the prior descriptor is
     * composed with this write's own `ChangeDesc`, so origin positions map
     * directly onto the new source. Nothing is inferred from strings, there is
     * no list of writes, and any loss of the exact origin/pending/source/
     * revision/history/owner binding invalidates the record instead of falling
     * back to a diff.
     */
    const composedPendingCorrespondence = (
      lease: PendingMarkdownTransfer,
      changes: Readonly<{ from: number; insert: string; to: number }>,
      nextValue: string
    ): FullPendingDomCorrespondence | null => {
      const prior = lease.spec.correspondence;
      if (!prior || prior.owner !== fullOwnerRef.current) return null;
      if (prior.source !== lease.spec.expectation.value) return null;
      if (documentSession.document.getValue() !== lease.spec.expectation.value) return null;
      if (sourceMarkdownRef.current !== lease.spec.expectation.value) return null;
      const priorHistory = prior.history;
      const history = documentHistoryState(documentSession.document);
      if (
        history.undoDepth !== priorHistory.undoDepth
        || history.redoDepth !== priorHistory.redoDepth
      ) return null;
      if (documentSession.document.getRevision?.() !== prior.sourceRevision)
        return null;
      const origin = prior.origin;
      if (origin.owner !== fullOwnerRef.current) return null;
      if (!fullOwnedDomMatches(surface, origin)) return null;
      const readOnlySnapshot = readOnlySnapshotRef.current;
      if (!readOnlySnapshot) return null;
      try {
        assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
        if (serializeVisualMarkdown(surface) !== origin.visual) return null;
      } catch {
        return null;
      }
      const next = fullChangeDescriptor(
        lease.spec.expectation.value,
        nextValue,
        changes
      );
      if (!next) return null;
      let composed: ChangeDesc;
      try {
        composed = prior.change.composeDesc(next);
      } catch {
        return null;
      }
      if (
        composed.length !== origin.source.length
        || composed.newLength !== nextValue.length
      ) return null;
      // A pure insertion belongs to one real native root while that root is
      // still mounted. Two different owners cannot share one affinity, and a
      // replaced/deleted original content is never an unaffected survivor.
      const insertionOwner = (() => {
        if (changes.from !== changes.to) return null;
        const native = surface.ownerDocument.defaultView?.getSelection();
        const anchor = native?.anchorNode ?? null;
        if (!anchor || !surface.contains(anchor)) return null;
        const root = directVisualBlockForSelectionNode(surface, anchor);
        if (!root || !origin.nodes.includes(root)) return null;
        if (prior.insertionOwner && prior.insertionOwner !== root) return null;
        return root;
      })();
      const nextRevision = documentSession.document.getRevision?.();
      if (!Number.isSafeInteger(nextRevision)) return null;
      return {
        change: composed,
        history: documentHistoryState(documentSession.document),
        insertionOwner,
        origin,
        owner: fullOwnerRef.current,
        source: nextValue,
        sourceRevision: nextRevision as number
      };
    };

    /**
     * One canonical paragraph transaction for a caret the structural owner
     * placed in a certified parent gap. The gap, the recorded canonical caret
     * and the accepted rows must still describe the same position; otherwise
     * the caller falls back to its ordinary text owner.
     */
    const applyStructuralCanonicalText = (
      source: string,
      canonical: VisualSelectionSourceRange,
      gap: NonNullable<ReturnType<typeof visualStructuralBoundaryCapture>>,
      text: string
    ): boolean => {
      if (
        'none' !== canonical.direction
        || canonical.start !== canonical.end
        || gap.selection.start !== canonical.start
        || gap.selection.end !== canonical.end
      ) {
        return false;
      }
      const insertion = visualStructuralParagraphInsertion(
        source,
        gap.token,
        gap.edge,
        canonical.start,
        text
      );
      const selection = {
        direction: 'none' as const,
        end: insertion.selection.end,
        start: insertion.selection.start
      };
      // The correspondence may only be extended while the same origin DOM and
      // the same pending transfer still own this document.
      const lease = pendingTransferRef.current;
      const correspondence = lease
        ? composedPendingCorrespondence(lease, insertion.changes, insertion.value)
        : null;
      applyDocumentChange(
        {
          changes: insertion.changes,
          recordHistorySelection: true,
          selection,
          value: insertion.value
        },
        { isolateHistoryBefore: true }
      );
      sourceMarkdownRef.current = insertion.value;
      onMarkdownChange();
      // The gap owns no DOM change of its own: the typed text opened a new
      // paragraph through the structural writer, so this is a change of the
      // top-level window this owner cannot prove. It publishes nothing and the
      // next demand re-authenticates formally.
      ownedDomRef.current = null;
      const history = documentHistoryState(documentSession.document);
      const revision = documentSession.document.getRevision?.();
      publishPendingTransfer({
        expectation: {
          history,
          ...(undefined !== revision ? { revision } : {}),
          selection,
          value: insertion.value
        },
        kind: 'native',
        placement: { kind: 'accepted-preview' },
        presentation: 'structural',
        ...(correspondence
          ? {
              correspondence: {
                ...correspondence,
                history,
                sourceRevision: revision ?? correspondence.sourceRevision
              }
            }
          : {})
      });
      if (
        surface.ownerDocument.activeElement !== surface
        && pendingTransferRef.current
      ) {
        pendingTransferRef.current = {
          ...pendingTransferRef.current,
          restoreFocus: false
        };
      }
      return true;
    };
    /**
     * A pending transfer whose recorded caret is a certified token edge keeps
     * that exact point. Its accepted rows still describe the older render, so
     * the certificate comes from the recorded canonical caret and the live
     * gap's own direct child, and the text opens its own paragraph instead of
     * being prefixed into the break.
     */
    const applyStructuralPendingCanonicalText = (
      lease: PendingMarkdownTransfer,
      text: string
    ): boolean => {
      const gap = visualStructuralBoundaryCapture(
        surface,
        lease.spec.expectation.value,
        visualStructuralBoundarySurfaceBlocks(
          surface,
          lease.spec.expectation.value,
          previewSnapshotRef.current.editMap
        ),
        lease.spec.expectation.selection.start
      );
      if (!gap) return false;
      // The recorded canonical caret is the authority while the matching
      // Preview is outstanding: it is still the break's edge, or the point
      // inside the paragraph this owner opened beside it. Any other caret is
      // not that boundary and keeps the ordinary pending text owner.
      const token = visualStructuralBoundaryTokenNear(
        lease.spec.expectation.value,
        lease.spec.expectation.selection.start,
        gap.edge
      );
      if (!token) return false;
      return applyStructuralCanonicalText(
        lease.spec.expectation.value,
        lease.spec.expectation.selection,
        { ...gap, token },
        text
      );
    };
    const applyPendingCanonicalText = (lease: PendingMarkdownTransfer, text: string, nativeTyping = false): void => {
      assertPendingCanonicalLease(lease);
      const source = lease.spec.expectation.value;
      const { start, end } = lease.spec.expectation.selection;
      const replacement = text.replace(/\r\n|\r/g, '\n');
      let value = source.slice(0, start) + replacement + source.slice(end);
      if (value === source) return;
      let caret = start + replacement.length;
      let changes = { from: start, insert: replacement, to: end };
      const native = surface.ownerDocument.defaultView?.getSelection();
      const paragraph = native?.anchorNode instanceof Element
        ? native.anchorNode : native?.anchorNode?.parentElement;
      if (nativeTyping && paragraph && ['P', 'DIV'].includes(paragraph.tagName)
        && !paragraph.closest('pre, code, [contenteditable="false"]')) {
        const lineStart = start === 0 ? 0 : source.lastIndexOf('\n', start - 1) + 1;
        const nextLine = source.indexOf('\n', end);
        const lineEnd = nextLine < 0 ? source.length : nextLine;
        const prefix = source.slice(lineStart, start).replace(/\\([`~])/gu, '$1');
        const inserted = replacement.replace(/\\([`~])/gu, '$1');
        const line = prefix + inserted + source.slice(end, lineEnd).replace(/\\([`~])/gu, '$1');
        const literal = isMarkdownFenceOpeningLine(source.slice(lineStart, lineEnd))
          ? null
          : projectVisualLiteralParagraphLine(
              line,
              prefix.length + inserted.length
            );
        if (literal) {
          changes = { from: lineStart, insert: literal.markdown, to: lineEnd };
          value = source.slice(0, lineStart) + literal.markdown + source.slice(lineEnd);
          caret = lineStart + literal.offset;
        }
      }
      const selection = { direction: 'none' as const, start: caret, end: caret };
      // Same rule as the structural writer: extend the one operation
      // descriptor only while the exact origin/pending binding survives.
      const correspondence = composedPendingCorrespondence(
        lease,
        changes,
        value
      );
      applyDocumentChange({ changes, value,
        selection, recordHistorySelection: true }, { isolateHistoryBefore: true });
      sourceMarkdownRef.current = value;
      onMarkdownChange();
      const history = documentHistoryState(documentSession.document);
      const revision = documentSession.document.getRevision?.();
      publishPendingTransfer({
        expectation: {
          history,
          ...(undefined !== revision ? { revision } : {}),
          selection,
          value
        },
        kind: 'native',
        placement: { kind: 'accepted-preview' },
        presentation: 'structural',
        ...(correspondence
          ? {
              correspondence: {
                ...correspondence,
                history,
                sourceRevision: revision ?? correspondence.sourceRevision
              }
            }
          : {})
      });
      if (surface.ownerDocument.activeElement !== surface && pendingTransferRef.current) {
        pendingTransferRef.current = { ...pendingTransferRef.current, restoreFocus: false };
      }
    };
    const finishPendingCompositionDom = (restoreSelection: boolean): void => {
      const draft = pendingComposition;
      pendingComposition = null;
      pendingCanonicalCompositionRef.current = false;
      composing = false;
      if (!draft) return;
      const sameWindow = draft.nodes.length === surface.childNodes.length &&
        draft.nodes.every((node, index) => surface.childNodes[index] === node);
      if (sameWindow) {
        if (draft.block.parentElement !== surface ||
            draft.block.attributes.length !== draft.template.attributes.length ||
            Array.from(draft.template.attributes).some(({ name, value }) => draft.block.getAttribute(name) !== value)) {
          throw new Error('visual-editor-canonical-change-dom-stale');
        }
        const readOnly = readOnlySnapshotRef.current;
        if (!readOnly) throw new Error('visual-editor-read-only-snapshot-missing');
        assertVisualMarkdownReadOnlySnapshot(surface, readOnly);
        const adoption = prepareVisualProtectedNodeAdoption(
          Array.from(draft.block.childNodes), Array.from(draft.template.childNodes), true, 'protected-order');
        draft.block.replaceChildren(...adoption.nodes);
        if (restoreSelection && !restoreVisualHistorySelection(surface, draft.selection)) {
          throw new Error('visual-editor-selection-map-failed');
        }
      }
      assertPendingInputDom();
      if (!sameWindow && restoreSelection) {
        const map = previewSnapshotRef.current.editMap;
        if (!map) throw new Error('visual-editor-selection-map-missing');
        placeVisualSelectionFromAcceptedSourceRange(surface, draft.lease.spec.expectation.value, map, draft.lease.spec.expectation.selection, null);
      }
    };
    const invalidatePendingInputSelection = (): void => {
      if (pendingComposition) {
        cancelledPendingComposition = true;
        try { finishPendingCompositionDom(false); }
        catch (error) { failPendingTransfer(visualEditorFailureCode(error, 'visual-editor-pending-selection-stale')); }
      }
      const lease = pendingTransferRef.current;
      if (lease) pendingTransferRef.current = { ...lease, visualSelection: null, restoreFocus: false };
    };
    const handlePendingPointerDown = (): void => invalidatePendingInputSelection();

    const rejectComposition = (): void => {
      if (!compositionRejected) {
        rejectedCompositionSelection = captureVisualHistorySelection(surface);
      }
      compositionRejected = true;
    };

    const pendingCodeFenceExpansion = (
      pending: PendingVisualIntent,
      inputBlock: VisualCodeInputSnapshot
    ): ReturnType<typeof expandVisualCodeFenceForBody> => {
      const structure = pending.codeBlockStructure;
      if (!structure || structure.localPre) return null;
      if (
        !structure.blockId ||
        visualBlockIdForPre(inputBlock.pre, surface) !== structure.blockId ||
        sourceMarkdownRef.current !== structure.baseMarkdown
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      const ordinal = codeOrdinalForInputBlock(
        inputBlock,
        structure.baseMarkdown,
        true,
        true
      );
      if (ordinal !== structure.codeOrdinal) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      const expansion = expandVisualCodeFenceForBody(
        structure.baseMarkdown,
        ordinal,
        inputBlock.codeText
      );
      if (!expansion) return null;
      const sourceChange = pending.sourceChange;
      const expectedSource = replaceTextRange(
        pending.baseSourceMarkdown,
        { end: sourceChange.to, start: sourceChange.from },
        sourceChange.insert
      );
      if (expectedSource !== pending.result.sourceMarkdown) {
        throw new Error('visual-editor-local-change-mismatch');
      }
      if (expansion.unexpandedMarkdown !== pending.result.sourceMarkdown) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      const editMap = previewSnapshotRef.current.editMap;
      const previewSourceMarkdown = visualCodeBodyPreviewSourceRef.current;
      if (
        !editMap ||
        editMap.signature !== previewSnapshotRef.current.signature ||
        null === previewSourceMarkdown ||
        createVisualCodeBodyOrdinalsForPreviewBlocks(
          previewSourceMarkdown,
          editMap
        ).get(structure.blockId) !== ordinal
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      return expansion;
    };

    const commitPendingVisualIntent = (): boolean => {
      const pending = pendingVisualIntentResultRef.current;
      if (!pending) return false;
      pendingVisualIntentResultRef.current = null;
      pendingUnmappedVisualInputRef.current = false;
      continuingUnmappedVisualInputRef.current = false;
      if (
        !active ||
        pendingTransferRef.current ||
        externalChangeReportedRef.current ||
        visualTransferFailureReportedRef.current
      ) {
        return false;
      }
      try {
        const readOnlySnapshot = readOnlySnapshotRef.current;
        if (readOnlySnapshot) {
          assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
        }
      } catch (error) {
        return failVisualSynchronization(error);
      }
      const previousSource = sourceMarkdownRef.current;
      if (null === previousSource) {
        throw new Error('visual-editor-markdown-snapshot-missing');
      }
      const sourceChange = pending.sourceChange;
      const expectedSource = replaceTextRange(
        previousSource,
        { end: sourceChange.to, start: sourceChange.from },
        sourceChange.insert
      );
      if (
        pending.baseSourceMarkdown === previousSource &&
        !pending.deferSourceChange &&
        expectedSource !== pending.result.sourceMarkdown
      ) {
        throw new Error('visual-editor-local-change-mismatch');
      }
      let validatedCodeStructure: VisualCodeStructureValidation | undefined;
      let mappedCodeStructureValidated = false;
      let acceptedCodeInputPreIndex: number | null = null;
      let acceptedCodeInputPre: HTMLElement | null = null;
      let acceptedCodeInputOpenEof: boolean | null = null;
      let acceptedCodeInputSourceBlockStart: number | null = null;
      let committedResult = pending.result;
      let committedMemory = pending.memory;
      // A paragraph line that begins with a fence opening is literal text until
      // the explicit Enter command. The intent's mapped splice is a source
      // write entry of its own, so the same shared projection applies here as
      // in the pending text owner: only when the caret's own paragraph line
      // would otherwise open a fence and absorb the following blocks.
      let appliedChange = sourceChange;
      // The group path owns a coalesced burst: the last-key sourceChange does
      // not describe it. Only a single-key change whose base still equals the
      // live source may project through this branch; otherwise the group branch
      // below reads the pristine result exactly once.
      // The first projection is admissible only when its splice reproduces the
      // authoritative pending result exactly; a coalesced burst whose last-key
      // splice disagrees is owned by the group branch below, read once.
      const appliesSingleKeyChange = pending.baseSourceMarkdown === previousSource
        && !pending.deferSourceChange
        && expectedSource === committedResult.sourceMarkdown;
      if (
        appliesSingleKeyChange
        && !pending.codeBlockStructure
        // Only native text insertion is the typed-literal case handled here.
        // A rapid burst coalesces several characters into one intent, so the
        // insert length is not a discriminator; the originating inputType is.
        // Paste and command transactions keep their own owners and raw code.
        && ('insertText' === pending.inputType
          || 'insertReplacementText' === pending.inputType)
        && !/[\r\n]/u.test(sourceChange.insert)
      ) {
        const nativeNode = surface.ownerDocument.defaultView?.getSelection()?.anchorNode;
        const nativeElement = nativeNode instanceof Element ? nativeNode : nativeNode?.parentElement;
        const nativeParagraph = nativeElement?.closest('p');
        if (
          nativeParagraph
          && nativeParagraph.parentElement === surface
          && !nativeParagraph.closest('pre, code, [contenteditable="false"]')
        ) {
          const lineStart = 0 === sourceChange.from
            ? 0
            : previousSource.lastIndexOf('\n', sourceChange.from - 1) + 1;
          const nextBreak = previousSource.indexOf('\n', sourceChange.to);
          const lineEnd = nextBreak < 0 ? previousSource.length : nextBreak;
          const lineBefore = previousSource.slice(lineStart, lineEnd);
          const line = previousSource.slice(lineStart, sourceChange.from)
            + sourceChange.insert
            + previousSource.slice(sourceChange.to, lineEnd);
          // Only the edit that creates the opening projects it. A line that was
          // already an opening before this change belongs to a verbatim paste or
          // an earlier operation and stays byte-identical.
          const literal = isMarkdownFenceOpeningLine(lineBefore)
            ? null
            : projectVisualLiteralParagraphLine(
                line,
                sourceChange.from - lineStart + sourceChange.insert.length
              );
          if (literal) {
            const caret = lineStart + literal.offset;
            appliedChange = { from: lineStart, insert: literal.markdown, to: lineEnd };
            committedResult = {
              ...pending.result,
              sourceMarkdown:
                previousSource.slice(0, lineStart)
                + literal.markdown
                + previousSource.slice(lineEnd),
              selection: { direction: 'none', start: caret, end: caret }
            };
            if (committedMemory) {
              committedMemory = { ...committedMemory, sourceAnchor: caret, sourceFocus: caret };
            }
          }
        }
      }
      let expandedPreviewSource: string | null = null;
      if (pending.codeBlockStructure) {
        if (pending.codeBlockStructure.localPre) {
          const localBlock = captureVisualCodeInputSnapshot(
            pending.codeBlockStructure.localPre
          );
          const provenance = visualLocalCodeBodyProvenanceRef.current.get(
            pending.codeBlockStructure.localPre
          );
          if (!localBlock || !provenance) {
            return failVisualSynchronization(
              new Error('visual-editor-code-body-map-stale')
            );
          }
          try {
            validateLocalVisualCodeBody(
              localBlock,
              pending.result.sourceMarkdown,
              provenance
            );
            acceptedCodeInputPreIndex = acceptedVisualCodePreIndex(
              localBlock.pre
            );
            acceptedCodeInputPre = localBlock.pre;
            acceptedCodeInputOpenEof =
              pending.codeBodyTopology?.openEof ??
              null !== localBlock.fenceOpenEof;
            acceptedCodeInputSourceBlockStart =
              pending.codeBodyTopology?.sourceBlockStart ?? 0;
          } catch (error) {
            return failVisualSynchronization(error);
          }
          validatedCodeStructure = {
            markdown: pending.result.sourceMarkdown,
            matchesPreview: false
          };
        } else {
          const baseMarkdown = pending.codeBlockStructure.baseMarkdown;
          const mappedPre = Array.from(
            surface.querySelectorAll<HTMLElement>('pre')
          ).find(
            (pre) =>
              visualBlockIdForPre(pre, surface) ===
              pending.codeBlockStructure?.blockId
          );
          const mappedBlock = captureVisualCodeInputSnapshot(mappedPre ?? null);
          if (!mappedBlock) {
            return failVisualSynchronization(
              new Error('visual-editor-code-body-map-stale')
            );
          }
          let fenceExpansion: ReturnType<typeof expandVisualCodeFenceForBody>;
          try {
            fenceExpansion = pendingCodeFenceExpansion(pending, mappedBlock);
          } catch (error) {
            return failVisualSynchronization(error);
          }
          if (fenceExpansion) {
            const baselineVisual = visualMarkdownRef.current;
            if (null === baselineVisual) {
              throw new Error('visual-editor-markdown-snapshot-missing');
            }
            let editedVisual: string;
            let visualExpansion: ReturnType<
              typeof expandVisualCodeFenceForBody
            >;
            let baselineVisualInterval: ReturnType<
              typeof visualCodeBodyIntervalAtOrdinal
            >;
            let editedVisualInterval: ReturnType<
              typeof visualCodeBodyIntervalAtOrdinal
            >;
            let sourceInterval: ReturnType<
              typeof visualCodeBodyIntervalAtOrdinal
            >;
            try {
              sourceInterval = visualCodeBodyIntervalAtOrdinal(
                baseMarkdown,
                pending.codeBlockStructure.codeOrdinal
              );
              acceptedCodeInputOpenEof = !sourceInterval.closed;
              acceptedCodeInputSourceBlockStart =
                sourceInterval.sourceBlockStart;
              restoreVisualCodeFenceOpenEofMetadata(
                mappedBlock.pre,
                fenceExpansion.markdown,
                sourceInterval.sourceBlockStart,
                !sourceInterval.closed
              );
              editedVisual = serializeVisualMarkdown(surface);
              visualExpansion = expandVisualCodeFenceForBody(
                baselineVisual,
                pending.codeBlockStructure.codeOrdinal,
                mappedBlock.codeText
              );
              baselineVisualInterval = visualCodeBodyIntervalAtOrdinal(
                baselineVisual,
                pending.codeBlockStructure.codeOrdinal
              );
              editedVisualInterval = visualCodeBodyIntervalAtOrdinal(
                editedVisual,
                pending.codeBlockStructure.codeOrdinal
              );
            } catch (error) {
              return failVisualSynchronization(error);
            }
            const expectedVisual = visualExpansion?.markdown ?? editedVisual;
            const editedVisualBody = editedVisual.slice(
              editedVisualInterval.bodyStart,
              editedVisualInterval.bodyEnd
            );
            const normalizedCodeBody = normalizeCodeLineEndings(
              mappedBlock.codeText
            );
            if (
              visualCodeBlockCount(editedVisual) !==
                visualCodeBlockCount(baselineVisual) ||
              editedVisual !== expectedVisual ||
              editedVisualInterval.info !== baselineVisualInterval.info ||
              normalizeCodeLineEndings(editedVisualBody) !==
                normalizedCodeBody ||
              pending.result.selection.start < sourceInterval.bodyStart ||
              pending.result.selection.end < sourceInterval.bodyStart
            ) {
              return failVisualSynchronization(
                new Error('visual-editor-code-body-map-stale')
              );
            }
            const visualFenceDelta =
              editedVisualInterval.bodyStart - baselineVisualInterval.bodyStart;
            committedResult = {
              ...pending.result,
              selection: {
                ...pending.result.selection,
                end:
                  pending.result.selection.end +
                  fenceExpansion.openingFenceDelta,
                start:
                  pending.result.selection.start +
                  fenceExpansion.openingFenceDelta
              },
              sourceMarkdown: fenceExpansion.markdown,
              visualMarkdown: editedVisual,
              visualSelection: {
                end: pending.result.visualSelection.end + visualFenceDelta,
                start: pending.result.visualSelection.start + visualFenceDelta
              }
            };
            if (pending.memory) {
              committedMemory = {
                ...pending.memory,
                sourceAnchor:
                  pending.memory.sourceAnchor +
                  fenceExpansion.openingFenceDelta,
                sourceFocus:
                  pending.memory.sourceFocus + fenceExpansion.openingFenceDelta,
                visualAnchor: pending.memory.visualAnchor + visualFenceDelta,
                visualFocus: pending.memory.visualFocus + visualFenceDelta
              };
            }
            try {
              restoreVisualCodeFenceFamilies(
                surface,
                committedResult.sourceMarkdown
              );
            } catch (error) {
              return failVisualSynchronization(error);
            }
            const expandedBlock = captureVisualCodeInputSnapshot(
              mappedBlock.pre
            );
            if (
              !expandedBlock ||
              expandedBlock.fence !== fenceExpansion.fence ||
              expandedBlock.fenceInfo !== sourceInterval.info
            ) {
              return failVisualSynchronization(
                new Error('visual-editor-code-body-map-stale')
              );
            }
            acceptedCodeInputPreIndex = acceptedVisualCodePreIndex(
              expandedBlock.pre
            );
            acceptedCodeInputPre = expandedBlock.pre;
            mappedCodeStructureValidated = true;
            validatedCodeStructure = {
              markdown: committedResult.sourceMarkdown,
              matchesPreview: true
            };
            expandedPreviewSource = committedResult.sourceMarkdown;
          } else {
            if (
              visualCodeBlockStructureSignature(
                pending.result.sourceMarkdown
              ) !== visualCodeBlockStructureSignature(baseMarkdown)
            ) {
              return failVisualSynchronization(
                new Error('visual-editor-code-body-map-stale')
              );
            }
            try {
              const ordinal = codeOrdinalForInputBlock(
                mappedBlock,
                pending.result.sourceMarkdown,
                true
              );
              if (ordinal !== pending.codeBlockStructure.codeOrdinal) {
                return failVisualSynchronization(
                  new Error('visual-editor-code-body-map-stale')
                );
              }
              acceptedCodeInputPreIndex = acceptedVisualCodePreIndex(
                mappedBlock.pre
              );
              acceptedCodeInputPre = mappedBlock.pre;
              acceptedCodeInputOpenEof =
                pending.codeBodyTopology?.openEof ??
                null !== mappedBlock.fenceOpenEof;
              acceptedCodeInputSourceBlockStart =
                pending.codeBodyTopology?.sourceBlockStart ?? 0;
            } catch (error) {
              return failVisualSynchronization(error);
            }
            mappedCodeStructureValidated = true;
            validatedCodeStructure = visualCodeStructureCandidate(
              pending.result.sourceMarkdown
            );
          }
        }
      }
      // A rapid native burst coalesces its keys into one intent: the group's
      // last-key sourceChange does not describe the whole insertion, so the
      // commit writes the group's result as a whole value. Project the group's
      // own resulting line (its real sourceMarkdown/selection), not a
      // previousSource + last-key splice, so the typed run stays literal
      // without double-escaping and without splitting the history group.
      const appliesSourceChange = null === expandedPreviewSource
        && pending.baseSourceMarkdown === previousSource
        && !pending.deferSourceChange;
      if (!appliesSourceChange && !pending.codeBlockStructure
        && ('insertText' === pending.inputType
          || 'insertReplacementText' === pending.inputType)
        && !/[\r\n]/u.test(sourceChange.insert)) {
        const nativeNode = surface.ownerDocument.defaultView?.getSelection()?.anchorNode;
        const nativeElement = nativeNode instanceof Element ? nativeNode : nativeNode?.parentElement;
        const nativeParagraph = nativeElement?.closest('p');
        const groupValue = committedResult.sourceMarkdown;
        const groupSelection = committedResult.selection;
        if (nativeParagraph && nativeParagraph.parentElement === surface
          && !nativeParagraph.closest('pre, code, [contenteditable="false"]')
          && groupSelection.start === groupSelection.end) {
          const caretOnLine = groupSelection.start;
          const lineStart = 0 === caretOnLine
            ? 0 : groupValue.lastIndexOf('\n', caretOnLine - 1) + 1;
          const lineBreak = groupValue.indexOf('\n', caretOnLine);
          const lineEnd = lineBreak < 0 ? groupValue.length : lineBreak;
          const previousBreak = previousSource.indexOf('\n', lineStart);
          const previousLineEnd = previousBreak < 0 ? previousSource.length : previousBreak;
          const previousLine = lineStart <= previousSource.length
            ? previousSource.slice(lineStart, previousLineEnd) : '';
          if (!isMarkdownFenceOpeningLine(previousLine)) {
            const literal = projectVisualLiteralParagraphLine(
              groupValue.slice(lineStart, lineEnd),
              caretOnLine - lineStart
            );
            if (literal) {
              const nextCaret = lineStart + literal.offset;
              committedResult = {
                ...committedResult,
                sourceMarkdown:
                  groupValue.slice(0, lineStart)
                  + literal.markdown
                  + groupValue.slice(lineEnd),
                selection: { direction: 'none', start: nextCaret, end: nextCaret }
              };
              if (committedMemory) {
                committedMemory = {
                  ...committedMemory,
                  sourceAnchor: nextCaret,
                  sourceFocus: nextCaret
                };
              }
            }
          }
        }
      }
      try {
        const codeBodyPre =
          acceptedCodeInputPre ?? pending.codeBodyTopology?.pre ?? null;
        if (codeBodyPre) {
          const codeBodySnapshot = captureVisualCodeInputSnapshot(codeBodyPre);
          if (!codeBodySnapshot) {
            return failVisualSynchronization(
              new Error('visual-editor-code-body-map-stale')
            );
          }
          restoreVisualCodeFenceOpenEofMetadata(
            codeBodyPre,
            committedResult.sourceMarkdown,
            acceptedCodeInputSourceBlockStart ??
              pending.codeBodyTopology?.sourceBlockStart ??
              0,
            acceptedCodeInputOpenEof ??
              pending.codeBodyTopology?.openEof ??
              null !== codeBodySnapshot.fenceOpenEof
          );
        }
        const consumedEditSelectionBefore = pendingEditSelectionBeforeRef.current;
        const startsNativeTypingRun = Boolean(
          pending.nativeTypingRun && !codeBodyTypingRunRef.current
        );
        applyDocumentChange(
          {
            selection: committedResult.selection,
            ...(pending.historySelectionBefore ? {
              historySelectionBefore: pending.historySelectionBefore,
              recordHistorySelection: !startsNativeTypingRun
            } : {}),
            value: committedResult.sourceMarkdown,
            ...(null === expandedPreviewSource &&
            pending.baseSourceMarkdown === previousSource &&
            !pending.deferSourceChange
              ? { changes: appliedChange }
              : {})
          },
          {
            ...(pending.historySelectionWitness
              ? {
                  historySelectionWitness:
                    pending.historySelectionWitness
                }
              : {}),
            // A plain native character typed into one code body continues the
            // run the browser itself would have grouped; every other commit
            // (line break, deletion, fence change, whole-value write) ends it.
            joinPreviousHistory: Boolean(pending.nativeTypingRun),
            rejectCodeStructureMismatch: Boolean(
              pending.codeBlockStructure &&
                !pending.codeBlockStructure.localPre &&
                !mappedCodeStructureValidated
            ),
            ...(validatedCodeStructure ? { validatedCodeStructure } : {})
          }
        );
        // This fast group has already recorded its canonical inverse above;
        // retire only its raw witness, preserving any newer reentrant witness.
        if (pendingEditSelectionBeforeRef.current === consumedEditSelectionBefore) {
          pendingEditSelectionBeforeRef.current = null;
        }
      } catch (error) {
        return failVisualSynchronization(error);
      }
      if (expandedPreviewSource) {
        // Keep the source that the Preview edit map actually describes.
        visualCodeBodyPreviewStructureRef.current =
          visualCodeBlockStructureSignature(expandedPreviewSource);
        visualCodeBodyOrdinalsRef.current = null;
        visualCodeBodyDomOrderInvalidRef.current = true;
      }
      const emptyStructuralBody = visualStructuralBodyIsEmpty(surface);
      const committedVisualMarkdown = emptyStructuralBody
        ? serializeVisualMarkdown(surface)
        : committedResult.visualMarkdown;
      sourceMarkdownRef.current = committedResult.sourceMarkdown;
      visualMarkdownRef.current = committedVisualMarkdown;
      // Selection memory keeps consecutive edits in the same text node O(1).
      // A direct identity map is no longer valid after editing rendered
      // Markdown whose source contains hidden delimiters; materialize the
      // complete map before the next edit in a different node instead.
      visualSourceIntervalMapRef.current = emptyStructuralBody
        ? {
            map: createVisualMarkdownSourceIntervalMap(
              committedResult.sourceMarkdown,
              committedVisualMarkdown
            ),
            sourceMarkdown: committedResult.sourceMarkdown,
            visualMarkdown: committedVisualMarkdown
          }
        : null;
      visualBaselineMaterializedRef.current = emptyStructuralBody;
      if (emptyStructuralBody) {
        acceptedHtmlRef.current = surface.innerHTML;
        acceptedNodesRef.current = Array.from(surface.childNodes);
        readOnlySnapshotRef.current =
          captureVisualMarkdownReadOnlySnapshot(surface);
      }
      acceptedPasteDocumentBoundaryRef.current = null;
      lastSelectionRef.current = committedResult.selection;
      visualSelectionMemoryRef.current = committedMemory;
      if (null !== acceptedCodeInputPreIndex && acceptedCodeInputPre) {
        acceptedCodeBodySnapshotsRef.current.set(
          acceptedCodeInputPreIndex,
          acceptedCodeInputPre.cloneNode(true) as HTMLElement
        );
      }
      acceptedLocalCodeBodiesRef.current = visualLocalCodeBodyRecords();
      if (
        pending.historyBefore &&
        pending.historyBefore.markdown === previousSource
      ) {
        if (previousSource !== committedResult.sourceMarkdown) {
          const after = captureVisualHistorySnapshot(
            committedResult.sourceMarkdown,
            surface.innerHTML
          );
          acceptedHtmlRef.current = after.html;
          appendVisualHistoryTransition(pending.historyBefore, after);
        }
      } else if (previousSource !== committedResult.sourceMarkdown) {
        if (
          documentSession.document.getValue() !==
            committedResult.sourceMarkdown ||
          sourceMarkdownRef.current !== committedResult.sourceMarkdown
        ) {
          return failVisualSynchronization(
            new Error('visual-editor-history-document-stale')
          );
        }
        const historyState = documentHistoryState(documentSession.document);
        if (emptyStructuralBody) {
          recordCurrentVisualHistorySnapshot(
            committedResult.sourceMarkdown,
            surface.innerHTML
          );
        } else {
          visualHistorySnapshotsRef.current.set(historyState.undoDepth, {
            kind: 'rematerialize',
            markdown: committedResult.sourceMarkdown
          });
        }
      }
      if (previousSource !== committedResult.sourceMarkdown) {
        // Record the owner's own operation for the transfer record that follows:
        // a pure, single-line insertion at one collapsed point is the only shape
        // whose presentation boundary this owner may advance arithmetically.
        ownerInsertionRef.current =
          sourceChange.from === sourceChange.to
          && '' !== sourceChange.insert
          && !/[\r\n]/u.test(sourceChange.insert)
            ? {
                insert: sourceChange.insert,
                source: committedResult.sourceMarkdown,
                // The caret the insertion was made at, in the visual text it
                // advanced: a collapsed single-line insertion moves the caret
                // by exactly its own length.
                visualFrom:
                  pending.result.visualSelection.start
                  - sourceChange.insert.length
              }
            : null;
        onMarkdownChange();
      }
      if (previousSource !== committedResult.sourceMarkdown) {
        // A fast text/code intent commits without a render, so this owner has
        // to state the pairing it now owns. The node identities are retained,
        // never re-read, but their metadata is frozen again at THIS publication:
        // the commit may have published the owner's own fence metadata on a
        // retained root, and a later guard must compare the live roots against
        // the state this commit created - not the state from before it. A
        // foreign root would already have failed the identity check.
        const retainedLedger =
          null === expandedPreviewSource ? ownedLedgerRetainsLive() : null;
        const ledger = retainedLedger
          ? {
              metadata: retainedLedger.nodes.map(fullOwnedNodeMetadata),
              nodes: retainedLedger.nodes
            }
          : consumeVerifiedNativeRootJoin();
        publishOwnedDom(
          committedResult.sourceMarkdown,
          committedVisualMarkdown,
          documentSession.document.getRevision?.() ?? 0,
          ledger
        );
      } else {
        // A zero-byte own native join changes the node window without changing
        // the source, so the ordinary source-change publication never runs.
        // Only the verified bounded join witness may refresh the pairing here.
        const joinLedger = consumeVerifiedNativeRootJoin();
        if (joinLedger) {
          acceptedHtmlRef.current = surface.innerHTML;
          acceptedNodesRef.current = joinLedger.nodes;
          publishOwnedDom(
            committedResult.sourceMarkdown,
            committedVisualMarkdown,
            documentSession.document.getRevision?.() ?? 0,
            joinLedger
          );
        }
      }
      const emptyParagraphTarget = pending.emptyParagraphTarget;
      const emptyParagraphOffset = committedResult.selection.start;
      if (emptyParagraphTarget
        && previousSource !== committedResult.sourceMarkdown
        && emptyParagraphTarget.parentElement === surface
        && emptyParagraphTarget.childNodes.length === 1
        && emptyParagraphTarget.firstChild instanceof HTMLBRElement
        && emptyParagraphOffset === committedResult.selection.end
        && coversMarkdownUnits(
          pending.baseSourceMarkdown,
          pending.sourceChange.from,
          pending.sourceChange.to
        )
        && coversMarkdownUnits(
          committedResult.sourceMarkdown,
          emptyParagraphOffset,
          emptyParagraphOffset
        )
        && ownedDomRef.current?.owner === fullOwnerRef.current
        && ownedDomRef.current.source === committedResult.sourceMarkdown
        && ownedDomRef.current.sourceRevision === documentSession.document.getRevision?.()
        && ownedLedgerRetains(Array.from(surface.childNodes))) {
        ownedEmptyParagraphRef.current = {
          body: emptyParagraphTarget,
          owner: fullOwnerRef.current,
          revision: documentSession.document.getRevision?.() ?? 0,
          source: committedResult.sourceMarkdown,
          sourceLength: 0,
          sourceOffset: emptyParagraphOffset
        };
        const historyUndoDepth = documentHistoryState(documentSession.document).undoDepth;
        emptyParagraphHistoryRef.current = {
          depth: historyUndoDepth,
          historyUndoDepth,
          markdown: committedResult.sourceMarkdown,
          sourceOffset: emptyParagraphOffset
        };
        recordCurrentVisualHistorySnapshot(
          committedResult.sourceMarkdown,
          surface.innerHTML
        );
      }
      return true;
    };

    const commitVisualInput = (): boolean => {
      pendingUnmappedVisualInputRef.current = false;
      continuingUnmappedVisualInputRef.current = false;
      if (visualTransferFailureReportedRef.current) {
        visualInputPendingRef.current = false;
        pendingVisualIntentResultRef.current = null;
        return false;
      }
      if (
        !active ||
        pendingTransferRef.current ||
        externalChangeReportedRef.current
      ) {
        visualInputPendingRef.current = false;
        pendingVisualIntentResultRef.current = null;
        return false;
      }
      if (commitPendingVisualIntent()) {
        visualInputPendingRef.current = false;
        return true;
      }
      visualInputPendingRef.current = false;
      return synchronizeMarkdown(
        compositionCodeBodyLocalPre
          ? { localCodeBodyInputPre: compositionCodeBodyLocalPre }
          : { rejectCodeStructureMismatch: compositionCodeBodyCommit }
      );
    };
    const flushVisualInput = (): boolean => {
      const wasPending = visualInputPendingRef.current;
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
        visualInputTimerRef.current = null;
      }
      if (!wasPending) return true;
      return commitVisualInput();
    };
    const scheduleVisualInput = (): void => {
      visualInputPendingRef.current = true;
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
      }
      visualInputTimerRef.current = setTimeout(() => {
        visualInputTimerRef.current = null;
        commitVisualInput();
      }, VISUAL_INPUT_DEBOUNCE_MS);
    };
    flushVisualInputRef.current = flushVisualInput;

    const clearWholeVisualDocument = (): boolean => {
      const sourceMarkdown = sourceMarkdownRef.current;
      if (null === sourceMarkdown) {
        return failVisualSynchronization(
          new Error('visual-editor-markdown-snapshot-missing')
        );
      }
      const selection = {
        direction: 'none' as const,
        end: 0,
        start: 0
      };
      try {
        resetEmptyVisualParagraph(surface);
        applyDocumentChange({
          changes: { from: 0, insert: '', to: sourceMarkdown.length },
          recordHistorySelection: true,
          selection,
          value: ''
        });
        clearVisualLocalCodeBodyProvenance();
        visualCodeBodyPreviewSourceRef.current = '';
        visualCodeBodyPreviewStructureRef.current =
          visualCodeBlockStructureSignature('');
        visualCodeBodyStructureValidationRef.current = {
          markdown: '',
          matchesPreview: true
        };
        visualCodeBodyOrdinalsRef.current = null;
        visualCodeBodyDomOrderInvalidRef.current = true;
        acceptedPasteDocumentBoundaryRef.current = null;
        lastSelectionRef.current = selection;
        visualSelectionMemoryRef.current = null;
        pendingVisualIntentRef.current = null;
        pendingVisualIntentResultRef.current = null;
        pendingUnmappedVisualInputRef.current = false;
        continuingUnmappedVisualInputRef.current = false;
        sourceMarkdownRef.current = '';
        visualMarkdownRef.current = '';
        visualSourceIntervalMapRef.current = {
          map: createVisualMarkdownSourceIntervalMap('', ''),
          sourceMarkdown: '',
          visualMarkdown: ''
        };
        acceptedHtmlRef.current = surface.innerHTML;
        acceptedNodesRef.current = Array.from(surface.childNodes);
        acceptedCodeBodySnapshotsRef.current.clear();
        acceptedLocalCodeBodiesRef.current = visualLocalCodeBodyRecords();
        readOnlySnapshotRef.current =
          captureVisualMarkdownReadOnlySnapshot(surface);
        visualBaselineMaterializedRef.current = true;
        recordCurrentVisualHistorySnapshot('', surface.innerHTML);
        // The reset emptied this surface itself, so the single empty paragraph
        // it installed is the ledger this operation adopted. It is not a formal
        // render, so the older origin certificate stays as the thing
        // applicability reports as no longer describing this source.
        const resetLedger = Array.from(surface.childNodes);
        publishOwnedDom(
          '',
          '',
          documentSession.document.getRevision?.() ?? 0,
          {
            metadata: resetLedger.map(fullOwnedNodeMetadata),
            nodes: resetLedger
          }
        );
        onMarkdownChange();
        return true;
      } catch (error) {
        return failVisualSynchronization(error);
      }
    };

    const restoreHistorySnapshot = (snapshot: VisualHistorySnapshot): void => {
      if (!visualHistorySnapshotIsRestorable(snapshot)) {
        // Restoring this DOM would publish an accepted state that the live
        // Preview edit map cannot describe. The caller must request a formal
        // Preview instead of restoring the snapshot in place.
        throw new Error('visual-editor-history-preview-identity-stale');
      }
      clearVisualLocalCodeBodyProvenance();
      visualCodeBodyPreviewSourceRef.current =
        snapshot.codeBodyPreviewSourceMarkdown;
      visualCodeBodyPreviewStructureRef.current =
        snapshot.codeBodyPreviewStructureSignature;
      visualCodeBodyOrdinalsRef.current = null;
      visualCodeBodyDomOrderInvalidRef.current = true;
      const template = surface.ownerDocument.createElement('template');
      template.innerHTML = snapshot.html;
      const adoption = prepareVisualProtectedNodeAdoption(
        Array.from(surface.childNodes),
        Array.from(template.content.childNodes),
        true,
        'protected-order'
      );
      try {
        surface.replaceChildren(...adoption.nodes);
      } catch (error) {
        adoption.rollback();
        throw error;
      }
      const restoredRevision = documentSession.document.getRevision?.();
      if (
        !Number.isSafeInteger(restoredRevision)
        || documentSession.document.getValue() !== snapshot.markdown
      ) {
        throw new Error('visual-editor-history-code-body-correspondence-stale');
      }
      const restoredCodeBodyCorrespondence = new Map<
        HTMLElement,
        FullAcceptedCodeBodyCorrespondence
      >();
      const restoredStructureSignature =
        visualCodeBlockStructureSignature(snapshot.markdown);
      for (const record of snapshot.acceptedCodeBodies) {
        if (
          record.source !== snapshot.markdown
          || !Number.isSafeInteger(record.sourceRevision)
          || record.structureSignature !== restoredStructureSignature
        ) {
          throw new Error('visual-editor-history-code-body-correspondence-stale');
        }
        const pre = visualCodePreOrder()[record.preIndex];
        if (!(pre instanceof HTMLElement) || !surface.contains(pre)) {
          throw new Error('visual-editor-history-code-body-correspondence-stale');
        }
        const blockId = visualBlockIdForPre(pre, surface);
        if (blockId !== record.blockId) {
          throw new Error('visual-editor-history-code-body-correspondence-stale');
        }
        let interval: VisualCodeBodyInterval;
        try {
          interval = visualCodeBodyIntervalAtOrdinal(
            snapshot.markdown,
            record.interval.codeOrdinal
          );
        } catch {
          throw new Error('visual-editor-history-code-body-correspondence-stale');
        }
        const intervalMatches = (
          interval.bodyEnd === record.interval.bodyEnd
          && interval.bodyStart === record.interval.bodyStart
          && interval.codeOrdinal === record.interval.codeOrdinal
          && interval.fence === record.interval.fence
          && interval.info === record.interval.info
          && interval.lineEnding === record.interval.lineEnding
          && interval.sourceBlockEnd === record.interval.sourceBlockEnd
          && interval.sourceBlockStart === record.interval.sourceBlockStart
        );
        if (!intervalMatches) {
          throw new Error('visual-editor-history-code-body-correspondence-stale');
        }
        const input = captureVisualCodeInputSnapshot(pre);
        if (
          !input
          || input.fence !== interval.fence
          || (null !== input.fenceInfo && input.fenceInfo !== interval.info)
        ) {
          throw new Error('visual-editor-history-code-body-correspondence-stale');
        }
        const expectedBody = normalizeCodeLineEndings(
          snapshot.markdown.slice(interval.bodyStart, interval.bodyEnd)
        );
        const actualBody = normalizeCodeLineEndings(input.codeText);
        const rendererTerminalLine = Boolean(
          interval.lineEnding
          && expectedBody.endsWith(interval.lineEnding)
          && actualBody === expectedBody.slice(0, -interval.lineEnding.length)
        );
        if (
          actualBody !== expectedBody
          && actualBody !== `${expectedBody}\n`
          && !rendererTerminalLine
        ) {
          throw new Error('visual-editor-history-code-body-correspondence-stale');
        }
        reconcileVisualCodeBodyDom(input.code, expectedBody, expectedBody.length);
        restoredCodeBodyCorrespondence.set(pre, {
          blockId,
          interval,
          owner: fullOwnerRef.current,
          source: snapshot.markdown,
          sourceRevision: restoredRevision as number,
          structureSignature: restoredStructureSignature
        });
      }
      acceptedCodeBodyCorrespondenceRef.current = restoredCodeBodyCorrespondence;
      installVisualLocalCodeBodyProvenance(
        snapshot.markdown,
        snapshot.localCodeBodies
      );
      for (const pre of visualCodePreOrder()) {
        if (pre.querySelector('[data-easymde-visual-code-placeholder]')) {
          normalizeVisualCodePlaceholders(surface, 'historyUndo', pre);
        }
      }
      const sourceSelection = snapshot.selection?.sourceSelection;
      const restorePath =
        (!sourceSelection || snapshot.selection?.nativePathPaired === true)
        && restoreVisualHistorySelection(surface, snapshot.selection);
      if (!restorePath) {
        if (!sourceSelection) {
          throw new Error('visual-editor-history-selection-restore-failed');
        }
        placeVisualSelectionFromSourceRange(
          surface,
          snapshot.markdown,
          serializeVisualMarkdown(surface),
          sourceSelection
        );
      }
      captureSnapshot(snapshot.markdown, {
        historyRestore: true,
        ...(snapshot.tablePresentation ? { tablePresentation: snapshot.tablePresentation } : {})
      });
      const restoredEmpty = snapshot.emptyParagraph
        ? visualNodeAtPath(surface, snapshot.emptyParagraph.bodyPath)
        : null;
      if (restoredEmpty instanceof HTMLParagraphElement
        && restoredEmpty.parentElement === surface
        && restoredEmpty.childNodes.length === 1
        && restoredEmpty.firstChild instanceof HTMLBRElement
        && ownedDomRef.current?.owner === fullOwnerRef.current
        && ownedDomRef.current.source === snapshot.markdown
        && ownedDomRef.current.sourceRevision === documentSession.document.getRevision?.()
        && ownedLedgerRetains(Array.from(surface.childNodes))) {
        ownedEmptyParagraphRef.current = {
          body: restoredEmpty,
          owner: fullOwnerRef.current,
          revision: documentSession.document.getRevision?.() ?? 0,
          source: snapshot.markdown,
          sourceLength: snapshot.emptyParagraph?.sourceLength ?? 2,
          sourceOffset: snapshot.emptyParagraph?.sourceOffset ?? 0
        };
      } else {
        ownedEmptyParagraphRef.current = null;
      }
      // An Undo/Redo restore publishes this owner's own selection, and the
      // accepted snapshot above may normalize the surface, so it is recorded
      // after that capture. A pointer image demand may replace it; nothing
      // else marks a selection as owned. A failed capture only loses that
      // exemption, so it must never turn a successful restore into a history
      // failure.
      try {
        ownerPlacedSelectionRef.current =
          captureVisualHistorySelection(surface);
      } catch {
        ownerPlacedSelectionRef.current = null;
      }
      acceptedLocalCodeBodiesRef.current = snapshot.localCodeBodies;
      acceptedHtmlRef.current = surface.innerHTML;
      acceptedNodesRef.current = Array.from(surface.childNodes);
      acceptedCodeBodySnapshotsRef.current.clear();
      const historyState = documentHistoryState(documentSession.document);
      if (documentSession.document.getValue() !== snapshot.markdown) {
        throw new Error('visual-editor-history-snapshot-stale');
      }
      visualHistorySnapshotsRef.current.set(historyState.undoDepth, {
        kind: 'snapshot',
        markdown: snapshot.markdown,
        snapshot: captureVisualHistorySnapshot(
          snapshot.markdown,
          surface.innerHTML,
          snapshot.tablePresentation
        )
      });
    };

    const runHistory = (redo: boolean): boolean => {
      if (
        !active ||
        externalChangeReportedRef.current ||
        visualTransferFailureReportedRef.current
      )
        return false;
      const transfer = pendingTransferRef.current;
      if (transfer) {
        try {
          assertPendingCanonicalLease(transfer);
          assertPendingInputDom();
          const before = documentHistoryState(documentSession.document);
          if (redo ? before.redoDepth === 0 : before.undoDepth === 0) return false;
          let changed: boolean;
          selfWriteRef.current = true;
          try { changed = redo ? documentSession.document.redo() : documentSession.document.undo(); }
          finally { selfWriteRef.current = false; }
          if (!changed) return false;
          const value = documentSession.document.getValue();
          const history = documentHistoryState(documentSession.document);
          if (history.undoDepth !== before.undoDepth + (redo ? 1 : -1)) throw new Error('visual-editor-history-state-stale');
          const target = visualHistorySnapshotsRef.current.get(history.undoDepth);
          if (target && target.markdown !== value) throw new Error('visual-editor-history-snapshot-stale');
          sourceMarkdownRef.current = value;
          onMarkdownChange();
          const selection = documentSession.document.getSelection();
          const revision = documentSession.document.getRevision?.();
          publishPendingTransfer({
            expectation: {
              history,
              ...(undefined !== revision ? { revision } : {}),
              selection,
              value
            },
            kind: 'native',
            placement: { kind: 'accepted-preview' },
            presentation: 'structural'
          });
          return true;
        } catch (error) {
          failPendingTransfer(visualEditorFailureCode(error, 'visual-editor-history-preview-failed'));
          return false;
        }
      }
      if (!flushVisualInput()) return false;
      if (!previewSnapshotRef.current.editMap && !visualBaselineMaterializedRef.current) {
        try {
          const readOnly = readOnlySnapshotRef.current;
          if (!readOnly) throw new Error('visual-editor-read-only-snapshot-missing');
          assertVisualMarkdownReadOnlySnapshot(surface, readOnly);
          if (serializeVisualMarkdown(surface) !== visualMarkdownRef.current) {
            throw new Error('visual-editor-canonical-change-dom-stale');
          }
          const depth = documentHistoryState(documentSession.document).undoDepth;
          const slot = visualHistorySnapshotsRef.current.get(depth);
          if (!materializeVisualBaseline()) return false;
          // DOM readiness must not turn a source-only history slot into an
          // in-place restoration certificate for a later Redo.
          if (slot) visualHistorySnapshotsRef.current.set(depth, slot);
        } catch (error) {
          onFailure(visualEditorFailureCode(error, 'visual-editor-history-sync-failed'));
          return false;
        }
      }
      const currentMarkdown = sourceMarkdownRef.current;
      if (null === currentMarkdown) {
        onFailure('visual-editor-markdown-snapshot-missing');
        return false;
      }
      if (documentSession.document.getValue() !== currentMarkdown) {
        onFailure('visual-editor-history-document-stale');
        return false;
      }
      const historyBefore = documentHistoryState(documentSession.document);
      const historyAvailable = redo
        ? historyBefore.redoDepth > 0
        : historyBefore.undoDepth > 0;
      if (!historyAvailable) return false;
      const currentSlot = visualHistorySnapshotsRef.current.get(
        historyBefore.undoDepth
      );
      if (!currentSlot) {
        onFailure('visual-editor-history-snapshot-missing');
        return false;
      }
      if (currentSlot.markdown !== currentMarkdown) {
        onFailure('visual-editor-history-snapshot-stale');
        return false;
      }
      const previousSnapshot = captureVisualHistorySnapshot(
        currentMarkdown,
        surface.innerHTML
      );
      const targetDepth = historyBefore.undoDepth + (redo ? 1 : -1);
      const targetSlot = visualHistorySnapshotsRef.current.get(targetDepth);
      const targetHasTablePresentation = targetSlot?.kind === 'snapshot'
        && null !== targetSlot.snapshot.tablePresentation;
      // Only this known table replay needs a pre-command row-origin proof.
      // Its source/revision remain the state being left, never the target.
      const selectionOrigin = targetHasTablePresentation ? currentAcceptedSelectionOrigin() : null;
      const revisionBefore = targetHasTablePresentation ? documentSession.document.getRevision?.() : undefined;
      const ownedHistoryOrigin = targetHasTablePresentation && ownedDomIsCurrent() ? ownedDomRef.current : null;
      const minimumDepth = Math.min(
        ...visualHistorySnapshotsRef.current.keys()
      );
      if (!targetSlot && targetDepth >= minimumDepth) {
        onFailure('visual-editor-history-snapshot-missing');
        return false;
      }
      let changed = false;
      let previewRequested = false;
      try {
        const protectedSnapshot = readOnlySnapshotRef.current;
        if (!protectedSnapshot) throw new Error('visual-editor-read-only-snapshot-missing');
        assertVisualMarkdownReadOnlySnapshot(surface, protectedSnapshot);
        selfWriteRef.current = true;
        try {
          changed = redo
            ? documentSession.document.redo()
            : documentSession.document.undo();
        } finally {
          selfWriteRef.current = false;
        }
        if (!changed) return false;
        const targetMarkdown = documentSession.document.getValue();
        const historyAfter = documentHistoryState(documentSession.document);
        if (historyAfter.undoDepth !== targetDepth) {
          throw new Error('visual-editor-history-state-stale');
        }
        const targetSnapshot =
          targetSlot?.kind === 'snapshot' ? targetSlot.snapshot : null;
        const restoreInPlace =
          null !== targetSnapshot
          && visualHistorySnapshotIsRestorable(targetSnapshot);
        if (
          !targetSlot
          || targetSlot.kind === 'rematerialize'
          || !restoreInPlace
        ) {
          if (targetSlot && targetSlot.markdown !== targetMarkdown) {
            throw new Error('visual-editor-history-snapshot-stale');
          }
          // A stored snapshot whose accepted Preview identity is no longer
          // current cannot be paired with the live edit map, so this target
          // is rebuilt by the formal Preview owner instead of restoring the
          // stored DOM in place.
          const rebuildSlot =
            targetSlot?.kind === 'rematerialize' ? targetSlot : null;
          // Every formal history rebuild on a mapped surface adopts the new
          // render's map, including source-only slots. A serialized/direct
          // baseline does not describe its leading or trailing source gaps.
          // Unmapped plain-text surfaces retain their existing placement owner.
          const acceptsMappedPreview = Boolean(previewSnapshotRef.current.editMap)
            || targetSnapshot?.acceptedPreview.mapped === true;
          // Only an existing accepted target-slot anchor can authorize the
          // history-specific placement; source-only/unknown slots cannot.
          sourceMarkdownRef.current = targetMarkdown;
          const selection = documentSession.document.getSelection();
          const revision = documentSession.document.getRevision?.();
          const presentation = targetSnapshot?.tablePresentation;
          const historyOriginStillOwned = Boolean(
            ownedHistoryOrigin && ownedDomRef.current === ownedHistoryOrigin
            && fullOwnedDomMatches(surface, ownedHistoryOrigin)
            && serializeVisualMarkdown(surface) === ownedHistoryOrigin.visual
          );
          if (historyOriginStillOwned) assertVisualMarkdownReadOnlySnapshot(surface, protectedSnapshot);
          const historyTablePresentation: FullHistoryTablePresentation | null =
            historyOriginStillOwned && targetSlot?.kind === 'snapshot' && targetSnapshot && presentation
            && presentation.owner === fullOwnerRef.current
            && presentation.source === targetMarkdown
            && targetSnapshot.markdown === targetMarkdown
            && currentMarkdown !== targetMarkdown
            && undefined !== revisionBefore && undefined !== revision
            && revision === revisionBefore + 1
            && historyAfter.redoDepth === historyBefore.redoDepth + (redo ? -1 : 1)
              ? {
                  canNormalize: Boolean(
                    selectionOrigin?.owner === fullOwnerRef.current
                    && selectionOrigin.kind === 'p'
                    && selectionOrigin.source === currentMarkdown
                    && selectionOrigin.sourceRevision === revisionBefore
                    // A native undo restores the operation's own inverse
                    // range. That range is still this kind change's origin: it
                    // lies inside the origin extent and starts at the
                    // representable target caret the redo must place. Only the
                    // collapsed spelling was accepted before, so a range undo
                    // refused the table presentation and failed a legitimate
                    // history replay.
                    && selectionOrigin.selection.start <= selectionOrigin.selection.end
                    && selectionOrigin.selection.start >= selectionOrigin.extent.start
                    && selectionOrigin.selection.end <= selectionOrigin.extent.end
                    && selectionOrigin.extent.start === presentation.extent.start
                  ),
                  originSource: currentMarkdown,
                  depth: targetDepth,
                  history: historyAfter,
                  owner: fullOwnerRef.current,
                  presentation,
                  revision,
                  selection: { ...selection },
                  slot: targetSlot
                }
              : null;
          let emptyParagraph: FullPendingHistoryProof['emptyParagraph'];
          const point = selection.start;
          const lineStart = point === 0 ? 0 : targetMarkdown.lastIndexOf('\n', point - 1) + 1;
          const lineEnd = targetMarkdown.indexOf('\n', point);
          if (targetSnapshot && targetSlot?.kind === 'snapshot' && point === selection.end
            && point === lineStart && targetMarkdown.slice(point, lineEnd < 0 ? targetMarkdown.length : lineEnd) === '  '
            && targetSnapshot.selection
            && visualHistorySelectionBoundaryEqual(targetSnapshot.selection.anchor, targetSnapshot.selection.focus)) {
            const template = surface.ownerDocument.createElement('article'); template.innerHTML = targetSnapshot.html;
            const body = visualNodeAtPath(template, targetSnapshot.selection.anchor.path);
            if (body instanceof HTMLParagraphElement && body.parentElement === template
              && body.childNodes.length === 1 && body.firstChild instanceof HTMLBRElement
              && [0, 1].includes(targetSnapshot.selection.anchor.offset)) {
              emptyParagraph = { owner: fullOwnerRef.current, depth: targetDepth, slot: targetSlot, sourceOffset: point };
            }
          }
          if (!emptyParagraph) {
            const continuity = fullRemountEmptyParagraphContinuity.get(documentSession.document);
            if (continuity
              && continuity.depth === targetDepth
              && continuity.historyUndoDepth === historyAfter.undoDepth
              && continuity.markdown === targetMarkdown
              && continuity.sourceOffset === point
              && point === selection.end
              && point === lineStart
              && targetMarkdown.slice(point, lineEnd < 0 ? targetMarkdown.length : lineEnd) === '  ') {
              emptyParagraph = {
                continuity,
                depth: targetDepth,
                owner: fullOwnerRef.current,
                sourceOffset: point
              };
            }
          }
          publishPendingTransfer(
            {
              expectation: {
                history: historyAfter,
                selection,
                value: targetMarkdown
              },
              ...(selectionOrigin ? { selectionOrigin } : {}),
              kind: 'history',
              placement: acceptsMappedPreview
                ? { kind: 'accepted-preview' }
                : { kind: 'source' },
              presentation: 'plain',
              ...(historyTablePresentation || rebuildSlot || emptyParagraph
                ? {
                    historyProof: {
                      ...(emptyParagraph ? { emptyParagraph } : {}),
                      ...(historyTablePresentation
                        ? { tablePresentation: historyTablePresentation }
                        : {}),
                      ...(rebuildSlot
                        ? { slot: { depth: targetDepth, value: rebuildSlot } }
                        : {})
                    }
                  }
                : {})
            },
            () => {
              onMarkdownChange();
              previewRequested = true;
            }
          );
          return true;
        }
        if (
          !targetSnapshot ||
          targetSlot.kind !== 'snapshot' ||
          targetSlot.markdown !== targetMarkdown ||
          targetSnapshot.markdown !== targetMarkdown
        ) {
          throw new Error('visual-editor-history-snapshot-stale');
        }
        restoreHistorySnapshot(targetSnapshot);
        sourceMarkdownRef.current = targetMarkdown;
        // The snapshot's own selection answers which DOM was captured. When
        // that snapshot has no connected native placement, the operation's
        // canonical selection is the remaining witnessed caret; place it only
        // through the accepted source map and never invent a neighbor.
        const operationSelection = documentSession.document.getSelection();
        const operationCarriesRange = Boolean(
          operationSelection &&
            ('none' !== operationSelection.direction ||
              operationSelection.start !== operationSelection.end)
        );
        if (operationSelection && previewSnapshotRef.current.editMap
          && (operationCarriesRange || !ownerPlacedSelectionRef.current)) {
          try {
            placeVisualSelectionFromAcceptedSourceRange(
              surface,
              targetMarkdown,
              previewSnapshotRef.current.editMap,
              operationSelection!,
              null
            );
            ownerPlacedSelectionRef.current =
              captureVisualHistorySelection(surface);
          } catch {
            // The snapshot placement stands; see above.
          }
        }
        onMarkdownChange();
        return true;
      } catch (error) {
        if (
          previewRequested ||
          'history' === pendingTransferRef.current?.spec.kind
        ) {
          if (pendingTransferRef.current) {
            failPendingTransfer('visual-editor-history-preview-failed');
          } else {
            onFailure('visual-editor-history-preview-failed');
            onTransferFailure();
          }
          return false;
        }
        try {
          selfWriteRef.current = true;
          try {
            const restored = redo
              ? documentSession.document.undo()
              : documentSession.document.redo();
            if (
              !restored ||
              documentSession.document.getValue() !== currentMarkdown
            ) {
              throw new Error('visual-editor-history-rollback-failed');
            }
          } finally {
            selfWriteRef.current = false;
          }
          restoreHistorySnapshot(previousSnapshot);
          sourceMarkdownRef.current = currentMarkdown;
        } catch (rollbackError) {
          const rollbackCode = visualEditorFailureCode(
            rollbackError,
            'visual-editor-history-rollback-failed'
          );
          onFailure(rollbackCode);
          onTransferFailure();
          return false;
        }
        onFailure(
          visualEditorFailureCode(error, 'visual-editor-history-sync-failed')
        );
        return false;
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (pendingTransferRef.current || pendingComposition) {
        event.preventDefault();
        onFailure('visual-editor-pending-input-unavailable');
        return;
      }
      if (hasImageFile(event.dataTransfer)) {
        if (!imageUploadEnabled) event.preventDefault();
        return;
      }
      event.preventDefault();
      requestMarkdownTransfer(event.dataTransfer?.getData('text/plain') ?? '');
    };
    const handleCompositionStart = () => {
      ordinaryCompositionOrigin = null;
      compositionRejected = false;
      rejectedCompositionSelection = null;
      compositionCodeBodyContext = null;
      cancelledPendingComposition = false;
      completedPendingComposition = null;
      if (pendingTransferRef.current) {
        try {
          const lease = pendingInputLease();
          const selection = surface.ownerDocument.defaultView?.getSelection();
          let block = selection?.anchorNode instanceof HTMLElement ? selection.anchorNode : selection?.anchorNode?.parentElement;
          while (block && block.parentElement !== surface) block = block.parentElement;
          if (!block || !selection?.focusNode || !block.contains(selection.focusNode)) {
            throw new Error('visual-editor-pending-input-unavailable');
          }
          pendingComposition = { lease, block, template: block.cloneNode(true) as HTMLElement,
            nodes: Array.from(surface.childNodes), selection: captureVisualHistorySelection(surface) };
          pendingCanonicalCompositionRef.current = true;
          composing = true;
        } catch (error) {
          cancelledPendingComposition = true;
          onFailure(visualEditorFailureCode(error, 'visual-editor-pending-input-unavailable'));
        }
        return;
      }
      if (pendingVisualIntentResultRef.current && !flushVisualInput()) {
        rejectComposition();
        return;
      }
      try {
        normalizeVisualCaretAtDocumentBoundary(surface);
      } catch (error) {
        rejectComposition();
        onFailure(
          visualEditorFailureCode(error, 'visual-editor-selection-map-failed')
        );
        return;
      }
      // Materialization retires selection memory; keep this operation's exact
      // source/visual pairing while it still authenticates the native Text.
      const compositionMemory = visualSelectionMemoryRef.current;
      const compositionMappingVisual = visualMarkdownRef.current;
      if (!visualBaselineMaterializedRef.current) {
        try {
          materializeVisualBaseline();
        } catch (error) {
          rejectComposition();
          onFailure(
            visualEditorFailureCode(
              error,
              'visual-editor-markdown-baseline-failed'
            )
          );
          return;
        }
      }
      try {
        const inputBlock = captureVisualCodeInputSnapshot(
          selectedVisualCodeBlock(surface)
        );
        const sourceMarkdown = sourceMarkdownRef.current;
        if (
          inputBlock &&
          (inputBlock.placeholder ||
            /^\n*$/.test(normalizeCodeLineEndings(inputBlock.codeText)))
        ) {
          if (null === sourceMarkdown) {
            throw new Error('visual-editor-markdown-snapshot-missing');
          }
          const codeOrdinal = codeOrdinalForInputBlock(
            inputBlock,
            sourceMarkdown,
            true
          );
          if (null === codeOrdinal) {
            throw new Error('visual-editor-code-body-map-ambiguous');
          }
          compositionCodeBodyContext = {
            code: inputBlock.code,
            codeOrdinal,
            historyBefore: captureVisualHistorySnapshot(
              sourceMarkdown,
              surface.innerHTML
            ),
            ...(visualLocalCodeBodyProvenanceRef.current.has(inputBlock.pre)
              ? { localPre: inputBlock.pre }
              : {})
          };
        }
      } catch (error) {
        rejectComposition();
        failVisualSynchronization(error);
        return;
      }
      ordinaryCompositionOrigin = null;
      if (!compositionCodeBodyContext) {
        try {
          const source = sourceMarkdownRef.current;
          const canonical = documentSession.document.getSelection?.();
          const native = surface.ownerDocument.defaultView?.getSelection();
          const nativeNode = native?.anchorNode;
          const nativeParent = nativeNode?.parentElement;
          const nativeRoot = directVisualBlockForSelectionNode(
            surface,
            nativeNode ?? null
          );
          const owned = ownedDomRef.current;
          const formalOrigin = mapCertificateRef.current;
          const ownedLedgerRetained = ownedLedgerRetains(Array.from(surface.childNodes));
          const nativeCreatedPlainRoot = Boolean(
            nativeRoot instanceof HTMLParagraphElement
            && nativeNode instanceof Text
            && isPlainVisualTextBody(nativeRoot, nativeNode)
            && formalOrigin?.owner === fullOwnerRef.current
            && !formalOrigin.nodes.includes(nativeRoot)
          );
          const localOwnedTextRoot = Boolean(
            nativeRoot
            && ['P', 'DIV'].includes(nativeRoot.tagName)
            && (!nativeRoot.hasAttribute('data-easymde-visual-block-id')
              || nativeCreatedPlainRoot)
            && owned?.owner === fullOwnerRef.current
            && owned.source === source
            && owned.visual === visualMarkdownRef.current
            && owned.sourceRevision === documentSession.document.getRevision?.()
            && owned.nodes.includes(nativeRoot)
            && ownedLedgerRetained
          );
          if (
            null !== source
            && canonical
            && canonical.start === canonical.end
            && native?.isCollapsed
            && nativeNode instanceof Text
            && native.focusNode instanceof Text
            && surface.contains(nativeNode)
            && nativeParent
            && (
              nativeParent.closest('[data-easymde-visual-block-id]')
              || localOwnedTextRoot
            )
            && !nativeParent.closest(
              `[data-easymde-preview-window-spacer], ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}, [contenteditable="false"]`
            )
          ) {
            const baseline = visualMarkdownRef.current;
            let localCertificate: LocalCompositionVisualCertificate | null = null;
            let mappingVisual: string | null = null;
            let nativeMapping: Readonly<{
              source: Readonly<{ end: number; start: number }>;
              visual: Readonly<{ end: number; start: number }>;
            }> | null = null;
            if (null !== baseline) {
              const witness = {
                anchorNode: nativeNode,
                anchorOffset: native.anchorOffset,
                focusNode: native.focusNode,
                focusOffset: native.focusOffset
              };
              const formalMapping = nativeRoot?.hasAttribute('data-easymde-visual-block-id')
                && nativeNode instanceof Text
                ? acceptedDecodedBlockSelection(
                    surface,
                    witness,
                    source,
                    baseline,
                    previewSnapshotRef.current.editMap ?? null
                  )
                : null;
              if (localOwnedTextRoot && !formalMapping) {
                // A duplicate-id root may use the local literal certificate only
                // when the formal whole-row certificate cannot authenticate it.
                if (null === compositionMappingVisual) {
                  throw new Error('visual-editor-markdown-snapshot-missing');
                }
                localCertificate = localCompositionVisualCertificate(
                  surface,
                  source,
                  compositionMappingVisual,
                  nativeNode,
                  witness.anchorOffset,
                  witness.focusOffset,
                  compositionMemory
                );
                if (localCertificate) {
                  mappingVisual = localCertificate.visual;
                  nativeMapping = {
                    source: localCertificate.sourceRange,
                    visual: localCertificate.visualRange
                  };
                } else if (!nativeRoot?.hasAttribute('data-easymde-visual-block-id')) {
                  throw new Error('visual-editor-selection-map-failed');
                }
              }
              if (!localCertificate) {
                // The accepted block-id path keeps its existing decoded-row
                // certificate, then the existing full-range projection. The
                // interval map below only supplies the visual half needed by
                // this composition certificate; it never widens or replaces
                // the accepted source selection.
                nativeMapping = formalMapping;
                if (nativeMapping && isPlainVisualTextBody(nativeParent, nativeNode)) {
                  // The accepted marker-row proof already authenticates this
                  // native/source point. Carry its complete literal run into
                  // the same owned composition commit, rather than re-merging
                  // the escaped row through the generic serializer.
                  const sourceBounds = literalTextBoundsAtSelection(nativeNode.data,
                    selectionRange(witness.anchorOffset, witness.focusOffset),
                    source, nativeMapping.source);
                  if (!sourceBounds) {
                    throw new Error('visual-editor-selection-map-failed');
                  }
                  // Its visual half is the raw visible spelling authenticated
                  // by the row proof, not Markdown to be decoded a second time.
                  localCertificate = {
                    root: nativeParent,
                    sourceStart: sourceBounds.start,
                    sourceRange: nativeMapping.source,
                    textNode: nativeNode,
                    visual: baseline,
                    visualEnd: nativeMapping.visual.end
                      + nativeNode.data.length - witness.focusOffset,
                    visualStart: nativeMapping.visual.start - witness.anchorOffset,
                    visualRange: nativeMapping.visual,
                    formalWholeRow: !nativeNode.data.includes('\\')
                  };
                }
                if (!nativeMapping) {
                  const acceptedSource = visualSelectionSourceRange(
                    surface,
                    source,
                    baseline,
                    baseline
                  );
                  const acceptedVisual = mapSelectionFromInterval(
                    surface,
                    witness,
                    baseline,
                    createVisualMarkdownSourceIntervalMap(source, baseline),
                    false
                  );
                  if (acceptedVisual) {
                    nativeMapping = {
                      source: {
                        end: acceptedSource.end,
                        start: acceptedSource.start
                      },
                      visual: acceptedVisual.visual
                    };
                  }
                }
                mappingVisual = localCertificate?.visual ?? baseline;
              }
            }
            // The witnessed native mapping is the source point; a stale
            // canonical caret (repeated text) must never displace it.
            if (
              null !== baseline
              && null !== mappingVisual
              && nativeMapping
              && nativeMapping.source.start === nativeMapping.source.end
              && nativeMapping.visual.start === nativeMapping.visual.end
            ) {
              ordinaryCompositionOrigin = {
                localCertificate,
                revision: documentSession.document.getRevision?.(),
                serializedVisual: baseline,
                source,
                sourceRange: nativeMapping.source,
                visual: mappingVisual,
                visualRange: nativeMapping.visual,
                textNode: nativeNode,
                textOffset: native.anchorOffset,
                textBefore: nativeNode.data
              };
            }
          }
        } catch (error) {
          rejectComposition();
          onFailure(visualEditorFailureCode(error, 'visual-editor-selection-map-failed'));
          return;
        }
      }
      composing = true;
      continuingUnmappedVisualInputRef.current = false;
      compositionCommitScheduled = false;
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
        visualInputTimerRef.current = null;
      }
    };
    const handleCompositionEnd = (event: CompositionEvent) => {
      if (cancelledPendingComposition) {
        cancelledPendingComposition = false;
        return;
      }
      if (pendingComposition) {
        const draft = pendingComposition;
        try {
          assertPendingCanonicalLease(draft.lease);
          finishPendingCompositionDom(surface.ownerDocument.activeElement === surface);
          if (event.data) {
            applyPendingCanonicalText(draft.lease, event.data, true);
            completedPendingComposition = { data: event.data, markdown: documentSession.document.getValue() };
          }
        } catch (error) {
          if (pendingComposition) {
            try { finishPendingCompositionDom(false); }
            catch (restoreError) { onFailure(visualEditorFailureCode(restoreError, 'visual-editor-canonical-change-dom-stale')); }
          }
          failPendingTransfer(visualEditorFailureCode(error, 'visual-editor-pending-selection-stale'));
        }
        return;
      }
      if (compositionRejected) {
        const selectionSnapshot = rejectedCompositionSelection;
        if (null !== visualInputTimerRef.current) {
          clearTimeout(visualInputTimerRef.current);
          visualInputTimerRef.current = null;
        }
        visualInputPendingRef.current = false;
        pendingUnmappedVisualInputRef.current = false;
        continuingUnmappedVisualInputRef.current = false;
        pendingVisualIntentRef.current = null;
        pendingVisualIntentResultRef.current = null;
        const restored = restoreAcceptedSnapshot();
        compositionRejected = false;
        composing = false;
        rejectedCompositionSelection = null;
        compositionCodeBodyContext = null;
        compositionCodeBodyCommit = false;
        compositionCodeBodyLocalPre = null;
        compositionCommitScheduled = false;
        const markdown = sourceMarkdownRef.current;
        if (
          !restored ||
          null === markdown ||
          !restoreVisualHistorySelection(surface, selectionSnapshot)
        ) {
          failVisualSynchronization(
            new Error('visual-editor-rejected-composition-restore-failed')
          );
          return;
        }
        recordCurrentVisualHistorySnapshot(markdown);
        return;
      }
      composing = false;
      if (compositionCommitScheduled) return;
      const compositionOrigin = ordinaryCompositionOrigin;
      ordinaryCompositionOrigin = null;
      const nativeWitness = (() => {
        const native = surface.ownerDocument.defaultView?.getSelection();
        return native?.anchorNode && native.focusNode
          ? {
              anchorNode: native.anchorNode,
              anchorOffset: native.anchorOffset,
              focusNode: native.focusNode,
              focusOffset: native.focusOffset
            }
          : null;
      })();
      const compositionSource = sourceMarkdownRef.current;
      const nativeAtEnd = surface.ownerDocument.defaultView?.getSelection();
      const expectedCommittedText = compositionOrigin
        ? compositionOrigin.textBefore.slice(0, compositionOrigin.textOffset)
          + event.data
          + compositionOrigin.textBefore.slice(compositionOrigin.textOffset)
        : '';
      const nativeOwnsOrigin = Boolean(
        compositionOrigin
        && nativeAtEnd?.isCollapsed
        && nativeAtEnd.anchorNode === compositionOrigin.textNode
        && compositionOrigin.textNode.isConnected
        && surface.contains(compositionOrigin.textNode)
        && compositionOrigin.textNode.data === expectedCommittedText
        && nativeAtEnd.anchorOffset >= compositionOrigin.textOffset
        && nativeAtEnd.anchorOffset
          <= compositionOrigin.textOffset + event.data.length
      );
      const compositionOriginCommit = (() => {
        if (
          !compositionOrigin
          || !nativeOwnsOrigin
          || ('' === event.data && !compositionOrigin.localCertificate)
          || null === compositionSource
          || compositionOrigin.source !== compositionSource
          || compositionOrigin.serializedVisual !== visualMarkdownRef.current
          || compositionOrigin.revision !==
            documentSession.document.getRevision?.()
        ) return undefined;
        const { sourceRange, visualRange } = compositionOrigin;
        if (
          sourceRange.start !== sourceRange.end
          || visualRange.start !== visualRange.end
          || !Number.isInteger(sourceRange.start)
          || !Number.isInteger(visualRange.start)
          || sourceRange.start < 0
          || sourceRange.start > compositionOrigin.source.length
          || visualRange.start < 0
          || visualRange.start > compositionOrigin.visual.length
        ) return undefined;
        return {
          insertionEnd: sourceRange.start + event.data.length,
          visualInsertionEnd: visualRange.start + event.data.length,
          value:
            compositionOrigin.source.slice(0, sourceRange.start)
            + event.data
            + compositionOrigin.source.slice(sourceRange.end),
          visual:
            compositionOrigin.visual.slice(0, visualRange.start)
            + event.data
            + compositionOrigin.visual.slice(visualRange.end)
        };
      })();
      if (compositionOrigin?.localCertificate && !compositionOriginCommit) {
        failVisualSynchronization(new Error('visual-editor-canonical-change-dom-stale'));
        return;
      }
      compositionCommitScheduled = true;
      const codeBodyContext = compositionCodeBodyContext;
      compositionCodeBodyContext = null;
      compositionCodeBodyLocalPre = codeBodyContext?.localPre ?? null;
      compositionCodeBodyCommit = Boolean(
        codeBodyContext && !codeBodyContext.localPre
      );
      queueMicrotask(() => {
        compositionCommitScheduled = false;
        // Reuse the same effect-local lifecycle gate as commitVisualInput.
        // The shared activeRef can belong to a newer activation; this queued
        // closure must never revive itself through it after its own teardown.
        if (
          !active
          || pendingTransferRef.current
          || externalChangeReportedRef.current
          || visualTransferFailureReportedRef.current
        ) {
          return;
        }
        const nativeAtSettlement = surface.ownerDocument.defaultView?.getSelection();
        const nativeUnmovedAtSettlement = Boolean(
          nativeAtSettlement
          && nativeWitness
          && nativeAtSettlement.anchorNode === nativeWitness.anchorNode
          && nativeAtSettlement.anchorOffset === nativeWitness.anchorOffset
          && nativeAtSettlement.focusNode === nativeWitness.focusNode
          && nativeAtSettlement.focusOffset === nativeWitness.focusOffset
        );
        let ownerCompositionSettlement: Readonly<{
          selection: VisualSelectionSourceRange;
          value: string;
          visualSelection: Readonly<{ end: number; start: number }>;
        }> | null = null;
        const localCertificate = compositionOrigin?.localCertificate ?? null;
        if (compositionOriginCommit && nativeUnmovedAtSettlement) {
          const pending = pendingVisualIntentResultRef.current;
          if (
            pending
            && pending.result.sourceMarkdown === compositionOriginCommit.value
          ) {
            const end = compositionOriginCommit.insertionEnd;
            pendingVisualIntentResultRef.current = {
              ...pending,
              memory: null,
              result: {
                ...pending.result,
                selection: { direction: 'none', start: end, end }
              }
            };
          }
        }
        if (
          compositionOriginCommit
          && compositionOrigin
          && localCertificate
          && !codeBodyContext
        ) {
          // This certificate describes the exact accepted source/visual pair
          // and revision observed at compositionstart. Do not overwrite either
          // one if another owner advanced it while this settlement was queued.
          if (
            sourceMarkdownRef.current !== compositionOrigin.source
            || visualMarkdownRef.current !== compositionOrigin.serializedVisual
            || compositionOrigin.revision !==
              documentSession.document.getRevision?.()
          ) return;
          let selection: VisualSelectionSourceRange;
          let visualSelection: Readonly<{ end: number; start: number }>;
          if (nativeUnmovedAtSettlement) {
            const end = compositionOriginCommit.insertionEnd;
            selection = { direction: 'none', start: end, end };
            visualSelection = {
              start: compositionOriginCommit.visualInsertionEnd,
              end: compositionOriginCommit.visualInsertionEnd
            };
          } else {
            if (
              !nativeAtSettlement
              || !(nativeAtSettlement.anchorNode instanceof Text)
              || !(nativeAtSettlement.focusNode instanceof Text)
            ) {
              failVisualSynchronization(
                new Error('visual-editor-selection-map-failed')
              );
              return;
            }
            try {
              const native = nativeAtSettlement;
              const anchorNode = nativeAtSettlement.anchorNode;
              const focusNode = nativeAtSettlement.focusNode;
              if (anchorNode === compositionOrigin.textNode
                && focusNode === compositionOrigin.textNode) {
                const text = compositionOrigin.textNode.data;
                const sourceAnchor = literalTextBoundary(text, native.anchorOffset,
                  compositionOriginCommit.value, localCertificate.sourceStart);
                const sourceFocus = literalTextBoundary(text, native.focusOffset,
                  compositionOriginCommit.value, localCertificate.sourceStart);
                if (null === sourceAnchor || null === sourceFocus) {
                  throw new Error('visual-editor-selection-map-failed');
                }
                selection = {
                  ...selectionRange(sourceAnchor, sourceFocus),
                  direction: nativeDocumentSelectionDirection(native)
                };
                visualSelection = selectionRange(
                  localCertificate.visualStart + native.anchorOffset,
                  localCertificate.visualStart + native.focusOffset
                );
              } else {
                const mapped = mapSelectionFromInterval(surface, {
                  anchorNode: anchorNode,
                  anchorOffset: native.anchorOffset,
                  focusNode: focusNode,
                  focusOffset: native.focusOffset
                }, compositionOriginCommit.visual, createVisualMarkdownSourceIntervalMap(
                  compositionOriginCommit.value, compositionOriginCommit.visual
                ), false);
                if (!mapped || !coversMarkdownUnits(compositionOriginCommit.value,
                  mapped.source.start, mapped.source.end)) {
                  throw new Error('visual-editor-selection-map-failed');
                }
                // An interval proposes offsets; the complete literal runs must
                // certify both endpoints before they can own a newer range.
                const backward = nativeDocumentSelectionDirection(native) === 'backward';
                for (const [node, offset, sourceOffset, visualOffset] of [
                  [anchorNode, native.anchorOffset,
                    backward ? mapped.source.end : mapped.source.start,
                    backward ? mapped.visual.end : mapped.visual.start],
                  [focusNode, native.focusOffset,
                    backward ? mapped.source.start : mapped.source.end,
                    backward ? mapped.visual.start : mapped.visual.end]
                ] as const) {
                  const raw = { start: offset, end: offset };
                  if (!literalTextBoundsAtSelection(node.data, raw, compositionOriginCommit.value,
                    { start: sourceOffset, end: sourceOffset })
                    || !literalTextBoundsAtSelection(node.data, raw, compositionOriginCommit.visual,
                      { start: visualOffset, end: visualOffset })) {
                    throw new Error('visual-editor-selection-map-failed');
                  }
                }
                selection = { ...mapped.source, direction: nativeDocumentSelectionDirection(native) };
                visualSelection = mapped.visual;
              }
            } catch (error) {
              failVisualSynchronization(error);
              return;
            }
          }
          try {
            // The native composition itself, before any canonical write, must
            // be exactly the source/visual pair certified at compositionstart.
            // The local owner root must still be the same connected DOM root;
            // any replacement or concurrent surface change is refused before
            // the canonical write.
            const serializedSurface = serializeVisualMarkdown(surface);
            const certificate = localCertificate;
            if (
              certificate.root !== compositionOrigin.textNode.parentElement
              || certificate.root.parentElement !== surface
              || !isPlainVisualTextBody(certificate.root, compositionOrigin.textNode)
              || !certificate.root.isConnected
            ) {
              failVisualSynchronization(
                new Error('visual-editor-canonical-change-dom-stale')
              );
              return;
            }
            let certifiedSurface = serializedSurface;
            if (certificate.formalWholeRow) {
              const literal = projectVisualLiteralParagraphLine(
                compositionOrigin.textNode.data,
                compositionOrigin.textNode.data.length
              );
              const first = serializedSurface.indexOf(compositionOrigin.textNode.data);
              if (
                literal
                && first >= 0
                && first === serializedSurface.lastIndexOf(compositionOrigin.textNode.data)
              ) {
                certifiedSurface = serializedSurface.slice(0, first)
                  + literal.markdown
                  + serializedSurface.slice(first + compositionOrigin.textNode.data.length);
              }
            }
            if (certifiedSurface !== compositionOriginCommit.visual) {
              failVisualSynchronization(
                new Error('visual-editor-local-change-mismatch')
              );
              return;
            }
          } catch (error) {
            failVisualSynchronization(error);
            return;
          }
          ownerCompositionSettlement = {
            selection,
            value: compositionOriginCommit.value,
            visualSelection
          };
        }
        const ownerCompositionLedger = ownerCompositionSettlement
          ? ownedLedgerRetains(Array.from(surface.childNodes))
          : null;
        if (ownerCompositionSettlement && !ownerCompositionLedger) {
          failVisualSynchronization(
            new Error('visual-editor-canonical-change-dom-stale')
          );
          return;
        }
        if (ownerCompositionSettlement) {
          if (null !== visualInputTimerRef.current) {
            clearTimeout(visualInputTimerRef.current);
            visualInputTimerRef.current = null;
          }
          visualInputPendingRef.current = false;
          pendingUnmappedVisualInputRef.current = false;
          continuingUnmappedVisualInputRef.current = false;
          pendingVisualIntentRef.current = null;
          pendingVisualIntentResultRef.current = null;
        }
        let committed = false;
        try {
          if (ownerCompositionSettlement && ownerCompositionLedger && compositionOrigin) {
            committed = synchronizeMarkdown({
              ownerResult: {
                historySelectionBefore: {
                  direction: 'none',
                  end: compositionOrigin.sourceRange.end,
                  start: compositionOrigin.sourceRange.start
                },
                ledger: ownerCompositionLedger,
                selection: ownerCompositionSettlement.selection,
                value: ownerCompositionSettlement.value
              }
            });
          } else if (
            !nativeUnmovedAtSettlement
            && compositionOriginCommit
            && compositionOrigin
            && !codeBodyContext
          ) {
            // Preserve the existing accepted block-id fallback. A newer native
            // selection is mapped by the ordinary synchronizer; the local
            // ownerResult branch above is intentionally unavailable here.
            pendingVisualIntentResultRef.current = null;
            committed = synchronizeMarkdown({
              mapSelectionWhenUnchanged: true,
              preferVisualSelection: true
            });
          } else {
            committed = commitVisualInput();
          }
        } finally {
          compositionCodeBodyCommit = false;
          compositionCodeBodyLocalPre = null;
        }
        if (
          !active
          || externalChangeReportedRef.current
          || visualTransferFailureReportedRef.current
        ) {
          return;
        }
        if (
          committed
          && nativeUnmovedAtSettlement
          && compositionOriginCommit
          && compositionOrigin
          && sourceMarkdownRef.current === compositionOriginCommit.value
        ) {
          try {
            const currentSelection = documentSession.document.getSelection?.();
            const end = compositionOriginCommit.insertionEnd;
            if (
              !currentSelection
              || currentSelection.start !== end
              || currentSelection.end !== end
            ) {
              applyDocumentChange({
                selection: { direction: 'none', start: end, end },
                value: sourceMarkdownRef.current
              });
              lastSelectionRef.current = {
                direction: 'none',
                start: end,
                end
              };
            }
          } catch (error) {
            failVisualSynchronization(error);
          }
          let settledNative = false;
          let originUsable = false;
          let nativeUnmoved = false;
          if (compositionOrigin) {
            const native = surface.ownerDocument.defaultView?.getSelection();
            const expectedText =
              compositionOrigin.textBefore.slice(0, compositionOrigin.textOffset)
              + event.data
              + compositionOrigin.textBefore.slice(compositionOrigin.textOffset);
            const insertionEnd =
              compositionOrigin.textOffset + event.data.length;
            nativeUnmoved = Boolean(
              native
              && nativeWitness
              && native.anchorNode === nativeWitness.anchorNode
              && native.anchorOffset === nativeWitness.anchorOffset
              && native.focusNode === nativeWitness.focusNode
              && native.focusOffset === nativeWitness.focusOffset
            );
            originUsable =
              compositionOrigin.textNode.isConnected
              && surface.contains(compositionOrigin.textNode)
              && compositionOrigin.textNode.data === expectedText;
            if (
              nativeUnmoved
              && originUsable
              && native?.isCollapsed
              && native.anchorNode === compositionOrigin.textNode
              && native.anchorOffset >= compositionOrigin.textOffset
              && native.anchorOffset < insertionEnd
            ) {
              native.collapse(compositionOrigin.textNode, insertionEnd);
              settledNative = true;
            }
          }
          if (!settledNative && nativeUnmoved && !originUsable) {
            try {
              const settledSource = sourceMarkdownRef.current;
              const settledEditMap = previewSnapshotRef.current.editMap;
              if (null === settledSource || !settledEditMap) {
                throw new Error('visual-editor-markdown-snapshot-missing');
              }
              placeVisualSelectionFromAcceptedSourceRange(
                surface,
                settledSource,
                settledEditMap,
                {
                  direction: 'none',
                  end: compositionOriginCommit.insertionEnd,
                  start: compositionOriginCommit.insertionEnd
                },
                null
              );
            } catch (error) {
              failVisualSynchronization(error);
            }
          }
        }
        if (
          committed
          && !visualTransferFailureReportedRef.current
          && ownerCompositionSettlement
          && ownerCompositionSettlement.selection.start ===
            ownerCompositionSettlement.selection.end
          && sourceMarkdownRef.current === ownerCompositionSettlement.value
        ) {
          visualSelectionMemoryRef.current = selectionMemoryForCurrentSelection(
            surface,
            {
              start: ownerCompositionSettlement.selection.start,
              end: ownerCompositionSettlement.selection.end
            },
            ownerCompositionSettlement.visualSelection
          );
        }
        if (!committed || !codeBodyContext) return;
        try {
          const sourceMarkdown = sourceMarkdownRef.current;
          const selection =
            codeBodyContext.code.ownerDocument.defaultView?.getSelection();
          const anchorNode = selection?.anchorNode;
          if (null === sourceMarkdown) {
            throw new Error('visual-editor-markdown-snapshot-missing');
          }
          if (!selection || !anchorNode) {
            throw new Error('visual-editor-code-body-selection-unavailable');
          }
          const interval = visualCodeBodyIntervalAtOrdinal(
            sourceMarkdown,
            codeBodyContext.codeOrdinal
          );
          const expectedBody = sourceMarkdown.slice(
            interval.bodyStart,
            interval.bodyEnd
          );
          const caretOffset = visualCodeBodyDomOffset(codeBodyContext.code, {
            node: anchorNode,
            offset: selection.anchorOffset
          });
          if (null === caretOffset) {
            throw new Error('visual-editor-code-body-selection-invalid');
          }
          reconcileVisualCodeBodyDom(
            codeBodyContext.code,
            expectedBody,
            caretOffset
          );
          acceptedHtmlRef.current = surface.innerHTML;
          acceptedNodesRef.current = Array.from(surface.childNodes);
          acceptedCodeBodySnapshotsRef.current.clear();
          acceptedLocalCodeBodiesRef.current = visualLocalCodeBodyRecords();
          appendVisualHistoryTransition(
            codeBodyContext.historyBefore,
            captureVisualHistorySnapshot(sourceMarkdown, surface.innerHTML)
          );
        } catch (error) {
          failVisualSynchronization(error);
        }
      });
    };
    const handleBeforeInput = (event: InputEvent) => {
      // A history command is not an edit gesture: it must first SETTLE the
      // pending edit whose pre-edit selection it is about to undo. Clearing or
      // replacing that operation's witness here would record the transient
      // post-edit caret instead of the user's deleted range. The flush below
      // consumes the witness; only a non-history event starts a new one.
      const historyCommand =
        'historyUndo' === event.inputType || 'historyRedo' === event.inputType;
      pendingVisualEmptyStructuralInputRef.current = null;
      continuingUnmappedVisualInputRef.current = false;
      if (!historyCommand) pendingEditSelectionBeforeRef.current = null;
      if (
        !historyCommand &&
        null === pendingTransferRef.current &&
        event.cancelable &&
        !event.isComposing
      ) {
        const nativeSelection = surface.ownerDocument.defaultView?.getSelection();
        if (
          nativeSelection &&
          nativeSelection.rangeCount === 1 &&
          nativeSelection.anchorNode &&
          nativeSelection.focusNode &&
          surface.contains(nativeSelection.anchorNode) &&
          surface.contains(nativeSelection.focusNode)
        ) {
          pendingEditSelectionBeforeRef.current = {
            anchorNode: nativeSelection.anchorNode,
            anchorOffset: nativeSelection.anchorOffset,
            certifiedInsideSurface: true,
            focusNode: nativeSelection.focusNode,
            focusOffset: nativeSelection.focusOffset
          };
        }
      }
      if (compositionRejected) {
        event.preventDefault();
        return;
      }
      if (cancelledPendingComposition && (event.isComposing || event.inputType.includes('Composition'))) {
        if (event.cancelable) event.preventDefault();
        else failPendingTransfer('visual-editor-beforeinput-not-cancelable');
        return;
      }
      if (completedPendingComposition && event.inputType === 'insertFromComposition' &&
          event.data === completedPendingComposition.data && sourceMarkdownRef.current === completedPendingComposition.markdown) {
        if (event.cancelable) event.preventDefault();
        else failPendingTransfer('visual-editor-beforeinput-not-cancelable');
        completedPendingComposition = null;
        return;
      }
      completedPendingComposition = null;
      // Capture a cross-root native deletion before the empty-paragraph owner
      // can classify the caret. The raw target range is the operation witness;
      // the paragraph-specific path below must not consume an H1/P join first.
      if (
        'deleteContentBackward' === event.inputType
        && !pendingTransferRef.current
        && !composing
        && !event.isComposing
        && !pendingComposition
      ) {
        if (pendingNativeOperationRef.current && visualInputPendingRef.current) {
          if (!flushVisualInput()) {
            event.preventDefault();
            return;
          }
        }
        const joinSource = sourceMarkdownRef.current;
        const joinVisual = visualMarkdownRef.current;
        if (null !== joinSource && null !== joinVisual) {
          captureNativeRootJoin(event, joinSource, joinVisual);
        }
      }
      // An empty paragraph has an element caret, not a Text caret. Its native
      // cross-block deletion therefore cannot use the ordinary text intent.
      // Consume only the exact owned P0 -> preceding text-tail transition.
      if ('deleteContentBackward' === event.inputType && !pendingTransferRef.current
        && !composing && !event.isComposing && !pendingComposition) {
        const native = surface.ownerDocument.defaultView?.getSelection();
        const gap = native?.anchorNode;
        const target = event.getTargetRanges?.()[0];
        if (pendingNativeOperationRef.current?.kind !== 'join' && native?.isCollapsed && gap instanceof HTMLParagraphElement
          && native.anchorOffset === 0 && gap.parentNode === surface
          && gap.childNodes.length === 1 && gap.firstChild instanceof HTMLBRElement
          && target?.startContainer instanceof Text && target.endContainer === gap
          && target.endOffset === 0 && target.startOffset === target.startContainer.length
          && !target.startContainer.parentElement?.closest('pre, code, [contenteditable="false"]')
          && directVisualBlockForSelectionNode(surface, target.startContainer) === gap.previousElementSibling) {
          event.preventDefault();
          try {
            if (!event.cancelable) throw new Error('visual-editor-beforeinput-not-cancelable');
            if (!flushVisualInput()) return;
            const source = sourceMarkdownRef.current;
            const visual = visualMarkdownRef.current;
            const owned = ownedDomRef.current;
            const nodes = Array.from(surface.childNodes);
            const serializedSurface = serializeVisualMarkdown(surface);
            // The renderer's terminal empty paragraph is not always spelled by
            // the serializer, while the accepted visual keeps its blank line.
            // That one trailing spelling difference is not a stale surface.
            const terminalEmptyParagraphSpelling =
              null !== visual &&
              null === gap.nextElementSibling &&
              serializedSurface === visual.replace(/(?:\r\n|\r|\n){2}$/u, '');
            if (source === null || visual === null || !owned || !ownedLedgerRetains(nodes)
              || owned.source !== source || owned.sourceRevision !== (documentSession.document.getRevision?.() ?? 0)
              || documentSession.document.getValue() !== source
              || (serializedSurface !== visual && !terminalEmptyParagraphSpelling)) {
              throw new Error('visual-editor-canonical-change-dom-stale');
            }
            const boundary = mapTextBoundaryFromInterval(surface, target.startContainer,
              target.startOffset, visual, createVisualMarkdownSourceIntervalMap(source, visual), false);
            if (!boundary) throw new Error('visual-editor-selection-map-failed');
            const next = gap.nextElementSibling;
            const separator = fullNativeJoinSeparator(
              source,
              boundary.sourceOffset,
              Boolean(next)
            );
            if (!separator || (next && separator.end > source.length)) {
              throw new Error('visual-editor-selection-map-failed');
            }
            const value = source.slice(0, boundary.sourceOffset)
              + (next
                ? separator.lineEnding + separator.lineEnding
                : '')
              + source.slice(separator.end);
            const selection = { direction: 'none' as const, start: boundary.sourceOffset, end: boundary.sourceOffset };
            gap.remove();
            native.setBaseAndExtent(target.startContainer, target.startOffset, target.startContainer, target.startOffset);
            const retained = nodes.filter((node) => node !== gap);
            synchronizeMarkdown({ ownerResult: { value, selection,
              ledger: { nodes: retained, metadata: retained.map(fullOwnedNodeMetadata) } } });
          } catch (error) { failVisualSynchronization(error); }
          return;
        }
      }
      if (pendingComposition) {
        if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
          if (!event.cancelable) {
            cancelledPendingComposition = true;
            failPendingTransfer('visual-editor-beforeinput-not-cancelable');
            return;
          }
          event.preventDefault();
          cancelledPendingComposition = true;
          try { finishPendingCompositionDom(surface.ownerDocument.activeElement === surface); runHistory(event.inputType === 'historyRedo'); }
          catch (error) { failPendingTransfer(visualEditorFailureCode(error, 'visual-editor-pending-selection-stale')); }
          return;
        }
        if (event.isComposing || event.inputType.includes('Composition')) return;
        invalidatePendingInputSelection();
      }
            if (pendingTransferRef.current) {
        if (event.cancelable) event.preventDefault();
        const sourceBefore = documentSession.document.getValue();
        try {
          if (!event.cancelable) throw new Error('visual-editor-beforeinput-not-cancelable');
          if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
            runHistory(event.inputType === 'historyRedo');
            return;
          }
          if ((event.inputType !== 'insertText' && event.inputType !== 'insertReplacementText' && event.inputType !== 'insertLineBreak') ||
              (event.inputType !== 'insertLineBreak' && event.data === null)) throw new Error('visual-editor-pending-input-unavailable');
          const lease = pendingInputLease(event);
          const text = event.inputType === 'insertLineBreak' ? '\n' : event.data ?? '';
                    if (!applyStructuralPendingCanonicalText(lease, text)) {
            applyPendingCanonicalText(lease, text, true);
          }
        } catch (error) {
                    const code = visualEditorFailureCode(error, 'visual-editor-pending-input-unavailable');
          if (!event.cancelable || documentSession.document.getValue() !== sourceBefore) failPendingTransfer(code);
          else onFailure(code);
        }
        return;
      }
      const isHistoryInput =
        'historyUndo' === event.inputType || 'historyRedo' === event.inputType;
      if (
        !isHistoryInput
        && !composing
        && !event.isComposing
        && ('insertText' === event.inputType
          || 'insertReplacementText' === event.inputType)
        && null !== event.data
      ) {
        // Only a surface-anchored caret beside a direct-child break can be a
        // structural gap, so the accepted-surface certificate below is never
        // paid for on an ordinary in-block keystroke.
        const caretSelection = surface.ownerDocument.defaultView?.getSelection();
        const caretOffset = caretSelection?.anchorOffset ?? -1;
        const caretBesideBreak = Boolean(
          caretSelection?.isCollapsed
          && caretSelection.anchorNode === surface
          && caretSelection.focusNode === surface
          && (surface.childNodes[caretOffset] instanceof HTMLHRElement
            || surface.childNodes[caretOffset - 1] instanceof HTMLHRElement)
        );
        // The gap certificate is only as strong as the ready state it is read
        // from: canonical source, the accepted top-level child identity,
        // order and content, and the protected snapshot must all still match,
        // or a same-ID replacement row would be admitted.
        let structural: Readonly<{
          canonical: VisualSelectionSourceRange;
          gap: NonNullable<ReturnType<typeof visualStructuralBoundaryCapture>>;
          source: string;
        }> | null = null;
        if (caretBesideBreak) try {
          const source = sourceMarkdownRef.current;
          const canonical = documentSession.document.getSelection?.();
          const editMap = previewSnapshotRef.current.editMap;
          if (
            null === source
            || !canonical
            || documentSession.document.getValue() !== source
            || !editMap
            || editMap.signature !== previewSnapshotRef.current.signature
            || 'none' !== canonical.direction
            || canonical.start !== canonical.end
          ) {
            throw new Error('visual-editor-selection-map-failed');
          }
          const readOnly = readOnlySnapshotRef.current;
          if (!readOnly) throw new Error('visual-editor-read-only-snapshot-missing');
          assertVisualMarkdownReadOnlySnapshot(surface, readOnly);
          assertAcceptedTopLevelVisualSurface(surface, editMap, acceptedHtmlRef.current, acceptedNodesRef.current);
          // The whole event target must still name the one collapsed native
          // point: multiple ranges or any non-collapsed endpoint belong to
          // another owner (replacement included), never this boundary.
          const targets = event.getTargetRanges?.() ?? [];
          const native = surface.ownerDocument.defaultView?.getSelection();
          const nativeRange = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
          if (
            !native?.isCollapsed
            || !nativeRange?.collapsed
            || native.anchorNode !== surface
            || native.focusNode !== surface
            || native.anchorOffset !== native.focusOffset
            || targets.length > 1
            || (targets[0]
              && (!targets[0].collapsed
                || targets[0].startContainer !== native.anchorNode
                || targets[0].startOffset !== native.anchorOffset
                || targets[0].endContainer !== native.anchorNode
                || targets[0].endOffset !== native.anchorOffset))
          ) {
            throw new Error('visual-editor-selection-map-failed');
          }
          const gap = visualStructuralBoundaryCapture(
            surface,
            source,
            visualStructuralBoundarySurfaceBlocks(surface, source, editMap),
            canonical.start
          );
          if (gap) structural = { canonical, gap, source };
        } catch {
          structural = null;
        }
        if (!structural) {
          // A surface-anchored caret directly beside a direct-child break is
          // that structural boundary or nothing. Once its certificate fails
          // (a replaced or mutated accepted row), the generic text owner must
          // not guess a nearby position and write.
          const native = surface.ownerDocument.defaultView?.getSelection();
          if (
            native?.isCollapsed
            && native.anchorNode === surface
            && native.focusNode === surface
            && native.anchorOffset === native.focusOffset
          ) {
            const offset = native.anchorOffset;
            const after = surface.childNodes[offset] ?? null;
            const before = offset > 0 ? (surface.childNodes[offset - 1] ?? null) : null;
            if (after instanceof HTMLHRElement || before instanceof HTMLHRElement) {
              if (event.cancelable) event.preventDefault();
              onFailure('visual-editor-selection-map-failed');
              return;
            }
          }
        }
        if (structural) {
          const { canonical, gap, source } = structural;
          // The structural owner consumes this key before any native
          // mutation, so the break keeps its own line and the typed text
          // lands in a real paragraph. A noncancelable event must not let the
          // browser mutate the certified gap.
          if (!event.cancelable) {
            onFailure('visual-editor-beforeinput-not-cancelable');
            return;
          }
          event.preventDefault();
          if (
            null === source
            || !applyStructuralCanonicalText(source, canonical, gap, event.data)
          ) {
            onFailure('visual-editor-structural-input-unavailable');
          }
          return;
        }
      }
      const selectedCodePre = selectedVisualCodeBlock(surface);
      let pendingVisual = pendingVisualIntentResultRef.current;
      let pendingCodeStructure = pendingVisual?.codeBlockStructure;
      const pendingMemory = pendingVisual?.memory;
      const pendingMemoryConnected = Boolean(
        pendingMemory?.anchorNode.isConnected &&
          pendingMemory.focusNode.isConnected &&
          surface.contains(pendingMemory.anchorNode) &&
          surface.contains(pendingMemory.focusNode)
      );
      if (
        !isHistoryInput &&
        !composing &&
        !event.isComposing &&
        pendingVisual &&
        !pendingVisual.codeBlockStructure &&
        (!pendingMemoryConnected ||
          (event.inputType.startsWith('insert') &&
            visualStructuralBodyIsEmpty(surface))) &&
        !flushVisualInput()
      ) {
        event.preventDefault();
        return;
      }
      pendingVisual = pendingVisualIntentResultRef.current;
      pendingCodeStructure = pendingVisual?.codeBlockStructure;
      let pendingCodeInputCanContinue = Boolean(
        pendingCodeStructure?.preserving &&
          selectedCodePre &&
          visualBlockIdForPre(selectedCodePre, surface) ===
            pendingCodeStructure.blockId
      );
      let pendingCodeInputOrdinal: number | null = null;
      if (pendingCodeStructure && selectedCodePre && pendingVisual) {
        const localBlock = captureVisualCodeInputSnapshot(selectedCodePre);
        if (pendingCodeStructure.localPre === selectedCodePre) {
          const provenance =
            visualLocalCodeBodyProvenanceRef.current.get(selectedCodePre);
          if (!localBlock || !provenance) {
            event.preventDefault();
            failVisualSynchronization(
              new Error('visual-editor-code-body-map-stale')
            );
            return;
          }
          try {
            validateLocalVisualCodeBody(
              localBlock,
              pendingVisual.result.sourceMarkdown,
              provenance
            );
            pendingCodeInputCanContinue = true;
          } catch (error) {
            event.preventDefault();
            failVisualSynchronization(error);
            return;
          }
        } else if (
          localBlock &&
          visualBlockIdForPre(selectedCodePre, surface) ===
            pendingCodeStructure.blockId
        ) {
          const sourceTopologyChanged =
            visualCodeBlockStructureSignature(
              pendingVisual.result.sourceMarkdown
            ) !==
            visualCodeBlockStructureSignature(
              pendingCodeStructure.baseMarkdown
            );
          if (sourceTopologyChanged) {
            try {
              const expansion = pendingCodeFenceExpansion(
                pendingVisual,
                localBlock
              );
              if (!expansion) {
                throw new Error('visual-editor-code-body-map-stale');
              }
              pendingCodeInputCanContinue = true;
              pendingCodeInputOrdinal = pendingCodeStructure.codeOrdinal;
            } catch (error) {
              event.preventDefault();
              failVisualSynchronization(error);
              return;
            }
          } else {
            try {
              pendingCodeInputCanContinue =
                codeOrdinalForInputBlock(
                  localBlock,
                  pendingVisual.result.sourceMarkdown,
                  true
                ) === pendingCodeStructure.codeOrdinal;
            } catch (error) {
              event.preventDefault();
              failVisualSynchronization(error);
              return;
            }
          }
        }
        if (!localBlock) {
          event.preventDefault();
          failVisualSynchronization(
            new Error('visual-editor-code-body-map-stale')
          );
          return;
        }
      }
      if (
        !isHistoryInput &&
        pendingCodeStructure &&
        !selectedCodePre &&
        !selectedVisualCodeBlock(surface)
      ) {
        if (!flushVisualInput()) {
          event.preventDefault();
          return;
        }
        pendingVisual = pendingVisualIntentResultRef.current;
        pendingCodeStructure = pendingVisual?.codeBlockStructure;
      }
      if (
        !isHistoryInput &&
        selectedCodePre &&
        visualInputPendingRef.current &&
        !pendingCodeInputCanContinue
      ) {
        if (!flushVisualInput()) {
          event.preventDefault();
          return;
        }
      }
      visualInputBlock = null;
      visualInputCodeOrdinal = null;
      pendingVisualIntentRef.current = null;
      const hasHistoryOwner =
        'function' === typeof documentSession.document.undo &&
        'function' === typeof documentSession.document.redo;
      if (isHistoryInput && hasHistoryOwner) {
        event.preventDefault();
        if (!flushVisualInput()) {
          return;
        }
        try {
          const historyState = documentHistoryState(documentSession.document);
          if (
            'historyRedo' === event.inputType
              ? historyState.redoDepth > 0
              : historyState.undoDepth > 0
          ) {
            runHistory('historyRedo' === event.inputType);
          }
        } catch (error) {
          failVisualSynchronization(error);
        }
        return;
      }
      if (visualTransferFailureReportedRef.current) {
        event.preventDefault();
        return;
      }
      if (composing || event.isComposing) {
        return;
      }
      if (
        VISUAL_WHOLE_DOCUMENT_DELETION_TYPES.has(event.inputType) &&
        selectionCoversVisualSurface(surface)
      ) {
        event.preventDefault();
        if (!flushVisualInput()) return;
        if (!selectionCoversVisualSurface(surface)) {
          onFailure('visual-editor-whole-document-selection-stale');
          return;
        }
        clearWholeVisualDocument();
        return;
      }
      const continuesUnmappedInput = Boolean(
        visualInputPendingRef.current &&
          pendingUnmappedVisualInputRef.current &&
          !pendingVisualIntentResultRef.current
      );
      if (continuesUnmappedInput && !flushVisualInput()) {
        event.preventDefault();
        return;
      }
      if (continuesUnmappedInput) {
        continuingUnmappedVisualInputRef.current = true;
      }
      // A native EOF join is a structural default with its own witness. It is
      // captured before the selection-memory gate: a paragraph emptied to a
      // single BR no longer provides the identity memory that gate needs.
      if (
        'deleteContentBackward' === event.inputType &&
        !event.defaultPrevented
      ) {
        const joinSource = sourceMarkdownRef.current;
        const joinVisual = visualMarkdownRef.current;
        if (null !== joinSource && null !== joinVisual) {
          captureNativeRootJoin(event, joinSource, joinVisual);
        }
      }
      if (
        'insertParagraph' === event.inputType &&
        'end' === acceptedPasteDocumentBoundaryRef.current
      ) {
        const sourceMarkdown = sourceMarkdownRef.current;
        if (null === sourceMarkdown) {
          event.preventDefault();
          onFailure('visual-editor-markdown-snapshot-missing');
          return;
        }
        try {
          if (
            placeVisualCaretAfterAcceptedCodeFenceAtDocumentEnd(
              surface,
              sourceMarkdown,
              'end'
            )
          ) {
            event.preventDefault();
            captureSnapshot(sourceMarkdown);
            return;
          }
        } catch (error) {
          event.preventDefault();
          failVisualSynchronization(error);
          return;
        }
      }
      try {
        visualInputBlock = captureVisualCodeInputSnapshot(
          selectedVisualCodeBlock(surface)
        );
      } catch (error) {
        event.preventDefault();
        onFailure(
          visualEditorFailureCode(error, 'visual-editor-code-shape-invalid')
        );
        return;
      }
      try {
        normalizeVisualCaretAtDocumentBoundary(surface);
      } catch (error) {
        event.preventDefault();
        onFailure(
          visualEditorFailureCode(error, 'visual-editor-selection-map-failed')
        );
        return;
      }
      const memory =
        pendingVisualIntentResultRef.current?.memory ??
        visualSelectionMemoryRef.current;
      const base = pendingVisualIntentResultRef.current?.result;
      let sourceMarkdown = base?.sourceMarkdown ?? sourceMarkdownRef.current;
      let visualMarkdown = base?.visualMarkdown ?? visualMarkdownRef.current;
      let codeBodyIntervalInventory: Readonly<{
        source: ReadonlyMap<number, VisualCodeBodyInterval>;
        visual: ReadonlyMap<number, VisualCodeBodyInterval>;
      }> | undefined;
      const intervalInventoryForCodeInput = (): typeof codeBodyIntervalInventory => {
        if (codeBodyIntervalInventory || null === sourceMarkdown || null === visualMarkdown) {
          return codeBodyIntervalInventory;
        }
        codeBodyIntervalInventory = {
          source: visualCodeBodyIntervalMap(sourceMarkdown),
          visual: visualCodeBodyIntervalMap(visualMarkdown)
        };
        return codeBodyIntervalInventory;
      };
      let intervalMapRecord = visualSourceIntervalMapRef.current;
      let sourceIntervalMap =
        intervalMapRecord
        && intervalMapRecord.sourceMarkdown === sourceMarkdown
        && intervalMapRecord.visualMarkdown === visualMarkdown
          ? intervalMapRecord.map
          : null;
      const hasValidOwnedEmptyParagraph = (): boolean => {
        const gap = ownedEmptyParagraphRef.current;
        if (!gap || null === sourceMarkdown || null === visualMarkdown
          || gap.owner !== fullOwnerRef.current
          || gap.body.parentElement !== surface
          || gap.body.childNodes.length !== 1
          || !(gap.body.firstChild instanceof HTMLBRElement)
          || gap.source !== sourceMarkdown
          || documentSession.document.getValue() !== sourceMarkdown
          || gap.revision !== documentSession.document.getRevision?.()
          || !ownedLedgerRetains(Array.from(surface.childNodes))) return false;
        return gap.sourceLength === 0
          ? coversMarkdownUnits(sourceMarkdown, gap.sourceOffset, gap.sourceOffset)
          : sourceMarkdown.slice(gap.sourceOffset, gap.sourceOffset + 2) === '  ';
      };
      // A map only ever projects the pair it was created from: any other
      // pending source or baseline means this boundary is unmapped.
      if (!memory && !sourceIntervalMap) {
        if (!visualBaselineMaterializedRef.current) {
          try {
            materializeVisualBaseline();
          } catch (error) {
            event.preventDefault();
            onFailure(
              visualEditorFailureCode(
                error,
                'visual-editor-markdown-baseline-failed'
              )
            );
            return;
          }
          sourceMarkdown = sourceMarkdownRef.current;
          visualMarkdown = visualMarkdownRef.current;
          intervalMapRecord = visualSourceIntervalMapRef.current;
          sourceIntervalMap =
            intervalMapRecord
            && intervalMapRecord.sourceMarkdown === sourceMarkdown
            && intervalMapRecord.visualMarkdown === visualMarkdown
              ? intervalMapRecord.map
              : null;
        }
        if (!hasValidOwnedEmptyParagraph()) return;
      }
      if (null === sourceMarkdown || null === visualMarkdown) return;
      try {
        const readOnlySnapshot = readOnlySnapshotRef.current;
        if (readOnlySnapshot) {
          assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
        }
      } catch (error) {
        event.preventDefault();
        failVisualSynchronization(error);
        return;
      }
      // A native paragraph split is the one structural default this owner
      // lets the browser perform. Its provenance is captured here, before the
      // default runs, because afterwards the split is indistinguishable from a
      // foreign DOM mutation. Any other input clears the record so no later
      // flush can borrow a stale split.
      if ('insertParagraph' === event.inputType) {
        pendingNativeOperationRef.current = null;
        if (visualInputPendingRef.current && !flushVisualInput()) {
          event.preventDefault();
          return;
        }
        const skippedCodeBody = Boolean(
          visualInputBlock ?? selectedVisualCodeBlock(surface)
        );
        if (!skippedCodeBody && !event.defaultPrevented) {
          captureNativeRootTransition(event, sourceMarkdown, visualMarkdown);
        } else {
          pendingNativeOperationRef.current = null;
        }
      } else if ('deleteContentBackward' === event.inputType) {
        // The join witness, when one applies, was captured before the
        // selection-memory gate; only the split record is unrelated here.
        if ('split' === pendingNativeOperationRef.current?.kind) {
          pendingNativeOperationRef.current = null;
        }
      } else {
        pendingNativeOperationRef.current = null;
      }
      const blankCodeInput = Boolean(
        visualInputBlock &&
          (visualInputBlock.placeholder
            ? true
            : /^\n*$/.test(
                normalizeCodeLineEndings(visualInputBlock.codeText)
              )) &&
          [
            'deleteContentBackward',
            'deleteContentForward',
            'insertCompositionText',
            'insertLineBreak',
            'insertParagraph',
            'insertReplacementText',
            'insertText'
          ].includes(event.inputType)
      );
      let historyBefore: VisualHistorySnapshot | undefined;
      // The debounce group's operation-level pre-edit caret witness, captured
      // while the surface still shows the accepted render this input starts
      // from; it is carried to the commit that retires that history slot.
      let historySelectionWitness: VisualHistorySelectionWitness | undefined;
      if (visualInputBlock) {
        try {
          visualInputCodeOrdinal =
            pendingCodeInputOrdinal ??
            codeOrdinalForInputBlock(visualInputBlock, sourceMarkdown);
          if (null !== visualInputCodeOrdinal) {
            historyBefore =
              pendingVisualIntentResultRef.current?.historyBefore ??
              captureVisualHistorySnapshot(sourceMarkdown, surface.innerHTML);
          }
        } catch (error) {
          event.preventDefault();
          visualInputCodeOrdinal = null;
          failVisualSynchronization(error);
          return;
        }
      }
      const codeBodyLineBreakInput = Boolean(
        visualInputBlock &&
          ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
      );
      if ((blankCodeInput || codeBodyLineBreakInput) && visualInputBlock) {
        try {
          const codeOrdinal =
            null !== visualInputCodeOrdinal
              ? visualInputCodeOrdinal
              : codeOrdinalForInputBlock(
                  visualInputBlock,
                  sourceMarkdown,
                  true
                );
          if (null === codeOrdinal) {
            throw new Error('visual-editor-code-body-map-ambiguous');
          }
          pendingVisualIntentRef.current = visualCodeBodyInputIntent(
            event,
            visualInputBlock,
            sourceMarkdown,
            visualMarkdown,
            codeOrdinal,
            intervalInventoryForCodeInput()
          );
        } catch (error) {
          event.preventDefault();
          pendingVisualIntentRef.current = null;
          visualInputBlock = null;
          visualInputCodeOrdinal = null;
          failVisualSynchronization(error);
          return;
        }
      } else {
        try {
          const gap = ownedEmptyParagraphRef.current;
          const owned = ownedDomRef.current;
          const plainBody = gap && gap.owner === fullOwnerRef.current && gap.body.parentElement === surface
            && gap.body.childNodes.length === 1 && gap.body.firstChild instanceof HTMLBRElement
            && gap.source === sourceMarkdown && documentSession.document.getValue() === sourceMarkdown
            && gap.revision === documentSession.document.getRevision?.()
            && (gap.sourceLength === 0
              ? coversMarkdownUnits(sourceMarkdown, gap.sourceOffset, gap.sourceOffset)
              : sourceMarkdown.slice(gap.sourceOffset, gap.sourceOffset + 2) === '  ')
            && owned?.source === sourceMarkdown && ownedLedgerRetains(Array.from(surface.childNodes))
            && fullOwnedDomMatches(surface, owned) ? gap : undefined;
          const emptyStructuralInput = visualEmptyStructuralInputIntent(
            surface,
            event,
            sourceMarkdown,
            visualMarkdown,
            plainBody
          );
          if (emptyStructuralInput) {
            const committedSourceMarkdown = sourceMarkdownRef.current;
            if (
              null === committedSourceMarkdown ||
              committedSourceMarkdown !== sourceMarkdown ||
              documentSession.document.getValue() !== committedSourceMarkdown
            ) {
              throw new Error('visual-editor-history-document-stale');
            }
            applyDocumentChange({
              selection: {
                direction: 'none',
                end: emptyStructuralInput.sourceSelection.start,
                start: emptyStructuralInput.sourceSelection.start
              },
              value: sourceMarkdown
            });
            if (
              documentSession.document.getValue() !== committedSourceMarkdown
            ) {
              throw new Error('visual-editor-history-document-stale');
            }
            const historyAfterStructuralPreparation =
              documentHistoryState(documentSession.document);
            const historySelectionBefore: VisualSelectionSourceRange = {
              direction: 'none',
              end: emptyStructuralInput.sourceSelection.start,
              start: emptyStructuralInput.sourceSelection.start
            };
            const historyGroupOrigin = owned
              && owned.owner === fullOwnerRef.current
              && owned.source === sourceMarkdown
              && documentSession.document.getValue() === owned.source
              && owned.sourceRevision === documentSession.document.getRevision?.()
              && ownedLedgerRetains(Array.from(surface.childNodes))
                ? {
                    historyRedoDepth: historyAfterStructuralPreparation.redoDepth,
                    historySelectionBefore,
                    historyUndoDepth: historyAfterStructuralPreparation.undoDepth,
                    owned
                  }
                : undefined;
            lastSelectionRef.current = {
              direction: 'none',
              end: emptyStructuralInput.sourceSelection.start,
              start: emptyStructuralInput.sourceSelection.start
            };
            pendingVisualEmptyStructuralInputRef.current = {
              ...emptyStructuralInput,
              ...(historyGroupOrigin ? { historyGroupOrigin } : {}),
              historyBefore: captureVisualHistorySnapshot(
                sourceMarkdown,
                surface.innerHTML
              ),
              historyOrigin: 'empty-structural'
            };
          }
        } catch (error) {
          event.preventDefault();
          failVisualSynchronization(error);
          return;
        }
        const nativeSelection = surface.ownerDocument.defaultView?.getSelection();
        const nativeTargetRange = event.getTargetRanges?.()[0];
        // The interval map aligns the whole document, so it is built only when
        // a projection actually asks for it. Selection memory answers ordinary
        // linear input on its own, which keeps consecutive typing free of the
        // document-wide diff this owner must not run per keystroke.
        let effectiveSourceIntervalMap = sourceIntervalMap;
        const intervalMapFor = () => {
          if (!effectiveSourceIntervalMap) {
            effectiveSourceIntervalMap = createVisualMarkdownSourceIntervalMap(
              sourceMarkdown,
              visualMarkdown
            );
            visualSourceIntervalMapRef.current = {
              map: effectiveSourceIntervalMap,
              sourceMarkdown,
              visualMarkdown
            };
          }
          return effectiveSourceIntervalMap;
        };
        // A baseline that is not this surface's own serialization (the
        // accepted-paste record) admits boundaries only behind the DOM prefix.
        const acceptedPrefixOnly = !visualBaselineMaterializedRef.current;
        const localLiteralCertificate = (() => {
          const nativeSelection = surface.ownerDocument.defaultView?.getSelection();
          const nativeNode = nativeSelection?.anchorNode;
          const nativeRoot = directVisualBlockForSelectionNode(
            surface,
            nativeNode ?? null
          );
          const owned = ownedDomRef.current;
          const pendingPair = pendingVisualIntentResultRef.current;
          const localBoundaryCertificate = nativeNode instanceof Text
            ? localVisualBoundaryCertificate(
                surface,
                sourceMarkdown,
                visualMarkdown,
                nativeNode,
                memory
              )
            : null;
          const pendingWitness = pendingPair?.historySelectionWitness;
          const historyState = documentHistoryState(documentSession.document);
          const pendingWitnessOwnsOrigin = Boolean(
            pendingWitness
            && owned
            && pendingWitness.sourceMarkdown === owned.source
            && pendingWitness.revision === owned.sourceRevision
            && pendingWitness.acceptedHtml === acceptedHtmlRef.current
            && pendingWitness.acceptedPreview.signature === previewSnapshotRef.current.signature
            && pendingWitness.acceptedPreview.revision === previewSnapshotRef.current.revision
            && pendingWitness.acceptedPreview.mapped === Boolean(previewSnapshotRef.current.editMap)
            && pendingWitness.historyState.undoDepth === historyState.undoDepth
            && pendingWitness.historyState.redoDepth === historyState.redoDepth
          );
          const pendingGroupOriginOwnsOrigin = Boolean(
            pendingPair?.historyGroupOrigin
            && owned
            && pendingPair.historyGroupOrigin.owned === owned
            && owned.owner === fullOwnerRef.current
            && pendingPair.historyGroupOrigin.historyUndoDepth === historyState.undoDepth
            && pendingPair.historyGroupOrigin.historyRedoDepth === historyState.redoDepth
            && sourceMarkdownRef.current === owned.source
            && documentSession.document.getValue() === owned.source
            && owned.sourceRevision === documentSession.document.getRevision?.()
            && ownedLedgerRetains(Array.from(surface.childNodes))
          );
          const deferredSourcePair = Boolean(
            pendingPair?.deferSourceChange
            && pendingPair.historyOrigin === 'empty-structural'
            && pendingGroupOriginOwnsOrigin
            && pendingPair.memory === memory
            && pendingPair.baseSourceMarkdown === owned?.source
            && pendingPair.result.sourceMarkdown === sourceMarkdown
            && pendingPair.result.visualMarkdown === visualMarkdown
            && localBoundaryCertificate !== null
          );
          const ownedSourcePair = Boolean(
            owned
            && (
              (
                owned.source === sourceMarkdown
                && owned.visual === visualMarkdown
                && documentSession.document.getValue() === sourceMarkdown
              )
              || (
                pendingPair
                && (!pendingPair.deferSourceChange || deferredSourcePair)
                && pendingPair.memory === memory
                && (pendingPair.baseSourceMarkdown === owned.source
                  || pendingWitnessOwnsOrigin
                  || pendingGroupOriginOwnsOrigin)
                && documentSession.document.getValue() === owned.source
                && pendingPair.result.sourceMarkdown === sourceMarkdown
                && pendingPair.result.visualMarkdown === visualMarkdown
                && localBoundaryCertificate !== null
              )
            )
          );
          const formalOrigin = mapCertificateRef.current;
          const localOwnedTextRoot = Boolean(
            nativeRoot
            && nativeNode instanceof Text
            && ['P', 'DIV'].includes(nativeRoot.tagName)
            && (!nativeRoot.hasAttribute('data-easymde-visual-block-id')
              || (formalOrigin?.owner === fullOwnerRef.current
                && !formalOrigin.nodes.includes(nativeRoot)))
            && owned?.owner === fullOwnerRef.current
            && ownedSourcePair
            && owned.sourceRevision === documentSession.document.getRevision?.()
            && owned.nodes.includes(nativeRoot)
            && fullOwnedDomMatches(surface, owned)
            && ownedLedgerRetains(Array.from(surface.childNodes))
          );
          if (
            !localOwnedTextRoot
            || !(nativeNode instanceof Text)
            || !nativeSelection
            || !(nativeSelection.focusNode instanceof Text)
            || nativeSelection.focusNode !== nativeNode
          ) return null;
          return localBoundaryCertificate;
        })();
        let genericIntent = visualInputIntent(
          surface,
          event,
          memory,
          sourceMarkdown,
          visualMarkdown.length,
          visualMarkdown,
          previewSnapshotRef.current.editMap ?? null,
          intervalMapFor,
          acceptedPrefixOnly,
          localLiteralCertificate
        );
        const correspondenceCodeBody = Boolean(
          visualInputBlock
          && acceptedCodeBodyCorrespondenceRef.current.has(
            visualInputBlock.pre
          )
        );
        if (genericIntent) {
          if (
            !visualInputPendingRef.current
            && !composing
            && !event.isComposing
            && !correspondenceCodeBody
          ) {
            historySelectionWitness =
              captureVisualHistorySelectionWitness(
                genericIntent.historySelectionBefore ?? {
                  direction: 'none',
                  end: genericIntent.sourceSelection.end,
                  start: genericIntent.sourceSelection.start
                }
              ) ?? undefined;
          }
          const rawSelection = pendingEditSelectionBeforeRef.current;
          if (rawSelection && genericIntent.historySelectionBefore) {
            pendingEditSelectionBeforeRef.current = {
              ...rawSelection,
              historySelectionBefore: genericIntent.historySelectionBefore,
              ...(historySelectionWitness
                ? { historySelectionWitness }
                : {})
            };
          }
        }
        const targetRangeMismatch = () =>
          Boolean(
            nativeTargetRange
            && nativeSelection?.isCollapsed
            && nativeSelection.anchorNode instanceof Text
            && !visualInputBlock?.code.contains(nativeSelection.anchorNode)
            && (
              nativeTargetRange.startContainer !== nativeSelection.anchorNode
              || nativeTargetRange.endContainer !== nativeSelection.focusNode
              || nativeTargetRange.startOffset !== nativeSelection.anchorOffset
              || nativeTargetRange.endOffset !== nativeSelection.focusOffset
            )
          );
        if (
          !genericIntent
          && targetRangeMismatch()
          && acceptedPrefixOnly
          && !visualInputBlock
          && nativeSelection?.isCollapsed
          && nativeSelection.anchorNode instanceof Text
          && !nativeSelection.anchorNode.parentElement?.closest('pre, code')
        ) {
          // The canonical baseline cannot prove this ordinary text block's
          // position (the serializer spells the same rendered text
          // differently). Commit whatever input is still pending first: a
          // snapshot of the older committed source would clear that
          // uncommitted result and erase its edit. Then serialize the surface
          // once and map this same event against the real pair.
          if (!flushVisualInput()) {
            event.preventDefault();
            return;
          }
          try {
            materializeVisualBaseline();
          } catch (error) {
            event.preventDefault();
            onFailure(
              visualEditorFailureCode(
                error,
                'visual-editor-markdown-baseline-failed'
              )
            );
            return;
          }
          const retriedSource = sourceMarkdownRef.current;
          const retriedVisual = visualMarkdownRef.current;
          const retriedRecord = visualSourceIntervalMapRef.current;
          const retriedMap =
            retriedRecord
            && retriedRecord.sourceMarkdown === retriedSource
            && retriedRecord.visualMarkdown === retriedVisual
              ? retriedRecord.map
              : null;
          if (null !== retriedSource && null !== retriedVisual) {
            genericIntent = visualInputIntent(
              surface,
              event,
              visualSelectionMemoryRef.current,
              retriedSource,
              retriedVisual.length,
              retriedVisual,
              previewSnapshotRef.current.editMap ?? null,
              () =>
                retriedMap
                ?? createVisualMarkdownSourceIntervalMap(
                  retriedSource,
                  retriedVisual
                ),
              false
            );
          }
        }
        if (!genericIntent && targetRangeMismatch()) {
          event.preventDefault();
          failVisualSynchronization(new Error('visual-editor-selection-map-failed'));
          return;
        }
        const selection = surface.ownerDocument.defaultView?.getSelection();
        const collapsedCodeCaret = Boolean(
          visualInputBlock &&
            selection?.isCollapsed &&
            selection.anchorNode &&
            (selection.anchorNode === visualInputBlock.code ||
              visualInputBlock.code.contains(selection.anchorNode))
        );
        // Chromium names a forward deletion at the END of a code body by a
        // target range that LEAVES the body (often into the next block's
        // element boundary), because no in-body character follows the caret.
        // The live caret is still the body's own last position, so this is a
        // no-op at the body's structural end - not a stale selection. Consume
        // the native event, keep the caret where the user placed it, and let
        // the structural boundary refuse the edit instead of reporting the
        // body's own mapping as invalid. Only a target whose START also leaves
        // the body, or a caret outside it, stays on the existing rejection
        // path: those really do contradict the code-body owner.
        if (
          'deleteContentForward' === event.inputType &&
          visualInputBlock &&
          collapsedCodeCaret &&
          event.cancelable
        ) {
          const forwardTarget = event.getTargetRanges?.()[0];
          const targetStartInside =
            !forwardTarget
            || forwardTarget.startContainer === visualInputBlock.code
            || visualInputBlock.code.contains(forwardTarget.startContainer);
          const targetEndInside =
            forwardTarget
            && (forwardTarget.endContainer === visualInputBlock.code
              || visualInputBlock.code.contains(forwardTarget.endContainer));
          // The no-op is anchored on the caret's own body position, proved
          // against the SOURCE interval rather than the raw DOM text. The
          // source body (bodyStart..bodyEnd) ends with its own final line
          // newline, and the DOM's code text is exactly that body - or that
          // body plus one extra renderer terminal newline. The body's terminal
          // caret positions are therefore: after the body's last content
          // (one stop before the body's own final newline), the body's very
          // end, and, only when the renderer added its extra newline, the stop
          // after it. Any other offset - a mid-body caret, a code text that
          // does not match the source body, or an unresolvable ordinal -
          // keeps the rejection path below.
          let caretAtBodyEnd = false;
          if (targetStartInside && !targetEndInside) {
            try {
              if (null === visualInputCodeOrdinal) {
                throw new Error('visual-editor-code-body-map-ambiguous');
              }
              const interval = visualCodeBodyIntervalAtOrdinal(
                sourceMarkdown,
                visualInputCodeOrdinal
              );
              const bodyText = normalizeCodeLineEndings(
                sourceMarkdown.slice(interval.bodyStart, interval.bodyEnd)
              );
              const domText = normalizeCodeLineEndings(
                visualInputBlock.codeText
              );
              const caretBodyOffset =
                selection?.anchorNode && undefined !== selection.anchorOffset
                  ? visualCodeBodyDomOffset(visualInputBlock.code, {
                      node: selection.anchorNode,
                      offset: selection.anchorOffset
                    })
                  : null;
              const rendererTerminalNewline = domText === `${bodyText}\n`;
              caretAtBodyEnd =
                null !== caretBodyOffset &&
                (domText === bodyText || rendererTerminalNewline) &&
                (caretBodyOffset === bodyText.length ||
                  caretBodyOffset === bodyText.length - 1 ||
                  (rendererTerminalNewline &&
                    caretBodyOffset === bodyText.length + 1));
            } catch {
              caretAtBodyEnd = false;
            }
          }
          if (targetStartInside && !targetEndInside && caretAtBodyEnd) {
            event.preventDefault();
            return;
          }
        }
        // A collapsed caret inside a fenced code body is owned by the code
        // body, not by the whole-document interval map. The generic intent maps
        // the SAME native boundary through the document alignment, which at the
        // body's terminal line can name the byte after the last body newline -
        // exactly where a typed character would land outside the fence. The
        // code projection states body-local offsets instead, so it wins here;
        // the generic intent remains the answer for every non-code caret and
        // for every ordinary code input the code body itself cannot project.
        // A collapsed caret inside a fenced code body is owned by the code
        // body, not by the whole-document interval map. When the renderer's own
        // terminal line makes the DOM one caret-stop longer than the accepted
        // body, the generic intent projects that boundary one byte PAST the
        // body - exactly where a typed character would land outside the fence.
        // The code projection clamps to the body, so it wins ONLY in that case;
        // every other code and non-code input keeps the generic intent, whose
        // line-break handling deliberately leaves the body's existing terminal
        // newline alone.
        let genericAtCodeBodyTerminal = false;
        const authenticatedCodeBody = correspondenceCodeBody;
        if (genericIntent && visualInputBlock && collapsedCodeCaret) {
          try {
            const interval = visualCodeBodyIntervalAtOrdinal(
              sourceMarkdown,
              visualInputCodeOrdinal ?? 0
            );
            genericAtCodeBodyTerminal =
              genericIntent.sourceSelection.start >= interval.bodyEnd
              && genericIntent.sourceSelection.start
                <= interval.bodyEnd;
          } catch {
            genericAtCodeBodyTerminal = false;
          }
        }
        if (
          pendingNativeOperationRef.current?.kind === 'join'
          && 'deleteContentBackward' === event.inputType
        ) {
          // The browser's cross-root deletion owns this target range. Its end
          // boundary is intentionally outside the PRE, so code-body projection
          // must not reinterpret the structural join as a stale body selection.
          pendingVisualIntentRef.current = null;
        } else if (
          (genericIntent
            && !genericAtCodeBodyTerminal
            && (event.inputType.startsWith('delete') || !authenticatedCodeBody)) ||
          !visualInputBlock ||
          !collapsedCodeCaret ||
          ![
            'deleteByCut',
            'deleteContentBackward',
            'deleteContentForward',
            'deleteWordBackward',
            'deleteWordForward',
            'insertCompositionText',
            'insertFromComposition',
            'insertReplacementText',
            'insertText'
          ].includes(event.inputType)
        ) {
          let codePresentationIntent: VisualInputIntent | null = null;
          if (
            genericIntent
            && event.inputType.startsWith('delete')
            && visualInputBlock
            && null !== visualInputCodeOrdinal
          ) {
            try {
              codePresentationIntent = visualCodeBodyInputIntent(
                event,
                visualInputBlock,
                sourceMarkdown,
                visualMarkdown,
                visualInputCodeOrdinal,
                intervalInventoryForCodeInput()
              );
            } catch {
              codePresentationIntent = null;
            }
          }
          const genericBaseIntent = genericIntent;
          if (genericBaseIntent && codePresentationIntent?.codeBody) {
            pendingVisualIntentRef.current = {
              ...genericBaseIntent,
              codeBody: codePresentationIntent.codeBody,
              data: genericBaseIntent.data ?? null,
              hasTargetRange: genericBaseIntent.hasTargetRange ?? false,
              textSelection: codePresentationIntent.textSelection,
              visualSelection: codePresentationIntent.visualSelection
            };
          } else {
            pendingVisualIntentRef.current = genericIntent;
          }
          } else {
          try {
            const codeOrdinal =
              null !== visualInputCodeOrdinal
                ? visualInputCodeOrdinal
                : codeOrdinalForInputBlock(
                    visualInputBlock,
                    sourceMarkdown,
                    true
                  );
            if (null === codeOrdinal) {
              throw new Error('visual-editor-code-body-map-ambiguous');
            }
            const codeIntent = visualCodeBodyInputIntent(
              event,
              visualInputBlock,
              sourceMarkdown,
              visualMarkdown,
              codeOrdinal,
              intervalInventoryForCodeInput()
            );
            pendingVisualIntentRef.current =
              genericIntent && event.inputType.startsWith('delete')
                ? {
                    ...genericIntent,
                    ...(codeIntent.codeBody
                      ? { codeBody: codeIntent.codeBody }
                      : {}),
                    textSelection: codeIntent.textSelection,
                    visualSelection: codeIntent.visualSelection
                  }
                : codeIntent;
            visualInputCodeOrdinal = codeOrdinal;
          } catch (error) {
            if (!genericIntent) {
              event.preventDefault();
              failVisualSynchronization(error);
              return;
            }
            pendingVisualIntentRef.current = genericIntent;
          }
        }
      }
      if (
        pendingVisualIntentRef.current &&
        visualInputBlock &&
        null !== visualInputCodeOrdinal
      ) {
        const blockId = visualBlockIdForPre(visualInputBlock.pre, surface);
        const localProvenance = visualLocalCodeBodyProvenance(
          visualInputBlock,
          sourceMarkdown
        );
        if (blockId || localProvenance) {
          const previousCodeStructure =
            pendingVisualIntentResultRef.current?.codeBlockStructure;
          const replacement = ['insertLineBreak', 'insertParagraph'].includes(
            event.inputType
          )
            ? '\n'
            : (event.data ?? '');
          const removed = sourceMarkdown.slice(
            pendingVisualIntentRef.current.sourceSelection.start,
            pendingVisualIntentRef.current.sourceSelection.end
          );
          const sameBlock =
            !previousCodeStructure ||
            (previousCodeStructure.localPre
              ? previousCodeStructure.localPre === visualInputBlock.pre
              : Boolean(blockId && previousCodeStructure.blockId === blockId));
          const preserving =
            !/[\r\n~`]/u.test(removed + replacement) &&
            sameBlock &&
            (!previousCodeStructure || previousCodeStructure.preserving);
          pendingVisualIntentRef.current = {
            ...pendingVisualIntentRef.current,
            codeBlockStructure: {
              baseMarkdown:
                previousCodeStructure?.baseMarkdown ?? sourceMarkdown,
              blockId: blockId ?? null,
              codeOrdinal: visualInputCodeOrdinal,
              ...(localProvenance ? { localPre: visualInputBlock.pre } : {}),
              preserving
            }
          };
        }
      }
      if (historySelectionWitness && pendingVisualIntentRef.current) {
        pendingVisualIntentRef.current = {
          ...pendingVisualIntentRef.current,
          historySelectionWitness
        };
      }
      if (pendingVisualIntentRef.current && historyBefore) {
        pendingVisualIntentRef.current = {
          ...pendingVisualIntentRef.current,
          historyBefore
        };
      }
      const literalIntent = pendingVisualIntentRef.current;
      const literalParent = literalIntent?.textNode.parentElement;
      if (literalIntent && !literalIntent.codeBody && literalParent
        && ['P', 'DIV'].includes(literalParent.tagName)
        && literalParent.childNodes.length === 1
        && !literalParent.closest('pre, code, [contenteditable="false"]')
        && ['insertText', 'insertReplacementText'].includes(literalIntent.inputType)
        && (/^ {0,3}[`~]/u.test(literalIntent.textData)
          || (literalIntent.textSelection.start <= 3
            && (/^ {0,3}[`~]/u.test(literalIntent.data ?? '')
              || /^ {0,3}[`~]/u.test(literalIntent.textData.slice(
                literalIntent.textSelection.end, literalIntent.textSelection.end + 4)))))) {
        const text = replaceTextRange(literalIntent.textData, literalIntent.textSelection, literalIntent.data ?? '');
        const caret = literalIntent.textSelection.start + (literalIntent.data?.length ?? 0);
        const projection = projectVisualLiteralFencePrefix(text, caret);
        if (projection) {
          try {
            const anchor = { offset: literalIntent.textSelection.start,
              sourceOffset: literalIntent.sourceSelection.start,
              visualOffset: literalIntent.visualSelection.start };
            let start = provedLinearBoundary(literalIntent.textNode, 0, anchor, sourceMarkdown, visualMarkdown);
            let end = provedLinearBoundary(literalIntent.textNode, literalIntent.textData.length, anchor, sourceMarkdown, visualMarkdown);
            const selectedEnd = provedLinearBoundary(literalIntent.textNode, literalIntent.textSelection.end, anchor, sourceMarkdown, visualMarkdown);
            if (!start || !end || selectedEnd?.sourceOffset !== literalIntent.sourceSelection.end
              || selectedEnd.visualOffset !== literalIntent.visualSelection.end) {
              const sourceBounds = literalTextBoundsAtSelection(literalIntent.textData, literalIntent.textSelection, sourceMarkdown, literalIntent.sourceSelection);
              const visualBounds = literalTextBoundsAtSelection(literalIntent.textData, literalIntent.textSelection, visualMarkdown, literalIntent.visualSelection);
              start = sourceBounds && visualBounds ? { sourceOffset: sourceBounds.start, visualOffset: visualBounds.start } : null;
              end = sourceBounds && visualBounds ? { sourceOffset: sourceBounds.end, visualOffset: visualBounds.end } : null;
            }
            if (!start || !end) {
              // A literal-fence projection is an ADDITIONAL canonical
              // spelling, not a gate: when this paragraph's own text cannot be
              // proved linear against the mapped source bytes (the renderer
              // spells the row differently, or the caret selection is not a
              // provable unit boundary), the input keeps the ordinary intent
              // and commits as plain text instead of failing the keystroke.
            } else {
              pendingVisualIntentRef.current = {
                ...literalIntent,
                historySelectionBefore: literalIntent.historySelectionBefore ?? {
                  ...literalIntent.sourceSelection,
                  direction: 'none'
                },
                sourceSelection: { start: start.sourceOffset, end: end.sourceOffset },
                visualSelection: { start: start.visualOffset, end: end.visualOffset },
                literalFencePrefix: projection
              };
            }
          } catch (error) { event.preventDefault(); failVisualSynchronization(error); return; }
        }
      }
      if (
        pendingVisualIntentRef.current?.terminalLine &&
        ['insertText', 'insertReplacementText'].includes(event.inputType)
      ) {
        // The authored caret was on the renderer's terminal line, where the
        // browser's own default would write outside the fence. The owner
        // applies this character at the clamped body caret instead, so the
        // default is consumed here rather than guessed at afterwards.
        event.preventDefault();
        try {
          if (!visualInputBlock) {
            throw new Error('visual-editor-code-body-snapshot-missing');
          }
          insertVisualCodeBodyText(
            visualInputBlock.code,
            pendingVisualIntentRef.current.textSelection.start,
            event.data ?? ''
          );
        } catch (error) {
          failVisualSynchronization(error);
          return;
        }
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: event.data,
            inputType: event.inputType
          })
        );
        return;
      }
      if (
        pendingVisualIntentRef.current?.codeBody &&
        ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
      ) {
        event.preventDefault();
        try {
          if (!visualInputBlock) {
            throw new Error('visual-editor-code-body-snapshot-missing');
          }
          insertVisualCodeBodyLineBreak(event, visualInputBlock.code);
        } catch (error) {
          failVisualSynchronization(error);
          return;
        }
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: null,
            inputType: event.inputType
          })
        );
        return;
      }
      if (
        !pendingVisualIntentRef.current &&
        !visualBaselineMaterializedRef.current
      ) {
        try {
          materializeVisualBaseline();
        } catch (error) {
          event.preventDefault();
          onFailure(
            visualEditorFailureCode(
              error,
              'visual-editor-markdown-baseline-failed'
            )
          );
        }
      }
    };
    const handleInput = (event: InputEvent) => {
            const pendingEmptyStructuralInput =
        pendingVisualEmptyStructuralInputRef.current;
      pendingVisualEmptyStructuralInputRef.current = null;
      const flushEmptyVisualInput = (): boolean => {
        if (!flushVisualInput()) return false;
        const sourceMarkdown = sourceMarkdownRef.current;
        if (null !== sourceMarkdown && isVisualMarkdownEmpty(sourceMarkdown)) {
          ensureEmptyVisualParagraph(surface, sourceMarkdown);
        }
        return true;
      };
      const continuingUnmappedVisualInput =
        continuingUnmappedVisualInputRef.current;
      continuingUnmappedVisualInputRef.current = false;
      const inputBlock = visualInputBlock;
      // `visualInputBlock` is the beforeinput snapshot used for source
      // projection. Placeholder normalization must inspect the post-default
      // DOM as well: native Undo/Delete can empty that code node while the
      // pre-input snapshot still contains its last character.
      let currentInputBlock: VisualCodeInputSnapshot | null = null;
      try {
        currentInputBlock = inputBlock?.code.isConnected === false
          ? null
          : captureVisualCodeInputSnapshot(selectedVisualCodeBlock(surface));
      } catch (error) {
        failVisualSynchronization(error);
        return;
      }
      visualInputBlock = null;
      let mappedRawCodeBody = null !== visualInputCodeOrdinal;
      visualInputCodeOrdinal = null;
      // Verify the native structural split once, before anything reads the
      // surface. The verified candidate ledger is what the ordinary
      // synchronizer may publish for this commit; without it the DOM window
      // changed without a transition this owner can prove.
      if ('insertParagraph' === event.inputType) {
        verifyNativeRootTransition();
      }
      if ('deleteContentBackward' === event.inputType) {
        verifyNativeRootJoin();
      }
      const pendingNative = pendingNativeOperationRef.current;
      const nativeJoin =
        pendingNative?.kind === 'join' ? pendingNative : null;
      if (
        'deleteContentBackward' === event.inputType
        && nativeJoin?.kind === 'join'
        && nativeJoin.candidate
        && nativeJoin.sourceRange
        && 'PRE' !== nativeJoin.preRoot.tagName
        && nativeJoin.source === documentSession.document.getValue()
        && nativeJoin.sourceRevision === documentSession.document.getRevision?.()
      ) {
        const { end, start } = nativeJoin.sourceRange;
        const pendingSource = pendingVisualIntentResultRef.current?.result.sourceMarkdown;
        const canonicalSource = pendingSource
          && pendingSource.length <= nativeJoin.source.length
          && pendingSource.slice(0, start) === nativeJoin.source.slice(0, start)
          ? pendingSource
          : nativeJoin.source;
        if (
          start >= 0
          && end >= start
          && end <= canonicalSource.length
        ) {
          const separator = fullNativeJoinSeparator(
            canonicalSource,
            start,
            nativeJoin.hasFollowingRoot
          );
          const lineEnding = separator?.lineEnding ?? '';
          const separatorEnd = separator?.end ?? start;
          if (
            separator
            && separatorEnd >= end
            && lineEnding
          ) {
            const value = canonicalSource.slice(0, start)
              + lineEnding + lineEnding
              + canonicalSource.slice(separatorEnd);
            if (synchronizeMarkdown({
              ownerResult: {
                historySelectionBefore: {
                  direction: 'none',
                  end: start,
                  start
                },
                ledger: nativeJoin.candidate,
                selection: { direction: 'none', end: start, start },
                value
              }
            })) return;
          }
        }
      }
      if (
        visualTransferFailureReportedRef.current ||
        compositionRejected ||
        pendingTransferRef.current ||
        composing ||
        event.isComposing ||
        compositionCommitScheduled
      ) {
        return;
      }
      const pendingNativeSplit = pendingNativeOperationRef.current;
      const split =
        pendingNativeSplit?.kind === 'split' ? pendingNativeSplit : null;
      if (event.inputType === 'insertParagraph' && split?.candidate && split.sourceOffset !== null) {
        const native = surface.ownerDocument.defaultView?.getSelection();
        const prefix = split.candidate.nodes[split.windowIndex];
        const suffix = split.candidate.nodes[split.windowIndex + 1];
        if (split.splitOrder === 'before'
          && prefix instanceof HTMLParagraphElement
          && prefix.childNodes.length === 1
          && prefix.firstChild instanceof HTMLBRElement
          && suffix instanceof HTMLParagraphElement
          && suffix.childNodes.length === 1
          && suffix.firstChild instanceof Text
          && suffix.firstChild.data.length > 0
          && native?.isCollapsed
          && native.anchorNode === suffix.firstChild
          && native.focusNode === suffix.firstChild
          && native.anchorOffset === 0
          && native.focusOffset === 0
          && split.source === documentSession.document.getValue()
          && split.sourceRevision === documentSession.document.getRevision?.()
          && coversMarkdownUnits(split.source, split.sourceOffset, split.sourceOffset)) {
          const point = split.sourceOffset + 4;
          const value = split.source.slice(0, split.sourceOffset)
            + '  \n\n' + split.source.slice(split.sourceOffset);
          if (synchronizeMarkdown({ ownerResult: { ledger: split.candidate, value,
            historySelectionBefore: { direction: 'none', start: split.sourceOffset, end: split.sourceOffset },
            selection: { direction: 'none', start: point, end: point } } })) {
            ownedEmptyParagraphRef.current = { body: prefix, owner: fullOwnerRef.current, source: value,
              revision: documentSession.document.getRevision?.() ?? 0, sourceLength: 2, sourceOffset: point };
            const historyUndoDepth = documentHistoryState(documentSession.document).undoDepth;
            emptyParagraphHistoryRef.current = {
              depth: historyUndoDepth, historyUndoDepth, markdown: value, sourceOffset: point
            };
          }
          return;
        }
        const paragraph = suffix;
        if (split.splitOrder === 'after'
          && paragraph instanceof HTMLParagraphElement && paragraph.childNodes.length === 1
          && paragraph.firstChild instanceof HTMLBRElement && native?.isCollapsed
          && native.anchorNode === paragraph && native.focusNode === paragraph
          && [0, 1].includes(native.anchorOffset)
          && split.source === documentSession.document.getValue()
          && split.sourceRevision === documentSession.document.getRevision?.()
          && coversMarkdownUnits(split.source, split.sourceOffset, split.sourceOffset)) {
          const point = split.sourceOffset + 2;
          const value = split.source.slice(0, split.sourceOffset) + '\n\n  ' + split.source.slice(split.sourceOffset);
          if (synchronizeMarkdown({ ownerResult: { ledger: split.candidate, value,
            historySelectionBefore: { direction: 'none', start: split.sourceOffset, end: split.sourceOffset },
            selection: { direction: 'none', start: point, end: point } } })) {
            ownedEmptyParagraphRef.current = { body: paragraph, owner: fullOwnerRef.current, source: value,
              revision: documentSession.document.getRevision?.() ?? 0, sourceLength: 2, sourceOffset: point };
            const historyUndoDepth = documentHistoryState(documentSession.document).undoDepth;
            emptyParagraphHistoryRef.current = {
              depth: historyUndoDepth, historyUndoDepth, markdown: value, sourceOffset: point
            };
          }
          return;
        }
      }
      if (
        event.inputType === 'insertParagraph'
        && split?.candidate
        && split.sourceOffset !== null
        && split.originalRoot.tagName !== 'P'
      ) {
        try {
          const editedVisualMarkdown = serializeVisualMarkdown(surface);
          const selection = visualSelectionSourceRange(
            surface,
            split.source,
            split.visual,
            editedVisualMarkdown
          );
          if (!synchronizeMarkdown({
            ownerResult: {
              historySelectionBefore: {
                direction: 'none',
                end: split.sourceOffset,
                start: split.sourceOffset
              },
              ledger: split.candidate,
              selection,
              value: editedVisualMarkdown
            }
          })) return;
          return;
        } catch (error) {
          failVisualSynchronization(error);
          return;
        }
      }
      if (
        mappedRawCodeBody &&
        inputBlock &&
        (!inputBlock.code.isConnected ||
          ('historyUndo' === event.inputType &&
            '' === (currentInputBlock?.code.textContent ?? inputBlock.code.textContent)) ||
          (event.inputType.startsWith('delete') &&
            '' === (currentInputBlock?.code.textContent ?? inputBlock.code.textContent)))
      ) {
        mappedRawCodeBody = false;
      }
      if (mappedRawCodeBody && 'historyRedo' === event.inputType) {
        mappedRawCodeBody = false;
      }
      if (
        !mappedRawCodeBody &&
        inputBlock &&
        inputBlock.code.isConnected &&
        !(
          'historyUndo' === event.inputType &&
          '' === inputBlock.code.textContent
        ) &&
        !(
          event.inputType.startsWith('delete') &&
          '' === inputBlock.code.textContent
        ) &&
        !inputBlock.placeholder
      ) {
        const source = sourceMarkdownRef.current;
        if (null !== source) {
          try {
            mappedRawCodeBody =
              null !== codeOrdinalForInputBlock(inputBlock, source);
          } catch (error) {
            failVisualSynchronization(error);
            return;
          }
        }
      }
      if (!mappedRawCodeBody) {
        try {
          normalizeVisualCodePlaceholders(
            surface,
            event.inputType,
            currentInputBlock ?? inputBlock
          );
        } catch (error) {
          failVisualSynchronization(error);
          return;
        }
      }
      if (
        event.inputType.startsWith('delete') &&
        null !== sourceMarkdownRef.current &&
        isVisualMarkdownEmpty(sourceMarkdownRef.current)
      ) {
        ensureEmptyVisualParagraph(surface, '');
      }
      const shortcutApplied = ['historyRedo', 'historyUndo'].includes(
        event.inputType
      )
        ? false
        : applyVisualInlineShortcut(surface);
      const emptyStructuralInput = pendingEmptyStructuralInput;
      if (emptyStructuralInput) {
        if (ownedEmptyParagraphRef.current?.body === emptyStructuralInput.body) ownedEmptyParagraphRef.current = null;
        try {
          const sourceMarkdown = sourceMarkdownRef.current;
          const baselineVisualMarkdown = visualMarkdownRef.current;
          if (
            sourceMarkdown !== emptyStructuralInput.sourceMarkdown ||
            baselineVisualMarkdown !== emptyStructuralInput.visualMarkdown ||
            !emptyStructuralInput.body.isConnected ||
            !surface.contains(emptyStructuralInput.body) ||
            visualNodeAtPath(surface, emptyStructuralInput.bodyPath) !==
              emptyStructuralInput.body ||
            emptyStructuralInput.targetRange.startNode !==
              emptyStructuralInput.body ||
            emptyStructuralInput.targetRange.endNode !==
              emptyStructuralInput.body ||
            emptyStructuralInput.targetRange.startOffset !== 0 ||
            emptyStructuralInput.targetRange.endOffset !== 0
          ) {
            throw new Error('visual-editor-empty-structural-input-stale');
          }
          const currentSelection =
            surface.ownerDocument.defaultView?.getSelection();
          const text = emptyStructuralInput.body.firstChild;
          const preservedPlaceholder =
            emptyStructuralInput.body.lastChild === emptyStructuralInput.placeholder;
          const nativeTextShape =
            emptyStructuralInput.body.childNodes.length === 1
            || (
              emptyStructuralInput.body.childNodes.length === 2
              && preservedPlaceholder
              && emptyStructuralInput.body.lastChild instanceof HTMLBRElement
            );
          if (
            !(text instanceof Text) ||
            !nativeTextShape ||
            text.data !== emptyStructuralInput.data ||
            !currentSelection?.isCollapsed ||
            currentSelection.anchorNode !== text ||
            currentSelection.focusNode !== text ||
            currentSelection.anchorOffset !== text.length ||
            currentSelection.focusOffset !== text.length
          ) {
            throw new Error(
              'visual-editor-empty-structural-input-dom-mismatch'
            );
          }
          const beforeClone = emptyStructuralInput.beforeSurface.cloneNode(
            true
          ) as HTMLElement;
          const currentClone = surface.cloneNode(true) as HTMLElement;
          const beforeBody = visualNodeAtPath(
            beforeClone,
            emptyStructuralInput.bodyPath
          );
          const currentBody = visualNodeAtPath(
            currentClone,
            emptyStructuralInput.bodyPath
          );
          if (
            !(beforeBody instanceof HTMLElement) ||
            !(currentBody instanceof HTMLElement)
          ) {
            throw new Error('visual-editor-empty-structural-input-stale');
          }
          beforeBody.replaceChildren(
            beforeClone.ownerDocument.createTextNode('__body__')
          );
          currentBody.replaceChildren(
            currentClone.ownerDocument.createTextNode('__body__')
          );
          if (beforeClone.innerHTML !== currentClone.innerHTML) {
            throw new Error(
              'visual-editor-empty-structural-input-dom-mismatch'
            );
          }
          const readOnlySnapshot = readOnlySnapshotRef.current;
          if (readOnlySnapshot) {
            assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
          }
          const result = applyVisualMarkdownEditIntent(
            emptyStructuralInput.sourceMarkdown,
            emptyStructuralInput.visualMarkdown,
            emptyStructuralInput.sourceSelection,
            emptyStructuralInput.visualSelection,
            emptyStructuralInput.inputType,
            emptyStructuralInput.data
          );
          if (!result) {
            throw new Error('visual-editor-empty-structural-input-map-failed');
          }
          const committedVisualMarkdown = serializeVisualMarkdown(surface);
          const committedVisualOffset = visualSelectionVisualOffset(
            surface,
            committedVisualMarkdown
          );
          const committedResult = {
            ...result,
            visualMarkdown: committedVisualMarkdown,
            visualSelection: {
              end: committedVisualOffset,
              start: committedVisualOffset
            }
          };
          pendingVisualIntentResultRef.current = {
            baseSourceMarkdown: emptyStructuralInput.sourceMarkdown,
            inputType: emptyStructuralInput.inputType,
            ...(emptyStructuralInput.historyGroupOrigin
              ? { historyGroupOrigin: emptyStructuralInput.historyGroupOrigin }
              : {}),
            historySelectionBefore: { direction: 'none',
              start: emptyStructuralInput.sourceSelection.start, end: emptyStructuralInput.sourceSelection.start },
            ...(emptyStructuralInput.historyBefore
              ? { historyBefore: emptyStructuralInput.historyBefore }
              : {}),
            ...(emptyStructuralInput.historyOrigin
              ? { historyOrigin: emptyStructuralInput.historyOrigin }
              : {}),
            memory: selectionMemoryForCurrentSelection(
              surface,
              committedResult.selection,
              committedResult.visualSelection
            ),
            result: committedResult,
            sourceChange: {
              from: emptyStructuralInput.sourceSelection.start,
              insert: emptyStructuralInput.data,
              to: emptyStructuralInput.sourceSelection.end
            }
          };
          scheduleVisualInput();
          return;
        } catch (error) {
          failVisualSynchronization(error);
          return;
        }
      }
      const intent = pendingVisualIntentRef.current;
            const previousPendingVisualIntent = pendingVisualIntentResultRef.current;
      pendingVisualIntentRef.current = null;
      if (intent) {
        if (!intent.codeBody && ['insertText', 'insertReplacementText'].includes(intent.inputType)
          && mapCertificateRef.current && !ownedLedgerRetains(Array.from(surface.childNodes))) {
          failVisualSynchronization(new Error('visual-editor-canonical-change-dom-stale'));
          return;
        }
        const base = pendingVisualIntentResultRef.current?.result;
        const sourceMarkdown =
          base?.sourceMarkdown ?? sourceMarkdownRef.current;
        const visualMarkdown =
          base?.visualMarkdown ?? visualMarkdownRef.current;
        if (null !== sourceMarkdown && null !== visualMarkdown) {
          const replacement =
            'insertLineBreak' === intent.inputType && null === intent.data
              ? '\n'
              : (intent.data ?? '');
          const sourceInputReplacement = intent.codeBody
            ? replacement.replace(/\r\n|\r|\n/g, intent.codeBody.lineEnding)
            : replacement;
          const visualInputReplacement = intent.codeBody
            ? normalizeCodeLineEndings(replacement)
            : (intent.literalFencePrefix?.markdown ?? replacement);
          const appendInitialBodyLine = Boolean(
            intent.codeBody?.initialEmptyBody &&
              [
                'insertCompositionText',
                'insertReplacementText',
                'insertText'
              ].includes(intent.inputType) &&
              '' !== replacement &&
              !/[\r\n]/u.test(replacement)
          );
          const startsInitialCodeBody =
            intent.codeBody?.initialEmptyBody &&
            [
              'insertCompositionText',
              'insertLineBreak',
              'insertParagraph',
              'insertReplacementText',
              'insertText'
            ].includes(intent.inputType);
          const sourcePrefix = startsInitialCodeBody
            ? (intent.codeBody?.sourcePrefix ?? '')
            : '';
          const visualPrefix = startsInitialCodeBody
            ? (intent.codeBody?.visualPrefix ?? '')
            : '';
          const sourceReplacement =
            sourcePrefix +
            sourceInputReplacement +
            (appendInitialBodyLine
              ? (intent.codeBody?.lineEnding ?? '\n')
              : '');
          const visualReplacement =
            visualPrefix +
            visualInputReplacement +
            (appendInitialBodyLine ? '\n' : '');
          // A literal fence run is spelled differently in the two spaces: the
          // canonical source carries the run's literal Markdown spelling, the
          // visible paragraph keeps the raw glyphs. Both the edit result and
          // the recorded source change must name that same canonical string.
          const canonicalSourceReplacement = intent.literalFencePrefix
            ? intent.literalFencePrefix.markdown
            : sourceReplacement;
          const expectedText = replaceTextRange(
            intent.textData,
            intent.textSelection,
            replacement
          );
          const detachedDeletion =
            intent.hasTargetRange &&
            intent.inputType.startsWith('delete') &&
            !intent.textNode.isConnected;
          const result = applyVisualMarkdownEditIntent(
            sourceMarkdown,
            visualMarkdown,
            intent.sourceSelection,
            intent.visualSelection,
            intent.inputType,
            intent.data,
            intent.codeBody
              ? {
                  sourceCaretLength:
                    sourcePrefix.length + sourceInputReplacement.length,
                  sourceReplacement,
                  visualCaretLength:
                    visualPrefix.length + visualInputReplacement.length,
                  visualReplacement
                }
              : intent.literalFencePrefix
                ? {
                    // The canonical source carries the run's literal Markdown
                    // spelling. The surface's own serialization keeps the raw
                    // glyphs, so the visual replacement and caret stay raw.
                    sourceReplacement: canonicalSourceReplacement,
                    visualReplacement: canonicalSourceReplacement,
                    sourceCaretLength: canonicalSourceReplacement.length,
                    visualCaretLength: canonicalSourceReplacement.length
                  }
                : {}
          );
          let domMatchesIntent = false;
          if (result && intent.codeBody) {
            try {
              if (!inputBlock) {
                throw new Error('visual-editor-code-body-snapshot-missing');
              }
              const currentCodeBlock = captureVisualCodeInputSnapshot(
                selectedVisualCodeBlock(surface)
              );
              const fenceExpansion = intent.codeBlockStructure && currentCodeBlock
                ? pendingCodeFenceExpansion(
                    {
                      baseSourceMarkdown: sourceMarkdown,
                      codeBlockStructure: intent.codeBlockStructure,
                      inputType: intent.inputType,
                      memory: null,
                      result,
                      sourceChange: {
                        from: intent.sourceSelection.start,
                        insert: canonicalSourceReplacement,
                        to: intent.sourceSelection.end
                      }
                    },
                    currentCodeBlock
                  )
                : null;
              if (fenceExpansion) {
                // The third fence marker is still a body edit owned by the
                // widening path. Let that authenticated owner reconcile the
                // current PRE before treating the temporary closing-fence
                // parse as a DOM mismatch.
                domMatchesIntent = true;
              } else {
              const visualBody = visualCodeBodyIntervalAtOrdinal(
                result.visualMarkdown,
                intent.codeBody.codeOrdinal
              );
              const expectedBody = result.visualMarkdown.slice(
                visualBody.bodyStart,
                visualBody.bodyEnd
              );
              reconcileVisualCodeBodyDom(
                inputBlock.code,
                expectedBody,
                result.visualSelection.end - visualBody.bodyStart
              );
              if (
                (event.inputType.startsWith('delete') || 'historyUndo' === event.inputType)
                && (null === currentInputBlock
                  || !inputBlock.pre.hasAttribute('data-easymde-visual-block-id'))
              ) {
                normalizeVisualCodePlaceholders(
                  surface,
                  event.inputType,
                  captureVisualCodeInputSnapshot(inputBlock.pre)
                );
              }
              domMatchesIntent = true;
              }
            } catch (error) {
              failVisualSynchronization(error);
              return;
            }
          } else if (result && shortcutApplied) {
            domMatchesIntent =
              serializeVisualMarkdown(surface) === result.visualMarkdown;
          } else if (result && intent.crossTextTarget) {
            domMatchesIntent =
              intent.crossTextTarget.owner.parentNode === surface
              && serializeVisualMarkdown(surface) === result.visualMarkdown;
          } else {
            domMatchesIntent =
              browserTextMatchesExpected(intent.textNode.data, expectedText) ||
              detachedDeletion ||
              browserInsertedBeforeVisualCodePlaceholder(
                inputBlock,
                intent,
                expectedText
              );
          }
          if (result && domMatchesIntent) {
            pendingUnmappedVisualInputRef.current = false;
            continuingUnmappedVisualInputRef.current = false;
            const committedVisualMarkdown =
              event.inputType.startsWith('delete') &&
              visualStructuralBodyIsEmpty(surface)
                ? serializeVisualMarkdown(surface)
                : result.visualMarkdown;
            const committedResult =
              committedVisualMarkdown === result.visualMarkdown
                ? result
                : {
                    ...result,
                    visualMarkdown: committedVisualMarkdown
                  };
            const codeBlockStructure = intent.codeBlockStructure
              ? {
                  ...intent.codeBlockStructure,
                  preserving:
                    intent.codeBlockStructure.preserving ||
                    visualCodeBlockStructureSignature(
                      committedResult.sourceMarkdown
                    ) ===
                      visualCodeBlockStructureSignature(
                        intent.codeBlockStructure.baseMarkdown
                      )
                }
              : undefined;
            const continuingHistoryTransaction =
              previousPendingVisualIntent?.historyOrigin ===
                'empty-structural' &&
              previousPendingVisualIntent.baseSourceMarkdown ===
                sourceMarkdownRef.current &&
              Boolean(previousPendingVisualIntent.historyGroupOrigin)
                ? previousPendingVisualIntent
                : null;
            const transactionBaseSourceMarkdown = continuingHistoryTransaction
              ? continuingHistoryTransaction.baseSourceMarkdown
              : sourceMarkdown;
            const transactionHistoryBefore =
              continuingHistoryTransaction?.historyBefore ??
              intent.historyBefore;
            // The witness belongs to the debounce GROUP, not to one keystroke:
            // only the first character was read while the surface still showed
            // the pre-edit accepted render. Later characters must keep carrying
            // it, and the test for "still the same operation" is the origin the
            // witness itself certified - the canonical source it was read
            // against and the revision/history it recorded - never the rolling
            // pending source, which already contains the group's own earlier
            // characters.
            const previousWitness =
              pendingVisualIntentResultRef.current?.historySelectionWitness;
            const currentRevision =
              documentSession.document.getRevision?.();
            const currentHistory = documentHistoryState(documentSession.document);
            const currentOwned = ownedDomRef.current;
            const previousGroupOrigin =
              previousPendingVisualIntent?.historyGroupOrigin;
            const groupOriginStillCurrent = Boolean(
              previousGroupOrigin
              && currentOwned
              && previousGroupOrigin.owned === currentOwned
              && currentOwned.owner === fullOwnerRef.current
              && sourceMarkdownRef.current === currentOwned.source
              && documentSession.document.getValue() === currentOwned.source
              && currentOwned.sourceRevision === currentRevision
              && previousGroupOrigin.historyUndoDepth === currentHistory.undoDepth
              && previousGroupOrigin.historyRedoDepth === currentHistory.redoDepth
              && ownedLedgerRetains(Array.from(surface.childNodes))
            );
            const historyGroupOrigin = previousPendingVisualIntent
              ? (groupOriginStillCurrent ? previousGroupOrigin : undefined)
              : currentOwned
                && intent.historySelectionBefore
                && currentOwned.owner === fullOwnerRef.current
                && sourceMarkdownRef.current === currentOwned.source
                && documentSession.document.getValue() === currentOwned.source
                && currentOwned.sourceRevision === currentRevision
                && ownedLedgerRetains(Array.from(surface.childNodes))
                  ? {
                      historyRedoDepth: currentHistory.redoDepth,
                      historySelectionBefore: intent.historySelectionBefore,
                      historyUndoDepth: currentHistory.undoDepth,
                      owned: currentOwned
                    }
                  : undefined;
            const historySelectionWitness =
              intent.historySelectionWitness ??
              (previousWitness
                && previousWitness.sourceMarkdown ===
                  sourceMarkdownRef.current
                && previousWitness.revision === currentRevision
                && previousWitness.historyState.undoDepth ===
                  currentHistory.undoDepth
                ? previousWitness
                : undefined);
            const transactionHistorySelectionBefore =
              historyGroupOrigin?.historySelectionBefore
              ?? historySelectionWitness?.historySelectionBefore
              ?? (previousPendingVisualIntent
                ? undefined
                : intent.historySelectionBefore);
            pendingVisualIntentResultRef.current = {
              baseSourceMarkdown: transactionBaseSourceMarkdown,
              inputType: intent.inputType,
              ...(intent.emptyParagraphTarget
                ? { emptyParagraphTarget: intent.emptyParagraphTarget }
                : {}),
              ...(nativeCodeBodyTypingRun(intent) ? { nativeTypingRun: true } : {}),
              ...(historyGroupOrigin ? { historyGroupOrigin } : {}),
              ...(transactionHistorySelectionBefore
                && (historyGroupOrigin || previewSnapshotRef.current.editMap)
                ? { historySelectionBefore: transactionHistorySelectionBefore } : {}),
              ...(historySelectionWitness ? { historySelectionWitness } : {}),
              ...(intent.codeBody && inputBlock
                ? {
                    codeBodyTopology: {
                      openEof: intent.codeBody.openEof,
                      pre: inputBlock.pre,
                      sourceBlockStart: intent.codeBody.sourceBlockStart
                    }
                  }
                : {}),
              ...(codeBlockStructure ? { codeBlockStructure } : {}),
              ...(transactionHistoryBefore
                ? { historyBefore: transactionHistoryBefore }
                : {}),
              ...(continuingHistoryTransaction
                ? {
                    deferSourceChange: true,
                    historyOrigin: 'empty-structural' as const
                  }
                : {}),
              memory: selectionMemoryForCurrentSelection(
                surface,
                {
                  end: committedResult.selection.end,
                  start: committedResult.selection.start
                },
                committedResult.visualSelection
              ),
              result: committedResult,
              sourceChange: {
                from: intent.sourceSelection.start,
                insert: canonicalSourceReplacement,
                to: intent.sourceSelection.end
              }
            };
            if ('' === committedResult.visualMarkdown) {
              ensureEmptyVisualParagraph(
                surface,
                committedResult.sourceMarkdown
              );
              const presentation = pendingVisualIntentResultRef.current;
              if (presentation) {
                pendingVisualIntentResultRef.current = {
                  ...presentation,
                  result: {
                    ...presentation.result,
                    visualMarkdown: serializeVisualMarkdown(surface)
                  }
                };
              }
              commitPendingVisualIntent();
              visualInputPendingRef.current = false;
              return;
            }
            scheduleVisualInput();
            if (
              event.inputType.startsWith('delete') &&
              isEmptyVisualSurface(surface) &&
              !flushEmptyVisualInput()
            )
              return;
            return;
          }
        }
      }
      if (pendingVisualIntentResultRef.current) {
        if (!commitPendingVisualIntent()) return;
      }
      pendingUnmappedVisualInputRef.current =
        ['insertLineBreak', 'insertParagraph'].includes(event.inputType) ||
        (continuingUnmappedVisualInput &&
          !intent &&
          ['insertReplacementText', 'insertText'].includes(event.inputType));
      scheduleVisualInput();
      if (
        event.inputType.startsWith('delete') &&
        isEmptyVisualSurface(surface) &&
        !flushEmptyVisualInput()
      )
        return;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (visualTransferFailureReportedRef.current) {
        event.preventDefault();
        return;
      }
      const key = event.key.toLowerCase();
      const selectAllShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        'a' === key;
      const historyShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        ('z' === key || ('y' === key && !event.shiftKey));
      if (pendingComposition && historyShortcut) {
        event.preventDefault();
        cancelledPendingComposition = true;
        try { finishPendingCompositionDom(surface.ownerDocument.activeElement === surface); runHistory('y' === key || event.shiftKey); }
        catch (error) { failPendingTransfer(visualEditorFailureCode(error, 'visual-editor-pending-selection-stale')); }
        return;
      }
      if (composing || event.isComposing) return;
      if (pendingTransferRef.current && !historyShortcut) {
        if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End' ||
            event.key === 'PageUp' || event.key === 'PageDown' ||
            selectAllShortcut) invalidatePendingInputSelection();
        return;
      }
      if (historyShortcut) {
        event.preventDefault();
        if (!pendingTransferRef.current && !flushVisualInput()) return;
        try {
          const redo = 'y' === key || event.shiftKey;
          const historyState = documentHistoryState(documentSession.document);
          if (redo ? historyState.redoDepth > 0 : historyState.undoDepth > 0) {
            runHistory(redo);
          }
        } catch (error) {
          failVisualSynchronization(error);
        }
        return;
      }
      if (selectAllShortcut) {
        if (
          !(event.target instanceof Node) ||
          !surface.contains(event.target)
        ) {
          return;
        }
        event.preventDefault();
        try {
          focusVisualSurface(surface);
          selectVisualSurfaceContents(surface);
        } catch (error) {
          failVisualSynchronization(error);
        }
        return;
      }
      if (!['Backspace', ' ', 'Enter'].includes(event.key)) return;
      let canApplyShortcut = true;
      let historyBefore: VisualHistorySnapshot | null = null;
      let ownerCodeFenceCommand: OwnerCodeFenceCommand | undefined;
      let headingEnter: Readonly<{ owned: FullOwnedDom; root: HTMLElement; sourceOffset: number }> | null = null;
      const beforeEmptyCodeFenceRemoval = (): boolean => {
        if (!flushVisualInput()) {
          canApplyShortcut = false;
          return false;
        }
        const beforeMarkdown = sourceMarkdownRef.current;
        if (null === beforeMarkdown) {
          canApplyShortcut = false;
          failVisualSynchronization(
            new Error('visual-editor-markdown-snapshot-missing')
          );
          return false;
        }
        historyBefore = captureVisualHistorySnapshot(
          beforeMarkdown,
          surface.innerHTML
        );
        const pre = selectedVisualCodeBlock(surface);
        const input = pre ? captureVisualCodeInputSnapshot(pre) : null;
        const owned = ownedDomRef.current;
        const provenance = input ? visualLocalCodeBodyProvenance(input, beforeMarkdown) : null;
        const interval = provenance
          ? visualCodeBodyIntervalAtOrdinal(beforeMarkdown, provenance.codeOrdinal)
          : null;
        const normalizedCodeText = input
          ? normalizeCodeLineEndings(input.codeText)
          : null;
        const domBodyEmpty = Boolean(input
          && (input.placeholder || '' === normalizedCodeText || '\n' === normalizedCodeText));
        const sourceBody = interval
          ? beforeMarkdown.slice(interval.bodyStart, interval.bodyEnd)
          : null;
        const sourceBodyEmpty = Boolean(interval
          && ('' === sourceBody || sourceBody === interval.lineEnding));
        if (input && provenance && interval && domBodyEmpty && sourceBodyEmpty && owned
          && owned.source === beforeMarkdown && owned.source === documentSession.document.getValue()
          && owned.sourceRevision === documentSession.document.getRevision?.()
          && fullOwnedDomMatches(surface, owned)) {
          ownerCodeFenceCommand = { kind: 'remove', owned, prior: input.pre, html: input.pre.innerHTML,
            historySelectionBefore: { direction: 'none', start: interval.bodyStart, end: interval.bodyStart },
            sourceStart: interval.sourceBlockStart, sourceEnd: interval.sourceBlockEnd };
        }
        return true;
      };
      const codeBlocksBefore = new Set(visualCodePreOrder());
      // A block shortcut rewrites the block the caret is in and preserves that
      // block's accepted identity, so it can state the exact window it is about
      // to change BEFORE it changes it. That typed window is the only way a
      // mapped surface's synchronizer may adopt the result; on an unmapped
      // surface the pre-command child list is the same statement.
      if (event.key === 'Enter') {
        const native = currentTextSelection(surface);
        const prior = native?.anchorNode.parentElement;
        if (native && prior?.parentElement === surface && /^H[1-6]$/u.test(prior.tagName)
          && native.anchorNode === native.focusNode && native.anchorOffset === native.focusOffset
          && native.anchorOffset === native.anchorNode.length) {
          if (!flushVisualInput()) { event.preventDefault(); return; }
          try {
            const owned = ownedDomRef.current;
            if (!owned || owned.owner !== fullOwnerRef.current
              || owned.source !== documentSession.document.getValue()
              || owned.sourceRevision !== documentSession.document.getRevision?.()
              || !fullOwnedDomMatches(surface, owned)) throw new Error('visual-editor-canonical-change-dom-stale');
            const boundary = mapTextBoundaryFromInterval(surface, native.anchorNode, native.anchorOffset,
              owned.visual, createVisualMarkdownSourceIntervalMap(owned.source, owned.visual), false);
            if (!boundary || !coversMarkdownUnits(owned.source, boundary.sourceOffset, boundary.sourceOffset)) {
              throw new Error('visual-editor-selection-map-failed');
            }
            headingEnter = { owned, root: prior, sourceOffset: boundary.sourceOffset };
          } catch (error) { event.preventDefault(); failVisualSynchronization(error); return; }
        }
        if (native && native.anchorNode === native.focusNode && native.anchorOffset === native.focusOffset
          && native.anchorOffset === native.anchorNode.length && prior?.parentNode === surface
          && isPlainVisualTextBody(prior, native.anchorNode)
          && isMarkdownFenceOpeningLine(native.anchorNode.data)) {
          if (!flushVisualInput()) { event.preventDefault(); return; }
          const owned = ownedDomRef.current;
          const memory = visualSelectionMemoryRef.current;
          const literal = projectVisualLiteralParagraphLine(native.anchorNode.data, native.anchorOffset);
          const mapped = owned && memory
            ? mapSelectionFromMemory(memory, native, owned.visual.length, owned.source, owned.visual) : null;
          const raw = { start: native.anchorOffset, end: native.focusOffset };
          const bounds = owned && mapped ? literalTextBoundsAtSelection(native.anchorNode.data, raw, owned.source, mapped.source) : null;
          const visualBounds = owned && mapped ? literalTextBoundsAtSelection(native.anchorNode.data, raw, owned.visual, mapped.visual) : null;
          if (owned && literal && bounds && visualBounds
            && owned.source === documentSession.document.getValue()
            && owned.sourceRevision === documentSession.document.getRevision?.()
            // The serializer may escape only the first marker; direct intents
            // escape the entire run. Both must decode to this exact native Text
            // and remain literal source rather than an active fence opener.
            && !isMarkdownFenceOpeningLine(owned.source.slice(bounds.start, bounds.end))) {
            try {
              const observed = serializeVisualMarkdown(surface);
              const rowSpelling = serializeVisualMarkdownBlockFragment([prior]);
              const projectedVisual = owned.visual.slice(0, visualBounds.start)
                + rowSpelling + owned.visual.slice(visualBounds.end);
              const readOnly = readOnlySnapshotRef.current;
              if (!readOnly) throw new Error('visual-editor-read-only-snapshot-missing');
              assertVisualMarkdownReadOnlySnapshot(surface, readOnly);
              if (owned.source !== sourceMarkdownRef.current || owned.visual !== visualMarkdownRef.current
                || !fullOwnedDomMatches(surface, owned)
                || (observed !== owned.visual && observed !== projectedVisual)) {
                throw new Error('visual-editor-canonical-change-dom-stale');
              }
            } catch (error) { event.preventDefault(); failVisualSynchronization(error); return; }
            ownerCodeFenceCommand = { kind: 'create', owned, prior, html: prior.innerHTML, sourceStart: bounds.start, sourceEnd: bounds.end };
          }
        }
      }
      const shortcutPrecedingNodes = Array.from(surface.childNodes);
      const shortcutWindow = captureAcceptedTopLevelVisualWindow(
        surface,
        sourceMarkdownRef.current ?? '',
        previewSnapshotRef.current.editMap,
        previewSnapshotRef.current.signature,
        previewSnapshotRef.current.revision,
        capturedPreviewRevisionRef.current,
        visualCodeBodyPreviewSourceRef.current
      );
      if (
        applyVisualBlockShortcut(surface, event, beforeEmptyCodeFenceRemoval)
      ) {
        if (!canApplyShortcut) return;
        if (null !== visualInputTimerRef.current) {
          clearTimeout(visualInputTimerRef.current);
          visualInputTimerRef.current = null;
        }
        visualInputPendingRef.current = false;
        pendingUnmappedVisualInputRef.current = false;
        continuingUnmappedVisualInputRef.current = false;
        pendingVisualIntentRef.current = null;
        pendingVisualIntentResultRef.current = null;
        let localCodeBodyPre: HTMLElement | undefined;
        let fenceOwnerResult: SynchronizeMarkdownOptions['ownerResult'];
        try {
          localCodeBodyPre = newlyCreatedVisualCodePre(
            surface,
            codeBlocksBefore
          );
          if (headingEnter) {
            const paragraph = headingEnter.root.nextElementSibling;
            const ledger = verifiedOwnerCommandLedger(shortcutPrecedingNodes);
            const native = surface.ownerDocument.defaultView?.getSelection();
            const { owned, sourceOffset } = headingEnter;
            if (!ledger || !(paragraph instanceof HTMLParagraphElement)
              || paragraph.childNodes.length !== 1 || !(paragraph.firstChild instanceof HTMLBRElement)
              || !native?.isCollapsed || native.anchorNode !== paragraph
              || ownedDomRef.current !== owned || owned.source !== documentSession.document.getValue()
              || owned.sourceRevision !== documentSession.document.getRevision?.()) {
              throw new Error('visual-editor-canonical-change-dom-stale');
            }
            const point = sourceOffset + 2;
            fenceOwnerResult = { ledger,
              value: owned.source.slice(0, sourceOffset) + '\n\n  ' + owned.source.slice(sourceOffset),
              historySelectionBefore: { direction: 'none', start: sourceOffset, end: sourceOffset },
              selection: { direction: 'none', start: point, end: point } };
          }
          if (ownerCodeFenceCommand?.kind === 'create' && localCodeBodyPre) {
            const ledger = verifiedOwnerCommandLedger(shortcutPrecedingNodes, ownerCodeFenceCommand);
            const input = captureVisualCodeInputSnapshot(localCodeBodyPre);
            if (!ledger || !input?.placeholder || input.codeText !== '') {
              throw new Error('visual-editor-canonical-change-dom-stale');
            }
            const fenceMarkdown = serializeVisualMarkdownBlockFragment([localCodeBodyPre]);
            const { sourceStart, sourceEnd, owned } = ownerCodeFenceCommand;
            const caret = sourceStart + fenceMarkdown.indexOf('\n') + 1;
            fenceOwnerResult = {
              ledger,
              value: owned.source.slice(0, sourceStart) + fenceMarkdown + owned.source.slice(sourceEnd),
              historySelectionBefore: { direction: 'none', start: sourceEnd, end: sourceEnd },
              selection: { direction: 'none', start: caret, end: caret }
            };
          }
        } catch (error) {
          failVisualSynchronization(error);
          return;
        }
        if (
          !synchronizeMarkdown({
            ...(fenceOwnerResult ? { ownerResult: fenceOwnerResult } : {}),
            ...(ownerCodeFenceCommand?.historySelectionBefore
              ? { historySelectionBefore: ownerCodeFenceCommand.historySelectionBefore }
              : {}),
            acceptedTopLevelSelection: Boolean(shortcutWindow),
            ...(shortcutWindow ? { acceptedTopLevelWindow: shortcutWindow } : {}),
            ...(localCodeBodyPre ? { localCodeBodyPre } : {}),
            ownerCommandBefore: shortcutPrecedingNodes,
            ...(ownerCodeFenceCommand ? { ownerCodeFenceCommand } : {}),
            isolateHistoryBefore: Boolean(historyBefore)
          })
        )
          return;
        const afterMarkdown = sourceMarkdownRef.current;
        if (headingEnter && afterMarkdown !== null) {
          const body = headingEnter.root.nextElementSibling;
          if (body instanceof HTMLParagraphElement) {
            ownedEmptyParagraphRef.current = { body, owner: fullOwnerRef.current, source: afterMarkdown,
              revision: documentSession.document.getRevision?.() ?? 0, sourceLength: 2, sourceOffset: headingEnter.sourceOffset + 2 };
            const historyUndoDepth = documentHistoryState(documentSession.document).undoDepth;
            emptyParagraphHistoryRef.current = {
              depth: historyUndoDepth, historyUndoDepth, markdown: afterMarkdown,
              sourceOffset: headingEnter.sourceOffset + 2
            };
          }
        }
        if (historyBefore && null !== afterMarkdown) {
          appendVisualHistoryTransition(
            historyBefore,
            captureVisualHistorySnapshot(afterMarkdown, surface.innerHTML)
          );
        }
      }
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      if (pendingTransferRef.current || pendingComposition) {
        event.preventDefault();
        onFailure('visual-editor-pending-input-unavailable');
        return;
      }
      if (hasImageFile(event.clipboardData)) {
        if (!imageUploadEnabled || !imagePasteUploadEnabled) {
          event.preventDefault();
        }
        return;
      }
      event.preventDefault();
      requestMarkdownTransfer(event.clipboardData?.getData('text/plain') ?? '');
    };
    const invalidateContextMenuSelection = (): void => {
      contextMenuSelectionRef.current = null;
    };
    const handleContextMenuSelectionChange = (): void => {
      const ownerPlaced = ownerPlacedSelectionRef.current;
      if (ownerPlaced) {
        let drifted = true;
        try {
          const currentOwner = captureVisualHistorySelection(surface);
          drifted = !currentOwner
            || !visualHistorySelectionEqual(ownerPlaced, currentOwner);
        } catch {
          drifted = true;
        }
        if (drifted) {
          // The native selection moved away from the one this owner placed, so
          // it now describes a user gesture and must be protected again.
          ownerPlacedSelectionRef.current = null;
        }
      }
      const lease = contextMenuSelectionRef.current;
      if (!lease) return;
      const current = captureVisualHistorySelection(surface);
      if (!current || !visualHistorySelectionEqual(lease, current)) {
        invalidateContextMenuSelection();
      }
    };
    const handleContextMenuSurfaceFocus = (): void => {
      invalidateContextMenuSelection();
    };
    surface.ownerDocument.addEventListener(
      'selectionchange',
      handleContextMenuSelectionChange,
      true
    );
    surface.addEventListener('focusin', handleContextMenuSurfaceFocus);
    surface.addEventListener('compositionstart', handleCompositionStart);
    surface.addEventListener('compositionend', handleCompositionEnd);
    surface.addEventListener('drop', handleDrop);
    surface.addEventListener('beforeinput', handleBeforeInput);
    surface.addEventListener('pointerdown', handlePendingPointerDown);
    surface.addEventListener('input', handleInput);
    surface.addEventListener('keydown', handleKeyDown);
    surface.addEventListener('paste', handlePaste);

    /**
     * The row a surface-anchored (keyboard) selection names, with no element
     * ancestor to read. Two certified shapes exist and nothing else is guessed:
     * a whole thematic break selected as that one direct child, and the
     * parent-gap caret beside a break, which the existing structural helpers
     * already certify. A bare offset consequently names nothing.
     */
    const surfaceAnchoredRoot = (
      sourceMarkdown: string,
      recordedCaret: number,
      editMap: PreviewEditMap | null | undefined,
      applicability: FullMapApplicability
    ): HTMLElement | null => {
      const thematicBreak = captureVisualThematicBreakSelection(surface);
      if (thematicBreak) return thematicBreak.block;
      // The parent-gap path reads accepted map rows, so it is only meaningful
      // on a certificate that still describes this source and DOM. A dirty or
      // refresh-required surface parks on its one formal request instead.
      if (!editMap || 'current' !== applicability) return null;
      let blocks: ReturnType<typeof visualStructuralBoundarySurfaceBlocks>;
      let gap: ReturnType<typeof resolveVisualStructuralKeyboardContextGap>;
      try {
        blocks = visualStructuralBoundarySurfaceBlocks(
          surface,
          sourceMarkdown,
          editMap
        );
        // The one existing keyboard-gap owner: step 1 keeps a canonical caret
        // that already names the break edge, step 2 reads the eligible native
        // root gap for a displaced canonical caret. It rejects an absent gap,
        // two adjacent ambiguous candidates, a protected break and a spacer.
        gap = resolveVisualStructuralKeyboardContextGap(
          surface,
          sourceMarkdown,
          blocks,
          recordedCaret
        );
      } catch {
        return null;
      }
      if (!gap) return null;
      // Its verified return shape names the certified child by EDGE and native
      // child offset only: a 'start' edge is the break AFTER the gap, an 'end'
      // edge the break BEFORE it. No block index is invented.
      const index = 'start' === gap.edge
        ? gap.nativeOffset
        : gap.nativeOffset - 1;
      const candidate = surface.childNodes[index] ?? null;
      const block = blocks[index];
      if (!(candidate instanceof HTMLHRElement)) return null;
      if (candidate.parentNode !== surface) return null;
      if (visualThematicBreakTarget(surface, candidate) !== candidate) {
        return null;
      }
      // The live child must still be the row the certificate proved, and the
      // certified token must be that row's own bytes - not a neighbour's.
      if (
        !block
        || !block.editable
        || block.id !== candidate.getAttribute('data-easymde-visual-block-id')
        || gap.token.start !== block.start
        || gap.token.end > block.end
        || !isVisualThematicBreakSource(sourceMarkdown, {
          end: gap.token.end,
          start: gap.token.start
        })
      ) return null;
      return candidate;
    };

    /**
     * Capture the gesture's target as a witness in the CURRENT canonical
     * source. Capture is pure: it reads this owner's verified ledger, the
     * current source/visual pair and the addressed DOM, and writes nothing,
     * requires no Preview, and never consults the older accepted map.
     */
    const captureCurrentSourceTarget = (
      target: Element | null
    ): FullContextSourceWitness | null => {
      if (!active || externalChangeReportedRef.current) return null;
      if (acceptedMapUnmappedRef.current) return null;
      if (visualTransferFailureReportedRef.current) return null;
      const owned = ownedDomRef.current;
      const source = sourceMarkdownRef.current;
      const visual = visualMarkdownRef.current;
      if (!owned || null === source || null === visual) return null;
      if (owned.owner !== fullOwnerRef.current) return null;
      if (owned.source !== source || owned.visual !== visual) return null;
      if (documentSession.document.getValue() !== source) return null;
      if (!fullOwnedDomMatches(surface, owned)) return null;
      const nativeSelection = surface.ownerDocument.defaultView?.getSelection();
      const canonicalSelection = documentSession.document.getSelection();
      // A keyboard demand passes the SURFACE itself as its target (it has no
      // element under the caret). `contains` is true for the node itself, so the
      // surface must be normalized to "no element target" first: otherwise it is
      // treated as a descendant target, has no block ancestor, and the gesture is
      // lost. The native selection then names the row exactly as before.
      const addressedTarget =
        target && target !== surface && surface.contains(target)
          ? target
          : null;
      const addressedNode = nativeSelection?.anchorNode ?? null;
      if (!addressedTarget && (!addressedNode || !surface.contains(addressedNode)))
        return null;
      // The complete applicability operation is computed ONCE for this capture
      // and reused: it authenticates current ownership before the origin, so a
      // foreign DOM fails closed while an unproved owner transition is the
      // demand's own refresh.
      const applicability = certifyAcceptedMapApplicability();
      let root = addressedTarget
        ? directVisualBlockForSelectionNode(surface, addressedTarget)
        : directVisualBlockForSelectionNode(surface, addressedNode);
      // A surface-edge caret is the one collapsed native selection that has no
      // Text ancestor: the browser keeps it between two top-level children (or
      // before the first / after the last). The readiness gate below is the
      // POSITIVE owner of the edge: the canonical caret must sit exactly on the
      // addressed row's proven content start (caret before it) or content end
      // (caret after the previous row), and the child at that native offset must
      // be a direct row element of this surface. Anything else - an ambiguous
      // edge, a spacer, a protected row, a mismatched canonical caret - is still
      // refused by the existing gap rules.
      let surfaceEdgeRoot = false;
      if (!root && !addressedTarget) {
        if (addressedNode !== surface) return null;
        // A deliberate range can start at the surface itself: selecting the
        // whole article (or a run that begins before its first child) anchors
        // the native selection on the surface, not in a Text node. Its own
        // first addressed child is the row the gesture begins at, and it must
        // be a direct block element of this surface. Nothing is guessed from
        // text, id or a neighbour.
        const nativeRange =
          nativeSelection && 1 === nativeSelection.rangeCount
            ? nativeSelection.getRangeAt(0)
            : null;
        if (
          nativeRange
          && !nativeRange.collapsed
          && nativeRange.startContainer === surface
        ) {
          const candidate = surface.childNodes[nativeRange.startOffset];
          if (candidate instanceof HTMLElement && candidate.parentNode === surface) {
            root = candidate;
          }
        }
        if (!root) {
          // A keyboard activation selects in the parent gap, so no element
          // ancestor exists. The thematic-break shape and the certified keyboard
          // gap are the only two owners here; a bare offset names nothing.
          root = surfaceAnchoredRoot(
            source,
            canonicalSelection.start,
            previewSnapshotRef.current.editMap,
            applicability
          );
        }
        if (
          !root
          && nativeRange
          && nativeRange.collapsed
          && nativeRange.startContainer === surface
          && 'current' === applicability
        ) {
          // The caret before child k addresses child k's content start; the
          // caret after child k-1 addresses that child's content end. Both name
          // the same edge, and the canonical caret check below decides which
          // row really owns it. The row is never promoted from a bare offset,
          // and the certified HR/gap owner above always wins.
          const offset = nativeRange.startOffset;
          const after =
            offset > 0 ? surface.childNodes[offset - 1] : null;
          const before = surface.childNodes[offset] ?? null;
          const candidate =
            before instanceof HTMLElement && before.parentNode === surface
              ? before
              : after instanceof HTMLElement && after.parentNode === surface
                ? after
                : null;
          if (candidate) {
            root = candidate;
            surfaceEdgeRoot = true;
          }
        }
      }
      if (!root) {
          return null;
      }
      // Every row of this owner's source inventory carries the block identity
      // the accepted render published. A mounted top-level element without one
      // (a generated root the accepted map never named) therefore has no formal
      // source row to address, and it is not a target - it is not resolved by
      // position, equal text or a neighbour.
      if (!root.getAttribute('data-easymde-visual-block-id')) {
          return null;
      }
      const record = visualSourceIntervalMapRef.current;
      let intervalMap: VisualMarkdownSourceIntervalMap;
      try {
        intervalMap =
          record
          && record.sourceMarkdown === source
          && record.visualMarkdown === visual
            ? record.map
            : createVisualMarkdownSourceIntervalMap(source, visual);
      } catch {
        return null;
      }
      const snapshot = previewSnapshotRef.current;
      const certificate = mapCertificateRef.current;
      // A row's extent is a property of the CURRENT source and the accepted
      // line topology, not of the row's rendered kind. When the complete
      // operation says this pairing needs one formal refresh, the origin map's
      // line coordinates are still the only exact statement of which lines this
      // element names - provided the very same liveness gate the proof uses
      // holds: the map still names every mounted top-level element, in order,
      // by id, and the accepted line count still describes this source. A
      // changed row kind (a paragraph that became a table) is exactly the case
      // that needs that refresh, and it does not move the lines underneath.
      const acceptedTopology = snapshot.editMap
        && Array.from(surface.children).length === snapshot.editMap.blocks.length
        && Array.from(surface.children).every(
          (element, index) =>
            element.getAttribute('data-easymde-visual-block-id')
              === snapshot.editMap?.blocks[index]?.id
        )
        && certificate
        && 'refresh' === applicability
        && markdownLineStarts(source).length
          === markdownLineStarts(certificate.source).length
        ? snapshot.editMap
        : null;
      const rows =
        'current' === applicability && snapshot.editMap
          ? visualStructuralBoundaryRows(source, snapshot.editMap)
          : acceptedTopology
            ? visualStructuralBoundaryRows(source, acceptedTopology)
            : null;
      const provedExtent = currentRootExtent(
        root,
        source,
        visual,
        intervalMap,
        rows && rows.length === snapshot.editMap?.blocks.length ? rows : null
      );
      // On a pairing the complete operation classified as needing one formal
      // refresh, a changed row's rendered KIND is exactly what no longer
      // matches its accepted serialization, so the per-row comparison above
      // cannot succeed by definition. §5.2's narrower witness is what remains:
      // the accepted line topology still names this element's own lines in the
      // CURRENT source, so its content extent is that row's true bytes. It is
      // used only under those gates, and only to name this gesture's anchor
      // until the one formal render answers.
      const acceptedRowExtent = (): Readonly<{ end: number; start: number }> | null => {
        if (!acceptedTopology) return null;
        const index = Array.from(surface.children).indexOf(root);
        const block = acceptedTopology.blocks[index];
        const row = rows?.[index];
        if (!block || !row || !row.editable) return null;
        if (row.id !== root.getAttribute('data-easymde-visual-block-id')) {
          return null;
        }
        const content = fullRowContentExtent(source, row);
        return content.end > content.start ? content : null;
      };
      const extent = provedExtent ?? acceptedRowExtent();
      if (!extent) return null;
      if (surfaceEdgeRoot) {
        // The row this edge names must be the row the canonical caret is on:
        // a collapsed canonical caret exactly at the row's content start or end.
        // A displaced canonical caret keeps the existing gap refusal.
        if (canonicalSelection.start !== canonicalSelection.end) return null;
        if ('none' !== canonicalSelection.direction) return null;
        if (
          canonicalSelection.start !== extent.start
          && canonicalSelection.start !== extent.end
        ) return null;
      }
      let subtarget: FullContextSubtarget = { kind: 'root' };
      let anchor: Readonly<{ end: number; start: number }> = {
        end: extent.end,
        start: extent.end
      };
      const protectedTarget = protectedSubtargetTarget(
        root,
        addressedTarget,
        extent
      );
      const code = root.matches('pre')
        ? captureVisualCodeInputSnapshot(root)
        : null;
      if (protectedTarget) {
        // A generated/image/link subtarget resolves by its immutable
        // descriptor plus this row's own extent. It never needs an editable
        // Text caret, and no equal-text search is performed.
        subtarget =
          'link' === protectedTarget.kind
            ? {
                ...protectedTarget,
                end: extent.end,
                start: extent.start
              }
            : protectedTarget;
        anchor = { end: extent.end, start: extent.start };
      } else if (code) {
        const interval = codeIntervalAtExtentStart(
          source,
          extent.start,
          extent.end
        );
        if (!interval) return null;
        let projected: ReturnType<typeof projectVisualCodeBodySelection>;
        try {
          projected = projectVisualCodeBodySelection(
            code.code,
            source,
            source,
            interval.codeOrdinal,
            {
              end: { node: code.code, offset: 0 },
              start: { node: code.code, offset: 0 }
            }
          );
        } catch {
          return null;
        }
        if (
          projected.sourceInterval.bodyStart !== interval.bodyStart
          || projected.sourceInterval.bodyEnd !== interval.bodyEnd
          || projected.sourceSelection.start < interval.bodyStart
          || projected.sourceSelection.end > interval.bodyEnd
          || interval.sourceBlockStart !== extent.start
          || interval.sourceBlockEnd > extent.end + 1
          || (null !== code.fence && code.fence !== interval.fence)
        ) return null;
        subtarget = { interval, kind: 'code' };
        anchor = {
          end: projected.sourceSelection.end,
          start: projected.sourceSelection.start
        };
      } else if (addressedNode instanceof Text && root.contains(addressedNode)) {
        // The addressed native boundary is the anchor. It is never promoted to
        // the row's extent, and a boundary the map cannot prove loses the
        // lease rather than falling back to unique text.
        //
        // It is proved against THIS ROW's own source/visual pair, not the
        // document-wide pair. In `captureCurrentSourceTarget` the anchor belongs
        // to exactly one addressed row, and a document-wide map carries the
        // accumulated offset deltas of every unrelated row that precedes it:
        // on the real capability fixture those deltas reach -853 bytes, so the
        // document-wide map reports an offset from a different row entirely.
        // The row source and its own serialization share one pair, so the map
        // for them describes only the bytes this anchor is allowed to name.
        // Both halves are still proved - the prefix through the DOM and the
        // serialized row - and the caller's own `coversMarkdownUnits` and
        // extent-containment guards below are unchanged. A row whose own pair
        // cannot prove the boundary is refused; there is no fallback to the
        // document-wide map.
        const rowSource = source.slice(extent.start, extent.end);
        let rowVisual: string;
        let rowIntervalMap: VisualMarkdownSourceIntervalMap;
        // The projection helper treats a root as its own block only as a
        // DETACHED endpoint clone (the same contract the Windowed owner relies
        // on); an attached root is refused because its position in a wider
        // document is only provable from that document's prefix. This row is
        // exactly the detached endpoint scope, so the proof runs on the row's
        // own clone and the proven boundary is translated back to the live
        // node by path.
        let rowRoot: HTMLElement;
        try {
          rowRoot = root.cloneNode(true) as HTMLElement;
          rowVisual = serializeVisualMarkdownBlockFragment([rowRoot]);
          rowIntervalMap = createVisualMarkdownSourceIntervalMap(
            rowSource,
            rowVisual
          );
        } catch {
          return null;
        }
        const rowNode = (live: Text): Text | null => {
          let current: Node = rowRoot;
          let path: ReadonlyArray<number>;
          try {
            path = visualFragmentNodePath(root, live);
          } catch {
            return null;
          }
          for (const index of path) {
            const child = current.childNodes[index];
            if (!child) return null;
            current = child;
          }
          return current instanceof Text ? current : null;
        };
        const anchorNode = rowNode(addressedNode);
        if (!anchorNode) return null;
        const startOffset = Math.min(
          nativeSelection?.anchorOffset ?? 0,
          addressedNode.data.length
        );
        const focusIsText =
          !nativeSelection?.isCollapsed
          && nativeSelection?.focusNode instanceof Text
          && root.contains(nativeSelection.focusNode);
        const start = mapTextBoundaryFromInterval(
          rowRoot,
          anchorNode,
          startOffset,
          rowVisual,
          rowIntervalMap,
          true
        );
        const focusNode =
          focusIsText
          && nativeSelection?.focusNode instanceof Text
          && root.contains(nativeSelection.focusNode)
            ? rowNode(nativeSelection.focusNode)
            : null;
        const end = focusNode && nativeSelection?.focusNode instanceof Text
          ? mapTextBoundaryFromInterval(
              rowRoot,
              focusNode,
              Math.min(
                nativeSelection.focusOffset,
                focusNode.data.length
              ),
              rowVisual,
              rowIntervalMap,
              true
            )
          : start;
        if (!start || !end) return null;
        // A backward gesture is a real gesture: its two proven boundaries are
        // ordered for the source anchor while `selection.direction` keeps the
        // authored direction, so it is neither rejected nor silently reversed
        // into a different lease. Row-local offsets are absolute again here.
        const ordered = {
          end: Math.max(start.sourceOffset, end.sourceOffset) + extent.start,
          start: Math.min(start.sourceOffset, end.sourceOffset) + extent.start
        };
        if (!coversMarkdownUnits(source, ordered.start, ordered.end)) return null;
        if (ordered.start < extent.start || ordered.end > extent.end) return null;
        anchor = ordered;
      } else if (
        root instanceof HTMLHRElement
        && root.parentNode === surface
        && visualThematicBreakTarget(surface, root) === root
      ) {
        // An authenticated thematic break is a first-class gesture target that
        // has no editable Text at all. Its own accepted source row IS its
        // anchor: the row's content extent must be exactly a thematic-break
        // token, proved with the same helpers the selection owner uses. This is
        // not a generic no-Text fallback - every other no-Text root still fails
        // closed below.
        const blockId = root.getAttribute('data-easymde-visual-block-id');
        const map = snapshot.editMap;
        // The row range is read from the accepted map, so that map must still
        // describe this exact source and DOM. Otherwise this gesture simply
        // parks on the demand's one formal refresh and is re-captured there.
        if ('current' !== applicability) return null;
        const index = map
          ? map.blocks.findIndex((block) => block.id === blockId)
          : -1;
        if (!map || !blockId || 0 > index) return null;
        const mapBlock = map.blocks[index];
        if (!mapBlock || mapBlock.editable !== true) return null;
        let hrRange: Readonly<{ end: number; start: number }>;
        try {
          hrRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
            source,
            map,
            { end: index + 1, start: index }
          );
        } catch {
          return null;
        }
        if (
          hrRange.start !== extent.start
          || !isVisualThematicBreakSource(source, hrRange)
        ) return null;
        anchor = { end: extent.end, start: extent.start };
      } else {
        const boundary = firstEditableTextBoundary(root);
        if (!boundary) return null;
        const mapped = mapTextBoundaryFromInterval(
          surface,
          boundary.node,
          boundary.offset,
          visual,
          intervalMap,
          true
        );
        if (
          !mapped
          || mapped.sourceOffset < extent.start
          || mapped.sourceOffset > extent.end
        ) return null;
        anchor = { end: mapped.sourceOffset, start: mapped.sourceOffset };
        if (code) {
          // A fenced root reached without a native Text anchor still has to
          // name its own fence interval, or resolve would fall back to the bare
          // element with no code identity at all.
          const interval = codeIntervalAtExtentStart(
            source,
            extent.start,
            extent.end
          );
          if (!interval) return null;
          subtarget = { interval, kind: 'code' };
        }
      }
      const currentRevision = documentSession.document.getRevision?.();
      if (!Number.isSafeInteger(currentRevision)) return null;
      return {
        anchor,
        capturedKind: root.tagName.toLowerCase(),
        capturedPreviewRevision: snapshot.revision,
        capturedPreviewSignature: snapshot.signature,
        capturedRoot: root,
        extent,
        owner: fullOwnerRef.current,
        selection: {
          direction: canonicalSelection.direction,
          end: canonicalSelection.end,
          start: canonicalSelection.start
        },
        selectionWasDeliberateRange:
          canonicalSelection.start !== canonicalSelection.end
          || 'none' !== canonicalSelection.direction,
        source,
        sourceRevision: currentRevision as number,
        subtarget
      };
    };

    /**
     * Resolve a captured witness against the freshly accepted render. The
     * MATCH is a source extent plus an immutable subtarget descriptor - the
     * captured DOM kind is never a veto, because a formal render may legally
     * change the kind at the same current extent.
     */
    const resolveCurrentSourceTarget = (
      witness: FullContextSourceWitness
    ): Readonly<{
      element: Element;
      extent: Readonly<{ end: number; start: number }>;
      map: PreviewEditMap;
    }> | null => {
      if (!active || externalChangeReportedRef.current) return null;
      if (visualTransferFailureReportedRef.current) return null;
      // While ANY canonical transfer is outstanding the mounted DOM is the
      // render of the PREVIOUS accepted source, even when that source string is
      // the one this witness names (a held same-source refresh). Resolving there
      // would hand the menu an element the accepted render is about to replace,
      // so the public entry point refuses. The one-shot receipt below does not
      // depend on this: it is consumed by the owner's own publication, not by a
      // demand asking to resolve.
      if (pendingTransferRef.current) return null;
      if ('loading' === previewStatusRef.current) return null;
      const owned = ownedDomRef.current;
      const snapshot = previewSnapshotRef.current;
      if (!owned || !snapshot.editMap) return null;
      if (owned.owner !== fullOwnerRef.current) return null;
      // The accepted generation this owner published must be the live one. A
      // witness from an older render is not re-pointed at a newer one by extent
      // alone, and a surface whose accepted revision has not been captured yet
      // is not ready. This is owner-wide, so it holds for a witness captured
      // before an outstanding splice as well as for one captured now.
      if (capturedPreviewRevisionRef.current !== snapshot.revision) return null;
      // The CURRENT certificate must bind this witness. A dirty source whose
      // accepted map still describes an older document is a refresh, not a
      // resolution: even with no transfer pending and no loading status, the
      // accepted rows are not the ones this gesture was captured against. The
      // approved no-render certificate path is unaffected - `current` is
      // exactly that proved case - and a genuinely accepted response re-binds
      // the SAME lease, which then resolves the fresh row (e.g. a new TABLE).
      if ('current' !== certifyAcceptedMapApplicability()) return null;
      if (owned.source !== witness.source) return null;
      if (owned.sourceRevision !== witness.sourceRevision) return null;
      if (documentSession.document.getValue() !== witness.source) return null;
      if (!fullOwnedDomMatches(surface, owned)) return null;
      let rows: ReturnType<typeof visualStructuralBoundaryRows>;
      try {
        rows = visualStructuralBoundaryRows(witness.source, snapshot.editMap);
      } catch {
        return null;
      }
      if (rows.length !== snapshot.editMap.blocks.length) return null;
      const liveElements = Array.from(surface.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement
      );
      if (liveElements.length !== rows.length) return null;
      const seenIds = new Set<string>();
      for (const [index, row] of rows.entries()) {
        const element = liveElements[index];
        if (!element) return null;
        const id = element.getAttribute('data-easymde-visual-block-id');
        if (!id || id !== row.id || seenIds.has(id)) return null;
        seenIds.add(id);
      }
      const matching = rows.flatMap((row, index) => {
        const content = fullRowContentExtent(witness.source, row);
        return row.editable
          && content.start === witness.extent.start
          && content.end === witness.extent.end
          && witness.anchor.start >= witness.extent.start
          && witness.anchor.end <= content.end
          ? [{ content, index }]
          : [];
      });
      // Exactly one fresh source-backed editable row must own this extent.
      // Duplicate identical roots are distinguished by their source extents, so
      // this cannot borrow a sibling.
      if (1 !== matching.length) return null;
      const match = matching[0];
      if (!match) return null;
      const root = liveElements[match.index];
      if (!root) return null;
      const resolved = {
        element: root as Element,
        extent: match.content,
        map: snapshot.editMap
      };
      const subtarget = witness.subtarget;
      if (
        ('image' === subtarget.kind
          || 'math' === subtarget.kind
          || 'mermaid' === subtarget.kind)
        && protectedPreviewIdentityIsStale()
      ) {
        // A stale generated/image payload is never relabelled into an actionable
        // lease: readiness asks for the one formal refresh instead, and the
        // fresh accepted render then supplies the real identity.
        return null;
      }
      if ('image' === subtarget.kind) {
        const image = enumerateProtected(root, 'img')[subtarget.ordinal];
        if (
          !(image instanceof HTMLImageElement)
          || (image.getAttribute('src') ?? '') !== subtarget.src
          || (image.getAttribute('alt') ?? '') !== subtarget.alt
        ) return null;
        return { ...resolved, element: image };
      }
      if ('math' === subtarget.kind || 'mermaid' === subtarget.kind) {
        const selector =
          'math' === subtarget.kind
            ? '.easymde-math, .easymde-math-block, .easymde-math-inline'
            : '.easymde-mermaid';
        const region = enumerateProtected(root, selector)[subtarget.ordinal];
        if (
          !region
          || (region.getAttribute('data-easymde-visual-markdown-source')
            ?? region.textContent
            ?? '') !== subtarget.source
        ) return null;
        return { ...resolved, element: region };
      }
      if ('link' === subtarget.kind) {
        const link = enumerateProtected(root, 'a')[subtarget.ordinal];
        if (
          !(link instanceof HTMLAnchorElement)
          || (link.getAttribute('href') ?? '') !== subtarget.href
        ) return null;
        return { ...resolved, element: link };
      }
      if ('code' === subtarget.kind) {
        const pre = root.matches('pre')
          ? root
          : root.querySelector<HTMLElement>(':scope > pre');
        if (!pre) return null;
        const input = captureVisualCodeInputSnapshot(pre);
        if (!input) return null;
        const freshId = root.getAttribute('data-easymde-visual-block-id');
        if (!freshId) return null;
        let interval: VisualCodeBodyInterval;
        let projected: ReturnType<typeof projectVisualCodeBodySelection>;
        try {
          // The FRESH accepted map decides which fence this row is, so a
          // renumbered or re-ordered render cannot hand this lease an old
          // ordinal's fence.
          interval = createVisualCodeBodyIntervalForPreviewBlock(
            witness.source,
            snapshot.editMap,
            freshId
          );
          // The accepted replacement's OWN body has to spell the current source
          // body through the code-body projection. An old body, an old ordinal
          // and an equal-looking fence are all insufficient: this is the first
          // point at which the current code DOM exists at all.
          projected = projectVisualCodeBodySelection(
            input.code,
            witness.source,
            witness.source,
            interval.codeOrdinal,
            {
              end: { node: input.code, offset: 0 },
              start: { node: input.code, offset: 0 }
            }
          );
        } catch {
          return null;
        }
        if (
          interval.sourceBlockStart !== match.content.start
          || interval.sourceBlockEnd > match.content.end + 1
          || interval.fence !== subtarget.interval.fence
          || interval.info !== subtarget.interval.info
          || interval.bodyStart < match.content.start
          || projected.sourceInterval.bodyStart !== interval.bodyStart
          || projected.sourceInterval.bodyEnd !== interval.bodyEnd
          || projected.sourceSelection.start < interval.bodyStart
          || projected.sourceSelection.end > interval.bodyEnd
        ) return null;
        if (input.fence !== interval.fence && null !== input.fence) return null;
        return { ...resolved, element: pre };
      }
      // The semantic target: for a table this is the TABLE inside the accepted
      // wrapper, so a changed-kind row still returns the block's real element.
      const semantic =
        root.matches('table')
          ? root
          : root.querySelector<HTMLElement>(':scope > table') ?? root;
      return { ...resolved, element: semantic };
    };

    /**
     * Record the row an accepted resolution bound, so authorized preparation can
     * publish that exact selection instead of re-hitting the old screen point.
     */
    const bindResolvedContextTarget = (
      state: FullContextLeaseState,
      result: NonNullable<ReturnType<typeof resolveCurrentSourceTarget>>
    ): void => {
      if (state.released) return;
      if (contextMenuLeaseRef.current !== state) return;
      resolvedContextTargetRef.current = {
        element: result.element,
        extent: result.extent,
        map: result.map,
        published: false,
        root: result.element instanceof HTMLElement
          ? result.element.closest<HTMLElement>(
              '[data-easymde-visual-block-id]'
            ) ?? result.element
          : state.witness.capturedRoot,
        signature: result.map.signature,
        witness: state.witness
      };
    };

    /**
     * The lease a demand keeps for the life of one gesture. `resolve` is a
     * fresh accepted-read only; the optional receipt is the one synchronous
     * publication this owner performs during a genuine presentation
     * normalization of the same pending transfer.
     */
    const issueContextMenuLease = (
      witness: FullContextSourceWitness,
      allowAcceptedTransition: boolean
    ): EditorContextMenuTargetLease => {
      const state: FullContextLeaseState = {
        lease: {
          release: () => {
            if (state.released) return;
            state.released = true;
            state.publication = null;
            if (contextMenuLeaseRef.current === state) {
              contextMenuLeaseRef.current = null;
              resolvedContextTargetRef.current = null;
            }
          },
          resolve: () => {
            if (state.released) return null;
            const result = resolveCurrentSourceTarget(state.witness);
            if (!result) return null;
            bindResolvedContextTarget(state, result);
            return result.element;
          }
        },
        publication: null,
        released: false,
        witness
      };
      if (allowAcceptedTransition) {
        Object.defineProperty(state.lease, 'consumeAcceptedSelectionTransition', {
          enumerable: true,
          value: (
            before: EditorContextMenuSurfaceSnapshot,
            after: EditorContextMenuSurfaceSnapshot
          ): boolean => {
            const publication = state.publication;
            if (!publication || state.released) return false;
            if (!publication.active || publication.consumed) return false;
            if (publication.lease !== state.lease) return false;
            if (publication.owner !== fullOwnerRef.current) return false;
            if (publication.transfer !== pendingTransferRef.current) return false;
            if (!documentSession.document.isEditable()) return false;
            if (publication.before.value !== before.value) return false;
            if (publication.before.revision !== before.revision) return false;
            if (publication.after.value !== after.value) return false;
            if (publication.after.revision !== after.revision) return false;
            if ('undefined' === typeof before.revision) return false;
            if ('undefined' === typeof after.revision) return false;
            const beforeSelection = before.selection;
            if (
              beforeSelection.start !== publication.before.selection.start
              || beforeSelection.end !== publication.before.selection.end
              || beforeSelection.direction
                !== publication.before.selection.direction
            ) return false;
            const afterSelection = after.selection;
            if (
              afterSelection.start !== publication.after.selection.start
              || afterSelection.end !== publication.after.selection.end
              || afterSelection.direction
                !== publication.after.selection.direction
            ) return false;
            const history = documentHistoryState(documentSession.document);
            if (
              history.undoDepth !== publication.history.undoDepth
              || history.redoDepth !== publication.history.redoDepth
            ) return false;
            if (
              documentSession.document.getValue() !==
              publication.transfer.spec.expectation.value
            ) return false;
            if (!publication.root.isConnected) return false;
            if (!surface.contains(publication.root)) return false;
            // The staged accepted render proved in step 1 must still be the
            // live one. This is NOT a certificate read and does not call
            // resolve: the transfer is deliberately still pending, so the
            // certificate is installed only after this publication.
            const snapshot = previewSnapshotRef.current;
            if (
              snapshot.signature !== publication.previewSignature
              || snapshot.revision !== publication.previewRevision
              || snapshot.editMap?.signature !== publication.editMap.signature
            ) return false;
            // The published caret must be the row this lease proved: the same
            // accepted block id, an editable source row, and exactly the
            // extent the witness recorded. A different row, a noneditable row
            // or a shifted extent is not this publication.
            const publishedId =
              publication.root.getAttribute('data-easymde-visual-block-id');
            if (!publishedId) return false;
            const publishedRow = publication.editMap.blocks.find(
              (block) => block.id === publishedId
            );
            if (!publishedRow || !publishedRow.editable) return false;
            const stateExtent = state.witness.extent;
            if (
              stateExtent.start !== publication.extent.start
              || stateExtent.end !== publication.extent.end
              || stateExtent.start >= stateExtent.end
            ) return false;
            let publishedRows: ReturnType<typeof visualStructuralBoundaryRows>;
            try {
              publishedRows = visualStructuralBoundaryRows(
                publication.transfer.spec.expectation.value,
                publication.editMap
              );
            } catch {
              return false;
            }
            const publishedContent = publishedRows.find(
              (row) => row.id === publishedId
            );
            if (!publishedContent) return false;
            const publishedExtent = fullRowContentExtent(
              publication.transfer.spec.expectation.value,
              publishedContent
            );
            if (
              publishedExtent.start !== publication.extent.start
              || publishedExtent.end !== publication.extent.end
            ) return false;
            // The native caret this owner published must still be inside that
            // same root and still on a non-protected boundary.
            const native = surface.ownerDocument.defaultView?.getSelection();
            if (!native?.isCollapsed) return false;
            if (!native.anchorNode || !publication.root.contains(native.anchorNode)) {
              return false;
            }
            if (
              !acceptedBoundaryAncestryIsEditable(
                native.anchorNode,
                publication.root,
                surface
              )
            ) return false;
            publication.consumed = true;
            return true;
          }
        });
      }
      contextMenuLeaseRef.current = state;
      resolvedContextTargetRef.current = null;
      return state.lease;
    };

    /**
     * Once-only demand preflight. It settles the user-authored native input this
     * owner already accepted, then reports whether the document is still this
     * owner's to describe. It maps no target, places no selection and requests
     * no render: an existing pending Preview is not a preflight failure, because
     * the demand parks on readiness for that render instead.
     */
    const prepareContextMenuDemand = (): boolean => {
      if (!active || externalChangeReportedRef.current) return false;
      // This surface mounted a root its accepted map does not name, so it has
      // no formal source inventory a gesture could be prepared against. That is
      // not a fresh render's staleness: the demand is refused, not refreshed.
      if (acceptedMapUnmappedRef.current) return false;
      if (!surface.isConnected) return false;
      if ('false' === surface.getAttribute('contenteditable')?.toLowerCase()) {
        return false;
      }
      if (composing || pendingComposition) return false;
      if (!flushVisualInput()) return false;
      if (visualTransferFailureReportedRef.current) return false;
      const pending = pendingTransferRef.current;
      if (pending) {
        // An already-pending canonical splice owns an older DOM against a newer
        // canonical source. Preflight succeeds only on the exact operation
        // descriptor this owner recorded: the pending object, its source and
        // revision binding, the real history, and the mounted DOM still being
        // the origin ledger it was derived from. No normal current-map guard is
        // weakened here - readiness still parks on the outstanding render.
        const correspondence = pending.spec.correspondence;
        if (!correspondence) return false;
        if (correspondence.owner !== fullOwnerRef.current) return false;
        if (correspondence.source !== pending.spec.expectation.value)
          return false;
        if (
          documentSession.document.getValue() !==
          pending.spec.expectation.value
        )
          return false;
        if (documentSession.document.getRevision?.()
          !== correspondence.sourceRevision) return false;
        const history = documentHistoryState(documentSession.document);
        if (
          history.undoDepth !== correspondence.history.undoDepth
          || history.redoDepth !== correspondence.history.redoDepth
        ) return false;
        if (correspondence.origin.owner !== fullOwnerRef.current) return false;
        if (!fullOwnedDomMatches(surface, correspondence.origin)) return false;
        const readOnlySnapshot = readOnlySnapshotRef.current;
        if (!readOnlySnapshot) return false;
        try {
          assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
          return serializeVisualMarkdown(surface)
            === correspondence.origin.visual;
        } catch {
          return false;
        }
      }
      if (!documentSession.document.isEditable()) return false;
      return ownedDomIsCurrent();
    };

    /**
     * The one-attempt key for the current document. A repeated readiness
     * evaluation of the same parked demand never posts a second request, while a
     * different owner, source, revision or reason is a genuinely new attempt.
     */
    const currentRefreshAttempt = (
      reason: FullRefreshReason
    ): Readonly<{
      owner: object;
      reason: FullRefreshReason;
      source: string;
      sourceRevision: number;
    }> | null => {
      const source = sourceMarkdownRef.current;
      const revision = documentSession.document.getRevision?.();
      if (null === source || !Number.isSafeInteger(revision)) return null;
      if (documentSession.document.getValue() !== source) return null;
      return {
        owner: fullOwnerRef.current,
        reason,
        source,
        sourceRevision: revision as number
      };
    };

    /** Whether this surface actually mounts a generated or image region. */
    const protectedRegionPresent = (): boolean =>
      Boolean(
        surface.querySelector(
          '.easymde-math, .easymde-math-block, .easymde-math-inline, .easymde-mermaid, img'
        )
      );

    /**
     * Whether the REAL Preview generated/image identity no longer describes the
     * accepted line map this demand would act through. Line-map certification
     * alone cannot relabel a stale generated/image payload, so this asks for one
     * formal refresh; when the owner supplies no identity at all the capability
     * is simply absent and nothing is claimed.
     */
    const protectedPreviewIdentityIsStale = (): boolean => {
      const identity = getGeneratedPreviewIdentity?.() ?? null;
      // An ABSENT identity is not evidence either way: the capability may simply
      // not be installed, and no stale payload is asserted without one.
      if (!identity) return false;
      const snapshot = previewSnapshotRef.current;
      const revision = documentSession.document.getRevision?.();
      if (!snapshot.editMap || !Number.isSafeInteger(revision)) return false;
      if (!protectedRegionPresent()) return false;
      return (
        identity.signature !== snapshot.editMap.signature
        || identity.editMap?.signature !== snapshot.editMap.signature
        || identity.sourceRevision !== (revision as number)
      );
    };

    /**
     * Why this document needs exactly one more formal re-authentication, or
     * null when it needs none. The three states are reported separately so the
     * attempt key can tell them apart.
     */
    const refreshReason = (): FullRefreshReason | null => {
      if ('refresh' === certifyAcceptedMapApplicability()) return 'origin';
      if (!protectedRegionPresent()) return null;
      const identity = getGeneratedPreviewIdentity?.() ?? null;
      if (null === identity) return 'absent';
      return protectedPreviewIdentityIsStale() ? 'stale' : null;
    };

    /**
     * The one outstanding re-authentication this document is still owed, or
     * null when none is due. Eligibility, the single complete applicability
     * operation and the one-attempt key are all decided here, ONCE, so a demand
     * neither duplicates the whole proof nor posts a second request for the same
     * owner/source/revision/reason.
     */
    const pendingRefreshReason = (): FullRefreshReason | null => {
      if (!active || externalChangeReportedRef.current) return null;
      if (visualTransferFailureReportedRef.current) return null;
      if (pendingTransferRef.current) return null;
      const reason = refreshReason();
      if (!reason) return null;
      const attempt = currentRefreshAttempt(reason);
      const previous = refreshAttemptRef.current;
      if (
        !attempt
        || (previous
          && previous.owner === attempt.owner
          && previous.reason === attempt.reason
          && previous.source === attempt.source
          && previous.sourceRevision === attempt.sourceRevision)
      ) return null;
      return reason;
    };

    const needsAcceptedPreviewRefresh = (): boolean =>
      null !== pendingRefreshReason();

    /**
     * Request the one formal Preview this owner needs for the current source,
     * bound to the exact revision, history and selection its acceptance must
     * still match. The parked demand is rebuilt from the same target once that
     * render is accepted - no second renderer and no second gesture.
     */
    const refreshAcceptedPreview = (): boolean => {
      // A terminal failure or a foreign document change ends this owner's
      // attempt for good: there is no request to issue and nothing left to
      // wait for, so this reports false rather than a standing success. This
      // is the same state `pendingRefreshReason` refuses to build a reason in.
      if (
        visualTransferFailureReportedRef.current
        || externalChangeReportedRef.current
      ) return false;
      const reason = pendingRefreshReason();
      if (!reason) {
        // No new request is due. Report success only when this same document
        // already has an attempt recorded for some reason: that request is
        // either still outstanding or was already accepted, and either way the
        // caller's demand keeps waiting on its own readiness rather than being
        // failed. With no recorded attempt there is nothing to wait for.
        const previous = refreshAttemptRef.current;
        if (!previous || pendingTransferRef.current) return false;
        const current = currentRefreshAttempt(previous.reason);
        return Boolean(
          current
          && current.owner === previous.owner
          && current.source === previous.source
          && current.sourceRevision === previous.sourceRevision
        );
      }
      const attempt = currentRefreshAttempt(reason);
      if (!attempt) return false;
      refreshAttemptRef.current = attempt;
      const selection = documentSession.document.getSelection();
      const selectionOrigin = currentAcceptedSelectionOrigin();
      try {
        publishPendingTransfer({
          expectation: {
            history: documentHistoryState(documentSession.document),
            revision: attempt.sourceRevision,
            selection: {
              direction: selection.direction,
              end: selection.end,
              start: selection.start
            },
            value: attempt.source
          },
          kind: 'native',
          placement: { kind: 'accepted-preview' },
          presentation: 'structural',
          ...(selectionOrigin ? { selectionOrigin } : {})
        });
        return true;
      } catch (error) {
        failPendingTransfer(
          visualEditorFailureCode(error, 'visual-editor-native-preview-failed')
        );
        return false;
      }
    };

    /**
     * The witness for a gesture that arrives while a canonical splice is still
     * waiting for its Preview. The old DOM is still mounted, so the record's
     * exact operation descriptor - not a text diff, an old id or a minimal
     * after-value diff - decides which occurrence survived and how far its
     * source window moved.
     */
    const capturePendingSourceTarget = (
      target: Element | null
    ): FullContextSourceWitness | null => {
      const pending = pendingTransferRef.current;
      const correspondence = pending?.spec.correspondence;
      if (!pending || !correspondence) return null;
      const value = pending.spec.expectation.value;
      if (correspondence.owner !== fullOwnerRef.current) return null;
      if (correspondence.source !== value) return null;
      const revision = documentSession.document.getRevision?.();
      if (revision !== correspondence.sourceRevision) return null;
      if (documentSession.document.getValue() !== value) return null;
      const history = documentHistoryState(documentSession.document);
      if (
        history.undoDepth !== correspondence.history.undoDepth
        || history.redoDepth !== correspondence.history.redoDepth
      ) return null;
      const origin = correspondence.origin;
      if (origin.owner !== fullOwnerRef.current) return null;
      if (!fullOwnedDomMatches(surface, origin)) return null;
      const readOnlySnapshot = readOnlySnapshotRef.current;
      if (!readOnlySnapshot) return null;
      try {
        assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
        if (serializeVisualMarkdown(surface) !== origin.visual) return null;
      } catch {
        return null;
      }
      // The surface itself is a keyboard activation, not a descendant target:
      // `contains` is true for the node itself, so it must be normalized away
      // before the structural/native-selection path decides the row.
      const addressedTarget =
        target && target !== surface && surface.contains(target)
          ? target
          : null;
      const addressedNode =
        surface.ownerDocument.defaultView?.getSelection()?.anchorNode ?? null;
      if (!addressedTarget && (!addressedNode || !surface.contains(addressedNode)))
        return null;
      let root = addressedTarget
        ? directVisualBlockForSelectionNode(surface, addressedTarget)
        : directVisualBlockForSelectionNode(surface, addressedNode);
      if (!root && !addressedTarget) {
        // A surface-anchored selection has no element ancestor. While a splice
        // is pending the mounted DOM describes the ORIGIN document, so the
        // canonical caret is in CURRENT-source coordinates and must not be used
        // to pick a gap in the older map. The one shape that is provable without
        // any coordinate mixing is the whole thematic break selected as its own
        // direct child - which is exactly this gesture - so that alone is read
        // here, and every other surface-anchored selection is lost.
        if (addressedNode !== surface) return null;
        root = captureVisualThematicBreakSelection(surface)?.block ?? null;
      }
      if (!root) return null;
      const index = Array.from(surface.childNodes).indexOf(root);
      const originRow = origin.nodes[index];
      if (!originRow || originRow !== root) return null;
      // The certificate must describe the render the origin ledger was taken
      // from, or its rows would be used to name a different document.
      const certificate = mapCertificateRef.current;
      if (
        !certificate
        || certificate.source !== origin.source
        || certificate.visual !== origin.visual
      ) return null;
      const certificateMap = certificate.editMap;
      let originRows: ReturnType<typeof visualStructuralBoundaryRows>;
      try {
        originRows = visualStructuralBoundaryRows(origin.source, certificateMap);
      } catch {
        return null;
      }
      // Rows describe top-level elements in order; the ledger index above is a
      // child-node index, so the row is found by element identity.
      const originElementIndex = Array.from(surface.children).indexOf(root);
      if (0 > originElementIndex) return null;
      const originRowsForIndex = originRows[originElementIndex];
      if (!originRowsForIndex) return null;
      if (
        originRowsForIndex.id
        !== root.getAttribute('data-easymde-visual-block-id')
      ) return null;
      const originExtent = fullRowContentExtent(origin.source, originRowsForIndex);
      const transported = fullTransportedExtent(
        correspondence,
        originExtent,
        correspondence.insertionOwner === root ? root : null
      );
      if (!transported) return null;
      // The captured anchor may be anywhere inside the origin extent; it
      // survives only when it is not removed, so it is transported with the
      // same affinity rule.
      const originSelection = documentSession.document.getSelection();
      // The mounted DOM still spells the ORIGIN visual, so every DOM boundary
      // is read in the origin pair. Offsets are then carried through the
      // operation's own change, never relabelled as current-source offsets.
      let intervalMap: VisualMarkdownSourceIntervalMap;
      try {
        intervalMap = createVisualMarkdownSourceIntervalMap(
          origin.source,
          origin.visual
        );
      } catch {
        return null;
      }
      let subtarget: FullContextSubtarget = { kind: 'root' };
      let anchor: Readonly<{ end: number; start: number }> = {
        end: transported.end,
        start: transported.end
      };
      const protectedTarget = protectedSubtargetTarget(
        root,
        addressedTarget,
        transported
      );
      if (protectedTarget) {
        subtarget =
          'link' === protectedTarget.kind
            ? { ...protectedTarget, end: transported.end, start: transported.start }
            : protectedTarget;
        anchor = { end: transported.end, start: transported.start };
      } else if (root.matches('pre')) {
        // A code target is re-measured in the CURRENT source: an insertion
        // before this fence may have shifted its ordinal, so the old ordinal is
        // never reused. The anchor is the fence's own body start - never the
        // opening line, which is not inside the editable body.
        const interval = codeIntervalAtExtentStart(
          value,
          transported.start,
          transported.end
        );
        if (!interval) return null;
        if (transported.end < interval.bodyStart) return null;
        subtarget = { interval, kind: 'code' };
        anchor = {
          end: interval.bodyStart,
          start: interval.bodyStart
        };
      } else if (
        root instanceof HTMLHRElement
        && root.parentNode === surface
        && visualThematicBreakTarget(surface, root) === root
      ) {
        // A surviving thematic break is a whole-row target with no editable
        // Text, exactly as in the current-source path. Here it must be proved
        // entirely inside the ORIGIN pair: the origin row must be this HR's own
        // editable row and its bytes must be a thematic-break token. The extent
        // was transported through the actual operation descriptor above, so a
        // deletion overlapping this HR loses it (the removed FIRST break cannot
        // be borrowed) while a disjoint deletion plus the surviving DOM reaches
        // this branch. Nothing about the OLD element's id, position or point is
        // reused: `transported` and the token proof are the whole statement.
        if (!originRowsForIndex.editable) return null;
        if (
          !isVisualThematicBreakSource(origin.source, {
            end: originRowsForIndex.end,
            start: originRowsForIndex.start
          })
        ) return null;
        if (transported.start >= transported.end) return null;
        if (!coversMarkdownUnits(value, transported.start, transported.end)) {
          return null;
        }
        // The operation may also have INSERTED bytes inside this window; the
        // current canonical bytes must still spell a thematic break, not a
        // widened or re-tokenised row.
        if (
          !isVisualThematicBreakSource(value, {
            end: transported.end,
            start: transported.start
          })
        ) return null;
        subtarget = { kind: 'root' };
        anchor = { end: transported.end, start: transported.start };
      } else if (addressedNode instanceof Text && root.contains(addressedNode)) {
        const offset = Math.min(
          surface.ownerDocument.defaultView?.getSelection()?.anchorOffset ?? 0,
          addressedNode.data.length
        );
        const originMapped = mapTextBoundaryFromInterval(
          surface,
          addressedNode,
          offset,
          origin.visual,
          intervalMap,
          true
        );
        if (!originMapped) return null;
        const anchorDelta = fullChangeDeltaAt(
          correspondence.change,
          originMapped.sourceOffset
        );
        if (!Number.isSafeInteger(anchorDelta)) return null;
        const currentAnchor = originMapped.sourceOffset + anchorDelta;
        if (
          !Number.isSafeInteger(currentAnchor)
          || currentAnchor < transported.start
          || currentAnchor > transported.end
          || !coversMarkdownUnits(value, currentAnchor, currentAnchor)
        ) return null;
        // The transported anchor must still be inside the LIVE origin bytes the
        // mounted root spells, or it names a point that operation changed.
        if (
          !coversMarkdownUnits(
            origin.source,
            originMapped.sourceOffset,
            originMapped.sourceOffset
          )
        ) return null;
        anchor = { end: currentAnchor, start: currentAnchor };
      } else {
        anchor = { end: transported.end, start: transported.end };
      }
      const snapshot = previewSnapshotRef.current;
      return {
        anchor,
        capturedKind: root.tagName.toLowerCase(),
        capturedPreviewRevision: snapshot.revision,
        capturedPreviewSignature: snapshot.signature,
        capturedRoot: root,
        extent: transported,
        owner: fullOwnerRef.current,
        selection: {
          direction: originSelection.direction,
          end: originSelection.end,
          start: originSelection.start
        },
        selectionWasDeliberateRange:
          originSelection.start !== originSelection.end
          || 'none' !== originSelection.direction,
        source: value,
        sourceRevision: correspondence.sourceRevision,
        subtarget
      };
    };

    /**
     * Capture the gesture's target. While a canonical splice is pending the
     * operation-bound witness owns the read; otherwise the witness is taken in
     * the current canonical source.
     */
    const captureContextMenuTarget = (
      target: Element | null
    ): EditorContextMenuTargetLease | null => {
      if (!active || externalChangeReportedRef.current) return null;
      const pending = pendingTransferRef.current;
      if (pending) {
        if (!pending.spec.correspondence) return null;
        const witness = capturePendingSourceTarget(target);
        if (!witness) return null;
        return issueContextMenuLease(witness, false);
      }
      const witness = captureCurrentSourceTarget(target);
      if (!witness) return null;
      const applicable = certifyAcceptedMapApplicability();
      // The one-shot receipt exists for a collapsed caret on a whole ordinary
      // root whose formal kind may change. A code fence, a protected/image
      // subtarget and a deliberate range each have their own exact policy, and
      // none of them may be reinterpreted through this presentation receipt.
      // A thematic break is a whole-row target with no presentation caret at
      // all, so it can never consume the changed-kind receipt: only a text-
      // bearing ordinary root is eligible, and the capability is not offered to
      // the others at all.
      const publicationEligible = Boolean(
        ('refresh' === applicable || 'current' === applicable)
        && 'root' === witness.subtarget.kind
        && witness.capturedKind !== 'pre'
        && witness.capturedKind !== 'hr'
        && !witness.selectionWasDeliberateRange
      );
      return issueContextMenuLease(witness, publicationEligible);
    };

    const runtime: ImmersiveVisualEditorRuntime = {
      applyCanonicalChange(request) {
        if (
          !active ||
          pendingTransferRef.current ||
          externalChangeReportedRef.current ||
          visualTransferFailureReportedRef.current
        )
          return 'blocked';
        let canonicalApplied = false;
        let commandSelection: VisualHistorySelection | null = null;
        let canonicalReplacement: CanonicalReplacementBoundary | undefined;
        try {
          if (!flushVisualInput()) return 'failed';
          const currentValue = documentSession.document.getValue();
          const currentRevision = documentSession.document.getRevision?.();
          assertVisualCanonicalChangeRequest(
            request,
            currentRevision,
            currentValue,
            documentSession.document.getSelection()
          );
          const readOnlySnapshot = readOnlySnapshotRef.current;
          if (!readOnlySnapshot) {
            throw new Error('visual-editor-read-only-snapshot-missing');
          }
          assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
          // A canonical command publishes a selection from the accepted map, so
          // that map must still describe exactly this DOM and source.
          //
          // The exact-source guard comes first and keeps its own refusal: a
          // missing map, a map from another accepted signature/revision, or a
          // code inventory that names different bytes is a stale MAP, not a
          // stale DOM. Only then does the one complete applicability operation
          // decide the ownership question: a foreign DOM or lost ownership is a
          // refusal, while a legitimate owner-authored transition the older
          // origin cannot describe is the demand's own refresh.
          const editMap = previewSnapshotRef.current.editMap;
          if (!editMap) {
            throw new Error('visual-editor-canonical-change-map-stale');
          }
          if (
            editMap.signature !== previewSnapshotRef.current.signature ||
            capturedPreviewRevisionRef.current !==
              previewSnapshotRef.current.revision
          ) {
            throw new Error('visual-editor-canonical-change-map-stale');
          }
          const applicability = certifyAcceptedMapApplicability();
          if ('invalid' === applicability) {
            throw new Error('visual-editor-canonical-change-dom-stale');
          }
          if ('refresh' === applicability) {
            throw new Error('visual-editor-canonical-change-map-stale');
          }
          // The complete proof above advances the code inventory only when it
          // passed, so this is still the exact-source guard it always was: a
          // memo naming bytes other than the certified current source is a
          // third document and no command may write through it.
          if (visualCodeBodyPreviewSourceRef.current !== currentValue) {
            throw new Error('visual-editor-canonical-change-map-stale');
          }
          assertAcceptedTopLevelVisualSurface(
            surface,
            editMap,
            acceptedHtmlRef.current
          );
          // A removal that takes whole blocks with it can report its caret on
          // whitespace this surface cannot mount or restore, and an edit
          // anchored there merges ambiguously. Commit the nearest surviving
          // editable boundary instead, so the canonical history selection, the
          // requested Preview transfer, and the native restoration all
          // describe one representable position.
          const committedSelection = projectVisualMarkdownRemovalSelection(
            editMap.blocks.map((block, index) =>
              block.editable
                ? {
                    ...createVisualMarkdownSourceRangeFromPreviewEditMap(
                      currentValue,
                      editMap,
                      { end: index + 1, start: index }
                    ),
                    editable: true
                  }
                : null
            ),
            currentValue,
            request.change.changes,
            request.change.selection,
            request.change.value
          );
          const exactReplacement =
            request.expected.selection.start !== request.expected.selection.end &&
            request.change.changes.from === request.expected.selection.start &&
            request.change.changes.to === request.expected.selection.end &&
            request.change.selection.direction === 'none' &&
            request.change.selection.start ===
              request.change.changes.from + request.change.changes.insert.length &&
            request.change.selection.end === request.change.selection.start &&
            committedSelection.direction === request.change.selection.direction &&
            committedSelection.start === request.change.selection.start &&
            committedSelection.end === request.change.selection.end;
          if (exactReplacement) {
            const children = acceptedTopLevelVisualChildren(surface, editMap);
            const blockCandidates = editMap.blocks
              .map((block, index) => ({ block, index }))
              .filter(({ block, index }) => {
                if (!block.editable) return false;
                const range = createVisualMarkdownSourceRangeFromPreviewEditMap(
                  currentValue,
                  editMap,
                  { end: index + 1, start: index }
                );
                return (
                  request.expected.selection.start >= range.start &&
                  request.expected.selection.end <= range.end
                );
              });
            if (blockCandidates.length === 1) {
              const candidate = blockCandidates[0];
              const block = candidate ? children[candidate.index] : undefined;
              const sourceRange = candidate
                ? createVisualMarkdownSourceRangeFromPreviewEditMap(
                    currentValue,
                    editMap,
                    { end: candidate.index + 1, start: candidate.index }
                  )
                : null;
              const blockId = block?.getAttribute(
                'data-easymde-visual-block-id'
              );
              if (block && sourceRange && blockId) {
                const nativeTextSelection =
                  nativeTextReplacementBoundaryForBlock(block);
                if (nativeTextSelection) {
                  const acceptedSelection = acceptedTopLevelVisualSelection(
                    surface,
                    currentValue,
                    editMap,
                    previewSnapshotRef.current.signature,
                    previewSnapshotRef.current.revision,
                    capturedPreviewRevisionRef.current,
                    visualCodeBodyPreviewSourceRef.current
                  );
                  if (
                    !acceptedSelection ||
                    acceptedSelection.direction !==
                      request.expected.selection.direction ||
                    acceptedSelection.start !==
                      request.expected.selection.start ||
                    acceptedSelection.end !== request.expected.selection.end
                  ) {
                    throw new Error(
                      'visual-editor-canonical-change-selection-stale'
                    );
                  }
                  canonicalReplacement =
                    canonicalReplacementBoundaryForBlock(
                      block,
                      blockId,
                      currentValue,
                      sourceRange,
                      request.change.changes,
                      nativeTextSelection
                    ) ?? undefined;
                }
              }
            }
          }
          commandSelection = captureVisualHistorySelection(surface);
          // The actual operation descriptor is derived from the changes this
          // request authorizes, against the exact source it replaces. It is the
          // only thing that says which of two identical occurrences moved.
          const ownedBefore = ownedDomRef.current;
          const verifiedBefore =
            ownedBefore
            && ownedBefore.owner === fullOwnerRef.current
            && ownedBefore.source === currentValue
            && fullOwnedDomMatches(surface, ownedBefore)
              ? ownedBefore
              : null;
          const operationChange = verifiedBefore
            ? fullChangeDescriptor(
                currentValue,
                request.change.value,
                request.change.changes
              )
            : null;
          // The repair's second-HR positive deletes an identical break while
          // the old DOM is still mounted, so the caret this transfer restores
          // has to be described before the write by the same witness helpers a
          // demand uses - never reconstructed from after-the-fact strings.
          const selectionOrigin = verifiedBefore
            ? currentAcceptedSelectionOrigin()
            : null;
          applyDocumentChange(
            {
              changes: request.change.changes,
              recordHistorySelection: true,
              selection: committedSelection,
              value: request.change.value
            },
            {
              validatedCodeStructure: visualCodeStructureCandidate(
                request.change.value
              )
            }
          );
          canonicalApplied = true;
          sourceMarkdownRef.current = request.change.value;
          onMarkdownChange();
          const canonicalRevision = documentSession.document.getRevision?.();
          const canonicalHistory = documentHistoryState(documentSession.document);
          if (canonicalReplacement && undefined === canonicalRevision) {
            throw new Error('visual-editor-canonical-change-revision-unavailable');
          }
          const correspondence =
            verifiedBefore && operationChange
              && Number.isSafeInteger(canonicalRevision)
              ? {
                  change: operationChange,
                  history: canonicalHistory,
                  insertionOwner: null,
                  origin: verifiedBefore,
                  owner: fullOwnerRef.current,
                  source: request.change.value,
                  sourceRevision: canonicalRevision as number
                }
              : undefined;
          publishPendingTransfer({
            expectation: {
              history: canonicalHistory,
              ...(undefined !== canonicalRevision
                ? { revision: canonicalRevision }
                : {}),
              selection: committedSelection,
              value: request.change.value
            },
            kind: 'native',
            placement: { kind: 'accepted-preview' },
            presentation: 'structural',
            ...(canonicalReplacement
              ? { replacement: canonicalReplacement }
              : {}),
            ...(request.change.selectionFallback
              ? { selectionFallback: request.change.selectionFallback }
              : {}),
            ...(selectionOrigin ? { selectionOrigin } : {}),
            ...(correspondence ? { correspondence } : {})
          });
          return 'handled';
        } catch (error) {
          const code =
            error instanceof Error
              ? error.message
              : 'visual-editor-canonical-change-failed';
          if (canonicalApplied) {
            if (pendingTransferRef.current) {
              failPendingTransfer(code);
            } else {
              onFailure(code);
              onTransferFailure();
            }
          } else if (pendingTransferRef.current) {
            failPendingTransfer(code);
          } else {
            onFailure(code);
            if (
              commandSelection &&
              !restoreVisualHistorySelection(surface, commandSelection)
            ) {
              onFailure('visual-editor-command-selection-restore-failed');
            }
          }
          return 'failed';
        }
      },
      executeCommand(command, options) {
        if (
          !active ||
          pendingTransferRef.current ||
          externalChangeReportedRef.current ||
          visualTransferFailureReportedRef.current
        )
          return 'blocked';
        let commandSelection: VisualHistorySelection | null = null;
        let beforeMarkdown: string | null = null;
        try {
          const preservedSelection = contextMenuSelectionRef.current;
          contextMenuSelectionRef.current = null;
          const currentSelection = captureVisualHistorySelection(surface);
          const activeElement = surface.ownerDocument.activeElement;
          const menuHasFocus = activeElement instanceof Element
            && Boolean(
              activeElement.closest('[data-easymde-context-menu-layer]')
            );
          const consumesContextMenuSelection = Boolean(
            preservedSelection
            && (
              currentSelection
                ? visualHistorySelectionEqual(
                    preservedSelection,
                    currentSelection
                  )
                : menuHasFocus
            )
          );
          if (
            consumesContextMenuSelection
            && preservedSelection
            && !restoreVisualHistorySelection(surface, preservedSelection)
          ) return 'failed';
          if (!flushVisualInput()) return 'failed';
          beforeMarkdown = sourceMarkdownRef.current;
          if (null === beforeMarkdown) {
            throw new Error('visual-editor-markdown-snapshot-missing');
          }
          const before = captureVisualHistorySnapshot(beforeMarkdown);
          commandSelection = captureVisualHistorySelection(surface);
          const restoreCommandSelection = (): void => {
            if (
              commandSelection &&
              !restoreVisualHistorySelection(surface, commandSelection)
            ) {
              onFailure('visual-editor-command-selection-restore-failed');
            }
          };
          const codeBlocksBefore = new Set(visualCodePreOrder());
          const commandPrecedingNodes = Array.from(surface.childNodes);
          const acceptedTopLevelWindow = captureAcceptedTopLevelVisualWindow(
            surface,
            beforeMarkdown,
            previewSnapshotRef.current.editMap,
            previewSnapshotRef.current.signature,
            previewSnapshotRef.current.revision,
            capturedPreviewRevisionRef.current,
            visualCodeBodyPreviewSourceRef.current
          );
          if (!applyVisualToolbarCommand(surface, command)) {
            return 'unsupported';
          }
          const localCodeBodyPre = newlyCreatedVisualCodePre(
            surface,
            codeBlocksBefore
          );
          if (
            !synchronizeMarkdown({
              acceptedTopLevelSelection: true,
              acceptedTopLevelWindow,
              preferVisualSelection: true,
              ...(localCodeBodyPre ? { localCodeBodyPre } : {}),
              ownerCommandBefore: commandPrecedingNodes
            })
          ) {
            if (
              beforeMarkdown !== null &&
              sourceMarkdownRef.current === beforeMarkdown &&
              documentSession.document.getValue() === beforeMarkdown
            ) {
              restoreCommandSelection();
            }
            return 'failed';
          }
          const afterMarkdown = sourceMarkdownRef.current;
          if (null === afterMarkdown) {
            throw new Error('visual-editor-markdown-snapshot-missing');
          }
          const after = captureVisualHistorySnapshot(afterMarkdown);
          if (before.markdown !== after.markdown) {
            appendVisualHistoryTransition(before, after);
            const selection =
              typeof documentSession.document.getSelection === 'function'
                ? documentSession.document.getSelection()
                : {
                    direction: 'none' as const,
                    end: afterMarkdown.length,
                    start: afterMarkdown.length
                  };
            if (acceptedTopLevelWindow || options?.requestPreviewTransfer) {
              const revision = documentSession.document.getRevision?.();
              publishPendingTransfer({
                expectation: {
                  history: documentHistoryState(documentSession.document),
                  ...(undefined !== revision ? { revision } : {}),
                  selection,
                  value: afterMarkdown
                },
                kind: 'native',
                placement: { kind: 'accepted-preview' },
                presentation: 'structural'
              });
            }
          }
          focusVisualSurface(surface);
          return 'handled';
        } catch (error) {
          let result = false;
          if (pendingTransferRef.current) {
            failPendingTransfer(
              visualEditorFailureCode(
                error,
                'visual-editor-markdown-preview-failed'
              )
            );
          } else {
            result = failVisualSynchronization(error);
          }
          if (
            result === false &&
            beforeMarkdown !== null &&
            sourceMarkdownRef.current === beforeMarkdown &&
            documentSession.document.getValue() === beforeMarkdown
          ) {
            // The accepted snapshot may have replaced the command's DOM nodes.
            // Reapply the command-local native range after that recovery.
            if (
              commandSelection &&
              !restoreVisualHistorySelection(surface, commandSelection)
            ) {
              onFailure('visual-editor-command-selection-restore-failed');
            }
          }
          return 'failed';
        }
      },
      getGeneratedPreviewIdentity: () =>
        getGeneratedPreviewIdentity?.() ?? null,
      isEditable: () => {
        const value = Boolean(
          active &&
            !pendingTransferRef.current &&
            !externalChangeReportedRef.current &&
            !visualTransferFailureReportedRef.current
        );
        return value;
      },
      isTransferPending: () =>
        Boolean(
          pendingTransferRef.current ||
            externalChangeReportedRef.current ||
            visualTransferFailureReportedRef.current ||
            sourceMarkdownRef.current !== documentSession.document.getValue()
        ),
      prepareGeneratedContentTarget: (request) =>
        prepareGeneratedContentTarget?.(request) ?? null,
      prepareGeneratedContentTargetForSelection: (request) =>
        prepareGeneratedContentTargetForSelection?.(request) ?? null,
      prepareImageTarget: (request) => prepareImageTarget?.(request) ?? null,
      prepareImageTargetBySelection: (request) =>
        prepareImageTargetBySelection?.(request) ?? null,
      prepareMediaSelection() {
        if (
          externalChangeReportedRef.current ||
          visualTransferFailureReportedRef.current
        )
          return false;
        if (!flushVisualInput()) return false;
        return synchronizeMarkdown({
          acceptedTopLevelSelection: true,
          mapSelectionWhenUnchanged: true
        });
      },
      needsAcceptedPreviewRefresh: needsAcceptedPreviewRefresh,
      refreshAcceptedPreview: refreshAcceptedPreview,
      prepareContextMenuDemand: prepareContextMenuDemand,
      captureContextMenuTarget: captureContextMenuTarget,
      prepareContextMenuSelection(target, point, activation = 'keyboard') {
        // The active resolved-target binding is consulted BEFORE any point or
        // caret fallback. After a cross-generation resolve the old screen point
        // cannot choose a block: the resolved binding already names the block
        // this gesture owns, in the accepted source the owner proved.
        const leaseState = contextMenuLeaseRef.current;
        const resolved = resolvedContextTargetRef.current;
        // The element this preparation acts on. It starts as the gesture's own
        // hit target and is replaced only by the fresh resolved element below,
        // never by an old point or a retired node.
        let preparedTarget = target;
        const prepareResolved = (
          binding: FullResolvedContextTarget
        ): boolean => {
          try {
            const root = binding.root;
            if (!root.isConnected || !surface.contains(root)) {
              return false;
            }
            if (documentSession.document.getValue() !== binding.witness.source) {
              return false;
            }
            // The binding names one accepted map; a surface that has since been
            // re-rendered is a different topology and must not publish this row.
            const snapshot = previewSnapshotRef.current;
            if (
              !snapshot.editMap
              || snapshot.editMap !== binding.map
              || snapshot.editMap.signature !== binding.signature
            ) return false;
            // This whole-row publication is the CHANGED-KIND completion only.
            // A same-kind root keeps its existing specialized owner rules, so
            // an ordinary paragraph gesture is never widened into a whole-text
            // row selection just because it came through a fresh resolve.
            if (
              'root' !== binding.witness.subtarget.kind
              || binding.witness.capturedKind === root.tagName.toLowerCase()
            ) return false;
            // The published range is the row's authenticated CONTENT extent in
            // the accepted source, and it must still be a real source-backed
            // editable row of the accepted map that produced this binding.
            if (
              binding.extent.start >= binding.extent.end
              || !coversMarkdownUnits(
                binding.witness.source,
                binding.extent.start,
                binding.extent.end
              )
            ) return false;
            let rows: ReturnType<typeof visualStructuralBoundaryRows>;
            try {
              rows = visualStructuralBoundaryRows(
                binding.witness.source,
                binding.map
              );
            } catch {
              return false;
            }
            const blockId = root.getAttribute('data-easymde-visual-block-id');
            const rowIsEditable = rows.some((row) => {
              if (!row.editable || row.id !== blockId) return false;
              const content = fullRowContentExtent(
                binding.witness.source,
                row
              );
              return (
                content.start === binding.extent.start
                && content.end === binding.extent.end
              );
            });
            if (!rowIsEditable) return false;
            const selection = surface.ownerDocument.defaultView?.getSelection();
            if (!selection) return false;
            const range = surface.ownerDocument.createRange();
            range.selectNode(root);
            selection.removeAllRanges();
            selection.addRange(range);
            const selectionSnapshot = captureVisualHistorySelection(surface);
            contextMenuSelectionRef.current = selectionSnapshot;
            applyDocumentChange({
              selection: {
                direction: 'none',
                end: binding.extent.end,
                start: binding.extent.start
              },
              value: binding.witness.source
            });
            binding.published = true;
            return true;
          } catch (error) {
            return failVisualSynchronization(error);
          }
        };
        if (
          leaseState
          && !leaseState.released
          && resolved
          && resolved.witness === leaseState.witness
          && !resolved.witness.selectionWasDeliberateRange
          && 'root' === resolved.witness.subtarget.kind
          && resolved.witness.capturedKind
            !== resolved.root.tagName.toLowerCase()
          // The whole-row publication belongs to the KIND TRANSITION and to a
          // gesture that addresses the WHOLE row: either the menu prepared the
          // resolved semantic element (the table inside its wrapper), or the
          // author made a deliberate native range across the accepted row. A
          // collapsed caret inside one cell is an ordinary table gesture and
          // keeps the table's own caret rules, never a whole-row expansion.
          && !resolved.published
          && (
            preparedTarget === resolved.element
            || 'straddling' !== classifyVisualSelectionProvenance(
              surface,
              surface.ownerDocument.defaultView?.getSelection()
            )
            && Boolean(
              surface.ownerDocument.defaultView?.getSelection()?.isCollapsed
                === false
            )
          )
        ) {
          return prepareResolved(resolved);
        }
        // A same-kind, protected or deliberate-range binding keeps its existing
        // specialized rule, but it must run against the FRESH accepted element
        // this resolve proved - never the retired one the gesture hit.
        if (
          leaseState
          && !leaseState.released
          && resolved
          && resolved.witness === leaseState.witness
        ) {
          // The gesture hit an element the accepted render may have retired;
          // the fresh resolve already named the replacement for that same
          // subtarget, and the specialized rules read the element, not the row.
          preparedTarget = resolved.element instanceof HTMLElement
            ? resolved.element
            : resolved.root;
        }
        if (
          pendingTransferRef.current
          || externalChangeReportedRef.current
          || visualTransferFailureReportedRef.current
        ) {
          // A pending transfer owns an unsettled document/Preview pair; no
          // selection may be mapped against it. Reject the gesture explicitly
          // instead of mapping through a stale edit map.
          return false;
        }
        const provenance = classifyVisualSelectionProvenance(
          surface,
          surface.ownerDocument.defaultView?.getSelection()
        );
        if ('straddling' === provenance) {
          // A selection that straddles or encloses the editable surface keeps
          // the browser's own selection: overwriting it with an image or
          // caret would silently discard the user's intent, so the gesture is
          // rejected explicitly instead.
          return false;
        }
        const pointerThematicBreak = preparedTarget?.closest('hr');
        const currentThematicBreak = captureVisualThematicBreakSelection(surface);
        const selectionForThematic = surface.ownerDocument.defaultView?.getSelection();
        const preservesOwnedSelection = Boolean(
          'pointer' === activation
          && pointerThematicBreak
          && 'owned' === provenance
          && selectionForThematic
          && !selectionForThematic.isCollapsed
          && (
            !currentThematicBreak
            || currentThematicBreak.block !== pointerThematicBreak
          )
        );
        const preparesThematicBreak = Boolean(
          ('keyboard' === activation && currentThematicBreak)
          || ('pointer' === activation && pointerThematicBreak && !preservesOwnedSelection)
        );
        if (preparesThematicBreak) {
          let pointerPreparation: VisualThematicBreakPointerPreparation | null = null;
          try {
            const source = sourceMarkdownRef.current;
            const snapshot = previewSnapshotRef.current;
            const editMap = snapshot.editMap;
            if (
              !source
              || documentSession.document.getValue() !== source
              || !editMap
              || editMap.signature !== snapshot.signature
              || capturedPreviewRevisionRef.current !== snapshot.revision
              || visualCodeBodyPreviewSourceRef.current !== source
              || 1 !== editMap.version
              || 'line' !== editMap.coordinate
            ) throw new Error('visual-editor-selection-map-failed');
            const readOnlySnapshot = readOnlySnapshotRef.current;
            if (!readOnlySnapshot) throw new Error('visual-editor-read-only-snapshot-missing');
            assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
            assertAcceptedTopLevelVisualSurface(surface, editMap, acceptedHtmlRef.current, acceptedNodesRef.current);
            const targetBlock = 'pointer' === activation
              ? pointerThematicBreak
              : currentThematicBreak?.block;
            const children = acceptedTopLevelVisualChildren(surface, editMap);
            const blockIndex = targetBlock ? children.indexOf(targetBlock) : -1;
            const mapBlock = blockIndex >= 0 ? editMap.blocks[blockIndex] : undefined;
            if (
              !targetBlock
              || !mapBlock
              || mapBlock.id !== targetBlock.getAttribute('data-easymde-visual-block-id')
              || !mapBlock.editable
            ) throw new Error('visual-editor-selection-map-failed');
            const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
              source,
              editMap,
              { end: blockIndex + 1, start: blockIndex }
            );
            if ('pointer' === activation) {
              pointerPreparation = prepareVisualThematicBreakPointerSelection(
                surface,
                pointerThematicBreak
              );
              if (!pointerPreparation) throw new Error('visual-editor-selection-map-failed');
            }
            const thematicBreak = captureVisualThematicBreakSelection(surface);
            if (!thematicBreak || thematicBreak.block !== targetBlock) {
              throw new Error('visual-editor-selection-map-failed');
            }
            const preparedThematicSelection = captureVisualHistorySelection(surface);
            contextMenuSelectionRef.current = null;
            const finishThematicPreparation = (result: boolean): boolean => {
              if (result) contextMenuSelectionRef.current = preparedThematicSelection;
              return result;
            };
            applyDocumentChange({
              selection: visualThematicBreakSourceSelection(
                source,
                sourceRange,
                thematicBreak.direction
              ),
              value: source
            });
            return finishThematicPreparation(true);
          } catch (error) {
            pointerPreparation?.restore();
            return failVisualSynchronization(error);
          }
        }
        // A keyboard activation has no target element: the feature passes
        // the surface itself, so the generic caret placement below would
        // either fail or move the caret into a descendant and lose the
        // certified parent gap.
        if ('keyboard' === activation) {
          const native = surface.ownerDocument.defaultView?.getSelection();
          const nativeRange = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
          const isEligibleRootGap = Boolean(
            native?.isCollapsed
            && nativeRange?.collapsed
            && native.anchorNode === surface
            && native.focusNode === surface
            && native.anchorOffset === native.focusOffset
            && (
              surface.childNodes[native.anchorOffset] instanceof HTMLHRElement
              || surface.childNodes[native.anchorOffset - 1] instanceof HTMLHRElement
            )
          );
          if (isEligibleRootGap && native) {
            try {
              const source = sourceMarkdownRef.current;
              const snapshot = previewSnapshotRef.current;
              const editMap = snapshot.editMap;
              if (
                !source
                || documentSession.document.getValue() !== source
                || !editMap
                || editMap.signature !== snapshot.signature
                || capturedPreviewRevisionRef.current !== snapshot.revision
                || visualCodeBodyPreviewSourceRef.current !== source
                || 1 !== editMap.version
                || 'line' !== editMap.coordinate
              ) throw new Error('visual-editor-selection-map-failed');
              const readOnlySnapshot = readOnlySnapshotRef.current;
              if (!readOnlySnapshot) throw new Error('visual-editor-read-only-snapshot-missing');
              assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
              assertAcceptedTopLevelVisualSurface(surface, editMap, acceptedHtmlRef.current, acceptedNodesRef.current);
              const blocks = visualStructuralBoundaryBlocks(
                surface,
                visualStructuralBoundaryRows(source, editMap)
              );
              const canonicalSelection = documentSession.document.getSelection?.();
              const canonicalPoint =
                canonicalSelection
                && 'none' === canonicalSelection.direction
                && canonicalSelection.start === canonicalSelection.end
                  ? canonicalSelection.start
                  : -1;
              const resolved = resolveVisualStructuralKeyboardContextGap(
                surface,
                source,
                blocks,
                canonicalPoint
              );
              if (resolved) {
                contextMenuSelectionRef.current = captureVisualHistorySelection(
                  surface,
                  () => ({
                    blocks,
                    recordedCaret: resolved.selection.start,
                    sourceMarkdown: source,
                  })
                );
                applyDocumentChange({
                  selection: resolved.selection,
                  value: source,
                });
                return true;
              }
              // Ambiguous (e.g. 2 adjacent HRs without canonical tie-breaker),
              // foreign, stale, or mutated: fail closed
              return failVisualSynchronization(new Error('visual-editor-selection-map-failed'));
            } catch (error) {
              return failVisualSynchronization(error);
            }
          }
        }
        imageInteraction.select(preparedTarget, activation);
        let preparedSelection: VisualHistorySelection | null = null;
        try {
          preparedSelection = captureVisualHistorySelection(surface);
        } catch {
          preparedSelection = null;
        }
        contextMenuSelectionRef.current = null;
        const finishPreparation = (result: boolean): boolean => {
          if (result) contextMenuSelectionRef.current = preparedSelection;
          return result;
        };
        const pre = preparedTarget?.closest('pre');
        const preOwner = pre
          ? directVisualBlockForSelectionNode(surface, pre)
          : null;
        const isDirectPre = Boolean(pre && preOwner === pre);
        let nativeSelection = surface.ownerDocument.defaultView?.getSelection();
        const selectionInsideSurface = Boolean(
          nativeSelection?.anchorNode
          && nativeSelection.focusNode
          && nativeSelection.anchorNode.isConnected
          && nativeSelection.focusNode.isConnected
          && surface.contains(nativeSelection.anchorNode)
          && surface.contains(nativeSelection.focusNode)
        );
        if (!selectionInsideSurface && !isDirectPre) {
          if (!placeVisualContextMenuCaret(surface, preparedTarget ?? null, point)) {
            return finishPreparation(false);
          }
          nativeSelection = surface.ownerDocument.defaultView?.getSelection();
        }
        if (!pre || !surface.contains(pre)) {
          return finishPreparation(this.prepareMediaSelection());
        }
        if (preparedSelection && nativeSelection && !nativeSelection.isCollapsed) {
          return finishPreparation(this.prepareMediaSelection());
        }
        try {
          const snapshot = previewSnapshotRef.current;
          const editMap = snapshot.editMap;
          if (!editMap) return finishPreparation(this.prepareMediaSelection());
          const children = acceptedTopLevelVisualChildren(surface, editMap);
          const owner = directVisualBlockForSelectionNode(surface, pre);
          if (owner !== pre) return finishPreparation(this.prepareMediaSelection());
          const blockIndex = children.indexOf(pre);
          const source = sourceMarkdownRef.current;
          if (blockIndex < 0 || null === source) {
            return finishPreparation(this.prepareMediaSelection());
          }
          // This publishes a canonical selection from the accepted map, so the
          // map must still describe this exact source. A local edit whose
          // committed delta moved a line leaves the accepted source behind; if
          // that were ignored here, the block range would be cut from a
          // document whose fence moved - omitting its closing ticks for Copy
          // and turning them into a new opener for Cut. Every consumer of the
          // accepted map (this selection publication, Copy/Cut, row
          // projection, code commands) therefore shares one lease: the same
          // edit map published by the same accepted render for this source.
          if (
            editMap.signature !== snapshot.signature
            || capturedPreviewRevisionRef.current !== snapshot.revision
            || 1 !== editMap.version
            || 'line' !== editMap.coordinate
          ) {
            return failVisualSynchronization(
              new Error('visual-editor-canonical-change-map-stale')
            );
          }
          // Every consumer of the accepted map shares the one complete
          // certificate. It authenticates current ownership first, then the
          // formal origin, then the whole-row/gap proof: a foreign DOM fails,
          // and an unproved topology asks for the demand's single formal
          // re-authentication so the same gesture rebuilds against it.
          const applicability = certifyAcceptedMapApplicability();
          if ('invalid' === applicability) {
            return failVisualSynchronization(
              new Error('visual-editor-canonical-change-dom-stale')
            );
          }
          if ('refresh' === applicability) {
            if (needsAcceptedPreviewRefresh()) {
              refreshAcceptedPreview();
              return finishPreparation(false);
            }
            return failVisualSynchronization(
              new Error('visual-editor-canonical-change-map-stale')
            );
          }
          const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
            source,
            editMap,
            { end: blockIndex + 1, start: blockIndex }
          );
          // This publishes the fence's own source range, so the accepted
          // replacement's body must still spell the current source body
          // through the code-body projection: an old body or a stale ordinal
          // here would Cut the wrong bytes.
          const codeInput = captureVisualCodeInputSnapshot(pre);
          const mapBlockId = editMap.blocks[blockIndex]?.id;
          if (codeInput && mapBlockId) {
            let codeValid = false;
            try {
              const interval = createVisualCodeBodyIntervalForPreviewBlock(
                source,
                editMap,
                mapBlockId
              );
              const projected = projectVisualCodeBodySelection(
                codeInput.code,
                source,
                source,
                interval.codeOrdinal,
                {
                  end: { node: codeInput.code, offset: 0 },
                  start: { node: codeInput.code, offset: 0 }
                }
              );
              codeValid =
                interval.sourceBlockStart >= sourceRange.start
                && interval.sourceBlockEnd <= sourceRange.end
                && projected.sourceInterval.bodyStart === interval.bodyStart
                && projected.sourceInterval.bodyEnd === interval.bodyEnd;
            } catch {
              codeValid = false;
            }
            if (!codeValid) {
              return failVisualSynchronization(
                new Error('visual-editor-code-body-map-stale')
              );
            }
          }
          applyDocumentChange({
            selection: {
              direction: 'none',
              end: sourceRange.end,
              start: sourceRange.start
            },
            value: source
          });
          return finishPreparation(true);
        } catch (error) {
          return failVisualSynchronization(error);
        }
      },
      prepareSourceNavigation(expected) {
        if (
          !active ||
          externalChangeReportedRef.current ||
          visualTransferFailureReportedRef.current
        )
          return false;
        try {
          if (!flushVisualInput()) return false;
          const revision = documentSession.document.getRevision?.();
          if (
            !Number.isSafeInteger(expected.revision) ||
            expected.revision < 0 ||
            undefined === revision ||
            revision !== expected.revision ||
            documentSession.document.getValue() !== expected.value ||
            sourceMarkdownRef.current !== expected.value
          ) {
            throw new Error('visual-editor-source-navigation-stale');
          }
          const readOnlySnapshot = readOnlySnapshotRef.current;
          if (!readOnlySnapshot) {
            throw new Error('visual-editor-read-only-snapshot-missing');
          }
          assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
          const acceptedVisualMarkdown = visualMarkdownRef.current;
          if (
            null === acceptedVisualMarkdown ||
            serializeVisualMarkdown(surface) !== acceptedVisualMarkdown
          ) {
            throw new Error('visual-editor-source-navigation-dom-stale');
          }
          return true;
        } catch (error) {
          onFailure(
            visualEditorFailureCode(
              error,
              'visual-editor-source-navigation-failed'
            )
          );
          return false;
        }
      },
      prepareToolbarFallback() {
        if (
          composing ||
          compositionCommitScheduled ||
          externalChangeReportedRef.current ||
          visualTransferFailureReportedRef.current
        )
          return false;
        const flushed = flushVisualInput();
        if (!flushed) return false;
        const pending = pendingTransferRef.current;
        if (!pending && !visualBaselineMaterializedRef.current) {
          try {
            const readOnlySnapshot = readOnlySnapshotRef.current;
            if (!readOnlySnapshot) {
              throw new Error('visual-editor-read-only-snapshot-missing');
            }
            assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
            materializeVisualBaseline();
          } catch (error) {
            return failVisualSynchronization(error);
          }
        }
        if (!pending) {
          const selection = surface.ownerDocument.defaultView?.getSelection();
          if (
            !selection?.anchorNode ||
            !selection.focusNode ||
            !surface.contains(selection.anchorNode) ||
            !surface.contains(selection.focusNode)
          )
            return synchronizeMarkdown();
          return synchronizeMarkdown({ mapSelectionWhenUnchanged: true });
        }
        const historyTransfer = 'history' === pending.spec.kind;
        try {
          const expectation = pending.spec.expectation;
          const observation = readCanonicalObservation(documentSession.document, {
            history: historyTransfer,
            revision: false,
            selection: true,
            value: true
          });
          const mismatch = canonicalExpectationMismatch(
            expectation,
            observation,
            {
              history: historyTransfer,
              revision: false,
              selection: true,
              value: true
            }
          );
          if ('value' === mismatch) {
            throw new Error(
              historyTransfer
                ? 'visual-editor-history-preview-stale'
                : 'visual-editor-markdown-paste-document-stale'
            );
          }
          if ('selection' === mismatch) {
            throw new Error(
              historyTransfer
                ? 'visual-editor-history-preview-stale'
                : 'visual-editor-markdown-paste-selection-stale'
            );
          }
          if (mismatch) throw new Error('visual-editor-history-preview-stale');
          const slotProof = pending.spec.historyProof?.slot;
          if (historyTransfer && slotProof) {
            const slot = visualHistorySnapshotsRef.current.get(slotProof.depth);
            if (
              !slot ||
              slot !== slotProof.value ||
              slot.kind !== 'rematerialize' ||
              slot.markdown !== expectation.value ||
              slotProof.depth !== observation.history?.undoDepth
            ) {
              throw new Error('visual-editor-history-preview-stale');
            }
          }
          return true;
        } catch (error) {
          failPendingTransfer(
            visualEditorFailureCode(
              error,
              historyTransfer
                ? 'visual-editor-history-preview-stale'
                : 'visual-editor-markdown-paste-commit-failed'
            )
          );
          return false;
        }
      },
      surface
    };
    onReady(runtime);
    return () => {
      active = false;
      ownedEmptyParagraphRef.current = null;
      activeRef.current = false;
      pendingCanonicalCompositionRef.current = false;
      pendingComposition = null;
      imageInteraction.dispose();
      let cleanupError: unknown = null;
      try {
        flushVisualInput();
      } catch (error) {
        cleanupError = error;
      }
      const continuity = emptyParagraphHistoryRef.current;
      if (continuity) {
        const slot = visualHistorySnapshotsRef.current.get(continuity.depth);
        if (slot?.kind === 'snapshot'
          && slot.markdown === continuity.markdown
          && slot.snapshot.historyState.undoDepth === continuity.historyUndoDepth
          && documentHistoryState(documentSession.document).undoDepth >= continuity.depth) {
          fullRemountEmptyParagraphContinuity.set(documentSession.document, {
            depth: continuity.depth,
            historyUndoDepth: continuity.historyUndoDepth,
            markdown: continuity.markdown,
            sourceOffset: continuity.sourceOffset
          });
        }
      }
      // Every demand-owned record is revoked BEFORE any callback can wake a
      // reader: the lease and its one-shot publication, the resolved binding,
      // and the transfer that could still be normalized. This runs after the
      // final user-authored input flush but before the document session can
      // publish a teardown notification, and before onDispose, so a callback
      // observing a half-torn-down owner finds nothing it may consume.
      const leaseState = contextMenuLeaseRef.current;
      if (leaseState) {
        leaseState.released = true;
        leaseState.publication = null;
      }
      contextMenuLeaseRef.current = null;
      resolvedContextTargetRef.current = null;
      pendingTransferRef.current = null;
      try {
        documentSession.document.setVisualEditingActive(false);
      } catch (error) {
        cleanupError ??= error;
      }
      onDispose(runtime);
      codeBlockOrderObserver.disconnect();
      visualHistoryDomPairObserverRef.current = null;
      visualHistoryDomPairTokenRef.current += 1;
      if (
        visualCodeBodyDomOrderObserverRef.current === codeBlockOrderObserver
      ) {
        visualCodeBodyDomOrderObserverRef.current = null;
      }
      surface.removeEventListener('compositionstart', handleCompositionStart);
      surface.removeEventListener('compositionend', handleCompositionEnd);
      surface.removeEventListener('drop', handleDrop);
      surface.removeEventListener('beforeinput', handleBeforeInput);
      surface.removeEventListener('pointerdown', handlePendingPointerDown);
      surface.removeEventListener('input', handleInput);
      surface.removeEventListener('keydown', handleKeyDown);
      surface.removeEventListener('paste', handlePaste);
      surface.ownerDocument.removeEventListener(
        'selectionchange',
        handleContextMenuSelectionChange,
        true
      );
      surface.removeEventListener('focusin', handleContextMenuSurfaceFocus);
      contextMenuSelectionRef.current = null;
      // The remaining owner state is invalidated here: the one native
      // structural record and the owned pairing/certificate the revoked lease
      // was proved against.
      pendingNativeOperationRef.current = null;
      ownedDomRef.current = null;
      mapCertificateRef.current = null;
      refreshAttemptRef.current = null;
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
        visualInputTimerRef.current = null;
      }
      if (null !== canonicalAdoptionDeadlineRef.current) {
        clearTimeout(canonicalAdoptionDeadlineRef.current);
        canonicalAdoptionDeadlineRef.current = null;
      }
      visualInputPendingRef.current = false;
      pendingUnmappedVisualInputRef.current = false;
      continuingUnmappedVisualInputRef.current = false;
      flushVisualInputRef.current = () => true;
      onPendingChange(false);
      if (cleanupError) {
        throw cleanupError;
      }
    };
  }, [
    appendVisualHistoryTransition,
    captureSnapshot,
    captureVisualHistorySnapshot,
    consumeVisualDomMutations,
    applyDocumentChange,
    failVisualSynchronization,
    failPendingTransfer,
    documentSession,
    imageUploadEnabled,
    imagePasteUploadEnabled,
    onDispose,
    onFailure,
    onMarkdownChange,
    onPendingChange,
    onReady,
    onTransferFailure,
    materializeVisualBaseline,
    prepareGeneratedContentTarget,
    prepareGeneratedContentTargetForSelection,
    prepareImageTargetBySelection,
    recordCurrentVisualHistorySnapshot,
    requestMarkdownTransfer,
    publishPendingTransfer,
    surface,
    synchronizeMarkdown
  ]);

  return null;
}
