import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from '@wordpress/element';

import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
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
  EditorContextMenuModelContext
} from './editor-context-menu-model';
import { createEditorContextMenuModel } from './editor-context-menu-model';
import { EditorContextMenu } from './ui/EditorContextMenu';
import {
  captureEditorContext,
  editorContextSelectionFitsRange,
  findMarkdownBlock,
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
  canSaveImage: boolean;
  canUseSource: boolean;
  code?: Readonly<{
    canCopyBlock: boolean;
    canIndentBlock: boolean;
    canIndentSelection: boolean;
  }>;
  filename: string;
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
    canOpen: boolean;
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
    blockIndex?: EditorMarkdownBlockIndex | null
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
    actionContext: EditorContextMenuActionContext | null
  ) => EditorContextMenuContextReadiness;
  subscribeBlockIndex?: (listener: () => void) => () => void;
  subscribeReadiness?: (listener: () => void) => () => void;
  subscribeSnapshot?: (listener: () => void) => () => void;
  subscribeSelection?: (listener: () => void) => () => void;
  releasePending?: (reason?: EditorContextMenuPendingReleaseReason) => void;
}>;

export type EditorContextMenuFeatureProps = Readonly<{
  clipboard: EditorClipboardPort;
  direction: 'ltr' | 'rtl';
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
  contextSelection: Range | null;
  generation: number;
  getBlockIndex?: EditorContextMenuSurface['getBlockIndex'];
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

function eventTargetInside(event: Event, element: HTMLElement): boolean {
  return event.target instanceof Node && element.contains(event.target);
}

function captureSelectionForContextPointer(
  event: MouseEvent,
  surface: HTMLElement
): Range | null {
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
    return selection.getRangeAt(0).cloneRange();
  } catch {
    return null;
  }
}

function captureSurfaceContextSelection(surface: HTMLElement): Range | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.rangeCount
    || !selection.anchorNode
    || !selection.focusNode
    || !surface.contains(selection.anchorNode)
    || !surface.contains(selection.focusNode)
  ) return null;
  try {
    return selection.getRangeAt(0).cloneRange();
  } catch {
    return null;
  }
}

