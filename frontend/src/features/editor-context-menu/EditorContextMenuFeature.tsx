import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';

import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import type { ToolbarCommand } from '../../contracts/bootstrap/toolbar-bootstrap';
import type {
  GeneratedContentExportIdentity,
  GeneratedContentExportMode
} from '../generated-content-export/generated-content-export-session';
import type {
  GeneratedContentTarget,
  GeneratedContentTargetLease
} from '../generated-content-export/generated-content-target';
import type { GeneratedImageTarget } from '../generated-content-export/generated-image-target';
import type {
  EditorContextMenuLabels,
  EditorContextMenuHeadingContext,
  EditorContextMenuModelContext
} from './editor-context-menu-model';
import { createEditorContextMenuModel } from './editor-context-menu-model';
import { EditorContextMenu } from './ui/EditorContextMenu';
import {
  captureEditorContext,
  editorContextSelectionFitsRange,
  findMarkdownBlock,
  markdownHeadingLevel,
  tableSelectionAt,
  type EditorContextMenuSurface as ContextSurfaceKind,
  type EditorContextSnapshot,
  type EditorSelection
} from './editor-context-menu-rules';
import type { MarkdownImageScaleMatch } from '../image-scale/image-scale-contract';
import type {
  EditorMarkdownBlockIndex,
} from './editor-markdown-block-index';
import type {
  PreviewCodeBodyMap,
  PreviewCodeProjection
} from '../../contracts/ports/preview-request';

type SurfaceSnapshot = Readonly<{
  revision?: number;
  selection: EditorSelection;
  value: string;
}>;

export type EditorContextMenuSurfaceSnapshot = SurfaceSnapshot;

export type EditorContextMenuGeneratedContext = Readonly<{
  canCopyImage: boolean;
  canCopyMathMl: boolean;
  canUseSource: boolean;
  code?: Readonly<{
    canCopyBlock: boolean;
    canIndentBlock: boolean;
    canIndentSelection: boolean;
  }>;
  identity: () => GeneratedContentExportIdentity | null;
  kind: GeneratedContentTarget['kind'];
  lease: GeneratedContentTargetLease & Readonly<{
    isCurrent?: () => boolean;
    release?: () => void;
  }>;
  mode: GeneratedContentExportMode;
  validateLease: (
    lease: GeneratedContentTargetLease,
    identity: GeneratedContentExportIdentity
  ) => boolean;
}>;

export type EditorContextMenuActionContext = Readonly<{
  code?: Readonly<{
    canCopyContent: boolean;
    canIndentBlock?: boolean;
    canIndentSelection?: boolean;
    codeMap?: PreviewCodeBodyMap;
    content?: string;
    codeProjection?: PreviewCodeProjection;
    info?: string;
    requestSignature?: string;
    target?: Readonly<{
      bodyFrom: number;
      bodyTo: number;
      from: number;
      kind: 'fenced' | 'indented';
      lineEnd: number;
      lineStart: number;
      ownerEnd: number;
      ownerFrom: number;
      ownerLineEnd: number;
      ownerLineStart: number;
      to: number;
    }>;
  }>;
  generated?: EditorContextMenuGeneratedContext;
  image?: Readonly<{
    canCopyImage: boolean;
    lease?: Readonly<{
      isCurrent: () => boolean;
      release?: () => void;
      root: HTMLImageElement;
      target: GeneratedImageTarget;
    }>;
    match: MarkdownImageScaleMatch;
  }>;
  link?: Readonly<{
    href: string;
  }>;
}>;

export type EditorContextMenuContextReadiness =
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'ready' }>
  | Readonly<{ code: string; status: 'unavailable' }>;

type EditorContextMenuPendingReleaseReason = 'cancelled' | 'unavailable';

export type EditorContextMenuSurface = Readonly<{
  boundaryElement: HTMLElement;
  element: HTMLElement;
  getBlockIndex?: (snapshot: SurfaceSnapshot) => EditorMarkdownBlockIndex | null;
  getSnapshot: () => SurfaceSnapshot;
  identity?: object;
  isEditable: () => boolean;
  kind: Exclude<ContextSurfaceKind, 'preview'>;
  generation?: number;
  prepare?: (
    target?: Element | null,
    blockIndex?: EditorMarkdownBlockIndex | null,
    position?: Readonly<{ x: number; y: number }>
  ) => boolean;
  /**
   * Establish the selection a *pointer* activation must be captured with,
   * before the demand snapshot is read and before readiness is evaluated. A
   * surface whose canonical selection is owned by a pointer-driven editor
   * (the CodeMirror source) cannot rely on its own gated `prepare`: a demand
   * that is still waiting for structural readiness would otherwise be
   * captured from a selection an earlier gesture left behind. Returning
   * `false` states that the pointer cannot be established and the activation
   * fails explicitly; keyboard activation never calls this operation and
   * keeps the user's current selection.
   */
  preparePointerSelection?: (
    position: Readonly<{ x: number; y: number }>
  ) => boolean;
  restoreFocus?: () => void;
  canUploadImage?: (image: MarkdownImageScaleMatch) => boolean;
  getActionContext?: (
    target: Element | null,
    snapshot: SurfaceSnapshot,
    blockIndex: EditorMarkdownBlockIndex | null | undefined
  ) => EditorContextMenuActionContext | null;
  getContextReadiness?: (
    target: Element | null,
    snapshot: SurfaceSnapshot,
    blockIndex: EditorMarkdownBlockIndex | null | undefined,
    /**
     * The action context this demand already owns. `null` states that the
     * demand was evaluated and owns none, while `undefined` states that the
     * caller has not built the context yet because the preparation that builds
     * it is gated by this very answer. A readiness rule that the demand's own
     * context satisfies must therefore stay silent for `undefined` and report
     * only the structural readiness.
     */
    actionContext: EditorContextMenuActionContext | null | undefined
  ) => EditorContextMenuContextReadiness;
  /**
   * Re-anchor a replayed demand target onto the live element that carries the
   * same document position. An owner that replaces its editable DOM while a
   * demand waits for readiness (an accepted Preview window commit) retires the
   * element the demand was anchored to; returning `null` states that the owner
   * cannot re-anchor it and the demand keeps the original target.
   */
  resolveTarget?: (target: Element | null) => Element | null;
  subscribeBlockIndex?: (listener: () => void) => () => void;
  subscribeReadiness?: (listener: () => void) => () => void;
  subscribeSnapshot?: (listener: () => void) => () => void;
  subscribeSelection?: (listener: () => void) => () => void;
  releasePending?: (reason?: EditorContextMenuPendingReleaseReason) => void;
}>;

