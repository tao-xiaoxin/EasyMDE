import {
  createElement,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef
} from '@wordpress/element';
import type {
  ClipboardEventHandler,
  CSSProperties,
  DragEventHandler,
  FormEventHandler,
  KeyboardEventHandler,
  Ref
} from 'react';

import type { SafePreviewHtml } from '../../../contracts/ports/preview-request';
import { VISUAL_MARKDOWN_READ_ONLY_SELECTOR } from '../../../contracts/visual-markdown-read-only';
import { prepareVisualProtectedNodeAdoption } from '../../../shared/dom/visual-protected-node-adoption';

const deferredRootEndAtomicSurfaces = new WeakSet<HTMLElement>();

export function consumeDeferredWindowRootEndAtomicTail(
  surface: HTMLElement
): boolean {
  if (!deferredRootEndAtomicSurfaces.has(surface)) return false;
  deferredRootEndAtomicSurfaces.delete(surface);
  return true;
}

function trailingSignificantChild(surface: HTMLElement): Node | null {
  let node: Node | null = surface.lastChild;
  while (
    node
    && node.nodeType === Node.TEXT_NODE
    && /^[ \t\r\n]*$/u.test(node.nodeValue ?? '')
  ) {
    node = node.previousSibling;
  }
  return node;
}

function isDocumentEndEditableSink(node: Node | null): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false;
  if ('P' !== node.tagName) return false;
  if ('false' === node.getAttribute('contenteditable')) return false;
  if (node.hasAttribute('data-easymde-visual-block-id')) return false;
  if (node.hasAttribute('data-easymde-preview-window-spacer')) return false;
  if ('' !== (node.textContent ?? '')) return false;
  return 0 === node.childNodes.length
    || (1 === node.childNodes.length && 'BR' === node.firstChild?.nodeName);
}

function isNonEditableAtomicTail(node: Node | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node.hasAttribute('data-easymde-preview-window-spacer')) return false;
  return 'false' === node.getAttribute('contenteditable')
    || 'HR' === node.tagName
    || node.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR);
}

export type SafePreviewHtmlSinkCommit = Readonly<{
  nodes: ReadonlyArray<Node>;
  revision: number;
}>;

export type SafePreviewHtmlSinkSelectionHandoff = Readonly<{
  isCurrent: () => boolean;
  previous: Readonly<{ node: Node; offset: number }>;
  next: Readonly<{ node: Node; offset: number }>;
}>;

export type SafePreviewHtmlSinkWindowCommit = Readonly<{
  key: number;
  nodes: ReadonlyArray<Node>;
  revision: number;
  selectionHandoff?: SafePreviewHtmlSinkSelectionHandoff;
}>;

export type SafePreviewHtmlSinkWindowController = Readonly<{
  commit: (previous: SafePreviewHtmlSinkWindowCommit, next: SafePreviewHtmlSinkWindowCommit) => boolean;
}>;

export type SafePreviewHtmlSinkMaterializeCommit = Readonly<{
  key: number;
  nodes: ReadonlyArray<Node>;
  revision: number;
}>;

export type SafePreviewHtmlSinkScheduler = Readonly<{
  yield: () => Promise<void>;
}>;

/**
 * Synchronous retainedness for a live composition lease plus the version that
 * wakes the sink effect on the last release. The lease is the authority; no DOM
 * attribute or native listener order participates.
 */
export type SafePreviewHtmlSinkCompositionGate = Readonly<{
  isHeld: () => boolean;
  version: number;
}>;

type SafePreviewHtmlSinkProps = Readonly<{
  acceptedEmpty?: boolean;
  ariaBusy?: boolean;
  acceptedHtml?: boolean;
  className?: string;
  compositionGate?: SafePreviewHtmlSinkCompositionGate;
  contentEditable?: boolean;
  error?: boolean;
  html: SafePreviewHtml | null;
  htmlRevision?: number;
  label?: string;
  onDrop?: DragEventHandler<HTMLElement>;
  onInput?: FormEventHandler<HTMLElement>;
  onMaterializeComplete?: (revision: number, key: number) => void;
  onMaterializeFailure?: (
    revision: number,
    key: number,
    error: unknown
  ) => void;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onPaste?: ClipboardEventHandler<HTMLElement>;
  beforeStagedCommit?: (revision: number, hasInstalledHtml: boolean) => boolean;
  onStagedCommit?: (revision: number) => void;
  phase?: string;
  materializeCommit?: SafePreviewHtmlSinkMaterializeCommit | null;
  materializeScheduler?: SafePreviewHtmlSinkScheduler;
  refreshing?: boolean;
  role?: string;
  spellCheck?: boolean;
  stagedCommit?: SafePreviewHtmlSinkCommit | null;
  windowedCommit?: SafePreviewHtmlSinkWindowCommit | null;
  windowControllerRef?: Ref<SafePreviewHtmlSinkWindowController>;
  statusClassName?: string;
  statusMessage?: string;
  statusRole?: string;
  style?: CSSProperties;
  surfaceRef: Ref<HTMLElement>;
}>;

