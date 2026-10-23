import {
  createElement,
  useEffect,
  useMemo,
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
  EditorContextMenuModelContext
} from './editor-context-menu-model';
import { createEditorContextMenuModel } from './editor-context-menu-model';
import { EditorContextMenu } from './ui/EditorContextMenu';
import type {
  EditorContextMenuSurface as ContextSurfaceKind,
  EditorContextSnapshot,
  EditorSelection
} from './editor-context-menu-rules';
import type { MarkdownImageScaleMatch } from '../image-scale/image-scale-contract';
import type {
  EditorMarkdownBlockIndex,
} from './editor-markdown-block-index';
import type {
  PreviewCodeBodyMap,
  PreviewCodeProjection
} from '../../contracts/ports/preview-request';
import { useEditorContextMenuDemand } from './editor-context-menu-demand';
import { useEditorContextMenuActivation } from './editor-context-menu-activation';
import { useEditorContextMenuNotifications } from './editor-context-menu-demand-notifications';

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

/**
 * The target lifetime of one context-menu gesture, issued by the surface owner
 * that can authenticate it.
 *
 * The Feature captures a lease once, while the element the user pointed at is
 * still live, and never re-captures it for that demand. Readiness replay keeps
 * the same lease: an accepted Preview commit legally replaces the block DOM the
 * gesture was anchored to, so only the owner that accepted that render can say
 * which current element still carries the demanded block. `resolve` is
 * therefore called only once readiness permits that read, and returns `null`
 * when the owner cannot authenticate the demand against its current accepted
 * source, ledger, or owner instance. There is no fallback to the old element,
 * a same-ordinal block id, or a fresh coordinate hit-test.
 */
export type EditorContextMenuTargetLease = Readonly<{
  resolve: () => Element | null;
  release: () => void;
  /**
   * One-shot receipt for the owner's own accepted selection publication.
   *
   * A visual owner that normalizes a caret as part of its accepted
   * presentation calls this only from inside the exact synchronous
   * `applyTextChange` that publishes the new selection. It returns true at most
   * once, and only when this lease's own armed publication matches the exact
   * before/after snapshots of that write. It never places a caret, resolves a
   * target, runs readiness, requests a Preview, or executes an action: it is
   * evidence the Feature may consume, and nothing more.
   *
   * Absent for owners that never publish such a transition (Source and
   * Windowed), and a false return is an ordinary miss rather than a selection
   * exemption.
   */
  consumeAcceptedSelectionTransition?: (
    before: EditorContextMenuSurfaceSnapshot,
    after: EditorContextMenuSurfaceSnapshot
  ) => boolean;
}>;

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
    position?: Readonly<{ x: number; y: number }>,
    /**
     * Which gesture demanded the menu. `pointer` means a real pointer gesture
     * preceded the `contextmenu` event, so a surface that owns pointer-driven
     * selection may treat the pointed target as authoritative; `keyboard` means
     * the Context Menu key or Shift+F10 asked for the menu and the current
     * selection has to be kept.
     */
    activation?: 'keyboard' | 'pointer'
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
   * Settle the work this owner has already accepted from the user before the
   * demand reads its snapshot. A visual Preview owner holds user-authored native
   * input in a short debounce window; a gesture that arrives inside that window
   * would otherwise be captured against the pre-input canonical source. This
   * runs exactly once per activation, before the target is captured and before
   * the demand snapshot or readiness is read, and never on a readiness replay.
   *
   * It commits only input the user already authored: no menu-created command,
   * no target or selection mapping, no render request, and no deferred
   * insertion. Returning `false` states that the owner cannot establish a
   * trustworthy demand right now, so the activation fails closed without
   * capturing a target. Source owners whose canonical selection is ambient do
   * not supply it.
   */
  prepareDemand?: () => boolean;
  /**
   * Capture the authenticated target of this gesture, exactly once, while the
   * element is still live inside this surface. The returned lease is the only
   * way the Feature may obtain a target for preparation, action context, and
   * every later rebuild of this same demand; `null` is a real capture failure,
   * not an omission. Owners replace this in the Source case by supplying no
   * capability at all, because the Source surface has no transferred Preview
   * DOM target to authenticate.
   */
  captureTarget?: (
    target: Element | null
  ) => EditorContextMenuTargetLease | null;
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

/**
 * Composes the context-menu feature from its real owners:
 *
 * - demand resource lifecycle (`useEditorContextMenuDemand`),
 * - native activation and dismissal (`useEditorContextMenuActivation`),
 * - owner notification binding (`useEditorContextMenuNotifications`),
 * - context derivation (`contextSurface` in the context owner),
 * - the one portal/focus/dismiss presenter (`EditorContextMenu`).
 *
 * The public capability types stay declared here so Full and Windowed keep
 * their original import entry points.
 */
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
  const [clipboardState, setClipboardState] = useState(clipboard.getState());
  const demand = useEditorContextMenuDemand({
    clipboard,
    direction,
    heading,
    onAction,
    onFailure
  });

  useEffect(
    () => clipboard.subscribe(() => setClipboardState(clipboard.getState())),
    [clipboard]
  );

  useEditorContextMenuActivation({
    cancelPending: demand.cancelPending,
    openSurface: demand.openSurface,
    readOpen: demand.readOpen,
    readPending: demand.readPending,
    source,
    visual
  });

  useEditorContextMenuNotifications({
    consumeAcceptedSelection: demand.consumeAcceptedSelection,
    direction,
    heading,
    isRetainedPending: demand.isRetainedPending,
    readPending: demand.readPending,
    replay: demand.replay,
    validateOwners: demand.validateOwners,
    source,
    visual
  });

  useEffect(() => () => demand.dispose(), [demand.dispose]);

  const open = demand.open;
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
  return (
    <EditorContextMenu
      anchor={open.captured.position}
      ariaLabel={labels.ariaLabel}
      direction={direction}
      model={createEditorContextMenuModel(modelContext)}
      onAction={demand.invokeAction}
      onDismiss={demand.dismiss}
      onMenuPointerDown={demand.restoreMenuSelection}
      {...(onPortalOwnerChange ? { onPortalOwnerChange } : {})}
      open
      boundaryElement={open.boundaryElement}
      surfaceElement={open.surfaceElement}
    />
  );
}