export type EditorContextMenuFeatureProps = Readonly<{
  clipboard: EditorClipboardPort;
  direction: 'ltr' | 'rtl';
  heading?: Readonly<{
    commands: ReadonlyArray<ToolbarCommand>;
    label: string;
  }>;
  imageShortcut?: string;
  labels: EditorContextMenuLabels;
  onAction: (
    id: string,
    captured: EditorContextSnapshot,
    actionContext?: EditorContextMenuActionContext
  ) => void | Promise<void>;
  onFailure: (code: string) => void;
  onPortalOwnerChange?: (element: HTMLElement | null) => void;
  canCopySimplified?: boolean;
  shortcut?: string;
  source: EditorContextMenuSurface | null;
  visual: EditorContextMenuSurface | null;
}>;

type OpenState = Readonly<{
  actionContext: EditorContextMenuActionContext | null;
  boundaryElement: HTMLElement;
  block: ReturnType<typeof findMarkdownBlock>;
  captured: EditorContextSnapshot;
  contextSelection: CapturedContextSelection | null;
  generation: number;
  getBlockIndex?: EditorContextMenuSurface['getBlockIndex'];
  heading: EditorContextMenuHeadingContext | null;
  image: MarkdownImageScaleMatch | null;
  imageUploadDisabled: boolean;
  restoreFocus: () => void;
  releasePending: (reason?: EditorContextMenuPendingReleaseReason) => void;
  readiness: EditorContextMenuContextReadiness;
  selectionOutsideTarget: boolean;
  surfaceElement: HTMLElement;
  tableSelection: ReturnType<typeof tableSelectionAt>;
  targetElement: Element | null;
}>;

type PendingAction = Readonly<{
  context: EditorContextMenuActionContext | undefined;
  promise: Promise<void>;
}>;

type PendingOpenDemand = Readonly<{
  position: Readonly<{ x: number; y: number }>;
  state: OpenState;
  surface: EditorContextMenuSurface;
  target: Element | null;
}>;

type CapturedContextSelection = Readonly<{
  anchorNode: Node;
  anchorOffset: number;
  focusNode: Node;
  focusOffset: number;
  range: Range;
}>;

function eventTargetInside(event: Event, element: HTMLElement): boolean {
  return event.target instanceof Node && element.contains(event.target);
}

function captureSelectionForContextPointer(
  event: MouseEvent,
  surface: HTMLElement
): CapturedContextSelection | null {
  if (2 !== event.button || !eventTargetInside(event, surface)) return null;
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.isCollapsed || 1 !== selection.rangeCount) {
    return null;
  }
  if (
    !selection.anchorNode
    || !selection.focusNode
    || !surface.contains(selection.anchorNode)
    || !surface.contains(selection.focusNode)
  ) return null;
  try {
    return {
      anchorNode: selection.anchorNode,
      anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode,
      focusOffset: selection.focusOffset,
      range: selection.getRangeAt(0).cloneRange()
    };
  } catch {
    return null;
  }
}

function captureSurfaceContextSelection(
  surface: HTMLElement
): CapturedContextSelection | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.rangeCount
    || !selection.anchorNode
    || !selection.focusNode
    || !surface.contains(selection.anchorNode)
    || !surface.contains(selection.focusNode)
  ) return null;
  try {
    return {
      anchorNode: selection.anchorNode,
      anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode,
      focusOffset: selection.focusOffset,
      range: selection.getRangeAt(0).cloneRange()
    };
  } catch {
    return null;
  }
}

function restoreCapturedContextSelection(
  surface: HTMLElement,
  captured: CapturedContextSelection | null
): boolean {
  if (
    !captured?.range.startContainer.isConnected
    || !captured.range.endContainer.isConnected
    || !captured.anchorNode.isConnected
    || !captured.focusNode.isConnected
    || !surface.contains(captured.range.startContainer)
    || !surface.contains(captured.range.endContainer)
    || !surface.contains(captured.anchorNode)
    || !surface.contains(captured.focusNode)
  ) return false;
  try {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.setBaseAndExtent(
      captured.anchorNode,
      captured.anchorOffset,
      captured.focusNode,
      captured.focusOffset
    );
    return true;
  } catch {
    return false;
  }
}

function restoreContextSelection(
  event: MouseEvent,
  surface: HTMLElement,
  captured: CapturedContextSelection | null
): void {
  const target = event.target;
  if (
    !captured?.range.startContainer.isConnected
    || !captured.range.endContainer.isConnected
    || !captured.anchorNode.isConnected
    || !captured.focusNode.isConnected
    || !(target instanceof Node)
    || !surface.contains(target)
  ) return;
  try {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection?.isCollapsed) return;
    selection.removeAllRanges();
    selection.setBaseAndExtent(
      captured.anchorNode,
      captured.anchorOffset,
      captured.focusNode,
      captured.focusOffset
    );
  } catch {
    return;
  }
}

function blockForContext(
  value: string,
  selection: EditorSelection,
  blockIndex: EditorMarkdownBlockIndex | null | undefined
): Readonly<{
  block: ReturnType<typeof findMarkdownBlock>;
  selectionOutsideTarget: boolean;
}> {
  const block = null === blockIndex
    ? null
    : findMarkdownBlock(value, selection.start, blockIndex);
  const selectionOutsideTarget = Boolean(
    block
    && selection.start !== selection.end
    && !editorContextSelectionFitsRange(selection, {
      from: block.start,
      to: block.end
    })
  );
  return {
    block: selectionOutsideTarget ? null : block,
    selectionOutsideTarget
  };
}

function codeFromError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (CONTEXT_MENU_ERROR_CODES.has(error.message)) return error.message;
  // Preserve privacy-safe operation codes from the editor owners so a
  // readiness/open failure remains diagnosable without exposing exception
  // messages or document content. Unknown errors still use the stable
  // feature-level fallback.
  return /^editor-(?:block-index|code-content|source-link|context-menu)-[a-z0-9-]+$/u.test(
    error.message
  )
    ? error.message
    : fallback;
}

function releaseActionContext(
  actionContext: EditorContextMenuActionContext | null | undefined
): void {
  actionContext?.generated?.lease.release?.();
  actionContext?.image?.lease?.release?.();
}

function actionContextForMenu(
  actionContext: EditorContextMenuActionContext | null
): EditorContextMenuActionContext | null {
  return actionContext ? { ...actionContext } : null;
}

function sharesOwnedLease(
  left: EditorContextMenuActionContext | null | undefined,
  right: EditorContextMenuActionContext | null | undefined
): boolean {
  return Boolean(
    left
    && right
    && (
      Boolean(left.generated?.lease)
        && left.generated?.lease === right.generated?.lease
      || Boolean(left.image?.lease)
        && left.image?.lease === right.image?.lease
    )
  );
}