type AppliedSurfaceState = Readonly<{
  html: SafePreviewHtml | null;
  /**
   * The DOM serialization this sink itself installed for `html`. A local edit
   * (a native deletion the editor has not committed yet) changes the surface
   * without changing the requested HTML, so identical HTML is only a no-op
   * when the mounted children still spell exactly what the sink wrote.
   */
  renderedHtml?: string | null;
  revision: number;
  statusClassName: string | undefined;
  statusMessage: string | undefined;
  statusRole: string | undefined;
  materializeCommitKey: number | null;
  windowedCommitKey: number | null;
  stagedCommit?: SafePreviewHtmlSinkCommit;
  stagedCommitNodes?: ReadonlyArray<Node>;
}>;

function validateUniqueChildren(desiredNodes: ReadonlyArray<Node>): void {
  const desired = new Set<Node>();
  for (const node of desiredNodes) {
    if (desired.has(node)) {
      throw new Error('preview-window-node-sequence-invalid');
    }
    desired.add(node);
  }
}

function validateWindowChildren(
  surface: HTMLElement,
  desiredNodes: ReadonlyArray<Node>
): void {
  validateUniqueChildren(desiredNodes);
  if (desiredNodes.some((node) =>
    node.ownerDocument !== surface.ownerDocument
  )) {
    throw new Error('preview-window-node-sequence-invalid');
  }
}

function defaultSafePreviewHtmlSinkScheduler(
  documentRef: Document
): SafePreviewHtmlSinkScheduler {
  const windowRef = documentRef.defaultView;
  return {
    yield: () => new Promise<void>((resolve) => {
      if (windowRef) windowRef.setTimeout(resolve, 0);
      else setTimeout(resolve, 0);
    })
  };
}

const MATERIALIZE_BATCH_SIZE = 512;

function materializeSpacerRange(
  spacer: HTMLElement,
  nodeCount: number
): Readonly<{ end: number; start: number }> {
  const start = Number.parseInt(
    spacer.getAttribute('data-easymde-preview-window-start') ?? '',
    10
  );
  const end = Number.parseInt(
    spacer.getAttribute('data-easymde-preview-window-end') ?? '',
    10
  );
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end <= start
    || end > nodeCount
  ) {
    throw new Error('preview-window-materialize-range-invalid');
  }
  return { end, start };
}

function hasExactChildren(
  surface: HTMLElement,
  nodes: ReadonlyArray<Node>
): boolean {
  if (surface.childNodes.length !== nodes.length) return false;
  return nodes.every((node, index) => surface.childNodes[index] === node);
}

function appendStatusMessage(
  surface: HTMLElement,
  statusClassName: string | undefined,
  statusMessage: string,
  statusRole: string | undefined
): void {
  const message = surface.ownerDocument.createElement('p');
  if (statusClassName) message.className = statusClassName;
  if (statusRole) message.setAttribute('role', statusRole);
  message.textContent = statusMessage;
  surface.append(message);
}