function restoreCapturedContextSelection(
  surface: HTMLElement,
  range: Range | null
): boolean {
  if (
    !range?.startContainer.isConnected
    || !range.endContainer.isConnected
    || !surface.contains(range.startContainer)
    || !surface.contains(range.endContainer)
  ) return false;
  try {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

function restoreContextSelection(
  event: MouseEvent,
  surface: HTMLElement,
  range: Range | null
): void {
  const target = event.target;
  if (
    !range?.startContainer.isConnected
    || !range.endContainer.isConnected
    || !(target instanceof Node)
    || !surface.contains(target)
  ) return;
  try {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection?.isCollapsed) return;
    selection.removeAllRanges();
    selection.addRange(range);
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
  return error instanceof Error && CONTEXT_MENU_ERROR_CODES.has(error.message)
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

function contextSurface(
  surface: EditorContextMenuSurface,
  direction: 'ltr' | 'rtl',
  position: Readonly<{ x: number; y: number }>,
  target: Element | null
): OpenState {
  if (!surface.element.isConnected) {
    throw new Error('editor-context-menu-surface-disconnected');
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
  let snapshot = surface.getSnapshot();
  let blockIndex = surface.getBlockIndex?.(snapshot);
  if (surface.prepare && !surface.prepare(target, blockIndex)) {
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
  const preservedContextSelectionRef = useRef<Range | null>(null);
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

  useEffect(() => clipboard.subscribe(() => setClipboardState(clipboard.getState())), [clipboard]);

  useEffect(() => {
    const surfaces = [source, visual].filter(
      (candidate): candidate is EditorContextMenuSurface => Boolean(candidate)
    );
    const cleanups = surfaces.flatMap((surface) => {
      const refresh = (): void => {
        const current = openRef.current;
        const pending = pendingOpenRef.current;
        if (!current && pending && pending.surface.element === surface.element) {
          const snapshot = surface.getSnapshot();
          if (!surfaceSnapshotMatchesCapture(pending.state, surface, snapshot)) {
            cancelPendingOpen();
            return;
          }
          let next: OpenState;
          try {
            next = {
              ...contextSurface(surface, direction, pending.position, pending.target),
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
            return;
          }
          pendingOpenRef.current = null;
          if (!sharesOwnedLease(pending.state.actionContext, next.actionContext)) {
            releaseActionContext(pending.state.actionContext);
          }
          if ('unavailable' === next.readiness.status) {
            clipboardAbortRef.current?.abort();
            clipboardAbortRef.current = null;
            releaseActionContext(next.actionContext);
            next.releasePending('unavailable');
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
        if (!surfaceSnapshotMatchesCapture(current, surface, snapshot)) {
          clipboardAbortRef.current?.abort();
          clipboardAbortRef.current = null;
          releaseActionUnlessSharedWithPending(current.actionContext, actionPromiseRef.current);
          releasePendingUnlessActionOwns(current, actionPromiseRef.current);
          setOpen(null);
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
          if (pendingOpenRef.current?.surface.element === surface.element) {
            cancelPendingOpen();
          }
        }));
      }
      return subscriptions;
    });
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [
    cancelPendingOpen,
    direction,
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
      target: Element | null
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
      setOpen(null);
      let next: OpenState;
      try {
        next = {
          ...contextSurface(surface, direction, position, target),
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
      let preservedSelection: Range | null = null;
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
          preservedSelection = selection.getRangeAt(0).cloneRange();
        } catch {
          preservedSelection = null;
        }
      };
      const handlePointerDown = (event: PointerEvent): void => {
        preservedSelection = captureSelectionForContextPointer(event, surface.element);
        if (preservedSelection) {
          event.preventDefault();
        }
      };
      const handleMouseDown = (event: MouseEvent): void => {
        preservedSelection = captureSelectionForContextPointer(event, surface.element);
        if (preservedSelection) {
          event.preventDefault();
        }
      };
      const handleContextMenu = (event: MouseEvent): void => {
        if (!eventTargetInside(event, surface.element) || event.defaultPrevented) return;
        restoreContextSelection(event, surface.element, preservedSelection);
        preservedSelection = null;
        event.preventDefault();
        event.stopPropagation();
        openSurface(
          surface,
          { x: event.clientX, y: event.clientY },
          event.target instanceof Element ? event.target : null
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
        event.preventDefault();
        event.stopPropagation();
        openSurface(surface, keyboardAnchor(surface.element), surface.element);
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
      clipboardAbortRef.current?.abort();
      clipboardAbortRef.current = null;
      cancelPendingOpen();
    };
  }, [
    cancelPendingOpen,
    clipboard,
    direction,
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
    const activeGenerations = [source?.generation, visual?.generation];
    const activeBlockIndices = [source?.getBlockIndex, visual?.getBlockIndex];
    if (
      pending
      && (
        !activeElements.includes(pending.surface.element)
        || !activeBoundaries.includes(pending.state.boundaryElement)
        || !activeIdentities.includes(pending.state.captured.surfaceIdentity)
        || !activeGenerations.includes(pending.state.captured.surfaceGeneration)
        || !activeBlockIndices.includes(pending.state.getBlockIndex)
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
        || !activeGenerations.includes(current.captured.surfaceGeneration)
        || !activeBlockIndices.includes(current.getBlockIndex)
      )
    ) {
      clipboardAbortRef.current?.abort();
      clipboardAbortRef.current = null;
      releaseActionUnlessSharedWithPending(current.actionContext, actionPromiseRef.current);
      releasePendingUnlessActionOwns(current, actionPromiseRef.current);
      setOpen(null);
      current.restoreFocus();
    }
  }, [
    cancelPendingOpen,
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
    setOpen(null);
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
    setOpen(null);
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