function releasePendingUnlessActionOwns(
  state: OpenState | null | undefined,
  pending: PendingAction | null
): void {
  if (!sharesOwnedLease(pending?.context, state?.actionContext)) {
    state?.releasePending('pending' === state.readiness.status ? 'cancelled' : undefined);
  }
}

function releaseActionUnlessSharedWithPending(
  actionContext: EditorContextMenuActionContext | null | undefined,
  pending: PendingAction | null
): void {
  if (!sharesOwnedLease(actionContext, pending?.context)) releaseActionContext(actionContext);
}

function releaseStateResourcesUnlessShared(
  state: OpenState,
  retainedContexts: ReadonlyArray<EditorContextMenuActionContext | null | undefined>,
  pending: PendingAction | null,
  reason?: EditorContextMenuPendingReleaseReason
): void {
  const retained = [
    pending?.context,
    ...retainedContexts
  ];
  const shared = retained.some((context) => sharesOwnedLease(state.actionContext, context));
  if (shared) return;
  releaseActionContext(state.actionContext);
  state.releasePending(reason ?? ('pending' === state.readiness.status ? 'cancelled' : undefined));
}

function releaseActionUnlessSharedWithContexts(
  actionContext: EditorContextMenuActionContext | null | undefined,
  retainedContexts: ReadonlyArray<EditorContextMenuActionContext | null | undefined>,
  pending: PendingAction | null
): void {
  const retained = [pending?.context, ...retainedContexts];
  if (!retained.some((context) => sharesOwnedLease(actionContext, context))) {
    releaseActionContext(actionContext);
  }
}

function surfaceSnapshotMatchesCapture(
  state: OpenState,
  surface: EditorContextMenuSurface,
  snapshot: SurfaceSnapshot
): boolean {
  const captured = state.captured;
  return captured.surfaceIdentity === (surface.identity ?? surface.element)
    && captured.surfaceGeneration === surface.generation
    && captured.surface === surface.kind
    && captured.value === snapshot.value
    && captured.selection.start === snapshot.selection.start
    && captured.selection.end === snapshot.selection.end
    && captured.selection.direction === snapshot.selection.direction
    && captured.revision === snapshot.revision;
}

/**
 * A pending demand is still anchored to the pointer gesture that created it,
 * not to the revision that happened to be current while the surface owner was
 * still materializing its context inventory. Readiness advancement (a worker
 * block-index build, an accepted Preview, a rebuilt visual surface) legally
 * advances the revision and the surface generation without any user edit, so
 * those fields are rebound to the latest snapshot instead of being treated as
 * a stale capture. The document value, the selection, and the surface identity
 * remain the demand's truth: when the user (or another owner) changed the text
 * or moved the selection, the demand no longer describes what the user pointed
 * at and must not open a menu for it.
 */
function surfaceSnapshotStillDescribesPendingDemand(
  state: OpenState,
  surface: EditorContextMenuSurface,
  snapshot: SurfaceSnapshot
): boolean {
  const captured = state.captured;
  return captured.surfaceIdentity === (surface.identity ?? surface.element)
    && captured.surface === surface.kind
    && captured.value === snapshot.value
    && captured.selection.start === snapshot.selection.start
    && captured.selection.end === snapshot.selection.end
    && captured.selection.direction === snapshot.selection.direction;
}

const CONTEXT_MENU_ERROR_CODES = new Set([
  'editor-context-menu-surface-disconnected',
  'editor-context-menu-source-read-only',
  'editor-context-menu-visual-surface-read-only',
  'editor-context-menu-selection-map-failed',
  'editor-context-menu-selection-invalid',
  'editor-context-menu-position-invalid'
]);

function keyboardAnchor(element: HTMLElement): Readonly<{ x: number; y: number }> {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.max(0, rect.left),
    y: Math.max(0, rect.bottom)
  };
}

function headingForContext(
  value: string,
  block: ReturnType<typeof findMarkdownBlock>,
  source: EditorContextMenuFeatureProps['heading']
): EditorContextMenuHeadingContext | null {
  if ('heading' !== block?.kind || !source) return null;
  const levels = source.commands
    .filter((command) =>
      'heading-menu' === command.surface && 'heading' === command.action
    )
    .map((command) => {
      const level = command.level;
      if (
        'number' !== typeof level
        || !Number.isInteger(level)
        || level < 1
        || level > 6
      ) {
        throw new Error('editor-context-menu-heading-command-invalid');
      }
      return { id: command.id, label: command.label, level };
    });
  if (0 === levels.length) return null;
  return {
    currentLevel: markdownHeadingLevel(value, block),
    label: source.label,
    levels
  };
}