function startMaterializeChildrenCommit(
  surface: HTMLElement,
  desiredNodes: ReadonlyArray<Node>,
  scheduler: SafePreviewHtmlSinkScheduler,
  onComplete: () => void,
  onFailure: (error: unknown) => void
): () => void {
  const initialChildren = Array.from(surface.childNodes);
  const initialSpacerAttributes = initialChildren.flatMap((node) =>
    node instanceof HTMLElement
    && node.hasAttribute('data-easymde-preview-window-spacer')
      ? [{
          attributes: Array.from(node.attributes).map(({ name, value }) => ({
            name,
            value
          })),
          node
        }]
      : []
  );
  const canvas = surface.parentElement;
  const initialScrollTop = canvas?.scrollTop ?? 0;
  const anchor = desiredNodes.find((node) => node.parentNode === surface);
  const anchorTop = anchor instanceof HTMLElement
    ? anchor.getBoundingClientRect().top
    : null;
  let active = true;
  const rollback = (): void => {
    if (!surface.parentNode) return;
    for (const { attributes, node } of initialSpacerAttributes) {
      for (const attribute of Array.from(node.attributes)) {
        node.removeAttribute(attribute.name);
      }
      for (const { name, value } of attributes) node.setAttribute(name, value);
    }
    surface.replaceChildren(...initialChildren);
    if (canvas) canvas.scrollTop = initialScrollTop;
  };
  const fail = (error: unknown): void => {
    if (!active) return;
    active = false;
    try {
      rollback();
    } catch (rollbackError) {
      onFailure(rollbackError);
      return;
    }
    onFailure(error);
  };
  const step = (): void => {
    if (!active) return;
    try {
      const spacer = Array.from(surface.children).find((child) =>
        child.hasAttribute('data-easymde-preview-window-spacer')
      ) as HTMLElement | undefined;
      if (!spacer) {
        if (!hasExactChildren(surface, desiredNodes)) {
          throw new Error('preview-window-materialize-sequence-invalid');
        }
        if (canvas) {
          canvas.scrollTop = initialScrollTop;
          if (anchor instanceof HTMLElement && null !== anchorTop) {
            canvas.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
          }
        }
        active = false;
        onComplete();
        return;
      }
      const range = materializeSpacerRange(spacer, desiredNodes.length);
      const count = Math.min(MATERIALIZE_BATCH_SIZE, range.end - range.start);
      const batch = desiredNodes.slice(range.start, range.start + count);
      const height = Number.parseFloat(spacer.style.blockSize);
      if (batch.length !== count || !Number.isFinite(height) || height < 0) {
        throw new Error('preview-window-materialize-sequence-invalid');
      }
      for (const node of batch) {
        if (node.parentNode && node.parentNode !== surface && node.isConnected) {
          throw new Error('preview-window-materialize-node-detached');
        }
        spacer.before(node);
      }
      const nextStart = range.start + count;
      if (nextStart === range.end) {
        spacer.remove();
      } else {
        spacer.setAttribute(
          'data-easymde-preview-window-start',
          String(nextStart)
        );
        spacer.style.blockSize = `${
          height * (range.end - nextStart) / (range.end - range.start)
        }px`;
      }
      if (canvas) canvas.scrollTop = initialScrollTop;
      void scheduler.yield().then(step, fail);
    } catch (error) {
      fail(error);
    }
  };
  try {
    validateWindowChildren(surface, desiredNodes);
    void scheduler.yield().then(step, fail);
  } catch (error) {
    fail(error);
  }
  return () => {
    if (!active) return;
    active = false;
    rollback();
  };
}

function validWindowSelectionPoint(
  surface: HTMLElement,
  point: SafePreviewHtmlSinkSelectionHandoff['next']
): boolean {
  const limit = point.node.nodeType === Node.TEXT_NODE
    ? point.node.nodeValue?.length ?? 0
    : point.node.childNodes.length;
  return point.node.ownerDocument === surface.ownerDocument
    && Number.isInteger(point.offset) && point.offset >= 0 && point.offset <= limit;
}