function contextSurface(
  surface: EditorContextMenuSurface,
  direction: 'ltr' | 'rtl',
  position: Readonly<{ x: number; y: number }>,
  replayTarget: Element | null,
  heading: EditorContextMenuFeatureProps['heading']
): OpenState {
  if (!surface.element.isConnected) {
    throw new Error('editor-context-menu-surface-disconnected');
  }
  // A demand outlives the DOM node it was anchored to: an accepted Preview
  // window commit retires the element while the demand still waits for
  // readiness. Re-anchor such a replayed target onto the live element that
  // carries the same document position, so the selection mapping, the action
  // context, the stored target, and every later refresh all describe the
  // element the user actually pointed at.
  const target = surface.resolveTarget?.(replayTarget) ?? replayTarget;
  let snapshot = surface.getSnapshot();
  // The structural index is derived from the Markdown value alone and is the
  // very input readiness waits for, so it must be requested even while the
  // surface is still pending; otherwise a surface whose readiness needs the
  // index would never receive one and the demand would wait forever. The
  // owner's selection mapping (`prepare`) and action context remain gated
  // behind readiness, because a visual Preview transfer deliberately
  // invalidates the old edit map.
  let blockIndex = surface.getBlockIndex?.(snapshot);
  const initialReadiness = surface.getContextReadiness?.(
    target,
    snapshot,
    blockIndex,
    // The demand's own action context cannot exist yet: preparation builds it,
    // and this answer decides whether preparation may run at all. A pending
    // answer therefore has to come from a structural rule that the demand's
    // own context cannot satisfy; the evaluated pass below states the context
    // and owns every context-dependent rule.
    undefined
  );
  if (initialReadiness && 'ready' !== initialReadiness.status) {
    // A visual Preview transfer temporarily makes its surface non-editable.
    // Check readiness before asking the owner to prepare a selection: while a
    // transfer is pending, the old edit map is deliberately not a valid input
    // and must not be read. The demand is kept alive by the readiness
    // subscription and is rebuilt after the matching Preview is accepted.
    const captured = captureEditorContext({
      direction,
      position,
      ...(undefined === snapshot.revision ? {} : { revision: snapshot.revision }),
      selection: snapshot.selection,
      surfaceIdentity: surface.identity ?? surface.element,
      ...(undefined === surface.generation ? {} : { surfaceGeneration: surface.generation }),
      surface: surface.kind,
      value: snapshot.value
    });
    return {
      boundaryElement: surface.boundaryElement,
      block: null,
      captured,
      contextSelection: null,
      generation: 0,
      ...(surface.getBlockIndex ? { getBlockIndex: surface.getBlockIndex } : {}),
      actionContext: null,
      heading: null,
      image: null,
      imageUploadDisabled: false,
      restoreFocus: surface.restoreFocus ?? (() => undefined),
      releasePending: surface.releasePending ?? (() => undefined),
      readiness: initialReadiness,
      selectionOutsideTarget: false,
      surfaceElement: surface.element,
      tableSelection: undefined,
      targetElement: target
    };
  }
  if (
    !surface.isEditable()
  ) {
    throw new Error(
      'visual' === surface.kind
        ? 'editor-context-menu-visual-surface-read-only'
        : 'editor-context-menu-source-read-only'
    );
  }
  if (surface.prepare && !surface.prepare(target, blockIndex, position)) {
    throw new Error('editor-context-menu-selection-map-failed');
  }
  snapshot = surface.getSnapshot();
  blockIndex = surface.getBlockIndex?.(snapshot);
  const contextSelection = captureSurfaceContextSelection(surface.element);
  const captured = captureEditorContext({
    direction,
    position,
    ...(undefined === snapshot.revision ? {} : { revision: snapshot.revision }),
    selection: snapshot.selection,
    surfaceIdentity: surface.identity ?? surface.element,
    ...(undefined === surface.generation ? {} : { surfaceGeneration: surface.generation }),
    surface: surface.kind,
    value: snapshot.value
  });
  const blockContext = blockForContext(
    snapshot.value,
    snapshot.selection,
    blockIndex
  );
  const headingContext = headingForContext(
    snapshot.value,
    blockContext.block,
    heading
  );
  const actionContext = actionContextForMenu(
    surface.getActionContext?.(target, snapshot, blockIndex) ?? null
  );
  const image = actionContext?.image?.match ?? null;
  const readiness = surface.getContextReadiness?.(
    target,
    snapshot,
    blockIndex,
    actionContext
  ) ?? { status: 'ready' as const };
  return {
    boundaryElement: surface.boundaryElement,
    block: blockContext.block,
    captured,
    contextSelection,
    generation: 0,
    ...(surface.getBlockIndex ? { getBlockIndex: surface.getBlockIndex } : {}),
    actionContext,
    heading: headingContext,
    image,
    imageUploadDisabled: Boolean(image && !surface.canUploadImage?.(image)),
    restoreFocus: surface.restoreFocus ?? (() => undefined),
    releasePending: surface.releasePending ?? (() => undefined),
    readiness,
    selectionOutsideTarget: blockContext.selectionOutsideTarget,
    surfaceElement: surface.element,
    tableSelection: null === blockIndex
      ? undefined
      : tableSelectionAt(snapshot.value, snapshot.selection, blockIndex),
    targetElement: target
  };
}

export function EditorContextMenuFeature({
  clipboard,
  direction,
  heading,
  labels,
  onAction,
  onFailure,
  onPortalOwnerChange,
  canCopySimplified,
  imageShortcut,
  shortcut,
  source,
  visual
}: EditorContextMenuFeatureProps) {
  const [open, setOpen] = useState<OpenState | null>(null);
  const [clipboardState, setClipboardState] = useState(clipboard.getState());
  const openRef = useRef<OpenState | null>(null);
  const pendingOpenRef = useRef<PendingOpenDemand | null>(null);
  const clipboardAbortRef = useRef<AbortController | null>(null);
  const preservedContextSelectionRef = useRef<CapturedContextSelection | null>(null);
  const demandGenerationRef = useRef(0);
  const onFailureRef = useRef(onFailure);
  const onActionRef = useRef(onAction);
  const actionPromiseRef = useRef<PendingAction | null>(null);
  onFailureRef.current = onFailure;
  onActionRef.current = onAction;
  openRef.current = open;

  const cancelPendingOpen = useCallback((abortClipboard = true): void => {
    if (abortClipboard) clipboardAbortRef.current?.abort();
    const pending = pendingOpenRef.current;
    pendingOpenRef.current = null;
    if (!pending) return;
    releaseActionUnlessSharedWithPending(pending.state.actionContext, actionPromiseRef.current);
    releasePendingUnlessActionOwns(pending.state, actionPromiseRef.current);
  }, []);

  /**
   * Retire the live demand synchronously, then schedule the React update that
   * removes it from the tree. `openRef.current` is only rewritten on the next
   * render, so clearing it here is what keeps a notification arriving in the
   * same batch (an A -> B -> A selection change) from reading a retired state
   * and re-matching its captured snapshot, which would resurrect a menu the
   * user's change already retired. The render that follows assigns the actual
   * state - `null`, or the state of a demand opened in the same batch - back
   * to the ref.
   */
  const retireOpenState = useCallback((): void => {
    openRef.current = null;
    setOpen(null);
  }, []);

  /**
   * Rebuild the context of a *visible* menu for the demand it was opened
   * with. A legal background transition - an accepted Preview, a rebuilt
   * block index, a replaced surface object - advances the revision, the
   * surface generation, or the inventory the menu was derived from while the
   * user changed neither the document nor the selection. The menu then keeps
   * its captured target and anchor, replaces its context with the rebuilt
   * one, and stays on screen while that inventory is still pending, instead
   * of dismissing itself over a benign refresh. A demand that no longer
   * describes the document state is still dismissed, and a genuine readiness
   * failure still reports its code.
   */
  const refreshOpenMenu = useCallback((
    surface: EditorContextMenuSurface,
    current: OpenState
  ): void => {
    if (!surfaceSnapshotStillDescribesPendingDemand(current, surface, surface.getSnapshot())) {
      clipboardAbortRef.current?.abort();
      clipboardAbortRef.current = null;
      releaseStateResourcesUnlessShared(current, [], actionPromiseRef.current);
      retireOpenState();
      current.restoreFocus();
      return;
    }
    let refreshed: OpenState;
    try {
      refreshed = {
        ...contextSurface(
          surface,
          direction,
          current.captured.position,
          current.targetElement,
          heading
        ),
        generation: current.generation
      };
    } catch (error) {
      clipboardAbortRef.current?.abort();
      clipboardAbortRef.current = null;
      releaseActionUnlessSharedWithPending(current.actionContext, actionPromiseRef.current);
      releasePendingUnlessActionOwns(current, actionPromiseRef.current);
      retireOpenState();
      current.restoreFocus();
      onFailureRef.current(codeFromError(error, 'editor-context-menu-open-failed'));
      return;
    }
    // Rebinding a valid owner is not a cancellation. The surface's
    // releasePending callback is an EditorRoot-wide cleanup owner, so
    // invoking it here can release the freshly prepared lease held by
    // `refreshed` as well. Only retire the old action lease; keep the pending
    // resources until the refreshed state is explicitly dismissed or fails
    // readiness.
    releaseActionUnlessSharedWithContexts(
      current.actionContext,
      [refreshed.actionContext],
      actionPromiseRef.current
    );
    if ('unavailable' === refreshed.readiness.status) {
      retireOpenState();
      releaseActionUnlessSharedWithPending(
        refreshed.actionContext,
        actionPromiseRef.current
      );
      if (!sharesOwnedLease(refreshed.actionContext, actionPromiseRef.current?.context)) {
        refreshed.releasePending('unavailable');
      }
      onFailureRef.current(refreshed.readiness.code);
      return;
    }
    // A `pending` rebuild keeps the menu visible with the same target and
    // anchor; the `ready` rebuild replaces its context with the new
    // inventory.
    setOpen(refreshed);
  }, [direction, heading]);

  useEffect(() => clipboard.subscribe(() => setClipboardState(clipboard.getState())), [clipboard]);

  useEffect(() => {
    const surfaces = [source, visual].filter(
      (candidate): candidate is EditorContextMenuSurface => Boolean(candidate)
    );
    const cleanups = surfaces.flatMap((surface) => {
      let evaluating = false;
      const evaluateRefresh = (): void => {
        const current = openRef.current;
        const pending = pendingOpenRef.current;
        if (!current && pending && pending.surface.element === surface.element) {
          const snapshot = surface.getSnapshot();
          if (!surfaceSnapshotStillDescribesPendingDemand(pending.state, surface, snapshot)) {
            cancelPendingOpen();
            return;
          }
          let next: OpenState;
          try {
            next = {
              ...contextSurface(
                surface,
                direction,
                pending.position,
                pending.target,
                heading
              ),
              generation: pending.state.generation
            };
          } catch (error) {
            cancelPendingOpen();
            onFailureRef.current(codeFromError(error, 'editor-context-menu-open-failed'));
            return;
          }
          if ('pending' === next.readiness.status) {
            pendingOpenRef.current = {
              ...pending,
              state: next
            };
            releaseActionUnlessSharedWithContexts(
              pending.state.actionContext,
              [next.actionContext],
              actionPromiseRef.current
            );
            return;
          }
          pendingOpenRef.current = null;
          releaseActionUnlessSharedWithContexts(
            pending.state.actionContext,
            [next.actionContext],
            actionPromiseRef.current
          );
          if ('unavailable' === next.readiness.status) {
            clipboardAbortRef.current?.abort();
            clipboardAbortRef.current = null;
            releaseActionUnlessSharedWithPending(
              next.actionContext,
              actionPromiseRef.current
            );
            if (!sharesOwnedLease(next.actionContext, actionPromiseRef.current?.context)) {
              next.releasePending('unavailable');
            }
            onFailureRef.current(next.readiness.code);
            return;
          }
          setOpen(next);
          return;
        }
        if (
          !current
          || current.surfaceElement !== surface.element
          || current.getBlockIndex !== surface.getBlockIndex
        ) return;
        const snapshot = surface.getSnapshot();
        if ('pending' === current.readiness.status) {
          // A visible menu whose refreshed inventory is still building is not
          // a pending *demand*: the user already has the menu, and only a
          // real document, selection, owner, or surface change may retire it.
          // Rebuilding it keeps the owner's selection mapping and action
          // context gated behind the same readiness, so the visible menu
          // never activates a resource from the retired inventory.
          refreshOpenMenu(surface, current);
          return;
        }
        if (!surfaceSnapshotMatchesCapture(current, surface, snapshot)) {
          clipboardAbortRef.current?.abort();
          clipboardAbortRef.current = null;
          releaseActionUnlessSharedWithPending(current.actionContext, actionPromiseRef.current);
          releasePendingUnlessActionOwns(current, actionPromiseRef.current);
          retireOpenState();
          current.restoreFocus();
          return;
        }
        const blockIndex = surface.getBlockIndex?.(snapshot);
        const blockContext = blockForContext(
          snapshot.value,
          snapshot.selection,
          blockIndex
        );
        const tableSelection = null === blockIndex
          ? undefined
          : tableSelectionAt(snapshot.value, snapshot.selection, blockIndex);
        const actionContext = actionContextForMenu(
          surface.getActionContext?.(current.targetElement, snapshot, blockIndex)
            ?? null
        );
        if (
          !sharesOwnedLease(current.actionContext, actionContext)
          && !sharesOwnedLease(current.actionContext, actionPromiseRef.current?.context)
        ) {
          releaseActionContext(current.actionContext);
        }
        const image = actionContext?.image?.match ?? null;
        setOpen((previous) => previous === current
          ? {
              ...previous,
              actionContext,
              block: blockContext.block,
              image,
              imageUploadDisabled: Boolean(image && !surface.canUploadImage?.(image)),
              selectionOutsideTarget: blockContext.selectionOutsideTarget,
              tableSelection
            }
          : previous);
      };
      const refresh = (): void => {
        // A pending preparation flow can publish a selection update while this
        // evaluation is already re-running `prepare`; that publication belongs
        // to the demand being evaluated, so a nested pass would only repeat the
        // same work. Dropping the nested pass keeps the synchronous
        // prepare -> selection -> refresh cycle from recursing while the
        // outermost evaluation still observes the resulting snapshot.
        if (evaluating) return;
        evaluating = true;
        try {
          evaluateRefresh();
        } finally {
          evaluating = false;
        }
      };
      const subscriptions = [] as Array<() => void>;
      if (surface.subscribeBlockIndex) {
        subscriptions.push(surface.subscribeBlockIndex(refresh));
      }
      if (surface.subscribeReadiness) {
        subscriptions.push(surface.subscribeReadiness(refresh));
      }
      if (surface.subscribeSnapshot) {
        subscriptions.push(surface.subscribeSnapshot(refresh));
      }
      if (surface.subscribeSelection) {
        subscriptions.push(surface.subscribeSelection(() => {
          const current = openRef.current;
          const pendingHere = pendingOpenRef.current?.surface.element === surface.element;
          // A visible menu that is still waiting for its refreshed inventory
          // was retained by `refreshOpenMenu` and has no pending demand behind
          // it. Its captured selection is part of the demand it was opened
          // with, and a selection-only change publishes through this
          // subscription (never through the text snapshot), so it has to be
          // validated here exactly like a pending demand. Otherwise the
          // retained menu keeps describing a selection the user no longer has;
          // a same-batch A -> B -> A change is handled by the synchronous
          // retirement in `retireOpenState`.
          const retainedPendingHere = Boolean(
            current
            && current.surfaceElement === surface.element
            && 'pending' === current.readiness.status
          );
          if (!pendingHere && !retainedPendingHere) return;
          // Windowed preparation establishes the caret/selection through the
          // browser and then publishes that normalized selection while the
          // block index or readiness build is still pending. `refresh` keeps
          // such a demand alive because its snapshot still matches the captured
          // demand, and it cancels explicitly once the selection moved
          // somewhere else, so a real user change never opens a stale menu.
          refresh();
        }));
      }
      // A surface object can be replaced after its readiness owner has already
      // notified the old subscription. Replaying only a demand anchored to
      // this same surface closes that notification gap. An already-open menu
      // has no pending demand: refreshing it here would rebuild its action
      // context during an ordinary owner rerender and could release a
      // generated/image resource that a later action still owns.
      const pendingSurface = pendingOpenRef.current?.surface;
      if (
        pendingSurface
        && pendingSurface.element === surface.element
        && pendingSurface.boundaryElement === surface.boundaryElement
        && (pendingSurface.identity ?? pendingSurface.element)
          === (surface.identity ?? surface.element)
      ) {
        refresh();
      }
      return subscriptions;
    });
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [
    cancelPendingOpen,
    direction,
    heading,
    refreshOpenMenu,
    source?.canUploadImage,
    source?.element,
    source?.getActionContext,
    source?.getContextReadiness,
    source?.getBlockIndex,
    source?.subscribeReadiness,
    source?.subscribeBlockIndex,
    source?.subscribeSnapshot,
    source?.subscribeSelection,
    visual?.canUploadImage,
    visual?.element,
    visual?.getActionContext,
    visual?.getContextReadiness,
    visual?.getBlockIndex,
    visual?.subscribeReadiness,
    visual?.subscribeBlockIndex,
    visual?.subscribeSnapshot,
    visual?.subscribeSelection
  ]);

  useEffect(() => {
    const surfaces = [source, visual].filter(
      (candidate): candidate is EditorContextMenuSurface => Boolean(candidate)
    );
    const openSurface = (
      surface: EditorContextMenuSurface,
      position: Readonly<{ x: number; y: number }>,
      target: Element | null,
      activation: 'keyboard' | 'pointer'
    ): void => {
      clipboardAbortRef.current?.abort();
      const clipboardController = new AbortController();
      clipboardAbortRef.current = clipboardController;
      const generation = ++demandGenerationRef.current;
      void clipboard.check({ signal: clipboardController.signal }).catch((error) => {
        if (clipboardController.signal.aborted) return;
        const pending = pendingOpenRef.current;
        if (
          openRef.current?.generation !== generation
          && pending?.state.generation !== generation
        ) return;
        onFailureRef.current(codeFromError(error, 'editor-context-menu-clipboard-check-failed'));
      });
      cancelPendingOpen(false);
      const previous = openRef.current;
      releaseActionUnlessSharedWithPending(previous?.actionContext, actionPromiseRef.current);
      releasePendingUnlessActionOwns(previous, actionPromiseRef.current);
      retireOpenState();
      let next: OpenState;
      try {
        // A pointer activation must describe the element the pointer is on,
        // not whatever selection an earlier gesture left behind. This runs
        // before the demand snapshot is read so a demand that still has to
        // wait for structural readiness is captured from the pointed
        // selection, and it runs before the owner's gated `prepare` because
        // that callback only executes once readiness is already available.
        if (
          'pointer' === activation
          && surface.preparePointerSelection
          && !surface.preparePointerSelection(position)
        ) {
          // The pointer selection could not be established, and that failure
          // is explicit: a read-only owner keeps its own surface failure code,
          // while an unmappable, detached, or otherwise unusable pointer
          // reports the selection-mapping failure.
          throw new Error(
            surface.isEditable()
              ? 'editor-context-menu-selection-map-failed'
              : ('visual' === surface.kind
                ? 'editor-context-menu-visual-surface-read-only'
                : 'editor-context-menu-source-read-only')
          );
        }
        next = {
          ...contextSurface(surface, direction, position, target, heading),
          generation
        };
      } catch (error) {
        onFailureRef.current(codeFromError(error, 'editor-context-menu-open-failed'));
        clipboardAbortRef.current?.abort();
        return;
      }
      if ('unavailable' === next.readiness.status) {
        clipboardController.abort();
        clipboardAbortRef.current = null;
        releaseActionContext(next.actionContext);
        next.releasePending('unavailable');
        onFailureRef.current(next.readiness.code);
        return;
      }
      if ('pending' === next.readiness.status) {
        pendingOpenRef.current = { position, state: next, surface, target };
        return;
      }
      setOpen(next);
    };
    const listeners = surfaces.map((surface) => {
      let preservedSelection: CapturedContextSelection | null = null;
      // A native context-menu request is a *pointer* activation only when a
      // pointer gesture preceded it on this surface. The Context Menu key and
      // Shift+F10 make some browsers fire their own `contextmenu` event whose
      // coordinates are a menu anchor, not a pointer hit-test position; such
      // an activation must keep the user's current selection.
      let pointerGesturePending = false;
      const rememberSelection = (): void => {
        const selection = surface.element.ownerDocument.defaultView?.getSelection();
        if (
          !selection
          || selection.isCollapsed
          || 1 !== selection.rangeCount
          || !selection.anchorNode
          || !selection.focusNode
          || !surface.element.contains(selection.anchorNode)
          || !surface.element.contains(selection.focusNode)
        ) return;
        try {
          preservedSelection = {
            anchorNode: selection.anchorNode,
            anchorOffset: selection.anchorOffset,
            focusNode: selection.focusNode,
            focusOffset: selection.focusOffset,
            range: selection.getRangeAt(0).cloneRange()
          };
        } catch {
          preservedSelection = null;
        }
      };
      const handlePointerDown = (event: PointerEvent): void => {
        pointerGesturePending = true;
        preservedSelection = captureSelectionForContextPointer(event, surface.element);
        if (preservedSelection) {
          event.preventDefault();
        }
      };
      const handleMouseDown = (event: MouseEvent): void => {
        pointerGesturePending = true;
        preservedSelection = captureSelectionForContextPointer(event, surface.element);
        if (preservedSelection) {
          event.preventDefault();
        }
      };
      const handleContextMenu = (event: MouseEvent): void => {
        if (!eventTargetInside(event, surface.element) || event.defaultPrevented) return;
        const pointerGesture = pointerGesturePending;
        pointerGesturePending = false;
        restoreContextSelection(event, surface.element, preservedSelection);
        preservedSelection = null;
        event.preventDefault();
        event.stopPropagation();
        openSurface(
          surface,
          { x: event.clientX, y: event.clientY },
          event.target instanceof Element ? event.target : null,
          pointerGesture ? 'pointer' : 'keyboard'
        );
      };
      const handleKeyDown = (event: KeyboardEvent): void => {
        if (
          !eventTargetInside(event, surface.element)
          || event.isComposing
          || 229 === event.keyCode
          || event.defaultPrevented
          || !(('ContextMenu' === event.key) || ('F10' === event.key && event.shiftKey))
        ) return;
        pointerGesturePending = false;
        event.preventDefault();
        event.stopPropagation();
        openSurface(surface, keyboardAnchor(surface.element), surface.element, 'keyboard');
      };
      surface.element.ownerDocument.addEventListener(
        'selectionchange',
        rememberSelection,
        true
      );
      surface.element.addEventListener('pointerdown', handlePointerDown, true);
      surface.element.addEventListener('mousedown', handleMouseDown, true);
      surface.element.addEventListener('contextmenu', handleContextMenu, true);
      surface.element.addEventListener('keydown', handleKeyDown, true);
      return () => {
        surface.element.ownerDocument.removeEventListener(
          'selectionchange',
          rememberSelection,
          true
        );
        surface.element.removeEventListener('pointerdown', handlePointerDown, true);
        surface.element.removeEventListener('mousedown', handleMouseDown, true);
        surface.element.removeEventListener('contextmenu', handleContextMenu, true);
        surface.element.removeEventListener('keydown', handleKeyDown, true);
      };
    });
    return () => {
      for (const cleanup of listeners) cleanup();
      // This effect re-runs whenever the owner recreates its surface object,
      // which an accepted Preview or a block-index build does legally while a
      // demand waits for readiness. Cancelling here would silently drop the
      // user's first right-click, so only the listener set is torn down; the
      // demand is cancelled by the owner-replacement check (validation effect)
      // or by the explicit dismissal, outside-interaction, and unmount paths.
    };
  }, [
    cancelPendingOpen,
    clipboard,
    direction,
    heading,
    source?.element,
    source?.generation,
    source?.getActionContext,
    source?.getContextReadiness,
    source?.getBlockIndex,
    source?.identity,
    source?.subscribeSelection,
    visual?.element,
    visual?.generation,
    visual?.getActionContext,
    visual?.getContextReadiness,
    visual?.getBlockIndex,
    visual?.identity,
    visual?.subscribeSelection
  ]);

  useEffect(() => {
    const ownerDocument = source?.element.ownerDocument ?? visual?.element.ownerDocument;
    const windowRef = ownerDocument?.defaultView;
    if (!ownerDocument || !windowRef) return undefined;
    const cancelOutside = (target: EventTarget | null): void => {
      const pending = pendingOpenRef.current;
      if (!pending || !(target instanceof Node)) return;
      if (!pending.surface.element.contains(target)) cancelPendingOpen();
    };
    const handlePointer = (event: PointerEvent): void => cancelOutside(event.target);
    const handlePointerDown = (event: MouseEvent): void => {
      if (2 !== event.button) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      const surface = [source?.element, visual?.element].find((candidate) =>
        candidate?.contains(target)
      );
      if (!surface) return;
      preservedContextSelectionRef.current =
        captureSelectionForContextPointer(event, surface);
    };
    const handleContextMenu = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node) {
        const surface = [source?.element, visual?.element].find((candidate) =>
          candidate?.contains(target)
        );
        if (surface) {
          restoreContextSelection(
            event,
            surface,
            preservedContextSelectionRef.current
          );
        }
      }
      preservedContextSelectionRef.current = null;
      cancelOutside(event.target);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ('Escape' === event.key || 'Tab' === event.key) cancelPendingOpen();
    };
    const handleScroll = (): void => cancelPendingOpen();
    ownerDocument.addEventListener('pointerdown', handlePointer, true);
    ownerDocument.addEventListener('pointerdown', handlePointerDown, true);
    ownerDocument.addEventListener('mousedown', handlePointerDown, true);
    ownerDocument.addEventListener('contextmenu', handleContextMenu, true);
    ownerDocument.addEventListener('keydown', handleKeyDown, true);
    windowRef.addEventListener('scroll', handleScroll, true);
    return () => {
      ownerDocument.removeEventListener('pointerdown', handlePointer, true);
      ownerDocument.removeEventListener('pointerdown', handlePointerDown, true);
      ownerDocument.removeEventListener('mousedown', handlePointerDown, true);
      ownerDocument.removeEventListener('contextmenu', handleContextMenu, true);
      ownerDocument.removeEventListener('keydown', handleKeyDown, true);
      windowRef.removeEventListener('scroll', handleScroll, true);
    };
  }, [
    cancelPendingOpen,
    source?.element,
    visual?.element
  ]);

  useEffect(() => {
    const current = openRef.current;
    const pending = pendingOpenRef.current;
    const activeElements = [source?.element, visual?.element];
    const activeBoundaries = [source?.boundaryElement, visual?.boundaryElement];
    const activeIdentities = [
      source?.identity ?? source?.element,
      visual?.identity ?? visual?.element
    ];
    // A pending demand describes the pointer gesture the user made, not the
    // revision that happened to be current while the surface was still
    // materializing. An accepted Preview or a block-index build legally
    // recreates the owner's memoized surface, which advances the runtime
    // generation and the structural provider identity, and a demand that
    // survived the readiness transition must still be rebound to the current
    // surface instead of being cancelled silently. Only the surface itself
    // going away (element, boundary, or owner identity) invalidates the
    // demand. An open menu keeps the stricter check below because it presents
    // the capture it was opened with.
    if (
      pending
      && (
        !activeElements.includes(pending.surface.element)
        || !activeBoundaries.includes(pending.state.boundaryElement)
        || !activeIdentities.includes(pending.state.captured.surfaceIdentity)
      )
    ) {
      cancelPendingOpen();
    }
    if (
      current
      && (
        !activeElements.includes(current.surfaceElement)
        || !activeBoundaries.includes(current.boundaryElement)
        || !activeIdentities.includes(current.captured.surfaceIdentity)
      )
    ) {
      clipboardAbortRef.current?.abort();
      clipboardAbortRef.current = null;
      releaseActionUnlessSharedWithPending(current.actionContext, actionPromiseRef.current);
      releasePendingUnlessActionOwns(current, actionPromiseRef.current);
      retireOpenState();
      current.restoreFocus();
      return;
    }
    if (current) {
      const currentSurface = [source, visual].find(
        (candidate): candidate is EditorContextMenuSurface =>
          Boolean(
            candidate
            && candidate.element === current.surfaceElement
            && candidate.boundaryElement === current.boundaryElement
            && (candidate.identity ?? candidate.element)
              === current.captured.surfaceIdentity
          )
      );
      const ownerDrift = Boolean(
        currentSurface
        && (
          current.captured.surfaceGeneration !== currentSurface.generation
          || current.getBlockIndex !== currentSurface.getBlockIndex
        )
      );
      if (ownerDrift && currentSurface) {
        // A visible menu keeps presenting the target and anchor the user
        // opened it with; the helper revalidates the demand's document state,
        // rebuilds the context against the replaced surface, and retains the
        // menu across a pending inventory instead of dismissing it.
        refreshOpenMenu(currentSurface, current);
        return;
      }
    }
  }, [
    cancelPendingOpen,
    direction,
    heading,
    refreshOpenMenu,
    source?.element,
    source?.boundaryElement,
    source?.generation,
    source?.getBlockIndex,
    source?.identity,
    visual?.element,
    visual?.boundaryElement,
    visual?.generation,
    visual?.getBlockIndex,
    visual?.identity,
    visual?.subscribeSelection
  ]);

  useEffect(() => () => {
    clipboardAbortRef.current?.abort();
    cancelPendingOpen();
    releaseActionUnlessSharedWithPending(openRef.current?.actionContext, actionPromiseRef.current);
    releasePendingUnlessActionOwns(openRef.current, actionPromiseRef.current);
    retireOpenState();
  }, []);

  const modelContext = useMemo<EditorContextMenuModelContext | null>(() => {
    if (!open) return null;
    return {
      block: open.block?.kind ?? (open.getBlockIndex ? 'unavailable' : 'paragraph'),
      clipboard: clipboardState,
      ...(undefined === canCopySimplified ? {} : { canCopySimplified }),
      ...(open.selectionOutsideTarget ? { canInsertRelative: false } : {}),
      ...(open.actionContext?.code && !open.actionContext.generated
        ? { code: open.actionContext.code }
        : {}),
      ...(open.actionContext?.generated
        ? { generated: open.actionContext.generated }
        : {}),
      ...(open.heading ? { heading: open.heading } : {}),
      hasSelection: open.captured.selection.start !== open.captured.selection.end,
      ...(open.image
        ? {
            image: {
              scale: open.image.scale,
              uploadDisabled: open.imageUploadDisabled,
              ...(open.actionContext?.image
                ? { canCopyImage: open.actionContext.image.canCopyImage }
                : {})
            }
          }
        : {}),
      labels,
      ...(open.actionContext?.link ? { link: open.actionContext.link } : {}),
      readOnly: false,
      ...(undefined === imageShortcut ? {} : { imageShortcut }),
      ...(undefined === shortcut ? {} : { shortcut }),
      ...(open.tableSelection ? { tableSelection: open.tableSelection } : {})
    };
  }, [canCopySimplified, clipboardState, imageShortcut, labels, open, shortcut]);

  if (!open || !modelContext) return null;
  const dismiss = (): void => {
    clipboardAbortRef.current?.abort();
    clipboardAbortRef.current = null;
    const current = openRef.current;
    releaseActionUnlessSharedWithPending(current?.actionContext, actionPromiseRef.current);
    releasePendingUnlessActionOwns(current, actionPromiseRef.current);
    retireOpenState();
    current?.restoreFocus();
  };
  const restoreMenuSelection = (): void => {
    const current = openRef.current;
    if (!current) return;
    restoreCapturedContextSelection(current.surfaceElement, current.contextSelection);
  };
  return (
    <EditorContextMenu
      anchor={open.captured.position}
      ariaLabel={labels.ariaLabel}
      direction={direction}
      model={createEditorContextMenuModel(modelContext)}
      onAction={(id) => {
        const actionContext = open.actionContext ?? undefined;
        const actionStart = new Promise<void>(() => undefined);
        actionPromiseRef.current = { context: actionContext, promise: actionStart };
        let result: void | Promise<void>;
        try {
          result = undefined === actionContext
            ? onActionRef.current(id, open.captured)
            : onActionRef.current(id, open.captured, actionContext);
        } catch (error) {
          if (actionPromiseRef.current?.promise === actionStart) actionPromiseRef.current = null;
          releaseActionContext(actionContext);
          throw error;
        }
        if (result && 'function' === typeof result.then) {
          const pending = Promise.resolve(result);
          actionPromiseRef.current = { context: actionContext, promise: pending };
          void pending.then(
            () => {
              const currentAction = actionPromiseRef.current?.promise === pending;
              if (currentAction) actionPromiseRef.current = null;
              const currentMenu = openRef.current?.actionContext;
              const pendingMenu = pendingOpenRef.current?.state.actionContext;
              if (
                !sharesOwnedLease(actionContext, pendingMenu)
                && (currentMenu === actionContext || !sharesOwnedLease(actionContext, currentMenu))
              ) {
                releaseActionContext(actionContext);
              }
            },
            () => {
              const currentAction = actionPromiseRef.current?.promise === pending;
              if (currentAction) actionPromiseRef.current = null;
              const currentMenu = openRef.current?.actionContext;
              const pendingMenu = pendingOpenRef.current?.state.actionContext;
              if (
                !sharesOwnedLease(actionContext, pendingMenu)
                && (currentMenu === actionContext || !sharesOwnedLease(actionContext, currentMenu))
              ) {
                releaseActionContext(actionContext);
              }
            }
          );
        } else {
          if (actionPromiseRef.current?.promise === actionStart) actionPromiseRef.current = null;
          releaseActionContext(actionContext);
        }
      }}
      onDismiss={dismiss}
      onMenuPointerDown={restoreMenuSelection}
      {...(onPortalOwnerChange ? { onPortalOwnerChange } : {})}
      open
      boundaryElement={open.boundaryElement}
      surfaceElement={open.surfaceElement}
    />
  );
}