function startWindowChildrenCommit(
  surface: HTMLElement,
  desiredNodes: ReadonlyArray<Node>,
  onComplete: () => void,
  selectionHandoff?: SafePreviewHtmlSinkSelectionHandoff
): () => void {
  validateWindowChildren(surface, desiredNodes);
  const nativeSelection = surface.ownerDocument.defaultView?.getSelection();
  const restoreSemanticCaret = Boolean(selectionHandoff
    && validWindowSelectionPoint(surface, selectionHandoff.previous)
    && validWindowSelectionPoint(surface, selectionHandoff.next)
    && nativeSelection?.isCollapsed && surface.ownerDocument.activeElement === surface
    && nativeSelection.anchorNode === selectionHandoff.previous.node
    && nativeSelection.focusNode === selectionHandoff.previous.node
    && nativeSelection.anchorOffset === selectionHandoff.previous.offset
    && nativeSelection.focusOffset === selectionHandoff.previous.offset
    && surface.contains(selectionHandoff.previous.node)
    && desiredNodes.some((node) => node === selectionHandoff.next.node || node.contains(selectionHandoff.next.node))
    && selectionHandoff.isCurrent());
  if (!hasExactChildren(surface, desiredNodes)) {
    deferredRootEndAtomicSurfaces.delete(surface);
    const selection = surface.ownerDocument.defaultView?.getSelection();
		const directRootSelection = (() => {
			if (
				!selection
				|| selection.isCollapsed
				|| !surface.isConnected
				|| surface.ownerDocument.activeElement !== surface
				|| selection.anchorNode !== surface
				|| selection.focusNode !== surface
			) {
				return null;
			}
			const childCount = surface.childNodes.length;
			const boundaries = [
				selection.anchorOffset,
				selection.focusOffset,
			];
			if (
				boundaries.some(
					(offset) =>
						!Number.isInteger(offset) || offset < 0 || offset > childCount,
				)
			) {
				throw new Error('preview-window-selection-restore-failed');
			}
			const first = Math.min(selection.anchorOffset, selection.focusOffset);
			const last = Math.max(selection.anchorOffset, selection.focusOffset);
			// A root-level selection is the contiguous run of direct children
			// between its two boundaries. Those identities, not their numeric
			// offsets, are what a later commit has to retain.
			return {
				backward: selection.anchorOffset > selection.focusOffset,
				childCount,
				selectedNodes: Array.from(surface.childNodes).slice(first, last),
			};
		})();
    const fullRootSelection = (() => {
      if (
        !selection
        || selection.isCollapsed
        || !surface.isConnected
        || surface.ownerDocument.activeElement !== surface
        || selection.anchorNode !== surface
        || selection.focusNode !== surface
      ) {
        return null;
      }
      const childCount = surface.childNodes.length;
      if (
        selection.anchorOffset === 0
        && selection.focusOffset === childCount
      ) {
        return 'forward' as const;
      }
      if (
        selection.anchorOffset === childCount
        && selection.focusOffset === 0
      ) {
        return 'backward' as const;
      }
      return null;
    })();
    const rootBoundary = selection?.isCollapsed
      && selection.anchorNode === surface
      && selection.focusNode === surface
      && selection.anchorOffset === selection.focusOffset
      ? 0 === selection.anchorOffset
        ? 'start'
        : surface.childNodes.length === selection.anchorOffset
          ? 'end'
          : null
      : null;
    const preservesSelection = Boolean(
      selection?.anchorNode
      && selection.focusNode
      && selection.anchorNode !== surface
      && selection.focusNode !== surface
      && surface.contains(selection.anchorNode)
      && surface.contains(selection.focusNode)
    );
    if (!preservesSelection) {
      surface.replaceChildren(...desiredNodes);
    } else {
      const desired = new Set(desiredNodes);
      for (const child of Array.from(surface.childNodes)) {
        if (!desired.has(child)) child.remove();
      }
      let cursor = surface.firstChild;
      for (const node of desiredNodes) {
        if (node === cursor) {
          cursor = cursor.nextSibling;
          continue;
        }
        surface.insertBefore(node, cursor);
      }
      if (!hasExactChildren(surface, desiredNodes)) {
        throw new Error('preview-window-node-sequence-invalid');
      }
    }
    if (fullRootSelection && selection) {
      const newChildCount = surface.childNodes.length;
      selection.setBaseAndExtent(
        surface,
        'forward' === fullRootSelection ? 0 : newChildCount,
        surface,
        'forward' === fullRootSelection ? newChildCount : 0
      );
    }
		if (directRootSelection && selection && !fullRootSelection) {
			// A root-level selection survives a commit only when every selected
			// child is still installed, contiguous and in the same order. The
			// interval then yields its own before-first/after-last boundaries and
			// direction; a replaced identity discards the presentation snapshot
			// instead of fabricating a selection at a stale offset. Throwing here
			// would reach the editor error boundary and destroy the whole surface.
			const currentChildren: ReadonlyArray<Node> = Array.from(
				surface.childNodes
			);
			const selectedNodes: ReadonlyArray<Node> =
				directRootSelection.selectedNodes;
			const firstIndex = selectedNodes.length
				? currentChildren.indexOf(selectedNodes[0] as Node)
				: -1;
			const retained = firstIndex >= 0
				&& selectedNodes.every(
					(node, index) => currentChildren[firstIndex + index] === node,
				);
			if (retained) {
				const lastIndex = firstIndex + selectedNodes.length;
				selection.setBaseAndExtent(
					surface,
					directRootSelection.backward ? lastIndex : firstIndex,
					surface,
					directRootSelection.backward ? firstIndex : lastIndex,
				);
			}
		}
    if (rootBoundary && selection) {
      if ('start' === rootBoundary) {
        const range = surface.ownerDocument.createRange();
        range.setStart(surface, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        const editableHost = 'true' === surface.getAttribute('contenteditable');
        const tail = editableHost ? trailingSignificantChild(surface) : null;
        if (editableHost && isDocumentEndEditableSink(tail)) {
          const range = surface.ownerDocument.createRange();
          range.setStart(tail, 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        } else if (editableHost && isNonEditableAtomicTail(tail)) {
          // Chromium collapses a host-end range directly after a non-editable
          // atomic tail back to `(surface, 0)`, which pins block 0 and breaks
          // document-end editing. Clear the drifted range and signal the visual
          // editor's window-ready owner to mount the editable document-end sink.
          selection.removeAllRanges();
          deferredRootEndAtomicSurfaces.add(surface);
        } else {
          const range = surface.ownerDocument.createRange();
          range.setStart(surface, surface.childNodes.length);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          if (
            editableHost
            && surface.childNodes.length > 0
            && selection.isCollapsed
            && selection.anchorNode === surface
            && 0 === selection.anchorOffset
          ) {
            selection.removeAllRanges();
            deferredRootEndAtomicSurfaces.add(surface);
          }
        }
      }
    }
  }
  if (restoreSemanticCaret && selectionHandoff
    && validWindowSelectionPoint(surface, selectionHandoff.next)
    && surface.contains(selectionHandoff.next.node) && selectionHandoff.isCurrent()) {
    nativeSelection?.collapse(selectionHandoff.next.node, selectionHandoff.next.offset);
  }
  onComplete();
  return () => undefined;
}

export function SafePreviewHtmlSink({
  acceptedEmpty = false,
  acceptedHtml = false,
  ariaBusy = false,
  className,
  compositionGate,
  contentEditable,
  error = false,
  html,
  htmlRevision = 0,
  label,
  materializeCommit,
  materializeScheduler,
  onDrop,
  onInput,
  onMaterializeComplete,
  onMaterializeFailure,
  onKeyDown,
  onPaste,
  beforeStagedCommit,
  onStagedCommit,
  phase,
  refreshing = false,
  role,
  spellCheck,
  stagedCommit,
  windowedCommit,
  windowControllerRef,
  statusClassName,
  statusMessage,
  statusRole,
  style,
  surfaceRef
}: SafePreviewHtmlSinkProps) {
  const htmlSurfaceRef = useRef<HTMLElement | null>(null);
  const appliedSurfaceStateRef = useRef<AppliedSurfaceState | null>(null);
  const deferredByHoldRef = useRef(false);
  useEffect(() => {
    const surface = htmlSurfaceRef.current;
    return () => {
      deferredByHoldRef.current = false;
      if (surface) deferredRootEndAtomicSurfaces.delete(surface);
    };
  }, []);
  useImperativeHandle(surfaceRef, () => {
    if (!htmlSurfaceRef.current) throw new Error('preview-surface-missing');
    return htmlSurfaceRef.current;
  }, []);
  useImperativeHandle(windowControllerRef, () => ({
    commit: (previous, next) => {
      const surface = htmlSurfaceRef.current;
      const applied = appliedSurfaceStateRef.current;
      if (!surface || compositionGate?.isHeld() || !applied
        || applied.revision !== htmlRevision || applied.html !== html
        || applied.windowedCommitKey !== previous.key
        || previous.revision !== htmlRevision || next.revision !== htmlRevision
        || next.key <= previous.key || !hasExactChildren(surface, previous.nodes)) return false;
      startWindowChildrenCommit(surface, next.nodes, () => {
        appliedSurfaceStateRef.current = {
          html, materializeCommitKey: null, revision: htmlRevision,
          statusClassName, statusMessage, statusRole, windowedCommitKey: next.key
        };
      }, next.selectionHandoff);
      return true;
    }
  }));
  useLayoutEffect(() => {
    const surface = htmlSurfaceRef.current;
    if (!surface) throw new Error('preview-surface-missing');
    const witnessRegistry = (
      globalThis as unknown as {
        __VISUAL_WITNESS?: WeakMap<
          HTMLElement,
          () => { pending: boolean; sourceLinkLabelLength: number | null }
        >;
      }
    ).__VISUAL_WITNESS;
    const visualWitness = witnessRegistry?.get(surface)?.() ?? null;
    const lastAnchorLabelLength = (value: string | null): number | null => {
      if (null === value) return null;
      const template = surface.ownerDocument.createElement('template');
      template.innerHTML = value;
      const anchors = template.content.querySelectorAll('a');
      const anchor = anchors[anchors.length - 1];
      return anchor ? (anchor.textContent ?? '').length : null;
    };
    // A late Preview acceptance must never overwrite input this owner has not
    // committed yet, nor an accepted render whose last link label no longer
    // matches the current canonical source. Defer; the next accepted frame for
    // the committed source re-runs this effect. The template parse runs only
    // for a surface that actually has a visual owner, never in ordinary
    // Preview-only tests or renders.
    if (visualWitness?.pending) {
      deferredByHoldRef.current = true;
      return undefined;
    }
    if (visualWitness && null !== visualWitness.sourceLinkLabelLength) {
      const acceptedLabelLength = lastAnchorLabelLength(html);
      if (null !== acceptedLabelLength
        && acceptedLabelLength !== visualWitness.sourceLinkLabelLength) {
        deferredByHoldRef.current = true;
        return undefined;
      }
    }
    if (compositionGate?.isHeld()) {
      // The lease owner publishes the canonical text and its new Preview
      // request before releasing, so this effect re-runs with the newest
      // props and never replays a commit captured before the draft. Nothing
      // is applied or completed here, so callers see no commit.
      deferredByHoldRef.current = true;
      return undefined;
    }
    const appliedSurfaceState = appliedSurfaceStateRef.current;
    const activeMaterializeCommit = materializeCommit?.revision === htmlRevision
      ? materializeCommit
      : null;
    const windowCommit = windowedCommit?.revision === htmlRevision
      ? windowedCommit
      : null;
    const commit = stagedCommit?.revision === htmlRevision
      ? stagedCommit
      : null;
    if ((commit || windowCommit) && beforeStagedCommit
      && !beforeStagedCommit(htmlRevision, Boolean(appliedSurfaceState && appliedSurfaceState.html !== null))) {
      // Keep the current surface until a newer, installable frame arrives.
      deferredByHoldRef.current = true;
      return undefined;
    }
    // Pending HTML metadata may describe a candidate that never reached this
    // sink before supersession. Only an installable DOM commit can replace an
    // existing HTML presentation while loading or enhancing; raw metadata is
    // not permission to replay over its enhanced nodes or native draft.
    if (!windowCommit && !commit && !activeMaterializeCommit
      && (phase === "loading" || phase === "enhancing" || phase === "retained")
      && html !== null && appliedSurfaceState
      && appliedSurfaceState.html !== null) return undefined;
    if (windowCommit || commit || activeMaterializeCommit) {
      deferredByHoldRef.current = false;
    }
    if (
      !windowCommit
      && !commit
      && !activeMaterializeCommit
      && appliedSurfaceState
      && appliedSurfaceState.revision === htmlRevision
      && appliedSurfaceState.html === html
      && appliedSurfaceState.statusClassName === statusClassName
      && appliedSurfaceState.statusMessage === statusMessage
      && appliedSurfaceState.statusRole === statusRole
      && null === appliedSurfaceState.windowedCommitKey
      // Identical HTML is only a no-op while the mounted children still spell
      // the render this sink installed. A native edit mutates the accepted DOM
      // without changing the requested HTML (or its revision), so skipping here
      // would keep the edited DOM as the next accepted baseline while the source
      // still describes the original render. Materialize/window commit states
      // do not record `renderedHtml`; their identities are verified elsewhere.
      && (
        'string' !== typeof appliedSurfaceState.renderedHtml
        || appliedSurfaceState.renderedHtml === surface.innerHTML
      )
    ) {
      if (
        contentEditable
        && acceptedEmpty
        && '' === html
        && 'ready' === phase
        && null !== appliedSurfaceState.renderedHtml
      ) {
        appliedSurfaceStateRef.current = {
          ...appliedSurfaceState,
          renderedHtml: null
        };
      }
      return;
    }

    if (activeMaterializeCommit) {
      if (
        appliedSurfaceState
        && appliedSurfaceState.revision === htmlRevision
        && appliedSurfaceState.html === html
        && appliedSurfaceState.statusClassName === statusClassName
        && appliedSurfaceState.statusMessage === statusMessage
        && appliedSurfaceState.statusRole === statusRole
        && appliedSurfaceState.materializeCommitKey === activeMaterializeCommit.key
      ) {
        return undefined;
      }
      deferredRootEndAtomicSurfaces.delete(surface);
      const cancelMaterialize = startMaterializeChildrenCommit(
        surface,
        activeMaterializeCommit.nodes,
        materializeScheduler ?? defaultSafePreviewHtmlSinkScheduler(
          surface.ownerDocument
        ),
        () => {
          appliedSurfaceStateRef.current = {
            html,
            materializeCommitKey: activeMaterializeCommit.key,
            revision: htmlRevision,
            statusClassName,
            statusMessage,
            statusRole,
            windowedCommitKey: null
          };
          onMaterializeComplete?.(
            activeMaterializeCommit.revision,
            activeMaterializeCommit.key
          );
        },
        (error) => {
          appliedSurfaceStateRef.current = {
            html,
            materializeCommitKey: activeMaterializeCommit.key,
            revision: htmlRevision,
            statusClassName,
            statusMessage,
            statusRole,
            windowedCommitKey: null
          };
          onMaterializeFailure?.(
            activeMaterializeCommit.revision,
            activeMaterializeCommit.key,
            error
          );
        }
      );
      return () => {
        cancelMaterialize();
        appliedSurfaceStateRef.current = {
          html,
          materializeCommitKey: null,
          revision: htmlRevision,
          statusClassName,
          statusMessage,
          statusRole,
          windowedCommitKey: null
        };
      };
    }

    if (windowCommit) {
      if (appliedSurfaceState && appliedSurfaceState.revision === htmlRevision
        && appliedSurfaceState.html === html && appliedSurfaceState.windowedCommitKey !== null
        && appliedSurfaceState.windowedCommitKey > windowCommit.key) return undefined;
      if (
        appliedSurfaceState
        && appliedSurfaceState.revision === htmlRevision
        && appliedSurfaceState.html === html
        && appliedSurfaceState.statusClassName === statusClassName
        && appliedSurfaceState.statusMessage === statusMessage
        && appliedSurfaceState.statusRole === statusRole
        && appliedSurfaceState.windowedCommitKey === windowCommit.key
      ) {
        return undefined;
      }
      return startWindowChildrenCommit(
        surface,
        windowCommit.nodes,
        () => {
          appliedSurfaceStateRef.current = {
            html,
            materializeCommitKey: null,
            revision: htmlRevision,
            statusClassName,
            statusMessage,
            statusRole,
            windowedCommitKey: windowCommit.key
          };
          onStagedCommit?.(windowCommit.revision);
        },
        windowCommit.selectionHandoff
      );
    }

    if (commit && appliedSurfaceState?.stagedCommit === commit) {
      const committedNodes = appliedSurfaceState.stagedCommitNodes;
      if (!committedNodes) {
        throw new Error('preview-staged-commit-state-incomplete');
      }
      if (!hasExactChildren(surface, committedNodes)) {
        throw new Error('preview-staged-commit-surface-drifted');
      }
      return undefined;
    }

    if (commit) {
      deferredRootEndAtomicSurfaces.delete(surface);
      const protectedReuse = prepareVisualProtectedNodeAdoption(
        Array.from(surface.childNodes),
        commit.nodes,
        Boolean(contentEditable)
      );
      try {
        validateUniqueChildren(protectedReuse.nodes);
        if (!hasExactChildren(surface, protectedReuse.nodes)) {
          surface.replaceChildren(...protectedReuse.nodes);
        }
      } catch (error) {
        protectedReuse.rollback();
        throw error;
      }
      if (statusMessage) {
        appendStatusMessage(surface, statusClassName, statusMessage, statusRole);
      }
      appliedSurfaceStateRef.current = {
        html,
        materializeCommitKey: null,
        revision: htmlRevision,
        statusClassName,
        statusMessage,
        statusRole,
        windowedCommitKey: null,
        stagedCommit: commit,
        stagedCommitNodes: Array.from(surface.childNodes)
      };
      onStagedCommit?.(commit.revision);
      return undefined;
    }

    if (
      null !== html
      && deferredByHoldRef.current
      && ("loading" === phase || "enhancing" === phase)
      && appliedSurfaceStateRef.current
    ) {
      // The release woke this effect for a request whose accepted frame has
      // not landed yet. Replaying this candidate would replace the surface the
      // draft just produced, so the last applied DOM stands until its formal
      // commit arrives. Failed/ordinary paths never reach this branch.
      return undefined;
    }
    const alreadyAppliedAcceptedEmpty = Boolean(
      appliedSurfaceState
      && appliedSurfaceState.revision === htmlRevision
      && '' === appliedSurfaceState.html
      && null === appliedSurfaceState.windowedCommitKey
      && null === appliedSurfaceState.materializeCommitKey
      && !appliedSurfaceState.stagedCommit
    );
    const clearsAcceptedEmpty = Boolean(
      acceptedEmpty
      && '' === html
      && 'ready' === phase
      && (
        !alreadyAppliedAcceptedEmpty
        || null !== surface.querySelector('[data-easymde-preview-window-spacer]')
      )
    );
    if (null !== html) {
      // An empty Preview frame cannot describe an editable surface that already
      // holds content unless the Preview owner explicitly accepted a new empty
      // ready document: an unsaved Post whose first render has not landed yet,
      // or fresh local input typed on an already-applied empty revision, would
      // otherwise lose the text the Editor owns. The Editor's own commit
      // publishes the next frame for the source it wrote.
      if (
        contentEditable
        && '' === html
        && !clearsAcceptedEmpty
        && surface.hasChildNodes()
      ) {
        return undefined;
      }
      // This is the sole sink for PHP-rendered, server-sanitized Preview HTML.
      deferredRootEndAtomicSurfaces.delete(surface);
      deferredByHoldRef.current = false;
      if ('' === html) {
        surface.replaceChildren();
      } else {
        surface.innerHTML = html;
      }
    } else {
      // The Editor owns this surface while it is editable. A Preview state with
      // no HTML - an unsaved Post whose first render has not landed yet - is a
      // missing render, not permission to discard the content being edited.
      if (contentEditable && surface.hasChildNodes()) return undefined;
      deferredRootEndAtomicSurfaces.delete(surface);
      surface.replaceChildren();
      if (!statusMessage) {
        appliedSurfaceStateRef.current = {
          html,
          materializeCommitKey: null,
          renderedHtml: surface.innerHTML,
          revision: htmlRevision,
          statusClassName,
          statusMessage,
          statusRole,
          windowedCommitKey: null
        };
        return undefined;
      }
      appendStatusMessage(surface, statusClassName, statusMessage, statusRole);
    }
    appliedSurfaceStateRef.current = {
      html,
      materializeCommitKey: null,
      // Read back what the browser actually installed: attribute quoting and
      // entity spelling are the browser's, and a later identical request must
      // compare against this exact serialization, not the request string.
      // For an accepted empty surface, leave `renderedHtml` null regardless of
      // whether `contentEditable` is currently enabled so unlocking and typing
      // into the empty paper on the same revision is not overwritten before a
      // newer Preview revision arrives.
      renderedHtml: clearsAcceptedEmpty
        ? null
        : surface.innerHTML,
      revision: htmlRevision,
      statusClassName,
      statusMessage,
      statusRole,
      windowedCommitKey: null
    };
    return undefined;
  }, [
    acceptedEmpty,
    contentEditable,
    html,
    htmlRevision,
    materializeScheduler,
    materializeCommit,
    onMaterializeComplete,
    onMaterializeFailure,
    beforeStagedCommit,
    onStagedCommit,
    stagedCommit,
    statusClassName,
    statusMessage,
    statusRole,
    windowedCommit,
    phase,
    compositionGate?.version
  ]);

  return (
    <article
      data-easymde-preview-accepted={acceptedHtml ? '1' : undefined}
      aria-busy={ariaBusy ? 'true' : 'false'}
      aria-label={label}
      aria-live={contentEditable ? undefined : 'polite'}
      className={className}
      contentEditable={contentEditable}
      data-easymde-preview-error={error ? '1' : undefined}
      data-easymde-preview-html-sink="1"
      data-easymde-preview-phase={phase}
      data-easymde-preview-refreshing={refreshing ? '1' : undefined}
      onDrop={onDrop}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      ref={htmlSurfaceRef}
      role={role}
      spellCheck={spellCheck}
      style={style}
      suppressContentEditableWarning={contentEditable}
    />
  );
}
